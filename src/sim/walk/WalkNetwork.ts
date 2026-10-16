import { BinaryHeap } from '../../core/BinaryHeap';
import { type PolyPoint, type Projection, lineIntersect, pointAt, projectOnPolyline } from '../../core/geom2d';
import type { NodeLayout, RoadLayout } from '../roads/RoadLayout';
import type { RoadNetwork, RoadSegment } from '../roads/RoadNetwork';
import { ROAD_TYPES, type RoadType } from '../roads/RoadTypes';

/** Average walking pace used for travel times (m/s). */
export const WALK_SPEED = 1.35;
/** Painted crosswalks are centred this far into a road from its trimmed junction end. */
export const CROSSWALK_INSET = 2.05;
/** On quiet streets people cross wherever they like; the network offers a crossing at least this often. */
const INFORMAL_SPACING = 45;

export enum WalkEdge {
  Sidewalk = 0,
  /** Around a junction corner, or on through a bend. */
  Corner = 1,
  /** Around the turning circle at a dead end. */
  EndCap = 2,
  /** Painted crosswalk at traffic lights. */
  Signal = 3,
  /** Painted crosswalk without lights (give-way junctions, roundabout approaches). */
  Zebra = 4,
  /** Crossing a quiet lane or street where there's no crosswalk (after looking for a gap). */
  Informal = 5,
}

export const isCrossing = (k: WalkEdge) => k >= WalkEdge.Signal;

/** Expected extra seconds spent at each kind of crossing (waiting for the lights or a gap). */
const CROSS_DELAY = [0, 0, 0, 12, 2, 5];

/** A spot on a sidewalk: beside segment `segId` at distance `s` along it, on `side` (+1 right of a→b, -1 left). */
export interface WalkLocation {
  segId: number;
  side: number;
  s: number;
}

/** One leg of a route: along `edge` from distance `from` to `to` (both measured from the edge's `a` end). */
export interface WalkStep {
  edge: number;
  from: number;
  to: number;
}

export interface WalkRoute {
  /** Seconds, including expected waits at crossings. */
  time: number;
  /** Metres walked. */
  length: number;
  steps: WalkStep[];
  crossings: number;
}

export interface WalkPoint {
  x: number;
  z: number;
  /** Unit direction of travel along the edge (a → b). */
  tx: number;
  tz: number;
}

/** Lateral offset of the walking line (middle of the paving) from the road centreline. */
export function walkOffset(rt: RoadType): number {
  return rt.asphaltHalf + 0.25 + (rt.sidewalk - 0.25) * 0.5;
}

/** Where people stand beside a road: mid-sidewalk, or just off the carriageway of a road without one. */
export function standOffset(rt: RoadType): number {
  return rt.sidewalk > 0 ? walkOffset(rt) : rt.asphaltHalf + Math.min(0.9, rt.verge * 0.6);
}

/** Quiet roads people cross without a crosswalk. */
export function crossesAnywhere(rt: RoadType): boolean {
  return rt.id === 'lane' || rt.id === 'street';
}

/** Whether any road at a junction has sidewalks (so people come there at all). */
export function servesPedestrians(layout: RoadLayout, lay: NodeLayout): boolean {
  return lay.arms.some((a) => {
    const seg = layout.net.segments.get(a.segId);
    return !!seg && ROAD_TYPES[seg.type].sidewalk > 0;
  });
}

/**
 * Whether there's a marked crosswalk across the end of `seg` at node `nodeId`: at every
 * junction of three or more roads with sidewalks, and at traffic lights across any road
 * (people cross a highway while the lights hold its traffic, though never between junctions).
 * Never across a roundabout's ring.
 */
export function hasCrosswalk(layout: RoadLayout, nodeId: number, seg: RoadSegment): boolean {
  if (seg.ring) return false;
  const lay = layout.get(nodeId);
  if (!lay || lay.kind !== 'junction' || lay.arms.length < 3) return false;
  if (ROAD_TYPES[seg.type].sidewalk > 0) return true;
  return lay.control === 'signal' && servesPedestrians(layout, lay);
}

