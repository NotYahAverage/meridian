/** Min-heap of integer items keyed by float priority. Allocation-free after warm-up. */
export class BinaryHeap {
  private items: number[] = [];
  private prio: number[] = [];

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
    this.prio.length = 0;
  }

  push(item: number, priority: number): void {
    const items = this.items;
    const prio = this.prio;
    let i = items.length;
    items.push(item);
    prio.push(priority);
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
    const lastItem = items.pop()!;
    const lastPrio = prio.pop()!;
    const n = items.length;
    if (n > 0) {
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
