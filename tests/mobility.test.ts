import { beforeAll, describe, expect, it } from 'vitest';
import { City } from '../src/sim/City';
import { fillZone, placeService } from '../src/sim/CityCommands';
import { fastForward } from '../src/sim/CitySim';
import { deserializeCity, serializeCity } from '../src/sim/save/Serializer';
import { BuildingState, Zone, isResidential, zoneBase } from '../src/sim/types';
import { road, servicedGrid } from './helpers';

/** A town with homes, shops, offices, a park and a school around an avenue and three streets. */
function town(): City {
  const city = new City({ name: 'Commute', seed: 1234, preset: 'lakes', flatTerrain: 10, unlimitedMoney: true, civSeed: 4242 });
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
  placeService(city, 'pocket_park', x + 150, z + 85);
  placeService(city, 'elementary_school', x + 250, z + 85);
  city.peakPopulation = 0;
  fastForward(city, 24 * 60);
  return city;
}

describe('getting around', () => {
  let city: City;
  beforeAll(() => {
    city = town();
    city.mobility.runNow();
  });

  it('works out travel times on foot that match the walking network', () => {
    const mob = city.mobility;
    expect(mob.ready).toBe(true);
    const homes = [...city.buildings.all.values()].filter((b) => b.state === BuildingState.Active && isResidential(b.zone));
    const shops = [...city.buildings.all.values()].filter((b) => b.state === BuildingState.Active && zoneBase(b.zone) === Zone.Commercial);
    expect(homes.length).toBeGreaterThan(5);
    expect(shops.length).toBeGreaterThan(0);
    let compared = 0;
    for (const h of homes.slice(0, 6)) {
      const m = mob.minutesByMode(h, shops[0])!;
      expect(m).not.toBeNull();
      expect(m.car).toBeLessThan(30);
      const route = city.walk.route(city.walk.locationOf(h)!, city.walk.locationOf(shops[0])!);
      if (!route) continue;
      // Zones are approximate (160 m squares), so within a few minutes.
      expect(Math.abs(m.walk - route.time / 60)).toBeLessThan(5);
      compared++;
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('has commuters choosing how to travel, and each home its own commute', () => {
    const s = city.mobility.stats!;
    expect(s.commuters).toBeGreaterThan(20);
    expect(s.walk + s.bike + s.transit + s.car).toBeCloseTo(1, 3);
    // A small, mixed town: plenty walk.
    expect(s.walk).toBeGreaterThan(0.15);
    expect(s.avgCommute).toBeGreaterThan(1);
    expect(s.avgCommute).toBeLessThan(30);
    let withCommute = 0;
    for (const b of city.buildings.all.values()) {
      if (!isResidential(b.zone) || b.state !== BuildingState.Active) continue;
      const c = city.mobility.commuteOf(b);
      if (c === null) continue;
      withCommute++;
      const m = city.mobility.modesOf(b)!;
      expect(m.walk + m.bike + m.transit + m.car).toBeCloseTo(1, 3);
    }
    expect(withCommute).toBeGreaterThan(3);
  });

  it('takes people who walk off the roads', () => {
    const before = city.trips;
    before.refresh();
    let withWalking = 0;
    for (const d of before.buildDemand()) withWalking += d.trips;
    // The same demand if everyone drove.
    const pop = city.population;
    let commutes = 0;
    for (let i = 0; i < pop.count; i++) if (pop.alive[i]) for (let k = 0; k < 2; k++) if (pop.job[i * 2 + k]) commutes++;
    const carShare = city.mobility.stats!.car;
    expect(carShare).toBeLessThan(0.9);
    let drivenCommutes = 0;
    for (let i = 0; i < pop.count; i++) if (pop.alive[i]) for (let k = 0; k < 2; k++) if (pop.job[i * 2 + k]) drivenCommutes += city.mobility.carShare(i, k);
    expect(drivenCommutes).toBeLessThan(commutes * 0.9);
    expect(withWalking).toBeGreaterThan(0);
  });

  it('brings customers to shops and visitors to parks', () => {
    const mob = city.mobility;
    let customers = 0;
    for (const b of city.buildings.all.values()) {
      if (b.state !== BuildingState.Active || zoneBase(b.zone) !== Zone.Commercial) continue;
      const c = mob.customers(b);
      if (!c) continue;
      expect(c.walk).toBeGreaterThanOrEqual(0);
      expect(c.walk).toBeLessThanOrEqual(1);
      customers += c.visits;
    }
    expect(customers).toBeGreaterThan(0);
    // Every household within reach of a shop goes about once a day.
    expect(customers).toBeCloseTo(mob.stats!.shopVisits, 0);
    const park = [...city.buildings.all.values()].find((b) => b.typeId === 'pocket_park')!;
    const pv = mob.parkVisits(park)!;
    expect(pv.visits).toBeGreaterThan(0);
    // A pocket park among this many homes is busy, which makes it worth less to each visitor.
    const home = [...city.buildings.all.values()].find((b) => isResidential(b.zone) && b.state === BuildingState.Active && Math.hypot(b.cx - park.cx, b.cz - park.cz) < 150)!;
    expect(mob.parkAccess(home)).toBeGreaterThan(0);
    expect(mob.jobAccess(home)).toBeGreaterThan(0.3);
  });

  it('matches jobs by travel time', () => {
    const pop = city.population;
    let total = 0, n = 0;
    for (let i = 0; i < pop.count; i++) {
      if (!pop.alive[i]) continue;
      for (let k = 0; k < 2; k++) {
        const j = pop.job[i * 2 + k];
        if (!j) continue;
        const m = city.mobility.minutesBetween(city.buildings.get(pop.home[i])!, city.buildings.get(j)!);
        if (m !== null) {
          total += m;
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(10);
    expect(total / n).toBeLessThan(20);
  });

  it('eases older cities in, and new ones start with the full effect', () => {
    expect(city.mobility.phase).toBe(1);
    const data = serializeCity(city);
    delete (data as { mobility?: unknown }).mobility;
    const old = deserializeCity(data);
    expect(old.mobility.phase).toBe(0);
    expect(old.mobility.effect).toBe(0);
    fastForward(old, 24 * 30);
    expect(old.mobility.phase).toBeGreaterThan(0.07);
    expect(old.mobility.phase).toBeLessThan(0.1);
    const again = deserializeCity(serializeCity(old));
    expect(again.mobility.phase).toBeCloseTo(old.mobility.phase, 5);
  });
});

describe('barriers to walking', () => {
  /** Two places joined by a parkway (no sidewalks) or by a street. */
  function pair(link: 'parkway' | 'street') {
    const city = new City({ name: 'Split', seed: 77, preset: 'lakes', flatTerrain: 10, unlimitedMoney: true, empty: true });
    city.peakPopulation = 9000;
    road(city, 1000, 1000, 1400, 1000);
    road(city, 1000, 1300, 1400, 1300);
    road(city, 1200, 1000, 1200, 1300, link);
    const a = placeService(city, 'pocket_park', 1300, 980).building!;
    const b = placeService(city, 'pocket_park', 1300, 1320).building!;
    fastForward(city, 24 * 10);
    city.mobility.runNow();
    return city.mobility.minutesByMode(a, b)!;
  }

  it('means no walking where a road without sidewalks is the only way', () => {
    const viaParkway = pair('parkway');
    expect(viaParkway.walk).toBe(Infinity);
    expect(viaParkway.car).toBeLessThan(10);
    const viaStreet = pair('street');
    expect(viaStreet.walk).toBeLessThan(12);
  });
});
