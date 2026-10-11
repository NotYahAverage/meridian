import type { Rng } from '../../core/rng';
import type { Building, Buildings } from '../buildings/Buildings';
import type { Population } from '../population/Population';
import { SERVICE_BY_ID } from '../services/ServiceTypes';
import { BuildingState, Zone, isResidential, zoneBase } from '../types';
import type { RoutePoint } from './Pathfinder';
import type { TripDemand } from './TrafficModel';
import { Purpose, VM } from './Vehicles';

export interface TripContext {
  buildings: Buildings;
  population: Population;
  /** A point on the road network at the outside connection, if any. */
  outsidePoint(): RoutePoint | null;
  /** Fraction of a worker's commute made by car (the rest uses transit). */
  carShare?(i: number, k: number): number;
}

export interface TripSample {
  from: RoutePoint;
  to: RoutePoint;
  purpose: Purpose;
  model: number;
  color: number;
}

const CAR_COLORS: [number, number][] = [
  [0xf2f2f0, 22], [0x1b1c1f, 18], [0xa9adb2, 16], [0x5d6168, 14], [0x1f3550, 7], [0x8e1b1b, 6],
  [0xc9bfa8, 4], [0x2f4a35, 3], [0x5a3b26, 3], [0x3c7ac0, 3], [0xd96f1e, 1], [0xe3c33a, 1],
];

export function pickCarColor(rng: Rng): number {
  return rng.weighted(CAR_COLORS, (c) => c[1])![0];
}

export function pickCarModel(rng: Rng): number {
  const r = rng.next();
  if (r < 0.4) return VM.sedan;
  if (r < 0.65) return VM.hatchback;
  if (r < 0.9) return VM.suv;
  return VM.van;
}

/** Peak-hour vehicle trips generated per unit. */
export const TRIP_RATES = {
  commutePerWorker: 0.55,
  shopPerHousehold: 0.07,
  visitorPerCommercialJob: 0.22,
  visitorPerOfficeJob: 0.08,
  exportPerIndustrialJob: 0.12,
  importPerCommercialJob: 0.06,
};

const SHOP_CELL = 200;

/** Commercial buildings bucketed on a coarse grid for nearest-shop queries. */
class ShopIndex {
  private cells = new Map<number, Building[]>();

  constructor(shops: Building[]) {
    for (const b of shops) {
      const k = this.key(Math.floor(b.cx / SHOP_CELL), Math.floor(b.cz / SHOP_CELL));
      const list = this.cells.get(k);
      if (list) list.push(b);
      else this.cells.set(k, [b]);
    }
  }

  private key(ix: number, iz: number): number {
    return (iz + 512) * 1024 + (ix + 512);
  }

  /** Up to `n` nearest shops within `radius`, nearest first. */
  nearest(x: number, z: number, radius: number, n: number, out: Building[] = []): Building[] {
    out.length = 0;
    const cx = Math.floor(x / SHOP_CELL), cz = Math.floor(z / SHOP_CELL);
    const rings = Math.ceil(radius / SHOP_CELL);
    const r2 = radius * radius;
    const dist: number[] = [];
    for (let ring = 0; ring <= rings; ring++) {
      // Every shop in later rings is at least (ring - 1) cells away.
      if (out.length >= n && (ring - 1) * SHOP_CELL > Math.sqrt(dist[n - 1])) break;
      for (let iz = cz - ring; iz <= cz + ring; iz++) {
        for (let ix = cx - ring; ix <= cx + ring; ix++) {
          if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== ring) continue;
          const list = this.cells.get(this.key(ix, iz));
          if (!list) continue;
          for (const b of list) {
            const d = (b.cx - x) ** 2 + (b.cz - z) ** 2;
            if (d > r2) continue;
            if (out.length < n) {
              out.push(b);
              dist.push(d);
            } else if (d < dist[n - 1]) {
              out[n - 1] = b;
              dist[n - 1] = d;
            } else continue;
            for (let k = out.length - 1; k > 0 && dist[k] < dist[k - 1]; k--) {
              [dist[k], dist[k - 1]] = [dist[k - 1], dist[k]];
              [out[k], out[k - 1]] = [out[k - 1], out[k]];
            }
          }
        }
      }
    }
    return out;
  }

  /** Every shop within `radius` (unordered). */
  within(x: number, z: number, radius: number): Building[] {
    const res: Building[] = [];
    const r2 = radius * radius;
    const rings = Math.ceil(radius / SHOP_CELL);
    const cx = Math.floor(x / SHOP_CELL), cz = Math.floor(z / SHOP_CELL);
    for (let iz = cz - rings; iz <= cz + rings; iz++) {
      for (let ix = cx - rings; ix <= cx + rings; ix++) {
        const list = this.cells.get(this.key(ix, iz));
        if (list) for (const b of list) if ((b.cx - x) ** 2 + (b.cz - z) ** 2 <= r2) res.push(b);
      }
    }
    return res;
  }
}

