import type * as THREE from 'three';
import { formatInt, formatMoney } from '../core/math';
import { type PrototypePreview, placePrototype, previewPrototype } from '../sim/CityCommands';
import { type CursorLabel, type PointerInfo, Tool } from './Tool';

/** Builds a design from the sketchbook as a prototype, facing the nearest road. */
export class PrototypeTool extends Tool {
  readonly id = 'prototype';
  sketchId = '';
  private flip = false;
  private preview: PrototypePreview | null = null;

  configure(sketchId: string): void {
    this.sketchId = sketchId;
    this.flip = false;
  }

  private get sketch() {
    return this.game.city?.design.sketches.find((s) => s.id === this.sketchId);
  }

  deactivate(): void {
    const w = this.game.world;
    if (!w) return;
    w.ghost.clearBuilding();
    w.buildings.clearHighlights(3);
    this.preview = null;
  }

  onMove(p: THREE.Vector3 | null, _e: PointerInfo): void {
    const city = this.game.city;
    const w = this.game.world;
    const sk = this.sketch;
    if (!city || !w || !p || !sk) return;
    this.preview = previewPrototype(city, sk.id, p.x, p.z, this.flip);
    w.buildings.clearHighlights(3);
    if (this.preview.frame) {
      const c = sk.concept;
      w.ghost.showBuilding(`proto:${sk.id}`, this.preview.frame, this.preview.valid, { style: c.kind, floors: c.floors, level: c.level, look: c.look });
      w.buildings.setHighlight(this.preview.conflicts.map((b) => b.id), 3);
    } else w.ghost.clearBuilding();
    this.game.reapplySelection();
  }

  onDown(p: THREE.Vector3 | null, _e: PointerInfo): void {
    const city = this.game.city;
    const sk = this.sketch;
    if (!city || !p || !sk) return;
    const res = placePrototype(city, sk.id, p.x, p.z, this.flip);
    if (!res.ok) {
      this.game.audio.play('error');
      this.game.toastError(res.error ?? 'Cannot build here');
      return;
    }
    this.game.audio.play('build');
    this.game.flashMoney(-(res.cost ?? 0));
    const b = res.building!;
    this.game.world?.effects.burst(b.cx, b.y, b.cz, Math.max(b.hw, b.hd));
    this.game.world?.ghost.clearBuilding();
    // One prototype per trip: back to looking around, with the new building selected.
    this.game.setTool('inspect');
    this.game.select({ kind: 'building', id: b.id });
  }

  onKey(code: string): boolean {
    if (this.game.keys.matches('flip', code)) {
      this.flip = !this.flip;
      if (this.hover) this.onMove(this.hover, { x: 0, y: 0, ndc: null as unknown as THREE.Vector2, shift: false, ctrl: false, alt: false, down: false });
      return true;
    }
    return false;
  }

  label(): CursorLabel | null {
    const sk = this.sketch;
    if (!sk) return null;
    const pv = this.preview;
    const c = sk.concept;
    const spec = pv?.spec;
    const lines = [`Prototype · ${formatMoney(spec?.cost ?? 0)}`];
    if (spec) lines.push(spec.households ? `${formatInt(spec.households)} home${spec.households > 1 ? 's' : ''}${spec.jobs ? ` · ${formatInt(spec.jobs)} jobs` : ''}` : `${formatInt(spec.jobs)} jobs`);
    lines.push(`Tested for ${c.ambition} month${c.ambition > 1 ? 's' : ''} once built`);
    if (pv?.conflicts.length) lines.push(`Replaces ${pv.conflicts.length} building${pv.conflicts.length > 1 ? 's' : ''}`);
    lines.push('R to flip side of street · Esc to cancel');
    return { title: sk.name, lines, error: pv && !pv.valid ? pv.error : undefined, good: pv?.valid };
  }
}
