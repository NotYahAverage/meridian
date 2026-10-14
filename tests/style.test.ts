import { describe, expect, it } from 'vitest';
import { generateBuilding } from '../src/render/buildings/generators';
import { City } from '../src/sim/City';
import { fillZone } from '../src/sim/CityCommands';
import { fastForward } from '../src/sim/CitySim';
import { deserializeCity, serializeCity } from '../src/sim/save/Serializer';
import { STYLED_KINDS } from '../src/sim/style/CityStyle';
import { type Axes, FEATURE_BY_ID, makeMovement } from '../src/sim/style/Movements';
import { Zone } from '../src/sim/types';
import { servicedGrid } from './helpers';

const BRUTAL: Axes = { green: -0.3, heavy: 0.95, ornate: -0.4, dense: 0.6, hand: -0.5 };
const GREEN: Axes = { green: 0.9, heavy: 0.1, ornate: 0, dense: 0.3, hand: 0.1 };
const ORNATE: Axes = { green: 0, heavy: 0.3, ornate: 0.9, dense: 0.1, hand: 0.5 };
const TECH: Axes = { green: 0, heavy: -0.8, ornate: -0.4, dense: 0.5, hand: -0.8 };

describe('architectural movements', () => {
  it('are generated deterministically from the civilization and their place on the axes', () => {
    expect(makeMovement(77, 3, BRUTAL, 10)).toEqual(makeMovement(77, 3, BRUTAL, 10));
  });

  it('take their character from the axes', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const b = makeMovement(seed, 1, BRUTAL, 0);
      expect(['beton', 'stone']).toContain(b.wall);
      expect(b.features.some((f) => FEATURE_BY_ID.get(f)!.lean.heavy! > 0.5)).toBe(true);
      const g = makeMovement(seed, 1, GREEN, 0);
      expect(g.features.filter((f) => (FEATURE_BY_ID.get(f)!.lean.green ?? 0) > 0.5).length).toBeGreaterThanOrEqual(2);
      const o = makeMovement(seed, 1, ORNATE, 0);
      expect(o.features.includes('ornament') || o.windows.some((w) => w === 5 || w === 2)).toBe(true);
      const t = makeMovement(seed, 1, TECH, 0);
      expect(['glass', 'panel']).toContain(t.wall);
    }
  });

  it('come out differently in every city, even heading the same way', () => {
    const names = new Set<string>(), palettes = new Set<string>(), looks = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const m = makeMovement(seed * 7919, 1, GREEN, 0);
      names.add(m.name);
      palettes.add(m.wallColors.join());
      looks.add(`${m.wall}|${m.roof}|${m.massing}|${m.windows}|${m.features}`);
    }
    expect(names.size).toBe(12);
    expect(palettes.size).toBe(12);
    expect(looks.size).toBeGreaterThanOrEqual(6);
  });

  it('every city starts with its own vernacular, shaped by its land', () => {
    const lakes = new City({ name: 'A', seed: 1, preset: 'lakes', flatTerrain: 10, civSeed: 11 });
    const high = new City({ name: 'B', seed: 1, preset: 'highlands', flatTerrain: 10, civSeed: 11 });
    expect(lakes.style.movements).toHaveLength(1);
    expect(lakes.style.movements[0].local).toBe(true);
    expect(lakes.style.movements[0].name).toMatch(/Vernacular$/);
    expect(high.style.movements[0].axes.heavy).toBeGreaterThan(lakes.style.movements[0].axes.heavy);
  });
});

