import { describe, expect, it } from 'vitest';
import { TREE_COST, clearTrees, plantTrees } from '../src/sim/CityCommands';
import { landValueMods } from '../src/sim/CitySim';
import { deserializeCity, serializeCity } from '../src/sim/save/Serializer';
import { TREE_GROW_DAYS } from '../src/sim/world/Nature';
import { makeCity, road } from './helpers';

describe('trees', () => {
  it('planting costs money and keeps clear of roads and other trees', () => {
    const city = makeCity({ empty: true });
    road(city, 1300, 1500, 1700, 1500, 'street');
    city.processRoadChanges();
    const money = city.economy.money;
    const before = city.nature.count;
    let planted = 0;
    for (let k = 0; k < 20; k++) planted += plantTrees(city, 1500, 1500, 40, 3).planted ?? 0;
    expect(planted).toBeGreaterThan(20);
    expect(city.nature.count - before).toBe(planted);
    expect(city.economy.money).toBe(money - planted * TREE_COST);
    for (let i = before; i < city.nature.count; i++) {
      const hit = city.roads.nearestSegment(city.nature.x[i], city.nature.z[i], 30);
      if (hit) expect(hit.proj.dist).toBeGreaterThan(5);
      for (let j = before; j < i; j++) {
        expect(Math.hypot(city.nature.x[i] - city.nature.x[j], city.nature.z[i] - city.nature.z[j])).toBeGreaterThan(4);
      }
    }
  });

  it('saplings grow to full size over two months', () => {
    const city = makeCity({ empty: true, unlimited: true });
    plantTrees(city, 1500, 1500, 20, 1);
    const i = city.nature.count - 1;
    const day = city.clock.day;
    expect(city.nature.growth(i, day)).toBeLessThan(0.5);
    expect(city.nature.growth(i, day + TREE_GROW_DAYS / 2)).toBeGreaterThan(0.6);
    expect(city.nature.growth(i, day + TREE_GROW_DAYS)).toBe(1);
  });

  it('woods clean the air, quiet roads and lift land value', () => {
    const city = makeCity({ empty: true, unlimited: true });
    road(city, 1300, 1500, 1700, 1500, 'avenue');
    city.processRoadChanges();
    const lv = city.landValue;
    const settle = () => {
      for (let k = 0; k < 4; k++) lv.update(city.buildings, city.roads, city.coverage, city.traffic, 1, [], landValueMods(city));
      return { value: lv.at(1500, 1560), noise: lv.noiseAt(1500, 1540) };
    };
    const bare = settle();
    for (let k = 0; k < 40; k++) plantTrees(city, 1500, 1560, 45, 4);
    const wooded = settle();
    expect(wooded.value).toBeGreaterThan(bare.value + 0.02);
    expect(wooded.noise).toBeLessThan(bare.noise);
  });

  it('clearing fells trees for a fee, and both survive save/load', () => {
    const city = makeCity({ empty: true, unlimited: true });
    for (let k = 0; k < 10; k++) plantTrees(city, 1500, 1500, 40, 3);
    for (let k = 0; k < 10; k++) plantTrees(city, 1800, 1500, 40, 3);
    const alive = city.nature.aliveCount();
    const res = clearTrees(city, 1500, 1500, 45);
    expect(res.ok).toBe(true);
    expect(res.removed).toBeGreaterThan(5);
    expect(city.nature.aliveCount()).toBe(alive - res.removed!);
    expect(clearTrees(city, 1500, 1500, 45).ok).toBe(false);
    const loaded = deserializeCity(JSON.parse(JSON.stringify(serializeCity(city))), { flatTerrain: 10 });
    expect(loaded.nature.aliveCount()).toBe(city.nature.aliveCount());
    expect(loaded.nature.countDisc(1800, 1500, 45)).toBe(city.nature.countDisc(1800, 1500, 45));
    expect(loaded.nature.countDisc(1500, 1500, 45)).toBe(0);
  });
});
