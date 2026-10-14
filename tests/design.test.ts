import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/City';
import { placeService } from '../src/sim/CityCommands';
import { type DesignInput, compileConcept } from '../src/sim/design/Concept';
import { type CityFacts, IDEAS, IDEA_BY_ID } from '../src/sim/design/Ideas';
import { interpret } from '../src/sim/design/Interpret';
import { deserializeCity, serializeCity } from '../src/sim/save/Serializer';
import { makeMovement } from '../src/sim/style/Movements';
import { servicedGrid } from './helpers';

const BASE = makeMovement(5, 0, { green: 0, heavy: 0, ornate: 0, dense: 0, hand: 0 }, 0);
const START = new Set(IDEAS.filter((i) => i.start).map((i) => i.id));
const ALL = new Set(IDEAS.map((i) => i.id));
const ctx = (known = ALL) => ({ civSeed: 99, day: 40, known, base: BASE });
const design = (text: string, more: Partial<DesignInput> = {}, known = ALL) => compileConcept({ text, added: [], removed: [], ...more }, ctx(known));
const ideas = (text: string) => interpret(text).mentions.filter((m) => 'idea' in m.target).map((m) => (m.target as { idea: string }).idea);

describe('reading what the player typed', () => {
  it('finds ideas by their everyday words, longest phrase first', () => {
    expect(ideas('a brick house with a pitched roof')).toEqual(expect.arrayContaining(['brick', 'house', 'gable']));
    expect(ideas('homes over shops')).toContain('mixed');
    expect(ideas('raw concrete')).toContain('concrete');
  });

  it('reads near spellings and says so', () => {
    const m = interpret('a brik cottage').mentions.find((x) => 'idea' in x.target && x.target.idea === 'brick');
    expect(m?.fuzzy).toBe('brik');
  });

  it('understands negation, intensity, placement and storey counts', () => {
    const neg = interpret('flats with no balconies').mentions.find((m) => 'balcony' in m.target);
    expect(neg?.negated).toBe(true);
    const strong = interpret('very modern').mentions.find((m) => 'idea' in m.target && m.target.idea === 'modern');
    expect(strong!.strength).toBeGreaterThan(1.2);
    const weak = interpret('a bit traditional').mentions.find((m) => 'idea' in m.target && m.target.idea === 'traditional');
    expect(weak!.strength).toBeLessThan(0.8);
    const roof = interpret('a garden on the roof').mentions.find((m) => 'garden' in m.target);
    expect(roof?.placement).toBe('roof');
    expect(interpret('a 12-storey block').floors).toBe(12);
    expect(interpret('twenty floors of offices').floors).toBe(20);
  });

  it('lists words it does not know, with a suggestion where it has one', () => {
    const u = interpret('a house with a swimming pool').unknown;
    expect(u.some((x) => /pool/i.test(x.word) || /pool/i.test(x.note ?? ''))).toBe(true);
  });

  it('does not mistake size words or building nouns for ideas', () => {
    expect(design('a big garden house').kind).toBe('house');
    expect(design('a stone block').look.massing).not.toBe('stacked');
    expect(design('a little brick house').kind).toBe('house');
  });
});

