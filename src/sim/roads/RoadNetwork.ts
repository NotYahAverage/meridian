import { SpatialHash } from '../../core/SpatialHash';
import {
  type P2,
  type Polyline,
  type Projection,
  bezierTangent,
  projectOnPolyline,
  sampleBezier,
  splitBezier,
  tAt,
} from '../../core/geom2d';
import { ROAD_TYPES, type RoadTypeId, canBeOneWay } from './RoadTypes';

export interface RoadNode {
  id: number;
  x: number;
  z: number;
  segs: number[];
  /** Node on the map boundary that connects to the outside world. */
  outside: boolean;
}

export interface RoadSegment {
  id: number;
  a: number;
  b: number;
  type: RoadTypeId;
  /** Quadratic Bezier control point. */
  cx: number;
  cz: number;
  poly: Polyline;
  length: number;
  name: string;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /** Distance trimmed off each end for junction geometry (set by RoadLayout). */
  trimA: number;
  trimB: number;
  builtTick: number;
  /** Part of a bridge (deck raised above water/ramps). */
  elevated: boolean;
  /** 0 two-way, 1 one-way a→b, -1 one-way b→a. */
  oneway: 0 | 1 | -1;
  /** Part of a roundabout's circulating carriageway. */
  ring: boolean;
  /** Raised highway (overpass): carried on piers above the ground and the roads under it. */
  raised: boolean;
}

export interface Roundabout {
  id: number;
  x: number;
  z: number;
  /** Centreline radius of the ring. */
  r: number;
}

export type RoadChange =
  | { kind: 'add'; seg: RoadSegment }
  | { kind: 'remove'; seg: RoadSegment }
  | { kind: 'retype'; seg: RoadSegment; from: RoadTypeId };

export interface SegmentHit {
  seg: RoadSegment;
  proj: Projection;
}

const SAMPLE_STEP = 2;

export class RoadNetwork {
  readonly nodes = new Map<number, RoadNode>();
  readonly segments = new Map<number, RoadSegment>();
  readonly spatial = new SpatialHash(64);
  readonly roundabouts = new Map<number, Roundabout>();
  nextRoundaboutId = 1;
  nextNodeId = 1;
  nextSegId = 1;
  version = 0;
  private listeners: ((c: RoadChange) => void)[] = [];
  private compCache: { version: number; comp: Map<number, number> } | null = null;

  onChange(fn: (c: RoadChange) => void): void {
    this.listeners.push(fn);
  }

  private emit(c: RoadChange): void {
    this.version++;
    for (const l of this.listeners) l(c);
  }

  addNode(x: number, z: number, outside = false, id?: number): RoadNode {
    const nid = id ?? this.nextNodeId++;
    if (id !== undefined) this.nextNodeId = Math.max(this.nextNodeId, id + 1);
    const node: RoadNode = { id: nid, x, z, segs: [], outside };
    this.nodes.set(nid, node);
    return node;
  }

