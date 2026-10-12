import type { Rng } from '../../core/rng';
import type { ArchMat, ArchSpec, Module, Section } from '../../sim/research/Architecture';
import { type GeoBuilder, type Mat, P, type RGB, hex } from './BuildingKit';

/**
 * Geometry for procedurally composed buildings (research centres and designs
 * discovered by research). Everything comes from an ArchSpec: sections with
 * their roofs, an entrance, equipment modules and the lot around them.
 */

const mat = (color: number | RGB, pattern: number, seed: number, fh = 3, bay = 3): Mat => ({ color: typeof color === 'number' ? hex(color) : color, pattern, seed, fh, bay });

/** Facade pattern for a wall finish (the shader draws windows, brick, cladding…). */
function wallPattern(m: ArchMat, role: Section['role']): number {
  if (role === 'hall' || m.surface === 'industrial' || m.surface === 'metal') return P.INDUSTRIAL;
  switch (m.surface) {
    case 'brick': return P.BRICK;
    case 'glass': return P.GLASS;
    case 'timber': return P.RES;
    default: return P.OFFICE;
  }
}

function sectionHeight(sec: Section): number {
  return sec.floors * sec.floorH;
}

/** A barrel vault over a block, its ridge running across the frontage (x). */
function barrel(g: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y: number, rise: number, roof: Mat, end: Mat): void {
  const n = 8;
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
    g.quad([x1, ya, za], [x0, ya, za], [x0, yb, zb], [x1, yb, zb], [0, ny / l, nz / l], roof, [[0, i], [x1 - x0, i], [x1 - x0, i + 1], [0, i + 1]]);
    // End walls under the vault.
    g.tri([x0, y, zc], [x0, yb, zb], [x0, ya, za], [-1, 0, 0], end, [[0.5, 0], [1, 1], [0, 1]]);
    g.tri([x1, y, zc], [x1, ya, za], [x1, yb, zb], [1, 0, 0], end, [[0.5, 0], [0, 1], [1, 1]]);
  }
}

/** A tilted photovoltaic panel row (faces up and toward the street). */
function panelRow(g: GeoBuilder, x0: number, x1: number, z0: number, z1: number, y: number, s: number): void {
  const lift = 1.1;
  const pm = mat(0x2a3646, P.SOLAR, s, 1, 1.2);
  const n = [0, 0.94, -0.34] as [number, number, number];
  g.quad([x1, y + 0.4, z0], [x0, y + 0.4, z0], [x0, y + 0.4 + lift, z1], [x1, y + 0.4 + lift, z1], n, pm, [[0, 0], [x1 - x0, 0], [x1 - x0, z1 - z0], [0, z1 - z0]]);
  const leg = mat(0x8d9296, P.METAL, s);
  for (const x of [x0 + 0.4, x1 - 0.6]) g.box(x, z1 - 0.3, x + 0.2, z1 - 0.1, y, y + 0.4 + lift, leg, null);
}

function drawRoof(g: GeoBuilder, sec: Section, roofColor: number, wall: Mat, r: Rng, s: number): void {
  const { x0, z0, x1, z1 } = sec;
  const h = sectionHeight(sec);
  const flatMat = mat(roofColor, P.ROOF_FLAT, s);
  switch (sec.roof) {
    case 'gable': {
      const alongX = x1 - x0 >= z1 - z0;
      g.gable(x0, z0, x1, z1, h, Math.min(5, Math.min(x1 - x0, z1 - z0) * 0.32), alongX, mat(r.pick([0x7a4636, 0x56585c, 0x5b4b3d]), P.ROOF_TILE, s), wall, 0.4);
      break;
    }
    case 'sawtooth': {
      // North-light sheds: a row of small pitched roofs with glazed faces.
      const step = 6;
      for (let z = z0; z < z1 - 0.5; z += step) g.gable(x0, z, x1, Math.min(z1, z + step), h, 2.4, true, mat(0x8f8c86, P.METAL, s), mat(0x6d8fa8, P.GLASS_PLAIN, s), 0.05);
      break;
    }
    case 'barrel':
      barrel(g, x0, z0, x1, z1, h, Math.min(6, (z1 - z0) * 0.25), mat(0xa9b0b4, P.METAL, s), wall);
      break;
    case 'dome': {
      const R = (x1 - x0) / 2, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      g.lathe(cx, cz, [[R, h], [R * 0.93, h + R * 0.38], [R * 0.72, h + R * 0.7], [R * 0.4, h + R * 0.92], [0.01, h + R]], 24, mat(r.pick([0xd8d4cc, 0x9aa6b0, 0x5e7f92]), P.METAL, s, 3, 3));
      break;
    }
    case 'cone': {
      const R = (x1 - x0) / 2, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      g.lathe(cx, cz, [[R + 0.4, h], [0.01, h + R * 0.8]], 20, mat(0x5b4b3d, P.ROOF_TILE, s));
      break;
    }
    case 'garden': {
      g.flat(x0 + 0.6, z0 + 0.6, x1 - 0.6, z1 - 0.6, h + 0.25, mat(0x6f8a45, P.GRASS, s));
      const n = Math.min(8, Math.floor(((x1 - x0) * (z1 - z0)) / 40));
      for (let i = 0; i < n; i++) g.prop({ kind: 'bush', x: r.range(x0 + 1.5, x1 - 1.5), y: h + 0.25, z: r.range(z0 + 1.5, z1 - 1.5), rot: r.next() * 6, scale: r.range(0.6, 1) });
      parapet(g, sec, h, s);
      break;
    }
    case 'solar': {
      for (let z = z0 + 1; z + 2.6 < z1 - 0.8; z += 3.6) panelRow(g, x0 + 1, x1 - 1, z, z + 2.6, h, s);
      parapet(g, sec, h, s);
      break;
    }
    default:
      void flatMat;
      parapet(g, sec, h, s);
  }
}

