import { formatInt, formatMoney, formatPct } from '../../core/math';
import type { City } from '../City';
import { tourismIncome } from '../CitySim';
import { MONTHS_PER_YEAR } from '../constants';
import { isResidential } from '../types';
import type { MapPreset } from '../world/Terrain';

export interface Objective {
  label: string;
  /** 0–1; the objective is met at 1. */
  progress: (city: City) => number;
  /** Current value for display. */
  detail: (city: City) => string;
}

export interface ScenarioDef {
  id: string;
  title: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  blurb: string;
  preset: MapPreset;
  seed: number;
  money: number;
  months: number;
  objectives: Objective[];
}

export interface ScenarioState {
  id: string;
  /** Month index when the scenario began. */
  startMonth: number;
  result: '' | 'won' | 'lost';
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const population = (n: number): Objective => ({
  label: `Reach ${formatInt(n)} residents`,
  progress: (c) => clamp01(c.stats.population / n),
  detail: (c) => `${formatInt(c.stats.population)} / ${formatInt(n)}`,
});
const happiness = (h: number): Objective => ({
  label: `Keep happiness at ${h}% or more`,
  progress: (c) => (c.stats.population < 200 ? 0 : clamp01(c.stats.happiness / h)),
  detail: (c) => `${Math.round(c.stats.happiness)}%`,
});
const surplus = (m: number): Objective => ({
  label: `Run a surplus of ${formatMoney(m)} a month`,
  progress: (c) => clamp01(c.economy.projectedNet / m),
  detail: (c) => `${c.economy.projectedNet < 0 ? '−' : '+'}${formatMoney(Math.abs(c.economy.projectedNet))}/mo`,
});
const bridges = (n: number): Objective => ({
  label: `Span the water with ${n} bridge${n > 1 ? 's' : ''}`,
  progress: (c) => clamp01(countBridges(c) / n),
  detail: (c) => `${countBridges(c)} / ${n}`,
});
const transitShare = (p: number): Objective => ({
  label: `${Math.round(p * 100)}% of commuters ride transit`,
  progress: (c) => clamp01(c.transit.modeShare / p),
  detail: (c) => formatPct(c.transit.modeShare),
});
const metroRiders = (n: number): Objective => ({
  label: `Carry ${formatInt(n)} metro riders a day`,
  progress: (c) => clamp01(c.transit.metro.totalRiders / n),
  detail: (c) => formatInt(c.transit.metro.totalRiders),
});
const tourism = (t: number): Objective => ({
  label: `Earn ${formatMoney(t)} a month from tourism`,
  progress: (c) => clamp01(tourismIncome(c) / t),
  detail: (c) => `${formatMoney(tourismIncome(c))}/mo`,
});
const cleanAir = (max: number): Objective => ({
  label: `Keep pollution at homes below ${Math.round(max * 100)}%`,
  progress: (c) => {
    const p = homePollution(c);
    return c.stats.population < 1000 ? 0 : p <= max ? 1 : clamp01(max / p);
  },
  detail: (c) => formatPct(homePollution(c)),
});

/** Bridges: connected runs of elevated road count once. */
function countBridges(c: City): number {
  const seen = new Set<number>();
  let n = 0;
  for (const s of c.roads.segments.values()) {
    if (!s.elevated || seen.has(s.id)) continue;
    n++;
    const stack = [s];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur.id)) continue;
      seen.add(cur.id);
      for (const nodeId of [cur.a, cur.b]) {
        for (const sid of c.roads.nodes.get(nodeId)?.segs ?? []) {
          const nb = c.roads.segments.get(sid);
          if (nb?.elevated && !seen.has(nb.id)) stack.push(nb);
        }
      }
    }
  }
  return n;
}

/** Average pollution where people live, weighted by residents. */
export function homePollution(c: City): number {
  let sum = 0, n = 0;
  for (const b of c.buildings.all.values()) {
    if (b.kind !== 'zoned' || !isResidential(b.zone) || !b.residents) continue;
    sum += c.landValue.pollutionAt(b.cx, b.cz) * b.residents;
    n += b.residents;
  }
  return n ? sum / n : 0;
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'first-steps', title: 'First Steps', difficulty: 'Easy', preset: 'coastal', seed: 1201, money: 260_000, months: 36,
    blurb: 'A quiet bay and a highway. Grow a happy, solvent town in three years.',
    objectives: [population(2_000), happiness(70), surplus(8_000)],
  },
  {
    id: 'across-the-river', title: 'Across the River', difficulty: 'Medium', preset: 'river', seed: 4242, money: 280_000, months: 60,
    blurb: 'The best land lies over the water. Bridge the river and get people riding buses.',
    objectives: [population(5_000), bridges(2), transitShare(0.1)],
  },
  {
    id: 'green-valley', title: 'Green Valley', difficulty: 'Medium', preset: 'lakes', seed: 777, money: 260_000, months: 72,
    blurb: 'Lakeland farmers want a city, not a smokestack. Keep the air clean as you grow.',
    objectives: [population(8_000), cleanAir(0.15), happiness(75)],
  },
  {
    id: 'tourist-coast', title: 'Tourist Coast', difficulty: 'Hard', preset: 'coastal', seed: 31337, money: 240_000, months: 96,
    blurb: 'Turn a fishing town into a destination: landmarks, gardens, hotels and an airport.',
    objectives: [population(12_000), tourism(20_000)],
  },
  {
    id: 'mountain-metro', title: 'Mountain Metro', difficulty: 'Hard', preset: 'highlands', seed: 909, money: 300_000, months: 108,
    blurb: 'Steep ridges choke the roads. Build a city that moves underground.',
    objectives: [population(15_000), metroRiders(1_500), transitShare(0.15)],
  },
];

export const SCENARIO_BY_ID = new Map(SCENARIOS.map((s) => [s.id, s]));

export function monthsLeft(city: City): number {
  const st = city.scenario;
  const def = st ? SCENARIO_BY_ID.get(st.id) : undefined;
  if (!st || !def) return 0;
  return Math.max(0, def.months - (city.clock.monthIndex - st.startMonth));
}

export function formatMonths(m: number): string {
  const y = Math.floor(m / MONTHS_PER_YEAR), mo = m % MONTHS_PER_YEAR;
  if (!y) return `${mo} month${mo === 1 ? '' : 's'}`;
  return mo ? `${y}y ${mo}m` : `${y} year${y === 1 ? '' : 's'}`;
}

/** Monthly check: decides the scenario once every objective is met or time runs out. */
export function checkScenario(city: City): '' | 'won' | 'lost' {
  const st = city.scenario;
  const def = st ? SCENARIO_BY_ID.get(st.id) : undefined;
  if (!st || !def || st.result) return '';
  if (def.objectives.every((o) => o.progress(city) >= 1)) st.result = 'won';
  else if (monthsLeft(city) <= 0) st.result = 'lost';
  if (st.result) city.events.emit('scenario', { id: def.id, result: st.result });
  return st.result;
}
