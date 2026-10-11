/**
 * 2D geometry on the ground plane. Coordinates are (x, z) in world meters.
 * Direction angles follow dir = (cos θ, sin θ). With y up, the right-hand
 * normal of a direction (dx, dz) is (-dz, dx).
 */

export interface P2 {
  x: number;
  z: number;
}

/** Sampled polyline with cumulative arc length and source Bezier parameter. */
export interface Polyline {
  /** Interleaved x,z pairs. */
  pts: Float64Array;
  /** Cumulative distance at each point. */
  cum: Float64Array;
  /** Bezier parameter t of each point. */
  ts: Float64Array;
  length: number;
  count: number;
}

export function bezier(ax: number, az: number, cx: number, cz: number, bx: number, bz: number, t: number, out: P2): P2 {
  const u = 1 - t;
  out.x = u * u * ax + 2 * u * t * cx + t * t * bx;
  out.z = u * u * az + 2 * u * t * cz + t * t * bz;
  return out;
}

export function bezierTangent(ax: number, az: number, cx: number, cz: number, bx: number, bz: number, t: number, out: P2): P2 {
  const dx = 2 * (1 - t) * (cx - ax) + 2 * t * (bx - cx);
  const dz = 2 * (1 - t) * (cz - az) + 2 * t * (bz - cz);
  const l = Math.hypot(dx, dz) || 1;
  out.x = dx / l;
  out.z = dz / l;
  return out;
}

/** Splits a quadratic Bezier at t; returns [a, c1, m, c2, b] control points. */
export function splitBezier(ax: number, az: number, cx: number, cz: number, bx: number, bz: number, t: number) {
  const p01x = ax + (cx - ax) * t;
  const p01z = az + (cz - az) * t;
  const p12x = cx + (bx - cx) * t;
  const p12z = cz + (bz - cz) * t;
  const mx = p01x + (p12x - p01x) * t;
  const mz = p01z + (p12z - p01z) * t;
  return {
    first: { ax, az, cx: p01x, cz: p01z, bx: mx, bz: mz },
    second: { ax: mx, az: mz, cx: p12x, cz: p12z, bx, bz },
    mid: { x: mx, z: mz },
  };
}

export function approxBezierLength(ax: number, az: number, cx: number, cz: number, bx: number, bz: number): number {
  const chord = Math.hypot(bx - ax, bz - az);
  const net = Math.hypot(cx - ax, cz - az) + Math.hypot(bx - cx, bz - cz);
  return (chord * 2 + net) / 3;
}

export function sampleBezier(ax: number, az: number, cx: number, cz: number, bx: number, bz: number, step = 2): Polyline {
  const approx = approxBezierLength(ax, az, cx, cz, bx, bz);
  // Curvature-aware: more samples for strongly bent curves.
  const chord = Math.hypot(bx - ax, bz - az);
  const bend = approx > 0 ? Math.max(0, approx / Math.max(chord, 1e-3) - 1) : 0;
  const n = Math.max(2, Math.min(400, Math.ceil(approx / step * (1 + bend * 2)) + 1));
  const pts = new Float64Array(n * 2);
  const cum = new Float64Array(n);
  const ts = new Float64Array(n);
  const p: P2 = { x: 0, z: 0 };
  let len = 0;
  let px = ax;
  let pz = az;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    bezier(ax, az, cx, cz, bx, bz, t, p);
    if (i > 0) len += Math.hypot(p.x - px, p.z - pz);
    pts[i * 2] = p.x;
    pts[i * 2 + 1] = p.z;
    cum[i] = len;
    ts[i] = t;
    px = p.x;
    pz = p.z;
  }
  return { pts, cum, ts, length: len, count: n };
}

export interface PolyPoint {
  x: number;
  z: number;
  /** Unit tangent. */
  tx: number;
  tz: number;
  /** Index of the polyline sub-segment. */
  i: number;
}

