import { describe, expect, it } from 'vitest';
import { rleDecode, rleEncode } from '../src/core/encoding';
import { fillZone, placeService } from '../src/sim/CityCommands';
import { fastForward } from '../src/sim/CitySim';
import { SAVE_VERSION, deserializeCity, migrate, serializeCity } from '../src/sim/save/Serializer';
import { Zone } from '../src/sim/types';
import { makeCity, road, servicedGrid } from './helpers';

describe('save / load', () => {
  it('RLE round-trips byte grids', () => {
    const a = new Uint8Array(100_000);
    for (let i = 0; i < a.length; i++) a[i] = (i / 997) % 7 | 0;
    expect(rleDecode(rleEncode(a), a.length)).toEqual(a);
  });

  it('round-trips a developed city', () => {
    const city = makeCity();
    servicedGrid(city);
    const sp = city.terrain.spawn;
    fillZone(city, sp.endX + 120, sp.endZ - 100, Zone.ResLow);
    fillZone(city, sp.endX + 180, sp.endZ - 100, Zone.ResMed);
    fillZone(city, sp.endX + 220, sp.endZ + 120, Zone.Commercial);
    placeService(city, 'fire_station', sp.endX + 320, sp.endZ - 140);
    city.districts.create('Test Quarter');
    city.districts.paint(sp.endX + 150, sp.endZ - 100, 80, 1);
    city.economy.setTax('commercial', 12);
    fastForward(city, 24 * 10);

    const data = serializeCity(city);
    const json = JSON.stringify(data);
    expect(data.version).toBe(SAVE_VERSION);
    const loaded = deserializeCity(JSON.parse(json), { flatTerrain: 10 });

    expect(loaded.name).toBe(city.name);
    expect(loaded.clock.tick).toBe(city.clock.tick);
    expect(loaded.roads.segments.size).toBe(city.roads.segments.size);
    expect(loaded.roads.nodes.size).toBe(city.roads.nodes.size);
    expect(loaded.buildings.count).toBe(city.buildings.count);
    expect(loaded.population.residents).toBe(city.population.residents);
    expect(loaded.population.employed).toBe(city.population.employed);
    expect(loaded.economy.money).toBeCloseTo(city.economy.money, 3);
    expect(loaded.economy.taxes.commercial).toBe(12);
    expect(loaded.zones.countZoned(Zone.ResLow)).toBe(city.zones.countZoned(Zone.ResLow));
    expect(loaded.districts.list.get(1)?.name).toBe('Test Quarter');
    expect(loaded.districts.at(sp.endX + 150, sp.endZ - 100)).toBe(1);
    for (const b of city.buildings.all.values()) {
      const o = loaded.buildings.get(b.id)!;
      expect(o).toBeDefined();
      expect(o.typeId).toBe(b.typeId);
      expect(o.cx).toBeCloseTo(b.cx, 2);
      expect(o.segId).toBe(b.segId);
      expect(o.households).toBe(b.households);
    }
    for (const s of city.roads.segments.values()) {
      const o = loaded.roads.getSegment(s.id);
      expect(o.type).toBe(s.type);
      expect(o.name).toBe(s.name);
      expect(o.length).toBeCloseTo(s.length, 1);
    }
  });

  it('a loaded city keeps simulating and can be extended', () => {
    const city = makeCity();
    servicedGrid(city);
    fastForward(city, 24 * 3);
    const loaded = deserializeCity(serializeCity(city), { flatTerrain: 10 });
    const before = loaded.roads.segments.size;
    const sp = loaded.terrain.spawn;
    const r = road(loaded, sp.endX + 400, sp.endZ, sp.endX + 400, sp.endZ + 300);
    expect(r.res.ok).toBe(true);
    expect(loaded.roads.segments.size).toBeGreaterThan(before);
    // New ids don't collide with loaded ones.
    expect(new Set(loaded.roads.segments.keys()).size).toBe(loaded.roads.segments.size);
    fastForward(loaded, 24);
    expect(loaded.clock.tick).toBe(city.clock.tick + 24);
  });

  it('rejects foreign or future files', () => {
    const city = makeCity({ empty: true });
    road(city, 500, 500, 800, 500);
    const data = serializeCity(city);
    expect(() => migrate({ ...data, format: 'nope' } as never)).toThrow();
    expect(() => migrate({ ...data, version: SAVE_VERSION + 1 })).toThrow(/newer/);
  });
});
