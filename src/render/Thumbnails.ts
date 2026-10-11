import * as THREE from 'three';
import { sampleBezier } from '../core/geom2d';
import type { Terrain } from '../sim/world/Terrain';
import { ROAD_TYPES, type RoadTypeId } from '../sim/roads/RoadTypes';
import type { AssetLibrary, AssetName } from './assets/AssetLibrary';
import { Pool, createAssetMaterial, createFoliageDepthMaterial, createFoliageMaterial, writeMatrix } from './assets/AssetMaterials';
import type { BuildingProp } from './buildings/BuildingKit';
import { createBuildingMaterial } from './buildings/BuildingMaterial';
import { mergeBuilt } from './buildings/BuildingRenderer';
import { generateBuilding } from './buildings/generators';
import { RoadGeo, buildPreview } from './roads/RoadMeshBuilder';
import { createRoadMaterial } from './roads/RoadMaterial';
import { toBufferGeometry } from './roads/RoadRenderer';
import { globalUniforms } from './shared';

/** What a construction card shows: a building, a stretch of road, or a stand of trees. */
export type ThumbSpec =
  | { kind: 'building'; style: string; w: number; d: number; floors: number; level: number; seed?: number; plane?: boolean }
  | { kind: 'road'; type: RoadTypeId; with?: 'cars' | 'stop' | 'bus' }
  | { kind: 'trees' };

/** Stored thumbnail size (CSS shows it at about half, so it stays crisp at 2× scale). */
export const THUMB_W = 240;
export const THUMB_H = 144;
/** Rendered at twice the stored size and filtered down, since the canvas has no MSAA. */
const SS = 2;

const TREES: AssetName[] = ['oak', 'maple', 'pine', 'bush'];
const CARS: AssetName[] = ['sedan', 'hatchback', 'suv', 'van'];
const CAR_COLORS = [0xb8bcc2, 0x8e1b1b, 0x2a4f7a, 0xe8e6e0, 0x2d2f33];

/** A flat world for the road mesh builder. */
const FLAT = { roadHeightAt: () => 0, deckHeightAt: () => 0, sampleBase: () => 0, heightAt: () => 0 } as unknown as Terrain;

interface Job {
  spec: ThumbSpec;
  cbs: ((url: string) => void)[];
}

/**
 * Small studio renders of buildable things (buildings, roads, trees) for the
 * construction dock. They are drawn with the game's own geometry generators
 * and materials into a corner of the main canvas just before a frame is
 * rendered (the frame then paints over it), and copied out as PNG data URLs.
 */
export class Thumbnails {
  private cache = new Map<string, string>();
  private queue = new Map<string, Job>();
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(26, THUMB_W / THUMB_H, 1, 6000);
  private sun = new THREE.DirectionalLight(0xfff3e2, 3.1);
  private hemi = new THREE.HemisphereLight(0xc6dafa, 0x5a5442, 1.05);
  private content = new THREE.Group();
  private buildingMat: THREE.MeshStandardMaterial;
  private roadMat: THREE.MeshStandardMaterial;
  private pools = new Map<AssetName, Pool>();
  private ground: THREE.Mesh;
  private out = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D | null;
  private tmpVp = new THREE.Vector4();
  private tmpSc = new THREE.Vector4();
  private tmpColor = new THREE.Color();

