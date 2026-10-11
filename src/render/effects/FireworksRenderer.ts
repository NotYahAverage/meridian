import * as THREE from 'three';

const MAX = 8000;
const G = 9.8;

/** Particle behaviours. */
const SPARK = 0, TRAIL = 1, CRACKLE = 2, WILLOW = 3;
type ShellKind = 'peony' | 'ring' | 'willow' | 'crackle' | 'double';

const COLORS: [number, number, number][] = [
  [1, 0.72, 0.28], // gold
  [1, 0.22, 0.18], // red
  [0.3, 1, 0.42], // green
  [0.32, 0.55, 1], // blue
  [0.82, 0.38, 1], // violet
  [1, 0.97, 0.9], // white
  [0.28, 0.95, 1], // cyan
  [1, 0.48, 0.12], // orange
];

interface Shell {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  fuse: number;
  kind: ShellKind;
  c1: [number, number, number];
  c2: [number, number, number];
}

interface Show {
  x: number; z: number; ground: number;
  until: number; next: number; rate: number;
  /** Time the finale barrage starts. */
  finale: number;
}

export interface FireworkSound {
  x: number; y: number; z: number;
  kind: 'launch' | 'burst';
  big: boolean;
  crackle: boolean;
}

/**
 * Fireworks: shells climb on sparking trails and burst into peonies, rings,
 * willows and crackling stars. Additive point sprites (bloom does the glow),
 * a brief coloured skylight per burst, and sound events for the audio.
 */
export class FireworksRenderer {
  readonly points: THREE.Points;
  /** Brightness of the skylight flash, decaying. */
  glow = 0;
  readonly glowColor = new THREE.Color();
  /** Launches and bursts since the last drain, for the audio. */
  readonly sounds: FireworkSound[] = [];
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private base = new Float32Array(MAX * 3);
  private size = new Float32Array(MAX);
  private alpha = new Float32Array(MAX);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private drag = new Float32Array(MAX);
  private grav = new Float32Array(MAX);
  private size0 = new Float32Array(MAX);
  private kind = new Uint8Array(MAX);
  private cursor = 0;
  private live = 0;
  private shells: Shell[] = [];
  private shows: Show[] = [];
  private time = 0;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  private v2 = new THREE.Vector2();

  constructor() {
    const g = this.geo;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: { uScale: { value: 800 } },
      vertexShader: `
attribute vec3 color;
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = color;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float px = aSize * uScale / max(1.0, -mv.z);
  // Never vanish below a couple of pixels; fade instead.
  vAlpha *= clamp(px / 2.0, 0.25, 1.0);
  gl_PointSize = max(2.0, px);
  gl_Position = projectionMatrix * mv;
}`,
      fragmentShader: `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = exp(-d * d * 6.0);
  float halo = exp(-d * d * 1.8) * 0.35;
  float a = (core + halo) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * (1.0 + core * 1.6) * a, a);
}`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.visible = false;
    this.points.onBeforeRender = (renderer, _s, camera) => {
      renderer.getDrawingBufferSize(this.v2);
      const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
      this.mat.uniforms.uScale.value = this.v2.y / (2 * Math.tan((fov * Math.PI) / 360));
    };
  }

  /** True while anything is in the air or scheduled. */
  get busy(): boolean {
    return this.shows.length > 0 || this.shells.length > 0 || this.live > 0;
  }

  /** Starts a show of `seconds` launched around (x, z); `rate` scales how many shells fly. */
  start(x: number, z: number, ground: number, seconds: number, rate = 1): void {
    this.shows.push({ x, z, ground, until: this.time + seconds, next: this.time + 0.2, rate, finale: seconds >= 18 ? this.time + seconds - 5 : Infinity });
  }

  stop(): void {
    this.shows.length = 0;
    this.shells.length = 0;
    this.life.fill(0);
    this.alpha.fill(0);
    this.live = 0;
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    for (let i = this.shows.length - 1; i >= 0; i--) {
      const s = this.shows[i];
      while (s.next <= t && t < s.until) {
        const finale = t >= s.finale;
        const salvo = finale ? 2 + Math.floor(Math.random() * 2) : 1;
        for (let k = 0; k < salvo; k++) this.launch(s);
        s.next += finale ? 0.18 + Math.random() * 0.25 : (0.45 + Math.random() * 1.1) / s.rate;
      }
      if (t >= s.until) this.shows.splice(i, 1);
    }
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      sh.vy -= G * dt * 0.7;
      sh.x += sh.vx * dt;
      sh.y += sh.vy * dt;
      sh.z += sh.vz * dt;
      sh.fuse -= dt;
      // Sparks fall from the rising shell.
      for (let k = 0; k < 2; k++) {
        this.spawn(sh.x, sh.y, sh.z, (Math.random() - 0.5) * 3, -2 - Math.random() * 3, (Math.random() - 0.5) * 3, 0.35 + Math.random() * 0.35, 0.7, 2.5, 1, 0.92, 0.6, TRAIL);
      }
      if (sh.fuse <= 0 || sh.vy < 6) {
        this.explode(sh);
        this.shells.splice(i, 1);
      }
    }
    this.glow *= Math.exp(-dt * 4.5);
    if (this.glow < 0.002) this.glow = 0;

