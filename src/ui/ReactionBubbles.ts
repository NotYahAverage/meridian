import type { Game } from '../game/Game';
import { GRADE_LABEL, type Reaction, type Trial } from '../sim/design/Trials';
import { h } from './dom';

/** Seconds a speech bubble stays up. */
const BUBBLE_SECONDS = 7;
/** Badges show below this camera distance (m); finished trials only when closer. */
const BADGE_BELOW = 1500;
const DONE_BELOW = 520;

interface Bubble {
  trial: number;
  el: HTMLElement;
  age: number;
  /** Game day it was said. */
  day: number;
}

/**
 * Prototypes in the world: a badge over each one with its name, stage and
 * approval, and speech bubbles with what people say about it as they say it.
 */
export class ReactionBubbles {
  readonly el = h('div', { class: 'proto-layer' });
  private badges = new Map<number, HTMLElement>();
  private bubbles = new Map<number, Bubble>();
  private queue = new Map<number, Reaction[]>();

  constructor(private game: Game) {}

  reset(): void {
    this.el.innerHTML = '';
    this.badges.clear();
    this.bubbles.clear();
    this.queue.clear();
  }

  /** Someone said something about a prototype. */
  push(trial: number, re: Reaction): void {
    const q = this.queue.get(trial) ?? [];
    q.push(re);
    // At high speed people talk faster than bubbles can show: keep the newest.
    if (q.length > 2) q.splice(0, q.length - 2);
    this.queue.set(trial, q);
  }

  update(dt: number): void {
    const g = this.game;
    const city = g.city;
    const world = g.world;
    const show = !!city && !!world && g.state === 'playing' && !g.photoMode;
    const seen = new Set<number>();
    if (show) {
      const dist = g.cam.distance;
      for (const t of city.design.trials) {
        if (t.state === 'gone' || t.decision?.kind === 'scrapped') continue;
        const b = city.buildings.get(t.buildingId);
        if (!b) continue;
        const done = t.state === 'done';
        if (dist > (done ? DONE_BELOW : BADGE_BELOW)) continue;
        const top = b.y + world.buildings.heightOf(b.id) + 3;
        const p = g.worldToScreen(b.cx, top, b.cz);
        if (!p.visible) continue;
        seen.add(t.id);
        const badge = this.badge(t);
        badge.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
        this.bubble(t, dt, p.x, p.y - badge.offsetHeight - 8);
      }
    }
    for (const [id, el] of this.badges) {
      if (seen.has(id)) continue;
      el.remove();
      this.badges.delete(id);
    }
    for (const [id, bb] of this.bubbles) {
      if (seen.has(id)) continue;
      bb.el.remove();
      this.bubbles.delete(id);
    }
  }

  private badge(t: Trial): HTMLElement {
    const city = this.game.city!;
    let el = this.badges.get(t.id);
    if (!el) {
      el = h('button', { class: 'proto-badge', onclick: () => this.game.ui.studio.open({ tab: 'prototypes', trialId: t.id }) });
      this.el.appendChild(el);
      this.badges.set(t.id, el);
    }
    const open = t.openDay >= 0;
    const stage = t.state === 'done' && t.verdict && !t.decision ? `Verdict: ${GRADE_LABEL[t.verdict.grade]} · your call` : city.design.stageOf(t);
    const key = `${t.name}|${stage}|${t.approval}|${open}`;
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.dataset.mood = !open ? 'none' : t.approval >= 58 ? 'good' : t.approval >= 45 ? 'mid' : 'bad';
      el.innerHTML = '';
      el.append(
        h('span', { class: 'proto-badge-name' }, t.name),
        h('span', { class: 'proto-badge-stage' }, stage),
        ...(open ? [h('span', { class: 'proto-badge-meter' }, h('i', { style: `width:${t.approval}%` }), h('b', null, `${t.approval}%`))] : []),
      );
    }
    return el;
  }

  private bubble(t: Trial, dt: number, x: number, y: number): void {
    let bb = this.bubbles.get(t.id);
    if (bb) {
      // Bubbles keep time with the game: paused, they wait.
      if (this.game.speed > 0) bb.age += dt;
      // Old news after a long skip ahead.
      if (bb.age > BUBBLE_SECONDS || this.game.city!.clock.day - bb.day > 10) {
        bb.el.remove();
        this.bubbles.delete(t.id);
        bb = undefined;
      }
    }
    if (!bb) {
      const q = this.queue.get(t.id);
      let re = q?.shift();
      while (re && this.game.city!.clock.day - re.day > 10) re = q?.shift();
      if (!re) return;
      const el = h('div', { class: `proto-bubble ${re.mood >= 0.15 ? 'pos' : re.mood <= -0.15 ? 'neg' : 'meh'}` }, h('div', { class: 'proto-bubble-text' }, re.text), h('div', { class: 'proto-bubble-who' }, re.who));
      this.el.appendChild(el);
      bb = { trial: t.id, el, age: 0, day: re.day };
      this.bubbles.set(t.id, bb);
    }
    const fade = Math.min(1, bb.age / 0.25, (BUBBLE_SECONDS - bb.age) / 0.6);
    bb.el.style.opacity = fade.toFixed(2);
    bb.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
  }
}
