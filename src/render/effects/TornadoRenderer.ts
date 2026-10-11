import * as THREE from 'three';
import type { City } from '../../sim/City';
import { GLSL_COMMON, globalUniforms } from '../shared';

const DEBRIS = 90;

/**
 * Tornado visuals: a swirling translucent funnel from the ground to a dark
 * wall cloud, orbiting debris and a ring of dust where it touches down.
 */
export class TornadoRenderer {
  readonly group = new THREE.Group();
  private funnel: THREE.Mesh;
  private cloud: THREE.Mesh;
  private dust: THREE.Mesh;
  private debris: THREE.InstancedMesh;
  private seeds = new Float32Array(DEBRIS * 4);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private fade = 0;
  /** 0–1 loudness at the camera, for the audio. */
  loudness = 0;

  constructor(private city: City) {
    // Funnel profile: narrow near the ground, flaring into the cloud base.
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const y = t * 330;
      const r = 9 + 4 * Math.sin(t * 9) * (1 - t) + Math.pow(t, 2.6) * 120;
      prof.push(new THREE.Vector2(r, y));
    }
    const geo = new THREE.LatheGeometry(prof, 40);
    const funnelMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { ...globalUniforms, uFade: { value: 0 } },
      vertexShader: `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
      fragmentShader: `
varying vec2 vUv;
uniform float uTime;
uniform float uFade;
${GLSL_COMMON}
void main() {
  float a = vUv.x * 6.2831;
  float h = vUv.y;
  // Bands of dust and cloud winding up the funnel.
  vec2 p = vec2(vUv.x * 7.0 + uTime * 1.6 - h * 4.0, h * 6.0 - uTime * 0.9);
  float n = m_fbm(p) * 0.75 + m_vnoise(p * 3.1) * 0.25;
  float alpha = smoothstep(0.2, 0.7, n) * 0.9 + 0.22;
  alpha *= smoothstep(0.0, 0.04, h) * (1.0 - smoothstep(0.82, 1.0, h));
  vec3 col = mix(vec3(0.11, 0.105, 0.1), vec3(0.34, 0.32, 0.3), n);
  col = mix(col, vec3(0.32, 0.27, 0.2), (1.0 - smoothstep(0.0, 0.18, h)) * 0.7);
  gl_FragColor = vec4(col, alpha * uFade);
}`,
    });
    this.funnel = new THREE.Mesh(geo, funnelMat);
    this.funnel.renderOrder = 10;
    this.funnel.frustumCulled = false;

    const cloudGeo = new THREE.SphereGeometry(1, 32, 12);
    cloudGeo.scale(320, 45, 320);
    this.cloud = new THREE.Mesh(cloudGeo, new THREE.MeshBasicMaterial({ color: 0x2a2c30, transparent: true, opacity: 0, depthWrite: false, fog: true }));
    this.cloud.position.y = 345;
    this.cloud.renderOrder = 9;

    const dustTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d')!;
      const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
      g.addColorStop(0, 'rgba(120,100,80,0.0)');
      g.addColorStop(0.35, 'rgba(120,100,80,0.75)');
      g.addColorStop(1, 'rgba(120,100,80,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    })();
    const dustGeo = new THREE.PlaneGeometry(140, 140);
    dustGeo.rotateX(-Math.PI / 2);
    this.dust = new THREE.Mesh(dustGeo, new THREE.MeshBasicMaterial({ map: dustTex, transparent: true, depthWrite: false, opacity: 0 }));
    this.dust.position.y = 1.5;
    this.dust.renderOrder = 8;

    this.debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.3, 0.7), new THREE.MeshLambertMaterial({ color: 0x4a4038 }), DEBRIS);
    this.debris.frustumCulled = false;
    for (let i = 0; i < DEBRIS; i++) {
      this.seeds[i * 4] = 10 + Math.random() * 45; // orbit radius
      this.seeds[i * 4 + 1] = Math.random() * 90; // height
      this.seeds[i * 4 + 2] = Math.random() * Math.PI * 2; // phase
      this.seeds[i * 4 + 3] = 0.6 + Math.random() * 1.6; // size
    }
    this.group.add(this.funnel, this.cloud, this.dust, this.debris);
    this.group.visible = false;
  }

  update(dt: number, camera: THREE.Camera): void {
    const t = this.city.disasters.tornado;
    this.fade = Math.max(0, Math.min(1, this.fade + (t ? dt * 0.5 : -dt * 0.4)));
    this.group.visible = this.fade > 0.01;
    this.loudness = 0;
    if (!this.group.visible) return;
    if (t) this.group.position.set(t.x, this.city.terrain.heightAt(t.x, t.z), t.z);
    const time = globalUniforms.uTime.value;
    (this.funnel.material as THREE.ShaderMaterial).uniforms.uFade.value = this.fade;
    this.funnel.rotation.y = -time * 1.2;
    // Lean with the direction of travel.
    if (t) this.funnel.rotation.z = Math.sin(time * 0.3) * 0.05 + t.dx * 0.06;
    (this.cloud.material as THREE.MeshBasicMaterial).opacity = 0.85 * this.fade;
    this.cloud.rotation.y = -time * 0.15;
    (this.dust.material as THREE.MeshBasicMaterial).opacity = 0.9 * this.fade;
    this.dust.rotation.y = -time * 2.2;
    for (let i = 0; i < DEBRIS; i++) {
      const r = this.seeds[i * 4], h = this.seeds[i * 4 + 1], ph = this.seeds[i * 4 + 2], sz = this.seeds[i * 4 + 3];
      const a = ph - time * (2.4 + 30 / r);
      const y = (h + time * 9 * (0.5 + sz * 0.3)) % 90;
      this.v.set(Math.cos(a) * (r + y * 0.25), y, Math.sin(a) * (r + y * 0.25));
      this.e.set(time * 3 + ph, time * 2 + i, time * 4);
      this.q.setFromEuler(this.e);
      this.m.compose(this.v, this.q, this.s.set(sz, sz, sz));
      this.debris.setMatrixAt(i, this.m);
    }
    this.debris.instanceMatrix.needsUpdate = true;
    this.debris.count = Math.round(DEBRIS * this.fade);
    const d = camera.position.distanceTo(this.v.copy(this.group.position).setY(this.group.position.y + 30));
    this.loudness = this.fade / (1 + (d / 450) ** 2);
  }
}
