import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const ASSET_NAMES = [
  'sedan', 'hatchback', 'suv', 'van', 'truck', 'garbage', 'firetruck', 'police', 'ambulance', 'bus', 'pickup', 'taxi', 'delivery', 'mini', 'bike', 'bus_stop',
  'bench', 'bin', 'planter',
  'oak', 'maple', 'pine', 'bush', 'tree_lod', 'pine_lod', 'streetlight', 'signal', 'crane', 'wind_tower', 'wind_rotor',
  'airliner', 'sailboat', 'motorboat', 'container_ship',
  'person_adult', 'person_dress', 'person_child', 'person_lo',
] as const;
export type AssetName = (typeof ASSET_NAMES)[number];

/** Material role baked into the `aMat` vertex attribute. */
export const MATK = { tint: 0, fixed: 1, glass: 2, headlight: 3, taillight: 4, lightbar: 5, lamp: 6, wheel: 7 } as const;

function materialKind(name: string): number {
  if (name.startsWith('Body')) return MATK.tint;
  if (name.startsWith('Glass')) return MATK.glass;
  if (name.startsWith('Headlight')) return MATK.headlight;
  if (name.startsWith('Taillight')) return MATK.taillight;
  if (name.startsWith('Lightbar')) return MATK.lightbar;
  if (name.startsWith('Lamp')) return MATK.lamp;
  if (name.startsWith('Tire') || name.startsWith('Rim')) return MATK.wheel;
  return MATK.fixed;
}

const FOLIAGE: AssetName[] = ['oak', 'maple', 'bush'];
const PEOPLE: AssetName[] = ['person_adult', 'person_dress', 'person_child', 'person_lo'];

/** People parts: the colour slot, the limb it moves with, and the optional extra it belongs to (from `P_<slot>_<limb>_<option>`). */
export const PERSON_SLOTS = ['top', 'bottom', 'skin', 'hair', 'shoes', 'accent', 'dark', 'sleeve'];
export const PERSON_LIMBS = ['torso', 'head', 'thighL', 'shinL', 'thighR', 'shinR', 'uarmL', 'farmL', 'uarmR', 'farmR'];
export const PERSON_OPTIONS = ['none', 'hairShort', 'hairLong', 'hairBun', 'hat', 'bag', 'backpack', 'umbrella', 'coat'];

/**
 * Loads the Blender-authored GLB models and converts each into a single
 * merged geometry suitable for instancing (material colours baked into
 * vertex colours, material roles into `aMat`).
 */
export class AssetLibrary {
  private geos = new Map<AssetName, THREE.BufferGeometry>();
  readonly leafTexture: THREE.CanvasTexture;
  loadedFromFiles = 0;

  constructor() {
    this.leafTexture = createLeafTexture();
  }

  async load(onProgress?: (done: number, total: number) => void): Promise<void> {
    const loader = new GLTFLoader();
    const base = import.meta.env.BASE_URL ?? './';
    let done = 0;
    await Promise.all(
      ASSET_NAMES.map(async (name) => {
        try {
          const gltf = await loader.loadAsync(`${base}assets/models/${name}.glb`);
          const geo = PEOPLE.includes(name) ? convertPerson(gltf.scene) : this.convert(gltf.scene, FOLIAGE.includes(name));
          if (geo) {
            this.geos.set(name, geo);
            this.loadedFromFiles++;
          }
        } catch (e) {
          console.warn(`Asset ${name} failed to load, using fallback`, e);
        }
        done++;
        onProgress?.(done, ASSET_NAMES.length);
      }),
    );
    for (const name of ASSET_NAMES) if (!this.geos.has(name)) this.geos.set(name, fallback(name));
  }

  get(name: AssetName): THREE.BufferGeometry {
    let g = this.geos.get(name);
    if (!g) {
      g = fallback(name);
      this.geos.set(name, g);
    }
    return g;
  }

