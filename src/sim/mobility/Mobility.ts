import type { Building } from '../buildings/Buildings';
import type { City } from '../City';
import { ROAD_TYPES } from '../roads/RoadTypes';
import { SERVICE_BY_ID } from '../services/ServiceTypes';
import type { RoutePoint } from '../traffic/Pathfinder';
import { BuildingState, Zone, isResidential, zoneBase } from '../types';
import { WALK_SPEED, type WalkLocation } from '../walk/WalkNetwork';

/**
 * How people get around, worked out from the real networks.
 *
 * Buildings are grouped into zones (160 m squares, split wherever a road
 * without sidewalks cuts through, so neighbours across a highway aren't
 * neighbours on foot). Travel times between zones by car (with the current
 * congestion), on foot (on the walking network) and by bus or metro are
 * refreshed a few zones per tick. From them, every commuter chooses how to
 * travel, every home gets its own commute time, shops get customers, parks get
 * visitors, and every neighbourhood gets a measure of how many jobs and shops
 * it can reach. Those numbers feed happiness, land value, demand, job matching
 * and the traffic model (people who walk or ride don't drive).
 */

export const ZONE_CELL = 160;
/** Unreachable, in the Uint16 tenths-of-a-minute matrices. */
const NONE = 65535;
const ROWS_PER_TICK = 4;
const HOUSEHOLDS_PER_TICK = 12_000;
const ZONES_PER_TICK = 60;
const MAX_WALK_MIN = 45;
/** Minutes to park, walk to and from the car. */
const CAR_OVERHEAD = 4;
/** Cycling: pace (m/s), how much longer the way is than the straight line, and the longest ride people take. */
const BIKE_SPEED = 4.6;
const BIKE_DETOUR = 1.3;
const MAX_BIKE_MIN = 35;
/** Shopping and park trips per household / resident per day. */
const SHOP_TRIPS = 0.9;
const PARK_TRIPS = 0.12;
/** Jobs count for access with weight exp(-minutes / JOB_DECAY): nearby jobs count most. */
const JOB_DECAY = 12;
/** Within this many minutes a home "reaches" a shop. */
const SHOP_REACH = 15;
const PARK_WALK = 15;

interface ZoneInfo {
  /** Cell and walking component (stable between refreshes). */
  key: number;
  x: number;
  z: number;
  /** The building standing for the zone (nearest its middle). */
  rep: Building;
  pt: RoutePoint;
  loc: WalkLocation | null;
  /** Walking-network edge of `loc`, and seconds from its two ends. */
  edge: number;
  fromA: number;
  fromB: number;
  households: number;
  residents: number;
  jobs: number;
  shopJobs: number;
  shops: Building[];
  parks: Building[];
}

interface Results {
  /** The walking network the walking times were measured on. */
  walkVersion: number;
  zones: ZoneInfo[];
  zoneOf: Map<number, number>;
  Z: number;
  car: Uint16Array;
  walk: Uint16Array;
  transit: Uint16Array;
  /** Per worker slot (household * 2 + k): chances of walking and of driving, and expected minutes. */
  slotWalk: Float32Array;
  slotCar: Float32Array;
  slotBike: Float32Array;
  slotMin: Float32Array;
  /** Per home: total minutes, commuters, and how many walk / ride / drive (summed shares). */
  homes: Map<number, Float64Array>;
  shops: Map<number, { visits: number; walk: number }>;
  parks: Map<number, { visits: number; capacity: number }>;
  zonePark: Float32Array;
  zoneJobs: Float32Array;
  zoneShops: Float32Array;
  zoneShopWalk: Float32Array;
  stats: MobilityStats;
}

export interface MobilityStats {
  commuters: number;
  walk: number;
  transit: number;
  car: number;
  /** Share of commuters who cycle. */
  bike: number;
  /** Average commute (minutes). */
  avgCommute: number;
  /** Share of commuters with a trip over 45 minutes. */
  longCommutes: number;
  shopVisits: number;
  /** Share of shopping trips made on foot. */
  shopOnFoot: number;
  parkVisits: number;
  crowdedParks: number;
  /** Average customers per shop job (for comparing shops). */
  visitsPerShopJob: number;
  /** Average access to jobs from home (0–1; nearby jobs count most). */
  jobAccess: number;
}

