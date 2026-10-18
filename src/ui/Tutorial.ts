import type { Game } from '../game/Game';
import { saveSettings } from '../platform/Platform';
import { goalComplete } from '../sim/CitySim';
import { previewPlacement } from '../sim/CityCommands';
import { SERVICE_BY_ID } from '../sim/services/ServiceTypes';
import { isFreeway } from '../sim/roads/RoadTypes';
import { BuildingState, isResidential, Problem, Zone } from '../sim/types';
import { h, setText } from './dom';
import { icon } from './icons';

/**
 * The guided first city: eight short chapters that teach the basics inside the
 * player's real city. Each step points at what to use (a button, a card in the
 * build menu, a spot on the map), moves on when the player has done it, and says
 * what to fix when something is off. Chapters can be replayed once finished.
 */

/** Something on screen to point at: an element, optionally the one whose text matches. */
interface UiTarget {
  selector: string;
  text?: string;
}

interface Step {
  /** One instruction. */
  text: (g: Game) => string;
  /** Why it matters (shown on request). */
  why?: string;
  ui?: (g: Game) => UiTarget | null;
  /** A spot on the map to act at. */
  map?: (g: Game) => { x: number; z: number; label: string } | null;
  /** Done when this holds (checked a few times a second). Steps without one wait for Next. */
  done?: (g: Game) => boolean;
  /** Something the player should put right, in words, or null. */
  problem?: (g: Game) => string | null;
  /** Runs when the step starts (e.g. remember where the camera was). */
  enter?: (g: Game, mem: Record<string, number>) => void;
  next?: string;
}

export interface Chapter {
  id: string;
  title: string;
  /** One line for the chapter list. */
  blurb: string;
  steps: Step[];
}

const rail = (cat: string): UiTarget => ({ selector: `.rail-btn[data-cat="${cat}"]` });
const card = (title: string): UiTarget => ({ selector: '.tray .card', text: title });
const trayOpen = (g: Game, cat: string) => g.ui.toolbar.open === cat;
const placing = (g: Game, typeId: string) => g.tool.id === 'place' && (g.tool as unknown as { typeId: string }).typeId === typeId;
/**
 * A building of this kind has been placed. (The clock is stopped during the tutorial until
 * chapter 7, so it won't have finished building or be producing anything yet.)
 */
const hasKind = (g: Game, kind: string) => [...g.city!.buildings.all.values()].some((b) => b.kind === 'service' && SERVICE_BY_ID.get(b.typeId)?.kind === kind);

/** The end of the highway, where a city's first street starts. */
function highwayEnd(g: Game): { x: number; z: number; label: string } | null {
  const city = g.city!;
  // The highway's dead end in the city (not its end at the map edge).
  for (const n of city.roads.nodes.values()) {
    if (n.outside || n.segs.length !== 1) continue;
    const seg = city.roads.segments.get(n.segs[0]);
    if (seg && isFreeway(seg.type)) return { x: n.x, z: n.z, label: 'Start your street here' };
  }
  const s = city.terrain.spawn;
  return { x: s.endX, z: s.endZ, label: 'Start your street here' };
}

/** The player's own streets (not the highway). */
function streets(g: Game) {
  return [...g.city!.roads.segments.values()].filter((s) => !isFreeway(s.type));
}

/** Beside the middle of one of the player's streets. */
function besideStreet(g: Game, label: string, offset = 22): { x: number; z: number; label: string } | null {
  const ss = streets(g);
  if (!ss.length) return null;
  const s = ss.reduce((a, b) => (b.length > a.length ? b : a));
  const p = s.poly;
  const k = Math.max(1, Math.floor(p.count / 2));
  const x = p.pts[k * 2], z = p.pts[k * 2 + 1];
  const tx = p.pts[k * 2] - p.pts[k * 2 - 2], tz = p.pts[k * 2 + 1] - p.pts[k * 2 - 1];
  const L = Math.hypot(tx, tz) || 1;
  return { x: x - (tz / L) * offset, z: z + (tx / L) * offset, label };
}

