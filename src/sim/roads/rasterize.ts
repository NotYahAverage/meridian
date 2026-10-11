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

/**
 * Visits every grid point within `radius` of the polyline, reporting the
 * distance to the nearest polyline piece visited. A point may be reported more
 * than once; callers should keep the minimum.
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
  const maxI = centered ? res - 1 : res - 1;
  for (let i = 0; i < poly.count - 1; i++) {
    const x0 = pts[i * 2];
    const z0 = pts[i * 2 + 1];
    const x1 = pts[i * 2 + 2];
    const z1 = pts[i * 2 + 3];
    let ix0 = Math.floor((Math.min(x0, x1) - radius) / cell - off);
    let ix1 = Math.ceil((Math.max(x0, x1) + radius) / cell - off);
    let iz0 = Math.floor((Math.min(z0, z1) - radius) / cell - off);
    let iz1 = Math.ceil((Math.max(z0, z1) + radius) / cell - off);
    ix0 = Math.max(ix0, clip ? clip.ix0 : 0, 0);
    iz0 = Math.max(iz0, clip ? clip.iz0 : 0, 0);
    ix1 = Math.min(ix1, clip ? clip.ix1 : maxI, maxI);
    iz1 = Math.min(iz1, clip ? clip.iz1 : maxI, maxI);
    const dx = x1 - x0;
    const dz = z1 - z0;
    const l2 = dx * dx + dz * dz;
    const r2 = radius * radius;
    for (let iz = iz0; iz <= iz1; iz++) {
      const pz = (iz + off) * cell;
      for (let ix = ix0; ix <= ix1; ix++) {
        const px = (ix + off) * cell;
        let f = l2 > 0 ? ((px - x0) * dx + (pz - z0) * dz) / l2 : 0;
        f = f < 0 ? 0 : f > 1 ? 1 : f;
        const qx = x0 + dx * f - px;
        const qz = z0 + dz * f - pz;
        const d2 = qx * qx + qz * qz;
        if (d2 <= r2) cb(ix, iz, Math.sqrt(d2));
      }
    }
  }
}
