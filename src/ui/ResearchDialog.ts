import { formatInt, formatMoney } from '../core/math';
import type { Game } from '../game/Game';
import { Clock } from '../sim/Clock';
import { projectEconomy } from '../sim/CitySim';
import { DAYS_PER_MONTH } from '../sim/constants';
import type { Decision, DecisionOption, Design, Discovery, Plan } from '../sim/research/Generate';
import { availablePrinciples, describeEffect } from '../sim/research/Generate';
import { FIELD_BY_ID, FIELDS, type FieldId, FUNCTION_LABEL, PRINCIPLES, PRINCIPLE_BY_ID, RESOURCE_BY_ID, TAG_NAMES } from '../sim/research/Knowledge';
import { POLICIES } from '../sim/policies/Policies';
import { MASTERY_NAMES, MASTERY_STEPS, MILESTONES, masteryLevel } from '../sim/research/Progress';
import { AUTO_DECIDE_DAYS, type Center, ITERATE_AFTER_DAYS, REFRESH_DAYS, type RetrofitOffer, UPGRADE_COST } from '../sim/research/Research';
import { SERVICE_BY_ID, SERVICE_TYPES, type ServiceType } from '../sim/services/ServiceTypes';
import { h } from './dom';
import { icon } from './icons';
import { Modal } from './Menus';

type Tab = 'centres' | 'web' | 'discoveries' | 'buildings' | 'history';

const hexCss = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const fieldColor = (f: FieldId) => hexCss(FIELD_BY_ID.get(f)!.color);

function fieldChip(f: FieldId): HTMLElement {
  const def = FIELD_BY_ID.get(f)!;
  return h('span', { class: 'rs-chip', style: `--c:${hexCss(def.color)}` }, def.name);
}

const OUTCOME_LABEL: Record<string, [string, string]> = {
  breakthrough: ['Breakthrough', 'good'],
  success: ['Success', 'good'],
  partial: ['Partial success', 'warn'],
  unexpected: ['Unexpected discovery', 'info'],
  failure: ['Failed — insight gained', 'bad'],
  interrupted: ['Interrupted', 'bad'],
  abandoned: ['Abandoned', 'warn'],
};

function outcomeBadge(o: string): HTMLElement {
  const [label, cls] = OUTCOME_LABEL[o] ?? [o, 'info'];
  return h('span', { class: `rs-badge ${cls}` }, label);
}

const pctRange = (p: number) => `${Math.max(5, Math.round((p - 0.07) * 100))}–${Math.min(97, Math.round((p + 0.07) * 100))}%`;
const dateOf = (day: number) => Clock.monthLabel(Math.floor(day / DAYS_PER_MONTH));

/** Stat rows for a generated building, from its real numbers. */
export function designRows(d: Design, cost: number): [string, string][] {
  const s = d.stats;
  const rows: [string, string][] = [['Function', FUNCTION_LABEL[d.fn]], ['Footprint', `${s.w} × ${s.d} m`], ['Cost', formatMoney(cost)], ['Upkeep', `${formatMoney(s.upkeep)}/month`]];
  if (s.output && s.kind === 'power') rows.push(['Output', `${s.output} MW`]);
  if (s.storage) rows.push(['Storage', `up to ${s.storage} MW at the peak`]);
  if (s.output && (s.kind === 'water' || s.kind === 'sewage')) rows.push(['Capacity', `${formatInt(s.output)} m³/day`]);
  if (s.capacity && s.kind !== 'garbage') rows.push(['Serves', `${formatInt(s.capacity)} residents`]);
  if (s.kind === 'garbage') rows.push(['Processes', `${formatInt(s.capacity)} units/day`]);
  if (s.radius) rows.push(['Reach', `${s.radius} m radius`]);
  if (s.attractiveness) rows.push(['Attractiveness', `${Math.round(s.attractiveness * 100)}%`]);
  if (s.tourism) rows.push(['Tourism', `up to ${formatMoney(s.tourism)}/month`]);
  if (s.pollution > 0) rows.push(['Pollution', s.pollution > 0.45 ? 'High' : s.pollution > 0.2 ? 'Moderate' : 'Low']);
  if (s.pollution < 0) rows.push(['Air cleaning', `${Math.round(-s.pollution * 100)}% strength`]);
  if (s.jobs) rows.push(['Jobs', `${s.jobs}`]);
  rows.push(['Placement', s.needsShore ? 'Beside a road, on a shoreline' : 'Beside a road']);
  return rows;
}

function rowsEl(rows: [string, string][]): HTMLElement {
  return h('div', { class: 'rs-grid' }, ...rows.flatMap(([k, v]) => [h('span', null, k), h('b', null, v)]));
}

/** A labelled bar: `value` 0–1, or a diverging bar around the middle when `centred`. */
function bar(label: string, value: number, text: string, opts: { centred?: boolean; tone?: 'pos' | 'neg' | 'neutral' } = {}): HTMLElement {
  const v = Math.max(-1, Math.min(1, value));
  const tone = opts.tone ?? (opts.centred ? (v > 0 ? 'pos' : v < 0 ? 'neg' : 'neutral') : 'neutral');
  const fill = opts.centred
    ? h('i', { class: `rs-bar-fill ${tone}`, style: v >= 0 ? `left:50%;width:${Math.abs(v) * 50}%` : `left:${50 - Math.abs(v) * 50}%;width:${Math.abs(v) * 50}%` })
    : h('i', { class: `rs-bar-fill ${tone}`, style: `left:0;width:${Math.max(0, v) * 100}%` });
  return h('div', { class: 'rs-bar' }, h('span', null, label), h('div', { class: `rs-bar-track${opts.centred ? ' centred' : ''}` }, fill), h('b', null, text));
}

const SVG = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...children: (SVGElement | string)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(c);
  return el;
}

const trim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * The civilization's science in one window: research centres and their
 * experiments, the knowledge web, the archive of discoveries, the buildings
 * they designed and a timeline of every experiment.
 */
export class ResearchDialog extends Modal {
  private tab: Tab = 'centres';
  private centreId = 0;
  private search = '';
  private filter: FieldId | 'all' = 'all';
  private focus = '';
  private seen = -1;
  /** Partner chosen for a proposal before it starts. */
  private partnerFor = new Map<string, number>();
  private logField: FieldId | 'all' = 'all';
  private logKind: 'all' | 'found' | 'setback' | 'milestone' = 'all';

  constructor(game: Game) {
    super(game, 'Research', 'research-modal');
  }

  open(opts: { tab?: Tab; centreId?: number; discoveryId?: string; designId?: string } = {}): void {
    if (opts.tab) this.tab = opts.tab;
    if (opts.centreId) this.centreId = opts.centreId;
    if (opts.discoveryId) {
      this.tab = 'discoveries';
      this.focus = opts.discoveryId;
      this.search = '';
      this.filter = 'all';
    }
    if (opts.designId) {
      this.tab = 'buildings';
      this.focus = opts.designId;
    }
    this.render();
    super.open();
  }

  /** Keeps the window current while experiments run (not while the pointer is over it). */
  update(): void {
    const city = this.game.city;
    if (!this.isOpen || !city || city.research.version === this.seen) return;
    if (this.el.querySelector('.modal')?.matches(':hover') && this.tab !== 'centres') return;
    const active = document.activeElement;
    if ((active instanceof HTMLInputElement || active instanceof HTMLSelectElement) && this.el.contains(active)) return;
    this.render();
  }

