import { clamp } from '../../core/math';
import { hash01 } from '../../core/rng';
import type { Axes, FeatureId, Massing, Movement, RoofKind, WallKind } from '../style/Movements';
import type { Concept } from './Concept';
import { type Factor, type Site, assess } from './Trials';

/**
 * Taste groups: the city's residents don't all want the same thing. Every
 * household belongs to one of six groups with its own idea of a good
 * building, so the same design is cheered by some and booed by others, and
 * a city that only ever builds for one group loses the rest.
 */

export type GroupId = 'heritage' | 'green' | 'modern' | 'family' | 'business' | 'locals';

export interface GroupDef {
  id: GroupId;
  /** "The Old Town Society". */
  name: string;
  /** "Old Town". */
  short: string;
  /** "traditionalists". */
  members: string;
  icon: string;
  color: string;
  blurb: string;
  /** How share of the population is weighted at founding (before each city's own twist). */
  base: number;
  axes: Partial<Axes>;
  walls: Partial<Record<WallKind, number>>;
  roofs: Partial<Record<RoofKind, number>>;
  features: Partial<Record<FeatureId, number>>;
  massing: Partial<Record<Massing, number>>;
  /** How they feel about what people react to in a prototype (factor keys), −1 … 1. */
  keys: Record<string, number>;
  /** What they say on a placard. */
  slogans: string[];
}

