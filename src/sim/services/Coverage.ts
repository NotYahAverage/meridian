import { clamp } from '../../core/math';
import type { Building } from '../buildings/Buildings';
import type { Buildings } from '../buildings/Buildings';
import { GRID_CELL, GRID_RES } from '../constants';
import { BuildingState } from '../types';
import { COVERAGE_KINDS, type CoverageKind, SERVICE_BY_ID, type ServiceType } from './ServiceTypes';

export interface ServiceStatus {
  load: number;
  effectiveness: number;
}

/** Coverage falloff: full strength to 60% of the radius, linear to zero at the edge. */
export function coverageFalloff(d: number, radius: number): number {
  if (d >= radius) return 0;
  const inner = radius * 0.6;
  if (d <= inner) return 1;
  return 1 - (d - inner) / (radius - inner);
}

/**
 * Radius-based service coverage on the analysis grid. Each service's strength
 * is scaled by its effectiveness (capacity vs. residents within range) and
 * overlapping services combine as a probabilistic union.
 */
/** Cell size of the coarse residents grid used for service load estimates. */
const LOAD_CELL = 64;
const LOAD_RES = Math.ceil((GRID_RES * GRID_CELL) / LOAD_CELL);

export class Coverage {
  readonly grids = {} as Record<CoverageKind, Float32Array>;
  readonly status = new Map<number, ServiceStatus>();
  version = 0;
  private residents = new Float32Array(LOAD_RES * LOAD_RES);
  /** Falloff kernels keyed by radius (grid-cell offsets → strength). */
  private kernels = new Map<number, { r: number; w: Float32Array }>();

  constructor() {
    for (const k of COVERAGE_KINDS) this.grids[k] = new Float32Array(GRID_RES * GRID_RES);
  }

  at(kind: CoverageKind, x: number, z: number): number {
    const ix = clamp(Math.floor(x / GRID_CELL), 0, GRID_RES - 1);
    const iz = clamp(Math.floor(z / GRID_CELL), 0, GRID_RES - 1);
    return this.grids[kind][iz * GRID_RES + ix];
  }

  static isOperational(b: Building): boolean {
    return b.kind === 'service' && b.state === BuildingState.Active && b.segId !== 0;
  }

  /** Funding level per service kind (1 = standard); set by the city. */
  funding: (kind: string) => number = () => 1;

  recompute(buildings: Buildings): void {
    for (const k of COVERAGE_KINDS) this.grids[k].fill(0);
    this.status.clear();
    const res = this.residents;
    res.fill(0);
    for (const b of buildings.all.values()) {
      if (b.residents <= 0) continue;
      const ix = clamp(Math.floor(b.cx / LOAD_CELL), 0, LOAD_RES - 1);
      const iz = clamp(Math.floor(b.cz / LOAD_CELL), 0, LOAD_RES - 1);
      res[iz * LOAD_RES + ix] += b.residents;
    }
    for (const b of buildings.all.values()) {
      if (b.kind !== 'service') continue;
      const st = SERVICE_BY_ID.get(b.typeId);
      if (!st || st.radius <= 0) continue;
      if (!Coverage.isOperational(b)) {
        this.status.set(b.id, { load: 0, effectiveness: 0 });
        continue;
      }
      const f = this.funding(st.kind);
      // Well-funded services reach a little further and serve more people.
      const radius = Math.round(st.radius * (0.8 + 0.2 * f));
      const eff = this.effectiveness(b, st, radius, f);
      this.splat(st.kind === 'landmark' ? 'park' : (st.kind as CoverageKind), b.cx, b.cz, radius, eff);
    }
    this.version++;
  }

  private effectiveness(b: Building, st: ServiceType, radius = st.radius, funding = 1): number {
    let eff = 1;
    let load = 0;
    if (st.kind === 'park' || st.kind === 'landmark') {
      eff = Math.min(1, st.attractiveness * (0.7 + 0.3 * funding));
    } else if (st.kind === 'garbage') {
      // Landfills stop accepting garbage when full.
      if (st.id === 'landfill' && b.stock >= LANDFILL_CAPACITY) eff = 0;
      load = 0;
    } else if (st.capacity > 0) {
      const r = radius;
      const ix0 = Math.max(0, Math.floor((b.cx - r) / LOAD_CELL));
      const iz0 = Math.max(0, Math.floor((b.cz - r) / LOAD_CELL));
      const ix1 = Math.min(LOAD_RES - 1, Math.floor((b.cx + r) / LOAD_CELL));
      const iz1 = Math.min(LOAD_RES - 1, Math.floor((b.cz + r) / LOAD_CELL));
      for (let iz = iz0; iz <= iz1; iz++) {
        const dz = (iz + 0.5) * LOAD_CELL - b.cz;
        for (let ix = ix0; ix <= ix1; ix++) {
          const n = this.residents[iz * LOAD_RES + ix];
          if (n <= 0) continue;
          const dx = (ix + 0.5) * LOAD_CELL - b.cx;
          load += n * coverageFalloff(Math.sqrt(dx * dx + dz * dz), r);
        }
      }
      const cap = st.capacity * funding;
      eff = load > cap ? cap / load : 1;
    }
    this.status.set(b.id, { load, effectiveness: eff });
    return eff;
  }

  /** Falloff weights on a square of grid cells around a cell centre. */
  private kernel(radius: number): { r: number; w: Float32Array } {
    let k = this.kernels.get(radius);
    if (k) return k;
    const r = Math.ceil(radius / GRID_CELL);
    const n = 2 * r + 1;
    const w = new Float32Array(n * n);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) w[(dz + r) * n + dx + r] = coverageFalloff(Math.hypot(dx, dz) * GRID_CELL, radius);
    }
    k = { r, w };
    this.kernels.set(radius, k);
    return k;
  }

  private splat(kind: CoverageKind, x: number, z: number, radius: number, strength: number): void {
    if (strength <= 0) return;
    const g = this.grids[kind];
    const { r, w } = this.kernel(radius);
    const n = 2 * r + 1;
    // Snap the source to its cell; coverage is evaluated at cell centres.
    const cx = Math.floor(x / GRID_CELL);
    const cz = Math.floor(z / GRID_CELL);
    const ix0 = Math.max(0, cx - r), ix1 = Math.min(GRID_RES - 1, cx + r);
    const iz0 = Math.max(0, cz - r), iz1 = Math.min(GRID_RES - 1, cz + r);
    for (let iz = iz0; iz <= iz1; iz++) {
      const row = (iz - cz + r) * n + r - cx;
      const base = iz * GRID_RES;
      for (let ix = ix0; ix <= ix1; ix++) {
        const f = w[row + ix] * strength;
        if (f <= 0) continue;
        const i = base + ix;
        g[i] = 1 - (1 - g[i]) * (1 - f);
      }
    }
  }

  /** Average coverage weighted by residents. */
  averageFor(kind: CoverageKind, buildings: Buildings): number {
    let w = 0;
    let s = 0;
    for (const b of buildings.all.values()) {
      if (b.residents <= 0) continue;
      w += b.residents;
      s += b.residents * this.at(kind, b.cx, b.cz);
    }
    return w > 0 ? s / w : 0;
  }
}

/** Total garbage units a landfill can hold before it is full. */
export const LANDFILL_CAPACITY = 220_000;

export function serviceTypeOf(b: Building): ServiceType | undefined {
  return b.kind === 'service' ? SERVICE_BY_ID.get(b.typeId) : undefined;
}
