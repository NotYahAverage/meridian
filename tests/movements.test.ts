import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/City';
import { fillZone, placePrototype, placeService } from '../src/sim/CityCommands';
import { fastForward, tourismIncome } from '../src/sim/CitySim';
import { COMBOS, mergeTraits } from '../src/sim/design/Combos';
import { compileConcept } from '../src/sim/design/Concept';
import { IDEAS } from '../src/sim/design/Ideas';
import { assess } from '../src/sim/design/Trials';
import { GROUP_BY_ID } from '../src/sim/design/Tastes';
import type { Trial } from '../src/sim/design/Trials';
import { deserializeCity, serializeCity } from '../src/sim/save/Serializer';
import { SERVICE_BY_ID } from '../src/sim/services/ServiceTypes';
import { makeMovement } from '../src/sim/style/Movements';
import { BuildingState, Zone } from '../src/sim/types';
import { servicedGrid } from './helpers';

const ALL = new Set(IDEAS.map((i) => i.id));
const BASE = makeMovement(5, 0, { green: 0, heavy: 0, ornate: 0, dense: 0, hand: 0 }, 0);
const concept = (text: string) => compileConcept({ text, added: [], removed: [] }, { civSeed: 9, day: 1, known: ALL, base: BASE });

const RECIPES: [string, string][] = [
  ['verticalForest', 'a really tall tower with trees on every balcony and sky gardens'],
  ['gardenCity', 'cosy row houses with green roofs and balconies'],
  ['megablock', 'cheap raw concrete flats, 12 storeys, with deep loggias and heavy monumental walls'],
  ['beauxArts', 'a stone block with carved ornament, a mansard roof and an arcade'],
  ['solarVillage', 'timber houses with solar panels and a green roof'],
  ['highTech', 'glass offices, 15 storeys, with overhangs and sun fins'],
  ['workersHousing', 'affordable prefab panel flats, mid-rise, with balconies'],
  ['arcology', 'a 30-storey skyscraper of homes over shops with sky gardens, solar panels and wind turbines'],
  ['marketStreet', 'brick shops with homes above and an arcade along the street'],
  ['hillside', 'stepped terraces covered in plants, mid-rise'],
];

function town(): City {
  const city = new City({ name: 'Movements', seed: 1234, preset: 'lakes', flatTerrain: 10, unlimitedMoney: true, civSeed: 4242 });
  servicedGrid(city);
  for (const i of IDEAS) city.design.learn(i.id);
  const sp = city.terrain.spawn;
  for (let k = 0; k < 4; k++) {
    fillZone(city, sp.endX + 50 + k * 100, sp.endZ + 40, Zone.ResLow);
    fillZone(city, sp.endX + 50 + k * 100, sp.endZ - 60, Zone.ResLow);
  }
  fastForward(city, 24 * 90);
  return city;
}

/** Builds a design, runs its trial and adopts it. */
function adopted(city: City, text: string, dx = 40): { trial: Trial; styleId: number } {
  const sk = city.design.saveSketch({ text, added: [], removed: [] });
  const sp = city.terrain.spawn;
  let ok = false;
  for (let k = 0; k < 60 && !ok; k++) ok = placePrototype(city, sk.id, sp.endX + dx + k * 9, sp.endZ - 30 - (k % 2) * 120).ok;
  if (!ok) throw new Error('no lot');
  const trial = city.design.trials[city.design.trials.length - 1];
  fastForward(city, 24 * 30 * (trial.months + 1) + 48);
  const st = city.design.adopt(trial.id);
  if (!st) throw new Error(`not adopted: ${trial.name} is ${trial.state} (${trial.verdict?.summary ?? 'no verdict'}) on day ${city.clock.day}, opened ${trial.openDay}, months ${trial.months}, decision ${trial.decision?.kind}`);
  return { trial, styleId: st.id };
}

/** Renovates houses into a style until it has n buildings. */
function spread(city: City, styleId: number, n: number): void {
  let k = 0;
  for (const b of city.buildings.all.values()) {
    if (k >= n) break;
    if (b.kind !== 'zoned' || b.typeId === 'proto' || b.style !== 'house' && b.style !== 'townhouse') continue;
    city.style.restyle(b, styleId);
    k++;
  }
}

