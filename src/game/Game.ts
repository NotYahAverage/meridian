import * as THREE from 'three';
import { SCENARIO_BY_ID } from '../sim/progress/Scenarios';
import { BuildingState, Zone, zoneBase } from '../sim/types';
import { SERVICE_BY_ID } from '../sim/services/ServiceTypes';
import { VEHICLE_LENGTH } from '../sim/traffic/Vehicles';
import { AudioEngine, type Sfx } from '../audio/AudioEngine';
import { hash01, randomSeed } from '../core/rng';
import { pointInOBB } from '../core/geom2d';
import { type IndexedDbStorage, LARGE_CITY_POPULATION, type Settings, loadSettings, platform, saveSettings } from '../platform/Platform';
import { AssetLibrary } from '../render/assets/AssetLibrary';
import { CameraController } from '../render/CameraController';
import { Environment } from '../render/Environment';
import type { OverlayId } from '../render/overlays/Overlays';
import { Renderer } from '../render/Renderer';
import { Keybinds } from './Keybinds';
import { Thumbnails } from '../render/Thumbnails';
import { QUALITY_PRESETS } from '../render/shared';
import { WorldRenderer } from '../render/WorldRenderer';
import { lotOBB } from '../sim/buildings/Buildings';
import { City } from '../sim/City';
import { generateBaseParallel } from '../sim/world/parallelTerrain';
import { tickCity } from '../sim/CitySim';
import { DAY_CYCLE_SECONDS, TICK_SECONDS } from '../sim/constants';

/** Simulation time allowed per rendered frame (ms). */
const SIM_BUDGET_MS = 10;

/** Classic camera: a Q / E press shorter than this is a tap (switch dock tab), not a hold (turn). */
const TAP_MS = 220;

/** Seconds of play between autosaves. */
const AUTOSAVE_SECONDS = 180;
import type { Notice } from '../sim/Notifications';
import { type SaveData, deserializeCity, migrate, serializeCity, serializeCityAsync } from '../sim/save/Serializer';
import { type GameSpeed, SPEED_MULT } from '../sim/types';
import type { MapPreset } from '../sim/world/Terrain';
import { BulldozeTool } from '../tools/BulldozeTool';
import { DistrictTool } from '../tools/DistrictTool';
import { TerraformTool } from '../tools/TerraformTool';
import { InspectTool, type Selection } from '../tools/InspectTool';
import { PlaceTool } from '../tools/PlaceTool';
import { RoadTool } from '../tools/RoadTool';
import type { PointerInfo, Tool } from '../tools/Tool';
import { ZoneTool } from '../tools/ZoneTool';
import { BusLineTool, BusStopTool, MetroLineTool } from '../tools/TransitTools';
import { UI } from '../ui/UI';
import { buildDemoCity } from './demo';
import { Input } from './Input';

export type GameState = 'boot' | 'menu' | 'playing';

export interface NewCityOptions {
  name: string;
  seed: number;
  preset: MapPreset;
  unlimited: boolean;
}

/** Top-level game: owns the simulation, renderer, tools, audio and UI. */
export class Game {
  readonly renderer: Renderer;
  readonly env: Environment;
  readonly cam: CameraController;
  readonly assets = new AssetLibrary();
  private thumbnails: Thumbnails | null = null;
  readonly audio = new AudioEngine();
  readonly input: Input;
  readonly ui: UI;
  settings: Settings = loadSettings();
  /** Keyboard shortcuts (defaults plus the player's changes). */
  readonly keys = new Keybinds(this.settings.keybinds ?? {});
  city: City | null = null;
  world: WorldRenderer | null = null;
  state: GameState = 'boot';
  speed: GameSpeed = 1;
  private prevSpeed: GameSpeed = 1;
  hour = 8.5;
  selection: Selection = null;
  /** Interface hidden for taking pictures. */
  photoMode = false;
  /** Vehicle the camera is following, if any. */
  following: { id: number; serial: number } | null = null;
  readonly tools: {
    inspect: InspectTool;
    road: RoadTool;
    zone: ZoneTool;
    bulldoze: BulldozeTool;
    place: PlaceTool;
    district: DistrictTool;
    terraform: TerraformTool;
    busStop: BusStopTool;
    busLine: BusLineTool;
    metroLine: MetroLineTool;
  };
  tool: Tool;
  slotId: string | null = null;
  private tickAcc = 0;
  private lastFrame = performance.now();
  private autosaveTimer = AUTOSAVE_SECONDS;
  private saving = false;
  /** Classic camera: Q / E presses waiting to become a tab switch (timer id) or a held turn (0). */
  private qeHold = new Map<string, number>();
  private orbit = 0;
  private lastPointer: PointerInfo | null = null;
  private hoverPoint: THREE.Vector3 | null = null;
  private unsubs: (() => void)[] = [];
  fps = 60;
  private fpsAcc = 0;
  private fpsFrames = 0;