/** Distance along a segment of the crossing point at one of its ends (the middle of the painted stripes). */
export function crossingS(seg: RoadSegment, end: 0 | 1): number {
  const lo = seg.trimA + CROSSWALK_INSET, hi = seg.length - seg.trimB - CROSSWALK_INSET;
  if (hi < lo) return (seg.trimA + seg.length - seg.trimB) / 2;
  return end === 0 ? lo : hi;
}

/** Roads whose median gives people crossing at a crosswalk somewhere to wait halfway. */
export function hasRefuge(rt: RoadType): boolean {
  return rt.medianKind === 'grass' || rt.medianKind === 'barrier';
}

const sideKey = (segId: number, side: number) => segId * 2 + (side > 0 ? 0 : 1);
const endKey = (segId: number, side: number, end: number) => segId * 4 + (side > 0 ? 0 : 2) + end;

/**
 * The pedestrian network: both sidewalks of every road that has them, joined
 * around junction corners and dead ends, and across roads at crosswalks
 * (with or without lights) and, on quiet streets, wherever people would cross.
 * Roads without sidewalks (highways, parkways) are barriers: the only ways
 * over them are bridges and the roads that pass beneath. Derived from the road
 * layout and rebuilt lazily whenever it changes.
 */
export class WalkNetwork {
  /** Bumped on every rebuild. */
  version = 0;
  private builtFor = -1;
  private builtNet = -1;

  // Nodes.
  nodeCount = 0;
  nodeX = new Float64Array(0);
  nodeZ = new Float64Array(0);
  /** Connected component of each node: people can only walk within one. */
  component = new Int32Array(0);

  // Edges.
  edgeCount = 0;
  kind = new Uint8Array(0);
  ea = new Int32Array(0);
  eb = new Int32Array(0);
  len = new Float32Array(0);
  cost = new Float32Array(0);
  /** Road segment walked beside (sidewalks) or crossed (crossings); 0 for corners and end caps. */
  seg = new Int32Array(0);
  /** Road node of corners, end caps and junction crosswalks; 0 elsewhere. */
  node = new Int32Array(0);
  /** Sidewalks: side of the road and the stretch of it covered. */
  side = new Int8Array(0);
  s0 = new Float32Array(0);
  s1 = new Float32Array(0);
  /** Other edges: polyline in `pts` (x, z pairs). */
  ptStart = new Int32Array(0);
  ptCount = new Int32Array(0);
  pts = new Float32Array(0);

  // Adjacency (CSR).
  private adjStart = new Int32Array(1);
  private adjEdge = new Int32Array(0);
  /** Sidewalk pieces of each road side: first edge and count (in order along the road), and walking offset. */
  private sides = new Map<number, { first: number; count: number; offset: number }>();

  // Search scratch (allocation-free after a rebuild).
  private heap = new BinaryHeap();
  private g = new Float64Array(0);
  private prevEdge = new Int32Array(0);
  private stamp = new Uint32Array(0);
  private closed = new Uint32Array(0);
  private search = 0;
  private pp: PolyPoint = { x: 0, z: 0, tx: 0, tz: 0, i: 0 };
  private proj: Projection = { s: 0, dist: 0, x: 0, z: 0, side: 1 };
  private wp: WalkPoint = { x: 0, z: 0, tx: 1, tz: 0 };

  constructor(private layout: RoadLayout) {}

  private get net(): RoadNetwork {
    return this.layout.net;
  }

  /** Rebuilds the graph if the roads changed since it was last built. */
  ensure(): void {
    if (this.builtFor === this.layout.version && this.builtNet === this.net.version) return;
    this.build();
  }

  // ── Construction ──────────────────────────────────────────────────────────

