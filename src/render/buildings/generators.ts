import { Rng } from '../../core/rng';
export type { GenInput } from './lot';
import { VM } from '../../sim/traffic/Vehicles';
import { type BuiltGeometry, GeoBuilder, type Mat, P, shade } from './BuildingKit';
import type { StyleId } from '../../sim/buildings/Archetypes';
import { ACCENTS, ASPH, CAR_COLORS, CONC, GLASS, type Gen, type GenInput, GRASS, INDUSTRY, PAVE, RENDER, bushes, c, fence, m, parking, pick, rooftop, trees } from './lot';
import { archForStyle } from '../../sim/research/Architecture';
import { buildArch } from './procedural';
import { house, lowrise, midrise, tower, townhouse } from './residential';
import { bigbox, mixeduse, office, officeTower, shop, stripmall } from './commercial';
import { PAL, balcony, canopy, cornice, outline, parapet, piers, roofscape } from './architecture';

// ── Residential ─────────────────────────────────────────────────────────────


// ── Commercial ──────────────────────────────────────────────────────────────

function sign(g: GeoBuilder, x0: number, x1: number, z: number, y0: number, y1: number, color: number, seed: number): void {
  g.wall(x1, z - 0.06, x0, z - 0.06, y0, y1, { color: c(color), pattern: P.SIGN, seed, bay: x1 - x0 });
}

// ── Office ──────────────────────────────────────────────────────────────────

// ── Industrial ──────────────────────────────────────────────────────────────

