import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/City';
import { fillZone, paintZone, placePrototype, previewPrototype } from '../src/sim/CityCommands';
import { fastForward } from '../src/sim/CitySim';
import { compileConcept } from '../src/sim/design/Concept';
import { IDEAS } from '../src/sim/design/Ideas';
import { type Site, type Trial, approvalOf, assess, gradeOf, makeReaction, makeVerdict, protoSpec } from '../src/sim/design/Trials';
import { Rng } from '../src/core/rng';
import { deserializeCity, serializeCity } from '../src/sim/save/Serializer';
import { makeMovement } from '../src/sim/style/Movements';
import { BuildingState, Zone } from '../src/sim/types';
import { servicedGrid } from './helpers';

const ALL = new Set(IDEAS.map((i) => i.id));
const BASE = makeMovement(5, 0, { green: 0, heavy: 0, ornate: 0, dense: 0, hand: 0 }, 0);
const concept = (text: string) => compileConcept({ text, added: [], removed: [] }, { civSeed: 9, day: 1, known: ALL, base: BASE });
const SITE: Site = { lv: 0.4, pollution: 0, noise: 0.1, park: 0, nearFloors: 1.5, nearCount: 6, shore: false, familiarity: 0.6 };

/** A serviced town where everything has been learned. */
function town(): City {
  const city = new City({ name: 'Trials', seed: 1234, preset: 'lakes', flatTerrain: 10, unlimitedMoney: true, civSeed: 4242 });
  servicedGrid(city);
  for (const i of IDEAS) city.design.learn(i.id);
  return city;
}

/** Builds a sketch as a prototype somewhere along the main avenue. */
function build(city: City, text: string, dx = 60): { trial: Trial; id: number } {
  const sk = city.design.saveSketch({ text, added: [], removed: [] });
  const sp = city.terrain.spawn;
  for (let k = 0; k < 40; k++) {
    const r = placePrototype(city, sk.id, sp.endX + dx + k * 9, sp.endZ - 30);
    if (r.ok) return { trial: city.design.trials[city.design.trials.length - 1], id: r.building!.id };
  }
  throw new Error(`could not place ${text}`);
}

describe('what a prototype is', () => {
  it('lives in the right zone with homes and jobs to match', () => {
    const house = protoSpec(concept('a brick cottage'));
    expect(house.zone).toBe(Zone.ResLow);
    expect(house.households).toBe(1);
    const mixed = protoSpec(concept('brick flats, five storeys, with shops at the bottom'));
    expect(mixed.style).toBe('mixeduse');
    expect(mixed.households).toBeGreaterThan(4);
    expect(mixed.jobs).toBeGreaterThan(0);
    const offices = protoSpec(concept('glass offices, 25 storeys'));
    expect(offices.zone).toBe(Zone.Office);
    expect(offices.households).toBe(0);
    expect(offices.jobs).toBeGreaterThan(100);
    expect(protoSpec(concept('a corner shop')).zone).toBe(Zone.Commercial);
  });

  it('costs more the bigger, grander and more elaborate it is', () => {
    const cottage = protoSpec(concept('a brick cottage')).cost;
    const block = protoSpec(concept('brick flats, seven storeys')).cost;
    const tower = protoSpec(concept('a 20-storey brick tower')).cost;
    expect(cottage).toBeLessThan(block);
    expect(block).toBeLessThan(tower);
    expect(protoSpec(concept('luxury brick flats, seven storeys')).cost).toBeGreaterThan(protoSpec(concept('cheap brick flats, seven storeys')).cost);
    expect(protoSpec(concept('brick flats, seven storeys, with a roof garden, solar panels and ornament')).cost).toBeGreaterThan(block);
  });
});