  private build(): void {
    this.builtFor = this.layout.version;
    this.builtNet = this.net.version;
    this.version++;
    const net = this.net;
    const nx: number[] = [], nz: number[] = [];
    const ends = new Map<number, number>();
    const E = {
      kind: [] as number[], a: [] as number[], b: [] as number[], len: [] as number[], seg: [] as number[], node: [] as number[],
      side: [] as number[], s0: [] as number[], s1: [] as number[], ptStart: [] as number[], ptCount: [] as number[],
    };
    const pts: number[] = [];
    const sides = new Map<number, { first: number; count: number; offset: number }>();
    const p = this.pp;
    const addNode = (x: number, z: number) => {
      nx.push(x);
      nz.push(z);
      return nx.length - 1;
    };
    const polyLength = (poly: number[]) => {
      let l = 0;
      for (let i = 2; i < poly.length; i += 2) l += Math.hypot(poly[i] - poly[i - 2], poly[i + 1] - poly[i - 1]);
      return l;
    };
    const addEdge = (kind: WalkEdge, a: number, b: number, segId: number, nodeId: number, poly: number[] | null, length = poly ? polyLength(poly) : 0, side = 0, s0 = 0, s1 = 0) => {
      E.kind.push(kind);
      E.a.push(a);
      E.b.push(b);
      E.len.push(Math.max(0.01, length));
      E.seg.push(segId);
      E.node.push(nodeId);
      E.side.push(side);
      E.s0.push(s0);
      E.s1.push(s1);
      E.ptStart.push(poly ? pts.length / 2 : 0);
      E.ptCount.push(poly ? poly.length / 2 : 0);
      if (poly) for (const v of poly) pts.push(v);
    };
    const at = (seg: RoadSegment, s: number, u: number): [number, number] => {
      pointAt(seg.poly, s, p);
      return [p.x - p.tz * u, p.z + p.tx * u];
    };

    // 1. Sidewalks: each side of each road, split where people cross quiet streets mid-block.
    const innerRing = this.innerRingSides();
    for (const seg of net.segments.values()) {
      const rt = ROAD_TYPES[seg.type];
      if (rt.sidewalk <= 0) continue;
      const sa = crossingS(seg, 0), sb = crossingS(seg, 1);
      const st = [sa];
      const informal = crossesAnywhere(rt) && !seg.ring;
      if (informal) {
        const n = Math.floor((sb - sa) / INFORMAL_SPACING);
        for (let k = 1; k <= n; k++) st.push(sa + ((sb - sa) * k) / (n + 1));
      }
      st.push(sb);
      const u = walkOffset(rt);
      const sideNodes: number[][] = [];
      for (const side of [1, -1]) {
        if (innerRing.has(sideKey(seg.id, side))) continue;
        const ids = st.map((s) => {
          const [x, z] = at(seg, s, u * side);
          return addNode(x, z);
        });
        sideNodes.push(ids);
        ends.set(endKey(seg.id, side, 0), ids[0]);
        ends.set(endKey(seg.id, side, 1), ids[ids.length - 1]);
        sides.set(sideKey(seg.id, side), { first: E.kind.length, count: ids.length - 1, offset: u });
        for (let k = 0; k + 1 < ids.length; k++) addEdge(WalkEdge.Sidewalk, ids[k], ids[k + 1], seg.id, 0, null, st[k + 1] - st[k], side, st[k], st[k + 1]);
      }
      if (informal && sideNodes.length === 2) {
        const [r, l] = sideNodes;
        for (let k = 1; k < st.length - 1; k++) addEdge(WalkEdge.Informal, r[k], l[k], seg.id, 0, [nx[r[k]], nz[r[k]], nx[l[k]], nz[l[k]]]);
      }
    }

    // Roads without sidewalks get standing spots only where people cross them at the lights.
    for (const lay of this.layout.nodes.values()) {
      if (lay.control !== 'signal') continue;
      for (const arm of lay.arms) {
        const seg = net.segments.get(arm.segId);
        if (!seg || ROAD_TYPES[seg.type].sidewalk > 0 || !hasCrosswalk(this.layout, lay.nodeId, seg)) continue;
        const end = arm.atA ? 0 : 1;
        const u = standOffset(ROAD_TYPES[seg.type]);
        for (const side of [1, -1]) {
          const [x, z] = at(seg, crossingS(seg, end), u * side);
          ends.set(endKey(seg.id, side, end), addNode(x, z));
        }
      }
    }

    // 2. Junction corners, bends and dead ends.
    for (const lay of this.layout.nodes.values()) {
      const arms = lay.arms;
      if (lay.kind === 'isolated') continue;
      if (lay.kind === 'end') {
        const a = arms[0];
        const seg = net.segments.get(a.segId);
        if (!seg || ROAD_TYPES[seg.type].sidewalk <= 0) continue;
        const end = a.atA ? 0 : 1;
        const from = ends.get(endKey(seg.id, a.atA ? 1 : -1, end));
        const to = ends.get(endKey(seg.id, a.atA ? -1 : 1, end));
        if (from === undefined || to === undefined) continue;
        const u = walkOffset(ROAD_TYPES[seg.type]);
        const rx = -a.tz, rz = a.tx;
        const poly = [nx[from], nz[from]];
        const N = 10;
        for (let k = 0; k <= N; k++) {
          const phi = (k / N) * Math.PI;
          poly.push(a.px + rx * u * Math.cos(phi) - a.tx * u * Math.sin(phi), a.pz + rz * u * Math.cos(phi) - a.tz * u * Math.sin(phi));
        }
        poly.push(nx[to], nz[to]);
        addEdge(WalkEdge.EndCap, from, to, 0, lay.nodeId, poly);
        continue;
      }
      // Arm i's right-hand sidewalk (looking out from the node) meets arm j's left-hand one around the corner.
      const n = arms.length;
      for (let i = 0; i < n; i++) {
        const a = arms[i];
        const b = arms[(i + 1) % n];
        const sa = net.segments.get(a.segId), sb = net.segments.get(b.segId);
        if (!sa || !sb) continue;
        const from = ends.get(endKey(sa.id, a.atA ? 1 : -1, a.atA ? 0 : 1));
        const to = ends.get(endKey(sb.id, b.atA ? -1 : 1, b.atA ? 0 : 1));
        if (from === undefined || to === undefined) continue;
        const ui = standOffset(ROAD_TYPES[sa.type]), uj = standOffset(ROAD_TYPES[sb.type]);
        const pa: [number, number] = [a.px - a.tz * ui, a.pz + a.tx * ui];
        const pb: [number, number] = [b.px + b.tz * uj, b.pz - b.tx * uj];
        let c: [number, number] = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
        const hit = lineIntersect(pa[0], pa[1], a.tx, a.tz, pb[0], pb[1], b.tx, b.tz);
        if (hit && hit.t < 0.5 && hit.u < 0.5 && hit.t > -60 && hit.u > -60) c = [pa[0] + a.tx * hit.t, pa[1] + a.tz * hit.t];
        const poly = [nx[from], nz[from]];
        const N = lay.kind === 'through' ? 1 : 7;
        for (let k = 0; k <= N; k++) {
          const t = k / N, w = 1 - t;
          poly.push(w * w * pa[0] + 2 * w * t * c[0] + t * t * pb[0], w * w * pa[1] + 2 * w * t * c[1] + t * t * pb[1]);
        }
        poly.push(nx[to], nz[to]);
        addEdge(WalkEdge.Corner, from, to, 0, lay.nodeId, poly);
      }
      // Crossings at the end of each arm: crosswalks at junctions, informal ones on quiet streets.
      for (const arm of arms) {
        const seg = net.segments.get(arm.segId);
        if (!seg || seg.ring) continue;
        const rt = ROAD_TYPES[seg.type];
        const end = arm.atA ? 0 : 1;
        const a = ends.get(endKey(seg.id, 1, end)), b = ends.get(endKey(seg.id, -1, end));
        if (a === undefined || b === undefined) continue;
        const marked = hasCrosswalk(this.layout, lay.nodeId, seg);
        if (!marked && !crossesAnywhere(rt)) continue;
        const kind = marked ? (lay.control === 'signal' ? WalkEdge.Signal : WalkEdge.Zebra) : WalkEdge.Informal;
        if (hasRefuge(rt) && kind !== WalkEdge.Informal) {
          // Wide medians (planted, or a barrier with a gap cut for the crosswalk) give people a refuge halfway across.
          const [mx, mz] = at(seg, crossingS(seg, end), 0);
          const m = addNode(mx, mz);
          addEdge(kind, a, m, seg.id, lay.nodeId, [nx[a], nz[a], mx, mz]);
          addEdge(kind, m, b, seg.id, lay.nodeId, [mx, mz, nx[b], nz[b]]);
        } else {
          addEdge(kind, a, b, seg.id, lay.nodeId, [nx[a], nz[a], nx[b], nz[b]]);
        }
      }
    }

    // 3. Pack into typed arrays and build the adjacency lists.
    const n = nx.length, m = E.kind.length;
    this.nodeCount = n;
    this.nodeX = Float64Array.from(nx);
    this.nodeZ = Float64Array.from(nz);
    this.edgeCount = m;
    this.kind = Uint8Array.from(E.kind);
    this.ea = Int32Array.from(E.a);
    this.eb = Int32Array.from(E.b);
    this.len = Float32Array.from(E.len);
    this.seg = Int32Array.from(E.seg);
    this.node = Int32Array.from(E.node);
    this.side = Int8Array.from(E.side);
    this.s0 = Float32Array.from(E.s0);
    this.s1 = Float32Array.from(E.s1);
    this.ptStart = Int32Array.from(E.ptStart);
    this.ptCount = Int32Array.from(E.ptCount);
    this.pts = Float32Array.from(pts);
    // Never cheaper than the straight line between the ends, so the A* heuristic stays exact.
    this.cost = new Float32Array(m);
    for (let e = 0; e < m; e++) {
      const chord = Math.hypot(nx[E.a[e]] - nx[E.b[e]], nz[E.a[e]] - nz[E.b[e]]);
      this.cost[e] = Math.max(this.len[e], chord) / WALK_SPEED + CROSS_DELAY[this.kind[e]];
    }
    const start = new Int32Array(n + 1);
    for (let e = 0; e < m; e++) {
      start[this.ea[e] + 1]++;
      start[this.eb[e] + 1]++;
    }
    for (let i = 0; i < n; i++) start[i + 1] += start[i];
    const fill = start.slice(0, n);
    const adj = new Int32Array(m * 2);
    for (let e = 0; e < m; e++) {
      adj[fill[this.ea[e]]++] = e;
      adj[fill[this.eb[e]]++] = e;
    }
    this.adjStart = start;
    this.adjEdge = adj;
    this.sides = sides;
    this.g = new Float64Array(n);
    this.prevEdge = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.search = 0;
    this.labelComponents();
  }

