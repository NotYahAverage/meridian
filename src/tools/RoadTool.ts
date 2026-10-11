import type * as THREE from 'three';
import { type PolyPoint, pointAt } from '../core/geom2d';
import { formatMoney, formatInt } from '../core/math';
import { type RoundaboutPreview, buildRoad, buildRoundabout, cycleRoadDirection, previewRoad, previewRoundabout, snap, upgradeCost, upgradeRoad } from '../sim/CityCommands';
import type { RoadPlan, Snap } from '../sim/roads/RoadPlanner';
import { isFreeway, ROAD_TYPES, type RoadTypeId, canBeOneWay } from '../sim/roads/RoadTypes';
import { roadUnlocked } from '../sim/progress/Progress';
import { type CursorLabel, type PointerInfo, Tool } from './Tool';

export type RoadMode = 'straight' | 'curve' | 'upgrade' | 'direction' | 'roundabout' | 'grid';

/** Grid tool limits. */
const GRID_MIN = 56, GRID_MAX = 160, GRID_MAX_LINES = 32;

const STEP = (15 * Math.PI) / 180;

/** Click-to-click road drawing with snapping, curves and upgrades. */
export class RoadTool extends Tool {
  readonly id = 'road';
  type: RoadTypeId = 'street';
  mode: RoadMode = 'straight';
  /** Draw new roads as one-way (traffic follows the drawing direction). */
  oneway = false;
  private start: Snap | null = null;
  private ctrl: { x: number; z: number } | null = null;
  private plan: RoadPlan | null = null;
  private cursorSnap: Snap | null = null;
  private upgradeSeg: number | null = null;
  private lastPointer: PointerInfo | null = null;
  private rbPreview: RoundaboutPreview | null = null;
  /** Grid mode: first corner, second corner, block size and the current preview. */
  private gridA: Snap | null = null;
  private gridB: { x: number; z: number } | null = null;
  gridBlock = 88;
  private gridPlans: { valid: RoadPlan[]; invalid: RoadPlan[]; cost: number; nu: number; nv: number } | null = null;
  private gridTimer = 0;
  private gridPending: { p: THREE.Vector3; e: PointerInfo } | null = null;

  /** Build highways raised on piers (overpasses). */
  raised = false;

  configure(type: RoadTypeId, mode: RoadMode, oneway = false, raised = false): void {
    this.type = type;
    this.mode = mode;
    this.oneway = oneway;
    this.raised = raised && isFreeway(type);
    this.reset();
  }

  /** End of the last road built, for F to continue from. */
  private lastEnd: { x: number; z: number } | null = null;

  activate(): void {
    this.reset();
    if (this.game.world) this.game.world.terrain.uniforms.uGridOpacity.value = 1;
  }

  deactivate(): void {
    this.reset();
    this.lastEnd = null;
    if (this.game.world) this.game.world.terrain.uniforms.uGridOpacity.value = 0;
  }

  private reset(): void {
    this.rbPreview = null;
    this.gridA = null;
    this.gridB = null;
    this.gridPlans = null;
    this.gridPending = null;
    const tu = this.game.world?.terrain.uniforms;
    if (tu && this.mode !== 'roundabout') {
      tu.uRing.value.w = 0;
      tu.uRingColor.value.setRGB(0.4, 0.8, 1);
    }
    this.start = null;
    this.ctrl = null;
    this.plan = null;
    this.game.world?.ghost.clear();
    if (this.upgradeSeg !== null) this.game.world?.roads.setHighlight([this.upgradeSeg], 0);
    this.upgradeSeg = null;
  }

  private baseAngle(s: Snap): number | null {
    const net = this.game.city!.roads;
    if (s.kind === 'node' && s.nodeId !== undefined) {
      const n = net.nodes.get(s.nodeId);
      if (n && n.segs.length) {
        const d = net.endDirection(net.getSegment(n.segs[0]), n.id);
        return Math.atan2(-d.z, -d.x);
      }
    }
    if (s.kind === 'segment' && s.segId !== undefined) {
      const seg = net.segments.get(s.segId);
      if (seg) {
        const p: PolyPoint = { x: 0, z: 0, tx: 0, tz: 0, i: 0 };
        pointAt(seg.poly, s.s ?? 0, p);
        return Math.atan2(p.tz, p.tx);
      }
    }
    return null;
  }

