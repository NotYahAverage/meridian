import { Rng } from '../../core/rng';
import type { ComponentKind, FieldId, FunctionKind, ModuleKind, SurfaceLook } from './Knowledge';

/**
 * Procedural architecture: a building is composed from sections (blocks and
 * drums with compatible roofs), equipment modules and a lot layout, following
 * fixed rules so the result always reads as a coherent building that fits its
 * lot. This file only produces the description (an ArchSpec); the renderer
 * turns it into geometry (render/buildings/procedural.ts).
 *
 * Lot space: x from -w/2 to w/2 across the frontage, z from 0 (the street)
 * to d (the back of the lot).
 */

export type RoofKind = 'flat' | 'gable' | 'sawtooth' | 'barrel' | 'dome' | 'cone' | 'garden' | 'solar';

/** A wall finish: colour, surface and facade rhythm. */
export interface ArchMat {
  color: number;
  surface: SurfaceLook | 'industrial';
  /** Storey height (m) and window bay (m) used by the facade pattern. */
  fh: number;
  bay: number;
}

export interface Section {
  shape: 'block' | 'drum';
  /** Footprint bounds (a drum is the circle inside them). */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  floors: number;
  floorH: number;
  roof: RoofKind;
  wall: ArchMat;
  role: 'main' | 'wing' | 'hall' | 'annex';
  /** The public entrance is on this section's street face. */
  entrance?: boolean;
}

export interface Module {
  kind: ModuleKind;
  /** Centre and size in lot space. */
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** Sits on the flat roof of this section instead of the ground. */
  onRoof?: number;
}

export interface ArchSpec {
  w: number;
  d: number;
  ground: 'paving' | 'grass' | 'concrete';
  sections: Section[];
  modules: Module[];
  roofColor: number;
  accent: number;
  fence: boolean;
  trees: number;
  /** Lettered band with the accent colour over the entrance. */
  sign: boolean;
}

export interface ComposeInput {
  w: number;
  d: number;
  seed: number;
  fn: FunctionKind | 'lab';
  field: FieldId;
  /** Equipment that marks the discovery behind it. */
  modules: ModuleKind[];
  /** Main material (from the substance it was made with). */
  look: { color: number; surface: SurfaceLook };
  /** Architectural components the civilization has discovered. */
  components: ComponentKind[];
  accent: number;
  /** 0–1: how large/strong the facility is (more equipment, taller). */
  scale: number;
  /** Research centres grow with their equipment level. */
  level?: number;
}

type Layout = 'compact' | 'hall' | 'field';

interface Profile {
  layout: Layout;
  floors: [number, number];
  floorH: [number, number];
  ground: ArchSpec['ground'];
  trees: [number, number];
  fence: boolean;
  /** Equipment every building of this kind gets, besides the discovery's own. */
  base: ModuleKind[];
}

const PROFILE: Record<FunctionKind | 'lab', Profile> = {
  powerGen: { layout: 'hall', floors: [1, 1], floorH: [9, 14], ground: 'concrete', trees: [0, 2], fence: true, base: [] },
  storage: { layout: 'field', floors: [1, 2], floorH: [3.6, 4.2], ground: 'concrete', trees: [0, 2], fence: true, base: ['pipes'] },
  water: { layout: 'hall', floors: [1, 2], floorH: [4.5, 5.5], ground: 'concrete', trees: [1, 3], fence: true, base: ['tank'] },
  sewage: { layout: 'hall', floors: [1, 1], floorH: [4.5, 6], ground: 'concrete', trees: [2, 4], fence: true, base: ['basin'] },
  waste: { layout: 'hall', floors: [1, 1], floorH: [10, 14], ground: 'concrete', trees: [0, 2], fence: true, base: ['silo'] },
  farm: { layout: 'field', floors: [1, 2], floorH: [3.6, 4.4], ground: 'grass', trees: [3, 6], fence: false, base: ['silo'] },
  scrubber: { layout: 'field', floors: [1, 1], floorH: [3.6, 4], ground: 'grass', trees: [6, 10], fence: false, base: [] },
  clinic: { layout: 'compact', floors: [2, 4], floorH: [3.8, 4.2], ground: 'paving', trees: [2, 4], fence: false, base: ['canopy'] },
  school: { layout: 'compact', floors: [2, 3], floorH: [4, 4.4], ground: 'grass', trees: [4, 8], fence: false, base: ['pitch'] },
  civic: { layout: 'compact', floors: [2, 4], floorH: [4.5, 5.5], ground: 'paving', trees: [4, 6], fence: false, base: ['fountain'] },
  lab: { layout: 'compact', floors: [2, 3], floorH: [3.9, 4.3], ground: 'paving', trees: [2, 5], fence: false, base: [] },
};

