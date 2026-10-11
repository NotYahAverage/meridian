import * as THREE from 'three';
import { GLSL_COMMON, globalUniforms, patchMaterial } from '../shared';

/** Season tint uniforms for deciduous foliage (set from the calendar). */
export const seasonUniforms = {
  uSeasonTint: { value: new THREE.Color(1, 1, 1) },
  uSeasonAmount: { value: 0 },
};

/**
 * Material for instanced vehicles and props. Body parts take the per-instance
 * colour; glass is reflective; lights glow at night; emergency light bars flash.
 */
export function createAssetMaterial(key: string, opts: { instanceExtras?: boolean } = {}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 });
  const extras = !!opts.instanceExtras;
  mat.name = `asset-${key}`;
  // The shader only depends on `extras`, so materials share programs (faster startup).
  return patchMaterial(mat, extras ? 'asset-extras' : 'asset', (shader) => {
    Object.assign(shader.uniforms, globalUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aMat;
${extras ? 'attribute vec2 aInst;' : ''}
varying float vMat;
varying vec2 vInst;
varying float vSeed;`,
      )
      .replace(
        '#include <color_vertex>',
        `vColor = vec4(color, 1.0);
#ifdef USE_INSTANCING_COLOR
if (aMat < 0.5) vColor.rgb *= instanceColor.rgb;
#endif
vMat = aMat;
${extras ? 'vInst = aInst;' : 'vInst = vec2(0.0);'}
#ifdef USE_INSTANCING
vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
#else
vSeed = 0.0;
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vMat;
varying vec2 vInst;
varying float vSeed;
uniform float uTime;
uniform float uNight;
uniform float uDesat;
${GLSL_COMMON}
float a_rough = 0.6;
float a_metal = 0.0;
vec3 a_emis = vec3(0.0);`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  int k = int(vMat + 0.5);
  if (k == 0) { a_rough = 0.32; a_metal = 0.25; }
  else if (k == 2) { a_rough = 0.06; a_metal = 0.75; }
  else if (k == 3) { a_emis += vec3(1.0, 0.95, 0.82) * (0.1 + uNight * 3.0); a_rough = 0.2; }
  else if (k == 4) { a_emis += vec3(1.0, 0.08, 0.04) * (0.08 + uNight * 0.9 + vInst.x * 1.8); }
  else if (k == 5) {
    float ph = step(0.5, fract(uTime * 2.2 + vSeed));
    vec3 lc = mix(vec3(1.0, 0.1, 0.08), vec3(0.15, 0.3, 1.0), ph);
    float flashOn = ${extras ? 'vInst.y' : '0.0'};
    a_emis += lc * (0.2 + flashOn * 3.5);
    diffuseColor.rgb = mix(diffuseColor.rgb, lc, 0.6);
  }
  else if (k == 6) { a_emis += vec3(1.0, 0.86, 0.62) * (0.05 + uNight * 5.0); }
  else { a_rough = 0.7; }
  diffuseColor.rgb = mix(diffuseColor.rgb, m_desat(diffuseColor.rgb, 0.85) * 0.8, uDesat);
}`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = a_rough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = a_metal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += a_emis;');
  });
}