  private render(): void {
    const city = this.game.city;
    const b = this.body;
    const keep = b.scrollTop;
    b.innerHTML = '';
    if (!city) return;
    const r = city.research;
    this.seen = r.version;
    const tabs: [Tab, string, number][] = [
      ['centres', 'Research centres', r.centers.size],
      ['web', 'Knowledge web', r.milestones.size],
      ['discoveries', 'Discoveries', r.discoveries.length],
      ['buildings', 'Buildings', r.designs.size],
      ['history', 'Experiment log', r.records.length],
    ];
    if (r.centers.size) b.append(this.controls());
    b.append(
      h('div', { class: 'rs-tabs', role: 'tablist' },
        ...tabs.map(([id, label, n]) => h('button', { class: `ci-tab${this.tab === id ? ' active' : ''}`, role: 'tab', onclick: () => { this.game.play('click'); this.tab = id; this.render(); } }, label, n ? h('span', { class: 'rs-count' }, String(n)) : null)),
      ),
    );
    if (this.tab === 'centres') this.renderCentres(b);
    else if (this.tab === 'web') this.renderWeb(b);
    else if (this.tab === 'discoveries') this.renderDiscoveries(b);
    else if (this.tab === 'buildings') this.renderBuildings(b);
    else this.renderHistory(b);
    b.scrollTop = keep;
  }

  // ── Budget, decisions and staff ──

  private controls(): HTMLElement {
    const city = this.game.city!;
    const r = city.research;
    const readout = h('b', null);
    const show = () => {
      const speed = 0.4 + 0.6 * r.funding;
      readout.textContent = `${Math.round(r.funding * 100)}% · work ×${speed.toFixed(2)} · ${formatMoney(r.monthlyCost())}/month now`;
    };
    show();
    const slider = h('input', { type: 'range', class: 'rs-budget', min: '50', max: '200', step: '5', value: String(Math.round(r.funding * 100)), 'aria-label': 'Research budget' }) as HTMLInputElement;
    slider.addEventListener('input', () => {
      r.setFunding(Number(slider.value) / 100);
      show();
    });
    slider.addEventListener('change', () => {
      projectEconomy(city);
      slider.blur();
      this.render();
    });
    const seg = (on: boolean, label: string, tip: string) => h('button', { class: `rs-seg-btn${r.autoDecide === on ? ' active' : ''}`, 'data-tip': tip, onclick: () => { r.autoDecide = on; r.version++; this.game.play('click'); this.render(); } }, label);
    const u = r.universities();
    const centres = [...r.centers.values()];
    const edu = centres.length ? centres.reduce((a, c) => a + r.education(c), 0) / centres.length : 0;
    return h('div', { class: 'rs-controls' },
      h('div', { class: 'rs-control' }, h('span', { class: 'rs-label' }, 'Research budget'), slider, readout),
      h('div', { class: 'rs-control' },
        h('span', { class: 'rs-label' }, `If a decision waits ${AUTO_DECIDE_DAYS} days`),
        h('div', { class: 'rs-seg' },
          seg(false, 'Wait for me', 'The experiment pauses until you decide.'),
          seg(true, 'Take the careful option', 'Your scientists choose the safest option and carry on.')),
      ),
      h('div', { class: 'rs-control', 'data-tip': 'Education coverage around your centres improves the odds; every university (up to three) adds trained staff: better odds and faster work.' },
        h('span', { class: 'rs-label' }, 'Staff'),
        h('b', null, `${u ? `${u} universit${u === 1 ? 'y' : 'ies'}` : 'No university'} · education ${Math.round(edu * 100)}%`),
        u ? null : h('span', { class: 'rs-muted' }, 'A university trains researchers'),
      ),
    );
  }

  // ── Centres ──

  private renderCentres(b: HTMLElement): void {
    const game = this.game;
    const city = game.city!;
    const r = city.research;
    const centres = [...r.centers.values()];
    if (!centres.length) {
      b.append(
        h('div', { class: 'rs-empty' },
          icon('flask', 30),
          h('div', { class: 'rs-empty-title' }, 'No research centre yet'),
          h('div', null, 'Build a Research Center (Services). What surrounds it decides what it specializes in: next to factories it studies industry, by the water it studies water, beside power plants it studies energy. Discoveries can give your city new methods, materials, policies and buildings that no other city has.'),
          h('button', { class: 'btn primary', onclick: () => this.placeCentre() }, icon('build', 14), `Build a Research Center (${formatMoney(SERVICE_BY_ID.get('research_center')!.cost)})`),
        ),
      );
      return;
    }
    if (!r.centers.has(this.centreId)) this.centreId = centres[0].id;
    const guide = this.guide();
    if (guide) b.append(guide);
    const briefs = r.briefs();
    if (briefs.length) {
      b.append(h('div', { class: 'rs-briefs' },
        h('div', { class: 'section-title' }, 'City briefs', h('span', { class: 'rs-muted' }, ' · proposals that answer one come with a council grant')),
        h('div', { class: 'rs-brief-row' }, ...briefs.slice(0, 4).map((br) => h('div', { class: 'rs-brief', style: `--c:${fieldColor(br.field)}` },
          h('div', { class: 'rs-brief-head' }, h('b', null, br.title), h('span', { class: 'rs-badge warn' }, `${Math.round(br.grant * 100)}% grant`)),
          h('div', { class: 'rs-brief-text' }, br.text),
          h('div', { class: 'rs-brief-foot' }, fieldChip(br.field),
            br.x !== undefined ? h('button', { class: 'rs-link', onclick: () => { this.close(); game.flyTo(br.x!, br.z!, 320); } }, icon('compass', 12), 'Show') : null),
        ))),
      ));
    }
    if (centres.length > 1) {
      b.append(h('div', { class: 'rs-centre-list' }, ...centres.map((c) => {
        const busy = c.assisting !== undefined ? `Helping ${r.centers.get(c.assisting)?.name ?? ''}` : c.active ? (c.active.pending ? 'Decision needed' : `${Math.round(c.active.progress * 100)}%`) : 'Idle';
        return h('button', { class: `rs-centre-pick${c.id === this.centreId ? ' active' : ''}${c.active?.pending ? ' alert' : ''}`, style: `--c:${fieldColor(c.field)}`, onclick: () => { this.centreId = c.id; this.render(); } },
          h('b', null, c.name), h('span', null, `${FIELD_BY_ID.get(c.field)!.name} · ${busy}`));
      })));
    }
    const c = r.centers.get(this.centreId)!;
    const op = r.operational(c);
    const bld = city.buildings.get(c.id);
    const nextCost = UPGRADE_COST[c.equipment + 1];
    const mastery = Object.entries(c.mastery ?? {}).filter(([, xp]) => (xp ?? 0) > 0).sort((a, b2) => (b2[1] ?? 0) - (a[1] ?? 0)) as [FieldId, number][];
    b.append(
      h('div', { class: 'rs-centre' },
        h('div', { class: 'rs-centre-head' },
          h('div', null,
            h('div', { class: 'rs-centre-name' }, c.name),
            h('div', { class: 'rs-centre-sub' }, 'Specializes in ', fieldChip(c.field), ' · also works in ', ...c.secondary.flatMap((f, i) => [fieldChip(f), i < c.secondary.length - 1 ? ' ' : '']))),
          h('div', { class: 'rs-centre-actions' },
            bld ? h('button', { class: 'btn small', onclick: () => { this.close(); game.flyTo(bld.cx, bld.cz, 260); } }, icon('compass', 13), 'Show') : null,
            c.equipment < 3
              ? h('button', { class: 'btn small', 'data-tip': 'Better equipment raises success chances, speeds work up, offers more proposals and reaches harder methods.', disabled: city.economy.canAfford(nextCost) ? null : '', onclick: () => this.act(r.upgrade(c.id)) }, icon('upgrade', 13), `Equip to level ${c.equipment + 1} (${formatMoney(nextCost)})`)
              : h('span', { class: 'rs-muted' }, 'Fully equipped'),
          ),
        ),
        h('div', { class: 'rs-centre-meta' },
          h('div', null, h('span', { class: 'rs-label' }, 'Status'), h('b', { class: op.ok ? 'good' : 'warn' }, c.assisting !== undefined ? `Helping ${r.centers.get(c.assisting)?.name ?? 'another centre'}` : op.ok ? 'Operating' : op.reason ?? '')),
          h('div', null, h('span', { class: 'rs-label' }, 'Equipment'), h('b', null, `Level ${c.equipment} of 3`)),
          h('div', null, h('span', { class: 'rs-label' }, 'Experiments done'), h('b', null, String(c.completed))),
          h('div', null, h('span', { class: 'rs-label' }, 'Education nearby'), h('b', null, `${Math.round(r.education(c) * 100)}%`)),
        ),
        mastery.length
          ? h('div', { class: 'rs-mastery' }, h('span', { class: 'rs-label' }, 'Experience'), ...mastery.map(([f, xp]) => this.masteryChip(f, xp)))
          : null,
        h('details', { class: 'rs-details' },
          h('summary', null, 'Why this specialization, and what it can work with'),
          h('div', { class: 'rs-two' },
            h('div', null, h('div', { class: 'section-title' }, 'The site'), ...c.factors.map((f) => h('div', { class: 'rs-factor' }, fieldChip(f.field), h('span', null, f.label)))),
            h('div', null, h('div', { class: 'section-title' }, 'Substances'), this.substances(c)),
          ),
        ),
      ),
    );
    if (c.active) b.append(this.activeBlock(c));
    if (c.assisting !== undefined) {
      const lead = r.centers.get(c.assisting);
      if (lead) b.append(h('div', { class: 'hint small' }, `This centre is helping ${lead.name} with “${lead.active?.plan.title ?? 'an experiment'}”. It can start its own work when that finishes.`, ' ', h('button', { class: 'rs-link', onclick: () => { this.centreId = lead.id; this.render(); } }, 'Go to it')));
    }
    b.append(h('div', { class: 'rs-section-head' },
      h('div', { class: 'section-title' }, c.active ? 'Next proposals' : 'Proposals'),
      h('button', {
        class: 'btn small',
        disabled: city.clock.day - c.lastRefresh < REFRESH_DAYS ? '' : null,
        'data-tip': `Your scientists can draft fresh proposals every ${REFRESH_DAYS} days.`,
        onclick: () => { if (r.refresh(c, true)) this.render(); },
      }, icon('dice', 13), city.clock.day - c.lastRefresh < REFRESH_DAYS ? `New proposals in ${REFRESH_DAYS - (city.clock.day - c.lastRefresh)} days` : 'Ask for new proposals')));
    if (!c.offers.length) b.append(h('div', { class: 'hint small' }, op.ok ? 'No proposals right now. Ask again later, discover more, or build a centre somewhere else.' : 'Proposals arrive once the centre is open and has spare power.'));
    const grid = h('div', { class: 'rs-plans' });
    for (const p of c.offers) grid.append(this.planCard(c, p));
    b.append(grid);
  }