/** Generates aggregate OD demand for traffic assignment and samples individual visible trips. */
export class TripGenerator {
  res: number[] = [];
  com: number[] = [];
  ind: number[] = [];
  off: number[] = [];
  /** Landmarks and how many visitor trips each attracts in the peak hour. */
  sights: { id: number; trips: number }[] = [];
  employedHouseholds: number[] = [];
  private shops = new ShopIndex([]);

  constructor(private ctx: TripContext) {}

  refresh(): void {
    this.res = [];
    this.com = [];
    this.ind = [];
    this.off = [];
    this.sights = [];
    for (const b of this.ctx.buildings.all.values()) {
      if (b.kind === 'service' && b.state === BuildingState.Active && b.segId) {
        const st = SERVICE_BY_ID.get(b.typeId);
        if (st?.tourism) this.sights.push({ id: b.id, trips: st.tourism / 60 });
      }
      if (b.state !== BuildingState.Active || !b.segId || b.kind !== 'zoned') continue;
      if (isResidential(b.zone)) {
        if (b.households > 0) this.res.push(b.id);
      } else if (zoneBase(b.zone) === Zone.Commercial) this.com.push(b.id);
      else if (zoneBase(b.zone) === Zone.Industrial) this.ind.push(b.id);
      else if (b.zone === Zone.Office) this.off.push(b.id);
    }
    const shops: Building[] = [];
    for (const id of this.com) shops.push(this.ctx.buildings.get(id)!);
    this.shops = new ShopIndex(shops);
    const pop = this.ctx.population;
    this.employedHouseholds = [];
    for (let i = 0; i < pop.count; i++) {
      if (pop.alive[i] && (pop.job[i * 2] || pop.job[i * 2 + 1])) this.employedHouseholds.push(i);
    }
  }

  private pt(b: Building): RoutePoint {
    return { segId: b.segId, s: b.segS };
  }

  buildDemand(): TripDemand[] {
    const it = this.demandSteps(Infinity);
    for (;;) {
      const r = it.next();
      if (r.done) return r.value;
    }
  }

  /**
   * The same as buildDemand, in slices of `perStep` households so a big city
   * can spread the work over several ticks (each next() does one slice).
   */
  *demandSteps(perStep: number): Generator<void, TripDemand[], void> {
    const { buildings, population: pop } = this.ctx;
    // Numeric keys (point → point) instead of strings: big cities add up a million commutes here.
    const out: TripDemand[] = [];
    const pairs = new Map<number, Map<number, TripDemand>>();
    const key = (p: RoutePoint) => p.segId * 16384 + Math.min(16383, Math.max(0, Math.round(p.s)));
    const add = (from: RoutePoint, to: RoutePoint, trips: number) => {
      const fk = key(from);
      let m = pairs.get(fk);
      if (!m) pairs.set(fk, (m = new Map()));
      const tk = key(to);
      const p = m.get(tk);
      if (p) p.trips += trips;
      else {
        const d = { from, to, trips };
        m.set(tk, d);
        out.push(d);
      }
    };
    for (let i = 0; i < pop.count; i++) {
      if (i % perStep === perStep - 1) yield;
      if (!pop.alive[i]) continue;
      const home = buildings.get(pop.home[i]);
      if (!home || !home.segId) continue;
      for (let k = 0; k < 2; k++) {
        const j = pop.job[i * 2 + k];
        if (!j) continue;
        const work = buildings.get(j);
        if (!work || !work.segId) continue;
        const car = this.ctx.carShare ? this.ctx.carShare(i, k) : 1;
        if (car > 0.01) add(this.pt(home), this.pt(work), TRIP_RATES.commutePerWorker * car);
      }
    }
    // Shopping: each residential building to up to two nearby shops.
    const near: Building[] = [];
    for (const id of this.res) {
      const b = buildings.get(id);
      if (!b) continue;
      this.shops.nearest(b.cx, b.cz, 900, 2, near);
      if (!near.length) continue;
      const n = near.length;
      for (let k = 0; k < n; k++) add(this.pt(b), this.pt(near[k]), (b.households * TRIP_RATES.shopPerHousehold) / n);
    }
    const edge = this.ctx.outsidePoint();
    if (edge) {
      for (const id of this.com) {
        const b = buildings.get(id)!;
        add(edge, this.pt(b), b.workers * TRIP_RATES.visitorPerCommercialJob * 0.5);
        add(edge, this.pt(b), b.workers * TRIP_RATES.importPerCommercialJob);
      }
      for (const id of this.off) {
        const b = buildings.get(id)!;
        add(edge, this.pt(b), b.workers * TRIP_RATES.visitorPerOfficeJob);
      }
      for (const id of this.ind) {
        const b = buildings.get(id)!;
        add(this.pt(b), edge, b.workers * TRIP_RATES.exportPerIndustrialJob);
      }
      for (const s of this.sights) {
        const b = buildings.get(s.id);
        if (b) add(edge, this.pt(b), s.trips);
      }
    }
    return out;
  }

