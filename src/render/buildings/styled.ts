import type { Rng } from '../../core/rng';
import { type FeatureId, type Movement, type RoofKind, type WallKind, styledSeed } from '../../sim/style/Movements';
import { VM } from '../../sim/traffic/Vehicles';
import { type GeoBuilder, type Mat, P, type RGB, hex, mixRGB, shade } from './BuildingKit';
import { airHandler, awning, canopy, cornice, door, outline, parapet, piers } from './architecture';
import { CAR_COLORS, CONC, type GenInput, PAVE, bushes, fence, parking, trees } from './lot';

/**
 * Homes, shops and offices drawn in an architectural movement. The movement
 * sets the materials, palette, window family, roofs and massing, and its
 * features add real geometry: planted terraces and roofs, sky gardens,
 * brise-soleil, pilotis, arcades, loggias, solar skins, wind crowns,
 * ornament and cantilevers. The same lot comes out as a different building
 * in every movement.
 */

const WALL_PAT: Record<WallKind, number> = {
  render: P.RES, brick: P.BRICK, stone: P.STONE, beton: P.BETON, panel: P.PANEL, timber: P.TIMBERW, glass: P.GLASS, siding: P.SIDING,
};

interface Kit {
  look: Movement;
  /** Seed byte for windowed facades (window family and frames). */
  s: number;
  /** Seed for everything else. */
  ss: number;
  wallCol: RGB;
  fh: number;
  bay: number;
  /** The movement's wall, with floors counted from `oy`. */
  wall(oy: number, col?: RGB): Mat;
  /** The ground floor or plinth finish. */
  base(oy: number): Mat;
  /** The same colour, no windows. */
  plain: Mat;
  trim: Mat;
  roof: Mat;
  membrane: Mat;
  planted: Mat;
  slab: Mat;
  /** Planter boxes: timber for handmade movements, pale concrete otherwise. */
  planter: Mat;
  rail: Mat;
  accent: RGB;
  has(f: FeatureId): boolean;
}

function kitFor(look: Movement, b: GenInput, r: Rng): Kit {
  const wtype = r.chance(0.75) ? look.windows[0] : look.windows[1];
  const s = styledSeed(wtype, look.frameTone, r.int(0, 3));
  const ss = b.seed & 127;
  const wallCol = hex(r.pick(look.wallColors));
  const glassy = look.wall === 'glass';
  const fh = look.floorH;
  const bay = glassy ? 1.7 : look.bay;
  const heavy = look.axes.heavy > 0.3;
  const roofHex = r.pick(look.roofColors);
  const roofPat = look.roof === 'butterfly' || look.roof === 'shed' || look.roof === 'vault' ? P.ROOF_METAL : P.ROOF_TILE;
  return {
    look,
    s,
    ss,
    wallCol,
    fh,
    bay,
    wall: (oy, col = wallCol) => ({ color: col, pattern: WALL_PAT[look.wall], seed: s, fh, bay, oy }),
    base: (oy) => ({ color: hex(look.baseColor), pattern: WALL_PAT[look.base], seed: s, fh: Math.max(fh, 3.6), bay, oy }),
    plain: { color: wallCol, pattern: P.TRIM, seed: ss },
    trim: { color: hex(look.trim), pattern: P.TRIM, seed: ss },
    roof: { color: hex(roofHex), pattern: roofPat, seed: ss },
    membrane: { color: hex(0x7e7a73), pattern: P.ROOF_FLAT, seed: ss },
    planted: { color: hex(0x5f7a3c), pattern: P.PLANTED, seed: ss },
    slab: heavy ? { color: shade(wallCol, 0.95), pattern: look.wall === 'beton' ? P.CONCRETE : P.TRIM, seed: ss } : { color: hex(look.frameTone >= 2 ? 0xd9d5cc : look.trim), pattern: P.TRIM, seed: ss },
    planter: look.axes.hand > 0 ? { color: hex(0x8a6a4a), pattern: P.WOOD, seed: ss, fh: 3, bay: 1 } : { color: hex(heavy ? 0xa8a39a : 0xc9c4ba), pattern: P.CONCRETE, seed: ss },
    rail: glassy || look.axes.hand < -0.3 ? { color: hex(0x4d5e66), pattern: P.GLASS_PLAIN, seed: ss } : heavy ? { color: wallCol, pattern: P.TRIM, seed: ss } : { color: hex(0x33363a), pattern: P.LOUVRE, seed: ss, fh: 3, bay: 1 },
    accent: hex(look.accent),
    has: (f) => look.features.includes(f),
  };
}

// ── Faces ───────────────────────────────────────────────────────────────────

/** A side of a footprint: 0 front (−z, the street), 1 right (+x), 2 back (+z), 3 left (−x). */
type Side = 0 | 1 | 2 | 3;
interface Face {
  side: Side;
  /** Length along the face. */
  len: number;
  /** Lot coordinates of a point `u` along the face and `o` out from it. */
  at(u: number, o: number): [number, number];
}

function face(side: Side, x0: number, z0: number, x1: number, z1: number): Face {
  switch (side) {
    case 0: return { side, len: x1 - x0, at: (u, o) => [x0 + u, z0 - o] };
    case 1: return { side, len: z1 - z0, at: (u, o) => [x1 + o, z0 + u] };
    case 2: return { side, len: x1 - x0, at: (u, o) => [x1 - u, z1 + o] };
    default: return { side, len: z1 - z0, at: (u, o) => [x0 - o, z1 - u] };
  }
}

/** Sides of a box standing against a face that should be drawn (not the one against the wall). */
const AWAY: Record<Side, [boolean, boolean, boolean, boolean]> = { 0: [true, true, false, true], 1: [true, true, true, false], 2: [false, true, true, true], 3: [true, false, true, true] };

/** A box against a face, from u0 to u1 along it and o0 to o1 out from it. */
function faceBox(g: GeoBuilder, F: Face, u0: number, u1: number, o0: number, o1: number, y0: number, y1: number, m: Mat, top: Mat | null = m): void {
  const [ax, az] = F.at(u0, o0);
  const [bx, bz] = F.at(u1, o1);
  g.box(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), y0, y1, m, top, { sides: o0 <= 0.001 ? AWAY[F.side] : [true, true, true, true] });
}

/** A flat panel parallel to a face, `o` out from it, facing out. */
function facePanel(g: GeoBuilder, F: Face, u0: number, u1: number, o: number, y0: number, y1: number, m: Mat): void {
  const [ax, az] = F.at(u1, o);
  const [bx, bz] = F.at(u0, o);
  g.wall(ax, az, bx, bz, y0, y1, m);
}

function faceProp(g: GeoBuilder, F: Face, u: number, o: number, y: number, kind: 'tree' | 'bush', scale: number, r: Rng): void {
  const [x, z] = F.at(u, o);
  g.prop({ kind, x, y, z, rot: r.next() * 6.28, scale, variant: r.int(0, 2) });
}

/**
 * A balcony on a face: slab, then a balustrade (glass, solid or railings) or,
 * for green movements, a planter box spilling with planting.
 */
function faceBalcony(g: GeoBuilder, F: Face, u0: number, u1: number, y: number, depth: number, k: Kit, r: Rng, planted: boolean, cheeks = false): void {
  faceBox(g, F, u0, u1, 0, depth, y - 0.16, y, k.slab);
  if (planted) {
    // Planter along the edge, its top planted, and shrubs or a small tree now and then.
    faceBox(g, F, u0, u1, depth - 0.55, depth, y, y + 0.55, k.planter, k.planted);
    if (r.chance(0.55)) faceProp(g, F, u0 + (u1 - u0) * r.range(0.2, 0.8), depth - 0.3, y + 0.55, r.chance(0.3) ? 'tree' : 'bush', r.range(0.45, 0.8), r);
  } else {
    // Balustrade: thin panels, both faces, on three sides.
    const top = y + 1.05;
    const [ax, az] = F.at(u0, depth), [bx, bz] = F.at(u1, depth);
    const [cx, cz] = F.at(u0, 0), [dx, dz] = F.at(u1, 0);
    g.wall(bx, bz, ax, az, y, top, k.rail);
    g.wall(ax, az, bx, bz, y, top, k.rail);
    g.wall(cx, cz, ax, az, y, top, k.rail);
    g.wall(ax, az, cx, cz, y, top, k.rail);
    g.wall(dx, dz, bx, bz, y, top, k.rail);
    g.wall(bx, bz, dx, dz, y, top, k.rail);
  }
  if (cheeks) {
    // Loggia: solid side walls up to the next floor.
    faceBox(g, F, u0 - 0.25, u0, 0, depth, y, y + k.fh - 0.16, k.plain);
    faceBox(g, F, u1, u1 + 0.25, 0, depth, y, y + k.fh - 0.16, k.plain);
  }
}

