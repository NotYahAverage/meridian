import { clamp, lerp } from '../../core/math';
import type { Building, Buildings } from '../buildings/Buildings';
import { GRID_CELL, GRID_RES } from '../constants';
import type { RoadNetwork, RoadSegment } from '../roads/RoadNetwork';
import { ROAD_TYPES, isFreeway } from '../roads/RoadTypes';
import { rasterizePolyline } from '../roads/rasterize';
import type { Coverage } from '../services/Coverage';
import { SERVICE_BY_ID } from '../services/ServiceTypes';
import type { TrafficModel } from '../traffic/TrafficModel';
import { BuildingState, Problem, Zone, zoneBase } from '../types';
import type { Terrain } from '../world/Terrain';

const N = GRID_RES * GRID_RES;

/** Policy multipliers: pollution emitted by a building, park value per grid cell. */
export interface LandValueMods {
  pollution: (b: Building) => number;
  parks: (cell: number) => number;
  /** Living trees per grid cell: they filter air, damp noise and look nice. */
  trees?: Uint16Array;
  /** City-wide land value change (research). */
  bonus?: number;
}
const NO_MODS: LandValueMods = { pollution: () => 1, parks: () => 1 };
/** How far beyond the city's streets anything here can reach (the widest pollution plume). */
const REACH = 640;

interface Window {
  ix0: number;
  iz0: number;
  ix1: number;
  iz1: number;
}
const GRID = { cell: GRID_CELL, res: GRID_RES, centered: true };

const INDUSTRY_POLLUTION: Record<string, [number, number]> = {
  workshop: [0.25, 110],
  warehouse: [0.3, 140],
  factory: [0.75, 260],
  depot: [0.45, 180],
  greenhouse: [0.06, 80],
};

/**
 * Land value, ground pollution and traffic noise on the analysis grid.
 * Values move gradually toward their targets so the city reacts smoothly.
 */
export class LandValue {
  readonly value = new Float32Array(N);
  readonly pollution = new Float32Array(N);
  readonly noise = new Float32Array(N);
  readonly commerce = new Float32Array(N);
  private access = new Float32Array(N);
  private garbage = new Float32Array(N);
  private transitAccess = new Float32Array(N);
  private tmp = new Float32Array(N);
  /** Static terrain contribution (water views, hilltops). */
  private scenic: Float32Array | null = null;
  /** Per-segment footprint on the grid: cell indices and distances (cached). */
  private footprints = new Map<number, { type: string; poly: unknown; cells: Int32Array; dist: Float32Array }>();
  version = 0;

  constructor(private terrain: Terrain) {
    this.value.fill(0.3);
  }

  private green = new Float32Array(N);

