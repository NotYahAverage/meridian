import { EventBus } from '../core/EventBus';
import { type Edition, NewsDesk } from './news/News';
import { obbBounds } from '../core/geom2d';
import { Rng } from '../core/rng';
import { type Building, Buildings, lotOBB } from './buildings/Buildings';
import { Spawner } from './buildings/Spawner';
import { Clock } from './Clock';
import { START_MONEY, ZONE_DEPTH } from './constants';
import { Demand } from './demand/Demand';
import { Districts } from './districts/Districts';
import { Economy } from './economy/Economy';
import { LandValue } from './landvalue/LandValue';
import { type Notice, Notifications } from './Notifications';
import { Population } from './population/Population';
import { RoadLayout } from './roads/RoadLayout';
import { type RoadChange, RoadNetwork, type RoadSegment } from './roads/RoadNetwork';
import { REGIONAL_ROAD_NAME, ROAD_TYPES } from './roads/RoadTypes';
import { StreetNamer } from './roads/streetNames';
import { Coverage } from './services/Coverage';
import { Pathfinder, type RoutePoint } from './traffic/Pathfinder';
import { Signals } from './traffic/Signals';
import { TrafficModel, type TripDemand } from './traffic/TrafficModel';
import { TripGenerator } from './traffic/TripGenerator';
import { Vehicles } from './traffic/Vehicles';
import { LiveTraffic } from './traffic/LiveTraffic';
import { Transit } from './transit/Transit';
import { Mobility } from './mobility/Mobility';
import { Pedestrians } from './walk/Pedestrians';
import { WalkNetwork } from './walk/WalkNetwork';
import { HIGH_RISE_CAP, Policies } from './policies/Policies';
import { Utilities } from './utilities/Utilities';
import { Nature } from './world/Nature';
import { Weather } from './world/Weather';
import { type MapPreset, type Rect, Terrain } from './world/Terrain';
import { LAND_TILE, Land } from './world/Land';
import { Research } from './research/Research';
import { CityStyle } from './style/CityStyle';
import { DesignLab } from './design/DesignLab';
import { People, type Stage } from './design/People';
import type { GroupId } from './design/Tastes';
import type { Reaction } from './design/Trials';
import { conformTerrain } from './world/TerrainConform';
import { Disasters } from './world/Disasters';
import { Achievements } from './progress/Achievements';
import type { ScenarioState } from './progress/Scenarios';
import { SERVICE_BY_ID } from './services/ServiceTypes';
import { ZoneMap } from './zoning/ZoneMap';
import { BikeRequests } from './mobility/BikeRequests';
import { BuildingState, Problem } from './types';

export type CityEvents = {
  notice: Notice;
  milestone: { index: number; title: string; reward: number; unlocks: string[] };
  goal: { id: string; title: string; reward: number };
  built: { x: number; z: number; kind: 'road' | 'service' | 'zone' | 'stop' };
  demolished: { x: number; z: number; kind: 'road' | 'building' | 'stop' };
  completed: { id: number };
  fire: { id: number; x: number; z: number };
  spawned: { x: number; y: number; z: number; r: number };
  achievement: { id: string; title: string };
  scenario: { id: string; result: 'won' | 'lost' };
  news: Edition;
  design: { type: 'idea'; id: string } | { type: 'combo'; id: string } | { type: 'movement'; id: number } | { type: 'reaction'; trial: number; reaction: Reaction } | { type: 'trial'; trial: number; what: 'placed' | 'opened' | 'month' | 'verdict' | 'gone' | 'adopted' | 'scrapped' };
  people:
    | { type: 'stage'; group: GroupId; stage: Stage }
    | { type: 'petition'; group: GroupId; petition: number }
    | { type: 'promise'; group: GroupId; petition: number; kept: boolean }
    | { type: 'protest'; group: GroupId; protest: number }
    | { type: 'leaving'; group: GroupId; households: number };
  bike: { type: 'request'; request: number } | { type: 'answer'; request: number; approved: boolean };
  research: { type: 'discovery' | 'decision' | 'failure' | 'milestone' | 'retrofit'; centerId: number; discoveryId?: string; recordId?: string; outcome?: string; milestoneId?: string };
};

