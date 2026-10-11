import { describe, expect, it } from 'vitest';
import { createLine, placeService, placeStop } from '../src/sim/CityCommands';
import { demandInputs, projectEconomy, refreshStats, tickCity } from '../src/sim/CitySim';
import { type Building, newBuilding } from '../src/sim/buildings/Buildings';
import { Demand } from '../src/sim/demand/Demand';
import { HIGH_RISE_CAP } from '../src/sim/policies/Policies';
import { deserializeCity, serializeCity } from '../src/sim/save/Serializer';
import { BuildingState, Zone } from '../src/sim/types';
import { makeCity, road } from './helpers';

/** Homes and shops along an avenue (built directly, no waiting for growth). */
function town() {
  const city = makeCity({ unlimited: true });
  city.peakPopulation = 7000;
  const sp = city.terrain.spawn;
  const x0 = sp.endX, z0 = sp.endZ;
  road(city, x0, z0, x0 + 800, z0, 'avenue');
  road(city, x0 + 800, z0, x0 + 1600, z0, 'avenue');
  const make = (x: number, zone: Zone, hhCap: number, jobs: number): Building => {
    const hit = city.roads.nearestSegment(x, z0 - 30, 60)!;
    const b = newBuilding({
      kind: 'zoned', typeId: 'lowrise', style: 'lowrise', zone, cx: x, cz: z0 - 30, angle: 0, hw: 10, hd: 10, y: 10,
      state: BuildingState.Active, progress: 1, segId: hit.seg.id, segS: hit.proj.s, side: hit.proj.side, hhCap, jobs,
    });
    city.addBuilding(b);
    return b;
  };
  const home = make(x0 + 150, Zone.ResMed, 60, 0);
  const shop = make(x0 + 1450, Zone.Commercial, 0, 200);
  for (let k = 0; k < 50; k++) {
    const i = city.addHousehold(home, 2, 1, 1);
    city.population.setJob(i, 0, shop.id);
    shop.workers++;
  }
  refreshStats(city);
  return { city, home, shop, x0, z0 };
}

describe('city policies', () => {
  it('only unlocked policies can be enacted', () => {
    const { city } = town();
    city.peakPopulation = 400;
    expect(city.policies.set('smokeDetectors', true)).toBe(true);
    expect(city.policies.set('cleanAir', true)).toBe(false);
    expect(city.policies.has('cleanAir')).toBe(false);
    expect(city.policies.set('smokeDetectors', false)).toBe(true);
    expect(city.policies.active.size).toBe(0);
  });

  it('running costs and tax trade-offs show up in the budget', () => {
    const { city } = town();
    projectEconomy(city);
    const before = { ...city.economy.projection.income };
    expect(city.economy.projection.expense.Policies).toBeUndefined();
    city.policies.set('recycling', true);
    city.policies.set('smallBusiness', true);
    projectEconomy(city);
    expect(city.economy.projection.expense.Policies).toBeCloseTo(city.stats.households * 0.9, 3);
    expect(city.economy.projection.income['Commercial tax']!).toBeCloseTo(before['Commercial tax']! * 0.8, 3);
    expect(city.economy.projection.income['Residential tax']).toBeCloseTo(before['Residential tax']!, 3);
  });

  it('business policies move demand', () => {
    const { city } = town();
    const sum = (fs: { value: number }[]) => fs.reduce((a, f) => a + f.value, 0);
    const base = Demand.compute(demandInputs(city)).factors;
    city.policies.set('smallBusiness', true);
    city.policies.set('industryIncentives', true);
    const r = Demand.compute(demandInputs(city)).factors;
    expect(sum(r.commercial) - sum(base.commercial)).toBeCloseTo(12, 5);
    expect(sum(r.industrial) - sum(base.industrial)).toBeCloseTo(14, 5);
    city.policies.set('cleanAir', true);
    expect(sum(Demand.compute(demandInputs(city)).factors.industrial) - sum(base.industrial)).toBeCloseTo(6, 5);
  });

  it('free transit trades fares for riders', () => {
    const { city, x0, z0 } = town();
    const depot = placeService(city, 'bus_depot', x0 + 700, z0 + 40).building!;
    depot.state = BuildingState.Active;
    depot.progress = 1;
    const a = placeStop(city, x0 + 150, z0 - 10).stop!;
    const b = placeStop(city, x0 + 1450, z0 - 10).stop!;
    createLine(city, [a.id, b.id]);
    city.transit.updateRidership();
    const riders = city.transit.totalRiders;
    expect(city.transit.monthlyFares()).toBeGreaterThan(0);
    city.policies.set('freeTransit', true);
    city.transit.updateRidership();
    expect(city.transit.totalRiders).toBeGreaterThan(riders);
    expect(city.transit.monthlyFares()).toBe(0);
  });

  it('the high-rise ban caps new buildings and survives save/load', () => {
    const { city } = town();
    city.policies.set('highRiseBan', true);
    expect(city.spawner.maxFloorsAt(500, 500)).toBe(HIGH_RISE_CAP);
    const data = JSON.parse(JSON.stringify(serializeCity(city)));
    const loaded = deserializeCity(data, { flatTerrain: 10 });
    expect(loaded.policies.has('highRiseBan')).toBe(true);
    expect(loaded.spawner.maxFloorsAt(500, 500)).toBe(HIGH_RISE_CAP);
    loaded.policies.set('highRiseBan', false);
    expect(loaded.spawner.maxFloorsAt(500, 500)).toBe(Infinity);
  });
});

