import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/City';
import { bulldozeRoad, fillZone, placeService } from '../src/sim/CityCommands';
import { fastForward } from '../src/sim/CitySim';
import { Purpose, VEHICLE_LENGTH, VEHICLE_WIDTH, VM } from '../src/sim/traffic/Vehicles';
import { Zone } from '../src/sim/types';
import { PedState, SEG } from '../src/sim/walk/Pedestrians';
import { makeCity, road, servicedGrid } from './helpers';

const empty = (focusFar = false) => {
  const city = makeCity({ empty: true, unlimited: true });
  city.vehicles.lodRadius = focusFar ? 300 : 1e6;
  if (focusFar) city.vehicles.lodX = city.vehicles.lodZ = 1e5;
  return city;
};

const pt = (city: City, x: number, z: number) => {
  const h = city.roads.nearestSegment(x, z, 8)!;
  return { segId: h.seg.id, s: h.proj.s };
};

const drive = (city: City, from: [number, number], to: [number, number], model: number = VM.sedan) => {
  const route = city.paths.find(pt(city, ...from), pt(city, ...to));
  return route ? city.vehicles.spawn({ route, model, color: 0, purpose: model === VM.bus ? Purpose.Transit : Purpose.Commute }) : -1;
};

describe('at scale', () => {
  it('lane changes never put a car into another', () => {
    const city = empty();
    road(city, 800, 1200, 1800, 1200, 'avenue');
    for (const x of [1100, 1400, 1700]) road(city, x, 1050, x, 1350, 'street');
    const v = city.vehicles;
    let worst = Infinity, seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let f = 0; f < 5000; f++) {
      // Heavy traffic heading east, turning off left and right at different streets (so lots of lane changes).
      if (f < 4000 && f % 9 === 0) {
        const x = [1100, 1400, 1700][Math.floor(rnd() * 3)];
        drive(city, [820, 1200], rnd() < 0.3 ? [1790, 1200] : [x, rnd() < 0.5 ? 1060 : 1340]);
      }
      city.signals.update(0.1);
      v.update(0.1);
      if (f % 4) continue;
      // Everyone in the same lane keeps their distance (bumper to bumper).
      for (let i = 0; i < v.max; i++) {
        if (!v.active[i] || v.isTurning(i)) continue;
        const ri = v.routeOf(i)!.legs[v.legOf(i)];
        for (let j = i + 1; j < v.max; j++) {
          if (!v.active[j] || v.isTurning(j) || v.laneOf(j) !== v.laneOf(i)) continue;
          const rj = v.routeOf(j)!.legs[v.legOf(j)];
          if (rj.segId !== ri.segId || rj.dir !== ri.dir) continue;
          const gap = Math.hypot(v.x[i] - v.x[j], v.z[i] - v.z[j]) - (VEHICLE_LENGTH[v.model[i]] + VEHICLE_LENGTH[v.model[j]]) / 2;
          worst = Math.min(worst, gap);
        }
      }
    }
    expect(v.laneChanges).toBeGreaterThan(50);
    expect(worst).toBeGreaterThan(-0.2);
    expect(v.despawnedStuck).toBe(0);
  });

  it('cars reroute around a road that is taken away', () => {
    const city = empty();
    // Two ways from west to east: a direct street, and a longer loop round by z = 1400.
    road(city, 900, 1200, 1500, 1200);
    road(city, 1000, 1200, 1000, 1400);
    road(city, 1000, 1400, 1400, 1400);
    road(city, 1400, 1400, 1400, 1200);
    const v = city.vehicles;
    const i = drive(city, [920, 1200], [1480, 1200]);
    for (let f = 0; f < 40; f++) v.update(0.1);
    const middle = pt(city, 1200, 1200).segId;
    expect(v.routeOf(i)!.legs.some((l) => l.segId === middle)).toBe(true);
    bulldozeRoad(city, middle);
    expect(v.active[i]).toBe(1);
    expect(v.routeOf(i)!.legs.some((l) => l.segId === middle)).toBe(false);
    expect(v.rerouted).toBe(1);
    let maxZ = 0;
    for (let f = 0; f < 2000 && v.active[i]; f++) {
      v.update(0.1);
      maxZ = Math.max(maxZ, v.z[i]);
    }
    expect(v.arrived).toBe(1);
    // Round by the loop.
    expect(maxZ).toBeGreaterThan(1390);
  });

  it('traffic keeps moving through an overloaded grid', () => {
    const city = empty();
    for (let k = 0; k < 4; k++) road(city, 900, 1000 + k * 150, 1450, 1000 + k * 150);
    for (let k = 0; k < 4; k++) road(city, 950 + k * 150, 950, 950 + k * 150, 1500);
    const v = city.vehicles;
    const ends: [number, number][] = [];
    for (let k = 0; k < 4; k++) ends.push([905, 1000 + k * 150], [1445, 1000 + k * 150], [950 + k * 150, 955], [950 + k * 150, 1495]);
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const windows: number[] = [];
    let last = 0;
    for (let f = 0; f < 9000; f++) {
      // Far more than the junctions can take.
      if (f % 3 === 0) {
        const a = ends[Math.floor(rnd() * ends.length)], b = ends[Math.floor(rnd() * ends.length)];
        if (a !== b) drive(city, a, b);
      }
      v.update(0.1);
      if (f % 600 === 599) {
        windows.push(v.arrived - last);
        last = v.arrived;
      }
    }
    // Once it has filled up, cars still get through in every minute.
    for (const w of windows.slice(2)) expect(w).toBeGreaterThan(5);
    expect(v.despawnedStuck).toBeLessThan(v.arrived * 0.05);
  });

  it('cars out of sight (updated less often) still arrive about when they would have', () => {
    const time = (far: boolean) => {
      const city = empty(far);
      road(city, 900, 1200, 1900, 1200, 'avenue');
      for (const x of [1200, 1500]) road(city, x, 1000, x, 1400);
      const v = city.vehicles;
      drive(city, [920, 1200], [1880, 1200]);
      let f = 0;
      for (; f < 5000 && v.count; f++) {
        city.signals.update(0.05);
        v.update(0.05);
      }
      return f;
    };
    const near = time(false), far = time(true);
    expect(Math.abs(far - near) / near).toBeLessThan(0.2);
  });
});

