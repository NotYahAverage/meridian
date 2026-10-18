import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/City';
import { placeService } from '../src/sim/CityCommands';
import { fastForward } from '../src/sim/CitySim';
import { type CivState, generateProposals, odds, outcomeOf } from '../src/sim/research/Generate';
import { RESOURCES } from '../src/sim/research/Knowledge';
import { servicedGrid } from './helpers';

const civ = (seed: number): CivState => ({ civSeed: seed, day: 1, tags: new Set(), discoveries: [], achieved: new Set(), insights: new Map(), components: [] });
const allResources = () => new Map(RESOURCES.map((r) => [r.id, { ok: true }]));
// An energy lab that doesn't otherwise work in water.
const energyLab = { id: 7, name: 'Volt Works', field: 'energy' as const, secondary: ['environment' as const], equipment: 1 };

describe('asking a utility lab for one kind of building', () => {
  it('puts proposals that can become it first, preferring ones that stand anywhere, even outside the lab’s fields', () => {
    for (const round of [1, 2, 3, 4, 5]) {
      let id = 0;
      const plain = generateProposals(civ(3), energyLab, { resources: allResources(), needs: {}, followups: [] }, round, () => `a${id++}`);
      expect(plain.some((p) => outcomeOf(p).build === 'water')).toBe(false);
      const asked = generateProposals(civ(3), energyLab, { resources: allResources(), needs: {}, followups: [], goal: 'water' }, round, () => `b${id++}`);
      const water = asked.filter((p) => outcomeOf(p).build === 'water');
      expect(water.length).toBeGreaterThanOrEqual(1);
      expect(water.length).toBeLessThanOrEqual(2);
      expect(water.some((p) => !outcomeOf(p).shore)).toBe(true);
      // Outside its fields it's harder.
      const o = odds(water[0], [], energyLab, civ(3), 0.5);
      expect(o.factors.some(([k, v]) => k.includes('Outside') && v < 0)).toBe(true);
    }
  });

  it('a lab re-sorts its proposals at once when told, without a fresh draw, and remembers the goal in saves', () => {
    const city = new City({ name: 'Lab', seed: 1234, preset: 'lakes', flatTerrain: 10, civSeed: 9 });
    city.economy.money = 3_000_000;
    servicedGrid(city);
    city.peakPopulation = 5000;
    const sp = city.terrain.spawn;
    expect(placeService(city, 'coal_plant', sp.endX + 150, sp.endZ - 60).ok).toBe(true);
    const lab = placeService(city, 'research_center', sp.endX + 250, sp.endZ - 60);
    expect(lab.ok).toBe(true);
    fastForward(city, 24 * 10);
    const r = city.research;
    const c = r.centers.get(lab.building!.id)!;
    const round = c.round;
    r.setGoal(c.id, 'water');
    expect(c.goal).toBe('water');
    expect(c.round).toBe(round);
    expect(c.offers.some((p) => outcomeOf(p).build === 'water')).toBe(true);
    // Back to anything, and to water again: the same proposals as before (no free rerolls).
    const titles = c.offers.map((p) => p.title).join('|');
    r.setGoal(c.id, undefined);
    r.setGoal(c.id, 'water');
    expect(c.offers.map((p) => p.title).join('|')).toBe(titles);
  });
});
