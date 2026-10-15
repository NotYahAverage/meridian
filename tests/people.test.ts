import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/City';
import { fillZone, placePrototype } from '../src/sim/CityCommands';
import { fastForward } from '../src/sim/CitySim';
import { compileConcept } from '../src/sim/design/Concept';
import { IDEAS } from '../src/sim/design/Ideas';
import { GROUPS, GROUP_BY_ID, foundingShares, likeOf, predictGroups, tastesOf } from '../src/sim/design/Tastes';
import { deserializeCity, serializeCity } from '../src/sim/save/Serializer';
import { makeMovement } from '../src/sim/style/Movements';
import { Zone } from '../src/sim/types';
import { servicedGrid } from './helpers';

const ALL = new Set(IDEAS.map((i) => i.id));
const BASE = makeMovement(5, 0, { green: 0, heavy: 0, ornate: 0, dense: 0, hand: 0 }, 0);
const concept = (text: string) => compileConcept({ text, added: [], removed: [] }, { civSeed: 9, day: 1, known: ALL, base: BASE });
const score = (text: string, id: string) => predictGroups(concept(text)).find((p) => p.id === id)!.score;

/** A small town with people living in it. */
function town(preset: 'lakes' | 'river' = 'lakes', civSeed?: number): City {
  const city = new City({ name: 'People', seed: 1234, preset, flatTerrain: 10, unlimitedMoney: true, civSeed });
  servicedGrid(city);
  for (const i of IDEAS) city.design.learn(i.id);
  const sp = city.terrain.spawn;
  for (let k = 0; k < 3; k++) fillZone(city, sp.endX + 50 + k * 100, sp.endZ + 40, Zone.ResLow);
  fastForward(city, 24 * 40);
  return city;
}

