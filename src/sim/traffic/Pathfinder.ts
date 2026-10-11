import { BinaryHeap } from '../../core/BinaryHeap';
import type { RoadLayout } from '../roads/RoadLayout';
import { RoadNetwork, type RoadSegment } from '../roads/RoadNetwork';
import { ROAD_TYPES } from '../roads/RoadTypes';

export interface RouteLeg {
  segId: number;
  /** +1 travels a→b, -1 travels b→a. */
  dir: 1 | -1;
  /** Start and end arc length along the segment (in a→b coordinates). */
  s0: number;
  s1: number;
}

export interface Route {
  legs: RouteLeg[];
  /** Estimated travel time in seconds. */
  cost: number;
  length: number;
}

export interface RoutePoint {
  segId: number;
  s: number;
}

const MAX_SPEED = 25;
const SIGNAL_PENALTY = 7;
const YIELD_PENALTY = 4;

/**
 * A* router over the road graph. Edge costs are travel times that include
 * congestion (via a per-segment time multiplier supplied by the traffic model).
 */
export class Pathfinder {
  private g = new Float64Array(0);
  private stamp = new Uint32Array(0);
  private closed = new Uint32Array(0);
  private parentNode = new Int32Array(0);
  private parentSeg = new Int32Array(0);
  private gen = 0;
  private heap = new BinaryHeap();
  private cache = new Map<string, { nodes: number[]; segs: number[]; startDir: 1 | -1; endDir: 1 | -1; version: number }>();
  private cacheVersion = -1;
  /** Travel-time multiplier per segment id (≥ 1). */
  congestion: (segId: number) => number = () => 1;
  searches = 0;

  constructor(private net: RoadNetwork, private layout: RoadLayout) {}

  private ensure(): void {
    const n = this.net.nextNodeId + 1;
    if (this.g.length >= n) return;
    const cap = Math.max(n, this.g.length * 2, 256);
    this.g = new Float64Array(cap);
    this.stamp = new Uint32Array(cap);
    this.closed = new Uint32Array(cap);
    this.parentNode = new Int32Array(cap);
    this.parentSeg = new Int32Array(cap);
  }

  segTime(seg: RoadSegment, fraction = 1): number {
    const rt = ROAD_TYPES[seg.type];
    return (seg.length * fraction) / rt.speed * this.congestion(seg.id);
  }

  private nodePenalty(nodeId: number): number {
    const lay = this.layout.get(nodeId);
    if (!lay) return 0;
    if (lay.control === 'signal') return SIGNAL_PENALTY;
    if (lay.control === 'yield') return YIELD_PENALTY;
    return 0;
  }

  invalidate(): void {
    this.cache.clear();
  }

  /** Finds a route between two points on the network, or null if unreachable. */
  find(from: RoutePoint, to: RoutePoint): Route | null {
    const net = this.net;
    const fs = net.segments.get(from.segId);
    const ts = net.segments.get(to.segId);
    if (!fs || !ts) return null;
    if (this.cacheVersion !== net.version) {
      this.cache.clear();
      this.cacheVersion = net.version;
    }

    const forward = to.s >= from.s;
    if (fs.id === ts.id && (fs.oneway === 0 || (fs.oneway === 1) === forward)) {
      const dir: 1 | -1 = forward ? 1 : -1;
      const len = Math.abs(to.s - from.s);
      return {
        legs: [{ segId: fs.id, dir, s0: from.s, s1: to.s }],
        cost: this.segTime(fs, len / Math.max(1, fs.length)),
        length: len,
      };
    }

    const key = `${fs.id}>${ts.id}`;
    let cached = this.cache.get(key);
    if (!cached || cached.version !== net.version) {
      const found = this.search(fs, from.s, ts, to.s);
      if (!found) return null;
      cached = { ...found, version: net.version };
      if (this.cache.size > 4000) this.cache.clear();
      this.cache.set(key, cached);
    }
    return this.buildRoute(fs, from.s, ts, to.s, cached);
  }

  private buildRoute(
    fs: RoadSegment,
    fromS: number,
    ts: RoadSegment,
    toS: number,
    path: { nodes: number[]; segs: number[]; startDir: 1 | -1; endDir: 1 | -1 },
  ): Route {
    const legs: RouteLeg[] = [];
    let cost = 0;
    let length = 0;
    // First leg: from point to the first node on the path.
    const s0end = path.startDir === 1 ? fs.length : 0;
    legs.push({ segId: fs.id, dir: path.startDir, s0: fromS, s1: s0end });
    length += Math.abs(s0end - fromS);
    cost += this.segTime(fs, Math.abs(s0end - fromS) / Math.max(1, fs.length));
    for (let i = 0; i < path.segs.length; i++) {
      const seg = this.net.segments.get(path.segs[i])!;
      const fromNode = path.nodes[i];
      const dir: 1 | -1 = seg.a === fromNode ? 1 : -1;
      legs.push({ segId: seg.id, dir, s0: dir === 1 ? 0 : seg.length, s1: dir === 1 ? seg.length : 0 });
      length += seg.length;
      cost += this.segTime(seg) + this.nodePenalty(fromNode);
    }
    const s1start = path.endDir === 1 ? 0 : ts.length;
    legs.push({ segId: ts.id, dir: path.endDir, s0: s1start, s1: toS });
    length += Math.abs(toS - s1start);
    cost += this.segTime(ts, Math.abs(toS - s1start) / Math.max(1, ts.length));
    return { legs, cost, length };
  }

