import { type PolyPoint, pointAt } from '../../core/geom2d';
import { nodeLift, raisedLift } from '../roads/Overpass';
import type { RoadLayout } from '../roads/RoadLayout';
import type { RoadNetwork, RoadSegment } from '../roads/RoadNetwork';
import { ROAD_TYPES, laneOffset, onewayLaneOffset, segmentCapacity } from '../roads/RoadTypes';
import { CROSSWALK_INSET, hasCrosswalk } from '../walk/WalkNetwork';
import type { Terrain } from '../world/Terrain';
import type { Route, RouteLeg } from './Pathfinder';
import type { Sense, Signals, Turn } from './Signals';

export const VEHICLE_MODELS = ['sedan', 'hatchback', 'suv', 'van', 'truck', 'garbage', 'firetruck', 'police', 'ambulance', 'bus', 'pickup', 'taxi', 'delivery', 'mini', 'bike'] as const;
export type VehicleModelName = (typeof VEHICLE_MODELS)[number];
export const VM: Record<VehicleModelName, number> = Object.fromEntries(VEHICLE_MODELS.map((m, i) => [m, i])) as Record<VehicleModelName, number>;

export const VEHICLE_LENGTH = [4.6, 4.0, 4.8, 5.2, 8.5, 8.0, 9.0, 4.8, 6.2, 12.0, 5.3, 4.7, 6.4, 3.45, 1.8];
/** Width and height of each model (for distant boxes). */
export const VEHICLE_WIDTH = [1.82, 1.76, 1.96, 2.0, 2.45, 2.45, 2.5, 1.84, 2.2, 2.55, 1.95, 1.84, 2.2, 1.64, 0.6];
export const VEHICLE_HEIGHT = [1.45, 1.5, 1.85, 2.25, 3.2, 3.3, 3.2, 1.6, 2.85, 3.3, 1.95, 1.65, 3.25, 1.5, 1.75];
/** Bicycles ride their own line along the kerb (lane number), clear of the car lanes. */
export const BIKE_LANE = 7;
/** Trucks and buses: slow to start and stop. */
export const HEAVY_MODEL = VEHICLE_MODELS.map((m) => m === 'truck' || m === 'garbage' || m === 'firetruck' || m === 'bus' || m === 'delivery');
/** Vehicles that park at the end of their trip (rather than vanishing), when near the camera. */
const PARKS = VEHICLE_MODELS.map((m) => ['sedan', 'hatchback', 'suv', 'van', 'pickup', 'taxi', 'delivery', 'mini'].includes(m));

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
  /** The building the trip ends at, if any. */
  dest?: number;
  onArrive?: () => void;
  /** Called on arrival; returning a new route keeps the vehicle going after `dwell` seconds. */
  next?: (i: number) => { route: Route; dwell: number } | null;
}

/** Why a vehicle is standing still (for rerouting and the interface). */
export enum Held {
  None = 0,
  /** At a red light. */
  Red = 1,
  /** Giving way at a junction. */
  GiveWay = 2,
  /** The road beyond the junction is full. */
  Full = 3,
  /** Behind another vehicle. */
  Queue = 4,
  /** Letting someone cross. */
  People = 5,
}

/** Seconds standing still before a vehicle is taken off the map (a last resort against gridlock). */
const MAX_WAIT = 150;
/** Hardest braking. */
const MAX_BRAKE = 9;
/** Distance before a junction at which drivers start deciding whether they may go. */
const LOOKAHEAD = 70;
/** Curve samples per movement when working out which paths through a junction cross. */
const SAMPLES = 12;
/** Paths closer than this (m) conflict. */
const CONFLICT_DIST = 2.4;
/** People (and zebra crossings) are only looked for this close to where they're simulated. */
const PEOPLE_RANGE = 420;
/** Cars this close to the camera's focus park at the end of their trip, and their drivers walk inside. */
const PARK_RANGE = 380;

/** What a vehicle is doing at the end of its trip. */
export enum Park {
  None = 0,
  /** Heading for the kerb. */
  Kerb = 1,
  /** Heading for a driveway. */
  Driveway = 2,
  /** Turning into the driveway. */
  PullingIn = 3,
  /** Parked (and, at the end, fading away). */
  Parked = 4,
  /** Not parking: vanishes on arrival as before. */
  Never = 5,
}

/** A junction where drivers claim their way across: the paths through it and who goes first. */
interface Junction {
  node: number;
  n: number;
  segs: number[];
  /** Per movement (in arm × n + out arm): -1 not allowed, 0 minor (gives way), 1 permissive (gives way to oncoming), 2 priority. */
  prio: Int8Array;
  /** Per movement: -1 left, 0 straight on, 1 right. */
  turn: Int8Array;
  /** Movement pairs whose paths cross or merge. */
  conflict: Uint8Array;
  /** Per movement: where a permissive turner waits inside the junction (curve parameter; 0 = at the stop line). */
  waitT: Float32Array;
  signal: boolean;
  roundabout: boolean;
  /** Direction of each arm, away from the junction. */
  dx: Float32Array;
  dz: Float32Array;
}

const hash = (a: number, b: number) => {
  let h = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  return ((h ^ (h >>> 12)) >>> 0) / 4294967296;
};

/**
 * Lane-based vehicle agents with driver behaviour:
 * - smooth acceleration and braking that follows the car ahead (the intelligent
 *   driver model), each driver with their own temperament: speed, following
 *   distance, acceleration, patience and the gaps they'll accept;
 * - speeds that suit the curve of the road and of each turn;
 * - lane changes, signalled: into the lane for the next turn, past buses at stops
 *   and slow trucks, and out of a blocked lane;
 * - junctions crossed by claiming a path through them first: lights (with
 *   left-turn arrows), minor roads giving way to major ones, left-turners waiting
 *   in the junction for a gap in oncoming traffic, roundabouts giving way to the
 *   ring, and nobody entering a junction they can't leave;
 * - stopping for people on crossings;
 * - drivers stuck for a while rerouting with what they can see and know (not always well).
 */