  private masteryChip(f: FieldId, xp: number): HTMLElement {
    const level = masteryLevel(xp);
    const next = MASTERY_STEPS[level + 1];
    const tip = `${MASTERY_NAMES[level]} in ${FIELD_BY_ID.get(f)!.name}: +${level * 3}% success and better results.${next !== undefined ? ` ${Math.ceil((next - xp) * 2) / 2} more experience to ${MASTERY_NAMES[level + 1]}.` : ''}`;
    return h('span', { class: 'rs-mchip', style: `--c:${fieldColor(f)}`, 'data-tip': tip },
      FIELD_BY_ID.get(f)!.name.split(' ')[0], ' ',
      h('span', { class: 'rs-dots' }, ...[1, 2, 3].map((k) => h('i', { class: k <= level ? 'on' : '' }))),
    );
  }

  /** Walks a first-time player through their first experiment. */
  private guide(): HTMLElement | null {
    const r = this.game.city!.research;
    if (r.guideDone) return null;
    const anyActive = [...r.centers.values()].find((c) => c.active);
    const steps = [
      { title: 'Pick a proposal', text: 'Each card below is an experiment your scientists could run: what it costs, how long it takes, its chance of success and what it could lead to. Proposals marked “Pilot facility” can become a building only your city has.', done: !!anyActive || r.records.length > 0 },
      { title: 'Let it run', text: 'Unpause the game. The experiment advances day by day; the bar shows how far along it is.', done: !!anyActive?.active?.pending || r.records.length > 0 || (anyActive?.active?.choices.length ?? 0) > 0 },
      { title: 'Make the calls', text: 'Every so often the team asks you to decide: the approach, where to test a pilot, how to handle a setback. Each option shows how it moves the odds, the result, the cost and the time.', done: r.records.length > 0 },
      { title: 'See what you found', text: 'Discoveries land in the archive and on the Knowledge web, where you can also see what they open next. New buildings appear under Buildings, ready to build.', done: r.discoveries.length > 0 },
    ];
    const at = steps.findIndex((s) => !s.done);
    return h('div', { class: 'rs-guide' },
      h('div', { class: 'rs-guide-head' }, icon('flask', 15), h('b', null, 'Your first experiment'), h('button', { class: 'rs-link', onclick: () => { r.dismissGuide(); this.render(); } }, at < 0 ? 'Done' : 'Hide guide')),
      h('ol', { class: 'rs-guide-steps' }, ...steps.map((s, i) => h('li', { class: s.done ? 'done' : i === at ? 'now' : '' },
        h('span', { class: 'rs-guide-n' }, s.done ? icon('check', 11) : String(i + 1)),
        h('div', null, h('b', null, s.title), i === at ? h('div', { class: 'rs-muted' }, s.text) : null),
      ))),
    );
  }

  private substances(c: Center): HTMLElement {
    const reach = this.game.city!.research.resourcesFor(c);
    return h('div', { class: 'rs-subs' }, ...[...reach.entries()].map(([id, v]) => {
      const res = RESOURCE_BY_ID.get(id)!;
      const tip = `${res.name} — ${res.source}. ${Object.entries(res.props).map(([k, x]) => `${k} ${Math.round((x as number) * 100)}%`).join(', ')}${v.ok ? '' : `. ${v.why}`}`;
      return h('span', { class: `rs-sub${v.ok ? '' : ' off'}`, 'data-tip': tip }, res.name);
    }));
  }

  private activeBlock(c: Center): HTMLElement {
    const city = this.game.city!;
    const r = city.research;
    const a = c.active!;
    const p = a.plan;
    const odds = r.oddsFor(c, p);
    const partner = a.partnerId !== undefined ? r.centers.get(a.partnerId) : undefined;
    const speed = r.speedOf(c);
    const el = h('div', { class: 'rs-active' },
      h('div', { class: 'rs-active-head' },
        h('div', null,
          h('div', { class: 'rs-plan-title' }, p.title),
          h('div', { class: 'rs-plan-sub' }, fieldChip(p.field), ` · started ${dateOf(a.started)} · ${formatMoney(a.spent)} committed, ${formatMoney(Math.round(p.monthly * r.funding))}/month`),
          partner ? h('div', { class: 'rs-plan-sub' }, icon('people', 12), `Joint work with ${partner.name}`) : null,
        ),
        h('button', { class: 'btn small danger', 'data-tip': 'Stop the experiment. Nothing is refunded, but what was learned makes the next attempt at this method safer.', onclick: async () => {
          if (await this.game.ui.confirm('Abandon experiment', `Stop “${p.title}”? Money already committed is not refunded.`, 'Abandon')) { r.abandon(c.id); this.render(); }
        } }, 'Abandon'),
      ),
      h('div', { class: 'rs-progress' }, h('div', { class: 'meter' }, h('div', { class: 'meter-fill', style: `width:${Math.round(a.progress * 100)}%;background:var(--accent)` })), h('b', null, `${Math.round(a.progress * 100)}%`)),
      h('div', { class: 'rs-muted' },
        a.pending ? (r.autoDecide ? `Waiting for your decision (the team decides after ${AUTO_DECIDE_DAYS} days)` : 'Waiting for your decision') : `${a.status} · work speed ×${speed.toFixed(2)}`,
        ` · estimated success ${pctRange(odds.chance)}`),
      a.choices.length ? h('div', { class: 'rs-muted' }, 'Decisions so far: ', a.choices.map((ch) => ch.label).join(' → ')) : null,
    );
    if (a.pending) el.append(this.decisionBlock(c, a.pending));
    return el;
  }

