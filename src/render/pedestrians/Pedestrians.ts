import * as THREE from 'three';
import { bodySize } from '../../sim/population/Citizens';
import { PauseWhy, PedState, type Pedestrians } from '../../sim/walk/Pedestrians';
import type { AssetLibrary } from '../assets/AssetLibrary';
import { writeMatrix } from '../assets/AssetMaterials';
import { Body, type Look, type WeatherNow, lookFor, newLook } from './Appearance';
import { ADULT_JOINTS, CHILD_JOINTS, type Joints, LO_JOINTS, POSE, createPeopleDepthMaterial, createPeopleMaterial } from './PeopleMaterial';

/** People further than this from the camera aren't drawn; nearer than HI_DIST they get the detailed figures. */
const DRAW_DIST = 520;
const HI_DIST = 75;
const ATTRS = ['aC0', 'aC1', 'aC2', 'aC3', 'aC4'] as const;
/** The child model is built at 0.74 of adult height. */
const CHILD_BASE = 0.74;

/** Height and build of a person (shared with picking). */
export const personSize = bodySize;

/** One instanced draw call for one body type, growing as needed. */
class Batch {
  mesh!: THREE.InstancedMesh;
  attrs: THREE.InstancedBufferAttribute[] = [];
  cap = 0;
  n = 0;

  constructor(
    private group: THREE.Group,
    private geo: THREE.BufferGeometry,
    private mat: THREE.Material,
    private depth: THREE.Material | null,
    cap: number,
  ) {
    this.create(cap);
  }

  private create(cap: number): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
    }
    const g = this.geo.clone();
    this.attrs = ATTRS.map((name) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      return a;
    });
    const m = new THREE.InstancedMesh(g, this.mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = !!this.depth;
    m.receiveShadow = true;
    if (this.depth) m.customDepthMaterial = this.depth;
    this.mesh = m;
    this.cap = cap;
    this.group.add(m);
  }

  ensure(n: number): void {
    if (n <= this.cap) return;
    let cap = this.cap;
    while (cap < n) cap *= 2;
    this.create(cap);
  }

  commit(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const a of this.attrs) a.needsUpdate = true;
  }
}

/** Draws the people on foot: detailed animated figures near the camera, simple ones further out. */
export class PedestrianRenderer {
  readonly group = new THREE.Group();
  private batches: Batch[];
  /** Each person's look, worked out once per person (and again when the weather turns). */
  private cacheSerial = new Uint32Array(0);
  private cacheLook: Look[] = [];
  private weatherKey = -1;

  constructor(assets: AssetLibrary) {
    const make = (name: 'person_adult' | 'person_dress' | 'person_child' | 'person_lo', j: Joints, shadows: boolean, cap: number) =>
      new Batch(this.group, assets.get(name), createPeopleMaterial(j), shadows ? createPeopleDepthMaterial(j) : null, cap);
    this.batches = [make('person_adult', ADULT_JOINTS, true, 128), make('person_dress', ADULT_JOINTS, true, 64), make('person_child', CHILD_JOINTS, true, 64), make('person_lo', LO_JOINTS, false, 512)];
  }

  get visible(): boolean {
    return this.group.visible;
  }

  update(ped: Pedestrians, camera: THREE.Vector3, camDist: number, weather: WeatherNow): void {
    const show = camDist < 560;
    this.group.visible = show;
    if (!show) return;
    if (this.cacheSerial.length !== ped.max) {
      this.cacheSerial = new Uint32Array(ped.max);
      this.cacheLook = Array.from({ length: ped.max }, () => newLook());
    }
    // Coats, hats and umbrellas follow the weather.
    const key = (weather.rain > 0.18 ? 1 : 0) | (weather.temperature < 8 ? 2 : 0) | (weather.temperature < 3 ? 4 : 0) | (weather.temperature < 2 ? 8 : 0);
    if (key !== this.weatherKey) {
      this.weatherKey = key;
      this.cacheSerial.fill(0);
    }
    for (const b of this.batches) {
      b.ensure(ped.count + 8);
      b.n = 0;
    }
    const hi2 = HI_DIST * HI_DIST, draw2 = DRAW_DIST * DRAW_DIST;
    for (let i = 0; i < ped.max; i++) {
      if (!ped.active[i] || ped.state[i] === PedState.Free) continue;
      const x = ped.x[i], y = ped.y[i], z = ped.z[i];
      const d2 = (x - camera.x) ** 2 + (y - camera.y) ** 2 + (z - camera.z) ** 2;
      if (d2 > draw2) continue;
      const s = ped.scale[i];
      if (s < 0.02) continue;
      let look = this.cacheLook[i];
      if (this.cacheSerial[i] !== ped.serial[i]) {
        look = lookFor(ped.look[i], ped.age[i], ped.errand[i], weather, look);
        this.cacheSerial[i] = ped.serial[i];
      }
      const batch = this.batches[d2 < hi2 ? look.body : 3];
      const k = batch.n++;
      const size = bodySize(ped.age[i], ped.look[i]);
      const gs = (look.body === Body.Child && d2 < hi2 ? size.h / CHILD_BASE : size.h) * s;
      writeMatrix(batch.mesh.instanceMatrix.array as Float32Array, k * 16, x, y, z, ped.heading[i], size.w * gs, gs, size.w * gs);
      // What they're doing: walking, standing, chatting, sitting in the park.
      const lead = ped.leader[i] >= 0 ? ped.leader[i] : i;
      const sp = ped.speed[i];
      let pose: number = POSE.stand;
      let amp = 0;
      if (sp > 0.15) {
        pose = POSE.walk;
        amp = Math.min(1.25, sp / 1.35);
      } else if (ped.state[lead] === PedState.Pause && ped.pauseWhy[lead] === PauseWhy.Chat) pose = POSE.talk;
      else if (ped.state[lead] === PedState.Linger && ((ped.look[i] >>> 5) % 10) < 6) pose = POSE.sit;
      const a = batch.attrs;
      const o = k * 4;
      put(a[0].array as Float32Array, o, look.top, (look.lightShoes ? 1 : 0) + look.lean);
      put(a[1].array as Float32Array, o, look.bottom, look.mask);
      put(a[2].array as Float32Array, o, look.skin, pose);
      put(a[3].array as Float32Array, o, look.hair, ped.stride[i] % (Math.PI * 2));
      put(a[4].array as Float32Array, o, look.accent, amp);
    }
    for (const b of this.batches) b.commit();
  }
}

function put(arr: Float32Array, o: number, c: THREE.Color, w: number): void {
  arr[o] = c.r;
  arr[o + 1] = c.g;
  arr[o + 2] = c.b;
  arr[o + 3] = w;
}