describe('district policies', () => {
  /** A district painted over the homes at the west end of the avenue. */
  function withDistrict() {
    const t = town();
    const d = t.city.districts.create('Old Town')!;
    t.city.districts.paint(t.home.cx, t.home.cz, 80, d.id);
    for (const b of t.city.buildings.all.values()) b.district = t.city.districts.at(b.cx, b.cz);
    return { ...t, d };
  }

  it('apply only inside their district', () => {
    const { city, d, home, shop } = withDistrict();
    expect(home.district).toBe(d.id);
    expect(shop.district).toBe(0);
    expect(city.policies.setLocal(d.id, 'highRiseBan', true)).toBe(true);
    expect(city.policies.in('highRiseBan', d.id)).toBe(true);
    expect(city.policies.in('highRiseBan', 0)).toBe(false);
    expect(city.policies.has('highRiseBan')).toBe(false);
    expect(city.spawner.maxFloorsAt(home.cx, home.cz)).toBe(HIGH_RISE_CAP);
    expect(city.spawner.maxFloorsAt(shop.cx, shop.cz)).toBe(Infinity);
    expect(city.policies.count()).toBe(1);
  });

  it('only district-friendly, unlocked policies can be enacted locally', () => {
    const { city, d } = withDistrict();
    expect(city.policies.setLocal(d.id, 'freeTransit', false)).toBe(false);
    expect(city.policies.setLocal(d.id, 'smallBusiness', true)).toBe(false);
    expect(city.policies.setLocal(999, 'recycling', true)).toBe(false);
    city.peakPopulation = 400;
    expect(city.policies.setLocal(d.id, 'cleanAir', true)).toBe(false);
    expect(city.policies.setLocal(d.id, 'smokeDetectors', true)).toBe(true);
  });

  it('cost only what the district uses', () => {
    const { city, d } = withDistrict();
    city.policies.setLocal(d.id, 'recycling', true);
    const local = city.policies.costOf('recycling', d.id);
    expect(local).toBeGreaterThan(0);
    expect(local).toBeCloseTo(50 * 0.9, 3);
    expect(city.policies.monthlyCost()).toBeCloseTo(local, 3);
    // A city-wide policy replaces (not adds to) the district one.
    city.policies.set('recycling', true);
    expect(city.policies.monthlyCost()).toBeCloseTo(city.policies.costOf('recycling'), 3);
  });

  it('reduce garbage only in the district', () => {
    const { city, d, home, shop } = withDistrict();
    const run = () => {
      home.garbage = 0;
      shop.garbage = 0;
      city.clock.tick = Math.ceil(city.clock.tick / 24) * 24 + 23;
      tickCity(city);
      return { home: home.garbage, shop: shop.garbage };
    };
    const before = run();
    city.policies.setLocal(d.id, 'recycling', true);
    const after = run();
    expect(after.home).toBeLessThan(before.home * 0.8);
    expect(after.shop).toBeCloseTo(before.shop, 3);
  });

  it('reuse district ids so they fit the byte grid', () => {
    const city = makeCity({ empty: true });
    for (let k = 0; k < 400; k++) {
      const d = city.districts.create()!;
      expect(d.id).toBeLessThanOrEqual(255);
      if (k % 3) city.districts.remove(d.id);
    }
    expect(Math.max(...city.districts.list.keys())).toBeLessThanOrEqual(255);
  });

  it('survive save/load, and go when the district is deleted', () => {
    const { city, d } = withDistrict();
    city.policies.setLocal(d.id, 'neighborhoodWatch', true);
    const data = JSON.parse(JSON.stringify(serializeCity(city)));
    const loaded = deserializeCity(data, { flatTerrain: 10 });
    expect(loaded.policies.in('neighborhoodWatch', d.id)).toBe(true);
    expect(loaded.policies.has('neighborhoodWatch')).toBe(false);
    loaded.districts.remove(d.id);
    expect(loaded.policies.count()).toBe(0);
    expect(loaded.policies.serializeLocal()).toEqual([]);
  });
});
