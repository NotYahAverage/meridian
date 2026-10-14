import { clamp, formatInt, formatMoney, lerp } from '../core/math';
import { isFreeway } from './roads/RoadTypes';
import { checkScenario } from './progress/Scenarios';
import type { LandValueMods } from './landvalue/LandValue';
import { householdSize } from './buildings/Archetypes';
import { archetypesFor, capacityFor } from './buildings/Archetypes';
import type { Building } from './buildings/Buildings';
import type { City } from './City';
import { DAYS_PER_MONTH, GRID_CELL, GRID_RES, TICKS_PER_DAY } from './constants';
import type { DemandInputs } from './demand/Demand';
import { GOALS, MILESTONES, milestoneIndexFor, unlocksAt } from './progress/Progress';
import { Coverage, LANDFILL_CAPACITY } from './services/Coverage';
import { COVERAGE_KINDS, SERVICE_BY_ID } from './services/ServiceTypes';
import { Purpose, VM } from './traffic/Vehicles';
import { BuildingState, type DemandKind, Problem, Zone, isResidential, zoneBase } from './types';
import type { WeatherKind } from './world/Weather';
import { lineProblemText } from './transit/Transit';
import { buildingUse } from './utilities/Utilities';

const R_ZONES = [Zone.ResLow, Zone.ResMed, Zone.ResHigh];
const KIND_ZONES: Record<DemandKind, Zone[]> = {
  residential: R_ZONES,
  commercial: [Zone.Commercial, Zone.CommercialHigh],
  industrial: [Zone.Industrial, Zone.IndustrialLight],
  office: [Zone.Office],
};

function weatherNotice(city: City, kind: WeatherKind): void {
  if (city.population.residents < 50) return;
  const w = city.weather;
  if (kind === 'storm') {
    city.news.weather('storm');
    city.emitNotice({ severity: 'warning', icon: 'weather', title: 'Thunderstorm', text: 'Heavy rain and lightning are rolling in. Wet roads slow traffic for a while.' }, 'weather-storm', 24 * 4);
  } else if ((kind === 'rain' || kind === 'snow') && w.temperature <= 0.5) {
    city.news.weather('snow');
    city.emitNotice({ severity: 'info', icon: 'weather', title: 'Snowfall', text: 'Snow is settling on the city. Slippery roads mean slower traffic until it melts.' }, 'weather-snow', 24 * 10);
  } else if (kind === 'fog') {
    city.news.weather('fog');
    city.emitNotice({ severity: 'info', icon: 'weather', title: 'Fog', text: 'Thick fog this morning. Drivers are taking it slowly.' }, 'weather-fog', 24 * 10);
  }
}

/**
 * Running a city gets more expensive per resident as it grows (courts,
 * planning, IT, staff). A City Hall makes the administration 15% cheaper.
 */
export function administrationCost(city: City): number {
  const pop = city.stats.population;
  if (pop < 200) return 0;
  let hall = false;
  for (const b of city.buildings.all.values()) if (b.typeId === 'city_hall' && b.state === BuildingState.Active) hall = true;
  return 0.13 * Math.pow(pop, 1.3) * (hall ? 0.85 : 1);
}

/**
 * Monthly tourism from landmarks and the airport, plus overnight stays in
 * hotels (which can add up to 60% more). Visitors stay away from an unhappy city.
 */
export function tourismIncome(city: City): number {
  let t = 0, stays = 0;
  for (const b of city.buildings.all.values()) {
    if (b.state !== BuildingState.Active) continue;
    if (b.kind === 'service') {
      const st = SERVICE_BY_ID.get(b.typeId);
      if (st?.tourism) t += st.tourism;
    } else if (b.typeId === 'hotel') stays += 55 * b.floors * (0.6 + 0.2 * b.level) * (b.workers / Math.max(1, b.jobs));
  }
  return (t + Math.min(stays, t * 0.6)) * (0.4 + 0.6 * clamp(city.stats.happiness / 100, 0, 1));
}

/** Refreshes the monthly budget projection. */
export function projectEconomy(city: City): void {
  city.transit.refreshRoutes();
  const pol = city.policies;
  city.economy.project(city.buildings, city.roads, (x, z) => city.landValue.at(x, z), {
    fares: city.transit.monthlyFares(),
    upkeep: city.transit.monthlyUpkeep(),
    policyCost: pol.monthlyCost(),
    tourism: tourismIncome(city),
    admin: administrationCost(city),
    research: city.research.monthlyCost(),
    taxScale: { commercial: pol.has('smallBusiness') ? 0.8 : 1, industrial: pol.has('industryIncentives') ? 0.7 : 1 },
  });
}

/** Households whose trips are added up per tick while recomputing traffic demand. */
const DEMAND_SLICE = 20_000;
/** Services splatted per tick during the periodic coverage refresh. */
const COVERAGE_SLICE = 150;

/** Advances the city by one simulation tick (one game hour). */
export function tickCity(city: City): void {
  city.clock.tick++;
  const t = city.clock.tick;
  city.economy.accrueHour();
  const weatherChange = city.weather.tick(city.clock.month, city.clock.hour);
  if (weatherChange) weatherNotice(city, weatherChange);
  progressConstruction(city);
  updateFires(city);
  // Periodic work is staggered across hours so no single tick does it all.
  if (t < 3) {
    city.recomputeUtilities();
    refreshStats(city);
    city.demand.update(demandInputs(city));
    projectEconomy(city);
  } else if (t % 6 === 3) {
    city.recomputeUtilities();
    refreshStats(city);
  } else if (t % 6 === 4) {
    city.demand.update(demandInputs(city));
  } else if (t % 6 === 5) {
    projectEconomy(city);
  }
  growBuildings(city);
  moveIn(city);
  matchJobs(city, 350);
  city.traffic.step(14);
  checkGoals(city);
  const hour = city.clock.hour;
  city.disasters.tickHour();
  if (city.coverageDirty) {
    // Something was built or removed: the player sees the new coverage at once.
    city.coverageJob = null;
    city.coverage.recompute(city.buildings);
    city.coverageDirty = false;
  } else if (hour === 9 && city.clock.day % 2 === 0) {
    city.coverageJob = city.coverage.recomputeSteps(city.buildings, COVERAGE_SLICE);
  }
  if (city.coverageJob && city.coverageJob.next().done) city.coverageJob = null;
  if (hour === 0) {
    daily(city);
    if (city.clock.day % DAYS_PER_MONTH === 0) monthly(city);
  } else if (hour === 14) {
    // Land value is worked out a pass per hour.
    city.landValueJob = city.landValue.updateSteps(city.buildings, city.roads, city.coverage, city.traffic, 0.3, city.transit.servedStops(), landValueMods(city));
  } else if (hour === 19) {
    dailyLate(city);
  } else if (hour === 3) {
    city.transit.updateRidership();
  } else if (hour === 4 && city.clock.day % 2 === 0) {
    city.trips.refresh();
    // Trip demand is added up a slice at a time over the next few hours in big cities.
    city.demandJob = city.trips.demandSteps(DEMAND_SLICE);
  }
  if (city.landValueJob && city.landValueJob.next().done) city.landValueJob = null;
  if (city.demandJob) {
    const r = city.demandJob.next();
    if (r.done) {
      city.demandJob = null;
      city.traffic.setDemand(r.value);
    }
  }
}

