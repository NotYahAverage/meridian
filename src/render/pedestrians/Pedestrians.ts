import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { type PolyPoint, pointAt } from '../../core/geom2d';
import { Rng } from '../../core/rng';
import type { City } from '../../sim/City';
import { ROAD_TYPES } from '../../sim/roads/RoadTypes';
import { timeOfDayFactor } from '../../sim/traffic/TripGenerator';
import { BuildingState } from '../../sim/types';
import { Pool, createAssetMaterial, writeMatrix } from '../assets/AssetMaterials';

const MAX = 1400;
const CLOTHES = [0x2d3a4a, 0x8a2b2b, 0xd9d4c7, 0x3f6d4e, 0x1d1f22, 0x6b5b95, 0xc98b3a, 0x4a7fb5, 0x9c9c9c, 0xe0b0a0];
const SKIN = [[0.95, 0.78, 0.65], [0.8, 0.6, 0.45], [0.55, 0.38, 0.27], [0.36, 0.25, 0.18]];

function personGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, col: number[], mat: number) => {
    const n = g.getAttribute('position').count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set(col, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(n).fill(mat), 1));
    g.deleteAttribute('uv');
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  const body = new THREE.CapsuleGeometry(0.19, 0.62, 3, 8);
  body.translate(0, 1.08, 0);
  add(body, [1, 1, 1], 0);
  const legs = new THREE.CylinderGeometry(0.15, 0.12, 0.78, 6);
  legs.translate(0, 0.39, 0);
  add(legs, [0.12, 0.13, 0.16], 1);
  const head = new THREE.SphereGeometry(0.12, 8, 6);
  head.translate(0, 1.62, 0);
  add(head, SKIN[1], 1);
  return mergeGeometries(parts)!;
}

/** Purely visual pedestrians strolling along sidewalks near the camera. */
const CLOTHES_LINEAR = CLOTHES.map((hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace));

export class Pedestrians {
  readonly pool: Pool;
  private rng = new Rng(77);
  private active = new Uint8Array(MAX);
  private seg = new Int32Array(MAX);
  private s = new Float32Array(MAX);
  private u = new Float32Array(MAX);
  private dir = new Float32Array(MAX);
  private speed = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private phase = new Float32Array(MAX);
  private color = new Float32Array(MAX * 3);
  private count = 0;
  private pp: PolyPoint = { x: 0, z: 0, tx: 0, tz: 0, i: 0 };
  private spawnTimer = 0;

  constructor(private city: City) {
    this.pool = new Pool(personGeometry(), createAssetMaterial('person'), MAX, { colors: true, shadows: false });
  }

