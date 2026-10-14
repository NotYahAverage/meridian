import type { Rng } from '../../core/rng';
import { type GeoBuilder, type Mat, P, mixRGB, shade } from './BuildingKit';
import { PAL, awning, balcony, canopy, cornice, door, mat, outline, parapet, piers, rgb, roofscape } from './architecture';
import { CONC, type Gen, GRASS, PAVE, bushes, parking, trees } from './lot';

/**
 * Shops, mixed-use blocks, retail boxes and offices. Street-facing buildings
 * get a proper shopfront (pilasters, fascia signs, awnings), a string course
 * over the ground floor and a cornice or parapet at the top; offices get a
 * lobby base, a facade system (ribbon windows with sunshades, a stone grid
 * with deep piers, or a curtain wall with fins) and a plant screen crown.
 */

/** A shop sign on the fascia of a front at z (lit at night). */
function fasciaSign(g: GeoBuilder, x0: number, x1: number, z: number, y0: number, y1: number, color: number, seed: number): void {
  g.box(x0, z - 0.14, x1, z, y0, y1, mat(rgb(0x2a2b2d), P.TRIM, seed), mat(rgb(0x2a2b2d), P.TRIM, seed), { sides: [true, true, false, true] });
  g.wall(x1 - 0.15, z - 0.16, x0 + 0.15, z - 0.16, y0 + 0.12, y1 - 0.12, { color: rgb(color), pattern: P.SIGN, seed, bay: x1 - x0 });
}

/** Ground-floor shop units along a front: pilasters, fascia signs and awnings or canopies. */
function shopUnits(g: GeoBuilder, r: Rng, x0: number, x1: number, z: number, gh: number, seed: number, opts: { awnings?: number; pilaster?: Mat } = {}): void {
  const units = Math.max(1, Math.round((x1 - x0) / r.range(6.5, 9)));
  const uw = (x1 - x0) / units;
  for (let i = 0; i < units; i++) {
    const a = x0 + i * uw, b = a + uw;
    const accent = r.pick(PAL.accent);
    fasciaSign(g, a + 0.35, b - 0.35, z, gh - 1.05, gh - 0.35, r.pick([accent, 0xf2efe6, 0x2b2b2b, accent]), seed + i);
    if (r.chance(opts.awnings ?? 0.6)) awning(g, a + 0.5, b - 0.5, z - 0.14, gh - 1.15, 1.5, 0.6, rgb(accent), seed + i);
  }
  if (opts.pilaster) piers(g, x0, x1, z, 0, gh - 0.3, units, 0.45, 0.12, opts.pilaster);
}