function findIndex(poly: Polyline, s: number): number {
  const cum = poly.cum;
  let lo = 0;
  let hi = poly.count - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Point and tangent at arc length s (clamped). */
export function pointAt(poly: Polyline, s: number, out: PolyPoint): PolyPoint {
  const n = poly.count;
  if (s <= 0) s = 0;
  if (s >= poly.length) s = poly.length;
  const i = Math.min(findIndex(poly, s), n - 2);
  const pts = poly.pts;
  const x0 = pts[i * 2];
  const z0 = pts[i * 2 + 1];
  const x1 = pts[i * 2 + 2];
  const z1 = pts[i * 2 + 3];
  const segLen = poly.cum[i + 1] - poly.cum[i];
  const f = segLen > 1e-9 ? (s - poly.cum[i]) / segLen : 0;
  out.x = x0 + (x1 - x0) * f;
  out.z = z0 + (z1 - z0) * f;
  const dl = Math.hypot(x1 - x0, z1 - z0) || 1;
  out.tx = (x1 - x0) / dl;
  out.tz = (z1 - z0) / dl;
  out.i = i;
  return out;
}

/** Bezier parameter t at arc length s. */
export function tAt(poly: Polyline, s: number): number {
  if (s <= 0) return 0;
  if (s >= poly.length) return 1;
  const i = Math.min(findIndex(poly, s), poly.count - 2);
  const segLen = poly.cum[i + 1] - poly.cum[i];
  const f = segLen > 1e-9 ? (s - poly.cum[i]) / segLen : 0;
  return poly.ts[i] + (poly.ts[i + 1] - poly.ts[i]) * f;
}

/** Arc length at Bezier parameter t. */
export function sAtT(poly: Polyline, t: number): number {
  const ts = poly.ts;
  if (t <= 0) return 0;
  if (t >= 1) return poly.length;
  let lo = 0;
  let hi = poly.count - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t) lo = mid;
    else hi = mid;
  }
  const f = (t - ts[lo]) / (ts[hi] - ts[lo] || 1);
  return poly.cum[lo] + (poly.cum[hi] - poly.cum[lo]) * f;
}

export interface Projection {
  s: number;
  dist: number;
  x: number;
  z: number;
  /** +1 if the point is to the right of travel direction (a→b), -1 left. */
  side: number;
}

export function projectOnPolyline(poly: Polyline, px: number, pz: number, out: Projection): Projection {
  const pts = poly.pts;
  let best = Infinity;
  for (let i = 0; i < poly.count - 1; i++) {
    const x0 = pts[i * 2];
    const z0 = pts[i * 2 + 1];
    const x1 = pts[i * 2 + 2];
    const z1 = pts[i * 2 + 3];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const l2 = dx * dx + dz * dz;
    let f = l2 > 0 ? ((px - x0) * dx + (pz - z0) * dz) / l2 : 0;
    f = f < 0 ? 0 : f > 1 ? 1 : f;
    const qx = x0 + dx * f;
    const qz = z0 + dz * f;
    const d2 = (px - qx) * (px - qx) + (pz - qz) * (pz - qz);
    if (d2 < best) {
      best = d2;
      out.s = poly.cum[i] + Math.sqrt(l2) * f;
      out.x = qx;
      out.z = qz;
      // dot(rightNormal, p - p0) with rightNormal(d) = (-dz, dx): positive → right side
      const cross = dx * (pz - z0) - dz * (px - x0);
      out.side = cross >= 0 ? 1 : -1;
    }
  }
  out.dist = Math.sqrt(best);
  return out;
}

