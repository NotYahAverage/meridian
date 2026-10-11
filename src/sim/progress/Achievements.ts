import type { City } from '../City';
import { tourismIncome } from '../CitySim';
import { BuildingState } from '../types';

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  icon: string;
  check: (city: City, a: Achievements) => boolean;
}

export interface AchievementCounters {
  /** Cubic metres of earth moved by terraforming. */
  earthMoved: number;
  treesPlanted: number;
  /** Consecutive months with running income above running costs. */
  surplusMonths: number;
  tornadoes: number;
}

export interface AchievementSave {
  unlocked: [string, number][];
  counters: AchievementCounters;
}

const anyBuilding = (city: City, pred: (b: import('../buildings/Buildings').Building) => boolean) => {
  for (const b of city.buildings.all.values()) if (pred(b)) return true;
  return false;
};

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'bridge', title: 'Over Troubled Water', description: 'Build a bridge.', icon: 'road', check: (c) => [...c.roads.segments.values()].some((s) => s.elevated) },
  { id: 'roundabouts', title: 'Round and Round', description: 'Build three roundabouts.', icon: 'roundabout', check: (c) => c.roads.roundabouts.size >= 3 },
  { id: 'districts', title: 'Neighbourhoods', description: 'Paint five districts.', icon: 'districts', check: (c) => c.districts.list.size >= 5 },
  { id: 'policies', title: 'Policy Wonk', description: 'Have five policies in force at once.', icon: 'policy', check: (c) => c.policies.count() >= 5 },
  { id: 'trees', title: 'Green Thumb', description: 'Plant 200 trees.', icon: 'tree', check: (_c, a) => a.counters.treesPlanted >= 200 },
  { id: 'earth', title: 'Moving Mountains', description: 'Move 100,000 m³ of earth.', icon: 'terrain', check: (_c, a) => a.counters.earthMoved >= 100_000 },
  { id: 'surplus', title: 'In the Black', description: 'Run a surplus twelve months in a row.', icon: 'money', check: (_c, a) => a.counters.surplusMonths >= 12 },
  { id: 'transit', title: 'Car-Light City', description: 'A quarter of commuters take transit (2,000+ residents).', icon: 'bus', check: (c) => c.stats.population >= 2_000 && c.transit.modeShare >= 0.25 },
  { id: 'metro', title: 'Going Underground', description: 'Open a metro line that carries riders.', icon: 'metro', check: (c) => [...c.transit.metro.lines.values()].some((l) => !l.problem && l.ridersPerDay > 0) },
  { id: 'airport', title: 'Cleared for Takeoff', description: 'Open the regional airport.', icon: 'plane', check: (c) => anyBuilding(c, (b) => b.typeId === 'airport' && b.state === BuildingState.Active) },
  { id: 'tourism', title: 'Tourist Magnet', description: 'Earn $20,000 a month from tourism.', icon: 'landmark', check: (c) => tourismIncome(c) >= 20_000 },
  { id: 'skyline', title: 'Skyline', description: 'Grow a building of 25 floors or more.', icon: 'office', check: (c) => anyBuilding(c, (b) => b.floors >= 25 && b.state === BuildingState.Active) },
  { id: 'educated', title: 'City of Learning', description: 'Six in ten workers are educated (2,000+ workers).', icon: 'education', check: (c) => c.population.workerCount >= 2_000 && c.population.educatedCount >= c.population.workerCount * 0.6 },
  { id: 'happy', title: 'Happy Place', description: 'Reach 85% happiness with 5,000+ residents.', icon: 'happy', check: (c) => c.stats.population >= 5_000 && c.stats.happiness >= 85 },
  { id: 'storm', title: 'Weathered the Storm', description: 'Rebuild after a tornado.', icon: 'storm', check: (_c, a) => a.counters.tornadoes >= 1 },
  { id: 'metropolis', title: 'Metropolis', description: 'Reach 25,000 residents.', icon: 'people', check: (c) => c.stats.population >= 25_000 },
];

export const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

/** Long-term goals beyond the starter list; checked daily, saved with the city. */
export class Achievements {
  /** Achievement id → day it was earned. */
  readonly unlocked = new Map<string, number>();
  counters: AchievementCounters = { earthMoved: 0, treesPlanted: 0, surplusMonths: 0, tornadoes: 0 };

  constructor(private city: City) {}

  /** Unlocks any newly met achievements and announces them. */
  check(): AchievementDef[] {
    const out: AchievementDef[] = [];
    for (const a of ACHIEVEMENTS) {
      if (this.unlocked.has(a.id)) continue;
      if (!a.check(this.city, this)) continue;
      this.unlocked.set(a.id, this.city.clock.day);
      out.push(a);
      this.city.events.emit('achievement', { id: a.id, title: a.title });
      this.city.emitNotice({ severity: 'good', icon: 'milestone', title: `Achievement: ${a.title}`, text: a.description });
    }
    return out;
  }

  serialize(): AchievementSave {
    return { unlocked: [...this.unlocked], counters: { ...this.counters } };
  }

  load(data: AchievementSave | undefined): void {
    this.unlocked.clear();
    if (!data) return;
    for (const [id, day] of data.unlocked) if (ACHIEVEMENT_BY_ID.has(id)) this.unlocked.set(id, day);
    this.counters = { ...this.counters, ...data.counters };
  }
}
