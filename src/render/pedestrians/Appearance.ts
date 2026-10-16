import * as THREE from 'three';
import { Errand } from '../../sim/walk/Pedestrians';

/** Bits of the per-person option mask (matches the option order in the models: bit k = option k + 1). */
export const OPT = { hairShort: 1, hairLong: 2, hairBun: 4, hat: 8, bag: 16, backpack: 32, umbrella: 64, coat: 128 } as const;

export enum Body {
  Adult = 0,
  Dress = 1,
  Child = 2,
}

export interface Look {
  body: Body;
  top: THREE.Color;
  bottom: THREE.Color;
  skin: THREE.Color;
  hair: THREE.Color;
  accent: THREE.Color;
  /** Light trainers rather than dark shoes. */
  lightShoes: boolean;
  mask: number;
  /** Forward stoop (older people). */
  lean: number;
}

export interface WeatherNow {
  rain: number;
  snow: number;
  temperature: number;
}

const lin = (hex: string[]) => hex.map((h) => new THREE.Color().setStyle(h, THREE.SRGBColorSpace));

const SKIN = lin(['#f3cfb0', '#e8b896', '#d6a07a', '#bf8560', '#a06a47', '#845236', '#653c25', '#4a2a19']);
const HAIR = lin(['#17120f', '#2b1c12', '#3d2716', '#5b3a20', '#7a4524', '#a06a3a', '#c79d5c', '#e0c48c']);
const GREY = lin(['#8f8b86', '#b3afa9', '#d4d1cb', '#e6e3dd']);
const TOPS = lin([
  '#2f3e52', '#8c2f2f', '#d8d3c6', '#3e6b4d', '#1e2024', '#6b5b95', '#c98b3a', '#4a7fb5', '#9d9d9d', '#e3b0a0', '#7a4b2a', '#2f6170',
  '#b85c7a', '#566b30', '#f0e6cf', '#c9473d', '#3d5a99', '#e5c84e', '#7d8f9c', '#5a2a3c', '#f2f2f0', '#2a5f4a', '#d87a4a', '#47335f',
]);
const BOTTOMS = lin(['#34496b', '#23304a', '#1d1d20', '#56585c', '#9e8961', '#57402d', '#1d2741', '#c6b796', '#4d5335', '#6b6f75', '#3a3a3e']);
const DRESSES = lin(['#8c2f2f', '#2f3e52', '#3e6b4d', '#6b5b95', '#c98b3a', '#b85c7a', '#1e2024', '#3d5a99', '#d6c49a', '#5a2a3c', '#2f6170']);
const COATS = lin(['#2a2b2e', '#5c4632', '#1f2a40', '#3f4630', '#6e2a2c', '#8c7a5c', '#44484f', '#151618', '#2c3f4f']);
const BAGS = lin(['#5a3a24', '#1c1c1e', '#8a6844', '#6e2626', '#2c3a52', '#3d3d3d', '#a5835a']);
const PACKS = lin(['#c13f2f', '#2b5fa8', '#e2b83c', '#2f6d4a', '#1d1d20', '#7a3f8f', '#e07a2f', '#3a8f9a']);
const UMBRELLAS = lin(['#1a1a1c', '#1f2c4a', '#7a1f24', '#e2c13c', '#2d5f3e', '#4a3a6e', '#c95a2a']);

const pick = <T>(list: T[], r: number) => list[Math.floor(r * list.length) % list.length];

/** What a person wears today: from their look seed, age and errand, and the weather. */
export function lookFor(seed: number, age: number, errand: Errand, w: WeatherNow, out: Look): Look {
  // Independent pseudo-random numbers from the seed.
  let s = seed >>> 0 || 1;
  const r = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const child = age < 13;
  const old = age > 62;
  out.body = child ? Body.Child : r() < 0.24 ? Body.Dress : Body.Adult;
  out.skin.copy(pick(SKIN, r()));
  out.hair.copy(old && r() < 0.75 ? pick(GREY, r()) : pick(HAIR, r()));
  out.top.copy(pick(TOPS, r()));
  out.bottom.copy(out.body === Body.Dress ? pick(DRESSES, r()) : pick(BOTTOMS, r()));
  out.lightShoes = r() < (child ? 0.5 : 0.25);
  out.lean = age > 72 ? 0.1 + (age - 72) * 0.004 : 0;
  // Hair.
  const hr = r();
  let mask = 0;
  if (old && hr < 0.2) mask |= 0;
  else if (hr < 0.45) mask |= OPT.hairShort;
  else if (hr < 0.75) mask |= OPT.hairLong;
  else if (hr < 0.9) mask |= OPT.hairBun;
  else mask |= child ? OPT.hairShort : 0;
  // Weather: coats and hats in the cold, umbrellas in the rain.
  const coatR = r(), hatR = r(), umbR = r();
  if (w.temperature < 8 && coatR < (w.temperature < 2 ? 0.92 : 0.7)) {
    mask |= OPT.coat;
    out.top.copy(pick(COATS, r()));
  }
  if (w.temperature < 3 && hatR < 0.4) mask |= OPT.hat;
  const umbrella = w.rain > 0.18 && umbR < (child ? 0.25 : 0.62);
  // Bags: school backpacks, work bags, shopping bags.
  const bagR = r();
  const bagChance = errand === Errand.Shop ? 0.55 : errand === Errand.Work || errand === Errand.Lunch || errand === Errand.Bus ? 0.4 : 0.15;
  const packChance = errand === Errand.School ? (child ? 0.92 : 0.2) : errand === Errand.Work || errand === Errand.Bus ? 0.14 : 0.07;
  if (bagR < packChance) mask |= OPT.backpack;
  else if (!child && bagR < packChance + bagChance) mask |= OPT.bag;
  if (umbrella) {
    mask |= OPT.umbrella;
    out.accent.copy(pick(UMBRELLAS, r()));
  } else if (mask & OPT.backpack) out.accent.copy(pick(PACKS, r()));
  else out.accent.copy(pick(BAGS, r()));
  // A hat takes the accent colour too; with an umbrella, a dark one.
  if (mask & OPT.hat && umbrella) out.accent.multiplyScalar(0.6);
  out.mask = mask;
  return out;
}

export function newLook(): Look {
  return { body: Body.Adult, top: new THREE.Color(), bottom: new THREE.Color(), skin: new THREE.Color(), hair: new THREE.Color(), accent: new THREE.Color(), lightShoes: false, mask: 0, lean: 0 };
}
