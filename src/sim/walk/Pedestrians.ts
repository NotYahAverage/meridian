import { localToWorld } from '../../core/geom2d';
import { Rng } from '../../core/rng';
import type { Building } from '../buildings/Buildings';
import type { City } from '../City';
import { MAX_VEHICLES } from '../constants';
import { adultsIn, bodySize, citizenOf, lookOf } from '../population/Citizens';
import { ROAD_TYPES } from '../roads/RoadTypes';
import { SERVICE_BY_ID } from '../services/ServiceTypes';
import { WalkLight } from '../traffic/Signals';
import { timeOfDayFactor } from '../traffic/TripGenerator';
import { Purpose } from '../traffic/Vehicles';
import { BuildingState, Zone, isResidential, zoneBase } from '../types';
import { WalkEdge, type WalkLocation, type WalkRoute } from './WalkNetwork';

/**
 * People on foot near the camera. Each one is a member of a real household,
 * on a real errand: to work, school, the shops or the park, home again, or to
 * a bus stop to catch the bus. They follow the walking network door to door,
 * keep to the right and step around each other, wait for the walk signal or
 * a gap in traffic, stop at shop windows and to chat, and go inside at the end.
 *
 * Purely a view of the simulation: nothing here feeds back into it, and the
 * simulation never depends on where the camera is.
 */

export const MAX_PEOPLE = 2400;

export enum Errand {
  Home = 0,
  Work = 1,
  Shop = 2,
  Park = 3,
  School = 4,
  Bus = 5,
  Stroll = 6,
  Lunch = 7,
}

export enum PauseWhy {
  None = 0,
  Window = 1,
  Chat = 2,
  TurnBack = 3,
}

export enum PedState {
  Free = 0,
  /** Moving along the path. */
  Walk = 1,
  /** At the kerb, waiting for the lights or a gap in traffic. */
  WaitCross = 2,
  /** Standing still for a moment: a shop window, a chat, a phone. */
  Pause = 3,
  /** Stepping in through a door (or onto a bus), fading out. */
  Inside = 4,
  /** Waiting at a bus stop. */
  Stop = 5,
  /** Spending time in a park. */
  Linger = 6,
  /** Walking beside someone else (a child with a parent, a couple). */
  Follow = 7,
}

/** Kinds of path segment. */
export const SEG = { walk: 0, signal: 1, zebra: 2, informal: 3, door: 4, grounds: 5 } as const;

/** A person's way from door to door, as a polyline with what each piece is. */
export interface Path {
  pts: Float32Array;
  n: number;
  /** Per segment (n - 1): kind, lateral room either side of the line, and the crossing's junction and road. */
  kind: Uint8Array;
  room: Float32Array;
  node: Int32Array;
  seg: Int32Array;
  /** Stops along the way: vertex index, seconds, facing angle. */
  pauses: number[];
  length: number;
}

/** Height of the sidewalk surface above the road height field (matches the road mesh: lift + kerb). */
const SIDEWALK_Y = 0.23;
const ROAD_Y = 0.08;
const BUBBLE = 360;
const DESPAWN = BUBBLE + 90;
/** People closer than this to the camera step around each other and stop to chat. */
const NEAR = 190;
const MAX_WALK = 22 * 60;
const TURN_RATE = 6;

const gauss = (h: number, mu: number, s: number) => Math.exp(-((h - mu) ** 2) / (2 * s * s));

interface Bubble {
  ids: Set<number>;
  homes: Building[];
  shops: Building[];
  works: Building[];
  parks: Building[];
  stops: { id: number; x: number; z: number; loc: WalkLocation; waiting: number }[];
  weight: number;
}

class PathBuilder {
  pts: number[] = [];
  kind: number[] = [];
  room: number[] = [];
  node: number[] = [];
  seg: number[] = [];
  pauses: number[] = [];

  reset(x: number, z: number): void {
    this.pts.length = this.kind.length = this.room.length = this.node.length = this.seg.length = this.pauses.length = 0;
    this.pts.push(x, z);
  }

  get last(): number {
    return this.pts.length / 2 - 1;
  }

  to(x: number, z: number, kind: number, room: number, node = 0, seg = 0): void {
    const n = this.pts.length;
    if (Math.hypot(x - this.pts[n - 2], z - this.pts[n - 1]) < 0.05) return;
    this.pts.push(x, z);
    this.kind.push(kind);
    this.room.push(room);
    this.node.push(node);
    this.seg.push(seg);
  }

  finish(): Path {
    const n = this.pts.length / 2;
    let length = 0;
    for (let i = 1; i < n; i++) length += Math.hypot(this.pts[i * 2] - this.pts[i * 2 - 2], this.pts[i * 2 + 1] - this.pts[i * 2 - 1]);
    return {
      pts: Float32Array.from(this.pts),
      n,
      kind: Uint8Array.from(this.kind),
      room: Float32Array.from(this.room),
      node: Int32Array.from(this.node),
      seg: Int32Array.from(this.seg),
      pauses: this.pauses.slice(),
      length,
    };
  }
}

/** Where people go into a building: just inside the lot's street front. */
function doorOf(b: Building, jitter = 0): { x: number; z: number } {
  const p = { x: 0, z: 0 };
  return localToWorld(b, Math.max(-b.hw * 0.4, Math.min(b.hw * 0.4, jitter)), -b.hd + Math.min(1.6, b.hd * 0.4), p);
}

export interface PedStats {
  spawned: number;
  arrived: number;
  boarded: number;
  alighted: number;
  /** Crossings started against the light (should stay at zero). */
  redLight: number;
  crossings: number;
  /** People who gave up waiting for a gap and crossed anyway. */
  forced: number;
}

export interface PedExit {
  serial: number;
  building: number;
  how: 'inside' | 'bus' | 'away';
}

export class Pedestrians {
  readonly max = MAX_PEOPLE;
  readonly active = new Uint8Array(MAX_PEOPLE);
  readonly serial = new Uint32Array(MAX_PEOPLE);
  readonly state = new Uint8Array(MAX_PEOPLE);
  readonly errand = new Uint8Array(MAX_PEOPLE);
  readonly x = new Float32Array(MAX_PEOPLE);
  readonly y = new Float32Array(MAX_PEOPLE);
  readonly z = new Float32Array(MAX_PEOPLE);
  readonly heading = new Float32Array(MAX_PEOPLE);
  /** 0–1 while stepping out of or into a door. */
  readonly scale = new Float32Array(MAX_PEOPLE);
  /** Current speed (m/s) and stride phase (radians), for animation. */
  readonly speed = new Float32Array(MAX_PEOPLE);
  readonly stride = new Float32Array(MAX_PEOPLE);
  readonly age = new Uint8Array(MAX_PEOPLE);
  /** Height relative to an adult (smaller people take quicker steps). */
  readonly height = new Float32Array(MAX_PEOPLE);
  readonly look = new Uint32Array(MAX_PEOPLE);
  /** Household slot and member index (with the household's move-in tick, to notice when it has gone). */
  readonly household = new Int32Array(MAX_PEOPLE);
  readonly member = new Uint8Array(MAX_PEOPLE);
  readonly moveIn = new Int32Array(MAX_PEOPLE);
  /** Building (or bus stop, for Errand.Bus) they're heading to, and where they came from. */
  readonly dest = new Int32Array(MAX_PEOPLE);
  readonly origin = new Int32Array(MAX_PEOPLE);
  readonly leader = new Int32Array(MAX_PEOPLE).fill(-1);
  /** Why someone has stopped (PauseWhy). */
  readonly pauseWhy = new Uint8Array(MAX_PEOPLE);
  private followers = new Int32Array(MAX_PEOPLE * 2).fill(-1);
  private side = new Float32Array(MAX_PEOPLE);
  private paths: (Path | null)[] = new Array(MAX_PEOPLE).fill(null);
  private seg = new Int32Array(MAX_PEOPLE);
  private u = new Float32Array(MAX_PEOPLE);
  private pace = new Float32Array(MAX_PEOPLE);
  private lat = new Float32Array(MAX_PEOPLE);
  private latGoal = new Float32Array(MAX_PEOPLE);
  private latPref = new Float32Array(MAX_PEOPLE);
  private back = new Float32Array(MAX_PEOPLE);
  private timer = new Float32Array(MAX_PEOPLE);
  private waited = new Float32Array(MAX_PEOPLE);
  private face = new Float32Array(MAX_PEOPLE);
  private chatCool = new Float32Array(MAX_PEOPLE);
  private nextPause = new Int32Array(MAX_PEOPLE);
  private fadeIn = new Uint8Array(MAX_PEOPLE);
  private tx = new Float32Array(MAX_PEOPLE);
  private tz = new Float32Array(MAX_PEOPLE);
  private free: number[] = [];
  count = 0;
  readonly stats: PedStats = { spawned: 0, arrived: 0, boarded: 0, alighted: 0, redLight: 0, crossings: 0, forced: 0 };
  /** Recent departures (for the inspector when the person it shows goes indoors). */
  readonly exits: PedExit[] = [];
  /** Visual density (the traffic density setting). */
  density = 1;
  /** Someone the player has selected: kept around while they're watched. */
  watched = -1;

