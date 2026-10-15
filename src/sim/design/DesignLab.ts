import { Rng } from '../../core/rng';
import type { Building } from '../buildings/Buildings';
import type { City } from '../City';
import { Clock } from '../Clock';
import { NewsDesk } from '../news/News';
import { hashStr } from '../research/Generate';
import { SERVICE_BY_ID } from '../services/ServiceTypes';
import type { Movement } from '../style/Movements';
import { BuildingState, Zone, isResidential, zoneBase } from '../types';
import { type CityFacts, IDEAS, IDEA_BY_ID } from './Ideas';
import { type Concept, type DesignContext, type DesignInput, compileConcept } from './Concept';
import {
  type Factor, GRADE_LABEL, MAX_ACTIVE_TRIALS, type Reaction, type Site, type Speaker, type Trial, type Voices, absorb, approvalOf, assess, capReactions, emptyScores, followUp, liveFactors, makeReaction, makeVerdict, openingScores, speaksToday, surveySite,
} from './Trials';
import { GROUPS, approvalFromScore, groupScore } from './Tastes';
import { type AdoptedStyle, globalShare, kindsFor, localChance, moodOf, reachOf, renovationsDue, saturation, styleName } from './Styles';

/** A design saved to the sketchbook. */
export interface Sketch {
  id: string;
  name: string;
  input: DesignInput;
  /** The design as it was compiled when saved (kept exactly, never regenerated). */
  concept: Concept;
  day: number;
  /** A revision of the design tested in this trial. */
  refines?: number;
  /** 1 for a first design, 2 for its first revision… */
  rev?: number;
  /** Shelved after its trial. */
  scrapped?: boolean;
}

export interface LearnedIdea {
  day: number;
  story: string;
}

export interface DesignSave {
  v: 1;
  learned: [string, LearnedIdea][];
  sketches: Sketch[];
  counter: number;
  trials?: Trial[];
  trialCounter?: number;
  styles?: AdoptedStyle[];
  storm: boolean;
  powerShort: boolean;
  smogMonths: number;
}

const LANDMARK_KINDS = new Set(['landmark']);

/**
 * The city's architects: the ideas they know, learned from what happens in
 * the city, and the designs saved in the sketchbook.
 */
export class DesignLab {
  readonly learned = new Map<string, LearnedIdea>();
  sketches: Sketch[] = [];
  /** Prototypes built from the sketchbook, newest last (kept after their verdict). */
  trials: Trial[] = [];
  /** Adopted designs the city now builds in. */
  styles: AdoptedStyle[] = [];
  private styleById = new Map<number, AdoptedStyle>();
  version = 0;
  private counter = 1;
  private trialCounter = 1;
  /** Things that happened once and count for good. */
  private storm = false;
  private powerShort = false;
  private smogMonths = 0;
  private factsCache: { day: number; facts: CityFacts } | null = null;

  constructor(private city: City) {
    for (const i of IDEAS) if (i.start) this.learned.set(i.id, { day: 0, story: 'Known from the start.' });
  }

  known(): Set<string> {
    return new Set(this.learned.keys());
  }

  context(): DesignContext {
    const base = this.city.style.blend()[0]?.movement ?? this.city.style.movements[0];
    return { civSeed: this.city.research.civSeed, day: this.city.clock.day, known: this.known(), base };
  }

  /** Interprets a design (typed words plus cards). */
  compile(input: DesignInput): Concept {
    return compileConcept(input, this.context());
  }

