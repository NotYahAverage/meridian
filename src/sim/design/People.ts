import { clamp } from '../../core/math';
import { hash01 } from '../../core/rng';
import type { Building } from '../buildings/Buildings';
import type { City } from '../City';
import { SERVICE_BY_ID } from '../services/ServiceTypes';
import type { Movement } from '../style/Movements';
import { BuildingState, Zone, isResidential, zoneBase } from '../types';
import { GROUPS, GROUP_BY_ID, type GroupDef, type GroupId, foundingShares, groupScore, likeOf } from './Tastes';

/**
 * The taste groups as a living part of the city. Each group's mood follows
 * how the city builds (the styles around them, weighed by how much they like
 * each), a few things it cares about beyond looks, and what the mayor has
 * done lately. Unhappy groups grumble, then petition, then protest, and in
 * the end move away; delighted ones draw more of their kind to the city.
 */

export type Stage = 'enthusiastic' | 'content' | 'grumbling' | 'petitioning' | 'protesting' | 'leaving';

export const STAGE_LABEL: Record<Stage, string> = {
  enthusiastic: 'Enthusiastic', content: 'Content', grumbling: 'Grumbling', petitioning: 'Petitioning', protesting: 'Protesting', leaving: 'Leaving the city',
};

/** Something the mayor did that a group remembers for a while. */
export interface Memory {
  group: GroupId;
  delta: number;
  day: number;
  why: string;
}

export type Demand =
  | { kind: 'retire'; styleId: number }
  | { kind: 'design'; minLike: number; maxFloors?: number }
  | { kind: 'park'; parks: number }
  | { kind: 'tax'; cat: 'residential' | 'commercial'; max: number };

export type PetitionState = 'open' | 'promised' | 'refused' | 'kept' | 'broken' | 'lapsed';

export interface Petition {
  id: number;
  group: GroupId;
  demand: Demand;
  /** "Stop building in the Concrete Garden style." */
  text: string;
  /** Why they're asking. */
  why: string;
  day: number;
  state: PetitionState;
  /** Promised: when it must be done by. */
  deadline?: number;
  /** Promised: things done from this day count. */
  since?: number;
  closed?: number;
}

export interface Protest {
  id: number;
  group: GroupId;
  x: number;
  z: number;
  day: number;
  until: number;
  sign: string;
  why: string;
}

export interface GroupState {
  mood: number;
  /** Days in a row below 28 (protest) and below 20 (leaving). */
  lowDays: number;
  leaveDays: number;
  stage: Stage;
  /** Mood at the end of each month (last 24). */
  history: number[];
  lastPetition: number;
  lastProtest: number;
  /** Households that have moved away in protest, and moved in drawn by the city. */
  left: number;
  joined: number;
}

export interface Driver {
  why: string;
  value: number;
}

export interface PeopleSave {
  v: 1;
  groups: [GroupId, GroupState][];
  memories: Memory[];
  petitions: Petition[];
  protests: Protest[];
  counter: number;
}

const MEMORY_DAYS = 240;
const PETITION_DAYS = 120;
const ANSWER_DAYS = 30;
const PROTEST_DAYS = 10;
const PROTEST_RADIUS = 300;

export class People {
  readonly founding: number[];
  readonly state = new Map<GroupId, GroupState>();
  memories: Memory[] = [];
  petitions: Petition[] = [];
  protests: Protest[] = [];
  version = 0;
  /** Households per group (refreshed daily). */
  private counts = GROUPS.map(() => 0);
  private counter = 1;
  /** What moves each group's mood (refreshed with the moods). */
  private drivers = new Map<GroupId, Driver[]>();
  /** Happiness for everyone from how the groups feel about the city (refreshed daily). */
  private cityMood = 0;

  constructor(private city: City) {
    this.founding = foundingShares(city.research.civSeed, city.preset);
    for (const g of GROUPS) this.state.set(g.id, { mood: 60, lowDays: 0, leaveDays: 0, stage: 'content', history: [], lastPetition: -999, lastProtest: -999, left: 0, joined: 0 });
  }

  // -- Who lives here -----------------------------------------------------------

  /** Each group's share of households (the founding mix until anyone lives here). */
  shares(): number[] {
    const total = this.counts.reduce((a, b) => a + b, 0);
    if (total < 20) return this.founding.map((f, i) => (total ? (f * 20 + this.counts[i]) / (20 + total) : f));
    return this.counts.map((c) => c / total);
  }

