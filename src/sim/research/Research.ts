import type { Building } from '../buildings/Buildings';
import type { City } from '../City';
import { SERVICE_BY_ID, type ServiceType, registerServiceType } from '../services/ServiceTypes';
import { BuildingState, Zone, isResidential, zoneBase } from '../types';
import { type ArchSpec, registerArch } from './Architecture';
import {
  type CenterInfo, type Choice, type Decision, type Design, type Discovery, type Effect, type Outcome, type Plan, type ProposalContext,
  STAGES, decisionFor, generateProposals, hashStr, makeDiscovery, odds, resolve, centerName as makeCenterName,
} from './Generate';
import { DEPOSITS, FIELDS, type FieldId, PRINCIPLE_BY_ID, RESOURCES, RESOURCE_BY_ID, fit, type ComponentKind } from './Knowledge';

/** Distance within which a centre can use a local substance (m). */
const LOCAL_RADIUS = 450;
/** Money for equipment level 2 and 3. */
export const UPGRADE_COST = [0, 0, 40_000, 90_000];
/** Days between asking a centre for fresh proposals. */
export const REFRESH_DAYS = 10;

export interface SiteFactor {
  field: FieldId;
  label: string;
  weight: number;
}

export interface ActiveExperiment {
  plan: Plan;
  progress: number;
  choices: { stage: number; optionId: string; label: string }[];
  pending: Decision | null;
  started: number;
  /** Money committed so far (start plus decisions). */
  spent: number;
  status: string;
}

export interface Center {
  id: number;
  name: string;
  field: FieldId;
  secondary: FieldId[];
  equipment: number;
  founded: number;
  factors: SiteFactor[];
  offers: Plan[];
  round: number;
  lastRefresh: number;
  active: ActiveExperiment | null;
  completed: number;
}

export interface ExperimentRecord {
  id: string;
  title: string;
  centerName: string;
  field: FieldId;
  outcome: Outcome;
  day: number;
  decisions: string[];
  chance: number;
  discoveryId?: string;
  insight?: string;
}

/** City-wide effects of everything discovered, ready for the simulation to apply. */
export interface ResearchMods {
  buildCost: number;
  powerUse: number;
  waterUse: number;
  garbage: number;
  roadCapacity: number;
  industryEfficiency: number;
  industryPollution: number;
  powerPollution: number;
  happiness: number;
  landValue: number;
  /** Output multipliers by service kind (and 'storage'). */
  boost: Record<string, number>;
}

export function neutralMods(): ResearchMods {
  return { buildCost: 1, powerUse: 1, waterUse: 1, garbage: 1, roadCapacity: 1, industryEfficiency: 1, industryPollution: 1, powerPollution: 1, happiness: 0, landValue: 0, boost: {} };
}

export interface Requirement {
  label: string;
  ok: boolean;
}

export interface ResearchSave {
  v: 1;
  civSeed: number;
  centers: Center[];
  discoveries: Discovery[];
  designs: (Omit<Design, 'arch'> & { arch: ArchSpec })[];
  records: ExperimentRecord[];
  insights: [string, number][];
  followups: ProposalContext['followups'];
  achieved: string[];
  counters: { plan: number; disc: number; design: number; rec: number };
}

/**
 * A civilization's science: its research centres, running experiments,
 * discoveries and the buildings they designed. Lives on the City and is saved
 * with it; nothing is shared with any other city.
 */
export class Research {
  readonly centers = new Map<number, Center>();
  discoveries: Discovery[] = [];
  readonly designs = new Map<string, Design>();
  records: ExperimentRecord[] = [];
  readonly insights = new Map<string, number>();
  followups: ProposalContext['followups'] = [];
  readonly achieved = new Set<string>();
  mods = neutralMods();
  /** Bumped whenever something the interface shows changes. */
  version = 0;
  private counters = { plan: 1, disc: 1, design: 1, rec: 1 };
  private types: ServiceType[] = [];

