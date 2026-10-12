import type { Game } from '../game/Game';
import { NewspaperDialog } from './Newspaper';
import type { Edition } from '../sim/news/News';
import { ScenarioDialog, ScenarioResult } from './ScenarioDialogs';
import { CoachMark } from './CoachMark';
import { StreetLabels } from './StreetLabels';
import { OVERLAYS, type OverlayId, Overlays } from '../render/overlays/Overlays';
import type { Notice } from '../sim/Notifications';
import { h, toggle } from './dom';
import { CursorLabelView, SaveStatus, MilestoneBanner, Toasts, Toolbar, Tooltip, TopBar, dockThumbs } from './Hud';
import { icon } from './icons';
import { Inspector } from './Inspector';
import { ControlsDialog } from './ControlsDialog';
import { DiscoveryDialog, ResearchDialog } from './ResearchDialog';
import { LoadingScreen, MainMenu, Modal, NewCityDialog, PauseMenu, SaveLoadDialog, SettingsDialog } from './Menus';
import { BudgetPanel, DistrictsPanel, GoalsPanel, LogPanel, OverlaysPanel, type Panel, type PanelId, PoliciesPanel, LandPanel, StatsPanel, TransitPanel } from './Panels';

class ConfirmDialog extends Modal {
  private resolve: ((v: boolean) => void) | null = null;
  private text = h('p', { class: 'confirm-text' });
  private ok = h('button', { class: 'btn danger' }, 'OK');

  constructor(game: Game) {
    super(game, 'Confirm', 'narrow');
    this.body.append(this.text, h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: () => this.finish(false) }, 'Cancel'), this.ok));
    this.ok.addEventListener('click', () => this.finish(true));
  }

  ask(title: string, text: string, okLabel: string): Promise<boolean> {
    (this.el.querySelector('.modal-title') as HTMLElement).textContent = title;
    this.text.textContent = text;
    this.ok.textContent = okLabel;
    this.open();
    return new Promise((r) => (this.resolve = r));
  }

  private finish(v: boolean): void {
    super.close();
    this.resolve?.(v);
    this.resolve = null;
  }

  close(): void {
    this.finish(false);
  }
}

/** A question with several answers (e.g. Save and exit / Don't save / Cancel). */
class ChoiceDialog extends Modal {
  private text = h('p', { class: 'confirm-text' });
  private actions = h('div', { class: 'modal-actions' });
  private resolve: ((v: string) => void) | null = null;

  constructor(game: Game) {
    super(game, 'Confirm', 'narrow');
    this.body.append(this.text, this.actions);
  }

  ask(title: string, text: string, buttons: [string, string, string][]): Promise<string> {
    (this.el.querySelector('.modal-title') as HTMLElement).textContent = title;
    this.text.textContent = text;
    this.actions.innerHTML = '';
    for (const [value, label, cls] of buttons) this.actions.append(h('button', { class: `btn ${cls}`, 'data-choice': value, onclick: () => this.finish(value) }, label));
    this.open();
    (this.actions.lastElementChild as HTMLElement | null)?.focus();
    return new Promise((r) => (this.resolve = r));
  }

  private finish(v: string): void {
    super.close();
    this.resolve?.(v);
    this.resolve = null;
  }

  close(): void {
    this.finish('cancel');
  }
}