  /** What the unlock checks look at. */
  facts(): CityFacts {
    const city = this.city;
    const day = city.clock.day;
    if (this.factsCache && this.factsCache.day === day) return this.factsCache.facts;
    let industrial = 0, offices = 0, commercial = 0, townhouses = 0, dense = 0, towers = 0, parks = 0, landmarks = 0, shoreHomes = 0, richHomes = 0, prototypes = this.trials.length;
    let bigPark = false, culture = false, solar = false, wind = false, station = false;
    let minY = Infinity, maxY = -Infinity, pol = 0, homes = 0;
    for (const b of city.buildings.all.values()) {
      if (b.state === BuildingState.Abandoned) continue;
      if (b.kind === 'service') {
        const st = SERVICE_BY_ID.get(b.typeId);
        if (!st) continue;
        if (st.kind === 'park') {
          parks++;
          if (b.typeId === 'central_park' || b.typeId === 'botanical_garden' || b.typeId === 'town_park') bigPark = true;
        }
        if (LANDMARK_KINDS.has(st.kind)) landmarks++;
        if (b.typeId === 'museum' || b.typeId === 'cathedral') culture = true;
        if (b.typeId === 'solar_farm') solar = true;
        if (b.typeId === 'wind_turbine') wind = true;
        if (b.typeId === 'metro_station' || b.typeId === 'bus_depot') station = true;
        continue;
      }
      const z = zoneBase(b.zone);
      if (z === Zone.Industrial) industrial++;
      else if (b.zone === Zone.Office) offices++;
      else if (z === Zone.Commercial) commercial++;
      if (isResidential(b.zone)) {
        if (b.style === 'townhouse') townhouses++;
        if (b.floors >= 5) dense++;
        if (b.y < minY) minY = b.y;
        if (b.y > maxY) maxY = b.y;
        if (homes < 600) {
          pol += city.landValue.pollutionAt(b.cx, b.cz);
          if (city.terrain.shoreDistanceAt(b.cx, b.cz) < 90) shoreHomes++;
        }
        if (b.landValue >= 0.7) richHomes++;
        homes++;
      }
      if (b.floors >= 12) towers++;
    }
    let bridge = false;
    for (const s of city.roads.segments.values()) if (s.elevated) {
      bridge = true;
      break;
    }
    const u = city.utilities.totals.power;
    if (u.shortfall > 0 && u.consumption > 0) this.powerShort = true;
    if (city.weather.kind === 'storm') this.storm = true;
    const smog = homes ? pol / Math.min(homes, 600) : 0;
    const facts: CityFacts = {
      day, population: city.population.residents, preset: city.preset,
      industrial, offices, commercial, townhouses, dense, towers, parks, bigPark, landmarks, culture, solar, wind, station, bridge,
      shoreHomes, relief: homes ? maxY - minY : 0, forest: natureCount(city), smog: Math.max(smog, this.smogMonths >= 1 ? 0.18 : 0),
      powerShort: this.powerShort, storm: this.storm, richHomes, prototypes,
    };
    this.factsCache = { day, facts };
    return facts;
  }

  /** Checks what the architects have learned (once a day). Quiet on load. */
  daily(quiet = false): string[] {
    this.factsCache = null;
    const f = this.facts();
    if (f.smog >= 0.18 && this.city.clock.day % 30 === 0) this.smogMonths++;
    const out: string[] = [];
    for (const idea of IDEAS) {
      if (this.learned.has(idea.id) || !idea.unlock) continue;
      if (!idea.unlock.test(f)) continue;
      this.learned.set(idea.id, { day: f.day, story: idea.unlock.story });
      out.push(idea.id);
      if (!quiet) {
        this.city.emitNotice({ severity: 'good', icon: 'research', title: `New idea: ${idea.name}`, text: idea.unlock.story });
        this.city.events.emit('design', { type: 'idea', id: idea.id });
      }
    }
    if (out.length) this.version++;
    if (!quiet) {
      this.dailyTrials();
      if (this.city.clock.day > 0 && this.city.clock.day % 30 === 0) this.monthlyStyles();
    }
    return out;
  }

  // -- Prototypes --------------------------------------------------------------

  /** Trials still being built or tested. */
  activeTrials(): Trial[] {
    return this.trials.filter((t) => t.state === 'building' || t.state === 'testing');
  }

  canStartTrial(): boolean {
    return this.activeTrials().length < MAX_ACTIVE_TRIALS;
  }

