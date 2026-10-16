import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PedState, type Pedestrians } from '../../sim/walk/Pedestrians';
import { Pool, createAssetMaterial, writeMatrix } from '../assets/AssetMaterials';

const CLOTHES = [0x2d3a4a, 0x8a2b2b, 0xd9d4c7, 0x3f6d4e, 0x1d1f22, 0x6b5b95, 0xc98b3a, 0x4a7fb5, 0x9c9c9c, 0xe0b0a0, 0x7a4b2a, 0x2f5f6f, 0xb85c7a, 0x556b2f];
const SKIN = [[0.95, 0.78, 0.65], [0.8, 0.6, 0.45], [0.55, 0.38, 0.27], [0.36, 0.25, 0.18]];
/** People further than this from the camera aren't drawn. */
const DRAW_DIST = 520;

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

const CLOTHES_LINEAR = CLOTHES.map((hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace));

/** Body height and build for a person of a given age (from their look seed). */
export function personSize(age: number, look: number): { h: number; w: number } {
  const v = ((look >>> 8) % 1000) / 1000;
  const b = ((look >>> 18) % 1000) / 1000;
  const h = age < 5 ? 0.52 + v * 0.06 : age < 13 ? 0.6 + (age - 5) * 0.035 + v * 0.05 : age < 17 ? 0.86 + v * 0.1 : 0.93 + v * 0.15 - (age > 75 ? 0.04 : 0);
  return { h, w: h * (0.9 + b * 0.25) };
}

/** Draws the people on foot from the pedestrian simulation (one instanced draw call). */
export class PedestrianRenderer {
  readonly pool: Pool;

  constructor() {
    this.pool = new Pool(personGeometry(), createAssetMaterial('person'), 512, { colors: true, shadows: false });
  }

  update(ped: Pedestrians, camera: THREE.Vector3, camDist: number): void {
    const show = camDist < 560;
    this.pool.mesh.visible = show;
    if (!show) return;
    this.pool.ensure(ped.count + 8);
    const m = this.pool.matrices;
    const c = this.pool.colors!;
    let n = 0;
    const d2max = DRAW_DIST * DRAW_DIST;
    for (let i = 0; i < ped.max; i++) {
      if (!ped.active[i] || ped.state[i] === PedState.Free) continue;
      const x = ped.x[i], z = ped.z[i];
      if ((x - camera.x) ** 2 + (z - camera.z) ** 2 > d2max) continue;
      const s = ped.scale[i];
      if (s < 0.02) continue;
      const size = personSize(ped.age[i], ped.look[i]);
      const bob = Math.abs(Math.sin(ped.stride[i])) * 0.05 * Math.min(1, ped.speed[i]);
      writeMatrix(m, n * 16, x, ped.y[i] + bob, z, ped.heading[i], size.w * s, size.h * s, size.w * s);
      const col = CLOTHES_LINEAR[ped.look[i] % CLOTHES_LINEAR.length];
      c[n * 3] = col.r;
      c[n * 3 + 1] = col.g;
      c[n * 3 + 2] = col.b;
      n++;
    }
    this.pool.commit(n);
  }
}
