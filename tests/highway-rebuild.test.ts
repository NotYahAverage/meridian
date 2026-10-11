import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/City';
import { buildRoad, bulldozeRoad, previewRoad, snap } from '../src/sim/CityCommands';

describe('rebuilding a demolished highway', () => {
  it('snaps to the loose map-edge entry and reconnects the city', () => {
    const city = new City({ name: 'Cutoff', seed: 77, preset: 'coastal', flatTerrain: 10, unlimitedMoney: true });
    const entry = [...city.roads.nodes.values()].find((n) => n.outside)!;
    expect(city.outsidePoint()).not.toBeNull();
    // Demolish every piece of the starting highway.
    for (const id of [...city.roads.segments.keys()]) bulldozeRoad(city, id);
    expect(city.outsidePoint()).toBeNull();
    expect(city.looseEntry()).toEqual({ x: entry.x, z: entry.z });
    // Clicking near (not on) the entry snaps to it, and the road may end at the map edge.
    const sp = city.terrain.spawn;
    const a = snap(city, entry.x + (sp.endX - entry.x) * 0.04, entry.z + (sp.endZ - entry.z) * 0.04 + 25, 'street');
    expect(a.kind).toBe('node');
    expect(a.nodeId).toBe(entry.id);
    const plan = previewRoad(city, 'street', a, snap(city, sp.endX, sp.endZ, 'highway'), null);
    expect(plan.error).toBeUndefined();
    expect(buildRoad(city, plan).ok).toBe(true);
    expect(city.outsidePoint()).not.toBeNull();
    expect(city.looseEntry()).toBeNull();
  });
});
