import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import type { Building } from '../src/sim/buildings/Buildings';
import type { City } from '../src/sim/City';
import { ROAD_TYPES } from '../src/sim/roads/RoadTypes';
import { pickCarModel } from '../src/sim/traffic/TripGenerator';
import { Park, Purpose, VM } from '../src/sim/traffic/Vehicles';
import { BuildingState, Zone } from '../src/sim/types';
import { turnMask } from '../src/render/roads/RoadMeshBuilder';
import { Furniture, type FurnitureItem, furnitureFor } from '../src/render/props/StreetFurniture';
import { makeCity, road } from './helpers';

const town = () => {
  const city = makeCity({ empty: true, unlimited: true });
  city.vehicles.lodRadius = 1e6;
  return city;
};

const pt = (city: City, x: number, z: number) => {
  const h = city.roads.nearestSegment(x, z, 8)!;
  return { segId: h.seg.id, s: h.proj.s };
};

const drive = (city: City, from: [number, number], to: [number, number], opts: { dest?: number; model?: number; onArrive?: () => void } = {}) => {
  const route = city.paths.find(pt(city, ...from), pt(city, ...to))!;
  return city.vehicles.spawn({ route, model: opts.model ?? VM.sedan, color: 0xffffff, purpose: Purpose.Commute, dest: opts.dest, onArrive: opts.onArrive });
};

/** Puts the camera's focus somewhere (cars only park near it). */
const look = (city: City, x: number, z: number) => {
  city.vehicles.lodX = x;
  city.vehicles.lodZ = z;
};

describe('cars at the end of their trip', () => {
  it('pull up at the kerb near the camera, stay a while, then fade away', () => {
    const city = town();
    road(city, 900, 1200, 1300, 1200);
    look(city, 1100, 1200);
    const v = city.vehicles;
    let arrivedAt = -1, f = 0;
    const i = drive(city, [920, 1200], [1150, 1200], { dest: 7, onArrive: () => (arrivedAt = f) });
    let parkedAt = -1, z = 0;
    for (; f < 900 && v.active[i]; f++) {
      v.update(0.1);
      if (parkedAt < 0 && v.park[i] === Park.Parked) {
        parkedAt = f;
        z = v.z[i];
      }
    }
    expect(parkedAt).toBeGreaterThan(0);
    // The trip counts as done when the car stops, not when it fades.
    expect(Math.abs(arrivedAt - parkedAt)).toBeLessThanOrEqual(1);
    // Over at the kerb: the right-hand lane centre is 1.75 m from the centre line; the kerb 4.5 m.
    const rt = ROAD_TYPES.street;
    expect(z - 1200).toBeGreaterThan(rt.laneWidth / 2 + 1.0);
    expect(z - 1200).toBeLessThan(rt.asphaltHalf - 0.8);
    // Then gone, after a few seconds.
    expect(v.active[i]).toBe(0);
    expect(f - parkedAt).toBeGreaterThan(80);
    expect(v.arrived).toBe(1);
  });

  it('pull into an empty driveway', () => {
    const city = town();
    road(city, 900, 1200, 1300, 1200);
    look(city, 1100, 1200);
    const v = city.vehicles;
    // A driveway 9 m in from the road's centre on the right, nose in.
    v.arrivalSpot = () => ({ x: 1160, z: 1209, rot: Math.PI / 2 });
    const i = drive(city, [920, 1200], [1155, 1200], { dest: 7 });
    let pulledIn = false;
    for (let f = 0; f < 900 && v.active[i] && v.park[i] !== Park.Parked; f++) {
      v.update(0.1);
      if (v.park[i] === Park.PullingIn) pulledIn = true;
    }
    expect(pulledIn).toBe(true);
    expect(v.park[i]).toBe(Park.Parked);
    expect(Math.hypot(v.x[i] - 1160, v.z[i] - 1209)).toBeLessThan(0.5);
    expect(Math.abs(Math.atan2(Math.sin(v.heading[i] - Math.PI / 2), Math.cos(v.heading[i] - Math.PI / 2)))).toBeLessThan(0.15);
    // Off the road: no longer in its lane.
    expect(v.countOn(pt(city, 1100, 1200).segId)).toBe(0);
  });

  it('just vanish far from the camera, as before', () => {
    const city = town();
    road(city, 900, 1200, 1300, 1200);
    look(city, 4000, 4000);
    const v = city.vehicles;
    const i = drive(city, [920, 1200], [1150, 1200], { dest: 7 });
    let parked = false;
    for (let f = 0; f < 600 && v.active[i]; f++) {
      v.update(0.1);
      if (v.park[i] === Park.Parked) parked = true;
    }
    expect(parked).toBe(false);
    expect(v.active[i]).toBe(0);
    expect(v.arrived).toBe(1);
  });

  it('on a road with two lanes each way, others go round a parked car', () => {
    const city = town();
    road(city, 900, 1200, 1500, 1200, 'avenue');
    look(city, 1100, 1200);
    const v = city.vehicles;
    const parker = drive(city, [920, 1200], [1100, 1200], { dest: 7 });
    for (let f = 0; f < 400 && v.park[parker] !== Park.Parked; f++) v.update(0.1);
    expect(v.park[parker]).toBe(Park.Parked);
    // Someone in the kerb lane behind it, going further.
    const car = drive(city, [940, 1200], [1480, 1200]);
    let passed = false;
    for (let f = 0; f < 600 && v.active[car]; f++) {
      v.update(0.1);
      if (v.active[car] && v.active[parker] && v.x[car] > v.x[parker] + 3) passed = true;
    }
    expect(passed).toBe(true);
    expect(v.despawnedStuck).toBe(0);
  });
});

