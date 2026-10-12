import { formatInt, formatMoney, formatPct } from '../core/math';
import { SCENARIO_BY_ID, formatMonths, monthsLeft } from '../sim/progress/Scenarios';
import { METRO, METRO_UNLOCK } from '../sim/transit/Metro';
import { TREE_COST } from '../sim/CityCommands';
import { EARTH_COST } from '../sim/world/Terraform';
import { type BrushMode, TERRAFORM_MODES } from '../tools/TerraformTool';
import type { Game } from '../game/Game';
import { MILESTONES, ZONE_UNLOCK, roadUnlocked } from '../sim/progress/Progress';
import { isFreeway, ROAD_TYPE_LIST, type RoadTypeId } from '../sim/roads/RoadTypes';
import { SERVICE_TYPES, type ServiceCategory, type ServiceType } from '../sim/services/ServiceTypes';
import type { Notice } from '../sim/Notifications';
import { ZONE_INFO, Zone } from '../sim/types';
import { TRANSIT_UNLOCK } from '../sim/CityCommands';
import { BUS } from '../sim/transit/Transit';
import { WEATHER_LABEL } from '../sim/world/Weather';
import type { RoadMode } from '../tools/RoadTool';
import type { CursorLabel as Label } from '../tools/Tool';
import type { ZoneMode } from '../tools/ZoneTool';
import { h, setText, toggle } from './dom';
import { icon } from './icons';
import { brandMark } from './brand';
import { DemandPanel } from './DemandPanel';
import { bindingName } from '../game/Keybinds';
import type { ThumbSpec } from '../render/Thumbnails';
import { ARCHETYPES } from '../sim/buildings/Archetypes';

const SERVICE_ICON: Record<string, string> = {
  police: 'police', fire: 'fire', health: 'health', education: 'education', garbage: 'garbage', park: 'park', power: 'power', water: 'water', sewage: 'sewage',
  pocket_park: 'tree', community_garden: 'tree', sports_courts: 'grid', sports_field: 'flag', university: 'education',
  landmark: 'landmark', city_hall: 'landmark', museum: 'museum', cathedral: 'cathedral', stadium: 'stadium', tower: 'obstower',
  research: 'flask', research_center: 'flask',
};

/** The building a zone card shows, and how tall to draw it. */
const ZONE_THUMB: Partial<Record<Zone, [string, number]>> = {
  [Zone.ResLow]: ['house_family', 2], [Zone.ResMed]: ['lowrise_apts', 4], [Zone.ResHigh]: ['res_tower', 14],
  [Zone.Commercial]: ['mixed_use', 4], [Zone.Office]: ['office_mid', 9], [Zone.Industrial]: ['factory', 1],
  [Zone.CommercialHigh]: ['retail_tower', 16], [Zone.IndustrialLight]: ['tech_park', 2],
};

type Thumb = [string, ThumbSpec];

function zoneThumb(z: Zone): Thumb | undefined {
  const pick = ZONE_THUMB[z];
  const a = pick && ARCHETYPES.find((q) => q.id === pick[0]);
  if (!pick || !a) return undefined;
  return [`zone:${z}`, { kind: 'building', style: a.style, w: a.frontage[1], d: a.depth[1], floors: pick[1], level: a.levels[1], seed: 9100 + z }];
}

const serviceThumb = (st: ServiceType): Thumb => [`svc:${st.id}`, { kind: 'building', style: st.style, w: st.w, d: st.d, floors: 2, level: 1, seed: 4242, plane: st.id === 'airport' }];
const roadThumb = (id: RoadTypeId): Thumb => [`road:${id}`, { kind: 'road', type: id, with: 'cars' }];
const BUS_STOP_THUMB: Thumb = ['transit:stop', { kind: 'road', type: 'street', with: 'stop' }];
const BUS_LINE_THUMB: Thumb = ['transit:bus', { kind: 'road', type: 'street', with: 'bus' }];
const TREES_THUMB: Thumb = ['terrain:plant', { kind: 'trees' }];

/** Every dock thumbnail, so they can be rendered before the dock is first opened. */
export function dockThumbs(): Thumb[] {
  const out: Thumb[] = ROAD_TYPE_LIST.map((rt) => roadThumb(rt.id));
  for (const z of [Zone.ResLow, Zone.ResMed, Zone.ResHigh, Zone.Commercial, Zone.CommercialHigh, Zone.Office, Zone.Industrial, Zone.IndustrialLight]) {
    const t = zoneThumb(z);
    if (t) out.push(t);
  }
  out.push(...SERVICE_TYPES.map(serviceThumb), BUS_STOP_THUMB, BUS_LINE_THUMB, TREES_THUMB);
  return out;
}

// ── Top bar ─────────────────────────────────────────────────────────────────

export class TopBar {
  readonly el: HTMLElement;
  private name: HTMLElement;
  private title: HTMLElement;
  private pop: HTMLElement;
  private popTrend: HTMLElement;
  private happy: HTMLElement;
  private happyBox: HTMLElement;
  private utils: Record<'power' | 'water' | 'sewage', { box: HTMLElement; val: HTMLElement }>;
  private jobs: HTMLElement;
  private jobsBox: HTMLElement;
  private scn: HTMLElement;
  private scnText: HTMLElement;
  private scnTimer = 0;
  private statTimer = 0;
  private date: HTMLElement;
  private skyKey = '';
  private time: HTMLElement;
  private sky: HTMLElement;
  private money: HTMLElement;
  private net: HTMLElement;
  private speedBtns: HTMLButtonElement[] = [];
  private bars: Record<string, HTMLElement> = {};
  readonly demandPanel: DemandPanel;
  private lastPop = 0;
  private trend = 0;
  private trendTimer = 0;

