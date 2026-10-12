import { formatInt, formatMoney } from '../core/math';
import type { Game } from '../game/Game';
import type { Design, Discovery, Plan } from '../sim/research/Generate';
import { describeEffect } from '../sim/research/Generate';
import { FIELD_BY_ID, FIELDS, type FieldId, FUNCTION_LABEL, PRINCIPLE_BY_ID, RESOURCE_BY_ID, TAG_NAMES } from '../sim/research/Knowledge';
import { type Center, REFRESH_DAYS, UPGRADE_COST } from '../sim/research/Research';
import { SERVICE_BY_ID } from '../sim/services/ServiceTypes';
import { h } from './dom';
import { icon } from './icons';
import { Modal } from './Menus';

type Tab = 'centres' | 'discoveries' | 'buildings' | 'history';

const hexCss = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

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

/**
 * The civilization's science in one window: research centres and their
 * experiments, the archive of discoveries and the buildings they designed.
 */
export class ResearchDialog extends Modal {
  private tab: Tab = 'centres';
  private centreId = 0;
  private search = '';
  private filter: FieldId | 'all' = 'all';
  private focus = '';
  private seen = -1;

  constructor(game: Game) {
    super(game, 'Research', 'research-modal');
  }

  open(opts: { tab?: Tab; centreId?: number; discoveryId?: string } = {}): void {
    if (opts.tab) this.tab = opts.tab;
    if (opts.centreId) this.centreId = opts.centreId;
    if (opts.discoveryId) {
      this.tab = 'discoveries';
      this.focus = opts.discoveryId;
      this.search = '';
      this.filter = 'all';
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
    if (active instanceof HTMLInputElement && this.el.contains(active)) return;
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
      ['discoveries', 'Discoveries', r.discoveries.length],
      ['buildings', 'Buildings', r.designs.size],
      ['history', 'Experiment log', r.records.length],
    ];
    b.append(
      h('div', { class: 'rs-tabs', role: 'tablist' },
        ...tabs.map(([id, label, n]) => h('button', { class: `ci-tab${this.tab === id ? ' active' : ''}`, role: 'tab', onclick: () => { this.game.play('click'); this.tab = id; this.render(); } }, label, n ? h('span', { class: 'rs-count' }, String(n)) : null)),
      ),
    );
    if (this.tab === 'centres') this.renderCentres(b);
    else if (this.tab === 'discoveries') this.renderDiscoveries(b);
    else if (this.tab === 'buildings') this.renderBuildings(b);
    else this.renderHistory(b);
    b.scrollTop = keep;
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
          h('div', null, 'Build a Research Center (Services). What surrounds it decides what it specializes in: next to factories it studies industry, by the water it studies water, beside power plants it studies energy. Discoveries can give your city new methods, materials and buildings that no other city has.'),
          h('button', { class: 'btn primary', onclick: () => this.placeCentre() }, icon('build', 14), `Build a Research Center (${formatMoney(SERVICE_BY_ID.get('research_center')!.cost)})`),
        ),
      );
      return;
    }
    if (!r.centers.has(this.centreId)) this.centreId = centres[0].id;
    if (centres.length > 1) {
      b.append(h('div', { class: 'rs-centre-list' }, ...centres.map((c) => {
        const busy = c.active ? (c.active.pending ? 'Decision needed' : `${Math.round(c.active.progress * 100)}%`) : 'Idle';
        return h('button', { class: `rs-centre-pick${c.id === this.centreId ? ' active' : ''}`, style: `--c:${hexCss(FIELD_BY_ID.get(c.field)!.color)}`, onclick: () => { this.centreId = c.id; this.render(); } },
          h('b', null, c.name), h('span', null, `${FIELD_BY_ID.get(c.field)!.name} · ${busy}`));
      })));
    }
    const c = r.centers.get(this.centreId)!;
    const op = r.operational(c);
    const bld = city.buildings.get(c.id);
    const nextCost = UPGRADE_COST[c.equipment + 1];
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
          h('div', null, h('span', { class: 'rs-label' }, 'Status'), h('b', { class: op.ok ? 'good' : 'warn' }, op.ok ? 'Operating' : op.reason ?? '')),
          h('div', null, h('span', { class: 'rs-label' }, 'Equipment'), h('b', null, `Level ${c.equipment} of 3`)),
          h('div', null, h('span', { class: 'rs-label' }, 'Experiments done'), h('b', null, String(c.completed))),
          h('div', null, h('span', { class: 'rs-label' }, 'Education nearby'), h('b', null, `${Math.round(r.education(c) * 100)}%`)),
        ),
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
    const el = h('div', { class: 'rs-active' },
      h('div', { class: 'rs-active-head' },
        h('div', null, h('div', { class: 'rs-plan-title' }, p.title), h('div', { class: 'rs-plan-sub' }, fieldChip(p.field), ` · started day ${a.started} · ${formatMoney(a.spent)} committed, ${formatMoney(p.monthly)}/month`)),
        h('button', { class: 'btn small danger', 'data-tip': 'Stop the experiment. Nothing is refunded, but what was learned makes the next attempt at this method safer.', onclick: async () => {
          if (await this.game.ui.confirm('Abandon experiment', `Stop “${p.title}”? Money already committed is not refunded.`, 'Abandon')) { r.abandon(c.id); this.render(); }
        } }, 'Abandon'),
      ),
      h('div', { class: 'rs-progress' }, h('div', { class: 'meter' }, h('div', { class: 'meter-fill', style: `width:${Math.round(a.progress * 100)}%;background:var(--accent)` })), h('b', null, `${Math.round(a.progress * 100)}%`)),
      h('div', { class: 'rs-muted' }, a.pending ? 'Waiting for your decision.' : a.status, ` · estimated success ${pctRange(odds.chance)}`),
      a.choices.length ? h('div', { class: 'rs-muted' }, 'Decisions so far: ', a.choices.map((ch) => ch.label).join(' → ')) : null,
    );
    if (a.pending) {
      const d = a.pending;
      el.append(
        h('div', { class: 'rs-decision' },
          h('div', { class: 'rs-decision-title' }, icon('flag', 14), d.title),
          h('div', { class: 'rs-decision-prompt' }, d.prompt),
          h('div', { class: 'rs-options' }, ...d.options.map((o) => {
            const after = r.oddsFor(c, p, [{ stage: d.stage, option: o }]);
            const tags: string[] = [];
            if (o.quality) tags.push(`${o.quality > 0 ? 'better' : 'weaker'} results`);
            if (o.cost) tags.push(`+${formatMoney(o.cost)}`);
            if (o.days) tags.push(`${o.days > 0 ? '+' : ''}${o.days} days`);
            if (o.anomaly) tags.push(`may lead into ${FIELD_BY_ID.get(o.anomaly)!.name.toLowerCase()}`);
            const afford = o.cost <= 0 || city.economy.canAfford(o.cost);
            return h('button', { class: 'rs-option', disabled: afford ? null : '', onclick: () => this.act(r.decide(c.id, o.id)) },
              h('b', null, o.label),
              h('span', null, o.detail),
              h('span', { class: 'rs-option-meta' }, `Success ${pctRange(after.chance)}${tags.length ? ` · ${tags.join(' · ')}` : ''}`),
            );
          })),
        ),
      );
    }
    return el;
  }

  private planCard(c: Center, p: Plan): HTMLElement {
    const city = this.game.city!;
    const r = city.research;
    const reqs = r.requirements(c, p);
    const ready = reqs.every((q) => q.ok);
    const fresh = r.oddsFor(c, p);
    const principle = PRINCIPLE_BY_ID.get(p.principle)!;
    return h('div', { class: `rs-plan${p.kind !== 'study' ? ` ${p.kind}` : ''}` },
      h('div', { class: 'rs-plan-top' }, fieldChip(p.field), p.kind === 'synthesis' ? h('span', { class: 'rs-badge info' }, 'Synthesis') : p.kind === 'followup' ? h('span', { class: 'rs-badge warn' }, 'Follow-up') : null),
      h('div', { class: 'rs-plan-title' }, p.title),
      h('div', { class: 'rs-plan-sum' }, p.summary),
      rowsEl([
        ['Method', principle.name],
        ['Substance', RESOURCE_BY_ID.get(p.resource)!.name],
        ['To start', formatMoney(p.cost)],
        ['Running cost', `${formatMoney(p.monthly)}/month`],
        ['Duration', `about ${p.days} days`],
        ['Power', `${(1 + p.power).toFixed(1)} MW spare`],
        ['Success', pctRange(fresh.chance)],
      ]),
      h('div', { class: 'rs-factors' }, ...fresh.factors.map(([k, v]) => h('span', { class: v >= 0 ? 'pos' : 'neg' }, `${k} ${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}`))),
      h('div', { class: 'rs-list' }, h('div', { class: 'rs-label' }, 'Could lead to'), ...p.prospects.map((t) => h('div', null, t))),
      h('div', { class: 'rs-list clues' }, h('div', { class: 'rs-label' }, 'Clues'), ...p.clues.map((t) => h('div', null, t))),
      h('div', { class: 'rs-reqs' }, ...reqs.map((q) => h('div', { class: q.ok ? 'ok' : 'no' }, icon(q.ok ? 'check' : 'close', 12), q.label))),
      h('button', { class: 'btn primary', disabled: ready ? null : '', onclick: () => this.act(r.start(c.id, p.id)) }, icon('play', 13), `Begin (${formatMoney(p.cost)})`),
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
    const link = (x: Discovery) => h('button', { class: 'rs-link', onclick: () => { this.focus = x.id; this.search = ''; this.filter = 'all'; this.render(); } }, x.name);
    return h('div', { class: 'rs-disc', 'data-disc': d.id, style: `--c:${hexCss(FIELD_BY_ID.get(d.field)!.color)}` },
      h('div', { class: 'rs-disc-head' },
        h('div', null, h('div', { class: 'rs-disc-name' }, d.name), h('div', { class: 'rs-disc-class' }, d.classification)),
        h('div', { class: 'rs-disc-tags' }, fieldChip(d.field), outcomeBadge(d.outcome)),
      ),
      h('div', { class: 'rs-disc-desc' }, d.description),
      d.effects.length || d.drawbacks.length
        ? h('div', { class: 'rs-effects' }, ...d.effects.map((e) => h('span', { class: 'pos' }, describeEffect(e))), ...d.drawbacks.map((e) => h('span', { class: 'neg' }, describeEffect(e))))
        : null,
      h('div', { class: 'rs-disc-meta' },
        h('span', null, `Day ${d.day} · ${d.centerName} · quality ${Math.round(d.quality * 100)}%`),
        d.tags.length ? h('span', null, `Knowledge: ${d.tags.map((t) => TAG_NAMES[t] ?? t).join(', ')}`) : null,
      ),
      d.basis.length ? h('div', { class: 'rs-rel' }, h('span', null, 'Built on'), ...d.basis.map(by).filter((x): x is Discovery => !!x).map(link)) : null,
      d.opened.length ? h('div', { class: 'rs-rel' }, h('span', null, 'Opened research'), ...d.opened.map((id) => h('i', null, PRINCIPLE_BY_ID.get(id)?.name ?? id))) : null,
      led.length ? h('div', { class: 'rs-rel' }, h('span', null, 'Led to'), ...led.map(link)) : null,
      design ? h('div', { class: 'rs-rel' }, h('span', null, 'Building'), h('button', { class: 'rs-link', onclick: () => { this.tab = 'buildings'; this.focus = design.id; this.render(); } }, design.name)) : null,
    );
  }

  // ── Buildings ──

  private renderBuildings(b: HTMLElement): void {
    const r = this.game.city!.research;
    const designs = [...r.designs.values()];
    if (!designs.length) {
      b.append(h('div', { class: 'rs-empty' }, icon('build', 30), h('div', { class: 'rs-empty-title' }, 'No buildings designed yet'), h('div', null, 'Experiments taken toward “build a pilot facility” can produce buildings unique to your city, composed from the methods and materials your researchers discovered.')));
      return;
    }
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
    const st = SERVICE_BY_ID.get(d.serviceId);
    const cost = st ? city.research.costOf(st) : d.stats.cost;
    const built = [...city.buildings.all.values()].filter((x) => x.typeId === d.serviceId).length;
    const img = h('img', { class: 'rs-design-img', alt: `${d.name} preview`, draggable: 'false' }) as HTMLImageElement;
    const show = (url: string) => {
      img.src = url;
      img.classList.add('ready');
    };
    const ready = this.game.thumbs.request(`svc:${d.serviceId}`, { kind: 'building', style: d.style, w: d.stats.w, d: d.stats.d, floors: 2, level: 1, seed: 4242 }, show);
    if (ready) show(ready);
    const disc = city.research.discoveries.find((x) => x.id === d.discoveryId);
    return h('div', { class: 'rs-design', 'data-design': d.id, style: `--c:${hexCss(FIELD_BY_ID.get(d.field)!.color)}` },
      h('div', { class: 'rs-design-pic' }, img),
      h('div', { class: 'rs-design-body' },
        h('div', { class: 'rs-disc-name' }, d.name),
        h('div', { class: 'rs-disc-class' }, `${FUNCTION_LABEL[d.fn]} · from ${disc ? disc.name : 'research'}${built ? ` · ${built} built` : ''}`),
        h('div', { class: 'rs-disc-desc' }, d.description),
        rowsEl(designRows(d, cost)),
        h('div', { class: 'rs-traits' }, ...d.traits.slice(0, 8).map((t) => h('span', null, t))),
        h('button', { class: 'btn primary', disabled: city.economy.canAfford(cost) ? null : '', onclick: () => this.build(d) }, icon('build', 13), `Build (${formatMoney(cost)})`),
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
    if (!r.records.length) {
      b.append(h('div', { class: 'rs-empty' }, icon('clock', 30), h('div', { class: 'rs-empty-title' }, 'No experiments run yet')));
      return;
    }
    const list = h('div', { class: 'rs-log' });
    for (const rec of [...r.records].reverse()) {
      const disc = rec.discoveryId ? r.discoveries.find((x) => x.id === rec.discoveryId) : undefined;
      list.append(
        h('div', { class: 'rs-log-row' },
          h('div', { class: 'rs-log-head' }, h('b', null, rec.title), outcomeBadge(rec.outcome)),
          h('div', { class: 'rs-muted' }, `Day ${rec.day} · ${rec.centerName}${rec.chance ? ` · ${Math.round(rec.chance * 100)}% expected` : ''}${rec.decisions.length ? ` · ${rec.decisions.join(' → ')}` : ''}`),
          rec.insight ? h('div', { class: 'rs-insight' }, rec.insight) : null,
          disc ? h('button', { class: 'rs-link', onclick: () => this.open({ discoveryId: disc.id }) }, `Discovered: ${disc.name}`) : null,
        ),
      );
    }
    b.append(list);
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
    b.append(
      h('div', { class: 'rs-reveal', style: `--c:${hexCss(field.color)}` },
        h('div', { class: 'rs-reveal-kicker' }, d.outcome === 'unexpected' ? 'An unexpected discovery' : d.outcome === 'breakthrough' ? 'A breakthrough' : d.outcome === 'partial' ? 'A partial result' : 'A new discovery'),
        h('div', { class: 'rs-reveal-name' }, d.name),
        h('div', { class: 'rs-disc-tags' }, fieldChip(d.field), h('span', { class: 'rs-muted' }, d.classification)),
        design ? h('div', { class: 'rs-design-pic big' }, img) : null,
        h('div', { class: 'rs-disc-desc' }, d.description),
        d.effects.length || d.drawbacks.length ? h('div', null, h('div', { class: 'section-title' }, 'What changes now'), h('div', { class: 'rs-effects' }, ...d.effects.map((e) => h('span', { class: 'pos' }, describeEffect(e))), ...d.drawbacks.map((e) => h('span', { class: 'neg' }, describeEffect(e))))) : null,
        design ? h('div', null, h('div', { class: 'section-title' }, 'A building only your city has'), rowsEl(designRows(design, st ? r.costOf(st) : design.stats.cost))) : null,
        d.opened.length ? h('div', null, h('div', { class: 'section-title' }, 'New lines of research'), h('div', { class: 'rs-traits' }, ...d.opened.map((id) => h('span', null, PRINCIPLE_BY_ID.get(id)?.name ?? id)))) : null,
        d.tags.length && !d.opened.length ? h('div', { class: 'hint small' }, `Your scientists now understand ${d.tags.map((t) => TAG_NAMES[t] ?? t).join(' and ')}: related experiments get safer.`) : null,
      ),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', onclick: () => { this.close(); this.game.ui.research.open({ discoveryId: d.id }); } }, 'Open the archive'),
        design ? h('button', { class: 'btn primary', onclick: () => { this.close(); this.game.ui.research.open({ tab: 'buildings' }); } }, icon('build', 14), 'See the building') : h('button', { class: 'btn primary', onclick: () => this.close() }, 'Continue'),
      ),
    );
    this.open();
  }
}
