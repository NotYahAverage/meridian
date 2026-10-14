import { Rng } from '../../core/rng';
import { eponym, hashStr } from '../research/Generate';
import type { MapPreset } from '../world/Terrain';

/**
 * Architectural movements: the styles a city's buildings are built in.
 *
 * Every style sits on five axes (green ↔ mineral, heavy ↔ light, ornate ↔
 * austere, dense ↔ spread, handmade ↔ machine-made). A movement is generated
 * from a position on those axes and the city's seed: its name, manifesto,
 * palette, walls, roofs, windows, massing and signature features all follow
 * from where it sits, and the seed makes each city's version its own. Two
 * cities heading the same way still end up with different movements.
 *
 * This module is pure data (no rendering): the renderer reads a movement to
 * draw a building in it, the simulation reads it for gameplay effects.
 */

export type AxisId = 'green' | 'heavy' | 'ornate' | 'dense' | 'hand';
/** Each axis from −1 to 1. */
export type Axes = Record<AxisId, number>;

export interface AxisDef {
  id: AxisId;
  /** Name of the positive end, then the negative one. */
  high: string;
  low: string;
}

export const AXES: AxisDef[] = [
  { id: 'green', high: 'Green', low: 'Mineral' },
  { id: 'heavy', high: 'Heavy', low: 'Light' },
  { id: 'ornate', high: 'Ornate', low: 'Austere' },
  { id: 'dense', high: 'Dense', low: 'Spread' },
  { id: 'hand', high: 'Handmade', low: 'Machine-made' },
];

export const zeroAxes = (): Axes => ({ green: 0, heavy: 0, ornate: 0, dense: 0, hand: 0 });

export type WallKind = 'render' | 'brick' | 'stone' | 'beton' | 'panel' | 'timber' | 'glass' | 'siding';
export type RoofKind = 'gable' | 'hip' | 'mansard' | 'flat' | 'green' | 'butterfly' | 'shed' | 'vault';
export type Massing = 'block' | 'terraced' | 'courtyard' | 'stacked' | 'slab';
export type FeatureId =
  | 'greenRoof' | 'roofGarden' | 'skyGarden' | 'terraces' | 'planters' | 'briseSoleil' | 'pilotis' | 'arcade'
  | 'monumental' | 'solarSkin' | 'windCrown' | 'ornament' | 'cantilever' | 'loggias' | 'courtyard' | 'balconies';

export interface FeatureDef {
  id: FeatureId;
  name: string;
  /** What it looks like. */
  look: string;
  /** Which way on the axes it leans. */
  lean: Partial<Axes>;
}

