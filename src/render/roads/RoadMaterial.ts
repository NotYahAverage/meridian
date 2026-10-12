import * as THREE from 'three';
import { ROAD_TYPE_LIST } from '../../sim/roads/RoadTypes';
import { GLSL_COMMON, globalUniforms, patchMaterial } from '../shared';

export interface RoadUniforms {
  uSegTex: { value: THREE.DataTexture };
  uSegTexSize: { value: number };
  uTrafficOverlay: { value: number };
  uGhost: { value: number };
  uGhostColor: { value: THREE.Color };
}

const f = (v: number) => v.toFixed(3);
const PARAMS = ROAD_TYPE_LIST.map((t) => `if (t == ${ROAD_TYPE_LIST.indexOf(t)}) { med = ${f(t.median / 2)}; lw = ${f(t.laneWidth)}; lanes = ${t.lanes}.0; ah = ${f(t.asphaltHalf)}; lstep = ${t.freeway ? '46.0' : '34.0'}; mk = ${t.markings}; edg = ${t.edgeLines ? '1.0' : '0.0'}; lmp = ${t.lamps === 'one' ? 0 : t.lamps === 'both' ? 1 : 2}; }`).join('\n  else ');

/** Road surface shader: asphalt, markings, crosswalks, sidewalks, lamp pools and overlays. */
export function createRoadMaterial(u: RoadUniforms, ghost = false): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.88,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    transparent: ghost,
    opacity: ghost ? 0.82 : 1,
    depthWrite: !ghost,
  });
  return patchMaterial(mat, ghost ? 'road-ghost' : 'road', (shader) => {
    Object.assign(shader.uniforms, u, globalUniforms, { uGhost: { value: ghost ? 1 : 0 } });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aRoad;
attribute vec4 aSurf;
attribute float aSlot;
uniform sampler2D uSegTex;
uniform float uSegTexSize;
varying vec2 vRoad;
varying vec4 vSurf;
varying vec4 vSeg;
varying vec3 vWPos;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vRoad = aRoad;
vSurf = aSurf;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vSeg = vec4(0.0);
if (aSlot >= 0.0) {
  float sx = mod(aSlot, uSegTexSize);
  float sy = floor(aSlot / uSegTexSize);
  vSeg = texture2D(uSegTex, (vec2(sx, sy) + 0.5) / uSegTexSize);
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vRoad;
varying vec4 vSurf;
varying vec4 vSeg;
varying vec3 vWPos;
uniform float uTrafficOverlay;
uniform float uGhost;
uniform vec3 uGhostColor;
uniform float uNight;
uniform float uDesat;
uniform float uWet;
uniform float uSnow;
${GLSL_COMMON}
float r_rough = 0.88;
vec3 r_emis = vec3(0.0);
float r_sheen = 0.0;
float band(float x, float c, float w) { return 1.0 - smoothstep(w * 0.5, w * 0.5 + 0.035, abs(x - c)); }
// Antialiased 50% stripes (crosswalks); fades to grey once stripes are sub-pixel.
float stripes(float x) {
  float fw = max(fwidth(x), 1e-4);
  float f = fract(x);
  float a = smoothstep(-fw, fw, f) - smoothstep(0.5 - fw, 0.5 + fw, f) + smoothstep(1.0 - fw, 1.0 + fw, f);
  return mix(a, 0.5, smoothstep(0.2, 0.45, fw));
}
`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  int kind = int(vSurf.x + 0.5);
  int t = int(vSurf.y + 0.5);
  float flags = floor(vSurf.z + 0.5);
  float len = vSurf.w;
  float u = vRoad.x;
  float v = vRoad.y;
  float med = 0.0, lw = 3.5, lanes = 1.0, ah = 4.5, lstep = 34.0, edg = 0.0;
  int mk = 0, lmp = 0;
  ${PARAMS}
  float n = m_vnoise(vWPos.xz * 1.7);
  float n2 = m_vnoise(vWPos.xz * 0.09);
  float n3 = m_vnoise(vWPos.xz * 6.0);
  vec3 col;
  float lampable = 0.0;
  if (kind == 0 || kind == 4) {
    // Weathered asphalt: warm grey, lighter where it has aged, patched repairs and fine aggregate.
    vec3 asph = m_srgb(vec3(0.3, 0.297, 0.29)) * (0.82 + 0.16 * n + 0.14 * n2 + 0.06 * n3);
    float age = smoothstep(0.35, 0.8, m_vnoise(vWPos.xz * 0.023 + 3.1));
    asph = mix(asph, asph * vec3(1.1, 1.08, 1.05), age * 0.6);
    vec2 pc = floor(vec2(u / 2.6, v / 5.5));
    float ph = m_hash12(pc + floor(vWPos.xz / 400.0));
    vec2 pf = fract(vec2(u / 2.6, v / 5.5));
    float patchM = step(0.93, ph) * step(0.12, pf.x) * step(pf.x, 0.88) * step(0.1, pf.y) * step(pf.y, 0.9);
    asph = mix(asph, asph * 0.8, patchM * (1.0 - smoothstep(0.25, 0.6, fwidth(v))));
    float grain = m_hash12(floor(vWPos.xz * 22.0));
    asph *= 1.0 + (grain - 0.5) * 0.12 * (1.0 - smoothstep(0.02, 0.08, fwidth(vWPos.x)));
    float mark = 0.0;
    vec3 mc = vec3(0.92);
    bool ow = mod(floor(flags / 4.0), 2.0) > 0.5;
    if (kind == 0 && ow) {
      // One-way: lanes span the whole carriageway, with arrows painted in each lane.
      float n2l = lanes * 2.0;
      float x = u + n2l * lw * 0.5;
      float lf = fract(max(x, 0.0) / lw);
      asph *= 0.965 + 0.035 * cos(lf * 12.566);
      for (int k = 1; k < 4; k++) {
        if (float(k) >= n2l) break;
        mark = max(mark, band(x, float(k) * lw, 0.13) * step(fract(v / 9.0), 0.36));
      }
      if (edg > 0.5) mark = max(mark, band(abs(u), n2l * lw * 0.5 + 0.12, 0.13));
      float dir = mod(floor(flags / 8.0), 2.0) > 0.5 ? -1.0 : 1.0;
      float du = (lf - 0.5) * lw;
      float cell = mod(v - 14.0, 28.0) - 14.0;
      float dv = cell * dir;
      float shaft = step(abs(du), 0.13) * step(-2.4, dv) * step(dv, 0.5);
      float head = step(0.5, dv) * step(dv, 2.2) * step(abs(du), (2.2 - dv) * 0.42);
      if (v > 9.0 && v < len - 9.0) mark = max(mark, max(shaft, head));
    }
    if (kind == 0 && !ow) {
      float a = abs(u) - med;
      float lf = fract(max(a, 0.0) / lw);
      // Wheel tracks: darker paths worn into each lane.
      asph *= 0.955 + 0.045 * cos(lf * 12.566);
      // Lane separators (dashed), centre line, edge lines.
      for (int k = 1; k < 3; k++) {
        if (float(k) >= lanes) break;
        mark = max(mark, band(a, float(k) * lw, 0.13) * step(fract(v / 9.0), 0.36));
      }
      if (mk == 0) mark = max(mark, band(abs(u), 0.0, 0.13) * step(fract(v / 9.0), 0.4));
      if (mk == 1) {
        float y = band(abs(u), 0.17, 0.11);
        if (y > 0.0) { mark = max(mark, y); mc = m_srgb(vec3(0.93, 0.76, 0.22)); }
      }
      if (mk == 2 && a > -0.01 && a < 0.4) {
        float y = band(a, 0.15, 0.13);
        if (y > 0.0) { mark = max(mark, y); mc = m_srgb(vec3(0.93, 0.76, 0.22)); }
      }
      if (edg > 0.5) mark = max(mark, band(a, lanes * lw + 0.12, 0.13));
    }
    if (kind == 0) {
      // Crosswalks and stop lines near junctions.
      bool cs = mod(flags, 2.0) > 0.5;
      bool ce = mod(floor(flags / 2.0), 2.0) > 0.5;
      float ax = abs(u);
      float zebra = stripes(u / 1.1 + 0.5);
      if (cs && v > 0.5 && v < 3.6 && ax < ah - 0.4) mark = max(mark, zebra);
      if (ce && v > len - 3.6 && v < len - 0.5 && ax < ah - 0.4) mark = max(mark, zebra);
      if (ow) {
        // One-way: a full-width stop line where traffic arrives.
        bool rev = mod(floor(flags / 8.0), 2.0) > 0.5;
        if (rev && cs && v > 3.9 && v < 4.35 && ax < ah - 0.3) mark = 1.0;
        if (!rev && ce && v > len - 4.35 && v < len - 3.9 && ax < ah - 0.3) mark = 1.0;
      } else {
        if (cs && v > 3.9 && v < 4.35 && u < -med && ax < ah - 0.3) mark = 1.0;
        if (ce && v > len - 4.35 && v < len - 3.9 && u > med && ax < ah - 0.3) mark = 1.0;
      }
      mark *= 0.75 + 0.25 * n3;
    }
    col = mix(asph, mc, mark);
    r_rough = mix(0.9, 0.6, mark);
    lampable = 1.0;
  } else if (kind == 1) {
    vec3 c = m_srgb(vec3(0.66, 0.645, 0.615)) * (0.88 + 0.12 * n + 0.05 * n3);
    float j = 1.0 - smoothstep(0.0, 0.04, abs(fract(v / 1.8) - 0.5) - 0.46);
    // Slab-to-slab tone and a little grime along the joints.
    float slab = m_hash12(vec2(floor(v / 1.8), floor(u / 1.6)));
    col = c * (0.95 + 0.08 * slab) * (1.0 - j * 0.25);
    r_rough = 0.92;
    lampable = 1.0;
  } else if (kind == 2) {
    col = m_srgb(vec3(0.74, 0.73, 0.7)) * (0.92 + 0.1 * n);
    r_rough = 0.85;
    lampable = 1.0;
  } else if (kind == 3) {
    col = m_srgb(vec3(0.33, 0.39, 0.21)) * (0.82 + 0.3 * n + 0.1 * n3);
    r_rough = 0.95;
  } else if (kind == 5) {
    col = m_srgb(vec3(0.66, 0.65, 0.62)) * (0.9 + 0.1 * n);
    r_rough = 0.8;
  } else {
    col = m_srgb(vec3(0.345, 0.395, 0.22)) * (0.85 + 0.2 * n);
    r_rough = 0.95;
  }
  // Weather: wet surfaces darken and turn glossy (with puddles); snow settles
  // on verges and sidewalks and in the margins of the carriageway.
  if (uWet > 0.01) {
    float hard = (kind == 3 || kind == 6) ? 0.35 : 1.0;
    float w = uWet * hard;
    col *= 1.0 - 0.36 * w;
    r_rough = mix(r_rough, 0.22 + 0.2 * n, w * 0.85);
    r_sheen = w * (kind == 0 || kind == 4 ? 0.55 : 0.3);
    if (kind == 0) {
      float pud = smoothstep(0.6, 0.72, m_vnoise(vWPos.xz * 0.28) * 0.7 + n2 * 0.4) * w;
      col *= 1.0 - 0.18 * pud;
      r_rough = mix(r_rough, 0.03, pud);
      r_sheen = max(r_sheen, pud);
    }
  }
  if (uSnow > 0.01) {
    float cover = kind == 0 ? 0.18 + 0.7 * smoothstep(ah - 2.6, ah - 0.4, abs(u)) : kind == 1 || kind == 2 || kind == 5 ? 0.75 : 1.0;
    cover *= smoothstep(0.25, 0.75, uSnow * (0.8 + 0.4 * n));
    col = mix(col, m_srgb(vec3(0.8, 0.82, 0.87)) * (0.92 + 0.08 * n3), clamp(cover, 0.0, 1.0));
    r_rough = mix(r_rough, 0.8, cover);
    r_sheen *= 1.0 - cover;
  }
  // Street-lamp light pools at night (lamps sit at known intervals along v).
  if (lampable > 0.5 && uNight > 0.01 && len > 0.0 && lmp < 2) {
    float k = floor((v - 10.0) / lstep + 0.5);
    float lv = 10.0 + k * lstep;
    float dv = v - lv;
    float pool = 0.0;
    float sd = (lmp == 0) ? (mod(k, 2.0) < 0.5 ? 1.0 : -1.0) : 1.0;
    float lu = sd * (ah - 1.6);
    pool += exp(-(dv * dv + (u - lu) * (u - lu) * 1.4) / 70.0);
    if (lmp > 0) pool += exp(-(dv * dv + (u + lu) * (u + lu) * 1.4) / 70.0);
    if (lv > 0.0 && lv < len) r_emis += m_srgb(vec3(1.0, 0.78, 0.5)) * pool * uNight * 0.5 * col * 3.0;
  }
  col = mix(col, m_desat(col, 0.8) * 0.85, uDesat);
  // Traffic overlay and highlights.
  if (uTrafficOverlay > 0.5 && (kind == 0)) {
    float r = vSeg.r * 2.0;
    vec3 ramp = mix(vec3(0.15, 0.8, 0.35), vec3(0.98, 0.85, 0.2), smoothstep(0.25, 0.75, r));
    ramp = mix(ramp, vec3(0.95, 0.35, 0.12), smoothstep(0.75, 1.0, r));
    ramp = mix(ramp, vec3(0.85, 0.08, 0.1), smoothstep(1.0, 1.4, r));
    col = mix(col, m_srgb(ramp), 0.82);
    r_emis += m_srgb(ramp) * 0.25;
  }
  float hl = floor(vSeg.g * 255.0 + 0.5);
  if (hl > 0.5) {
    vec3 hc = hl < 1.5 ? vec3(1.0) : hl < 2.5 ? vec3(0.35, 0.95, 0.8) : hl < 3.5 ? vec3(1.0, 0.18, 0.15) : vec3(1.0, 0.72, 0.2);
    col = mix(col, hc, hl < 1.5 ? 0.18 : 0.5);
    r_emis += hc * (hl < 1.5 ? 0.08 : 0.25);
  }
  if (uGhost > 0.5) {
    col = mix(col, uGhostColor, 0.45);
    r_emis += uGhostColor * 0.35;
  }
  diffuseColor.rgb = col * m_cloudShade(vWPos.xz);
}
`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = r_rough;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += r_emis;
#ifdef USE_FOG
if (r_sheen > 0.0) {
  // Wet surfaces mirror the sky at grazing angles.
  float cv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  totalEmissiveRadiance += fogColor * (0.04 + 0.96 * pow(1.0 - cv, 5.0)) * r_sheen;
}
#endif`,
      );
  });
}
