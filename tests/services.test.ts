import { describe, expect, it } from 'vitest';
import { placeService, previewPlacement } from '../src/sim/CityCommands';
import { fastForward } from '../src/sim/CitySim';
import { Coverage, coverageFalloff } from '../src/sim/services/Coverage';
import { SERVICE_BY_ID } from '../src/sim/services/ServiceTypes';
import { BuildingState } from '../src/sim/types';
import { makeCity, road } from './helpers';

describe('service coverage', () => {
  it('falloff is full near and zero beyond the radius', () => {
    expect(coverageFalloff(0, 500)).toBe(1);
    expect(coverageFalloff(290, 500)).toBe(1);
    expect(coverageFalloff(400, 500)).toBeCloseTo(0.5, 5);
    expect(coverageFalloff(500, 500)).toBe(0);
    expect(coverageFalloff(900, 500)).toBe(0);
  });

  it('a fire station covers its radius once operational', () => {
    const city = makeCity({ empty: true, unlimited: true });
    road(city, 1000, 1000, 1400, 1000);
    const res = placeService(city, 'fire_station', 1200, 1030);
    expect(res.ok).toBe(true);
    const b = res.building!;
    // Under construction: no coverage yet.
    city.coverage.recompute(city.buildings);
    expect(city.coverage.at('fire', b.cx, b.cz)).toBe(0);
    b.state = BuildingState.Active;
    b.progress = 1;
    city.coverage.recompute(city.buildings);
    const r = SERVICE_BY_ID.get('fire_station')!.radius;
    expect(city.coverage.at('fire', b.cx, b.cz)).toBeCloseTo(1, 2);
    expect(city.coverage.at('fire', b.cx + r * 0.5, b.cz)).toBeGreaterThan(0.9);
    expect(city.coverage.at('fire', b.cx + r + 40, b.cz)).toBe(0);
    expect(city.coverage.at('police', b.cx, b.cz)).toBe(0);
  });

  it('effectiveness drops when residents exceed capacity', () => {
    const city = makeCity({ empty: true, unlimited: true });
    road(city, 1000, 1000, 1400, 1000);
    const b = placeService(city, 'clinic', 1200, 1030).building!;
    b.state = BuildingState.Active;
    const cap = SERVICE_BY_ID.get('clinic')!.capacity;
    // Fake an overloaded neighbourhood.
    const fake = placeService(city, 'pocket_park', 1100, 1030).building!;
    fake.residents = cap * 2;
    const cov = new Coverage();
    cov.recompute(city.buildings);
    expect(cov.status.get(b.id)!.effectiveness).toBeCloseTo(0.5, 1);
    expect(cov.at('health', b.cx, b.cz)).toBeCloseTo(0.5, 1);
  });

  it('placement must front a road and respect unlocks', () => {
    const city = makeCity({ empty: true, unlimited: true });
    expect(previewPlacement(city, 'police_station', 1500, 1500).error).toMatch(/road/i);
    road(city, 1000, 1000, 1400, 1000);
    expect(previewPlacement(city, 'police_station', 1200, 1030).valid).toBe(true);
    expect(previewPlacement(city, 'hospital', 1200, 1030).error).toMatch(/Unlocks/);
  });

  it('services finish construction and start operating', () => {
    const city = makeCity({ unlimited: true });
    const sp = city.terrain.spawn;
    road(city, sp.endX, sp.endZ, sp.endX + 300, sp.endZ);
    const res = placeService(city, 'police_station', sp.endX + 150, sp.endZ + 30);
    expect(res.ok).toBe(true);
    fastForward(city, 24 * 8);
    expect(res.building!.state).toBe(BuildingState.Active);
    expect(city.coverage.at('police', res.building!.cx, res.building!.cz)).toBeGreaterThan(0.9);
  });
});

describe('utilities', () => {
  it('distributes power along the connected road network only', () => {
    const city = makeCity({ empty: true, unlimited: true });
    road(city, 500, 500, 900, 500);
    road(city, 1500, 1500, 1900, 1500);
    const t = placeService(city, 'wind_turbine', 600, 520).building!;
    t.state = BuildingState.Active;
    city.recomputeUtilities();
    const seg1 = city.roads.nearestSegment(700, 500, 5)!.seg;
    const seg2 = city.roads.nearestSegment(1700, 1500, 5)!.seg;
    expect(city.utilities.available('power', city.componentOfSegment(seg1.id))).toBeGreaterThan(0);
    expect(city.utilities.available('power', city.componentOfSegment(seg2.id))).toBe(0);
    // Turbine output follows the wind.
    expect(city.utilities.totals.power.production).toBeCloseTo(SERVICE_BY_ID.get('wind_turbine')!.output * city.weather.windPower(), 5);
  });
});

describe('service funding', () => {
  it('scales upkeep, reach and capacity', () => {
    const city = makeCity({ empty: true, unlimited: true });
    road(city, 1000, 1000, 1600, 1000);
    const b = placeService(city, 'police_station', 1300, 1030).building!;
    b.state = BuildingState.Active;
    b.progress = 1;
    const st = SERVICE_BY_ID.get('police_station')!;
    const at = (d: number) => {
      city.coverage.recompute(city.buildings);
      return city.coverage.at('police', b.cx + d, b.cz);
    };
    const edge = st.radius * 0.95;
    const base = at(edge);
    city.economy.setBudget('police', 150);
    expect(at(edge)).toBeGreaterThan(base);
    city.economy.setBudget('police', 50);
    expect(at(edge)).toBeLessThan(base);
    expect(city.economy.budgets.police).toBe(50);
    city.economy.project(city.buildings, city.roads, () => 0.5);
    expect(city.economy.projection.expense.Police).toBeCloseTo(st.upkeep * 0.5, 3);
    city.economy.setBudget('police', 999);
    expect(city.economy.budgets.police).toBe(150);
  });
});

describe('landfills', () => {
  it('a recycling center works through a full landfill', async () => {
    const { LANDFILL_CAPACITY } = await import('../src/sim/services/Coverage');
    const city = makeCity({ unlimited: true });
    city.peakPopulation = 7000;
    const sp = city.terrain.spawn;
    road(city, sp.endX, sp.endZ, sp.endX + 500, sp.endZ, 'avenue');
    const lf = placeService(city, 'landfill', sp.endX + 120, sp.endZ + 40).building!;
    lf.state = BuildingState.Active;
    lf.progress = 1;
    lf.stock = LANDFILL_CAPACITY;
    fastForward(city, 24 * 3);
    expect(lf.stock).toBeGreaterThanOrEqual(LANDFILL_CAPACITY);
    const rc = placeService(city, 'recycling_center', sp.endX + 360, sp.endZ + 40).building!;
    rc.state = BuildingState.Active;
    rc.progress = 1;
    fastForward(city, 24 * 5);
    expect(lf.stock).toBeLessThan(LANDFILL_CAPACITY - 4_000);
  });
});
