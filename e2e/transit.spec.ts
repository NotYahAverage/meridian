import { expect, test } from '@playwright/test';
import { boot, frames, game, screenOf, shot, trackErrors } from './helpers';

/** Builds a bus network in the demo town with real clicks and watches buses run. */
test('public transit: depot, stops, line and buses', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await game(page, `g.ui.hideMenu(); g.state = 'playing'; g.ui.showHud(); g.setSpeed(0); g.hour = 11; g.env.updateEnvironmentMap(true);`);
  const sp = await game<{ endX: number; endZ: number }>(page, 'return g.city.terrain.spawn;');
  await game(page, `g.cam.jumpTo({ x: ${sp.endX + 260}, z: ${sp.endZ}, distance: 620, pitch: 1.4, yaw: Math.PI / 2 });`);
  await frames(page, 6);

  // The demo town already runs a line; start from a clean network.
  await game(page, `for (const id of [...g.city.transit.lines.keys()]) C.deleteLine(g.city, id); for (const id of [...g.city.transit.stops.keys()]) C.removeStop(g.city, id);`);
  const depots0 = await game<number>(page, `return [...g.city.buildings.all.values()].filter((b) => b.typeId === 'bus_depot').length;`);

  // ── Depot: find a free roadside lot, then place it with a click ──
  await page.locator('.rail-btn[data-cat="transit"]').click();
  await expect(page.locator('.tray')).toBeVisible();
  await page.locator('.card', { hasText: 'Bus Depot' }).click();
  const spot = await game<{ x: number; z: number } | null>(page, `
    for (let dx = 40; dx < 520; dx += 20) for (const dz of [-60, -40, 40, 60, -200, 200]) {
      const x = ${sp.endX} + dx, z = ${sp.endZ} + dz;
      const pv = C.previewPlacement(g.city, 'bus_depot', x, z);
      if (pv.valid && !pv.conflicts.length) return { x, z };
    }
    for (let dx = 40; dx < 520; dx += 20) for (const dz of [-60, -40, 40, 60, -200, 200]) {
      const x = ${sp.endX} + dx, z = ${sp.endZ} + dz;
      if (C.previewPlacement(g.city, 'bus_depot', x, z).valid) return { x, z };
    }
    return null;`);
  expect(spot).not.toBeNull();
  let s = await screenOf(page, spot!.x, spot!.z);
  await page.mouse.move(s.x, s.y, { steps: 4 });
  await page.mouse.click(s.x, s.y);
  const depots = await game<number>(page, `return [...g.city.buildings.all.values()].filter((b) => b.typeId === 'bus_depot').length;`);
  expect(depots).toBe(depots0 + 1);

  // ── Stops along the boulevard (north curb) ──
  await page.locator('.card', { hasText: 'Bus Stop' }).click();
  for (const dx of [60, 290, 470]) {
    s = await screenOf(page, sp.endX + dx, sp.endZ - 12);
    await page.mouse.move(s.x, s.y, { steps: 3 });
    await page.mouse.click(s.x, s.y);
  }
  // And one on a cross street to make a loop.
  const crossStop = await game<{ x: number; z: number } | null>(page, `
    for (let dz = 60; dz < 240; dz += 10) {
      const pv = C.previewStop(g.city, ${sp.endX} + 350 + 7, ${sp.endZ} - dz);
      if (pv.valid) return { x: ${sp.endX} + 357, z: ${sp.endZ} - dz };
    }
    return null;`);
  if (crossStop) {
    s = await screenOf(page, crossStop.x, crossStop.z);
    await page.mouse.move(s.x, s.y, { steps: 3 });
    await page.mouse.click(s.x, s.y);
  }
  const stops = await game<{ id: number; x: number; z: number }[]>(page, `return [...g.city.transit.stops.values()].map((s) => ({ id: s.id, x: s.x, z: s.z }));`);
  expect(stops.length).toBeGreaterThanOrEqual(3);
  await shot(page, 't1-stops');

  // ── Line: click the stops in order, then the first one again ──
  await page.locator('.card', { hasText: 'Bus Line' }).click();
  for (const st of [...stops, stops[0]]) {
    s = await screenOf(page, st.x, st.z);
    await page.mouse.move(s.x, s.y, { steps: 3 });
    await frames(page, 2);
    await page.mouse.click(s.x, s.y);
  }
  await expect(page.locator('.tline')).toHaveCount(1);
  await shot(page, 't2-line');

  // ── Finish the depot and run the city: buses drive the loop ──
  await game(page, `for (const b of g.city.buildings.all.values()) if (b.typeId === 'bus_depot') { b.progress = 1; b.state = 1; } g.city.transit.refreshRoutes(true); g.setSpeed(2);`);
  const line = await game<{ problem: string; buses: number }>(page, `const l = [...g.city.transit.lines.values()][0]; return { problem: l.problem, buses: l.buses };`);
  expect(line.problem).toBe('');
  await page.waitForFunction(() => {
    const v = (window as any).__meridian.game.city.vehicles;
    let n = 0;
    for (let i = 0; i < v.max; i++) if (v.active[i] && v.purpose[i] === 7) n++;
    return n >= 2;
  }, null, { timeout: 60_000 });
  // Riders are counted at the daily update.
  await game(page, `g.city.transit.updateRidership();`);
  const riders = await game<number>(page, `return g.city.transit.totalRiders;`);
  expect(riders).toBeGreaterThan(0);

  // Close-up of a bus at street level.
  await game(page, `g.ui.closePanel(); g.setTool('inspect'); const v = g.city.vehicles; let i = 0; for (let j = 0; j < v.max; j++) if (v.active[j] && v.purpose[j] === 7) { i = j; break; } g.cam.jumpTo({ x: v.x[i], z: v.z[i], distance: 38, pitch: 0.45, yaw: v.heading[i] + 1.1 }); g.setSpeed(0);`);
  await page.waitForTimeout(1200);
  await frames(page, 4);
  await shot(page, 't3-bus');
  await game(page, `g.setOverlay('transit'); g.cam.jumpTo({ x: ${sp.endX + 280}, z: ${sp.endZ - 40}, distance: 560, pitch: 1.1, yaw: 0.6 });`);
  await page.waitForTimeout(1500);
  await shot(page, 't4-transit-view');
  expect(errors.filter((e) => !e.includes('X4122'))).toEqual([]);
});