  private convert(root: THREE.Object3D, foliage: boolean): THREE.BufferGeometry | null {
    const parts: THREE.BufferGeometry[] = [];
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const src = mesh.geometry;
      const groups = src.groups.length ? src.groups : [{ start: 0, count: src.index ? src.index.count : src.getAttribute('position').count, materialIndex: 0 }];
      for (const grp of groups) {
        const mat = mats[grp.materialIndex ?? 0] as THREE.MeshStandardMaterial;
        let g = src.index ? extractGroup(src, grp.start, grp.count) : src.clone();
        g.applyMatrix4(mesh.matrixWorld);
        const n = g.getAttribute('position').count;
        const col = new Float32Array(n * 3);
        const c = mat?.color ?? new THREE.Color(0.8, 0.8, 0.8);
        for (let i = 0; i < n; i++) {
          col[i * 3] = c.r;
          col[i * 3 + 1] = c.g;
          col[i * 3 + 2] = c.b;
        }
        const kind = materialKind(mat?.name ?? '');
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(n).fill(kind), 1));
        if (!g.getAttribute('normal')) g.computeVertexNormals();
        if (foliage) {
          if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2).fill(0.75), 2));
        } else if (g.getAttribute('uv')) {
          g.deleteAttribute('uv');
        }
        for (const key of Object.keys(g.attributes)) {
          if (!['position', 'normal', 'color', 'aMat', 'uv'].includes(key)) g.deleteAttribute(key);
        }
        g = g.index ? g.toNonIndexed() : g;
        parts.push(g);
      }
    });
    if (!parts.length) return null;
    const merged = mergeGeometries(parts, false);
    if (merged) tagWheels(merged);
    merged?.computeBoundingSphere();
    return merged;
  }
}

/**
 * Gives every wheel vertex its axle (x, height) in `aWheel`, so the vehicle shader can
 * spin it. Each wheel is found as a connected piece of the mesh (vertices joined by its
 * triangles, or sitting at the same point), and turns about the middle of that piece:
 * grouping by position along the vehicle would slice a round wheel into strips that each
 * turned about a different centre, or merge twin rear wheels into one.
 */
export function tagWheels(g: THREE.BufferGeometry): void {
  const pos = g.getAttribute('position');
  const mat = g.getAttribute('aMat');
  const n = pos.count;
  const out = new Float32Array(n * 2);
  const isWheel = (i: number) => Math.round(mat.getX(i)) === MATK.wheel;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const join = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  // Triangles.
  const index = g.getIndex();
  const tris = index ? index.count : n;
  for (let t = 0; t + 2 < tris; t += 3) {
    const a = index ? index.getX(t) : t, b = index ? index.getX(t + 1) : t + 1, c = index ? index.getX(t + 2) : t + 2;
    if (!isWheel(a) || !isWheel(b) || !isWheel(c)) continue;
    join(a, b);
    join(b, c);
  }
  // Vertices split for flat shading sit at the same point.
  const at = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    if (!isWheel(i)) continue;
    const key = `${Math.round(pos.getX(i) * 500)},${Math.round(pos.getY(i) * 500)},${Math.round(pos.getZ(i) * 500)}`;
    const j = at.get(key);
    if (j === undefined) at.set(key, i);
    else join(i, j);
  }
  // Each piece's extent: x0, x1, y0, y1, z0, z1.
  const box = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (!isWheel(i)) continue;
    const r = find(i);
    let b = box.get(r);
    if (!b) box.set(r, (b = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    b[0] = Math.min(b[0], x); b[1] = Math.max(b[1], x);
    b[2] = Math.min(b[2], y); b[3] = Math.max(b[3], y);
    b[4] = Math.min(b[4], z); b[5] = Math.max(b[5], z);
  }
  // Small pieces on a wheel (bolts, hub caps) turn with the wheel they sit on: the biggest piece
  // on the same side whose outline contains them.
  const pieces = [...box.entries()].sort((p, q) => q[1][1] - q[1][0] - (p[1][1] - p[1][0]));
  const centre = new Map<number, [number, number]>();
  for (const [r, b] of pieces) {
    const cx = (b[0] + b[1]) / 2, cy = (b[2] + b[3]) / 2, cz = (b[4] + b[5]) / 2;
    let host: number[] | null = null;
    for (const [, o] of pieces) {
      if (o === b || o[1] - o[0] <= b[1] - b[0]) break;
      if (cx >= o[0] && cx <= o[1] && cy >= o[2] && cy <= o[3] && cz >= o[4] - 0.15 && cz <= o[5] + 0.15) {
        host = o;
        break;
      }
    }
    const h = host ?? b;
    centre.set(r, [(h[0] + h[1]) / 2, (h[2] + h[3]) / 2]);
  }
  for (let i = 0; i < n; i++) {
    if (!isWheel(i)) continue;
    const c = centre.get(find(i))!;
    out[i * 2] = c[0];
    out[i * 2 + 1] = c[1];
  }
  g.setAttribute('aWheel', new THREE.BufferAttribute(out, 2));
}

