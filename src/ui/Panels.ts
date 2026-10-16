import { formatInt, formatMoney, formatPct } from '../core/math';
import { scenarioCard } from './ScenarioDialogs';
import type { Game } from '../game/Game';
import { OVERLAYS, type OverlayId, Overlays } from '../render/overlays/Overlays';
import { BuildingState, ZONE_INFO, Zone, isResidential } from '../sim/types';
import { GOALS, MILESTONES } from '../sim/progress/Progress';
import { ACHIEVEMENTS } from '../sim/progress/Achievements';
import { BUDGET_KEYS, BUDGET_MAX, BUDGET_MIN, LOAN_OPTIONS, TAX_CATEGORIES, sumLedger } from '../sim/economy/Economy';
import { COVERAGE_KINDS, COVERAGE_LABEL } from '../sim/services/ServiceTypes';
import { TRANSIT_UNLOCK, deleteLine, deleteMetroLine, setLineBuses, setMetroTrains } from '../sim/CityCommands';
import { METRO, METRO_UNLOCK, metroProblemText } from '../sim/transit/Metro';
import { projectEconomy, tourismIncome } from '../sim/CitySim';
import { isLocalPolicy, LOCAL_POLICIES, POLICIES, POLICY_BY_ID } from '../sim/policies/Policies';
import { BUS, lineProblemText } from '../sim/transit/Transit';
import { type Series, drawChart } from './charts';
import { LAND_PRICE_GROWTH, Land } from '../sim/world/Land';
import { h, setText } from './dom';
import { icon } from './icons';

export type PanelId = 'stats' | 'budget' | 'overlays' | 'goals' | 'districts' | 'log' | 'transit' | 'policies' | 'land';

export abstract class Panel {
  readonly el: HTMLElement;
  protected body: HTMLElement;
  abstract readonly id: PanelId;

  constructor(protected game: Game, title: string, ic: string) {
    this.body = h('div', { class: 'panel-body' });
    this.el = h(
      'section',
      { class: 'panel hidden' },
      h('div', { class: 'panel-head' }, icon(ic, 18), h('div', { class: 'panel-title' }, title), h('button', { class: 'icon-btn small', 'aria-label': 'Close', 'data-tip': 'Close (Esc)', onclick: () => this.game.ui.closePanel(this.id === 'overlays' ? 'overlays' : undefined) }, icon('close', 14))),
      this.body,
    );
  }

  open(): void {
    this.el.classList.remove('hidden');
    this.render();
  }

  close(): void {
    this.el.classList.add('hidden');
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }

  abstract render(): void;
  update(): void {}
}

const row = (label: string, value: string | HTMLElement, cls = '') => h('div', { class: `kv ${cls}` }, h('span', null, label), typeof value === 'string' ? h('b', null, value) : value);

function meter(v: number, color = 'var(--accent)'): HTMLElement {
  return h('div', { class: 'meter' }, h('div', { class: 'meter-fill', style: `width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%;background:${color}` }));
}

// ── Statistics ──────────────────────────────────────────────────────────────

export class StatsPanel extends Panel {
  readonly id = 'stats';
  private charts: HTMLCanvasElement[] = [];
  private live: Record<string, HTMLElement> = {};
  private tab: 'overview' | 'services' | 'zones' = 'overview';

  constructor(game: Game) {
    super(game, 'City Statistics', 'stats');
  }

