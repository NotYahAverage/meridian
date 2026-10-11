import type * as THREE from 'three';
import { formatMoney } from '../core/math';
import { TREE_CLEAR_COST, TREE_COST, clearTrees, plantTrees } from '../sim/CityCommands';
import { EARTH_COST, type TerraformMode, type TerraformResult, terraform } from '../sim/world/Terraform';
import { type CursorLabel, type PointerInfo, Tool } from './Tool';

/** Ground shaping plus tree planting and clearing, all with the same brush. */
export type BrushMode = TerraformMode | 'plant' | 'clear';

export const TERRAFORM_MODES: { id: BrushMode; name: string; icon: string; description: string; color: [number, number, number] }[] = [
  { id: 'raise', name: 'Raise', icon: 'raise', description: 'Build up hills and embankments', color: [0.45, 0.95, 0.55] },
  { id: 'lower', name: 'Lower', icon: 'lower', description: 'Dig valleys; below sea level the ground fills with water', color: [1, 0.62, 0.3] },
  { id: 'level', name: 'Level', icon: 'level', description: 'Flatten to the height where you start dragging', color: [0.4, 0.8, 1] },
  { id: 'smooth', name: 'Smooth', icon: 'smooth', description: 'Soften slopes and rough ground', color: [0.8, 0.6, 1] },
  { id: 'plant', name: 'Plant Trees', icon: 'tree', description: 'Saplings that grow in two months; trees clean the air and quiet traffic', color: [0.35, 0.85, 0.4] },
  { id: 'clear', name: 'Clear Trees', icon: 'axe', description: 'Fell trees to open up land', color: [1, 0.5, 0.35] },
];

/** Seconds between brush applications while dragging. */
const DAB = 0.08;

/** Raises, lowers, levels or smooths the ground with a brush. */
export class TerraformTool extends Tool {
  readonly id = 'terraform';
  mode: BrushMode = 'raise';
  private strokeCount = 0;
  private sound = 0;
  radius = 40;
  private stroking = false;
  private fine = false;
  private acc = 0;
  private target = 0;
  private strokeCost = 0;
  private strokeError = '';
  private quote: TerraformResult | null = null;

  configure(mode: BrushMode): void {
    this.mode = mode;
  }

  activate(): void {
    this.updateBrush();
  }

  deactivate(): void {
    const w = this.game.world;
    if (w) w.terrain.uniforms.uBrush.value.w = 0;
    this.endStroke();
  }

  private updateBrush(): void {
    const w = this.game.world;
    if (!w) return;
    const u = w.terrain.uniforms;
    if (!this.hover) {
      u.uBrush.value.w = 0;
      return;
    }
    const c = TERRAFORM_MODES.find((m) => m.id === this.mode)!.color;
    const bad = this.quote && !this.quote.ok && this.quote.error;
    u.uBrushColor.value.setRGB(bad ? 1 : c[0], bad ? 0.35 : c[1], bad ? 0.3 : c[2]);
    u.uBrush.value.set(this.hover.x, this.hover.z, this.radius, 1);
  }

  private strength(): number {
    if (this.mode === 'smooth') return 1;
    return this.fine ? 0.1 : 0.42;
  }

  onMove(p: THREE.Vector3 | null, e: PointerInfo): void {
    this.hover = p;
    this.fine = e.shift;
    const city = this.game.city;
    if (city && p && !this.stroking) {
      const m = this.mode;
      this.quote = m === 'plant' || m === 'clear' ? null : terraform(city, { mode: m, x: p.x, z: p.z, radius: this.radius, strength: this.strength(), target: m === 'level' ? city.terrain.sampleBase(p.x, p.z) : undefined }, false);
    }
    this.updateBrush();
  }

  onDown(p: THREE.Vector3 | null, e: PointerInfo): void {
    const city = this.game.city;
    if (!p || !city) return;
    this.stroking = true;
    this.fine = e.shift;
    this.target = city.terrain.sampleBase(p.x, p.z);
    this.strokeCost = 0;
    this.strokeCount = 0;
    this.sound = 0;
    this.strokeError = '';
    this.acc = DAB;
  }

  onUp(): void {
    this.endStroke();
  }

  onCancel(): boolean {
    if (this.stroking) {
      this.endStroke();
      return true;
    }
    return false;
  }

  private endStroke(): void {
    if (!this.stroking) return;
    this.stroking = false;
    if (this.strokeCost > 0) {
      this.game.audio.play('build');
      this.game.flashMoney(-this.strokeCost);
    }
  }

