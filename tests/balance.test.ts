import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/City';
import { fillZone, placeService } from '../src/sim/CityCommands';
import { tickCity } from '../src/sim/CitySim';
import { Zone } from '../src/sim/types';
import { road } from './helpers';

/** A typical early-game town built the way a player would. */
function typicalTown(): City {
  const city = new City({ name: 'Balance', seed: 99, preset: 'lakes', flatTerrain: 10 });
  const sp = city.terrain.spawn;
  const x0 = sp.endX, z0 = sp.endZ;
  road(city, x0, z0, x0 + 640, z0, 'avenue');
  for (let k = 1; k <= 5; k++) road(city, x0 + k * 110, z0 - 240, x0 + k * 110, z0 + 240, 'street');
  for (let k = 1; k <= 5; k++) {
    const x = x0 + k * 110;
    for (const side of [-25, 25]) {
      fillZone(city, x + side, z0 - 150, k === 5 ? Zone.ResMed : Zone.ResLow);
      fillZone(city, x + side, z0 + 150, k >= 4 ? Zone.Industrial : k === 3 ? Zone.Commercial : Zone.ResLow);
    }
  }
  for (const dx of [80, 200, 300, 420]) fillZone(city, x0 + dx, z0 - 25, Zone.Commercial);
  for (const dx of [20, 45, 70]) placeService(city, 'wind_turbine', x0 + dx, z0 + 30);
  placeService(city, 'water_tower', x0 + 160, z0 + 30);
  placeService(city, 'water_tower', x0 + 260, z0 + 30);
  city.peakPopulation = 2500;
  placeService(city, 'treatment_plant', x0 + 600, z0 + 40);
  city.peakPopulation = 0;
  return city;
}

describe('game balance', () => {
  it('a sensible town grows steadily and the player can respond to its needs', () => {
    const city = typicalTown();
    // Starting construction is front-loaded; give the "player" the usual early grants.
    city.economy.money += 120_000;
    const log: string[] = [];
    let addedServices = false;
    let expanded = false;
    for (let day = 1; day <= 180; day++) {
      for (let h = 0; h < 24; h++) tickCity(city);
      if (!expanded && day === 60) {
        // The player responds to residential demand with a new neighbourhood.
        const sp = city.terrain.spawn;
        road(city, sp.endX + 110, sp.endZ - 240, sp.endX + 550, sp.endZ - 240, 'street');
        road(city, sp.endX + 110, sp.endZ - 360, sp.endX + 550, sp.endZ - 360, 'street');
        for (let k = 1; k <= 5; k++) road(city, sp.endX + k * 110, sp.endZ - 240, sp.endX + k * 110, sp.endZ - 360, 'street');
        for (const z of [-265, -335, -215]) for (const dx of [160, 270, 380, 490]) fillZone(city, sp.endX + dx, sp.endZ + z, Zone.ResMed);
        expanded = true;
      }
      if (!addedServices && city.population.residents > 300) {
        const sp = city.terrain.spawn;
        placeService(city, 'fire_station', sp.endX + 380, sp.endZ + 30);
        placeService(city, 'police_station', sp.endX + 500, sp.endZ - 30);
        placeService(city, 'clinic', sp.endX + 560, sp.endZ - 30);
        placeService(city, 'elementary_school', sp.endX + 330, sp.endZ + 200);
        placeService(city, 'landfill', sp.endX + 580, sp.endZ + 180);
        placeService(city, 'pocket_park', sp.endX + 150, sp.endZ - 200);
        placeService(city, 'wind_turbine', sp.endX + 95, sp.endZ + 30);
        placeService(city, 'water_tower', sp.endX + 400, sp.endZ + 200);
        addedServices = true;
      }
      if (day % 15 === 0) {
        const d = city.demand.value;
        log.push(
          `day ${day}: pop ${city.population.residents} hh ${city.population.households}/${city.stats.housingCapacity} jobs ${city.stats.jobs} emp ${city.stats.employed}/${city.stats.workers} ` +
            `bldg ${city.buildings.count} money ${Math.round(city.economy.money)} net ${Math.round(city.economy.projectedNet)} happy ${Math.round(city.stats.happiness)} ` +
            `D[${Math.round(d.residential)},${Math.round(d.commercial)},${Math.round(d.industrial)},${Math.round(d.office)}] power ${city.utilities.totals.power.consumption.toFixed(1)}/${city.utilities.totals.power.production}`,
        );
      }
    }
    console.log(log.join('\n'));
    expect(city.population.residents).toBeGreaterThan(1000);
    expect(city.economy.money).toBeGreaterThan(0);
    expect(city.stats.employed).toBeGreaterThan(300);
    // A mid-sized town with services should be able to pay its way.
    expect(city.economy.projectedNet).toBeGreaterThan(-500);
  }, 120_000);
});