/**
 * A spot beside one of the player's streets where a building of this type fits (checked the way
 * placing it would be), so the marker never points at land that refuses it. Cached for a moment.
 */
const fitCache = new Map<string, { at: number; v: number; p: { x: number; z: number } | null }>();
function spotFor(g: Game, typeId: string, label: string): { x: number; z: number; label: string } | null {
  const city = g.city!;
  const key = typeId;
  const now = performance.now();
  const c = fitCache.get(key);
  if (c && c.v === city.roads.version + city.zones.version && now - c.at < 1500) return c.p ? { ...c.p, label } : null;
  let found: { x: number; z: number } | null = null;
  const st = SERVICE_BY_ID.get(typeId);
  const reach = st ? Math.max(st.w, st.d) / 2 + 8 : 20;
  outer: for (const s of streets(g).sort((a, b) => b.length - a.length)) {
    const p = s.poly;
    for (let k = 1; k < p.count - 1; k++) {
      const x = p.pts[k * 2], z = p.pts[k * 2 + 1];
      const tx = p.pts[k * 2 + 2] - p.pts[k * 2 - 2], tz = p.pts[k * 2 + 3] - p.pts[k * 2 - 1];
      const L = Math.hypot(tx, tz) || 1;
      for (const side of [1, -1]) {
        const px = x - (tz / L) * reach * side, pz = z + (tx / L) * reach * side;
        const pv = previewPlacement(city, typeId, px, pz);
        // Point at where the building would stand (and check clicking there gives the same lot).
        const o = pv.valid && pv.frame ? pv.frame.obb : null;
        if (o && previewPlacement(city, typeId, o.cx, o.cz).valid) {
          found = { x: o.cx, z: o.cz };
          break outer;
        }
      }
    }
  }
  fitCache.set(key, { at: now, v: city.roads.version + city.zones.version, p: found });
  return found ? { ...found, label } : null;
}

/** Homes finished and lived in. */
function homesBuilt(g: Game): number {
  let n = 0;
  for (const b of g.city!.buildings.all.values()) if (b.kind === 'zoned' && isResidential(b.zone) && b.state === BuildingState.Active && b.residents > 0) n++;
  return n;
}

/** A home that has been built. */
function aHome(g: Game) {
  for (const b of g.city!.buildings.all.values()) if (b.kind === 'zoned' && isResidential(b.zone) && b.state === BuildingState.Active) return b;
  return null;
}

const CAMERA_HELP = (g: Game) => (g.settings.cameraStyle === 'free' ? 'middle-drag' : 'right-drag');