export const GROUPS: GroupDef[] = [
  {
    id: 'heritage', short: 'Old Town', name: 'The Old Town Society', members: 'traditionalists', icon: 'landmark', color: '#c99a5b', base: 0.17,
    blurb: 'Brick, stone, pitched roofs and carved doorways. They want the city to look like it has always looked.',
    axes: { ornate: 0.8, hand: 0.7, heavy: 0.3 },
    walls: { stone: 0.6, brick: 0.5, render: 0.2, siding: 0.2, timber: 0.1, glass: -0.6, beton: -0.7, panel: -0.6 },
    roofs: { gable: 0.3, hip: 0.3, mansard: 0.5, butterfly: -0.4, flat: -0.2, vault: 0.1 },
    features: { ornament: 0.6, arcade: 0.3, monumental: 0.2, cantilever: -0.4, solarSkin: -0.3, windCrown: -0.4 },
    massing: { stacked: -0.5, courtyard: 0.2 },
    keys: { 'wall-stone': 0.5, 'wall-brick': 0.4, ornament: 0.5, doorway: 0.4, familiar: 0.5, novel: -0.6, clash: -0.5, 'wall-glass': -0.5, 'wall-beton': -0.6, 'wall-panel': -0.4, stacked: -0.5, 'roof-mansard': 0.4, overshadow: -0.3, tone: 0.3, cantilever: -0.3 },
    slogans: ['Keep our city beautiful', 'No more glass boxes', 'Save the old streets', 'Brick, not concrete'],
  },
  {
    id: 'green', short: 'Greens', name: 'Green Streets', members: 'environmentalists', icon: 'tree', color: '#5fb37f', base: 0.16,
    blurb: 'Trees on every balcony, gardens on every roof, power from the sun. They judge a building by how much it gives back.',
    axes: { green: 0.9, hand: 0.2 },
    walls: { timber: 0.6, brick: 0.1, beton: -0.4, glass: -0.3 },
    roofs: { green: 0.6 },
    features: { planters: 0.7, greenRoof: 0.6, roofGarden: 0.5, skyGarden: 0.6, terraces: 0.4, solarSkin: 0.6, windCrown: 0.5, courtyard: 0.3, briseSoleil: 0.3 },
    massing: { terraced: 0.4 },
    keys: { planters: 0.5, greenRoof: 0.5, roofGarden: 0.4, skyGarden: 0.4, solar: 0.5, wind: 0.4, brise: 0.3, timberCarbon: 0.5, concreteCarbon: -0.5, glassHeat: -0.4, noGreen: -0.6, greenStreet: 0.4, park: 0.3, smog: -0.5, 'wall-timber': 0.3 },
    slogans: ['Plant it, don’t pave it', 'Green roofs now', 'No more grey', 'A tree for every window'],
  },
  {
    id: 'modern', short: 'Forward', name: 'Forward', members: 'modernists', icon: 'office', color: '#6cb6c9', base: 0.13,
    blurb: 'Glass, concrete, daring shapes and towers on the skyline. They want a city that looks like the future.',
    axes: { ornate: -0.6, hand: -0.7, dense: 0.3 },
    walls: { glass: 0.6, beton: 0.4, panel: 0.2, stone: -0.2, siding: -0.2 },
    roofs: { flat: 0.3, butterfly: 0.4, mansard: -0.5, gable: -0.2 },
    features: { cantilever: 0.6, pilotis: 0.4, briseSoleil: 0.3, ornament: -0.6, monumental: 0.1 },
    massing: { stacked: 0.5, slab: 0.2 },
    keys: { 'wall-glass': 0.5, 'wall-beton': 0.5, novel: 0.6, stacked: 0.6, cantilever: 0.5, pilotis: 0.4, ornament: -0.5, 'roof-mansard': -0.5, familiar: -0.3, view: 0.3, light: 0.3, 'roof-butterfly': 0.4, clash: 0.3 },
    slogans: ['Build the future', 'Enough fake old buildings', 'Reach for the sky', 'Dare to be different'],
  },
  {
    id: 'family', short: 'Fair Rents', name: 'Fair Rents', members: 'families and renters', icon: 'people', color: '#d8b04a', base: 0.26,
    blurb: 'Room to live, somewhere to sit outside, a park nearby and a rent they can pay. Looks come second.',
    axes: { dense: -0.4 },
    walls: {},
    roofs: {},
    features: { balconies: 0.4, courtyard: 0.5, loggias: 0.3, roofGarden: 0.2, terraces: 0.2 },
    massing: { courtyard: 0.3 },
    keys: { budget: 0.6, luxury: -0.6, pricey: -0.5, cramped: -0.4, space: 0.5, courtyard: 0.4, balconies: 0.3, loggias: 0.3, park: 0.4, lifts: -0.3, full: 0.2, noise: -0.3, quickBuild: 0.2 },
    slogans: ['Homes people can afford', 'Room to breathe', 'Families first', 'Fair rents for all'],
  },
  {
    id: 'business', short: 'Chamber', name: 'The Chamber of Commerce', members: 'shopkeepers and businesses', icon: 'shop', color: '#9b87e0', base: 0.12,
    blurb: 'Shops on the street, offices that fill, buildings that go up fast and pay their way.',
    axes: { dense: 0.6, heavy: 0.2 },
    walls: { panel: 0.3, glass: 0.3, beton: 0.2 },
    roofs: {},
    features: { arcade: 0.5, pilotis: -0.1 },
    massing: { slab: 0.2 },
    keys: { shopsBelow: 0.6, arcade: 0.5, quickBuild: 0.5, blankBase: -0.4, crowding: 0.4, full: 0.4, fullWork: 0.5, emptyWork: -0.5, empty: -0.4, pricey: -0.3, view: 0.2, luxury: 0.2 },
    slogans: ['Open for business', 'Shops on every street', 'Let the city grow', 'Build it and they will come'],
  },
  {
    id: 'locals', short: 'Residents', name: 'The Residents’ Association', members: 'long-time neighbours', icon: 'home', color: '#d47fa6', base: 0.16,
    blurb: 'Their street, their light, their parking. New buildings should fit in and not tower over anyone.',
    axes: { dense: -0.5, ornate: 0.1 },
    walls: { brick: 0.2, render: 0.2 },
    roofs: { gable: 0.2, hip: 0.2 },
    features: { windCrown: -0.3, cantilever: -0.2 },
    massing: { stacked: -0.3 },
    keys: { overshadow: -0.7, crowding: -0.5, fitsIn: 0.5, hum: -0.5, clash: -0.4, greenStreet: 0.3, tone: 0.3, familiar: 0.3, novel: -0.2 },
    slogans: ['Not on our street', 'Protect our light', 'Ask the neighbours first', 'Keep it human-sized'],
  },
];
export const GROUP_BY_ID = new Map(GROUPS.map((g) => [g.id, g]));
export const GROUP_INDEX = new Map(GROUPS.map((g, i) => [g.id, i]));

const TASTE_NAMES: Record<string, string> = {
  stone: 'stone', brick: 'brick', timber: 'timber', glass: 'glass', beton: 'raw concrete', panel: 'prefab panels', render: 'painted render', siding: 'weatherboard',
  ornament: 'ornament', arcade: 'arcades', planters: 'planted balconies', greenRoof: 'green roofs', roofGarden: 'roof gardens', skyGarden: 'sky gardens', solarSkin: 'solar panels', windCrown: 'wind turbines',
  cantilever: 'overhangs', pilotis: 'buildings on columns', balconies: 'balconies', courtyard: 'courtyards', loggias: 'loggias', terraces: 'terraces', briseSoleil: 'sun fins', monumental: 'monumental walls',
  mansard: 'mansard roofs', butterfly: 'butterfly roofs', gable: 'pitched roofs', hip: 'hipped roofs', flat: 'flat roofs', green: 'green roofs', vault: 'vaulted roofs',
  stacked: 'stacked boxes', terraced: 'stepped terraces', slab: 'slabs',
};
const KEY_NAMES: Record<string, string> = {
  budget: 'affordable homes', luxury: 'luxury flats', pricey: 'expensive extras', cramped: 'cramped flats', space: 'room to live', park: 'parks nearby', lifts: 'living high up',
  shopsBelow: 'shops at street level', quickBuild: 'quick building', blankBase: 'blank walls on the street', crowding: 'more people', overshadow: 'towers over houses', fitsIn: 'buildings that fit in',
  hum: 'noisy turbines', novel: 'something new', familiar: 'the familiar', clash: 'buildings that clash', noGreen: 'buildings with no green', concreteCarbon: 'concrete’s carbon', smog: 'smog',
};

