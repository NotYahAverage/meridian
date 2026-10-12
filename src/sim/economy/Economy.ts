import type { Building, Buildings } from '../buildings/Buildings';
import { TICKS_PER_MONTH } from '../constants';
import type { RoadNetwork } from '../roads/RoadNetwork';
import { REGIONAL_ROAD_NAME, ROAD_TYPES } from '../roads/RoadTypes';
import { SERVICE_BY_ID } from '../services/ServiceTypes';
import { BuildingState, Zone, zoneBase } from '../types';

export type TaxCategory = 'residential' | 'commercial' | 'industrial' | 'office';
export const TAX_CATEGORIES: TaxCategory[] = ['residential', 'commercial', 'industrial', 'office'];

export type IncomeKey = 'Residential tax' | 'Commercial tax' | 'Industrial tax' | 'Office tax' | 'Transit fares' | 'Tourism' | 'Grants';
export type ExpenseKey =
  | 'Road maintenance'
  | 'Police'
  | 'Fire'
  | 'Healthcare'
  | 'Education'
  | 'Garbage'
  | 'Parks'
  | 'Electricity'
  | 'Water'
  | 'Sewage'
  | 'Public transit'
  | 'Policies'
  | 'Landmarks'
  | 'Administration'
  | 'Loan payments'
  | 'Research'
  | 'Construction';

export interface Ledger {
  income: Partial<Record<IncomeKey, number>>;
  expense: Partial<Record<ExpenseKey, number>>;
}

export interface Loan {
  id: number;
  principal: number;
  monthlyPayment: number;
  monthsLeft: number;
}

export interface MonthRecord {
  month: number;
  income: number;
  expense: number;
  balance: number;
}

export const LOAN_OPTIONS = [
  { principal: 50_000, months: 24, rate: 0.06 },
  { principal: 150_000, months: 48, rate: 0.08 },
];

const SERVICE_EXPENSE: Record<string, ExpenseKey> = {
  police: 'Police',
  fire: 'Fire',
  health: 'Healthcare',
  education: 'Education',
  garbage: 'Garbage',
  park: 'Parks',
  power: 'Electricity',
  water: 'Water',
  sewage: 'Sewage',
  transit: 'Public transit',
  landmark: 'Landmarks',
  research: 'Research',
};

/** Services whose funding the player can adjust. */
export type BudgetKey = 'police' | 'fire' | 'health' | 'education' | 'garbage' | 'park';
export const BUDGET_KEYS: BudgetKey[] = ['police', 'fire', 'health', 'education', 'garbage', 'park'];
export const BUDGET_MIN = 50;
export const BUDGET_MAX = 150;

/** Per-household and per-job monthly tax base at a 100% rate. */
export const TAX_BASE = {
  household: 245,
  commercialJob: 150,
  industrialJob: 135,
  officeJob: 200,
};

const LEVEL_TAX = [0, 1, 1.25, 1.55];

export function sumLedger(r: Partial<Record<string, number>>): number {
  let s = 0;
  for (const v of Object.values(r)) s += v ?? 0;
  return s;
}

/**
 * City finances. Recurring income and expenses accrue every hour from the
 * monthly projection; one-off construction costs are charged immediately.
 */
/** A zoned building's tax category and taxable base (before the rate is applied). */
function taxBase(b: Building, lv: number): [TaxCategory, number] | null {
  if (b.state !== BuildingState.Active || b.kind !== 'zoned') return null;
  const lf = LEVEL_TAX[b.level] ?? 1;
  switch (zoneBase(b.zone)) {
    case Zone.ResLow:
    case Zone.ResMed:
    case Zone.ResHigh:
      return ['residential', b.households * TAX_BASE.household * lf * (0.75 + 0.5 * lv)];
    case Zone.Commercial:
      return ['commercial', b.workers * TAX_BASE.commercialJob * lf * b.efficiency * (0.8 + 0.4 * lv)];
    case Zone.Industrial:
      return ['industrial', b.workers * TAX_BASE.industrialJob * lf * b.efficiency];
    case Zone.Office:
      return ['office', b.workers * TAX_BASE.officeJob * lf * b.efficiency * (0.85 + 0.3 * lv)];
  }
  return null;
}

