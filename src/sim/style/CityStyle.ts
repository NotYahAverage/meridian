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
  movementOf(b: Pick<Building, 'movement' | 'style' | 'id' | 'typeId'>): Movement | undefined {
    // Prototypes are drawn exactly as they were designed.
    if (b.typeId === 'proto') return this.city.design?.lookOf(b.id);
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

  /**
   * The movement a new (or rebuilt) building follows, deterministic per
   * building: near where an adopted design was tested, that style is likely;
   * elsewhere the city's blend decides, among the movements that build this
   * kind of building.
   */
  pick(b: Pick<Building, 'seed' | 'id' | 'style' | 'cx' | 'cz'>): number {
    let u = hashStr(this.city.research.civSeed, 'pick', b.seed, b.id) / 4294967296;
    const design = this.city.design;
    if (design) {
      let acc = 0;
      for (const e of design.spreadAt(b.cx, b.cz, b.style)) {
        acc += e.chance;
        if (u < acc) return e.id;
      }
      // Rescale what is left of the draw for the blend.
      if (acc > 0) u = (u - acc) / Math.max(1e-6, 1 - acc);
    }
    const blend = this.blend().filter((e) => !design || design.buildsKind(e.movement.id, b.style));
    if (blend.length <= 1) return blend[0]?.movement.id ?? 0;
    let total = 0;
    for (const e of blend) total += e.share;
    let acc = 0;
    for (const e of blend) {
      acc += e.share / total;
      if (u < acc) return e.movement.id;
    }
    return blend[blend.length - 1].movement.id;
  }

  /** A design the city has adopted becomes a movement, drawn exactly as designed. */
  adopt(look: Movement, name: string, short: string, manifesto: string, weight = 0): Movement {
    const m: Movement = { ...structuredClone(look), id: this.movements.length, name, short, kind: 'A style born from a prototype', manifesto, local: false, founded: this.city.clock.day, explicit: true };
    this.movements.push(m);
    this.weights.set(m.id, weight);
    this.version++;
    return m;
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
