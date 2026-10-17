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
  /**
   * Seconds to get through the junction at the end of a segment, arriving at its b end
   * (atB) or its a end; from the traffic model. Without it, a flat delay per kind of junction.
   */
  junctionDelay: ((segId: number, atB: boolean) => number) | null = null;
  searches = 0;
  /** Compact adjacency (edges leaving each node) for shortest-path trees. */
  private graph: { net: number; layout: number; start: Int32Array; to: Int32Array; seg: Int32Array; base: Float64Array } | null = null;
  /** Edge travel times including congestion, as of the last refreshCosts(). */
  private edgeCost = new Float64Array(0);
  private costsFresh = false;

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

  /** Delay crossing the junction at `toNode` after driving along `seg`. */
  private approachDelay(seg: RoadSegment, toNode: number): number {
    return this.junctionDelay ? this.junctionDelay(seg.id, seg.b === toNode) : this.nodePenalty(toNode);
  }

  nodePenalty(nodeId: number): number {
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
    cost += this.segTime(fs, Math.abs(s0end - fromS) / Math.max(1, fs.length)) + this.approachDelay(fs, path.startDir === 1 ? fs.b : fs.a);
    for (let i = 0; i < path.segs.length; i++) {
      const seg = this.net.segments.get(path.segs[i])!;
      const fromNode = path.nodes[i];
      const dir: 1 | -1 = seg.a === fromNode ? 1 : -1;
      legs.push({ segId: seg.id, dir, s0: dir === 1 ? 0 : seg.length, s1: dir === 1 ? seg.length : 0 });
      length += seg.length;
      cost += this.segTime(seg) + this.approachDelay(seg, dir === 1 ? seg.b : seg.a);
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
    onlyDir: 0 | 1 | -1 = 0,
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
    if (fs.oneway !== -1 && onlyDir !== -1) open(fs.b, this.segTime(fs, (fs.length - fromS) / Math.max(1, fs.length)) + this.approachDelay(fs, fs.b), -1, 0);
    if (fs.oneway !== 1 && onlyDir !== 1) open(fs.a, this.segTime(fs, fromS / Math.max(1, fs.length)) + this.approachDelay(fs, fs.a), -2, 0);

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
      for (const sid of node.segs) {
        if (sid === fs.id || sid === ts.id) continue;
        const seg = net.segments.get(sid)!;
        if (seg.oneway !== 0 && !RoadNetwork.allows(seg, nid)) continue;
        const other = seg.a === nid ? seg.b : seg.a;
        if (closed[other] === this.gen) continue;
        open(other, gc + this.segTime(seg) + this.approachDelay(seg, other), nid, sid);
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
   * A route from a point part way along a segment, carrying on in the direction of
   * travel (no turning round), with the given travel-time multipliers instead of the
   * usual ones. Not cached: for drivers changing their minds.
   */
  findAhead(from: RoutePoint, dir: 0 | 1 | -1, to: RoutePoint, mult: (segId: number) => number): Route | null {
    const fs = this.net.segments.get(from.segId);
    const ts = this.net.segments.get(to.segId);
    if (!fs || !ts || fs.id === ts.id) return null;
    const saved = this.congestion;
    this.congestion = mult;
    try {
      const found = this.search(fs, from.s, ts, to.s, dir);
      return found ? this.buildRoute(fs, from.s, ts, to.s, found) : null;
    } finally {
      this.congestion = saved;
    }
  }

  /** Rebuilds the compact graph when roads or junctions changed. */
  private ensureGraph(): NonNullable<Pathfinder['graph']> {
    const net = this.net;
    const gr = this.graph;
    if (gr && gr.net === net.version && gr.layout === this.layout.version) return gr;
    const n = net.nextNodeId + 1;
    const start = new Int32Array(n + 1);
    for (const node of net.nodes.values()) {
      for (const sid of node.segs) {
        const seg = net.segments.get(sid);
        if (seg && (seg.oneway === 0 || RoadNetwork.allows(seg, node.id))) start[node.id + 1]++;
      }
    }
    for (let i = 0; i < n; i++) start[i + 1] += start[i];
    const m = start[n];
    const to = new Int32Array(m), seg = new Int32Array(m), base = new Float64Array(m);
    const fill = start.slice(0, n);
    for (const node of net.nodes.values()) {
      for (const sid of node.segs) {
        const s = net.segments.get(sid);
        if (!s || !(s.oneway === 0 || RoadNetwork.allows(s, node.id))) continue;
        const e = fill[node.id]++;
        to[e] = s.a === node.id ? s.b : s.a;
        seg[e] = sid;
        base[e] = s.length / ROAD_TYPES[s.type].speed;
      }
    }
    this.graph = { net: net.version, layout: this.layout.version, start, to, seg, base };
    this.costsFresh = false;
    return this.graph;
  }

  /** Takes a snapshot of congestion for the trees that follow (called once per traffic cycle). */
  refreshCosts(): void {
    const gr = this.ensureGraph();
    if (this.edgeCost.length < gr.to.length) this.edgeCost = new Float64Array(gr.to.length);
    const mult = new Map<number, number>();
    for (let e = 0; e < gr.to.length; e++) {
      const sid = gr.seg[e];
      let k = mult.get(sid);
      if (k === undefined) mult.set(sid, (k = this.congestion(sid)));
      // Driving the segment, then getting through the junction at its far end.
      this.edgeCost[e] = gr.base[e] * k + this.approachDelay(this.net.segments.get(sid)!, gr.to[e]);
    }
    this.costsFresh = true;
  }

  /**
   * Single-source shortest-path tree from a point (for traffic assignment).
   * Returns per-node cost and parent segment arrays valid until the next call.
   * Runs over the compact graph with travel times from the last refreshCosts().
   */
  tree(from: RoutePoint): { cost: Float64Array; parentSeg: Int32Array; parentNode: Int32Array; stamp: Uint32Array; gen: number } | null {
    const net = this.net;
    const fs = net.segments.get(from.segId);
    if (!fs) return null;
    this.ensure();
    const gr = this.ensureGraph();
    if (!this.costsFresh) this.refreshCosts();
    const { start, to, seg } = gr;
    const ec = this.edgeCost;
    const gen = ++this.gen;
    if (gen >= 0xfffffff0) {
      this.stamp.fill(0);
      this.closed.fill(0);
      this.gen = 1;
      return this.tree(from);
    }
    const g = this.g;
    const stamp = this.stamp;
    const closed = this.closed;
    const parentNode = this.parentNode;
    const parentSeg = this.parentSeg;
    const heap = this.heap;
    heap.clear();
    const open = (nid: number, cost: number, pNode: number, pSeg: number) => {
      if (stamp[nid] === gen && g[nid] <= cost) return;
      stamp[nid] = gen;
      g[nid] = cost;
      parentNode[nid] = pNode;
      parentSeg[nid] = pSeg;
      heap.push(nid, cost);
    };
    if (fs.oneway !== -1) open(fs.b, this.segTime(fs, (fs.length - from.s) / Math.max(1, fs.length)) + this.approachDelay(fs, fs.b), -1, fs.id);
    if (fs.oneway !== 1) open(fs.a, this.segTime(fs, from.s / Math.max(1, fs.length)) + this.approachDelay(fs, fs.a), -2, fs.id);
    while (heap.size) {
      const nid = heap.pop();
      if (closed[nid] === gen) continue;
      closed[nid] = gen;
      const gc = g[nid];
      for (let e = start[nid], end = start[nid + 1]; e < end; e++) {
        const other = to[e];
        if (closed[other] === gen) continue;
        const c = gc + ec[e];
        if (stamp[other] === gen && g[other] <= c) continue;
        stamp[other] = gen;
        g[other] = c;
        parentNode[other] = nid;
        parentSeg[other] = seg[e];
        heap.push(other, c);
      }
    }
    return { cost: g, parentSeg, parentNode, stamp, gen };
  }
}
