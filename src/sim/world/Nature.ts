import { type OBB, type Polyline, obbBounds, pointInOBB } from '../../core/geom2d';
import { Rng } from '../../core/rng';
import { CHUNKS, CHUNK_SIZE, GRID_CELL, GRID_RES, WATER_LEVEL } from '../constants';
import { rasterizePolyline } from '../roads/rasterize';
import type { Rect, Terrain } from './Terrain';

export enum TreeKind {
  Oak = 0,
  Maple = 1,
  Pine = 2,
  Bush = 3,
}

const BUCKET = 16;
const BUCKET_RES = GRID_RES;
/** Days for a planted sapling to reach full size. */
export const TREE_GROW_DAYS = 60;
/** Saplings start at this fraction of their final size. */
const SAPLING = 0.4;

/**
 * Vegetation: natural trees scattered procedurally from the seed (cleared
 * where the city builds) plus trees the player plants, which grow from
 * saplings over a couple of months.
 */
export class Nature {
  count = 0;
  /** Trees [0, naturalCount) come from the map seed; later ones were planted. */
  readonly naturalCount: number;
  x = new Float32Array(0);
  z = new Float32Array(0);
  kind = new Uint8Array(0);
  scale = new Float32Array(0);
  rot = new Float32Array(0);
  alive = new Uint8Array(0);
  chunk = new Uint16Array(0);
  /** Day a tree was planted (natural trees: -1e6, long grown). */
  planted = new Float32Array(0);
  /** Alive trees per analysis-grid cell (for land value and pollution). */
  readonly cells = new Uint16Array(GRID_RES * GRID_RES);
  /** Per 16 m bucket: start offset and count into `order` (natural trees). */
  private bucketStart = new Int32Array(BUCKET_RES * BUCKET_RES + 1);
  private order = new Int32Array(0);
  /** Planted trees by bucket. */
  private extra = new Map<number, number[]>();
  private byChunk: number[][] | null = null;
  /** Chunks with saplings still growing. */
  private growing = new Set<number>();
  readonly dirtyChunks = new Set<number>();
  readonly rng: Rng;
  /** Bumped when trees are added (index lists change). */
  version = 0;

