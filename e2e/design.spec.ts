import { expect, test } from '@playwright/test';
import { boot, frames, game, shot, trackErrors } from './helpers';

/**
 * The Design Studio through the interface: type a description, see what the
 * architects understood (with locked ideas greyed out), adjust the chips, turn
 * the preview, save the design to the sketchbook and browse the ideas.
 */
test('design studio: type a building, adjust it, preview it and save it', async ({ page }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(30_000);
  const errors = trackErrors(page);
  await boot(page);
  await game(page, `
    await g.startNewCity({ name: 'Draughts', seed: 7, preset: 'lakes', unlimited: false });
    g.settings.tutorial = false; g.setSpeed(0);`);
  // A new city knows only the basics: concrete and towers are locked.
  await page.locator('.rail-btn[data-cat="design"]').click();
  await expect(page.locator('.design-modal')).toBeVisible();
  const text = page.locator('.ds-text');
  await text.pressSequentially('a tall concrete tower with gardens on every floor', { delay: 15 });
  await expect(page.locator('.ds-chip.locked', { hasText: 'Raw concrete' })).toBeVisible();
  await expect(page.locator('.ds-chip.locked', { hasText: 'Tower' })).toBeVisible();
  await expect(page.locator('.ds-note').first()).toContainText('can’t build towers yet');
  await page.waitForTimeout(1500);
  await shot(page, 'design-locked');

  // Teach everything, as a long-lived city would have learned it.
  await game(page, `const D = await import('/src/sim/design/Ideas.ts'); for (const i of D.IDEAS) g.city.design.learn(i.id);`);
  await text.fill('');
  await text.pressSequentially('cheap concrete flats, really tall, with trees on the balconies and shops at the bottom', { delay: 12 });
  for (const label of ['Homes over shops', 'Skyscraper', 'Raw concrete', 'Vertical forest', 'Affordable']) await expect(page.locator('.ds-chip', { hasText: label }).first()).toBeVisible();
  await expect(page.locator('.ds-name')).toHaveValue(/Tower/);
  await expect(page.locator('.ds-img.ready')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(800);
  await shot(page, 'design-tower');

  // Swap concrete for brick, remove the vertical forest, turn the preview.
  await page.locator('.ds-chip', { hasText: 'Raw concrete' }).locator('.ds-swap').selectOption({ label: 'Brick' });
  await expect(page.locator('.ds-chip', { hasText: 'Brick' })).toBeVisible();
  await page.locator('.ds-chip', { hasText: 'Vertical forest' }).locator('.ds-x').click();
  await expect(page.locator('.ds-chip', { hasText: 'Vertical forest' })).toHaveCount(0);
  await page.locator('.ds-turn.right').click();
  await page.locator('.ds-turn.right').click();
  await page.waitForTimeout(1500);
  await shot(page, 'design-swapped');

  // Words it doesn't know, and a typo it can read.
  await text.fill('');
  await text.pressSequentially('a brik cottage with a swimming pool and a mansard roof', { delay: 12 });
  await expect(page.locator('.ds-chip', { hasText: 'Brick' })).toHaveAttribute('data-tip', /brik/);
  await expect(page.locator('.ds-note.warn')).toContainText('Pools');
  await page.waitForTimeout(1200);
  await shot(page, 'design-cottage');

  // Mix by hand: add cards.
  await text.fill('');
  await text.pressSequentially('white timber row houses', { delay: 12 });
  await page.locator('.ds-card', { hasText: 'Green roof' }).click();
  await page.locator('.ds-card', { hasText: 'Ornament' }).click();
  await expect(page.locator('.ds-chip', { hasText: 'Green roof' })).toBeVisible();
  // The earlier concrete → brick swap belonged to that text and doesn't carry over.
  await expect(page.getByRole('button', { name: 'Remove Brick' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove Timber' })).toBeVisible();
  // The preview stays in view, clear of the tabs, all the way down to the sketchbook.
  await page.locator('.design-modal .modal-body').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(100);
  const pic = await page.locator('.ds-pic').boundingBox();
  const tabs = await page.locator('.design-modal .rs-tabs').boundingBox();
  expect(pic!.y).toBeGreaterThanOrEqual(tabs!.y + tabs!.height - 1);
  await page.locator('.design-modal .modal-body').evaluate((el) => (el.scrollTop = 0));
  await page.waitForTimeout(1500);
  await shot(page, 'design-rows');

  // Save it, rename it, and find it in the sketchbook.
  await page.locator('.ds-name').fill('Lakeside Rows');
  await page.locator('.ds-actions .btn.primary').click();
  await expect(page.locator('.ds-sketch', { hasText: 'Lakeside Rows' })).toBeVisible();
  const saved = await game<{ n: number; name: string; kind: string }>(page, `const s = g.city.design.sketches; return { n: s.length, name: s[0].name, kind: s[0].concept.kind };`);
  expect(saved).toEqual({ n: 1, name: 'Lakeside Rows', kind: 'townhouse' });

  // The ideas collection.
  await page.locator('.design-modal .ci-tab', { hasText: 'Ideas' }).click();
  await expect(page.locator('.ds-idea').first()).toBeVisible();
  await shot(page, 'design-ideas');

  // Saved and reloaded, the sketchbook and learned ideas come back.
  const before = await game<string>(page, `return JSON.stringify(g.city.design.serialize());`);
  await game(page, `if (!(await g.save())) throw new Error('save failed'); await g.loadSlot(g.slotId);`);
  await frames(page, 5);
  expect(await game<string>(page, `return JSON.stringify(g.city.design.serialize());`)).toBe(before);
  expect(errors).toEqual([]);
});
