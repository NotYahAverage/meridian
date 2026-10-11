import { describe, expect, it } from 'vitest';
import type { City } from '../src/sim/City';
import { bulldozeBuilding, createLine, createMetroLine, placeService, placeStop, previewMetroLine } from '../src/sim/CityCommands';
import { type Building, newBuilding } from '../src/sim/buildings/Buildings';
import { deserializeCity, serializeCity } from '../src/sim/save/Serializer';
import { METRO } from '../src/sim/transit/Metro';
import { BuildingState, Zone } from '../src/sim/types';
import { makeCity, road } from './helpers';

/** Homes at the west end of a long avenue, offices at the east end, a station at each. */
function metroTown(): { city: City; home: Building; work: Building; a: Building; b: Building; x0: number; z0: number } {
  const city = makeCity({ unlimited: true });
  city.peakPopulation = 6000;
  const sp = city.terrain.spawn;
  const x0 = sp.endX, z0 = sp.endZ;
  road(city, x0, z0, x0 + 800, z0, 'avenue');
  road(city, x0 + 800, z0, x0 + 1600, z0, 'avenue');
  const station = (x: number) => {
    const res = placeService(city, 'metro_station', x, z0 + 30);
    if (!res.ok) throw new Error(res.error);
    const b = res.building!;
    b.state = BuildingState.Active;
    b.progress = 1;
    return b;
  };
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
  return { city, home, work, a: station(x0 + 180), b: station(x0 + 1420), x0, z0 };
}

describe('metro', () => {
  it('stations unlock at 5,000 residents', () => {
    const city = makeCity({ unlimited: true });
    const sp = city.terrain.spawn;
    road(city, sp.endX, sp.endZ, sp.endX + 400, sp.endZ, 'avenue');
    city.peakPopulation = 3000;
    expect(placeService(city, 'metro_station', sp.endX + 200, sp.endZ + 30).ok).toBe(false);
    city.peakPopulation = 5000;
    expect(placeService(city, 'metro_station', sp.endX + 200, sp.endZ + 30).ok).toBe(true);
  });

  it('lines cost a fee plus new tunnel; shared tunnels are free', () => {
    const { city, a, b } = metroTown();
    const pv = previewMetroLine(city, [a.id, b.id]);
    expect(pv.error).toBe('');
    // The loop runs both ways through one bored tunnel.
    const d = Math.hypot(a.cx - b.cx, a.cz - b.cz);
    expect(pv.tunnel).toBeCloseTo(d, 0);
    expect(pv.cost).toBe(Math.round(METRO.lineCost + d * METRO.tunnelPerMeter));
    expect(createMetroLine(city, [a.id, b.id]).ok).toBe(true);
    expect(previewMetroLine(city, [b.id, a.id]).cost).toBe(METRO.lineCost);
    expect(createMetroLine(city, [a.id]).ok).toBe(false);
  });

  it('rejects stations that are too close together', () => {
    const { city, a, x0, z0 } = metroTown();
    const near = placeService(city, 'metro_station', x0 + 290, z0 + 30).building!;
    expect(previewMetroLine(city, [a.id, near.id]).error).toMatch(/too close/);
  });

  it('carries commuters and beats the bus on the same corridor', () => {
    const { city, a, b, x0, z0 } = metroTown();
    const depot = placeService(city, 'bus_depot', x0 + 700, z0 + 40).building!;
    depot.state = BuildingState.Active;
    const s1 = placeStop(city, x0 + 150, z0 - 10).stop!;
    const s2 = placeStop(city, x0 + 1450, z0 - 10).stop!;
    createLine(city, [s1.id, s2.id]);
    city.transit.updateRidership();
    const busOnly = city.transit.busRiders;
    expect(busOnly).toBeGreaterThan(5);
    const line = createMetroLine(city, [a.id, b.id]).line!;
    city.transit.updateRidership();
    expect(line.problem).toBe('');
    expect(line.ridersPerDay).toBeGreaterThan(busOnly);
    expect(city.transit.busRiders).toBeLessThan(busOnly);
    expect(city.transit.totalRiders).toBe(city.transit.busRiders + city.transit.metro.totalRiders);
    expect(city.transit.monthlyFares()).toBeGreaterThan(line.ridersPerDay * 30 * METRO.fare * 0.99);
    expect(city.transit.monthlyUpkeep()).toBeGreaterThanOrEqual(line.trains * METRO.upkeepPerTrain);
  });

  it('waits for stations to be finished', () => {
    const { city, a, b } = metroTown();
    b.state = BuildingState.Construction;
    const line = createMetroLine(city, [a.id, b.id]).line!;
    city.transit.updateRidership();
    expect(line.problem).toBe('building');
    expect(line.ridersPerDay).toBe(0);
  });

  it('demolishing a station closes a two-station line', () => {
    const { city, a, b } = metroTown();
    createMetroLine(city, [a.id, b.id]);
    expect(city.transit.metro.lines.size).toBe(1);
    bulldozeBuilding(city, b.id);
    expect(city.transit.metro.lines.size).toBe(0);
    expect(city.transit.metro.tunnels.size).toBe(0);
  });

  it('lines and tunnels survive save/load', () => {
    const { city, a, b } = metroTown();
    const line = createMetroLine(city, [a.id, b.id], 'Harbour Line').line!;
    city.transit.metro.setTrains(line.id, 7);
    const loaded = deserializeCity(JSON.parse(JSON.stringify(serializeCity(city))), { flatTerrain: 10 });
    const l = loaded.transit.metro.lines.get(line.id)!;
    expect(l.name).toBe('Harbour Line');
    expect(l.trains).toBe(7);
    expect(l.stations).toEqual([a.id, b.id]);
    expect(loaded.transit.metro.tunnels.size).toBe(1);
    loaded.transit.updateRidership();
    expect(l.ridersPerDay).toBeGreaterThan(0);
  });
});
