import { type PolyPoint, pointAt, projectOnPolyline } from '../../core/geom2d';
import { clamp } from '../../core/math';
import type { Building } from '../buildings/Buildings';
import type { City } from '../City';
import type { RoadSegment } from '../roads/RoadNetwork';
import { isFreeway, ROAD_TYPES } from '../roads/RoadTypes';
import type { Route, RoutePoint } from '../traffic/Pathfinder';
import { BuildingState } from '../types';
import { METRO, Metro, type MetroSave } from './Metro';

/** Tunables for the bus system. */
export const BUS = {
  /** Passengers per bus. */
  capacity: 60,
  /** Buses drive slower than cars (stops, acceleration). */
  speedFactor: 0.72,
  /** Seconds spent at each stop. */
  dwell: 12,
  /** Fare income per ride. */
  fare: 0.22,
  /** Monthly cost per bus in service. */
  upkeepPerBus: 380,
  stopCost: 600,
  lineCost: 2_500,
  /** People walk this far to a stop. */
  walkRadius: 330,
  walkSpeed: 1.3,
  /** Service hours per day. */
  serviceHours: 18,
  maxBusesPerLine: 20,
  /** Buses one depot can operate. */
  busesPerDepot: 40,
  /** Minimum spacing between stops on the same side of a road. */
  minStopSpacing: 40,
};

export const LINE_COLORS = [0xe8453c, 0x2f80ed, 0x27ae60, 0xf2994a, 0x9b51e0, 0x00a3a3, 0xd6336c, 0x8d6e63, 0xf2c94c, 0x56ccf2];

export interface BusStop {
  id: number;
  segId: number;
  /** Arc length along the segment. */
  s: number;
  /** Side of the road (+1 right of a→b, -1 left). */
  side: number;
  x: number;
  z: number;
  name: string;
  /** People currently waiting (for display). */
  waiting: number;
}

export type LineProblem = '' | 'stops' | 'route' | 'depot' | 'buses';

export interface TransitLine {
  id: number;
  name: string;
  color: number;
  /** Stop ids in visiting order; the line loops back to the first stop. */
  stops: number[];
  /** Buses assigned by the player. */
  buses: number;
  // ── Derived (recomputed) ──
  /** Route for each hop (stop k → stop k+1, last hop back to the first). */
  hops: Route[];
  /** Cumulative travel time (s) from the first stop to each stop. */
  times: number[];
  loopSeconds: number;
  lengthM: number;
  problem: LineProblem;
  /** Riders per day (both directions of each commute). */
  ridersPerDay: number;
  capacityPerDay: number;
}

export interface TransitSave {
  stops: Omit<BusStop, 'waiting'>[];
  lines: { id: number; name: string; color: number; stops: number[]; buses: number }[];
  nextStopId: number;
  nextLineId: number;
  metro?: MetroSave;
}

/** A bus or metro line as seen by a commuter choosing how to travel. */
interface Ride {
  times: number[];
  loopSeconds: number;
  /** Average wait at the platform (s). */
  wait: number;
  /** Discomfort, in units of five minutes. */
  penalty: number;
  capacity: number;
  points: { x: number; z: number }[];
  walkRadius: number;
  riders: number;
  commit(riders: number): void;
  waitAt(k: number, n: number): void;
}

interface Access {
  ride: Ride;
  /** Index of the stop in the line. */
  k: number;
  walk: number;
}

/**
 * Bus stops, lines and ridership. Stops sit on road segments (and move to the
 * new segment when roads are split); lines loop through their stops. Each day
 * commuters who live and work near stops on the same line compare door-to-door
 * bus time with driving and some switch to the bus, which removes their car
 * trips from the traffic model.
 */
export class Transit {
  readonly stops = new Map<number, BusStop>();
  readonly lines = new Map<number, TransitLine>();
  nextStopId = 1;
  nextLineId = 1;
  /** Bumped on any change that affects rendering. */
  version = 0;
  /** Share of each worker slot's commute made by bus (index household * 2 + k). */
  share = new Float32Array(0);
  /** Riders per day on buses and trains together. */
  totalRiders = 0;
  busRiders = 0;
  /** Fraction of commuters using transit. */
  modeShare = 0;
  private routesVersion = -1;
  private pp: PolyPoint = { x: 0, z: 0, tx: 0, tz: 0, i: 0 };

  readonly metro: Metro;

  constructor(private city: City) {
    this.metro = new Metro(city);
  }

  // ── Stops ─────────────────────────────────────────────────────────────────

