import { describe, expect, it } from 'vitest';
import { generateBuilding } from '../src/render/buildings/generators';
import { placeService, previewPlacement } from '../src/sim/CityCommands';
import { projectEconomy, tourismIncome } from '../src/sim/CitySim';
import { SERVICE_TYPES } from '../src/sim/services/ServiceTypes';
import { BuildingState } from '../src/sim/types';
import { makeCity, road } from './helpers';

const LANDMARKS = SERVICE_TYPES.filter((s) => s.kind === 'landmark');

describe('landmarks', () => {
  it('every landmark has a generator that builds sensible geometry', () => {
    for (const st of LANDMARKS) {
      const geo = generateBuilding({ style: st.style, w: st.w, d: st.d, floors: 2, level: 1, seed: 11 }, 1000, 1000, 0, 10);
      expect(geo.vertexCount, st.id).toBeGreaterThan(200);
      expect(geo.height, st.id).toBeGreaterThan(8);
    }
    const tower = LANDMARKS.find((s) => s.id === 'tower')!;
    expect(generateBuilding({ style: tower.style, w: tower.w, d: tower.d, floors: 2, level: 1, seed: 1 }, 0, 0, 0, 0).height).toBeGreaterThan(200);
  });

  it('is unique, raises leisure coverage and earns tourism', () => {
    const city = makeCity({ unlimited: true });
    city.peakPopulation = 3000;
    const sp = city.terrain.spawn;
    road(city, sp.endX, sp.endZ, sp.endX + 700, sp.endZ, 'avenue');
    const res = placeService(city, 'museum', sp.endX + 300, sp.endZ + 40);
    expect(res.ok, res.error).toBe(true);
    expect(previewPlacement(city, 'museum', sp.endX + 300, sp.endZ - 40).error).toMatch(/already/i);
    const b = res.building!;
    b.state = BuildingState.Active;
    b.progress = 1;
    city.coverage.recompute(city.buildings);
    expect(city.coverage.at('park', b.cx, b.cz)).toBeGreaterThan(0.4);
    expect(tourismIncome(city)).toBeGreaterThan(1000);
    projectEconomy(city);
    expect(city.economy.projection.income.Tourism).toBeGreaterThan(1000);
    expect(city.economy.projection.expense.Landmarks).toBeGreaterThan(0);
    // Visitors drive in to see it.
    city.trips.refresh();
    expect(city.trips.sights.length).toBe(1);
  });
});
