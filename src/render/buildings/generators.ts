import { Rng } from '../../core/rng';
import type { StyleId } from '../../sim/buildings/Archetypes';
import { VM } from '../../sim/traffic/Vehicles';
import { type BuiltGeometry, GeoBuilder, type Mat, P, type RGB, hex, mixRGB, shade } from './BuildingKit';

export interface GenInput {
  style: StyleId;
  w: number;
  d: number;
  floors: number;
  level: number;
  seed: number;
}

type Gen = (g: GeoBuilder, b: GenInput, r: Rng) => void;

// ── Palettes (sRGB) ─────────────────────────────────────────────────────────
const SIDING = [0xefebe2, 0xe3d9c6, 0xd6d6d2, 0xb9c6cc, 0xb8c2a8, 0xf1e6cf, 0xc7b9a6, 0xa9b4bd, 0xe8e2d6, 0xd9cbb3];
const BRICKS = [0x9a5b45, 0x8c4c3c, 0xa8735a, 0xb48a6c, 0x7d5a4c, 0xc9b8a0, 0x9e8f84];
const RENDER = [0xe6e1d8, 0xd8d2c6, 0xc9c3b8, 0xece7dc, 0xbdb6aa, 0xd2c4ae, 0xa7a49e];
const ROOFS = [0x3b3d40, 0x4a4038, 0x56585c, 0x7a4636, 0x41474a, 0x5b4b3d, 0x2f3236];
const GLASS = [0x4f6170, 0x506b6a, 0x5c5a52, 0x6d7c88, 0x3d4b5a, 0x617783];
const SPANDREL = [0xcfd2d4, 0x9ea3a8, 0x6a6f74, 0xd8d1c4, 0x3c4045];
const INDUSTRY = [0xc5c8c8, 0xa9b2b6, 0xd7d0bf, 0x9aa79f, 0xb7b0a2, 0x8e9aa6, 0xe0dfd8];
const ACCENTS = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf39c12, 0x8e44ad, 0x16a085, 0xd35400, 0x2c3e50];
const OFFICE_GLASS = [0x6d8fa8, 0x5e8a86, 0x8a8478, 0x9aa6b0, 0x4f6170, 0x617783, 0x3d4b5a];
const CAR_COLORS = [0xf2f2f0, 0x1b1c1f, 0xa9adb2, 0x5d6168, 0x1f3550, 0x8e1b1b, 0xc9bfa8, 0x3c7ac0];

const c = (h: number): RGB => hex(h);
const pick = <T>(r: Rng, a: readonly T[]) => r.pick(a);

function m(color: RGB, pattern: number, seed: number, fh = 3, bay = 3): Mat {
  return { color, pattern, seed, fh, bay };
}

const GRASS = (s: number): Mat => m(c(0x6f8a45), P.GRASS, s);
const PAVE = (s: number): Mat => m(c(0xb9b5ad), P.PAVING, s);
const CONC = (s: number): Mat => m(c(0xa8a49c), P.CONCRETE, s);
const ASPH = (s: number): Mat => m(c(0x4a4b4e), P.PARKING, s);

// ── Shared lot helpers ──────────────────────────────────────────────────────

function trees(g: GeoBuilder, r: Rng, n: number, x0: number, z0: number, x1: number, z1: number, avoid?: [number, number, number, number], scale = 1): void {
  for (let i = 0; i < n * 3 && n > 0; i++) {
    const x = r.range(x0, x1);
    const z = r.range(z0, z1);
    if (avoid && x > avoid[0] - 2 && x < avoid[2] + 2 && z > avoid[1] - 2 && z < avoid[3] + 2) continue;
    g.prop({ kind: 'tree', x, y: 0, z, rot: r.next() * 6.28, scale: scale * r.range(0.65, 1.05), variant: r.int(0, 2) });
    n--;
  }
}

function bushes(g: GeoBuilder, r: Rng, n: number, x0: number, x1: number, z: number): void {
  for (let i = 0; i < n; i++) {
    g.prop({ kind: 'bush', x: x0 + ((x1 - x0) * (i + 0.5)) / n + r.range(-0.4, 0.4), y: 0, z: z + r.range(-0.3, 0.3), rot: r.next() * 6, scale: r.range(0.6, 1.0) });
  }
}

/** Parking lot with stall rows along x and some parked cars. */
function parking(g: GeoBuilder, r: Rng, x0: number, z0: number, x1: number, z1: number, fill: number, seed: number): void {
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

function fence(g: GeoBuilder, x0: number, z0: number, x1: number, z1: number, h: number, color: RGB, sides: [boolean, boolean, boolean, boolean] = [false, true, true, true]): void {
  const t = 0.08;
  const mat: Mat = { color, pattern: P.PLAIN, seed: 0 };
  if (sides[0]) g.box(x0, z0, x1, z0 + t, 0, h, mat, mat);
  if (sides[1]) g.box(x1 - t, z0, x1, z1, 0, h, mat, mat);
  if (sides[2]) g.box(x0, z1 - t, x1, z1, 0, h, mat, mat);
  if (sides[3]) g.box(x0, z0, x0 + t, z1, 0, h, mat, mat);
}

function rooftop(g: GeoBuilder, r: Rng, x0: number, z0: number, x1: number, z1: number, y: number, seed: number, parapet = 0.8): void {
  const pc: Mat = { color: c(0xb5b2aa), pattern: P.PLAIN, seed };
  const t = 0.35;
  if (parapet > 0) {
    g.box(x0, z0, x1, z0 + t, y, y + parapet, pc, pc);
    g.box(x0, z1 - t, x1, z1, y, y + parapet, pc, pc);
    g.box(x0, z0 + t, x0 + t, z1 - t, y, y + parapet, pc, pc);
    g.box(x1 - t, z0 + t, x1, z1 - t, y, y + parapet, pc, pc);
  }
  const hv: Mat = { color: c(0xc9cbcc), pattern: P.METAL, seed };
  const n = Math.min(5, Math.floor(((x1 - x0) * (z1 - z0)) / 120) + 1);
  for (let i = 0; i < n; i++) {
    const w = r.range(1.5, 3.2), d = r.range(1.5, 3);
    const x = r.range(x0 + 1.5, x1 - 1.5 - w), z = r.range(z0 + 1.5, z1 - 1.5 - d);
    if (x1 - x0 < 6 || z1 - z0 < 6) break;
    g.box(x, z, x + w, z + d, y, y + r.range(1, 1.8), hv, hv);
  }
}

// ── Residential ─────────────────────────────────────────────────────────────

const house: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, GRASS(s), 0.03);
  const wall = c(pick(r, SIDING));
  const roof = c(pick(r, ROOFS));
  const garage = r.chance(0.6) && w >= 16;
  const bw = Math.min(w - (garage ? 7.5 : 4), r.range(9, 12) + b.level * 1.2);
  const bd = Math.min(d - 12, r.range(8, 10.5) + b.level * 0.8);
  const setback = r.range(5.5, 7.5);
  const side = r.chance(0.5) ? 1 : -1;
  const off = garage ? -side * 2 : r.range(-0.8, 0.8);
  const x0 = off - bw / 2, x1 = off + bw / 2, z0 = setback, z1 = setback + bd;
  const floors = Math.max(1, Math.min(2, b.floors));
  const fh = 2.95;
  const plinth = 0.45;
  const facade: Mat = m(wall, b.level >= 3 && r.chance(0.4) ? P.BRICK : P.RES, s, fh, 3.2);
  const roofM: Mat = m(roof, P.ROOF_TILE, s);
  g.box(x0 - 0.15, z0 - 0.15, x1 + 0.15, z1 + 0.15, 0, plinth, CONC(s), null);
  g.box(x0, z0, x1, z1, plinth, plinth + floors * fh, facade, null);
  const top = plinth + floors * fh;
  const rs = r.next();
  const gableEnd = m(wall, P.PLAIN, s);
  if (rs < 0.5) g.gable(x0, z0, x1, z1, top, r.range(2.2, 3.2), true, roofM, gableEnd);
  else if (rs < 0.75) g.gable(x0, z0, x1, z1, top, r.range(2.4, 3.4), false, roofM, gableEnd);
  else g.hip(x0, z0, x1, z1, top, r.range(2.0, 2.8), roofM);
  if (r.chance(0.45)) {
    const cx = r.range(x0 + 1, x1 - 1.6);
    g.box(cx, z0 + bd * 0.4, cx + 0.8, z0 + bd * 0.4 + 0.8, top, top + 3.4, m(c(pick(r, BRICKS)), P.BRICK, s), m(c(0x3a3a3a), P.PLAIN, s));
  }
  // Porch canopy and steps.
  const px = off + r.range(-bw * 0.2, bw * 0.2);
  g.box(px - 1.3, z0 - 1.4, px + 1.3, z0, 2.55, 2.7, m(wall, P.PLAIN, s), m(roof, P.PLAIN, s));
  g.box(px - 1.1, z0 - 1.3, px + 1.1, z0, 0, plinth, CONC(s), CONC(s));
  // Garage
  if (garage) {
    const gx0 = side > 0 ? x1 : x0 - 4;
    const gx1 = side > 0 ? x1 + 4 : x0;
    const gz0 = z0 + 0.8;
    const gz1 = gz0 + 6.5;
    g.box(gx0, gz0, gx1, gz1, 0, 2.9, m(wall, P.PLAIN, s), null);
    g.wall(gx1 - 0.35, gz0 - 0.02, gx0 + 0.35, gz0 - 0.02, 0.05, 2.35, m(shade(wall, 0.92), P.DOOR, s));
    g.gable(gx0, gz0, gx1, gz1, 2.9, 1.2, false, roofM, m(wall, P.PLAIN, s), 0.25);
    g.ground(gx0 + 0.3, 0, gx1 - 0.3, gz0, CONC(s), 0.05);
    if (r.chance(0.55)) g.prop({ kind: 'car', x: (gx0 + gx1) / 2, y: 0.05, z: gz0 * 0.45, rot: Math.PI / 2, variant: r.pick([VM.sedan, VM.suv, VM.hatchback]), color: r.pick(CAR_COLORS) });
  } else {
    const dx = side > 0 ? x1 + 0.8 : x0 - 3.6;
    g.ground(dx, 0, dx + 2.8, z0 + 4, CONC(s), 0.05);
    if (r.chance(0.5)) g.prop({ kind: 'car', x: dx + 1.4, y: 0.05, z: 3.2, rot: Math.PI / 2, variant: r.pick([VM.sedan, VM.hatchback]), color: r.pick(CAR_COLORS) });
  }
  g.ground(px - 0.6, 0, px + 0.6, z0 - 1.3, PAVE(s), 0.045);
  // Back yard: fence, maybe a pool, trees.
  if (r.chance(0.7)) fence(g, -w / 2 + 0.2, z1 + 1, w / 2 - 0.2, d - 0.2, r.range(1.1, 1.7), c(r.pick([0xcdb69a, 0xe8e6e0, 0x8b7355])), [false, true, true, true]);
  if (b.level >= 2 && r.chance(0.35) && d - z1 > 9) {
    const pw = Math.min(4, w * 0.25), pd = 6.5;
    const pxc = r.range(-w / 2 + 3, w / 2 - 3 - pw);
    g.ground(pxc - 1, z1 + 2, pxc + pw + 1, z1 + 2 + pd + 2, PAVE(s), 0.05);
    g.ground(pxc, z1 + 3, pxc + pw, z1 + 3 + pd, m(c(0x3aa0c8), P.WATER, s), 0.08);
  }
  trees(g, r, r.int(1, 3), -w / 2 + 1.5, z1 + 2, w / 2 - 1.5, d - 1.5, undefined, 0.9);
  if (r.chance(0.5)) trees(g, r, 1, -w / 2 + 1.5, 1.5, w / 2 - 1.5, z0 - 2, [x0, z0, x1, z1], 0.8);
  bushes(g, r, Math.max(2, Math.floor(bw / 2.2)), x0 + 0.5, x1 - 0.5, z0 - 0.8);
};

const townhouse: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, GRASS(s), 0.03);
  const n = Math.max(2, Math.floor((w - 1) / 6.2));
  const uw = (w - 1) / n;
  const setback = r.range(3, 4.5);
  const bd = Math.min(d - 8, r.range(10, 12.5));
  const brick = r.chance(0.6);
  const baseCol = c(pick(r, brick ? BRICKS : RENDER));
  const flat = r.chance(0.5);
  const roof = c(pick(r, ROOFS));
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 + 0.5 + i * uw;
    const x1 = x0 + uw;
    const col = mixRGB(baseCol, c(pick(r, brick ? BRICKS : SIDING)), 0.35);
    const fl = Math.max(2, b.floors + (r.chance(0.25) ? 1 : 0));
    const h = 0.5 + fl * 3.0;
    const zb = setback + r.range(-0.3, 0.3);
    const mat = m(col, brick ? P.BRICK : P.RES, s + i, 3.0, uw / 2);
    g.box(x0, zb, x1, zb + bd, 0, h, mat, null);
    if (flat) {
      g.flat(x0, zb, x1, zb + bd, h, m(c(0x77746e), P.ROOF_FLAT, s));
      g.box(x0, zb, x1, zb + 0.3, h, h + 0.7, m(shade(col, 0.9), P.PLAIN, s), m(c(0x9a968e), P.PLAIN, s));
    } else {
      g.gable(x0, zb, x1, zb + bd, h, 2.6, false, m(roof, P.ROOF_TILE, s), m(col, P.PLAIN, s), 0.05);
    }
    // Stoop and door canopy
    g.box(x0 + uw * 0.35, zb - 1.4, x0 + uw * 0.65, zb, 0, 0.5, CONC(s), CONC(s));
    g.ground(x0 + uw * 0.4, 0, x0 + uw * 0.6, zb - 1.4, PAVE(s), 0.045);
    if (i % 2 === 0) bushes(g, r, 2, x0 + 0.6, x0 + uw * 0.3, zb - 0.9);
  }
  const back = setback + bd;
  if (d - back > 7) {
    parking(g, r, -w / 2 + 1, d - 6.5, w / 2 - 1, d - 0.5, 0.5, s);
    fence(g, -w / 2 + 0.2, back + 0.5, w / 2 - 0.2, d - 7, 1.4, c(0xcdb69a), [false, true, true, true]);
  }
  trees(g, r, Math.floor(n / 2), -w / 2 + 2, back + 1.5, w / 2 - 2, Math.max(back + 2, d - 8), undefined, 0.85);
};

function apartmentBlock(g: GeoBuilder, b: GenInput, r: Rng, tall: boolean): void {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, GRASS(s), 0.03);
  const setback = r.range(3.5, 6);
  const rearPark = d > 30 ? r.range(8, 12) : 0;
  const bw = w - r.range(3, 6);
  const bd = Math.max(10, d - setback - rearPark - 2);
  const x0 = -bw / 2, x1 = bw / 2, z0 = setback, z1 = setback + bd;
  const fh = 3.05;
  const floors = Math.max(3, b.floors);
  const brick = r.chance(tall ? 0.3 : 0.5);
  const col = c(pick(r, brick ? BRICKS : RENDER));
  const facade = m(col, brick ? P.BRICK : P.RES, s, fh, r.range(3.0, 3.8));
  const base = m(shade(col, 0.82), b.level >= 2 && r.chance(0.5) ? P.STORE : P.RES, s, fh, 3.6);
  const lShape = !tall && r.chance(0.35) && bd > 16;
  const h = 0.4 + floors * fh;
  if (lShape) {
    const wingW = bw * 0.45;
    g.box(x0, z0, x1, z0 + bd * 0.5, 0.4, fh + 0.4, base, null);
    g.box(x0, z0, x1, z0 + bd * 0.5, fh + 0.4, h, facade, null);
    g.box(x0, z0 + bd * 0.5, x0 + wingW, z1, 0.4, h, facade, null);
    g.flat(x0, z0, x1, z0 + bd * 0.5, h, m(c(0x8a8780), P.ROOF_FLAT, s));
    g.flat(x0, z0 + bd * 0.5, x0 + wingW, z1, h, m(c(0x8a8780), P.ROOF_FLAT, s));
    rooftop(g, r, x0, z0, x1, z0 + bd * 0.5, h, s);
    parking(g, r, x0 + wingW + 2, z0 + bd * 0.5 + 2, x1, z1, 0.6, s);
  } else {
    g.box(x0 - 0.2, z0 - 0.2, x1 + 0.2, z1 + 0.2, 0, 0.4, CONC(s), null);
    g.box(x0, z0, x1, z1, 0.4, fh + 0.4, base, null);
    g.box(x0, z0, x1, z1, fh + 0.4, h, facade, null);
    g.flat(x0, z0, x1, z1, h, m(c(0x8a8780), P.ROOF_FLAT, s));
    rooftop(g, r, x0, z0, x1, z1, h, s);
    // Stair/elevator housing.
    const sx = r.range(x0 + 3, x1 - 7);
    g.box(sx, z0 + bd * 0.4, sx + 4, z0 + bd * 0.4 + 4, h, h + 3, m(shade(col, 0.9), P.PLAIN, s), m(c(0x7d7a74), P.ROOF_FLAT, s));
  }
  // Balconies on the street face.
  if (r.chance(0.6)) {
    const slab = m(c(0xd8d6d0), P.PLAIN, s);
    const rail = m(c(0x6f7a80), P.GLASS_PLAIN, s);
    const bays = Math.max(1, Math.round(bw / 3.4));
    const bayW = bw / bays;
    for (let f = 1; f < floors; f++) {
      for (let k = 0; k < bays; k++) {
        if ((k + f) % 2 !== 0) continue;
        const bx = x0 + k * bayW + bayW * 0.12;
        const y = 0.4 + f * fh;
        g.box(bx, z0 - 1.2, bx + bayW * 0.76, z0, y - 0.15, y, slab, slab);
        g.wall(bx + bayW * 0.76, z0 - 1.2, bx, z0 - 1.2, y, y + 1.0, rail);
      }
    }
  }
  // Entrance canopy and walkway.
  g.box(-2, z0 - 1.6, 2, z0, 3.0, 3.25, m(c(0x55585c), P.METAL, s), m(c(0x55585c), P.METAL, s));
  g.ground(-1.4, 0, 1.4, z0 - 1.6, PAVE(s), 0.045);
  if (rearPark > 0 && !lShape) parking(g, r, -w / 2 + 1, d - rearPark + 0.5, w / 2 - 1, d - 0.5, 0.65, s);
  trees(g, r, r.int(2, 4), -w / 2 + 1.5, 1, w / 2 - 1.5, setback - 1.5, undefined, 0.8);
  bushes(g, r, Math.floor(bw / 3), x0 + 1, x1 - 1, z0 - 0.7);
}

const lowrise: Gen = (g, b, r) => apartmentBlock(g, b, r, false);
const midrise: Gen = (g, b, r) => apartmentBlock(g, b, r, true);

/**
 * Residential tower over a retail podium. Massing varies (slab, setback,
 * stepped tiers or an L of two wings), as do materials (render, brick, glass,
 * two-tone) and crowns (plant room, pyramid cap, spire or a lit band), so a
 * skyline of towers never looks copy-pasted.
 */
