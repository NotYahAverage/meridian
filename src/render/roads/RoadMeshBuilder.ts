import { type PolyPoint, type Polyline, lineIntersect, pointAt } from '../../core/geom2d';
import type { NodeLayout, RoadLayout } from '../../sim/roads/RoadLayout';
import type { RoadNetwork, RoadSegment } from '../../sim/roads/RoadNetwork';
import { nodeLift, raisedLift } from '../../sim/roads/Overpass';
import { ROAD_TYPES, ROAD_TYPE_LIST, type RoadType, type RoadTypeId } from '../../sim/roads/RoadTypes';
import { CROSSWALK_INSET, hasCrosswalk, servesPedestrians } from '../../sim/walk/WalkNetwork';
import type { Terrain } from '../../sim/world/Terrain';

/** Surface kinds understood by the road shader. */
export const SURF = { asphalt: 0, sidewalk: 1, curb: 2, median: 3, junction: 4, barrier: 5, verge: 6 } as const;
/** Index of each road type in the shader's parameter table (ROAD_TYPE_LIST order). */
export const TYPE_INDEX = Object.fromEntries(ROAD_TYPE_LIST.map((t, i) => [t.id, i])) as Record<RoadTypeId, number>;

export const ROAD_LIFT = 0.08;
export const CURB_H = 0.15;
const SKIRT_DEPTH = 1.8;

export interface PropInstance {
  kind: 'streetlight' | 'tree' | 'signal' | 'bush' | 'walksignal';
  x: number;
  y: number;
  z: number;
  rot: number;
  scale?: number;
  variant?: number;
}

export interface SignalHead {
  nodeId: number;
  segId: number;
  x: number;
  y: number;
  z: number;
}

/** Pedestrian signal at one end of a crosswalk (`segId` is the arm crossed), facing across the road. */
export interface WalkSignalHead extends SignalHead {
  rot: number;
}

/** Height of the pedestrian signal's lamps above the sidewalk. */
export const WALK_LAMP_Y = { hand: 2.86, walk: 2.5 };
/** How far the lamps sit in front of the pole (along the facing direction). */
export const WALK_LAMP_OUT = 0.29;

/** Growable vertex buffer for road meshes. */
export class RoadGeo {
  pos: number[] = [];
  nor: number[] = [];
  road: number[] = [];
  surf: number[] = [];
  slot: number[] = [];
  idx: number[] = [];
  props: PropInstance[] = [];
  signals: SignalHead[] = [];
  walkSignals: WalkSignalHead[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, kind: number, type: number, flags: number, len: number, slot: number): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.road.push(u, v);
    this.surf.push(kind, type, flags, len);
    this.slot.push(slot);
    return this.vertexCount - 1;
  }
}

interface Band {
  u0: number;
  y0: number;
  u1: number;
  y1: number;
  kind: number;
}

