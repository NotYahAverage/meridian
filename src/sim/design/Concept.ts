import { Rng } from '../../core/rng';
import { hashStr } from '../research/Generate';
import { type Axes, type FeatureId, type Massing, type Movement, type RoofKind, type WallKind, clampAxes, hsl, makeMovement, wallPalette } from '../style/Movements';
import { CATEGORY_LABEL, type Height, IDEAS, IDEA_BY_ID, type IdeaCategory, type Use } from './Ideas';
import { type Mention, type Unknown, interpret, leanOf } from './Interpret';

/**
 * Turns what the player asked for (typed words plus cards they added or
 * removed) into a design that can be built: a building kind and size, and a
 * look (materials, roof, features, palette) for the style-aware generators.
 * Missing choices are taken from the city's current style; clashes are
 * resolved and explained.
 */

export interface DesignInput {
  text: string;
  /** Idea cards the player added by hand. */
  added: string[];
  /** Ideas the player removed (even if the text asks for them). */
  removed: string[];
  /** Typed ideas the player swapped for another (from, to): only while the text still asks for them. */
  swaps?: [string, string][];
}

export interface DesignContext {
  civSeed: number;
  day: number;
  /** Ideas the architects know. */
  known: Set<string>;
  /** The style to fill gaps from (the city's leading movement). */
  base: Movement;
}

export interface Chip {
  id: string;
  label: string;
  category: IdeaCategory | 'window' | 'colour' | 'other';
  locked: boolean;
  hint?: string;
  /** From the text (with the words that asked for it) or a card. */
  source: 'text' | 'card' | 'auto';
  phrase?: string;
  /** Read as a near spelling ("brik" → Brick). */
  fuzzy?: string;
  strong?: boolean;
  weak?: boolean;
}

export type BuildKind = 'house' | 'townhouse' | 'lowrise' | 'midrise' | 'tower' | 'shop' | 'mixeduse' | 'office' | 'officeTower';

export interface Concept {
  name: string;
  description: string;
  kind: BuildKind;
  use: Use;
  height: Height;
  floors: number;
  level: number;
  /** Lot frontage and depth (m). */
  w: number;
  d: number;
  look: Movement;
  chips: Chip[];
  /** Ideas asked for that the architects don't know yet. */
  locked: Chip[];
  /** Ideas the player ruled out ("no balconies"). */
  blocked: string[];
  notes: string[];
  unknown: Unknown[];
  /** How bold it is, 1–5: sets how long a prototype is tested (months). */
  ambition: number;
}

const LOT: Record<BuildKind, [number, number]> = {
  house: [20, 32], townhouse: [30, 30], lowrise: [34, 36], midrise: [38, 38], tower: [40, 40], shop: [20, 26], mixeduse: [30, 32], office: [40, 40], officeTower: [40, 40],
};

const FLOORS: Record<Height, [number, number]> = { house: [1, 2], row: [2, 3], low: [3, 4], mid: [5, 9], tall: [10, 20], sky: [21, 34] };

function kindFor(use: Use, height: Height): BuildKind {
  if (use === 'offices') return height === 'tall' || height === 'sky' ? 'officeTower' : 'office';
  if (use === 'shops') return height === 'house' || height === 'row' || height === 'low' ? 'shop' : 'mixeduse';
  if (use === 'mixed') return height === 'tall' || height === 'sky' ? 'tower' : 'mixeduse';
  return height === 'house' ? 'house' : height === 'row' ? 'townhouse' : height === 'low' ? 'lowrise' : height === 'mid' ? 'midrise' : 'tower';
}

function heightForFloors(n: number, use: Use): Height {
  if (use === 'homes' && n <= 2) return 'house';
  if (n <= 4) return 'low';
  if (n <= 9) return 'mid';
  if (n <= 20) return 'tall';
  return 'sky';
}

const NOUN: Record<BuildKind, string> = {
  house: 'House', townhouse: 'Rows', lowrise: 'Flats', midrise: 'Flats', tower: 'Tower', shop: 'Shops', mixeduse: 'Block', office: 'Offices', officeTower: 'Tower',
};

const ADJ: Record<string, string> = {
  timber: 'Timber', stone: 'Stone', concrete: 'Concrete', glass: 'Glass', brick: 'Brick', panels: 'Panel', siding: 'Clapboard', render: 'Painted',
  planters: 'Garden', roofgarden: 'Roof-Garden', skygarden: 'Sky-Garden', terraces: 'Terrace', arcade: 'Arcade', solar: 'Solar', wind: 'Wind',
  courtyard: 'Courtyard', monumental: 'Monument', ornament: 'Grand', cantilever: 'Floating', loggias: 'Loggia', pilotis: 'Stilt', stacked: 'Stacked',
  greenroof: 'Green-Roof', eco: 'Eco', luxury: 'Luxury', budget: 'People’s', cosy: 'Little', modern: 'Modern', traditional: 'Old-Town', sky: 'Sky', tall: 'Tall',
};