  trialOf(buildingId: number): Trial | undefined {
    for (let i = this.trials.length - 1; i >= 0; i--) if (this.trials[i].buildingId === buildingId && this.trials[i].state !== 'gone') return this.trials[i];
    return undefined;
  }

  trial(id: number): Trial | undefined {
    return this.trials.find((t) => t.id === id);
  }

  /** The look a prototype building is drawn in. */
  lookOf(buildingId: number): Movement | undefined {
    return this.trialOf(buildingId)?.concept.look;
  }

  /** How happiness is touched by living or working in a prototype or an adopted style (0 elsewhere). */
  moodBonus(b: Building): number {
    if (b.typeId === 'proto') {
      const t = this.trialOf(b.id);
      if (!t || t.openDay < 0) return 0;
      if (t.state === 'done' && t.verdict) return ((t.verdict.approval - 50) / 50) * 6;
      return t.scores.home * 10 + ((t.approval - 50) / 50) * 4;
    }
    const st = b.movement ? this.styleById.get(b.movement) : undefined;
    return st ? moodOf(st) : 0;
  }

  /** A sketch has been built on a lot: its trial begins once construction ends. */
  startTrial(sketch: Sketch, b: Building, cost: number): Trial {
    const c = structuredClone(sketch.concept);
    const t: Trial = {
      id: this.trialCounter++, sketchId: sketch.id, name: sketch.name, concept: c, buildingId: b.id, x: b.cx, z: b.cz, cost,
      placedDay: this.city.clock.day, openDay: -1, months: c.ambition, state: 'building', site: null, factors: [], scores: emptyScores(), approval: 50, history: [], reactions: [],
    };
    // A revision builds on what the first trial learned: it is tested for a month less.
    if (sketch.refines && this.trial(sketch.refines)) {
      t.parent = sketch.refines;
      t.months = Math.max(1, c.ambition - 1);
    }
    t.site = surveySite(this.city, b, c.look.axes);
    t.factors = this.factorsFor(t, t.site);
    this.trials.push(t);
    // Word gets around as soon as the hoardings go up.
    const r = new Rng(hashStr(t.id, 'plans', this.city.research.civSeed));
    const early = t.factors.filter((f) => f.aspect === 'neighbours' || f.aspect === 'looks');
    const re = makeReaction(t, early.length ? early : t.factors, r, this.city.clock.day, this.speaker(b), isResidential(b.zone), this.voices());
    if (re) this.say(t, re, false);
    this.city.events.emit('design', { type: 'trial', trial: t.id, what: 'placed' });
    this.version++;
    return t;
  }

  /** What people react to: the design and its site, and for a revision whether their complaints were answered. */
  private factorsFor(t: Trial, site: Site): Factor[] {
    const f = assess(t.concept, site);
    const parent = t.parent ? this.trial(t.parent) : undefined;
    return parent ? [...f, ...followUp(parent, f)] : f;
  }

  /** The taste groups as speakers, in proportion to how many of each live in the city. */
  private voices(): Voices[] | undefined {
    const people = this.city.people;
    if (!people) return undefined;
    const shares = people.shares();
    return GROUPS.map((g, i) => ({ id: g.id, share: shares[i], keys: g.keys }));
  }

  private speaker(b: Building | undefined): Speaker {
    const seg = b ? this.city.roads.segments.get(b.segId) : undefined;
    return { paper: NewsDesk.paperName(this.city), street: seg?.name ?? '' };
  }

  private say(t: Trial, re: Reaction, counts = true): void {
    if (counts) absorb(t, re);
    t.reactions.push(re);
    capReactions(t);
    this.city.events.emit('design', { type: 'reaction', trial: t.id, reaction: re });
    this.version++;
  }