  render(): void {
    const b = this.body;
    b.innerHTML = '';
    const tabs = h('div', { class: 'tabs' });
    for (const [id, label] of [['overview', 'Overview'], ['services', 'Services'], ['zones', 'Land use']] as const) {
      tabs.appendChild(h('button', { class: `tab${this.tab === id ? ' active' : ''}`, onclick: () => { this.tab = id; this.render(); } }, label));
    }
    b.appendChild(tabs);
    const city = this.game.city;
    if (!city) return;
    this.live = {};
    this.charts = [];
    if (this.tab === 'overview') {
      for (const k of ['population', 'households', 'housing', 'jobs', 'employed', 'unemployment', 'educated', 'commute', 'traffic', 'buildings', 'vehicles', 'cars', 'riders', 'share', 'tourism', 'hotels'])
        this.live[k] = h('b');
      b.append(
        h('div', { class: 'section-title' }, 'People'),
        row('Population', this.live.population),
        row('Households', this.live.households),
        row('Housing capacity', this.live.housing),
        row('Educated workers', this.live.educated),
        h('div', { class: 'section-title' }, 'Work'),
        row('Jobs', this.live.jobs),
        row('Employed', this.live.employed),
        row('Unemployment', this.live.unemployment),
        h('div', { class: 'section-title' }, 'Movement'),
        row('Avg. trip time', this.live.commute),
        row('Peak traffic', this.live.traffic),
        row('Vehicles on roads', this.live.vehicles),
        row('Buildings', this.live.buildings),
        h('div', { class: 'section-title' }, 'Transit & visitors'),
        row('Transit riders per day', this.live.riders),
        row('Commuters by transit', this.live.share),
        row('Tourism', this.live.tourism),
        row('Hotels', this.live.hotels),
      );
      const c1 = h('canvas', { class: 'chart' });
      const c2 = h('canvas', { class: 'chart' });
      const c3 = h('canvas', { class: 'chart' });
      const c4 = h('canvas', { class: 'chart' });
      b.append(
        h('div', { class: 'section-title' }, 'Population & jobs'), c1, h('div', { class: 'legend' }, h('span', { class: 'lg r' }, 'Population'), h('span', { class: 'lg c' }, 'Jobs')),
        h('div', { class: 'section-title' }, 'Treasury'), c2,
        h('div', { class: 'section-title' }, 'Happiness'), c3,
        h('div', { class: 'section-title' }, 'Transit riders per day'), c4,
      );
      this.charts = [c1, c2, c3, c4];
    } else if (this.tab === 'services') {
      for (const k of COVERAGE_KINDS) {
        const v = city.coverage.averageFor(k, city.buildings);
        b.append(h('div', { class: 'svc-row' }, h('span', null, COVERAGE_LABEL[k]), meter(v, v > 0.6 ? 'var(--good)' : v > 0.3 ? 'var(--warn)' : 'var(--bad)'), h('b', null, formatPct(v))));
      }
      const u = city.utilities.totals;
      b.append(
        h('div', { class: 'section-title' }, 'Utilities'),
        utilRow('Electricity', u.power.consumption, u.power.production, 'MW', 1),
        utilRow('Water', u.water.consumption, u.water.production, 'm³/day', 0),
        utilRow('Sewage', u.sewage.consumption, u.sewage.production, 'm³/day', 0),
      );
      let garbage = 0, problems = 0;
      for (const bb of city.buildings.all.values()) {
        garbage += bb.garbage;
        if (bb.problems) problems++;
      }
      b.append(h('div', { class: 'section-title' }, 'Wellbeing'), row('Happiness', `${Math.round(city.stats.happiness)}%`), row('Uncollected garbage', formatInt(garbage)), row('Buildings with problems', formatInt(problems)));
    } else {
      const counts = new Map<Zone, { zoned: number; built: number; cap: number }>();
      for (const z of [Zone.ResLow, Zone.ResMed, Zone.ResHigh, Zone.Commercial, Zone.CommercialHigh, Zone.Office, Zone.Industrial, Zone.IndustrialLight]) counts.set(z, { zoned: city.zones.countZoned(z), built: 0, cap: 0 });
      for (const bb of city.buildings.all.values()) {
        const c = counts.get(bb.zone);
        if (!c) continue;
        c.built++;
        c.cap += isResidential(bb.zone) ? bb.hhCap : bb.jobs;
      }
      for (const [z, c] of counts) {
        const info = ZONE_INFO[z];
        b.append(
          h('div', { class: 'zone-row' },
            h('i', { class: 'swatch', style: `background:rgb(${info.color.map((v) => Math.round(v * 255)).join(',')})` }),
            h('span', null, info.name),
            h('b', null, `${formatInt(c.built)} bldg · ${formatInt(c.cap)} ${isResidential(z) ? 'homes' : 'jobs'}`),
          ),
        );
      }
      const levels = [0, 0, 0];
      for (const bb of city.buildings.all.values()) if (bb.kind === 'zoned' && bb.state === BuildingState.Active) levels[bb.level - 1]++;
      b.append(h('div', { class: 'section-title' }, 'Building levels'), row('Level 1', formatInt(levels[0])), row('Level 2', formatInt(levels[1])), row('Level 3', formatInt(levels[2])));
    }
    this.update();
  }

  update(): void {
    const city = this.game.city;
    if (!city || !this.isOpen) return;
    const s = city.stats;
    const set = (k: string, v: string) => this.live[k] && setText(this.live[k], v);
    set('population', formatInt(city.population.residents));
    set('households', formatInt(city.population.households));
    set('housing', formatInt(s.housingCapacity));
    set('jobs', formatInt(s.jobs));
    set('employed', formatInt(s.employed));
    set('unemployment', formatPct(s.unemployment, 1));
    set('educated', formatInt(city.population.educatedCount));
    set('commute', city.traffic.avgTripMinutes ? `${city.traffic.avgTripMinutes.toFixed(1)} min` : '—');
    let worst = 0;
    for (const id of city.traffic.volume.keys()) worst = Math.max(worst, city.traffic.ratio(id));
    set('traffic', worst ? `${Math.round(worst * 100)}% of capacity (busiest road)` : '—');
    set('vehicles', formatInt(city.vehicles.count));
    set('buildings', formatInt(city.buildings.count));
    const t = city.transit;
    set('riders', t.metro.lines.size ? `${formatInt(t.totalRiders)} (${formatInt(t.busRiders)} bus · ${formatInt(t.metro.totalRiders)} metro)` : formatInt(t.totalRiders));
    set('share', formatPct(t.modeShare));
    set('tourism', `${formatMoney(tourismIncome(city))}/month`);
    let hotels = 0;
    for (const bb of city.buildings.all.values()) if (bb.typeId === 'hotel') hotels++;
    set('hotels', formatInt(hotels));
    if (this.charts.length === 4) {
      const hist = city.history.slice(-120);
      const series: Series[] = [
        { values: hist.map((x) => x.population), color: 'rgb(74,222,128)', label: 'Population', fill: true },
        { values: hist.map((x) => x.jobs), color: 'rgb(96,165,250)', label: 'Jobs' },
      ];
      drawChart(this.charts[0], series, { min: 0, format: (v) => formatInt(v) });
      drawChart(this.charts[1], [{ values: hist.map((x) => x.money), color: 'rgb(94,234,212)', label: 'Money', fill: true }], { format: (v) => formatMoney(v, true) });
      drawChart(this.charts[2], [{ values: hist.map((x) => x.happiness), color: 'rgb(250,204,21)', label: 'Happiness', fill: true }], { min: 0, max: 100, format: (v) => `${Math.round(v)}%` });
      drawChart(this.charts[3], [{ values: hist.map((x) => x.riders ?? 0), color: 'rgb(244,114,182)', label: 'Riders', fill: true }], { min: 0, format: (v) => formatInt(v) });
    }
  }
}