describe('compiling a design', () => {
  it('turns a description into a buildable building with a look', () => {
    const c = design('cheap concrete flats, really tall, with trees on the balconies and shops at the bottom');
    expect(c.use).toBe('mixed');
    expect(c.kind).toBe('tower');
    expect(c.height).toBe('sky');
    expect(c.floors).toBeGreaterThanOrEqual(21);
    expect(c.look.wall).toBe('beton');
    expect(c.look.features).toContain('planters');
    expect(c.look.explicit).toBe(true);
    expect(c.level).toBe(1);
    expect(c.description).toContain('over shops');
    expect(c.name).toMatch(/Tower$/);
    expect(c.ambition).toBeGreaterThanOrEqual(3);
  });

  it('is deterministic', () => {
    const text = 'white timber row houses with a green roof';
    expect(design(text)).toEqual(design(text));
  });

  it('takes storey counts and sizes from the words', () => {
    expect(design('a 7-storey brick block of flats').floors).toBe(7);
    expect(design('sleek glass offices, 25 storeys').kind).toBe('officeTower');
    expect(design('row houses').kind).toBe('townhouse');
    expect(design('a corner shop').kind).toBe('shop');
  });

  it('designs with what the architects know, and explains what is locked', () => {
    const c = design('a tall concrete tower with gardens on every floor', {}, START);
    expect(c.locked.map((x) => x.id)).toEqual(expect.arrayContaining(['tall', 'concrete', 'planters']));
    expect(c.height).toBe('mid');
    expect(c.kind).toBe('midrise');
    expect(c.chips.some((x) => x.id === 'mid' && x.source === 'auto')).toBe(true);
    expect(c.notes.join(' ')).toContain('can’t build towers yet');
    expect(c.look.wall).not.toBe('beton');
    expect(c.look.features).not.toContain('planters');
  });

  it('keeps ruled-out ideas out, even when the style would add them', () => {
    const c = design('a block of flats with no balconies');
    expect(c.blocked).toContain('balconies');
    expect(c.look.features).not.toContain('balconies');
  });

  it('resolves clashes and says why', () => {
    const sky = design('a low-rise block with sky gardens');
    expect(sky.look.features).not.toContain('skyGarden');
    expect(sky.look.features).toContain('roofGarden');
    expect(sky.notes.join(' ')).toContain('Sky gardens need a tower');
    const roof = design('a pitched roof skyscraper');
    expect(roof.look.roof).toBe('hip');
    const three = design('brick, stone and timber flats');
    expect(three.notes.join(' ')).toContain('Three materials');
    expect(three.look.base).toBeDefined();
  });

  it('applies cards added by hand, removals and swaps', () => {
    expect(design('white row houses', { added: ['greenroof', 'ornament'] }).look.roof).toBe('green');
    const noBrick = design('a brick house', { removed: ['brick'] });
    expect(noBrick.chips.some((x) => x.id === 'brick')).toBe(false);
    const swapped = design('concrete flats', { swaps: [['concrete', 'brick']] });
    expect(swapped.look.wall).toBe('brick');
    expect(swapped.chips.find((x) => x.id === 'brick')?.source).toBe('text');
    // A swap only lasts while the text still asks for the original.
    const later = design('timber row houses', { swaps: [['concrete', 'brick']] });
    expect(later.chips.some((x) => x.id === 'brick')).toBe(false);
    expect(later.look.wall).toBe('timber');
  });

  it('rates bold buildings as longer to test', () => {
    const small = design('a brick house');
    const bold = design('a 30-storey glass tower with sky gardens, wind turbines and a solar skin');
    expect(small.ambition).toBeGreaterThanOrEqual(1);
    expect(bold.ambition).toBeLessThanOrEqual(5);
    expect(bold.ambition).toBeGreaterThan(small.ambition);
  });
});