  /** A prototype's building was demolished or burned down: the trial ends without a verdict. */
  onBuildingRemoved(b: Building): void {
    const t = this.trialOf(b.id);
    if (!t) return;
    if (t.state === 'testing' && this.city.clock.day - t.openDay >= 30) {
      // A month or more of opinions is enough for a verdict, even cut short.
      this.conclude(t, b, false, true);
      t.buildingId = 0;
    } else if (t.state === 'building' || t.state === 'testing') {
      t.state = 'gone';
      this.city.emitNotice({ severity: 'warning', icon: 'build', title: `${t.name}: trial ended`, text: 'The prototype was demolished before the trial finished.' });
      this.city.events.emit('design', { type: 'trial', trial: t.id, what: 'gone' });
    } else t.buildingId = 0;
    this.version++;
  }

  private dailyTrials(): void {
    const city = this.city;
    const day = city.clock.day;
    for (const t of this.trials) {
      if (t.state !== 'building' && t.state !== 'testing') continue;
      const b = city.buildings.get(t.buildingId);
      if (!b) continue;
      const residential = isResidential(b.zone);
      if (t.state === 'building') {
        if (b.state !== BuildingState.Active || b.progress < 1) continue;
        t.state = 'testing';
        t.openDay = day;
        t.site = surveySite(city, b, t.concept.look.axes);
        t.factors = this.factorsFor(t, t.site);
        t.scores = openingScores(t.factors);
        t.approval = approvalOf(t.scores, t.factors);
        city.emitNotice({ severity: 'good', icon: 'build', title: `${t.name} is open`, text: `The prototype is finished. Its residents and neighbours will be heard for ${t.months} month${t.months > 1 ? 's' : ''}.`, x: b.cx, z: b.cz });
        city.events.emit('design', { type: 'trial', trial: t.id, what: 'opened' });
        this.version++;
        continue;
      }
      if (b.state === BuildingState.Abandoned) {
        this.conclude(t, b, true);
        continue;
      }
      const k = day - t.openDay;
      if (speaksToday(t, day)) {
        const r = new Rng(hashStr(t.id, day, this.city.research.civSeed));
        const re = makeReaction(t, [...t.factors, ...liveFactors(b, day, t.openDay, city.landValue.pollutionAt(b.cx, b.cz), city.stats.happiness)], r, day, this.speaker(b), residential, this.voices());
        if (re) this.say(t, re);
      }
      if (k > 0 && k % 30 === 0) {
        t.history.push(t.approval);
        const month = k / 30;
        if (month >= t.months) this.conclude(t, b, false);
        else {
          // The neighbourhood changes: look again.
          t.site = surveySite(city, b, t.concept.look.axes);
          t.factors = this.factorsFor(t, t.site);
          const prev = t.history[t.history.length - 2];
          const trend = prev === undefined ? '' : t.approval > prev + 2 ? `, up from ${prev}%` : t.approval < prev - 2 ? `, down from ${prev}%` : '';
          city.emitNotice({ severity: t.approval >= 50 ? 'info' : 'warning', icon: 'people', title: `${t.name}: month ${month} of ${t.months}`, text: `${t.approval}% approve${trend}.`, x: b.cx, z: b.cz }, `trial-${t.id}`, 24 * 5);
          city.events.emit('design', { type: 'trial', trial: t.id, what: 'month' });
          this.version++;
        }
      }
    }
  }