/** Corner shop: a shopfront with fascia and awning, flats or a false front above, side parking. */
export const shop: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 127;
  g.ground(-w / 2, 0, w / 2, d, PAVE(s), 0.04);
  const bw = Math.min(w - 1.5, r.range(10, 16));
  const bd = Math.min(d - 4, r.range(11, 16));
  const side = r.chance(0.5) ? 1 : -1;
  const x0 = side > 0 ? -w / 2 + 0.6 : w / 2 - 0.6 - bw;
  const x1 = x0 + bw;
  const z0 = r.range(0.6, 2.5), z1 = z0 + bd;
  const floors = Math.max(1, b.floors);
  const brick = r.chance(0.55);
  const col = rgb(r.pick(brick ? PAL.brick : PAL.render));
  const trim = mat(rgb(r.pick([0xeeeae0, 0xd8cfbd])), P.TRIM, s);
  const gh = 4.2;
  const upper: Mat = { ...mat(col, brick ? P.BRICK : P.RES, s, 3.2, 3.3), oy: gh };
  g.box(x0, z0, x1, z1, 0, gh, mat(shade(col, 0.85), P.STORE, s, gh, bw / Math.max(1, Math.round(bw / 4.5))), null);
  outline(g, x0, z0, x1, z1, gh - 0.3, gh, 0.14, trim);
  let top = gh;
  if (floors > 1) {
    top = gh + (floors - 1) * 3.2;
    g.box(x0, z0, x1, z1, gh, top, upper, null);
  } else {
    // Single storey: a false front rises above the roof at the street.
    g.box(x0, z0, x1, z0 + 0.3, gh, gh + 1.6, mat(col, brick ? P.BRICK : P.TRIM, s, 30, 30), trim, { sides: [true, true, true, true] });
  }
  g.flat(x0, z0, x1, z1, top, mat(rgb(r.pick(PAL.membrane)), P.ROOF_FLAT, s));
  if (floors > 1) {
    parapet(g, x0, z0, x1, z1, top, 0.8, upper, trim);
    cornice(g, x0, z0, x1, z1, top + 0.9, 1.1, trim);
  } else {
    cornice(g, x0, z0, x1, z0 + 0.3, gh + 1.6, 0.9, trim, [true, true, false, true]);
  }
  roofscape(g, r, x0, z0 + 0.4, x1, z1, top, s, { overrun: null, density: 0.8 });
  shopUnits(g, r, x0 + 0.3, x1 - 0.3, z0, gh, s, { awnings: 0.75 });
  // Side door to the flats.
  if (floors > 1) door(g, side > 0 ? x0 + 1.2 : x1 - 1.2, z0, 0.05, 1.0, 2.3, mat(rgb(0x2a2f33), P.DOOR, s), trim);
  const free = w - bw - 1.2;
  if (free > 6) parking(g, r, side > 0 ? x1 + 0.6 : -w / 2 + 0.6, 0.8, side > 0 ? w / 2 - 0.6 : x0 - 0.6, d - 1, 0.5, s);
  // Bins and a small yard behind.
  g.box(side > 0 ? x0 + 1 : x1 - 3, z1 + 0.5, side > 0 ? x0 + 3 : x1 - 1, z1 + 2, 0, 1.4, mat(rgb(0x2f5a3a), P.METAL, s), mat(rgb(0x2f5a3a), P.METAL, s));
};

/** Mixed use: shops under three to seven floors of flats, with balconies or bays and a cornice. */
export const mixeduse: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 127;
  g.ground(-w / 2, 0, w / 2, d, PAVE(s), 0.04);
  const floors = Math.max(3, b.floors);
  const bw = w - 1, bd = Math.min(d - 5, r.range(16, 22));
  const x0 = -bw / 2, x1 = bw / 2, z0 = 0.8, z1 = z0 + bd;
  const brick = r.chance(0.55);
  const panel = !brick && r.chance(0.4);
  const col = rgb(r.pick(brick ? PAL.brick : panel ? PAL.panel : PAL.render));
  const trim = mat(rgb(r.pick([0xeeeae0, 0xd8cfbd, 0x3b3c3e])), P.TRIM, s);
  const gh = 4.4;
  const fh = 3.15;
  const pat = brick ? P.BRICK : panel ? P.PANEL : P.RES;
  const upper: Mat = { ...mat(col, pat, s, fh, 3.2), oy: gh };
  g.box(x0, z0, x1, z1, 0, gh, mat(rgb(0x3e4246), P.STORE, s, gh, 4.4), null);
  const h = gh + (floors - 1) * fh;
  g.box(x0, z0, x1, z1, gh, h, upper, null);
  outline(g, x0, z0, x1, z1, gh - 0.35, gh, 0.2, trim);
  g.flat(x0, z0, x1, z1, h, mat(rgb(r.pick(PAL.membrane)), P.ROOF_FLAT, s));
  parapet(g, x0, z0, x1, z1, h, 0.9, upper, trim);
  if (brick || r.chance(0.5)) cornice(g, x0, z0, x1, z1, h + 1.0, 1.25, trim);
  roofscape(g, r, x0, z0, x1, z1, h, s, { tank: brick && r.chance(0.35) });
  shopUnits(g, r, x0 + 0.2, x1 - 0.2, z0, gh, s, { awnings: 0.55, pilaster: mat(shade(col, 0.9), brick ? P.BRICK : P.TRIM, s) });
  // Balconies on rendered and panel blocks; French balconies (railings only) on brick.
  const slab = mat(rgb(0xdedad2), P.TRIM, s);
  const cells = Math.max(1, Math.round(bw / 3.2));
  const bayW = bw / cells;
  for (let y = gh + fh; y <= h - fh + 0.1; y += fh) {
    for (let k = 0; k < cells; k++) {
      if (brick) {
        if (k % 2 !== 1) continue;
        const a = x0 + k * bayW + bayW * 0.22, c2 = x0 + (k + 1) * bayW - bayW * 0.22;
        g.box(a, z0 - 0.25, c2, z0, y + 0.85, y + 1.0, mat(rgb(0x2b2c2e), P.METAL, s), mat(rgb(0x2b2c2e), P.METAL, s), { sides: [true, true, false, true] });
        g.wall(c2, z0 - 0.24, a, z0 - 0.24, y + 0.05, y + 0.85, mat(rgb(0x2b2c2e), P.LOUVRE, s, 3, 1));
      } else if (k % 3 === 1 && k + 1 < cells) {
        balcony(g, x0 + k * bayW + 0.3, x0 + (k + 2) * bayW - 0.3, z0, y + 0.02, 1.3, slab, panel ? mat(rgb(0x4d5e66), P.GLASS_PLAIN, s) : mat(shade(col, 1.08), P.TRIM, s));
      }
    }
  }
  if (d - z1 > 7) parking(g, r, -w / 2 + 1, z1 + 1, w / 2 - 1, d - 0.5, 0.6, s);
};