  constructor(private city: City, public civSeed: number) {}

  // ── Ids ──
  private nextPlan = () => `e${this.counters.plan++}`;
  private civTag(): string {
    return (this.civSeed >>> 0).toString(36);
  }

  // ── Civilization state for the generator ──
  civ() {
    const tags = new Set<string>();
    for (const d of this.discoveries) for (const t of d.tags) tags.add(t);
    const components = [...new Set(this.discoveries.map((d) => d.component).filter((c): c is ComponentKind => !!c))];
    return { civSeed: this.civSeed, day: this.city.clock.day, tags, discoveries: this.discoveries, achieved: this.achieved, insights: this.insights, components };
  }

  info(c: Center): CenterInfo {
    return { id: c.id, name: c.name, field: c.field, secondary: c.secondary, equipment: c.equipment };
  }

  // ── Substances ──

  /** The two deposits this civilization's land happens to hold. */
  deposits(): string[] {
    const list = [...DEPOSITS];
    const out: string[] = [];
    let h = this.civSeed >>> 0;
    while (out.length < 2 && list.length) {
      h = hashStr(h, 'deposit');
      out.push(list.splice(h % list.length, 1)[0]);
    }
    return out;
  }

  /** Substances a centre can work with, and why any are out of reach. */
  resourcesFor(c: Center): Map<string, { ok: boolean; why?: string }> {
    const city = this.city;
    const b = city.buildings.get(c.id);
    const out = new Map<string, { ok: boolean; why?: string }>();
    const preset = city.preset;
    const avail = new Set<string>(['sunlight', 'wind', 'groundwater', ...this.deposits()]);
    if (preset === 'coastal') ['sand', 'kelp', 'brine', 'shell_lime', 'tidal'].forEach((r) => avail.add(r));
    if (preset === 'lakes') ['clay', 'reeds', 'peat'].forEach((r) => avail.add(r));
    if (preset === 'highlands') ['granite', 'limestone'].forEach((r) => avail.add(r));
    if (preset === 'river') ['silt', 'reeds', 'clay'].forEach((r) => avail.add(r));
    if (aliveNatural(city) > 1500) avail.add('timber');
    const services = [...city.buildings.all.values()].filter((x) => x.kind === 'service' && x.state === BuildingState.Active);
    if (services.some((x) => x.typeId === 'coal_plant')) avail.add('coal_ash');
    if (services.some((x) => x.typeId === 'landfill')) {
      avail.add('refuse_gas');
      avail.add('compost');
    }
    if (services.some((x) => x.typeId === 'recycling_center') || city.zones.countZoned(Zone.Commercial) > 4000) avail.add('cullet');
    if (services.filter((x) => SERVICE_BY_ID.get(x.typeId)?.kind === 'park').length >= 2) avail.add('compost');
    avail.add('slag');
    for (const r of RESOURCES) {
      if (!avail.has(r.id)) continue;
      if (!r.local) {
        out.set(r.id, { ok: true });
        continue;
      }
      if (!b) {
        out.set(r.id, { ok: false, why: 'Needs a research centre' });
        continue;
      }
      if (r.id === 'slag') {
        let ind = 0;
        for (const x of city.buildings.queryRadius(b.cx, b.cz, LOCAL_RADIUS * 2)) if (x.kind === 'zoned' && zoneBase(x.zone) === Zone.Industrial && x.state === BuildingState.Active) ind++;
        out.set(r.id, ind >= 6 ? { ok: true } : { ok: false, why: `Needs 6+ working factories within ${LOCAL_RADIUS * 2} m (has ${ind})` });
      } else {
        // Kelp and tidal flow: the centre has to be by the water.
        const shore = city.terrain.shoreDistanceAt(b.cx, b.cz);
        out.set(r.id, shore < LOCAL_RADIUS ? { ok: true } : { ok: false, why: `Needs the centre within ${LOCAL_RADIUS} m of open water` });
      }
    }
    return out;
  }

