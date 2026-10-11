import { clamp, formatInt, lerp } from '../../core/math';
import type { DemandKind } from '../types';

/** Where the player can act on a demand factor (the UI turns these into buttons). */
export type DemandFix =
  | 'budget' | 'policies'
  | 'zone-res' | 'zone-com' | 'zone-ind' | 'zone-office'
  | 'roads' | 'transit' | 'services' | 'parks'
  | 'traffic' | 'landValue' | 'happiness' | 'education';

export interface DemandFactor {
  label: string;
  value: number;
  /** The numbers behind the factor, e.g. "12% of workers have no job". */
  detail?: string;
  /** How to fix it (only given for factors holding demand back). */
  tip?: string;
  fix?: DemandFix;
  /** Advice only: shown to the player but not counted in the demand value. */
  hint?: boolean;
}

export interface DemandInputs {
  connected: boolean;
  population: number;
  households: number;
  housingCapacity: number;
  /** Homes under construction (households). */
  pendingHousing: number;
  workers: number;
  employed: number;
  educatedWorkers: number;
  educatedEmployed: number;
  jobs: { commercial: number; industrial: number; office: number; service: number };
  filled: { commercial: number; industrial: number; office: number; service: number };
  /** 0–100. */
  happiness: number;
  taxes: Record<DemandKind, number>;
  /** Average service coverage for residents, 0–1. */
  serviceScore: number;
  avgLandValue: number;
  /** Average volume/capacity on used roads. */
  congestion: number;
  officeUnlocked: boolean;
  /** Demand adjustments from city policies. */
  policy?: { commercial: number; industrial: number };
  /** An operating airport draws business to the city. */
  airport?: boolean;
  /** An operating university supplies graduates. */
  university?: boolean;
  /** An operating cargo harbour ships goods by sea. */
  port?: boolean;
}

const VACANCY = 'Vacant homes';
/** Matches the office milestone in Progress (offices unlock at this peak population). */
const OFFICE_UNLOCK = 1_000;
const KINDS: DemandKind[] = ['residential', 'commercial', 'industrial', 'office'];

/**
 * RCI+O demand. Each value is 0–100 and is smoothed over time. The factor
 * lists explain to the player why demand is high or low.
 */
export class Demand {
  readonly value: Record<DemandKind, number> = { residential: 50, commercial: 10, industrial: 30, office: 0 };
  readonly factors: Record<DemandKind, DemandFactor[]> = { residential: [], commercial: [], industrial: [], office: [] };
  /** How keen households are to move into existing vacant homes (0–100). */
  attraction = 50;