  /** Sidewalks on the inside of a roundabout ring face the central island: nobody walks there. */
  private innerRingSides(): Set<number> {
    const out = new Set<number>();
    const net = this.net;
    if (!net.roundabouts.size) return out;
    for (const seg of net.segments.values()) {
      if (!seg.ring) continue;
      const mid = seg.poly.count >> 1;
      const mx = seg.poly.pts[mid * 2], mz = seg.poly.pts[mid * 2 + 1];
      let best = Infinity, cx = 0, cz = 0;
      for (const rb of net.roundabouts.values()) {
        const d = Math.hypot(rb.x - mx, rb.z - mz);
        if (d < best) {
          best = d;
          cx = rb.x;
          cz = rb.z;
        }
      }
      out.add(sideKey(seg.id, projectOnPolyline(seg.poly, cx, cz, this.proj).side));
    }
    return out;
  }

  private labelComponents(): void {
    const n = this.nodeCount;
    const comp = new Int32Array(n).fill(-1);
    const stack: number[] = [];
    let c = 0;
    for (let i = 0; i < n; i++) {
      if (comp[i] >= 0) continue;
      comp[i] = c;
      stack.push(i);
      while (stack.length) {
        const v = stack.pop()!;
        for (let k = this.adjStart[v]; k < this.adjStart[v + 1]; k++) {
          const e = this.adjEdge[k];
          const w = this.ea[e] === v ? this.eb[e] : this.ea[e];
          if (comp[w] < 0) {
            comp[w] = c;
            stack.push(w);
          }
        }
      }
      c++;
    }
    this.component = comp;
  }