/** Strip mall: parking in front, a row of units with stepped false fronts behind a covered walk. */
export const stripmall: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 127;
  const front = Math.min(d - 14, r.range(16, 20));
  parking(g, r, -w / 2 + 1, 1, w / 2 - 1, front, 0.55, s);
  g.ground(-w / 2, front, w / 2, d, PAVE(s), 0.04);
  const z0 = front + 3.2, z1 = d - 1.5;
  const x0 = -w / 2 + 1, x1 = w / 2 - 1;
  const h = 5.2;
  const col = rgb(r.pick(PAL.render));
  const trim = mat(rgb(r.pick([0xeeeae0, 0x6e5338, 0x3b3c3e])), P.TRIM, s);
  g.box(x0, z0, x1, z1, 0, h, mat(col, P.STORE, s, 4.8, 4.5), null);
  g.flat(x0, z0, x1, z1, h, mat(rgb(r.pick(PAL.membrane)), P.ROOF_FLAT, s));
  roofscape(g, r, x0, z0 + 2, x1, z1, h, s, { overrun: null, density: 1.2 });
  const units = Math.max(3, Math.floor((x1 - x0) / 9));
  const uw = (x1 - x0) / units;
  for (let i = 0; i < units; i++) {
    const a = x0 + i * uw, b2 = a + uw;
    // Each unit's false front at its own height; the end units are tallest.
    const ff = h + (i === 0 || i === units - 1 ? 2.2 : r.range(0.6, 1.6));
    g.box(a, z0, b2, z0 + 0.35, h, ff, mat(i % 2 ? shade(col, 0.93) : col, P.TRIM, s), trim, { sides: [true, true, true, true] });
    outline(g, a, z0, b2, z0 + 0.35, ff - 0.25, ff, 0.12, trim, [true, true, false, true]);
    fasciaSign(g, a + 0.8, b2 - 0.8, z0 - 3.2, 3.5, 4.4, r.pick(PAL.accent), s + i);
  }
  // Covered walk on posts.
  canopy(g, x0, x1, z0, 3.3, 3.2, 0.3, mat(rgb(0x9a958c), P.TRIM, s));
  for (let i = 0; i <= units; i++) {
    const px = x0 + i * uw;
    g.box(px - 0.15, z0 - 3.0, px + 0.15, z0 - 2.7, 0, 3.3, trim, null);
  }
  // Pylon sign by the road.
  const accent = r.pick(PAL.accent);
  g.box(x0 + 1, 0.5, x0 + 1.6, 1.1, 0, 6, mat(rgb(0x55585c), P.METAL, s), null);
  g.box(x0 + 0.3, 0.6, x0 + 2.3, 1.0, 4, 6.8, mat(rgb(accent), P.SIGN, s, 3, 2), mat(rgb(accent), P.TRIM, s));
  trees(g, r, 3, -w / 2 + 2, 0.5, w / 2 - 2, 1.2, undefined, 0.7);
};