  share(id: GroupId): number {
    return this.shares()[GROUPS.findIndex((g) => g.id === id)];
  }

  households(id: GroupId): number {
    return this.counts[GROUPS.findIndex((g) => g.id === id)];
  }

  /** The group a new household belongs to: happy groups draw more of their kind. */
  groupForNewcomer(i: number, tick: number): number {
    const shares = this.shares();
    let total = 0;
    const w = GROUPS.map((g, k) => {
      const mood = this.state.get(g.id)!.mood;
      const v = (0.5 * this.founding[k] + 0.5 * shares[k]) * (0.35 + mood / 100) ** 2;
      total += v;
      return v;
    });
    let u = hash01(i + 1, tick, this.city.research.civSeed) * total;
    for (let k = 0; k < w.length; k++) {
      u -= w[k];
      if (u <= 0) {
        if (this.state.get(GROUPS[k].id)!.mood >= 75) this.state.get(GROUPS[k].id)!.joined++;
        return k;
      }
    }
    return w.length - 1;
  }

  private recount(): void {
    const pop = this.city.population;
    this.counts = GROUPS.map(() => 0);
    for (let i = 0; i < pop.count; i++) if (pop.alive[i]) this.counts[pop.taste[i]] = (this.counts[pop.taste[i]] ?? 0) + 1;
  }

  // -- How they feel ------------------------------------------------------------

  mood(id: GroupId): number {
    return this.state.get(id)!.mood;
  }

  driversOf(id: GroupId): Driver[] {
    return this.drivers.get(id) ?? [];
  }

  /** Happiness from how the groups feel, plus protests nearby. */
  moodBonus(b: Building): number {
    let m = this.cityMood;
    for (const p of this.protests) if (Math.abs(b.cx - p.x) < PROTEST_RADIUS && Math.abs(b.cz - p.z) < PROTEST_RADIUS && Math.hypot(b.cx - p.x, b.cz - p.z) < PROTEST_RADIUS) m -= 6;
    return m;
  }

  /** How the city's reputation with the groups draws or puts off newcomers (a residential demand factor). */
  reputation(): { value: number; text: string } {
    const shares = this.shares();
    let v = 0;
    let best: GroupDef | null = null, worst: GroupDef | null = null;
    GROUPS.forEach((g, i) => {
      const m = this.state.get(g.id)!.mood;
      v += shares[i] * (m - 55) * 0.55;
      if (!best || m > this.state.get(best.id)!.mood) best = g;
      if (!worst || m < this.state.get(worst.id)!.mood) worst = g;
    });
    const b = best as GroupDef | null, w = worst as GroupDef | null;
    const bm = b ? this.state.get(b.id)!.mood : 50, wm = w ? this.state.get(w.id)!.mood : 50;
    const text = bm >= 70 && wm < 40 ? `${cap(b!.members)} love the city; ${w!.members} are unhappy` : bm >= 70 ? `${cap(b!.members)} love how the city is building` : wm < 40 ? `${cap(w!.members)} are unhappy with the city` : 'The city’s groups are getting along';
    return { value: clamp(v, -25, 20), text };
  }

  /** How much a group likes a movement (style). */
  private likeMovement(g: GroupDef, m: Movement | undefined): number {
    if (!m) return 0;
    return likeOf(g, m) * (m.local ? 0.4 : 1);
  }

