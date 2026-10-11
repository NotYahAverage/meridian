import { test } from '@playwright/test';
import fs from 'node:fs';
import { boot, game, shot } from './helpers';

const SAVE = 'bench/.out/bigcity.save.json';

/**
 * Loads the large benchmark city (`npm run bench:save`) and measures frame
 * times from several viewpoints. Skipped when the save has not been generated.
 */
test('large city frame times', async ({ page }) => {
  test.skip(!fs.existsSync(SAVE), 'run `npm run bench:save` first');
  test.setTimeout(400_000);
  const json = fs.readFileSync(SAVE, 'utf8');
  await boot(page);
  await page.evaluate(async (j) => {
    const g = (window as any).__meridian.game;
    await g.loadData(JSON.parse(j));
  }, json);
  await page.waitForTimeout(3000);
  // Wrap the frame function to measure CPU time spent per frame.
  await game(page, `
    const orig = g.frame.bind(g);
    g.__cpu = [];
    g.frame = (dt) => { const s = performance.now(); orig(dt); g.__cpu.push(performance.now() - s); };
    g.setSpeed(3);
  `);
  const views: [string, string][] = [
    ['overview', 'distance: 1500, pitch: 0.95, yaw: 0.45'],
    ['district', 'distance: 600, pitch: 0.75, yaw: 0.8'],
    ['street', 'distance: 120, pitch: 0.42, yaw: 1.3'],
    ['horizon', 'distance: 500, pitch: 0.28, yaw: 2.2'],
  ];
  const results: string[] = [];
  for (const [name, cam] of views) {
    await game(page, `
      const b = [...g.city.buildings.all.values()];
      const cx = b.reduce((a, x) => a + x.cx, 0) / b.length, cz = b.reduce((a, x) => a + x.cz, 0) / b.length;
      g.cam.jumpTo({ x: cx, z: cz, ${cam} }); g.hour = 11;`);
    await page.waitForTimeout(2500);
    const r = await game<{ fps: number; p50: number; p95: number; cpu50: number; cpu95: number; calls: number; tris: number }>(page, `
      g.__cpu = [];
      const ts = [];
      await new Promise((res) => { let last = performance.now(); const f = (t) => { ts.push(t - last); last = t; if (ts.length < 240) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
      const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * p)]; };
      const info = g.renderer.renderer.info.render;
      return { fps: 1000 / (ts.reduce((a, x) => a + x, 0) / ts.length), p50: q(ts, 0.5), p95: q(ts, 0.95), cpu50: q(g.__cpu, 0.5), cpu95: q(g.__cpu, 0.95), calls: info.calls, tris: info.triangles };
    `);
    results.push(`${name.padEnd(9)} fps ${r.fps.toFixed(0).padStart(4)}  frame p50 ${r.p50.toFixed(1)} p95 ${r.p95.toFixed(1)} ms  cpu p50 ${r.cpu50.toFixed(1)} p95 ${r.cpu95.toFixed(1)} ms  draws ${r.calls} tris ${(r.tris / 1e6).toFixed(2)}M`);
    await shot(page, `perf-${name}`);
  }
  const stats = await game<string>(page, `return 'pop ' + g.city.population.residents + ', vehicles ' + g.city.vehicles.count + ', buildings ' + g.city.buildings.count;`);
  console.log(`\n${stats}\n${results.join('\n')}`);
});