/** Cross-section bands (left to right, u = metres right of the centreline). */
export function profile(rt: RoadType): Band[] {
  const A = rt.asphaltHalf;
  const W = rt.halfWidth;
  const bands: Band[] = [];
  const side = (sgn: number) => {
    const out: Band[] = [];
    if (rt.sidewalk > 0) {
      out.push({ u0: -W, y0: -SKIRT_DEPTH, u1: -W, y1: CURB_H, kind: SURF.sidewalk });
      out.push({ u0: -W, y0: CURB_H, u1: -A - 0.25, y1: CURB_H, kind: SURF.sidewalk });
      out.push({ u0: -A - 0.25, y0: CURB_H, u1: -A, y1: CURB_H, kind: SURF.curb });
      out.push({ u0: -A, y0: CURB_H, u1: -A, y1: 0, kind: SURF.curb });
    } else {
      out.push({ u0: -W, y0: -SKIRT_DEPTH, u1: -W, y1: -0.35, kind: SURF.verge });
      out.push({ u0: -W, y0: -0.35, u1: -A, y1: 0, kind: SURF.verge });
    }
    if (sgn > 0) {
      // Mirror for the right side: reverse order and swap endpoints.
      return out.reverse().map((b) => ({ u0: -b.u1, y0: b.y1, u1: -b.u0, y1: b.y0, kind: b.kind }));
    }
    return out;
  };
  bands.push(...side(-1));
  const m = rt.median / 2;
  if (rt.medianKind === 'grass') {
    bands.push({ u0: -A, y0: 0, u1: -m, y1: 0, kind: SURF.asphalt });
    bands.push({ u0: -m, y0: 0, u1: -m, y1: CURB_H, kind: SURF.curb });
    bands.push({ u0: -m, y0: CURB_H, u1: -m + 0.25, y1: CURB_H, kind: SURF.curb });
    bands.push({ u0: -m + 0.25, y0: CURB_H, u1: m - 0.25, y1: CURB_H, kind: SURF.median });
    bands.push({ u0: m - 0.25, y0: CURB_H, u1: m, y1: CURB_H, kind: SURF.curb });
    bands.push({ u0: m, y0: CURB_H, u1: m, y1: 0, kind: SURF.curb });
    bands.push({ u0: m, y0: 0, u1: A, y1: 0, kind: SURF.asphalt });
  } else {
    bands.push({ u0: -A, y0: 0, u1: A, y1: 0, kind: SURF.asphalt });
    if (rt.medianKind === 'barrier') {
      bands.push({ u0: -0.32, y0: 0.01, u1: -0.18, y1: 0.85, kind: SURF.barrier });
      bands.push({ u0: -0.18, y0: 0.85, u1: 0.18, y1: 0.85, kind: SURF.barrier });
      bands.push({ u0: 0.18, y0: 0.85, u1: 0.32, y1: 0.01, kind: SURF.barrier });
    }
  }
  bands.push(...side(1));
  return bands;
}

interface Frame {
  x: number;
  z: number;
  tx: number;
  tz: number;
  h: number;
  v: number;
}

/** Tangent shared by two segments meeting at a straight-through node (miter). */
function miterTangent(layout: RoadLayout, seg: RoadSegment, nodeId: number): { x: number; z: number } | null {
  const lay = layout.get(nodeId);
  if (!lay || lay.kind !== 'through') return null;
  const other = lay.arms.find((a) => a.segId !== seg.id);
  if (!other) return null;
  const mine = lay.arms.find((a) => a.segId === seg.id)!;
  // Incoming along mine = -mine.d ; outgoing along other = other.d
  let mx = -mine.dx + other.dx;
  let mz = -mine.dz + other.dz;
  const l = Math.hypot(mx, mz);
  if (l < 1e-6) return null;
  mx /= l;
  mz /= l;
  // Express in this segment's a→b direction.
  return nodeId === seg.b ? { x: mx, z: mz } : { x: -mx, z: -mz };
}