  /** How pressing each field is for the city right now (0–1). */
  needs(): Partial<Record<FieldId, number>> {
    const city = this.city;
    const u = city.utilities.totals;
    const tight = (t: { production: number; consumption: number; shortfall: number }) => (t.shortfall > 0 ? 1 : t.production <= 0 ? 0.6 : Math.max(0, 0.5 - (t.production - t.consumption) / t.production));
    let pol = 0, n = 0;
    for (const b of city.buildings.all.values()) {
      if (b.kind !== 'zoned' || !isResidential(b.zone)) continue;
      pol += city.landValue.pollutionAt(b.cx, b.cz);
      if (++n >= 400) break;
    }
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    return {
      energy: tight(u.power),
      water: Math.max(tight(u.water), tight(u.sewage)),
      environment: clamp(n ? (pol / n) * 3 : 0),
      medicine: clamp(1 - city.coverage.averageFor('health', city.buildings)) * 0.7,
      agriculture: clamp((68 - city.stats.happiness) / 30),
      transport: clamp((city.traffic.avgTripMinutes - 14) / 16),
      materials: city.economy.money < 60_000 ? 0.6 : 0.3,
      manufacturing: clamp(city.zones.countZoned(Zone.Industrial) / Math.max(1, city.zones.countZoned(Zone.ResLow) + city.zones.countZoned(Zone.ResMed) + city.zones.countZoned(Zone.ResHigh)) * 2),
      architecture: 0.3,
    };
  }

  // ── Centres ──

  /** What surrounds a site, as reasons for a specialization. */
  assessSite(x: number, z: number, buildingId: number): { ranked: FieldId[]; factors: SiteFactor[] } {
    const city = this.city;
    const near = city.buildings.queryRadius(x, z, 700);
    const count = (f: (b: Building) => boolean) => near.filter((b) => b.state !== BuildingState.Abandoned && f(b)).length;
    const kindOf = (b: Building) => (b.kind === 'service' ? SERVICE_BY_ID.get(b.typeId)?.kind : undefined);
    const ind = count((b) => b.kind === 'zoned' && zoneBase(b.zone) === Zone.Industrial);
    const offices = count((b) => b.kind === 'zoned' && (b.zone === Zone.Office || zoneBase(b.zone) === Zone.Commercial));
    const homes = count((b) => b.kind === 'zoned' && isResidential(b.zone));
    const power = count((b) => kindOf(b) === 'power');
    const parks = count((b) => kindOf(b) === 'park');
    const health = count((b) => kindOf(b) === 'health');
    const waterSvc = count((b) => kindOf(b) === 'water' || kindOf(b) === 'sewage');
    const shore = city.terrain.shoreDistanceAt(x, z);
    const pol = city.landValue.pollutionAt(x, z);
    const lv = city.landValue.at(x, z);
    let roads = 0;
    for (const s of city.roads.segments.values()) if (Math.hypot(s.cx - x, s.cz - z) < 600) roads++;
    const factors: SiteFactor[] = [];
    const add = (field: FieldId, weight: number, label: string) => {
      if (weight > 0.04) factors.push({ field, weight, label });
    };
    add('manufacturing', Math.min(1.2, ind * 0.07), `${ind} factories nearby`);
    add('materials', Math.min(0.6, ind * 0.03) + (city.preset === 'highlands' ? 0.45 : 0), city.preset === 'highlands' ? 'Quarry country and industry nearby' : 'Industry nearby');
    add('energy', Math.min(1.1, power * 0.35) + 0.15, power ? `${power} power facilities nearby` : 'Open ground for energy trials');
    add('water', shore < 300 ? 0.95 : Math.min(0.6, waterSvc * 0.3), shore < 300 ? `On the water's edge (${Math.round(shore)} m)` : `${waterSvc} water facilities nearby`);
    add('environment', Math.min(1, pol * 2.2) + (parks ? 0.1 : 0), pol > 0.15 ? `Polluted surroundings (${Math.round(pol * 100)}%)` : 'Green surroundings');
    add('agriculture', Math.min(1, parks * 0.22 + homes * 0.008), `${parks} parks and gardens, ${homes} homes nearby`);
    add('architecture', lv * 1.1 + Math.min(0.5, offices * 0.025), `Land value ${Math.round(lv * 100)}%, ${offices} shops and offices`);
    add('medicine', Math.min(1, health * 0.45 + homes * 0.006), `${health} health facilities, ${homes} homes nearby`);
    add('transport', Math.min(0.9, roads * 0.012), `${roads} road segments within 600 m`);
    // Each civilization leans its own way too.
    const score = new Map<FieldId, number>();
    for (const f of FIELDS) score.set(f.id, (hashStr(this.civSeed, 'lean', f.id) / 4294967296) * 0.3 + (hashStr(this.civSeed, buildingId, f.id) / 4294967296) * 0.15);
    for (const f of factors) score.set(f.field, (score.get(f.field) ?? 0) + f.weight);
    const ranked = [...score.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([f]) => f);
    factors.sort((a, b) => b.weight - a.weight);
    return { ranked, factors };
  }