  /** Recomputes each group's mood target and moves towards it. */
  private updateMoods(rate: number): void {
    const city = this.city;
    const day = city.clock.day;
    const design = city.design;
    // The buildings people see every day, in the styles they're built in.
    const weightOf = new Map<number, number>();
    const protoLooks: { look: Movement; w: number }[] = [];
    let total = 0, towers = 0, zoned = 0, commercial = 0, parks = 0, culture = false, metro = false;
    for (const b of city.buildings.all.values()) {
      if (b.state === BuildingState.Abandoned) continue;
      if (b.kind === 'service') {
        const st = SERVICE_BY_ID.get(b.typeId);
        if (st?.kind === 'park') parks++;
        if (b.typeId === 'museum' || b.typeId === 'cathedral' || st?.kind === 'landmark') culture = true;
        if (b.typeId === 'metro_station') metro = true;
        continue;
      }
      zoned++;
      if (b.floors >= 10) towers++;
      if (zoneBase(b.zone) === Zone.Commercial) commercial++;
      const w = 1 + b.floors * 0.15;
      total += w;
      if (b.typeId === 'proto') {
        const look = design.lookOf(b.id);
        if (look) protoLooks.push({ look, w: w * 2 });
        continue;
      }
      const id = city.style.movementOf(b) ? b.movement : 0;
      weightOf.set(id, (weightOf.get(id) ?? 0) + w);
    }
    const towerShare = zoned ? towers / zoned : 0;
    const t = city.economy.taxes;
    const parkCov = city.coverage.averageFor('park', city.buildings);
    const eduCov = city.coverage.averageFor('education', city.buildings);
    let pol = 0, homes = 0;
    for (const b of city.buildings.all.values()) {
      if (!isResidential(b.zone) || b.residents === 0) continue;
      pol += city.landValue.pollutionAt(b.cx, b.cz);
      if (++homes >= 400) break;
    }
    const smog = homes ? pol / homes : 0;
    const trip = city.traffic.avgTripMinutes;
    for (const g of GROUPS) {
      const st = this.state.get(g.id)!;
      const drivers: Driver[] = [];
      // How the city looks to them.
      if (total > 0) {
        for (const [id, w] of weightOf) {
          const m = city.style.get(id);
          const like = this.likeMovement(g, m);
          const v = (26 * w * like) / total;
          if (Math.abs(v) < 0.4) continue;
          const name = !m || m.local ? 'the city’s own way of building' : `the ${m.name}`;
          drivers.push({ why: `Buildings in ${name}`, value: v });
        }
        let pv = 0;
        for (const p of protoLooks) pv += (26 * p.w * likeOf(g, p.look)) / total;
        if (Math.abs(pv) >= 0.4) drivers.push({ why: 'The prototypes', value: pv });
      }
      // What they care about beyond looks.
      const add = (why: string, value: number) => {
        if (Math.abs(value) >= 0.4) drivers.push({ why, value });
      };
      switch (g.id) {
        case 'heritage':
          add(culture ? 'A museum or landmark to be proud of' : 'No museum or landmark yet', culture ? 4 : -2);
          add('Towers on the skyline', -22 * towerShare);
          break;
        case 'green':
          add('Smog over the homes', -50 * smog);
          add(parkCov >= 0.3 ? 'Parks within reach of homes' : 'Too few parks near homes', 12 * (parkCov - 0.3));
          break;
        case 'modern':
          add('A skyline of towers', 12 * Math.min(1, towerShare * 6));
          if (metro) add('A metro', 3);
          if (city.population.residents > 5000) add('A growing city', 4);
          break;
        case 'family':
          add(`Residential tax at ${t.residential}%`, -2.4 * (t.residential - 9));
          add(eduCov >= 0.4 ? 'Schools within reach' : 'Too few schools', 12 * (eduCov - 0.4));
          break;
        case 'business':
          add(`Shop and office taxes at ${t.commercial}% and ${t.office}%`, -2 * (t.commercial - 9) - (t.office - 9));
          add('Traffic jams', -0.8 * Math.max(0, trip - 16));
          add('Shops on the streets', 6 * Math.min(1, commercial / 30) - 2);
          break;
        case 'locals':
          add('Towers over the houses', -18 * towerShare);
          add('Traffic on their streets', -0.6 * Math.max(0, trip - 14));
          add('Parks nearby', 6 * (parkCov - 0.3));
          break;
      }
      // What the mayor did.
      for (const mem of this.memories) {
        if (mem.group !== g.id) continue;
        const v = mem.delta * Math.max(0, 1 - (day - mem.day) / MEMORY_DAYS);
        if (Math.abs(v) >= 0.4) drivers.push({ why: mem.why, value: v });
      }
      if (this.protests.some((p) => p.group === g.id)) drivers.push({ why: 'Out protesting', value: -3 });
      drivers.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
      this.drivers.set(g.id, drivers);
      const target = clamp(58 + drivers.reduce((a, d) => a + d.value, 0), 3, 97);
      st.mood = st.mood + (target - st.mood) * rate;
    }
  }

  // -- The day ------------------------------------------------------------------

