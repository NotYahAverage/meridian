// Builds the large benchmark city: a 1.6 km street grid with mixed zoning and
// a full set of services (unlimited money). Used by the bench scripts.
import { City } from '../src/sim/City';
import { buildRoad, fillZone, placeService, previewRoad, snap } from '../src/sim/CityCommands';
import type { RoadTypeId } from '../src/sim/roads/RoadTypes';
import { Zone } from '../src/sim/types';

function road(city: City, ax: number, az: number, bx: number, bz: number, type: RoadTypeId): boolean {
  const plan = previewRoad(city, type, snap(city, ax, az, type), snap(city, bx, bz, type), null);
  return buildRoad(city, plan).ok;
}

export function buildBigCity(size = 1600, step = 100, flat = true): City {
  const city = new City({ name: 'Bench', seed: 7, preset: 'lakes', flatTerrain: flat ? 10 : undefined, unlimitedMoney: true });
  city.peakPopulation = 100_000;
  const sp = city.terrain.spawn;
  const x0 = sp.endX, z0 = sp.endZ;
  const half = size / 2;
  const lines = size / step;
  // East–west and north–south lines; avenues every fourth line.
  for (let i = 0; i <= lines; i++) {
    const z = z0 - half + i * step;
    const type: RoadTypeId = i % 4 === 0 ? 'avenue' : 'street';
    for (let x = x0; x < x0 + size; x += 200) road(city, x, z, x + 200, z, type);
  }
  for (let i = 0; i <= lines; i++) {
    const x = x0 + i * step;
    const type: RoadTypeId = i % 4 === 0 ? 'avenue' : 'street';
    for (let z = z0 - half; z < z0 + half; z += 200) road(city, x, z, x, z + 200, type);
  }
  // Zoning by block: industry in the east, offices and shops on avenues, homes elsewhere.
  for (let i = 0; i < lines; i++) {
    for (let j = 0; j < lines; j++) {
      const bx = x0 + i * step, bz = z0 - half + j * step;
      const cx = bx + step / 2, cz = bz + step / 2;
      let zone: Zone;
      if (i >= lines - 3) zone = Zone.Industrial;
      else if (i % 4 === 0 && j % 3 === 0) zone = j % 2 === 0 ? Zone.Office : Zone.Commercial;
      else if (Math.hypot(cx - (x0 + half), cz - z0) < 520) zone = Zone.ResHigh;
      else zone = (i + j) % 2 === 0 ? Zone.ResMed : Zone.ResLow;
      for (const [dx, dz] of [[0, -step / 2 + 12], [0, step / 2 - 12], [-step / 2 + 12, 0], [step / 2 - 12, 0]]) {
        fillZone(city, cx + dx, cz + dz, zone);
      }
    }
  }
  // Services on a coarse grid at block centres (blocks are zoned, so these replace zoning).
  const services: [string, number][] = [
    ['coal_plant', 800], ['water_tower', 220], ['treatment_plant', 700], ['fire_station', 400], ['police_station', 400],
    ['clinic', 450], ['hospital', 900], ['elementary_school', 400], ['high_school', 800], ['landfill', 900],
    ['recycling_center', 900], ['town_park', 350], ['wind_turbine', 300],
  ];
  let placed = 0, failed = 0;
  const errors = new Map<string, number>();
  for (const [id, spacing] of services) {
    for (let x = x0 + spacing / 2; x < x0 + size; x += spacing) {
      for (let z = z0 - half + spacing / 2; z < z0 + half; z += spacing) {
        let r = placeService(city, id, x + 37, z + 37);
        for (const [dx, dz] of [[60, 37], [37, 60], [-37, 37], [37, -37], [60, 60], [-60, 37], [37, -60], [0, 37], [37, 0]]) {
          if (r.ok) break;
          r = placeService(city, id, x + dx, z + dz);
        }
        if (r.ok) placed++;
        else { failed++; errors.set(id + ': ' + r.error, (errors.get(id + ': ' + r.error) ?? 0) + 1); }
      }
    }
  }
  if (errors.size) console.log('placement failures:', [...errors]);
  console.log(`built: ${city.roads.segments.size} segments, ${placed} services placed (${failed} failed)`);
  return city;
}