const tower: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, PAVE(s), 0.04);
  const fh = 3.1;
  const podiumH = 2 * 4.2;
  const pw = w - 4, pd = Math.min(d - 6, 30);
  const pz0 = 3;
  const base = c(pick(r, RENDER));
  g.box(-pw / 2, pz0, pw / 2, pz0 + pd, 0, podiumH, m(shade(base, 0.85), P.STORE, s, 4.2, 4), m(c(0x7f7c76), P.ROOF_FLAT, s));
  const floors = Math.max(8, b.floors);
  const tw = Math.min(pw - 4, r.range(17, 23));
  const td = Math.min(pd - 4, r.range(16, 22));
  const tz0 = pz0 + (pd - td) / 2 + r.range(-1, 1.5);
  const tx0 = -tw / 2 + r.range(-1.5, 1.5);

  // Materials: glass for grand towers, otherwise render, brick or two-tone.
  const finish = b.level >= 3 && r.chance(0.6) ? 'glass' : r.pick(['render', 'render', 'brick', 'twoTone', 'glass']);
  const glassMat = m(c(pick(r, GLASS)), P.GLASS, s, fh, 1.7);
  const renderMat = m(base, P.RES, s, fh, 3.2);
  const brickMat = m(c(pick(r, BRICKS)), P.BRICK, s, fh, 3.2);
  const lower = finish === 'glass' ? glassMat : finish === 'brick' || finish === 'twoTone' ? brickMat : renderMat;
  const upper = finish === 'twoTone' ? m(c(pick(r, [0xe9e4d8, 0xd8d2c6, 0xc9cfd4])), P.RES, s, fh, 3.2) : lower;
  const roof = m(c(0x8a8780), P.ROOF_FLAT, s);
  const glassy = finish === 'glass';

  // Massing.
  const form = floors < 12 ? 'slab' : r.pick(['slab', 'setback', 'stepped', 'wings']);
  const tiers: [number, number, number, number, number][] = []; // x0, z0, x1, z1, floors
  if (form === 'slab') tiers.push([tx0, tz0, tx0 + tw, tz0 + td, floors]);
  else if (form === 'setback') {
    const low = Math.round(floors * r.range(0.45, 0.65));
    tiers.push([tx0, tz0, tx0 + tw, tz0 + td, low]);
    const inset = r.range(2.2, 3.4);
    tiers.push([tx0 + inset, tz0 + inset, tx0 + tw - inset, tz0 + td - inset, floors - low]);
  } else if (form === 'stepped') {
    const a = Math.round(floors * 0.5), bb = Math.round(floors * 0.3);
    tiers.push([tx0, tz0, tx0 + tw, tz0 + td, a]);
    tiers.push([tx0 + 1.6, tz0 + 1.6, tx0 + tw - 1.6, tz0 + td - 1.6, bb]);
    tiers.push([tx0 + 3.4, tz0 + 3.4, tx0 + tw - 3.4, tz0 + td - 3.4, floors - a - bb]);
  }
  let y = podiumH;
  let top: [number, number, number, number] = [tx0, tz0, tx0 + tw, tz0 + td];
  if (form === 'wings') {
    // An L of two wings at different heights.
    const wa = tw * 0.55, db = td * 0.55;
    const fa = floors, fb = Math.max(6, Math.round(floors * r.range(0.55, 0.8)));
    const ya = podiumH + fa * fh, yb = podiumH + fb * fh;
    g.box(tx0, tz0, tx0 + wa, tz0 + td, podiumH, ya, lower, roof);
    g.box(tx0 + wa, tz0 + td - db, tx0 + tw, tz0 + td, podiumH, yb, upper, roof);
    rooftop(g, r, tx0 + wa + 1, tz0 + td - db + 1, tx0 + tw - 1, tz0 + td - 1, yb, s, 0.9);
    y = ya;
    top = [tx0, tz0, tx0 + wa, tz0 + td];
  } else {
    tiers.forEach(([x0, z0, x1, z1, n], i) => {
      const y1 = y + n * fh;
      g.box(x0, z0, x1, z1, y, y1, i === 0 ? lower : upper, null);
      g.flat(x0, z0, x1, z1, y1, roof);
      y = y1;
      top = [x0, z0, x1, z1];
    });
  }
  const [cx0, cz0, cx1, cz1] = top;
  const cw = cx1 - cx0, cd = cz1 - cz0;

  // Facade rhythm: balcony bands on rendered towers, slim fins on glass ones.
  if (!glassy && r.chance(0.65)) {
    const slab = m(c(0xe2e0da), P.PLAIN, s);
    const n = form === 'wings' ? floors : tiers[0][4];
    for (let f = 1; f < n; f++) {
      const yy = podiumH + f * fh;
      g.box(tx0 - 0.9, tz0 - 0.9, (form === 'wings' ? tx0 + tw * 0.55 : tx0 + tw) + 0.9, tz0, yy - 0.18, yy, slab, slab);
    }
  } else if (glassy) {
    const fin = m(c(0xc9ccd0), P.METAL, s);
    const n = Math.max(2, Math.floor(cw / 4.5));
    for (let i = 0; i <= n; i++) {
      const x = cx0 + (cw * i) / n;
      g.box(x - 0.12, cz0 - 0.35, x + 0.12, cz0, podiumH, y, fin, fin);
    }
  }

  // Crown.
  const crown = r.pick(['plant', 'plant', 'cap', 'spire', 'band']);
  if (crown === 'cap') {
    g.hip(cx0, cz0, cx1, cz1, y, Math.min(cw, cd) * 0.32, m(c(r.pick([0x5c6670, 0x3f4a52, 0x7a8288])), P.METAL, s), 0.05);
  } else if (crown === 'spire') {
    g.box(cx0 + cw * 0.3, cz0 + cd * 0.3, cx1 - cw * 0.3, cz1 - cd * 0.3, y, y + 5, m(shade(base, 0.8), P.PLAIN, s), roof);
    g.cylinder((cx0 + cx1) / 2, (cz0 + cz1) / 2, 0.45, 0.06, y + 5, y + 5 + Math.min(28, floors * 0.9), 6, m(c(0xb8bcc0), P.METAL, s), null);
    g.box((cx0 + cx1) / 2 - 0.25, (cz0 + cz1) / 2 - 0.25, (cx0 + cx1) / 2 + 0.25, (cz0 + cz1) / 2 + 0.25, y + 5 + Math.min(28, floors * 0.9), y + 5.6 + Math.min(28, floors * 0.9), m(c(0xff4433), P.SIGN, s, 1, 0.5), null);
  } else if (crown === 'band') {
    // A lit band around the top floor, glowing at night.
    const glow = m(c(r.pick([0xfff3d6, 0x9fd8ff, 0xb8ffd8])), P.SIGN, s, 1, cw);
    g.box(cx0 - 0.2, cz0 - 0.2, cx1 + 0.2, cz1 + 0.2, y - 0.9, y - 0.3, glow, null);
    rooftop(g, r, cx0 + 1.5, cz0 + 1.5, cx1 - 1.5, cz1 - 1.5, y, s, 1.1);
  } else {
    rooftop(g, r, cx0 + 1.5, cz0 + 1.5, cx1 - 1.5, cz1 - 1.5, y, s, 1.1);
    g.box(cx0 + cw * 0.3, cz0 + cd * 0.3, cx0 + cw * 0.62, cz0 + cd * 0.62, y, y + 4.5, m(shade(base, 0.85), P.PLAIN, s), m(c(0x6d6a65), P.ROOF_FLAT, s));
    if (r.chance(0.4)) g.cylinder(cx0 + cw * 0.75, cz0 + cd * 0.7, 0.12, 0.05, y, y + 9, 4, m(c(0x999999), P.METAL, s), null);
  }
  for (let i = 0; i < 4; i++) {
    const x = -w / 2 + 3 + ((w - 6) * i) / 3;
    g.box(x - 1, 0.5, x + 1, 2.5, 0, 0.6, CONC(s), m(c(0x5a7040), P.GRASS, s));
    g.prop({ kind: 'tree', x, y: 0.6, z: 1.5, rot: i, scale: 0.6, variant: 0 });
  }
};

// ── Commercial ──────────────────────────────────────────────────────────────

function sign(g: GeoBuilder, x0: number, x1: number, z: number, y0: number, y1: number, color: number, seed: number): void {
  g.wall(x1, z - 0.06, x0, z - 0.06, y0, y1, { color: c(color), pattern: P.SIGN, seed, bay: x1 - x0 });
}

const shop: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, PAVE(s), 0.04);
  const bw = Math.min(w - 1.5, r.range(10, 16));
  const bd = Math.min(d - 4, r.range(11, 16));
  const side = r.chance(0.5) ? 1 : -1;
  const x0 = side > 0 ? -w / 2 + 0.6 : w / 2 - 0.6 - bw;
  const x1 = x0 + bw;
  const z0 = r.range(0.6, 2.5), z1 = z0 + bd;
  const floors = Math.max(1, b.floors);
  const col = c(pick(r, r.chance(0.5) ? BRICKS : RENDER));
  const h = floors * 3.6 + 0.6;
  g.box(x0, z0, x1, z1, 0, h, m(col, P.STORE, s, 3.6, 3.4), m(c(0x7d7a74), P.ROOF_FLAT, s));
  rooftop(g, r, x0, z0, x1, z1, h, s, 0.6);
  const accent = pick(r, ACCENTS);
  sign(g, x0 + 0.6, x1 - 0.6, z0, 3.25, 3.95, accent, s);
  g.box(x0 + 0.3, z0 - 1.6, x1 - 0.3, z0, 2.9, 3.05, m(c(accent), P.PLAIN, s), m(c(accent), P.PLAIN, s));
  const free = w - bw - 1.2;
  if (free > 6) parking(g, r, side > 0 ? x1 + 0.6 : -w / 2 + 0.6, 0.8, side > 0 ? w / 2 - 0.6 : x0 - 0.6, d - 1, 0.5, s);
  g.box(side > 0 ? x0 + 1 : x1 - 3, z1 + 0.5, side > 0 ? x0 + 3 : x1 - 1, z1 + 2, 0, 1.4, m(c(0x2f5a3a), P.METAL, s), m(c(0x2f5a3a), P.METAL, s));
};

const stripmall: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  const front = Math.min(d - 14, r.range(16, 20));
  parking(g, r, -w / 2 + 1, 1, w / 2 - 1, front, 0.55, s);
  g.ground(-w / 2, front, w / 2, d, PAVE(s), 0.04);
  const z0 = front + 2, z1 = d - 1.5;
  const x0 = -w / 2 + 1, x1 = w / 2 - 1;
  const h = 5.2;
  const col = c(pick(r, RENDER));
  g.box(x0, z0, x1, z1, 0, h, m(col, P.STORE, s, 4.8, 4.5), m(c(0x86837c), P.ROOF_FLAT, s));
  rooftop(g, r, x0, z0, x1, z1, h, s, 1.2);
  const units = Math.max(3, Math.floor((x1 - x0) / 9));
  const uw = (x1 - x0) / units;
  for (let i = 0; i < units; i++) sign(g, x0 + i * uw + 0.8, x0 + (i + 1) * uw - 0.8, z0, 3.7, 4.6, pick(r, ACCENTS), s + i);
  g.box(x0, z0 - 3, x1, z0, 3.3, 3.55, m(c(0x9a958c), P.PLAIN, s), m(c(0x9a958c), P.PLAIN, s));
  for (let i = 0; i <= units; i++) {
    const px = x0 + i * uw;
    g.box(px - 0.15, z0 - 2.9, px + 0.15, z0 - 2.6, 0, 3.3, m(c(0x9a958c), P.PLAIN, s), null);
  }
  // Pylon sign by the road.
  const accent = pick(r, ACCENTS);
  g.box(x0 + 1, 0.5, x0 + 1.6, 1.1, 0, 6, m(c(0x55585c), P.METAL, s), null);
  g.box(x0 + 0.3, 0.6, x0 + 2.3, 1.0, 4, 6.8, m(c(accent), P.SIGN, s, 3, 2), m(c(accent), P.PLAIN, s));
  trees(g, r, 3, -w / 2 + 2, 0.5, w / 2 - 2, 1.2, undefined, 0.7);
};

const mixeduse: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, PAVE(s), 0.04);
  const floors = Math.max(3, b.floors);
  const bw = w - 1, bd = Math.min(d - 5, r.range(16, 22));
  const x0 = -bw / 2, x1 = bw / 2, z0 = 0.8, z1 = z0 + bd;
  const brick = r.chance(0.55);
  const col = c(pick(r, brick ? BRICKS : RENDER));
  const gh = 4.2;
  g.box(x0, z0, x1, z1, 0, gh, m(shade(col, 0.75), P.STORE, s, gh, 4), null);
  const h = gh + (floors - 1) * 3.1;
  g.box(x0, z0, x1, z1, gh, h, m(col, brick ? P.BRICK : P.RES, s, 3.1, 3.1), null);
  g.box(x0 - 0.2, z0 - 0.2, x1 + 0.2, z1 + 0.2, gh - 0.3, gh, m(c(0xd8d4cc), P.PLAIN, s), m(c(0xd8d4cc), P.PLAIN, s));
  g.flat(x0, z0, x1, z1, h, m(c(0x7f7c76), P.ROOF_FLAT, s));
  rooftop(g, r, x0, z0, x1, z1, h, s, 0.9);
  const units = Math.max(2, Math.floor(bw / 7));
  const uw = bw / units;
  for (let i = 0; i < units; i++) {
    const accent = pick(r, ACCENTS);
    sign(g, x0 + i * uw + 0.6, x0 + (i + 1) * uw - 0.6, z0, 3.2, 3.85, accent, s + i);
    if (r.chance(0.6)) g.box(x0 + i * uw + 0.4, z0 - 1.5, x0 + (i + 1) * uw - 0.4, z0, 2.8, 2.95, m(c(accent), P.PLAIN, s), m(shade(c(accent), 0.9), P.PLAIN, s));
  }
  if (d - z1 > 7) parking(g, r, -w / 2 + 1, z1 + 1, w / 2 - 1, d - 0.5, 0.6, s);
};

const bigbox: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  const front = Math.min(d - 18, 16);
  parking(g, r, -w / 2 + 1, 1, w / 2 - 1, front, 0.5, s);
  const z0 = front + 1.5, z1 = d - 1.5, x0 = -w / 2 + 2, x1 = w / 2 - 2;
  const h = r.range(8, 10);
  const col = c(pick(r, [0xd8d4ca, 0xc9c6bf, 0xe2ddd0, 0xb8b4ab]));
  g.box(x0, z0, x1, z1, 0, h, m(col, P.CONCRETE, s), m(c(0x9c9992), P.ROOF_FLAT, s));
  rooftop(g, r, x0, z0, x1, z1, h, s, 1.2);
  const accent = pick(r, ACCENTS);
  const ex = r.range(x0 + 8, x1 - 16);
  g.wall(ex + 10, z0 - 0.05, ex, z0 - 0.05, 0, 4.5, m(c(0x55636e), P.GLASS, s, 4.5, 2));
  g.box(ex - 1, z0 - 3, ex + 11, z0, 4.5, 5, m(c(accent), P.PLAIN, s), m(c(accent), P.PLAIN, s));
  sign(g, ex - 2, ex + 12, z0, h - 2.8, h - 0.5, accent, s);
  g.box(x0, z0 - 0.05, x1, z0, h - 0.8, h, m(c(accent), P.PLAIN, s), null);
  trees(g, r, 4, -w / 2 + 2, 0.5, w / 2 - 2, 1.2, undefined, 0.7);
};

// ── Office ──────────────────────────────────────────────────────────────────

const office: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, GRASS(s), 0.03);
  const floors = Math.max(3, b.floors);
  const fh = 3.8;
  const bw = w - r.range(4, 8);
  const bd = Math.min(d - 10, r.range(16, 24));
  const z0 = r.range(4, 6), z1 = z0 + bd, x0 = -bw / 2, x1 = bw / 2;
  const glass = c(pick(r, GLASS));
  const span = c(pick(r, SPANDREL));
  const h = floors * fh;
  g.box(x0, z0, x1, z1, 0, fh, m(glass, P.GLASS, s, fh, 2), null);
  g.box(x0, z0, x1, z1, fh, h, m(mixRGB(span, glass, 0.15), P.OFFICE, s, fh, r.range(2.6, 3.4)), null);
  g.flat(x0, z0, x1, z1, h, m(c(0x8c8982), P.ROOF_FLAT, s));
  rooftop(g, r, x0, z0, x1, z1, h, s, 1.0);
  g.box(x0 + bw * 0.25, z0 + bd * 0.3, x0 + bw * 0.55, z0 + bd * 0.65, h, h + 3.5, m(span, P.PLAIN, s), m(c(0x6d6a65), P.ROOF_FLAT, s));
  g.box(-4, z0 - 3.5, 4, z0, 3.6, 3.9, m(c(0x55585c), P.METAL, s), m(c(0x55585c), P.METAL, s));
  g.ground(-3, 0, 3, z0 - 3.5, PAVE(s), 0.045);
  if (d - z1 > 7) parking(g, r, -w / 2 + 1, z1 + 1.5, w / 2 - 1, d - 0.5, 0.7, s);
  trees(g, r, 3, -w / 2 + 1.5, 1, w / 2 - 1.5, z0 - 1.5, [-4, 0, 4, z0], 0.8);
  bushes(g, r, Math.floor(bw / 3), x0 + 1, x1 - 1, z0 - 0.7);
};

const officeTower: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, PAVE(s), 0.04);
  const floors = Math.max(12, b.floors);
  const fh = 3.9;
  const glass = c(pick(r, OFFICE_GLASS));
  const tw = Math.min(w - 6, r.range(22, 28));
  const td = Math.min(d - 8, r.range(20, 26));
  const z0 = (d - td) / 2 + 1, x0 = -tw / 2;
  g.box(x0 - 2, z0 - 2, x0 + tw + 2, z0 + td + 2, 0, 6, m(shade(glass, 1.15), P.GLASS, s, 6, 3), m(c(0x7c7a74), P.ROOF_FLAT, s));
  const fins = r.chance(0.6);
  const finMat = m(c(r.pick([0xc9ccd0, 0x8d9399, 0x3a3f45])), P.METAL, s);
  const stages = floors > 24 ? 3 : 2;
  let y = 6;
  let inset = 0;
  const per = Math.floor(floors / stages);
  for (let k = 0; k < stages; k++) {
    const fl = k === stages - 1 ? floors - per * (stages - 1) : per;
    const y1 = y + fl * fh;
    const mat = r.chance(0.5) ? m(glass, P.GLASS, s, fh, 1.6) : m(mixRGB(c(pick(r, SPANDREL)), glass, 0.4), P.OFFICE, s, fh, 2.2);
    g.box(x0 + inset, z0 + inset, x0 + tw - inset, z0 + td - inset, y, y1, mat, m(c(0x77746e), P.ROOF_FLAT, s));
    // Slim vertical fins on the long faces give the glass a rhythm.
    if (fins) {
      const n = Math.max(3, Math.floor((tw - 2 * inset) / 3.2));
      for (let i = 0; i <= n; i++) {
        const x = x0 + inset + ((tw - 2 * inset) * i) / n;
        for (const [za, zb] of [[z0 + inset - 0.3, z0 + inset], [z0 + td - inset, z0 + td - inset + 0.3]] as [number, number][]) g.box(x - 0.1, za, x + 0.1, zb, y, y1, finMat, finMat);
      }
    }
    y = y1;
    inset += r.range(1.2, 2.5);
  }
  const cx0 = x0 + inset, cz0 = z0 + inset, cx1 = x0 + tw - inset, cz1 = z0 + td - inset;
  const crown = r.pick(['plant', 'band', 'logo', 'spire']);
  if (crown === 'band') {
    const glow = m(c(r.pick([0xfff3d6, 0x9fd8ff, 0xd8c8ff])), P.SIGN, s, 1, cx1 - cx0);
    g.box(cx0 - 0.25, cz0 - 0.25, cx1 + 0.25, cz1 + 0.25, y, y + 2.4, glow, m(c(0x77746e), P.ROOF_FLAT, s));
    rooftop(g, r, cx0 + 1, cz0 + 1, cx1 - 1, cz1 - 1, y + 2.4, s, 0.6);
  } else if (crown === 'logo') {
    rooftop(g, r, cx0, cz0, cx1, cz1, y, s, 1.5);
    // The company's lit panel near the top of the street face.
    const pw = Math.min(10, (cx1 - cx0) * 0.5);
    g.box(-pw / 2 + (cx0 + cx1) / 2, cz0 - 0.35, pw / 2 + (cx0 + cx1) / 2, cz0 - 0.1, y - 5.2, y - 1.4, m(c(r.pick([0xe8453c, 0x2f80ed, 0x27ae60, 0xf2c94c, 0xffffff])), P.SIGN, s, 1, pw), null);
  } else if (crown === 'spire' && floors > 20) {
    rooftop(g, r, cx0, cz0, cx1, cz1, y, s, 1.5);
    g.cylinder((cx0 + cx1) / 2, (cz0 + cz1) / 2, 0.6, 0.08, y, y + 18 + floors * 0.3, 6, m(c(0xb8bcc0), P.METAL, s), null);
  } else {
    rooftop(g, r, cx0, cz0, cx1, cz1, y, s, 1.5);
    if (floors > 26 && r.chance(0.6)) g.cylinder(x0 + tw / 2, z0 + td / 2, 0.5, 0.08, y, y + 22, 6, m(c(0xb0b0b0), P.METAL, s), null);
  }
  // Entrance canopy.
  g.box(-6, z0 - 6, 6, z0 - 2, 4.6, 5.0, m(c(0xd8d8d4), P.METAL, s), m(c(0xc8c8c4), P.METAL, s));
  for (let i = 0; i < 5; i++) {
    const x = -w / 2 + 3 + ((w - 6) * i) / 4;
    g.box(x - 1.2, 0.6, x + 1.2, 2.6, 0, 0.6, CONC(s), m(c(0x5a7040), P.GRASS, s));
    g.prop({ kind: 'tree', x, y: 0.6, z: 1.6, rot: i, scale: 0.65, variant: 1 });
  }
};

