import { describe, expect, it } from 'vitest';
import { buildRoundabout, previewRoundabout } from '../src/sim/CityCommands';
import { deserializeCity, serializeCity } from '../src/sim/save/Serializer';
import { Purpose, VM } from '../src/sim/traffic/Vehicles';
import { makeCity, road } from './helpers';

/** A plain four-way street crossing at (1200, 1200). */
function crossing() {
  const city = makeCity({ empty: true, unlimited: true });
  road(city, 1000, 1200, 1400, 1200);
  road(city, 1200, 1000, 1200, 1400);
  return city;
}

describe('roundabouts', () => {
  it('turns a junction into a one-way ring with an island', () => {
    const city = crossing();
    const pv = previewRoundabout(city, 1203, 1198);
    expect(pv.valid, pv.error).toBe(true);
    const res = buildRoundabout(city, 1203, 1198);
    expect(res.ok).toBe(true);
    const ring = res.segIds!.map((id) => city.roads.getSegment(id));
    expect(ring.length).toBeGreaterThanOrEqual(4);
    for (const s of ring) {
      expect(s.ring).toBe(true);
      expect(s.oneway).toBe(1);
      // On the circle.
      const mx = s.poly.pts[Math.floor(s.poly.count / 2) * 2], mz = s.poly.pts[Math.floor(s.poly.count / 2) * 2 + 1];
      expect(Math.abs(Math.hypot(mx - 1200, mz - 1200) - pv.r)).toBeLessThan(1.5);
    }
    expect(city.roads.nearestNode(1200, 1200, 3)).toBeNull();
    expect(city.roads.roundabouts.size).toBe(1);
    for (const s of ring) expect(city.layout.get(s.a)!.control).toBe('roundabout');
    // Can't do it twice.
    expect(previewRoundabout(city, ring[0].poly.pts[0], ring[0].poly.pts[1]).valid).toBe(false);
  });

  it('routes around the ring in the right direction', () => {
    const city = crossing();
    buildRoundabout(city, 1200, 1200);
    const west = city.roads.nearestSegment(1050, 1200, 5)!;
    const north = city.roads.nearestSegment(1200, 1050, 5)!;
    const east = city.roads.nearestSegment(1350, 1200, 5)!;
    for (const to of [north, east]) {
      const route = city.paths.find({ segId: west.seg.id, s: 50 }, { segId: to.seg.id, s: to.seg.length / 2 })!;
      expect(route).not.toBeNull();
      for (const leg of route.legs) {
        const s = city.roads.getSegment(leg.segId);
        if (s.ring) expect(leg.dir).toBe(1);
      }
    }
  });

  it('traffic flows through without gridlock', () => {
    const city = crossing();
    buildRoundabout(city, 1200, 1200);
    const ends = [[1020, 1200], [1380, 1200], [1200, 1020], [1200, 1380]].map(([x, z]) => city.roads.nearestSegment(x, z, 5)!);
    let spawned = 0;
    for (let wave = 0; wave < 6; wave++) {
      for (let i = 0; i < 4; i++) {
        const from = ends[i], to = ends[(i + 2) % 4];
        const route = city.paths.find({ segId: from.seg.id, s: from.proj.s }, { segId: to.seg.id, s: to.proj.s });
        if (route && city.vehicles.spawn({ route, model: VM.sedan, color: 0xffffff, purpose: Purpose.Commute }) >= 0) spawned++;
      }
      for (let f = 0; f < 60; f++) city.vehicles.update(0.1);
    }
    for (let f = 0; f < 3000 && city.vehicles.count > 0; f++) city.vehicles.update(0.1);
    expect(spawned).toBeGreaterThan(12);
    expect(city.vehicles.arrived).toBeGreaterThanOrEqual(spawned - 1);
    expect(city.vehicles.despawnedStuck).toBe(0);
  });

  it('survives save and load', () => {
    const city = crossing();
    buildRoundabout(city, 1200, 1200);
    const loaded = deserializeCity(JSON.parse(JSON.stringify(serializeCity(city))), { flatTerrain: 10 });
    expect(loaded.roads.roundabouts.size).toBe(1);
    expect([...loaded.roads.segments.values()].filter((s) => s.ring).length).toBe([...city.roads.segments.values()].filter((s) => s.ring).length);
  });
});
