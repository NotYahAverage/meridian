/**
 * Uniform-grid spatial hash for axis-aligned bounds. Items are referenced by
 * integer id; each item may span multiple cells. Queries de-duplicate results.
 */
export class SpatialHash {
  private cells = new Map<number, number[]>();
  private bounds = new Map<number, [number, number, number, number]>();
  private stamp = new Map<number, number>();
  private queryId = 0;

  constructor(readonly cellSize: number) {}

  private key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  get size(): number {
    return this.bounds.size;
  }

  has(id: number): boolean {
    return this.bounds.has(id);
  }

  insert(id: number, minX: number, minZ: number, maxX: number, maxZ: number): void {
    if (this.bounds.has(id)) this.remove(id);
    this.bounds.set(id, [minX, minZ, maxX, maxZ]);
    const cs = this.cellSize;
    const x0 = Math.floor(minX / cs);
    const z0 = Math.floor(minZ / cs);
    const x1 = Math.floor(maxX / cs);
    const z1 = Math.floor(maxZ / cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        let list = this.cells.get(k);
        if (!list) {
          list = [];
          this.cells.set(k, list);
        }
        list.push(id);
      }
    }
  }

  remove(id: number): void {
    const b = this.bounds.get(id);
    if (!b) return;
    this.bounds.delete(id);
    this.stamp.delete(id);
    const cs = this.cellSize;
    const x0 = Math.floor(b[0] / cs);
    const z0 = Math.floor(b[1] / cs);
    const x1 = Math.floor(b[2] / cs);
    const z1 = Math.floor(b[3] / cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        const list = this.cells.get(k);
        if (!list) continue;
        const i = list.indexOf(id);
        if (i >= 0) {
          list[i] = list[list.length - 1];
          list.pop();
        }
        if (list.length === 0) this.cells.delete(k);
      }
    }
  }

  /** Returns ids whose bounds overlap the query rectangle. */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: number[] = []): number[] {
    const qid = ++this.queryId;
    const cs = this.cellSize;
    const x0 = Math.floor(minX / cs);
    const z0 = Math.floor(minZ / cs);
    const x1 = Math.floor(maxX / cs);
    const z1 = Math.floor(maxZ / cs);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = this.cells.get(this.key(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const id = list[i];
          if (this.stamp.get(id) === qid) continue;
          this.stamp.set(id, qid);
          const b = this.bounds.get(id)!;
          if (b[2] < minX || b[0] > maxX || b[3] < minZ || b[1] > maxZ) continue;
          out.push(id);
        }
      }
    }
    return out;
  }

  queryRadius(x: number, z: number, r: number, out: number[] = []): number[] {
    return this.query(x - r, z - r, x + r, z + r, out);
  }

  clear(): void {
    this.cells.clear();
    this.bounds.clear();
    this.stamp.clear();
  }
}