  /** Samples one visible trip appropriate for the time of day. */
  sample(rng: Rng, hour: number): TripSample | null {
    const { buildings, population: pop } = this.ctx;
    const morning = hour >= 5.5 && hour < 10.5;
    const evening = hour >= 15.5 && hour < 19.5;
    const r = rng.next();
    const commuteW = morning || evening ? 0.68 : 0.32;
    const out = this.ctx.outsidePoint();
    if (r < commuteW && this.employedHouseholds.length) {
      const h = this.employedHouseholds[Math.floor(rng.next() * this.employedHouseholds.length)];
      if (!pop.alive[h]) return null;
      // Commuters who ride the bus don't drive.
      if (this.ctx.carShare && !rng.chance(this.ctx.carShare(h, pop.job[h * 2] ? 0 : 1))) return null;
      const home = buildings.get(pop.home[h]);
      const job = buildings.get(pop.job[h * 2] || pop.job[h * 2 + 1]);
      if (!home || !job || !home.segId || !job.segId) return null;
      const toWork = morning ? true : evening ? false : rng.chance(0.5);
      return {
        from: this.pt(toWork ? home : job),
        to: this.pt(toWork ? job : home),
        purpose: Purpose.Commute,
        model: pickCarModel(rng),
        color: pickCarColor(rng),
      };
    }
    const r2 = rng.next();
    if (r2 < 0.5 && this.res.length && this.com.length) {
      const home = buildings.get(this.res[Math.floor(rng.next() * this.res.length)]);
      if (!home) return null;
      const near = this.shops.within(home.cx, home.cz, 1000).filter((o) => o.state === BuildingState.Active && o.segId);
      const shop = near.length ? near[Math.floor(rng.next() * near.length)] : buildings.get(this.com[Math.floor(rng.next() * this.com.length)]);
      if (!shop) return null;
      const there = rng.chance(0.55);
      return {
        from: this.pt(there ? home : shop),
        to: this.pt(there ? shop : home),
        purpose: Purpose.Shopping,
        model: pickCarModel(rng),
        color: pickCarColor(rng),
      };
    }
    if (r2 < 0.78 && (this.ind.length || this.com.length)) {
      const truck = rng.chance(0.55) ? VM.truck : VM.van;
      const color = truck === VM.truck ? rng.pick([0xe8e8e4, 0xd8d2c4, 0x35506e, 0x7a1f1f]) : rng.pick([0xf2f2f0, 0xe8e8e4, 0x9aa0a6]);
      if (this.ind.length && this.com.length && rng.chance(0.55)) {
        const a = buildings.get(this.ind[Math.floor(rng.next() * this.ind.length)])!;
        const b = buildings.get(this.com[Math.floor(rng.next() * this.com.length)])!;
        return { from: this.pt(a), to: this.pt(b), purpose: Purpose.Freight, model: truck, color };
      }
      if (out && this.ind.length && rng.chance(0.6)) {
        const a = buildings.get(this.ind[Math.floor(rng.next() * this.ind.length)])!;
        return rng.chance(0.5)
          ? { from: this.pt(a), to: out, purpose: Purpose.Freight, model: truck, color }
          : { from: out, to: this.pt(a), purpose: Purpose.Freight, model: truck, color };
      }
      if (out && this.com.length) {
        const b = buildings.get(this.com[Math.floor(rng.next() * this.com.length)])!;
        return { from: out, to: this.pt(b), purpose: Purpose.Freight, model: truck, color };
      }
    }
    if (out) {
      // Tourists head for the landmarks.
      if (this.sights.length && rng.chance(0.35)) {
        const b = buildings.get(this.sights[Math.floor(rng.next() * this.sights.length)].id);
        if (b) return { from: out, to: this.pt(b), purpose: Purpose.Visitor, model: pickCarModel(rng), color: pickCarColor(rng) };
      }
      const pool = this.com.length + this.off.length > 0 ? [...this.com, ...this.off] : this.res;
      if (!pool.length) return null;
      const b = buildings.get(pool[Math.floor(rng.next() * pool.length)])!;
      const inbound = rng.chance(0.5);
      return {
        from: inbound ? out : this.pt(b),
        to: inbound ? this.pt(b) : out,
        purpose: Purpose.Visitor,
        model: pickCarModel(rng),
        color: pickCarColor(rng),
      };
    }
    return null;
  }
}

/** Relative traffic intensity by hour of day (rush hours ≈ 1). */
export function timeOfDayFactor(hour: number): number {
  const g = (mu: number, sigma: number) => Math.exp(-((hour - mu) ** 2) / (2 * sigma * sigma));
  return Math.min(1.05, 0.14 + 0.86 * g(8, 1.3) + 0.5 * g(13, 2.4) + 0.92 * g(17.5, 1.5) + 0.3 * g(20.5, 1.5));
}
