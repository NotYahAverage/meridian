import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/City';
import { fillZone, placePrototype, rebuildPrototype } from '../src/sim/CityCommands';
import { fastForward } from '../src/sim/CitySim';
import { IDEAS } from '../src/sim/design/Ideas';
import { type AdoptedStyle, globalShare, localChance, nextRevision, reachOf, saturation, styleName } from '../src/sim/design/Styles';
import type { Trial } from '../src/sim/design/Trials';
import { deserializeCity, serializeCity } from '../src/sim/save/Serializer';
import { Zone } from '../src/sim/types';
import { servicedGrid } from './helpers';

function town(): City {
  const city = new City({ name: 'Styles', seed: 1234, preset: 'lakes', flatTerrain: 10, unlimitedMoney: true });
  servicedGrid(city);
  for (const i of IDEAS) city.design.learn(i.id);
  return city;
}

function build(city: City, text: string, dx = 40, refines?: number): { trial: Trial; id: number } {
  const sk = city.design.saveSketch({ text, added: [], removed: [] }, undefined, refines);
  const sp = city.terrain.spawn;
  for (let k = 0; k < 40; k++) {
    const r = placePrototype(city, sk.id, sp.endX + dx + k * 9, sp.endZ - 30);
    if (r.ok) return { trial: city.design.trials[city.design.trials.length - 1], id: r.building!.id };
  }
  throw new Error(`could not place ${text}`);
}

/** Builds a design and runs its trial to the verdict. */
function tested(city: City, text: string, dx = 40): { trial: Trial; id: number } {
  const r = build(city, text, dx);
  fastForward(city, 24 * 30 * (r.trial.months + 1) + 24 * 2);
  expect(r.trial.state).toBe('done');
  return r;
}

const style = (over: Partial<AdoptedStyle> = {}): AdoptedStyle => ({ id: 1, trialId: 1, name: 'X style', x: 0, z: 0, street: '', day: 0, approval: 70, kinds: ['house'], push: 1, renovated: 0, ...over });

