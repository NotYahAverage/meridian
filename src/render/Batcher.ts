import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Fewer draw calls for chunked geometry. Every block of BLOCK × BLOCK chunks that has stopped
 * changing for a moment is drawn as one merged mesh instead of up to four; as soon as anything in
 * the block changes (a rebuild, a switch of detail, a terrain edit) its chunks are drawn on their
 * own again until it settles. Merges are spread out, one a frame, so none of them stalls a frame.
 *
 * The owner keeps choosing which mesh each chunk shows (and its shadow flag); the batcher only
 * swaps a settled block's visible meshes for their merged copy, after the owner has set them.
 */
/** About 6 ms of merging (measured: ~25k vertices a millisecond). */
const MAX_MERGE_VERTS = 150_000;

export class Batcher {
  private blocks: Block[] = [];

  constructor(
    private group: THREE.Group,
    chunks: number,
    private opts: { material: THREE.Material; depthMaterial?: THREE.Material; receiveShadow: boolean; block?: number; settle?: number },
  ) {
    const b = opts.block ?? 2;
    const n = Math.ceil(chunks / b);
    for (let bz = 0; bz < n; bz++) {
      for (let bx = 0; bx < n; bx++) {
        const members: number[] = [];
        for (let dz = 0; dz < b; dz++) for (let dx = 0; dx < b; dx++) {
          const cx = bx * b + dx, cz = bz * b + dz;
          if (cx < chunks && cz < chunks) members.push(cz * chunks + cx);
        }
        this.blocks.push({ members, key: 0, settled: 0, merged: null, mergedKey: 0 });
      }
    }
  }

  /** Draw calls saved this frame (for profiling). */
  saved = 0;

  /**
   * After the owner has set each chunk's meshes for this frame. `shown(ch)` lists the meshes the
   * chunk is drawing (visible ones) — the batcher merges those and hides them while merged.
   */
  update(dt: number, shown: (ch: number) => THREE.Mesh[]): void {
    const settle = this.opts.settle ?? 1.5;
    let merges = 0;
    this.saved = 0;
    for (const bl of this.blocks) {
      const meshes: THREE.Mesh[] = [];
      for (const ch of bl.members) for (const m of shown(ch)) meshes.push(m);
      let key = meshes.length;
      for (const m of meshes) key = (Math.imul(key, 31) + signature(m)) | 0;
      if (key !== bl.key) {
        bl.key = key;
        bl.settled = 0;
      } else bl.settled += dt;
      // Big blocks (a dense downtown) stay as they are: merging one would take long enough to show.
      let verts = 0;
      for (const m of meshes) verts += m.geometry.attributes.position.count;
      const ready = meshes.length > 1 && bl.settled >= settle && verts <= MAX_MERGE_VERTS;
      if (ready && bl.mergedKey !== key && merges < 1) {
        this.merge(bl, meshes, key);
        merges++;
      }
      const use = ready && bl.merged !== null && bl.mergedKey === key;
      if (bl.merged) {
        bl.merged.visible = use;
        if (use) bl.merged.castShadow = meshes.some((m) => m.castShadow);
      }
      if (use) {
        for (const m of meshes) m.visible = false;
        this.saved += meshes.length - 1;
      }
    }
  }

  private merge(bl: Block, meshes: THREE.Mesh[], key: number): void {
    this.drop(bl);
    bl.mergedKey = key;
    const geos = meshes.map((m) => m.geometry);
    // Mixed layouts (one indexed, one not; differing attributes) aren't merged: drawn as they are.
    const merged = mergeGeometries(geos, false);
    if (!merged) return;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, this.opts.material);
    if (this.opts.depthMaterial) mesh.customDepthMaterial = this.opts.depthMaterial;
    mesh.receiveShadow = this.opts.receiveShadow;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    mesh.name = 'batch';
    this.group.add(mesh);
    bl.merged = mesh;
  }

  private drop(bl: Block): void {
    if (!bl.merged) return;
    this.group.remove(bl.merged);
    bl.merged.geometry.dispose();
    bl.merged = null;
    bl.mergedKey = 0;
  }

  dispose(): void {
    for (const bl of this.blocks) this.drop(bl);
  }
}

interface Block {
  members: number[];
  /** What the block showed last frame, and for how long it has stayed the same. */
  key: number;
  settled: number;
  merged: THREE.Mesh | null;
  /** What the merged mesh was made from. */
  mergedKey: number;
}

/** Changes whenever a mesh's geometry is swapped, re-indexed (detail level) or its vertices rewritten. */
function signature(m: THREE.Mesh): number {
  const g = m.geometry;
  const ix = g.index ? g.index.count * 7 + g.index.version : 0;
  return (Math.imul(g.id, 1_000_003) + Math.imul(ix, 8_191) + (g.attributes.position as THREE.BufferAttribute).version) | 0;
}
