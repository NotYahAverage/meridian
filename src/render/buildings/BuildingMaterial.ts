import * as THREE from 'three';
import { GLSL_COMMON, globalUniforms, patchMaterial } from '../shared';
import { P } from './BuildingKit';

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
`;

const VERT_STATE = /* glsl */ `
{
  vec2 st = vec2(mod(aMeta.x, uStateSize), floor(aMeta.x / uStateSize));
  vState = aMeta.x < 0.0 ? vec4(1.0, 0.0, 0.0, 0.0) : texture2D(uState, (st + 0.5) / uStateSize);
  float prog = vState.r;
  vRelY = transformed.y - aMeta.y;
  if (prog < 0.999) transformed.y = aMeta.y + (transformed.y - aMeta.y) * max(prog, 0.03);
  vFac = aFac;
  vPat = aPat;
}
`;

const p = (k: keyof typeof P) => `${P[k]}`;

const FRAG = /* glsl */ `
float b_rough = 0.85;
float b_metal = 0.0;
vec3 b_emis = vec3(0.0);

float resLit(float h) {
  return 0.12 + 0.55 * smoothstep(17.0, 19.5, h) * (1.0 - smoothstep(22.5, 24.5, h)) + 0.25 * smoothstep(5.5, 6.5, h) * (1.0 - smoothstep(7.5, 8.5, h));
}
float officeLit(float h) {
  return 0.12 + 0.7 * smoothstep(6.5, 8.0, h) * (1.0 - smoothstep(18.0, 21.0, h));
}

// Punched windows in a facade cell; returns glass mask, sets frame mask.
float punched(vec2 lc, out float frame) {
  float win = step(0.24, lc.x) * step(lc.x, 0.76) * step(0.3, lc.y) * step(lc.y, 0.84);
  float inner = step(0.265, lc.x) * step(lc.x, 0.735) * step(0.325, lc.y) * step(lc.y, 0.815);
  frame = win - inner;
  return inner;
}

