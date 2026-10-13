import type { Game } from '../game/Game';
import { FIELD_BY_ID } from '../sim/research/Knowledge';
import { h } from './dom';
import { icon } from './icons';

/**
 * A small card on the map listing the experiments under way, each with a
 * progress ring and what it's waiting for. Clicking one opens it in the
 * research window. The Research rail button gets a dot while a decision waits.
 */
export class ResearchTracker {
  readonly el = h('div', { class: 'rs-tracker hidden', 'aria-label': 'Experiments under way' });
  private seen = -1;
  private day = -1;

  constructor(private game: Game) {}

  update(): void {
    const city = this.game.city;
    const r = city?.research;
    const running = r ? [...r.centers.values()].filter((c) => c.active) : [];
    const railBtn = this.game.ui.toolbar.rail.querySelector('[data-cat="research"]');
    railBtn?.classList.toggle('alert', running.some((c) => c.active?.pending));
    if (!r || !running.length) {
      this.el.classList.add('hidden');
      return;
    }
    this.el.classList.remove('hidden');
    if (r.version === this.seen && city!.clock.day === this.day) return;
    this.seen = r.version;
    this.day = city!.clock.day;
    this.el.innerHTML = '';
    this.el.append(h('div', { class: 'rs-tracker-head' }, icon('flask', 13), 'Experiments'));
    for (const c of running) {
      const a = c.active!;
      const color = `#${FIELD_BY_ID.get(a.plan.field)!.color.toString(16).padStart(6, '0')}`;
      const pct = Math.round(a.progress * 100);
      const left = Math.max(1, Math.ceil(((1 - a.progress) * Math.max(4, a.plan.days)) / Math.max(0.1, r.speedOf(c))));
      const status = a.pending ? 'Decision needed' : a.status.startsWith('Paused') ? 'Paused' : `${pct}% · about ${left} day${left === 1 ? '' : 's'} left`;
      this.el.append(h('button', {
        class: `rs-track${a.pending ? ' alert' : ''}`,
        'data-tip': `${c.name}: ${a.plan.title}${a.status.startsWith('Paused') ? ` — ${a.status}` : ''}`,
        onclick: () => this.game.ui.research.open({ tab: 'centres', centreId: c.id }),
      },
        h('span', { class: 'rs-ring', style: `--p:${pct}%;--c:${color}` }, a.pending ? '!' : ''),
        h('span', { class: 'rs-track-text' }, h('b', null, a.plan.title), h('span', null, status)),
      ));
    }
  }
}
