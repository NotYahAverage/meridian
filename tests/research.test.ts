import { describe, expect, it } from 'vitest';
import { City } from '../src/sim/City';
import { bulldozeBuilding, fillZone, placeService } from '../src/sim/CityCommands';
import { fastForward, projectEconomy } from '../src/sim/CitySim';
import { composeArch, labArch, validateArch } from '../src/sim/research/Architecture';
import { type CivState, type Plan, decisionFor, generateProposals, makeDiscovery, odds, resolve } from '../src/sim/research/Generate';
import { FIELDS, type FunctionKind, PRINCIPLES, PRINCIPLE_BY_ID, RESOURCES, RESOURCE_BY_ID, fit } from '../src/sim/research/Knowledge';
import type { Center } from '../src/sim/research/Research';
import { deserializeCity, serializeCity } from '../src/sim/save/Serializer';
import { SERVICE_BY_ID } from '../src/sim/services/ServiceTypes';
import { BuildingState, Zone } from '../src/sim/types';
import { servicedGrid } from './helpers';

/** A serviced test town with spare power and an operating research centre. */
function labCity(civSeed: number) {
  const city = new City({ name: 'Lab', seed: 1234, preset: 'lakes', flatTerrain: 10, civSeed });
  city.economy.money = 3_000_000;
  servicedGrid(city);
  city.peakPopulation = 5000;
  const sp = city.terrain.spawn;
  const coal = placeService(city, 'coal_plant', sp.endX + 150, sp.endZ - 60);
  if (!coal.ok) throw new Error(coal.error);
  const before = city.economy.money;
  const lab = placeService(city, 'research_center', sp.endX + 250, sp.endZ - 60);
  if (!lab.ok) throw new Error(lab.error);
  const paid = before - city.economy.money;
  fastForward(city, 24 * 10);
  const centre = city.research.centers.get(lab.building!.id)!;
  return { city, centre, paid, building: lab.building! };
}

/** Runs one experiment to the end: `choose` picks an option at each decision. */
function run(city: City, c: Center, plan: Plan, choose: (opts: string[]) => number) {
  const r = city.research;
  const res = r.start(c.id, plan.id);
  if (!res.ok) throw new Error(res.error);
  for (let d = 0; d < 120 && c.active; d++) {
    fastForward(city, 24);
    const p = c.active?.pending;
    if (p) expect(r.decide(c.id, p.options[choose(p.options.map((o) => o.id))].id).ok).toBe(true);
  }
  expect(c.active).toBeNull();
  return r.records.at(-1)!;
}

/** Prefers pilot facilities and careful work until a building is designed. */
function runUntilDesign(city: City, c: Center, max = 12): string | null {
  for (let k = 0; k < max; k++) {
    if (city.research.designs.size) break;
    const plan = c.offers.find((p) => PRINCIPLE_BY_ID.get(p.principle)?.build) ?? c.offers[0];
    if (!plan) break;
    run(city, c, plan, (ids) => (ids.includes('apply') ? ids.indexOf('apply') : ids.indexOf('safe') >= 0 ? ids.indexOf('safe') : ids.length - 1));
  }
  return [...city.research.designs.values()][0]?.serviceId ?? null;
}

function civ(seed: number, extra: Partial<CivState> = {}): CivState {
  return { civSeed: seed, day: 1, tags: new Set(), discoveries: [], achieved: new Set(), insights: new Map(), components: [], ...extra };
}

const allResources = () => new Map(RESOURCES.map((r) => [r.id, { ok: true }]));

describe('research centres', () => {
  it('are real buildings: they cost money, are paid for monthly and take an identity from their site', () => {
    const { city, centre, paid, building } = labCity(11);
    expect(paid).toBe(SERVICE_BY_ID.get('research_center')!.cost);
    projectEconomy(city);
    expect(city.economy.projection.expense.Research).toBeGreaterThanOrEqual(SERVICE_BY_ID.get('research_center')!.upkeep);
    expect(centre.name.length).toBeGreaterThan(5);
    expect(centre.secondary).toHaveLength(2);
    expect(centre.factors.length).toBeGreaterThan(0);
    // Next to a coal plant and two wind turbines, energy is the obvious calling.
    expect(centre.factors.some((f) => f.field === 'energy')).toBe(true);
    expect(building.style).toBe(`lab:${centre.field}`);
    expect(city.research.operational(centre).ok).toBe(true);
    expect(centre.offers.length).toBeGreaterThanOrEqual(3);
  });

  it('upgrading equipment costs money, changes the building and widens the proposals', () => {
    const { city, centre, building } = labCity(12);
    const money = city.economy.money;
    const n = centre.offers.length;
    expect(city.research.upgrade(centre.id).ok).toBe(true);
    expect(city.economy.money).toBe(money - 40_000);
    expect(centre.equipment).toBe(2);
    expect(building.level).toBe(2);
    expect(centre.offers.length).toBeGreaterThanOrEqual(n);
  });
});