  private conclude(t: Trial, b: Building, abandoned: boolean, cutShort = false): void {
    const city = this.city;
    if (abandoned || cutShort || !t.history.length) t.history.push(t.approval);
    t.verdict = makeVerdict(t, city.clock.day, isResidential(b.zone), abandoned, cutShort);
    t.state = 'done';
    const v = t.verdict;
    // Each group's view: what its members said, steadied by what the building is.
    v.byGroup = {};
    for (const g of GROUPS) {
      const said = t.reactions.filter((r) => r.group === g.id && r.month > 0 && !r.blame);
      const mean = said.length ? said.reduce((a, r) => a + r.mood, 0) / said.length : 0;
      const score = (said.length * mean + 2 * groupScore(g, t.factors, t.concept.look)) / (said.length + 2);
      v.byGroup[g.id] = approvalFromScore(score);
    }
    const first = t.parent ? this.trial(t.parent)?.verdict : undefined;
    if (first) v.summary += v.approval > first.approval + 2 ? ` Up from ${first.approval}% for the earlier version.` : v.approval < first.approval - 2 ? ` Down from ${first.approval}% for the earlier version.` : ` About the same as the earlier version (${first.approval}%).`;
    const tone = v.grade === 'loved' || v.grade === 'liked' ? 'good' : v.grade === 'mixed' ? 'neutral' : 'bad';
    city.emitNotice({ severity: tone === 'good' ? 'good' : tone === 'bad' ? 'warning' : 'info', icon: 'milestone', title: `Verdict on ${t.name}: ${GRADE_LABEL[v.grade]}`, text: `${v.approval}% approve. ${v.summary}`, x: b.cx, z: b.cz, quiet: true });
    const head: Record<string, string> = { loved: `${t.name} wins the city over`, liked: `Thumbs up for ${t.name}`, mixed: `${t.name} divides opinion`, disliked: `${t.name} fails to impress`, hated: `Residents turn on ${t.name}` };
    const q = v.quotes[0];
    city.news.file(`proto-${t.id}`, 58, tone, head[v.grade], `${v.summary}${q ? ` “${q.text}” says ${q.who}.` : ''}`, { x: b.cx, z: b.cz });
    city.events.emit('design', { type: 'trial', trial: t.id, what: 'verdict' });
    this.version++;
  }

  /** "Testing, month 2 of 4", or the stage it is at. */
  stageOf(t: Trial): string {
    if (t.state === 'building') {
      const b = this.city.buildings.get(t.buildingId);
      return `Being built · ${Math.round((b?.progress ?? 0) * 100)}%`;
    }
    if (t.state === 'testing') return `Testing · month ${Math.min(t.months, Math.floor((this.city.clock.day - t.openDay) / 30) + 1)} of ${t.months}`;
    if (t.state === 'gone') return 'Demolished before the verdict';
    const d = t.decision;
    if (d?.kind === 'adopted') return `Adopted as the ${this.styleById.get(d.styleId ?? -1)?.name ?? 'city’s style'}`;
    if (d?.kind === 'refined') return `Refined as ${this.sketches.find((k) => k.id === d.sketchId)?.name ?? 'a new version'}`;
    if (d?.kind === 'scrapped') return 'Scrapped';
    return `Verdict in ${Clock.monthLabel(Math.floor((t.verdict?.day ?? 0) / 30))}`;
  }

  /** Teaches an idea at once (for tests, scenarios and rewards). */
  learn(id: string, story = 'Learned.'): void {
    if (!IDEA_BY_ID.has(id) || this.learned.has(id)) return;
    this.learned.set(id, { day: this.city.clock.day, story });
    this.version++;
  }

  /** Saves a design; a revision of a tested design records the refinement on its trial. */
  saveSketch(input: DesignInput, name?: string, refines?: number): Sketch {
    const concept = this.compile(input);
    if (name?.trim()) concept.name = name.trim().slice(0, 48);
    const sk: Sketch = { id: `s${this.counter++}`, name: concept.name, input: structuredClone(input), concept, day: this.city.clock.day };
    const t = refines ? this.trial(refines) : undefined;
    if (t) {
      sk.refines = t.id;
      sk.rev = (this.sketches.find((k) => k.id === t.sketchId)?.rev ?? 1) + 1;
      if (t.state === 'done' && !t.decision) t.decision = { kind: 'refined', day: this.city.clock.day, sketchId: sk.id };
    }
    this.sketches.push(sk);
    this.version++;
    return sk;
  }

  // -- Decisions and styles ------------------------------------------------------

