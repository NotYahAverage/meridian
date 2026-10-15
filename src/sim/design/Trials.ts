import { clamp } from '../../core/math';
import { type Rng, hash01 } from '../../core/rng';
import { type ZonedStyle, capacityFor } from '../buildings/Archetypes';
import type { Building } from '../buildings/Buildings';
import type { City } from '../City';
import type { Axes, FeatureId } from '../style/Movements';
import { Problem, Zone, isResidential } from '../types';
import type { Concept } from './Concept';
import type { GroupId } from './Tastes';

/**
 * Prototype trials: a design from the sketchbook built on a real lot and
 * lived in for one to five months. Residents, neighbours, passers-by, shop
 * owners and critics react to what the building actually is (its materials,
 * gardens, height against its neighbours, how it meets the street, what it
 * costs) and to how life there turns out. Their reactions move an approval
 * meter, and at the end the trial gives its verdict.
 */

export type AspectId = 'home' | 'street' | 'looks' | 'green' | 'cost' | 'neighbours';

export interface AspectDef {
  id: AspectId;
  name: string;
  /** Name for offices and shops. */
  work?: string;
  icon: string;
  weight: number;
}

export const ASPECTS: AspectDef[] = [
  { id: 'home', name: 'Living there', work: 'Working there', icon: 'home', weight: 0.26 },
  { id: 'looks', name: 'Looks', icon: 'brush', weight: 0.2 },
  { id: 'street', name: 'The street', icon: 'shop', weight: 0.14 },
  { id: 'neighbours', name: 'Neighbours', icon: 'people', weight: 0.14 },
  { id: 'cost', name: 'Value', icon: 'money', weight: 0.14 },
  { id: 'green', name: 'Green', icon: 'tree', weight: 0.12 },
];
export const ASPECT_BY_ID = new Map(ASPECTS.map((a) => [a.id, a]));

export type Voice = 'resident' | 'worker' | 'neighbour' | 'passer' | 'shop' | 'critic' | 'green' | 'agent';

export interface Reaction {
  day: number;
  /** Testing month it belongs to (0 while it is being built or opened). */
  month: number;
  who: string;
  voice: Voice;
  text: string;
  /** −1 (furious) … 1 (delighted). */
  mood: number;
  aspect: AspectId;
  /** What it was about (a factor key). */
  key: string;
  /** The taste group the speaker belongs to (none for the paper's critic). */
  group?: GroupId;
  /** Not the design's fault (power cuts, smog…): it counts for little. */
  blame?: 'city';
}

/** Something about the building or its site that people react to. */
export interface Factor {
  key: string;
  aspect: AspectId;
  /** How it lands on average, −1 … 1. */
  w: number;
  /** How much opinions differ (bold choices divide people). */
  spread?: number;
  blame?: 'city';
}

/** What surrounds the lot. */
export interface Site {
  lv: number;
  pollution: number;
  noise: number;
  park: number;
  /** Average storeys of the buildings around it (1 on open land). */
  nearFloors: number;
  nearCount: number;
  shore: boolean;
  /** How close the design is to the way the city already builds, 0–1. */
  familiarity: number;
}

export type Grade = 'loved' | 'liked' | 'mixed' | 'disliked' | 'hated';

export interface Verdict {
  day: number;
  approval: number;
  grade: Grade;
  best: AspectId[];
  worst: AspectId[];
  summary: string;
  advice: string[];
  /** The warmest and the harshest thing said about it. */
  quotes: Reaction[];
  /** Everyone moved out before the trial ended. */
  abandoned?: boolean;
  /** The building was lost (fire, demolition) part-way through. */
  cutShort?: boolean;
  /** Approval within each taste group. */
  byGroup?: Partial<Record<GroupId, number>>;
}

/** A taste group as a pool of speakers: how many of them there are and what they feel strongly about. */
export interface Voices {
  id: GroupId;
  share: number;
  keys: Record<string, number>;
}

/** Voices that belong to one group whatever the speaker's taste. */
const VOICE_GROUP: Partial<Record<Voice, GroupId>> = { green: 'green', agent: 'business', shop: 'business' };

export type TrialState = 'building' | 'testing' | 'done' | 'gone';

export interface Trial {
  id: number;
  sketchId: string;
  name: string;
  /** The design exactly as it was built. */
  concept: Concept;
  buildingId: number;
  x: number;
  z: number;
  cost: number;
  placedDay: number;
  /** Day the building opened (−1 while it is being built). */
  openDay: number;
  /** Testing months (1–5). */
  months: number;
  state: TrialState;
  site: Site | null;
  factors: Factor[];
  /** Running opinion of each aspect, −1 … 1. */
  scores: Record<AspectId, number>;
  /** 0–100. */
  approval: number;
  /** Approval at the end of each month. */
  history: number[];
  reactions: Reaction[];
  verdict?: Verdict;
  /** What the player did with the verdict. */
  decision?: Decision;
  /** The trial this one revises. */
  parent?: number;
}

export interface Decision {
  kind: 'adopted' | 'refined' | 'scrapped';
  day: number;
  /** Adopted: the style's movement id. */
  styleId?: number;
  /** Refined: the revised sketch. */
  sketchId?: string;
}

export const GRADE_LABEL: Record<Grade, string> = { loved: 'Loved', liked: 'Liked', mixed: 'Mixed feelings', disliked: 'Disliked', hated: 'Hated' };
export const MAX_ACTIVE_TRIALS = 3;
const MAX_REACTIONS = 60;

// ── What it is and what it costs ────────────────────────────────────────────

export interface ProtoSpec {
  zone: Zone;
  style: ZonedStyle;
  households: number;
  jobs: number;
  cost: number;
  buildDays: number;
}