function parapet(g: GeoBuilder, sec: Section, h: number, s: number): void {
  if (sec.shape !== 'block') return;
  const pm = mat(0xb5b2aa, P.PLAIN, s);
  const t = 0.3;
  const { x0, z0, x1, z1 } = sec;
  g.box(x0, z0, x1, z0 + t, h, h + 0.8, pm, pm);
  g.box(x0, z1 - t, x1, z1, h, h + 0.8, pm, pm);
  g.box(x0, z0 + t, x0 + t, z1 - t, h, h + 0.8, pm, pm);
  g.box(x1 - t, z0 + t, x1, z1 - t, h, h + 0.8, pm, pm);
}

function drawSection(g: GeoBuilder, spec: ArchSpec, sec: Section, r: Rng, s: number): void {
  const h = sectionHeight(sec);
  const wall = mat(sec.wall.color, wallPattern(sec.wall, sec.role), s, sec.wall.fh, sec.wall.bay);
  const top = mat(spec.roofColor, P.ROOF_FLAT, s);
  if (sec.shape === 'drum') {
    const R = (sec.x1 - sec.x0) / 2;
    g.cylinder((sec.x0 + sec.x1) / 2, (sec.z0 + sec.z1) / 2, R, R, 0, h, 24, wall, sec.roof === 'flat' ? top : null);
  } else {
    g.box(sec.x0, sec.z0, sec.x1, sec.z1, 0, h, wall, top);
  }
  drawRoof(g, sec, spec.roofColor, wall, r, s);
}

function drawEntrance(g: GeoBuilder, spec: ArchSpec, sec: Section, s: number): void {
  const cx = (sec.x0 + sec.x1) / 2;
  const z0 = sec.shape === 'drum' ? sec.z0 + 0.02 : sec.z0;
  const h = sectionHeight(sec);
  g.wall(cx + 2, z0 - 0.05, cx - 2, z0 - 0.05, 0.05, 3.2, mat(0x3a3f44, P.DOOR, s));
  // A canopy over the door on two slim columns, and a path to the street.
  const acc = mat(spec.accent, P.PLAIN, s);
  g.box(cx - 3.6, z0 - 3.4, cx + 3.6, z0, 3.5, 3.85, acc, mat(0x8a8780, P.ROOF_FLAT, s));
  for (const x of [cx - 3.2, cx + 3.2]) g.cylinder(x, z0 - 3, 0.15, 0.15, 0, 3.5, 6, mat(0x9aa0a4, P.METAL, s), null);
  g.ground(cx - 2.2, 0.4, cx + 2.2, z0, mat(0xc8c2b6, P.PAVING, s), 0.08);
  // The name band in the field's colour.
  if (spec.sign && sec.shape === 'block' && h > 6) g.box(sec.x0 + 1, sec.z0 - 0.07, sec.x1 - 1, sec.z0, h - 1.7, h - 0.7, mat(spec.accent, P.SIGN, s, 1, sec.x1 - sec.x0 - 2), null);
}