  /** Position of a stop's curb point for a segment, arc length and side. */
  stopPoint(seg: RoadSegment, s: number, side: number): { x: number; z: number; tx: number; tz: number } {
    pointAt(seg.poly, s, this.pp);
    const off = ROAD_TYPES[seg.type].halfWidth + 1.2;
    // Right-hand normal is (-tz, tx).
    return { x: this.pp.x - this.pp.tz * off * side, z: this.pp.z + this.pp.tx * off * side, tx: this.pp.tx, tz: this.pp.tz };
  }

  /** Validates a stop location; returns an error message or ''. */
  checkStop(seg: RoadSegment, s: number, side: number): string {
    const rt = ROAD_TYPES[seg.type];
    if (isFreeway(seg.type)) return 'Buses cannot stop on highways';
    if (seg.elevated) return 'Buses cannot stop on bridges';
    if (!rt.zoning && seg.type !== 'boulevard' && seg.type !== 'avenue' && seg.type !== 'street') return 'Buses cannot stop here';
    if (s < seg.trimA + 6 || s > seg.length - seg.trimB - 6) return 'Too close to an intersection';
    for (const st of this.stops.values()) {
      if (st.segId === seg.id && st.side === side && Math.abs(st.s - s) < BUS.minStopSpacing) return 'Too close to another stop';
    }
    return '';
  }

  addStop(seg: RoadSegment, s: number, side: number): BusStop {
    const p = this.stopPoint(seg, s, side);
    const id = this.nextStopId++;
    const stop: BusStop = { id, segId: seg.id, s, side, x: p.x, z: p.z, name: `${seg.name || 'Unnamed road'} stop`, waiting: 0 };
    this.stops.set(id, stop);
    this.touch();
    return stop;
  }

  /** Removes a stop (and drops it from lines; lines left with fewer than two stops are deleted). */
  removeStop(id: number): void {
    if (!this.stops.delete(id)) return;
    for (const line of [...this.lines.values()]) {
      if (!line.stops.includes(id)) continue;
      line.stops = line.stops.filter((s) => s !== id);
      if (line.stops.length < 2) this.lines.delete(line.id);
    }
    this.touch();
  }

  stopNear(x: number, z: number, radius = 12): BusStop | null {
    let best: BusStop | null = null;
    let bestD = radius * radius;
    for (const st of this.stops.values()) {
      const d = (st.x - x) ** 2 + (st.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = st;
      }
    }
    return best;
  }

  /** Re-attaches stops whose segment was removed (split, upgraded or bulldozed). */
  onRoadsChanged(): void {
    const roads = this.city.roads;
    let changed = false;
    for (const st of [...this.stops.values()]) {
      const seg = roads.segments.get(st.segId);
      if (seg) {
        // Retyped roads change width: keep the stop on the curb.
        const p = this.stopPoint(seg, Math.min(st.s, seg.length), st.side);
        if (Math.abs(p.x - st.x) > 0.05 || Math.abs(p.z - st.z) > 0.05) {
          st.x = p.x;
          st.z = p.z;
          changed = true;
        }
        continue;
      }
      const hit = roads.nearestSegment(st.x, st.z, 30, (s) => !isFreeway(s.type));
      if (!hit) {
        this.removeStop(st.id);
        changed = true;
        continue;
      }
      const proj = { s: 0, dist: 0, x: 0, z: 0, side: 1 };
      projectOnPolyline(hit.seg.poly, st.x, st.z, proj);
      st.segId = hit.seg.id;
      st.s = clamp(proj.s, 1, hit.seg.length - 1);
      st.side = proj.side;
      const p = this.stopPoint(hit.seg, st.s, st.side);
      st.x = p.x;
      st.z = p.z;
      changed = true;
    }
    if (changed) this.touch();
    this.routesVersion = -1;
  }

  // ── Lines ─────────────────────────────────────────────────────────────────

  addLine(stops: number[], name?: string): TransitLine {
    const id = this.nextLineId++;
    const used = new Set([...this.lines.values()].map((l) => l.color));
    const color = LINE_COLORS.find((c) => !used.has(c)) ?? LINE_COLORS[id % LINE_COLORS.length];
    const line: TransitLine = {
      id,
      name: name ?? `Line ${id}`,
      color,
      stops: [...stops],
      buses: Math.min(BUS.maxBusesPerLine, Math.max(2, Math.round(stops.length / 2))),
      hops: [],
      times: [],
      loopSeconds: 0,
      lengthM: 0,
      problem: '',
      ridersPerDay: 0,
      capacityPerDay: 0,
    };
    this.lines.set(id, line);
    this.touch();
    this.refreshRoutes(true);
    return line;
  }