// ── Industrial ──────────────────────────────────────────────────────────────

function loadingDoors(g: GeoBuilder, x0: number, x1: number, z: number, n: number, seed: number): void {
  const step = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const a = x0 + i * step + step * 0.2;
    g.wall(a + step * 0.6, z - 0.05, a, z - 0.05, 0.1, 4.2, { color: c(0x9aa0a4), pattern: P.DOOR, seed });
  }
}

function trucks(g: GeoBuilder, r: Rng, n: number, x0: number, x1: number, z: number, rot = Math.PI / 2): void {
  for (let i = 0; i < n; i++) {
    if (r.chance(0.35)) continue;
    g.prop({ kind: 'car', x: x0 + ((x1 - x0) * (i + 0.5)) / n, y: 0.05, z, rot, variant: r.chance(0.6) ? VM.truck : VM.van, color: r.pick([0xe8e8e4, 0xd8d2c4, 0x35506e, 0x7a1f1f]) });
  }
}

const workshop: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, CONC(s), 0.04);
  const bw = w - 3, bd = Math.min(d - 9, r.range(13, 18));
  const z0 = d - bd - 1.5, z1 = d - 1.5, x0 = -bw / 2, x1 = bw / 2;
  const col = c(pick(r, INDUSTRY));
  const h = r.range(5.5, 7);
  g.box(x0, z0, x1, z1, 0, h, m(col, P.INDUSTRIAL, s, 6, 1.2), null);
  g.gable(x0, z0, x1, z1, h, 1.4, true, m(c(0x8d9296), P.METAL, s), m(col, P.INDUSTRIAL, s, 6, 1.2), 0.3);
  loadingDoors(g, x0 + 1, x1 - 4, z0, 2, s);
  g.box(x1 - 4.5, z0 - 0.1, x1 - 0.5, z0 + 4, 0, 3.2, m(c(pick(r, RENDER)), P.OFFICE, s, 3.2, 2.5), m(c(0x7d7a74), P.ROOF_FLAT, s));
  trucks(g, r, 2, x0, x1, z0 - 5);
  fence(g, -w / 2 + 0.2, 0.2, w / 2 - 0.2, d - 0.2, 1.8, c(0x6f7478), [false, true, true, true]);
};

const warehouse: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, ASPH(s), 0.04);
  const bw = w - 3, bd = Math.min(d - 12, r.range(20, 26));
  const z0 = d - bd - 1, z1 = d - 1, x0 = -bw / 2, x1 = bw / 2;
  const col = c(pick(r, INDUSTRY));
  const h = r.range(8, 11);
  g.box(x0, z0, x1, z1, 0, h, m(col, P.INDUSTRIAL, s, 10, 1.2), m(c(0xa3a5a4), P.ROOF_FLAT, s));
  rooftop(g, r, x0, z0, x1, z1, h, s, 0.5);
  const doors = Math.max(2, Math.floor(bw / 6));
  loadingDoors(g, x0 + 6, x1 - 1, z0, doors, s);
  g.box(x0, z0 - 0.1, x0 + 6, z0 + 6, 0, 6.4, m(c(pick(r, RENDER)), P.OFFICE, s, 3.2, 2.5), m(c(0x7d7a74), P.ROOF_FLAT, s));
  g.box(x0 + 6, z0 - 3, x1, z0, h - 3, h - 2.8, m(c(0x8d9296), P.METAL, s), m(c(0x8d9296), P.METAL, s));
  trucks(g, r, doors, x0 + 6, x1 - 1, z0 - 6);
  fence(g, -w / 2 + 0.2, 0.2, w / 2 - 0.2, d - 0.2, 2.0, c(0x6f7478), [false, true, false, true]);
};

const factory: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, CONC(s), 0.04);
  const bw = w * 0.62, bd = d - 10;
  const x0 = -w / 2 + 2, x1 = x0 + bw, z0 = 6, z1 = z0 + bd;
  const col = c(pick(r, INDUSTRY));
  const h = r.range(9, 12);
  g.box(x0, z0, x1, z1, 0, h, m(col, P.INDUSTRIAL, s, 10, 1.2), null);
  // Saw-tooth roof with north lights.
  const teeth = Math.max(3, Math.floor(bd / 6));
  const tdp = bd / teeth;
  for (let i = 0; i < teeth; i++) {
    const za = z0 + i * tdp, zb = za + tdp;
    g.quad([x1, h, za], [x0, h, za], [x0, h + 3, zb], [x1, h + 3, zb], [0, 0.7, -0.7], m(c(0x8a8f93), P.METAL, s), [[0, 0], [bw, 0], [bw, 4], [0, 4]]);
    g.wall(x0, zb, x1, zb, h, h + 3, m(c(0x6f8796), P.GLASS_PLAIN, s, 3, 2));
    g.tri([x0, h, za], [x0, h, zb], [x0, h + 3, zb], [-1, 0, 0], m(col, P.PLAIN, s), [[0, 0], [1, 0], [1, 1]]);
    g.tri([x1, h, zb], [x1, h, za], [x1, h + 3, zb], [1, 0, 0], m(col, P.PLAIN, s), [[0, 0], [1, 0], [1, 1]]);
  }
  loadingDoors(g, x0 + 2, x1 - 2, z0, 3, s);
  // Chimneys, tanks and pipes.
  const chX = x1 + r.range(3, 6), chZ = z0 + r.range(4, bd - 4);
  const chH = r.range(22, 34);
  g.cylinder(chX, chZ, 1.4, 1.0, 0, chH, 10, m(c(0xa8735a), P.BRICK, s, 3, 1.5), m(c(0x2a2a2a), P.PLAIN, s));
  g.prop({ kind: 'smoke', x: chX, y: chH, z: chZ, rot: 0, scale: 1 });
  const tanks = r.int(1, 3);
  for (let i = 0; i < tanks; i++) {
    const tx = x1 + 6 + r.range(2, Math.max(3, w / 2 - x1 - 8));
    const tz = z0 + 4 + i * 9;
    if (tz > z1 - 3 || tx > w / 2 - 3) continue;
    g.cylinder(tx, tz, 3.5, 3.5, 0, r.range(7, 11), 12, m(c(0xd9dcdc), P.METAL, s, 3, 2), m(c(0xbfc2c2), P.METAL, s));
  }
  g.box(x1, z0 + 2, x1 + 6, z0 + 2.6, 5.5, 6.1, m(c(0x8d6e4a), P.METAL, s), m(c(0x8d6e4a), P.METAL, s));
  trucks(g, r, 3, x0, x1, 2.6);
  fence(g, -w / 2 + 0.2, 0.2, w / 2 - 0.2, d - 0.2, 2.2, c(0x6f7478), [false, true, true, true]);
};

const depot: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, m(c(0x8f8a80), P.DIRT, s), 0.04);
  const cols = Math.max(2, Math.floor((w - 6) / 11));
  const rows = Math.max(1, Math.floor((d - 12) / 11));
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = -w / 2 + 6 + i * 11;
      const z = 10 + j * 11;
      const rad = r.range(3.8, 4.6);
      const h = r.range(6, 9);
      g.cylinder(x, z, rad, rad, 0, h, 14, m(c(r.pick([0xe9ebeb, 0xd7dada, 0xc9cfcf])), P.METAL, s, 3, 2), null);
      g.lathe(x, z, [[rad, h], [rad * 0.6, h + 1.2], [0.01, h + 1.6]], 14, m(c(0xd0d3d3), P.METAL, s));
    }
  }
  g.box(-w / 2 + 1, 1, -w / 2 + 8, 6, 0, 3.4, m(c(pick(r, RENDER)), P.OFFICE, s, 3.4, 2.4), m(c(0x7d7a74), P.ROOF_FLAT, s));
  g.box(-w / 2 + 4, 7, w / 2 - 4, 7.5, 0.6, 1.1, m(c(0xb8862f), P.METAL, s), m(c(0xb8862f), P.METAL, s));
  fence(g, -w / 2 + 0.2, 0.2, w / 2 - 0.2, d - 0.2, 2.2, c(0x6f7478), [true, true, true, true]);
};

// ── Services ────────────────────────────────────────────────────────────────

function civic(g: GeoBuilder, r: Rng, b: GenInput, wallHex: number, accent: number, floors: number, frontDepth: number): [number, number, number, number, number] {
  const { w, d } = b;
  const s = b.seed & 255;
  const bw = w - 6, bd = Math.min(d - frontDepth - 4, 18);
  const x0 = -bw / 2, x1 = bw / 2, z0 = frontDepth, z1 = z0 + bd;
  const h = floors * 3.6 + 0.4;
  g.box(x0, z0, x1, z1, 0, h, m(c(wallHex), P.OFFICE, s, 3.6, 3), m(c(0x7d7a74), P.ROOF_FLAT, s));
  rooftop(g, r, x0, z0, x1, z1, h, s, 0.8);
  g.box(x0 - 0.05, z0 - 0.06, x1 + 0.05, z0, h - 1.4, h - 0.4, m(c(accent), P.SIGN, s, 1, bw), null);
  return [x0, z0, x1, z1, h];
}

const police: Gen = (g, b, r) => {
  const s = b.seed & 255;
  g.ground(-b.w / 2, 0, b.w / 2, b.d, PAVE(s), 0.04);
  const [x0, , x1, z1] = civic(g, r, b, 0xd6d3cc, 0x1f4fa8, 3, 7);
  g.box(-3, 4.2, 3, 7, 3.4, 3.7, m(c(0x1f4fa8), P.PLAIN, s), m(c(0x1f4fa8), P.PLAIN, s));
  g.cylinder(x1 - 2, z1 - 2, 0.15, 0.08, 11, 22, 4, m(c(0x999999), P.METAL, s), null);
  for (let i = 0; i < 4; i++) g.prop({ kind: 'car', x: x0 + 2 + i * 3, y: 0.05, z: 2.4, rot: Math.PI / 2, variant: VM.police, color: 0x1d2a44 });
  if (b.d - z1 > 6) parking(g, r, -b.w / 2 + 1, z1 + 1, b.w / 2 - 1, b.d - 0.5, 0.6, s);
};

const fire: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, CONC(s), 0.04);
  const bw = w - 4, bd = Math.min(d - 12, 18);
  const x0 = -bw / 2, x1 = bw / 2, z0 = 11, z1 = z0 + bd;
  const brick = c(0x9a5b45);
  g.box(x0, z0, x1, z1, 0, 8, m(brick, P.BRICK, s, 4, 3), m(c(0x7d7a74), P.ROOF_FLAT, s));
  rooftop(g, r, x0, z0, x1, z1, 8, s, 0.7);
  const bays = Math.max(2, Math.floor((bw - 6) / 5));
  for (let i = 0; i < bays; i++) {
    const a = x0 + 1 + i * 5;
    g.wall(a + 4, z0 - 0.06, a, z0 - 0.06, 0.05, 4.4, m(c(0xb3261e), P.DOOR, s));
  }
  g.box(x1 - 4.5, z1 - 4.5, x1, z1, 8, 17, m(brick, P.BRICK, s, 3, 2), m(c(0x5a5a5a), P.ROOF_FLAT, s));
  g.box(x0 - 0.05, z0 - 0.06, x0 + bays * 5 + 1, z0, 5, 6.2, m(c(0xb3261e), P.SIGN, s, 1, 20), null);
  for (let i = 0; i < Math.min(2, bays); i++) g.prop({ kind: 'car', x: x0 + 3 + i * 5, y: 0.05, z: z0 - 5, rot: Math.PI / 2, variant: VM.firetruck, color: 0xb3161b });
};

const clinic: Gen = (g, b, r) => {
  const s = b.seed & 255;
  g.ground(-b.w / 2, 0, b.w / 2, b.d, GRASS(s), 0.03);
  const [x0, z0, x1, z1, h] = civic(g, r, b, 0xeeeeea, 0xc8202a, 2, 7);
  g.box(-1.6, z0 - 0.4, 1.6, z0, h + 0.2, h + 3.4, m(c(0xffffff), P.PLAIN, s), m(c(0xffffff), P.PLAIN, s));
  g.wall(0.45, z0 - 0.42, -0.45, z0 - 0.42, h + 0.6, h + 3.0, m(c(0xd81e2a), P.SIGN, s, 1, 1));
  g.wall(1.2, z0 - 0.42, -1.2, z0 - 0.42, h + 1.35, h + 2.25, m(c(0xd81e2a), P.SIGN, s, 1, 1));
  g.box(-4, z0 - 4, 4, z0, 3.2, 3.5, m(c(0xd8d8d8), P.METAL, s), m(c(0xd8d8d8), P.METAL, s));
  g.prop({ kind: 'car', x: -2, y: 0.05, z: z0 - 2.2, rot: 0, variant: VM.ambulance, color: 0xf4f4f2 });
  parking(g, r, x1 + 1, 1, b.w / 2 - 0.5, b.d - 1, 0.6, s);
  trees(g, r, 3, -b.w / 2 + 1, z1 + 1, x0, b.d - 1);
};

const hospital: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, PAVE(s), 0.04);
  const white = c(0xeceae4);
  const main = m(white, P.OFFICE, s, 3.8, 2.8);
  const x0 = -w / 2 + 4, x1 = w / 2 - 4;
  g.box(x0, 12, x1, 22, 0, 3 * 3.8, main, m(c(0x8a8780), P.ROOF_FLAT, s));
  g.box(-9, 14, 9, 30, 0, 7 * 3.8, main, m(c(0x8a8780), P.ROOF_FLAT, s));
  g.box(x0, 22, x0 + 10, d - 2, 0, 4 * 3.8, main, m(c(0x8a8780), P.ROOF_FLAT, s));
  const top = 7 * 3.8;
  g.cylinder(0, 22, 6, 6, top, top + 0.4, 16, m(c(0x9a9a9a), P.PLAIN, s), m(c(0x6a6c6e), P.PAVING, s));
  g.flat(-1.6, 19.5, 1.6, 24.5, top + 0.42, m(c(0xffffff), P.SIGN, s));
  g.box(-1.8, 13.4, 1.8, 14, top - 3, top - 0.2, m(c(0xffffff), P.PLAIN, s), null);
  g.wall(0.6, 13.38, -0.6, 13.38, top - 2.8, top - 0.4, m(c(0xd81e2a), P.SIGN, s, 1, 1));
  g.wall(1.6, 13.38, -1.6, 13.38, top - 2.2, top - 1.0, m(c(0xd81e2a), P.SIGN, s, 1, 1));
  g.box(x1 - 10, 6, x1, 12, 3.6, 4.0, m(c(0xc8202a), P.PLAIN, s), m(c(0xc8202a), P.PLAIN, s));
  rooftop(g, r, x0, 12, x1, 22, 3 * 3.8, s, 0.8);
  parking(g, r, x0 + 11, 23, x1, d - 1, 0.7, s);
  g.prop({ kind: 'car', x: x1 - 5, y: 0.05, z: 8.5, rot: 0, variant: VM.ambulance, color: 0xf4f4f2 });
  trees(g, r, 4, -w / 2 + 1, 1, w / 2 - 1, 5, undefined, 0.8);
};

function schoolCampus(g: GeoBuilder, b: GenInput, r: Rng, big: boolean): void {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, GRASS(s), 0.03);
  const brick = c(r.pick([0x9a5b45, 0xa8735a, 0xb48a6c]));
  const fl = big ? 3 : 2;
  const fac = m(brick, P.BRICK, s, 3.5, 3.2);
  const x0 = -w / 2 + 2, z0 = 3;
  const mainW = w * (big ? 0.5 : 0.6);
  g.box(x0, z0, x0 + mainW, z0 + 11, 0, fl * 3.5 + 0.4, fac, m(c(0x7d7a74), P.ROOF_FLAT, s));
  g.box(x0, z0 + 11, x0 + 11, d - 3, 0, fl * 3.5 + 0.4, fac, m(c(0x7d7a74), P.ROOF_FLAT, s));
  rooftop(g, r, x0, z0, x0 + mainW, z0 + 11, fl * 3.5 + 0.4, s, 0.6);
  if (big) g.box(x0 + 12, d - 15, x0 + 26, d - 2, 0, 9, m(c(0xc9c3b8), P.CONCRETE, s), m(c(0x8a8780), P.ROOF_FLAT, s));
  g.box(x0 + 2, z0 - 2.5, x0 + 8, z0, 3, 3.3, m(c(0x2e5f8a), P.PLAIN, s), m(c(0x2e5f8a), P.PLAIN, s));
  const fx0 = x0 + (big ? mainW + 2 : 13), fz0 = z0 + (big ? 2 : 13);
  const fx1 = w / 2 - 2, fz1 = d - 2;
  if (big) {
    g.groundN(fx0, fz0, fx1, fz1, m(c(0xa04a32), P.TRACK, s), 0.05);
    g.groundN(fx0 + 5, fz0 + 5, fx1 - 5, fz1 - 5, m(c(0x4f8a3a), P.FIELD, s), 0.07);
  } else {
    g.groundN(fx0, fz0, fx1, fz1, m(c(0x568f3d), P.FIELD, s), 0.05);
    g.ground(fx0, 1, fx1, fz0 - 2, m(c(0x9a9690), P.PAVING, s), 0.045);
  }
  trees(g, r, 4, -w / 2 + 1, 0.5, w / 2 - 1, 2.5, undefined, 0.8);
}

/**
 * Cargo harbour: a paved yard of container stacks in shipping-line colours, a
 * transit shed and gatehouse by the road, and two ship-to-shore gantry cranes
 * on rails along the quay, their booms reaching out over the water.
 */
