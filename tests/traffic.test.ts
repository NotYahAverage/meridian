import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/City';
import { Pathfinder } from '../src/sim/traffic/Pathfinder';
import { TrafficModel } from '../src/sim/traffic/TrafficModel';
import { Purpose, VM } from '../src/sim/traffic/Vehicles';
import { makeCity, road } from './helpers';

function grid(city: City) {
  // 3x3 street grid, 200 m blocks.
  for (let i = 0; i < 3; i++) road(city, 400, 400 + i * 200, 800, 400 + i * 200);
  for (let i = 0; i < 3; i++) road(city, 400 + i * 200, 400, 400 + i * 200, 800);
}

describe('pathfinding', () => {
  it('finds the shortest route across a grid', () => {
    const city = makeCity({ empty: true, unlimited: true });
    grid(city);
    const from = city.roads.nearestSegment(410, 400, 5)!;
    const to = city.roads.nearestSegment(790, 800, 5)!;
    const route = city.paths.find({ segId: from.seg.id, s: from.proj.s }, { segId: to.seg.id, s: to.proj.s });
    expect(route).not.toBeNull();
    // Manhattan distance ≈ 380 + 400.
    expect(route!.length).toBeGreaterThan(740);
    expect(route!.length).toBeLessThan(840);
    // Legs are contiguous.
    for (let i = 1; i < route!.legs.length; i++) {
      const prev = city.roads.getSegment(route!.legs[i - 1].segId);
      const cur = city.roads.getSegment(route!.legs[i].segId);
      const prevEnd = route!.legs[i - 1].dir === 1 ? prev.b : prev.a;
      const curStart = route!.legs[i].dir === 1 ? cur.a : cur.b;
      expect(curStart).toBe(prevEnd);
    }
  });

  it('returns null when unreachable', () => {
    const city = makeCity({ empty: true, unlimited: true });
    road(city, 400, 400, 600, 400);
    road(city, 1400, 1400, 1600, 1400);
    const a = city.roads.nearestSegment(500, 400, 5)!;
    const b = city.roads.nearestSegment(1500, 1400, 5)!;
    expect(city.paths.find({ segId: a.seg.id, s: 50 }, { segId: b.seg.id, s: 50 })).toBeNull();
  });

  it('avoids congested roads when an alternative exists', () => {
    const city = makeCity({ empty: true, unlimited: true });
    grid(city);
    const pf = new Pathfinder(city.roads, city.layout);
    // From the west edge road to the east edge road; the top and middle rows are equally short.
    const from = city.roads.nearestSegment(400, 500, 5)!;
    const to = city.roads.nearestSegment(800, 500, 5)!;
    const row = (z: number) =>
      new Set([...city.roads.segments.values()].filter((s) => Math.abs(city.roads.getNode(s.a).z - z) < 1 && Math.abs(city.roads.getNode(s.b).z - z) < 1).map((s) => s.id));
    const top = row(400);
    const mid = row(600);
    const usesRow = (r: Set<number>, legs: { segId: number }[]) => legs.some((l) => r.has(l.segId));
    pf.congestion = (id) => (top.has(id) ? 20 : 1);
    pf.invalidate();
    const avoidTop = pf.find({ segId: from.seg.id, s: from.proj.s }, { segId: to.seg.id, s: to.proj.s })!;
    expect(usesRow(top, avoidTop.legs)).toBe(false);
    expect(usesRow(mid, avoidTop.legs)).toBe(true);
    pf.congestion = (id) => (mid.has(id) ? 20 : 1);
    pf.invalidate();
    const avoidMid = pf.find({ segId: from.seg.id, s: from.proj.s }, { segId: to.seg.id, s: to.proj.s })!;
    expect(usesRow(mid, avoidMid.legs)).toBe(false);
    expect(usesRow(top, avoidMid.legs)).toBe(true);
  });
});

describe('traffic model', () => {
  it('assigns volume along routes and reports congestion', () => {
    const city = makeCity({ empty: true, unlimited: true });
    road(city, 400, 400, 900, 400);
    const seg = [...city.roads.segments.values()][0];
    const model = new TrafficModel(city.roads, city.paths);
    model.setDemand([{ from: { segId: seg.id, s: 10 }, to: { segId: seg.id, s: 490 }, trips: 2000 }]);
    model.assignAll();
    expect(model.volume.get(seg.id)).toBe(2000);
    expect(model.ratio(seg.id)).toBeGreaterThan(1);
    expect(model.multiplier(seg.id)).toBeGreaterThan(1.3);
  });

  it('counts unreachable trips', () => {
    const city = makeCity({ empty: true, unlimited: true });
    road(city, 400, 400, 600, 400);
    road(city, 1400, 1400, 1600, 1400);
    const segs = [...city.roads.segments.values()];
    const model = new TrafficModel(city.roads, city.paths);
    model.setDemand([{ from: { segId: segs[0].id, s: 10 }, to: { segId: segs[1].id, s: 10 }, trips: 50 }]);
    model.assignAll();
    expect(model.unreachableTrips).toBe(50);
  });
});

describe('vehicles', () => {
  it('drive along a route through junctions and arrive', () => {
    const city = makeCity({ empty: true, unlimited: true });
    grid(city);
    const from = city.roads.nearestSegment(410, 400, 5)!;
    const to = city.roads.nearestSegment(790, 800, 5)!;
    const route = city.paths.find({ segId: from.seg.id, s: from.proj.s }, { segId: to.seg.id, s: to.proj.s })!;
    let arrived = false;
    const id = city.vehicles.spawn({ route, model: VM.sedan, color: 0xffffff, purpose: Purpose.Commute, onArrive: () => (arrived = true) });
    expect(id).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 4000 && !arrived; i++) {
      city.signals.update(0.05);
      city.vehicles.update(0.05);
    }
    expect(arrived).toBe(true);
    expect(city.vehicles.count).toBe(0);
  });

  it('queue behind each other instead of overlapping', () => {
    const city = makeCity({ empty: true, unlimited: true });
    road(city, 400, 400, 900, 400);
    const seg = [...city.roads.segments.values()][0];
    const ids: number[] = [];
    for (let k = 0; k < 6; k++) {
      const route = city.paths.find({ segId: seg.id, s: 20 + k * 9 }, { segId: seg.id, s: 480 })!;
      ids.push(city.vehicles.spawn({ route, model: VM.sedan, color: 0, purpose: Purpose.Commute }));
    }
    for (let i = 0; i < 40; i++) city.vehicles.update(0.1);
    const xs = ids.filter((i) => i >= 0 && city.vehicles.active[i]).map((i) => city.vehicles.x[i]).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThan(3.5);
  });

  it('give each reused slot a new serial so stale selections can be detected', () => {
    const city = makeCity({ empty: true, unlimited: true });
    road(city, 400, 400, 700, 400);
    const seg = city.roads.nearestSegment(550, 400, 5)!.seg;
    const route = () => city.paths.find({ segId: seg.id, s: 20 }, { segId: seg.id, s: 60 })!;
    const a = city.vehicles.spawn({ route: route(), model: VM.sedan, color: 0, purpose: Purpose.Commute });
    const first = city.vehicles.serial[a];
    expect(city.vehicles.legOf(a)).toBe(0);
    for (let i = 0; i < 400 && city.vehicles.active[a]; i++) city.vehicles.update(0.1);
    expect(city.vehicles.active[a]).toBe(0);
    const b = city.vehicles.spawn({ route: route(), model: VM.sedan, color: 0, purpose: Purpose.Commute });
    expect(b).toBe(a);
    expect(city.vehicles.serial[b]).not.toBe(first);
  });
});
