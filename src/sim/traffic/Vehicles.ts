import { type PolyPoint, pointAt } from '../../core/geom2d';
import { nodeLift, raisedLift } from '../roads/Overpass';
import type { RoadLayout } from '../roads/RoadLayout';
import type { RoadNetwork, RoadSegment } from '../roads/RoadNetwork';
import { ROAD_TYPES, laneOffset, onewayLaneOffset } from '../roads/RoadTypes';
import type { Terrain } from '../world/Terrain';
import type { Route, RouteLeg } from './Pathfinder';
import type { Signals } from './Signals';

export const VEHICLE_MODELS = ['sedan', 'hatchback', 'suv', 'van', 'truck', 'garbage', 'firetruck', 'police', 'ambulance', 'bus'] as const;
export type VehicleModelName = (typeof VEHICLE_MODELS)[number];
export const VM: Record<VehicleModelName, number> = Object.fromEntries(VEHICLE_MODELS.map((m, i) => [m, i])) as Record<VehicleModelName, number>;

export const VEHICLE_LENGTH = [4.6, 4.0, 4.8, 5.2, 8.5, 8.0, 9.0, 4.8, 6.2, 12.0];

export enum Purpose {
  Commute = 0,
  Shopping = 1,
  Freight = 2,
  Service = 3,
  Visitor = 4,
  MoveIn = 5,
  Emergency = 6,
  Transit = 7,
}

export interface VehicleSpawn {
  route: Route;
  model: number;
  color: number;
  purpose: Purpose;
  tag?: number;
  onArrive?: () => void;
  /** Called on arrival; returning a new route keeps the vehicle going after `dwell` seconds. */
  next?: (i: number) => { route: Route; dwell: number } | null;
}

const MAX_WAIT = 50;
const ACCEL = 2.4;
const BRAKE = 6.5;

/**
 * Lightweight lane-based vehicle agents. Vehicles follow precomputed routes,
 * keep distance to the car ahead in their lane, obey signals and yield
 * junctions, and queue when the next lane is full (spill-back).
 */
export class Vehicles {
  readonly max: number;
  readonly active: Uint8Array;
  readonly model: Uint8Array;
  readonly color: Uint32Array;
  readonly purpose: Uint8Array;
  readonly tag: Int32Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly heading: Float32Array;
  readonly speed: Float32Array;
  /** 1 while braking hard / stopped (for brake lights). */
  readonly braking: Uint8Array;
  /** Incremented each time a slot is reused (lets the UI notice a vehicle is gone). */
  readonly serial: Uint32Array;
  private routes: (Route | null)[];
  private leg: Int32Array;
  private d: Float32Array;
  private dEnd: Float32Array;
  private lane: Uint8Array;
  private laneKey: Int32Array;
  private turning: Uint8Array;
  private turnNode: Int32Array;
  private tT: Float32Array;
  private tLen: Float32Array;
  private tp: Float32Array;
  private wait: Float32Array;
  private vfac: Float32Array;
  private dtAcc: Float32Array;
  private callbacks = new Map<number, () => void>();
  private continuations = new Map<number, (i: number) => { route: Route; dwell: number } | null>();
  /** Seconds left standing still (buses at stops). */
  readonly hold: Float32Array;
  private free: number[] = [];
  private lanes = new Map<number, number[]>();
  private junctionLoad = new Map<number, { n: number; seg: number }>();
  /** Vehicles currently turning into each lane (lane reservations). */
  private incoming = new Map<number, number>();
  private pp: PolyPoint = { x: 0, z: 0, tx: 0, tz: 0, i: 0 };
  private frame = 0;
  count = 0;
  /** Travel-time multiplier per segment (from the macro traffic model). */
  congestion: (segId: number) => number = () => 1;
  /** Vehicles beyond this radius from the focus point are updated at reduced rate. */
  lodX = 0;
  lodZ = 0;
  lodRadius = 900;
  /** Stats. */
  despawnedStuck = 0;
  arrived = 0;

