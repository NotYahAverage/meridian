import type { Rng } from '../../core/rng';
import { type GeoBuilder, type Mat, P, type RGB, hex } from './BuildingKit';

/**
 * Architectural vocabulary shared by the building generators: projecting
 * bands (plinths, string courses, cornices), parapets with copings, balconies,
 * awnings, canopies, doors, and roof plant arranged without overlaps. Each
 * element is a handful of quads, so they add silhouette and shadow lines
 * without much geometry; surface detail stays in the facade shader.
 *
 * Coordinates are lot-local, as in GeoBuilder: x across the frontage, z from
 * the front edge (0) towards the back, y up from the lot base. A footprint
 * (x0, z0, x1, z1) has its street face at z0, facing −z.
 */

export const mat = (color: RGB, pattern: number, seed: number, fh = 3, bay = 3): Mat => ({ color, pattern, seed, fh, bay });

/** Meridian's palettes (sRGB). Warm, mineral and slightly muted, with crisp trims. */
export const PAL = {
  /** Render and limestone: creams, sands, biscuit, warm greys. */
  render: [0xe6dac4, 0xd9c6a5, 0xcbb497, 0xe0d3bf, 0xc8bfae, 0xb7a993, 0xd4c9b5, 0xa89f93, 0xdcc5a0, 0xc4a68a],
  /** Brick: reds, oranges, browns, buff and cream. */
  brick: [0x8f4a36, 0x9c5a40, 0xa86b4c, 0x7a4a3a, 0xb08e70, 0x6f5547, 0x94706a, 0xbfa184],
  /** Painted lap siding for houses. */
  siding: [0xe9e4d6, 0xc7d0cf, 0xa9b8b3, 0x9fb1c2, 0xd8c9a3, 0xb5a28a, 0x8a9a8c, 0x6f7f8f, 0xcfb8a0, 0x7d6e64, 0xe3d9c2],
  /** Pitched roofs: shingle and tile. */
  roof: [0x4a4744, 0x5b4a40, 0x8a4a35, 0x9c5a3c, 0x3d4247, 0x6b5d50, 0x55606a, 0x7a3f30],
  /** Rainscreen panels for contemporary housing. */
  panel: [0xd8d2c8, 0x9a948a, 0x5f6266, 0xb39b7c, 0xc8b8a0, 0x7a8a8f, 0xe4e0d8, 0x8c7a66],
  /** Flat roof membranes. */
  membrane: [0x8f8b84, 0x7a7771, 0x857c72, 0x67655f, 0x5a5856, 0x9a958c, 0x726b62],
  /** Metal accents: charcoal, bronze, aluminium, deep green. */
  metal: [0x3a3d40, 0x6e5338, 0xb0b3b5, 0x2f3d36, 0x4b4f55],
  /** Trim: white, warm stone, charcoal. */
  trim: [0xeeeae0, 0xd8cfbd, 0x3b3c3e],
  /** Curtain-wall glass tints. */
  glass: [0x5e7c8e, 0x587a76, 0x6d7780, 0x48606f, 0x7a8a94, 0x3f5866, 0x6a7f7a],
  /** Awnings and shop accents. */
  accent: [0x8c2f2a, 0x1f4e6b, 0x2f5e45, 0xb5832e, 0x5a3e5d, 0x1e6b66, 0xa4502c, 0x2b3a4a],
};

export const rgb = hex;

/**
 * A band hugging the outside of a footprint from y0 to y1, projecting `out`
 * metres: plinths, string courses, cornices. Four strips, no faces against
 * the wall, so nothing overlaps the facade.
 */
export function outline(g: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, out: number, m: Mat, sides: [boolean, boolean, boolean, boolean] = [true, true, true, true]): void {
  const X0 = x0 - out, X1 = x1 + out, Z0 = z0 - out, Z1 = z1 + out;
  const [f, r, b, l] = sides;
  // Front and back strips include the corners.
  if (f) g.box(l ? X0 : x0, Z0, r ? X1 : x1, z0, y0, y1, m, m, { sides: [true, r, false, l] });
  if (b) g.box(l ? X0 : x0, z1, r ? X1 : x1, Z1, y0, y1, m, m, { sides: [false, r, true, l] });
  const za = f ? z0 : Z0, zb = b ? z1 : Z1;
  if (l) g.box(X0, za, x0, zb, y0, y1, m, m, { sides: [!f, false, !b, true] });
  if (r) g.box(x1, za, X1, zb, y0, y1, m, m, { sides: [!f, true, !b, false] });
}

