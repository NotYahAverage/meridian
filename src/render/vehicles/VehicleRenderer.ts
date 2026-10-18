import * as THREE from 'three';
import { MAX_VEHICLES } from '../../sim/constants';
import { Purpose, VEHICLE_HEIGHT, VEHICLE_LENGTH, VEHICLE_MODELS, VEHICLE_WIDTH, type Vehicles } from '../../sim/traffic/Vehicles';
import type { AssetLibrary } from '../assets/AssetLibrary';
import { Pool, createAssetMaterial, writeMatrix } from '../assets/AssetMaterials';
import { globalUniforms, beyondDetail, view } from '../shared';

const HI_DIST = 700;
const VM_BIKE = VEHICLE_MODELS.indexOf('bike');
/** Wheel radius of each model (for how fast the wheels turn). */
const WHEEL_R = [0.33, 0.32, 0.39, 0.36, 0.5, 0.5, 0.5, 0.34, 0.38, 0.5, 0.4, 0.33, 0.4, 0.29, 0.34];

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
    this.hi = VEHICLE_MODELS.map((m) => new Pool(assets.get(m), mat, 256, { colors: true, shadows: true, extras: 4 }));
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

  // Per vehicle slot: wheel angle, smoothed pitch and roll, and last speed and heading (for acceleration and turning).
  private spin = new Float32Array(0);
  private pitch = new Float32Array(0);
  private roll = new Float32Array(0);
  private lastV = new Float32Array(0);
  private lastH = new Float32Array(0);
  private lastSerial = new Uint32Array(0);

  /** Wheels turn, bodies dip under braking and lean in turns (smoothed, as if on springs). */
  private motion(v: Vehicles, dt: number): void {
    if (this.spin.length !== v.max) {
      this.spin = new Float32Array(v.max);
      this.pitch = new Float32Array(v.max);
      this.roll = new Float32Array(v.max);
      this.lastV = new Float32Array(v.max);
      this.lastH = new Float32Array(v.max);
      this.lastSerial = new Uint32Array(v.max);
    }
    if (dt <= 0) return;
    const k = Math.min(1, dt * 5);
    for (let i = 0; i < v.max; i++) {
      if (!v.active[i]) continue;
      const sp = v.speed[i];
      if (this.lastSerial[i] !== v.serial[i]) {
        this.lastSerial[i] = v.serial[i];
        this.lastV[i] = sp;
        this.lastH[i] = v.heading[i];
        this.pitch[i] = this.roll[i] = 0;
      }
      const acc = (sp - this.lastV[i]) / dt;
      let dh = v.heading[i] - this.lastH[i];
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      const lat = sp * (dh / dt);
      this.lastV[i] = sp;
      this.lastH[i] = v.heading[i];
      this.spin[i] = (this.spin[i] + (sp * dt) / WHEEL_R[v.model[i]]) % (Math.PI * 2);
      // Nose down under braking, up a touch when pulling away; lean out of the turn.
      const tp = Math.max(-0.035, Math.min(0.02, acc * 0.0065));
      const tr = Math.max(-0.04, Math.min(0.04, -lat * 0.009));
      this.pitch[i] += (tp - this.pitch[i]) * k;
      this.roll[i] += (tr - this.roll[i]) * k;
    }
  }

  /** Cars outside the detail square around `focus` aren't drawn. */
  update(v: Vehicles, camera: THREE.Camera, focus: { x: number; z: number }, dt = 0): void {
    this.motion(v, dt);
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
      // Off screen (behind or beside the camera): not drawn, so not written either.
      if (!view.sees(x, y, z, 8)) continue;
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
        const flash = v.purpose[i] === Purpose.Service && (model === 6 || model === 7 || model === 8) ? 1 : v.purpose[i] === Purpose.Emergency ? 1 : 0;
        ex[k * 4] = v.braking[i] + (v.indicator[i] < 0 ? 2 : v.indicator[i] > 0 ? 4 : 0);
        // Flashing lights, and how far a parked car has faded (in fiftieths).
        ex[k * 4 + 1] = flash + 2 * Math.round((1 - v.fade[i]) * 50);
        ex[k * 4 + 2] = this.spin[i];
        ex[k * 4 + 3] = Math.round(this.pitch[i] * 1000 + 100) * 256 + Math.round(this.roll[i] * 1000 + 100);
        if (night > 0.2 && d2 < 520 * 520 && model !== VM_BIKE) {
          writeMatrix(beamM, beams * 16, x, y, z, v.heading[i], 1);
          beams++;
        }
      } else {
        if (v.fade[i] < 0.5) continue;
        writeMatrix(loM, lo * 16, x, y, z, v.heading[i], VEHICLE_LENGTH[model], VEHICLE_HEIGHT[model], VEHICLE_WIDTH[model]);
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