/** Land-value modifiers from the Clean Air Act and Park Rangers (city-wide or per district). */
export function landValueMods(city: City): LandValueMods {
  const pol = city.policies;
  const grid = city.districts.grid;
  const rm = city.research.mods;
  return {
    pollution: (b) => {
      const kind = b.kind === 'service' ? SERVICE_BY_ID.get(b.typeId)?.kind : undefined;
      const research = b.kind === 'zoned' ? rm.industryPollution : (kind === 'power' ? rm.powerPollution : 1) * (kind ? rm.retrofitPollution[kind] ?? 1 : 1);
      return (pol.in('cleanAir', b.district) ? 0.6 : 1) * research;
    },
    parks: (cell) => (pol.in('parkRangers', grid[cell]) ? 1.3 : 1),
    trees: city.nature.cells,
    bonus: rm.landValue,
  };
}

// ── Construction ────────────────────────────────────────────────────────────

function progressConstruction(city: City): void {
  for (const b of city.buildings.all.values()) {
    if (b.progress >= 1) continue;
    if (b.state !== BuildingState.Construction && b.state !== BuildingState.Active) continue;
    b.progress = Math.min(1, b.progress + 1 / (Math.max(0.5, b.buildDays) * TICKS_PER_DAY));
    if (b.progress >= 1 && b.state === BuildingState.Construction) {
      b.state = BuildingState.Active;
      b.age = 0;
      city.events.emit('completed', { id: b.id });
      if (b.kind === 'service') {
        city.coverageDirty = true;
        city.recomputeUtilities();
        const st = SERVICE_BY_ID.get(b.typeId);
        if (st) city.news.opened(st.id, b.cx, b.cz);
        if (st) city.emitNotice({ severity: 'good', icon: 'build', title: `${st.name} is open`, text: 'Construction finished and the facility is now operating.', x: b.cx, z: b.cz });
      } else if (isResidential(b.zone)) {
        city.vacantHomes.push(b.id);
      } else {
        city.openJobs.push(b.id);
      }
    }
  }
}

// ── Growth ──────────────────────────────────────────────────────────────────

export function canSupply(city: City, segId: number): boolean {
  if (!city.isConnectedToOutside(segId)) {
    city.growthBlocked.add('connection');
    return false;
  }
  const comp = city.componentOfSegment(segId);
  const u = city.utilities;
  let ok = true;
  if (u.available('power', comp) <= 0.01) {
    city.growthBlocked.add('power');
    ok = false;
  }
  if (u.available('water', comp) <= 1) {
    city.growthBlocked.add('water');
    ok = false;
  }
  if (u.available('sewage', comp) <= 1) {
    city.growthBlocked.add('sewage');
    ok = false;
  }
  return ok;
}

function growBuildings(city: City): void {
  const pop = city.stats.population;
  const rng = city.rng;
  const lists = city.zones.zoneLists();
  for (const kind of ['residential', 'commercial', 'industrial', 'office'] as DemandKind[]) {
    const dv = city.demand.value[kind];
    if (dv < 4) continue;
    const zones = KIND_ZONES[kind];
    let zoned = 0;
    for (const z of zones) zoned += lists[z].length;
    if (!zoned) continue;
    const expected = Math.min(4, (dv / 100) * (0.4 + pop / 5000));
    const n = Math.floor(expected) + (rng.chance(expected % 1) ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const zone = rng.weighted(zones, (z) => lists[z].length)!;
      const b = city.spawner.trySpawn(zone, rng, 6, (seg) => canSupply(city, seg.id));
      if (!b) continue;
      city.addBuilding(b);
      const comp = city.componentOfSegment(b.segId);
      const full = { ...b, households: b.hhCap, workers: b.jobs } as Building;
      city.utilities.reserve('power', comp, buildingUse(full, 'power'));
      city.utilities.reserve('water', comp, buildingUse(full, 'water'));
      city.utilities.reserve('sewage', comp, buildingUse(full, 'sewage'));
    }
  }
}

function sampleHouseholdSize(city: City, zone: Zone): number {
  const avg = householdSize(zone);
  const r = city.rng;
  const g = (r.next() + r.next() + r.next() - 1.5) * 1.6;
  return clamp(Math.round(avg + g), 1, 6);
}

function moveIn(city: City): void {
  const rd = city.demand.attraction;
  if (rd < 3 || !city.vacantHomes.length) return;
  const rng = city.rng;
  const rate = Math.min(30, (rd / 100) * (0.8 + city.stats.population * 0.0012 + city.vacantHomes.length * 0.06));
  let n = Math.floor(rate) + (rng.chance(rate % 1) ? 1 : 0);
  let guard = 0;
  while (n > 0 && city.vacantHomes.length && guard++ < 60) {
    const k = Math.floor(rng.next() * city.vacantHomes.length);
    const b = city.buildings.get(city.vacantHomes[k]);
    if (!b || b.state !== BuildingState.Active || b.households >= b.hhCap || !b.power || !b.water || !b.segId || !city.isConnectedToOutside(b.segId)) {
      city.vacantHomes[k] = city.vacantHomes[city.vacantHomes.length - 1];
      city.vacantHomes.pop();
      continue;
    }
    // Newcomers look around first: few choose a home its neighbours are leaving.
    if (b.happiness < 42 && rng.chance(clamp((42 - b.happiness) / 16, 0, 0.95))) {
      n--;
      continue;
    }
    const size = sampleHouseholdSize(city, b.zone);
    let workers: number;
    if (size === 1) workers = rng.chance(0.78) ? 1 : 0;
    else workers = rng.chance(0.12) ? 0 : rng.chance(0.55) ? 2 : 1;
    const eduChance = 0.18 + 0.6 * city.coverage.at('education', b.cx, b.cz) + 0.18 * campusReach(city, b.cx, b.cz);
    let educated = 0;
    for (let w = 0; w < workers; w++) if (rng.chance(eduChance)) educated++;
    city.addHousehold(b, size, workers, educated);
    n--;
    if (rng.chance(0.1)) {
      const out = city.outsidePoint();
      if (out) city.live.spawn(out, { segId: b.segId, s: b.segS }, VM.van, 0xe9e6df, Purpose.MoveIn);
    }
  }
}

