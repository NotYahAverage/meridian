import * as THREE from 'three';
import { GLSL_COMMON, globalUniforms } from '../shared';

/** Joint heights of a body type (hip, knee, shoulder, elbow) and its neck. */
export interface Joints {
  hip: number;
  knee: number;
  shoulder: number;
  elbow: number;
  neck: number;
}

export const ADULT_JOINTS: Joints = { hip: 0.93, knee: 0.5, shoulder: 1.4, elbow: 1.13, neck: 1.54 };
export const CHILD_JOINTS: Joints = { hip: 0.93 * 0.74, knee: 0.5 * 0.74, shoulder: 1.4 * 0.74, elbow: 1.13 * 0.74, neck: 1.54 * 0.74 };
export const LO_JOINTS: Joints = { hip: 0.92, knee: 0.92, shoulder: 1.4, elbow: 1.4, neck: 1.5 };

/** Poses (per instance). */
export const POSE = { walk: 0, stand: 1, talk: 2, sit: 3 } as const;

/**
 * Per instance: aC0 = top colour, shoes (0 dark / 1 light) + lean (fraction)
 *               aC1 = bottom colour, option mask
 *               aC2 = skin colour, pose
 *               aC3 = hair colour, stride phase
 *               aC4 = accent colour, gait amplitude
 * Per vertex:   aSlot (colour), aLimb (what it moves with), aOpt (optional part, 0 = always)
 */
const ANIMATE = /* glsl */ `
attribute float aSlot;
attribute float aLimb;
attribute float aOpt;
attribute float aBlend;
attribute vec4 aC0;
attribute vec4 aC1;
attribute vec4 aC2;
attribute vec4 aC3;
attribute vec4 aC4;
uniform vec4 uJoints;
uniform float uNeck;
uniform float uTime;

void pSwing(inout vec3 p, inout vec3 n, float py, float a) {
  float c = cos(a), s = sin(a);
  vec2 d = vec2(p.x, p.y - py);
  p.xy = vec2(c * d.x - s * d.y, py + s * d.x + c * d.y);
  n.xy = vec2(c * n.x - s * n.y, s * n.x + c * n.y);
}

void pAnimate(inout vec3 p, inout vec3 n) {
  float opt = aOpt;
  if (opt > 0.5) {
    float bit = mod(floor(aC1.w / exp2(opt - 1.0) + 0.001), 2.0);
    if (bit < 0.5) { p = vec3(0.0); return; }
  }
  float hip = uJoints.x, knee = uJoints.y, shoulder = uJoints.z, elbow = uJoints.w;
  float pose = aC2.w;
  float ph = aC3.w;
  float amp = aC4.w;
  float lean = fract(aC0.w);
  bool umbrella = mod(floor(aC1.w / 64.0 + 0.001), 2.0) > 0.5;
  #ifdef USE_INSTANCING
  float seed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
  #else
  float seed = 0.0;
  #endif
  float t = uTime + seed * 40.0;
  float thL = 0.0, thR = 0.0, knL = 0.0, knR = 0.0;
  float uaL = 0.0, uaR = 0.0, faL = 0.12, faR = 0.12;
  float yaw = 0.0, drop = 0.0, bob = 0.0;
  float sw = sin(ph);
  if (pose < 0.5) {
    // Walking: legs swing from the hips with the knee bending through the swing, arms opposite.
    thL = 0.42 * amp * sw;
    thR = -thL;
    knL = -0.95 * amp * pow(max(0.0, sin(ph - 1.15)), 2.0);
    knR = -0.95 * amp * pow(max(0.0, sin(ph - 1.15 + 3.14159)), 2.0);
    uaL = -0.34 * amp * sw;
    uaR = -uaL;
    faL = 0.18 + 0.3 * amp * max(0.0, sw);
    faR = 0.18 + 0.3 * amp * max(0.0, -sw);
    bob = abs(cos(ph)) * 0.035 * amp;
    lean += 0.05 * amp;
  } else if (pose < 1.5) {
    // Standing: a little weight shift, and now and then a look around.
    float s = sin(t * 0.6);
    thL = 0.035 * s;
    thR = -0.02 * s;
    uaL = 0.04 * sin(t * 0.45);
    uaR = -0.035 * sin(t * 0.5);
    yaw = 0.45 * sin(t * 0.21) * smoothstep(0.55, 0.8, sin(t * 0.13));
  } else if (pose < 2.5) {
    // Talking: gesturing with one hand, nodding along.
    uaR = 0.3 + 0.14 * sin(t * 2.3);
    faR = 1.25 + 0.4 * sin(t * 3.7);
    uaL = 0.05 + 0.05 * sin(t * 1.7);
    faL = 0.2;
    yaw = 0.15 * sin(t * 1.1);
  } else {
    // Sitting on the grass, leaning back on the hands.
    drop = hip - 0.12 * hip / 0.93;
    thL = 1.5;
    thR = 1.45;
    knL = -0.35;
    knR = -0.1;
    uaL = -0.55;
    uaR = -0.55;
    faL = 0.0;
    faR = 0.0;
    lean -= 0.22;
  }
  if (umbrella && pose < 2.5) {
    // Holding the umbrella up.
    uaR = 0.5;
    faR = 1.35;
  }
  float L = aLimb;
  // Each vertex follows its limb, blending (by aBlend) toward the limb it hangs from, so
  // knees, elbows, hips and shoulders bend smoothly instead of coming apart.
  vec3 pp = p, np = n;
  if (abs(L - 3.0) < 0.5) { pSwing(p, n, knee, knL); pSwing(p, n, hip, thL); pSwing(pp, np, hip, thL); }
  else if (abs(L - 5.0) < 0.5) { pSwing(p, n, knee, knR); pSwing(p, n, hip, thR); pSwing(pp, np, hip, thR); }
  else if (abs(L - 2.0) < 0.5) pSwing(p, n, hip, thL);
  else if (abs(L - 4.0) < 0.5) pSwing(p, n, hip, thR);
  else if (abs(L - 7.0) < 0.5) { pSwing(p, n, elbow, faL); pSwing(p, n, shoulder, uaL); pSwing(pp, np, shoulder, uaL); }
  else if (abs(L - 9.0) < 0.5) { pSwing(p, n, elbow, faR); pSwing(p, n, shoulder, uaR); pSwing(pp, np, shoulder, uaR); }
  else if (abs(L - 6.0) < 0.5) pSwing(p, n, shoulder, uaL);
  else if (abs(L - 8.0) < 0.5) pSwing(p, n, shoulder, uaR);
  else if (abs(L - 1.0) < 0.5 && yaw != 0.0) {
    // Head turns.
    float c = cos(yaw), s = sin(yaw);
    p.xz = vec2(c * p.x - s * p.z, s * p.x + c * p.z);
    n.xz = vec2(c * n.x - s * n.z, s * n.x + c * n.z);
  }
  if (aBlend > 0.001) {
    p = mix(p, pp, aBlend);
    n = normalize(mix(n, np, aBlend));
  }
  // The upper body leans forward from the hips (everything that isn't a leg).
  if (L < 1.5 || L > 5.5) pSwing(p, n, hip, -lean);
  p.y += bob - drop;
}
`;

