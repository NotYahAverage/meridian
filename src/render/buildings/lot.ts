import type { StyleId } from '../../sim/buildings/Archetypes';
import type { Rng } from '../../core/rng';
import { VM } from '../../sim/traffic/Vehicles';
import { type GeoBuilder, type Mat, P, type RGB, hex } from './BuildingKit';
import { PAL, parapet, roofscape } from './architecture';

export interface GenInput {
  style: StyleId;
  w: number;
  d: number;
  floors: number;
  level: number;
  seed: number;
}

export type Gen = (g: GeoBuilder, b: GenInput, r: Rng) => void;

// ── Palettes (sRGB) ─────────────────────────────────────────────────────────
export const SIDING = PAL.siding;
export const BRICKS = PAL.brick;
export const RENDER = PAL.render;
export const ROOFS = PAL.roof;
export const GLASS = [0x4f6170, 0x506b6a, 0x5c5a52, 0x6d7c88, 0x3d4b5a, 0x617783];
export const SPANDREL = [0xcfd2d4, 0x9ea3a8, 0x6a6f74, 0xd8d1c4, 0x3c4045];
export const INDUSTRY = [0xa9adab, 0x8f9a9e, 0xb5ab98, 0x7e8c86, 0x9c9488, 0x6f7f8c, 0xc2bba9, 0x8a8478, 0x9aa2a6];
export const ACCENTS = [0xb23a30, 0x2e6f9e, 0x2f8a55, 0xd0902a, 0x7a4a8a, 0x1f8a7e, 0xc0602a, 0x2c3e50];
export const OFFICE_GLASS = PAL.glass;
export const CAR_COLORS = [0xf2f2f0, 0x1b1c1f, 0xa9adb2, 0x5d6168, 0x1f3550, 0x8e1b1b, 0xc9bfa8, 0x3c7ac0];

export const c = (h: number): RGB => hex(h);
export const pick = <T>(r: Rng, a: readonly T[]) => r.pick(a);

export function m(color: RGB, pattern: number, seed: number, fh = 3, bay = 3): Mat {
  return { color, pattern, seed, fh, bay };
}

export const GRASS = (s: number): Mat => m(c(0x5f7a3c), P.GRASS, s);
export const PAVE = (s: number): Mat => m(c(0xb9b5ad), P.PAVING, s);
export const CONC = (s: number): Mat => m(c(0xa8a49c), P.CONCRETE, s);
export const ASPH = (s: number): Mat => m(c(0x4a4b4e), P.PARKING, s);

// ── Shared lot helpers ──────────────────────────────────────────────────────

export function trees(g: GeoBuilder, r: Rng, n: number, x0: number, z0: number, x1: number, z1: number, avoid?: [number, number, number, number], scale = 1): void {
  for (let i = 0; i < n * 3 && n > 0; i++) {
    const x = r.range(x0, x1);
    const z = r.range(z0, z1);
    if (avoid && x > avoid[0] - 2 && x < avoid[2] + 2 && z > avoid[1] - 2 && z < avoid[3] + 2) continue;
    g.prop({ kind: 'tree', x, y: 0, z, rot: r.next() * 6.28, scale: scale * r.range(0.65, 1.05), variant: r.int(0, 2) });
    n--;
  }
}

export function bushes(g: GeoBuilder, r: Rng, n: number, x0: number, x1: number, z: number): void {
  for (let i = 0; i < n; i++) {
    g.prop({ kind: 'bush', x: x0 + ((x1 - x0) * (i + 0.5)) / n + r.range(-0.4, 0.4), y: 0, z: z + r.range(-0.3, 0.3), rot: r.next() * 6, scale: r.range(0.6, 1.0) });
  }
}

/** Parking lot with stall rows along x and some parked cars. */
export function parking(g: GeoBuilder, r: Rng, x0: number, z0: number, x1: number, z1: number, fill: number, seed: number): void {
  g.ground(x0, z0, x1, z1, ASPH(seed), 0.05);
  const rowDepth = 5.2;
  const aisle = 6;
  for (let z = z0 + 0.4; z + rowDepth <= z1 + 0.1; z += rowDepth * 2 + aisle) {
    for (const rz of [z + rowDepth / 2, z + rowDepth + aisle + rowDepth / 2]) {
      if (rz + rowDepth / 2 > z1) continue;
      for (let x = x0 + 1.4; x < x1 - 1.3; x += 2.6) {
        if (r.next() > fill) continue;
        const flip = rz > z + rowDepth ? Math.PI / 2 : -Math.PI / 2;
        g.prop({ kind: 'car', x, y: 0.05, z: rz, rot: flip + r.range(-0.04, 0.04), variant: r.pick([VM.sedan, VM.hatchback, VM.suv, VM.sedan]), color: r.pick(CAR_COLORS) });
      }
    }
  }
}

export function fence(g: GeoBuilder, x0: number, z0: number, x1: number, z1: number, h: number, color: RGB, sides: [boolean, boolean, boolean, boolean] = [false, true, true, true]): void {
  const mat: Mat = { color, pattern: P.WOOD, seed: 0, fh: 3, bay: 1 };
  const cap: Mat = { color, pattern: P.TRIM, seed: 0 };
  const t = 0.06;
  const run = (ax: number, az: number, bx: number, bz: number) => {
    g.wall(ax, az, bx, bz, 0, h, mat);
    g.wall(bx, bz, ax, az, 0, h, mat);
    const nx = bz - az, nz = ax - bx;
    const l = Math.hypot(nx, nz) || 1;
    const ox = (nx / l) * t, oz = (nz / l) * t;
    g.quad([ax - ox, h, az - oz], [ax + ox, h, az + oz], [bx + ox, h, bz + oz], [bx - ox, h, bz - oz], [0, 1, 0], cap, [[0, 0], [0, 1], [1, 1], [1, 0]]);
  };
  if (sides[0]) run(x1, z0, x0, z0);
  if (sides[1]) run(x1, z1, x1, z0);
  if (sides[2]) run(x0, z1, x1, z1);
  if (sides[3]) run(x0, z0, x0, z1);
}

/**
 * Dresses a flat roof that already has its membrane: a parapet with a coping
 * (when `parapet` > 0) and roof plant packed without overlaps.
 */
export function rooftop(g: GeoBuilder, r: Rng, x0: number, z0: number, x1: number, z1: number, y: number, seed: number, parapetH = 0.8, wallHex = 0xcfc8bb, opts: { tank?: boolean; solar?: boolean; overrun?: Mat | null } = {}): void {
  if (parapetH > 0) parapet(g, x0, z0, x1, z1, y, parapetH, m(c(wallHex), P.TRIM, seed), m(c(0xe4dfd4), P.TRIM, seed));
  roofscape(g, r, x0, z0, x1, z1, y, seed, { overrun: opts.overrun, tank: opts.tank, solar: opts.solar });
}