export class Economy {
  money: number;
  unlimited = false;
  taxes: Record<TaxCategory, number> = { residential: 9, commercial: 9, industrial: 9, office: 9 };
  /** Funding level per service, percent of standard (50–150). */
  budgets: Record<BudgetKey, number> = { police: 100, fire: 100, health: 100, education: 100, garbage: 100, park: 100 };
  loans: Loan[] = [];
  nextLoanId = 1;
  thisMonth: Ledger = { income: {}, expense: {} };
  lastMonth: Ledger = { income: {}, expense: {} };
  history: MonthRecord[] = [];
  /** Cached monthly projection. */
  projection: Ledger = { income: {}, expense: {} };
  monthsInDebt = 0;

  constructor(startMoney: number) {
    this.money = startMoney;
  }

  canAfford(cost: number): boolean {
    return this.unlimited || this.money >= cost;
  }

  spend(cost: number, key: ExpenseKey = 'Construction'): boolean {
    if (!this.canAfford(cost)) return false;
    if (!this.unlimited) this.money -= cost;
    this.thisMonth.expense[key] = (this.thisMonth.expense[key] ?? 0) + cost;
    return true;
  }

  refund(amount: number): void {
    if (!this.unlimited) this.money += amount;
    this.thisMonth.expense.Construction = (this.thisMonth.expense.Construction ?? 0) - amount;
  }

  grant(amount: number): void {
    this.money += amount;
    this.thisMonth.income.Grants = (this.thisMonth.income.Grants ?? 0) + amount;
  }

  /** Computes the monthly income/expense projection for the current city. */
  /** Monthly tax a zoned building pays at today's rates (policy discounts aside). */
  buildingTax(b: Building, lv: number): number {
    const tb = taxBase(b, lv);
    return tb ? (tb[1] * this.taxes[tb[0]]) / 100 : 0;
  }

  project(
    buildings: Buildings,
    net: RoadNetwork,
    lvAt: (x: number, z: number) => number,
    extras?: { fares: number; upkeep: number; policyCost?: number; tourism?: number; admin?: number; research?: number; taxScale?: Partial<Record<TaxCategory, number>> },
  ): Ledger {
    const income: Ledger['income'] = {};
    const expense: Ledger['expense'] = {};
    const t = this.taxes;
    const base: Record<TaxCategory, number> = { residential: 0, commercial: 0, industrial: 0, office: 0 };
    for (const b of buildings.all.values()) {
      const tb = taxBase(b, lvAt(b.cx, b.cz));
      if (tb) base[tb[0]] += tb[1];
    }
    const res = base.residential, com = base.commercial, ind = base.industrial, off = base.office;
    const ts = extras?.taxScale ?? {};
    income['Residential tax'] = (res * t.residential * (ts.residential ?? 1)) / 100;
    income['Commercial tax'] = (com * t.commercial * (ts.commercial ?? 1)) / 100;
    income['Industrial tax'] = (ind * t.industrial * (ts.industrial ?? 1)) / 100;
    income['Office tax'] = (off * t.office * (ts.office ?? 1)) / 100;

    let roads = 0;
    for (const s of net.segments.values()) {
      if (s.name === REGIONAL_ROAD_NAME) continue;
      roads += s.length * ROAD_TYPES[s.type].upkeepPerMeter;
    }
    expense['Road maintenance'] = roads;
    for (const b of buildings.all.values()) {
      if (b.kind !== 'service') continue;
      const st = SERVICE_BY_ID.get(b.typeId);
      if (!st) continue;
      const key = SERVICE_EXPENSE[st.kind];
      const factor = b.state === BuildingState.Construction ? 0.25 : 1;
      const funding = (this.budgets[st.kind as BudgetKey] ?? 100) / 100;
      expense[key] = (expense[key] ?? 0) + st.upkeep * factor * funding;
    }
    if (extras) {
      if (extras.fares > 0) income['Transit fares'] = extras.fares;
      if (extras.upkeep > 0) expense['Public transit'] = (expense['Public transit'] ?? 0) + extras.upkeep;
      if (extras.policyCost && extras.policyCost > 0) expense.Policies = extras.policyCost;
      if (extras.research && extras.research > 0) expense.Research = (expense.Research ?? 0) + extras.research;
      if (extras.tourism && extras.tourism > 0) income.Tourism = extras.tourism;
      if (extras.admin && extras.admin > 0) expense.Administration = extras.admin;
    }
    let loanPay = 0;
    for (const l of this.loans) loanPay += l.monthlyPayment;
    if (loanPay) expense['Loan payments'] = loanPay;
    this.projection = { income, expense };
    return this.projection;
  }