export const FEATURES: FeatureDef[] = [
  { id: 'greenRoof', name: 'Green roofs', look: 'Planted roofs of sedum and grasses', lean: { green: 1, hand: 0.1 } },
  { id: 'roofGarden', name: 'Roof gardens', look: 'Trees, lawns and pergolas on the roofs', lean: { green: 0.8, dense: 0.3, ornate: 0.1 } },
  { id: 'skyGarden', name: 'Sky gardens', look: 'Open planted floors part-way up towers', lean: { green: 0.8, dense: 0.7, hand: -0.3 } },
  { id: 'terraces', name: 'Planted terraces', look: 'Stepped set-backs, each one a garden', lean: { green: 0.7, heavy: 0.2, dense: -0.1 } },
  { id: 'planters', name: 'Vertical forest', look: 'Balconies spilling with planting', lean: { green: 1, dense: 0.4, heavy: -0.1 } },
  { id: 'briseSoleil', name: 'Brise-soleil', look: 'A deep grid of fins shading the windows', lean: { heavy: 0.8, hand: -0.4, ornate: -0.2 } },
  { id: 'pilotis', name: 'Pilotis', look: 'Buildings lifted on columns, the ground left open', lean: { hand: -0.7, heavy: -0.1, dense: 0.3, ornate: -0.3 } },
  { id: 'arcade', name: 'Arcades', look: 'Colonnades sheltering the shops along the street', lean: { ornate: 0.6, dense: 0.5, hand: 0.2 } },
  { id: 'monumental', name: 'Monumental mass', look: 'Thick walls, stacked volumes, heavy parapets', lean: { heavy: 1, dense: 0.4, ornate: 0.1 } },
  { id: 'solarSkin', name: 'Solar skins', look: 'Facades and roofs clad in solar panels', lean: { hand: -0.8, green: 0.5, heavy: -0.3 } },
  { id: 'windCrown', name: 'Wind crowns', look: 'Small turbines spinning on the rooftops', lean: { hand: -0.7, green: 0.5, dense: 0.4 } },
  { id: 'ornament', name: 'Ornament', look: 'Cornices, string courses, quoins and pediments', lean: { ornate: 1, hand: 0.4 } },
  { id: 'cantilever', name: 'Cantilevers', look: 'Upper floors reaching out over the street', lean: { heavy: -0.5, hand: -0.4, ornate: -0.3 } },
  { id: 'loggias', name: 'Loggias', look: 'Deep recessed balconies framed in solid walls', lean: { heavy: 0.6, ornate: 0.2, green: 0.1 } },
  { id: 'courtyard', name: 'Courtyards', look: 'Blocks wrapped around shared gardens', lean: { hand: 0.4, green: 0.4, dense: -0.2 } },
  { id: 'balconies', name: 'Balconies', look: 'Plain balconies on the street side', lean: {} },
];

export const FEATURE_BY_ID = new Map(FEATURES.map((f) => [f.id, f]));

/** Window families the facade shader knows (the number is the shader's window type). */
export const WINDOW_TYPES = ['Punched', 'Two-pane', 'French', 'Ribbon', 'Deep square', 'Arched', 'Full-height', 'Slot'] as const;

export interface Movement {
  id: number;
  /** "Kelvar Brutalism". */
  name: string;
  /** The eponym ("Kelvar"). */
  short: string;
  /** "A school of brutalism" — what kind of movement it is. */
  kind: string;
  manifesto: string;
  axes: Axes;
  /** The style the city started with (drawn by the classic generators). */
  local: boolean;
  /** Day it formed. */
  founded: number;
  wall: WallKind;
  /** sRGB hex colours its walls come in. */
  wallColors: number[];
  /** Ground floor / plinth finish. */
  base: WallKind;
  baseColor: number;
  trim: number;
  roof: RoofKind;
  roofColors: number[];
  /** Window types (shader table): the first is usual, the second for variety. */
  windows: number[];
  /** Window frames: 0 white, 1 warm stone, 2 charcoal, 3 bronze. */
  frameTone: number;
  /** Storey height and window bay, metres. */
  floorH: number;
  bay: number;
  massing: Massing;
  features: FeatureId[];
  accent: number;
  glass: number;
  /** A designed building: only the features listed are drawn (no defaults from the axes). */
  explicit?: boolean;
}

// ── Colour ──────────────────────────────────────────────────────────────────

export function hsl(h: number, s: number, l: number): number {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const to = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return (to(f(0)) << 16) | (to(f(8)) << 8) | to(f(4));
}

