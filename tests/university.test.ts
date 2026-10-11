import { describe, expect, it } from 'vitest';
import { placeService } from '../src/sim/CityCommands';
import { campusReach, tickCity } from '../src/sim/CitySim';
import { Demand, type DemandInputs } from '../src/sim/demand/Demand';
import { SERVICE_BY_ID } from '../src/sim/services/ServiceTypes';
import { unlocksAt } from '../src/sim/progress/Progress';
import { BuildingState } from '../src/sim/types';
import { makeCity, road } from './helpers';

describe('university', () => {
  it('is a big, late education service that unlocks with the City milestone', () => {
    const u = SERVICE_BY_ID.get('university')!;
    expect(u.kind).toBe('education');
    expect(u.radius).toBeGreaterThan(SERVICE_BY_ID.get('high_school')!.radius);
    expect(unlocksAt(6_000)).toContain('University');
  });

  it('reaches neighbourhoods around the campus once it operates', () => {
    const city = makeCity({ empty: true, unlimited: true });
    city.peakPopulation = 10_000;
    road(city, 1000, 1500, 1800, 1500, 'avenue');
    const r = placeService(city, 'university', 1300, 1560);
    expect(r.ok).toBe(true);
    const b = r.building!;
    expect(campusReach(city, b.cx, b.cz)).toBe(0); // still under construction
    b.state = BuildingState.Active;
    b.progress = 1;
    b.power = b.water = b.sewage = true;
    city.coverage.recompute(city.buildings);
    const near = campusReach(city, b.cx + 100, b.cz);
    const far = campusReach(city, b.cx + 1200, b.cz);
    expect(near).toBeGreaterThan(0.9);
    expect(far).toBeGreaterThan(0);
    expect(far).toBeLessThan(near);
    expect(campusReach(city, b.cx + 2000, b.cz)).toBe(0);
    for (let h = 0; h < 30; h++) tickCity(city);
    expect(city.demand.factors.office.map((f) => f.label)).toContain('University graduates');
  });

  it('adds graduates to office demand', () => {
    const base: DemandInputs = {
      connected: true, population: 8000, households: 3000, housingCapacity: 3200, pendingHousing: 0, workers: 4000, employed: 3800,
      educatedWorkers: 1500, educatedEmployed: 1400, jobs: { commercial: 900, industrial: 1200, office: 800, service: 400 },
      filled: { commercial: 850, industrial: 1150, office: 760, service: 400 }, taxes: { residential: 9, commercial: 9, industrial: 9, office: 9 },
      happiness: 70, serviceScore: 0.6, congestion: 0.5, avgLandValue: 0.5, officeUnlocked: true,
    };
    const without = Demand.compute(base);
    const withUni = Demand.compute({ ...base, university: true });
    expect(withUni.factors.office.find((f) => f.label === 'University graduates')?.value).toBe(9);
    expect(withUni.value.office).toBeGreaterThan(without.value.office);
  });
});
