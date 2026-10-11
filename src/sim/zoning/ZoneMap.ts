import { type OBB, type Projection, obbBounds, pointInOBB, projectOnPolyline } from '../../core/geom2d';
import { WATER_LEVEL, ZONE_CELL, ZONE_DEPTH, ZONE_RES } from '../constants';
import type { RoadNetwork, RoadSegment } from '../roads/RoadNetwork';
import { ROAD_TYPES } from '../roads/RoadTypes';
import { rasterizePolyline } from '../roads/rasterize';
import { Zone, ZONE_COUNT } from '../types';
import type { Rect, Terrain } from '../world/Terrain';

const GRID = { cell: ZONE_CELL, res: ZONE_RES, centered: true };

/**
 * Fine world-aligned zoning grid. Zones can only be painted on cells near
 * zonable roads; buildings record which cells they occupy.
 */
export class ZoneMap {
  readonly res = ZONE_RES;
  readonly cell = ZONE_CELL;
  readonly zone = new Uint8Array(ZONE_RES * ZONE_RES);
  /** 1 where a road surface covers the cell. */
  readonly roadCover = new Uint8Array(ZONE_RES * ZONE_RES);
  /** 1 where zoning is permitted. */
  readonly zonable = new Uint8Array(ZONE_RES * ZONE_RES);
  /** Building id occupying the cell, 0 if none. */
  readonly occupant = new Int32Array(ZONE_RES * ZONE_RES);
  /** Terrain-blocked cells (water, steep). */
  readonly blocked = new Uint8Array(ZONE_RES * ZONE_RES);
  /** Pending rectangles for the overlay renderer. */
  readonly dirtyRects: Rect[] = [];
  version = 0;

  private lists: Int32Array[] | null = null;
  private dist = new Float32Array(0);

  constructor(private terrain: Terrain) {
    for (let iz = 0; iz < ZONE_RES; iz++) {
      for (let ix = 0; ix < ZONE_RES; ix++) {
        const x = (ix + 0.5) * ZONE_CELL;
        const z = (iz + 0.5) * ZONE_CELL;
        const h = terrain.sampleBase(x, z);
        if (h < WATER_LEVEL + 0.6 || terrain.slopeAt(x, z) > 0.35) this.blocked[iz * ZONE_RES + ix] = 1;
      }
    }
  }