/** A small family of wall colours for a material, tinted by the movement's hue. */
export function wallPalette(wall: WallKind, hue: number, ax: Axes, r: Rng): number[] {
  const n = 4;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (r.next() - 0.5) * 0.06;
    switch (wall) {
      case 'beton':
        out.push(hsl(hue * 0.3 + 0.08 + j, 0.04 + 0.05 * r.next(), 0.55 + 0.12 * r.next() - 0.04 * ax.heavy));
        break;
      case 'stone':
        out.push(hsl(0.09 + j, 0.14 + 0.12 * r.next(), 0.68 + 0.12 * r.next()));
        break;
      case 'brick':
        out.push(hsl(0.03 + 0.05 * r.next() + j, 0.35 + 0.2 * r.next(), 0.33 + 0.18 * r.next()));
        break;
      case 'timber':
        out.push(hsl(0.07 + 0.03 * r.next() + j, 0.3 + 0.15 * r.next(), 0.36 + 0.16 * r.next()));
        break;
      case 'glass':
        out.push(hsl(hue + j, 0.12 + 0.12 * r.next(), 0.36 + 0.1 * r.next()));
        break;
      case 'panel':
        out.push(hsl(hue + j * 2, 0.08 + 0.18 * r.next(), 0.42 + 0.35 * r.next()));
        break;
      case 'siding':
        out.push(hsl(hue + j * 3, 0.12 + 0.2 * r.next(), 0.55 + 0.25 * r.next()));
        break;
      default:
        // Render: soft colours, livelier for ornate movements.
        out.push(hsl(hue + j * 3, 0.1 + 0.18 * r.next() + 0.12 * Math.max(0, ax.ornate), 0.66 + 0.18 * r.next()));
    }
  }
  return out;
}

// ── Choices ─────────────────────────────────────────────────────────────────

/** Picks the option with the best score (plus seeded jitter). */
function choose<T extends string | number>(r: Rng, options: [T, number][], jitter = 0.35): T {
  let best = options[0][0], bs = -Infinity;
  for (const [k, v] of options) {
    const s = v + (r.next() - 0.5) * jitter;
    if (s > bs) {
      bs = s;
      best = k;
    }
  }
  return best;
}

function wallFor(a: Axes, r: Rng): WallKind {
  return choose<WallKind>(r, [
    ['beton', a.heavy * 1.0 - a.hand * 0.6 - a.ornate * 0.3],
    ['stone', a.heavy * 0.6 + a.ornate * 0.7 + a.hand * 0.3 - 0.1],
    ['brick', a.hand * 0.8 + a.heavy * 0.3 + a.ornate * 0.2],
    ['render', a.ornate * 0.3 + a.hand * 0.1 - a.heavy * 0.1 + 0.15],
    ['panel', -a.hand * 0.7 - a.heavy * 0.3 - a.ornate * 0.2],
    ['glass', -a.heavy * 1.0 - a.hand * 0.6 + a.dense * 0.3 - 0.1],
    ['timber', a.hand * 0.6 + a.green * 0.7 - a.heavy * 0.4 - a.dense * 0.3],
    ['siding', a.hand * 0.5 - a.dense * 0.6 - a.heavy * 0.3 - 0.1],
  ]);
}

function roofFor(a: Axes, r: Rng): RoofKind {
  return choose<RoofKind>(r, [
    ['green', a.green * 1.2 - 0.2],
    ['flat', a.dense * 0.5 - a.hand * 0.4 + a.heavy * 0.3],
    ['gable', a.hand * 0.7 - a.dense * 0.6],
    ['hip', a.hand * 0.4 + a.ornate * 0.3 - a.dense * 0.4],
    ['mansard', a.ornate * 0.9 + a.dense * 0.2 - 0.1],
    ['butterfly', -a.hand * 0.6 - a.heavy * 0.5 - a.ornate * 0.3 - 0.1],
    ['shed', -a.hand * 0.4 + a.green * 0.2 - a.heavy * 0.3 - 0.1],
    ['vault', a.heavy * 0.4 + a.ornate * 0.2 - a.hand * 0.3 - 0.15],
  ]);
}

function windowsFor(a: Axes, r: Rng): number[] {
  const score: [number, number][] = [
    [0, a.hand * 0.4 + 0.2],
    [1, a.hand * 0.5 + a.ornate * 0.2],
    [2, a.ornate * 0.6 + a.hand * 0.2],
    [3, -a.hand * 0.6 - a.ornate * 0.4],
    [4, a.heavy * 0.8 - a.ornate * 0.2],
    [5, a.ornate * 1.0 + a.hand * 0.3 - 0.2],
    [6, -a.heavy * 0.9 - a.hand * 0.3],
    [7, a.heavy * 0.7 - a.hand * 0.3 - 0.1],
  ];
  const first = choose(r, score);
  const second = choose(r, score.filter(([k]) => k !== first));
  return [first, second];
}

