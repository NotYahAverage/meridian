import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/City';
import { placeService } from '../src/sim/CityCommands';
import { fastForward, landValueMods } from '../src/sim/CitySim';
import { describePlace } from '../src/sim/research/Briefs';
import { type CivState, type Plan, decisionFor, generateProposals, makeDiscovery } from '../src/sim/research/Generate';
import { PRINCIPLE_BY_ID, RESOURCES } from '../src/sim/research/Knowledge';
import { MILESTONES } from '../src/sim/research/Progress';
import { AUTO_DECIDE_DAYS, type Center, ITERATE_AFTER_DAYS } from '../src/sim/research/Research';
import { deserializeCity, serializeCity } from '../src/sim/save/Serializer';
import { SERVICE_BY_ID } from '../src/sim/services/ServiceTypes';
import { servicedGrid } from './helpers';

/** A serviced town with spare power, a coal plant and two operating research centres. */
function twoLabs(civSeed: number) {
  const city = new City({ name: 'Labs', seed: 1234, preset: 'lakes', flatTerrain: 10, civSeed });
  city.economy.money = 5_000_000;
  servicedGrid(city);
  city.peakPopulation = 5000;
  const sp = city.terrain.spawn;
  const coal = placeService(city, 'coal_plant', sp.endX + 150, sp.endZ - 60);
  if (!coal.ok) throw new Error(coal.error);
  const a = placeService(city, 'research_center', sp.endX + 250, sp.endZ - 60);
  const b = placeService(city, 'research_center', sp.endX + 360, sp.endZ - 60);
  if (!a.ok || !b.ok) throw new Error(a.error ?? b.error);
  fastForward(city, 24 * 10);
  const r = city.research;
  return { city, a: r.centers.get(a.building!.id)!, b: r.centers.get(b.building!.id)!, coal: coal.building! };
}

const allResources = () => new Map(RESOURCES.map((r) => [r.id, { ok: true }]));
const civ = (seed: number, extra: Partial<CivState> = {}): CivState => ({ civSeed: seed, day: 1, tags: new Set(), discoveries: [], achieved: new Set(), insights: new Map(), components: [], ...extra });
const info = { id: 1, name: 'Lab', field: 'energy' as const, secondary: ['environment', 'materials'] as ('environment' | 'materials')[], equipment: 2 };

/** Steps a running experiment day by day, answering each decision with `choose`. */
function runTo(city: City, c: Center, choose: (ids: string[]) => string, stopAt?: (c: Center) => boolean) {
  for (let d = 0; d < 150 && c.active; d++) {
    fastForward(city, 24);
    const p = c.active?.pending;
    if (p) {
      if (stopAt?.(c)) return;
      expect(city.research.decide(c.id, choose(p.options.map((o) => o.id))).ok).toBe(true);
    }
  }
}

describe('city briefs', () => {
  it('put the city’s problems to its scientists: proposals that answer one get a council grant', () => {
    const brief = { field: 'energy' as const, severity: 0.9, title: 'Blackouts', text: 'The city is 40 MW short of power.', grant: 0.4 };
    let id = 0;
    const plain = generateProposals(civ(3), info, { resources: allResources(), needs: {}, followups: [] }, 1, () => `a${id++}`);
    id = 0;
    const briefed = generateProposals(civ(3), info, { resources: allResources(), needs: {}, followups: [], briefs: [brief] }, 1, () => `a${id++}`);
    const answer = briefed.find((p) => p.brief);
    expect(answer).toBeTruthy();
    expect(answer!.field).toBe('energy');
    expect(answer!.grant).toBeGreaterThan(0);
    expect(answer!.clues[0]).toContain('city brief');
    // The same plan without the brief costs the grant more.
    const same = plain.find((p) => p.principle === answer!.principle && p.resource === answer!.resource);
    if (same) expect(same.cost).toBe(answer!.cost + answer!.grant!);
    // A brief is answered, but by no more than two proposals, so the list stays varied.
    const answers = briefed.filter((p) => p.brief).length;
    expect(answers).toBeGreaterThanOrEqual(1);
    expect(answers).toBeLessThanOrEqual(2);
  });

  it('name places the way a player would', () => {
    const { city } = twoLabs(4);
    const c = { x: 0, z: 0 };
    let n = 0;
    for (const b of city.buildings.all.values()) {
      c.x += b.cx;
      c.z += b.cz;
      n++;
    }
    c.x /= n;
    c.z /= n;
    expect(describePlace(city, c.x, c.z)).toBe('the city centre');
    expect(describePlace(city, c.x + 1500, c.z)).toBe('the east of the city');
    expect(describePlace(city, c.x, c.z - 1500)).toBe('the north of the city');
  });
});