  /** A research centre was placed: give it an identity from its surroundings. */
  onCenterPlaced(b: Building): Center {
    const { ranked, factors } = this.assessSite(b.cx, b.cz, b.id);
    const field = ranked[0];
    const c: Center = {
      id: b.id,
      name: makeCenterName(this.civSeed, b.id, field),
      field,
      secondary: ranked.slice(1, 3),
      equipment: 1,
      founded: this.city.clock.day,
      factors: factors.slice(0, 5),
      offers: [],
      round: 0,
      lastRefresh: -REFRESH_DAYS,
      active: null,
      completed: 0,
    };
    this.centers.set(b.id, c);
    b.style = `lab:${field}`;
    b.level = 1;
    this.version++;
    return c;
  }

  onBuildingRemoved(id: number): void {
    const c = this.centers.get(id);
    if (!c) return;
    if (c.active) {
      // The work stops; money already committed is gone, nothing more is charged.
      this.record(c, c.active, 'interrupted', 0, undefined, 'The centre closed before the experiment finished.');
    }
    this.centers.delete(id);
    this.version++;
  }

  /** Whether a centre can run work now (and if not, why). */
  operational(c: Center, extraPower = 0): { ok: boolean; reason?: string } {
    const b = this.city.buildings.get(c.id);
    if (!b) return { ok: false, reason: 'Demolished' };
    if (b.state === BuildingState.Construction || b.progress < 1) return { ok: false, reason: 'Under construction' };
    if (b.state !== BuildingState.Active) return { ok: false, reason: 'Not operating' };
    if (!b.segId) return { ok: false, reason: 'No road access' };
    const spare = this.city.utilities.available('power', this.city.componentOfSegment(b.segId));
    const need = 1 + extraPower;
    if (spare < need) return { ok: false, reason: `Needs ${need.toFixed(1)} MW of spare power on its road network (${Math.max(0, spare).toFixed(1)} MW free)` };
    return { ok: true };
  }

  education(c: Center): number {
    const b = this.city.buildings.get(c.id);
    return b ? this.city.coverage.at('education', b.cx, b.cz) : 0;
  }

  /** Asks the centre for proposals (automatically after each experiment, or on request every few days). */
  refresh(c: Center, manual = false): boolean {
    if (manual && this.city.clock.day - c.lastRefresh < REFRESH_DAYS) return false;
    c.round++;
    if (manual) c.lastRefresh = this.city.clock.day;
    const ctx: ProposalContext = { resources: this.resourcesFor(c), needs: this.needs(), followups: this.followups };
    c.offers = generateProposals(this.civ(), this.info(c), ctx, c.round, this.nextPlan);
    this.version++;
    return true;
  }

