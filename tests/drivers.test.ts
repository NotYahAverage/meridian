import { describe, expect, it } from 'vitest';
import type { City } from '../src/sim/City';
import type { RoutePoint } from '../src/sim/traffic/Pathfinder';
import { Stage } from '../src/sim/traffic/Signals';
import { Held, Purpose, VEHICLE_LENGTH, VM } from '../src/sim/traffic/Vehicles';
import { makeCity, road } from './helpers';

/** An empty test city, with every vehicle simulated in full (no distant-vehicle shortcuts). */
const town = () => {
  const city = makeCity({ empty: true, unlimited: true });
  city.vehicles.lodRadius = 1e6;
  return city;
};

const pt = (city: City, x: number, z: number): RoutePoint => {
  const h = city.roads.nearestSegment(x, z, 8)!;
  return { segId: h.seg.id, s: h.proj.s };
};

const drive = (city: City, from: [number, number], to: [number, number], model: number = VM.sedan) => {
  const route = city.paths.find(pt(city, ...from), pt(city, ...to));
  if (!route) return -1;
  return city.vehicles.spawn({ route, model, color: 0xffffff, purpose: model === VM.bus ? Purpose.Transit : Purpose.Commute });
};

/** Gives the phase containing `segId` the green (and holds it while the lights aren't updated). */
const green = (city: City, node: number, segId: number) => {
  const st = city.signals.states.get(node)!;
  st.phase = st.phases.findIndex((p) => p.includes(segId));
  st.stage = Stage.Green;
  st.timer = 0;
  st.clearing = false;
};

/** Closest any two vehicles come to each other (centre to centre). */
const closest = (city: City) => {
  const v = city.vehicles;
  let best = Infinity;
  for (let i = 0; i < v.max; i++) {
    if (!v.active[i]) continue;
    for (let j = i + 1; j < v.max; j++) {
      if (!v.active[j]) continue;
      best = Math.min(best, Math.hypot(v.x[i] - v.x[j], v.z[i] - v.z[j]));
    }
  }
  return best;
};

/** An avenue (east–west, z = 1200) crossing a street at x = 1200: traffic lights. */
function lights() {
  const city = town();
  road(city, 900, 1200, 1500, 1200, 'avenue');
  road(city, 1200, 900, 1200, 1500, 'street');
  const node = city.roads.nearestNode(1200, 1200, 3)!;
  expect(city.layout.get(node.id)!.control).toBe('signal');
  return { city, node: node.id, west: pt(city, 1000, 1200).segId, east: pt(city, 1400, 1200).segId, north: pt(city, 1200, 1000).segId };
}

