import { describe, expect, it } from 'vitest';
import type { City } from '../src/sim/City';
import { createLine, placeService, placeStop, previewStop, removeStop, setLineBuses } from '../src/sim/CityCommands';
import { type Building, newBuilding } from '../src/sim/buildings/Buildings';
import { deserializeCity, serializeCity } from '../src/sim/save/Serializer';
import { BUS } from '../src/sim/transit/Transit';
import { Purpose } from '../src/sim/traffic/Vehicles';
import { BuildingState, Zone } from '../src/sim/types';
import { makeCity, road } from './helpers';

/** A long avenue with homes at one end and offices at the other. */
function commuterTown(): { city: City; home: Building; work: Building; x0: number; z0: number } {
  const city = makeCity({ unlimited: true });
  city.peakPopulation = 5000;
  const sp = city.terrain.spawn;
  const x0 = sp.endX, z0 = sp.endZ;
  road(city, x0, z0, x0 + 800, z0, 'avenue');
  road(city, x0 + 800, z0, x0 + 1600, z0, 'avenue');
  const placed = placeService(city, 'bus_depot', x0 + 700, z0 + 40);
  if (!placed.ok) throw new Error(placed.error);
  const depot = placed.building!;
  depot.state = BuildingState.Active;
  depot.progress = 1;
  const make = (x: number, zone: Zone, hhCap: number, jobs: number): Building => {
    const hit = city.roads.nearestSegment(x, z0 - 30, 60)!;
    const b = newBuilding({
      kind: 'zoned', typeId: 'lowrise', style: 'lowrise', zone, cx: x, cz: z0 - 30, angle: 0, hw: 10, hd: 10, y: 10,
      state: BuildingState.Active, progress: 1, segId: hit.seg.id, segS: hit.proj.s, side: hit.proj.side, hhCap, jobs,
    });
    city.addBuilding(b);
    return b;
  };
  const home = make(x0 + 150, Zone.ResMed, 60, 0);
  const work = make(x0 + 1450, Zone.Office, 0, 200);
  for (let k = 0; k < 50; k++) {
    const i = city.addHousehold(home, 2, 1, 1);
    city.population.setJob(i, 0, work.id);
    work.workers++;
  }
  return { city, home, work, x0, z0 };
}

function commuteTrips(city: City): number {
  let n = 0;
  for (const t of city.trips.buildDemand()) n += t.trips;
  return n;
}

