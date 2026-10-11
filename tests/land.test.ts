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

  it('blocks roads on unowned land until the parcel is bought, at a rising price', () => {
    const city = limited();
    const land = city.land;
    const i = [...land.owned.keys()].find((k) => land.isBuyable(k))!;
    const c = Land.center(i);
    const plan = previewRoad(city, 'street', snap(city, c.x - 60, c.z, 'street', false), snap(city, c.x + 60, c.z, 'street', false), null);
    expect(plan.valid).toBe(false);
    expect(plan.error).toMatch(/own this land/);
    const money = city.economy.money;
    expect(land.price).toBe(LAND_BASE_PRICE);
    expect(city.buyLand(i).ok).toBe(true);
    expect(city.economy.money).toBe(money - LAND_BASE_PRICE);
    expect(land.price).toBeGreaterThan(LAND_BASE_PRICE);
    const ok = previewRoad(city, 'street', snap(city, c.x - 60, c.z, 'street', false), snap(city, c.x + 60, c.z, 'street', false), null);
    expect(ok.error).toBeUndefined();
    expect(buildRoad(city, ok).ok).toBe(true);
  });

  it('only sells parcels next to owned land and survives a save', () => {
    const city = limited();
    const far = [...city.land.owned.keys()].find((k) => !city.land.owned[k] && !city.land.isBuyable(k));
    if (far !== undefined) expect(city.buyLand(far).ok).toBe(false);
    const again = deserializeCity(serializeCity(city), { flatTerrain: 10 });
    expect([...again.land.owned]).toEqual([...city.land.owned]);
    // Older saves (no land data) own the whole map.
    const old = serializeCity(new City({ name: 'Old', seed: 3, preset: 'coastal', flatTerrain: 10 }));
    delete (old as { land?: unknown }).land;
    expect(deserializeCity(old, { flatTerrain: 10 }).land.allOwned).toBe(true);
    expect(LAND_TILE).toBe(512);
  });
});