  constructor(private renderer: THREE.WebGLRenderer, private assets: AssetLibrary, private mainScene: THREE.Scene) {
    const state = new THREE.DataTexture(new Uint8Array([255, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
    state.needsUpdate = true;
    this.buildingMat = createBuildingMaterial({ uState: { value: state }, uStateSize: { value: 1 }, uBldOverlay: { value: 0 }, uGhost: { value: 0 }, uGhostColor: { value: new THREE.Color() } });
    const seg = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
    seg.needsUpdate = true;
    this.roadMat = createRoadMaterial({ uSegTex: { value: seg }, uSegTexSize: { value: 1 }, uTrafficOverlay: { value: 0 }, uGhost: { value: 0 }, uGhostColor: { value: new THREE.Color() } });
    const side = new THREE.MeshStandardMaterial({ color: 0x5b4a39, roughness: 1 });
    const top = new THREE.MeshStandardMaterial({ color: 0x5f7c40, roughness: 1 });
    this.ground = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [side, side, top, side, side, side]);
    this.ground.receiveShadow = true;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.4;
    this.scene.add(this.sun, this.sun.target, this.hemi, this.ground, this.content);
    // Same lights and (ineffective) fog as the world, so the world's compiled shaders are reused.
    this.scene.fog = new THREE.Fog(0x000000, 1e6, 2e6);
    this.out.width = THUMB_W;
    this.out.height = THUMB_H;
    this.ctx = this.out.getContext('2d');
  }

  /** Returns the thumbnail if it is ready; otherwise queues it and calls `cb` when it is. */
  request(key: string, spec: ThumbSpec, cb: (url: string) => void): string | null {
    const hit = this.cache.get(key);
    if (hit) return hit;
    const job = this.queue.get(key);
    if (job) job.cbs.push(cb);
    else this.queue.set(key, { spec, cbs: [cb] });
    return null;
  }

  /** Queues thumbnails ahead of time so the dock opens with them ready. */
  prewarm(items: [string, ThumbSpec][]): void {
    for (const [key, spec] of items) if (!this.cache.has(key) && !this.queue.has(key)) this.queue.set(key, { spec, cbs: [] });
  }

  get pending(): number {
    return this.queue.size;
  }

  /** Renders queued thumbnails. Call right before the main frame is rendered. */
  pump(budgetMs = 6): void {
    if (!this.queue.size || !this.ctx) return;
    const canvas = this.renderer.domElement;
    const pw = THUMB_W * SS, ph = THUMB_H * SS;
    if (canvas.width < pw || canvas.height < ph) return;
    const t0 = performance.now();
    const r = this.renderer;
    const pr = r.getPixelRatio();
    r.getViewport(this.tmpVp);
    r.getScissor(this.tmpSc);
    const scissor = r.getScissorTest();
    const clear = r.getClearColor(this.tmpColor).getHex();
    const clearA = r.getClearAlpha();
    const target = r.getRenderTarget();
    const g = globalUniforms;
    const saved = [g.uNight.value, g.uHour.value, g.uDesat.value, g.uWet.value, g.uSnow.value, g.uRain.value] as const;
    const cloud = g.uCloudShadow.value.clone();
    g.uNight.value = 0;
    g.uHour.value = 14;
    g.uDesat.value = 0;
    g.uWet.value = 0;
    g.uSnow.value = 0;
    g.uRain.value = 0;
    g.uCloudShadow.value.set(0, 0, 0, 0);
    this.scene.environment = this.mainScene.environment;
    this.scene.environmentIntensity = 0.11;
    try {
      r.setRenderTarget(null);
      r.setViewport(0, 0, pw / pr, ph / pr);
      r.setScissor(0, 0, pw / pr, ph / pr);
      r.setScissorTest(true);
      r.setClearColor(0x000000, 0);
      for (const [key, job] of this.queue) {
        this.queue.delete(key);
        this.build(job.spec);
        r.clear();
        r.render(this.scene, this.camera);
        this.ctx.clearRect(0, 0, THUMB_W, THUMB_H);
        this.ctx.drawImage(canvas, 0, canvas.height - ph, pw, ph, 0, 0, THUMB_W, THUMB_H);
        this.clearContent();
        const url = this.out.toDataURL('image/png');
        this.cache.set(key, url);
        for (const cb of job.cbs) cb(url);
        if (performance.now() - t0 > budgetMs) break;
      }
    } finally {
      r.setRenderTarget(target);
      r.setViewport(this.tmpVp);
      r.setScissor(this.tmpSc);
      r.setScissorTest(scissor);
      r.setClearColor(clear, clearA);
      [g.uNight.value, g.uHour.value, g.uDesat.value, g.uWet.value, g.uSnow.value, g.uRain.value] = saved;
      g.uCloudShadow.value.copy(cloud);
    }
  }

  private clearContent(): void {
    for (const c of [...this.content.children]) {
      this.content.remove(c);
      if (c instanceof THREE.Mesh && !(c instanceof THREE.InstancedMesh)) c.geometry.dispose();
    }
    for (const p of this.pools.values()) p.commit(0);
  }

  private pool(name: AssetName): Pool {
    let p = this.pools.get(name);
    if (!p) {
      const leaf = this.assets.leafTexture;
      const tree = TREES.includes(name);
      const mat = tree ? createFoliageMaterial(leaf, name !== 'pine') : createAssetMaterial('thumb');
      p = new Pool(this.assets.get(name), mat, 16, { shadows: true, colors: true, depth: tree && name !== 'pine' ? createFoliageDepthMaterial(leaf) : undefined });
      this.pools.set(name, p);
    }
    if (!p.mesh.parent) this.content.add(p.mesh);
    return p;
  }

  private place(name: AssetName, x: number, y: number, z: number, rot: number, s = 1, color = 0xffffff): void {
    const p = this.pool(name);
    const n = p.mesh.count;
    p.ensure(n + 1);
    writeMatrix(p.matrices, n * 16, x, y, z, rot, s);
    const c = this.tmpColor.setHex(color, THREE.SRGBColorSpace);
    const cols = p.colors;
    if (cols) cols.set([c.r, c.g, c.b], n * 3);
    p.commit(n + 1);
  }

  /** Adds the instanced props a building generator asked for (trees, parked cars, turbines). */
  private props(list: BuildingProp[], box: THREE.Box3): void {
    for (const pr of list) {
      const s = pr.scale ?? 1;
      if (pr.kind === 'tree') {
        this.place(pr.variant === 2 ? 'pine' : pr.variant === 1 ? 'maple' : 'oak', pr.x, pr.y, pr.z, pr.rot, s * 0.8, 0xe6eadc);
        box.expandByPoint(new THREE.Vector3(pr.x, pr.y + 9 * s, pr.z));
      } else if (pr.kind === 'bush') this.place('bush', pr.x, pr.y, pr.z, pr.rot, s);
      else if (pr.kind === 'car') this.place(CARS[(pr.variant ?? 0) % CARS.length], pr.x, pr.y, pr.z, pr.rot, 1, pr.color ?? 0xffffff);
      else if (pr.kind === 'rotor') {
        const fx = Math.cos(pr.rot), fz = Math.sin(pr.rot);
        this.place('wind_tower', pr.x - fx * 2.2, pr.y - 48.8, pr.z - fz * 2.2, pr.rot);
        this.place('wind_rotor', pr.x, pr.y, pr.z, pr.rot);
        box.expandByPoint(new THREE.Vector3(pr.x, pr.y + 21, pr.z));
      }
    }
  }

  private build(spec: ThumbSpec): void {
    const box = new THREE.Box3();
    let w = 30, d = 30;
    if (spec.kind === 'building') {
      w = spec.w;
      d = spec.d;
      const geo = generateBuilding({ style: spec.style as never, w, d, floors: spec.floors, level: spec.level, seed: spec.seed ?? 4242 }, 0, 0, 0, 0);
      const mesh = new THREE.Mesh(mergeBuilt([{ geo, slot: -1, baseY: 0 }]), this.buildingMat);
      mesh.castShadow = mesh.receiveShadow = true;
      this.content.add(mesh);
      mesh.geometry.computeBoundingBox();
      box.copy(mesh.geometry.boundingBox!);
      this.props(geo.props, box);
      box.min.y = Math.min(box.min.y, 0);
    } else if (spec.kind === 'road') {
      const rt = ROAD_TYPES[spec.type];
      const len = 40;
      w = len;
      d = rt.halfWidth * 2 + 10;
      const out = new RoadGeo();
      buildPreview(out, sampleBezier(-len / 2, 0, 0, 0, len / 2, 0), spec.type, FLAT);
      const mesh = new THREE.Mesh(toBufferGeometry(out), this.roadMat);
      mesh.receiveShadow = true;
      this.content.add(mesh);
      const lane = (i: number) => rt.median / 2 + rt.laneWidth * (i + 0.5);
      if (spec.with === 'cars') {
        this.place('sedan', -6, 0.1, lane(0), 0, 1, CAR_COLORS[1]);
        this.place('hatchback', 8, 0.1, -lane(rt.lanes - 1), Math.PI, 1, CAR_COLORS[2]);
        if (rt.lanes > 1) this.place('suv', -12, 0.1, -lane(0), Math.PI, 1, CAR_COLORS[3]);
      } else if (spec.with === 'stop' || spec.with === 'bus') {
        this.place('bus', -2, 0.1, lane(rt.lanes - 1), 0, 1, 0xffffff);
        if (spec.with === 'stop') this.place('bus_stop', 2, 0.2, rt.asphaltHalf + 1.6, Math.PI);
      }
      box.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 3, 0));
    } else {
      const spots: [AssetName, number, number, number][] = [['oak', -7, -4, 1], ['pine', 5, -7, 1.05], ['maple', 8, 4, 0.95], ['oak', -2, 7, 0.85], ['bush', -9, 6, 1.1], ['pine', -12, -10, 0.9], ['bush', 12, -2, 0.9]];
      for (const [n, x, z, s] of spots) this.place(n, x, 0, z, x * 0.7 + z, s * (n === 'bush' ? 1 : 0.8), 0xe6eadc);
      box.set(new THREE.Vector3(-14, 0, -12), new THREE.Vector3(14, 10, 11));
    }
    // A diorama tile under everything.
    const m = spec.kind === 'road' ? 0 : Math.max(5, Math.max(w, d) * 0.06);
    if (spec.kind === 'building' && spec.plane) {
      w = Math.max(w, box.max.x - box.min.x);
      d = Math.max(d, box.max.z - box.min.z);
    }
    this.ground.scale.set(w + m * 2, 1.4, d + m * 2);
    this.ground.position.set((box.min.x + box.max.x) / 2, -0.72, (box.min.z + box.max.z) / 2);
    box.union(new THREE.Box3().setFromCenterAndSize(this.ground.position.clone().setY(-0.7), new THREE.Vector3(w + m * 2, 1.4, d + m * 2)));
    this.frame(box);
  }