/** Operating universities, cached until coverage next changes. */
const campusCache = new WeakMap<City, { version: number; list: Building[] }>();
function universities(city: City): Building[] {
  const hit = campusCache.get(city);
  if (hit && hit.version === city.coverage.version) return hit.list;
  const list = [...city.buildings.all.values()].filter((b) => b.typeId === 'university' && b.state === BuildingState.Active && Coverage.isOperational(b));
  campusCache.set(city, { version: city.coverage.version, list });
  return list;
}

/** 1 next to a university, falling to 0 at the edge of its reach. */
export function campusReach(city: City, x: number, z: number): number {
  let best = 0;
  for (const u of universities(city)) {
    const r = SERVICE_BY_ID.get('university')!.radius;
    const d = Math.hypot(u.cx - x, u.cz - z);
    if (d < r) best = Math.max(best, 1 - d / r);
  }
  return best;
}

function rebuildOpenJobs(city: City): void {
  city.openJobs = [];
  for (const b of city.buildings.all.values()) {
    if (b.jobs > b.workers && b.state === BuildingState.Active && b.segId) city.openJobs.push(b.id);
  }
}

function matchJobs(city: City, budget: number): void {
  const pop = city.population;
  if (!pop.count) return;
  if (!city.openJobs.length) return;
  const rng = city.rng;
  const comps = city.roads.components();
  const compOf = (segId: number) => {
    const s = city.roads.segments.get(segId);
    return s ? comps.get(s.a) ?? -1 : -1;
  };
  let scanned = 0;
  while (scanned < Math.min(budget, pop.count)) {
    const i = city.jobCursor % pop.count;
    city.jobCursor = (city.jobCursor + 1) % pop.count;
    scanned++;
    if (!pop.alive[i] || pop.unemployedIn(i) === 0) continue;
    const home = city.buildings.get(pop.home[i]);
    if (!home || !home.segId) continue;
    const comp = compOf(home.segId);
    for (let k = 0; k < pop.workers[i]; k++) {
      if (pop.job[i * 2 + k]) continue;
      const educated = k < pop.educated[i];
      let best: Building | null = null;
      let bestD = Infinity;
      for (let tries = 0; tries < 10 && city.openJobs.length; tries++) {
        const idx = Math.floor(rng.next() * city.openJobs.length);
        const w = city.buildings.get(city.openJobs[idx]);
        if (!w || w.workers >= w.jobs || w.state !== BuildingState.Active) {
          city.openJobs[idx] = city.openJobs[city.openJobs.length - 1];
          city.openJobs.pop();
          continue;
        }
        if (w.zone === Zone.Office && !educated) continue;
        if (compOf(w.segId) !== comp) continue;
        let d = (w.cx - home.cx) ** 2 + (w.cz - home.cz) ** 2;
        if (educated && w.zone === Zone.Office) d *= 0.5;
        if (d < bestD) {
          bestD = d;
          best = w;
        }
      }
      if (best) {
        pop.setJob(i, k, best.id);
        best.workers++;
      }
    }
  }
}

// ── Fires ───────────────────────────────────────────────────────────────────

function updateFires(city: City): void {
  for (const b of city.buildings.all.values()) {
    if (b.state !== BuildingState.Burning) continue;
    b.fireHours++;
    const cov = city.coverage.at('fire', b.cx, b.cz);
    if (cov >= 0.15 && b.fireHours >= 5 + 16 * (1 - cov)) {
      b.state = BuildingState.Active;
      b.fireHours = 0;
      b.unhappyDays += 4;
      city.news.fireSaved();
      city.emitNotice({ severity: 'good', icon: 'fire', title: 'Fire extinguished', text: `Firefighters saved a building on ${streetOf(city, b)}.`, x: b.cx, z: b.cz });
    } else if (b.fireHours >= 22) {
      const x = b.cx, z = b.cz;
      const where = streetOf(city, b);
      city.removeBuilding(b.id, 'fire');
      city.news.fireLost(where, x, z);
      city.emitNotice({ severity: 'critical', icon: 'fire', title: 'Building destroyed by fire', text: `A fire burned down a building on ${where}. Fire stations protect nearby buildings.`, x, z });
    }
  }
}

function startFire(city: City, b: Building): void {
  b.state = BuildingState.Burning;
  b.fireHours = 0;
  const cov = city.coverage.at('fire', b.cx, b.cz);
  city.events.emit('fire', { id: b.id, x: b.cx, z: b.cz });
  if (cov >= 0.15) {
    city.live.dispatch('fire', b);
    city.emitNotice({ severity: 'warning', icon: 'fire', title: 'Fire reported', text: `Fire crews are responding to ${streetOf(city, b)}.`, x: b.cx, z: b.cz });
  } else {
    city.emitNotice({ severity: 'critical', icon: 'fire', title: 'Fire out of control', text: `A building on ${streetOf(city, b)} is burning with no fire station in range!`, x: b.cx, z: b.cz });
  }
}

export function streetOf(city: City, b: Building): string {
  const seg = city.roads.segments.get(b.segId);
  return seg?.name || 'an unnamed road';
}

// ── Daily / monthly ─────────────────────────────────────────────────────────

function daily(city: City): void {
  city.achievements.check();
  city.research.daily();
  city.design.daily();
  city.terrain.regrow(9);
  city.nature.grow(city.clock.day);
  dailyBuildings(city);
  refreshStats(city);
  recordHistory(city);
  checkMilestones(city);
  dailyNotices(city);
  city.growthBlocked.clear();
}