function utilRow(label: string, use: number, prod: number, unit: string, digits: number): HTMLElement {
  const ratio = prod > 0 ? use / prod : use > 0 ? 2 : 0;
  const color = ratio > 1 ? 'var(--bad)' : ratio > 0.85 ? 'var(--warn)' : 'var(--good)';
  return h('div', { class: 'util-row' }, h('div', { class: 'util-head' }, h('span', null, label), h('b', null, `${use.toFixed(digits)} / ${prod.toFixed(digits)} ${unit}`)), meter(Math.min(1, ratio), color));
}

// ── Budget ──────────────────────────────────────────────────────────────────

export class BudgetPanel extends Panel {
  readonly id = 'budget';

  constructor(game: Game) {
    super(game, 'Budget & Taxes', 'budget');
  }

  render(): void {
    const b = this.body;
    const city = this.game.city;
    b.innerHTML = '';
    if (!city) return;
    const e = city.economy;
    projectEconomy(city);
    const inc = e.projection.income;
    const exp = e.projection.expense;
    const net = e.projectedNet;
    b.append(
      h('div', { class: 'budget-hero' },
        h('div', null, h('div', { class: 'muted' }, 'Treasury'), h('div', { class: `big${e.money < 0 ? ' neg' : ''}` }, e.unlimited ? 'Unlimited' : formatMoney(e.money))),
        h('div', null, h('div', { class: 'muted' }, 'Monthly balance'), h('div', { class: `big ${net >= 0 ? 'pos' : 'neg'}` }, `${net >= 0 ? '+' : '−'}${formatMoney(Math.abs(net))}`)),
      ),
      h('div', { class: 'section-title' }, 'Tax rates'),
    );
    for (const cat of TAX_CATEGORIES) {
      if (cat === 'office' && city.peakPopulation < 1000) continue;
      const val = h('b', null, `${e.taxes[cat]}%`);
      const input = h('input', { type: 'range', min: '0', max: '25', step: '1', value: String(e.taxes[cat]), class: `slider ${cat[0]}` }) as HTMLInputElement;
      input.addEventListener('input', () => {
        e.setTax(cat, Number(input.value));
        setText(val, `${e.taxes[cat]}%`);
      });
      input.addEventListener('change', () => this.render());
      b.append(h('div', { class: 'tax-row' }, h('span', null, cat[0].toUpperCase() + cat.slice(1)), input, val));
    }
    b.append(h('div', { class: 'hint' }, 'Higher taxes earn more per building but reduce demand and happiness. 9% is neutral.'));
    b.append(h('div', { class: 'section-title' }, 'Service funding'));
    for (const key of BUDGET_KEYS) {
      const val = h('b', null, `${e.budgets[key]}%`);
      const input = h('input', { type: 'range', min: String(BUDGET_MIN), max: String(BUDGET_MAX), step: '5', value: String(e.budgets[key]), class: 'slider' }) as HTMLInputElement;
      input.addEventListener('input', () => {
        e.setBudget(key, Number(input.value));
        setText(val, `${e.budgets[key]}%`);
      });
      input.addEventListener('change', () => {
        city.coverageDirty = true;
        this.render();
      });
      b.append(h('div', { class: 'tax-row' }, h('span', null, COVERAGE_LABEL[key]), input, val));
    }
    b.append(h('div', { class: 'hint' }, 'More funding stretches coverage and lets each building serve more people; less saves money but services fall short sooner.'));
    const list = (title: string, entries: [string, number][], sign: 1 | -1) => {
      const box = h('div', { class: 'ledger' }, h('div', { class: 'section-title' }, title));
      const sorted = entries.filter(([, v]) => Math.abs(v) >= 1).sort((a, z) => z[1] - a[1]);
      if (!sorted.length) box.appendChild(h('div', { class: 'muted small' }, 'Nothing yet'));
      for (const [k, v] of sorted) box.appendChild(row(k, `${sign > 0 ? '+' : '−'}${formatMoney(v)}`, sign > 0 ? 'pos' : 'neg'));
      box.appendChild(row('Total', `${sign > 0 ? '+' : '−'}${formatMoney(sumLedger(Object.fromEntries(sorted)))}`, 'total'));
      return box;
    };
    b.append(h('div', { class: 'ledger-cols' }, list('Income / month', Object.entries(inc) as [string, number][], 1), list('Expenses / month', Object.entries(exp) as [string, number][], -1)));
    b.append(h('div', { class: 'section-title' }, 'Loans'));
    if (e.loans.length) {
      for (const l of e.loans) {
        b.append(h('div', { class: 'loan' }, h('span', null, `${formatMoney(l.principal)} loan`), h('span', { class: 'muted' }, `${formatMoney(l.monthlyPayment)}/mo · ${l.monthsLeft} months left`), h('button', { class: 'btn small', onclick: () => { if (!e.repayLoan(l.id)) this.game.toastError('Not enough money to repay'); else this.game.play('good'); this.render(); } }, 'Repay')));
      }
    }
    if (e.loans.length < 2 && !e.unlimited) {
      LOAN_OPTIONS.forEach((o, i) => {
        const total = o.principal * (1 + o.rate * (o.months / 12));
        b.append(h('div', { class: 'loan' }, h('span', null, `Borrow ${formatMoney(o.principal)}`), h('span', { class: 'muted' }, `${formatMoney(total / o.months)}/mo for ${o.months} months`), h('button', { class: 'btn small', onclick: () => { e.takeLoan(i); this.game.play('good'); this.render(); } }, 'Take loan')));
      });
    }
    const hist = e.history.slice(-12);
    if (hist.length) {
      const c = h('canvas', { class: 'chart' });
      b.append(h('div', { class: 'section-title' }, 'Monthly income vs expenses'), c, h('div', { class: 'legend' }, h('span', { class: 'lg r' }, 'Income'), h('span', { class: 'lg bad' }, 'Expenses')));
      requestAnimationFrame(() => drawChart(c, [{ values: hist.map((x) => x.income), color: 'rgb(74,222,128)', label: 'Income' }, { values: hist.map((x) => x.expense), color: 'rgb(248,113,113)', label: 'Expenses' }], { min: 0, format: (v) => formatMoney(v, true) }));
    }
  }
}