  get projectedNet(): number {
    return sumLedger(this.projection.income) - sumLedger(this.projection.expense);
  }

  /** Applies one hour of recurring income and expenses from the projection. */
  accrueHour(): void {
    const k = 1 / TICKS_PER_MONTH;
    for (const [key, v] of Object.entries(this.projection.income) as [IncomeKey, number][]) {
      const amt = v * k;
      this.money += amt;
      this.thisMonth.income[key] = (this.thisMonth.income[key] ?? 0) + amt;
    }
    for (const [key, v] of Object.entries(this.projection.expense) as [ExpenseKey, number][]) {
      if (key === 'Loan payments') continue;
      const amt = v * k;
      if (!this.unlimited) this.money -= amt;
      this.thisMonth.expense[key] = (this.thisMonth.expense[key] ?? 0) + amt;
    }
  }

  /** Month end: loan payments, history, debt tracking. */
  closeMonth(monthIndex: number): void {
    for (const l of this.loans) {
      if (!this.unlimited) this.money -= l.monthlyPayment;
      this.thisMonth.expense['Loan payments'] = (this.thisMonth.expense['Loan payments'] ?? 0) + l.monthlyPayment;
      l.monthsLeft--;
    }
    this.loans = this.loans.filter((l) => l.monthsLeft > 0);
    const inc = sumLedger(this.thisMonth.income);
    const exp = sumLedger(this.thisMonth.expense);
    this.history.push({ month: monthIndex, income: inc, expense: exp, balance: this.money });
    if (this.history.length > 36) this.history.shift();
    this.lastMonth = this.thisMonth;
    this.thisMonth = { income: {}, expense: {} };
    this.monthsInDebt = this.money < 0 ? this.monthsInDebt + 1 : 0;
  }

  takeLoan(option: number): Loan | null {
    const o = LOAN_OPTIONS[option];
    if (!o || this.loans.length >= 2) return null;
    const total = o.principal * (1 + o.rate * (o.months / 12));
    const loan: Loan = { id: this.nextLoanId++, principal: o.principal, monthlyPayment: Math.round(total / o.months), monthsLeft: o.months };
    this.loans.push(loan);
    this.money += o.principal;
    return loan;
  }

  repayLoan(id: number): boolean {
    const l = this.loans.find((x) => x.id === id);
    if (!l) return false;
    const remaining = l.monthlyPayment * l.monthsLeft;
    if (this.money < remaining) return false;
    this.money -= remaining;
    this.loans = this.loans.filter((x) => x !== l);
    return true;
  }

  setBudget(key: BudgetKey, pct: number): void {
    this.budgets[key] = Math.max(BUDGET_MIN, Math.min(BUDGET_MAX, Math.round(pct / 5) * 5));
  }

  /** Funding as a fraction of standard (1 = 100%). */
  funding(key: string): number {
    return (this.budgets[key as BudgetKey] ?? 100) / 100;
  }

  setTax(cat: TaxCategory, rate: number): void {
    this.taxes[cat] = Math.max(0, Math.min(25, Math.round(rate)));
  }
}
