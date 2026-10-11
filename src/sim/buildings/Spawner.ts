import { type OBB, type PolyPoint, obbBounds, obbIntersects, pointAt, projectOnPolyline } from '../../core/geom2d';
import { clamp, lerp } from '../../core/math';
import type { Rng } from '../../core/rng';
import { ZONE_DEPTH } from '../constants';
import type { RoadNetwork, RoadSegment } from '../roads/RoadNetwork';
import { ROAD_TYPES } from '../roads/RoadTypes';
import { Zone } from '../types';
import type { Terrain } from '../world/Terrain';
import type { ZoneMap } from '../zoning/ZoneMap';
import { type Archetype, archetypesFor, capacityFor, ARCHETYPE_BY_ID } from './Archetypes';
import { type Building, type Buildings, lotOBB, newBuilding } from './Buildings';

export interface LotFrame {
  seg: RoadSegment;
  s: number;
  side: number;
  /** Lot OBB. */
  obb: OBB;
  /** Ground level of the lot (sidewalk height). */
  y: number;
}

/** Computes the lot box for a frontage of width `w` and depth `d` centred at arc length s. */
export function lotFrame(terrain: Terrain, seg: RoadSegment, s: number, side: number, w: number, d: number, setback = 0.6): LotFrame {
  const p: PolyPoint = { x: 0, z: 0, tx: 0, tz: 0, i: 0 };
  pointAt(seg.poly, s, p);
  const hw = ROAD_TYPES[seg.type].halfWidth;
  // Right normal (-tz, tx); left normal (tz, -tx).
  const nx = side > 0 ? -p.tz : p.tz;
  const nz = side > 0 ? p.tx : -p.tx;
  const off = hw + setback + d / 2;
  const angle = side > 0 ? Math.atan2(p.tz, p.tx) : Math.atan2(p.tz, p.tx) + Math.PI;
  const fx = p.x + nx * (hw + setback);
  const fz = p.z + nz * (hw + setback);
  return {
    seg,
    s,
    side,
    obb: { cx: p.x + nx * off, cz: p.z + nz * off, angle, hw: w / 2, hd: d / 2 },
    y: terrain.roadHeightAt(fx, fz) + 0.2,
  };
}

export interface LotCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Grows zoned buildings on suitable lots. Lots are found by sampling zoned
 * cells, snapping to the nearest road frontage and packing next to existing
 * neighbours so streets fill in continuous rows.
 */
export class Spawner {
  /** Cap on floors for new buildings (high-rise ban). */
  /** 0–1: how much visitors frequent a point (landmarks, airport…); set by the city. */
  tourismAt: (x: number, z: number) => number = () => 0;
  /** Highest number of floors allowed for a new building at a point (policies). */
  maxFloorsAt: (x: number, z: number) => number = () => Infinity;

  constructor(
    private net: RoadNetwork,
    private terrain: Terrain,
    private zones: ZoneMap,
    private buildings: Buildings,
    private lvAt: (x: number, z: number) => number,
  ) {}

  /** Validates a zoned lot. */
  checkLot(f: LotFrame, zone: Zone): LotCheck {
    const o = f.obb;
    const [minX, minZ, maxX, maxZ] = obbBounds(o);
    if (!this.terrain.buildable(minX, minZ, 1) || !this.terrain.buildable(maxX, maxZ, 1) || !this.terrain.owned(minX, maxZ) || !this.terrain.owned(maxX, minZ)) return { ok: false, reason: 'bounds' };
    const cells = this.zones.cellsInOBB(o, -1.2);
    if (cells.length < 4) return { ok: false, reason: 'small' };
    let match = 0;
    for (const i of cells) {
      if (this.zones.occupant[i] || this.zones.roadCover[i] || this.zones.blocked[i]) return { ok: false, reason: 'blocked' };
      if (this.zones.zone[i] === zone) match++;
    }
    if (match < cells.length * 0.9) return { ok: false, reason: 'zone' };
    for (const b of this.buildings.queryRect(minX, minZ, maxX, maxZ)) {
      if (obbIntersects(o, lotOBB(b), -0.3)) return { ok: false, reason: 'overlap' };
    }
    if (!this.clearOfRoads(o)) return { ok: false, reason: 'road' };
    // Terrain must be reasonably flat.
    const c = [o.cx, o.cz];
    const ca = Math.cos(o.angle), sa = Math.sin(o.angle);
    let lo = Infinity, hi = -Infinity;
    for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
      const x = c[0] + lx * o.hw * ca - lz * o.hd * sa;
      const z = c[1] + lx * o.hw * sa + lz * o.hd * ca;
      const h = this.terrain.sampleBase(x, z);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    if (hi - lo > 6) return { ok: false, reason: 'slope' };
    if (Math.abs(f.y - (hi + lo) / 2) > 5) return { ok: false, reason: 'slope' };
    return { ok: true };
  }

  /** True when no road surface intrudes into the box. */
  clearOfRoads(o: OBB, margin = 0.3): boolean {
    const [minX, minZ, maxX, maxZ] = obbBounds(o);
    const proj = { s: 0, dist: 0, x: 0, z: 0, side: 1 };
    const ca = Math.cos(o.angle), sa = Math.sin(o.angle);
    const samples: [number, number][] = [];
    for (let u = -1; u <= 1.001; u += 0.5) {
      for (let v = -1; v <= 1.001; v += 0.5) {
        samples.push([o.cx + u * o.hw * ca - v * o.hd * sa, o.cz + u * o.hw * sa + v * o.hd * ca]);
      }
    }
    for (const seg of this.net.segmentsIn(minX - 2, minZ - 2, maxX + 2, maxZ + 2)) {
      const hw = ROAD_TYPES[seg.type].halfWidth - margin;
      for (const [x, z] of samples) {
        projectOnPolyline(seg.poly, x, z, proj);
        if (proj.dist < hw) return false;
      }
    }
    return true;
  }