  // ── Locations ─────────────────────────────────────────────────────────────

  /** The sidewalk piece a location lies on, or -1 if that side of the road has no sidewalk. */
  edgeAt(loc: WalkLocation): number {
    this.ensure();
    const sd = this.sides.get(sideKey(loc.segId, loc.side));
    if (!sd || sd.count <= 0) return -1;
    for (let k = 0; k < sd.count - 1; k++) if (loc.s <= this.s1[sd.first + k]) return sd.first + k;
    return sd.first + sd.count - 1;
  }

  /** A walkable spot beside a road, on the requested side if it has a sidewalk (else the other one). */
  locate(segId: number, side: number, s: number): WalkLocation | null {
    this.ensure();
    for (const sd of [side >= 0 ? 1 : -1, side >= 0 ? -1 : 1]) {
      const info = this.sides.get(sideKey(segId, sd));
      if (!info || info.count <= 0) continue;
      const lo = this.s0[info.first], hi = this.s1[info.first + info.count - 1];
      return { segId, side: sd, s: Math.min(hi, Math.max(lo, s)) };
    }
    return null;
  }

  /** Where people walk to and from a building: the sidewalk in front of its door. */
  locationOf(b: { segId: number; segS: number; side: number }): WalkLocation | null {
    if (!b.segId) return null;
    return this.locate(b.segId, b.side, b.segS);
  }