describe('drivers', () => {
  it('queue at a red light behind the crosswalk, then go on green', () => {
    const { city, node, west, north } = lights();
    green(city, node, north);
    const ids: number[] = [];
    for (let k = 0; k < 5; k++) {
      ids.push(drive(city, [920, 1200], [1450, 1200]));
      for (let f = 0; f < 40; f++) city.vehicles.update(0.1);
    }
    for (let f = 0; f < 800; f++) city.vehicles.update(0.1);
    const v = city.vehicles;
    const xs = ids.filter((i) => i >= 0).map((i) => v.x[i]).sort((a, b) => b - a);
    expect(xs.length).toBe(5);
    // Spacing in each lane.
    for (const lane of [0, 1]) {
      const inLane = ids.filter((i) => v.laneOf(i) === lane).map((i) => v.x[i]).sort((a, b) => b - a);
      for (let k = 1; k < inLane.length; k++) expect(inLane[k - 1] - inLane[k]).toBeGreaterThan(5);
    }
    for (const i of ids) expect(v.speed[i]).toBeLessThan(0.1);
    // The first car waits short of the crosswalk.
    const lead = ids.find((i) => v.x[i] === xs[0])!;
    const trim = city.layout.get(node)!.arms.find((a) => a.segId === west)!.trim;
    expect(xs[0] + VEHICLE_LENGTH[v.model[lead]] / 2).toBeLessThan(1200 - trim - 3.4);
    expect(v.held[lead]).toBe(Held.Red);
    green(city, node, west);
    for (let f = 0; f < 900 && v.count; f++) city.vehicles.update(0.1);
    expect(v.arrived).toBe(5);
  });

  it('turn left across oncoming traffic only when there is a gap, waiting inside the junction', () => {
    const { city, node, west } = lights();
    green(city, node, west);
    const v = city.vehicles;
    let left = -1, waited = false, near = Infinity;
    for (let f = 0; f < 2400; f++) {
      // A steady stream from the east for the first two minutes.
      if (f < 1200 && f % 30 === 0) drive(city, [1480, 1200], [920, 1200]);
      if (f === 100) left = drive(city, [940, 1200], [1200, 950]);
      v.update(0.1);
      if (left >= 0 && v.active[left]) {
        if (v.isWaitingToTurn(left)) waited = true;
        for (let j = 0; j < v.max; j++) if (j !== left && v.active[j]) near = Math.min(near, Math.hypot(v.x[left] - v.x[j], v.z[left] - v.z[j]));
      }
    }
    expect(left).toBeGreaterThanOrEqual(0);
    expect(waited).toBe(true);
    expect(v.active[left]).toBe(0);
    expect(near).toBeGreaterThan(3);
    expect(v.despawnedStuck).toBe(0);
  });

  it('give way from a minor road, and nobody overlaps in the junction', () => {
    const city = town();
    road(city, 900, 1200, 1500, 1200);
    road(city, 1200, 1200, 1200, 1500);
    const v = city.vehicles;
    let minor = -1, gaveWay = false, near = Infinity;
    for (let f = 0; f < 3000; f++) {
      if (f < 1500 && f % 70 === 0) drive(city, [920, 1200], [1480, 1200]);
      if (f < 1500 && f % 90 === 20) drive(city, [1480, 1200], [920, 1200]);
      if (f === 150) minor = drive(city, [1200, 1460], [920, 1200]);
      v.update(0.1);
      if (minor >= 0 && v.active[minor] && v.held[minor] === Held.GiveWay) gaveWay = true;
      if (f % 5 === 0) near = Math.min(near, closest(city));
    }
    expect(gaveWay).toBe(true);
    expect(v.active[minor]).toBe(0);
    expect(near).toBeGreaterThan(2.5);
    expect(v.despawnedStuck).toBe(0);
  });

  it('change lanes, with a signal, into the lane for the next turn', () => {
    const city = town();
    road(city, 900, 1200, 1700, 1200, 'avenue');
    road(city, 1200, 1050, 1200, 1350, 'street');
    road(city, 1450, 1050, 1450, 1350, 'street');
    const v = city.vehicles;
    // Straight on at the first crossing, then right (south, +z) at the second.
    const i = drive(city, [920, 1200], [1450, 1330]);
    expect(v.laneOf(i)).toBe(0);
    let signalled = false, laneBefore = -1;
    for (let f = 0; f < 1500 && v.active[i]; f++) {
      const st1 = city.signals.states;
      for (const st of st1.values()) {
        // Always green for the avenue.
        const id = st.phases.findIndex((p) => p.some((s) => city.roads.getSegment(s).type === 'avenue'));
        if (st.phase !== id || st.stage !== Stage.Green) green(city, st.nodeId, st.phases[id][0]);
      }
      if (v.indicator[i] === 1 && !v.isTurning(i)) signalled = true;
      if (!v.isTurning(i) && v.legOf(i) === 1) laneBefore = v.laneOf(i);
      v.update(0.1);
    }
    expect(v.laneChanges).toBeGreaterThanOrEqual(1);
    expect(signalled).toBe(true);
    expect(laneBefore).toBe(1);
    expect(v.arrived).toBe(1);
  });

  it('pull out past a bus at a stop', () => {
    const city = town();
    road(city, 900, 1200, 1700, 1200, 'avenue');
    const v = city.vehicles;
    const bus = drive(city, [1050, 1200], [1680, 1200], VM.bus);
    expect(v.laneOf(bus)).toBe(1);
    v.hold[bus] = 120;
    const car = drive(city, [940, 1200], [1680, 1200]);
    expect(v.laneOf(car)).toBe(1);
    let passed = false;
    for (let f = 0; f < 600 && v.active[car]; f++) {
      v.update(0.1);
      if (v.active[car] && v.x[car] > v.x[bus] + 2) passed = true;
    }
    expect(passed).toBe(true);
    expect(v.laneChanges).toBeGreaterThanOrEqual(1);
  });

  it('stop for someone crossing the road', () => {
    const city = town();
    road(city, 900, 1200, 1500, 1200);
    const v = city.vehicles;
    const i = drive(city, [920, 1200], [1480, 1200]);
    for (let f = 0; f < 30; f++) v.update(0.1);
    const z = v.z[i];
    // Someone out in the road ahead.
    v.setPeople(1150, 1200, [1150, z], 1, [], 0);
    for (let f = 0; f < 700; f++) v.update(0.1);
    expect(v.speed[i]).toBeLessThan(0.1);
    expect(v.x[i]).toBeLessThan(1150 - 2.3);
    expect(v.x[i]).toBeGreaterThan(1150 - 12);
    expect(v.held[i]).toBe(Held.People);
    v.setPeople(1150, 1200, [], 0, [], 0);
    for (let f = 0; f < 1200 && v.active[i]; f++) v.update(0.1);
    expect(v.arrived).toBe(1);
  });

  it('wait behind the line, not on the crossing, for someone crossing the road they are turning into', () => {
    const city = town();
    road(city, 900, 1200, 1500, 1200);
    road(city, 1200, 900, 1200, 1500);
    const v = city.vehicles;
    const node = city.roads.nearestNode(1200, 1200, 3)!;
    const trimSouth = city.layout.get(node.id)!.arms.find((a) => a.segId === pt(city, 1200, 1400).segId)!.trim;
    // Heading east, turning right (south); someone on the crosswalk across the south arm.
    const i = drive(city, [920, 1200], [1200, 1450]);
    v.setPeople(1200, 1200, [1198.5, 1200 + trimSouth + 2], 1, [], 0);
    for (let f = 0; f < 600; f++) v.update(0.1);
    const trimWest = city.layout.get(node.id)!.arms.find((a) => a.segId === pt(city, 1000, 1200).segId)!.trim;
    expect(v.speed[i]).toBeLessThan(0.1);
    expect(v.isTurning(i)).toBe(false);
    // Front bumper short of its own crosswalk.
    expect(v.x[i] + VEHICLE_LENGTH[v.model[i]] / 2).toBeLessThan(1200 - trimWest - 0.4);
    expect(v.held[i]).toBe(Held.People);
    v.setPeople(1200, 1200, [], 0, [], 0);
    for (let f = 0; f < 900 && v.active[i]; f++) v.update(0.1);
    expect(v.arrived).toBe(1);
  });

  it('stop at a zebra crossing for someone waiting to cross', () => {
    const city = town();
    road(city, 900, 1200, 1500, 1200);
    const v = city.vehicles;
    const i = drive(city, [920, 1200], [1480, 1200]);
    v.setPeople(1150, 1200, [], 0, [1150, 1194, 1150, 1206], 1);
    for (let f = 0; f < 700; f++) v.update(0.1);
    expect(v.speed[i]).toBeLessThan(0.1);
    expect(v.x[i]).toBeLessThan(1150 - 2.3);
  });

  it('lights: keep the green while traffic flows, and give left-turners an arrow when they pile up', () => {
    const { city, node, west, north } = lights();
    const v = city.vehicles;
    const sig = city.signals;
    green(city, node, west);
    let longest = 0, run = 0, arrow = false;
    for (let f = 0; f < 3000; f++) {
      // Steady traffic both ways along the avenue for four minutes.
      if (f < 2400 && f % 25 === 0) drive(city, [920, 1200], [1480, 1200]);
      if (f < 2400 && f % 25 === 12) drive(city, [1480, 1200], [920, 1200]);
      // Left-turners from the north arm (turning east... their left), arriving in a bunch.
      if (f >= 600 && f < 1000 && f % 40 === 0) drive(city, [1200, 920], [1480, 1200]);
      sig.update(0.1);
      v.update(0.1);
      if (sig.isGreen(node, west)) run += 0.1;
      else {
        longest = Math.max(longest, run);
        run = 0;
      }
      if (sig.arrowOn(node, north)) arrow = true;
    }
    longest = Math.max(longest, run);
    // Much longer than the shortest green.
    expect(longest).toBeGreaterThan(30);
    expect(arrow).toBe(true);
    expect(v.despawnedStuck).toBe(0);
  });

  it('reach their destinations through a busy grid without gridlock', () => {
    const city = town();
    for (let k = 0; k < 3; k++) road(city, 900, 1000 + k * 200, 1500, 1000 + k * 200, k === 1 ? 'avenue' : 'street');
    for (let k = 0; k < 3; k++) road(city, 1000 + k * 200, 900, 1000 + k * 200, 1500, k === 1 ? 'avenue' : 'street');
    const v = city.vehicles;
    const ends: [number, number][] = [[920, 1000], [920, 1400], [1480, 1000], [1480, 1400], [1000, 920], [1400, 920], [1000, 1480], [1400, 1480], [920, 1200], [1480, 1200], [1200, 920], [1200, 1480]];
    let spawned = 0, near = Infinity, seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let f = 0; f < 6000; f++) {
      if (f < 4000 && f % 6 === 0) {
        const a = ends[Math.floor(rnd() * ends.length)], b = ends[Math.floor(rnd() * ends.length)];
        if (a !== b && drive(city, a, b) >= 0) spawned++;
      }
      city.signals.update(0.1);
      v.update(0.1);
      if (f % 10 === 0) near = Math.min(near, closest(city));
    }
    for (let f = 0; f < 3000 && v.count; f++) {
      city.signals.update(0.1);
      v.update(0.1);
    }
    expect(spawned).toBeGreaterThan(300);
    expect(v.arrived).toBeGreaterThanOrEqual(spawned * 0.97);
    expect(v.despawnedStuck).toBeLessThanOrEqual(spawned * 0.01);
    expect(near).toBeGreaterThan(1.8);
  });
});