  static compute(inp: DemandInputs): { value: Record<DemandKind, number>; factors: Record<DemandKind, DemandFactor[]>; attraction: number } {
    const factors: Record<DemandKind, DemandFactor[]> = { residential: [], commercial: [], industrial: [], office: [] };
    const add = (k: DemandKind, label: string, v: number, detail?: string, tip?: string, fix?: DemandFix) => {
      if (Math.abs(v) < 0.5) return;
      const f: DemandFactor = { label, value: v };
      if (detail) f.detail = detail;
      // Advice only matters where something is holding demand back.
      if (v < 0 && tip) {
        f.tip = tip;
        if (fix) f.fix = fix;
      }
      factors[k].push(f);
    };
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const NAME: Record<DemandKind, string> = { residential: 'residential', commercial: 'commercial', industrial: 'industrial', office: 'office' };
    const tax = (k: DemandKind) =>
      add(k, 'Taxes', (9 - inp.taxes[k]) * 4.2, `${NAME[k][0].toUpperCase() + NAME[k].slice(1)} tax is ${inp.taxes[k]}% (9% is neutral)`, `Lower the ${NAME[k]} tax in the Budget. Each point below 9% adds demand.`, 'budget');
    const traffic = (k: DemandKind, over: number, w: number) =>
      add(k, 'Traffic', -Math.max(0, inp.congestion - over) * w, `Busy roads run at ${pct(inp.congestion)} of capacity on average`, 'Upgrade crowded streets to avenues, add a second route or run bus lines. The Traffic layer shows the red spots.', 'traffic');
    const noHighway = (k: DemandKind, v: number) =>
      add(k, 'No highway connection', v, 'No road links the city to the highway', 'Draw any road (a street works) from your streets back to the highway entry at the edge of the map. The road tool snaps to it when you get close.', 'roads');
    const shortage = (k: DemandKind, label: string, filled: number, jobs: number, v: number, fix: DemandFix) =>
      add(k, label, v, `Only ${formatInt(filled)} of ${formatInt(jobs)} ${NAME[k]} jobs are filled`, 'Zone more housing nearby, or connect homes and workplaces with roads and bus lines.', fix);

    const totalJobs = inp.jobs.commercial + inp.jobs.industrial + inp.jobs.office + inp.jobs.service;
    const openJobs = Math.max(0, totalJobs - inp.employed);
    const unemployed = Math.max(0, inp.workers - inp.employed);
    const unemployment = inp.workers > 0 ? unemployed / inp.workers : 0;

    // Residential
    if (!inp.connected) noHighway('residential', -200);
    else add('residential', 'Regional growth', 26, 'People in the region want to move to a growing town');
    add('residential', 'Available jobs', clamp(openJobs / Math.max(30, inp.workers * 0.4 + 15), 0, 1.6) * 42, `${formatInt(openJobs)} jobs are waiting for workers`);
    if (inp.workers > 30)
      add('residential', 'Unemployment', -Math.max(0, unemployment - 0.06) * 190, `${pct(unemployment)} of workers have no job (${formatInt(unemployed)} people)`, 'Create jobs: zone commercial or industrial land, or offices once unlocked.', 'zone-ind');
    // Vacancy (including homes still being built) slows new construction but
    // not move-ins; see `attraction`.
    // Small towns grow freely; large cities also count homes under construction
    // so whole districts don't spring up empty.
    const pendingWeight = clamp((inp.households - 300) / 3000, 0, 0.5);
    const supply = inp.housingCapacity + inp.pendingHousing * pendingWeight;
    if (supply > 24) {
      const vac = (supply - inp.households) / supply;
      add('residential', VACANCY, -Math.max(0, vac - 0.12) * 130, `${pct(Math.max(0, vac))} of homes are empty or still being built`, 'New homes wait until these fill. Create jobs and keep residents happy so people move in.', 'happiness');
    }
    if (inp.population > 300)
      add('residential', 'City services', (inp.serviceScore - 0.35) * 40, `Homes have ${pct(inp.serviceScore)} police, fire, health, school and garbage coverage on average`, 'Build services where the coverage layers show gaps, and raise their funding in the Budget if they are full.', 'services');
    if (inp.population > 100)
      add('residential', 'Happiness', (inp.happiness - 55) * 0.45, `Residents are ${Math.round(inp.happiness)}% happy (55% is neutral)`, 'Click unhappy homes to see why. Common causes are missing services, pollution, noise, traffic and high taxes.', 'happiness');
    tax('residential');
    traffic('residential', 0.75, 35);
    add('residential', 'Land value', (inp.avgLandValue - 0.35) * 25, `Average land value is ${pct(inp.avgLandValue)}`, 'Parks, plazas and good services raise land value. Keep industry and highways away from homes.', 'landValue');

    // Commercial
    const wantCom = inp.population * 0.11 + 4;
    const comRatio = wantCom / Math.max(8, inp.jobs.commercial);
    if (inp.population < 40) add('commercial', 'Too few residents', -10, `${formatInt(inp.population)} residents; shops open from about 40`, 'Grow the town first: zone housing along your streets.', 'zone-res');
    else
      add('commercial', 'Shoppers', clamp((comRatio - 0.9) * 60, -60, 80), `${formatInt(inp.population)} residents support about ${formatInt(wantCom)} shop jobs; there are ${formatInt(inp.jobs.commercial)}`, 'There are already enough shops for this many people. More residents will bring more shoppers.', 'zone-res');
    if (inp.jobs.commercial > 0 && inp.filled.commercial < inp.jobs.commercial * 0.7) shortage('commercial', 'Worker shortage', inp.filled.commercial, inp.jobs.commercial, -25, 'zone-res');
    tax('commercial');
    traffic('commercial', 0.8, 30);
    if (!inp.connected) noHighway('commercial', -60);
    if (inp.policy?.commercial) add('commercial', 'City policies', inp.policy.commercial, 'Your active policies change shop demand', 'Review your policies.', 'policies');
    if (inp.airport) add('commercial', 'Airport visitors', 8, 'Travellers spend money in town');
    if (inp.port) add('commercial', 'Imported goods', 4, 'The harbour stocks the shops');

    // Industrial
    if (inp.connected) add('industrial', 'Export markets', 18, 'The highway lets factories sell to the region');
    else noHighway('industrial', -80);
    if (inp.workers > 0) add('industrial', 'Available workers', clamp(unemployed / Math.max(20, inp.workers * 0.5), 0, 1.4) * 60, `${formatInt(unemployed)} residents are looking for work`);
    else add('industrial', 'Expected workforce', 14, 'Factories expect residents to move in');
    const goodsNeed = inp.jobs.commercial * 0.55 - inp.jobs.industrial;
    add('industrial', 'Shops need goods', clamp(goodsNeed / Math.max(25, inp.jobs.industrial), -1, 1.2) * 28,
      goodsNeed >= 0 ? `Shops want goods from about ${formatInt(goodsNeed)} more factory jobs` : `Factories already make more than the ${formatInt(inp.jobs.commercial)} shop jobs can sell`,
      'Industry is ahead of the shops. Zone commercial land so the goods have somewhere to go.', 'zone-com');
    if (inp.jobs.industrial > 0 && inp.filled.industrial < inp.jobs.industrial * 0.7) shortage('industrial', 'Worker shortage', inp.filled.industrial, inp.jobs.industrial, -30, 'zone-res');
    tax('industrial');
    if (inp.policy?.industrial) add('industrial', 'City policies', inp.policy.industrial, 'Your active policies change factory demand', 'Review your policies.', 'policies');
    if (inp.airport) add('industrial', 'Air cargo', 6, 'The airport flies goods out');
    if (inp.port) add('industrial', 'Sea freight', 12, 'The harbour ships goods by sea');

    // Office
    if (!inp.officeUnlocked) {
      add('office', 'Not yet unlocked', -100, `Offices unlock at ${formatInt(OFFICE_UNLOCK)} residents`, 'Keep growing the city; offices arrive with the 1,000-resident milestone.', 'zone-res');
    } else {
      const eduUnemployed = Math.max(0, inp.educatedWorkers - inp.educatedEmployed);
      const eduShare = inp.educatedWorkers / Math.max(1, inp.workers);
      add('office', 'Educated workers', clamp(eduUnemployed / Math.max(15, inp.educatedWorkers * 0.35), 0, 1.5) * 65, `${formatInt(eduUnemployed)} educated residents are looking for work`);
      // Offices only hire graduates, so say so when there are hardly any looking.
      if (eduUnemployed < 15) factors.office.push({ label: 'Few educated job seekers', value: 0, hint: true, detail: `${pct(eduShare)} of workers are educated, and nearly all have jobs`, ...(eduShare < 0.5
          ? { tip: 'Build schools near homes (and a university later) so more residents graduate.', fix: 'education' as const }
          : { tip: 'Your graduates already have jobs. Zone more housing so more of them move in, and keep schools covering the new homes.', fix: 'zone-res' as const }) });
      add('office', 'City size', Math.min(22, inp.population / 450), `${formatInt(inp.population)} residents attract businesses`);
      if (inp.jobs.office > 0 && inp.filled.office < inp.jobs.office * 0.7) shortage('office', 'Worker shortage', inp.filled.office, inp.jobs.office, -35, 'education');
      tax('office');
      add('office', 'Land value', (inp.avgLandValue - 0.4) * 30, `Average land value is ${pct(inp.avgLandValue)} (offices like 40% and up)`, 'Offices want valuable land: put them near parks, plazas and good services.', 'landValue');
      if (inp.airport) add('office', 'Airport connections', 10, 'Business travel through the airport');
      if (inp.university) add('office', 'University graduates', 9, 'The university supplies graduates');
    }

    const value = {} as Record<DemandKind, number>;
    for (const k of KINDS) {
      let v = 0;
      for (const f of factors[k]) v += f.value;
      factors[k].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
      value[k] = clamp(v, 0, 100);
    }
    let attraction = 0;
    for (const f of factors.residential) if (f.label !== VACANCY) attraction += f.value;
    return { value, factors, attraction: clamp(attraction, 0, 100) };
  }

  update(inp: DemandInputs, blend = 0.25): void {
    const r = Demand.compute(inp);
    for (const k of KINDS) {
      this.value[k] = lerp(this.value[k], r.value[k], blend);
      this.factors[k] = r.factors[k];
    }
    this.attraction = lerp(this.attraction, r.attraction, blend);
  }
}
