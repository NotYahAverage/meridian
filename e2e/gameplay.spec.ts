import { expect, test } from '@playwright/test';
import { boot, frames, game, screenOf, shot, trackErrors } from './helpers';

test('boots to the main menu without errors', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await frames(page, 10);
  await shot(page, '01-menu');
  const info = await game<{ buildings: number; pop: number }>(page, 'return { buildings: g.city.buildings.count, pop: g.city.population.residents };');
  expect(info.buildings).toBeGreaterThan(20);
  expect(errors.filter((e) => !e.includes('X4122'))).toEqual([]);
});

test('full loop: found, build, zone, grow, traffic, save, reload, continue', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);

  // ── Found a new city through the UI ──
  await page.getByRole('button', { name: 'New city' }).click();
  await page.locator('.modal .text-input').first().fill('E2E Harbor');
  await page.locator('.modal .text-input.mono').fill('777');
  await page.locator('.modal .text-input.mono').press('Tab');
  // These tests play without the tutorial.
  await page.locator('.guide-check input').uncheck();
  await page.getByRole('button', { name: 'Found city' }).click();
  await page.waitForFunction(() => (window as any).__meridian.game.state === 'playing', null, { timeout: 60_000 });
  await expect(page.locator('.hud')).toBeVisible();
  await expect(page.locator('.tb-name')).toHaveText('E2E Harbor');
  await page.waitForTimeout(2500);
  await game(page, `g.ui.closePanel(); g.setSpeed(0); const sp = g.city.terrain.spawn; g.cam.jumpTo({ x: sp.endX + 165, z: sp.endZ + 20, distance: 640, pitch: 1.4, yaw: Math.PI / 2 });`);
  await frames(page, 6);
  await shot(page, '02-new-city');
  const sp = await game<{ endX: number; endZ: number }>(page, 'return g.city.terrain.spawn;');
  const segs0 = await game<number>(page, 'return g.city.roads.segments.size;');

  // ── Build a street from the highway end with real mouse clicks ──
  await page.locator('.rail-btn[data-cat="roads"]').click();
  await expect(page.locator('.tray')).toBeVisible();
  const a = await screenOf(page, sp.endX, sp.endZ);
  const b = await screenOf(page, sp.endX + 330, sp.endZ + 6);
  await page.mouse.move(a.x, a.y);
  await page.mouse.click(a.x, a.y);
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await frames(page, 3);
  await shot(page, '03-road-preview');
  await page.mouse.click(b.x, b.y);
  const segs1 = await game<number>(page, 'return g.city.roads.segments.size;');
  expect(segs1).toBeGreaterThan(segs0);
  // A finished road doesn't carry on from its end point.
  expect(await game<boolean>(page, 'return g.tools.road.start === null;')).toBe(true);
  // F picks up from that end point again.
  await page.keyboard.press('KeyF');
  expect(await game<boolean>(page, 'const s = g.tools.road.start; return !!s && Math.hypot(s.x - (g.tools.road.lastEnd?.x ?? 0), s.z - (g.tools.road.lastEnd?.z ?? 0)) < 1;')).toBe(true);
  await page.keyboard.press('Escape');
  expect(await game<string>(page, 'return g.tool.id;')).toBe('road');

  // Two cross streets create automatic intersections.
  for (const dx of [110, 230]) {
    const p = await screenOf(page, sp.endX + dx, sp.endZ - 175);
    const q = await screenOf(page, sp.endX + dx, sp.endZ + 105);
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
    await page.mouse.move(q.x, q.y, { steps: 6 });
    await page.mouse.click(q.x, q.y);
  }
  const junctions = await game<number>(page, 'let n = 0; for (const l of g.city.layout.nodes.values()) if (l.kind === "junction" && l.arms.length >= 4) n++; return n;');
  expect(junctions).toBeGreaterThanOrEqual(2);
  await page.keyboard.press('Escape');

  // ── Zone with the fill tool (UI) ──
  await page.locator('.rail-btn[data-cat="zoning"]').click();
  await page.getByRole('button', { name: 'Fill street' }).click();
  const zoneClicks: [number, number][] = [
    [sp.endX + 55, sp.endZ - 30], [sp.endX + 55, sp.endZ + 30], [sp.endX + 170, sp.endZ - 30], [sp.endX + 170, sp.endZ + 30],
    [sp.endX + 125, sp.endZ - 120], [sp.endX + 95, sp.endZ - 120], [sp.endX + 245, sp.endZ - 120], [sp.endX + 215, sp.endZ - 120],
  ];
  for (const [x, z] of zoneClicks) {
    const s = await screenOf(page, x, z);
    await page.mouse.move(s.x, s.y);
    await page.mouse.click(s.x, s.y);
  }
  // Commercial and industrial south of the main street.
  await page.locator('.card', { has: page.locator('.card-title', { hasText: /^Commercial$/ }) }).click();
  for (const [x, z] of [[sp.endX + 125, sp.endZ + 80], [sp.endX + 95, sp.endZ + 80]] as [number, number][]) {
    const s = await screenOf(page, x, z);
    await page.mouse.move(s.x, s.y);
    await page.mouse.click(s.x, s.y);
  }
  await page.locator('.card', { has: page.locator('.card-title', { hasText: /^Industrial$/ }) }).click();
  for (const [x, z] of [[sp.endX + 290, sp.endZ + 30], [sp.endX + 245, sp.endZ + 80]] as [number, number][]) {
    const s = await screenOf(page, x, z);
    await page.mouse.move(s.x, s.y);
    await page.mouse.click(s.x, s.y);
  }
  await frames(page, 4);
  await shot(page, '04-zoned');
  const zoned = await game<number>(page, 'return g.city.zones.countZoned(1) + g.city.zones.countZoned(4) + g.city.zones.countZoned(6);');
  expect(zoned).toBeGreaterThan(500);
  await page.keyboard.press('Escape');

  // ── Utilities through the UI ──
  await page.locator('.rail-btn[data-cat="utilities"]').click();
  await page.locator('.card', { hasText: 'Wind Turbine' }).click();
  for (const dx of [20, 40, 300]) {
    const s = await screenOf(page, sp.endX + dx, sp.endZ - 26);
    await page.mouse.move(s.x, s.y);
    await page.mouse.click(s.x, s.y);
  }
  await page.locator('.card', { hasText: 'Water Tower' }).click();
  const wt = await screenOf(page, sp.endX + 320, sp.endZ + 26);
  await page.mouse.move(wt.x, wt.y);
  await page.mouse.click(wt.x, wt.y);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // Sewage needs a shoreline on this map; place a treatment plant for the test.
  const services = await game<number>(page, `
    g.city.peakPopulation = 2500;
    const r = C.placeService(g.city, 'treatment_plant', ${sp.endX + 175}, ${sp.endZ + 30});
    g.city.peakPopulation = 0;
    let n = 0; for (const b of g.city.buildings.all.values()) if (b.kind === 'service') n++; return n;`);
  expect(services).toBeGreaterThanOrEqual(5);

  // ── Let the city grow ──
  await game(page, 'm.fastForward(g.city, 24 * 24); g.setSpeed(3);');
  await page.waitForTimeout(6000);
  await frames(page, 10);
  const grown = await game<{ buildings: number; pop: number; vehicles: number; money: number; jobs: number }>(page, 'return { buildings: g.city.buildings.count, pop: g.city.population.residents, vehicles: g.city.vehicles.count, money: g.city.economy.money, jobs: g.city.stats.jobs };');
  console.log('grown', grown);
  expect(grown.buildings).toBeGreaterThan(15);
  expect(grown.pop).toBeGreaterThan(50);
  expect(grown.vehicles).toBeGreaterThan(0);
  await shot(page, '05-grown');
  await game(page, `const sp = g.city.terrain.spawn; g.cam.jumpTo({ x: sp.endX + 160, z: sp.endZ - 40, distance: 190, pitch: 0.7, yaw: 0.45 }); g.hour = 11;`);
  await frames(page, 8);
  await shot(page, '06-street-level');
  await game(page, 'g.hour = 21.5; g.env.updateEnvironmentMap(true);');
  await frames(page, 8);
  await shot(page, '07-night');
  await game(page, 'g.hour = 11; g.env.updateEnvironmentMap(true);');

  // ── Overlays and inspection ──
  await game(page, `const sp = g.city.terrain.spawn; g.cam.jumpTo({ x: sp.endX + 165, z: sp.endZ + 20, distance: 640, pitch: 1.4, yaw: Math.PI / 2 }); g.setSpeed(0);`);
  await frames(page, 4);
  await page.keyboard.press('Tab');
  await frames(page, 4);
  await expect(page.locator('.legend-box')).toBeVisible();
  await shot(page, '08-traffic-overlay');
  await game(page, "g.setOverlay('landValue');");
  await frames(page, 4);
  await shot(page, '09-landvalue-overlay');
  await game(page, "g.setOverlay('none');");
  const bpos = await game<{ x: number; z: number }>(page, 'const b = [...g.city.buildings.all.values()].find(b => b.kind === "zoned" && b.progress >= 1); return { x: b.cx, z: b.cz };');
  const bs = await screenOf(page, bpos.x, bpos.z);
  await page.mouse.move(bs.x, bs.y);
  await page.mouse.click(bs.x, bs.y);
  await expect(page.locator('.inspector')).toBeVisible();
  await shot(page, '10-inspector');
  await page.keyboard.press('Escape');

  // ── Save through Ctrl+S ──
  await page.keyboard.press('Control+s');
  // The bottom-right indicator shows the save happening, then confirms it.
  await expect(page.locator('.save-status.show')).toContainText('Saving. . .');
  await expect(page.locator('.save-status.show')).toContainText('Saved', { timeout: 20_000 });
  const before = await game<{ segs: number; buildings: number; pop: number; tick: number; money: number }>(page, 'return { segs: g.city.roads.segments.size, buildings: g.city.buildings.count, pop: g.city.population.residents, tick: g.city.clock.tick, money: Math.round(g.city.economy.money) };');

  // ── Reload and continue ──
  await page.reload();
  await expect(page.locator('.main-menu')).toBeVisible({ timeout: 90_000 });
  // Play lists every city at its latest save.
  await page.locator('.menu-btn', { hasText: 'Play' }).click();
  const card = page.locator('.slot', { hasText: 'E2E Harbor' });
  await expect(card).toHaveCount(1);
  await card.locator('.btn', { hasText: 'Play' }).click();
  await page.waitForFunction(() => (window as any).__meridian.game.state === 'playing', null, { timeout: 60_000 });
  const after = await game<{ segs: number; buildings: number; pop: number; tick: number; money: number; name: string }>(page, 'g.setSpeed(0); return { segs: g.city.roads.segments.size, buildings: g.city.buildings.count, pop: g.city.population.residents, tick: g.city.clock.tick, money: Math.round(g.city.economy.money), name: g.city.name };');
  expect(after.name).toBe('E2E Harbor');
  expect(after.segs).toBe(before.segs);
  expect(after.buildings).toBe(before.buildings);
  expect(after.pop).toBe(before.pop);
  expect(after.tick).toBe(before.tick);
  expect(Math.abs(after.money - before.money)).toBeLessThan(2);
  await frames(page, 8);
  await shot(page, '11-reloaded');

  // Continue building after load.
  await game(page, `const sp = g.city.terrain.spawn; g.cam.jumpTo({ x: sp.endX + 165, z: sp.endZ + 20, distance: 640, pitch: 1.4, yaw: Math.PI / 2 });`);
  await frames(page, 4);
  await page.locator('.rail-btn[data-cat="roads"]').click();
  const p = await screenOf(page, sp.endX + 330, sp.endZ + 6);
  const q = await screenOf(page, sp.endX + 330, sp.endZ + 100);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await page.mouse.move(q.x, q.y, { steps: 6 });
  await page.mouse.click(q.x, q.y);
  const segs2 = await game<number>(page, 'return g.city.roads.segments.size;');
  expect(segs2).toBeGreaterThan(after.segs);

  expect(errors.filter((e) => !e.includes('X4122'))).toEqual([]);
});