const cargoPort: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  const hw = w / 2;
  g.ground(-hw, 0, hw, d, m(c(0x8e8b85), P.CONCRETE, s), 0.04);
  // Quay coping with bollards, and the crane rails.
  g.box(-hw, d - 2.4, hw, d, 0, 0.55, m(c(0x6b6862), P.CONCRETE, s), m(c(0x9b978f), P.PAVING, s));
  for (let x = -hw + 6; x < hw - 3; x += 12) g.cylinder(x, d - 1.2, 0.4, 0.32, 0.55, 1.3, 6, m(c(0x2a2a2a), P.METAL, s), m(c(0x2a2a2a), P.METAL, s));
  for (const z of [d - 22, d - 6]) g.ground(-hw, z - 0.35, hw, z + 0.35, m(c(0x4d4b47), P.METAL, s), 0.07);
  // Container stacks: rows of 40 ft boxes, two lanes deep, one to four high.
  const BOX = [0x8c1a12, 0x103466, 0x15532e, 0xc0520f, 0x75777a, 0x0d6166, 0xe6e4de, 0x6a1b4d];
  for (let row = 0; row < 4; row++) {
    const z0 = 11 + row * 8.5;
    for (let x = -hw + 26; x + 12.2 < hw - 4; x += 13.4) {
      const tall = r.int(0, 4);
      if (!tall) continue;
      for (let lane = 0; lane < 2; lane++) {
        const zz = z0 + lane * 2.6;
        const h = Math.max(1, tall - (r.chance(0.3) ? 1 : 0));
        for (let k = 0; k < h; k++) {
          const col = c(r.pick(BOX));
          g.box(x, zz, x + 12.1, zz + 2.44, k * 2.6, k * 2.6 + 2.56, m(col, P.INDUSTRIAL, s, 2.6, 0.6), m(shade(col, 0.9), P.PLAIN, s));
        }
      }
    }
  }
  // Transit shed and gatehouse by the road.
  const clad = m(c(0xb5b9bd), P.INDUSTRIAL, s, 9, 1.2);
  g.box(-hw + 2, 3, -hw + 22, 44, 0, 9, clad, null);
  g.gable(-hw + 2, 3, -hw + 22, 44, 9, 3, false, m(c(0x5f6d78), P.METAL, s), clad, 0.4);
  for (let i = 0; i < 3; i++) g.wall(-hw + 22.05, 8 + i * 12 + 6, -hw + 22.05, 8 + i * 12, 0, 5, m(c(0x3d5566), P.DOOR, s));
  g.box(hw - 15, 2, hw - 9, 6.5, 0, 3.2, m(c(0xe8e6e0), P.PLAIN, s), m(c(0x7d7a74), P.ROOF_FLAT, s));
  g.box(hw - 24, 3.8, hw - 15.5, 4.2, 1.1, 1.3, m(c(0xd32f2f), P.PLAIN, s), m(c(0xd32f2f), P.PLAIN, s));
  // Two gantry cranes: four legs on the rails, a machinery house, a boom out over the water
  // and an A-frame with a warning light on top.
  const paint = c(r.pick([0xc0392b, 0x2e75b6, 0xd4a017]));
  const steel = m(paint, P.METAL, s), white = m(c(0xe8e8e4), P.METAL, s);
  for (const cx of [-16, 26]) {
    const zA = d - 22, zB = d - 6;
    for (const lx of [cx - 9, cx + 9]) {
      for (const lz of [zA, zB]) g.box(lx - 0.7, lz - 0.7, lx + 0.7, lz + 0.7, 0.2, 34, steel, steel);
      g.box(lx - 0.8, zA - 1, lx + 0.8, zB + 1, 0, 1.4, steel, steel);
      g.box(lx - 0.6, zA, lx + 0.6, zB, 18, 19.2, steel, steel);
    }
    g.box(cx - 10, zA - 1, cx + 10, zB + 1, 33, 35, steel, steel);
    g.box(cx - 3.5, zA - 12, cx + 3.5, zA + 2, 35, 41, white, m(c(0x8a8780), P.ROOF_FLAT, s));
    g.box(cx - 1.6, zA - 12, cx + 1.6, d + 36, 36.5, 38.5, steel, steel);
    for (const ax of [cx - 1.4, cx + 1.4]) g.box(ax - 0.4, zA + 6, ax + 0.4, zA + 7, 38.5, 54, steel, steel);
    g.box(cx - 1.8, zA + 5.8, cx + 1.8, zA + 7.2, 53, 54.5, steel, steel);
    g.box(cx - 0.4, zA + 6.1, cx + 0.4, zA + 6.9, 54.5, 55.3, m(c(0xff2a1a), P.SIGN, s, 1, 1), null);
    // Trolley and spreader hanging over the water.
    const tz = d + 8 + r.range(0, 18);
    g.box(cx - 2, tz - 2, cx + 2, tz + 2, 34.5, 36.5, white, white);
    g.box(cx - 0.1, tz - 0.1, cx + 0.1, tz + 0.1, 22, 34.5, m(c(0x333333), P.METAL, s), null);
    g.box(cx - 1.4, tz - 6, cx + 1.4, tz + 6, 21, 22, steel, steel);
  }
  // Floodlight masts.
  for (const x of [-hw + 30, 4, hw - 12]) {
    g.cylinder(x, 8, 0.35, 0.25, 0, 26, 6, m(c(0x9a9da1), P.METAL, s), null);
    g.box(x - 1.6, 7.4, x + 1.6, 8.6, 26, 27, m(c(0xfff1c8), P.SIGN, s, 1, 3), m(c(0x5a5a5a), P.METAL, s));
  }
  // Trucks waiting in the yard.
  for (let i = 0; i < 4; i++) g.prop({ kind: 'car', x: -hw + 30 + i * 18, y: 0.05, z: 6.5, rot: 0, variant: VM.truck, color: r.pick([0xe8e6e0, 0x1f4fa8, 0xc0392b, 0x2e7d32]) });
};

const school: Gen = (g, b, r) => schoolCampus(g, b, r, false);
const highschool: Gen = (g, b, r) => schoolCampus(g, b, r, true);

/**
 * University: a stone hall with a portico and clock tower at the head of a
 * tree-lined quad, brick wings down both sides, a library and a glass science
 * block by the street, and a gateway with a lit nameplate.
 */
const university: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  const stone = c(0xe3dccb), trim = c(0xcdc3ad), slate = c(0x4a5058), copper = c(0x6f9c8a);
  const brick = c(r.pick([0x9a5b45, 0x8e4f3c, 0xa4664c]));
  const flat = m(c(0x8a8780), P.ROOF_FLAT, s);
  const hw = w / 2;
  g.ground(-hw, 0, hw, d, GRASS(s), 0.03);
  // Paths: the axis from the gate to the hall, and a cross walk between the wings.
  const walk = m(c(0xc9c1ae), P.PAVING, s);
  g.ground(-3.5, 0, 3.5, 58, walk, 0.05);
  g.ground(-31, 37.5, 31, 42.5, walk, 0.05);
  // Gateway with a lit nameplate.
  for (const x of [-7, 7]) {
    g.box(x - 1, 1.5, x + 1, 3.5, 0, 5.2, m(stone, P.PLAIN, s), m(trim, P.PLAIN, s));
    g.box(x - 1.3, 1.2, x + 1.3, 3.8, 5.2, 5.8, m(trim, P.PLAIN, s), m(trim, P.PLAIN, s));
  }
  g.box(-6, 2.1, 6, 2.9, 4.4, 5.4, m(trim, P.PLAIN, s), m(trim, P.PLAIN, s));
  g.box(-4, 2.05, 4, 2.1, 4.55, 5.25, m(c(0xfff1c8), P.SIGN, s, 1, 8), null);
  // Fountain at the centre of the quad.
  g.cylinder(0, 40, 4.4, 4.4, 0, 0.7, 24, m(c(0xbdb6a8), P.CONCRETE, s), m(c(0x3f8fb0), P.WATER, s));
  g.cylinder(0, 40, 0.5, 0.4, 0.7, 2, 8, m(c(0xbdb6a8), P.CONCRETE, s), null);
  g.prop({ kind: 'fountain', x: 0, y: 2, z: 40, rot: 0 });
  // Main hall: steps, columned portico with pediment, cornice.
  const hz0 = 60, hz1 = d - 8, hh = 15;
  g.box(-14, 55, 14, hz0, 0, 0.6, m(trim, P.CONCRETE, s), m(trim, P.PAVING, s));
  g.box(-13, 56.5, 13, hz0, 0.6, 1.2, m(trim, P.CONCRETE, s), m(trim, P.PAVING, s));
  g.box(-26, hz0, 26, hz1, 0, hh, m(stone, P.RES, s, 3.8, 3.4), null);
  g.box(-26.5, hz0 - 0.5, 26.5, hz1 + 0.5, hh, hh + 0.9, m(trim, P.PLAIN, s), null);
  g.hip(-26.5, hz0 - 0.5, 26.5, hz1 + 0.5, hh + 0.9, 5.5, m(slate, P.ROOF_TILE, s), 0.4);
  for (let i = 0; i < 6; i++) g.cylinder(-10 + i * 4, 57.6, 0.62, 0.52, 1.2, 12.4, 10, m(stone, P.PLAIN, s), null);
  g.box(-12, 56.4, 12, hz0, 12.4, 13.6, m(trim, P.PLAIN, s), m(stone, P.PLAIN, s));
  g.gable(-12, 56.4, 12, hz0, 13.6, 3.6, false, m(slate, P.ROOF_TILE, s), m(stone, P.PLAIN, s), 0.25);
  g.wall(2, hz0 - 0.05, -2, hz0 - 0.05, 1.2, 7, m(c(0x4a3426), P.DOOR, s));
  // Clock tower rising from the hall, with a lit face on every side and a copper spire.
  const tz = hz0 + 7, th = hh + 0.9, top = th + 17;
  g.box(-4, tz - 4, 4, tz + 4, th, top, m(stone, P.RES, s, 4.2, 2.6), null);
  g.box(-4.5, tz - 4.5, 4.5, tz + 4.5, top, top + 1, m(trim, P.PLAIN, s), m(trim, P.PLAIN, s));
  const face = m(c(0xfff6dc), P.SIGN, s, 1, 3);
  g.box(-1.6, tz - 4.06, 1.6, tz - 4, top - 5, top - 1.8, face, null);
  g.box(-1.6, tz + 4, 1.6, tz + 4.06, top - 5, top - 1.8, face, null);
  g.box(-4.06, tz - 1.6, -4, tz + 1.6, top - 5, top - 1.8, face, null);
  g.box(4, tz - 1.6, 4.06, tz + 1.6, top - 5, top - 1.8, face, null);
  g.lathe(0, tz, [[4.4, top + 1], [3.4, top + 3.5], [0.01, top + 12]], 4, m(copper, P.METAL, s));
  // Brick wings with slate roofs down both sides of the quad.
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -hw + 4 : hw - 22, x1 = x0 + 18;
    g.box(x0, 26, x1, 82, 0, 11, m(brick, P.BRICK, s, 3.6, 3.2), null);
    g.gable(x0, 26, x1, 82, 11, 5.5, false, m(slate, P.ROOF_TILE, s), m(brick, P.BRICK, s, 3.6, 3.2), 0.4);
    for (const z of [38, 62]) g.box(x0 + 7, z, x1 - 7, z + 3, 15, 19, m(brick, P.BRICK, s, 2, 1.5), m(c(0x5a5a5a), P.ROOF_FLAT, s));
  }
  // Library (stone, tall windows) and a glass science block facing the street.
  g.box(-hw + 4, 6, -hw + 26, 22, 0, 10, m(stone, P.RES, s, 5, 2.6), flat);
  g.box(-hw + 3.6, 5.6, -hw + 26.4, 22.4, 10, 10.7, m(trim, P.PLAIN, s), flat);
  g.cylinder(-hw + 15, 14, 4.2, 4.2, 10.7, 12.6, 20, m(stone, P.PLAIN, s), null);
  g.lathe(-hw + 15, 14, [[4.5, 12.6], [4.1, 14.2], [2.9, 15.6], [1.2, 16.4], [0.01, 16.6]], 20, m(copper, P.METAL, s));
  g.box(hw - 26, 6, hw - 4, 22, 0, 4 * 3.6, m(c(0x5f7f8f), P.GLASS, s, 3.6, 1.8), flat);
  rooftop(g, r, hw - 25, 7, hw - 5, 21, 4 * 3.6, s, 0.7);
  // Avenues of trees along the quad, more behind the hall.
  for (const z of [27, 34, 47, 54]) for (const x of [-24, -13, 13, 24]) g.prop({ kind: 'tree', x: x + r.range(-0.8, 0.8), y: 0, z, rot: r.next() * 6.28, scale: r.range(0.75, 0.95), variant: r.int(0, 2) });
  trees(g, r, 6, -hw + 2, hz1 + 1.5, hw - 2, d - 1, undefined, 0.85);
  bushes(g, r, 8, -26, 26, 58.4);
};

const landfill: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, m(c(0x6e604c), P.DIRT, s), 0.04);
  for (let i = 0; i < 5; i++) {
    const x = r.range(-w / 2 + 8, w / 2 - 8);
    const z = r.range(10, d - 8);
    const rad = r.range(5, 9);
    g.lathe(x, z, [[rad, 0], [rad * 0.6, r.range(2.5, 4.5)], [0.01, r.range(4.6, 6)]], 9, m(c(r.pick([0x5f5546, 0x6d6656, 0x56604a])), P.DIRT, s));
  }
  g.box(-w / 2 + 1, 1, -w / 2 + 7, 5, 0, 3, m(c(0xc9c3b8), P.OFFICE, s, 3, 2.4), m(c(0x7d7a74), P.ROOF_FLAT, s));
  g.prop({ kind: 'car', x: 0, y: 0.05, z: 3, rot: Math.PI / 2, variant: VM.garbage, color: 0x2f7d4a });
  fence(g, -w / 2 + 0.2, 0.2, w / 2 - 0.2, d - 0.2, 2.4, c(0x5d6a52), [true, true, true, true]);
  trees(g, r, 6, -w / 2 + 1, d - 3, w / 2 - 1, d - 1, undefined, 0.9);
};

const recycling: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, CONC(s), 0.04);
  const x0 = -w / 2 + 2, x1 = w / 2 - 12, z0 = 8, z1 = d - 2;
  g.box(x0, z0, x1, z1, 0, 10, m(c(0xd5ddd2), P.INDUSTRIAL, s, 10, 1.2), m(c(0x9ea7a0), P.ROOF_FLAT, s));
  g.box(x0, z0 - 0.06, x1, z0, 8, 9.4, m(c(0x2f8a4a), P.SIGN, s, 1, 10), null);
  loadingDoors(g, x0 + 2, x1 - 2, z0, 3, s);
  const piles = [0x3a6ea5, 0x7a7a7a, 0x9b7b4a, 0x4a8a5a];
  for (let i = 0; i < 4; i++) g.box(x1 + 2, z0 + i * 6, w / 2 - 2, z0 + i * 6 + 4.5, 0, r.range(1.5, 2.8), m(c(piles[i]), P.DIRT, s), m(c(piles[i]), P.DIRT, s));
  g.prop({ kind: 'car', x: x0 + 6, y: 0.05, z: 4, rot: Math.PI / 2, variant: VM.garbage, color: 0x2f7d4a });
};

function park(g: GeoBuilder, b: GenInput, r: Rng, kind: 'small' | 'plaza' | 'town' | 'large'): void {
  const { w, d } = b;
  const s = b.seed & 255;
  if (kind === 'plaza') {
    g.ground(-w / 2, 0, w / 2, d, m(c(0xc8c2b6), P.PAVING, s), 0.06);
    g.cylinder(0, d / 2, 4.5, 4.5, 0, 0.7, 20, m(c(0xb8b2a6), P.CONCRETE, s), m(c(0x3f8fb0), P.WATER, s));
    g.cylinder(0, d / 2, 0.7, 0.5, 0.7, 2.2, 10, m(c(0xb8b2a6), P.CONCRETE, s), null);
    g.prop({ kind: 'fountain', x: 0, y: 2.2, z: d / 2, rot: 0 });
    for (const [x, z] of [[-w / 2 + 3, 3], [w / 2 - 3, 3], [-w / 2 + 3, d - 3], [w / 2 - 3, d - 3], [0, 3], [0, d - 3]] as [number, number][]) {
      g.box(x - 1.3, z - 1.3, x + 1.3, z + 1.3, 0, 0.55, m(c(0x9a948a), P.CONCRETE, s), m(c(0x5f7a3c), P.GRASS, s));
      g.prop({ kind: 'tree', x, y: 0.55, z, rot: x + z, scale: 0.75, variant: 1 });
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const bx = Math.cos(a) * 7.5, bz = d / 2 + Math.sin(a) * 7.5;
      g.boxRot(bx, bz, 1.8, 0.5, a + Math.PI / 2, 0, 0.45, m(c(0x7b5a3a), P.PLAIN, s), m(c(0x7b5a3a), P.PLAIN, s));
    }
    return;
  }
  g.ground(-w / 2, 0, w / 2, d, m(c(0x64903e), P.GRASS, s, 3, 3), 0.05);
  const path = m(c(0xc4b89e), P.PAVING, s);
  g.ground(-1.2, 0, 1.2, d, path, 0.07);
  g.ground(-w / 2, d / 2 - 1.2, w / 2, d / 2 + 1.2, path, 0.07);
  if (kind === 'small') {
    g.ground(w / 4 - 3, d / 4 - 3, w / 4 + 3, d / 4 + 3, m(c(0xb0753f), P.DIRT, s), 0.08);
    g.box(w / 4 - 1.5, d / 4 - 0.5, w / 4 + 1.5, d / 4 + 0.5, 0, 2.2, m(c(0xd9472b), P.PLAIN, s), m(c(0x2e86c1), P.PLAIN, s));
    g.box(w / 4 + 1.5, d / 4 - 0.3, w / 4 + 3, d / 4 + 0.3, 0, 1.2, m(c(0xf1c40f), P.PLAIN, s), m(c(0xf1c40f), P.PLAIN, s));
    trees(g, r, 4, -w / 2 + 1.5, 1.5, w / 2 - 1.5, d - 1.5, [-1.5, 0, 1.5, d]);
    bushes(g, r, 4, -w / 2 + 1, -2, d - 1);
    return;
  }
  const pond = kind === 'large' ? [w * 0.18, d * 0.62, 12, 8] : [w * 0.22, d * 0.72, 6, 4.5];
  g.cylinder(pond[0], pond[1], pond[2], pond[2], -0.2, 0.09, 18, m(c(0x8c7d62), P.DIRT, s), m(c(0x3a7f8f), P.WATER, s));
  g.cylinder(pond[0] - pond[2] * 0.6, pond[1] + 1, pond[3], pond[3], -0.2, 0.09, 14, m(c(0x8c7d62), P.DIRT, s), m(c(0x3a7f8f), P.WATER, s));
  // Pavilion
  const pvx = -w / 4, pvz = d * 0.3;
  for (const [dx, dz] of [[-2, -2], [2, -2], [2, 2], [-2, 2]]) g.box(pvx + dx - 0.15, pvz + dz - 0.15, pvx + dx + 0.15, pvz + dz + 0.15, 0, 3, m(c(0xf2efe8), P.PLAIN, s), null);
  g.hip(pvx - 2.6, pvz - 2.6, pvx + 2.6, pvz + 2.6, 3, 1.6, m(c(0x4a5a4a), P.ROOF_TILE, s), 0.2);
  trees(g, r, kind === 'large' ? 26 : 12, -w / 2 + 2, 2, w / 2 - 2, d - 2, [-2, 0, 2, d]);
  bushes(g, r, 6, -w / 2 + 2, w / 2 - 2, 1.2);
}

const parkSmall: Gen = (g, b, r) => park(g, b, r, 'small');
const plaza: Gen = (g, b, r) => park(g, b, r, 'plaza');
const parkTown: Gen = (g, b, r) => park(g, b, r, 'town');
const parkLarge: Gen = (g, b, r) => park(g, b, r, 'large');

/** Thin painted line on the ground from (x0, z0) to (x1, z1). */
function line(g: GeoBuilder, x0: number, z0: number, x1: number, z1: number, wdt: number, mat: Mat, lift = 0.09): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 0.01) return;
  g.boxRot((x0 + x1) / 2, (z0 + z1) / 2, len, wdt, Math.atan2(z1 - z0, x1 - x0), lift - 0.02, lift, mat, mat);
}

