import { expect, test } from '@playwright/test';
import { boot, game, trackErrors } from './helpers';
test('interface style switch in settings', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await game(page, `g.ui.settings.open();`);
  const sel = page.locator('.set-row', { hasText: 'Interface style' }).locator('select');
  await expect(sel).toHaveValue('classic');
  expect(await page.evaluate(() => document.documentElement.dataset.ui)).toBe('classic');
  await sel.selectOption('command');
  expect(await page.evaluate(() => document.documentElement.dataset.ui)).toBe('command');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /setting/i.test(k))!)!).uiStyle)).toBe('command');
  // Survives a reload.
  await page.reload();
  await page.waitForFunction(() => (window as any).__meridian?.game);
  expect(await page.evaluate(() => document.documentElement.dataset.ui)).toBe('command');
  await game(page, `g.ui.settings.open();`);
  await page.locator('.set-row', { hasText: 'Interface style' }).locator('select').selectOption('classic');
  expect(await page.evaluate(() => document.documentElement.dataset.ui)).toBe('classic');
  console.log('ERRORS', JSON.stringify(errors));
});