  removeLine(id: number): void {
    if (this.lines.delete(id)) this.touch();
  }

  setBuses(id: number, n: number): void {
    const line = this.lines.get(id);
    if (!line) return;
    line.buses = clamp(Math.round(n), 1, BUS.maxBusesPerLine);
    this.updateCapacity(line);
    this.touch();
  }

  private touch(): void {
    this.version++;
    this.routesVersion = -1;
  }

  /** Buses all depots can run, per road component. */
  depotCapacity(): Map<number, number> {
    const cap = new Map<number, number>();
    for (const b of this.city.buildings.all.values()) {
      if (b.kind !== 'service' || b.state !== BuildingState.Active || !b.segId) continue;
      if (b.typeId !== 'bus_depot') continue;
      const comp = this.city.componentOfSegment(b.segId);
      cap.set(comp, (cap.get(comp) ?? 0) + BUS.busesPerDepot);
    }
    return cap;
  }

  /** Recomputes hop routes and timings when roads, stops or depots changed. */
  refreshRoutes(force = false): void {
    const key = this.city.roads.version * 7919 + this.version * 31 + this.city.buildings.count;
    if (!force && key === this.routesVersion) return;
    this.routesVersion = key;
    const depots = this.depotCapacity();
    const used = new Map<number, number>();
    for (const line of this.lines.values()) {
      line.hops = [];
      line.times = [0];
      line.loopSeconds = 0;
      line.lengthM = 0;
      line.problem = '';
      const stops = line.stops.map((id) => this.stops.get(id)).filter((s): s is BusStop => !!s);
      if (stops.length < 2) {
        line.problem = 'stops';
        continue;
      }
      let t = 0;
      for (let k = 0; k < stops.length; k++) {
        const a = stops[k];
        const b = stops[(k + 1) % stops.length];
        const route = this.city.paths.find(this.routePoint(a), this.routePoint(b));
        if (!route) {
          line.problem = 'route';
          break;
        }
        line.hops.push(route);
        line.lengthM += route.length;
        t += route.cost / BUS.speedFactor + BUS.dwell;
        if (k < stops.length - 1) line.times.push(t);
      }
      if (line.problem) continue;
      line.loopSeconds = t;
      const comp = this.city.componentOfSegment(stops[0].segId);
      const have = (depots.get(comp) ?? 0) - (used.get(comp) ?? 0);
      if (have <= 0) line.problem = (depots.get(comp) ?? 0) > 0 ? 'buses' : 'depot';
      else used.set(comp, (used.get(comp) ?? 0) + line.buses);
      this.updateCapacity(line);
    }
  }

  routePoint(st: BusStop): RoutePoint {
    return { segId: st.segId, s: st.s };
  }

  private updateCapacity(line: TransitLine): void {
    if (line.problem || line.loopSeconds <= 0) {
      line.capacityPerDay = 0;
      return;
    }
    const loopsPerDay = (BUS.serviceHours * 3600) / line.loopSeconds;
    // Riders don't all travel the whole loop; a bus carries ~1.6 loads per loop.
    line.capacityPerDay = line.buses * BUS.capacity * loopsPerDay * 1.6;
  }

  /** Average wait for a bus (seconds). */
  waitSeconds(line: TransitLine): number {
    return Math.min(1200, line.loopSeconds / Math.max(1, line.buses) / 2);
  }

  // ── Ridership ─────────────────────────────────────────────────────────────

