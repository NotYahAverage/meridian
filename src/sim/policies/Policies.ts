import type { City } from '../City';
import type { FieldId } from '../research/Knowledge';
import { SERVICE_BY_ID } from '../services/ServiceTypes';
import { BuildingState, Zone, zoneBase } from '../types';

export type PolicyId =
  | 'recycling'
  | 'smokeDetectors'
  | 'neighborhoodWatch'
  | 'smallBusiness'
  | 'industryIncentives'
  | 'cleanAir'
  | 'adultEducation'
  | 'parkRangers'
  | 'freeTransit'
  | 'highRiseBan'
  | 'congestionPricing'
  | 'greenBuildingCode'
  | 'waterMetering'
  | 'healthDrive'
  | 'urbanFarming';

export interface PolicyDef {
  id: PolicyId;
  name: string;
  description: string;
  /** Short effect lines for the UI (good first, then drawbacks). */
  effects: string[];
  unlockPopulation: number;
  icon: string;
  /** Only possible once the city's utility labs have made a discovery in this field. */
  requiresField?: FieldId;
  /** Only possible once the city has adopted a style in the Design Studio. */
  requiresStyle?: boolean;
  /** Its effects work through the research modifiers (recomputed when it changes). */
  researchLed?: boolean;
}

export const POLICIES: PolicyDef[] = [
  {
    id: 'smokeDetectors', name: 'Smoke Detector Mandate', icon: 'fire', unlockPopulation: 300,
    description: 'Every home and workplace must have working smoke alarms.',
    effects: ['Fires break out 45% less often', 'Costs per household and business'],
  },
  {
    id: 'smallBusiness', name: 'Small Business Support', icon: 'shop', unlockPopulation: 300,
    description: 'Grants and lighter paperwork for new shops.',
    effects: ['Commercial demand +12', 'Commercial tax income −20%'],
  },
  {
    id: 'industryIncentives', name: 'Industrial Tax Breaks', icon: 'factory', unlockPopulation: 300,
    description: 'Lower taxes attract manufacturers and logistics firms.',
    effects: ['Industrial demand +14', 'Industrial tax income −30%'],
  },
  {
    id: 'recycling', name: 'Recycling Program', icon: 'garbage', unlockPopulation: 1_000,
    description: 'Households sort their waste and recyclables are collected separately.',
    effects: ['30% less garbage', 'Costs per household'],
  },
  {
    id: 'neighborhoodWatch', name: 'Neighborhood Watch', icon: 'police', unlockPopulation: 1_000,
    description: 'Residents look out for each other, supported by community officers.',
    effects: ['Crime only where police coverage is very poor', 'Slightly happier residents', 'Costs per household'],
  },
  {
    id: 'cleanAir', name: 'Clean Air Act', icon: 'factory', unlockPopulation: 2_500,
    description: 'Strict emission limits for factories and power plants.',
    effects: ['Industrial and power plant pollution −40%', 'Industrial demand −8', 'Costs per industrial worker'],
  },
  {
    id: 'adultEducation', name: 'Adult Education', icon: 'education', unlockPopulation: 2_500,
    description: 'Evening classes and retraining for working adults.',
    effects: ['Workers become educated 2.5× faster (more office workers)', 'Costs per household'],
  },
  {
    id: 'parkRangers', name: 'Park Rangers', icon: 'parks', unlockPopulation: 2_500,
    description: 'Rangers keep parks clean, safe and lively.',
    effects: ['Parks raise happiness and land value 30% more', 'Costs per park'],
  },
  {
    id: 'freeTransit', name: 'Free Public Transit', icon: 'bus', unlockPopulation: 2_500,
    description: 'Buses are free to ride, paid for by the city.',
    effects: ['Many more commuters take the bus', 'Residents are a little happier', 'No fare income'],
  },
  {
    id: 'highRiseBan', name: 'High-Rise Ban', icon: 'office', unlockPopulation: 6_000,
    description: 'Caps new buildings at six floors to keep the skyline low.',
    effects: ['Residents like the low skyline (+3 happiness)', 'New buildings are lower and house fewer people'],
  },
  // Policies your labs and architects make possible.
  {
    id: 'congestionPricing', name: 'Congestion Pricing', icon: 'road', unlockPopulation: 2_000, researchLed: true,
    description: 'Drivers pay to enter busy streets at peak times, measured by traffic sensors on every junction.',
    effects: ['Road capacity +10%', 'Income from charges', 'Residents grumble (−1 happiness)'],
  },
  {
    id: 'greenBuildingCode', name: 'Green Building Code', icon: 'build', unlockPopulation: 1_000, requiresStyle: true, researchLed: true,
    description: 'New construction must meet efficiency standards your architects worked out for the city’s own styles.',
    effects: ['Buildings use 8% less power', 'Construction costs 6% more'],
  },
  {
    id: 'waterMetering', name: 'Water Metering', icon: 'water', unlockPopulation: 1_000, requiresField: 'water', researchLed: true,
    description: 'Every home and business is metered and billed for what it uses.',
    effects: ['12% less water used', 'Residents are a little less happy'],
  },
  {
    id: 'healthDrive', name: 'Public Health Drive', icon: 'health', unlockPopulation: 1_500, researchLed: true,
    description: 'Screenings, vaccination days and health advice in every neighbourhood.',
    effects: ['Residents are happier (+1)', 'Costs per household'],
  },
  {
    id: 'urbanFarming', name: 'Urban Farming Scheme', icon: 'parks', unlockPopulation: 1_000, requiresField: 'environment', researchLed: true,
    description: 'Rooftop beds and allotments, using growing methods your environmental engineers developed.',
    effects: ['8% less garbage', 'Residents are a little happier', 'Costs per park'],
  },
];