/** Brise-soleil: vertical fins at every bay and a shelf at every floor across a face. */
function finGrid(g: GeoBuilder, F: Face, y0: number, y1: number, k: Kit, depth: number): void {
  const bays = Math.max(1, Math.round(F.len / k.bay));
  const fin = k.look.wall === 'glass' ? { ...k.trim } : { color: shade(k.wallCol, 1.04), pattern: k.look.wall === 'beton' ? P.CONCRETE : P.TRIM, seed: k.ss };
  for (let i = 0; i <= bays; i++) {
    const u = (F.len * i) / bays;
    faceBox(g, F, Math.max(0, u - 0.14), Math.min(F.len, u + 0.14), 0, depth, y0, y1, fin);
  }
  for (let y = y0 + k.fh; y < y1 - 0.5; y += k.fh) faceBox(g, F, 0, F.len, 0, depth * 0.85, y - 0.16, y, fin);
}

/** Facade panels of photovoltaic cells over the spandrels of a face. */
function solarSkin(g: GeoBuilder, F: Face, y0: number, y1: number, k: Kit): void {
  const m: Mat = { color: hex(0x24313f), pattern: P.SOLAR, seed: k.ss };
  for (let y = y0; y < y1 - 0.5; y += k.fh) facePanel(g, F, 0.1, F.len - 0.1, 0.05, y + 0.05, y + Math.min(0.9, k.fh * 0.28), m);
}

/** Small vertical-axis wind turbines along a roof. */
function windCrown(g: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y: number, k: Kit, n: number): void {
  const mast: Mat = { color: hex(0xb8bcc0), pattern: P.METAL, seed: k.ss };
  const blade: Mat = { color: hex(0xe8eaec), pattern: P.TRIM, seed: k.ss };
  for (let i = 0; i < n; i++) {
    const cx = x0 + ((x1 - x0) * (i + 0.5)) / n, cz = (z0 + z1) / 2;
    g.cylinder(cx, cz, 0.12, 0.1, y, y + 3.2, 5, mast, null);
    for (let j = 0; j < 3; j++) {
      const a = (j / 3) * Math.PI * 2 + i;
      g.boxRot(cx + Math.cos(a) * 0.75, cz + Math.sin(a) * 0.75, 0.12, 0.34, a + Math.PI / 2, y + 1.2, y + 3.4, blade, blade);
    }
  }
}

/** Corner quoins: alternating stones up the corners of a block. */
function quoins(g: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, k: Kit): void {
  const m = k.trim;
  for (const [cx, cz] of [[x0, z0], [x1, z0]] as [number, number][]) {
    let alt = false;
    // Up to four storeys of stones (taller blocks have them at the base only).
    for (let y = y0; y + 0.6 <= Math.min(y1, y0 + 13); y += 0.75) {
      const w = alt ? 0.5 : 0.85;
      const sx = cx === x0 ? 1 : -1;
      g.box(Math.min(cx, cx + sx * w), z0 - 0.05, Math.max(cx, cx + sx * w), z0, y, y + 0.6, m, null, { sides: [true, cx !== x0, false, cx === x0] });
      alt = !alt;
    }
    void cz;
  }
  void z1;
}

/** A pediment over an entrance at (cx, z), facing the street. */
function pediment(g: GeoBuilder, cx: number, z: number, y: number, w: number, k: Kit): void {
  const rise = w * 0.22;
  g.box(cx - w / 2, z - 0.35, cx + w / 2, z, y, y + 0.3, k.trim, k.trim, { sides: [true, true, false, true] });
  g.tri([cx + w / 2, y + 0.3, z - 0.36], [cx - w / 2, y + 0.3, z - 0.36], [cx, y + 0.3 + rise, z - 0.36], [0, 0, -1], k.trim, [[0, 0], [1, 0], [0.5, 1]]);
}

// ── Roofs ───────────────────────────────────────────────────────────────────

function mansard(g: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y: number, rise: number, inset: number, roof: Mat, top: Mat): number {
  const o = 0.2;
  const X0 = x0 - o, X1 = x1 + o, Z0 = z0 - o, Z1 = z1 + o;
  const i0 = x0 + inset, i1 = x1 - inset, j0 = z0 + inset, j1 = z1 - inset, yt = y + rise;
  const nf = (dx: number, dz: number): [number, number, number] => {
    const l = Math.hypot(dx * rise, inset + o, dz * rise);
    return [(dx * rise) / l, (inset + o) / l, (dz * rise) / l];
  };
  g.quad([X1, y, Z0], [X0, y, Z0], [i0, yt, j0], [i1, yt, j0], nf(0, -1), roof, [[0, 0], [x1 - x0, 0], [x1 - x0, rise * 1.3], [0, rise * 1.3]]);
  g.quad([X0, y, Z1], [X1, y, Z1], [i1, yt, j1], [i0, yt, j1], nf(0, 1), roof, [[0, 0], [x1 - x0, 0], [x1 - x0, rise * 1.3], [0, rise * 1.3]]);
  g.quad([X0, y, Z0], [X0, y, Z1], [i0, yt, j1], [i0, yt, j0], nf(-1, 0), roof, [[0, 0], [z1 - z0, 0], [z1 - z0, rise * 1.3], [0, rise * 1.3]]);
  g.quad([X1, y, Z1], [X1, y, Z0], [i1, yt, j0], [i1, yt, j1], nf(1, 0), roof, [[0, 0], [z1 - z0, 0], [z1 - z0, rise * 1.3], [0, rise * 1.3]]);
  g.flat(i0, j0, i1, j1, yt, top);
  return yt;
}

function butterfly(g: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y: number, rise: number, roof: Mat, end: Mat): number {
  const o = 0.5, zm = (z0 + z1) / 2, yH = y + rise;
  const W = x1 - x0 + 2 * o, D = (z1 - z0) / 2 + o;
  const l = Math.hypot(D, rise);
  g.quad([x1 + o, yH, z0 - o], [x0 - o, yH, z0 - o], [x0 - o, y, zm], [x1 + o, y, zm], [0, D / l, rise / l], roof, [[0, 0], [W, 0], [W, l], [0, l]]);
  g.quad([x1 + o, y, zm], [x0 - o, y, zm], [x0 - o, yH, z1 + o], [x1 + o, yH, z1 + o], [0, D / l, -rise / l], roof, [[0, 0], [W, 0], [W, l], [0, l]]);
  const yE = y + rise * ((z1 - z0) / 2) / D;
  g.tri([x0, y, z0], [x0, y, zm], [x0, yE, z0], [-1, 0, 0], end, [[0, 0], [1, 0], [0, 1]]);
  g.tri([x0, y, zm], [x0, y, z1], [x0, yE, z1], [-1, 0, 0], end, [[0, 0], [1, 0], [1, 1]]);
  g.tri([x1, y, zm], [x1, y, z0], [x1, yE, z0], [1, 0, 0], end, [[0, 0], [1, 0], [1, 1]]);
  g.tri([x1, y, z1], [x1, y, zm], [x1, yE, z1], [1, 0, 0], end, [[0, 0], [1, 0], [0, 1]]);
  return yH;
}

function shed(g: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y: number, rise: number, roof: Mat, end: Mat): number {
  const o = 0.45, yH = y + rise;
  const W = x1 - x0 + 2 * o, D = z1 - z0 + 2 * o;
  const l = Math.hypot(D, rise);
  const yL = y - (o * rise) / (z1 - z0);
  g.quad([x1 + o, yL, z0 - o], [x0 - o, yL, z0 - o], [x0 - o, yH + (o * rise) / (z1 - z0), z1 + o], [x1 + o, yH + (o * rise) / (z1 - z0), z1 + o], [0, D / l, -rise / l], roof, [[0, 0], [W, 0], [W, l], [0, l]]);
  g.wall(x0, z1, x1, z1, y, yH, end);
  g.tri([x0, y, z0], [x0, y, z1], [x0, yH, z1], [-1, 0, 0], end, [[0, 0], [1, 0], [1, 1]]);
  g.tri([x1, y, z1], [x1, y, z0], [x1, yH, z1], [1, 0, 0], end, [[0, 0], [1, 0], [0, 1]]);
  return yH;
}

function vault(g: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y: number, rise: number, roof: Mat, end: Mat): number {
  const n = 7;
  const zc = (z0 + z1) / 2, R = (z1 - z0) / 2;
  const pt = (i: number): [number, number] => {
    const t = (i / n) * Math.PI;
    return [zc - Math.cos(t) * R, y + Math.sin(t) * rise];
  };
  for (let i = 0; i < n; i++) {
    const [za, ya] = pt(i), [zb, yb] = pt(i + 1);
    const tm = ((i + 0.5) / n) * Math.PI;
    const nz = -Math.cos(tm) * rise, ny = Math.sin(tm) * R;
    const l = Math.hypot(nz, ny) || 1;
    g.quad([x1 + 0.2, ya, za], [x0 - 0.2, ya, za], [x0 - 0.2, yb, zb], [x1 + 0.2, yb, zb], [0, ny / l, nz / l], roof, [[0, i], [x1 - x0, i], [x1 - x0, i + 1], [0, i + 1]]);
    g.tri([x0, y, zc], [x0, yb, zb], [x0, ya, za], [-1, 0, 0], end, [[0.5, 0], [1, 1], [0, 1]]);
    g.tri([x1, y, zc], [x1, ya, za], [x1, yb, zb], [1, 0, 0], end, [[0.5, 0], [0, 1], [1, 1]]);
  }
  return y + rise;
}

