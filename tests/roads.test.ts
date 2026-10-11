import { describe, expect, it } from 'vitest';
import { bulldozeRoad, previewRoad, snap, upgradeRoad } from '../src/sim/CityCommands';
import { ROAD_TYPES } from '../src/sim/roads/RoadTypes';
import { makeCity, road } from './helpers';

describe('road network', () => {
  it('starts with a highway connected to the outside', () => {
    const city = makeCity();
    expect(city.roads.segments.size).toBe(2);
    const outside = [...city.roads.nodes.values()].filter((n) => n.outside);
    expect(outside.length).toBe(1);
    expect(city.outsidePoint()).not.toBeNull();
  });

  it('builds a straight road and charges for it', () => {
    const city = makeCity({ empty: true });
    const money = city.economy.money;
    const { plan, res } = road(city, 500, 500, 700, 500);
    expect(plan.valid).toBe(true);
    expect(res.ok).toBe(true);
    expect(city.roads.segments.size).toBe(1);
    expect(city.roads.nodes.size).toBe(2);
    expect(plan.cost).toBeCloseTo(200 * ROAD_TYPES.street.costPerMeter, -1);
    expect(city.economy.money).toBeCloseTo(money - plan.cost, 0);
  });

  it('connects to existing road ends by snapping', () => {
    const city = makeCity({ empty: true });
    road(city, 500, 500, 700, 500);
    road(city, 703, 502, 700, 700);
    expect(city.roads.nodes.size).toBe(3);
    const shared = [...city.roads.nodes.values()].find((n) => n.segs.length === 2);
    expect(shared).toBeDefined();
  });

  it('creates an intersection automatically when roads cross', () => {
    const city = makeCity({ empty: true });
    road(city, 500, 600, 900, 600);
    const { res } = road(city, 700, 400, 700, 800);
    expect(res.ok).toBe(true);
    // Each road is split at the crossing: 4 segments meeting at one 4-way node.
    expect(city.roads.segments.size).toBe(4);
    const junction = [...city.roads.nodes.values()].find((n) => n.segs.length === 4);
    expect(junction).toBeDefined();
    expect(junction!.x).toBeCloseTo(700, 0);
    expect(junction!.z).toBeCloseTo(600, 0);
    const lay = city.layout.get(junction!.id)!;
    expect(lay.kind).toBe('junction');
    expect(lay.control).toBe('yield');
    for (const a of lay.arms) expect(a.trim).toBeGreaterThan(5);
  });

  it('T-junction onto the middle of a road splits it', () => {
    const city = makeCity({ empty: true });
    road(city, 500, 600, 900, 600, 'avenue');
    road(city, 700, 601, 700, 800);
    expect(city.roads.segments.size).toBe(3);
    const node = [...city.roads.nodes.values()].find((n) => n.segs.length === 3)!;
    expect(city.layout.get(node.id)!.control).toBe('signal');
    expect(city.signals.states.has(node.id)).toBe(true);
  });

  it('builds curved roads', () => {
    const city = makeCity({ empty: true });
    const { plan, res } = road(city, 500, 500, 800, 500, 'street', { x: 650, z: 650 });
    expect(res.ok).toBe(true);
    expect(plan.length).toBeGreaterThan(330);
    const seg = [...city.roads.segments.values()][0];
    expect(seg.cz).toBeCloseTo(650, 0);
  });

  it('rejects invalid roads', () => {
    const city = makeCity({ empty: true });
    road(city, 500, 500, 900, 500);
    // Too short
    expect(previewRoad(city, 'street', snap(city, 600, 700, 'street'), snap(city, 604, 700, 'street'), null).valid).toBe(false);
    // Overlapping a parallel road
    const p = previewRoad(city, 'street', snap(city, 520, 503, 'street', false), snap(city, 880, 503, 'street', false), null);
    expect(p.valid).toBe(false);
    // Shallow crossing angle
    const sh = previewRoad(city, 'street', snap(city, 450, 470, 'street'), snap(city, 950, 530, 'street'), null);
    expect(sh.valid).toBe(false);
  });

  it('rejects roads when money runs out', () => {
    const city = makeCity({ empty: true });
    city.economy.money = 100;
    const p = previewRoad(city, 'street', snap(city, 500, 500, 'street'), snap(city, 800, 500, 'street'), null);
    expect(p.valid).toBe(false);
    expect(p.error).toMatch(/money/i);
  });

  it('bulldozes roads and cleans up orphan nodes', () => {
    const city = makeCity({ empty: true });
    road(city, 500, 600, 900, 600);
    road(city, 700, 400, 700, 800);
    const touches400 = (id: number) => Math.abs(city.roads.getNode(id).z - 400) < 1;
    const seg = [...city.roads.segments.values()].find((s) => touches400(s.a) || touches400(s.b))!;
    const before = city.economy.money;
    const r = bulldozeRoad(city, seg.id);
    expect(r.ok).toBe(true);
    expect(city.roads.segments.size).toBe(3);
    expect(city.economy.money).toBeGreaterThan(before);
    for (const n of city.roads.nodes.values()) expect(n.segs.length).toBeGreaterThan(0);
  });

  it('upgrades a street to an avenue', () => {
    const city = makeCity({ empty: true });
    road(city, 500, 500, 800, 500);
    const seg = [...city.roads.segments.values()][0];
    const res = upgradeRoad(city, seg.id, 'avenue');
    expect(res.ok).toBe(true);
    expect(seg.type).toBe('avenue');
    expect(seg.name).toMatch(/Avenue$/);
  });

  it('computes connected components', () => {
    const city = makeCity({ empty: true });
    road(city, 500, 500, 700, 500);
    road(city, 1500, 1500, 1700, 1500);
    const comps = new Set(city.roads.components().values());
    expect(comps.size).toBe(2);
  });
});
