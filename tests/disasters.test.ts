import { describe, expect, it } from 'vitest';
import { newBuilding } from '../src/sim/buildings/Buildings';
import { BuildingState, Zone } from '../src/sim/types';
import { makeCity, road } from './helpers';

function town() {
  const city = makeCity({ unlimited: true });
  const sp = city.terrain.spawn;
  const z0 = sp.endZ;
  road(city, sp.endX, z0, sp.endX + 800, z0, 'avenue');
  city.processRoadChanges();
  const hit = city.roads.nearestSegment(sp.endX + 400, z0 - 30, 60)!;
  const ids: number[] = [];
  for (let k = 0; k < 10; k++) {
    const b = newBuilding({
      kind: 'zoned', typeId: 'house_small', style: 'house', zone: Zone.ResLow, cx: sp.endX + 60 + k * 70, cz: z0 - 30, angle: 0, hw: 8, hd: 12, y: 10,
      state: BuildingState.Active, progress: 1, segId: hit.seg.id, hhCap: 1,
    });
    city.addBuilding(b);
    ids.push(b.id);
  }
  return { city, ids, x0: sp.endX, z0 };
}

describe('natural disasters', () => {
  it('never strike when disabled', () => {
    const { city } = town();
    city.weather.kind = 'storm';
    city.clock.tick = 24 * 30 * 4;
    for (let h = 0; h < 24 * 400; h++) city.disasters.tickHour();
    expect(city.disasters.tornado).toBeNull();
  });

  it('a tornado flattens what lies in its path and then passes', () => {
    const { city, ids, x0, z0 } = town();
    const seen: string[] = [];
    city.events.on('notice', (n) => seen.push(n.title));
    // Straight down the row of houses.
    city.disasters.start({ x: x0 - 200, z: z0 - 30, heading: 0 });
    expect(seen[0]).toMatch(/Tornado warning/);
    let steps = 0;
    while (city.disasters.tornado && steps++ < 2000) city.disasters.update(0.25);
    expect(city.disasters.tornado).toBeNull();
    const standing = ids.filter((id) => city.buildings.get(id)).length;
    expect(standing).toBeLessThan(ids.length);
    expect(seen[seen.length - 1]).toMatch(/passed/);
  });

  it('spares buildings far from its track', () => {
    const { city, ids, x0, z0 } = town();
    city.disasters.start({ x: x0 - 200, z: z0 - 600, heading: 0 });
    while (city.disasters.tornado) city.disasters.update(0.5);
    expect(ids.every((id) => city.buildings.get(id))).toBe(true);
  });
});