/** Root of the HTML interface layered over the 3D canvas. */
export class UI {
  readonly loading = new LoadingScreen();
  readonly menu: MainMenu;
  readonly newCity: NewCityDialog;
  readonly scenarios: ScenarioDialog;
  readonly scenarioResult: ScenarioResult;
  readonly newspaper: NewspaperDialog;
  readonly saveLoad: SaveLoadDialog;
  readonly settings: SettingsDialog;
  readonly help: ControlsDialog;
  readonly research: ResearchDialog;
  readonly discovery: DiscoveryDialog;
  readonly pause: PauseMenu;
  readonly confirmDialog: ConfirmDialog;
  readonly choiceDialog: ChoiceDialog;
  readonly saveStatus: SaveStatus;
  readonly topbar: TopBar;
  readonly toolbar: Toolbar;
  readonly toasts: Toasts;
  readonly cursor = new CursorLabelView();
  readonly tooltip = new Tooltip();
  readonly inspector: Inspector;
  readonly coach: CoachMark;
  readonly streets: StreetLabels;
  readonly milestoneBanner = new MilestoneBanner();
  readonly hud: HTMLElement;
  private panels: Panel[];
  /** City Information: the statistics, budget, policy… panels behind one set of tabs. */
  private info: HTMLElement;
  private infoTabs = new Map<PanelId, HTMLButtonElement>();
  /** Map layers (analysis) panel on the right. */
  private layersHost: HTMLElement;
  private leftStack: HTMLElement;
  /** Bars and panels; scaled as a unit for large screens. */
  private chrome!: HTMLElement;

  /** Interface scale from settings; automatic grows it with screen height (1440p ≈ 133%). */
  applyScale(): void {
    if (!this.chrome) return;
    const set = this.game.settings?.uiScale ?? 0;
    const auto = Math.round(Math.min(1.5, Math.max(1, window.innerHeight / 1080)) * 20) / 20;
    const z = set > 0 ? set : auto;
    this.chrome.style.zoom = z === 1 ? '' : String(z);
  }
  private legend: HTMLElement;
  private labels: HTMLElement;
  private labelTimer = 0;
  private statTimer = 0;
  private modals: Modal[];

  constructor(private game: Game, private root: HTMLElement) {
    this.menu = new MainMenu(game);
    this.newCity = new NewCityDialog(game);
    this.scenarios = new ScenarioDialog(game);
    this.scenarioResult = new ScenarioResult(game);
    this.newspaper = new NewspaperDialog(game);
    this.saveLoad = new SaveLoadDialog(game);
    this.settings = new SettingsDialog(game);
    this.help = new ControlsDialog(game);
    this.research = new ResearchDialog(game);
    this.discovery = new DiscoveryDialog(game);
    this.pause = new PauseMenu(game);
    this.confirmDialog = new ConfirmDialog(game);
    this.choiceDialog = new ChoiceDialog(game);
    this.saveStatus = new SaveStatus(() => this.hud);
    this.modals = [this.newCity, this.scenarios, this.scenarioResult, this.newspaper, this.saveLoad, this.settings, this.help, this.research, this.discovery, this.pause, this.confirmDialog, this.choiceDialog];
    this.topbar = new TopBar(game);
    this.toolbar = new Toolbar(game);
    this.toasts = new Toasts(game);
    this.inspector = new Inspector(game);
    this.coach = new CoachMark(game);
    this.streets = new StreetLabels(game);
    this.panels = [new StatsPanel(game), new BudgetPanel(game), new OverlaysPanel(game), new GoalsPanel(game), new DistrictsPanel(game), new LogPanel(game), new TransitPanel(game), new PoliciesPanel(game), new LandPanel(game)];
    const tabs: [PanelId, string][] = [
      ['stats', 'Overview'], ['budget', 'Budget'], ['policies', 'Policies'], ['districts', 'Districts'], ['transit', 'Transit'], ['land', 'Land'], ['goals', 'Goals'], ['log', 'Log'],
    ];
    const tabRow = h('div', { class: 'ci-tabs', role: 'tablist' });
    for (const [id, label] of tabs) {
      const b = h('button', { class: 'ci-tab', role: 'tab', 'data-panel': id, onclick: () => { this.game.play('click'); this.openPanel(id); } }, label);
      this.infoTabs.set(id, b);
      tabRow.appendChild(b);
    }
    const overlays = this.panels.find((p) => p.id === 'overlays')!;
    this.info = h(
      'section',
      { class: 'city-info hidden', 'aria-label': 'City information' },
      h('div', { class: 'ci-head' }, icon('stats', 17), h('div', { class: 'ci-title' }, 'City Information'), h('button', { class: 'icon-btn small', 'data-tip': 'Close (Esc)', 'aria-label': 'Close', onclick: () => this.closePanel() }, icon('close', 14))),
      tabRow,
      h('div', { class: 'ci-host' }, ...this.panels.filter((p) => p !== overlays).map((p) => p.el)),
    );
    this.layersHost = h('div', { class: 'layers-host' }, overlays.el);
    // Rail: construction tools come from the toolbar; analysis and information follow.
    const tb = this.toolbar;
    tb.addRailButton('analysis', 'layers', 'Analysis', 'Map layers: traffic, land value, pollution, coverage… (L) · Tab cycles layers', () => this.togglePanel('overlays'));
    tb.addRailButton('info', 'stats', 'City Info', 'Statistics, budget, policies, districts, goals (I)', () => this.toggleCityInfo());
    tb.addRailButton('research', 'flask', 'Research', 'Research centres, experiments, discoveries and the buildings they designed', () => (this.research.isOpen ? this.research.close() : this.research.open()));
    tb.addRailGap('rail-spacer');
    tb.addRailButton('news', 'news', 'News', 'City newspaper (N)', () => this.newspaper.open());
    tb.addRailButton('photo', 'photo', 'Photo', 'Photo mode (P)', () => this.game.setPhotoMode(true));
    this.legend = h('div', { class: 'legend-box hidden' });
    this.labels = h('div', { class: 'district-labels' });
    this.leftStack = h('div', { class: 'left-stack' }, this.info, this.inspector.el);
    this.chrome = h('div', { class: 'hud-chrome' }, this.topbar.el, tb.rail, this.leftStack, this.layersHost, this.legend, this.toasts.el, this.saveStatus.el, tb.el, this.milestoneBanner.el);
    this.hud = h('div', { class: 'hud hidden' }, this.streets.el, this.labels, this.chrome, this.cursor.el);
    this.applyScale();
    window.addEventListener('resize', () => this.applyScale());
    root.append(this.hud, this.coach.ring, this.coach.bubble, this.menu.el, ...this.modals.map((m) => m.el), this.loading.el, this.tooltip.el);
  }