  constructor(private game: Game) {
    this.name = h('div', { class: 'tb-name' });
    this.title = h('div', { class: 'tb-sub' });
    this.pop = h('span', { class: 'tb-val' });
    this.popTrend = h('span', { class: 'tb-trend' });
    this.happy = h('span', { class: 'tb-val' });
    this.happyBox = h('div', { class: 'tb-stat', 'data-tip': 'Average happiness of residents' }, icon('happy', 16), this.happy);
    this.scnText = h('span', { class: 'tb-scn-text' });
    this.scn = h('button', { class: 'tb-stat tb-scenario hidden', 'data-tip': 'Scenario objectives (click for details)', onclick: () => this.game.ui.openPanel('goals') }, icon('flag', 15), this.scnText);
    this.date = h('span', { class: 'tb-date' });
    this.time = h('span', { class: 'tb-time' });
    this.sky = h('span', { class: 'tb-sky' });
    this.money = h('span', { class: 'tb-money' });
    this.net = h('span', { class: 'tb-net' });
    const util = (ic: string, label: string) => {
      const val = h('span', { class: 'tb-val small' });
      const box = h('div', { class: 'tb-stat tb-util' }, icon(ic, 15), h('span', { class: 'tb-label' }, label), val);
      return { box, val };
    };
    this.utils = { power: util('power', 'Power'), water: util('water', 'Water'), sewage: util('sewage', 'Sewage') };
    this.jobs = h('span', { class: 'tb-val small' });
    this.jobsBox = h('div', { class: 'tb-stat tb-util' }, icon('office', 15), h('span', { class: 'tb-label' }, 'Jobless'), this.jobs);
    const speeds: [string, string, number][] = [['pause', 'Pause (Space)', 0], ['play', 'Normal speed (Shift+1)', 1], ['fast', 'Fast (Shift+2)', 2], ['faster', 'Very fast (Shift+3)', 3]];
    const speedBox = h('div', { class: 'speed', role: 'group', 'aria-label': 'Simulation speed' });
    for (const [ic, tip, s] of speeds) {
      const b = h('button', { class: 'speed-btn', 'data-tip': tip, 'aria-label': tip, onclick: () => { this.game.setSpeed(s as 0 | 1 | 2 | 3); this.game.play('click'); } }, icon(ic, 15));
      this.speedBtns.push(b);
      speedBox.appendChild(b);
    }
    // Demand bars: each is a button that opens its tab of the demand breakdown.
    const demand = h('div', { class: 'demand', role: 'group', 'aria-label': 'Development demand' });
    const bars = h('div', { class: 'demand-bars' });
    this.demandPanel = new DemandPanel(game, bars);
    for (const [k, label, cls, name] of [['residential', 'R', 'r', 'Residential'], ['commercial', 'C', 'c', 'Commercial'], ['industrial', 'I', 'i', 'Industrial'], ['office', 'O', 'o', 'Office']] as const) {
      const fill = h('div', { class: `dbar-fill ${cls}` });
      this.bars[k] = fill;
      bars.appendChild(h('button', { class: 'dbar', 'data-tip': `${name} demand (click for details)`, 'aria-label': `${name} demand`, onclick: () => this.demandPanel.toggle(k) }, h('div', { class: 'dbar-track' }, fill), h('div', { class: `dbar-label ${cls}` }, label)));
    }
    demand.append(bars, this.demandPanel.el);
    const action = (ic: string, tip: string, fn: () => void) => h('button', { class: 'tb-icon', 'data-tip': tip, 'aria-label': tip.replace(/ \(.*\)$/, ''), onclick: fn }, icon(ic, 17));

    this.el = h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'tb-brand' }, brandMark('tb-logo'), h('div', { class: 'tb-names' }, this.name, this.title)),
      h('div', { class: 'tb-sep' }),
      h('button', { class: 'tb-stat tb-moneybox', 'data-tip': 'Treasury · projected monthly cash flow (click for the budget)', onclick: () => this.game.ui.openPanel('budget') }, icon('money', 16), this.money, this.net),
      h('div', { class: 'tb-stat', 'data-tip': 'Population · change over the last few seconds' }, icon('people', 16), this.pop, this.popTrend),
      this.happyBox,
      h('div', { class: 'tb-sep' }),
      this.utils.power.box,
      this.utils.water.box,
      this.utils.sewage.box,
      this.jobsBox,
      this.scn,
      h('div', { class: 'tb-spacer' }),
      h('div', { class: 'tb-clock' }, this.sky, this.date, this.time),
      speedBox,
      h('div', { class: 'tb-sep' }),
      demand,
      h('div', { class: 'tb-sep' }),
      action('save', 'Save (Ctrl+S)', () => void this.game.save()),
      action('gear', 'Settings', () => this.game.ui.settings.open()),
      action('menu', 'Menu (Esc)', () => this.game.ui.openPause()),
    );
  }

  /** Utility load and unemployment, from the simulation's own totals. */
  private updateIndicators(): void {
    const city = this.game.city;
    if (!city) return;
    const UNITS = { power: 'MW', water: 'm³/day', sewage: 'm³/day' } as const;
    const NAMES = { power: 'Electricity', water: 'Water', sewage: 'Sewage' } as const;
    for (const kind of ['power', 'water', 'sewage'] as const) {
      const t = city.utilities.totals[kind];
      const { box, val } = this.utils[kind];
      const fmt = (v: number) => (kind === 'power' ? v.toFixed(1) : formatInt(v));
      let state: '' | 'warn' | 'bad' = '';
      if (t.production <= 0 && t.consumption <= 0) {
        setText(val, '—');
        box.setAttribute('data-tip', `${NAMES[kind]}: nothing built yet`);
      } else {
        const load = t.production > 0 ? t.consumption / t.production : Infinity;
        setText(val, Number.isFinite(load) ? `${Math.round(load * 100)}%` : 'None');
        state = t.unserved > 0 || load > 1 ? 'bad' : load > 0.9 ? 'warn' : '';
        box.setAttribute('data-tip', `${NAMES[kind]}: ${fmt(t.consumption)} of ${fmt(t.production)} ${UNITS[kind]} in use${t.unserved ? ` · ${formatInt(t.unserved)} buildings without service` : ''}`);
      }
      toggle(box, 'warn', state === 'warn');
      toggle(box, 'bad', state === 'bad');
    }
    const s = city.stats;
    if (s.workers > 0) {
      setText(this.jobs, formatPct(s.unemployment, 1));
      this.jobsBox.setAttribute('data-tip', `Unemployment: ${formatInt(s.workers - s.employed)} of ${formatInt(s.workers)} workers looking · ${formatInt(Math.max(0, s.jobs - s.employed))} open jobs`);
    } else {
      setText(this.jobs, '—');
      this.jobsBox.setAttribute('data-tip', 'Unemployment: no workers yet');
    }
    toggle(this.jobsBox, 'warn', s.workers > 30 && s.unemployment > 0.08 && s.unemployment <= 0.15);
    toggle(this.jobsBox, 'bad', s.workers > 30 && s.unemployment > 0.15);
    const hp = s.happiness;
    toggle(this.happyBox, 'warn', s.population > 0 && hp < 55 && hp >= 40);
    toggle(this.happyBox, 'bad', s.population > 0 && hp < 40);
  }

  update(dt: number): void {
    const g = this.game;
    const city = g.city;
    if (!city) return;
    setText(this.name, city.name);
    setText(this.title, MILESTONES[city.milestoneIndex].title);
    const pop = city.population.residents;
    setText(this.pop, formatInt(pop));
    this.trendTimer -= dt;
    if (this.trendTimer <= 0) {
      this.trendTimer = 4.8;
      this.trend = pop - this.lastPop;
      this.lastPop = pop;
    }
    setText(this.popTrend, this.trend > 0 ? `+${formatInt(this.trend)}` : this.trend < 0 ? `−${formatInt(-this.trend)}` : '');
    toggle(this.popTrend, 'neg', this.trend < 0);
    setText(this.happy, pop > 0 ? `${Math.round(city.stats.happiness)}%` : '—');
    setText(this.date, city.clock.dateString());
    const hh = Math.floor(g.hour);
    const mm = Math.floor((g.hour - hh) * 60 / 15) * 15;
    setText(this.time, `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
    const w = city.weather;
    const kind = w.displayKind;
    const ic = kind === 'clear' ? (g.env.night > 0.5 ? 'moon' : 'sun') : kind === 'cloudy' ? 'cloud' : kind;
    const temp = Math.round(w.temperature);
    const skyKey = `${ic}|${temp}`;
    if (skyKey !== this.skyKey) {
      this.skyKey = skyKey;
      this.sky.innerHTML = '';
      this.sky.append(icon(ic, 14), h('span', null, `${temp}°C`));
      this.sky.setAttribute('data-tip', `${WEATHER_LABEL[kind]} · ${temp} °C${w.snowCover > 0.3 ? ' · snow on the ground' : w.wet > 0.4 ? ' · wet roads' : ''}`);
    }
    const e = city.economy;
    setText(this.money, e.unlimited ? '∞' : formatMoney(e.money));
    toggle(this.money, 'neg', e.money < 0 && !e.unlimited);
    const net = e.projectedNet;
    setText(this.net, `${net >= 0 ? '+' : '−'}${formatMoney(Math.abs(net))}/mo`);
    toggle(this.net, 'neg', net < 0);
    this.speedBtns.forEach((b, i) => toggle(b, 'active', g.speed === i));
    this.demandPanel.update(dt);
    for (const [k, el] of Object.entries(this.bars)) el.style.height = `${Math.max(3, city.demand.value[k as keyof typeof city.demand.value])}%`;
    this.statTimer -= dt;
    if (this.statTimer <= 0) {
      this.statTimer = 0.5;
      this.updateIndicators();
    }
    this.scnTimer -= dt;
    if (this.scnTimer <= 0) {
      this.scnTimer = 1;
      this.updateScenario();
    }
  }

  /** Countdown and objectives met, refreshed once a second (objectives scan the city). */
  private updateScenario(): void {
    const city = this.game.city;
    const st = city?.scenario;
    const def = st ? SCENARIO_BY_ID.get(st.id) : undefined;
    toggle(this.scn, 'hidden', !def);
    if (!city || !st || !def) return;
    const met = def.objectives.filter((o) => o.progress(city) >= 1).length;
    setText(this.scnText, st.result === 'won' ? 'Scenario complete' : st.result === 'lost' ? 'Time is up' : `${met}/${def.objectives.length} · ${formatMonths(monthsLeft(city))} left`);
    toggle(this.scn, 'won', st.result === 'won');
    toggle(this.scn, 'urgent', !st.result && monthsLeft(city) <= 6);
  }

  flashMoney(delta: number): void {
    if (!delta) return;
    const f = h('div', { class: `money-float ${delta < 0 ? 'neg' : 'pos'}` }, `${delta < 0 ? '−' : '+'}${formatMoney(Math.abs(delta))}`);
    this.money.parentElement?.appendChild(f);
    setTimeout(() => f.remove(), 1400);
  }
}

// ── Tool rail and construction dock ─────────────────────────────────────────

type Category = 'inspect' | 'roads' | 'zoning' | 'services' | 'utilities' | 'parks' | 'transit' | 'terrain' | 'districts' | 'bulldoze';
type BuildCategory = 'roads' | 'zoning' | 'services' | 'utilities' | 'transit' | 'parks' | 'terrain';
type DockTab = 'roads' | 'zoning' | 'services' | 'utilities' | 'transit' | 'landscaping';

const DOCK_TABS: [DockTab, string, string][] = [
  ['roads', 'road', 'Roads'],
  ['zoning', 'zone', 'Zoning'],
  ['services', 'services', 'Services'],
  ['utilities', 'utilities', 'Utilities'],
  ['transit', 'bus', 'Transit'],
  ['landscaping', 'parks', 'Landscaping'],
];

// Parks & landmarks live under Services; Landscaping is the terrain tools.
const tabOf = (c: BuildCategory): DockTab => (c === 'parks' ? 'services' : c === 'terrain' ? 'landscaping' : c);

export class Toolbar {
  /** Bottom construction dock (shown while a build category is open). */
  readonly el: HTMLElement;
  /** Left tool rail. */
  readonly rail: HTMLElement;
  private tray: HTMLElement;
  private buttons = new Map<string, HTMLButtonElement>();
  open: BuildCategory | null = null;
  private lastBuild: BuildCategory = 'roads';
  private roadType: RoadTypeId = 'street';
  private roadMode: RoadMode = 'straight';
  private roadOneway = false;
  private roadRaised = false;
  private zone: Zone = Zone.ResLow;
  private zoneMode: ZoneMode = 'brush';
  private terraformMode: BrushMode = 'raise';

  /** Category the tray was last rendered for. */
  private rendered: BuildCategory | null = null;

  constructor(private game: Game) {
    this.tray = h('div', { class: 'tray hidden', role: 'toolbar', 'aria-label': 'Construction' });
    // Notifications sit above the dock while it is open, so they need its height.
    new ResizeObserver(() => this.tray.closest<HTMLElement>('.hud')?.style.setProperty('--dock-h', `${this.tray.offsetHeight}px`)).observe(this.tray);
    this.rail = h('nav', { class: 'rail', 'aria-label': 'Tools' });
    // The seven main tools take the number keys 1–7, in rail order.
    // [rail id, icon, label, tooltip, keybind action]; the keys shown follow the player's bindings.
    const tools: [string, string, string, string, string][] = [
      ['inspect', 'cursor', 'Select', 'Select and inspect', 'toolSelect'],
      ['roads', 'road', 'Roads', 'Build and upgrade roads', 'toolRoads'],
      ['zoning', 'zone', 'Zoning', 'Zone land for development', 'toolZoning'],
      ['services', 'services', 'Services', 'Police, fire, health, education, garbage, parks and landmarks', 'toolServices'],
      ['utilities', 'utilities', 'Utilities', 'Electricity, water and sewage', 'toolUtilities'],
      ['transit', 'bus', 'Transit', 'Buses, metro, airport and harbour', 'toolTransit'],
      ['terrain', 'terrain', 'Landscape', 'Raise, lower and smooth terrain; plant and clear trees', 'toolLandscape'],
      ['build', 'build', 'Build', 'Open the construction dock', 'toolBuild'],
      ['bulldoze', 'bulldoze', 'Demolish', 'Demolish roads and buildings', 'toolBulldoze'],
    ];
    for (const [id, ic, label, tip, action] of tools) {
      const badge = h('kbd', { class: 'rail-key', 'aria-hidden': 'true' });
      const b = h('button', { class: `rail-btn${id === 'bulldoze' ? ' danger' : ''}`, 'data-cat': id, 'aria-label': label, onclick: () => this.select(id as Category | 'build') },
        icon(ic, 20), h('span', null, label), badge);
      this.hints.push({ el: b, badge, tip, action, numbered: id !== 'build' && id !== 'bulldoze' });
      this.buttons.set(id, b);
      this.rail.appendChild(b);
      if (id === 'inspect' || id === 'terrain' || id === 'bulldoze') this.rail.appendChild(h('div', { class: 'rail-sep' }));
    }
    this.refreshKeyHints();
    this.el = h('div', { class: 'dock-wrap' }, this.tray);
  }

  /** Extra rail buttons (analysis, city information…) added by the UI. */
  addRailButton(id: string, ic: string, label: string, tip: string, onClick: () => void): HTMLButtonElement {
    const b = h('button', { class: 'rail-btn', 'data-tip': tip, 'data-cat': id, 'aria-label': label, onclick: onClick }, icon(ic, 20), h('span', null, label));
    this.buttons.set(id, b);
    this.rail.appendChild(b);
    return b;
  }

  addRailGap(cls: 'rail-sep' | 'rail-spacer'): void {
    this.rail.appendChild(h('div', { class: cls }));
  }

  /** City services or parks & landmarks, both under the Services tab. */
  private serviceSwitch(): HTMLElement[] {
    return [
      this.modeBtn('City services', 'services', this.open === 'services', 'Police, fire, health, education and garbage', () => { if (this.open !== 'services') this.select('services'); }),
      this.modeBtn('Parks & landmarks', 'park', this.open === 'parks', 'Parks, plazas and landmarks', () => { if (this.open !== 'parks') this.select('parks'); }),
    ];
  }

  railButton(id: string): HTMLButtonElement | undefined {
    return this.buttons.get(id);
  }

  private hints: { el: HTMLElement; badge: HTMLElement; tip: string; action: string; numbered: boolean }[] = [];

  /** Rail tooltips and number badges show the player's current key bindings. */
  refreshKeyHints(): void {
    const keys = this.game.keys;
    for (const hnt of this.hints) {
      const binds = keys.get(hnt.action);
      const names = binds.map(bindingName);
      hnt.el.setAttribute('data-tip', names.length ? `${hnt.tip} (${names.join(' · ')})` : hnt.tip);
      if (names.length) hnt.el.setAttribute('aria-keyshortcuts', binds.join(' '));
      else hnt.el.removeAttribute('aria-keyshortcuts');
      // The corner badge shows a single-character key (like 1–7) when there is one.
      const short = hnt.numbered ? names.find((n) => n.length === 1) ?? '' : '';
      hnt.badge.textContent = short;
      hnt.badge.style.display = short ? '' : 'none';
    }
  }

  /** Opens zoning with a zone type picked (used by the demand panel). */
  pickZone(z: Zone): void {
    this.zone = z;
    if (this.open !== 'zoning') this.select('zoning');
    else {
      this.activateZone();
      this.renderTray();
    }
  }

  /** Opens a dock category without toggling it shut if it is already open. */
  openCategory(cat: 'roads' | 'transit' | 'services' | 'parks'): void {
    if (this.open !== cat) this.select(cat);
  }

  select(cat: Category | 'build'): void {
    const g = this.game;
    g.play('click');
    if (cat === 'build') {
      if (this.open) {
        this.close();
        g.setTool('inspect');
      } else this.select(this.lastBuild);
      return;
    }
    if (cat === 'inspect') {
      this.close();
      g.setTool('inspect');
      return;
    }
    if (cat === 'bulldoze') {
      this.close();
      g.setTool(g.tool.id === 'bulldoze' ? 'inspect' : 'bulldoze');
      this.highlight(null);
      return;
    }
    if (cat === 'districts') {
      this.close();
      g.ui.openPanel('districts');
      return;
    }
    if (this.open === cat) {
      this.close();
      g.setTool('inspect');
      return;
    }
    this.open = cat;
    this.lastBuild = cat;
    this.renderTray();
    if (cat === 'roads') this.activateRoad();
    else if (cat === 'zoning') this.activateZone();
    else if (cat === 'terrain') this.activateTerraform();
    else g.setTool('inspect');
    this.highlight(cat);
  }

  close(): void {
    this.open = null;
    this.tray.classList.add('hidden');
    this.game.ui?.hud.classList.remove('building');
    this.highlight(null);
  }

  highlight(cat: Category | null): void {
    const tool = this.game.tool?.id;
    for (const [id, b] of this.buttons) {
      if (id === 'analysis' || id === 'info' || id === 'news' || id === 'photo') continue;
      let on = false;
      if (id === 'build') on = !!this.open;
      else if (id === 'inspect') on = !this.open && tool === 'inspect';
      else if (id === 'bulldoze') on = tool === 'bulldoze';
      else if (id === 'services') on = cat === 'services' || cat === 'parks';
      else on = id === cat;
      toggle(b, 'active', on);
    }
  }

  syncTool(): void {
    const id = this.game.tool.id;
    if (id === 'inspect' && this.open && this.open !== 'services' && this.open !== 'utilities' && this.open !== 'parks' && this.open !== 'transit') this.close();
    if (id === 'bulldoze' && this.open) this.close();
    this.highlight(this.open);
    if (this.open) this.renderTray();
  }

  private activateRoad(): void {
    this.game.setTool('road', (t: import('../tools/RoadTool').RoadTool) => t.configure(this.roadType, this.roadMode, this.roadOneway, this.roadRaised));
  }

  private activateTerraform(): void {
    this.game.setTool('terraform', (t: import('../tools/TerraformTool').TerraformTool) => t.configure(this.terraformMode));
  }

  private activateZone(): void {
    this.game.setTool('zone', (t: import('../tools/ZoneTool').ZoneTool) => t.configure(this.zone, this.zoneMode));
  }

  private card(opts: { icon: string; thumb?: Thumb; title: string; sub: string; active: boolean; locked?: string; tip?: HTMLElement; color?: string; onClick: () => void }): HTMLElement {
    const c = h(
      'button',
      { class: `card${opts.active ? ' active' : ''}${opts.locked ? ' locked' : ''}`, 'aria-pressed': opts.active ? 'true' : 'false', onclick: () => { if (opts.locked) this.game.toastError(opts.locked); else { this.game.play('select'); opts.onClick(); } } },
      this.preview(opts),
      h('div', { class: 'card-title' }, opts.title),
      h('div', { class: 'card-sub' }, opts.locked ?? opts.sub),
    );
    if (opts.tip) {
      const tip = opts.tip;
      c.addEventListener('mouseenter', () => this.game.ui.tooltip.showEl(tip, c));
      c.addEventListener('mouseleave', () => this.game.ui.tooltip.hide());
    }
    return c;
  }

  /** A rendered model of the thing when there is one, otherwise the tool's icon. */
  private preview(opts: { icon: string; thumb?: Thumb; locked?: string; color?: string }): HTMLElement {
    const el = h('div', { class: `card-preview${opts.thumb ? ' has-thumb' : ''}`, style: opts.color ? `--c:${opts.color}` : '' });
    if (!opts.thumb) {
      el.append(icon(opts.locked ? 'lock' : opts.icon, 24));
      return el;
    }
    const img = h('img', { class: 'card-thumb', alt: '', draggable: 'false' });
    const show = (url: string) => {
      img.src = url;
      img.classList.add('ready');
    };
    const ready = this.game.thumbs.request(opts.thumb[0], opts.thumb[1], show);
    if (ready) show(ready);
    el.append(img);
    if (opts.locked) el.append(h('span', { class: 'card-lock' }, icon('lock', 12)));
    return el;
  }

  private modeBtn(label: string, ic: string, active: boolean, tip: string, onClick: () => void): HTMLElement {
    return h('button', { class: `mode-btn${active ? ' active' : ''}`, 'data-tip': tip, onclick: () => { this.game.play('click'); onClick(); } }, icon(ic, 15), h('span', null, label));
  }

  get isOpen(): boolean {
    return !!this.open;
  }

  /** Q / E: the previous or next dock tab, wrapping around. */
  cycleTab(dir: 1 | -1): void {
    if (!this.open) return;
    const ids = DOCK_TABS.map((t) => t[0]);
    const next = ids[(ids.indexOf(tabOf(this.open)) + dir + ids.length) % ids.length];
    this.select(next === 'landscaping' ? 'terrain' : next);
  }

  /** Category tabs along the top of the dock. */
  private tabs(): HTMLElement {
    const cur = this.open ? tabOf(this.open) : null;
    const row = h('div', { class: 'tray-tabs', role: 'tablist' });
    for (const [id, ic, label] of DOCK_TABS) {
      row.appendChild(
        h('button', { class: `tray-tab${cur === id ? ' active' : ''}`, role: 'tab', 'aria-selected': cur === id ? 'true' : 'false', 'data-tab': id, onclick: () => { if (cur !== id) this.select(id === 'landscaping' ? 'terrain' : id); } }, icon(ic, 15), h('span', null, label)),
      );
    }
    row.appendChild(h('div', { class: 'tray-tabs-spacer' }));
    row.appendChild(h('button', { class: 'icon-btn small', 'data-tip': 'Close (Esc)', 'aria-label': 'Close construction dock', onclick: () => { this.close(); this.game.setTool('inspect'); } }, icon('close', 14)));
    return row;
  }

  renderTray(): void {
    const g = this.game;
    const city = g.city;
    if (!city || !this.open) return;
    // Cards are rebuilt, so a tooltip for the old card would never get its mouseleave.
    g.ui.tooltip.hide();
    // Re-rendering the same category (picking a card) keeps the row where it was scrolled to.
    const keepScroll = this.rendered === this.open ? this.tray.querySelector('.tray-items')?.scrollLeft ?? 0 : 0;
    this.rendered = this.open;
    this.tray.innerHTML = '';
    this.tray.classList.remove('hidden');
    g.ui.hud.classList.add('building');
    this.tray.appendChild(this.tabs());
    const peak = city.peakPopulation;
    const header = (title: string, ...extra: HTMLElement[]) => h('div', { class: 'tray-head', 'aria-label': title }, extra.length ? h('div', { class: 'tray-modes' }, ...extra) : h('span', { class: 'tray-title' }, title));
    const items = h('div', { class: 'tray-items' });
    // The mouse wheel scrolls a long row of cards sideways.
    items.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || items.scrollWidth <= items.clientWidth) return;
      items.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
    if (this.open === 'roads') {
      this.tray.appendChild(
        header(
          'Roads',
          this.modeBtn('Straight', 'straight', this.roadMode === 'straight', 'Click start and end points', () => { this.roadMode = 'straight'; this.activateRoad(); this.renderTray(); }),
          this.modeBtn('Curved', 'curve', this.roadMode === 'curve', 'Click start, bend point, then end', () => { this.roadMode = 'curve'; this.activateRoad(); this.renderTray(); }),
          this.modeBtn('Grid', 'grid', this.roadMode === 'grid', 'Lay out a grid of streets: click two corners, then drag out the depth', () => { this.roadMode = 'grid'; this.activateRoad(); this.renderTray(); }),
          this.modeBtn('Upgrade', 'upgrade', this.roadMode === 'upgrade', 'Convert existing roads to the selected type', () => { this.roadMode = 'upgrade'; this.activateRoad(); this.renderTray(); }),
          this.modeBtn('Roundabout', 'roundabout', this.roadMode === 'roundabout', 'Click an intersection to turn it into a roundabout', () => { this.roadMode = 'roundabout'; this.activateRoad(); this.renderTray(); }),
          this.modeBtn('Direction', 'oneway', this.roadMode === 'direction', 'Click streets and avenues to make them one-way or flip them', () => { this.roadMode = 'direction'; this.activateRoad(); this.renderTray(); }),
          this.modeBtn('One-way', 'oneway', this.roadOneway, 'Draw new streets and avenues as one-way roads (traffic follows the drawing direction)', () => { this.roadOneway = !this.roadOneway; if (this.roadMode !== 'straight' && this.roadMode !== 'curve') this.roadMode = 'straight'; this.activateRoad(); this.renderTray(); }),
          ...(isFreeway(this.roadType) ? [this.modeBtn('Raised', 'upgrade', this.roadRaised, 'Build the highway on piers above the ground: roads underneath pass under it without a junction. Ramps at the ends; about 3 × the cost', () => { this.roadRaised = !this.roadRaised; if (this.roadMode !== 'straight' && this.roadMode !== 'curve') this.roadMode = 'straight'; this.activateRoad(); this.renderTray(); })] : []),
        ),
      );
      for (const rt of ROAD_TYPE_LIST) {
        const locked = roadUnlocked(rt.id, peak) ? undefined : `Unlocks at ${formatInt(rt.unlockPopulation)}`;
        items.appendChild(
          this.card({
            icon: rt.id === 'lane' ? 'street' : rt.id === 'parkway' ? 'boulevard' : rt.id === 'expressway' ? 'highway' : rt.id,
            thumb: roadThumb(rt.id),
            title: rt.name,
            sub: `${formatMoney(rt.costPerMeter)}/m · ${rt.speedKmh} km/h`,
            active: this.roadType === rt.id,
            locked,
            tip: tipBox(rt.name, rt.description, [
              ['Lanes', `${rt.lanes * 2}`], ['Capacity', `${formatInt(rt.lanes * 2 * rt.capacityPerLane)} veh/h`], ['Upkeep', `${formatMoney(rt.upkeepPerMeter * 100)}/100 m/mo`], ['Zoning', rt.zoning ? 'Yes' : 'No'],
            ]),
            onClick: () => { this.roadType = rt.id; this.activateRoad(); this.renderTray(); },
          }),
        );
      }
    } else if (this.open === 'zoning') {
      this.tray.appendChild(
        header(
          'Zoning',
          this.modeBtn('Brush', 'brush', this.zoneMode === 'brush', 'Paint with a brush ([ ] resize)', () => { this.zoneMode = 'brush'; this.activateZone(); this.renderTray(); }),
          this.modeBtn('Fill street', 'fill', this.zoneMode === 'fill', 'Zone one whole side of a street', () => { this.zoneMode = 'fill'; this.activateZone(); this.renderTray(); }),
        ),
      );
      const zones: [Zone, string, string][] = [
        [Zone.ResLow, 'home', 'Houses with gardens'], [Zone.ResMed, 'home', 'Townhouses & apartments'], [Zone.ResHigh, 'office', 'Residential towers'],
        [Zone.Commercial, 'shop', 'Shops and services'], [Zone.CommercialHigh, 'shop', 'Hotels, department stores and retail towers'], [Zone.Office, 'office', 'Offices for educated workers'],
        [Zone.Industrial, 'factory', 'Factories and warehouses'], [Zone.IndustrialLight, 'factory', 'Clean workshops and tech parks; fine near homes'],
        [Zone.None, 'erase', 'Remove zoning'],
      ];
      for (const [z, ic, desc] of zones) {
        const info = ZONE_INFO[z];
        const c = info.color;
        const locked = peak >= ZONE_UNLOCK[z] ? undefined : `Unlocks at ${formatInt(ZONE_UNLOCK[z])}`;
        items.appendChild(
          this.card({
            icon: ic,
            thumb: zoneThumb(z),
            title: z === Zone.None ? 'Dezone' : z === Zone.CommercialHigh ? 'Dense Commercial' : info.name.replace('-Density', '').replace(' Residential', ''),
            sub: z === Zone.None ? desc : `${info.short} · ${desc}`,
            active: this.zone === z,
            locked,
            color: z === Zone.None ? '#f87171' : `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`,
            tip: tipBox(z === Zone.None ? 'Remove zoning' : info.name, z === Zone.None ? 'Clears zoning. Buildings on dezoned land are eventually removed.' : `${desc}. Buildings grow automatically when there is demand and utilities.`, []),
            onClick: () => { this.zone = z; this.activateZone(); this.renderTray(); },
          }),
        );
      }
    } else if (this.open === 'terrain') {
      const tool = g.tools.terraform;
      const size = (label: string, r: number) =>
        this.modeBtn(label, 'brush', tool.radius === r, `Brush ${r * 2} m across ([ ] to resize)`, () => { tool.radius = r; this.activateTerraform(); this.renderTray(); });
      this.tray.appendChild(header('Terrain', size('Small', 20), size('Medium', 40), size('Large', 80)));
      for (const m of TERRAFORM_MODES) {
        const c = m.color;
        items.appendChild(
          this.card({
            icon: m.icon,
            thumb: m.id === 'plant' ? TREES_THUMB : undefined,
            title: m.name,
            sub: m.description,
            active: g.tool.id === 'terraform' && this.terraformMode === m.id,
            color: `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`,
            tip: m.id === 'plant' || m.id === 'clear'
              ? tipBox(m.name, m.id === 'plant' ? `${m.description}. Woods near homes raise land value and soak up pollution and traffic noise.` : `${m.description}.`, [['Cost', m.id === 'plant' ? `${formatMoney(TREE_COST)} per tree` : '$6 per tree']])
              : tipBox(`${m.name} terrain`, `${m.description}. Ground beside roads and buildings stays put. Hold Shift for fine control.`, [['Cost', `$${EARTH_COST.toFixed(2)} per m³`]]),
            onClick: () => { this.terraformMode = m.id; this.activateTerraform(); this.renderTray(); },
          }),
        );
      }
    } else if (this.open === 'transit') {
      this.tray.appendChild(header('Public Transit', this.modeBtn('Lines', 'line', false, 'Manage bus lines', () => g.ui.openPanel('transit'))));
      const locked = peak >= TRANSIT_UNLOCK ? undefined : `Unlocks at ${formatInt(TRANSIT_UNLOCK)}`;
      items.append(
        this.card({
          icon: 'stop',
          thumb: BUS_STOP_THUMB,
          title: 'Bus Stop',
          sub: `${formatMoney(BUS.stopCost)} · on any street`,
          active: g.tool.id === 'busStop',
          locked,
          tip: tipBox('Bus Stop', 'Riders walk up to about 330 m to a stop. Place stops along streets, then join them into a line.', [['Cost', formatMoney(BUS.stopCost)]]),
          onClick: () => { g.setTool('busStop'); this.renderTray(); },
        }),
        this.card({
          icon: 'line',
          thumb: BUS_LINE_THUMB,
          title: 'Bus Line',
          sub: `${formatMoney(BUS.lineCost)} · click stops in order`,
          active: g.tool.id === 'busLine',
          locked,
          tip: tipBox('Bus Line', 'Click stops in the order buses visit them, then click the first stop again (or press Enter). Buses loop the route.', [['Cost', formatMoney(BUS.lineCost)], ['Per bus', `${formatMoney(BUS.upkeepPerBus)}/month`]]),
          onClick: () => { g.setTool('busLine'); this.renderTray(); },
        }),
      );
      const metroLocked = peak >= METRO_UNLOCK ? undefined : `Unlocks at ${formatInt(METRO_UNLOCK)}`;
      items.append(
        this.card({
          icon: 'line',
          title: 'Metro Line',
          sub: `${formatMoney(METRO.lineCost)} + ${formatMoney(METRO.tunnelPerMeter)}/m tunnel`,
          active: g.tool.id === 'metroLine',
          locked: metroLocked,
          tip: tipBox('Metro Line', 'Click metro stations in order, then the first again (or Enter). Trains run underground in straight tunnels; existing tunnels are reused for free.', [['Line', formatMoney(METRO.lineCost)], ['Tunnel', `${formatMoney(METRO.tunnelPerMeter)}/m`], ['Per train', `${formatMoney(METRO.upkeepPerTrain)}/month`], ['Riders walk', `${METRO.walkRadius} m`]]),
          onClick: () => { g.setTool('metroLine'); this.renderTray(); },
        }),
      );
      for (const st of SERVICE_TYPES.filter((s) => s.category === 'transit')) {
        const lockedSt = peak >= st.unlockPopulation ? undefined : `Unlocks at ${formatInt(st.unlockPopulation)}`;
        items.appendChild(
          this.card({
            icon: st.id === 'metro_station' ? 'metro' : st.id === 'airport' ? 'plane' : st.id === 'cargo_port' ? 'anchor' : 'bus',
            thumb: serviceThumb(st),
            title: st.name,
            sub: `${formatMoney(st.cost)} · ${formatMoney(st.upkeep)}/mo`,
            active: g.tool.id === 'place' && g.tools.place.typeId === st.id,
            locked: lockedSt,
            tip: serviceTip(st),
            onClick: () => {
              g.setTool('place', (t: import('../tools/PlaceTool').PlaceTool) => t.configure(st.id));
              this.renderTray();
            },
          }),
        );
      }
    } else {
      const cat = this.open as ServiceCategory;
      this.tray.appendChild(header(cat === 'services' ? 'City Services' : cat === 'utilities' ? 'Utilities' : 'Parks & Landmarks', ...(cat === 'parks' || cat === 'services' ? this.serviceSwitch() : [])));
      // Buildings your researchers designed join the catalogue (this city only).
      const all = [...SERVICE_TYPES, ...city.research.serviceTypes()];
      for (const st of all.filter((s) => s.category === cat || (cat === 'parks' && s.category === 'landmarks'))) {
        const built = st.unique && [...city.buildings.all.values()].some((b) => b.typeId === st.id);
        const locked = built ? 'Already built' : peak >= st.unlockPopulation ? undefined : `Unlocks at ${formatInt(st.unlockPopulation)}`;
        const active = g.tool.id === 'place' && g.tools.place.typeId === st.id;
        const cost = city.research.costOf(st);
        items.appendChild(
          this.card({
            icon: SERVICE_ICON[st.id] ?? SERVICE_ICON[st.kind] ?? 'build',
            thumb: serviceThumb(st),
            title: st.name,
            sub: `${st.designId ? 'Discovered · ' : ''}${formatMoney(cost)} · ${formatMoney(st.upkeep)}/mo`,
            active,
            locked,
            tip: serviceTip(st, cost),
            onClick: () => {
              g.setTool('place', (t: import('../tools/PlaceTool').PlaceTool) => t.configure(st.id));
              this.renderTray();
            },
          }),
        );
      }
    }
    this.tray.appendChild(items);
    items.scrollLeft = keepScroll;
  }
}

export function tipBox(title: string, desc: string, rows: [string, string][]): HTMLElement {
  return h('div', null, h('div', { class: 'tip-title' }, title), h('div', { class: 'tip-desc' }, desc), rows.length ? h('div', { class: 'tip-grid' }, ...rows.flatMap(([k, v]) => [h('span', null, k), h('b', null, v)])) : null);
}

function serviceTip(st: ServiceType, cost = st.cost): HTMLElement {
  const rows: [string, string][] = [['Cost', formatMoney(cost)], ['Upkeep', `${formatMoney(st.upkeep)}/month`]];
  if (st.storage) rows.push(['Storage', `up to ${st.storage} MW`]);
  if (st.designId) rows.push(['Origin', 'Designed by your researchers']);
  if (st.pollution < 0) rows.push(['Air cleaning', `${Math.round(-st.pollution * 100)}%`]);
  if (st.radius) rows.push(['Coverage', `${st.radius} m radius`]);
  if (st.capacity && st.kind !== 'garbage') rows.push(['Serves', `${formatInt(st.capacity)} residents`]);
  if (st.kind === 'garbage') rows.push(['Processes', `${formatInt(st.capacity)} units/day`]);
  if (st.kind === 'power' && st.output) rows.push(['Output', `${st.output} MW`]);
  if (st.kind === 'water' || st.kind === 'sewage') rows.push(['Capacity', `${formatInt(st.output)} m³/day`]);
  if (st.jobs) rows.push(['Jobs', `${st.jobs}`]);
  if (st.pollution > 0) rows.push(['Pollution', st.pollution > 0.6 ? 'High' : st.pollution > 0.25 ? 'Moderate' : 'Low']);
  if (st.needsShore) rows.push(['Placement', 'On a shoreline']);
  if (st.tourism) rows.push(['Tourism', `up to ${formatMoney(st.tourism)}/month`]);
  if (st.kind === 'landmark') rows.push(['Leisure', `${st.radius} m radius`]);
  if (st.unique) rows.push(['Limit', 'One per city']);
  return tipBox(st.name, st.description, rows);
}

// ── Toasts ──────────────────────────────────────────────────────────────────

const NOTICE_ICON: Record<string, string> = {
  power: 'power', water: 'water', sewage: 'sewage', fire: 'fire', garbage: 'garbage', money: 'money', traffic: 'traffic', milestone: 'milestone', research: 'flask', flask: 'flask',
  people: 'people', road: 'road', health: 'health', police: 'police', education: 'education', happy: 'happy', factory: 'factory', build: 'build', info: 'info', weather: 'cloud',
};

export class Toasts {
  readonly el = h('div', { class: 'toasts' });

  constructor(private game: Game) {}

  push(n: Pick<Notice, 'severity' | 'title' | 'text'> & { icon: string; x?: number; z?: number; onClick?: () => void; tip?: string }): void {
    const t = h(
      'div',
      { class: `toast ${n.severity}${n.x !== undefined || n.onClick ? ' clickable' : ''}` },
      h('div', { class: 'toast-icon' }, icon(NOTICE_ICON[n.icon] ?? n.icon, 18)),
      h('div', { class: 'toast-body' }, h('div', { class: 'toast-title' }, n.title), n.text ? h('div', { class: 'toast-text' }, n.text) : null),
    );
    const dismiss = h('button', { class: 'toast-close', 'aria-label': 'Dismiss', 'data-tip': 'Dismiss' }, icon('close', 13));
    dismiss.addEventListener('click', (e) => {
      e.stopPropagation();
      t.classList.add('out');
      setTimeout(() => t.remove(), 250);
    });
    t.appendChild(dismiss);
    if (n.onClick) {
      const fn = n.onClick;
      t.addEventListener('click', () => {
        fn();
        t.remove();
      });
      t.setAttribute('data-tip', n.tip ?? 'Click to open');
    } else if (n.x !== undefined && n.z !== undefined) {
      const x = n.x, z = n.z;
      t.addEventListener('click', () => {
        this.game.flyTo(x, z, 260);
        t.remove();
      });
      t.setAttribute('data-tip', 'Click to go there');
    }
    this.el.prepend(t);
    while (this.el.children.length > 4) this.el.lastElementChild?.remove();
    const life = n.severity === 'critical' ? 11000 : n.severity === 'warning' ? 8000 : 6000;
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 400);
    }, life);
  }
}

/** "Saving. . ." in the bottom-right corner while a save runs, then "Saved". */
export class SaveStatus {
  readonly el: HTMLElement;
  private label: HTMLElement;
  private shownAt = 0;
  private hideTimer = 0;

  constructor(private hud: () => HTMLElement) {
    this.label = h('span', null);
    this.el = h('div', { class: 'save-status', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'save-spin' }), this.label);
  }

  start(): void {
    clearTimeout(this.hideTimer);
    this.shownAt = performance.now();
    this.el.className = 'save-status show';
    this.label.textContent = 'Saving. . .';
    this.hud().classList.add('saving');
  }

  /** Keeps "Saving" up long enough to read, then confirms and fades out. */
  done(ok: boolean): void {
    const wait = Math.max(0, 700 - (performance.now() - this.shownAt));
    clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      this.el.className = `save-status show ${ok ? 'ok' : 'failed'}`;
      this.label.textContent = ok ? 'Saved' : 'Save failed';
      this.hideTimer = window.setTimeout(() => {
        this.el.className = 'save-status';
        this.hud().classList.remove('saving');
      }, ok ? 1400 : 3000);
    }, wait);
  }
}

// ── Cursor label & tooltip ──────────────────────────────────────────────────

export class CursorLabelView {
  readonly el = h('div', { class: 'cursor-label hidden' });
  private x = 0;
  private y = 0;
  private flash: { msg: string; until: number } | null = null;

  move(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  flashError(msg: string): void {
    this.flash = { msg, until: performance.now() + 1800 };
  }

  update(label: Label | null): void {
    const now = performance.now();
    const fl = this.flash && this.flash.until > now ? this.flash.msg : null;
    if (!label && !fl) {
      this.el.classList.add('hidden');
      return;
    }
    this.el.classList.remove('hidden');
    this.el.innerHTML = '';
    if (label?.title) this.el.appendChild(h('div', { class: 'cl-title' }, label.title));
    for (const l of label?.lines ?? []) this.el.appendChild(h('div', { class: 'cl-line' }, l));
    const err = fl ?? label?.error;
    if (err) this.el.appendChild(h('div', { class: 'cl-error' }, icon('warning', 13), err));
    toggle(this.el, 'bad', !!err);
    toggle(this.el, 'good', !!label?.good && !err);
    this.el.style.transform = `translate(${Math.round(this.x + 22)}px, ${Math.round(this.y + 18)}px)`;
  }
}

export class Tooltip {
  readonly el = h('div', { class: 'tooltip hidden' });
  private anchor: HTMLElement | null = null;

  constructor() {
    document.addEventListener('mouseover', (e) => {
      const t = (e.target as HTMLElement).closest?.('[data-tip]') as HTMLElement | null;
      if (t && t !== this.anchor) {
        this.anchor = t;
        this.el.innerHTML = '';
        this.el.appendChild(document.createTextNode(t.dataset.tip ?? ''));
        this.place(t);
      } else if (!t && this.anchor && this.anchor.dataset.tip !== undefined) {
        this.hide();
      }
    });
  }

  showEl(content: HTMLElement, anchor: HTMLElement): void {
    this.anchor = anchor;
    this.el.innerHTML = '';
    this.el.appendChild(content);
    this.el.classList.add('rich');
    this.place(anchor);
  }

  private place(anchor: HTMLElement): void {
    this.el.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    const tw = this.el.offsetWidth;
    const th = this.el.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2;
    let y = r.top - th - 10;
    if (y < 8) y = r.bottom + 10;
    x = Math.max(8, Math.min(window.innerWidth - tw - 8, x));
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  hide(): void {
    this.anchor = null;
    this.el.classList.add('hidden');
    this.el.classList.remove('rich');
  }
}

// ── Milestone banner ────────────────────────────────────────────────────────

export class MilestoneBanner {
  readonly el = h('div', { class: 'milestone hidden' });

  show(title: string, unlocks: string[]): void {
    this.el.innerHTML = '';
    this.el.append(
      h('div', { class: 'ms-kicker' }, 'Milestone reached'),
      h('div', { class: 'ms-title' }, title),
      ...(unlocks.length ? [h('div', { class: 'ms-unlocks' }, 'Unlocked: ', unlocks.join(' · '))] : []),
    );
    this.el.classList.remove('hidden');
    this.el.classList.add('in');
    setTimeout(() => {
      this.el.classList.remove('in');
      setTimeout(() => this.el.classList.add('hidden'), 600);
    }, 5200);
  }
}