const VERTEX_COLOR = /* glsl */ `
float slot = aSlot;
// Sleeves are the top's colour, or bare arms when it's warm (mask bit 256).
float shortSleeves = mod(floor(aC1.w / 256.0 + 0.001), 2.0);
vPCol = slot < 0.5 ? aC0.rgb : slot < 1.5 ? aC1.rgb : slot < 2.5 ? aC2.rgb : slot < 3.5 ? aC3.rgb
  : slot < 4.5 ? mix(vec3(0.03), vec3(0.72), floor(aC0.w)) : slot < 5.5 ? aC4.rgb : slot < 6.5 ? vec3(0.02) : mix(aC0.rgb, aC2.rgb, shortSleeves);
vPRough = slot > 1.5 && slot < 2.5 ? 0.55 : slot > 2.5 && slot < 3.5 ? 0.85 : slot > 3.5 && slot < 4.5 ? 0.5 : 0.8;
`;

/** Lit material for one body type: limbs animated on the GPU, colours per person. */
export function createPeopleMaterial(j: Joints): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
  const uniforms = { uJoints: { value: new THREE.Vector4(j.hip, j.knee, j.shoulder, j.elbow) }, uNeck: { value: j.neck } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uTime: globalUniforms.uTime, uDesat: globalUniforms.uDesat });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${ANIMATE}\nvarying vec3 vPCol;\nvarying float vPRough;`)
      .replace('#include <beginnormal_vertex>', `vec3 pA = vec3(position);\nvec3 objectNormal = vec3(normal);\npAnimate(pA, objectNormal);\n${VERTEX_COLOR}`)
      .replace('#include <begin_vertex>', 'vec3 transformed = pA;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPCol;\nvarying float vPRough;\nuniform float uDesat;\n${GLSL_COMMON}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = m_desat(vPCol, uDesat * 0.8);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vPRough;');
  };
  mat.customProgramCacheKey = () => 'people';
  return mat;
}

/** Shadow-casting depth material with the same animation. */
export function createPeopleDepthMaterial(j: Joints): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  const uniforms = { uJoints: { value: new THREE.Vector4(j.hip, j.knee, j.shoulder, j.elbow) }, uNeck: { value: j.neck } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uTime: globalUniforms.uTime });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${ANIMATE}`)
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position);\nvec3 pN = vec3(0.0, 1.0, 0.0);\npAnimate(transformed, pN);');
  };
  mat.customProgramCacheKey = () => 'people-depth';
  return mat;
}
