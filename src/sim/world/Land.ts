import { WORLD_SIZE } from '../constants';

/** The map is divided into LAND_TILES × LAND_TILES parcels of land. */
export const LAND_TILES = 12;
export const LAND_TILE = WORLD_SIZE / LAND_TILES;
/** Price of the first ring of land; each ring after it costs LAND_PRICE_GROWTH times the last. */
export const LAND_BASE_PRICE = 1_500_000;
export const LAND_PRICE_GROWTH = 2;

/**
 * Which parts of the map the city owns. Roads, zoning, buildings, terraforming
 * and planting only happen on owned land. The city starts with the 3 × 3
 * parcels around its centre and grows outwards a whole ring at a time.
 */
export class Land {
  readonly owned = new Uint8Array(LAND_TILES * LAND_TILES).fill(1);
  /** Rings bought so far (drives the price). */
  bought = 0;
  /** Parcel at the middle of the starting land. */
  cx = 0;
  cz = 0;
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
    const cx = (this.cx = Math.min(LAND_TILES - 2, Math.max(1, Math.floor(x / LAND_TILE))));
    const cz = (this.cz = Math.min(LAND_TILES - 2, Math.max(1, Math.floor(z / LAND_TILE))));
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.owned[Land.index(cx + dx, cz + dz)] = 1;
    for (const p of extra) {
      const i = this.tileAt(Math.min(WORLD_SIZE - 1, Math.max(0, p.x)), Math.min(WORLD_SIZE - 1, Math.max(0, p.z)));
      if (i >= 0) this.owned[i] = 1;
    }
    this.version++;
  }

  /** How many rings out from the starting parcel (the starting 3 × 3 is ring 1). */
  ringOf(i: number): number {
    return Math.max(Math.abs((i % LAND_TILES) - this.cx), Math.abs(Math.floor(i / LAND_TILES) - this.cz));
  }

  /** The ring for sale (the innermost one with land left to buy), or 0 when everything is owned. */
  get nextRing(): number {
    let best = 0;
    for (let i = 0; i < this.owned.length; i++) {
      if (this.owned[i]) continue;
      const r = this.ringOf(i);
      if (!best || r < best) best = r;
    }
    return best;
  }

  /** Unowned parcels in the ring that's for sale. */
  isBuyable(i: number): boolean {
    return !this.owned[i] && this.ringOf(i) === this.nextRing;
  }

  /** Parcels the next ring adds. */
  get ringParcels(): number[] {
    const r = this.nextRing;
    const out: number[] = [];
    if (r) for (let i = 0; i < this.owned.length; i++) if (!this.owned[i] && this.ringOf(i) === r) out.push(i);
    return out;
  }

  get price(): number {
    return Math.round((LAND_BASE_PRICE * LAND_PRICE_GROWTH ** this.bought) / 1000) * 1000;
  }

  /** Marks the next ring as owned (the caller has already charged for it) and returns its parcels. */
  grantRing(): number[] {
    const tiles = this.ringParcels;
    for (const i of tiles) this.owned[i] = 1;
    if (tiles.length) {
      this.bought++;
      this.version++;
    }
    return tiles;
  }

  /** Parcel centre in world coordinates. */
  static center(i: number): { x: number; z: number } {
    return { x: ((i % LAND_TILES) + 0.5) * LAND_TILE, z: (Math.floor(i / LAND_TILES) + 0.5) * LAND_TILE };
  }

  serialize(): LandData | undefined {
    return this.allOwned ? undefined : { owned: [...this.owned], bought: this.bought, rings: true, cx: this.cx, cz: this.cz };
  }

  load(data: LandData | undefined): void {
    if (!data || data.owned.length !== this.owned.length) this.owned.fill(1);
    else this.owned.set(data.owned.map((v) => (v ? 1 : 0)));
    if (data?.rings && data.cx !== undefined && data.cz !== undefined) {
      this.cx = data.cx;
      this.cz = data.cz;
      this.bought = data.bought;
    } else {
      // Saves from when single parcels were sold: centre on the owned land and start at the first ring's price.
      let sx = 0, sz = 0, n = 0;
      for (let i = 0; i < this.owned.length; i++) {
        if (!this.owned[i]) continue;
        sx += i % LAND_TILES;
        sz += Math.floor(i / LAND_TILES);
        n++;
      }
      const mid = (LAND_TILES - 1) / 2;
      this.cx = Math.min(LAND_TILES - 2, Math.max(1, Math.round(n ? sx / n : mid)));
      this.cz = Math.min(LAND_TILES - 2, Math.max(1, Math.round(n ? sz / n : mid)));
      this.bought = 0;
    }
    this.version++;
  }
}

export interface LandData {
  owned: number[];
  bought: number;
  /** Set once land is sold in rings around (cx, cz). */
  rings?: boolean;
  cx?: number;
  cz?: number;
}