  private endPoint(p: THREE.Vector3, e: PointerInfo): Snap {
    const city = this.game.city!;
    let x = p.x, z = p.z;
    if (this.start && e.shift) {
      const from = this.ctrl ?? this.start;
      const dx = x - from.x, dz = z - from.z;
      const len = Math.max(8, Math.round(Math.hypot(dx, dz) / 8) * 8);
      const ref = this.ctrl ? 0 : this.baseAngle(this.start) ?? 0;
      const a = Math.atan2(dz, dx);
      const q = ref + Math.round((a - ref) / STEP) * STEP;
      x = from.x + Math.cos(q) * len;
      z = from.z + Math.sin(q) * len;
    }
    return snap(city, x, z, this.type, !e.ctrl);
  }

  onMove(p: THREE.Vector3 | null, e: PointerInfo): void {
    this.lastPointer = e;
    const city = this.game.city;
    const w = this.game.world;
    if (!city || !w || !p) return;
    if (this.mode === 'roundabout') {
      this.rbPreview = previewRoundabout(city, p.x, p.z);
      const ring = w.terrain.uniforms.uRing.value;
      if (this.rbPreview.nodeId !== undefined && this.rbPreview.r > 0) {
        ring.set(this.rbPreview.x, this.rbPreview.z, this.rbPreview.r, 1);
        w.terrain.uniforms.uRingColor.value.setRGB(this.rbPreview.valid ? 0.4 : 1, this.rbPreview.valid ? 0.95 : 0.3, this.rbPreview.valid ? 0.8 : 0.25);
      } else ring.w = 0;
      return;
    }
    if (this.mode === 'grid') {
      this.gridMove(p, e);
      return;
    }
    if (this.mode === 'upgrade' || this.mode === 'direction') {
      const seg = w.pickSegment(p);
      if (seg !== this.upgradeSeg) {
        if (this.upgradeSeg !== null) w.roads.setHighlight([this.upgradeSeg], 0);
        this.upgradeSeg = seg;
        if (seg !== null) w.roads.setHighlight([seg], 4);
      }
      return;
    }
    const end = this.endPoint(p, e);
    this.cursorSnap = end;
    if (!this.start) {
      w.ghost.clearRoad();
      w.ghost.setMarkers([{ x: end.x, z: end.z, kind: end.kind === 'free' ? 0 : 1 }]);
      this.plan = null;
      return;
    }
    if (this.mode === 'curve' && !this.ctrl) {
      this.plan = previewRoad(city, this.type, this.start, end, null, this.raised);
    } else {
      this.plan = previewRoad(city, this.type, this.start, end, this.ctrl, this.raised);
    }
    this.plan.oneway = this.oneway;
    w.ghost.showRoad(this.plan);
  }

  onDown(p: THREE.Vector3 | null, e: PointerInfo): void {
    const city = this.game.city;
    if (!city || !p) return;
    if (this.mode === 'roundabout') {
      const res = buildRoundabout(city, p.x, p.z);
      if (res.ok) {
        this.game.audio.play('build');
        this.game.flashMoney(-(res.cost ?? 0));
        this.onMove(p, e);
      } else {
        this.game.toastError(res.error ?? 'Cannot build a roundabout here');
      }
      return;
    }
    if (this.mode === 'grid') {
      this.gridDown(p, e);
      return;
    }
    if (this.mode === 'direction') {
      if (this.upgradeSeg === null) return;
      const res = cycleRoadDirection(city, this.upgradeSeg);
      if (res.ok) {
        this.game.audio.play('click');
        this.game.flashMoney(-(res.cost ?? 0));
      } else {
        this.game.toastError(res.error ?? 'Cannot change direction');
      }
      return;
    }
    if (this.mode === 'upgrade') {
      if (this.upgradeSeg === null) return;
      const res = upgradeRoad(city, this.upgradeSeg, this.type);
      if (res.ok) {
        this.game.audio.play('build');
        this.game.flashMoney(-(res.cost ?? 0));
        this.upgradeSeg = null;
        this.onMove(p, e);
      } else {
        this.game.toastError(res.error ?? 'Cannot upgrade');
      }
      return;
    }
    if (!roadUnlocked(this.type, city.peakPopulation)) {
      this.game.toastError(`${ROAD_TYPES[this.type].name} unlocks at ${formatInt(ROAD_TYPES[this.type].unlockPopulation)} population`);
      return;
    }
    const s = this.endPoint(p, e);
    if (!this.start) {
      this.start = s;
      this.game.audio.play('tick');
      return;
    }
    if (this.mode === 'curve' && !this.ctrl) {
      this.ctrl = { x: p.x, z: p.z };
      this.game.audio.play('tick');
      return;
    }
    const plan = previewRoad(city, this.type, this.start, s, this.ctrl, this.raised);
    plan.oneway = this.oneway;
    if (!plan.valid) {
      this.game.audio.play('error');
      this.game.toastError(plan.error ?? 'Invalid road');
      return;
    }
    const res = buildRoad(city, plan);
    if (!res.ok) {
      this.game.toastError(res.error ?? 'Cannot build road');
      return;
    }
    this.game.audio.play('build');
    this.game.flashMoney(-(res.cost ?? 0));
    // Each road is its own two clicks; F carries on from where this one ended.
    this.start = null;
    this.lastEnd = { x: plan.end.x, z: plan.end.z };
    this.ctrl = null;
    this.game.world?.ghost.clearRoad();
    this.onMove(p, e);
  }

