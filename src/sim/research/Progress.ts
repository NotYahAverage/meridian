import type { ServiceKind } from '../services/ServiceTypes';
import type { Design, Discovery } from './Generate';
import { FIELD_BY_ID, FIELDS, type FieldId } from './Knowledge';

/**
 * Long-term goals for a civilization's science: milestones (with lasting
 * rewards), mastery of a field at each centre, and retrofit programmes that
 * bring discoveries to buildings the city already has.
 */

// ── Milestones ──────────────────────────────────────────────────────────────

export interface MilestoneDef {
  id: string;
  title: string;
  goal: string;
  reward: string;
  field?: FieldId;
  /** Progress toward it: [have, need]. */
  progress: (s: ScienceSummary) => [number, number];
}

/** What the milestone checks look at. */
export interface ScienceSummary {
  discoveries: Discovery[];
  designs: Design[];
  breakthroughs: number;
  syntheses: number;
  iterations: number;
  retrofits: number;
}

const perField = (s: ScienceSummary, f: FieldId) => s.discoveries.filter((d) => d.field === f).length;

export const MILESTONES: MilestoneDef[] = [
  { id: 'first', title: 'First discovery', goal: 'Make a discovery', reward: '$15,000 grant from the council', progress: (s) => [Math.min(1, s.discoveries.length), 1] },
  { id: 'fields5', title: 'Broad science', goal: 'Discoveries in five different fields', reward: 'Every centre offers one more proposal', progress: (s) => [new Set(s.discoveries.map((d) => d.field)).size, 5] },
  { id: 'designs3', title: 'Native architecture', goal: 'Design three buildings', reward: 'Buildings your scientists designed cost 10% less', progress: (s) => [s.designs.length, 3] },
  { id: 'synth', title: 'Synthesis', goal: 'Complete a synthesis of two discoveries', reward: 'Synthesis experiments cost 20% less to start', progress: (s) => [Math.min(1, s.syntheses), 1] },
  { id: 'iterate', title: 'Second generation', goal: 'Develop a Mark II of a design', reward: 'Design iterations run 20% faster', progress: (s) => [Math.min(1, s.iterations), 1] },
  { id: 'breakthrough3', title: 'Golden age', goal: 'Three breakthroughs', reward: '+1 resident happiness (civic pride)', progress: (s) => [Math.min(3, s.breakthroughs), 3] },
  { id: 'retrofit', title: 'Science at work', goal: 'Complete a retrofit programme', reward: 'Retrofits cost 15% less', progress: (s) => [Math.min(1, s.retrofits), 1] },
  ...FIELDS.map((f): MilestoneDef => ({
    id: `field:${f.id}`, field: f.id, title: `${f.name}: established`, goal: `Three discoveries in ${f.name.toLowerCase()}`,
    reward: `+5% success on ${f.name.toLowerCase()} experiments`, progress: (s) => [Math.min(3, perField(s, f.id)), 3],
  })),
];

export const MILESTONE_BY_ID = new Map(MILESTONES.map((m) => [m.id, m]));

/** Milestones newly reached (not already in `have`). */
export function newMilestones(s: ScienceSummary, have: Set<string>): MilestoneDef[] {
  return MILESTONES.filter((m) => !have.has(m.id)).filter((m) => {
    const [a, b] = m.progress(s);
    return a >= b;
  });
}

// ── Mastery ─────────────────────────────────────────────────────────────────

/** Experience points needed for each mastery level (a success is 1, anything else ½). */
export const MASTERY_STEPS = [0, 2, 5, 9];
export const MASTERY_NAMES = ['Novice', 'Practised', 'Expert', 'Master'];

export function masteryLevel(xp: number): number {
  let l = 0;
  for (let i = 0; i < MASTERY_STEPS.length; i++) if (xp >= MASTERY_STEPS[i]) l = i;
  return l;
}

// ── Retrofits ───────────────────────────────────────────────────────────────

export interface Retrofit {
  /** The discovery it comes from (one programme per discovery). */
  id: string;
  title: string;
  /** Service kind it upgrades. */
  target: ServiceKind;
  targetLabel: string;
  what: 'pollution' | 'output';
  /** Fractional change (−0.3 = 30 % less pollution, +0.1 = 10 % more output). */
  value: number;
  /** Cost to fit each existing building. */
  perBuilding: number;
  summary: string;
}

const TARGET_LABEL: Partial<Record<ServiceKind, string>> = { power: 'power plants', water: 'water works', sewage: 'sewage works', garbage: 'waste facilities' };

/** The retrofit programme a discovery makes possible, if any. */
export function retrofitFor(d: Discovery, design?: Design): Retrofit | null {
  if (d.outcome === 'failure') return null;
  const q = d.quality;
  const make = (target: ServiceKind, what: Retrofit['what'], value: number, title: string): Retrofit => {
    const label = TARGET_LABEL[target] ?? `${target} facilities`;
    const perBuilding = Math.round((5_000 + 12_000 * q) / 500) * 500;
    const summary = what === 'pollution'
      ? `Fit every ${label.replace(/s$/, '')} with ${d.name}: ${Math.round(-value * 100)}% less pollution from all of them, including ones built later.`
      : `Upgrade every ${label.replace(/s$/, '')} with ${d.name}: ${Math.round(value * 100)}% more output from all of them, including ones built later.`;
    return { id: d.id, title, target, targetLabel: label, what, value, perBuilding, summary };
  };
  if (design?.fn === 'scrubber') return make('power', 'pollution', -(0.15 + 0.25 * q), `Retrofit power plants with ${d.name} filters`);
  for (const e of d.effects) {
    if (e.kind === 'powerPollution') return make('power', 'pollution', -(0.2 + 0.25 * q), `Scrub existing power plants`);
    if (e.kind === 'industryPollution') return make('garbage', 'pollution', -(0.2 + 0.25 * q), `Clean up the waste facilities`);
    if (e.kind === 'boost' && (e.target === 'power' || e.target === 'water')) return make(e.target, 'output', 0.05 + 0.1 * q, `Upgrade existing ${TARGET_LABEL[e.target]}`);
    if (e.kind === 'waterUse') return make('sewage', 'output', 0.05 + 0.08 * q, 'Upgrade the sewage works');
  }
  if (d.component === 'solarRoof' || d.component === 'fins') return make('power', 'output', 0.04 + 0.05 * q, 'Solar retrofit for the power plants');
  return null;
}

export function fieldName(f: FieldId): string {
  return FIELD_BY_ID.get(f)!.name;
}
