import * as THREE from 'three';
import { Rng } from '../../core/rng';
import type { City } from '../../sim/City';
import { WATER_LEVEL, WORLD_SIZE } from '../../sim/constants';
import type { AssetLibrary } from '../assets/AssetLibrary';
import { Pool, createAssetMaterial, writeMatrix } from '../assets/AssetMaterials';
import { globalUniforms } from '../shared';

const HULLS = [0x1f4fa8, 0xc0392b, 0x0e7c66, 0x2c3e50, 0xe8e4dc, 0xd4a017, 0x6a1b9a];
const MAX_BOATS = 14;

interface Boat {
  kind: 0 | 1;
  x: number;
  z: number;
  heading: number;
  speed: number;
  tx: number;
  tz: number;
  wait: number;
  color: number;
  phase: number;
}

/**
 * Leisure boats on lakes, rivers and the bay: sailboats and motor cruisers
 * wander between points of open water along clear paths (sailboats keep out
 * from under bridges), bobbing on the swell and trailing foam wakes.
 */
export class BoatRenderer {
  readonly group = new THREE.Group();
  private pools: [Pool, Pool];
  private wakes: THREE.InstancedMesh;
  private boats: Boat[] = [];
  private rng = new Rng(0xb0a7);
  private capacity = -1;
  private time = 0;
  private waterVersion = -1;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private col = new THREE.Color();
  private yaw = new THREE.Euler();
  private roll = new THREE.Matrix4();
  private pitch = new THREE.Matrix4();