export interface CityOptions {
  name: string;
  seed: number;
  preset: MapPreset;
  unlimitedMoney?: boolean;
  /** Flat terrain height (fast generation for tests). */
  flatTerrain?: number;
  /** The terrain's heightmap, when generated ahead of time (in parallel). */
  terrainBase?: Float32Array;
  /** This civilization's identity for research (random for a new city when omitted). */
  civSeed?: number;
  /** Skip creating the starting highway (used when loading). */
  empty?: boolean;
}

export interface StatSample {
  day: number;
  population: number;
  jobs: number;
  employed: number;
  money: number;
  happiness: number;
  demand: [number, number, number, number];
  income: number;
  /** Transit riders per day (added later; older saves lack it). */
  riders?: number;
  /** Monthly tourism income. */
  tourism?: number;
}

/**
 * Root of the simulation. Owns every system and keeps derived state (junction
 * layout, zoning reach, terrain, connectivity) consistent after edits.
 */
export class City {
  name: string;
  readonly seed: number;
  readonly preset: MapPreset;
  readonly terrain: Terrain;
  /** Parcels of the map the city owns (all of it unless founded with limits). */
  readonly land = new Land();
  /** This civilization's science: research centres, experiments, discoveries and designs. */
  readonly research: Research;
  /** The city's architecture: its movements and which one each building follows. */
  readonly style: CityStyle;
  /** The city's architects: ideas they know and designs in the sketchbook. */
  readonly design: DesignLab;
  /** The taste groups residents belong to, and how they feel about the city. */
  readonly people: People;
  /** Traffic demand being added up over several ticks (see tickCity). */
  demandJob: Generator<void, TripDemand[], void> | null = null;
  /** Periodic coverage and land-value refreshes in progress (a slice per tick). */
  coverageJob: Generator<void, void, void> | null = null;
  landValueJob: Generator<void, void, void> | null = null;
  readonly nature: Nature;
  readonly roads = new RoadNetwork();
  readonly layout: RoadLayout;
  /** Sidewalks, corners and crossings (rebuilt lazily from the road layout). */
  readonly walk: WalkNetwork;
  /** People on foot near the camera (a view of the simulation, not part of it). */
  readonly pedestrians: Pedestrians;
  /** How people get around: travel times, commutes, shop customers, park visits, access. */
  readonly mobility: Mobility;
  /** Residents' requests for bike lanes on their roads. */
  readonly bikeRequests: BikeRequests;
  readonly zones: ZoneMap;
  readonly buildings = new Buildings();
  readonly population = new Population();
  readonly coverage = new Coverage();
  readonly utilities = new Utilities();
  readonly landValue: LandValue;
  readonly demand = new Demand();
  readonly economy: Economy;
  readonly clock = new Clock();
  readonly notifications = new Notifications();
  readonly districts: Districts;
  readonly paths: Pathfinder;
  readonly traffic: TrafficModel;
  readonly signals: Signals;
  readonly vehicles: Vehicles;
  readonly trips: TripGenerator;
  readonly live: LiveTraffic;
  readonly transit: Transit;
  readonly weather: Weather;
  readonly disasters: Disasters;
  readonly achievements: Achievements;
  readonly news: NewsDesk;
  /** The scenario being played, if any. */
  scenario: ScenarioState | null = null;
  readonly policies: Policies;
  readonly spawner: Spawner;
  readonly namer: StreetNamer;
  readonly events = new EventBus<CityEvents>();
  rng: Rng;