  update(dt: number): void {
    // Grid previews plan many roads, so they refresh a few times a second.
    this.gridTimer -= dt;
    if (this.gridPending && this.gridTimer <= 0) {
      const { p, e } = this.gridPending;
      this.gridPending = null;
      this.gridTimer = 0.08;
      this.gridPreview(p, e);
    }
  }

  onKey(code: string): boolean {
    // F: start the next road from the end of the last one.
    if (this.game.keys.matches('roadContinue', code) && this.lastEnd && !this.start && (this.mode === 'straight' || this.mode === 'curve')) {
      const city = this.game.city;
      if (!city) return false;
      this.start = snap(city, this.lastEnd.x, this.lastEnd.z, this.type);
      this.ctrl = null;
      this.game.audio.play('tick');
      if (this.hover && this.lastPointer) this.onMove(this.hover, this.lastPointer);
      return true;
    }
    if (this.mode !== 'grid') return false;
    if (this.game.keys.matches('brushSmaller', code) || this.game.keys.matches('brushBigger', code)) {
      this.gridBlock = Math.max(GRID_MIN, Math.min(GRID_MAX, this.gridBlock + (this.game.keys.matches('brushSmaller', code) ? -8 : 8)));
      if (this.hover && this.lastPointer) this.gridPending = { p: this.hover.clone(), e: this.lastPointer };
      return true;
    }
    return false;
  }

  /** Second corner snapped to 15° steps (relative to a road at the first corner) with Shift. */
  private gridCorner(p: THREE.Vector3, e: PointerInfo): { x: number; z: number } {
    const a = this.gridA!;
    let x = p.x, z = p.z;
    if (e.shift) {
      const ref = this.baseAngle(a) ?? 0;
      const ang = Math.atan2(z - a.z, x - a.x);
      const q = ref + Math.round((ang - ref) / STEP) * STEP;
      const len = Math.hypot(x - a.x, z - a.z);
      x = a.x + Math.cos(q) * len;
      z = a.z + Math.sin(q) * len;
    }
    return { x, z };
  }

  /** The grid's street lines for the current corners and cursor depth. */
  private gridLines(c: { x: number; z: number }): { lines: [number, number, number, number][]; nu: number; nv: number } | null {
    const a = this.gridA!, b = this.gridB!;
    const lu = Math.hypot(b.x - a.x, b.z - a.z);
    if (lu < GRID_MIN * 0.75) return null;
    const ux = (b.x - a.x) / lu, uz = (b.z - a.z) / lu;
    const vx = -uz, vz = ux;
    const depth = (c.x - a.x) * vx + (c.z - a.z) * vz;
    const nu = Math.max(1, Math.round(lu / this.gridBlock));
    const nv = Math.max(1, Math.round(Math.abs(depth) / this.gridBlock));
    if (nu + nv + 2 > GRID_MAX_LINES) return null;
    const bv = this.gridBlock * Math.sign(depth || 1);
    const bu = lu / nu;
    const lines: [number, number, number, number][] = [];
    for (let i = 0; i <= nv; i++) lines.push([a.x + vx * bv * i, a.z + vz * bv * i, b.x + vx * bv * i, b.z + vz * bv * i]);
    for (let j = 0; j <= nu; j++) {
      const sx = a.x + ux * bu * j, sz = a.z + uz * bu * j;
      lines.push([sx, sz, sx + vx * bv * nv, sz + vz * bv * nv]);
    }
    return { lines, nu, nv };
  }