  update(dt: number, simDt: number, focus: THREE.Vector3, camDist: number, hour: number): void {
    const show = camDist < 560;
    this.pool.mesh.visible = show;
    if (!show) return;
    const city = this.city;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.25;
      const near = city.buildings.queryRadius(focus.x, focus.z, 380).filter((b) => b.state === BuildingState.Active && b.segId);
      let people = 0;
      for (const b of near) people += b.residents + b.workers * 1.2;
      const target = Math.min(MAX, Math.round((people * 0.05 + near.length * 0.35) * (0.25 + 0.75 * timeOfDayFactor(hour))));
      let spawn = Math.min(30, target - this.count);
      while (spawn-- > 0 && near.length) this.spawnAt(near[Math.floor(this.rng.next() * near.length)]);
    }
    const m = this.pool.matrices;
    const c = this.pool.colors!;
    let n = 0;
    for (let i = 0; i < MAX; i++) {
      if (!this.active[i]) continue;
      const seg = city.roads.segments.get(this.seg[i]);
      this.life[i] -= simDt;
      if (!seg || this.life[i] <= 0) {
        this.active[i] = 0;
        this.count--;
        continue;
      }
      this.s[i] += this.dir[i] * this.speed[i] * simDt;
      const lo = seg.trimA + 1, hi = seg.length - seg.trimB - 1;
      if (this.s[i] < lo || this.s[i] > hi) {
        this.dir[i] = -this.dir[i];
        this.s[i] = Math.min(hi, Math.max(lo, this.s[i]));
      }
      this.phase[i] += simDt * this.speed[i] * 4.2;
      pointAt(seg.poly, this.s[i], this.pp);
      const x = this.pp.x - this.pp.tz * this.u[i];
      const z = this.pp.z + this.pp.tx * this.u[i];
      const y = city.terrain.roadHeightAt(x, z) + 0.23 + Math.abs(Math.sin(this.phase[i])) * 0.05;
      const heading = Math.atan2(this.pp.tz * this.dir[i], this.pp.tx * this.dir[i]);
      writeMatrix(m, n * 16, x, y, z, heading, 1);
      c[n * 3] = this.color[i * 3];
      c[n * 3 + 1] = this.color[i * 3 + 1];
      c[n * 3 + 2] = this.color[i * 3 + 2];
      n++;
    }
    n = this.waitingAtStops(n, focus, hour);
    this.pool.commit(n);
  }

  /** People standing at bus stops near the camera (count follows ridership). */
  private waitingAtStops(n: number, focus: THREE.Vector3, hour: number): number {
    const city = this.city;
    const m = this.pool.matrices;
    const c = this.pool.colors!;
    const busy = 0.3 + 0.7 * timeOfDayFactor(hour);
    for (const st of city.transit.stops.values()) {
      if ((st.x - focus.x) ** 2 + (st.z - focus.z) ** 2 > 420 * 420) continue;
      const seg = city.roads.segments.get(st.segId);
      if (!seg) continue;
      const people = Math.min(7, Math.round(Math.min(st.waiting, 12) * busy * 0.6));
      if (!people) continue;
      pointAt(seg.poly, st.s, this.pp);
      const rt = ROAD_TYPES[seg.type];
      const base = rt.asphaltHalf + rt.sidewalk * 0.5;
      for (let k = 0; k < people && n < MAX; k++) {
        const h = ((st.id * 9301 + k * 49297) % 233280) / 233280;
        const along = (k - people / 2) * 0.8 + (h - 0.5) * 0.4;
        const off = base - 0.4 + h * 0.6;
        const x = this.pp.x + this.pp.tx * along - this.pp.tz * off * st.side;
        const z = this.pp.z + this.pp.tz * along + this.pp.tx * off * st.side;
        // Facing the road, waiting for the bus.
        const heading = Math.atan2(-this.pp.tx * st.side, this.pp.tz * st.side) + (h - 0.5) * 0.8;
        writeMatrix(m, n * 16, x, city.terrain.roadHeightAt(x, z) + 0.23, z, heading, 1);
        const col = CLOTHES_LINEAR[(st.id + k * 3) % CLOTHES_LINEAR.length];
        c[n * 3] = col.r;
        c[n * 3 + 1] = col.g;
        c[n * 3 + 2] = col.b;
        n++;
      }
    }
    return n;
  }

  private spawnAt(b: { segId: number; segS: number; side: number }): void {
    const seg = this.city.roads.segments.get(b.segId);
    if (!seg) return;
    const rt = ROAD_TYPES[seg.type];
    if (rt.sidewalk <= 0) return;
    let i = -1;
    for (let k = 0; k < MAX; k++) {
      if (!this.active[k]) {
        i = k;
        break;
      }
    }
    if (i < 0) return;
    const r = this.rng;
    this.active[i] = 1;
    this.count++;
    this.seg[i] = seg.id;
    this.s[i] = Math.min(seg.length - seg.trimB - 1, Math.max(seg.trimA + 1, b.segS + r.range(-6, 6)));
    const side = r.chance(0.8) ? b.side : -b.side;
    this.u[i] = side * (rt.asphaltHalf + 0.5 + rt.sidewalk * r.range(0.3, 0.7));
    this.dir[i] = r.chance(0.5) ? 1 : -1;
    this.speed[i] = r.range(1.05, 1.6);
    this.life[i] = r.range(18, 60);
    this.phase[i] = r.next() * 6;
    const col = new THREE.Color().setHex(r.pick(CLOTHES), THREE.SRGBColorSpace);
    this.color[i * 3] = col.r;
    this.color[i * 3 + 1] = col.g;
    this.color[i * 3 + 2] = col.b;
  }
}