  daily(): void {
    const city = this.city;
    const day = city.clock.day;
    this.recount();
    if (day % 5 === 0 || !this.drivers.size) {
      this.updateMoods(day % 5 === 0 ? 0.18 : 1);
      this.version++;
    }
    this.memories = this.memories.filter((m) => day - m.day < MEMORY_DAYS);
    const shares = this.shares();
    this.cityMood = GROUPS.reduce((a, g, i) => a + shares[i] * ((this.state.get(g.id)!.mood - 55) / 45) * 4, 0);
    // Protests run their course.
    for (const p of [...this.protests]) {
      if (day < p.until) continue;
      this.protests = this.protests.filter((x) => x !== p);
      city.emitNotice({ severity: 'info', icon: 'people', title: `${GROUP_BY_ID.get(p.group)!.name} protest is over`, text: 'The crowd has gone home, for now.', x: p.x, z: p.z });
      this.version++;
    }
    this.petitionsDaily(day);
    for (const g of GROUPS) {
      const st = this.state.get(g.id)!;
      st.lowDays = st.mood < 28 ? st.lowDays + 1 : 0;
      st.leaveDays = st.mood < 20 ? st.leaveDays + 1 : Math.max(0, st.leaveDays - 2);
      const before = st.stage;
      // Petition first; then, if nothing changes, out on the street.
      if (st.mood < 40 && day - st.lastPetition > 90 && !this.petitions.some((p) => p.group === g.id && (p.state === 'open' || p.state === 'promised'))) this.petition(g, day);
      if (st.lowDays >= 15 && day - st.lastProtest > 60 && !this.protests.some((p) => p.group === g.id)) this.protest(g, day, 'They have been unhappy for weeks.');
      if (st.leaveDays >= 30 && (day - 30) % 10 === 0) this.leave(g, day);
      st.stage = this.stageOf(g.id);
      if (st.stage !== before) this.onStage(g, before, st.stage);
      if (day > 0 && day % 30 === 0) {
        st.history.push(Math.round(st.mood));
        if (st.history.length > 24) st.history.shift();
      }
    }
  }

  stageOf(id: GroupId): Stage {
    const st = this.state.get(id)!;
    if (st.leaveDays >= 30) return 'leaving';
    if (this.protests.some((p) => p.group === id)) return 'protesting';
    if (st.mood < 40) return 'petitioning';
    if (st.mood < 52) return 'grumbling';
    if (st.mood >= 75) return 'enthusiastic';
    return 'content';
  }

  private onStage(g: GroupDef, from: Stage, to: Stage): void {
    const city = this.city;
    if (to === 'grumbling' && from === 'content') city.emitNotice({ severity: 'info', icon: 'people', title: `${g.name} is grumbling`, text: `${cap(g.members)} are getting unhappy with the city. See what moves them in the Design Studio, under People.` }, `grumble-${g.id}`, 24 * 60);
    if (to === 'enthusiastic') {
      city.emitNotice({ severity: 'good', icon: 'people', title: `${g.name} loves the city`, text: `${cap(g.members)} are delighted with how the city is building, and more of them are moving here.` }, `love-${g.id}`, 24 * 90);
      city.news.file(`people-love-${g.id}`, 45, 'good', `${cap(g.members)} flock to ${city.name}`, `${g.name} says the city is building just the way they like. Agents report more newcomers asking for homes here.`);
    }
    this.city.events.emit('people', { type: 'stage', group: g.id, stage: to });
    this.version++;
  }

  // -- Petitions ----------------------------------------------------------------

