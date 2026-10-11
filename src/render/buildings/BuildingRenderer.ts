import * as THREE from 'three';
import type { Building } from '../../sim/buildings/Buildings';
import type { City } from '../../sim/City';
import { CHUNKS, CHUNK_SIZE } from '../../sim/constants';
import { BuildingState, Problem } from '../../sim/types';
import type { BuildingProp, BuiltGeometry } from './BuildingKit';
import { type BuildingUniforms, createBuildingDepthMaterial, createBuildingMaterial } from './BuildingMaterial';
import { generateBuilding } from './generators';

const STATE_SIZE = 256;

interface Cached {
  sig: string;
  geo: BuiltGeometry;
  chunk: number;
}

interface BChunk {
  mesh: THREE.Mesh | null;
  ids: Set<number>;
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
    for (let i = 0; i < CHUNKS * CHUNKS; i++) this.chunks.push({ mesh: null, ids: new Set() });
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
    if (c.mesh) {
      this.group.remove(c.mesh);
      c.mesh.geometry.dispose();
      c.mesh = null;
    }
    const parts: { geo: BuiltGeometry; slot: number; baseY: number }[] = [];
    for (const id of c.ids) {
      const b = this.city.buildings.get(id);
      if (!b) continue;
      parts.push({ geo: this.geometryFor(b, ch), slot: b.slot, baseY: b.y });
    }
    if (!parts.length) return;
    const mesh = new THREE.Mesh(mergeBuilt(parts), this.material);
    mesh.customDepthMaterial = this.depthMaterial;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    c.mesh = mesh;
    this.group.add(mesh);
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
    for (const c of this.chunks) c.mesh?.geometry.dispose();
    this.material.dispose();
    this.stateTex.dispose();
  }
}
