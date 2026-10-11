import { describe, expect, it } from 'vitest';
import { generateBuilding } from '../src/render/buildings/generators';
import { lodGeometry } from '../src/render/buildings/BuildingRenderer';
import { fillZone } from '../src/sim/CityCommands';
import { fastForward } from '../src/sim/CitySim';
import { COVERAGE_KINDS } from '../src/sim/services/ServiceTypes';
import { Zone } from '../src/sim/types';
import { makeCity, servicedGrid } from './helpers';

function grownCity() {
  const city = makeCity();
  servicedGrid(city);
  city.peakPopulation = 5_000;
  const sp = city.terrain.spawn;
  fillZone(city, sp.endX + 120, sp.endZ - 100, Zone.ResMed);
  fillZone(city, sp.endX + 220, sp.endZ + 120, Zone.Commercial);
  fastForward(city, 24 * 20);
  return city;
}

describe('big-city performance paths', () => {
  it('coverage worked out a slice at a time matches doing it at once', () => {
    const city = grownCity();
    city.coverage.recompute(city.buildings);
    const once = Object.fromEntries(COVERAGE_KINDS.map((k) => [k, Float32Array.from(city.coverage.grids[k])]));
    const it = city.coverage.recomputeSteps(city.buildings, 1);
    let steps = 0;
    // Readers see the old (complete) grids until the new ones are swapped in.
    while (!it.next().done) {
      steps++;
      for (const k of COVERAGE_KINDS) expect(city.coverage.grids[k]).toEqual(once[k]);
    }
    expect(steps).toBeGreaterThan(1);
    for (const k of COVERAGE_KINDS) expect(city.coverage.grids[k]).toEqual(once[k]);
  });

  it('traffic assignment (one tree per origin street) keeps every trip on the map', () => {
    const city = grownCity();
    const demand = city.trips.buildDemand();
    const total = demand.reduce((a, d) => a + d.trips, 0);
    city.traffic.setDemand(demand);
    city.traffic.assignAll();
    expect(city.traffic.totalTrips).toBeCloseTo(total, 3);
    expect(city.traffic.routedTrips).toBeGreaterThan(total * 0.9);
  });

  it('distant buildings become a box in their main facade', () => {
    const geo = generateBuilding({ style: 'tower', w: 30, d: 30, floors: 12, level: 2, seed: 5 }, 100, 100, 0.3, 10);
    const lod = lodGeometry({ cx: 100, cz: 100, angle: 0.3, hw: 15, hd: 15, y: 10 }, geo);
    expect(lod.vertexCount).toBe(20);
    // A windowed facade, not plain trim.
    expect(lod.pat[0]).not.toBe(0);
    let top = 0;
    for (let i = 0; i < lod.vertexCount; i++) top = Math.max(top, lod.pos[i * 3 + 1]);
    expect(top - 10).toBeGreaterThan(geo.height * 0.7);
  });
});