  private petition(g: GroupDef, day: number): void {
    const city = this.city;
    const st = this.state.get(g.id)!;
    const drivers = this.driversOf(g.id).filter((d) => d.value < 0);
    let demand: Demand | null = null;
    let text = '', why = drivers[0]?.why ?? 'How the city is building';
    // The style they hate most, if it is one the city adopted.
    for (const s of city.design.styles) {
      if (s.push <= 0.5) continue;
      const m = city.style.get(s.id);
      if (!m || likeOf(g, m) > -0.2) continue;
      if (!drivers.some((d) => d.why.includes(m.name))) continue;
      demand = { kind: 'retire', styleId: s.id };
      text = `Stop building in the ${m.name}.`;
      why = `Buildings in the ${m.name}`;
      break;
    }
    if (!demand) {
      const top = drivers[0]?.why ?? '';
      if (top.startsWith('Residential tax')) {
        demand = { kind: 'tax', cat: 'residential', max: Math.max(5, city.economy.taxes.residential - 2) };
        text = `Lower residential tax to ${demand.max}%.`;
      } else if (top.startsWith('Shop and office taxes')) {
        demand = { kind: 'tax', cat: 'commercial', max: Math.max(5, city.economy.taxes.commercial - 2) };
        text = `Lower the tax on shops to ${demand.max}%.`;
      } else if (top.includes('park') || top.startsWith('Smog')) {
        demand = { kind: 'park', parks: this.parkCount() };
        text = 'Build a new park.';
      } else if (top.startsWith('Towers')) {
        demand = { kind: 'design', minLike: 0.25, maxFloors: 5 };
        text = 'Test a prototype that fits in: five storeys or less, the way we like it.';
      } else {
        demand = { kind: 'design', minLike: 0.3 };
        text = `Test a prototype we would like: ${likesText(g)}.`;
      }
    }
    const p: Petition = { id: this.counter++, group: g.id, demand, text, why, day, state: 'open' };
    this.petitions.push(p);
    st.lastPetition = day;
    city.emitNotice({ severity: 'warning', icon: 'people', title: `Petition from ${g.name}`, text: `${text} Answer it in the Design Studio, under People.`, quiet: true }, `petition-${g.id}`, 24 * 30);
    city.news.file(`petition-${p.id}`, 48, 'bad', `${g.name} petitions the mayor`, `“${text}” ${cap(g.members)} say ${why.charAt(0).toLowerCase()}${why.slice(1)} is the problem.`);
    city.events.emit('people', { type: 'petition', group: g.id, petition: p.id });
    this.version++;
  }

  /** The mayor answers a petition. */
  answer(id: number, promise: boolean): void {
    const p = this.petitions.find((x) => x.id === id);
    if (!p || p.state !== 'open') return;
    const day = this.city.clock.day;
    const g = GROUP_BY_ID.get(p.group)!;
    if (promise) {
      p.state = 'promised';
      p.since = day;
      p.deadline = day + PETITION_DAYS;
      this.remember(p.group, 4, 'The mayor promised to listen');
    } else {
      p.state = 'refused';
      p.closed = day;
      this.remember(p.group, -8, 'The mayor turned down their petition');
      this.city.news.file(`petition-no-${p.id}`, 40, 'bad', `Mayor says no to ${g.name}`, `The petition, “${p.text}”, has been turned down. ${cap(g.members)} say they won’t forget it.`);
    }
    this.updateMoods(0.25);
    this.version++;
  }

  private petitionsDaily(day: number): void {
    for (const p of this.petitions) {
      const g = GROUP_BY_ID.get(p.group)!;
      if (p.state === 'open' && day - p.day > ANSWER_DAYS) {
        p.state = 'lapsed';
        p.closed = day;
        this.remember(p.group, -5, 'Their petition went unanswered');
        this.version++;
      } else if (p.state === 'promised') {
        if (this.fulfilled(p)) {
          p.state = 'kept';
          p.closed = day;
          this.remember(p.group, 14, 'The mayor kept a promise');
          this.city.emitNotice({ severity: 'good', icon: 'people', title: `Promise kept to ${g.name}`, text: `“${p.text}” Done, and ${g.members} noticed.` });
          this.city.news.file(`petition-kept-${p.id}`, 42, 'good', `Mayor keeps promise to ${g.name}`, `“${p.text}” ${cap(g.members)} welcomed the news.`);
          this.city.events.emit('people', { type: 'promise', group: p.group, petition: p.id, kept: true });
          this.version++;
        } else if (day >= (p.deadline ?? day)) {
          p.state = 'broken';
          p.closed = day;
          this.remember(p.group, -20, 'The mayor broke a promise');
          this.city.emitNotice({ severity: 'critical', icon: 'people', title: `Promise broken to ${g.name}`, text: `“${p.text}” was never done. ${cap(g.members)} are taking to the streets.` });
          this.city.events.emit('people', { type: 'promise', group: p.group, petition: p.id, kept: false });
          if (!this.protests.some((x) => x.group === p.group)) this.protest(g, day, `A broken promise: “${p.text}”`);
          this.version++;
        }
      }
    }
    if (this.petitions.length > 40) this.petitions = this.petitions.slice(-40);
  }