  private photoHint = h('div', { class: 'photo-hint hidden' }, h('b', null, 'Photo mode'), ' · drag and scroll to frame the shot · ', h('kbd', null, 'Enter'), ' save picture · ', h('kbd', null, 'P'), ' or ', h('kbd', null, 'Esc'), ' exit');
  private photoFlash = h('div', { class: 'photo-flash' });

  /** Hides every interface element except a small hint. */
  setPhotoMode(on: boolean): void {
    if (!this.photoHint.isConnected) this.root.append(this.photoHint, this.photoFlash);
    this.hud.classList.toggle('hidden', on);
    this.coach.ring.classList.add('hidden');
    this.coach.bubble.classList.add('hidden');
    this.tooltip.hide();
    this.photoHint.classList.toggle('hidden', !on);
    // The hint fades after a moment so it stays out of pictures.
    this.photoHint.classList.remove('fade');
    if (on) setTimeout(() => this.photoHint.classList.add('fade'), 2600);
  }

  flashPhoto(): void {
    this.photoFlash.classList.remove('go');
    void this.photoFlash.offsetWidth;
    this.photoFlash.classList.add('go');
  }

  confirm(title: string, text: string, okLabel = 'OK'): Promise<boolean> {
    return this.confirmDialog.ask(title, text, okLabel);
  }

  /** Asks with several buttons ([value, label, class]); resolves to the value, or 'cancel' if dismissed. */
  choose(title: string, text: string, buttons: [string, string, string][]): Promise<string> {
    return this.choiceDialog.ask(title, text, buttons);
  }

  showMenu(): void {
    this.hud.classList.add('hidden');
    void this.menu.show();
  }

  hideMenu(): void {
    this.menu.hide();
  }

  showHud(): void {
    this.menu.hide();
    this.hud.classList.remove('hidden');
    this.toolbar.close();
    this.closePanel();
    this.toolbar.highlight(null);
    this.game.thumbs.prewarm(dockThumbs());
  }

  onCityAttached(): void {
    this.inspector.show(null);
    this.legend.classList.add('hidden');
    this.labels.innerHTML = '';
  }

