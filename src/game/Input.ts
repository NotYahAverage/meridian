import * as THREE from 'three';
import type { PointerInfo } from '../tools/Tool';

export interface InputHandlers {
  move(e: PointerInfo): void;
  down(e: PointerInfo): void;
  up(e: PointerInfo): void;
  cancel(): void;
  pan(dx: number, dy: number): void;
  rotate(dx: number, dy: number): void;
  /** Turn the view in place (right-drag, free cam). */
  look(dx: number, dy: number): void;
  /** Double-click: glide the camera to this spot. */
  focus?(e: PointerInfo): void;
  /** 'free': right-drag looks, middle-drag pans. 'classic': right-drag pans, middle-drag orbits. */
  cameraStyle?(): 'free' | 'classic';
  wheel(delta: number, e: PointerInfo): void;
  key(code: string, down: boolean, e: KeyboardEvent): void;
  /** Touch: should a one-finger drag pan the camera (true while inspecting)? */
  touchPans?(): boolean;
}

/**
 * Translates DOM input into game intents, laid out as a free cam:
 * left button = tools, right drag = look around (right click = cancel),
 * middle drag = pan, Alt+left drag = look around.
 * Touch: two fingers pan, pinch to zoom and twist to rotate; while
 * inspecting, one finger drags the map and a tap selects.
 */
export class Input {
  readonly pointer = { x: 0, y: 0, inside: false };
  private rightStart: { x: number; y: number } | null = null;
  private rightMoved = false;
  private midDrag = false;
  private altDrag = false;
  private leftDown = false;
  private last = { x: 0, y: 0 };
  private touches = new Map<number, { x: number; y: number }>();
  /** A one-finger touch that becomes a tap or a pan once we know which. */
  private touchTap: { x: number; y: number; moved: boolean } | null = null;
  private gesture: { cx: number; cy: number; dist: number; ang: number } | null = null;

  private measure(): { cx: number; cy: number; dist: number; ang: number } {
    const [a, b] = [...this.touches.values()];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  constructor(private el: HTMLElement, private h: InputHandlers) {
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointerenter', () => (this.pointer.inside = true));
    el.addEventListener('pointerleave', () => (this.pointer.inside = false));
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('dblclick', (e) => this.h.focus?.(this.info(e)));
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => {
      this.leftDown = false;
      this.rightStart = null;
      this.midDrag = false;
      this.unlock();
    });
  }

