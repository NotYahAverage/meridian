import { clamp } from '../../core/math';
import { Rng } from '../../core/rng';
import { GRID_CELL, GRID_RES } from '../constants';

export interface District {
  id: number;
  name: string;
  color: [number, number, number];
}

const NAMES = [
  'Harbor Heights', 'Old Mill', 'Westbrook', 'Cedar Grove', 'Riverside', 'Market Quarter', 'Northgate',
  'Lakeshore', 'Summit Hill', 'Foundry Row', 'Linden Park', 'Bayfront', 'Kingsley', 'Juniper Flats',
  'Copper Ridge', 'Ashford Commons', 'Larkspur', 'Southpoint', 'Granite Bluffs', 'Meadowbrook',
  'Station Square', 'Ironworks', 'Willow Bend', 'Sterling Heights', 'Fairview', 'Old Town',
];

const COLORS: [number, number, number][] = [
  [0.95, 0.55, 0.35], [0.4, 0.75, 0.95], [0.75, 0.55, 0.95], [0.45, 0.85, 0.6], [0.95, 0.8, 0.35],
  [0.95, 0.45, 0.6], [0.35, 0.8, 0.8], [0.7, 0.8, 0.4],
];

/** Player-painted named districts on the analysis grid. */
export class Districts {
  readonly grid = new Uint8Array(GRID_RES * GRID_RES);
  readonly list = new Map<number, District>();
  nextId = 1;
  version = 0;
  /** Called after a district is deleted. */
  onRemove: (id: number) => void = () => {};
  private rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0xd157);
  }

  create(name?: string): District | null {
    if (this.list.size >= 250) return null;
    const used = new Set([...this.list.values()].map((d) => d.name));
    let n = name;
    if (!n) {
      const free = NAMES.filter((x) => !used.has(x));
      n = free.length ? this.rng.pick(free) : undefined;
    }
    // Ids live in a byte grid, so reuse the lowest free one (1–255).
    let id = 1;
    while (this.list.has(id)) id++;
    this.nextId = Math.max(this.nextId, id + 1);
    // Least-used colour, so neighbours rarely match.
    const uses = COLORS.map((c) => [...this.list.values()].filter((d) => d.color[0] === c[0] && d.color[1] === c[1] && d.color[2] === c[2]).length);
    const color = COLORS[uses.indexOf(Math.min(...uses))];
    const d: District = { id, name: n ?? `District ${id}`, color: [...color] };
    this.list.set(d.id, d);
    this.version++;
    return d;
  }

  remove(id: number): void {
    this.list.delete(id);
    for (let i = 0; i < this.grid.length; i++) if (this.grid[i] === id) this.grid[i] = 0;
    this.version++;
    this.onRemove(id);
  }

  rename(id: number, name: string): void {
    const d = this.list.get(id);
    if (d && name.trim()) {
      d.name = name.trim().slice(0, 32);
      this.version++;
    }
  }

  paint(x: number, z: number, radius: number, id: number): number {
    const ix0 = clamp(Math.floor((x - radius) / GRID_CELL), 0, GRID_RES - 1);
    const iz0 = clamp(Math.floor((z - radius) / GRID_CELL), 0, GRID_RES - 1);
    const ix1 = clamp(Math.floor((x + radius) / GRID_CELL), 0, GRID_RES - 1);
    const iz1 = clamp(Math.floor((z + radius) / GRID_CELL), 0, GRID_RES - 1);
    let n = 0;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const dx = (ix + 0.5) * GRID_CELL - x;
        const dz = (iz + 0.5) * GRID_CELL - z;
        if (dx * dx + dz * dz > radius * radius) continue;
        const i = iz * GRID_RES + ix;
        if (this.grid[i] !== id) {
          this.grid[i] = id;
          n++;
        }
      }
    }
    if (n) this.version++;
    return n;
  }

  at(x: number, z: number): number {
    const ix = clamp(Math.floor(x / GRID_CELL), 0, GRID_RES - 1);
    const iz = clamp(Math.floor(z / GRID_CELL), 0, GRID_RES - 1);
    return this.grid[iz * GRID_RES + ix];
  }

  /** Centroid of each district's painted cells (for labels). */
  centroids(): Map<number, { x: number; z: number; cells: number }> {
    const acc = new Map<number, { x: number; z: number; cells: number }>();
    for (let i = 0; i < this.grid.length; i++) {
      const id = this.grid[i];
      if (!id) continue;
      const a = acc.get(id) ?? { x: 0, z: 0, cells: 0 };
      a.x += ((i % GRID_RES) + 0.5) * GRID_CELL;
      a.z += (Math.floor(i / GRID_RES) + 0.5) * GRID_CELL;
      a.cells++;
      acc.set(id, a);
    }
    for (const a of acc.values()) {
      a.x /= a.cells;
      a.z /= a.cells;
    }
    return acc;
  }

  get rngState(): number {
    return this.rng.state;
  }

  set rngState(v: number) {
    this.rng.state = v;
  }
}
