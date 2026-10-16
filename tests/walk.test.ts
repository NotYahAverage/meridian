import { describe, expect, it } from 'vitest';
import { bulldozeRoad, buildRoundabout } from '../src/sim/CityCommands';
import type { City } from '../src/sim/City';
import { ROAD_TYPES } from '../src/sim/roads/RoadTypes';
import { WalkLight } from '../src/sim/traffic/Signals';
import { WALK_SPEED, WalkEdge, type WalkLocation, type WalkRoute, isCrossing } from '../src/sim/walk/WalkNetwork';
import { makeCity, road } from './helpers';

/** An avenue (signalised junctions) crossed by three streets, at (1000–1600, 1200). */
function town(): City {
  const city = makeCity({ empty: true, unlimited: true });
  road(city, 1000, 1200, 1600, 1200, 'avenue');
  for (const x of [1150, 1300, 1450]) road(city, x, 1000, x, 1400, 'street');
  return city;
}

const segAt = (city: City, x: number, z: number) => city.roads.nearestSegment(x, z, 8)!.seg;
const loc = (city: City, x: number, z: number, side: number): WalkLocation => {
  const hit = city.roads.nearestSegment(x, z, 8)!;
  return city.walk.locate(hit.seg.id, side, hit.proj.s)!;
};

/** Consecutive steps meet, so people never jump. */
function expectContinuous(city: City, r: WalkRoute): void {
  const w = city.walk;
  for (let k = 0; k + 1 < r.steps.length; k++) {
    const a = w.pointOnEdge(r.steps[k].edge, r.steps[k].to);
    const ax = a.x, az = a.z;
    const b = w.pointOnEdge(r.steps[k + 1].edge, r.steps[k + 1].from);
    expect(Math.hypot(ax - b.x, az - b.z)).toBeLessThan(0.6);
  }
}

/** Off the carriageway everywhere except on crossings. */
function expectOffAsphalt(city: City, r: WalkRoute): void {
  const w = city.walk;
  for (const st of r.steps) {
    if (isCrossing(w.kind[st.edge])) continue;
    const n = 8;
    for (let k = 0; k <= n; k++) {
      const p = w.pointOnEdge(st.edge, st.from + ((st.to - st.from) * k) / n);
      const px = p.x, pz = p.z;
      for (const seg of city.roads.segmentsIn(px - 30, pz - 30, px + 30, pz + 30)) {
        const hit = city.roads.nearestSegment(px, pz, 40, (s) => s.id === seg.id);
        if (!hit) continue;
        // Within the trimmed stretch the centreline distance is the lateral offset.
        if (hit.proj.s < seg.trimA || hit.proj.s > seg.length - seg.trimB) continue;
        expect(hit.proj.dist).toBeGreaterThan(ROAD_TYPES[seg.type].asphaltHalf - 0.05);
      }
    }
  }
}