/**
 * Parapet around a flat roof: an upstand flush with the facade (with its inner
 * face, seen from above) and a coping that oversails it slightly.
 */
export function parapet(g: GeoBuilder, x0: number, z0: number, x1: number, z1: number, roofY: number, h: number, wall: Mat, coping: Mat, t = 0.3): void {
  const top = roofY + h;
  // Outer faces (flush with the walls below).
  g.wall(x1, z0, x0, z0, roofY, top, wall);
  g.wall(x1, z1, x1, z0, roofY, top, wall);
  g.wall(x0, z1, x1, z1, roofY, top, wall);
  g.wall(x0, z0, x0, z1, roofY, top, wall);
  // Inner faces.
  const ix0 = x0 + t, iz0 = z0 + t, ix1 = x1 - t, iz1 = z1 - t;
  if (ix1 > ix0 && iz1 > iz0) {
    g.wall(ix0, iz0, ix1, iz0, roofY, top, wall);
    g.wall(ix1, iz0, ix1, iz1, roofY, top, wall);
    g.wall(ix1, iz1, ix0, iz1, roofY, top, wall);
    g.wall(ix0, iz1, ix0, iz0, roofY, top, wall);
  }
  // Coping: a slim cap oversailing both faces.
  const o = 0.05;
  const cy = top + 0.1;
  g.box(x0 - o, z0 - o, x1 + o, iz0 + o, top, cy, coping, coping, { sides: [true, true, false, true] });
  g.box(x0 - o, iz1 - o, x1 + o, z1 + o, top, cy, coping, coping, { sides: [false, true, true, true] });
  g.box(x0 - o, iz0 + o, ix0 + o, iz1 - o, top, cy, coping, coping, { sides: [false, true, false, true] });
  g.box(ix1 - o, iz0 + o, x1 + o, iz1 - o, top, cy, coping, coping, { sides: [false, true, false, true] });
}

/** A classical cornice: a frieze band and an oversailing crown, around a footprint at the top of its walls. */
export function cornice(g: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y: number, size: number, m: Mat, sides?: [boolean, boolean, boolean, boolean]): void {
  outline(g, x0, z0, x1, z1, y - 0.55 * size, y - 0.22 * size, 0.1 * size, m, sides);
  outline(g, x0, z0, x1, z1, y - 0.22 * size, y, 0.38 * size, m, sides);
}

/** Flat roof with a parapet, coping and optional cornice. */
export function flatRoof(g: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y: number, membrane: Mat, wall: Mat, coping: Mat, opts: { parapet?: number; cornice?: number } = {}): void {
  g.flat(x0, z0, x1, z1, y, membrane);
  const ph = opts.parapet ?? 0.9;
  if (ph > 0) parapet(g, x0, z0, x1, z1, y, ph, wall, coping);
  if (opts.cornice) cornice(g, x0, z0, x1, z1, y + ph + 0.1, opts.cornice, coping);
}

/**
 * A balcony on a street face (facing −z at z): a slab, a balustrade on three
 * sides (both faces, so it reads from inside and out) and a handrail. Solid
 * balustrades are full height; glass ones sit on a low upstand.
 */
export function balcony(g: GeoBuilder, x0: number, x1: number, z: number, y: number, depth: number, slab: Mat, rail: Mat): void {
  const zf = z - depth;
  g.box(x0, zf, x1, z, y - 0.16, y, slab, slab, { sides: [true, true, false, true] });
  const glass = rail.pattern === P.GLASS_PLAIN;
  const y0 = glass ? y + 0.12 : y;
  const top = y + 1.05;
  if (glass) {
    g.wall(x1, zf, x0, zf, y, y0, slab);
  }
  g.wall(x1, zf, x0, zf, y0, top, rail);
  g.wall(x0, zf + 0.05, x1, zf + 0.05, y0, top, rail);
  g.wall(x0, zf, x0, z, y0, top, rail);
  g.wall(x0 + 0.05, z, x0 + 0.05, zf, y0, top, rail);
  g.wall(x1, z, x1, zf, y0, top, rail);
  g.wall(x1 - 0.05, zf, x1 - 0.05, z, y0, top, rail);
  // Handrail capping the front.
  g.box(x0, zf - 0.02, x1, zf + 0.07, top, top + 0.06, slab, slab, { sides: [true, true, true, true] });
}

