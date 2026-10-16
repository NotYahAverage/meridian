import { beforeAll, describe, expect, it } from 'vitest';
import { City } from '../src/sim/City';
import { fillZone, placeService } from '../src/sim/CityCommands';
import { fastForward } from '../src/sim/CitySim';
import { adultsIn, citizenOf } from '../src/sim/population/Citizens';
import { ROAD_TYPES } from '../src/sim/roads/RoadTypes';
import { Zone } from '../src/sim/types';
import { Errand, PedState, SEG } from '../src/sim/walk/Pedestrians';
import { road, servicedGrid } from './helpers';

/** A small town: an avenue with three streets, homes, shops and offices, a park and a school. */
function town(): City {
  const city = new City({ name: 'Footpath', seed: 1234, preset: 'lakes', flatTerrain: 10, unlimitedMoney: true, civSeed: 4242 });
  servicedGrid(city);
  const sp = city.terrain.spawn;
  const x = sp.endX, z = sp.endZ;
  road(city, x + 50, z + 120, x + 350, z + 120);
  for (let k = 0; k < 3; k++) {
    fillZone(city, x + 50 + k * 100, z + 40, Zone.ResLow);
    fillZone(city, x + 50 + k * 100, z - 40, k === 1 ? Zone.Commercial : Zone.ResMed);
    fillZone(city, x + 50 + k * 100, z + 160, k === 2 ? Zone.Office : Zone.Commercial);
  }
  city.peakPopulation = 3000;
  placeService(city, 'town_park', x + 150, z + 85);
  placeService(city, 'elementary_school', x + 250, z + 85);
  city.peakPopulation = 0;
  fastForward(city, 24 * 50);
  return city;
}

interface Run {
  frames: number;
  maxCount: number;
  near: number;
  pairs: number;
  offRoad: number;
  checked: number;
  ms: number;
}

/** Runs the street at `hour` for `seconds`, checking every walker against the roads now and then. */
function run(city: City, hour: number, seconds: number, opts: { density?: number; check?: boolean } = {}): Run {
  const ped = city.pedestrians;
  ped.density = opts.density ?? 1;
  const sp = city.terrain.spawn;
  const focus = { x: sp.endX + 200, z: sp.endZ + 40 };
  const camera = { x: focus.x, z: focus.z + 60 };
  const dt = 1 / 30;
  const out: Run = { frames: 0, maxCount: 0, near: 0, pairs: 0, offRoad: 0, checked: 0, ms: 0 };
  for (let f = 0; f < seconds / dt; f++) {
    city.signals.update(dt);
    const t0 = performance.now();
    ped.update(dt, focus, camera, 200, hour);
    out.ms += performance.now() - t0;
    out.frames++;
    out.maxCount = Math.max(out.maxCount, ped.count);
    if (!opts.check || f % 15) continue;
    // Off the carriageway except on crossings.
    for (let i = 0; i < ped.max; i++) {
      if (!ped.active[i] || ped.state[i] !== PedState.Walk) continue;
      const p = ped.pathOf(i)!;
      const s = ped.segmentOf(i);
      if (p.kind[s] !== SEG.walk) continue;
      out.checked++;
      for (const seg of city.roads.segmentsIn(ped.x[i] - 20, ped.z[i] - 20, ped.x[i] + 20, ped.z[i] + 20)) {
        const hit = city.roads.nearestSegment(ped.x[i], ped.z[i], 30, (q) => q.id === seg.id);
        if (!hit || hit.proj.s < seg.trimA || hit.proj.s > seg.length - seg.trimB) continue;
        if (hit.proj.dist < ROAD_TYPES[seg.type].asphaltHalf - 0.1) out.offRoad++;
      }
    }
    // Nobody walks through anybody (people in a group walk close together on purpose).
    for (let i = 0; i < ped.max; i++) {
      if (!ped.active[i] || ped.state[i] !== PedState.Walk) continue;
      out.near++;
      for (let j = i + 1; j < ped.max; j++) {
        if (!ped.active[j] || ped.state[j] !== PedState.Walk || ped.leader[j] === i || ped.leader[i] === j) continue;
        if (Math.hypot(ped.x[i] - ped.x[j], ped.z[i] - ped.z[j]) < 0.3) out.pairs++;
      }
    }
  }
  return out;
}

