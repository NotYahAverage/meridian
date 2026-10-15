import type { Building } from '../buildings/Buildings';
import type { City } from '../City';
import { SERVICE_BY_ID, type ServiceType, registerServiceType } from '../services/ServiceTypes';
import { BuildingState, Zone, isResidential, zoneBase } from '../types';
import { type ArchSpec, registerArch } from './Architecture';
import { type Brief, type TrialSite, cityBriefs, trialSites } from './Briefs';
import {
  type CenterInfo, type Choice, type Decision, type DecisionOption, type Design, type Discovery, type Effect, type Outcome, type Plan, type ProposalContext,
  STAGE_PLAN, baseName, decisionFor, generateProposals, hashStr, makeDiscovery, odds, resolve, centerName as makeCenterName,
} from './Generate';
import { DEPOSITS, FIELD_BY_ID, type FieldId, LIVE_FIELD_DEFS, isLiveField, PRINCIPLE_BY_ID, RESOURCES, RESOURCE_BY_ID, fit, type ComponentKind } from './Knowledge';
import { MASTERY_NAMES, type Retrofit, type ScienceSummary, masteryLevel, newMilestones, retrofitFor } from './Progress';

/** Days a decision may wait before the careful option is taken (when the player allows it). */
export const AUTO_DECIDE_DAYS = 5;
/** Days a design must be in service before its next version can be developed. */
export const ITERATE_AFTER_DAYS = 30;
/** Research budget range (1 = normal). */
export const FUNDING_MIN = 0.5;
export const FUNDING_MAX = 2;
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
  /** Decisions taken; the option is kept as it was offered (field-trial sites depend on the city then). */
  choices: { stage: number; optionId: string; label: string; option?: DecisionOption }[];
  pending: Decision | null;
  /** Day the pending decision came up. */
  pendingSince?: number;
  /** A second centre working on it jointly. */
  partnerId?: number;
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
  /** Experience per field (a success counts 1, anything else ½). */
  mastery?: Partial<Record<FieldId, number>>;
  /** The centre this one is helping with a joint experiment. */
  assisting?: number;
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
  kind?: Plan['kind'];
  partner?: string;
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
  /** Pollution multipliers by service kind (retrofit programmes). */
  retrofitPollution: Record<string, number>;
  /** Price multiplier for buildings designed by research. */
  designCost: number;
}

export function neutralMods(): ResearchMods {
  return { buildCost: 1, powerUse: 1, waterUse: 1, garbage: 1, roadCapacity: 1, industryEfficiency: 1, industryPollution: 1, powerPollution: 1, happiness: 0, landValue: 0, boost: {}, retrofitPollution: {}, designCost: 1 };
}

/** A retrofit programme with what it would take now. */
export interface RetrofitOffer extends Retrofit {
  buildings: number;
  cost: number;
  applied: boolean;
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
  funding?: number;
  autoDecide?: boolean;
  milestones?: string[];
  milestoneDays?: [string, number][];
  retrofits?: [string, { day: number; buildings: number; cost: number }][];
  guideDone?: boolean;
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
  /** Research budget: 1 is normal; more is faster and dearer. */
  funding = 1;
  /** Take the careful option when a decision has waited too long. */
  autoDecide = false;
  /** Milestones reached. */
  readonly milestones = new Set<string>();
  /** Day each milestone was reached. */
  readonly milestoneDays = new Map<string, number>();
  /** Retrofit programmes carried out (by discovery id). */
  readonly retrofits = new Map<string, { day: number; buildings: number; cost: number }>();
  /** The first-experiment guide has been dismissed. */
  guideDone = false;
  /** Bumped whenever something the interface shows changes. */
  version = 0;
  private briefCache: { day: number; list: Brief[] } | null = null;
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
        out.set(r.id, { ok: false, why: 'Needs a utility lab' });
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

  /** The city's pressing problems, put to its scientists (refreshed daily). */
  briefs(): Brief[] {
    const day = this.city.clock.day;
    if (!this.briefCache || this.briefCache.day !== day) this.briefCache = { day, list: cityBriefs(this.city, this.needs()) };
    return this.briefCache.list;
  }