  onToolChanged(): void {
    this.toolbar.syncTool();
    const districts = this.panels.find((p) => p.id === 'districts');
    if (districts?.isOpen) districts.render();
  }

  onSpeedChanged(): void {
    /* top bar refreshes every frame */
  }

  onOverlayChanged(id: OverlayId): void {
    const info = OVERLAYS.find((o) => o.id === id);
    if (!info) {
      this.legend.classList.add('hidden');
      return;
    }
    this.legend.innerHTML = '';
    this.legend.append(
      h('div', { class: 'legend-title' }, icon('layers', 16), info.label, h('button', { class: 'icon-btn small', 'aria-label': 'Close layer', onclick: () => this.game.setOverlay('none') }, icon('close', 14))),
      ...(info.legend[0]
        ? [h('div', { class: `legend-ramp ${id}` }), h('div', { class: 'legend-ends' }, h('span', null, info.legend[0]), h('span', null, info.legend[1]))]
        : []),
      h('div', { class: 'legend-desc' }, Overlays.describe(id)),
    );
    this.legend.classList.toggle('hidden', this.layersOpen);
    const p = this.panels.find((x) => x.id === 'overlays');
    if (p?.isOpen) p.render();
  }

  cycleOverlay(): void {
    const cur = this.game.world?.overlays.mode ?? 'none';
    const order: OverlayId[] = ['none', ...OVERLAYS.map((o) => o.id)];
    const next = order[(order.indexOf(cur) + 1) % order.length];
    this.game.setOverlay(next);
  }

  toast(n: Pick<Notice, 'severity' | 'icon' | 'title' | 'text'> & { x?: number; z?: number }): void {
    this.toasts.push(n);
    const log = this.panels.find((p) => p.id === 'log');
    if (log?.isOpen) log.render();
  }

  milestone(title: string, unlocks: string[]): void {
    this.milestoneBanner.show(title, unlocks);
    if (this.toolbar.open) this.toolbar.renderTray();
  }

  /** A new edition is out: a toast with the headline that opens the paper. */
  newsToast(ed: Edition): void {
    this.newspaper.refresh();
    const lead = ed.stories[0];
    if (!lead) return;
    this.toasts.push({ severity: 'info', icon: 'news', title: ed.paper, text: lead.title, onClick: () => this.newspaper.open(), tip: 'Click to read the paper' });
  }

  refreshGoals(): void {
    const p = this.panels.find((x) => x.id === 'goals');
    if (p?.isOpen) p.render();
  }

  flashMoney(delta: number): void {
    this.topbar.flashMoney(delta);
  }

  /** Opens a panel: map layers on the right, everything else as a City Information tab. */
  openPanel(id: PanelId): void {
    if (id === 'overlays') {
      this.panels.find((p) => p.id === 'overlays')!.open();
      this.legend.classList.add('hidden');
      this.syncRail();
      return;
    }
    for (const p of this.panels) {
      if (p.id === 'overlays') continue;
      if (p.id === id) p.open();
      else p.close();
    }
    this.info.classList.remove('hidden');
    for (const [pid, b] of this.infoTabs) {
      toggle(b, 'active', pid === id);
      b.setAttribute('aria-selected', pid === id ? 'true' : 'false');
    }
    if (id === 'districts') this.game.play('open');
    this.syncRail();
  }

  togglePanel(id: PanelId): void {
    const p = this.panels.find((x) => x.id === id);
    if (p?.isOpen) {
      this.game.play('close');
      this.closePanel(id === 'overlays' ? 'overlays' : undefined);
    } else {
      this.game.play('open');
      this.openPanel(id);
    }
  }

  /** City Information remembers its last tab. */
  private lastInfo: PanelId = 'stats';

  toggleCityInfo(): void {
    if (!this.info.classList.contains('hidden')) {
      this.game.play('close');
      this.closePanel();
    } else {
      this.game.play('open');
      this.openPanel(this.lastInfo);
    }
  }

