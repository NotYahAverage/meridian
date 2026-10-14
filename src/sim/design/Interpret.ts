import type { Axes } from '../style/Movements';
import { LEXICON, NEGATIONS, NUMBERS, PLACEMENTS, type Placement, STOPWORDS, STRONG, type Target, WEAK } from './Lexicon';

/**
 * Reads a typed description of a building ("a tall concrete tower with gardens
 * on every floor and shops at the bottom") and finds the ideas in it. It
 * understands phrases and synonyms, plurals and small typos, negation ("no
 * balconies"), intensity ("very", "a bit"), where things go ("on the roof",
 * "every floor") and storey counts. Words it doesn't know are reported with
 * the nearest thing it does know.
 */

export interface Mention {
  target: Target;
  /** The words that produced it. */
  phrase: string;
  /** Token position (for ordering). */
  at: number;
  /** 0.5 for "a bit", 1, or 1.6 for "very". */
  strength: number;
  negated: boolean;
  /** Matched by spelling similarity (the player may have made a typo). */
  fuzzy?: string;
  placement?: Placement;
}

export interface Unknown {
  word: string;
  /** Ideas it might have meant. */
  suggest: string[];
  note?: string;
}

export interface Interpretation {
  mentions: Mention[];
  unknown: Unknown[];
  /** Storeys asked for ("twelve storeys", "a 20-floor tower"). */
  floors?: number;
}

