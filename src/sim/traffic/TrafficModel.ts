import type { RoadLayout } from '../roads/RoadLayout';
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
  /** Streets merged into this group and the trips leaving each. */
  local?: { segId: number; trips: number }[];
}

/** Shortest-path trees per assignment cycle before nearby origins are merged. */
const MAX_TREES = 1000;

/**
 * Aggregated (macroscopic) traffic assignment. Origin–destination demand is
 * routed with shortest-path trees and accumulated into per-segment peak-hour
 * volumes. The work is spread over many ticks so it scales to large cities.
 */
export class TrafficModel {
  /** Peak-hour volume (vehicles/hour, both directions) per segment. */
  readonly volume = new Map<number, number>();
  /** Volumes being accumulated this cycle, by segment id. */
  private next = new Float64Array(256);
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

  /** Seconds to get through the junction at each segment end, by approach (segId × 2, + 1 arriving at b). */
  private delay = new Float32Array(0);
  /** How far the junction delays have taken over from the old flat ones (phased in for older cities). */
  delayScale = 1;
  /** Length of the busy period that queues build over (hours), and the most any one junction can hold someone up (s). */
  overflowHours = 0.1;
  maxDelay = 90;

  constructor(private net: RoadNetwork, private paths: Pathfinder, private layout?: RoadLayout) {
    if (layout) paths.junctionDelay = (segId, atB) => this.junctionDelay(segId, atB);
  }

  /** Research into roads and signals raises every road's capacity. */
  capacityScale = 1;

  capacity(segId: number): number {
    const seg = this.net.segments.get(segId);
    return seg ? segmentCapacity(ROAD_TYPES[seg.type]) * this.capacityScale : 1;
  }

  /** Volume/capacity ratio. */
  ratio(segId: number): number {
    return (this.volume.get(segId) ?? 0) / this.capacity(segId);
  }

  /**
   * Travel time multiplier from congestion along the road itself (BPR-style curve).
   * Most of the delay in a busy city is at junctions (below), so this is gentler once
   * junction delays are in.
   */
  multiplier(segId: number, demandScale = 1): number {
    const x = this.ratio(segId) * demandScale;
    return Math.min(6, 1 + (0.45 - 0.25 * this.delayScale) * x * x * x * x);
  }

  /** Seconds to get through the junction at the end of segment `segId` (its b end if atB). */
  junctionDelay(segId: number, atB: boolean): number {
    const k = segId * 2 + (atB ? 1 : 0);
    if (k < this.delay.length && this.delay[k] > 0) return this.delay[k];
    const seg = this.net.segments.get(segId);
    const flat = seg ? this.paths.nodePenalty(atB ? seg.b : seg.a) : 0;
    return flat;
  }

