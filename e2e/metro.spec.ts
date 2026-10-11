import { expect, test } from '@playwright/test';
import { boot, frames, game, shot, trackErrors } from './helpers';

test('metro: stations, a line drawn with clicks, trains on the map', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  const ids = await game<number[]>(page, `g.ui.hideMenu(); g.state = 'playing'; g.ui.showHud(); g.setSpeed(0); g.hour = 11;
    const city = g.city; city.peakPopulation = 6000; city.economy.money = 2e6;
    // Try spots beside roads until we have three stations far enough apart.
    const placed = [];
    const segs = [...city.roads.segments.values()].filter((s) => s.type !== 'highway');
    for (const seg of segs) {
      for (const f of [0.3, 0.7]) {
        const k = Math.floor(seg.poly.count * f);
        const x = seg.poly.pts[k * 2], z = seg.poly.pts[k * 2 + 1];
        for (const [dx, dz] of [[0, 25], [0, -25], [25, 0], [-25, 0]]) {
          if (placed.some((b) => Math.hypot(b.cx - x - dx, b.cz - z - dz) < 380)) continue;
          const pv = C.previewPlacement(city, 'metro_station', x + dx, z + dz);
          if (!pv.valid) continue;
          const r = C.placeService(city, 'metro_station', x + dx, z + dz);
          if (r.ok) { r.building.state = 2 - 1; r.building.progress = 1; placed.push(r.building); break; }
        }
        if (placed.length >= 3) break;
      }
      if (placed.length >= 3) break;
    }
    return placed.map((b) => b.id);`);
  console.log('STATIONS', JSON.stringify(ids));
  expect(ids.length).toBeGreaterThanOrEqual(2);
  // Overview, then draw the line by clicking each station and pressing Enter.
  const c = await game<{ x: number; z: number }>(page, `const bs = ${JSON.stringify(ids)}.map((id) => g.city.buildings.get(id));
    const x = bs.reduce((a, b) => a + b.cx, 0) / bs.length, z = bs.reduce((a, b) => a + b.cz, 0) / bs.length;
    g.cam.jumpTo({ x, z, distance: 900, pitch: 1.2, yaw: 2.3 }); return { x, z };`);
  void c;
  await frames(page, 6);
  await page.locator('.rail-btn[data-cat="transit"]').click();
  await page.locator('.tray .card', { hasText: 'Metro Line' }).click();
  for (const id of ids) {
    const p = await game<{ x: number; y: number }>(page, `const b = g.city.buildings.get(${id}); return g.worldToScreen(b.cx, b.y + 2, b.cz);`);
    await page.mouse.move(p.x, p.y);
    await frames(page, 2);
    await page.mouse.click(p.x, p.y);
  }
  await frames(page, 3);
  
  await page.keyboard.press('Enter');
  const line = await game<string>(page, `const mt = g.city.transit.metro; const l = [...mt.lines.values()][0]; return JSON.stringify(l ? { stations: l.stations.length, trains: l.trains, problem: l.problem, len: Math.round(l.lengthM) } : null);`);
  console.log('LINE', line);
  expect(JSON.parse(line).stations).toBe(ids.length);
  await game(page, `g.city.transit.updateRidership();`);
  await page.waitForTimeout(800);
  await frames(page, 6);
  await shot(page, 'metro-panel');
  // Station close-up in daylight.
  await game(page, `g.setTool('inspect'); g.ui.closePanels?.(); const b = g.city.buildings.get(${ids[0]}); g.cam.jumpTo({ x: b.cx, z: b.cz, distance: 60, pitch: 0.5, yaw: Math.atan2(Math.sin(b.angle + Math.PI / 2), Math.cos(b.angle + Math.PI / 2)) + Math.PI });`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  await frames(page, 6);
  await shot(page, 'metro-station');
  expect(errors).toEqual([]);
});