/** The households' half of the day's bookkeeping, a few hours after daily() so the two don't land in one tick. */
function dailyLate(city: City): void {
  dailyHouseholds(city);
  // Visible-trip sampling needs current residents and jobs every day.
  city.trips.refresh();
  rebuildVacancies(city);
  rebuildOpenJobs(city);
}

function rebuildVacancies(city: City): void {
  city.vacantHomes = [];
  for (const b of city.buildings.all.values()) {
    if (b.state === BuildingState.Active && isResidential(b.zone) && b.households < b.hhCap) city.vacantHomes.push(b.id);
  }
}

/** Index of the analysis-grid cell (coverage, land value, districts) containing a point. */
function gridCell(x: number, z: number): number {
  return clamp(Math.floor(z / GRID_CELL), 0, GRID_RES - 1) * GRID_RES + clamp(Math.floor(x / GRID_CELL), 0, GRID_RES - 1);
}

function dailyBuildings(city: City): void {
  const cov = city.coverage;
  const lvMap = city.landValue;
  const stats = city.stats;
  const tax = city.economy.taxes;
  const rng = city.rng;
  const outsideConnected = !!city.outsidePoint();
  let comJobs = 0, indJobs = 0;
  for (const b of city.buildings.all.values()) {
    if (b.state !== BuildingState.Active) continue;
    if (zoneBase(b.zone) === Zone.Commercial) comJobs += b.workers;
    if (zoneBase(b.zone) === Zone.Industrial) indJobs += b.workers;
  }
  const goodsRatio = comJobs > 0 ? Math.min(1, (indJobs * 1.6) / comJobs) : 1;

  const pol = city.policies;
  // Policy effects depend on the building's district (or apply city-wide).
  const rm = city.research.mods;
  const garbageScale = (b: Building) => (pol.in('recycling', b.district) ? 0.7 : 1) * rm.garbage;
  const crimeThreshold = (b: Building) => (pol.in('neighborhoodWatch', b.district) ? 0.04 : 0.12);
  const parkWeight = (b: Building) => (pol.in('parkRangers', b.district) ? 17 : 13);
  const transitMood = pol.has('freeTransit') ? 1.5 : 0;
  const policyMood = (b: Building) => (pol.in('neighborhoodWatch', b.district) ? 2 : 0) + transitMood + (pol.in('highRiseBan', b.district) ? 3 : 0);
  // Garbage collection capacity.
  let capacity = 0;
  const facilities: Building[] = [];
  for (const b of city.buildings.all.values()) {
    if (!Coverage.isOperational(b)) continue;
    const st = SERVICE_BY_ID.get(b.typeId);
    if (st?.kind !== 'garbage') continue;
    if (st.id === 'landfill' && b.stock >= LANDFILL_CAPACITY) continue;
    capacity += st.capacity * city.economy.funding('garbage');
    facilities.push(b);
  }
  let coveredGen = 0;
  for (const b of city.buildings.all.values()) {
    if (b.kind !== 'zoned' || b.state !== BuildingState.Active) continue;
    coveredGen += (b.residents * 0.1 + b.workers * 0.08) * garbageScale(b) * cov.grids.garbage[gridCell(b.cx, b.cz)];
  }
  const garbageEff = coveredGen > 0 ? Math.min(1, capacity / coveredGen) : 1;
  let collected = 0;

  const removeList: number[] = [];
  let abandonedToday = 0;
  const grids = cov.grids;
  for (const b of city.buildings.all.values()) {
    // One grid lookup per building; the coverage, land-value and district maps share the grid.
    const ci = gridCell(b.cx, b.cz);
    b.district = city.districts.grid[ci];
    if (b.state === BuildingState.Abandoned) {
      b.age++;
      if (b.age > 16) removeList.push(b.id);
      continue;
    }
    if (b.state === BuildingState.Construction) continue;
    b.age++;
    const lv = lvMap.value[ci];
    b.landValue = lv;
    if (b.kind === 'service') {
      b.problems = b.segId ? 0 : Problem.NoRoad;
      continue;
    }
    if (b.state !== BuildingState.Active) continue;

    // Garbage
    const gen = (b.residents * 0.1 + b.workers * 0.08) * garbageScale(b);
    b.garbage += gen;
    const gc = grids.garbage[ci];
    if (gc > 0.05) {
      const take = Math.min(b.garbage, gen * 2.4 * gc * garbageEff + 0.5 * gc * garbageEff);
      b.garbage -= take;
      collected += take;
    }

    let p = 0;
    if (!b.power) p |= Problem.NoPower;
    if (!b.water) p |= Problem.NoWater;
    if (!b.sewage) p |= Problem.NoSewage;
    if (!b.segId) p |= Problem.NoRoad;
    if (b.garbage > gen * 7 + 6) p |= Problem.Garbage;
    if (b.jobs > 0 && b.age > 20 && b.workers < b.jobs * 0.25) p |= Problem.NoWorkers;
    const residential = isResidential(b.zone);
    // Sickness and crime grow in gradually with the city; a hard population
    // threshold made towns hover around it, losing and regaining residents.
    const sick = residential ? clamp((stats.population - 450) / 650, 0, 1) : 0;
    const crime = clamp((stats.population - 900) / 700, 0, 1);
    if (sick > 0 && grids.health[ci] < 0.12) p |= Problem.Sickness;
    if (crime > 0 && grids.police[ci] < crimeThreshold(b)) p |= Problem.Crime;
    if (zoneBase(b.zone) === Zone.Commercial && goodsRatio < 0.35 && !outsideConnected) p |= Problem.NoGoods;
    b.problems = p;

    const seg = city.roads.segments.get(b.segId);
    const ratio = seg ? city.traffic.ratio(seg.id) : 0;
    let h: number;
    if (residential) {
      h = 52;
      h += 12 * grids.police[ci] + 10 * grids.health[ci] + 9 * grids.education[ci];
      h += 6 * grids.fire[ci] + parkWeight(b) * grids.park[ci] + policyMood(b);
      h += (lv - 0.35) * 30;
      h -= lvMap.pollution[ci] * 38 + lvMap.noise[ci] * 16;
      h -= (tax.residential - 9) * 1.6;
      h -= Math.max(0, city.traffic.avgTripMinutes - 16) * 0.7;
      h -= Math.max(0, stats.unemployment - 0.1) * 70;
    } else {
      h = 56 + (lv - 0.35) * 20 + 8 * grids.police[ci] + 6 * grids.fire[ci];
      const cat = zoneBase(b.zone) === Zone.Commercial ? 'commercial' : zoneBase(b.zone) === Zone.Industrial ? 'industrial' : 'office';
      h -= (tax[cat] - 9) * 1.6;
      h -= Math.max(0, ratio - 1) * 22;
    }
    if (p & Problem.NoPower) h -= 28;
    if (p & Problem.NoWater) h -= 28;
    if (p & Problem.NoSewage) h -= 16;
    if (p & Problem.Garbage) h -= 14;
    if (p & Problem.NoRoad) h -= 40;
    if (p & Problem.Sickness) h -= 8 * sick;
    if (p & Problem.Crime) h -= 8 * crime;
    if (p & Problem.NoWorkers) h -= 12;
    if (p & Problem.NoGoods) h -= 10;
    h += rm.happiness;
    b.happiness = lerp(b.happiness, clamp(h, 0, 100), 0.35);

    // Business efficiency.
    if (b.jobs > 0) {
      const staff = 0.35 + 0.65 * Math.min(1, b.workers / Math.max(1, b.jobs));
      let eff = staff;
      if (zoneBase(b.zone) === Zone.Commercial) eff *= outsideConnected ? 0.85 + 0.15 * goodsRatio : Math.max(0.3, goodsRatio);
      if (zoneBase(b.zone) === Zone.Industrial) eff *= (outsideConnected ? 1 : 0.6) * rm.industryEfficiency;
      if (ratio > 1.15) eff *= 0.85;
      b.efficiency = clamp(eff, 0.1, 1);
    }

    // Abandonment.
    const severe = p & (Problem.NoPower | Problem.NoWater | Problem.NoSewage | Problem.NoRoad);
    if (severe || b.happiness < 22) b.unhappyDays++;
    else b.unhappyDays = Math.max(0, b.unhappyDays - 2);
    if (b.unhappyDays > 26) {
      abandon(city, b);
      abandonedToday++;
      continue;
    }

    if (b.rezoneDays > 0) {
      b.rezoneDays--;
      if (b.rezoneDays === 0) {
        removeList.push(b.id);
        continue;
      }
    }

    const fc = grids.fire[ci];
    const risk = 0.00032 * (1 - fc) * (1 - fc) * (b.zone === Zone.Industrial ? 2.2 : b.zone === Zone.IndustrialLight ? 1.3 : 1) * (1 + Math.min(1, b.age / 400)) * city.weather.fireRisk() * (pol.in('smokeDetectors', b.district) ? 0.55 : 1);
    if (rng.chance(risk)) startFire(city, b);
  }

  // Distribute collected garbage among facilities.
  if (collected > 0 && facilities.length) {
    for (const f of facilities) {
      const st = SERVICE_BY_ID.get(f.typeId)!;
      if (st.id === 'landfill') f.stock += collected * (st.capacity / Math.max(1, capacity));
    }
  }
  // Recycling centres with spare capacity work through old landfill waste, so full landfills recover.
  let recCap = 0;
  for (const f of facilities) if (f.typeId === 'recycling_center' || f.typeId === 'incinerator') recCap += (SERVICE_BY_ID.get(f.typeId)?.capacity ?? 0) * city.economy.funding('garbage');
  if (recCap > 0) {
    let spare = Math.max(0, recCap - (capacity > 0 ? collected * (recCap / capacity) : 0)) * 0.6;
    for (const f of city.buildings.all.values()) {
      if (spare <= 0) break;
      if (f.typeId !== 'landfill' || f.stock <= 0 || f.state !== BuildingState.Active) continue;
      const take = Math.min(f.stock, spare);
      f.stock -= take;
      spare -= take;
    }
  }
  for (const id of removeList) city.removeBuilding(id, 'abandoned');
  if (abandonedToday > 0) {
    city.emitNotice(
      { severity: 'warning', icon: 'people', title: `${abandonedToday} building${abandonedToday > 1 ? 's' : ''} abandoned`, text: 'Residents and businesses leave when utilities fail or they are unhappy for too long.' },
      'abandoned',
      24 * 6,
    );
  }
}