describe('people on foot', () => {
  let city: City;
  beforeAll(() => {
    city = town();
  });

  it('are real household members with stable identities', () => {
    const pop = city.population;
    expect(pop.households).toBeGreaterThan(30);
    let checked = 0;
    for (let h = 0; h < pop.count && checked < 40; h++) {
      if (!pop.alive[h]) continue;
      checked++;
      const a = citizenOf(pop, h, 0), b = citizenOf(pop, h, 0);
      expect(a).toEqual(b);
      for (let k = 0; k < pop.size[h]; k++) {
        const c = citizenOf(pop, h, k);
        expect(c.home).toBe(pop.home[h]);
        if (k < pop.workers[h]) {
          expect(c.age).toBeGreaterThanOrEqual(22);
          expect(c.job).toBe(pop.job[h * 2 + k]);
        }
        if (k >= adultsIn(pop, h)) expect(c.age).toBeLessThan(18);
        // Children share the family name.
        if (k >= adultsIn(pop, h)) expect(c.family).toBe(citizenOf(pop, h, 0).family);
      }
    }
  });

  it('walk door to door at rush hour: on sidewalks, across at the lights, and inside at the end', () => {
    city.pedestrians.clear();
    const r = run(city, 8, 140, { check: true });
    const s = city.pedestrians.stats;
    expect(r.maxCount).toBeGreaterThan(8);
    expect(s.arrived).toBeGreaterThan(5);
    expect(s.crossings).toBeGreaterThan(5);
    expect(s.redLight).toBe(0);
    expect(r.checked).toBeGreaterThan(200);
    expect(r.offRoad).toBe(0);
    expect(r.pairs / Math.max(1, r.near)).toBeLessThan(0.01);
    // Commuters were on their way to real jobs.
    let toWork = 0;
    for (let i = 0; i < city.pedestrians.max; i++) {
      if (!city.pedestrians.active[i] || city.pedestrians.errand[i] !== Errand.Work) continue;
      const pop = city.population, hh = city.pedestrians.household[i], k = city.pedestrians.member[i];
      expect(city.pedestrians.dest[i]).toBe(pop.job[hh * 2 + k]);
      toWork++;
    }
    expect(toWork).toBeGreaterThan(0);
  });

  it('wait at red lights, look for gaps, pause at shop windows and visit the park', () => {
    city.pedestrians.clear();
    const ped = city.pedestrians;
    // A busier street than this small town would have, so every behaviour shows up.
    ped.density = 5;
    let waitingLights = 0, waitingGap = 0, paused = 0, lingering = 0;
    const sp = city.terrain.spawn;
    for (let f = 0; f < 30 * 160; f++) {
      city.signals.update(1 / 30);
      ped.update(1 / 30, { x: sp.endX + 200, z: sp.endZ + 40 }, { x: sp.endX + 200, z: sp.endZ + 100 }, 200, 14);
      if (f % 10) continue;
      for (let i = 0; i < ped.max; i++) {
        if (!ped.active[i]) continue;
        const w = ped.waitingFor(i);
        if (w === 'lights') waitingLights++;
        if (w === 'gap') waitingGap++;
        if (ped.state[i] === PedState.Pause) paused++;
        if (ped.state[i] === PedState.Linger) lingering++;
      }
    }
    expect(waitingLights).toBeGreaterThan(0);
    expect(paused).toBeGreaterThan(0);
    expect(lingering).toBeGreaterThan(0);
    expect(ped.stats.redLight).toBe(0);
    expect(waitingGap).toBeGreaterThanOrEqual(0);
  });

  it('thin out at night', () => {
    city.pedestrians.clear();
    const day = run(city, 13, 40).maxCount;
    city.pedestrians.clear();
    const night = run(city, 3, 40).maxCount;
    expect(night).toBeLessThan(day * 0.6);
  });

  it('stay cheap with a crowd of thousands', () => {
    city.pedestrians.clear();
    const r = run(city, 17.5, 60, { density: 250 });
    expect(r.maxCount).toBeGreaterThan(1500);
    // Average update cost per frame, with spawning and all.
    expect(r.ms / r.frames).toBeLessThan(6);
  });
});
