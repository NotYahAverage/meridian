import { describe, expect, it } from 'vitest';
import { Demand, type DemandInputs } from '../src/sim/demand/Demand';

function base(): DemandInputs {
  return {
    connected: true,
    population: 1000,
    households: 380,
    housingCapacity: 420,
    pendingHousing: 0,
    workers: 500,
    employed: 470,
    educatedWorkers: 120,
    educatedEmployed: 110,
    jobs: { commercial: 110, industrial: 250, office: 0, service: 60 },
    filled: { commercial: 100, industrial: 240, office: 0, service: 50 },
    happiness: 62,
    taxes: { residential: 9, commercial: 9, industrial: 9, office: 9 },
    serviceScore: 0.5,
    avgLandValue: 0.4,
    congestion: 0.3,
    officeUnlocked: true,
  };
}

describe('demand', () => {
  it('produces values in range', () => {
    const r = Demand.compute(base());
    for (const v of Object.values(r.value)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('has zero residential demand without a highway connection', () => {
    const r = Demand.compute({ ...base(), connected: false });
    expect(r.value.residential).toBe(0);
    expect(r.factors.residential[0].label).toMatch(/highway/i);
  });

  it('open jobs raise residential demand; unemployment lowers it', () => {
    const lots = Demand.compute({ ...base(), jobs: { ...base().jobs, industrial: 800 } });
    const none = Demand.compute({ ...base(), employed: 300 });
    expect(lots.value.residential).toBeGreaterThan(Demand.compute(base()).value.residential);
    expect(none.value.residential).toBeLessThan(Demand.compute(base()).value.residential);
  });

  it('unemployed workers raise industrial demand', () => {
    const r = Demand.compute({ ...base(), employed: 300 });
    expect(r.value.industrial).toBeGreaterThan(Demand.compute(base()).value.industrial);
  });

  it('many residents without shops raise commercial demand', () => {
    const r = Demand.compute({ ...base(), population: 4000, jobs: { ...base().jobs, commercial: 50 } });
    expect(r.value.commercial).toBeGreaterThan(50);
  });

  it('higher taxes reduce demand', () => {
    const lowTax = Demand.compute({ ...base(), taxes: { residential: 5, commercial: 5, industrial: 5, office: 5 } });
    const highTax = Demand.compute({ ...base(), taxes: { residential: 20, commercial: 20, industrial: 20, office: 20 } });
    for (const k of ['residential', 'commercial', 'industrial'] as const) {
      expect(lowTax.value[k]).toBeGreaterThanOrEqual(highTax.value[k]);
    }
    expect(lowTax.value.residential).toBeGreaterThan(highTax.value.residential);
  });

  it('office demand needs educated workers and the unlock', () => {
    expect(Demand.compute({ ...base(), officeUnlocked: false }).value.office).toBe(0);
    const edu = Demand.compute({ ...base(), educatedWorkers: 300, educatedEmployed: 100 });
    expect(edu.value.office).toBeGreaterThan(30);
  });

  it('smooths over time', () => {
    const d = new Demand();
    d.value.residential = 0;
    d.update(base(), 0.25);
    const first = d.value.residential;
    d.update(base(), 0.25);
    expect(d.value.residential).toBeGreaterThan(first);
  });
});

describe('demand explanations', () => {
  it('give numbers for every factor and a fix for each problem', () => {
    const r = Demand.compute({ ...base(), taxes: { residential: 14, commercial: 9, industrial: 9, office: 9 } });
    for (const list of Object.values(r.factors)) {
      for (const f of list) {
        expect(f.detail, f.label).toBeTruthy();
        if (f.value < 0) expect(f.tip, f.label).toBeTruthy();
      }
    }
    const taxes = r.factors.residential.find((f) => f.label === 'Taxes')!;
    expect(taxes.detail).toContain('14%');
    expect(taxes.fix).toBe('budget');
  });

  it('advice-only hints do not change demand', () => {
    const inp = { ...base(), officeUnlocked: true, educatedWorkers: 10, educatedEmployed: 10 };
    const r = Demand.compute(inp);
    const hint = r.factors.office.find((f) => f.hint);
    expect(hint).toBeTruthy();
    const sum = r.factors.office.reduce((s, f) => s + f.value, 0);
    expect(r.value.office).toBeCloseTo(Math.min(100, Math.max(0, sum)));
  });
});