// ── Map layers ──────────────────────────────────────────────────────────────

export class OverlaysPanel extends Panel {
  readonly id = 'overlays';

  constructor(game: Game) {
    super(game, 'Map Layers', 'layers');
  }

  render(): void {
    const b = this.body;
    b.innerHTML = '';
    const cur = this.game.world?.overlays.mode ?? 'none';
    const groups = new Map<string, typeof OVERLAYS>();
    for (const o of OVERLAYS) groups.set(o.group, [...(groups.get(o.group) ?? []), o]);
    b.appendChild(h('div', { class: 'layer-note' }, 'One layer is drawn on the map at a time. Press Tab to cycle through them.'));
    for (const [g, list] of groups) {
      b.appendChild(h('div', { class: 'section-title' }, g));
      const rows = h('div', { class: 'layer-list' });
      for (const o of list) {
        const on = cur === o.id;
        rows.appendChild(
          h('button', { class: `layer-row${on ? ' active' : ''}`, role: 'switch', 'aria-checked': on ? 'true' : 'false', 'data-layer': o.id, onclick: () => this.pick(on ? 'none' : o.id) },
            h('i', { class: 'layer-dot', style: `background:${LAYER_COLOR[o.id] ?? 'var(--accent)'}` }),
            h('span', { class: 'layer-name' }, o.label),
            h('span', { class: `switch${on ? ' on' : ''}`, 'aria-hidden': 'true' }, h('i')),
          ),
        );
      }
      b.appendChild(rows);
    }
    const info = OVERLAYS.find((o) => o.id === cur);
    if (info) {
      b.appendChild(
        h('div', { class: 'layer-legend' },
          h('div', { class: 'layer-legend-title' }, info.label),
          ...(info.legend[0] ? [h('div', { class: `legend-ramp ${cur}` }), h('div', { class: 'legend-ends' }, h('span', null, info.legend[0]), h('span', null, info.legend[1]))] : []),
          h('div', { class: 'legend-desc' }, Overlays.describe(cur)),
        ),
      );
    }
  }

  private pick(id: OverlayId): void {
    this.game.play('click');
    this.game.setOverlay(id);
    this.render();
  }
}

/** Key colour shown beside each layer in the list (matches the legend ramps). */
const LAYER_COLOR: Partial<Record<OverlayId, string>> = {
  traffic: '#e0703a', landValue: '#4fbf72', happiness: '#d9b84a', districts: '#8f87e8', transit: '#3fb0d0', walking: '#46e178', pollution: '#a8743c', noise: '#e0874a',
  power: '#d9c24a', water: '#4a9be0', police: '#3c82ff', fire: '#ff5a3c', health: '#ff6eaa', education: '#aa6eff', garbage: '#aabe3c', park: '#3cd26e',
};

// ── Goals ───────────────────────────────────────────────────────────────────

export class GoalsPanel extends Panel {
  readonly id = 'goals';

  constructor(game: Game) {
    super(game, 'Goals & Milestones', 'flag');
  }

  render(): void {
    const b = this.body;
    const city = this.game.city;
    b.innerHTML = '';
    if (!city) return;
    const scn = scenarioCard(this.game, city);
    if (scn) b.append(scn);
    const next = GOALS.find((g) => !city.goalsDone.has(g.id));
    if (next) {
      b.append(h('div', { class: 'goal-next' }, h('div', { class: 'muted small' }, 'Next step'), h('div', { class: 'goal-title' }, next.title), h('div', { class: 'goal-hint' }, next.hint), h('div', { class: 'goal-reward' }, `Reward ${formatMoney(next.reward)}`)));
    } else {
      b.append(h('div', { class: 'goal-next done' }, h('div', { class: 'goal-title' }, 'All starter goals complete!'), h('div', { class: 'goal-hint' }, 'Keep growing to reach new milestones and unlock more buildings.')));
    }
    const list = h('ol', { class: 'goal-list' });
    for (const g of GOALS) list.appendChild(h('li', { class: city.goalsDone.has(g.id) ? 'done' : g === next ? 'current' : '' }, h('span', { class: 'chk' }, city.goalsDone.has(g.id) ? icon('check', 14) : ''), g.title));
    b.append(list, h('div', { class: 'section-title' }, 'Milestones'));
    const pop = city.population.residents;
    for (let i = 1; i < MILESTONES.length; i++) {
      const m = MILESTONES[i];
      const done = city.milestoneIndex >= i;
      const prev = MILESTONES[i - 1].population;
      const prog = done ? 1 : Math.max(0, Math.min(1, (pop - prev) / (m.population - prev)));
      b.append(h('div', { class: `ms-row${done ? ' done' : ''}` }, h('div', { class: 'ms-head' }, h('b', null, m.title), h('span', { class: 'muted' }, `${formatInt(m.population)} · ${formatMoney(m.reward)}`)), meter(prog, done ? 'var(--good)' : 'var(--accent)')));
    }
    const ach = city.achievements;
    b.append(h('div', { class: 'section-title' }, `Achievements · ${ach.unlocked.size} of ${ACHIEVEMENTS.length}`));
    const grid = h('div', { class: 'ach-grid' });
    for (const a of ACHIEVEMENTS) {
      const day = ach.unlocked.get(a.id);
      const got = day !== undefined;
      grid.appendChild(
        h('div', { class: `ach${got ? ' got' : ''}`, 'data-tip': got ? `${a.description} Earned on day ${day + 1}.` : a.description },
          h('div', { class: 'ach-icon' }, icon(got ? a.icon : 'lock', 18)),
          h('div', { class: 'ach-title' }, a.title),
        ),
      );
    }
    b.append(grid);
  }

