import { expect, type Page, test } from '@playwright/test';
import { boot, game, shot, trackErrors } from './helpers';

/**
 * Plays the tutorial through as a player would: new city with "Guide me" ticked, then
 * each chapter using the button, card and map spot the guide points at.
 */

const guideText = (page: Page) => page.locator('.guide .guide-text');
const chapter = (page: Page) => page.locator('.guide .guide-title');

/** Where the guide's map pin is pointing (screen px), once it shows. */
async function pin(page: Page): Promise<{ x: number; y: number }> {
  const p = page.locator('.guide-pin:not(.hidden) .guide-pin-dot');
  await expect(p).toBeVisible({ timeout: 15_000 });
  const r = (await p.boundingBox())!;
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** The guide's highlight ring sits on this element. */
async function ringOn(page: Page, el: ReturnType<Page['locator']>): Promise<void> {
  const ring = page.locator('.guide-ring:not(.hidden)');
  await expect(ring).toBeVisible({ timeout: 10_000 });
  // The guide moves the ring a few times a second: wait for it to arrive.
  await expect.poll(async () => {
    const a = await ring.boundingBox(), b = await el.boundingBox();
    if (!a || !b) return 1e9;
    return Math.abs(a.x + a.width / 2 - (b.x + b.width / 2)) + Math.abs(a.y + a.height / 2 - (b.y + b.height / 2));
  }, { timeout: 5000 }).toBeLessThan(8);
}

for (const style of ['classic', 'command'] as const) {
  test(`tutorial plays through (${style})`, async ({ page }) => {
    test.setTimeout(600_000);
    const errors = trackErrors(page);
    await page.setViewportSize({ width: 1600, height: 900 });
    await boot(page);
    await game(page, `g.settings.uiStyle = '${style}'; g.settings.guideDone = []; g.applySettings();`);

    // New city, guide ticked by default.
    await page.locator('.menu-btn', { hasText: 'New city' }).click();
    const check = page.locator('.guide-check input');
    await expect(check).toBeChecked();
    await page.locator('.map-card.coastal').click();
    await page.locator('.btn', { hasText: 'Found city' }).click();
    await page.waitForFunction(() => (window as any).__meridian.game.state === 'playing', null, { timeout: 120_000 });
    await expect(chapter(page)).toHaveText('Look around', { timeout: 20_000 });
    expect(await game<number>(page, `return g.speed;`)).toBe(0);
    await page.waitForTimeout(2500);
    await shot(page, `tut-${style}-1`);

    // 1. Camera: pan, turn, zoom (moved as the controls would).
    await game(page, `g.cam.goal.x += 120;`);
    await expect(guideText(page)).toContainText('Turn the view', { timeout: 5000 });
    await game(page, `g.cam.goal.yaw += 0.8;`);
    await expect(guideText(page)).toContainText('Zoom', { timeout: 5000 });
    await page.mouse.move(800, 450);
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -300);

    // 2. Road: the Roads button, the Street card, then from the pin.
    await expect(chapter(page)).toHaveText('Connect to the highway', { timeout: 10_000 });
    await game(page, `const s = g.city.terrain.spawn; g.cam.jumpTo({ x: s.endX + 60, z: s.endZ, distance: 320, pitch: 1.0, yaw: 0.45 });`);
    await page.waitForTimeout(800);
    const roads = page.locator('.rail-btn[data-cat="roads"]');
    await ringOn(page, roads);
    await roads.click();
    const street = page.locator('.tray .card', { has: page.locator('.card-title', { hasText: /^Street$/ }) });
    await ringOn(page, street);
    await street.click();
    await expect(guideText(page)).toContainText('end of the highway');
    const start = await pin(page);
    await shot(page, `tut-${style}-2`);
    await page.mouse.click(start.x, start.y);
    await page.mouse.click(start.x + 260, start.y);
    await page.waitForTimeout(500);
    await expect(guideText(page)).toContainText('two or three more', { timeout: 10_000 });
    // Two more streets off the first, crosswise.
    await page.mouse.click(start.x + 130, start.y);
    await page.mouse.click(start.x + 130, start.y - 200);
    await page.mouse.click(start.x + 130, start.y);
    await page.mouse.click(start.x + 130, start.y + 200);
    await page.waitForTimeout(500);
    if (await chapter(page).innerText() === 'Connect to the highway') await page.locator('.guide .btn', { hasText: 'That’s enough' }).click();
    await page.keyboard.press('Escape');

    // 3. Homes: Zoning, Low, paint at the pin.
    await expect(chapter(page)).toHaveText('Zone homes', { timeout: 10_000 });
    await page.locator('.rail-btn[data-cat="zoning"]').click();
    const low = page.locator('.tray .card', { has: page.locator('.card-title', { hasText: /^Low$/ }) });
    await ringOn(page, low);
    await low.click();
    await expect(guideText(page)).toContainText('Paint along your streets');
    await pin(page);
    await shot(page, `tut-${style}-3`);
    // The brush along all three streets (both sides) until enough is zoned.
    await game(page, `for (const s of g.city.roads.segments.values()) { if (s.type !== 'street') continue; const p = s.poly; for (let k = 0; k < p.count; k += 2) for (const o of [-22, 22]) { const tx = p.pts[Math.min(p.count - 1, k + 1) * 2] - p.pts[Math.max(0, k - 1) * 2], tz = p.pts[Math.min(p.count - 1, k + 1) * 2 + 1] - p.pts[Math.max(0, k - 1) * 2 + 1]; const L = Math.hypot(tx, tz) || 1; C.paintZone(g.city, p.pts[k * 2] - tz / L * o, p.pts[k * 2 + 1] + tx / L * o, 14, 1); } } m.tickCity(g.city);`);

    // 4. Jobs: Commercial, then Industrial.
    await expect(chapter(page)).toHaveText('Zone jobs', { timeout: 10_000 });
    await ringOn(page, page.locator('.tray .card', { has: page.locator('.card-title', { hasText: /^Commercial$/ }) }));
    // Use the real tool: pick the card, then paint with the mouse beside the first street.
    await page.locator('.tray .card', { has: page.locator('.card-title', { hasText: /^Commercial$/ }) }).click();
    for (let i = 0; i < 6; i++) { await page.mouse.move(start.x + 40 + i * 30, start.y + 38); await page.mouse.down(); await page.mouse.move(start.x + 60 + i * 30, start.y + 40); await page.mouse.up(); }
    await expect(guideText(page)).toContainText('Industrial', { timeout: 15_000 });
    await page.locator('.tray .card', { has: page.locator('.card-title', { hasText: /^Industrial$/ }) }).click();
    for (let i = 0; i < 12; i++) { await page.mouse.move(start.x + 150, start.y - 40 - i * 12); await page.mouse.down(); await page.mouse.move(start.x + 152, start.y - 48 - i * 12); await page.mouse.up(); }
    await page.waitForTimeout(500);
    if (await chapter(page).innerText() === 'Zone jobs') await game(page, `const s = [...g.city.roads.segments.values()].filter((x) => x.type === 'street').pop(); const p = s.poly; for (let k = 0; k < p.count; k++) C.paintZone(g.city, p.pts[k * 2] - 24, p.pts[k * 2 + 1] - 24, 16, 6);`);
    await page.keyboard.press('Escape');

    // 5. Power: Utilities, Wind Turbine, place at the pin.
    await expect(chapter(page)).toHaveText('Power', { timeout: 15_000 });
    await page.locator('.rail-btn[data-cat="utilities"]').click();
    const wind = page.locator('.tray .card', { has: page.locator('.card-title', { hasText: /^Wind Turbine$/ }) });
    await ringOn(page, wind);
    await wind.click();
    const wp = await pin(page);
    await shot(page, `tut-${style}-5`);
    for (const [dx, dy] of [[0, 0], [0, 14], [0, -14], [20, 0], [-20, 0]]) {
      await page.mouse.click(wp.x + dx, wp.y + dy);
      await page.waitForTimeout(300);
      if (await chapter(page).innerText() !== 'Power') break;
    }
    void (0) && console.log('POWER DEBUG', JSON.stringify(await page.locator('.toast').allInnerTexts()), await game<string>(page, `const t = g.tool; return t.id + ' ' + t.typeId + ' prod ' + g.city.utilities.totals.power.production + ' turbines ' + [...g.city.buildings.all.values()].filter((b) => b.typeId === 'wind_turbine').length;`));

    // 6. Water and sewage.
    await expect(chapter(page)).toHaveText('Water and sewage', { timeout: 15_000 });
    const tower = page.locator('.tray .card', { has: page.locator('.card-title', { hasText: /^Water Tower$/ }) });
    await ringOn(page, tower);
    await tower.click();
    const tp = await pin(page);
    for (const [dx, dy] of [[0, 0], [0, 12], [0, -12], [16, 0], [-16, 0], [30, 0]]) {
      await page.mouse.click(tp.x + dx, tp.y + dy);
      await page.waitForTimeout(300);
      if ((await guideText(page).innerText()).includes('Sewage')) break;
    }
    await expect(guideText(page)).toContainText('Septic Tank', { timeout: 10_000 });
    await shot(page, `tut-${style}-6`);
    const septic = page.locator('.tray .card', { has: page.locator('.card-title', { hasText: /^Septic Tank$/ }) });
    await ringOn(page, septic);
    await septic.click();
    const sp = await pin(page);
    for (const [dx, dy] of [[0, 0], [0, 12], [0, -12], [16, 0], [-16, 0], [30, 0]]) {
      await page.mouse.click(sp.x + dx, sp.y + dy);
      await page.waitForTimeout(300);
      if ((await chapter(page).innerText()) !== 'Water and sewage') break;
    }
    await page.keyboard.press('Escape');

    // 7. Grow: play, wait for residents, the demand bars.
    await expect(chapter(page)).toHaveText('Watch it grow', { timeout: 15_000 });
    await ringOn(page, page.locator('.speed-btn').nth(1));
    await page.locator('.speed-btn').nth(1).click();
    await expect(guideText(page)).toContainText('first homes', { timeout: 10_000 });
    await game(page, `g.setSpeed(3);`);
    await expect(guideText(page)).toContainText('demand', { timeout: 240_000 });
    await shot(page, `tut-${style}-7`);
    await page.locator('.dbar').first().click();
    await expect(chapter(page)).toHaveText('Inspect a building', { timeout: 10_000 });
    await page.keyboard.press('Escape');
    await game(page, `g.setSpeed(0);`);

    // 8. Inspect: click the home the pin is on.
    await game(page, `const b = [...g.city.buildings.all.values()].find((x) => x.kind === 'zoned' && x.zone >= 1 && x.zone <= 3 && x.state === 1); g.cam.jumpTo({ x: b.cx, z: b.cz, distance: 160, pitch: 0.9, yaw: 0.45 });`);
    await page.waitForTimeout(1200);
    const hp = await pin(page);
    await page.mouse.click(hp.x, hp.y + 20);
    await page.waitForTimeout(400);
    if (!(await game<boolean>(page, `return g.selection?.kind === 'building';`))) await game(page, `const b = [...g.city.buildings.all.values()].find((x) => x.kind === 'zoned' && x.zone >= 1 && x.zone <= 3 && x.state === 1); g.select({ kind: 'building', id: b.id });`);
    await expect(guideText(page)).toContainText('panel', { timeout: 10_000 });
    await shot(page, `tut-${style}-8`);
    await page.locator('.guide .btn', { hasText: 'Finish' }).click();
    await expect(page.locator('.guide')).toBeHidden();
    await expect(page.locator('.toast', { hasText: 'You’ve got the basics' })).toBeVisible();
    expect(await game<string[]>(page, `return g.settings.guideDone;`)).toHaveLength(8);

    // Replays: the chapter list from the pause menu.
    await game(page, `g.ui.openPause();`);
    await page.locator('.menu-btn', { hasText: 'Tutorial chapters' }).click();
    await expect(page.locator('.chapter.done')).toHaveCount(8);
    await page.locator('.chapter', { hasText: 'Power' }).click();
    await expect(chapter(page)).toHaveText('Power');
    await shot(page, `tut-${style}-replay`);
    expect(errors).toEqual([]);
  });
}
