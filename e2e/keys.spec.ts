import { expect, test } from '@playwright/test';
import { boot, game } from './helpers';

test('Esc closes windows after using a control; typing in a text box takes no shortcuts', async ({ page }) => {
  await boot(page);
  await game(page, `g.ui.hideMenu(); g.state = 'playing'; g.ui.showHud(); g.settings.tutorial = false; g.ui.settings.open();`);
  const settings = page.locator('.modal').filter({ has: page.locator('.modal-title', { hasText: /^Settings$/ }) });
  await expect(settings).toBeVisible({ timeout: 10_000 });
  // A checkbox has focus: Esc still closes the window.
  await page.locator('.set-row', { hasText: 'Show FPS' }).locator('input').check();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await game(page, `g.settings.showFps = false; g.applySettings();`);
  // In the Design Studio's text box, number keys are text, not tools.
  await game(page, `g.ui.studio.open();`);
  const text = page.locator('.ds-text');
  await text.click();
  await page.keyboard.type('2 storeys');
  await expect(text).toHaveValue(/2 storeys/);
  expect(await game<string>(page, `return g.ui.toolbar.active ?? g.tool.constructor.name;`)).not.toMatch(/road/i);
  await page.keyboard.press('Escape');
  await expect(page.locator('.design-modal')).toBeHidden();
});