  info(e: PointerEvent | WheelEvent | MouseEvent): PointerInfo {
    const r = this.el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    return {
      x,
      y,
      ndc: new THREE.Vector2((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1),
      shift: e.shiftKey,
      ctrl: e.ctrlKey || e.metaKey,
      alt: e.altKey,
      down: this.leftDown,
    };
  }

  private onDown = (e: PointerEvent): void => {
    try {
      this.el.setPointerCapture?.(e.pointerId);
    } catch {
      // The pointer may already be gone (or be synthetic); capture is only a nicety.
    }
    this.last = { x: e.clientX, y: e.clientY };
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        // A second finger turns whatever the first was doing into a camera gesture.
        if (this.leftDown) {
          this.leftDown = false;
          this.h.cancel();
        }
        this.touchTap = null;
        this.gesture = this.measure();
        return;
      }
      if (this.touches.size > 2) return;
      if (this.h.touchPans?.()) {
        this.touchTap = { x: e.clientX, y: e.clientY, moved: false };
        return;
      }
    }
    if (e.button === 2) {
      this.rightStart = { x: e.clientX, y: e.clientY };
      this.rightMoved = false;
      this.rightTravel = 0;
    } else if (e.button === 1) {
      this.midDrag = true;
      e.preventDefault();
    } else if (e.button === 0) {
      if (e.altKey) {
        this.altDrag = true;
        return;
      }
      this.leftDown = true;
      this.h.down(this.info(e));
    }
  };

  private onMove = (e: PointerEvent): void => {
    const dx = e.clientX - this.last.x;
    const dy = e.clientY - this.last.y;
    this.last = { x: e.clientX, y: e.clientY };
    const r = this.el.getBoundingClientRect();
    this.pointer.x = e.clientX - r.left;
    this.pointer.y = e.clientY - r.top;
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size >= 2 && this.gesture) {
        const g = this.measure();
        this.h.pan(g.cx - this.gesture.cx, g.cy - this.gesture.cy);
        if (this.gesture.dist > 1 && g.dist > 1) this.h.wheel(Math.log(this.gesture.dist / g.dist) * 830, this.info(e));
        let da = g.ang - this.gesture.ang;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        if (Math.abs(da) > 0.002) this.h.rotate(-da / 0.006, 0);
        this.gesture = g;
        return;
      }
      if (this.touchTap) {
        if (!this.touchTap.moved && Math.hypot(e.clientX - this.touchTap.x, e.clientY - this.touchTap.y) > 8) this.touchTap.moved = true;
        if (this.touchTap.moved) this.h.pan(dx, dy);
        return;
      }
    }
    const classic = this.h.cameraStyle?.() === 'classic';
    if (this.rightStart && classic) {
      if (Math.hypot(e.clientX - this.rightStart.x, e.clientY - this.rightStart.y) > 4) this.rightMoved = true;
      if (this.rightMoved) this.h.pan(dx, dy);
      return;
    }
    if (this.rightStart) {
      // While looking around the cursor is hidden and locked (free cam), so the turn never
      // hits the edge of the screen; locked pointers only report movement.
      const locked = document.pointerLockElement === this.el;
      const mx = locked ? e.movementX : dx, my = locked ? e.movementY : dy;
      this.rightTravel += Math.abs(mx) + Math.abs(my);
      if (!this.rightMoved && this.rightTravel > 4) {
        this.rightMoved = true;
        try {
          const p = this.el.requestPointerLock?.() as unknown as Promise<void> | undefined;
          p?.catch?.(() => undefined);
        } catch {
          // Pointer lock is optional (some browsers and test runners refuse it).
        }
      }
      if (this.rightMoved) this.h.look(mx, my);
      return;
    }
    if (this.midDrag) {
      if (classic) this.h.rotate(dx, dy);
      else this.h.pan(dx, dy);
      return;
    }
    if (this.altDrag) {
      if (classic) this.h.rotate(dx, dy);
      else this.h.look(dx, dy);
      return;
    }
    if (e.target === this.el || this.leftDown) this.h.move(this.info(e));
  };

  private rightTravel = 0;

  private unlock(): void {
    if (document.pointerLockElement === this.el) document.exitPointerLock();
  }

  private onUp = (e: PointerEvent): void => {
    const wasTouch = this.touches.delete(e.pointerId);
    if (wasTouch && this.gesture) {
      if (this.touches.size < 2) this.gesture = null;
      return;
    }
    if (wasTouch && this.touchTap) {
      const tap = !this.touchTap.moved;
      this.touchTap = null;
      if (tap) {
        // A tap: hover, press and release at the same spot, like a click.
        const info = this.info(e);
        this.h.move(info);
        this.leftDown = true;
        this.h.down(this.info(e));
        this.leftDown = false;
        this.h.up(this.info(e));
      }
      return;
    }
    if (e.button === 2 && this.rightStart) {
      if (!this.rightMoved) this.h.cancel();
      this.rightStart = null;
      this.unlock();
      return;
    }
    if (e.button === 1) {
      this.midDrag = false;
      return;
    }
    if (e.button === 0) {
      if (this.altDrag) {
        this.altDrag = false;
        return;
      }
      if (this.leftDown) {
        this.leftDown = false;
        this.h.up(this.info(e));
      }
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const scale = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
    this.h.wheel(e.deltaY * scale, this.info(e));
  };

  /**
   * Keys belong to a text box while one has focus (but not to checkboxes, sliders and buttons,
   * which are inputs too). Esc always reaches the game, so it closes windows from anywhere.
   */
  private isTyping(e: KeyboardEvent): boolean {
    if (e.code === 'Escape') return false;
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    if (t.tagName === 'TEXTAREA' || t.isContentEditable) return true;
    if (t.tagName !== 'INPUT') return false;
    const type = (t as HTMLInputElement).type;
    return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image'].includes(type);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.isTyping(e)) return;
    // Esc out of a text box: leave the box as well.
    if (e.code === 'Escape' && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    this.h.key(e.code, true, e);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (this.isTyping(e)) return;
    this.h.key(e.code, false, e);
  };
}
