import { Rng } from '../../core/rng';
import type { City } from '../City';
import type { Building } from '../buildings/Buildings';
import { MAX_VEHICLES } from '../constants';
import { SERVICE_BY_ID } from '../services/ServiceTypes';
import { BUS, type TransitLine } from '../transit/Transit';
import { BuildingState } from '../types';
import type { RoutePoint } from './Pathfinder';
import { ROAD_TYPES } from '../roads/RoadTypes';
import type { RoadSegment } from '../roads/RoadNetwork';
import { pickCarColor, pickCarModel, timeOfDayFactor } from './TripGenerator';
import { Purpose, VM } from './Vehicles';

/** Vehicles kept back from the city-wide count for busy roads near the camera. */
const LOCAL_RESERVE = 400;

const SERVICE_MODEL: Record<string, { model: number; color: number }> = {
  garbage: { model: VM.garbage, color: 0x2f7d4a },
  police: { model: VM.police, color: 0x1d2a44 },
  health: { model: VM.ambulance, color: 0xf4f4f2 },
  fire: { model: VM.firetruck, color: 0xb3161b },
};

/**
 * Drives the visible vehicles: keeps the number of cars proportional to city
 * activity and time of day, and dispatches service vehicles.
 */
export class LiveTraffic {
  private rng = new Rng(0x7a11);
  private serviceTimer = 0;
  private busTimer = 0;
  private busSpawns = 0;
  /** Player setting multiplier for vehicle density. */
  density = 1;
  hour = 8;

  constructor(private city: City) {}

  targetCount(hour: number): number {
    const s = this.city.stats;
    if (s.population <= 0 && s.jobs <= 0) return 0;
    const base = s.population * 0.075 + s.employed * 0.03 + 6;
    // Some room is kept for the busy roads near the camera (topUpLocal).
    return Math.min(MAX_VEHICLES - LOCAL_RESERVE, Math.round(base * timeOfDayFactor(hour) * this.density));
  }

  update(dtReal: number, speedMult: number, hour: number): void {
    if (speedMult <= 0) return;
    this.hour = hour;
    const city = this.city;
    const simDt = dtReal * Math.min(speedMult, 3);
    const tod = timeOfDayFactor(hour);
    // Drivers slow down in bad weather; congestion is left to the queues themselves.
    city.vehicles.speedScale = city.weather.roadSpeed();
    city.signals.update(simDt);

    const target = this.targetCount(hour);
    const deficit = target - city.vehicles.count;
    if (deficit > 0) {
      const n = Math.min(8, Math.max(1, Math.ceil(deficit / 30)));
      for (let k = 0; k < n; k++) {
        const t = city.trips.sample(this.rng, hour);
        if (!t) continue;
        this.spawn(t.from, t.to, t.model, t.color, t.purpose, undefined, 0, t.dest);
      }
    }

    // Busy roads near the camera get the cars their traffic implies, so queues form where the city's traffic really is.
    this.localTimer -= simDt;
    if (this.localTimer <= 0) {
      this.localTimer = 0.4;
      this.topUpLocal(tod);
    }

    this.busTimer -= simDt;
    if (this.busTimer <= 0) {
      this.busTimer = 1;
      this.maintainBuses();
    }

    this.serviceTimer -= simDt;
    if (this.serviceTimer <= 0) {
      this.serviceTimer = 2.5;
      this.dispatchRoutineService();
    }
    city.vehicles.update(simDt);
  }

  spawn(from: RoutePoint, to: RoutePoint, model: number, color: number, purpose: Purpose, onArrive?: () => void, tag = 0, dest?: number): number {
    const route = model === VM.bike ? this.bikeRoute(from, to) : this.city.paths.find(from, to);
    if (!route || route.length < 30) return -1;
    return this.city.vehicles.spawn({ route, model, color, purpose, onArrive, tag, dest });
  }

  private localTimer = 0;
  private near: { at: number; x: number; z: number; segs: RoadSegment[]; wide: RoadSegment[]; busy: RoadSegment[] } = { at: -1, x: 0, z: 0, segs: [], wide: [], busy: [] };
  /** Extra cars spawned for busy roads near the camera. */
  localSpawns = 0;