  requirements(c: Center, plan: Plan): Requirement[] {
    const b = this.city.buildings.get(c.id);
    const op = this.operational(c, plan.power);
    const res = RESOURCE_BY_ID.get(plan.resource)!;
    const reach = this.resourcesFor(c).get(plan.resource);
    const p = PRINCIPLE_BY_ID.get(plan.principle)!;
    const reqs: Requirement[] = [
      { label: op.ok ? `Centre open, with ${(1 + plan.power).toFixed(1)} MW of spare power on its network` : op.reason ?? 'Centre unavailable', ok: op.ok },
      { label: `${formatMoney(plan.cost)} to start`, ok: this.city.economy.canAfford(plan.cost) },
      { label: reach?.ok ? `${res.name} within reach` : `${res.name}: ${reach?.why ?? 'not available'}`, ok: !!reach?.ok },
      { label: 'No other experiment running here', ok: !c.active },
    ];
    if (p.needs || plan.kind === 'synthesis') {
      const edu = b ? this.education(c) : 0;
      reqs.push({ label: `Educated staff: education coverage 25%+ at the centre (${Math.round(edu * 100)}%)`, ok: edu >= 0.25 });
    }
    return reqs;
  }

  /** Chance of success for a plan: the running one counts the decisions taken so far, plus `extra`. */
  oddsFor(c: Center, plan: Plan, extra: Choice[] = []) {
    const taken = c.active?.plan.id === plan.id ? this.choicesOf(c) : [];
    return odds(plan, [...taken, ...extra], this.info(c), this.civ(), this.education(c));
  }

  private choicesOf(c: Center): Choice[] {
    const a = c.active;
    if (!a) return [];
    return a.choices.map((ch) => ({ stage: ch.stage, option: decisionFor(this.civSeed, a.plan, ch.stage).options.find((o) => o.id === ch.optionId)! })).filter((ch) => ch.option);
  }

  start(centerId: number, planId: string): { ok: boolean; error?: string } {
    const c = this.centers.get(centerId);
    if (!c) return { ok: false, error: 'No such research centre' };
    const plan = c.offers.find((p) => p.id === planId);
    if (!plan) return { ok: false, error: 'That proposal is no longer on offer' };
    const unmet = this.requirements(c, plan).filter((r) => !r.ok);
    if (unmet.length) return { ok: false, error: unmet[0].label };
    if (!this.city.economy.spend(plan.cost, 'Research')) return { ok: false, error: 'Not enough money' };
    c.active = { plan, progress: 0, choices: [], pending: null, started: this.city.clock.day, spent: plan.cost, status: 'Running' };
    c.offers = c.offers.filter((p) => p.id !== planId);
    this.version++;
    return { ok: true };
  }

  decide(centerId: number, optionId: string): { ok: boolean; error?: string } {
    const c = this.centers.get(centerId);
    const a = c?.active;
    if (!c || !a?.pending) return { ok: false, error: 'No decision is waiting' };
    const opt = a.pending.options.find((o) => o.id === optionId);
    if (!opt) return { ok: false, error: 'Unknown option' };
    if (opt.cost > 0 && !this.city.economy.spend(opt.cost, 'Research')) return { ok: false, error: `Needs ${formatMoney(opt.cost)}` };
    a.spent += Math.max(0, opt.cost);
    a.choices.push({ stage: a.pending.stage, optionId: opt.id, label: opt.label });
    a.pending = null;
    this.version++;
    return { ok: true };
  }

  abandon(centerId: number): void {
    const c = this.centers.get(centerId);
    if (!c?.active) return;
    this.insights.set(c.active.plan.principle, (this.insights.get(c.active.plan.principle) ?? 0) + 0.5);
    this.record(c, c.active, 'abandoned', 0, undefined, 'Stopped early. What was learned makes the next attempt at this method a little safer.');
    c.active = null;
    this.refresh(c);
  }