describe('learning ideas', () => {
  const facts = (f: Partial<CityFacts>): CityFacts => ({
    day: 1, population: 0, preset: 'lakes', industrial: 0, offices: 0, commercial: 0, townhouses: 0, dense: 0, towers: 0, parks: 0, bigPark: false, landmarks: 0,
    culture: false, solar: false, wind: false, station: false, bridge: false, shoreHomes: 0, relief: 0, forest: 0, smog: 0, powerShort: false, storm: false,
    richHomes: 0, prototypes: 0, ...f,
  });

  it('every locked idea has a way to learn it and a hint', () => {
    for (const i of IDEAS) {
      if (i.start) continue;
      expect(i.unlock, i.id).toBeDefined();
      expect(i.unlock!.hint.length, i.id).toBeGreaterThan(5);
      expect(i.unlock!.test(facts({})), i.id).toBe(false);
    }
  });

  it('unlocks from what happens in the city', () => {
    const t = (id: string, f: Partial<CityFacts>) => IDEA_BY_ID.get(id)!.unlock!.test(facts(f));
    expect(t('tall', { population: 2000 })).toBe(true);
    expect(t('tall', { population: 1999 })).toBe(false);
    expect(t('sky', { population: 8000, towers: 2 })).toBe(true);
    expect(t('greenroof', { parks: 3 })).toBe(true);
    expect(t('butterfly', { storm: true })).toBe(true);
    expect(t('concrete', { industrial: 12 })).toBe(true);
    expect(t('glass', { offices: 8 })).toBe(true);
    expect(t('wind', { wind: true })).toBe(true);
  });

  it('a city learns ideas as they happen, with a notice', () => {
    const city = new City({ name: 'Ideas', seed: 1234, preset: 'lakes', flatTerrain: 10 });
    expect(city.design.learned.has('wind')).toBe(false);
    expect(city.design.learned.has('butterfly')).toBe(false);
    const seen: string[] = [];
    city.events.on('design', (e) => e.type === 'idea' && seen.push(e.id));
    city.weather.kind = 'storm';
    city.design.daily();
    expect(city.design.learned.has('butterfly')).toBe(true);
    expect(seen).toContain('butterfly');
    city.weather.kind = 'clear';
    servicedGrid(city);
    city.design.daily();
    expect(city.design.learned.has('wind')).toBe(true);
    // Learned for good: it stays when the weather turns.
    expect(city.design.learned.has('butterfly')).toBe(true);
    // Nothing is announced twice.
    const n = seen.length;
    city.design.daily();
    expect(seen.length).toBe(n);
  });

  it('parks teach green roofs', () => {
    const city = new City({ name: 'Parks', seed: 1234, preset: 'lakes', flatTerrain: 10, unlimitedMoney: true });
    servicedGrid(city);
    const sp = city.terrain.spawn;
    for (let i = 0; i < 3; i++) {
      const r = placeService(city, 'pocket_park', sp.endX + 30 + i * 100, sp.endZ - 40);
      expect(r.ok, r.error).toBe(true);
    }
    city.design.daily();
    expect(city.design.facts().parks).toBeGreaterThanOrEqual(3);
    expect(city.design.learned.has('greenroof')).toBe(true);
  });
});

describe('the sketchbook', () => {
  it('saves designs as compiled, and keeps them and the learned ideas in the save', () => {
    const city = new City({ name: 'Sketches', seed: 1234, preset: 'lakes', flatTerrain: 10 });
    city.design.learn('tall');
    const sk = city.design.saveSketch({ text: 'a brick tower with balconies', added: [], removed: [] }, '  Canal Tower  ');
    expect(sk.name).toBe('Canal Tower');
    expect(sk.concept.name).toBe('Canal Tower');
    expect(sk.concept.kind).toBe('tower');
    city.design.saveSketch({ text: 'timber row houses', added: ['greenroof'], removed: [] });
    const before = city.design.serialize();
    const again = deserializeCity(JSON.parse(JSON.stringify(serializeCity(city))), { flatTerrain: 10 });
    expect(again.design.serialize()).toEqual(before);
    expect(again.design.sketches.map((s) => s.name)).toEqual(['Canal Tower', city.design.sketches[1].name]);
    // Saved designs are kept exactly, even if the interpreter changes later.
    expect(again.design.sketches[0].concept).toEqual(sk.concept);
    again.design.deleteSketch(sk.id);
    expect(again.design.sketches).toHaveLength(1);
    // New sketches don't reuse ids.
    expect(again.design.saveSketch({ text: 'a house', added: [], removed: [] }).id).not.toBe(sk.id);
  });

  it('older saves learn from their history quietly', () => {
    const city = new City({ name: 'Old', seed: 1234, preset: 'lakes', flatTerrain: 10 });
    servicedGrid(city);
    const data = JSON.parse(JSON.stringify(serializeCity(city)));
    delete data.design;
    const again = deserializeCity(data, { flatTerrain: 10 });
    for (const id of START) expect(again.design.learned.has(id)).toBe(true);
    expect(again.design.learned.has('wind')).toBe(true);
    expect(again.design.sketches).toEqual([]);
    expect(again.notifications.recent.filter((n) => n.title.startsWith('New idea'))).toEqual([]);
  });
});