describe('running research', () => {
  it('the budget trades speed against running cost', () => {
    const { city, a } = twoLabs(5);
    const r = city.research;
    expect(r.start(a.id, a.offers[0].id).ok).toBe(true);
    const normal = r.speedOf(a);
    const cost = r.monthlyCost();
    r.setFunding(2);
    expect(r.speedOf(a)).toBeGreaterThan(normal * 1.4);
    expect(r.monthlyCost()).toBe(Math.round(cost * 2));
    r.setFunding(0.1);
    expect(r.funding).toBe(0.5);
    expect(r.speedOf(a)).toBeLessThan(normal);
  });

  it('pilot facilities get a field trial at a real site, chosen by the player', () => {
    const { city, a } = twoLabs(6);
    const r = city.research;
    const plan = a.offers.find((p) => PRINCIPLE_BY_ID.get(p.principle)?.build);
    expect(plan).toBeTruthy();
    r.start(a.id, plan!.id);
    runTo(city, a, (ids) => (ids.includes('apply') ? 'apply' : ids[0]), (c) => c.active!.pending!.stage === 2);
    const d = a.active!.pending!;
    expect(d.stage).toBe(2);
    const sites = d.options.filter((o) => o.site);
    expect(sites.length).toBeGreaterThanOrEqual(1);
    expect(d.options.at(-1)!.id).toBe('lab');
    // A demanding site teaches more than the lab.
    expect(sites[0].quality).toBeGreaterThan(d.options.at(-1)!.quality);
    r.decide(a.id, sites[0].id);
    expect(a.active!.choices.at(-1)!.option!.site).toEqual(sites[0].site);
  });

  it('sharing the findings early ends the work now, never as a breakthrough, and leaves a follow-up', () => {
    const { city, a } = twoLabs(7);
    const r = city.research;
    r.start(a.id, a.offers[0].id);
    runTo(city, a, (ids) => (ids.includes('publish') ? 'publish' : ids.includes('safe') ? 'safe' : ids.at(-1)!));
    expect(a.active).toBeNull();
    const rec = r.records.at(-1)!;
    expect(rec.outcome).not.toBe('breakthrough');
    expect(rec.decisions.at(-1)).toBe('Share the findings now');
  });

  it('a decision left waiting can be taken by the team, if the player allows it', () => {
    const { city, a } = twoLabs(8);
    const r = city.research;
    r.start(a.id, a.offers[0].id);
    for (let d = 0; d < 40 && !a.active?.pending; d++) fastForward(city, 24);
    expect(a.active?.pending).toBeTruthy();
    fastForward(city, 24 * (AUTO_DECIDE_DAYS + 1));
    // Waiting is the default.
    expect(a.active?.pending).toBeTruthy();
    r.autoDecide = true;
    fastForward(city, 24 * 2);
    expect(a.active?.choices.length).toBe(1);
    expect(city.notifications.recent.some((n) => n.title === 'Decided for you')).toBe(true);
  });

  it('two centres can run an experiment together: better odds, faster work, and both gain experience', () => {
    const { city, a, b } = twoLabs(9);
    const r = city.research;
    const plan = a.offers[0];
    const alone = r.oddsFor(a, plan).chance;
    expect(r.partnersFor(a)).toContain(b);
    expect(r.oddsFor(a, plan, [], b.id).chance).toBeGreaterThan(alone);
    expect(r.start(a.id, plan.id, b.id).ok).toBe(true);
    expect(b.assisting).toBe(a.id);
    // The partner is busy: it can't start its own work.
    expect(r.start(b.id, b.offers[0].id).ok).toBe(false);
    expect(r.oddsFor(a, plan).factors.some(([k]) => k.startsWith('Joint team'))).toBe(true);
    runTo(city, a, (ids) => ids.at(-1)!);
    expect(b.assisting).toBeUndefined();
    expect(a.mastery?.[plan.field]).toBeGreaterThan(0);
    expect(b.mastery?.[plan.field]).toBeGreaterThan(0);
    expect(r.records.at(-1)!.partner).toBe(b.name);
  });
});

