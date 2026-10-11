import type { Game } from '../game/Game';
import type { DemandFactor, DemandFix } from '../sim/demand/Demand';
import type { DemandKind } from '../sim/types';
import { Zone } from '../sim/types';
import { h } from './dom';
import { icon } from './icons';

const KINDS: [DemandKind, string, string, Zone][] = [
  ['residential', 'Residential', 'r', Zone.ResLow],
  ['commercial', 'Commercial', 'c', Zone.Commercial],
  ['industrial', 'Industrial', 'i', Zone.Industrial],
  ['office', 'Office', 'o', Zone.Office],
];

const FIX_LABEL: Record<DemandFix, string> = {
  budget: 'Open Budget',
  policies: 'Open Policies',
  'zone-res': 'Zone housing',
  'zone-com': 'Zone commercial',
  'zone-ind': 'Zone industry',
  'zone-office': 'Zone offices',
  roads: 'Build roads',
  transit: 'Transit tools',
  services: 'Build services',
  parks: 'Build parks',
  traffic: 'Show traffic',
  landValue: 'Show land value',
  happiness: 'Show happiness',
  education: 'Build schools',
};

/**
 * Development demand, opened by clicking the R C I O bars: one tab per zone
 * type listing every factor with its numbers, and for the ones holding
 * demand back, what to do about it with a button that goes there.
 */
export class DemandPanel {
  readonly el: HTMLElement;
  private tabs = new Map<DemandKind, { btn: HTMLElement; val: HTMLElement }>();
  private body: HTMLElement;
  private kind: DemandKind = 'residential';
  private timer = 0;
  private sig = '';