  private rng = new Rng(4711);
  private builder = new PathBuilder();
  private bubble: Bubble = { ids: new Set(), homes: [], shops: [], works: [], parks: [], stops: [], weight: 0 };
  private bubbleAt = { x: NaN, z: NaN, t: 0 };
  private services = { version: -1, schools: [] as Building[], parks: [] as Building[] };
  private spawnTimer = 0;
  private routeBudget = 0;
  private busTimer = 0;
  private dwelling: { x: number; z: number; i: number; serial: number }[] = [];
  private dwellSeen = new Map<number, number>();
  private hour = 12;
  private focusX = 0;
  private focusZ = 0;
  // Uniform grids (rebuilt each frame, no allocation): people near the camera, and vehicles near the bubble.
  private grid = { cell: 2.5, size: 160, ox: 0, oz: 0, head: new Int32Array(160 * 160), next: new Int32Array(MAX_PEOPLE) };
  private vgrid = { cell: 24, size: 48, ox: 0, oz: 0, head: new Int32Array(48 * 48), next: new Int32Array(MAX_VEHICLES) };

  constructor(private city: City) {
    for (let i = MAX_PEOPLE - 1; i >= 0; i--) this.free.push(i);
  }

  /** Advances everyone by `dt` seconds of street time around `focus` (the camera's target). */
  update(dt: number, focus: { x: number; z: number }, camera: { x: number; z: number }, camDist: number, hour: number): void {
    this.hour = hour;
    this.focusX = focus.x;
    this.focusZ = focus.z;
    // Too far out to see anyone: everybody waits where they are.
    if (camDist > 560 || dt <= 0) return;
    this.city.walk.ensure();
    this.routeBudget = 8;
    this.refreshBubble(dt);
    this.buildVehicleGrid();
    this.buildGrid(camera);
    this.busTimer -= dt;
    if (this.busTimer <= 0) {
      this.busTimer = 0.25;
      this.updateBuses();
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.2;
      this.spawn();
    }
    for (let i = 0; i < MAX_PEOPLE; i++) {
      if (!this.active[i]) continue;
      this.step(i, dt, camera);
    }
  }

  // ── Who's around ──────────────────────────────────────────────────────────

  private refreshBubble(dt: number): void {
    const a = this.bubbleAt;
    a.t -= dt;
    if (a.t > 0 && Math.hypot(this.focusX - a.x, this.focusZ - a.z) < 40) return;
    a.t = 1.5;
    a.x = this.focusX;
    a.z = this.focusZ;
    const city = this.city;
    const bb = this.bubble;
    bb.ids.clear();
    bb.homes.length = bb.shops.length = bb.works.length = bb.parks.length = bb.stops.length = 0;
    bb.weight = 0;
    for (const b of city.buildings.queryRadius(a.x, a.z, BUBBLE)) {
      if (!b || b.state !== BuildingState.Active || !b.segId) continue;
      if ((b.cx - a.x) ** 2 + (b.cz - a.z) ** 2 > BUBBLE * BUBBLE) continue;
      bb.ids.add(b.id);
      if (b.kind === 'zoned') {
        if (isResidential(b.zone)) {
          bb.homes.push(b);
          bb.weight += b.residents;
        } else {
          if (b.jobs > 0) bb.works.push(b);
          bb.weight += b.workers * 1.2;
          if (zoneBase(b.zone) === Zone.Commercial) bb.shops.push(b);
        }
      } else {
        const st = SERVICE_BY_ID.get(b.typeId);
        if (st?.kind === 'park' || st?.kind === 'landmark') {
          bb.parks.push(b);
          bb.weight += 20;
        }
        if (b.workers > 0) bb.works.push(b);
        bb.weight += b.workers;
      }
    }
    const transit = city.transit;
    const served = new Set<number>();
    for (const l of transit.lines.values()) if (!l.problem) for (const s of l.stops) served.add(s);
    for (const st of transit.stops.values()) {
      if (!served.has(st.id) || (st.x - a.x) ** 2 + (st.z - a.z) ** 2 > BUBBLE * BUBBLE) continue;
      const loc = city.walk.locate(st.segId, st.side, st.s);
      if (loc) bb.stops.push({ id: st.id, x: st.x, z: st.z, loc, waiting: st.waiting });
    }
    // Schools and parks anywhere in the city (children walk a long way to school).
    if (this.services.version !== city.coverage.version) {
      this.services.version = city.coverage.version;
      this.services.schools = [];
      this.services.parks = [];
      for (const b of city.buildings.all.values()) {
        if (b.kind !== 'service' || b.state !== BuildingState.Active || !b.segId) continue;
        const st = SERVICE_BY_ID.get(b.typeId);
        if (b.typeId === 'elementary_school' || b.typeId === 'high_school') this.services.schools.push(b);
        else if (st?.kind === 'park') this.services.parks.push(b);
      }
    }
  }

  private target(): number {
    const bb = this.bubble;
    const tod = 0.22 + 0.78 * timeOfDayFactor(this.hour);
    return Math.min(MAX_PEOPLE - 40, Math.round((bb.weight * 0.045 + bb.ids.size * 0.3) * tod * this.density));
  }

  // ── Spawning ──────────────────────────────────────────────────────────────

  private spawn(): void {
    const target = this.target();
    const deficit = target - this.count;
    // Streets fill quickly when the camera arrives somewhere new: those people are already on their way.
    const prefill = this.count < target * 0.6;
    if (prefill) this.routeBudget = 20;
    let n = Math.min(deficit, prefill ? 24 : 6);
    let tries = n * 3;
    while (n > 0 && tries-- > 0 && this.free.length > 4 && this.routeBudget > 0) {
      if (this.trySpawn(prefill)) n--;
    }
    this.fillStops();
  }

  /** Picks a household (and one of its people) matching a condition, by sampling. */
  private sampleHousehold(pred: (h: number) => boolean, tries = 260): number {
    const pop = this.city.population;
    if (!pop.count) return -1;
    for (let t = 0; t < tries; t++) {
      const h = Math.floor(this.rng.next() * pop.count);
      if (pop.alive[h] && pred(h)) return h;
    }
    return -1;
  }

  private trySpawn(prefill: boolean): boolean {
    const h = this.hour;
    const day = h > 6.5 && h < 20.5;
    const w = [
      /* out to work */ gauss(h, 7.9, 1.1) * 1.1,
      /* home from work */ gauss(h, 17.6, 1.3) * 1.1,
      /* school */ day ? gauss(h, 8.0, 0.6) * 0.5 + gauss(h, 15.4, 0.7) * 0.45 : 0,
      /* shops */ (day ? 0.3 + gauss(h, 12, 3) * 0.8 : 0.06) + gauss(h, 18.6, 1.4) * 0.4,
      /* park */ day ? gauss(h, 15, 3.4) * 0.65 : 0,
      /* stroll */ 0.12 + gauss(h, 19.6, 1.6) * 0.45,
      /* lunch */ gauss(h, 12.6, 0.7) * 0.5,
      /* night: heading home */ h < 5 || h > 22 ? 0.5 : 0.05,
    ];
    let sum = 0;
    for (const v of w) sum += v;
    let r = this.rng.next() * sum;
    let kind = 0;
    while (kind < w.length - 1 && r > w[kind]) r -= w[kind++];
    switch (kind) {
      case 0: return this.spawnCommute(prefill, false);
      case 1: return this.spawnCommute(prefill, true);
      case 2: return this.spawnSchool(prefill, h > 12);
      case 3: return this.spawnVisit(prefill, Errand.Shop);
      case 4: return this.spawnVisit(prefill, Errand.Park);
      case 5: return this.spawnStroll(prefill);
      case 6: return this.spawnLunch(prefill);
      default: return this.spawnVisit(prefill, Errand.Shop, true);
    }
  }