function abandon(city: City, b: Building): void {
  for (const h of city.population.householdsIn(b.id)) city.removeHousehold(h);
  if (b.jobs > 0) {
    city.population.releaseWorkplace(b.id);
    b.workers = 0;
  }
  b.state = BuildingState.Abandoned;
  b.age = 0;
}

function dailyHouseholds(city: City): void {
  const pop = city.population;
  const rng = city.rng;
  for (let i = 0; i < pop.count; i++) {
    if (!pop.alive[i]) continue;
    const home = city.buildings.get(pop.home[i]);
    if (!home) {
      pop.remove(i);
      continue;
    }
    pop.happiness[i] = home.happiness;
    // Unhappy households drift away, faster the unhappier they are.
    if (home.happiness < 34 && rng.chance(0.05 * clamp((34 - home.happiness) / 14, 0, 1))) {
      city.removeHousehold(i);
      continue;
    }
    if (pop.workers[i] > 0 && pop.unemployedIn(i) === pop.workers[i] && city.clock.tick - pop.moveInTick[i] > TICKS_PER_DAY * 40 && rng.chance(0.012)) {
      city.removeHousehold(i);
      continue;
    }
    if (pop.educated[i] < pop.workers[i]) {
      const ec = city.coverage.at('education', home.cx, home.cz);
      const uni = 1 + 1.5 * campusReach(city, home.cx, home.cz);
      if (ec > 0 && rng.chance(0.01 * ec * uni * (city.policies.in('adultEducation', home.district) ? 2.5 : 1))) pop.upgradeEducation(i);
    }
  }
}

export function refreshStats(city: City): void {
  const pop = city.population;
  const s = city.stats;
  let cap = 0, pending = 0, jobs = 0, hsum = 0, hw = 0, n = 0;
  for (const b of city.buildings.all.values()) {
    n++;
    if (b.state === BuildingState.Construction && isResidential(b.zone)) pending += b.hhCap;
    if (b.state !== BuildingState.Active) continue;
    if (isResidential(b.zone)) {
      cap += b.hhCap;
      if (b.residents > 0) {
        hsum += b.happiness * b.residents;
        hw += b.residents;
      }
    }
    jobs += b.jobs;
  }
  s.population = pop.residents;
  s.households = pop.households;
  s.housingCapacity = cap;
  s.pendingHousing = pending;
  s.jobs = jobs;
  s.employed = pop.employed;
  s.workers = pop.workerCount;
  s.happiness = hw > 0 ? hsum / hw : 60;
  s.buildings = n;
  s.unemployment = pop.workerCount > 0 ? (pop.workerCount - pop.employed) / pop.workerCount : 0;
}

