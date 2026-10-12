import { Rng } from '../../core/rng';
import type { ServiceCategory, ServiceKind } from '../services/ServiceTypes';
import { type ArchSpec, FIELD_ACCENT, composeArch, validateArch } from './Architecture';
import {
  COMPONENT_LABEL, type ComponentKind, FIELD_BY_ID, FIELDS, FUNCTION_LABEL, type FieldId, type FunctionKind, MODIFIER_LABEL, type ModifierKind,
  PRINCIPLES, PRINCIPLE_BY_ID, type Principle, RESOURCE_BY_ID, type ResourceDef, TAG_NAMES, fit,
} from './Knowledge';

/**
 * Pure generation for the research system: names, experiment proposals,
 * decisions, outcomes, discoveries and building designs. Everything here is a
 * deterministic function of the civilization's seed and its recorded state, so
 * the same history always produces the same results.
 */

// ── Types ───────────────────────────────────────────────────────────────────

/** A city-wide change. `value` is a fraction (−0.12 = 12 % less) or, for happiness, points. */
export interface Effect {
  kind: ModifierKind;
  value: number;
  /** For 'boost': which facilities it improves (a service kind, or 'storage'). */
  target?: string;
}

export type Direction = 'apply' | 'refine' | 'theory';
export type Outcome = 'breakthrough' | 'success' | 'partial' | 'unexpected' | 'failure' | 'interrupted' | 'abandoned';
export type DiscoveryKind = 'design' | 'modifier' | 'component' | 'foundation';

export interface DesignStats {
  kind: ServiceKind;
  category: ServiceCategory;
  cost: number;
  upkeep: number;
  w: number;
  d: number;
  jobs: number;
  radius: number;
  capacity: number;
  output: number;
  storage: number;
  pollution: number;
  attractiveness: number;
  tourism: number;
  needsShore: boolean;
}

export interface Design {
  id: string;
  /** Service type id and building style it is built with. */
  serviceId: string;
  style: string;
  discoveryId: string;
  name: string;
  description: string;
  fn: FunctionKind;
  field: FieldId;
  stats: DesignStats;
  arch: ArchSpec;
  /** Architectural features it was given (for the interface). */
  traits: string[];
}

export interface Discovery {
  id: string;
  name: string;
  field: FieldId;
  principle: string;
  resource: string;
  kind: DiscoveryKind;
  /** "Electrochemical cells · Storage facility". */
  classification: string;
  description: string;
  quality: number;
  outcome: Outcome;
  effects: Effect[];
  drawbacks: Effect[];
  component?: ComponentKind;
  /** Knowledge it provides (opens methods that need it). */
  tags: string[];
  /** Discoveries it built on. */
  basis: string[];
  designId?: string;
  /** Methods it made possible, at the time it was made. */
  opened: string[];
  day: number;
  experimentId: string;
  centerName: string;
}

export interface Plan {
  id: string;
  centerId: number;
  title: string;
  summary: string;
  field: FieldId;
  principle: string;
  resource: string;
  /** Discoveries it combines or follows up. */
  basis: string[];
  kind: 'study' | 'synthesis' | 'followup';
  cost: number;
  monthly: number;
  days: number;
  /** Spare electricity the centre needs while it runs (MW). */
  power: number;
  risk: number;
  prospects: string[];
  clues: string[];
}

export interface DecisionOption {
  id: string;
  label: string;
  detail: string;
  quality: number;
  risk: number;
  /** Extra money committed when chosen. */
  cost: number;
  days: number;
  direction?: Direction;
  /** Follows an anomaly toward another field. */
  anomaly?: FieldId;
}

export interface Decision {
  stage: number;
  title: string;
  prompt: string;
  options: DecisionOption[];
}

export interface Choice {
  stage: number;
  option: DecisionOption;
}

/** What the generator needs to know about the civilization. */
export interface CivState {
  civSeed: number;
  day: number;
  /** Knowledge tags discovered so far. */
  tags: Set<string>;
  discoveries: Discovery[];
  /** principle|resource pairs that already produced a discovery. */
  achieved: Set<string>;
  /** Failures and abandoned work per principle (each makes the next attempt safer). */
  insights: Map<string, number>;
  /** Architectural components discovered. */
  components: ComponentKind[];
}

export interface CenterInfo {
  id: number;
  name: string;
  field: FieldId;
  secondary: FieldId[];
  equipment: number;
}

// ── Hashing ─────────────────────────────────────────────────────────────────