/** Big-box retail: a long box behind its car park, with a tall glazed entrance portal and a parapet band. */
export const bigbox: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 127;
  const front = Math.min(d - 18, 16);
  parking(g, r, -w / 2 + 1, 1, w / 2 - 1, front, 0.5, s);
  const z0 = front + 1.5, z1 = d - 1.5, x0 = -w / 2 + 2, x1 = w / 2 - 2;
  const h = r.range(8, 10);
  const col = rgb(r.pick([0xd2cbbd, 0xc4bcae, 0xddd4c4, 0xb4ab9c, 0x9c9488]));
  const accent = r.pick(PAL.accent);
  g.box(x0, z0, x1, z1, 0, h, mat(col, P.CONCRETE, s, 4, 6), null);
  g.flat(x0, z0, x1, z1, h, mat(rgb(r.pick(PAL.membrane)), P.ROOF_FLAT, s));
  parapet(g, x0, z0, x1, z1, h, 1.2, mat(col, P.TRIM, s), mat(rgb(0xe4dfd4), P.TRIM, s));
  outline(g, x0, z0, x1, z1, h - 0.2, h + 1.2, 0.08, mat(rgb(accent), P.TRIM, s), [true, true, false, true]);
  roofscape(g, r, x0, z0, x1, z1, h, s, { overrun: null, density: 1.4, solar: r.chance(0.4) });
  // Entrance portal: a taller glazed bay with a deep canopy.
  const ex = r.range(x0 + 8, x1 - 16);
  g.box(ex - 1, z0 - 1.2, ex + 11, z0, 0, h + 2.5, mat(rgb(accent), P.TRIM, s), mat(rgb(accent), P.TRIM, s), { sides: [true, true, false, true] });
  g.wall(ex + 10, z0 - 1.25, ex, z0 - 1.25, 0, h - 1, mat(rgb(0x4a5a64), P.GLASS, s, h - 1, 2));
  canopy(g, ex - 1.5, ex + 11.5, z0 - 1.2, 4.3, 2.8, 0.35, mat(rgb(0x3a3d40), P.METAL, s));
  fasciaSign(g, ex - 0.5, ex + 10.5, z0 - 1.2, h - 0.6, h + 2.0, accent, s);
  // Trolley shelter and kerbside planters.
  g.box(x1 - 8, z0 - 6, x1 - 2, z0 - 3, 2.4, 2.6, mat(rgb(0xd8d8d4), P.METAL, s), mat(rgb(0xd8d8d4), P.METAL, s));
  trees(g, r, 4, -w / 2 + 2, 0.5, w / 2 - 2, 1.2, undefined, 0.75);
};

/**
 * Office building (three to twelve floors). The upper floors oversail a
 * glazed lobby on columns; the facade is one of three systems: ribbon windows
 * with sunshades, a stone grid with deep piers, or a curtain wall with fins.
 */
