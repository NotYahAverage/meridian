import * as THREE from 'three';
import { globalUniforms } from '../shared';

const RAIN = 9000;
const SNOW = 7000;
/** Size of the box of particles that follows the camera (m). */
const BOX = new THREE.Vector3(150, 90, 150);

/**
 * Rain streaks and snowflakes animated entirely on the GPU. Particles live in
 * a box that wraps around the camera, so a fixed buffer covers any view.
 */
export class Precipitation {
  readonly group = new THREE.Group();
  private rain: THREE.LineSegments;
  private snow: THREE.Points;
  private uniforms = {
    uTime: globalUniforms.uTime,
    uCenter: { value: new THREE.Vector3() },
    uBox: { value: BOX.clone() },
    uAmount: { value: 0 },
    uWind: { value: new THREE.Vector2(2, 1) },
    uNight: globalUniforms.uNight,
    uScale: { value: 600 },
  };
  private snowUniforms = { ...this.uniforms, uAmount: { value: 0 } };

  constructor() {
    // Rain: two vertices per streak sharing a random seed; `aEnd` marks the tail.
    const seeds = new Float32Array(RAIN * 2 * 4);
    const ends = new Float32Array(RAIN * 2);
    for (let i = 0; i < RAIN; i++) {
      const s = [Math.random(), Math.random(), Math.random(), Math.random()];
      seeds.set(s, i * 8);
      seeds.set(s, i * 8 + 4);
      ends[i * 2 + 1] = 1;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN * 2 * 3), 3));
    rg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    const rm = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        attribute float aEnd;
        uniform float uTime;
        uniform vec3 uCenter;
        uniform vec3 uBox;
        uniform float uAmount;
        uniform vec2 uWind;
        varying float vA;
        void main() {
          float speed = 26.0 + aSeed.w * 8.0;
          vec3 vel = vec3(uWind.x, -speed, uWind.y);
          vec3 p = aSeed.xyz * uBox;
          p += vel * uTime;
          p = mod(p - (uCenter - uBox * 0.5), uBox) + (uCenter - uBox * 0.5);
          // Streak tail trails behind the drop along its velocity.
          p -= vel * aEnd * 0.045;
          vA = step(aSeed.w, uAmount) * (1.0 - aEnd * 0.85);
          // Fade near the box edges so wrapping is invisible.
          vec3 q = abs(p - uCenter) / (uBox * 0.5);
          vA *= 1.0 - smoothstep(0.7, 1.0, max(q.x, q.z));
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        uniform float uNight;
        void main() {
          if (vA <= 0.001) discard;
          gl_FragColor = vec4(mix(vec3(0.72, 0.76, 0.82), vec3(0.32, 0.36, 0.45), uNight), vA * 0.42);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.rain = new THREE.LineSegments(rg, rm);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 9;

    const sseeds = new Float32Array(SNOW * 4);
    for (let i = 0; i < SNOW * 4; i++) sseeds[i] = Math.random();
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SNOW * 3), 3));
    sg.setAttribute('aSeed', new THREE.BufferAttribute(sseeds, 4));
    const sm = new THREE.ShaderMaterial({
      uniforms: this.snowUniforms,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform vec3 uCenter;
        uniform vec3 uBox;
        uniform float uAmount;
        uniform vec2 uWind;
        uniform float uScale;
        varying float vA;
        void main() {
          float fall = 1.2 + aSeed.w * 0.9;
          vec3 p = aSeed.xyz * uBox;
          p += vec3(uWind.x * 0.35, -fall, uWind.y * 0.35) * uTime;
          // Flakes tumble as they fall.
          p.x += sin(uTime * (0.8 + aSeed.y) + aSeed.z * 30.0) * 0.8;
          p.z += cos(uTime * (0.7 + aSeed.x) + aSeed.y * 30.0) * 0.8;
          p = mod(p - (uCenter - uBox * 0.5), uBox) + (uCenter - uBox * 0.5);
          vA = step(aSeed.w, uAmount);
          vec3 q = abs(p - uCenter) / (uBox * 0.5);
          vA *= 1.0 - smoothstep(0.7, 1.0, max(q.x, q.z));
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (0.09 + aSeed.x * 0.08) * uScale / max(1.0, -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        uniform float uNight;
        void main() {
          vec2 c = gl_PointCoord * 2.0 - 1.0;
          float r = dot(c, c);
          if (r > 1.0 || vA <= 0.001) discard;
          gl_FragColor = vec4(mix(vec3(0.97), vec3(0.6, 0.64, 0.72), uNight), vA * (1.0 - r) * 0.9);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.snow = new THREE.Points(sg, sm);
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 9;
    this.group.add(this.rain, this.snow);
  }

  /**
   * Places the particle box around the camera. Precipitation fades out when the
   * camera is high above the city (it would only read as noise).
   */
  update(camera: THREE.PerspectiveCamera, viewportH: number, rain: number, snow: number, wind: number): void {
    const fade = 1 - THREE.MathUtils.smoothstep(camera.position.y, 260, 900);
    const center = this.uniforms.uCenter.value;
    camera.getWorldDirection(center);
    center.multiplyScalar(45).add(camera.position);
    this.uniforms.uAmount.value = Math.min(1, rain) * fade;
    this.snowUniforms.uAmount.value = Math.min(1, snow) * fade;
    this.uniforms.uWind.value.set(1.5 + wind * 7, 0.8 + wind * 3);
    this.uniforms.uScale.value = viewportH / (2 * Math.tan((camera.fov * Math.PI) / 360));
    this.rain.visible = this.uniforms.uAmount.value > 0.005;
    this.snow.visible = this.snowUniforms.uAmount.value > 0.005;
  }
}
