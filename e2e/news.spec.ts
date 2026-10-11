import { expect, test } from '@playwright/test';
import { boot, frames, game, shot, trackErrors } from './helpers';

test('newspaper: monthly edition, toast, back issues, map links', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await game(page, `g.ui.hideMenu(); g.state = 'playing'; g.ui.showHud(); g.settings.tutorial = false; g.setSpeed(0); g.hour = 15;
    const s = g.city.startPoint; g.cam.jumpTo({ x: s.x + 150, z: s.z, distance: 520, pitch: 0.8, yaw: 1.2 });`);
  // Before any edition the paper explains when it comes out.
  await page.keyboard.press('KeyN');
  await expect(page.locator('.np-empty')).toBeVisible();
  await page.keyboard.press('Escape');
  // Two months of news: the second has a tax rise, a fire and a new landmark.
  const fire = await game<{ x: number; z: number }>(page, `const c = g.city;
    c.news.publish();
    c.economy.taxes.commercial += 3;
    const b = [...c.buildings.all.values()].find((q) => q.kind === 'zoned');
    c.news.fireLost(c.roads.segments.get(b.segId)?.name ?? 'Main Street', b.cx, b.cz);
    c.news.opened('city_hall', b.cx + 60, b.cz);
    c.clock.tick += 24 * 30;
    c.news.publish();
    return { x: b.cx, z: b.cz };`);
  const toast = page.locator('.toast', { hasText: 'City Hall opens its doors' });
  await expect(toast).toBeVisible();
  await frames(page, 3);
  await toast.click();
  await expect(page.locator('.np-sheet')).toBeVisible();
  await expect(page.locator('.np-story.lead h3')).toHaveText('City Hall opens its doors');
  await expect(page.locator('.np-cols .np-story')).toHaveCount(3);
  await expect(page.locator('.np-mast')).toHaveText(/^The .+ (Gazette|Courier|Herald|Times)$/);
  await expect(page.locator('.np-story h3', { hasText: 'Council raises commercial tax' })).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, 'newspaper');
  // Back issues.
  await page.getByRole('button', { name: '‹ Older' }).click();
  await expect(page.locator('.np-nav')).toContainText('1 edition back');
  await expect(page.getByRole('button', { name: '‹ Older' })).toBeDisabled();
  await page.getByRole('button', { name: 'Newer ›' }).click();
  // A story with a place flies the camera there.
  await page.locator('.np-story', { hasText: 'Fire destroys' }).locator('.np-map').click();
  await expect(page.locator('.np-sheet')).toBeHidden();
  await page.waitForTimeout(1200);
  const cam = await game<{ x: number; z: number }>(page, 'return { x: g.cam.goal.x, z: g.cam.goal.z };');
  expect(Math.hypot(cam.x - fire.x, cam.z - fire.z)).toBeLessThan(30);
  expect(errors).toEqual([]);
});

test('newspaper on a phone', async ({ page }) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await game(page, `g.ui.hideMenu(); g.state = 'playing'; g.ui.showHud(); g.settings.tutorial = false; g.setSpeed(0);
    g.city.news.publish(); g.city.clock.tick += 24 * 30; g.city.news.publish(); g.ui.newspaper.open();`);
  await expect(page.locator('.np-sheet')).toBeVisible();
  const box = (await page.locator('.np-sheet').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await expect(page.locator('.loading')).toBeHidden();
  await page.waitForTimeout(500);
  await shot(page, 'newspaper-phone');
  expect(errors).toEqual([]);
});