export const CHAPTERS: Chapter[] = [
  {
    id: 'camera', title: 'Look around', blurb: 'Move, turn and zoom the camera.',
    steps: [
      {
        text: (g) => `Move the camera: ${CAMERA_HELP(g)} on the map, or push the mouse to the edge if edge scrolling is on.`,
        enter: (g, m) => { m.x = g.cam.goal.x; m.z = g.cam.goal.z; },
        done: (g) => Math.hypot(g.cam.goal.x - (g.ui.guide.mem.x ?? 0), g.cam.goal.z - (g.ui.guide.mem.z ?? 0)) > 60,
      },
      {
        text: (g) => (g.settings.cameraStyle === 'free' ? 'Turn the view: right-drag, or press Q and E.' : 'Turn the view: middle-drag, or press Q and E.'),
        enter: (g, m) => { m.yaw = g.cam.goal.yaw; },
        done: (g) => Math.abs(g.cam.goal.yaw - (g.ui.guide.mem.yaw ?? 0)) > 0.5,
      },
      {
        text: () => 'Zoom: scroll the mouse wheel in and out.',
        enter: (g, m) => { m.dist = g.cam.goal.distance; },
        done: (g) => Math.abs(Math.log(g.cam.goal.distance / (g.ui.guide.mem.dist || 1))) > 0.35,
      },
    ],
  },
  {
    id: 'road', title: 'Connect to the highway', blurb: 'Draw your first street from the highway.',
    steps: [
      { text: () => 'Open the Roads menu.', ui: () => rail('roads'), done: (g) => trayOpen(g, 'roads') || goalComplete(g.city!, 'connect') },
      { text: () => 'Pick Street: cheap, quiet, good for homes.', ui: () => card('Street'), done: (g) => (g.tool.id === 'road' && (g.tool as unknown as { type: string }).type === 'street') || goalComplete(g.city!, 'connect') },
      {
        text: () => 'Click at the end of the highway, then click again a little way off to finish the street.',
        why: 'People and goods arrive by the highway. Every street has to join it, directly or through other streets, or nobody can move in.',
        map: highwayEnd,
        done: (g) => goalComplete(g.city!, 'connect'),
        problem: (g) => (streets(g).length && !goalComplete(g.city!, 'connect') ? 'That street isn’t joined to the highway. Start the next one right on the marker.' : null),
      },
      { text: () => 'Add two or three more streets off it, so there’s room to build along them.', done: (g) => streets(g).reduce((a, s) => a + s.length, 0) > 360, next: 'That’s enough' },
    ],
  },
  {
    id: 'homes', title: 'Zone homes', blurb: 'Mark land for houses along your streets.',
    steps: [
      { text: () => 'Open the Zoning menu.', ui: () => rail('zoning'), done: (g) => trayOpen(g, 'zoning') || goalComplete(g.city!, 'zoneRes') },
      { text: () => 'Pick Low (low-density homes).', ui: () => card('Low'), done: (g) => (g.tool.id === 'zone' && (g.tool as unknown as { zone: Zone }).zone === Zone.ResLow) || goalComplete(g.city!, 'zoneRes') },
      {
        text: () => 'Paint along your streets: click and drag beside them. Zones only take next to a road.',
        why: 'You don’t build houses yourself: you mark where homes may go, and people build them once the land has what they need.',
        map: (g) => besideStreet(g, 'Paint homes here'),
        done: (g) => goalComplete(g.city!, 'zoneRes'),
      },
    ],
  },
  {
    id: 'jobs', title: 'Zone jobs', blurb: 'Shops and industry, so people have work.',
    steps: [
      { text: () => 'Pick Commercial and paint a few lots: shops and workplaces.', ui: (g) => (trayOpen(g, 'zoning') ? card('Commercial') : rail('zoning')), done: (g) => g.city!.zones.countZoned(Zone.Commercial) >= 10 || goalComplete(g.city!, 'zoneJobs') },
      {
        text: () => 'Now Industrial, a little away from the homes: factories are noisy.',
        why: 'Residents need jobs. Industry pollutes, so keep it a street or two away from houses.',
        ui: (g) => (trayOpen(g, 'zoning') ? card('Industrial') : rail('zoning')),
        done: (g) => goalComplete(g.city!, 'zoneJobs'),
      },
    ],
  },
  {
    id: 'power', title: 'Power', blurb: 'A wind turbine to light the first homes.',
    steps: [
      { text: () => 'Open Utilities.', ui: () => rail('utilities'), done: (g) => trayOpen(g, 'utilities') || hasKind(g, 'power') },
      { text: () => 'Pick Wind Turbine.', ui: () => card('Wind Turbine'), done: (g) => placing(g, 'wind_turbine') || hasKind(g, 'power') },
      {
        text: () => 'Place it beside one of your streets.',
        why: 'Nothing gets built without electricity. Power travels along the road network to every building it reaches.',
        map: (g) => spotFor(g, 'wind_turbine', 'It fits here'),
        problem: (g) => (placing(g, 'wind_turbine') && !spotFor(g, 'wind_turbine', '') ? 'There’s no room beside your streets: build one more street into open land.' : null),
        done: (g) => hasKind(g, 'power'),
      },
    ],
  },
  {
    id: 'water', title: 'Water and sewage', blurb: 'Clean water in, waste water out.',
    steps: [
      { text: () => 'In Utilities, pick Water Tower and place it beside a street.', ui: (g) => (trayOpen(g, 'utilities') ? card('Water Tower') : rail('utilities')), map: (g) => (placing(g, 'water_tower') ? spotFor(g, 'water_tower', 'It fits here') : null), done: (g) => hasKind(g, 'water') },
      {
        text: () => 'Then a Septic Tank beside a street, for the waste water.',
        why: 'Homes need somewhere for waste water to go. A septic tank is enough for a small town; later a Sewage Outfall on the shoreline, or a treatment plant, handles far more.',
        ui: (g) => (trayOpen(g, 'utilities') ? card('Septic Tank') : rail('utilities')),
        map: (g) => (placing(g, 'septic_tank') ? spotFor(g, 'septic_tank', 'It fits here') : null),
        done: (g) => hasKind(g, 'sewage'),
      },
    ],
  },
  {
    id: 'grow', title: 'Watch it grow', blurb: 'Time, the first residents, and demand.',
    steps: [
      { text: () => 'Start the clock: press play (or Space).', ui: () => ({ selector: '.speed-btn', text: '' }), done: (g) => g.speed > 0 },
      {
        text: (g) => `Wait for the first homes to go up (${homesBuilt(g)} of 2 so far, ${g.city!.population.residents} residents).`,
        why: 'Builders come once a zone has a road to the highway, power, water and sewage. If nothing appears, one of those is missing.',
        done: (g) => homesBuilt(g) >= 2,
        problem: (g) => {
          const b = g.city!.growthBlocked;
          if (!b.size) return null;
          if (b.has('connection')) return 'Some zones aren’t connected to the highway.';
          const need = [...b].map((m) => (m === 'power' ? 'electricity' : m));
          return `Builders are waiting for ${need.join(', ')}.`;
        },
      },
      {
        text: () => 'These bars are demand: how much the city wants more homes (R), shops (C), industry (I) and offices (O). Click one to see why.',
        why: 'Zone what’s in demand. Tall bars mean people are waiting for that kind of land.',
        ui: () => ({ selector: '.demand-bars' }),
        done: () => !!document.querySelector('.demand-pop:not(.hidden)'),
        next: 'Got it',
      },
    ],
  },
  {
    id: 'inspect', title: 'Inspect a building', blurb: 'See what a home needs.',
    steps: [
      {
        text: () => 'Click a home to see who lives there and what it needs.',
        map: (g) => { const b = aHome(g); return b ? { x: b.cx, z: b.cz, label: 'Click me' } : null; },
        done: (g) => g.selection?.kind === 'building' && !!g.city!.buildings.get(g.selection.id) && isResidential(g.city!.buildings.get(g.selection.id)!.zone),
      },
      {
        text: (g) => {
          const id = g.selection?.kind === 'building' ? g.selection.id : -1;
          const b = g.city!.buildings.get(id);
          const missing = b ? (['power', 'water', 'sewage'] as const).filter((k) => b.problems & (k === 'power' ? Problem.NoPower : k === 'water' ? Problem.NoWater : Problem.NoSewage)) : [];
          return missing.length ? `This panel shows its problems: it’s missing ${missing.join(' and ')}.` : 'This panel shows how full it is, how happy people are and which services reach it. Problems show up here in red.';
        },
        why: 'Whenever something isn’t growing, click it: the panel says what’s wrong.',
        ui: () => ({ selector: '.inspector' }),
        next: 'Finish',
      },
    ],
  },
];