export function demandInputs(city: City): DemandInputs {
  const jobs = { commercial: 0, industrial: 0, office: 0, service: 0 };
  const filled = { commercial: 0, industrial: 0, office: 0, service: 0 };
  let lvSum = 0, lvN = 0;
  for (const b of city.buildings.all.values()) {
    if (b.state !== BuildingState.Active) continue;
    const zb = zoneBase(b.zone);
    const k = b.kind === 'service' ? 'service' : zb === Zone.Commercial ? 'commercial' : zb === Zone.Industrial ? 'industrial' : zb === Zone.Office ? 'office' : null;
    if (k) {
      jobs[k] += b.jobs;
      filled[k] += b.workers;
    }
    if (b.kind === 'zoned') {
      lvSum += b.landValue;
      lvN++;
    }
  }
  let score = 0;
  for (const kind of COVERAGE_KINDS) score += city.coverage.averageFor(kind, city.buildings);
  score /= COVERAGE_KINDS.length;
  let vol = 0, wsum = 0;
  for (const [id, v] of city.traffic.volume) {
    if (v <= 0) continue;
    vol += city.traffic.ratio(id) * v;
    wsum += v;
  }
  const pop = city.population;
  let eduEmployed = 0;
  for (let i = 0; i < pop.count; i++) {
    if (!pop.alive[i]) continue;
    for (let k = 0; k < pop.educated[i]; k++) if (pop.job[i * 2 + k]) eduEmployed++;
  }
  const t = city.economy.taxes;
  return {
    connected: !!city.outsidePoint(),
    population: pop.residents,
    households: pop.households,
    housingCapacity: city.stats.housingCapacity,
    pendingHousing: city.stats.pendingHousing,
    workers: pop.workerCount,
    employed: pop.employed,
    educatedWorkers: pop.educatedCount,
    educatedEmployed: eduEmployed,
    jobs,
    filled,
    happiness: city.stats.happiness,
    taxes: { residential: t.residential, commercial: t.commercial, industrial: t.industrial, office: t.office },
    serviceScore: score,
    avgLandValue: lvN ? lvSum / lvN : 0.3,
    congestion: wsum > 0 ? vol / wsum : 0,
    officeUnlocked: city.peakPopulation >= 1000,
    airport: [...city.buildings.all.values()].some((b) => b.typeId === 'airport' && b.state === BuildingState.Active),
    university: universities(city).length > 0,
    port: [...city.buildings.all.values()].some((b) => b.typeId === 'cargo_port' && b.state === BuildingState.Active),
    policy: city.policies.demandBonus(),
  };
}

function recordHistory(city: City): void {
  const s = city.stats;
  const d = city.demand.value;
  city.history.push({
    day: city.clock.day,
    population: s.population,
    jobs: s.jobs,
    employed: s.employed,
    money: Math.round(city.economy.money),
    happiness: Math.round(s.happiness),
    demand: [Math.round(d.residential), Math.round(d.commercial), Math.round(d.industrial), Math.round(d.office)],
    income: Math.round(city.economy.projectedNet),
    riders: city.transit.totalRiders,
    tourism: Math.round(tourismIncome(city)),
  });
  if (city.history.length > 400) city.history.shift();
}

function checkMilestones(city: City): void {
  city.peakPopulation = Math.max(city.peakPopulation, city.stats.population);
  const idx = milestoneIndexFor(city.peakPopulation);
  while (city.milestoneIndex < idx) {
    city.milestoneIndex++;
    const m = MILESTONES[city.milestoneIndex];
    city.economy.grant(m.reward);
    const unlocks = unlocksAt(m.population);
    city.emitNotice({
      severity: 'good',
      icon: 'milestone',
      title: `Milestone: ${m.title}!`,
      text: `Your city reached ${formatInt(m.population)} residents. Grant: ${formatMoney(m.reward)}.${unlocks.length ? ` Unlocked: ${unlocks.join(', ')}.` : ''}`,
    });
    city.events.emit('milestone', { index: city.milestoneIndex, title: m.title, reward: m.reward, unlocks });
  }
}

export function goalComplete(city: City, id: string): boolean {
  const z = city.zones;
  switch (id) {
    case 'bus':
      return [...city.transit.lines.values()].some((l) => !l.problem && l.ridersPerDay > 0);
    case 'policy':
      return city.policies.count() > 0;
    case 'landmark':
      for (const b of city.buildings.all.values()) if (b.kind === 'service' && b.state === BuildingState.Active && SERVICE_BY_ID.get(b.typeId)?.kind === 'landmark') return true;
      return false;
    case 'pop6000':
      return city.population.residents >= 6000;
    case 'metro':
      return [...city.transit.metro.lines.values()].some((l) => !l.problem && l.ridersPerDay > 0);
    case 'connect': {
      const pt = city.outsidePoint();
      if (!pt) return false;
      const comp = city.componentOfSegment(pt.segId);
      for (const s of city.roads.segments.values()) if (!isFreeway(s.type) && city.componentOfSegment(s.id) === comp) return true;
      return false;
    }
    case 'zoneRes':
      return z.countZoned(Zone.ResLow) + z.countZoned(Zone.ResMed) + z.countZoned(Zone.ResHigh) >= 40;
    case 'zoneJobs':
      return z.countZoned(Zone.Commercial) + z.countZoned(Zone.CommercialHigh) + z.countZoned(Zone.Industrial) + z.countZoned(Zone.IndustrialLight) >= 30;
    case 'power':
      return city.utilities.totals.power.production > 0;
    case 'water':
      return city.utilities.totals.water.production > 0;
    case 'sewage':
      return city.utilities.totals.sewage.production > 0;
    case 'pop100':
      return city.population.residents >= 100;
    case 'service':
      for (const b of city.buildings.all.values()) {
        const st = SERVICE_BY_ID.get(b.typeId);
        if (b.kind === 'service' && st && ['police', 'fire', 'health', 'education'].includes(st.kind)) return true;
      }
      return false;
    case 'park':
      for (const b of city.buildings.all.values()) if (b.kind === 'service' && SERVICE_BY_ID.get(b.typeId)?.kind === 'park') return true;
      return false;
    case 'pop500':
      return city.population.residents >= 500;
  }
  return false;
}