  /** Nearest sidewalk spot to a world point (within `radius` of a road). */
  nearest(x: number, z: number, radius = 60): WalkLocation | null {
    const hit = this.net.nearestSegment(x, z, radius, (s) => ROAD_TYPES[s.type].sidewalk > 0);
    if (!hit) return null;
    return this.locate(hit.seg.id, hit.proj.side, hit.proj.s);
  }

  /** World position of a location on the walking line. */
  pointOf(loc: WalkLocation, out: WalkPoint = { x: 0, z: 0, tx: 1, tz: 0 }): WalkPoint {
    const e = this.edgeAt(loc);
    if (e < 0) return out;
    return this.pointOnEdge(e, loc.s - this.s0[e], out);
  }

  /** Point `t` metres along edge `e` from its `a` end. */
  pointOnEdge(e: number, t: number, out: WalkPoint = this.wp): WalkPoint {
    if (this.kind[e] === WalkEdge.Sidewalk) {
      const seg = this.net.segments.get(this.seg[e]);
      if (!seg) return out;
      const p = this.pp;
      pointAt(seg.poly, this.s0[e] + Math.min(this.len[e], Math.max(0, t)), p);
      const u = this.offsetOf(e);
      out.x = p.x - p.tz * u;
      out.z = p.z + p.tx * u;
      out.tx = p.tx;
      out.tz = p.tz;
      return out;
    }
    const pts = this.pts;
    let i = this.ptStart[e];
    const last = i + this.ptCount[e] - 1;
    let left = Math.max(0, t);
    for (; i < last; i++) {
      const dx = pts[i * 2 + 2] - pts[i * 2], dz = pts[i * 2 + 3] - pts[i * 2 + 1];
      const l = Math.hypot(dx, dz);
      if (left <= l || i === last - 1) {
        const f = l > 1e-6 ? Math.min(1, left / l) : 0;
        out.x = pts[i * 2] + dx * f;
        out.z = pts[i * 2 + 1] + dz * f;
        if (l > 1e-6) {
          out.tx = dx / l;
          out.tz = dz / l;
        }
        return out;
      }
      left -= l;
    }
    out.x = pts[last * 2];
    out.z = pts[last * 2 + 1];
    return out;
  }