/** Runs to the next month boundary (when styles spread and movements are born). */
function toMonthEnd(city: City): void {
  fastForward(city, 24 * (30 - (city.clock.day % 30)) + 30);
}

describe('combos', () => {
  it('are recognised from the right ideas together', () => {
    for (const [id, text] of RECIPES) expect(concept(text).combos, `${id}: ${text}`).toContain(id);
    expect(concept('a brick house').combos).toEqual([]);
    expect(COMBOS).toHaveLength(RECIPES.length);
  });

  it('are discovered once, when a design with one is saved or built', () => {
    const city = new City({ name: 'Combos', seed: 1234, preset: 'lakes', flatTerrain: 10 });
    for (const i of IDEAS) city.design.learn(i.id);
    const seen: string[] = [];
    city.events.on('design', (e) => e.type === 'combo' && seen.push(e.id));
    city.design.saveSketch({ text: RECIPES[1][1], added: [], removed: [] }, 'Greenhill Rows');
    city.design.saveSketch({ text: RECIPES[1][1], added: [], removed: [] }, 'Greenhill Rows II');
    expect(seen).toEqual(['gardenCity']);
    expect(city.design.found.get('gardenCity')?.design).toBe('Greenhill Rows');
    expect(city.notifications.recent.some((n) => n.title === 'Combo discovered: Garden City')).toBe(true);
  });

  it('draw people to a prototype, especially their fans', () => {
    const c = concept(RECIPES[0][1]);
    const f = assess(c, { lv: 0.4, pollution: 0, noise: 0.1, park: 0, nearFloors: 2, nearCount: 4, shore: false, familiarity: 0.5 });
    expect(f.some((x) => x.key === 'combo-verticalForest')).toBe(true);
    expect(GROUP_BY_ID.get('green')!.keys['combo-verticalForest']).toBeGreaterThan(0);
  });

  it('give an adopted style its traits', () => {
    expect(mergeTraits(['megablock']).capacity).toBeCloseTo(1.25);
    expect(mergeTraits(['megablock', 'workersHousing']).speed).toBeCloseTo(2.6);
    const city = town();
    const { styleId } = adopted(city, RECIPES[2][1]);
    const st = city.design.style(styleId)!;
    expect(st.combos).toContain('megablock');
    // A new building in the style holds more and goes up faster.
    const b = [...city.buildings.all.values()].find((x) => x.kind === 'zoned' && x.typeId !== 'proto' && x.hhCap > 0)!;
    const copy = { ...b, movement: styleId };
    city.design.onNewBuilding(copy);
    expect(copy.hhCap).toBe(Math.round(b.hhCap * 1.25));
    expect(copy.buildDays).toBeCloseTo(b.buildDays / 1.3);
  });

  it('can bring tourists and happiness', () => {
    const city = town();
    const { styleId } = adopted(city, RECIPES[3][1]);
    const before = city.design.tourism();
    spread(city, styleId, 6);
    city.design.styleCounts();
    fastForward(city, 24);
    expect(city.design.tourism()).toBeGreaterThan(before);
    const b = [...city.buildings.all.values()].find((x) => x.movement === styleId)!;
    expect(city.design.moodBonus(b)).toBeGreaterThan(0);
  });
});

