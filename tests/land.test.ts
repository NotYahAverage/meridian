import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/City';
import { buildRoad, previewRoad, snap } from '../src/sim/CityCommands';
import { LAND_BASE_PRICE, LAND_TILE, Land } from '../src/sim/world/Land';
import { deserializeCity, serializeCity } from '../src/sim/save/Serializer';

function limited(): City {
  const city = new City({ name: 'Parcels', seed: 31, preset: 'coastal', flatTerrain: 10 });
  const s = city.startPoint;
  city.land.startAround(s.x, s.z, [...city.roads.nodes.values()]);
  city.economy.money = 2_000_000;
  return city;
}

describe('land ownership', () => {
  it('starts with the land around the city and the highway', () => {
    const city = limited();
    expect(city.land.ownsPoint(city.startPoint.x, city.startPoint.z)).toBe(true);
    for (const n of city.roads.nodes.values()) expect(city.land.ownsPoint(Math.min(3071, n.x), Math.min(3071, n.z))).toBe(true);
    expect(city.land.allOwned).toBe(false);
  });

  it('blocks roads on unowned land until the ring around the city is bought, at a rising price', () => {
    const city = limited();
    const land = city.land;
    const ring = land.ringParcels;
    expect(ring.length).toBeGreaterThan(0);
    const i = ring[0];
    const c = Land.center(i);
    const plan = previewRoad(city, 'street', snap(city, c.x - 60, c.z, 'street', false), snap(city, c.x + 60, c.z, 'street', false), null);
    expect(plan.valid).toBe(false);
    expect(plan.error).toMatch(/own this land/);
    const money = city.economy.money;
    expect(land.price).toBe(LAND_BASE_PRICE);
    expect(city.buyLandRing().ok).toBe(true);
    expect(city.economy.money).toBe(money - LAND_BASE_PRICE);
    for (const k of ring) expect(land.owned[k]).toBe(1);
    expect(land.price).toBeGreaterThan(LAND_BASE_PRICE);
    const ok = previewRoad(city, 'street', snap(city, c.x - 60, c.z, 'street', false), snap(city, c.x + 60, c.z, 'street', false), null);
    expect(ok.error).toBeUndefined();
    expect(buildRoad(city, ok).ok).toBe(true);
  });

  it('sells rings from the inside out until the whole map is owned', () => {
    const city = limited();
    const land = city.land;
    city.economy.money = 1e9;
    let last = 1;
    while (land.nextRing) {
      const r = land.nextRing;
      expect(r).toBeGreaterThan(last);
      // Nothing outside the ring for sale is buyable yet.
      for (let i = 0; i < land.owned.length; i++) if (!land.owned[i]) expect(land.isBuyable(i)).toBe(land.ringOf(i) === r);
      expect(city.buyLandRing().ok).toBe(true);
      last = r;
    }
    expect(land.allOwned).toBe(true);
    expect(city.buyLandRing().ok).toBe(false);
  });

  it('survives a save', () => {
    const city = limited();
    expect(city.buyLandRing().ok).toBe(true);
    const again = deserializeCity(serializeCity(city), { flatTerrain: 10 });
    expect([...again.land.owned]).toEqual([...city.land.owned]);
    expect(again.land.price).toBe(city.land.price);
    expect(again.land.nextRing).toBe(city.land.nextRing);
    // Older saves (no land data) own the whole map.
    const old = serializeCity(new City({ name: 'Old', seed: 3, preset: 'coastal', flatTerrain: 10 }));
    delete (old as { land?: unknown }).land;
    expect(deserializeCity(old, { flatTerrain: 10 }).land.allOwned).toBe(true);
    expect(LAND_TILE).toBe(512);
  });
});