  /** Whether what a petition asked for has been done. */
  fulfilled(p: Petition): boolean {
    const city = this.city;
    const d = p.demand;
    switch (d.kind) {
      case 'retire': {
        const s = city.design.style(d.styleId);
        return !s || s.push <= 0.5;
      }
      case 'tax':
        return city.economy.taxes[d.cat] <= d.max;
      case 'park':
        return this.parkCount() > d.parks;
      case 'design': {
        const g = GROUP_BY_ID.get(p.group)!;
        return city.design.trials.some((t) => t.placedDay >= (p.since ?? p.day) && (!d.maxFloors || t.concept.floors <= d.maxFloors) && groupScore(g, t.factors, t.concept.look) >= d.minLike);
      }
    }
  }

  private parkCount(): number {
    let n = 0;
    for (const b of this.city.buildings.all.values()) if (b.kind === 'service' && SERVICE_BY_ID.get(b.typeId)?.kind === 'park') n++;
    return n;
  }

  // -- Protests and leaving -----------------------------------------------------

  private protest(g: GroupDef, day: number, why: string): void {
    const city = this.city;
    const st = this.state.get(g.id)!;
    // Where: at the style they hate, or where most of them live.
    let x = city.startPoint.x, z = city.startPoint.z;
    let sign = g.slogans[Math.floor(hash01(day, GROUPS.indexOf(g), city.research.civSeed) * g.slogans.length)];
    const hated = city.design.styles.map((s) => ({ s, like: likeOf(g, city.style.get(s.id)!) })).filter((e) => e.s.push > 0.5 && e.like < -0.2).sort((a, b) => a.like - b.like)[0];
    if (hated) {
      x = hated.s.x;
      z = hated.s.z;
      sign = `No more ${hated.s.name}!`;
    } else {
      const c = this.homeCentre(GROUPS.indexOf(g));
      if (c) ({ x, z } = c);
    }
    const p: Protest = { id: this.counter++, group: g.id, x, z, day, until: day + PROTEST_DAYS, sign, why };
    this.protests.push(p);
    st.lastProtest = day;
    city.emitNotice({ severity: 'critical', icon: 'people', title: `${g.name} is protesting`, text: `“${sign}” ${why} Homes nearby are unhappier while it lasts.`, x, z });
    city.news.file(`protest-${p.id}`, 72, 'bad', `${cap(g.members)} march: “${sign}”`, `${g.name} took to the streets. ${why} Organisers promise more unless the city changes course.`, { x, z });
    city.events.emit('people', { type: 'protest', group: g.id, protest: p.id });
    this.version++;
  }

  /** Where a group's homes are, on average. */
  private homeCentre(k: number): { x: number; z: number } | null {
    const pop = this.city.population;
    let x = 0, z = 0, n = 0;
    for (let i = 0; i < pop.count && n < 500; i++) {
      if (!pop.alive[i] || pop.taste[i] !== k) continue;
      const b = this.city.buildings.get(pop.home[i]);
      if (!b) continue;
      x += b.cx;
      z += b.cz;
      n++;
    }
    return n ? { x: x / n, z: z / n } : null;
  }

  /** The unhappiest give up and move away, a few at a time. */
  private leave(g: GroupDef, day: number): void {
    const city = this.city;
    const pop = city.population;
    const k = GROUPS.indexOf(g);
    const theirs: number[] = [];
    for (let i = 0; i < pop.count; i++) if (pop.alive[i] && pop.taste[i] === k) theirs.push(i);
    if (!theirs.length) return;
    const n = Math.min(200, Math.max(1, Math.round(theirs.length * 0.04)));
    let people = 0;
    for (let j = 0; j < n; j++) {
      const i = theirs[Math.floor(hash01(day, j, city.research.civSeed) * theirs.length)];
      if (!pop.alive[i]) continue;
      people += pop.size[i];
      city.removeHousehold(i);
    }
    const st = this.state.get(g.id)!;
    st.left += n;
    city.emitNotice({ severity: 'critical', icon: 'people', title: `${cap(g.members)} are leaving`, text: `${people} ${people === 1 ? 'person' : 'people'} from ${g.name} moved away this week. They say the city no longer wants them.` }, `leave-${g.id}`, 24 * 25);
    if (st.left === n) city.news.file(`leave-${g.id}-${day}`, 75, 'bad', `${cap(g.members)} pack their bags`, `Families from ${g.name} are leaving ${city.name}, saying it is building a city that isn’t for them.`);
    city.events.emit('people', { type: 'leaving', group: g.id, households: n });
    this.version++;
  }

  // -- What the mayor does ------------------------------------------------------

