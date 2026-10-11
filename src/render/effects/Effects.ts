import * as THREE from 'three';
import type { City } from '../../sim/City';
import { BuildingState } from '../../sim/types';
import { globalUniforms } from '../shared';

const MAX = 6000;

/**
 * CPU particle system for smoke, steam, fire, fountains and dust bursts,
 * rendered as soft camera-facing sprites in a single draw call.
 */
export class Effects {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 4);
  private size = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private kind = new Uint8Array(MAX);
  private next = 0;
  private emitAcc = new Map<string, number>();
  private geo: THREE.BufferGeometry;

  constructor(private city: City) {
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uNight: globalUniforms.uNight },
      vertexShader: /* glsl */ `
        attribute vec4 aColor;
        attribute float aSize;
        uniform float uScale;
        varying vec4 vColor;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(1.0, -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        varying vec4 vColor;
        uniform float uNight;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r = dot(p, p);
          if (r > 1.0) discard;
          float a = (1.0 - r) * (1.0 - r);
          vec3 c = vColor.rgb;
          gl_FragColor = vec4(c, vColor.a * a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  private spawn(kind: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, r: number, g: number, b: number, a: number): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.kind[i] = kind;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.col[i * 4] = r;
    this.col[i * 4 + 1] = g;
    this.col[i * 4 + 2] = b;
    this.col[i * 4 + 3] = a;
  }

  /** Dust cloud for construction starts and demolitions. */
  burst(x: number, y: number, z: number, radius: number, n = 26, dark = false): void {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      const c = dark ? 0.32 : 0.62 + Math.random() * 0.1;
      this.spawn(2, x + Math.cos(a) * r, y + Math.random() * 2, z + Math.sin(a) * r, Math.cos(a) * 2, 1.5 + Math.random() * 2, Math.sin(a) * 2, 5 + Math.random() * 7, 1.6 + Math.random(), c, c * 0.95, c * 0.86, 0.55);
    }
  }

  private emitter(key: string, rate: number, dt: number, fn: () => void): void {
    let acc = (this.emitAcc.get(key) ?? Math.random()) + rate * dt;
    while (acc >= 1) {
      fn();
      acc -= 1;
    }
    this.emitAcc.set(key, acc);
  }

  update(dt: number, emitters: { x: number; y: number; z: number; kind: 'smoke' | 'steam' | 'fountain'; scale: number }[], camPos: THREE.Vector3, viewportH: number, fovDeg: number, simRunning: boolean): void {
    const mat = this.points.material as THREE.ShaderMaterial;
    mat.uniforms.uScale.value = viewportH / (2 * Math.tan((fovDeg * Math.PI) / 360));
    const wind = 2.2;
    if (simRunning) {
      for (const e of emitters) {
        const key = `${e.kind}${Math.round(e.x)}:${Math.round(e.z)}`;
        if (e.kind === 'smoke') {
          this.emitter(key, 7 * e.scale, dt, () =>
            this.spawn(0, e.x + (Math.random() - 0.5), e.y, e.z + (Math.random() - 0.5), wind * 0.3, 3.2 + Math.random(), wind * 0.15, 4 * e.scale, 7 + Math.random() * 3, 0.42, 0.41, 0.4, 0.38),
          );
        } else if (e.kind === 'steam') {
          this.emitter(key, 6 * e.scale, dt, () =>
            this.spawn(1, e.x + (Math.random() - 0.5) * 8 * e.scale * 0.4, e.y, e.z + (Math.random() - 0.5) * 8 * e.scale * 0.4, wind * 0.4, 4 + Math.random() * 2, wind * 0.2, 9 * e.scale, 6 + Math.random() * 3, 0.95, 0.95, 0.96, 0.42),
          );
        } else if (Math.hypot(e.x - camPos.x, e.z - camPos.z) < 600) {
          this.emitter(key, 30, dt, () => {
            const a = Math.random() * Math.PI * 2;
            this.spawn(3, e.x, e.y, e.z, Math.cos(a) * 1.2, 4 + Math.random() * 1.5, Math.sin(a) * 1.2, 0.5, 1.2, 0.85, 0.92, 1.0, 0.7);
          });
        }
      }
      // Burning buildings: flames and thick smoke.
      for (const b of this.city.buildings.all.values()) {
        if (b.state !== BuildingState.Burning) continue;
        const key = `fire${b.id}`;
        this.emitter(key, 40, dt, () => {
          const x = b.cx + (Math.random() - 0.5) * b.hw * 1.2;
          const z = b.cz + (Math.random() - 0.5) * b.hd * 1.2;
          if (Math.random() < 0.55) this.spawn(4, x, b.y + 2 + Math.random() * 6, z, 0, 5 + Math.random() * 3, 0, 4 + Math.random() * 3, 0.9 + Math.random() * 0.5, 2.6, 1.0, 0.25, 0.9);
          else this.spawn(0, x, b.y + 8 + Math.random() * 6, z, wind * 0.4, 5, wind * 0.2, 9, 8, 0.16, 0.15, 0.14, 0.6);
        });
      }
    }
    const step = simRunning ? dt : 0;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) {
        this.col[i * 4 + 3] = 0;
        continue;
      }
      this.life[i] -= step;
      const t = 1 - this.life[i] / this.maxLife[i];
      const k = this.kind[i];
      this.pos[i * 3] += this.vel[i * 3] * step;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * step;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * step;
      if (k === 3) this.vel[i * 3 + 1] -= 9.8 * step;
      else this.vel[i * 3 + 1] *= 1 - 0.25 * step;
      if (k === 0 || k === 1) this.size[i] += step * (k === 1 ? 3.2 : 1.6);
      if (k === 2) this.size[i] += step * 3;
      const fade = k === 4 ? 1 - t : Math.min(1, t * 6) * (1 - t);
      const base = k === 4 ? 0.9 : k === 1 ? 0.42 : k === 3 ? 0.7 : k === 2 ? 0.55 : 0.4;
      this.col[i * 4 + 3] = base * fade;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
  }
}