/** Alpha-tested foliage with wind sway and seasonal colour. */
export function createFoliageMaterial(leaf: THREE.Texture, cutout = true): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: cutout ? leaf : null,
    alphaTest: cutout ? 0.42 : 0,
    side: cutout ? THREE.DoubleSide : THREE.FrontSide,
    roughness: 0.85,
    metalness: 0,
  });
  return patchMaterial(mat, `foliage-${cutout}`, (shader) => {
    Object.assign(shader.uniforms, globalUniforms, seasonUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vLeaf;\nvarying float vH;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vH = position.y;
vLeaf = step(0.45, color.g - color.r) + step(0.5, color.g) * step(color.r, 0.45);
#ifdef USE_INSTANCING
float ph = instanceMatrix[3].x * 0.07 + instanceMatrix[3].z * 0.05;
#else
float ph = 0.0;
#endif
float sway = max(0.0, position.y - 2.2) * 0.022;
transformed.x += sin(uTime * 1.4 + ph) * sway;
transformed.z += cos(uTime * 1.1 + ph * 1.3) * sway * 0.7;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSeasonTint;\nuniform float uSeasonAmount;\nuniform float uDesat;\nuniform float uSnow;\nvarying float vLeaf;\nvarying float vH;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float leafy = step(diffuseColor.r, diffuseColor.g * 0.95);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uSeasonTint, uSeasonAmount * leafy);
  diffuseColor.rgb *= (0.78 + 0.22 * clamp(vH / 7.0, 0.0, 1.2)) * ${cutout ? '1.0' : '0.7'};
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.84, 0.88), uSnow * 0.45 * smoothstep(1.5, 5.0, vH));
  float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(l) * 0.8, uDesat * 0.85);
}`,
      );
  });
}

export function createFoliageDepthMaterial(leaf: THREE.Texture): THREE.MeshDepthMaterial {
  return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leaf, alphaTest: 0.42, side: THREE.DoubleSide });
}

/** Writes a TRS matrix (yaw θ maps model +X to (cosθ, sinθ) on the ground). */
export function writeMatrix(out: Float32Array, o: number, x: number, y: number, z: number, theta: number, sx: number, sy = sx, sz = sx): void {
  const c = Math.cos(theta), s = Math.sin(theta);
  out[o] = c * sx;
  out[o + 1] = 0;
  out[o + 2] = s * sx;
  out[o + 3] = 0;
  out[o + 4] = 0;
  out[o + 5] = sy;
  out[o + 6] = 0;
  out[o + 7] = 0;
  out[o + 8] = -s * sz;
  out[o + 9] = 0;
  out[o + 10] = c * sz;
  out[o + 11] = 0;
  out[o + 12] = x;
  out[o + 13] = y;
  out[o + 14] = z;
  out[o + 15] = 1;
}

/** Instanced mesh whose capacity grows on demand. */
export class Pool {
  mesh: THREE.InstancedMesh;
  capacity: number;
  private extras: THREE.InstancedBufferAttribute | null = null;

  constructor(
    private geo: THREE.BufferGeometry,
    private material: THREE.Material,
    capacity: number,
    private opts: { shadows?: boolean; colors?: boolean; extras?: boolean; depth?: THREE.Material } = {},
  ) {
    this.capacity = capacity;
    this.mesh = this.create(capacity);
  }

  private create(cap: number): THREE.InstancedMesh {
    const geo = this.opts.extras ? this.geo.clone() : this.geo;
    if (this.opts.extras) {
      this.extras = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
      this.extras.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aInst', this.extras);
    }
    const m = new THREE.InstancedMesh(geo, this.material, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (this.opts.colors) {
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = !!this.opts.shadows;
    m.receiveShadow = true;
    if (this.opts.depth) m.customDepthMaterial = this.opts.depth;
    return m;
  }

  /** Ensures capacity; returns true if the mesh object was replaced. */
  ensure(n: number): boolean {
    if (n <= this.capacity) return false;
    let cap = this.capacity;
    while (cap < n) cap *= 2;
    const parent = this.mesh.parent;
    parent?.remove(this.mesh);
    this.mesh.dispose();
    this.capacity = cap;
    this.mesh = this.create(cap);
    parent?.add(this.mesh);
    return true;
  }

  get matrices(): Float32Array {
    return this.mesh.instanceMatrix.array as Float32Array;
  }

  get colors(): Float32Array | null {
    return (this.mesh.instanceColor?.array as Float32Array) ?? null;
  }

  get extraData(): Float32Array | null {
    return (this.extras?.array as Float32Array) ?? null;
  }

  commit(count: number): void {
    this.mesh.count = count;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, count * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.clearUpdateRanges();
      this.mesh.instanceColor.addUpdateRange(0, count * 3);
      this.mesh.instanceColor.needsUpdate = true;
    }
    if (this.extras) {
      this.extras.clearUpdateRanges();
      this.extras.addUpdateRange(0, count * 2);
      this.extras.needsUpdate = true;
    }
  }
}