/** Builds the ribbon mesh and props for one road segment. */
export function buildSegment(
  out: RoadGeo,
  seg: RoadSegment,
  net: RoadNetwork,
  layout: RoadLayout,
  terrain: Terrain,
  slot: number,
  opts: { props?: boolean; lift?: number } = {},
): void {
  const rt = ROAD_TYPES[seg.type];
  const s0 = seg.trimA;
  const s1 = seg.length - seg.trimB;
  if (s1 - s0 < 0.3) return;
  const lift = opts.lift ?? 0;
  const frames = sampleFrames(seg.poly, s0, s1, terrain, lift);
  // Raised highways ride their own height profile above the ground road surface.
  if (seg.raised) for (const f of frames) f.h += raisedLift(net, seg, s0 + f.v);
  const mA = miterTangent(layout, seg, seg.a);
  const mB = miterTangent(layout, seg, seg.b);
  if (mA) {
    frames[0].tx = mA.x;
    frames[0].tz = mA.z;
  }
  if (mB) {
    frames[frames.length - 1].tx = mB.x;
    frames[frames.length - 1].tz = mB.z;
  }
  const crossA = hasCrosswalk(layout, seg.a, seg);
  const crossB = hasCrosswalk(layout, seg.b, seg);
  const ctrlA = seg.ring ? 'none' : layout.get(seg.a)?.control ?? 'none';
  const ctrlB = seg.ring ? 'none' : layout.get(seg.b)?.control ?? 'none';
  const giveWay = (c: string) => c === 'yield' || c === 'roundabout';
  const flags =
    // Pedestrians cross a roundabout's approaches, never the ring itself.
    (crossA ? 1 : 0) |
    (crossB ? 2 : 0) |
    (seg.oneway !== 0 ? 4 : 0) |
    (seg.oneway === -1 ? 8 : 0) |
    // Stop lines at lights where there's no crosswalk (they're drawn with the crosswalk otherwise).
    (!crossA && ctrlA === 'signal' ? 16 : 0) |
    (!crossB && ctrlB === 'signal' ? 32 : 0) |
    // Dashed give-way lines where traffic yields instead of stopping at a light.
    (giveWay(ctrlA) ? 64 : 0) |
    (giveWay(ctrlB) ? 128 : 0);
  const len = s1 - s0;
  const bands = profile(rt);
  if (rt.medianKind === 'barrier' && (crossA || crossB)) {
    // A gap in the median barrier where people cross at the lights.
    emitRibbon(out, frames, bands.filter((b) => b.kind !== SURF.barrier), TYPE_INDEX[seg.type], flags, len, slot);
    const cutA = crossA ? CROSSWALK_INSET + 2.2 : 0, cutB = crossB ? CROSSWALK_INSET + 2.2 : 0;
    if (len - cutA - cutB > 1) {
      const bf = sampleFrames(seg.poly, s0 + cutA, s1 - cutB, terrain, lift);
      for (const f of bf) {
        if (seg.raised) f.h += raisedLift(net, seg, s0 + cutA + f.v);
        f.v += cutA;
      }
      emitRibbon(out, bf, bands.filter((b) => b.kind === SURF.barrier), TYPE_INDEX[seg.type], flags, len, slot);
    }
  } else {
    emitRibbon(out, frames, bands, TYPE_INDEX[seg.type], flags, len, slot);
  }
  if (seg.elevated || seg.raised) emitBridge(out, seg.poly, s0, s1, frames, rt, terrain, TYPE_INDEX[seg.type], len, slot);
  if (opts.props !== false) emitSegmentProps(out, seg, rt, s0, s1, terrain, (s) => raisedLift(net, seg, s));
}

const PIER_SPACING = 34;

/** Railings, deck underside and piers for the raised part of a bridge. */
function emitBridge(out: RoadGeo, poly: Polyline, s0: number, s1: number, frames: Frame[], rt: RoadType, terrain: Terrain, type: number, len: number, slot: number): void {
  const W = rt.halfWidth;
  // Only where the deck is clear of the ground.
  const raised = frames.map((f) => f.h - terrain.sampleBase(f.x, f.z) > 1.2);
  const runs: Frame[][] = [];
  let cur: Frame[] = [];
  frames.forEach((f, i) => {
    if (raised[i]) cur.push(f);
    else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  });
  if (cur.length) runs.push(cur);
  const top = rt.sidewalk > 0 ? CURB_H : 0;
  for (const run of runs) {
    if (run.length < 2) continue;
    // Parapets on both edges (outer and inner faces) and the deck soffit.
    const bands: Band[] = [
      { u0: -W, y0: top, u1: -W, y1: top + 1.05, kind: SURF.barrier },
      { u0: -W + 0.3, y0: top + 1.05, u1: -W + 0.3, y1: top, kind: SURF.barrier },
      { u0: -W, y0: top + 1.05, u1: -W + 0.3, y1: top + 1.05, kind: SURF.barrier },
      { u0: W, y0: top + 1.05, u1: W, y1: top, kind: SURF.barrier },
      { u0: W - 0.3, y0: top, u1: W - 0.3, y1: top + 1.05, kind: SURF.barrier },
      { u0: W - 0.3, y0: top + 1.05, u1: W, y1: top + 1.05, kind: SURF.barrier },
      { u0: W, y0: -SKIRT_DEPTH, u1: -W, y1: -SKIRT_DEPTH, kind: SURF.barrier },
    ];
    emitRibbon(out, run, bands, type, 0, len, slot);
  }
  // Piers down to the lake bed or ground.
  const p: PolyPoint = { x: 0, z: 0, tx: 0, tz: 0, i: 0 };
  let fi = 0;
  for (let s = s0 + PIER_SPACING / 2; s < s1 - 4; s += PIER_SPACING) {
    pointAt(poly, s, p);
    while (fi < frames.length - 1 && frames[fi + 1].v <= s - s0) fi++;
    const fa = frames[fi], fb = frames[Math.min(frames.length - 1, fi + 1)];
    const t = fb.v > fa.v ? Math.min(1, Math.max(0, (s - s0 - fa.v) / (fb.v - fa.v))) : 0;
    const deck = fa.h + (fb.h - fa.h) * t - SKIRT_DEPTH;
    const ground = terrain.sampleBase(p.x, p.z) - 1;
    if (deck - ground < 2.5) continue;
    pier(out, p.x, p.z, p.tx, p.tz, Math.min(W * 0.8, 6), 1.1, ground, deck, type, len, slot);
    if (W > 9) {
      for (const sd of [-1, 1]) pier(out, p.x - p.tz * sd * W * 0.6, p.z + p.tx * sd * W * 0.6, p.tx, p.tz, 1.6, 1.1, ground, deck, type, len, slot);
    }
  }
}