/** Intersection of segments p1p2 and p3p4. Returns parameters along each or null. */
export function segmentIntersect(
  x1: number, z1: number, x2: number, z2: number,
  x3: number, z3: number, x4: number, z4: number,
): { t: number; u: number } | null {
  const d = (x2 - x1) * (z4 - z3) - (z2 - z1) * (x4 - x3);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((x3 - x1) * (z4 - z3) - (z3 - z1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (z2 - z1) - (z3 - z1) * (x2 - x1)) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

/** Intersection of infinite lines p + t·d and q + u·e. */
export function lineIntersect(
  px: number, pz: number, dx: number, dz: number,
  qx: number, qz: number, ex: number, ez: number,
): { t: number; u: number } | null {
  const den = dx * ez - dz * ex;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((qx - px) * ez - (qz - pz) * ex) / den;
  const u = ((qx - px) * dz - (qz - pz) * dx) / den;
  return { t, u };
}

export interface PolyHit {
  /** Arc length along first polyline. */
  sA: number;
  /** Arc length along second polyline. */
  sB: number;
  x: number;
  z: number;
  /** Angle between the two polylines at the hit, radians in [0, π/2]. */
  angle: number;
}

export function polylineIntersections(a: Polyline, b: Polyline): PolyHit[] {
  const hits: PolyHit[] = [];
  const pa = a.pts;
  const pb = b.pts;
  for (let i = 0; i < a.count - 1; i++) {
    const ax0 = pa[i * 2], az0 = pa[i * 2 + 1], ax1 = pa[i * 2 + 2], az1 = pa[i * 2 + 3];
    const minAx = Math.min(ax0, ax1), maxAx = Math.max(ax0, ax1);
    const minAz = Math.min(az0, az1), maxAz = Math.max(az0, az1);
    for (let j = 0; j < b.count - 1; j++) {
      const bx0 = pb[j * 2], bz0 = pb[j * 2 + 1], bx1 = pb[j * 2 + 2], bz1 = pb[j * 2 + 3];
      if (Math.max(bx0, bx1) < minAx || Math.min(bx0, bx1) > maxAx) continue;
      if (Math.max(bz0, bz1) < minAz || Math.min(bz0, bz1) > maxAz) continue;
      const r = segmentIntersect(ax0, az0, ax1, az1, bx0, bz0, bx1, bz1);
      if (!r) continue;
      const dax = ax1 - ax0, daz = az1 - az0, dbx = bx1 - bx0, dbz = bz1 - bz0;
      const la = Math.hypot(dax, daz) || 1;
      const lb = Math.hypot(dbx, dbz) || 1;
      const cos = Math.abs((dax * dbx + daz * dbz) / (la * lb));
      const hit: PolyHit = {
        sA: a.cum[i] + la * r.t,
        sB: b.cum[j] + lb * r.u,
        x: ax0 + dax * r.t,
        z: az0 + daz * r.t,
        angle: Math.acos(Math.min(1, cos)),
      };
      // Skip duplicates produced at shared sample vertices.
      if (hits.some((h) => Math.abs(h.sA - hit.sA) < 0.5)) continue;
      hits.push(hit);
    }
  }
  hits.sort((p, q) => p.sA - q.sA);
  return hits;
}

/** Oriented rectangle. Local x axis = (cos a, sin a), local z axis = (-sin a, cos a). */
export interface OBB {
  cx: number;
  cz: number;
  /** Half extent along local x. */
  hw: number;
  /** Half extent along local z. */
  hd: number;
  angle: number;
}

export function obbCorners(o: OBB): number[] {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const ux = c * o.hw, uz = s * o.hw;
  const vx = -s * o.hd, vz = c * o.hd;
  return [
    o.cx - ux - vx, o.cz - uz - vz,
    o.cx + ux - vx, o.cz + uz - vz,
    o.cx + ux + vx, o.cz + uz + vz,
    o.cx - ux + vx, o.cz - uz + vz,
  ];
}

export function obbBounds(o: OBB): [number, number, number, number] {
  const c = Math.abs(Math.cos(o.angle));
  const s = Math.abs(Math.sin(o.angle));
  const ex = c * o.hw + s * o.hd;
  const ez = s * o.hw + c * o.hd;
  return [o.cx - ex, o.cz - ez, o.cx + ex, o.cz + ez];
}

export function pointInOBB(o: OBB, px: number, pz: number, margin = 0): boolean {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const dx = px - o.cx;
  const dz = pz - o.cz;
  const lx = dx * c + dz * s;
  const lz = -dx * s + dz * c;
  return Math.abs(lx) <= o.hw + margin && Math.abs(lz) <= o.hd + margin;
}

/** Signed distance-ish measure outside the box (0 inside). */
export function distanceToOBB(o: OBB, px: number, pz: number): number {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const dx = px - o.cx;
  const dz = pz - o.cz;
  const lx = Math.abs(dx * c + dz * s) - o.hw;
  const lz = Math.abs(-dx * s + dz * c) - o.hd;
  const ox = Math.max(lx, 0);
  const oz = Math.max(lz, 0);
  return Math.hypot(ox, oz);
}

export function obbIntersects(a: OBB, b: OBB, margin = 0): boolean {
  const axes = [a.angle, a.angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2];
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  for (const ang of axes) {
    const ax = Math.cos(ang);
    const az = Math.sin(ang);
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (let i = 0; i < 8; i += 2) {
      const pa = ca[i] * ax + ca[i + 1] * az;
      const pb = cb[i] * ax + cb[i + 1] * az;
      if (pa < minA) minA = pa;
      if (pa > maxA) maxA = pa;
      if (pb < minB) minB = pb;
      if (pb > maxB) maxB = pb;
    }
    if (maxA + margin <= minB || maxB + margin <= minA) return false;
  }
  return true;
}

/** Transforms lot-local (lx along frontage, lz away from road) to world. */
export function localToWorld(o: { cx: number; cz: number; angle: number }, lx: number, lz: number, out: P2): P2 {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  out.x = o.cx + lx * c - lz * s;
  out.z = o.cz + lx * s + lz * c;
  return out;
}
