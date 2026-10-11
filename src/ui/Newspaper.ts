import { formatInt } from '../core/math';
import type { Game } from '../game/Game';
import { Clock } from '../sim/Clock';
import type { Story } from '../sim/news/News';
import { h } from './dom';
import { icon } from './icons';
import { Modal } from './Menus';

/** Section label printed above each story. */
function kicker(topic: string): string {
  if (topic.startsWith('feature-')) return 'Around town';
  if (topic.startsWith('open-')) return 'Openings';
  const k: Record<string, string> = {
    scenario: 'City Hall', milestone: 'City Hall', policy: 'City Hall', tornado: 'Weather', weather: 'Weather', fire: 'Emergencies',
    achievement: 'Civic pride', population: 'Growth', mood: 'Survey', tax: 'Budget', budget: 'Budget', transit: 'Transport',
    traffic: 'Transport', tourism: 'Tourism', jobs: 'Economy', pollution: 'Environment', housing: 'Housing', shops: 'Business',
  };
  return k[topic] ?? 'News';
}

/** The monthly paper on a sheet of newsprint, with back issues. */
export class NewspaperDialog extends Modal {
  private index = 0;

  constructor(game: Game) {
    super(game, 'City newspaper', 'paper-modal');
  }

  open(index = 0): void {
    this.index = index;
    this.render();
    super.open();
  }

  /** Re-renders when a new edition arrives while the paper is open. */
  refresh(): void {
    if (this.isOpen) {
      this.index = 0;
      this.render();
    }
  }

  private render(): void {
    const b = this.body;
    b.innerHTML = '';
    const eds = this.game.city?.news.editions ?? [];
    if (!eds.length) {
      b.append(h('div', { class: 'np-empty' }, icon('news', 28), h('div', null, 'The first edition goes to press at the end of the month.')));
      return;
    }
    this.index = Math.min(this.index, eds.length - 1);
    const ed = eds[this.index];
    const story = (s: Story, topic: string, cls: string) =>
      h('article', { class: `np-story ${cls}` },
        h('div', { class: `np-kicker ${s.tone}` }, kicker(topic)),
        h('h3', null, s.title),
        h('p', null, s.body),
        s.x !== undefined && s.z !== undefined ? h('button', { class: 'np-map', onclick: () => { this.close(); this.game.flyTo(s.x!, s.z!, 260); } }, icon('pin', 12), 'See on the map') : null,
      );
    const [lead, ...rest] = ed.stories;
    b.append(
      h('div', { class: 'np-sheet' },
        h('div', { class: 'np-mast' }, ed.paper),
        h('div', { class: 'np-dateline' }, h('span', null, `No. ${ed.issue}`), h('span', null, Clock.monthLabel(ed.month)), h('span', null, `Pop. ${formatInt(ed.population)}`)),
        story(lead, ed.topics[0] ?? '', 'lead'),
        h('div', { class: 'np-cols' }, ...rest.map((s, i) => story(s, ed.topics[i + 1] ?? '', ''))),
      ),
      h('div', { class: 'modal-actions np-nav' },
        h('button', { class: 'btn', disabled: this.index >= eds.length - 1, onclick: () => { this.index++; this.game.play('click'); this.render(); } }, '‹ Older'),
        h('span', { class: 'muted small' }, this.index === 0 ? 'Latest edition' : `${this.index} edition${this.index === 1 ? '' : 's'} back`),
        h('button', { class: 'btn', disabled: this.index === 0, onclick: () => { this.index--; this.game.play('click'); this.render(); } }, 'Newer ›'),
      ),
    );
  }
}
