import { describe, expect, it } from 'vitest';
import { berthOf, planLane, shippingWater } from '../src/render/boats/ShipRenderer';
import { previewPlacement, placeService } from '../src/sim/CityCommands';
import { HM_RES, HM_STEP, WATER_LEVEL, WORLD_SIZE } from '../src/sim/constants';
import { Demand } from '../src/sim/demand/Demand';
import { BERTH_DEPTH } from '../src/sim/world/Terraform';
import { makeCity, road } from './helpers';

/** A flat town with a coast at x = 1545: a shallow shelf, then deep sea to the map edge. */
function coastalCity() {
  const city = makeCity({ empty: true, unlimited: true });
  city.peakPopulation = 10_000;
  const t = city.terrain;
  for (let iz = 0; iz < HM_RES; iz++) {
    for (let ix = 0; ix < HM_RES; ix++) {
      const x = ix * HM_STEP;
      if (x < 1545) continue;
      t.base[iz * HM_RES + ix] = x < 1600 ? WATER_LEVEL - 1.5 : WATER_LEVEL - 9;
      t.road[iz * HM_RES + ix] = WATER_LEVEL + 1.2;
    }
  }
  t.refreshShore();
  t.waterVersion++;
  road(city, 1450, 1200, 1450, 1700, 'avenue');
  return city;
}

describe('cargo harbour', () => {
  it('needs its quay to face the water', () => {
    const city = coastalCity();
    // Beside a road running down to the shore, the lot's side touches the water but its back faces inland.
    road(city, 1250, 1900, 1530, 1900, 'avenue');
    expect(previewPlacement(city, 'cargo_port', 1470, 1950).error).toBe('The quay (back of the lot) must face the water');
    expect(previewPlacement(city, 'cargo_port', 1500, 1450).valid).toBe(true);
  });

  it('dredges a berth and finds a lane to the open sea', () => {
    const city = coastalCity();
    const r = placeService(city, 'cargo_port', 1500, 1450);
    expect(r.ok).toBe(true);
    const b = r.building!;
    // The shallow shelf behind the quay is now deep enough to come alongside.
    const berth = berthOf(b);
    expect(city.terrain.sampleBase(berth.x, berth.z)).toBeLessThan(WATER_LEVEL - BERTH_DEPTH + 1);
    // Land is never dug away.
    expect(city.terrain.sampleBase(b.cx, b.cz)).toBeGreaterThan(WATER_LEVEL);
    const lane = planLane(shippingWater(city), b)!;
    expect(lane).not.toBeNull();
    // Starts at the map edge, ends at the berth.
    expect(Math.min(lane[0], lane[1], WORLD_SIZE - lane[0], WORLD_SIZE - lane[1])).toBeLessThan(100);
    expect(Math.hypot(lane[lane.length - 2] - berth.x, lane[lane.length - 1] - berth.z)).toBeLessThan(1);
    // String-pulled into a handful of straight legs.
    expect(lane.length / 2).toBeLessThan(8);
  });

  it('boosts industrial and commercial demand', () => {
    const base = {
      connected: true, population: 5000, households: 2000, housingCapacity: 2200, pendingHousing: 0, workers: 2500, employed: 2300,
      educatedWorkers: 800, educatedEmployed: 750, jobs: { commercial: 600, industrial: 900, office: 300, service: 200 },
      filled: { commercial: 560, industrial: 850, office: 280, service: 200 }, taxes: { residential: 9, commercial: 9, industrial: 9, office: 9 },
      happiness: 65, serviceScore: 0.5, congestion: 0.4, avgLandValue: 0.45, officeUnlocked: true,
    };
    const withPort = Demand.compute({ ...base, port: true });
    expect(withPort.factors.industrial.find((f) => f.label === 'Sea freight')?.value).toBe(12);
    expect(withPort.factors.commercial.find((f) => f.label === 'Imported goods')?.value).toBe(4);
  });
});
