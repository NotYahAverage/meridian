import { base64ToBytes, bytesToBase64, rleDecode, rleEncode } from '../../core/encoding';
import { distanceToOBB } from '../../core/geom2d';
import { clamp, lerp, smoothstep } from '../../core/math';
import { lotOBB } from '../buildings/Buildings';
import type { City } from '../City';
import { HM_RES, HM_STEP, WATER_LEVEL } from '../constants';
import { ROAD_TYPES } from '../roads/RoadTypes';
import { rasterizePolyline } from '../roads/rasterize';
import type { Rect, Terrain } from './Terrain';
import { conformTerrain } from './TerrainConform';

export type TerraformMode = 'raise' | 'lower' | 'level' | 'smooth';

/** Price of moving one cubic metre of earth. */
export const EARTH_COST = 0.8;
export const TERRAIN_MIN = -24;
export const TERRAIN_MAX = 180;
/** Ground within this distance of a road edge or lot stays put. */
const ROAD_LOCK = 12;
const LOT_LOCK = 8;
/** Bridges need their approaches (and the water distance under them) left alone. */
const BRIDGE_LOCK = 72;
/** Road-surface heights are kept unchanged within this distance of existing roads. */
const ROAD_FREEZE = 30;
/** Map border kept fixed so the edge meets the surrounding landscape. */
const BORDER = 3;
/** Blur radius of the road field (two box passes of 3 cells). */
const BLUR = 6;

export interface TerraformStroke {
  mode: TerraformMode;
  x: number;
  z: number;
  radius: number;
  /** Metres per application at the brush centre. */
  strength: number;
  /** Target height for levelling. */
  target?: number;
}

export interface TerraformResult {
  ok: boolean;
  /** Cubic metres moved. */
  volume: number;
  cost: number;
  /** Fraction of the brush area that is locked by roads or buildings. */
  locked: number;
  error?: string;
}

interface Window {
  ix0: number;
  iz0: number;
  ix1: number;
  iz1: number;
  w: number;
  h: number;
}

function windowFor(x0: number, z0: number, x1: number, z1: number, pad = 0): Window {
  const ix0 = clamp(Math.floor(x0 / HM_STEP) - pad, 0, HM_RES - 1);
  const iz0 = clamp(Math.floor(z0 / HM_STEP) - pad, 0, HM_RES - 1);
  const ix1 = clamp(Math.ceil(x1 / HM_STEP) + pad, 0, HM_RES - 1);
  const iz1 = clamp(Math.ceil(z1 / HM_STEP) + pad, 0, HM_RES - 1);
  return { ix0, iz0, ix1, iz1, w: ix1 - ix0 + 1, h: iz1 - iz0 + 1 };
}

/**
 * Per-vertex distance (m) from the nearest road edge in a window, with
 * bridges reported closer so their wider lock applies. Junction discs count.
 */
function roadEdgeDistance(city: City, win: Window, reach: number, bridgeExtra: number): Float32Array {
  const out = new Float32Array(win.w * win.h).fill(1e9);
  const grid = { cell: HM_STEP, res: HM_RES, centered: false };
  const clip = { ix0: win.ix0, iz0: win.iz0, ix1: win.ix1, iz1: win.iz1 };
  const minX = win.ix0 * HM_STEP - reach - bridgeExtra, maxX = win.ix1 * HM_STEP + reach + bridgeExtra;
  const minZ = win.iz0 * HM_STEP - reach - bridgeExtra, maxZ = win.iz1 * HM_STEP + reach + bridgeExtra;
  for (const seg of city.roads.segmentsIn(minX, minZ, maxX, maxZ)) {
    const hw = ROAD_TYPES[seg.type].halfWidth;
    const extra = seg.elevated ? bridgeExtra : 0;
    rasterizePolyline(seg.poly, hw + reach + extra, grid, clip, (ix, iz, d) => {
      const k = (iz - win.iz0) * win.w + (ix - win.ix0);
      const e = d - hw - extra;
      if (e < out[k]) out[k] = e;
    });
  }
  for (const node of city.roads.nodes.values()) {
    if (node.x < minX || node.x > maxX || node.z < minZ || node.z > maxZ) continue;
    let r = 0;
    for (const sid of node.segs) r = Math.max(r, ROAD_TYPES[city.roads.getSegment(sid).type].halfWidth);
    if (!r) continue;
    const nx0 = Math.max(win.ix0, Math.floor((node.x - r - reach) / HM_STEP));
    const nz0 = Math.max(win.iz0, Math.floor((node.z - r - reach) / HM_STEP));
    const nx1 = Math.min(win.ix1, Math.ceil((node.x + r + reach) / HM_STEP));
    const nz1 = Math.min(win.iz1, Math.ceil((node.z + r + reach) / HM_STEP));
    for (let iz = nz0; iz <= nz1; iz++) {
      for (let ix = nx0; ix <= nx1; ix++) {
        const e = Math.hypot(ix * HM_STEP - node.x, iz * HM_STEP - node.z) - r;
        const k = (iz - win.iz0) * win.w + (ix - win.ix0);
        if (e < out[k]) out[k] = e;
      }
    }
  }
  return out;
}