/** How a concept lives in the city: its zone, homes, jobs, build time and price. */
export function protoSpec(c: Concept): ProtoSpec {
  const { w, d, floors, level } = c;
  const style = c.kind as ZonedStyle;
  const shopJobs = () => Math.max(4, Math.round(capacityFor('shop', w, d, 1, level).jobs * (w / 20)));
  let zone = Zone.ResMed, households = 0, jobs = 0;
  switch (c.kind) {
    case 'house':
      zone = Zone.ResLow;
      households = 1;
      break;
    case 'townhouse':
    case 'lowrise':
      households = capacityFor(style, w, d, floors, level).households;
      break;
    case 'midrise':
      zone = floors >= 6 ? Zone.ResHigh : Zone.ResMed;
      households = capacityFor('midrise', w, d, floors, level).households;
      break;
    case 'tower':
      zone = Zone.ResHigh;
      households = capacityFor('tower', w, d, floors, level).households;
      if (c.use === 'mixed') jobs = shopJobs();
      break;
    case 'mixeduse':
      zone = floors >= 6 ? Zone.ResHigh : Zone.ResMed;
      households = capacityFor('lowrise', w, d, Math.max(1, floors - 1), level).households;
      jobs = shopJobs();
      break;
    case 'shop':
      zone = Zone.Commercial;
      jobs = capacityFor('shop', w, d, floors, level).jobs;
      break;
    case 'office':
    case 'officeTower':
      zone = Zone.Office;
      jobs = capacityFor(style, w, d, floors, level).jobs;
      break;
  }
  const lvl = [0, 0.85, 1, 1.4][Math.max(1, Math.min(3, level))];
  const extras = 1 + 0.08 * c.look.features.length + (c.look.massing !== 'block' ? 0.12 : 0);
  // A one-off is dearer than a building from a familiar pattern.
  const cost = Math.round(((12_000 + households * 2_200 + jobs * 900) * lvl * extras * 1.15) / 500) * 500;
  return { zone, style, households, jobs, cost, buildDays: 2 + Math.min(20, floors * 0.8 + (w * d) / 500) };
}

// ── The site ────────────────────────────────────────────────────────────────

export function surveySite(city: City, b: Building, look: Axes): Site {
  const lvm = city.landValue;
  let floors = 0, n = 0;
  for (const o of city.buildings.queryRadius(b.cx, b.cz, 80)) {
    if (o.id === b.id || o.kind !== 'zoned') continue;
    floors += o.floors;
    n++;
  }
  // The city's own way of building: its blend of movements, weighted.
  const ax: Axes = { green: 0, heavy: 0, ornate: 0, dense: 0, hand: 0 };
  for (const { movement, share } of city.style.blend()) for (const k of Object.keys(ax) as (keyof Axes)[]) ax[k] += movement.axes[k] * share;
  let dist = 0;
  for (const k of Object.keys(ax) as (keyof Axes)[]) dist += (ax[k] - look[k]) ** 2;
  return {
    lv: lvm.at(b.cx, b.cz),
    pollution: lvm.pollutionAt(b.cx, b.cz),
    noise: lvm.noiseAt(b.cx, b.cz),
    park: city.coverage.at('park', b.cx, b.cz),
    nearFloors: n ? floors / n : 1,
    nearCount: n,
    shore: city.terrain.shoreDistanceAt(b.cx, b.cz) < 120,
    familiarity: clamp(1 - Math.sqrt(dist) / 2.4, 0, 1),
  };
}

// ── What people react to ────────────────────────────────────────────────────

const GREEN_FEATURES: FeatureId[] = ['planters', 'greenRoof', 'roofGarden', 'skyGarden', 'terraces', 'solarSkin', 'windCrown', 'courtyard'];

/** Everything about the design and its site that people will have an opinion on. */
export function assess(c: Concept, s: Site): Factor[] {
  const out: Factor[] = [];
  const f = new Set(c.look.features);
  const add = (key: string, aspect: AspectId, w: number, spread = 0.15) => out.push({ key, aspect, w, spread });
  const homes = c.use === 'homes' || c.use === 'mixed';
  const tall = c.kind === 'tower' || c.kind === 'officeTower';
  const dense = tall || c.kind === 'midrise' || c.floors >= 5;
  const shops = c.use === 'mixed' || c.use === 'shops';
  // Living (or working) there.
  if (f.has('balconies')) add('balconies', 'home', 0.25);
  if (f.has('planters')) add('planters', 'home', 0.3, 0.2);
  if (f.has('loggias')) add('loggias', 'home', 0.25);
  if (f.has('roofGarden')) add('roofGarden', 'home', 0.22);
  if (f.has('terraces') || c.look.massing === 'terraced') add('terraces', 'home', 0.3);
  if (f.has('courtyard') || c.look.massing === 'courtyard') add('courtyard', 'home', 0.3);
  if (f.has('skyGarden')) add('skyGarden', 'home', 0.25);
  if (c.kind === 'house') add('space', 'home', 0.3);
  if (tall && homes) add('lifts', 'home', -0.12, 0.3);
  if (tall && (s.shore || c.floors >= 18)) add('view', 'home', 0.25);
  if (c.level === 1 && dense && !f.has('balconies') && !f.has('loggias') && !f.has('planters')) add('cramped', 'home', -0.25, 0.2);
  if (c.level === 3) add('luxuryHome', 'home', 0.3);
  const win = c.look.windows[0];
  if (c.look.wall === 'glass' || win === 3 || win === 6) add('light', 'home', 0.18);
  else if (win === 7 || win === 4) add('dark', 'home', -0.12, 0.2);
  if (s.park > 0.4) add('park', 'home', 0.2);
  if (s.noise > 0.45) add('noise', 'home', -0.25);
  // The street.
  if (shops) add('shopsBelow', 'street', 0.35);
  if (f.has('arcade')) add('arcade', 'street', 0.35);
  if (f.has('pilotis')) add('pilotis', 'street', 0.08, 0.4);
  if (!shops && !f.has('arcade') && (tall || c.kind === 'office')) add('blankBase', 'street', -0.15);
  if (f.has('ornament')) add('doorway', 'street', 0.15);
  if (f.has('monumental')) add('monumental', 'street', 0.05, 0.45);
  if (f.has('cantilever')) add('cantilever', 'street', 0.05, 0.4);
  // Looks.
  const WALL: Record<string, [number, number]> = { brick: [0.15, 0.15], stone: [0.2, 0.15], timber: [0.15, 0.3], beton: [-0.1, 0.55], glass: [0, 0.4], panel: [-0.2, 0.3], render: [0.05, 0.15], siding: [0.1, 0.2] };
  const [ww, ws] = WALL[c.look.wall] ?? [0, 0.2];
  add(`wall-${c.look.wall}`, 'looks', ww, ws);
  if (f.has('ornament')) add('ornament', 'looks', 0.25, 0.2);
  if (c.chips.some((x) => x.category === 'colour')) add('colour', 'looks', 0.1, 0.35);
  if (s.familiarity > 0.7) add('familiar', 'looks', 0.15);
  else if (s.familiarity < 0.45) add('novel', 'looks', -0.05, 0.25 + 0.08 * c.ambition);
  if (c.look.roof === 'butterfly' || c.look.roof === 'vault' || c.look.roof === 'mansard') add(`roof-${c.look.roof}`, 'looks', 0.1, 0.35);
  if (c.look.massing === 'stacked') add('stacked', 'looks', 0, 0.55);
  if (f.has('terraces') || c.look.massing === 'terraced') add('terraceLooks', 'looks', 0.2);
  // Green.
  if (f.has('planters')) add('planters', 'green', 0.4);
  if (f.has('greenRoof') || c.look.roof === 'green') add('greenRoof', 'green', 0.35);
  if (f.has('roofGarden')) add('roofGarden', 'green', 0.3);
  if (f.has('skyGarden')) add('skyGarden', 'green', 0.35);
  if (f.has('solarSkin')) add('solar', 'green', 0.35);
  if (f.has('windCrown')) add('wind', 'green', 0.3);
  if (f.has('briseSoleil')) add('brise', 'green', 0.2);
  if (c.look.wall === 'timber') add('timberCarbon', 'green', 0.2);
  if (c.look.wall === 'beton') add('concreteCarbon', 'green', -0.15, 0.2);
  if (c.look.wall === 'glass') add('glassHeat', 'green', -0.12, 0.2);
  if (dense && !GREEN_FEATURES.some((g) => f.has(g)) && c.look.roof !== 'green') add('noGreen', 'green', -0.22);
  // Value.
  if (c.level === 1) add('budget', 'cost', 0.35, 0.25);
  if (c.level === 3) add('luxury', 'cost', s.lv >= 0.6 ? 0.15 : s.lv < 0.45 ? -0.35 : -0.1, 0.25);
  if (c.look.features.length >= 4) add('pricey', 'cost', -0.15);
  if (c.look.wall === 'panel') add('quickBuild', 'cost', 0.15);
  // Neighbours.
  const ratio = c.floors / Math.max(1, s.nearFloors);
  if (s.nearCount >= 2 && c.floors >= 5 && ratio >= 2.5) add('overshadow', 'neighbours', -clamp(0.12 * (ratio - 1.5), 0.15, 0.5), 0.2);
  else if (s.nearCount >= 2 && ratio >= 0.5 && ratio <= 1.7) add('fitsIn', 'neighbours', 0.15);
  if (homes && dense && s.nearFloors < 3 && s.nearCount >= 2) add('crowding', 'neighbours', -0.15, 0.25);
  if (GREEN_FEATURES.some((g) => f.has(g) && g !== 'solarSkin' && g !== 'windCrown')) add('greenStreet', 'neighbours', 0.15);
  if (f.has('windCrown')) add('hum', 'neighbours', -0.2, 0.25);
  if (f.has('ornament')) add('tone', 'neighbours', 0.1);
  if (s.familiarity < 0.4) add('clash', 'neighbours', -0.1, 0.3);
  return out;
}