  constructor(private city: City, assets: AssetLibrary) {
    this.pools = [
      new Pool(assets.get('sailboat'), createAssetMaterial('sailboat'), MAX_BOATS, { shadows: true, colors: true }),
      new Pool(assets.get('motorboat'), createAssetMaterial('motorboat'), MAX_BOATS, { shadows: true, colors: true }),
    ];
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    // Wakes are drawn additively; the instance colour sets their brightness.
    this.wakes = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: wakeTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), MAX_BOATS);
    this.wakes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BOATS * 3), 3);
    this.wakes.count = 0;
    this.wakes.frustumCulled = false;
    this.wakes.renderOrder = 3;
    this.group.add(this.pools[0].mesh, this.pools[1].mesh, this.wakes);
  }

  /** Open water deep enough for a boat (and, for sailboats, with no bridge overhead). */
  private sailable(x: number, z: number, sail: boolean): boolean {
    const t = this.city.terrain;
    if (!t.inBounds(x, z, 40)) return false;
    if (t.sampleBase(x, z) > WATER_LEVEL - 1.6) return false;
    return !sail || t.deckHeightAt(x, z) < WATER_LEVEL + 0.5 || t.roadHeightAt(x, z) < WATER_LEVEL + 2;
  }

  private clearPath(ax: number, az: number, bx: number, bz: number, sail: boolean): boolean {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / 12));
    for (let k = 1; k <= n; k++) if (!this.sailable(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, sail)) return false;
    return true;
  }

  /** Counts open water once (and after terraforming) to size the fleet. */
  private recount(): void {
    let wet = 0;
    for (let i = 0; i < 400; i++) if (this.sailable(this.rng.next() * WORLD_SIZE, this.rng.next() * WORLD_SIZE, false)) wet++;
    // About one boat per 0.6 km² of water, up to the cap.
    const area = (wet / 400) * WORLD_SIZE * WORLD_SIZE;
    this.capacity = Math.min(MAX_BOATS, Math.floor(area / 600_000));
    this.boats = this.boats.filter((b) => this.sailable(b.x, b.z, b.kind === 0));
  }

  private spawn(): void {
    for (let tries = 0; tries < 60; tries++) {
      const x = 60 + this.rng.next() * (WORLD_SIZE - 120), z = 60 + this.rng.next() * (WORLD_SIZE - 120);
      const kind: 0 | 1 = this.rng.next() < 0.55 ? 0 : 1;
      if (!this.sailable(x, z, kind === 0)) continue;
      this.boats.push({ kind, x, z, heading: this.rng.next() * Math.PI * 2, speed: 0, tx: x, tz: z, wait: this.rng.next() * 8, color: HULLS[this.boats.length % HULLS.length], phase: this.rng.next() * 6.28 });
      return;
    }
  }

  private retarget(b: Boat): void {
    for (let tries = 0; tries < 14; tries++) {
      const a = this.rng.next() * Math.PI * 2, r = 120 + this.rng.next() * 520;
      const tx = b.x + Math.cos(a) * r, tz = b.z + Math.sin(a) * r;
      if (this.sailable(tx, tz, b.kind === 0) && this.clearPath(b.x, b.z, tx, tz, b.kind === 0)) {
        b.tx = tx;
        b.tz = tz;
        return;
      }
    }
    b.wait = 4 + this.rng.next() * 6;
  }

  update(simDt: number): void {
    const t = this.city.terrain;
    if (t.waterVersion !== this.waterVersion) {
      this.waterVersion = t.waterVersion;
      this.recount();
    }
    if (this.boats.length < this.capacity) this.spawn();
    const dt = Math.min(simDt, 0.5);
    this.time += dt;
    const counts = [0, 0];
    let wakes = 0;
    for (const b of this.boats) {
      const max = b.kind === 0 ? 3.6 : 7.5;
      if (b.wait > 0) {
        b.wait -= dt;
        b.speed = Math.max(0, b.speed - dt * 1.5);
        if (b.wait <= 0) this.retarget(b);
      } else {
        const dx = b.tx - b.x, dz = b.tz - b.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 18) {
          b.wait = b.kind === 0 ? 2 + this.rng.next() * 10 : this.rng.next() * 4;
        } else {
          // Turn gently toward the target, slowing in tight turns.
          let diff = Math.atan2(dz, dx) - b.heading;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          b.heading += Math.max(-0.45 * dt, Math.min(0.45 * dt, diff));
          const want = max * (1 - Math.min(0.7, Math.abs(diff) / 2)) * Math.min(1, dist / 40);
          b.speed += Math.max(-1.5 * dt, Math.min(1.0 * dt, want - b.speed));
        }
      }
      const nx = b.x + Math.cos(b.heading) * b.speed * dt, nz = b.z + Math.sin(b.heading) * b.speed * dt;
      if (this.sailable(nx, nz, b.kind === 0)) {
        b.x = nx;
        b.z = nz;
      } else {
        b.speed = 0;
        this.retarget(b);
      }
      // Gentle swell: bob, pitch and roll; sailboats heel a little under sail.
      const s = this.time * 1.3 + b.phase;
      const y = WATER_LEVEL + 0.06 * Math.sin(s) - (b.kind === 0 ? 0.3 : 0.25);
      const heel = b.kind === 0 ? 0.08 * Math.min(1, b.speed / 3) : 0;
      this.q.setFromEuler(this.yaw.set(0, -b.heading, 0, 'YXZ'));
      this.m.compose(this.v.set(b.x, y, b.z), this.q, this.sc.set(1, 1, 1));
      const pool = this.pools[b.kind];
      const i = counts[b.kind]++;
      // Rocking: a small roll (with heel under sail) and pitch on top of the heading; motorboats lift the bow at speed.
      this.roll.makeRotationX(0.03 * Math.sin(s * 0.8) + heel);
      this.pitch.makeRotationZ(0.02 * Math.sin(s * 1.1) + (b.kind === 1 ? 0.035 * Math.min(1, b.speed / 7) : 0));
      this.m.multiply(this.roll).multiply(this.pitch);
      this.m.toArray(pool.matrices, i * 16);
      const c = pool.colors;
      if (c) {
        this.col.setHex(b.color);
        c.set([this.col.r, this.col.g, this.col.b], i * 3);
      }
      // Wake behind the stern, longer and brighter at speed.
      if (b.speed > 0.6) {
        const len = 6 + b.speed * 2;
        const back = (b.kind === 0 ? 4.5 : 3.5) + len / 2;
        const wx = b.x - Math.cos(b.heading) * back, wz = b.z - Math.sin(b.heading) * back;
        writeMatrix(this.wakes.instanceMatrix.array as Float32Array, wakes * 16, wx, WATER_LEVEL + 0.08, wz, b.heading + Math.PI, len, 1, 2.6 + b.speed * 0.35);
        // Foam catches the light: fainter at night.
        const k = Math.min(1, b.speed / max) * 0.42 * (1 - 0.75 * globalUniforms.uNight.value);
        (this.wakes.instanceColor!.array as Float32Array).set([k, k, k], wakes * 3);
        wakes++;
      }
    }
    for (let k = 0; k < 2; k++) {
      this.pools[k].mesh.count = counts[k];
      this.pools[k].mesh.instanceMatrix.needsUpdate = true;
      if (this.pools[k].mesh.instanceColor) this.pools[k].mesh.instanceColor!.needsUpdate = true;
    }
    this.wakes.count = wakes;
    this.wakes.instanceMatrix.needsUpdate = true;
    this.wakes.instanceColor!.needsUpdate = true;
  }
}

/** A V of churned water: bright at the stern (u = 0), fading behind and towards the edges. */
export function wakeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(128, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 128; x++) {
      const u = x / 127; // 0 at the stern end
      const v = Math.abs(y / 63 - 0.5) * 2; // 0 on the centreline
      const spread = 0.25 + u * 0.75;
      const arms = Math.exp(-(((v - spread * 0.9) / 0.12) ** 2)) * 0.8;
      const core = Math.exp(-((v / (0.18 + u * 0.3)) ** 2)) * (1 - u) * 0.9;
      const a = Math.min(1, (arms + core) * (1 - u) ** 1.2) * (v <= 1 ? 1 : 0);
      const o = (y * 128 + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