  update(): void {
    if (this.isOpen && Math.random() < 0.05) this.render();
  }
}

// ── Districts ───────────────────────────────────────────────────────────────

export class DistrictsPanel extends Panel {
  readonly id = 'districts';

  constructor(game: Game) {
    super(game, 'Districts', 'districts');
  }

  private districtPolicies(id: number): HTMLElement {
    return districtPolicyRow(this.game, id, () => this.render());
  }

  render(): void {
    const b = this.body;
    const city = this.game.city;
    b.innerHTML = '';
    if (!city) return;
    const tool = this.game.tools.district;
    const painting = this.game.tool.id === 'district';
    b.append(h('div', { class: 'hint' }, 'Districts name your neighbourhoods and track their statistics. Create one, paint it on the map, then enact policies just for that district.'));
    b.append(
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: () => { const d = city.districts.create(); if (d) { this.game.setTool('district', (t: typeof tool) => (t.districtId = d.id)); this.game.play('click'); } this.render(); } }, icon('plus', 14), 'New district'),
        h('button', { class: `btn${painting && tool.districtId === 0 ? ' active' : ''}`, onclick: () => { this.game.setTool('district', (t: typeof tool) => (t.districtId = 0)); this.render(); } }, icon('erase', 14), 'Erase'),
      ),
    );
    const stats = new Map<number, { pop: number; jobs: number; lv: number; n: number }>();
    for (const bb of city.buildings.all.values()) {
      if (!bb.district) continue;
      const s = stats.get(bb.district) ?? { pop: 0, jobs: 0, lv: 0, n: 0 };
      s.pop += bb.residents;
      s.jobs += bb.workers;
      s.lv += bb.landValue;
      s.n++;
      stats.set(bb.district, s);
    }
    if (!city.districts.list.size) b.append(h('div', { class: 'muted small' }, 'No districts yet.'));
    for (const d of city.districts.list.values()) {
      const s = stats.get(d.id);
      const nameInput = h('input', { class: 'name-input', value: d.name, maxlength: '32' }) as HTMLInputElement;
      nameInput.addEventListener('change', () => city.districts.rename(d.id, nameInput.value));
      b.append(
        h('div', { class: `district${painting && tool.districtId === d.id ? ' active' : ''}` },
          h('i', { class: 'swatch', style: `background:rgb(${d.color.map((v) => Math.round(v * 255)).join(',')})` }),
          h('div', { class: 'district-main' }, nameInput, h('div', { class: 'muted small' }, s ? `${formatInt(s.pop)} residents · ${formatInt(s.jobs)} workers · value ${Math.round((s.lv / s.n) * 100)}` : 'Not painted yet')),
          h('button', { class: 'icon-btn', 'data-tip': 'Paint this district', onclick: () => { this.game.setTool('district', (t: typeof tool) => (t.districtId = d.id)); this.render(); } }, icon('brush', 16)),
          h('button', { class: 'icon-btn', 'data-tip': 'Delete district', onclick: () => { city.districts.remove(d.id); projectEconomy(city); this.render(); } }, icon('trash', 16)),
          this.districtPolicies(d.id),
        ),
      );
    }
  }
}

// ── Notification log ────────────────────────────────────────────────────────

/** Row of district policy toggles shown under each district. */
function districtPolicyRow(game: Game, district: number, rerender: () => void): HTMLElement {
  const city = game.city!;
  const pol = city.policies;
  const local = pol.localTo(district);
  let cost = 0;
  for (const id of local) if (!pol.has(id)) cost += pol.costOf(id, district);
  const chips = LOCAL_POLICIES.map((id) => {
    const def = POLICY_BY_ID.get(id)!;
    const locked = city.peakPopulation < def.unlockPopulation;
    const cityWide = pol.has(id);
    const on = cityWide || local.includes(id);
    const tip = locked
      ? `${def.name} · unlocks at ${formatInt(def.unlockPopulation)} population`
      : cityWide
        ? `${def.name} · already city-wide`
        : `${def.name} · ${on ? 'on here' : 'off'}${def.effects[0] ? ' · ' + def.effects[0] : ''}`;
    return h('button', {
      class: `dpol${on ? ' on' : ''}${cityWide ? ' city' : ''}`,
      'data-tip': tip,
      'data-policy': id,
      'aria-label': def.name,
      'aria-pressed': on ? 'true' : 'false',
      disabled: locked || cityWide ? '' : null,
      onclick: () => {
        pol.setLocal(district, id, !on);
        projectEconomy(city);
        game.play(on ? 'click' : 'good');
        rerender();
      },
    }, icon(def.icon, 15));
  });
  const names = local.filter((id) => !pol.has(id)).map((id) => POLICY_BY_ID.get(id)!.name);
  return h('div', { class: 'district-pol' },
    h('div', { class: 'dpol-row' }, ...chips),
    h('div', { class: 'muted small' }, names.length ? `${names.join(', ')}${cost > 0 ? ` · ${formatMoney(cost)}/mo` : ''}` : 'No district policies'),
  );
}