describe('styles from adopted designs', () => {
  it('are named after the design', () => {
    expect(styleName('The Brick Garden Block')).toBe('Brick Garden style');
    expect(styleName('The Little Brick House')).toBe('Little Brick style');
    expect(styleName('Lakeside Rows II')).toBe('Lakeside style');
    expect(styleName('Kelp')).toBe('Kelp style');
    expect(nextRevision('The Brick Garden Block')).toBe('The Brick Garden Block II');
    expect(nextRevision('The Brick Garden Block II')).toBe('The Brick Garden Block III');
  });

  it('spread further and faster the better they were liked, and keep a mix', () => {
    const loved = style({ approval: 85 }), meh = style({ approval: 45 });
    expect(reachOf(loved, 180)).toBeGreaterThan(reachOf(meh, 180));
    expect(reachOf(loved, 180)).toBeGreaterThan(reachOf(loved, 30));
    expect(localChance(loved, 50, 30)).toBeGreaterThan(localChance(meh, 50, 30));
    expect(localChance(loved, 5000, 30)).toBe(0);
    expect(globalShare(loved, 360)).toBeGreaterThan(globalShare(loved, 60));
    expect(saturation(loved)).toBeGreaterThan(saturation(meh));
    expect(saturation(loved)).toBeLessThan(1);
    const retired = style({ push: 0 });
    expect(reachOf(retired, 300)).toBe(0);
    expect(globalShare(retired, 300)).toBe(0);
  });

  it('adopting a design makes it a style new buildings near it take up', () => {
    const city = town();
    const { trial } = tested(city, 'white timber row houses with a green roof');
    const st = city.design.adopt(trial.id)!;
    expect(st).toBeTruthy();
    expect(trial.decision?.kind).toBe('adopted');
    expect(city.design.adopt(trial.id)).toBeNull();
    const m = city.style.get(st.id)!;
    expect(m.explicit).toBe(true);
    expect(m.wall).toBe(trial.concept.look.wall);
    expect(m.name).toBe(st.name);
    // New houses beside the prototype often follow it; offices never do; far away, nobody yet.
    let near = 0, office = 0, far = 0;
    for (let i = 1; i <= 200; i++) {
      if (city.style.pick({ seed: i * 7919, id: 100000 + i, style: 'house', cx: st.x + 40, cz: st.z }) === st.id) near++;
      if (city.style.pick({ seed: i * 7919, id: 100000 + i, style: 'office', cx: st.x + 40, cz: st.z }) === st.id) office++;
      if (city.style.pick({ seed: i * 7919, id: 100000 + i, style: 'house', cx: st.x + 3000, cz: st.z }) === st.id) far++;
    }
    expect(near).toBeGreaterThan(60);
    expect(office).toBe(0);
    expect(far).toBe(0);
  });

  it('owners nearby renovate in it month by month, up to its share of the neighbourhood', () => {
    const city = town();
    const sp = city.terrain.spawn;
    fillZone(city, sp.endX + 50, sp.endZ + 40, Zone.ResLow);
    fillZone(city, sp.endX + 150, sp.endZ + 40, Zone.ResLow);
    fastForward(city, 24 * 60);
    const { trial } = tested(city, 'white timber row houses with a green roof');
    const st = city.design.adopt(trial.id)!;
    const notices: string[] = [];
    city.events.on('notice', (n) => notices.push(n.title));
    fastForward(city, 24 * 30 * 4);
    expect(st.renovated).toBeGreaterThan(0);
    expect(notices.some((n) => n.includes('is spreading'))).toBe(true);
    const inStyle = city.design.styleCounts().get(st.id) ?? 0;
    expect(inStyle).toBeGreaterThanOrEqual(st.renovated);
    // Living in a well-liked style makes people happier.
    const b = [...city.buildings.all.values()].find((x) => x.movement === st.id)!;
    expect(city.design.moodBonus(b)).toBeGreaterThan(0);
    // Retired, it stops spreading.
    city.design.setPush(st.id, 0);
    const before = st.renovated;
    fastForward(city, 24 * 30 * 2);
    expect(st.renovated).toBe(before);
    expect(city.design.spreadAt(st.x, st.z, 'house')).toEqual([]);
    expect(city.design.buildsKind(st.id, 'house')).toBe(false);
  });

  it('a refined design is a revision: tested for less, and judged on whether complaints were answered', () => {
    const city = town();
    const first = tested(city, 'a 20-storey raw concrete tower');
    const sk = city.design.saveSketch({ text: 'a 20-storey timber tower with planted balconies', added: [], removed: [] }, 'The Concrete Tower II', first.trial.id);
    expect(sk.refines).toBe(first.trial.id);
    expect(sk.rev).toBe(2);
    expect(first.trial.decision).toEqual(expect.objectContaining({ kind: 'refined', sketchId: sk.id }));
    const r = rebuildPrototype(city, sk.id, first.trial.id);
    expect(r.ok, r.error).toBe(true);
    // In place of the first one.
    expect(city.buildings.get(first.id)).toBeUndefined();
    expect(Math.hypot(r.building!.cx - first.trial.x, r.building!.cz - first.trial.z)).toBeLessThan(25);
    const second = city.design.trials[city.design.trials.length - 1];
    expect(second.parent).toBe(first.trial.id);
    expect(second.months).toBe(Math.max(1, second.concept.ambition - 1));
    if (first.trial.reactions.some((x) => x.mood < -0.1 && x.month > 0 && !x.blame)) {
      expect(second.factors.some((f) => f.key === 'listened' || f.key === 'ignored')).toBe(true);
    }
    fastForward(city, 24 * 30 * (second.months + 1) + 24 * 2);
    expect(second.verdict?.summary).toMatch(/earlier version/);
  });

  it('scrapping shelves the design, and can take the building down', () => {
    const city = town();
    const a = tested(city, 'a brick cottage', 40);
    expect(city.design.scrap(a.trial.id)).toBe(true);
    expect(city.buildings.get(a.id)).toBeDefined();
    expect(city.design.sketches.find((k) => k.id === a.trial.sketchId)?.scrapped).toBe(true);
    const b = tested(city, 'a stone cottage', 160);
    city.design.scrap(b.trial.id, true);
    expect(city.buildings.get(b.id)).toBeUndefined();
    expect(b.trial.decision?.kind).toBe('scrapped');
  });

  it('styles are kept in the save and keep spreading', () => {
    const city = town();
    const { trial } = tested(city, 'white timber row houses with a green roof');
    const st = city.design.adopt(trial.id)!;
    fastForward(city, 24 * 30);
    const again = deserializeCity(JSON.parse(JSON.stringify(serializeCity(city))), { flatTerrain: 10 });
    expect(again.design.styles).toEqual(city.design.styles);
    expect(again.style.get(st.id)?.name).toBe(st.name);
    expect(again.design.spreadAt(st.x + 20, st.z, 'house').length).toBe(1);
    expect(again.design.trial(trial.id)?.decision?.kind).toBe('adopted');
  });
});