    let live = 0;
    const { pos, vel, life, maxLife, alpha, size, col, base } = this;
    for (let i = 0; i < MAX; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) {
        alpha[i] = 0;
        size[i] = 0;
        continue;
      }
      live++;
      const j = i * 3;
      const f = Math.exp(-this.drag[i] * dt);
      vel[j] *= f;
      vel[j + 1] = vel[j + 1] * f - G * this.grav[i] * dt;
      vel[j + 2] *= f;
      pos[j] += vel[j] * dt;
      pos[j + 1] += vel[j + 1] * dt;
      pos[j + 2] += vel[j + 2] * dt;
      const age = 1 - life[i] / maxLife[i];
      const k = this.kind[i];
      let a = Math.pow(1 - age, 1.4);
      if (k === CRACKLE && age > 0.55) a *= Math.random() < 0.45 ? 1.6 : 0.05;
      if (k === WILLOW) {
        // Gold that cools to a deep orange as it droops.
        col[j] = base[j];
        col[j + 1] = base[j + 1] * (1 - 0.45 * age);
        col[j + 2] = base[j + 2] * (1 - 0.8 * age);
      }
      alpha[i] = a;
      size[i] = this.size0[i] * (1 - 0.45 * age);
    }
    this.live = live;
    this.points.visible = live > 0;
    if (live > 0) {
      const g = this.geo;
      g.attributes.position.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
      g.attributes.aSize.needsUpdate = true;
      g.attributes.aAlpha.needsUpdate = true;
    }
  }

  private launch(s: Show): void {
    const r = 40 * Math.random();
    const a = Math.random() * Math.PI * 2;
    const x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r;
    const vy = 52 + Math.random() * 22;
    const kinds: ShellKind[] = ['peony', 'peony', 'ring', 'willow', 'crackle', 'double'];
    const c1 = COLORS[Math.floor(Math.random() * COLORS.length)];
    const c2 = COLORS[Math.floor(Math.random() * COLORS.length)];
    this.shells.push({ x, y: s.ground + 1, z, vx: (Math.random() - 0.5) * 6, vy, vz: (Math.random() - 0.5) * 6, fuse: 2.2 + Math.random() * 1.1, kind: kinds[Math.floor(Math.random() * kinds.length)], c1, c2 });
    this.sounds.push({ x, y: s.ground, z, kind: 'launch', big: false, crackle: false });
  }

  private explode(sh: Shell): void {
    const big = sh.kind === 'willow' || sh.kind === 'double' || Math.random() < 0.3;
    const n = sh.kind === 'ring' ? 90 : sh.kind === 'willow' ? 130 : big ? 170 : 120;
    const speed = sh.kind === 'willow' ? 36 : 42 + Math.random() * 16;
    // Rings lie in a random tilted plane.
    const ax = Math.random() - 0.5, az = Math.random() - 0.5;
    const nrm = new THREE.Vector3(ax, 1, az).normalize();
    const u = new THREE.Vector3(1, 0, 0).cross(nrm).normalize();
    const w = nrm.clone().cross(u);
    for (let k = 0; k < n; k++) {
      let dx: number, dy: number, dz: number;
      if (sh.kind === 'ring') {
        const th = (k / n) * Math.PI * 2;
        dx = u.x * Math.cos(th) + w.x * Math.sin(th);
        dy = u.y * Math.cos(th) + w.y * Math.sin(th);
        dz = u.z * Math.cos(th) + w.z * Math.sin(th);
      } else {
        // Even directions on a sphere.
        const yy = 1 - (2 * (k + Math.random() * 0.5)) / n;
        const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
        const th = k * 2.39996 + Math.random() * 0.2;
        dx = Math.cos(th) * rr;
        dy = yy;
        dz = Math.sin(th) * rr;
      }
      const sp = speed * (sh.kind === 'ring' ? 1 : 0.8 + Math.random() * 0.35);
      const second = sh.kind === 'double' && k % 2 === 1;
      const c = second ? sh.c2 : sh.c1;
      const kind = sh.kind === 'willow' ? WILLOW : sh.kind === 'crackle' ? CRACKLE : SPARK;
      const lifeS = sh.kind === 'willow' ? 3 + Math.random() * 0.8 : 1.5 + Math.random() * 0.8;
      const s = second ? sp * 0.55 : sp;
      this.spawn(sh.x, sh.y, sh.z, dx * s + sh.vx * 0.3, dy * s + sh.vy * 0.15, dz * s + sh.vz * 0.3, lifeS, sh.kind === 'willow' ? 1.5 : 1.0, sh.kind === 'willow' ? 4.4 : 3.6, c[0], c[1], c[2], kind, sh.kind === 'willow' ? 0.55 : 0.32);
    }
    // A bright flash at the heart of the burst.
    for (let k = 0; k < 6; k++) this.spawn(sh.x, sh.y, sh.z, 0, 0, 0, 0.2, 0, 18, 1, 0.95, 0.85, SPARK, 0);
    this.glow = Math.min(1.6, this.glow + (big ? 0.9 : 0.6));
    this.glowColor.setRGB(sh.c1[0], sh.c1[1], sh.c1[2]);
    this.sounds.push({ x: sh.x, y: sh.y, z: sh.z, kind: 'burst', big, crackle: sh.kind === 'crackle' });
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, drag: number, size: number, r: number, g: number, b: number, kind: number, grav = 0.3): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    const j = i * 3;
    this.pos[j] = x;
    this.pos[j + 1] = y;
    this.pos[j + 2] = z;
    this.vel[j] = vx;
    this.vel[j + 1] = vy;
    this.vel[j + 2] = vz;
    this.col[j] = this.base[j] = r;
    this.col[j + 1] = this.base[j + 1] = g;
    this.col[j + 2] = this.base[j + 2] = b;
    this.life[i] = this.maxLife[i] = life;
    this.drag[i] = drag;
    this.grav[i] = grav;
    this.size0[i] = this.size[i] = size;
    this.alpha[i] = 1;
    this.kind[i] = kind;
  }
}
