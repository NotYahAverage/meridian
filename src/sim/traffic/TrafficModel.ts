import type { RoadNetwork } from '../roads/RoadNetwork';
import { ROAD_TYPES, segmentCapacity } from '../roads/RoadTypes';
import type { Pathfinder, RoutePoint } from './Pathfinder';

export interface TripDemand {
  from: RoutePoint;
  to: RoutePoint;
  /** Vehicles in the peak hour. */
  trips: number;
}

interface OriginGroup {
  from: RoutePoint;
  dests: { to: RoutePoint; trips: number }[];
}

/**
 * Aggregated (macroscopic) traffic assignment. Origin–destination demand is
 * routed with shortest-path trees and accumulated into per-segment peak-hour
 * volumes. The work is spread over many ticks so it scales to large cities.
 */
export class TrafficModel {
  /** Peak-hour volume (vehicles/hour, both directions) per segment. */
  readonly volume = new Map<number, number>();
  private next = new Map<number, number>();
  private queue: OriginGroup[] = [];
  private cursor = 0;
  cycles = 0;

  // Results of the last completed cycle.
  totalTrips = 0;
  routedTrips = 0;
  unreachableTrips = 0;
  avgTripMinutes = 0;
  private accTime = 0;
  private accTrips = 0;
  private accUnreach = 0;
  private accTotal = 0;

  constructor(private net: RoadNetwork, private paths: Pathfinder) {}

  capacity(segId: number): number {
    const seg = this.net.segments.get(segId);
    return seg ? segmentCapacity(ROAD_TYPES[seg.type]) : 1;
  }

  /** Volume/capacity ratio. */
  ratio(segId: number): number {
    return (this.volume.get(segId) ?? 0) / this.capacity(segId);
  }

  /** Travel time multiplier from congestion (BPR-style curve). */
  multiplier(segId: number, demandScale = 1): number {
    const x = this.ratio(segId) * demandScale;
    return Math.min(6, 1 + 0.45 * x * x * x * x);
  }

  /** Replaces the demand set; a new assignment cycle starts. */
  setDemand(trips: TripDemand[]): void {
    const groups = new Map<string, OriginGroup>();
    for (const t of trips) {
      if (t.trips <= 0) continue;
      const key = `${t.from.segId}:${Math.round(t.from.s / 40)}`;
      let g = groups.get(key);
      if (!g) {
        g = { from: t.from, dests: [] };
        groups.set(key, g);
      }
      g.dests.push({ to: t.to, trips: t.trips });
    }
    this.queue = [...groups.values()];
    this.cursor = 0;
    this.next.clear();
    this.accTime = this.accTrips = this.accUnreach = this.accTotal = 0;
  }

  get pending(): number {
    return this.queue.length - this.cursor;
  }

  /** Processes up to `budget` origins. Returns true when a cycle completed. */
  step(budget: number): boolean {
    if (this.queue.length === 0) {
      if (this.volume.size) {
        this.volume.clear();
        this.cycles++;
        return true;
      }
      return false;
    }
    const end = Math.min(this.queue.length, this.cursor + budget);
    for (; this.cursor < end; this.cursor++) this.assignGroup(this.queue[this.cursor]);
    if (this.cursor >= this.queue.length) {
      this.finish();
      return true;
    }
    return false;
  }

  /** Runs a complete assignment synchronously (tests, load). */
  assignAll(): void {
    while (!this.step(1e9)) {
      if (this.queue.length === 0) break;
    }
  }

  private add(segId: number, v: number): void {
    this.next.set(segId, (this.next.get(segId) ?? 0) + v);
  }

  private assignGroup(g: OriginGroup): void {
    const tree = this.paths.tree(g.from);
    if (!tree) {
      for (const d of g.dests) {
        this.accUnreach += d.trips;
        this.accTotal += d.trips;
      }
      return;
    }
    const { cost, parentSeg, parentNode, stamp, gen } = tree;
    const net = this.net;
    for (const d of g.dests) {
      this.accTotal += d.trips;
      const ts = net.segments.get(d.to.segId);
      if (!ts) {
        this.accUnreach += d.trips;
        continue;
      }
      if (ts.id === g.from.segId) {
        this.add(ts.id, d.trips);
        this.accTrips += d.trips;
        this.accTime += (Math.abs(d.to.s - g.from.s) / ROAD_TYPES[ts.type].speed) * d.trips;
        continue;
      }
      const reachA = stamp[ts.a] === gen && ts.oneway !== -1;
      const reachB = stamp[ts.b] === gen && ts.oneway !== 1;
      if (!reachA && !reachB) {
        this.accUnreach += d.trips;
        continue;
      }
      const sp = ROAD_TYPES[ts.type].speed;
      const ca = reachA ? cost[ts.a] + d.to.s / sp : Infinity;
      const cb = reachB ? cost[ts.b] + (ts.length - d.to.s) / sp : Infinity;
      let cur = ca <= cb ? ts.a : ts.b;
      this.accTime += Math.min(ca, cb) * d.trips;
      this.accTrips += d.trips;
      this.add(ts.id, d.trips);
      for (let guard = 0; guard < 50000; guard++) {
        const p = parentNode[cur];
        const s = parentSeg[cur];
        this.add(s, d.trips);
        if (p < 0) break;
        cur = p;
      }
    }
  }

  private finish(): void {
    this.volume.clear();
    for (const [k, v] of this.next) this.volume.set(k, v);
    this.next.clear();
    this.totalTrips = this.accTotal;
    this.routedTrips = this.accTrips;
    this.unreachableTrips = this.accUnreach;
    this.avgTripMinutes = this.accTrips > 0 ? this.accTime / this.accTrips / 60 : 0;
    this.queue = [];
    this.cursor = 0;
    this.cycles++;
  }

  /** Drops volume for removed segments. */
  forget(segId: number): void {
    this.volume.delete(segId);
    this.next.delete(segId);
  }

  clear(): void {
    this.volume.clear();
    this.next.clear();
    this.queue = [];
    this.cursor = 0;
  }
}