  /** Lateral offset (signed, + = right of a→b) of a sidewalk piece's walking line. */
  offsetOf(e: number): number {
    const info = this.sides.get(sideKey(this.seg[e], this.side[e]));
    return (info?.offset ?? 0) * this.side[e];
  }

  /** Points along an edge, about every `step` metres (for drawing). */
  edgePolyline(e: number, step = 4): number[] {
    const out: number[] = [];
    if (this.kind[e] !== WalkEdge.Sidewalk) {
      for (let i = this.ptStart[e], end = i + this.ptCount[e]; i < end; i++) out.push(this.pts[i * 2], this.pts[i * 2 + 1]);
      return out;
    }
    const n = Math.max(1, Math.ceil(this.len[e] / step));
    for (let k = 0; k <= n; k++) {
      const p = this.pointOnEdge(e, (this.len[e] * k) / n);
      out.push(p.x, p.z);
    }
    return out;
  }

  // ── Routing ───────────────────────────────────────────────────────────────

  /** Whether two places are connected on foot at all. */
  connected(from: WalkLocation, to: WalkLocation): boolean {
    const a = this.edgeAt(from), b = this.edgeAt(to);
    return a >= 0 && b >= 0 && this.component[this.ea[a]] === this.component[this.ea[b]];
  }

  /** Quickest walk between two sidewalk locations (A*), or null if they aren't connected. */
  route(from: WalkLocation, to: WalkLocation): WalkRoute | null {
    const ef = this.edgeAt(from), et = this.edgeAt(to);
    if (ef < 0 || et < 0 || this.component[this.ea[ef]] !== this.component[this.ea[et]]) return null;
    const tf = Math.min(this.len[ef], Math.max(0, from.s - this.s0[ef]));
    const tt = Math.min(this.len[et], Math.max(0, to.s - this.s0[et]));
    let best = ef === et ? Math.abs(tf - tt) / WALK_SPEED : Infinity;
    let bestNode = -1;
    const goal = this.pointOnEdge(et, tt);
    const gx = goal.x, gz = goal.z;
    const ga = this.ea[et], gb = this.eb[et];
    const tailA = tt / WALK_SPEED, tailB = (this.len[et] - tt) / WALK_SPEED;
    const id = this.nextSearch();
    const heap = this.heap;
    heap.clear();
    const seed = (v: number, cost: number) => {
      if (this.stamp[v] === id && this.g[v] <= cost) return;
      this.stamp[v] = id;
      this.g[v] = cost;
      this.prevEdge[v] = -1;
      heap.push(v, cost + Math.hypot(this.nodeX[v] - gx, this.nodeZ[v] - gz) / WALK_SPEED);
    };
    seed(this.ea[ef], tf / WALK_SPEED);
    seed(this.eb[ef], (this.len[ef] - tf) / WALK_SPEED);
    while (heap.size) {
      if (heap.peekPriority() >= best) break;
      const v = heap.pop();
      if (this.closed[v] === id) continue;
      this.closed[v] = id;
      const gv = this.g[v];
      if (v === ga && gv + tailA < best) {
        best = gv + tailA;
        bestNode = v;
      }
      if (v === gb && gv + tailB < best) {
        best = gv + tailB;
        bestNode = v;
      }
      for (let k = this.adjStart[v]; k < this.adjStart[v + 1]; k++) {
        const e = this.adjEdge[k];
        const w = this.ea[e] === v ? this.eb[e] : this.ea[e];
        if (this.closed[w] === id) continue;
        const ng = gv + this.cost[e];
        if (this.stamp[w] === id && this.g[w] <= ng) continue;
        this.stamp[w] = id;
        this.g[w] = ng;
        this.prevEdge[w] = e;
        heap.push(w, ng + Math.hypot(this.nodeX[w] - gx, this.nodeZ[w] - gz) / WALK_SPEED);
      }
    }
    if (best === Infinity) return null;
    const steps: WalkStep[] = [];
    if (bestNode < 0) {
      steps.push({ edge: ef, from: tf, to: tt });
    } else {
      steps.push({ edge: et, from: bestNode === ga ? 0 : this.len[et], to: tt });
      let v = bestNode;
      while (this.prevEdge[v] >= 0) {
        const e = this.prevEdge[v];
        const fromA = this.eb[e] === v;
        steps.push({ edge: e, from: fromA ? 0 : this.len[e], to: fromA ? this.len[e] : 0 });
        v = fromA ? this.ea[e] : this.eb[e];
      }
      steps.push({ edge: ef, from: tf, to: v === this.ea[ef] ? 0 : this.len[ef] });
      steps.reverse();
    }
    let length = 0, crossings = 0;
    const out: WalkStep[] = [];
    for (const s of steps) {
      const d = Math.abs(s.to - s.from);
      if (d < 1e-4 && this.kind[s.edge] === WalkEdge.Sidewalk) continue;
      length += d;
      if (isCrossing(this.kind[s.edge])) crossings++;
      out.push(s);
    }
    return { time: best, length, steps: out, crossings };
  }

