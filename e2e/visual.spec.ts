import { test } from '@playwright/test';
import { boot, frames, game, shot } from './helpers';

/** Captures reference screenshots of the demo town for visual review. */
test('visual tour of the demo town', async ({ page }) => {
  await boot(page);
  await game(page, `g.ui.hideMenu(); g.state = 'playing'; g.ui.showHud(); g.setSpeed(1);`);
  const views: [string, string][] = [
    ['v1-aerial', 'x: s.x + 200, z: s.z, distance: 900, pitch: 1.0, yaw: 0.45'],
    ['v2-neighbourhood', 'x: s.x + 220, z: s.z - 120, distance: 260, pitch: 0.62, yaw: 0.9'],
    ['v3-downtown', 'x: s.x + 300, z: s.z + 40, distance: 200, pitch: 0.5, yaw: 0.2'],
    ['v4-street', 'x: s.x + 250, z: s.z, distance: 60, pitch: 0.35, yaw: 0.6'],
    ['v5-industry', 'x: s.x + 380, z: s.z + 220, distance: 260, pitch: 0.7, yaw: 1.2'],
  ];
  for (const [name, cam] of views) {
    await game(page, `const s = g.city.startPoint; g.cam.jumpTo({ ${cam} }); g.hour = 10.5; g.env.updateEnvironmentMap(true);`);
    await page.waitForTimeout(1200);
    await frames(page, 6);
    await shot(page, name);
  }
  await game(page, `const s = g.city.startPoint; g.cam.jumpTo({ x: s.x + 220, z: s.z - 60, distance: 420, pitch: 0.7, yaw: 0.45 }); g.hour = 18.4; g.env.updateEnvironmentMap(true);`);
  await page.waitForTimeout(800);
  await shot(page, 'v6-dusk');
  await game(page, `g.hour = 22; g.env.updateEnvironmentMap(true);`);
  await page.waitForTimeout(800);
  await shot(page, 'v7-night');
  await game(page, `g.hour = 11; g.env.updateEnvironmentMap(true); g.ui.toolbar.select('zoning');`);
  await page.waitForTimeout(600);
  await page.mouse.move(800, 420);
  await frames(page, 4);
  await shot(page, 'v8-zoning');
  await page.keyboard.press('Escape');
});
