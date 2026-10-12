import { VM } from '../../sim/traffic/Vehicles';
import { type Mat, P, mixRGB, shade } from './BuildingKit';
import { PAL, awning, balcony, canopy, cornice, door, flatRoof, mat, outline, parapet, piers, rgb, roofscape } from './architecture';
import { CAR_COLORS, CONC, GRASS, type Gen, PAVE, bushes, fence, parking, trees } from './lot';

/**
 * Homes, from detached houses to residential towers. Each design is built
 * from a base, a body and a top (plinth, facade, cornice or roof), with
 * porches, stoops, entrances, balconies and roof plant at sensible places.
 * Materials come in coherent families per building (brick with stone trim,
 * render with a stone base, panels with glass balconies), so neighbouring
 * buildings differ without the street turning into noise.
 */

const DOORS = [0x6e2a26, 0x23384f, 0x2f4a3a, 0x1e1f21, 0x7a5a3a, 0x5a2f40, 0xe9e4d6];

/** A detached house: plinth, one or two storeys, pitched roof with fascias, porch, chimney, garage. */
export const house: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, GRASS(s), 0.03);
  const scheme = r.next();
  const brick = b.level >= 2 && scheme > 0.55 && scheme < 0.82;
  const rendered = scheme >= 0.82;
  const wall = rgb(r.pick(brick ? PAL.brick : rendered ? PAL.render : PAL.siding));
  const roof = rgb(r.pick(PAL.roof));
  const trimHex = brick ? 0xeeeae0 : r.pick([0xeeeae0, 0xeeeae0, 0xd8cfbd, 0x3b3c3e]);
  const trim = mat(rgb(trimHex), P.TRIM, s);
  const garage = r.chance(0.6) && w >= 16;
  const bw = Math.min(w - (garage ? 7.5 : 4), r.range(9, 12) + b.level * 1.2);
  const bd = Math.min(d - 12, r.range(8, 10.5) + b.level * 0.8);
  const setback = r.range(5.5, 7.5);
  const side = r.chance(0.5) ? 1 : -1;
  const off = garage ? -side * 2 : r.range(-0.8, 0.8);
  const x0 = off - bw / 2, x1 = off + bw / 2, z0 = setback, z1 = setback + bd;
  const floors = Math.max(1, Math.min(2, b.floors));
  const fh = 2.95;
  const plinth = 0.5;
  const facade: Mat = mat(wall, brick ? P.BRICK : rendered ? P.RES : P.SIDING, s, fh, 3.1);
  const roofM: Mat = mat(roof, P.ROOF_TILE, s);
  g.box(x0 - 0.12, z0 - 0.12, x1 + 0.12, z1 + 0.12, 0, plinth, mat(rgb(0x9d988e), P.CONCRETE, s), null);
  g.box(x0, z0, x1, z1, plinth, plinth + floors * fh, facade, null);
  const top = plinth + floors * fh;
  // Corner boards on sided houses.
  if (!brick && !rendered) {
    for (const [cx, cz] of [[x0, z0], [x1, z0]] as [number, number][]) g.box(cx - 0.09, cz - 0.09, cx + 0.09, cz + 0.09, plinth, top, trim, null);
  }
  const rs = r.next();
  // Gable ends: same finish, with cells too tall for any window to land in the triangle.
  const gableEnd = (span: number) => mat(wall, brick ? P.BRICK : rendered ? P.RES : P.SIDING, s, 25, span);
  const o = 0.45;
  if (rs < 0.5) {
    const rise = r.range(2.3, 3.2);
    g.gable(x0, z0, x1, z1, top, rise, true, roofM, gableEnd(bd), o);
    const yl = top - (o * rise) / (bd / 2);
    outline(g, x0 - o + 0.05, z0 - o + 0.05, x1 + o - 0.05, z1 + o - 0.05, yl - 0.22, yl, 0.05, trim, [true, false, true, false]);
  } else if (rs < 0.75) {
    const rise = r.range(2.4, 3.4);
    g.gable(x0, z0, x1, z1, top, rise, false, roofM, gableEnd(bw), o);
    const yl = top - (o * rise) / (bw / 2);
    outline(g, x0 - o + 0.05, z0 - o + 0.05, x1 + o - 0.05, z1 + o - 0.05, yl - 0.22, yl, 0.05, trim, [false, true, false, true]);
  } else {
    const rise = r.range(2.0, 2.8);
    g.hip(x0, z0, x1, z1, top, rise, roofM, o);
    const yl = top - (o * rise) / (Math.min(bw, bd) / 2);
    outline(g, x0 - o + 0.05, z0 - o + 0.05, x1 + o - 0.05, z1 + o - 0.05, yl - 0.22, yl, 0.05, trim);
  }
  if (r.chance(0.5)) {
    const cx = r.range(x0 + 1, x1 - 1.6);
    const cz = z0 + bd * r.range(0.35, 0.6);
    const ch = top + 3.6;
    const bm = mat(rgb(r.pick(PAL.brick)), P.BRICK, s);
    g.box(cx, cz, cx + 0.85, cz + 0.85, top, ch, bm, null);
    g.box(cx - 0.08, cz - 0.08, cx + 0.93, cz + 0.93, ch, ch + 0.18, mat(rgb(0x6a6662), P.TRIM, s), mat(rgb(0x2a2a2a), P.PLAIN, s));
  }
  // Front door with a porch.
  const px = off + r.range(-bw * 0.2, bw * 0.2);
  const doorM = mat(rgb(r.pick(DOORS)), P.DOOR, s);
  if (b.level >= 2 && r.chance(0.45) && bw > 9) {
    // Full-width porch: deck, posts and a shed roof.
    const pw0 = x0 + 0.6, pw1 = x1 - 0.6, pz = z0 - 2.2;
    g.box(pw0, pz, pw1, z0, 0, plinth, mat(rgb(0x8d7a64), P.WOOD, s, 3, 1), mat(rgb(0x9a8670), P.WOOD, s, 3, 1), { sides: [true, true, false, true] });
    const ph = plinth + 2.6;
    const n = Math.max(2, Math.round((pw1 - pw0) / 2.6));
    for (let i = 0; i <= n; i++) {
      const x = pw0 + 0.15 + ((pw1 - pw0 - 0.3) * i) / n;
      g.box(x - 0.09, pz + 0.12, x + 0.09, pz + 0.3, plinth, ph, trim, null);
    }
    const rl = Math.hypot(2.4, 0.5);
    g.quad([pw1 + 0.1, ph, pz - 0.2], [pw0 - 0.1, ph, pz - 0.2], [pw0 - 0.1, ph + 0.5, z0], [pw1 + 0.1, ph + 0.5, z0], [0, 2.4 / rl, -0.5 / rl], roofM, [[0, 0], [pw1 - pw0, 0], [pw1 - pw0, 2.4], [0, 2.4]]);
    g.box(pw0 - 0.1, pz - 0.24, pw1 + 0.1, pz - 0.2, ph - 0.22, ph, trim, trim, { sides: [true, true, true, true] });
  } else {
    canopy(g, px - 1.3, px + 1.3, z0, plinth + 2.35, 1.4, 0.16, trim, r.chance(0.5) ? trim : null);
  }
  door(g, px, z0, plinth, 0.95, 2.1, doorM, trim);
  g.box(px - 1.1, z0 - 1.3, px + 1.1, z0, 0, plinth, mat(rgb(0xa8a49c), P.CONCRETE, s), mat(rgb(0xb5b1a9), P.PAVING, s), { sides: [true, true, false, true] });
  // Garage.
  if (garage) {
    const gx0 = side > 0 ? x1 : x0 - 4;
    const gx1 = side > 0 ? x1 + 4 : x0;
    const gz0 = z0 + 0.8;
    const gz1 = gz0 + 6.5;
    g.box(gx0, gz0, gx1, gz1, 0, 2.9, mat(wall, brick ? P.BRICK : rendered ? P.TRIM : P.SIDING, s, 30, 30), null, { sides: [true, side > 0, true, side < 0] });
    door(g, (gx0 + gx1) / 2, gz0, 0.05, 2.9, 2.2, mat(shade(rgb(trimHex === 0x3b3c3e ? 0xd8d4cc : trimHex), 0.95), P.DOOR, s), trim);
    g.gable(gx0, gz0, gx1, gz1, 2.9, 1.2, false, roofM, mat(wall, P.TRIM, s), 0.3);
    g.ground(gx0 + 0.3, 0, gx1 - 0.3, gz0, CONC(s), 0.05);
    if (r.chance(0.55)) g.prop({ kind: 'car', x: (gx0 + gx1) / 2, y: 0.05, z: gz0 * 0.45, rot: Math.PI / 2, variant: r.pick([VM.sedan, VM.suv, VM.hatchback]), color: r.pick(CAR_COLORS) });
  } else {
    const dx = side > 0 ? x1 + 0.8 : x0 - 3.6;
    g.ground(dx, 0, dx + 2.8, z0 + 4, CONC(s), 0.05);
    if (r.chance(0.5)) g.prop({ kind: 'car', x: dx + 1.4, y: 0.05, z: 3.2, rot: Math.PI / 2, variant: r.pick([VM.sedan, VM.hatchback]), color: r.pick(CAR_COLORS) });
  }
  g.ground(px - 0.6, 0, px + 0.6, z0 - 1.3, PAVE(s), 0.045);
  // Back yard: fence, maybe a pool and patio, trees.
  if (r.chance(0.7)) fence(g, -w / 2 + 0.2, z1 + 1, w / 2 - 0.2, d - 0.2, r.range(1.1, 1.7), rgb(r.pick([0xcdb69a, 0xe8e6e0, 0x8b7355, 0x6b5a48])), [false, true, true, true]);
  if (b.level >= 2 && r.chance(0.35) && d - z1 > 9) {
    const pw = Math.min(4, w * 0.25), pd = 6.5;
    const pxc = r.range(-w / 2 + 3, w / 2 - 3 - pw);
    g.ground(pxc - 1, z1 + 2, pxc + pw + 1, z1 + 2 + pd + 2, PAVE(s), 0.05);
    g.ground(pxc, z1 + 3, pxc + pw, z1 + 3 + pd, mat(rgb(0x3aa0c8), P.WATER, s), 0.08);
  } else if (r.chance(0.5)) {
    g.ground(x0 + 0.5, z1, x0 + Math.min(bw - 0.5, 5), z1 + 3, mat(rgb(0x9a8a74), P.PAVING, s), 0.05);
  }
  trees(g, r, r.int(1, 3), -w / 2 + 1.5, z1 + 2, w / 2 - 1.5, d - 1.5, undefined, 0.95);
  if (r.chance(0.6)) trees(g, r, 1, -w / 2 + 1.5, 1.5, w / 2 - 1.5, z0 - 2.5, [x0, z0, x1, z1], 0.85);
  bushes(g, r, Math.max(2, Math.floor(bw / 2.2)), x0 + 0.5, x1 - 0.5, z0 - 0.8);
};