  peakPopulation = 0;
  milestoneIndex = 0;
  goalsDone = new Set<string>();
  history: StatSample[] = [];
  /** Cached aggregate statistics (refreshed every few ticks). */
  stats = {
    population: 0,
    households: 0,
    housingCapacity: 0,
    pendingHousing: 0,
    jobs: 0,
    employed: 0,
    workers: 0,
    happiness: 60,
    buildings: 0,
    unemployment: 0,
  };
  /** Cursor for incremental job matching. */
  jobCursor = 0;
  coverageDirty = true;
  /** Reasons zoned growth was blocked since the last daily check. */
  growthBlocked = new Set<string>();
  /** Households index → open job candidates (rebuilt daily). */
  openJobs: number[] = [];
  vacantHomes: number[] = [];

  private pendingRects: Rect[] = [];
  private pendingNodes = new Set<number>();
  private removedSegs: RoadSegment[] = [];
  private addedSegs: RoadSegment[] = [];
  private outsideCache: { version: number; comps: Set<number>; point: RoutePoint | null } = { version: -1, comps: new Set(), point: null };

  constructor(opts: CityOptions) {
    this.name = opts.name;
    this.seed = opts.seed;
    this.preset = opts.preset;
    this.rng = new Rng(opts.seed ^ 0xc17e);
    this.research = new Research(this, (opts.civSeed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0);
    this.style = new CityStyle(this, this.research.civSeed);
    this.design = new DesignLab(this);
    this.people = new People(this);
    this.terrain = new Terrain(opts.seed, opts.preset, { flat: opts.flatTerrain, base: opts.terrainBase });
    this.terrain.landCheck = (x, z) => this.land.ownsPoint(x, z);
    this.nature = new Nature(this.terrain, opts.seed);
    this.weather = new Weather(opts.seed);
    this.disasters = new Disasters(this);
    this.achievements = new Achievements(this);
    this.news = new NewsDesk(this);
    this.policies = new Policies(this);
    this.layout = new RoadLayout(this.roads);
    this.walk = new WalkNetwork(this.layout);
    this.zones = new ZoneMap(this.terrain);
    this.landValue = new LandValue(this.terrain);
    this.economy = new Economy(START_MONEY);
    this.economy.unlimited = !!opts.unlimitedMoney;
    this.coverage.funding = (kind) => this.economy.funding(kind);
    this.districts = new Districts(opts.seed);
    this.namer = new StreetNamer(opts.seed);
    this.paths = new Pathfinder(this.roads, this.layout);
    this.traffic = new TrafficModel(this.roads, this.paths, this.layout);
    this.paths.congestion = (id) => this.traffic.multiplier(id);
    this.signals = new Signals(this.layout);
    this.vehicles = new Vehicles(this.roads, this.layout, this.signals, this.terrain);
    // Drivers know the usual traffic, and replan from where they are when stuck.
    this.vehicles.knownCongestion = (id) => this.traffic.multiplier(id);
    this.vehicles.replan = (_i, route, k, d, cost) => {
      const leg = route.legs[k];
      const seg = this.roads.segments.get(leg.segId);
      const last = route.legs[route.legs.length - 1];
      if (!seg) return null;
      return this.paths.findAhead({ segId: seg.id, s: leg.dir === 1 ? d : seg.length - d }, leg.dir, { segId: last.segId, s: last.s1 }, cost);
    };
    this.transit = new Transit(this);
    this.mobility = new Mobility(this);
    this.bikeRequests = new BikeRequests(this);
    this.trips = new TripGenerator({
      buildings: this.buildings,
      population: this.population,
      outsidePoint: () => this.outsidePoint(),
      carShare: (i, k) => this.mobility.carShare(i, k),
      bikeShare: (i, k) => this.mobility.bikeShare(i, k),
      shopCarShare: (b) => this.mobility.shopCarShare(b),
    });
    this.live = new LiveTraffic(this);
    this.pedestrians = new Pedestrians(this);
    // Drivers parking near the camera get out and walk in.
    this.vehicles.onParked = (_i, x, z, h, b, purpose) => void this.pedestrians.fromCar(x, z, h, b, purpose);
    this.spawner = new Spawner(this.roads, this.terrain, this.zones, this.buildings, (x, z) => this.landValue.at(x, z));
    // Attractions are few: keep a list (refreshed when coverage is) instead of searching every building nearby.
    let sights: { version: number; list: { x: number; z: number; w: number }[] } = { version: -1, list: [] };
    this.spawner.tourismAt = (x, z) => {
      if (sights.version !== this.coverage.version) {
        const list: { x: number; z: number; w: number }[] = [];
        for (const b of this.buildings.all.values()) {
          if (b.kind !== 'service' || b.state !== BuildingState.Active) continue;
          const st = SERVICE_BY_ID.get(b.typeId);
          if (st?.tourism) list.push({ x: b.cx, z: b.cz, w: st.tourism / 4000 });
        }
        sights = { version: this.coverage.version, list };
      }
      let t = 0;
      for (const s of sights.list) t += s.w * Math.max(0, 1 - Math.hypot(s.x - x, s.z - z) / 900);
      return Math.min(1, t);
    };
    this.districts.onRemove = (id) => {
      this.policies.local.delete(id);
      for (const b of this.buildings.all.values()) if (b.district === id) b.district = 0;
    };
    this.spawner.maxFloorsAt = (x, z) => (this.policies.in('highRiseBan', this.districts.at(x, z)) ? HIGH_RISE_CAP : Infinity);
    this.roads.onChange((c) => this.onRoadChange(c));
    if (!opts.empty) this.createStartingHighway();
  }

  // ── Road change bookkeeping ───────────────────────────────────────────────

  private onRoadChange(c: RoadChange): void {
    const s = c.seg;
    const pad = ZONE_DEPTH + ROAD_TYPES[s.type].halfWidth + 24;
    this.pendingRects.push({ minX: s.minX - pad, minZ: s.minZ - pad, maxX: s.maxX + pad, maxZ: s.maxZ + pad });
    this.pendingNodes.add(s.a);
    this.pendingNodes.add(s.b);
    for (const nid of [s.a, s.b]) {
      const n = this.roads.nodes.get(nid);
      if (n) for (const sid of n.segs) {
        const o = this.roads.segments.get(sid);
        if (o) {
          this.pendingNodes.add(o.a);
          this.pendingNodes.add(o.b);
        }
      }
    }
    if (c.kind === 'remove') this.removedSegs.push(s);
    if (c.kind === 'add' || c.kind === 'retype') this.addedSegs.push(s);
  }

  /** Brings derived systems up to date after road edits. */
  processRoadChanges(): void {
    if (!this.pendingRects.length && !this.pendingNodes.size) return;
    // Split pieces inherit "elevated"; keep it only where a deck is actually needed.
    let bridges = false;
    for (const seg of this.addedSegs) {
      if (seg.elevated) seg.elevated = this.segmentNeedsDeck(seg);
      if (seg.elevated) bridges = true;
    }
    for (const seg of this.removedSegs) if (seg.elevated) bridges = true;
    if (bridges) this.stampBridges();
    this.layout.update(this.pendingNodes);
    this.signals.rebuild();
    const rects = mergeRects(this.pendingRects);
    for (const r of rects) this.zones.rebuildRoadInfluence(this.roads, r);
    for (const seg of this.addedSegs) {
      if (this.roads.segments.has(seg.id)) this.nature.clearAlong(seg.poly, ROAD_TYPES[seg.type].halfWidth + 1.5);
    }
    // Reattach buildings whose access segment disappeared.
    const orphans: Building[] = [];
    for (const seg of this.removedSegs) {
      this.vehicles.onSegmentRemoved(seg.id);
      this.traffic.forget(seg.id);
      for (const b of this.buildings.onSegment(seg.id)) orphans.push(b);
      this.buildings.bySegment.delete(seg.id);
    }
    for (const b of orphans) this.reattach(b);
    // Widened/retyped roads may now cut through lots.
    for (const seg of this.addedSegs) {
      if (!this.roads.segments.has(seg.id)) continue;
      for (const b of this.buildings.queryRect(seg.minX, seg.minZ, seg.maxX, seg.maxZ)) {
        if (!this.spawner.clearOfRoads(lotOBB(b), 0.8)) this.removeBuilding(b.id, 'road');
      }
    }
    // Buildings left without a road find a new one built in front of them.
    for (const seg of this.addedSegs) {
      if (!this.roads.segments.has(seg.id)) continue;
      const m = 60;
      for (const b of this.buildings.queryRect(seg.minX - m, seg.minZ - m, seg.maxX + m, seg.maxZ + m)) {
        if (!b.segId && this.buildings.all.has(b.id)) this.reattach(b);
      }
    }
    for (const r of rects) conformTerrain(this.terrain, this.roads, this.buildings, r);
    this.paths.invalidate();
    if (this.removedSegs.length || this.addedSegs.length) this.transit.onRoadsChanged();
    if (this.removedSegs.some((s) => s.ring)) this.pruneRoundabouts();
    this.pendingRects = [];
    this.pendingNodes.clear();
    this.removedSegs = [];
    this.addedSegs = [];
    this.trips.refresh();
    this.recomputeUtilities();
  }

  private segmentNeedsDeck(seg: RoadSegment): boolean {
    for (let i = 0; i < seg.poly.count; i++) {
      if (this.terrain.needsDeck(seg.poly.pts[i * 2], seg.poly.pts[i * 2 + 1])) return true;
    }
    return false;
  }

  /** Re-stamps every bridge deck into the terrain's road-height field. */
  stampBridges(): void {
    const decks = [...this.roads.segments.values()].filter((s) => s.elevated).map((s) => ({ poly: s.poly, halfWidth: ROAD_TYPES[s.type].halfWidth }));
    this.terrain.stampBridges(decks);
  }

  private pruneRoundabouts(): void {
    for (const rb of [...this.roads.roundabouts.values()]) {
      const ring = this.roads.segmentsIn(rb.x - rb.r - 4, rb.z - rb.r - 4, rb.x + rb.r + 4, rb.z + rb.r + 4).filter((s) => s.ring);
      if (ring.length < 2) this.roads.roundabouts.delete(rb.id);
    }
  }

  /** Full rebuild of all road-derived state (used after loading a save). */
  rebuildAllDerived(): void {
    this.stampBridges();
    this.pendingRects = [];
    this.pendingNodes.clear();
    this.removedSegs = [];
    this.addedSegs = [];
    this.layout.rebuildAll();
    this.signals.rebuild();
    const all: Rect = { minX: 0, minZ: 0, maxX: 1e5, maxZ: 1e5 };
    this.zones.rebuildRoadInfluence(this.roads, all);
    for (const seg of this.roads.segments.values()) this.nature.clearAlong(seg.poly, ROAD_TYPES[seg.type].halfWidth + 1.5);
    this.paths.invalidate();
  }

  /** Buys the next ring of land around the city. */
  buyLandRing(): { ok: boolean; error?: string; cost?: number } {
    const land = this.land;
    if (!land.nextRing) return { ok: false, error: 'The city already owns the whole map' };
    const cost = land.price;
    if (!this.economy.spend(cost, 'Construction')) return { ok: false, error: 'Not enough money' };
    // Streets along the old border can now be zoned on the new side.
    const h = LAND_TILE / 2 + 60;
    for (const i of land.grantRing()) {
      const c = Land.center(i);
      this.pendingRects.push({ minX: c.x - h, minZ: c.z - h, maxX: c.x + h, maxZ: c.z + h });
    }
    this.processRoadChanges();
    return { ok: true, cost };
  }

  /** Finds a new access road for a building after its road changed. */
  reattach(b: Building): void {
    const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
    // Lot front centre: centre minus local z axis * hd.
    const fx = b.cx + sa * b.hd;
    const fz = b.cz - ca * b.hd;
    const zonedOnly = b.kind === 'zoned';
    const hit = this.roads.nearestSegment(fx, fz, 30, (s) => !zonedOnly || ROAD_TYPES[s.type].zoning);
    if (hit && hit.proj.dist <= ROAD_TYPES[hit.seg.type].halfWidth + 6) {
      this.buildings.attach(b, hit.seg.id);
      b.segS = hit.proj.s;
      b.side = hit.proj.side;
      b.problems &= ~Problem.NoRoad;
    } else {
      this.buildings.detach(b);
      b.segId = 0;
      b.problems |= Problem.NoRoad;
    }
  }

  // ── Buildings ─────────────────────────────────────────────────────────────

  addBuilding(b: Building): Building {
    this.buildings.add(b);
    // New homes, shops and offices follow the city's current blend of movements.
    if (b.kind === 'zoned' && !b.movement) {
      b.movement = this.style.pick(b);
      // Styles built on a combo carry its traits (more homes, faster building…).
      this.design?.onNewBuilding(b);
    }
    const o = lotOBB(b);
    this.zones.setOccupant(o, b.id);
    this.nature.clearOBB(o, 1.5);
    const [minX, minZ, maxX, maxZ] = obbBounds(o);
    conformTerrain(this.terrain, this.roads, this.buildings, { minX: minX - 10, minZ: minZ - 10, maxX: maxX + 10, maxZ: maxZ + 10 });
    this.events.emit('spawned', { x: b.cx, y: b.y, z: b.cz, r: Math.max(b.hw, b.hd) });
    return b;
  }

  removeBuilding(id: number, reason: 'bulldoze' | 'abandoned' | 'fire' | 'rezone' | 'road' | 'replace' | 'disaster' = 'bulldoze'): Building | undefined {
    const b = this.buildings.get(id);
    if (!b) return undefined;
    const pop = this.population;
    for (const h of pop.householdsIn(id)) this.removeHousehold(h);
    if (b.jobs > 0) {
      pop.releaseWorkplace(id);
      b.workers = 0;
    }
    const o = lotOBB(b);
    this.zones.clearOccupant(o, id);
    this.buildings.remove(id);
    this.research.onBuildingRemoved(id);
    if (b.typeId === 'proto') this.design.onBuildingRemoved(b);
    const [minX, minZ, maxX, maxZ] = obbBounds(o);
    conformTerrain(this.terrain, this.roads, this.buildings, { minX: minX - 10, minZ: minZ - 10, maxX: maxX + 10, maxZ: maxZ + 10 });
    if (b.kind === 'service') {
      this.recomputeUtilities();
      if (b.typeId === 'metro_station') this.transit.metro.onBuildingRemoved(b.id);
    }
    this.events.emit('demolished', { x: b.cx, z: b.cz, kind: 'building' });
    void reason;
    return b;
  }

  addHousehold(home: Building, size: number, workers: number, educated: number): number {
    const i = this.population.add(home.id, size, workers, educated, home.level, this.clock.tick);
    this.population.taste[i] = this.people.groupForNewcomer(i, this.clock.tick);
    home.households++;
    home.residents += size;
    return i;
  }

  removeHousehold(i: number): void {
    const pop = this.population;
    if (!pop.alive[i]) return;
    const home = this.buildings.get(pop.home[i]);
    if (home) {
      home.households = Math.max(0, home.households - 1);
      home.residents = Math.max(0, home.residents - pop.size[i]);
    }
    for (let k = 0; k < 2; k++) {
      const j = pop.job[i * 2 + k];
      if (j) {
        const w = this.buildings.get(j);
        if (w) w.workers = Math.max(0, w.workers - 1);
      }
    }
    pop.remove(i);
  }

  // ── Connectivity ──────────────────────────────────────────────────────────

  private refreshOutside(): void {
    if (this.outsideCache.version === this.roads.version) return;
    const comps = this.roads.outsideComponents();
    let point: RoutePoint | null = null;
    for (const n of this.roads.nodes.values()) {
      if (!n.outside || !n.segs.length) continue;
      const seg = this.roads.getSegment(n.segs[0]);
      point = { segId: seg.id, s: seg.a === n.id ? Math.min(6, seg.length / 2) : Math.max(seg.length - 6, seg.length / 2) };
      break;
    }
    this.outsideCache = { version: this.roads.version, comps, point };
  }

  /** The map-edge highway entry, if it has lost its road (for pointing the player to it). */
  looseEntry(): { x: number; z: number } | null {
    for (const n of this.roads.nodes.values()) if (n.outside && !n.segs.length) return { x: n.x, z: n.z };
    return null;
  }

  outsidePoint(): RoutePoint | null {
    this.refreshOutside();
    return this.outsideCache.point;
  }

  componentOfSegment(segId: number): number {
    const seg = this.roads.segments.get(segId);
    if (!seg) return -1;
    return this.roads.components().get(seg.a) ?? -1;
  }

  isConnectedToOutside(segId: number): boolean {
    this.refreshOutside();
    return this.outsideCache.comps.has(this.componentOfSegment(segId));
  }

  recomputeUtilities(): void {
    const w = this.weather;
    const r = this.research;
    this.utilities.recompute(
      this.buildings,
      this.roads,
      (id) => {
        const st = SERVICE_BY_ID.get(id);
        const sky = id === 'wind_turbine' ? 'wind' : id === 'solar_farm' ? 'sun' : st ? r.weatherOf(st) : null;
        return (sky === 'wind' ? w.windPower() : sky === 'sun' ? w.solarPower() : 1) * (st ? r.outputScale(st) : 1);
      },
      { power: r.mods.powerUse, water: r.mods.waterUse, sewage: r.mods.waterUse },
    );
  }

  // ── World setup ───────────────────────────────────────────────────────────

  private createStartingHighway(): void {
    const sp = this.terrain.spawn;
    const a = this.roads.addNode(sp.edgeX, sp.edgeZ, true);
    const midX = (sp.edgeX + sp.endX) * 0.5;
    const midZ = (sp.edgeZ + sp.endZ) * 0.5 + 18;
    const m = this.roads.addNode(midX, midZ);
    const b = this.roads.addNode(sp.endX, sp.endZ);
    const name = REGIONAL_ROAD_NAME;
    this.namer.markUsed(name);
    this.roads.addSegment(a.id, m.id, 'highway', { name, ctrl: { x: (sp.edgeX + midX) / 2, z: (sp.edgeZ + midZ) / 2 + 10 } });
    this.roads.addSegment(m.id, b.id, 'highway', { name, ctrl: { x: (midX + sp.endX) / 2, z: (midZ + sp.endZ) / 2 - 8 } });
    this.processRoadChanges();
  }

  /** Location of the pre-built highway's inner end (camera start point). */
  get startPoint(): { x: number; z: number } {
    return { x: this.terrain.spawn.endX + 120, z: this.terrain.spawn.endZ };
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  buildingAt(x: number, z: number): Building | null {
    for (const b of this.buildings.queryRadius(x, z, 2)) {
      const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
      const dx = x - b.cx, dz = z - b.cz;
      if (Math.abs(dx * ca + dz * sa) <= b.hw && Math.abs(-dx * sa + dz * ca) <= b.hd) return b;
    }
    return null;
  }

  emitNotice(n: Omit<Notice, 'id' | 'tick'>, key?: string, cooldownTicks?: number): void {
    const notice = this.notifications.push(this.clock.tick, n, key, cooldownTicks);
    if (notice) this.events.emit('notice', notice);
  }

  isBuildingActive(b: Building): boolean {
    return b.state === BuildingState.Active;
  }
}

/** Merges overlapping rectangles to limit redundant rebuild work. */
export function mergeRects(rects: Rect[]): Rect[] {
  const out: Rect[] = [];
  for (const r of rects) {
    let merged = { ...r };
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < out.length; i++) {
        const o = out[i];
        if (o.minX <= merged.maxX && o.maxX >= merged.minX && o.minZ <= merged.maxZ && o.maxZ >= merged.minZ) {
          merged = {
            minX: Math.min(o.minX, merged.minX),
            minZ: Math.min(o.minZ, merged.minZ),
            maxX: Math.max(o.maxX, merged.maxX),
            maxZ: Math.max(o.maxZ, merged.maxZ),
          };
          out.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    out.push(merged);
  }
  return out;
}