/** A person model, kept indexed, with its parts tagged for the people shader (aSlot, aLimb, aOpt). */
function convertPerson(root: THREE.Object3D): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const src = mesh.geometry;
    const groups = src.groups.length ? src.groups : [{ start: 0, count: src.index ? src.index.count : src.getAttribute('position').count, materialIndex: 0 }];
    for (const grp of groups) {
      const mat = mats[grp.materialIndex ?? 0];
      const [, slot, limb, opt] = (mat?.name ?? '').split('_');
      let g = src.index ? extractGroup(src, grp.start, grp.count) : src.clone();
      g.applyMatrix4(mesh.matrixWorld);
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      // Each vertex may say what it is in its colour (slot, limb, option, weight toward the limb's parent; tenths).
      const data = g.getAttribute('color');
      const perVertex = data && data.itemSize === 4 ? Float32Array.from({ length: data.count * 4 }, (_, k) => data.getComponent(Math.floor(k / 4), k % 4)) : null;
      for (const key of Object.keys(g.attributes)) if (key !== 'position' && key !== 'normal') g.deleteAttribute(key);
      tagPerson(g, Math.max(0, PERSON_SLOTS.indexOf(slot)), Math.max(0, PERSON_LIMBS.indexOf(limb)), Math.max(0, PERSON_OPTIONS.indexOf(opt)));
      if (perVertex) {
        const n = g.getAttribute('position').count;
        const sl = g.getAttribute('aSlot').array as Float32Array, li = g.getAttribute('aLimb').array as Float32Array;
        const op = g.getAttribute('aOpt').array as Float32Array, bl = g.getAttribute('aBlend').array as Float32Array;
        for (let i = 0; i < n; i++) {
          sl[i] = Math.round(perVertex[i * 4] * 10);
          li[i] = Math.round(perVertex[i * 4 + 1] * 10);
          op[i] = Math.round(perVertex[i * 4 + 2] * 10);
          bl[i] = perVertex[i * 4 + 3];
        }
      }
      if (!g.index) g = mergeVertices(g);
      parts.push(g);
    }
  });
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  merged?.computeBoundingSphere();
  return merged;
}

export function tagPerson(g: THREE.BufferGeometry, slot: number, limb: number, opt: number, blend = 0): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  g.setAttribute('aSlot', new THREE.BufferAttribute(new Float32Array(n).fill(slot), 1));
  g.setAttribute('aLimb', new THREE.BufferAttribute(new Float32Array(n).fill(limb), 1));
  g.setAttribute('aOpt', new THREE.BufferAttribute(new Float32Array(n).fill(opt), 1));
  g.setAttribute('aBlend', new THREE.BufferAttribute(new Float32Array(n).fill(blend), 1));
  return g;
}

function extractGroup(src: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(src.attributes)) g.setAttribute(k, a.clone());
  const idx = src.index!;
  const arr = new Uint32Array(count);
  for (let i = 0; i < count; i++) arr[i] = idx.getX(start + i);
  g.setIndex(new THREE.BufferAttribute(arr, 1));
  return g;
}