describe('taste groups', () => {
  it('every city has the same six groups in its own proportions', () => {
    const a = foundingShares(1, 'lakes'), b = foundingShares(2, 'lakes'), c = foundingShares(1, 'river');
    for (const s of [a, b, c]) expect(s.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 6);
    expect(a).not.toEqual(b);
    // Lakeside cities lean green; river towns lean heritage.
    const gi = GROUPS.findIndex((g) => g.id === 'green'), hi = GROUPS.findIndex((g) => g.id === 'heritage');
    expect(a[gi] / a[hi]).toBeGreaterThan(c[gi] / c[hi]);
  });

  it('see the same building differently', () => {
    const tower = 'a 14-storey raw concrete tower with prefab panels';
    expect(score(tower, 'modern')).toBeGreaterThan(score(tower, 'heritage'));
    expect(score(tower, 'heritage')).toBeLessThan(0);
    const garden = 'timber flats with planted balconies, a green roof and solar panels';
    expect(score(garden, 'green')).toBeGreaterThan(0.3);
    expect(score(garden, 'green')).toBeGreaterThan(score(garden, 'business'));
    const cheap = 'affordable row houses with balconies';
    expect(score(cheap, 'family')).toBeGreaterThan(score('luxury row houses', 'family'));
    const stone = 'an ornate stone block with a mansard roof';
    expect(score(stone, 'heritage')).toBeGreaterThan(score(stone, 'modern'));
    const glass = makeMovement(3, 1, { green: -0.2, heavy: -0.8, ornate: -0.5, dense: 0.5, hand: -0.8 }, 0);
    glass.wall = 'glass';
    expect(likeOf(GROUP_BY_ID.get('modern')!, glass)).toBeGreaterThan(likeOf(GROUP_BY_ID.get('heritage')!, glass));
    for (const g of GROUPS) {
      const t = tastesOf(g);
      expect(t.likes.length).toBeGreaterThan(0);
    }
  });

  it('every household belongs to one, in roughly the city’s mix', () => {
    const city = town();
    const pop = city.population;
    let n = 0;
    for (let i = 0; i < pop.count; i++) if (pop.alive[i]) {
      expect(pop.taste[i]).toBeLessThan(GROUPS.length);
      n++;
    }
    expect(n).toBeGreaterThan(5);
    const shares = city.people.shares();
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it('prototype reactions come from the groups, and verdicts break down by group', () => {
    const city = town();
    const sk = city.design.saveSketch({ text: 'a 14-storey raw concrete tower with prefab panels', added: [], removed: [] });
    const sp = city.terrain.spawn;
    let ok = false;
    for (let k = 0; k < 40 && !ok; k++) ok = placePrototype(city, sk.id, sp.endX + 40 + k * 9, sp.endZ - 30).ok;
    expect(ok).toBe(true);
    const t = city.design.trials[0];
    fastForward(city, 24 * 30 * (t.months + 1) + 48);
    expect(t.state).toBe('done');
    const groups = new Set(t.reactions.map((r) => r.group).filter(Boolean));
    expect(groups.size).toBeGreaterThan(1);
    const by = t.verdict!.byGroup!;
    expect(Object.keys(by)).toHaveLength(6);
    expect(by.modern!).toBeGreaterThan(by.heritage!);
  });

  it('adopting a style one group hates sours them and pleases its fans', () => {
    const city = town();
    const m = makeMovement(3, 1, { green: -0.3, heavy: 0.9, ornate: -0.5, dense: 0.6, hand: -0.6 }, 0);
    m.wall = 'beton';
    m.features = [];
    const before = { heritage: city.people.mood('heritage'), modern: city.people.mood('modern') };
    city.people.onAdopt(m);
    fastForward(city, 24 * 20);
    expect(city.people.mood('heritage')).toBeLessThan(before.heritage - 5);
    expect(city.people.mood('modern')).toBeGreaterThan(before.modern);
    expect(city.people.driversOf('heritage').some((d) => d.why.includes('against their taste'))).toBe(true);
  });

  it('unhappy groups petition; a promise kept wins them back, a broken one sends them marching', () => {
    const city = town();
    city.people.remember('green', -40, 'Test: a grim year');
    fastForward(city, 24 * 40);
    const p = city.people.petitions.find((x) => x.group === 'green');
    expect(p).toBeDefined();
    expect(city.people.stageOf('green')).toMatch(/petitioning|protesting/);
    city.people.answer(p!.id, true);
    expect(p!.state).toBe('promised');
    // Never done: the deadline passes and they protest.
    fastForward(city, 24 * 125);
    expect(p!.state).toMatch(/broken|kept/);
    if (p!.state === 'broken') {
      expect(city.people.memories.some((m) => m.why === 'The mayor broke a promise')).toBe(true);
      expect(city.notifications.recent.some((n) => n.title.includes('Promise broken'))).toBe(true);
    }
  });

  it('protests make nearby homes unhappier while they last', () => {
    const city = town();
    city.people.remember('locals', -70, 'Test: towers everywhere');
    fastForward(city, 24 * 60);
    const protest = city.people.protests[0] ?? null;
    if (!protest) {
      // Already over: it must have been reported.
      expect(city.notifications.recent.some((n) => /protest/i.test(n.title))).toBe(true);
      return;
    }
    const near = [...city.buildings.all.values()].find((b) => Math.hypot(b.cx - protest.x, b.cz - protest.z) < 200);
    if (near) expect(city.people.moodBonus(near)).toBeLessThan(city.people.moodBonus({ ...near, cx: near.cx + 5000, cz: near.cz + 5000 }));
    fastForward(city, 24 * 12);
    expect(city.people.protests.some((x) => x.id === protest.id)).toBe(false);
  });

  it('in the end the unhappiest move away', () => {
    const city = town();
    // A bigger neighbourhood, so each group is more than a household or two.
    const sp = city.terrain.spawn;
    for (let k = 0; k < 3; k++) fillZone(city, sp.endX + 50 + k * 100, sp.endZ - 60, Zone.ResMed);
    fastForward(city, 24 * 60);
    // The biggest group, so there are enough of them to watch go.
    const g = GROUPS.map((x) => x.id).sort((a, b) => city.people.households(b) - city.people.households(a))[0];
    const before = city.people.households(g);
    expect(before).toBeGreaterThan(0);
    city.people.remember(g, -90, 'Test: everything went wrong');
    const st = city.people.state.get(g)!;
    for (let d = 0; d < 200 && !st.left; d += 10) {
      fastForward(city, 24 * 10);
    }
    expect(st.left).toBeGreaterThan(0);
    expect(city.notifications.recent.some((n) => n.title.includes('are leaving'))).toBe(true);
  });

  it('their mood is part of the city’s reputation for newcomers', () => {
    const city = town();
    for (const g of GROUPS) city.people.remember(g.id, 35, 'Test: a golden age');
    fastForward(city, 24 * 30);
    const rep = city.people.reputation();
    expect(rep.value).toBeGreaterThan(1);
    expect(rep.text).toMatch(/love/);
  });

  it('are kept in the save; older saves get groups for everyone', () => {
    const city = town();
    city.people.remember('heritage', -10, 'Test');
    fastForward(city, 24 * 10);
    const again = deserializeCity(JSON.parse(JSON.stringify(serializeCity(city))), { flatTerrain: 10 });
    expect(again.people.serialize()).toEqual(city.people.serialize());
    expect(again.people.shares()).toEqual(city.people.shares());
    const old = JSON.parse(JSON.stringify(serializeCity(city)));
    delete old.people;
    delete old.population.taste;
    const legacy = deserializeCity(old, { flatTerrain: 10 });
    const pop = legacy.population;
    for (let i = 0; i < pop.count; i++) if (pop.alive[i]) expect(pop.taste[i]).toBeLessThan(GROUPS.length);
  });
});