  constructor(readonly canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.renderer = new Renderer(canvas);
    this.env = new Environment(this.renderer.scene, this.renderer.renderer);
    this.cam = new CameraController(this.renderer.camera);
    this.cam.isHeld = (action, pressed) => this.keys.held(action, pressed);
    this.cam.rotateKeys = () => (this.settings.cameraStyle ?? 'classic') === 'classic';
    this.cam.onManualMove = () => {
      if (this.following) this.following = null;
    };
    this.tools = {
      inspect: new InspectTool(this),
      road: new RoadTool(this),
      zone: new ZoneTool(this),
      bulldoze: new BulldozeTool(this),
      place: new PlaceTool(this),
      district: new DistrictTool(this),
      terraform: new TerraformTool(this),
      busStop: new BusStopTool(this),
      busLine: new BusLineTool(this),
      metroLine: new MetroLineTool(this),
    };
    this.tool = this.tools.inspect;
    this.ui = new UI(this, uiRoot);
    this.input = new Input(canvas, {
      move: (e) => this.onPointerMove(e),
      down: (e) => this.onPointerDown(e),
      up: (e) => this.onPointerUp(e),
      cancel: () => this.cancel(),
      pan: (dx, dy) => this.cam.pan(dx, dy, this.renderer.size.height),
      rotate: (dx, dy) => this.cam.rotate(dx, dy),
      look: (dx, dy) => this.cam.look(dx, dy),
      cameraStyle: () => this.settings.cameraStyle ?? 'classic',
      focus: (e) => {
        // Double-click with the select tool glides there and closes in (a quick "focus").
        if (this.state !== 'playing' || this.tool.id !== 'inspect' || this.photoMode) return;
        const p = this.groundAt(e);
        if (p) this.cam.flyTo(p.x, p.z, Math.max(140, Math.min(this.cam.goal.distance * 0.55, 320)), 0.8);
      },
      wheel: (d, e) => this.onWheel(d, e),
      key: (code, down, e) => this.onKey(code, down, e),
      touchPans: () => this.tool.id === 'inspect',
    });
    window.addEventListener('resize', () => this.renderer.resize());
    const unlock = () => {
      this.audio.unlock();
      this.applyAudio();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.applySettings();
    // The desktop window asks the game before it closes, so it can offer to save.
    platform.onCloseRequested?.(() => {
      if (this.ui.modalOpen() && this.state === 'playing') return;
      void this.quit();
    });
    // In a browser tab, the page can only show the browser's own "leave site?" prompt.
    window.addEventListener('beforeunload', (e) => {
      if (this.state === 'playing' && !platform.isDesktop && !new URLSearchParams(location.search).has('e2e')) e.preventDefault();
    });
  }

  /** Studio renders of buildable things for the construction dock (needs loaded assets). */
  get thumbs(): Thumbnails {
    return (this.thumbnails ??= new Thumbnails(this.renderer.renderer, this.assets, this.renderer.scene));
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async boot(): Promise<void> {
    const mark = (name: string, start: number) => performance.measure(`boot:${name}`, { start, end: performance.now() });
    let t = performance.now();
    this.ui.loading.show('Loading assets…', 0);
    await this.assets.load((d, n) => this.ui.loading.progress(`Loading assets… ${d}/${n}`, (d / n) * 0.5));
    mark('assets', t);
    this.ui.loading.progress('Founding a town…', 0.55);
    await nextFrame();
    t = performance.now();
    const demo = buildDemoCity(20251, 'coastal');
    mark('demo-city', t);
    this.ui.loading.progress('Building the world…', 0.8);
    await nextFrame();
    t = performance.now();
    this.attachCity(demo);
    mark('world', t);
    this.speed = 1;
    this.hour = 17.3;
    this.state = 'menu';
    const s = demo.startPoint;
    this.cam.jumpTo({ x: s.x + 160, z: s.z, distance: 620, pitch: 0.62, yaw: -0.9 });
    this.env.update(this.hour, this.cam.target, this.cam.distance, this.renderer.camera);
    this.env.updateEnvironmentMap(true);
    this.ui.loading.progress('Preparing graphics…', 0.9);
    await nextFrame();
    t = performance.now();
    this.cam.update(0, this.renderer.size.height, this.input.pointer, this.renderer.size.width);
    await this.renderer.precompile();
    mark('shaders', t);
    this.ui.loading.hide();
    this.ui.showMenu();
    this.lastFrame = performance.now();
    requestAnimationFrame(this.loop);
  }

  private attachCity(city: City): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.setTool('inspect');
    this.selection = null;
    this.world?.dispose();
    this.celebrations.length = 0;
    this.city = city;
    this.world = new WorldRenderer(city, this.assets, this.renderer.scene);
    this.world.warmUp();
    this.world.icons.visible = this.settings.showIcons;
    city.live.density = this.settings.trafficDensity;
    this.cam.groundHeight = (x, z) => city.terrain.heightAt(x, z);
    this.cam.obstacleHeight = (x, z) => {
      let top = -Infinity;
      for (const b of city.buildings.queryRadius(x, z, 70)) {
        if (!pointInOBB(lotOBB(b), x, z, 3)) continue;
        top = Math.max(top, b.y + (this.world?.buildings.heightOf(b.id) ?? 10));
      }
      return top;
    };
    this.unsubs.push(
      city.events.on('notice', (n) => this.onNotice(n)),
      city.events.on('milestone', (m) => {
        this.audio.play('milestone');
        if (m.index >= 2) this.celebrate(25);
        this.ui.milestone(m.title, m.unlocks);
      }),
      city.events.on('goal', () => this.ui.refreshGoals()),
      city.events.on('news', (ed) => {
        if (this.state === 'playing') this.ui.newsToast(ed);
      }),
      city.events.on('scenario', (r) => {
        if (r.result === 'won' && !this.settings.scenariosWon.includes(r.id)) {
          this.settings.scenariosWon = [...this.settings.scenariosWon, r.id];
          saveSettings(this.settings);
        }
        this.play(r.result === 'won' ? 'milestone' : 'warning');
        if (r.result === 'won') this.celebrate(40);
        this.ui.scenarioResult.show(r.id, r.result);
        this.ui.refreshGoals();
      }),
      city.events.on('demolished', (d) => this.world?.effects.burst(d.x, city.terrain.heightAt(d.x, d.z), d.z, 10, 30, true)),
      city.events.on('spawned', (s) => {
        if (this.state === 'playing') this.world?.effects.burst(s.x, s.y, s.z, s.r * 0.8, 14);
      }),
    );
    this.ui.onCityAttached();
  }

  async startNewCity(opts: NewCityOptions): Promise<void> {
    this.ui.hideMenu();
    this.ui.loading.show('Generating terrain…', 0.1);
    await nextFrame();
    const terrainBase = await generateBaseParallel(opts.seed, opts.preset);
    const city = new City({ name: opts.name, seed: opts.seed, preset: opts.preset, unlimitedMoney: opts.unlimited, terrainBase });
    this.ui.loading.progress('Planting forests…', 0.6);
    await nextFrame();
    // A new city owns the land around its start; more can be bought a ring at a time.
    const st = city.startPoint;
    city.land.startAround(st.x, st.z);
    this.attachCity(city);
    this.slotId = `city-${opts.seed}-${Date.now().toString(36)}`;
    this.beginPlay();
    const s = city.startPoint;
    this.cam.jumpTo({ x: s.x, z: s.z, distance: 1500, pitch: 1.0, yaw: 0.45 });
    this.cam.flyTo(s.x, s.z, 420, 2.2);
    this.ui.loading.hide();
    if (this.settings.tutorial) this.ui.openPanel('goals');
  }

  /** Founds the scenario's city and starts its clock. */
  async startScenario(id: string): Promise<void> {
    const def = SCENARIO_BY_ID.get(id);
    if (!def) return;
    await this.startNewCity({ name: def.title, seed: def.seed, preset: def.preset, unlimited: false });
    const city = this.city!;
    city.economy.money = def.money;
    city.scenario = { id: def.id, startMonth: city.clock.monthIndex, result: '' };
    this.ui.openPanel('goals');
  }

  private beginPlay(): void {
    this.state = 'playing';
    this.speed = 1;
    this.prevSpeed = 1;
    this.hour = 8.5;
    this.tickAcc = 0;
    this.autosaveTimer = AUTOSAVE_SECONDS;
    this.env.updateEnvironmentMap(true);
    this.ui.showHud();
  }

  async toMenu(): Promise<void> {
    this.ui.loading.show('Returning to menu…', 0.4);
    await nextFrame();
    const demo = buildDemoCity(randomSeed() % 100000, (['coastal', 'lakes', 'highlands'] as MapPreset[])[Math.floor(Math.random() * 3)]);
    this.attachCity(demo);
    this.state = 'menu';
    // The menu backdrop is not a city of yours, so nothing is "playing" any more.
    this.slotId = null;
    this.hour = 17.3;
    const s = demo.startPoint;
    this.cam.jumpTo({ x: s.x + 160, z: s.z, distance: 620, pitch: 0.62, yaw: -0.9 });
    this.ui.loading.hide();
    this.ui.showMenu();
  }

  // ── Save / load ───────────────────────────────────────────────────────────

  /**
   * Saves the city into its own slot (every city has one, so the latest save
   * is always the one you continue from). `asNew` branches into a new slot.
   */
  async save(name?: string, asNew = false): Promise<boolean> {
    const city = this.city;
    if (!city || this.state !== 'playing' || this.saving) return false;
    if (name) city.name = name.slice(0, 40);
    if (!this.slotId || asNew) this.slotId = `city-${city.seed}-${Date.now().toString(36)}`;
    this.saving = true;
    this.ui.saveStatus.start();
    try {
      this.world?.ghost.clear();
      const thumb = this.renderer.captureThumbnail();
      // A piece per frame; the clock waits (see frame()) so the save is consistent.
      const data = await serializeCityAsync(city, yieldFrame);
      await platform.storage.save(this.slotId, data, thumb);
      // A save resets the autosave clock so the two don't run back to back.
      this.autosaveTimer = AUTOSAVE_SECONDS;
      this.ui.saveStatus.done(true);
      return true;
    } catch (e) {
      console.error(e);
      this.ui.saveStatus.done(false);
      this.toastError('Saving failed. Storage may be full or unavailable.');
      return false;
    } finally {
      this.saving = false;
    }
  }

  private async autosave(): Promise<void> {
    if (this.state === 'playing' && !this.photoMode) await this.save();
  }

  /**
   * Leaving a city (to the menu or quitting) offers to save first.
   * Returns false if the player cancelled.
   */
  async confirmLeave(action: 'menu' | 'quit'): Promise<boolean> {
    if (this.state !== 'playing' || !this.city) return true;
    const choice = await this.ui.choose(
      action === 'quit' ? 'Quit Meridian' : 'Exit to main menu',
      `Save ${this.city.name} before you go?`,
      [['cancel', 'Cancel', ''], ['discard', "Don't save", 'danger'], ['save', 'Save and exit', 'primary']],
    );
    if (choice === 'save') return await this.save();
    return choice === 'discard';
  }

  async exitToMenu(): Promise<void> {
    if (await this.confirmLeave('menu')) await this.toMenu();
  }

  async quit(): Promise<void> {
    if (await this.confirmLeave('quit')) platform.quit?.();
  }

  async loadSlot(id: string): Promise<boolean> {
    this.ui.loading.show('Loading city…', 0.2);
    await nextFrame();
    try {
      const data = await platform.storage.load(id);
      if (!data) throw new Error('Save not found');
      await this.loadData(data);
      // Old builds kept one shared autosave; carry on in a slot of the city's own.
      if (id === 'autosave') {
        this.slotId = `city-${data.city.seed}-${Date.now().toString(36)}`;
        await platform.storage.remove('autosave').catch(() => undefined);
        void this.save();
      } else this.slotId = id;
      return true;
    } catch (e) {
      console.error(e);
      this.ui.loading.hide();
      this.toastError(`Could not load: ${(e as Error).message}`);
      return false;
    }
  }

  async loadData(raw: SaveData): Promise<void> {
    const data = migrate(raw);
    this.ui.hideMenu();
    this.ui.loading.progress('Rebuilding the city…', 0.5);
    await nextFrame();
    const terrainBase = await generateBaseParallel(data.city.seed, data.city.preset);
    const city = deserializeCity(data, { terrainBase });
    this.attachCity(city);
    this.beginPlay();
    const b = [...city.buildings.all.values()];
    const cx = b.length ? b.reduce((a, x) => a + x.cx, 0) / b.length : city.startPoint.x;
    const cz = b.length ? b.reduce((a, x) => a + x.cz, 0) / b.length : city.startPoint.z;
    this.cam.jumpTo({ x: cx, z: cz, distance: 700, pitch: 0.95, yaw: 0.45 });
    this.ui.loading.hide();
  }

  exportSave(): void {
    if (!this.city) return;
    const blob = new Blob([JSON.stringify(serializeCity(this.city))], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.city.name.replace(/[^\w-]+/g, '_')}.meridian.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async importSave(file: File): Promise<void> {
    try {
      const data = JSON.parse(await file.text()) as SaveData;
      await this.loadData(data);
      this.slotId = `city-${data.city.seed}-${Date.now().toString(36)}`;
    } catch (e) {
      this.ui.loading.hide();
      this.toastError(`Import failed: ${(e as Error).message}`);
    }
  }

  get storage(): IndexedDbStorage | typeof platform.storage {
    return platform.storage;
  }

  // ── Tools, selection, overlays ────────────────────────────────────────────

  setTool(id: keyof Game['tools'], configure?: (t: never) => void): void {
    const next = this.tools[id];
    if (this.tool !== next) {
      this.tool.deactivate();
      this.tool = next;
      configure?.(next as never);
      next.activate();
    } else {
      configure?.(next as never);
      next.activate();
    }
    if (id !== 'inspect' && this.selection) this.select(null);
    if (this.lastPointer && this.hoverPoint) this.tool.onMove(this.hoverPoint, this.lastPointer);
    this.ui.onToolChanged();
  }

  /** Starts or stops the camera following a vehicle. */
  follow(target: { id: number; serial: number } | null): void {
    this.following = target;
    if (target) {
      this.cam.stopFlight();
      this.cam.goal.distance = Math.min(this.cam.goal.distance, 90);
    }
  }

  select(sel: Selection): void {
    if (sel?.kind !== 'vehicle') this.following = null;
    if (this.selection?.kind === 'vehicle') this.world?.ghost.setSelectionRing(0, 0, null);
    const w = this.world;
    if (w) {
      w.buildings.clearHighlights(2);
      w.roads.clearHighlights();
    }
    this.selection = sel;
    this.reapplySelection();
    this.ui.inspector.show(sel);
  }

  reapplySelection(): void {
    const w = this.world;
    const s = this.selection;
    if (!w || !s) return;
    if (s.kind === 'building') w.buildings.setHighlight([s.id], 2);
    else if (s.kind === 'road') w.roads.setHighlight([s.id], 2);
  }

  setOverlay(id: OverlayId): void {
    this.world?.overlays.set(id);
    this.ui.onOverlayChanged(id);
  }

  setSpeed(s: GameSpeed): void {
    if (s !== 0) this.prevSpeed = s;
    this.speed = s;
    this.ui.onSpeedChanged();
  }

  togglePause(): void {
    this.setSpeed(this.speed === 0 ? this.prevSpeed || 1 : 0);
  }

  flyTo(x: number, z: number, dist?: number): void {
    this.cam.flyTo(x, z, dist);
  }

  toastError(msg: string): void {
    // Beside the cursor on the map; as a notification when the pointer is over a panel.
    if (this.input.pointer.inside) this.ui.cursor.flashError(msg);
    else this.ui.toasts.push({ severity: 'warning', icon: 'warning', title: msg, text: '' });
    this.audio.play('error');
  }

  flashMoney(delta: number): void {
    this.ui.flashMoney(delta);
  }

  play(s: Sfx): void {
    this.audio.play(s);
  }

  private onNotice(n: Notice): void {
    if (this.state !== 'playing') return;
    this.ui.toast(n);
    if (n.severity === 'critical' || n.severity === 'warning') this.audio.play('warning');
    else if (n.severity === 'good') this.audio.play('good');
    else this.audio.play('notify');
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  applySettings(): void {
    this.ui?.applyScale();
    const s = this.settings;
    this.renderer.setQuality(QUALITY_PRESETS[s.quality]);
    this.env.setShadowSize(QUALITY_PRESETS[s.quality].shadowSize);
    this.env.sun.castShadow = QUALITY_PRESETS[s.quality].shadows;
    this.cam.edgeScroll = s.edgeScroll;
    this.cam.invertRotate = s.invertRotate;
    this.keys.load(s.keybinds ?? {});
    this.ui?.toolbar.refreshKeyHints();
    this.cam.lookSpeed = s.lookSpeed ?? 1;
    if (this.city) this.city.live.density = s.trafficDensity;
    if (this.world) this.world.icons.visible = s.showIcons;
    this.largeMode = null;
    this.shadowStep = 0;
    this.applyAudio();
    saveSettings(s);
  }

  /** Whether Large city mode is in effect (null until first worked out). */
  private largeMode: boolean | null = null;
  /** How many steps the shadow detail has been lowered (Large city mode only). */
  private shadowStep = 0;
  private slowFor = 0;
  private fastFor = 0;

  get largeCityActive(): boolean {
    const m = this.settings.largeCityMode ?? 'auto';
    if (m !== 'auto') return m === 'on';
    return (this.city?.population.residents ?? 0) >= LARGE_CITY_POPULATION;
  }

  /**
   * Large city mode: shadow detail drops a step while the frame rate stays low
   * (and comes back once it recovers). Distance detail is the same for every
   * city: full inside the detail square around the camera, simplified beyond.
   */
  private updateLargeCityMode(dt: number): void {
    const world = this.world;
    if (!world) return;
    const on = this.largeCityActive;
    if (on !== this.largeMode) {
      this.largeMode = on;
      if (!on && this.shadowStep) {
        this.shadowStep = 0;
        this.env.setShadowSize(QUALITY_PRESETS[this.settings.quality].shadowSize);
      }
    }
    if (!on || !QUALITY_PRESETS[this.settings.quality].shadows) return;
    const fps = this.fps;
    this.slowFor = fps > 0 && fps < 28 ? this.slowFor + dt : 0;
    this.fastFor = fps > 50 ? this.fastFor + dt : 0;
    const base = QUALITY_PRESETS[this.settings.quality].shadowSize;
    if (this.slowFor > 4 && this.shadowStep < 2) {
      this.shadowStep++;
      this.slowFor = 0;
      this.env.setShadowSize(Math.max(1024, base >> this.shadowStep));
    } else if (this.fastFor > 12 && this.shadowStep > 0) {
      this.shadowStep--;
      this.fastFor = 0;
      this.env.setShadowSize(Math.max(1024, base >> this.shadowStep));
    }
  }

  private applyAudio(): void {
    this.audio.volume = { master: this.settings.masterVolume, sfx: this.settings.sfxVolume, ambient: this.settings.ambientVolume, music: this.settings.musicVolume ?? 0.4 };
    this.audio.applyVolume();
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  private groundAt(e: PointerInfo): THREE.Vector3 | null {
    if (!this.world) return null;
    return this.world.pickGround(e.ndc, this.renderer.camera);
  }

  private onPointerMove(e: PointerInfo): void {
    if (this.state !== 'playing') return;
    this.lastPointer = e;
    const p = this.groundAt(e);
    this.hoverPoint = p;
    this.tool.hover = p;
    this.tool.onMove(p, e);
    this.ui.cursor.move(e.x, e.y);
  }

  private onPointerDown(e: PointerInfo): void {
    if (this.state !== 'playing') return;
    this.ui.closeTransient();
    const p = this.groundAt(e);
    this.tool.hover = p;
    this.tool.onDown(p, e);
  }

  private onPointerUp(e: PointerInfo): void {
    if (this.state !== 'playing') return;
    this.tool.onUp(this.groundAt(e), e);
  }

  private onWheel(delta: number, e: PointerInfo): void {
    if (this.state !== 'playing') return;
    if (this.tool.onWheel(delta, e)) return;
    const p = this.groundAt(e);
    this.cam.zoom(delta, p ? { x: p.x, z: p.z } : undefined);
  }

  cancel(): void {
    if (this.state !== 'playing') return;
    if (this.tool.onCancel()) return;
    if (this.tool !== this.tools.inspect) {
      this.setTool('inspect');
      return;
    }
    if (this.ui.closeTopmost()) return;
  }

  private onKey(code: string, down: boolean, e: KeyboardEvent): void {
    if (this.state !== 'playing') {
      if (down && code === 'Escape') this.ui.closeTopmost();
      return;
    }
    const k = this.keys;
    const mods = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
    const is = (action: string) => k.matches(action, code, mods);
    const dockTab = is('dockPrev') ? -1 : is('dockNext') ? 1 : 0;
    const rotateKey = k.matches('camRotateLeft', code) || k.matches('camRotateRight', code);
    if (dockTab || rotateKey) {
      const dockKeys = this.ui.toolbar.isOpen && !this.photoMode && !this.ui.modalOpen();
      if ((this.settings.cameraStyle ?? 'classic') !== 'classic') {
        // Free cam: the dock-tab keys switch tabs; rotation keys do nothing.
        if (down && !e.repeat && dockKeys && dockTab) this.ui.toolbar.cycleTab(dockTab as 1 | -1);
        if (dockTab) return;
      } else if (dockTab && rotateKey) {
        // Classic: the same key turns the camera when held; a quick tap with the dock open switches its tab.
        if (down) {
          if (e.repeat || this.qeHold.has(code)) return;
          if (dockKeys) {
            this.qeHold.set(code, window.setTimeout(() => {
              this.qeHold.set(code, 0);
              this.cam.setKey(code, true);
            }, TAP_MS));
            return;
          }
        } else {
          const t = this.qeHold.get(code);
          this.qeHold.delete(code);
          if (t) {
            clearTimeout(t);
            this.ui.toolbar.cycleTab(dockTab as 1 | -1);
          }
        }
      } else if (dockTab) {
        if (down && !e.repeat && dockKeys) this.ui.toolbar.cycleTab(dockTab as 1 | -1);
        return;
      }
    }
    if (!down) {
      this.cam.setKey(code, false);
      return;
    }
    if (this.ui.modalOpen()) {
      if (code === 'Escape') this.ui.closeTopmost();
      return;
    }
    if (is('save')) {
      e.preventDefault();
      void this.save();
      return;
    }
    if (this.photoMode) {
      if (code === 'Escape' || is('photo')) return this.setPhotoMode(false);
      if (code === 'Enter' || code === 'NumpadEnter') return void this.savePhoto();
      if (is('pause')) return this.togglePause();
      this.cam.setKey(code, true);
      return;
    }
    if (this.tool.onKey(code, e)) return;
    if (code === 'Escape') {
      if (this.tool.onCancel()) return;
      if (this.tool !== this.tools.inspect) return this.setTool('inspect');
      if (this.ui.closeTopmost()) return;
      this.ui.openPause();
      return;
    }
    const tb = this.ui.toolbar;
    const actions: [string, () => void][] = [
      ['camReset', () => this.cam.resetView()],
      ['photo', () => this.setPhotoMode(true)],
      ['pause', () => this.togglePause()],
      ['speed1', () => this.setSpeed(1)],
      ['speed2', () => this.setSpeed(2)],
      ['speed3', () => this.setSpeed(3)],
      ['toolSelect', () => tb.select('inspect')],
      ['toolRoads', () => tb.select('roads')],
      ['toolZoning', () => tb.select('zoning')],
      ['toolServices', () => tb.select('services')],
      ['toolUtilities', () => tb.select('utilities')],
      ['toolTransit', () => tb.select('transit')],
      ['toolLandscape', () => tb.select('terrain')],
      ['toolBuild', () => tb.select('build')],
      ['toolBulldoze', () => tb.select('bulldoze')],
      ['news', () => this.ui.newspaper.open()],
      ['layers', () => this.ui.togglePanel('overlays')],
      ['cityInfo', () => this.ui.toggleCityInfo()],
      ['layerCycle', () => this.ui.cycleOverlay()],
    ];
    for (const [action, run] of actions) {
      if (!is(action)) continue;
      run();
      return;
    }
    this.cam.setKey(code, true);
  }

  // ── Main loop ─────────────────────────────────────────────────────────────

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc > 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    try {
      this.frame(dt);
    } catch (err) {
      console.error(err);
    }
  };

  frame(dt: number): void {
    const city = this.city;
    const world = this.world;
    if (!city || !world) return;
    const playing = this.state === 'playing';
    const mult = playing ? SPEED_MULT[this.speed] : 0.6;
    if (playing && mult > 0 && !this.saving) {
      this.tickAcc += dt * mult;
      // At most ~10 ms of simulation per frame: in a huge city the clock runs a little
      // slower than asked rather than the frame rate collapsing.
      let n = 0;
      const t0 = performance.now();
      while (this.tickAcc >= TICK_SECONDS && n < 8 && (n === 0 || performance.now() - t0 < SIM_BUDGET_MS)) {
        tickCity(city);
        this.tickAcc -= TICK_SECONDS;
        n++;
      }
      if (this.tickAcc >= TICK_SECONDS) this.tickAcc = Math.min(this.tickAcc, TICK_SECONDS);
      if (this.settings.dayNight) this.hour = (this.hour + (dt * mult * 24) / DAY_CYCLE_SECONDS) % 24;
      else this.hour = 13;
      this.autosaveTimer -= dt;
      if (this.autosaveTimer <= 0) {
        this.autosaveTimer = AUTOSAVE_SECONDS;
        if (this.settings.autosave) void this.autosave();
      }
    }
    if (!playing) {
      // Menu backdrop: slow cinematic orbit and a living town.
      this.orbit += dt * 0.025;
      const s = city.startPoint;
      this.cam.goal.yaw = -0.9 + this.orbit;
      this.cam.goal.x = s.x + 160;
      this.cam.goal.z = s.z;
    }
    this.updateLargeCityMode(dt);
    city.live.update(dt, mult, this.hour);
    city.disasters.enabled = !!this.settings.disasters;
    city.disasters.update(dt * Math.min(mult, 3));
    this.updateFollow();
    const h = this.renderer.size.height;
    this.cam.update(dt, h, this.input.pointer, this.renderer.size.width);
    this.env.update(this.hour, this.cam.target, this.cam.distance, this.renderer.camera);
    this.env.updateEnvironmentMap();
    this.renderer.setNight(this.env.night);
    world.update(dt, dt * Math.min(mult, 3), this.renderer.camera, this.env, this.cam.target, this.cam.distance, h, mult > 0);
    this.tool.update(dt);
    this.ui.update(dt);
    this.audio.update(dt, {
      camDist: this.cam.distance,
      population: city.stats.population,
      night: this.env.night,
      paused: mult === 0,
      ...this.ambientContext(dt),
      rain: world.sky.rain,
      wind: world.sky.wind,
      jet: world.airport.loudness,
      storm: world.tornado.loudness,
    });
    this.updateCelebrations(world);
    if (world.thunderIn < 0 && world.thunderStrength > 0) {
      this.audio.thunder(world.thunderStrength);
      world.thunderStrength = 0;
    }
    // Dock thumbnails borrow a corner of the canvas, which this frame then paints over.
    if (playing) this.thumbnails?.pump();
    this.renderer.render();
  }

  private updateFollow(): void {
    const city = this.city;
    const sel = this.selection;
    const v = city?.vehicles;
    if (!city || !v || sel?.kind !== 'vehicle') return;
    const alive = v.active[sel.id] && v.serial[sel.id] === sel.serial;
    if (!alive) {
      this.following = null;
      this.world?.ghost.setSelectionRing(0, 0, null);
      return;
    }
    // Ring under the selected vehicle.
    this.world?.ghost.setSelectionRing(v.x[sel.id], v.z[sel.id], VEHICLE_LENGTH[v.model[sel.id]] * 0.5 + 1.4);
    const f = this.following;
    if (f && f.id === sel.id && f.serial === sel.serial) {
      this.cam.goal.x = v.x[sel.id];
      this.cam.goal.z = v.z[sel.id];
    }
  }

  /** Hides (or restores) the interface and map markers for screenshots. */
  setPhotoMode(on: boolean): void {
    if (on === this.photoMode) return;
    this.photoMode = on;
    if (on) {
      this.setTool('inspect');
      this.select(null);
      this.ui.closePanel();
    }
    this.ui.setPhotoMode(on);
    if (this.world) this.world.icons.visible = !on && this.settings.showIcons;
    // Zoned-but-empty land is drawn hatched; leave it out of pictures.
    if (this.world) this.world.terrain.uniforms.uZoneOpacity.value = on ? 0 : 0.2;
  }

  /** Saves the current view (without the interface) as a PNG. */
  async savePhoto(): Promise<void> {
    // Render and read back in the same task so the drawing buffer is still valid.
    this.renderer.render();
    const url = this.renderer.renderer.domElement.toDataURL('image/png');
    const name = `${(this.city?.name ?? 'Meridian').replace(/[^\w -]+/g, '').trim() || 'Meridian'} ${this.city?.clock.dateString() ?? ''}`.trim();
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    this.audio.play('click');
    this.ui.flashPhoto();
  }

  private ambient = { buildingsNear: 0, industry: 0, shore: 0, parks: 0 };
  private ambientTimer = 0;

  /** What surrounds the camera (for the soundscape), refreshed twice a second. */
  /** Fireworks waiting for nightfall. */
  private celebrations: { x: number; z: number; seconds: number }[] = [];
  private newYearDone = -1;
  private stadiumNight = -1;

  /** Queues a fireworks show over downtown (or `at`) for the next dark sky. */
  celebrate(seconds: number, at?: { x: number; z: number }): void {
    const p = at ?? this.downtown();
    if (p) this.celebrations.push({ x: p.x, z: p.z, seconds });
  }

  /** City Hall if there is one, else the centre of the tallest buildings. */
  private downtown(): { x: number; z: number } | null {
    const city = this.city;
    if (!city) return null;
    let sx = 0, sz = 0, w = 0;
    for (const b of city.buildings.all.values()) {
      if (b.state !== BuildingState.Active) continue;
      if (b.typeId === 'city_hall') return { x: b.cx, z: b.cz };
      if (b.kind !== 'zoned') continue;
      const k = b.floors * b.floors;
      sx += b.cx * k;
      sz += b.cz * k;
      w += k;
    }
    return w ? { x: sx / w, z: sz / w } : city.startPoint;
  }

  private updateCelebrations(world: WorldRenderer): void {
    const city = this.city;
    const fw = world.fireworks;
    if (!city || this.state !== 'playing') {
      if (fw.busy && this.state !== 'playing') fw.stop();
      return;
    }
    const clock = city.clock;
    // Midnight on New Year's Day.
    if (clock.month === 0 && clock.dayOfMonth === 1 && clock.year > 1 && this.newYearDone !== clock.year && city.stats.population >= 200) {
      this.newYearDone = clock.year;
      this.celebrate(45);
    }
    const night = this.env.night;
    // Some nights a match at the stadium ends with a short show.
    if (night > 0.6 && this.stadiumNight !== clock.day) {
      this.stadiumNight = clock.day;
      if (hash01(clock.day, city.seed) < 0.14) {
        for (const b of city.buildings.all.values()) {
          if (b.typeId === 'stadium' && b.state === BuildingState.Active) {
            this.celebrations.push({ x: b.cx, z: b.cz, seconds: 14 });
            break;
          }
        }
      }
    }
    if (night > 0.55 && this.celebrations.length && !fw.busy) {
      const c = this.celebrations.shift()!;
      fw.start(c.x, c.z, city.terrain.heightAt(c.x, c.z), c.seconds, c.seconds > 30 ? 1.7 : 1.1);
    }
    // Sound travels at 343 m/s, so distant bursts are seen before they are heard.
    const cam = this.renderer.camera.position;
    for (const s of fw.sounds) {
      const d = Math.hypot(s.x - cam.x, s.y - cam.y, s.z - cam.z);
      const vol = Math.pow(Math.max(0, 1 - d / 3000), 2);
      const delay = Math.min(4, d / 343);
      if (s.kind === 'launch') this.audio.fireworkLaunch(vol, delay);
      else this.audio.fireworkBurst(vol, delay, s.big, s.crackle);
    }
    fw.sounds.length = 0;
  }

  private ambientContext(dt: number): { buildingsNear: number; industry: number; shore: number; parks: number } {
    this.ambientTimer -= dt;
    const city = this.city;
    if (this.ambientTimer > 0 || !city) return this.ambient;
    this.ambientTimer = 0.5;
    const t = this.cam.target;
    let n = 0, ind = 0, parks = 0;
    for (const b of city.buildings.queryRadius(t.x, t.z, 400)) {
      n++;
      if (zoneBase(b.zone) === Zone.Industrial || (b.kind === 'service' && SERVICE_BY_ID.get(b.typeId)?.kind === 'power')) ind++;
      if (b.kind === 'service' && SERVICE_BY_ID.get(b.typeId)?.kind === 'park') parks++;
    }
    const wd = city.terrain.waterDistanceAt(t.x, t.z);
    const trees = city.nature.countDisc(t.x, t.z, 200);
    this.ambient = {
      buildingsNear: n,
      industry: Math.min(1, ind / 12),
      shore: Math.max(0, 1 - wd / 260),
      parks: Math.min(1, parks / 3 + trees / 400),
    };
    return this.ambient;
  }

  /** Projects a world point to CSS pixels (used by labels and tests). */
  worldToScreen(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.renderer.camera);
    const { width, height } = this.renderer.size;
    return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height, visible: v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
  }
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}

/** Lets a frame draw between pieces of work, without stalling when the window is hidden (no frames come). */
function yieldFrame(): Promise<void> {
  return new Promise((r) => {
    const t = setTimeout(r, 50);
    requestAnimationFrame(() => {
      clearTimeout(t);
      setTimeout(r, 0);
    });
  });
}
