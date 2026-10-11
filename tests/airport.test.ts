import { describe, expect, it } from 'vitest';
import { placeService } from '../src/sim/CityCommands';
import { demandInputs, tourismIncome } from '../src/sim/CitySim';
import { Demand } from '../src/sim/demand/Demand';
import { newBuilding } from '../src/sim/buildings/Buildings';
import { BuildingState, Zone } from '../src/sim/types';
import { makeCity, road } from './helpers';

describe('regional airport', () => {
  function setup(peak = 15_000) {
    const city = makeCity({ unlimited: true });
    city.peakPopulation = peak;
    const sp = city.terrain.spawn;
    road(city, sp.endX, sp.endZ, sp.endX + 700, sp.endZ, 'avenue');
    city.processRoadChanges();
    return { city, x: sp.endX + 350, z: sp.endZ + 70 };
  }

  it('unlocks at 12,000 residents and is unique', () => {
    const early = setup(9_000);
    expect(placeService(early.city, 'airport', early.x, early.z).ok).toBe(false);
    const { city, x, z } = setup();
    const res = placeService(city, 'airport', x, z);
    expect(res.ok, res.error).toBe(true);
    expect(placeService(city, 'airport', x, z - 160).ok).toBe(false);
  });

  it('brings tourism and business once open', () => {
    const { city, x, z } = setup();
    const b = placeService(city, 'airport', x, z).building!;
    expect(demandInputs(city).airport).toBe(false);
    const before = tourismIncome(city);
    b.state = BuildingState.Active;
    b.progress = 1;
    const inp = demandInputs(city);
    expect(inp.airport).toBe(true);
    expect(tourismIncome(city)).toBeGreaterThan(before + 3_000);
    const factors = Demand.compute(inp).factors;
    expect(factors.commercial.some((f) => f.label === 'Airport visitors')).toBe(true);
    expect(factors.industrial.some((f) => f.label === 'Air cargo')).toBe(true);
  });

  it('draws hotels nearby, whose overnight stays add tourism income (capped)', () => {
    const { city, x, z } = setup();
    const ap = placeService(city, 'airport', x, z).building!;
    ap.state = BuildingState.Active;
    expect(city.spawner.tourismAt(ap.cx, ap.cz - 150)).toBeGreaterThan(0.5);
    expect(city.spawner.tourismAt(ap.cx + 2000, ap.cz)).toBe(0);
    city.stats.happiness = 100;
    const base = tourismIncome(city);
    const hit = city.roads.nearestSegment(x, z - 120, 200)!;
    const add = (floors: number) => {
      const h = newBuilding({ kind: 'zoned', typeId: 'hotel', style: 'hotel', zone: Zone.Commercial, cx: x + 400, cz: z - 140, angle: 0, hw: 16, hd: 18, y: 10,
        state: BuildingState.Active, progress: 1, segId: hit.seg.id, floors, level: 3, jobs: 50, workers: 50 });
      city.buildings.add(h);
    };
    add(10);
    const one = tourismIncome(city);
    expect(one).toBeGreaterThan(base);
    for (let k = 0; k < 30; k++) add(14);
    expect(tourismIncome(city)).toBeCloseTo(base * 1.6, 0);
  });
});
