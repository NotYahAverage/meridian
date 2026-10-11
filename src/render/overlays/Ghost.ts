import * as THREE from 'three';
import { plannedLift } from '../../sim/roads/Overpass';
import type { City } from '../../sim/City';
import type { LotFrame } from '../../sim/buildings/Spawner';
import type { RoadPlan } from '../../sim/roads/RoadPlanner';
import { SERVICE_BY_ID } from '../../sim/services/ServiceTypes';
import { canBeOneWay } from '../../sim/roads/RoadTypes';
import { sampleBezier } from '../../core/geom2d';
import { type BuildingUniforms, createBuildingMaterial } from '../buildings/BuildingMaterial';
import { mergeBuilt } from '../buildings/BuildingRenderer';
import { generateBuilding } from '../buildings/generators';
import { RoadGeo, buildPreview } from '../roads/RoadMeshBuilder';
import { toBufferGeometry } from '../roads/RoadRenderer';
import { type RoadUniforms, createRoadMaterial } from '../roads/RoadMaterial';

const OK = new THREE.Color(0.25, 0.95, 0.78);
const BAD = new THREE.Color(1.0, 0.25, 0.2);

/** Translucent previews for roads and buildings being placed, plus snap markers. */
export class Ghost {
  readonly group = new THREE.Group();
  private roadMesh: THREE.Mesh | null = null;
  private bldMesh: THREE.Mesh | null = null;
  private roadMat: THREE.MeshStandardMaterial;
  private bldMat: THREE.MeshStandardMaterial;
  private roadU: RoadUniforms;
  private bldU: BuildingUniforms;
  private markers: THREE.InstancedMesh;
  private selRing: THREE.Mesh;
  private bldKey = '';
  /** Tiny off-screen previews drawn for the first frames so their shaders are ready before first use. */
  private primers: THREE.Mesh[] = [];
  private primeFrames = 4;