describe('walking network', () => {
  it('covers sidewalks, corners and crosswalks', () => {
    const city = town();
    const c = city.walk.counts();
    expect(c.Sidewalk).toBeGreaterThan(20);
    expect(c.Corner).toBeGreaterThanOrEqual(12);
    // Three signalised four-way junctions, four crosswalks each.
    expect(c.Signal).toBe(12);
    // Quiet streets can be crossed anywhere; the avenue only at crosswalks.
    expect(c.Informal).toBeGreaterThan(0);
    for (let e = 0; e < city.walk.edgeCount; e++) {
      if (city.walk.kind[e] === WalkEdge.Informal) expect(city.roads.getSegment(city.walk.seg[e]).type).toBe('street');
    }
  });

  it('crosses the avenue at the lights, and walks continuously off the road', () => {
    const city = town();
    const from = loc(city, 1220, 1200, 1);
    const to = loc(city, 1240, 1200, -1);
    const r = city.walk.route(from, to)!;
    expect(r).not.toBeNull();
    expect(r.crossings).toBe(1);
    expect(r.steps.some((s) => city.walk.kind[s.edge] === WalkEdge.Signal)).toBe(true);
    // Out to the nearest junction and back: longer than straight across, but not absurdly.
    expect(r.length).toBeGreaterThan(30);
    expect(r.length).toBeLessThan(140);
    expect(r.time).toBeGreaterThan(r.length / WALK_SPEED);
    expectContinuous(city, r);
    expectOffAsphalt(city, r);
  });

  it('walks along one side without crossing, and crosses a quiet street directly', () => {
    const city = town();
    const along = city.walk.route(loc(city, 1150, 1260, 1), loc(city, 1150, 1380, 1))!;
    expect(along.crossings).toBe(0);
    expect(along.length).toBeCloseTo(120, -1);
    const across = city.walk.route(loc(city, 1150, 1300, 1), loc(city, 1150, 1300, -1))!;
    expect(across.crossings).toBe(1);
    expect(across.length).toBeLessThan(40);
    expectContinuous(city, across);
  });

  it('finds routes across town that stay on sidewalks', () => {
    const city = town();
    const r = city.walk.route(loc(city, 1150, 1050, 1), loc(city, 1450, 1350, -1))!;
    expect(r).not.toBeNull();
    expect(r.crossings).toBeGreaterThanOrEqual(1);
    expectContinuous(city, r);
    expectOffAsphalt(city, r);
    // No shortcut through blocks: at least the Manhattan distance.
    expect(r.length).toBeGreaterThan(300 + 300 - 40);
  });

  it('joins both sides around a dead end', () => {
    const city = makeCity({ empty: true, unlimited: true });
    road(city, 1000, 1200, 1300, 1200, 'avenue');
    const r = city.walk.route(loc(city, 1200, 1200, 1), loc(city, 1200, 1200, -1))!;
    expect(r).not.toBeNull();
    expect(r.crossings).toBe(0);
    expect(r.steps.some((s) => city.walk.kind[s.edge] === WalkEdge.EndCap)).toBe(true);
    expectContinuous(city, r);
  });

  it('treats roads without sidewalks as barriers, crossed only at the lights', () => {
    const city = makeCity({ empty: true, unlimited: true });
    city.peakPopulation = 9000;
    expect(road(city, 1000, 1200, 1600, 1200, 'parkway').res.ok).toBe(true);
    // Two dead-end streets facing each other across the parkway, without a junction: no way over.
    road(city, 1150, 1000, 1150, 1180);
    road(city, 1150, 1220, 1150, 1400);
    expect(city.walk.connected(loc(city, 1150, 1050, 1), loc(city, 1150, 1350, 1))).toBe(false);
    expect(city.walk.route(loc(city, 1150, 1050, 1), loc(city, 1150, 1350, 1))).toBeNull();
    // A sidewalk-less road has no walking spots of its own.
    expect(city.walk.locate(segAt(city, 1080, 1200).id, 1, 20)).toBeNull();
    // A street crossing it at grade gets lights, and people cross the parkway there, pausing on the median.
    road(city, 1450, 1000, 1450, 1400);
    const node = city.roads.nearestNode(1450, 1200, 10)!;
    expect(city.layout.get(node.id)!.control).toBe('signal');
    const r = city.walk.route(loc(city, 1450, 1050, 1), loc(city, 1450, 1350, 1))!;
    expect(r).not.toBeNull();
    const across = r.steps.filter((st) => city.walk.kind[st.edge] === WalkEdge.Signal && city.roads.getSegment(city.walk.seg[st.edge]).type === 'parkway');
    expect(across.length).toBe(2);
    expectContinuous(city, r);
    // The lights give people time to reach the median.
    const st = city.signals.states.get(node.id)!;
    const pw = city.layout.get(node.id)!.arms.filter((a) => city.roads.getSegment(a.segId).type === 'parkway').map((a) => a.segId);
    expect(st.walks.some((w) => pw.every((id) => w.includes(id)))).toBe(true);
  });

  it('cuts the median barrier where people cross an expressway at the lights', () => {
    const city = makeCity({ empty: true, unlimited: true });
    city.peakPopulation = 9000;
    expect(road(city, 1000, 1200, 1600, 1200, 'expressway').res.ok).toBe(true);
    road(city, 1300, 1000, 1300, 1400, 'avenue');
    const node = city.roads.nearestNode(1300, 1200, 10)!;
    expect(city.layout.get(node.id)!.control).toBe('signal');
    const r = city.walk.route(loc(city, 1300, 1050, 1), loc(city, 1300, 1350, -1))!;
    expect(r).not.toBeNull();
    expect(r.crossings).toBeGreaterThanOrEqual(2);
    // Green long enough to reach the refuge, without stretching the cycle.
    const st = city.signals.states.get(node.id)!;
    for (const g of st.green) expect(g).toBeLessThan(20);
  });

  it('crosses roundabout approaches at zebras and never walks onto the island', () => {
    const city = makeCity({ empty: true, unlimited: true });
    road(city, 1000, 1200, 1400, 1200);
    road(city, 1200, 1000, 1200, 1400);
    expect(buildRoundabout(city, 1200, 1200).ok).toBe(true);
    const c = city.walk.counts();
    expect(c.Zebra).toBe(4);
    expect(c.Signal).toBe(0);
    const rb = [...city.roads.roundabouts.values()][0];
    const r = city.walk.route(loc(city, 1060, 1200, 1), loc(city, 1340, 1200, -1))!;
    expect(r).not.toBeNull();
    expectContinuous(city, r);
    for (const st of r.steps) {
      const p = city.walk.pointOnEdge(st.edge, (st.from + st.to) / 2);
      // Outside the carriageway of the ring (inner sidewalks face the island and aren't used).
      expect(Math.hypot(p.x - rb.x, p.z - rb.z)).toBeGreaterThan(rb.r - 1);
    }
  });

  it('rebuilds when roads change', () => {
    const city = town();
    const before = city.walk.counts().Signal;
    const v = city.walk.version;
    const res = bulldozeRoad(city, segAt(city, 1450, 1050).id);
    expect(res.ok).toBe(true);
    expect(city.walk.counts().Signal).toBeLessThan(before);
    expect(city.walk.version).toBeGreaterThan(v);
  });

  it('is quick to build and search on a large grid', () => {
    const city = makeCity({ empty: true, unlimited: true });
    for (let k = 0; k <= 12; k++) {
      road(city, 800, 800 + k * 90, 800 + 12 * 90, 800 + k * 90, k % 4 === 0 ? 'avenue' : 'street');
      road(city, 800 + k * 90, 800, 800 + k * 90, 800 + 12 * 90, 'street');
    }
    const t0 = performance.now();
    city.walk.ensure();
    const build = performance.now() - t0;
    const segs = [...city.roads.segments.values()].filter((s) => ROAD_TYPES[s.type].sidewalk > 0);
    let found = 0;
    const t1 = performance.now();
    for (let i = 0; i < 400; i++) {
      const a = segs[(i * 7919) % segs.length], b = segs[(i * 104729 + 13) % segs.length];
      const r = city.walk.route({ segId: a.id, side: 1, s: a.length / 2 }, { segId: b.id, side: -1, s: b.length / 2 });
      if (r) found++;
    }
    const search = performance.now() - t1;
    expect(found).toBe(400);
    expect(build).toBeLessThan(150);
    expect(search / 400).toBeLessThan(2);
  });
});