/** A small town with lights and people about. */
function town(): City {
  const city = new City({ name: 'Crossings', seed: 1234, preset: 'lakes', flatTerrain: 10, unlimitedMoney: true, civSeed: 4242 });
  servicedGrid(city);
  const sp = city.terrain.spawn;
  const x = sp.endX, z = sp.endZ;
  road(city, x + 50, z + 120, x + 350, z + 120);
  for (let k = 0; k < 3; k++) {
    fillZone(city, x + 50 + k * 100, z + 40, Zone.ResMed);
    fillZone(city, x + 50 + k * 100, z - 40, Zone.Commercial);
    fillZone(city, x + 50 + k * 100, z + 160, k === 2 ? Zone.Office : Zone.Commercial);
  }
  city.peakPopulation = 3000;
  placeService(city, 'town_park', x + 150, z + 85);
  city.peakPopulation = 0;
  fastForward(city, 24 * 50);
  return city;
}

describe('cars and people', () => {
  it('never share a crossing', () => {
    const city = town();
    const sp = city.terrain.spawn;
    const focus = { x: sp.endX + 200, z: sp.endZ + 40 };
    const ped = city.pedestrians, v = city.vehicles;
    ped.density = 4;
    city.live.density = 1.5;
    city.traffic.setDemand(city.trips.buildDemand());
    city.traffic.assignAll();
    v.lodX = focus.x;
    v.lodZ = focus.z;
    let crossers = 0, clashes = 0;
    const dt = 1 / 20;
    for (let f = 0; f < 20 * 240; f++) {
      city.live.update(dt, 1, 8.2);
      ped.update(dt, focus, { x: focus.x, z: focus.z + 60 }, 200, 8.2);
      if (f % 2) continue;
      for (let i = 0; i < ped.max; i++) {
        if (!ped.active[i] || ped.state[i] !== PedState.Walk) continue;
        const p = ped.pathOf(i)!;
        const k = p.kind[ped.segmentOf(i)];
        if (k !== SEG.signal && k !== SEG.zebra && k !== SEG.informal) continue;
        crossers++;
        for (let j = 0; j < v.max; j++) {
          if (!v.active[j]) continue;
          // In the car's own frame: is the person inside its footprint (with a hand's breadth to spare)?
          const rx = ped.x[i] - v.x[j], rz = ped.z[i] - v.z[j];
          const c = Math.cos(v.heading[j]), s = Math.sin(v.heading[j]);
          const along = rx * c + rz * s, side = -rx * s + rz * c;
          if (Math.abs(along) < VEHICLE_LENGTH[v.model[j]] / 2 + 0.2 && Math.abs(side) < VEHICLE_WIDTH[v.model[j]] / 2 + 0.2) clashes++;
        }
      }
    }
    expect(crossers).toBeGreaterThan(200);
    expect(clashes).toBe(0);
  });
});