/** What a group likes and dislikes, in words. */
export function tastesOf(g: GroupDef): { likes: string[]; dislikes: string[] } {
  const items: [string, number][] = [...Object.entries(g.walls), ...Object.entries(g.features), ...Object.entries(g.roofs), ...Object.entries(g.massing)].map(([k, v]) => [TASTE_NAMES[k] ?? k, v ?? 0]);
  for (const [k, v] of Object.entries(g.keys)) if (KEY_NAMES[k]) items.push([KEY_NAMES[k], v]);
  const seen = new Set<string>();
  const uniq = items.filter(([n]) => !seen.has(n) && seen.add(n));
  return {
    likes: uniq.filter(([, v]) => v >= 0.35).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n]) => n),
    dislikes: uniq.filter(([, v]) => v <= -0.35).sort((a, b) => a[1] - b[1]).slice(0, 4).map(([n]) => n),
  };
}

/** Each city's founding mix: the same six groups, in different proportions. */
export function foundingShares(civSeed: number, preset: string): number[] {
  const tilt: Record<string, Partial<Record<GroupId, number>>> = {
    lakes: { green: 1.3, family: 1.1 }, coastal: { business: 1.25, modern: 1.15 }, river: { heritage: 1.3, business: 1.1 }, highlands: { heritage: 1.2, locals: 1.25 },
  };
  const t = tilt[preset] ?? {};
  const raw = GROUPS.map((g, i) => g.base * (0.55 + 0.9 * hash01(civSeed, 7717, i)) * (t[g.id] ?? 1));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((v) => v / sum);
}

/** How much a group likes a style (its walls, roof, features, massing and leanings), −1 … 1. */
export function likeOf(g: GroupDef, m: Movement): number {
  let s = 0;
  for (const [k, v] of Object.entries(g.axes) as [keyof Axes, number][]) s += v * m.axes[k] * 0.35;
  if (m.local) {
    // The old way of building: dear to some, dull to others.
    s += g.id === 'heritage' ? 0.3 : g.id === 'locals' ? 0.2 : g.id === 'modern' ? -0.15 : 0;
    return clamp(Math.tanh(s * 1.4), -1, 1);
  }
  s += g.walls[m.wall] ?? 0;
  s += (g.roofs[m.roof] ?? 0) * 0.6;
  for (const f of m.features) s += (g.features[f] ?? 0) * 0.5;
  s += g.massing[m.massing] ?? 0;
  return clamp(Math.tanh(s * 1.2), -1, 1);
}

/** How a group would take to a building: its look, and what it would be like (from the factors people react to). */
export function groupScore(g: GroupDef, factors: Factor[], look?: Movement): number {
  let s = 0, w = 0;
  for (const f of factors) {
    if (f.blame) continue;
    const k = g.keys[f.key] ?? 0;
    const weight = Math.abs(f.w) + Math.abs(k) + 0.1;
    s += (f.w + 0.8 * k) * weight;
    w += weight;
  }
  const fromFactors = w ? s / w : 0;
  const fromLook = look ? likeOf(g, look) : 0;
  return clamp(fromFactors * 0.7 + fromLook * 0.5, -1, 1);
}

/** Approval (0–100) from a −1 … 1 score, on the same scale as a trial's meter. */
export function approvalFromScore(s: number): number {
  return Math.round(clamp(50 + 50 * Math.tanh(1.6 * s), 2, 98));
}

/** A middling site for judging a design before it has a place. */
const ANYWHERE: Site = { lv: 0.45, pollution: 0.05, noise: 0.2, park: 0.2, nearFloors: 2.5, nearCount: 6, shore: false, familiarity: 0.55 };

/** What each group would likely think of a design, wherever it went. */
export function predictGroups(c: Concept): { id: GroupId; score: number }[] {
  const f = assess(c, ANYWHERE);
  return GROUPS.map((g) => ({ id: g.id, score: groupScore(g, f, c.look) }));
}