export const POLICY_BY_ID = new Map(POLICIES.map((p) => [p.id, p]));

const FIELD_NAMES: Record<FieldId, string> = {
  materials: 'materials', energy: 'energy', agriculture: 'agriculture', manufacturing: 'manufacturing', transport: 'transport',
  water: 'water', environment: 'the environment', architecture: 'architecture', medicine: 'medicine',
};

/** Maximum floors for new buildings under the high-rise ban. */
export const HIGH_RISE_CAP = 6;

/** Policies that can be enacted for a single district as well as city-wide. */
export const LOCAL_POLICIES: PolicyId[] = ['smokeDetectors', 'recycling', 'neighborhoodWatch', 'cleanAir', 'adultEducation', 'parkRangers', 'highRiseBan'];
const LOCAL = new Set(LOCAL_POLICIES);

export const isLocalPolicy = (id: PolicyId): boolean => LOCAL.has(id);

/**
 * City-wide policies, plus district policies that apply only to buildings
 * painted into one district. Effects are read by the simulation systems.
 */
export class Policies {
  readonly active = new Set<PolicyId>();
  /** District id → policies enacted only there. */
  readonly local = new Map<number, Set<PolicyId>>();

  constructor(private city: City) {}

  /** True when the policy is enacted city-wide. */
  has(id: PolicyId): boolean {
    return this.active.has(id);
  }

  /** True when the policy applies in a district (city-wide, or enacted there). */
  in(id: PolicyId, district: number): boolean {
    if (this.active.has(id)) return true;
    return district > 0 && this.local.size > 0 && !!this.local.get(district)?.has(id);
  }

  /** True when the policy applies anywhere in the city. */
  anywhere(id: PolicyId): boolean {
    if (this.active.has(id)) return true;
    for (const set of this.local.values()) if (set.has(id)) return true;
    return false;
  }

  /** Number of enacted policies, counting each district policy once. */
  count(): number {
    let n = this.active.size;
    for (const [d, set] of this.local) if (this.city.districts.list.has(d)) for (const id of set) if (!this.active.has(id)) n++;
    return n;
  }

  /** Why a policy can't be enacted yet (undefined when it can). */
  lockReason(id: PolicyId): string | undefined {
    const def = POLICY_BY_ID.get(id);
    if (!def) return 'Unknown policy';
    if (def.requiresField && !this.city.research.discoveries.some((d) => d.field === def.requiresField)) return `Needs a utility lab discovery in ${FIELD_NAMES[def.requiresField]}`;
    if (def.requiresStyle && !this.city.design.styles.length) return 'Needs a style adopted in the Design Studio';
    if (this.city.peakPopulation < def.unlockPopulation) return `Unlocks at ${def.unlockPopulation.toLocaleString('en-US')} population`;
    return undefined;
  }

