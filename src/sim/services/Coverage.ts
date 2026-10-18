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
    const it = this.recomputeSteps(buildings, Infinity);
    while (!it.next().done);
  }

  private spare: Record<CoverageKind, Float32Array> | null = null;

  /**
   * The same as recompute(), `perStep` services per next(). Big cities spread
   * the periodic refresh over several ticks: the new grids are built aside and
   * swapped in at the end, so readers never see a half-finished map.
   */
  *recomputeSteps(buildings: Buildings, perStep: number): Generator<void, void, void> {
    const live = this.grids;
    const fresh = this.spare ?? ({} as Record<CoverageKind, Float32Array>);
    for (const k of COVERAGE_KINDS) {
      if (!fresh[k]) fresh[k] = new Float32Array(GRID_RES * GRID_RES);
      fresh[k].fill(0);
    }
    const status = new Map<number, ServiceStatus>();
    this.building = { grids: fresh, status };
    const res = this.residents;
    res.fill(0);
    for (const b of buildings.all.values()) {
      if (b.residents <= 0) continue;
      const ix = clamp(Math.floor(b.cx / LOAD_CELL), 0, LOAD_RES - 1);
      const iz = clamp(Math.floor(b.cz / LOAD_CELL), 0, LOAD_RES - 1);
      res[iz * LOAD_RES + ix] += b.residents;
    }
    let done = 0;
    const services = [...buildings.all.values()].filter((b) => b.kind === 'service');
    for (const b of services) {
      if (++done % perStep === 0) yield;
      // Removed while this was running.
      if (!buildings.get(b.id)) continue;
      const st = SERVICE_BY_ID.get(b.typeId);
      if (!st || st.radius <= 0) continue;
      if (!Coverage.isOperational(b)) {
        status.set(b.id, { load: 0, effectiveness: 0 });
        continue;
      }
      const f = this.funding(st.kind);
      // Well-funded services reach a little further and serve more people.
      const radius = Math.round(st.radius * (0.8 + 0.2 * f));
      const eff = this.effectiveness(b, st, radius, f);
      this.splat(st.kind === 'landmark' ? 'park' : (st.kind as CoverageKind), b.cx, b.cz, radius, eff);
    }
    // Swap the finished grids in (keeping the same objects readers hold).
    for (const k of COVERAGE_KINDS) {
      const old = live[k];
      live[k] = fresh[k];
      fresh[k] = old;
    }
    this.spare = fresh;
    this.status.clear();
    for (const [id, v] of status) this.status.set(id, v);
    this.building = null;
    this.version++;
  }

  /** Grids and status being filled by the recompute in progress. */
  private building: { grids: Record<CoverageKind, Float32Array>; status: Map<number, ServiceStatus> } | null = null;

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
    (this.building?.status ?? this.status).set(b.id, { load, effectiveness: eff });
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
    const g = (this.building?.grids ?? this.grids)[kind];
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

  private avgCache: { version: number; residents: number; values: Record<CoverageKind, number> } | null = null;

  /** Average coverage weighted by residents (all kinds worked out in one pass, cached until coverage changes). */
  averageFor(kind: CoverageKind, buildings: Buildings): number {
    return this.averages(buildings)[kind];
  }

  /** Every kind's average coverage, weighted by residents (one pass over the buildings). */
  averages(buildings: Buildings): Record<CoverageKind, number> {
    let residents = 0;
    for (const b of buildings.all.values()) residents += b.residents;
    const c = this.avgCache;
    if (c && c.version === this.version && c.residents === residents) return c.values;
    const sums = {} as Record<CoverageKind, number>;
    for (const k of COVERAGE_KINDS) sums[k] = 0;
    let w = 0;
    for (const b of buildings.all.values()) {
      if (b.residents <= 0) continue;
      w += b.residents;
      const ix = clamp(Math.floor(b.cx / GRID_CELL), 0, GRID_RES - 1);
      const iz = clamp(Math.floor(b.cz / GRID_CELL), 0, GRID_RES - 1);
      const i = iz * GRID_RES + ix;
      for (const k of COVERAGE_KINDS) sums[k] += b.residents * this.grids[k][i];
    }
    for (const k of COVERAGE_KINDS) sums[k] = w > 0 ? sums[k] / w : 0;
    this.avgCache = { version: this.version, residents, values: sums };
    return sums;
  }
}

/** Total garbage units a landfill can hold before it is full. */
export const LANDFILL_CAPACITY = 220_000;

export function serviceTypeOf(b: Building): ServiceType | undefined {
  return b.kind === 'service' ? SERVICE_BY_ID.get(b.typeId) : undefined;
}
