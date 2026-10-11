import { type OBB, obbBounds } from '../../core/geom2d';
import { SpatialHash } from '../../core/SpatialHash';
import { BuildingState, Zone } from '../types';
import type { StyleId } from './Archetypes';

export interface Building {
  id: number;
  kind: 'zoned' | 'service';
  /** Archetype id (zoned) or service type id. */
  typeId: string;
  style: StyleId;
  zone: Zone;
  /** Lot oriented box: local x along the frontage, local z away from the road. */
  cx: number;
  cz: number;
  angle: number;
  hw: number;
  hd: number;
  /** Lot ground level. */
  y: number;
  seed: number;
  floors: number;
  level: number;
  state: BuildingState;
  /** Construction progress 0–1. */
  progress: number;
  buildDays: number;
  /** Days since completion. */
  age: number;
  /** Access road. */
  segId: number;
  segS: number;
  side: number;
  hhCap: number;
  households: number;
  residents: number;
  jobs: number;
  workers: number;
  power: boolean;
  water: boolean;
  sewage: boolean;
  garbage: number;
  happiness: number;
  landValue: number;
  problems: number;
  unhappyDays: number;
  fireHours: number;
  /** Days until replacement because the zone was repainted (0 = n/a). */
  rezoneDays: number;
  district: number;
  slot: number;
  /** Commercial stock / industrial output efficiency 0–1. */
  efficiency: number;
  /** Generic accumulator (landfill fill level, etc.). */
  stock: number;
}

export function lotOBB(b: Pick<Building, 'cx' | 'cz' | 'angle' | 'hw' | 'hd'>): OBB {
  return { cx: b.cx, cz: b.cz, angle: b.angle, hw: b.hw, hd: b.hd };
}

export function newBuilding(init: Partial<Building> & Pick<Building, 'kind' | 'typeId' | 'style' | 'cx' | 'cz' | 'angle' | 'hw' | 'hd'>): Building {
  return {
    id: 0,
    zone: Zone.None,
    y: 0,
    seed: 1,
    floors: 1,
    level: 1,
    state: BuildingState.Construction,
    progress: 0,
    buildDays: 4,
    age: 0,
    segId: 0,
    segS: 0,
    side: 1,
    hhCap: 0,
    households: 0,
    residents: 0,
    jobs: 0,
    workers: 0,
    power: false,
    water: false,
    sewage: false,
    garbage: 0,
    happiness: 60,
    landValue: 0.3,
    problems: 0,
    unhappyDays: 0,
    fireHours: 0,
    rezoneDays: 0,
    district: 0,
    slot: -1,
    efficiency: 1,
    stock: 0,
    ...init,
  };
}

export type BuildingChange = 'add' | 'remove' | 'geometry' | 'state';

/** Container for all buildings with spatial lookup and render bookkeeping. */
export class Buildings {
  readonly all = new Map<number, Building>();
  readonly spatial = new SpatialHash(64);
  readonly bySegment = new Map<number, Set<number>>();
  nextId = 1;
  /** Change log consumed by the renderer. */
  readonly changes = new Map<number, BuildingChange>();
  private freeSlots: number[] = [];
  private nextSlot = 0;
  private removedSnapshots = new Map<number, Building>();

  add(b: Building): Building {
    if (!b.id) b.id = this.nextId++;
    else this.nextId = Math.max(this.nextId, b.id + 1);
    b.slot = this.freeSlots.length ? this.freeSlots.pop()! : this.nextSlot++;
    this.all.set(b.id, b);
    const [minX, minZ, maxX, maxZ] = obbBounds(lotOBB(b));
    this.spatial.insert(b.id, minX, minZ, maxX, maxZ);
    this.attach(b, b.segId);
    this.changes.set(b.id, 'add');
    return b;
  }

  remove(id: number): Building | undefined {
    const b = this.all.get(id);
    if (!b) return undefined;
    this.all.delete(id);
    this.spatial.remove(id);
    this.detach(b);
    this.freeSlots.push(b.slot);
    this.removedSnapshots.set(id, b);
    if (this.changes.get(id) === 'add') this.changes.delete(id);
    else this.changes.set(id, 'remove');
    return b;
  }

  /** Building removed since the last change flush (renderer needs its old chunk). */
  removedSnapshot(id: number): Building | undefined {
    return this.removedSnapshots.get(id);
  }

  flushChanges(): Map<number, BuildingChange> {
    const out = new Map(this.changes);
    this.changes.clear();
    this.removedSnapshots.clear();
    return out;
  }

  markChanged(b: Building, kind: BuildingChange): void {
    const prev = this.changes.get(b.id);
    if (prev === 'add') return;
    if (prev === 'geometry' && kind === 'state') return;
    this.changes.set(b.id, kind);
  }

  get(id: number): Building | undefined {
    return this.all.get(id);
  }

  attach(b: Building, segId: number): void {
    this.detach(b);
    b.segId = segId;
    if (!segId) return;
    let set = this.bySegment.get(segId);
    if (!set) {
      set = new Set();
      this.bySegment.set(segId, set);
    }
    set.add(b.id);
  }

  detach(b: Building): void {
    if (!b.segId) return;
    const set = this.bySegment.get(b.segId);
    if (set) {
      set.delete(b.id);
      if (set.size === 0) this.bySegment.delete(b.segId);
    }
  }

  onSegment(segId: number): Building[] {
    const set = this.bySegment.get(segId);
    if (!set) return [];
    return [...set].map((id) => this.all.get(id)!).filter(Boolean);
  }

  queryRect(minX: number, minZ: number, maxX: number, maxZ: number): Building[] {
    return this.spatial.query(minX, minZ, maxX, maxZ).map((id) => this.all.get(id)!);
  }

  queryRadius(x: number, z: number, r: number): Building[] {
    return this.queryRect(x - r, z - r, x + r, z + r);
  }

  get count(): number {
    return this.all.size;
  }

  get slotCapacity(): number {
    return this.nextSlot;
  }

  clear(): void {
    this.all.clear();
    this.spatial.clear();
    this.bySegment.clear();
    this.changes.clear();
    this.removedSnapshots.clear();
    this.freeSlots = [];
    this.nextSlot = 0;
    this.nextId = 1;
  }
}