describe('long-term goals', () => {
  it('milestones pay out their rewards once', () => {
    const { city } = twoLabs(10);
    const r = city.research;
    const p = PRINCIPLE_BY_ID.get('superconduct')!;
    const plan: Plan = { id: 'm1', centerId: 1, title: '', summary: '', field: p.field, principle: p.id, resource: 'copper', basis: [], kind: 'study', cost: 1, monthly: 1, days: 1, power: 0, risk: 0, prospects: [], clues: [] };
    const money = city.economy.money;
    r.adopt(makeDiscovery(r.civ(), plan, { outcome: 'success', quality: 0.7, chance: 0.7, direction: 'refine', field: p.field, principle: p.id }, info, r.nextIds()));
    r.checkMilestones();
    expect(r.milestones.has('first')).toBe(true);
    expect(city.economy.money).toBe(money + 15_000);
    r.checkMilestones();
    expect(city.economy.money).toBe(money + 15_000);
    expect(MILESTONES.length).toBeGreaterThan(9);
  });

  it('retrofits bring a discovery to the buildings the city already has', () => {
    const { city, coal } = twoLabs(11);
    const r = city.research;
    const p = PRINCIPLE_BY_ID.get('capture')!;
    const plan: Plan = { id: 'rf', centerId: 1, title: '', summary: '', field: p.field, principle: p.id, resource: 'peat', basis: [], kind: 'study', cost: 1, monthly: 1, days: 1, power: 0, risk: 0, prospects: [], clues: [] };
    r.adopt(makeDiscovery(r.civ(), plan, { outcome: 'success', quality: 0.6, chance: 0.7, direction: 'refine', field: p.field, principle: p.id }, info, r.nextIds()));
    const offer = r.retrofitOffers().find((o) => o.target === 'power' && o.what === 'pollution');
    expect(offer).toBeTruthy();
    expect(offer!.buildings).toBe(1);
    const before = landValueMods(city).pollution(coal);
    const money = city.economy.money;
    expect(r.applyRetrofit(offer!.id).ok).toBe(true);
    expect(city.economy.money).toBe(money - offer!.cost);
    expect(landValueMods(city).pollution(coal)).toBeLessThan(before * 0.85);
    expect(r.applyRetrofit(offer!.id).ok).toBe(false);
    expect(r.milestones.has('retrofit')).toBe(true);
  });

  it('a design in service can be developed into its next version', () => {
    const { city, a } = twoLabs(12);
    const r = city.research;
    const p = PRINCIPLE_BY_ID.get('combustion')!;
    const plan: Plan = { id: 'it1', centerId: a.id, title: '', summary: '', field: 'energy', principle: p.id, resource: 'peat', basis: [], kind: 'study', cost: 1, monthly: 1, days: 1, power: 0, risk: 0, prospects: [], clues: [] };
    const first = makeDiscovery(r.civ(), plan, { outcome: 'success', quality: 0.5, chance: 0.7, direction: 'apply', field: 'energy', principle: p.id }, info, r.nextIds());
    r.adopt(first);
    const design = first.design!;
    expect(r.iterationsReady()).toHaveLength(0);
    design.builtDay = city.clock.day - ITERATE_AFTER_DAYS;
    const ready = r.iterationsReady();
    expect(ready).toEqual([{ discovery: first.discovery.id, version: 1 }]);
    let id = 0;
    const plans = generateProposals(r.civ(), { ...info, field: 'energy' }, { resources: allResources(), needs: {}, followups: [], iterations: ready }, 1, () => `i${id++}`);
    const iter = plans.find((x) => x.kind === 'iteration');
    expect(iter).toBeTruthy();
    expect(decisionFor(r.civSeed, iter!, 0).options[0].id).toBe('apply');
    const next = makeDiscovery(r.civ(), iter!, { outcome: 'success', quality: 0.6, chance: 0.7, direction: 'apply', field: 'energy', principle: p.id }, info, r.nextIds());
    expect(next.design!.version).toBe(2);
    expect(next.design!.lineage).toBe(design.id);
    expect(next.design!.name).toMatch(/Mk II$/);
    expect(next.design!.stats.output).toBeGreaterThanOrEqual(design.stats.output);
  });

  it('designs can be renamed, keeping their mark, and the build menu follows', () => {
    const { city, a } = twoLabs(13);
    const r = city.research;
    const p = PRINCIPLE_BY_ID.get('combustion')!;
    const plan: Plan = { id: 'n1', centerId: a.id, title: '', summary: '', field: 'energy', principle: p.id, resource: 'peat', basis: [], kind: 'study', cost: 1, monthly: 1, days: 1, power: 0, risk: 0, prospects: [], clues: [] };
    const made = makeDiscovery(r.civ(), plan, { outcome: 'success', quality: 0.5, chance: 0.7, direction: 'apply', field: 'energy', principle: p.id }, info, r.nextIds());
    r.adopt(made);
    const d = made.design!;
    d.name = `${d.name} Mk II`;
    expect(r.renameDesign(d.id, '  Sunrise   Works ')).toBe(true);
    expect(d.name).toBe('Sunrise Works Mk II');
    expect(SERVICE_BY_ID.get(d.serviceId)!.name).toBe('Sunrise Works Mk II');
    expect(r.discoveries.find((x) => x.id === d.discoveryId)!.name).toBe('Sunrise Works Mk II');
    expect(r.renameDesign(d.id, '   ')).toBe(false);
  });

  it('utility discoveries make new policies possible; others unlock with the city or its architects', () => {
    const { city } = twoLabs(14);
    const pol = city.policies;
    // A water discovery opens water metering.
    if (!city.research.discoveries.some((d) => d.field === 'water')) {
      expect(pol.lockReason('waterMetering')).toContain('water');
      expect(pol.set('waterMetering', true)).toBe(false);
      const p = PRINCIPLE_BY_ID.get('conservation')!;
      const plan: Plan = { id: 'wm', centerId: 1, title: '', summary: '', field: 'water', principle: p.id, resource: 'groundwater', basis: [], kind: 'study', cost: 1, monthly: 1, days: 1, power: 0, risk: 0, prospects: [], clues: [] };
      city.research.adopt(makeDiscovery(city.research.civ(), plan, { outcome: 'success', quality: 0.3, chance: 0.7, direction: 'theory', field: 'water', principle: p.id }, info, city.research.nextIds()));
    }
    expect(pol.lockReason('waterMetering')).toBeUndefined();
    // Congestion pricing no longer waits for transport research: it comes with a bigger city.
    expect(pol.lockReason('congestionPricing')).toBeUndefined();
    const cap = city.research.mods.roadCapacity;
    expect(pol.set('congestionPricing', true)).toBe(true);
    expect(city.research.mods.roadCapacity).toBeGreaterThan(cap);
    pol.set('congestionPricing', false);
    expect(city.research.mods.roadCapacity).toBeCloseTo(cap, 6);
    // The green building code comes from the Design Studio.
    expect(pol.lockReason('greenBuildingCode')).toContain('Design Studio');
  });

  it('everything new is saved and restored exactly', () => {
    const { city, a, b } = twoLabs(15);
    const r = city.research;
    r.setFunding(1.5);
    r.autoDecide = true;
    r.dismissGuide();
    r.start(a.id, a.offers[0].id, b.id);
    fastForward(city, 24 * 5);
    const again = deserializeCity(JSON.parse(JSON.stringify(serializeCity(city))), { flatTerrain: 10 });
    expect(JSON.stringify(again.research.serialize())).toBe(JSON.stringify(r.serialize()));
    expect(again.research.funding).toBe(1.5);
    expect(again.research.autoDecide).toBe(true);
    expect(again.research.guideDone).toBe(true);
    expect(again.research.centers.get(b.id)!.assisting).toBe(a.id);
  });
});