function massingFor(a: Axes, r: Rng): Massing {
  return choose<Massing>(r, [
    ['block', a.ornate * 0.4 + 0.25],
    ['terraced', a.green * 0.8 + a.heavy * 0.2 - a.dense * 0.2],
    ['courtyard', a.hand * 0.5 + a.green * 0.3 - a.dense * 0.3],
    ['stacked', a.heavy * 0.6 + a.dense * 0.4 - a.hand * 0.3 - a.ornate * 0.2],
    ['slab', -a.hand * 0.6 + a.dense * 0.4 - a.ornate * 0.4],
  ]);
}

function featuresFor(a: Axes, massing: Massing, roof: RoofKind, r: Rng): FeatureId[] {
  const scored = FEATURES.filter((f) => Object.keys(f.lean).length).map((f) => {
    let dot = 0, norm = 0;
    for (const [k, v] of Object.entries(f.lean) as [AxisId, number][]) {
      dot += v * a[k];
      norm += v * v;
    }
    return { id: f.id, s: dot / Math.sqrt(norm || 1) + (r.next() - 0.5) * 0.3 };
  }).sort((x, y) => y.s - x.s);
  const out = scored.filter((x) => x.s > 0.12).slice(0, 4).map((x) => x.id);
  // The massing and roof bring their own features.
  if (massing === 'terraced' && !out.includes('terraces')) out.push('terraces');
  if (massing === 'courtyard' && !out.includes('courtyard')) out.push('courtyard');
  if (massing === 'slab' && !out.includes('pilotis')) out.push('pilotis');
  if (roof === 'green' && !out.includes('greenRoof')) out.push('greenRoof');
  return out.slice(0, 5);
}

// ── Names ───────────────────────────────────────────────────────────────────

const NOUNS: Record<string, string[]> = {
  'heavy+': ['Brutalism', 'Monumentalism', 'Concrete School'],
  'heavy-': ['Lightweight Modernism', 'Glass Movement', 'Transparency'],
  'green+': ['Biophilia', 'Garden Architecture', 'Living Architecture'],
  'green-': ['Rationalism', 'Mineral School'],
  'ornate+': ['Revival', 'Beaux-Arts', 'Ornamentalism', 'Deco'],
  'ornate-': ['Minimalism', 'Purism', 'New Objectivity'],
  'dense+': ['Metabolism', 'Megastructuralism', 'Vertical City'],
  'dense-': ['Garden Suburbs', 'Low-Rise Movement', 'Settlement Style'],
  'hand+': ['Vernacular', 'Arts and Crafts', 'Regionalism'],
  'hand-': ['High-Tech', 'Industrialism', 'Prefab Modernism'],
};
/** Some combinations have names of their own. */
const PAIRS: Record<string, string[]> = {
  'green+|hand-': ['Solarpunk', 'Eco-Tech'],
  'heavy+|dense+': ['Brutalism', 'Megastructuralism'],
  'heavy+|ornate+': ['Monumentalism', 'Neoclassicism'],
  'heavy-|hand-': ['High-Tech', 'Modernism'],
  'ornate+|hand+': ['Arts and Crafts', 'Art Nouveau'],
  'green+|dense+': ['Vertical Forest', 'Biophilic Towers'],
  'green+|hand+': ['Garden City', 'Organic Architecture'],
  'ornate+|dense+': ['Art Deco', 'Beaux-Arts'],
};

