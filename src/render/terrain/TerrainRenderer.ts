import { beyondDetail } from '../shared';
import * as THREE from 'three';
import { CHUNKS, CHUNK_SIZE, HM_RES, HM_STEP, WORLD_SIZE, ZONE_RES } from '../../sim/constants';
import type { Rect, Terrain } from '../../sim/world/Terrain';
import { LAND_TILES, type Land } from '../../sim/world/Land';
import { type TerrainUniforms, createTerrainMaterial, createTerrainUniforms } from './TerrainMaterial';

const CELLS = CHUNK_SIZE / HM_STEP; // 64 quads per chunk side
const VPS = CELLS + 1; // vertices per side
const SKIRT = 8;
const LOD_STEP = 4;
/** Coarsest level: beyond the full-detail square around the camera's focus. */
const FAR_STEP = 16;

interface Chunk {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  levels: THREE.BufferAttribute[];
  lod: number;
  cx: number;
  cz: number;
}

function buildIndex(step: number): number[] {
  const idx: number[] = [];
  const v = (x: number, z: number) => z * VPS + x;
  for (let z = 0; z < CELLS; z += step) {
    for (let x = 0; x < CELLS; x += step) {
      const a = v(x, z), b = v(x + step, z), c = v(x, z + step), d = v(x + step, z + step);
      idx.push(a, c, b, b, c, d);
    }
  }
  // Skirts: ring of extra vertices after the grid (4 sides × VPS).
  const base = VPS * VPS;
  const sides: [number, number, number, number][] = [];
  for (let i = 0; i < CELLS; i += step) {
    sides.push([v(i, 0), v(i + step, 0), base + i, base + i + step]);
    sides.push([v(CELLS, i), v(CELLS, i + step), base + VPS + i, base + VPS + i + step]);
    sides.push([v(i + step, CELLS), v(i, CELLS), base + 2 * VPS + i + step, base + 2 * VPS + i]);
    sides.push([v(0, i + step), v(0, i), base + 3 * VPS + i + step, base + 3 * VPS + i]);
  }
  for (const [a, b, sa, sb] of sides) idx.push(a, b, sa, b, sb, sa);
  return idx;
}

/** Chunked terrain mesh with two LOD index buffers and a distant outer ring. */
export class TerrainRenderer {
  readonly group = new THREE.Group();
  readonly uniforms: TerrainUniforms;
  readonly material: THREE.MeshStandardMaterial;
  readonly zoneData = new Uint8Array(ZONE_RES * ZONE_RES * 4);
  readonly zonableData = new Uint8Array(ZONE_RES * ZONE_RES);
  readonly zoneTex: THREE.DataTexture;
  readonly zonableTex: THREE.DataTexture;
  readonly overlayTex: THREE.DataTexture;
  readonly overlayData: Uint8Array;
  private soilTex: THREE.DataTexture;
  private soilVersion = -1;
  private soilWait = 0;
  private chunks: Chunk[] = [];
  private outer: THREE.Mesh;

  private landData = new Uint8Array(LAND_TILES * LAND_TILES * 4);
  private landTex: THREE.DataTexture;
  private landVersion = -1;

  /** Shades land the city doesn't own (and marks what it can buy next). */
  syncLand(land: Land): void {
    if (land.version === this.landVersion) return;
    this.landVersion = land.version;
    for (let i = 0; i < LAND_TILES * LAND_TILES; i++) {
      this.landData[i * 4] = land.owned[i] ? 255 : 0;
      this.landData[i * 4 + 1] = land.isBuyable(i) ? 255 : 0;
      this.landData[i * 4 + 3] = 255;
    }
    this.landTex.needsUpdate = true;
    this.uniforms.uLandOn.value = land.allOwned ? 0 : 1;
  }