/** Sloped canvas awning over a shop window (street face at z), with a valance. */
export function awning(g: GeoBuilder, x0: number, x1: number, z: number, y: number, depth: number, drop: number, color: RGB, seed: number): void {
  const m = mat(color, P.AWNING, seed, 3, 1);
  const zf = z - depth, yl = y - drop;
  const l = Math.hypot(depth, drop) || 1;
  g.quad([x1, yl, zf], [x0, yl, zf], [x0, y, z], [x1, y, z], [0, depth / l, -drop / l], m, [[x1, 0], [x0, 0], [x0, 1], [x1, 1]]);
  g.wall(x1, zf, x0, zf, yl - 0.32, yl, m);
  // Cheeks.
  g.tri([x0, yl, zf], [x0, yl, z], [x0, y, z], [-1, 0, 0], m, [[0, 0], [1, 0], [1, 1]]);
  g.tri([x1, yl, z], [x1, yl, zf], [x1, y, z], [1, 0, 0], m, [[0, 0], [1, 0], [1, 1]]);
}

/** Flat canopy with a fascia (entrances, shop fronts), optionally on posts. */
export function canopy(g: GeoBuilder, x0: number, x1: number, z: number, y: number, depth: number, thick: number, m: Mat, posts: Mat | null = null): void {
  const zf = z - depth;
  g.box(x0, zf, x1, z, y, y + thick, m, m, { sides: [true, true, false, true] });
  if (posts) {
    for (const x of [x0 + 0.25, x1 - 0.25]) g.box(x - 0.09, zf + 0.15, x + 0.09, zf + 0.33, 0, y, posts, null);
  }
}

/** A door set into a facade facing −z at z (the wall's own windows behind it are hidden). */
export function door(g: GeoBuilder, cx: number, z: number, y: number, w: number, h: number, leaf: Mat, frame: Mat): void {
  g.box(cx - w / 2 - 0.12, z - 0.06, cx + w / 2 + 0.12, z, y, y + h + 0.12, frame, frame, { sides: [true, true, false, true] });
  g.wall(cx + w / 2, z - 0.07, cx - w / 2, z - 0.07, y, y + h, leaf);
}

/** Vertical piers standing proud of a street face (facing −z at z), at n+1 evenly spaced positions. */
export function piers(g: GeoBuilder, x0: number, x1: number, z: number, y0: number, y1: number, n: number, width: number, proj: number, m: Mat): void {
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const a = Math.max(x0 - 0.001, x - width / 2), b = Math.min(x1 + 0.001, x + width / 2);
    g.box(a, z - proj, b, z, y0, y1, m, m, { sides: [true, true, false, true] });
  }
}

// ── Roof plant ─────────────────────────────────────────────────────────────

/** Packaged air handler: louvred casing with fans on top. */
export function airHandler(g: GeoBuilder, x: number, z: number, y: number, w: number, d: number, h: number, seed: number): void {
  const body = mat(hex(0x9da1a2), P.LOUVRE, seed, 3, 1);
  const top = mat(hex(0x8e9294), P.METAL, seed);
  const fans = w > d * 1.6 ? 2 : 1;
  // The top is one quad; the shader draws a fan guard in each of its cells.
  g.box(x, z, x + w, z + d, y, y + h, body, null);
  g.quad([x, y + h, z], [x, y + h, z + d], [x + w, y + h, z + d], [x + w, y + h, z], [0, 1, 0], { ...top, pattern: P.FAN }, [[0, 0], [0, 1], [fans, 1], [fans, 0]]);
}

/** Timber water tank on a steel stand with a conical roof (older brick blocks). */
export function waterTank(g: GeoBuilder, x: number, z: number, y: number, r: number, h: number, seed: number): void {
  const leg = mat(hex(0x3c3a38), P.METAL, seed);
  const legH = 2.2;
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const lx = x + dx * r * 0.62, lz = z + dz * r * 0.62;
    g.box(lx - 0.1, lz - 0.1, lx + 0.1, lz + 0.1, y, y + legH, leg, null);
  }
  g.cylinder(x, z, r, r * 0.96, y + legH, y + legH + h, 10, mat(hex(0x7a5f45), P.WOOD, seed, 3, 0.5), null);
  g.lathe(x, z, [[r * 1.04, y + legH + h], [r * 0.5, y + legH + h + r * 0.55], [0.02, y + legH + h + r * 0.8]], 10, mat(hex(0x4a3f36), P.ROOF_METAL, seed));
}