const MANIFESTO: Record<string, string[]> = {
  'green+': ['Buildings should breathe: every roof a garden, every balcony a planter.', 'Nature is not around the city but in it.'],
  'green-': ['Stone and order: the city as a made thing, not a garden.', 'Clean lines of masonry, with nature kept to the parks.'],
  'heavy+': ['Honest mass: raw material, deep shadows, walls that will stand for centuries.', 'Weight is permanence. Build as if for a thousand years.'],
  'heavy-': ['Light, open frames: buildings that almost aren’t there.', 'Glass and thin steel, so the sky reaches the street.'],
  'ornate+': ['A city should delight: colour, craft and detail on every street.', 'Ornament is how a building says it was cared for.'],
  'ornate-': ['Nothing that doesn’t need to be there.', 'Form follows function, and nothing follows decoration.'],
  'dense+': ['Build up, not out: the city as one great structure.', 'Many lives under one roof, close enough to share it.'],
  'dense-': ['Room to breathe: low buildings, gardens and courtyards.', 'Human scale above all: no building taller than a tree.'],
  'hand+': ['Built by hand from what the land gives.', 'Local brick, local stone, local hands.'],
  'hand-': ['Built like machines: prefabricated, precise, replaceable.', 'The factory is the new workshop.'],
};

const keyOf = (id: AxisId, v: number) => `${id}${v >= 0 ? '+' : '-'}`;

function strongest(a: Axes): [AxisId, number][] {
  return (Object.entries(a) as [AxisId, number][]).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
}

// ── Generation ──────────────────────────────────────────────────────────────

/** Generates a movement at a position on the axes. Deterministic per civilization and index. */
export function makeMovement(civSeed: number, id: number, axes: Axes, day: number, local = false): Movement {
  const a = { ...axes };
  const r = new Rng(hashStr(civSeed, 'movement', id));
  const short = eponym(civSeed, 'movement', id);
  const top = strongest(a);
  const [k1, k2] = [keyOf(top[0][0], top[0][1]), keyOf(top[1][0], top[1][1])];
  const pair = PAIRS[`${k1}|${k2}`] ?? PAIRS[`${k2}|${k1}`];
  const kindNoun = local ? 'Vernacular' : r.pick(pair && Math.abs(top[1][1]) > 0.25 ? pair : NOUNS[k1]);
  const name = local ? `${short} Vernacular` : r.chance(0.7) ? `${short} ${kindNoun}` : `The ${short} School`;
  const kind = local ? 'The local way of building' : `A school of ${kindNoun.toLowerCase()}`;
  const lines = top.slice(0, 3).filter(([, v], i) => i === 0 || Math.abs(v) > 0.2).map(([k, v]) => r.pick(MANIFESTO[keyOf(k, v)]));
  const manifesto = local ? `How ${short} has always built: ${lines[0].charAt(0).toLowerCase()}${lines[0].slice(1)}` : lines.join(' ');
  const wall = wallFor(a, r);
  const hue = r.next();
  const roof = roofFor(a, r);
  const massing = massingFor(a, r);
  const base: WallKind = a.heavy > 0.3 ? (a.hand > 0 ? 'stone' : 'beton') : a.ornate > 0.3 ? 'stone' : a.heavy < -0.3 ? 'glass' : wall === 'timber' || wall === 'siding' ? 'stone' : wall;
  const frameTone = choose(r, [
    [0, a.hand * 0.3 + a.ornate * 0.4 + 0.1],
    [1, a.ornate * 0.3 + a.hand * 0.3],
    [2, -a.hand * 0.5 + a.heavy * 0.3],
    [3, -a.hand * 0.2 + a.ornate * 0.2 - a.heavy * 0.1],
  ]);
  // Metal roofs in greys and patinas; tiled ones in terracotta, slate or a tinted tile.
  const metal = roof === 'butterfly' || roof === 'shed' || roof === 'vault' || roof === 'flat' || (roof !== 'green' && a.hand < -0.2);
  const roofColors = roof === 'green'
    ? [0x5f7a3c, 0x6b8243]
    : metal
      ? [hsl(hue, 0.04 + 0.05 * r.next(), 0.26 + 0.1 * r.next()), hsl(0.45 + 0.1 * r.next(), 0.12, 0.3), hsl(0.6, 0.04, 0.22)]
      : a.hand > 0.3 && r.chance(0.6)
        ? [hsl(0.04 + 0.03 * r.next(), 0.42, 0.32 + 0.06 * r.next()), hsl(0.05, 0.35, 0.28), hsl(0.06, 0.4, 0.36)]
        : [hsl(0.6 + 0.05 * r.next(), 0.06 + 0.06 * r.next(), 0.24 + 0.06 * r.next()), hsl(hue, 0.15, 0.28), hsl(0.6, 0.05, 0.2)];
  return {
    id,
    name,
    short,
    kind,
    manifesto,
    axes: a,
    local,
    founded: day,
    wall,
    wallColors: wallPalette(wall, hue, a, r),
    base,
    baseColor: base === 'beton' ? hsl(0.1, 0.05, 0.5) : base === 'glass' ? hsl(hue, 0.15, 0.3) : base === 'stone' ? hsl(0.09, 0.16, 0.62) : wallPalette(base, hue, a, r)[0],
    trim: frameTone === 2 ? hsl(hue, 0.05, 0.22) : frameTone === 3 ? hsl(0.08, 0.35, 0.32) : hsl(0.1, 0.12 + 0.1 * Math.max(0, a.ornate), 0.86),
    roof,
    roofColors,
    windows: windowsFor(a, r),
    frameTone,
    floorH: Math.round((3.0 + 0.35 * Math.max(0, a.heavy) + 0.3 * Math.max(0, a.ornate) - 0.1 * Math.max(0, a.dense)) * 20) / 20,
    bay: Math.round((3.3 - 0.5 * Math.max(0, a.heavy) + 0.4 * Math.max(0, -a.heavy) + 0.2 * Math.max(0, a.ornate)) * 10) / 10,
    massing,
    features: local ? [] : featuresFor(a, massing, roof, r),
    accent: hsl(r.next(), 0.45 + 0.2 * r.next(), 0.38),
    glass: hsl(0.55 + (r.next() - 0.5) * 0.12, 0.14 + 0.1 * r.next(), 0.38 + 0.08 * r.next()),
  };
}

