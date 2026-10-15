import { clamp } from '../../core/math';
import type { Use } from './Ideas';

/**
 * Adopted designs become styles the city builds in. A style spreads outward
 * from the street where its prototype was tested: new buildings nearby take
 * it up and owners renovate older ones in it. The better people liked the
 * prototype, the faster and further it spreads, and the happier the people
 * living in it are. The player can encourage, discourage or retire a style.
 */
export interface AdoptedStyle {
  /** Its movement's id in the city's style. */
  id: number;
  trialId: number;
  /** "Brick Garden style". */
  name: string;
  /** Where it started (the prototype). */
  x: number;
  z: number;
  street: string;
  day: number;
  /** Approval its prototype finished with. */
  approval: number;
  /** Building styles it is used for. */
  kinds: string[];
  /** 0 retired, 0.5 discouraged, 1 as it comes, 1.5 encouraged. */
  push: number;
  /** Older buildings renovated in it so far. */
  renovated: number;
}

export const PUSH_LEVELS: [number, string][] = [[0, 'Retire'], [0.5, 'Discourage'], [1, 'Let it spread'], [1.5, 'Encourage']];

const HOMES = ['house', 'modernHouse', 'townhouse', 'lowrise', 'midrise', 'tower', 'mixeduse'];

/** The kinds of building a design's style is used for, by what it was built for. */
export function kindsFor(use: Use): string[] {
  switch (use) {
    case 'homes':
      return HOMES;
    case 'mixed':
      return [...HOMES, 'shop'];
    case 'shops':
      return ['shop', 'mixeduse', 'hotel'];
    case 'offices':
      return ['office', 'officeTower', 'hotel'];
  }
}

/** How strongly people took to it, 0.05–1. */
export function appealOf(approval: number): number {
  return clamp((approval - 35) / 45, 0.05, 1);
}

function months(s: AdoptedStyle, day: number): number {
  return Math.max(0, (day - s.day) / 30);
}

/** How far it has spread from its prototype (m). */
export function reachOf(s: AdoptedStyle, day: number): number {
  if (s.push <= 0) return 0;
  const a = appealOf(s.approval);
  return Math.min(1600, (140 + months(s, day) * (25 + 70 * a)) * (0.6 + 0.4 * s.push));
}

/** Chance a new building at distance d takes it up. */
export function localChance(s: AdoptedStyle, d: number, day: number): number {
  const reach = reachOf(s, day);
  if (d >= reach) return 0;
  const a = appealOf(s.approval);
  return Math.min(0.95, 0.85 * Math.sqrt(a) * Math.min(1.2, s.push) * (1 - (d / reach) ** 2));
}

/** Its share of new building across the rest of the city: fashion travels. */
export function globalShare(s: AdoptedStyle, day: number): number {
  if (s.push <= 0) return 0;
  return Math.min(0.4, months(s, day) * 0.03 * appealOf(s.approval) * s.push);
}

/** Residents' and workers' happiness from living or working in it. */
export function moodOf(s: AdoptedStyle): number {
  return ((s.approval - 50) / 50) * 5;
}

/** Older buildings renovated in it this month. */
export function renovationsDue(s: AdoptedStyle): number {
  if (s.push <= 0) return 0;
  return Math.round(appealOf(s.approval) * 3 * s.push);
}

/** The share of the buildings within its reach a style settles at: cities keep a mix. */
export function saturation(s: AdoptedStyle): number {
  return Math.min(0.9, (0.35 + 0.45 * appealOf(s.approval)) * Math.min(1.15, 0.7 + 0.3 * s.push));
}

const NOUNS = new Set(['House', 'Houses', 'Rows', 'Flats', 'Tower', 'Block', 'Shops', 'Offices', 'Building', 'Homes']);

/** "The Brick Garden Block" → "Brick Garden style". */
export function styleName(design: string): string {
  const words = design.replace(/^The\s+/i, '').split(/\s+/).filter(Boolean);
  if (words.length > 1 && NOUNS.has(words[words.length - 1])) words.pop();
  // Revisions keep the family name.
  while (words.length > 1 && /^(I{1,3}|IV|V|VI{0,3}|IX|X)$/.test(words[words.length - 1])) words.pop();
  if (words.length > 1 && NOUNS.has(words[words.length - 1])) words.pop();
  return `${words.join(' ') || design} style`;
}

/** "The Brick Garden Block" → "The Brick Garden Block II"; "… II" → "… III". */
export function nextRevision(name: string): string {
  const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  const m = name.match(/^(.*?)\s+(I{1,3}|IV|V|VI{0,3}|IX|X)$/);
  if (m) {
    const i = numerals.indexOf(m[2]);
    return `${m[1]} ${numerals[Math.min(numerals.length - 1, i + 1)]}`.slice(0, 48);
  }
  return `${name} II`.slice(0, 48);
}