  // ── Staff ──

  /** Universities running in the city (graduates staff the centres). */
  universities(): number {
    let n = 0;
    for (const b of this.city.buildings.all.values()) if (b.typeId === 'university' && b.state === BuildingState.Active) n++;
    return n;
  }

  /** Mastery level (0–3) of a centre in a field. */
  masteryOf(c: Center, f: FieldId): number {
    return masteryLevel(c.mastery?.[f] ?? 0);
  }

  /** Factors beyond the plan itself: mastery, graduates, milestones, a joint team. */
  extras(c: Center, plan: Plan): [string, number][] {
    const out: [string, number][] = [];
    const m = this.masteryOf(c, plan.field);
    if (m) out.push([`${MASTERY_NAMES[m]} in ${FIELD_BY_ID.get(plan.field)!.name.toLowerCase()}`, 0.03 * m]);
    const u = Math.min(3, this.universities());
    if (u) out.push([`University graduates (${u})`, 0.04 * u]);
    if (this.milestones.has(`field:${plan.field}`)) out.push(['Established field', 0.05]);
    const partnerId = c.active?.plan.id === plan.id ? c.active.partnerId : undefined;
    const partner = partnerId !== undefined ? this.centers.get(partnerId) : undefined;
    if (partner) out.push([`Joint team with ${partner.name}`, 0.08]);
    return out;
  }

  /** Extra result quality from experience and a joint team. */
  private qualityBonus(c: Center, plan: Plan): number {
    return 0.03 * this.masteryOf(c, plan.field) + (c.active?.partnerId !== undefined ? 0.06 : 0);
  }

  /** Progress per day for a running experiment (budget, equipment, graduates, partner). */
  speedOf(c: Center): number {
    const a = c.active;
    if (!a) return 0;
    const fund = 0.4 + 0.6 * this.funding;
    const grads = 1 + 0.1 * Math.min(3, this.universities());
    const joint = a.partnerId !== undefined ? 1.3 : 1;
    const iter = a.plan.kind === 'iteration' && this.milestones.has('iterate') ? 1.25 : 1;
    return (1 + 0.1 * (c.equipment - 1)) * fund * grads * joint * iter;
  }

  /** Roughly how many days a proposal would take here now (with an optional partner). */
  estimateDays(c: Center, plan: Plan, partnerId?: number): number {
    const fund = 0.4 + 0.6 * this.funding;
    const grads = 1 + 0.1 * Math.min(3, this.universities());
    const joint = partnerId !== undefined ? 1.3 : 1;
    const iter = plan.kind === 'iteration' && this.milestones.has('iterate') ? 1.25 : 1;
    return Math.max(4, Math.round(Math.max(4, plan.days) / ((1 + 0.1 * (c.equipment - 1)) * fund * grads * joint * iter)));
  }

