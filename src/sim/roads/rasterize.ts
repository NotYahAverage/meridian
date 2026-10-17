import type { Polyline } from '../../core/geom2d';

export interface GridSpec {
  cell: number;
  res: number;
  /** When true grid points sit at cell centres ((i + 0.5) * cell), else at i * cell. */
  centered: boolean;
}

export interface IndexRect {
  ix0: number;
  iz0: number;
  ix1: number;
  iz1: number;
}

/** Narrows [lo, hi] to where coef·px ≥ rhs. */
function halfPlane(coef: number, rhs: number, iv: number[]): void {
  if (coef > 0) iv[0] = Math.max(iv[0], rhs / coef);
  else if (coef < 0) iv[1] = Math.min(iv[1], rhs / coef);
  else if (rhs > 0) iv[0] = Infinity;
}

const IV = [0, 0];

/**
 * Visits every grid point within `radius` of the polyline, reporting the
 * distance to the nearest polyline piece visited. A point may be reported more
 * than once; callers should keep the minimum.
 *
 * Each point is visited where its nearest point on the line can lie: the strip
 * beside each piece, and on the outside of each bend the wedge nearest the
 * corner. Curved roads are many short pieces, so visiting each piece's whole
 * neighbourhood would see every point dozens of times.
 */
export function rasterizePolyline(
  poly: Polyline,
  radius: number,
  grid: GridSpec,
  clip: IndexRect | null,
  cb: (ix: number, iz: number, d: number) => void,
): void {
  const { cell, res, centered } = grid;
  const off = centered ? 0.5 : 0;
  const pts = poly.pts;
  const n = poly.count;
  const maxI = res - 1;
  const r2 = radius * radius;
  const cx0 = Math.max(clip ? clip.ix0 : 0, 0), cx1 = Math.min(clip ? clip.ix1 : maxI, maxI);
  const cz0 = Math.max(clip ? clip.iz0 : 0, 0), cz1 = Math.min(clip ? clip.iz1 : maxI, maxI);
  const iv = IV;
  // Distance from (px, pz) to piece k (clamped to its ends), as the old full scan computed it.
  const visit = (k: number, iz: number, pz: number, lo: number, hi: number) => {
    const x0 = pts[k * 2], z0 = pts[k * 2 + 1];
    const dx = pts[k * 2 + 2] - x0, dz = pts[k * 2 + 3] - z0;
    const l2 = dx * dx + dz * dz;
    const a = Math.max(cx0, Math.floor(lo / cell - off) - 1);
    const b = Math.min(cx1, Math.ceil(hi / cell - off) + 1);
    for (let ix = a; ix <= b; ix++) {
      const px = (ix + off) * cell;
      let f = l2 > 0 ? ((px - x0) * dx + (pz - z0) * dz) / l2 : 0;
      f = f < 0 ? 0 : f > 1 ? 1 : f;
      const qx = x0 + dx * f - px;
      const qz = z0 + dz * f - pz;
      const d2 = qx * qx + qz * qz;
      if (d2 <= r2) cb(ix, iz, Math.sqrt(d2));
    }
  };
  if (n < 2) return;
  // Strips beside each piece.
  for (let k = 0; k < n - 1; k++) {
    const x0 = pts[k * 2], z0 = pts[k * 2 + 1];
    const x1 = pts[k * 2 + 2], z1 = pts[k * 2 + 3];
    const dx = x1 - x0, dz = z1 - z0;
    const l2 = dx * dx + dz * dz;
    if (l2 <= 0) continue;
    const L = Math.sqrt(l2);
    const iz0 = Math.max(cz0, Math.floor((Math.min(z0, z1) - radius) / cell - off));
    const iz1 = Math.min(cz1, Math.ceil((Math.max(z0, z1) + radius) / cell - off));
    for (let iz = iz0; iz <= iz1; iz++) {
      const pz = (iz + off) * cell;
      iv[0] = -Infinity;
      iv[1] = Infinity;
      // 0 ≤ (px-x0)dx + (pz-z0)dz ≤ l2
      halfPlane(dx, x0 * dx - (pz - z0) * dz, iv);
      halfPlane(-dx, -(l2 + x0 * dx - (pz - z0) * dz), iv);
      // |(px-x0)dz - (pz-z0)dx| ≤ r·L
      halfPlane(dz, x0 * dz + (pz - z0) * dx - radius * L, iv);
      halfPlane(-dz, -(x0 * dz + (pz - z0) * dx + radius * L), iv);
      if (iv[0] <= iv[1]) visit(k, iz, pz, iv[0], iv[1]);
    }
  }
  // Corners: the disc round each point, beyond the end of the piece before and the start of the next.
  for (let j = 0; j < n; j++) {
    const vx = pts[j * 2], vz = pts[j * 2 + 1];
    const iz0 = Math.max(cz0, Math.floor((vz - radius) / cell - off));
    const iz1 = Math.min(cz1, Math.ceil((vz + radius) / cell - off));
    const pdx = j > 0 ? vx - pts[j * 2 - 2] : 0, pdz = j > 0 ? vz - pts[j * 2 - 1] : 0;
    const ndx = j < n - 1 ? pts[j * 2 + 2] - vx : 0, ndz = j < n - 1 ? pts[j * 2 + 3] - vz : 0;
    // Measured along the piece it ends (or, for the first point, the piece it starts).
    const k = j > 0 ? j - 1 : 0;
    for (let iz = iz0; iz <= iz1; iz++) {
      const pz = (iz + off) * cell;
      const e = r2 - (pz - vz) * (pz - vz);
      if (e < 0) continue;
      const h = Math.sqrt(e);
      iv[0] = vx - h;
      iv[1] = vx + h;
      // (p - v)·prev ≥ 0 and (p - v)·next ≤ 0
      halfPlane(pdx, vx * pdx - (pz - vz) * pdz, iv);
      halfPlane(-ndx, -(vx * ndx - (pz - vz) * ndz), iv);
      if (iv[0] <= iv[1]) visit(k, iz, pz, iv[0], iv[1]);
    }
  }
}
