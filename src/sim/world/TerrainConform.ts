import { distanceToOBB, obbBounds } from '../../core/geom2d';
import { lerp, smoothstep } from '../../core/math';
import type { Buildings } from '../buildings/Buildings';
import { lotOBB } from '../buildings/Buildings';
import { HM_RES, HM_STEP, WATER_LEVEL } from '../constants';
import type { RoadNetwork } from '../roads/RoadNetwork';
import { ROAD_TYPES } from '../roads/RoadTypes';
import { rasterizePolyline } from '../roads/rasterize';
import type { Rect, Terrain } from './Terrain';

const ROAD_BLEND = 9;
const LOT_BLEND = 7;
let edgeBuf = new Float32Array(0);

/**
 * Recomputes final terrain heights inside `rect`: lots are levelled and the
 * ground is cut/filled to meet road surfaces with smooth embankments.
 */
export function conformTerrain(terrain: Terrain, net: RoadNetwork, buildings: Buildings, rect: Rect): void {
  const ix0 = Math.max(0, Math.floor(rect.minX / HM_STEP));
  const iz0 = Math.max(0, Math.floor(rect.minZ / HM_STEP));
  const ix1 = Math.min(HM_RES - 1, Math.ceil(rect.maxX / HM_STEP));
  const iz1 = Math.min(HM_RES - 1, Math.ceil(rect.maxZ / HM_STEP));
  const w = ix1 - ix0 + 1;
  const h = iz1 - iz0 + 1;
  if (w <= 0 || h <= 0) return;
  const H = terrain.height;
  const B = terrain.base;
  const R = terrain.road;
  const BR = terrain.bridge;
  for (let iz = iz0; iz <= iz1; iz++) {
    for (let ix = ix0; ix <= ix1; ix++) H[iz * HM_RES + ix] = B[iz * HM_RES + ix];
  }

  // Building lots: level the ground to the lot height.
  const pad = LOT_BLEND + 4;
  for (const b of buildings.queryRect(rect.minX - pad, rect.minZ - pad, rect.maxX + pad, rect.maxZ + pad)) {
    const o = lotOBB(b);
    const [minX, minZ, maxX, maxZ] = obbBounds(o);
    const bx0 = Math.max(ix0, Math.floor((minX - LOT_BLEND) / HM_STEP));
    const bz0 = Math.max(iz0, Math.floor((minZ - LOT_BLEND) / HM_STEP));
    const bx1 = Math.min(ix1, Math.ceil((maxX + LOT_BLEND) / HM_STEP));
    const bz1 = Math.min(iz1, Math.ceil((maxZ + LOT_BLEND) / HM_STEP));
    for (let iz = bz0; iz <= bz1; iz++) {
      for (let ix = bx0; ix <= bx1; ix++) {
        const d = distanceToOBB(o, ix * HM_STEP, iz * HM_STEP);
        if (d >= LOT_BLEND) continue;
        const wgt = 1 - smoothstep(0.5, LOT_BLEND, d);
        const i = iz * HM_RES + ix;
        H[i] = lerp(H[i], b.y - 0.06, wgt);
      }
    }
  }

  // Roads: distance to the nearest road edge per vertex.
  if (edgeBuf.length < w * h) edgeBuf = new Float32Array(w * h);
  edgeBuf.fill(1e9, 0, w * h);
  const reach = 40;
  const grid = { cell: HM_STEP, res: HM_RES, centered: false };
  const clip = { ix0, iz0, ix1, iz1 };
  for (const seg of net.segmentsIn(rect.minX - reach, rect.minZ - reach, rect.maxX + reach, rect.maxZ + reach)) {
    const hw = ROAD_TYPES[seg.type].halfWidth;
    rasterizePolyline(seg.poly, hw + ROAD_BLEND, grid, clip, (ix, iz, d) => {
      const k = (iz - iz0) * w + (ix - ix0);
      const e = d - hw;
      if (e < edgeBuf[k]) edgeBuf[k] = e;
    });
  }
  // Node caps/junction discs extend slightly past segment ends.
  for (const node of net.nodes.values()) {
    if (node.x < rect.minX - reach || node.x > rect.maxX + reach || node.z < rect.minZ - reach || node.z > rect.maxZ + reach) continue;
    let r = 0;
    for (const sid of node.segs) r = Math.max(r, ROAD_TYPES[net.getSegment(sid).type].halfWidth);
    if (!r) continue;
    const nx0 = Math.max(ix0, Math.floor((node.x - r - ROAD_BLEND) / HM_STEP));
    const nz0 = Math.max(iz0, Math.floor((node.z - r - ROAD_BLEND) / HM_STEP));
    const nx1 = Math.min(ix1, Math.ceil((node.x + r + ROAD_BLEND) / HM_STEP));
    const nz1 = Math.min(iz1, Math.ceil((node.z + r + ROAD_BLEND) / HM_STEP));
    for (let iz = nz0; iz <= nz1; iz++) {
      for (let ix = nx0; ix <= nx1; ix++) {
        const e = Math.hypot(ix * HM_STEP - node.x, iz * HM_STEP - node.z) - r;
        const k = (iz - iz0) * w + (ix - ix0);
        if (e < edgeBuf[k]) edgeBuf[k] = e;
      }
    }
  }
  for (let iz = iz0; iz <= iz1; iz++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      const e = edgeBuf[(iz - iz0) * w + (ix - ix0)];
      if (e >= ROAD_BLEND) continue;
      const i = iz * HM_RES + ix;
      const wgt = 1 - smoothstep(0.6, ROAD_BLEND, e);
      const deck = BR[i] > R[i];
      // Bridges span open water and steep drops on piers instead of fill.
      if (deck && (B[i] < WATER_LEVEL + 0.6 || BR[i] - B[i] > 3.5)) continue;
      H[i] = lerp(H[i], Math.max(R[i], BR[i]) - 0.22, wgt);
    }
  }
  terrain.markDirty({ minX: ix0 * HM_STEP, minZ: iz0 * HM_STEP, maxX: ix1 * HM_STEP, maxZ: iz1 * HM_STEP });
}
