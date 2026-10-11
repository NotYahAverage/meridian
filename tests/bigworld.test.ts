import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/City';
import { CORE_OFFSET as O, CORE_SIZE, WORLD_SIZE } from '../src/sim/constants';
import { loadFromJSON } from '../src/sim/save/Serializer';
import { LAND_TILES } from '../src/sim/world/Land';
import OLD_SAVE from './fixtures/v2-city.save.json?raw';
import SIG_JSON from './fixtures/v2-city.sig.json?raw';

// A city saved by version 0.1 before the world grew (bench/migsig.ts made it), with its signature.
const SIG = JSON.parse(SIG_JSON) as {
  buildings: [number, number, number, number][];
  naturalRemoved: number;
  sampleTrees: [number, number, number][];
  planted: number;
  pop: number;
};

describe('the bigger world', () => {
  it('starts new cities in the middle, with the highway coming in from the world edge', () => {
    const city = new City({ name: 'Middle', seed: 9, preset: 'lakes', flatTerrain: 10 });
    const s = city.startPoint;
    expect(s.x > O && s.x < O + CORE_SIZE && s.z > O && s.z < O + CORE_SIZE).toBe(true);
    const edge = [...city.roads.nodes.values()].filter((n) => n.outside);
    expect(edge.length).toBe(1);
    expect(edge[0].x).toBe(0);
  });

  it('sells rings all the way out to the edge of the world', () => {
    const city = new City({ name: 'Rings', seed: 9, preset: 'lakes', flatTerrain: 10 });
    city.land.startAround(city.startPoint.x, city.startPoint.z);
    city.economy.money = 1e10;
    let rings = 0;
    while (city.land.nextRing) {
      expect(city.buyLandRing().ok).toBe(true);
      rings++;
    }
    expect(city.land.ownedCount).toBe(LAND_TILES * LAND_TILES);
    expect(rings).toBeGreaterThanOrEqual(5);
    expect(city.land.ownsPoint(10, 10) && city.land.ownsPoint(WORLD_SIZE - 10, WORLD_SIZE - 10)).toBe(true);
  });

  it('moves an older city into the middle of the world exactly as it was', () => {
    const city = loadFromJSON(OLD_SAVE);
    for (const [id, x, z, h] of SIG.buildings) {
      const b = city.buildings.get(id)!;
      expect(b, `building ${id}`).toBeTruthy();
      expect(b.cx).toBeCloseTo(x + O, 2);
      expect(b.cz).toBeCloseTo(z + O, 2);
      expect(city.terrain.heightAt(b.cx, b.cz)).toBeCloseTo(h, 1);
    }
    const nat = city.nature;
    // Natural trees keep their identities; the ones the player cleared stay gone.
    for (const [i, x, z] of SIG.sampleTrees) {
      expect(nat.alive[i]).toBe(1);
      expect(nat.x[i]).toBeCloseTo(x + O, 2);
      expect(nat.z[i]).toBeCloseTo(z + O, 2);
    }
    let removed = 0;
    for (let i = 0; i < nat.naturalCount; i++) if (!nat.alive[i]) removed++;
    // Only the highway's new stretch clears a few more.
    expect(removed).toBeGreaterThanOrEqual(SIG.naturalRemoved);
    expect(removed).toBeLessThan(SIG.naturalRemoved + 400);
    expect(nat.count - nat.naturalCount).toBe(SIG.planted);
    expect(city.population.residents).toBe(SIG.pop);
    // The highway now reaches the edge of the world, and the old map is the city's land.
    const edge = [...city.roads.nodes.values()].filter((n) => n.outside);
    expect(edge.length).toBe(1);
    expect(edge[0].x).toBe(0);
    expect(city.outsidePoint()).toBeTruthy();
    expect(city.land.ownedCount).toBe(36);
    expect(city.land.ownsPoint(O + 10, O + 10)).toBe(true);
    expect(city.land.ownsPoint(O - 10, O + 10)).toBe(false);
    expect(city.land.nextRing).toBeGreaterThan(0);
  });
});