  constructor(private game: Game, private anchor: HTMLElement) {
    const tabRow = h('div', { class: 'dp-tabs', role: 'tablist' });
    for (const [k, label, cls] of KINDS) {
      const val = h('span', { class: 'dp-tab-val' });
      const btn = h('button', { class: `dp-tab ${cls}`, role: 'tab', 'data-kind': k, onclick: () => this.show(k) }, h('span', { class: `dp-dot ${cls}` }), label, val);
      this.tabs.set(k, { btn, val });
      tabRow.append(btn);
    }
    this.body = h('div', { class: 'dp-body' });
    this.el = h(
      'div',
      { class: 'demand-pop hidden', role: 'dialog', 'aria-label': 'Development demand' },
      h('div', { class: 'dp-head' }, h('span', { class: 'dp-title' }, 'Development demand'), h('button', { class: 'icon-btn small', 'aria-label': 'Close', onclick: () => this.close() }, icon('close', 14))),
      tabRow,
      this.body,
    );
    // Clicks elsewhere close it; clicks on the bars are handled by the bars themselves.
    document.addEventListener('pointerdown', (e) => {
      if (!this.isOpen) return;
      const t = e.target as Node;
      if (!this.el.contains(t) && !this.anchor.contains(t)) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.isOpen) {
        this.close();
        e.stopPropagation();
      }
    }, true);
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }

  /** Clicking a bar opens its tab; clicking the open tab's bar again closes the panel. */
  toggle(kind: DemandKind): void {
    if (this.isOpen && this.kind === kind) this.close();
    else {
      if (!this.isOpen) this.game.play('open');
      this.el.classList.remove('hidden');
      this.anchor.classList.add('open');
      this.show(kind);
    }
  }

  close(): void {
    if (!this.isOpen) return;
    this.game.play('close');
    this.el.classList.add('hidden');
    this.anchor.classList.remove('open');
  }

  private show(kind: DemandKind): void {
    this.kind = kind;
    this.sig = '';
    this.render();
  }

  update(dt: number): void {
    if (!this.isOpen) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.5;
    this.render();
  }

  private render(): void {
    const city = this.game.city;
    if (!city) return;
    const d = city.demand;
    for (const [k, t] of this.tabs) {
      t.val.textContent = String(Math.round(d.value[k]));
      t.btn.classList.toggle('active', k === this.kind);
      t.btn.setAttribute('aria-selected', k === this.kind ? 'true' : 'false');
    }
    const factors = d.factors[this.kind];
    const value = Math.round(d.value[this.kind]);
    // Only rebuild when something visible changed, so buttons don't flicker under the mouse.
    const sig = `${this.kind}|${value}|${factors.map((f) => `${f.label}:${Math.round(f.value)}:${f.detail ?? ''}`).join('|')}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const [, name, cls, zone] = KINDS.find((x) => x[0] === this.kind)!;
    const problems = factors.filter((f) => f.tip && (f.value < 0 || f.hint));
    const level = value >= 60 ? 'high' : value >= 25 ? 'some' : 'low';
    const summary =
      level === 'high' ? `Strong demand. Zone more ${name.toLowerCase()} land and it will fill.`
      : level === 'some' ? `Some demand. New ${name.toLowerCase()} buildings will grow slowly.`
      : problems.length ? `Little demand. The biggest problem is ${problems[0].label.toLowerCase()}.`
      : `Little demand right now.`;
    this.body.innerHTML = '';
    this.body.append(
      h('div', { class: `dp-summary ${level}` },
        h('div', { class: 'dp-meter' }, h('div', { class: `dp-meter-fill ${cls}`, style: `width:${Math.max(2, value)}%` })),
        h('div', { class: 'dp-summary-row' }, h('b', null, `${value}`), h('span', null, summary)),
        level === 'high' ? this.fixBtn(this.zoneFix(zone), `Zone ${name.toLowerCase()}`) : null,
      ),
    );
    const list = h('div', { class: 'dp-factors' });
    for (const f of factors) list.append(this.row(f));
    if (!factors.length) list.append(h('div', { class: 'dp-empty' }, 'Nothing is pushing demand up or down yet.'));
    this.body.append(list);
  }

  private row(f: DemandFactor): HTMLElement {
    const v = Math.round(f.value);
    const pos = f.value > 0;
    return h(
      'div',
      { class: `dp-factor ${f.hint ? 'dp-hint' : pos ? 'dp-pos' : 'dp-neg'}` },
      h('span', { class: 'dp-impact' }, f.hint ? '!' : `${pos ? '+' : '−'}${Math.abs(v)}`),
      h('div', { class: 'dp-text' },
        h('div', { class: 'dp-label' }, f.label),
        f.detail ? h('div', { class: 'dp-detail' }, f.detail) : null,
        f.tip ? h('div', { class: 'dp-tip' }, icon('info', 12), h('span', null, f.tip)) : null,
        f.tip && f.fix ? this.fixBtn(f.fix) : null,
      ),
    );
  }

  private zoneFix(z: Zone): DemandFix {
    return z === Zone.Commercial ? 'zone-com' : z === Zone.Industrial ? 'zone-ind' : z === Zone.Office ? 'zone-office' : 'zone-res';
  }

  private fixBtn(fix: DemandFix, label = FIX_LABEL[fix]): HTMLElement {
    return h('button', { class: 'btn small dp-fix', onclick: () => this.apply(fix) }, label, icon('chevron', 12));
  }

  private apply(fix: DemandFix): void {
    const g = this.game;
    const ui = g.ui;
    const tb = ui.toolbar;
    this.close();
    switch (fix) {
      case 'budget': ui.openPanel('budget'); break;
      case 'policies': ui.openPanel('policies'); break;
      case 'zone-res': tb.pickZone(Zone.ResLow); break;
      case 'zone-com': tb.pickZone(Zone.Commercial); break;
      case 'zone-ind': tb.pickZone(Zone.Industrial); break;
      case 'zone-office': tb.pickZone(Zone.Office); break;
      case 'roads': {
        tb.openCategory('roads');
        // A demolished highway: fly to where it has to be rebuilt.
        const e = g.city?.looseEntry();
        if (e) g.flyTo(e.x, e.z, 420);
        break;
      }
      case 'transit': tb.openCategory('transit'); break;
      case 'services':
      case 'education': tb.openCategory('services'); break;
      case 'parks': tb.openCategory('parks'); break;
      case 'traffic':
      case 'landValue':
      case 'happiness':
        g.setOverlay(fix);
        if (!ui.layersOpen) ui.openPanel('overlays');
        break;
    }
  }
}