/** Rectangle on a roof that plant must stay clear of. */
type Rect = [number, number, number, number];

function overlaps(a: Rect, list: Rect[], pad: number): boolean {
  for (const b of list) if (a[0] < b[2] + pad && a[2] > b[0] - pad && a[1] < b[3] + pad && a[3] > b[1] - pad) return true;
  return false;
}

/**
 * Dresses a flat roof: a stair/lift overrun, air handlers, vents and (on some)
 * a water tank or solar array, packed without overlaps and kept back from the
 * parapet. `keep` reserves areas already used.
 */
export function roofscape(g: GeoBuilder, r: Rng, x0: number, z0: number, x1: number, z1: number, y: number, seed: number, opts: { overrun?: Mat | null; tank?: boolean; solar?: boolean; density?: number; keep?: Rect[] } = {}): void {
  const inset = 1.2;
  const ax0 = x0 + inset, az0 = z0 + inset, ax1 = x1 - inset, az1 = z1 - inset;
  const W = ax1 - ax0, D = az1 - az0;
  if (W < 3 || D < 3) return;
  const used: Rect[] = [...(opts.keep ?? [])];
  const place = (w: number, d: number, tries = 8): Rect | null => {
    for (let i = 0; i < tries; i++) {
      if (w > W || d > D) return null;
      const x = r.range(ax0, ax1 - w), z = r.range(az0, az1 - d);
      const rect: Rect = [x, z, x + w, z + d];
      if (!overlaps(rect, used, 0.8)) {
        used.push(rect);
        return rect;
      }
    }
    return null;
  };
  // Lift and stair overrun with a louvred plant screen.
  if (opts.overrun !== null && W > 7 && D > 6) {
    const ow = Math.min(W * 0.4, r.range(4, 7)), od = Math.min(D * 0.45, r.range(3.5, 5.5));
    const o = place(ow, od);
    if (o) {
      const wall = opts.overrun ?? mat(hex(0xc9c4ba), P.CONCRETE, seed);
      const h = r.range(2.6, 3.4);
      g.box(o[0], o[1], o[2], o[3], y, y + h, wall, mat(hex(0x8a8781), P.ROOF_FLAT, seed));
      outline(g, o[0], o[1], o[2], o[3], y + h, y + h + 0.12, 0.06, mat(hex(0xd8d3c9), P.TRIM, seed));
    }
  }
  if (opts.tank && W > 6 && D > 6) {
    const t = place(3.6, 3.6);
    if (t) waterTank(g, (t[0] + t[2]) / 2, (t[1] + t[3]) / 2, y, 1.5, 2.6, seed);
  }
  if (opts.solar && W > 8 && D > 8) {
    const sw = Math.min(W * 0.5, 10), sd = Math.min(D * 0.4, 6);
    const s = place(sw, sd);
    if (s) {
      // Tilted rows of panels.
      const rows = Math.max(1, Math.floor((s[3] - s[1]) / 1.8));
      for (let k = 0; k < rows; k++) {
        const za = s[1] + k * 1.8, zb = za + 1.3;
        g.quad([s[2], y + 0.25, za], [s[0], y + 0.25, za], [s[0], y + 0.85, zb], [s[2], y + 0.85, zb], [0, 0.91, -0.42], mat(hex(0x23303d), P.SOLAR, seed), [[s[2], za], [s[0], za], [s[0], zb], [s[2], zb]]);
      }
    }
  }
  const density = opts.density ?? 1;
  const n = Math.min(5, Math.max(1, Math.round(((W * D) / 120) * density)));
  for (let i = 0; i < n; i++) {
    const w = r.range(1.4, 2.8), d = r.range(1.2, 1.8);
    const a = place(w, d, 5);
    if (a) airHandler(g, a[0], a[1], y, a[2] - a[0], a[3] - a[1], r.range(1.0, 1.5), seed);
  }
  // Vent stacks and roof hatches.
  for (let i = 0; i < Math.min(3, n); i++) {
    const v = place(0.35, 0.35, 3);
    if (v) g.box(v[0], v[1], v[2], v[3], y, y + r.range(0.6, 1.2), mat(hex(0x77797b), P.METAL, seed), mat(hex(0x2a2a2a), P.PLAIN, seed));
  }
}