function drawModule(g: GeoBuilder, spec: ArchSpec, m: Module, r: Rng, s: number): void {
  const y0 = m.onRoof !== undefined ? sectionHeight(spec.sections[m.onRoof]) : 0;
  const { x, z, w, d, h } = m;
  const metal = mat(0xd8d6cf, P.METAL, s);
  const steel = mat(0x8d9296, P.METAL, s);
  const conc = mat(0xbcb8ae, P.CONCRETE, s);
  const accent = mat(spec.accent, P.PLAIN, s);
  switch (m.kind) {
    case 'stack':
      g.cylinder(x, z, 2.3, 1.7, y0, y0 + h, 14, mat(0xd0ccc4, P.CONCRETE, s), mat(0x2a2a2a, P.PLAIN, s));
      g.cylinder(x, z, 1.85, 1.85, y0 + h - 6, y0 + h - 4, 14, accent, null);
      g.prop({ kind: 'steam', x, y: y0 + h, z, rot: 0, scale: 1.3 });
      break;
    case 'tank':
      g.cylinder(x, z, w / 2, w / 2, y0, y0 + h, 18, metal, null);
      g.lathe(x, z, [[w / 2, y0 + h], [w * 0.3, y0 + h + 1], [0.01, y0 + h + 1.4]], 18, metal);
      g.cylinder(x, z, w / 2 + 0.05, w / 2 + 0.05, y0 + h - 1.2, y0 + h - 0.6, 18, accent, null);
      break;
    case 'sphere': {
      const R = w / 2 - 0.5;
      for (const [dx, dz] of [[-R * 0.6, -R * 0.6], [R * 0.6, -R * 0.6], [-R * 0.6, R * 0.6], [R * 0.6, R * 0.6]]) g.cylinder(x + dx, z + dz, 0.3, 0.3, y0, y0 + 3.6, 6, steel, null);
      g.lathe(x, z, [[0.01, y0 + 2.4], [R * 0.7, y0 + 2.9], [R, y0 + 2.4 + R], [R * 0.7, y0 + 2.4 + R * 1.7], [0.01, y0 + 2.4 + R * 2]], 18, metal);
      break;
    }
    case 'cooling': {
      const R = w / 2;
      g.lathe(x, z, [[R, y0], [R * 0.86, y0 + h * 0.25], [R * 0.66, y0 + h * 0.72], [R * 0.64, y0 + h * 0.86], [R * 0.72, y0 + h]], 28, mat(0xd6d4ce, P.CONCRETE, s));
      g.prop({ kind: 'steam', x, y: y0 + h, z, rot: 0, scale: 2.4 * (R / 12) });
      break;
    }
    case 'solarArray':
      panelRow(g, x - w / 2, x + w / 2, z - d / 2, z + d / 2 - 1.4, y0, s);
      break;
    case 'rotor':
      // The turbine tower and blades are shared assets (like the Wind Turbine's).
      g.box(x - 1.5, z - 1, x + 1.5, z + 1, y0, y0 + 2.2, steel, steel);
      g.prop({ kind: 'rotor', x, y: y0 + 48.8, z, rot: -Math.PI / 2 + (s / 255) * 0.4, variant: s });
      break;
    case 'mast':
      g.cylinder(x, z, 0.55, 0.22, y0, y0 + h, 6, mat(0xc0392b, P.METAL, s), null);
      for (let k = 1; k <= 3; k++) g.box(x - 1.1, z - 0.15, x + 1.1, z + 0.15, y0 + (h * k) / 4, y0 + (h * k) / 4 + 0.25, steel, steel);
      g.box(x - 0.35, z - 0.35, x + 0.35, z + 0.35, y0 + h, y0 + h + 0.7, mat(0xff2a1a, P.SIGN, s, 1, 1), null);
      break;
    case 'dome': {
      const R = w / 2;
      g.cylinder(x, z, R, R, y0, y0 + 3.2, 20, conc, null);
      g.lathe(x, z, [[R, y0 + 3.2], [R * 0.9, y0 + 3.2 + R * 0.45], [R * 0.6, y0 + 3.2 + R * 0.82], [0.01, y0 + 3.2 + R]], 20, mat(0xe4e2dc, P.METAL, s));
      g.box(x - 0.6, z - R - 0.1, x + 0.6, z - R * 0.3, y0 + 3.2 + R * 0.5, y0 + 3.2 + R * 0.95, mat(0x2a2f35, P.PLAIN, s), null);
      break;
    }
    case 'cellRack':
      g.box(x - w / 2, z - d / 2, x + w / 2, z + d / 2, y0, y0 + h, mat(0xeceae4, P.INDUSTRIAL, s, 3, 1.2), mat(0xc9c6bf, P.METAL, s));
      g.box(x - w / 2 - 0.02, z - d / 2 - 0.02, x + w / 2 + 0.02, z - d / 2, y0 + h - 0.7, y0 + h - 0.35, accent, null);
      for (let k = 0; k < 3; k++) g.box(x - w / 2 + 1 + k * (w / 3), z - 0.6, x - w / 2 + 2.2 + k * (w / 3), z + 0.6, y0 + h, y0 + h + 0.6, steel, steel);
      break;
    case 'coilTower': {
      const R = w / 2;
      for (let k = 0, y = y0; y < y0 + h - 1; k++, y += 1.6) g.cylinder(x, z, k % 2 ? R * 0.62 : R * 0.9, k % 2 ? R * 0.62 : R * 0.9, y, y + 1.6, 14, k % 2 ? steel : mat(0xb87333, P.METAL, s), null);
      g.lathe(x, z, [[0.01, y0 + h - 1], [R * 0.75, y0 + h], [R * 0.5, y0 + h + R * 0.7], [0.01, y0 + h + R]], 14, metal);
      break;
    }
    case 'greenhouse': {
      const gl = mat(0x9fc4c4, P.GLASS_PLAIN, s, 2.5, 1.6);
      g.box(x - w / 2, z - d / 2, x + w / 2, z + d / 2, y0, y0 + 3.4, gl, null);
      g.gable(x - w / 2, z - d / 2, x + w / 2, z + d / 2, y0 + 3.4, 2.2, false, gl, gl, 0.05);
      g.ground(x - w / 2 + 0.6, z - d / 2 + 0.6, x + w / 2 - 0.6, z + d / 2 - 0.6, mat(0x4f8a3a, P.FIELD, s), 0.12 + y0);
      break;
    }
    case 'silo':
      g.cylinder(x, z, w / 2, w / 2, y0, y0 + h, 16, mat(0xd8d4cc, P.METAL, s, 3, 1.5), null);
      g.lathe(x, z, [[w / 2 + 0.2, y0 + h], [0.01, y0 + h + w * 0.45]], 16, steel);
      break;
    case 'basin':
      g.cylinder(x, z, w / 2, w / 2, y0, y0 + h, 22, conc, mat(0x3f8fb0, P.WATER, s));
      g.box(x - 0.3, z - w / 2, x + 0.3, z + w / 2, y0 + h, y0 + h + 0.5, steel, steel);
      break;
    case 'finTower': {
      const core = w * 0.36;
      g.box(x - core, z - core, x + core, z + core, y0, y0 + h, mat(0x8a9399, P.METAL, s), mat(0x6f8a45, P.GRASS, s));
      for (let k = -2; k <= 2; k++) {
        const o = (k / 2) * core;
        g.box(x + o - 0.12, z - w / 2, x + o + 0.12, z - core, y0 + 1, y0 + h - 0.6, accent, accent);
        g.box(x + o - 0.12, z + core, x + o + 0.12, z + w / 2, y0 + 1, y0 + h - 0.6, accent, accent);
      }
      break;
    }
    case 'turbineHouse':
      g.box(x - w / 2, z - d / 2, x + w / 2, z + d / 2, y0, y0 + h, mat(0xc8c4ba, P.INDUSTRIAL, s, h, 1.5), mat(0x8f8c86, P.ROOF_FLAT, s));
      for (let k = 0; k < 3; k++) g.box(x - w / 2 + 2 + k * 3.5, z - 1, x - w / 2 + 3.6 + k * 3.5, z + 1, y0 + h, y0 + h + 1.2, steel, steel);
      break;
    case 'canopy':
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.cylinder(x + (dx * (w / 2 - 0.4)), z + (dz * (d / 2 - 0.4)), 0.18, 0.18, y0, y0 + h, 6, steel, null);
      g.box(x - w / 2, z - d / 2, x + w / 2, z + d / 2, y0 + h, y0 + h + 0.3, mat(0xe8e6e0, P.PLAIN, s), mat(0x9aa0a4, P.ROOF_FLAT, s));
      break;
    case 'pitch':
      // A school sports pitch with a running track around it.
      g.ground(x - w / 2, z - d / 2, x + w / 2, z + d / 2, mat(0xa04a32, P.DIRT, s), 0.07 + y0);
      g.ground(x - w / 2 + 1.5, z - d / 2 + 1.5, x + w / 2 - 1.5, z + d / 2 - 1.5, mat(0x4f9a3a, P.FIELD, s), 0.1 + y0);
      break;
    case 'fountain':
      g.cylinder(x, z, w / 2, w / 2, y0, y0 + 0.6, 20, mat(0xd8d0bf, P.CONCRETE, s), mat(0x3f8fb0, P.WATER, s));
      g.prop({ kind: 'fountain', x, y: y0 + 0.6, z, rot: 0 });
      break;
    case 'pipes':
      break;
  }
  void r;
}

