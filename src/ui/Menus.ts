import { formatInt, formatMoney } from '../core/math';
import { randomSeed } from '../core/rng';
import type { Game } from '../game/Game';
import { DEFAULT_SETTINGS, LARGE_CITY_POPULATION, type SlotInfo, type UiStyle, type UpdateState, platform } from '../platform/Platform';
import { MAP_PRESETS, type MapPreset } from '../sim/world/Terrain';
import { h } from './dom';
import { icon } from './icons';
import { brandWordmark } from './brand';

const CITY_NAMES = ['Port Alder', 'Meridian Bay', 'New Halston', 'Cedarbrook', 'Westmere', 'Larkhaven', 'Ashby Falls', 'Silverlake', 'Northfield', 'Kingsport', 'Juniper Ridge', 'Brightwater', 'Easton Vale', 'Harbourne'];

const TIPS = [
  'Connect your first street to the end of the highway — nobody moves in without it.',
  'Buildings need electricity, water and sewage before they grow.',
  'Keep industry away from homes: pollution lowers land value and happiness.',
  'Avenues and boulevards carry far more traffic than streets.',
  'Parks and plazas raise land value, which lets buildings upgrade.',
  'Watch the demand bars: they tell you what your city needs next.',
  'Right-drag to look around, middle-drag to pan, WASD to move and scroll to zoom.',
  'Hold Shift while drawing roads to snap to clean angles.',
];

/** Fullscreen loading overlay. */
export class LoadingScreen {
  readonly el: HTMLElement;
  private bar: HTMLElement;
  private label: HTMLElement;
  private tip: HTMLElement;

  constructor() {
    this.bar = h('div', { class: 'load-fill' });
    this.label = h('div', { class: 'load-label' });
    this.tip = h('div', { class: 'load-tip' });
    this.el = h('div', { class: 'loading hidden' }, h('div', { class: 'load-inner' }, brandWordmark('load-logo'), h('div', { class: 'load-track' }, this.bar), this.label, this.tip));
  }

  show(label: string, p: number): void {
    this.el.classList.remove('hidden', 'fade');
    this.tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    this.progress(label, p);
  }

  progress(label: string, p: number): void {
    this.label.textContent = label;
    this.bar.style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
  }

  hide(): void {
    this.bar.style.width = '100%';
    this.el.classList.add('fade');
    setTimeout(() => this.el.classList.add('hidden'), 450);
  }
}

/** Generic modal dialog. */
export class Modal {
  readonly el: HTMLElement;
  protected body: HTMLElement;

  constructor(protected game: Game, title: string, cls = '') {
    this.body = h('div', { class: 'modal-body' });
    this.el = h(
      'div',
      { class: 'modal-backdrop hidden' },
      h('div', { class: `modal ${cls}` }, h('div', { class: 'modal-head' }, h('div', { class: 'modal-title' }, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => this.close() }, icon('close', 18))), this.body),
    );
    this.el.addEventListener('mousedown', (e) => {
      if (e.target === this.el) this.close();
    });
  }

  open(): void {
    this.el.classList.remove('hidden');
    this.game.play('open');
  }

  close(): void {
    if (this.isOpen) this.game.play('close');
    this.el.classList.add('hidden');
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }
}

export class NewCityDialog extends Modal {
  private name = '';
  private seed = randomSeed() % 1_000_000;
  private preset: MapPreset = 'coastal';
  private unlimited = false;

  constructor(game: Game) {
    super(game, 'Found a New City', 'wide');
  }

  open(): void {
    this.name = CITY_NAMES[Math.floor(Math.random() * CITY_NAMES.length)];
    this.seed = randomSeed() % 1_000_000;
    this.render();
    super.open();
  }