function ringLine(g: GeoBuilder, cx: number, cz: number, rad: number, wdt: number, mat: Mat, segs = 20): void {
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    line(g, cx + Math.cos(a0) * rad, cz + Math.sin(a0) * rad, cx + Math.cos(a1) * rad, cz + Math.sin(a1) * rad, wdt, mat);
  }
}

/** Football pitch with mown stripes, goals, a small stand and floodlights. */
const sportsField: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, m(c(0x5f8a3e), P.GRASS, s), 0.04);
  const px0 = -w / 2 + 3, px1 = w / 2 - 3, pz0 = 3, pz1 = d - 9;
  for (let i = 0, x = px0; x < px1; i++, x += 4) g.ground(x, pz0, Math.min(px1, x + 4), pz1, m(c(i % 2 ? 0x4f8a36 : 0x5c9a40), P.PLAIN, s), 0.06);
  const chalk = m(c(0xf4f4f0), P.PLAIN, s);
  line(g, px0, pz0, px1, pz0, 0.15, chalk);
  line(g, px0, pz1, px1, pz1, 0.15, chalk);
  line(g, px0, pz0, px0, pz1, 0.15, chalk);
  line(g, px1, pz0, px1, pz1, 0.15, chalk);
  const midX = (px0 + px1) / 2, midZ = (pz0 + pz1) / 2;
  line(g, midX, pz0, midX, pz1, 0.15, chalk);
  ringLine(g, midX, midZ, 4.5, 0.15, chalk);
  for (const side of [-1, 1]) {
    const gx = side < 0 ? px0 : px1;
    const bx = gx - side * 6;
    line(g, gx, midZ - 7, bx, midZ - 7, 0.15, chalk);
    line(g, gx, midZ + 7, bx, midZ + 7, 0.15, chalk);
    line(g, bx, midZ - 7, bx, midZ + 7, 0.15, chalk);
    // Goal: two posts and a crossbar.
    for (const z of [midZ - 2.4, midZ + 2.4]) g.box(gx - 0.08, z - 0.08, gx + 0.08, z + 0.08, 0, 2.3, chalk, chalk);
    g.box(gx - 0.08, midZ - 2.4, gx + 0.08, midZ + 2.4, 2.22, 2.34, chalk, chalk);
    g.box(gx + side * 1.2 - 0.04, midZ - 2.4, gx + side * 1.2 + 0.04, midZ + 2.4, 0, 0.12, m(c(0xd8d8d4), P.METAL, s), null);
  }
  // Covered stand along the back.
  const sx0 = -w / 4, sx1 = w / 4, sz0 = d - 7.5;
  for (let k = 0; k < 4; k++) g.box(sx0, sz0 + k * 1.2, sx1, sz0 + (k + 1) * 1.2, 0, 0.5 + k * 0.5, m(c(0xb8b4ac), P.CONCRETE, s), m(c(k % 2 ? 0x2e86c1 : 0x2874a6), P.PLAIN, s));
  g.box(sx0 - 0.5, sz0 - 1, sx1 + 0.5, d - 1.5, 4.4, 4.7, m(c(0xe6e6e2), P.PLAIN, s), m(c(0x9aa0a4), P.METAL, s));
  for (const x of [sx0, sx1]) g.box(x - 0.15, d - 2, x + 0.15, d - 1.7, 0, 4.4, m(c(0x8d9296), P.METAL, s), null);
  // Floodlight masts at the corners (lamps glow at night).
  for (const [x, z] of [[-w / 2 + 1, 1], [w / 2 - 1, 1], [-w / 2 + 1, d - 9], [w / 2 - 1, d - 9]] as [number, number][]) {
    g.box(x - 0.18, z - 0.18, x + 0.18, z + 0.18, 0, 13, m(c(0x8d9296), P.METAL, s), null);
    g.box(x - 1.1, z - 0.3, x + 1.1, z + 0.3, 13, 14.2, m(c(0xfff6dc), P.SIGN, s, 1, 2.2), m(c(0x6f7478), P.METAL, s));
  }
  trees(g, r, 3, -w / 2 + 1, d - 7, sx0 - 2, d - 1, undefined, 0.8);
  trees(g, r, 3, sx1 + 2, d - 7, w / 2 - 1, d - 1, undefined, 0.8);
};

/** Allotments: raised beds in rows, a potting shed, water butts and fruit trees. */
const communityGarden: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, m(c(0x6f8a45), P.GRASS, s), 0.04);
  g.ground(-1, 0, 1, d - 1, m(c(0xb9a888), P.PAVING, s), 0.06);
  const crops = [0x4f8a2e, 0x6aa84f, 0x8bbf4a, 0x3f7a3a, 0xc0553a, 0xe0b040, 0x7a4f8f];
  for (const side of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const z0 = 2 + k * ((d - 9) / 5);
      const x0 = side < 0 ? -w / 2 + 2 : 2, x1 = side < 0 ? -2 : w / 2 - 2;
      g.box(x0, z0, x1, z0 + 2.2, 0, 0.45, m(c(0x7a5a3a), P.PLAIN, s), m(c(0x5a4030), P.DIRT, s));
      for (let x = x0 + 0.6; x < x1 - 0.4; x += 0.9) {
        const col = crops[(((k + Math.floor(x * 7) + (side > 0 ? 3 : 0)) % crops.length) + crops.length) % crops.length];
        g.box(x - 0.3, z0 + 0.4, x + 0.3, z0 + 1.8, 0.45, 0.45 + r.range(0.25, 0.6), m(c(col), P.PLAIN, s), m(c(col), P.PLAIN, s));
      }
    }
  }
  // Shed with a pitched roof and water butts.
  const hx = w / 2 - 6, hz = d - 5;
  g.box(hx - 2.5, hz - 2, hx + 2.5, hz + 2, 0, 2.4, m(c(0x8a6a4a), P.INDUSTRIAL, s, 2.4, 0.3), null);
  g.gable(hx - 2.5, hz - 2, hx + 2.5, hz + 2, 2.4, 1.1, true, m(c(0x3f4a3f), P.ROOF_TILE, s), m(c(0x8a6a4a), P.PLAIN, s), 0.25);
  for (const x of [hx - 3.4, -w / 2 + 3]) g.cylinder(x, hz - 1.4, 0.5, 0.5, 0, 1.1, 10, m(c(0x2f5f3a), P.PLAIN, s), m(c(0x1f3f2a), P.PLAIN, s));
  trees(g, r, 3, -w / 2 + 2, d - 6, hx - 4, d - 1.5, undefined, 0.7);
  fence(g, -w / 2 + 0.2, 0.2, w / 2 - 0.2, d - 0.2, 1.2, c(0x8a7458), [true, true, true, true]);
};

/** Fenced basketball and tennis courts. */
const sportsCourts: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, m(c(0x6a6c70), P.CONCRETE, s), 0.04);
  const chalk = m(c(0xf4f4f0), P.PLAIN, s);
  // Basketball court (left).
  const bx0 = -w / 2 + 1.5, bx1 = -1, bz0 = 2, bz1 = d - 2;
  g.ground(bx0, bz0, bx1, bz1, m(c(0xc0603a), P.PLAIN, s), 0.06);
  g.ground(bx0 + 1, bz0 + 1, bx1 - 1, bz1 - 1, m(c(0x2f6f9a), P.PLAIN, s), 0.07);
  const bmx = (bx0 + bx1) / 2;
  line(g, bx0 + 1, (bz0 + bz1) / 2, bx1 - 1, (bz0 + bz1) / 2, 0.1, chalk);
  ringLine(g, bmx, (bz0 + bz1) / 2, 1.8, 0.1, chalk, 16);
  for (const [z, dir] of [[bz0 + 1, 1], [bz1 - 1, -1]] as [number, number][]) {
    g.box(bmx - 0.1, z - dir * 0.6 - 0.1, bmx + 0.1, z - dir * 0.6 + 0.1, 0, 3.4, m(c(0x3b3d40), P.METAL, s), null);
    g.box(bmx - 0.9, z - 0.05, bmx + 0.9, z + 0.05, 2.9, 4.0, m(c(0xf4f4f0), P.PLAIN, s), chalk);
    g.box(bmx - 0.25, z + dir * 0.2 - 0.25, bmx + 0.25, z + dir * 0.2 + 0.25, 3.0, 3.05, m(c(0xd35400), P.PLAIN, s), null);
  }
  // Tennis court (right) with a net.
  const tx0 = 1, tx1 = w / 2 - 1.5;
  g.ground(tx0, bz0, tx1, bz1, m(c(0x3f7f4f), P.PLAIN, s), 0.06);
  g.ground(tx0 + 1.2, bz0 + 1.2, tx1 - 1.2, bz1 - 1.2, m(c(0x2e6fa0), P.PLAIN, s), 0.07);
  const tmz = (bz0 + bz1) / 2;
  line(g, (tx0 + tx1) / 2, bz0 + 1.2, (tx0 + tx1) / 2, bz1 - 1.2, 0.08, chalk);
  g.box(tx0 + 0.9, tmz - 0.03, tx1 - 0.9, tmz + 0.03, 0, 0.95, m(c(0x1d1f22), P.PLAIN, s), chalk);
  fence(g, -w / 2 + 0.2, 0.2, w / 2 - 0.2, d - 0.2, 1.1, c(0x4f5559), [true, true, true, true]);
  // Tall corner posts suggest the chain-link screen without hiding the courts.
  for (const x of [-w / 2 + 0.3, 0, w / 2 - 0.3]) for (const z of [0.3, d - 0.3]) g.box(x - 0.06, z - 0.06, x + 0.06, z + 0.06, 0, 3.2, m(c(0x4f5559), P.METAL, s), null);
  void r;
};

/** Botanical garden: a glass palm house, flower beds, a lily pond and specimen trees. */
const botanicalGarden: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, m(c(0x5f8a3e), P.GRASS, s), 0.04);
  const path = m(c(0xd2c6a8), P.PAVING, s);
  g.ground(-1.5, 0, 1.5, d - 2, path, 0.07);
  g.ground(-w / 2 + 2, d * 0.45 - 1.2, w / 2 - 2, d * 0.45 + 1.2, path, 0.07);
  // Palm house: a glass dome on a white base with a lantern on top.
  const hx = 0, hz = d - 13;
  g.cylinder(hx, hz, 10, 10, 0, 1.2, 28, m(c(0xeeece6), P.PLAIN, s), null);
  g.lathe(hx, hz, [[10, 1.2], [9.6, 4], [8.4, 7], [6.2, 9.6], [3.4, 11.3], [0.01, 11.9]], 28, m(c(0x9fc6cf), P.GLASS_PLAIN, s));
  g.cylinder(hx, hz, 1.2, 0.9, 11.6, 13.4, 12, m(c(0xeeece6), P.PLAIN, s), m(c(0x8d9296), P.METAL, s));
  for (const side of [-1, 1]) {
    const x0 = hx + side * 9, x1 = hx + side * 19;
    g.box(Math.min(x0, x1), hz - 4, Math.max(x0, x1), hz + 4, 0, 5.2, m(c(0x9fc6cf), P.GLASS_PLAIN, s), null);
    g.gable(Math.min(x0, x1), hz - 4, Math.max(x0, x1), hz + 4, 5.2, 2.2, true, m(c(0xa8ccd4), P.GLASS_PLAIN, s), m(c(0x9fc6cf), P.GLASS_PLAIN, s), 0.1);
  }
  // Flower beds in bright bands.
  const blooms = [0xd6336c, 0xf2c94c, 0x9b51e0, 0xf2994a, 0xffffff, 0xe8453c];
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1;
    const z = 3 + Math.floor(i / 2) * 3.4;
    g.box(Math.min(side * 3, side * (w / 2 - 4)), z, Math.max(side * 3, side * (w / 2 - 4)), z + 2.2, 0, 0.35, m(c(0x6b5a44), P.PLAIN, s), m(c(blooms[(i + s) % blooms.length]), P.FIELD, s));
  }
  // Lily pond.
  g.cylinder(w / 2 - 10, d * 0.45 + 7, 5, 5, -0.2, 0.09, 18, m(c(0x8c7d62), P.DIRT, s), m(c(0x3a7f8f), P.WATER, s));
  trees(g, r, 14, -w / 2 + 2, 2, w / 2 - 2, d - 2, [-20, hz - 11, 20, hz + 11], 1);
  fence(g, -w / 2 + 0.2, 0.2, w / 2 - 0.2, d - 0.2, 1.4, c(0x2f3d36), [true, true, true, true]);
};

// ── Utilities ───────────────────────────────────────────────────────────────

const wind: Gen = (g, b) => {
  const s = b.seed & 255;
  g.ground(-b.w / 2, 0, b.w / 2, b.d, m(c(0x8f8a80), P.DIRT, s), 0.04);
  g.box(-3.5, 2, -1.5, 4, 0, 2.2, m(c(0xb9bcbc), P.METAL, s), m(c(0xa0a3a3), P.METAL, s));
  g.prop({ kind: 'rotor', x: 0, y: 48.8, z: b.d / 2, rot: -Math.PI / 2 + (s / 255) * 0.4, variant: s });
};

const coal: Gen = (g, b) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, CONC(s), 0.04);
  const hall = m(c(0xb9b6ae), P.INDUSTRIAL, s, 12, 1.4);
  g.box(-w / 2 + 2, 4, -2, 18, 0, 16, hall, m(c(0x8f8c86), P.ROOF_FLAT, s));
  g.box(-w / 2 + 6, 18, -6, 28, 0, 30, m(c(0x9da3a6), P.INDUSTRIAL, s, 12, 1.4), m(c(0x7f8285), P.ROOF_FLAT, s));
  const prof: [number, number][] = [[12, 0], [10.5, 8], [8.4, 22], [8.2, 28], [9, 36]];
  for (const [x, z] of [[8, 11], [w / 2 - 10, 28]] as [number, number][]) {
    g.lathe(x, z, prof, 22, m(c(0xd2d0ca), P.CONCRETE, s));
    g.prop({ kind: 'steam', x, y: 36, z, rot: 0, scale: 2.4 });
  }
  g.cylinder(-6, 34, 2.4, 1.6, 0, 72, 12, m(c(0xc9c4bb), P.CONCRETE, s), m(c(0x2a2a2a), P.PLAIN, s));
  g.cylinder(-6, 34, 1.75, 1.7, 64, 68, 12, m(c(0xb3261e), P.PLAIN, s), null);
  g.prop({ kind: 'smoke', x: -6, y: 72, z: 34, rot: 0, scale: 2.2 });
  g.lathe(w / 2 - 12, 8, [[8, 0], [5, 3], [0.01, 4]], 10, m(c(0x2d2b29), P.DIRT, s));
  g.box(-2, 6, w / 2 - 16, 7.4, 8, 9, m(c(0x7e6b52), P.METAL, s), m(c(0x7e6b52), P.METAL, s));
  fence(g, -w / 2 + 0.2, 0.2, w / 2 - 0.2, d - 0.2, 2.4, c(0x6f7478), [true, true, true, true]);
};

const solar: Gen = (g, b) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, m(c(0xa59e8e), P.DIRT, s), 0.04);
  const rows = Math.floor((d - 6) / 4.2);
  for (let i = 0; i < rows; i++) {
    const z = 4 + i * 4.2;
    const x0 = -w / 2 + 2, x1 = w / 2 - 2;
    g.quad([x1, 0.7, z], [x0, 0.7, z], [x0, 2.2, z + 2.6], [x1, 2.2, z + 2.6], [0, 0.86, -0.5], m(c(0x1d2f4f), P.SOLAR, s), [[x1, 0], [x0, 0], [x0, 3], [x1, 3]]);
    g.box(x0, z + 2.4, x1, z + 2.6, 0, 2.2, m(c(0x9aa0a4), P.METAL, s), null);
  }
  g.box(-w / 2 + 1, d - 3, -w / 2 + 5, d - 1, 0, 2.4, m(c(0xd0d4d4), P.METAL, s), m(c(0xb0b4b4), P.METAL, s));
  fence(g, -w / 2 + 0.2, 0.2, w / 2 - 0.2, d - 0.2, 2.0, c(0x6f7478), [true, true, true, true]);
};

const waterTower: Gen = (g, b) => {
  const s = b.seed & 255;
  g.ground(-b.w / 2, 0, b.w / 2, b.d, CONC(s), 0.04);
  const cz = b.d / 2;
  g.cylinder(0, cz, 1.6, 1.3, 0, 19, 12, m(c(0xd8d6d0), P.CONCRETE, s), null);
  g.lathe(0, cz, [[1.3, 18.5], [5.6, 21.5], [6.3, 24.5], [5.4, 27.6], [2.4, 29.2], [0.01, 29.6]], 18, m(c(0xe9e7e1), P.METAL, s, 3, 3));
  g.box(-6, 1, -3, 3, 0, 2.6, m(c(0xc9c3b8), P.PLAIN, s), m(c(0x7d7a74), P.ROOF_FLAT, s));
};

const pump: Gen = (g, b) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, CONC(s), 0.04);
  g.box(-w / 2 + 2, 2, 2, 10, 0, 6, m(c(0xa8735a), P.BRICK, s, 3, 3), null);
  g.gable(-w / 2 + 2, 2, 2, 10, 6, 2, true, m(c(0x3f4a4f), P.ROOF_TILE, s), m(c(0xa8735a), P.PLAIN, s));
  for (let i = 0; i < 2; i++) g.ground(-w / 2 + 2 + i * 10, 12, -w / 2 + 10 + i * 10, d - 2, m(c(0x3f8fa0), P.WATER, s), 0.3);
  g.box(4, 4, w / 2 - 1, 5, 0.4, 1.4, m(c(0x2e6f9a), P.METAL, s), m(c(0x2e6f9a), P.METAL, s));
  g.box(6, 5, 7.2, d, 0.4, 1.4, m(c(0x2e6f9a), P.METAL, s), m(c(0x2e6f9a), P.METAL, s));
};

const outfall: Gen = (g, b) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, CONC(s), 0.04);
  g.box(-w / 2 + 2, 2, 2, 9, 0, 4.5, m(c(0xbfb8aa), P.CONCRETE, s), m(c(0x7d7a74), P.ROOF_FLAT, s));
  g.box(4, 2, 5.6, d + 6, 0.2, 1.8, m(c(0x6d6a62), P.METAL, s), m(c(0x6d6a62), P.METAL, s));
  g.ground(-w / 2 + 2, 11, w / 2 - 6, d - 2, m(c(0x55704a), P.WATER, s), 0.25);
};

const treatment: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, CONC(s), 0.04);
  for (let i = 0; i < 3; i++) {
    const x = -w / 2 + 8 + i * 12;
    g.cylinder(x, d - 9, 5.2, 5.2, 0, 2.2, 18, m(c(0xbcb8ae), P.CONCRETE, s), m(c(0x4f7f78), P.WATER, s));
  }
  g.ground(-w / 2 + 2, 6, w / 2 - 14, 17, m(c(0x5f8a7a), P.WATER, s), 0.4);
  g.box(w / 2 - 12, 2, w / 2 - 2, 14, 0, 7, m(c(0xd0cbc0), P.OFFICE, s, 3.5, 2.6), m(c(0x7d7a74), P.ROOF_FLAT, s));
  trees(g, r, 4, -w / 2 + 1, 0.5, w / 2 - 1, 1.5, undefined, 0.8);
};

// ── Transit ─────────────────────────────────────────────────────────────────

