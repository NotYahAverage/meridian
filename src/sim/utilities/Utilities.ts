import type { Building, Buildings } from '../buildings/Buildings';
import type { RoadNetwork } from '../roads/RoadNetwork';
import { SERVICE_BY_ID, type UtilityKind, powerUse, waterUse } from '../services/ServiceTypes';
import { BuildingState } from '../types';

export interface UtilityTotals {
  production: number;
  consumption: number;
  /** Consumption that could not be served. */
  shortfall: number;
  unserved: number;
}

const KINDS: UtilityKind[] = ['power', 'water', 'sewage'];

export function buildingUse(b: Building, kind: UtilityKind): number {
  const hh = b.households > 0 ? b.households : b.state === BuildingState.Construction ? 0 : b.hhCap * 0.25;
  const jobs = b.workers > 0 ? b.workers : b.jobs * 0.25;
  if (kind === 'power') return powerUse(hh, jobs);
  if (kind === 'water') return waterUse(hh, jobs);
  return waterUse(hh, jobs) * 0.9;
}

/**
 * Simplified utility networks: power lines, water mains and sewers run under
 * every road, so a producer supplies any building on the same connected road
 * network. When demand exceeds supply, buildings farthest from producers lose
 * service first.
 */
export class Utilities {
  readonly totals: Record<UtilityKind, UtilityTotals> = {
    power: { production: 0, consumption: 0, shortfall: 0, unserved: 0 },
    water: { production: 0, consumption: 0, shortfall: 0, unserved: 0 },
    sewage: { production: 0, consumption: 0, shortfall: 0, unserved: 0 },
  };
  /** Supply minus demand per road component, per utility. */
  readonly componentBalance = new Map<string, number>();
  /** Total supply per road component, per utility. */
  readonly componentSupply = new Map<string, number>();

  /** Spare capacity of a utility on a road component. */
  available(kind: UtilityKind, comp: number): number {
    const key = `${kind}:${comp}`;
    const bal = this.componentBalance.get(key);
    if (bal !== undefined) return bal;
    return this.componentSupply.get(key) ?? 0;
  }

  /** Reserves capacity for a building that is about to be built. */
  reserve(kind: UtilityKind, comp: number, amount: number): void {
    const key = `${kind}:${comp}`;
    this.componentBalance.set(key, this.available(kind, comp) - amount);
  }

  /** Energy storage on the networks: what it can hold and what it delivered last time. */
  storage = { capacity: 0, delivered: 0 };