  /** 0–1 tree cover per cell, averaged over neighbours (a small wood shades its surroundings). */
  private greenery(trees: Uint16Array | undefined, w: Window): Float32Array {
    const g = this.green;
    if (!trees) return g.fill(0);
    for (let iz = w.iz0; iz <= w.iz1; iz++) {
      for (let ix = w.ix0; ix <= w.ix1; ix++) {
        let sum = 0, n = 0;
        for (let dz = -1; dz <= 1; dz++) {
          const jz = iz + dz;
          if (jz < 0 || jz >= GRID_RES) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const jx = ix + dx;
            if (jx < 0 || jx >= GRID_RES) continue;
            sum += trees[jz * GRID_RES + jx] * (dx || dz ? 0.5 : 1);
            n += dx || dz ? 0.5 : 1;
          }
        }
        g[iz * GRID_RES + ix] = Math.min(1, sum / n / 6);
      }
    }
    return g;
  }

  /** Drops the cached scenery term (water views, hills) after terraforming. */
  invalidateScenic(): void {
    this.scenic = null;
  }

  private scenicField(): Float32Array {
    if (this.scenic) return this.scenic;
    const f = new Float32Array(N);
    for (let iz = 0; iz < GRID_RES; iz++) {
      for (let ix = 0; ix < GRID_RES; ix++) {
        const i = iz * GRID_RES + ix;
        const shore = this.terrain.shoreDist[i];
        const waterView = shore > 0 && shore < 260 ? 1 - shore / 260 : 0;
        const h = this.terrain.sampleBase((ix + 0.5) * GRID_CELL, (iz + 0.5) * GRID_CELL);
        f[i] = 0.12 * waterView + 0.05 * clamp((h - 20) / 50, 0, 1);
      }
    }
    return (this.scenic = f);
  }

  /** Grid cells within reach of a segment, with their nearest distance. */
  private footprint(seg: RoadSegment, radius: number): { cells: Int32Array; dist: Float32Array } {
    const cached = this.footprints.get(seg.id);
    if (cached && cached.type === seg.type && cached.poly === seg.poly) return cached;
    const best = new Map<number, number>();
    rasterizePolyline(seg.poly, radius, GRID, null, (ix, iz, d) => {
      const i = iz * GRID_RES + ix;
      const prev = best.get(i);
      if (prev === undefined || d < prev) best.set(i, d);
    });
    const cells = new Int32Array(best.size);
    const dist = new Float32Array(best.size);
    let k = 0;
    for (const [i, d] of best) {
      cells[k] = i;
      dist[k++] = d;
    }
    const fp = { type: seg.type, poly: seg.poly, cells, dist };
    this.footprints.set(seg.id, fp);
    return fp;
  }

  private idx(x: number, z: number): number {
    const ix = clamp(Math.floor(x / GRID_CELL), 0, GRID_RES - 1);
    const iz = clamp(Math.floor(z / GRID_CELL), 0, GRID_RES - 1);
    return iz * GRID_RES + ix;
  }

  at(x: number, z: number): number {
    return this.value[this.idx(x, z)];
  }

  pollutionAt(x: number, z: number): number {
    return this.pollution[this.idx(x, z)];
  }

  noiseAt(x: number, z: number): number {
    return this.noise[this.idx(x, z)];
  }

  private splat(g: Float32Array, x: number, z: number, radius: number, amount: number): void {
    const ix0 = Math.max(0, Math.floor((x - radius) / GRID_CELL));
    const iz0 = Math.max(0, Math.floor((z - radius) / GRID_CELL));
    const ix1 = Math.min(GRID_RES - 1, Math.floor((x + radius) / GRID_CELL));
    const iz1 = Math.min(GRID_RES - 1, Math.floor((z + radius) / GRID_CELL));
    for (let iz = iz0; iz <= iz1; iz++) {
      const dz = (iz + 0.5) * GRID_CELL - z;
      for (let ix = ix0; ix <= ix1; ix++) {
        const dx = (ix + 0.5) * GRID_CELL - x;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d >= radius) continue;
        g[iz * GRID_RES + ix] += amount * (1 - d / radius);
      }
    }
  }

  /**
   * Grid cells the update has to visit: everything within reach of the city's
   * streets (freeways excepted). The rest of the (large) world has nothing on it.
   */
  private window(net: RoadNetwork): Window | null {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const seg of net.segments.values()) {
      if (isFreeway(seg.type)) continue;
      for (const id of [seg.a, seg.b]) {
        const n = net.nodes.get(id);
        if (!n) continue;
        x0 = Math.min(x0, n.x);
        z0 = Math.min(z0, n.z);
        x1 = Math.max(x1, n.x);
        z1 = Math.max(z1, n.z);
      }
    }
    if (x0 > x1) return null;
    const cell = (v: number) => clamp(Math.floor(v / GRID_CELL), 0, GRID_RES - 1);
    return { ix0: cell(x0 - REACH), iz0: cell(z0 - REACH), ix1: cell(x1 + REACH), iz1: cell(z1 + REACH) };
  }

  /** Recomputes everything; `blend` = 1 snaps to targets (used on load). */
  update(
    buildings: Buildings,
    net: RoadNetwork,
    coverage: Coverage,
    traffic: TrafficModel,
    blend = 0.3,
    transitStops: { x: number; z: number }[] = [],
    mods: LandValueMods = NO_MODS,
  ): void {
    const it = this.updateSteps(buildings, net, coverage, traffic, blend, transitStops, mods);
    while (!it.next().done);
  }

  /** The same work as update(), one pass per next() so it can be spread over ticks. */
  *updateSteps(
    buildings: Buildings,
    net: RoadNetwork,
    coverage: Coverage,
    traffic: TrafficModel,
    blend = 0.3,
    transitStops: { x: number; z: number }[] = [],
    mods: LandValueMods = NO_MODS,
  ): Generator<void, void, void> {
    const tmp = this.tmp;
    const w = this.window(net);
    if (!w) {
      this.version++;
      return;
    }
    // Every pass below visits only the window's cells.
    const each = (fn: (i: number) => void) => {
      for (let iz = w.iz0; iz <= w.iz1; iz++) for (let i = iz * GRID_RES + w.ix0, end = iz * GRID_RES + w.ix1; i <= end; i++) fn(i);
    };
    // ── Pollution ────────────────────────────────────────────────────────
    tmp.fill(0);
    for (const b of buildings.all.values()) {
      if (b.state !== BuildingState.Active && b.state !== BuildingState.Burning) continue;
      if (b.kind === 'zoned' && zoneBase(b.zone) === Zone.Industrial) {
        const p = INDUSTRY_POLLUTION[b.style];
        // Light industry is built to sit near homes: a fraction of the pollution.
        const light = b.zone === Zone.IndustrialLight ? 0.35 : 1;
        if (p) this.splat(tmp, b.cx, b.cz, p[1] * (light < 1 ? 0.7 : 1), p[0] * light * mods.pollution(b) * (0.5 + 0.5 * (b.workers / Math.max(1, b.jobs))));
      } else if (b.kind === 'service') {
        const st = SERVICE_BY_ID.get(b.typeId);
        if (st && st.pollution > 0) this.splat(tmp, b.cx, b.cz, 180 + st.pollution * 420, st.pollution * 1.2 * (st.kind === 'power' ? mods.pollution(b) : 1));
        // Negative pollution: air-cleaning facilities scrub their surroundings.
        else if (st && st.pollution < 0 && b.state === BuildingState.Active) this.splat(tmp, b.cx, b.cz, st.radius || 300, st.pollution * 1.6);
      }
    }
    const green = this.greenery(mods.trees, w);
    each((i) => {
      const target = 1 - Math.exp(-Math.max(0, tmp[i]) * 1.4 * (1 - 0.3 * green[i]));
      this.pollution[i] = lerp(this.pollution[i], target, blend);
    });
    yield;

    // ── Noise & access from roads ────────────────────────────────────────
    tmp.fill(0);
    this.access.fill(0);
    for (const id of this.footprints.keys()) if (!net.segments.has(id)) this.footprints.delete(id);
    const access = this.access;
    for (const seg of net.segments.values()) {
      const rt = ROAD_TYPES[seg.type];
      const vol = traffic.volume.get(seg.id) ?? 0;
      const level = rt.noise * (0.18 + Math.min(1.2, vol / 1400));
      const r = rt.halfWidth + 70;
      const { cells, dist } = this.footprint(seg, r);
      for (let k = 0; k < cells.length; k++) {
        const i = cells[k];
        const d = dist[k];
        const f = 1 - d / r;
        const v = level * f * f;
        if (v > tmp[i]) tmp[i] = v;
        const a = 1 - Math.max(0, d - rt.halfWidth) / 70;
        if (a > access[i]) access[i] = a;
      }
    }
    each((i) => {
      this.noise[i] = lerp(this.noise[i], Math.min(1, tmp[i]) * (1 - 0.3 * green[i]), blend);
    });
    yield;

    // ── Commerce proximity and garbage blight ────────────────────────────
    this.commerce.fill(0);
    this.garbage.fill(0);
    for (const b of buildings.all.values()) {
      if (b.state !== BuildingState.Active) continue;
      if (zoneBase(b.zone) === Zone.Commercial) this.splat(this.commerce, b.cx, b.cz, 260, (b.workers + 4) / 60);
      if (b.problems & Problem.Garbage) this.splat(this.garbage, b.cx, b.cz, 90, 0.5);
      if (b.state === BuildingState.Active && b.problems & (Problem.NoPower | Problem.NoWater)) this.splat(this.garbage, b.cx, b.cz, 60, 0.15);
    }
    // Good bus service makes nearby land more desirable.
    const transit = this.transitAccess;
    transit.fill(0);
    for (const st of transitStops) this.splat(transit, st.x, st.z, 300, 1);
    each((i) => {
      this.commerce[i] = 1 - Math.exp(-this.commerce[i]);
      this.garbage[i] = Math.min(1, this.garbage[i]);
    });
    yield;

    // ── Land value ───────────────────────────────────────────────────────
    const g = coverage.grids;
    const scenic = this.scenicField();
    each((i) => {
      let v = 0.24 + scenic[i] + (mods.bonus ?? 0);
      v += 0.24 * mods.parks(i) * g.park[i];
      v += 0.05 * green[i];
      v += 0.05 * g.police[i] + 0.05 * g.health[i] + 0.06 * g.education[i] + 0.03 * g.fire[i];
      v += 0.1 * this.commerce[i];
      v += 0.08 * access[i];
      v += 0.05 * Math.min(1, transit[i]);
      v -= 0.5 * this.pollution[i];
      v -= 0.22 * this.noise[i];
      v -= 0.16 * this.garbage[i];
      this.value[i] = lerp(this.value[i], clamp(v, 0, 1), blend);
    });
    this.version++;
  }

  loadValues(value: Float32Array, pollution: Float32Array): void {
    this.value.set(value);
    this.pollution.set(pollution);
    this.version++;
  }
}