  upgrade(centerId: number): { ok: boolean; error?: string } {
    const c = this.centers.get(centerId);
    const b = c && this.city.buildings.get(c.id);
    if (!c || !b) return { ok: false, error: 'No such research centre' };
    if (c.equipment >= 3) return { ok: false, error: 'Fully equipped' };
    const cost = UPGRADE_COST[c.equipment + 1];
    if (!this.city.economy.spend(cost, 'Research')) return { ok: false, error: `Needs ${formatMoney(cost)}` };
    c.equipment++;
    b.level = c.equipment;
    this.city.buildings.markChanged(b, 'geometry');
    this.refresh(c);
    return { ok: true };
  }

  // ── Daily work ──

  daily(): void {
    for (const c of this.centers.values()) {
      const b = this.city.buildings.get(c.id);
      if (!b) continue;
      if (c.round === 0 && this.operational(c).ok) this.refresh(c);
      const a = c.active;
      if (!a || a.pending) continue;
      const op = this.operational(c, a.plan.power);
      if (!op.ok) {
        a.status = `Paused: ${op.reason}`;
        continue;
      }
      if (this.city.economy.money < 0 && !this.city.economy.unlimited) {
        a.status = 'Paused: the city is out of money';
        continue;
      }
      a.status = 'Running';
      const extraDays = this.choicesOf(c).reduce((s, ch) => s + ch.option.days, 0);
      a.progress = Math.min(1, a.progress + (1 + 0.1 * (c.equipment - 1)) / Math.max(4, a.plan.days + extraDays));
      const stage = a.choices.length;
      if (stage < STAGES.length && a.progress >= STAGES[stage]) {
        a.progress = STAGES[stage];
        a.pending = decisionFor(this.civSeed, a.plan, stage);
        // The game shows a clickable notification that opens the decision.
        this.city.events.emit('research', { type: 'decision', centerId: c.id });
      } else if (a.progress >= 1 && stage >= STAGES.length) {
        this.finish(c);
      }
      this.version++;
    }
  }

  /** Monthly running cost of experiments in progress. */
  monthlyCost(): number {
    let s = 0;
    for (const c of this.centers.values()) if (c.active) s += c.active.plan.monthly;
    return s;
  }

  private finish(c: Center): void {
    const a = c.active!;
    const b = this.city.buildings.get(c.id);
    const civ = this.civ();
    const choices = this.choicesOf(c);
    const res = resolve(civ, a.plan, choices, this.info(c), this.education(c));
    c.active = null;
    c.completed++;
    this.followups = this.followups.filter((f) => !(f.principle === a.plan.principle && f.resource === a.plan.resource));
    if (res.outcome === 'failure') {
      const p = PRINCIPLE_BY_ID.get(a.plan.principle)!;
      this.insights.set(p.id, (this.insights.get(p.id) ?? 0) + 1);
      // A failure points somewhere: the better-suited substance the data hints at.
      const tried = RESOURCE_BY_ID.get(a.plan.resource)!;
      const reach = this.resourcesFor(c);
      const alt = RESOURCES.filter((r) => r.id !== tried.id && reach.get(r.id) && fit(p, r) > fit(p, tried) && !this.achieved.has(`${p.id}|${r.id}`))
        .sort((x, y) => fit(p, y) - fit(p, x))[0];
      let insight = `${p.name} with ${tried.name.toLowerCase()} did not work. The approach is ruled out, and the next attempt at ${p.name.toLowerCase()} will be safer.`;
      const recId = `r${this.counters.rec}`;
      if (alt) {
        insight += ` The data points to ${alt.name.toLowerCase()} instead — a follow-up is now on offer.`;
        this.followups.push({ principle: p.id, resource: alt.id, basis: recId, note: `A failed run with ${tried.name.toLowerCase()} suggested ${alt.name.toLowerCase()} (lower risk).` });
      }
      this.achieved.add(`${p.id}|${tried.id}`);
      this.record(c, a, 'failure', res.chance, undefined, insight);
      this.city.emitNotice({ severity: 'warning', icon: 'research', title: 'Experiment failed', text: `${c.name}: ${a.plan.title}. ${alt ? 'It pointed to a better approach.' : 'Your scientists learned what to avoid.'}`, x: b?.cx, z: b?.cz });
      this.city.events.emit('research', { type: 'failure', centerId: c.id, recordId: recId });
    } else {
      const ids = this.nextIds();
      const made = makeDiscovery(civ, a.plan, res, this.info(c), ids);
      this.adopt(made);
      this.achieved.add(`${a.plan.principle}|${a.plan.resource}`);
      if (a.plan.kind === 'synthesis') this.achieved.add(`synth|${a.plan.basis[0]}|${a.plan.basis[1]}`);
      this.record(c, a, res.outcome, res.chance, made.discovery.id);
      this.city.emitNotice({ severity: 'good', icon: 'research', title: `Discovery: ${made.discovery.name}`, text: `${c.name} — ${made.discovery.classification}.`, x: b?.cx, z: b?.cz });
      this.city.events.emit('research', { type: 'discovery', centerId: c.id, discoveryId: made.discovery.id });
    }
    this.refresh(c);
  }