  update(dt: number): void {
    if (!this.stroking || !this.hover) return;
    const city = this.game.city;
    if (!city) return;
    this.acc += dt;
    let n = 0;
    while (this.acc >= DAB && n < 3) {
      this.acc -= DAB;
      n++;
      const m = this.mode;
      let res: { ok: boolean; cost?: number; error?: string };
      if (m === 'plant') {
        // A few saplings per dab, more for a bigger brush.
        const r = plantTrees(city, this.hover.x, this.hover.z, this.radius, Math.max(1, Math.round((this.radius * this.radius) / 1100)));
        if (r.ok) this.strokeCount += r.planted ?? 0;
        res = r;
      } else if (m === 'clear') {
        const r = clearTrees(city, this.hover.x, this.hover.z, this.radius);
        if (r.ok) this.strokeCount += r.removed ?? 0;
        res = r.ok || r.error?.includes('money') ? r : { ok: false };
      } else {
        res = terraform(city, { mode: m, x: this.hover.x, z: this.hover.z, radius: this.radius, strength: this.strength(), target: this.target });
      }
      if (res.ok) {
        this.strokeCost += res.cost ?? 0;
        this.sound -= DAB;
        if (this.sound <= 0) {
          this.sound = m === 'plant' ? 0.16 : m === 'clear' ? 0.3 : 0.24;
          this.game.audio.play(m === 'plant' ? 'plant' : m === 'clear' ? 'chop' : 'dig');
        }
      }
      else if (res.error && res.error !== this.strokeError) {
        this.strokeError = res.error;
        if (res.error.includes('money')) {
          this.game.toastError(res.error);
          this.endStroke();
          return;
        }
      }
    }
    this.acc = Math.min(this.acc, DAB);
  }

  onKey(code: string): boolean {
    if (this.game.keys.matches('brushSmaller', code)) {
      this.radius = Math.max(12, this.radius - 8);
      this.updateBrush();
      return true;
    }
    if (this.game.keys.matches('brushBigger', code)) {
      this.radius = Math.min(160, this.radius + 8);
      this.updateBrush();
      return true;
    }
    return false;
  }

  onWheel(delta: number, e: PointerInfo): boolean {
    if (!e.alt) return false;
    this.radius = Math.min(160, Math.max(12, this.radius - Math.sign(delta) * 8));
    this.updateBrush();
    return true;
  }

  label(): CursorLabel | null {
    const def = TERRAFORM_MODES.find((m) => m.id === this.mode)!;
    const city = this.game.city;
    const lines = [`Brush ${this.radius * 2} m · [ ] resize · Shift for fine control`];
    if (this.mode === 'level' && city && this.hover) {
      const h = this.stroking ? this.target : city.terrain.sampleBase(this.hover.x, this.hover.z);
      lines.push(`Level to ${h.toFixed(1)} m`);
    }
    if (this.mode === 'plant') {
      lines[0] = `Brush ${this.radius * 2} m · [ ] resize`;
      lines.push(this.stroking ? `${this.strokeCount} planted · ${formatMoney(this.strokeCost)}` : `${formatMoney(TREE_COST)} per tree`);
    } else if (this.mode === 'clear') {
      lines[0] = `Brush ${this.radius * 2} m · [ ] resize`;
      const n = city && this.hover ? city.nature.countDisc(this.hover.x, this.hover.z, this.radius) : 0;
      lines.push(this.stroking ? `${this.strokeCount} felled · ${formatMoney(this.strokeCost)}` : `${n} ${n === 1 ? 'tree' : 'trees'} here · ${formatMoney(TREE_CLEAR_COST)} each`);
    } else if (this.stroking) lines.push(`Earthworks ${formatMoney(this.strokeCost)}`);
    else lines.push(`$${EARTH_COST.toFixed(2)} per m³ of earth moved`);
    const q = this.quote;
    const error = !this.stroking && q && !q.ok ? q.error : this.stroking && this.strokeError.includes('money') ? this.strokeError : undefined;
    if (!error && q && q.locked > 0.2 && this.mode !== 'plant' && this.mode !== 'clear') lines.push('Roads and buildings keep their ground');
    const title = this.mode === 'plant' || this.mode === 'clear' ? def.name : `${def.name} terrain`;
    const err = this.stroking && this.strokeError.includes('money') ? this.strokeError : this.mode === 'plant' || this.mode === 'clear' ? undefined : error;
    return { title, lines, error: err };
  }
}
