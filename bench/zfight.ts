// Finds coplanar overlapping triangles (z-fighting) in generated building geometry.
import fs from 'node:fs';
import { generateFor } from '../src/render/buildings/BuildingRenderer';
import { loadFromJSON } from '../src/sim/save/Serializer';

function triOverlap2D(a: number[][], b: number[][]): boolean {
  // Separating axis test on 2D triangles (shrunk slightly so shared edges don't count).
  const shrink = (t: number[][]) => { const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cy = (t[0][1] + t[1][1] + t[2][1]) / 3; return t.map(([x, y]) => [cx + (x - cx) * 0.98, cy + (y - cy) * 0.98]); };
  const A = shrink(a), B = shrink(b);
  for (const T of [A, B]) {
    for (let i = 0; i < 3; i++) {
      const p = T[i], q = T[(i + 1) % 3];
      const nx = q[1] - p[1], ny = p[0] - q[0];
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const v of A) { const d = v[0] * nx + v[1] * ny; amin = Math.min(amin, d); amax = Math.max(amax, d); }
      for (const v of B) { const d = v[0] * nx + v[1] * ny; bmin = Math.min(bmin, d); bmax = Math.max(bmax, d); }
      if (amax <= bmin + 1e-6 || bmax <= amin + 1e-6) return false;
    }
  }
  return true;
}

const city = loadFromJSON(fs.readFileSync('bench/.out/bigcity.save.json', 'utf8'));
const seen = new Map<string, { n: number; of: number; ex: string }>();
for (const b of city.buildings.all.values()) {
  const key = b.style;
  const st = seen.get(key) ?? { n: 0, of: 0, ex: '' };
  st.of++;
  seen.set(key, st);
  if (st.of > 400) continue;
  const g = generateFor(b);
  const pos = g.pos, idx = g.idx;
  const buckets = new Map<string, number[]>();
  const tris: { pts: number[][]; key: string }[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const P = [0, 1, 2].map((k) => [pos[idx[t + k] * 3], pos[idx[t + k] * 3 + 1], pos[idx[t + k] * 3 + 2]]);
    const u = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]];
    const v = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-6) continue;
    n = n.map((x) => x / l);
    // Fold opposite normals together (back-to-back faces also fight).
    const s = 1;
    const nn = n.map((x) => x * s);
    const d = nn[0] * P[0][0] + nn[1] * P[0][1] + nn[2] * P[0][2];
    const k = `${nn.map((x) => x.toFixed(2)).join(',')}|${d.toFixed(2)}`;
    // Project onto the plane's two largest axes.
    const ax = Math.abs(nn[0]) > Math.abs(nn[1]) && Math.abs(nn[0]) > Math.abs(nn[2]) ? 0 : Math.abs(nn[1]) > Math.abs(nn[2]) ? 1 : 2;
    const [i0, i1] = ax === 0 ? [1, 2] : ax === 1 ? [0, 2] : [0, 1];
    tris.push({ pts: P.map((p) => [p[i0], p[i1]]), key: k });
    const list = buckets.get(k) ?? [];
    list.push(tris.length - 1);
    buckets.set(k, list);
  }
  for (const list of buckets.values()) {
    for (let a = 0; a < list.length; a++) for (let c = a + 1; c < list.length; c++) {
      if (triOverlap2D(tris[list[a]].pts, tris[list[c]].pts)) { st.n++; if (!st.ex) st.ex = tris[list[a]].key + " A " + JSON.stringify(tris[list[a]].pts.map((p) => p.map((x) => +(x - (b.cx || 0)).toFixed(1)))) + " B " + JSON.stringify(tris[list[c]].pts.map((p) => p.map((x) => +(x - (b.cx || 0)).toFixed(1)))); }
    }
  }
}
for (const [k, v] of [...seen].sort()) console.log(k.padEnd(14), 'buildings', String(v.of).padStart(4), 'overlapping tri pairs in first 6:', v.n, v.ex);