  private render(): void {
    const b = this.body;
    b.innerHTML = '';
    const nameIn = h('input', { class: 'text-input', value: this.name, maxlength: '32', 'aria-label': 'City name' }) as HTMLInputElement;
    nameIn.addEventListener('input', () => (this.name = nameIn.value));
    const seedIn = h('input', { class: 'text-input mono', value: String(this.seed), 'aria-label': 'Map seed' }) as HTMLInputElement;
    seedIn.addEventListener('change', () => (this.seed = Math.abs(parseInt(seedIn.value, 10) || 0)));
    const maps = h('div', { class: 'map-cards' });
    for (const [id, p] of Object.entries(MAP_PRESETS) as [MapPreset, (typeof MAP_PRESETS)[MapPreset]][]) {
      maps.appendChild(
        h('button', { class: `map-card ${id}${this.preset === id ? ' active' : ''}`, onclick: () => { this.preset = id; this.game.play('click'); this.render(); } },
          h('div', { class: 'map-art' }),
          h('div', { class: 'map-name' }, p.name),
          h('div', { class: 'map-desc' }, p.description),
        ),
      );
    }
    const unl = h('input', { type: 'checkbox', checked: this.unlimited }) as HTMLInputElement;
    unl.addEventListener('change', () => (this.unlimited = unl.checked));
    b.append(
      h('label', { class: 'field' }, h('span', null, 'City name'), nameIn),
      h('div', { class: 'field' }, h('span', null, 'Map'), maps),
      h('div', { class: 'field-row' },
        h('label', { class: 'field' }, h('span', null, 'Seed'), h('div', { class: 'seed-row' }, seedIn, h('button', { class: 'icon-btn', 'data-tip': 'Random seed', onclick: () => { this.seed = randomSeed() % 1_000_000; this.render(); } }, icon('dice', 18)))),
        h('label', { class: 'check' }, unl, h('span', null, 'Unlimited money (sandbox)')),
      ),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', onclick: () => this.close() }, 'Cancel'),
        h('button', { class: 'btn primary big', onclick: () => { this.close(); void this.game.startNewCity({ name: this.name.trim() || 'New City', seed: this.seed, preset: this.preset, unlimited: this.unlimited }); } }, icon('build', 16), 'Found city'),
      ),
    );
  }
}

export class SaveLoadDialog extends Modal {
  mode: 'save' | 'load' = 'load';

  constructor(game: Game) {
    super(game, 'Cities', 'wide');
  }

  async openMode(mode: 'save' | 'load'): Promise<void> {
    this.mode = mode;
    // Nothing saved yet: Play goes straight to a new city.
    if (mode === 'load' && this.game.state !== 'playing') {
      let any = true;
      try {
        any = (await platform.storage.list()).length > 0;
      } catch {
        any = true;
      }
      if (!any) {
        this.game.ui.newCity.open();
        return;
      }
    }
    (this.el.querySelector('.modal-title') as HTMLElement).textContent = mode === 'save' ? 'Save City' : 'Your Cities';
    void this.render();
    this.open();
  }

  private isCurrent(id: string): boolean {
    return this.game.state === 'playing' && this.game.slotId === id;
  }

  private async play(id: string): Promise<void> {
    this.close();
    if (this.game.state === 'playing' && !(await this.game.confirmLeave('menu'))) return;
    void this.game.loadSlot(id);
  }