  setFunding(v: number): void {
    this.funding = Math.max(FUNDING_MIN, Math.min(FUNDING_MAX, Math.round(v * 20) / 20));
    this.version++;
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
      if (weight > 0.04 && isLiveField(field)) factors.push({ field, weight, label });
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
    for (const f of LIVE_FIELD_DEFS) score.set(f.id, (hashStr(this.civSeed, 'lean', f.id) / 4294967296) * 0.3 + (hashStr(this.civSeed, buildingId, f.id) / 4294967296) * 0.15);
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

  /**
   * Older cities: centres that specialised in a field research no longer
   * works in turn to the utility field nearest their site. Work under way
   * finishes as planned; offers outside the utility fields are withdrawn.
   */
  retireFields(): void {
    let changed = false;
    for (const c of this.centers.values()) {
      const b = this.city.buildings.get(c.id);
      if (!isLiveField(c.field)) {
        const ranked = b ? this.assessSite(b.cx, b.cz, b.id).ranked : LIVE_FIELD_DEFS.map((f) => f.id);
        const keep = [c.field, ...c.secondary].filter(isLiveField);
        c.field = keep[0] ?? ranked[0];
        c.secondary = [...keep.slice(1), ...ranked].filter((f, i, a) => f !== c.field && a.indexOf(f) === i).slice(0, 2);
        if (b) {
          b.style = `lab:${c.field}`;
          this.city.buildings.markChanged(b, 'geometry');
        }
        changed = true;
      } else if (c.secondary.some((f) => !isLiveField(f))) {
        c.secondary = c.secondary.filter(isLiveField);
        changed = true;
      }
      const before = c.offers.length;
      c.offers = c.offers.filter((o) => isLiveField(o.field));
      if (c.offers.length !== before) changed = true;
    }
    if (changed) this.version++;
  }

  onBuildingRemoved(id: number): void {
    const c = this.centers.get(id);
    if (!c) return;
    if (c.active) {
      // The work stops; money already committed is gone, nothing more is charged.
      this.record(c, c.active, 'interrupted', 0, undefined, 'The centre closed before the experiment finished.');
      this.release(c);
    }
    // A partner that closes leaves the lead to carry on alone.
    if (c.assisting !== undefined) {
      const lead = this.centers.get(c.assisting);
      if (lead?.active) lead.active.partnerId = undefined;
    }
    this.centers.delete(id);
    this.version++;
  }

  /** Frees the partner of a centre's experiment. */
  private release(c: Center): void {
    const pid = c.active?.partnerId;
    if (pid === undefined) return;
    const p = this.centers.get(pid);
    if (p && p.assisting === c.id) p.assisting = undefined;
  }

  /** Idle, open centres that could join an experiment at `c`. */
  partnersFor(c: Center): Center[] {
    return [...this.centers.values()].filter((o) => o.id !== c.id && !o.active && o.assisting === undefined && this.operational(o).ok);
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
    const ctx: ProposalContext = {
      resources: this.resourcesFor(c), needs: this.needs(), followups: this.followups, briefs: this.briefs(), iterations: this.iterationsReady(),
      extraSlots: this.milestones.has('fields5') ? 1 : 0, synthDiscount: this.milestones.has('synth') ? 0.2 : 0,
    };
    c.offers = generateProposals(this.civ(), this.info(c), ctx, c.round, this.nextPlan);
    this.version++;
    return true;
  }

  /** Designs in service long enough to develop their next version. */
  iterationsReady(): { discovery: string; version: number }[] {
    const day = this.city.clock.day;
    const running = new Set([...this.centers.values()].map((c) => (c.active?.plan.kind === 'iteration' ? c.active.plan.basis[0] : '')));
    const out: { discovery: string; version: number }[] = [];
    for (const d of this.designs.values()) {
      const v = d.version ?? 1;
      if (d.builtDay === undefined || day - d.builtDay < ITERATE_AFTER_DAYS || v >= 4) continue;
      if (this.achieved.has(`iter|${d.id}`) || running.has(d.discoveryId)) continue;
      out.push({ discovery: d.discoveryId, version: v });
    }
    return out;
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
    if (c.assisting !== undefined) reqs.push({ label: `Helping ${this.centers.get(c.assisting)?.name ?? 'another centre'} with its experiment`, ok: false });
    if (p.needs || plan.kind === 'synthesis') {
      const edu = b ? this.education(c) : 0;
      reqs.push({ label: `Educated staff: education coverage 25%+ at the centre (${Math.round(edu * 100)}%)`, ok: edu >= 0.25 });
    }
    return reqs;
  }

  /** Chance of success for a plan: the running one counts the decisions taken so far, plus `extra`. */
  oddsFor(c: Center, plan: Plan, extra: Choice[] = [], partnerId?: number) {
    const taken = c.active?.plan.id === plan.id ? this.choicesOf(c) : [];
    const factors = this.extras(c, plan);
    // Previewing a joint start: count the partner before it has joined.
    if (partnerId !== undefined && !factors.some(([k]) => k.startsWith('Joint team'))) factors.push([`Joint team with ${this.centers.get(partnerId)?.name ?? 'a partner'}`, 0.08]);
    return odds(plan, [...taken, ...extra], this.info(c), this.civ(), this.education(c), factors);
  }

  private choicesOf(c: Center): Choice[] {
    const a = c.active;
    if (!a) return [];
    return a.choices
      .map((ch) => ({ stage: ch.stage, option: ch.option ?? decisionFor(this.civSeed, a.plan, ch.stage).options.find((o) => o.id === ch.optionId)! }))
      .filter((ch) => ch.option);
  }

  start(centerId: number, planId: string, partnerId?: number): { ok: boolean; error?: string } {
    const c = this.centers.get(centerId);
    if (!c) return { ok: false, error: 'No such utility lab' };
    const plan = c.offers.find((p) => p.id === planId);
    if (!plan) return { ok: false, error: 'That proposal is no longer on offer' };
    const unmet = this.requirements(c, plan).filter((r) => !r.ok);
    if (unmet.length) return { ok: false, error: unmet[0].label };
    const partner = partnerId !== undefined ? this.centers.get(partnerId) : undefined;
    if (partnerId !== undefined && (!partner || !this.partnersFor(c).includes(partner))) return { ok: false, error: 'That centre cannot help right now' };
    if (!this.city.economy.spend(plan.cost, 'Research')) return { ok: false, error: 'Not enough money' };
    c.active = { plan, progress: 0, choices: [], pending: null, started: this.city.clock.day, spent: plan.cost, status: 'Running' };
    if (partner) {
      c.active.partnerId = partner.id;
      partner.assisting = c.id;
    }
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
    a.choices.push({ stage: a.pending.stage, optionId: opt.id, label: opt.label, option: opt });
    a.pending = null;
    a.pendingSince = undefined;
    // Sharing the findings early ends the work now.
    if (opt.publish) this.finish(c);
    this.version++;
    return { ok: true };
  }

  abandon(centerId: number): void {
    const c = this.centers.get(centerId);
    if (!c?.active) return;
    this.insights.set(c.active.plan.principle, (this.insights.get(c.active.plan.principle) ?? 0) + 0.5);
    this.record(c, c.active, 'abandoned', 0, undefined, 'Stopped early. What was learned makes the next attempt at this method a little safer.');
    this.release(c);
    c.active = null;
    this.refresh(c);
  }

  /** The decision coming up next for a running experiment, if any. */
  private nextStage(a: ActiveExperiment): { at: number; stage: number } | null {
    const done = new Set(a.choices.map((ch) => ch.stage));
    const apply = a.choices.some((ch) => ch.stage === 0 && (ch.option?.direction ?? ch.optionId) === 'apply');
    for (const st of STAGE_PLAN) {
      if (done.has(st.stage)) continue;
      // Field trials are only for pilot facilities.
      if (st.stage === 2 && !apply) continue;
      return st;
    }
    return null;
  }

  /** Field-trial sites for a running experiment's pilot. */
  sitesFor(c: Center, plan: Plan): TrialSite[] {
    const b = this.city.buildings.get(c.id);
    const fn = PRINCIPLE_BY_ID.get(plan.principle)?.build ?? 'powerGen';
    return trialSites(this.city, fn, b ? { x: b.cx, z: b.cz } : this.city.startPoint);
  }

  /** The careful choice, for decisions left waiting too long. */
  private carefulOption(d: Decision): DecisionOption {
    const pick = d.options.find((o) => o.id === 'carry' || o.id === 'safe' || o.id === 'lab');
    return pick ?? [...d.options].sort((x, y) => x.risk - y.risk || x.cost - y.cost)[0];
  }

  upgrade(centerId: number): { ok: boolean; error?: string } {
    const c = this.centers.get(centerId);
    const b = c && this.city.buildings.get(c.id);
    if (!c || !b) return { ok: false, error: 'No such utility lab' };
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
    const day = this.city.clock.day;
    // A design's time in service counts from its first working building.
    for (const d of this.designs.values()) {
      if (d.builtDay !== undefined) continue;
      for (const b of this.city.buildings.all.values()) {
        if (b.typeId === d.serviceId && b.state === BuildingState.Active) {
          d.builtDay = day;
          this.version++;
          break;
        }
      }
    }
    for (const c of this.centers.values()) {
      const b = this.city.buildings.get(c.id);
      if (!b) continue;
      if (c.round === 0 && this.operational(c).ok) this.refresh(c);
      const a = c.active;
      if (a?.pending && this.autoDecide && day - (a.pendingSince ?? day) >= AUTO_DECIDE_DAYS) {
        const opt = this.carefulOption(a.pending);
        const title = a.pending.title;
        this.decide(c.id, opt.id);
        this.city.emitNotice({ severity: 'info', icon: 'research', title: 'Decided for you', text: `${c.name}: “${title}” waited ${AUTO_DECIDE_DAYS} days, so the team chose: ${opt.label}.`, x: b.cx, z: b.cz });
        continue;
      }
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
      a.progress = Math.min(1, a.progress + this.speedOf(c) / Math.max(4, a.plan.days + extraDays));
      const next = this.nextStage(a);
      if (next && a.progress >= next.at) {
        a.progress = next.at;
        a.pending = decisionFor(this.civSeed, a.plan, next.stage, next.stage === 2 ? this.sitesFor(c, a.plan) : []);
        a.pendingSince = day;
        // The game shows a clickable notification that opens the decision.
        this.city.events.emit('research', { type: 'decision', centerId: c.id });
      } else if (a.progress >= 1 && !next) {
        this.finish(c);
      }
      this.version++;
    }
  }

  /** Monthly running cost of experiments in progress (scaled by the research budget). */
  monthlyCost(): number {
    let s = 0;
    for (const c of this.centers.values()) if (c.active) s += c.active.plan.monthly;
    return Math.round(s * this.funding);
  }

  private finish(c: Center): void {
    const a = c.active!;
    const b = this.city.buildings.get(c.id);
    const civ = this.civ();
    const choices = this.choicesOf(c);
    const res = resolve(civ, a.plan, choices, this.info(c), this.education(c), this.extras(c, a.plan), this.qualityBonus(c, a.plan));
    const partner = a.partnerId !== undefined ? this.centers.get(a.partnerId) : undefined;
    this.release(c);
    c.active = null;
    c.completed++;
    // Experience: the lead centre learns most, a partner a little.
    const xp = res.outcome === 'failure' ? 0.5 : 1;
    const before = this.masteryOf(c, a.plan.field);
    c.mastery = { ...c.mastery, [a.plan.field]: (c.mastery?.[a.plan.field] ?? 0) + xp };
    if (partner) partner.mastery = { ...partner.mastery, [a.plan.field]: (partner.mastery?.[a.plan.field] ?? 0) + xp / 2 };
    if (this.masteryOf(c, a.plan.field) > before) {
      this.city.emitNotice({ severity: 'good', icon: 'research', title: `${MASTERY_NAMES[this.masteryOf(c, a.plan.field)]} in ${FIELD_BY_ID.get(a.plan.field)!.name}`, text: `${c.name} has grown more experienced: better odds and results in this field.`, x: b?.cx, z: b?.cz });
    }
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
      if (a.plan.kind === 'iteration') {
        const prev = this.discoveries.find((d) => d.id === a.plan.basis[0]);
        if (prev?.designId) this.achieved.add(`iter|${prev.designId}`);
      }
      // Findings shared early leave open questions: the next-best substance becomes a follow-up.
      let note: string | undefined;
      if (choices.some((ch) => ch.option.publish)) {
        const p = PRINCIPLE_BY_ID.get(a.plan.principle)!;
        const reach = this.resourcesFor(c);
        const alt = RESOURCES.filter((r) => r.id !== a.plan.resource && reach.get(r.id)?.ok && fit(p, r) >= 0.3 && !this.achieved.has(`${p.id}|${r.id}`)).sort((x, y) => fit(p, y) - fit(p, x))[0];
        if (alt) {
          this.followups.push({ principle: p.id, resource: alt.id, basis: made.discovery.id, note: `Shared early: the open questions point to ${alt.name.toLowerCase()}.` });
          note = `Shared early. The open questions point to ${alt.name.toLowerCase()} — a follow-up is on offer.`;
        }
      }
      this.record(c, a, res.outcome, res.chance, made.discovery.id, note);
      this.city.emitNotice({ severity: 'good', icon: 'research', title: `Discovery: ${made.discovery.name}`, text: `${c.name} — ${made.discovery.classification}.`, x: b?.cx, z: b?.cz });
      this.city.events.emit('research', { type: 'discovery', centerId: c.id, discoveryId: made.discovery.id, outcome: res.outcome });
    }
    this.checkMilestones();
    this.refresh(c);
    if (partner) this.refresh(partner);
  }