function stem(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(ss|us|is)$/.test(w)) return w;
  if (/(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[-_/]/g, ' ')
    .replace(/(\d+)/g, ' $1 ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

interface Entry {
  words: string[];
  target: Target;
}

// Phrase table keyed by stemmed words.
const PHRASES = new Map<string, Entry>();
let longest = 1;
for (const [phrases, target] of LEXICON) {
  for (const p of phrases) {
    const words = tokenize(p).map(stem);
    const key = words.join(' ');
    if (!PHRASES.has(key)) PHRASES.set(key, { words, target });
    longest = Math.max(longest, words.length);
  }
}
const SINGLE = [...PHRASES.entries()].filter(([, e]) => e.words.length === 1).map(([k]) => k);
const PLACE: { words: string[]; place: Placement }[] = [];
for (const [phrases, place] of PLACEMENTS) for (const p of phrases) PLACE.push({ words: tokenize(p).map(stem), place });
PLACE.sort((a, b) => b.words.length - a.words.length);

function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d: number[] = [];
  for (let j = 0; j <= b.length; j++) d[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

/** The closest single word the lexicon knows, if it's close enough to be a typo. */
function nearest(w: string): string | undefined {
  if (w.length < 4) return undefined;
  const max = w.length >= 8 ? 2 : 1;
  let best: string | undefined, bd = max + 1;
  for (const k of SINGLE) {
    const d = lev(w, k);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return bd <= max ? best : undefined;
}

function ideaOf(t: Target): string | undefined {
  return 'idea' in t ? t.idea : undefined;
}

export function interpret(text: string): Interpretation {
  const raw = tokenize(text);
  const toks = raw.map(stem);
  const used = new Array(toks.length).fill(false);
  const mentions: Mention[] = [];
  let floors: number | undefined;
  // Storey counts: "12 storeys", "twelve-storey", "20 floors".
  for (let i = 0; i < toks.length; i++) {
    const n = /^\d+$/.test(toks[i]) ? Number(toks[i]) : NUMBERS[raw[i]];
    if (n === undefined) continue;
    const next = toks[i + 1];
    if (next && /^(floor|storey|story|level|stor)/.test(next)) {
      floors = Math.max(1, Math.min(40, n));
      used[i] = used[i + 1] = true;
    }
  }
  // Placements, recorded by position.
  const places: { at: number; place: Placement }[] = [];
  for (let i = 0; i < toks.length; i++) {
    for (const p of PLACE) {
      if (p.words.every((w, k) => toks[i + k] === w)) {
        places.push({ at: i, place: p.place });
        break;
      }
    }
  }
  // Phrases, longest first at each position.
  for (let i = 0; i < toks.length; i++) {
    if (used[i]) continue;
    let hit: { e: Entry; n: number; fuzzy?: string } | null = null;
    for (let n = Math.min(longest, toks.length - i); n >= 1 && !hit; n--) {
      const key = toks.slice(i, i + n).join(' ');
      const e = PHRASES.get(key);
      if (e) hit = { e, n };
    }
    if (!hit && !STOPWORDS.has(raw[i]) && !NEGATIONS.has(raw[i]) && !STRONG.has(raw[i]) && !WEAK.has(raw[i])) {
      const near = nearest(toks[i]);
      if (near) hit = { e: PHRASES.get(near)!, n: 1, fuzzy: raw[i] };
    }
    if (!hit) continue;
    for (let k = 0; k < hit.n; k++) used[i + k] = true;
    // Negation and intensity in the few words before.
    let negated = false, strength = 1;
    for (let k = Math.max(0, i - 3); k < i; k++) {
      if (NEGATIONS.has(raw[k])) negated = true;
      if (STRONG.has(raw[k])) strength = 1.6;
      if (WEAK.has(raw[k])) strength = 0.5;
      // "and", "with" and "but" end a negation's reach.
      if ((raw[k] === 'and' || raw[k] === 'with' || raw[k] === 'but') && k < i - 1) negated = false;
    }
    if (i > 0 && raw[i - 1] === 'free' && negated) negated = true;
    // "plant-free", "car free": a negation after the word.
    if (raw[i + hit.n] === 'free') negated = true;
    const phrase = raw.slice(i, i + hit.n).join(' ');
    const m: Mention = { target: hit.e.target, phrase, at: i, strength, negated };
    if (hit.fuzzy) m.fuzzy = hit.fuzzy;
    // Gardens, balconies and shops take the nearest placement within a few words.
    if ('garden' in hit.e.target || 'balcony' in hit.e.target || ideaOf(hit.e.target) === 'shops' || ideaOf(hit.e.target) === 'mixed') {
      let best: { at: number; place: Placement } | undefined, bd = 7;
      for (const p of places) {
        const d = Math.abs(p.at - i);
        if (d < bd && !(p.at >= i && p.at < i + hit.n && p.place === 'roof')) {
          bd = d;
          best = p;
        }
      }
      if (best) m.placement = best.place;
    }
    mentions.push(m);
    i += hit.n - 1;
  }
  // Words left over.
  const unknown: Unknown[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < toks.length; i++) {
    if (used[i] || STOPWORDS.has(raw[i]) || NEGATIONS.has(raw[i]) || STRONG.has(raw[i]) || WEAK.has(raw[i]) || /^\d+$/.test(raw[i]) || NUMBERS[raw[i]] !== undefined) continue;
    if (PLACE.some((p) => p.words.includes(toks[i]))) continue;
    if (raw[i].length < 3 || seen.has(raw[i])) continue;
    seen.add(raw[i]);
    unknown.push({ word: raw[i], suggest: [] });
  }
  // Recognised-but-unsupported phrases become unknowns with a note and suggestions.
  for (const m of mentions) {
    if ('unsupported' in m.target) unknown.push({ word: m.phrase, suggest: m.target.suggest, note: m.target.unsupported });
  }
  return { mentions: mentions.filter((m) => !('unsupported' in m.target)), unknown, floors };
}

/** The sum of the axis nudges that aren't ideas (colourful, …). */
export function leanOf(ms: Mention[]): Partial<Axes> {
  const out: Partial<Axes> = {};
  for (const m of ms) {
    if (!('lean' in m.target) || m.negated) continue;
    for (const [k, v] of Object.entries(m.target.lean) as [keyof Axes, number][]) out[k] = (out[k] ?? 0) + v * m.strength;
  }
  return out;
}