export function hashStr(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

export const rngFor = (...parts: (string | number)[]) => new Rng(hashStr(...parts));
const unit = (...parts: (string | number)[]) => hashStr(...parts) / 4294967296;

// ── Names ───────────────────────────────────────────────────────────────────

/** Each civilization names things in its own sound. */
const SYLLABLES = [
  ['var', 'en', 'tor', 'ka', 'lis', 'dor', 'mi', 'ra', 'sen', 'oth', 'ul', 'bel'],
  ['ha', 'lo', 'vin', 'ste', 'gar', 'ru', 'mel', 'ia', 'cor', 'dan', 've', 'ish'],
  ['ze', 'pha', 'qui', 'ron', 'al', 'ba', 'tesh', 'yo', 'mar', 'nek', 'di', 'sol'],
  ['kel', 'wyn', 'bra', 'ost', 'fen', 'la', 'gil', 'thal', 'an', 'rhi', 'dun', 'mo'],
  ['ar', 'ven', 'is', 'cal', 'dra', 'te', 'mon', 'ny', 'sel', 'or', 'quin', 'ade'],
];

export function eponym(civSeed: number, ...key: (string | number)[]): string {
  const r = rngFor(civSeed, 'name', ...key);
  const set = SYLLABLES[civSeed % SYLLABLES.length];
  const n = r.chance(0.55) ? 2 : 3;
  let s = '';
  let last = '';
  for (let i = 0; i < n; i++) {
    let syl = r.pick(set);
    if (syl === last) syl = set[(set.indexOf(syl) + 1 + r.int(0, set.length - 2)) % set.length];
    s += syl;
    last = syl;
  }
  return s[0].toUpperCase() + s.slice(1);
}

const INSTITUTIONS = ['Institute', 'Laboratories', 'Research Station', 'Polytechnic', 'Experimental Works', 'Academy of Sciences', 'Research Centre'];
const FIELD_STUDY: Record<FieldId, string> = {
  materials: 'Materials Science', energy: 'Energy Studies', agriculture: 'Agronomy', manufacturing: 'Industrial Research', transport: 'Infrastructure',
  water: 'Hydrology', environment: 'Environmental Science', architecture: 'Architecture', medicine: 'Medical Research',
};

export function centerName(civSeed: number, id: number, field: FieldId): string {
  const r = rngFor(civSeed, 'center', id);
  const who = eponym(civSeed, 'center', id);
  const inst = r.pick(INSTITUTIONS);
  return r.chance(0.5) ? `${who} ${inst} of ${FIELD_STUDY[field]}` : `${who} ${inst}`;
}

// ── Proposals ───────────────────────────────────────────────────────────────

const pairKey = (p: string, r: string) => `${p}|${r}`;

/** Fields a centre works in: its specialization and two secondary ones. */
export function reach(c: CenterInfo): FieldId[] {
  return [c.field, ...c.secondary];
}

/** Methods the civilization knows enough to attempt. */
export function availablePrinciples(civ: CivState): Principle[] {
  return PRINCIPLES.filter((p) => !p.needs || p.needs.every((t) => civ.tags.has(t)));
}

export interface ProposalContext {
  /** Substances the centre can use: id → reachable (local ones may be out of reach). */
  resources: Map<string, { ok: boolean; why?: string }>;
  /** How pressing each field is for the city right now (0–1). */
  needs: Partial<Record<FieldId, number>>;
  /** Follow-ups suggested by earlier failures. */
  followups: { principle: string; resource: string; basis: string; note: string }[];
}

function planNumbers(p: Principle, f: number, civ: CivState, kind: Plan['kind'], r: Rng): Pick<Plan, 'cost' | 'monthly' | 'days' | 'power' | 'risk'> {
  const mult = kind === 'synthesis' ? 1.5 : kind === 'followup' ? 0.8 : 1;
  const insight = Math.min(3, civ.insights.get(p.id) ?? 0);
  const round = (v: number, step: number) => Math.round(v / step) * step;
  return {
    cost: round((6_000 + 26_000 * p.difficulty) * mult * (0.9 + 0.2 * r.next()), 500),
    monthly: round((600 + 2_400 * p.difficulty) * (kind === 'synthesis' ? 1.3 : 1), 50),
    days: Math.round((10 + 18 * p.difficulty) * (kind === 'synthesis' ? 1.2 : 1) + r.int(0, 4)),
    power: Math.round((0.5 + 3 * p.difficulty) * 10) / 10,
    risk: Math.max(0.04, 0.12 + 0.4 * p.difficulty - 0.15 * f - 0.06 * insight - (kind === 'followup' ? 0.1 : 0) + (kind === 'synthesis' ? 0.05 : 0)),
  };
}

function prospectsFor(p: Principle): string[] {
  const out: string[] = [];
  if (p.build) out.push(`Pilot facility: could become a new ${FUNCTION_LABEL[p.build]} you can build`);
  if (p.mod) out.push(`Refined method: could change ${MODIFIER_LABEL[p.mod]} across the city`);
  if (p.comp) out.push(`Refined material: ${COMPONENT_LABEL[p.comp]} for future buildings`);
  out.push(`Theory: ${p.gives.map((t) => TAG_NAMES[t] ?? t).join(' and ')} — opens new lines of research`);
  return out;
}

function propertyClue(p: Principle, r: ResourceDef): string {
  const entries = Object.entries(p.prefers).sort((a, b) => b[1] - a[1]);
  const [prop] = entries[0];
  const v = (r.props as Record<string, number>)[prop] ?? 0;
  const word = v > 0.75 ? 'excellent' : v > 0.5 ? 'good' : v > 0.3 ? 'modest' : 'poor';
  return `${r.name} has ${word} ${prop} — the property ${p.name.toLowerCase()} depends on most.`;
}

/**
 * Proposals a centre offers now. They follow from what the civilization knows,
 * the substances within reach, the city's pressing needs, earlier failures and
 * the centre's specialization; the seed only breaks ties.
 */
export function generateProposals(civ: CivState, center: CenterInfo, ctx: ProposalContext, round: number, nextId: () => string): Plan[] {
  const fields = reach(center);
  const known = availablePrinciples(civ).filter((p) => fields.includes(p.field) && p.tier <= center.equipment);
  type Cand = { p: Principle; r: ResourceDef; score: number; f: number; follow?: ProposalContext['followups'][number] };
  const cands: Cand[] = [];
  for (const p of known) {
    for (const [rid, reachable] of ctx.resources) {
      if (!reachable.ok) continue;
      const res = RESOURCE_BY_ID.get(rid)!;
      const f = fit(p, res);
      if (f < 0.3) continue;
      if (civ.achieved.has(pairKey(p.id, rid))) continue;
      const follow = ctx.followups.find((q) => q.principle === p.id && q.resource === rid);
      const spec = p.field === center.field ? 0.45 : 0.15;
      const need = (ctx.needs[p.field] ?? 0) * 0.6;
      const fresh = (civ.insights.get(p.id) ?? 0) === 0 ? 0.15 : 0;
      const jitter = unit(civ.civSeed, center.id, round, p.id, rid) * 0.45;
      cands.push({ p, r: res, f, follow, score: f + spec + need + fresh + jitter + (follow ? 0.6 : 0) + (p.needs ? 0.2 : 0) });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const want = 2 + center.equipment;
  const picked: Cand[] = [];
  const perPrinciple = new Set<string>();
  for (const c of cands) {
    if (picked.length >= want) break;
    if (perPrinciple.has(c.p.id)) continue;
    perPrinciple.add(c.p.id);
    picked.push(c);
  }
  const plans: Plan[] = picked.map((c) => {
    const r = rngFor(civ.civSeed, 'plan', center.id, round, c.p.id, c.r.id);
    const kind: Plan['kind'] = c.follow ? 'followup' : 'study';
    const nums = planNumbers(c.p, c.f, civ, kind, r);
    const clues = [propertyClue(c.p, c.r)];
    const ins = civ.insights.get(c.p.id) ?? 0;
    if (ins) clues.push(`Earlier setbacks with ${c.p.name.toLowerCase()} taught your scientists what to avoid (risk lower).`);
    if (c.follow) clues.push(c.follow.note);
    if (c.p.needs) clues.push(`Builds on ${c.p.needs.map((t) => TAG_NAMES[t] ?? t).join(' and ')}.`);
    const verb = r.pick(['Test', 'Explore', 'Investigate', 'Trial']);
    return {
      id: nextId(),
      centerId: center.id,
      title: c.follow ? `Follow-up: ${c.p.name} with ${c.r.name.toLowerCase()}` : `${verb} ${c.p.name.toLowerCase()} with ${c.r.name.toLowerCase()}`,
      summary: `Can ${c.r.name.toLowerCase()} (${c.r.source.toLowerCase()}) be put to work through ${c.p.name.toLowerCase()}? ${c.f > 0.6 ? 'It looks promising on paper.' : c.f > 0.45 ? 'The fit is reasonable but unproven.' : 'A long shot, but a cheap one to rule out.'}`,
      field: c.p.field,
      principle: c.p.id,
      resource: c.r.id,
      basis: c.follow ? [c.follow.basis] : [],
      kind,
      ...nums,
      prospects: prospectsFor(c.p),
      clues,
    };
  });
  // Synthesis: improve a design with a discovery from another field.
  const designs = civ.discoveries.filter((d) => d.designId && fields.includes(d.field));
  const others = civ.discoveries.filter((d) => d.kind !== 'foundation' || d.tags.length);
  if (designs.length && others.length > 1) {
    const r = rngFor(civ.civSeed, 'synth', center.id, round);
    const a = r.pick(designs);
    const bs = others.filter((d) => d.id !== a.id && d.field !== a.field && !civ.achieved.has(`synth|${a.id}|${d.id}`));
    if (bs.length) {
      const b = r.pick(bs);
      const p = PRINCIPLE_BY_ID.get(a.principle)!;
      const nums = planNumbers(p, 0.6, civ, 'synthesis', r);
      plans.push({
        id: nextId(),
        centerId: center.id,
        title: `Combine ${a.name} with ${b.name}`,
        summary: `Apply what ${b.name} revealed about ${FIELD_BY_ID.get(b.field)!.name.toLowerCase()} to ${a.name}. A successful synthesis produces an improved, distinct design.`,
        field: a.field,
        principle: a.principle,
        resource: a.resource,
        basis: [a.id, b.id],
        kind: 'synthesis',
        ...nums,
        prospects: [`An advanced ${FUNCTION_LABEL[p.build ?? 'powerGen']} combining both discoveries`, ...(b.tags.length ? [`Deeper ${b.tags.map((t) => TAG_NAMES[t] ?? t).join(' and ')}`] : [])],
        clues: [`${a.name} (${Math.round(a.quality * 100)}% quality) and ${b.name} (${Math.round(b.quality * 100)}%): the better they are, the better the result.`],
      });
    }
  }
  return plans;
}

// ── Decisions ───────────────────────────────────────────────────────────────

/** Progress points where the centre needs a decision. */
export const STAGES = [0.25, 0.6];

const COMPLICATIONS: Record<FieldId, { prompt: string; push: string; safe: string }[]> = {
  materials: [
    { prompt: 'Samples made with {res} crack under load.', push: 'Raise the curing temperature', safe: 'Accept weaker but consistent samples' },
    { prompt: 'Batches of {res} set unevenly.', push: 'Rebuild the kilns for tighter control', safe: 'Use smaller, slower batches' },
  ],
  energy: [
    { prompt: 'The {res} prototype loses output overnight.', push: 'Add insulation and a second test rig', safe: 'Run it at a gentler, steadier rate' },
    { prompt: 'Readings from the {res} rig drift as it heats up.', push: 'Buy precision instruments', safe: 'Limit tests to cool mornings' },
  ],
  agriculture: [
    { prompt: 'Trial plots on {res} grow fast but sicken.', push: 'Install climate control in the beds', safe: 'Rotate crops and grow less' },
    { prompt: 'Yields on {res} vary wildly between beds.', push: 'Sequence the strains and replant', safe: 'Keep only the steadiest beds' },
  ],
  manufacturing: [
    { prompt: 'The {res} line jams at full speed.', push: 'Retool the line for higher tolerances', safe: 'Run the line at half speed' },
    { prompt: 'Parts made from {res} come out with hairline flaws.', push: 'Add an inspection and rework stage', safe: 'Relax the specification' },
  ],
  transport: [
    { prompt: 'Test sections using {res} rut under heavy trucks.', push: 'Lay a deeper, reinforced test bed', safe: 'Limit the trial to light traffic' },
    { prompt: 'Signals tuned with {res} sensors misfire in rain.', push: 'Weatherproof every sensor', safe: 'Fall back to fixed timings in bad weather' },
  ],
  water: [
    { prompt: 'Filters based on {res} clog within days.', push: 'Add a back-flushing system', safe: 'Change filters more often' },
    { prompt: 'Samples treated with {res} test cloudy.', push: 'Add a second treatment stage', safe: 'Accept a lower flow rate' },
  ],
  environment: [
    { prompt: 'The {res} beds saturate faster than expected.', push: 'Double the bed depth', safe: 'Regenerate the beds more often' },
    { prompt: 'Measurements around the {res} rig are noisy.', push: 'Build a sealed test chamber', safe: 'Average over longer runs' },
  ],
  architecture: [
    { prompt: 'Mock-ups using {res} overheat in the afternoon sun.', push: 'Redesign the envelope from scratch', safe: 'Add simple shading and move on' },
    { prompt: 'Visitors find the {res} prototype confusing to move through.', push: 'Run a full-scale user study', safe: 'Simplify the plan' },
  ],
  medicine: [
    { prompt: 'Early {res} trials show mixed results.', push: 'Expand the trial to more volunteers', safe: 'Narrow the trial to the clearest cases' },
    { prompt: 'Lab cultures with {res} are contaminated.', push: 'Build a clean room', safe: 'Restart with smaller cultures' },
  ],
};

/** The decision a running experiment reaches at a stage. Deterministic per experiment. */
export function decisionFor(civSeed: number, plan: Plan, stage: number): Decision {
  const p = PRINCIPLE_BY_ID.get(plan.principle)!;
  const res = RESOURCE_BY_ID.get(plan.resource)!;
  const r = rngFor(civSeed, 'decision', plan.id, stage);
  if (stage === 0) {
    const options: DecisionOption[] = [];
    if (p.build || plan.kind === 'synthesis') {
      const fn = p.build ?? 'powerGen';
      options.push({
        id: 'apply', direction: 'apply', label: `Build a pilot ${FUNCTION_LABEL[fn]}`,
        detail: 'Aims for a working facility your city could build. Costs more and adds some risk.',
        quality: 0.05, risk: 0.06, cost: Math.round(plan.cost * 0.25 / 500) * 500, days: 3,
      });
    }
    if ((p.mod || p.comp) && plan.kind !== 'synthesis') {
      options.push({
        id: 'refine', direction: 'refine', label: p.mod ? 'Refine it into a working method' : 'Develop it into a building material',
        detail: p.mod ? `Aims to change ${MODIFIER_LABEL[p.mod]} across the city.` : `Aims for ${COMPONENT_LABEL[p.comp!]} that later buildings can use.`,
        quality: 0, risk: 0, cost: 0, days: 0,
      });
    }
    options.push({
      id: 'theory', direction: 'theory', label: 'Probe the underlying mechanism',
      detail: 'Safer and quicker. Usually yields knowledge that opens new research rather than an immediate benefit.',
      quality: -0.05, risk: -0.12, cost: 0, days: -2,
    });
    return { stage, title: 'Choose an approach', prompt: `The first results on ${res.name.toLowerCase()} are in. Where should the team take this?`, options };
  }
  const tpl = r.pick(COMPLICATIONS[plan.field]);
  const near = FIELD_BY_ID.get(plan.field)!.near;
  const toward = near[Math.floor(unit(civSeed, plan.id, 'anomaly') * near.length)];
  return {
    stage,
    title: 'A complication',
    prompt: tpl.prompt.replace('{res}', res.name.toLowerCase()),
    options: [
      { id: 'push', label: tpl.push, detail: 'Better results if it works, but riskier and more expensive.', quality: 0.15, risk: 0.1, cost: Math.round(plan.cost * 0.2 / 500) * 500, days: 2 },
      { id: 'probe', label: 'Investigate the anomaly', detail: `Something odd is going on. Chasing it may lead somewhere unexpected — perhaps into ${FIELD_BY_ID.get(toward)!.name.toLowerCase()}.`, quality: -0.02, risk: 0.02, cost: 0, days: 2, anomaly: toward },
      { id: 'safe', label: tpl.safe, detail: 'Lower risk, more modest results.', quality: -0.1, risk: -0.1, cost: 0, days: 0 },
    ],
  };
}

// ── Outcomes ────────────────────────────────────────────────────────────────

export interface Odds {
  chance: number;
  factors: [string, number][];
}

/** Chance of success and why, before the dice. */
export function odds(plan: Plan, choices: Choice[], center: CenterInfo, civ: CivState, education: number): Odds {
  const factors: [string, number][] = [['Base', 0.62], ['Difficulty', -plan.risk]];
  factors.push([`Equipment level ${center.equipment}`, 0.06 * center.equipment]);
  if (plan.field === center.field) factors.push(['Specialization', 0.1]);
  const fieldWork = civ.discoveries.filter((d) => d.field === plan.field).length;
  if (fieldWork) factors.push([`${fieldWork} earlier discover${fieldWork === 1 ? 'y' : 'ies'} in the field`, Math.min(0.15, 0.04 * fieldWork)]);
  if (education > 0.05) factors.push(['Educated staff nearby', 0.1 * education]);
  for (const c of choices) if (c.option.risk) factors.push([c.option.label, -c.option.risk]);
  const chance = Math.max(0.08, Math.min(0.94, factors.reduce((a, [, v]) => a + v, 0)));
  return { chance, factors };
}

export interface Resolution {
  outcome: Outcome;
  quality: number;
  chance: number;
  direction: Direction;
  /** Field and method actually discovered (an anomaly can move it). */
  field: FieldId;
  principle: string;
}

/** The result of a finished experiment: a deterministic function of its plan, decisions and context. */
export function resolve(civ: CivState, plan: Plan, choices: Choice[], center: CenterInfo, education: number): Resolution {
  const { chance } = odds(plan, choices, center, civ, education);
  const key = choices.map((c) => `${c.stage}:${c.option.id}`).join(',');
  const roll = unit(civ.civSeed, 'roll', plan.id, key);
  const direction: Direction = choices.find((c) => c.option.direction)?.option.direction ?? (plan.kind === 'synthesis' ? 'apply' : 'refine');
  const bonus = choices.reduce((a, c) => a + c.option.quality, 0);
  let quality = 0.3 + 0.4 * chance + bonus + (plan.kind === 'synthesis' ? 0.1 : 0);
  let outcome: Outcome;
  if (roll < chance * 0.28) {
    outcome = 'breakthrough';
    quality += 0.18;
  } else if (roll < chance) outcome = 'success';
  else if (roll < chance + 0.15) {
    outcome = 'partial';
    quality *= 0.65;
  } else outcome = 'failure';
  let field = plan.field;
  let principle = plan.principle;
  const probe = choices.find((c) => c.option.anomaly);
  if (probe && outcome !== 'failure' && unit(civ.civSeed, 'anomaly', plan.id) < 0.6) {
    // The anomaly led into another field: the same substance, a different method.
    const res = RESOURCE_BY_ID.get(plan.resource)!;
    const alt = availablePrinciples(civ)
      .filter((p) => p.field === probe.option.anomaly && fit(p, res) >= 0.2)
      .sort((a, b) => fit(b, res) - fit(a, res) || a.id.localeCompare(b.id));
    if (alt.length) {
      field = alt[0].field;
      principle = alt[0].id;
      outcome = 'unexpected';
      quality += 0.05;
    }
  }
  return { outcome, quality: Math.max(0.12, Math.min(1, quality)), chance, direction, field, principle };
}

// ── Discoveries ─────────────────────────────────────────────────────────────

const pct = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;

export function describeEffect(e: Effect): string {
  const up = e.value > 0;
  switch (e.kind) {
    case 'happiness': return `${up ? '+' : '−'}${Math.abs(e.value).toFixed(1)} resident happiness`;
    case 'landValue': return `${up ? '+' : '−'}${pct(e.value)} land value across the city`;
    case 'boost': return `${up ? '+' : '−'}${pct(e.value)} output from ${e.target === 'storage' ? 'energy storage' : `every ${e.target} facility`}`;
    default: return `${up ? '+' : '−'}${pct(e.value)} ${MODIFIER_LABEL[e.kind]}`;
  }
}

function modifierEffect(kind: ModifierKind, q: number, p: Principle): Effect {
  switch (kind) {
    case 'buildCost': return { kind, value: -(0.05 + 0.12 * q) };
    case 'powerUse': return { kind, value: -(0.04 + 0.1 * q) };
    case 'waterUse': return { kind, value: -(0.05 + 0.12 * q) };
    case 'garbage': return { kind, value: -(0.06 + 0.14 * q) };
    case 'roadCapacity': return { kind, value: 0.05 + 0.1 * q };
    case 'industryEfficiency': return { kind, value: 0.04 + 0.08 * q };
    case 'industryPollution': return { kind, value: -(0.1 + 0.2 * q) };
    case 'powerPollution': return { kind, value: -(0.12 + 0.25 * q) };
    case 'happiness': return { kind, value: 1 + 3 * q };
    case 'landValue': return { kind, value: 0.01 + 0.03 * q };
    case 'boost': return { kind, value: 0.1 + 0.2 * q, target: p.build === 'storage' ? 'storage' : p.build === 'powerGen' ? 'power' : p.build === 'water' ? 'water' : 'power' };
  }
}

/** Components also do something now, not only for later buildings. */
const COMPONENT_EFFECT: Record<ComponentKind, (q: number) => Effect> = {
  glass: (q) => ({ kind: 'landValue', value: 0.008 + 0.012 * q }),
  stone: (q) => ({ kind: 'buildCost', value: -(0.03 + 0.04 * q) }),
  timber: (q) => ({ kind: 'buildCost', value: -(0.04 + 0.05 * q) }),
  brick: (q) => ({ kind: 'buildCost', value: -(0.03 + 0.04 * q) }),
  gardenRoof: (q) => ({ kind: 'happiness', value: 0.6 + 1 * q }),
  solarRoof: (q) => ({ kind: 'powerUse', value: -(0.03 + 0.04 * q) }),
  tallFrame: (q) => ({ kind: 'landValue', value: 0.01 + 0.015 * q }),
  fins: (q) => ({ kind: 'powerUse', value: -(0.02 + 0.04 * q) }),
  dome: (q) => ({ kind: 'happiness', value: 0.5 + 0.8 * q }),
};

/** Trade-offs that follow from the method and the substance. */
function drawbacksFor(kind: DiscoveryKind, mod: ModifierKind | undefined, res: ResourceDef, outcome: Outcome, q: number): Effect[] {
  const out: Effect[] = [];
  const dirty = (res.props.purity ?? 0.5) < 0.35;
  if (mod === 'industryEfficiency') out.push({ kind: 'industryPollution', value: dirty ? 0.08 : 0.04 });
  if (mod === 'roadCapacity' && dirty) out.push({ kind: 'landValue', value: -0.01 });
  if (mod === 'buildCost' && dirty) out.push({ kind: 'happiness', value: -0.5 });
  if (mod === 'powerUse' && (res.props.conductivity ?? 0) > 0.8) out.push({ kind: 'boost', value: -0.04, target: 'power' });
  if (outcome === 'partial') {
    // Half-working results come with a catch.
    if (kind === 'modifier' || kind === 'component') out.push({ kind: 'happiness', value: -(0.4 + 0.6 * (1 - q)) });
  }
  return out;
}

export interface MadeDiscovery {
  discovery: Discovery;
  design?: Design;
}

const KIND_LABEL: Record<DiscoveryKind, string> = { design: 'Facility', modifier: 'Method', component: 'Material', foundation: 'Theory' };

/**
 * Builds the discovery an experiment produced. Its kind follows the chosen
 * direction and what the method can give; its strength follows the quality.
 */
export function makeDiscovery(civ: CivState, plan: Plan, res: Resolution, center: CenterInfo, ids: { discovery: string; design: string; serviceId: string }): MadeDiscovery {
  const p = PRINCIPLE_BY_ID.get(res.principle)!;
  const r0 = RESOURCE_BY_ID.get(plan.resource)!;
  const q = res.quality;
  const rng = rngFor(civ.civSeed, 'disc', ids.discovery);
  let kind: DiscoveryKind;
  if (res.direction === 'theory') kind = 'foundation';
  else if (res.direction === 'apply' && (p.build || plan.kind === 'synthesis')) kind = 'design';
  else if (p.comp && (!p.mod || rng.chance(0.4))) kind = 'component';
  else if (p.mod) kind = 'modifier';
  else if (p.build) kind = 'design';
  else kind = 'foundation';
  // A weak attempt at a facility gives the understanding, not the building.
  if (kind === 'design' && res.outcome === 'partial' && q < 0.3) kind = 'foundation';

  const who = eponym(civ.civSeed, 'disc', ids.discovery);
  const noun = rng.pick(p.nouns);
  const basis = [...plan.basis];
  let name: string;
  if (kind === 'foundation') name = `${who}'s ${p.theory}`;
  else if (kind === 'modifier') name = `${who} ${noun}`;
  else if (kind === 'component') name = `${r0.adj} ${COMPONENT_LABEL[p.comp!].replace(/s$/, '').replace(/^\w/, (c) => c.toUpperCase())}`;
  else name = `${r0.adj} ${rng.pick(p.facilities ?? p.nouns)}${plan.kind === 'synthesis' ? ` ${rng.pick(['II', 'Mark II', 'Advanced'])}` : ''}`;

  const effects: Effect[] = [];
  let component: ComponentKind | undefined;
  if (kind === 'modifier') effects.push(modifierEffect(p.mod!, q, p));
  if (kind === 'component') {
    component = p.comp!;
    effects.push(COMPONENT_EFFECT[component](q));
  }
  const drawbacks = drawbacksFor(kind, kind === 'modifier' ? p.mod : undefined, r0, res.outcome, q);
  const tags = res.outcome === 'failure' ? [] : [...p.gives];
  const before = new Set(availablePrinciples(civ).map((x) => x.id));
  const withTags: CivState = { ...civ, tags: new Set([...civ.tags, ...tags]) };
  const opened = availablePrinciples(withTags).map((x) => x.id).filter((id) => !before.has(id));

  const field = FIELD_BY_ID.get(res.field)!;
  const classification = `${p.name} · ${KIND_LABEL[kind]}${kind === 'design' ? ` (${FUNCTION_LABEL[p.build ?? 'powerGen']})` : ''}`;
  const discovery: Discovery = {
    id: ids.discovery,
    name,
    field: res.field,
    principle: p.id,
    resource: r0.id,
    kind,
    classification,
    description: '',
    quality: q,
    outcome: res.outcome,
    effects,
    drawbacks,
    component,
    tags,
    basis,
    opened,
    day: civ.day,
    experimentId: plan.id,
    centerName: center.name,
  };
  let design: Design | undefined;
  if (kind === 'design') {
    const base = plan.kind === 'synthesis' ? civ.discoveries.find((d) => d.id === plan.basis[0]) : undefined;
    const partner = plan.kind === 'synthesis' ? civ.discoveries.find((d) => d.id === plan.basis[1]) : undefined;
    design = makeDesign(civ, discovery, p, r0, q, ids, partner);
    discovery.designId = design.id;
    if (base) discovery.basis = [base.id, ...(partner ? [partner.id] : [])];
  }
  discovery.description = describeDiscovery(discovery, p, r0, field.name, center.name, design, opened);
  return { discovery, design };
}

function describeDiscovery(d: Discovery, p: Principle, r: ResourceDef, fieldName: string, where: string, design: Design | undefined, opened: string[]): string {
  const how = `At ${where}, work on ${p.name.toLowerCase()} using ${r.name.toLowerCase()} (${r.source.toLowerCase()})`;
  const surprise = d.outcome === 'unexpected' ? ' An anomaly the team chose to chase led them into ' + fieldName.toLowerCase() + '.' : '';
  const partial = d.outcome === 'partial' ? ' The result only half works, and it comes with a catch.' : '';
  const opens = opened.length ? ` It opens new research: ${opened.map((id) => PRINCIPLE_BY_ID.get(id)!.name.toLowerCase()).join(', ')}.` : '';
  switch (d.kind) {
    case 'design':
      return `${how} produced a working ${FUNCTION_LABEL[design!.fn]}: the ${design!.name}. ${design!.description}${surprise}${partial}${opens}`;
    case 'modifier':
      return `${how} became a practical method. ${d.effects.map(describeEffect).join('; ')}.${d.drawbacks.length ? ` Trade-off: ${d.drawbacks.map(describeEffect).join('; ')}.` : ''}${surprise}${partial}${opens}`;
    case 'component':
      return `${how} yielded ${COMPONENT_LABEL[d.component!]}. New buildings your researchers design will use them, and they already help: ${d.effects.map(describeEffect).join('; ')}.${d.drawbacks.length ? ` Trade-off: ${d.drawbacks.map(describeEffect).join('; ')}.` : ''}${surprise}${partial}${opens}`;
    case 'foundation':
      return `${how} explained ${d.tags.map((t) => TAG_NAMES[t] ?? t).join(' and ')} — knowledge with no direct use yet, but it makes related experiments safer.${surprise}${opens}`;
  }
}

// ── Designs ─────────────────────────────────────────────────────────────────

/** Rules that turn a method, a substance and a quality into a facility's numbers. */
function designStats(fn: FunctionKind, p: Principle, r: ResourceDef, q: number, comps: ComponentKind[]): DesignStats {
  const e = r.props.energy ?? 0, purity = r.props.purity ?? 0.5, cond = r.props.conductivity ?? 0, por = r.props.porosity ?? 0, fert = r.props.fertility ?? 0;
  const renew = r.props.renewable ?? 0;
  const s: DesignStats = {
    kind: 'power', category: 'utilities', cost: 0, upkeep: 0, w: 40, d: 40, jobs: 10, radius: 0, capacity: 0, output: 0, storage: 0,
    pollution: 0, attractiveness: 0, tourism: 0, needsShore: r.id === 'tidal' || r.id === 'kelp' || (p.id === 'desal' && r.id === 'brine'),
  };
  const size = (base: number, grow: number) => 2 * Math.round((base + grow * q) / 2);
  switch (fn) {
    case 'powerGen': {
      const clean = renew > 0.7 || p.id === 'photonic' || p.id === 'kinetic';
      s.output = Math.round((clean ? 8 + 34 * q : 30 + 80 * q) * (0.6 + 0.6 * Math.max(e, clean ? 0.5 : 0)));
      s.pollution = clean ? 0 : Math.max(0.05, (0.75 - 0.5 * purity) * (1.1 - 0.5 * q));
      s.cost = Math.round((s.output * (clean ? 1_900 : 900) * (1.25 - 0.35 * q)) / 1000) * 1000;
      s.upkeep = Math.round((s.cost * (clean ? 0.022 : 0.04)) / 10) * 10;
      s.w = size(clean ? 44 : 40, 16);
      s.d = size(40, 14);
      s.jobs = Math.round(6 + s.output * (clean ? 0.3 : 0.7));
      break;
    }
    case 'storage':
      s.storage = Math.round(8 + 32 * q * (0.5 + 0.7 * Math.max(cond, e)));
      s.cost = Math.round((s.storage * 1_700 * (1.2 - 0.3 * q)) / 1000) * 1000;
      s.upkeep = Math.round((s.cost * 0.025) / 10) * 10;
      s.w = size(36, 12);
      s.d = size(34, 10);
      s.jobs = 6 + Math.round(s.storage * 0.3);
      break;
    case 'water':
      s.kind = 'water';
      s.output = Math.round((1_800 + 7_000 * q * (0.5 + por)) / 100) * 100;
      s.cost = Math.round((s.output * 9 * (1.2 - 0.3 * q)) / 1000) * 1000;
      s.upkeep = Math.round((s.cost * 0.03) / 10) * 10;
      s.w = size(36, 14);
      s.d = size(36, 10);
      s.jobs = 8 + Math.round(s.output / 600);
      break;
    case 'sewage':
      s.kind = 'sewage';
      s.output = Math.round((2_000 + 6_000 * q * (0.5 + 0.5 * (por + fert))) / 100) * 100;
      s.cost = Math.round((s.output * 8.5 * (1.2 - 0.3 * q)) / 1000) * 1000;
      s.upkeep = Math.round((s.cost * 0.028) / 10) * 10;
      s.w = size(38, 12);
      s.d = size(36, 10);
      s.jobs = 8 + Math.round(s.output / 700);
      break;
    case 'waste':
      s.kind = 'garbage';
      s.category = 'services';
      s.capacity = Math.round((1_600 + 3_400 * q) / 100) * 100;
      s.radius = Math.round(1_000 + 500 * q);
      s.pollution = Math.max(0.04, 0.35 * (1 - q) * (1.2 - purity));
      s.cost = Math.round((s.capacity * 26) / 1000) * 1000;
      s.upkeep = Math.round((s.cost * 0.03) / 10) * 10;
      s.w = size(40, 10);
      s.d = size(38, 8);
      s.jobs = 20 + Math.round(q * 30);
      break;
    case 'farm':
      s.kind = 'park';
      s.category = 'parks';
      s.attractiveness = Math.round((0.35 + 0.35 * q * (0.5 + 0.5 * fert)) * 100) / 100;
      s.radius = Math.round(220 + 200 * q);
      s.cost = Math.round((9_000 + 22_000 * q) / 500) * 500;
      s.upkeep = Math.round((s.cost * 0.025) / 10) * 10;
      s.w = size(34, 12);
      s.d = size(32, 10);
      s.jobs = 10 + Math.round(q * 30);
      break;
    case 'scrubber':
      s.kind = 'park';
      s.category = 'parks';
      // Negative pollution: it cleans the air around it.
      s.pollution = -Math.round((0.35 + 0.65 * q * (0.5 + 0.5 * por)) * 100) / 100;
      s.attractiveness = Math.round((0.12 + 0.15 * q) * 100) / 100;
      s.radius = Math.round(260 + 160 * q);
      s.cost = Math.round((16_000 + 30_000 * q) / 500) * 500;
      s.upkeep = Math.round((s.cost * 0.03) / 10) * 10;
      s.w = size(30, 10);
      s.d = size(30, 8);
      s.jobs = 4;
      break;
    case 'clinic':
      s.kind = 'health';
      s.category = 'services';
      s.radius = Math.round(520 + 420 * q);
      s.capacity = Math.round((8_000 + 18_000 * q) / 500) * 500;
      s.cost = Math.round((24_000 + 50_000 * q) / 1000) * 1000;
      s.upkeep = Math.round((s.cost * 0.038) / 10) * 10;
      s.w = size(32, 12);
      s.d = size(32, 10);
      s.jobs = 24 + Math.round(q * 60);
      break;
    case 'school':
      s.kind = 'education';
      s.category = 'services';
      s.radius = Math.round(500 + 450 * q);
      s.capacity = Math.round((6_000 + 16_000 * q) / 500) * 500;
      s.cost = Math.round((28_000 + 44_000 * q) / 1000) * 1000;
      s.upkeep = Math.round((s.cost * 0.04) / 10) * 10;
      s.w = size(38, 12);
      s.d = size(36, 10);
      s.jobs = 25 + Math.round(q * 40);
      break;
    case 'civic':
      s.kind = 'landmark';
      s.category = 'parks';
      s.radius = Math.round(500 + 300 * q);
      s.attractiveness = Math.round((0.45 + 0.25 * q) * 100) / 100;
      s.tourism = Math.round((1_200 + 4_000 * q) / 100) * 100;
      s.cost = Math.round((40_000 + 70_000 * q) / 1000) * 1000;
      s.upkeep = Math.round((s.cost * 0.02) / 10) * 10;
      s.w = size(40, 14);
      s.d = size(38, 12);
      s.jobs = 15 + Math.round(q * 30);
      break;
  }
  // Discovered materials make later facilities cheaper to run or nicer to be near.
  if (comps.includes('stone')) s.upkeep = Math.round(s.upkeep * 0.92);
  if (comps.includes('timber')) s.cost = Math.round(s.cost * 0.93);
  if (comps.includes('glass') && s.attractiveness > 0) s.attractiveness = Math.round((s.attractiveness + 0.04) * 100) / 100;
  if (comps.includes('gardenRoof') && s.pollution > 0) s.pollution = Math.round(s.pollution * 0.85 * 100) / 100;
  return s;
}

const FN_TITLE: Record<FunctionKind, string> = {
  powerGen: 'Generates', storage: 'Stores', water: 'Supplies', sewage: 'Treats', waste: 'Processes', farm: 'Grows', scrubber: 'Cleans', clinic: 'Treats', school: 'Educates', civic: 'Draws',
};

function describeDesign(fn: FunctionKind, s: DesignStats, r: ResourceDef, p: Principle): string {
  const lines: string[] = [];
  switch (fn) {
    case 'powerGen': lines.push(`${FN_TITLE[fn]} ${s.output} MW from ${r.name.toLowerCase()} by ${p.name.toLowerCase()}${s.pollution > 0 ? `, with ${s.pollution > 0.45 ? 'heavy' : s.pollution > 0.2 ? 'some' : 'little'} pollution` : ' with no pollution'}.`); break;
    case 'storage': lines.push(`Stores surplus electricity and releases up to ${s.storage} MW at the peak (it needs generators on its road network to charge from).`); break;
    case 'water': lines.push(`Supplies ${s.output.toLocaleString('en-US')} m³ of clean water a day${s.needsShore ? '; it must stand on a shoreline' : ', anywhere in the city'}.`); break;
    case 'sewage': lines.push(`Treats ${s.output.toLocaleString('en-US')} m³ of wastewater a day without polluting.`); break;
    case 'waste': lines.push(`Processes ${s.capacity.toLocaleString('en-US')} units of garbage a day across a ${s.radius} m radius${s.pollution > 0.15 ? ', with some pollution' : ', cleanly'}.`); break;
    case 'farm': lines.push(`Grows fresh food beside homes: lifts happiness and land value across ${s.radius} m and employs ${s.jobs}.`); break;
    case 'scrubber': lines.push(`Pulls pollution out of the air within ${s.radius} m and makes the area a little more pleasant.`); break;
    case 'clinic': lines.push(`Provides healthcare to ${s.capacity.toLocaleString('en-US')} residents within ${s.radius} m.`); break;
    case 'school': lines.push(`Educates ${s.capacity.toLocaleString('en-US')} residents within ${s.radius} m.`); break;
    case 'civic': lines.push(`A landmark that lifts land value within ${s.radius} m and draws up to $${s.tourism.toLocaleString('en-US')} a month in tourism.`); break;
  }
  lines.push(`Costs $${s.cost.toLocaleString('en-US')} to build and $${s.upkeep.toLocaleString('en-US')} a month to run.`);
  return lines.join(' ');
}

function makeDesign(civ: CivState, disc: Discovery, p: Principle, r: ResourceDef, q: number, ids: { design: string; serviceId: string }, partner?: Discovery): Design {
  const base = civ.discoveries.find((d) => d.id === disc.basis[0] && d.designId);
  const fn = p.build ?? 'powerGen';
  const comps = [...civ.components];
  // A synthesis inherits the partner's material or method in its build.
  if (partner?.component && !comps.includes(partner.component)) comps.push(partner.component);
  const stats = designStats(fn, p, r, Math.min(1, q + (base ? 0.1 : 0)), comps);
  if (partner?.effects.some((e) => e.kind === 'powerPollution' || e.kind === 'industryPollution') && stats.pollution > 0) stats.pollution = Math.round(stats.pollution * 0.6 * 100) / 100;
  const modules = [...p.modules];
  if (partner) for (const m of PRINCIPLE_BY_ID.get(partner.principle)?.modules ?? []) if (!modules.includes(m) && modules.length < 4) modules.push(m);
  let arch: ArchSpec | null = null;
  for (let attempt = 0; attempt < 8 && !arch; attempt++) {
    const spec = composeArch({
      w: stats.w, d: stats.d, seed: hashStr(civ.civSeed, ids.design, attempt), fn, field: disc.field,
      modules, look: r.look, components: comps, accent: FIELD_ACCENT[disc.field], scale: q,
    });
    if (!validateArch(spec).length) arch = spec;
  }
  if (!arch) throw new Error(`Could not compose a valid building for ${ids.design}`);
  const traits: string[] = [];
  for (const sec of arch.sections) traits.push(`${sec.roof} roof`, sec.wall.surface === 'industrial' ? 'industrial hall' : `${sec.wall.surface} walls`);
  for (const m of arch.modules) traits.push(m.kind);
  return {
    id: ids.design,
    serviceId: ids.serviceId,
    style: `arch:${ids.serviceId}`,
    discoveryId: disc.id,
    name: disc.name,
    description: describeDesign(fn, stats, r, p),
    fn,
    field: disc.field,
    stats,
    arch,
    traits: [...new Set(traits)],
  };
}

export { FIELDS };