/**
 * A terrace of row houses: each house its own colour and height, raised on a
 * stoop, with a cornice (flat roofs) or a shared pitched roof, and bay windows
 * on some.
 */
export const townhouse: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, GRASS(s), 0.03);
  const n = Math.max(2, Math.floor((w - 1) / 6.2));
  const uw = (w - 1) / n;
  const setback = r.range(3, 4.5);
  const bd = Math.min(d - 8, r.range(10, 12.5));
  const brick = r.chance(0.6);
  const family = brick ? PAL.brick : r.chance(0.5) ? PAL.render : PAL.siding;
  const baseCol = rgb(r.pick(family));
  const flat = r.chance(0.55);
  const roof = rgb(r.pick(PAL.roof));
  const trim = mat(rgb(r.pick([0xeeeae0, 0xe4dccb, 0xd8cfbd])), P.TRIM, s);
  const stoopM = mat(rgb(0xa6a196), P.STONE, s, 3, 3);
  const zb = setback;
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 + 0.5 + i * uw;
    const x1 = x0 + uw;
    const col = mixRGB(baseCol, rgb(r.pick(family)), 0.45);
    const fl = Math.max(2, b.floors + (r.chance(0.25) ? 1 : 0));
    const base = 0.7;
    const h = base + fl * 3.0;
    const pat = brick ? P.BRICK : family === PAL.siding ? P.SIDING : P.RES;
    const facade = mat(col, pat, s + i * 7, 3.0, uw / 2);
    g.box(x0, zb, x1, zb + bd, 0, base, mat(shade(col, 0.8), brick ? P.STONE : P.CONCRETE, s), null, { sides: [true, i === n - 1, true, i === 0] });
    g.box(x0, zb, x1, zb + bd, base, h, facade, null, { sides: [true, i === n - 1, true, i === 0] });
    if (flat) {
      g.flat(x0, zb, x1, zb + bd, h, mat(rgb(0x7f7b74), P.ROOF_FLAT, s));
      // Front upstand with a cornice; party walls rise between neighbours.
      g.box(x0, zb, x1, zb + 0.3, h, h + 0.8, facade, trim, { sides: [true, i === n - 1, true, i === 0] });
      cornice(g, x0, zb, x1, zb + bd, h + 0.8, 1.1, trim, [true, false, false, false]);
    } else {
      g.gable(x0, zb, x1, zb + bd, h, 2.6, true, mat(roof, P.ROOF_TILE, s), mat(col, pat, s, 25, bd), 0.0);
      outline(g, x0, zb, x1, zb + bd, h - 0.25, h, 0.12, trim, [true, false, true, false]);
      if (i < n - 1) {
        // Party-wall chimney stack on the ridge.
        const cz = zb + bd / 2;
        g.box(x1 - 0.5, cz - 0.6, x1 + 0.5, cz + 0.6, h + 1.8, h + 3.6, mat(shade(col, 0.9), P.BRICK, s), mat(rgb(0x5a5652), P.TRIM, s));
      }
    }
    // Ground-floor string course.
    outline(g, x0, zb, x1, zb + bd, base + 3.0 - 0.18, base + 3.0, 0.07, trim, [true, false, false, false]);
    // Bay window on some houses (two storeys high).
    const dx = i % 2 === 0 ? 0.18 : 0.62;
    if (b.level >= 2 && r.chance(0.5)) {
      const bx0 = x0 + uw * 0.12, bx1 = bx0 + Math.min(2.6, uw * 0.42);
      const bh = base + 2 * 3.0;
      g.box(bx0, zb - 0.75, bx1, zb, base, bh, mat(col, pat, s + i * 7, 3.0, bx1 - bx0), mat(roof, P.ROOF_METAL, s), { sides: [true, true, false, true] });
      outline(g, bx0, zb - 0.75, bx1, zb, bh - 0.2, bh, 0.08, trim, [true, true, false, true]);
    }
    // Stoop and front door.
    const dcx = x0 + uw * (dx < 0.5 ? 0.78 : 0.3);
    g.box(dcx - 0.8, zb - 1.6, dcx + 0.8, zb, 0, base, stoopM, mat(rgb(0xb8b2a6), P.PAVING, s), { sides: [true, true, false, true] });
    door(g, dcx, zb, base, 1.0, 2.25, mat(rgb(r.pick(DOORS)), P.DOOR, s), trim);
    g.ground(dcx - 0.5, 0, dcx + 0.5, zb - 1.6, PAVE(s), 0.045);
    if (i % 2 === 0) bushes(g, r, 2, x0 + 0.6, x0 + uw * 0.3, zb - 0.9);
  }
  const back = setback + bd;
  if (d - back > 7) {
    parking(g, r, -w / 2 + 1, d - 6.5, w / 2 - 1, d - 0.5, 0.5, s);
    fence(g, -w / 2 + 0.2, back + 0.5, w / 2 - 0.2, d - 7, 1.4, rgb(0xb59f84), [false, true, true, true]);
  }
  trees(g, r, Math.floor(n / 2), -w / 2 + 2, back + 1.5, w / 2 - 2, Math.max(back + 2, d - 8), undefined, 0.9);
  if (r.chance(0.6)) for (let i = 0; i < Math.floor(n / 2); i++) g.prop({ kind: 'tree', x: -w / 2 + uw * (i * 2 + 1), y: 0, z: 1.2, rot: i, scale: 0.75, variant: 1 });
};

