import type { City } from '../City';
import { SERVICE_BY_ID } from '../services/ServiceTypes';
import { BuildingState, Zone, isResidential, zoneBase } from '../types';
import { type FieldId, type FunctionKind, isLiveField } from './Knowledge';

/**
 * City briefs: the problems the city is facing right now, put to its
 * scientists. A brief names the field it calls for, how pressing it is and,
 * where it has one, the place it is worst ("the north-eastern neighbourhoods").
 * Proposals that answer a brief come with a council grant.
 */
export interface Brief {
  field: FieldId;
  /** 0–1: how pressing. */
  severity: number;
  title: string;
  text: string;
  /** Where it is worst, if it has a place. */
  x?: number;
  z?: number;
  /** Share of the start cost the council pays for work that answers it. */
  grant: number;
}

/** A place a pilot facility could be field-tested. */
export interface TrialSite {
  label: string;
  detail: string;
  x: number;
  z: number;
  /** 0–1: how well the site tests this kind of facility. */
  fit: number;
}

const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];

/** The city's centre of gravity (where its buildings are). */
export function cityCentre(city: City): { x: number; z: number } {
  let sx = 0, sz = 0, n = 0;
  for (const b of city.buildings.all.values()) {
    sx += b.cx;
    sz += b.cz;
    n++;
  }
  return n ? { x: sx / n, z: sz / n } : { x: city.startPoint.x, z: city.startPoint.z };
}

/** "the Harbour district", "the north-east of the city" or "the city centre". */
export function describePlace(city: City, x: number, z: number): string {
  const d = city.districts.at(x, z);
  const named = d ? city.districts.list.get(d)?.name : undefined;
  if (named) return named;
  const c = cityCentre(city);
  const dx = x - c.x, dz = z - c.z;
  if (Math.hypot(dx, dz) < 250) return 'the city centre';
  // +x is east and +z is south on the map.
  const a = Math.atan2(dz, dx);
  const k = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return `the ${COMPASS[k]} of the city`;
}

/** The residential building where `score` is highest (sampled for speed). */
function worstHome(city: City, score: (x: number, z: number) => number): { x: number; z: number; v: number } | null {
  let best: { x: number; z: number; v: number } | null = null;
  let n = 0;
  for (const b of city.buildings.all.values()) {
    if (b.kind !== 'zoned' || !isResidential(b.zone) || b.state !== BuildingState.Active) continue;
    if (++n % 3) continue;
    const v = score(b.cx, b.cz);
    if (!best || v > best.v) best = { x: b.cx, z: b.cz, v };
    if (n > 3000) break;
  }
  return best;
}

/** The city's pressing problems, most pressing first. */
export function cityBriefs(city: City, needs: Partial<Record<FieldId, number>>): Brief[] {
  const out: Brief[] = [];
  const u = city.utilities.totals;
  const add = (b: Omit<Brief, 'grant'>) => {
    if (b.severity >= 0.45) out.push({ ...b, grant: b.severity > 0.75 ? 0.4 : 0.25 });
  };
  if ((needs.energy ?? 0) > 0) {
    const none = u.power.production <= 0;
    add({
      field: 'energy', severity: needs.energy ?? 0, title: u.power.shortfall > 0 ? 'Blackouts' : none ? 'No power supply' : 'Power running short',
      text: u.power.shortfall > 0 ? `The city is ${Math.ceil(u.power.shortfall)} MW short of power: homes and businesses go dark.` : none ? 'The city has no power plant yet.' : `Only ${Math.max(0, Math.round(u.power.production - u.power.consumption))} MW of power to spare.`,
    });
  }
  if ((needs.water ?? 0) > 0) {
    const sew = u.sewage.shortfall > 0;
    const none = u.water.production <= 0;
    add({
      field: 'water', severity: needs.water ?? 0, title: sew ? 'Sewage backing up' : u.water.shortfall > 0 ? 'Taps running dry' : none ? 'No clean water' : 'Water running short',
      text: sew ? 'There is more wastewater than the city can treat.' : u.water.shortfall > 0 ? `The city is ${Math.ceil(u.water.shortfall).toLocaleString('en-US')} m³ a day short of clean water.` : none ? 'The city has no clean water supply yet.' : 'Demand for clean water is close to what the city can supply.',
    });
  }
  if ((needs.environment ?? 0) > 0) {
    const w = worstHome(city, (x, z) => city.landValue.pollutionAt(x, z));
    if (w) add({ field: 'environment', severity: needs.environment ?? 0, title: 'Smog over homes', text: `Homes in ${describePlace(city, w.x, w.z)} are choking on smog (pollution ${Math.round(w.v * 100)}%).`, x: w.x, z: w.z });
  }
  if ((needs.medicine ?? 0) > 0) {
    const w = worstHome(city, (x, z) => 1 - city.coverage.at('health', x, z));
    if (w) add({ field: 'medicine', severity: needs.medicine ?? 0, title: 'Patients far from care', text: `Residents in ${describePlace(city, w.x, w.z)} live far from any clinic.`, x: w.x, z: w.z });
  }
  if ((needs.transport ?? 0) > 0) {
    let worst = -1, wx = 0, wz = 0;
    for (const s of city.roads.segments.values()) {
      const r = city.traffic.ratio(s.id);
      if (r > worst) {
        worst = r;
        wx = s.cx;
        wz = s.cz;
      }
    }
    add({ field: 'transport', severity: needs.transport ?? 0, title: 'Gridlock', text: `Commutes average ${Math.round(city.traffic.avgTripMinutes)} minutes; the worst jams are in ${describePlace(city, wx, wz)}.`, ...(worst > 0 ? { x: wx, z: wz } : {}) });
  }
  if ((needs.agriculture ?? 0) > 0) add({ field: 'agriculture', severity: needs.agriculture ?? 0, title: 'Unhappy residents', text: `Happiness is down to ${Math.round(city.stats.happiness)}%: people want fresher food and greener streets.` });
  if ((needs.materials ?? 0) > 0.5) add({ field: 'materials', severity: needs.materials ?? 0, title: 'A tight budget', text: 'Money is short: cheaper ways to build would help.' });
  // Research answers the city's utility needs; the rest is for the Design Studio and the mayor.
  return out.filter((b) => isLiveField(b.field)).sort((a, b) => b.severity - a.severity);
}