  private gridPreview(p: THREE.Vector3, e: PointerInfo): void {
    const city = this.game.city;
    const w = this.game.world;
    if (!city || !w || !this.gridA) return;
    if (!this.gridB) {
      const b = this.gridCorner(p, e);
      const plan = previewRoad(city, this.type, this.gridA, snap(city, b.x, b.z, this.type, false), null);
      this.plan = plan;
      w.ghost.showRoad(plan);
      return;
    }
    const g = this.gridLines(p);
    if (!g) {
      this.gridPlans = null;
      w.ghost.clearRoad();
      return;
    }
    const valid: RoadPlan[] = [], invalid: RoadPlan[] = [];
    let cost = 0;
    for (const [x0, z0, x1, z1] of g.lines) {
      const plan = previewRoad(city, this.type, snap(city, x0, z0, this.type), snap(city, x1, z1, this.type), null);
      if (plan.valid) {
        valid.push(plan);
        cost += plan.cost;
      } else invalid.push(plan);
    }
    this.gridPlans = { valid, invalid, cost, nu: g.nu, nv: g.nv };
    w.ghost.showRoads(valid, invalid);
  }

  private gridMove(p: THREE.Vector3, e: PointerInfo): void {
    const w = this.game.world!;
    if (!this.gridA) {
      const s = snap(this.game.city!, p.x, p.z, this.type, !e.ctrl);
      this.cursorSnap = s;
      w.ghost.clearRoad();
      w.ghost.setMarkers([{ x: s.x, z: s.z, kind: s.kind === 'free' ? 0 : 1 }]);
      return;
    }
    this.gridPending = { p: p.clone(), e };
  }

  private gridDown(p: THREE.Vector3, e: PointerInfo): void {
    const city = this.game.city!;
    if (!roadUnlocked(this.type, city.peakPopulation)) {
      this.game.toastError(`${ROAD_TYPES[this.type].name} unlocks at ${formatInt(ROAD_TYPES[this.type].unlockPopulation)} population`);
      return;
    }
    if (!this.gridA) {
      this.gridA = snap(city, p.x, p.z, this.type, !e.ctrl);
      this.game.audio.play('tick');
      return;
    }
    if (!this.gridB) {
      const b = this.gridCorner(p, e);
      if (Math.hypot(b.x - this.gridA.x, b.z - this.gridA.z) < GRID_MIN * 0.75) {
        this.game.toastError('Make the side longer');
        return;
      }
      this.gridB = b;
      this.game.audio.play('tick');
      this.gridPreview(p, e);
      return;
    }
    this.gridPreview(p, e);
    const g = this.gridPlans;
    if (!g || !g.valid.length) {
      this.game.audio.play('error');
      this.game.toastError('No streets can be built here');
      return;
    }
    if (!city.economy.canAfford(g.cost)) {
      this.game.audio.play('error');
      this.game.toastError(`Not enough money (${formatMoney(g.cost)})`);
      return;
    }
    // Build line by line, re-planning each against the roads built so far.
    const lines = this.gridLines(p)!.lines;
    let spent = 0, built = 0;
    for (const [x0, z0, x1, z1] of lines) {
      const plan = previewRoad(city, this.type, snap(city, x0, z0, this.type), snap(city, x1, z1, this.type), null);
      if (!plan.valid) continue;
      const res = buildRoad(city, plan);
      if (res.ok) {
        spent += res.cost ?? 0;
        built++;
      }
    }
    if (!built) {
      this.game.toastError('No streets could be built');
      return;
    }
    this.game.audio.play('build');
    this.game.flashMoney(-spent);
    this.reset();
  }

