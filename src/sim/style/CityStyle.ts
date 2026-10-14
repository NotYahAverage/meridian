import type { Building } from '../buildings/Buildings';
import type { City } from '../City';
import { hashStr } from '../research/Generate';
import { type Axes, type Movement, clampAxes, localAxes, makeMovement } from './Movements';

export interface StyleSave {
  v: 1;
  movements: Movement[];
  weights: [number, number][];
}

/** Zoned building styles drawn by the style-aware generators (the rest keep their classic look). */
export const STYLED_KINDS = new Set(['house', 'modernHouse', 'townhouse', 'lowrise', 'midrise', 'tower', 'shop', 'mixeduse', 'office', 'officeTower', 'hotel']);

/**
 * A city's architecture: the movements it has developed, how much each one
 * shapes new building (the blend), and which movement each building was built
 * in. Every city starts with its own local vernacular; research adds more.
 * A building keeps its movement until it is rebuilt or renovated, so the city
 * changes gradually.
 */
export class CityStyle {
  movements: Movement[] = [];
  /** Influence of each movement on new building (movement id → weight). */
  readonly weights = new Map<number, number>();
  version = 0;

  constructor(private city: City, civSeed: number) {
    this.reset(civSeed);
  }

  /** Starts over with only the local vernacular. */
  reset(civSeed: number): void {
    this.movements = [makeMovement(civSeed, 0, localAxes(civSeed, this.city.preset), 0, true)];
    this.weights.clear();
    this.weights.set(0, 1);
    this.version++;
  }

  get(id: number): Movement | undefined {
    return this.movements[id];
  }

  /** The movement a building is drawn in (undefined for the classic look). */
  movementOf(b: Pick<Building, 'movement' | 'style'>): Movement | undefined {
    const m = this.movements[b.movement ?? 0];
    return m && !m.local && STYLED_KINDS.has(b.style) ? m : undefined;
  }

  /** Each movement's share of new building, largest first. */
  blend(): { movement: Movement; share: number }[] {
    let total = 0;
    for (const w of this.weights.values()) total += Math.max(0, w);
    const out: { movement: Movement; share: number }[] = [];
    for (const [id, w] of this.weights) {
      const m = this.movements[id];
      if (m && w > 0) out.push({ movement: m, share: total ? w / total : 0 });
    }
    return out.sort((a, b) => b.share - a.share);
  }

  /** The movement a new (or rebuilt) building follows: drawn from the blend, deterministic per building. */
  pick(b: Pick<Building, 'seed' | 'id'>): number {
    const blend = this.blend();
    if (blend.length <= 1) return blend[0]?.movement.id ?? 0;
    const u = hashStr(this.city.research.civSeed, 'pick', b.seed, b.id) / 4294967296;
    let acc = 0;
    for (const e of blend) {
      acc += e.share;
      if (u < acc) return e.movement.id;
    }
    return blend[blend.length - 1].movement.id;
  }

  /** A new movement forms at a position on the axes. */
  addMovement(axes: Axes, weight = 1): Movement {
    const m = makeMovement(this.city.research.civSeed, this.movements.length, clampAxes(axes), this.city.clock.day);
    this.movements.push(m);
    this.weights.set(m.id, weight);
    this.version++;
    return m;
  }

  setWeight(id: number, w: number): void {
    if (!this.movements[id]) return;
    this.weights.set(id, Math.max(0, w));
    this.version++;
  }

  /** Rebuilds a building in a movement (renovation); the renderer picks up the change. */
  restyle(b: Building, id: number): void {
    if (!this.movements[id] || b.movement === id) return;
    b.movement = id;
    this.city.buildings.markChanged(b, 'geometry');
  }

  serialize(): StyleSave {
    return structuredClone({ v: 1 as const, movements: this.movements, weights: [...this.weights.entries()] });
  }

  load(data: StyleSave | undefined, civSeed: number): void {
    if (!data) {
      this.reset(civSeed);
      return;
    }
    const d = structuredClone(data);
    this.movements = d.movements;
    this.weights.clear();
    for (const [k, v] of d.weights) this.weights.set(k, v);
    this.version++;
  }
}
