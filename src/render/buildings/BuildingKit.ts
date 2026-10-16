import type { Rng } from '../../core/rng';

/** Facade/surface pattern ids interpreted by the building shader. */
export const P = {
  PLAIN: 0,
  RES: 1,
  OFFICE: 2,
  GLASS: 3,
  STORE: 4,
  INDUSTRIAL: 5,
  ROOF_FLAT: 6,
  ROOF_TILE: 7,
  PARKING: 8,
  GRASS: 9,
  PAVING: 10,
  DOOR: 11,
  BRICK: 12,
  FIELD: 13,
  SOLAR: 14,
  WATER: 15,
  DIRT: 16,
  SIGN: 17,
  GLASS_PLAIN: 18,
  CONCRETE: 19,
  TRACK: 20,
  METAL: 21,
  /** Ashlar stone with punched windows (classical bases, civic buildings). */
  STONE: 22,
  /** Rainscreen panels in two tones with punched windows (modern housing). */
  PANEL: 23,
  /** Standing-seam metal roof. */
  ROOF_METAL: 24,
  /** Horizontal louvres (plant rooms, garages, screens). */
  LOUVRE: 25,
  /** Vertical timber boards. */
  WOOD: 26,
  /** Smooth painted trim: cornices, copings, fascias, sills. */
  TRIM: 27,
  /** Horizontal lap siding with punched windows (and shutters on some houses). */
  SIDING: 28,
  /** Striped canvas (awnings). */
  AWNING: 29,
  /** Fan grilles on top of air handlers (one fan per cell). */
  FAN: 30,
  /** Board-marked concrete with punched windows (brutalist facades). */
  BETON: 31,
  /** Vertical timber cladding with punched windows. */
  TIMBERW: 32,
  /** Planted surface: sedum roofs, planter tops, green terraces. */
  PLANTED: 33,
} as const;

export type RGB = [number, number, number];

export interface Mat {
  color: RGB;
  pattern: number;
  /** Floor height (facades) or a pattern parameter, metres. */
  fh?: number;
  /** Desired window bay width, metres. */
  bay?: number;
  /** 0–255 per-surface variation seed. */
  seed?: number;
  /** Height the facade's floors are counted from (the wall's first floor), metres. */
  oy?: number;
}

export interface BuildingProp {
  kind: 'tree' | 'bush' | 'car' | 'smoke' | 'steam' | 'rotor' | 'fountain' | 'crane';
  x: number;
  y: number;
  z: number;
  rot: number;
  scale?: number;
  variant?: number;
  color?: number;
}

export interface BuiltGeometry {
  pos: Float32Array;
  nor: Int8Array;
  col: Uint8Array;
  fac: Float32Array;
  pat: Uint8Array;
  idx: Uint32Array;
  vertexCount: number;
  props: BuildingProp[];
  /** Highest point above the lot base (for picking and cranes). */
  height: number;
}

/** sRGB 0–255 hex → linear-ish 0–1 tuple stored in vertex colours (shader treats them as sRGB). */
export function hex(h: number): RGB {
  return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
}

export function shade(c: RGB, k: number): RGB {
  return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
}

export function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Accumulates building geometry in lot-local space: x along the frontage
 * (−w/2…w/2), z away from the road (0 = front edge), y up from the lot base.
 * Output is transformed to world space at the end.
 */
