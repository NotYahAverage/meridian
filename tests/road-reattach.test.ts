import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/City';
import { buildRoad, bulldozeRoad, previewRoad, snap } from '../src/sim/CityCommands';
import { Problem } from '../src/sim/types';
import { buildDemoCity } from '../src/game/demo';

describe('buildings find a rebuilt road', () => {
  it('clears "no road" when the road is put back', () => {
    const city: City = buildDemoCity(4242, 'coastal');
    const b = [...city.buildings.all.values()].find((q) => q.kind === 'zoned' && q.segId && city.roads.segments.get(q.segId)!.type === 'street')!;
    const seg = city.roads.getSegment(b.segId);
    const a = city.roads.getNode(seg.a), z = city.roads.getNode(seg.b);
    const type = seg.type;
    expect(bulldozeRoad(city, seg.id).ok).toBe(true);
    city.processRoadChanges();
    const alive = city.buildings.all.get(b.id);
    expect(alive, 'building should survive').toBeTruthy();
    if (!alive) return; // Lots that lose their road may be cleared; nothing to reattach then.
    expect(alive.segId).toBe(0);
    expect(alive.problems & Problem.NoRoad).toBeTruthy();
    const plan = previewRoad(city, type, snap(city, a.x, a.z, type), snap(city, z.x, z.z, type), null);
    expect(buildRoad(city, plan).ok).toBe(true);
    city.processRoadChanges();
    expect(alive.segId).not.toBe(0);
    expect(alive.problems & Problem.NoRoad).toBeFalsy();
  });
});
