import type * as THREE from 'three';
import { formatMoney } from '../core/math';
import { placeService, previewPlacement } from '../sim/CityCommands';
import { SERVICE_BY_ID } from '../sim/services/ServiceTypes';

/** Placing one of these highlights the ones already built, so players can see existing coverage. */
const SAME_KIND: Record<string, string[]> = {
  police_station: ['police_station', 'police_hq'],
  police_hq: ['police_station', 'police_hq'],
  fire_station: ['fire_station', 'fire_hq'],
  fire_hq: ['fire_station', 'fire_hq'],
  clinic: ['clinic', 'hospital'],
  hospital: ['clinic', 'hospital'],
};
const SAME_CODE = 5;
import { type CursorLabel, type PointerInfo, Tool } from './Tool';

/** Places a service, park or utility building facing the nearest road. */
export class PlaceTool extends Tool {
  readonly id = 'place';
  typeId = 'police_station';
  private flip = false;
  private preview: ReturnType<typeof previewPlacement> | null = null;

  configure(typeId: string): void {
    this.typeId = typeId;
    this.flip = false;
  }

  activate(): void {
    this.highlightSameKind();
  }

  /** Highlights existing police stations, fire stations or health buildings while placing another. */
  private highlightSameKind(): void {
    const city = this.game.city;
    const w = this.game.world;
    if (!city || !w) return;
    w.buildings.clearHighlights(SAME_CODE);
    const kinds = SAME_KIND[this.typeId];
    if (!kinds) return;
    const ids: number[] = [];
    for (const b of city.buildings.all.values()) if (b.typeId && kinds.includes(b.typeId)) ids.push(b.id);
    w.buildings.setHighlight(ids, SAME_CODE);
  }

  deactivate(): void {
    const w = this.game.world;
    if (!w) return;
    w.ghost.clearBuilding();
    w.terrain.uniforms.uRing.value.w = 0;
    w.buildings.clearHighlights(3);
    w.buildings.clearHighlights(SAME_CODE);
    this.preview = null;
  }

  onMove(p: THREE.Vector3 | null, _e: PointerInfo): void {
    const city = this.game.city;
    const w = this.game.world;
    if (!city || !w || !p) return;
    this.preview = previewPlacement(city, this.typeId, p.x, p.z, this.flip);
    w.buildings.clearHighlights(3);
    this.highlightSameKind();
    if (this.preview.frame) {
      w.ghost.showBuilding(this.typeId, this.preview.frame, this.preview.valid);
      w.buildings.setHighlight(this.preview.conflicts.map((b) => b.id), 3);
      const st = SERVICE_BY_ID.get(this.typeId)!;
      const o = this.preview.frame.obb;
      const ring = w.terrain.uniforms.uRing.value;
      if (st.radius > 0) ring.set(o.cx, o.cz, st.radius, 1);
      else ring.w = 0;
    } else {
      w.ghost.clearBuilding();
      w.terrain.uniforms.uRing.value.w = 0;
    }
    this.game.reapplySelection();
  }

  onDown(p: THREE.Vector3 | null, e: PointerInfo): void {
    const city = this.game.city;
    if (!city || !p) return;
    const res = placeService(city, this.typeId, p.x, p.z, this.flip);
    if (!res.ok) {
      this.game.audio.play('error');
      this.game.toastError(res.error ?? 'Cannot place here');
      return;
    }
    this.game.audio.play('build');
    this.game.flashMoney(-(res.cost ?? 0));
    if (res.building) this.game.world?.effects.burst(res.building.cx, res.building.y, res.building.cz, Math.max(res.building.hw, res.building.hd));
    this.game.world?.ghost.clearBuilding();
    this.highlightSameKind();
    this.onMove(p, e);
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
    const st = SERVICE_BY_ID.get(this.typeId);
    if (!st) return null;
    const pv = this.preview;
    const cost = this.game.city ? this.game.city.research.costOf(st) : st.cost;
    const lines = [`Cost ${formatMoney(cost)} · Upkeep ${formatMoney(st.upkeep)}/mo`];
    if (pv?.conflicts.length) lines.push(`Replaces ${pv.conflicts.length} building${pv.conflicts.length > 1 ? 's' : ''}`);
    lines.push('R to flip side of street');
    return { title: st.name, lines, error: pv && !pv.valid ? pv.error : undefined, good: pv?.valid };
  }
}
