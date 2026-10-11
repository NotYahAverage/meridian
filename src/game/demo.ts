import { City } from '../sim/City';
import { buildRoad, createLine, fillZone, placeService, placeStop, previewRoad, snap } from '../sim/CityCommands';
import { fastForward } from '../sim/CitySim';
import type { RoadTypeId } from '../sim/roads/RoadTypes';
import { BuildingState, Zone } from '../sim/types';
import type { MapPreset } from '../sim/world/Terrain';

/**
 * Builds a small living town for the main-menu backdrop (and as an
 * end-to-end exercise of the simulation at startup).
 */
export function buildDemoCity(seed: number, preset: MapPreset = 'coastal'): City {
  const city = new City({ name: 'Meridian', seed, preset, unlimitedMoney: true });
  city.peakPopulation = 6000;
  const sp = city.terrain.spawn;
  const x0 = sp.endX;
  const z0 = sp.endZ;
  const road = (ax: number, az: number, bx: number, bz: number, t: RoadTypeId) => {
    const plan = previewRoad(city, t, snap(city, ax, az, t), snap(city, bx, bz, t), null);
    if (plan.valid) buildRoad(city, plan);
  };
  road(x0, z0, x0 + 520, z0, 'boulevard');
  for (let k = 0; k < 4; k++) {
    const x = x0 + 110 + k * 120;
    road(x, z0 - 260, x, z0 + 260, k % 2 === 0 ? 'avenue' : 'street');
  }
  for (const dz of [-150, 150]) road(x0 + 70, z0 + dz, x0 + 520, z0 + dz, 'street');
  const zones: [number, number, Zone][] = [
    [x0 + 170, z0 - 200, Zone.ResLow], [x0 + 290, z0 - 210, Zone.ResLow], [x0 + 410, z0 - 200, Zone.ResMed],
    [x0 + 170, z0 - 90, Zone.ResMed], [x0 + 290, z0 - 90, Zone.Commercial], [x0 + 410, z0 - 90, Zone.ResHigh],
    [x0 + 170, z0 + 90, Zone.Commercial], [x0 + 290, z0 + 90, Zone.Office], [x0 + 410, z0 + 90, Zone.ResMed],
    [x0 + 170, z0 + 210, Zone.Industrial], [x0 + 290, z0 + 210, Zone.Industrial], [x0 + 410, z0 + 210, Zone.ResLow],
  ];
  for (const [x, z, zone] of zones) {
    fillZone(city, x - 30, z, zone);
    fillZone(city, x + 30, z, zone);
  }
  // Try a few nearby spots so the layout survives different terrain.
  const place = (id: string, x: number, z: number): boolean => {
    for (const [dx, dz] of [[0, 0], [30, 0], [-30, 0], [0, 40], [0, -40], [60, 20], [-60, -20], [90, 0], [-90, 0]]) {
      if (placeService(city, id, x + dx, z + dz).ok) return true;
    }
    return false;
  };
  place('wind_turbine', x0 + 40, z0 - 40);
  place('wind_turbine', x0 + 70, z0 + 40);
  place('coal_plant', x0 + 470, z0 + 240);
  place('water_tower', x0 + 150, z0 + 30);
  place('water_tower', x0 + 200, z0 - 30);
  place('water_tower', x0 + 420, z0 - 150);
  place('water_tower', x0 + 290, z0 + 160);
  place('treatment_plant', x0 + 300, z0 + 250);
  place('fire_station', x0 + 250, z0 - 30);
  place('police_station', x0 + 370, z0 + 30);
  place('clinic', x0 + 470, z0 - 30);
  place('elementary_school', x0 + 230, z0 - 250);
  place('town_park', x0 + 350, z0 - 170);
  place('plaza', x0 + 330, z0 + 125);
  place('landfill', x0 + 500, z0 + 160);
  // A bus line along the boulevard and back through the north streets.
  place('bus_depot', x0 + 120, z0 + 245);
  const stops: number[] = [];
  for (const [x, z] of [[x0 + 60, z0 - 12], [x0 + 290, z0 - 12], [x0 + 470, z0 + 12], [x0 + 290, z0 + 12]]) {
    for (const dx of [0, 15, -15, 30, -30]) {
      const r = placeStop(city, x + dx, z);
      if (r.ok && r.stop) {
        stops.push(r.stop.id);
        break;
      }
    }
  }
  if (stops.length >= 2) createLine(city, stops, 'Boulevard Line');
  for (const b of city.buildings.all.values()) {
    if (b.typeId === 'bus_depot') {
      b.progress = 1;
      b.state = BuildingState.Active;
    }
  }
  fastForward(city, 24 * 26);
  return city;
}