/** Footprint (w × d) and height of each module kind at a 0–1 scale. */
function moduleSize(kind: ModuleKind, s: number, r: Rng): { w: number; d: number; h: number } {
  const k = 0.8 + 0.4 * s;
  switch (kind) {
    case 'stack': return { w: 5, d: 5, h: (28 + r.range(0, 22)) * k };
    case 'tank': { const t = 8 + r.range(0, 4); return { w: t, d: t, h: 6 + r.range(0, 5) }; }
    case 'sphere': return { w: 11, d: 11, h: 12 };
    case 'cooling': { const t = 18 + 8 * s; return { w: t, d: t, h: 34 + 20 * s }; }
    case 'solarArray': return { w: 18 + r.range(0, 10), d: 5, h: 2 };
    case 'rotor': return { w: 12, d: 12, h: 30 + 16 * s };
    case 'mast': return { w: 3, d: 3, h: 22 + r.range(0, 14) };
    case 'dome': { const t = 12 + 4 * s; return { w: t, d: t, h: t * 0.7 }; }
    case 'cellRack': return { w: 12, d: 4, h: 3 };
    case 'coilTower': return { w: 6, d: 6, h: 14 + 10 * s };
    case 'greenhouse': return { w: 10, d: 14 + r.range(0, 6), h: 5.5 };
    case 'silo': return { w: 6, d: 6, h: 12 + r.range(0, 8) };
    case 'basin': { const t = 11 + r.range(0, 3); return { w: t, d: t, h: 2.2 }; }
    case 'finTower': return { w: 6, d: 6, h: 14 + 10 * s };
    case 'turbineHouse': return { w: 12, d: 14, h: 9 };
    case 'pipes': return { w: 0, d: 0, h: 3.2 };
    case 'canopy': return { w: 8, d: 6, h: 4 };
    case 'pitch': return { w: 22, d: 14, h: 0.2 };
    case 'fountain': return { w: 8, d: 8, h: 1.2 };
  }
}

/** How many of each module a building carries. */
function moduleCount(kind: ModuleKind, s: number, layout: Layout, r: Rng): number {
  const big = layout === 'field' ? 1.6 : 1;
  switch (kind) {
    case 'cellRack': return Math.round((4 + 6 * s) * big);
    case 'solarArray': return Math.round((3 + 4 * s) * big);
    case 'greenhouse': return Math.round((2 + 2 * s) * big);
    case 'rotor': return 2 + Math.round(2 * s);
    case 'finTower': return Math.round((3 + 3 * s) * (big > 1 ? 1.2 : 1));
    case 'tank': return 2 + r.int(0, 2);
    case 'basin': return 2 + Math.round(2 * s);
    case 'silo': return 1 + r.int(0, 2);
    case 'stack': return 1 + (s > 0.6 ? 1 : 0);
    case 'sphere': return 1 + r.int(0, 1);
    case 'cooling': return 1 + (s > 0.7 ? 1 : 0);
    case 'coilTower': return 1 + (s > 0.5 ? 1 : 0);
    default: return 1;
  }
}

/** Equipment that may also stand on a flat roof. */
const ROOF_OK: Partial<Record<ModuleKind, boolean>> = { solarArray: true, coilTower: true, mast: true, finTower: true, canopy: false };

const GROUND_MARGIN = 1.5;
const FORECOURT = 7;