/** Box pier: `hw` across the road, `hd` along it. */
function pier(out: RoadGeo, x: number, z: number, tx: number, tz: number, hw: number, hd: number, y0: number, y1: number, type: number, len: number, slot: number): void {
  const rx = -tz, rz = tx;
  const c = (a: number, b: number): [number, number] => [x + rx * a + tx * b, z + rz * a + tz * b];
  const corners = [c(-hw, -hd), c(hw, -hd), c(hw, hd), c(-hw, hd)];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[(i + 1) % 4];
    let nx = bz - az, nz = -(bx - ax);
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    const k = out.vertexCount;
    out.vert(ax, y0, az, nx, 0, nz, i, y0, SURF.barrier, type, 0, len, slot);
    out.vert(bx, y0, bz, nx, 0, nz, i + 1, y0, SURF.barrier, type, 0, len, slot);
    out.vert(bx, y1, bz, nx, 0, nz, i + 1, y1, SURF.barrier, type, 0, len, slot);
    out.vert(ax, y1, az, nx, 0, nz, i, y1, SURF.barrier, type, 0, len, slot);
    out.idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
  }
}

export function sampleFrames(poly: Polyline, s0: number, s1: number, terrain: Terrain, lift = 0): Frame[] {
  const frames: Frame[] = [];
  const p: PolyPoint = { x: 0, z: 0, tx: 0, tz: 0, i: 0 };
  // Curved segments need dense samples; straight ones only follow the terrain.
  pointAt(poly, s0, p);
  const t0x = p.tx, t0z = p.tz;
  pointAt(poly, s1, p);
  const curved = t0x * p.tx + t0z * p.tz < 0.9995;
  const step = curved ? 3 : 8;
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  for (let k = 0; k <= n; k++) {
    const s = s0 + ((s1 - s0) * k) / n;
    pointAt(poly, s, p);
    frames.push({ x: p.x, z: p.z, tx: p.tx, tz: p.tz, h: terrain.roadHeightAt(p.x, p.z) + ROAD_LIFT + lift, v: s - s0 });
  }
  return frames;
}

function emitRibbon(out: RoadGeo, frames: Frame[], bands: Band[], type: number, flags: number, len: number, slot: number): void {
  for (const b of bands) {
    const du = b.u1 - b.u0;
    const dy = b.y1 - b.y0;
    const bl = Math.hypot(du, dy) || 1;
    // Normal in the cross-section plane: up*du - right*dy.
    const nUp = du / bl;
    const nRight = -dy / bl;
    const startIndex = out.vertexCount;
    for (const f of frames) {
      const rx = -f.tz, rz = f.tx;
      const nx = rx * nRight, ny = nUp, nz = rz * nRight;
      out.vert(f.x + rx * b.u0, f.h + b.y0, f.z + rz * b.u0, nx, ny, nz, b.u0, f.v, b.kind, type, flags, len, slot);
      out.vert(f.x + rx * b.u1, f.h + b.y1, f.z + rz * b.u1, nx, ny, nz, b.u1, f.v, b.kind, type, flags, len, slot);
    }
    for (let k = 0; k < frames.length - 1; k++) {
      const l0 = startIndex + k * 2, r0 = l0 + 1, l1 = l0 + 2, r1 = l0 + 3;
      out.idx.push(l0, r0, l1, r0, r1, l1);
    }
  }
}