  constructor(private net: RoadNetwork, private layout: RoadLayout, private signals: Signals, private terrain: Terrain, max = 3200) {
    this.max = max;
    this.active = new Uint8Array(max);
    this.model = new Uint8Array(max);
    this.color = new Uint32Array(max);
    this.purpose = new Uint8Array(max);
    this.tag = new Int32Array(max);
    this.x = new Float32Array(max);
    this.y = new Float32Array(max);
    this.z = new Float32Array(max);
    this.heading = new Float32Array(max);
    this.speed = new Float32Array(max);
    this.braking = new Uint8Array(max);
    this.serial = new Uint32Array(max);
    this.routes = new Array(max).fill(null);
    this.leg = new Int32Array(max);
    this.d = new Float32Array(max);
    this.dEnd = new Float32Array(max);
    this.lane = new Uint8Array(max);
    this.laneKey = new Int32Array(max).fill(-1);
    this.turning = new Uint8Array(max);
    this.turnNode = new Int32Array(max);
    this.tT = new Float32Array(max);
    this.tLen = new Float32Array(max);
    this.tp = new Float32Array(max * 6);
    this.wait = new Float32Array(max);
    this.vfac = new Float32Array(max);
    this.dtAcc = new Float32Array(max);
    this.hold = new Float32Array(max);
    for (let i = max - 1; i >= 0; i--) this.free.push(i);
  }

  private key(segId: number, dir: number, lane: number): number {
    return segId * 32 + (dir === 1 ? 0 : 16) + lane;
  }

  private legD(seg: RoadSegment, leg: RouteLeg, s: number): number {
    return leg.dir === 1 ? s : seg.length - s;
  }

  private entryTrim(seg: RoadSegment, leg: RouteLeg): number {
    return leg.dir === 1 ? seg.trimA : seg.trimB;
  }

  private exitTrim(seg: RoadSegment, leg: RouteLeg): number {
    return leg.dir === 1 ? seg.trimB : seg.trimA;
  }

  private exitNode(seg: RoadSegment, leg: RouteLeg): number {
    return leg.dir === 1 ? seg.b : seg.a;
  }

  /** Lane to use on leg k given the turn at its end. */
  private laneFor(i: number, route: Route, k: number): number {
    const leg = route.legs[k];
    const seg = this.net.segments.get(leg.segId);
    if (!seg) return 0;
    const lanes = ROAD_TYPES[seg.type].lanes * (seg.oneway !== 0 ? 2 : 1);
    if (lanes === 1) return 0;
    if (k === route.legs.length - 1) return lanes - 1;
    const next = route.legs[k + 1];
    const nseg = this.net.segments.get(next.segId);
    if (!nseg) return lanes - 1;
    pointAt(seg.poly, leg.dir === 1 ? seg.length : 0, this.pp);
    const inx = this.pp.tx * leg.dir;
    const inz = this.pp.tz * leg.dir;
    pointAt(nseg.poly, next.dir === 1 ? 0 : nseg.length, this.pp);
    const outx = this.pp.tx * next.dir;
    const outz = this.pp.tz * next.dir;
    const cross = inx * outz - inz * outx;
    if (cross > 0.35) return lanes - 1;
    if (cross < -0.35) return 0;
    return i % lanes;
  }