const busDepot: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, ASPH(s), 0.04);
  // Garage hall at the back with tall bay doors facing the yard.
  const x0 = -w / 2 + 2, x1 = w / 2 - 2;
  const z0 = d - 17, z1 = d - 1.5;
  const wall = c(0xd9d5cc);
  g.box(x0, z0, x1, z1, 0, 7.5, m(wall, P.INDUSTRIAL, s, 7.5, 1.4), m(c(0x9a9c9c), P.ROOF_FLAT, s));
  rooftop(g, r, x0, z0, x1, z1, 7.5, s, 0.5);
  const bays = Math.max(3, Math.floor((x1 - x0 - 10) / 5.2));
  for (let i = 0; i < bays; i++) {
    const a = x0 + 9 + i * 5.2;
    g.wall(a + 4.2, z0 - 0.06, a, z0 - 0.06, 0.05, 5.2, m(c(0x2f6f9a), P.DOOR, s));
  }
  // Office with the operator's sign.
  g.box(x0, z0 - 7, x0 + 8, z0, 0, 6.8, m(c(0xe8e4dc), P.OFFICE, s, 3.4, 2.4), m(c(0x7d7a74), P.ROOF_FLAT, s));
  g.box(x0 + 8.02, z0 - 0.08, x1 - 1, z0 - 0.02, 5.8, 7.1, m(c(0x0f8b8d), P.SIGN, s, 1, 30), null);
  // Fuel island canopy.
  g.box(x1 - 10, 4, x1 - 2, 9, 4.6, 5.0, m(c(0xe6e6e2), P.PLAIN, s), m(c(0xe6e6e2), P.PLAIN, s));
  for (const px of [x1 - 9.4, x1 - 2.6]) g.box(px - 0.2, 6.3, px + 0.2, 6.7, 0, 4.6, m(c(0x9aa0a4), P.METAL, s), null);
  // Parking lanes painted on the yard and buses waiting for service.
  const lanes = Math.max(2, Math.floor((x1 - x0 - 14) / 4.2));
  for (let i = 0; i < lanes; i++) {
    const x = x0 + 3 + i * 4.2;
    g.ground(x - 0.08, 3, x + 0.08, z0 - 2, m(c(0xe6e4dc), P.PLAIN, s), 0.06);
    if (r.chance(0.7)) g.prop({ kind: 'car', x: x + 2.1, y: 0.05, z: (3 + z0 - 2) / 2, rot: Math.PI / 2, variant: VM.bus, color: r.pick([0x2f80ed, 0xe8453c, 0x27ae60, 0xf2994a, 0x9b51e0]) });
  }
  fence(g, -w / 2 + 0.2, 0.2, w / 2 - 0.2, d - 0.2, 2.0, c(0x6f7478), [false, true, true, true]);
};

/** Metro entrance: glass pavilion over the stairs, a lit "M" totem, a lift and vent grilles on a paved plaza. */
const metroStation: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  const brand = 0x1565c0;
  g.ground(-w / 2, 0, w / 2, d, PAVE(s), 0.04);
  const steel = m(c(0x5c6369), P.METAL, s);
  const white = m(c(0xeef0f0), P.PLAIN, s);
  // Pavilion: glass on three sides, open towards the street where the stairs go down.
  const px0 = -6.5, px1 = 6.5, pz0 = 5, pz1 = 15;
  g.box(px0, pz0, px1, pz1, 0.04, 3.6, m(c(0x6d8796), P.GLASS_PLAIN, s), null, { sides: [false, true, true, true] });
  for (const x of [px0, px1]) for (const z of [pz0, pz1]) g.box(x - 0.15, z - 0.15, x + 0.15, z + 0.15, 0, 3.6, steel, null);
  // Canopy: a thin roof wrapped in the operator's colour, with a lit name band over the stairs.
  g.box(px0 - 1.2, pz0 - 3.4, px1 + 1.2, pz1 + 0.8, 3.6, 3.75, white, null);
  g.box(px0 - 1.25, pz0 - 3.45, px1 + 1.25, pz1 + 0.85, 3.75, 4.15, m(c(brand), P.PLAIN, s), m(c(0x6f767c), P.ROOF_FLAT, s));
  g.box(px0 + 1, pz0 - 3.5, px1 - 1, pz0 - 3.46, 3.78, 4.12, m(c(0xf4f6f8), P.SIGN, s, 1, px1 - px0 - 2), null);
  // Stairwell: a dark opening with steps and railings.
  g.ground(-3.2, 0.8, 3.2, pz0 + 6, m(c(0x24272b), P.PLAIN, s), 0.05);
  for (let i = 0; i < 9; i++) g.ground(-3, 1.2 + i * 1.15, 3, 1.2 + i * 1.15 + 0.12, m(c(0x8a8f94), P.PLAIN, s), 0.06);
  for (const x of [-3.3, 3.3]) g.box(x - 0.06, 0.8, x + 0.06, pz0 + 6, 0, 1.05, steel, steel);
  // Totem with the operator's mark (lit at night).
  const tx = w / 2 - 4, tz = 2.2;
  g.box(tx - 0.2, tz - 0.2, tx + 0.2, tz + 0.2, 0, 5.2, steel, null);
  g.box(tx - 0.9, tz - 0.25, tx + 0.9, tz + 0.25, 5.2, 7.0, m(c(brand), P.SIGN, s, 1, 1.8), m(c(brand), P.PLAIN, s));
  // A white pixel 'M' on both faces.
  const glyph = ['X...X', 'XX.XX', 'X.X.X', 'X...X', 'X...X'];
  const px = 0.26;
  const ink = m(c(0xffffff), P.SIGN, s, 1, 0.3);
  glyph.forEach((rowStr, j) => {
    for (let i = 0; i < 5; i++) {
      if (rowStr[i] !== 'X') continue;
      const x0 = tx - 0.65 + i * px, y1 = 6.75 - j * px;
      g.box(x0, tz - 0.31, x0 + px, tz - 0.25, y1 - px, y1, ink, ink);
      g.box(x0, tz + 0.25, x0 + px, tz + 0.31, y1 - px, y1, ink, ink);
    }
  });
  // Lift to the platforms.
  g.box(-w / 2 + 3, 7, -w / 2 + 5.4, 9.4, 0.04, 3.4, m(c(0x6d8796), P.GLASS_PLAIN, s), white);
  // Ventilation grilles and a second, smaller exit at the back.
  for (let i = 0; i < 2; i++) {
    const x0 = -w / 2 + 2 + i * 5;
    g.box(x0, d - 7, x0 + 4, d - 3, 0, 0.5, CONC(s), m(c(0x2b2f33), P.PLAIN, s));
    for (let k = 0; k < 6; k++) g.box(x0 + 0.3 + k * 0.66, d - 6.8, x0 + 0.42 + k * 0.66, d - 3.2, 0.5, 0.56, m(c(0x8d9399), P.METAL, s), m(c(0x8d9399), P.METAL, s));
  }
  g.box(w / 2 - 9, d - 8, w / 2 - 3, d - 3, 0.04, 2.9, m(c(0x6d8796), P.GLASS_PLAIN, s), m(c(0x8f9498), P.ROOF_FLAT, s), { sides: [false, true, true, true] });
  // Benches and trees around the plaza.
  for (const x of [-10, 9]) g.box(x - 1, 9, x + 1, 9.5, 0.4, 0.5, m(c(0x9a7b5a), P.PLAIN, s), m(c(0x9a7b5a), P.PLAIN, s));
  trees(g, r, 4, -w / 2 + 2, 11, w / 2 - 2, d - 10, [px0, pz0, px1, pz1], 0.8);
  bushes(g, r, 3, -w / 2 + 1.5, -8, 1.5);
};

/** Regional airport: runway with markings and lights, taxiway, apron, terminal, tower and hangar. */
const airport: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, m(c(0x6a8a44), P.GRASS, s), 0.04);
  const tarmac = m(c(0x3d3f42), P.PLAIN, s);
  const white = m(c(0xeeeeea), P.PLAIN, s);
  const yellow = m(c(0xe0b030), P.PLAIN, s);
  // Runway along the far side.
  const rz0 = 64, rz1 = 88, rx0 = -142, rx1 = 142, rmz = (rz0 + rz1) / 2;
  g.ground(rx0, rz0, rx1, rz1, tarmac, 0.06);
  g.ground(rx0 + 2, rz0 + 0.6, rx1 - 2, rz0 + 0.9, white, 0.08);
  g.ground(rx0 + 2, rz1 - 0.9, rx1 - 2, rz1 - 0.6, white, 0.08);
  for (let x = rx0 + 26; x < rx1 - 26; x += 14) g.ground(x, rmz - 0.3, x + 7, rmz + 0.3, white, 0.08);
  for (const end of [-1, 1]) {
    const x0 = end < 0 ? rx0 + 3 : rx1 - 12;
    for (let k = 0; k < 8; k++) {
      const z = rz0 + 2 + k * 2.7 + (k >= 4 ? 1.4 : 0);
      g.ground(x0, z, x0 + 9, z + 1.4, white, 0.08);
    }
    const tx = end < 0 ? rx0 + 32 : rx1 - 40;
    for (const z of [rz0 + 4, rz1 - 6]) g.ground(tx, z, tx + 8, z + 2, white, 0.08);
  }
  // Runway edge lights (white) and threshold lights (green) glow at night.
  const lampW = m(c(0xfff3d6), P.SIGN, s, 1, 0.4);
  const lampG = m(c(0x5cff8a), P.SIGN, s, 1, 0.4);
  for (let x = rx0 + 4; x <= rx1 - 4; x += 18) for (const z of [rz0 - 0.8, rz1 + 0.8]) g.box(x - 0.2, z - 0.2, x + 0.2, z + 0.2, 0, 0.45, lampW, lampW);
  for (const x of [rx0 - 0.8, rx1 + 0.8]) for (let z = rz0 + 2; z < rz1 - 1; z += 4) g.box(x - 0.2, z - 0.2, x + 0.2, z + 0.2, 0, 0.45, lampG, lampG);
  // Taxiway with links to both runway ends.
  g.ground(-120, 46, 110, 54, tarmac, 0.06);
  g.ground(-117, 54, -107, rz0, tarmac, 0.06);
  g.ground(96, 54, 106, rz0, tarmac, 0.06);
  g.ground(-118, 49.8, 108, 50.2, yellow, 0.08);
  // Apron with stand markings.
  g.ground(-12, 16, 76, 46, m(c(0x8f8c86), P.CONCRETE, s), 0.07);
  for (const x of [12, 44]) {
    g.ground(x - 0.2, 18, x + 0.2, 46, yellow, 0.09);
    g.ground(x - 6, 18, x + 6, 18.4, yellow, 0.09);
  }
  // Terminal: glass hall under a deep roof, with a lit name band.
  const tx0 = -78, tx1 = -12, tz0 = 6, tz1 = 34;
  g.box(tx0, tz0, tx1, tz1, 0, 9, m(c(0x6d8796), P.GLASS, s, 4.5, 3.2), null);
  g.box(tx0 - 2, tz0 - 3, tx1 + 2, tz1 + 2, 9, 10, m(c(0xe8e8e4), P.PLAIN, s), m(c(0x8f9498), P.ROOF_FLAT, s));
  g.box(tx0 + 6, tz0 - 3.05, tx1 - 6, tz0 - 2.95, 9.1, 9.9, m(c(0x1f4fa8), P.SIGN, s, 1, tx1 - tx0 - 12), null);
  rooftop(g, r, tx0 + 4, tz0 + 4, tx1 - 4, tz1 - 4, 10, s, 0.6);
  // Jet bridges to the stands.
  for (const [x, len] of [[12, 22], [44, 54]] as [number, number][]) {
    const z = 31;
    g.box(tx1, z - 1.3, tx1 + len - 8, z + 1.3, 3.2, 5.6, m(c(0xd8d8d4), P.INDUSTRIAL, s, 2.4, 1.2), m(c(0xc8c8c4), P.PLAIN, s));
    g.box(tx1 + len - 9, z - 0.3, tx1 + len - 8.4, z + 0.3, 0, 3.2, m(c(0x6f7478), P.METAL, s), null);
    void x;
  }
  // Control tower.
  const cx = 92, cz = 20;
  g.cylinder(cx, cz, 2.6, 2.2, 0, 26, 14, m(c(0xe4e2dc), P.CONCRETE, s), null);
  g.cylinder(cx, cz, 3.2, 4.4, 26, 27.2, 14, m(c(0xe4e2dc), P.PLAIN, s), null);
  g.cylinder(cx, cz, 4.4, 4.4, 27.2, 30.6, 14, m(c(0x5b7a8a), P.GLASS_PLAIN, s), null);
  g.cylinder(cx, cz, 4.8, 4.8, 30.6, 31.3, 14, m(c(0x8f9498), P.METAL, s), m(c(0x8f9498), P.ROOF_FLAT, s));
  g.box(cx - 0.1, cz - 0.1, cx + 0.1, cz + 0.1, 31.3, 36, m(c(0xb0b4b8), P.METAL, s), null);
  g.box(cx - 0.2, cz - 0.2, cx + 0.2, cz + 0.2, 36, 36.4, m(c(0xff4433), P.SIGN, s, 1, 0.4), null);
  // Maintenance hangar facing the taxiway.
  const hx0 = 108, hx1 = 148, hz0 = 6, hz1 = 34;
  g.box(hx0, hz0, hx1, hz1, 0, 11, m(c(0xb7bcc0), P.INDUSTRIAL, s, 11, 2.2), null);
  g.gable(hx0, hz0, hx1, hz1, 11, 4, true, m(c(0x8d9399), P.ROOF_FLAT, s), m(c(0xb7bcc0), P.PLAIN, s), 0.3);
  g.wall(hx1 - 3, hz1 + 0.05, hx0 + 3, hz1 + 0.05, 0.05, 9.5, m(c(0x5f666c), P.DOOR, s));
  g.ground(hx0 - 2, hz1, hx1, 46, m(c(0x8f8c86), P.CONCRETE, s), 0.07);
  // Car park and a windsock.
  parking(g, r, -148, 2, -84, 30, 0.6, s);
  g.box(140, 92, 140.15, 92.15, 0, 6, m(c(0xb0b4b8), P.METAL, s), null);
  g.box(140.15, 91.8, 142.6, 92.35, 5.2, 5.8, m(c(0xff7a1a), P.PLAIN, s), m(c(0xff7a1a), P.PLAIN, s));
  fence(g, -w / 2 + 0.2, 0.2, w / 2 - 0.2, d - 0.2, 1.6, c(0x5b6166), [false, true, true, true]);
};

/** Hotel: a slab with balconies over a glass lobby, a lit entrance canopy, flags and (when grand) a rooftop pool. */
const hotel: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  const brand = r.pick([0x1f4fa8, 0x8e1b1b, 0x0e7c66, 0x2c3e50, 0xb07d2b]);
  g.ground(-w / 2, 0, w / 2, d, PAVE(s), 0.04);
  // Drop-off loop in front.
  g.ground(-w / 2 + 3, 1.5, w / 2 - 3, 8.5, m(c(0x4a4b4e), P.PLAIN, s), 0.05);
  const x0 = -w / 2 + 3, x1 = w / 2 - 3, z0 = 11, z1 = d - 5;
  const fh = 3.2;
  const top = 4.6 + (b.floors - 1) * fh;
  const facade = c(r.pick([0xe9e4d8, 0xd8d2c6, 0xc9c3b8, 0xeeeeea, 0xb9b2a4]));
  // Lobby, then the guest-room slab.
  g.box(x0 - 1, z0 - 1, x1 + 1, z1, 0, 4.6, m(c(0x55707e), P.GLASS, s, 4.6, 3), m(c(0x8a8780), P.ROOF_FLAT, s));
  g.box(x0, z0 + 1, x1, z1, 4.6, top, m(facade, P.RES, s, fh, 3.6), m(c(0x7d7a74), P.ROOF_FLAT, s));
  // Balconies on the street face, one slab per floor.
  for (let k = 0; k < b.floors - 1; k++) {
    const y = 4.6 + k * fh;
    g.box(x0 + 0.6, z0 + 0.1, x1 - 0.6, z0 + 1, y, y + 0.16, m(c(0xd9d6cf), P.PLAIN, s), m(c(0xd9d6cf), P.PLAIN, s));
    g.box(x0 + 0.6, z0 + 0.05, x1 - 0.6, z0 + 0.12, y + 0.16, y + 1.1, m(c(0x8fa9b5), P.GLASS_PLAIN, s), null);
  }
  // Name band on the crown, lit at night.
  g.box(-w / 4, z0 + 0.9, w / 4, z0 + 1.05, top - 1.3, top - 0.3, m(c(brand), P.SIGN, s, 1, w / 2), null);
  // Entrance canopy on columns, with flags.
  g.box(-6, 3, 6, z0 - 1, 3.8, 4.2, m(c(brand), P.PLAIN, s), m(c(0xeeeeea), P.PLAIN, s));
  for (const x of [-5.6, 5.6]) g.box(x - 0.15, 3.2, x + 0.15, 3.5, 0, 3.8, m(c(0xd8d8d4), P.METAL, s), null);
  for (let i = 0; i < 3; i++) {
    const x = w / 2 - 4 - i * 1.6;
    g.box(x - 0.05, 1.2, x + 0.05, 1.3, 0, 6.5, m(c(0xd8d8d4), P.METAL, s), null);
    g.box(x + 0.05, 1.22, x + 1.3, 1.28, 5.6, 6.4, m(c(r.pick([0xc0392b, 0x2e86c1, 0x27ae60, 0xf1c40f, brand])), P.PLAIN, s), null);
  }
  // Rooftop: plant, or a pool deck for grand hotels.
  if (b.level >= 3) {
    g.box(x0 + 2, z0 + 3, x1 - 2, z1 - 2, top, top + 0.25, m(c(0xb9a888), P.PAVING, s), m(c(0xb9a888), P.PAVING, s));
    g.ground(x0 + 4, z0 + 5, (x0 + x1) / 2, z1 - 4, m(c(0x3aa0c8), P.WATER, s), top + 0.32);
    for (let i = 0; i < 4; i++) g.box((x0 + x1) / 2 + 1.5 + i * 1.6, z0 + 5, (x0 + x1) / 2 + 2.3 + i * 1.6, z0 + 7, top + 0.25, top + 0.55, m(c(0xf4f4f0), P.PLAIN, s), m(c(0xf4f4f0), P.PLAIN, s));
    for (const x of [x0 + 1.2, x1 - 1.2]) g.box(x - 0.05, z0 + 3, x + 0.05, z1 - 2, top, top + 1.1, m(c(0x8fa9b5), P.GLASS_PLAIN, s), null);
  } else {
    rooftop(g, r, x0 + 1, z0 + 2, x1 - 1, z1 - 1, top, s, 0.7);
  }
  bushes(g, r, 4, -w / 2 + 1.5, -6.5, 9.5);
  bushes(g, r, 4, 6.5, w / 2 - 1.5, 9.5);
};

// ── More zoned variety ──────────────────────────────────────────────────────