function loadingDoors(g: GeoBuilder, x0: number, x1: number, z: number, n: number, seed: number): void {
  const step = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const a = x0 + i * step + step * 0.2;
    g.box(a - 0.2, z - 0.12, a + step * 0.6 + 0.2, z, 0, 4.5, m(c(0x3d4146), P.TRIM, seed), m(c(0x3d4146), P.TRIM, seed), { sides: [true, true, false, true] });
    g.wall(a + step * 0.6, z - 0.13, a, z - 0.13, 0.1, 4.2, { color: c(seed % 3 === 0 ? 0x5d6a74 : seed % 3 === 1 ? 0x8a8f93 : 0x6e5a44), pattern: P.DOOR, seed });
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
  g.box(x0, z0, x1, z1, 0, h, m(col, P.INDUSTRIAL, s, 10, 1.2), m(c(0x85827c), P.ROOF_FLAT, s));
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

/**
 * A civic building: a stone plinth, a body with punched windows, a cornice,
 * and a central entrance bay that rises above the parapet, with a canopy and a
 * name band in the service's colour. Returns the main block's footprint and height.
 */
function civic(g: GeoBuilder, r: Rng, b: GenInput, wallHex: number, accent: number, floors: number, frontDepth: number, pattern: number = P.STONE): [number, number, number, number, number] {
  const { w, d } = b;
  const s = b.seed & 255;
  const bw = w - 6, bd = Math.min(d - frontDepth - 4, 18);
  const x0 = -bw / 2, x1 = bw / 2, z0 = frontDepth, z1 = z0 + bd;
  const fh = 3.6;
  const h = floors * fh + 0.4;
  const wall: Mat = { ...m(c(wallHex), pattern, s, fh, 3.2), oy: 0.4 };
  const trim = m(c(0xe8e3d8), P.TRIM, s);
  g.box(x0, z0, x1, z1, 0, 0.4, m(c(0x9d968a), P.STONE, s, 30, 3), null);
  g.box(x0, z0, x1, z1, 0.4, h, wall, null);
  outline(g, x0, z0, x1, z1, 0.3, 0.5, 0.08, trim);
  outline(g, x0, z0, x1, z1, fh + 0.3, fh + 0.5, 0.1, trim);
  g.flat(x0, z0, x1, z1, h, m(c(r.pick(PAL.membrane)), P.ROOF_FLAT, s));
  parapet(g, x0, z0, x1, z1, h, 0.9, wall, trim);
  cornice(g, x0, z0, x1, z1, h + 1.0, 1.1, trim);
  roofscape(g, r, x0, z0, x1, z1, h, s, { overrun: null, density: 0.7 });
  // Entrance bay: tall glazing between stone piers, rising above the parapet.
  const ew = Math.min(8, bw * 0.34);
  const eh = h + 1.8;
  g.box(-ew / 2, z0 - 1.0, ew / 2, z0, 0, eh, m(c(0xd7cfc0), P.TRIM, s), trim, { sides: [true, true, false, true] });
  g.wall(ew / 2 - 0.9, z0 - 1.03, -ew / 2 + 0.9, z0 - 1.03, 0.6, eh - 2.4, m(c(0x4a5862), P.GLASS, s, fh, 1.4));
  g.box(-ew / 2 - 0.08, z0 - 1.1, ew / 2 + 0.08, z0 - 0.9, eh - 1.7, eh - 0.6, m(c(accent), P.SIGN, s, 1, ew), null, { sides: [true, true, false, true] });
  canopy(g, -ew / 2 - 0.5, ew / 2 + 0.5, z0 - 1.0, 3.2, 2.2, 0.25, m(c(accent), P.TRIM, s));
  g.box(-ew / 2 - 1, z0 - 3.4, ew / 2 + 1, z0 - 1.0, 0, 0.3, m(c(0xa6a196), P.STONE, s), m(c(0xb8b2a6), P.PAVING, s), { sides: [true, true, false, true] });
  // Flagpole.
  g.box(x0 + 1.5, z0 - 3.2, x0 + 1.62, z0 - 3.08, 0, 11, m(c(0xc9ccd0), P.METAL, s), null);
  g.box(x0 + 1.62, z0 - 3.17, x0 + 3.4, z0 - 3.13, 9.6, 10.8, m(c(accent), P.TRIM, s), null);
  return [x0, z0, x1, z1, h];
}

const police: Gen = (g, b, r) => {
  const s = b.seed & 255;
  g.ground(-b.w / 2, 0, b.w / 2, b.d, PAVE(s), 0.04);
  const [x0, , x1, z1] = civic(g, r, b, r.pick([0xcfc6b5, 0xbcb3a2, 0xd9d2c3]), 0x1f4fa8, 3, 7);
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
  const [x0, z0, x1, z1, h] = civic(g, r, b, 0xeae6dc, 0xc8202a, 2, 7, P.RES);
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

/** Water tower: a fluted concrete shaft, a painted steel bowl with a catwalk, a pump house. */
const waterTower: Gen = (g, b) => {
  const s = b.seed & 255;
  g.ground(-b.w / 2, 0, b.w / 2, b.d, CONC(s), 0.04);
  const cz = b.d / 2;
  const paint = c([0xdfe3e2, 0xb9cdd3, 0xd6d0c2, 0xa9c0c6][s % 4]);
  const band = c([0x2f5e7a, 0x6e5338, 0x3b5a4a, 0x8c2f2a][(s >> 2) % 4]);
  g.cylinder(0, cz, 1.7, 1.25, 0, 18.6, 12, m(c(0xc9c4b8), P.CONCRETE, s, 3, 0.9), null);
  g.lathe(0, cz, [[1.25, 18.4], [3.8, 20.2], [5.7, 22.0], [6.2, 23.6]], 14, m(paint, P.METAL, s, 3, 3));
  g.lathe(0, cz, [[6.2, 23.6], [6.25, 24.6]], 14, m(band, P.METAL, s, 3, 3));
  g.lathe(0, cz, [[6.25, 24.6], [5.6, 26.6], [3.4, 28.4], [0.9, 29.3], [0.01, 29.5]], 14, m(paint, P.METAL, s, 3, 3));
  // Catwalk with a railing around the bowl's waist.
  g.lathe(0, cz, [[6.25, 23.55], [7.0, 23.55], [7.0, 23.7], [6.25, 23.7]], 14, m(c(0x55595c), P.METAL, s));
  g.lathe(0, cz, [[7.0, 23.7], [7.0, 24.7]], 14, m(c(0x3a3d40), P.LOUVRE, s, 3, 1));
  g.cylinder(0, cz, 0.12, 0.05, 29.4, 31.5, 4, m(c(0x8a8d90), P.METAL, s), null);
  // Pump house.
  g.box(-6, 1, -3, 3.4, 0, 2.8, m(c(0xb9b2a4), P.BRICK, s, 3, 3), m(c(0x6f6c66), P.ROOF_FLAT, s));
  g.wall(-4.0, 0.95, -5.0, 0.95, 0.05, 2.1, m(c(0x3a4a55), P.DOOR, s));
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
/**
 * Hotel: a double-height glazed lobby under a stone podium with a porte-cochère,
 * a guest-room slab in render or panels with balcony bays, and a crown carrying
 * the brand (lit at night) or, for grand hotels, a rooftop pool deck.
 */
const hotel: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  const brand = r.pick([0x1f4fa8, 0x8e1b1b, 0x0e7c66, 0x2c3e50, 0xb07d2b]);
  g.ground(-w / 2, 0, w / 2, d, PAVE(s), 0.04);
  // Drop-off loop in front.
  g.ground(-w / 2 + 3, 1.5, w / 2 - 3, 8.5, m(c(0x4a4b4e), P.PLAIN, s), 0.05);
  const x0 = -w / 2 + 3, x1 = w / 2 - 3, z0 = 11, z1 = d - 5;
  const fh = 3.2;
  const lobbyH = 6.2;
  const top = lobbyH + (b.floors - 1) * fh;
  const panel = r.chance(0.4);
  const facadeCol = c(r.pick(panel ? PAL.panel : PAL.render));
  const facade: Mat = { ...m(facadeCol, panel ? P.PANEL : P.RES, s, fh, 3.4), oy: lobbyH };
  const stone = c(r.pick([0xb8ad9a, 0xa39b8e, 0xc9bda6]));
  const trim = m(c(r.pick([0xeeeae0, 0xd8cfbd, 0x3b3c3e])), P.TRIM, s);
  // Lobby: glass between stone piers, the podium above it.
  g.box(x0 - 1, z0 - 1, x1 + 1, z1, 0, lobbyH, m(c(0x4a5862), P.GLASS, s, lobbyH, 3), null);
  piers(g, x0 - 1, x1 + 1, z0 - 1, 0, lobbyH, Math.max(4, Math.round((x1 - x0) / 4.5)), 0.7, 0.25, m(stone, P.STONE, s, 3, 3));
  outline(g, x0 - 1, z0 - 1, x1 + 1, z1, lobbyH - 0.5, lobbyH + 0.2, 0.3, trim);
  g.flat(x0 - 1, z0 - 1, x1 + 1, z1, lobbyH, m(c(0x7f7b74), P.ROOF_FLAT, s));
  // Guest-room slab, set back from the podium edge.
  g.box(x0, z0 + 1, x1, z1, lobbyH, top, facade, null);
  // Balcony bays in pairs, stacked up the street face.
  const bays = Math.max(2, Math.round((x1 - x0) / 3.4));
  const bw2 = (x1 - x0) / bays;
  const slab = m(c(0xdedad2), P.TRIM, s);
  const rail = panel ? m(c(0x4d5e66), P.GLASS_PLAIN, s) : m(c(0xe8e3d8), P.TRIM, s);
  for (let y = lobbyH + fh; y <= top - fh + 0.1; y += fh) {
    for (let k = 1; k + 1 < bays; k += 3) balcony(g, x0 + k * bw2 + 0.2, x0 + (k + 2) * bw2 - 0.2, z0 + 1, y + 0.02, 1.2, slab, rail);
  }
  g.flat(x0, z0 + 1, x1, z1, top, m(c(0x7d7a74), P.ROOF_FLAT, s));
  // Crown: brand name band on the parapet, lit at night.
  parapet(g, x0, z0 + 1, x1, z1, top, 1.6, m(facadeCol, P.TRIM, s), trim);
  g.box(-w / 4, z0 + 0.82, w / 4, z0 + 1, top + 0.2, top + 1.4, m(c(brand), P.SIGN, s, 1, w / 2), null, { sides: [true, true, false, true] });
  // Porte-cochère on columns, with flags.
  canopy(g, -6, 6, z0 - 1, 4.4, 7.6, 0.45, m(c(brand), P.TRIM, s));
  for (const x of [-5.6, 5.6]) g.box(x - 0.2, 3.2, x + 0.2, 3.6, 0, 4.4, m(c(0xd8d8d4), P.METAL, s), null);
  for (let i = 0; i < 3; i++) {
    const x = w / 2 - 4 - i * 1.6;
    g.box(x - 0.05, 1.2, x + 0.05, 1.3, 0, 6.5, m(c(0xd8d8d4), P.METAL, s), null);
    g.box(x + 0.05, 1.22, x + 1.3, 1.28, 5.6, 6.4, m(c(r.pick([0xb23a30, 0x2e6f9e, 0x2f8a55, 0xd0902a, brand])), P.TRIM, s), null);
  }
  // Rooftop: plant, or a pool deck for grand hotels.
  if (b.level >= 3) {
    g.box(x0 + 2, z0 + 3, x1 - 2, z1 - 2, top, top + 0.25, m(c(0xb9a888), P.WOOD, s, 3, 1), m(c(0xb9a888), P.WOOD, s, 3, 1));
    g.ground(x0 + 4, z0 + 5, (x0 + x1) / 2, z1 - 4, m(c(0x3aa0c8), P.WATER, s), top + 0.32);
    for (let i = 0; i < 4; i++) g.box((x0 + x1) / 2 + 1.5 + i * 1.6, z0 + 5, (x0 + x1) / 2 + 2.3 + i * 1.6, z0 + 7, top + 0.25, top + 0.55, m(c(0xf4f4f0), P.TRIM, s), m(c(0xf4f4f0), P.TRIM, s));
  } else {
    roofscape(g, r, x0, z0 + 1, x1, z1, top, s);
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
  // Upper volume in timber boards or smooth render, cantilevered, under a thin dark fascia.
  const upper = r.chance(0.5) ? m(c(r.pick([0x9a6b45, 0x7d5a3e, 0xb08a64])), P.WOOD, s, 3, 3) : m(white, P.PANEL, s, 3, 3.6);
  g.box(x0 + shift - 1, z0 - 1.5, x1 + shift - 2, z1 - 1, 3.4, 6.5, upper, m(dark, P.ROOF_FLAT, s));
  g.box(x0 + shift - 1.2, z0 - 1.7, x1 + shift - 1.8, z1 - 0.8, 6.5, 6.75, m(dark, P.TRIM, s), m(dark, P.TRIM, s));
  // Soffit under the cantilever.
  g.quad([x0 + shift - 1, 3.4, z0 - 1.5], [x1 + shift - 2, 3.4, z0 - 1.5], [x1 + shift - 2, 3.4, z0], [x0 + shift - 1, 3.4, z0], [0, -1, 0], m(c(0xb8a58a), P.WOOD, s, 3, 3), [[0, 0], [1, 0], [1, 1], [0, 1]]);
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
  g.box(x0, z0, x1, z1, 0, 8, m(c(pick(r, INDUSTRY)), P.INDUSTRIAL, s, 8, 2), m(c(0x85827c), P.ROOF_FLAT, s));
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
  g.box(-w / 2 + 2, 2, -w / 2 + 14, 8, 0, 5, m(c(pick(r, INDUSTRY)), P.INDUSTRIAL, s, 5, 1.4), m(c(0x85827c), P.ROOF_FLAT, s));
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
  // Rusticated stone ground floor, smooth ashlar above, a cornice and balustraded parapet.
  const bx0 = -w / 2 + 4, bx1 = w / 2 - 4;
  g.box(bx0, z0, bx1, z1, 0, 4.6, m(c(0xd9d0bd), P.STONE, s, 4.6, 3.6), null);
  g.box(bx0, z0, bx1, z1, 4.6, h, m(stone, P.STONE, s, 4.2, 3.6), null);
  outline(g, bx0, z0, bx1, z1, 4.4, 4.75, 0.14, m(trim, P.TRIM, s));
  g.flat(bx0, z0, bx1, z1, h, m(c(0x8a8780), P.ROOF_FLAT, s));
  cornice(g, bx0, z0, bx1, z1, h + 0.1, 1.4, m(trim, P.TRIM, s));
  parapet(g, bx0, z0, bx1, z1, h + 0.1, 1.1, m(stone, P.LOUVRE, s, 3, 1), m(trim, P.TRIM, s));
  piers(g, bx0, bx1, z0, 4.75, h - 0.5, 8, 0.9, 0.18, m(trim, P.TRIM, s));
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
  const style = input.style as string;
  if (style.startsWith('arch:') || style.startsWith('lab:')) {
    // Research centres and buildings designed by research are composed, not hand-made.
    const spec = archForStyle(style, input.w, input.d, input.level, input.seed);
    if (spec) buildArch(g, spec, input.seed, r);
    else g.box(-input.w / 2 + 3, 8, input.w / 2 - 3, input.d - 3, 0, 8, m(c(0xcfccc4), P.OFFICE, input.seed & 255), m(c(0x7d7a74), P.ROOF_FLAT, input.seed & 255));
  } else (GENERATORS[input.style as keyof typeof GENERATORS] ?? house)(g, input, r);
  return g.build(cx, cz, angle, input.d / 2, baseY);
}
