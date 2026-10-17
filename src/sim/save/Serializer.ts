import type { MobilitySave } from '../mobility/Mobility';
import { registerLandmarks } from '../design/DesignLab';
import type { PeopleSave } from '../design/People';
import { decodeFloat32, decodeInt32, decodeUint8, encodeTyped, rleDecode, rleEncode } from '../../core/encoding';
import type { StyleSave } from '../style/CityStyle';
import type { DesignSave } from '../design/DesignLab';
import type { NewsSave } from '../news/News';
import { City, type StatSample } from '../City';
import { projectEconomy, refreshStats } from '../CitySim';
import { type Building, lotOBB, newBuilding } from '../buildings/Buildings';
import type { StyleId } from '../buildings/Archetypes';
import { GRID_RES, WORLD_SIZE, ZONE_RES } from '../constants';
import type { District } from '../districts/Districts';
import type { BudgetKey, Ledger, Loan, MonthRecord, TaxCategory } from '../economy/Economy';
import type { RoadTypeId } from '../roads/RoadTypes';
import type { TransitSave } from '../transit/Transit';
import type { WeatherSave } from '../world/Weather';
import type { PolicyId } from '../policies/Policies';
import { BuildingState, type DemandKind, Zone } from '../types';
import type { MapPreset } from '../world/Terrain';
import { type TerrainEdits, loadTerrainEdits, serializeTerrainEditsSteps } from '../world/Terraform';
import { conformTerrain } from '../world/TerrainConform';
import type { LandData } from '../world/Land';
import { migrateToBigWorld } from './WorldMigration';
import type { ResearchSave } from '../research/Research';
import { hashStr } from '../research/Generate';
import type { AchievementSave } from '../progress/Achievements';
import type { BikeRequestsSave } from '../mobility/BikeRequests';
import type { ScenarioState } from '../progress/Scenarios';

export const SAVE_FORMAT = 'meridian-city';
export const SAVE_VERSION = 3;

export interface SaveMeta {
  name: string;
  population: number;
  money: number;
  date: string;
  day: number;
  savedAt: string;
  preset: MapPreset;
  seed: number;
}

type BuildingRecord = [
  id: number, kind: 0 | 1, typeId: string, style: string, zone: number,
  cx: number, cz: number, angle: number, hw: number, hd: number, y: number,
  seed: number, floors: number, level: number, state: number, progress: number, buildDays: number, age: number,
  segId: number, segS: number, side: number, hhCap: number, households: number, residents: number,
  jobs: number, workers: number, garbage: number, happiness: number, landValue: number, problems: number,
  unhappyDays: number, fireHours: number, rezoneDays: number, district: number, efficiency: number, stock: number,
  movement?: number,
];

