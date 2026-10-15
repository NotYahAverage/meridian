/**
 * Households stored as a structure of typed arrays. Each household lives in a
 * residential building and has up to two workers, each of whom may hold a job.
 */
export class Population {
  capacity = 0;
  /** Highest slot index in use + 1. */
  count = 0;
  home = new Int32Array(0);
  size = new Uint8Array(0);
  workers = new Uint8Array(0);
  educated = new Uint8Array(0);
  /** Two job slots per household (building id, 0 = none). */
  job = new Int32Array(0);
  wealth = new Uint8Array(0);
  alive = new Uint8Array(0);
  happiness = new Float32Array(0);
  moveInTick = new Int32Array(0);
  /** Taste group (index into GROUPS; 255 until assigned). */
  taste = new Uint8Array(0);
  private free: number[] = [];

  // Running totals.
  households = 0;
  residents = 0;
  workerCount = 0;
  employed = 0;
  educatedCount = 0;

  constructor(initial = 1024) {
    this.grow(initial);
  }

  private grow(n: number): void {
    const cap = Math.max(n, this.capacity * 2);
    const g = <T extends Int32Array | Uint8Array | Float32Array>(a: T, ctor: new (n: number) => T, mult = 1): T => {
      const b = new ctor(cap * mult);
      b.set(a);
      return b;
    };
    this.home = g(this.home, Int32Array);
    this.size = g(this.size, Uint8Array);
    this.workers = g(this.workers, Uint8Array);
    this.educated = g(this.educated, Uint8Array);
    this.job = g(this.job, Int32Array, 2);
    this.wealth = g(this.wealth, Uint8Array);
    this.alive = g(this.alive, Uint8Array);
    this.happiness = g(this.happiness, Float32Array);
    this.moveInTick = g(this.moveInTick, Int32Array);
    this.taste = g(this.taste, Uint8Array);
    this.capacity = cap;
  }

  add(home: number, size: number, workers: number, educated: number, wealth: number, tick: number): number {
    let i: number;
    if (this.free.length) i = this.free.pop()!;
    else {
      if (this.count >= this.capacity) this.grow(this.count + 1);
      i = this.count++;
    }
    this.home[i] = home;
    this.size[i] = size;
    this.workers[i] = Math.min(2, workers);
    this.educated[i] = Math.min(this.workers[i], educated);
    this.job[i * 2] = 0;
    this.job[i * 2 + 1] = 0;
    this.wealth[i] = wealth;
    this.alive[i] = 1;
    this.happiness[i] = 60;
    this.moveInTick[i] = tick;
    this.taste[i] = 255;
    this.households++;
    this.residents += size;
    this.workerCount += this.workers[i];
    this.educatedCount += this.educated[i];
    return i;
  }

  remove(i: number): void {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.households--;
    this.residents -= this.size[i];
    this.workerCount -= this.workers[i];
    this.educatedCount -= this.educated[i];
    for (let k = 0; k < 2; k++) {
      if (this.job[i * 2 + k]) this.employed--;
      this.job[i * 2 + k] = 0;
    }
    this.free.push(i);
  }

  setJob(i: number, k: number, buildingId: number): void {
    const prev = this.job[i * 2 + k];
    if (prev && !buildingId) this.employed--;
    if (!prev && buildingId) this.employed++;
    this.job[i * 2 + k] = buildingId;
  }

  /** Number of workers in household i without a job. */
  unemployedIn(i: number): number {
    let n = 0;
    for (let k = 0; k < this.workers[i]; k++) if (!this.job[i * 2 + k]) n++;
    return n;
  }

  upgradeEducation(i: number): void {
    if (this.educated[i] < this.workers[i]) {
      this.educated[i]++;
      this.educatedCount++;
    }
  }

  /** Removes every job reference to a workplace; returns workers released. */
  releaseWorkplace(buildingId: number): number {
    let n = 0;
    const job = this.job;
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue;
      for (let k = 0; k < 2; k++) {
        if (job[i * 2 + k] === buildingId) {
          job[i * 2 + k] = 0;
          this.employed--;
          n++;
        }
      }
    }
    return n;
  }

  /** Household indices living in a building. */
  householdsIn(buildingId: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.count; i++) if (this.alive[i] && this.home[i] === buildingId) out.push(i);
    return out;
  }

  /** Rebuilds the free list and totals after bulk-loading arrays. */
  recount(): void {
    this.free = [];
    this.households = this.residents = this.workerCount = this.employed = this.educatedCount = 0;
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) {
        this.free.push(i);
        continue;
      }
      this.households++;
      this.residents += this.size[i];
      this.workerCount += this.workers[i];
      this.educatedCount += this.educated[i];
      if (this.job[i * 2]) this.employed++;
      if (this.job[i * 2 + 1]) this.employed++;
    }
  }

  ensureCapacity(n: number): void {
    if (n > this.capacity) this.grow(n);
  }

  clear(): void {
    this.count = 0;
    this.alive.fill(0);
    this.free = [];
    this.households = this.residents = this.workerCount = this.employed = this.educatedCount = 0;
  }
}
