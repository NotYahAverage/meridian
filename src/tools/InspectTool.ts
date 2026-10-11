import type * as THREE from 'three';
import { Tool, type PointerInfo } from './Tool';

export type Selection =
  | { kind: 'building'; id: number }
  | { kind: 'road'; id: number }
  | { kind: 'stop'; id: number }
  | { kind: 'vehicle'; id: number; serial: number }
  | null;

/** Default tool: hover highlighting and click-to-inspect. */
export class InspectTool extends Tool {
  readonly id = 'inspect';
  private hoverB: number | null = null;
  private hoverR: number | null = null;

  deactivate(): void {
    this.clearHover();
  }

  private clearHover(): void {
    const w = this.game.world;
    if (!w) return;
    w.buildings.clearHighlights(1);
    if (this.hoverR !== null && this.game.selection?.kind === 'road' && this.game.selection.id === this.hoverR) {
      // keep selection highlight
    } else if (this.hoverR !== null) {
      w.roads.setHighlight([this.hoverR], 0);
    }
    this.hoverB = null;
    this.hoverR = null;
    this.game.reapplySelection();
  }

  onMove(p: THREE.Vector3 | null, e: PointerInfo): void {
    const w = this.game.world;
    if (!w) return;
    const veh = w.pickVehicle(e.ndc, this.game.renderer.camera);
    const b = veh === null ? w.pickBuilding(e.ndc, this.game.renderer.camera, p) : null;
    const r = veh === null && b === null && p ? w.pickSegment(p) : null;
    const cursor = veh !== null || b !== null || r !== null ? 'pointer' : 'default';
    if (b === this.hoverB && r === this.hoverR) {
      this.game.canvas.style.cursor = cursor;
      return;
    }
    this.clearHover();
    this.hoverB = b;
    this.hoverR = r;
    if (b !== null) w.buildings.setHighlight([b], 1);
    if (r !== null) w.roads.setHighlight([r], 1);
    this.game.reapplySelection();
    this.game.canvas.style.cursor = cursor;
  }

  onDown(p: THREE.Vector3 | null, e: PointerInfo): void {
    const w = this.game.world;
    if (!w) return;
    const veh = w.pickVehicle(e.ndc, this.game.renderer.camera);
    if (veh !== null && this.game.city) {
      this.game.select({ kind: 'vehicle', id: veh, serial: this.game.city.vehicles.serial[veh] });
      this.game.audio.play('click');
      return;
    }
    const stop = p ? this.game.city?.transit.stopNear(p.x, p.z, 5) : null;
    if (stop) {
      this.game.select({ kind: 'stop', id: stop.id });
      this.game.audio.play('click');
      return;
    }
    const b = w.pickBuilding(e.ndc, this.game.renderer.camera, p);
    if (b !== null) {
      this.game.select({ kind: 'building', id: b });
      this.game.audio.play('click');
      return;
    }
    const r = p ? w.pickSegment(p) : null;
    if (r !== null) {
      this.game.select({ kind: 'road', id: r });
      this.game.audio.play('click');
      return;
    }
    this.game.select(null);
  }

  onCancel(): boolean {
    if (this.game.selection) {
      this.game.select(null);
      return true;
    }
    return false;
  }
}
