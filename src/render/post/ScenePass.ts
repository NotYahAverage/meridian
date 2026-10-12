import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const DEPTH_COMMON = /* glsl */ `
uniform sampler2D tDepth;
uniform mat4 uProj;
uniform mat4 uProjInv;
vec3 viewAt(vec2 uv, float d) {
  vec4 v = uProjInv * vec4(vec3(uv, d) * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}
`;

/**
 * Screen-space ambient occlusion, at half resolution, from the depth buffer
 * alone (normals are rebuilt from depth). The hemisphere kernel is rotated
 * per pixel and the noise is removed by a depth-aware blur. The radius grows
 * with distance so street views get tight contact shadows and aerial views
 * get soft occlusion between buildings.
 */
const AO_FRAG = /* glsl */ `
${DEPTH_COMMON}
uniform vec2 uTexel;
uniform vec3 uKernel[KERNEL];
uniform vec2 uFade;
uniform float uIntensity;
varying vec2 vUv;

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  float d = texture2D(tDepth, vUv).x;
  if (d >= 1.0) { gl_FragColor = vec4(1.0, 1e5, 0.0, 1.0); return; }
  vec3 p = viewAt(vUv, d);
  float dist = -p.z;
  // Normal from depth: per axis, the neighbour on the same surface.
  vec3 pl = viewAt(vUv - vec2(uTexel.x, 0.0), texture2D(tDepth, vUv - vec2(uTexel.x, 0.0)).x);
  vec3 pr = viewAt(vUv + vec2(uTexel.x, 0.0), texture2D(tDepth, vUv + vec2(uTexel.x, 0.0)).x);
  vec3 pd = viewAt(vUv - vec2(0.0, uTexel.y), texture2D(tDepth, vUv - vec2(0.0, uTexel.y)).x);
  vec3 pu = viewAt(vUv + vec2(0.0, uTexel.y), texture2D(tDepth, vUv + vec2(0.0, uTexel.y)).x);
  vec3 dx = abs(pl.z - p.z) < abs(pr.z - p.z) ? p - pl : pr - p;
  vec3 dy = abs(pd.z - p.z) < abs(pu.z - p.z) ? p - pd : pu - p;
  vec3 n = normalize(cross(dx, dy));
  float a = ign(gl_FragCoord.xy) * 6.2831853;
  vec3 rv = vec3(cos(a), sin(a), 0.0);
  vec3 t = normalize(rv - n * dot(rv, n));
  vec3 b = cross(n, t);
  mat3 tbn = mat3(t, b, n);
  float radius = clamp(dist * 0.016, 1.1, 14.0);
  float bias = radius * 0.04 + dist * 0.0008;
  float occ = 0.0;
  for (int i = 0; i < KERNEL; i++) {
    vec3 s = p + tbn * uKernel[i] * radius;
    vec4 c = uProj * vec4(s, 1.0);
    vec2 suv = c.xy / c.w * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
    float sd = texture2D(tDepth, suv).x;
    float sz = viewAt(suv, sd).z;
    float range = smoothstep(0.0, 1.0, radius / max(1e-3, abs(p.z - sz)));
    occ += step(s.z + bias, sz) * range;
  }
  occ /= float(KERNEL);
  float fade = 1.0 - smoothstep(uFade.x, uFade.y, dist);
  float ao = 1.0 - occ * uIntensity * fade;
  gl_FragColor = vec4(clamp(ao, 0.0, 1.0), dist, 0.0, 1.0);
}
`;

/** Depth-aware 4×4 blur that removes the rotation noise without bleeding across edges. */
const BLUR_FRAG = /* glsl */ `
uniform sampler2D tAO;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec2 c = texture2D(tAO, vUv).rg;
  float sum = 0.0, wsum = 0.0;
  for (int y = -2; y < 2; y++) {
    for (int x = -2; x < 2; x++) {
      vec2 s = texture2D(tAO, vUv + (vec2(float(x), float(y)) + 0.5) * uTexel).rg;
      float w = 1.0 / (1e-3 + abs(s.g - c.g) / max(1.0, c.g * 0.02));
      w = min(w, 50.0);
      sum += s.r * w;
      wsum += w;
    }
  }
  gl_FragColor = vec4(sum / max(wsum, 1e-4), c.g, 0.0, 1.0);
}
`;