interface GuideState {
  chapter: number;
  step: number;
}

/** The guide card, the pointers, and progress (kept in the settings). */
export class Guide {
  readonly card: HTMLElement;
  readonly ring = h('div', { class: 'guide-ring hidden' });
  readonly pin = h('div', { class: 'guide-pin hidden' }, h('span', { class: 'guide-pin-dot' }), h('span', { class: 'guide-pin-label' }));
  private titleEl = h('div', { class: 'guide-title' });
  private kicker = h('div', { class: 'guide-kicker' });
  private textEl = h('div', { class: 'guide-text' });
  private problemEl = h('div', { class: 'guide-problem hidden' });
  private whyEl = h('div', { class: 'guide-why hidden' });
  private whyBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private dots = h('div', { class: 'guide-dots' });
  private state: GuideState | null = null;
  /** Per-step scratch (where the camera was when the step began). */
  mem: Record<string, number> = {};
  private timer = 0;
  private hidden = false;

  constructor(private game: Game) {
    this.whyBtn = h('button', { class: 'guide-link', onclick: () => this.whyEl.classList.toggle('hidden') }, 'Why?') as HTMLButtonElement;
    this.nextBtn = h('button', { class: 'btn primary small hidden', onclick: () => this.advance() }, 'Next') as HTMLButtonElement;
    this.card = h('div', { class: 'guide hidden', role: 'status', 'aria-live': 'polite' },
      h('div', { class: 'guide-head' },
        icon('flag', 14), this.kicker,
        h('button', { class: 'icon-btn small', 'data-tip': 'Hide the guide for now (the pause menu brings it back)', 'aria-label': 'Hide guide', onclick: () => this.hide() }, icon('minus', 13)),
        h('button', { class: 'icon-btn small', 'data-tip': 'Skip this chapter', 'aria-label': 'Skip chapter', onclick: () => this.skipChapter() }, icon('fast', 13)),
        h('button', { class: 'icon-btn small', 'data-tip': 'End the tutorial', 'aria-label': 'End tutorial', onclick: () => this.stop() }, icon('close', 13)),
      ),
      this.titleEl, this.textEl, this.problemEl, this.whyEl,
      h('div', { class: 'guide-foot' }, this.dots, this.whyBtn, this.nextBtn),
    );
  }