  /** Daily mode choice for commuters (bus or metro). Fills `share` and line rider counts. */
  updateRidership(): void {
    const city = this.city;
    this.refreshRoutes();
    this.metro.refresh();
    const pop = city.population;
    if (this.share.length < pop.count * 2) this.share = new Float32Array(Math.max(256, pop.count * 4));
    else this.share.fill(0);
    this.totalRiders = 0;
    this.busRiders = 0;
    this.metro.totalRiders = 0;
    this.modeShare = 0;
    for (const line of this.lines.values()) line.ridersPerDay = 0;
    for (const line of this.metro.lines.values()) line.ridersPerDay = 0;
    for (const st of this.stops.values()) st.waiting = 0;
    this.metro.waiting.clear();

    // Everything a commuter could ride, buses and trains alike.
    const rides: Ride[] = [];
    for (const line of this.lines.values()) {
      if (line.problem || line.buses <= 0) continue;
      const pts = line.stops.map((id) => this.stops.get(id)!);
      rides.push({
        times: line.times, loopSeconds: line.loopSeconds, wait: this.waitSeconds(line), penalty: 0.3, capacity: line.capacityPerDay,
        points: pts, walkRadius: BUS.walkRadius, riders: 0,
        commit: (n) => {
          line.ridersPerDay = Math.round(n);
          this.busRiders += line.ridersPerDay;
        },
        waitAt: (k, n) => {
          const st = pts[k];
          if (st) st.waiting += n;
        },
      });
    }
    for (const line of this.metro.lines.values()) {
      if (line.problem || line.trains <= 0) continue;
      const pts = line.stations.map((id) => this.metro.station(id)!).map((b) => ({ x: b.cx, z: b.cz, id: b.id }));
      rides.push({
        times: line.times, loopSeconds: line.loopSeconds, wait: this.metro.waitSeconds(line), penalty: 0.05, capacity: line.capacityPerDay,
        points: pts, walkRadius: METRO.walkRadius, riders: 0,
        commit: (n) => {
          line.ridersPerDay = Math.round(n);
          this.metro.totalRiders += line.ridersPerDay;
        },
        waitAt: (k, n) => {
          const st = pts[k];
          if (st) this.metro.waiting.set(st.id, (this.metro.waiting.get(st.id) ?? 0) + n);
        },
      });
    }
    if (!rides.length) return;

    // Which rides each building can reach on foot, and how far it is to walk.
    const access = new Map<number, Access[]>();
    for (const ride of rides) {
      ride.points.forEach((st, k) => {
        for (const b of city.buildings.queryRadius(st.x, st.z, ride.walkRadius)) {
          if (b.state !== BuildingState.Active || b.kind !== 'zoned') continue;
          const walk = Math.hypot(b.cx - st.x, b.cz - st.z);
          let list = access.get(b.id);
          if (!list) access.set(b.id, (list = []));
          const prev = list.find((a) => a.ride === ride && a.k === k);
          if (!prev) list.push({ ride, k, walk });
          else if (walk < prev.walk) prev.walk = walk;
        }
      });
    }

    const congestion = this.congestionIndex();
    const free = city.policies.has('freeTransit');
    let commuters = 0;
    let transitTrips = 0;
    const choices: { slot: number; ride: Ride; share: number; a: number }[] = [];
    const demand = new Map<Ride, number>();
    for (let i = 0; i < pop.count; i++) {
      if (!pop.alive[i]) continue;
      const homeAccess = access.get(pop.home[i]);
      for (let k = 0; k < 2; k++) {
        const job = pop.job[i * 2 + k];
        if (!job) continue;
        commuters++;
        if (!homeAccess) continue;
        const workAccess = access.get(job);
        if (!workAccess) continue;
        const home = city.buildings.get(pop.home[i]);
        const work = city.buildings.get(job);
        if (!home || !work) continue;
        // Fastest single ride connecting both ends (comfort counts as time).
        let bestT = Infinity;
        let best: Ride | null = null;
        let bestA = 0;
        for (const ha of homeAccess) {
          for (const wa of workAccess) {
            if (wa.ride !== ha.ride || wa.k === ha.k) continue;
            const r = ha.ride;
            const ride = (r.times[wa.k] - r.times[ha.k] + r.loopSeconds) % r.loopSeconds;
            const t = (ha.walk + wa.walk) / BUS.walkSpeed + r.wait + ride + r.penalty * 300;
            if (t < bestT) {
              bestT = t;
              best = r;
              bestA = ha.k;
            }
          }
        }
        if (!best) continue;
        const dist = Math.hypot(home.cx - work.cx, home.cz - work.cz);
        const carT = (dist * 1.3) / 11 * congestion + 150;
        // Logistic choice; transit never takes everyone.
        const sh = 0.85 / (1 + Math.exp((bestT - carT) / 300 - (free ? 0.7 : 0)));
        if (sh < 0.02) continue;
        choices.push({ slot: i * 2 + k, ride: best, share: sh, a: bestA });
        demand.set(best, (demand.get(best) ?? 0) + sh * 2);
      }
    }
    // Crowded lines lose riders until demand fits capacity.
    for (const c of choices) {
      const d = demand.get(c.ride) ?? 0;
      const s = c.share * (d > c.ride.capacity ? c.ride.capacity / d : 1);
      this.share[c.slot] = s;
      c.ride.riders += s * 2;
      transitTrips += s;
      c.ride.waitAt(c.a, s * 0.08);
    }
    for (const r of rides) r.commit(r.riders);
    this.totalRiders = this.busRiders + this.metro.totalRiders;
    for (const st of this.stops.values()) st.waiting = Math.round(st.waiting);
    for (const [id, n] of this.metro.waiting) this.metro.waiting.set(id, Math.round(n));
    this.modeShare = commuters > 0 ? transitTrips / commuters : 0;
  }