  private async render(): Promise<void> {
    const b = this.body;
    b.innerHTML = '';
    if (this.mode === 'save' && this.game.city) {
      const nameIn = h('input', { class: 'text-input', value: this.game.city.name, maxlength: '40' }) as HTMLInputElement;
      b.append(
        h('div', { class: 'save-row' },
          nameIn,
          h('button', { class: 'btn primary', onclick: async () => { if (await this.game.save(nameIn.value)) void this.render(); } }, icon('save', 16), 'Save'),
          h('button', { class: 'btn', onclick: async () => { if (await this.game.save(nameIn.value, true)) void this.render(); } }, 'Save as new'),
        ),
      );
    }
    const list = h('div', { class: 'slots' }, h('div', { class: 'muted small' }, 'Loading…'));
    b.append(list);
    const file = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden' }) as HTMLInputElement;
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (f) {
        this.close();
        void this.game.importSave(f);
      }
    });
    b.append(
      h('div', { class: 'modal-actions left' },
        h('button', { class: 'btn', onclick: () => file.click() }, icon('upload', 16), 'Import file…'),
        this.mode === 'save' ? h('button', { class: 'btn', onclick: () => this.game.exportSave() }, icon('download', 16), 'Export to file') : null,
        file,
      ),
    );
    let slots: SlotInfo[] = [];
    try {
      slots = await platform.storage.list();
    } catch {
      list.innerHTML = '';
      list.append(h('div', { class: 'muted small' }, 'Save storage is unavailable in this browser.'));
      return;
    }
    list.innerHTML = '';
    const cities = cityList(slots);
    if (this.mode === 'load') list.append(h('button', { class: 'slot new-city', onclick: () => { this.close(); this.game.ui.newCity.open(); } }, h('div', { class: 'slot-thumb' }, icon('build', 26)), h('div', { class: 'slot-info' }, h('div', { class: 'slot-name' }, 'New city'), h('div', { class: 'muted small' }, 'Start fresh on a new map'))));
    if (!cities.length) list.append(h('div', { class: 'empty' }, icon('folder', 28), h('div', null, 'No saved cities yet.')));
    for (const { latest: s, older } of cities) {
      const when = new Date(s.meta.savedAt);
      const item = h(
        'div',
        { class: `slot${this.isCurrent(s.id) ? ' current' : ''}` },
        s.thumbnail ? h('img', { class: 'slot-thumb', src: s.thumbnail, alt: '' }) : h('div', { class: 'slot-thumb' }),
        h('div', { class: 'slot-info' },
          h('div', { class: 'slot-name' }, s.meta.name, this.isCurrent(s.id) ? h('span', { class: 'slot-badge' }, 'Playing') : null),
          h('div', { class: 'muted small' }, `${s.meta.date} · ${formatInt(s.meta.population)} residents · ${formatMoney(s.meta.money)}`),
          h('div', { class: 'muted small' }, `Last saved ${savedAgo(when)} · ${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`),
        ),
        h('div', { class: 'slot-actions' },
          this.mode === 'load' ? h('button', { class: 'btn primary small', onclick: () => void this.play(s.id) }, this.isCurrent(s.id) ? 'Reload' : 'Play') : null,
          h('button', { class: 'icon-btn', 'data-tip': 'Delete city', 'aria-label': 'Delete city', onclick: async () => { if (await this.game.ui.confirm('Delete city', `Delete "${s.meta.name}" and its saves? This cannot be undone.`, 'Delete')) { for (const o of [s, ...older]) await platform.storage.remove(o.id); void this.render(); } } }, icon('trash', 16)),
        ),
      );
      list.append(item);
    }
  }
}

/**
 * One entry per city, at its newest save. Old builds also kept a shared
 * "autosave" slot; it is folded into the city it belongs to.
 */
export function cityList(slots: SlotInfo[]): { latest: SlotInfo; older: SlotInfo[] }[] {
  const groups = new Map<string, SlotInfo[]>();
  const key = (s: SlotInfo) => (s.id === 'autosave' ? `${s.meta.seed}|${s.meta.name}` : s.id);
  const byCity = new Map<string, string>();
  for (const s of slots) if (s.id !== 'autosave') byCity.set(`${s.meta.seed}|${s.meta.name}`, s.id);
  for (const s of slots) {
    const k = s.id === 'autosave' ? byCity.get(key(s)) ?? key(s) : s.id;
    const g = groups.get(k);
    if (g) g.push(s);
    else groups.set(k, [s]);
  }
  const out = [...groups.values()].map((g) => {
    g.sort((a, b) => b.meta.savedAt.localeCompare(a.meta.savedAt));
    return { latest: g[0], older: g.slice(1) };
  });
  return out.sort((a, b) => b.latest.meta.savedAt.localeCompare(a.latest.meta.savedAt));
}