  /** Re-evaluates water and steep ground inside a rectangle (after terraforming). */
  refreshBlocked(terrain: Terrain, r: Rect): void {
    const ix0 = Math.max(0, Math.floor(r.minX / ZONE_CELL));
    const iz0 = Math.max(0, Math.floor(r.minZ / ZONE_CELL));
    const ix1 = Math.min(ZONE_RES - 1, Math.ceil(r.maxX / ZONE_CELL));
    const iz1 = Math.min(ZONE_RES - 1, Math.ceil(r.maxZ / ZONE_CELL));
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = (ix + 0.5) * ZONE_CELL;
        const z = (iz + 0.5) * ZONE_CELL;
        const h = terrain.sampleBase(x, z);
        this.blocked[iz * ZONE_RES + ix] = h < WATER_LEVEL + 0.6 || terrain.slopeAt(x, z) > 0.35 ? 1 : 0;
      }
    }
  }

  index(x: number, z: number): number {
    const ix = Math.floor(x / ZONE_CELL);
    const iz = Math.floor(z / ZONE_CELL);
    if (ix < 0 || iz < 0 || ix >= ZONE_RES || iz >= ZONE_RES) return -1;
    return iz * ZONE_RES + ix;
  }

  zoneAt(x: number, z: number): Zone {
    const i = this.index(x, z);
    return i < 0 ? Zone.None : (this.zone[i] as Zone);
  }

  private markDirty(r: Rect): void {
    this.dirtyRects.push(r);
    this.version++;
  }

  /** Recomputes road cover and zonable cells within a world rectangle. */
  rebuildRoadInfluence(net: RoadNetwork, r: Rect): void {
    const ix0 = Math.max(0, Math.floor(r.minX / ZONE_CELL));
    const iz0 = Math.max(0, Math.floor(r.minZ / ZONE_CELL));
    const ix1 = Math.min(ZONE_RES - 1, Math.ceil(r.maxX / ZONE_CELL));
    const iz1 = Math.min(ZONE_RES - 1, Math.ceil(r.maxZ / ZONE_CELL));
    const w = ix1 - ix0 + 1;
    const h = iz1 - iz0 + 1;
    if (w <= 0 || h <= 0) return;
    if (this.dist.length < w * h * 2) this.dist = new Float32Array(w * h * 2);
    // dist[k] = min distance to a zonable road edge; dist[w*h + k] = to a non-zonable road edge
    const dz = this.dist;
    dz.fill(1e9, 0, w * h * 2);
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) this.roadCover[iz * ZONE_RES + ix] = 0;
    }
    const clip = { ix0, iz0, ix1, iz1 };
    const reach = ZONE_DEPTH + 30;
    const segs = net.segmentsIn(r.minX - reach, r.minZ - reach, r.maxX + reach, r.maxZ + reach);
    for (const seg of segs) {
      const rt = ROAD_TYPES[seg.type];
      const hw = rt.halfWidth;
      const radius = hw + ZONE_DEPTH;
      const base = rt.zoning && !seg.elevated && !seg.ring ? 0 : w * h;
      rasterizePolyline(seg.poly, radius, GRID, clip, (ix, iz, d) => {
        const k = (iz - iz0) * w + (ix - ix0);
        const edge = d - hw;
        if (edge < dz[base + k]) dz[base + k] = edge;
        if (d < hw + 0.8) this.roadCover[iz * ZONE_RES + ix] = 1;
      });
    }
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = iz * ZONE_RES + ix;
        const k = (iz - iz0) * w + (ix - ix0);
        const ok =
          !this.roadCover[i] &&
          !this.blocked[i] &&
          dz[k] <= ZONE_DEPTH &&
          dz[k] > 0.5 &&
          dz[w * h + k] > 6 &&
          this.terrain.owned((ix + 0.5) * ZONE_CELL, (iz + 0.5) * ZONE_CELL);
        this.zonable[i] = ok ? 1 : 0;
        if (!ok && this.zone[i] !== Zone.None) {
          this.zone[i] = Zone.None;
          this.lists = null;
        }
      }
    }
    this.markDirty({ minX: ix0 * ZONE_CELL, minZ: iz0 * ZONE_CELL, maxX: (ix1 + 1) * ZONE_CELL, maxZ: (iz1 + 1) * ZONE_CELL });
  }

  /** Paints a disc of zone; returns number of cells changed. */
  paintCircle(x: number, z: number, radius: number, zone: Zone): number {
    const ix0 = Math.max(0, Math.floor((x - radius) / ZONE_CELL));
    const iz0 = Math.max(0, Math.floor((z - radius) / ZONE_CELL));
    const ix1 = Math.min(ZONE_RES - 1, Math.floor((x + radius) / ZONE_CELL));
    const iz1 = Math.min(ZONE_RES - 1, Math.floor((z + radius) / ZONE_CELL));
    const r2 = radius * radius;
    let changed = 0;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const cx = (ix + 0.5) * ZONE_CELL - x;
        const cz = (iz + 0.5) * ZONE_CELL - z;
        if (cx * cx + cz * cz > r2) continue;
        const i = iz * ZONE_RES + ix;
        if (!this.zonable[i] || this.zone[i] === zone) continue;
        this.zone[i] = zone;
        changed++;
      }
    }
    if (changed) {
      this.lists = null;
      this.markDirty({ minX: x - radius, minZ: z - radius, maxX: x + radius, maxZ: z + radius });
    }
    return changed;
  }

  /** Cells that a "fill street side" action would cover. */
  cellsAlongSide(seg: RoadSegment, side: number): number[] {
    const hw = ROAD_TYPES[seg.type].halfWidth;
    const reach = hw + ZONE_DEPTH;
    const out: number[] = [];
    const ix0 = Math.max(0, Math.floor((seg.minX - ZONE_DEPTH) / ZONE_CELL));
    const iz0 = Math.max(0, Math.floor((seg.minZ - ZONE_DEPTH) / ZONE_CELL));
    const ix1 = Math.min(ZONE_RES - 1, Math.ceil((seg.maxX + ZONE_DEPTH) / ZONE_CELL));
    const iz1 = Math.min(ZONE_RES - 1, Math.ceil((seg.maxZ + ZONE_DEPTH) / ZONE_CELL));
    const proj: Projection = { s: 0, dist: 0, x: 0, z: 0, side: 1 };
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const i = iz * ZONE_RES + ix;
        if (!this.zonable[i]) continue;
        projectOnPolyline(seg.poly, (ix + 0.5) * ZONE_CELL, (iz + 0.5) * ZONE_CELL, proj);
        if (proj.dist > reach || proj.side !== side) continue;
        if (proj.s < seg.trimA * 0.5 || proj.s > seg.length - seg.trimB * 0.5) continue;
        out.push(i);
      }
    }
    return out;
  }

  /** Zones every zonable cell along one side of a road segment. */
  fillSide(seg: RoadSegment, side: number, zone: Zone): number {
    let changed = 0;
    for (const i of this.cellsAlongSide(seg, side)) {
      if (this.zone[i] === zone) continue;
      this.zone[i] = zone;
      changed++;
    }
    if (changed) {
      this.lists = null;
      this.markDirty({ minX: seg.minX - ZONE_DEPTH, minZ: seg.minZ - ZONE_DEPTH, maxX: seg.maxX + ZONE_DEPTH, maxZ: seg.maxZ + ZONE_DEPTH });
    }
    return changed;
  }

  /** Cells (indices) whose centres fall inside the box. */
  cellsInOBB(o: OBB, margin = 0): number[] {
    const [minX, minZ, maxX, maxZ] = obbBounds(o);
    const out: number[] = [];
    const ix0 = Math.max(0, Math.floor(minX / ZONE_CELL));
    const iz0 = Math.max(0, Math.floor(minZ / ZONE_CELL));
    const ix1 = Math.min(ZONE_RES - 1, Math.floor(maxX / ZONE_CELL));
    const iz1 = Math.min(ZONE_RES - 1, Math.floor(maxZ / ZONE_CELL));
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        if (pointInOBB(o, (ix + 0.5) * ZONE_CELL, (iz + 0.5) * ZONE_CELL, margin)) out.push(iz * ZONE_RES + ix);
      }
    }
    return out;
  }

  setOccupant(o: OBB, id: number): void {
    for (const i of this.cellsInOBB(o, -0.5)) this.occupant[i] = id;
    const [minX, minZ, maxX, maxZ] = obbBounds(o);
    this.markDirty({ minX, minZ, maxX, maxZ });
  }

  clearOccupant(o: OBB, id: number): void {
    for (const i of this.cellsInOBB(o, 0.5)) if (this.occupant[i] === id) this.occupant[i] = 0;
    const [minX, minZ, maxX, maxZ] = obbBounds(o);
    this.markDirty({ minX, minZ, maxX, maxZ });
  }

  /** Cell indices currently painted with each zone (lazily rebuilt). */
  zoneLists(): Int32Array[] {
    if (this.lists) return this.lists;
    const counts = new Int32Array(ZONE_COUNT);
    for (let i = 0; i < this.zone.length; i++) counts[this.zone[i]]++;
    const lists: Int32Array[] = [];
    for (let z = 0; z < ZONE_COUNT; z++) lists.push(new Int32Array(z === 0 ? 0 : counts[z]));
    const fill = new Int32Array(ZONE_COUNT);
    for (let i = 0; i < this.zone.length; i++) {
      const z = this.zone[i];
      if (z) lists[z][fill[z]++] = i;
    }
    this.lists = lists;
    return lists;
  }

  countZoned(zone: Zone): number {
    return this.zoneLists()[zone].length;
  }

  countFree(zone: Zone): number {
    let n = 0;
    for (const i of this.zoneLists()[zone]) if (!this.occupant[i]) n++;
    return n;
  }

  /** Raw zone grid replaced wholesale (used by save/load). */
  loadZones(data: Uint8Array): void {
    this.zone.set(data);
    this.lists = null;
    this.markDirty({ minX: 0, minZ: 0, maxX: ZONE_RES * ZONE_CELL, maxZ: ZONE_RES * ZONE_CELL });
  }

  cellCenter(i: number): { x: number; z: number } {
    return { x: ((i % ZONE_RES) + 0.5) * ZONE_CELL, z: (Math.floor(i / ZONE_RES) + 0.5) * ZONE_CELL };
  }
}
