import * as THREE from 'three';
import type { Building } from '../../sim/buildings/Buildings';
import type { City } from '../../sim/City';
import { CHUNKS, CHUNK_SIZE } from '../../sim/constants';
import { BuildingState, Problem } from '../../sim/types';
import { type BuildingProp, type BuiltGeometry, GeoBuilder, type Mat } from './BuildingKit';
import { Rng } from '../../core/rng';
import { beyondDetail } from '../shared';
import { type BuildingUniforms, createBuildingDepthMaterial, createBuildingMaterial } from './BuildingMaterial';
import { generateBuilding } from './generators';

const STATE_SIZE = 256;

interface Cached {
  sig: string;
  geo: BuiltGeometry;
  chunk: number;
  /** Simple box version for distant views (made on demand). */
  lod?: BuiltGeometry;
}

interface BChunk {
  mesh: THREE.Mesh | null;
  /** The same buildings as plain boxes, drawn instead when the chunk is far away. */
  lod: THREE.Mesh | null;
  ids: Set<number>;
}


/**
 * A distant stand-in for a building: one box over the parts above the ground,
 * coloured and patterned like its main walls and roof, so windows still read.
 */
export function lodGeometry(b: Pick<Building, 'cx' | 'cz' | 'angle' | 'hw' | 'hd' | 'y'>, geo: BuiltGeometry): BuiltGeometry {
  const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, wallTop = 0;
  // Footprint and wall height in lot space, from everything above the ground.
  for (let i = 0; i < geo.vertexCount; i++) {
    const y = geo.pos[i * 3 + 1] - b.y;
    if (y < 1) continue;
    const dx = geo.pos[i * 3] - b.cx, dz = geo.pos[i * 3 + 2] - b.cz;
    const lx = dx * ca + dz * sa, lz = -dx * sa + dz * ca;
    x0 = Math.min(x0, lx);
    x1 = Math.max(x1, lx);
    z0 = Math.min(z0, lz);
    z1 = Math.max(z1, lz);
    if (Math.abs(geo.nor[i * 3 + 1]) < 40) wallTop = Math.max(wallTop, y);
  }
  // The wall and roof finishes covering the most area (trim has many vertices but little surface).
  const walls = new Map<string, { n: number; i: number }>();
  const roofs = new Map<string, { n: number; i: number }>();
  const P = geo.pos;
  for (let t = 0; t < geo.idx.length; t += 3) {
    const a = geo.idx[t], b2 = geo.idx[t + 1], c = geo.idx[t + 2];
    if (P[a * 3 + 1] - b.y < 0.5 && P[b2 * 3 + 1] - b.y < 0.5 && P[c * 3 + 1] - b.y < 0.5) continue;
    const ux = P[b2 * 3] - P[a * 3], uy = P[b2 * 3 + 1] - P[a * 3 + 1], uz = P[b2 * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    const ny = geo.nor[a * 3 + 1];
    const into = Math.abs(ny) < 40 ? walls : ny > 90 ? roofs : null;
    if (!into) continue;
    const key = `${geo.col[a * 3]},${geo.col[a * 3 + 1]},${geo.col[a * 3 + 2]},${geo.pat[a * 4]},${geo.pat[a * 4 + 1]},${geo.pat[a * 4 + 2]}`;
    const e = into.get(key);
    if (e) e.n += area;
    else into.set(key, { n: area, i: a });
  }
  const g = new GeoBuilder(b.hw * 2, b.hd * 2, new Rng(1));
  if (x0 > x1) return g.build(b.cx, b.cz, b.angle, b.hd, b.y);
  const top = Math.max(2, wallTop || geo.height);
  const matOf = (m: Map<string, { n: number; i: number }>): Mat | null => {
    let best: { n: number; i: number } | null = null;
    for (const e of m.values()) if (!best || e.n > best.n) best = e;
    if (!best) return null;
    const i = best.i;
    return {
      color: [geo.col[i * 3] / 255, geo.col[i * 3 + 1] / 255, geo.col[i * 3 + 2] / 255],
      pattern: geo.pat[i * 4],
      fh: geo.pat[i * 4 + 1] / 10,
      bay: geo.pat[i * 4 + 2] / 10,
      seed: geo.pat[i * 4 + 3],
    };
  };
  const wall = matOf(walls) ?? matOf(roofs);
  if (!wall) return g.build(b.cx, b.cz, b.angle, b.hd, b.y);
  const roof = matOf(roofs) ?? wall;
  // GeoBuilder works in lot space: x across, z from the front (0) to the back (2·hd).
  g.box(x0, z0 + b.hd, x1, z1 + b.hd, 0, top, wall, roof);
  return g.build(b.cx, b.cz, b.angle, b.hd, b.y);
}

export function buildingChunk(b: { cx: number; cz: number }): number {
  const cx = Math.min(CHUNKS - 1, Math.max(0, Math.floor(b.cx / CHUNK_SIZE)));
  const cz = Math.min(CHUNKS - 1, Math.max(0, Math.floor(b.cz / CHUNK_SIZE)));
  return cz * CHUNKS + cx;
}

export function buildingSignature(b: Building): string {
  return `${b.style}|${b.seed}|${b.floors}|${b.level}|${b.hw.toFixed(2)}|${b.hd.toFixed(2)}|${b.cx.toFixed(2)}|${b.cz.toFixed(2)}|${b.y.toFixed(2)}`;
}

export function generateFor(b: Building): BuiltGeometry {
  return generateBuilding({ style: b.style, w: b.hw * 2, d: b.hd * 2, floors: b.floors, level: b.level, seed: b.seed }, b.cx, b.cz, b.angle, b.y);
}

/** Merges per-building geometry into one mesh per chunk. */
export function mergeBuilt(parts: { geo: BuiltGeometry; slot: number; baseY: number }[]): THREE.BufferGeometry {
  let nv = 0;
  let ni = 0;
  for (const p of parts) {
    nv += p.geo.vertexCount;
    ni += p.geo.idx.length;
  }
  const pos = new Float32Array(nv * 3);
  const nor = new Int8Array(nv * 3);
  const col = new Uint8Array(nv * 3);
  const fac = new Float32Array(nv * 2);
  const pat = new Uint8Array(nv * 4);
  const meta = new Float32Array(nv * 2);
  const idx = new Uint32Array(ni);
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    const g = p.geo;
    pos.set(g.pos, vo * 3);
    nor.set(g.nor, vo * 3);
    col.set(g.col, vo * 3);
    fac.set(g.fac, vo * 2);
    pat.set(g.pat, vo * 4);
    for (let i = 0; i < g.vertexCount; i++) {
      meta[(vo + i) * 2] = p.slot;
      meta[(vo + i) * 2 + 1] = p.baseY;
    }
    for (let i = 0; i < g.idx.length; i++) idx[io + i] = g.idx[i] + vo;
    vo += g.vertexCount;
    io += g.idx.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
  geo.setAttribute('aFac', new THREE.BufferAttribute(fac, 2));
  geo.setAttribute('aPat', new THREE.BufferAttribute(pat, 4, false));
  geo.setAttribute('aMeta', new THREE.BufferAttribute(meta, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Renders all buildings. Geometry is generated once per building, cached,
 * and merged per chunk; per-building state (construction, highlight,
 * abandonment, overlays) lives in a small texture read by the shader.
 */
export class BuildingRenderer {
  readonly group = new THREE.Group();
  readonly uniforms: BuildingUniforms;
  readonly material: THREE.MeshStandardMaterial;
  readonly depthMaterial: THREE.MeshDepthMaterial;
  readonly stateData = new Uint8Array(STATE_SIZE * STATE_SIZE * 4);
  private stateTex: THREE.DataTexture;
  private cache = new Map<number, Cached>();
  private chunks: BChunk[] = [];
  private dirty = new Set<number>();
  private propsDirty = new Set<number>();
  private completed = new Set<number>();
  private highlights = new Map<number, number>();
  /** Props per chunk (completed buildings only). */
  readonly chunkProps = new Map<number, BuildingProp[]>();
  propsVersion = 0;
  /** Per-building overlay value provider (0 = none, else 1–255). */
  overlayValue: ((b: Building) => number) | null = null;
  private stateTimer = 0;

  constructor(private city: City) {
    this.stateTex = new THREE.DataTexture(this.stateData, STATE_SIZE, STATE_SIZE, THREE.RGBAFormat);
    this.stateTex.magFilter = THREE.NearestFilter;
    this.stateTex.minFilter = THREE.NearestFilter;
    this.stateTex.needsUpdate = true;
    this.uniforms = {
      uState: { value: this.stateTex },
      uStateSize: { value: STATE_SIZE },
      uBldOverlay: { value: 0 },
      uGhost: { value: 0 },
      uGhostColor: { value: new THREE.Color(0.3, 0.9, 0.8) },
    };
    this.material = createBuildingMaterial(this.uniforms);
    this.depthMaterial = createBuildingDepthMaterial(this.uniforms);
    for (let i = 0; i < CHUNKS * CHUNKS; i++) this.chunks.push({ mesh: null, lod: null, ids: new Set() });
  }

  /** Full rebuild from the city (after load / new game). */
  rebuildAll(): void {
    this.city.buildings.flushChanges();
    for (const c of this.chunks) c.ids.clear();
    this.cache.clear();
    this.completed.clear();
    for (const b of this.city.buildings.all.values()) {
      const ch = buildingChunk(b);
      this.chunks[ch].ids.add(b.id);
      if (b.progress >= 1) this.completed.add(b.id);
    }
    for (let i = 0; i < this.chunks.length; i++) {
      this.dirty.add(i);
      this.propsDirty.add(i);
    }
  }

  sync(): void {
    const changes = this.city.buildings.flushChanges();
    for (const [id, kind] of changes) {
      if (kind === 'remove') {
        const c = this.cache.get(id);
        const snap = this.city.buildings.removedSnapshot(id);
        const ch = c?.chunk ?? (snap ? buildingChunk(snap) : -1);
        if (ch >= 0) {
          this.chunks[ch].ids.delete(id);
          this.dirty.add(ch);
          this.propsDirty.add(ch);
        }
        this.cache.delete(id);
        this.completed.delete(id);
        this.highlights.delete(id);
        continue;
      }
      const b = this.city.buildings.get(id);
      if (!b) continue;
      const ch = buildingChunk(b);
      this.chunks[ch].ids.add(id);
      this.dirty.add(ch);
      this.propsDirty.add(ch);
      if (kind === 'geometry') this.cache.delete(id);
    }
  }

  /** Rebuilds dirty chunks within a time budget (ms). */
  rebuild(budgetMs = 6): void {
    const t0 = performance.now();
    for (const ch of this.dirty) {
      this.dirty.delete(ch);
      this.rebuildChunk(ch);
      if (performance.now() - t0 > budgetMs) break;
    }
    if (this.propsDirty.size) {
      for (const ch of this.propsDirty) this.rebuildProps(ch);
      this.propsDirty.clear();
      this.propsVersion++;
    }
  }

  get pending(): number {
    return this.dirty.size;
  }

  private geometryFor(b: Building, ch: number): BuiltGeometry {
    const sig = buildingSignature(b);
    const c = this.cache.get(b.id);
    if (c && c.sig === sig) return c.geo;
    const geo = generateFor(b);
    this.cache.set(b.id, { sig, geo, chunk: ch });
    return geo;
  }

  private rebuildChunk(ch: number): void {
    const c = this.chunks[ch];
    for (const m of [c.mesh, c.lod]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
    c.mesh = c.lod = null;
    const parts: { geo: BuiltGeometry; slot: number; baseY: number }[] = [];
    const boxes: { geo: BuiltGeometry; slot: number; baseY: number }[] = [];
    for (const id of c.ids) {
      const b = this.city.buildings.get(id);
      if (!b) continue;
      const geo = this.geometryFor(b, ch);
      parts.push({ geo, slot: b.slot, baseY: b.y });
      const cached = this.cache.get(id)!;
      cached.lod ??= lodGeometry(b, geo);
      boxes.push({ geo: cached.lod, slot: b.slot, baseY: b.y });
    }
    if (!parts.length) return;
    const make = (geo: THREE.BufferGeometry) => {
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.customDepthMaterial = this.depthMaterial;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      return mesh;
    };
    c.mesh = make(mergeBuilt(parts));
    c.lod = make(mergeBuilt(boxes));
    this.applyLod(ch);
  }

  private focusX = 0;
  private focusZ = 0;

  private applyLod(ch: number): void {
    const c = this.chunks[ch];
    if (!c.mesh || !c.lod) return;
    const x = ((ch % CHUNKS) + 0.5) * CHUNK_SIZE, z = (Math.floor(ch / CHUNKS) + 0.5) * CHUNK_SIZE;
    const far = beyondDetail(x, z, CHUNK_SIZE / 2, this.focusX, this.focusZ);
    c.mesh.visible = !far;
    c.lod.visible = far;
  }

  /** Full detail inside the detail square around the camera's focus, boxes beyond it. */
  updateLod(focus: { x: number; z: number }): void {
    this.focusX = focus.x;
    this.focusZ = focus.z;
    for (let ch = 0; ch < this.chunks.length; ch++) this.applyLod(ch);
  }

  private rebuildProps(ch: number): void {
    const list: BuildingProp[] = [];
    for (const id of this.chunks[ch].ids) {
      const b = this.city.buildings.get(id);
      if (!b) continue;
      const cached = this.cache.get(id);
      const geo = cached?.geo ?? this.geometryFor(b, ch);
      const done = b.progress >= 1 && b.state !== BuildingState.Abandoned;
      if (done) {
        for (const p of geo.props) {
          if ((p.kind === 'smoke' || p.kind === 'steam') && b.state !== BuildingState.Active) continue;
          list.push(p);
        }
      } else if (b.state === BuildingState.Construction || b.progress < 1) {
        // Tower crane for taller construction projects.
        if (geo.height > 14) {
          const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
          const lx = b.hw - 2.5, lz = b.hd - 3;
          list.push({ kind: 'crane', x: b.cx + lx * ca - lz * sa, y: b.y, z: b.cz + lx * sa + lz * ca, rot: b.angle + Math.PI * 0.75, scale: Math.max(0.6, Math.min(1.6, geo.height / 40)) });
        }
      }
    }
    this.chunkProps.set(ch, list);
  }

  /** Writes per-building state into the texture (throttled). */
  updateState(dt: number, force = false): void {
    this.stateTimer -= dt;
    if (this.stateTimer > 0 && !force) return;
    this.stateTimer = 0.15;
    const d = this.stateData;
    const ov = this.overlayValue;
    for (const b of this.city.buildings.all.values()) {
      const o = b.slot * 4;
      if (o < 0 || o >= d.length) continue;
      d[o] = Math.round(Math.min(1, b.progress) * 255);
      d[o + 1] = this.highlights.get(b.id) ?? 0;
      let flags = 0;
      if (b.state === BuildingState.Abandoned) flags |= 1;
      if (b.state === BuildingState.Burning) flags |= 2;
      d[o + 2] = flags;
      d[o + 3] = ov ? ov(b) : 0;
      const wasDone = this.completed.has(b.id);
      const isDone = b.progress >= 1 && b.state !== BuildingState.Abandoned;
      if (wasDone !== isDone) {
        if (isDone) this.completed.add(b.id);
        else this.completed.delete(b.id);
        this.propsDirty.add(buildingChunk(b));
      }
    }
    this.stateTex.needsUpdate = true;
  }

  setHighlight(ids: Iterable<number>, code: number): void {
    for (const id of ids) {
      if (code) this.highlights.set(id, code);
      else this.highlights.delete(id);
    }
    this.stateTimer = 0;
  }

  clearHighlights(code?: number): void {
    if (code === undefined) this.highlights.clear();
    else for (const [id, c] of this.highlights) if (c === code) this.highlights.delete(id);
    this.stateTimer = 0;
  }

  heightOf(id: number): number {
    return this.cache.get(id)?.geo.height ?? 10;
  }

  /** Problem flags worth showing as floating icons. */
  static iconFor(b: Building): number {
    if (b.state === BuildingState.Burning) return 0;
    if (b.state === BuildingState.Abandoned) return 7;
    if (b.state !== BuildingState.Active || b.progress < 1) return -1;
    const p = b.problems;
    if (p & Problem.NoRoad) return 6;
    if (p & Problem.NoPower) return 1;
    if (p & Problem.NoWater) return 2;
    if (p & Problem.NoSewage) return 3;
    if (p & Problem.Garbage) return 4;
    if (p & Problem.NoWorkers) return 5;
    return -1;
  }

  dispose(): void {
    for (const c of this.chunks) {
      c.mesh?.geometry.dispose();
      c.lod?.geometry.dispose();
    }
    this.material.dispose();
    this.stateTex.dispose();
  }
}