/** Roofs a section may carry (the compatibility rules). */
export function allowedRoofs(sec: Pick<Section, 'shape' | 'floors' | 'role'>): RoofKind[] {
  if (sec.shape === 'drum') return ['dome', 'cone', 'flat'];
  if (sec.role === 'hall') return ['sawtooth', 'barrel', 'flat', 'solar'];
  if (sec.floors >= 4) return ['flat', 'garden', 'solar'];
  return ['flat', 'gable', 'garden', 'solar', 'barrel'];
}

function wallFor(look: ComposeInput['look'], comps: Set<ComponentKind>, fn: ComposeInput['fn'], role: Section['role'], r: Rng, fh: number): ArchMat {
  // Discovered materials take over from the raw look where they suit the building.
  let surface: ArchMat['surface'] = look.surface;
  let color = look.color;
  const people = fn === 'clinic' || fn === 'school' || fn === 'civic' || fn === 'lab';
  if (role === 'hall') {
    surface = 'industrial';
    color = mixHex(look.color, 0xc8c4ba, 0.55);
  } else if (people && comps.has('glass') && r.chance(0.6)) {
    surface = 'glass';
    color = 0x5e7f92;
  } else if (comps.has('timber') && r.chance(0.5)) {
    surface = 'timber';
    color = 0x9a6b42;
  } else if (comps.has('stone') && r.chance(0.5)) {
    surface = 'stone';
    color = 0xcfc6b2;
  } else if (comps.has('brick') && r.chance(0.5)) {
    surface = 'brick';
    color = 0x9a5b45;
  }
  // Surfaces without windows read as sheds on a building people work in.
  if (people && (surface === 'metal' || surface === 'green')) surface = 'render';
  return { color, surface, fh, bay: surface === 'glass' ? 2.4 : surface === 'industrial' ? 1.6 : 3 + r.range(0, 0.6) };
}