describe('vehicle variety', () => {
  it('includes pickups and small cars among private cars', () => {
    const rng = new Rng(3);
    const seen = new Set<number>();
    for (let k = 0; k < 400; k++) seen.add(pickCarModel(rng));
    expect(seen.has(VM.pickup)).toBe(true);
    expect(seen.has(VM.mini)).toBe(true);
  });
});

describe('turn arrows', () => {
  it('know which ways traffic can go at the junction ahead', () => {
    const city = makeCity({ empty: true, unlimited: true });
    // A T: an avenue east–west, a street going south (+z) from its middle.
    road(city, 900, 1200, 1500, 1200, 'avenue');
    road(city, 1200, 1200, 1200, 1500);
    const west = city.roads.nearestSegment(1000, 1200, 5)!.seg;
    const east = city.roads.nearestSegment(1400, 1200, 5)!.seg;
    const node = city.roads.nearestNode(1200, 1200, 3)!.id;
    const westAtNode = west.b === node;
    // From the west (heading east): straight on, or right into the street.
    expect(turnMask(city.roads, city.layout, west, westAtNode)).toBe(2 | 4);
    // From the east (heading west): straight on, or left into the street.
    expect(turnMask(city.roads, city.layout, east, east.b === node)).toBe(1 | 2);
    // Not at the far, open ends.
    expect(turnMask(city.roads, city.layout, west, !westAtNode)).toBe(0);
  });
});

describe('street furniture', () => {
  const fake = (over: Partial<Building>): Building => ({ id: 1, kind: 'zoned', zone: Zone.Commercial, state: BuildingState.Active, segS: 100, hw: 12, side: 1, floors: 2, typeId: 'shop', ...over }) as Building;

  it('lines shopping streets, leaves houses alone, and keeps clear of corners, lamps and bus stops', () => {
    const city = makeCity({ empty: true, unlimited: true });
    road(city, 900, 1200, 1400, 1200);
    const seg = city.roads.nearestSegment(1100, 1200, 5)!.seg;
    const items: FurnitureItem[] = [];
    furnitureFor(city, seg, [fake({ id: 1, segS: 60, hw: 25 }), fake({ id: 2, segS: 200, hw: 30, zone: Zone.ResLow }), fake({ id: 3, segS: 400, hw: 40, side: -1 })], items);
    expect(items.some((f) => f.kind === Furniture.Bench)).toBe(true);
    expect(items.some((f) => f.kind === Furniture.Bin)).toBe(true);
    // Nothing in front of the houses.
    expect(items.some((f) => f.x > 900 + 175 && f.x < 900 + 225)).toBe(false);
    // On the sidewalk by the kerb, either side.
    const rt = ROAD_TYPES.street;
    for (const f of items) {
      const off = Math.abs(f.z - 1200);
      expect(off).toBeGreaterThan(rt.asphaltHalf + 0.2);
      expect(off).toBeLessThan(rt.asphaltHalf + 1.0);
      // Away from the ends of the road.
      expect(f.x).toBeGreaterThan(900 + 7);
      expect(f.x).toBeLessThan(1400 - 7);
    }
    // Clear of the lamps (every 34 m from 10 m, alternating sides on a street).
    for (const f of items) {
      for (let k = 0, v = 10; v < 500; v += 34, k++) {
        const side = k % 2 === 0 ? 1 : -1;
        if (Math.sign(f.z - 1200) === side) expect(Math.abs(f.x - 900 - v)).toBeGreaterThan(2);
      }
    }
  });
});
