import { describe, expect, it } from 'vitest';
import { newBuilding } from '../src/sim/buildings/Buildings';
import { TICKS_PER_MONTH } from '../src/sim/constants';
import { Economy, TAX_BASE, sumLedger } from '../src/sim/economy/Economy';
import { BuildingState, Zone } from '../src/sim/types';
import { makeCity, road } from './helpers';

describe('economy', () => {
  it('charges road upkeep and service upkeep', () => {
    const city = makeCity({ empty: true });
    road(city, 500, 500, 1000, 500);
    const ledger = city.economy.project(city.buildings, city.roads, () => 0.5);
    expect(ledger.expense['Road maintenance']).toBeCloseTo(500 * 0.35, 0);
    expect(sumLedger(ledger.income)).toBe(0);
  });

  it('collects residential tax proportional to rate and households', () => {
    const city = makeCity({ empty: true });
    const b = newBuilding({ kind: 'zoned', typeId: 'house_small', style: 'house', zone: Zone.ResLow, cx: 100, cz: 100, angle: 0, hw: 8, hd: 14, state: BuildingState.Active, households: 10, hhCap: 10, level: 1 });
    city.buildings.add(b);
    const e = city.economy;
    e.setTax('residential', 10);
    const l10 = e.project(city.buildings, city.roads, () => 0.5)['income']['Residential tax']!;
    expect(l10).toBeCloseTo(10 * TAX_BASE.household * 1 * (0.75 + 0.25) * 0.1, 3);
    e.setTax('residential', 20);
    const l20 = e.project(city.buildings, city.roads, () => 0.5)['income']['Residential tax']!;
    expect(l20).toBeCloseTo(l10 * 2, 3);
  });

  it('accrues a month of projection over a month of ticks', () => {
    const e = new Economy(1000);
    e.projection = { income: { 'Residential tax': 7200 }, expense: { 'Road maintenance': 3600 } };
    for (let i = 0; i < TICKS_PER_MONTH; i++) e.accrueHour();
    expect(e.money).toBeCloseTo(1000 + 3600, 3);
    e.closeMonth(0);
    expect(e.history[0].income).toBeCloseTo(7200, 3);
    expect(e.history[0].expense).toBeCloseTo(3600, 3);
  });

  it('prevents spending more than available, unless unlimited', () => {
    const e = new Economy(500);
    expect(e.spend(1000)).toBe(false);
    expect(e.money).toBe(500);
    e.unlimited = true;
    expect(e.spend(1000)).toBe(true);
    expect(e.money).toBe(500);
  });

  it('loans add money and are repaid monthly with interest', () => {
    const e = new Economy(0);
    const loan = e.takeLoan(0)!;
    expect(e.money).toBe(50_000);
    expect(loan.monthlyPayment * loan.monthsLeft).toBeGreaterThan(50_000);
    e.projection = { income: {}, expense: {} };
    e.closeMonth(0);
    expect(e.money).toBe(50_000 - loan.monthlyPayment);
    expect(e.loans[0].monthsLeft).toBe(23);
  });

  it('clamps tax rates', () => {
    const e = new Economy(0);
    e.setTax('office', 99);
    expect(e.taxes.office).toBe(25);
    e.setTax('office', -3);
    expect(e.taxes.office).toBe(0);
  });
});