  private spawnCommute(prefill: boolean, home: boolean): boolean {
    const city = this.city, pop = city.population, ids = this.bubble.ids;
    const worksHere = (x: number) => (pop.job[x * 2] > 0 && ids.has(pop.job[x * 2])) || (pop.job[x * 2 + 1] > 0 && ids.has(pop.job[x * 2 + 1]));
    // Commuters who live or work around here (those from further away appear on their way).
    const hh = this.sampleHousehold((x) => (pop.job[x * 2] > 0 || pop.job[x * 2 + 1] > 0) && (worksHere(x) || (!home && ids.has(pop.home[x]))));
    if (hh < 0) return false;
    const k = pop.job[hh * 2] && (ids.has(pop.job[hh * 2]) || !pop.job[hh * 2 + 1]) ? 0 : 1;
    const homeB = city.buildings.get(pop.home[hh]);
    const work = city.buildings.get(pop.job[hh * 2 + k]);
    if (!homeB || !work) return false;
    const [from, to] = home ? [work, homeB] : [homeB, work];
    // As often as the simulation has them walking (once it knows).
    const ws = city.mobility.walkShare(hh, k);
    const path = ws === null || this.rng.next() < ws ? this.pathBetween(from, to, MAX_WALK) : null;
    if (path) return this.launch(path, hh, k, home ? Errand.Home : Errand.Work, from.id, to.id, prefill);
    // Too far to walk: commuters who take the bus walk to a stop near home.
    if (!home && this.rng.next() > city.transit.carShare(hh, k)) {
      const stop = this.nearestStop(homeB.cx, homeB.cz, 420);
      if (stop) {
        const p = this.pathTo(homeB, stop.loc, 8 * 60);
        if (p) return this.launch(p, hh, k, Errand.Bus, homeB.id, stop.id, prefill);
      }
    }
    return false;
  }

  private spawnSchool(prefill: boolean, homeward: boolean): boolean {
    const city = this.city, pop = city.population, ids = this.bubble.ids;
    const hh = this.sampleHousehold((x) => ids.has(pop.home[x]) && pop.size[x] > adultsIn(pop, x));
    if (hh < 0) return false;
    const homeB = city.buildings.get(pop.home[hh]);
    if (!homeB) return false;
    const kids: number[] = [];
    for (let k = adultsIn(pop, hh); k < pop.size[hh]; k++) if (citizenOf(pop, hh, k).role === 'pupil') kids.push(k);
    if (!kids.length) return false;
    // Younger children go to the primary school, older ones to the high school (whichever is near).
    const age = citizenOf(pop, hh, kids[0]).age;
    // (Without one in walking distance, they go some other way.)
    const school = nearest(this.services.schools.filter((b) => (b.typeId === 'elementary_school') === age < 12), homeB.cx, homeB.cz, 1600);
    if (!school) return false;
    const [from, to] = homeward ? [school, homeB] : [homeB, school];
    const path = this.pathBetween(from, to, MAX_WALK);
    if (!path) return false;
    const young = age < 11;
    // Young children go with a grown-up; older ones walk by themselves or together.
    const leadK = young ? 0 : kids[0];
    const i = this.launchIndex(path, hh, leadK, homeward ? Errand.Home : Errand.School, from.id, to.id, prefill);
    if (i < 0) return false;
    for (const k of (young ? kids : kids.slice(1)).slice(0, 2)) this.addFollower(i, hh, k);
    return true;
  }

  /** Shopping or a park visit (or, `homeward`, on the way back from one). */
  private spawnVisit(prefill: boolean, errand: Errand.Shop | Errand.Park, homeward = this.rng.next() < 0.45): boolean {
    const city = this.city, pop = city.population, ids = this.bubble.ids;
    const pool = errand === Errand.Shop ? this.bubble.shops : this.bubble.parks.length ? this.bubble.parks : this.services.parks;
    if (!pool.length) return false;
    const hh = this.sampleHousehold((x) => ids.has(pop.home[x]));
    if (hh < 0) return false;
    const homeB = city.buildings.get(pop.home[hh]);
    if (!homeB) return false;
    const place = nearestOf(pool, homeB.cx, homeB.cz, errand === Errand.Shop ? 3 : 2, this.rng, 1100);
    if (!place) return false;
    const adults = adultsIn(pop, hh);
    // Daytime shoppers are mostly the people at home in the day.
    let k = Math.floor(this.rng.next() * adults);
    if (this.hour > 9 && this.hour < 16 && adults > pop.workers[hh]) k = Math.min(adults - 1, pop.workers[hh]);
    const [from, to] = homeward ? [place, homeB] : [homeB, place];
    const path = this.pathBetween(from, to, 15 * 60, !homeward && errand === Errand.Park);
    if (!path) return false;
    const i = this.launchIndex(path, hh, k, homeward ? Errand.Home : errand, from.id, to.id, prefill, errand === Errand.Shop);
    if (i < 0) return false;
    // Families go to the park together; some couples shop together.
    if (errand === Errand.Park && pop.size[hh] > adults && this.rng.next() < 0.6) this.addFollower(i, hh, adults);
    else if (adults >= 2 && this.rng.next() < 0.22) this.addFollower(i, hh, k === 0 ? 1 : 0);
    return true;
  }

  private spawnStroll(prefill: boolean): boolean {
    const city = this.city, pop = city.population, ids = this.bubble.ids;
    const hh = this.sampleHousehold((x) => ids.has(pop.home[x]));
    if (hh < 0) return false;
    const homeB = city.buildings.get(pop.home[hh]);
    const all = this.bubble.homes;
    if (!homeB || !all.length) return false;
    // Round the block: out to a street a few minutes away, then home.
    const far = all[Math.floor(this.rng.next() * all.length)];
    const d = Math.hypot(far.cx - homeB.cx, far.cz - homeB.cz);
    if (d < 90 || d > 420) return false;
    const loc = this.city.walk.locationOf(far);
    if (!loc) return false;
    const path = this.pathTo(homeB, loc, 10 * 60);
    if (!path) return false;
    const i = this.launchIndex(path, hh, Math.floor(this.rng.next() * adultsIn(pop, hh)), Errand.Stroll, homeB.id, homeB.id, prefill, true);
    if (i < 0) return false;
    if (adultsIn(pop, hh) >= 2 && this.rng.next() < 0.35) this.addFollower(i, hh, this.member[i] === 0 ? 1 : 0);
    return true;
  }

  private spawnLunch(prefill: boolean): boolean {
    const city = this.city, pop = city.population, ids = this.bubble.ids;
    const hh = this.sampleHousehold((x) => (pop.job[x * 2] > 0 && ids.has(pop.job[x * 2])) || (pop.job[x * 2 + 1] > 0 && ids.has(pop.job[x * 2 + 1])));
    if (hh < 0) return false;
    const k = pop.job[hh * 2] && ids.has(pop.job[hh * 2]) ? 0 : 1;
    const work = city.buildings.get(pop.job[hh * 2 + k]);
    if (!work) return false;
    const shop = nearestOf(this.bubble.shops, work.cx, work.cz, 3, this.rng, 500);
    if (!shop || shop.id === work.id) return false;
    const path = this.pathBetween(work, shop, 7 * 60);
    if (!path) return false;
    return this.launch(path, hh, k, Errand.Lunch, work.id, shop.id, prefill);
  }