export class LogPanel extends Panel {
  readonly id = 'log';

  constructor(game: Game) {
    super(game, 'Notifications', 'info');
  }

  render(): void {
    const b = this.body;
    const city = this.game.city;
    b.innerHTML = '';
    if (!city) return;
    if (!city.notifications.recent.length) b.append(h('div', { class: 'muted small' }, 'All quiet. Notifications about your city appear here.'));
    for (const n of city.notifications.recent) {
      const el = h('div', { class: `log-item ${n.severity}${n.x !== undefined ? ' clickable' : ''}` }, h('div', { class: 'log-title' }, n.title), h('div', { class: 'log-text' }, n.text));
      if (n.x !== undefined && n.z !== undefined) {
        const x = n.x, z = n.z;
        el.addEventListener('click', () => this.game.flyTo(x, z, 260));
      }
      b.append(el);
    }
  }
}

// ── Public transit ──────────────────────────────────────────────────────────

export class TransitPanel extends Panel {
  readonly id = 'transit';
  private timer = 0;

  constructor(game: Game) {
    super(game, 'Public Transit', 'bus');
  }

  open(): void {
    super.open();
    if (this.game.world) this.game.world.transit.panelOpen = true;
  }

  close(): void {
    super.close();
    if (this.game.world) {
      this.game.world.transit.panelOpen = false;
      this.game.world.transit.setHighlight(0);
    }
  }

