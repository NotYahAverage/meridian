import { expect, test } from '@playwright/test';
import { boot, frames, game, shot, trackErrors } from './helpers';

test('scenarios: pick one, play it, win it', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await game(page, `g.settings.scenariosWon = [];`);
  await page.getByRole('button', { name: 'Scenarios' }).click();
  await expect(page.locator('.scn-card')).toHaveCount(5);
  await page.locator('.scn-card', { hasText: 'Across the River' }).click();
  await expect(page.locator('.scn-detail .scn-title')).toHaveText('Across the River');
  await expect(page.locator('.scn-objs li')).toHaveCount(3);
  await shot(page, 'scenarios-dialog');
  await page.getByRole('button', { name: 'Start scenario' }).click();
  await page.waitForFunction(() => (window as any).__meridian.game.state === 'playing', null, { timeout: 60_000 });
  const st = await game<{ id: string; preset: string; money: number; name: string }>(page, `return { id: g.city.scenario.id, preset: g.city.terrain.preset, money: g.city.economy.money, name: g.city.name };`);
  console.log('SCENARIO', JSON.stringify(st));
  expect(st).toMatchObject({ id: 'across-the-river', preset: 'river', money: 280_000, name: 'Across the River' });
  // Countdown chip in the top bar and the objectives card in the goals panel.
  await expect(page.locator('.tb-scenario')).toBeVisible();
  await expect(page.locator('.tb-scenario')).toHaveText('0/3 · 5 years left');
  await expect(page.locator('.scn-panel .scn-obj')).toHaveCount(3);
  await game(page, `g.setSpeed(0); g.hour = 10.5;`);
  await frames(page, 4);
  await shot(page, 'scenarios-playing');
  // Winning pauses the game and shows the verdict.
  await game(page, `g.setSpeed(1); g.city.scenario.result = 'won'; g.city.events.emit('scenario', { id: 'across-the-river', result: 'won' });`);
  await expect(page.locator('.scn-headline')).toHaveText('Scenario complete!');
  expect(await game<number>(page, 'return g.speed;')).toBe(0);
  expect(await game<string[]>(page, 'return g.settings.scenariosWon;')).toEqual(['across-the-river']);
  await page.waitForTimeout(500);
  await shot(page, 'scenarios-won');
  await page.getByRole('button', { name: 'Keep building' }).click();
  await expect(page.locator('.scn-result')).toBeHidden();
  expect(await game<number>(page, 'return g.speed;')).toBe(1);
  await page.waitForTimeout(1100);
  await expect(page.locator('.tb-scenario')).toHaveText('Scenario complete');
  // The menu remembers the win.
  await game(page, `await g.toMenu();`);
  await page.getByRole('button', { name: 'Scenarios' }).click();
  await expect(page.locator('.scn-card', { hasText: 'Across the River' }).locator('.scn-won')).toBeVisible();
  await expect(page.locator('.scn-card', { hasText: 'First Steps' }).locator('.scn-won')).toHaveCount(0);
  await game(page, `g.settings.scenariosWon = [];`);
  expect(errors).toEqual([]);
});
