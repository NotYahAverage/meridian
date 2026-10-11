import { describe, expect, it } from 'vitest';
import { plantTrees } from '../src/sim/CityCommands';
import { deserializeCity, serializeCity } from '../src/sim/save/Serializer';
import { makeCity } from './helpers';

describe('achievements', () => {
  it('unlock once, announce themselves and survive save/load', () => {
    const city = makeCity({ empty: true, unlimited: true });
    const seen: string[] = [];
    city.events.on('achievement', (a) => seen.push(a.id));
    expect(city.achievements.check()).toEqual([]);
    for (let k = 0; k < 80 && city.achievements.counters.treesPlanted < 200; k++) plantTrees(city, 1500 + (k % 8) * 90, 1500 + Math.floor(k / 8) * 90, 45, 4);
    expect(city.achievements.counters.treesPlanted).toBeGreaterThanOrEqual(200);
    city.achievements.check();
    expect(seen).toContain('trees');
    expect(city.achievements.check()).toEqual([]);
    expect(seen.filter((id) => id === 'trees').length).toBe(1);
    const loaded = deserializeCity(JSON.parse(JSON.stringify(serializeCity(city))), { flatTerrain: 10 });
    expect(loaded.achievements.unlocked.has('trees')).toBe(true);
    expect(loaded.achievements.counters.treesPlanted).toBe(city.achievements.counters.treesPlanted);
  });

  it('track surpluses and storms through the counters', () => {
    const city = makeCity({ empty: true, unlimited: true });
    city.achievements.counters.surplusMonths = 12;
    city.achievements.counters.tornadoes = 1;
    const got = city.achievements.check().map((a) => a.id);
    expect(got).toEqual(expect.arrayContaining(['surplus', 'storm']));
  });
});
