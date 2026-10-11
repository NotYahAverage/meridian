// Summarises a V8 .cpuprofile: top functions by self and total time.
import fs from 'node:fs';
const file = process.argv[2];
const p = JSON.parse(fs.readFileSync(file, 'utf8'));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = p.timeDeltas;
const counts = new Map();
for (let i = 0; i < p.samples.length; i++) counts.set(p.samples[i], (counts.get(p.samples[i]) ?? 0) + (dt[i] ?? 0));
const parent = new Map();
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const total = new Map();
const key = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
let all = 0;
for (const [id, t] of counts) {
  all += t;
  const n = byId.get(id);
  self.set(key(n), (self.get(key(n)) ?? 0) + t);
  const seen = new Set();
  let cur = id;
  while (cur !== undefined) {
    const k = key(byId.get(cur));
    if (!seen.has(k)) { total.set(k, (total.get(k) ?? 0) + t); seen.add(k); }
    cur = parent.get(cur);
  }
}
const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${(v / 1000).toFixed(0).padStart(7)} ms ${((v / all) * 100).toFixed(1).padStart(5)}%  ${k}`).join('\n');
console.log('SELF\n' + top(self, Number(process.argv[3] ?? 25)));
console.log('TOTAL\n' + top(total, Number(process.argv[4] ?? 40)));
