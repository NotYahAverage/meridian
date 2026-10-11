import * as THREE from 'three';
import { type PolyPoint, pointAt } from '../../core/geom2d';
import type { City } from '../../sim/City';
import { ROAD_TYPES } from '../../sim/roads/RoadTypes';
import type { Route } from '../../sim/traffic/Pathfinder';
import type { AssetLibrary } from '../assets/AssetLibrary';
import { Pool, createAssetMaterial, writeMatrix } from '../assets/AssetMaterials';

const RIBBON_WIDTH = 1.5;
const LIFT = 0.32;

/**
 * Bus stop shelters (always visible) and coloured route ribbons for each bus
 * line (shown in the transit view and while using transit tools).
 */
export class TransitRenderer {
  readonly group = new THREE.Group();
  private shelters: Pool;
  private lines = new THREE.Group();
  private metroLines = new THREE.Group();
  private metroPreview: THREE.Mesh | null = null;
  private metroKey = '';
  private trains: THREE.InstancedMesh;
  private trainPaths: { pts: { x: number; z: number }[]; cum: number[]; len: number; n: number; color: THREE.Color }[] = [];
  private preview: THREE.Mesh | null = null;
  private version = -1;
  private routeKey = '';
  private pp: PolyPoint = { x: 0, z: 0, tx: 0, tz: 0, i: 0 };
  private highlightLine = 0;
  /** Show line ribbons (set each frame from the overlay and active tool). */
  showLines = false;
  /** A transit tool wants the lines visible. */
  toolActive = false;
  /** The transit panel is open. */
  panelOpen = false;

