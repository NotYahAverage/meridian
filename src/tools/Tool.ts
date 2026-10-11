import type * as THREE from 'three';
import type { Game } from '../game/Game';

export interface PointerInfo {
  /** Screen position in CSS pixels. */
  x: number;
  y: number;
  ndc: THREE.Vector2;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  /** True while the primary button is held. */
  down: boolean;
}

export interface CursorLabel {
  title?: string;
  lines: string[];
  error?: string;
  good?: boolean;
}

/** Base class for interactive tools. */
export abstract class Tool {
  abstract readonly id: string;
  hover: THREE.Vector3 | null = null;

  constructor(protected game: Game) {}

  activate(): void {}
  deactivate(): void {}
  onMove(_p: THREE.Vector3 | null, _e: PointerInfo): void {}
  onDown(_p: THREE.Vector3 | null, _e: PointerInfo): void {}
  onUp(_p: THREE.Vector3 | null, _e: PointerInfo): void {}
  /** Right click / Escape. Return true if the tool consumed it. */
  onCancel(): boolean {
    return false;
  }
  onKey(_code: string, _e: KeyboardEvent): boolean {
    return false;
  }
  /** Mouse wheel while the tool is active (with modifier). Return true if consumed. */
  onWheel(_delta: number, _e: PointerInfo): boolean {
    return false;
  }
  update(_dt: number): void {}
  label(): CursorLabel | null {
    return null;
  }
}