export interface MobilitySave {
  phase: number;
}

const tenth = (m: Uint16Array, i: number) => (m[i] === NONE ? Infinity : m[i] / 10);
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export class Mobility {
  /**
   * 0–1: how fully the new commute, park and access effects apply. New cities start
   * at 1; cities from before them ease in over a game year.
   */
  phase = 1;
  private live: Results | null = null;
  private job: Generator<void, void, void> | null = null;
  /** Work per step is divided by this (the game runs steps between frames, in smaller pieces). */
  fine = 1;
  private startedDay = -1;
  private walkScratch: Float32Array = new Float32Array(0);
  cycles = 0;

  constructor(private city: City) {}

  /** Whether a first set of results is in. */
  get ready(): boolean {
    return this.live !== null;
  }

  /** How strongly the effects apply right now (0 until the first results are in). */
  get effect(): number {
    return this.live ? this.phase : 0;
  }

  get stats(): MobilityStats | null {
    return this.live?.stats ?? null;
  }

  // ── Running ───────────────────────────────────────────────────────────────

  /** One tick of work: a few zones' travel times, or a slice of commuters. */
  tick(): void {
    if (!this.job) {
      if (this.live && (this.city.clock.hour !== 2 || this.startedDay === this.city.clock.day)) return;
      this.startedDay = this.city.clock.day;
      this.job = this.cycle();
    }
    if (this.job.next().done) this.job = null;
  }

  /** Easing in after loading an older city. */
  daily(): void {
    if (this.phase < 1) this.phase = Math.min(1, this.phase + 1 / 360);
  }

  /** Runs a whole cycle at once (tests, and right after loading a small city). */
  runNow(): void {
    this.job = this.cycle();
    while (!this.job.next().done);
    this.job = null;
  }

  private *cycle(): Generator<void, void, void> {
    const city = this.city;
    // Wait (a while) for a rebuild of the walking network in progress, rather than use the old one.
    for (let waits = 0; city.walk.stale && waits < 120; waits++) {
      city.walk.ensure();
      yield;
    }
    city.walk.finish();
    const r = this.buildZones();
    yield;
    // Walking times only change with the roads: keep last time's, and walk out only from new zones.
    const fresh = this.reuseWalking(r);
    yield;
    // A few zones a tick, and no more than two walking trees (the costly part, mostly after loading).
    let n = 0, walks = 0;
    for (let z = 0; z < r.Z; z++) {
      this.rows(r, z, fresh[z] === 1);
      walks += fresh[z];
      if (++n >= Math.max(1, ROWS_PER_TICK / this.fine) || walks >= (this.fine > 1 ? 1 : 2)) {
        n = walks = 0;
        yield;
      }
    }
    this.transitRows(r);
    yield;
    yield* this.commuters(r);
    yield* this.destinations(r);
    this.live = r;
    this.cycles++;
  }

  // ── Zones ─────────────────────────────────────────────────────────────────

  private buildZones(): Results {
    const city = this.city;
    const walk = city.walk;
    const byKey = new Map<number, number>();
    const zones: ZoneInfo[] = [];
    const zoneOf = new Map<number, number>();
    const members: Building[][] = [];
    for (const b of city.buildings.all.values()) {
      if (b.state !== BuildingState.Active || !b.segId) continue;
      const loc = walk.locationOf(b);
      const e = loc ? walk.edgeAt(loc) : -1;
      // Split cells by the part of the walking network a building opens onto.
      const comp = e >= 0 ? walk.component[walk.ea[e]] + 1 : 0;
      const key = (Math.floor(b.cz / ZONE_CELL) * 64 + Math.floor(b.cx / ZONE_CELL)) * 100_000 + comp;
      let z = byKey.get(key);
      if (z === undefined) {
        z = zones.length;
        byKey.set(key, z);
        zones.push({ key, x: 0, z: 0, rep: b, pt: { segId: b.segId, s: b.segS }, loc: null, edge: -1, fromA: 0, fromB: 0, households: 0, residents: 0, jobs: 0, shopJobs: 0, shops: [], parks: [] });
        members.push([]);
      }
      zoneOf.set(b.id, z);
      members[z].push(b);
      const zi = zones[z];
      if (b.kind === 'zoned') {
        if (isResidential(b.zone)) {
          zi.households += b.households;
          zi.residents += b.residents;
        } else {
          zi.jobs += b.workers;
          if (zoneBase(b.zone) === Zone.Commercial && b.jobs > 0) {
            zi.shopJobs += Math.max(1, b.workers);
            zi.shops.push(b);
          }
        }
      } else {
        zi.jobs += b.workers;
        const st = SERVICE_BY_ID.get(b.typeId);
        if (st?.kind === 'park' || st?.kind === 'landmark') zi.parks.push(b);
      }
    }
    // Each zone is represented by its building nearest the middle.
    for (let z = 0; z < zones.length; z++) {
      const zi = zones[z];
      const list = members[z];
      let sx = 0, sz = 0;
      for (const b of list) {
        sx += b.cx;
        sz += b.cz;
      }
      zi.x = sx / list.length;
      zi.z = sz / list.length;
      let best = list[0], bd = Infinity;
      for (const b of list) {
        const d = (b.cx - zi.x) ** 2 + (b.cz - zi.z) ** 2;
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      zi.rep = best;
      zi.pt = { segId: best.segId, s: best.segS };
      zi.loc = walk.locationOf(best);
      zi.edge = zi.loc ? walk.edgeAt(zi.loc) : -1;
      if (zi.edge >= 0) {
        const t = Math.max(0, Math.min(walk.len[zi.edge], zi.loc!.s - walk.s0[zi.edge]));
        zi.fromA = t / WALK_SPEED;
        zi.fromB = (walk.len[zi.edge] - t) / WALK_SPEED;
      }
    }
    const Z = zones.length;
    const pop = city.population;
    const slots = Math.max(2, pop.count * 2);
    return {
      walkVersion: walk.version,
      zones,
      zoneOf,
      Z,
      car: new Uint16Array(Z * Z).fill(NONE),
      walk: new Uint16Array(Z * Z).fill(NONE),
      transit: new Uint16Array(Z * Z).fill(NONE),
      slotWalk: new Float32Array(slots),
      slotCar: new Float32Array(slots).fill(1),
      slotBike: new Float32Array(slots),
      slotMin: new Float32Array(slots),
      homes: new Map(),
      shops: new Map(),
      parks: new Map(),
      zonePark: new Float32Array(Z),
      zoneJobs: new Float32Array(Z),
      zoneShops: new Float32Array(Z),
      zoneShopWalk: new Float32Array(Z),
      stats: { commuters: 0, walk: 0, transit: 0, car: 0, bike: 0, avgCommute: 0, longCommutes: 0, shopVisits: 0, shopOnFoot: 0, parkVisits: 0, crowdedParks: 0, visitsPerShopJob: 0, jobAccess: 0 },
    };
  }

  /**
   * Copies walking times between zones that existed last time (if the walking
   * network hasn't changed since); returns which zones still need theirs worked out.
   */
  private reuseWalking(r: Results): Uint8Array {
    const fresh = new Uint8Array(r.Z).fill(1);
    const prev = this.live;
    if (!prev || prev.walkVersion !== r.walkVersion) return fresh;
    const was = new Map<number, number>();
    prev.zones.forEach((zi, k) => was.set(zi.key, k));
    const old = new Int32Array(r.Z);
    for (let z = 0; z < r.Z; z++) {
      const o = was.get(r.zones[z].key);
      old[z] = o === undefined ? -1 : o;
      if (o !== undefined) fresh[z] = 0;
    }
    const PZ = prev.Z, Z = r.Z;
    for (let a = 0; a < Z; a++) {
      const oa = old[a];
      if (oa < 0) continue;
      const src = oa * PZ, dst = a * Z;
      for (let b = 0; b < Z; b++) {
        const ob = old[b];
        if (ob >= 0) r.walk[dst + b] = prev.walk[src + ob];
      }
    }
    return fresh;
  }

  /** Car (and, for zones that need them, walking) times from zone `z` to every zone. */
  private rows(r: Results, z: number, walking = true): void {
    const city = this.city;
    const { zones, Z, car, walk } = r;
    const zi = zones[z];
    const base = z * Z;
    // By car, with today's congestion.
    const tree = city.paths.tree(zi.pt);
    if (tree) {
      const { cost, stamp, gen } = tree;
      const net = city.roads;
      for (let k = 0; k < Z; k++) {
        const to = zones[k].pt;
        const ts = net.segments.get(to.segId);
        if (!ts) continue;
        const sp = ROAD_TYPES[ts.type].speed;
        let t: number;
        if (ts.id === zi.pt.segId) t = Math.abs(to.s - zi.pt.s) / sp;
        else {
          const ca = stamp[ts.a] === gen && ts.oneway !== -1 ? cost[ts.a] + to.s / sp : Infinity;
          const cb = stamp[ts.b] === gen && ts.oneway !== 1 ? cost[ts.b] + (ts.length - to.s) / sp : Infinity;
          t = Math.min(ca, cb);
        }
        if (t < Infinity) car[base + k] = Math.min(NONE - 1, Math.round(t / 6) + CAR_OVERHEAD * 10);
      }
    }
    // On foot, along the sidewalks and across at the crossings (the same both ways).
    if (walking && zi.loc && zi.edge >= 0) {
      const w = city.walk;
      const t = (this.walkScratch = w.timesFrom(zi.loc, MAX_WALK_MIN * 60, this.walkScratch));
      for (let k = 0; k < Z; k++) {
        const zk = zones[k];
        if (zk.edge < 0) continue;
        let s: number;
        if (zk.edge === zi.edge) s = Math.abs(zk.fromA - zi.fromA);
        else s = Math.min(t[w.ea[zk.edge]] + zk.fromA, t[w.eb[zk.edge]] + zk.fromB);
        // A minute or so from the door to the pavement at each end.
        if (s < MAX_WALK_MIN * 60) walk[base + k] = walk[k * Z + z] = Math.round(s / 6) + 10;
      }
    }
    car[base + z] = Math.min(car[base + z], 30);
  }

  /** Bus and metro times between zones near their stops. */
  private transitRows(r: Results): void {
    const { zones, Z, transit } = r;
    const cells = new Map<number, number[]>();
    zones.forEach((zi, k) => {
      const key = Math.floor(zi.z / ZONE_CELL) * 64 + Math.floor(zi.x / ZONE_CELL);
      const list = cells.get(key);
      if (list) list.push(k);
      else cells.set(key, [k]);
    });
    for (const ride of this.city.transit.rideOptions()) {
      // Zones within a walk of each stop, and how long the walk is.
      const near = ride.points.map((p) => {
        const out: { z: number; s: number }[] = [];
        const span = Math.ceil(ride.walkRadius / ZONE_CELL);
        const cx = Math.floor(p.x / ZONE_CELL), cz = Math.floor(p.z / ZONE_CELL);
        for (let dz = -span; dz <= span; dz++) {
          for (let dx = -span; dx <= span; dx++) {
            for (const k of cells.get((cz + dz) * 64 + cx + dx) ?? []) {
              const d = Math.hypot(zones[k].x - p.x, zones[k].z - p.z);
              if (d <= ride.walkRadius) out.push({ z: k, s: (d * 1.25) / 1.3 });
            }
          }
        }
        return out;
      });
      const n = ride.points.length;
      for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) {
          if (a === b || !near[a].length || !near[b].length) continue;
          const ridden = (ride.times[b] - ride.times[a] + ride.loopSeconds) % ride.loopSeconds;
          const fixed = ride.wait + ridden + ride.penalty * 300;
          for (const ha of near[a]) {
            for (const hb of near[b]) {
              const t = Math.round((ha.s + fixed + hb.s) / 6);
              const i = ha.z * Z + hb.z;
              if (t < transit[i]) transit[i] = t;
            }
          }
        }
      }
    }
  }

  // ── Commuters ─────────────────────────────────────────────────────────────

  private *commuters(r: Results): Generator<void, void, void> {
    const city = this.city;
    const pop = city.population;
    const share = city.transit.share;
    const { Z, car, walk, transit, zoneOf, homes, stats, zones } = r;
    let minutes = 0, long = 0;
    // How happy people are to cycle from and to each zone (quiet streets yes, busy main roads no).
    const safety = new Float32Array(Z);
    for (let z = 0; z < Z; z++) safety[z] = this.bikeSafety(zones[z].rep);
    for (let i = 0; i < pop.count; i++) {
      if (i % (HOUSEHOLDS_PER_TICK / this.fine) === HOUSEHOLDS_PER_TICK / this.fine - 1) yield;
      if (!pop.alive[i]) continue;
      const zh = zoneOf.get(pop.home[i]);
      for (let k = 0; k < 2; k++) {
        const job = pop.job[i * 2 + k];
        if (!job) continue;
        const slot = i * 2 + k;
        const tShare = slot < share.length ? share[slot] : 0;
        const zj = zoneOf.get(job);
        if (zh === undefined || zj === undefined) {
          r.slotCar[slot] = 1 - tShare;
          continue;
        }
        const ij = zh * Z + zj;
        const walkM = tenth(walk, ij), carM = tenth(car, ij), trM = tenth(transit, ij);
        // Walking against the best alternative: a minute on foot is worth more effort than one in a seat.
        const alt = Math.min(carM + 5, trM * 1.15);
        let pWalk = 0;
        if (walkM <= MAX_WALK_MIN) pWalk = alt === Infinity ? 0.92 : 0.92 * sigmoid((alt - walkM * 1.5) / 3);
        // Cycling: a few brave souls anywhere, many more where the streets feel safe, if it's not too far.
        const za = zones[zh], zb = zones[zj];
        const bikeM = (Math.hypot(za.x - zb.x, za.z - zb.z) * BIKE_DETOUR) / BIKE_SPEED / 60 + 2;
        // Lanes draw riders who'd never mix with traffic.
        const lanes = Math.min(this.laneAt(zones[zh].rep), this.laneAt(zones[zj].rep));
        const willing = 0.04 + 0.22 * Math.min(safety[zh], safety[zj]) + (lanes === 2 ? 0.14 : lanes === 1 ? 0.06 : 0);
        const pB = bikeM <= MAX_BIKE_MIN && carM < Infinity ? (1 - pWalk) * willing * sigmoid((Math.min(alt, carM + 5) - bikeM * 1.3) / 4) : 0;
        const pT = (1 - pWalk - pB) * (trM < Infinity ? tShare : 0);
        const pC = Math.max(0, 1 - pWalk - pB - pT);
        const rideM = trM < Infinity ? trM : carM * 1.3;
        // (Modes nobody uses don't count, even when they'd take forever.)
        let m = (pWalk > 0 ? pWalk * walkM : 0) + (pB > 0 ? pB * bikeM : 0) + (pT > 0 ? pT * rideM : 0) + (pC > 0 ? pC * carM : 0);
        if (!(m < 240)) m = 90;
        r.slotWalk[slot] = pWalk;
        r.slotBike[slot] = pB;
        r.slotCar[slot] = pC;
        r.slotMin[slot] = m;
        let h = homes.get(pop.home[i]);
        if (!h) homes.set(pop.home[i], (h = new Float64Array(6)));
        h[0] += m;
        h[1] += 1;
        h[2] += pWalk;
        h[3] += pT;
        h[4] += pC;
        h[5] += pB;
        stats.commuters++;
        stats.walk += pWalk;
        stats.transit += pT;
        stats.car += pC;
        stats.bike += pB;
        minutes += m;
        if (m > 45) long++;
      }
    }
    if (stats.commuters > 0) {
      stats.avgCommute = minutes / stats.commuters;
      stats.longCommutes = long / stats.commuters;
      stats.walk /= stats.commuters;
      stats.transit /= stats.commuters;
      stats.car /= stats.commuters;
      stats.bike /= stats.commuters;
    }
  }

  // ── Shops, parks and access ───────────────────────────────────────────────

  private *destinations(r: Results): Generator<void, void, void> {
    const { zones, Z, car, walk, transit, stats } = r;
    let totalJobs = 0;
    for (const zi of zones) totalJobs += zi.jobs;
    const shopZones: number[] = [];
    const parkList: { b: Building; z: number; appeal: number; capacity: number }[] = [];
    zones.forEach((zi, k) => {
      if (zi.shopJobs > 0) shopZones.push(k);
      for (const b of zi.parks) {
        const st = SERVICE_BY_ID.get(b.typeId)!;
        // Visitors a day a park takes comfortably: by its size.
        parkList.push({ b, z: k, appeal: Math.min(1, st.attractiveness), capacity: Math.max(80, st.w * st.d * 0.5 * (0.6 + st.attractiveness)) });
      }
    });
    const shopVisits = new Float64Array(Z), shopWalk = new Float64Array(Z);
    const parkVisits = new Float64Array(parkList.length);
    const reachable: { p: number; f: number }[][] = new Array(Z);
    let accessSum = 0, accessN = 0, onFoot = 0, visitsAll = 0;
    const weights = new Float64Array(Math.max(1, shopZones.length));
    const footShare = new Float64Array(Math.max(1, shopZones.length));
    for (let zh = 0; zh < Z; zh++) {
      if (zh % Math.ceil(ZONES_PER_TICK / this.fine) === Math.ceil(ZONES_PER_TICK / this.fine) - 1) yield;
      const zi = zones[zh];
      if (zi.households <= 0) continue;
      const row = zh * Z;
      // Jobs and shops within reach.
      let jobs = 0, shops = 0;
      for (let k = 0; k < Z; k++) {
        const zk = zones[k];
        if (!zk.jobs && !zk.shopJobs) continue;
        const best = Math.min(tenth(walk, row + k), tenth(transit, row + k), tenth(car, row + k));
        if (best < Infinity) jobs += zk.jobs * Math.exp(-best / JOB_DECAY);
        if (best <= SHOP_REACH) shops += zk.shopJobs;
      }
      r.zoneJobs[zh] = totalJobs > 0 ? jobs / totalJobs : 0;
      r.zoneShops[zh] = shops;
      accessSum += r.zoneJobs[zh] * zi.households;
      accessN += zi.households;
      // Shopping: nearby shops draw more, and walkable ones are walked to.
      let wsum = 0;
      for (let m = 0; m < shopZones.length; m++) {
        const k = shopZones[m];
        const walkM = tenth(walk, row + k), carM = tenth(car, row + k);
        const best = Math.min(walkM * 1.5, carM + 5);
        if (best > 35) {
          weights[m] = 0;
          continue;
        }
        const wgt = zones[k].shopJobs * Math.exp(-best / 7);
        weights[m] = wgt;
        footShare[m] = walkM <= 25 ? (carM === Infinity ? 1 : sigmoid((carM + 5 - walkM * 1.5) / 3)) : 0;
        wsum += wgt;
      }
      if (wsum > 0) {
        const trips = zi.households * SHOP_TRIPS;
        let foot = 0;
        for (let m = 0; m < shopZones.length; m++) {
          if (!weights[m]) continue;
          const v = (trips * weights[m]) / wsum;
          shopVisits[shopZones[m]] += v;
          shopWalk[shopZones[m]] += v * footShare[m];
          foot += v * footShare[m];
        }
        r.zoneShopWalk[zh] = foot / trips;
        onFoot += foot;
        visitsAll += trips;
      }
      // Parks within a walk.
      const list: { p: number; f: number }[] = [];
      let fsum = 0;
      for (let p = 0; p < parkList.length; p++) {
        const walkM = tenth(walk, row + parkList[p].z);
        if (walkM > PARK_WALK) continue;
        const f = parkList[p].appeal * Math.exp(-walkM / 6);
        list.push({ p, f });
        fsum += f;
      }
      if (fsum > 0) for (const it of list) parkVisits[it.p] += (zi.residents * PARK_TRIPS * it.f) / fsum;
      reachable[zh] = list;
    }
    // Crowded parks are worth less to each visitor.
    const crowd = parkList.map((pk, p) => (parkVisits[p] > pk.capacity ? Math.sqrt(pk.capacity / parkVisits[p]) : 1));
    for (let zh = 0; zh < Z; zh++) {
      const list = reachable[zh];
      if (!list) continue;
      let a = 0;
      for (const it of list) a += it.f * crowd[it.p];
      r.zonePark[zh] = Math.min(1, a * 1.4);
    }
    parkList.forEach((pk, p) => {
      r.parks.set(pk.b.id, { visits: parkVisits[p], capacity: pk.capacity });
      stats.parkVisits += parkVisits[p];
      if (parkVisits[p] > pk.capacity) stats.crowdedParks++;
    });
    // Each shop's share of its zone's customers, by size.
    let shopJobs = 0;
    for (const k of shopZones) {
      const zi = zones[k];
      shopJobs += zi.shopJobs;
      for (const b of zi.shops) {
        const f = Math.max(1, b.workers) / zi.shopJobs;
        r.shops.set(b.id, { visits: shopVisits[k] * f, walk: shopVisits[k] > 0 ? shopWalk[k] / shopVisits[k] : 0 });
      }
    }
    stats.shopVisits = visitsAll;
    stats.shopOnFoot = visitsAll > 0 ? onFoot / visitsAll : 0;
    stats.visitsPerShopJob = shopJobs > 0 ? visitsAll / shopJobs : 0;
    stats.jobAccess = accessN > 0 ? accessSum / accessN : 0;
  }

  // ── Questions ─────────────────────────────────────────────────────────────

  private zone(b: Building): number | undefined {
    return this.live?.zoneOf.get(b.id);
  }

  /** A home's average commute (minutes), if anyone there works. */
  commuteOf(b: Building): number | null {
    const h = this.live?.homes.get(b.id);
    return h && h[1] > 0 ? h[0] / h[1] : null;
  }

  /** How a home's commuters travel (shares that add up to 1). */
  modesOf(b: Building): { walk: number; transit: number; car: number; bike: number } | null {
    const h = this.live?.homes.get(b.id);
    if (!h || h[1] <= 0) return null;
    return { walk: h[2] / h[1], transit: h[3] / h[1], car: h[4] / h[1], bike: h[5] / h[1] };
  }

  /** Chance a worker cycles to work. */
  bikeShare(i: number, k: number): number {
    const r = this.live;
    const slot = i * 2 + k;
    return r && slot < r.slotBike.length ? r.slotBike[slot] : 0;
  }

  /** Bike lanes on a building's street (0 none, 1 painted, 2 protected). */
  laneAt(b: Building): number {
    const seg = b.segId ? this.city.roads.segments.get(b.segId) : undefined;
    return seg?.bikeLane ?? 0;
  }

  /** How safe a building's street feels to ride on (0–1): quiet streets, not busy main roads. */
  bikeSafety(b: Building): number {
    const seg = b.segId ? this.city.roads.segments.get(b.segId) : undefined;
    if (!seg) return 0;
    const kind: Record<string, number> = { lane: 1, street: 0.9, avenue: 0.45, boulevard: 0.35 };
    const base = kind[seg.type] ?? 0;
    const traffic = base * (1 - 0.6 * Math.min(1, this.city.traffic.ratio(seg.id)));
    // A lane of their own makes a busy road fine to ride; a protected one, as good as a quiet street.
    return seg.bikeLane === 2 ? Math.max(traffic, 1) : seg.bikeLane === 1 ? Math.max(traffic, 0.75) : traffic;
  }

  /** Access to the city's jobs from a building (0–1: the share of jobs, nearby ones counting most). */
  jobAccess(b: Building): number | null {
    const z = this.zone(b);
    return z === undefined ? null : this.live!.zoneJobs[z];
  }

  /** How well a home is served by parks within a walk, after crowding (0–1). */
  parkAccess(b: Building): number | null {
    const z = this.zone(b);
    return z === undefined ? null : this.live!.zonePark[z];
  }

  /** Customers a day at a shop, and the share who walked there. */
  customers(b: Building): { visits: number; walk: number } | null {
    return this.live?.shops.get(b.id) ?? null;
  }

  /** Visitors a day at a park, and how many it takes comfortably. */
  parkVisits(b: Building): { visits: number; capacity: number } | null {
    return this.live?.parks.get(b.id) ?? null;
  }

  /** Chance a commuter drives (the traffic model's demand); before the first results, everyone not on transit. */
  carShare(i: number, k: number): number {
    const slot = i * 2 + k;
    const r = this.live;
    if (r && slot < r.slotCar.length && this.city.population.job[slot] && r.homes.has(this.city.population.home[i])) return r.slotCar[slot];
    const share = this.city.transit.share;
    return slot < share.length ? 1 - share[slot] : 1;
  }

  /** Chance a commuter walks to work (null before the first results). */
  walkShare(i: number, k: number): number | null {
    const r = this.live;
    const slot = i * 2 + k;
    return r && slot < r.slotWalk.length ? r.slotWalk[slot] : null;
  }

  /** Share of a home's shopping trips made by car. */
  shopCarShare(home: Building): number {
    const z = this.zone(home);
    return z === undefined ? 1 : 1 - this.live!.zoneShopWalk[z];
  }

  /**
   * How far apart two buildings are for someone choosing where to work: the
   * quickest of walking (counted at 1.5×), the bus or metro, and driving.
   * Null if either isn't in a zone yet.
   */
  minutesBetween(a: Building, b: Building): number | null {
    const r = this.live;
    if (!r) return null;
    const za = r.zoneOf.get(a.id), zb = r.zoneOf.get(b.id);
    if (za === undefined || zb === undefined) return null;
    const i = za * r.Z + zb;
    return Math.min(tenth(r.walk, i) * 1.5, tenth(r.transit, i) * 1.15, tenth(r.car, i) + 5);
  }

  /** Minutes between two buildings on foot, by bus or metro, and by car (Infinity where there's no way). */
  minutesByMode(a: Building, b: Building): { walk: number; transit: number; car: number } | null {
    const r = this.live;
    if (!r) return null;
    const za = r.zoneOf.get(a.id), zb = r.zoneOf.get(b.id);
    if (za === undefined || zb === undefined) return null;
    const i = za * r.Z + zb;
    return { walk: tenth(r.walk, i), transit: tenth(r.transit, i), car: tenth(r.car, i) };
  }

  /** Average jobs access and commute of the homes in a set of zones (for the panel). */
  zones(): { x: number; z: number; households: number; commute: number; jobs: number; park: number }[] {
    const r = this.live;
    if (!r) return [];
    const sum = new Float64Array(r.Z), n = new Float64Array(r.Z);
    for (const [id, h] of r.homes) {
      const z = r.zoneOf.get(id);
      if (z === undefined) continue;
      sum[z] += h[0];
      n[z] += h[1];
    }
    return r.zones.map((zi, k) => ({ x: zi.x, z: zi.z, households: zi.households, commute: n[k] > 0 ? sum[k] / n[k] : 0, jobs: r.zoneJobs[k], park: r.zonePark[k] }));
  }

  serialize(): MobilitySave {
    return { phase: this.phase };
  }

  load(data: MobilitySave | undefined): void {
    // Cities from before these effects ease into them.
    this.phase = data ? data.phase : 0;
    this.live = null;
    this.job = null;
  }
}