  constructor(terrain: Terrain, seed: number) {
    const rng = new Rng(seed ^ 0x7ee5);
    this.rng = new Rng(seed ^ 0x51ab);
    const xs: number[] = [];
    const zs: number[] = [];
    const ks: number[] = [];
    const ss: number[] = [];
    for (let iz = 0; iz < GRID_RES; iz++) {
      for (let ix = 0; ix < GRID_RES; ix++) {
        const f = terrain.forest[iz * GRID_RES + ix];
        let n = Math.floor(f * 3.4 + rng.next());
        if (f < 0.05 && rng.next() < 0.04) n = 1;
        for (let k = 0; k < n; k++) {
          const x = (ix + rng.next()) * GRID_CELL;
          const z = (iz + rng.next()) * GRID_CELL;
          const h = terrain.sampleBase(x, z);
          if (h < WATER_LEVEL + 1.2) continue;
          if (terrain.slopeAt(x, z) > 0.6) continue;
          const high = h > 32 ? 0.75 : h > 18 ? 0.35 : 0.12;
          let kind: TreeKind;
          const r = rng.next();
          if (r < high) kind = TreeKind.Pine;
          else if (f < 0.25 && rng.next() < 0.35) kind = TreeKind.Bush;
          else kind = rng.next() < 0.55 ? TreeKind.Oak : TreeKind.Maple;
          xs.push(x);
          zs.push(z);
          ks.push(kind);
          ss.push(kind === TreeKind.Bush ? rng.range(0.7, 1.2) : rng.range(0.75, 1.35));
        }
      }
    }
    const n = xs.length;
    this.count = n;
    this.naturalCount = n;
    this.x = Float32Array.from(xs);
    this.z = Float32Array.from(zs);
    this.kind = Uint8Array.from(ks);
    this.scale = Float32Array.from(ss);
    this.rot = new Float32Array(n);
    for (let i = 0; i < n; i++) this.rot[i] = rng.next() * Math.PI * 2;
    this.alive = new Uint8Array(n).fill(1);
    this.planted = new Float32Array(n).fill(-1e6);
    this.chunk = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      this.chunk[i] = chunkOf(this.x[i], this.z[i]);
      this.cells[cellOf(this.x[i], this.z[i])]++;
    }
    // Bucket index for fast clearing queries.
    const counts = new Int32Array(BUCKET_RES * BUCKET_RES);
    for (let i = 0; i < n; i++) counts[bucketOf(this.x[i], this.z[i])]++;
    let acc = 0;
    for (let b = 0; b < counts.length; b++) {
      this.bucketStart[b] = acc;
      acc += counts[b];
    }
    this.bucketStart[counts.length] = acc;
    this.order = new Int32Array(n);
    const fill = new Int32Array(counts.length);
    for (let i = 0; i < n; i++) {
      const b = bucketOf(this.x[i], this.z[i]);
      this.order[this.bucketStart[b] + fill[b]++] = i;
    }
  }

  private forBucket(bx: number, bz: number, fn: (i: number) => void): void {
    if (bx < 0 || bz < 0 || bx >= BUCKET_RES || bz >= BUCKET_RES) return;
    const b = bz * BUCKET_RES + bx;
    for (let k = this.bucketStart[b]; k < this.bucketStart[b + 1]; k++) fn(this.order[k]);
    const ex = this.extra.get(b);
    if (ex) for (const i of ex) fn(i);
  }

  /** Calls `fn` for every tree (alive or not) whose base is in chunk `ch`. */
  forChunk(ch: number, fn: (i: number) => void): void {
    if (!this.byChunk) {
      this.byChunk = Array.from({ length: CHUNKS * CHUNKS }, () => []);
      for (let i = 0; i < this.count; i++) this.byChunk[this.chunk[i]].push(i);
    }
    for (const i of this.byChunk[ch]) fn(i);
  }

  private kill(i: number): void {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.dirtyChunks.add(this.chunk[i]);
    const c = cellOf(this.x[i], this.z[i]);
    if (this.cells[c]) this.cells[c]--;
  }

  /** Size multiplier for a tree today (saplings grow to full size). */
  growth(i: number, day: number): number {
    const age = day - this.planted[i];
    return age >= TREE_GROW_DAYS ? 1 : SAPLING + (1 - SAPLING) * Math.max(0, age) / TREE_GROW_DAYS;
  }

  /** Re-renders chunks with growing saplings; call once a day. */
  grow(day: number): void {
    for (const ch of [...this.growing]) {
      this.dirtyChunks.add(ch);
      let still = false;
      this.forChunk(ch, (i) => {
        if (this.alive[i] && day - this.planted[i] < TREE_GROW_DAYS) still = true;
      });
      if (!still) this.growing.delete(ch);
    }
  }

  private ensureCapacity(n: number): void {
    if (n <= this.x.length) return;
    const cap = Math.max(n, Math.ceil(this.x.length * 1.25) + 256);
    const grow = <T extends Float32Array | Uint8Array | Uint16Array>(a: T, make: (len: number) => T): T => {
      const b = make(cap);
      b.set(a);
      return b;
    };
    this.x = grow(this.x, (l) => new Float32Array(l));
    this.z = grow(this.z, (l) => new Float32Array(l));
    this.kind = grow(this.kind, (l) => new Uint8Array(l));
    this.scale = grow(this.scale, (l) => new Float32Array(l));
    this.rot = grow(this.rot, (l) => new Float32Array(l));
    this.alive = grow(this.alive, (l) => new Uint8Array(l));
    this.chunk = grow(this.chunk, (l) => new Uint16Array(l));
    this.planted = grow(this.planted, (l) => new Float32Array(l));
  }

  /** Adds a planted tree; returns its index. */
  add(x: number, z: number, kind: TreeKind, scale: number, rot: number, day: number): number {
    this.ensureCapacity(this.count + 1);
    const i = this.count++;
    this.x[i] = x;
    this.z[i] = z;
    this.kind[i] = kind;
    this.scale[i] = scale;
    this.rot[i] = rot;
    this.alive[i] = 1;
    this.planted[i] = day;
    const ch = chunkOf(x, z);
    this.chunk[i] = ch;
    this.cells[cellOf(x, z)]++;
    const b = bucketOf(x, z);
    const ex = this.extra.get(b);
    if (ex) ex.push(i);
    else this.extra.set(b, [i]);
    this.byChunk?.[ch].push(i);
    this.dirtyChunks.add(ch);
    if (day - this.planted[i] < TREE_GROW_DAYS) this.growing.add(ch);
    this.version++;
    return i;
  }

  /** Distance from a point to the nearest living tree, searched up to `max` metres. */
  nearestTree(x: number, z: number, max: number): number {
    let best = max;
    const b0x = Math.floor((x - max) / BUCKET), b1x = Math.floor((x + max) / BUCKET);
    const b0z = Math.floor((z - max) / BUCKET), b1z = Math.floor((z + max) / BUCKET);
    for (let bz = b0z; bz <= b1z; bz++) {
      for (let bx = b0x; bx <= b1x; bx++) {
        this.forBucket(bx, bz, (i) => {
          if (!this.alive[i]) return;
          const d = Math.hypot(this.x[i] - x, this.z[i] - z);
          if (d < best) best = d;
        });
      }
    }
    return best;
  }

  /** Removes living trees within a disc; returns how many. */
  clearDisc(x: number, z: number, r: number): number {
    let n = 0;
    const b0x = Math.floor((x - r) / BUCKET), b1x = Math.floor((x + r) / BUCKET);
    const b0z = Math.floor((z - r) / BUCKET), b1z = Math.floor((z + r) / BUCKET);
    for (let bz = b0z; bz <= b1z; bz++) {
      for (let bx = b0x; bx <= b1x; bx++) {
        this.forBucket(bx, bz, (i) => {
          if (this.alive[i] && Math.hypot(this.x[i] - x, this.z[i] - z) < r) {
            this.kill(i);
            n++;
          }
        });
      }
    }
    return n;
  }

  /** Counts living trees within a disc. */
  countDisc(x: number, z: number, r: number): number {
    let n = 0;
    const b0x = Math.floor((x - r) / BUCKET), b1x = Math.floor((x + r) / BUCKET);
    const b0z = Math.floor((z - r) / BUCKET), b1z = Math.floor((z + r) / BUCKET);
    for (let bz = b0z; bz <= b1z; bz++) {
      for (let bx = b0x; bx <= b1x; bx++) {
        this.forBucket(bx, bz, (i) => {
          if (this.alive[i] && Math.hypot(this.x[i] - x, this.z[i] - z) < r) n++;
        });
      }
    }
    return n;
  }

  clearAlong(poly: Polyline, radius: number): number {
    let n = 0;
    const seen = new Set<number>();
    rasterizePolyline(poly, radius + BUCKET, { cell: BUCKET, res: BUCKET_RES, centered: true }, null, (bx, bz) => {
      const key = bz * BUCKET_RES + bx;
      if (seen.has(key)) return;
      seen.add(key);
      this.forBucket(bx, bz, (i) => {
        if (!this.alive[i]) return;
        // Exact distance test against the polyline.
        const pts = poly.pts;
        for (let k = 0; k < poly.count - 1; k++) {
          const x0 = pts[k * 2], z0 = pts[k * 2 + 1], x1 = pts[k * 2 + 2], z1 = pts[k * 2 + 3];
          const dx = x1 - x0, dz = z1 - z0;
          const l2 = dx * dx + dz * dz;
          let f = l2 > 0 ? ((this.x[i] - x0) * dx + (this.z[i] - z0) * dz) / l2 : 0;
          f = Math.max(0, Math.min(1, f));
          const qx = x0 + dx * f - this.x[i], qz = z0 + dz * f - this.z[i];
          if (qx * qx + qz * qz < radius * radius) {
            this.kill(i);
            n++;
            break;
          }
        }
      });
    });
    return n;
  }

  clearOBB(o: OBB, margin: number): number {
    const [minX, minZ, maxX, maxZ] = obbBounds(o);
    let n = 0;
    for (let bz = Math.floor((minZ - margin) / BUCKET); bz <= Math.floor((maxZ + margin) / BUCKET); bz++) {
      for (let bx = Math.floor((minX - margin) / BUCKET); bx <= Math.floor((maxX + margin) / BUCKET); bx++) {
        this.forBucket(bx, bz, (i) => {
          if (this.alive[i] && pointInOBB(o, this.x[i], this.z[i], margin)) {
            this.kill(i);
            n++;
          }
        });
      }
    }
    return n;
  }

  /** Clears trees in a rectangle that match `pred`, and re-seats the others. */
  clearWhere(r: Rect, pred: (x: number, z: number) => boolean): number {
    let n = 0;
    for (let bz = Math.floor(r.minZ / BUCKET); bz <= Math.floor(r.maxZ / BUCKET); bz++) {
      for (let bx = Math.floor(r.minX / BUCKET); bx <= Math.floor(r.maxX / BUCKET); bx++) {
        this.forBucket(bx, bz, (i) => {
          if (!this.alive[i]) return;
          if (this.x[i] < r.minX || this.x[i] > r.maxX || this.z[i] < r.minZ || this.z[i] > r.maxZ) return;
          if (pred(this.x[i], this.z[i])) {
            this.kill(i);
            n++;
          } else {
            this.dirtyChunks.add(this.chunk[i]);
          }
        });
      }
    }
    return n;
  }

  aliveCount(): number {
    let n = 0;
    for (let i = 0; i < this.count; i++) n += this.alive[i];
    return n;
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  /** Living planted trees as [x, z, scale, rot, plantedDay] plus kinds. */
  serializePlanted(): { data: Float32Array; kinds: Uint8Array } {
    const idx: number[] = [];
    for (let i = this.naturalCount; i < this.count; i++) if (this.alive[i]) idx.push(i);
    const data = new Float32Array(idx.length * 5);
    const kinds = new Uint8Array(idx.length);
    idx.forEach((i, k) => {
      data.set([this.x[i], this.z[i], this.scale[i], this.rot[i], this.planted[i]], k * 5);
      kinds[k] = this.kind[i];
    });
    return { data, kinds };
  }

  /** Restores which natural trees were removed, and the planted ones. */
  load(naturalAlive: Uint8Array | null, planted: { data: Float32Array; kinds: Uint8Array } | null): void {
    if (naturalAlive) {
      for (let i = 0; i < this.naturalCount && i < naturalAlive.length; i++) if (!naturalAlive[i]) this.kill(i);
    }
    if (planted) {
      for (let k = 0; k < planted.kinds.length; k++) {
        const o = k * 5;
        this.add(planted.data[o], planted.data[o + 1], planted.kinds[k] as TreeKind, planted.data[o + 2], planted.data[o + 3], planted.data[o + 4]);
      }
    }
  }
}

function bucketOf(x: number, z: number): number {
  return Math.min(BUCKET_RES - 1, Math.max(0, Math.floor(z / BUCKET))) * BUCKET_RES + Math.min(BUCKET_RES - 1, Math.max(0, Math.floor(x / BUCKET)));
}

function cellOf(x: number, z: number): number {
  return Math.min(GRID_RES - 1, Math.max(0, Math.floor(z / GRID_CELL))) * GRID_RES + Math.min(GRID_RES - 1, Math.max(0, Math.floor(x / GRID_CELL)));
}

function chunkOf(x: number, z: number): number {
  const cx = Math.min(CHUNKS - 1, Math.max(0, Math.floor(x / CHUNK_SIZE)));
  const cz = Math.min(CHUNKS - 1, Math.max(0, Math.floor(z / CHUNK_SIZE)));
  return cz * CHUNKS + cx;
}
