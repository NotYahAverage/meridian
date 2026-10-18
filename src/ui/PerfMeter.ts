import type { Game } from '../game/Game';
import { h, setText } from './dom';

/**
 * Frames per second and frame time, top centre (Settings → Show FPS / Show frame time).
 * Measured from real time between frames; refreshed a few times a second so it's readable.
 */
export class PerfMeter {
  readonly el = h('div', { class: 'perf-meter hidden', 'aria-live': 'off' });
  private fps = h('span', { class: 'perf-fps' });
  private ms = h('span', { class: 'perf-ms' });
  private last = 0;
  private times: number[] = [];
  private shownAt = 0;

  constructor(private game: Game) {
    this.el.append(this.fps, this.ms);
  }

  update(): void {
    const s = this.game.settings;
    const on = !!(s.showFps || s.showFrameTime);
    this.el.classList.toggle('hidden', !on);
    const now = performance.now();
    if (this.last) this.times.push(now - this.last);
    this.last = now;
    if (!on) {
      this.times.length = 0;
      return;
    }
    if (this.times.length > 240) this.times.splice(0, this.times.length - 240);
    if (now - this.shownAt < 250 || !this.times.length) return;
    this.shownAt = now;
    // The last second or so: average rate, typical frame and the slowest.
    const recent = this.times.slice(-60);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const sorted = [...recent].sort((a, b) => a - b);
    const typical = sorted[Math.floor(sorted.length / 2)];
    const worst = sorted[sorted.length - 1];
    const fps = 1000 / avg;
    this.fps.classList.toggle('hidden', !s.showFps);
    this.ms.classList.toggle('hidden', !s.showFrameTime);
    setText(this.fps, `${Math.round(fps)} FPS`);
    setText(this.ms, `${typical.toFixed(1)} ms · worst ${Math.round(worst)} ms`);
    this.el.classList.toggle('warn', fps < 45 && fps >= 25);
    this.el.classList.toggle('bad', fps < 25);
    this.el.setAttribute('data-tip', 'Frames per second, and how long a frame takes (typical and slowest of the last second). Meridian runs on your computer, so there is no network ping: frame time is what you feel as lag.');
  }
}
