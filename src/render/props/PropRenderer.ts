import * as THREE from 'three';
import type { City } from '../../sim/City';
import { CHUNKS, CHUNK_SIZE } from '../../sim/constants';
import { VEHICLE_MODELS } from '../../sim/traffic/Vehicles';
import type { AssetLibrary, AssetName } from '../assets/AssetLibrary';
import { Pool, createAssetMaterial, createFoliageDepthMaterial, createFoliageMaterial, writeMatrix } from '../assets/AssetMaterials';
import type { BuildingRenderer } from '../buildings/BuildingRenderer';
import type { RoadRenderer } from '../roads/RoadRenderer';

const TREE_HI: AssetName[] = ['oak', 'maple', 'pine', 'bush'];
const HI_TREE_DIST = 620;
const CAR_DIST = 1100;
const LIGHT_DIST = 1700;

interface Bucket {
  m: Float32Array;
  c: Float32Array;
  n: number;
}

function bucket(): Bucket {
  return { m: new Float32Array(64 * 16), c: new Float32Array(64 * 3), n: 0 };
}

function push(b: Bucket, x: number, y: number, z: number, rot: number, s: number, r = 1, g = 1, bl = 1, sy = s): void {
  if ((b.n + 1) * 16 > b.m.length) {
    const m = new Float32Array(b.m.length * 2);
    m.set(b.m);
    b.m = m;
    const c = new Float32Array(b.c.length * 2);
    c.set(b.c);
    b.c = c;
  }
  writeMatrix(b.m, b.n * 16, x, y, z, rot, s, sy, s);
  b.c[b.n * 3] = r;
  b.c[b.n * 3 + 1] = g;
  b.c[b.n * 3 + 2] = bl;
  b.n++;
}

interface ChunkProps {
  trees: Bucket[];
  lights: Bucket;
  signals: Bucket;
  cranes: Bucket;
  towers: Bucket;
  rotors: { x: number; y: number; z: number; rot: number; phase: number }[];
  cars: Bucket[];
  smoke: { x: number; y: number; z: number; kind: 'smoke' | 'steam' | 'fountain'; scale: number }[];
}

function emptyChunk(): ChunkProps {
  return {
    trees: TREE_HI.map(bucket),
    lights: bucket(),
    signals: bucket(),
    cranes: bucket(),
    towers: bucket(),
    rotors: [],
    cars: VEHICLE_MODELS.map(bucket),
    smoke: [],
  };
}