  getNode(id: number): RoadNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`Unknown road node ${id}`);
    return n;
  }

  getSegment(id: number): RoadSegment {
    const s = this.segments.get(id);
    if (!s) throw new Error(`Unknown road segment ${id}`);
    return s;
  }

  addSegment(
    a: number,
    b: number,
    type: RoadTypeId,
    opts: { ctrl?: P2; name?: string; id?: number; builtTick?: number; elevated?: boolean; oneway?: 0 | 1 | -1; ring?: boolean; raised?: boolean } = {},
  ): RoadSegment {
    const na = this.getNode(a);
    const nb = this.getNode(b);
    const cx = opts.ctrl ? opts.ctrl.x : (na.x + nb.x) / 2;
    const cz = opts.ctrl ? opts.ctrl.z : (na.z + nb.z) / 2;
    const poly = sampleBezier(na.x, na.z, cx, cz, nb.x, nb.z, SAMPLE_STEP);
    const id = opts.id ?? this.nextSegId++;
    if (opts.id !== undefined) this.nextSegId = Math.max(this.nextSegId, opts.id + 1);
    const hw = ROAD_TYPES[type].halfWidth;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < poly.count; i++) {
      const x = poly.pts[i * 2];
      const z = poly.pts[i * 2 + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const seg: RoadSegment = {
      id,
      a,
      b,
      type,
      cx,
      cz,
      poly,
      length: poly.length,
      name: opts.name ?? '',
      minX: minX - hw,
      minZ: minZ - hw,
      maxX: maxX + hw,
      maxZ: maxZ + hw,
      trimA: 0,
      trimB: 0,
      builtTick: opts.builtTick ?? 0,
      elevated: !!opts.elevated,
      oneway: opts.oneway ?? 0,
      ring: !!opts.ring,
      raised: !!opts.raised,
    };
    this.segments.set(id, seg);
    na.segs.push(id);
    nb.segs.push(id);
    this.spatial.insert(id, seg.minX, seg.minZ, seg.maxX, seg.maxZ);
    this.emit({ kind: 'add', seg });
    return seg;
  }

  /** Removes a segment; nodes left without connections are deleted (except outside nodes). */
  removeSegment(id: number, keepNodes = false): RoadSegment | undefined {
    const seg = this.segments.get(id);
    if (!seg) return undefined;
    this.segments.delete(id);
    this.spatial.remove(id);
    for (const nid of [seg.a, seg.b]) {
      const n = this.nodes.get(nid);
      if (!n) continue;
      n.segs = n.segs.filter((s) => s !== id);
      if (!keepNodes && n.segs.length === 0 && !n.outside) this.nodes.delete(nid);
    }
    this.emit({ kind: 'remove', seg });
    return seg;
  }

  /** Changes traffic direction (0 two-way, 1 a→b, -1 b→a). */
  setOneway(id: number, oneway: 0 | 1 | -1): void {
    const seg = this.getSegment(id);
    if (seg.oneway === oneway) return;
    seg.oneway = canBeOneWay(seg.type) ? oneway : 0;
    this.emit({ kind: 'retype', seg, from: seg.type });
  }

  /** True if traffic may enter `seg` from node `fromNode`. */
  static allows(seg: RoadSegment, fromNode: number): boolean {
    return seg.oneway === 0 || (seg.oneway === 1 ? seg.a === fromNode : seg.b === fromNode);
  }

  retypeSegment(id: number, type: RoadTypeId): void {
    const seg = this.getSegment(id);
    if (seg.type === type) return;
    const from = seg.type;
    seg.type = type;
    if (!canBeOneWay(type)) seg.oneway = 0;
    const hw = ROAD_TYPES[type].halfWidth;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < seg.poly.count; i++) {
      const x = seg.poly.pts[i * 2];
      const z = seg.poly.pts[i * 2 + 1];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    seg.minX = minX - hw;
    seg.minZ = minZ - hw;
    seg.maxX = maxX + hw;
    seg.maxZ = maxZ + hw;
    this.spatial.insert(id, seg.minX, seg.minZ, seg.maxX, seg.maxZ);
    this.emit({ kind: 'retype', seg, from });
  }

  /** Splits a segment at arc length s, returning the new node and both halves. */
  splitSegment(id: number, s: number): { node: RoadNode; first: RoadSegment; second: RoadSegment } {
    const seg = this.getSegment(id);
    const na = this.getNode(seg.a);
    const nb = this.getNode(seg.b);
    const t = tAt(seg.poly, s);
    const sp = splitBezier(na.x, na.z, seg.cx, seg.cz, nb.x, nb.z, t);
    this.removeSegment(id, true);
    const node = this.addNode(sp.mid.x, sp.mid.z);
    const first = this.addSegment(seg.a, node.id, seg.type, {
      ctrl: { x: sp.first.cx, z: sp.first.cz },
      name: seg.name,
      builtTick: seg.builtTick,
      elevated: seg.elevated,
      oneway: seg.oneway,
      ring: seg.ring,
      raised: seg.raised,
    });
    const second = this.addSegment(node.id, seg.b, seg.type, {
      ctrl: { x: sp.second.cx, z: sp.second.cz },
      name: seg.name,
      builtTick: seg.builtTick,
      elevated: seg.elevated,
      oneway: seg.oneway,
      ring: seg.ring,
      raised: seg.raised,
    });
    return { node, first, second };
  }

  otherEnd(seg: RoadSegment, nodeId: number): number {
    return seg.a === nodeId ? seg.b : seg.a;
  }

  /** Unit direction leaving `nodeId` along the segment. */
  endDirection(seg: RoadSegment, nodeId: number, out: P2 = { x: 0, z: 0 }): P2 {
    const na = this.getNode(seg.a);
    const nb = this.getNode(seg.b);
    if (nodeId === seg.a) {
      bezierTangent(na.x, na.z, seg.cx, seg.cz, nb.x, nb.z, 0, out);
    } else {
      bezierTangent(na.x, na.z, seg.cx, seg.cz, nb.x, nb.z, 1, out);
      out.x = -out.x;
      out.z = -out.z;
    }
    return out;
  }

  nearestNode(x: number, z: number, r: number, filter?: (n: RoadNode) => boolean): RoadNode | null {
    let best: RoadNode | null = null;
    let bestD = r * r;
    const ids = this.spatial.queryRadius(x, z, r);
    const seen = new Set<number>();
    for (const sid of ids) {
      const seg = this.segments.get(sid)!;
      for (const nid of [seg.a, seg.b]) {
        if (seen.has(nid)) continue;
        seen.add(nid);
        const n = this.nodes.get(nid)!;
        if (filter && !filter(n)) continue;
        const d = (n.x - x) ** 2 + (n.z - z) ** 2;
        if (d <= bestD) {
          bestD = d;
          best = n;
        }
      }
    }
    // Isolated nodes (e.g. outside connections without roads) are rare; check them too.
    if (!best) {
      for (const n of this.nodes.values()) {
        if (n.segs.length > 0) continue;
        if (filter && !filter(n)) continue;
        const d = (n.x - x) ** 2 + (n.z - z) ** 2;
        if (d <= bestD) {
          bestD = d;
          best = n;
        }
      }
    }
    return best;
  }

  /** Nearest segment centreline within r meters. */
  nearestSegment(x: number, z: number, r: number, filter?: (s: RoadSegment) => boolean): SegmentHit | null {
    let best: SegmentHit | null = null;
    const proj: Projection = { s: 0, dist: 0, x: 0, z: 0, side: 1 };
    for (const sid of this.spatial.queryRadius(x, z, r)) {
      const seg = this.segments.get(sid)!;
      if (filter && !filter(seg)) continue;
      projectOnPolyline(seg.poly, x, z, proj);
      if (proj.dist <= r && (!best || proj.dist < best.proj.dist)) {
        best = { seg, proj: { ...proj } };
      }
    }
    return best;
  }

  segmentsIn(minX: number, minZ: number, maxX: number, maxZ: number): RoadSegment[] {
    return this.spatial.query(minX, minZ, maxX, maxZ).map((id) => this.segments.get(id)!);
  }

  /** Connected-component id per node (cached until the network changes). */
  components(): Map<number, number> {
    if (this.compCache && this.compCache.version === this.version) return this.compCache.comp;
    const comp = new Map<number, number>();
    let next = 0;
    for (const n of this.nodes.values()) {
      if (comp.has(n.id)) continue;
      const id = next++;
      const stack = [n.id];
      comp.set(n.id, id);
      while (stack.length) {
        const cur = this.nodes.get(stack.pop()!)!;
        for (const sid of cur.segs) {
          const seg = this.segments.get(sid)!;
          const o = seg.a === cur.id ? seg.b : seg.a;
          if (!comp.has(o)) {
            comp.set(o, id);
            stack.push(o);
          }
        }
      }
    }
    this.compCache = { version: this.version, comp };
    return comp;
  }

  segmentComponent(seg: RoadSegment): number {
    return this.components().get(seg.a) ?? -1;
  }

  /** Components that contain an outside connection node. */
  outsideComponents(): Set<number> {
    const comp = this.components();
    const out = new Set<number>();
    for (const n of this.nodes.values()) {
      if (n.outside) out.add(comp.get(n.id)!);
    }
    return out;
  }

  totalLength(type?: RoadTypeId): number {
    let sum = 0;
    for (const s of this.segments.values()) if (!type || s.type === type) sum += s.length;
    return sum;
  }

  clear(): void {
    this.nodes.clear();
    this.segments.clear();
    this.spatial.clear();
    this.nextNodeId = 1;
    this.nextSegId = 1;
    this.version++;
    this.compCache = null;
  }
}