  /**
   * Junction delays from the volumes just assigned: at lights, from the share of green
   * each approach gets and how full it is (Webster's delay plus the overflow queue); at
   * junctions without lights, minor roads wait for gaps in the major road's traffic;
   * at roundabouts, entries wait for gaps in the circulating traffic. Phased in from
   * the old flat delays by `delayScale`.
   */
  private computeDelays(): void {
    const layout = this.layout;
    if (!layout) return;
    const net = this.net;
    let maxSeg = 0;
    for (const id of net.segments.keys()) maxSeg = Math.max(maxSeg, id);
    if (this.delay.length < (maxSeg + 1) * 2) this.delay = new Float32Array((maxSeg + 1) * 2 + 64);
    else this.delay.fill(0);
    const k = this.delayScale;
    const T = this.overflowHours;
    // Queueing delay (s) at an approach with capacity `cap` (veh/h) and demand `q`, after a fixed part.
    const queue = (cap: number, q: number) => {
      const x = q / Math.max(1, cap);
      return 900 * T * (x - 1 + Math.sqrt((x - 1) ** 2 + (4 * x) / (Math.max(1, cap) * T)));
    };
    const arms: { seg: number; atB: boolean; q: number; lanes: number; dx: number; dz: number; ring: boolean; cap: number }[] = [];
    for (const lay of layout.nodes.values()) {
      if (lay.kind !== 'junction' || lay.arms.length < 3 || lay.control === 'none') continue;
      arms.length = 0;
      for (const a of lay.arms) {
        const seg = net.segments.get(a.segId);
        if (!seg) continue;
        const dirInto = a.atA ? -1 : 1;
        if (seg.oneway !== 0 && seg.oneway !== dirInto) continue;
        const rt = ROAD_TYPES[seg.type];
        arms.push({
          seg: seg.id,
          atB: !a.atA,
          q: (this.volume.get(seg.id) ?? 0) * (seg.oneway !== 0 ? 1 : 0.5),
          lanes: rt.lanes * (seg.oneway !== 0 ? 2 : 1),
          dx: a.dx,
          dz: a.dz,
          ring: !!seg.ring,
          cap: segmentCapacity(rt),
        });
      }
      if (!arms.length) continue;
      const out = (a: (typeof arms)[number], d: number) => {
        const flat = this.paths.nodePenalty(lay.nodeId);
        this.delay[a.seg * 2 + (a.atB ? 1 : 0)] = Math.max(0.05, flat + k * (Math.min(this.maxDelay, d) - flat));
      };
      if (lay.control === 'signal') {
        // Opposite approaches share a phase.
        const phase = new Int32Array(arms.length).fill(-1);
        let phases = 0;
        for (let i = 0; i < arms.length; i++) {
          if (phase[i] >= 0) continue;
          phase[i] = phases;
          let best = -1, bestDot = -0.6;
          for (let j = 0; j < arms.length; j++) {
            if (phase[j] >= 0) continue;
            const dot = arms[i].dx * arms[j].dx + arms[i].dz * arms[j].dz;
            if (dot < bestDot) {
              bestDot = dot;
              best = j;
            }
          }
          if (best >= 0) phase[best] = phases;
          phases++;
        }
        const y = new Float64Array(phases);
        for (let i = 0; i < arms.length; i++) y[phase[i]] = Math.max(y[phase[i]], arms[i].q / this.capacityScale / (arms[i].lanes * 1800));
        let Y = 0;
        for (let p = 0; p < phases; p++) Y += y[p];
        const lost = 5 * phases;
        const C = Math.max(30, Math.min(120, (1.5 * lost + 5) / (1 - Math.min(0.9, Y))));
        for (let i = 0; i < arms.length; i++) {
          const a = arms[i];
          // A short link from another set of lights: coordinated, so traffic carries on through.
          const link = net.segments.get(a.seg)!;
          if (link.length - link.trimA - link.trimB < 30 && layout.get(link.a)?.control === 'signal' && layout.get(link.b)?.control === 'signal') {
            out(a, 2);
            continue;
          }
          const gC = Math.max(0.12, (1 - lost / C) * (Y > 0.01 ? y[phase[i]] / Y : 1 / phases));
          const cap = a.lanes * 1800 * gC * this.capacityScale;
          const x = a.q / cap;
          const d1 = (0.5 * C * (1 - gC) ** 2) / (1 - Math.min(1, x) * gC);
          out(a, d1 + queue(cap, a.q));
        }
      } else if (lay.control === 'roundabout') {
        let circulating = 0;
        for (const a of arms) if (!a.ring) circulating += a.q * 0.5;
        for (const a of arms) {
          if (a.ring) {
            out(a, 0.5);
            continue;
          }
          const cap = 1130 * Math.exp(-0.001 * circulating) * (a.lanes >= 2 ? 1.75 : 1) * this.capacityScale;
          out(a, 3600 / cap + queue(cap, a.q) + 3);
        }
      } else {
        // Give way: the two biggest roads (the straightest pair among equals) have priority.
        let bi = 0, bj = 1, best = -Infinity;
        for (let i = 0; i < arms.length; i++) {
          for (let j = i + 1; j < arms.length; j++) {
            const dot = arms[i].dx * arms[j].dx + arms[i].dz * arms[j].dz;
            const score = arms[i].cap + arms[j].cap - dot * 200;
            if (score > best) {
              best = score;
              bi = i;
              bj = j;
            }
          }
        }
        const major = arms.length > 1 ? arms[bi].q + arms[bj].q : 0;
        for (let i = 0; i < arms.length; i++) {
          const a = arms[i];
          if (i === bi || i === bj) {
            out(a, 1 + Math.min(20, major / 600));
            continue;
          }
          // Gap acceptance: critical gap 6 s, follow-up 3.3 s.
          const qc = Math.max(1, major);
          const c = (qc * Math.exp((-qc * 6) / 3600)) / (1 - Math.exp((-qc * 3.3) / 3600));
          // However busy the main road, someone always lets a few out.
          const cap = Math.max(250, c * Math.min(2, a.lanes) * 0.9) * this.capacityScale;
          const x = a.q / cap;
          out(a, 3600 / cap + 900 * T * (x - 1 + Math.sqrt((x - 1) ** 2 + ((3600 / cap) * x) / (450 * T))) + 5);
        }
      }
    }
  }