  /** Walking time from a location to every node, up to `maxTime` seconds (Infinity beyond). */
  timesFrom(from: WalkLocation, maxTime: number, out?: Float32Array): Float32Array {
    this.ensure();
    const n = this.nodeCount;
    const t = out && out.length >= n ? out : new Float32Array(n);
    t.fill(Infinity, 0, n);
    const ef = this.edgeAt(from);
    if (ef < 0) return t;
    const tf = Math.min(this.len[ef], Math.max(0, from.s - this.s0[ef]));
    const heap = this.heap;
    heap.clear();
    const id = this.nextSearch();
    const relax = (v: number, c: number) => {
      if (c > maxTime || c >= t[v]) return;
      t[v] = c;
      heap.push(v, c);
    };
    relax(this.ea[ef], tf / WALK_SPEED);
    relax(this.eb[ef], (this.len[ef] - tf) / WALK_SPEED);
    while (heap.size) {
      const v = heap.pop();
      if (this.closed[v] === id) continue;
      this.closed[v] = id;
      for (let k = this.adjStart[v]; k < this.adjStart[v + 1]; k++) {
        const e = this.adjEdge[k];
        relax(this.ea[e] === v ? this.eb[e] : this.ea[e], t[v] + this.cost[e]);
      }
    }
    return t;
  }

  private nextSearch(): number {
    this.ensure();
    if (++this.search >= 0xffffffff) {
      this.search = 1;
      this.stamp.fill(0);
      this.closed.fill(0);
    }
    return this.search;
  }

  /** Edge counts by kind (for tests and the debug readout). */
  counts(): Record<keyof typeof WalkEdge, number> {
    this.ensure();
    const out = { Sidewalk: 0, Corner: 0, EndCap: 0, Signal: 0, Zebra: 0, Informal: 0 };
    const names = ['Sidewalk', 'Corner', 'EndCap', 'Signal', 'Zebra', 'Informal'] as const;
    for (let e = 0; e < this.edgeCount; e++) out[names[this.kind[e]]]++;
    return out;
  }
}
