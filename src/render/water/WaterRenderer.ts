import * as THREE from 'three';
import { HM_RES, WATER_LEVEL, WORLD_SIZE } from '../../sim/constants';
import type { Terrain } from '../../sim/world/Terrain';
import { GLSL_COMMON, globalUniforms, patchMaterial } from '../shared';

/**
 * Water surface: depth-tinted colour from the terrain, shoreline foam,
 * procedural animated normals and sky reflections via the environment map.
 */
export class WaterRenderer {
  readonly mesh: THREE.Mesh;
  private depthTex: THREE.DataTexture;
  private version = 0;
  private wait = 0;

  constructor(terrain: Terrain) {
    const res = HM_RES;
    const data = new Uint8Array(res * res);
    for (let i = 0; i < res * res; i++) {
      const d = WATER_LEVEL - terrain.base[i];
      data[i] = Math.max(0, Math.min(255, Math.round((d / 24) * 255)));
    }
    this.depthTex = new THREE.DataTexture(data, res, res, THREE.RedFormat);
    this.depthTex.magFilter = THREE.LinearFilter;
    this.depthTex.minFilter = THREE.LinearFilter;
    this.depthTex.wrapS = this.depthTex.wrapT = THREE.ClampToEdgeWrapping;
    this.depthTex.needsUpdate = true;

    const geo = new THREE.PlaneGeometry(WORLD_SIZE * 4, WORLD_SIZE * 4, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(WORLD_SIZE / 2, WATER_LEVEL, WORLD_SIZE / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1d4a57,
      roughness: 0.035,
      metalness: 0.02,
      transparent: true,
      depthWrite: false,
      envMapIntensity: 1.1,
    });
    const depthTex = this.depthTex;
    patchMaterial(mat, 'water', (shader) => {
      Object.assign(shader.uniforms, globalUniforms, { uDepth: { value: depthTex } });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vWPos;
uniform sampler2D uDepth;
uniform float uTime;
uniform float uNight;
uniform float uRain;
${GLSL_COMMON}
float w_depth;
float w_foam;
vec3 waveNormal(vec2 p, float t) {
  vec2 q = p * 0.045;
  float e = 0.35;
  float h0 = m_fbm(q + vec2(t * 0.05, t * 0.031));
  float hx = m_fbm(q + vec2(e * 0.045, 0.0) + vec2(t * 0.05, t * 0.031));
  float hz = m_fbm(q + vec2(0.0, e * 0.045) + vec2(t * 0.05, t * 0.031));
  vec2 g = vec2(hx - h0, hz - h0) / e;
  g += vec2(sin(p.x * 0.21 + t * 1.3) * 0.25, cos(p.y * 0.17 + t * 1.1) * 0.25) * 0.35;
  vec2 q2 = p * 0.33;
  float k0 = m_vnoise(q2 + t * 0.4);
  g += vec2(m_vnoise(q2 + vec2(0.1, 0.0) + t * 0.4) - k0, m_vnoise(q2 + vec2(0.0, 0.1) + t * 0.4) - k0) * 2.2;
  // Raindrops: small expanding rings on a grid of random cells.
  if (uRain > 0.01) {
    vec2 cell = floor(p * 0.9);
    vec2 f = fract(p * 0.9) - 0.5;
    float ph = fract(t * 1.3 + m_hash12(cell) * 7.0);
    vec2 c = f - (vec2(m_hash12(cell + 3.1), m_hash12(cell + 7.7)) - 0.5) * 0.6;
    float r = length(c);
    float ring = sin((r - ph * 0.5) * 60.0) * (1.0 - ph) * smoothstep(0.5 * ph + 0.05, 0.5 * ph, r);
    g += (c / max(r, 0.001)) * ring * 0.9 * uRain;
  }
  return normalize(vec3(-g.x * 0.9, 1.0, -g.y * 0.9));
}
`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  vec2 uv = clamp(vWPos.xz / ${WORLD_SIZE.toFixed(1)}, 0.0, 1.0);
  vec2 outside = abs(vWPos.xz / ${WORLD_SIZE.toFixed(1)} - 0.5);
  w_depth = texture2D(uDepth, uv).r * 24.0;
  if (max(outside.x, outside.y) > 0.5) w_depth = max(w_depth, 4.0);
  vec3 shallow = m_srgb(vec3(0.22, 0.47, 0.46));
  vec3 deep = m_srgb(vec3(0.04, 0.16, 0.22));
  vec3 col = mix(shallow, deep, smoothstep(0.3, 11.0, w_depth));
  float n = m_vnoise(vWPos.xz * 0.15 + uTime * 0.3);
  w_foam = (1.0 - smoothstep(0.0, 0.7 + n * 0.5, w_depth)) * (0.55 + 0.45 * sin(uTime * 1.6 + n * 6.0));
  col = mix(col, vec3(0.9), clamp(w_foam, 0.0, 1.0) * 0.6);
  diffuseColor.rgb = col;
  diffuseColor.a = mix(0.25, 0.94, smoothstep(0.0, 4.5, w_depth));
  diffuseColor.a = max(diffuseColor.a, w_foam * 0.7);
}
`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
{
  vec3 wn = waveNormal(vWPos.xz, uTime);
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}
`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
#ifdef USE_FOG
{
  // The sky's tone mirrored at grazing angles, so dull or dusky skies never leave the water inky black.
  float wfr = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);
  totalEmissiveRadiance += fogColor * (0.05 + 0.3 * wfr) * (1.0 - 0.5 * uNight);
  // Moonlight on the swell after dark.
  totalEmissiveRadiance += vec3(0.035, 0.055, 0.09) * (0.25 + 0.9 * wfr) * uNight;
}
#endif
`,
        );
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 2;
    this.mesh.matrixAutoUpdate = false;
  }

  /** Re-reads water depth after the ground changed (throttled while the player drags). */
  syncTerrain(terrain: Terrain, dt: number): void {
    this.wait -= dt;
    if (terrain.waterVersion === this.version || this.wait > 0) return;
    this.version = terrain.waterVersion;
    this.wait = 0.2;
    const data = this.depthTex.image.data as Uint8Array;
    const b = terrain.base;
    for (let i = 0; i < data.length; i++) {
      const d = WATER_LEVEL - b[i];
      data[i] = d <= 0 ? 0 : Math.min(255, Math.round((d / 24) * 255));
    }
    this.depthTex.needsUpdate = true;
  }
}