  /** Replaces the demand set; a new assignment cycle starts. */
  setDemand(trips: TripDemand[]): void {
    const groups = new Map<number, OriginGroup>();
    for (const t of trips) {
      if (t.trips <= 0) continue;
      // Trips leaving the same street share one shortest-path tree.
      const key = t.from.segId;
      let g = groups.get(key);
      if (!g) {
        g = { from: t.from, dests: [] };
        groups.set(key, g);
      }
      g.dests.push({ to: t.to, trips: t.trips });
    }
    this.queue = this.cluster([...groups.values()]);
    this.cursor = 0;
    this.next.fill(0);
    // Route this cycle with the congestion the last one found.
    this.paths.refreshCosts();
    this.accTime = this.accTrips = this.accUnreach = this.accTotal = 0;
  }

  /**
   * Huge cities: streets close together share one shortest-path tree, so a
   * cycle needs at most about MAX_TREES of them. Each street still carries its
   * own outgoing trips (`local`), which the cluster's tree would otherwise miss.
   */
  private cluster(groups: OriginGroup[]): OriginGroup[] {
    if (groups.length <= MAX_TREES) return groups;
    const pos = (g: OriginGroup) => {
      const seg = this.net.segments.get(g.from.segId);
      return seg ? { x: seg.cx, z: seg.cz } : { x: 0, z: 0 };
    };
    // Cell size so that the occupied cells come to about MAX_TREES.
    let cell = 96;
    let cells = new Map<number, OriginGroup[]>();
    for (let tries = 0; tries < 8; tries++) {
      cells = new Map();
      for (const g of groups) {
        const p = pos(g);
        const k = Math.floor(p.z / cell) * 4096 + Math.floor(p.x / cell);
        const list = cells.get(k);
        if (list) list.push(g);
        else cells.set(k, [g]);
      }
      if (cells.size <= MAX_TREES) break;
      cell *= 1.4;
    }
    const out: OriginGroup[] = [];
    for (const list of cells.values()) {
      const head = list[0];
      const merged: OriginGroup = { from: head.from, dests: [], local: [] };
      for (const g of list) {
        let trips = 0;
        for (const d of g.dests) {
          merged.dests.push(d);
          trips += d.trips;
        }
        if (g !== head) merged.local!.push({ segId: g.from.segId, trips });
      }
      out.push(merged);
    }
    return out;
  }

  get pending(): number {
    return this.queue.length - this.cursor;
  }

  /**
   * Processes at least `budget` origins (more in big cities, so a cycle always
   * finishes within about 40 ticks). Returns true when a cycle completed.
   */
  step(budget: number): boolean {
    budget = Math.max(budget, Math.ceil(this.queue.length / 40));
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
    if (segId >= this.next.length) {
      const grown = new Float64Array(Math.max(segId + 1, this.next.length * 2));
      grown.set(this.next);
      this.next = grown;
    }
    this.next[segId] += v;
  }

  private assignGroup(g: OriginGroup): void {
    if (g.local) for (const l of g.local) this.add(l.segId, l.trips);
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
    const next = this.next;
    for (let k = 0; k < next.length; k++) if (next[k] > 0) this.volume.set(k, next[k]);
    next.fill(0);
    this.computeDelays();
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
    if (segId < this.next.length) this.next[segId] = 0;
  }

  clear(): void {
    this.volume.clear();
    this.next.fill(0);
    this.queue = [];
    this.cursor = 0;
  }
}