  /** Adds a finished discovery (and its design) to the civilization's science. */
  adopt(made: { discovery: Discovery; design?: Design }): void {
    if (made.design) {
      this.counters.design++;
      this.designs.set(made.design.id, made.design);
      this.register(made.design);
    }
    this.discoveries.push(made.discovery);
    this.achieved.add(`${made.discovery.principle}|${made.discovery.resource}`);
    this.recomputeMods();
  }

  /** Ids for the next discovery (and design) made. */
  nextIds(): { discovery: string; design: string; serviceId: string } {
    return { discovery: `d${this.counters.disc++}`, design: `g${this.counters.design}`, serviceId: `rd-${this.civTag()}-${this.counters.design}` };
  }

  private record(c: Center, a: ActiveExperiment, outcome: Outcome, chance: number, discoveryId?: string, insight?: string): void {
    this.records.push({
      id: `r${this.counters.rec++}`,
      title: a.plan.title,
      centerName: c.name,
      field: a.plan.field,
      outcome,
      day: this.city.clock.day,
      decisions: a.choices.map((ch) => ch.label),
      chance,
      discoveryId,
      insight,
    });
    this.version++;
  }

  // ── Effects ──

  recomputeMods(): void {
    const m = neutralMods();
    const all: Effect[] = [];
    for (const d of this.discoveries) all.push(...d.effects, ...d.drawbacks);
    const mul = (k: keyof ResearchMods, v: number) => ((m[k] as number) *= 1 + v);
    for (const e of all) {
      if (e.kind === 'happiness') m.happiness += e.value;
      else if (e.kind === 'landValue') m.landValue += e.value;
      else if (e.kind === 'boost') m.boost[e.target ?? 'power'] = (m.boost[e.target ?? 'power'] ?? 1) * (1 + e.value);
      else mul(e.kind, e.value);
    }
    // Diminishing returns: research can't make the city free to run.
    m.buildCost = Math.max(0.6, m.buildCost);
    m.powerUse = Math.max(0.6, m.powerUse);
    m.waterUse = Math.max(0.55, m.waterUse);
    m.garbage = Math.max(0.5, m.garbage);
    m.roadCapacity = Math.min(1.4, m.roadCapacity);
    m.industryEfficiency = Math.min(1.35, m.industryEfficiency);
    m.industryPollution = Math.max(0.35, m.industryPollution);
    m.powerPollution = Math.max(0.3, m.powerPollution);
    m.happiness = Math.max(-5, Math.min(9, m.happiness));
    m.landValue = Math.max(-0.05, Math.min(0.09, m.landValue));
    for (const k of Object.keys(m.boost)) m.boost[k] = Math.max(0.7, Math.min(1.7, m.boost[k]));
    this.mods = m;
    this.city.traffic.capacityScale = m.roadCapacity;
    this.version++;
  }

