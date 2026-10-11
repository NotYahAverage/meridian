/** Min-heap of integer items keyed by float priority. Allocation-free after warm-up. */
export class BinaryHeap {
  private items = new Int32Array(256);
  private prio = new Float64Array(256);
  private n = 0;

  get size(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
  }

  push(item: number, priority: number): void {
    if (this.n === this.items.length) {
      const items = new Int32Array(this.n * 2);
      const prio = new Float64Array(this.n * 2);
      items.set(this.items);
      prio.set(this.prio);
      this.items = items;
      this.prio = prio;
    }
    const items = this.items;
    const prio = this.prio;
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (prio[p] <= priority) break;
      items[i] = items[p];
      prio[i] = prio[p];
      i = p;
    }
    items[i] = item;
    prio[i] = priority;
  }

  peekPriority(): number {
    return this.prio[0];
  }

  pop(): number {
    const items = this.items;
    const prio = this.prio;
    const top = items[0];
    const n = --this.n;
    if (n > 0) {
      const lastItem = items[n];
      const lastPrio = prio[n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && prio[r] < prio[l] ? r : l;
        if (prio[c] >= lastPrio) break;
        items[i] = items[c];
        prio[i] = prio[c];
        i = c;
      }
      items[i] = lastItem;
      prio[i] = lastPrio;
    }
    return top;
  }
}
