import { Noise2D } from '../../core/noise';
import { rasterizePolyline } from '../roads/rasterize';
import type { Polyline } from '../../core/geom2d';
import { clamp, lerp, smoothstep } from '../../core/math';
import { GRID_CELL, GRID_RES, HM_RES, HM_STEP, WATER_LEVEL, WORLD_SIZE } from '../constants';

export type MapPreset = 'coastal' | 'lakes' | 'highlands' | 'river';

export const MAP_PRESETS: Record<MapPreset, { name: string; description: string }> = {
  coastal: {
    name: 'Coastal Bay',
    description: 'A sheltered bay with sandy shores, a quiet lake and forested hills to the north.',
  },
  lakes: {
    name: 'Lakeland Valley',
    description: 'Rolling farmland between three freshwater lakes. Gentle and forgiving.',
  },
  highlands: {
    name: 'Highland Ridge',
    description: 'Dramatic ridges and a deep mountain lake. Plan your roads carefully.',
  },
  river: {
    name: 'River Valley',
    description: 'A winding river splits the valley. Bridge it to reach the fertile east bank.',
  },
};

export interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

interface Lake {
  u: number;
  v: number;
  r: number;
  depth: number;
}

export interface SpawnInfo {
  /** Where the highway enters the map (on the boundary). */
  edgeX: number;
  edgeZ: number;
  /** Where the pre-built highway ends inside the map. */
  endX: number;
  endZ: number;
}

/**
 * Procedural heightfield. `base` is the generated terrain, `road` is a smoothed
 * version that road surfaces follow, and `height` is the final terrain after
 * conforming to roads and building lots.
 */
/** Bridge decks clear the water by this much and ramp down at this grade. */
export const BRIDGE_CLEARANCE = 6.5;
export const BRIDGE_GRADE = 0.11;

export class Terrain {
  readonly base: Float32Array;
  readonly road: Float32Array;
  /** Bridge deck heights stamped along elevated roads (0 elsewhere). */
  readonly bridge: Float32Array;
  readonly height: Float32Array;
  shoreDist: Float32Array;
  readonly forest: Float32Array;
  readonly spawn: SpawnInfo;
  /** Regions whose final height changed since the renderer last looked. */
  readonly dirtyRects: Rect[] = [];
  /** Untouched base and road fields, kept once the player starts terraforming. */
  natural: Float32Array | null = null;
  naturalRoad: Float32Array | null = null;
  /** Bumped whenever the water outline or depth may have changed. */
  waterVersion = 0;
  /** Freshly moved earth per heightmap vertex (255 = bare soil), regrowing over weeks. */
  readonly soil = new Uint8Array(HM_RES * HM_RES);
  soilVersion = 0;
  private soilActive = false;

  private n1: Noise2D;
  private n2: Noise2D;
  private n3: Noise2D;
  private n4: Noise2D;
  private lakes: Lake[];
  private flatHeight: number | null;

  constructor(readonly seed: number, readonly preset: MapPreset, opts: { flat?: number } = {}) {
    this.n1 = new Noise2D(seed ^ 0x1234);
    this.n2 = new Noise2D(seed ^ 0x5678);
    this.n3 = new Noise2D(seed ^ 0x9abc);
    this.n4 = new Noise2D(seed ^ 0xdef0);
    this.flatHeight = opts.flat ?? null;
    this.lakes = this.makeLakes();
    this.spawn = this.makeSpawn();

    const n = HM_RES * HM_RES;
    this.base = new Float32Array(n);
    this.road = new Float32Array(n);
    this.bridge = new Float32Array(n);
    this.height = new Float32Array(n);
    for (let iz = 0; iz < HM_RES; iz++) {
      for (let ix = 0; ix < HM_RES; ix++) {
        this.base[iz * HM_RES + ix] = this.baseAt(ix * HM_STEP, iz * HM_STEP);
      }
    }
    this.height.set(this.base);
    this.computeRoadField();
    this.shoreDist = this.computeShoreDistance();
    this.forest = this.computeForest();
  }