  private chooseLevel(lv: number, rng: Rng): number {
    if (lv > 0.78 && rng.chance(0.5)) return 3;
    if (lv > 0.55 && rng.chance(0.6)) return 2;
    return 1;
  }

  /** Attempts to create a new building for `zone`. Returns it (not yet added) or null. */
  trySpawn(zone: Zone, rng: Rng, attempts = 8, canSupply?: (seg: RoadSegment) => boolean): Building | null {
    const list = this.zones.zoneLists()[zone];
    if (!list || list.length === 0) return null;
    for (let a = 0; a < attempts; a++) {
      const cell = list[Math.floor(rng.next() * list.length)];
      if (this.zones.occupant[cell]) continue;
      const c = this.zones.cellCenter(cell);
      const hit = this.net.nearestSegment(c.x, c.z, ZONE_DEPTH + 20, (s) => ROAD_TYPES[s.type].zoning && !s.elevated && !s.ring);
      if (!hit) continue;
      const seg = hit.seg;
      if (canSupply && !canSupply(seg)) continue;
      const lv = this.lvAt(c.x, c.z);
      const level = this.chooseLevel(lv, rng);
      let arches = archetypesFor(zone, level);
      if (!arches.length) arches = archetypesFor(zone, 1);
      let arch = rng.weighted(arches, (x) => x.weight);
      // Visitors need beds: commercial land near attractions sometimes becomes a hotel.
      if (zone === Zone.Commercial && level >= 2 && rng.chance(0.45 * this.tourismAt(c.x, c.z))) arch = ARCHETYPE_BY_ID.get('hotel') ?? arch;
      if (!arch) continue;
      const b = this.fit(arch, seg, hit.proj.s, hit.proj.side, zone, level, lv, rng);
      if (b) return b;
    }
    return null;
  }

  private fit(arch: Archetype, seg: RoadSegment, s0: number, side: number, zone: Zone, level: number, lv: number, rng: Rng): Building | null {
    const wMax = arch.frontage[1];
    const wMin = arch.frontage[0];
    const w = Math.round(rng.range(wMin, wMax));
    for (let dTry = arch.depth[1]; dTry >= arch.depth[0]; dTry -= 4) {
      const d = Math.min(dTry, ZONE_DEPTH - 1);
      for (const ww of [w, Math.max(wMin, w - 4), wMin]) {
        const s = this.packPosition(seg, side, s0, ww);
        if (s === null) continue;
        const f = lotFrame(this.terrain, seg, s, side, ww, d);
        const chk = this.checkLot(f, zone);
        if (!chk.ok) continue;
        const floorsT = arch.style === 'tower' || arch.style === 'officeTower' ? clamp(lv * 1.15 + rng.range(-0.2, 0.2), 0, 1) : rng.next();
        const floors = Math.min(this.maxFloorsAt(f.obb.cx, f.obb.cz), Math.round(lerp(arch.floors[0], arch.floors[1], floorsT)));
        const cap = capacityFor(arch.style, ww, d, floors, level);
        return newBuilding({
          kind: 'zoned',
          typeId: arch.id,
          style: arch.style,
          zone,
          cx: f.obb.cx,
          cz: f.obb.cz,
          angle: f.obb.angle,
          hw: f.obb.hw,
          hd: f.obb.hd,
          y: f.y,
          seed: Math.floor(rng.next() * 0x7fffffff),
          floors,
          level,
          buildDays: 2 + Math.min(14, floors * 0.6 + (ww * d) / 600),
          segId: seg.id,
          segS: s,
          side,
          hhCap: cap.households,
          jobs: cap.jobs,
          landValue: lv,
        });
      }
    }
    return null;
  }

  /**
   * Moves a lot of width w (centred at s0) so it sits flush against the
   * nearest neighbour on the same side of the street, if one is close.
   */
  packPosition(seg: RoadSegment, side: number, s0: number, w: number): number | null {
    const half = w / 2;
    const minS = seg.trimA + half + 1;
    const maxS = seg.length - seg.trimB - half - 1;
    if (maxS < minS) return null;
    let s = clamp(s0, minS, maxS);
    const intervals: [number, number][] = [];
    for (const b of this.buildings.onSegment(seg.id)) {
      if (b.side !== side) continue;
      intervals.push([b.segS - b.hw, b.segS + b.hw]);
    }
    if (!intervals.length) return s;
    intervals.sort((p, q) => p[0] - q[0]);
    const gap = 0.6;
    // Snap to the closest neighbour edge if within one lot width.
    let best: number | null = null;
    let bestD = Infinity;
    for (const [a, b] of intervals) {
      for (const cand of [b + gap + half, a - gap - half]) {
        if (cand < minS || cand > maxS) continue;
        const ok = intervals.every(([p, q]) => cand + half <= p + 0.05 || cand - half >= q - 0.05);
        if (!ok) continue;
        const dd = Math.abs(cand - s0);
        if (dd < bestD) {
          bestD = dd;
          best = cand;
        }
      }
    }
    if (best !== null && bestD < w * 1.5) return best;
    const free = intervals.every(([p, q]) => s + half <= p || s - half >= q);
    if (free) return s;
    return best;
  }
}