/** Leaf atlas: three alpha leaf-cluster tiles and one solid white tile. */
function createLeafTexture(): THREE.CanvasTexture {
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  const half = size / 2;
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const tiles: [number, number][] = [[0, 0], [half, 0], [0, half]];
  for (const [tx, ty] of tiles) {
    // Canvas y grows downward; UV v grows upward, so tiles map with a flip handled by flipY.
    for (let i = 0; i < 150; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * half * 0.44;
      const x = tx + half / 2 + Math.cos(a) * r;
      const y = ty + half / 2 + Math.sin(a) * r;
      const len = 10 + rnd() * 14;
      const wid = len * (0.42 + rnd() * 0.18);
      const l = 62 + rnd() * 34;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rnd() * Math.PI * 2);
      ctx.fillStyle = `hsl(${78 + rnd() * 30}, ${18 + rnd() * 20}%, ${l}%)`;
      ctx.beginPath();
      ctx.ellipse(0, 0, len, wid, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(40,60,30,0.35)`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-len * 0.9, 0);
      ctx.lineTo(len * 0.9, 0);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(half, half, half, half);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

// ── Procedural fallbacks ────────────────────────────────────────────────────

function colorize(g: THREE.BufferGeometry, c: [number, number, number], kind: number): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(n).fill(kind), 1));
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, c: [number, number, number], kind: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return colorize(g, c, kind);
}

function fallback(name: AssetName): THREE.BufferGeometry {
  const grey: [number, number, number] = [0.6, 0.6, 0.6];
  const parts: THREE.BufferGeometry[] = [];
  const L: Record<string, number> = { sedan: 4.6, hatchback: 4, suv: 4.8, police: 4.8, van: 5.2, ambulance: 6.2, truck: 8.5, garbage: 8, firetruck: 9, bus: 12, pickup: 5.3, taxi: 4.7, delivery: 6.4, mini: 3.45 };
  if (name in L) {
    const len = L[name];
    const tall = ['van', 'ambulance', 'truck', 'garbage', 'firetruck', 'bus', 'delivery'].includes(name) ? 2.6 : 1.1;
    parts.push(box(len, tall * 0.55, 1.8, 0, 0.35 + tall * 0.27, 0, [0.8, 0.8, 0.8], MATK.tint));
    parts.push(box(len * 0.55, tall * 0.42, 1.6, -len * 0.05, 0.35 + tall * 0.75, 0, [0.08, 0.1, 0.12], MATK.glass));
  } else if (name === 'oak' || name === 'maple' || name === 'tree_lod' || name === 'bush') {
    const s = name === 'bush' ? 0.3 : 1;
    const trunk = new THREE.CylinderGeometry(0.15 * s, 0.25 * s, 3 * s, 6);
    trunk.translate(0, 1.5 * s, 0);
    parts.push(colorize(trunk, [0.25, 0.18, 0.12], MATK.fixed));
    const crown = new THREE.IcosahedronGeometry(2.6 * s, 1);
    crown.translate(0, 5 * s, 0);
    parts.push(colorize(crown, [0.2, 0.36, 0.12], MATK.fixed));
  } else if (name === 'pine' || name === 'pine_lod') {
    const trunk = new THREE.CylinderGeometry(0.15, 0.22, 2, 6);
    trunk.translate(0, 1, 0);
    parts.push(colorize(trunk, [0.25, 0.18, 0.12], MATK.fixed));
    const cone = new THREE.ConeGeometry(2.2, 8, 8);
    cone.translate(0, 6, 0);
    parts.push(colorize(cone, [0.09, 0.2, 0.11], MATK.fixed));
  } else if (name === 'bus_stop') {
    parts.push(box(3.8, 0.1, 1.6, 0, 2.45, 0, [0.42, 0.43, 0.45], MATK.fixed));
    parts.push(box(3.8, 2.0, 0.05, 0, 1.2, -0.7, [0.06, 0.08, 0.1], MATK.glass));
  } else if (name === 'bike') {
    parts.push(box(1.7, 0.05, 0.05, 0, 0.6, 0, [0.15, 0.15, 0.16], MATK.fixed));
    parts.push(box(0.35, 0.6, 0.3, -0.1, 1.15, 0, [0.8, 0.8, 0.8], MATK.tint));
  } else if (name === 'bench') {
    parts.push(box(1.8, 0.06, 0.45, 0, 0.46, 0, [0.55, 0.38, 0.22], MATK.fixed));
    parts.push(box(1.8, 0.35, 0.05, 0, 0.75, 0.24, [0.55, 0.38, 0.22], MATK.fixed));
  } else if (name === 'bin') {
    parts.push(box(0.5, 0.95, 0.5, 0, 0.47, 0, [0.13, 0.24, 0.17], MATK.fixed));
  } else if (name === 'planter') {
    parts.push(box(1.4, 0.55, 0.7, 0, 0.27, 0, [0.6, 0.59, 0.56], MATK.fixed));
    parts.push(box(1.2, 0.4, 0.55, 0, 0.75, 0, [0.18, 0.3, 0.1], MATK.fixed));
  } else if (name === 'streetlight') {
    parts.push(box(0.15, 8.2, 0.15, 0, 4.1, 0, [0.16, 0.17, 0.18], MATK.fixed));
    parts.push(box(1.9, 0.08, 0.08, 0.9, 8, 0, [0.16, 0.17, 0.18], MATK.fixed));
    parts.push(box(0.6, 0.06, 0.25, 1.95, 7.9, 0, [1, 0.92, 0.75], MATK.lamp));
  } else if (name === 'signal') {
    parts.push(box(0.25, 6, 0.25, 0, 3, 0, [0.16, 0.17, 0.18], MATK.fixed));
    parts.push(box(4.2, 0.1, 0.1, 2.1, 5.85, 0, [0.16, 0.17, 0.18], MATK.fixed));
    parts.push(box(0.32, 0.95, 0.3, 3.9, 5.3, 0, [0.06, 0.06, 0.06], MATK.fixed));
  } else if (name === 'crane') {
    parts.push(box(1.6, 42, 1.6, 0, 21, 0, [0.93, 0.68, 0.08], MATK.fixed));
    parts.push(box(34, 0.9, 0.9, 17, 43.8, 0, [0.93, 0.68, 0.08], MATK.fixed));
  } else if (name === 'wind_tower') {
    const t = new THREE.CylinderGeometry(0.9, 1.6, 48, 12);
    t.translate(0, 24, 0);
    parts.push(colorize(t, [0.92, 0.92, 0.9], MATK.fixed));
    parts.push(box(5, 2.2, 2.1, -0.6, 48.8, 0, [0.92, 0.92, 0.9], MATK.fixed));
  } else if (name === 'sailboat' || name === 'motorboat') {
    parts.push(box(name === 'sailboat' ? 9 : 7, 1, 2.6, 0, 0.5, 0, [0.92, 0.92, 0.9], MATK.fixed));
    if (name === 'sailboat') parts.push(box(0.15, 10, 0.15, 0.6, 6, 0, [0.42, 0.43, 0.45], MATK.fixed));
  } else if (name === 'container_ship') {
    parts.push(box(118, 11, 19, 0, 5.5, 0, [0.8, 0.8, 0.8], MATK.tint));
    parts.push(box(86, 10, 17, 4, 16, 0, [0.55, 0.1, 0.07], MATK.fixed));
    parts.push(box(11, 13, 16, -45, 17.5, 0, [0.92, 0.92, 0.9], MATK.fixed));
  } else if (name === 'airliner') {
    parts.push(box(32, 3.4, 3.4, 0, 3, 0, [0.92, 0.92, 0.9], MATK.fixed));
    parts.push(box(6, 0.4, 29, -2.5, 2.1, 0, [0.92, 0.92, 0.9], MATK.fixed));
    parts.push(box(4, 6, 0.3, -15, 6.5, 0, [0.8, 0.8, 0.8], MATK.tint));
  } else if (PEOPLE.includes(name)) {
    const h = name === 'person_child' ? 0.74 : 1;
    const piece = (g: THREE.BufferGeometry, x: number, y: number, z: number, slot: number, limb: number) => {
      g.translate(x, y, z);
      return tagPerson(g, slot, limb, 0);
    };
    const people: THREE.BufferGeometry[] = [
      piece(new THREE.CylinderGeometry(0.07, 0.06, 0.88 * h, 6), 0, 0.47 * h, -0.1, 1, 2),
      piece(new THREE.CylinderGeometry(0.07, 0.06, 0.88 * h, 6), 0, 0.47 * h, 0.1, 1, 4),
      piece(new THREE.CapsuleGeometry(0.17, 0.32 * h, 3, 8), 0, 1.17 * h, 0, 0, 0),
      piece(new THREE.SphereGeometry(0.11, 8, 6), 0, 1.6 * h, 0, 2, 1),
    ];
    const merged = mergeGeometries(people.map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'aSlot', 'aLimb', 'aOpt', 'aBlend'].includes(k)) g.deleteAttribute(k); return g; }), false)!;
    merged.computeBoundingSphere();
    return merged;
  } else if (name === 'wind_rotor') {
    for (let k = 0; k < 3; k++) {
      const b = new THREE.BoxGeometry(0.2, 27, 1.2);
      b.translate(0, 13.5, 0);
      b.rotateX((k * Math.PI * 2) / 3);
      parts.push(colorize(b, [0.92, 0.92, 0.9], MATK.fixed));
    }
  } else {
    parts.push(box(1, 1, 1, 0, 0.5, 0, grey, MATK.fixed));
  }
  const merged = mergeGeometries(parts, false)!;
  merged.computeBoundingSphere();
  return merged;
}
