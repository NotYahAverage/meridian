import { WORLD_SIZE } from '../constants';

/** The map is divided into LAND_TILES × LAND_TILES parcels of land. */
export const LAND_TILES = 6;
export const LAND_TILE = WORLD_SIZE / LAND_TILES;
/** Price of the first expansion; each later one costs LAND_PRICE_GROWTH times the last. */
export const LAND_BASE_PRICE = 250_000;
export const LAND_PRICE_GROWTH = 1.5;

/**
 * Which parts of the map the city owns. Roads, zoning, buildings, terraforming
 * and planting only happen on owned land; more can be bought, at a steep price,
 * next to what the city already has.
 */
export class Land {
  readonly owned = new Uint8Array(LAND_TILES * LAND_TILES).fill(1);
  /** Parcels bought so far (drives the price). */
  bought = 0;
  /** Bumped on every change (for the renderer). */
  version = 0;

  static index(tx: number, tz: number): number {
    return tz * LAND_TILES + tx;
  }

  tileAt(x: number, z: number): number {
    const tx = Math.floor(x / LAND_TILE), tz = Math.floor(z / LAND_TILE);
    if (tx < 0 || tz < 0 || tx >= LAND_TILES || tz >= LAND_TILES) return -1;
    return Land.index(tx, tz);
  }

  ownsPoint(x: number, z: number): boolean {
    const i = this.tileAt(x, z);
    return i >= 0 && this.owned[i] === 1;
  }

  /** True if every parcel the rectangle touches is owned. */
  ownsRect(minX: number, minZ: number, maxX: number, maxZ: number): boolean {
    for (let z = minZ; ; z = Math.min(maxZ, z + LAND_TILE)) {
      for (let x = minX; ; x = Math.min(maxX, x + LAND_TILE)) {
        if (!this.ownsPoint(x, z)) return false;
        if (x >= maxX) break;
      }
      if (z >= maxZ) break;
    }
    return true;
  }

  get allOwned(): boolean {
    return this.owned.every((v) => v === 1);
  }

  get ownedCount(): number {
    let n = 0;
    for (const v of this.owned) n += v;
    return n;
  }

  /** A new city starts with the 3 × 3 parcels around its centre plus any listed points (the highway). */
  startAround(x: number, z: number, extra: { x: number; z: number }[] = []): void {
    this.owned.fill(0);
    this.bought = 0;
    const cx = Math.min(LAND_TILES - 2, Math.max(1, Math.floor(x / LAND_TILE)));
    const cz = Math.min(LAND_TILES - 2, Math.max(1, Math.floor(z / LAND_TILE)));
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.owned[Land.index(cx + dx, cz + dz)] = 1;
    for (const p of extra) {
      const i = this.tileAt(Math.min(WORLD_SIZE - 1, Math.max(0, p.x)), Math.min(WORLD_SIZE - 1, Math.max(0, p.z)));
      if (i >= 0) this.owned[i] = 1;
    }
    this.version++;
  }

  /** Unowned parcels that share an edge with owned land. */
  isBuyable(i: number): boolean {
    if (this.owned[i]) return false;
    const tx = i % LAND_TILES, tz = Math.floor(i / LAND_TILES);
    return (
      (tx > 0 && this.owned[i - 1] === 1) ||
      (tx < LAND_TILES - 1 && this.owned[i + 1] === 1) ||
      (tz > 0 && this.owned[i - LAND_TILES] === 1) ||
      (tz < LAND_TILES - 1 && this.owned[i + LAND_TILES] === 1)
    );
  }

  get price(): number {
    return Math.round((LAND_BASE_PRICE * LAND_PRICE_GROWTH ** this.bought) / 1000) * 1000;
  }

  /** Marks a parcel as bought (the caller has already charged for it). */
  grant(i: number): void {
    this.owned[i] = 1;
    this.bought++;
    this.version++;
  }

  /** Parcel centre in world coordinates. */
  static center(i: number): { x: number; z: number } {
    return { x: ((i % LAND_TILES) + 0.5) * LAND_TILE, z: (Math.floor(i / LAND_TILES) + 0.5) * LAND_TILE };
  }

  serialize(): { owned: number[]; bought: number } | undefined {
    return this.allOwned ? undefined : { owned: [...this.owned], bought: this.bought };
  }

  load(data: { owned: number[]; bought: number } | undefined): void {
    if (!data || data.owned.length !== this.owned.length) this.owned.fill(1);
    else this.owned.set(data.owned.map((v) => (v ? 1 : 0)));
    this.bought = data?.bought ?? 0;
    this.version++;
  }
}