void applyPattern(inout vec3 col, vec3 base, float isWall) {
  int pid = int(vPat.x + 0.5);
  // Pattern parameters are per-face constants; round away interpolation error
  // (hashes below would otherwise turn it into per-pixel noise).
  vec4 pat = floor(vPat + 0.5);
  float fh = max(pat.y / 10.0, 0.3);
  float bay = max(pat.z / 10.0, 0.3);
  float seed = pat.w;
  vec2 f = vFac;
  float n = m_vnoise(vWPos.xz * 0.7 + vWPos.y * 0.37);
  float nf = m_vnoise(vWPos.xz * 4.0 + vWPos.y * 2.3);
  float night = smoothstep(0.15, 0.85, uNight);
  bool abandoned = mod(floor(vState.b * 255.0 + 0.5), 2.0) > 0.5;
  bool burning = mod(floor(vState.b * 255.0 / 2.0 + 0.01), 2.0) > 0.5;
  col = base * (0.94 + 0.08 * n);
  b_rough = 0.85;
  float glass = 0.0;
  float frame = 0.0;
  float litF = resLit(uHour);
  vec3 lightCol = vec3(1.0, 0.72, 0.42);
  vec2 cell = vec2(floor(f.x), floor(f.y / fh));
  vec2 lc = vec2(fract(f.x), fract(f.y / fh));

  if (pid == ${p('RES')} || pid == ${p('BRICK')}) {
    if (pid == ${p('BRICK')}) {
      float um = f.x * bay;
      float row = floor(f.y / 0.075);
      float bx = fract((um + mod(row, 2.0) * 0.12) / 0.24);
      float mortar = max(step(fract(f.y / 0.075), 0.14), step(bx, 0.05));
      vec3 brick = base * (0.82 + 0.3 * m_hash12(vec2(floor((um + mod(row, 2.0) * 0.12) / 0.24), row) + seed));
      vec3 mortarCol = m_srgb(vec3(0.72, 0.7, 0.66));
      vec3 detailed = mix(brick, mortarCol, mortar * 0.85);
      // Fade individual bricks to their average once a course is under ~2 px.
      float course = fwidth(f.y) / 0.075;
      vec3 average = mix(base * 0.97, mortarCol, 0.16);
      col = mix(detailed, average, smoothstep(0.3, 0.75, course));
    }
    glass = punched(lc, frame);
    float slab = step(lc.y, 0.035) * isWall;
    col *= 1.0 - slab * 0.18;
  } else if (pid == ${p('OFFICE')}) {
    glass = step(0.3, lc.y) * step(lc.y, 0.93) * step(0.035, lc.x);
    frame = step(0.3, lc.y) * step(lc.y, 0.93) * (1.0 - step(0.035, lc.x));
    litF = officeLit(uHour);
    lightCol = vec3(0.86, 0.92, 1.0);
  } else if (pid == ${p('GLASS')}) {
    glass = step(0.045, lc.x) * step(0.06, lc.y);
    frame = 1.0 - glass;
    litF = officeLit(uHour);
    lightCol = vec3(0.84, 0.9, 1.0);
  } else if (pid == ${p('STORE')}) {
    if (f.y < fh) {
      glass = step(0.06, lc.x) * step(lc.x, 0.94) * step(0.4, f.y) * step(f.y, fh * 0.76);
      frame = step(0.04, lc.x) * step(lc.x, 0.96) * step(0.3, f.y) * step(f.y, fh * 0.8) - glass;
      litF = 0.95;
      lightCol = vec3(1.0, 0.86, 0.62);
      // Shop interiors are visible through the glass by day as well.
      b_emis += glass * m_srgb(vec3(0.95, 0.85, 0.7)) * 0.08;
    } else {
      float uf = 3.1;
      vec2 lc2 = vec2(fract(f.x), fract((f.y - fh) / uf));
      cell = vec2(floor(f.x), floor((f.y - fh) / uf) + 1.0);
      glass = punched(lc2, frame);
    }
  } else if (pid == ${p('INDUSTRIAL')}) {
    float um = f.x * bay;
    col *= 0.9 + 0.1 * (0.5 + 0.5 * sin(um * 20.94));
    col *= 1.0 - 0.08 * step(fract(f.y / 2.6), 0.02);
    float band = step(fh - 2.6, f.y) * step(f.y, fh - 1.4) * step(0.12, lc.x) * step(lc.x, 0.88);
    glass = band;
    litF = 0.45;
    lightCol = vec3(1.0, 0.9, 0.7);
    b_rough = 0.6;
    b_metal = 0.25;
  } else if (pid == ${p('ROOF_FLAT')}) {
    col = base * (0.86 + 0.14 * n + 0.06 * nf);
    col *= 1.0 - 0.06 * step(fract(f.x / 6.0), 0.015) - 0.06 * step(fract(f.y / 6.0), 0.015);
    b_rough = 0.93;
  } else if (pid == ${p('ROOF_TILE')}) {
    float row = floor(f.y / 0.33);
    float tile = m_hash12(vec2(floor(f.x / 0.42 + mod(row, 2.0) * 0.5), row) + seed);
    col = base * (0.84 + 0.22 * tile) * (1.0 - 0.22 * step(fract(f.y / 0.33), 0.12));
    b_rough = 0.78;
  } else if (pid == ${p('PARKING')}) {
    col = base * (0.85 + 0.15 * n + 0.08 * nf);
    float zz = mod(f.y - fh, 16.4);
    float inRow = step(zz, 5.2) + step(11.2, zz);
    float line = step(fract((f.x - bay) / 2.6), 0.035) * inRow;
    col = mix(col, vec3(0.85), line * 0.85);
    b_rough = 0.9;
  } else if (pid == ${p('GRASS')}) {
    col = base * (0.78 + 0.32 * n + 0.1 * nf);
    col *= 0.97 + 0.05 * step(0.5, fract(f.x / 3.2));
    b_rough = 0.97;
  } else if (pid == ${p('PAVING')}) {
    col = base * (0.88 + 0.12 * n);
    vec2 t = fract(f / 1.5);
    col *= 1.0 - 0.12 * (step(t.x, 0.03) + step(t.y, 0.03));
    b_rough = 0.88;
  } else if (pid == ${p('DOOR')}) {
    col = base * (0.88 + 0.12 * step(0.5, fract(f.y / 0.3)));
    b_metal = 0.3;
    b_rough = 0.5;
  } else if (pid == ${p('FIELD')}) {
    vec2 q = f * vec2(fh * 10.0, bay * 10.0);
    vec2 dim = vec2(fh * 10.0, bay * 10.0);
    col = base * (0.86 + 0.14 * n) * (0.95 + 0.07 * step(0.5, fract(q.x / 5.0)));
    float l = 0.0;
    l += step(abs(q.x - 1.5), 0.07) + step(abs(q.x - (dim.x - 1.5)), 0.07);
    l += step(abs(q.y - 1.5), 0.07) + step(abs(q.y - (dim.y - 1.5)), 0.07);
    l += step(abs(q.x - dim.x * 0.5), 0.07);
    l += step(abs(length(q - dim * 0.5) - min(dim.x, dim.y) * 0.16), 0.08);
    float inside = step(1.4, q.x) * step(q.x, dim.x - 1.4) * step(1.4, q.y) * step(q.y, dim.y - 1.4);
    col = mix(col, vec3(0.92), min(1.0, l) * inside);
    b_rough = 0.95;
  } else if (pid == ${p('TRACK')}) {
    vec2 q = f * vec2(fh * 10.0, bay * 10.0);
    vec2 dim = vec2(fh * 10.0, bay * 10.0);
    float dd = min(min(q.x, dim.x - q.x), min(q.y, dim.y - q.y));
    col = base * (0.9 + 0.1 * n);
    col = mix(col, vec3(0.9), step(fract(dd / 1.22), 0.05) * step(dd, 5.0));
    b_rough = 0.9;
  } else if (pid == ${p('SOLAR')}) {
    vec2 t = fract(f / vec2(1.0, 0.95));
    float fr = step(t.x, 0.05) + step(t.y, 0.05);
    col = mix(base * (0.9 + 0.2 * nf), m_srgb(vec3(0.75, 0.77, 0.8)), min(1.0, fr));
    b_metal = 0.6;
    b_rough = 0.22;
  } else if (pid == ${p('WATER')}) {
    float w = m_vnoise(vWPos.xz * 0.6 + uTime * 0.4) * 0.5 + m_vnoise(vWPos.xz * 1.7 - uTime * 0.6) * 0.5;
    col = base * (0.8 + 0.3 * w);
    b_rough = 0.06;
    b_metal = 0.25;
  } else if (pid == ${p('DIRT')}) {
    col = base * (0.72 + 0.4 * n + 0.15 * nf);
    b_rough = 1.0;
  } else if (pid == ${p('SIGN')}) {
    col = base;
    b_emis += base * (0.18 + 2.4 * night);
    b_rough = 0.4;
  } else if (pid == ${p('GLASS_PLAIN')}) {
    col = base * 0.6;
    b_rough = 0.1;
    b_metal = 0.6;
  } else if (pid == ${p('CONCRETE')}) {
    float um = f.x * bay;
    col = base * (0.88 + 0.12 * n + 0.05 * nf);
    col *= 1.0 - 0.08 * (step(fract(um / 3.0), 0.012) + step(fract(f.y / 3.0), 0.012));
    col *= 0.85 + 0.15 * smoothstep(0.0, 1.2, vRelY);
    b_rough = 0.9;
  } else if (pid == ${p('METAL')}) {
    col = base * (0.9 + 0.1 * n);
    b_metal = 0.55;
    b_rough = 0.42;
  }

  if (glass > 0.0 || frame > 0.0) {
    float h = m_hash12(cell + vec2(seed * 0.37, seed * 1.31));
    bool curtainWall = pid == ${p('GLASS')} || pid == ${p('OFFICE')};
    // Glass picks up a little sky colour toward the top of each pane.
    vec3 gcol = m_srgb(vec3(0.24, 0.29, 0.35)) * (curtainWall ? 0.92 + 0.16 * h : 0.8 + 0.4 * h);
    if (curtainWall) gcol = mix(gcol, base * 0.7, 0.4);
    float curtain = curtainWall ? 0.0 : step(0.74, h) * 0.32;
    gcol = mix(gcol, m_srgb(vec3(0.78, 0.74, 0.66)), curtain);
    vec3 fcol = pid == ${p('GLASS')} ? m_srgb(vec3(0.32, 0.34, 0.36)) : m_srgb(vec3(0.86, 0.85, 0.82));
    if (abandoned) gcol = m_srgb(vec3(0.16, 0.12, 0.09));
    col = mix(col, gcol, glass);
    col = mix(col, fcol, frame);
    b_rough = mix(b_rough, 0.08, glass);
    b_metal = mix(b_metal, 0.62, glass);
    // Offices light up in floor sections rather than random single panes.
    float hl = curtainWall ? m_hash12(vec2(floor(cell.x / 6.0), cell.y) + seed * 0.73) : h;
    float on = step(hl, litF) * (abandoned ? 0.0 : 1.0);
    vec3 lc3 = lightCol * (0.65 + 0.7 * m_hash12(cell.yx + seed));
    // Curtain walls are mostly glass, so each lit cell glows more softly.
    b_emis += glass * on * night * lc3 * (curtainWall ? 0.45 : 1.25);
    if (burning) b_emis += glass * vec3(1.0, 0.36, 0.06) * (0.7 + 0.5 * sin(uTime * 17.0 + cell.x * 3.1 + cell.y)) * 1.6;
  }

  // Weather: snow settles on roofs and open ground; rain darkens surfaces.
  if (uSnow > 0.01 && pid != ${p('GLASS')} && pid != ${p('SOLAR')} && pid != ${p('WATER')} && pid != ${p('SIGN')} && pid != ${p('GLASS_PLAIN')}) {
    float up = smoothstep(0.6, 0.9, vWNormal.y);
    float cover = up * smoothstep(0.2, 0.7, uSnow * (0.85 + 0.3 * n));
    col = mix(col, m_srgb(vec3(0.8, 0.82, 0.87)) * (0.94 + 0.06 * nf), cover);
    b_rough = mix(b_rough, 0.8, cover);
  }
  if (uWet > 0.01) {
    float up = smoothstep(0.6, 0.9, vWNormal.y);
    col *= 1.0 - uWet * mix(0.08, 0.25, up);
    b_rough = mix(b_rough, min(b_rough, 0.35), uWet * up);
  }
  // Grounding: walls darken toward the ground (cheap ambient occlusion).
  col *= mix(1.0, 0.72 + 0.28 * smoothstep(0.0, 2.2, vRelY), isWall);

  // Construction: bare concrete frame, slabs and safety netting.
  float prog = vState.r;
  if (prog < 0.999) {
    if (pid == ${p('GRASS')} || pid == ${p('PAVING')} || pid == ${p('PARKING')}) {
      col = m_srgb(vec3(0.52, 0.45, 0.36)) * (0.8 + 0.3 * n);
    } else if (pid != ${p('SIGN')}) {
      float slab = step(fract(vRelY / 3.2), 0.12);
      float post = step(fract(f.x * 2.0), 0.08);
      vec3 net = m_srgb(vec3(0.42, 0.5, 0.56));
      vec3 conc = m_srgb(vec3(0.7, 0.69, 0.66));
      col = mix(net * (0.8 + 0.2 * nf), conc, min(1.0, slab + post));
      b_emis = vec3(0.0);
      b_metal = 0.0;
      b_rough = 0.9;
    }
  }
  if (abandoned) {
    col = m_desat(col, 0.65) * 0.6;
    b_emis *= 0.0;
    b_rough = 0.95;
  }
  if (burning) col *= 0.35;
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
uniform float uTime;
uniform float uNight;
uniform float uHour;
uniform float uDesat;
uniform float uWet;
uniform float uSnow;
uniform float uBldOverlay;
uniform float uGhost;
uniform vec3 uGhostColor;
${GLSL_COMMON}
${FRAG}
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
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += b_emis;');
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
