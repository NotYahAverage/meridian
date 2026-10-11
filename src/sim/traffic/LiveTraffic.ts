import { Rng } from '../../core/rng';
import type { City } from '../City';
import type { Building } from '../buildings/Buildings';
import { MAX_VEHICLES } from '../constants';
import { SERVICE_BY_ID } from '../services/ServiceTypes';
import { BUS, type TransitLine } from '../transit/Transit';
import { BuildingState } from '../types';
import type { RoutePoint } from './Pathfinder';
import { timeOfDayFactor } from './TripGenerator';
import { Purpose, VM } from './Vehicles';

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
    return Math.min(MAX_VEHICLES, Math.round(base * timeOfDayFactor(hour) * this.density));
  }

  update(dtReal: number, speedMult: number, hour: number): void {
    if (speedMult <= 0) return;
    this.hour = hour;
    const city = this.city;
    const simDt = dtReal * Math.min(speedMult, 3);
    const tod = timeOfDayFactor(hour);
    const road = city.weather.roadSpeed();
    city.vehicles.congestion = (id) => city.traffic.multiplier(id, tod) / road;
    city.signals.update(simDt);

    const target = this.targetCount(hour);
    const deficit = target - city.vehicles.count;
    if (deficit > 0) {
      const n = Math.min(8, Math.max(1, Math.ceil(deficit / 30)));
      for (let k = 0; k < n; k++) {
        const t = city.trips.sample(this.rng, hour);
        if (!t) continue;
        this.spawn(t.from, t.to, t.model, t.color, t.purpose);
      }
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

  spawn(from: RoutePoint, to: RoutePoint, model: number, color: number, purpose: Purpose, onArrive?: () => void, tag = 0): number {
    const route = this.city.paths.find(from, to);
    if (!route || route.length < 30) return -1;
    return this.city.vehicles.spawn({ route, model, color, purpose, onArrive, tag });
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