function emitSegmentProps(out: RoadGeo, seg: RoadSegment, rt: RoadType, s0: number, s1: number, terrain: Terrain, liftAt: (s: number) => number = () => 0): void {
  const p: PolyPoint = { x: 0, z: 0, tx: 0, tz: 0, i: 0 };
  const A = rt.asphaltHalf;
  const usable = s1 - s0;
  if (usable < 12) return;
  const lampStep = rt.freeway ? 46 : 34;
  let k = 0;
  for (let v = 10; v < usable - 4; v += lampStep, k++) {
    pointAt(seg.poly, s0 + v, p);
    const rx = -p.tz, rz = p.tx;
    const h = terrain.roadHeightAt(p.x, p.z) + ROAD_LIFT + liftAt(s0 + v);
    const sides = rt.lamps === 'one' ? [k % 2 === 0 ? 1 : -1] : rt.lamps === 'median' ? [] : [1, -1];
    for (const sd of sides) {
      const u = sd * (A + 0.65);
      // Lamp arm (model +X) points toward the road centre.
      const ax = -sd * rx, az = -sd * rz;
      out.props.push({ kind: 'streetlight', x: p.x + rx * u, y: h + CURB_H, z: p.z + rz * u, rot: Math.atan2(az, ax) });
    }
    if (rt.lamps === 'median') {
      const sd = k % 2 === 0 ? 1 : -1;
      out.props.push({ kind: 'streetlight', x: p.x, y: h + 0.85, z: p.z, rot: Math.atan2(sd * rz, sd * rx) });
    }
  }
  // Trees don't grow on bridge decks.
  if (rt.medianKind === 'grass' && !seg.elevated && !seg.raised) {
    for (let v = 6; v < usable - 6; v += 11) {
      pointAt(seg.poly, s0 + v, p);
      const h = terrain.roadHeightAt(p.x, p.z) + ROAD_LIFT + CURB_H;
      out.props.push({ kind: 'tree', x: p.x, y: h, z: p.z, rot: v * 1.7, scale: 0.8 + ((v * 7) % 5) * 0.05, variant: 1 });
    }
  }
  if ((rt.id === 'avenue' || rt.id === 'boulevard') && !seg.elevated) {
    for (let v = 27; v < usable - 6; v += 17) {
      pointAt(seg.poly, s0 + v, p);
      const rx = -p.tz, rz = p.tx;
      const h = terrain.roadHeightAt(p.x, p.z) + ROAD_LIFT + CURB_H;
      for (const sd of [1, -1]) {
        const u = sd * (A + rt.sidewalk * 0.62);
        out.props.push({ kind: 'tree', x: p.x + rx * u, y: h, z: p.z + rz * u, rot: v + sd, scale: 0.62, variant: 0 });
      }
    }
  }
}

/** Builds junction surface, corner sidewalks and signal poles for a node. */
export function buildNode(out: RoadGeo, nodeId: number, net: RoadNetwork, layout: RoadLayout, terrain: Terrain, signalled: boolean): void {
  const lay = layout.get(nodeId);
  if (!lay) return;
  const node = net.getNode(nodeId);
  nodeLiftNow = nodeLift(net, nodeId);
  if (lay.kind === 'end') buildEndCap(out, lay, net, terrain);
  else if (lay.kind === 'junction') buildJunction(out, lay, node.x, node.z, net, layout, terrain, signalled);
  nodeLiftNow = 0;
}

/** Extra height of the node being built (raised highway joins). */
let nodeLiftNow = 0;

function hAt(terrain: Terrain, x: number, z: number): number {
  return terrain.roadHeightAt(x, z) + ROAD_LIFT + nodeLiftNow;
}

function bez(ax: number, az: number, cx: number, cz: number, bx: number, bz: number, t: number): [number, number] {
  const u = 1 - t;
  return [u * u * ax + 2 * u * t * cx + t * t * bx, u * u * az + 2 * u * t * cz + t * t * bz];
}