  /** The city adopts a tested design: it becomes a style that spreads from where it was tested. */
  adopt(trialId: number): AdoptedStyle | null {
    const t = this.trial(trialId);
    if (!t || t.state !== 'done' || !t.verdict || t.decision) return null;
    const city = this.city;
    const name = styleName(t.name);
    const b = city.buildings.get(t.buildingId);
    const street = (b && city.roads.segments.get(b.segId)?.name) || '';
    const m = city.style.adopt(t.concept.look, name, name.replace(/ style$/, ''), `${t.concept.description} ${t.verdict.summary}`);
    const st: AdoptedStyle = { id: m.id, trialId: t.id, name, x: t.x, z: t.z, street, day: city.clock.day, approval: t.verdict.approval, kinds: kindsFor(t.concept.use), push: 1, renovated: 0 };
    this.styles.push(st);
    this.styleById.set(st.id, st);
    t.decision = { kind: 'adopted', day: city.clock.day, styleId: st.id };
    city.people?.onAdopt(m);
    city.emitNotice({ severity: 'good', icon: 'build', title: `The ${name} is adopted`, text: `New buildings${street ? ` around ${street}` : ''} will start to follow it, and it will spread as people warm to it.`, x: t.x, z: t.z });
    city.events.emit('design', { type: 'trial', trial: t.id, what: 'adopted' });
    this.version++;
    return st;
  }

  /** Shelves a tested design; the prototype stays unless it is demolished too. */
  scrap(trialId: number, demolish = false): boolean {
    const t = this.trial(trialId);
    if (!t || t.state !== 'done' || t.decision) return false;
    t.decision = { kind: 'scrapped', day: this.city.clock.day };
    const sk = this.sketches.find((k) => k.id === t.sketchId);
    if (sk) sk.scrapped = true;
    this.city.people?.onScrap(t.name, t.verdict?.byGroup ?? {});
    if (demolish && t.buildingId) this.city.removeBuilding(t.buildingId, 'bulldoze');
    this.city.events.emit('design', { type: 'trial', trial: t.id, what: 'scrapped' });
    this.version++;
    return true;
  }

  style(id: number): AdoptedStyle | undefined {
    return this.styleById.get(id);
  }

  /** Encourage, discourage or retire a style (0 retired … 1.5 encouraged). */
  setPush(id: number, push: number): void {
    const st = this.styleById.get(id);
    if (!st) return;
    const before = st.push;
    st.push = Math.max(0, Math.min(1.5, push));
    const m = this.city.style.get(id);
    if (m) this.city.people?.onPush(m, before, st.push);
    this.updateWeights();
    this.version++;
  }

  /** Adopted styles a new building at a point might take up, with their chances. */
  spreadAt(x: number, z: number, kind: string): { id: number; chance: number }[] {
    if (!this.styles.length) return [];
    const day = this.city.clock.day;
    const out: { id: number; chance: number }[] = [];
    let total = 0;
    for (const st of this.styles) {
      if (!st.kinds.includes(kind)) continue;
      const c = localChance(st, Math.hypot(x - st.x, z - st.z), day);
      if (c <= 0) continue;
      out.push({ id: st.id, chance: c });
      total += c;
    }
    // Where styles overlap they share the street: never more than nine in ten new buildings.
    if (total > 0.9) for (const e of out) e.chance *= 0.9 / total;
    return out;
  }

  /** Whether a movement builds this kind of building (adopted styles keep to their own kinds). */
  buildsKind(movementId: number, kind: string): boolean {
    const st = this.styleById.get(movementId);
    return !st || (st.push > 0 && st.kinds.includes(kind));
  }

  /** Each style's share of new building across the city follows how far it has caught on. */
  private updateWeights(): void {
    const day = this.city.clock.day;
    const shares = this.styles.map((st) => globalShare(st, day));
    const total = Math.min(0.8, shares.reduce((a, b) => a + b, 0));
    this.styles.forEach((st, i) => this.city.style.setWeight(st.id, shares[i] > 0 ? shares[i] / Math.max(0.2, 1 - total) : 0));
  }