const DESCRIBE: Record<string, string> = {
  planters: 'planted balconies on every floor', roofgarden: 'a garden on the roof', skygarden: 'gardens open to the sky part-way up', terraces: 'floors stepping back into planted terraces',
  brise: 'deep fins shading every window', pilotis: 'raised on columns over open ground', arcade: 'an arcade sheltering the shops', monumental: 'thick, monumental walls',
  solar: 'a skin of solar panels', wind: 'turbines spinning on the roof', ornament: 'cornices and carved detail', cantilever: 'upper floors reaching out over the street',
  loggias: 'deep loggias', courtyard: 'a shared courtyard garden', stacked: 'volumes stacked like building blocks', balconies: 'balconies', greenroof: 'a planted roof',
};

const WALL_WORD: Record<WallKind, string> = { render: 'painted render', brick: 'brick', stone: 'stone', beton: 'raw concrete', panel: 'prefab panels', timber: 'timber', glass: 'glass', siding: 'weatherboard' };
const KIND_WORD: Record<BuildKind, string> = {
  house: 'house', townhouse: 'row of houses', lowrise: 'low-rise block of flats', midrise: 'block of flats', tower: 'tower of homes', shop: 'row of shops', mixeduse: 'block of homes over shops', office: 'office building', officeTower: 'office tower',
};

/** Resolves a garden mention by where it goes and how big the building is. */
function gardenIdea(m: Mention, height: Height, balconyNear: boolean): string {
  if (balconyNear) return 'planters';
  switch (m.placement) {
    case 'roof': return 'roofgarden';
    case 'all': return 'planters';
    case 'sky': return height === 'tall' || height === 'sky' ? 'skygarden' : 'roofgarden';
    case 'base':
    case 'inside': return 'courtyard';
    default: return height === 'tall' || height === 'sky' ? 'planters' : height === 'house' || height === 'row' ? 'eco' : 'roofgarden';
  }
}