/**
 * A roof in the movement's way over a block whose walls end at `y`.
 * `wall` is the facade (gable ends take its colour without windows). Returns the top.
 */
function roofOver(g: GeoBuilder, k: Kit, r: Rng, x0: number, z0: number, x1: number, z1: number, y: number, opts: { kind?: RoofKind; big?: boolean; plant?: boolean } = {}): number {
  const kind = opts.kind ?? k.look.roof;
  const w = x1 - x0, d = z1 - z0;
  const end: Mat = { ...k.plain };
  const heavy = k.has('monumental');
  const flatTop = (green: boolean): number => {
    g.flat(x0, z0, x1, z1, y, k.membrane);
    const ph = heavy ? 1.5 : k.look.axes.ornate > 0.3 ? 1.0 : 0.8;
    parapet(g, x0, z0, x1, z1, y, ph, k.plain, heavy ? { ...k.plain, color: shade(k.wallCol, 1.06) } : k.trim, heavy ? 0.55 : 0.3);
    if (heavy) outline(g, x0, z0, x1, z1, y + ph - 0.4, y + ph + 0.12, 0.25, { ...k.plain, color: shade(k.wallCol, 1.06) });
    if (k.has('ornament')) cornice(g, x0, z0, x1, z1, y + ph + 0.1, opts.big ? 1.3 : 0.9, k.trim);
    const ins = heavy ? 0.6 : 0.35;
    if (green && w > 4 && d > 4) {
      g.flat(x0 + ins, z0 + ins, x1 - ins, z1 - ins, y + 0.22, k.planted);
      const n = Math.min(6, Math.floor((w * d) / 40));
      for (let i = 0; i < n; i++) g.prop({ kind: 'bush', x: r.range(x0 + 1.2, x1 - 1.2), y: y + 0.22, z: r.range(z0 + 1.2, z1 - 1.2), rot: r.next() * 6, scale: r.range(0.5, 0.9) });
    }
    if (k.has('roofGarden') && w > 8 && d > 8) {
      // Trees and a pergola on the roof.
      const n = Math.min(4, Math.floor((w * d) / 90));
      for (let i = 0; i < n; i++) {
        const tx = r.range(x0 + 2, x1 - 2), tz = r.range(z0 + 2, z1 - 2);
        g.box(tx - 0.9, tz - 0.9, tx + 0.9, tz + 0.9, y, y + 0.6, k.planter, k.planted);
        g.prop({ kind: 'tree', x: tx, y: y + 0.6, z: tz, rot: r.next() * 6, scale: r.range(0.45, 0.7), variant: r.int(0, 1) });
      }
      const px = x0 + w * 0.6, pz = z0 + d * 0.25;
      for (const [dx, dz] of [[0, 0], [3, 0], [0, 2.5], [3, 2.5]]) g.box(px + dx - 0.08, pz + dz - 0.08, px + dx + 0.08, pz + dz + 0.08, y, y + 2.4, k.trim, null);
      for (let i = 0; i <= 5; i++) g.box(px + i * 0.6 - 0.04, pz - 0.1, px + i * 0.6 + 0.04, pz + 2.6, y + 2.4, y + 2.55, k.trim, k.trim);
    }
    if (k.has('solarSkin') && !green && w > 6 && d > 6) {
      const pm: Mat = { color: hex(0x24313f), pattern: P.SOLAR, seed: k.ss };
      for (let z = z0 + 1; z + 1.4 < z1 - 0.8; z += 2.1) g.quad([x1 - 1, y + 0.3, z], [x0 + 1, y + 0.3, z], [x0 + 1, y + 0.95, z + 1.4], [x1 - 1, y + 0.95, z + 1.4], [0, 0.91, -0.42], pm, [[x1, z], [x0, z], [x0, z + 1.4], [x1, z + 1.4]]);
    } else if (!green && !k.has('roofGarden') && w > 7 && d > 6) {
      airHandler(g, x0 + w * 0.2, z0 + d * 0.55, y, Math.min(3, w * 0.25), 1.6, 1.2, k.ss);
    }
    if (k.has('windCrown') && w > 8) windCrown(g, x0 + 1, z0 + d * 0.5 - 0.5, x1 - 1, z0 + d * 0.5 + 0.5, y, k, Math.min(3, Math.floor(w / 6)));
    return y + ph;
  };
  switch (kind) {
    case 'gable':
    case 'hip': {
      const alongX = w >= d;
      const rise = Math.min(4.5, Math.min(w, d) * (k.look.axes.hand > 0.3 ? 0.36 : 0.28));
      if (kind === 'hip') g.hip(x0, z0, x1, z1, y, rise, k.roof, 0.45);
      else g.gable(x0, z0, x1, z1, y, rise, alongX, k.roof, { ...end, fh: 25, bay: alongX ? d : w }, 0.45);
      outline(g, x0 - 0.4, z0 - 0.4, x1 + 0.4, z1 + 0.4, y - 0.32, y - 0.08, 0.04, k.trim, kind === 'hip' || alongX ? [true, kind === 'hip', true, kind === 'hip'] : [false, true, false, true]);
      return y + rise;
    }
    case 'mansard': {
      const rise = Math.min(3.2, k.fh * 1.0);
      if (k.has('ornament')) cornice(g, x0, z0, x1, z1, y, 0.9, k.trim);
      const top = mansard(g, x0, z0, x1, z1, y, rise, Math.min(1.4, Math.min(w, d) * 0.18), k.roof, k.membrane);
      // Dormers along the street side.
      const n = Math.max(1, Math.round(w / Math.max(3.2, k.bay * 1.6)));
      for (let i = 0; i < n && w > 6; i++) {
        const cx = x0 + (w * (i + 0.5)) / n;
        g.box(cx - 0.6, z0 + 0.15, cx + 0.6, z0 + 1.1, y + 0.3, y + 2.0, k.wall(y + 0.3 - k.fh * 0.12, k.wallCol), k.roof, { sides: [true, true, false, true] });
      }
      return top;
    }
    case 'butterfly':
      return butterfly(g, x0, z0, x1, z1, y, Math.min(2.4, d * 0.16), k.roof, end);
    case 'shed':
      return shed(g, x0, z0, x1, z1, y, Math.min(3.4, d * 0.24), k.roof, end);
    case 'vault':
      return vault(g, x0, z0, x1, z1, y, Math.min(3.6, d * 0.24), k.roof, end);
    case 'green':
      return flatTop(true);
    default:
      return flatTop(k.has('greenRoof'));
  }
}

// ── Houses ──────────────────────────────────────────────────────────────────

const DOORS = [0x6e2a26, 0x23384f, 0x2f4a3a, 0x1e1f21, 0x7a5a3a, 0x5a2f40];