/** 0 where the ground is locked (roads, lots, map border), 1 where it is free. */
function freedom(city: City, win: Window): Float32Array {
  const free = new Float32Array(win.w * win.h).fill(1);
  const roadD = roadEdgeDistance(city, win, ROAD_LOCK, BRIDGE_LOCK - ROAD_LOCK);
  for (let k = 0; k < free.length; k++) free[k] = smoothstep(ROAD_LOCK * 0.55, ROAD_LOCK, roadD[k]);
  const x0 = win.ix0 * HM_STEP, z0 = win.iz0 * HM_STEP, x1 = win.ix1 * HM_STEP, z1 = win.iz1 * HM_STEP;
  for (const b of city.buildings.queryRect(x0 - LOT_LOCK - 40, z0 - LOT_LOCK - 40, x1 + LOT_LOCK + 40, z1 + LOT_LOCK + 40)) {
    const o = lotOBB(b);
    for (let iz = win.iz0; iz <= win.iz1; iz++) {
      for (let ix = win.ix0; ix <= win.ix1; ix++) {
        const k = (iz - win.iz0) * win.w + (ix - win.ix0);
        if (free[k] === 0) continue;
        const d = distanceToOBB(o, ix * HM_STEP, iz * HM_STEP);
        if (d < LOT_LOCK) free[k] *= smoothstep(LOT_LOCK * 0.4, LOT_LOCK, d);
      }
    }
  }
  for (let iz = win.iz0; iz <= win.iz1; iz++) {
    for (let ix = win.ix0; ix <= win.ix1; ix++) {
      if (ix < BORDER || iz < BORDER || ix > HM_RES - 1 - BORDER || iz > HM_RES - 1 - BORDER) free[(iz - win.iz0) * win.w + (ix - win.ix0)] = 0;
    }
  }
  return free;
}

/** Quantises edits to centimetres so saved games reload exactly. */
const q = (natural: number, v: number) => natural + Math.round((v - natural) * 100) / 100;

/**
 * Applies one dab of a terraforming brush (or, with `apply` false, prices it).
 * Ground under and right beside roads and buildings never moves.
 */