function checkGoals(city: City): void {
  for (const g of GOALS) {
    if (city.goalsDone.has(g.id)) continue;
    if (!goalComplete(city, g.id)) continue;
    city.goalsDone.add(g.id);
    city.economy.grant(g.reward);
    city.events.emit('goal', { id: g.id, title: g.title, reward: g.reward });
    city.emitNotice({ severity: 'good', icon: 'happy', title: `Goal complete: ${g.title}`, text: `Reward: ${formatMoney(g.reward)}` });
  }
}

function dailyNotices(city: City): void {
  const u = city.utilities.totals;
  const firstWith = (flag: number) => {
    for (const b of city.buildings.all.values()) if (b.problems & flag) return b;
    return null;
  };
  const util = [
    ['power', Problem.NoPower, 'Power shortage', 'without electricity. Build more power plants or connect them by road.', 'power'],
    ['water', Problem.NoWater, 'Water shortage', 'without running water. Add water towers or pumping stations.', 'water'],
    ['sewage', Problem.NoSewage, 'Sewage backing up', 'without sewage service. Build a sewage outfall or treatment plant.', 'sewage'],
  ] as const;
  for (const [kind, flag, title, text, icon] of util) {
    if (u[kind].unserved > 0) {
      const b = firstWith(flag);
      city.emitNotice({ severity: 'warning', icon, title, text: `${u[kind].unserved} buildings are ${text}`, x: b?.cx, z: b?.cz }, `util-${kind}`, 24 * 8);
    }
  }
  if (city.growthBlocked.size && city.stats.population < 50000) {
    const missing = [...city.growthBlocked];
    if (missing.includes('connection')) {
      city.emitNotice({ severity: 'warning', icon: 'road', title: 'Zones not connected', text: 'Zoned streets must connect to the highway before anyone will move in.' }, 'blocked-connection', 24 * 10);
    } else {
      const names = missing.map((m) => (m === 'power' ? 'electricity' : m === 'water' ? 'water' : 'sewage'));
      city.emitNotice(
        { severity: 'info', icon: missing[0] as 'power' | 'water' | 'sewage', title: 'Zoned land is waiting', text: `New buildings need ${names.join(', ')} capacity before they can be built.` },
        'blocked-utils',
        24 * 8,
      );
    }
  }
  let garbage = 0;
  for (const b of city.buildings.all.values()) if (b.problems & Problem.Garbage) garbage++;
  if (garbage >= 4) {
    const b = firstWith(Problem.Garbage);
    city.emitNotice({ severity: 'warning', icon: 'garbage', title: 'Garbage is piling up', text: `${garbage} buildings need garbage collection. Build a landfill or recycling center.`, x: b?.cx, z: b?.cz }, 'garbage', 24 * 12);
  }
  for (const b of city.buildings.all.values()) {
    if (b.kind === 'service' && b.typeId === 'landfill' && b.stock > LANDFILL_CAPACITY * 0.85) {
      city.emitNotice({ severity: 'warning', icon: 'garbage', title: b.stock >= LANDFILL_CAPACITY ? 'Landfill is full' : 'Landfill almost full', text: 'Build another landfill or a recycling center.', x: b.cx, z: b.cz }, `landfill-${b.id}`, 24 * 20);
    }
  }
  // Public transit.
  for (const line of city.transit.lines.values()) {
    const first = city.transit.stops.get(line.stops[0]);
    if (line.problem === 'depot' || line.problem === 'buses') {
      city.emitNotice({ severity: 'warning', icon: 'traffic', title: `${line.name} isn't running`, text: lineProblemText(line.problem) + '.', x: first?.x, z: first?.z }, `line-${line.id}-problem`, 24 * 10);
    } else if (line.capacityPerDay > 0 && line.ridersPerDay > line.capacityPerDay * 0.95) {
      city.emitNotice({ severity: 'info', icon: 'traffic', title: `${line.name} is packed`, text: 'Riders are being left at the stops. Add buses in the Transit panel.', x: first?.x, z: first?.z }, `line-${line.id}-full`, 24 * 15);
    }
  }
  const noRoad = firstWith(Problem.NoRoad);
  if (noRoad) city.emitNotice({ severity: 'warning', icon: 'road', title: 'Buildings without road access', text: 'Some buildings lost their road connection and will be abandoned.', x: noRoad.cx, z: noRoad.cz }, 'noroad', 24 * 8);

  const money = city.economy.money;
  const net = city.economy.projectedNet;
  if (!city.economy.unlimited) {
    if (money < 0) city.emitNotice({ severity: 'critical', icon: 'money', title: 'City is in debt', text: 'Raise taxes, cut services or take a loan from the Budget panel.' }, 'debt', 24 * 10);
    else if (money < 15_000 && net < 0) city.emitNotice({ severity: 'warning', icon: 'money', title: 'Funds running low', text: `You are losing ${formatMoney(-net)} per month.` }, 'lowfunds', 24 * 10);
  }
  const s = city.stats;
  if (s.workers > 150 && s.unemployment > 0.15) {
    city.emitNotice({ severity: 'warning', icon: 'people', title: 'High unemployment', text: `${Math.round(s.unemployment * 100)}% of workers can't find jobs. Zone more commercial, industrial or office land.` }, 'unemployment', 24 * 15);
  }
  // Traffic jams.
  let worst: { id: number; ratio: number } | null = null;
  for (const [id, v] of city.traffic.volume) {
    if (v < 400) continue;
    const r = city.traffic.ratio(id);
    if (r > 1.05 && (!worst || r > worst.ratio)) worst = { id, ratio: r };
  }
  if (worst) {
    const seg = city.roads.segments.get(worst.id);
    if (seg) {
      const mid = Math.floor(seg.poly.count / 2) * 2;
      city.emitNotice(
        { severity: 'warning', icon: 'traffic', title: 'Traffic congestion', text: `${seg.name || 'A road'} is over capacity (${Math.round(worst.ratio * 100)}%). Add alternative routes or upgrade it.`, x: seg.poly.pts[mid], z: seg.poly.pts[mid + 1] },
        'traffic',
        24 * 12,
      );
    }
  }
  const d = city.demand.value;
  const lists = city.zones.zoneLists();
  const freeRes = R_ZONES.reduce((a, z) => a + lists[z].length, 0);
  if (d.residential > 70 && freeRes < 30 && s.population > 0) city.emitNotice({ severity: 'info', icon: 'people', title: 'People want to move in', text: 'Residential demand is high. Zone more housing.' }, 'want-res', 24 * 15);
  if (d.commercial > 65 && lists[Zone.Commercial].length + lists[Zone.CommercialHigh].length < 30) city.emitNotice({ severity: 'info', icon: 'build', title: 'Shops are in demand', text: 'Residents need places to shop. Zone commercial land.' }, 'want-com', 24 * 15);
  if (d.industrial > 65 && lists[Zone.Industrial].length + lists[Zone.IndustrialLight].length < 30) city.emitNotice({ severity: 'info', icon: 'factory', title: 'Industry wants to expand', text: 'Zone industrial land — ideally away from homes.' }, 'want-ind', 24 * 15);
  if (d.office > 60 && lists[Zone.Office].length < 30) city.emitNotice({ severity: 'info', icon: 'build', title: 'Offices are in demand', text: 'Educated workers are looking for office jobs. Zone office land.' }, 'want-off', 24 * 15);

  const avg = (k: 'police' | 'health' | 'education' | 'fire') => city.coverage.averageFor(k, city.buildings);
  if (s.population > 1200 && avg('police') < 0.3) city.emitNotice({ severity: 'warning', icon: 'police', title: 'Crime is rising', text: 'Many neighborhoods lack police coverage.' }, 'crime', 24 * 20);
  if (s.population > 800 && avg('health') < 0.3) city.emitNotice({ severity: 'warning', icon: 'health', title: 'Residents need healthcare', text: 'Build clinics or a hospital near homes.' }, 'health', 24 * 20);
  if (s.population > 1000 && avg('education') < 0.3) city.emitNotice({ severity: 'info', icon: 'education', title: 'Schools needed', text: 'Educated residents attract offices and higher land value.' }, 'edu', 24 * 20);
  if (s.population > 600 && avg('fire') < 0.3) city.emitNotice({ severity: 'warning', icon: 'fire', title: 'Fire risk is high', text: 'Build fire stations to protect your neighborhoods.' }, 'firecov', 24 * 20);
}

