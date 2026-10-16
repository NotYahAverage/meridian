import * as THREE from 'three';
import { type PolyPoint, pointAt } from '../../core/geom2d';
import type { City } from '../../sim/City';
import { ROAD_TYPES } from '../../sim/roads/RoadTypes';
import { WalkLight } from '../../sim/traffic/Signals';
import { WalkEdge } from '../../sim/walk/WalkNetwork';
import { CURB_H, ROAD_LIFT } from '../roads/RoadMeshBuilder';

const COL = {
  sidewalk: [0.35, 0.95, 1.0],
  informal: [0.42, 0.62, 0.66],
  zebra: [1, 1, 1],
  walk: [0.25, 1, 0.45],
  flashing: [1, 0.62, 0.12],
  dontWalk: [1, 0.22, 0.16],
  barrier: [0.95, 0.2, 0.18],
};
const WIDTH = { path: 0.55, crossing: 1.1, barrier: 0.9 };

/**
 * The Walking overlay's 3D layer: every sidewalk, corner and crossing as a
 * thin glowing ribbon (signal crossings show their live walk light), and the
 * edges of roads without sidewalks, which people can't walk along or across, in red.
 */
export class WalkOverlay {
  readonly mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private builtVersion = -1;
  /** Vertex ranges of signalled crossings (recoloured with their lights). */
  private signals: { node: number; seg: number; start: number; count: number }[] = [];
  private colors: Float32Array = new Float32Array(0);
  private timer = 0;
  private blink = 0;

  constructor(private city: City) {
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    });
    // Ribbons keep a readable width on screen however far the camera is.
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec3 aSide;
attribute float aWidth;`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vec4 wc = modelMatrix * vec4(transformed, 1.0);
transformed += aSide * 0.5 * aWidth * max(1.0, distance(wc.xyz, cameraPosition) * 0.0095);`,
        );
    };
    mat.customProgramCacheKey = () => 'walk-ribbon';
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  set visible(on: boolean) {
    this.mesh.visible = on;
    if (on) this.builtVersion = -1;
  }

  get visible(): boolean {
    return this.mesh.visible;
  }

  update(dt: number): void {
    if (!this.mesh.visible) return;
    const walk = this.city.walk;
    walk.ensure();
    if (walk.version !== this.builtVersion) this.build();
    this.blink = (this.blink + dt) % 1;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.2;
    const sig = this.city.signals;
    const c = this.colors;
    for (const r of this.signals) {
      const light = sig.walkLight(r.node, r.seg);
      const col = light === WalkLight.Walk ? COL.walk : light === WalkLight.Flashing ? (this.blink < 0.55 ? COL.flashing : COL.dontWalk) : COL.dontWalk;
      for (let k = r.start; k < r.start + r.count; k++) c.set(col, k * 3);
    }
    (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  private build(): void {
    const city = this.city;
    const walk = city.walk;
    this.builtVersion = walk.version;
    const pos: number[] = [];
    const side: number[] = [];
    const width: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    this.signals = [];
    const terrain = city.terrain;
    const ribbon = (pts: number[], w: number, lift: number, c: number[]) => {
      const n = pts.length / 2;
      if (n < 2) return;
      const base = pos.length / 3;
      for (let i = 0; i < n; i++) {
        const x = pts[i * 2], z = pts[i * 2 + 1];
        const pi = Math.max(0, i - 1), ni = Math.min(n - 1, i + 1);
        let tx = pts[ni * 2] - pts[pi * 2], tz = pts[ni * 2 + 1] - pts[pi * 2 + 1];
        const l = Math.hypot(tx, tz) || 1;
        tx /= l;
        tz /= l;
        const y = terrain.roadHeightAt(x, z) + ROAD_LIFT + lift;
        pos.push(x, y, z, x, y, z);
        side.push(-tz, 0, tx, tz, 0, -tx);
        width.push(w, w);
        col.push(...c, ...c);
      }
      for (let i = 0; i < n - 1; i++) {
        const a = base + i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    };
    for (let e = 0; e < walk.edgeCount; e++) {
      const k = walk.kind[e] as WalkEdge;
      const pts = walk.edgePolyline(e, 10);
      if (k === WalkEdge.Signal) {
        const start = pos.length / 3;
        ribbon(pts, WIDTH.crossing, 0.07, COL.dontWalk);
        this.signals.push({ node: walk.node[e], seg: walk.seg[e], start, count: pos.length / 3 - start });
      } else if (k === WalkEdge.Zebra) {
        ribbon(pts, WIDTH.crossing, 0.07, COL.zebra);
      } else if (k === WalkEdge.Informal) {
        ribbon(pts, WIDTH.path * 0.7, 0.07, COL.informal);
      } else {
        ribbon(pts, WIDTH.path, CURB_H + 0.06, COL.sidewalk);
      }
    }
    // Barriers: both edges of every ground-level road without sidewalks.
    for (const seg of city.roads.segments.values()) {
      const rt = ROAD_TYPES[seg.type];
      if (rt.sidewalk > 0 || seg.raised) continue;
      const s0 = seg.trimA, s1 = seg.length - seg.trimB;
      if (s1 - s0 < 1) continue;
      for (const sd of [1, -1]) {
        const pts: number[] = [];
        const n = Math.max(1, Math.ceil((s1 - s0) / 10));
        const u = (rt.halfWidth - 0.6) * sd;
        const p: PolyPoint = { x: 0, z: 0, tx: 0, tz: 0, i: 0 };
        for (let i = 0; i <= n; i++) {
          pointAt(seg.poly, s0 + ((s1 - s0) * i) / n, p);
          pts.push(p.x - p.tz * u, p.z + p.tx * u);
        }
        ribbon(pts, WIDTH.barrier, 0.1, COL.barrier);
      }
    }
    this.geo.dispose();
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.geo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 3));
    this.geo.setAttribute('aWidth', new THREE.Float32BufferAttribute(width, 1));
    this.colors = new Float32Array(col);
    const ca = new THREE.BufferAttribute(this.colors, 3);
    ca.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('color', ca);
    this.geo.setIndex(idx);
    this.mesh.geometry = this.geo;
    this.timer = 0;
  }
}

