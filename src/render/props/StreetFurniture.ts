import { type PolyPoint, pointAt } from '../../core/geom2d';
import type { Building } from '../../sim/buildings/Buildings';
import type { City } from '../../sim/City';
import type { RoadSegment } from '../../sim/roads/RoadNetwork';
import { ROAD_TYPES } from '../../sim/roads/RoadTypes';
import { SERVICE_BY_ID } from '../../sim/services/ServiceTypes';
import { BuildingState, Zone, zoneBase } from '../../sim/types';
import { CURB_H, ROAD_LIFT } from '../roads/RoadMeshBuilder';

export enum Furniture {
  Bench = 0,
  Bin = 1,
  Planter = 2,
}

export interface FurnitureItem {
  kind: Furniture;
  x: number;
  y: number;
  z: number;
  rot: number;
}

/** What a stretch of sidewalk is in front of, and how it's furnished. */
type Frontage = 'shops' | 'flats' | 'offices' | 'park';

/** Spacing and the repeating sequence of pieces for each kind of frontage. */
const PLAN: Record<Frontage, { every: number; seq: Furniture[] }> = {
  // Shopping streets: benches with a bin beside them, planters between.
  shops: { every: 11, seq: [Furniture.Bench, Furniture.Bin, Furniture.Planter, Furniture.Planter, Furniture.Bench, Furniture.Planter] },
  flats: { every: 32, seq: [Furniture.Bin, Furniture.Bench] },
  offices: { every: 15, seq: [Furniture.Planter, Furniture.Planter, Furniture.Bin] },
  park: { every: 17, seq: [Furniture.Bench, Furniture.Bench, Furniture.Bin] },
};

function frontageOf(b: Building): Frontage | null {
  if (b.state !== BuildingState.Active && b.state !== BuildingState.Abandoned) return null;
  if (b.kind === 'zoned') {
    const z = zoneBase(b.zone);
    if (z === Zone.Commercial) return 'shops';
    if (z === Zone.Office) return 'offices';
    // Apartment blocks; houses keep their verges clear.
    if (z === Zone.ResHigh || (z === Zone.ResMed && b.floors >= 4)) return 'flats';
    return null;
  }
  const st = SERVICE_BY_ID.get(b.typeId);
  return st?.kind === 'park' || st?.kind === 'landmark' ? 'park' : null;
}

/**
 * Benches, bins and planters along a road's sidewalks, to suit what's beside them:
 * most along shops, a few by apartment blocks, offices and parks, none by houses or
 * industry. They stand in the strip by the kerb, clear of lamps, street trees, crossings,
 * junction corners and bus stops.
 */
export function furnitureFor(city: City, seg: RoadSegment, beside: Building[], out: FurnitureItem[]): void {
  const rt = ROAD_TYPES[seg.type];
  if (rt.sidewalk < 2.4 || rt.freeway || seg.elevated || seg.raised || seg.ring) return;
  const s0 = seg.trimA, s1 = seg.length - seg.trimB;
  const lo = s0 + 7.5, hi = s1 - 7.5;
  if (hi - lo < 6) return;
  // Kept clear: street lamps (as the road builder places them), avenue trees, and bus stops.
  const clear: { s: number; side: number; r: number }[] = [];
  let k = 0;
  for (let v = 10; v < s1 - s0 - 4; v += 34, k++) {
    if (rt.lamps === 'one') clear.push({ s: s0 + v, side: k % 2 === 0 ? 1 : -1, r: 2.2 });
    else if (rt.lamps === 'both') clear.push({ s: s0 + v, side: 0, r: 2.2 });
  }
  if (rt.id === 'avenue' || rt.id === 'boulevard') for (let v = 27; v < s1 - s0 - 6; v += 17) clear.push({ s: s0 + v, side: 0, r: 2.0 });
  for (const st of city.transit.stops.values()) if (st.segId === seg.id) clear.push({ s: st.s, side: st.side, r: 9 });
  const blocked = (s: number, side: number) => clear.some((c) => (c.side === 0 || c.side === side) && Math.abs(c.s - s) < c.r);
  const p: PolyPoint = { x: 0, z: 0, tx: 0, tz: 0, i: 0 };
  const terrain = city.terrain;
  for (const side of [1, -1]) {
    // Stretches of frontage on this side, in order along the road.
    const runs: { a: number; b: number; f: Frontage; seed: number }[] = [];
    for (const b of beside) {
      if (b.side !== side) continue;
      const f = frontageOf(b);
      if (f) runs.push({ a: Math.max(lo, b.segS - b.hw + 1.5), b: Math.min(hi, b.segS + b.hw - 1.5), f, seed: b.id });
    }
    for (const run of runs) {
      const plan = PLAN[run.f];
      // Line up on a grid along the road so neighbouring lots continue the same rhythm.
      let n = Math.ceil(run.a / plan.every);
      for (let s = n * plan.every; s <= run.b; s += plan.every, n++) {
        if (blocked(s, side)) continue;
        const kind = plan.seq[(n + (seg.id * 7 + (side > 0 ? 0 : 3))) % plan.seq.length];
        pointAt(seg.poly, s, p);
        const rx = -p.tz, rz = p.tx;
        const u = side * (rt.asphaltHalf + 0.5);
        const x = p.x + rx * u, z = p.z + rz * u;
        const y = terrain.roadHeightAt(x, z) + ROAD_LIFT + CURB_H;
        // Long side along the kerb; benches face the shops, their backs to the traffic.
        const rot = Math.atan2(p.tz, p.tx) + (side > 0 ? 0 : Math.PI);
        out.push({ kind, x, y, z, rot });
        // A bin beside each bench on shopping streets.
        if (kind === Furniture.Bench && run.f === 'shops' && !blocked(s + 1.6, side) && s + 1.6 <= run.b) {
          const q: PolyPoint = { x: 0, z: 0, tx: 0, tz: 0, i: 0 };
          pointAt(seg.poly, s + 1.6, q);
          const bx = q.x + -q.tz * u, bz = q.z + q.tx * u;
          out.push({ kind: Furniture.Bin, x: bx, y: terrain.roadHeightAt(bx, bz) + ROAD_LIFT + CURB_H, z: bz, rot });
        }
      }
    }
  }
}

/** Furniture for the whole city, grouped by the buildings along each segment. */
export function allFurniture(city: City): FurnitureItem[] {
  const bySeg = new Map<number, Building[]>();
  for (const b of city.buildings.all.values()) {
    if (!b.segId) continue;
    const list = bySeg.get(b.segId);
    if (list) list.push(b);
    else bySeg.set(b.segId, [b]);
  }
  const out: FurnitureItem[] = [];
  for (const [segId, list] of bySeg) {
    const seg = city.roads.segments.get(segId);
    if (seg) furnitureFor(city, seg, list, out);
  }
  return out;
}
