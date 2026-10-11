import { describe, expect, it } from 'vitest';
import { tickCity } from '../src/sim/CitySim';
import { TICKS_PER_DAY, TICKS_PER_MONTH } from '../src/sim/constants';
import { SCENARIOS, SCENARIO_BY_ID, checkScenario, formatMonths, monthsLeft } from '../src/sim/progress/Scenarios';
import { deserializeCity, serializeCity } from '../src/sim/save/Serializer';
import { MAP_PRESETS } from '../src/sim/world/Terrain';
import { makeCity } from './helpers';

describe('scenarios', () => {
  it('are well formed', () => {
    const ids = new Set<string>();
    for (const s of SCENARIOS) {
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      expect(MAP_PRESETS[s.preset]).toBeDefined();
      expect(s.objectives.length).toBeGreaterThan(0);
      expect(s.months).toBeGreaterThanOrEqual(12);
      expect(s.money).toBeGreaterThan(0);
    }
  });

  it('are won once every objective is met', () => {
    const city = makeCity({ empty: true });
    city.scenario = { id: 'first-steps', startMonth: 0, result: '' };
    const seen: string[] = [];
    city.events.on('scenario', (r) => seen.push(r.result));
    const def = SCENARIO_BY_ID.get('first-steps')!;
    expect(def.objectives.every((o) => o.progress(city) < 1)).toBe(true);
    expect(checkScenario(city)).toBe('');
    city.stats.population = 2400;
    city.stats.happiness = 74;
    const net = (v: number) => Object.defineProperty(city.economy, 'projectedNet', { value: v, configurable: true });
    net(5_000);
    expect(checkScenario(city)).toBe('');
    expect(def.objectives[2].detail(city)).toBe('+$5,000/mo');
    net(9_000);
    expect(checkScenario(city)).toBe('won');
    expect(city.scenario.result).toBe('won');
    // Decided once: no second announcement even if the city later slips.
    city.stats.population = 10;
    expect(checkScenario(city)).toBe('');
    expect(seen).toEqual(['won']);
  });

  it('are lost when the clock runs out, checked at month end', () => {
    const city = makeCity({ empty: true });
    city.clock.tick = 2 * TICKS_PER_MONTH;
    city.scenario = { id: 'first-steps', startMonth: city.clock.monthIndex, result: '' };
    expect(monthsLeft(city)).toBe(36);
    expect(formatMonths(monthsLeft(city))).toBe('3 years');
    city.clock.tick += 30 * TICKS_PER_MONTH + 5 * TICKS_PER_DAY;
    expect(formatMonths(monthsLeft(city))).toBe('6 months');
    // The tick before the final month closes.
    city.clock.tick = (2 + 36) * TICKS_PER_MONTH - 1;
    expect(monthsLeft(city)).toBe(1);
    const seen: string[] = [];
    city.events.on('scenario', (r) => seen.push(r.result));
    tickCity(city);
    expect(monthsLeft(city)).toBe(0);
    expect(city.scenario.result).toBe('lost');
    expect(seen).toEqual(['lost']);
  });

  it('count each bridge once, however many deck segments it has', () => {
    const city = makeCity({ empty: true });
    const bridges = SCENARIO_BY_ID.get('across-the-river')!.objectives[1];
    expect(bridges.detail(city)).toBe('0 / 2');
    const deck = (x: number) => {
      const n = [0, 1, 2, 3].map((k) => city.roads.addNode(x, 1000 + k * 40).id);
      for (let k = 0; k < 3; k++) city.roads.addSegment(n[k], n[k + 1], 'street', { elevated: k > 0 });
    };
    deck(1000);
    expect(bridges.detail(city)).toBe('1 / 2');
    deck(1400);
    expect(bridges.detail(city)).toBe('2 / 2');
    expect(bridges.progress(city)).toBe(1);
  });

  it('survive save and load', () => {
    const city = makeCity({ empty: true });
    city.scenario = { id: 'green-valley', startMonth: 3, result: '' };
    const loaded = deserializeCity(JSON.parse(JSON.stringify(serializeCity(city))), { flatTerrain: 10 });
    expect(loaded.scenario).toEqual({ id: 'green-valley', startMonth: 3, result: '' });
    const plain = deserializeCity(JSON.parse(JSON.stringify(serializeCity(makeCity({ empty: true })))), { flatTerrain: 10 });
    expect(plain.scenario).toBeNull();
  });
});