  /** Keeps a few people waiting at bus stops near the camera (as many as the stop's ridership suggests). */
  private fillStops(): void {
    const busy = 0.3 + 0.7 * timeOfDayFactor(this.hour);
    const pop = this.city.population;
    for (const st of this.bubble.stops) {
      const want = Math.min(7, Math.round(Math.min(st.waiting, 12) * busy * 0.6));
      let have = 0;
      for (let i = 0; i < MAX_PEOPLE; i++) if (this.active[i] && this.errand[i] === Errand.Bus && this.dest[i] === st.id) have++;
      for (let k = have; k < want && this.free.length > 4; k++) {
        const hh = this.sampleHousehold((x) => this.bubble.ids.has(pop.home[x]), 80);
        if (hh < 0) return;
        const i = this.alloc(hh, Math.floor(this.rng.next() * adultsIn(pop, hh)), Errand.Bus, pop.home[hh], st.id);
        const p = this.city.walk.pointOf(st.loc);
        const along = this.rng.range(-3, 3);
        this.x[i] = this.tx[i] = p.x + p.tx * along;
        this.z[i] = this.tz[i] = p.z + p.tz * along;
        this.y[i] = this.city.terrain.roadHeightAt(this.x[i], this.z[i]) + SIDEWALK_Y;
        this.heading[i] = Math.atan2(st.z - this.z[i], st.x - this.x[i]) + this.rng.range(-0.6, 0.6);
        this.face[i] = this.heading[i];
        this.state[i] = PedState.Stop;
        this.scale[i] = 1;
      }
    }
  }

  // ── Paths ─────────────────────────────────────────────────────────────────

  /** Door to door between two buildings, if it's walkable within `maxTime` seconds. */
  private pathBetween(from: Building, to: Building, maxTime: number, grounds = false): Path | null {
    const walk = this.city.walk;
    const a = walk.locationOf(from), b = walk.locationOf(to);
    if (!a || !b || this.routeBudget <= 0) return null;
    this.routeBudget--;
    const r = walk.route(a, b);
    if (!r || r.time > maxTime) return null;
    const start = doorOf(from, this.rng.range(-2, 2));
    this.builder.reset(start.x, start.z);
    this.trace(r, SEG.door, to.id);
    const end = doorOf(to, this.rng.range(-2, 2));
    this.builder.to(end.x, end.z, SEG.door, 0.3);
    // Into the park: somewhere on the grass to spend a while.
    if (grounds) {
      const g = { x: 0, z: 0 };
      localToWorld(to, this.rng.range(-0.65, 0.65) * to.hw, this.rng.range(-0.5, 0.65) * to.hd, g);
      this.builder.to(g.x, g.z, SEG.grounds, 0.6);
    }
    return this.done();
  }

  /** From a building's door to a sidewalk location (a bus stop, a street corner). */
  private pathTo(from: Building, loc: WalkLocation, maxTime: number): Path | null {
    const walk = this.city.walk;
    const a = walk.locationOf(from);
    if (!a || this.routeBudget <= 0) return null;
    this.routeBudget--;
    const r = walk.route(a, loc);
    if (!r || r.time > maxTime) return null;
    const start = doorOf(from, this.rng.range(-2, 2));
    this.builder.reset(start.x, start.z);
    this.trace(r, SEG.door, -1);
    return this.done();
  }

  /** From where someone stands to a building's door. */
  private pathFrom(x: number, z: number, fromLoc: WalkLocation, to: Building, maxTime: number, startGrounds = false, exitDoor?: { x: number; z: number }): Path | null {
    const walk = this.city.walk;
    const b = walk.locationOf(to);
    if (!b || this.routeBudget <= 0) return null;
    this.routeBudget--;
    const r = walk.route(fromLoc, b);
    if (!r || r.time > maxTime) return null;
    this.builder.reset(x, z);
    if (startGrounds && exitDoor) this.builder.to(exitDoor.x, exitDoor.z, SEG.grounds, 0.6);
    this.trace(r, startGrounds ? SEG.door : SEG.walk, to.id);
    const end = doorOf(to, this.rng.range(-2, 2));
    this.builder.to(end.x, end.z, SEG.door, 0.3);
    return this.done();
  }

  private done(): Path | null {
    const p = this.builder.finish();
    return p.n >= 2 ? p : null;
  }