function savedAgo(when: Date): string {
  const s = (Date.now() - when.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export class SettingsDialog extends Modal {
  constructor(game: Game) {
    super(game, 'Settings');
  }

  open(): void {
    this.render();
    super.open();
  }

  private render(): void {
    const s = this.game.settings;
    const b = this.body;
    b.innerHTML = '';
    const apply = () => this.game.applySettings();
    const sel = (label: string, value: string, options: [string, string][], set: (v: string) => void) => {
      const el = h('select', { class: 'select' }, ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l))) as HTMLSelectElement;
      el.addEventListener('change', () => { set(el.value); apply(); });
      return h('label', { class: 'set-row' }, h('span', null, label), el);
    };
    const chk = (label: string, value: boolean, set: (v: boolean) => void) => {
      const el = h('input', { type: 'checkbox', checked: value }) as HTMLInputElement;
      el.addEventListener('change', () => { set(el.checked); apply(); });
      return h('label', { class: 'set-row' }, h('span', null, label), el);
    };
    const rng = (label: string, value: number, set: (v: number) => void, min = 0, max = 1, step = 0.05) => {
      const el = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), class: 'slider' }) as HTMLInputElement;
      el.addEventListener('input', () => { set(Number(el.value)); apply(); });
      return h('label', { class: 'set-row' }, h('span', null, label), el);
    };
    // Fullscreen: the desktop window (remembered for next launch) or the browser page.
    const fsBox = h('input', { type: 'checkbox' }) as HTMLInputElement;
    const fsNow = async () => (platform.isFullscreen ? await platform.isFullscreen() : !!document.fullscreenElement);
    void fsNow().then((v) => (fsBox.checked = v));
    fsBox.addEventListener('change', () => {
      if (platform.setFullscreen) platform.setFullscreen(fsBox.checked);
      else if (fsBox.checked) void document.documentElement.requestFullscreen?.().catch(() => (fsBox.checked = false));
      else if (document.fullscreenElement) void document.exitFullscreen();
    });
    b.append(
      h('div', { class: 'section-title' }, 'Graphics'),
      h('label', { class: 'set-row' }, h('span', null, 'Fullscreen (F11)'), fsBox),
      sel('Quality', s.quality, [['low', 'Low (fast)'], ['medium', 'Medium'], ['high', 'High']], (v) => (s.quality = v as typeof s.quality)),
      sel('Interface style', s.uiStyle ?? 'classic', [['classic', 'Classic'], ['command', 'Command (new)']], (v) => {
        s.uiStyle = v as UiStyle;
      }),
      sel('Interface scale', String(s.uiScale ?? 0), [['0', 'Automatic'], ['1', '100%'], ['1.15', '115%'], ['1.25', '125%'], ['1.5', '150%']], (v) => (s.uiScale = Number(v))),
      sel('Time of day', !s.dayNight ? 'noon' : s.dayOnly ? 'day' : 'cycle', [['cycle', 'Day & night'], ['day', 'Daytime only (sunrise to sunset, on a loop)'], ['noon', 'Always midday']], (v) => {
        s.dayNight = v !== 'noon';
        s.dayOnly = v === 'day';
      }),
      chk('Problem icons over buildings', s.showIcons, (v) => (s.showIcons = v)),
      rng('Traffic density', s.trafficDensity, (v) => (s.trafficDensity = v), 0.25, 1.5, 0.05),
      sel('Large city mode', s.largeCityMode ?? 'auto', [['auto', `Automatic (from ${LARGE_CITY_POPULATION.toLocaleString('en-US')} residents)`], ['on', 'On'], ['off', 'Off']], (v) => (s.largeCityMode = v as 'auto' | 'on' | 'off')),
      h('div', { class: 'hint small' }, 'Lowers shadow detail while the frame rate is low. (Everything within about 1.5 km of where you look is always drawn in full; beyond that buildings are simple shapes and cars are hidden.)'),
      h('div', { class: 'section-title' }, 'Audio'),
      rng('Master volume', s.masterVolume, (v) => (s.masterVolume = v)),
      rng('Effects', s.sfxVolume, (v) => (s.sfxVolume = v)),
      rng('Ambience', s.ambientVolume, (v) => (s.ambientVolume = v)),
      rng('Music', s.musicVolume, (v) => (s.musicVolume = v)),
      h('div', { class: 'section-title' }, 'Controls & gameplay'),
      chk('Edge scrolling', s.edgeScroll, (v) => (s.edgeScroll = v)),
      sel('Camera style', s.cameraStyle === 'free' ? 'free' : 'classic', [['classic', 'Classic (right-drag pans, middle-drag and Q / E rotate)'], ['free', 'Free cam (right-drag looks, middle-drag pans)']], (v) => (s.cameraStyle = v as 'free' | 'classic')),
      rng('Camera look sensitivity', s.lookSpeed ?? 1, (v) => (s.lookSpeed = v), 0.4, 2, 0.1),
      chk('Invert look', s.invertRotate, (v) => (s.invertRotate = v)),
      chk('Autosave every 3 minutes', s.autosave, (v) => (s.autosave = v)),
      chk('Show goals and next-step tips', s.tutorial, (v) => (s.tutorial = v)),
      chk('Street names when zoomed in', s.streetNames !== false, (v) => (s.streetNames = v)),
      chk('Natural disasters (rare tornadoes in spring and summer storms)', !!s.disasters, (v) => (s.disasters = v)),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', onclick: () => { Object.assign(s, DEFAULT_SETTINGS); apply(); this.render(); } }, 'Reset to defaults'),
        h('button', { class: 'btn primary', onclick: () => this.close() }, 'Done'),
      ),
    );
  }
}