/** The things people complained about most in a trial, most first. */
export function complaints(t: Trial): { key: string; aspect: AspectId }[] {
  const n = new Map<string, { key: string; aspect: AspectId; count: number }>();
  for (const re of t.reactions) {
    if (re.mood >= -0.1 || re.blame || re.month === 0 || re.key === 'ignored') continue;
    const e = n.get(re.key) ?? { key: re.key, aspect: re.aspect, count: 0 };
    e.count++;
    n.set(re.key, e);
  }
  return [...n.values()].sort((a, b) => b.count - a.count).map(({ key, aspect }) => ({ key, aspect }));
}

/** A revised design: people notice whether their complaints about the first one were answered. */
export function followUp(parent: Trial, factors: Factor[]): Factor[] {
  const out: Factor[] = [];
  const seen = new Set<AspectId>();
  for (const c of complaints(parent).slice(0, 3)) {
    if (seen.has(c.aspect) || c.key === 'empty' || c.key === 'emptyWork' || c.key === 'unhappy') continue;
    seen.add(c.aspect);
    const still = factors.some((f) => f.key === c.key && f.w < 0);
    out.push(still ? { key: 'ignored', aspect: c.aspect, w: -0.2, spread: 0.1 } : { key: 'listened', aspect: c.aspect, w: 0.3, spread: 0.1 });
  }
  return out;
}

/** How life in the building is going right now. */
export function liveFactors(b: Building, day: number, openDay: number, pollution: number, cityHappiness: number): Factor[] {
  const out: Factor[] = [];
  const residential = isResidential(b.zone);
  const cap = residential ? b.hhCap : b.jobs;
  const occ = cap > 0 ? (residential ? b.households : b.workers) / cap : 1;
  if (day - openDay >= 10) {
    if (occ < 0.35) out.push({ key: residential ? 'empty' : 'emptyWork', aspect: 'cost', w: -0.3, spread: 0.15 });
    else if (occ > 0.9) out.push({ key: residential ? 'full' : 'fullWork', aspect: 'cost', w: 0.3, spread: 0.1 });
  }
  if (b.problems & (Problem.NoPower | Problem.NoWater | Problem.NoSewage)) out.push({ key: 'utility', aspect: 'home', w: -0.6, blame: 'city' });
  if (b.problems & Problem.Garbage) out.push({ key: 'garbage', aspect: 'home', w: -0.35, blame: 'city' });
  if (pollution > 0.3) out.push({ key: 'smog', aspect: 'home', w: -0.3, blame: 'city' });
  if (b.residents > 0 || b.workers > 0) {
    // Compared with the rest of the city: a city short of schools and clinics isn't the building's fault.
    const h = clamp((b.happiness - cityHappiness) / 30, -0.5, 0.5);
    if (Math.abs(h) > 0.12) out.push({ key: h > 0 ? 'happy' : 'unhappy', aspect: 'home', w: h, spread: 0.1 });
  }
  return out;
}

// ── What they say ───────────────────────────────────────────────────────────

type Line = [Voice, string];
interface Lines {
  pos?: Line[];
  neg?: Line[];
}