function monthly(city: City): void {
  city.economy.closeMonth(city.clock.monthIndex);
  checkScenario(city);
  city.news.publish();
  const last = city.economy.history[city.economy.history.length - 1];
  const ledger = city.economy.lastMonth;
  if (last && city.clock.monthIndex > 0) {
    const construction = ledger.expense.Construction ?? 0;
    const running = last.expense - construction;
    const delta = last.income - running;
    const ac = city.achievements.counters;
    ac.surplusMonths = delta > 0 ? ac.surplusMonths + 1 : 0;
    city.emitNotice({
      severity: delta >= 0 ? 'info' : 'warning',
      icon: 'money',
      title: 'Monthly budget',
      text: `Income ${formatMoney(last.income)} · running costs ${formatMoney(running)} (${delta >= 0 ? '+' : '−'}${formatMoney(Math.abs(delta))})${construction > 0 ? ` · invested ${formatMoney(construction)} in construction` : ''}.`,
    }, 'monthly', 24 * 25);
  }
  upgradeBuildings(city);
}

function upgradeBuildings(city: City): void {
  const rng = city.rng;
  let n = 0;
  for (const b of city.buildings.all.values()) {
    if (b.kind !== 'zoned' || b.state !== BuildingState.Active || b.progress < 1 || b.level >= 3 || b.age < 25) continue;
    if (b.problems & (Problem.NoPower | Problem.NoWater | Problem.NoSewage | Problem.Garbage | Problem.NoRoad)) continue;
    const edu = city.coverage.at('education', b.cx, b.cz);
    const ok = b.level === 1 ? b.landValue >= 0.45 && b.happiness >= 55 : b.landValue >= 0.64 && b.happiness >= 64 && (zoneBase(b.zone) === Zone.Industrial || zoneBase(b.zone) === Zone.Commercial || edu >= 0.35);
    if (!ok || !rng.chance(0.4)) continue;
    const level = b.level + 1;
    const w = b.hw * 2, d = b.hd * 2;
    const options = b.typeId === 'hotel' ? archetypesFor(b.zone, level).filter((a) => a.id === 'hotel') : archetypesFor(b.zone, level).filter((a) => a.frontage[0] <= w + 4 && a.depth[0] <= d + 4 && a.weight > 0);
    const arch = options.length ? rng.weighted(options, (a) => a.weight)! : null;
    b.level = level;
    const floorsBefore = b.floors;
    if (arch) {
      b.typeId = arch.id;
      b.style = arch.style;
      const ft = arch.style === 'tower' || arch.style === 'officeTower' ? clamp(b.landValue * 1.15, 0, 1) : rng.next();
      b.floors = Math.max(b.floors, Math.round(lerp(arch.floors[0], arch.floors[1], ft)));
    } else {
      b.floors += b.style === 'house' ? 0 : 1;
    }
    // The high-rise ban stops upgrades adding floors beyond the cap (existing ones stay).
    if (b.floors > floorsBefore) b.floors = Math.max(floorsBefore, Math.min(b.floors, city.spawner.maxFloorsAt(b.cx, b.cz)));
    const cap = capacityFor(b.style as Parameters<typeof capacityFor>[0], w, d, b.floors, level);
    b.hhCap = Math.max(cap.households, b.households);
    b.jobs = Math.max(cap.jobs, b.workers);
    b.seed = Math.floor(rng.next() * 0x7fffffff);
    b.progress = 0.3;
    b.buildDays = Math.max(2, b.buildDays * 0.6);
    city.buildings.markChanged(b, 'geometry');
    n++;
  }
  if (n > 0) {
    city.emitNotice({ severity: 'good', icon: 'build', title: `${n} building${n > 1 ? 's' : ''} upgraded`, text: 'High land value and happy residents are transforming your neighborhoods.' }, 'upgrades', 24 * 25);
  }
}

/** Runs the simulation forward quickly (tests and debugging). */
export function fastForward(city: City, ticks: number): void {
  for (let i = 0; i < ticks; i++) tickCity(city);
}
