import { formatInt, formatMoney } from '../../core/math';
import { isFreeway } from '../roads/RoadTypes';
import { Rng } from '../../core/rng';
import type { City } from '../City';
import { Clock } from '../Clock';
import { tourismIncome } from '../CitySim';
import type { TaxCategory } from '../economy/Economy';
import { POLICIES } from '../policies/Policies';
import { ACHIEVEMENTS } from '../progress/Achievements';
import { SCENARIO_BY_ID, homePollution } from '../progress/Scenarios';
import { SERVICE_BY_ID } from '../services/ServiceTypes';
import { BuildingState, Problem, isResidential } from '../types';

export type Tone = 'good' | 'bad' | 'neutral';

export interface Story {
  title: string;
  body: string;
  tone: Tone;
  x?: number;
  z?: number;
}

/** One monthly issue of the local paper. The first story is the headline. */
export interface Edition {
  /** Month index the edition reports on. */
  month: number;
  issue: number;
  paper: string;
  population: number;
  stories: Story[];
  topics: string[];
}

interface Snapshot {
  population: number;
  employed: number;
  workers: number;
  happiness: number;
  taxes: Record<TaxCategory, number>;
  riders: number;
  tourism: number;
  policies: string[];
}

export interface NewsSave {
  editions: Edition[];
  prev: Snapshot | null;
  issue: number;
}

interface Facts {
  firesLost: { street: string; x: number; z: number }[];
  firesSaved: number;
  opened: { id: string; x: number; z: number }[];
  weather: Set<'storm' | 'snow' | 'fog'>;
  tornado: { destroyed: number; damaged: number; x: number; z: number } | null;
  milestone: string | null;
  achievements: string[];
  scenario: { id: string; won: boolean } | null;
  /** Stories filed by other desks (prototype verdicts…). */
  filed: Candidate[];
}

interface Candidate extends Story {
  topic: string;
  score: number;
}