/**
 * Lines by factor. {name} is the building, {floors} its storeys, {street}
 * the street it stands on. Residents' lines are used for homes and workers'
 * for offices and shops.
 */
const LINES: Record<string, Lines> = {
  balconies: {
    pos: [['resident', 'Morning coffee on the balcony. I didn’t know I needed this.'], ['resident', 'Our balcony catches the evening sun. Best thing about the flat.'], ['worker', 'We take our calls out on the balcony when it’s warm.']],
    neg: [['resident', 'The balcony is lovely, but it’s too narrow for a chair.']],
  },
  planters: {
    pos: [['resident', 'There are tomatoes growing outside my window. On the {floor} floor!'], ['resident', 'Living among the trees, in the middle of the city. I still can’t believe it.'], ['green', 'Birds are nesting on the balconies of {name}. In the middle of town!'], ['worker', 'Every desk looks out onto leaves. People are calmer here.']],
    neg: [['resident', 'Lovely trees, but the leaves clog our drains every week.'], ['agent', 'Somebody has to water all those trees, and it shows in the service charge.']],
  },
  loggias: { pos: [['resident', 'The loggia is like an extra room that’s half outside.'], ['resident', 'Sheltered enough to sit out even when it rains.']] },
  roofGarden: {
    pos: [['resident', 'We had a barbecue on the roof garden. Half the building came.'], ['worker', 'Lunch on the roof garden beats the canteen.'], ['green', 'A garden on the roof of {name}: bees, herbs and shade.']],
    neg: [['resident', 'The roof garden is always locked. What’s the point?']],
  },
  terraces: { pos: [['resident', 'Every flat has its own terrace. It feels like a village on a hillside.'], ['worker', 'Meetings on the terrace, in the open air.']] },
  courtyard: {
    pos: [['resident', 'The children play in the courtyard where we can all keep an eye on them.'], ['resident', 'The courtyard is quiet. You forget the city is just outside.'], ['worker', 'The courtyard is where everyone eats lunch.']],
    neg: [['resident', 'Every sound in the courtyard echoes up to my window.']],
  },
  skyGarden: { pos: [['resident', 'The sky garden halfway up is where everyone meets.'], ['worker', 'There’s a garden in the sky on our floor. Best office I’ve had.']] },
  space: { pos: [['resident', 'A garden of our own. That’s all we wanted.'], ['resident', 'Room for the kids, room for the dog. We’re staying.']] },
  lifts: {
    pos: [['resident', 'The lift is fast and the view is worth every second.']],
    neg: [['resident', '{floors} storeys and two lifts. You learn patience.'], ['resident', 'When the lift broke I carried the shopping up nineteen floors.']],
  },
  view: { pos: [['resident', 'You can see the whole city from my kitchen.'], ['resident', 'Sunset from the {floor} floor. Worth every penny.'], ['worker', 'The view from the meeting room sells our company for us.']] },
  cramped: {
    pos: [['resident', 'The rooms are small, but the rent is fair.']],
    neg: [['resident', 'Cheap, yes. But there’s no room for a table.'], ['resident', 'No balcony, small windows, small rooms. It feels like a box.']],
  },
  luxuryHome: { pos: [['resident', 'Oak floors and a doorman. It feels like a hotel.'], ['worker', 'Clients are impressed before they reach reception.']] },
  light: {
    pos: [['resident', 'So much light. My plants have never been happier.'], ['worker', 'Daylight at every desk. People actually like coming in.']],
  },
  dark: { neg: [['resident', 'The windows look nice from outside, but the rooms are dim.'], ['worker', 'We have the lights on all day.']] },
  park: { pos: [['resident', 'Two minutes to the park. Perfect for the dog.'], ['worker', 'The park next door is where I eat lunch every day.']] },
  noise: { neg: [['resident', 'The traffic outside never stops. Thank goodness for good windows.'], ['worker', 'You can’t open a window for the traffic noise.']] },
  shopsBelow: {
    pos: [['shop', 'Flats above, shop below. My customers are my neighbours.'], ['passer', 'A bakery on the ground floor and homes above. That’s how a street should be.'], ['resident', 'I buy my bread downstairs in my slippers.']],
    neg: [['shop', 'The shop unit is lovely, but the rent upstairs keeps going up.']],
  },
  arcade: { pos: [['shop', 'The arcade kept my customers dry all through the rain.'], ['passer', 'You can walk the length of {street} under the arcade.']] },
  pilotis: {
    pos: [['passer', 'The open ground under it is a shady place to sit.'], ['passer', 'Kids skateboard under the columns all afternoon.']],
    neg: [['passer', 'It’s draughty and empty under those columns at night.'], ['neighbour', 'The space underneath has become a car park in all but name.']],
  },
  blankBase: { neg: [['passer', 'Just a lobby and a blank wall. Nothing to look at on the way past.'], ['passer', 'It turns its back on {street}.']] },
  doorway: { pos: [['passer', 'People stop to photograph the doorway.'], ['passer', 'The carved entrance is worth the detour.']] },
  monumental: {
    pos: [['critic', 'It gives {street} some dignity. A building that means it.'], ['passer', 'Solid as a castle.']],
    neg: [['passer', 'It looks like a ministry. Who wants to live in a ministry?'], ['neighbour', 'Heavy, dark and forbidding.']],
  },
  cantilever: {
    pos: [['passer', 'The overhang makes a perfect shelter at the bus stop.'], ['critic', 'Those floating upper floors are a small miracle of engineering.']],
    neg: [['passer', 'Walking under that overhang makes me nervous.']],
  },
  'wall-brick': {
    pos: [['passer', 'Proper brick. It’ll still look good in a hundred years.'], ['critic', 'Honest brick, well laid. Quietly very good.']],
    neg: [['critic', 'Brick again? It plays it safe.']],
  },
  'wall-stone': {
    pos: [['passer', 'Real stone. They don’t build like this any more.'], ['critic', 'Dressed stone gives it a gravity few new buildings have.']],
    neg: [['passer', 'Very grand for a block of flats.']],
  },
  'wall-timber': {
    pos: [['passer', 'A wooden building in the city! It smells like a forest by the door.'], ['critic', 'Warm, tactile timber. The city should build more like this.']],
    neg: [['neighbour', 'Wood? Wait until it weathers grey.'], ['passer', 'Isn’t a wooden building a fire risk?']],
  },
  'wall-beton': {
    pos: [['critic', 'Raw, honest concrete. It’s magnificent.'], ['passer', 'Bold. I didn’t think I’d like it, but I do.']],
    neg: [['passer', 'It looks like a car park with curtains.'], ['neighbour', 'Grey, grey, grey. It looks sad when it rains.']],
  },
  'wall-glass': {
    pos: [['passer', 'It reflects the sky. At sunset it glows.'], ['critic', 'A crisp glass skin, beautifully detailed.']],
    neg: [['critic', 'A glass box. It could be anywhere in the world.'], ['neighbour', 'The glare off it lights up my living room every afternoon.']],
  },
  'wall-panel': {
    pos: [['passer', 'Clean and simple. No fuss.']],
    neg: [['passer', 'Grey panels. It looks temporary.'], ['critic', 'Prefabricated and it looks it.']],
  },
  'wall-render': {
    pos: [['passer', 'The colours make the whole street cheerful.'], ['passer', 'Fresh and bright. Lovely.']],
    neg: [['critic', 'Pleasant, but forgettable.']],
  },
  'wall-siding': { pos: [['passer', 'Painted boards, like a seaside town.']], neg: [['neighbour', 'Those boards will need painting every few years.']] },
  ornament: {
    pos: [['passer', 'Look at the cornice! Someone cared about this building.'], ['critic', 'Ornament is back, and it’s done with wit.']],
    neg: [['critic', 'All that decoration is a bit much.']],
  },
  colour: {
    pos: [['passer', 'Bold colour. I can find my way home from across town.']],
    neg: [['neighbour', 'Who chose that colour?']],
  },
  familiar: { pos: [['passer', 'It fits right in, like it’s always been here.'], ['critic', 'It speaks the city’s own language.']] },
  novel: {
    pos: [['critic', 'Nothing else in the city looks like {name}. That’s the point.'], ['passer', 'Finally something new around here.']],
    neg: [['passer', 'It sticks out like a spaceship.'], ['neighbour', 'It doesn’t look like anything around here.']],
  },
  'roof-butterfly': { pos: [['passer', 'That roof looks like a bird about to take off.']], neg: [['neighbour', 'Where does all the rain off that roof go?']] },
  'roof-vault': { pos: [['passer', 'The curved roof makes it look like an old railway hall.']], neg: [['passer', 'It looks like an aircraft hangar.']] },
  'roof-mansard': { pos: [['passer', 'A proper mansard with dormers. Very Parisian.']], neg: [['critic', 'A mansard on a new building is a costume, not a roof.']] },
  stacked: {
    pos: [['passer', 'Like children’s blocks piled up. It makes me smile.'], ['critic', 'Playful and daring.']],
    neg: [['passer', 'It looks like it might fall over.'], ['neighbour', 'A pile of boxes.']],
  },
  terraceLooks: { pos: [['passer', 'From the street it looks like a green hillside.']] },
  greenRoof: { pos: [['green', 'The green roof soaks up the rain. Our street hasn’t flooded since.'], ['green', 'Sedum, grasses and butterflies on the roof of {name}.']] },
  skyGardenGreen: { pos: [['green', 'Trees forty metres up. The birds have found them already.']] },
  solar: { pos: [['green', 'On sunny days {name} makes more power than it uses.'], ['resident', 'Our electricity bill is almost nothing.']] },
  wind: { pos: [['green', 'Wind turbines on the roof: clean power from the sky.']], neg: [['neighbour', 'The turbines are an eyesore.']] },
  brise: { pos: [['green', 'The fins keep it cool without air conditioning.'], ['worker', 'Even in August the office stays cool.']] },
  timberCarbon: { pos: [['green', 'A timber building stores carbon instead of burning it. This is the future.']] },
  concreteCarbon: { neg: [['green', 'All that concrete. Think of the carbon.']], pos: [['critic', 'Concrete that will stand for two centuries is its own kind of green.']] },
  glassHeat: { neg: [['green', 'A glass building in the summer sun will need a lot of air conditioning.']] },
  noGreen: { neg: [['green', 'Not a single plant on the whole thing.'], ['green', 'A missed chance: no garden, no green roof, nothing.']] },
  budget: {
    pos: [['resident', 'Finally, rent I can actually pay.'], ['resident', 'Nurses, bus drivers, students: we can all afford to live here.'], ['agent', 'Affordable flats let the day they’re advertised.']],
    neg: [['resident', 'Cheap, and it shows: you can hear the neighbours sneeze.']],
  },
  luxury: {
    pos: [['agent', 'Expensive, and worth it. We have a waiting list.'], ['resident', 'Worth every penny.']],
    neg: [['agent', 'Who’s going to pay these prices in this part of town?'], ['neighbour', 'Luxury flats here? Nobody round here can afford them.']],
  },
  pricey: { neg: [['agent', 'Beautiful, but someone has to pay for all of it.'], ['critic', 'Every idea in the book, and the bill to match.']] },
  quickBuild: { pos: [['agent', 'Put up in record time and on budget.']] },
  overshadow: {
    neg: [['neighbour', 'It blocks our evening sun. We used to see the hills.'], ['neighbour', '{floors} storeys next to our little houses? It’s like living beside a cliff.'], ['neighbour', 'My garden is in its shadow from three o’clock.']],
  },
  fitsIn: { pos: [['neighbour', 'Same height as the rest of the street. A good neighbour.'], ['neighbour', 'It sits nicely in the row.']] },
  crowding: { neg: [['neighbour', 'Hundreds more people and the same bus stop.'], ['neighbour', 'You can’t park on {street} any more.']], pos: [['shop', 'More people living here means more customers for us.']] },
  greenStreet: { pos: [['neighbour', 'The street feels cooler since {name} went up, with all the planting.'], ['neighbour', 'The greenery on it makes the whole street nicer.']] },
  hum: { neg: [['neighbour', 'The turbines hum all night.']], pos: [['neighbour', 'I thought the turbines would be noisy. You can’t hear them.']] },
  tone: { pos: [['neighbour', 'It has raised the tone of the whole street.']] },
  clash: { neg: [['neighbour', 'It doesn’t match a single building around here.']], pos: [['neighbour', 'It’s different, and the street needed waking up.']] },
  empty: {
    neg: [['agent', 'Half the flats are still empty.'], ['agent', 'We can’t find tenants. People look, and then they leave.'], ['agent', 'Lots of viewings, very few takers.']],
  },
  emptyWork: { neg: [['agent', 'The offices are mostly empty.'], ['agent', 'We can’t find businesses to move in.']] },
  full: { pos: [['agent', 'Every flat was let in the first weeks. There’s a waiting list.'], ['agent', 'Fully let. People keep asking when the next one is built.']] },
  fullWork: { pos: [['agent', 'Every floor is let. Companies are queuing for space.']] },
  utility: { neg: [['resident', 'No power since Tuesday. Hard to judge a building in the dark.'], ['resident', 'The taps are dry again. It’s not the building, but still.'], ['worker', 'We sent everyone home: no power again.'], ['worker', 'No water in the building today.']] },
  garbage: { neg: [['resident', 'The bins haven’t been emptied for a week.'], ['resident', 'The rubbish is piling up by the door. Not the architect’s fault, I know.'], ['worker', 'Nobody has collected our rubbish for days.']] },
  smog: { neg: [['resident', 'You can taste the factory smoke on the balcony.'], ['resident', 'We keep the windows shut because of the smog.'], ['worker', 'The air outside is thick with smoke.']] },
  listened: {
    pos: [['neighbour', 'They actually listened to us this time.'], ['critic', 'The second attempt fixes what was wrong with the first. A rare thing.'], ['resident', 'Much better than the first one. Someone read the complaints.'], ['passer', 'Version two, and it’s better.']],
  },
  ignored: {
    neg: [['neighbour', 'They built it again and changed nothing we complained about.'], ['critic', 'A second attempt with all the old faults.'], ['neighbour', 'Same problems as the first one. Did anyone read our letters?']],
  },
  happy: { pos: [['resident', 'Honestly? Best place I’ve lived in this city.'], ['resident', 'We moved in for a year. We’re not leaving.'], ['worker', 'Best office I’ve worked in.']] },
  unhappy: { neg: [['resident', 'It looked good in the drawings. Living here is another story.'], ['resident', 'We’re thinking of moving out.'], ['worker', 'Nobody wants to work here.']] },
};
LINES.skyGarden.pos = [...(LINES.skyGarden.pos ?? []), ...(LINES.skyGardenGreen.pos ?? [])];