/**
 * Places a pilot facility of this kind could be field-tested: by the centre,
 * and where the facility would matter most. The fit says how much a test
 * there would teach.
 */
export function trialSites(city: City, fn: FunctionKind, centre: { x: number; z: number }): TrialSite[] {
  const sites: TrialSite[] = [];
  const homesNear = (x: number, z: number, r = 300) => city.buildings.queryRadius(x, z, r).filter((b) => b.kind === 'zoned' && isResidential(b.zone)).length;
  const where = (x: number, z: number) => describePlace(city, x, z);
  const push = (s: TrialSite) => {
    if (!sites.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < 120)) sites.push(s);
  };
  switch (fn) {
    case 'scrubber': {
      const w = worstHome(city, (x, z) => city.landValue.pollutionAt(x, z));
      if (w) push({ label: `Beside the smog in ${where(w.x, w.z)}`, detail: `Pollution there is ${Math.round(w.v * 100)}%: a hard, telling test.`, x: w.x, z: w.z, fit: Math.min(1, 0.4 + w.v * 1.5) });
      break;
    }
    case 'clinic':
    case 'school': {
      const kind = fn === 'clinic' ? 'health' : 'education';
      const w = worstHome(city, (x, z) => 1 - city.coverage.at(kind, x, z));
      if (w) push({ label: `Among homes in ${where(w.x, w.z)}`, detail: `Few residents there are served today: real patients and pupils from day one.`, x: w.x, z: w.z, fit: Math.min(1, 0.35 + w.v * 0.6) });
      break;
    }
    case 'water':
    case 'sewage': {
      let best: { x: number; z: number; d: number } | null = null;
      for (const b of city.buildings.all.values()) {
        if (b.kind !== 'zoned') continue;
        const d = city.terrain.shoreDistanceAt(b.cx, b.cz);
        if (!best || d < best.d) best = { x: b.cx, z: b.cz, d };
      }
      if (best) push({ label: `By the water in ${where(best.x, best.z)}`, detail: 'Real intake and outflow conditions.', x: best.x, z: best.z, fit: best.d < 200 ? 0.85 : 0.55 });
      break;
    }
    case 'waste':
    case 'powerGen':
    case 'storage': {
      // The heaviest users: the largest cluster of industry, or the busiest services.
      let best: { x: number; z: number; n: number } | null = null;
      let k = 0;
      for (const b of city.buildings.all.values()) {
        const ind = b.kind === 'zoned' && zoneBase(b.zone) === Zone.Industrial;
        const util = b.kind === 'service' && (SERVICE_BY_ID.get(b.typeId)?.kind === (fn === 'waste' ? 'garbage' : 'power'));
        if (!ind && !util) continue;
        if (++k % 2) continue;
        const n = city.buildings.queryRadius(b.cx, b.cz, 300).length;
        if (!best || n > best.n) best = { x: b.cx, z: b.cz, n };
      }
      if (best) push({ label: `In the busy district of ${where(best.x, best.z)}`, detail: `${best.n} buildings nearby draw on it: real loads, real wear.`, x: best.x, z: best.z, fit: Math.min(1, 0.4 + best.n / 120) });
      break;
    }
    case 'farm':
    case 'civic': {
      let best: { x: number; z: number; v: number } | null = null;
      for (const b of city.buildings.all.values()) {
        if (b.kind !== 'zoned') continue;
        const v = fn === 'civic' ? city.landValue.at(b.cx, b.cz) : homesNear(b.cx, b.cz, 250) / 60;
        if (!best || v > best.v) best = { x: b.cx, z: b.cz, v };
      }
      if (best) push({ label: `In ${where(best.x, best.z)}`, detail: fn === 'civic' ? 'The most sought-after streets in the city: a demanding audience.' : 'Dense homes all around: plenty of people to try it.', x: best.x, z: best.z, fit: Math.min(1, 0.45 + best.v * 0.5) });
      break;
    }
  }
  push({ label: 'On the centre’s own grounds', detail: 'Easy to watch and adjust, but conditions are tame.', x: centre.x, z: centre.z, fit: 0.3 });
  return sites.slice(0, 3);
}
