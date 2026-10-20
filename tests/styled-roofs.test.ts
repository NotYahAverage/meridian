import { expect, test } from 'vitest';
import { generateBuilding } from '../src/render/buildings/generators';
import { makeMovement, zeroAxes } from '../src/sim/style/Movements';
import { Rng } from '../src/core/rng';

// Looking straight down at a building: the highest surface at each point must face up, or it is culled and you see through it.
// (Under 2 m is ignored: a few centimetres of plinth rim.)
test('seen from above, no styled building is open to the ground', () => {
  const bad = new Map<string, { pts: number; ex: string }>();
  for (let s = 1; s <= 60; s++) {
    const r = new Rng(s); const ax = zeroAxes();
    for (const k of Object.keys(ax) as (keyof typeof ax)[]) ax[k] = r.range(-1, 1);
    const look = makeMovement(5, s, ax, 10, false);
    for (const [style, w, d, fl] of [['midrise', 34, 34, 7], ['tower', 36, 36, 14], ['lowrise', 30, 30, 4], ['townhouse', 26, 26, 3], ['house', 18, 28, 2], ['mixeduse', 26, 28, 4], ['office', 34, 34, 8], ['hotel', 34, 34, 8], ['shop', 16, 22, 1], ['officeTower', 36, 36, 20], ['modernHouse', 20, 30, 2]] as const) {
      const geo = generateBuilding({ style: style as any, w, d, floors: fl, level: 2, seed: s * 17, look }, 0, 0, 0, 0);
      const { pos, idx } = geo;
      const T: number[][] = [];
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
        T.push([pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2], pos[c], pos[c + 1], pos[c + 2]]);
      }
      let n = 0, ex = '';
      for (let x = -w / 2 + 1; x < w / 2; x += 2) for (let z = -d / 2 + 1; z < d / 2; z += 2) {
        let bestY = -1e9, up = true;
        for (const q of T) {
          // 2D point in triangle (xz), height at that point.
          const [ax_, ay, az, bx, by, bz, cx, cy, cz] = q;
          const d0 = (bz - cz) * (ax_ - cx) + (cx - bx) * (az - cz);
          if (Math.abs(d0) < 1e-9) continue;
          const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d0;
          const l2 = ((cz - az) * (x - cx) + (ax_ - cx) * (z - cz)) / d0;
          const l3 = 1 - l1 - l2;
          if (l1 < 0 || l2 < 0 || l3 < 0) continue;
          const y = l1 * ay + l2 * by + l3 * cy;
          const fup = ((bx - ax_) * (cz - az) - (bz - az) * (cx - ax_)) < 0;
          if (y > bestY + 1e-4 || (Math.abs(y - bestY) <= 1e-4 && fup)) {
            bestY = y;
            // facing: normal y sign from winding
            const ny = (bx - ax_) * (cz - az) - (bz - az) * (cx - ax_);
            up = ny < 0;
          }
        }
        if (bestY > 2 && !up) { n++; ex ||= `${x},${z} y=${bestY.toFixed(1)}`; }
      }
      if (n) { const key = `${style} roof=${look.roof}`; const e = bad.get(key) ?? { pts: 0, ex: '' }; e.pts += n; e.ex ||= `seed ${s} ${ex}`; bad.set(key, e); }
    }
  }
  expect([...bad].map(([k, v]) => `${k}: ${v.pts} points, e.g. ${v.ex}`)).toEqual([]);
});