/** Pipe runs at head height from the main hall to the tanks, silos and basins. */
function drawPipes(g: GeoBuilder, spec: ArchSpec, s: number): void {
  const hub = spec.sections.find((sec) => sec.role === 'hall') ?? spec.sections[0];
  if (!hub) return;
  const hx = hub.x0 < 0 && hub.x1 <= 0 ? hub.x1 : hub.x1 > 0 && hub.x0 >= 0 ? hub.x0 : (hub.x0 + hub.x1) / 2;
  const hz = (hub.z0 + hub.z1) / 2;
  const pipe = mat(0xe0a020, P.METAL, s);
  const y = 3.2;
  let n = 0;
  for (const m of spec.modules) {
    if (m.onRoof !== undefined || !['tank', 'sphere', 'silo', 'basin', 'cellRack', 'cooling'].includes(m.kind) || n >= 5) continue;
    n++;
    const x1 = m.x, z1 = m.z;
    g.box(Math.min(hx, x1) - 0.2, hz - 0.2, Math.max(hx, x1) + 0.2, hz + 0.2, y, y + 0.4, pipe, pipe);
    g.box(x1 - 0.2, Math.min(hz, z1) - 0.2, x1 + 0.2, Math.max(hz, z1) + 0.2, y, y + 0.4, pipe, pipe);
    for (const [px, pz] of [[x1, hz], [(hx + x1) / 2, hz]]) g.box(px - 0.12, pz - 0.12, px + 0.12, pz + 0.12, 0, y, pipe, null);
  }
}