describe('a city’s style', () => {
  it('new buildings follow the blend, each one deterministically, and keep their movement', () => {
    const city = new City({ name: 'Blend', seed: 1234, preset: 'lakes', flatTerrain: 10, civSeed: 5 });
    city.economy.money = 5_000_000;
    servicedGrid(city);
    const brut = city.style.addMovement(BRUTAL, 3);
    expect(city.style.blend()[0].movement.id).toBe(brut.id);
    expect(city.style.blend()[0].share).toBeCloseTo(0.75, 5);
    const sp = city.terrain.spawn;
    fillZone(city, sp.endX + 120, sp.endZ - 100, Zone.ResMed);
    fastForward(city, 24 * 30);
    const zoned = [...city.buildings.all.values()].filter((b) => b.kind === 'zoned');
    expect(zoned.length).toBeGreaterThan(5);
    const share = zoned.filter((b) => b.movement === brut.id).length / zoned.length;
    expect(share).toBeGreaterThan(0.4);
    expect(zoned.every((b) => b.movement === 0 || b.movement === brut.id)).toBe(true);
    // Picking is a function of the building, not of when it is asked.
    for (const b of zoned.slice(0, 5)) expect(city.style.pick(b)).toBe(city.style.pick(b));
    // Restyling marks the building for redrawing.
    const one = zoned.find((b) => b.movement === 0) ?? zoned[0];
    city.buildings.flushChanges();
    city.style.restyle(one, brut.id);
    expect(one.movement).toBe(brut.id);
    expect(city.buildings.changes.get(one.id)).toBe('geometry');
  });

  it('is saved and restored with every building’s movement; older saves keep their classic look', () => {
    const city = new City({ name: 'Saved', seed: 1234, preset: 'lakes', flatTerrain: 10, civSeed: 6 });
    city.economy.money = 5_000_000;
    servicedGrid(city);
    city.style.addMovement(GREEN, 2);
    const sp = city.terrain.spawn;
    fillZone(city, sp.endX + 120, sp.endZ - 100, Zone.ResLow);
    fastForward(city, 24 * 20);
    const again = deserializeCity(JSON.parse(JSON.stringify(serializeCity(city))), { flatTerrain: 10 });
    expect(JSON.stringify(again.style.serialize())).toBe(JSON.stringify(city.style.serialize()));
    for (const b of city.buildings.all.values()) expect(again.buildings.get(b.id)!.movement).toBe(b.movement);
    const old = serializeCity(city);
    delete (old as { style?: unknown }).style;
    const legacy = deserializeCity(JSON.parse(JSON.stringify(old)), { flatTerrain: 10 });
    expect(legacy.style.movements).toHaveLength(1);
    expect(legacy.style.movements[0].local).toBe(true);
  });
});

describe('buildings drawn in a movement', () => {
  const SIZES: Record<string, [number, number, number, number]> = {
    house: [20, 32, 2, 2], modernHouse: [22, 34, 2, 3], townhouse: [30, 30, 3, 3], lowrise: [34, 36, 4, 2], midrise: [38, 38, 8, 3],
    shop: [20, 26, 2, 2], mixeduse: [30, 32, 5, 3], office: [40, 40, 10, 3], tower: [40, 40, 26, 3], officeTower: [40, 40, 30, 3], hotel: [40, 40, 16, 3],
  };

  it('every styled kind builds sound geometry in very different movements, and looks different from the classic', () => {
    for (const ax of [BRUTAL, GREEN, ORNATE, TECH]) {
      const look = makeMovement(4242, 1, ax, 0);
      for (const style of STYLED_KINDS) {
        const [w, d, floors, level] = SIZES[style];
        for (const seed of [1, 99]) {
          const geo = generateBuilding({ style: style as never, w, d, floors, level, seed, look }, 500, 500, 0.3, 12);
          for (let i = 0; i < geo.pos.length; i++) if (!Number.isFinite(geo.pos[i])) throw new Error(`${style} NaN`);
          expect(geo.vertexCount, style).toBeGreaterThan(40);
          expect(geo.vertexCount, style).toBeLessThan(12_000);
          const classic = generateBuilding({ style: style as never, w, d, floors, level, seed }, 500, 500, 0.3, 12);
          expect(geo.pos.length === classic.pos.length && geo.pos.every((v, i) => v === classic.pos[i]), style).toBe(false);
        }
      }
    }
  });

  it('carry the movement’s window family to the shader', () => {
    const look = makeMovement(4242, 1, BRUTAL, 0);
    const geo = generateBuilding({ style: 'midrise' as never, w: 38, d: 38, floors: 8, level: 3, seed: 5, look }, 0, 0, 0, 0);
    const seeds = new Set<number>();
    for (let i = 0; i < geo.vertexCount; i++) if (geo.pat[i * 4 + 3] >= 128) seeds.add(Math.floor((geo.pat[i * 4 + 3] - 128) / 16));
    expect([...seeds].every((t) => look.windows.includes(t))).toBe(true);
    expect(seeds.size).toBeGreaterThan(0);
  });
});