const GENERIC: Record<AspectId, Lines> = {
  home: { pos: [['resident', 'It’s a good place to live. Quiet, solid and well thought out.'], ['worker', 'A good place to work.']], neg: [['resident', 'It looks better than it lives.'], ['worker', 'The offices are fine, but nobody loves them.']] },
  street: { pos: [['passer', 'It makes the walk down {street} nicer.']], neg: [['passer', 'It does nothing for {street}.']] },
  looks: { pos: [['passer', 'I stop to look at {name} every morning.']], neg: [['passer', 'I’m sorry, but it’s ugly.']] },
  green: { pos: [['green', 'A step in the right direction.']], neg: [['green', 'A missed chance to make it greener.']] },
  cost: { pos: [['agent', 'It lets easily.']], neg: [['agent', 'It’s hard to let at these prices.']] },
  neighbours: { pos: [['neighbour', 'It’s a good neighbour.']], neg: [['neighbour', 'We weren’t asked, and we don’t like it.']] },
};

const NAMES = ['Mara', 'Tomas', 'Ines', 'Yusuf', 'Lena', 'Arjun', 'Sofia', 'Kofi', 'Hana', 'Mateo', 'Ada', 'Felix', 'Nadia', 'Oskar', 'Priya', 'Jonas', 'Amara', 'Leo', 'Rosa', 'Emil', 'Zara', 'Idris', 'Elif', 'Bruno', 'Noor', 'Theo', 'Mei', 'Samir', 'Greta', 'Rafael', 'Ayla', 'Viktor', 'Lucia', 'Kenji', 'Freya', 'Omar', 'Talia', 'Hugo', 'Signe', 'Dario'];
const SHOPS = ['bakery', 'café', 'bookshop', 'barber’s', 'grocer’s', 'florist’s', 'bike shop'];

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${s}`;
}

export interface Speaker {
  /** The city paper's name, for its critic. */
  paper: string;
  street: string;
}

function whoFor(voice: Voice, r: Rng, c: Concept, sp: Speaker, floor: number): string {
  const n = r.pick(NAMES);
  switch (voice) {
    case 'resident':
      return c.kind === 'house' ? `${n}, who lives there` : c.kind === 'townhouse' ? `${n}, lives at no. ${r.int(2, 40)}` : `${n}, ${ordinal(floor)} floor`;
    case 'worker':
      return c.kind === 'shop' ? `${n}, works there` : `${n}, works on the ${ordinal(floor)} floor`;
    case 'neighbour':
      return r.pick([`${n}, next door`, `${n}, across the street`, `${n}, two doors down`, `${n}, round the corner`]);
    case 'passer':
      return r.pick([`${n}, walking past`, 'A passer-by', `${n}, out with the dog`, `${n}, on the bus`, `${n}, cycling to work`]);
    case 'shop':
      return `${n}, runs the ${r.pick(SHOPS)} downstairs`;
    case 'critic':
      return `${sp.paper} critic`;
    case 'green':
      return r.pick(['Green Streets group', `${n}, birdwatcher`, `${n}, tree society`]);
    case 'agent':
      return c.use === 'offices' ? 'The building manager' : r.pick(['The letting agent', `${n}, letting agent`]);
  }
}

/** Standard normal-ish sample (sum of uniforms). */
function gauss(r: Rng): number {
  return (r.next() + r.next() + r.next() + r.next() - 2) * 1.22;
}

/** One person's reaction: picks what they talk about and how they feel about it. */
export function makeReaction(t: Trial, factors: Factor[], r: Rng, day: number, sp: Speaker, residential: boolean, voices?: Voices[]): Reaction | null {
  if (!factors.length) return null;
  const month = t.openDay < 0 ? 0 : Math.floor((day - t.openDay) / 30) + 1;
  // First impressions are about looks and the street; later, about living there and what it costs.
  const early = month <= 1;
  const weight = (f: Factor) => (Math.abs(f.w) + 0.5 * (f.spread ?? 0) + 0.05) * (early ? (f.aspect === 'looks' || f.aspect === 'street' || f.aspect === 'neighbours' ? 1.5 : 0.8) : f.aspect === 'home' || f.aspect === 'cost' ? 1.4 : 1) * (f.blame ? 1.6 : 1);
  const fits = (l: Line) => (residential ? l[0] !== 'worker' : l[0] !== 'resident');
  // Something not said lately: lines are compared by their opening words (names and floors vary).
  const opening = (s: string) => s.split(' ').slice(0, 4).join(' ');
  const recent = new Set(t.reactions.slice(-14).map((x) => opening(x.text)));
  let fac: Factor | undefined, mood = 0, pool: Line[] = [], group: GroupId | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    const f = r.weighted(factors, weight)!;
    // Who speaks up: people who feel strongly about it, in proportion to how many of them live here.
    const v = voices?.length ? r.weighted(voices, (g) => g.share * (0.4 + Math.abs(g.keys[f.key] ?? 0) * 2.5)) : undefined;
    const m = clamp(f.w + 0.8 * (v?.keys[f.key] ?? 0) + (f.spread ?? 0) * gauss(r) * 0.9 + gauss(r) * 0.06, -1, 1);
    const lines = LINES[f.key] ?? {};
    // Lines from a voice that belongs to another group don't suit this speaker.
    const suits = (l: Line) => fits(l) && (!v || !VOICE_GROUP[l[0]] || VOICE_GROUP[l[0]] === v.id);
    let p = (m >= 0 ? lines.pos : lines.neg)?.filter(suits) ?? [];
    if (!p.length) p = ((m >= 0 ? GENERIC[f.aspect].pos : GENERIC[f.aspect].neg) ?? []).filter(suits);
    if (!p.length) p = ((m >= 0 ? GENERIC[f.aspect].pos : GENERIC[f.aspect].neg) ?? []).filter(fits);
    const fresh = p.filter((l) => !recent.has(opening(l[1])));
    if (!fac || fresh.length) {
      fac = f;
      mood = m;
      pool = fresh.length ? fresh : p;
      group = v?.id;
    }
    if (fresh.length) break;
  }
  if (!fac) return null;
  // Never the same thing twice running: a general remark instead, or nothing today.
  const last = t.reactions[t.reactions.length - 1];
  const notLast = (l: Line) => !last || opening(l[1]) !== opening(last.text);
  pool = pool.filter(notLast);
  if (!pool.length) pool = ((mood >= 0 ? GENERIC[fac.aspect].pos : GENERIC[fac.aspect].neg) ?? []).filter((l) => fits(l) && notLast(l));
  if (!pool.length) return null;
  const [voice, text] = r.pick(pool);
  if (voice === 'critic') group = undefined;
  else if (VOICE_GROUP[voice]) group = VOICE_GROUP[voice];
  const floor = r.int(1, Math.max(1, t.concept.floors));
  return {
    day,
    month,
    who: whoFor(voice, r, t.concept, sp, floor),
    voice,
    text: fill(text, t, sp, floor),
    mood: Math.round(mood * 100) / 100,
    aspect: fac.aspect,
    key: fac.key,
    ...(group ? { group } : {}),
    ...(fac.blame ? { blame: fac.blame } : {}),
  };
}

function fill(s: string, t: Trial, sp: Speaker, floor: number): string {
  return s.replace(/\{name\}/g, t.name).replace(/\{floors\}/g, String(t.concept.floors)).replace(/\{street\}/g, sp.street || 'the street').replace(/\{floor\}/g, ordinal(floor));
}

// ── Opinion and verdict ─────────────────────────────────────────────────────

export function emptyScores(): Record<AspectId, number> {
  return { home: 0, street: 0, looks: 0, green: 0, cost: 0, neighbours: 0 };
}

/** The base view of each aspect, from the design and its site alone. */
export function baseScores(factors: Factor[]): Record<AspectId, number> {
  const s = emptyScores();
  for (const f of factors) if (!f.blame) s[f.aspect] += f.w;
  for (const k of Object.keys(s) as AspectId[]) s[k] = clamp(s[k], -1, 1);
  return s;
}

/** First impressions when it opens: half of what the building really is. */
export function openingScores(factors: Factor[]): Record<AspectId, number> {
  const base = baseScores(factors);
  for (const k of Object.keys(base) as AspectId[]) base[k] *= 0.5;
  return base;
}

/** A reaction shifts opinion of its aspect; every aspect also settles towards what the building really is. */
export function absorb(t: Trial, re: Reaction): void {
  const base = baseScores(t.factors);
  const rate = re.blame ? 0.08 : 0.35;
  t.scores[re.aspect] = t.scores[re.aspect] + (re.mood - t.scores[re.aspect]) * rate;
  for (const a of ASPECTS) t.scores[a.id] += (base[a.id] - t.scores[a.id]) * 0.1;
  t.approval = approvalOf(t.scores, t.factors);
}

/** How much each aspect matters for this building: what it has to say for itself counts most. */
export function salience(factors: Factor[]): Record<AspectId, number> {
  const out = emptyScores();
  for (const f of factors) if (!f.blame) out[f.aspect] += Math.abs(f.w) + 0.5 * (f.spread ?? 0);
  for (const a of ASPECTS) out[a.id] = a.weight * (0.2 + Math.min(1, out[a.id]));
  return out;
}

export function approvalOf(s: Record<AspectId, number>, factors: Factor[]): number {
  const w = salience(factors);
  let sum = 0, wsum = 0;
  for (const a of ASPECTS) {
    sum += w[a.id] * s[a.id];
    wsum += w[a.id];
  }
  // Opinions are stretched a little: a building people agree on is clearly loved or hated.
  return Math.round(clamp(50 + 50 * Math.tanh((1.6 * sum) / wsum), 2, 98));
}

export function gradeOf(approval: number): Grade {
  return approval >= 72 ? 'loved' : approval >= 58 ? 'liked' : approval >= 45 ? 'mixed' : approval >= 32 ? 'disliked' : 'hated';
}

const LIKED: Record<AspectId, string> = {
  home: 'loved living there', street: 'liked how it meets the street', looks: 'liked the look of it', green: 'liked how green it is', cost: 'thought it good value', neighbours: 'found it a good neighbour',
};
const LIKED_WORK: Partial<Record<AspectId, string>> = { home: 'liked working there' };
const DISLIKED: Record<AspectId, string> = {
  home: 'found it a hard place to live', street: 'felt it turned its back on the street', looks: 'didn’t like the look of it', green: 'wanted it greener', cost: 'thought it poor value', neighbours: 'found it a difficult neighbour',
};
const DISLIKED_WORK: Partial<Record<AspectId, string>> = { home: 'didn’t like working there' };

/** What to change, by the factor people complained about. */
const ADVICE: Record<string, string> = {
  cramped: 'Give the flats balconies or loggias: cheap flats feel cramped without somewhere to sit out.',
  lifts: 'Keep homes lower, or add sky gardens so a tall building has places to meet.',
  dark: 'Use bigger windows: people found the rooms dim.',
  noise: 'Build it on a quieter street, or give it a courtyard to turn away from the traffic.',
  blankBase: 'Put shops or an arcade at street level instead of a blank wall.',
  pilotis: 'Use the open ground under the columns for something, like shops or a garden.',
  monumental: 'Lighten it up: monumental walls felt forbidding.',
  cantilever: 'Make the overhang feel safer, or drop it.',
  'wall-beton': 'Soften the concrete with planting or a warmer material.',
  'wall-glass': 'Give the glass some depth, with fins, balconies or another material.',
  'wall-panel': 'Choose a material that feels more permanent than panels.',
  'wall-timber': 'Pair the timber with brick or stone to reassure people it will last.',
  novel: 'Bring it closer to how the city already builds, or build it where it can stand apart.',
  stacked: 'Calm the stacked boxes down: some people thought it looked unstable.',
  noGreen: 'Add planted balconies, a roof garden or a green roof.',
  concreteCarbon: 'Use timber or add greenery to answer the carbon worries.',
  glassHeat: 'Add sun fins to keep the glass cool.',
  luxury: 'Luxury flats don’t suit this area: build them where land is worth more.',
  pricey: 'Pick fewer features: people felt it cost too much.',
  budget: 'Make it a little less bare: cheap shouldn’t mean cramped.',
  overshadow: 'Build lower, or among taller buildings, so it doesn’t overshadow the neighbours.',
  crowding: 'Put it near a bus or metro line so the street can take the extra people.',
  hum: 'Leave off the rooftop turbines near homes.',
  clash: 'Choose materials closer to the street’s, or build it in a newer district.',
  empty: 'Few people wanted to move in: try a cheaper version, or a busier area.',
  unhappy: 'Living there went badly: check services nearby and give the flats more outdoor space.',
};

/** The trial's conclusion. */
export function makeVerdict(t: Trial, day: number, residential: boolean, abandoned = false, cutShort = false): Verdict {
  const approval = abandoned ? Math.min(t.approval, 20) : t.approval;
  const grade = gradeOf(approval);
  const sorted = [...ASPECTS].sort((a, b) => t.scores[b.id] - t.scores[a.id]);
  const best = sorted.filter((a) => t.scores[a.id] > 0.08).slice(0, 2).map((a) => a.id);
  const worst = sorted.reverse().filter((a) => t.scores[a.id] < -0.05).slice(0, 2).map((a) => a.id);
  const liked = (a: AspectId) => (!residential && LIKED_WORK[a]) || LIKED[a];
  const disliked = (a: AspectId) => (!residential && DISLIKED_WORK[a]) || DISLIKED[a];
  const join = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] ?? '');
  const moods = t.reactions.filter((x) => !x.blame && x.month > 0).map((x) => x.mood);
  const split = moods.some((m) => m > 0.3) && moods.some((m) => m < -0.3);
  const gradeWord: Record<Grade, string> = { loved: 'a hit', liked: 'well liked', mixed: split ? 'divisive' : 'met with a shrug', disliked: 'not well liked', hated: 'a flop' };
  let summary = abandoned ? `Everyone moved out of ${t.name} before the trial ended.` : cutShort ? `${t.name} was lost before the trial ended. Until then it was ${gradeWord[grade]}.` : `${t.name} was ${gradeWord[grade]}.`;
  if (best.length && worst.length) summary += ` People ${join(best.map(liked))}, but ${join(worst.map(disliked))}.`;
  else if (best.length) summary += ` People ${join(best.map(liked))}.`;
  else if (worst.length) summary += ` People ${join(worst.map(disliked))}.`;
  // Advice: the most-complained-about things in the weakest aspects.
  const counts = new Map<string, number>();
  for (const re of t.reactions) if (re.mood < -0.1 && !re.blame) counts.set(re.key, (counts.get(re.key) ?? 0) + 1 + (worst.includes(re.aspect) ? 1 : 0));
  for (const f of t.factors) if (f.w < -0.1 && worst.includes(f.aspect)) counts.set(f.key, (counts.get(f.key) ?? 0) + 0.5);
  const advice = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => ADVICE[k]).filter((x): x is string => !!x);
  if (abandoned && ADVICE.unhappy) advice.unshift(ADVICE.unhappy);
  const said = t.reactions.filter((x) => !x.blame && x.month > 0);
  const warm = said.reduce<Reaction | null>((m, x) => (!m || x.mood > m.mood ? x : m), null);
  const harsh = said.reduce<Reaction | null>((m, x) => (!m || x.mood < m.mood ? x : m), null);
  const quotes = [warm, harsh].filter((x): x is Reaction => !!x && (x === warm ? x.mood > 0 : x.mood < 0));
  return { day, approval, grade, best, worst, summary, advice: [...new Set(advice)].slice(0, 3), quotes, ...(abandoned ? { abandoned } : {}), ...(cutShort ? { cutShort } : {}) };
}

/** Whether someone speaks up today (about five times a month, never twice running). */
export function speaksToday(t: Trial, day: number): boolean {
  if (t.openDay < 0) return false;
  const k = day - t.openDay;
  if (k <= 0) return false;
  if (k % 30 === 3 || k % 30 === 17) return true;
  const last = t.reactions[t.reactions.length - 1];
  if (last && day - last.day < 2) return false;
  return hash01(t.id * 7919 + 13, day) < 0.17;
}

export function capReactions(t: Trial): void {
  if (t.reactions.length > MAX_REACTIONS) t.reactions.splice(0, t.reactions.length - MAX_REACTIONS);
}