function house(g: GeoBuilder, b: GenInput, r: Rng, k: Kit): void {
  const { w, d } = b;
  const a = k.look.axes;
  const s = k.ss;
  const floors = Math.max(1, Math.min(2, b.floors));
  const garage = r.chance(0.55) && w >= 16;
  const bw = Math.min(w - (garage ? 7.5 : 4), r.range(9, 12) + b.level * 1.2 + (a.dense < -0.2 ? 1.5 : 0));
  const bd = Math.min(d - 12, r.range(8, 10.5) + b.level * 0.8);
  const setback = r.range(5.5, 7.5);
  const side = r.chance(0.5) ? 1 : -1;
  const off = garage ? -side * 2 : r.range(-0.8, 0.8);
  const x0 = off - bw / 2, x1 = off + bw / 2, z0 = setback, z1 = setback + bd;
  const fh = Math.min(3.3, k.fh);
  const plinth = a.heavy > 0.3 || k.look.base === 'stone' ? 0.6 : 0.4;
  const lift = k.has('pilotis') ? 2.7 : 0;
  g.box(x0 - 0.12, z0 - 0.12, x1 + 0.12, z1 + 0.12, 0, plinth, { color: hex(k.look.baseColor), pattern: P.STONE, seed: s, fh: 30 }, null);
  let top = plinth + lift + floors * fh;
  if (lift) {
    // Lifted on columns: a small glazed entrance under, a carport beside it.
    const col: Mat = k.look.wall === 'beton' ? { color: k.wallCol, pattern: P.CONCRETE, seed: s } : k.trim;
    for (const [cx, cz] of [[x0 + 0.4, z0 + 0.4], [x1 - 0.4, z0 + 0.4], [x0 + 0.4, z1 - 0.4], [x1 - 0.4, z1 - 0.4], [(x0 + x1) / 2, z0 + 0.4], [(x0 + x1) / 2, z1 - 0.4]] as [number, number][]) g.box(cx - 0.18, cz - 0.18, cx + 0.18, cz + 0.18, plinth, plinth + lift, col, null);
    g.box(x0 + 2, z0 + 2, x0 + bw * 0.45, z1 - 1.5, plinth, plinth + lift, { color: hex(0x3e4a52), pattern: P.GLASS, seed: k.s, fh: lift, bay: 1.4 }, null);
    g.quad([x0, plinth + lift, z0], [x1, plinth + lift, z0], [x1, plinth + lift, z1], [x0, plinth + lift, z1], [0, -1, 0], k.plain, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  const y0 = plinth + lift;
  if (floors === 2 && k.has('cantilever')) {
    // Upper floor slides out over the garden and the street side.
    const shift = r.range(1.2, 2.0);
    g.box(x0, z0, x1, z1, y0, y0 + fh, k.wall(y0), null);
    const ux0 = x0 + side * 1.5, ux1 = x1 + side * 1.5;
    g.box(ux0, z0 - shift, ux1, z1 - shift * 0.3, y0 + fh, y0 + 2 * fh, k.wall(y0, mixRGB(k.wallCol, hex(0x2b2c2e), a.hand < 0 ? 0.0 : 0.15)), null);
    g.quad([ux0, y0 + fh, z0 - shift], [ux1, y0 + fh, z0 - shift], [ux1, y0 + fh, z0], [ux0, y0 + fh, z0], [0, -1, 0], k.trim, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    top = roofOver(g, k, r, ux0, z0 - shift, ux1, z1 - shift * 0.3, y0 + 2 * fh, { kind: k.look.roof === 'gable' || k.look.roof === 'hip' ? 'flat' : k.look.roof });
    g.flat(x0, z0, x1, z1, y0 + fh, k.membrane);
  } else if (floors === 2 && k.has('terraces')) {
    // The upper floor steps back; its terrace is planted along the edge.
    const back = Math.min(3, bd * 0.3);
    g.box(x0, z0, x1, z1, y0, y0 + fh, k.wall(y0), null);
    g.flat(x0, z0, x1, z0 + back, y0 + fh, { color: hex(0x9a8b74), pattern: P.WOOD, seed: s, fh: 3, bay: 1 });
    g.box(x0, z0, x1, z0 + 0.5, y0 + fh, y0 + fh + 0.55, k.planter, k.planted);
    for (let i = 0; i < 3; i++) g.prop({ kind: 'bush', x: x0 + bw * (0.2 + 0.3 * i), y: y0 + fh + 0.55, z: z0 + 0.25, rot: i, scale: 0.6 });
    g.box(x0, z0 + back, x1, z1, y0 + fh, y0 + 2 * fh, k.wall(y0), null);
    top = roofOver(g, k, r, x0, z0 + back, x1, z1, y0 + 2 * fh);
  } else {
    g.box(x0, z0, x1, z1, y0, y0 + floors * fh, k.wall(y0), null);
    top = roofOver(g, k, r, x0, z0, x1, z1, y0 + floors * fh);
  }
  if (k.has('ornament')) {
    quoins(g, x0, z0, x1, z1, y0, y0 + floors * fh - 0.2, k);
    outline(g, x0, z0, x1, z1, y0 + fh - 0.12, y0 + fh + 0.1, 0.08, k.trim, [true, true, false, true]);
  }
  if (k.has('solarSkin') && (k.look.roof === 'gable' || k.look.roof === 'hip')) solarSkin(g, face(1, x0, z0, x1, z1), y0, y0 + floors * fh, k);
  // Entrance.
  const px = off + r.range(-bw * 0.18, bw * 0.18);
  const leaf: Mat = { color: hex(a.hand < -0.3 ? 0x2b2c2e : r.pick(DOORS)), pattern: P.DOOR, seed: s };
  if (k.has('ornament')) pediment(g, px, z0, plinth + 2.5, 2.4, k);
  else canopy(g, px - 1.2, px + 1.2, z0, plinth + 2.4, 1.3, a.heavy > 0.3 ? 0.4 : 0.14, a.heavy > 0.3 ? k.plain : k.trim, k.has('ornament') ? k.trim : null);
  if (!lift) door(g, px, z0, plinth, 1.0, 2.15, leaf, k.trim);
  g.box(px - 1.1, z0 - 1.3, px + 1.1, z0, 0, plinth, CONC(s), PAVE(s), { sides: [true, true, false, true] });
  g.ground(px - 0.6, 0, px + 0.6, z0 - 1.3, PAVE(s), 0.045);
  // Garage or driveway.
  if (garage) {
    const gx0 = side > 0 ? x1 : x0 - 4, gx1 = side > 0 ? x1 + 4 : x0;
    const gz0 = z0 + 0.8, gz1 = gz0 + 6.5;
    g.box(gx0, gz0, gx1, gz1, 0, 2.9, k.plain, null, { sides: [true, side > 0, true, side < 0] });
    door(g, (gx0 + gx1) / 2, gz0, 0.05, 2.9, 2.2, { color: shade(k.wallCol, 0.85), pattern: P.DOOR, seed: s }, k.trim);
    roofOver(g, k, r, gx0, gz0, gx1, gz1, 2.9, { kind: k.look.roof === 'mansard' || k.look.roof === 'vault' ? 'flat' : k.look.roof });
    g.ground(gx0 + 0.3, 0, gx1 - 0.3, gz0, CONC(s), 0.05);
    if (r.chance(0.55)) g.prop({ kind: 'car', x: (gx0 + gx1) / 2, y: 0.05, z: gz0 * 0.45, rot: Math.PI / 2, variant: r.pick([VM.sedan, VM.suv, VM.hatchback]), color: r.pick(CAR_COLORS) });
  } else {
    const dx = side > 0 ? x1 + 0.8 : x0 - 3.6;
    g.ground(dx, 0, dx + 2.8, z0 + 4, CONC(s), 0.05);
    if (r.chance(0.5)) g.prop({ kind: 'car', x: dx + 1.4, y: 0.05, z: 3.2, rot: Math.PI / 2, variant: r.pick([VM.sedan, VM.hatchback]), color: r.pick(CAR_COLORS) });
  }
  // Garden: greener movements plant more.
  if (r.chance(0.7)) fence(g, -w / 2 + 0.2, z1 + 1, w / 2 - 0.2, d - 0.2, r.range(1.1, 1.6), a.heavy > 0.3 ? shade(k.wallCol, 0.9) : hex(r.pick([0xcdb69a, 0xe8e6e0, 0x6b5a48])), [false, true, true, true]);
  const green = 1 + Math.max(0, a.green) * 3;
  trees(g, r, Math.round(r.int(1, 2) * green), -w / 2 + 1.5, z1 + 2, w / 2 - 1.5, d - 1.5, undefined, 0.95);
  if (r.chance(0.5 + 0.3 * Math.max(0, a.green))) trees(g, r, 1, -w / 2 + 1.5, 1.5, w / 2 - 1.5, z0 - 2.5, [x0, z0, x1, z1], 0.85);
  bushes(g, r, Math.max(2, Math.floor((bw / 2.2) * (1 + Math.max(0, a.green)))), x0 + 0.5, x1 - 0.5, z0 - 0.8);
  void top;
}

// ── Row houses ──────────────────────────────────────────────────────────────

function townhouse(g: GeoBuilder, b: GenInput, r: Rng, k: Kit): void {
  const { w, d } = b;
  const a = k.look.axes;
  const s = k.ss;
  const n = Math.max(2, Math.floor((w - 1) / 6.2));
  const uw = (w - 1) / n;
  const zb = r.range(3, 4.5);
  const bd = Math.min(d - 8, r.range(10, 12.5));
  const base = a.heavy > 0.3 ? 0.9 : 0.7;
  const fh = k.fh;
  const vary = a.hand > 0.2 || a.ornate > 0.3;
  const heights: number[] = [];
  for (let i = 0; i < n; i++) heights.push(base + Math.max(2, b.floors + (vary && r.chance(0.25) ? 1 : 0)) * fh);
  const roofKind: RoofKind = k.look.roof === 'gable' || k.look.roof === 'hip' ? 'gable' : k.look.roof;
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 + 0.5 + i * uw, x1 = x0 + uw;
    const col = hex(k.look.wallColors[(i + (b.seed & 3)) % k.look.wallColors.length]);
    const h = heights[i];
    const wallM = k.wall(base, col);
    const plain: Mat = { color: col, pattern: P.TRIM, seed: s };
    const ends: [boolean, boolean, boolean, boolean] = [true, i === n - 1, true, i === 0];
    g.box(x0, zb, x1, zb + bd, 0, base, { color: hex(k.look.baseColor), pattern: P.STONE, seed: s, fh: 30 }, null, { sides: ends });
    const upper = k.has('cantilever') ? 0.8 : 0;
    if (upper) {
      g.box(x0, zb, x1, zb + bd, base, base + fh, wallM, null, { sides: ends });
      g.box(x0, zb - upper, x1, zb + bd, base + fh, h, wallM, null, { sides: ends });
      g.quad([x0, base + fh, zb - upper], [x1, base + fh, zb - upper], [x1, base + fh, zb], [x0, base + fh, zb], [0, -1, 0], k.trim, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    } else g.box(x0, zb, x1, zb + bd, base, h, wallM, null, { sides: ends });
    const fz = zb - upper;
    // Exposed party walls where a house rises above its neighbour.
    if (i > 0 && heights[i - 1] < h) g.wall(x0, fz, x0, zb + bd, heights[i - 1], h, plain);
    if (i < n - 1 && heights[i + 1] < h) g.wall(x1, zb + bd, x1, fz, heights[i + 1], h, plain);
    const unitKit = { ...k, wallCol: col, plain };
    if (roofKind === 'gable') {
      g.gable(x0, fz, x1, zb + bd, h, Math.min(3.2, bd * 0.24), true, k.roof, { ...plain, fh: 25 }, 0.05);
      outline(g, x0, fz, x1, zb + bd, h - 0.25, h, 0.12, k.trim, [true, false, true, false]);
    } else roofOver(g, unitKit, r, x0, fz, x1, zb + bd, h, { kind: roofKind });
    if (k.has('ornament')) {
      outline(g, x0, fz, x1, zb + bd, base + fh - 0.15, base + fh + 0.05, 0.08, k.trim, [true, false, false, false]);
      pediment(g, x0 + uw * 0.3, zb, base + 2.5, 1.7, k);
    }
    // Window boxes of planting under the upper windows.
    if (k.has('planters')) {
      const bays = Math.max(1, Math.round(uw / k.bay));
      for (let y = base + fh; y < h - 1; y += fh) {
        for (let j = 0; j < bays; j++) {
          const cx = x0 + (uw * (j + 0.5)) / bays;
          g.box(cx - 0.55, fz - 0.4, cx + 0.55, fz, y + fh * 0.22, y + fh * 0.3, plain, k.planted, { sides: [true, true, false, true] });
        }
      }
    }
    if (k.has('loggias') || k.has('terraces')) faceBalcony(g, face(0, x0, fz, x1, zb + bd), uw * 0.15, uw * 0.85, base + fh * 2, 1.2, unitKit, r, k.has('terraces'), k.has('loggias'));
    // Stoop and door.
    const dcx = x0 + uw * (i % 2 ? 0.3 : 0.72);
    g.box(dcx - 0.8, zb - 1.6, dcx + 0.8, zb, 0, base, { color: hex(k.look.baseColor), pattern: P.STONE, seed: s, fh: 30 }, PAVE(s), { sides: [true, true, false, true] });
    door(g, dcx, zb, base, 1.0, 2.25, { color: hex(a.hand < -0.3 ? 0x2b2c2e : r.pick(DOORS)), pattern: P.DOOR, seed: s }, k.trim);
    g.ground(dcx - 0.5, 0, dcx + 0.5, zb - 1.6, PAVE(s), 0.045);
    if (i % 2 === 0) bushes(g, r, 2 + Math.round(Math.max(0, a.green) * 2), x0 + 0.6, x0 + uw * 0.5, zb - 0.9);
  }
  const back = zb + bd;
  if (d - back > 7) {
    parking(g, r, -w / 2 + 1, d - 6.5, w / 2 - 1, d - 0.5, 0.5, s);
    fence(g, -w / 2 + 0.2, back + 0.5, w / 2 - 0.2, d - 7, 1.4, hex(0xb59f84), [false, true, true, true]);
  }
  trees(g, r, Math.floor(n / 2) + Math.round(Math.max(0, a.green) * n), -w / 2 + 2, back + 1.5, w / 2 - 2, Math.max(back + 2, d - 8), undefined, 0.9);
}

// ── Blocks: apartments, shops, mixed use and offices ───────────────────────

type BlockUse = 'homes' | 'shop' | 'mixed' | 'office';

/** One volume of a block: footprint, height range and the floor its facade counts from. */
interface Vol {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y0: number;
  y1: number;
  /** Visible faces (the others touch another volume). */
  sides: [boolean, boolean, boolean, boolean];
}

function block(g: GeoBuilder, b: GenInput, r: Rng, k: Kit, use: BlockUse): void {
  const { w, d } = b;
  const a = k.look.axes;
  const s = k.ss;
  const fh = use === 'office' ? Math.max(3.6, k.fh + 0.5) : k.fh;
  const small = use === 'shop';
  const floors = small ? Math.max(1, Math.min(2, b.floors)) : Math.max(use === 'office' ? 3 : 3, b.floors);
  const setback = small ? r.range(0.6, 2) : use === 'mixed' ? 0.8 : r.range(3.5, 6);
  const bw = small ? Math.min(w - 1.5, r.range(10, 16)) : use === 'mixed' ? w - 1 : w - r.range(3, 5);
  const rear = !small && d > 30 ? r.range(7, 11) : 0;
  const bd = small ? Math.min(d - 4, r.range(11, 16)) : Math.max(10, Math.min(use === 'mixed' ? 22 : 40, d - setback - rear - 2));
  const sx = small ? (r.chance(0.5) ? -w / 2 + 0.6 + bw / 2 : w / 2 - 0.6 - bw / 2) : 0;
  const X0 = sx - bw / 2, X1 = sx + bw / 2, Z0 = setback, Z1 = setback + bd;
  const shops = use === 'shop' || use === 'mixed' || (use === 'homes' && b.level >= 2 && r.chance(0.35));
  const arcade = shops && k.has('arcade') && !small;
  const lift = !shops && (k.has('pilotis') || k.look.massing === 'slab') && floors >= 3 ? 3.4 : 0;
  const gh = shops ? 4.3 : lift ? lift : fh + 0.4;
  const bodyTop = gh + (floors - 1) * fh;
  // Massing.
  const vols: Vol[] = [];
  const all: [boolean, boolean, boolean, boolean] = [true, true, true, true];
  let massing = small ? 'block' : k.look.massing;
  if (massing === 'courtyard' && (bd < 22 || bw < 24)) massing = 'block';
  if (massing === 'terraced' && floors < 3) massing = 'block';
  if (massing === 'stacked' && floors < 4) massing = 'block';
  if (massing === 'courtyard') {
    const wing = Math.min(9, bw * 0.3);
    vols.push({ x0: X0, z0: Z0, x1: X1, z1: Z0 + wing, y0: gh, y1: bodyTop, sides: all });
    vols.push({ x0: X0, z0: Z0 + wing, x1: X0 + wing, z1: Z1, y0: gh, y1: bodyTop, sides: [false, true, true, true] });
    vols.push({ x0: X1 - wing, z0: Z0 + wing, x1: X1, z1: Z1, y0: gh, y1: bodyTop, sides: [false, true, true, true] });
    // The shared garden.
    const gx0 = X0 + wing + 1, gx1 = X1 - wing - 1, gz0 = Z0 + wing + 1;
    g.ground(gx0, gz0, gx1, Z1, { color: hex(0x5f7a3c), pattern: P.PLANTED, seed: s }, 0.08);
    g.ground((gx0 + gx1) / 2 - 0.8, gz0, (gx0 + gx1) / 2 + 0.8, Z1, PAVE(s), 0.1);
    trees(g, r, Math.min(6, Math.round(((gx1 - gx0) * (Z1 - gz0)) / 45)), gx0 + 1, gz0 + 1, gx1 - 1, Z1 - 1, undefined, 0.8);
  } else if (massing === 'terraced') {
    // Every couple of floors the front steps back; each step is a planted terrace.
    const per = floors > 6 ? 2 : 1;
    let y = gh, z0 = Z0, z1 = Z1;
    for (let f = 1; f < floors; f += per) {
      const n = Math.min(per, floors - f);
      vols.push({ x0: X0, z0, x1: X1, z1, y0: y, y1: y + n * fh, sides: all });
      y += n * fh;
      const step = Math.min(2.6, (z1 - z0 - 6) / Math.max(1, (floors - f) / per));
      if (step < 1) break;
      z0 += step;
      z1 -= step * 0.25;
    }
  } else if (massing === 'stacked') {
    // Boxes stacked with offsets, a couple of floors each.
    let y = gh;
    let f = 1;
    while (f < floors) {
      const n = Math.min(2, floors - f);
      const dx = (r.next() - 0.5) * Math.min(5, bw * 0.15), dz = (r.next() - 0.5) * Math.min(3, bd * 0.15);
      const sw = bw * r.range(0.75, 0.95), sd = bd * r.range(0.8, 0.95);
      const cx = (X0 + X1) / 2 + dx, cz = (Z0 + Z1) / 2 + dz;
      vols.push({ x0: Math.max(X0 - 1.5, cx - sw / 2), z0: Math.max(Z0 - 1, cz - sd / 2), x1: Math.min(X1 + 1.5, cx + sw / 2), z1: cz + sd / 2, y0: y, y1: y + n * fh, sides: all });
      y += n * fh;
      f += n;
    }
  } else {
    vols.push({ x0: X0, z0: Z0, x1: X1, z1: Z1, y0: gh, y1: bodyTop, sides: all });
  }
  // Cantilever: the top two floors reach out over the street.
  if (k.has('cantilever') && massing === 'block' && floors >= 4 && !small) {
    const v = vols[0];
    const cut = v.y1 - 2 * fh;
    vols[0] = { ...v, y1: cut };
    vols.push({ ...v, z0: v.z0 - 2.2, y0: cut, y1: v.y1 });
  }
  // Ground floor.
  const base = vols[0];
  const g0 = { x0: massing === 'courtyard' ? X0 : base.x0, z0: Z0, x1: massing === 'courtyard' ? X1 : base.x1, z1: massing === 'courtyard' ? Z0 + Math.min(9, bw * 0.3) : base.z1 };
  if (lift) {
    // Pilotis: the block stands on columns; a small glazed lobby underneath.
    const col: Mat = k.look.wall === 'beton' || a.heavy > 0.2 ? { color: shade(k.wallCol, 0.95), pattern: P.CONCRETE, seed: s } : k.trim;
    const nx = Math.max(2, Math.round((g0.x1 - g0.x0) / 6));
    for (let i = 0; i <= nx; i++) {
      const cx = g0.x0 + 0.5 + ((g0.x1 - g0.x0 - 1) * i) / nx;
      for (const cz of [g0.z0 + 0.6, g0.z1 - 0.6]) g.box(cx - 0.3, cz - 0.3, cx + 0.3, cz + 0.3, 0, lift, col, null);
    }
    const lx = (g0.x0 + g0.x1) / 2;
    g.box(lx - 4, g0.z0 + 2.5, lx + 4, g0.z1 - 2.5, 0, lift, { color: hex(0x3e4a52), pattern: P.GLASS, seed: k.s, fh: lift, bay: 1.6 }, null);
    g.quad([g0.x0, lift, g0.z0], [g0.x1, lift, g0.z0], [g0.x1, lift, g0.z1], [g0.x0, lift, g0.z1], [0, -1, 0], k.plain, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  } else if (arcade) {
    // Arcade: a colonnade along the street, the shopfronts set back behind it.
    const depth = 2.6;
    g.box(g0.x0, g0.z0 + depth, g0.x1, g0.z1, 0, gh, { color: hex(0x3e4246), pattern: P.STORE, seed: k.s, fh: gh, bay: 4.2 }, null);
    const n = Math.max(2, Math.round((g0.x1 - g0.x0) / 4));
    const colM: Mat = a.heavy > 0.3 ? { color: shade(k.wallCol, 0.95), pattern: P.CONCRETE, seed: s } : { color: hex(k.look.baseColor), pattern: P.STONE, seed: s, fh: 30 };
    for (let i = 0; i <= n; i++) {
      const cx = g0.x0 + 0.35 + ((g0.x1 - g0.x0 - 0.7) * i) / n;
      g.box(cx - 0.35, g0.z0, cx + 0.35, g0.z0 + 0.7, 0, gh, colM, null);
    }
    g.quad([g0.x0, gh, g0.z0], [g0.x1, gh, g0.z0], [g0.x1, gh, g0.z0 + depth], [g0.x0, gh, g0.z0 + depth], [0, -1, 0], k.trim, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    g.wall(g0.x1, g0.z0, g0.x0, g0.z0, gh - 0.9, gh, colM);
    g.ground(g0.x0, g0.z0, g0.x1, g0.z0 + depth, { color: hex(0xb8b0a2), pattern: P.PAVING, seed: s }, 0.06);
  } else if (shops) {
    g.box(g0.x0, g0.z0, g0.x1, g0.z1, 0, gh, { color: hex(a.hand < -0.3 ? 0x2f3236 : 0x3e4246), pattern: P.STORE, seed: k.s, fh: gh, bay: 4.4 }, null);
    // Signs, and awnings for the handmade and ornate; a clean fascia for the rest.
    const units = Math.max(1, Math.round((g0.x1 - g0.x0) / 8));
    const uw = (g0.x1 - g0.x0) / units;
    for (let i = 0; i < units; i++) {
      const ux0 = g0.x0 + i * uw;
      g.wall(ux0 + uw - 0.4, g0.z0 - 0.08, ux0 + 0.4, g0.z0 - 0.08, gh - 1.0, gh - 0.4, { color: hex(r.pick([k.look.accent, 0xf2efe6, 0x2b2b2b])), pattern: P.SIGN, seed: s + i, bay: uw });
      if (a.hand + a.ornate > 0.1) awning(g, ux0 + 0.5, ux0 + uw - 0.5, g0.z0, gh - 1.1, 1.5, 0.6, r.chance(0.5) ? k.accent : hex(r.pick(k.look.wallColors)), s + i);
    }
    canopy(g, g0.x0, g0.x1, g0.z0, gh - 0.35, a.hand + a.ornate > 0.1 ? 0.25 : 1.4, 0.3, k.trim);
  } else {
    g.box(g0.x0, g0.z0, g0.x1, g0.z1, 0, gh, k.base(0), null);
    const ex = (g0.x0 + g0.x1) / 2 + r.range(-2, 2);
    door(g, ex, g0.z0, 0.05, 1.8, 2.5, { color: hex(0x3a3f44), pattern: P.GLASS, seed: k.s, fh: 2.5, bay: 0.9 }, k.trim);
    if (k.has('ornament')) pediment(g, ex, g0.z0, 2.9, 3.2, k);
    else canopy(g, ex - 1.9, ex + 1.9, g0.z0, 2.95, 1.6, a.heavy > 0.3 ? 0.5 : 0.22, a.heavy > 0.3 ? k.plain : { color: hex(0x45494d), pattern: P.METAL, seed: s });
  }
  if (!lift) outline(g, g0.x0, g0.z0, g0.x1, g0.z1, gh - 0.3, gh, arcade ? 0.05 : 0.14, k.has('monumental') ? k.plain : k.trim);
  if (massing === 'courtyard' && !lift) {
    // The side wings come down to the ground too.
    for (const v of vols.slice(1)) g.box(v.x0, v.z0, v.x1, v.z1, 0, gh, k.base(0), null, { sides: [false, true, true, true] });
  }
  // Upper volumes, their roofs and terraces.
  let topY = 0;
  const glassy = k.look.wall === 'glass';
  vols.forEach((v, i) => {
    g.box(v.x0, v.z0, v.x1, v.z1, v.y0, v.y1, k.wall(gh), null, { sides: v.sides });
    const next = vols[i + 1];
    const isTop = !next || next.y0 > v.y1 + 0.01 || massing === 'courtyard';
    if (massing === 'terraced' && next) {
      // The terrace in front of the next step back: decking and a planted edge.
      g.flat(v.x0, v.z0, v.x1, next.z0, v.y1, { color: hex(0x9a8b74), pattern: P.WOOD, seed: s, fh: 3, bay: 1 });
      // Planter along the terrace's outer edge.
      const step = next.z0 - v.z0;
      faceBox(g, face(0, next.x0, next.z0, next.x1, next.z1), 0, next.x1 - next.x0, step - 0.6, step, v.y1, v.y1 + 0.6, k.planter, k.planted);
      const nb = Math.max(1, Math.floor((v.x1 - v.x0) / 5));
      for (let j = 0; j < nb; j++) g.prop({ kind: r.chance(0.35) ? 'tree' : 'bush', x: v.x0 + ((v.x1 - v.x0) * (j + 0.5)) / nb, y: v.y1 + 0.6, z: v.z0 + 0.3, rot: j, scale: r.range(0.45, 0.75), variant: 0 });
      g.flat(v.x0, next.z1, v.x1, v.z1, v.y1, k.membrane);
    } else if (massing === 'stacked' && next) {
      // Where the next box doesn't cover this one, the roof is a planted or decked terrace.
      g.flat(v.x0, v.z0, v.x1, v.z1, v.y1, a.green > 0 ? k.planted : { color: hex(0x9a8b74), pattern: P.WOOD, seed: s, fh: 3, bay: 1 });
    } else if (isTop) {
      topY = Math.max(topY, roofOver(g, k, r, v.x0, v.z0, v.x1, v.z1, v.y1, { big: !small }));
    }
    if (next && next.z0 < v.z0 - 0.1) {
      // Soffit under a cantilevered volume.
      g.quad([next.x0, v.y1, next.z0], [next.x1, v.y1, next.z0], [next.x1, v.y1, v.z0], [next.x0, v.y1, v.z0], [0, -1, 0], k.trim, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
  });
  // Facade features on the street face of each volume.
  for (const v of vols) {
    const F = face(0, v.x0, v.z0, v.x1, v.z1);
    const bays = Math.max(1, Math.round(F.len / k.bay));
    const bayW = F.len / bays;
    if (k.has('briseSoleil') && !small) {
      finGrid(g, F, v.y0, v.y1, k, glassy ? 0.5 : 0.7);
      if (v.y1 - v.y0 > 10) finGrid(g, face(1, v.x0, v.z0, v.x1, v.z1), v.y0, v.y1, k, 0.6);
    } else if (use !== 'office' && (k.has('planters') || k.has('loggias') || k.has('balconies') || (use === 'homes' && !k.look.explicit && a.green + a.heavy > -0.4))) {
      // Balconies: planted for green movements, framed loggias for heavy ones, plain otherwise.
      const planted = k.has('planters');
      const pattern = planted ? 'all' : r.pick(['pairs', 'alternate']);
      for (let y = v.y0 + (v === vols[0] ? fh : 0); y <= v.y1 - fh + 0.1; y += fh) {
        for (let j = 0; j < bays; j++) {
          const on = pattern === 'all' ? true : pattern === 'pairs' ? j % 3 === 0 && j + 1 < bays : j % 2 === 0;
          if (!on) continue;
          const span = pattern === 'pairs' ? 2 : 1;
          faceBalcony(g, F, j * bayW + 0.3, (j + span) * bayW - 0.3, y + 0.02, planted ? 1.1 : 1.3, k, r, planted, k.has('loggias'));
        }
      }
    }
    if (k.has('solarSkin')) solarSkin(g, face(3, v.x0, v.z0, v.x1, v.z1), v.y0, v.y1, k);
    if (k.has('ornament') && !small) {
      for (let y = v.y0 + fh; y < v.y1 - 0.5; y += fh * 2) outline(g, v.x0, v.z0, v.x1, v.z1, y - 0.1, y + 0.08, 0.07, k.trim, [true, v.sides[1], false, v.sides[3]]);
      quoins(g, v.x0, v.z0, v.x1, v.z1, v.y0, v.y1 - 0.2, k);
    }
    if (k.has('monumental') && !small) piers(g, v.x0, v.x1, v.z0, v.y0, v.y1, Math.max(2, Math.round(F.len / 7)), 0.9, 0.45, { ...k.plain, color: shade(k.wallCol, 1.05) });
  }
  // Office plant screen.
  if (use === 'office' && vols.length === 1 && k.look.roof !== 'green' && !k.has('roofGarden')) {
    const v = vols[0], ins = Math.min(v.x1 - v.x0, v.z1 - v.z0) * 0.22;
    g.box(v.x0 + ins, v.z0 + ins, v.x1 - ins, v.z1 - ins, v.y1, v.y1 + 3, { color: hex(0x9a9993), pattern: P.LOUVRE, seed: s, fh: 3, bay: 1 }, k.membrane);
  }
  // The lot.
  if (rear > 0 && massing !== 'courtyard') parking(g, r, -w / 2 + 1, d - rear + 0.5, w / 2 - 1, d - 0.5, 0.6, s);
  if (small) {
    const free = w - bw - 1.2;
    if (free > 6) parking(g, r, sx < 0 ? X1 + 0.6 : -w / 2 + 0.6, 0.8, sx < 0 ? w / 2 - 0.6 : X0 - 0.6, d - 1, 0.5, s);
  }
  const green = 1 + Math.max(0, a.green) * 2.5;
  if (!small && setback > 2) {
    trees(g, r, Math.round(r.int(2, 3) * green), -w / 2 + 1.5, 0.8, w / 2 - 1.5, setback - 1.5, [-3, 0, 3, setback], 0.85);
    bushes(g, r, Math.floor((bw / 3) * green), X0 + 1, X1 - 1, Z0 - 0.7);
  }
  void topY;
}

// ── Towers ──────────────────────────────────────────────────────────────────

type TowerUse = 'homes' | 'office' | 'hotel';

function tower(g: GeoBuilder, b: GenInput, r: Rng, k: Kit, use: TowerUse): void {
  const { w, d } = b;
  const a = k.look.axes;
  const s = k.ss;
  const fh = use === 'office' ? Math.max(3.7, k.fh + 0.6) : k.fh;
  const floors = Math.max(use === 'office' ? 12 : 8, b.floors);
  const podiumH = 2 * 4.2;
  const pw = w - 4, pd = Math.min(d - 6, 30);
  const pz0 = 3, px0 = -pw / 2, px1 = pw / 2, pz1 = pz0 + pd;
  // Podium: shops or a lobby (or an arcade), its roof a terrace.
  if (k.has('arcade')) {
    g.box(px0, pz0 + 2.8, px1, pz1, 0, 4.2, { color: hex(0x3e4246), pattern: P.STORE, seed: k.s, fh: 4.2, bay: 4.5 }, null);
    const n = Math.max(3, Math.round(pw / 4.5));
    for (let i = 0; i <= n; i++) {
      const cx = px0 + 0.4 + ((pw - 0.8) * i) / n;
      g.box(cx - 0.4, pz0, cx + 0.4, pz0 + 0.8, 0, podiumH, { color: hex(k.look.baseColor), pattern: P.STONE, seed: s, fh: 30 }, null);
    }
    g.box(px0, pz0, px1, pz1, 4.2, podiumH, k.base(4.2), null);
    g.quad([px0, 4.2, pz0], [px1, 4.2, pz0], [px1, 4.2, pz0 + 2.8], [px0, 4.2, pz0 + 2.8], [0, -1, 0], k.trim, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  } else {
    g.box(px0, pz0, px1, pz1, 0, 4.2, { color: hex(a.hand < -0.3 ? 0x2f3236 : 0x3e4246), pattern: use === 'homes' ? P.STORE : P.GLASS, seed: k.s, fh: 4.2, bay: use === 'homes' ? 4.5 : 3 }, null);
    g.box(px0, pz0, px1, pz1, 4.2, podiumH, k.base(4.2), null);
  }
  outline(g, px0, pz0, px1, pz1, 4.0, 4.35, 0.25, k.trim);
  g.flat(px0, pz0, px1, pz1, podiumH, a.green > 0.2 ? k.planted : { color: hex(0xa79d8e), pattern: P.PAVING, seed: s });
  parapet(g, px0, pz0, px1, pz1, podiumH, 1.0, { ...k.plain, color: hex(k.look.baseColor) }, k.trim);
  canopy(g, -6, 6, pz0, 3.8, use === 'hotel' ? 6 : 2.4, 0.35, use === 'hotel' ? { color: k.accent, pattern: P.TRIM, seed: s } : { color: hex(0x3a3d40), pattern: P.METAL, seed: s });
  // Shaft.
  const tw = Math.min(pw - 4, r.range(17, 23) + (use === 'office' ? 3 : 0));
  const td = Math.min(pd - 4, r.range(16, 22));
  const tz0 = pz0 + (pd - td) / 2, tx0 = -tw / 2;
  const wallM = k.wall(podiumH);
  type Seg = { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; garden?: boolean };
  const segs: Seg[] = [];
  let y = podiumH;
  let ins = 0;
  const skyEvery = k.has('skyGarden') ? Math.max(6, Math.round(floors / 3)) : 0;
  const stepEvery = k.look.massing === 'terraced' ? Math.max(5, Math.round(floors / 4)) : k.look.massing === 'stacked' ? Math.max(4, Math.round(floors / 5)) : 0;
  let f = 0;
  while (f < floors) {
    let n = floors - f;
    if (skyEvery) n = Math.min(n, skyEvery);
    if (stepEvery) n = Math.min(n, stepEvery);
    let ox = 0, oz = 0;
    if (k.look.massing === 'stacked' && f > 0) {
      ox = (r.next() - 0.5) * 3;
      oz = (r.next() - 0.5) * 2;
    }
    segs.push({ x0: tx0 + ins + ox, z0: tz0 + ins + oz, x1: tx0 + tw - ins + ox, z1: tz0 + td - ins + oz, y0: y, y1: y + n * fh });
    y += n * fh;
    f += n;
    if (f < floors && skyEvery && f % skyEvery === 0) {
      // A sky garden: an open planted floor around the core.
      segs.push({ x0: tx0 + ins, z0: tz0 + ins, x1: tx0 + tw - ins, z1: tz0 + td - ins, y0: y, y1: y + fh * 1.4, garden: true });
      y += fh * 1.4;
    }
    if (k.look.massing === 'terraced' && f < floors) ins += Math.min(1.8, (Math.min(tw, td) * 0.3) / Math.max(1, floors / stepEvery));
  }
  segs.forEach((sg, i) => {
    if (sg.garden) {
      const core = 3.2;
      g.box(sg.x0 + core, sg.z0 + core, sg.x1 - core, sg.z1 - core, sg.y0, sg.y1, { color: hex(0x3e4a52), pattern: P.GLASS, seed: k.s, fh: sg.y1 - sg.y0, bay: 1.6 }, null);
      const col = a.heavy > 0.2 ? { color: shade(k.wallCol, 0.95), pattern: P.CONCRETE, seed: s } : k.trim;
      for (const [cx, cz] of [[sg.x0 + 0.4, sg.z0 + 0.4], [sg.x1 - 0.4, sg.z0 + 0.4], [sg.x0 + 0.4, sg.z1 - 0.4], [sg.x1 - 0.4, sg.z1 - 0.4]] as [number, number][]) g.box(cx - 0.4, cz - 0.4, cx + 0.4, cz + 0.4, sg.y0, sg.y1, col, null);
      g.flat(sg.x0, sg.z0, sg.x1, sg.z1, sg.y0 + 0.02, k.planted);
      g.quad([sg.x0, sg.y1, sg.z0], [sg.x1, sg.y1, sg.z0], [sg.x1, sg.y1, sg.z1], [sg.x0, sg.y1, sg.z1], [0, -1, 0], k.trim, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      for (const [tx, tz] of [[sg.x0 + 1.6, sg.z0 + 1.6], [sg.x1 - 1.6, sg.z0 + 1.6], [sg.x0 + 1.6, sg.z1 - 1.6], [sg.x1 - 1.6, sg.z1 - 1.6], [(sg.x0 + sg.x1) / 2, sg.z0 + 1.4]] as [number, number][]) {
        g.prop({ kind: 'tree', x: tx, y: sg.y0, z: tz, rot: tx, scale: 0.55, variant: 0 });
      }
      return;
    }
    g.box(sg.x0, sg.z0, sg.x1, sg.z1, sg.y0, sg.y1, wallM, null);
    const next = segs[i + 1];
    if (next && !next.garden && (next.x0 > sg.x0 + 0.1 || next.z0 > sg.z0 + 0.1 || next.x1 < sg.x1 - 0.1)) {
      // A setback terrace: planted for green movements.
      g.flat(sg.x0, sg.z0, sg.x1, sg.z1, sg.y1, a.green > 0 || k.has('terraces') ? k.planted : k.membrane);
      outline(g, sg.x0, sg.z0, sg.x1, sg.z1, sg.y1 - 0.3, sg.y1 + 0.5, 0.12, k.has('terraces') ? k.planter : k.trim);
      if (k.has('terraces')) for (let j = 0; j < 3; j++) g.prop({ kind: 'tree', x: sg.x0 + (sg.x1 - sg.x0) * (0.2 + 0.3 * j), y: sg.y1, z: sg.z0 + 0.9, rot: j, scale: 0.5, variant: 0 });
    } else if (next?.garden) {
      g.flat(sg.x0, sg.z0, sg.x1, sg.z1, sg.y1, k.membrane);
    }
    // Facade features on all four faces.
    for (const side of [0, 1, 2, 3] as Side[]) {
      const F = face(side, sg.x0, sg.z0, sg.x1, sg.z1);
      if (k.has('briseSoleil')) finGrid(g, F, sg.y0, sg.y1, k, k.look.wall === 'glass' ? 0.45 : 0.7);
      else if (k.has('planters') && use !== 'office') {
        // Vertical forest: planted balconies on every floor.
        const segsOn = Math.max(1, Math.round(F.len / 6));
        const sw = F.len / segsOn;
        for (let yy = sg.y0 + fh; yy < sg.y1 - 0.5; yy += fh) {
          for (let j = 0; j < segsOn; j++) if ((j + Math.round(yy / fh)) % 2 === 0) faceBalcony(g, F, j * sw + 0.4, (j + 1) * sw - 0.4, yy + 0.02, 1.2, k, r, true);
        }
      } else if (side === 0 && use !== 'office' && (k.has('loggias') || k.has('balconies') || (!k.look.explicit && a.hand + a.green > -0.3))) {
        const segsOn = Math.max(1, Math.round(F.len / 7));
        const sw = F.len / segsOn;
        for (let yy = sg.y0 + fh; yy < sg.y1 - 0.5; yy += fh) for (let j = 0; j < segsOn; j++) faceBalcony(g, F, j * sw + 0.5, (j + 1) * sw - 0.5, yy + 0.02, 1.3, k, r, false, k.has('loggias'));
      }
      if (k.has('monumental') && side === 0) piers(g, sg.x0, sg.x1, sg.z0, sg.y0, sg.y1, Math.max(2, Math.round(F.len / 6)), 1.0, 0.5, { ...k.plain, color: shade(k.wallCol, 1.05) });
      if (k.has('solarSkin') && side === 1) solarSkin(g, F, sg.y0, sg.y1, k);
    }
    if (k.has('ornament')) outline(g, sg.x0, sg.z0, sg.x1, sg.z1, sg.y0 - 0.2, sg.y0 + 0.25, 0.18, k.trim);
  });
  // Crown.
  const top = segs[segs.length - 1];
  const cx0 = top.x0, cz0 = top.z0, cx1 = top.x1, cz1 = top.z1, cw = cx1 - cx0, cd = cz1 - cz0;
  if (k.has('ornament') || k.look.roof === 'mansard') {
    // A stepped crown and a pinnacle.
    cornice(g, cx0, cz0, cx1, cz1, y, 1.3, k.trim);
    let yy = y, i = 0;
    for (; i < 2; i++) {
      const inset = 2 + i * 2;
      g.box(cx0 + inset, cz0 + inset, cx1 - inset, cz1 - inset, yy, yy + fh * 1.3, k.wall(podiumH), k.membrane);
      outline(g, cx0 + inset, cz0 + inset, cx1 - inset, cz1 - inset, yy + fh * 1.3 - 0.3, yy + fh * 1.3, 0.25, k.trim);
      yy += fh * 1.3;
    }
    g.cylinder((cx0 + cx1) / 2, (cz0 + cz1) / 2, 0.8, 0.05, yy, yy + Math.min(18, floors * 0.5), 6, { color: hex(0xc9b98a), pattern: P.METAL, seed: s }, null);
  } else if (k.look.roof === 'gable' || k.look.roof === 'hip' || k.look.roof === 'vault' || k.look.roof === 'butterfly' || k.look.roof === 'shed') {
    roofOver(g, k, r, cx0, cz0, cx1, cz1, y, { kind: k.look.roof === 'gable' ? 'hip' : k.look.roof, big: true });
  } else {
    roofOver(g, k, r, cx0, cz0, cx1, cz1, y, { big: true });
    if (use === 'hotel') g.box(cx0 + cw * 0.2, cz0 - 0.2, cx1 - cw * 0.2, cz0, y + 0.2, y + 1.4, { color: k.accent, pattern: P.SIGN, seed: s, bay: cw }, null, { sides: [true, true, false, true] });
    if (a.hand < -0.3 && !k.has('windCrown') && floors > 18) g.cylinder((cx0 + cx1) / 2, (cz0 + cz1) / 2, 0.4, 0.06, y, y + 14, 6, { color: hex(0xb8bcc0), pattern: P.METAL, seed: s }, null);
    void cd;
  }
  // Street trees in planters.
  for (let i = 0; i < 4; i++) {
    const x = -w / 2 + 3 + ((w - 6) * i) / 3;
    g.box(x - 1, 0.5, x + 1, 2.5, 0, 0.6, CONC(s), k.planted);
    g.prop({ kind: 'tree', x, y: 0.6, z: 1.5, rot: i, scale: 0.6, variant: 0 });
  }
}

/** Draws a zoned building in a movement; returns false for kinds it doesn't handle. */
export function generateStyled(g: GeoBuilder, b: GenInput, r: Rng, look: Movement): boolean {
  const k = kitFor(look, b, r);
  switch (b.style) {
    case 'house':
    case 'modernHouse':
      house(g, b, r, k);
      return true;
    case 'townhouse':
      townhouse(g, b, r, k);
      return true;
    case 'lowrise':
    case 'midrise':
      block(g, b, r, k, 'homes');
      return true;
    case 'shop':
      block(g, b, r, k, 'shop');
      return true;
    case 'mixeduse':
      block(g, b, r, k, 'mixed');
      return true;
    case 'office':
      block(g, b, r, k, 'office');
      return true;
    case 'tower':
      tower(g, b, r, k, 'homes');
      return true;
    case 'officeTower':
      tower(g, b, r, k, 'office');
      return true;
    case 'hotel':
      tower(g, b, r, k, 'hotel');
      return true;
    default:
      return false;
  }
}