export class PauseMenu extends Modal {
  constructor(game: Game) {
    super(game, 'Paused', 'narrow');
    const btn = (label: string, ic: string, fn: () => void, cls = '') => h('button', { class: `menu-btn ${cls}`, onclick: fn }, icon(ic, 18), label);
    this.body.append(
      h('div', { class: 'menu-list' },
        btn('Resume', 'play', () => this.close(), 'primary'),
        btn('Save', 'save', () => { this.close(); void this.game.save(); }),
        btn('Save as / export…', 'download', () => { this.close(); this.game.ui.saveLoad.openMode('save'); }),
        btn('Your cities', 'folder', () => { this.close(); this.game.ui.saveLoad.openMode('load'); }),
        btn('Settings', 'gear', () => { this.close(); this.game.ui.settings.open(); }),
        btn('Controls', 'keyboard', () => { this.close(); this.game.ui.help.open(); }),
        btn('Exit to main menu', 'home', () => { this.close(); void this.game.exitToMenu(); }),
        platform.quit ? btn('Quit game', 'close', () => { this.close(); void this.game.quit(); }) : null,
      ),
    );
  }
}

/** Title screen over the live 3D backdrop. */
export class MainMenu {
  readonly el: HTMLElement;
  private playBtn: HTMLButtonElement;
  private playSub: HTMLElement;
  private resume: HTMLElement;
  private versionEl = h('span', null, 'v0.1 · Early build');
  private updateBtn: HTMLButtonElement | null = null;
  private updateText = h('span', { class: 'mm-update-text' });
  private updateState: UpdateState = { status: 'idle' };

  /** Desktop only: check for a new version, watch it download, and restart into it. */
  private updateRow(): HTMLElement | null {
    const u = platform.updates;
    if (!u) return null;
    void platform.version?.().then((v) => (this.versionEl.textContent = `v${v} · Early build`));
    this.updateBtn = h('button', { class: 'menu-btn small mm-update-btn', onclick: () => {
      this.game.play('click');
      if (this.updateState.status === 'ready' || this.updateState.status === 'manual') u.install();
      else void u.check().then((s) => this.showUpdate(s));
    } }, icon('download', 16), h('span', null, 'Check for updates')) as HTMLButtonElement;
    u.onState((s) => this.showUpdate(s));
    void u.state().then((s) => this.showUpdate(s));
    return h('div', { class: 'mm-update' }, this.updateBtn, this.updateText);
  }