describe('experiments', () => {
  it('are proposed from the context: known methods, reachable substances and pressing needs', () => {
    const { city, centre } = labCity(13);
    const reach = city.research.resourcesFor(centre);
    const fields = [centre.field, ...centre.secondary];
    for (const p of centre.offers) {
      const pr = PRINCIPLE_BY_ID.get(p.principle)!;
      expect(fields).toContain(p.field);
      expect(reach.get(p.resource)?.ok).toBe(true);
      expect(pr.needs ?? []).toEqual([]);
      expect(fit(pr, RESOURCE_BY_ID.get(p.resource)!)).toBeGreaterThanOrEqual(0.3);
    }
    // A city short of water gets more water research than one that isn't.
    // Water is only a side line for this centre, so need is what brings it forward.
    const centreInfo = { id: 1, name: 'X', field: 'energy' as const, secondary: ['water', 'environment'] as ('water' | 'environment')[], equipment: 1 };
    let id = 0;
    const count = (need: number) => {
      let n = 0;
      for (let round = 1; round <= 12; round++) {
        n += generateProposals(civ(5), centreInfo, { resources: allResources(), needs: { water: need }, followups: [] }, round, () => `t${id++}`).filter((p) => p.field === 'water').length;
      }
      return n;
    };
    expect(count(1)).toBeGreaterThan(count(0));
  });

  it('player decisions shape the result: the approach decides what kind of discovery it is, care trades quality for safety', () => {
    const p = PRINCIPLE_BY_ID.get('cells')!;
    const plan: Plan = { id: 'x1', centerId: 1, title: '', summary: '', field: p.field, principle: p.id, resource: 'copper', basis: [], kind: 'study', cost: 10_000, monthly: 1_000, days: 15, power: 1, risk: 0.2, prospects: [], clues: [] };
    const info = { id: 1, name: 'Lab', field: 'energy' as const, secondary: [], equipment: 2 };
    const c = civ(77);
    const stage0 = decisionFor(77, plan, 0);
    const stage1 = decisionFor(77, plan, 1);
    expect(stage0.options.map((o) => o.id)).toEqual(['apply', 'refine', 'theory']);
    const pick = (stage: number, id: string) => ({ stage, option: (stage ? stage1 : stage0).options.find((o) => o.id === id)! });
    // Pushing hard is riskier than playing it safe.
    expect(odds(plan, [pick(0, 'apply'), pick(1, 'push')], info, c, 0).chance).toBeLessThan(odds(plan, [pick(0, 'theory'), pick(1, 'safe')], info, c, 0).chance);
    const kinds = new Set<string>();
    for (const [a, b] of [['apply', 'safe'], ['refine', 'safe'], ['theory', 'safe']]) {
      const res = resolve(c, plan, [pick(0, a), pick(1, b)], info, 0.5);
      if (res.outcome === 'failure') continue;
      kinds.add(makeDiscovery(c, plan, res, info, { discovery: `d-${a}`, design: `g-${a}`, serviceId: `t-${a}` }).discovery.kind);
    }
    expect(kinds.size).toBeGreaterThanOrEqual(2);
    // Same plan and decisions: same result, every time.
    const once = resolve(c, plan, [pick(0, 'apply'), pick(1, 'push')], info, 0.5);
    expect(resolve(c, plan, [pick(0, 'apply'), pick(1, 'push')], info, 0.5)).toEqual(once);
  });

  it('run in the city: charge once to start, pause for decisions, and end in a recorded result', () => {
    const { city, centre } = labCity(14);
    const plan = centre.offers[0];
    const money = city.economy.money;
    expect(city.research.start(centre.id, plan.id).ok).toBe(true);
    expect(city.economy.money).toBe(money - plan.cost);
    expect(city.research.monthlyCost()).toBe(plan.monthly);
    let paused = 0;
    for (let d = 0; d < 120 && centre.active; d++) {
      fastForward(city, 24);
      if (centre.active?.pending) {
        const at = centre.active.progress;
        fastForward(city, 24 * 3);
        // No decision, no progress.
        expect(centre.active.progress).toBe(at);
        paused++;
        city.research.decide(centre.id, centre.active.pending.options.at(-1)!.id);
      }
    }
    expect(paused).toBe(2);
    const rec = city.research.records.at(-1)!;
    expect(rec.decisions).toHaveLength(2);
    expect(['breakthrough', 'success', 'partial', 'unexpected', 'failure']).toContain(rec.outcome);
    expect(city.research.monthlyCost()).toBe(0);
    // A new set of proposals is ready.
    expect(centre.offers.length).toBeGreaterThan(0);
  });

  it('failures are useful: they make the method safer and point to a better substance', () => {
    const { city, centre } = labCity(15);
    const plan = { ...centre.offers[0], risk: 5 };
    centre.offers[0] = plan;
    const before = city.research.insights.get(plan.principle) ?? 0;
    const rec = run(city, centre, plan, (ids) => ids.length - 1);
    expect(rec.outcome).toBe('failure');
    expect(rec.insight).toBeTruthy();
    expect(city.research.insights.get(plan.principle)).toBe(before + 1);
    expect(city.research.discoveries).toHaveLength(0);
    // The next proposals for that method are less risky.
    const again = centre.offers.find((p) => p.principle === plan.principle);
    if (again) expect(again.risk).toBeLessThan(PRINCIPLE_BY_ID.get(plan.principle)!.difficulty * 0.4 + 0.12);
  });

  it('interrupted experiments stop cleanly: nothing more is charged and the save stays sound', () => {
    const { city, centre, building } = labCity(16);
    const plan = centre.offers[0];
    city.research.start(centre.id, plan.id);
    fastForward(city, 24 * 3);
    bulldozeBuilding(city, building.id);
    expect(city.research.centers.size).toBe(0);
    expect(city.research.monthlyCost()).toBe(0);
    expect(city.research.records.at(-1)!.outcome).toBe('interrupted');
    const again = deserializeCity(serializeCity(city), { flatTerrain: 10 });
    expect(again.research.records.at(-1)!.outcome).toBe('interrupted');
    expect(again.research.centers.size).toBe(0);
    fastForward(again, 24 * 5);
  });
});