export function compileConcept(input: DesignInput, ctx: DesignContext): Concept {
  const interp = interpret(input.text);
  const notes: string[] = [];
  const removed = new Set(input.removed);
  const swapped = new Map(input.swaps ?? []);
  // Ideas wanted, in order, with how strongly; and ideas ruled out.
  const want = new Map<string, { strength: number; m?: Mention; source: Chip['source'] }>();
  const blocked = new Set<string>();
  const ask = (id: string, strength: number, m: Mention | undefined, source: Chip['source']) => {
    if (source === 'text') id = swapped.get(id) ?? id;
    if (removed.has(id)) return;
    const prev = want.get(id);
    if (!prev || prev.strength < strength) want.set(id, { strength, m, source: prev?.source === 'text' ? 'text' : source });
  };
  const ideaMentions = interp.mentions.filter((m) => 'idea' in m.target);
  // Size first: gardens depend on it.
  let use: Use | undefined;
  let height: Height | undefined;
  const uses = new Set<Use>();
  for (const m of ideaMentions) {
    const def = IDEA_BY_ID.get((m.target as { idea: string }).idea)!;
    if (m.negated) continue;
    if (def.use) uses.add(def.use);
    if (def.height) height = def.height;
  }
  for (const id of input.added) {
    const def = IDEA_BY_ID.get(id);
    if (def?.use) uses.add(def.use);
    if (def?.height) height = def.height;
  }
  const shopsAtBase = ideaMentions.some((m) => (m.target as { idea: string }).idea === 'shops' && m.placement === 'base');
  if (uses.has('mixed') || (uses.has('homes') && uses.has('shops')) || (shopsAtBase && !uses.has('offices'))) use = 'mixed';
  else if (uses.has('offices')) use = 'offices';
  else if (uses.has('shops')) use = 'shops';
  else use = 'homes';
  if (uses.has('offices') && uses.has('homes')) notes.push('Homes and offices can’t share a building yet: designed as offices.');
  if (interp.floors) {
    const hf = heightForFloors(interp.floors, use);
    if (height && height !== hf && height !== 'row') notes.push(`${interp.floors} storeys makes it ${hf === 'sky' ? 'a skyscraper' : hf === 'tall' ? 'a tower' : hf === 'mid' ? 'mid-rise' : 'low-rise'}.`);
    if (height !== 'row' || interp.floors > 3) height = hf;
  }
  height ??= use === 'offices' ? 'mid' : use === 'shops' ? 'low' : use === 'mixed' ? 'low' : 'low';
  // Uses and heights become chips too.
  ask(use === 'mixed' ? 'mixed' : use, 1, ideaMentions.find((m) => IDEA_BY_ID.get((m.target as { idea: string }).idea)?.use), 'text');
  ask(height, 1, ideaMentions.find((m) => IDEA_BY_ID.get((m.target as { idea: string }).idea)?.height), interp.floors || ideaMentions.some((m) => IDEA_BY_ID.get((m.target as { idea: string }).idea)?.height) ? 'text' : 'auto');
  // Everything else from the text.
  const balconyAt = interp.mentions.filter((m) => 'balcony' in m.target);
  for (const m of interp.mentions) {
    let id: string | undefined;
    if ('idea' in m.target) {
      const def = IDEA_BY_ID.get(m.target.idea)!;
      if (def.use || def.height) continue;
      id = def.id;
    } else if ('garden' in m.target) {
      id = gardenIdea(m, height, balconyAt.some((b) => Math.abs(b.at - m.at) <= 4));
    } else if ('balcony' in m.target) {
      const gardenNear = interp.mentions.some((o) => 'garden' in o.target && Math.abs(o.at - m.at) <= 4);
      const deep = /deep|recess|inset|shelter/.test(input.text.toLowerCase());
      id = gardenNear ? 'planters' : deep ? 'loggias' : 'balconies';
    }
    if (!id) continue;
    if (m.negated) blocked.add(id);
    else ask(id, m.strength, m, 'text');
  }
  for (const id of input.added) if (!IDEA_BY_ID.get(id)?.use && !IDEA_BY_ID.get(id)?.height) ask(id, 1, undefined, 'card');
  for (const id of blocked) want.delete(id);
  // Known or locked.
  const chips: Chip[] = [];
  const locked: Chip[] = [];
  for (const [id, w] of want) {
    const def = IDEA_BY_ID.get(id);
    if (!def) continue;
    const chip: Chip = { id, label: def.name, category: def.category, locked: !ctx.known.has(id), source: w.source, phrase: w.m?.phrase, fuzzy: w.m?.fuzzy, strong: w.strength > 1.2, weak: w.strength < 0.8 };
    if (chip.locked) {
      chip.hint = def.unlock?.hint;
      locked.push(chip);
    } else chips.push(chip);
  }
  const has = (id: string) => want.has(id) && ctx.known.has(id);
  // A locked size falls back to the biggest known one.
  if (!ctx.known.has(height)) {
    const order: Height[] = ['sky', 'tall', 'mid', 'low'];
    const fallback = order.find((h) => order.indexOf(h) > order.indexOf(height!) && ctx.known.has(h)) ?? 'mid';
    notes.push(`Your architects can’t build ${height === 'sky' ? 'skyscrapers' : 'towers'} yet: designed as ${fallback === 'mid' ? 'mid-rise' : fallback === 'tall' ? 'a tower' : 'low-rise'} instead.`);
    height = fallback;
    const def = IDEA_BY_ID.get(fallback)!;
    chips.push({ id: fallback, label: def.name, category: 'height', locked: false, source: 'auto' });
  }
  const kind = kindFor(use, height);
  const [fmin, fmax] = FLOORS[height];
  let floors = interp.floors ? Math.max(fmin, Math.min(fmax, interp.floors)) : Math.round((fmin + fmax) / 2);
  if (kind === 'shop') floors = Math.min(2, floors);
  if (kind === 'house') floors = Math.min(2, Math.max(1, floors));
  if (has('cosy') && (height === 'tall' || height === 'sky')) notes.push('Cosy and tall pull in different directions: it stays a tower, with a friendlier face.');
  // Character on the axes: half the city's style, plus every idea's nudge.
  const lean: Axes = { green: 0, heavy: 0, ornate: 0, dense: 0, hand: 0 };
  for (const [id, w] of want) {
    if (!ctx.known.has(id)) continue;
    const def = IDEA_BY_ID.get(id)!;
    for (const [k, v] of Object.entries(def.lean ?? {}) as [keyof Axes, number][]) lean[k] += v * w.strength;
  }
  for (const [k, v] of Object.entries(leanOf(interp.mentions)) as [keyof Axes, number][]) lean[k] += v;
  const base = ctx.base.axes;
  const axes = clampAxes({ green: base.green * 0.5 + lean.green, heavy: base.heavy * 0.5 + lean.heavy, ornate: base.ornate * 0.5 + lean.ornate, dense: base.dense * 0.5 + lean.dense, hand: base.hand * 0.5 + lean.hand });
  // The look: generated from the axes, then the explicit choices win.
  const key = hashStr(input.text.toLowerCase().trim(), [...want.keys()].sort().join(','));
  const look = makeMovement(ctx.civSeed, 1000 + (key % 100000), axes, ctx.day);
  look.explicit = true;
  const walls = [...want.entries()].filter(([id]) => ctx.known.has(id) && IDEA_BY_ID.get(id)!.wall).sort((a, b) => b[1].strength - a[1].strength || (a[1].m?.at ?? 99) - (b[1].m?.at ?? 99));
  const r = new Rng(key);
  if (walls.length) {
    const wall = IDEA_BY_ID.get(walls[0][0])!.wall!;
    if (wall !== look.wall) look.wallColors = wallPalette(wall, r.next(), axes, r);
    look.wall = wall;
    if (walls.length > 1) {
      look.base = IDEA_BY_ID.get(walls[1][0])!.wall!;
      look.baseColor = wallPalette(look.base, r.next(), axes, r)[0];
    }
    if (walls.length > 2) notes.push(`Three materials is one too many: ${IDEA_BY_ID.get(walls[2][0])!.name.toLowerCase()} was left out.`);
  } else if (!ctx.known.has(WALL_IDEA[look.wall]) || !want.size || ![...want.keys()].some((id) => ctx.known.has(id) && IDEA_BY_ID.get(id)!.category !== 'use' && IDEA_BY_ID.get(id)!.category !== 'height')) {
    // Nothing said about character, or the style suggests a material they can't use yet: the city's own way of building.
    look.wall = ctx.base.wall;
    look.wallColors = ctx.base.wallColors;
  } else if (!walls.length && ctx.base.wall !== look.wall && r.chance(0.4)) {
    look.wall = ctx.base.wall;
    look.wallColors = ctx.base.wallColors;
  }
  // Never a material they haven't learned, whatever the style suggests.
  if (!ctx.known.has(WALL_IDEA[look.wall])) {
    const prefer: WallKind[] = axes.hand < -0.3 ? ['glass', 'panel', 'render', 'brick'] : axes.heavy > 0.3 ? ['stone', 'brick', 'render'] : axes.hand > 0.3 ? ['timber', 'siding', 'brick'] : ['brick', 'render', 'siding'];
    look.wall = prefer.find((w) => ctx.known.has(WALL_IDEA[w])) ?? 'render';
    look.wallColors = wallPalette(look.wall, r.next(), axes, r);
  }
  if (!ctx.known.has(WALL_IDEA[look.base])) {
    look.base = look.wall;
    look.baseColor = look.wallColors[0];
  }
  // Colours.
  const colour = interp.mentions.find((m) => 'colour' in m.target && !m.negated);
  if (colour && 'colour' in colour.target) {
    const [h, s, l] = colour.target.colour;
    look.wallColors = [0, 1, 2, 3].map((i) => hsl(h + (i - 1.5) * 0.015, Math.max(0, s + (i - 1.5) * 0.03), Math.min(0.95, Math.max(0.12, l + (i - 1.5) * 0.04))));
    chips.push({ id: `colour:${colour.target.label}`, label: colour.target.label, category: 'colour', locked: false, source: 'text', phrase: colour.phrase });
  }
  // Roof.
  const roofs = [...want.keys()].filter((id) => ctx.known.has(id) && IDEA_BY_ID.get(id)!.roof);
  let roof: RoofKind = roofs.length ? IDEA_BY_ID.get(roofs[roofs.length - 1])!.roof! : height === 'tall' || height === 'sky' ? 'flat' : ctx.base.roof;
  if (roofs.length > 1) notes.push('Only one kind of roof fits: kept the last one mentioned.');
  if ((height === 'tall' || height === 'sky') && (roof === 'gable' || roof === 'butterfly' || roof === 'shed')) {
    notes.push('A tower that tall gets a hipped crown rather than a pitched roof.');
    roof = 'hip';
  }
  const roofIdea = ROOF_IDEA.get(roof);
  if (roofIdea && !ctx.known.has(roofIdea)) roof = height === 'house' || height === 'row' ? 'gable' : height === 'tall' || height === 'sky' ? 'hip' : 'flat';
  look.roof = roof;
  if (roof === 'green') look.roofColors = [0x5f7a3c, 0x6b8243];
  // Features and massing.
  const features: FeatureId[] = [];
  let massing: Massing = 'block';
  for (const id of want.keys()) {
    if (!ctx.known.has(id)) continue;
    const def = IDEA_BY_ID.get(id)!;
    if (def.feature && !features.includes(def.feature)) features.push(def.feature);
    if (def.massing) massing = def.massing;
  }
  const tall = kind === 'tower' || kind === 'officeTower';
  if (features.includes('skyGarden') && !tall) {
    features.splice(features.indexOf('skyGarden'), 1, 'roofGarden');
    notes.push('Sky gardens need a tower: this one gets a roof garden instead.');
  }
  if (massing === 'courtyard' && (kind === 'house' || kind === 'townhouse' || kind === 'shop' || tall)) {
    massing = 'block';
    notes.push('A courtyard needs a block of flats or offices to wrap around it.');
  }
  if (features.includes('arcade') && (kind === 'house' || kind === 'townhouse')) notes.push('An arcade needs shops: add “shops at the bottom”.');
  if (blocked.has('balconies')) {
    for (const f of ['balconies', 'planters', 'loggias'] as FeatureId[]) if (features.includes(f)) features.splice(features.indexOf(f), 1);
  }
  look.features = features;
  look.massing = massing;
  // Windows.
  const win = interp.mentions.find((m) => 'window' in m.target && !m.negated);
  if (win && 'window' in win.target) {
    look.windows = [win.target.window, win.target.window];
    chips.push({ id: `window:${win.target.window}`, label: win.target.label, category: 'window', locked: false, source: 'text', phrase: win.phrase });
  }
  // How grand it is.
  const level = has('luxury') ? 3 : has('budget') ? 1 : 2;
  // Name and description.
  // Name: a character or a material, then a feature ("The Concrete Garden Tower", "The Little Brick House").
  const pick = (cat: IdeaCategory) => [...want.entries()].filter(([id]) => ctx.known.has(id) && ADJ[id] && IDEA_BY_ID.get(id)!.category === cat).sort((a, b) => b[1].strength - a[1].strength).map(([id]) => ADJ[id])[0];
  const feat = pick('feature') ?? (want.has('greenroof') && ctx.known.has('greenroof') ? ADJ.greenroof : undefined);
  const first = feat ? (pick('material') ?? pick('character')) : pick('character');
  const second = feat ?? pick('material') ?? (kind === 'tower' || kind === 'officeTower' ? undefined : pick('height'));
  const adj = [first, second].filter((x): x is string => !!x && x !== 'Tall');
  const name = `The ${adj.length ? `${adj.join(' ')} ` : ''}${NOUN[kind]}`;
  const parts = features.map((f) => DESCRIBE[[...want.keys()].find((id) => IDEA_BY_ID.get(id)?.feature === f || (f === 'greenRoof' && id === 'greenroof')) ?? ''] ?? '').filter(Boolean);
  if (massing === 'stacked') parts.push(DESCRIBE.stacked);
  const floorWord = kind === 'house' || kind === 'townhouse' || kind === 'shop' ? '' : `${floors}-storey `;
  const kindWord = kind === 'tower' && use === 'mixed' ? 'tower of homes over shops' : KIND_WORD[kind];
  const description = `A ${floorWord}${kindWord} in ${WALL_WORD[look.wall]}${parts.length ? `, with ${parts.slice(0, -1).join(', ')}${parts.length > 1 ? ' and ' : ''}${parts[parts.length - 1]}` : ''}.`;
  // Ambition: big, unusual buildings take longer to prove.
  const unusual = features.length + (massing !== 'block' ? 1 : 0) + (look.wall !== ctx.base.wall ? 1 : 0);
  const ambition = Math.max(1, Math.min(5, Math.round((height === 'house' || height === 'row' ? 0.6 : height === 'low' ? 1.2 : height === 'mid' ? 2 : height === 'tall' ? 3 : 3.8) + unusual * 0.45)));
  chips.sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category));
  return { name, description, kind, use, height, floors, level, w: LOT[kind][0], d: LOT[kind][1], look, chips, locked, blocked: [...blocked], notes, unknown: interp.unknown, ambition };
}

const ROOF_IDEA = new Map(IDEAS.filter((i) => i.roof).map((i) => [i.roof!, i.id]));
const WALL_IDEA: Record<WallKind, string> = { render: 'render', brick: 'brick', siding: 'siding', timber: 'timber', stone: 'stone', beton: 'concrete', glass: 'glass', panel: 'panels' };

const ORDER: Chip['category'][] = ['use', 'height', 'material', 'colour', 'roof', 'feature', 'window', 'character', 'other'];

export { CATEGORY_LABEL };