export const office: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 127;
  g.ground(-w / 2, 0, w / 2, d, GRASS(s), 0.03);
  const floors = Math.max(3, b.floors);
  const fh = 3.8;
  const bw = w - r.range(4, 8);
  const bd = Math.min(d - 10, r.range(16, 24));
  const z0 = r.range(5, 7), z1 = z0 + bd, x0 = -bw / 2, x1 = bw / 2;
  const system = r.pick(['ribbon', 'grid', 'curtain']);
  const trim = mat(rgb(r.pick([0xe8e4dc, 0x3b3c3e, 0xb0b3b5])), P.TRIM, s);
  const glassCol = rgb(r.pick(PAL.glass));
  const lobbyInset = 1.6;
  const lobbyH = fh * (floors > 5 ? 2 : 1);
  const h = lobbyH + (floors - (floors > 5 ? 2 : 1)) * fh;
  // Lobby: full-height glass set back under the building, with columns at the front.
  g.box(x0 + lobbyInset, z0 + lobbyInset, x1 - lobbyInset, z1 - lobbyInset * 0.5, 0, lobbyH, mat(glassCol, P.GLASS, s, lobbyH, 2.2), null);
  const cols = Math.max(2, Math.round(bw / 7));
  for (let i = 0; i <= cols; i++) {
    const x = x0 + 0.5 + ((bw - 1) * i) / cols;
    g.box(x - 0.35, z0 + 0.15, x + 0.35, z0 + 0.85, 0, lobbyH, mat(rgb(0xc9c3b8), P.CONCRETE, s), null);
  }
  // Soffit under the oversail.
  g.quad([x0, lobbyH, z0], [x1, lobbyH, z0], [x1, lobbyH, z0 + lobbyInset], [x0, lobbyH, z0 + lobbyInset], [0, -1, 0], mat(rgb(0xb8b2a8), P.TRIM, s), [[x0, z0], [x1, z0], [x1, z0 + 1], [x0, z0 + 1]]);
  let body: Mat;
  if (system === 'ribbon') body = mat(mixRGB(rgb(r.pick([0xd8d2c8, 0xb8b4ac, 0x8f8a84, 0xe4ded2])), glassCol, 0.1), P.OFFICE, s, fh, r.range(2.6, 3.4));
  else if (system === 'grid') body = mat(rgb(r.pick([0xcfc6b5, 0xbcb3a2, 0xd9d2c3, 0xa9a196])), P.STONE, s, fh, 3.0);
  else body = mat(glassCol, P.GLASS, s, fh, 1.8);
  g.box(x0, z0, x1, z1, lobbyH, h, body, null);
  g.flat(x0, z0, x1, z1, h, mat(rgb(r.pick(PAL.membrane)), P.ROOF_FLAT, s));
  parapet(g, x0, z0, x1, z1, h, 1.0, mat(system === 'curtain' ? rgb(0x4f5a62) : body.color, P.TRIM, s), trim);
  if (system === 'ribbon') {
    // Horizontal sunshades over each ribbon on the street and side faces.
    const shade2 = mat(rgb(r.pick([0x8f9397, 0x6e5338, 0x5d6166])), P.METAL, s);
    for (let y = Math.ceil((lobbyH + 0.5) / fh) * fh; y < h; y += fh) outline(g, x0, z0, x1, z1, y + fh * 0.93, y + fh * 0.93 + 0.1, 0.55, shade2, [true, true, false, true]);
  } else if (system === 'grid') {
    const n = Math.max(2, Math.round(bw / 3.0));
    piers(g, x0, x1, z0, lobbyH, h, n, 0.4, 0.35, mat(shade(body.color, 1.05), P.TRIM, s));
    outline(g, x0, z0, x1, z1, lobbyH, lobbyH + 0.6, 0.35, mat(shade(body.color, 1.05), P.TRIM, s));
  } else {
    piers(g, x0, x1, z0, lobbyH, h + 1.0, Math.max(3, Math.round(bw / 3.6)), 0.14, 0.45, mat(rgb(r.pick([0xc9ccd0, 0x3a3f45, 0x8d7a60])), P.METAL, s));
  }
  // Plant screen.
  const ins = Math.min(bw, bd) * 0.2;
  g.box(x0 + ins, z0 + ins * 1.2, x1 - ins, z1 - ins, h, h + 3.2, mat(rgb(0x9a9993), P.LOUVRE, s, 3.2, 1), mat(rgb(0x7b7872), P.ROOF_FLAT, s));
  roofscape(g, r, x0, z0, x1, z0 + ins * 1.2, h, s, { overrun: null, density: 0.5 });
  // Entrance canopy and forecourt.
  canopy(g, -4, 4, z0 + lobbyInset, Math.min(lobbyH - 0.4, 4.2), lobbyInset + 2.4, 0.3, mat(rgb(0x3a3d40), P.METAL, s));
  g.ground(-4, 0, 4, z0 + lobbyInset, mat(rgb(0xb3ada2), P.PAVING, s), 0.045);
  if (d - z1 > 7) parking(g, r, -w / 2 + 1, z1 + 1.5, w / 2 - 1, d - 0.5, 0.7, s);
  trees(g, r, 3, -w / 2 + 1.5, 1, w / 2 - 1.5, z0 - 1.5, [-4.5, 0, 4.5, z0], 0.85);
  bushes(g, r, Math.floor(bw / 3), x0 + 1, x1 - 1, z0 - 0.7);
};