  constructor(private city: City, assets: AssetLibrary) {
    this.shelters = new Pool(assets.get('bus_stop'), createAssetMaterial('shelter'), 64, { shadows: true });
    // Trains in the transit view: bright capsules gliding along the tunnels.
    const tg = new THREE.BoxGeometry(18, 2.2, 3.2);
    this.trains = new THREE.InstancedMesh(tg, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.95, depthWrite: false }), 128);
    this.trains.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(128 * 3), 3);
    this.trains.count = 0;
    this.trains.frustumCulled = false;
    this.trains.renderOrder = 9;
    this.group.add(this.shelters.mesh, this.lines, this.metroLines, this.trains);
    this.lines.visible = false;
    this.metroLines.visible = false;
    this.trains.visible = false;
  }

  update(): void {
    const t = this.city.transit;
    if (t.version !== this.version) {
      this.version = t.version;
      this.writeShelters();
    }
    this.lines.visible = this.showLines;
    this.metroLines.visible = this.showLines;
    this.trains.visible = this.showLines;
    if (this.showLines) {
      const m = t.metro;
      m.refresh();
      let mk = `${m.version}#${this.highlightLine}`;
      for (const l of m.lines.values()) mk += `|${l.id}:${l.problem}`;
      if (mk !== this.metroKey) {
        this.metroKey = mk;
        this.buildMetro();
      }
      this.moveTrains();
    }
    if (this.showLines) {
      t.refreshRoutes();
      const key = [...t.lines.values()].map((l) => `${l.id}:${l.color}:${l.hops.length}:${l.problem}:${l.hops.map((h) => h.legs.length).join(',')}`).join('|') + `#${this.highlightLine}`;
      if (key !== this.routeKey) {
        this.routeKey = key;
        this.buildLines();
      }
    }
  }

  /** Emphasises one line (e.g. hovered in the transit panel); 0 for none. */
  setHighlight(lineId: number): void {
    this.highlightLine = lineId;
  }

  private writeShelters(): void {
    const stops = [...this.city.transit.stops.values()];
    this.shelters.ensure(stops.length + 1);
    const m = this.shelters.matrices;
    let n = 0;
    for (const st of stops) {
      const seg = this.city.roads.segments.get(st.segId);
      if (!seg) continue;
      pointAt(seg.poly, st.s, this.pp);
      // The shelter's open side (+Z in model space) faces the road.
      const theta = Math.atan2(-st.side * this.pp.tz, -st.side * this.pp.tx);
      // On the sidewalk, right behind the curb (outward normal is side * (-tz, tx)).
      const rt = ROAD_TYPES[seg.type];
      const off = rt.asphaltHalf + rt.sidewalk * 0.55;
      const x = this.pp.x - st.side * this.pp.tz * off;
      const z = this.pp.z + st.side * this.pp.tx * off;
      writeMatrix(m, n * 16, x, this.city.terrain.roadHeightAt(x, z) + 0.02, z, theta, 1);
      n++;
    }
    this.shelters.commit(n);
  }

  /** Ribbon following a route, offset to the right of travel. */
  private ribbon(routes: Route[], offset: number, width: number): THREE.BufferGeometry | null {
    const pts: number[] = [];
    const roads = this.city.roads;
    for (const route of routes) {
      for (const leg of route.legs) {
        const seg = roads.segments.get(leg.segId);
        if (!seg) continue;
        const rt = ROAD_TYPES[seg.type];
        const off = Math.min(rt.halfWidth - 1.2, rt.halfWidth * 0.45 + offset);
        const len = Math.abs(leg.s1 - leg.s0);
        const steps = Math.max(1, Math.ceil(len / 4));
        for (let k = 0; k <= steps; k++) {
          const s = leg.s0 + ((leg.s1 - leg.s0) * k) / steps;
          pointAt(seg.poly, s, this.pp);
          const tx = this.pp.tx * leg.dir, tz = this.pp.tz * leg.dir;
          const x = this.pp.x - tz * off;
          const z = this.pp.z + tx * off;
          const n = pts.length;
          if (n >= 3 && Math.abs(pts[n - 3] - x) < 0.3 && Math.abs(pts[n - 1] - z) < 0.3) continue;
          pts.push(x, this.city.terrain.roadHeightAt(x, z) + LIFT, z);
        }
      }
    }
    const count = pts.length / 3;
    if (count < 2) return null;
    const pos = new Float32Array(count * 2 * 3);
    const idx: number[] = [];
    const hw = width / 2;
    for (let i = 0; i < count; i++) {
      const a = Math.max(0, i - 1), b = Math.min(count - 1, i + 1);
      let dx = pts[b * 3] - pts[a * 3];
      let dz = pts[b * 3 + 2] - pts[a * 3 + 2];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
      pos.set([x + dz * hw, y, z - dx * hw, x - dz * hw, y, z + dx * hw], i * 6);
      if (i < count - 1) {
        const o = i * 2;
        idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  private material(color: number, opacity: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
      toneMapped: false,
    });
  }

  private buildLines(): void {
    for (const c of [...this.lines.children]) {
      const m = c as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      this.lines.remove(m);
    }
    let k = 0;
    for (const line of this.city.transit.lines.values()) {
      const hl = this.highlightLine === line.id;
      const g = this.ribbon(line.hops, (k++ % 4) * 0.55, hl ? RIBBON_WIDTH * 1.5 : RIBBON_WIDTH);
      if (!g) continue;
      const dim = this.highlightLine !== 0 && !hl;
      const mesh = new THREE.Mesh(g, this.material(line.problem ? 0x9aa0a6 : line.color, dim ? 0.3 : line.problem ? 0.55 : 0.92));
      mesh.renderOrder = hl ? 7 : 6;
      mesh.frustumCulled = false;
      this.lines.add(mesh);
    }
  }

  /** Straight ribbon through points, draped over the ground (tunnels drawn on the map). */
  private straightRibbon(points: { x: number; z: number }[], width: number, lift: number): THREE.BufferGeometry | null {
    const pts: { x: number; z: number }[] = [];
    for (let k = 0; k + 1 < points.length; k++) {
      const a = points[k], b = points[k + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(len / 8));
      for (let i = k === 0 ? 0 : 1; i <= steps; i++) pts.push({ x: a.x + ((b.x - a.x) * i) / steps, z: a.z + ((b.z - a.z) * i) / steps });
    }
    if (pts.length < 2) return null;
    const pos = new Float32Array(pts.length * 6);
    const idx: number[] = [];
    const hw = width / 2;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const { x, z } = pts[i];
      const y = Math.max(this.city.terrain.heightAt(x, z), this.city.terrain.roadHeightAt(x, z)) + lift;
      pos.set([x + dz * hw, y, z - dx * hw, x - dz * hw, y, z + dx * hw], i * 6);
      if (i < pts.length - 1) {
        const o = i * 2;
        idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  private buildMetro(): void {
    for (const c of [...this.metroLines.children]) {
      const mesh = c as THREE.Mesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      this.metroLines.remove(mesh);
    }
    this.trainPaths = [];
    const m = this.city.transit.metro;
    for (const line of m.lines.values()) {
      const pts = line.stations.map((id) => m.station(id)).filter((b) => !!b).map((b) => ({ x: b!.cx, z: b!.cz }));
      if (pts.length < 2) continue;
      pts.push(pts[0]);
      const hl = this.highlightLine === -line.id;
      const dim = this.highlightLine !== 0 && !hl;
      const color = line.problem ? 0x9aa0a6 : line.color;
      // Dark casing under a coloured core reads as a tunnel on any ground.
      const casing = this.straightRibbon(pts, hl ? 7 : 5.5, 0.55);
      const core = this.straightRibbon(pts, hl ? 4.5 : 3.4, 0.6);
      if (casing) {
        const c = new THREE.Mesh(casing, this.material(0x10161c, dim ? 0.25 : 0.7));
        c.renderOrder = 6;
        c.frustumCulled = false;
        this.metroLines.add(c);
      }
      if (core) {
        const c = new THREE.Mesh(core, this.material(color, dim ? 0.3 : 0.95));
        c.renderOrder = 7;
        c.frustumCulled = false;
        this.metroLines.add(c);
      }
      if (!line.problem) {
        const cum = [0];
        for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z));
        this.trainPaths.push({ pts, cum, len: cum[cum.length - 1], n: line.trains, color: new THREE.Color(line.color).lerp(new THREE.Color(0xffffff), 0.35) });
      }
    }
  }

  private trainMatrix = new THREE.Matrix4();
  private trainQuat = new THREE.Quaternion();
  private trainPos = new THREE.Vector3();
  private trainScale = new THREE.Vector3(1, 1, 1);
  private yAxis = new THREE.Vector3(0, 1, 0);

  /** Places train markers evenly around each loop, advancing with real time. */
  private moveTrains(): void {
    const now = performance.now() / 1000;
    let n = 0;
    for (const p of this.trainPaths) {
      for (let k = 0; k < p.n && n < 128; k++) {
        let s = (now * 45 + (k * p.len) / p.n) % p.len;
        let i = 1;
        while (i < p.cum.length - 1 && p.cum[i] < s) i++;
        const a = p.pts[i - 1], b = p.pts[i];
        const seg = p.cum[i] - p.cum[i - 1] || 1;
        s = (s - p.cum[i - 1]) / seg;
        const x = a.x + (b.x - a.x) * s, z = a.z + (b.z - a.z) * s;
        const y = Math.max(this.city.terrain.heightAt(x, z), this.city.terrain.roadHeightAt(x, z)) + 1.6;
        this.trainQuat.setFromAxisAngle(this.yAxis, -Math.atan2(b.z - a.z, b.x - a.x));
        this.trainMatrix.compose(this.trainPos.set(x, y, z), this.trainQuat, this.trainScale);
        this.trains.setMatrixAt(n, this.trainMatrix);
        this.trains.setColorAt(n, p.color);
        n++;
      }
    }
    this.trains.count = n;
    this.trains.instanceMatrix.needsUpdate = true;
    if (this.trains.instanceColor) this.trains.instanceColor.needsUpdate = true;
  }

  /** Straight preview of a metro line being drawn (null clears it). */
  setMetroPreview(points: { x: number; z: number }[] | null, valid = true): void {
    if (this.metroPreview) {
      this.group.remove(this.metroPreview);
      this.metroPreview.geometry.dispose();
      (this.metroPreview.material as THREE.Material).dispose();
      this.metroPreview = null;
    }
    if (!points || points.length < 2) return;
    const g = this.straightRibbon(points, 4, 0.7);
    if (!g) return;
    this.metroPreview = new THREE.Mesh(g, this.material(valid ? 0xffffff : 0xff5544, 0.85));
    this.metroPreview.renderOrder = 8;
    this.metroPreview.frustumCulled = false;
    this.group.add(this.metroPreview);
  }

  /** Draws the path a line under construction would take (null clears it). */
  setPreview(routes: Route[] | null, valid = true): void {
    if (this.preview) {
      this.group.remove(this.preview);
      this.preview.geometry.dispose();
      (this.preview.material as THREE.Material).dispose();
      this.preview = null;
    }
    if (!routes || !routes.length) return;
    const g = this.ribbon(routes, 0, RIBBON_WIDTH * 1.2);
    if (!g) return;
    this.preview = new THREE.Mesh(g, this.material(valid ? 0xffffff : 0xff5544, 0.85));
    this.preview.renderOrder = 8;
    this.preview.frustumCulled = false;
    this.group.add(this.preview);
  }

  dispose(): void {
    this.setPreview(null);
    this.setMetroPreview(null);
    for (const c of this.metroLines.children) (c as THREE.Mesh).geometry.dispose();
    for (const c of this.lines.children) (c as THREE.Mesh).geometry.dispose();
  }
}
