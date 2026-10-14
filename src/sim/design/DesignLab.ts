import type { City } from '../City';
import { SERVICE_BY_ID } from '../services/ServiceTypes';
import { BuildingState, Zone, isResidential, zoneBase } from '../types';
import { type CityFacts, IDEAS, IDEA_BY_ID } from './Ideas';
import { type Concept, type DesignContext, type DesignInput, compileConcept } from './Concept';

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
  version = 0;
  private counter = 1;
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
    let industrial = 0, offices = 0, commercial = 0, townhouses = 0, dense = 0, towers = 0, parks = 0, landmarks = 0, shoreHomes = 0, richHomes = 0, prototypes = 0;
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
        if (b.typeId.startsWith('proto-')) prototypes++;
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
    return out;
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
    return structuredClone({ v: 1 as const, learned: [...this.learned.entries()], sketches: this.sketches, counter: this.counter, storm: this.storm, powerShort: this.powerShort, smogMonths: this.smogMonths });
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