/** Material families for apartment blocks. */
type Family = 'brick' | 'render' | 'panel' | 'mixed';

/**
 * Apartment blocks (three to nine storeys). A base (stone plinth or shops), a
 * body in one material family, and a top (cornice, parapet or a set-back top
 * floor with a terrace). Massing is a slab, an L or a pair of stepped wings;
 * balconies, entrances and roof plant follow the family.
 */
function apartmentBlock(g: Parameters<Gen>[0], b: Parameters<Gen>[1], r: Parameters<Gen>[2], tall: boolean): void {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, GRASS(s), 0.03);
  const setback = r.range(3.5, 6);
  const rearPark = d > 30 ? r.range(8, 12) : 0;
  const bw = w - r.range(3, 6);
  const bd = Math.max(10, d - setback - rearPark - 2);
  const x0 = -bw / 2, x1 = bw / 2, z0 = setback, z1 = setback + bd;
  const fh = 3.05;
  const floors = Math.max(3, b.floors);
  const fam: Family = r.pick(tall ? ['brick', 'render', 'panel', 'panel', 'mixed'] : ['brick', 'brick', 'render', 'panel', 'mixed']);
  const wallHex = fam === 'brick' || fam === 'mixed' ? r.pick(PAL.brick) : fam === 'panel' ? r.pick(PAL.panel) : r.pick(PAL.render);
  const col = rgb(wallHex);
  const bodyPat = fam === 'brick' ? P.BRICK : fam === 'panel' ? P.PANEL : fam === 'mixed' ? P.RES : P.RES;
  const bodyCol = fam === 'mixed' ? rgb(r.pick(PAL.render)) : col;
  const bay = r.range(3.1, 3.7);
  const body = mat(bodyCol, bodyPat, s, fh, bay);
  const trim = mat(rgb(fam === 'panel' ? r.pick([0x3b3c3e, 0xd8cfbd]) : r.pick([0xeeeae0, 0xe2d9c6])), P.TRIM, s);
  const shops = b.level >= 2 && r.chance(0.45);
  const gh = shops ? 4.2 : fh + 0.5;
  const baseMat = shops ? mat(shade(fam === 'panel' ? rgb(0x4a4c4f) : rgb(0x8f877a), 1), P.STORE, s, gh, 4.2) : fam === 'mixed' ? mat(col, P.BRICK, s, gh, bay) : mat(rgb(r.pick([0xb8ad9a, 0xa39b8e, 0xc9bda6])), P.STONE, s, gh, bay);
  const membrane = mat(rgb(r.pick(PAL.membrane)), P.ROOF_FLAT, s);
  const recessTop = fam === 'panel' && floors >= 4 && r.chance(0.7);
  const bodyFloors = recessTop ? floors - 1 : floors;
  const h = gh + (bodyFloors - 1) * fh;
  // Massing.
  const form = bd > 16 && r.chance(tall ? 0.25 : 0.35) ? 'L' : bw > 26 && r.chance(0.3) ? 'stepped' : 'slab';
  const masses: [number, number, number, number, number][] = [];
  if (form === 'L') {
    masses.push([x0, z0, x1, z0 + bd * 0.5, h]);
    masses.push([x0, z0 + bd * 0.5, x0 + bw * 0.45, z1, h]);
  } else if (form === 'stepped') {
    const split = x0 + bw * r.range(0.45, 0.6);
    masses.push([x0, z0, split, z1, h]);
    masses.push([split, z0 + 1.2, x1, z1, Math.max(gh + fh, h - fh * r.int(1, 2))]);
  } else masses.push([x0, z0, x1, z1, h]);
  masses.forEach(([a0, c0, a1, c1, top], k) => {
    const sides: [boolean, boolean, boolean, boolean] = form === 'L' && k === 1 ? [false, true, true, true] : form === 'stepped' && k === 0 ? [true, true, true, true] : [true, true, true, true];
    g.box(a0, c0, a1, c1, 0, gh, baseMat, null, { sides });
    g.box(a0, c0, a1, c1, gh, top, body, null, { sides });
    // String course over the base.
    outline(g, a0, c0, a1, c1, gh - 0.3, gh, shops ? 0.18 : 0.1, trim, sides);
    if (fam === 'brick' || fam === 'mixed') {
      // Cornice and parapet.
      g.flat(a0, c0, a1, c1, top, membrane);
      parapet(g, a0, c0, a1, c1, top, 0.9, body, trim);
      cornice(g, a0, c0, a1, c1, top + 0.55, 1.15, trim, sides);
    } else {
      flatRoof(g, a0, c0, a1, c1, top, membrane, mat(bodyCol, P.TRIM, s), trim, { parapet: 0.8 });
    }
  });
  const [mx0, mz0, mx1, mz1] = masses[0];
  // Set-back top floor with a terrace (contemporary blocks).
  let roofY = h;
  if (recessTop) {
    const ins = 1.8;
    const tx0 = mx0 + ins, tz0 = mz0 + ins, tx1 = mx1 - ins, tz1 = mz1 - ins * 0.6;
    const topM = mat(rgb(r.pick([0x3b3c3e, 0xe4e0d8, 0x8c7a66])), P.PANEL, s, fh, bay);
    g.box(tx0, tz0, tx1, tz1, h, h + fh, topM, null);
    flatRoof(g, tx0, tz0, tx1, tz1, h + fh, membrane, topM, trim, { parapet: 0.35 });
    // Glass balustrade around the terrace.
    const rail = mat(rgb(0x6d828c), P.GLASS_PLAIN, s);
    g.wall(mx1 - 0.35, mz0 + 0.35, mx0 + 0.35, mz0 + 0.35, h + 0.9, h + 1.95, rail);
    g.wall(mx0 + 0.35, mz0 + 0.39, mx1 - 0.35, mz0 + 0.39, h + 0.9, h + 1.95, rail);
    roofY = h + fh;
    roofscape(g, r, tx0, tz0, tx1, tz1, roofY + 0.35, s, { overrun: null, density: 0.6, solar: r.chance(0.4) });
  } else {
    roofscape(g, r, mx0, mz0, mx1, mz1, h, s, { tank: fam === 'brick' && r.chance(0.45), solar: fam === 'panel' && r.chance(0.5) });
  }
  // Balconies on the street face.
  const balc = fam === 'panel' ? 0.85 : fam === 'render' ? 0.7 : fam === 'mixed' ? 0.4 : 0.15;
  if (r.chance(balc)) {
    const slab = mat(rgb(0xdcd8d0), P.TRIM, s);
    // Glass on contemporary blocks, solid upstands (in the trim or a darker tone) on the others.
    const rail = fam === 'panel' && r.chance(0.6) ? mat(rgb(0x4d5e66), P.GLASS_PLAIN, s) : r.chance(0.5) ? mat(rgb(r.pick([0xe8e3d8, 0xd6cdbb])), P.TRIM, s) : mat(shade(bodyCol, 0.8), P.TRIM, s);
    const cells = Math.max(1, Math.round((mx1 - mx0) / bay));
    const bayW = (mx1 - mx0) / cells;
    // Pairs of bays share a balcony; stacks alternate for a calmer rhythm.
    const pattern = r.pick(['pairs', 'alternate', 'centre']);
    // Balcony floors line up with the facade's floor lines (multiples of the floor height).
    for (let y = Math.ceil((gh + 0.3) / fh) * fh; y <= h - fh + 0.1; y += fh) {
      for (let k = 0; k < cells; k++) {
        const on = pattern === 'pairs' ? k % 3 === 0 && k + 1 < cells : pattern === 'alternate' ? k % 2 === 0 : k >= Math.floor(cells / 2) - 1 && k <= Math.floor(cells / 2);
        if (!on) continue;
        const span = pattern === 'pairs' ? 2 : 1;
        const bx0 = mx0 + k * bayW + 0.25, bx1 = mx0 + (k + span) * bayW - 0.25;
        balcony(g, bx0, bx1, mz0, y + 0.02, 1.35, slab, rail);
      }
    }
  }
  // Entrance: door in a stone surround under a canopy.
  const ex = (mx0 + mx1) / 2 + r.range(-2, 2);
  if (shops) {
    for (let k = 0; k < Math.max(1, Math.floor((mx1 - mx0) / 9)); k++) {
      const ax0 = mx0 + 1 + k * 9, ax1 = ax0 + 7.2;
      if (ax1 > mx1 - 1 || (ax0 < ex + 2 && ax1 > ex - 2)) continue;
      awning(g, ax0, ax1, mz0, gh - 0.55, 1.4, 0.55, rgb(r.pick(PAL.accent)), s);
    }
  }
  door(g, ex, mz0, 0.05, 1.8, 2.5, mat(rgb(0x3a3f44), P.GLASS, s, 2.5, 0.9), trim);
  canopy(g, ex - 1.9, ex + 1.9, mz0, 2.95, 1.6, 0.22, mat(rgb(0x45494d), P.METAL, s));
  g.ground(ex - 1.3, 0, ex + 1.3, mz0 - 1.6, PAVE(s), 0.045);
  if (rearPark > 0 && form !== 'L') parking(g, r, -w / 2 + 1, d - rearPark + 0.5, w / 2 - 1, d - 0.5, 0.65, s);
  if (form === 'L') parking(g, r, x0 + bw * 0.45 + 2, z0 + bd * 0.5 + 2, x1, z1, 0.6, s);
  trees(g, r, r.int(2, 4), -w / 2 + 1.5, 1, w / 2 - 1.5, setback - 1.5, [ex - 2, 0, ex + 2, setback], 0.85);
  bushes(g, r, Math.floor(bw / 3), x0 + 1, x1 - 1, z0 - 0.7);
}

