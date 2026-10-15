import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/City';
import { placePrototype, placeService } from '../src/sim/CityCommands';
import { fastForward, goalComplete } from '../src/sim/CitySim';
import { IDEAS } from '../src/sim/design/Ideas';
import { reach } from '../src/sim/research/Generate';
import { LIVE_FIELDS, PRINCIPLE_BY_ID, isLiveField } from '../src/sim/research/Knowledge';
import { MILESTONES } from '../src/sim/research/Progress';
import { deserializeCity, loadFromJSON, serializeCity } from '../src/sim/save/Serializer';
import { GROUPS } from '../src/sim/design/Tastes';
import OLD_SAVE from './fixtures/v2-city.save.json?raw';
import { SERVICE_BY_ID } from '../src/sim/services/ServiceTypes';
import { GOALS } from '../src/sim/progress/Progress';
import { servicedGrid } from './helpers';

function labTown(): City {
  const city = new City({ name: 'Labs', seed: 1234, preset: 'lakes', flatTerrain: 10, unlimitedMoney: true, civSeed: 4242 });
  servicedGrid(city);
  city.peakPopulation = 5000;
  return city;
}

function placeLab(city: City, dx: number): number {
  const sp = city.terrain.spawn;
  for (let k = 0; k < 30; k++) {
    const r = placeService(city, 'research_center', sp.endX + dx + k * 10, sp.endZ - 60);
    if (r.ok) return r.building!.id;
  }
  throw new Error('no site for a lab');
}

describe('research as a utilities side branch', () => {
  it('works only in energy, water and environment', () => {
    expect(LIVE_FIELDS).toEqual(['energy', 'water', 'environment']);
    // Utility work done under other fields moved into them.
    expect(PRINCIPLE_BY_ID.get('reclamation')!.field).toBe('environment');
    expect(PRINCIPLE_BY_ID.get('heat_recovery')!.field).toBe('energy');
    expect(PRINCIPLE_BY_ID.get('fermentation')!.field).toBe('environment');
    expect(reach({ id: 1, name: 'x', field: 'architecture', secondary: ['medicine', 'water'], equipment: 1 })).toEqual(['water']);
    expect(reach({ id: 1, name: 'x', field: 'architecture', secondary: ['medicine'], equipment: 1 })).toEqual(LIVE_FIELDS);
    expect(MILESTONES.filter((m) => m.id.startsWith('field:')).map((m) => m.id.slice(6)).every((f) => LIVE_FIELDS.includes(f as never))).toBe(true);
    expect(SERVICE_BY_ID.get('research_center')!.name).toBe('Utility Lab');
  });

  it('new labs specialise in a utility field and propose only utility work', () => {
    const city = labTown();
    const id = placeLab(city, 150);
    const c = city.research.centers.get(id)!;
    expect(isLiveField(c.field)).toBe(true);
    for (const f of c.secondary) expect(isLiveField(f)).toBe(true);
    fastForward(city, 24 * 15);
    for (const o of c.offers) expect(isLiveField(o.field)).toBe(true);
  });

  it('older cities: labs in a retired field turn to a utility one; their old offers are withdrawn', () => {
    const city = labTown();
    const id = placeLab(city, 150);
    fastForward(city, 24 * 15);
    const data = JSON.parse(JSON.stringify(serializeCity(city)));
    // As saved before research narrowed: an architecture lab with an architecture offer.
    const saved = data.research.centers.find((x: { id: number }) => x.id === id);
    saved.field = 'architecture';
    saved.secondary = ['materials', 'water'];
    if (saved.offers[0]) saved.offers[0].field = 'architecture';
    const again = deserializeCity(data, { flatTerrain: 10 });
    const c = again.research.centers.get(id)!;
    expect(c.field).toBe('water');
    expect(c.secondary.every(isLiveField)).toBe(true);
    expect(c.offers.every((o) => isLiveField(o.field))).toBe(true);
    expect(again.buildings.get(id)!.style).toBe('lab:water');
  });
});

describe('the design loop in the goals', () => {
  it('asks the player to design, build a prototype, adopt a style and found a movement', () => {
    const ids = GOALS.map((g) => g.id);
    for (const id of ['design', 'prototype', 'adopt', 'movement']) expect(ids).toContain(id);
    expect(ids.indexOf('design')).toBeLessThan(ids.indexOf('prototype'));
    expect(ids.indexOf('prototype')).toBeLessThan(ids.indexOf('adopt'));
    const city = labTown();
    for (const i of IDEAS) city.design.learn(i.id);
    expect(goalComplete(city, 'design')).toBe(false);
    const sk = city.design.saveSketch({ text: 'a brick cottage', added: [], removed: [] });
    expect(goalComplete(city, 'design')).toBe(true);
    const sp = city.terrain.spawn;
    let ok = false;
    for (let k = 0; k < 40 && !ok; k++) ok = placePrototype(city, sk.id, sp.endX + 40 + k * 9, sp.endZ - 30).ok;
    expect(goalComplete(city, 'prototype')).toBe(true);
    expect(goalComplete(city, 'adopt')).toBe(false);
  });
});

describe('older saves', () => {
  it('a city saved before the Design Studio loads with everything it needs, plays on and saves again', () => {
    const city = loadFromJSON(OLD_SAVE);
    // The architects know the basics; nothing designed yet.
    expect(city.design.learned.has('brick')).toBe(true);
    expect(city.design.sketches).toEqual([]);
    expect(city.design.trials).toEqual([]);
    // Every household belongs to a taste group.
    const pop = city.population;
    let n = 0;
    for (let i = 0; i < pop.count; i++) if (pop.alive[i]) {
      expect(pop.taste[i]).toBeLessThan(GROUPS.length);
      n++;
    }
    expect(n).toBeGreaterThan(0);
    expect(city.people.shares().reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    // Its labs work only in the utility fields.
    for (const c of city.research.centers.values()) expect(isLiveField(c.field)).toBe(true);
    // It plays on, and saves and loads again as it was.
    fastForward(city, 24 * 35);
    expect(city.people.driversOf('heritage').length).toBeGreaterThan(0);
    const again = deserializeCity(JSON.parse(JSON.stringify(serializeCity(city))));
    expect(again.design.serialize()).toEqual(city.design.serialize());
    expect(again.people.serialize()).toEqual(city.people.serialize());
  });
});