describe('junction delay in the city-wide model', () => {
  it('grows with traffic, and minor roads wait for gaps in the major road', () => {
    const city = town();
    road(city, 900, 1200, 1500, 1200, 'avenue');
    road(city, 1200, 1200, 1200, 1500, 'lane');
    const major = pt(city, 1000, 1200), side = pt(city, 1200, 1400), east = pt(city, 1400, 1200);
    const node = city.roads.nearestNode(1200, 1200, 3)!;
    expect(city.layout.get(node.id)!.control).toBe('signal');
    const model = city.traffic;
    const delays = (trips: number) => {
      model.setDemand([
        { from: major, to: east, trips },
        { from: side, to: east, trips: trips / 4 },
      ]);
      model.assignAll();
      const seg = city.roads.getSegment(major.segId);
      return model.junctionDelay(seg.id, seg.b === node.id);
    };
    const quiet = delays(50);
    const busy = delays(4000);
    expect(quiet).toBeGreaterThan(3);
    expect(quiet).toBeLessThan(20);
    expect(busy).toBeGreaterThan(quiet * 2);
  });

  it('makes side streets wait at give-way junctions', () => {
    const city = town();
    road(city, 900, 1200, 1500, 1200);
    road(city, 1200, 1200, 1200, 1500);
    const node = city.roads.nearestNode(1200, 1200, 3)!;
    expect(city.layout.get(node.id)!.control).toBe('yield');
    const west = pt(city, 1000, 1200), east = pt(city, 1400, 1200), side = pt(city, 1200, 1400);
    const model = city.traffic;
    model.setDemand([
      { from: west, to: east, trips: 500 },
      { from: east, to: west, trips: 500 },
      { from: side, to: west, trips: 150 },
    ]);
    model.assignAll();
    const at = (p: RoutePoint) => {
      const s = city.roads.getSegment(p.segId);
      return model.junctionDelay(s.id, s.b === node.id);
    };
    expect(at(side)).toBeGreaterThan(at(west) * 2);
    // And routes count it.
    const route = city.paths.find(side, west)!;
    expect(route.cost).toBeGreaterThan(at(side));
  });
});
