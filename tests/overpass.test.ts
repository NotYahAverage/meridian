import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/City';
import { buildRoad, previewRoad, snap } from '../src/sim/CityCommands';
import { OVERPASS_CLEARANCE, nodeRaised, raisedLift } from '../src/sim/roads/Overpass';
import { deserializeCity, serializeCity } from '../src/sim/save/Serializer';

function city(): City {
  const c = new City({ name: 'Flyover', seed: 12, preset: 'highlands', flatTerrain: 10, unlimitedMoney: true, empty: true });
  c.peakPopulation = 10_000;
  return c;
}
const road = (c: City, ax: number, az: number, bx: number, bz: number, type: 'street' | 'highway', raised = false) =>
  previewRoad(c, type, snap(c, ax, az, type), snap(c, bx, bz, type), null, raised);

describe('raised highways', () => {
  it('pass over a street without making a junction, and cost more', () => {
    const c = city();
    expect(buildRoad(c, road(c, 1400, 1000, 1400, 1600, 'street')).ok).toBe(true);
    const ground = road(c, 1100, 1300, 1700, 1300, 'highway');
    const raised = road(c, 1100, 1300, 1700, 1300, 'highway', true);
    expect(raised.error).toBeUndefined();
    expect(raised.events.length).toBe(0);
    expect(ground.events.length).toBe(1);
    expect(raised.cost).toBeGreaterThan(ground.cost * 2);
    const res = buildRoad(c, raised);
    expect(res.ok).toBe(true);
    const seg = c.roads.getSegment(res.segIds![0]);
    expect(seg.raised).toBe(true);
    // Ramps at both (ground) ends, full height in the middle.
    expect(raisedLift(c.roads, seg, 0)).toBe(0);
    expect(raisedLift(c.roads, seg, seg.length / 2)).toBe(OVERPASS_CLEARANCE);
    // The street underneath was not split.
    expect(c.roads.segments.size).toBe(2);
  });

  it('stays up where raised pieces join, and survives a save', () => {
    const c = city();
    const a = buildRoad(c, road(c, 1000, 1300, 1400, 1300, 'highway', true));
    const b = buildRoad(c, road(c, 1400, 1300, 1800, 1300, 'highway', true));
    expect(a.ok && b.ok).toBe(true);
    const s1 = c.roads.getSegment(a.segIds![0]);
    expect(nodeRaised(c.roads, s1.b)).toBe(true);
    expect(raisedLift(c.roads, s1, s1.length)).toBe(OVERPASS_CLEARANCE);
    const again = deserializeCity(serializeCity(c), { flatTerrain: 10 });
    expect([...again.roads.segments.values()].every((s) => s.raised)).toBe(true);
  });

  it('refuses low crossings, crossings of each other, and non-highways', () => {
    const c = city();
    expect(road(c, 1100, 1300, 1700, 1300, 'street', true).error).toMatch(/Only highways/);
    buildRoad(c, road(c, 1400, 1000, 1400, 1600, 'street'));
    // The crossing is on the ramp (30 m from the start): too low.
    expect(road(c, 1370, 1300, 1800, 1300, 'highway', true).error).toMatch(/Too low/);
    buildRoad(c, road(c, 1100, 1300, 1700, 1300, 'highway', true));
    expect(road(c, 1300, 1000, 1300, 1600, 'highway', true).error).toMatch(/cross each other/);
  });
});