function buildJunction(out: RoadGeo, lay: NodeLayout, cx: number, cz: number, net: RoadNetwork, layout: RoadLayout, terrain: Terrain, signalled: boolean): void {
  const arms = lay.arms;
  const n = arms.length;
  const N = 7;
  const boundary: [number, number][] = [];
  interface Corner {
    inner: [number, number][];
    outer: [number, number][];
    sidewalk: boolean;
  }
  const corners: Corner[] = [];
  const types = arms.map((a) => ROAD_TYPES[net.getSegment(a.segId).type]);
  const pedestrians = signalled && servesPedestrians(layout, lay);
  for (let i = 0; i < n; i++) {
    const a = arms[i];
    const j = (i + 1) % n;
    const b = arms[j];
    const ra = { x: -a.tz, z: a.tx };
    const rb = { x: -b.tz, z: b.tx };
    const Ai = types[i].asphaltHalf, Aj = types[j].asphaltHalf;
    const Wi = types[i].halfWidth, Wj = types[j].halfWidth;
    const left = [a.px - ra.x * Ai, a.pz - ra.z * Ai] as [number, number];
    const right = [a.px + ra.x * Ai, a.pz + ra.z * Ai] as [number, number];
    boundary.push(left, right);
    const nextLeft = [b.px - rb.x * Aj, b.pz - rb.z * Aj] as [number, number];
    const ctrlFor = (p: [number, number], q: [number, number]): [number, number] => {
      const hit = lineIntersect(p[0], p[1], a.tx, a.tz, q[0], q[1], b.tx, b.tz);
      if (hit && hit.t < 0.5 && hit.u < 0.5 && hit.t > -60 && hit.u > -60) return [p[0] + a.tx * hit.t, p[1] + a.tz * hit.t];
      return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    };
    const c = ctrlFor(right, nextLeft);
    const inner: [number, number][] = [];
    for (let k = 0; k <= N; k++) inner.push(bez(right[0], right[1], c[0], c[1], nextLeft[0], nextLeft[1], k / N));
    for (let k = 1; k < N; k++) boundary.push(inner[k]);
    // Paved where both roads have sidewalks, and on every corner of a junction with lights where people cross.
    const sw = (types[i].sidewalk > 0 && types[j].sidewalk > 0) || (signalled && pedestrians);
    const oRight = [a.px + ra.x * Wi, a.pz + ra.z * Wi] as [number, number];
    const oLeft = [b.px - rb.x * Wj, b.pz - rb.z * Wj] as [number, number];
    const oc = ctrlFor(oRight, oLeft);
    const outer: [number, number][] = [];
    for (let k = 0; k <= N; k++) outer.push(bez(oRight[0], oRight[1], oc[0], oc[1], oLeft[0], oLeft[1], k / N));
    corners.push({ inner, outer, sidewalk: sw });
  }
  // Asphalt fan.
  const ch = hAt(terrain, cx, cz);
  const center = out.vert(cx, ch, cz, 0, 1, 0, 0, 0, SURF.junction, 0, 0, 0, -1);
  const first = out.vertexCount;
  for (const [x, z] of boundary) out.vert(x, hAt(terrain, x, z), z, 0, 1, 0, 0, 0, SURF.junction, 0, 0, 0, -1);
  const m = boundary.length;
  for (let k = 0; k < m; k++) out.idx.push(center, first + ((k + 1) % m), first + k);

  // Corner sidewalks / verges.
  for (const c of corners) {
    const top = c.sidewalk ? CURB_H : -0.3;
    const kind = c.sidewalk ? SURF.sidewalk : SURF.verge;
    const base = out.vertexCount;
    for (let k = 0; k <= N; k++) {
      const [ix, iz] = c.inner[k];
      const [ox, oz] = c.outer[k];
      const hi = hAt(terrain, ix, iz);
      const ho = hAt(terrain, ox, oz);
      // Outward horizontal direction for curb/skirt normals.
      const dx = ox - ix, dz = oz - iz;
      const dl = Math.hypot(dx, dz) || 1;
      const nx = dx / dl, nz = dz / dl;
      out.vert(ix, hi, iz, -nx, 0, -nz, 0, k, SURF.curb, 0, 0, 0, -1); // curb bottom
      out.vert(ix, hi + (c.sidewalk ? CURB_H : 0), iz, -nx, 0, -nz, 0, k, SURF.curb, 0, 0, 0, -1); // curb top
      out.vert(ix, hi + (c.sidewalk ? CURB_H : 0), iz, 0, 1, 0, 0, k * 1.2, kind, 0, 0, 0, -1);
      out.vert(ox, ho + top, oz, 0, 1, 0, 2, k * 1.2, kind, 0, 0, 0, -1);
      out.vert(ox, ho + top, oz, nx, 0, nz, 0, k, kind, 0, 0, 0, -1); // skirt top
      out.vert(ox, ho - SKIRT_DEPTH, oz, nx, 0, nz, 0, k, kind, 0, 0, 0, -1); // skirt bottom
    }
    for (let k = 0; k < N; k++) {
      const a = base + k * 6;
      const b = a + 6;
      if (c.sidewalk) {
        out.idx.push(a, b, a + 1, b, b + 1, a + 1); // curb face
      }
      out.idx.push(a + 2, b + 2, a + 3, b + 2, b + 3, a + 3); // top surface
      out.idx.push(a + 4, b + 4, a + 5, b + 4, b + 5, a + 5); // skirt
    }
  }

  // Signal poles: one per approach, on the right-hand corner.
  if (signalled) {
    for (let i = 0; i < n; i++) {
      const a = arms[i];
      const rt = types[i];
      if (rt.freeway) continue;
      const ra = { x: -a.tz, z: a.tx };
      // Incoming traffic travels -t; its right side is -r.
      const u = rt.asphaltHalf + Math.max(0.7, rt.sidewalk * 0.4);
      const x = a.px - ra.x * u + a.tx * 1.5;
      const z = a.pz - ra.z * u + a.tz * 1.5;
      const y = hAt(terrain, x, z) + CURB_H;
      // Arm (+X) reaches back over the incoming lanes (toward +r).
      const rot = Math.atan2(ra.z, ra.x);
      out.props.push({ kind: 'signal', x, y, z, rot });
      const reach = Math.min(3.9, rt.asphaltHalf);
      out.signals.push({ nodeId: lay.nodeId, segId: a.segId, x: x + ra.x * reach, y: y + 5.3, z: z + ra.z * reach });
    }
    // Pedestrian signals at both ends of each crosswalk, just beyond the stripes, each facing the far kerb.
    for (let i = 0; i < n; i++) {
      const a = arms[i];
      const seg = net.getSegment(a.segId);
      if (!hasCrosswalk(layout, lay.nodeId, seg)) continue;
      const rt = types[i];
      const ra = { x: -a.tz, z: a.tx };
      const along = CROSSWALK_INSET + 2.4;
      const off = rt.asphaltHalf + 0.45;
      for (const sd of [1, -1]) {
        const px = a.px + a.tx * along + ra.x * off * sd;
        const pz = a.pz + a.tz * along + ra.z * off * sd;
        const py = hAt(terrain, px, pz) + (rt.sidewalk > 0 ? CURB_H : 0);
        const prot = Math.atan2(-ra.z * sd, -ra.x * sd);
        out.props.push({ kind: 'walksignal', x: px, y: py, z: pz, rot: prot });
        out.walkSignals.push({ nodeId: lay.nodeId, segId: a.segId, x: px, y: py, z: pz, rot: prot });
      }
    }
  }
}