  /** Construction price of a service in this city after research. */
  costOf(st: ServiceType): number {
    return st.kind === 'research' ? st.cost : Math.round((st.cost * this.mods.buildCost) / 100) * 100;
  }

  /** Generated producers that depend on the weather like turbines and solar panels. */
  weatherOf(st: ServiceType): 'wind' | 'sun' | null {
    const d = st.designId ? this.designs.get(st.designId) : undefined;
    const disc = d && this.discoveries.find((x) => x.id === d.discoveryId);
    if (!disc) return null;
    if (disc.resource === 'wind') return 'wind';
    if (disc.resource === 'sunlight' || disc.principle === 'photonic') return 'sun';
    return null;
  }

  /** Output multiplier for a producer (research boosts). */
  outputScale(st: ServiceType): number {
    return (st.storage ? this.mods.boost.storage ?? 1 : 1) * (this.mods.boost[st.kind] ?? 1);
  }

  // ── Designs ──

  private register(d: Design): void {
    registerArch(d.style, d.arch);
    const s = d.stats;
    const st: ServiceType = {
      id: d.serviceId,
      name: d.name,
      description: d.description,
      kind: s.kind,
      category: s.category,
      style: d.style as ServiceType['style'],
      cost: s.cost,
      upkeep: s.upkeep,
      radius: s.radius,
      capacity: s.capacity,
      output: s.output,
      w: s.w,
      d: s.d,
      jobs: s.jobs,
      pollution: s.pollution,
      attractiveness: s.attractiveness,
      needsShore: s.needsShore,
      unlockPopulation: 0,
      tourism: s.tourism,
      unique: false,
      storage: s.storage || undefined,
      designId: d.id,
    };
    registerServiceType(st);
    this.types = this.types.filter((t) => t.id !== st.id).concat(st);
  }

  /** Buildings only this civilization can build. */
  serviceTypes(): ServiceType[] {
    return this.types;
  }

  designFor(serviceId: string): Design | undefined {
    for (const d of this.designs.values()) if (d.serviceId === serviceId) return d;
    return undefined;
  }

  // ── Save ──

  serialize(): ResearchSave {
    return structuredClone({
      v: 1 as const,
      civSeed: this.civSeed,
      centers: [...this.centers.values()],
      discoveries: this.discoveries,
      designs: [...this.designs.values()],
      records: this.records,
      insights: [...this.insights.entries()],
      followups: this.followups,
      achieved: [...this.achieved],
      counters: this.counters,
    });
  }

  load(data: ResearchSave | undefined): void {
    if (!data) return;
    const d = structuredClone(data);
    this.civSeed = d.civSeed;
    this.centers.clear();
    for (const c of d.centers) this.centers.set(c.id, c);
    this.discoveries = d.discoveries;
    this.designs.clear();
    this.types = [];
    // Established designs are restored exactly as they were made, never regenerated.
    for (const g of d.designs) {
      this.designs.set(g.id, g);
      this.register(g);
    }
    this.records = d.records;
    this.insights.clear();
    for (const [k, v] of d.insights) this.insights.set(k, v);
    this.followups = d.followups;
    this.achieved.clear();
    for (const k of d.achieved) this.achieved.add(k);
    this.counters = { ...d.counters };
    this.recomputeMods();
  }
}

function aliveNatural(city: City): number {
  let n = 0;
  const a = city.nature.alive;
  for (let i = 0; i < city.nature.naturalCount; i += 7) n += a[i];
  return n * 7;
}

function formatMoney(v: number): string {
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

/** Is this building a research centre? */
export function isResearchCenter(b: Pick<Building, 'kind' | 'typeId'>): boolean {
  return b.kind === 'service' && b.typeId === 'research_center';
}

