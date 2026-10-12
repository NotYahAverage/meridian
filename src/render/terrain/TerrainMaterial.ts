import * as THREE from 'three';
import { HM_RES, HM_STEP, WORLD_SIZE } from '../../sim/constants';
import { LAND_TILE, LAND_TILES } from '../../sim/world/Land';
import { GLSL_COMMON, globalUniforms, patchMaterial } from '../shared';

export interface TerrainUniforms {
  uZoneTex: { value: THREE.Texture };
  uZonableTex: { value: THREE.Texture };
  uOverlayTex: { value: THREE.Texture };
  uZoneOpacity: { value: number };
  uZonableOpacity: { value: number };
  uOverlayOpacity: { value: number };
  uGridOpacity: { value: number };
  /** x, z, radius, strength */
  uBrush: { value: THREE.Vector4 };
  uBrushColor: { value: THREE.Color };
  /** Second ring (service coverage preview): x, z, radius, strength */
  uRing: { value: THREE.Vector4 };
  uRingColor: { value: THREE.Color };
  uOuter: { value: number };
  /** Bare-soil freshness per heightmap vertex. */
  uSoilTex: { value: THREE.Texture };
  /** Land parcels: r = owned, g = buyable (LAND_TILES square). */
  uLandTex: { value: THREE.Texture };
  /** 1 when some land is not owned (otherwise the shading is skipped). */
  uLandOn: { value: number };
}

export function createTerrainUniforms(zone: THREE.Texture, zonable: THREE.Texture, overlay: THREE.Texture, soil: THREE.Texture, land: THREE.Texture): TerrainUniforms {
  return {
    uZoneTex: { value: zone },
    uZonableTex: { value: zonable },
    uOverlayTex: { value: overlay },
    uZoneOpacity: { value: 0.2 },
    uZonableOpacity: { value: 0 },
    uOverlayOpacity: { value: 0 },
    uGridOpacity: { value: 0 },
    uBrush: { value: new THREE.Vector4(0, 0, 0, 0) },
    uBrushColor: { value: new THREE.Color(0.4, 1, 0.85) },
    uRing: { value: new THREE.Vector4(0, 0, 0, 0) },
    uRingColor: { value: new THREE.Color(0.4, 0.8, 1) },
    uOuter: { value: 0 },
    uSoilTex: { value: soil },
    uLandTex: { value: land },
    uLandOn: { value: 0 },
  };
}

/**
 * Procedural ground: grass with large- and small-scale variation, dirt,
 * rock on slopes, beaches near water; plus zoning, data overlays, brush rings
 * and the map boundary.
 */