  /** Volume-weighted travel-time multiplier on the road network. */
  private congestionIndex(): number {
    const tr = this.city.traffic;
    let s = 0, w = 0;
    for (const [id, v] of tr.volume) {
      if (v <= 0) continue;
      s += tr.multiplier(id) * v;
      w += v;
    }
    return w > 0 ? s / w : 1;
  }

  /** Commute car share for a household's worker slot (1 = drives). */
  carShare(i: number, k: number): number {
    const j = i * 2 + k;
    return j < this.share.length ? 1 - this.share[j] : 1;
  }

  // ── Economy ───────────────────────────────────────────────────────────────

  monthlyFares(): number {
    const free = this.city.policies.has('freeTransit');
    return (free ? 0 : this.busRiders * 30 * BUS.fare) + this.metro.monthlyFares(free);
  }

  /** Bus and train operating costs (stations and depots are billed as buildings). */
  monthlyUpkeep(): number {
    return this.busUpkeep() + this.metro.monthlyUpkeep();
  }

  busUpkeep(): number {
    let n = 0;
    for (const line of this.lines.values()) if (!line.problem) n += line.buses;
    return n * BUS.upkeepPerBus;
  }

  /** Stops and stations on working lines (for land value; a station counts double). */
  servedStops(): { x: number; z: number }[] {
    const ids = new Set<number>();
    for (const line of this.lines.values()) if (!line.problem) for (const id of line.stops) ids.add(id);
    const out: { x: number; z: number }[] = [...ids].map((id) => this.stops.get(id)!).filter(Boolean);
    const stations = new Set<number>();
    for (const line of this.metro.lines.values()) if (!line.problem) for (const id of line.stations) stations.add(id);
    for (const id of stations) {
      const b = this.metro.station(id);
      if (b) out.push({ x: b.cx, z: b.cz }, { x: b.cx, z: b.cz });
    }
    return out;
  }

  /** Walking catchments of served stops and stations (for the transit map layer). */
  catchments(): { x: number; z: number; r: number }[] {
    const out: { x: number; z: number; r: number }[] = [];
    const ids = new Set<number>();
    for (const line of this.lines.values()) if (!line.problem) for (const id of line.stops) ids.add(id);
    for (const id of ids) {
      const st = this.stops.get(id);
      if (st) out.push({ x: st.x, z: st.z, r: BUS.walkRadius });
    }
    const stations = new Set<number>();
    for (const line of this.metro.lines.values()) if (!line.problem) for (const id of line.stations) stations.add(id);
    for (const id of stations) {
      const b = this.metro.station(id);
      if (b) out.push({ x: b.cx, z: b.cz, r: METRO.walkRadius });
    }
    return out;
  }

  linesAt(stopId: number): TransitLine[] {
    return [...this.lines.values()].filter((l) => l.stops.includes(stopId));
  }

  // ── Save / load ───────────────────────────────────────────────────────────

  serialize(): TransitSave {
    return {
      stops: [...this.stops.values()].map(({ waiting: _w, ...s }) => ({ ...s })),
      lines: [...this.lines.values()].map((l) => ({ id: l.id, name: l.name, color: l.color, stops: [...l.stops], buses: l.buses })),
      nextStopId: this.nextStopId,
      nextLineId: this.nextLineId,
      metro: this.metro.serialize(),
    };
  }

  load(data: TransitSave): void {
    this.stops.clear();
    this.lines.clear();
    for (const s of data.stops) this.stops.set(s.id, { ...s, waiting: 0 });
    for (const l of data.lines) {
      this.lines.set(l.id, { ...l, stops: [...l.stops], hops: [], times: [], loopSeconds: 0, lengthM: 0, problem: '', ridersPerDay: 0, capacityPerDay: 0 });
    }
    this.nextStopId = data.nextStopId;
    this.nextLineId = data.nextLineId;
    this.metro.load(data.metro);
    this.touch();
  }
}

/** Describes a line problem for the UI. */
export function lineProblemText(p: LineProblem): string {
  switch (p) {
    case 'stops':
      return 'A line needs at least two stops';
    case 'route':
      return 'Some stops are not connected by road';
    case 'depot':
      return 'Build a bus depot on this road network';
    case 'buses':
      return 'Depots are full: build another bus depot';
    default:
      return '';
  }
}

export function isTransitDepot(b: Building): boolean {
  return b.kind === 'service' && b.typeId === 'bus_depot';
}