describe('walk signals', () => {
  it('only shows walk across arms whose traffic is held, and leaves time to finish crossing', () => {
    const city = town();
    const node = city.roads.nearestNode(1300, 1200, 10)!;
    const st = city.signals.states.get(node.id)!;
    expect(st).toBeDefined();
    const arms = city.layout.get(node.id)!.arms.map((a) => a.segId);
    let walked = new Set<number>();
    for (let t = 0; t < 120; t += 0.25) {
      city.signals.update(0.25);
      for (const id of arms) {
        const light = city.signals.walkLight(node.id, id);
        // Traffic coming in from this arm has a red whenever people may walk across it.
        if (light !== WalkLight.DontWalk) expect(city.signals.isGreen(node.id, id)).toBe(false);
        if (light === WalkLight.Walk) walked.add(id);
      }
    }
    expect(walked.size).toBe(arms.length);
    for (let p = 0; p < st.phases.length; p++) {
      for (const id of st.walks[p]) {
        const span = city.roads.getSegment(id).type === 'avenue' ? ROAD_TYPES.avenue.asphaltHalf * 2 : ROAD_TYPES.street.asphaltHalf * 2;
        expect(st.walkTime[p] + span / 1.2).toBeLessThanOrEqual(st.green[p] + 1e-6);
      }
    }
    walked = new Set();
    expect(city.signals.meanWalkWait(node.id, arms[0])).toBeGreaterThan(3);
    expect(city.signals.untilWalk(node.id, arms[0])).toBeGreaterThanOrEqual(0);
  });
});
