import * as THREE from 'three';
import { formatInt } from '../core/math';
import { fillTarget, fillZone, paintZone, zoneUnlocked } from '../sim/CityCommands';
import { ZONE_UNLOCK } from '../sim/progress/Progress';
import { ZONE_INFO, Zone } from '../sim/types';
import { type CursorLabel, type PointerInfo, Tool } from './Tool';

export type ZoneMode = 'brush' | 'fill';

/** Paints zoning with a resizable brush, or fills one side of a street. */
export class ZoneTool extends Tool {
  readonly id = 'zone';
  zone: Zone = Zone.ResLow;
  mode: ZoneMode = 'brush';
  radius = 14;
  private painting = false;
  private lastPaint: THREE.Vector3 | null = null;
  private cellsChanged = 0;

  configure(zone: Zone, mode: ZoneMode): void {
    this.zone = zone;
    this.mode = mode;
    this.updateBrush();
  }

  private color(): THREE.Color {
    if (this.zone === Zone.None) return new THREE.Color(1, 0.45, 0.35);
    const c = ZONE_INFO[this.zone].color;
    return new THREE.Color(c[0], c[1], c[2]);
  }

  activate(): void {
    const w = this.game.world;
    if (w) {
      w.overlays.zonableHint = 1;
      w.terrain.uniforms.uZoneOpacity.value = 0.62;
    }
    this.updateBrush();
  }

  deactivate(): void {
    const w = this.game.world;
    if (!w) return;
    w.overlays.zonableHint = 0;
    w.terrain.uniforms.uZoneOpacity.value = 0.2;
    w.terrain.uniforms.uBrush.value.w = 0;
    w.roads.clearHighlights();
  }

  private updateBrush(): void {
    const w = this.game.world;
    if (!w || !this.hover) return;
    const u = w.terrain.uniforms;
    u.uBrushColor.value.copy(this.color());
    if (this.mode === 'brush') u.uBrush.value.set(this.hover.x, this.hover.z, this.radius, 1);
    else u.uBrush.value.set(this.hover.x, this.hover.z, 4, 0.8);
  }

  onMove(p: THREE.Vector3 | null, e: PointerInfo): void {
    this.hover = p;
    this.updateBrush();
    const w = this.game.world;
    const city = this.game.city;
    if (!w || !city || !p) return;
    if (this.mode === 'fill') {
      w.roads.clearHighlights();
      const t = fillTarget(city, p.x, p.z);
      if (t) w.roads.setHighlight([t.seg.id], 2);
    }
    if (this.painting && e.down && this.mode === 'brush') this.paintTo(p);
  }

  private paintTo(p: THREE.Vector3): void {
    const city = this.game.city!;
    const from = this.lastPaint ?? p;
    const d = Math.hypot(p.x - from.x, p.z - from.z);
    const steps = Math.max(1, Math.ceil(d / (this.radius * 0.5)));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const r = paintZone(city, from.x + (p.x - from.x) * t, from.z + (p.z - from.z) * t, this.radius, this.zone);
      if (!r.ok) {
        this.game.toastError(r.error ?? 'Cannot zone');
        this.painting = false;
        return;
      }
      this.cellsChanged += r.changed ?? 0;
    }
    this.lastPaint = p.clone();
  }

  onDown(p: THREE.Vector3 | null): void {
    const city = this.game.city;
    if (!city || !p) return;
    if (!zoneUnlocked(city, this.zone)) {
      this.game.toastError(`${ZONE_INFO[this.zone].name} unlocks at ${formatInt(ZONE_UNLOCK[this.zone])} population`);
      return;
    }
    if (this.mode === 'fill') {
      const r = fillZone(city, p.x, p.z, this.zone);
      if (!r.ok) this.game.toastError(r.error ?? 'Cannot zone');
      else if (r.changed) this.game.audio.play('zone');
      return;
    }
    this.painting = true;
    this.cellsChanged = 0;
    this.lastPaint = null;
    this.paintTo(p);
  }

  onUp(): void {
    if (this.painting && this.cellsChanged > 0) this.game.audio.play('zone');
    this.painting = false;
    this.lastPaint = null;
  }

  onKey(code: string): boolean {
    if (this.game.keys.matches('brushSmaller', code)) {
      this.radius = Math.max(4, this.radius - 4);
      this.updateBrush();
      return true;
    }
    if (this.game.keys.matches('brushBigger', code)) {
      this.radius = Math.min(64, this.radius + 4);
      this.updateBrush();
      return true;
    }
    return false;
  }

  onWheel(delta: number, e: PointerInfo): boolean {
    if (!e.alt || this.mode !== 'brush') return false;
    this.radius = Math.min(64, Math.max(4, this.radius - Math.sign(delta) * 4));
    this.updateBrush();
    return true;
  }

  label(): CursorLabel | null {
    const name = this.zone === Zone.None ? 'Remove zoning' : ZONE_INFO[this.zone].name;
    if (this.mode === 'fill') return { title: name, lines: ['Click near a street to zone that side'] };
    return { title: name, lines: [`Brush ${this.radius * 2} m · [ ] to resize`] };
  }
}