  /**
   * How many cars each direction of a road should hold just now (its share of the
   * city's traffic), with queues where demand is near or over capacity.
   */
  expectedOn(seg: RoadSegment, tod: number): number {
    const city = this.city;
    const rt = ROAD_TYPES[seg.type];
    const x = city.traffic.ratio(seg.id) * tod;
    const q = ((city.traffic.volume.get(seg.id) ?? 0) * tod * this.density) / (seg.oneway !== 0 ? 1 : 2);
    const len = Math.max(0, seg.length - seg.trimA - seg.trimB);
    const free = ((q / 3600) * len) / rt.speed;
    const lanes = rt.lanes * (seg.oneway !== 0 ? 2 : 1);
    return Math.min((lanes * len) / 7.5, free * (1 + 3 * Math.max(0, x - 0.8)));
  }

  private topUpLocal(tod: number): void {
    const city = this.city;
    const v = city.vehicles;
    if (!city.traffic.volume.size) return;
    const fx = v.lodX, fz = v.lodZ;
    const near = this.near;
    if (near.at !== city.roads.version || Math.hypot(fx - near.x, fz - near.z) > 60) {
      near.at = city.roads.version;
      near.x = fx;
      near.z = fz;
      const R = 420, W = 1100;
      near.segs = city.roads.segmentsIn(fx - R, fz - R, fx + R, fz + R).filter((s) => !s.ring);
      near.wide = city.roads.segmentsIn(fx - W, fz - W, fx + W, fz + W).filter((s) => (city.traffic.volume.get(s.id) ?? 0) > 0);
      // The roads with traffic, busiest first: those are the ones to fill.
      near.busy = near.segs.filter((s) => (city.traffic.volume.get(s.id) ?? 0) > 0).sort((a, b) => city.traffic.ratio(b.id) - city.traffic.ratio(a.id));
    }
    if (!near.segs.length || !near.wide.length) return;
    for (let tries = 0; tries < 6; tries++) {
      // Mostly the busiest roads in view (squared pick leans to the front of the list).
      const pool = near.busy.length ? near.busy : near.segs;
      const seg = pool[Math.floor(this.rng.next() ** 2 * pool.length)];
      const dir: 1 | -1 = seg.oneway !== 0 ? (seg.oneway as 1 | -1) : this.rng.chance(0.5) ? 1 : -1;
      const want = this.expectedOn(seg, tod);
      if (want < 0.6) continue;
      const lanes = ROAD_TYPES[seg.type].lanes * (seg.oneway !== 0 ? 2 : 1);
      let have = 0;
      for (let lane = 0; lane < lanes; lane++) have += v.inLane(seg.id, dir, lane);
      if (have >= want - 0.4) continue;
      // Somewhere else busy, a little way off.
      let to: RoadSegment | null = null;
      for (let k = 0; k < 6 && !to; k++) {
        const c = near.wide[Math.floor(this.rng.next() * near.wide.length)];
        if (c.id !== seg.id && (c.cx - seg.cx) ** 2 + (c.cz - seg.cz) ** 2 > 250 * 250) to = c;
      }
      if (!to) continue;
      const s = dir === 1 ? seg.trimA + 2 : seg.length - seg.trimB - 2;
      const route = city.paths.find({ segId: seg.id, s }, { segId: to.id, s: to.length / 2 });
      if (!route || route.legs[0].dir !== dir || route.length < 120) continue;
      // Big cities fill the vehicle limit: cars far out of view make way for these.
      if (v.count >= MAX_VEHICLES - 50 && !v.makeRoom()) return;
      const rng = this.rng;
      if (v.spawn({ route, model: pickCarModel(rng), color: pickCarColor(rng), purpose: Purpose.Commute }) >= 0) this.localSpawns++;
    }
  }

  /** A way by bike: never on highways, and quiet streets rather than busy main roads. */
  bikeRoute(from: RoutePoint, to: RoutePoint): ReturnType<City['paths']['find']> {
    const roads = this.city.roads;
    if (from.segId === to.segId) {
      // Along one road: straight there, if bikes may use it.
      const s = roads.segments.get(from.segId);
      return s && !ROAD_TYPES[s.type].freeway && ROAD_TYPES[s.type].sidewalk > 0 ? this.city.paths.find(from, to) : null;
    }
    const r = this.city.paths.findAhead(from, 0, to, (id) => {
      const s = roads.segments.get(id);
      if (!s) return 1;
      const rt = ROAD_TYPES[s.type];
      if (rt.freeway || rt.sidewalk <= 0) return 1e6;
      // Cost by time at bike speed rather than the speed limit, and a busy road counts as longer.
      // Bike lanes are the way to go.
      const lane = s.bikeLane === 2 ? 0.6 : s.bikeLane === 1 ? 0.75 : 1;
      return (rt.speed / 4.6) * (s.type === 'lane' || s.type === 'street' ? 1 : 1.35) * lane;
    });
    return r && r.cost < 1e5 ? r : null;
  }