  private laneInsert(key: number, i: number): void {
    let list = this.lanes.get(key);
    if (!list) {
      list = [];
      this.lanes.set(key, list);
    }
    const d = this.d;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (d[list[mid]] < d[i]) lo = mid + 1;
      else hi = mid;
    }
    list.splice(lo, 0, i);
    this.laneKey[i] = key;
  }

  private laneRemove(i: number): void {
    const key = this.laneKey[i];
    if (key < 0) return;
    const list = this.lanes.get(key);
    if (list) {
      const idx = list.indexOf(i);
      if (idx >= 0) list.splice(idx, 1);
      if (list.length === 0) this.lanes.delete(key);
    }
    this.laneKey[i] = -1;
  }

  spawn(sp: VehicleSpawn): number {
    if (!this.free.length) return -1;
    const route = sp.route;
    if (!route.legs.length) return -1;
    const leg0 = route.legs[0];
    const seg = this.net.segments.get(leg0.segId);
    if (!seg) return -1;
    const i = this.free[this.free.length - 1];
    const lane = this.laneFor(i, route, 0);
    const minD = this.entryTrim(seg, leg0) + 1;
    let d0 = this.legD(seg, leg0, leg0.s0);
    const dEnd = route.legs.length === 1 ? this.legD(seg, leg0, leg0.s1) : seg.length - this.exitTrim(seg, leg0);
    d0 = Math.max(d0, Math.min(minD, dEnd - 2));
    // Don't spawn on top of another vehicle.
    const key = this.key(seg.id, leg0.dir, lane);
    const list = this.lanes.get(key);
    if (list) for (const j of list) if (Math.abs(this.d[j] - d0) < 7) return -1;
    this.free.pop();
    this.active[i] = 1;
    this.serial[i]++;
    this.model[i] = sp.model;
    this.color[i] = sp.color;
    this.purpose[i] = sp.purpose;
    this.tag[i] = sp.tag ?? 0;
    this.routes[i] = route;
    this.leg[i] = 0;
    this.d[i] = d0;
    this.dEnd[i] = dEnd;
    this.lane[i] = lane;
    this.turning[i] = 0;
    this.speed[i] = 0;
    this.wait[i] = 0;
    this.dtAcc[i] = 0;
    this.hold[i] = 0;
    this.vfac[i] = 0.86 + ((i * 2654435761) >>> 0) / 4294967296 * 0.22;
    if (sp.onArrive) this.callbacks.set(i, sp.onArrive);
    if (sp.next) this.continuations.set(i, sp.next);
    this.laneInsert(key, i);
    this.count++;
    this.place(i, seg, leg0);
    return i;
  }

  private targetKey(i: number): number {
    const route = this.routes[i]!;
    const leg = route.legs[this.leg[i]];
    return this.key(leg.segId, leg.dir, this.lane[i]);
  }

  private release(key: number): void {
    const n = (this.incoming.get(key) ?? 0) - 1;
    if (n <= 0) this.incoming.delete(key);
    else this.incoming.set(key, n);
  }

  despawn(i: number, arrived = false): void {
    if (!this.active[i]) return;
    this.laneRemove(i);
    if (this.turning[i]) {
      this.leaveJunction(this.turnNode[i]);
      this.release(this.targetKey(i));
    }
    this.turning[i] = 0;
    this.active[i] = 0;
    this.routes[i] = null;
    const cb = this.callbacks.get(i);
    this.callbacks.delete(i);
    this.continuations.delete(i);
    if (arrived && cb) cb();
    this.free.push(i);
    this.count--;
  }

  private leaveJunction(node: number): void {
    const j = this.junctionLoad.get(node);
    if (!j) return;
    j.n--;
    if (j.n <= 0) this.junctionLoad.delete(node);
  }

  private canEnter(i: number, seg: RoadSegment, route: Route, k: number): boolean {
    const leg = route.legs[k];
    const node = this.exitNode(seg, leg);
    const lay = this.layout.get(node);
    if (lay) {
      if (lay.control === 'signal' && !this.signals.isGreen(node, seg.id)) return false;
      if (lay.control === 'yield') {
        const j = this.junctionLoad.get(node);
        if (j && j.n > 0 && (j.seg !== seg.id || j.n >= 2)) return false;
      }
      if (lay.control === 'roundabout' && !seg.ring && !this.ringClear(node, lay)) return false;
    }
    const next = route.legs[k + 1];
    const nseg = this.net.segments.get(next.segId);
    if (!nseg) return false;
    const nl = this.laneFor(i, route, k + 1);
    const nkey = this.key(nseg.id, next.dir, nl);
    if ((this.incoming.get(nkey) ?? 0) > 0) return false;
    const list = this.lanes.get(nkey);
    if (list && list.length) {
      const tail = list[0];
      const entry = this.entryTrim(nseg, next);
      if (this.d[tail] < entry + VEHICLE_LENGTH[this.model[tail]] + 3) return false;
    }
    return true;
  }

  /** True when no circulating vehicle is about to pass the entry at `node`. */
  private ringClear(node: number, lay: { arms: { segId: number }[] }): boolean {
    const j = this.junctionLoad.get(node);
    if (j && j.n > 0) return false;
    for (const a of lay.arms) {
      const s = this.net.segments.get(a.segId);
      if (!s || !s.ring) continue;
      const dirInto = s.b === node ? 1 : -1;
      if (s.oneway !== 0 && s.oneway !== dirInto) continue;
      const lanes = ROAD_TYPES[s.type].lanes * 2;
      const stop = s.length - (dirInto === 1 ? s.trimB : s.trimA);
      for (let lane = 0; lane < lanes; lane++) {
        const list = this.lanes.get(this.key(s.id, dirInto, lane));
        if (!list || !list.length) continue;
        const lead = list[list.length - 1];
        if (stop - this.d[lead] < 16) return false;
      }
    }
    return true;
  }

  private lanePos(seg: RoadSegment, dir: number, lane: number, d: number, out: { x: number; z: number; tx: number; tz: number }): void {
    const s = dir === 1 ? d : seg.length - d;
    pointAt(seg.poly, s, this.pp);
    const tx = this.pp.tx * dir;
    const tz = this.pp.tz * dir;
    const off = seg.oneway !== 0 ? onewayLaneOffset(ROAD_TYPES[seg.type], lane) : laneOffset(ROAD_TYPES[seg.type], lane);
    out.x = this.pp.x - tz * off;
    out.z = this.pp.z + tx * off;
    out.tx = tx;
    out.tz = tz;
  }

  private tmpA = { x: 0, z: 0, tx: 0, tz: 0 };
  private tmpB = { x: 0, z: 0, tx: 0, tz: 0 };

  private place(i: number, seg: RoadSegment, leg: RouteLeg): void {
    this.lanePos(seg, leg.dir, this.lane[i], this.d[i], this.tmpA);
    this.x[i] = this.tmpA.x;
    this.z[i] = this.tmpA.z;
    this.heading[i] = Math.atan2(this.tmpA.tz, this.tmpA.tx);
    this.y[i] = this.terrain.roadHeightAt(this.tmpA.x, this.tmpA.z) + 0.12 + (seg.raised ? raisedLift(this.net, seg, leg.dir === 1 ? this.d[i] : seg.length - this.d[i]) : 0);
  }

  private beginTurn(i: number, seg: RoadSegment, route: Route, k: number): void {
    const leg = route.legs[k];
    const next = route.legs[k + 1];
    const nseg = this.net.segments.get(next.segId)!;
    const nl = this.laneFor(i, route, k + 1);
    this.lanePos(seg, leg.dir, this.lane[i], this.d[i], this.tmpA);
    const entry = this.entryTrim(nseg, next);
    this.lanePos(nseg, next.dir, nl, entry, this.tmpB);
    const a = this.tmpA;
    const b = this.tmpB;
    // Control point: intersection of the incoming and outgoing lane lines.
    let cx = (a.x + b.x) / 2;
    let cz = (a.z + b.z) / 2;
    const den = a.tx * b.tz - a.tz * b.tx;
    const chord = Math.hypot(b.x - a.x, b.z - a.z);
    if (Math.abs(den) > 0.05) {
      const t = ((b.x - a.x) * b.tz - (b.z - a.z) * b.tx) / den;
      const u = ((b.x - a.x) * a.tz - (b.z - a.z) * a.tx) / den;
      if (t > 0 && u > 0 && t < chord * 1.5) {
        cx = a.x + a.tx * t;
        cz = a.z + a.tz * t;
      }
    }
    const o = i * 6;
    this.tp[o] = a.x;
    this.tp[o + 1] = a.z;
    this.tp[o + 2] = cx;
    this.tp[o + 3] = cz;
    this.tp[o + 4] = b.x;
    this.tp[o + 5] = b.z;
    this.tLen[i] = Math.max(1, (Math.hypot(cx - a.x, cz - a.z) + Math.hypot(b.x - cx, b.z - cz) + chord) / 2);
    this.tT[i] = 0;
    this.laneRemove(i);
    this.turning[i] = 1;
    const node = this.exitNode(seg, leg);
    this.turnNode[i] = node;
    const j = this.junctionLoad.get(node);
    if (j) j.n++;
    else this.junctionLoad.set(node, { n: 1, seg: seg.id });
    this.leg[i] = k + 1;
    this.lane[i] = nl;
    this.d[i] = entry;
    const last = k + 1 === route.legs.length - 1;
    this.dEnd[i] = last ? this.legD(nseg, next, next.s1) : nseg.length - this.exitTrim(nseg, next);
    const tk = this.key(nseg.id, next.dir, nl);
    this.incoming.set(tk, (this.incoming.get(tk) ?? 0) + 1);
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.frame++;
    const lodR2 = this.lodRadius * this.lodRadius;
    for (let i = 0; i < this.max; i++) {
      if (!this.active[i]) continue;
      let step = dt + this.dtAcc[i];
      const dx = this.x[i] - this.lodX;
      const dz = this.z[i] - this.lodZ;
      if (dx * dx + dz * dz > lodR2 && ((this.frame + i) & 3) !== 0) {
        this.dtAcc[i] = step;
        continue;
      }
      this.dtAcc[i] = 0;
      if (step > 0.25) step = 0.25;
      if (this.turning[i]) this.updateTurn(i, step);
      else this.updateDrive(i, step);
    }
  }

  private updateTurn(i: number, dt: number): void {
    const route = this.routes[i]!;
    const leg = route.legs[this.leg[i]];
    const nseg = this.net.segments.get(leg.segId);
    if (!nseg) {
      this.despawn(i);
      return;
    }
    const target = 7;
    const v = this.speed[i] < target ? Math.min(target, this.speed[i] + ACCEL * dt) : Math.max(target, this.speed[i] - BRAKE * dt);
    this.speed[i] = v;
    this.braking[i] = 0;
    this.tT[i] += (v * dt) / this.tLen[i];
    const o = i * 6;
    const t = Math.min(1, this.tT[i]);
    const u = 1 - t;
    const p = this.tp;
    const x = u * u * p[o] + 2 * u * t * p[o + 2] + t * t * p[o + 4];
    const z = u * u * p[o + 1] + 2 * u * t * p[o + 3] + t * t * p[o + 5];
    const hx = 2 * u * (p[o + 2] - p[o]) + 2 * t * (p[o + 4] - p[o + 2]);
    const hz = 2 * u * (p[o + 3] - p[o + 1]) + 2 * t * (p[o + 5] - p[o + 3]);
    this.x[i] = x;
    this.z[i] = z;
    if (hx * hx + hz * hz > 1e-6) this.heading[i] = Math.atan2(hz, hx);
    this.y[i] = this.terrain.roadHeightAt(x, z) + 0.12 + nodeLift(this.net, this.turnNode[i]);
    if (this.tT[i] >= 1) {
      this.turning[i] = 0;
      this.leaveJunction(this.turnNode[i]);
      const key = this.key(nseg.id, leg.dir, this.lane[i]);
      this.release(key);
      this.laneInsert(key, i);
    }
  }

  private updateDrive(i: number, dt: number): void {
    const route = this.routes[i]!;
    const k = this.leg[i];
    const leg = route.legs[k];
    const seg = this.net.segments.get(leg.segId);
    if (!seg) {
      this.despawn(i);
      return;
    }
    const rt = ROAD_TYPES[seg.type];
    const isLast = k === route.legs.length - 1;
    const stopD = this.dEnd[i];
    const d = this.d[i];
    const distToStop = stopD - d;

    // Leader in the same lane.
    const list = this.lanes.get(this.laneKey[i]);
    let gap = Infinity;
    let leaderD = Infinity;
    if (list) {
      const idx = list.indexOf(i);
      if (idx >= 0 && idx < list.length - 1) {
        const leader = list[idx + 1];
        leaderD = this.d[leader];
        gap = leaderD - d - VEHICLE_LENGTH[this.model[leader]] * 0.5 - VEHICLE_LENGTH[this.model[i]] * 0.5 - 1.2;
      }
    }

    let mustStop = isLast;
    let permitted = false;
    if (!isLast && distToStop < 45) {
      permitted = this.canEnter(i, seg, route, k);
      if (!permitted) mustStop = true;
    }

    if (this.hold[i] > 0) {
      // Standing at a stop.
      this.hold[i] -= dt;
      this.speed[i] = 0;
      this.braking[i] = 1;
      this.place(i, seg, leg);
      return;
    }
    let vTarget = (rt.speed * this.vfac[i]) / this.congestion(seg.id);
    if (gap < Infinity) vTarget = Math.min(vTarget, Math.max(0, gap) / 1.15);
    if (mustStop) {
      const rem = Math.max(0, distToStop - 0.3);
      vTarget = Math.min(vTarget, Math.sqrt(2 * 3.2 * rem));
    } else if (!isLast && distToStop < 30) {
      vTarget = Math.min(vTarget, 7 + distToStop * 0.35);
    }
    let v = this.speed[i];
    if (v < vTarget) v = Math.min(vTarget, v + ACCEL * dt);
    else v = Math.max(vTarget, v - BRAKE * dt);
    this.braking[i] = v < this.speed[i] - 0.01 || v < 0.5 ? 1 : 0;
    this.speed[i] = v;
    let nd = d + v * dt;
    if (leaderD < Infinity) nd = Math.min(nd, Math.max(d, leaderD - 4.2));
    if (mustStop) nd = Math.min(nd, Math.max(d, stopD));
    this.d[i] = nd;

    if (v < 0.3) this.wait[i] += dt;
    else this.wait[i] = Math.max(0, this.wait[i] - dt * 2);
    if (this.wait[i] > MAX_WAIT) {
      this.despawnedStuck++;
      this.despawn(i);
      return;
    }

    if (isLast) {
      if (nd >= stopD - 0.4) {
        this.arrived++;
        const cont = this.continuations.get(i);
        const next = cont ? cont(i) : null;
        if (next && this.reroute(i, next.route, next.dwell)) return;
        this.despawn(i, true);
        return;
      }
    } else if (permitted && nd >= stopD) {
      this.beginTurn(i, seg, route, k);
      this.updateTurn(i, 0);
      return;
    }
    // Keep lane lists sorted (overtaking does not happen, but spawns can interleave).
    this.place(i, seg, leg);
  }

  /**
   * Gives an arrived vehicle a new route that starts where it stands, after
   * waiting `dwell` seconds. Returns false if the route doesn't start here.
   */
  private reroute(i: number, route: Route, dwell: number): boolean {
    const leg0 = route.legs[0];
    const seg = leg0 ? this.net.segments.get(leg0.segId) : undefined;
    if (!seg) return false;
    this.laneRemove(i);
    this.routes[i] = route;
    this.leg[i] = 0;
    const lane = this.laneFor(i, route, 0);
    const d0 = this.legD(seg, leg0, leg0.s0);
    this.d[i] = d0;
    this.dEnd[i] = route.legs.length === 1 ? this.legD(seg, leg0, leg0.s1) : seg.length - this.exitTrim(seg, leg0);
    this.lane[i] = lane;
    this.wait[i] = 0;
    this.hold[i] = dwell;
    this.laneInsert(this.key(seg.id, leg0.dir, lane), i);
    this.place(i, seg, leg0);
    return true;
  }

  /** Removes vehicles whose remaining route uses a removed segment. */
  onSegmentRemoved(segId: number): void {
    for (let i = 0; i < this.max; i++) {
      if (!this.active[i]) continue;
      const r = this.routes[i]!;
      for (let k = this.leg[i]; k < r.legs.length; k++) {
        if (r.legs[k].segId === segId) {
          this.despawn(i);
          break;
        }
      }
    }
  }

  /** Number of vehicles currently on a segment (both directions). */
  countOn(segId: number): number {
    let n = 0;
    for (let dir = 0; dir < 2; dir++) {
      for (let lane = 0; lane < 4; lane++) {
        const list = this.lanes.get(segId * 32 + dir * 16 + lane);
        if (list) n += list.length;
      }
    }
    return n;
  }

  /** Index of the route leg the vehicle is on. */
  legOf(i: number): number {
    return this.leg[i];
  }

  routeOf(i: number): Route | null {
    return this.active[i] ? this.routes[i] : null;
  }

  clear(): void {
    for (let i = 0; i < this.max; i++) if (this.active[i]) this.despawn(i);
    this.lanes.clear();
    this.junctionLoad.clear();
    this.incoming.clear();
  }
}