describe('public transit', () => {
  it('places stops on the curb and rejects bad spots', () => {
    const { city, x0, z0 } = commuterTown();
    const pv = previewStop(city, x0 + 300, z0 - 10);
    expect(pv.valid).toBe(true);
    expect(Math.abs(pv.z - z0)).toBeGreaterThan(5);
    const a = placeStop(city, x0 + 300, z0 - 10);
    expect(a.ok).toBe(true);
    // Too close to the first stop on the same side.
    expect(placeStop(city, x0 + 315, z0 - 10).ok).toBe(false);
    // The other side of the road is fine.
    expect(placeStop(city, x0 + 315, z0 + 10).ok).toBe(true);
    // Nowhere near a road.
    expect(previewStop(city, x0 + 300, z0 - 300).valid).toBe(false);
  });

  it('commuters near a line switch some trips from car to bus', () => {
    const { city, x0, z0 } = commuterTown();
    city.trips.refresh();
    const before = commuteTrips(city);
    const s1 = placeStop(city, x0 + 150, z0 - 10).stop!;
    const s2 = placeStop(city, x0 + 1450, z0 - 10).stop!;
    const res = createLine(city, [s1.id, s2.id]);
    expect(res.ok).toBe(true);
    const line = res.line!;
    city.transit.refreshRoutes(true);
    expect(line.problem).toBe('');
    expect(line.hops.length).toBe(2);
    expect(line.loopSeconds).toBeGreaterThan(100);
    city.transit.updateRidership();
    expect(line.ridersPerDay).toBeGreaterThan(5);
    expect(city.transit.modeShare).toBeGreaterThan(0.05);
    expect(city.transit.modeShare).toBeLessThan(0.9);
    city.trips.refresh();
    expect(commuteTrips(city)).toBeLessThan(before);
    expect(city.transit.monthlyFares()).toBeGreaterThan(0);
    expect(city.transit.monthlyUpkeep()).toBe(line.buses * BUS.upkeepPerBus);
  });

  it('a line without a depot does not run', () => {
    const { city, x0, z0 } = commuterTown();
    for (const b of [...city.buildings.all.values()]) if (b.kind === 'service') city.removeBuilding(b.id);
    const s1 = placeStop(city, x0 + 150, z0 - 10).stop!;
    const s2 = placeStop(city, x0 + 1450, z0 - 10).stop!;
    const line = createLine(city, [s1.id, s2.id]).line!;
    city.transit.refreshRoutes(true);
    expect(line.problem).toBe('depot');
    city.transit.updateRidership();
    expect(line.ridersPerDay).toBe(0);
  });

  it('crowded lines are capped by bus capacity', () => {
    const { city, x0, z0 } = commuterTown();
    const s1 = placeStop(city, x0 + 150, z0 - 10).stop!;
    const s2 = placeStop(city, x0 + 1450, z0 - 10).stop!;
    const line = createLine(city, [s1.id, s2.id]).line!;
    setLineBuses(city, line.id, 1);
    city.transit.refreshRoutes(true);
    line.capacityPerDay = 10;
    // Capacity is recomputed from the fleet; force a tiny one to test the cap.
    const orig = city.transit.refreshRoutes.bind(city.transit);
    city.transit.refreshRoutes = () => {
      orig();
      line.capacityPerDay = 10;
    };
    city.transit.updateRidership();
    expect(line.ridersPerDay).toBeLessThanOrEqual(11);
  });

  it('buses drive the line, stop and keep going', () => {
    const { city, x0, z0 } = commuterTown();
    const s1 = placeStop(city, x0 + 150, z0 - 10).stop!;
    const s2 = placeStop(city, x0 + 900, z0 - 10).stop!;
    const line = createLine(city, [s1.id, s2.id]).line!;
    setLineBuses(city, line.id, 2);
    const v = city.vehicles;
    const buses = () => {
      let n = 0;
      for (let i = 0; i < v.max; i++) if (v.active[i] && v.purpose[i] === Purpose.Transit) n++;
      return n;
    };
    for (let f = 0; f < 60; f++) city.live.update(0.1, 1, 3);
    expect(buses()).toBe(2);
    const arrivedBefore = v.arrived;
    for (let f = 0; f < 4000; f++) city.live.update(0.1, 1, 3);
    expect(v.arrived).toBeGreaterThan(arrivedBefore);
    expect(buses()).toBe(2);
    // Fewer buses: the extra one retires at its next stop.
    setLineBuses(city, line.id, 1);
    for (let f = 0; f < 4000; f++) city.live.update(0.1, 1, 3);
    expect(buses()).toBe(1);
  });

  it('stops follow road splits and removing a stop shortens or deletes lines', () => {
    const { city, x0, z0 } = commuterTown();
    const s1 = placeStop(city, x0 + 150, z0 - 10).stop!;
    const s2 = placeStop(city, x0 + 600, z0 - 10).stop!;
    const s3 = placeStop(city, x0 + 1450, z0 - 10).stop!;
    const line = createLine(city, [s1.id, s2.id, s3.id]).line!;
    const oldSeg = s2.segId;
    // A cross street splits the avenue right next to the middle stop.
    road(city, x0 + 660, z0 - 200, x0 + 660, z0 + 200, 'street');
    expect(city.roads.segments.has(oldSeg)).toBe(false);
    expect(city.roads.segments.has(s2.segId)).toBe(true);
    expect(Math.hypot(s2.x - (x0 + 600), s2.z - (z0 - 10))).toBeLessThan(12);
    city.transit.refreshRoutes(true);
    expect(line.problem).toBe('');
    removeStop(city, s2.id);
    expect(line.stops).toEqual([s1.id, s3.id]);
    removeStop(city, s3.id);
    expect(city.transit.lines.has(line.id)).toBe(false);
  });

  it('survives save and load', () => {
    const { city, x0, z0 } = commuterTown();
    const s1 = placeStop(city, x0 + 150, z0 - 10).stop!;
    const s2 = placeStop(city, x0 + 1450, z0 - 10).stop!;
    const line = createLine(city, [s1.id, s2.id], 'Crosstown').line!;
    setLineBuses(city, line.id, 5);
    const data = JSON.parse(JSON.stringify(serializeCity(city)));
    const loaded = deserializeCity(data, { flatTerrain: 10 });
    const l2 = loaded.transit.lines.get(line.id)!;
    expect(l2.name).toBe('Crosstown');
    expect(l2.buses).toBe(5);
    expect(l2.stops).toEqual([s1.id, s2.id]);
    expect(loaded.transit.stops.get(s1.id)!.segId).toBe(s1.segId);
    loaded.transit.refreshRoutes(true);
    expect(l2.problem).toBe('');
    expect(loaded.transit.nextStopId).toBe(city.transit.nextStopId);
  });

  it('migrates version 1 saves', () => {
    const { city } = commuterTown();
    const data = JSON.parse(JSON.stringify(serializeCity(city)));
    data.version = 1;
    delete data.transit;
    const loaded = deserializeCity(data, { flatTerrain: 10 });
    expect(loaded.transit.stops.size).toBe(0);
  });
});