  private makeLakes(): Lake[] {
    const r = (k: number) => (this.n1.noise(k * 13.37, 4.2) + 1) * 0.5;
    switch (this.preset) {
      case 'coastal':
        return [{ u: 0.7 + r(1) * 0.08, v: 0.28 + r(2) * 0.06, r: 0.055 + r(3) * 0.02, depth: 9 }];
      case 'lakes':
        return [
          { u: 0.68 + r(1) * 0.06, v: 0.26 + r(2) * 0.06, r: 0.075, depth: 10 },
          { u: 0.24 + r(3) * 0.06, v: 0.76 + r(4) * 0.05, r: 0.07, depth: 9 },
          { u: 0.74 + r(5) * 0.05, v: 0.74 + r(6) * 0.05, r: 0.06, depth: 8 },
        ];
      case 'highlands':
        return [{ u: 0.66 + r(1) * 0.06, v: 0.62 + r(2) * 0.08, r: 0.085, depth: 16 }];
      case 'river':
        // A small oxbow lake left behind by the river.
        return [{ u: 0.78 + r(1) * 0.04, v: 0.2 + r(2) * 0.08, r: 0.03, depth: 5 }];
    }
  }

  private makeSpawn(): SpawnInfo {
    const W = WORLD_SIZE;
    const z = W * (0.44 + this.n1.noise(3.1, 9.7) * 0.04);
    return { edgeX: 0, edgeZ: z, endX: W * 0.3, endZ: z + W * 0.02 };
  }

  /** Analytic terrain height; valid inside and outside the playable map. */
  baseAt(x: number, z: number): number {
    if (this.flatHeight !== null) return this.flatHeight;
    const W = WORLD_SIZE;
    const u = x / W;
    const v = z / W;
    const wx = u + 0.07 * this.n1.noise(u * 3, v * 3);
    const wz = v + 0.07 * this.n1.noise(u * 3 + 17.3, v * 3 + 9.1);
    const rolling = this.n2.fbm(wx * 3.2, wz * 3.2, 5);
    const ridge = this.n3.ridged(wx * 2.4, wz * 2.4, 5);
    const detail = this.n2.fbm(u * 26 + 40, v * 26 - 13, 3);

    // Gentle valley around the starting area so new players can build immediately.
    const sx = this.spawn.endX + W * 0.08;
    const sz = this.spawn.endZ;
    const dSpawn = Math.hypot(x - sx, z - sz);
    const calm = 0.25 + 0.75 * smoothstep(260, 1100, dSpawn);

    let h: number;
    switch (this.preset) {
      case 'coastal': {
        const north = smoothstep(0.62, 0.05, v);
        h = 12 + rolling * 9 * calm + ridge * ridge * 62 * north * calm + detail * 1.1;
        let coast = 0.8 + 0.05 * this.n1.noise(u * 2.4, 7.7) + 0.022 * this.n1.noise(u * 9, 3.3);
        coast -= smoothstep(0.72, 1.05, u) * 0.3;
        const d = v - coast;
        h = lerp(h, 1.4 + detail * 0.4, smoothstep(-0.07, 0, d) * 0.9);
        h = lerp(h, -16, smoothstep(0, 0.05, d));
        break;
      }
      case 'lakes': {
        h = 14 + rolling * 11 * calm + ridge * ridge * 22 * calm + detail * 1.2;
        break;
      }
      case 'highlands': {
        h = 22 + rolling * 14 * calm + ridge * ridge * 95 * calm * smoothstep(0.1, 0.5, Math.abs(u - 0.4) + Math.abs(v - 0.45) * 0.6) + detail * 1.6;
        break;
      }
      case 'river': {
        // The river meanders north–south east of the start; distance is measured across its course.
        const ph = this.n1.noise(5.5, 2.5) * 3;
        const rc = 0.62 + 0.055 * Math.sin(v * 6.3 + ph) + 0.022 * this.n1.noise(v * 4.1, 3.3);
        const slope = 0.055 * 6.3 * Math.cos(v * 6.3 + ph);
        const dm = (Math.abs(u - rc) / Math.sqrt(1 + slope * slope)) * W;
        // Hills and ridges rise away from a broad, gentle valley floor.
        const floor = smoothstep(150, 700, dm);
        h = 14 + rolling * 8 * calm * (0.4 + 0.6 * floor) + ridge * ridge * 34 * calm * floor + detail * 1.1;
        const half = 26 + 7 * this.n4.noise(v * 9, 1.7);
        // A broad valley falls toward the water, then flat meadows, banks and the channel.
        h -= (1 - smoothstep(0, 700, dm)) * 7;
        h = lerp(h, 3.4 + detail * 0.35, 1 - smoothstep(half + 20, half + 170, dm));
        h = lerp(h, -5.5, 1 - smoothstep(half * 0.55, half, dm));
        break;
      }
    }

    for (const lake of this.lakes) {
      const du = u - lake.u;
      const dv = v - lake.v;
      const wobble = 1 + 0.18 * this.n4.noise(u * 9 + lake.u * 50, v * 9);
      const dl = Math.sqrt(du * du + dv * dv) / (lake.r * wobble);
      if (dl < 1.6) {
        const shore = Math.min(h, 2 + detail * 0.5);
        h = lerp(h, shore, smoothstep(1.6, 1.0, dl));
        h = lerp(h, -lake.depth, smoothstep(1.0, 0.45, dl));
      }
    }
    return h;
  }

