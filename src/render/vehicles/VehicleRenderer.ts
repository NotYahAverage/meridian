import * as THREE from 'three';
import { MAX_VEHICLES } from '../../sim/constants';
import { Purpose, VEHICLE_LENGTH, VEHICLE_MODELS, type Vehicles } from '../../sim/traffic/Vehicles';
import type { AssetLibrary } from '../assets/AssetLibrary';
import { Pool, createAssetMaterial, writeMatrix } from '../assets/AssetMaterials';
import { globalUniforms, beyondDetail } from '../shared';

const HI_DIST = 700;

/** Draws moving vehicles: detailed models nearby, simple boxes far away, headlight pools at night. */
export class VehicleRenderer {
  readonly group = new THREE.Group();
  private hi: Pool[];
  private lo: Pool;
  private beams: Pool;
  private tmpColor = new THREE.Color();
  private colorCache = new Map<number, THREE.Color>();

  constructor(assets: AssetLibrary) {
    const mat = createAssetMaterial('vehicle', { instanceExtras: true });
    this.hi = VEHICLE_MODELS.map((m) => new Pool(assets.get(m), mat, 256, { colors: true, shadows: true, extras: true }));
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const n = box.getAttribute('position').count;
    box.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(0.85), 3));
    box.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(n), 1));
    this.lo = new Pool(box, createAssetMaterial('vehicle-lo'), 1024, { colors: true });
    // Additive ground light pool in front of cars at night.
    const beamGeo = new THREE.PlaneGeometry(9, 4.2);
    beamGeo.rotateX(-Math.PI / 2);
    beamGeo.translate(6.5, 0.12, 0);
    const beamTex = makeBeamTexture();
    const beamMat = new THREE.MeshBasicMaterial({
      map: beamTex,
      color: 0xfff1d6,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    this.beams = new Pool(beamGeo, beamMat, 512, {});
    for (const p of [...this.hi, this.lo, this.beams]) this.group.add(p.mesh);
  }

  private color(hex: number): THREE.Color {
    let c = this.colorCache.get(hex);
    if (!c) {
      c = new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
      this.colorCache.set(hex, c);
    }
    return c;
  }

  /** Cars outside the detail square around `focus` aren't drawn. */
  update(v: Vehicles, camera: THREE.Camera, focus: { x: number; z: number }): void {
    const counts = new Array(this.hi.length).fill(0);
    let lo = 0;
    let beams = 0;
    for (const p of this.hi) p.ensure(Math.min(MAX_VEHICLES, v.count + 16));
    this.lo.ensure(v.count + 16);
    this.beams.ensure(v.count + 16);
    const cam = camera.position;
    const night = globalUniforms.uNight.value;
    const beamM = this.beams.matrices;
    const loM = this.lo.matrices;
    const loC = this.lo.colors!;
    for (let i = 0; i < v.max; i++) {
      if (!v.active[i]) continue;
      const x = v.x[i], y = v.y[i], z = v.z[i];
      const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (beyondDetail(x, z, 0, focus.x, focus.z)) continue;
      const model = v.model[i];
      const col = this.color(v.color[i]);
      if (d2 < HI_DIST * HI_DIST) {
        const pool = this.hi[model];
        const k = counts[model]++;
        writeMatrix(pool.matrices, k * 16, x, y, z, v.heading[i], 1);
        const c = pool.colors!;
        c[k * 3] = col.r;
        c[k * 3 + 1] = col.g;
        c[k * 3 + 2] = col.b;
        const ex = pool.extraData!;
        ex[k * 2] = v.braking[i] + (v.indicator[i] < 0 ? 2 : v.indicator[i] > 0 ? 4 : 0);
        ex[k * 2 + 1] = v.purpose[i] === Purpose.Service && (model === 6 || model === 7 || model === 8) ? 1 : v.purpose[i] === Purpose.Emergency ? 1 : 0;
        if (night > 0.2 && d2 < 520 * 520) {
          writeMatrix(beamM, beams * 16, x, y, z, v.heading[i], 1);
          beams++;
        }
      } else {
        const len = VEHICLE_LENGTH[model];
        const tall = model >= 3 && model !== 7 ? 2.6 : 1.45;
        writeMatrix(loM, lo * 16, x, y, z, v.heading[i], len, tall, model >= 4 ? 2.4 : 1.8);
        this.tmpColor.copy(col);
        loC[lo * 3] = col.r;
        loC[lo * 3 + 1] = col.g;
        loC[lo * 3 + 2] = col.b;
        lo++;
      }
    }
    for (let k = 0; k < this.hi.length; k++) this.hi[k].commit(counts[k]);
    this.lo.commit(lo);
    this.beams.commit(beams);
    (this.beams.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, night - 0.2) * 0.55;
  }
}

function makeBeamTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(20, 32, 2, 40, 32, 70);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
