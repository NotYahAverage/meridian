import { P } from './BuildingKit';

const p = (k: keyof typeof P) => `${P[k]}`;

/**
 * The facade and surface library of the building shader. Each surface carries
 * a pattern id and parameters (floor height, bay width, a per-building seed);
 * this code turns them into materials: render, brick, stone, panels, curtain
 * walls, roofs, paving and so on.
 *
 * Windows are drawn as recessed openings: the reveals throw the sun's shadow
 * onto the glass (through `b_dirShade`, which scales direct light only), the
 * recess is darker in sky light (`b_cavity`), and the glass reflects the sky
 * (`b_refl` boosts reflected environment light). Sills, lintels, frames,
 * mullions, curtains, blinds and rain streaks vary by building. Fine detail
 * fades to its average colour when it shrinks to a few pixels, so distant
 * facades don't shimmer.
 */
export const FACADE_GLSL = /* glsl */ `
float b_rough = 0.85;
float b_metal = 0.0;
vec3 b_emis = vec3(0.0);
/** Multiplier on reflected sky light (glass reflects far more than render). */
float b_refl = 1.0;
/** Shadowing of direct light by window reveals, sills and lintels. */
float b_dirShade = 1.0;
/** Occlusion of sky light inside recesses. */
float b_cavity = 1.0;

// Share of homes with lights on through the day: a morning bump and an evening peak.
float resLit(float h) {
  float eve = smoothstep(17.0, 19.5, h) * (1.0 - smoothstep(22.0, 25.0, h));
  float morn = smoothstep(5.5, 6.5, h) * (1.0 - smoothstep(7.5, 8.5, h));
  return 0.05 + 0.42 * eve + 0.2 * morn;
}
// Offices: lit through the working day, a few late workers, cleaners after dark.
float officeLit(float h) {
  float work = smoothstep(6.5, 8.0, h) * (1.0 - smoothstep(18.0, 20.5, h));
  return 0.05 + 0.62 * work + 0.1 * smoothstep(18.0, 19.0, h) * (1.0 - smoothstep(21.0, 23.0, h));
}

/** Antialiased step: soft over about a pixel, so fine lines don't crawl. */
float aastep(float edge, float x) {
  float w = max(fwidth(x) * 0.75, 1e-5);
  return smoothstep(edge - w, edge + w, x);
}
/** 1 inside [a, b] (antialiased). */
float band(float a, float b, float x) {
  return aastep(a, x) * (1.0 - aastep(b, x));
}

/**
 * A punched window in a facade cell. lc: 0–1 across the bay and up the floor;
 * size: bay and floor size in metres. Returns the glass mask; frame, sill and
 * lintel masks and the position inside the opening (metres) come back
 * through the out parameters.
 */
/**
 * Window families a movement can use (the type comes from the facade seed):
 * width as a share of the bay, sill and head heights (share of the storey),
 * mullions (0, 1 central, 2 at thirds), a transom, an arched head and the
 * depth of the reveal.
 */
void windowSpec(float t, out float wf, out float sill, out float head, out float mulls, out float trans, out float arch, out float depth) {
  wf = 0.5; sill = 0.3; head = 0.83; mulls = 0.0; trans = 1.0; arch = 0.0; depth = 0.15;
  if (t < 0.5) {
  } else if (t < 1.5) { wf = 0.56; mulls = 1.0; trans = 0.0; }
  else if (t < 2.5) { wf = 0.42; sill = 0.06; head = 0.88; mulls = 1.0; }
  else if (t < 3.5) { wf = 0.84; sill = 0.36; head = 0.8; mulls = 2.0; trans = 0.0; depth = 0.1; }
  else if (t < 4.5) { wf = 0.4; sill = 0.34; head = 0.76; trans = 0.0; depth = 0.42; }
  else if (t < 5.5) { wf = 0.44; sill = 0.22; head = 0.88; mulls = 1.0; trans = 0.0; arch = 1.0; depth = 0.22; }
  else if (t < 6.5) { wf = 0.9; sill = 0.03; head = 0.97; mulls = 1.0; trans = 0.0; depth = 0.06; }
  else { wf = 0.2; sill = 0.1; head = 0.9; trans = 0.0; depth = 0.36; }
}

float punchedWindow(vec2 lc, vec2 size, float seed, float style, float wtype, out float frame, out float sill, out float lintel, out vec2 wpos, out vec2 wsize, out float rdepth) {
  float k1 = m_hash12(vec2(seed, 1.7));
  float k2 = m_hash12(vec2(seed, 3.1));
  // Window proportions vary by building, not by window.
  float ww = clamp(size.x * mix(0.38, 0.6, k1), 0.85, max(0.85, size.x - 0.7));
  float sillY = style > 1.5 ? 0.12 : mix(0.27, 0.33, k2);
  float headY = mix(0.8, 0.86, k2);
  float mulls = style > 0.5 && style < 1.5 ? 1.0 : 0.0;
  float trans = k2 > 0.4 ? 1.0 : 0.0;
  float arch = 0.0;
  rdepth = -1.0;
  if (wtype >= 0.0) {
    // A movement's window: the same family on every building it shapes.
    float wf;
    windowSpec(wtype, wf, sillY, headY, mulls, trans, arch, rdepth);
    ww = clamp(size.x * wf, 0.5, max(0.5, size.x - 0.24));
  }
  float x0 = 0.5 - 0.5 * ww / size.x, x1 = 0.5 + 0.5 * ww / size.x;
  float y0 = sillY, y1 = headY;
  float ft = 0.07 / size.x, fty = 0.07 / size.y;
  float open = band(x0, x1, lc.x) * band(y0, y1, lc.y);
  float inner = band(x0 + ft, x1 - ft, lc.x) * band(y0 + fty, y1 - fty, lc.y);
  if (arch > 0.5) {
    // A round head: the top of the opening is a half circle.
    float rr = ww * 0.5;
    float xM = (lc.x - 0.5) * size.x, yM = lc.y * size.y;
    float spring = y1 * size.y - rr;
    if (yM > spring) {
      float dd = length(vec2(xM, yM - spring));
      open *= 1.0 - aastep(rr, dd);
      inner *= 1.0 - aastep(rr - 0.07, dd);
    }
  }
  // Mullions (central or at thirds) and a transom near the head.
  float mull = mulls > 1.5 ? max(band(1.0 / 3.0 - ft * 0.4, 1.0 / 3.0 + ft * 0.4, (lc.x - x0) / (x1 - x0)), band(2.0 / 3.0 - ft * 0.4, 2.0 / 3.0 + ft * 0.4, (lc.x - x0) / (x1 - x0)))
    : mulls > 0.5 ? band(0.5 - ft * 0.5, 0.5 + ft * 0.5, lc.x) : 0.0;
  float tr = mix(y0, y1, 0.74);
  float transom = trans > 0.5 ? band(tr - fty * 0.4, tr + fty * 0.4, lc.y) : 0.0;
  float glass = inner * (1.0 - max(mull, transom));
  frame = open - glass;
  sill = band(x0 - 0.08 / size.x, x1 + 0.08 / size.x, lc.x) * band(y0 - 0.07 / size.y, y0, lc.y);
  lintel = band(x0 - 0.06 / size.x, x1 + 0.06 / size.x, lc.x) * band(y1, y1 + 0.16 / size.y, lc.y);
  wpos = vec2((lc.x - x0) * size.x, (lc.y - y0) * size.y);
  wsize = vec2((x1 - x0) * size.x, (y1 - y0) * size.y);
  return glass;
}

/**
 * Sun shadow inside a recessed opening: the jamb on the sun's side and the head
 * shade a strip of glass whose width follows the sun's angle to the wall.
 */
float revealShadow(vec2 wpos, vec2 wsize, float depth) {
  vec3 n = normalize(vec3(vWNormal.x, 0.0, vWNormal.z) + 1e-5);
  vec3 along = vec3(n.z, 0.0, -n.x);
  float sn = dot(uSunDir, n);
  if (sn <= 0.02) return 1.0;
  float sx = dot(uSunDir, along);
  float sw = depth * abs(sx) / sn;
  float sh = depth * max(uSunDir.y, 0.0) / sn;
  float side = sx > 0.0 ? wsize.x - wpos.x : wpos.x;
  return aastep(sw, side) * aastep(sh, wsize.y - wpos.y);
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
  float nl = m_vnoise(vec2(dot(vWPos.xz, vec2(0.11, 0.07)), vWPos.y * 0.09) + seed);
  float night = smoothstep(0.15, 0.85, uNight);
  bool abandoned = mod(floor(vState.b * 255.0 + 0.5), 2.0) > 0.5;
  bool burning = mod(floor(vState.b * 255.0 / 2.0 + 0.01), 2.0) > 0.5;
  // A research centre with work under way: the lights stay on late.
  bool busy = mod(floor(vState.b * 255.0 / 4.0 + 0.01), 2.0) > 0.5;
  // Large-scale tonal drift so big walls aren't flat colour.
  col = base * (0.93 + 0.1 * n + 0.05 * (nl - 0.5));
  b_rough = 0.85;
  float glass = 0.0;
  float frame = 0.0;
  float litF = resLit(uHour);
  vec3 lightCol = vec3(1.0, 0.72, 0.42);
  vec2 cell = vec2(floor(f.x), floor(f.y / fh));
  vec2 lc = vec2(fract(f.x), fract(f.y / fh));
  // How many window bays a pixel spans: detail fades to its average when tiny.
  float px = max(fwidth(f.x), fwidth(f.y / fh));
  float detail = 1.0 - smoothstep(0.18, 0.5, px);
  vec2 wpos = vec2(0.0), wsize = vec2(1.0);
  float sill = 0.0, lintel = 0.0;
  bool punchedKind = false;
  float bstyle = floor(m_hash12(vec2(seed, 9.3)) * 3.0);
  // Facades drawn in a movement carry its window family and frame tone in the seed.
  bool styled = seed > 127.5;
  float wtype = styled ? floor((seed - 128.0) / 16.0) : -1.0;
  float ftone = styled ? mod(floor((seed - 128.0) / 4.0), 4.0) : -1.0;
  // Per-building variety for lights and curtains (styled buildings share a seed).
  float bseed = styled ? seed + mod(vSlot, 97.0) * 1.37 : seed;
  float rdepth = -1.0;
  // Per-building trim: white, warm stone or dark bronze.
  float tk = m_hash12(vec2(seed, 5.9));
  vec3 trimCol = tk < 0.5 ? m_srgb(vec3(0.86, 0.85, 0.82)) : tk < 0.8 ? m_srgb(vec3(0.78, 0.74, 0.66)) : m_srgb(vec3(0.24, 0.23, 0.22));
  vec3 frameCol = tk < 0.65 ? m_srgb(vec3(0.88, 0.88, 0.86)) : m_srgb(vec3(0.2, 0.2, 0.21));
  if (styled) {
    frameCol = ftone < 0.5 ? m_srgb(vec3(0.9, 0.9, 0.88)) : ftone < 1.5 ? m_srgb(vec3(0.78, 0.74, 0.66)) : ftone < 2.5 ? m_srgb(vec3(0.15, 0.15, 0.16)) : m_srgb(vec3(0.32, 0.23, 0.15));
    trimCol = ftone < 0.5 ? m_srgb(vec3(0.86, 0.85, 0.82)) : ftone < 1.5 ? m_srgb(vec3(0.78, 0.74, 0.66)) : ftone < 2.5 ? m_srgb(vec3(0.56, 0.56, 0.54)) : m_srgb(vec3(0.6, 0.53, 0.44));
  }

  float shutters = 0.0;
  if (pid == ${p('RES')} || pid == ${p('BRICK')} || pid == ${p('STONE')} || pid == ${p('PANEL')} || pid == ${p('SIDING')} || pid == ${p('BETON')} || pid == ${p('TIMBERW')}) {
    punchedKind = true;
    if (pid == ${p('BETON')}) {
      // Board-marked concrete: the grain of the formwork, panel joints, weathering streaks.
      float um = f.x * bay;
      float boards = fract(f.y / 0.16);
      float bl = 1.0 - band(0.04, 1.0, boards);
      float pnl = m_hash12(vec2(floor(um / 2.4), floor(f.y / 1.2)) + seed * 0.1);
      col = base * (0.9 + 0.12 * pnl + 0.06 * nf) * (1.0 - bl * 0.08 * detail) * (0.97 + 0.04 * m_vnoise(vec2(um * 6.0, f.y * 0.5)));
      col *= 1.0 - 0.06 * (1.0 - band(0.006, 1.0, fract(um / 2.4))) * detail;
      col *= 1.0 - 0.12 * smoothstep(0.55, 0.95, m_vnoise(vec2(um * 0.9, f.y * 0.07) + seed));
      b_rough = 0.93;
    } else if (pid == ${p('TIMBERW')}) {
      float um = f.x * bay;
      float board = floor(um / 0.14);
      float g = m_hash12(vec2(board, seed));
      col = base * (0.82 + 0.3 * g) * (0.95 + 0.08 * m_vnoise(vec2(um * 40.0, f.y * 1.5)));
      col *= 1.0 - (1.0 - band(0.06, 1.0, fract(um / 0.14))) * 0.3 * detail;
      b_rough = 0.8;
    } else if (pid == ${p('SIDING')}) {
      // Lap boards, each casting a thin shadow line on the one below.
      float t = fract(f.y / 0.2);
      col *= mix(0.97, 0.84 + 0.16 * smoothstep(0.0, 0.25, t), detail) * (0.97 + 0.04 * nf);
      b_rough = 0.7;
      shutters = step(m_hash12(vec2(seed, 7.7)), 0.6);
    } else if (pid == ${p('BRICK')}) {
      float um = f.x * bay;
      float row = floor(f.y / 0.075);
      float bx = fract((um + mod(row, 2.0) * 0.12) / 0.24);
      float mortar = max(step(fract(f.y / 0.075), 0.14), step(bx, 0.05));
      vec3 brick = base * (0.8 + 0.32 * m_hash12(vec2(floor((um + mod(row, 2.0) * 0.12) / 0.24), row) + seed));
      vec3 mortarCol = m_srgb(vec3(0.7, 0.68, 0.63));
      vec3 detailed = mix(brick, mortarCol, mortar * 0.8);
      float course = fwidth(f.y) / 0.075;
      vec3 average = mix(base * 0.96, mortarCol, 0.14);
      col = mix(detailed, average, smoothstep(0.3, 0.75, course)) * (0.94 + 0.1 * nl);
      trimCol = m_srgb(vec3(0.8, 0.77, 0.7));
    } else if (pid == ${p('STONE')}) {
      float um = f.x * bay;
      float row = floor(f.y / 0.42);
      float bx = fract((um + mod(row, 2.0) * 0.45) / 0.9);
      float joint = max(aastep(1.0 - 0.025 / 0.42, fract(f.y / 0.42)), 1.0 - aastep(0.012, bx));
      float block = m_hash12(vec2(floor((um + mod(row, 2.0) * 0.45) / 0.9), row) + seed);
      col = base * (0.9 + 0.14 * block + 0.06 * nf) * (1.0 - joint * 0.22 * detail);
      b_rough = 0.8;
    } else if (pid == ${p('PANEL')}) {
      float um = f.x * bay;
      vec2 pc = vec2(floor(um / 1.2), floor(f.y / (fh * 0.5)));
      float tone = m_hash12(pc + seed * 0.13);
      col = base * mix(0.9, 1.1, step(0.55, tone)) * (0.97 + 0.05 * nf);
      float jx = 1.0 - band(0.012, 0.988, fract(um / 1.2));
      float jy = 1.0 - aastep(0.02, fract(f.y / (fh * 0.5)));
      col *= 1.0 - max(jx, jy) * 0.3 * detail;
      b_rough = 0.6;
    } else {
      // Render: floor-slab lines.
      float slab = band(0.0, 0.025, lc.y) * isWall;
      col *= 1.0 - slab * 0.12;
    }
    glass = punchedWindow(lc, vec2(bay, fh), seed, bstyle, wtype, frame, sill, lintel, wpos, wsize, rdepth);
  } else if (pid == ${p('OFFICE')}) {
    // Ribbon windows between spandrel panels, mullions every 1.5 m.
    float um = f.x * bay;
    float g0 = 0.3, g1 = 0.93;
    float rib = band(g0, g1, lc.y);
    float mull = 1.0 - band(0.04, 0.96, fract(um / 1.5));
    glass = rib * (1.0 - mull);
    frame = rib * mull;
    float joint = 1.0 - band(0.01, 0.99, fract(um / 3.0));
    col *= (1.0 - (1.0 - rib) * joint * 0.25 * detail) * (0.96 + 0.06 * nf);
    b_rough = 0.45;
    b_metal = 0.2;
    litF = officeLit(uHour);
    lightCol = vec3(0.86, 0.92, 1.0);
    frameCol = m_srgb(vec3(0.3, 0.32, 0.34));
    wpos = vec2(fract(um / 1.5) * 1.5, (lc.y - g0) * fh);
    wsize = vec2(1.5, (g1 - g0) * fh);
  } else if (pid == ${p('GLASS')}) {
    // Curtain wall: mullions at the bay, a spandrel band at each floor slab.
    float mullX = 1.0 - band(0.035, 0.965, lc.x);
    float spand = 1.0 - band(0.16, 0.97, lc.y);
    glass = (1.0 - mullX) * (1.0 - spand);
    frame = mullX;
    litF = officeLit(uHour);
    lightCol = vec3(0.84, 0.9, 1.0);
    frameCol = m_srgb(vec3(0.3, 0.31, 0.33));
    // Spandrels: the same glass, opaque behind, so the skin reads as one with floor lines.
    col = base * (0.34 + 0.08 * nf);
    b_rough = 0.14;
    b_metal = 0.5;
    b_refl = 2.4;
  } else if (pid == ${p('STORE')}) {
    if (f.y < fh) {
      // Shop fronts: pilasters, a tiled stall riser, display glass with a transom, a fascia above.
      float shop = m_hash12(vec2(cell.x, seed) + 0.31);
      float riserTop = 0.5;
      float headY = fh * 0.74;
      float pil = 1.0 - band(0.05, 0.95, lc.x);
      glass = band(0.08, 0.92, lc.x) * band(riserTop + 0.06, headY, f.y);
      float transomY = headY - 0.55;
      float tbar = band(transomY - 0.04, transomY + 0.04, f.y) * band(0.08, 0.92, lc.x);
      float mid = shop > 0.5 ? band(0.495, 0.505, lc.x) * band(riserTop, transomY, f.y) : 0.0;
      float door = band(0.36, 0.64, lc.x) * band(0.03, transomY, f.y) * step(0.55, shop);
      glass = max(glass * (1.0 - max(tbar, mid)), door * 0.95);
      frame = band(0.06, 0.94, lc.x) * band(riserTop, headY + 0.05, f.y) * (1.0 - glass);
      float riser = band(0.0, riserTop, f.y) * (1.0 - pil) * (1.0 - door);
      // Shopfront joinery: charcoal, bronze or a painted colour per shop.
      frameCol = shop < 0.45 ? m_srgb(vec3(0.13, 0.13, 0.14)) : shop < 0.7 ? m_srgb(vec3(0.28, 0.21, 0.15)) : base * 0.55;
      col = mix(col, m_srgb(vec3(0.26, 0.25, 0.24)) * (0.85 + 0.2 * nf), riser);
      col = mix(col, base * 0.8, pil * band(0.0, headY, f.y));
      litF = 0.95;
      lightCol = vec3(1.0, 0.86, 0.62);
      // Inside: a warmly lit shop floor, brighter towards the ceiling, with displays near the glass.
      float wy2 = clamp((f.y - riserTop) / max(headY - riserTop, 0.1), 0.0, 1.0);
      float display = smoothstep(0.35, 0.0, abs(wy2 - 0.25)) * (0.5 + 0.5 * m_vnoise(vec2(lc.x * bay * 1.7, shop * 9.0)));
      float lit = 0.4 + 0.6 * shop;
      b_emis += glass * m_srgb(vec3(0.95, 0.8, 0.6)) * (0.008 + 0.022 * smoothstep(0.3, 1.0, wy2) + 0.012 * display) * lit;
      col *= 0.92 + 0.08 * nf;
      wpos = vec2(lc.x * bay, f.y - riserTop);
      wsize = vec2(bay, headY - riserTop);
    } else {
      punchedKind = true;
      float uf = 3.1;
      vec2 lc2 = vec2(fract(f.x), fract((f.y - fh) / uf));
      cell = vec2(floor(f.x), floor((f.y - fh) / uf) + 1.0);
      glass = punchedWindow(lc2, vec2(bay, uf), seed, bstyle, wtype, frame, sill, lintel, wpos, wsize, rdepth);
    }
  } else if (pid == ${p('INDUSTRIAL')}) {
    // Profiled metal cladding with panel joints and rain streaks.
    float um = f.x * bay;
    float rib = 0.5 + 0.5 * sin(um * 20.94);
    col *= mix(0.97, 0.9 + 0.1 * rib, detail);
    col *= 1.0 - 0.1 * (1.0 - band(0.012, 0.988, fract(f.y / 2.6))) * detail;
    col *= 1.0 - 0.08 * smoothstep(0.55, 0.95, m_vnoise(vec2(um * 1.3, f.y * 0.15) + seed));
    float bandW = band(fh - 2.6, fh - 1.4, f.y) * band(0.12, 0.88, lc.x);
    glass = bandW;
    frame = band(fh - 2.7, fh - 1.3, f.y) * band(0.1, 0.9, lc.x) - bandW;
    litF = 0.45;
    lightCol = vec3(1.0, 0.9, 0.7);
    b_rough = 0.55;
    b_metal = 0.3;
    b_refl = 1.4;
  } else if (pid == ${p('ROOF_FLAT')}) {
    // Membrane roof: sheet seams, ponding stains and patching.
    col = base * (0.88 + 0.12 * n + 0.07 * nf);
    float seam = 1.0 - band(0.01, 0.99, fract(f.x / 1.9));
    col *= 1.0 - seam * 0.06 * detail;
    col *= 1.0 - 0.1 * smoothstep(0.6, 0.85, m_fbm(f * 0.18 + seed));
    col = mix(col, col * vec3(0.92, 0.94, 0.96), smoothstep(0.55, 0.8, m_vnoise(f * 0.07 + 3.0)));
    b_rough = 0.93;
  } else if (pid == ${p('ROOF_TILE')}) {
    // Courses of tiles, each throwing a thin shadow on the one below; weathering and moss.
    float row = floor(f.y / 0.33);
    float tile = m_hash12(vec2(floor(f.x / 0.42 + mod(row, 2.0) * 0.5), row) + seed);
    float t = fract(f.y / 0.33);
    float edge = fract(f.x / 0.42 + mod(row, 2.0) * 0.5);
    vec3 tileCol = base * (0.84 + 0.24 * tile) * (0.72 + 0.28 * smoothstep(0.0, 0.3, t));
    tileCol *= 1.0 - 0.12 * (1.0 - band(0.03, 0.97, edge));
    col = mix(tileCol, base * 0.9, smoothstep(0.25, 0.7, fwidth(f.y) / 0.33));
    col = mix(col, col * vec3(0.8, 0.9, 0.7), smoothstep(0.62, 0.9, m_fbm(f * 0.35 + seed)) * 0.5);
    b_rough = 0.78;
  } else if (pid == ${p('ROOF_METAL')}) {
    float seamU = fract(f.x / 0.5);
    float seamLine = 1.0 - band(0.03, 0.97, seamU);
    col = base * (0.94 + 0.06 * nf) * (1.0 + seamLine * 0.18 * detail);
    b_rough = 0.62;
    b_metal = 0.2;
  } else if (pid == ${p('LOUVRE')}) {
    float t = fract(f.y / 0.18);
    col = base * mix(0.85, mix(0.62, 1.05, smoothstep(0.0, 0.7, t)), detail);
    b_rough = 0.5;
    b_metal = 0.4;
  } else if (pid == ${p('WOOD')}) {
    float um = f.x * bay;
    float board = floor(um / 0.14);
    float g = m_hash12(vec2(board, seed));
    col = base * (0.82 + 0.3 * g) * (0.95 + 0.08 * m_vnoise(vec2(um * 40.0, f.y * 1.5)));
    col *= 1.0 - (1.0 - band(0.06, 1.0, fract(um / 0.14))) * 0.3 * detail;
    col *= 0.85 + 0.15 * smoothstep(0.0, 2.5, vRelY);
    b_rough = 0.8;
  } else if (pid == ${p('PLANTED')}) {
    // Sedum, grasses and shrubs: patchy greens with rusty and flowering spots.
    vec2 wp = vWPos.xz + vWPos.y * 0.7;
    float a = m_vnoise(wp * 1.1), c2 = m_vnoise(wp * 3.7 + 3.0), c3 = m_vnoise(wp * 9.0 - 1.0);
    col = mix(m_srgb(vec3(0.29, 0.39, 0.17)), m_srgb(vec3(0.46, 0.49, 0.23)), a);
    col = mix(col, m_srgb(vec3(0.55, 0.34, 0.27)), smoothstep(0.72, 0.9, c2) * 0.45);
    col = mix(col, m_srgb(vec3(0.85, 0.78, 0.5)), smoothstep(0.86, 0.95, c3) * 0.35 * detail);
    col *= 0.78 + 0.3 * c3;
    b_rough = 0.97;
  } else if (pid == ${p('TRIM')}) {
    col = base * (0.97 + 0.04 * nf);
    b_rough = 0.55;
  } else if (pid == ${p('PARKING')}) {
    col = base * (0.85 + 0.15 * n + 0.08 * nf);
    float zz = mod(f.y - fh, 16.4);
    float inRow = step(zz, 5.2) + step(11.2, zz);
    float u = fract((f.x - bay) / 2.6);
    float line = (1.0 - band(0.035, 1.0, u)) * inRow;
    // Oil stains in the middle of each stall.
    float stall = smoothstep(0.35, 0.0, abs(u - 0.5)) * inRow;
    col *= 1.0 - 0.12 * stall * m_vnoise(f * 1.3);
    col = mix(col, vec3(0.8), line * 0.85);
    b_rough = 0.9;
  } else if (pid == ${p('GRASS')}) {
    // Lawns use the terrain's grass so lots blend into the land around them.
    vec2 wp = vWPos.xz;
    float g1 = m_fbm(wp * 0.0035);
    float g2 = m_fbm(wp * 0.021 + 7.0);
    col = mix(m_srgb(vec3(0.345, 0.395, 0.22)), m_srgb(vec3(0.47, 0.455, 0.3)), smoothstep(0.45, 0.78, g1) * 0.7);
    col = mix(col, m_srgb(vec3(0.28, 0.34, 0.18)), smoothstep(0.45, 0.8, g2) * 0.6);
    col *= 0.9 + 0.12 * n + 0.08 * nf;
    // Mowing stripes, only up close.
    col *= 1.0 + 0.035 * (step(0.5, fract(f.x / 2.4)) - 0.5) * detail;
    b_rough = 0.97;
  } else if (pid == ${p('PAVING')}) {
    col = base * (0.88 + 0.12 * n + 0.04 * nf);
    vec2 t = fract(f / 1.2);
    col *= 1.0 - 0.1 * (1.0 - band(0.03, 1.0, t.x) * band(0.03, 1.0, t.y)) * detail;
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
    float fr = 1.0 - band(0.05, 1.0, t.x) * band(0.05, 1.0, t.y);
    vec2 cells = fract(f * vec2(6.0, 10.0));
    float grid = 1.0 - band(0.06, 1.0, cells.x) * band(0.06, 1.0, cells.y);
    col = mix(base * (0.85 + 0.2 * nf) * (1.0 - grid * 0.25 * detail), m_srgb(vec3(0.75, 0.77, 0.8)), fr);
    b_metal = 0.6;
    b_rough = 0.18;
    b_refl = 2.5;
  } else if (pid == ${p('WATER')}) {
    // Pools and fountains: a deep teal body that mostly shows the sky, with moving ripples.
    float w = m_vnoise(vWPos.xz * 0.6 + uTime * 0.4) * 0.5 + m_vnoise(vWPos.xz * 1.7 - uTime * 0.6) * 0.5;
    col = mix(base, m_srgb(vec3(0.1, 0.3, 0.36)), 0.7) * (0.5 + 0.22 * w);
    b_rough = 0.04 + 0.05 * w;
    b_metal = 0.1;
    b_refl = 2.6;
  } else if (pid == ${p('DIRT')}) {
    col = base * (0.72 + 0.4 * n + 0.15 * nf);
    b_rough = 1.0;
  } else if (pid == ${p('SIGN')}) {
    col = base;
    b_emis += base * (0.18 + 2.4 * night);
    b_rough = 0.4;
  } else if (pid == ${p('GLASS_PLAIN')}) {
    col = base * 0.6;
    b_rough = 0.08;
    b_metal = 0.6;
    b_refl = 3.0;
  } else if (pid == ${p('CONCRETE')}) {
    float um = f.x * bay;
    col = base * (0.88 + 0.12 * n + 0.05 * nf);
    // Formwork panels with tie holes.
    vec2 fp = vec2(fract(um / 2.4), fract(f.y / 1.2));
    col *= 1.0 - 0.07 * (1.0 - band(0.006, 1.0, fp.x) * band(0.01, 1.0, fp.y)) * detail;
    vec2 tie = abs(fract(vec2(um / 0.6, f.y / 0.6)) - 0.5);
    col *= 1.0 - 0.18 * step(length(tie), 0.05) * (1.0 - smoothstep(0.02, 0.06, fwidth(um)));
    col *= 0.85 + 0.15 * smoothstep(0.0, 1.2, vRelY);
    b_rough = 0.9;
  } else if (pid == ${p('FAN')}) {
    // A round fan guard in each cell: dark opening, a ring and spokes, a hub.
    vec2 q = fract(f) - 0.5;
    float rr = length(q);
    float hole = 1.0 - aastep(0.38, rr);
    float ring = band(0.36, 0.42, rr);
    float spokes = step(0.82, abs(sin(atan(q.y, q.x) * 3.0))) * hole;
    float hub = 1.0 - aastep(0.07, rr);
    col = mix(base, m_srgb(vec3(0.06, 0.065, 0.07)), hole * (1.0 - max(spokes * 0.6, hub)));
    col = mix(col, base * 1.1, ring);
    b_metal = 0.2;
    b_rough = 0.65;
  } else if (pid == ${p('AWNING')}) {
    float stripe = step(0.5, fract(f.x / 0.55));
    col = mix(base, m_srgb(vec3(0.92, 0.9, 0.85)), stripe * 0.85 * detail + 0.4 * (1.0 - detail) * 0.5) * (0.92 + 0.08 * nf);
    b_rough = 0.85;
  } else if (pid == ${p('METAL')}) {
    col = base * (0.9 + 0.1 * n);
    b_metal = 0.3;
    b_rough = 0.58;
  }

  if (glass > 0.0 || frame > 0.0 || sill > 0.0 || lintel > 0.0) {
    float h = m_hash12(cell + vec2(bseed * 0.37, bseed * 1.31));
    float h2 = m_hash12(cell.yx * 1.7 + bseed * 0.11);
    bool curtainWall = pid == ${p('GLASS')} || pid == ${p('OFFICE')};
    // Glass: very dark behind, the sky does the rest (reflection is boosted below).
    vec3 interior = m_srgb(vec3(0.07, 0.08, 0.09)) * (0.75 + 0.5 * h);
    if (curtainWall) interior = mix(interior, base * 0.4, 0.5);
    // Curtains and blinds in some homes; which ones are drawn varies window to window.
    float wy = wpos.y / max(wsize.y, 0.1);
    float drape = 0.0;
    if (!curtainWall && pid != ${p('STORE')} && pid != ${p('INDUSTRIAL')}) {
      if (h2 < 0.26) {
        drape = 0.85 * (0.85 + 0.15 * sin(wpos.x * 22.0));
      } else if (h2 < 0.44) {
        float down = mix(0.25, 0.9, h);
        drape = step(1.0 - down, wy) * (0.82 + 0.18 * step(0.5, fract(wpos.y * 9.0)));
      } else if (h2 < 0.58) {
        drape = 0.35;
      }
      vec3 fabric = mix(m_srgb(vec3(0.82, 0.78, 0.7)), m_srgb(vec3(0.64, 0.66, 0.68)), step(0.5, fract(h * 7.3)));
      if (fract(h * 13.1) > 0.82) fabric = m_srgb(vec3(0.62, 0.44, 0.34));
      interior = mix(interior, fabric * 0.55, drape);
    }
    vec3 gcol = abandoned ? m_srgb(vec3(0.16, 0.12, 0.09)) : interior;
    // Shutters either side of the window, in the house's accent colour.
    if (shutters > 0.5) {
      float sw = wsize.x * 0.45;
      float sh = band(-sw, -0.03, wpos.x) + band(wsize.x + 0.03, wsize.x + sw, wpos.x);
      sh *= band(0.0, wsize.y, wpos.y) * detail;
      float sk = m_hash12(vec2(seed, 8.1));
      vec3 shCol = sk < 0.3 ? m_srgb(vec3(0.15, 0.26, 0.2)) : sk < 0.55 ? m_srgb(vec3(0.14, 0.18, 0.27)) : sk < 0.8 ? m_srgb(vec3(0.1, 0.1, 0.11)) : m_srgb(vec3(0.42, 0.18, 0.15));
      shCol *= 0.85 + 0.15 * step(0.5, fract(wpos.y * 14.0));
      col = mix(col, shCol, sh);
      b_rough = mix(b_rough, 0.5, sh);
    }
    // Far away a window is a blend of glass and frame rather than a crisp shape.
    float gl = glass * (0.7 + 0.3 * detail);
    col = mix(col, trimCol, sill * detail);
    col = mix(col, mix(col, trimCol, 0.75), lintel * detail * (pid == ${p('BRICK')} || pid == ${p('STONE')} ? 1.0 : 0.0));
    col = mix(col, frameCol, frame * detail);
    col = mix(col, gcol, gl);
    b_rough = mix(b_rough, 0.05, gl);
    b_metal = mix(b_metal, 0.35, gl);
    // Panes reflect the sky more towards their top (the lower part sees the street),
    // and each pane sits at a slightly different angle.
    float paneRefl = mix(0.55, 1.3, clamp(wy, 0.0, 1.0)) * (0.75 + 0.5 * h);
    b_refl = mix(b_refl, (curtainWall ? 5.0 : pid == ${p('STORE')} ? 3.5 : 6.0) * paneRefl, gl);
    // The recess: the reveal shades glass and frame from the sun, and sky light inside is dimmer.
    if (punchedKind || pid == ${p('STORE')} || pid == ${p('OFFICE')}) {
      float depth = rdepth > 0.0 ? rdepth : pid == ${p('STONE')} || pid == ${p('BRICK')} ? 0.22 : pid == ${p('OFFICE')} ? 0.1 : 0.15;
      float inOpen = clamp(glass + frame, 0.0, 1.0) * detail;
      b_dirShade = mix(1.0, revealShadow(wpos, wsize, depth), inOpen);
      b_cavity = mix(1.0, 0.72, inOpen);
      // Thin shadow under the sill.
      float underSill = band(-0.09, 0.0, wpos.y) * band(-0.05, wsize.x + 0.05, wpos.x) * (1.0 - glass) * detail;
      b_dirShade *= 1.0 - underSill * 0.6;
      // Rain streaks down the wall from the ends of the sill.
      if (punchedKind) {
        float sx0 = min(abs(wpos.x + 0.04), abs(wpos.x - wsize.x - 0.04));
        float streak = smoothstep(0.09, 0.0, sx0) * smoothstep(-1.4, -0.1, wpos.y) * (1.0 - step(0.0, wpos.y));
        col *= 1.0 - streak * 0.14 * m_hash12(cell + 0.5) * detail;
      }
    }
    if (busy) litF = max(litF, 0.92);
    // Who's home: some buildings are livelier than others; offices light up in floor sections.
    float occ = 0.55 + 0.9 * m_hash12(vec2(bseed, 21.0));
    float hl = curtainWall ? m_hash12(vec2(floor(cell.x / 5.0), cell.y) + bseed * 0.73) : h;
    float on = step(hl, litF * occ) * (abandoned ? 0.0 : 1.0);
    // Warm or cool bulbs, brighter near the ceiling; curtains glow softly.
    float temp = m_hash12(cell.yx + bseed);
    vec3 bulb = mix(lightCol, vec3(1.0, 0.86, 0.66), step(0.7, temp) * 0.6) * (0.6 + 0.7 * temp);
    float ceiling = 0.75 + 0.45 * smoothstep(0.2, 1.0, wy);
    float glow = curtainWall ? 0.42 : mix(1.15, 0.7, drape);
    b_emis += gl * on * night * bulb * glow * ceiling;
    b_emis += gl * on * (1.0 - night) * bulb * 0.04;
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
    b_refl = mix(b_refl, max(b_refl, 2.0), uWet * up);
  }
  // Grounding: walls darken toward the ground (splash-back and grime).
  col *= mix(1.0, 0.7 + 0.3 * smoothstep(0.0, 2.4, vRelY), isWall);
  b_cavity *= mix(1.0, 0.75 + 0.25 * smoothstep(0.0, 3.0, vRelY), isWall);

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
      b_refl = 1.0;
      b_dirShade = 1.0;
      b_cavity = 1.0;
    }
  }
  if (abandoned) {
    col = m_desat(col, 0.65) * 0.6;
    b_emis *= 0.0;
    b_rough = 0.95;
    b_refl = 1.0;
  }
  if (burning) col *= 0.35;
}
`;

/** Applies the per-surface shading terms after three.js has done the lighting. */
export const FACADE_LIGHT_GLSL = /* glsl */ `
reflectedLight.directDiffuse *= b_dirShade;
reflectedLight.directSpecular *= b_dirShade;
reflectedLight.indirectDiffuse *= b_cavity;
reflectedLight.indirectSpecular *= mix(1.0, b_cavity, 0.6);
`;