export function createTerrainMaterial(u: TerrainUniforms, outer = false): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0, color: 0xffffff });
  // Inner and outer terrain share one program; they differ only by a uniform.
  mat.name = outer ? 'terrain-outer' : 'terrain';
  return patchMaterial(mat, 'terrain', (shader) => {
    Object.assign(shader.uniforms, u, globalUniforms, { uOuter: { value: outer ? 1 : 0 } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWPos;
varying vec3 vWNormal;
uniform sampler2D uZoneTex;
uniform sampler2D uZonableTex;
uniform sampler2D uOverlayTex;
uniform float uZoneOpacity;
uniform float uZonableOpacity;
uniform float uOverlayOpacity;
uniform float uGridOpacity;
uniform sampler2D uLandTex;
uniform float uLandOn;
uniform vec4 uBrush;
uniform vec3 uBrushColor;
uniform vec4 uRing;
uniform vec3 uRingColor;
uniform float uOuter;
uniform sampler2D uSoilTex;
uniform float uTime;
uniform float uNight;
uniform float uDesat;
uniform float uWet;
uniform float uSnow;
${GLSL_COMMON}
vec3 g_extra = vec3(0.0);
`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 wp = vWPos.xz;
  float h = vWPos.y;
  float slope = 1.0 - clamp(vWNormal.y, 0.0, 1.0);
  float n1 = m_fbm(wp * 0.0035);
  float n2 = m_fbm(wp * 0.021 + 7.0);
  float n3 = m_vnoise(wp * 0.35);
  float n4 = m_vnoise(wp * 1.7);
  vec3 grassA = m_srgb(vec3(0.345, 0.395, 0.22));
  vec3 grassDry = m_srgb(vec3(0.48, 0.46, 0.3));
  vec3 grassLush = m_srgb(vec3(0.27, 0.335, 0.175));
  vec3 col = mix(grassA, grassDry, smoothstep(0.42, 0.75, n1));
  col = mix(col, grassLush, smoothstep(0.45, 0.8, n2) * 0.7);
  col *= 0.88 + 0.16 * n3 + 0.06 * n4;
  // Fine grass grain up close (fades out before it can shimmer).
  float grainFade = 1.0 - smoothstep(0.05, 0.25, fwidth(wp.x));
  col *= 1.0 + (m_vnoise(wp * 7.0) - 0.5) * 0.14 * grainFade + (m_hash12(floor(wp * 9.0)) - 0.5) * 0.06 * grainFade;
  vec3 dirt = m_srgb(vec3(0.46, 0.4, 0.31));
  col = mix(col, dirt, smoothstep(0.62, 0.8, n2 * 0.6 + n1 * 0.5) * 0.45);
  vec3 rock = m_srgb(vec3(0.5, 0.49, 0.47)) * (0.85 + 0.3 * n2);
  col = mix(col, rock, smoothstep(0.28, 0.5, slope + (n2 - 0.5) * 0.15));
  vec3 sand = m_srgb(vec3(0.78, 0.72, 0.56)) * (0.92 + 0.12 * n3);
  col = mix(col, sand, 1.0 - smoothstep(1.0, 2.6, h + (n2 - 0.5) * 1.4));
  col = mix(col, sand * 0.62, 1.0 - smoothstep(-0.6, 0.4, h));
  col = mix(col, m_srgb(vec3(0.3, 0.33, 0.3)) * 0.7, 1.0 - smoothstep(-6.0, -1.5, h));
  // Freshly moved earth: bare soil that grass reclaims in patches.
  {
    vec2 suv = (wp / ${HM_STEP.toFixed(1)} + 0.5) / ${HM_RES.toFixed(1)};
    float soil = texture2D(uSoilTex, suv).r;
    if (soil > 0.003) {
      vec3 earth = mix(m_srgb(vec3(0.43, 0.34, 0.24)), m_srgb(vec3(0.36, 0.3, 0.23)), n3) * (0.86 + 0.2 * n4);
      float tufts = n4 * 0.55 + n3 * 0.45;
      float bare = smoothstep(0.0, 0.35, soil - tufts * (1.0 - soil) * 0.9);
      col = mix(col, earth, bare * smoothstep(0.4, 1.6, h) * 0.92);
    }
  }

  col *= 1.0 - 0.22 * uWet;
  if (uSnow > 0.01) {
    float flat2 = smoothstep(0.55, 0.85, vWNormal.y);
    float drift = smoothstep(0.2, 0.8, uSnow * 1.15 + (n3 - 0.5) * 0.5 + (n4 - 0.5) * 0.2);
    col = mix(col, m_srgb(vec3(0.8, 0.82, 0.87)) * (0.93 + 0.07 * n4), drift * flat2 * step(1.2, h));
  }
  vec2 uv = wp / ${WORLD_SIZE.toFixed(1)};
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  if (uOuter > 0.5 || inside < 0.5) {
    col = m_desat(col, 0.25) * 0.86;
  } else {
    // Zoning
    vec4 z = texture2D(uZoneTex, uv);
    float zonable = texture2D(uZonableTex, uv).r;
    vec2 cell = fract(wp / 4.0);
    float gl = 1.0 - smoothstep(0.0, 0.07, min(min(cell.x, 1.0 - cell.x), min(cell.y, 1.0 - cell.y)));
    col = mix(col, vec3(1.0), zonable * uZonableOpacity * (0.12 + gl * 0.45));
    // Outside the zoning tool, zoned-but-empty land shows as soft diagonal hatching.
    float hatch = step(0.55, fract((wp.x + wp.y) / 6.0));
    float za = z.a * uZoneOpacity * mix(0.35 + hatch * 1.4, 1.0, uZonableOpacity);
    col = mix(col, z.rgb, za * (0.75 + gl * 0.25 * uZonableOpacity));
    g_extra += z.rgb * za * 0.06 * uZonableOpacity;
    // Data overlay
    vec4 o = texture2D(uOverlayTex, uv);
    col = mix(col, m_desat(col, 0.85) * 0.8, uDesat);
    col = mix(col, o.rgb, o.a * uOverlayOpacity);
    g_extra += o.rgb * o.a * uOverlayOpacity * 0.25 * (0.4 + uNight);
    // Map boundary
    float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)) * ${WORLD_SIZE.toFixed(1)};
    float line = (1.0 - smoothstep(0.0, 3.0, edge)) * uGridOpacity;
    col = mix(col, vec3(1.0, 0.85, 0.5), line);
    // Land the city doesn't own is dimmed; parcels it can buy next get a faint blue edge.
    if (uLandOn > 0.5) {
      vec4 lt = texture2D(uLandTex, uv);
      if (lt.r < 0.5) {
        col = m_desat(col, 0.45) * mix(0.5, 0.68, lt.g);
        vec2 f = fract(uv * ${LAND_TILES.toFixed(1)});
        float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * ${LAND_TILE.toFixed(1)};
        float dash = step(0.5, fract((wp.x + wp.y) / 24.0));
        float border = (1.0 - smoothstep(1.5, 4.0, e)) * lt.g * (0.45 + 0.4 * dash);
        col = mix(col, vec3(0.36, 0.56, 0.98), border);
      }
    }
  }
  // Brush & coverage rings
  if (uBrush.w > 0.0) {
    float d = distance(wp, uBrush.xy);
    float r = uBrush.z;
    float ring = smoothstep(r - 1.8, r - 0.4, d) * (1.0 - smoothstep(r - 0.4, r + 0.8, d));
    float fill = (1.0 - step(r, d)) * 0.14;
    col = mix(col, uBrushColor, (ring * 0.9 + fill) * uBrush.w);
    g_extra += uBrushColor * ring * 0.35 * uBrush.w;
  }
  if (uRing.w > 0.0) {
    float d = distance(wp, uRing.xy);
    float r = uRing.z;
    float ring = smoothstep(r - 4.0, r - 1.0, d) * (1.0 - smoothstep(r - 1.0, r + 2.0, d));
    float fill = (1.0 - smoothstep(r * 0.6, r, d)) * 0.08 + (1.0 - step(r, d)) * 0.06;
    float dash = step(0.5, fract(atan(wp.y - uRing.y, wp.x - uRing.x) * 18.0 / 6.2831));
    col = mix(col, uRingColor, (ring * (0.5 + 0.5 * dash) + fill) * uRing.w);
    g_extra += uRingColor * ring * 0.3 * uRing.w;
  }
  diffuseColor.rgb = col * m_cloudShade(wp);
}
`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += g_extra;');
  });
}