  /** Buses currently driving each line. */
  busCounts(): Map<number, number> {
    const v = this.city.vehicles;
    const counts = new Map<number, number>();
    for (let i = 0; i < v.max; i++) {
      if (v.active[i] && v.purpose[i] === Purpose.Transit) counts.set(v.tag[i], (counts.get(v.tag[i]) ?? 0) + 1);
    }
    return counts;
  }

  /** Keeps each working line's buses on the road (one new bus per line per call). */
  private maintainBuses(): void {
    const transit = this.city.transit;
    if (!transit.lines.size) return;
    transit.refreshRoutes();
    const counts = this.busCounts();
    for (const line of transit.lines.values()) {
      if (line.problem || !line.hops.length) continue;
      if ((counts.get(line.id) ?? 0) >= line.buses) continue;
      // Spread buses around the loop.
      const k = (this.busSpawns++ * 7) % line.hops.length;
      this.spawnBus(line, k);
    }
  }

  private spawnBus(line: TransitLine, startHop: number): number {
    const transit = this.city.transit;
    let hop = startHop;
    const route = line.hops[hop];
    if (!route) return -1;
    const id = line.id;
    return this.city.vehicles.spawn({
      route,
      model: VM.bus,
      color: line.color,
      purpose: Purpose.Transit,
      tag: id,
      next: () => {
        const l = transit.lines.get(id);
        if (!l || l.problem || !l.hops.length) return null;
        // Retire surplus buses when the player reduces the fleet.
        if ((this.busCounts().get(id) ?? 0) > l.buses) return null;
        hop = (hop + 1) % l.hops.length;
        return { route: l.hops[hop], dwell: BUS.dwell };
      },
    });
  }

  /** Sends a vehicle from the nearest operational service of a kind to a target. */
  dispatch(kind: 'fire' | 'police' | 'health' | 'garbage', target: Building, onArrive?: () => void): number {
    const city = this.city;
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of city.buildings.all.values()) {
      if (b.kind !== 'service' || b.state !== BuildingState.Active || !b.segId) continue;
      const st = SERVICE_BY_ID.get(b.typeId);
      if (!st || st.kind !== kind) continue;
      const d = (b.cx - target.cx) ** 2 + (b.cz - target.cz) ** 2;
      if (d < bestD && d < (st.radius * 1.2) ** 2) {
        bestD = d;
        best = b;
      }
    }
    if (!best || !target.segId) return -1;
    const m = SERVICE_MODEL[kind];
    return this.spawn({ segId: best.segId, s: best.segS }, { segId: target.segId, s: target.segS }, m.model, m.color, Purpose.Service, onArrive, target.id);
  }

  private dispatchRoutineService(): void {
    const city = this.city;
    if (city.vehicles.count >= MAX_VEHICLES - 50) return;
    const services: Building[] = [];
    for (const b of city.buildings.all.values()) {
      if (b.kind !== 'service' || b.state !== BuildingState.Active || !b.segId) continue;
      const st = SERVICE_BY_ID.get(b.typeId);
      if (st && (st.kind === 'garbage' || st.kind === 'police' || st.kind === 'health')) services.push(b);
    }
    if (!services.length) return;
    const svc = services[Math.floor(this.rng.next() * services.length)];
    const st = SERVICE_BY_ID.get(svc.typeId)!;
    if (st.kind === 'health' && !this.rng.chance(0.3)) return;
    const near = city.buildings.queryRadius(svc.cx, svc.cz, st.radius * 0.8).filter((b) => b.kind === 'zoned' && b.state === BuildingState.Active && b.segId);
    if (!near.length) return;
    const target = near[Math.floor(this.rng.next() * near.length)];
    const m = SERVICE_MODEL[st.kind];
    // Half the trips are vehicles returning to base.
    const outbound = this.rng.chance(0.5);
    const a = { segId: svc.segId, s: svc.segS };
    const b = { segId: target.segId, s: target.segS };
    this.spawn(outbound ? a : b, outbound ? b : a, m.model, m.color, Purpose.Service);
  }
}