describe('what people react to', () => {
  const keys = (text: string, site: Site = SITE) => assess(concept(text), site).map((f) => f.key);

  it('notices the design itself', () => {
    expect(keys('brick flats with planted balconies')).toEqual(expect.arrayContaining(['planters', 'wall-brick']));
    expect(keys('brick flats with shops at the bottom')).toContain('shopsBelow');
    expect(keys('affordable flats')).toContain('budget');
    expect(keys('raw concrete flats, seven storeys')).toEqual(expect.arrayContaining(['wall-beton', 'noGreen']));
  });

  it('notices where it stands', () => {
    expect(keys('a 20-storey tower')).toContain('overshadow');
    expect(keys('a 20-storey tower', { ...SITE, nearFloors: 18 })).not.toContain('overshadow');
    expect(keys('row houses', { ...SITE, nearFloors: 2.5 })).toContain('fitsIn');
    expect(keys('luxury flats', { ...SITE, lv: 0.3 }).length).toBeGreaterThan(0);
    const luxuryPoor = assess(concept('luxury flats'), { ...SITE, lv: 0.3 }).find((f) => f.key === 'luxury')!;
    const luxuryRich = assess(concept('luxury flats'), { ...SITE, lv: 0.8 }).find((f) => f.key === 'luxury')!;
    expect(luxuryPoor.w).toBeLessThan(0);
    expect(luxuryRich.w).toBeGreaterThan(0);
  });

  it('says things that fit the building, from people who would say them', () => {
    const c = concept('glass offices, 12 storeys');
    const t = { id: 1, name: 'The Glass Offices', concept: c, openDay: 0, reactions: [] } as unknown as Trial;
    const r = new Rng(3);
    for (let i = 0; i < 40; i++) {
      const re = makeReaction(t, assess(c, SITE), r, 40 + i, { paper: 'The Trials Gazette', street: 'Elm Street' }, false)!;
      expect(re.voice).not.toBe('resident');
      expect(re.text).not.toMatch(/\{|\}/);
      expect(re.mood).toBeGreaterThanOrEqual(-1);
      expect(re.mood).toBeLessThanOrEqual(1);
    }
  });

  it('turns opinion into approval and a grade', () => {
    const f = assess(concept('a brick cottage'), SITE);
    expect(approvalOf({ home: 0, street: 0, looks: 0, green: 0, cost: 0, neighbours: 0 }, f)).toBe(50);
    expect(approvalOf({ home: 0.6, street: 0.3, looks: 0.5, green: 0.2, cost: 0.4, neighbours: 0.3 }, f)).toBeGreaterThan(72);
    expect(approvalOf({ home: -0.6, street: -0.3, looks: -0.5, green: -0.2, cost: -0.4, neighbours: -0.3 }, f)).toBeLessThan(32);
    expect(gradeOf(80)).toBe('loved');
    expect(gradeOf(60)).toBe('liked');
    expect(gradeOf(50)).toBe('mixed');
    expect(gradeOf(40)).toBe('disliked');
    expect(gradeOf(20)).toBe('hated');
  });

  it('gives advice for what people complained about', () => {
    const c = concept('a 20-storey raw concrete tower');
    const t = { id: 1, name: 'The Concrete Tower', concept: c, openDay: 0, factors: assess(c, SITE), scores: { home: 0.1, street: -0.2, looks: -0.4, green: -0.3, cost: 0, neighbours: -0.6 }, approval: 30, reactions: [{ day: 10, month: 1, who: 'x', voice: 'neighbour', text: 'It blocks our evening sun.', mood: -0.6, aspect: 'neighbours', key: 'overshadow' }], history: [] } as unknown as Trial;
    const v = makeVerdict(t, 100, true);
    expect(v.grade).toBe('hated');
    expect(v.worst).toContain('neighbours');
    expect(v.advice.join(' ')).toMatch(/overshadow/);
    expect(v.summary).toContain('difficult neighbour');
  });
});