function buildEndCap(out: RoadGeo, lay: NodeLayout, net: RoadNetwork, terrain: Terrain): void {
  const a = lay.arms[0];
  const rt = ROAD_TYPES[net.getSegment(a.segId).type];
  const A = rt.asphaltHalf;
  const W = rt.halfWidth;
  const r = { x: -a.tz, z: a.tx };
  const N = 12;
  const pt = (rad: number, phi: number): [number, number] => [
    a.px + r.x * rad * Math.cos(phi) - a.tx * rad * Math.sin(phi),
    a.pz + r.z * rad * Math.cos(phi) - a.tz * rad * Math.sin(phi),
  ];
  const ch = hAt(terrain, a.px, a.pz);
  const center = out.vert(a.px, ch, a.pz, 0, 1, 0, 0, 0, SURF.junction, 0, 0, 0, -1);
  const first = out.vertexCount;
  for (let k = 0; k <= N; k++) {
    const [x, z] = pt(A, (k / N) * Math.PI);
    out.vert(x, hAt(terrain, x, z), z, 0, 1, 0, 0, 0, SURF.junction, 0, 0, 0, -1);
  }
  for (let k = 0; k < N; k++) out.idx.push(center, first + k + 1, first + k);
  const sw = rt.sidewalk > 0;
  const top = sw ? CURB_H : -0.3;
  const kind = sw ? SURF.sidewalk : SURF.verge;
  const base = out.vertexCount;
  for (let k = 0; k <= N; k++) {
    const phi = (k / N) * Math.PI;
    const [ix, iz] = pt(A, phi);
    const [ox, oz] = pt(W, phi);
    const hi = hAt(terrain, ix, iz);
    const ho = hAt(terrain, ox, oz);
    const nx = (ox - ix) / (W - A || 1), nz = (oz - iz) / (W - A || 1);
    out.vert(ix, hi, iz, -nx, 0, -nz, 0, k, SURF.curb, 0, 0, 0, -1);
    out.vert(ix, hi + (sw ? CURB_H : 0), iz, -nx, 0, -nz, 0, k, SURF.curb, 0, 0, 0, -1);
    out.vert(ix, hi + (sw ? CURB_H : 0), iz, 0, 1, 0, 0, k, kind, 0, 0, 0, -1);
    out.vert(ox, ho + top, oz, 0, 1, 0, 2, k, kind, 0, 0, 0, -1);
    out.vert(ox, ho + top, oz, nx, 0, nz, 0, k, kind, 0, 0, 0, -1);
    out.vert(ox, ho - SKIRT_DEPTH, oz, nx, 0, nz, 0, k, kind, 0, 0, 0, -1);
  }
  for (let k = 0; k < N; k++) {
    const p = base + k * 6;
    const q = p + 6;
    if (sw) out.idx.push(p, q, p + 1, q, q + 1, p + 1);
    out.idx.push(p + 2, q + 2, p + 3, q + 2, q + 3, p + 3);
    out.idx.push(p + 4, q + 4, p + 5, q + 4, q + 5, p + 5);
  }
}

