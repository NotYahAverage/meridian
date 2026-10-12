import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { clamp, lerp, smoothstep } from '../core/math';
import { globalUniforms } from './shared';

const DAY_FOG = new THREE.Color(0.6, 0.69, 0.82);
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
  private skyExposure = { value: 0.6 };
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
  /** Wind (0–1) moves the sky's clouds along. */
  windDrift = 0.3;
  /** Fireworks light the city in the colour of the latest burst. */
  fireGlow = 0;
  readonly fireColor = new THREE.Color();
  private target = new THREE.Vector3();

  constructor(private scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.sky.scale.setScalar(20000);
    // The physical sky is very bright; an exposure on its output keeps the blue
    // from washing out to white once tone mapped (the env map follows it).
    this.sky.material.uniforms.uSkyExposure = this.skyExposure;
    this.sky.material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader
        .replace('uniform float time;', 'uniform float time;\nuniform float uSkyExposure;')
        .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * uSkyExposure, 1.0 );');
    };
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
    // Soft penumbra (Vogel-disk PCF).
    this.sun.shadow.radius = 2.2;
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
    // The sun peaks a little under 50° so walls keep their modelling all day.
    const elev = Math.sin(t) * 0.76;
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
    // A deeper blue overhead on clear days; haze and grey as cloud builds.
    u.rayleigh.value = lerp(lerp(0.6, 1.7, day), 0.35, cloud * 0.8);
    u.turbidity.value = lerp(lerp(8, 2.6, day), 14, cloud);
    this.skyExposure.value = lerp(lerp(0.85, 0.58, day), 0.8, cloud * 0.6);
    u.mieCoefficient.value = lerp(0.0032, 0.006, cloud);
    // The sky's own clouds: scattered fair-weather cumulus on clear days, closing in with the weather.
    u.cloudCoverage.value = clamp(0.32 + cloud * 0.62, 0, 0.95);
    u.cloudDensity.value = lerp(0.45, 0.9, cloud);
    u.cloudElevation.value = 0.62;
    u.cloudScale.value = 0.00026;
    u.time.value = globalUniforms.uTime.value * (8 + this.windDrift * 30);

    // Sun at day, moon at night (light always from above).
    const lightDir = this.sunDir.clone();
    if (lightDir.y < 0.12) {
      const moon = new THREE.Vector3(-this.sunDir.x, Math.max(0.35, -this.sunDir.y), -this.sunDir.z).normalize();
      lightDir.lerpVectors(lightDir, moon, smoothstep(0.12, -0.05, this.sunDir.y)).normalize();
    }
    // A warm key light against a cool, weaker sky fill gives buildings their form.
    const sunCol = new THREE.Color(1, 0.93, 0.83).lerp(new THREE.Color(1, 0.58, 0.3), dusk);
    const moonCol = new THREE.Color(0.5, 0.62, 1.0);
    this.sun.color.copy(sunCol).lerp(moonCol, this.night);
    // Overcast skies swap direct sun for soft, grey skylight.
    // Broken cloud leaves the sun out between drifting shadows; only a real overcast dims it.
    const overcast = smoothstep(0.3, 0.95, cloud);
    this.sun.intensity = lerp(0.3, 3.1, day) * (1 - dusk * 0.25) * (1 - 0.78 * overcast) + this.flash * 3;
    this.hemi.intensity = lerp(0.26, 0.36, day) * (1 + 1.1 * overcast) + this.flash * 2.5;
    this.hemi.color.setRGB(lerp(0.3, 0.66, day), lerp(0.38, 0.78, day), lerp(0.72, 1.0, day));
    this.hemi.color.lerp(new THREE.Color(0.66, 0.68, 0.72).multiplyScalar(lerp(0.45, 1, day)), cloud * 0.75);
    if (this.flash > 0) this.hemi.color.lerp(new THREE.Color(0.85, 0.88, 1), Math.min(1, this.flash));
    if (this.fireGlow > 0) {
      this.hemi.intensity += Math.min(0.4, this.fireGlow * 0.3) * this.night;
      this.hemi.color.lerp(this.fireColor, Math.min(0.45, this.fireGlow * 0.35) * this.night);
    }
    // Warm bounce from sunlit ground and walls.
    this.hemi.groundColor.setRGB(lerp(0.07, 0.42, day), lerp(0.07, 0.36, day), lerp(0.1, 0.27, day));

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
    globalUniforms.uSunDir.value.copy(lightDir);
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
    skyCopy.material.uniforms.mieCoefficient.value = this.sky.material.uniforms.mieCoefficient.value;
    skyCopy.material.uniforms.cloudCoverage.value = this.sky.material.uniforms.cloudCoverage.value;
    skyCopy.material.uniforms.cloudDensity.value = this.sky.material.uniforms.cloudDensity.value;
    const rt = this.pmrem.fromScene(this.skyScene, 0, 1, 30000);
    this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    // The physical sky is HDR; scale its image-based light down to sit under the sun.
    this.scene.environmentIntensity = lerp(0.05, 0.12, 1 - this.night) / this.skyExposure.value;
  }
}