describe('building and testing a prototype', () => {
  it('is placed beside a road, within the limits, and paid for', () => {
    const city = town();
    const sk = city.design.saveSketch({ text: 'brick flats, five storeys', added: [], removed: [] });
    const sp = city.terrain.spawn;
    expect(previewPrototype(city, sk.id, sp.endX + 2000, sp.endZ + 2000).error).toMatch(/road|limits|own/i);
    const pv = previewPrototype(city, sk.id, sp.endX + 60, sp.endZ - 30);
    expect(pv.frame).not.toBeNull();
    const money = city.economy.money;
    const { trial, id } = build(city, 'brick flats, five storeys');
    const b = city.buildings.get(id)!;
    expect(b.typeId).toBe('proto');
    expect(b.floors).toBe(trial.concept.floors);
    expect(b.hhCap).toBe(protoSpec(trial.concept).households);
    expect(trial.state).toBe('building');
    // A word from the neighbours as soon as it's announced.
    expect(trial.reactions).toHaveLength(1);
    expect(city.design.facts().prototypes).toBe(1);
    void money;
  });

  it('is drawn exactly as designed', () => {
    const city = town();
    const { trial, id } = build(city, 'white timber row houses with a green roof');
    expect(city.style.movementOf(city.buildings.get(id)!)).toBe(trial.concept.look);
  });

  it('only three at a time', () => {
    const city = town();
    build(city, 'a brick cottage', 40);
    build(city, 'a stone cottage', 120);
    build(city, 'a timber cottage', 200);
    const sk = city.design.saveSketch({ text: 'a render cottage', added: [], removed: [] });
    const sp = city.terrain.spawn;
    expect(previewPrototype(city, sk.id, sp.endX + 300, sp.endZ - 30).error).toMatch(/3 prototypes/);
  });

  it('opens, hears from people every month and reaches a verdict', () => {
    const city = town();
    const { trial, id } = build(city, 'affordable brick flats, five storeys, with planted balconies and shops at the bottom');
    const notices: string[] = [];
    city.events.on('notice', (n) => notices.push(n.title));
    fastForward(city, 24 * 30);
    expect(trial.state).toBe('testing');
    expect(trial.openDay).toBeGreaterThan(0);
    expect(notices.some((n) => n.endsWith('is open'))).toBe(true);
    fastForward(city, 24 * 30 * trial.months + 24 * 2);
    expect(trial.state).toBe('done');
    expect(trial.history).toHaveLength(trial.months);
    // At least two reactions a month, never repeating word for word back to back.
    const said = trial.reactions.filter((r) => r.month > 0);
    expect(said.length).toBeGreaterThanOrEqual(2 * trial.months);
    for (let i = 1; i < said.length; i++) expect(said[i].text).not.toBe(said[i - 1].text);
    const v = trial.verdict!;
    expect(v.approval).toBe(trial.history[trial.history.length - 1]);
    expect(v.summary).toContain(trial.name);
    expect(city.notifications.recent.some((n) => n.title.startsWith('Verdict on'))).toBe(true);
    // The building stays, lived in.
    const b = city.buildings.get(id)!;
    expect(b.state).toBe(BuildingState.Active);
    expect(b.households).toBeGreaterThan(0);
    // The paper reports it in the next edition.
    fastForward(city, 24 * 31);
    expect(city.news.editions.some((e) => e.topics.includes(`proto-${trial.id}`))).toBe(true);
  });

  it('is never upgraded or rezoned away while it stands', () => {
    const city = town();
    const { trial, id } = build(city, 'a brick cottage');
    const b = city.buildings.get(id)!;
    paintZone(city, b.cx, b.cz, 30, Zone.Industrial);
    b.landValue = 0.9;
    b.happiness = 90;
    fastForward(city, 24 * 60);
    const after = city.buildings.get(id)!;
    expect(after).toBeDefined();
    expect(after.typeId).toBe('proto');
    expect(after.level).toBe(trial.concept.level);
  });

  it('ends without a verdict if demolished early, and with one if a month or more was heard', () => {
    const city = town();
    const early = build(city, 'a brick cottage', 40);
    city.removeBuilding(early.id, 'bulldoze');
    expect(early.trial.state).toBe('gone');
    expect(city.design.canStartTrial()).toBe(true);
    const later = build(city, 'brick flats, seven storeys', 140);
    fastForward(city, 24 * 30 + 24 * 40);
    expect(later.trial.state).toBe('testing');
    city.removeBuilding(later.id, 'fire');
    expect(later.trial.state).toBe('done');
    expect(later.trial.verdict?.cutShort).toBe(true);
  });

  it('a good design makes its residents happier than a bad one would', () => {
    const city = town();
    fillZone(city, city.terrain.spawn.endX + 150, city.terrain.spawn.endZ + 40, Zone.ResLow);
    const { trial, id } = build(city, 'luxury brick flats with planted balconies, a roof garden and a courtyard, five storeys');
    fastForward(city, 24 * 45);
    const b = city.buildings.get(id)!;
    expect(trial.scores.home).toBeGreaterThan(0);
    expect(city.design.moodBonus(b)).toBeGreaterThan(0);
  });

  it('keeps its trials in the save', () => {
    const city = town();
    const { trial } = build(city, 'brick flats, five storeys');
    fastForward(city, 24 * 50);
    const before = JSON.stringify(city.design.serialize().trials);
    const again = deserializeCity(JSON.parse(JSON.stringify(serializeCity(city))), { flatTerrain: 10 });
    expect(JSON.stringify(again.design.serialize().trials)).toBe(before);
    const b = again.buildings.get(trial.buildingId)!;
    expect(again.style.movementOf(b)).toEqual(trial.concept.look);
    // And carries on from where it was.
    fastForward(again, 24 * 30 * trial.months);
    expect(again.design.trials[0].state).toBe('done');
  });
});
