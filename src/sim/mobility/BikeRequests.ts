import type { Building } from '../buildings/Buildings';
import type { City } from '../City';
import { BIKE_LANE, bikeLaneCost, canHaveBikeLane, setBikeLane } from '../CityCommands';
import type { RoadSegment } from '../roads/RoadNetwork';
import { BuildingState, isResidential } from '../types';

/** A request from the people along a road for bike lanes. */
export interface BikeRequest {
  id: number;
  segId: number;
  /** The road's name when they asked. */
  street: string;
  /** What they asked for: 1 painted, 2 protected. */
  kind: 1 | 2;
  /** People living along it. */
  residents: number;
  /** Day asked, and the day it lapses if not answered. */
  day: number;
  until: number;
  /** How many times they've asked (they come back, more insistent, when ignored). */
  asks: number;
}

/** How residents feel about what happened to their request (happiness points, until a day). */
interface Mood {
  points: number;
  until: number;
}

export interface BikeRequestsSave {
  open: BikeRequest[];
  next: number;
  /** Per road: when it may ask again, and how many times it has asked. */
  quiet: [number, number, number][];
  moods: [number, number, number][];
}

const MAX_OPEN = 2;
const ANSWER_DAYS = 120;
const PEOPLE_NEEDED = 60;

/**
 * Residents along a road ask for bike lanes when enough of them would ride if it felt
 * safer. Approving builds the lanes at once (you pay) and pleases them for a year;
 * declining disappoints them for a while; ignoring lets the request lapse, and they
 * ask again later, more insistently.
 */
export class BikeRequests {
  open: BikeRequest[] = [];
  private next = 1;
  /** segId → [day it may ask again, times asked]. */
  private quiet = new Map<number, [number, number]>();
  /** segId → how the people along it feel about it. */
  private moods = new Map<number, Mood>();
  version = 0;

  constructor(private city: City) {}

  /** The open request for a road, if there is one. */
  forSegment(segId: number): BikeRequest | undefined {
    return this.open.find((r) => r.segId === segId);
  }

  /** Happiness points for a home from what became of its street's request. */
  moodOf(b: Building): number {
    const m = b.segId ? this.moods.get(b.segId) : undefined;
    return m && m.until > this.city.clock.day ? m.points : 0;
  }

  private residentsAlong(seg: RoadSegment): number {
    let n = 0;
    for (const b of this.city.buildings.onSegment(seg.id)) if (b.kind === 'zoned' && isResidential(b.zone) && b.state === BuildingState.Active) n += b.residents;
    return n;
  }

  /** Once a month: lapsed requests, and new ones from the streets that most want lanes. */
  monthly(): void {
    const city = this.city;
    const day = city.clock.day;
    for (const r of [...this.open]) {
      const seg = city.roads.segments.get(r.segId);
      if (!seg || seg.bikeLane >= r.kind) {
        this.remove(r);
        continue;
      }
      if (day >= r.until) {
        // Ignored: a little put out, and they'll ask again before long.
        this.remove(r);
        this.mood(r.segId, -1 - Math.min(2, r.asks - 1), 90);
        this.quiet.set(r.segId, [day + 150, r.asks]);
      }
    }
    if (this.open.length >= MAX_OPEN) return;
    let best: { seg: RoadSegment; score: number; residents: number } | null = null;
    for (const seg of city.roads.segments.values()) {
      if (seg.bikeLane || !canHaveBikeLane(seg) || seg.length < 60 || this.forSegment(seg.id)) continue;
      const q = this.quiet.get(seg.id);
      if (q && q[0] > day) continue;
      const residents = this.residentsAlong(seg);
      if (residents < PEOPLE_NEEDED) continue;
      // Many people, a street that doesn't feel safe to ride, and somewhere to ride to.
      const safety = city.mobility.bikeSafety({ segId: seg.id } as Building);
      const score = residents * (1 - safety) * (q ? 1 + q[1] * 0.5 : 1);
      if (score > PEOPLE_NEEDED * 0.5 && (!best || score > best.score)) best = { seg, score, residents };
    }
    if (!best) return;
    const seg = best.seg;
    const asks = (this.quiet.get(seg.id)?.[1] ?? 0) + 1;
    const busy = seg.type === 'avenue' || seg.type === 'boulevard' || city.traffic.ratio(seg.id) > 0.6;
    const r: BikeRequest = { id: this.next++, segId: seg.id, street: seg.name || 'their road', kind: busy ? 2 : 1, residents: best.residents, day, until: day + ANSWER_DAYS, asks };
    this.open.push(r);
    this.version++;
    city.events.emit('bike', { type: 'request', request: r.id });
  }

  /** What approving would cost. */
  costOf(r: BikeRequest): number {
    const seg = this.city.roads.segments.get(r.segId);
    return seg ? bikeLaneCost(seg, r.kind) : 0;
  }

  /** Yes: the lanes go in now (if the money's there), and the street is pleased. */
  approve(id: number): { ok: boolean; error?: string; cost?: number } {
    const r = this.open.find((x) => x.id === id);
    if (!r) return { ok: false, error: 'Request not found' };
    const res = setBikeLane(this.city, r.segId, r.kind);
    if (!res.ok) return res;
    this.remove(r);
    this.mood(r.segId, 4 + Math.min(2, r.asks - 1), 360);
    this.quiet.set(r.segId, [this.city.clock.day + 360 * 5, r.asks]);
    this.city.events.emit('bike', { type: 'answer', request: r.id, approved: true });
    return res;
  }

  /** No: disappointed for a while, and they won't ask again for a year. */
  decline(id: number): void {
    const r = this.open.find((x) => x.id === id);
    if (!r) return;
    this.remove(r);
    this.mood(r.segId, -2 - Math.min(2, r.asks - 1), 180);
    this.quiet.set(r.segId, [this.city.clock.day + 360, r.asks]);
    this.city.events.emit('bike', { type: 'answer', request: r.id, approved: false });
  }

  private remove(r: BikeRequest): void {
    this.open = this.open.filter((x) => x !== r);
    this.version++;
  }

  private mood(segId: number, points: number, days: number): void {
    this.moods.set(segId, { points, until: this.city.clock.day + days });
  }

  /** What people want, in their words. */
  static text(r: BikeRequest): string {
    const what = BIKE_LANE.name[r.kind].toLowerCase();
    return r.asks > 1 ? `Residents of ${r.street} ask again for ${what}: “We asked before. Please make it safe to ride.”` : `Residents of ${r.street} ask for ${what}: “Make it safe to ride to work and school.”`;
  }

  serialize(): BikeRequestsSave {
    return {
      open: this.open.map((r) => ({ ...r })),
      next: this.next,
      quiet: [...this.quiet].map(([k, [d, n]]) => [k, d, n]),
      moods: [...this.moods].map(([k, m]) => [k, m.points, m.until]),
    };
  }

  load(data: BikeRequestsSave | undefined): void {
    this.open = data ? data.open.map((r) => ({ ...r })) : [];
    this.next = data?.next ?? 1;
    this.quiet = new Map((data?.quiet ?? []).map(([k, d, n]) => [k, [d, n]]));
    this.moods = new Map((data?.moods ?? []).map(([k, p, u]) => [k, { points: p, until: u }]));
    this.version++;
  }
}