/** Contemporary house: two offset flat-roofed volumes, big glazing, often a pool. */
const modernHouse: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, GRASS(s), 0.03);
  const white = c(r.pick([0xf1efe9, 0xe8e4dc, 0xdedad2]));
  const dark = c(r.pick([0x3b3d40, 0x4a4038, 0x5b4b3d]));
  const setback = r.range(6, 8);
  const bw = Math.min(w - 4, r.range(11, 14));
  const x0 = -bw / 2, x1 = bw / 2;
  const z0 = setback, z1 = Math.min(d - 10, setback + r.range(9, 11));
  g.box(x0 - 0.2, z0 - 0.2, x1 + 0.2, z1 + 0.2, 0, 0.35, CONC(s), null);
  // Ground floor with floor-to-ceiling glass, upper volume cantilevered in timber or render.
  g.box(x0, z0, x1, z1, 0.35, 3.4, m(c(0x55707e), P.GLASS, s, 3, 2.4), m(c(0x8a8780), P.ROOF_FLAT, s));
  const shift = r.range(-2, 2);
  const upper = r.chance(0.5) ? m(c(0x9a6b45), P.INDUSTRIAL, s, 3, 0.4) : m(white, P.RES, s, 3, 3.6);
  g.box(x0 + shift - 1, z0 - 1.5, x1 + shift - 2, z1 - 1, 3.4, 6.5, upper, m(dark, P.ROOF_FLAT, s));
  g.box(x0 + shift - 1.2, z0 - 1.7, x1 + shift - 1.8, z1 - 0.8, 6.5, 6.75, m(dark, P.PLAIN, s), m(dark, P.PLAIN, s));
  // Carport and car.
  const side = r.chance(0.5) ? 1 : -1;
  const cx0 = side > 0 ? x1 + 0.4 : x0 - 4.4;
  g.box(cx0, z0, cx0 + 4, z0 + 6, 2.6, 2.8, m(dark, P.PLAIN, s), m(dark, P.PLAIN, s));
  for (const px of [cx0 + 0.2, cx0 + 3.8]) g.box(px - 0.1, z0 + 5.7, px + 0.1, z0 + 5.9, 0, 2.6, m(c(0x8d9296), P.METAL, s), null);
  g.ground(cx0, 0, cx0 + 4, z0 + 6, CONC(s), 0.05);
  if (r.chance(0.7)) g.prop({ kind: 'car', x: cx0 + 2, y: 0.05, z: z0 + 2.8, rot: Math.PI / 2, variant: r.pick([VM.suv, VM.sedan]), color: r.pick(CAR_COLORS) });
  // Garden with a pool and a timber deck.
  if (d - z1 > 9) {
    const pw = Math.min(w * 0.4, 8), pd = 4;
    const pz = z1 + 3;
    g.ground(-pw / 2 - 1.5, pz - 1, pw / 2 + 1.5, pz + pd + 1, m(c(0x9a7b5a), P.PLAIN, s), 0.06);
    g.ground(-pw / 2, pz, pw / 2, pz + pd, m(c(0x3aa0c8), P.WATER, s), 0.09);
  }
  fence(g, -w / 2 + 0.2, z1 + 1, w / 2 - 0.2, d - 0.2, 1.6, c(0x5b5f63), [false, true, true, true]);
  trees(g, r, r.int(1, 3), -w / 2 + 1.5, z1 + 2, w / 2 - 1.5, d - 1.5, undefined, 0.85);
  bushes(g, r, 4, x0 + 0.5, x1 - 0.5, z0 - 0.8);
};

/** Fuel station: canopy over pumps, small shop and a tall price sign. */
const gasStation: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  const brand = r.pick([0x0e7c66, 0xc0392b, 0x1f4fa8, 0xe67e22]);
  g.ground(-w / 2, 0, w / 2, d, m(c(0x55575a), P.PAVING, s), 0.04);
  // Canopy on four columns.
  const cx0 = -w / 2 + 3, cx1 = Math.min(w / 2 - 3, cx0 + 16), cz0 = 4, cz1 = 13;
  g.box(cx0, cz0, cx1, cz1, 4.6, 5.4, m(c(brand), P.SIGN, s, 1, cx1 - cx0), m(c(0xf2f2f0), P.PLAIN, s));
  for (const x of [cx0 + 2, cx1 - 2]) for (const z of [cz0 + 2, cz1 - 2]) g.box(x - 0.25, z - 0.25, x + 0.25, z + 0.25, 0, 4.6, m(c(0xd8d8d4), P.PLAIN, s), null);
  // Pump islands.
  for (let i = 0; i < 2; i++) {
    const z = cz0 + 2.5 + i * 4;
    g.box(cx0 + 3, z - 0.6, cx1 - 3, z + 0.6, 0, 0.2, CONC(s), CONC(s));
    for (const x of [cx0 + 5, (cx0 + cx1) / 2, cx1 - 5]) g.box(x - 0.4, z - 0.3, x + 0.4, z + 0.3, 0.2, 1.8, m(c(0xf2f2f0), P.PLAIN, s), m(c(brand), P.PLAIN, s));
  }
  for (let i = 0; i < 2; i++) if (r.chance(0.6)) g.prop({ kind: 'car', x: cx0 + 6 + i * 4, y: 0.05, z: cz0 + 4.5, rot: 0, variant: r.pick([VM.sedan, VM.hatchback, VM.suv, VM.van]), color: r.pick(CAR_COLORS) });
  // Shop at the back.
  const sx0 = -w / 2 + 3, sx1 = Math.min(w / 2 - 3, sx0 + 12), sz0 = d - 11, sz1 = d - 2;
  g.box(sx0, sz0, sx1, sz1, 0, 4.2, m(c(0xe8e4dc), P.STORE, s, 4.2, 3.4), m(c(0x7d7a74), P.ROOF_FLAT, s));
  sign(g, sx0 + 0.6, sx1 - 0.6, sz0, 3.3, 4.0, brand, s);
  // Price pylon by the road.
  const px = w / 2 - 2.5;
  g.box(px - 0.3, 1.2, px + 0.3, 1.8, 0, 5, m(c(0x8d9296), P.METAL, s), null);
  g.box(px - 1.2, 1.4, px + 1.2, 1.6, 5, 8, m(c(brand), P.SIGN, s, 1, 2.4), m(c(brand), P.PLAIN, s));
  bushes(g, r, 3, sx1 + 1, w / 2 - 1, d - 1.5);
};

/** Diner with a striped awning and a patio of umbrellas. */
const diner: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, PAVE(s), 0.04);
  const accent = pick(r, ACCENTS);
  const bw = Math.min(w - 6, 13), bd = Math.min(d - 9, 11);
  const x0 = -w / 2 + 1, x1 = x0 + bw, z0 = 6, z1 = z0 + bd;
  g.box(x0, z0, x1, z1, 0, 4.4, m(c(pick(r, RENDER)), P.STORE, s, 4.4, 3), m(c(0x7d7a74), P.ROOF_FLAT, s));
  g.box(x0 - 0.2, z0 - 0.2, x1 + 0.2, z1 + 0.2, 4.4, 5, m(c(accent), P.PLAIN, s), m(c(0x7d7a74), P.ROOF_FLAT, s));
  sign(g, x0 + 1, x1 - 1, z0, 3.4, 4.2, accent, s);
  g.box(x0 + 0.3, z0 - 1.8, x1 - 0.3, z0, 2.9, 3.05, m(c(accent), P.PLAIN, s), m(c(0xf2f2f0), P.PLAIN, s));
  // Patio with umbrellas.
  const px0 = x1 + 1, px1 = w / 2 - 1;
  if (px1 - px0 > 4) {
    g.ground(px0, 1, px1, z1, m(c(0xb9a58a), P.PAVING, s), 0.06);
    const n = Math.max(1, Math.floor((px1 - px0) / 4));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 2; j++) {
        const ux = px0 + 2 + i * 4, uz = 3 + j * 5;
        g.cylinder(ux, uz, 0.06, 0.06, 0, 2.3, 4, m(c(0xd8d8d4), P.METAL, s), null);
        g.lathe(ux, uz, [[1.6, 2.2], [0.01, 2.8]], 8, m(c(r.chance(0.5) ? accent : 0xf2f2f0), P.PLAIN, s));
        g.cylinder(ux, uz, 0.5, 0.5, 0.7, 0.78, 8, m(c(0xe8e4dc), P.PLAIN, s), m(c(0xe8e4dc), P.PLAIN, s));
      }
    }
  }
  parking(g, r, -w / 2 + 1, z1 + 1, w / 2 - 1, d - 0.5, 0.6, s);
};

/** Supermarket: long box with a glazed entrance, big sign and a car park. */
const supermarket: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, ASPH(s), 0.04);
  const brand = r.pick([0xc0392b, 0x27ae60, 0xe67e22, 0x1f4fa8]);
  const z0 = d - 26, z1 = d - 1.5, x0 = -w / 2 + 2, x1 = w / 2 - 2;
  g.box(x0, z0, x1, z1, 0, 8, m(c(pick(r, INDUSTRY)), P.INDUSTRIAL, s, 8, 2), m(c(0xa3a5a4), P.ROOF_FLAT, s));
  rooftop(g, r, x0, z0, x1, z1, 8, s, 0.6);
  const ex = r.range(x0 + 6, x1 - 16);
  g.wall(ex + 10, z0 - 0.05, ex, z0 - 0.05, 0, 5, m(c(0x2c3a44), P.GLASS_PLAIN, s));
  g.box(ex - 1, z0 - 3, ex + 11, z0, 5, 5.5, m(c(brand), P.PLAIN, s), m(c(0xd8d8d4), P.PLAIN, s));
  g.box(ex - 2, z0 - 0.1, ex + 12, z0, 6, 7.6, m(c(brand), P.SIGN, s, 1, 14), null);
  // Trolley shelter.
  g.box(x1 - 8, z0 - 6, x1 - 2, z0 - 3, 2.4, 2.6, m(c(0xd8d8d4), P.METAL, s), m(c(0xd8d8d4), P.METAL, s));
  parking(g, r, -w / 2 + 1, 1, w / 2 - 1, z0 - 7, 0.6, s);
};

/** Office campus: low glass pavilions around a landscaped court. */
const officeCampus: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, GRASS(s), 0.03);
  const glass = m(c(pick(r, GLASS)), P.GLASS, s, 3.8, 2.4);
  const roof = m(c(0x9a9c9c), P.ROOF_FLAT, s);
  const floors = Math.max(2, Math.min(4, b.floors));
  const h = floors * 3.8 + 0.4;
  const x0 = -w / 2 + 2, x1 = w / 2 - 2, z0 = 8, z1 = d - 3;
  // L-shaped pair of wings and a lower link.
  g.box(x0, z0, x0 + (x1 - x0) * 0.4, z1, 0, h, glass, roof);
  g.box(x0 + (x1 - x0) * 0.4, z1 - 11, x1, z1, 0, h - 3.8, glass, roof);
  rooftop(g, r, x0, z0, x0 + (x1 - x0) * 0.4, z1, h, s, 0.5);
  // Court with paths, trees and a sculpture.
  const cx = x0 + (x1 - x0) * 0.7, cz = (z0 + z1 - 11) / 2;
  g.ground(x0 + (x1 - x0) * 0.4, cz - 1, x1, cz + 1, PAVE(s), 0.06);
  g.cylinder(cx, cz, 3.2, 3.2, 0, 0.5, 18, m(c(0xb8b2a6), P.CONCRETE, s), m(c(0x3f8fb0), P.WATER, s));
  trees(g, r, 6, x0 + (x1 - x0) * 0.42, z0, x1 - 1, z1 - 12, [cx - 4, cz - 4, cx + 4, cz + 4], 0.9);
  parking(g, r, -w / 2 + 1, 0.5, w / 2 - 1, z0 - 1, 0.6, s);
};

/** Agricultural greenhouses: rows of glass houses with a packing shed. */
const greenhouse: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, m(c(0x8f8a80), P.DIRT, s), 0.04);
  const glassM = m(c(0xb8cfd6), P.GLASS, s, 2.4, 1.6);
  const rows = Math.max(2, Math.floor((w - 4) / 8.5));
  const z0 = 10, z1 = d - 2;
  for (let i = 0; i < rows; i++) {
    const x = -w / 2 + 2 + i * 8.5;
    g.box(x, z0, x + 8, z1, 0, 3, glassM, null);
    g.gable(x, z0, x + 8, z1, 3, 1.6, false, m(c(0xc8dce2), P.GLASS, s, 1.6, 1.6), glassM, 0.05);
  }
  g.box(-w / 2 + 2, 2, -w / 2 + 14, 8, 0, 5, m(c(pick(r, INDUSTRY)), P.INDUSTRIAL, s, 5, 1.4), m(c(0xa3a5a4), P.ROOF_FLAT, s));
  loadingDoors(g, -w / 2 + 3, -w / 2 + 13, 2, 2, s);
  trucks(g, r, 1, -w / 2 + 16, -w / 2 + 24, 4, 0);
  fence(g, -w / 2 + 0.2, 0.2, w / 2 - 0.2, d - 0.2, 1.8, c(0x6f7478), [false, true, true, true]);
};

// ── Landmarks ───────────────────────────────────────────────────────────────

function planters(g: GeoBuilder, s: number, pts: [number, number][]): void {
  for (const [x, z] of pts) {
    g.box(x - 1.3, z - 1.3, x + 1.3, z + 1.3, 0, 0.55, m(c(0x9a948a), P.CONCRETE, s), m(c(0x5f7a3c), P.GRASS, s));
    g.prop({ kind: 'tree', x, y: 0.55, z, rot: x * 1.7 + z, scale: 0.8, variant: 1 });
  }
}

const cityHall: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  const stone = c(0xe6dfcf), trim = c(0xcfc6b2), copper = c(0x6f9c8a);
  g.ground(-w / 2, 0, w / 2, d, m(c(0xc8c2b6), P.PAVING, s), 0.05);
  g.ground(-w / 2 + 2, 2, -9, 13, GRASS(s), 0.07);
  g.ground(9, 2, w / 2 - 2, 13, GRASS(s), 0.07);
  // Fountain in the forecourt.
  g.cylinder(0, 7.5, 3.6, 3.6, 0, 0.6, 20, m(c(0xb8b2a6), P.CONCRETE, s), m(c(0x3f8fb0), P.WATER, s));
  g.cylinder(0, 7.5, 0.5, 0.4, 0.6, 1.8, 8, m(c(0xb8b2a6), P.CONCRETE, s), null);
  g.prop({ kind: 'fountain', x: 0, y: 1.8, z: 7.5, rot: 0 });
  // Steps up to the portico.
  g.box(-14, 13.5, 14, 18, 0, 0.6, m(trim, P.CONCRETE, s), m(trim, P.PAVING, s));
  g.box(-13, 14.8, 13, 18, 0.6, 1.2, m(trim, P.CONCRETE, s), m(trim, P.PAVING, s));
  // Main block with a cornice.
  const z0 = 18, z1 = d - 4, h = 13;
  g.box(-w / 2 + 4, z0, w / 2 - 4, z1, 0, h, m(stone, P.RES, s, 4.3, 3.6), m(c(0x8a8780), P.ROOF_FLAT, s));
  g.box(-w / 2 + 3.6, z0 - 0.4, w / 2 - 3.6, z1 + 0.4, h, h + 0.8, m(trim, P.PLAIN, s), m(c(0x8a8780), P.ROOF_FLAT, s));
  // Portico: six columns, entablature and pediment facing the street.
  for (let i = 0; i < 6; i++) g.cylinder(-10 + i * 4, 15.8, 0.62, 0.52, 1.2, 11.4, 10, m(stone, P.PLAIN, s), null);
  g.box(-12, 14.6, 12, 18, 11.4, 12.6, m(trim, P.PLAIN, s), m(stone, P.PLAIN, s));
  g.gable(-12, 14.6, 12, 18, 12.6, 3.4, false, m(c(0x9c9384), P.ROOF_TILE, s), m(stone, P.PLAIN, s), 0.25);
  g.wall(2, z0 - 0.05, -2, z0 - 0.05, 1.2, 6.5, m(c(0x5a4030), P.DOOR, s));
  // Drum, copper dome and lantern.
  const dz = (z0 + z1) / 2;
  g.cylinder(0, dz, 7.5, 7.5, h + 0.8, h + 6, 24, m(stone, P.RES, s, 2.6, 2.4), null);
  g.cylinder(0, dz, 8.1, 8.1, h + 6, h + 6.6, 24, m(trim, P.PLAIN, s), null);
  g.lathe(0, dz, [[7.7, h + 6.6], [7.5, h + 8.6], [6.7, h + 10.6], [5.3, h + 12.4], [3.3, h + 13.7], [1.3, h + 14.3], [0.01, h + 14.4]], 24, m(copper, P.METAL, s));
  g.cylinder(0, dz, 1.2, 1.0, h + 14.2, h + 17, 8, m(stone, P.PLAIN, s), null);
  g.lathe(0, dz, [[1.4, h + 17], [0.8, h + 18], [0.01, h + 19.2]], 8, m(copper, P.METAL, s));
  // Flags.
  for (const x of [-16, 16]) {
    g.cylinder(x, 4, 0.12, 0.08, 0, 12, 6, m(c(0xb8bcc0), P.METAL, s), null);
    g.box(x + 0.1, 3.95, x + 2.6, 4.05, 10.2, 11.8, m(c(x < 0 ? 0x1f4fa8 : 0xc0392b), P.PLAIN, s), null);
  }
  planters(g, s, [[-w / 2 + 4, 2.5], [w / 2 - 4, 2.5], [-w / 2 + 4, 11], [w / 2 - 4, 11]]);
  trees(g, r, 6, -w / 2 + 1, d - 3, w / 2 - 1, d - 1, undefined, 0.8);
};

const museum: Gen = (g, b) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, m(c(0xd0cbc0), P.PAVING, s), 0.05);
  // Stone base, a second solid volume, and a glass gallery cantilevered over the plaza.
  g.box(-27, 16, 27, 48, 0, 9, m(c(0xdcd6ca), P.OFFICE, s, 9, 7), m(c(0x8a8780), P.ROOF_FLAT, s));
  // Corten-steel gallery tower with vertical ribs.
  g.box(-27, 30, -6, 48, 9, 24, m(c(0x8a5236), P.INDUSTRIAL, s, 15, 0.9), m(c(0x6f4a35), P.ROOF_FLAT, s));
  g.box(-27.2, 29.8, -5.8, 48.2, 24, 24.6, m(c(0x5e3a28), P.PLAIN, s), m(c(0x5e3a28), P.PLAIN, s));
  g.box(-16, 9, 29, 34, 9, 19, m(c(0x55707e), P.GLASS, s, 3.4, 2.2), m(c(0x9a9c9c), P.ROOF_FLAT, s));
  for (const x of [26, 17]) g.cylinder(x, 11.5, 0.5, 0.5, 0, 9, 8, m(c(0x8d9296), P.METAL, s), null);
  // Entrance with a slim canopy and a lit sign along the base.
  g.wall(5, 15.95, -5, 15.95, 0, 5, m(c(0x2c3a44), P.GLASS_PLAIN, s));
  g.box(-7, 11.5, 7, 16, 5.2, 5.6, m(c(0xe6e6e2), P.METAL, s), m(c(0xe6e6e2), P.METAL, s));
  g.box(-25, 15.9, -9, 16, 6.2, 7.4, m(c(0xd35400), P.SIGN, s, 1, 16), null);
  // Sculpture on the plaza.
  g.lathe(-18, 7, [[0.01, 0], [1.7, 0.6], [0.6, 3.4], [1.9, 5.8], [0.8, 7.5], [0.01, 7.8]], 12, m(c(0xc0392b), P.METAL, s));
  planters(g, s, [[-w / 2 + 3, 3], [w / 2 - 3, 3], [10, 3], [20, 3]]);
};

