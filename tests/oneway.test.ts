import { describe, expect, it } from 'vitest';
import { buildRoad, cycleRoadDirection, previewRoad, snap } from '../src/sim/CityCommands';
import { deserializeCity, serializeCity } from '../src/sim/save/Serializer';
import type { RoadSegment } from '../src/sim/roads/RoadNetwork';
import { ROAD_TYPES, onewayLaneOffset } from '../src/sim/roads/RoadTypes';
import { Purpose, VM } from '../src/sim/traffic/Vehicles';
import { makeCity, road } from './helpers';

function onewayRoad(city: ReturnType<typeof makeCity>, ax: number, az: number, bx: number, bz: number) {
  const plan = previewRoad(city, 'street', snap(city, ax, az, 'street'), snap(city, bx, bz, 'street'), null);
  plan.oneway = true;
  return buildRoad(city, plan);
}

const on = (seg: RoadSegment, s: number) => ({ segId: seg.id, s });

describe('one-way roads', () => {
  it('routes follow the direction and detour around one-way streets', () => {
    const city = makeCity({ empty: true, unlimited: true });
    // A loop: one-way street along the top (west→east), two-way street along the bottom.
    const top = onewayRoad(city, 1000, 1000, 1300, 1000);
    expect(top.ok).toBe(true);
    road(city, 1000, 1000, 1000, 1100);
    road(city, 1300, 1000, 1300, 1100);
    road(city, 1000, 1100, 1300, 1100);
    const seg = city.roads.getSegment(top.segIds![0]);
    expect(seg.oneway).toBe(1);
    // With the flow: straight along the street.
    const fwd = city.paths.find(on(seg, 50), on(seg, 250))!;
    expect(fwd.legs.length).toBe(1);
    expect(fwd.length).toBeCloseTo(200, 0);
    // Against the flow: the route goes round the block.
    const back = city.paths.find(on(seg, 250), on(seg, 50))!;
    expect(back).not.toBeNull();
    expect(back.length).toBeGreaterThan(500);
    for (const leg of back.legs) {
      const s = city.roads.getSegment(leg.segId);
      if (s.oneway === 1) expect(leg.dir).toBe(1);
    }
  });

  it('traffic assignment never sends volume the wrong way', () => {
    const city = makeCity({ empty: true, unlimited: true });
    const top = onewayRoad(city, 1000, 1000, 1300, 1000);
    const seg = city.roads.getSegment(top.segIds![0]);
    // No alternative route: the reverse trip is unreachable.
    const tree = city.paths.tree(on(seg, 250))!;
    expect(tree.stamp[seg.a] === tree.gen && tree.cost[seg.a] < 1e9).toBe(false);
    expect(city.paths.find(on(seg, 250), on(seg, 50))).toBeNull();
  });

  it('cars use every lane on a one-way avenue', () => {
    const city = makeCity({ empty: true, unlimited: true });
    city.peakPopulation = 5000;
    const plan = previewRoad(city, 'avenue', snap(city, 1000, 1000, 'avenue'), snap(city, 1400, 1000, 'avenue'), null);
    plan.oneway = true;
    const seg = city.roads.getSegment(buildRoad(city, plan).segIds![0]);
    expect(seg.oneway).toBe(1);
    const rt = ROAD_TYPES.avenue;
    expect(onewayLaneOffset(rt, 0)).toBeCloseTo(-1.5 * rt.laneWidth, 5);
    expect(onewayLaneOffset(rt, 3)).toBeCloseTo(1.5 * rt.laneWidth, 5);
    // Through traffic continues onto a two-way avenue, so it may use any lane.
    const next = city.roads.getSegment(road(city, 1400, 1000, 1800, 1000, 'avenue').res.segIds![0]);
    const zs = new Set<number>();
    for (let k = 0; k < 8; k++) {
      const route = city.paths.find(on(seg, 20 + k * 40), on(next, 300))!;
      const i = city.vehicles.spawn({ route, model: VM.sedan, color: 0xffffff, purpose: Purpose.Commute });
      if (i >= 0) zs.add(Math.round(city.vehicles.z[i] - 1000));
    }
    // Spread across lanes on both sides of the centreline, all inside the carriageway.
    expect(zs.size).toBeGreaterThanOrEqual(2);
    for (const z of zs) expect(Math.abs(z)).toBeLessThan(rt.asphaltHalf);
  });

  it('direction cycles, survives splits and save/load', () => {
    const city = makeCity({ empty: true, unlimited: true });
    const r = road(city, 1000, 1000, 1400, 1000);
    const id = r.res.segIds![0];
    expect(cycleRoadDirection(city, id).oneway).toBe(1);
    expect(cycleRoadDirection(city, id).oneway).toBe(-1);
    // A cross street splits the one-way road; both halves keep the flow.
    road(city, 1200, 900, 1200, 1100);
    const pieces = [...city.roads.segments.values()].filter((s) => Math.abs(s.poly.pts[1] - 1000) < 1 && Math.abs(s.poly.pts[s.poly.count * 2 - 1] - 1000) < 1);
    expect(pieces.length).toBe(2);
    for (const p of pieces) expect(p.oneway).toBe(-1);
    const loaded = deserializeCity(JSON.parse(JSON.stringify(serializeCity(city))), { flatTerrain: 10 });
    const lp = [...loaded.roads.segments.values()].filter((s) => s.oneway !== 0);
    expect(lp.length).toBe(2);
    // Boulevards can't be one-way.
    const b = road(city, 1000, 1300, 1400, 1300, 'avenue');
    city.peakPopulation = 9000;
    city.roads.retypeSegment(b.res.segIds![0], 'boulevard');
    expect(cycleRoadDirection(city, b.res.segIds![0]).ok).toBe(false);
  });
});
