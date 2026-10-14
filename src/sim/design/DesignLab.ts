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
  GRADE_LABEL, MAX_ACTIVE_TRIALS, type Reaction, type Speaker, type Trial, absorb, approvalOf, assess, capReactions, emptyScores, liveFactors, makeReaction, makeVerdict, openingScores, speaksToday, surveySite,
} from './Trials';

/** A design saved to the sketchbook. */
export interface Sketch {
  id: string;
  name: string;
  input: DesignInput;
  /** The design as it was compiled when saved (kept exactly, never regenerated). */
  concept: Concept;
  day: number;
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
    if (!quiet) this.dailyTrials();
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

  /** How residents' happiness is touched by living in a prototype (0 for other buildings). */
  moodBonus(b: Building): number {
    const t = b.typeId === 'proto' ? this.trialOf(b.id) : undefined;
    if (!t || t.openDay < 0) return 0;
    return t.scores.home * 10 + ((t.approval - 50) / 50) * 4;
  }

  /** A sketch has been built on a lot: its trial begins once construction ends. */
  startTrial(sketch: Sketch, b: Building, cost: number): Trial {
    const c = structuredClone(sketch.concept);
    const t: Trial = {
      id: this.trialCounter++, sketchId: sketch.id, name: sketch.name, concept: c, buildingId: b.id, x: b.cx, z: b.cz, cost,
      placedDay: this.city.clock.day, openDay: -1, months: c.ambition, state: 'building', site: null, factors: [], scores: emptyScores(), approval: 50, history: [], reactions: [],
    };
    t.site = surveySite(this.city, b, c.look.axes);
    t.factors = assess(c, t.site);
    this.trials.push(t);
    // Word gets around as soon as the hoardings go up.
    const r = new Rng(hashStr(t.id, 'plans', this.city.research.civSeed));
    const early = t.factors.filter((f) => f.aspect === 'neighbours' || f.aspect === 'looks');
    const re = makeReaction(t, early.length ? early : t.factors, r, this.city.clock.day, this.speaker(b), isResidential(b.zone));
    if (re) this.say(t, re, false);
    this.city.events.emit('design', { type: 'trial', trial: t.id, what: 'placed' });
    this.version++;
    return t;
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
        t.factors = assess(t.concept, t.site);
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
        const re = makeReaction(t, [...t.factors, ...liveFactors(b, day, t.openDay, city.landValue.pollutionAt(b.cx, b.cz), city.stats.happiness)], r, day, this.speaker(b), residential);
        if (re) this.say(t, re);
      }
      if (k > 0 && k % 30 === 0) {
        t.history.push(t.approval);
        const month = k / 30;
        if (month >= t.months) this.conclude(t, b, false);
        else {
          // The neighbourhood changes: look again.
          t.site = surveySite(city, b, t.concept.look.axes);
          t.factors = assess(t.concept, t.site);
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
    return `Verdict in ${Clock.monthLabel(Math.floor((t.verdict?.day ?? 0) / 30))}`;
  }

  /** Teaches an idea at once (for tests, scenarios and rewards). */
  learn(id: string, story = 'Learned.'): void {
    if (!IDEA_BY_ID.has(id) || this.learned.has(id)) return;
    this.learned.set(id, { day: this.city.clock.day, story });
    this.version++;
  }

  saveSketch(input: DesignInput, name?: string): Sketch {
    const concept = this.compile(input);
    if (name?.trim()) concept.name = name.trim().slice(0, 48);
    const sk: Sketch = { id: `s${this.counter++}`, name: concept.name, input: structuredClone(input), concept, day: this.city.clock.day };
    this.sketches.push(sk);
    this.version++;
    return sk;
  }

  deleteSketch(id: string): void {
    this.sketches = this.sketches.filter((s) => s.id !== id);
    this.version++;
  }

  serialize(): DesignSave {
    return structuredClone({ v: 1 as const, learned: [...this.learned.entries()], sketches: this.sketches, counter: this.counter, trials: this.trials, trialCounter: this.trialCounter, storm: this.storm, powerShort: this.powerShort, smogMonths: this.smogMonths });
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