  // ── Milestones ──

  summary(): ScienceSummary {
    return {
      discoveries: this.discoveries,
      designs: [...this.designs.values()],
      breakthroughs: this.records.filter((r) => r.outcome === 'breakthrough').length,
      syntheses: this.records.filter((r) => r.kind === 'synthesis' && r.discoveryId).length,
      iterations: [...this.designs.values()].filter((d) => (d.version ?? 1) >= 2).length,
      retrofits: this.retrofits.size,
    };
  }

  /** Records milestones newly reached and pays out their rewards. */
  checkMilestones(): void {
    const reached = newMilestones(this.summary(), this.milestones);
    for (const m of reached) {
      this.milestones.add(m.id);
      this.milestoneDays.set(m.id, this.city.clock.day);
      if (m.id === 'first') this.city.economy.grant(15_000);
      this.city.emitNotice({ severity: 'good', icon: 'research', title: `Research milestone: ${m.title}`, text: `${m.goal}. Reward: ${m.reward}.` });
      this.city.events.emit('research', { type: 'milestone', centerId: 0, milestoneId: m.id });
    }
    if (reached.length) this.recomputeMods();
  }

  // ── Retrofits ──

  /** Retrofit programmes the civilization's discoveries make possible. */
  retrofitOffers(): RetrofitOffer[] {
    const out: RetrofitOffer[] = [];
    const discount = this.milestones.has('retrofit') ? 0.85 : 1;
    for (const d of this.discoveries) {
      const design = d.designId ? this.designs.get(d.designId) : undefined;
      const r = retrofitFor(d, design);
      if (!r) continue;
      const targets = this.retrofitTargets(r);
      const applied = this.retrofits.get(r.id);
      out.push({ ...r, buildings: applied ? applied.buildings : targets.length, cost: applied ? applied.cost : Math.round((r.perBuilding * targets.length * discount) / 100) * 100, applied: !!applied });
    }
    return out;
  }