  /** A pending decision: each option with what it does to the odds, the result, the cost and the time. */
  private decisionBlock(c: Center, d: Decision): HTMLElement {
    const city = this.game.city!;
    const r = city.research;
    const p = c.active!.plan;
    const now = r.oddsFor(c, p).chance;
    const maxQ = Math.max(0.15, ...d.options.map((o) => Math.abs(o.quality)));
    const maxCost = Math.max(1, ...d.options.map((o) => o.cost));
    const maxDays = Math.max(3, ...d.options.map((o) => Math.abs(o.days)));
    const card = (o: DecisionOption) => {
      const after = r.oddsFor(c, p, [{ stage: d.stage, option: o }]).chance;
      const afford = o.cost <= 0 || city.economy.canAfford(o.cost);
      return h('button', { class: 'rs-option', disabled: afford ? null : '', onclick: () => this.act(r.decide(c.id, o.id)) },
        h('b', null, o.label),
        h('span', null, o.detail),
        h('div', { class: 'rs-bars' },
          bar('Success', after, `${Math.round(after * 100)}%${Math.round((after - now) * 100) ? ` (${after > now ? '+' : '−'}${Math.abs(Math.round((after - now) * 100))})` : ''}`, { tone: after >= now ? 'pos' : 'neg' }),
          bar('Result', o.quality / maxQ, o.quality > 0 ? 'better' : o.quality < 0 ? 'weaker' : 'no change', { centred: true }),
          bar('Cost', o.cost / maxCost, o.cost ? formatMoney(o.cost) : 'free', { tone: o.cost ? 'neg' : 'neutral' }),
          bar('Time', o.days / maxDays, o.days ? `${o.days > 0 ? '+' : '−'}${Math.abs(o.days)} days` : 'no change', { centred: true, tone: o.days > 0 ? 'neg' : o.days < 0 ? 'pos' : 'neutral' }),
        ),
        o.anomaly ? h('span', { class: 'rs-option-meta' }, `May lead into ${FIELD_BY_ID.get(o.anomaly)!.name.toLowerCase()}`) : null,
        o.publish ? h('span', { class: 'rs-option-meta' }, 'Ends the experiment now') : null,
      );
    };
    const sites = d.options.filter((o) => o.site);
    return h('div', { class: 'rs-decision' },
      h('div', { class: 'rs-decision-title' }, icon('flag', 14), d.title),
      h('div', { class: 'rs-decision-prompt' }, d.prompt),
      h('div', { class: 'rs-options' }, ...d.options.map(card)),
      sites.length
        ? h('div', { class: 'rs-sites' }, h('span', { class: 'rs-muted' }, 'See the sites:'), ...sites.map((o) => h('button', { class: 'rs-link', onclick: () => { this.close(); this.game.flyTo(o.site!.x, o.site!.z, 300); } }, icon('compass', 12), o.label)))
        : null,
    );
  }

  private planCard(c: Center, p: Plan): HTMLElement {
    const city = this.game.city!;
    const r = city.research;
    const reqs = r.requirements(c, p);
    const ready = reqs.every((q) => q.ok);
    const partners = r.partnersFor(c);
    let partnerId = this.partnerFor.get(p.id);
    if (partnerId !== undefined && !partners.some((x) => x.id === partnerId)) partnerId = undefined;
    const fresh = r.oddsFor(c, p, [], partnerId);
    const principle = PRINCIPLE_BY_ID.get(p.principle)!;
    const badge = p.kind === 'synthesis' ? h('span', { class: 'rs-badge info' }, 'Synthesis') : p.kind === 'followup' ? h('span', { class: 'rs-badge warn' }, 'Follow-up') : p.kind === 'iteration' ? h('span', { class: 'rs-badge good' }, 'Next version') : null;
    let partnerEl: HTMLElement | null = null;
    if (partners.length) {
      const sel = h('select', { class: 'rs-partner', 'aria-label': 'Work with another centre' },
        h('option', { value: '' }, 'Work alone'),
        ...partners.map((x) => h('option', { value: String(x.id), selected: x.id === partnerId ? '' : null }, `Jointly with ${x.name}`)),
      ) as HTMLSelectElement;
      sel.addEventListener('change', () => {
        if (sel.value) this.partnerFor.set(p.id, Number(sel.value));
        else this.partnerFor.delete(p.id);
        sel.blur();
        this.render();
      });
      partnerEl = h('label', { class: 'rs-partner-row', 'data-tip': 'An idle centre can join in: +8% success, better results and 30% faster work. It can’t run its own experiment meanwhile, and both centres gain experience.' }, icon('people', 13), sel);
    }
    return h('div', { class: `rs-plan${p.kind !== 'study' ? ` ${p.kind}` : ''}${p.brief ? ' brief' : ''}` },
      h('div', { class: 'rs-plan-top' }, fieldChip(p.field), badge, p.brief ? h('span', { class: 'rs-badge warn', 'data-tip': p.brief.text }, `City brief: ${p.brief.title}`) : null),
      h('div', { class: 'rs-plan-title' }, p.title),
      h('div', { class: 'rs-plan-sum' }, p.summary),
      rowsEl([
        ['Method', principle.name],
        ['Substance', RESOURCE_BY_ID.get(p.resource)!.name],
        ['To start', p.grant ? `${formatMoney(p.cost)} (council pays ${formatMoney(p.grant)})` : formatMoney(p.cost)],
        ['Running cost', `${formatMoney(Math.round(p.monthly * r.funding))}/month`],
        ['Duration', `about ${r.estimateDays(c, p, partnerId)} days`],
        ['Power', `${(1 + p.power).toFixed(1)} MW spare`],
        ['Success', pctRange(fresh.chance)],
      ]),
      h('div', { class: 'rs-factors' }, ...fresh.factors.map(([k, v]) => h('span', { class: v >= 0 ? 'pos' : 'neg' }, `${k} ${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}`))),
      h('div', { class: 'rs-list' }, h('div', { class: 'rs-label' }, 'Could lead to'), ...p.prospects.map((t) => h('div', null, t))),
      h('div', { class: 'rs-list clues' }, h('div', { class: 'rs-label' }, 'Clues'), ...p.clues.map((t) => h('div', null, t))),
      h('div', { class: 'rs-reqs' }, ...reqs.map((q) => h('div', { class: q.ok ? 'ok' : 'no' }, icon(q.ok ? 'check' : 'close', 12), q.label))),
      partnerEl,
      h('button', { class: 'btn primary', disabled: ready ? null : '', onclick: () => { this.partnerFor.delete(p.id); this.act(r.start(c.id, p.id, partnerId)); } }, icon('play', 13), `Begin (${formatMoney(p.cost)})`),
    );
  }

  private act(res: { ok: boolean; error?: string }): void {
    if (!res.ok) {
      this.game.toastError(res.error ?? 'Not possible');
      return;
    }
    this.game.play('click');
    this.render();
  }

  private placeCentre(): void {
    this.close();
    this.game.ui.toolbar.select('services');
    this.game.setTool('place', (t: import('../tools/PlaceTool').PlaceTool) => t.configure('research_center'));
    this.game.ui.toolbar.renderTray();
  }

  // ── Knowledge web ──