  render(): void {
    const b = this.body;
    const city = this.game.city;
    b.innerHTML = '';
    if (!city) return;
    const t = city.transit;
    t.refreshRoutes();
    const locked = city.peakPopulation < TRANSIT_UNLOCK;
    b.append(
      h(
        'div',
        { class: 'hint' },
        locked
          ? `Buses unlock at ${formatInt(TRANSIT_UNLOCK)} residents.`
          : 'Place bus stops along roads, connect them into lines and build a depot. Commuters who live and work near the same line take the bus when it is competitive with driving, which takes cars off the road.',
      ),
    );
    const dis = locked ? '' : null;
    b.append(
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', disabled: dis, onclick: () => this.game.setTool('busStop') }, icon('stop', 14), 'Bus stops'),
        h('button', { class: 'btn primary', disabled: dis, onclick: () => this.game.setTool('busLine') }, icon('plus', 14), 'New line'),
        h('button', { class: 'btn', disabled: dis, onclick: () => this.game.setTool('place', (p: import('../tools/PlaceTool').PlaceTool) => p.configure('bus_depot')) }, icon('bus', 14), 'Depot'),
      ),
    );
    const metro = t.metro;
    metro.refresh();
    b.append(
      h('div', { class: 'section-title' }, 'Network'),
      row('Bus lines · stops', `${t.lines.size} · ${t.stops.size}`),
      row('Metro lines · stations', `${metro.lines.size} · ${metro.stations().length}`),
      row('Riders per day', metro.lines.size ? `${formatInt(t.totalRiders)} (${formatInt(t.busRiders)} bus · ${formatInt(metro.totalRiders)} metro)` : formatInt(t.totalRiders)),
      row('Commuters by transit', formatPct(t.modeShare)),
      row('Fares', `${formatMoney(t.monthlyFares())}/mo`),
      row('Operating cost', `${formatMoney(t.monthlyUpkeep())}/mo`),
    );
    if (!t.lines.size) b.append(h('div', { class: 'muted small' }, 'No bus lines yet.'));
    else b.append(h('div', { class: 'section-title' }, 'Bus lines'));
    for (const line of t.lines.values()) {
      const nameInput = h('input', { class: 'name-input', value: line.name, maxlength: '28' }) as HTMLInputElement;
      nameInput.addEventListener('change', () => (line.name = nameInput.value.trim() || line.name));
      const load = line.capacityPerDay > 0 ? line.ridersPerDay / line.capacityPerDay : 0;
      const problem = lineProblemText(line.problem);
      const focus = () => {
        const st = t.stops.get(line.stops[0]);
        if (st) this.game.flyTo(st.x, st.z, 700);
      };
      const remove = async () => {
        if (await this.game.ui.confirm('Delete bus line', `Remove ${line.name}? Its stops stay in place.`, 'Delete')) {
          deleteLine(city, line.id);
          this.render();
        }
      };
      const setBuses = (n: number) => {
        setLineBuses(city, line.id, n);
        this.render();
      };
      const el = h('div', { class: 'tline' },
        h('div', { class: 'tline-head' },
          h('i', { class: 'swatch', style: `background:#${line.color.toString(16).padStart(6, '0')}` }),
          nameInput,
          h('button', { class: 'icon-btn', 'data-tip': 'Show on map', onclick: focus }, icon('compass', 16)),
          h('button', { class: 'icon-btn', 'data-tip': 'Delete line', onclick: remove }, icon('trash', 16)),
        ),
        h('div', { class: 'muted small' }, `${line.stops.length} stops · ${(line.lengthM / 1000).toFixed(1)} km loop · ${line.loopSeconds ? `${Math.round(line.loopSeconds / 60)} min` : '—'}`),
        problem ? h('div', { class: 'problem' }, icon('info', 14), problem) : null,
        h('div', { class: 'tline-buses' },
          h('span', null, 'Buses'),
          h('button', { class: 'icon-btn', 'aria-label': 'Fewer buses', onclick: () => setBuses(line.buses - 1) }, icon('minus', 14)),
          h('b', null, String(line.buses)),
          h('button', { class: 'icon-btn', 'aria-label': 'More buses', onclick: () => setBuses(line.buses + 1) }, icon('plus', 14)),
          h('span', { class: 'muted small' }, `${formatMoney(line.buses * BUS.upkeepPerBus)}/mo`),
        ),
        row('Riders per day', formatInt(line.ridersPerDay)),
        h('div', { class: 'kv' }, h('span', null, 'Load'), meter(load, load > 0.95 ? 'var(--bad)' : load > 0.75 ? 'var(--warn)' : 'var(--good)')),
        load > 0.95 ? h('div', { class: 'hint small' }, 'Buses are full: add buses to carry more riders.') : null,
      );
      el.addEventListener('mouseenter', () => this.game.world?.transit.setHighlight(line.id));
      el.addEventListener('mouseleave', () => this.game.world?.transit.setHighlight(0));
      b.append(el);
    }
    this.renderMetro(b);
  }

  private renderMetro(b: HTMLElement): void {
    const city = this.game.city!;
    const m = city.transit.metro;
    b.append(h('div', { class: 'section-title' }, 'Metro'));
    if (city.peakPopulation < METRO_UNLOCK) {
      b.append(h('div', { class: 'muted small' }, `The metro unlocks at ${formatInt(METRO_UNLOCK)} residents. Trains run underground, fast and frequent, and carry far more riders than buses.`));
      return;
    }
    b.append(
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => this.game.setTool('place', (p: import('../tools/PlaceTool').PlaceTool) => p.configure('metro_station')) }, icon('metro', 14), 'Station'),
        h('button', { class: 'btn primary', onclick: () => this.game.setTool('metroLine') }, icon('plus', 14), 'New metro line'),
      ),
    );
    if (!m.lines.size) {
      b.append(h('div', { class: 'muted small' }, 'No metro lines yet. Build two or more stations at least 240 m apart, then join them with the Metro Line tool.'));
      return;
    }
    for (const line of m.lines.values()) {
      const nameInput = h('input', { class: 'name-input', value: line.name, maxlength: '28' }) as HTMLInputElement;
      nameInput.addEventListener('change', () => (line.name = nameInput.value.trim() || line.name));
      const load = line.capacityPerDay > 0 ? line.ridersPerDay / line.capacityPerDay : 0;
      const problem = metroProblemText(line.problem);
      const focus = () => {
        const st = m.station(line.stations[0]);
        if (st) this.game.flyTo(st.cx, st.cz, 900);
      };
      const remove = async () => {
        if (await this.game.ui.confirm('Close metro line', `Close ${line.name}? Stations and tunnels stay for future lines.`, 'Close line')) {
          deleteMetroLine(city, line.id);
          this.render();
        }
      };
      const setTrains = (n: number) => {
        setMetroTrains(city, line.id, n);
        projectEconomy(city);
        this.render();
      };
      const headway = line.loopSeconds ? Math.max(1, Math.round(line.loopSeconds / line.trains / 60)) : 0;
      const el = h('div', { class: 'tline' },
        h('div', { class: 'tline-head' },
          h('i', { class: 'swatch', style: `background:#${line.color.toString(16).padStart(6, '0')}` }),
          nameInput,
          h('button', { class: 'icon-btn', 'data-tip': 'Show on map', onclick: focus }, icon('compass', 16)),
          h('button', { class: 'icon-btn', 'data-tip': 'Close line', onclick: remove }, icon('trash', 16)),
        ),
        h('div', { class: 'muted small' }, `${line.stations.length} stations · ${(line.lengthM / 1000).toFixed(1)} km loop · ${line.loopSeconds ? `${Math.round(line.loopSeconds / 60)} min` : '—'}${headway ? ` · a train every ${headway} min` : ''}`),
        problem ? h('div', { class: 'problem' }, icon('info', 14), problem) : null,
        h('div', { class: 'tline-buses' },
          h('span', null, 'Trains'),
          h('button', { class: 'icon-btn', 'aria-label': 'Fewer trains', onclick: () => setTrains(line.trains - 1) }, icon('minus', 14)),
          h('b', null, String(line.trains)),
          h('button', { class: 'icon-btn', 'aria-label': 'More trains', onclick: () => setTrains(line.trains + 1) }, icon('plus', 14)),
          h('span', { class: 'muted small' }, `${formatMoney(line.trains * METRO.upkeepPerTrain)}/mo`),
        ),
        row('Riders per day', formatInt(line.ridersPerDay)),
        h('div', { class: 'kv' }, h('span', null, 'Load'), meter(load, load > 0.95 ? 'var(--bad)' : load > 0.75 ? 'var(--warn)' : 'var(--good)')),
        load > 0.95 ? h('div', { class: 'hint small' }, 'Trains are packed: add trains to carry more riders.') : null,
      );
      el.addEventListener('mouseenter', () => this.game.world?.transit.setHighlight(-line.id));
      el.addEventListener('mouseleave', () => this.game.world?.transit.setHighlight(0));
      b.append(el);
    }
  }

  update(): void {
    if (!this.isOpen) return;
    if (--this.timer > 0 || this.el.matches(':hover')) return;
    this.timer = 60;
    this.render();
  }
}

// ── Policies ────────────────────────────────────────────────────────────────

export class PoliciesPanel extends Panel {
  readonly id = 'policies';

  constructor(game: Game) {
    super(game, 'City Policies', 'policy');
  }