export function terraform(city: City, s: TerraformStroke, apply = true): TerraformResult {
  const t = city.terrain;
  const win = windowFor(s.x - s.radius, s.z - s.radius, s.x + s.radius, s.z + s.radius);
  if (win.w <= 0 || win.h <= 0) return { ok: false, volume: 0, cost: 0, locked: 1, error: 'Outside the map' };
  const free = freedom(city, win);
  const B = t.base;
  const delta = new Float32Array(win.w * win.h);
  let volume = 0, inside = 0, lockedArea = 0, unowned = 0;
  for (let iz = win.iz0; iz <= win.iz1; iz++) {
    for (let ix = win.ix0; ix <= win.ix1; ix++) {
      const dist = Math.hypot(ix * HM_STEP - s.x, iz * HM_STEP - s.z);
      if (dist >= s.radius) continue;
      inside++;
      const k = (iz - win.iz0) * win.w + (ix - win.ix0);
      // Ground outside the city's land can't be reshaped.
      const own = t.owned(ix * HM_STEP, iz * HM_STEP) ? 1 : 0;
      if (!own) unowned++;
      lockedArea += 1 - free[k] * own;
      const wgt = (1 - smoothstep(s.radius * 0.45, s.radius, dist)) * free[k] * own;
      if (wgt <= 0.001) continue;
      const i = iz * HM_RES + ix;
      const hgt = B[i];
      let d = 0;
      switch (s.mode) {
        case 'raise':
          d = s.strength * wgt;
          break;
        case 'lower':
          d = -s.strength * wgt;
          break;
        case 'level':
          d = clamp((s.target ?? hgt) - hgt, -s.strength * 2.5, s.strength * 2.5) * wgt;
          break;
        case 'smooth': {
          let sum = 0, n = 0;
          for (let dz = -2; dz <= 2; dz++) {
            for (let dx = -2; dx <= 2; dx++) {
              const jx = ix + dx, jz = iz + dz;
              if (jx < 0 || jz < 0 || jx >= HM_RES || jz >= HM_RES) continue;
              sum += B[jz * HM_RES + jx];
              n++;
            }
          }
          d = (sum / n - hgt) * 0.45 * wgt;
          break;
        }
      }
      const next = clamp(hgt + d, TERRAIN_MIN, TERRAIN_MAX);
      delta[k] = next - hgt;
      volume += Math.abs(delta[k]) * HM_STEP * HM_STEP;
    }
  }
  const cost = Math.round(volume * EARTH_COST);
  const locked = inside ? lockedArea / inside : 1;
  if (volume < 0.5) return { ok: false, volume: 0, cost: 0, locked, error: unowned > inside * 0.5 ? 'You don\'t own this land yet' : locked > 0.95 ? 'Roads and buildings hold this ground in place' : undefined };
  if (!apply) return { ok: true, volume, cost, locked };
  if (!city.economy.spend(cost, 'Construction')) return { ok: false, volume, cost, locked, error: 'Not enough money' };
  city.achievements.counters.earthMoved += volume;
  t.beginEdits();
  const N = t.natural!;
  for (let iz = win.iz0; iz <= win.iz1; iz++) {
    for (let ix = win.ix0; ix <= win.ix1; ix++) {
      const k = (iz - win.iz0) * win.w + (ix - win.ix0);
      if (!delta[k]) continue;
      const i = iz * HM_RES + ix;
      B[i] = q(N[i], B[i] + delta[k]);
      t.disturb(i, Math.min(1, 0.35 + Math.abs(delta[k]) * 2.5));
    }
  }
  t.soilVersion++;
  settleTerrain(city, { minX: win.ix0 * HM_STEP, minZ: win.iz0 * HM_STEP, maxX: win.ix1 * HM_STEP, maxZ: win.iz1 * HM_STEP });
  return { ok: true, volume, cost, locked };
}

/** Separable box blur on a window, clamping reads at the map edge like the global field. */
function blurWindow(src: Float32Array, win: Window, r: number): void {
  const tmp = new Float32Array(src.length);
  const w = 2 * r + 1;
  const pass = (from: Float32Array, to: Float32Array, horizontal: boolean) => {
    const lines = horizontal ? win.h : win.w;
    const len = horizontal ? win.w : win.h;
    for (let line = 0; line < lines; line++) {
      const at = (k: number) => {
        // Map-edge clamping (window edges inside the map have enough padding to be exact).
        const kk = k < 0 ? 0 : k >= len ? len - 1 : k;
        return horizontal ? from[line * win.w + kk] : from[kk * win.w + line];
      };
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += at(k);
      for (let k = 0; k < len; k++) {
        const idx = horizontal ? line * win.w + k : k * win.w + line;
        to[idx] = acc / w;
        acc += at(k + r + 1) - at(k - r);
      }
    }
  };
  for (let p = 0; p < 2; p++) {
    pass(src, tmp, true);
    pass(tmp, src, false);
  }
}

/**
 * Rebuilds everything that depends on ground height inside `rect` after an
 * edit: the road-surface field (frozen near existing roads), final heights,
 * shoreline distance, buildable cells, trees and the water.
 */