  private renderWeb(b: HTMLElement): void {
    const r = this.game.city!.research;
    const sum = r.summary();
    // The web itself.
    b.append(h('div', { class: 'section-title' }, 'Knowledge web', h('span', { class: 'rs-muted' }, ' · what your scientists know, what it led to, and what lies just beyond')));
    b.append(h('div', { class: 'rs-web-legend' },
      h('span', null, h('i', { class: 'lg found' }), 'Discovery (click to open)'),
      h('span', null, h('i', { class: 'lg open' }), 'Open line of research'),
      h('span', null, h('i', { class: 'lg hint' }), 'Glimpsed: needs more knowledge'),
      h('span', null, h('i', { class: 'lg edge' }), 'Built on / opened'),
    ));
    b.append(h('div', { class: 'rs-web-wrap' }, this.web()));
    // Milestones: reached and under way first; untouched ones fold away.
    b.append(h('div', { class: 'section-title' }, 'Milestones', h('span', { class: 'rs-muted' }, ` · ${r.milestones.size} of ${MILESTONES.length} reached`)));
    const frac = (m: (typeof MILESTONES)[number]) => {
      const [have, need] = m.progress(sum);
      return Math.min(1, have / need);
    };
    const ms = [...MILESTONES].sort((x, y) => Number(r.milestones.has(y.id)) - Number(r.milestones.has(x.id)) || frac(y) - frac(x));
    const card = (m: (typeof MILESTONES)[number]) => {
      const [have, need] = m.progress(sum);
      const done = r.milestones.has(m.id);
      return h('div', { class: `rs-milestone${done ? ' done' : ''}`, style: m.field ? `--c:${fieldColor(m.field)}` : '' },
        h('div', { class: 'rs-milestone-head' }, done ? icon('milestone', 14) : icon('flag', 14), h('b', null, m.title)),
        h('div', { class: 'rs-muted' }, m.goal),
        h('div', { class: 'meter' }, h('div', { class: 'meter-fill', style: `width:${Math.round((Math.min(have, need) / need) * 100)}%` })),
        h('div', { class: 'rs-milestone-foot' }, h('span', null, done ? `Reached ${dateOf(r.milestoneDays.get(m.id) ?? 0)}` : `${Math.min(have, need)} of ${need}`), h('span', { class: 'rs-reward' }, m.reward)),
      );
    };
    const shown = ms.filter((m) => r.milestones.has(m.id) || frac(m) > 0);
    const rest = ms.filter((m) => !shown.includes(m));
    b.append(h('div', { class: 'rs-milestones' }, ...(shown.length ? shown : rest.slice(0, 4)).map(card)));
    const folded = shown.length ? rest : rest.slice(4);
    if (folded.length) b.append(h('details', { class: 'rs-details' }, h('summary', null, `${folded.length} more milestones`), h('div', { class: 'rs-milestones' }, ...folded.map(card))));
    // Mastery by centre.
    const centres = [...r.centers.values()];
    if (centres.length) {
      b.append(h('div', { class: 'section-title' }, 'Experience by centre'));
      b.append(h('div', { class: 'rs-mtable' },
        h('div', { class: 'rs-mrow head' }, h('span', null, ''), ...FIELDS.map((f) => h('span', { style: `color:${fieldColor(f.id)}`, 'data-tip': f.name }, f.name.split(' ')[0]))),
        ...centres.map((c) => h('div', { class: 'rs-mrow' }, h('span', null, c.name),
          ...FIELDS.map((f) => {
            const l = r.masteryOf(c, f.id);
            return h('span', { 'data-tip': `${MASTERY_NAMES[l]} · ${c.mastery?.[f.id] ?? 0} experience` }, h('span', { class: 'rs-dots' }, ...[1, 2, 3].map((k) => h('i', { class: k <= l ? 'on' : '', style: `--c:${fieldColor(f.id)}` }))));
          }))),
      ));
    }
  }

