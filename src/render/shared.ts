import * as THREE from 'three';

/** Uniforms shared by every custom material (updated once per frame). */
export const globalUniforms = {
  uTime: { value: 0 },
  /** 0 = full day, 1 = full night. */
  uNight: { value: 0 },
  /** Hour of day 0–24. */
  uHour: { value: 9 },
  /** 0–1: how strongly overlays desaturate the world. */
  uDesat: { value: 0 },
  /** 0–1 surface wetness (rain). */
  uWet: { value: 0 },
  /** 0–1 lying snow. */
  uSnow: { value: 0 },
  /** 0–1 falling rain (ripples on water). */
  uRain: { value: 0 },
  /** Drifting cloud shadows: offset x, offset z, coverage 0–1, strength 0–1. */
  uCloudShadow: { value: new THREE.Vector4(0, 0, 0, 0) },
  /** Direction towards the key light (sun by day, moon by night), world space. */
  uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
};

/** GLSL helpers: hashing, value noise and sRGB conversion. */
export const GLSL_COMMON = /* glsl */ `
float m_hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float m_hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float m_vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = m_hash12(i);
  float b = m_hash12(i + vec2(1.0, 0.0));
  float c = m_hash12(i + vec2(0.0, 1.0));
  float d = m_hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float m_fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * m_vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.3);
    a *= 0.5;
  }
  return s;
}
vec3 m_srgb(vec3 c) { return pow(c, vec3(2.2)); }
vec3 m_desat(vec3 c, float k) { float l = dot(c, vec3(0.299, 0.587, 0.114)); return mix(c, vec3(l), k); }
uniform vec4 uCloudShadow;
/** 1 in sunlight, darker under the shadow of a passing cloud. */
float m_cloudShade(vec2 wp) {
  if (uCloudShadow.w <= 0.001) return 1.0;
  vec2 p = (wp + uCloudShadow.xy) * 0.0026;
  float n = m_vnoise(p) * 0.62 + m_vnoise(p * 2.3 + 7.1) * 0.28 + m_vnoise(p * 5.1 - 3.7) * 0.1;
  float edge = 1.0 - uCloudShadow.z;
  return 1.0 - uCloudShadow.w * smoothstep(edge - 0.05, edge + 0.05, n);
}
`;

/** Converts an sRGB hex colour into a linear THREE.Color. */
export function srgbColor(hex: number): THREE.Color {
  return new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
}

export type ShaderHook = (shader: THREE.WebGLProgramParametersWithUniforms) => void;

/** Applies an onBeforeCompile hook and gives the material a stable program cache key. */
export function patchMaterial<T extends THREE.Material>(mat: T, key: string, hook: ShaderHook): T {
  mat.onBeforeCompile = hook;
  mat.customProgramCacheKey = () => key;
  return mat;
}

export interface QualitySettings {
  shadows: boolean;
  shadowSize: number;
  bloom: boolean;
  pixelRatio: number;
  antialias: boolean;
  /** Screen-space ambient occlusion. */
  ao: boolean;
}

export const QUALITY_PRESETS: Record<'low' | 'medium' | 'high', QualitySettings> = {
  low: { shadows: false, shadowSize: 1024, bloom: false, pixelRatio: 1, antialias: false, ao: false },
  medium: { shadows: true, shadowSize: 2048, bloom: true, pixelRatio: 1, antialias: true, ao: true },
  high: { shadows: true, shadowSize: 4096, bloom: true, pixelRatio: 2, antialias: true, ao: true },
};

/**
 * Everything within this distance (east–west and north–south) of the point the
 * camera looks at is drawn in full detail: a square the size of the original
 * map. Beyond it, buildings become boxes, cars aren't drawn and terrain is coarse.
 */
export const DETAIL_HALF = 1536;

/** True when a square of half-size `half` centred at (x, z) lies wholly outside the detail square around (fx, fz). */
export function beyondDetail(x: number, z: number, half: number, fx: number, fz: number): boolean {
  return Math.max(Math.abs(x - fx), Math.abs(z - fz)) - half > DETAIL_HALF;
}