  /** Points the camera from the front-left and pulls back until the whole box fills the frame. */
  private frame(box: THREE.Box3): void {
    const cam = this.camera;
    const yaw = -0.72, pitch = 0.6;
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const center = box.getCenter(new THREE.Vector3());
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const tanH = tanV * cam.aspect;
    const right = new THREE.Vector3(), up = new THREE.Vector3(), c = new THREE.Vector3();
    let dist = box.getSize(c).length() / tanV;
    // Perspective makes near corners look bigger, so fit in screen space: re-centre on the
    // projected extent and scale the distance until it fills the frame (converges in a few steps).
    for (let iter = 0; iter < 6; iter++) {
      cam.position.copy(center).addScaledVector(dir, dist);
      cam.near = Math.max(0.5, dist * 0.05);
      cam.far = dist * 4;
      cam.lookAt(center);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      right.setFromMatrixColumn(cam.matrixWorld, 0);
      up.setFromMatrixColumn(cam.matrixWorld, 1);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < 8; i++) {
        c.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(cam);
        minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
      }
      center.addScaledVector(right, ((minX + maxX) / 2) * tanH * dist).addScaledVector(up, ((minY + maxY) / 2) * tanV * dist);
      dist *= Math.max(maxX - minX, maxY - minY) / 2 / 0.92;
    }
    cam.position.copy(center).addScaledVector(dir, dist);
    cam.near = Math.max(0.5, dist * 0.05);
    cam.far = dist * 4;
    cam.lookAt(center);
    cam.updateProjectionMatrix();
    // Sun from the upper right, with a shadow camera that hugs the model.
    const size = box.getSize(new THREE.Vector3()).length();
    this.sun.position.copy(center).add(new THREE.Vector3(0.45, 0.82, 0.36).normalize().multiplyScalar(size * 1.5));
    this.sun.target.position.copy(center);
    this.sun.target.updateMatrixWorld();
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -size * 0.6;
    sc.right = sc.top = size * 0.6;
    sc.near = size * 0.2;
    sc.far = size * 3;
    sc.updateProjectionMatrix();
  }
}