  private retrofitTargets(r: Retrofit): Building[] {
    const out: Building[] = [];
    for (const b of this.city.buildings.all.values()) {
      if (b.kind !== 'service' || b.state === BuildingState.Abandoned) continue;
      const st = SERVICE_BY_ID.get(b.typeId);
      if (!st || st.kind !== r.target) continue;
      if (r.what === 'pollution' && !(st.pollution > 0)) continue;
      if (r.what === 'output' && !(st.output > 0)) continue;
      out.push(b);
    }
    return out;
  }

  /** Carries out a retrofit programme: every existing building of its kind, and every later one. */
  applyRetrofit(id: string): { ok: boolean; error?: string } {
    const offer = this.retrofitOffers().find((o) => o.id === id);
    if (!offer) return { ok: false, error: 'No such retrofit' };
    if (offer.applied) return { ok: false, error: 'Already carried out' };
    if (!offer.buildings) return { ok: false, error: `No ${offer.targetLabel} to retrofit yet` };
    if (!this.city.economy.spend(offer.cost, 'Research')) return { ok: false, error: `Needs ${formatMoney(offer.cost)}` };
    this.retrofits.set(id, { day: this.city.clock.day, buildings: offer.buildings, cost: offer.cost });
    this.recomputeMods();
    this.city.recomputeUtilities();
    this.city.emitNotice({ severity: 'good', icon: 'research', title: 'Retrofit complete', text: `${offer.title}: ${offer.buildings} building${offer.buildings === 1 ? '' : 's'} upgraded.` });
    this.city.events.emit('research', { type: 'retrofit', centerId: 0, discoveryId: id });
    this.checkMilestones();
    return { ok: true };
  }