/** Trees where nothing else stands (keeping clear of the forecourt). */
function plantTrees(g: GeoBuilder, spec: ArchSpec, r: Rng): void {
  let n = spec.trees;
  const free = (x: number, z: number) => {
    if (z < 7.5 && Math.abs(x) < spec.w / 2 - 3) return false;
    for (const sec of spec.sections) if (x > sec.x0 - 2 && x < sec.x1 + 2 && z > sec.z0 - 2 && z < sec.z1 + 2) return false;
    for (const m of spec.modules) if (m.onRoof === undefined && m.w > 0 && x > m.x - m.w / 2 - 2 && x < m.x + m.w / 2 + 2 && z > m.z - m.d / 2 - 2 && z < m.z + m.d / 2 + 2) return false;
    return true;
  };
  for (let i = 0; i < 60 && n > 0; i++) {
    const x = r.range(-spec.w / 2 + 2, spec.w / 2 - 2), z = r.range(2, spec.d - 2);
    if (!free(x, z)) continue;
    g.prop({ kind: 'tree', x, y: 0, z, rot: r.next() * 6.28, scale: r.range(0.65, 1), variant: r.int(0, 2) });
    n--;
  }
}

/** Builds a composed building into the geometry builder (lot space). */
export function buildArch(g: GeoBuilder, spec: ArchSpec, seed: number, r: Rng): void {
  const s = seed & 255;
  const { w, d } = spec;
  const ground = spec.ground === 'grass' ? mat(0x6f8a45, P.GRASS, s) : spec.ground === 'paving' ? mat(0xb9b5ad, P.PAVING, s) : mat(0xa8a49c, P.CONCRETE, s);
  g.ground(-w / 2, 0, w / 2, d, ground, 0.04);
  g.ground(-w / 2 + 1, 0.4, w / 2 - 1, 6.4, mat(0xc4beb2, P.PAVING, s), 0.06);
  for (const sec of spec.sections) drawSection(g, spec, sec, r, s);
  const door = spec.sections.find((sec) => sec.entrance);
  if (door) drawEntrance(g, spec, door, s);
  for (const m of spec.modules) drawModule(g, spec, m, r, s);
  if (spec.modules.some((m) => m.kind === 'pipes')) drawPipes(g, spec, s);
  plantTrees(g, spec, r);
  if (spec.fence) {
    const fm = mat(0x6f7478, P.PLAIN, s);
    const t = 0.08, fh = 2.2;
    g.box(w / 2 - 0.2 - t, 0.2, w / 2 - 0.2, d - 0.2, 0, fh, fm, fm);
    g.box(-w / 2 + 0.2, d - 0.2 - t, w / 2 - 0.2, d - 0.2, 0, fh, fm, fm);
    g.box(-w / 2 + 0.2, 0.2, -w / 2 + 0.2 + t, d - 0.2, 0, fh, fm, fm);
  }
}