  /**
   * `outputScale` adjusts producer output by type (weather: wind and sun; research boosts);
   * `useScale` adjusts what buildings draw (research into efficiency).
   */
  recompute(buildings: Buildings, net: RoadNetwork, outputScale: (typeId: string) => number = () => 1, useScale: Partial<Record<UtilityKind, number>> = {}): void {
    const comp = net.components();
    const producers: Record<UtilityKind, Map<number, { x: number; z: number; out: number }[]>> = {
      power: new Map(),
      water: new Map(),
      sewage: new Map(),
    };
    const consumers = new Map<number, Building[]>();
    for (const t of Object.values(this.totals)) {
      t.production = t.consumption = t.shortfall = t.unserved = 0;
    }
    this.componentBalance.clear();
    this.componentSupply.clear();
    const stores: { x: number; z: number; cap: number; c: number }[] = [];

    for (const b of buildings.all.values()) {
      const seg = net.segments.get(b.segId);
      const c = seg ? comp.get(seg.a) ?? -1 : -1;
      if (b.kind === 'service') {
        const st = SERVICE_BY_ID.get(b.typeId);
        if (st?.storage && b.state === BuildingState.Active && c >= 0) {
          stores.push({ x: b.cx, z: b.cz, cap: st.storage * outputScale(st.id), c });
        } else if (st && (st.kind === 'power' || st.kind === 'water' || st.kind === 'sewage')) {
          if (b.state === BuildingState.Active && c >= 0) {
            const out = st.output * outputScale(st.id);
            const list = producers[st.kind].get(c) ?? [];
            list.push({ x: b.cx, z: b.cz, out });
            producers[st.kind].set(c, list);
            this.totals[st.kind].production += out;
            const key = `${st.kind}:${c}`;
            this.componentSupply.set(key, (this.componentSupply.get(key) ?? 0) + out);
          }
        }
        b.power = b.water = b.sewage = true;
        continue;
      }
      if (c < 0) {
        b.power = b.water = b.sewage = false;
        continue;
      }
      const list = consumers.get(c) ?? [];
      list.push(b);
      consumers.set(c, list);
    }

    // Storage holds surplus from the generators on its network and releases it at
    // the peak: up to its capacity, and at most half of what those generators make.
    this.storage = { capacity: 0, delivered: 0 };
    const capByComp = new Map<number, number>();
    for (const st of stores) {
      this.storage.capacity += st.cap;
      capByComp.set(st.c, (capByComp.get(st.c) ?? 0) + st.cap);
    }
    for (const [c, cap] of capByComp) {
      const gen = this.componentSupply.get(`power:${c}`) ?? 0;
      const give = Math.min(cap, gen * 0.5);
      if (give <= 0) continue;
      for (const st of stores) {
        if (st.c !== c) continue;
        const out = (give * st.cap) / cap;
        const list = producers.power.get(c) ?? [];
        list.push({ x: st.x, z: st.z, out });
        producers.power.set(c, list);
      }
      this.totals.power.production += give;
      this.storage.delivered += give;
      this.componentSupply.set(`power:${c}`, gen + give);
    }

    for (const [c, list] of consumers) {
      for (const kind of KINDS) {
        const prods = producers[kind].get(c) ?? [];
        let supply = 0;
        for (const p of prods) supply += p.out;
        let total = 0;
        const scale = useScale[kind] ?? 1;
        const uses = list.map((b) => {
          const u = buildingUse(b, kind) * scale;
          total += u;
          return u;
        });
        // Enough for everyone (the usual case): no need to rank by distance.
        if (prods.length && total <= supply + 1e-9) {
          for (const b of list) {
            if (kind === 'power') b.power = true;
            else if (kind === 'water') b.water = true;
            else b.sewage = true;
          }
          this.totals[kind].consumption += total;
          this.componentBalance.set(`${kind}:${c}`, supply - total);
          continue;
        }
        // Short: the buildings nearest a producer are served first.
        const near = nearestProducer(prods);
        const ranked = list.map((b, i) => ({ b, d: near(b.cx, b.cz), use: uses[i] }));
        ranked.sort((p, q) => p.d - q.d);
        let used = 0;
        let demand = 0;
        for (const r of ranked) {
          demand += r.use;
          const ok = prods.length > 0 && used + r.use <= supply + 1e-9;
          if (ok) used += r.use;
          if (kind === 'power') r.b.power = ok;
          else if (kind === 'water') r.b.water = ok;
          else r.b.sewage = ok;
          if (!ok) {
            this.totals[kind].unserved++;
            this.totals[kind].shortfall += r.use;
          }
        }
        this.totals[kind].consumption += demand;
        this.componentBalance.set(`${kind}:${c}`, supply - demand);
      }
    }
  }
}

/** Squared distance to the nearest producer, via a coarse bucket grid (exact). */
function nearestProducer(prods: { x: number; z: number }[]): (x: number, z: number) => number {
  if (prods.length < 8) {
    return (x, z) => {
      let best = Infinity;
      for (const p of prods) best = Math.min(best, (p.x - x) ** 2 + (p.z - z) ** 2);
      return best;
    };
  }
  const CELL = 384;
  const buckets = new Map<number, { x: number; z: number }[]>();
  const key = (ix: number, iz: number) => iz * 4096 + ix;
  for (const p of prods) {
    const k = key(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
    const l = buckets.get(k);
    if (l) l.push(p);
    else buckets.set(k, [p]);
  }
  return (x, z) => {
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    let best = Infinity;
    for (let r = 0; r < 64; r++) {
      // Anything in ring r is at least (r - 1) cells away.
      if (r > 1 && ((r - 1) * CELL) ** 2 > best) break;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const l = buckets.get(key(ix + dx, iz + dz));
          if (l) for (const p of l) best = Math.min(best, (p.x - x) ** 2 + (p.z - z) ** 2);
        }
      }
    }
    return best;
  };
}