/**
 * Office tower: a stone-and-glass podium, a curtain-wall shaft with fins in
 * two or three stages, and a crown (a lit glass lantern, a spire, a sloped
 * top or a plant screen).
 */
export const officeTower: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 127;
  g.ground(-w / 2, 0, w / 2, d, PAVE(s), 0.04);
  const floors = Math.max(12, b.floors);
  const fh = 3.9;
  const glass = rgb(r.pick(PAL.glass));
  const tw = Math.min(w - 6, r.range(22, 28));
  const td = Math.min(d - 8, r.range(20, 26));
  const z0 = (d - td) / 2 + 1, x0 = -tw / 2;
  const stone = rgb(r.pick([0xb8ad9a, 0xa39b8e, 0xc9bda6, 0x6e6a66]));
  const trim = mat(rgb(r.pick([0xd8d8d4, 0x3a3f45])), P.TRIM, s);
  // Podium: double-height glass lobby in a stone frame.
  const ph = 7.2;
  g.box(x0 - 2, z0 - 2, x0 + tw + 2, z0 + td + 2, 0, ph, mat(shade(glass, 1.1), P.GLASS, s, ph, 3), null);
  g.flat(x0 - 2, z0 - 2, x0 + tw + 2, z0 + td + 2, ph, mat(rgb(0x7c7a74), P.ROOF_FLAT, s));
  outline(g, x0 - 2, z0 - 2, x0 + tw + 2, z0 + td + 2, ph - 1.2, ph + 0.6, 0.15, mat(stone, P.STONE, s, 3, 3));
  piers(g, x0 - 2, x0 + tw + 2, z0 - 2, 0, ph - 1.2, Math.max(3, Math.round((tw + 4) / 6)), 0.8, 0.3, mat(stone, P.STONE, s, 3, 3));
  const fins = r.chance(0.7);
  const finMat = mat(rgb(r.pick([0xc9ccd0, 0x8d9399, 0x3a3f45, 0x8d7a60])), P.METAL, s);
  const stages = floors > 24 ? 3 : 2;
  let y = ph;
  let inset = 0;
  const per = Math.floor(floors / stages);
  for (let k = 0; k < stages; k++) {
    const fl = k === stages - 1 ? floors - per * (stages - 1) : per;
    const y1 = y + fl * fh;
    const a0 = x0 + inset, c0 = z0 + inset, a1 = x0 + tw - inset, c1 = z0 + td - inset;
    const m2: Mat = { ...(r.chance(0.65) ? mat(glass, P.GLASS, s, fh, 1.6) : mat(mixRGB(rgb(r.pick([0xcfd2d4, 0x9ea3a8, 0x6a6f74, 0xd8d1c4])), glass, 0.4), P.OFFICE, s, fh, 2.2)), oy: ph };
    g.box(a0, c0, a1, c1, y, y1, m2, null);
    g.flat(a0, c0, a1, c1, y1, mat(rgb(0x77746e), P.ROOF_FLAT, s));
    if (fins) {
      const n = Math.max(3, Math.floor((a1 - a0) / 3.2));
      piers(g, a0, a1, c0, y, y1, n, 0.2, 0.35, finMat);
    }
    // A band at each setback.
    outline(g, a0, c0, a1, c1, y1 - 0.5, y1 + 0.3, 0.12, trim);
    y = y1;
    inset += r.range(1.4, 2.6);
  }
  const cx0 = x0 + inset, cz0 = z0 + inset, cx1 = x0 + tw - inset, cz1 = z0 + td - inset;
  const crown = r.pick(['lantern', 'plant', 'slope', 'spire']);
  if (crown === 'lantern') {
    // A glass lantern lit from inside at night, with a band of light.
    g.box(cx0, cz0, cx1, cz1, y, y + fh * 2, mat(shade(glass, 1.2), P.GLASS, s, fh, 1.6), null);
    g.box(cx0 - 0.2, cz0 - 0.2, cx1 + 0.2, cz1 + 0.2, y + fh * 2, y + fh * 2 + 0.8, mat(rgb(r.pick([0xfff3d6, 0x9fd8ff, 0xd8c8ff])), P.SIGN, s, 1, cx1 - cx0), trim);
  } else if (crown === 'slope') {
    // A sloped top: the roof rises towards the back.
    const rise = Math.min(14, (cz1 - cz0) * 0.6);
    g.quad([cx1, y, cz0], [cx0, y, cz0], [cx0, y + rise, cz1], [cx1, y + rise, cz1], [0, (cz1 - cz0) / Math.hypot(cz1 - cz0, rise), -rise / Math.hypot(cz1 - cz0, rise)], mat(glass, P.GLASS, s, 2, 1.6), [[0, 0], [cx1 - cx0, 0], [cx1 - cx0, rise], [0, rise]]);
    g.tri([cx0, y, cz0], [cx0, y, cz1], [cx0, y + rise, cz1], [-1, 0, 0], mat(glass, P.GLASS, s, fh, 1.6), [[0, y], [cz1 - cz0, y], [cz1 - cz0, y + rise]]);
    g.tri([cx1, y, cz1], [cx1, y, cz0], [cx1, y + rise, cz1], [1, 0, 0], mat(glass, P.GLASS, s, fh, 1.6), [[0, y], [cz1 - cz0, y], [0, y + rise]]);
    g.wall(cx0, cz1, cx1, cz1, y, y + rise, mat(glass, P.GLASS, s, fh, 1.6));
  } else if (crown === 'spire' && floors > 20) {
    parapet(g, cx0, cz0, cx1, cz1, y, 1.4, mat(rgb(0x4f5a62), P.TRIM, s), trim);
    roofscape(g, r, cx0, cz0, cx1, cz1, y, s, { density: 0.6 });
    g.cylinder((cx0 + cx1) / 2, (cz0 + cz1) / 2, 0.6, 0.08, y, y + 18 + floors * 0.3, 6, mat(rgb(0xb8bcc0), P.METAL, s), null);
  } else {
    parapet(g, cx0, cz0, cx1, cz1, y, 1.4, mat(rgb(0x4f5a62), P.TRIM, s), trim);
    const ins = Math.min(cx1 - cx0, cz1 - cz0) * 0.18;
    g.box(cx0 + ins, cz0 + ins, cx1 - ins, cz1 - ins, y, y + 4.5, mat(rgb(0x8a8d90), P.LOUVRE, s, 4.5, 1), mat(rgb(0x6d6a65), P.ROOF_FLAT, s));
    if (floors > 26 && r.chance(0.6)) g.cylinder(x0 + tw / 2, z0 + td / 2, 0.5, 0.08, y + 4.5, y + 26, 6, mat(rgb(0xb0b0b0), P.METAL, s), null);
  }
  // Entrance canopy.
  canopy(g, -6, 6, z0 - 2, 4.6, 4.5, 0.4, mat(rgb(0xd8d8d4), P.METAL, s));
  for (let i = 0; i < 5; i++) {
    const x = -w / 2 + 3 + ((w - 6) * i) / 4;
    g.box(x - 1.2, 0.6, x + 1.2, 2.6, 0, 0.6, CONC(s), mat(rgb(0x4f5d33), P.GRASS, s));
    g.prop({ kind: 'tree', x, y: 0.6, z: 1.6, rot: i, scale: 0.65, variant: 1 });
  }
};
