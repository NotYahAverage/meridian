import { type PolyPoint, pointAt, pointInOBB } from '../core/geom2d';
import type { Game } from '../game/Game';
import type { RoadSegment } from '../sim/roads/RoadNetwork';
import { h } from './dom';

const MAX_LABELS = 28;
/** Labels appear below this camera distance (m). */
const SHOW_BELOW = 340;

/**
 * Street names written along the roads when the camera is close, like a map.
 * One label per street name, placed on its piece nearest the view centre,
 * rotated to follow the road and kept upright.
 */
export class StreetLabels {
  readonly el = h('div', { class: 'street-labels' });
  private pool: HTMLElement[] = [];
  private pp: PolyPoint = { x: 0, z: 0, tx: 0, tz: 0, i: 0 };

  constructor(private game: Game) {}

  update(): void {
    const g = this.game;
    const city = g.city;
    const dist = g.cam.distance;
    let used = 0;
    if (city && g.state === 'playing' && g.settings.streetNames !== false && dist < SHOW_BELOW) {
      const t = g.cam.target;
      const r = Math.min(520, dist * 1.7);
      // Best piece of each street: long enough, close to the view centre.
      const best = new Map<string, { seg: RoadSegment; score: number }>();
      for (const seg of city.roads.segmentsIn(t.x - r, t.z - r, t.x + r, t.z + r)) {
        if (!seg.name || seg.ring || seg.length < 28) continue;
        pointAt(seg.poly, seg.length / 2, this.pp);
        const d = Math.hypot(this.pp.x - t.x, this.pp.z - t.z);
        if (d > r) continue;
        const score = d - Math.min(seg.length, 200) * 0.6;
        const prev = best.get(seg.name);
        if (!prev || score < prev.score) best.set(seg.name, { seg, score });
      }
      const placed: { x: number; y: number }[] = [];
      const size = Math.max(10, Math.min(15, 2600 / Math.max(120, dist)));
      for (const [name, { seg }] of [...best].sort((a, b) => a[1].score - b[1].score)) {
        if (used >= MAX_LABELS) break;
        pointAt(seg.poly, seg.length / 2, this.pp);
        const { x, z, tx, tz } = this.pp;
        const y = city.terrain.roadHeightAt(x, z) + 0.4;
        const p = g.worldToScreen(x, y, z);
        const vw = g.renderer.size.width, vh = g.renderer.size.height;
        // Keep clear of the screen edges and the top bar.
        if (!p.visible || p.x < 90 || p.x > vw - 90 || p.y < 90 || p.y > vh - 30) continue;
        const q = g.worldToScreen(x + tx * 12, city.terrain.roadHeightAt(x + tx * 12, z + tz * 12) + 0.4, z + tz * 12);
        let ang = Math.atan2(q.y - p.y, q.x - p.x);
        // Keep text upright.
        if (ang > Math.PI / 2) ang -= Math.PI;
        else if (ang < -Math.PI / 2) ang += Math.PI;
        // The label has to fit along the road on screen.
        const screenLen = Math.hypot(q.x - p.x, q.y - p.y) * (seg.length / 12);
        if (screenLen < name.length * size * 0.55) continue;
        if (placed.some((o) => Math.hypot(o.x - p.x, o.y - p.y) < 70)) continue;
        if (this.hidden(x, y, z)) continue;
        placed.push({ x: p.x, y: p.y });
        const el = this.pool[used] ?? this.make();
        if (el.textContent !== name) el.textContent = name;
        el.style.display = '';
        el.style.fontSize = `${size.toFixed(1)}px`;
        el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%) rotate(${ang.toFixed(3)}rad)`;
        used++;
      }
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i].style.display = 'none';
  }

  /** True when a building stands between the camera and the label's spot on the road. */
  private hidden(x: number, y: number, z: number): boolean {
    const g = this.game;
    const city = g.city!;
    const heights = g.world?.buildings;
    if (!heights) return false;
    const c = g.renderer.camera.position;
    for (let k = 1; k <= 8; k++) {
      const t = k / 9;
      const px = c.x + (x - c.x) * t, py = c.y + (y - c.y) * t, pz = c.z + (z - c.z) * t;
      for (const b of city.buildings.queryRect(px - 1, pz - 1, px + 1, pz + 1)) {
        if (py > b.y + heights.heightOf(b.id)) continue;
        if (pointInOBB({ cx: b.cx, cz: b.cz, angle: b.angle, hw: b.hw * 0.8, hd: b.hd * 0.8 }, px, pz)) return true;
      }
    }
    return false;
  }

  private make(): HTMLElement {
    const el = h('div', { class: 'street-label' });
    this.el.appendChild(el);
    this.pool.push(el);
    return el;
  }
}