describe('movements', () => {
  it('are born when adopted styles take hold, and give the city an identity', () => {
    const city = town();
    const zoned = [...city.buildings.all.values()].filter((b) => b.kind === 'zoned').length;
    expect(zoned).toBeGreaterThanOrEqual(15);
    const { styleId } = adopted(city, RECIPES[1][1]);
    expect(city.design.births).toHaveLength(0);
    spread(city, styleId, Math.max(15, Math.ceil(zoned * 0.25)));
    toMonthEnd(city);
    expect(city.design.births).toHaveLength(1);
    const born = city.design.births[0];
    expect(born.styles).toContain(styleId);
    expect(born.name.length).toBeGreaterThan(4);
    expect(born.manifesto.length).toBeGreaterThan(10);
    expect(city.design.identity()?.id).toBe(born.id);
    expect(city.notifications.recent.some((n) => n.title.startsWith('A movement is born'))).toBe(true);
    // Its fans remember the day.
    expect(city.people.memories.some((m) => m.why === `${born.name} was born`)).toBe(true);
    // Architecture tourism.
    expect(city.design.tourism()).toBeGreaterThanOrEqual(600);
  });

  it('commission a signature landmark, drawn in the movement and run like any landmark', () => {
    const city = town();
    const zoned = [...city.buildings.all.values()].filter((b) => b.kind === 'zoned').length;
    const { styleId } = adopted(city, RECIPES[1][1]);
    spread(city, styleId, Math.max(15, Math.ceil(zoned * 0.25)));
    toMonthEnd(city);
    const born = city.design.births[0];
    const st = city.design.commission(born.id, 'tower')!;
    expect(st.kind).toBe('landmark');
    expect(st.unique).toBe(true);
    expect(SERVICE_BY_ID.get(st.id)).toBe(st);
    expect(city.design.serviceTypes()).toContain(st);
    const tourismBefore = tourismIncome(city);
    const sp = city.terrain.spawn;
    let r = placeService(city, st.id, sp.endX + 350, sp.endZ - 140);
    for (let k = 0; k < 40 && !r.ok; k++) r = placeService(city, st.id, sp.endX + 120 + k * 12, sp.endZ - 140 - (k % 3) * 60);
    expect(r.ok, r.error).toBe(true);
    const b = r.building!;
    expect(b.floors).toBe(30);
    expect(b.movement).toBe(born.id);
    expect(city.style.movementOf(b)).toBe(city.style.get(born.id));
    // Only one.
    expect(placeService(city, st.id, sp.endX + 500, sp.endZ - 300).ok).toBe(false);
    fastForward(city, 24 * 40);
    expect(b.state).toBe(BuildingState.Active);
    expect(born.landmark?.opened).toBeDefined();
    expect(tourismIncome(city)).toBeGreaterThan(tourismBefore);
    // It survives a save: the building type is known before the buildings load.
    const again = deserializeCity(JSON.parse(JSON.stringify(serializeCity(city))), { flatTerrain: 10 });
    const b2 = again.buildings.get(b.id)!;
    expect(SERVICE_BY_ID.get(b2.typeId)?.name).toBe(st.name);
    expect(again.style.movementOf(b2)?.name).toBe(born.name);
    expect(again.design.births).toEqual(city.design.births);
    expect([...again.design.found.keys()]).toEqual([...city.design.found.keys()]);
  });

  it('styles going the same way join the movement; a different direction can found another', () => {
    const city = town();
    const zoned = [...city.buildings.all.values()].filter((b) => b.kind === 'zoned').length;
    const a = adopted(city, RECIPES[1][1], 40);
    spread(city, a.styleId, Math.max(15, Math.ceil(zoned * 0.25)));
    toMonthEnd(city);
    expect(city.design.births).toHaveLength(1);
    // Hold the first style still, so it doesn't renovate the second one's buildings back.
    city.design.setPush(a.styleId, 0);
    const b = adopted(city, RECIPES[4][1], 200);
    spread(city, b.styleId, 0);
    // Restyle a different set of buildings into the second style.
    let k = 0;
    for (const x of city.buildings.all.values()) {
      if (k >= Math.max(15, Math.ceil(zoned * 0.25))) break;
      if (x.kind !== 'zoned' || x.typeId === 'proto' || x.movement === a.styleId) continue;
      city.style.restyle(x, b.styleId);
      k++;
    }
    toMonthEnd(city);
    const births = city.design.births;
    // Garden City and Solar Village lean the same way: one movement, with both.
    if (births.length === 1) expect(births[0].styles).toEqual(expect.arrayContaining([a.styleId, b.styleId]));
    else expect(births[1].styles).toContain(b.styleId);
  });
});