  get layersOpen(): boolean {
    return !!this.panels.find((p) => p.id === 'overlays')?.isOpen;
  }

  /** Closes the map layers (`'overlays'`) or City Information; with no id, both. */
  closePanel(id?: PanelId): void {
    if (id === undefined || id === 'overlays') {
      this.panels.find((p) => p.id === 'overlays')?.close();
      const mode = this.game.world?.overlays.mode ?? 'none';
      if (mode !== 'none') this.onOverlayChanged(mode);
    }
    if (id !== 'overlays') {
      const open = this.panels.find((p) => p.id !== 'overlays' && p.isOpen);
      if (open) this.lastInfo = open.id;
      for (const p of this.panels) if (p.id !== 'overlays') p.close();
      this.info.classList.add('hidden');
    }
    this.syncRail();
  }

  private syncRail(): void {
    const a = this.toolbar.railButton('analysis');
    const i = this.toolbar.railButton('info');
    if (a) toggle(a, 'active', this.layersOpen);
    toggle(this.hud, 'layers-open', this.layersOpen);
    if (i) toggle(i, 'active', !this.info.classList.contains('hidden'));
  }

  /** Closes popovers that shouldn't stay open while interacting with the map. */
  closeTransient(): void {
    this.tooltip.hide();
  }

  modalOpen(): boolean {
    return this.modals.some((m) => m.isOpen);
  }

  closeTopmost(): boolean {
    for (const m of [...this.modals].reverse()) {
      if (m.isOpen) {
        m.close();
        return true;
      }
    }
    if (this.game.selection) {
      this.game.select(null);
      return true;
    }
    if (!this.info.classList.contains('hidden')) {
      this.closePanel();
      return true;
    }
    if (this.layersOpen) {
      this.closePanel('overlays');
      return true;
    }
    if (this.toolbar.open) {
      this.toolbar.close();
      this.game.setTool('inspect');
      return true;
    }
    return false;
  }

  openPause(): void {
    this.pause.open();
  }

  update(dt: number): void {
    if (this.game.state !== 'playing') return;
    toggle(this.hud, 'left-open', !this.info.classList.contains('hidden') || !this.inspector.el.classList.contains('hidden'));
    this.topbar.update(dt);
    // The readout follows the pointer over the map only, never over panels.
    this.cursor.update(this.game.input.pointer.inside ? this.game.tool.label() : null);
    this.inspector.update(dt);
    this.research.update();
    this.coach.update(dt);
    this.statTimer -= dt;
    if (this.statTimer <= 0) {
      this.statTimer = 0.5;
      for (const p of this.panels) if (p.isOpen) p.update();
    }
    this.labelTimer -= dt;
    if (this.labelTimer <= 0) {
      this.labelTimer = 0.05;
      this.updateLabels();
      this.streets.update();
    }
  }

  private labelEls = new Map<number, HTMLElement>();
  private centroidVersion = -1;
  private centroids = new Map<number, { x: number; z: number; cells: number }>();

  private updateLabels(): void {
    const city = this.game.city;
    if (!city) return;
    if (city.districts.version !== this.centroidVersion) {
      this.centroidVersion = city.districts.version;
      this.centroids = city.districts.centroids();
    }
    const show = this.game.cam.distance > 350 || this.game.world?.overlays.mode === 'districts';
    const seen = new Set<number>();
    for (const [id, c] of this.centroids) {
      const d = city.districts.list.get(id);
      if (!d) continue;
      seen.add(id);
      let el = this.labelEls.get(id);
      if (!el) {
        el = h('div', { class: 'district-label' });
        this.labels.appendChild(el);
        this.labelEls.set(id, el);
      }
      if (el.textContent !== d.name) el.textContent = d.name;
      const p = this.game.worldToScreen(c.x, city.terrain.heightAt(c.x, c.z) + 20, c.z);
      el.style.display = show && p.visible ? '' : 'none';
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%)`;
    }
    for (const [id, el] of this.labelEls) {
      if (!seen.has(id)) {
        el.remove();
        this.labelEls.delete(id);
      }
    }
  }
}
