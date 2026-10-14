import * as THREE from 'three';
import { GLSL_COMMON, globalUniforms, patchMaterial } from '../shared';
import { FACADE_GLSL, FACADE_LIGHT_GLSL } from './facadeShader';

export interface BuildingUniforms {
  uState: { value: THREE.DataTexture };
  uStateSize: { value: number };
  uBldOverlay: { value: number };
  uGhost: { value: number };
  uGhostColor: { value: THREE.Color };
}

const VERT_DECL = /* glsl */ `
attribute vec2 aFac;
attribute vec4 aPat;
attribute vec2 aMeta;
uniform sampler2D uState;
uniform float uStateSize;
varying vec2 vFac;
varying vec4 vPat;
varying vec4 vState;
varying vec3 vWPos;
varying vec3 vWNormal;
varying float vRelY;
varying float vSlot;
`;

const VERT_STATE = /* glsl */ `
{
  vec2 st = vec2(mod(aMeta.x, uStateSize), floor(aMeta.x / uStateSize));
  vState = aMeta.x < 0.0 ? vec4(1.0, 0.0, 0.0, 0.0) : texture2D(uState, (st + 0.5) / uStateSize);
  float prog = vState.r;
  vRelY = transformed.y - aMeta.y;
  if (prog < 0.999) transformed.y = aMeta.y + (transformed.y - aMeta.y) * max(prog, 0.03);
  vFac = aFac;
  vSlot = aMeta.x;
  vPat = aPat;
}
`;

function vertexPatch(shader: THREE.WebGLProgramParametersWithUniforms, worldNormal: boolean): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_STATE}`)
    .replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n${worldNormal ? 'vWNormal = normalize(mat3(modelMatrix) * objectNormal);' : 'vWNormal = vec3(0.0, 1.0, 0.0);'}`,
    );
}

/** The shared building material (one draw call per chunk). */
export function createBuildingMaterial(u: BuildingUniforms, ghost = false): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
    transparent: ghost,
    opacity: ghost ? 0.6 : 1,
    depthWrite: !ghost,
  });
  return patchMaterial(mat, ghost ? 'building-ghost' : 'building', (shader) => {
    Object.assign(shader.uniforms, u, globalUniforms, { uGhost: { value: ghost ? 1 : 0 } });
    vertexPatch(shader, true);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vFac;
varying vec4 vPat;
varying vec4 vState;
varying vec3 vWPos;
varying vec3 vWNormal;
varying float vRelY;
varying float vSlot;
uniform float uTime;
uniform float uNight;
uniform float uHour;
uniform float uDesat;
uniform float uWet;
uniform float uSnow;
uniform vec3 uSunDir;
uniform float uBldOverlay;
uniform float uGhost;
uniform vec3 uGhostColor;
${GLSL_COMMON}
${FACADE_GLSL}
`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 base = m_srgb(diffuseColor.rgb);
  float isWall = 1.0 - step(0.6, abs(vWNormal.y));
  vec3 col;
  applyPattern(col, base, isWall);
  // Data overlays tint buildings by a per-building value.
  float ov = vState.a * 255.0;
  if (uBldOverlay > 0.5) {
    col = m_desat(col, 0.85) * 0.7;
    if (ov > 0.5) {
      float t = (ov - 1.0) / 254.0;
      vec3 ramp = mix(vec3(0.9, 0.15, 0.12), vec3(0.98, 0.82, 0.2), smoothstep(0.0, 0.5, t));
      ramp = mix(ramp, vec3(0.2, 0.8, 0.4), smoothstep(0.5, 1.0, t));
      col = mix(col, m_srgb(ramp), 0.75);
      b_emis += m_srgb(ramp) * 0.12;
    }
  } else {
    col = mix(col, m_desat(col, 0.85) * 0.8, uDesat);
  }
  float hl = floor(vState.g * 255.0 + 0.5);
  if (hl > 0.5) {
    // 1 hover, 2 selected, 3 replaced by placement, 4 bulldoze, 5 existing building of the kind being placed.
    vec3 hc = hl < 1.5 ? vec3(1.0) : hl < 2.5 ? vec3(0.35, 0.95, 0.8) : hl < 3.5 ? vec3(1.0, 0.2, 0.15) : hl < 4.5 ? vec3(1.0, 0.72, 0.2) : vec3(0.16, 0.42, 1.0);
    col = mix(col, hc, hl < 1.5 ? 0.12 : hl > 4.5 ? 0.62 : 0.35);
    b_emis += hc * (hl < 1.5 ? 0.06 : hl > 4.5 ? 0.4 : 0.22);
  }
  if (uGhost > 0.5) {
    col = mix(col, uGhostColor, 0.5);
    b_emis += uGhostColor * 0.3;
  }
  diffuseColor.rgb = col * m_cloudShade(vWPos.xz);
}
`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = b_rough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = b_metal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += b_emis;')
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\nradiance *= b_refl;')
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${FACADE_LIGHT_GLSL}`);
  });
}

/** Depth material so shadows follow the construction growth animation. */
export function createBuildingDepthMaterial(u: BuildingUniforms): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  return patchMaterial(mat, 'building-depth', (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_STATE}`);
  });
}