  /** Appends a walking route to the path builder, joining it from the builder's last point with a `join` piece. */
  private trace(r: WalkRoute, join: number, destId: number): void {
    const walk = this.city.walk;
    const b = this.builder;
    const first = r.steps[0];
    if (first) {
      const p0 = walk.pointOnEdge(first.edge, first.from);
      b.to(p0.x, p0.z, join, join === SEG.walk ? 0.4 : 0.3);
    }
    let windows = 2;
    for (const st of r.steps) {
      const e = st.edge;
      const k = walk.kind[e] as WalkEdge;
      if (k === WalkEdge.Sidewalk) {
        const road = this.city.roads.segments.get(walk.seg[e]);
        const rt = ROAD_TYPES[road?.type ?? 'street'];
        const room = Math.max(0.3, (rt.sidewalk - 0.25) / 2 - 0.25);
        const len = Math.abs(st.to - st.from);
        // A shop window worth stopping at along this stretch?
        let shopAt = -1, shopFace = 0;
        if (windows > 0 && len > 6 && this.rng.next() < 0.5) {
          for (const sb of this.city.buildings.onSegment(walk.seg[e])) {
            if (sb.id === destId || sb.side !== walk.side[e] || sb.kind !== 'zoned' || zoneBase(sb.zone) !== Zone.Commercial) continue;
            const t = sb.segS - walk.s0[e];
            if (t <= Math.min(st.from, st.to) + 1 || t >= Math.max(st.from, st.to) - 1) continue;
            if (this.rng.next() < 0.35) {
              shopAt = t;
              const q = walk.pointOnEdge(e, t);
              shopFace = Math.atan2(sb.cz - q.z, sb.cx - q.x);
              break;
            }
          }
        }
        const n = Math.max(1, Math.ceil(len / 5));
        let prev = st.from;
        for (let j = 1; j <= n; j++) {
          const t = st.from + ((st.to - st.from) * j) / n;
          if (shopAt >= 0 && (shopAt - prev) * (shopAt - t) < 0) {
            const q = walk.pointOnEdge(e, shopAt);
            b.to(q.x, q.z, SEG.walk, room);
            b.pauses.push(b.last, this.rng.range(2.5, 6.5), shopFace);
            windows--;
            shopAt = -1;
          }
          const q = walk.pointOnEdge(e, t);
          b.to(q.x, q.z, SEG.walk, room);
          prev = t;
        }
      } else {
        const kind = k === WalkEdge.Signal ? SEG.signal : k === WalkEdge.Zebra ? SEG.zebra : k === WalkEdge.Informal ? SEG.informal : SEG.walk;
        const room = kind === SEG.walk ? 0.45 : kind === SEG.informal ? 0.5 : 1.2;
        const s = walk.ptStart[e], c = walk.ptCount[e];
        const rev = st.from > st.to;
        for (let j = 0; j < c; j++) {
          const q = rev ? s + c - 1 - j : s + j;
          b.to(walk.pts[q * 2], walk.pts[q * 2 + 1], kind, room, walk.node[e], walk.seg[e]);
        }
      }
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  private alloc(hh: number, k: number, errand: Errand, origin: number, dest: number): number {
    const i = this.free.pop()!;
    const pop = this.city.population;
    const c = citizenOf(pop, hh, k);
    this.active[i] = 1;
    this.serial[i]++;
    this.count++;
    this.stats.spawned++;
    this.errand[i] = errand;
    this.household[i] = hh;
    this.member[i] = k;
    this.moveIn[i] = pop.moveInTick[hh];
    this.age[i] = c.age;
    this.look[i] = lookOf(pop, hh, k);
    this.height[i] = bodySize(c.age, this.look[i]).h;
    this.origin[i] = origin;
    this.dest[i] = dest;
    this.leader[i] = -1;
    this.followers[i * 2] = this.followers[i * 2 + 1] = -1;
    this.paths[i] = null;
    this.seg[i] = 0;
    this.u[i] = 0;
    this.timer[i] = 0;
    this.waited[i] = 0;
    this.chatCool[i] = this.rng.range(5, 40);
    this.nextPause[i] = 0;
    this.speed[i] = 0;
    this.stride[i] = this.rng.next() * 6.28;
    // Walking pace: children skip along, older people take their time, commuters hurry at rush hour.
    const a = c.age;
    let pace = a < 13 ? this.rng.range(1.15, 1.5) : a > 68 ? this.rng.range(0.85, 1.15) : this.rng.range(1.22, 1.58);
    if ((errand === Errand.Work || errand === Errand.Bus) && ((this.hour > 6.5 && this.hour < 9.5) || (this.hour > 16.5 && this.hour < 19))) pace *= 1.1;
    if (errand === Errand.Stroll || errand === Errand.Park) pace *= 0.88;
    this.pace[i] = pace;
    this.latPref[i] = this.rng.range(0.1, 0.55);
    this.lat[i] = this.latGoal[i] = this.latPref[i];
    this.back[i] = 0;
    this.scale[i] = 0;
    this.fadeIn[i] = 1;
    return i;
  }

  private launch(path: Path, hh: number, k: number, errand: Errand, origin: number, dest: number, prefill: boolean): boolean {
    return this.launchIndex(path, hh, k, errand, origin, dest, prefill) >= 0;
  }

  private launchIndex(path: Path, hh: number, k: number, errand: Errand, origin: number, dest: number, prefill: boolean, browsing = false): number {
    if (this.free.length < 4) return -1;
    // Where they start: at the door, or (already on their way) somewhere along the route in view.
    let start = { seg: 0, u: 0 };
    if (prefill && path.n > 3) {
      const at = this.prefillStart(path);
      if (!at) return -1;
      start = at;
    } else if ((path.pts[0] - this.focusX) ** 2 + (path.pts[1] - this.focusZ) ** 2 > BUBBLE * BUBBLE) {
      return -1;
    }
    const i = this.alloc(hh, k, errand, origin, dest);
    if (!browsing) path.pauses.length = 0;
    this.paths[i] = path;
    this.state[i] = PedState.Walk;
    if (start.seg > 0 || start.u > 0) {
      this.seg[i] = start.seg;
      this.u[i] = start.u;
      this.scale[i] = 1;
      this.fadeIn[i] = 0;
      while (this.nextPause[i] < path.pauses.length && path.pauses[this.nextPause[i]] <= this.seg[i]) this.nextPause[i] += 3;
    }
    const p = this.positionOn(i);
    this.x[i] = this.tx[i] = p.x;
    this.z[i] = this.tz[i] = p.z;
    this.heading[i] = p.h;
    this.y[i] = p.y;
    return i;
  }

  /** A random spot along a path (past the door, before the end) inside the area around the camera. */
  private prefillStart(path: Path): { seg: number; u: number } | null {
    for (let attempt = 0; attempt < 6; attempt++) {
      let target = path.length * this.rng.range(0.05, 0.9);
      let s = 0;
      for (; s < path.n - 2; s++) {
        const l = segLen(path, s);
        if (target < l && path.kind[s] !== SEG.door) break;
        target -= Math.min(target, l);
      }
      s = Math.min(s, path.n - 2);
      const l = segLen(path, s) || 1;
      const u = Math.min(target, l);
      const x = path.pts[s * 2] + ((path.pts[s * 2 + 2] - path.pts[s * 2]) * u) / l;
      const z = path.pts[s * 2 + 1] + ((path.pts[s * 2 + 3] - path.pts[s * 2 + 1]) * u) / l;
      if ((x - this.focusX) ** 2 + (z - this.focusZ) ** 2 < BUBBLE * BUBBLE) return { seg: s, u };
    }
    return null;
  }

  /** Adds household member `k` walking alongside person `i`. */
  private addFollower(i: number, hh: number, k: number): void {
    if (k >= this.city.population.size[hh] || k === this.member[i] || this.free.length < 4) return;
    const slot = this.followers[i * 2] < 0 ? 0 : this.followers[i * 2 + 1] < 0 ? 1 : -1;
    if (slot < 0) return;
    const f = this.alloc(hh, k, this.errand[i], this.origin[i], this.dest[i]);
    this.state[f] = PedState.Follow;
    this.leader[f] = i;
    this.followers[i * 2 + slot] = f;
    this.side[f] = slot === 0 ? -0.75 : -1.45;
    // The group goes at the pace of its slowest member.
    this.pace[i] = Math.min(this.pace[i], this.pace[f] * 1.02);
    this.scale[f] = this.scale[i];
    this.fadeIn[f] = this.fadeIn[i];
    this.x[f] = this.x[i];
    this.z[f] = this.z[i];
    this.y[f] = this.y[i];
    this.heading[f] = this.heading[i];
  }

  private release(i: number, how: PedExit['how']): void {
    if (!this.active[i]) return;
    for (let s = 0; s < 2; s++) {
      const f = this.followers[i * 2 + s];
      if (f >= 0 && this.leader[f] === i) this.release(f, how);
      this.followers[i * 2 + s] = -1;
    }
    this.exits.push({ serial: this.serial[i], building: how === 'away' ? 0 : this.dest[i], how });
    if (this.exits.length > 48) this.exits.shift();
    this.active[i] = 0;
    this.state[i] = PedState.Free;
    this.paths[i] = null;
    this.leader[i] = -1;
    this.count--;
    if (this.watched === i) this.watched = -1;
    this.free.push(i);
  }

  /** Everyone leaves (the city changed). */
  clear(): void {
    for (let i = 0; i < MAX_PEOPLE; i++) if (this.active[i]) this.release(i, 'away');
  }

  // ── Movement ──────────────────────────────────────────────────────────────

  private pos = { x: 0, z: 0, y: 0, h: 0, dx: 1, dz: 0 };

  /** Where person `i` stands on their path (before smoothing), with the path's direction there. */
  private positionOn(i: number): { x: number; z: number; y: number; h: number; dx: number; dz: number } {
    const p = this.paths[i]!;
    const s = Math.min(this.seg[i], p.n - 2);
    const ax = p.pts[s * 2], az = p.pts[s * 2 + 1];
    const bx = p.pts[s * 2 + 2], bz = p.pts[s * 2 + 3];
    let dx = bx - ax, dz = bz - az;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const u = Math.min(this.u[i], l) - this.back[i];
    const lat = Math.max(-p.room[s], Math.min(p.room[s], this.lat[i]));
    const o = this.pos;
    o.x = ax + dx * u - dz * lat;
    o.z = az + dz * u + dx * lat;
    o.dx = dx;
    o.dz = dz;
    o.h = Math.atan2(dz, dx);
    o.y = this.heightOn(p, s, u / l, o.x, o.z);
    return o;
  }

  /** Feet height: sidewalk top on pavements, road surface on crossings (stepping off the kerb), ground in lots. */
  private heightOn(p: Path, s: number, f: number, x: number, z: number): number {
    const t = this.city.terrain;
    const k = p.kind[s];
    if (k === SEG.walk) return t.roadHeightAt(x, z) + SIDEWALK_Y;
    if (k === SEG.grounds) return t.heightAt(x, z);
    if (k === SEG.door) {
      // Between the pavement and the lot: which end is the door?
      const toDoor = s === p.n - 2 || (s + 1 < p.n - 1 && p.kind[s + 1] === SEG.grounds);
      const pave = t.roadHeightAt(x, z) + SIDEWALK_Y;
      const lot = t.heightAt(x, z);
      const g = toDoor ? f : 1 - f;
      return pave + (Math.max(lot, pave - 0.4) - pave) * smooth(g);
    }
    // Crossings: down off the kerb at the start, up at the end (if the next piece is pavement).
    const l = segLen(p, s);
    const d = f * l;
    const kerbIn = s > 0 && p.kind[s - 1] === SEG.walk ? smooth(1 - Math.min(1, d / 0.5)) : 0;
    const kerbOut = s + 1 < p.n - 1 && p.kind[s + 1] === SEG.walk ? smooth(1 - Math.min(1, (l - d) / 0.5)) : 0;
    return t.roadHeightAt(x, z) + ROAD_Y + (SIDEWALK_Y - ROAD_Y) * Math.max(kerbIn, kerbOut);
  }

  private step(i: number, dt: number, camera: { x: number; z: number }): void {
    if (this.fadeIn[i]) {
      this.scale[i] = Math.min(1, this.scale[i] + dt * 2.5);
      if (this.scale[i] >= 1) this.fadeIn[i] = 0;
    }
    const st = this.state[i] as PedState;
    if (st === PedState.Follow) {
      this.stepFollower(i, dt);
      return;
    }
    // Out of sight and out of the neighbourhood: gone (unless the player is watching).
    if (i !== this.watched && (this.x[i] - this.focusX) ** 2 + (this.z[i] - this.focusZ) ** 2 > DESPAWN * DESPAWN) {
      this.release(i, 'away');
      return;
    }
    switch (st) {
      case PedState.Walk:
        this.stepWalk(i, dt, camera);
        break;
      case PedState.WaitCross:
        this.stepWaitCross(i, dt);
        break;
      case PedState.Pause:
        this.speed[i] = Math.max(0, this.speed[i] - dt * 3);
        this.turnTo(i, this.face[i], dt);
        this.timer[i] -= dt;
        if (this.timer[i] <= 0) this.state[i] = PedState.Walk;
        break;
      case PedState.Inside:
        this.speed[i] = Math.max(0, this.speed[i] - dt * 2);
        this.scale[i] -= dt * 2.4;
        if (this.scale[i] <= 0) {
          if (this.errand[i] === Errand.Bus) this.stats.boarded++;
          else this.stats.arrived++;
          this.release(i, this.errand[i] === Errand.Bus ? 'bus' : 'inside');
        }
        break;
      case PedState.Stop:
        this.speed[i] = Math.max(0, this.speed[i] - dt * 3);
        this.turnTo(i, this.face[i], dt);
        break;
      case PedState.Linger:
        this.stepLinger(i, dt);
        break;
    }
    this.stride[i] += (this.speed[i] * dt * 4.4) / this.height[i];
    this.chatCool[i] -= dt;
  }

  private stepWalk(i: number, dt: number, camera: { x: number; z: number }): void {
    const p = this.paths[i]!;
    let want = this.pace[i];
    const near = (this.x[i] - camera.x) ** 2 + (this.z[i] - camera.z) ** 2 < NEAR * NEAR;
    if (near) want = this.avoid(i, want);
    else this.latGoal[i] += (this.latPref[i] - this.latGoal[i]) * Math.min(1, dt);
    // Hurry across while the hand flashes.
    if (p.kind[this.seg[i]] === SEG.signal && this.city.signals.walkLight(p.node[this.seg[i]], p.seg[this.seg[i]]) !== WalkLight.Walk) want *= 1.25;
    this.speed[i] += Math.max(-3 * dt, Math.min(1.6 * dt, want - this.speed[i]));
    const room = p.room[Math.min(this.seg[i], p.n - 2)];
    const lg = Math.max(-room, Math.min(room, this.latGoal[i]));
    this.lat[i] += Math.max(-0.9 * dt, Math.min(0.9 * dt, lg - this.lat[i]));
    this.back[i] = Math.max(0, this.back[i] - dt * 0.8);
    this.u[i] += this.speed[i] * dt;
    for (let guard = 0; guard < 8; guard++) {
      const l = segLen(p, this.seg[i]);
      if (this.u[i] < l) break;
      const next = this.seg[i] + 1;
      // A stop here (a shop window)?
      const np = this.nextPause[i];
      if (np < p.pauses.length && p.pauses[np] <= next) {
        this.nextPause[i] += 3;
        if (p.pauses[np] === next) {
          this.u[i] = l;
          this.state[i] = PedState.Pause;
          this.pauseWhy[i] = PauseWhy.Window;
          this.timer[i] = p.pauses[np + 1];
          this.face[i] = p.pauses[np + 2];
          break;
        }
      }
      if (next >= p.n - 1) {
        this.u[i] = l;
        this.arrive(i);
        return;
      }
      const k = p.kind[next];
      if ((k === SEG.signal || k === SEG.zebra || k === SEG.informal) && !this.mayCross(i, p, next)) {
        this.u[i] = l;
        this.state[i] = PedState.WaitCross;
        this.waited[i] = 0;
        // Spread out along the kerb rather than stacking up on one spot.
        this.back[i] = this.rng.range(0.1, 1.1);
        this.latGoal[i] = this.rng.range(-0.9, 0.9);
        this.speed[i] = Math.min(this.speed[i], 0.6);
        break;
      }
      if (k === SEG.signal || k === SEG.zebra || k === SEG.informal) {
        this.stats.crossings++;
        if (k === SEG.signal && this.city.signals.walkLight(p.node[next], p.seg[next]) !== WalkLight.Walk) this.stats.redLight++;
      }
      this.u[i] -= l;
      this.seg[i] = next;
    }
    this.place(i, dt);
  }

  /** Moves the smoothed position toward the path position and turns toward the way of travel. */
  private place(i: number, dt: number): void {
    const o = this.positionOn(i);
    const f = Math.min(1, dt * 9);
    this.x[i] += (o.x - this.x[i]) * f;
    this.z[i] += (o.z - this.z[i]) * f;
    this.y[i] = o.y;
    this.tx[i] = o.dx;
    this.tz[i] = o.dz;
    if (this.speed[i] > 0.15) this.turnTo(i, o.h, dt);
  }

  private turnTo(i: number, h: number, dt: number): void {
    let d = h - this.heading[i];
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const m = TURN_RATE * dt;
    this.heading[i] += Math.max(-m, Math.min(m, d));
  }

  private stepWaitCross(i: number, dt: number): void {
    const p = this.paths[i]!;
    this.waited[i] += dt;
    this.speed[i] = Math.max(0, this.speed[i] - dt * 3);
    const room = p.room[this.seg[i]];
    this.lat[i] += Math.max(-0.8 * dt, Math.min(0.8 * dt, Math.max(-room, Math.min(room, this.latGoal[i])) - this.lat[i]));
    const next = this.seg[i] + 1;
    // Face across the road while waiting.
    const nx = p.pts[next * 2 + 2] - p.pts[next * 2], nz = p.pts[next * 2 + 3] - p.pts[next * 2 + 1];
    this.turnTo(i, Math.atan2(nz, nx), dt);
    const o = this.positionOn(i);
    this.x[i] += (o.x - this.x[i]) * Math.min(1, dt * 6);
    this.z[i] += (o.z - this.z[i]) * Math.min(1, dt * 6);
    this.y[i] = o.y;
    this.timer[i] -= dt;
    if (this.timer[i] > 0) return;
    this.timer[i] = 0.15 + this.rng.next() * 0.25;
    if (this.mayCross(i, p, next)) {
      this.state[i] = PedState.Walk;
      this.stats.crossings++;
      if (p.kind[next] === SEG.signal && this.city.signals.walkLight(p.node[next], p.seg[next]) !== WalkLight.Walk) this.stats.redLight++;
      this.u[i] -= segLen(p, this.seg[i]);
      this.seg[i] = next;
      this.latGoal[i] = this.latPref[i] * 1.5;
    }
  }

  /** Whether person `i` may step onto crossing segment `s` now. */
  private mayCross(i: number, p: Path, s: number): boolean {
    const k = p.kind[s];
    if (k === SEG.signal) return this.city.signals.walkLight(p.node[s], p.seg[s]) === WalkLight.Walk;
    // No lights: look both ways for a gap.
    const mx = (p.pts[s * 2] + p.pts[s * 2 + 2]) / 2, mz = (p.pts[s * 2 + 1] + p.pts[s * 2 + 3]) / 2;
    const impatient = this.waited[i] > 14;
    if (this.waited[i] > 40) {
      this.stats.forced++;
      return true;
    }
    return !this.trafficAt(mx, mz, k === SEG.zebra ? 22 : 32, impatient ? 1.6 : k === SEG.zebra ? 3.2 : 4.5);
  }

  /** Is a vehicle within `r` of a point, about to reach it in under `horizon` seconds (or standing on it)? */
  private trafficAt(x: number, z: number, r: number, horizon: number): boolean {
    const v = this.city.vehicles;
    const g = this.vgrid;
    const c0x = Math.floor((x - r - g.ox) / g.cell), c1x = Math.floor((x + r - g.ox) / g.cell);
    const c0z = Math.floor((z - r - g.oz) / g.cell), c1z = Math.floor((z + r - g.oz) / g.cell);
    for (let cz = Math.max(0, c0z); cz <= Math.min(g.size - 1, c1z); cz++) {
      for (let cx = Math.max(0, c0x); cx <= Math.min(g.size - 1, c1x); cx++) {
        for (let j = g.head[cz * g.size + cx]; j >= 0; j = g.next[j]) {
          const rx = x - v.x[j], rz = z - v.z[j];
          const d = Math.hypot(rx, rz);
          if (d > r) continue;
          if (d < 4.5) return true;
          const sp = v.speed[j];
          if (sp < 0.8) continue;
          // Heading toward the crossing?
          const along = (rx * Math.cos(v.heading[j]) + rz * Math.sin(v.heading[j])) / d;
          if (along > 0.55 && d / sp < horizon) return true;
        }
      }
    }
    return false;
  }

  /** Steering around others nearby: returns the speed to aim for and updates the lateral goal. */
  private avoid(i: number, want: number): number {
    const g = this.grid;
    const cx = Math.floor((this.x[i] - g.ox) / g.cell), cz = Math.floor((this.z[i] - g.oz) / g.cell);
    if (cx < 1 || cz < 1 || cx >= g.size - 1 || cz >= g.size - 1) return want;
    const dx = this.tx[i], dz = this.tz[i];
    let goal = this.latGoal[i];
    let blocked = false;
    for (let oz = -1; oz <= 1; oz++) {
      for (let ox = -1; ox <= 1; ox++) {
        for (let j = g.head[(cz + oz) * g.size + cx + ox]; j >= 0; j = g.next[j]) {
          if (j === i || this.leader[j] === i || this.leader[i] === j) continue;
          const rx = this.x[j] - this.x[i], rz = this.z[j] - this.z[i];
          const ahead = rx * dx + rz * dz;
          if (ahead < 0.15 || ahead > 2.2) continue;
          const side = rx * -dz + rz * dx;
          if (Math.abs(side) > 0.7) continue;
          const sj = this.state[j];
          const dot = Math.cos(this.heading[j]) * dx + Math.sin(this.heading[j]) * dz;
          if (sj === PedState.Walk && dot > 0.5) {
            // Someone slower ahead, going the same way: pass on their left, or fall in behind.
            if (this.speed[j] < want - 0.05) {
              goal = this.lat[i] + (side >= 0 ? -0.75 : 0.75);
              if (ahead < 0.9) want = Math.min(want, this.speed[j]);
            }
          } else if ((sj === PedState.Walk || sj === PedState.Follow) && dot < -0.5) {
            // Coming the other way: both keep right.
            goal = this.lat[i] + (side > 0.1 ? -0.5 : 0.5);
            // Sometimes neighbours stop for a word.
            if (ahead < 1.4 && this.chatCool[i] <= 0 && this.chatCool[j] <= 0 && sj === PedState.Walk && chatty(this.errand[i]) && chatty(this.errand[j]) && this.rng.next() < 0.05) {
              this.startChat(i, j);
              return 0;
            }
          } else {
            // Standing in the way: step around.
            goal = this.lat[i] + (side >= 0 ? -0.8 : 0.8);
            if (ahead < 0.8) blocked = true;
          }
        }
      }
    }
    this.latGoal[i] = goal + (this.latPref[i] - goal) * 0.02;
    return blocked ? Math.min(want, 0.35) : want;
  }

  private startChat(i: number, j: number): void {
    const t = this.rng.range(4, 10);
    for (const [a, b] of [[i, j], [j, i]]) {
      this.state[a] = PedState.Pause;
      this.pauseWhy[a] = PauseWhy.Chat;
      this.timer[a] = t;
      this.face[a] = Math.atan2(this.z[b] - this.z[a], this.x[b] - this.x[a]);
      this.chatCool[a] = 90;
    }
  }

  private stepFollower(f: number, dt: number): void {
    const l = this.leader[f];
    if (l < 0 || !this.active[l]) {
      this.release(f, 'away');
      return;
    }
    // Beside the leader (a little behind), turned the same way.
    const h = this.heading[l];
    const c = Math.cos(h), s = Math.sin(h);
    const side = this.side[f];
    const back = side < -1 ? 0.5 : 0.25;
    const tx = this.x[l] - s * side - c * back;
    const tz = this.z[l] + c * side - s * back;
    const k = Math.min(1, dt * 7);
    this.x[f] += (tx - this.x[f]) * k;
    this.z[f] += (tz - this.z[f]) * k;
    this.y[f] = this.y[l];
    this.speed[f] = this.speed[l];
    this.turnTo(f, this.state[l] === PedState.Pause && this.speed[l] < 0.2 ? this.face[l] : h, dt);
    this.stride[f] += (this.speed[f] * dt * 4.4) / this.height[f];
    if (!this.fadeIn[f]) this.scale[f] = this.scale[l];
  }

  private stepLinger(i: number, dt: number): void {
    this.speed[i] = Math.max(0, this.speed[i] - dt * 3);
    this.turnTo(i, this.face[i], dt);
    this.timer[i] -= dt;
    if (this.timer[i] > 0) return;
    // Time to go home: back out through the park's entrance.
    const pop = this.city.population;
    const hh = this.household[i];
    const park = this.city.buildings.get(this.dest[i]);
    const home = pop.alive[hh] && pop.moveInTick[hh] === this.moveIn[i] ? this.city.buildings.get(pop.home[hh]) : undefined;
    const loc = park ? this.city.walk.locationOf(park) : null;
    const path = park && home && loc ? this.pathFrom(this.x[i], this.z[i], loc, home, 20 * 60, true, doorOf(park)) : null;
    if (!path) {
      this.timer[i] = 3;
      if (this.routeBudget > 0) this.release(i, 'away');
      return;
    }
    this.paths[i] = path;
    this.seg[i] = 0;
    this.u[i] = 0;
    this.nextPause[i] = 0;
    path.pauses.length = 0;
    this.origin[i] = this.dest[i];
    this.dest[i] = home!.id;
    this.errand[i] = Errand.Home;
    this.state[i] = PedState.Walk;
  }

  private arrive(i: number): void {
    const e = this.errand[i] as Errand;
    const p = this.paths[i]!;
    if (e === Errand.Bus) {
      this.state[i] = PedState.Stop;
      const st = this.city.transit.stops.get(this.dest[i]);
      this.face[i] = st ? Math.atan2(st.z - this.z[i], st.x - this.x[i]) : this.heading[i];
      return;
    }
    if (e === Errand.Park && p.kind[p.n - 2] === SEG.grounds) {
      this.state[i] = PedState.Linger;
      this.timer[i] = this.rng.range(25, 75);
      this.face[i] = this.rng.range(-Math.PI, Math.PI);
      return;
    }
    if (e === Errand.Stroll) {
      // Turn for home.
      const pop = this.city.population;
      const hh = this.household[i];
      const home = this.city.buildings.get(pop.home[hh]);
      const here = this.city.walk.nearest(this.x[i], this.z[i], 20);
      const path = home && here ? this.pathFrom(this.x[i], this.z[i], here, home, 15 * 60) : null;
      if (path) {
        this.paths[i] = path;
        this.seg[i] = 0;
        this.u[i] = 0;
        this.nextPause[i] = 0;
        this.errand[i] = Errand.Home;
        this.dest[i] = home!.id;
        this.state[i] = PedState.Pause;
        this.pauseWhy[i] = PauseWhy.TurnBack;
        this.timer[i] = this.rng.range(0.8, 2.5);
        this.face[i] = this.heading[i] + Math.PI;
        return;
      }
    }
    this.state[i] = PedState.Inside;
    for (let s = 0; s < 2; s++) {
      const f = this.followers[i * 2 + s];
      if (f >= 0) this.scale[f] = Math.min(this.scale[f], 1);
    }
  }

  // ── Buses ─────────────────────────────────────────────────────────────────

  /** Buses standing at stops: waiting people board, and passengers step off. */
  private updateBuses(): void {
    const v = this.city.vehicles;
    const list = this.dwelling;
    list.length = 0;
    const r2 = (BUBBLE + 60) ** 2;
    for (let j = 0; j < v.max; j++) {
      if (!v.active[j] || v.purpose[j] !== Purpose.Transit || v.hold[j] <= 0 || v.speed[j] > 0.5) continue;
      if ((v.x[j] - this.focusX) ** 2 + (v.z[j] - this.focusZ) ** 2 > r2) continue;
      list.push({ x: v.x[j], z: v.z[j], i: j, serial: v.serial[j] });
    }
    if (!list.length) {
      this.dwellSeen.clear();
      return;
    }
    for (let i = 0; i < MAX_PEOPLE; i++) {
      if (!this.active[i] || this.state[i] !== PedState.Stop) continue;
      for (const b of list) {
        if ((b.x - this.x[i]) ** 2 + (b.z - this.z[i]) ** 2 < 18 * 18) {
          this.state[i] = PedState.Inside;
          this.face[i] = Math.atan2(b.z - this.z[i], b.x - this.x[i]);
          break;
        }
      }
    }
    // Newly arrived buses let a few people off.
    const seen = new Map<number, number>();
    for (const b of list) {
      seen.set(b.i, b.serial);
      if (this.dwellSeen.get(b.i) === b.serial) continue;
      const n = Math.floor(this.rng.next() * 3.2 * (0.3 + 0.7 * timeOfDayFactor(this.hour)));
      for (let k = 0; k < n; k++) this.alight(b.x, b.z);
    }
    this.dwellSeen = seen;
  }

  private alight(bx: number, bz: number): void {
    if (this.free.length < 8 || this.routeBudget <= 0) return;
    const city = this.city, pop = city.population;
    const here = city.walk.nearest(bx, bz, 25);
    if (!here) return;
    const near = (b: Building | undefined) => !!b && (b.cx - bx) ** 2 + (b.cz - bz) ** 2 < 480 * 480;
    // Home in the evening, to work in the morning.
    const toWork = this.hour > 5 && this.hour < 11;
    const hh = this.sampleHousehold((x) => (toWork ? near(city.buildings.get(pop.job[x * 2])) : this.bubble.ids.has(pop.home[x]) && near(city.buildings.get(pop.home[x]))), 200);
    if (hh < 0) return;
    const to = city.buildings.get(toWork ? pop.job[hh * 2] : pop.home[hh]);
    if (!to) return;
    const p0 = city.walk.pointOf(here);
    const path = this.pathFrom(p0.x, p0.z, here, to, 10 * 60);
    if (!path) return;
    const i = this.launchIndex(path, hh, 0, toWork ? Errand.Work : Errand.Home, 0, to.id, false);
    if (i < 0) return;
    this.stats.alighted++;
  }

  private nearestStop(x: number, z: number, r: number): Bubble['stops'][number] | null {
    let best: Bubble['stops'][number] | null = null;
    let bd = r * r;
    for (const st of this.bubble.stops) {
      const d = (st.x - x) ** 2 + (st.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = st;
      }
    }
    return best;
  }

  // ── Grids ─────────────────────────────────────────────────────────────────

  private buildGrid(camera: { x: number; z: number }): void {
    const g = this.grid;
    g.ox = camera.x - (g.size * g.cell) / 2;
    g.oz = camera.z - (g.size * g.cell) / 2;
    g.head.fill(-1);
    for (let i = 0; i < MAX_PEOPLE; i++) {
      if (!this.active[i]) continue;
      const cx = Math.floor((this.x[i] - g.ox) / g.cell), cz = Math.floor((this.z[i] - g.oz) / g.cell);
      if (cx < 0 || cz < 0 || cx >= g.size || cz >= g.size) continue;
      const c = cz * g.size + cx;
      g.next[i] = g.head[c];
      g.head[c] = i;
    }
  }

  private buildVehicleGrid(): void {
    const g = this.vgrid;
    const v = this.city.vehicles;
    g.ox = this.focusX - (g.size * g.cell) / 2;
    g.oz = this.focusZ - (g.size * g.cell) / 2;
    g.head.fill(-1);
    for (let j = 0; j < v.max; j++) {
      if (!v.active[j]) continue;
      const cx = Math.floor((v.x[j] - g.ox) / g.cell), cz = Math.floor((v.z[j] - g.oz) / g.cell);
      if (cx < 0 || cz < 0 || cx >= g.size || cz >= g.size) continue;
      const c = cz * g.size + cx;
      g.next[j] = g.head[c];
      g.head[c] = j;
    }
  }

  // ── Questions from the interface ──────────────────────────────────────────

  /** The person in slot `i`, if it still holds the one with this serial. */
  alive(i: number, serial: number): boolean {
    return i >= 0 && i < MAX_PEOPLE && !!this.active[i] && this.serial[i] === serial;
  }

  /** What person `i` is up to. */
  activity(i: number): { state: PedState; errand: Errand; remaining: number; crossing: boolean } {
    const p = this.paths[i];
    let remaining = 0;
    if (p && this.state[i] !== PedState.Follow) {
      remaining = Math.max(0, segLen(p, this.seg[i]) - this.u[i]);
      for (let s = this.seg[i] + 1; s < p.n - 1; s++) remaining += segLen(p, s);
    } else if (this.leader[i] >= 0) {
      return { ...this.activity(this.leader[i]), state: this.state[this.leader[i]] as PedState };
    }
    const crossing = !!p && this.state[i] === PedState.Walk && p.kind[Math.min(this.seg[i], p.n - 2)] !== SEG.walk && p.kind[Math.min(this.seg[i], p.n - 2)] < SEG.door;
    return { state: this.state[i] as PedState, errand: this.errand[i] as Errand, remaining, crossing };
  }

  /** The kind of crossing someone is waiting at (for the inspector). */
  waitingFor(i: number): 'lights' | 'gap' | null {
    const p = this.paths[i];
    if (!p || this.state[i] !== PedState.WaitCross) return null;
    return p.kind[this.seg[i] + 1] === SEG.signal ? 'lights' : 'gap';
  }

  /** Who walks beside whom (leader first). */
  groupOf(i: number): number[] {
    const l = this.leader[i] >= 0 ? this.leader[i] : i;
    const out = [l];
    for (let s = 0; s < 2; s++) if (this.followers[l * 2 + s] >= 0) out.push(this.followers[l * 2 + s]);
    return out;
  }

  /** Whether a household is still the one a person came from (it may have moved out). */
  stillHome(i: number): boolean {
    const pop = this.city.population;
    const h = this.household[i];
    return !!pop.alive[h] && pop.moveInTick[h] === this.moveIn[i];
  }

  /** Current path (for tests and the debug view). */
  pathOf(i: number): Path | null {
    return this.paths[i];
  }

  segmentOf(i: number): number {
    return this.seg[i];
  }
}

function segLen(p: Path, s: number): number {
  return Math.hypot(p.pts[s * 2 + 2] - p.pts[s * 2], p.pts[s * 2 + 3] - p.pts[s * 2 + 1]);
}

function smooth(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

const chatty = (e: number) => e === Errand.Shop || e === Errand.Park || e === Errand.Stroll || e === Errand.Home;

function nearest(list: Building[], x: number, z: number, r: number): Building | null {
  let best: Building | null = null;
  let bd = r * r;
  for (const b of list) {
    const d = (b.cx - x) ** 2 + (b.cz - z) ** 2;
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

/** One of the `k` nearest buildings to a point (within `r`), at random. */
function nearestOf(list: Building[], x: number, z: number, k: number, rng: Rng, r: number): Building | null {
  const best: { b: Building; d: number }[] = [];
  for (const b of list) {
    const d = (b.cx - x) ** 2 + (b.cz - z) ** 2;
    if (d > r * r) continue;
    if (best.length < k) best.push({ b, d });
    else {
      let w = 0;
      for (let m = 1; m < best.length; m++) if (best[m].d > best[w].d) w = m;
      if (d < best[w].d) best[w] = { b, d };
    }
  }
  return best.length ? best[Math.floor(rng.next() * best.length)].b : null;
}