  private computeRoadField(): void {
    const tmp = new Float32Array(this.base.length);
    const src = new Float32Array(this.base);
    // Two passes of a separable box blur (radius 3 cells) approximate a Gaussian.
    for (let pass = 0; pass < 2; pass++) {
      boxBlur(src, tmp, HM_RES, 3, true);
      boxBlur(tmp, src, HM_RES, 3, false);
    }
    for (let i = 0; i < src.length; i++) this.road[i] = Math.max(src[i], WATER_LEVEL + 1.2);
  }

  private computeShoreDistance(): Float32Array {
    const n = GRID_RES;
    const d = new Float32Array(n * n);
    const INF = 1e6;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const h = this.sampleBase((ix + 0.5) * GRID_CELL, (iz + 0.5) * GRID_CELL);
        d[iz * n + ix] = h < WATER_LEVEL ? 0 : INF;
      }
    }
    // Chamfer distance transform (two passes).
    const D1 = GRID_CELL;
    const D2 = GRID_CELL * Math.SQRT2;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        let v = d[i];
        if (ix > 0) v = Math.min(v, d[i - 1] + D1);
        if (iz > 0) {
          v = Math.min(v, d[i - n] + D1);
          if (ix > 0) v = Math.min(v, d[i - n - 1] + D2);
          if (ix < n - 1) v = Math.min(v, d[i - n + 1] + D2);
        }
        d[i] = v;
      }
    }
    for (let iz = n - 1; iz >= 0; iz--) {
      for (let ix = n - 1; ix >= 0; ix--) {
        const i = iz * n + ix;
        let v = d[i];
        if (ix < n - 1) v = Math.min(v, d[i + 1] + D1);
        if (iz < n - 1) {
          v = Math.min(v, d[i + n] + D1);
          if (ix < n - 1) v = Math.min(v, d[i + n + 1] + D2);
          if (ix > 0) v = Math.min(v, d[i + n - 1] + D2);
        }
        d[i] = Math.min(v, 2000);
      }
    }
    return d;
  }

  private computeForest(): Float32Array {
    const n = GRID_RES;
    const f = new Float32Array(n * n);
    if (this.flatHeight !== null) return f;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const x = (ix + 0.5) * GRID_CELL;
        const z = (iz + 0.5) * GRID_CELL;
        const u = x / WORLD_SIZE;
        const v = z / WORLD_SIZE;
        const h = this.sampleBase(x, z);
        if (h < WATER_LEVEL + 1.5) continue;
        const shore = this.shoreDist[iz * n + ix];
        let dens = this.n4.fbm(u * 7 + 3, v * 7 - 5, 4) * 1.4 + 0.1;
        dens += smoothstep(14, 50, h) * 0.45;
        dens -= smoothstep(120, 20, shore) * 0.4;
        const dSpawn = Math.hypot(x - this.spawn.endX, z - this.spawn.endZ);
        dens -= smoothstep(700, 150, dSpawn) * 0.5;
        f[iz * n + ix] = clamp(dens, 0, 1);
      }
    }
    return f;
  }

  static index(ix: number, iz: number): number {
    return iz * HM_RES + ix;
  }

  private sampleGrid(arr: Float32Array, x: number, z: number): number {
    const fx = clamp(x / HM_STEP, 0, HM_RES - 1.0001);
    const fz = clamp(z / HM_STEP, 0, HM_RES - 1.0001);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const i = iz * HM_RES + ix;
    const a = arr[i];
    const b = arr[i + 1];
    const c = arr[i + HM_RES];
    const d = arr[i + HM_RES + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  /** Land ownership (set by the city); unowned land can't be built on. */
  landCheck: ((x: number, z: number) => boolean) | null = null;

  /** Owned by the city (always true when nothing restricts it). */
  owned(x: number, z: number): boolean {
    return this.landCheck ? this.landCheck(x, z) : true;
  }

  /** Inside the map and on land the city owns. */
  buildable(x: number, z: number, margin = 0): boolean {
    return this.inBounds(x, z, margin) && this.owned(x, z);
  }

  inBounds(x: number, z: number, margin = 0): boolean {
    return x >= margin && z >= margin && x <= WORLD_SIZE - margin && z <= WORLD_SIZE - margin;
  }

  /** Original terrain height (bilinear). Falls back to analytic outside the map. */
  sampleBase(x: number, z: number): number {
    if (!this.inBounds(x, z)) return this.baseAt(x, z);
    return this.sampleGrid(this.base, x, z);
  }

  /** Final terrain height including road/lot conforming. */
  heightAt(x: number, z: number): number {
    if (!this.inBounds(x, z)) return this.baseAt(x, z);
    return this.sampleGrid(this.height, x, z);
  }

  /** Height of a road surface at a point (smooth field shared by all roads, raised on bridges). */
  roadHeightAt(x: number, z: number): number {
    if (!this.inBounds(x, z)) {
      return Math.max(this.baseAt(x, z), WATER_LEVEL + 1.2);
    }
    return Math.max(this.sampleGrid(this.road, x, z), this.sampleGrid(this.bridge, x, z));
  }

  /** Road height ignoring bridges (the at-grade surface). */
  groundRoadHeightAt(x: number, z: number): number {
    if (!this.inBounds(x, z)) return Math.max(this.baseAt(x, z), WATER_LEVEL + 1.2);
    return this.sampleGrid(this.road, x, z);
  }

  /** Smooth distance to the nearest open water (m). */
  waterDistanceAt(x: number, z: number): number {
    const fx = clamp(x / GRID_CELL - 0.5, 0, GRID_RES - 1.0001);
    const fz = clamp(z / GRID_CELL - 0.5, 0, GRID_RES - 1.0001);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const d = this.shoreDist;
    const i = iz * GRID_RES + ix;
    return (d[i] * (1 - tx) + d[i + 1] * tx) * (1 - tz) + (d[i + GRID_RES] * (1 - tx) + d[i + GRID_RES + 1] * tx) * tz;
  }

  /** Height a bridge deck wants at a point: full clearance over water, ramping down onto land. */
  deckHeightAt(x: number, z: number): number {
    return WATER_LEVEL + BRIDGE_CLEARANCE - BRIDGE_GRADE * this.waterDistanceAt(x, z);
  }

  /** True where a bridge deck rises above the at-grade road surface. */
  needsDeck(x: number, z: number, margin = 0.25): boolean {
    return this.deckHeightAt(x, z) > this.groundRoadHeightAt(x, z) + margin;
  }

  /** Rewrites the bridge field from the given elevated road centrelines. */
  stampBridges(roads: { poly: Polyline; halfWidth: number }[]): void {
    const changed: Rect[] = [];
    for (let i = 0; i < this.bridge.length; i++) this.bridge[i] = 0;
    const grid = { cell: HM_STEP, res: HM_RES, centered: false };
    for (const r of roads) {
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      rasterizePolyline(r.poly, r.halfWidth + 3, grid, null, (ix, iz) => {
        const x = ix * HM_STEP, z = iz * HM_STEP;
        const i = iz * HM_RES + ix;
        const deck = this.deckHeightAt(x, z);
        if (deck > this.road[i] && deck > this.bridge[i]) this.bridge[i] = deck;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      });
      if (minX <= maxX) changed.push({ minX, minZ, maxX, maxZ });
    }
    for (const r of changed) this.markDirty(r);
  }

  isWater(x: number, z: number, margin = 0.4): boolean {
    return this.sampleBase(x, z) < WATER_LEVEL + margin;
  }

  shoreDistanceAt(x: number, z: number): number {
    const ix = clamp(Math.floor(x / GRID_CELL), 0, GRID_RES - 1);
    const iz = clamp(Math.floor(z / GRID_CELL), 0, GRID_RES - 1);
    return this.shoreDist[iz * GRID_RES + ix];
  }

  slopeAt(x: number, z: number): number {
    const e = HM_STEP;
    const dx = this.sampleBase(x + e, z) - this.sampleBase(x - e, z);
    const dz = this.sampleBase(x, z + e) - this.sampleBase(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  markDirty(r: Rect): void {
    this.dirtyRects.push(r);
  }

  /** Snapshots the generated fields before the first terraforming edit. */
  beginEdits(): void {
    if (this.natural) return;
    this.natural = new Float32Array(this.base);
    this.naturalRoad = new Float32Array(this.road);
  }

  /** Marks earth as freshly moved (0–1 freshness). */
  disturb(i: number, amount: number): void {
    const v = Math.min(255, Math.round(amount * 255));
    if (v > this.soil[i]) {
      this.soil[i] = v;
      this.soilActive = true;
    }
  }

  /** Grass grows back over bare soil; call once a day. */
  regrow(perDay: number): void {
    if (!this.soilActive) return;
    let any = false;
    const s = this.soil;
    for (let i = 0; i < s.length; i++) {
      if (!s[i]) continue;
      s[i] = s[i] > perDay ? s[i] - perDay : 0;
      if (s[i]) any = true;
    }
    this.soilActive = any;
    this.soilVersion++;
  }

  /** Restores the soil field from a save. */
  loadSoil(data: Uint8Array): void {
    this.soil.set(data.subarray(0, this.soil.length));
    this.soilActive = this.soil.some((v) => v > 0);
    this.soilVersion++;
  }

  get hasSoil(): boolean {
    return this.soilActive;
  }

  /** Recomputes the distance-to-water field after the ground changed. */
  refreshShore(): void {
    this.shoreDist = this.computeShoreDistance();
  }
}

function boxBlur(src: Float32Array, dst: Float32Array, res: number, r: number, horizontal: boolean): void {
  const w = 2 * r + 1;
  for (let line = 0; line < res; line++) {
    let acc = 0;
    const at = (k: number) => {
      const kk = k < 0 ? 0 : k >= res ? res - 1 : k;
      return horizontal ? src[line * res + kk] : src[kk * res + line];
    };
    for (let k = -r; k <= r; k++) acc += at(k);
    for (let k = 0; k < res; k++) {
      const idx = horizontal ? line * res + k : k * res + line;
      dst[idx] = acc / w;
      acc += at(k + r + 1) - at(k - r);
    }
  }
}