/** Vehicle steps a real second at most (faster frames are drawn between steps). */
const STEP_HZ = 60;

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
  /**
   * Where each vehicle was before the last step, and how far (0..1) drawing has moved on from
   * there towards where it is now: cars step at a fixed rate and are drawn in between.
   */
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly ph: Float32Array;
  private pSerial: Uint32Array;
  alpha = 1;
  private realAcc = 0;
  private simAcc = 0;
  private lastGap = 1 / 60;
  readonly speed: Float32Array;
  /** 1 while braking hard / stopped (for brake lights). */
  readonly braking: Uint8Array;
  /** Turn signal: -1 left, 1 right, 0 off. */
  readonly indicator: Int8Array;
  /** Why the vehicle is held up, if it is. */
  readonly held: Uint8Array;
  /** Incremented each time a slot is reused (lets the UI notice a vehicle is gone). */
  readonly serial: Uint32Array;
  /** Seconds left standing still (buses at stops). */
  readonly hold: Float32Array;
  /** End-of-trip parking state (Park). */
  readonly park: Uint8Array;
  /** 1 while visible; falls to 0 as a parked car fades away. */
  readonly fade: Float32Array;
  /** Destination building of each vehicle (0 = none). */
  readonly dest: Int32Array;
  private parkT: Float32Array;
  private latTarget: Float32Array;
  /** Driveway spot (x, z, heading) for vehicles pulling in. */
  private spot: Float32Array;
  /** Where a vehicle arriving at a building can park off the road (an empty driveway), if anywhere. */
  arrivalSpot: ((buildingId: number) => { x: number; z: number; rot: number } | null) | null = null;
  /** A car has parked near the camera: its driver gets out. */
  onParked: ((i: number, x: number, z: number, heading: number, buildingId: number, purpose: Purpose) => void) | null = null;
  parked = 0;
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
  private dtAcc: Float32Array;
  // Temperament.
  private vfac: Float32Array;
  private headway: Float32Array;
  private amax: Float32Array;
  private bcomf: Float32Array;
  private gapMin: Float32Array;
  private polite: Float32Array;
  private patience: Float32Array;
  private alat: Float32Array;
  private gapK: Float32Array;
  // Lane changes.
  private lat: Float32Array;
  private lcTarget: Int8Array;
  private lcTimer: Float32Array;
  private lcCool: Float32Array;
  // Junction plan and claim.
  private committed: Uint8Array;
  private planKey: Int32Array;
  private nextLane: Uint8Array;
  private vTurn: Float32Array;
  private claimNode: Int32Array;
  private claimIn: Int32Array;
  private claimOut: Int32Array;
  /** Lane a claim was made from. */
  private claimLane: Uint8Array;
  private yieldPend: Uint8Array;
  private waitT: Float32Array;
  private fromKey: Int32Array;
  private reserved: Int32Array;
  private vCurve: Float32Array;
  private rerouteCool: Float32Array;
  private anchorD: Float32Array;
  private gateWas: Uint8Array;
  private gateLeg: Int32Array;
  private anchorLeg: Int32Array;
  private callbacks = new Map<number, () => void>();
  private continuations = new Map<number, (i: number) => { route: Route; dwell: number } | null>();
  private free: number[] = [];
  private lanes = new Map<number, number[]>();
  /** Total length of the vehicles about to turn into each lane. */
  private incoming = new Map<number, number>();
  /** The last vehicle to leave each lane into a junction (followers keep their distance from it). */
  private lastOut = new Map<number, number>();
  private claims = new Map<number, number[]>();
  private junctions = new Map<number, Junction | null>();
  private junctionsVersion = -1;
  private pp: PolyPoint = { x: 0, z: 0, tx: 0, tz: 0, i: 0 };
  private frame = 0;
  count = 0;
  /** Everyone's speed scales with the weather. */
  speedScale = 1;
  /** Vehicles beyond this radius from the focus point are updated at reduced rate. */
  lodX = 0;
  lodZ = 0;
  lodRadius = 900;
  /** Vehicles further than this (along either axis) from the focus aren't drawn. */
  hiddenBeyond = 1600;
  /**
   * Set by the renderer: whether a point is on screen. Cars off screen (more than a short way
   * from the camera) step at the distant rate, as nobody can see the coarser steps.
   */
  inView: ((x: number, z: number) => boolean) | null = null;
  /** Camera position on the ground, for "a short way from the camera". */
  camX = 0;
  camZ = 0;
  /** Reroutes allowed this frame. */
  private rerouteBudget = 0;
  /** Finds a new way to a vehicle's destination from where it is, with that driver's knowledge of the roads. */
  replan: ((i: number, route: Route, leg: number, d: number, cost: (segId: number) => number) => Route | null) | null = null;
  /** Macro congestion as drivers know it (multiplier per segment). */
  knownCongestion: (segId: number) => number = () => 1;
  // People on the road (published by the pedestrians each frame).
  private crossers = new Float32Array(512);
  private crossN = 0;
  /** Zebra crossings with someone waiting to cross: x0, z0, x1, z1 each. */
  private zebras = new Float32Array(256);
  private zebraN = 0;
  /** Crossings with someone on them (x0, z0, x1, z1): nobody drives across one until it's clear. */
  private occ = new Float32Array(512);
  private occN = 0;
  private peopleX = 0;
  private peopleZ = 0;
  /** Stats. */
  despawnedStuck = 0;
  arrived = 0;
  rerouted = 0;
  laneChanges = 0;
  peopleStops = 0;
  givenWay = 0;

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
    this.px = new Float32Array(max);
    this.py = new Float32Array(max);
    this.pz = new Float32Array(max);
    this.ph = new Float32Array(max);
    this.pSerial = new Uint32Array(max);
    this.speed = new Float32Array(max);
    this.braking = new Uint8Array(max);
    this.indicator = new Int8Array(max);
    this.held = new Uint8Array(max);
    this.serial = new Uint32Array(max);
    this.hold = new Float32Array(max);
    this.park = new Uint8Array(max);
    this.fade = new Float32Array(max);
    this.dest = new Int32Array(max);
    this.parkT = new Float32Array(max);
    this.latTarget = new Float32Array(max);
    this.spot = new Float32Array(max * 3);
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
    this.dtAcc = new Float32Array(max);
    this.vfac = new Float32Array(max);
    this.headway = new Float32Array(max);
    this.amax = new Float32Array(max);
    this.bcomf = new Float32Array(max);
    this.gapMin = new Float32Array(max);
    this.polite = new Float32Array(max);
    this.patience = new Float32Array(max);
    this.alat = new Float32Array(max);
    this.gapK = new Float32Array(max);
    this.lat = new Float32Array(max);
    this.lcTarget = new Int8Array(max).fill(-1);
    this.lcTimer = new Float32Array(max);
    this.lcCool = new Float32Array(max);
    this.committed = new Uint8Array(max);
    this.planKey = new Int32Array(max).fill(-1);
    this.nextLane = new Uint8Array(max);
    this.vTurn = new Float32Array(max);
    this.claimNode = new Int32Array(max).fill(-1);
    this.claimIn = new Int32Array(max);
    this.claimOut = new Int32Array(max);
    this.claimLane = new Uint8Array(max);
    this.yieldPend = new Uint8Array(max);
    this.waitT = new Float32Array(max);
    this.fromKey = new Int32Array(max).fill(-1);
    this.reserved = new Int32Array(max).fill(-1);
    this.vCurve = new Float32Array(max);
    this.rerouteCool = new Float32Array(max);
    this.anchorD = new Float32Array(max);
    this.gateWas = new Uint8Array(max);
    this.gateLeg = new Int32Array(max).fill(-1);
    this.anchorLeg = new Int32Array(max);
    for (let i = max - 1; i >= 0; i--) this.free.push(i);
    signals.sense = (node, seg, out) => this.senseApproach(node, seg, out);
  }

  // ── Lanes ─────────────────────────────────────────────────────────────────

  private key(segId: number, dir: number, lane: number): number {
    return segId * 32 + (dir === 1 ? 0 : 16) + lane;
  }

  private legD(seg: RoadSegment, leg: RouteLeg, s: number): number {
    return leg.dir === 1 ? s : seg.length - s;
  }

  private entryTrim(seg: RoadSegment, leg: { dir: number }): number {
    return leg.dir === 1 ? seg.trimA : seg.trimB;
  }

  private exitTrim(seg: RoadSegment, leg: { dir: number }): number {
    return leg.dir === 1 ? seg.trimB : seg.trimA;
  }

  private exitNode(seg: RoadSegment, leg: { dir: number }): number {
    return leg.dir === 1 ? seg.b : seg.a;
  }

  /** Lanes each way (all lanes on a one-way road). */
  private lanesOf(seg: RoadSegment): number {
    return ROAD_TYPES[seg.type].lanes * (seg.oneway !== 0 ? 2 : 1);
  }

  private laneOff(seg: RoadSegment, lane: number): number {
    const rt = ROAD_TYPES[seg.type];
    if (lane === BIKE_LANE) return rt.asphaltHalf - 0.65;
    return seg.oneway !== 0 ? onewayLaneOffset(rt, lane) : laneOffset(rt, lane);
  }

  private half(i: number): number {
    return VEHICLE_LENGTH[this.model[i]] * 0.5;
  }

  /** The turn at the end of leg k: -1 left, 0 straight on, 1 right. */
  private turnAt(route: Route, k: number): number {
    if (k >= route.legs.length - 1) return 0;
    const leg = route.legs[k], next = route.legs[k + 1];
    const seg = this.net.segments.get(leg.segId);
    if (!seg) return 0;
    const J = this.junction(this.exitNode(seg, leg));
    if (J) {
      const m = this.movement(J, leg.segId, next.segId);
      if (m >= 0) return J.turn[m];
    }
    const nseg = this.net.segments.get(next.segId);
    if (!nseg) return 0;
    pointAt(seg.poly, leg.dir === 1 ? seg.length : 0, this.pp);
    const inx = this.pp.tx * leg.dir, inz = this.pp.tz * leg.dir;
    pointAt(nseg.poly, next.dir === 1 ? 0 : nseg.length, this.pp);
    const cross = inx * this.pp.tz * next.dir - inz * this.pp.tx * next.dir;
    return cross > 0.35 ? 1 : cross < -0.35 ? -1 : 0;
  }

  /** Lanes a driver on leg k is happy to be in: [lo, hi]. */
  private laneRange(route: Route, k: number, distToEnd: number, out: number[]): number[] {
    const seg = this.net.segments.get(route.legs[k].segId);
    const n = seg ? this.lanesOf(seg) : 1;
    out[0] = 0;
    out[1] = n - 1;
    if (n === 1) return out;
    if (k === route.legs.length - 1) {
      // Pull over to the kerb near the destination.
      if (distToEnd < 160) out[0] = n - 1;
      return out;
    }
    const t = this.turnAt(route, k);
    if (t > 0) out[0] = n - 1;
    else if (t < 0) out[1] = 0;
    return out;
  }

  private range = [0, 0];

  /** Lane to start leg k in, coming from lane `from` of the previous leg (or a fresh spawn). */
  private entryLane(route: Route, k: number, from: number, turn: number): number {
    if (from === BIKE_LANE) return BIKE_LANE;
    const seg = this.net.segments.get(route.legs[k].segId);
    if (!seg) return 0;
    const n = this.lanesOf(seg);
    let lane = turn > 0 ? n - 1 : turn < 0 ? 0 : Math.min(from, n - 1);
    // Too short to change lanes on: go straight into the lane needed next.
    const leg = route.legs[k];
    const len = k === route.legs.length - 1 ? Math.abs(leg.s1 - leg.s0) : seg.length - seg.trimA - seg.trimB;
    if (len < 120) {
      const r = this.laneRange(route, k, len, this.range);
      lane = Math.max(r[0], Math.min(r[1], lane));
    }
    return lane;
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

  /** In a lane's sorted list, the first vehicle at or beyond distance d. */
  private firstFrom(list: number[], d: number): number {
    let lo = 0, hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.d[list[mid]] < d) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // ── Spawning and removal ──────────────────────────────────────────────────

  spawn(sp: VehicleSpawn): number {
    if (!this.free.length) return -1;
    const route = sp.route;
    if (!route.legs.length) return -1;
    const leg0 = route.legs[0];
    const seg = this.net.segments.get(leg0.segId);
    if (!seg) return -1;
    const i = this.free[this.free.length - 1];
    const n = this.lanesOf(seg);
    const dEnd = route.legs.length === 1 ? this.legD(seg, leg0, leg0.s1) : seg.length - this.exitTrim(seg, leg0);
    const r = this.laneRange(route, 0, dEnd - this.legD(seg, leg0, leg0.s0), this.range);
    // Buses and stopping vehicles start at the kerb; others anywhere they're happy to be.
    const lane = sp.model === VM.bike ? BIKE_LANE : n === 1 ? 0 : Math.max(r[0], Math.min(r[1], sp.purpose === Purpose.Transit ? n - 1 : (i * 7) % n));
    const minD = this.entryTrim(seg, leg0) + 1;
    let d0 = this.legD(seg, leg0, leg0.s0);
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
    this.dest[i] = sp.dest ?? 0;
    this.park[i] = Park.None;
    this.fade[i] = 1;
    this.parkT[i] = 0;
    this.latTarget[i] = 0;
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
    this.lat[i] = 0;
    this.lcTarget[i] = -1;
    this.lcTimer[i] = 0;
    this.lcCool[i] = 2;
    this.indicator[i] = 0;
    this.held[i] = 0;
    this.committed[i] = 0;
    this.planKey[i] = -1;
    this.claimNode[i] = -1;
    this.yieldPend[i] = 0;
    this.reserved[i] = -1;
    this.fromKey[i] = -1;
    this.vCurve[i] = 99;
    this.rerouteCool[i] = 0;
    this.anchorLeg[i] = -9999;
    this.gateLeg[i] = -1;
    this.temperament(i, sp.model);
    if (sp.onArrive) this.callbacks.set(i, sp.onArrive);
    if (sp.next) this.continuations.set(i, sp.next);
    this.laneInsert(key, i);
    this.count++;
    this.place(i, seg, leg0);
    return i;
  }

  /** Each driver's own way of driving (heavy vehicles are slower to start and stop). */
  private temperament(i: number, model: number): void {
    const s = this.serial[i] * 4099 + i;
    const r = (k: number) => hash(s, k);
    // One "assertiveness" trait colours several habits; the rest vary independently.
    const bold = r(1);
    const heavy = HEAVY_MODEL[model];
    this.vfac[i] = 0.9 + bold * 0.14 + (r(2) - 0.5) * 0.08;
    this.headway[i] = (heavy ? 1.7 : 1.05) + (1 - bold) * 0.7 + r(3) * 0.2;
    this.amax[i] = (heavy ? 0.9 : 1.6) + bold * 0.9 + r(4) * 0.3;
    this.bcomf[i] = (heavy ? 1.6 : 2.0) + bold * 1.0;
    this.gapMin[i] = 1.6 + (1 - bold) * 1.0;
    this.polite[i] = 0.15 + (1 - bold) * 0.5;
    this.patience[i] = 18 + r(5) * 40;
    this.alat[i] = (heavy ? 1.5 : 2.0) + bold * 0.9;
    this.gapK[i] = 1.25 - bold * 0.4;
    if (model === VM.bus) this.vfac[i] = 0.92;
    if (model === VM.bike) {
      this.alat[i] = 1.6;
      this.gapMin[i] = 1.0;
      this.headway[i] = 0.8;
      this.amax[i] = 0.9 + bold * 0.4;
    }
  }

  private reserve(i: number, key: number): void {
    this.unreserve(i);
    this.reserved[i] = key;
    this.incoming.set(key, (this.incoming.get(key) ?? 0) + VEHICLE_LENGTH[this.model[i]] + 2);
  }

  private unreserve(i: number): void {
    const key = this.reserved[i];
    if (key < 0) return;
    const n = (this.incoming.get(key) ?? 0) - VEHICLE_LENGTH[this.model[i]] - 2;
    if (n <= 0.01) this.incoming.delete(key);
    else this.incoming.set(key, n);
    this.reserved[i] = -1;
  }

  /**
   * At the vehicle limit: takes the ordinary car farthest from the camera's focus off the map
   * (if it's well out of view), so busy roads where the player is looking can still fill up.
   */
  makeRoom(minDist = 900): boolean {
    let best = -1, bestD = minDist * minDist;
    for (let i = 0; i < this.max; i++) {
      if (!this.active[i] || this.callbacks.has(i) || this.continuations.has(i) || this.park[i] !== Park.None) continue;
      const p = this.purpose[i];
      if (p !== Purpose.Commute && p !== Purpose.Shopping && p !== Purpose.Visitor && p !== Purpose.Freight) continue;
      const dx = this.x[i] - this.lodX, dz = this.z[i] - this.lodZ;
      const d = dx * dx + dz * dz;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return false;
    this.despawn(best);
    return true;
  }

  despawn(i: number, arrived = false): void {
    if (!this.active[i]) return;
    this.laneRemove(i);
    this.unclaim(i);
    this.unreserve(i);
    this.turning[i] = 0;
    this.committed[i] = 0;
    this.park[i] = Park.None;
    this.hold[i] = 0;
    this.active[i] = 0;
    this.routes[i] = null;
    const cb = this.callbacks.get(i);
    this.callbacks.delete(i);
    this.continuations.delete(i);
    if (arrived && cb) cb();
    this.free.push(i);
    this.count--;
  }

  // ── Junctions ─────────────────────────────────────────────────────────────

  private junction(node: number): Junction | null {
    if (this.junctionsVersion !== this.layout.version) {
      this.junctions.clear();
      this.junctionsVersion = this.layout.version;
    }
    let J = this.junctions.get(node);
    if (J === undefined) {
      J = this.buildJunction(node);
      this.junctions.set(node, J);
    }
    return J;
  }

  private movement(J: Junction, inSeg: number, outSeg: number): number {
    const a = J.segs.indexOf(inSeg), b = J.segs.indexOf(outSeg);
    return a < 0 || b < 0 ? -1 : a * J.n + b;
  }

  private tmpA = { x: 0, z: 0, tx: 0, tz: 0 };
  private tmpB = { x: 0, z: 0, tx: 0, tz: 0 };

  /** Quadratic curve from the end of one lane to the start of another (control point where the lane lines meet). */
  private curve(a: { x: number; z: number; tx: number; tz: number }, b: { x: number; z: number; tx: number; tz: number }, out: Float32Array, o: number): number {
    let cx = (a.x + b.x) / 2;
    let cz = (a.z + b.z) / 2;
    const den = a.tx * b.tz - a.tz * b.tx;
    const chord = Math.hypot(b.x - a.x, b.z - a.z);
    if (Math.abs(den) > 0.05) {
      const t = ((b.x - a.x) * b.tz - (b.z - a.z) * b.tx) / den;
      const u = (a.tx * (b.z - a.z) - a.tz * (b.x - a.x)) / den;
      if (t > 0 && u > 0 && t < chord * 1.5) {
        cx = a.x + a.tx * t;
        cz = a.z + a.tz * t;
      }
    }
    out[o] = a.x;
    out[o + 1] = a.z;
    out[o + 2] = cx;
    out[o + 3] = cz;
    out[o + 4] = b.x;
    out[o + 5] = b.z;
    return Math.max(1, (Math.hypot(cx - a.x, cz - a.z) + Math.hypot(b.x - cx, b.z - cz) + chord) / 2);
  }

  private buildJunction(node: number): Junction | null {
    const lay = this.layout.get(node);
    if (!lay || lay.kind !== 'junction' || lay.arms.length < 3) return null;
    const net = this.net;
    const n = lay.arms.length;
    const segs = lay.arms.map((a) => a.segId);
    const M = n * n;
    const prio = new Int8Array(M).fill(-1);
    const turn = new Int8Array(M);
    const conflict = new Uint8Array(M * M);
    const waitT = new Float32Array(M);
    const signal = lay.control === 'signal';
    const roundabout = lay.control === 'roundabout';
    // The major road at junctions without lights: the two biggest arms (the straightest pair among equals).
    const major = new Uint8Array(n);
    if (!signal) {
      if (roundabout) {
        for (let a = 0; a < n; a++) major[a] = net.segments.get(segs[a])?.ring ? 1 : 0;
      } else {
        let best = -Infinity, bi = 0, bj = 1;
        for (let a = 0; a < n; a++) {
          for (let b = a + 1; b < n; b++) {
            const sa = net.segments.get(segs[a])!, sb = net.segments.get(segs[b])!;
            const dot = lay.arms[a].dx * lay.arms[b].dx + lay.arms[a].dz * lay.arms[b].dz;
            const score = segmentCapacity(ROAD_TYPES[sa.type]) + segmentCapacity(ROAD_TYPES[sb.type]) - dot * 200;
            if (score > best) {
              best = score;
              bi = a;
              bj = b;
            }
          }
        }
        major[bi] = major[bj] = 1;
      }
    }
    // Paths through the junction, sampled.
    const pts: Float32Array[][] = [];
    const lens: number[][] = [];
    const bez = new Float32Array(6);
    for (let a = 0; a < n; a++) {
      const sa = net.segments.get(segs[a])!;
      const dirIn = lay.arms[a].atA ? -1 : 1;
      const inOk = sa.oneway === 0 || sa.oneway === dirIn;
      for (let b = 0; b < n; b++) {
        const m = a * n + b;
        pts[m] = [];
        lens[m] = [];
        const sb = net.segments.get(segs[b])!;
        const dirOut = lay.arms[b].atA ? 1 : -1;
        if (a === b || !inOk || !(sb.oneway === 0 || sb.oneway === dirOut)) continue;
        // Turn direction from the lane tangents.
        this.lanePos(sa, dirIn, 0, sa.length - this.exitTrim(sa, { dir: dirIn }), this.tmpA);
        this.lanePos(sb, dirOut, 0, this.entryTrim(sb, { dir: dirOut }), this.tmpB);
        const cross = this.tmpA.tx * this.tmpB.tz - this.tmpA.tz * this.tmpB.tx;
        const t = cross > 0.35 ? 1 : cross < -0.35 ? -1 : 0;
        turn[m] = t;
        prio[m] = signal ? (t < 0 ? 1 : 2) : major[a] ? (t < 0 && !roundabout ? 1 : 2) : 0;
        const nIn = this.lanesOf(sa), nOut = this.lanesOf(sb);
        const pairs: [number, number][] = t > 0 ? [[nIn - 1, nOut - 1]] : t < 0 ? [[0, 0]] : Array.from({ length: nIn }, (_, k) => [k, Math.min(k, nOut - 1)] as [number, number]);
        for (const [li, lo] of pairs) {
          this.lanePos(sa, dirIn, li, sa.length - this.exitTrim(sa, { dir: dirIn }), this.tmpA);
          this.lanePos(sb, dirOut, lo, this.entryTrim(sb, { dir: dirOut }), this.tmpB);
          const len = this.curve(this.tmpA, this.tmpB, bez, 0);
          const s = new Float32Array((SAMPLES + 1) * 2);
          for (let k = 0; k <= SAMPLES; k++) {
            const u = k / SAMPLES, w = 1 - u;
            s[k * 2] = w * w * bez[0] + 2 * w * u * bez[2] + u * u * bez[4];
            s[k * 2 + 1] = w * w * bez[1] + 2 * w * u * bez[3] + u * u * bez[5];
          }
          pts[m].push(s);
          lens[m].push(len);
        }
      }
    }
    const c2 = CONFLICT_DIST * CONFLICT_DIST;
    // First sample of path p (any lane) within reach of path q, or -1.
    const firstNear = (p: number, q: number): number => {
      let first = -1;
      for (const sp of pts[p]) {
        for (let k = 0; k <= SAMPLES; k++) {
          if (first >= 0 && k >= first) break;
          const x = sp[k * 2], z = sp[k * 2 + 1];
          let hit = false;
          for (const sq of pts[q]) {
            for (let l = 0; l <= SAMPLES && !hit; l++) if ((sq[l * 2] - x) ** 2 + (sq[l * 2 + 1] - z) ** 2 < c2) hit = true;
            if (hit) break;
          }
          if (hit) {
            first = k;
            break;
          }
        }
      }
      return first;
    };
    for (let p = 0; p < M; p++) {
      if (prio[p] < 0) continue;
      for (let q = p + 1; q < M; q++) {
        if (prio[q] < 0) continue;
        // Paths from the same arm follow one another rather than cross.
        if (Math.floor(p / n) === Math.floor(q / n)) continue;
        if (firstNear(p, q) >= 0) conflict[p * M + q] = conflict[q * M + p] = 1;
      }
    }
    // Where permissive turners wait: short of the first path they must give way to.
    for (let p = 0; p < M; p++) {
      if (prio[p] !== 1) continue;
      let first = SAMPLES + 1;
      const pa = lay.arms[Math.floor(p / n)];
      for (let q = 0; q < M; q++) {
        if (prio[q] !== 2 || !conflict[p * M + q]) continue;
        // Oncoming traffic only (cross traffic is held by the lights, or gives way to us).
        const qa = lay.arms[Math.floor(q / n)];
        if (pa.dx * qa.dx + pa.dz * qa.dz > -0.5) continue;
        const k = firstNear(p, q);
        if (k >= 0) first = Math.min(first, k);
      }
      const len = lens[p][0] ?? 10;
      const t = first > SAMPLES ? 0 : first / SAMPLES - 3 / len;
      waitT[p] = t > 0.18 ? t : 0;
    }
    return { node, n, segs, prio, turn, conflict, waitT, signal, roundabout, dx: Float32Array.from(lay.arms, (a) => a.dx), dz: Float32Array.from(lay.arms, (a) => a.dz) };
  }

  private claim(i: number, node: number, inSeg: number, outSeg: number): void {
    this.unclaim(i);
    this.claimNode[i] = node;
    this.claimIn[i] = inSeg;
    this.claimOut[i] = outSeg;
    this.claimLane[i] = this.lane[i];
    let list = this.claims.get(node);
    if (!list) {
      list = [];
      this.claims.set(node, list);
    }
    list.push(i);
  }

  private unclaim(i: number): void {
    const node = this.claimNode[i];
    if (node < 0) return;
    const list = this.claims.get(node);
    if (list) {
      const k = list.indexOf(i);
      if (k >= 0) list.splice(k, 1);
      if (!list.length) this.claims.delete(node);
    }
    this.claimNode[i] = -1;
    this.yieldPend[i] = 0;
  }

  /** Does vehicle i's claim conflict with another claim already in the junction? (Turners waiting to give way to us don't count.) */
  private claimBlocked(i: number, J: Junction, m: number, prio: number): boolean {
    const list = this.claims.get(J.node);
    if (!list) return false;
    const M = J.n * J.n;
    for (const c of list) {
      if (c === i) continue;
      const mc = this.movement(J, this.claimIn[c], this.claimOut[c]);
      if (mc < 0) return true;
      if (mc === m) {
        // Only one at a time waits inside the junction to turn.
        if (this.yieldPend[c] && !this.turning[i]) return true;
        continue;
      }
      if (this.claimIn[c] === J.segs[Math.floor(m / J.n)]) {
        // From the same road: only a problem if one cuts across the other's lane.
        const dl = this.lane[i] - this.claimLane[c], dt = J.turn[m] - J.turn[mc];
        if (dl * dt < 0 || (dl === 0 && dt !== 0 && this.turning[c] && this.tT[c] < 0.3)) return true;
        continue;
      }
      if (!J.conflict[m * M + mc]) continue;
      // A turner waiting for a gap waits clear of oncoming traffic (not of cross traffic).
      if (this.yieldPend[c] && J.prio[mc] < prio) {
        const a = Math.floor(m / J.n), b = Math.floor(mc / J.n);
        if (J.dx[a] * J.dx[b] + J.dz[a] * J.dz[b] < -0.5) continue;
      }
      return true;
    }
    return false;
  }

  /** Is higher-priority traffic coming that vehicle i (making movement m) must let by? */
  private threat(i: number, J: Junction, m: number, prio: number): boolean {
    const M = J.n * J.n;
    const net = this.net;
    const t = J.turn[m];
    // The longer they've waited, the smaller the gap drivers will take.
    const accept = (prio === 0 ? (t > 0 ? 4.2 : 5.2) : 4.4) * this.gapK[i] * Math.max(0.6, 1 - this.wait[i] / (this.patience[i] * 3));
    const inArm = Math.floor(m / J.n);
    for (let a = 0; a < J.n; a++) {
      if (a === inArm) continue;
      const seg = net.segments.get(J.segs[a]);
      if (!seg) continue;
      const dirInto = seg.b === J.node ? 1 : -1;
      if (seg.oneway !== 0 && seg.oneway !== dirInto) continue;
      // Could anything from this arm have right of way over us?
      let any = false;
      for (let b = 0; b < J.n && !any; b++) {
        const q = a * J.n + b;
        if (J.prio[q] > prio && J.conflict[m * M + q]) any = true;
      }
      if (!any) continue;
      const stop = seg.length - this.exitTrim(seg, { dir: dirInto });
      const nl = this.lanesOf(seg);
      for (let lane = 0; lane < nl; lane++) {
        const list = this.lanes.get(this.key(seg.id, dirInto, lane));
        if (!list) continue;
        for (let k = list.length - 1, seen = 0; k >= 0 && seen < 4; k--, seen++) {
          const j = list[k];
          const dist = stop - this.d[j];
          if (dist > 110) break;
          const v = this.speed[j];
          if (v < 0.6 && dist > 4) continue;
          if (dist / Math.max(v, 2) > accept) continue;
          const r = this.routes[j]!;
          const lj = this.leg[j];
          if (lj >= r.legs.length - 1) continue;
          const q = this.movement(J, seg.id, r.legs[lj + 1].segId);
          if (q < 0 || J.prio[q] <= prio || !J.conflict[m * M + q]) continue;
          if (J.signal && !this.signals.isGreen(J.node, seg.id, turnName(J.turn[q]))) continue;
          return true;
        }
      }
    }
    return false;
  }

  /** Can circulating traffic let vehicle i onto the roundabout at `node`? */
  private ringClear(node: number): boolean {
    const lay = this.layout.get(node);
    if (!lay) return true;
    for (const a of lay.arms) {
      const s = this.net.segments.get(a.segId);
      if (!s || !s.ring) continue;
      const dirInto = s.b === node ? 1 : -1;
      if (s.oneway !== 0 && s.oneway !== dirInto) continue;
      const lanes = this.lanesOf(s);
      const stop = s.length - (dirInto === 1 ? s.trimB : s.trimA);
      for (let lane = 0; lane < lanes; lane++) {
        const list = this.lanes.get(this.key(s.id, dirInto, lane));
        if (!list || !list.length) continue;
        const lead = list[list.length - 1];
        if (stop - this.d[lead] < 16 && this.speed[lead] > 0.5) return false;
      }
    }
    return true;
  }

  /** Detector reading for a signal approach. */
  private senseApproach(node: number, segId: number, out: Sense): void {
    out.near = 0;
    out.left = 0;
    const seg = this.net.segments.get(segId);
    if (!seg) return;
    const dirInto = seg.b === node ? 1 : -1;
    if (seg.oneway !== 0 && seg.oneway !== dirInto) return;
    const stop = seg.length - this.exitTrim(seg, { dir: dirInto });
    const J = this.junction(node);
    const nl = this.lanesOf(seg);
    for (let lane = 0; lane < nl; lane++) {
      const list = this.lanes.get(this.key(seg.id, dirInto, lane));
      if (!list) continue;
      for (let k = list.length - 1; k >= 0; k--) {
        const j = list[k];
        const dist = stop - this.d[j];
        if (dist > 60) break;
        if (this.park[j] === Park.Parked) continue;
        // Moving toward the line in time to use the green, or waiting at it.
        if (this.speed[j] < 0.5 && dist > 45) continue;
        out.near++;
        const r = this.routes[j]!;
        const lj = this.leg[j];
        if (J && lj < r.legs.length - 1) {
          const m = this.movement(J, segId, r.legs[lj + 1].segId);
          if (m >= 0 && J.turn[m] < 0) out.left++;
        }
      }
    }
  }

  // ── Movement ──────────────────────────────────────────────────────────────

  private lanePos(seg: RoadSegment, dir: number, lane: number, d: number, out: { x: number; z: number; tx: number; tz: number }): void {
    const s = dir === 1 ? d : seg.length - d;
    pointAt(seg.poly, s, this.pp);
    const tx = this.pp.tx * dir;
    const tz = this.pp.tz * dir;
    const off = this.laneOff(seg, lane);
    out.x = this.pp.x - tz * off;
    out.z = this.pp.z + tx * off;
    out.tx = tx;
    out.tz = tz;
  }

  private place(i: number, seg: RoadSegment, leg: RouteLeg): void {
    this.lanePos(seg, leg.dir, this.lane[i], this.d[i], this.tmpA);
    const a = this.tmpA;
    const lat = this.lat[i];
    this.x[i] = a.x - a.tz * lat;
    this.z[i] = a.z + a.tx * lat;
    // Angled slightly while moving across.
    const drift = lat !== 0 && this.speed[i] > 0.5 ? Math.max(-0.25, Math.min(0.25, (-Math.sign(lat) * Math.min(1.1, Math.abs(lat) + 0.3)) / Math.max(3, this.speed[i]))) : 0;
    this.heading[i] = Math.atan2(a.tz, a.tx) + drift;
    this.y[i] = this.terrain.roadHeightAt(this.x[i], this.z[i]) + 0.12 + (seg.raised ? raisedLift(this.net, seg, leg.dir === 1 ? this.d[i] : seg.length - this.d[i]) : 0);
  }

  /** Works out the path through the junction at the end of the current leg (and the lane it leads into). */
  private planTurn(i: number, seg: RoadSegment, route: Route, k: number): void {
    const pk = k * 16 + this.lane[i];
    if (this.planKey[i] === pk) return;
    this.planKey[i] = pk;
    const leg = route.legs[k];
    const next = route.legs[k + 1];
    const nseg = this.net.segments.get(next.segId)!;
    const turn = this.turnAt(route, k);
    const nl = this.entryLane(route, k + 1, this.lane[i], turn);
    this.nextLane[i] = nl;
    this.lanePos(seg, leg.dir, this.lane[i], this.dEnd[i], this.tmpA);
    const a = this.tmpA, b = this.tmpB;
    this.lanePos(nseg, next.dir, nl, this.entryTrim(nseg, next), b);
    this.tLen[i] = this.curve(a, b, this.tp, i * 6);
    // Speed for the bend: from its radius and how hard this driver takes corners.
    const ang = Math.acos(Math.max(-1, Math.min(1, a.tx * b.tx + a.tz * b.tz)));
    const chord = Math.hypot(b.x - a.x, b.z - a.z);
    const vmax = this.model[i] === VM.bike ? 5 * this.speedScale : Math.min(ROAD_TYPES[seg.type].speed, ROAD_TYPES[nseg.type].speed) * this.vfac[i] * this.speedScale;
    this.vTurn[i] = ang < 0.12 ? vmax : Math.max(3.2, Math.min(vmax, Math.sqrt(this.alat[i] * (chord / (2 * Math.sin(ang / 2))))));
  }

  /**
   * Advances by `dt` of simulated time. Given the real time too (`realDt`), steps at most
   * STEP_HZ times a real second, however fast frames come, and drawing interpolates between.
   */
  update(dt: number, realDt?: number): void {
    if (realDt === undefined) {
      this.step(dt);
      this.alpha = 1;
      return;
    }
    this.realAcc += realDt;
    this.simAcc += dt;
    if (this.realAcc < 1 / STEP_HZ) {
      this.alpha = Math.min(1, this.realAcc / this.lastGap);
      return;
    }
    for (let i = 0; i < this.max; i++) {
      if (!this.active[i]) continue;
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
      this.pz[i] = this.z[i];
      this.ph[i] = this.heading[i];
      this.pSerial[i] = this.serial[i];
    }
    this.step(this.simAcc);
    // Slow frames: no interpolation (each frame steps, drawn where it is).
    this.lastGap = this.realAcc;
    this.alpha = this.realAcc > 1.5 / STEP_HZ ? 1 : 0;
    this.realAcc = 0;
    this.simAcc = 0;
  }

  /** Where vehicle `i` is drawn this frame (between its last two steps). */
  drawnX(i: number): number {
    return this.pSerial[i] !== this.serial[i] ? this.x[i] : this.px[i] + (this.x[i] - this.px[i]) * this.alpha;
  }
  drawnY(i: number): number {
    return this.pSerial[i] !== this.serial[i] ? this.y[i] : this.py[i] + (this.y[i] - this.py[i]) * this.alpha;
  }
  drawnZ(i: number): number {
    return this.pSerial[i] !== this.serial[i] ? this.z[i] : this.pz[i] + (this.z[i] - this.pz[i]) * this.alpha;
  }
  drawnHeading(i: number): number {
    if (this.pSerial[i] !== this.serial[i]) return this.heading[i];
    let d = this.heading[i] - this.ph[i];
    d = Math.atan2(Math.sin(d), Math.cos(d));
    return this.ph[i] + d * this.alpha;
  }

  private step(dt: number): void {
    if (dt <= 0) return;
    this.frame++;
    this.rerouteBudget = 3;
    const lodR2 = this.lodRadius * this.lodRadius;
    // Distant vehicles skip frames, but never so many that a catch-up step exceeds half a second (no lost time).
    const farMask = dt * 4 <= 0.5 ? 3 : dt * 2 <= 0.5 ? 1 : 0;
    // (Up to 0.8 s for those out of sight, where nobody sees the coarser steps.)
    const hideMask = dt * 8 <= 0.8 ? 7 : dt * 4 <= 0.8 ? 3 : farMask;
    for (let i = 0; i < this.max; i++) {
      if (!this.active[i]) continue;
      let step = dt + this.dtAcc[i];
      const dx = this.x[i] - this.lodX;
      const dz = this.z[i] - this.lodZ;
      const cx = this.x[i] - this.camX, cz = this.z[i] - this.camZ;
      const far = dx * dx + dz * dz > lodR2 || (this.inView !== null && cx * cx + cz * cz > 80 * 80 && !this.inView(this.x[i], this.z[i]));
      // Out of sight altogether (beyond the drawn area): less often still.
      const hidden = far && Math.max(Math.abs(dx), Math.abs(dz)) > this.hiddenBeyond;
      if (far && ((this.frame + i) & (hidden ? hideMask : farMask)) !== 0) {
        this.dtAcc[i] = step;
        continue;
      }
      this.dtAcc[i] = 0;
      // Distant vehicles move in coarser steps (but keep up).
      const cap = hidden ? 0.8 : far ? 0.5 : 0.25;
      if (step > cap) step = cap;
      if (this.park[i] === Park.PullingIn || this.park[i] === Park.Parked) this.updatePark(i, step);
      else if (this.turning[i]) this.updateTurn(i, step);
      else this.updateDrive(i, step);
    }
  }

  private oInter = 0;
  private oStop = Infinity;

  /**
   * Takes account of something `s` metres ahead (bumper to bumper, or to a stop point
   * plus the usual gap) moving at `vl`: follow it if it's moving; if it's standing
   * still, brake for it along a comfortable stopping curve (no creeping up at the end).
   */
  private see(i: number, v: number, s: number, vl: number): void {
    if (vl < 0.3) this.oStop = Math.min(this.oStop, this.stopA(i, v, s - this.gapMin[i]));
    else this.oInter = Math.max(this.oInter, this.inter(i, v, s, vl));
  }

  /** Inside a junction, whoever is right in front, whichever way they're going. */
  private seeInJunction(i: number, node: number, v: number): void {
    const list = this.claims.get(node);
    if (!list) return;
    const hx = Math.cos(this.heading[i]), hz = Math.sin(this.heading[i]);
    const half = this.half(i);
    for (const c of list) {
      if (c === i) continue;
      const rx = this.x[c] - this.x[i], rz = this.z[c] - this.z[i];
      const along = rx * hx + rz * hz;
      if (along <= 0 || along > 14) continue;
      if (Math.abs(-rx * hz + rz * hx) > 2.1) continue;
      // Only if they're ahead of us from their point of view too (never both waiting on each other).
      if (rx * Math.cos(this.heading[c]) + rz * Math.sin(this.heading[c]) < 0) continue;
      const vc = this.speed[c] * Math.max(0, Math.cos(this.heading[c] - this.heading[i]));
      this.see(i, v, along - half - this.half(c), vc);
    }
  }

  /** Acceleration to come to a halt `g` metres on. */
  private stopA(i: number, v: number, g: number): number {
    if (g <= 0.05) return v > 0.05 ? -MAX_BRAKE : 0;
    const vs = Math.sqrt(2 * this.bcomf[i] * 0.7 * g);
    return Math.max(-MAX_BRAKE, Math.min(this.amax[i], (vs - v) * 1.5));
  }

  /** IDM interaction term for an obstacle `s` metres ahead moving at `vl`. */
  private inter(i: number, v: number, s: number, vl: number): number {
    const sStar = this.gapMin[i] + Math.max(0, v * this.headway[i] + (v * (v - vl)) / (2 * Math.sqrt(this.amax[i] * this.bcomf[i])));
    const q = sStar / Math.max(0.05, s);
    return q * q;
  }

  private accel(i: number, v: number, v0: number, inter: number): number {
    const r = v0 > 0.05 ? v / v0 : v > 0.05 ? 10 : 0;
    const a = this.amax[i] * (1 - r * r * r * r - inter);
    return Math.max(-MAX_BRAKE, a);
  }

  private flashing(i: number): boolean {
    const p = this.purpose[i], m = this.model[i];
    return p === Purpose.Emergency || (p === Purpose.Service && (m === VM.firetruck || m === VM.police || m === VM.ambulance));
  }

  /** Whether vehicle i may cross the junction at the end of leg k now, and if not, why not. */
  private gate(i: number, seg: RoadSegment, route: Route, k: number, stopLine: number): Held {
    const leg = route.legs[k];
    const next = route.legs[k + 1];
    const nseg = this.net.segments.get(next.segId);
    if (!nseg) return Held.Full;
    const node = this.exitNode(seg, leg);
    // Room on the other side (don't block the junction).
    const nkey = this.key(nseg.id, next.dir, this.nextLane[i]);
    const tailList = this.lanes.get(nkey);
    // Room for the car clear of the crosswalk on the far side too (never stopped across it).
    const cwOut = hasCrosswalk(this.layout, node, nseg) ? CROSSWALK_INSET + 1.8 : 0;
    const need = (this.incoming.get(nkey) ?? 0) - (this.reserved[i] === nkey ? VEHICLE_LENGTH[this.model[i]] + 2 : 0) + VEHICLE_LENGTH[this.model[i]] + 2 + cwOut;
    if (tailList && tailList.length) {
      const tail = tailList[0];
      // A standing queue blocks the way out; traffic driving off doesn't.
      const space = this.d[tail] - this.half(tail) - this.entryTrim(nseg, next);
      // (Where there's a crosswalk beyond, only with room to stop clear of it whatever happens ahead.)
      if (space < need - (this.speed[tail] > 2 && !cwOut ? Math.min(need - 2, this.speed[tail] * 2) : 0)) return Held.Full;
    } else if (need > nseg.length - nseg.trimA - nseg.trimB + VEHICLE_LENGTH[this.model[i]] + 4) return Held.Full;
    const J = this.junction(node);
    const lay = this.layout.get(node);
    if (!J) {
      if (lay && lay.control === 'roundabout' && !seg.ring && !this.ringClear(node)) return Held.GiveWay;
      return Held.None;
    }
    const m = this.movement(J, seg.id, nseg.id);
    if (m < 0 || J.prio[m] < 0) return Held.None;
    // Lights a few metres apart work as one: traffic that came through the first carries on through the second (giving way to anything crossing).
    const linked = J.signal && this.linkedSignals(seg);
    const prio = linked ? 0 : J.prio[m];
    const emergency = this.flashing(i);
    if (J.signal && !emergency && !linked) {
      if (!this.signals.isGreen(node, seg.id, turnName(J.turn[m]))) return Held.Red;
      if (this.signals.isAmber(node, seg.id)) {
        // Stop if there's room to do it comfortably; otherwise carry on.
        const room = stopLine - this.d[i];
        const v = this.speed[i];
        if (room > 0.5 && (v * v) / (2 * room) < this.bcomf[i] * 1.3) return Held.Red;
      }
    }
    if (J.roundabout && !seg.ring && !this.ringClear(node)) return Held.GiveWay;
    if (this.claimBlocked(i, J, m, prio)) return Held.GiveWay;
    // Someone crossing where we'd turn into: wait behind the line rather than on the crossing.
    if (this.peopleOnCurve(i, 0, 0) < 40) return Held.People;
    const protectedTurn = J.signal && this.signals.arrowOn(node, seg.id);
    // Permissive turners with somewhere to wait go in and wait there; others wait at the line.
    if (prio < 2 && !protectedTurn && !(prio === 1 && J.waitT[m] > 0) && !(emergency && this.wait[i] > 2)) {
      if (this.threat(i, J, m, prio) && this.wait[i] < Math.min(60, this.patience[i] * 2.5)) return Held.GiveWay;
    }
    return Held.None;
  }

  /** A short link between two junctions with lights. */
  private linkedSignals(seg: RoadSegment): boolean {
    if (seg.length - seg.trimA - seg.trimB > 30) return false;
    return this.layout.get(seg.a)?.control === 'signal' && this.layout.get(seg.b)?.control === 'signal';
  }

  private commit(i: number, seg: RoadSegment, route: Route, k: number): void {
    this.committed[i] = 1;
    const leg = route.legs[k], next = route.legs[k + 1];
    const node = this.exitNode(seg, leg);
    const nseg = this.net.segments.get(next.segId)!;
    this.reserve(i, this.key(nseg.id, next.dir, this.nextLane[i]));
    const J = this.junction(node);
    if (!J) return;
    const m = this.movement(J, seg.id, nseg.id);
    if (m < 0) return;
    this.claim(i, node, seg.id, nseg.id);
    const protectedTurn = J.signal && this.signals.arrowOn(node, seg.id);
    this.yieldPend[i] = J.prio[m] === 1 && J.waitT[m] > 0 && !protectedTurn ? 1 : 0;
    this.waitT[i] = J.waitT[m];
  }

  private beginTurn(i: number, seg: RoadSegment, route: Route, k: number): void {
    const leg = route.legs[k];
    const next = route.legs[k + 1];
    const nseg = this.net.segments.get(next.segId)!;
    if (!this.committed[i]) this.commit(i, seg, route, k);
    this.fromKey[i] = this.laneKey[i];
    this.lastOut.set(this.laneKey[i], i);
    this.laneRemove(i);
    this.turning[i] = 1;
    this.tT[i] = 0;
    this.lat[i] = 0;
    const node = this.exitNode(seg, leg);
    this.turnNode[i] = node;
    this.leg[i] = k + 1;
    this.lane[i] = this.nextLane[i];
    this.d[i] = this.entryTrim(nseg, next);
    const last = k + 1 === route.legs.length - 1;
    this.dEnd[i] = last ? this.legD(nseg, next, next.s1) : nseg.length - this.exitTrim(nseg, next);
    this.lcTarget[i] = -1;
    this.lcTimer[i] = 0;
    this.lcCool[i] = 1.5;
  }

  /** Nearest person (or waiting zebra crossing) on the path ahead, as a distance from the front bumper. */
  private peopleAhead(i: number, extra: number): number {
    if (!this.crossN && !this.zebraN && !this.occN) return Infinity;
    const x = this.x[i], z = this.z[i];
    if ((x - this.peopleX) ** 2 + (z - this.peopleZ) ** 2 > PEOPLE_RANGE * PEOPLE_RANGE) return Infinity;
    const hx = Math.cos(this.heading[i]), hz = Math.sin(this.heading[i]);
    const half = this.half(i);
    let best = Infinity;
    const reach = 34 + extra;
    for (let p = 0; p < this.crossN; p++) {
      const rx = this.crossers[p * 2] - x, rz = this.crossers[p * 2 + 1] - z;
      const along = rx * hx + rz * hz;
      if (along < half - 0.5 || along > reach) continue;
      const side = Math.abs(-rx * hz + rz * hx);
      if (side > 2.5 + along * 0.04) continue;
      best = Math.min(best, along - half - 1.4);
    }
    // A crossing with someone on it: wait short of it until it's clear.
    for (let q = 0; q < this.occN; q++) {
      const t = rayHit(hx, hz, this.occ[q * 4] - x, this.occ[q * 4 + 1] - z, this.occ[q * 4 + 2] - x, this.occ[q * 4 + 3] - z);
      if (t > half && t < reach) best = Math.min(best, t - half - 1.6);
    }
    // Someone waiting at a zebra on our way: stop for them if we comfortably can.
    const v = this.speed[i];
    for (let p = 0; p < this.zebraN; p++) {
      const o = p * 4;
      const ax = this.zebras[o] - x, az = this.zebras[o + 1] - z, bx = this.zebras[o + 2] - x, bz = this.zebras[o + 3] - z;
      // Ray (0..reach along h) against segment a–b.
      const ex = bx - ax, ez = bz - az;
      const den = hx * ez - hz * ex;
      if (Math.abs(den) < 1e-4) continue;
      const t = (ax * ez - az * ex) / den;
      const u = (ax * hz - az * hx) / den;
      if (u < 0 || u > 1 || t < half || t > reach) continue;
      const s = t - half - 2.2;
      if (s < 1 && v > 1) continue;
      if ((v * v) / (2 * Math.max(0.5, s)) > this.bcomf[i] * 1.2) continue;
      best = Math.min(best, s);
    }
    return best;
  }

  /** Same, along the rest of the curve through a junction (and the first metres beyond). */
  private peopleOnCurve(i: number, fromT: number, before: number): number {
    if (!this.crossN && !this.zebraN && !this.occN) return Infinity;
    const o = i * 6, p = this.tp;
    if ((p[o + 4] - this.peopleX) ** 2 + (p[o + 5] - this.peopleZ) ** 2 > PEOPLE_RANGE * PEOPLE_RANGE) return Infinity;
    const len = this.tLen[i];
    const half = this.half(i);
    let best = Infinity;
    const steps = 6;
    // End tangent, to look a little way past the curve (crosswalks are just beyond it).
    const ex = p[o + 4] - p[o + 2], ez = p[o + 5] - p[o + 3];
    const el = Math.hypot(ex, ez) || 1;
    for (let q = 0; q < this.crossN; q++) {
      const cx = this.crossers[q * 2], cz = this.crossers[q * 2 + 1];
      for (let k = 0; k <= steps + 2; k++) {
        let x: number, z: number, s: number;
        if (k <= steps) {
          const t = fromT + ((1 - fromT) * k) / steps, w = 1 - t;
          x = w * w * p[o] + 2 * w * t * p[o + 2] + t * t * p[o + 4];
          z = w * w * p[o + 1] + 2 * w * t * p[o + 3] + t * t * p[o + 5];
          s = (t - fromT) * len;
        } else {
          const e = (k - steps) * 3.5;
          x = p[o + 4] + (ex / el) * e;
          z = p[o + 5] + (ez / el) * e;
          s = (1 - fromT) * len + e;
        }
        // (Wide: stop before the crossing, not just short of the nearest person on it.)
        if ((x - cx) ** 2 + (z - cz) ** 2 < 3.2 * 3.2) {
          best = Math.min(best, before + s - half - 0.8);
          break;
        }
      }
    }
    // Crossings with people on them that the way through cuts across: stop short of the whole crossing.
    if (this.occN) {
      let px = 0, pz = 0, ps = 0;
      for (let k = 0; k <= steps + 2; k++) {
        let x: number, z: number, s: number;
        if (k <= steps) {
          const t = fromT + ((1 - fromT) * k) / steps, w = 1 - t;
          x = w * w * p[o] + 2 * w * t * p[o + 2] + t * t * p[o + 4];
          z = w * w * p[o + 1] + 2 * w * t * p[o + 3] + t * t * p[o + 5];
          s = (t - fromT) * len;
        } else {
          const e = (k - steps) * 3.5;
          x = p[o + 4] + (ex / el) * e;
          z = p[o + 5] + (ez / el) * e;
          s = (1 - fromT) * len + e;
        }
        if (k > 0) {
          const dx = x - px, dz = z - pz, dl = Math.hypot(dx, dz) || 1;
          for (let q = 0; q < this.occN; q++) {
            const t = rayHit(dx / dl, dz / dl, this.occ[q * 4] - px, this.occ[q * 4 + 1] - pz, this.occ[q * 4 + 2] - px, this.occ[q * 4 + 3] - pz);
            if (t >= 0 && t <= dl) best = Math.min(best, before + ps + t - half - 1.6);
          }
        }
        px = x;
        pz = z;
        ps = s;
      }
    }
    return best;
  }

  private updateTurn(i: number, dt: number): void {
    const route = this.routes[i]!;
    const leg = route.legs[this.leg[i]];
    const nseg = this.net.segments.get(leg.segId);
    if (!nseg) {
      this.despawn(i);
      return;
    }
    const v = this.speed[i];
    const len = this.tLen[i];
    const rest = (1 - this.tT[i]) * len;
    this.oInter = 0;
    this.oStop = Infinity;
    this.held[i] = Held.None;
    // Following: whoever is ahead on the way out of the junction.
    const key = this.key(nseg.id, leg.dir, this.lane[i]);
    const tailList = this.lanes.get(key);
    const half = this.half(i);
    if (tailList && tailList.length) {
      const t = tailList[0];
      const s = rest + this.d[t] - this.entryTrim(nseg, leg) - this.half(t) - half;
      this.see(i, v, s, this.speed[t]);
    }
    const node = this.turnNode[i];
    const list = this.claims.get(node);
    if (list) {
      for (const c of list) {
        if (c === i || !this.turning[c] || this.reserved[c] !== this.reserved[i]) continue;
        const rc = (1 - this.tT[c]) * this.tLen[c];
        if (rc >= rest) continue;
        this.see(i, v, rest - rc - this.half(c) - half, this.speed[c]);
      }
    }
    // Turning across oncoming traffic: wait inside the junction for a gap.
    if (this.yieldPend[i]) {
      const J = this.junction(node);
      const ws = (this.waitT[i] - this.tT[i]) * len;
      let go = !J;
      if (J && ws < 2.5) {
        const m = this.movement(J, this.claimIn[i], this.claimOut[i]);
        go = m < 0 || (!this.threat(i, J, m, J.prio[m]) && !this.claimBlocked(i, J, m, J.prio[m]));
        // Lights changing: oncoming traffic has stopped, so finish the turn.
        if (!go && J.signal && !this.signals.isGreen(node, this.claimIn[i])) go = !this.claimBlocked(i, J, m, J.prio[m]);
        if (!go && this.wait[i] > Math.min(60, this.patience[i] * 2.5)) go = true;
      }
      if (go) {
        this.yieldPend[i] = 0;
        if (J) this.givenWay++;
      } else {
        this.see(i, v, Math.max(0, ws) + this.gapMin[i] * 0.5, 0);
        this.held[i] = Held.GiveWay;
      }
    }
    this.seeInJunction(i, node, v);
    const ppl = this.peopleOnCurve(i, this.tT[i], 0);
    if (ppl < Infinity) {
      this.see(i, v, ppl, 0);
      if (v < 0.5) this.held[i] = Held.People;
    }
    const a = Math.min(this.accel(i, v, this.vTurn[i], this.oInter), this.oStop);
    let nv = Math.max(0, v + a * dt);
    if (nv < 0.05 && a < 0) nv = 0;
    this.speed[i] = nv;
    this.braking[i] = a < -1.2 || nv < 0.3 ? 1 : 0;
    this.tT[i] += (nv * dt) / len;
    this.progress(i, -1 - this.leg[i], this.tT[i] * len, nv, dt);
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
    this.y[i] = this.terrain.roadHeightAt(x, z) + 0.12 + nodeLift(this.net, node);
    if (this.wait[i] > MAX_WAIT) {
      this.despawnedStuck++;
      this.despawn(i);
      return;
    }
    if (this.tT[i] >= 1) {
      this.turning[i] = 0;
      this.committed[i] = 0;
      this.planKey[i] = -1;
      this.unclaim(i);
      this.unreserve(i);
      this.indicator[i] = 0;
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
    const dEnd = this.dEnd[i];
    const d = this.d[i];
    const distToEnd = dEnd - d;
    const v = this.speed[i];
    const half = this.half(i);

    if (this.hold[i] > 0) {
      // Standing at a stop.
      this.hold[i] -= dt;
      this.speed[i] = 0;
      this.braking[i] = 1;
      this.indicator[i] = this.hold[i] < 2.5 ? -1 : 0;
      this.place(i, seg, leg);
      return;
    }

    // Leader in the same lane.
    const list = this.lanes.get(this.laneKey[i]);
    let leader = -1;
    let leaderD = Infinity;
    if (list) {
      const idx = list.indexOf(i);
      if (idx >= 0 && idx < list.length - 1) {
        leader = list[idx + 1];
        leaderD = this.d[leader];
      }
    }
    this.oInter = 0;
    this.oStop = Infinity;
    let why: Held = Held.None;
    if (leader >= 0) {
      const s = leaderD - d - this.half(leader) - half;
      this.see(i, v, s, this.hold[leader] > 0 ? 0 : this.speed[leader]);
      if (v < 0.5 && s < this.gapMin[i] + 2.5) why = Held.Queue;
    } else if (!isLast) {
      // The one who just left this lane into the junction.
      const j = this.lastOut.get(this.laneKey[i]);
      if (j !== undefined && this.active[j] && this.turning[j] && this.fromKey[j] === this.laneKey[i]) {
        const s = distToEnd + this.tT[j] * this.tLen[j] - this.half(j) - half;
        this.see(i, v, s, this.speed[j]);
        if (v < 0.5 && s < this.gapMin[i] + 2.5) why = Held.Queue;
      }
    }

    // Free speed: the limit as this driver keeps to it, and the bends ahead.
    if (((this.frame + i) & 7) === 0) this.vCurve[i] = this.curveSpeed(i, seg, leg, d);
    let v0 = Math.min((this.model[i] === VM.bike ? 4.2 + this.vfac[i] * 1.8 - 1.6 : rt.speed * this.vfac[i]) * this.speedScale, this.vCurve[i]);

    let mustStopAt = Infinity;
    let go = false;
    if (isLast) {
      mustStopAt = dEnd;
      if (this.park[i] === Park.None && distToEnd < 60) this.planPark(i, seg, route, k);
      if (this.park[i] === Park.Kerb || this.park[i] === Park.Driveway) {
        // Signal and ease over to the kerb (or toward the driveway) for the last stretch.
        this.indicator[i] = 1;
        if (this.park[i] === Park.Kerb) this.latTarget[i] = distToEnd < 35 ? this.kerbLat(seg) : 0;
        v0 = Math.min(v0, 2 + distToEnd * 0.35);
      }
    } else if (distToEnd < LOOKAHEAD) {
      this.planTurn(i, seg, route, k);
      const J = this.junction(this.exitNode(seg, leg));
      const node = this.exitNode(seg, leg);
      const cw = hasCrosswalk(this.layout, node, seg) ? CROSSWALK_INSET + 1.8 : 0.5;
      const stopLine = dEnd - half - cw;
      if (!this.committed[i]) {
        // Far from the line, drivers needn't decide every frame.
        let g = this.gateWas[i] as Held;
        if (distToEnd < 25 || ((this.frame + i) & 3) === 0 || this.gateLeg[i] !== k) {
          g = this.gate(i, seg, route, k, stopLine);
          this.gateWas[i] = g;
          this.gateLeg[i] = k;
        }
        if (g === Held.None) {
          go = true;
          // Close enough to go: claim the way through. (Bends and plain joins need no claim.)
          const brake = (v * v) / (2 * this.bcomf[i]);
          if (J && (stopLine - d < brake + 2.5 || d >= stopLine - 1.5)) this.commit(i, seg, route, k);
        } else {
          mustStopAt = d > stopLine + 0.5 ? Math.max(d, dEnd - half) : stopLine;
          if (v < 0.5 && dEnd - d < 12 + half) why = g;
        }
      }
      if (mustStopAt === Infinity) {
        // Slow for the turn.
        v0 = Math.min(v0, Math.sqrt(this.vTurn[i] * this.vTurn[i] + 2 * this.bcomf[i] * Math.max(0, distToEnd)));
        if (this.committed[i]) {
          // Room ahead on the way out (the queue beyond, and others turning into the same lane).
          const next = route.legs[k + 1];
          const nseg = this.net.segments.get(next.segId);
          if (nseg && !leader) {
            const nkey = this.key(nseg.id, next.dir, this.nextLane[i]);
            const tl = this.lanes.get(nkey);
            if (tl && tl.length) {
              const t = tl[0];
              const s = distToEnd + this.tLen[i] + this.d[t] - this.entryTrim(nseg, next) - this.half(t) - half;
              this.see(i, v, s, this.speed[t]);
            }
          }
          if (distToEnd < 12) this.seeInJunction(i, this.exitNode(seg, leg), v);
          if (distToEnd < 25) {
            const ppl = this.peopleOnCurve(i, 0, distToEnd);
            if (ppl < Infinity) {
              this.see(i, v, ppl, 0);
              if (v < 0.5) why = Held.People;
            }
          }
        }
      }
    }
    if (mustStopAt < Infinity) this.see(i, v, mustStopAt - d + this.gapMin[i], 0);
    const ppl = this.peopleAhead(i, 0);
    if (ppl < Infinity) {
      this.see(i, v, ppl, 0);
      if (v < 0.5 && ppl < 8) {
        why = Held.People;
        if (this.held[i] !== Held.People) this.peopleStops++;
      }
    }

    const a = Math.min(this.accel(i, v, v0, this.oInter), this.oStop);
    let nv = v + a * dt;
    if (nv < 0) nv = 0;
    let nd = d + nv * dt;
    if (leader >= 0) nd = Math.min(nd, Math.max(d, leaderD - this.half(leader) - half - 0.5));
    if (mustStopAt < Infinity) nd = Math.min(nd, Math.max(d, mustStopAt));
    if (nd - d < nv * dt - 0.05) nv = Math.max(0, (nd - d) / dt);
    this.braking[i] = a < -1.2 || nv < 0.3 ? 1 : 0;
    this.speed[i] = nv;
    this.d[i] = nd;
    this.held[i] = nv < 0.5 ? why : Held.None;

    this.progress(i, k, nd, nv, dt);
    if (this.wait[i] > MAX_WAIT) {
      this.despawnedStuck++;
      this.despawn(i);
      return;
    }
    // Stuck for a while: think about another way.
    this.rerouteCool[i] -= dt;
    if (!isLast && this.wait[i] > this.patience[i] && this.rerouteCool[i] <= 0 && this.held[i] !== Held.Red && !this.committed[i] && this.rerouteBudget > 0) {
      this.rerouteBudget--;
      this.rerouteCool[i] = 30;
      this.tryReroute(i);
    }

    // Lane changes and signals.
    this.lcCool[i] -= dt;
    this.laneChange(i, seg, route, k, dt);
    if (this.lcTarget[i] < 0 && Math.abs(this.lat[i] - this.latTarget[i]) < 0.15 && (this.park[i] === Park.None || this.park[i] === Park.Never)) {
      const t = !isLast && (distToEnd < 45 || this.committed[i]) ? this.turnAt(route, k) : 0;
      this.indicator[i] = t;
    }
    // Ease across into the new lane (or over to the kerb).
    if (this.lat[i] !== this.latTarget[i]) {
      const l = this.lat[i] - this.latTarget[i];
      const step = (0.8 + Math.min(1, Math.abs(l)) * 0.7) * dt * Math.min(1, 0.4 + nv / 6);
      this.lat[i] = Math.abs(l) <= step ? this.latTarget[i] : this.lat[i] - Math.sign(l) * step;
    }

    if (isLast) {
      if (nd >= dEnd - 1.0) {
        this.arrived++;
        const cont = this.continuations.get(i);
        const next = cont ? cont(i) : null;
        if (next && this.reroute(i, next.route, next.dwell)) return;
        if (this.startParking(i, seg, leg)) return;
        this.despawn(i, true);
        return;
      }
    } else if ((this.committed[i] || go) && nd >= dEnd) {
      this.beginTurn(i, seg, route, k);
      this.updateTurn(i, 0);
      return;
    }
    this.place(i, seg, leg);
  }

  /** Time held up: how long since the vehicle last got a couple of metres further on. */
  private progress(i: number, where: number, pos: number, v: number, dt: number): void {
    if (where !== this.anchorLeg[i] || Math.abs(pos - this.anchorD[i]) > 2) {
      this.anchorLeg[i] = where;
      this.anchorD[i] = pos;
      this.wait[i] = 0;
    } else if (v < 0.3) this.wait[i] += dt;
  }

  // ── Parking ───────────────────────────────────────────────────────────────

  /** Decides how a car near the camera ends its trip: into an empty driveway close by, or at the kerb. */
  private planPark(i: number, seg: RoadSegment, route: Route, k: number): void {
    const dx = this.x[i] - this.lodX, dz = this.z[i] - this.lodZ;
    if (!PARKS[this.model[i]] || !this.dest[i] || this.continuations.has(i) || dx * dx + dz * dz > PARK_RANGE * PARK_RANGE) {
      this.park[i] = Park.Never;
      return;
    }
    const p = this.purpose[i];
    if (p !== Purpose.Commute && p !== Purpose.Shopping && p !== Purpose.Visitor && p !== Purpose.Freight && p !== Purpose.MoveIn) {
      this.park[i] = Park.Never;
      return;
    }
    this.park[i] = Park.Kerb;
    const leg = route.legs[k];
    const spot = this.arrivalSpot?.(this.dest[i]);
    if (spot && this.model[i] !== VM.delivery) {
      // Where the driveway meets the road, on our side of it.
      const end = this.dEnd[i];
      let best = -1, bd = 1e9;
      for (let d = Math.max(this.d[i] + 4, end - 30); d <= end + 18 && d < seg.length - this.exitTrim(seg, leg); d += 1) {
        this.lanePos(seg, leg.dir, this.lane[i], d, this.tmpA);
        const e = Math.hypot(this.tmpA.x - spot.x, this.tmpA.z - spot.z);
        if (e < bd) {
          bd = e;
          best = d;
        }
      }
      // It has to be on our right, a short turn away.
      this.lanePos(seg, leg.dir, this.lane[i], best, this.tmpA);
      const side = (spot.x - this.tmpA.x) * -this.tmpA.tz + (spot.z - this.tmpA.z) * this.tmpA.tx;
      if (best > 0 && bd < 14 && side > 2) {
        this.park[i] = Park.Driveway;
        this.dEnd[i] = Math.max(this.d[i] + 2, best - 5);
        this.spot[i * 3] = spot.x;
        this.spot[i * 3 + 1] = spot.z;
        this.spot[i * 3 + 2] = spot.rot;
      }
    }
  }

  /** Lateral offset from the kerb lane's centre to a car parked against the kerb. */
  private kerbLat(seg: RoadSegment): number {
    const rt = ROAD_TYPES[seg.type];
    return rt.laneWidth / 2 + rt.gutter - 1.05;
  }

  /** Arrived: pull into the driveway, or stay at the kerb a while. Returns false if it should just go. */
  private startParking(i: number, seg: RoadSegment, leg: RouteLeg): boolean {
    if (this.park[i] !== Park.Kerb && this.park[i] !== Park.Driveway) return false;
    // The trip is over as far as the city is concerned.
    const cb = this.callbacks.get(i);
    this.callbacks.delete(i);
    cb?.();
    this.parkT[i] = 0;
    this.speed[i] = Math.min(this.speed[i], 2.5);
    if (this.park[i] === Park.Driveway) {
      this.laneRemove(i);
      this.place(i, seg, leg);
      const a = { x: this.x[i], z: this.z[i], tx: Math.cos(this.heading[i]), tz: Math.sin(this.heading[i]) };
      const sx = this.spot[i * 3], sz = this.spot[i * 3 + 1], rot = this.spot[i * 3 + 2];
      // Nose in: come to rest with the car's centre on the spot, facing into the lot.
      const b = { x: sx, z: sz, tx: Math.cos(rot), tz: Math.sin(rot) };
      this.tLen[i] = this.curve(a, b, this.tp, i * 6);
      this.tT[i] = 0;
      this.park[i] = Park.PullingIn;
    } else {
      this.park[i] = Park.Parked;
      this.speed[i] = 0;
      this.lat[i] = this.latTarget[i];
      this.place(i, seg, leg);
      // On a road with more lanes, others go round it; on a one-lane street it's tucked in at the kerb, out of the way.
      if (this.lanesOf(seg) < 2) this.laneRemove(i);
      else this.hold[i] = 1e6;
    }
    this.indicator[i] = 0;
    this.parked++;
    return true;
  }

  /** Pulling into a driveway, then standing parked until it fades away. */
  private updatePark(i: number, dt: number): void {
    if (this.park[i] === Park.PullingIn) {
      const len = this.tLen[i];
      const rest = (1 - this.tT[i]) * len;
      const v = Math.max(0.6, Math.min(this.speed[i] + dt, 2.5, Math.sqrt(2 * 1.5 * rest)));
      this.speed[i] = v;
      this.braking[i] = rest < 2 ? 1 : 0;
      this.tT[i] = Math.min(1, this.tT[i] + (v * dt) / len);
      const o = i * 6, p = this.tp, t = this.tT[i], u = 1 - t;
      const x = u * u * p[o] + 2 * u * t * p[o + 2] + t * t * p[o + 4];
      const z = u * u * p[o + 1] + 2 * u * t * p[o + 3] + t * t * p[o + 5];
      const hx = 2 * u * (p[o + 2] - p[o]) + 2 * t * (p[o + 4] - p[o + 2]);
      const hz = 2 * u * (p[o + 3] - p[o + 1]) + 2 * t * (p[o + 5] - p[o + 3]);
      this.x[i] = x;
      this.z[i] = z;
      if (hx * hx + hz * hz > 1e-6) this.heading[i] = Math.atan2(hz, hx);
      this.y[i] = Math.max(this.terrain.heightAt(x, z), this.terrain.roadHeightAt(x, z)) + 0.12;
      if (this.tT[i] >= 1) {
        this.park[i] = Park.Parked;
        this.speed[i] = 0;
      }
      return;
    }
    // Parked: the driver gets out after a moment; the car stays a little while, then fades.
    const before = this.parkT[i];
    this.parkT[i] += dt;
    this.speed[i] = 0;
    this.braking[i] = 0;
    if (before < 1.2 && this.parkT[i] >= 1.2) this.onParked?.(i, this.x[i], this.z[i], this.heading[i], this.dest[i], this.purpose[i] as Purpose);
    const stay = 9 + hash(this.serial[i], i) * 10;
    const dx = this.x[i] - this.lodX, dz = this.z[i] - this.lodZ;
    if (this.parkT[i] > stay || dx * dx + dz * dz > (PARK_RANGE + 250) ** 2) {
      this.fade[i] -= dt / 1.2;
      if (this.fade[i] <= 0) this.despawn(i);
    }
  }

  /** Speed for the bend in the road ahead (this driver's comfortable cornering). */
  private curveSpeed(i: number, seg: RoadSegment, leg: RouteLeg, d: number): number {
    const s = leg.dir === 1 ? d : seg.length - d;
    pointAt(seg.poly, s, this.pp);
    const t0x = this.pp.tx, t0z = this.pp.tz;
    const look = 22;
    const s2 = leg.dir === 1 ? Math.min(seg.length, s + look) : Math.max(0, s - look);
    const ds = Math.abs(s2 - s);
    if (ds < 4) return 99;
    pointAt(seg.poly, s2, this.pp);
    const ang = Math.acos(Math.max(-1, Math.min(1, t0x * this.pp.tx + t0z * this.pp.tz)));
    if (ang < 0.05) return 99;
    return Math.max(5, Math.sqrt((this.alat[i] * ds) / ang));
  }

  private laneChange(i: number, seg: RoadSegment, route: Route, k: number, dt: number): void {
    const n = this.lanesOf(seg);
    if (n < 2 || this.lane[i] === BIKE_LANE) return;
    const d = this.d[i];
    const leg = route.legs[k];
    const isLast = k === route.legs.length - 1;
    const distToEnd = this.dEnd[i] - d;
    // Signalling first, then moving across.
    if (this.lcTarget[i] >= 0) {
      this.lcTimer[i] -= dt;
      if (this.lcTimer[i] > 0) return;
      const target = this.lcTarget[i];
      this.lcTarget[i] = -1;
      if (this.committed[i] || distToEnd < 8) return;
      if (this.safeGap(i, seg, leg, target, 1) === null) {
        this.lcCool[i] = 0.6;
        this.indicator[i] = 0;
        return;
      }
      const from = this.lane[i];
      this.laneRemove(i);
      this.lat[i] += this.laneOff(seg, from) - this.laneOff(seg, target);
      this.lane[i] = target;
      this.planKey[i] = -1;
      this.laneInsert(this.key(seg.id, leg.dir, target), i);
      this.laneChanges++;
      this.lcCool[i] = 4;
      return;
    }
    if (this.lcCool[i] > 0 || this.committed[i] || this.turning[i] || Math.abs(this.lat[i]) > 0.3) return;
    if (((this.frame + i) & 3) !== 0) return;
    if (d - this.entryTrim(seg, leg) < 6 || distToEnd < 14) return;
    const r = this.laneRange(route, k, distToEnd, this.range);
    const lane = this.lane[i];
    const lo = r[0], hi = r[1];
    let target = -1;
    if (lane < lo || lane > hi) {
      // Into the lane for the turn, sooner the more lanes there are to cross.
      const away = lane < lo ? lo - lane : lane - hi;
      if (distToEnd < 90 + 70 * away || isLast) target = lane < lo ? lane + 1 : lane - 1;
    } else if (distToEnd > 45 && this.speed[i] < this.vfac[i] * ROAD_TYPES[seg.type].speed * this.speedScale - 0.5) {
      // Somewhere better to be? (Past a bus at a stop, a slow truck, a stalled lane.)
      const here = this.laneAccel(i, seg, leg, lane);
      for (const cand of [lane - 1, lane + 1]) {
        if (cand < lo || cand > hi || cand < 0 || cand >= n) continue;
        const loss = this.safeGap(i, seg, leg, cand, 0);
        if (loss === null) continue;
        const gain = this.laneAccel(i, seg, leg, cand) - here - this.polite[i] * loss;
        if (gain > 0.45 + (cand > lane ? 0 : 0.1)) {
          target = cand;
          break;
        }
      }
    }
    if (target < 0) return;
    if (this.safeGap(i, seg, leg, target, 1) === null) return;
    this.lcTarget[i] = target;
    this.lcTimer[i] = 0.9 + this.polite[i];
    // On a one-way road and a two-way road alike, a higher lane number is further right.
    this.indicator[i] = target > lane ? 1 : -1;
  }

  /** Acceleration vehicle i would have in `lane` (following whoever is ahead there). */
  private laneAccel(i: number, seg: RoadSegment, leg: RouteLeg, lane: number): number {
    const v = this.speed[i];
    const v0 = ROAD_TYPES[seg.type].speed * this.vfac[i] * this.speedScale;
    const list = this.lanes.get(this.key(seg.id, leg.dir, lane));
    if (!list) return this.accel(i, v, v0, 0);
    const d = this.d[i];
    let idx = this.firstFrom(list, d + 0.001);
    while (idx < list.length && list[idx] === i) idx++;
    if (idx >= list.length) return this.accel(i, v, v0, 0);
    const j = list[idx];
    const s = this.d[j] - d - this.half(j) - this.half(i);
    return this.accel(i, v, v0, this.inter(i, v, s, this.hold[j] > 0 ? 0 : this.speed[j]));
  }

  /**
   * Is there room to move into `lane` beside the current position? Returns how much
   * harder the car behind there would have to brake (≥ 0), or null if it isn't safe.
   */
  private safeGap(i: number, seg: RoadSegment, leg: RouteLeg, lane: number, strict: number): number | null {
    const list = this.lanes.get(this.key(seg.id, leg.dir, lane));
    if (!list || !list.length) return 0;
    const d = this.d[i];
    const half = this.half(i);
    const idx = this.firstFrom(list, d);
    if (idx < list.length) {
      const j = list[idx];
      if (this.d[j] - d - this.half(j) - half < this.gapMin[i] + 0.5 + this.speed[i] * 0.4) return null;
    }
    if (idx > 0) {
      const f = list[idx - 1];
      const s = d - this.d[f] - this.half(f) - half;
      if (s < 2 + strict) return null;
      const vf = this.speed[f];
      const now = this.accel(f, vf, ROAD_TYPES[seg.type].speed * this.vfac[f] * this.speedScale, 0);
      const after = this.accel(f, vf, ROAD_TYPES[seg.type].speed * this.vfac[f] * this.speedScale, this.inter(f, vf, s, this.speed[i]));
      if (after < -3.5) return null;
      return Math.max(0, now - after);
    }
    return 0;
  }

  /** Looks for another way when stuck, with what this driver can see around them and their idea of the usual traffic. */
  private tryReroute(i: number): void {
    if (!this.replan) return;
    const route = this.routes[i]!;
    const k = this.leg[i];
    const blocked = route.legs[k + 1]?.segId ?? -1;
    const x = this.x[i], z = this.z[i];
    const serial = this.serial[i];
    const net = this.net;
    const cost = (segId: number) => {
      let m = this.knownCongestion(segId) * (0.8 + hash(serial, segId) * 0.5);
      if (segId === blocked) m *= 3;
      const s = net.segments.get(segId);
      if (s && (s.cx - x) ** 2 + (s.cz - z) ** 2 < 260 * 260) m *= 1 + this.stoppedOn(segId) * 0.35;
      return m;
    };
    const next = this.replan(i, route, k, this.d[i], cost);
    if (!next || next.legs.length < 2) return;
    // Only if it actually goes another way.
    if (next.legs[1].segId === blocked) return;
    const legs = route.legs.slice(0, k).concat(next.legs);
    legs[k] = route.legs[k];
    this.routes[i] = { legs, cost: next.cost, length: next.length };
    this.planKey[i] = -1;
    this.dEnd[i] = legs.length - 1 === k ? this.legD(net.segments.get(legs[k].segId)!, legs[k], legs[k].s1) : this.dEnd[i];
    this.wait[i] = Math.min(this.wait[i], this.patience[i] * 0.5);
    this.rerouted++;
  }

  private stoppedOn(segId: number): number {
    let n = 0;
    for (let dir = 0; dir < 2; dir++) {
      for (let lane = 0; lane < 6; lane++) {
        const list = this.lanes.get(segId * 32 + dir * 16 + lane);
        if (list) for (const j of list) if (this.speed[j] < 1) n++;
      }
    }
    return n;
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
    const n = this.lanesOf(seg);
    const d0 = this.legD(seg, leg0, leg0.s0);
    this.d[i] = d0;
    this.dEnd[i] = route.legs.length === 1 ? this.legD(seg, leg0, leg0.s1) : seg.length - this.exitTrim(seg, leg0);
    // Pulled in at the kerb.
    this.lane[i] = this.lane[i] === BIKE_LANE ? BIKE_LANE : n - 1;
    this.lat[i] = 0;
    this.wait[i] = 0;
    this.hold[i] = dwell;
    this.committed[i] = 0;
    this.planKey[i] = -1;
    this.laneInsert(this.key(seg.id, leg0.dir, this.lane[i]), i);
    this.place(i, seg, leg0);
    return true;
  }

  // ── People ────────────────────────────────────────────────────────────────

  /**
   * The pedestrians tell drivers where people are on the road (crossing it), and
   * which zebra crossings have someone waiting at the kerb (x0, z0, x1, z1 across the road).
   */
  setPeople(focusX: number, focusZ: number, crossers: ArrayLike<number>, nCross: number, zebras: ArrayLike<number>, nZebra: number, occupied: ArrayLike<number> = [], nOcc = 0): void {
    this.peopleX = focusX;
    this.peopleZ = focusZ;
    this.occN = Math.min(nOcc, this.occ.length / 4);
    for (let k = 0; k < this.occN * 4; k++) this.occ[k] = occupied[k];
    this.crossN = Math.min(nCross, this.crossers.length / 2);
    for (let k = 0; k < this.crossN * 2; k++) this.crossers[k] = crossers[k];
    this.zebraN = Math.min(nZebra, this.zebras.length / 4);
    for (let k = 0; k < this.zebraN * 4; k++) this.zebras[k] = zebras[k];
  }

  // ── Questions ─────────────────────────────────────────────────────────────

  /**
   * A road has gone: drivers whose way used it find another from where they are (if there
   * is one); those on it, or with no other way, leave the map.
   */
  onSegmentRemoved(segId: number): void {
    for (let i = 0; i < this.max; i++) {
      if (!this.active[i]) continue;
      const r = this.routes[i]!;
      const k = this.leg[i];
      let uses = false;
      for (let j = k; j < r.legs.length && !uses; j++) if (r.legs[j].segId === segId) uses = true;
      if (!uses) continue;
      if (this.turning[i] || this.committed[i] || r.legs[k].segId === segId || r.legs[r.legs.length - 1].segId === segId || !this.replan) {
        this.despawn(i);
        continue;
      }
      const next = this.replan(i, r, k, this.d[i], (id) => (id === segId ? 1e6 : this.knownCongestion(id)));
      if (!next || next.legs.length < 2 || next.legs.some((l) => l.segId === segId)) {
        this.despawn(i);
        continue;
      }
      const legs = r.legs.slice(0, k).concat(next.legs);
      legs[k] = r.legs[k];
      this.routes[i] = { legs, cost: next.cost, length: next.length };
      this.planKey[i] = -1;
      this.gateLeg[i] = -1;
      this.rerouted++;
    }
  }

  /** Vehicles in one lane of a segment, one way. */
  inLane(segId: number, dir: number, lane: number): number {
    return this.lanes.get(this.key(segId, dir, lane))?.length ?? 0;
  }

  /** Number of vehicles currently on a segment (both directions). */
  countOn(segId: number): number {
    let n = 0;
    for (let dir = 0; dir < 2; dir++) {
      for (let lane = 0; lane < 6; lane++) {
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

  /** Lane the vehicle is in (or turning into). */
  laneOf(i: number): number {
    return this.lane[i];
  }

  isTurning(i: number): boolean {
    return !!this.turning[i];
  }

  /** Waiting inside a junction for a gap in oncoming traffic. */
  isWaitingToTurn(i: number): boolean {
    return !!this.active[i] && !!this.turning[i] && !!this.yieldPend[i];
  }

  clear(): void {
    for (let i = 0; i < this.max; i++) if (this.active[i]) this.despawn(i);
    this.lanes.clear();
    this.incoming.clear();
    this.claims.clear();
    this.lastOut.clear();
  }
}

/** Distance along the ray (hx, hz) from the origin to segment a–b (given relative to the origin), or -1. */
function rayHit(hx: number, hz: number, ax: number, az: number, bx: number, bz: number): number {
  const ex = bx - ax, ez = bz - az;
  const den = hx * ez - hz * ex;
  if (Math.abs(den) < 1e-4) return -1;
  const t = (ax * ez - az * ex) / den;
  const u = (ax * hz - az * hx) / den;
  return u < 0 || u > 1 || t < 0 ? -1 : t;
}

function turnName(t: number): Turn {
  return t < 0 ? 'left' : t > 0 ? 'right' : 'through';
}