/** Applies the (upsampled) occlusion to the lit scene, sparing light sources. */
const COMPOSITE_FRAG = /* glsl */ `
${DEPTH_COMMON}
uniform sampler2D tColor;
uniform sampler2D tAO;
uniform vec2 uAOTexel;
uniform float uEnabled;
varying vec2 vUv;
void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  if (uEnabled > 0.5) {
    float d = texture2D(tDepth, vUv).x;
    float dist = -viewAt(vUv, d).z;
    // Depth-aware upsample: the four nearest half-resolution samples, weighted by depth match.
    vec2 base = (floor(vUv / uAOTexel - 0.5) + 0.5) * uAOTexel;
    float sum = 0.0, wsum = 0.0;
    for (int y = 0; y < 2; y++) {
      for (int x = 0; x < 2; x++) {
        vec2 suv = base + vec2(float(x), float(y)) * uAOTexel;
        vec2 s = texture2D(tAO, suv).rg;
        vec2 f = 1.0 - abs((vUv - suv) / uAOTexel);
        float w = max(1e-3, f.x * f.y) / (1e-3 + abs(s.g - dist) / max(1.0, dist * 0.015));
        sum += s.r * w;
        wsum += w;
      }
    }
    float ao = d >= 1.0 ? 1.0 : sum / max(wsum, 1e-5);
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    ao = mix(ao, 1.0, smoothstep(1.5, 5.0, lum));
    col *= ao;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

function hemisphereKernel(n: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  // Deterministic low-discrepancy hemisphere, denser near the centre.
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const phi = i * 2.399963;
    const z = Math.sqrt(1 - u) * 0.85 + 0.15;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const v = new THREE.Vector3(Math.cos(phi) * r, Math.sin(phi) * r, z);
    const scale = 0.18 + 0.82 * ((i * 7) % n) / n;
    out.push(v.multiplyScalar(scale * scale * 0.9 + 0.1));
  }
  return out;
}

/**
 * First pass of the chain: draws the scene into its own multisampled HDR
 * target (with a depth texture), works out ambient occlusion from the depth
 * and writes the occluded image into the composer's read buffer.
 */
export class ScenePass extends Pass {
  readonly target: THREE.WebGLRenderTarget;
  private aoA: THREE.WebGLRenderTarget;
  private aoB: THREE.WebGLRenderTarget;
  private aoMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private compMat: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  ao = true;
  samples = 4;
  /** View distances over which occlusion fades out (it would darken the fog). */
  readonly fade = new THREE.Vector2(1200, 2600);

  constructor(private scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    super();
    this.needsSwap = false;
    const depth = new THREE.DepthTexture(1, 1, THREE.FloatType);
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthTexture: depth });
    const aoOpts = { type: THREE.HalfFloatType, format: THREE.RGFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.aoA = new THREE.WebGLRenderTarget(1, 1, aoOpts);
    this.aoB = new THREE.WebGLRenderTarget(1, 1, aoOpts);
    const kernel = hemisphereKernel(14);
    const common = { tDepth: { value: depth }, uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() } };
    this.aoMat = new THREE.ShaderMaterial({
      defines: { KERNEL: kernel.length },
      uniforms: { ...common, uTexel: { value: new THREE.Vector2() }, uKernel: { value: kernel }, uFade: { value: this.fade }, uIntensity: { value: 1.25 } },
      vertexShader: QUAD_VERT,
      fragmentShader: AO_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tAO: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VERT,
      fragmentShader: BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.compMat = new THREE.ShaderMaterial({
      uniforms: { ...common, tColor: { value: this.target.texture }, tAO: { value: null }, uAOTexel: { value: new THREE.Vector2() }, uEnabled: { value: 1 } },
      vertexShader: QUAD_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    // The three passes share the same matrices.
    this.blurMat.uniforms.tAO.value = this.aoA.texture;
    this.compMat.uniforms.tAO.value = this.aoB.texture;
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
    const hw = Math.max(1, Math.ceil(width / 2)), hh = Math.max(1, Math.ceil(height / 2));
    this.aoA.setSize(hw, hh);
    this.aoB.setSize(hw, hh);
    this.aoMat.uniforms.uTexel.value.set(1 / width, 1 / height);
    this.blurMat.uniforms.uTexel.value.set(1 / hw, 1 / hh);
    this.compMat.uniforms.uAOTexel.value.set(1 / hw, 1 / hh);
  }

  setSamples(n: number): void {
    if (this.target.samples === n) return;
    this.target.samples = n;
    this.target.dispose();
  }

  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    const cam = this.camera;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, cam);
    const u = this.aoMat.uniforms;
    u.uProj.value.copy(cam.projectionMatrix);
    u.uProjInv.value.copy(cam.projectionMatrixInverse);
    this.compMat.uniforms.uEnabled.value = this.ao ? 1 : 0;
    if (this.ao) {
      this.quad.material = this.aoMat;
      renderer.setRenderTarget(this.aoA);
      this.quad.render(renderer);
      this.quad.material = this.blurMat;
      renderer.setRenderTarget(this.aoB);
      this.quad.render(renderer);
    }
    this.quad.material = this.compMat;
    renderer.setRenderTarget(this.renderToScreen ? null : read);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.target.dispose();
    this.aoA.dispose();
    this.aoB.dispose();
    this.aoMat.dispose();
    this.blurMat.dispose();
    this.compMat.dispose();
    this.quad.dispose();
  }
}

/**
 * Final pass: filmic tone mapping, sRGB output and Meridian's colour grade
 * (gentle contrast, warm highlights over cool shadows, controlled saturation,
 * a soft vignette and dithering against banding).
 */
export class GradePass extends Pass {
  private mat: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  readonly uniforms: {
    tDiffuse: { value: THREE.Texture | null };
    uExposure: { value: number };
    uNight: { value: number };
    uContrast: { value: number };
    uSaturation: { value: number };
    uVignette: { value: number };
    uWarmth: { value: number };
  };

  constructor() {
    super();
    this.uniforms = {
      tDiffuse: { value: null },
      uExposure: { value: 1 },
      uNight: { value: 0 },
      uContrast: { value: 1.08 },
      uSaturation: { value: 1.06 },
      uVignette: { value: 0.22 },
      uWarmth: { value: 1 },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uExposure;
uniform float uNight;
uniform float uContrast;
uniform float uSaturation;
uniform float uVignette;
uniform float uWarmth;
varying vec2 vUv;

// ACES fit (Stephen Hill), as three.js uses.
vec3 g_rrtOdtFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 g_aces(vec3 color) {
  const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= uExposure / 0.6;
  color = ACESInputMat * color;
  color = g_rrtOdtFit(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec3 hdr = texture2D(tDiffuse, vUv).rgb;
  vec3 c = toSRGB(g_aces(hdr));
  // Contrast around a mid-grey pivot, as a smooth S-curve.
  vec3 s = c - 0.46;
  c = 0.46 + s * uContrast - s * abs(s) * (uContrast - 1.0) * 0.9;
  // Split toning: shadows lean cool, highlights warm (more so by day).
  float l = luma(c);
  float day = 1.0 - uNight;
  vec3 shadowTint = mix(vec3(-0.012, 0.0, 0.022), vec3(-0.02, -0.004, 0.03), uNight);
  vec3 highTint = vec3(0.026, 0.01, -0.022) * uWarmth * day;
  c += shadowTint * (1.0 - smoothstep(0.0, 0.5, l)) + highTint * smoothstep(0.45, 1.0, l);
  // Vibrance: lift muted colours more than already-saturated ones.
  l = luma(c);
  float sat = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
  c = mix(vec3(l), c, uSaturation + (1.0 - sat) * 0.06 - 0.06);
  // Vignette.
  vec2 q = vUv - 0.5;
  float v = 1.0 - dot(q, q) * uVignette * 1.6;
  c *= v;
  // Dither (half an 8-bit step) against banding in the sky and fog.
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) / 255.0;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.mat);
  }

  render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    this.uniforms.tDiffuse.value = read.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : write);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.mat.dispose();
    this.quad.dispose();
  }
}