  remember(group: GroupId, delta: number, why: string): void {
    // The same kind of thing again replaces the old memory rather than stacking.
    this.memories = this.memories.filter((m) => !(m.group === group && m.why === why));
    this.memories.push({ group, delta, day: this.city.clock.day, why });
    this.version++;
  }

  /** A style is adopted: those who like it cheer, those who don't remember. */
  onAdopt(m: Movement): void {
    for (const g of GROUPS) {
      const like = likeOf(g, m);
      if (Math.abs(like) > 0.1) this.remember(g.id, 24 * like, like > 0 ? `The ${m.name} was adopted` : `The ${m.name} was adopted, against their taste`);
    }
    this.updateMoods(0.3);
  }

  /** A style is encouraged, discouraged or retired. */
  onPush(m: Movement, before: number, after: number): void {
    if (after === before) return;
    for (const g of GROUPS) {
      const like = likeOf(g, m);
      if (Math.abs(like) < 0.15) continue;
      const v = 8 * like * Math.sign(after - before) * (after === 0 || before === 0 ? 1.5 : 1);
      this.remember(g.id, v, after > before ? `The ${m.name} was encouraged` : after === 0 ? `The ${m.name} was retired` : `The ${m.name} was held back`);
    }
    this.updateMoods(0.3);
  }

  /** A design they had views on was scrapped. */
  onScrap(name: string, byGroup: Partial<Record<GroupId, number>>): void {
    for (const g of GROUPS) {
      const a = byGroup[g.id];
      if (a === undefined) continue;
      if (a >= 65) this.remember(g.id, -5, `${name}, which they liked, was scrapped`);
      else if (a <= 35) this.remember(g.id, 4, `${name}, which they disliked, was scrapped`);
    }
    this.updateMoods(0.3);
  }

  // -- Saving -------------------------------------------------------------------

  serialize(): PeopleSave {
    return structuredClone({ v: 1 as const, groups: [...this.state.entries()], memories: this.memories, petitions: this.petitions, protests: this.protests, counter: this.counter });
  }

  load(d: PeopleSave | undefined): void {
    const pop = this.city.population;
    if (d) {
      const data = structuredClone(d);
      for (const [id, st] of data.groups) if (this.state.has(id)) this.state.set(id, st);
      this.memories = data.memories;
      this.petitions = data.petitions;
      this.protests = data.protests;
      this.counter = data.counter;
    }
    // Households from before taste groups: given one each from the city's founding mix.
    for (let i = 0; i < pop.count; i++) {
      if (!pop.alive[i] || pop.taste[i] < GROUPS.length) continue;
      let u = hash01(i + 1, 991, this.city.research.civSeed);
      let k = 0;
      while (k < GROUPS.length - 1 && (u -= this.founding[k]) > 0) k++;
      pop.taste[i] = k;
    }
    this.recount();
    // What moves them, without moving their mood (it was saved).
    this.updateMoods(0);
    this.version++;
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "planted balconies, green roofs and timber". */
function likesText(g: GroupDef): string {
  const NAMES: Record<string, string> = {
    stone: 'stone', brick: 'brick', timber: 'timber', glass: 'glass', beton: 'raw concrete', panel: 'prefab panels', render: 'painted render', siding: 'weatherboard',
    ornament: 'ornament', arcade: 'an arcade', planters: 'planted balconies', greenRoof: 'a green roof', roofGarden: 'a roof garden', skyGarden: 'sky gardens', solarSkin: 'solar panels', windCrown: 'wind turbines',
    cantilever: 'bold overhangs', pilotis: 'columns over open ground', balconies: 'balconies', courtyard: 'a courtyard', loggias: 'loggias', terraces: 'terraces', mansard: 'a mansard roof', butterfly: 'a butterfly roof',
  };
  const likes = [...Object.entries(g.walls), ...Object.entries(g.features), ...Object.entries(g.roofs)].filter(([, v]) => (v ?? 0) >= 0.4).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([k]) => NAMES[k]).filter(Boolean).slice(0, 3);
  if (g.id === 'family') return 'affordable homes with room to breathe, like balconies or a courtyard';
  if (g.id === 'business') return 'shops at street level, quick to build';
  if (g.id === 'locals') return 'something that fits the street and doesn’t tower over it';
  return likes.length > 1 ? `${likes.slice(0, -1).join(', ')} and ${likes[likes.length - 1]}` : likes[0] ?? 'something new';
}