  private web(): SVGSVGElement {
    const city = this.game.city!;
    const r = city.research;
    const civ = r.civ();
    const colW = 156, nodeW = 140, nodeH = 44, rowH = 60, top = 40;
    const pos = new Map<string, { x: number; y: number }>();
    const nodes: SVGElement[] = [];
    const edges: SVGElement[] = [];
    const open = new Set(availablePrinciples(civ).map((p) => p.id));
    const studied = new Set(r.discoveries.map((d) => d.principle));
    let rows = 1;
    FIELDS.forEach((f, col) => {
      const x = col * colW + 8;
      nodes.push(svg('text', { x: x + nodeW / 2, y: 18, 'text-anchor': 'middle', class: 'web-head', fill: hexCss(f.color) }, trim(f.name, 22)));
      const found = r.discoveries.filter((d) => d.field === f.id).sort((a, b) => a.day - b.day);
      let row = 0;
      for (const d of found) {
        const y = top + row * rowH;
        pos.set(d.id, { x, y });
        const g = svg('g', { class: 'web-node found', tabindex: 0, role: 'button' },
          svg('rect', { x, y, width: nodeW, height: nodeH, rx: 7, fill: '#1b2230', stroke: hexCss(f.color), 'stroke-width': 1.5 }),
          svg('rect', { x, y, width: 4, height: nodeH, rx: 2, fill: hexCss(f.color) }),
          svg('text', { x: x + 11, y: y + 18, class: 'web-name' }, trim(d.name, 21)),
          svg('text', { x: x + 11, y: y + 34, class: 'web-sub' }, `${d.kind === 'design' ? 'Facility' : d.kind === 'modifier' ? 'Method' : d.kind === 'component' ? 'Material' : 'Theory'} · ${Math.round(d.quality * 100)}%`),
          svg('title', {}, `${d.name}\n${d.classification}\nDay ${d.day}, ${d.centerName}`),
        );
        g.addEventListener('click', () => this.open({ discoveryId: d.id }));
        nodes.push(g);
        row++;
      }
      // The frontier: methods in this field not yet studied.
      const frontier = PRINCIPLES.filter((p) => p.field === f.id && !studied.has(p.id))
        .map((p) => ({ p, open: open.has(p.id), known: (p.needs ?? []).filter((t) => civ.tags.has(t)).length }))
        .filter((x) => x.open || x.known > 0)
        .sort((a, b) => Number(b.open) - Number(a.open) || b.known - a.known)
        .slice(0, 4);
      for (const fr of frontier) {
        const y = top + row * rowH;
        pos.set(`p:${fr.p.id}`, { x, y });
        const needs = (fr.p.needs ?? []).map((t) => `${TAG_NAMES[t] ?? t}${civ.tags.has(t) ? ' ✓' : ''}`).join(', ');
        nodes.push(svg('g', { class: `web-node ${fr.open ? 'open' : 'hint'}` },
          svg('rect', { x, y, width: nodeW, height: nodeH, rx: 7, fill: 'none', stroke: hexCss(f.color), 'stroke-width': 1.2, 'stroke-dasharray': fr.open ? '5 4' : '2 4', opacity: fr.open ? 0.9 : 0.5 }),
          svg('text', { x: x + 11, y: y + 18, class: `web-name${fr.open ? '' : ' blur'}` }, fr.open ? trim(fr.p.name, 21) : '? ? ?'),
          svg('text', { x: x + 11, y: y + 34, class: 'web-sub' }, fr.open ? (fr.p.build ? `Could become a ${trim(FUNCTION_LABEL[fr.p.build], 14)}` : 'Open to study') : `Needs ${trim(needs, 18)}`),
          svg('title', {}, fr.open ? `${fr.p.name}: open to your centres working in ${f.name.toLowerCase()}.${fr.p.build ? ` Could become a ${FUNCTION_LABEL[fr.p.build]}.` : ''}` : `Something in ${f.name.toLowerCase()} is just out of reach. Needs: ${needs}.`),
        ));
        row++;
      }
      rows = Math.max(rows, row);
    });
    const link = (a: { x: number; y: number }, b: { x: number; y: number }, cls: string) => {
      const sameCol = Math.abs(a.x - b.x) < 1;
      const x1 = sameCol ? a.x + nodeW / 2 : a.x < b.x ? a.x + nodeW : a.x;
      const y1 = sameCol ? a.y + nodeH : a.y + nodeH / 2;
      const x2 = sameCol ? b.x + nodeW / 2 : a.x < b.x ? b.x : b.x + nodeW;
      const y2 = sameCol ? b.y : b.y + nodeH / 2;
      const d = sameCol ? `M${x1},${y1} C${x1 + 26},${y1 + 18} ${x2 + 26},${y2 - 18} ${x2},${y2}` : `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;
      edges.push(svg('path', { d, class: `web-edge ${cls}` }));
    };
    for (const d of r.discoveries) {
      const to = pos.get(d.id);
      if (!to) continue;
      for (const bId of d.basis) {
        const from = pos.get(bId);
        if (from) link(from, to, 'basis');
      }
      for (const pid of d.opened) {
        const fr = pos.get(`p:${pid}`);
        if (fr) link(to, fr, 'opened');
      }
    }
    const width = FIELDS.length * colW + 8;
    const height = top + rows * rowH + 10;
    return svg('svg', { class: 'rs-web', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Knowledge web' }, ...edges, ...nodes);
  }

  // ── Discoveries ──

  private renderDiscoveries(b: HTMLElement): void {
    const r = this.game.city!.research;
    if (!r.discoveries.length) {
      b.append(h('div', { class: 'rs-empty' }, icon('flask', 30), h('div', { class: 'rs-empty-title' }, 'Nothing discovered yet'), h('div', null, 'Every experiment that succeeds adds to this archive: what was found, why it matters and what it led to.')));
      return;
    }
    const input = h('input', { class: 'rs-search', type: 'search', placeholder: 'Search discoveries, methods, substances…', value: this.search }) as HTMLInputElement;
    input.addEventListener('input', () => {
      this.search = input.value;
      this.renderList(list);
    });
    const used = new Set(r.discoveries.map((d) => d.field));
    b.append(
      h('div', { class: 'rs-filters' }, input,
        h('div', { class: 'rs-filter-row' },
          h('button', { class: `rs-filter${this.filter === 'all' ? ' active' : ''}`, onclick: () => { this.filter = 'all'; this.render(); } }, 'All fields'),
          ...FIELDS.filter((f) => used.has(f.id)).map((f) => h('button', { class: `rs-filter${this.filter === f.id ? ' active' : ''}`, style: `--c:${hexCss(f.color)}`, onclick: () => { this.filter = f.id; this.render(); } }, f.name)),
        ),
      ),
    );
    const list = h('div', { class: 'rs-disc-list' });
    b.append(list);
    this.renderList(list);
  }

  private renderList(list: HTMLElement): void {
    const r = this.game.city!.research;
    list.innerHTML = '';
    const q = this.search.trim().toLowerCase();
    const matches = r.discoveries.filter((d) => (this.filter === 'all' || d.field === this.filter) && (!q || [d.name, d.classification, d.description, PRINCIPLE_BY_ID.get(d.principle)?.name ?? '', RESOURCE_BY_ID.get(d.resource)?.name ?? ''].join(' ').toLowerCase().includes(q)));
    if (!matches.length) list.append(h('div', { class: 'hint small' }, 'No discoveries match.'));
    for (const d of [...matches].reverse()) list.append(this.discoveryCard(d));
    if (this.focus) {
      const el = list.querySelector(`[data-disc="${this.focus}"]`);
      el?.scrollIntoView({ block: 'center' });
      el?.classList.add('focus');
      this.focus = '';
    }
  }

  private discoveryCard(d: Discovery): HTMLElement {
    const r = this.game.city!.research;
    const by = (id: string) => r.discoveries.find((x) => x.id === id);
    const led = r.discoveries.filter((x) => x.basis.includes(d.id));
    const design = d.designId ? r.designs.get(d.designId) : undefined;
    const retro = r.retrofitOffers().find((o) => o.id === d.id);
    const link = (x: Discovery) => h('button', { class: 'rs-link', onclick: () => { this.focus = x.id; this.search = ''; this.filter = 'all'; this.render(); } }, x.name);
    return h('div', { class: 'rs-disc', 'data-disc': d.id, style: `--c:${fieldColor(d.field)}` },
      h('div', { class: 'rs-disc-head' },
        h('div', null, h('div', { class: 'rs-disc-name' }, d.name), h('div', { class: 'rs-disc-class' }, d.classification)),
        h('div', { class: 'rs-disc-tags' }, fieldChip(d.field), outcomeBadge(d.outcome)),
      ),
      h('div', { class: 'rs-disc-desc' }, d.description),
      d.effects.length || d.drawbacks.length
        ? h('div', { class: 'rs-effects' }, ...d.effects.map((e) => h('span', { class: 'pos' }, describeEffect(e))), ...d.drawbacks.map((e) => h('span', { class: 'neg' }, describeEffect(e))))
        : null,
      retro ? this.retrofitBlock(retro) : null,
      h('div', { class: 'rs-disc-meta' },
        h('span', null, `${dateOf(d.day)} · ${d.centerName} · quality ${Math.round(d.quality * 100)}%`),
        d.tags.length ? h('span', null, `Knowledge: ${d.tags.map((t) => TAG_NAMES[t] ?? t).join(', ')}`) : null,
      ),
      d.basis.length ? h('div', { class: 'rs-rel' }, h('span', null, 'Built on'), ...d.basis.map(by).filter((x): x is Discovery => !!x).map(link)) : null,
      d.opened.length ? h('div', { class: 'rs-rel' }, h('span', null, 'Opened research'), ...d.opened.map((id) => h('i', null, PRINCIPLE_BY_ID.get(id)?.name ?? id))) : null,
      led.length ? h('div', { class: 'rs-rel' }, h('span', null, 'Led to'), ...led.map(link)) : null,
      design ? h('div', { class: 'rs-rel' }, h('span', null, 'Building'), h('button', { class: 'rs-link', onclick: () => { this.tab = 'buildings'; this.focus = design.id; this.render(); } }, design.name)) : null,
    );
  }

  private retrofitBlock(o: RetrofitOffer): HTMLElement {
    const city = this.game.city!;
    const r = city.research;
    const done = r.retrofits.get(o.id);
    return h('div', { class: `rs-retrofit${o.applied ? ' done' : ''}` },
      h('div', { class: 'rs-retrofit-head' }, icon('upgrade', 14), h('b', null, o.title), o.applied ? h('span', { class: 'rs-badge good' }, 'In effect') : null),
      h('div', { class: 'rs-muted' }, o.summary),
      o.applied
        ? h('div', { class: 'rs-muted' }, `Carried out ${dateOf(done?.day ?? 0)} on ${o.buildings} building${o.buildings === 1 ? '' : 's'} for ${formatMoney(o.cost)}.`)
        : o.buildings
          ? h('button', { class: 'btn small', disabled: city.economy.canAfford(o.cost) ? null : '', onclick: () => this.act(r.applyRetrofit(o.id)) }, icon('build', 13), `Retrofit ${o.buildings} ${o.targetLabel} (${formatMoney(o.cost)})`)
          : h('div', { class: 'rs-muted' }, `No ${o.targetLabel} to retrofit yet.`),
    );
  }

  // ── Buildings ──

  private renderBuildings(b: HTMLElement): void {
    const r = this.game.city!.research;
    const designs = [...r.designs.values()];
    const offers = r.retrofitOffers();
    if (offers.length) {
      b.append(h('div', { class: 'section-title' }, 'Retrofit programmes', h('span', { class: 'rs-muted' }, ' · bring discoveries to the buildings you already have')));
      b.append(h('div', { class: 'rs-retrofits' }, ...offers.map((o) => this.retrofitBlock(o))));
    }
    if (!designs.length) {
      b.append(h('div', { class: 'rs-empty' }, icon('build', 30), h('div', { class: 'rs-empty-title' }, 'No buildings designed yet'), h('div', null, 'Experiments taken toward “build a pilot facility” can produce buildings unique to your city, composed from the methods and materials your researchers discovered. Once one has been in service a while, your scientists can develop its next version.')));
      return;
    }
    if (offers.length) b.append(h('div', { class: 'section-title' }, 'Your buildings'));
    const grid = h('div', { class: 'rs-designs' });
    for (const d of designs.reverse()) grid.append(this.designCard(d));
    b.append(grid);
    if (this.focus) {
      const el = grid.querySelector(`[data-design="${this.focus}"]`);
      el?.scrollIntoView({ block: 'center' });
      el?.classList.add('focus');
      this.focus = '';
    }
  }

  private designCard(d: Design): HTMLElement {
    const city = this.game.city!;
    const r = city.research;
    const st = SERVICE_BY_ID.get(d.serviceId);
    const cost = st ? r.costOf(st) : d.stats.cost;
    const built = [...city.buildings.all.values()].filter((x) => x.typeId === d.serviceId).length;
    const img = h('img', { class: 'rs-design-img', alt: `${d.name} preview`, draggable: 'false' }) as HTMLImageElement;
    const show = (url: string) => {
      img.src = url;
      img.classList.add('ready');
    };
    const ready = this.game.thumbs.request(`svc:${d.serviceId}`, { kind: 'building', style: d.style, w: d.stats.w, d: d.stats.d, floors: 2, level: 1, seed: 4242 }, show);
    if (ready) show(ready);
    const disc = r.discoveries.find((x) => x.id === d.discoveryId);
    const rec = r.records.find((x) => x.discoveryId === d.discoveryId);
    const prev = d.lineage ? r.designs.get(d.lineage) : undefined;
    const next = [...r.designs.values()].find((x) => x.lineage === d.id);
    const name = h('input', { class: 'rs-rename', value: d.name, maxlength: '40', 'aria-label': 'Building name', 'data-tip': 'Rename this building' }) as HTMLInputElement;
    const commit = () => {
      if (name.value.trim() && name.value !== d.name && r.renameDesign(d.id, name.value)) {
        this.game.play('click');
        this.game.ui.toolbar.renderTray();
      }
      name.blur();
      this.render();
    };
    name.addEventListener('change', commit);
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') {
        name.value = d.name;
        name.blur();
      }
      e.stopPropagation();
    });
    const inService = d.builtDay !== undefined ? city.clock.day - d.builtDay : -1;
    const history: [string, string][] = [];
    if (disc) history.push(['Discovered', `${dateOf(disc.day)} at ${disc.centerName}`]);
    if (rec?.decisions.length) history.push(['Decisions', rec.decisions.join(' → ')]);
    if (rec?.partner) history.push(['Jointly with', rec.partner]);
    history.push(['Version', `${d.version ?? 1}${prev ? ` (developed from ${prev.name})` : ''}`]);
    history.push(['In service', d.builtDay !== undefined ? `since ${dateOf(d.builtDay)}, ${built} built` : 'not built yet']);
    if (!next && (d.version ?? 1) < 4) history.push(['Next version', d.builtDay === undefined ? `Build one: after ${ITERATE_AFTER_DAYS} days in service your scientists can develop it further` : inService >= ITERATE_AFTER_DAYS ? 'Ready to develop: look for it among the proposals' : `Can be developed in ${ITERATE_AFTER_DAYS - inService} days`]);
    if (next) history.push(['Superseded by', next.name]);
    return h('div', { class: 'rs-design', 'data-design': d.id, style: `--c:${fieldColor(d.field)}` },
      h('div', { class: 'rs-design-pic' }, img),
      h('div', { class: 'rs-design-body' },
        name,
        h('div', { class: 'rs-disc-class' }, `${FUNCTION_LABEL[d.fn]} · ${disc && disc.name !== d.name ? `from ${disc.name}` : `designed at ${disc?.centerName ?? 'your research centre'}`}${built ? ` · ${built} built` : ''}`),
        h('div', { class: 'rs-disc-desc' }, d.description),
        rowsEl(designRows(d, cost)),
        h('div', { class: 'rs-traits' }, ...d.traits.slice(0, 8).map((t) => h('span', null, t))),
        h('button', { class: 'btn primary', disabled: city.economy.canAfford(cost) ? null : '', onclick: () => this.build(d) }, icon('build', 13), `Build (${formatMoney(cost)})`),
        h('details', { class: 'rs-details' }, h('summary', null, 'History'), rowsEl(history)),
        this.compare(d, cost),
      ),
    );
  }

  /** The design against the city's ordinary buildings that do the same job. */
  private compare(d: Design, cost: number): HTMLElement | null {
    const city = this.game.city!;
    const peers = SERVICE_TYPES.filter((t) => t.kind === d.stats.kind && !t.designId && t.kind !== 'research' && !(d.stats.storage && !t.storage) && t.id !== d.serviceId).slice(0, 5);
    if (!peers.length) return null;
    const s = d.stats;
    const main = (t: { kind: string; output: number; capacity: number; attractiveness: number; storage?: number }) =>
      t.kind === 'power' ? (t.storage ? `${t.storage} MW stored` : `${t.output} MW`) : t.kind === 'water' || t.kind === 'sewage' ? `${formatInt(t.output)} m³/day` : t.capacity ? formatInt(t.capacity) : t.attractiveness ? `${Math.round(t.attractiveness * 100)}%` : '—';
    const poll = (v: number) => (v > 0.45 ? 'High' : v > 0.2 ? 'Moderate' : v > 0 ? 'Low' : v < 0 ? 'Cleans' : 'None');
    const row = (label: string, t: { cost: number; upkeep: number; radius: number; pollution: number; kind: string; output: number; capacity: number; attractiveness: number; storage?: number }, c: number, mine: boolean) =>
      h('tr', { class: mine ? 'mine' : '' }, h('td', null, label), h('td', null, formatMoney(c)), h('td', null, formatMoney(t.upkeep)), h('td', null, main(t)), h('td', null, t.radius ? `${t.radius} m` : '—'), h('td', null, poll(t.pollution)));
    return h('details', { class: 'rs-details' },
      h('summary', null, `Compare with ${peers.length === 1 ? peers[0].name : `${peers.length} similar buildings`}`),
      h('table', { class: 'rs-compare' },
        h('thead', null, h('tr', null, ...['Building', 'Cost', 'Upkeep', s.kind === 'power' || s.kind === 'water' || s.kind === 'sewage' ? 'Output' : s.capacity ? 'Serves' : 'Appeal', 'Reach', 'Pollution'].map((x) => h('th', null, x)))),
        h('tbody', null, row(d.name, { ...s }, cost, true), ...peers.map((t: ServiceType) => row(t.name, t, city.research.costOf(t), false))),
      ),
    );
  }

  private build(d: Design): void {
    this.close();
    this.game.ui.toolbar.select(d.stats.category === 'landmarks' ? 'parks' : d.stats.category);
    this.game.setTool('place', (t: import('../tools/PlaceTool').PlaceTool) => t.configure(d.serviceId));
    this.game.ui.toolbar.renderTray();
  }

  // ── History ──

  private renderHistory(b: HTMLElement): void {
    const r = this.game.city!.research;
    if (!r.records.length && !r.milestones.size) {
      b.append(h('div', { class: 'rs-empty' }, icon('clock', 30), h('div', { class: 'rs-empty-title' }, 'No experiments run yet')));
      return;
    }
    const kinds: [typeof this.logKind, string][] = [['all', 'Everything'], ['found', 'Discoveries'], ['setback', 'Setbacks'], ['milestone', 'Milestones']];
    const used = new Set(r.records.map((x) => x.field));
    b.append(h('div', { class: 'rs-filters' },
      h('div', { class: 'rs-filter-row' }, ...kinds.map(([k, label]) => h('button', { class: `rs-filter${this.logKind === k ? ' active' : ''}`, onclick: () => { this.logKind = k; this.render(); } }, label))),
      h('div', { class: 'rs-filter-row' },
        h('button', { class: `rs-filter${this.logField === 'all' ? ' active' : ''}`, onclick: () => { this.logField = 'all'; this.render(); } }, 'All fields'),
        ...FIELDS.filter((f) => used.has(f.id)).map((f) => h('button', { class: `rs-filter${this.logField === f.id ? ' active' : ''}`, style: `--c:${hexCss(f.color)}`, onclick: () => { this.logField = f.id; this.render(); } }, f.name)),
      ),
    ));
    type Entry = { day: number; el: HTMLElement; important: boolean };
    const entries: Entry[] = [];
    if (this.logKind !== 'milestone') {
      for (const rec of r.records) {
        if (this.logField !== 'all' && rec.field !== this.logField) continue;
        const found = !!rec.discoveryId;
        if (this.logKind === 'found' && !found) continue;
        if (this.logKind === 'setback' && found) continue;
        const disc = rec.discoveryId ? r.discoveries.find((x) => x.id === rec.discoveryId) : undefined;
        const important = rec.outcome === 'breakthrough' || rec.outcome === 'unexpected' || !!disc?.designId;
        entries.push({
          day: rec.day,
          important,
          el: h('div', { class: `rs-tl-item${important ? ' key' : ''}`, style: `--c:${fieldColor(rec.field)}` },
            h('i', { class: 'rs-tl-dot' }),
            h('div', null,
              h('div', { class: 'rs-log-head' }, h('b', null, rec.title), outcomeBadge(rec.outcome)),
              h('div', { class: 'rs-muted' }, `Day ${rec.day} · ${rec.centerName}${rec.partner ? ` with ${rec.partner}` : ''}${rec.chance ? ` · ${Math.round(rec.chance * 100)}% expected` : ''}${rec.decisions.length ? ` · ${rec.decisions.join(' → ')}` : ''}`),
              rec.insight ? h('div', { class: 'rs-insight' }, rec.insight) : null,
              disc ? h('button', { class: 'rs-link', onclick: () => this.open({ discoveryId: disc.id }) }, `Discovered: ${disc.name}`) : null,
            ),
          ),
        });
      }
    }
    if ((this.logKind === 'all' || this.logKind === 'milestone') && this.logField === 'all') {
      for (const id of r.milestones) {
        const m = MILESTONES.find((x) => x.id === id);
        if (!m) continue;
        entries.push({
          day: r.milestoneDays.get(id) ?? 0,
          important: true,
          el: h('div', { class: 'rs-tl-item key rs-tl-ms' }, h('i', { class: 'rs-tl-dot' }), h('div', null, h('div', { class: 'rs-log-head' }, h('b', null, `Milestone: ${m.title}`), h('span', { class: 'rs-badge good' }, 'Reached')), h('div', { class: 'rs-muted' }, `${m.goal} · ${m.reward}`))),
        });
      }
    }
    if (!entries.length) {
      b.append(h('div', { class: 'hint small' }, 'Nothing matches.'));
      return;
    }
    entries.sort((a, b2) => b2.day - a.day);
    const tl = h('div', { class: 'rs-timeline' });
    let month = -1;
    for (const e of entries) {
      const m = Math.floor(e.day / DAYS_PER_MONTH);
      if (m !== month) {
        month = m;
        tl.append(h('div', { class: 'rs-tl-month' }, Clock.monthLabel(m)));
      }
      tl.append(e.el);
    }
    b.append(tl);
  }
}

/** The moment of discovery: what was found, why it matters and what it opens. */
export class DiscoveryDialog extends Modal {
  constructor(game: Game) {
    super(game, 'Discovery', 'discovery-modal');
  }

  show(id: string): void {
    const city = this.game.city;
    const d = city?.research.discoveries.find((x) => x.id === id);
    if (!city || !d) return;
    const r = city.research;
    const design = d.designId ? r.designs.get(d.designId) : undefined;
    const field = FIELD_BY_ID.get(d.field)!;
    const retro = r.retrofitOffers().find((o) => o.id === d.id);
    const b = this.body;
    b.innerHTML = '';
    const img = h('img', { class: 'rs-design-img', alt: '', draggable: 'false' }) as HTMLImageElement;
    if (design) {
      const show = (url: string) => {
        img.src = url;
        img.classList.add('ready');
      };
      const ready = this.game.thumbs.request(`svc:${design.serviceId}`, { kind: 'building', style: design.style, w: design.stats.w, d: design.stats.d, floors: 2, level: 1, seed: 4242 }, show);
      if (ready) show(ready);
    }
    const st = design ? SERVICE_BY_ID.get(design.serviceId) : undefined;
    // The first discovery in a field can make a new policy possible.
    const firstInField = r.discoveries.filter((x) => x.field === d.field).length === 1;
    const unlocked = firstInField ? POLICIES.filter((p) => p.requiresField === d.field && !city.policies.lockReason(p.id)) : [];
    b.append(
      h('div', { class: 'rs-reveal', style: `--c:${hexCss(field.color)}` },
        h('div', { class: 'rs-reveal-kicker' }, d.outcome === 'unexpected' ? 'An unexpected discovery' : d.outcome === 'breakthrough' ? 'A breakthrough' : d.outcome === 'partial' ? 'A partial result' : 'A new discovery'),
        h('div', { class: 'rs-reveal-name' }, d.name),
        h('div', { class: 'rs-disc-tags' }, fieldChip(d.field), h('span', { class: 'rs-muted' }, d.classification)),
        design ? h('div', { class: 'rs-design-pic big' }, img) : null,
        h('div', { class: 'rs-disc-desc' }, d.description),
        d.effects.length || d.drawbacks.length ? h('div', null, h('div', { class: 'section-title' }, 'What changes now'), h('div', { class: 'rs-effects' }, ...d.effects.map((e) => h('span', { class: 'pos' }, describeEffect(e))), ...d.drawbacks.map((e) => h('span', { class: 'neg' }, describeEffect(e))))) : null,
        design ? h('div', null, h('div', { class: 'section-title' }, (design.version ?? 1) > 1 ? 'The next version of your building' : 'A building only your city has'), rowsEl(designRows(design, st ? r.costOf(st) : design.stats.cost))) : null,
        retro && !retro.applied ? h('div', null, h('div', { class: 'section-title' }, 'A retrofit is possible'), h('div', { class: 'rs-muted' }, retro.summary)) : null,
        unlocked.length ? h('div', { class: 'hint small' }, `New policy available: ${unlocked.map((p) => p.name).join(', ')} (City Info → Policies).`) : null,
        d.opened.length ? h('div', null, h('div', { class: 'section-title' }, 'New lines of research'), h('div', { class: 'rs-traits' }, ...d.opened.map((pid) => h('span', null, PRINCIPLE_BY_ID.get(pid)?.name ?? pid)))) : null,
        d.tags.length && !d.opened.length ? h('div', { class: 'hint small' }, `Your scientists now understand ${d.tags.map((t) => TAG_NAMES[t] ?? t).join(' and ')}: related experiments get safer.`) : null,
      ),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', onclick: () => { this.close(); this.game.ui.research.open({ discoveryId: d.id }); } }, 'Open the archive'),
        design ? h('button', { class: 'btn primary', onclick: () => { this.close(); this.game.ui.research.open({ designId: design.id }); } }, icon('build', 14), 'See the building') : h('button', { class: 'btn primary', onclick: () => this.close() }, 'Continue'),
      ),
    );
    this.open();
  }
}