export class GeoBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private fac: number[] = [];
  private pat: number[] = [];
  private idx: number[] = [];
  readonly props: BuildingProp[] = [];
  maxY = 0;

  constructor(readonly w: number, readonly d: number, readonly rng: Rng) {}

  private v(x: number, y: number, z: number, nx: number, ny: number, nz: number, m: Mat, fu: number, fv: number): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.col.push(m.color[0], m.color[1], m.color[2]);
    this.fac.push(fu, fv);
    this.pat.push(m.pattern, Math.round((m.fh ?? 3) * 10), Math.round((m.bay ?? 3) * 10), m.seed ?? 0);
    if (y > this.maxY) this.maxY = y;
    return this.pos.length / 3 - 1;
  }

  /** Quad from four corners (counter-clockwise seen from the front), with facade coords. */
  quad(
    a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number],
    n: [number, number, number], m: Mat,
    uv: [[number, number], [number, number], [number, number], [number, number]],
  ): void {
    const i0 = this.v(a[0], a[1], a[2], n[0], n[1], n[2], m, uv[0][0], uv[0][1]);
    const i1 = this.v(b[0], b[1], b[2], n[0], n[1], n[2], m, uv[1][0], uv[1][1]);
    const i2 = this.v(c[0], c[1], c[2], n[0], n[1], n[2], m, uv[2][0], uv[2][1]);
    const i3 = this.v(d[0], d[1], d[2], n[0], n[1], n[2], m, uv[3][0], uv[3][1]);
    this.idx.push(i0, i1, i2, i0, i2, i3);
  }

  tri(a: [number, number, number], b: [number, number, number], c: [number, number, number], n: [number, number, number], m: Mat, uv: [[number, number], [number, number], [number, number]]): void {
    const i0 = this.v(a[0], a[1], a[2], n[0], n[1], n[2], m, uv[0][0], uv[0][1]);
    const i1 = this.v(b[0], b[1], b[2], n[0], n[1], n[2], m, uv[1][0], uv[1][1]);
    const i2 = this.v(c[0], c[1], c[2], n[0], n[1], n[2], m, uv[2][0], uv[2][1]);
    this.idx.push(i0, i1, i2);
  }

  /** Vertical wall from (x0,z0) to (x1,z1), seen from its outward side; windows fit exactly. */
  wall(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, m: Mat): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.01 || y1 - y0 < 0.01) return;
    // Outward normal = right-hand normal of the walking direction.
    const nx = -(z1 - z0) / len;
    const nz = (x1 - x0) / len;
    const bay = m.bay ?? 3;
    const cells = Math.max(1, Math.round(len / bay));
    const mm = { ...m, bay: len / cells };
    const oy = m.oy ?? 0;
    this.quad([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], [nx, 0, nz], mm, [[0, y0 - oy], [cells, y0 - oy], [cells, y1 - oy], [0, y1 - oy]]);
    // Walls standing on the lot continue into the ground as a foundation, so
    // buildings sit into sloping terrain instead of floating above it.
    if (y0 <= 0.01 && y1 - y0 >= 0.3 && len >= 1.5 && m.pattern !== P.WOOD && m.pattern !== P.GLASS_PLAIN) {
      this.quad([x0, -4, z0], [x1, -4, z1], [x1, y0, z1], [x0, y0, z0], [nx, 0, nz], FOUNDATION, [[0, -4], [len, -4], [len, y0], [0, y0]]);
    }
  }

  /** Axis-aligned box with walls on four sides and a top. */
  box(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, wall: Mat, top: Mat | null, opts: { sides?: [boolean, boolean, boolean, boolean] } = {}): void {
    const s = opts.sides ?? [true, true, true, true];
    // Front (z0) faces -z: walk from x1 to x0 so the outward normal is -z.
    if (s[0]) this.wall(x1, z0, x0, z0, y0, y1, wall);
    if (s[1]) this.wall(x1, z1, x1, z0, y0, y1, wall);
    if (s[2]) this.wall(x0, z1, x1, z1, y0, y1, wall);
    if (s[3]) this.wall(x0, z0, x0, z1, y0, y1, wall);
    if (top) this.flat(x0, z0, x1, z1, y1, top);
  }

  /** Horizontal rectangle facing up. Facade coords are lot metres. */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, m: Mat): void {
    this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], [0, 1, 0], m, [[x0, z0], [x0, z1], [x1, z1], [x1, z0]]);
  }

  /** Box centred at (cx, cz) rotated by `rot` within the lot. */
  boxRot(cx: number, cz: number, w: number, d: number, rot: number, y0: number, y1: number, wall: Mat, top: Mat | null): void {
    const c = Math.cos(rot), s = Math.sin(rot);
    const p = (lx: number, lz: number): [number, number] => [cx + lx * c - lz * s, cz + lx * s + lz * c];
    const a = p(-w / 2, -d / 2), b = p(w / 2, -d / 2), cc = p(w / 2, d / 2), dd = p(-w / 2, d / 2);
    this.wall(b[0], b[1], a[0], a[1], y0, y1, wall);
    this.wall(cc[0], cc[1], b[0], b[1], y0, y1, wall);
    this.wall(dd[0], dd[1], cc[0], cc[1], y0, y1, wall);
    this.wall(a[0], a[1], dd[0], dd[1], y0, y1, wall);
    if (top) {
      this.quad([a[0], y1, a[1]], [dd[0], y1, dd[1]], [cc[0], y1, cc[1]], [b[0], y1, b[1]], [0, 1, 0], top, [[a[0], a[1]], [dd[0], dd[1]], [cc[0], cc[1]], [b[0], b[1]]]);
    }
  }

  /** Gable roof over a rectangle; ridge runs along X when `alongX`. Gable ends use `end` material. */
  gable(x0: number, z0: number, x1: number, z1: number, y0: number, rise: number, alongX: boolean, roof: Mat, end: Mat, overhang = 0.35): void {
    const o = overhang;
    if (alongX) {
      const zm = (z0 + z1) / 2;
      const yr = y0 + rise;
      const slope = Math.hypot((z1 - z0) / 2 + o, rise);
      const n1 = normalize(0, (z1 - z0) / 2, -rise);
      const n2 = normalize(0, (z1 - z0) / 2, rise);
      const yl = y0 - (o * rise) / ((z1 - z0) / 2);
      this.quad([x1 + o, yl, z0 - o], [x0 - o, yl, z0 - o], [x0 - o, yr, zm], [x1 + o, yr, zm], n1, roof, [[0, 0], [x1 - x0, 0], [x1 - x0, slope], [0, slope]]);
      this.quad([x0 - o, yl, z1 + o], [x1 + o, yl, z1 + o], [x1 + o, yr, zm], [x0 - o, yr, zm], n2, roof, [[0, 0], [x1 - x0, 0], [x1 - x0, slope], [0, slope]]);
      // Gable ends use heights from the eaves, so a facade pattern never finds a window there.
      this.tri([x0, y0, z0], [x0, y0, z1], [x0, yr, zm], [-1, 0, 0], end, [[0, 0], [1, 0], [0.5, rise]]);
      this.tri([x1, y0, z1], [x1, y0, z0], [x1, yr, zm], [1, 0, 0], end, [[0, 0], [1, 0], [0.5, rise]]);
    } else {
      const xm = (x0 + x1) / 2;
      const yr = y0 + rise;
      const slope = Math.hypot((x1 - x0) / 2 + o, rise);
      const yl = y0 - (o * rise) / ((x1 - x0) / 2);
      const n1 = normalize(-rise, (x1 - x0) / 2, 0);
      const n2 = normalize(rise, (x1 - x0) / 2, 0);
      this.quad([x0 - o, yl, z0 - o], [x0 - o, yl, z1 + o], [xm, yr, z1 + o], [xm, yr, z0 - o], n1, roof, [[0, 0], [z1 - z0, 0], [z1 - z0, slope], [0, slope]]);
      this.quad([x1 + o, yl, z1 + o], [x1 + o, yl, z0 - o], [xm, yr, z0 - o], [xm, yr, z1 + o], n2, roof, [[0, 0], [z1 - z0, 0], [z1 - z0, slope], [0, slope]]);
      this.tri([x1, y0, z0], [x0, y0, z0], [xm, yr, z0], [0, 0, -1], end, [[0, 0], [1, 0], [0.5, rise]]);
      this.tri([x0, y0, z1], [x1, y0, z1], [xm, yr, z1], [0, 0, 1], end, [[0, 0], [1, 0], [0.5, rise]]);
    }
  }

  /** Hip roof (four slopes). */
  hip(x0: number, z0: number, x1: number, z1: number, y0: number, rise: number, roof: Mat, overhang = 0.35): void {
    const o = overhang;
    const w = x1 - x0, d = z1 - z0;
    const yr = y0 + rise;
    const inset = Math.min(w, d) / 2;
    const yl = y0 - (o * rise) / inset;
    const X0 = x0 - o, X1 = x1 + o, Z0 = z0 - o, Z1 = z1 + o;
    if (w >= d) {
      const zm = (z0 + z1) / 2;
      const rx0 = x0 + inset, rx1 = x1 - inset;
      this.quad([X1, yl, Z0], [X0, yl, Z0], [rx0, yr, zm], [rx1, yr, zm], normalize(0, d / 2, -rise), roof, [[0, 0], [w, 0], [w - inset, inset], [inset, inset]]);
      this.quad([X0, yl, Z1], [X1, yl, Z1], [rx1, yr, zm], [rx0, yr, zm], normalize(0, d / 2, rise), roof, [[0, 0], [w, 0], [w - inset, inset], [inset, inset]]);
      this.tri([X0, yl, Z0], [X0, yl, Z1], [rx0, yr, zm], normalize(-rise, inset, 0), roof, [[0, 0], [d, 0], [d / 2, inset]]);
      this.tri([X1, yl, Z1], [X1, yl, Z0], [rx1, yr, zm], normalize(rise, inset, 0), roof, [[0, 0], [d, 0], [d / 2, inset]]);
    } else {
      const xm = (x0 + x1) / 2;
      const rz0 = z0 + inset, rz1 = z1 - inset;
      this.quad([X0, yl, Z0], [X0, yl, Z1], [xm, yr, rz1], [xm, yr, rz0], normalize(-rise, w / 2, 0), roof, [[0, 0], [d, 0], [d - inset, inset], [inset, inset]]);
      this.quad([X1, yl, Z1], [X1, yl, Z0], [xm, yr, rz0], [xm, yr, rz1], normalize(rise, w / 2, 0), roof, [[0, 0], [d, 0], [d - inset, inset], [inset, inset]]);
      this.tri([X1, yl, Z0], [X0, yl, Z0], [xm, yr, rz0], normalize(0, inset, -rise), roof, [[0, 0], [w, 0], [w / 2, inset]]);
      this.tri([X0, yl, Z1], [X1, yl, Z1], [xm, yr, rz1], normalize(0, inset, rise), roof, [[0, 0], [w, 0], [w / 2, inset]]);
    }
  }

  /** Vertical cylinder (optionally tapered) with a cap. */
  cylinder(cx: number, cz: number, r0: number, r1: number, y0: number, y1: number, segs: number, side: Mat, cap: Mat | null): void {
    const circ = 2 * Math.PI * r0;
    const bay = side.bay ?? 3;
    const cells = Math.max(1, Math.round(circ / bay));
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const am = (a0 + a1) / 2;
      const n: [number, number, number] = [Math.cos(am), (r0 - r1) / Math.max(0.01, y1 - y0), Math.sin(am)];
      const nl = Math.hypot(n[0], n[1], n[2]);
      n[0] /= nl; n[1] /= nl; n[2] /= nl;
      const u0 = (i / segs) * cells, u1 = ((i + 1) / segs) * cells;
      const oy = side.oy ?? 0;
      this.quad(
        [cx + c0 * r0, y0, cz + s0 * r0], [cx + c0 * r1, y1, cz + s0 * r1], [cx + c1 * r1, y1, cz + s1 * r1], [cx + c1 * r0, y0, cz + s1 * r0],
        n, { ...side, bay: circ / cells }, [[u0, y0 - oy], [u0, y1 - oy], [u1, y1 - oy], [u1, y0 - oy]],
      );
    }
    if (cap && r1 > 0.01) {
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        this.tri([cx, y1, cz], [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1], [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1], [0, 1, 0], cap, [[cx, cz], [cx + Math.cos(a1) * r1, cz + Math.sin(a1) * r1], [cx + Math.cos(a0) * r1, cz + Math.sin(a0) * r1]]);
      }
    }
  }

  /** Surface of revolution from (radius, y) profile points. */
  lathe(cx: number, cz: number, profile: [number, number][], segs: number, m: Mat): void {
    for (let k = 0; k < profile.length - 1; k++) {
      const [ra, ya] = profile[k];
      const [rb, yb] = profile[k + 1];
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        const am = (a0 + a1) / 2;
        const dr = rb - ra, dy = yb - ya;
        const nl = Math.hypot(dr, dy) || 1;
        const n: [number, number, number] = [Math.cos(am) * (dy / nl), -dr / nl, Math.sin(am) * (dy / nl)];
        this.quad(
          [cx + Math.cos(a0) * ra, ya, cz + Math.sin(a0) * ra], [cx + Math.cos(a0) * rb, yb, cz + Math.sin(a0) * rb],
          [cx + Math.cos(a1) * rb, yb, cz + Math.sin(a1) * rb], [cx + Math.cos(a1) * ra, ya, cz + Math.sin(a1) * ra],
          n, m, [[i, ya], [i, yb], [i + 1, yb], [i + 1, ya]],
        );
      }
    }
  }

  /**
   * Ground-level decal (yard, parking, paving) slightly above the lot base.
   * A plain plate over the whole lot is skipped: the terrain itself shows there.
   */
  ground(x0: number, z0: number, x1: number, z1: number, m: Mat, lift = 0.04): void {
    const plate = m.pattern === P.GRASS || m.pattern === P.PAVING || m.pattern === P.CONCRETE || m.pattern === P.PARKING || m.pattern === P.DIRT;
    if (plate && (x1 - x0) * (z1 - z0) >= this.w * this.d * 0.85) return;
    // Front paths run on to the sidewalk: the lot starts a little way behind it.
    if (z0 <= 0.5 && z1 > z0 && x1 - x0 < 8 && (m.pattern === P.PAVING || m.pattern === P.CONCRETE)) z0 = -FRONT_GAP;
    this.flat(x0, z0, x1, z1, lift, m);
  }

  /**
   * Ground decal with normalised 0–1 coordinates; the pattern receives the
   * rectangle size in metres via fh/bay (used by sports fields and tracks).
   */
  groundN(x0: number, z0: number, x1: number, z1: number, m: Mat, lift = 0.05): void {
    const mm = { ...m, fh: (x1 - x0) / 10, bay: (z1 - z0) / 10 };
    this.quad([x0, lift, z0], [x0, lift, z1], [x1, lift, z1], [x1, lift, z0], [0, 1, 0], mm, [[0, 0], [0, 1], [1, 1], [1, 0]]);
  }

  prop(p: BuildingProp): void {
    this.props.push(p);
  }

  /** Transforms the accumulated local geometry into world space and packs it. */
  build(cx: number, cz: number, angle: number, hd: number, baseY: number): BuiltGeometry {
    const n = this.pos.length / 3;
    const pos = new Float32Array(n * 3);
    const nor = new Int8Array(n * 3);
    const col = new Uint8Array(n * 3);
    const ca = Math.cos(angle), sa = Math.sin(angle);
    for (let i = 0; i < n; i++) {
      const x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2] - hd;
      pos[i * 3] = cx + x * ca - z * sa;
      pos[i * 3 + 1] = baseY + y;
      pos[i * 3 + 2] = cz + x * sa + z * ca;
      const nx = this.nor[i * 3], ny = this.nor[i * 3 + 1], nz = this.nor[i * 3 + 2];
      nor[i * 3] = Math.round((nx * ca - nz * sa) * 127);
      nor[i * 3 + 1] = Math.round(ny * 127);
      nor[i * 3 + 2] = Math.round((nx * sa + nz * ca) * 127);
      col[i * 3] = Math.round(this.col[i * 3] * 255);
      col[i * 3 + 1] = Math.round(this.col[i * 3 + 1] * 255);
      col[i * 3 + 2] = Math.round(this.col[i * 3 + 2] * 255);
    }
    const props = this.props.map((p) => {
      const z = p.z - hd;
      return { ...p, x: cx + p.x * ca - z * sa, z: cz + p.x * sa + z * ca, y: baseY + p.y, rot: p.rot + angle };
    });
    return {
      pos,
      nor,
      col,
      fac: Float32Array.from(this.fac),
      pat: Uint8Array.from(this.pat.map((v) => Math.max(0, Math.min(255, v)))),
      idx: Uint32Array.from(this.idx),
      vertexCount: n,
      props,
      height: this.maxY,
    };
  }
}

/** Distance from a zoned lot's front edge back to the sidewalk (the lot's setback). */
const FRONT_GAP = 0.65;

const FOUNDATION: Mat = { color: hex(0x8a847a), pattern: P.CONCRETE, seed: 0, fh: 3, bay: 3 };

function normalize(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