  constructor(private city: City, roadUniforms: RoadUniforms, bldUniforms: BuildingUniforms) {
    this.roadU = { ...roadUniforms, uGhostColor: { value: OK.clone() } };
    this.roadMat = createRoadMaterial(this.roadU, true);
    this.bldU = { ...bldUniforms, uGhostColor: { value: OK.clone() } };
    this.bldMat = createBuildingMaterial(this.bldU, true);
    const ring = new THREE.RingGeometry(2.2, 3.2, 28);
    ring.rotateX(-Math.PI / 2);
    this.markers = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false }), 32);
    this.markers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(32 * 3), 3);
    this.markers.count = 0;
    this.markers.renderOrder = 15;
    this.markers.frustumCulled = false;
    this.group.add(this.markers);
    const sr = new THREE.RingGeometry(0.88, 1, 56);
    sr.rotateX(-Math.PI / 2);
    this.selRing = new THREE.Mesh(sr, new THREE.MeshBasicMaterial({ color: 0x5ef2e0, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
    this.selRing.visible = false;
    this.selRing.renderOrder = 14;
    this.selRing.frustumCulled = false;
    this.group.add(this.selRing);
    this.prime();
  }

  private prime(): void {
    const g = new RoadGeo();
    const sp = this.city.terrain.spawn;
    buildPreview(g, sampleBezier(sp.endX, sp.endZ, sp.endX + 5, sp.endZ, sp.endX + 10, sp.endZ), 'street', this.city.terrain);
    const geo = generateBuilding({ style: 'police', w: 20, d: 20, floors: 1, level: 1, seed: 1 }, sp.endX, sp.endZ, 0, 0);
    const meshes = [
      new THREE.Mesh(toBufferGeometry(g), this.roadMat),
      new THREE.Mesh(mergeBuilt([{ geo, slot: -1, baseY: 0 }]), this.bldMat),
    ];
    for (const m of meshes) {
      // Far below the terrain: drawn (and so compiled) but never seen.
      m.position.y = -5000;
      m.frustumCulled = false;
      this.primers.push(m);
      this.group.add(m);
    }
  }

  /** Called once per frame. */
  update(): void {
    if (this.primers.length && --this.primeFrames <= 0) {
      for (const m of this.primers) {
        this.group.remove(m);
        m.geometry.dispose();
      }
      this.primers = [];
    }
  }

  clear(): void {
    this.clearRoad();
    this.clearBuilding();
    this.markers.count = 0;
  }

  clearRoad(): void {
    for (const m of this.gridMeshes) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.gridMeshes = [];
    if (this.roadMesh) {
      this.group.remove(this.roadMesh);
      this.roadMesh.geometry.dispose();
      this.roadMesh = null;
    }
  }

  clearBuilding(): void {
    if (this.bldMesh) {
      this.group.remove(this.bldMesh);
      this.bldMesh.geometry.dispose();
      this.bldMesh = null;
      this.bldKey = '';
    }
  }

  private gridMeshes: THREE.Mesh[] = [];
  private badMat: THREE.Material | null = null;

  /** Previews many roads at once (grid tool): valid ones in the usual colour, blocked ones in red. */
  showRoads(valid: RoadPlan[], invalid: RoadPlan[]): void {
    this.clearRoad();
    if (!this.badMat) this.badMat = createRoadMaterial({ ...this.roadU, uGhostColor: { value: BAD.clone() } }, true);
    const pts: { x: number; z: number; kind: number }[] = [];
    for (const [plans, mat] of [[valid, this.roadMat], [invalid, this.badMat]] as [RoadPlan[], THREE.Material][]) {
      if (!plans.length) continue;
      const g = new RoadGeo();
      for (const plan of plans) {
        buildPreview(g, plan.poly, plan.type, this.city.terrain, plan.elevated, false);
        for (const e of plan.events) pts.push({ x: e.x, z: e.z, kind: 2 });
      }
      if (!g.vertexCount) continue;
      const mesh = new THREE.Mesh(toBufferGeometry(g), mat);
      mesh.renderOrder = 4;
      this.group.add(mesh);
      this.gridMeshes.push(mesh);
    }
    this.roadU.uGhostColor.value.copy(OK);
    this.setMarkers(pts.slice(0, 32), true);
  }

  showRoad(plan: RoadPlan): void {
    this.clearRoad();
    const g = new RoadGeo();
    buildPreview(g, plan.poly, plan.type, this.city.terrain, plan.elevated, !!plan.oneway && canBeOneWay(plan.type), plan.raised ? plannedLift(this.city.roads, plan.start, plan.end, plan.poly.length) : undefined);
    if (!g.vertexCount) return;
    this.roadU.uGhostColor.value.copy(plan.valid ? OK : BAD);
    this.roadMesh = new THREE.Mesh(toBufferGeometry(g), this.roadMat);
    this.roadMesh.renderOrder = 4;
    this.group.add(this.roadMesh);
    const pts: { x: number; z: number; kind: number }[] = [
      { x: plan.start.x, z: plan.start.z, kind: plan.start.kind === 'free' ? 0 : 1 },
      { x: plan.end.x, z: plan.end.z, kind: plan.end.kind === 'free' ? 0 : 1 },
      ...plan.events.map((e) => ({ x: e.x, z: e.z, kind: 2 })),
    ];
    this.setMarkers(pts, plan.valid);
  }

  /** Thin ring around a selected moving object (radius in metres; null hides it). */
  setSelectionRing(x: number, z: number, r: number | null): void {
    if (r === null) {
      this.selRing.visible = false;
      return;
    }
    this.selRing.visible = true;
    this.selRing.position.set(x, this.city.terrain.roadHeightAt(x, z) + 0.3, z);
    this.selRing.scale.setScalar(r);
  }

  setMarkers(pts: { x: number; z: number; kind: number }[], valid = true): void {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const n = Math.min(32, pts.length);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      m.makeTranslation(p.x, this.city.terrain.roadHeightAt(p.x, p.z) + 0.35, p.z);
      this.markers.setMatrixAt(i, m);
      if (!valid) c.copy(BAD);
      else if (p.kind === 2) c.setRGB(1, 0.75, 0.25);
      else if (p.kind === 1) c.setRGB(0.3, 0.95, 1);
      else c.setRGB(1, 1, 1);
      this.markers.setColorAt(i, c);
    }
    this.markers.count = n;
    this.markers.instanceMatrix.needsUpdate = true;
    if (this.markers.instanceColor) this.markers.instanceColor.needsUpdate = true;
  }

  showBuilding(typeId: string, frame: LotFrame, valid: boolean): void {
    const st = SERVICE_BY_ID.get(typeId);
    if (!st) return;
    const o = frame.obb;
    const key = `${typeId}|${o.cx.toFixed(1)}|${o.cz.toFixed(1)}|${o.angle.toFixed(3)}`;
    this.bldU.uGhostColor.value.copy(valid ? OK : BAD);
    if (key === this.bldKey) return;
    this.clearBuilding();
    this.bldKey = key;
    const geo = generateBuilding({ style: st.style, w: o.hw * 2, d: o.hd * 2, floors: 2, level: 1, seed: 4242 }, o.cx, o.cz, o.angle, frame.y + 0.05);
    this.bldMesh = new THREE.Mesh(mergeBuilt([{ geo, slot: -1, baseY: frame.y }]), this.bldMat);
    this.bldMesh.renderOrder = 4;
    this.group.add(this.bldMesh);
  }
}