describe('discoveries', () => {
  it('change how the city works', () => {
    const { city } = labCity(17);
    const sp = city.terrain.spawn;
    fillZone(city, sp.endX + 120, sp.endZ - 100, Zone.ResMed);
    fastForward(city, 24 * 20);
    city.recomputeUtilities();
    const use = city.utilities.totals.power.consumption;
    expect(use).toBeGreaterThan(0);
    const p = PRINCIPLE_BY_ID.get('superconduct')!;
    const plan: Plan = { id: 'm1', centerId: 1, title: '', summary: '', field: p.field, principle: p.id, resource: 'copper', basis: [], kind: 'study', cost: 1, monthly: 1, days: 1, power: 0, risk: 0, prospects: [], clues: [] };
    const made = makeDiscovery(city.research.civ(), plan, { outcome: 'success', quality: 0.8, chance: 0.7, direction: 'refine', field: p.field, principle: p.id }, { id: 1, name: 'Lab', field: 'energy', secondary: [], equipment: 2 }, city.research.nextIds());
    expect(made.discovery.kind).toBe('modifier');
    city.research.adopt(made);
    city.recomputeUtilities();
    expect(city.utilities.totals.power.consumption).toBeLessThan(use * 0.95);
  });

  it('open further experiments, and combine into more advanced designs', () => {
    const c0 = civ(21);
    const info = { id: 1, name: 'Lab', field: 'energy' as const, secondary: ['manufacturing', 'materials'] as ('manufacturing' | 'materials')[], equipment: 3 };
    const p = PRINCIPLE_BY_ID.get('combustion')!;
    const plan: Plan = { id: 'c1', centerId: 1, title: '', summary: '', field: 'energy', principle: p.id, resource: 'peat', basis: [], kind: 'study', cost: 1, monthly: 1, days: 1, power: 0, risk: 0, prospects: [], clues: [] };
    const first = makeDiscovery(c0, plan, { outcome: 'success', quality: 0.7, chance: 0.7, direction: 'apply', field: 'energy', principle: p.id }, info, { discovery: 'd1', design: 'g1', serviceId: 'test-g1' });
    expect(first.discovery.opened).toEqual(expect.arrayContaining(['thermal_store', 'heat_recovery']));
    expect(first.design).toBeTruthy();
    const c1 = civ(21, { discoveries: [first.discovery], tags: new Set(first.discovery.tags), achieved: new Set(['combustion|peat']) });
    let id = 0;
    const plans = [1, 2, 3, 4, 5, 6].flatMap((round) => generateProposals(c1, info, { resources: allResources(), needs: {}, followups: [] }, round, () => `p${id++}`));
    expect(plans.some((x) => PRINCIPLE_BY_ID.get(x.principle)!.needs?.includes('thermal'))).toBe(true);
    // A second discovery in another field makes a synthesis possible.
    const mat = PRINCIPLE_BY_ID.get('binders')!;
    const second = makeDiscovery(c1, { ...plan, id: 'c2', field: 'materials', principle: mat.id, resource: 'clay' }, { outcome: 'success', quality: 0.6, chance: 0.7, direction: 'refine', field: 'materials', principle: mat.id }, info, { discovery: 'd2', design: 'g2', serviceId: 'test-g2' });
    const c2 = civ(21, { discoveries: [first.discovery, second.discovery], tags: new Set([...first.discovery.tags, ...second.discovery.tags]) });
    const synth = [1, 2, 3, 4].flatMap((round) => generateProposals(c2, info, { resources: allResources(), needs: {}, followups: [] }, round, () => `s${id++}`)).find((x) => x.kind === 'synthesis');
    expect(synth).toBeTruthy();
    expect(synth!.basis).toEqual(['d1', 'd2']);
    const res = { outcome: 'success' as const, quality: 0.7, chance: 0.7, direction: 'apply' as const, field: synth!.field, principle: synth!.principle };
    const advanced = makeDiscovery(c2, synth!, res, info, { discovery: 'd3', design: 'g3', serviceId: 'test-g3' });
    expect(advanced.design).toBeTruthy();
    expect(advanced.discovery.basis).toEqual(['d1', 'd2']);
    // Better than the original, and visibly its own building.
    expect(advanced.design!.stats.output).toBeGreaterThan(first.design!.stats.output * 0.9);
    expect(JSON.stringify(advanced.design!.arch)).not.toBe(JSON.stringify(first.design!.arch));
  });
});

