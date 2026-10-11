import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/City';
import { buildRoad, bulldozeRoad, previewRoad, snap } from '../src/sim/CityCommands';
import { CORE_OFFSET, WATER_LEVEL } from '../src/sim/constants';
import { ROAD_TYPES } from '../src/sim/roads/RoadTypes';
import { deserializeCity, serializeCity } from '../src/sim/save/Serializer';
import { BRIDGE_CLEARANCE } from '../src/sim/world/Terrain';

/** Finds a straight east–west crossing over a lake with land on both sides. */
function findCrossing(city: City): { z: number; x0: number; x1: number; wa: number; wb: number } {
  const t = city.terrain;
  // Look on the starting map (the middle of the world).
  const O = CORE_OFFSET;
  for (let z = O + 400; z < O + 2700; z += 40) {
    let start = -1;
    for (let x = O + 200; x < O + 2900; x += 4) {
      const water = t.isWater(x, z, 0.35);
      if (water && start < 0) start = x;
      if (!water && start >= 0) {
        const span = x - start;
        if (span > 80 && span < 600 && !t.isWater(start - 140, z, 0.35) && !t.isWater(x + 140, z, 0.35) && t.slopeAt(start - 100, z) < 0.2 && t.slopeAt(x + 100, z) < 0.2) {
          return { z, x0: start - 110, x1: x + 110, wa: start, wb: x };
        }
        start = -1;
      }
    }
  }
  throw new Error('no lake crossing found');
}

function plan(city: City, ax: number, az: number, bx: number, bz: number) {
  return previewRoad(city, 'avenue', snap(city, ax, az, 'avenue'), snap(city, bx, bz, 'avenue'), null);
}

describe('bridges', () => {
  const city = new City({ name: 'Bridgeport', seed: 1234, preset: 'lakes', empty: true, unlimitedMoney: true });
  city.peakPopulation = 10_000;
  const c = findCrossing(city);
  const mid = (c.wa + c.wb) / 2;

  it('plans a bridge across water and charges extra for the span', () => {
    const p = plan(city, c.x0, c.z, c.x1, c.z);
    expect(p.valid, p.error).toBe(true);
    expect(p.elevated).toBe(true);
    expect(p.bridgeLength).toBeGreaterThan(60);
    expect(p.cost).toBeGreaterThan(p.length * ROAD_TYPES.avenue.costPerMeter * 1.5);
  });

  it('needs room for its ramps', () => {
    const p = plan(city, c.wa - 6, c.z, c.x1, c.z);
    expect(p.valid).toBe(false);
    expect(p.error).toMatch(/further from the water/);
  });

  it('builds a raised deck over open water without filling the lake', () => {
    const res = buildRoad(city, plan(city, c.x0, c.z, c.x1, c.z));
    expect(res.ok).toBe(true);
    const segs = res.segIds!.map((id) => city.roads.getSegment(id));
    expect(segs.some((s) => s.elevated)).toBe(true);
    expect(city.terrain.roadHeightAt(mid, c.z)).toBeCloseTo(WATER_LEVEL + BRIDGE_CLEARANCE, 0);
    expect(city.terrain.heightAt(mid, c.z)).toBeLessThan(WATER_LEVEL);
    // The ramps meet the ground smoothly at both ends.
    const endGap = Math.abs(city.terrain.roadHeightAt(c.x0 + 2, c.z) - city.terrain.groundRoadHeightAt(c.x0 + 2, c.z));
    expect(endGap).toBeLessThan(0.3);
    // No zoning along the bridge.
    const zi = city.zones.index(mid, c.z - 20);
    expect(city.zones.zonable[zi]).toBe(0);
    // Traffic can route across.
    const a = city.roads.nearestSegment(c.x0 + 5, c.z, 10)!;
    const b = city.roads.nearestSegment(c.x1 - 5, c.z, 10)!;
    expect(city.paths.find({ segId: a.seg.id, s: a.proj.s }, { segId: b.seg.id, s: b.proj.s })).not.toBeNull();
  });

  it('roads cannot join the bridge in mid-air', () => {
    const p = plan(city, mid, c.z - 150, mid, c.z + 150);
    expect(p.valid).toBe(false);
  });

  it('survives save and load, and bulldozing removes the deck', () => {
    const loaded = deserializeCity(JSON.parse(JSON.stringify(serializeCity(city))));
    expect([...loaded.roads.segments.values()].some((s) => s.elevated)).toBe(true);
    expect(loaded.terrain.roadHeightAt(mid, c.z)).toBeCloseTo(WATER_LEVEL + BRIDGE_CLEARANCE, 0);
    const span = [...loaded.roads.segments.values()].find((s) => s.elevated)!;
    // Remove every bridge piece.
    for (const s of [...loaded.roads.segments.values()]) if (s.elevated) bulldozeRoad(loaded, s.id);
    void span;
    expect(loaded.terrain.roadHeightAt(mid, c.z)).toBeLessThan(WATER_LEVEL + 2);
  });
});

describe('river valley map', () => {
  it('has a river crossing the whole map east of a dry, buildable start', async () => {
    const { City } = await import('../src/sim/City');
    const city = new City({ name: 'River', seed: 4242, preset: 'river', empty: true });
    const t = city.terrain;
    // Every east-west line meets water somewhere east of the start.
    const { CORE_OFFSET: O } = await import('../src/sim/constants');
    for (const z of [200, 800, 1500, 2200, 2900].map((v) => v + O)) {
      let wet = false;
      for (let x = O + 1500; x < O + 2400 && !wet; x += 8) wet = t.isWater(x, z);
      expect(wet, `river at z=${z - O}`).toBe(true);
    }
    const sp = t.spawn;
    for (let x = sp.endX; x < sp.endX + 300; x += 20) expect(t.isWater(x, sp.endZ)).toBe(false);
    expect(t.slopeAt(sp.endX + 100, sp.endZ)).toBeLessThan(0.2);
  });
});