/** Ribbon for a road that doesn't exist yet (tool preview). */
export function buildPreview(out: RoadGeo, poly: Polyline, type: RoadTypeId, terrain: Terrain, elevated = false, oneway = false, liftAt?: (s: number) => number): void {
  const rt = ROAD_TYPES[type];
  const frames = sampleFrames(poly, 0, poly.length, terrain, 0.06);
  if (liftAt) for (const f of frames) f.h += liftAt(f.v);
  if (elevated) {
    // The deck isn't stamped yet: preview it at its planned height.
    for (const f of frames) f.h = Math.max(f.h, terrain.deckHeightAt(f.x, f.z) + ROAD_LIFT + 0.06);
  }
  emitRibbon(out, frames, profile(rt), TYPE_INDEX[type], oneway ? 4 : 0, poly.length, -1);
}

/** Planted central island of a roundabout: grass disc behind a kerb, with a tree. */
export function buildIsland(out: RoadGeo, x: number, z: number, r: number, type: RoadTypeId, terrain: Terrain): void {
  const rt = ROAD_TYPES[type];
  const rin = r - rt.halfWidth - 0.2;
  if (rin < 3) return;
  const h = terrain.roadHeightAt(x, z) + ROAD_LIFT;
  const N = 36;
  const t = TYPE_INDEX[type];
  const base = out.vertexCount;
  out.vert(x, h + CURB_H, z, 0, 1, 0, 0, 0, SURF.median, t, 0, 0, -1);
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    // Grass top, then the kerb face down to the road.
    out.vert(x + c * rin, h + CURB_H, z + s * rin, 0, 1, 0, rin, a * rin, SURF.median, t, 0, 0, -1);
  }
  for (let i = 0; i < N; i++) out.idx.push(base, base + 2 + i, base + 1 + i);
  const kerb = out.vertexCount;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    out.vert(x + c * rin, h + CURB_H, z + s * rin, c, 0, s, 0, a * rin, SURF.curb, t, 0, 0, -1);
    out.vert(x + c * rin, h - 0.05, z + s * rin, c, 0, s, 0, a * rin, SURF.curb, t, 0, 0, -1);
  }
  for (let i = 0; i < N; i++) {
    const p = kerb + i * 2;
    out.idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3);
  }
  out.props.push({ kind: 'tree', x, y: h + CURB_H, z, rot: x, scale: Math.min(1.3, rin / 7), variant: 0 });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    out.props.push({ kind: 'bush', x: x + Math.cos(a) * rin * 0.6, y: h + CURB_H, z: z + Math.sin(a) * rin * 0.6, rot: a, scale: 0.9 });
  }
}