export const lowrise: Gen = (g, b, r) => apartmentBlock(g, b, r, false);
export const midrise: Gen = (g, b, r) => apartmentBlock(g, b, r, true);

/**
 * Residential tower over a retail podium with a planted roof terrace. Massing
 * varies (slab, setback, stepped tiers or two wings), as do materials
 * (render with piers, brick, panels, glass) and crowns (plant screen with a
 * cornice, a pyramid cap, a spire or a lit band), so a skyline of towers never
 * looks copy-pasted.
 */
export const tower: Gen = (g, b, r) => {
  const { w, d } = b;
  const s = b.seed & 255;
  g.ground(-w / 2, 0, w / 2, d, PAVE(s), 0.04);
  const fh = 3.1;
  const podiumH = 2 * 4.2;
  const pw = w - 4, pd = Math.min(d - 6, 30);
  const pz0 = 3;
  const px0 = -pw / 2, px1 = pw / 2, pz1 = pz0 + pd;
  const stone = rgb(r.pick([0xb8ad9a, 0xa39b8e, 0xc9bda6, 0x8f877a]));
  const trim = mat(rgb(r.pick([0xeeeae0, 0xd8cfbd, 0x3b3c3e])), P.TRIM, s);
  g.box(px0, pz0, px1, pz1, 0, 4.2, mat(rgb(0x3e4246), P.STORE, s, 4.2, 4.5), null);
  g.box(px0, pz0, px1, pz1, 4.2, podiumH, mat(stone, P.STONE, s, 4.2, 3.4), null);
  outline(g, px0, pz0, px1, pz1, 4.0, 4.35, 0.25, trim);
  canopy(g, px0 + 1, px1 - 1, pz0, 3.6, 1.6, 0.2, mat(rgb(0x3a3d40), P.METAL, s));
  const floors = Math.max(8, b.floors);
  const tw = Math.min(pw - 4, r.range(17, 23));
  const td = Math.min(pd - 4, r.range(16, 22));
  const tz0 = pz0 + (pd - td) / 2 + r.range(-1, 1.5);
  const tx0 = -tw / 2 + r.range(-1.5, 1.5);
  // Podium roof: a terrace with planters and trees around the tower.
  g.flat(px0, pz0, px1, pz1, podiumH, mat(rgb(0xa79d8e), P.PAVING, s));
  parapet(g, px0, pz0, px1, pz1, podiumH, 1.0, mat(stone, P.TRIM, s), trim);
  for (const [ax, az] of [[px0 + 2.5, pz0 + 2.5], [px1 - 2.5, pz0 + 2.5], [px0 + 2.5, pz1 - 2.5], [px1 - 2.5, pz1 - 2.5]] as [number, number][]) {
    if (ax > tx0 - 2 && ax < tx0 + tw + 2 && az > tz0 - 2 && az < tz0 + td + 2) continue;
    g.box(ax - 1.1, az - 1.1, ax + 1.1, az + 1.1, podiumH, podiumH + 0.6, mat(rgb(0x8a8378), P.CONCRETE, s), mat(rgb(0x4f5d33), P.GRASS, s));
    g.prop({ kind: 'tree', x: ax, y: podiumH + 0.6, z: az, rot: ax, scale: 0.6, variant: 0 });
  }

  const finish = b.level >= 3 && r.chance(0.5) ? 'glass' : r.pick(['render', 'render', 'brick', 'panel', 'glass']);
  const glassMat = mat(rgb(r.pick(PAL.glass)), P.GLASS, s, fh, 1.7);
  const renderCol = rgb(r.pick(PAL.render));
  const renderMat = mat(renderCol, P.RES, s, fh, 3.2);
  const brickMat = mat(rgb(r.pick(PAL.brick)), P.BRICK, s, fh, 3.2);
  const panelMat = mat(rgb(r.pick(PAL.panel)), P.PANEL, s, fh, 3.2);
  const lower = finish === 'glass' ? glassMat : finish === 'brick' ? brickMat : finish === 'panel' ? panelMat : renderMat;
  const upper = finish === 'brick' && r.chance(0.5) ? mat(rgb(r.pick(PAL.render)), P.RES, s, fh, 3.2) : lower;
  const membrane = mat(rgb(r.pick(PAL.membrane)), P.ROOF_FLAT, s);
  const glassy = finish === 'glass';

  const form = floors < 12 ? 'slab' : r.pick(['slab', 'setback', 'stepped', 'wings']);
  const tiers: [number, number, number, number, number][] = [];
  if (form === 'slab') tiers.push([tx0, tz0, tx0 + tw, tz0 + td, floors]);
  else if (form === 'setback') {
    const low = Math.round(floors * r.range(0.45, 0.65));
    tiers.push([tx0, tz0, tx0 + tw, tz0 + td, low]);
    const inset = r.range(2.2, 3.4);
    tiers.push([tx0 + inset, tz0 + inset, tx0 + tw - inset, tz0 + td - inset, floors - low]);
  } else if (form === 'stepped') {
    const a = Math.round(floors * 0.5), bb = Math.round(floors * 0.3);
    tiers.push([tx0, tz0, tx0 + tw, tz0 + td, a]);
    tiers.push([tx0 + 1.6, tz0 + 1.6, tx0 + tw - 1.6, tz0 + td - 1.6, bb]);
    tiers.push([tx0 + 3.4, tz0 + 3.4, tx0 + tw - 3.4, tz0 + td - 3.4, floors - a - bb]);
  }
  let y = podiumH;
  let top: [number, number, number, number] = [tx0, tz0, tx0 + tw, tz0 + td];
  if (form === 'wings') {
    const wa = tw * 0.55, db = td * 0.55;
    const fa = floors, fb = Math.max(6, Math.round(floors * r.range(0.55, 0.8)));
    const ya = podiumH + fa * fh, yb = podiumH + fb * fh;
    g.box(tx0, tz0, tx0 + wa, tz0 + td, podiumH, ya, lower, null);
    g.box(tx0 + wa, tz0 + td - db, tx0 + tw, tz0 + td, podiumH, yb, upper, null, { sides: [true, true, true, false] });
    flatRoof(g, tx0, tz0, tx0 + wa, tz0 + td, ya, membrane, mat(glassy ? rgb(0x5a6670) : renderCol, P.TRIM, s), trim, { parapet: 1.0 });
    flatRoof(g, tx0 + wa, tz0 + td - db, tx0 + tw, tz0 + td, yb, membrane, mat(glassy ? rgb(0x5a6670) : renderCol, P.TRIM, s), trim, { parapet: 0.9 });
    roofscape(g, r, tx0 + wa, tz0 + td - db, tx0 + tw, tz0 + td, yb, s, { density: 0.8 });
    y = ya;
    top = [tx0, tz0, tx0 + wa, tz0 + td];
  } else {
    tiers.forEach(([a0, c0, a1, c1, n], i) => {
      const y1 = y + n * fh;
      g.box(a0, c0, a1, c1, y, y1, i === 0 ? lower : upper, null);
      g.flat(a0, c0, a1, c1, y1, membrane);
      // A band marks each setback.
      if (i < tiers.length - 1) outline(g, a0, c0, a1, c1, y1 - 0.35, y1 + 0.15, 0.2, trim);
      y = y1;
      top = [a0, c0, a1, c1];
    });
  }
  const [cx0, cz0, cx1, cz1] = top;
  const cw = cx1 - cx0, cd = cz1 - cz0;
  const n0 = form === 'wings' ? floors : tiers[0][4];
  const shaftX1 = form === 'wings' ? tx0 + tw * 0.55 : tx0 + tw;

  // Facade rhythm: piers on rendered towers, balconies on panel and brick ones, fins on glass.
  if (glassy) {
    const fin = mat(rgb(r.pick([0xc9ccd0, 0x8d9399, 0x3a3f45])), P.METAL, s);
    piers(g, tx0, shaftX1, tz0, podiumH, podiumH + n0 * fh, Math.max(2, Math.floor((shaftX1 - tx0) / 3.4)), 0.22, 0.4, fin);
  } else if (finish === 'render' && r.chance(0.6)) {
    piers(g, tx0, shaftX1, tz0, podiumH, podiumH + n0 * fh, Math.max(2, Math.round((shaftX1 - tx0) / 6.4)), 0.7, 0.3, mat(shade(renderCol, 0.92), P.TRIM, s));
  } else {
    const slab = mat(rgb(0xdedad2), P.TRIM, s);
    const rail = finish === 'panel' ? mat(rgb(0x4d5e66), P.GLASS_PLAIN, s) : mat(rgb(r.pick([0xe8e3d8, 0xcfc6b4])), P.TRIM, s);
    const segs = r.pick([1, 2]);
    const segW = (shaftX1 - tx0 - 0.6) / segs;
    for (let yy = Math.ceil((podiumH + 0.5) / fh) * fh; yy < podiumH + n0 * fh - 1; yy += fh) {
      for (let k = 0; k < segs; k++) {
        const a = tx0 + 0.3 + k * segW + (segs > 1 ? 0.5 : 0), bb2 = a + segW - (segs > 1 ? 1 : 0);
        balcony(g, a, bb2, tz0, yy, 1.4, slab, rail);
      }
    }
  }

  // Crown.
  const crown = r.pick(['plant', 'plant', 'cap', 'spire', 'band']);
  const pc = mat(glassy ? rgb(0x5a6670) : renderCol, P.TRIM, s);
  if (crown === 'cap') {
    outline(g, cx0, cz0, cx1, cz1, y - 0.4, y + 0.2, 0.3, trim);
    g.hip(cx0, cz0, cx1, cz1, y + 0.2, Math.min(cw, cd) * 0.32, mat(rgb(r.pick([0x5c6670, 0x3f4a52, 0x6e5338, 0x4c5d55])), P.ROOF_METAL, s), 0.35);
  } else if (crown === 'spire') {
    parapet(g, cx0, cz0, cx1, cz1, y, 1.1, pc, trim);
    const sx = (cx0 + cx1) / 2, sz = (cz0 + cz1) / 2;
    g.box(cx0 + cw * 0.3, cz0 + cd * 0.3, cx1 - cw * 0.3, cz1 - cd * 0.3, y, y + 5, mat(rgb(0x9a9a98), P.LOUVRE, s), mat(rgb(0x6d6a65), P.ROOF_FLAT, s));
    const sh = Math.min(28, floors * 0.9);
    g.cylinder(sx, sz, 0.45, 0.06, y + 5, y + 5 + sh, 6, mat(rgb(0xb8bcc0), P.METAL, s), null);
    g.box(sx - 0.25, sz - 0.25, sx + 0.25, sz + 0.25, y + 5 + sh, y + 5.6 + sh, mat(rgb(0xff4433), P.SIGN, s, 1, 0.5), null);
  } else if (crown === 'band') {
    const glow = mat(rgb(r.pick([0xfff3d6, 0x9fd8ff, 0xb8ffd8])), P.SIGN, s, 1, cw);
    g.box(cx0 - 0.2, cz0 - 0.2, cx1 + 0.2, cz1 + 0.2, y, y + 0.7, glow, null);
    parapet(g, cx0, cz0, cx1, cz1, y + 0.7, 0.6, pc, trim);
    roofscape(g, r, cx0, cz0, cx1, cz1, y + 0.7, s);
  } else {
    parapet(g, cx0, cz0, cx1, cz1, y, 1.1, pc, trim);
    if (!glassy) cornice(g, cx0, cz0, cx1, cz1, y + 1.2, 1.3, trim);
    // Louvred plant screen set back from the edge.
    const ins = Math.min(cw, cd) * 0.22;
    g.box(cx0 + ins, cz0 + ins, cx1 - ins, cz1 - ins, y, y + 3.6, mat(rgb(glassy ? 0x7f8890 : 0xa8a49c), P.LOUVRE, s, 3.6, 1), mat(rgb(0x7b7872), P.ROOF_FLAT, s));
    outline(g, cx0 + ins, cz0 + ins, cx1 - ins, cz1 - ins, y + 3.6, y + 3.8, 0.1, trim);
    if (r.chance(0.4)) g.cylinder(cx0 + cw * 0.78, cz0 + cd * 0.74, 0.12, 0.05, y + 3.8, y + 12, 4, mat(rgb(0x999999), P.METAL, s), null);
  }
  // Street trees in planters along the podium.
  for (let i = 0; i < 4; i++) {
    const x = -w / 2 + 3 + ((w - 6) * i) / 3;
    g.box(x - 1, 0.5, x + 1, 2.5, 0, 0.6, CONC(s), mat(rgb(0x4f5d33), P.GRASS, s));
    g.prop({ kind: 'tree', x, y: 0.6, z: 1.5, rot: i, scale: 0.6, variant: 0 });
  }
};

