import type * as THREE from 'three';
import { type CursorLabel, type PointerInfo, Tool } from './Tool';

/** Paints named districts (or erases them with district id 0). */
export class DistrictTool extends Tool {
  readonly id = 'district';
  districtId = 0;
  radius = 60;
  private painting = false;

  activate(): void {
    this.game.setOverlay('districts');
  }

  deactivate(): void {
    const w = this.game.world;
    if (w) w.terrain.uniforms.uBrush.value.w = 0;
    this.game.setOverlay('none');
  }

  onMove(p: THREE.Vector3 | null, e: PointerInfo): void {
    this.hover = p;
    const w = this.game.world;
    if (!w || !p) return;
    const d = this.game.city!.districts.list.get(this.districtId);
    w.terrain.uniforms.uBrushColor.value.setRGB(d ? d.color[0] : 1, d ? d.color[1] : 0.4, d ? d.color[2] : 0.35);
    w.terrain.uniforms.uBrush.value.set(p.x, p.z, this.radius, 1);
    if (this.painting && e.down) this.paint(p);
  }

  private paint(p: THREE.Vector3): void {
    const city = this.game.city!;
    if (this.districtId && !city.districts.list.has(this.districtId)) return;
    city.districts.paint(p.x, p.z, this.radius, this.districtId);
  }

  onDown(p: THREE.Vector3 | null): void {
    if (!p) return;
    if (this.districtId === 0 || this.game.city!.districts.list.has(this.districtId)) {
      this.painting = true;
      this.paint(p);
    } else {
      this.game.toastError('Create a district first');
    }
  }

  onUp(): void {
    if (this.painting) this.game.audio.play('zone');
    this.painting = false;
  }

  onKey(code: string): boolean {
    if (this.game.keys.matches('brushSmaller', code)) {
      this.radius = Math.max(16, this.radius - 16);
      return true;
    }
    if (this.game.keys.matches('brushBigger', code)) {
      this.radius = Math.min(240, this.radius + 16);
      return true;
    }
    return false;
  }

  label(): CursorLabel | null {
    const d = this.game.city?.districts.list.get(this.districtId);
    return { title: d ? `Paint ${d.name}` : 'Erase districts', lines: [`Brush ${this.radius * 2} m · [ ] to resize`] };
  }
}
