import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/City';
import { deserializeCity, serializeCity } from '../src/sim/save/Serializer';
import { Zone } from '../src/sim/types';
import { terraform } from '../src/sim/world/Terraform';
import { makeCity, road } from './helpers';

const dab = (city: City, mode: 'raise' | 'lower' | 'level' | 'smooth', x: number, z: number, times = 1, radius = 40, target?: number) => {
  let last;
  for (let k = 0; k < times; k++) last = terraform(city, { mode, x, z, radius, strength: 1, target });
  return last!;
};

describe('terraforming', () => {
  it('raises open ground and charges for the earth moved', () => {
    const city = makeCity({ empty: true });
    const money = city.economy.money;
    const res = dab(city, 'raise', 1500, 1500, 3);
    expect(res.ok).toBe(true);
    expect(city.terrain.heightAt(1500, 1500)).toBeCloseTo(13, 1);
    expect(city.terrain.heightAt(1500, 1560)).toBeCloseTo(10, 3);
    expect(city.economy.money).toBeLessThan(money);
    // Price check leaves the ground alone.
    const before = city.terrain.heightAt(1500, 1500);
    const quote = terraform(city, { mode: 'raise', x: 1500, z: 1500, radius: 40, strength: 1 }, false);
    expect(quote.cost).toBeGreaterThan(0);
    expect(city.terrain.heightAt(1500, 1500)).toBe(before);
  });

  it('never moves ground under roads or buildings, and keeps road heights', () => {
    const city = makeCity({ empty: true, unlimited: true });
    road(city, 1200, 1500, 1800, 1500, 'avenue');
    city.processRoadChanges();
    const roadH = city.terrain.roadHeightAt(1500, 1500);
    const nearH = city.terrain.heightAt(1500, 1508);
    const res = dab(city, 'raise', 1500, 1500, 5, 30);
    expect(res.locked).toBeGreaterThan(0.3);
    expect(city.terrain.roadHeightAt(1500, 1500)).toBeCloseTo(roadH, 4);
    expect(city.terrain.heightAt(1500, 1508)).toBeCloseTo(nearH, 3);
    // Away from the road the ground does rise.
    dab(city, 'raise', 1500, 1600, 5, 30);
    expect(city.terrain.heightAt(1500, 1600)).toBeGreaterThan(14);
    expect(city.terrain.roadHeightAt(1500, 1500)).toBeCloseTo(roadH, 4);
  });

  it('digging below sea level makes water that cannot be zoned', () => {
    const city = makeCity({ empty: true, unlimited: true });
    road(city, 1200, 1500, 1800, 1500, 'street');
    city.processRoadChanges();
    city.zones.paintCircle(1500, 1530, 14, Zone.ResLow);
    expect(city.zones.zoneAt(1500, 1534)).toBe(Zone.ResLow);
    for (let k = 0; k < 16; k++) terraform(city, { mode: 'lower', x: 1500, z: 1560, radius: 44, strength: 1.5 });
    expect(city.terrain.isWater(1500, 1560)).toBe(true);
    expect(city.terrain.shoreDistanceAt(1500, 1560)).toBe(0);
    expect(city.zones.zoneAt(1500, 1556)).toBe(Zone.None);
    expect(city.zones.paintCircle(1500, 1560, 6, Zone.ResLow)).toBe(0);
  });

  it('levels ground toward a target height', () => {
    const city = makeCity({ empty: true, unlimited: true });
    dab(city, 'raise', 1500, 1500, 6, 60);
    dab(city, 'level', 1500, 1500, 12, 60, 10);
    expect(Math.abs(city.terrain.heightAt(1500, 1500) - 10)).toBeLessThan(0.3);
  });

  it('refuses when the city cannot pay', () => {
    const city = makeCity({ empty: true });
    city.economy.money = 5;
    const res = dab(city, 'raise', 1500, 1500, 1, 60);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/money/);
    expect(city.terrain.heightAt(1500, 1500)).toBe(10);
  });

  it('leaves bare soil that grass reclaims within about a month', () => {
    const city = makeCity({ empty: true, unlimited: true });
    dab(city, 'raise', 1500, 1500, 3, 40);
    const i = Math.round(1500 / 4) * city.terrain.soil.length ** 0.5 + Math.round(1500 / 4);
    expect(city.terrain.soil[i]).toBeGreaterThan(200);
    const data = JSON.parse(JSON.stringify(serializeCity(city)));
    expect(deserializeCity(data, { flatTerrain: 10 }).terrain.soil[i]).toBe(city.terrain.soil[i]);
    for (let d = 0; d < 20; d++) city.terrain.regrow(9);
    expect(city.terrain.soil[i]).toBeGreaterThan(0);
    for (let d = 0; d < 10; d++) city.terrain.regrow(9);
    expect(city.terrain.soil[i]).toBe(0);
    expect(city.terrain.hasSoil).toBe(false);
  });

  it('clears trees on reshaped ground and survives save/load exactly', () => {
    const city = new City({ name: 'Hills', seed: 77, preset: 'lakes', empty: true, unlimitedMoney: true });
    // Find a wooded spot well away from the start.
    let tx = 0, tz = 0;
    const nat = city.nature;
    for (let i = 0; i < nat.count; i++) {
      if (nat.alive[i] && Math.hypot(nat.x[i] - 1900, nat.z[i] - 1900) < 500 && city.terrain.sampleBase(nat.x[i], nat.z[i]) > 6) {
        tx = nat.x[i];
        tz = nat.z[i];
        break;
      }
    }
    expect(tx).toBeGreaterThan(0);
    const aliveBefore = nat.aliveCount();
    for (let k = 0; k < 4; k++) terraform(city, { mode: 'raise', x: tx, z: tz, radius: 50, strength: 1 });
    terraform(city, { mode: 'smooth', x: tx + 30, z: tz, radius: 50, strength: 1 });
    expect(nat.aliveCount()).toBeLessThan(aliveBefore);
    const data = JSON.parse(JSON.stringify(serializeCity(city)));
    expect(data.terrainEdits.base.length).toBeGreaterThan(0);
    const loaded = deserializeCity(data);
    for (const [x, z] of [[tx, tz], [tx + 30, tz], [tx - 20, tz + 25], [tx + 60, tz - 10]]) {
      expect(loaded.terrain.heightAt(x, z)).toBeCloseTo(city.terrain.heightAt(x, z), 3);
      expect(loaded.terrain.roadHeightAt(x, z)).toBeCloseTo(city.terrain.roadHeightAt(x, z), 3);
    }
    expect(loaded.nature.aliveCount()).toBe(nat.aliveCount());
  });
});