  set(id: PolicyId, on: boolean): boolean {
    const def = POLICY_BY_ID.get(id);
    if (!def) return false;
    if (on && this.lockReason(id)) return false;
    if (on) this.active.add(id);
    else this.active.delete(id);
    this.city.coverageDirty = true;
    // Research-led policies change the city through the research effects.
    if (def.researchLed) this.city.research.recomputeMods();
    return true;
  }

  /** Enacts or repeals a policy in one district. */
  setLocal(district: number, id: PolicyId, on: boolean): boolean {
    const def = POLICY_BY_ID.get(id);
    if (!def || !LOCAL.has(id) || !this.city.districts.list.has(district)) return false;
    if (on && this.city.peakPopulation < def.unlockPopulation) return false;
    let set = this.local.get(district);
    if (on) {
      if (!set) this.local.set(district, (set = new Set()));
      set.add(id);
    } else if (set) {
      set.delete(id);
      if (!set.size) this.local.delete(district);
    }
    this.city.coverageDirty = true;
    return true;
  }

  /** Policies enacted in one district (not counting city-wide ones). */
  localTo(district: number): PolicyId[] {
    return [...(this.local.get(district) ?? [])];
  }

  /** Districts where a policy is enacted locally. */
  districtsWith(id: PolicyId): number[] {
    const out: number[] = [];
    for (const [d, set] of this.local) if (set.has(id) && this.city.districts.list.has(d)) out.push(d);
    return out;
  }

  /** Monthly running cost of one policy, city-wide or for one district. */
  costOf(id: PolicyId, district?: number): number {
    let households = 0, jobs = 0, industrial = 0, parks = 0;
    if (district === undefined) {
      households = this.city.stats.households;
      jobs = this.city.stats.jobs;
    }
    if (district !== undefined || id === 'cleanAir' || id === 'parkRangers' || id === 'urbanFarming') {
      for (const b of this.city.buildings.all.values()) {
        if (district !== undefined && b.district !== district) continue;
        if (district !== undefined) {
          households += b.households;
          jobs += b.workers;
        }
        if (zoneBase(b.zone) === Zone.Industrial && b.state === BuildingState.Active) industrial += b.workers;
        if (b.kind === 'service' && SERVICE_BY_ID.get(b.typeId)?.kind === 'park') parks++;
      }
    }
    switch (id) {
      case 'recycling':
        return households * 0.9;
      case 'smokeDetectors':
        return (households + jobs / 4) * 0.5;
      case 'neighborhoodWatch':
        return households * 0.4;
      case 'adultEducation':
        return households * 1.2;
      case 'cleanAir':
        return industrial * 2.5 + (district === undefined ? 400 : industrial > 0 ? 120 : 0);
      case 'parkRangers':
        return parks * 260;
      case 'healthDrive':
        return households * 0.7;
      case 'urbanFarming':
        return parks * 180 + 300;
      case 'congestionPricing':
        // Charges bring money in.
        return -households * 0.5;
      default:
        // Tax breaks, free transit and the ban cost through lost income instead.
        return 0;
    }
  }

  monthlyCost(): number {
    let c = 0;
    for (const id of this.active) c += this.costOf(id);
    for (const [d, set] of this.local) {
      if (!this.city.districts.list.has(d)) continue;
      for (const id of set) if (!this.active.has(id)) c += this.costOf(id, d);
    }
    return c;
  }

  /** Demand adjustments from active policies. */
  demandBonus(): { commercial: number; industrial: number } {
    return {
      commercial: this.has('smallBusiness') ? 12 : 0,
      industrial: (this.has('industryIncentives') ? 14 : 0) - (this.has('cleanAir') ? 8 : 0),
    };
  }

  serialize(): PolicyId[] {
    return [...this.active];
  }

  serializeLocal(): [number, PolicyId[]][] {
    return [...this.local].filter(([d, set]) => set.size && this.city.districts.list.has(d)).map(([d, set]) => [d, [...set]]);
  }

  load(ids: PolicyId[] | undefined, local?: [number, PolicyId[]][]): void {
    this.active.clear();
    this.local.clear();
    for (const id of ids ?? []) if (POLICY_BY_ID.has(id)) this.active.add(id);
    for (const [d, list] of local ?? []) {
      const set = new Set(list.filter((id) => LOCAL.has(id)));
      if (set.size) this.local.set(d, set);
    }
  }
}