  get active(): boolean {
    return !!this.state && !this.hidden;
  }

  get running(): boolean {
    return !!this.state;
  }

  /** Chapters the player has finished at least once. */
  get finished(): Set<string> {
    return new Set(this.game.settings.guideDone ?? []);
  }

  /** In order the first time; finished chapters (and the next one) can be replayed. */
  canStart(i: number): boolean {
    const done = this.finished;
    return i === 0 || done.has(CHAPTERS[i].id) || done.has(CHAPTERS[i - 1].id);
  }

  start(chapter = 0): void {
    this.state = { chapter, step: 0 };
    this.hidden = false;
    this.enterStep();
    this.render();
  }

  show(): void {
    if (this.state) this.hidden = false;
    this.timer = 0;
  }

  hide(): void {
    this.hidden = true;
    this.clearPointers();
    this.card.classList.add('hidden');
  }

  stop(): void {
    this.state = null;
    this.clearPointers();
    this.card.classList.add('hidden');
  }

  private skipChapter(): void {
    if (!this.state) return;
    this.finishChapter();
  }

  private finishChapter(): void {
    const s = this.state!;
    const id = CHAPTERS[s.chapter].id;
    const set = this.finished;
    if (!set.has(id)) {
      set.add(id);
      this.game.settings.guideDone = [...set];
      saveSettings(this.game.settings);
    }
    this.game.play('good');
    if (s.chapter + 1 < CHAPTERS.length && this.firstTime) {
      this.state = { chapter: s.chapter + 1, step: 0 };
      this.enterStep();
      this.render();
    } else {
      const last = s.chapter + 1 >= CHAPTERS.length;
      this.stop();
      this.game.ui.toasts.push({ severity: 'good', icon: 'flag', title: last ? 'You’ve got the basics' : `${CHAPTERS[s.chapter].title}: done`, text: last ? 'From here, follow the goals list (City Info → Goals). Replay any chapter from the pause menu.' : 'Replay chapters any time from the pause menu.' });
    }
  }

  /** Playing straight through (rather than replaying one chapter). */
  private firstTime = true;

  replay(chapter: number): void {
    this.firstTime = false;
    this.start(chapter);
  }