export interface SaveData {
  format: typeof SAVE_FORMAT;
  version: number;
  meta: SaveMeta;
  city: {
    name: string;
    seed: number;
    preset: MapPreset;
    unlimited: boolean;
    tick: number;
    peak: number;
    milestone: number;
    goals: string[];
    rng: number;
    namer: number;
    districtRng: number;
  };
  roads: {
    nodes: [number, number, number, 0 | 1][];
    segments: [number, number, number, RoadTypeId, number, number, string, number, (0 | 1)?, (0 | 1 | -1)?, (0 | 1)?, (0 | 1)?, (0 | 1 | 2)?][];
    roundabouts?: [number, number, number, number][];
    nextNodeId: number;
    nextSegId: number;
  };
  zones: string;
  buildings: BuildingRecord[];
  nextBuildingId: number;
  population: {
    count: number;
    home: string;
    size: string;
    workers: string;
    educated: string;
    job: string;
    wealth: string;
    alive: string;
    happiness: string;
    moveInTick: string;
    /** Taste groups (missing in older saves). */
    taste?: string;
  };
  economy: {
    money: number;
    taxes: Record<TaxCategory, number>;
    budgets?: Record<BudgetKey, number>;
    loans: Loan[];
    nextLoanId: number;
    thisMonth: Ledger;
    lastMonth: Ledger;
    history: MonthRecord[];
    monthsInDebt: number;
  };
  demand: Record<DemandKind, number>;
  attraction?: number;
  landValue: { value: string; pollution: string };
  districts: { grid: string; list: District[]; nextId: number };
  history: StatSample[];
  traffic: [number, number][];
  /** Added in version 2. */
  transit: TransitSave;
  /** Optional: saves without it start with clear skies. */
  weather?: WeatherSave;
  policies?: PolicyId[];
  districtPolicies?: [number, PolicyId[]][];
  /** Terraforming: sparse height changes against the generated map. */
  terrainEdits?: TerrainEdits;
  /** Owned land parcels (absent: the whole map, as in older saves). */
  land?: LandData;
  /** Natural trees still standing (run-length flags) and planted trees. */
  nature?: { natural: string; planted: string; kinds: string };
  achievements?: AchievementSave;
  scenario?: ScenarioState | null;
  news?: NewsSave;
  /** This civilization's research (absent in older saves). */
  research?: ResearchSave;
  /** The city's architectural movements (older saves have only the local vernacular). */
  style?: StyleSave;
  /** Ideas learned and designs in the sketchbook. */
  design?: DesignSave;
  people?: PeopleSave;
  mobility?: MobilitySave;
  bikeRequests?: BikeRequestsSave;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function serializeCity(city: City): SaveData {
  const it = serializeSteps(city);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/**
 * The same as serializeCity, in pieces: the game saves a big city a piece per
 * frame (with the clock paused) so the screen doesn't freeze.
 */
export async function serializeCityAsync(city: City, between: () => Promise<void>): Promise<SaveData> {
  const it = serializeSteps(city);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
    await between();
  }
}

function* serializeSteps(city: City): Generator<void, SaveData, void> {
  const nodes: SaveData['roads']['nodes'] = [];
  for (const n of city.roads.nodes.values()) nodes.push([n.id, r3(n.x), r3(n.z), n.outside ? 1 : 0]);
  const segments: SaveData['roads']['segments'] = [];
  for (const s of city.roads.segments.values()) segments.push(s.elevated || s.oneway || s.ring || s.raised || s.bikeLane ? [s.id, s.a, s.b, s.type, r3(s.cx), r3(s.cz), s.name, s.builtTick, s.elevated ? 1 : 0, s.oneway, s.ring ? 1 : 0, s.raised ? 1 : 0, s.bikeLane] : [s.id, s.a, s.b, s.type, r3(s.cx), r3(s.cz), s.name, s.builtTick]);
  yield;
  const buildings: BuildingRecord[] = [];
  for (const b of city.buildings.all.values()) {
    buildings.push([
      b.id, b.kind === 'zoned' ? 0 : 1, b.typeId, b.style, b.zone,
      r3(b.cx), r3(b.cz), r3(b.angle), r3(b.hw), r3(b.hd), r3(b.y),
      b.seed, b.floors, b.level, b.state, r3(b.progress), r3(b.buildDays), b.age,
      b.segId, r3(b.segS), b.side, b.hhCap, b.households, b.residents,
      b.jobs, b.workers, r3(b.garbage), r3(b.happiness), r3(b.landValue), b.problems,
      b.unhappyDays, b.fireHours, b.rezoneDays, b.district, r3(b.efficiency), r3(b.stock),
      ...(b.movement ? [b.movement] : []),
    ] as BuildingRecord);
  }
  yield;
  const pop = city.population;
  const n = pop.count;
  const e = city.economy;
  const population = {
    count: n,
    home: encodeTyped(pop.home, n),
    size: encodeTyped(pop.size, n),
    workers: encodeTyped(pop.workers, n),
    educated: encodeTyped(pop.educated, n),
    job: encodeTyped(pop.job, n * 2),
    wealth: encodeTyped(pop.wealth, n),
    alive: encodeTyped(pop.alive, n),
    happiness: encodeTyped(pop.happiness, n),
    moveInTick: encodeTyped(pop.moveInTick, n),
    taste: encodeTyped(pop.taste, n),
  };
  yield;
  const zones = rleEncode(city.zones.zone);
  const landValue = { value: encodeTyped(city.landValue.value), pollution: encodeTyped(city.landValue.pollution) };
  const districtGrid = rleEncode(city.districts.grid);
  yield;
  const terrainEdits = yield* serializeTerrainEditsSteps(city.terrain, 1 << 20);
  const nature = serializeNature(city);
  yield;
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    meta: {
      name: city.name,
      population: pop.residents,
      money: Math.round(e.money),
      date: city.clock.dateString(),
      day: city.clock.day,
      savedAt: new Date().toISOString(),
      preset: city.preset,
      seed: city.seed,
    },
    city: {
      name: city.name,
      seed: city.seed,
      preset: city.preset,
      unlimited: e.unlimited,
      tick: city.clock.tick,
      peak: city.peakPopulation,
      milestone: city.milestoneIndex,
      goals: [...city.goalsDone],
      rng: city.rng.state,
      namer: city.namer.state,
      districtRng: city.districts.rngState,
    },
    roads: { nodes, segments, nextNodeId: city.roads.nextNodeId, nextSegId: city.roads.nextSegId, roundabouts: [...city.roads.roundabouts.values()].map((r) => [r.id, r3(r.x), r3(r.z), r.r] as [number, number, number, number]) },
    zones,
    buildings,
    nextBuildingId: city.buildings.nextId,
    population,
    economy: {
      money: e.money,
      taxes: { ...e.taxes },
      budgets: { ...e.budgets },
      loans: e.loans.map((l) => ({ ...l })),
      nextLoanId: e.nextLoanId,
      thisMonth: structuredClone(e.thisMonth),
      lastMonth: structuredClone(e.lastMonth),
      history: e.history.map((h) => ({ ...h })),
      monthsInDebt: e.monthsInDebt,
    },
    demand: { ...city.demand.value },
    attraction: city.demand.attraction,
    landValue,
    districts: { grid: districtGrid, list: [...city.districts.list.values()].map((d) => ({ ...d, color: [...d.color] as [number, number, number] })), nextId: city.districts.nextId },
    history: city.history.map((h) => ({ ...h, demand: [...h.demand] as [number, number, number, number] })),
    traffic: [...city.traffic.volume.entries()].map(([k, v]) => [k, Math.round(v * 10) / 10]),
    transit: city.transit.serialize(),
    weather: city.weather.serialize(),
    policies: city.policies.serialize(),
    districtPolicies: city.policies.serializeLocal(),
    terrainEdits,
    land: city.land.serialize(),
    nature,
    achievements: city.achievements.serialize(),
    scenario: city.scenario ? { ...city.scenario } : null,
    news: city.news.serialize(),
    research: city.research.serialize(),
    style: city.style.serialize(),
    design: city.design.serialize(),
    people: city.people.serialize(),
    mobility: city.mobility.serialize(),
    bikeRequests: city.bikeRequests.serialize(),
  };
}