  render(): void {
    const b = this.body;
    const city = this.game.city;
    b.innerHTML = '';
    if (!city) return;
    const pol = city.policies;
    b.append(h('div', { class: 'hint' }, 'Policies here apply to the whole city. Each has a running cost or a trade-off, and you can switch them off at any time. Those marked District can also be enacted for single districts in the Districts panel.'));
    const total = pol.monthlyCost();
    b.append(row('Active policies', `${pol.count()} · ${formatMoney(total)}/mo`));
    for (const def of POLICIES) {
      const lock = pol.lockReason(def.id);
      const locked = !!lock;
      const on = pol.has(def.id);
      const cost = pol.costOf(def.id);
      const toggleBtn = h('button', {
        class: `switch${on ? ' on' : ''}`,
        role: 'switch',
        'aria-checked': on ? 'true' : 'false',
        'aria-label': def.name,
        disabled: locked ? '' : null,
        onclick: () => {
          pol.set(def.id, !on);
          projectEconomy(city);
          this.game.play(on ? 'click' : 'good');
          this.render();
        },
      }, h('i'));
      b.append(
        h('div', { class: `policy${on ? ' on' : ''}${locked ? ' locked' : ''}` },
          h('div', { class: 'policy-icon' }, icon(def.icon, 20)),
          h('div', { class: 'policy-main' },
            h('div', { class: 'policy-title' }, def.name, isLocalPolicy(def.id) ? h('span', { class: 'tag' }, 'District') : null),
            !on && pol.districtsWith(def.id).length
              ? h('div', { class: 'small good-text' }, `In force in ${pol.districtsWith(def.id).map((d) => city.districts.list.get(d)!.name).join(', ')}`)
              : null,
            (def.requiresField || def.requiresStyle) && !locked ? h('div', { class: 'small good-text' }, def.requiresStyle ? 'Made possible by your architects' : 'Made possible by your utility labs') : null,
            h('div', { class: 'muted small' }, locked ? lock : def.description),
            locked ? null : h('ul', { class: 'policy-effects' }, ...def.effects.map((e, i) => h('li', { class: i === def.effects.length - 1 && def.effects.length > 1 ? 'con' : 'pro' }, e))),
            !locked && cost > 0 ? h('div', { class: 'small muted' }, `${on ? 'Costs' : 'Would cost'} ${formatMoney(cost)}/month`) : null,
          ),
          toggleBtn,
        ),
      );
    }
  }
}

// ── Land ────────────────────────────────────────────────────────────────────

/** Map of the city's land parcels; adjacent ones can be bought (expensively). */
export class LandPanel extends Panel {
  readonly id = 'land';

  constructor(game: Game) {
    super(game, 'Land', 'compass');
  }

  render(): void {
    const b = this.body;
    const city = this.game.city;
    b.innerHTML = '';
    if (!city) return;
    const land = city.land;
    if (land.allOwned) {
      b.append(h('div', { class: 'hint' }, 'Your city owns the whole map.'));
      return;
    }
    const ring = land.ringParcels;
    const afford = city.economy.canAfford(land.price);
    b.append(
      h('div', { class: 'hint' }, 'Roads, zoning and buildings only go on land the city owns. Expand outwards by buying the whole ring of land around your city; each ring costs more than the last.'),
      row('Owned', `${land.ownedCount} of ${land.owned.length} parcels`),
      row('Next ring', `${ring.length} parcels · ${formatMoney(land.price)}`),
    );
    const grid = h('div', { class: 'land-grid', role: 'grid', 'aria-label': 'Land parcels' });
    const cam = this.game.cam.goal;
    const here = land.tileAt(cam.x, cam.z);
    for (let i = 0; i < land.owned.length; i++) {
      const owned = land.owned[i] === 1;
      const buyable = land.isBuyable(i);
      const cls = `land-cell${owned ? ' owned' : buyable ? ' buyable' : ''}${i === here ? ' here' : ''}`;
      grid.append(h('button', {
        class: cls,
        'data-tile': String(i),
        'aria-label': owned ? 'Owned parcel' : buyable ? 'Parcel in the next ring' : 'Parcel in a later ring',
        'data-tip': owned ? 'Owned' : buyable ? `Next ring · ${formatMoney(land.price)}` : 'Buy the rings inside it first',
        onclick: () => {
          const c = Land.center(i);
          this.game.flyTo(c.x, c.z, 1400);
          this.render();
        },
      }));
    }
    b.append(
      grid,
      h('div', { class: 'land-legend muted small' }, h('span', { class: 'land-key owned' }), 'Owned', h('span', { class: 'land-key buyable' }), 'Next ring', h('span', { class: 'land-key' }), 'Later rings'),
      h('div', { class: 'land-buy' },
        h('div', null, `Buy the next ring of ${ring.length} parcels for ${formatMoney(land.price)}?`),
        h('button', {
          class: 'btn primary',
          disabled: afford ? null : '',
          onclick: async () => {
            if (!(await this.game.ui.confirm('Buy land', `Buy the next ring of land (${ring.length} parcels) for ${formatMoney(land.price)}? The ring after it costs ${LAND_PRICE_GROWTH}× as much.`, 'Buy land'))) return;
            const res = city.buyLandRing();
            if (!res.ok) this.game.toastError(res.error ?? 'Could not buy land');
            else {
              this.game.play('good');
              this.game.flashMoney(-(res.cost ?? 0));
            }
            this.render();
          },
        }, icon('compass', 15), afford ? 'Buy ring' : 'Not enough money'),
      ),
    );
  }
}
