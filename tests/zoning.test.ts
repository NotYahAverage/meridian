import { describe, expect, it } from 'vitest';
import { bulldozeRoad, fillZone, paintZone } from '../src/sim/CityCommands';
import { fastForward } from '../src/sim/CitySim';
import { BuildingState, Zone } from '../src/sim/types';
import { makeCity, road, servicedGrid } from './helpers';

describe('zoning', () => {
  it('only allows zoning near zonable roads', () => {
    const city = makeCity({ empty: true });
    road(city, 500, 500, 800, 500);
    // Far from any road: nothing changes.
    expect(paintZone(city, 650, 800, 20, Zone.ResLow).changed).toBe(0);
    // Next to the road: cells are painted.
    const r = paintZone(city, 650, 520, 16, Zone.ResLow);
    expect(r.changed).toBeGreaterThan(10);
    // Road surface itself is never zoned.
    expect(city.zones.zoneAt(650, 500)).toBe(Zone.None);
    expect(city.zones.zoneAt(650, 520)).toBe(Zone.ResLow);
  });

  it('does not allow zoning along highways', () => {
    const city = makeCity();
    const sp = city.terrain.spawn;
    const r = paintZone(city, (sp.edgeX + sp.endX) / 2, sp.endZ + 25, 16, Zone.ResLow);
    expect(r.changed).toBe(0);
  });

  it('fills one side of a street', () => {
    const city = makeCity({ empty: true });
    road(city, 500, 500, 800, 500);
    const r = fillZone(city, 650, 525, Zone.Commercial);
    expect(r.changed).toBeGreaterThan(400);
    expect(city.zones.countZoned(Zone.Commercial)).toBe(r.changed);
    expect(city.zones.zoneAt(650, 530)).toBe(Zone.Commercial);
    // The opposite side stays unzoned.
    expect(city.zones.zoneAt(650, 470)).toBe(Zone.None);
  });

  it('removes zoning when the road is removed', () => {
    const city = makeCity({ empty: true });
    road(city, 500, 500, 800, 500);
    fillZone(city, 650, 525, Zone.Industrial);
    expect(city.zones.countZoned(Zone.Industrial)).toBeGreaterThan(0);
    const seg = [...city.roads.segments.values()][0];
    bulldozeRoad(city, seg.id);
    expect(city.zones.countZoned(Zone.Industrial)).toBe(0);
  });

  it('respects zone unlocks', () => {
    const city = makeCity({ empty: true });
    road(city, 500, 500, 800, 500);
    expect(paintZone(city, 650, 520, 16, Zone.ResHigh).ok).toBe(false);
    city.peakPopulation = 3000;
    expect(paintZone(city, 650, 520, 16, Zone.ResHigh).ok).toBe(true);
  });
});

describe('building growth', () => {
  it('spawns buildings on zoned land once utilities exist', () => {
    const city = makeCity();
    servicedGrid(city);
    const sp = city.terrain.spawn;
    for (let k = 1; k <= 3; k++) {
      fillZone(city, sp.endX + k * 100 + 20, sp.endZ - 100, Zone.ResLow);
      fillZone(city, sp.endX + k * 100 - 20, sp.endZ - 100, Zone.ResLow);
    }
    fillZone(city, sp.endX + 120, sp.endZ + 120, Zone.Commercial);
    fillZone(city, sp.endX + 280, sp.endZ + 120, Zone.Industrial);
    fastForward(city, 24 * 15);
    const zoned = [...city.buildings.all.values()].filter((b) => b.kind === 'zoned');
    expect(zoned.length).toBeGreaterThan(10);
    // Buildings face the road with a real lot.
    for (const b of zoned) {
      expect(b.hw).toBeGreaterThan(5);
      expect(b.hd).toBeGreaterThan(8);
      expect(b.segId).toBeGreaterThan(0);
      expect(city.roads.segments.has(b.segId)).toBe(true);
    }
    // Lots never overlap and only sit on matching zones.
    const cells = new Map<number, number>();
    for (const b of zoned) {
      for (const i of city.zones.cellsInOBB({ cx: b.cx, cz: b.cz, angle: b.angle, hw: b.hw, hd: b.hd }, -1)) {
        expect(cells.has(i)).toBe(false);
        cells.set(i, b.id);
      }
    }
    const active = zoned.filter((b) => b.state === BuildingState.Active);
    expect(active.length).toBeGreaterThan(0);
    expect(city.population.residents).toBeGreaterThan(0);
  });

  it('does not grow without power and water', () => {
    const city = makeCity();
    const sp = city.terrain.spawn;
    road(city, sp.endX, sp.endZ, sp.endX + 300, sp.endZ);
    fillZone(city, sp.endX + 150, sp.endZ + 20, Zone.ResLow);
    fastForward(city, 24 * 5);
    expect(city.buildings.count).toBe(0);
    expect(city.growthBlocked.size + 1).toBeGreaterThan(0);
  });
});