  constructor(private terrain: Terrain, overlayRes: number) {
    this.zoneTex = new THREE.DataTexture(this.zoneData, ZONE_RES, ZONE_RES, THREE.RGBAFormat);
    this.zoneTex.magFilter = THREE.LinearFilter;
    this.zoneTex.minFilter = THREE.LinearFilter;
    this.zoneTex.colorSpace = THREE.SRGBColorSpace;
    this.zoneTex.needsUpdate = true;
    this.zonableTex = new THREE.DataTexture(this.zonableData, ZONE_RES, ZONE_RES, THREE.RedFormat);
    this.zonableTex.magFilter = THREE.LinearFilter;
    this.zonableTex.minFilter = THREE.LinearFilter;
    this.zonableTex.needsUpdate = true;
    this.overlayData = new Uint8Array(overlayRes * overlayRes * 4);
    this.overlayTex = new THREE.DataTexture(this.overlayData, overlayRes, overlayRes, THREE.RGBAFormat);
    this.overlayTex.magFilter = THREE.LinearFilter;
    this.overlayTex.minFilter = THREE.LinearFilter;
    this.overlayTex.colorSpace = THREE.SRGBColorSpace;
    this.overlayTex.needsUpdate = true;
    this.soilTex = new THREE.DataTexture(terrain.soil, HM_RES, HM_RES, THREE.RedFormat);
    this.soilTex.magFilter = THREE.LinearFilter;
    this.soilTex.minFilter = THREE.LinearFilter;
    this.soilTex.needsUpdate = true;
    this.landTex = new THREE.DataTexture(this.landData, LAND_TILES, LAND_TILES, THREE.RGBAFormat);
    this.landTex.magFilter = THREE.NearestFilter;
    this.landTex.minFilter = THREE.NearestFilter;
    this.landTex.needsUpdate = true;
    this.uniforms = createTerrainUniforms(this.zoneTex, this.zonableTex, this.overlayTex, this.soilTex, this.landTex);
    this.material = createTerrainMaterial(this.uniforms);

    const indices = [buildIndex(1), buildIndex(2), buildIndex(LOD_STEP), buildIndex(FAR_STEP)];
    for (let cz = 0; cz < CHUNKS; cz++) {
      for (let cx = 0; cx < CHUNKS; cx++) {
        const geo = new THREE.BufferGeometry();
        const nv = VPS * VPS + 4 * VPS;
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
        const levels = indices.map((i) => new THREE.Uint32BufferAttribute(i, 1));
        geo.setIndex(levels[0]);
        const mesh = new THREE.Mesh(geo, this.material);
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.matrixAutoUpdate = false;
        const chunk: Chunk = { mesh, geo, levels, lod: 0, cx, cz };
        this.chunks.push(chunk);
        this.fillChunk(chunk);
        this.group.add(mesh);
      }
    }
    this.outer = this.buildOuter();
    this.group.add(this.outer);
  }

  private fillChunk(ch: Chunk): void {
    const pos = ch.geo.getAttribute('position') as THREE.BufferAttribute;
    const nor = ch.geo.getAttribute('normal') as THREE.BufferAttribute;
    const p = pos.array as Float32Array;
    const n = nor.array as Float32Array;
    const H = this.terrain.height;
    const ox = ch.cx * CELLS;
    const oz = ch.cz * CELLS;
    const hAt = (ix: number, iz: number) => {
      const cx = Math.min(HM_RES - 1, Math.max(0, ix));
      const cz = Math.min(HM_RES - 1, Math.max(0, iz));
      return H[cz * HM_RES + cx];
    };
    for (let z = 0; z < VPS; z++) {
      for (let x = 0; x < VPS; x++) {
        const gx = ox + x;
        const gz = oz + z;
        const i = z * VPS + x;
        p[i * 3] = gx * HM_STEP;
        p[i * 3 + 1] = hAt(gx, gz);
        p[i * 3 + 2] = gz * HM_STEP;
        const dx = hAt(gx + 1, gz) - hAt(gx - 1, gz);
        const dz = hAt(gx, gz + 1) - hAt(gx, gz - 1);
        const l = Math.hypot(dx, 2 * HM_STEP, dz);
        n[i * 3] = -dx / l;
        n[i * 3 + 1] = (2 * HM_STEP) / l;
        n[i * 3 + 2] = -dz / l;
      }
    }
    // Skirts hang below the border vertices to hide LOD cracks.
    const base = VPS * VPS;
    const ring: [number, number][] = [];
    for (let i = 0; i < VPS; i++) ring.push([i, 0]);
    for (let i = 0; i < VPS; i++) ring.push([CELLS, i]);
    for (let i = 0; i < VPS; i++) ring.push([i, CELLS]);
    for (let i = 0; i < VPS; i++) ring.push([0, i]);
    ring.forEach(([x, z], k) => {
      const src = z * VPS + x;
      const dst = base + k;
      p[dst * 3] = p[src * 3];
      p[dst * 3 + 1] = p[src * 3 + 1] - SKIRT;
      p[dst * 3 + 2] = p[src * 3 + 2];
      n[dst * 3] = n[src * 3];
      n[dst * 3 + 1] = n[src * 3 + 1];
      n[dst * 3 + 2] = n[src * 3 + 2];
    });
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    ch.geo.computeBoundingSphere();
    ch.geo.computeBoundingBox();
  }

