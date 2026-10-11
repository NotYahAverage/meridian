import { City } from '../src/sim/City';
import { buildRoad, placeService, previewRoad, snap } from '../src/sim/CityCommands';
import type { RoadTypeId } from '../src/sim/roads/RoadTypes';

/** A flat test city with a highway on the west edge (fast to generate). */
export function makeCity(opts: { empty?: boolean; unlimited?: boolean } = {}): City {
  const city = new City({ name: 'Testville', seed: 1234, preset: 'lakes', flatTerrain: 10, empty: opts.empty, unlimitedMoney: opts.unlimited });
  return city;
}

export function road(city: City, ax: number, az: number, bx: number, bz: number, type: RoadTypeId = 'street', ctrl: { x: number; z: number } | null = null) {
  const s = snap(city, ax, az, type);
  const e = snap(city, bx, bz, type);
  const plan = previewRoad(city, type, s, e, ctrl);
  const res = buildRoad(city, plan);
  return { plan, res };
}

/** Gives a city connected streets plus power, water and sewage. */
export function servicedGrid(city: City): void {
  const sp = city.terrain.spawn;
  const x0 = sp.endX;
  const z0 = sp.endZ;
  road(city, x0, z0, x0 + 400, z0, 'avenue');
  for (let k = 1; k <= 3; k++) road(city, x0 + k * 100, z0 - 200, x0 + k * 100, z0 + 200, 'street');
  const w = placeService(city, 'wind_turbine', x0 + 50, z0 + 30);
  const w2 = placeService(city, 'wind_turbine', x0 + 150, z0 + 30);
  const wt = placeService(city, 'water_tower', x0 + 250, z0 + 30);
  // Flat test terrain has no shoreline, so use the (normally locked) treatment plant for sewage.
  const peak = city.peakPopulation;
  city.peakPopulation = 2500;
  const sw = placeService(city, 'treatment_plant', x0 + 350, z0 + 40);
  city.peakPopulation = peak;
  if (!w.ok || !w2.ok || !wt.ok || !sw.ok) throw new Error(`placement failed ${w.error} ${w2.error} ${wt.error} ${sw.error}`);
}