const hash = (a: number) => {
  const s = Math.sin(a * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * All instanced scenery: natural and planted trees (two LODs), street lights,
 * traffic signals, parked cars, cranes and wind turbines. Per-chunk instance
 * data is cached and only re-assembled when the visible set changes.
 */
export class PropRenderer {
  readonly group = new THREE.Group();
  private chunks: (ChunkProps | null)[] = new Array(CHUNKS * CHUNKS).fill(null);
  private dirty = new Set<number>();
  private treeHi: Pool[];
  private treeLo: Pool[];
  private lights: Pool;
  private signals: Pool;
  private signalLamps: Pool;
  private cranes: Pool;
  private towers: Pool;
  private rotors: Pool;
  private cars: Pool[];
  private lastRoadProps = -1;
  private lastBldProps = -1;
  private lastKey = '';
  private needAssemble = true;
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();
  private box = new THREE.Box3();
  private visibleRotors: ChunkProps['rotors'] = [];
  /** Active smoke/steam emitters near the camera (consumed by effects). */
  emitters: ChunkProps['smoke'] = [];
  private signalTimer = 0;

  constructor(private city: City, assets: AssetLibrary, private roads: RoadRenderer, private buildings: BuildingRenderer) {
    const leafMat = createFoliageMaterial(assets.leafTexture, true);
    const solidFoliage = createFoliageMaterial(assets.leafTexture, false);
    const leafDepth = createFoliageDepthMaterial(assets.leafTexture);
    this.treeHi = TREE_HI.map((n) => new Pool(assets.get(n), n === 'pine' ? solidFoliage : leafMat, 1024, { shadows: true, colors: true, depth: n === 'pine' ? undefined : leafDepth }));
    this.treeLo = [new Pool(assets.get('tree_lod'), solidFoliage, 4096, { colors: true }), new Pool(assets.get('pine_lod'), solidFoliage, 2048, { colors: true })];
    const propMat = createAssetMaterial('prop');
    this.lights = new Pool(assets.get('streetlight'), propMat, 512, { shadows: true });
    this.signals = new Pool(assets.get('signal'), propMat, 128, { shadows: true });
    const lampGeo = new THREE.SphereGeometry(0.2, 8, 6);
    this.signalLamps = new Pool(lampGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), 128, { colors: true });
    this.cranes = new Pool(assets.get('crane'), propMat, 16, { shadows: true });
    this.towers = new Pool(assets.get('wind_tower'), propMat, 16, { shadows: true });
    this.rotors = new Pool(assets.get('wind_rotor'), propMat, 16, { shadows: true });
    const carMat = createAssetMaterial('parked');
    this.cars = VEHICLE_MODELS.map((m) => new Pool(assets.get(m), carMat, 256, { colors: true, shadows: true }));
    for (const p of [...this.treeHi, ...this.treeLo, this.lights, this.signals, this.signalLamps, this.cranes, this.towers, this.rotors, ...this.cars]) {
      this.group.add(p.mesh);
    }
  }

  markAllDirty(): void {
    for (let i = 0; i < CHUNKS * CHUNKS; i++) this.dirty.add(i);
  }

  private collectDirty(): void {
    for (const ch of this.city.nature.dirtyChunks) this.dirty.add(ch);
    this.city.nature.dirtyChunks.clear();
    if (this.roads.propsVersion !== this.lastRoadProps) {
      this.lastRoadProps = this.roads.propsVersion;
      for (const ch of this.roads.chunkProps.keys()) this.dirty.add(ch);
    }
    if (this.buildings.propsVersion !== this.lastBldProps) {
      this.lastBldProps = this.buildings.propsVersion;
      for (const ch of this.buildings.chunkProps.keys()) this.dirty.add(ch);
    }
  }

  private buildChunk(ch: number): ChunkProps {
    const cp = emptyChunk();
    const nat = this.city.nature;
    const terrain = this.city.terrain;
    // Natural and planted trees (saplings grow to full size).
    const day = this.city.clock.day;
    nat.forChunk(ch, (i) => {
      if (!nat.alive[i]) return;
      const k = nat.kind[i];
      const x = nat.x[i], z = nat.z[i];
      const h = hash(i);
      const tint = 0.82 + h * 0.3;
      push(cp.trees[k], x, terrain.heightAt(x, z) - 0.15, z, nat.rot[i], nat.scale[i] * nat.growth(i, day), tint, tint * (0.95 + hash(i + 7) * 0.1), tint * 0.9);
    });
    // Road props.
    for (const p of this.roads.chunkProps.get(ch) ?? []) {
      if (p.kind === 'streetlight') push(cp.lights, p.x, p.y, p.z, p.rot, 1);
      else if (p.kind === 'signal') push(cp.signals, p.x, p.y, p.z, p.rot, 1);
      else if (p.kind === 'tree') {
        const t = 0.9 + hash(p.x + p.z) * 0.15;
        push(cp.trees[p.variant === 1 ? 1 : 0], p.x, p.y, p.z, p.rot, p.scale ?? 0.7, t, t, t * 0.95);
      }
    }
    // Building props.
    for (const p of this.buildings.chunkProps.get(ch) ?? []) {
      const s = p.scale ?? 1;
      switch (p.kind) {
        case 'tree': {
          const t = 0.88 + hash(p.x * 3 + p.z) * 0.2;
          push(cp.trees[p.variant === 2 ? 2 : p.variant === 1 ? 1 : 0], p.x, p.y, p.z, p.rot, s * 0.8, t, t, t * 0.95);
          break;
        }
        case 'bush':
          push(cp.trees[3], p.x, p.y, p.z, p.rot, s);
          break;
        case 'car': {
          const col = new THREE.Color().setHex(p.color ?? 0xffffff, THREE.SRGBColorSpace);
          push(cp.cars[p.variant ?? 0], p.x, p.y, p.z, p.rot, 1, col.r, col.g, col.b);
          break;
        }
        case 'crane':
          push(cp.cranes, p.x, p.y, p.z, p.rot, s);
          break;
        case 'rotor': {
          const fx = Math.cos(p.rot), fz = Math.sin(p.rot);
          const baseY = p.y - 48.8;
          push(cp.towers, p.x - fx * 2.2, baseY, p.z - fz * 2.2, p.rot, 1);
          cp.rotors.push({ x: p.x, y: p.y, z: p.z, rot: p.rot, phase: hash(p.x) * 6 });
          break;
        }
        case 'smoke':
        case 'steam':
        case 'fountain':
          cp.smoke.push({ x: p.x, y: p.y, z: p.z, kind: p.kind, scale: s });
          break;
      }
    }
    return cp;
  }

  update(camera: THREE.PerspectiveCamera, dt: number): void {
    this.collectDirty();
    let rebuilt = 0;
    for (const ch of this.dirty) {
      this.chunks[ch] = this.buildChunk(ch);
      this.dirty.delete(ch);
      this.needAssemble = true;
      if (++rebuilt >= 12) break;
    }
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    // Visible chunks and LOD classes.
    const cam = camera.position;
    const vis: { ch: number; d: number }[] = [];
    for (let cz = 0; cz < CHUNKS; cz++) {
      for (let cx = 0; cx < CHUNKS; cx++) {
        this.box.min.set(cx * CHUNK_SIZE, -20, cz * CHUNK_SIZE);
        this.box.max.set((cx + 1) * CHUNK_SIZE, 140, (cz + 1) * CHUNK_SIZE);
        if (!this.frustum.intersectsBox(this.box)) continue;
        const d = Math.hypot(Math.max(0, Math.abs(cam.x - (cx + 0.5) * CHUNK_SIZE) - CHUNK_SIZE / 2), Math.max(0, Math.abs(cam.z - (cz + 0.5) * CHUNK_SIZE) - CHUNK_SIZE / 2), cam.y * 0.8);
        vis.push({ ch: cz * CHUNKS + cx, d });
      }
    }
    const key = vis.map((v) => `${v.ch}:${v.d < HI_TREE_DIST ? 0 : v.d < CAR_DIST ? 1 : v.d < LIGHT_DIST ? 2 : 3}`).join(',');
    if (key !== this.lastKey || this.needAssemble) {
      this.lastKey = key;
      this.needAssemble = false;
      this.assemble(vis);
    }
    this.animateRotors(dt);
    this.signalTimer -= dt;
    if (this.signalTimer <= 0) {
      this.signalTimer = 0.2;
      this.updateSignalLamps();
    }
  }

  private assemble(vis: { ch: number; d: number }[]): void {
    const copy = (pool: Pool, list: Bucket[], withColor: boolean) => {
      let n = 0;
      for (const b of list) n += b.n;
      pool.ensure(n);
      const m = pool.matrices;
      const c = pool.colors;
      let o = 0;
      for (const b of list) {
        m.set(b.m.subarray(0, b.n * 16), o * 16);
        if (withColor && c) c.set(b.c.subarray(0, b.n * 3), o * 3);
        o += b.n;
      }
      pool.commit(n);
    };
    const hi: Bucket[][] = TREE_HI.map(() => []);
    const loBroad: Bucket[] = [];
    const loPine: Bucket[] = [];
    const lights: Bucket[] = [];
    const signals: Bucket[] = [];
    const cranes: Bucket[] = [];
    const towers: Bucket[] = [];
    const cars: Bucket[][] = VEHICLE_MODELS.map(() => []);
    this.visibleRotors = [];
    this.emitters = [];
    for (const { ch, d } of vis) {
      const cp = this.chunks[ch];
      if (!cp) continue;
      if (d < HI_TREE_DIST) {
        for (let k = 0; k < TREE_HI.length; k++) hi[k].push(cp.trees[k]);
      } else {
        loBroad.push(cp.trees[0], cp.trees[1]);
        loPine.push(cp.trees[2]);
      }
      if (d < CAR_DIST) for (let k = 0; k < cars.length; k++) cars[k].push(cp.cars[k]);
      if (d < LIGHT_DIST) {
        lights.push(cp.lights);
        signals.push(cp.signals);
      }
      cranes.push(cp.cranes);
      towers.push(cp.towers);
      this.visibleRotors.push(...cp.rotors);
      if (d < 1500) this.emitters.push(...cp.smoke);
    }
    for (let k = 0; k < TREE_HI.length; k++) copy(this.treeHi[k], hi[k], true);
    copy(this.treeLo[0], loBroad, true);
    copy(this.treeLo[1], loPine, true);
    copy(this.lights, lights, false);
    copy(this.signals, signals, false);
    copy(this.cranes, cranes, false);
    copy(this.towers, towers, false);
    for (let k = 0; k < cars.length; k++) copy(this.cars[k], cars[k], true);
  }

  private spin = 0;
  private animateRotors(dt: number): void {
    this.spin += dt * 1.6;
    const list = this.visibleRotors;
    this.rotors.ensure(list.length);
    const m = this.rotors.matrices;
    const tmp = new THREE.Matrix4();
    const rx = new THREE.Matrix4();
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      writeMatrix(m, i * 16, r.x, r.y, r.z, r.rot, 1);
      tmp.fromArray(m, i * 16);
      rx.makeRotationX(this.spin + r.phase);
      tmp.multiply(rx);
      tmp.toArray(m, i * 16);
    }
    this.rotors.commit(list.length);
  }

  private updateSignalLamps(): void {
    const heads = this.roads.allSignals();
    this.signalLamps.ensure(heads.length);
    const m = this.signalLamps.matrices;
    const c = this.signalLamps.colors!;
    const sig = this.city.signals;
    for (let i = 0; i < heads.length; i++) {
      const h = heads[i];
      writeMatrix(m, i * 16, h.x, h.y, h.z, 0, 1);
      const state = sig.lightFor(h.nodeId, h.segId);
      const col = state === 2 ? [0.1, 3.2, 0.9] : state === 1 ? [3.2, 1.9, 0.1] : [3.4, 0.15, 0.08];
      c[i * 3] = col[0];
      c[i * 3 + 1] = col[1];
      c[i * 3 + 2] = col[2];
    }
    this.signalLamps.commit(heads.length);
  }
}