describe('generated buildings', () => {
  const FNS: FunctionKind[] = ['powerGen', 'storage', 'water', 'sewage', 'waste', 'farm', 'scrubber', 'clinic', 'school', 'civic'];

  it('always follow the composition rules', () => {
    for (const fn of FNS) {
      for (let seed = 1; seed <= 40; seed++) {
        const spec = composeArch({ w: 36 + (seed % 5) * 4, d: 34 + (seed % 4) * 4, seed: seed * 7919, fn, field: FIELDS[seed % FIELDS.length].id, modules: PRINCIPLES.find((p) => p.build === fn)!.modules, look: RESOURCES[seed % RESOURCES.length].look, components: seed % 3 ? ['glass', 'gardenRoof', 'tallFrame'] : [], accent: 0x5b8def, scale: (seed % 10) / 9 });
        expect(validateArch(spec), `${fn} seed ${seed}`).toEqual([]);
      }
    }
    for (const f of FIELDS) for (let level = 1; level <= 3; level++) expect(validateArch(labArch(f.id, level, 44, 40, level * 31)), `lab ${f.id} ${level}`).toEqual([]);
  });

  it('differ in structure, not just colour', () => {
    const shapes = new Set<string>();
    for (const fn of FNS) {
      const spec = composeArch({ w: 44, d: 40, seed: 99, fn, field: 'energy', modules: PRINCIPLES.find((p) => p.build === fn)!.modules, look: RESOURCES[0].look, components: [], accent: 0, scale: 0.6 });
      shapes.add(JSON.stringify({ s: spec.sections.map((x) => [x.shape, x.roof, x.floors, x.role]), m: spec.modules.map((x) => x.kind).sort() }));
    }
    expect(shapes.size).toBe(FNS.length);
  });

  it('come from a discovery, can be built and do what they look like they do', () => {
    const { city, centre } = labCity(31);
    const id = runUntilDesign(city, centre);
    expect(id).toBeTruthy();
    const st = SERVICE_BY_ID.get(id!)!;
    expect(st.designId).toBeTruthy();
    expect(city.research.serviceTypes().map((t) => t.id)).toContain(id);
    const sp = city.terrain.spawn;
    let placed = null;
    for (const [dx, dz] of [[60, 80], [160, 80], [260, 80], [340, -80], [60, -120]]) {
      const r = placeService(city, id!, sp.endX + dx, sp.endZ + dz);
      if (r.ok) {
        placed = r.building!;
        break;
      }
    }
    expect(placed).toBeTruthy();
    fastForward(city, 24 * 14);
    expect(placed!.state).toBe(BuildingState.Active);
    city.recomputeUtilities();
    const d = city.research.designFor(id!)!;
    if (d.stats.kind === 'power' && d.stats.output) expect(city.utilities.totals.power.production).toBeGreaterThan(60 + 1);
    if (d.stats.storage) expect(city.utilities.storage.capacity).toBeGreaterThan(0);
    if (d.stats.kind === 'water') expect(city.utilities.totals.water.production).toBeGreaterThan(260);
    // The city keeps running with it.
    fastForward(city, 24 * 10);
  });
});