export function mixHex(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round((((a >> s) & 255) * (1 - t)) + (((b >> s) & 255) * t));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function pickRoof(sec: Section, comps: Set<ComponentKind>, fn: ComposeInput['fn'], r: Rng): RoofKind {
  const ok = allowedRoofs(sec);
  const weights: Partial<Record<RoofKind, number>> = { flat: 1.2 };
  if (comps.has('gardenRoof')) weights.garden = 1.4;
  if (comps.has('solarRoof') || fn === 'storage') weights.solar = comps.has('solarRoof') ? 1.3 : 0.3;
  if (comps.has('dome') || fn === 'civic' || fn === 'lab') weights.dome = 1.6;
  weights.cone = 0.5;
  if (sec.wall.surface === 'brick' || sec.wall.surface === 'timber' || sec.wall.surface === 'render' || sec.wall.surface === 'stone') weights.gable = 1;
  weights.sawtooth = 1.3;
  weights.barrel = 0.6;
  return r.weighted(ok, (k) => weights[k] ?? 0) ?? ok[0];
}

/** Composes a coherent building for a lot. Deterministic for the same input. */
export function composeArch(inp: ComposeInput): ArchSpec {
  const r = new Rng((inp.seed ^ 0x51d3a7) >>> 0);
  const { w, d } = inp;
  const prof = PROFILE[inp.fn];
  const comps = new Set(inp.components);
  const s = Math.max(0, Math.min(1, inp.scale));
  const level = inp.level ?? 1;
  const bx0 = -w / 2 + 2, bx1 = w / 2 - 2, bz0 = FORECOURT, bz1 = d - 2;
  const bw = bx1 - bx0, bd = bz1 - bz0;
  const floorH = r.range(prof.floorH[0], prof.floorH[1]);
  const extraFloors = (comps.has('tallFrame') && prof.layout === 'compact' ? 2 : 0) + (inp.fn === 'lab' ? level - 1 : 0);
  const sections: Section[] = [];
  const add = (sec: Omit<Section, 'roof'>) => {
    const full = { ...sec, roof: 'flat' as RoofKind };
    full.roof = pickRoof(full, comps, inp.fn, r);
    sections.push(full);
    return full;
  };

  if (prof.layout === 'compact') {
    // Leave a yard deep enough for the biggest piece of ground equipment (a pitch, a dome…).
    const yard = Math.max(0, ...[...inp.modules, ...prof.base].filter((k) => !ROOF_OK[k] && k !== 'pipes' && k !== 'canopy').map((k) => moduleSize(k, s, new Rng(1)).d + 2 * GROUND_MARGIN + 2));
    const mw = Math.max(12, bw * r.range(0.45, 0.68));
    const md = Math.max(10, Math.min(bd * r.range(0.4, 0.62), bd - yard));
    const cx = r.range(-1, 1) * Math.max(0, (bw - mw) / 2) * 0.4;
    const floors = r.int(prof.floors[0], prof.floors[1]) + extraFloors;
    const drum = (inp.fn === 'civic' || inp.fn === 'lab') && (comps.has('dome') ? r.chance(0.6) : r.chance(0.25));
    const side = drum ? Math.min(mw, md) : 0;
    const main = add({
      shape: drum ? 'drum' : 'block',
      x0: cx - (drum ? side : mw) / 2, x1: cx + (drum ? side : mw) / 2, z0: bz0, z1: bz0 + (drum ? side : md),
      floors, floorH, wall: wallFor(inp.look, comps, inp.fn, 'main', r, floorH), role: 'main', entrance: true,
    });
    // Wings join the main mass flush on its sides or back, never taller than it.
    const wings = r.int(inp.fn === 'lab' ? Math.min(2, level) : 0, 2);
    // Wings don't build over the yard the equipment needs.
    const sides = r.shuffle(yard > 0 ? (['left', 'right'] as const) : (['left', 'right', 'back'] as const));
    for (let k = 0; k < wings; k++) {
      const where = sides[k];
      if (!where) break;
      const wf = Math.max(1, main.floors - r.int(1, 2));
      const wall = wallFor(inp.look, comps, inp.fn, 'wing', r, floorH);
      const zr0 = main.z0 + r.range(0, 3), zr1 = Math.min(bz1, main.z1 - r.range(0, 3));
      if ((where === 'left' || where === 'right') && zr1 - zr0 < 6) continue;
      if (where === 'left' && main.x0 - bx0 >= 7) {
        const ww = (main.x0 - bx0) * r.range(0.6, 0.95);
        add({ shape: 'block', x0: main.x0 - ww, x1: main.x0, z0: zr0, z1: zr1, floors: wf, floorH, wall, role: 'wing' });
      } else if (where === 'right' && bx1 - main.x1 >= 7) {
        const ww = (bx1 - main.x1) * r.range(0.6, 0.95);
        add({ shape: 'block', x0: main.x1, x1: main.x1 + ww, z0: zr0, z1: zr1, floors: wf, floorH, wall, role: 'wing' });
      } else if (where === 'back' && bz1 - main.z1 >= 8) {
        const dd = (bz1 - main.z1) * r.range(0.5, 0.85);
        const half = Math.min(main.x1 - main.x0, bw) * r.range(0.35, 0.5);
        const mid = (main.x0 + main.x1) / 2;
        add({ shape: 'block', x0: mid - half, x1: mid + half, z0: main.z1, z1: main.z1 + dd, floors: wf, floorH, wall, role: 'wing' });
      }
    }
  } else if (prof.layout === 'hall') {
    const hw = Math.max(12, bw * r.range(0.38, 0.52));
    const hd = Math.max(12, bd * r.range(0.5, 0.78));
    const left = r.chance(0.5);
    const hx0 = left ? bx0 : bx1 - hw;
    const hz0 = bz0 + r.range(1, 4);
    const hall = add({ shape: 'block', x0: hx0, x1: hx0 + hw, z0: hz0, z1: Math.min(bz1, hz0 + hd), floors: 1, floorH: floorH * (0.85 + 0.3 * s), wall: wallFor(inp.look, comps, inp.fn, 'hall', r, floorH), role: 'hall' });
    // A two-storey office annex beside the hall, facing the street, holds the entrance.
    const aw = Math.min(14, Math.max(8, bw * 0.22));
    const ax0 = left ? hall.x1 : hall.x0 - aw;
    add({ shape: 'block', x0: ax0, x1: ax0 + aw, z0: bz0, z1: bz0 + Math.min(12, hd * 0.5), floors: 2, floorH: 3.6, wall: wallFor(inp.look, comps, 'lab', 'annex', r, 3.6), role: 'annex', entrance: true });
  } else {
    // Field layout: a small control building at a front corner; the rest is equipment.
    const cw = Math.min(16, Math.max(10, bw * 0.3)), cd = Math.min(12, Math.max(8, bd * 0.3));
    const left = r.chance(0.5);
    const x0 = left ? bx0 : bx1 - cw;
    add({ shape: 'block', x0, x1: x0 + cw, z0: bz0, z1: bz0 + cd, floors: r.int(prof.floors[0], prof.floors[1]), floorH, wall: wallFor(inp.look, comps, inp.fn, 'annex', r, floorH), role: 'annex', entrance: true });
  }

  // ── Equipment ──
  const modules: Module[] = [];
  const kinds: ModuleKind[] = [...inp.modules, ...prof.base];
  if (comps.has('solarRoof') && !kinds.includes('solarArray') && r.chance(0.5)) kinds.push('solarArray');
  const blocked = (x0: number, z0: number, x1: number, z1: number) => {
    if (x0 < -w / 2 + 1 || x1 > w / 2 - 1 || z0 < FORECOURT - 1 || z1 > d - 1) return true;
    for (const sec of sections) if (x0 < sec.x1 + GROUND_MARGIN && x1 > sec.x0 - GROUND_MARGIN && z0 < sec.z1 + GROUND_MARGIN && z1 > sec.z0 - GROUND_MARGIN) return true;
    for (const m of modules) if (m.onRoof === undefined && m.w > 0 && x0 < m.x + m.w / 2 + 1 && x1 > m.x - m.w / 2 - 1 && z0 < m.z + m.d / 2 + 1 && z1 > m.z - m.d / 2 - 1) return true;
    return false;
  };
  // Candidate spots on a 2 m grid, visited in a seeded order.
  const spots: [number, number][] = [];
  for (let z = FORECOURT; z < d; z += 2) for (let x = -w / 2; x < w / 2; x += 2) spots.push([x, z]);
  // Rows of equipment pack neatly from the back of the lot; single pieces scatter.
  const rowOrder = spots.map((_, i) => i).sort((a, b) => spots[b][1] - spots[a][1] || spots[a][0] - spots[b][0]);
  const scatter = r.shuffle(spots.map((_, i) => i));
  const ROWS: Partial<Record<ModuleKind, boolean>> = { cellRack: true, solarArray: true, greenhouse: true, basin: true, tank: true, finTower: true, rotor: true };
  const flatRoofs = sections.map((sec, i) => ({ sec, i })).filter(({ sec }) => sec.shape === 'block' && (sec.roof === 'flat' || sec.roof === 'solar'));
  for (const kind of [...new Set(kinds)]) {
    if (kind === 'pipes') {
      modules.push({ kind, x: 0, z: 0, w: 0, d: 0, h: moduleSize(kind, s, r).h });
      continue;
    }
    const n = moduleCount(kind, s, prof.layout, r);
    for (let k = 0; k < n; k++) {
      const sz = moduleSize(kind, s, r);
      let placed = false;
      for (const idx of ROWS[kind] ? rowOrder : scatter) {
        const [sx, sz0] = spots[idx];
        const x0 = sx, z0 = sz0, x1 = sx + sz.w, z1 = sz0 + sz.d;
        if (blocked(x0, z0, x1, z1)) continue;
        modules.push({ kind, x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: sz.w, d: sz.d, h: sz.h });
        placed = true;
        break;
      }
      // No room on the ground: small equipment goes on a flat roof.
      if (!placed && ROOF_OK[kind]) {
        for (const { sec, i } of flatRoofs) {
          const used = modules.filter((m) => m.onRoof === i).length;
          const rw = sec.x1 - sec.x0 - 3, rd = sec.z1 - sec.z0 - 3;
          // Side by side along the roof, a metre apart.
          if (sz.w > rw || used >= Math.floor((rw + 1) / (sz.w + 1))) continue;
          modules.push({ kind, x: sec.x0 + 1.5 + sz.w / 2 + used * (sz.w + 1), z: (sec.z0 + sec.z1) / 2, w: sz.w, d: Math.min(sz.d, rd), h: Math.min(sz.h, 10), onRoof: i });
          placed = true;
          break;
        }
      }
    }
  }
  return {
    w, d,
    ground: prof.ground,
    sections,
    modules,
    roofColor: r.pick([0x5b5f63, 0x6a6f72, 0x7d7a74, 0x4a4b4e]),
    accent: inp.accent,
    fence: prof.fence,
    trees: r.int(prof.trees[0], prof.trees[1]),
    sign: true,
  };
}

/** Checks the composition rules. Returns the problems found (none for a valid building). */
export function validateArch(spec: ArchSpec): string[] {
  const out: string[] = [];
  const { w, d } = spec;
  const inLot = (x0: number, z0: number, x1: number, z1: number) => x0 >= -w / 2 + 0.4 && x1 <= w / 2 - 0.4 && z0 >= 0.4 && z1 <= d - 0.4;
  if (!spec.sections.length) out.push('no building sections');
  spec.sections.forEach((sec, i) => {
    if (!inLot(sec.x0, sec.z0, sec.x1, sec.z1)) out.push(`section ${i} leaves the lot`);
    if (sec.x1 - sec.x0 < 4 || sec.z1 - sec.z0 < 4) out.push(`section ${i} is too small`);
    if (!allowedRoofs(sec).includes(sec.roof)) out.push(`section ${i}: ${sec.roof} roof does not fit a ${sec.shape}`);
    if (sec.floors * sec.floorH > 90) out.push(`section ${i} is too tall`);
    for (let j = i + 1; j < spec.sections.length; j++) {
      const o = spec.sections[j];
      const ox = Math.min(sec.x1, o.x1) - Math.max(sec.x0, o.x0), oz = Math.min(sec.z1, o.z1) - Math.max(sec.z0, o.z0);
      if (ox > 0.05 && oz > 0.05) out.push(`sections ${i} and ${j} overlap`);
    }
  });
  // Every section but the first joins another one (wings attach, annexes sit beside halls).
  spec.sections.forEach((sec, i) => {
    if (i === 0 || sec.role === 'annex') return;
    const touches = spec.sections.some((o, j) => j !== i && Math.min(sec.x1, o.x1) - Math.max(sec.x0, o.x0) >= -0.05 && Math.min(sec.z1, o.z1) - Math.max(sec.z0, o.z0) >= -0.05);
    if (!touches) out.push(`section ${i} floats free of the building`);
  });
  const doors = spec.sections.filter((s) => s.entrance);
  if (doors.length !== 1) out.push('needs exactly one entrance');
  else if (doors[0].z0 > FORECOURT + 1) out.push('the entrance does not reach the street');
  spec.modules.forEach((m, i) => {
    if (m.kind === 'pipes') return;
    const x0 = m.x - m.w / 2, x1 = m.x + m.w / 2, z0 = m.z - m.d / 2, z1 = m.z + m.d / 2;
    if (m.onRoof !== undefined) {
      const sec = spec.sections[m.onRoof];
      if (!sec || sec.shape !== 'block' || (sec.roof !== 'flat' && sec.roof !== 'solar')) out.push(`module ${i} is on a roof that cannot carry it`);
      else if (x0 < sec.x0 - 0.01 || x1 > sec.x1 + 0.01 || z0 < sec.z0 - 0.01 || z1 > sec.z1 + 0.01) out.push(`module ${i} hangs off its roof`);
      return;
    }
    if (!inLot(x0, z0, x1, z1)) out.push(`module ${i} leaves the lot`);
    for (const sec of spec.sections) {
      if (x0 < sec.x1 && x1 > sec.x0 && z0 < sec.z1 && z1 > sec.z0) out.push(`module ${i} overlaps a building section`);
    }
    for (let j = i + 1; j < spec.modules.length; j++) {
      const o = spec.modules[j];
      if (o.onRoof !== undefined || o.kind === 'pipes') continue;
      if (x0 < o.x + o.w / 2 && x1 > o.x - o.w / 2 && z0 < o.z + o.d / 2 && z1 > o.z - o.d / 2) out.push(`modules ${i} and ${j} overlap`);
    }
  });
  return out;
}

/** Tallest point of a composition (m above the lot). */
export function archHeight(spec: ArchSpec): number {
  let h = 0;
  for (const sec of spec.sections) h = Math.max(h, sec.floors * sec.floorH + (sec.roof === 'dome' || sec.roof === 'cone' ? (sec.x1 - sec.x0) * 0.4 : sec.roof === 'gable' ? 3 : 0));
  for (const m of spec.modules) h = Math.max(h, m.h + (m.onRoof !== undefined ? spec.sections[m.onRoof].floors * spec.sections[m.onRoof].floorH : 0));
  return h;
}

// ── Registry ────────────────────────────────────────────────────────────────

/** Compositions of discovered designs, by building style ("arch:<id>"). */
const DESIGNS = new Map<string, ArchSpec>();

export function registerArch(style: string, spec: ArchSpec): void {
  DESIGNS.set(style, spec);
}

/** Research centres compose theirs from specialization, equipment level and seed. */
const LAB_MODULES: Record<FieldId, ModuleKind[]> = {
  energy: ['coilTower', 'solarArray'],
  materials: ['stack', 'silo'],
  agriculture: ['greenhouse'],
  manufacturing: ['turbineHouse', 'pipes'],
  transport: ['mast', 'canopy'],
  water: ['tank', 'basin'],
  environment: ['finTower'],
  architecture: ['dome', 'canopy'],
  medicine: ['canopy'],
};

const LAB_LOOK: Record<FieldId, ComposeInput['look']> = {
  energy: { color: 0xd8d4cc, surface: 'render' },
  materials: { color: 0x9a5b45, surface: 'brick' },
  agriculture: { color: 0xe3d9c6, surface: 'timber' },
  manufacturing: { color: 0xb9b6ae, surface: 'concrete' },
  transport: { color: 0xcfd2d4, surface: 'render' },
  water: { color: 0xd8d4ca, surface: 'render' },
  environment: { color: 0xb8c2a8, surface: 'timber' },
  architecture: { color: 0x5e7f92, surface: 'glass' },
  medicine: { color: 0xeceae4, surface: 'render' },
};

export const FIELD_ACCENT: Record<FieldId, number> = {
  materials: 0xc08a4a, energy: 0xe0a020, agriculture: 0x6aa84f, manufacturing: 0x8e9aa6, transport: 0x5b8def,
  water: 0x3fa0d0, environment: 0x2f9e6f, architecture: 0xb07cc6, medicine: 0xd9534f,
};

export function labArch(field: FieldId, level: number, w: number, d: number, seed: number): ArchSpec {
  return composeArch({
    w, d, seed, fn: 'lab', field, level,
    modules: LAB_MODULES[field],
    look: LAB_LOOK[field],
    components: field === 'environment' ? ['gardenRoof'] : field === 'architecture' ? ['glass', 'dome'] : [],
    accent: FIELD_ACCENT[field],
    scale: 0.3 + 0.2 * level,
  });
}

/** The composition behind a procedural building style, if it is one. */
export function archForStyle(style: string, w: number, d: number, level: number, seed: number): ArchSpec | null {
  if (style.startsWith('arch:')) return DESIGNS.get(style) ?? null;
  if (style.startsWith('lab:')) return labArch(style.slice(4) as FieldId, level, w, d, seed);
  return null;
}
