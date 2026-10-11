import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { clamp, lerp, smoothstep } from '../core/math';
import { globalUniforms } from './shared';

const DAY_FOG = new THREE.Color(0.62, 0.7, 0.8);
const DUSK_FOG = new THREE.Color(0.78, 0.56, 0.42);
const NIGHT_FOG = new THREE.Color(0.035, 0.045, 0.075);
const GREY_FOG = new THREE.Color(0.58, 0.6, 0.63);

/**
 * Sky, sun/moon lighting, fog and the day–night cycle. The environment map is
 * regenerated from the sky only when the sun has moved noticeably.
 */
export class Environment {
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xbfd6ff, 0x5a5442, 0.9);
  private sky = new Sky();
  private skyScene = new THREE.Scene();
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private lastEnvSun = new THREE.Vector3(0, -1, 0);
  private lastEnvCloud = 0;
  private stars: THREE.Points;
  readonly sunDir = new THREE.Vector3();
  readonly fog: THREE.Fog;
  night = 0;
  hour = 9;
  /** Weather inputs (smoothed by the world renderer). */
  cloud = 0;
  fogAmount = 0;
  precip = 0;
  /** Lightning flash brightness (decays quickly). */
  flash = 0;
  /** Fireworks light the city in the colour of the latest burst. */
  fireGlow = 0;
  readonly fireColor = new THREE.Color();
  private target = new THREE.Vector3();

  constructor(private scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.sky.scale.setScalar(20000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 3.2;
    u.rayleigh.value = 1.35;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    scene.add(this.sky);
    this.skyScene.add(this.sky.clone());

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.35;
    const cam = this.sun.shadow.camera;
    cam.near = 10;
    cam.far = 6000;
    scene.add(this.sun);
    scene.add(this.sun.target);
    scene.add(this.hemi);

    this.fog = new THREE.Fog(DAY_FOG.getHex(), 1500, 9000);
    scene.fog = this.fog;

    // Stars for clear nights.
    const n = 2500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const y = Math.random() * 0.95 + 0.05;
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(th) * r * 9000;
      pos[i * 3 + 1] = y * 9000;
      pos[i * 3 + 2] = Math.sin(th) * r * 9000;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }),
    );
    this.stars.renderOrder = -1;
    scene.add(this.stars);
  }

  setShadowSize(size: number): void {
    if (this.sun.shadow.mapSize.x === size) return;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
  }

  /** Sun direction for an hour of the day (0–24). */
  static sunDirection(hour: number, out: THREE.Vector3): THREE.Vector3 {
    // Rises in the east (+x), passes the south (+z) at noon, sets in the west.
    const t = ((hour - 6) / 12) * Math.PI;
    const elev = Math.sin(t) * 0.92;
    const h = Math.cos(Math.asin(clamp(elev, -1, 1)));
    out.set(Math.cos(t) * h, elev, (Math.sin(t) * 0.75 + 0.3) * h);
    return out.normalize();
  }

  /** Updates lighting for the hour and keeps the shadow frustum around the camera target. */
  update(hour: number, camTarget: THREE.Vector3, camDistance: number, camera: THREE.Camera): void {
    this.hour = hour;
    Environment.sunDirection(hour, this.sunDir);
    const elev = this.sunDir.y;
    // Long twilight so evenings stay readable before full night.
    const day = smoothstep(-0.22, 0.2, elev);
    this.night = 1 - day;
    const dusk = smoothstep(0.38, 0.02, elev) * smoothstep(-0.24, 0.02, elev);

    const u = this.sky.material.uniforms;
    const skySun = this.sunDir.clone();
    if (skySun.y < -0.05) skySun.y = -0.05;
    u.sunPosition.value.copy(skySun);
    const cloud = this.cloud;
    u.rayleigh.value = lerp(lerp(0.6, 1.4, day), 0.35, cloud * 0.8);
    u.turbidity.value = lerp(lerp(8, 3.2, day), 14, cloud);

    // Sun at day, moon at night (light always from above).
    const lightDir = this.sunDir.clone();
    if (lightDir.y < 0.12) {
      const moon = new THREE.Vector3(-this.sunDir.x, Math.max(0.35, -this.sunDir.y), -this.sunDir.z).normalize();
      lightDir.lerpVectors(lightDir, moon, smoothstep(0.12, -0.05, this.sunDir.y)).normalize();
    }
    const sunCol = new THREE.Color(1, 0.96, 0.9).lerp(new THREE.Color(1, 0.62, 0.35), dusk);
    const moonCol = new THREE.Color(0.55, 0.65, 1.0);
    this.sun.color.copy(sunCol).lerp(moonCol, this.night);
    // Overcast skies swap direct sun for soft, grey skylight.
    // Broken cloud leaves the sun out between drifting shadows; only a real overcast dims it.
    this.sun.intensity = lerp(0.35, 2.35, day) * (1 - dusk * 0.3) * (1 - 0.72 * smoothstep(0.3, 0.95, cloud)) + this.flash * 3;
    this.hemi.intensity = lerp(0.32, 0.55, day) * (1 + 0.55 * cloud) + this.flash * 2.5;
    this.hemi.color.setRGB(lerp(0.32, 0.8, day), lerp(0.4, 0.86, day), lerp(0.7, 0.95, day));
    this.hemi.color.lerp(new THREE.Color(0.62, 0.64, 0.68).multiplyScalar(lerp(0.45, 1, day)), cloud * 0.7);
    if (this.flash > 0) this.hemi.color.lerp(new THREE.Color(0.85, 0.88, 1), Math.min(1, this.flash));
    if (this.fireGlow > 0) {
      this.hemi.intensity += Math.min(0.4, this.fireGlow * 0.3) * this.night;
      this.hemi.color.lerp(this.fireColor, Math.min(0.45, this.fireGlow * 0.35) * this.night);
    }
    this.hemi.groundColor.setRGB(lerp(0.08, 0.36, day), lerp(0.08, 0.33, day), lerp(0.1, 0.26, day));

    const fogCol = DAY_FOG.clone().lerp(DUSK_FOG, dusk * (1 - cloud)).lerp(GREY_FOG.clone().multiplyScalar(lerp(0.25, 1, day)), cloud * 0.8).lerp(NIGHT_FOG, this.night);
    this.fog.color.copy(fogCol);
    // Fog and heavy rain pull the fog in close.
    const murk = Math.max(this.fogAmount, this.precip * 0.6);
    this.fog.near = lerp(Math.max(600, camDistance * 1.6), Math.max(40, camDistance * 0.15), murk);
    this.fog.far = lerp(Math.max(4500, camDistance * 5.5 + 2500), Math.max(700, camDistance * 2.2 + 300), murk);
    (this.stars.material as THREE.PointsMaterial).opacity = smoothstep(0.55, 1, this.night) * 0.85 * (1 - cloud);
    this.stars.position.copy(camera.position);

    // Shadow frustum: snapped to texels to avoid shimmering.
    const half = clamp(camDistance * 0.95, 90, 1100);
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    if (cam.right !== half) {
      cam.left = -half;
      cam.right = half;
      cam.top = half;
      cam.bottom = -half;
      cam.updateProjectionMatrix();
    }
    const texel = (half * 2) / this.sun.shadow.mapSize.x;
    this.target.set(Math.round(camTarget.x / texel) * texel, camTarget.y, Math.round(camTarget.z / texel) * texel);
    this.sun.target.position.copy(this.target);
    this.sun.position.copy(this.target).addScaledVector(lightDir, 2500);
    this.sun.target.updateMatrixWorld();

    globalUniforms.uNight.value = this.night;
    globalUniforms.uHour.value = hour;
  }

  /** Regenerates the image-based lighting when the sun moved enough. */
  updateEnvironmentMap(force = false): void {
    const cloudChanged = Math.abs(this.cloud - this.lastEnvCloud) > 0.08;
    if (!force && !cloudChanged && this.sunDir.angleTo(this.lastEnvSun) < 0.06) return;
    this.lastEnvSun.copy(this.sunDir);
    this.lastEnvCloud = this.cloud;
    const skyCopy = this.skyScene.children[0] as Sky;
    skyCopy.material.uniforms.sunPosition.value.copy(this.sky.material.uniforms.sunPosition.value);
    skyCopy.material.uniforms.rayleigh.value = this.sky.material.uniforms.rayleigh.value;
    skyCopy.material.uniforms.turbidity.value = this.sky.material.uniforms.turbidity.value;
    const rt = this.pmrem.fromScene(this.skyScene, 0, 1, 30000);
    this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    // The physical sky is HDR; scale its image-based light down to sit under the sun.
    this.scene.environmentIntensity = lerp(0.05, 0.11, 1 - this.night);
  }
}