describe('every civilization is its own', () => {
  it('the same history reproduces the same science exactly', () => {
    const a = labCity(41), b = labCity(41);
    runUntilDesign(a.city, a.centre, 4);
    runUntilDesign(b.city, b.centre, 4);
    expect(JSON.stringify(b.city.research.serialize())).toBe(JSON.stringify(a.city.research.serialize()));
  });

  it('different civilizations on the same map get different science', () => {
    const a = labCity(51), b = labCity(52);
    expect(a.city.research.deposits().join()).not.toBe('' );
    const sig = (x: ReturnType<typeof labCity>) => JSON.stringify({ n: x.centre.name, o: x.centre.offers.map((p) => [p.principle, p.resource]), d: x.city.research.deposits() });
    expect(sig(a)).not.toBe(sig(b));
  });

  it('decisions, not only the seed, steer the path', () => {
    const a = labCity(61), b = labCity(61);
    const plan = (c: Center) => c.offers.find((p) => PRINCIPLE_BY_ID.get(p.principle)?.build && (PRINCIPLE_BY_ID.get(p.principle)?.mod || PRINCIPLE_BY_ID.get(p.principle)?.comp)) ?? c.offers[0];
    run(a.city, a.centre, plan(a.centre), (ids) => (ids.includes('apply') ? ids.indexOf('apply') : 0));
    run(b.city, b.centre, plan(b.centre), (ids) => (ids.includes('theory') ? ids.indexOf('theory') : ids.length - 1));
    expect(JSON.stringify(a.city.research.serialize())).not.toBe(JSON.stringify(b.city.research.serialize()));
  });

  it('designs are never shared with another city', () => {
    const a = labCity(71);
    runUntilDesign(a.city, a.centre);
    const other = new City({ name: 'Elsewhere', seed: 1234, preset: 'lakes', flatTerrain: 10, civSeed: 72 });
    expect(other.research.serviceTypes()).toHaveLength(0);
    expect(other.research.discoveries).toHaveLength(0);
  });
});

describe('saving and loading', () => {
  it('keeps discoveries, designs, buildings and an experiment in progress exactly', () => {
    const { city, centre } = labCity(81);
    const id = runUntilDesign(city, centre);
    expect(id).toBeTruthy();
    const sp = city.terrain.spawn;
    for (const [dx, dz] of [[60, 80], [160, 80], [260, 80]]) if (placeService(city, id!, sp.endX + dx, sp.endZ + dz).ok) break;
    // Leave an experiment half-way, waiting at a decision.
    city.research.start(centre.id, centre.offers[0].id);
    for (let d = 0; d < 40 && !centre.active?.pending; d++) fastForward(city, 24);
    expect(centre.active?.pending).toBeTruthy();
    const save = serializeCity(city);
    const again = deserializeCity(JSON.parse(JSON.stringify(save)), { flatTerrain: 10 });
    expect(JSON.stringify(again.research.serialize())).toBe(JSON.stringify(city.research.serialize()));
    expect([...again.buildings.all.values()].filter((b) => b.typeId === id)).toHaveLength(1);
    expect(again.buildings.get(centre.id)!.style).toBe(city.buildings.get(centre.id)!.style);
    // Both carry on identically from the same decision.
    const opt = centre.active!.pending!.options[0].id;
    city.research.decide(centre.id, opt);
    again.research.decide(centre.id, opt);
    for (let d = 0; d < 60; d++) {
      fastForward(city, 24);
      fastForward(again, 24);
      for (const c of [city, again]) {
        const p = c.research.centers.get(centre.id)?.active?.pending;
        if (p) c.research.decide(centre.id, p.options[0].id);
      }
    }
    expect(again.research.records.map((r) => r.outcome)).toEqual(city.research.records.map((r) => r.outcome));
    expect(again.research.discoveries.map((d) => d.name)).toEqual(city.research.discoveries.map((d) => d.name));
  });

  it('older saves load with an empty, stable research history', () => {
    const plain = new City({ name: 'Old', seed: 3, preset: 'lakes', flatTerrain: 10 });
    const save = serializeCity(plain);
    delete (save as { research?: unknown }).research;
    const a = deserializeCity(save, { flatTerrain: 10 }), b = deserializeCity(save, { flatTerrain: 10 });
    expect(a.research.discoveries).toHaveLength(0);
    expect(a.research.civSeed).toBe(b.research.civSeed);
  });
});
