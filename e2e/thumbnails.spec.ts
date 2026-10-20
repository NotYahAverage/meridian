import { test, expect } from '@playwright/test';
import { boot, game } from './helpers';

test('building previews are drawn (not blank)', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  await boot(page);
  await game(page, `g.ui.hideMenu(); g.state = 'playing'; g.ui.showHud(); g.settings.tutorial = false; g.setSpeed(1); g.city.peakPopulation = 200000;`);
  await page.waitForFunction(() => (window as any).__meridian.game.thumbs.pending === 0, null, { timeout: 90_000 });
  // Every preview image has some drawn (non-transparent) pixels.
  const blank = await page.evaluate(async () => {
    const t = (window as any).__meridian.game.thumbs;
    const out: string[] = [];
    for (const [k, url] of t.cache as Map<string, string>) {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let seen = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 40) seen++;
      if (seen < 200) out.push(k);
    }
    return out;
  });
  expect(blank).toEqual([]);
});