  private buildOuter(): THREE.Mesh {
    const span = WORLD_SIZE * 3;
    const step = 64;
    const n = Math.round(span / step) + 1;
    const geo = new THREE.PlaneGeometry(span, span, n - 1, n - 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(WORLD_SIZE / 2, 0, WORLD_SIZE / 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const inside = x > step && z > step && x < WORLD_SIZE - step && z < WORLD_SIZE - step;
      const h = this.terrain.baseAt(x, z);
      pos.setY(i, inside ? h - 40 : h - 0.3);
    }
    geo.computeVertexNormals();
    const u = { ...this.uniforms };
    const mat = createTerrainMaterial(u, true);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  /** Uploads the bare-soil field when it changed (at most a few times a second). */
  syncSoil(dt: number): void {
    this.soilWait -= dt;
    if (this.terrain.soilVersion === this.soilVersion || this.soilWait > 0) return;
    this.soilVersion = this.terrain.soilVersion;
    this.soilWait = 0.25;
    this.soilTex.needsUpdate = true;
  }

  /** Rebuilds chunks touched by terrain edits. */
  syncDirty(): void {
    const rects = this.terrain.dirtyRects.splice(0);
    if (!rects.length) return;
    const dirty = new Set<number>();
    for (const r of rects) this.chunksIn(r, dirty);
    for (const i of dirty) this.fillChunk(this.chunks[i]);
  }

  private chunksIn(r: Rect, out: Set<number>): void {
    const x0 = Math.max(0, Math.floor((r.minX - HM_STEP) / CHUNK_SIZE));
    const z0 = Math.max(0, Math.floor((r.minZ - HM_STEP) / CHUNK_SIZE));
    const x1 = Math.min(CHUNKS - 1, Math.floor((r.maxX + HM_STEP) / CHUNK_SIZE));
    const z1 = Math.min(CHUNKS - 1, Math.floor((r.maxZ + HM_STEP) / CHUNK_SIZE));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) out.add(z * CHUNKS + x);
  }

  /** Chooses LOD per chunk from camera distance. */
  updateLOD(camPos: THREE.Vector3, focus: { x: number; z: number }): void {
    for (const ch of this.chunks) {
      const cx = (ch.cx + 0.5) * CHUNK_SIZE;
      const cz = (ch.cz + 0.5) * CHUNK_SIZE;
      const d = Math.hypot(camPos.x - cx, camPos.z - cz, camPos.y * 0.6);
      // Hysteresis avoids flicker at band edges.
      const h = ch.lod === 0 ? 40 : -40;
      // Usual detail inside the detail square around the camera's focus; coarse beyond it.
      const want = beyondDetail(cx, cz, CHUNK_SIZE / 2, focus.x, focus.z) ? 3 : d < 620 + h ? 0 : d < 1500 + h ? 1 : 2;
      if (want !== ch.lod) {
        ch.lod = want;
        ch.geo.setIndex(ch.levels[want]);
      }
    }
  }
}