const cathedral: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  const stone = c(0xc4b79c), slate = c(0x4a5058);
  g.ground(-w / 2, 0, w / 2, d, GRASS(s), 0.04);
  g.ground(-9, 0, 9, 16, m(c(0xbcb4a4), P.PAVING, s), 0.06);
  // Nave and side aisles.
  g.box(-9, 18, 9, 60, 0, 17, m(stone, P.RES, s, 16.6, 4.2), null);
  g.gable(-9.4, 18, 9.4, 60, 17, 9, false, m(slate, P.ROOF_TILE, s), m(stone, P.PLAIN, s), 0.4);
  for (const [x0, x1] of [[-15, -9], [9, 15]]) g.box(x0, 22, x1, 56, 0, 9, m(stone, P.RES, s, 8.8, 4.2), m(slate, P.ROOF_TILE, s));
  // Transept and crossing spire.
  g.box(-18, 38, 18, 48, 0, 17, m(stone, P.RES, s, 16.6, 4.2), null);
  g.gable(-18.4, 38, 18.4, 48, 17, 9, true, m(slate, P.ROOF_TILE, s), m(stone, P.PLAIN, s), 0.4);
  g.box(-2.6, 40.4, 2.6, 45.6, 24, 30, m(stone, P.RES, s, 3, 2.6), null);
  g.lathe(0, 43, [[3.8, 30], [0.01, 41]], 4, m(slate, P.ROOF_TILE, s));
  // Apse.
  g.cylinder(0, 60, 9, 9, 0, 15, 14, m(stone, P.RES, s, 14.6, 4), null);
  g.lathe(0, 60, [[9.3, 15], [0.01, 22]], 14, m(slate, P.ROOF_TILE, s));
  // West front: twin towers with spires, rose window and portal.
  g.box(-5, 15.5, 5, 18, 0, 23, m(stone, P.PLAIN, s), null);
  g.gable(-5.2, 15.5, 5.2, 18, 23, 4, false, m(slate, P.ROOF_TILE, s), m(stone, P.PLAIN, s), 0.2);
  for (const x of [-9, 9]) {
    g.box(x - 4, 12, x + 4, 20, 0, 34, m(stone, P.RES, s, 11.3, 2.7), null);
    g.box(x - 4.4, 11.6, x + 4.4, 20.4, 34, 35, m(c(0xb8ac94), P.PLAIN, s), m(c(0xb8ac94), P.PLAIN, s));
    g.lathe(x, 16, [[5.4, 35], [4.2, 36.5], [0.01, 54]], 4, m(slate, P.ROOF_TILE, s));
  }
  g.box(-2.6, 15.35, 2.6, 15.5, 13, 18.2, m(c(0x3a5fa0), P.SIGN, s, 1, 5), null);
  g.wall(1.8, 15.45, -1.8, 15.45, 0, 6.5, m(c(0x5a4030), P.DOOR, s));
  trees(g, r, 10, -w / 2 + 1, 2, w / 2 - 1, d - 1, [-19, 10, 19, 70], 0.9);
};

const stadium: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  const cz = d / 2 + 4;
  g.ground(-w / 2, 0, w / 2, d, ASPH(s), 0.04);
  g.cylinder(0, cz, 58, 58, 0, 0.08, 40, GRASS(s), GRASS(s));
  // Outer facade and the seating bowl.
  g.cylinder(0, cz, 52, 52, 0, 21, 48, m(c(0xd8d8d4), P.INDUSTRIAL, s, 7, 3), null);
  // Two seating tiers with a concourse between them (rows read from the 3 m grid).
  g.lathe(0, cz, [[51.5, 20.5], [47, 9]], 48, m(c(0x24569a), P.CONCRETE, s, 1, 1));
  g.lathe(0, cz, [[47, 9], [45.6, 8.6]], 48, m(c(0xb8b8b2), P.PLAIN, s));
  g.lathe(0, cz, [[45.6, 8.6], [40.5, 1.4]], 48, m(c(0x2e6db4), P.CONCRETE, s, 1, 1));
  // Running track around the pitch.
  g.cylinder(0, cz, 40.5, 40.5, 0, 1.2, 48, m(c(0x8f8a80), P.CONCRETE, s), m(c(0xa04a32), P.DIRT, s));
  g.groundN(-31, cz - 20, 31, cz + 20, m(c(0x4f9a3a), P.FIELD, s), 1.26);
  // Roof canopy ring.
  g.lathe(0, cz, [[53, 22], [44, 25], [41, 24.6]], 48, m(c(0xf2f2f0), P.METAL, s));
  // Floodlight masts.
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const x = Math.cos(a) * 56, z = cz + Math.sin(a) * 56;
    g.cylinder(x, z, 0.7, 0.45, 0, 40, 8, m(c(0x9aa0a4), P.METAL, s), null);
    g.boxRot(x, z, 6, 1.2, a + Math.PI / 2, 40, 43, m(c(0xfff3d6), P.SIGN, s, 1, 6), m(c(0x9aa0a4), P.METAL, s));
  }
  // Main gate on the street side.
  g.box(-12, cz - 55, 12, cz - 50, 0, 8, m(c(0x2e6db4), P.SIGN, s, 1, 24), m(c(0x9a9c9c), P.ROOF_FLAT, s));
  parking(g, r, -w / 2 + 2, 2, -20, cz - 56, 0.7, s);
  parking(g, r, 20, 2, w / 2 - 2, cz - 56, 0.7, s);
};

const obsTower: Gen = (g, b) => {
  const { w, d } = b;
  const s = b.seed & 255;
  const cz = d / 2;
  const conc = c(0xdcd8d0);
  g.ground(-w / 2, 0, w / 2, d, GRASS(s), 0.04);
  g.ground(-3, 0, 3, cz - 14, m(c(0xc8c2b6), P.PAVING, s), 0.06);
  g.cylinder(0, cz, 18, 18, 0, 0.07, 32, m(c(0xc8c2b6), P.PAVING, s), m(c(0xc8c2b6), P.PAVING, s));
  // Entrance pavilion and the shaft.
  g.cylinder(0, cz, 13, 13, 0, 6, 24, m(c(0x55707e), P.GLASS, s, 3, 2.5), m(c(0x8a8780), P.ROOF_FLAT, s));
  g.cylinder(0, cz, 4.6, 3.2, 6, 158, 16, m(conc, P.CONCRETE, s, 4, 3), null);
  // Observation pod: concrete underside, glass restaurant band, white crown.
  g.lathe(0, cz, [[3.3, 156], [10, 161], [11.6, 165]], 24, m(conc, P.CONCRETE, s));
  g.lathe(0, cz, [[11.6, 165], [11.8, 168.5], [11.6, 172]], 24, m(c(0x4d6676), P.GLASS, s, 3.5, 1.8));
  g.lathe(0, cz, [[11.6, 172], [10, 175], [3.2, 177], [0.01, 177.2]], 24, m(c(0xf2f2f0), P.METAL, s));
  g.lathe(0, cz, [[2.9, 177], [5.6, 180], [5.6, 183], [0.01, 184]], 16, m(c(0xf2f2f0), P.METAL, s));
  // Antenna with red aircraft-warning lights.
  g.cylinder(0, cz, 0.9, 0.3, 184, 214, 8, m(c(0xc0392b), P.METAL, s), null);
  for (const y of [196, 213]) g.box(-0.5, cz - 0.5, 0.5, cz + 0.5, y, y + 0.8, m(c(0xff2a1a), P.SIGN, s, 1, 1), null);
  planters(g, s, [[-w / 2 + 4, 4], [w / 2 - 4, 4], [-w / 2 + 4, d - 4], [w / 2 - 4, d - 4]]);
};

// ── Expansion services and utilities ─────────────────────────────────────────

/** Police headquarters: a six-storey block with a rooftop helipad and a motor pool. */
const policeHQ: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, PAVE(s), 0.04);
  const x0 = -w / 2 + 3, x1 = w / 2 - 3, z0 = 8, z1 = Math.min(d - 12, z0 + 24);
  const h = 6 * 3.6 + 0.4;
  g.box(x0, z0, x1, z1, 0, h, m(c(0xcfccc4), P.OFFICE, s, 3.6, 3), m(c(0x7d7a74), P.ROOF_FLAT, s));
  // Darker glazed entrance wing and a blue band under the roof.
  g.box(-8, z0 - 4, 8, z0, 0, 7.6, m(c(0x3c5a78), P.GLASS, s, 3.8, 2.4), m(c(0x8f8c86), P.ROOF_FLAT, s));
  g.box(x0 - 0.05, z0 - 0.06, x1 + 0.05, z0, h - 1.6, h - 0.4, m(c(0x1f4fa8), P.SIGN, s, 1, x1 - x0), null);
  // Helipad: a pale square with a ring on the roof.
  const hx = (x0 + x1) / 2, hz = (z0 + z1) / 2;
  g.box(hx - 7, hz - 7, hx + 7, hz + 7, h, h + 0.3, m(c(0x55595c), P.CONCRETE, s), m(c(0x6b7074), P.CONCRETE, s));
  g.cylinder(hx, hz, 4.4, 4.4, h + 0.3, h + 0.34, 20, m(c(0xe8e6e0), P.PLAIN, s), m(c(0xe8e6e0), P.PLAIN, s));
  g.cylinder(hx, hz, 3.7, 3.7, h + 0.34, h + 0.38, 20, m(c(0x55595c), P.CONCRETE, s), m(c(0x55595c), P.CONCRETE, s));
  g.cylinder(x1 - 2, z1 - 2, 0.15, 0.08, h, h + 12, 4, m(c(0x999999), P.METAL, s), null);
  for (let i = 0; i < 6; i++) g.prop({ kind: 'car', x: x0 + 2 + i * 3, y: 0.05, z: 2.4, rot: Math.PI / 2, variant: VM.police, color: 0x1d2a44 });
  if (d - z1 > 6) parking(g, r, -w / 2 + 1, z1 + 1, w / 2 - 1, d - 0.5, 0.7, s);
};

/** Public library: a stone hall with a colonnade, broad steps and a reading garden. */
const library: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, GRASS(s), 0.03);
  g.ground(-w / 2 + 2, 0, w / 2 - 2, 9, m(c(0xc9c2b4), P.PAVING, s), 0.06);
  const x0 = -w / 2 + 3, x1 = w / 2 - 3, z0 = 11, z1 = Math.min(d - 4, z0 + 15);
  const stone = c(0xe0d8c6);
  g.box(x0, z0, x1, z1, 0, 1.2, m(c(0xcfc6b2), P.CONCRETE, s), m(c(0xcfc6b2), P.PAVING, s));
  g.box(x0 + 1, z0 + 1, x1 - 1, z1, 1.2, 10, m(stone, P.OFFICE, s, 4.4, 3.4), m(c(0x7d7a74), P.ROOF_FLAT, s));
  // Portico: steps, columns and a pediment facing the street.
  for (let i = 0; i < 3; i++) g.box(-8 - i * 0.6, z0 - 1.4 + i * 0.5, 8 + i * 0.6, z0 - 0.9 + i * 0.5, 0, 0.4 * (3 - i), m(c(0xd4ccbb), P.CONCRETE, s), m(c(0xd8d0bf), P.PAVING, s));
  g.box(-8, z0 - 3.4, 8, z0 + 1, 1.2, 1.4, m(c(0xd8d0bf), P.CONCRETE, s), m(c(0xd8d0bf), P.PAVING, s));
  for (let i = 0; i < 6; i++) g.cylinder(-6.5 + i * 2.6, z0 - 2.6, 0.45, 0.4, 1.4, 9, 10, m(stone, P.CONCRETE, s), null);
  g.box(-8.4, z0 - 3.6, 8.4, z0 + 1, 9, 10.2, m(stone, P.CONCRETE, s), m(stone, P.CONCRETE, s));
  g.gable(-8.4, z0 - 3.6, 8.4, z0 + 1, 10.2, 2.2, true, m(c(0x8d8a82), P.ROOF_FLAT, s), m(stone, P.CONCRETE, s), 0.1);
  g.box(-5, z0 - 3.66, 5, z0 - 3.6, 7.6, 8.6, m(c(0x2b4a6f), P.SIGN, s, 1, 10), null);
  trees(g, r, 4, -w / 2 + 1, z1 + 1, w / 2 - 1, d - 1, undefined, 0.8);
  planters(g, s, [[-w / 2 + 4, 4], [w / 2 - 4, 4]]);
};

/** Waste incinerator: a tall boiler hall, a slender stack and a tipping hall for garbage trucks. */
const incinerator: Gen = (g, b) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, CONC(s), 0.04);
  const metal = m(c(0x7f8a8e), P.INDUSTRIAL, s, 10, 1.6);
  g.box(-w / 2 + 3, 10, 4, d - 4, 0, 24, metal, m(c(0x6a6f72), P.ROOF_FLAT, s));
  g.box(4, 14, w / 2 - 3, d - 6, 0, 12, m(c(0xb9b6ae), P.INDUSTRIAL, s, 12, 1.4), m(c(0x8f8c86), P.ROOF_FLAT, s));
  // Colour band and the tipping-hall doors.
  g.box(-w / 2 + 3 - 0.05, 9.94, 4.05, 10, 18, 20, m(c(0x2f8f6f), P.SIGN, s, 1, 20), null);
  for (let i = 0; i < 3; i++) g.wall(8 + i * 6 + 4.5, 13.94, 8 + i * 6, 13.94, 0.05, 6, m(c(0x56606a), P.DOOR, s));
  g.cylinder(-w / 2 + 9, d - 9, 2.6, 1.8, 0, 62, 14, m(c(0xd0ccc4), P.CONCRETE, s), m(c(0x2a2a2a), P.PLAIN, s));
  g.cylinder(-w / 2 + 9, d - 9, 1.85, 1.85, 56, 59, 14, m(c(0x2f8f6f), P.PLAIN, s), null);
  g.prop({ kind: 'steam', x: -w / 2 + 9, y: 62, z: d - 9, rot: 0, scale: 1.6 });
  for (let i = 0; i < 2; i++) g.prop({ kind: 'car', x: 9 + i * 7, y: 0.05, z: 8, rot: Math.PI / 2, variant: VM.garbage, color: 0x2f8f6f });
  fence(g, -w / 2 + 0.2, 0.2, w / 2 - 0.2, d - 0.2, 2.2, c(0x6f7478), [false, true, true, true]);
};

/** Combined-cycle gas plant: turbine halls, twin exhaust stacks and gas holders. */
const gasPlant: Gen = (g, b) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, CONC(s), 0.04);
  const hall = m(c(0xc8c4ba), P.INDUSTRIAL, s, 14, 1.5);
  g.box(-w / 2 + 3, 6, 8, 26, 0, 17, hall, m(c(0x8f8c86), P.ROOF_FLAT, s));
  g.box(-w / 2 + 3, 26.5, 8, 30, 0, 9, m(c(0x8a9399), P.METAL, s), m(c(0x6a6f72), P.ROOF_FLAT, s));
  g.box(-w / 2 + 3 - 0.05, 5.94, 8.05, 6, 13, 15, m(c(0xe67e22), P.SIGN, s, 1, 30), null);
  for (const x of [-w / 2 + 9, -w / 2 + 19]) {
    g.cylinder(x, 33, 2.2, 2, 0, 46, 14, m(c(0xd8d4cc), P.CONCRETE, s), m(c(0x2a2a2a), P.PLAIN, s));
    g.cylinder(x, 33, 2.05, 2.05, 40, 42, 14, m(c(0xb3261e), P.PLAIN, s), null);
    g.prop({ kind: 'steam', x, y: 46, z: 33, rot: 0, scale: 1.4 });
  }
  // Spherical gas holders and pipework.
  for (const [x, z] of [[w / 2 - 9, 12], [w / 2 - 9, 26]] as [number, number][]) {
    g.lathe(x, z, [[0.01, 0.2], [4.2, 1], [6, 5.2], [6, 7.4], [4.2, 11.4], [0.01, 12.4]], 16, m(c(0xe9e7e1), P.METAL, s, 3, 3));
    for (const dx of [-4.5, 4.5]) g.cylinder(x + dx, z, 0.3, 0.3, 0, 5, 6, m(c(0x8d9296), P.METAL, s), null);
  }
  g.box(8, 18.4, w / 2 - 14, 19.6, 3, 4.2, m(c(0xe0a020), P.METAL, s), m(c(0xe0a020), P.METAL, s));
  fence(g, -w / 2 + 0.2, 0.2, w / 2 - 0.2, d - 0.2, 2.4, c(0x6f7478), [true, true, true, true]);
};

/** Nuclear plant: two huge hyperbolic cooling towers, a domed containment building and the turbine hall. */
const nuclear: Gen = (g, b) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, CONC(s), 0.04);
  const prof: [number, number][] = [[24, 0], [21, 14], [16.5, 42], [16, 54], [17.6, 68]];
  for (const [x, z] of [[-w / 2 + 28, d - 28], [w / 2 - 28, d - 28]] as [number, number][]) {
    g.lathe(x, z, prof, 28, m(c(0xd6d4ce), P.CONCRETE, s));
    g.prop({ kind: 'steam', x, y: 68, z, rot: 0, scale: 4.2 });
  }
  // Containment dome.
  const cx = -14, cz = 30;
  g.cylinder(cx, cz, 13, 13, 0, 20, 24, m(c(0xe4e2dc), P.CONCRETE, s), null);
  g.lathe(cx, cz, [[13, 20], [11.6, 26], [7.4, 30.4], [0.01, 32.2]], 24, m(c(0xe4e2dc), P.CONCRETE, s));
  g.cylinder(cx, cz, 13.05, 13.05, 16, 17.4, 24, m(c(0xb3261e), P.PLAIN, s), null);
  // Turbine hall, control block and switchyard.
  g.box(4, 16, w / 2 - 6, 42, 0, 18, m(c(0xc8c4ba), P.INDUSTRIAL, s, 18, 1.5), m(c(0x8f8c86), P.ROOF_FLAT, s));
  g.box(4, 6, 24, 16, 0, 10, m(c(0xd6d3cc), P.OFFICE, s, 3.6, 3), m(c(0x7d7a74), P.ROOF_FLAT, s));
  g.box(4 - 0.05, 15.94, w / 2 - 6, 16, 14, 16, m(c(0x2b6cb0), P.SIGN, s, 1, 40), null);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) g.box(28 + i * 6, 4 + j * 5, 29 + i * 6, 5 + j * 5, 0, 7, m(c(0x9aa0a4), P.METAL, s), null);
  fence(g, -w / 2 + 0.2, 0.2, w / 2 - 0.2, d - 0.2, 2.6, c(0x6f7478), [true, true, true, true]);
};

/** Water purification: settling basins, filter beds and a pump house beside the shore. */
const purification: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, CONC(s), 0.04);
  for (let i = 0; i < 4; i++) {
    const x = -w / 2 + 9 + i * 13;
    if (x > w / 2 - 8) break;
    g.cylinder(x, d - 11, 5.8, 5.8, 0, 2.4, 20, m(c(0xbcb8ae), P.CONCRETE, s), m(c(0x3f8fb0), P.WATER, s));
  }
  for (let i = 0; i < 3; i++) {
    const z = 16 + i * 7;
    if (z + 5 > d - 18) break;
    g.box(-w / 2 + 3, z, w / 2 - 16, z + 5, 0, 1.6, m(c(0xbcb8ae), P.CONCRETE, s), m(c(0x5aa6c4), P.WATER, s));
  }
  g.box(w / 2 - 14, 4, w / 2 - 2, 18, 0, 8, m(c(0xd8d4ca), P.OFFICE, s, 4, 2.8), m(c(0x7d7a74), P.ROOF_FLAT, s));
  g.box(w / 2 - 14.05, 3.94, w / 2 - 2, 4, 6, 7.2, m(c(0x1e7fb8), P.SIGN, s, 1, 12), null);
  g.box(-w / 2 + 3, 8, w / 2 - 16, 9.4, 0.4, 1.6, m(c(0x2e6f9a), P.METAL, s), m(c(0x2e6f9a), P.METAL, s));
  trees(g, r, 4, -w / 2 + 1, 0.5, w / 2 - 15, 3, undefined, 0.8);
};

const GENERATORS: Record<StyleId, Gen> = {
  house, townhouse, lowrise, midrise, tower, shop, stripmall, mixeduse, bigbox, office, officeTower,
  workshop, warehouse, factory, depot, police, fire, clinic, hospital, school, highschool, university, cargoPort, landfill,
  recycling, parkSmall, plaza, parkTown, parkLarge, wind, coal, solar, waterTower, pump, outfall, treatment,
  sportsField, communityGarden, sportsCourts, botanicalGarden,
  hotel,
  busDepot, metroStation, airport, cityHall, museum, cathedral, stadium, obsTower,
  modernHouse, gasStation, diner, supermarket, officeCampus, greenhouse,
  policeHQ, library, incinerator, gasPlant, nuclear, purification,
};

/** Generates world-space geometry for a building lot. */
export function generateBuilding(input: GenInput, cx: number, cz: number, angle: number, baseY: number): BuiltGeometry {
  const r = new Rng(input.seed);
  const g = new GeoBuilder(input.w, input.d, r);
  (GENERATORS[input.style] ?? house)(g, input, r);
  return g.build(cx, cz, angle, input.d / 2, baseY);
}