/** Where a city's own way of building sits, from its land. */
export function localAxes(civSeed: number, preset: MapPreset | string): Axes {
  const r = new Rng(hashStr(civSeed, 'local'));
  const j = () => (r.next() - 0.5) * 0.3;
  const base: Partial<Record<string, Partial<Axes>>> = {
    lakes: { hand: 0.5, green: 0.25, dense: -0.3 },
    highlands: { hand: 0.5, heavy: 0.4, green: -0.1 },
    coastal: { ornate: 0.25, heavy: -0.2, hand: 0.25 },
    river: { hand: 0.4, ornate: 0.2, dense: -0.1 },
  };
  const b = base[preset] ?? { hand: 0.35 };
  return { green: (b.green ?? 0) + j(), heavy: (b.heavy ?? 0) + j(), ornate: (b.ornate ?? 0) + j(), dense: (b.dense ?? 0) + j(), hand: (b.hand ?? 0) + j() };
}

export function clampAxes(a: Axes): Axes {
  const c = (v: number) => Math.max(-1, Math.min(1, v));
  return { green: c(a.green), heavy: c(a.heavy), ornate: c(a.ornate), dense: c(a.dense), hand: c(a.hand) };
}

export function axisDistance(a: Axes, b: Axes): number {
  return Math.hypot(a.green - b.green, a.heavy - b.heavy, a.ornate - b.ornate, a.dense - b.dense, a.hand - b.hand);
}

/** Seed byte for a styled facade: the shader reads the window type and frame tone from it. */
export function styledSeed(windowType: number, frameTone: number, variant: number): number {
  return 128 + (windowType & 7) * 16 + (frameTone & 3) * 4 + (variant & 3);
}