  private showUpdate(s: UpdateState): void {
    this.updateState = s;
    const label = this.updateBtn?.querySelector('span');
    const text: Record<UpdateState['status'], string> = {
      idle: '', unavailable: '', checking: 'Checking…', latest: 'You have the latest version.',
      downloading: `Downloading v${s.version ?? ''}… ${s.percent ?? 0}%`, ready: `Version ${s.version} is ready.`, manual: `Version ${s.version} is out.`,
      error: 'Couldn’t check for updates. Are you online?',
    };
    this.updateText.textContent = text[s.status];
    if (label) label.textContent = s.status === 'ready' ? 'Restart and update' : s.status === 'manual' ? 'Get it on itch.io' : 'Check for updates';
    this.updateBtn?.classList.toggle('primary', s.status === 'ready' || s.status === 'manual');
  }

  constructor(private game: Game) {
    const click = (fn: () => void) => () => { this.game.play('click'); fn(); };
    const btn = (label: string, ic: string, fn: () => void, cls = '', sub?: HTMLElement) =>
      h('button', { class: `menu-btn ${cls}`, onclick: click(fn) }, icon(ic, 18), h('span', { class: 'menu-btn-text' }, h('span', null, label), sub ?? null));
    const small = (label: string, ic: string, fn: () => void) => h('button', { class: 'menu-btn small', 'aria-label': label, onclick: click(fn) }, icon(ic, 16), h('span', null, label));
    this.playSub = h('span', { class: 'menu-btn-sub' });
    // Play lists every city at its latest save (or starts a new one if there are none).
    this.playBtn = btn('Play', 'play', () => void this.game.ui.saveLoad.openMode('load'), 'primary big', this.playSub) as HTMLButtonElement;
    this.resume = h('div', { class: 'mm-resume hidden' });
    this.el = h(
      'div',
      { class: 'main-menu hidden' },
      h('aside', { class: 'mm-panel' },
        h('div', { class: 'mm-top' },
          brandWordmark('mm-logo'),
          h('div', { class: 'tagline' }, 'Build the city. Watch it come alive.'),
        ),
        this.resume,
        h('div', { class: 'menu-list' },
          this.playBtn,
          btn('New city', 'build', () => this.game.ui.newCity.open(), 'accent'),
          btn('Scenarios', 'flag', () => this.game.ui.scenarios.open()),
        ),
        h('div', { class: 'mm-row' },
          small('Settings', 'gear', () => this.game.ui.settings.open()),
          small('Controls', 'keyboard', () => this.game.ui.help.open()),
          platform.quit ? small('Quit', 'close', () => platform.quit?.()) : null,
        ),
        this.updateRow(),
        h('div', { class: 'mm-foot' }, this.versionEl, h('span', null, platform.isDesktop ? 'Desktop' : 'Web')),
      ),
    );
  }

  async show(): Promise<void> {
    this.el.classList.remove('hidden');
    let cities: ReturnType<typeof cityList> = [];
    try {
      cities = cityList(await platform.storage.list());
    } catch {
      cities = [];
    }
    const n = cities.length;
    this.playSub.textContent = n ? `${n} ${n === 1 ? 'city' : 'cities'}` : 'Start your first city';
    // The most recent city, one click from carrying on.
    const last = cities[0]?.latest;
    this.resume.innerHTML = '';
    this.resume.classList.toggle('hidden', !last);
    if (last) {
      const when = new Date(last.meta.savedAt);
      this.resume.append(
        h('button', { class: 'mm-resume-card', 'aria-label': `Continue ${last.meta.name}`, onclick: () => { this.game.play('click'); void this.game.loadSlot(last.id); } },
          last.thumbnail ? h('img', { class: 'mm-resume-thumb', src: last.thumbnail, alt: '' }) : h('div', { class: 'mm-resume-thumb' }),
          h('div', { class: 'mm-resume-info' },
            h('div', { class: 'mm-resume-kicker' }, 'Continue'),
            h('div', { class: 'mm-resume-name' }, last.meta.name),
            h('div', { class: 'mm-resume-meta' }, `${formatInt(last.meta.population)} residents · ${last.meta.date}`),
            h('div', { class: 'mm-resume-meta' }, `Last played ${savedAgo(when)}`),
          ),
          icon('chevron', 18),
        ),
      );
    }
  }

  hide(): void {
    this.el.classList.add('hidden');
  }
}