  /** Monthly: styles catch on, and owners near where they started renovate in them. */
  private monthlyStyles(): void {
    if (!this.styles.length) return;
    const city = this.city;
    const day = city.clock.day;
    this.updateWeights();
    for (const st of this.styles) {
      const due = renovationsDue(st);
      if (!due) continue;
      const reach = reachOf(st, day);
      const r = new Rng(hashStr(st.id, day, city.research.civSeed));
      const cands: { b: Building; d: number }[] = [];
      let inReach = 0, inStyle = 0;
      for (const b of city.buildings.queryRadius(st.x, st.z, reach)) {
        if (b.kind !== 'zoned' || b.typeId === 'proto' || !st.kinds.includes(b.style)) continue;
        const d = Math.hypot(b.cx - st.x, b.cz - st.z);
        if (d > reach) continue;
        inReach++;
        if (b.movement === st.id) {
          inStyle++;
          continue;
        }
        if (b.state !== BuildingState.Active || b.progress < 1 || b.age < 90) continue;
        cands.push({ b, d: d * (0.6 + 0.8 * r.next()) });
      }
      // Not everyone renovates: past its share of the neighbourhood, a style stops converting.
      const room = Math.max(0, Math.floor(saturation(st) * inReach) - inStyle);
      cands.sort((a, b) => a.d - b.d);
      const done = cands.slice(0, Math.min(due, room));
      for (const { b } of done) city.style.restyle(b, st.id);
      if (!done.length) continue;
      st.renovated += done.length;
      const seg = city.roads.segments.get(done[0].b.segId);
      city.emitNotice({ severity: 'info', icon: 'build', title: `The ${st.name} is spreading`, text: `${done.length} building${done.length > 1 ? 's' : ''}${seg?.name ? ` on ${seg.name}` : ''} ${done.length > 1 ? 'were' : 'was'} renovated in it. It now reaches about ${Math.round(reach / 10) * 10} m from where it began.`, x: done[0].b.cx, z: done[0].b.cz }, `style-${st.id}`, 24 * 55);
    }
    this.version++;
  }

  /** Buildings standing in each adopted style (and in none: the city's own way of building). */
  styleCounts(): Map<number, number> {
    const out = new Map<number, number>();
    for (const b of this.city.buildings.all.values()) {
      if (b.kind !== 'zoned' || b.typeId === 'proto') continue;
      const id = this.styleById.has(b.movement) ? b.movement : 0;
      out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
  }

  deleteSketch(id: string): void {
    this.sketches = this.sketches.filter((s) => s.id !== id);
    this.version++;
  }

  serialize(): DesignSave {
    return structuredClone({ v: 1 as const, learned: [...this.learned.entries()], sketches: this.sketches, counter: this.counter, trials: this.trials, trialCounter: this.trialCounter, styles: this.styles, storm: this.storm, powerShort: this.powerShort, smogMonths: this.smogMonths });
  }

  load(d: DesignSave | undefined): void {
    if (!d) {
      // Older cities: learn what their history already shows, without fanfare.
      this.daily(true);
      return;
    }
    const data = structuredClone(d);
    this.learned.clear();
    for (const [k, v] of data.learned) this.learned.set(k, v);
    this.sketches = data.sketches;
    this.counter = data.counter;
    this.trials = data.trials ?? [];
    this.trialCounter = data.trialCounter ?? this.trials.length + 1;
    this.styles = data.styles ?? [];
    this.styleById = new Map(this.styles.map((st) => [st.id, st]));
    this.storm = data.storm;
    this.powerShort = data.powerShort;
    this.smogMonths = data.smogMonths;
    this.version++;
  }
}

function natureCount(city: City): number {
  let n = 0;
  const a = city.nature.alive;
  for (let i = 0; i < city.nature.naturalCount; i += 7) n += a[i];
  return n * 7;
}
