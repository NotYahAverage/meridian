import { describe, expect, it } from 'vitest';
import { generateBuilding } from '../src/render/buildings/generators';
import { fillZone, placeService } from '../src/sim/CityCommands';
import { fastForward } from '../src/sim/CitySim';
import { ROAD_TYPES, ROAD_TYPE_LIST, isFreeway } from '../src/sim/roads/RoadTypes';
import { SERVICE_BY_ID } from '../src/sim/services/ServiceTypes';
import { deserializeCity, serializeCity } from '../src/sim/save/Serializer';
import { Zone, zoneBase } from '../src/sim/types';
import { makeCity, road, servicedGrid } from './helpers';

const NEW_SERVICES = ['police_hq', 'fire_hq', 'library', 'incinerator', 'gas_plant', 'nuclear_plant', 'water_purification'];

describe('expansion content', () => {
  it('every new service has a 3D model with real geometry', () => {
    for (const id of NEW_SERVICES) {
      const st = SERVICE_BY_ID.get(id)!;
      expect(st, id).toBeTruthy();
      const geo = generateBuilding({ style: st.style, w: st.w, d: st.d, floors: 2, level: 1, seed: 7 }, 0, 0, 0, 0);
      expect(geo.vertexCount, id).toBeGreaterThan(100);
      expect(geo.height, id).toBeGreaterThan(5);
    }
  });

  it('new road types build, and expressways count as freeways', () => {
    expect(ROAD_TYPE_LIST.map((t) => t.id)).toEqual(['lane', 'street', 'avenue', 'boulevard', 'parkway', 'highway', 'expressway']);
    expect(isFreeway('expressway') && isFreeway('highway') && !isFreeway('parkway') && !isFreeway('lane')).toBe(true);
    expect(ROAD_TYPES.lane.zoning && !ROAD_TYPES.parkway.zoning).toBe(true);
    const city = makeCity({ unlimited: true });
    city.peakPopulation = 10_000;
    const sp = city.terrain.spawn;
    for (const [i, t] of (['lane', 'parkway', 'expressway'] as const).entries()) {
      const { res, plan } = road(city, sp.endX + 300, sp.endZ - 400 + i * 200, sp.endX + 700, sp.endZ - 400 + i * 200, t);
      expect(plan.error, t).toBeUndefined();
      expect(res.ok, t).toBe(true);
    }
    const names = [...city.roads.segments.values()].map((s) => `${s.type}:${s.name}`);
    expect(names.some((n) => /^lane:.* Lane$/.test(n))).toBe(true);
    expect(names.some((n) => /^parkway:.* Parkway$/.test(n))).toBe(true);
    expect(names.some((n) => /^expressway:Interstate \d+$/.test(n))).toBe(true);
  });

  it('high-density commercial and light industry grow and count as their base zones', () => {
    expect(zoneBase(Zone.CommercialHigh)).toBe(Zone.Commercial);
    expect(zoneBase(Zone.IndustrialLight)).toBe(Zone.Industrial);
    const city = makeCity();
    servicedGrid(city);
    city.peakPopulation = 5_000;
    const sp = city.terrain.spawn;
    fillZone(city, sp.endX + 120, sp.endZ - 100, Zone.ResMed);
    fillZone(city, sp.endX + 180, sp.endZ - 100, Zone.ResLow);
    expect(fillZone(city, sp.endX + 220, sp.endZ + 120, Zone.CommercialHigh).ok).toBe(true);
    expect(fillZone(city, sp.endX + 280, sp.endZ + 120, Zone.IndustrialLight).ok).toBe(true);
    fastForward(city, 24 * 40);
    const zones = [...city.buildings.all.values()].map((b) => b.zone);
    expect(zones).toContain(Zone.CommercialHigh);
    expect(zones).toContain(Zone.IndustrialLight);
    const again = deserializeCity(serializeCity(city), { flatTerrain: 10 });
    expect(again.zones.countZoned(Zone.CommercialHigh)).toBe(city.zones.countZoned(Zone.CommercialHigh));
  });

  it('new utilities supply the grid', () => {
    const city = makeCity({ unlimited: true });
    servicedGrid(city);
    city.peakPopulation = 20_000;
    const sp = city.terrain.spawn;
    expect(placeService(city, 'gas_plant', sp.endX + 150, sp.endZ + 260).ok).toBe(true);
    // Plants are built over a few days before they produce.
    fastForward(city, 24 * 12);
    expect(city.utilities.totals.power.production).toBeGreaterThan(100);
  });
});