export function settleTerrain(city: City, rect: Rect): void {
  const t = city.terrain;
  t.beginEdits();
  // Road-surface field: blur base heights over a padded window.
  const core = windowFor(rect.minX, rect.minZ, rect.maxX, rect.maxZ, BLUR);
  const pad = windowFor(rect.minX, rect.minZ, rect.maxX, rect.maxZ, BLUR * 2);
  const buf = new Float32Array(pad.w * pad.h);
  for (let iz = pad.iz0; iz <= pad.iz1; iz++) {
    for (let ix = pad.ix0; ix <= pad.ix1; ix++) buf[(iz - pad.iz0) * pad.w + (ix - pad.ix0)] = t.base[iz * HM_RES + ix];
  }
  blurWindow(buf, pad, 3);
  const keep = roadEdgeDistance(city, core, ROAD_FREEZE, 0);
  const NR = t.naturalRoad!;
  for (let iz = core.iz0; iz <= core.iz1; iz++) {
    for (let ix = core.ix0; ix <= core.ix1; ix++) {
      const i = iz * HM_RES + ix;
      const fresh = Math.max(buf[(iz - pad.iz0) * pad.w + (ix - pad.ix0)], WATER_LEVEL + 1.2);
      const e = keep[(iz - core.iz0) * core.w + (ix - core.ix0)];
      const k = 1 - smoothstep(ROAD_FREEZE * 0.4, ROAD_FREEZE, e);
      t.road[i] = q(NR[i], lerp(fresh, t.road[i], k));
    }
  }
  const area: Rect = { minX: core.ix0 * HM_STEP, minZ: core.iz0 * HM_STEP, maxX: core.ix1 * HM_STEP, maxZ: core.iz1 * HM_STEP };
  t.refreshShore();
  conformTerrain(t, city.roads, city.buildings, area);
  city.zones.refreshBlocked(t, area);
  city.zones.rebuildRoadInfluence(city.roads, area);
  settleNature(city, t, area);
  city.landValue.invalidateScenic();
  t.waterVersion++;
}

/** Depth a harbour basin is dredged to below the water surface. */
export const BERTH_DEPTH = 7;

/**
 * Dredges a basin off a new quay so ships can come alongside: only ground
 * that is already under water is deepened, fading out at the sides and the
 * seaward end. The lot's back edge is the quay.
 */
export function dredgeBerth(city: City, o: { cx: number; cz: number; angle: number; hw: number; hd: number }): void {
  const t = city.terrain;
  const ca = Math.cos(o.angle), sa = Math.sin(o.angle);
  const along = o.hw + 14, near = o.hd + 3, far = o.hd + 110;
  const corners = [[-along, near], [along, near], [-along, far], [along, far]].map(([u, v]) => [o.cx + u * ca - v * sa, o.cz + u * sa + v * ca]);
  const xs = corners.map((p) => p[0]), zs = corners.map((p) => p[1]);
  const win = windowFor(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), 1);
  if (win.w <= 0 || win.h <= 0) return;
  t.beginEdits();
  const B = t.base, N = t.natural!;
  const floor = WATER_LEVEL - BERTH_DEPTH;
  let changed = false;
  for (let iz = win.iz0; iz <= win.iz1; iz++) {
    for (let ix = win.ix0; ix <= win.ix1; ix++) {
      const dx = ix * HM_STEP - o.cx, dz = iz * HM_STEP - o.cz;
      const u = dx * ca + dz * sa, v = -dx * sa + dz * ca;
      if (Math.abs(u) > along || v < near || v > far) continue;
      const i = iz * HM_RES + ix;
      if (B[i] >= WATER_LEVEL || B[i] <= floor) continue;
      const f = smoothstep(along, along - 14, Math.abs(u)) * smoothstep(far, far - 30, v) * smoothstep(near, near + 6, v);
      const next = lerp(B[i], floor, f);
      if (next < B[i] - 0.01) {
        B[i] = q(N[i], next);
        changed = true;
      }
    }
  }
  if (changed) settleTerrain(city, { minX: win.ix0 * HM_STEP, minZ: win.iz0 * HM_STEP, maxX: win.ix1 * HM_STEP, maxZ: win.iz1 * HM_STEP });
}