  private search(
    fs: RoadSegment,
    fromS: number,
    ts: RoadSegment,
    toS: number,
  ): { nodes: number[]; segs: number[]; startDir: 1 | -1; endDir: 1 | -1 } | null {
    this.ensure();
    this.searches++;
    const net = this.net;
    const gen = ++this.gen;
    if (gen >= 0xfffffff0) {
      this.stamp.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    const g = this.g;
    const stamp = this.stamp;
    const closed = this.closed;
    const heap = this.heap;
    heap.clear();
    const goal = net.getNode(ts.a);
    const goalB = net.getNode(ts.b);
    const gx = (goal.x + goalB.x) / 2;
    const gz = (goal.z + goalB.z) / 2;
    const h = (nid: number) => {
      const n = net.nodes.get(nid)!;
      return Math.hypot(n.x - gx, n.z - gz) / MAX_SPEED;
    };
    const open = (nid: number, cost: number, pNode: number, pSeg: number) => {
      if (stamp[nid] === this.gen && g[nid] <= cost) return;
      stamp[nid] = this.gen;
      g[nid] = cost;
      this.parentNode[nid] = pNode;
      this.parentSeg[nid] = pSeg;
      heap.push(nid, cost + h(nid));
    };
    // Starting: leave the origin segment toward either end (one-way roads only forward).
    if (fs.oneway !== -1) open(fs.b, this.segTime(fs, (fs.length - fromS) / Math.max(1, fs.length)), -1, 0);
    if (fs.oneway !== 1) open(fs.a, this.segTime(fs, fromS / Math.max(1, fs.length)), -2, 0);

    const toA = ts.oneway === -1 ? Infinity : this.segTime(ts, toS / Math.max(1, ts.length));
    const toB = ts.oneway === 1 ? Infinity : this.segTime(ts, (ts.length - toS) / Math.max(1, ts.length));
    let bestCost = Infinity;
    let bestEnd = -1;
    let bestDir: 1 | -1 = 1;

    let iterations = 0;
    while (heap.size) {
      if (heap.peekPriority() >= bestCost) break;
      const nid = heap.pop();
      if (closed[nid] === this.gen) continue;
      closed[nid] = this.gen;
      if (++iterations > 60000) break;
      const gc = g[nid];
      if (nid === ts.a && gc + toA < bestCost) {
        bestCost = gc + toA;
        bestEnd = nid;
        bestDir = 1;
      }
      if (nid === ts.b && gc + toB < bestCost) {
        bestCost = gc + toB;
        bestEnd = nid;
        bestDir = -1;
      }
      const node = net.nodes.get(nid)!;
      const pen = this.nodePenalty(nid);
      for (const sid of node.segs) {
        if (sid === fs.id || sid === ts.id) continue;
        const seg = net.segments.get(sid)!;
        if (seg.oneway !== 0 && !RoadNetwork.allows(seg, nid)) continue;
        const other = seg.a === nid ? seg.b : seg.a;
        if (closed[other] === this.gen) continue;
        open(other, gc + this.segTime(seg) + pen, nid, sid);
      }
    }
    if (bestEnd < 0) return null;

    const nodes: number[] = [];
    const segs: number[] = [];
    let cur = bestEnd;
    let startDir: 1 | -1 = 1;
    for (let guard = 0; guard < 100000; guard++) {
      const p = this.parentNode[cur];
      if (p < 0) {
        startDir = p === -1 ? 1 : -1;
        break;
      }
      segs.push(this.parentSeg[cur]);
      nodes.push(p);
      cur = p;
    }
    nodes.reverse();
    segs.reverse();
    return { nodes, segs, startDir, endDir: bestDir };
  }

  /**
   * Single-source shortest-path tree from a point (for traffic assignment).
   * Returns per-node cost and parent segment arrays valid until the next call.
   */
  tree(from: RoutePoint): { cost: Float64Array; parentSeg: Int32Array; parentNode: Int32Array; stamp: Uint32Array; gen: number } | null {
    const net = this.net;
    const fs = net.segments.get(from.segId);
    if (!fs) return null;
    this.ensure();
    const gen = ++this.gen;
    const g = this.g;
    const stamp = this.stamp;
    const closed = this.closed;
    const heap = this.heap;
    heap.clear();
    const open = (nid: number, cost: number, pNode: number, pSeg: number) => {
      if (stamp[nid] === gen && g[nid] <= cost) return;
      stamp[nid] = gen;
      g[nid] = cost;
      this.parentNode[nid] = pNode;
      this.parentSeg[nid] = pSeg;
      heap.push(nid, cost);
    };
    if (fs.oneway !== -1) open(fs.b, this.segTime(fs, (fs.length - from.s) / Math.max(1, fs.length)), -1, fs.id);
    if (fs.oneway !== 1) open(fs.a, this.segTime(fs, from.s / Math.max(1, fs.length)), -2, fs.id);
    while (heap.size) {
      const nid = heap.pop();
      if (closed[nid] === gen) continue;
      closed[nid] = gen;
      const gc = g[nid];
      const node = net.nodes.get(nid)!;
      const pen = this.nodePenalty(nid);
      for (const sid of node.segs) {
        const seg = net.segments.get(sid)!;
        if (seg.oneway !== 0 && !RoadNetwork.allows(seg, nid)) continue;
        const other = seg.a === nid ? seg.b : seg.a;
        if (closed[other] === gen) continue;
        open(other, gc + this.segTime(seg) + pen, nid, sid);
      }
    }
    return { cost: g, parentSeg: this.parentSeg, parentNode: this.parentNode, stamp, gen };
  }
}
