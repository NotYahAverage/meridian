import { formatMoney } from '../core/math';
import type { Game } from '../game/Game';
import type { City } from '../sim/City';
import type { GameSpeed } from '../sim/types';
import { SCENARIOS, SCENARIO_BY_ID, type ScenarioDef, formatMonths, monthsLeft } from '../sim/progress/Scenarios';
import { MAP_PRESETS } from '../sim/world/Terrain';
import { h } from './dom';
import { icon } from './icons';
import { Modal } from './Menus';

/** Picks a curated challenge from the main menu. */
export class ScenarioDialog extends Modal {
  private selected = SCENARIOS[0].id;

  constructor(game: Game) {
    super(game, 'Scenarios', 'wide');
  }

  open(): void {
    this.render();
    super.open();
  }

  private render(): void {
    const b = this.body;
    b.innerHTML = '';
    const won = new Set(this.game.settings.scenariosWon);
    const list = h('div', { class: 'scn-list' });
    for (const s of SCENARIOS) {
      list.appendChild(
        h('button', { class: `scn-card ${s.preset}${s.id === this.selected ? ' active' : ''}`, 'data-id': s.id, onclick: () => { this.selected = s.id; this.game.play('click'); this.render(); } },
          h('div', { class: 'map-art' }),
          h('div', { class: 'scn-info' },
            h('div', { class: 'scn-head' },
              h('b', null, s.title),
              h('span', { class: `scn-diff ${s.difficulty.toLowerCase()}` }, s.difficulty),
              won.has(s.id) ? h('span', { class: 'scn-won', 'data-tip': 'Completed' }, icon('milestone', 15)) : null,
            ),
            h('div', { class: 'scn-blurb' }, s.blurb),
          ),
        ),
      );
    }
    const sel = SCENARIO_BY_ID.get(this.selected)!;
    const fact = (label: string, value: string) => h('div', { class: 'scn-fact' }, h('span', { class: 'muted small' }, label), h('b', null, value));
    const detail = h('div', { class: 'scn-detail' },
      h('div', { class: 'scn-title' }, sel.title),
      h('div', { class: 'scn-facts' }, fact('Map', MAP_PRESETS[sel.preset].name), fact('Funds', formatMoney(sel.money)), fact('Time limit', formatMonths(sel.months))),
      h('div', { class: 'section-title' }, 'Objectives'),
      h('ul', { class: 'scn-objs' }, ...sel.objectives.map((o) => h('li', null, icon('flag', 14), o.label))),
      h('div', { class: 'hint' }, 'Meet every objective before time runs out. When the scenario ends you can keep building.'),
    );
    b.append(
      h('div', { class: 'scn-layout' }, list, detail),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', onclick: () => this.close() }, 'Cancel'),
        h('button', { class: 'btn primary big', onclick: () => { this.close(); void this.game.startScenario(sel.id); } }, icon('play', 16), 'Start scenario'),
      ),
    );
  }
}

/** Objectives with progress meters; shared by the result dialog and the goals panel. */
export function objectiveList(city: City, def: ScenarioDef): HTMLElement {
  const list = h('div', { class: 'scn-progress' });
  for (const o of def.objectives) {
    const p = o.progress(city);
    const done = p >= 1;
    list.appendChild(
      h('div', { class: `scn-obj${done ? ' done' : ''}` },
        h('div', { class: 'scn-obj-head' }, h('span', { class: 'chk' }, done ? icon('check', 13) : ''), h('span', { class: 'scn-obj-label' }, o.label), h('span', { class: 'muted' }, o.detail(city))),
        h('div', { class: 'meter' }, h('div', { class: 'meter-fill', style: `width:${Math.round(p * 100)}%;background:${done ? 'var(--good)' : 'var(--accent)'}` })),
      ),
    );
  }
  return list;
}

/** Scenario status card at the top of the goals panel. */
export function scenarioCard(game: Game, city: City): HTMLElement | null {
  const st = city.scenario;
  const def = st ? SCENARIO_BY_ID.get(st.id) : undefined;
  if (!st || !def) return null;
  const status = st.result === 'won' ? 'Complete' : st.result === 'lost' ? 'Time is up' : `${formatMonths(monthsLeft(city))} left`;
  return h('div', { class: `scn-panel ${st.result}` },
    h('div', { class: 'scn-panel-head' },
      icon(st.result === 'won' ? 'milestone' : 'flag', 16),
      h('b', null, def.title),
      h('span', { class: `scn-diff ${def.difficulty.toLowerCase()}` }, def.difficulty),
      h('span', { class: 'scn-status' }, status),
    ),
    objectiveList(city, def),
    st.result === 'lost' ? h('button', { class: 'btn small', onclick: () => void game.startScenario(def.id) }, 'Try again') : null,
  );
}

/** Shown once when a scenario is won or lost. */
export class ScenarioResult extends Modal {
  private resumeSpeed: GameSpeed = 1;

  constructor(game: Game) {
    super(game, 'Scenario', 'narrow scn-result');
  }

  show(id: string, result: 'won' | 'lost'): void {
    const def = SCENARIO_BY_ID.get(id);
    const city = this.game.city;
    if (!def || !city || !city.scenario) return;
    this.resumeSpeed = this.game.speed || 1;
    this.game.setSpeed(0);
    const won = result === 'won';
    this.el.querySelector('.modal-title')!.textContent = def.title;
    const elapsed = city.clock.monthIndex - city.scenario.startMonth;
    const met = def.objectives.filter((o) => o.progress(city) >= 1).length;
    const b = this.body;
    b.innerHTML = '';
    b.append(
      h('div', { class: `scn-verdict ${result}` },
        h('div', { class: 'scn-badge' }, icon(won ? 'milestone' : 'clock', 34)),
        h('div', { class: 'scn-headline' }, won ? 'Scenario complete!' : 'Time is up'),
        h('div', { class: 'muted' }, won ? `Every objective met in ${formatMonths(elapsed)}.` : `${met} of ${def.objectives.length} objectives met.`),
      ),
      objectiveList(city, def),
      h('div', { class: 'modal-actions' },
        won
          ? h('button', { class: 'btn', onclick: () => { this.close(); void this.game.toMenu().then(() => this.game.ui.scenarios.open()); } }, 'More scenarios')
          : h('button', { class: 'btn', onclick: () => { this.close(); void this.game.startScenario(def.id); } }, 'Try again'),
        h('button', { class: 'btn primary', onclick: () => this.close() }, icon('build', 16), 'Keep building'),
      ),
    );
    this.open();
  }

  close(): void {
    const wasOpen = this.isOpen;
    super.close();
    if (wasOpen && this.game.state === 'playing' && this.game.speed === 0) this.game.setSpeed(this.resumeSpeed);
  }
}