function serializeNature(city: City): SaveData['nature'] {
  const nat = city.nature;
  const planted = nat.serializePlanted();
  return {
    natural: rleEncode(nat.alive.subarray(0, nat.naturalCount)),
    planted: planted.kinds.length ? encodeTyped(planted.data) : '',
    kinds: planted.kinds.length ? encodeTyped(planted.kinds) : '',
  };
}

/** Upgrades older save formats to the current version. */
const MIGRATIONS: Record<number, (d: SaveData) => SaveData> = {
  // v2: public transit.
  1: (d) => ({ ...d, version: 2, transit: { stops: [], lines: [], nextStopId: 1, nextLineId: 1 } }),
  // v3: the world grew to four times the area around the old map.
  2: migrateToBigWorld,
};

export function migrate(data: SaveData): SaveData {
  if (data.format !== SAVE_FORMAT) throw new Error('Not a Meridian save file');
  let d = data;
  while (d.version < SAVE_VERSION) {
    const m = MIGRATIONS[d.version];
    if (!m) throw new Error(`Cannot migrate save version ${d.version}`);
    d = m(d);
  }
  if (d.version > SAVE_VERSION) throw new Error('This save was made with a newer version of Meridian');
  return d;
}

export function deserializeCity(raw: SaveData, opts: { flatTerrain?: number; terrainBase?: Float32Array } = {}): City {
  const data = migrate(raw);
  const c = data.city;
  // Older saves get a civilization seed derived from the map, so reloading them is stable.
  const civSeed = data.research?.civSeed ?? hashStr(c.seed, c.name, 'civ');
  const city = new City({ name: c.name, seed: c.seed, preset: c.preset, unlimitedMoney: c.unlimited, empty: true, flatTerrain: opts.flatTerrain, terrainBase: opts.terrainBase, civSeed });
  // Research first: generated building types must exist before buildings of those types are loaded.
  city.research.load(data.research);
  // Movements before buildings, which refer to them.
  city.style.load(data.style, city.research.civSeed);
  // Signature landmarks are building types of this city: known before its buildings load.
  registerLandmarks(city, data.design);
  city.clock.tick = c.tick;
  city.peakPopulation = c.peak;
  city.milestoneIndex = c.milestone;
  city.goalsDone = new Set(c.goals);
  city.rng.state = c.rng;
  city.namer.state = c.namer;
  city.districts.rngState = c.districtRng;
  loadTerrainEdits(city, data.terrainEdits);
  city.land.load(data.land);
  city.achievements.load(data.achievements);
  city.scenario = data.scenario ? { ...data.scenario } : null;
  city.news.load(data.news);

  // Roads
  for (const [id, x, z, outside] of data.roads.nodes) city.roads.addNode(x, z, outside === 1, id);
  for (const [id, a, b, type, cx, cz, name, built, elevated, oneway, ring, raised, bikeLane] of data.roads.segments) {
    city.roads.addSegment(a, b, type, { id, ctrl: { x: cx, z: cz }, name, builtTick: built, elevated: elevated === 1, oneway: oneway ?? 0, ring: ring === 1, raised: raised === 1, bikeLane: bikeLane ?? 0 });
    city.namer.markUsed(name);
  }
  for (const [id, x, z, r] of data.roads.roundabouts ?? []) {
    city.roads.roundabouts.set(id, { id, x, z, r });
    city.roads.nextRoundaboutId = Math.max(city.roads.nextRoundaboutId, id + 1);
  }
  city.roads.nextNodeId = Math.max(city.roads.nextNodeId, data.roads.nextNodeId);
  city.roads.nextSegId = Math.max(city.roads.nextSegId, data.roads.nextSegId);
  city.rebuildAllDerived();

  // Zones (after zonable mask exists)
  city.zones.loadZones(rleDecode(data.zones, ZONE_RES * ZONE_RES));

  // Buildings
  for (const r of data.buildings) {
    const b: Building = newBuilding({
      id: r[0], kind: r[1] === 0 ? 'zoned' : 'service', typeId: r[2], style: r[3] as StyleId, zone: r[4] as Zone,
      cx: r[5], cz: r[6], angle: r[7], hw: r[8], hd: r[9], y: r[10],
      seed: r[11], floors: r[12], level: r[13], state: r[14] as BuildingState, progress: r[15], buildDays: r[16], age: r[17],
      segId: r[18], segS: r[19], side: r[20], hhCap: r[21], households: r[22], residents: r[23],
      jobs: r[24], workers: r[25], garbage: r[26], happiness: r[27], landValue: r[28], problems: r[29],
      unhappyDays: r[30], fireHours: r[31], rezoneDays: r[32], district: r[33], efficiency: r[34], stock: r[35], movement: r[36] ?? 0,
    });
    if (b.segId && !city.roads.segments.has(b.segId)) b.segId = 0;
    city.buildings.add(b);
    const o = lotOBB(b);
    city.zones.setOccupant(o, b.id);
    city.nature.clearOBB(o, 1.5);
  }
  city.buildings.nextId = Math.max(city.buildings.nextId, data.nextBuildingId);
  conformTerrain(city.terrain, city.roads, city.buildings, { minX: 0, minZ: 0, maxX: WORLD_SIZE, maxZ: WORLD_SIZE });
  if (data.nature) {
    // Trees beyond the end of an older save's list grew on land the world gained since: still standing.
    city.nature.load(rleDecode(data.nature.natural, city.nature.naturalCount, 1), {
      data: data.nature.planted ? decodeFloat32(data.nature.planted) : new Float32Array(0),
      kinds: data.nature.kinds ? decodeUint8(data.nature.kinds) : new Uint8Array(0),
    });
  }

  // Population
  const p = data.population;
  const pop = city.population;
  pop.ensureCapacity(Math.max(p.count, 16));
  pop.count = p.count;
  pop.home.set(decodeInt32(p.home));
  pop.size.set(decodeUint8(p.size));
  pop.workers.set(decodeUint8(p.workers));
  pop.educated.set(decodeUint8(p.educated));
  pop.job.set(decodeInt32(p.job));
  pop.wealth.set(decodeUint8(p.wealth));
  pop.alive.set(decodeUint8(p.alive));
  pop.happiness.set(decodeFloat32(p.happiness));
  pop.moveInTick.set(decodeInt32(p.moveInTick));
  // Saves from before taste groups: assigned when the people load.
  if (p.taste) pop.taste.set(decodeUint8(p.taste));
  else pop.taste.fill(255, 0, p.count);
  pop.recount();

  // Economy
  const e = data.economy;
  const econ = city.economy;
  econ.money = e.money;
  econ.taxes = { ...e.taxes };
  if (e.budgets) econ.budgets = { ...econ.budgets, ...e.budgets };
  econ.loans = e.loans.map((l) => ({ ...l }));
  econ.nextLoanId = e.nextLoanId;
  econ.thisMonth = structuredClone(e.thisMonth);
  econ.lastMonth = structuredClone(e.lastMonth);
  econ.history = e.history.map((h) => ({ ...h }));
  econ.monthsInDebt = e.monthsInDebt;

  for (const k of Object.keys(data.demand) as DemandKind[]) city.demand.value[k] = data.demand[k];
  city.demand.attraction = data.attraction ?? data.demand.residential;
  const lv = decodeFloat32(data.landValue.value);
  const pol = decodeFloat32(data.landValue.pollution);
  if (lv.length === GRID_RES * GRID_RES) city.landValue.loadValues(lv, pol);

  city.districts.grid.set(rleDecode(data.districts.grid, GRID_RES * GRID_RES));
  for (const d of data.districts.list) city.districts.list.set(d.id, { ...d });
  city.districts.nextId = data.districts.nextId;

  city.history = data.history.map((h) => ({ ...h }));
  for (const [k, v] of data.traffic) if (city.roads.segments.has(k)) city.traffic.volume.set(k, v);
  city.transit.load(data.transit);
  if (data.weather) city.weather.load(data.weather);
  city.policies.load(data.policies, data.districtPolicies);
  city.transit.onRoadsChanged();

  // Derived state
  city.coverage.recompute(city.buildings);
  city.coverageDirty = false;
  city.recomputeUtilities();
  refreshStats(city);
  city.transit.updateRidership();
  projectEconomy(city);
  city.trips.refresh();
  city.traffic.setDemand(city.trips.buildDemand());
  for (const b of city.buildings.all.values()) {
    if (b.state === BuildingState.Active && b.hhCap > 0 && b.households < b.hhCap) city.vacantHomes.push(b.id);
    if (b.state === BuildingState.Active && b.jobs > b.workers) city.openJobs.push(b.id);
  }
  // Last: an older city learns what its history already shows.
  // Research is a utilities side branch now: older centres move to a utility field.
  city.research.retireFields();
  city.design.load(data.design);
  city.people.load(data.people);
  city.mobility.load(data.mobility);
  city.bikeRequests.load(data.bikeRequests);
  return city;
}

export function saveToJSON(city: City): string {
  return JSON.stringify(serializeCity(city));
}

export function loadFromJSON(json: string): City {
  return deserializeCity(JSON.parse(json) as SaveData);
}