/** Trees on reshaped ground are cleared; the rest re-seat at the new height. */
function settleNature(city: City, t: Terrain, r: Rect): void {
  const N = t.natural;
  if (!N) return;
  city.nature.clearWhere(r, (x, z) => {
    const ix = Math.round(x / HM_STEP), iz = Math.round(z / HM_STEP);
    const i = clamp(iz, 0, HM_RES - 1) * HM_RES + clamp(ix, 0, HM_RES - 1);
    return Math.abs(t.base[i] - N[i]) > 0.5 || t.sampleBase(x, z) < WATER_LEVEL + 1.2;
  });
}

// ── Save ───────────────────────────────────────────────────────────────────

/** Runs of edited heightmap vertices: [start index, base64 Int16 centimetre deltas]. */
export type EditRuns = [number, string][];

export interface TerrainEdits {
  base: EditRuns;
  road: EditRuns;
  /** Run-length encoded bare-soil field, while any earth is still regrowing. */
  soil?: string;
}

function* encodeRuns(cur: Float32Array, natural: Float32Array, perStep: number): Generator<void, EditRuns, void> {
  const runs: EditRuns = [];
  let i = 0;
  const n = cur.length;
  let next = perStep;
  while (i < n) {
    if (i >= next) {
      next = i + perStep;
      yield;
    }
    if (Math.round((cur[i] - natural[i]) * 100) === 0) {
      i++;
      continue;
    }
    const start = i;
    const vals: number[] = [];
    // Allow short zero gaps inside a run to keep the list compact.
    let gap = 0;
    while (i < n && gap < 8) {
      const v = Math.round((cur[i] - natural[i]) * 100);
      vals.push(v);
      gap = v === 0 ? gap + 1 : 0;
      i++;
    }
    vals.length -= gap;
    const arr = Int16Array.from(vals);
    runs.push([start, bytesToBase64(new Uint8Array(arr.buffer))]);
  }
  return runs;
}

function decodeRuns(runs: EditRuns, target: Float32Array, natural: Float32Array): void {
  for (const [start, b64] of runs) {
    const bytes = base64ToBytes(b64);
    const arr = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
    for (let k = 0; k < arr.length; k++) {
      const i = start + k;
      if (i < target.length) target[i] = natural[i] + arr[k] / 100;
    }
  }
}

export function serializeTerrainEdits(t: Terrain): TerrainEdits | undefined {
  const it = serializeTerrainEditsSteps(t, Infinity);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** The same, yielding about every `perStep` heightmap cells (saving a big world spread over frames). */
export function* serializeTerrainEditsSteps(t: Terrain, perStep: number): Generator<void, TerrainEdits | undefined, void> {
  if (!t.natural || !t.naturalRoad) return undefined;
  const base = yield* encodeRuns(t.base, t.natural, perStep);
  const road = yield* encodeRuns(t.road, t.naturalRoad, perStep);
  if (!base.length && !road.length) return undefined;
  return t.hasSoil ? { base, road, soil: rleEncode(t.soil) } : { base, road };
}

/** Restores saved edits onto a freshly generated city (before roads and buildings load). */
export function loadTerrainEdits(city: City, edits: TerrainEdits | undefined): void {
  if (!edits || (!edits.base.length && !edits.road.length)) return;
  const t = city.terrain;
  t.beginEdits();
  decodeRuns(edits.base, t.base, t.natural!);
  decodeRuns(edits.road, t.road, t.naturalRoad!);
  if (edits.soil) t.loadSoil(rleDecode(edits.soil, t.soil.length));
  t.height.set(t.base);
  t.refreshShore();
  const all: Rect = { minX: 0, minZ: 0, maxX: HM_RES * HM_STEP, maxZ: HM_RES * HM_STEP };
  city.zones.refreshBlocked(t, all);
  settleNature(city, t, all);
  city.landValue.invalidateScenic();
  t.markDirty(all);
  t.waterVersion++;
}