  begin(): void {
    this.firstTime = true;
    this.start(0);
  }

  private advance(): void {
    const s = this.state;
    if (!s) return;
    const ch = CHAPTERS[s.chapter];
    if (s.step + 1 < ch.steps.length) {
      s.step++;
      this.enterStep();
      this.game.play('tick');
      this.render();
    } else this.finishChapter();
  }

  private enterStep(): void {
    const s = this.state!;
    this.mem = {};
    CHAPTERS[s.chapter].steps[s.step].enter?.(this.game, this.mem);
    this.whyEl.classList.add('hidden');
  }

  private render(): void {
    const s = this.state;
    if (!s) return;
    const ch = CHAPTERS[s.chapter];
    const st = ch.steps[s.step];
    setText(this.kicker, `Tutorial · ${s.chapter + 1} of ${CHAPTERS.length}`);
    setText(this.titleEl, ch.title);
    setText(this.textEl, st.text(this.game));
    setText(this.whyEl, st.why ?? '');
    this.whyBtn.classList.toggle('hidden', !st.why);
    this.nextBtn.classList.toggle('hidden', !!st.done && !st.next);
    setText(this.nextBtn, st.next ?? (s.step + 1 < ch.steps.length ? 'Next' : 'Finish'));
    this.dots.replaceChildren(...ch.steps.map((_, i) => h('i', { class: i < s.step ? 'done' : i === s.step ? 'now' : '' })));
  }

  update(): void {
    const g = this.game;
    const s = this.state;
    const show = !!s && !this.hidden && g.state === 'playing' && !!g.city && !g.photoMode;
    this.card.classList.toggle('hidden', !show);
    if (!show) {
      this.clearPointers();
      return;
    }
    const st = CHAPTERS[s!.chapter].steps[s!.step];
    // Pointers follow the camera every frame; the rest a few times a second.
    this.placePin(st);
    this.timer -= 1 / 60;
    if (this.timer > 0) {
      this.placeRing(st);
      return;
    }
    this.timer = 0.2;
    if (st.done?.(g)) {
      // (Steps with a Next button and a condition also move on by themselves.)
      this.advance();
      return;
    }
    setText(this.textEl, st.text(g));
    const p = st.problem?.(g) ?? null;
    this.problemEl.classList.toggle('hidden', !p);
    if (p) this.problemEl.replaceChildren(icon('warning', 13), h('span', null, p));
    this.placeRing(st);
  }

  private uiEl(t: UiTarget): HTMLElement | null {
    const els = [...document.querySelectorAll<HTMLElement>(t.selector)].filter((e) => e.offsetParent);
    if (t.text === undefined) return els[0] ?? null;
    if (t.text === '') return els[1] ?? els[0] ?? null;
    return els.find((e) => (e.querySelector('.card-title')?.textContent ?? e.textContent ?? '').trim() === t.text) ?? null;
  }

  private placeRing(st: Step): void {
    const t = st.ui?.(this.game) ?? null;
    const el = t ? this.uiEl(t) : null;
    if (!el || document.querySelector('.modal-backdrop:not(.hidden)')) {
      this.ring.classList.add('hidden');
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(this.ring.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
    this.ring.classList.remove('hidden');
  }

  private placePin(st: Step): void {
    const g = this.game;
    const m = st.map?.(g) ?? null;
    if (!m || !g.city) {
      this.pin.classList.add('hidden');
      return;
    }
    const p = g.worldToScreen(m.x, g.city.terrain.heightAt(m.x, m.z) + 2, m.z);
    if (!p.visible) {
      this.pin.classList.add('hidden');
      return;
    }
    this.pin.style.transform = `translate(${p.x}px, ${p.y}px)`;
    const label = this.pin.querySelector('.guide-pin-label')!;
    if (label.textContent !== m.label) label.textContent = m.label;
    this.pin.classList.remove('hidden');
  }

  private clearPointers(): void {
    this.ring.classList.add('hidden');
    this.pin.classList.add('hidden');
  }
}
