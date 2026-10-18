import type { Game } from '../game/Game';
import { GOALS, TRANSIT_UNLOCK } from '../sim/progress/Progress';
import { METRO_UNLOCK } from '../sim/transit/Metro';
import { saveSettings } from '../platform/Platform';
import { h } from './dom';
import { icon } from './icons';

/** Where each starter goal is done, and when to point at it. */
const TARGETS: Record<string, { selector: string; cat?: string; minPop?: number }> = {
  connect: { selector: '.rail-btn[data-cat="roads"]', cat: 'roads' },
  zoneRes: { selector: '.rail-btn[data-cat="zoning"]', cat: 'zoning' },
  zoneJobs: { selector: '.rail-btn[data-cat="zoning"]', cat: 'zoning' },
  power: { selector: '.rail-btn[data-cat="utilities"]', cat: 'utilities' },
  water: { selector: '.rail-btn[data-cat="utilities"]', cat: 'utilities' },
  sewage: { selector: '.rail-btn[data-cat="utilities"]', cat: 'utilities' },
  service: { selector: '.rail-btn[data-cat="services"]', cat: 'services' },
  park: { selector: '.rail-btn[data-cat="services"]', cat: 'parks' },
  design: { selector: '.rail-btn[data-cat="design"]' },
  prototype: { selector: '.rail-btn[data-cat="design"]' },
  adopt: { selector: '.rail-btn[data-cat="design"]' },
  bus: { selector: '.rail-btn[data-cat="transit"]', cat: 'transit', minPop: TRANSIT_UNLOCK },
  policy: { selector: '.rail-btn[data-cat="info"]' },
  landmark: { selector: '.rail-btn[data-cat="services"]', cat: 'parks' },
  metro: { selector: '.rail-btn[data-cat="transit"]', cat: 'transit', minPop: METRO_UNLOCK },
};

/**
 * First-run guidance: a pulsing ring around the button for the current goal
 * with a short hint. Hidden while that menu is open, and dismissible.
 */
export class CoachMark {
  readonly ring = h('div', { class: 'coach-ring hidden' });
  readonly bubble: HTMLElement;
  private title = h('div', { class: 'coach-title' });
  private hint = h('div', { class: 'coach-hint' });
  private timer = 0;
  private goal = '';
  private dismissed = new Set<string>();

  constructor(private game: Game) {
    this.bubble = h(
      'div',
      { class: 'coach-bubble hidden', role: 'status' },
      h('div', { class: 'coach-head' }, h('span', { class: 'coach-tag' }, 'Next step'), h('button', { class: 'icon-btn', 'aria-label': 'Dismiss tip', onclick: () => this.dismiss() }, icon('close', 13))),
      this.title,
      this.hint,
      h('button', { class: 'coach-off', onclick: () => this.turnOff() }, 'Hide tips'),
    );
  }

  private dismiss(): void {
    if (this.goal) this.dismissed.add(this.goal);
    this.hide();
  }

  private turnOff(): void {
    this.game.settings.tutorial = false;
    saveSettings(this.game.settings);
    this.hide();
  }

  private hide(): void {
    this.ring.classList.add('hidden');
    this.bubble.classList.add('hidden');
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.25;
    const g = this.game;
    const city = g.city;
    if (!city || g.state !== 'playing' || g.photoMode || !g.settings.tutorial || g.ui.guide.running || document.querySelector('.modal-backdrop:not(.hidden)')) return this.hide();
    const goal = GOALS.find((q) => !city.goalsDone.has(q.id));
    const t = goal ? TARGETS[goal.id] : undefined;
    if (!goal || !t || this.dismissed.has(goal.id) || city.peakPopulation < (t.minPop ?? 0)) return this.hide();
    // Only while idle: never over an open menu or an active tool.
    if (g.ui.toolbar.open || g.tool.id !== 'inspect' || g.selection) return this.hide();
    if (goal.id === 'policy' && document.querySelector('.panel:not(.hidden) .policy')) return this.hide();
    const el = document.querySelector(t.selector) as HTMLElement | null;
    if (!el || !el.offsetParent) return this.hide();
    this.goal = goal.id;
    this.title.textContent = goal.title;
    this.hint.textContent = goal.hint;
    const r = el.getBoundingClientRect();
    Object.assign(this.ring.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
    this.ring.classList.remove('hidden');
    this.bubble.classList.remove('hidden');
    const bw = this.bubble.offsetWidth || 280;
    const bh = this.bubble.offsetHeight || 110;
    const vw = window.innerWidth;
    if (r.left < 120) {
      // Rail button: bubble to the right.
      Object.assign(this.bubble.style, { left: `${r.right + 14}px`, top: `${Math.max(12, r.top + r.height / 2 - bh / 2)}px` });
      this.bubble.dataset.side = 'right';
    } else {
      const left = Math.min(vw - bw - 12, Math.max(12, r.left + r.width / 2 - bw / 2));
      Object.assign(this.bubble.style, { left: `${left}px`, top: `${r.top - bh - 16}px` });
      this.bubble.dataset.side = 'top';
      this.bubble.style.setProperty('--arrow-x', `${r.left + r.width / 2 - left}px`);
    }
  }
}
