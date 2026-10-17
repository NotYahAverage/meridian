import { describe, expect, it } from 'vitest';
import type { City } from '../src/sim/City';
import { ROAD_TYPES } from '../src/sim/roads/RoadTypes';
import { Stage } from '../src/sim/traffic/Signals';
import { BIKE_LANE, Held, Purpose, VM } from '../src/sim/traffic/Vehicles';
import { makeCity, road, servicedGrid } from './helpers';
import { fillZone } from '../src/sim/CityCommands';
import { fastForward } from '../src/sim/CitySim';
import { Zone } from '../src/sim/types';

const town = () => {
  const city = makeCity({ empty: true, unlimited: true });
  city.vehicles.lodRadius = 1e6;
  return city;
};
const pt = (city: City, x: number, z: number) => {
  const h = city.roads.nearestSegment(x, z, 8)!;
  return { segId: h.seg.id, s: h.proj.s };
};

describe('cyclists', () => {
  it('ride along the kerb, and cars overtake them on a one-lane street', () => {
    const city = town();
    road(city, 900, 1200, 1700, 1200);
    const v = city.vehicles;
    const bike = city.live.spawn(pt(city, 920, 1200), pt(city, 1680, 1200), VM.bike, 0x2f6db5, Purpose.Commute);
    expect(bike).toBeGreaterThanOrEqual(0);
    expect(v.laneOf(bike)).toBe(BIKE_LANE);
    for (let f = 0; f < 60; f++) v.update(0.1);
    const car = city.live.spawn(pt(city, 920, 1200), pt(city, 1680, 1200), VM.sedan, 0xffffff, Purpose.Commute);
    let passed = false, speed = 0;
    for (let f = 0; f < 900 && v.active[bike]; f++) {
      v.update(0.1);
      speed = Math.max(speed, v.speed[bike]);
      // By the kerb: well outside the car lane.
      expect(v.z[bike] - 1200).toBeGreaterThan(ROAD_TYPES.street.asphaltHalf - 1.0);
      if (v.active[car] && v.x[car] > v.x[bike] + 3) passed = true;
    }
    expect(passed).toBe(true);
    expect(speed).toBeGreaterThan(3.5);
    expect(speed).toBeLessThan(7);
  });

  it('stop at red lights like everyone else', () => {
    const city = town();
    road(city, 900, 1200, 1500, 1200, 'avenue');
    road(city, 1200, 900, 1200, 1500);
    const node = city.roads.nearestNode(1200, 1200, 3)!;
    const st = city.signals.states.get(node.id)!;
    const north = pt(city, 1200, 1000).segId;
    st.phase = st.phases.findIndex((p) => p.includes(north));
    st.stage = Stage.Green;
    const v = city.vehicles;
    const bike = city.live.spawn(pt(city, 1050, 1200), pt(city, 1450, 1200), VM.bike, 0x2f6db5, Purpose.Commute);
    for (let f = 0; f < 600; f++) v.update(0.1);
    expect(v.speed[bike]).toBeLessThan(0.1);
    expect(v.held[bike]).toBe(Held.Red);
    expect(v.x[bike]).toBeLessThan(1190);
  });

  it('never ride on highways', () => {
    const city = town();
    // Two ways across: a short highway, or a longer way round by streets.
    road(city, 900, 1200, 1500, 1200, 'highway');
    road(city, 900, 1200, 900, 1400);
    road(city, 900, 1400, 1500, 1400);
    road(city, 1500, 1400, 1500, 1200);
    road(city, 900, 1200, 900, 1100);
    road(city, 1500, 1200, 1500, 1100);
    const r = city.live.bikeRoute(pt(city, 900, 1120), pt(city, 1500, 1120))!;
    expect(r).not.toBeNull();
    for (const l of r.legs) expect(city.roads.getSegment(l.segId).type).not.toBe('highway');
  });

  it('are a way to work for some commuters, more on quiet streets', () => {
    const city = makeCity({ unlimited: true });
    servicedGrid(city);
    const sp = city.terrain.spawn;
    for (let k = 0; k < 3; k++) {
      fillZone(city, sp.endX + 50 + k * 100, sp.endZ + 40, Zone.ResLow);
      fillZone(city, sp.endX + 50 + k * 100, sp.endZ - 40, k === 1 ? Zone.Office : Zone.Commercial);
    }
    fastForward(city, 24 * 40);
    city.mobility.runNow();
    const s = city.mobility.stats!;
    expect(s.commuters).toBeGreaterThan(5);
    expect(s.bike).toBeGreaterThan(0.01);
    expect(s.bike).toBeLessThan(0.3);
    expect(s.walk + s.bike + s.transit + s.car).toBeGreaterThan(0.98);
  });
});