  onCancel(): boolean {
    if (this.mode === 'grid' && (this.gridA || this.gridB)) {
      if (this.gridB) {
        this.gridB = null;
        this.gridPlans = null;
        if (this.hover && this.lastPointer) this.gridPending = { p: this.hover.clone(), e: this.lastPointer };
      } else this.reset();
      return true;
    }
    if (this.ctrl) {
      this.ctrl = null;
      if (this.lastPointer && this.hover) this.onMove(this.hover, this.lastPointer);
      return true;
    }
    if (this.start) {
      this.reset();
      return true;
    }
    return false;
  }

  label(): CursorLabel | null {
    const rt = ROAD_TYPES[this.type];
    if (this.mode === 'roundabout') {
      const pv = this.rbPreview;
      if (!pv || pv.nodeId === undefined) return { title: 'Roundabout', lines: ['Click an intersection to turn it into a roundabout', 'Traffic circulates counter-clockwise and entering cars give way'] };
      return { title: `Roundabout · ${Math.round(pv.r * 2)} m`, lines: pv.valid ? [`Cost ${formatMoney(pv.cost)}`] : [], error: pv.valid ? undefined : pv.error, good: pv.valid };
    }
    if (this.mode === 'grid') {
      if (!this.gridA) return { title: `${rt.name} grid`, lines: ['Click the first corner', `Blocks ${this.gridBlock} m · [ ] to change`] };
      if (!this.gridB) return { title: `${rt.name} grid`, lines: ['Click to set one side (Shift snaps the angle)'] };
      const g = this.gridPlans;
      if (!g) return { title: `${rt.name} grid`, lines: ['Move the cursor out to set the depth'], error: 'Too small or too large' };
      return {
        title: `${rt.name} grid · ${g.nu} × ${g.nv} blocks`,
        lines: [`Cost ${formatMoney(g.cost)} · blocks ${this.gridBlock} m ([ ])`, g.invalid.length ? `${g.invalid.length} street${g.invalid.length > 1 ? 's' : ''} blocked (red)` : 'Click to build'],
        good: g.valid.length > 0 && !g.invalid.length,
        error: g.valid.length ? undefined : 'No streets can be built here',
      };
    }
    if (this.mode === 'direction') {
      const seg = this.upgradeSeg !== null ? this.game.city!.roads.segments.get(this.upgradeSeg) : undefined;
      if (!seg) return { title: 'Traffic direction', lines: ['Click a street or avenue to make it one-way, flip it, or make it two-way again'] };
      const now = seg.oneway === 0 ? 'Two-way' : 'One-way';
      return { title: `${seg.name || 'Road'} · ${now}`, lines: ['Click to change direction · $150'], error: canBeOneWay(seg.type) ? undefined : 'Divided roads stay two-way' };
    }
    if (this.mode === 'upgrade') {
      if (this.upgradeSeg === null) return { title: `Upgrade to ${rt.name}`, lines: ['Click a road to convert it'] };
      const seg = this.game.city!.roads.segments.get(this.upgradeSeg);
      if (!seg) return null;
      if (seg.type === this.type) return { title: seg.name, lines: [], error: `Already a ${rt.name.toLowerCase()}` };
      return { title: `${seg.name} → ${rt.name}`, lines: [`Cost ${formatMoney(upgradeCost(seg, this.type))}`] };
    }
    if (!this.start) {
      const s = this.cursorSnap;
      return { title: rt.name, lines: [s && s.kind !== 'free' ? 'Click to connect here' : 'Click to start a road', this.lastEnd ? `${this.game.keys.label('roadContinue')} to continue from the last road` : 'Hold Shift to snap angles'] };
    }
    if (this.mode === 'curve' && !this.ctrl) {
      return { title: `${rt.name} · curve`, lines: ['Click to set the bend point'] };
    }
    const p = this.plan;
    if (!p) return null;
    return {
      title: `${p.raised ? 'Raised ' : ''}${rt.name}${this.oneway && canBeOneWay(this.type) ? ' (one-way)' : ''}${p.elevated ? ' bridge' : ''} · ${Math.round(p.length)} m`,
      lines: [`Cost ${formatMoney(p.cost)}`, p.events.length ? `${p.events.length} new junction${p.events.length > 1 ? 's' : ''}` : ''].filter(Boolean),
      error: p.valid ? undefined : p.error,
      good: p.valid,
    };
  }
}
