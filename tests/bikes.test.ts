import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/City';
import { ROAD_TYPES } from '../src/sim/roads/RoadTypes';
import { Stage } from '../src/sim/traffic/Signals';
import { BIKE_LANE, Held, Purpose, VM } from '../src/sim/traffic/Vehicles';
import { makeCity, road, servicedGrid } from './helpers';
import { fillZone } from '../src/sim/CityCommands';
import { fastForward } from '../src/sim/CitySim';
import { Zone } from '../src/sim/types';
import { TICKS_PER_DAY } from '../src/sim/constants';

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

describe('bike lanes', () => {
  it('cost money, stay through saving and loading and road splits, and not on highways', async () => {
    const { setBikeLane, BIKE_LANE } = await import('../src/sim/CityCommands');
    const { serializeCity, deserializeCity } = await import('../src/sim/save/Serializer');
    const city = makeCity({ empty: true });
    city.economy.money = 1e6;
    city.peakPopulation = 1e5;
    road(city, 900, 1200, 1300, 1200);
    road(city, 900, 1500, 1500, 1500, 'highway');
    const seg = city.roads.nearestSegment(1100, 1200, 5)!.seg;
    const before = city.economy.money;
    const r = setBikeLane(city, seg.id, 2);
    expect(r.ok).toBe(true);
    expect(before - city.economy.money).toBeCloseTo(seg.length * BIKE_LANE.costPerMeter[2], 0);
    expect(setBikeLane(city, seg.id, 2).ok).toBe(false);
    const hw = city.roads.nearestSegment(1200, 1500, 5)!.seg;
    expect(setBikeLane(city, hw.id, 1).ok).toBe(false);
    // A new road across splits it: both halves keep their lanes.
    road(city, 1100, 1100, 1100, 1300);
    const parts = [...city.roads.segments.values()].filter((s) => s.type === 'street' && Math.abs(s.poly.pts[1] - 1200) < 1 && Math.abs(s.poly.pts[s.poly.pts.length - 1] - 1200) < 1);
    expect(parts.length).toBe(2);
    for (const p of parts) expect(p.bikeLane).toBe(2);
    const loaded = deserializeCity(JSON.parse(JSON.stringify(serializeCity(city))), { flatTerrain: 10 });
    expect([...loaded.roads.segments.values()].filter((s) => s.bikeLane === 2).length).toBe(2);
    // Taking them away is free.
    const m = city.economy.money;
    expect(setBikeLane(city, parts[0].id, 0).ok).toBe(true);
    expect(city.economy.money).toBe(m);
  });

  it('make streets feel safe to ride, and bike routes use them', async () => {
    const { setBikeLane } = await import('../src/sim/CityCommands');
    const city = makeCity({ empty: true, unlimited: true });
    // Two parallel avenues; one gets protected lanes.
    road(city, 900, 1200, 1500, 1200, 'avenue');
    road(city, 900, 1300, 1500, 1300, 'avenue');
    road(city, 900, 1200, 900, 1300);
    road(city, 1500, 1200, 1500, 1300);
    const a = city.roads.nearestSegment(1200, 1300, 5)!.seg;
    const fake = { segId: a.id } as never;
    const plain = city.mobility.bikeSafety(fake);
    setBikeLane(city, a.id, 2);
    expect(city.mobility.bikeSafety(fake)).toBeGreaterThan(plain);
    expect(city.mobility.bikeSafety(fake)).toBe(1);
    const r = city.live.bikeRoute(pt(city, 905, 1250), pt(city, 1495, 1250))!;
    expect(r.legs.some((l) => l.segId === a.id)).toBe(true);
  });
});

describe('residents asking for bike lanes', () => {
  // A small town (homes along an avenue, shops and offices nearby).
  const crowded = () => {
    const city = new City({ name: 'Riders', seed: 1234, preset: 'lakes', flatTerrain: 10, unlimitedMoney: true, civSeed: 4242 });
    servicedGrid(city);
    const sp = city.terrain.spawn;
    const x = sp.endX, z = sp.endZ;
    road(city, x + 50, z + 120, x + 350, z + 120);
    for (let k = 0; k < 3; k++) {
      fillZone(city, x + 50 + k * 100, z + 40, Zone.ResMed);
      fillZone(city, x + 50 + k * 100, z - 40, Zone.ResMed);
      fillZone(city, x + 50 + k * 100, z + 160, k === 1 ? Zone.Office : Zone.Commercial);
    }
    fastForward(city, 24 * 60);
    return city;
  };

  it('ask, and are pleased when you build them (and you pay)', () => {
    const city = crowded();
    const req = city.bikeRequests;
    for (let m = 0; m < 4 && !req.open.length; m++) req.monthly();
    expect(req.open.length).toBeGreaterThan(0);
    expect(req.open.length).toBeLessThanOrEqual(2);
    const r = req.open[0];
    const seg = city.roads.getSegment(r.segId);
    expect(seg.bikeLane).toBe(0);
    const home = city.buildings.onSegment(seg.id).find((b) => b.residents > 0)!;
    city.economy.unlimited = false;
    city.economy.money = 1e6;
    const money = city.economy.money;
    expect(req.approve(r.id).ok).toBe(true);
    expect(city.roads.getSegment(r.segId).bikeLane).toBe(r.kind);
    expect(city.economy.money).toBeLessThan(money);
    expect(req.moodOf(home)).toBeGreaterThan(0);
    expect(req.forSegment(r.segId)).toBeUndefined();
  });

  it('are disappointed when you decline, and come back if ignored', async () => {
    const { serializeCity, deserializeCity } = await import('../src/sim/save/Serializer');
    const city = crowded();
    const req = city.bikeRequests;
    for (let m = 0; m < 4 && !req.open.length; m++) req.monthly();
    const r = req.open[0];
    const home = city.buildings.onSegment(r.segId).find((b) => b.residents > 0)!;
    // Saved with the city.
    const loaded = deserializeCity(JSON.parse(JSON.stringify(serializeCity(city))), { flatTerrain: 10 });
    expect(loaded.bikeRequests.forSegment(r.segId)?.kind).toBe(r.kind);
    req.decline(r.id);
    expect(req.moodOf(home)).toBeLessThan(0);
    // Not again from that street for a year.
    for (let m = 0; m < 6; m++) {
      req.monthly();
      expect(req.forSegment(r.segId)).toBeUndefined();
    }
    // Another street's request, ignored: it lapses, then comes back asking again.
    const other = req.open[0] ?? (req.monthly(), req.open[0]);
    if (other) {
      city.clock.tick = (other.until + 1) * TICKS_PER_DAY;
      req.monthly();
      expect(req.forSegment(other.segId)).toBeUndefined();
      city.clock.tick += 200 * TICKS_PER_DAY;
      for (let m = 0; m < 3 && !req.forSegment(other.segId); m++) req.monthly();
      expect(req.forSegment(other.segId)?.asks).toBe(2);
    }
  });
});