const KEEP = 12;
const STORIES = 4;
const TAX_LABEL: Record<TaxCategory, string> = { residential: 'residential', commercial: 'commercial', industrial: 'industrial', office: 'office' };
const pct = (v: number) => `${Math.round(v * 100)}%`;
const plural = (n: number, word: string) => `${formatInt(n)} ${word}${n === 1 ? '' : 's'}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const noFacts = (): Facts => ({ firesLost: [], firesSaved: 0, opened: [], weather: new Set(), tornado: null, milestone: null, achievements: [], scenario: null, filed: [] });

/**
 * The city's newspaper. Systems report notable events during the month; at
 * month end the desk compares the city with last month, ranks everything by
 * news value and prints a four-story edition.
 */
export class NewsDesk {
  editions: Edition[] = [];
  issue = 0;
  private prev: Snapshot | null = null;
  private facts = noFacts();

  constructor(private city: City) {
    city.events.on('milestone', (m) => (this.facts.milestone = m.title));
    city.events.on('achievement', (a) => this.facts.achievements.push(a.id));
    city.events.on('scenario', (r) => (this.facts.scenario = { id: r.id, won: r.result === 'won' }));
  }

  fireLost(street: string, x: number, z: number): void {
    this.facts.firesLost.push({ street, x, z });
  }

  fireSaved(): void {
    this.facts.firesSaved++;
  }

  opened(typeId: string, x: number, z: number): void {
    this.facts.opened.push({ id: typeId, x, z });
  }

  weather(kind: 'storm' | 'snow' | 'fog'): void {
    this.facts.weather.add(kind);
  }

  /** A story for this month's edition from elsewhere (the score ranks it against the rest). */
  file(topic: string, score: number, tone: Tone, title: string, body: string, at?: { x: number; z: number }): void {
    this.facts.filed.push({ topic, score, tone, title, body, ...(at ? { x: at.x, z: at.z } : {}) });
  }

  tornado(destroyed: number, damaged: number, x: number, z: number): void {
    this.facts.tornado = { destroyed, damaged, x, z };
  }

  /** The paper's masthead grows with the city. */
  static paperName(city: City): string {
    const p = city.stats.population;
    const kind = p < 2_000 ? 'Gazette' : p < 10_000 ? 'Courier' : p < 40_000 ? 'Herald' : 'Times';
    return `The ${city.name} ${kind}`;
  }

  private snapshot(): Snapshot {
    const c = this.city;
    return {
      population: c.stats.population,
      employed: c.stats.employed,
      workers: c.stats.workers,
      happiness: c.stats.happiness,
      taxes: { ...c.economy.taxes },
      riders: c.transit.totalRiders,
      tourism: tourismIncome(c),
      policies: [...c.policies.active],
    };
  }

  /** A named street, preferably one with homes on it. */
  private street(rng: Rng, homes = true): string | null {
    const c = this.city;
    const names: string[] = [];
    if (homes) {
      for (const b of c.buildings.all.values()) {
        if (b.kind !== 'zoned' || !isResidential(b.zone) || b.state !== BuildingState.Active) continue;
        const n = c.roads.segments.get(b.segId)?.name;
        if (n) names.push(n);
        if (names.length > 200) break;
      }
    }
    if (!names.length) for (const s of c.roads.segments.values()) if (!isFreeway(s.type) && s.name) names.push(s.name);
    return names.length ? rng.pick(names) : null;
  }

  private park(rng: Rng): string | null {
    const parks: string[] = [];
    for (const b of this.city.buildings.all.values()) {
      if (b.kind !== 'service' || b.state !== BuildingState.Active) continue;
      const st = SERVICE_BY_ID.get(b.typeId);
      if (st?.kind === 'park' && st.id !== 'pocket_park') parks.push(st.name);
    }
    return parks.length ? `the ${rng.pick(parks)}` : null;
  }

  /** Prints the edition for the month that just ended. */
  publish(): Edition {
    const c = this.city;
    const month = Math.max(0, c.clock.monthIndex - 1);
    const rng = new Rng((c.seed ^ Math.imul(month + 7, 0x9e3779b1)) >>> 0);
    const now = this.snapshot();
    const prev = this.prev;
    const f = this.facts;
    const n = c.name;
    const pop = now.population;
    const cands: Candidate[] = [];
    const add = (topic: string, score: number, tone: Tone, title: string, body: string, at?: { x: number; z: number }) =>
      cands.push({ topic, score, tone, title, body, ...(at ? { x: at.x, z: at.z } : {}) });

    // ── Reported events ──────────────────────────────────────────────────
    for (const s of f.filed) cands.push({ ...s });
    if (f.scenario) {
      const def = SCENARIO_BY_ID.get(f.scenario.id);
      if (def) {
        if (f.scenario.won) add('scenario', 100, 'good', 'Council celebrates: every target met', `The "${def.title}" plan is complete. Officials credit residents and planners alike.`);
        else add('scenario', 100, 'bad', 'Deadline passes with targets unmet', `Time has run out on the "${def.title}" plan. Critics call for a fresh start.`);
      }
    }
    if (f.tornado) {
      const t = f.tornado;
      if (t.destroyed || t.damaged) add('tornado', 92, 'bad', `Tornado tears through ${n}`, `The twister flattened ${plural(t.destroyed, 'building')} and damaged ${formatInt(t.damaged)} more before lifting off. Crews are clearing debris.`, t);
      else add('tornado', 60, 'neutral', 'Twister spares the city', 'A tornado touched down nearby but stayed clear of homes. Residents breathe a sigh of relief.', t);
    }
    if (f.milestone) add('milestone', 80, 'good', `${n} officially a ${f.milestone.toLowerCase()}`, `With ${formatInt(pop)} residents, ${n} has reached a new milestone, and bigger projects are now within reach.`);
    if (f.firesLost.length) {
      const k = f.firesLost.length, w = f.firesLost[0];
      if (k === 1) add('fire', 56, 'bad', `Fire destroys building on ${w.street}`, 'Firefighters could not save it. Neighbours are calling for better fire cover.', w);
      else add('fire', 50 + 8 * k, 'bad', `${plural(k, 'building')} lost to fire`, `The worst blaze was on ${w.street}. Residents are calling for more fire stations.`, w);
    } else if (f.firesSaved) {
      add('fire', 20, 'good', `Firefighters save ${f.firesSaved === 1 ? 'a building' : plural(f.firesSaved, 'building')}`, 'Quick work by the crews kept the flames from spreading.');
    }
    const openedByKind = new Map<string, { id: string; x: number; z: number }>();
    for (const o of f.opened) {
      const st = SERVICE_BY_ID.get(o.id);
      if (st && !openedByKind.has(st.kind)) openedByKind.set(st.kind, o);
    }
    for (const [kind, o] of openedByKind) {
      const st = SERVICE_BY_ID.get(o.id)!;
      if (o.id === 'airport') add('open-airport', 66, 'good', 'First flights take off', `The ${st.name} is open. Travellers, freight and tourists can now fly straight into ${n}.`, o);
      else if (kind === 'landmark') add(`open-${kind}`, 62, 'good', `${st.name} opens its doors`, 'Crowds gathered for the ribbon cutting. Officials expect more visitors and a lift for the neighbourhood.', o);
      else if (o.id === 'metro_station') add('open-metro', 40, 'good', 'Metro station opens', 'Commuters have a fast new way under the traffic.', o);
      else if (kind === 'health') add(`open-${kind}`, 36, 'good', `New ${st.name.toLowerCase()} opens`, 'Residents nearby no longer have to travel far for care.', o);
      else if (o.id === 'cargo_port') add('open-port', 56, 'good', 'First freighter docks at the new harbour', `Cranes unloaded the first containers this week. Manufacturers say shipping by sea will open new markets for ${n}.`, o);
      else if (o.id === 'university') add('open-university', 58, 'good', 'University opens its gates', `The first students moved into halls this week, and employers are already eyeing the graduates.`, o);
      else if (kind === 'education') add(`open-${kind}`, 34, 'good', `${st.name} welcomes its first pupils`, 'Parents say the new school is a big reason to stay.', o);
      else if (kind === 'police') add(`open-${kind}`, 30, 'good', 'New police station opens', 'Officers will patrol the surrounding streets day and night.', o);
      else if (kind === 'fire') add(`open-${kind}`, 30, 'good', 'Fire station ready for action', 'The crew says it is ready for the first call.', o);
      else if (kind === 'park') add(`open-${kind}`, st.id === 'pocket_park' ? 14 : 30, 'good', `${st.name} opens`, 'Families were quick to try out the new green space.', o);
      else if (kind === 'transit') add(`open-${kind}`, 32, 'good', `${st.name} opens`, 'Buses will soon fan out across the city.', o);
    }
    if (f.weather.has('storm')) add('weather', 18, 'neutral', `Storms batter ${n}`, 'Heavy rain and lightning slowed traffic and kept residents indoors.');
    else if (f.weather.has('snow')) add('weather', 18, 'neutral', `Snow blankets ${n}`, 'Children built snowmen while drivers took it slowly.');
    else if (f.weather.has('fog')) add('weather', 8, 'neutral', 'Fog rolls in', 'Thick morning fog slowed commuters.');
    for (const id of f.achievements.slice(0, 1)) {
      const a = ACHIEVEMENTS.find((x) => x.id === id);
      if (a) add('achievement', 26, 'good', `${n} earns recognition: "${a.title}"`, a.description);
    }

    // ── Problems in homes (the usual reasons people leave) ──────────────
    const probs = { power: 0, water: 0, sewage: 0, garbage: 0, sick: 0, crime: 0 };
    const where: Partial<Record<keyof typeof probs, { x: number; z: number; street?: string }>> = {};
    let homes = 0;
    for (const b of c.buildings.all.values()) {
      if (b.kind !== 'zoned' || !isResidential(b.zone) || b.state !== BuildingState.Active) continue;
      homes++;
      const p = b.problems;
      const mark = (k: keyof typeof probs, bit: number) => {
        if (!(p & bit)) return;
        probs[k]++;
        where[k] ??= { x: b.cx, z: b.cz, street: c.roads.segments.get(b.segId)?.name };
      };
      mark('power', Problem.NoPower);
      mark('water', Problem.NoWater);
      mark('sewage', Problem.NoSewage);
      mark('garbage', Problem.Garbage);
      mark('sick', Problem.Sickness);
      mark('crime', Problem.Crime);
    }
    const share = (k: keyof typeof probs) => (homes >= 10 ? probs[k] / homes : 0);
    if (share('power') > 0.1) add('utilities', 64, 'bad', `Blackouts hit ${n}`, `${pct(share('power'))} of homes are without power. The grid needs more capacity.`, where.power);
    else if (share('water') > 0.1) add('utilities', 62, 'bad', 'Taps run dry', `${pct(share('water'))} of homes have no running water. Residents want more pumping capacity.`, where.water);
    else if (share('sewage') > 0.1) add('utilities', 52, 'bad', 'Sewers back up', `${pct(share('sewage'))} of homes are not connected to working sewers.`, where.sewage);
    if (share('garbage') > 0.25) add('garbage', 44, 'bad', `Rubbish piles up${where.garbage?.street ? ` on ${where.garbage.street}` : ''}`, `Bins are overflowing across ${n}. Residents want a landfill or a recycling centre.`, where.garbage);
    if (share('sick') > 0.3) add('health', 40, 'bad', 'Families struggle to see a doctor', 'Many neighbourhoods are far from a clinic, and residents say they have to travel too far for care.', where.sick);
    if (share('crime') > 0.3) add('crime', 42, 'bad', 'Crime worries residents', `Break-ins are up in neighbourhoods without police patrols${where.crime?.street ? `, including ${where.crime.street}` : ''}.`, where.crime);
    const complaint = share('power') > 0.1 ? 'power cuts' : share('water') > 0.1 ? 'dry taps' : share('garbage') > 0.25 ? 'uncollected rubbish' : share('sick') > 0.3 ? 'a lack of doctors' : share('crime') > 0.3 ? 'crime' : '';

    // ── Month-on-month changes ───────────────────────────────────────────
    if (prev) {
      const d = pop - prev.population;
      const grow = d / Math.max(1, prev.population);
      if (d >= 100 && grow >= 0.12) {
        const st = this.street(rng);
        add('population', 55 + Math.min(25, grow * 60), 'good', rng.pick([`${n} is booming`, `${formatInt(d)} newcomers in a month`, 'Moving vans everywhere']), `The population rose ${pct(grow)} to ${formatInt(pop)}.${st ? ` New arrivals say ${st} is the place to be.` : ''}`);
      } else if (d < 0 && -d >= Math.max(50, prev.population * 0.04)) {
        const u = now.workers ? 1 - now.employed / now.workers : 0;
        const why = u > 0.1 ? ' as jobs grow scarce' : complaint ? `. Those leaving blame ${complaint}` : now.happiness < 50 ? ', unhappy with life in the city' : '';
        add('population', 70, 'bad', `Residents are leaving ${n}`, `The population fell by ${formatInt(-d)} to ${formatInt(pop)}${why}.`);
      }
      const dh = now.happiness - prev.happiness;
      const h = Math.round(now.happiness), dhr = Math.round(Math.abs(dh));
      if (pop > 200 && dh >= 5) {
        if (now.happiness >= 60) add('mood', 32 + dh, 'good', 'Residents in good spirits', `A survey finds approval up ${dhr} points to ${h}%.`);
        else add('mood', 28 + dh, 'neutral', 'Mood lifts a little', `Approval rose ${dhr} points to ${h}%, though many residents are still unhappy.`);
      } else if (pop > 200 && dh <= -5) {
        if (now.happiness < 45) add('mood', 38 - dh, 'bad', `Discontent grows across ${n}`, `Approval fell ${dhr} points to ${h}%. The council is under pressure to respond.`);
        else add('mood', 30 - dh, 'bad', 'Approval slips', `A survey puts approval at ${h}%, down ${dhr} points on last month.`);
      }

      let tax: { cat: TaxCategory; diff: number } | null = null;
      for (const cat of Object.keys(now.taxes) as TaxCategory[]) {
        const diff = now.taxes[cat] - prev.taxes[cat];
        if (diff && (!tax || Math.abs(diff) > Math.abs(tax.diff))) tax = { cat, diff };
      }
      if (tax) {
        const r = now.taxes[tax.cat], label = TAX_LABEL[tax.cat];
        if (tax.diff > 0) {
          const why = { residential: 'Homeowners face higher bills from next month.', commercial: 'Shopkeepers warn that prices may rise.', industrial: 'Factory owners say the rise could slow expansion.', office: 'Firms are weighing the extra cost against the skilled workforce.' }[tax.cat];
          add('tax', 44 + tax.diff * 3, 'bad', `Council raises ${label} tax to ${r}%`, why);
        } else {
          const why = { residential: 'Households welcome the relief, though some worry about services.', commercial: 'Retailers welcome the cut and promise to hire.', industrial: 'Industry groups praise the move.', office: `Developers say the cut makes ${n} more competitive.` }[tax.cat];
          add('tax', 40 - tax.diff * 2, 'good', `${cap(label)} tax cut to ${r}%`, why);
        }
      }

      const enacted = now.policies.filter((p) => !prev.policies.includes(p));
      const repealed = prev.policies.filter((p) => !now.policies.includes(p));
      const pol = (id: string) => POLICIES.find((p) => p.id === id);
      if (enacted.length && pol(enacted[0])) add('policy', 42, 'neutral', `Council passes ${pol(enacted[0])!.name}`, pol(enacted[0])!.description);
      else if (repealed.length && pol(repealed[0])) add('policy', 30, 'neutral', `${pol(repealed[0])!.name} repealed`, 'The council voted to end the programme.');

      if (prev.riders >= 100 && now.riders > prev.riders * 1.25) add('transit', 32, 'good', 'Ridership soars', `Public transit now carries ${formatInt(now.riders)} trips a day, up ${pct(now.riders / prev.riders - 1)} on last month.`);
      else if (prev.riders < 20 && now.riders >= 50) add('transit', 38, 'good', 'First passengers on board', `${formatInt(now.riders)} trips a day already. Commuters say it beats sitting in traffic.`);

      if (now.tourism > 500 && now.tourism > prev.tourism * 1.2 + 200) add('tourism', 33, 'good', `Visitors flock to ${n}`, `Tourism now brings in ${formatMoney(now.tourism)} a month. Hotels and restaurants report a busy season.`);
    }

    // ── Standing conditions ──────────────────────────────────────────────
    const u = now.workers ? 1 - now.employed / now.workers : 0;
    if (u > 0.12 && now.workers > 150) add('jobs', 48 + u * 100, 'bad', `Jobless rate climbs to ${pct(u)}`, 'Job seekers outnumber openings. Business leaders urge the council to zone land for shops, offices and industry.');
    else if (u < 0.03 && now.workers > 400) add('jobs', 22, 'good', 'Help wanted signs everywhere', 'Almost everyone who wants a job has one, and employers are struggling to fill vacancies.');

    const e = c.economy;
    if (!e.unlimited) {
      if (e.money < 0) add('budget', 66, 'bad', `${n} slips into the red`, `The treasury is overdrawn by ${formatMoney(-e.money)}. Auditors urge higher taxes or spending cuts.`);
      else if (e.projectedNet < -2_000) add('budget', 40, 'bad', 'Spending outpaces income', `The budget is short ${formatMoney(-e.projectedNet)} a month. Reserves stand at ${formatMoney(e.money)}.`);
      else if (e.projectedNet >= 5_000 && pop > 300) add('budget', 20, 'good', `Budget surplus of ${formatMoney(e.projectedNet)} a month`, 'The treasurer reports healthy finances, with income comfortably ahead of spending.');
    }

    let worst: { name: string; ratio: number; x: number; z: number } | null = null;
    for (const s of c.roads.segments.values()) {
      if (isFreeway(s.type) || !s.name || s.length < 40) continue;
      const r = c.traffic.ratio(s.id);
      if (r > 0.95 && (!worst || r > worst.ratio)) {
        const k = s.poly.count >> 1;
        worst = { name: s.name, ratio: r, x: s.poly.pts[k * 2], z: s.poly.pts[k * 2 + 1] };
      }
    }
    if (worst) add('traffic', 30 + Math.min(30, (worst.ratio - 0.95) * 40), 'bad', rng.pick([`Gridlock on ${worst.name}`, `Commuters crawl along ${worst.name}`]), 'Drivers report long queues at rush hour. Planners suggest wider roads, another route or better transit.', worst);

    const smog = pop > 500 ? homePollution(c) : 0;
    if (smog > 0.25) add('pollution', 30 + smog * 60, 'bad', 'Smog complaints pile up', 'Residents near industry say the air is getting worse. Health groups call for buffers of parks and trees.');

    const dem = c.demand.value;
    if (pop > 100 && dem.residential > 85) add('housing', 26, 'neutral', 'Housing shortage pushes up rents', 'Would-be residents are waiting for homes. Developers want more land zoned for housing.');
    else if (pop > 300 && dem.commercial > 80) add('shops', 22, 'neutral', 'Residents want more shops', 'Shoppers say they have to drive too far for groceries.');

    // Readers tire of the same story: last month's topics lose news value.
    const last = new Set(this.editions[0]?.topics ?? []);
    for (const cd of cands) if (last.has(cd.topic)) cd.score -= 22;
    cands.sort((a, b) => b.score - a.score);
    const picked: Candidate[] = [];
    for (const cd of cands) {
      if (picked.length >= STORIES) break;
      if (cd.score > 0 && !picked.some((p) => p.topic === cd.topic)) picked.push(cd);
    }
    for (const fe of this.features(rng, month)) {
      if (picked.length >= STORIES) break;
      picked.push(fe);
    }
    const ed: Edition = {
      month,
      issue: ++this.issue,
      paper: NewsDesk.paperName(c),
      population: pop,
      stories: picked.map(({ topic: _t, score: _s, ...s }) => s),
      topics: picked.map((p) => p.topic),
    };
    this.editions.unshift(ed);
    if (this.editions.length > KEEP) this.editions.length = KEEP;
    this.prev = now;
    this.facts = noFacts();
    c.events.emit('news', ed);
    return ed;
  }

  /** Light features for quiet months, in season. */
  private features(rng: Rng, month: number): Candidate[] {
    const n = this.city.name;
    const park = this.park(rng) ?? 'the town square';
    const street = this.street(rng, false) ?? 'Main Street';
    const water = this.city.preset === 'coastal' ? 'the beach' : this.city.preset === 'river' ? 'the riverbank' : 'the lakes';
    const seasonal: [string, string][][] = [
      [['Winter sales draw shoppers', 'Stores report their busiest week since the holidays.'], ['Residents vow to walk more in the new year', 'Gyms are full, for now.']],
      [['Valentine dinners book out restaurants', `Florists on ${street} ran out of roses by noon.`]],
      [['Spring clean-up day', `Volunteers collected bags of litter around ${park}.`]],
      [['Blossom season brings out the walkers', `The trees around ${park} are in full bloom.`]],
      [["Farmers' market returns", `Stalls lined ${street} with early vegetables and fresh bread.`]],
      [['Summer festival fills the streets', `Music played late into the night at ${park}.`]],
      [['Heat wave sends residents outdoors', `Crowds packed ${water} to cool off.`]],
      [['Outdoor cinema nights are a hit', `Hundreds brought blankets to ${park} for a film under the stars.`]],
      [['Back to school', 'Crossing guards are back on duty, and drivers are asked to slow down near schools.']],
      [['Pumpkin contest draws a crowd', `Carvers lined ${street} with glowing lanterns.`]],
      [['Leaf collection begins', `Crews are clearing the streets around ${park}.`]],
      [['Holiday lights go up', `Shopkeepers on ${street} are competing for the brightest window.`]],
    ];
    const always: [string, string][] = [
      ['Local bakery wins a regional prize', `The winning loaf is already selling out on ${street}.`],
      ['Library extends opening hours', 'Readers can now borrow books until nine every evening.'],
      ['Lost dog finds its way home', `A friendly terrier was returned to its family on ${street}.`],
      ['Chess club seeks new members', `The club meets every Thursday near ${park}.`],
      ['Letters: the best view in town', `Readers argue over the finest spot to watch the sun set over ${n}.`],
      ['Amateur astronomers count shooting stars', `Clear skies over ${park} made for a record night.`],
      ['Community choir gives its first concert', `The choir sang to a full house near ${park}.`],
      ['Cyclists call for more bike lanes', `Riders say ${street} is the busiest route into town.`],
      ['Local team wins the derby', 'Fans celebrated in the streets until late.'],
      ['Neighbours start a tool library', `Residents on ${street} now share ladders, drills and lawnmowers.`],
      ['Crossword champion crowned', 'The winner finished the final puzzle in under four minutes.'],
      ['Ducklings stop traffic', `Drivers on ${street} waited patiently while a family of ducks crossed.`],
      ['Artists open their studios', `Visitors toured workshops and galleries across ${n}.`],
      ['Historical society seeks old photos', `Residents are asked to share pictures of early ${n}.`],
      ['Pet show draws record entries', `A tortoise named Pebbles took best in show at ${park}.`],
      ['Recipe of the month: apple crumble', 'A reader shares a family favourite that never lasts long.'],
    ];
    const moy = Clock.monthOfYear(month);
    // Features don't run twice within half a year.
    const recent = new Set(this.editions.slice(0, 6).flatMap((e) => e.topics));
    const fresh = (s: [string, string]) => !recent.has(`feature-${s[0]}`);
    let pool = [...seasonal[moy].filter(fresh).map((s) => ({ s, w: 3 })), ...always.filter(fresh).map((s) => ({ s, w: 1 }))];
    if (pool.length < STORIES) pool = [...seasonal[moy].map((s) => ({ s, w: 3 })), ...always.map((s) => ({ s, w: 1 }))];
    const out: Candidate[] = [];
    while (pool.length && out.length < STORIES) {
      let r = rng.next() * pool.reduce((a, p) => a + p.w, 0);
      let i = 0;
      while (i < pool.length - 1 && (r -= pool[i].w) > 0) i++;
      const [title, body] = pool.splice(i, 1)[0].s;
      out.push({ topic: `feature-${title}`, score: 1, tone: 'neutral', title, body });
    }
    return out;
  }

  serialize(): NewsSave {
    return { editions: this.editions.map((e) => ({ ...e, stories: e.stories.map((s) => ({ ...s })), topics: [...e.topics] })), prev: this.prev ? { ...this.prev, taxes: { ...this.prev.taxes }, policies: [...this.prev.policies] } : null, issue: this.issue };
  }

  load(s: NewsSave | undefined): void {
    if (!s) return;
    this.editions = s.editions.map((e) => ({ ...e, stories: e.stories.map((x) => ({ ...x })), topics: [...(e.topics ?? [])] }));
    this.prev = s.prev ? { ...s.prev, taxes: { ...s.prev.taxes }, policies: [...s.prev.policies] } : null;
    this.issue = s.issue;
  }
}