  /** Retrofits in effect for a kind of facility (for the inspector). */
  retrofitsFor(kind: string): RetrofitOffer[] {
    return this.retrofitOffers().filter((o) => o.applied && o.target === kind);
  }

  // ── Names ──

  /** Renames a design (and its discovery); a version mark is kept. */
  renameDesign(id: string, name: string): boolean {
    const d = this.designs.get(id);
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!d || !clean) return false;
    const mark = /( Mk [IVX]+)$/.exec(d.name)?.[1] ?? '';
    d.name = `${baseName(clean)}${mark}`;
    const disc = this.discoveries.find((x) => x.id === d.discoveryId);
    if (disc) disc.name = d.name;
    this.register(d);
    this.version++;
    return true;
  }

  dismissGuide(): void {
    this.guideDone = true;
    this.version++;
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
    this.checkMilestones();
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
      kind: a.plan.kind,
      partner: a.partnerId !== undefined ? this.centers.get(a.partnerId)?.name : undefined,
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
    // Retrofit programmes carried out.
    for (const o of this.retrofitOffers()) {
      if (!o.applied) continue;
      if (o.what === 'pollution') m.retrofitPollution[o.target] = (m.retrofitPollution[o.target] ?? 1) * (1 + o.value);
      else all.push({ kind: 'boost', value: o.value, target: o.target });
    }
    // Milestone rewards and the research-led policies in force.
    if (this.milestones.has('breakthrough3')) m.happiness += 1;
    if (this.milestones.has('designs3')) m.designCost = 0.9;
    const pol = this.city.policies;
    if (pol?.has('congestionPricing')) {
      all.push({ kind: 'roadCapacity', value: 0.1 });
      m.happiness -= 1;
    }
    if (pol?.has('greenBuildingCode')) {
      all.push({ kind: 'powerUse', value: -0.08 });
      all.push({ kind: 'buildCost', value: 0.06 });
    }
    if (pol?.has('waterMetering')) {
      all.push({ kind: 'waterUse', value: -0.12 });
      m.happiness -= 0.5;
    }
    if (pol?.has('healthDrive')) m.happiness += 1;
    if (pol?.has('urbanFarming')) {
      all.push({ kind: 'garbage', value: -0.08 });
      m.happiness += 0.5;
    }
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
    for (const k of Object.keys(m.retrofitPollution)) m.retrofitPollution[k] = Math.max(0.25, m.retrofitPollution[k]);
    this.mods = m;
    this.city.traffic.capacityScale = m.roadCapacity;
    this.version++;
  }

  /** Construction price of a service in this city after research. */
  costOf(st: ServiceType): number {
    if (st.kind === 'research') return st.cost;
    return Math.round((st.cost * this.mods.buildCost * (st.designId ? this.mods.designCost : 1)) / 100) * 100;
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
      funding: this.funding,
      autoDecide: this.autoDecide,
      milestones: [...this.milestones],
      milestoneDays: [...this.milestoneDays.entries()],
      retrofits: [...this.retrofits.entries()],
      guideDone: this.guideDone,
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
    this.funding = d.funding ?? 1;
    this.autoDecide = d.autoDecide ?? false;
    this.milestones.clear();
    for (const k of d.milestones ?? []) this.milestones.add(k);
    this.milestoneDays.clear();
    for (const [k, v] of d.milestoneDays ?? []) this.milestoneDays.set(k, v);
    this.retrofits.clear();
    for (const [k, v] of d.retrofits ?? []) this.retrofits.set(k, v);
    this.guideDone = d.guideDone ?? false;
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

