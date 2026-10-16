import { expect, test } from '@playwright/test';
import { boot, game, shot, trackErrors } from './helpers';

/**
 * How people get around, through the interface: a parkway (no sidewalks)
 * keeps homes and jobs apart on foot until a street crosses it at the lights.
 * The Getting around tab, the Commutes layer and a home's inspector show it.
 */
test('getting around: a crossing lets people walk to work', async ({ page }) => {
  test.setTimeout(400_000);
  page.setDefaultTimeout(30_000);
  const errors = trackErrors(page);
  await boot(page);
  const before = await game<{ walk: number; car: number }>(page, `
    await g.startNewCity({ name: 'Divide', seed: 11, preset: 'lakes', unlimited: false });
    g.settings.tutorial = false; g.setSpeed(0);
    const city = g.city;
    city.economy.money = 9_000_000;
    city.peakPopulation = 3000;
    const sp = city.terrain.spawn;
    const x = sp.endX, z = sp.endZ;
    const road = (ax, az, bx, bz, t = 'street') => {
      const r = C.buildRoad(city, C.previewRoad(city, t, C.snap(city, ax, az, t), C.snap(city, bx, bz, t), null));
      if (!r.ok) throw new Error(t + ' ' + r.error);
    };
    road(x, z, x + 700, z, 'avenue');
    road(x + 60, z + 130, x + 680, z + 130, 'parkway');
    road(x + 640, z, x + 640, z + 130);
    road(x + 150, z + 130, x + 150, z + 260);
    road(x + 150, z + 260, x + 600, z + 260);
    for (const [id, dx, dz] of [['wind_turbine', 20, -24], ['wind_turbine', 70, -24], ['wind_turbine', 120, -24], ['water_tower', 170, -30], ['treatment_plant', 560, -30]]) {
      const r = C.placeService(city, id, x + dx, z + dz);
      if (!r.ok) throw new Error(id + ': ' + r.error);
    }
    city.peakPopulation = 0;
    for (const dx of [220, 320, 420, 520]) C.fillZone(city, x + dx, z + 45, 2);
    for (const dx of [250, 350, 450, 550]) { C.fillZone(city, x + dx, z + 225, 5); C.fillZone(city, x + dx, z + 295, 4); }
    window.__meridian.fastForward(city, 24 * 90);
    city.mobility.runNow();
    window.__p = { x, z };
    return { walk: city.mobility.stats.walk, car: city.mobility.stats.car };`);
  expect(before.car).toBeGreaterThan(0.6);

  // The Getting around tab.
  await game(page, `g.ui.closePanel(); g.select(null); g.ui.openPanel('stats');`);
  await page.locator('.tab', { hasText: 'Getting around' }).click();
  await expect(page.locator('.mode-bar')).toBeVisible();
  await expect(page.locator('.panel:visible')).toContainText('Average commute');
  await expect(page.locator('.panel:visible')).toContainText('Shopping trips');

  // A street across the parkway at the lights: people can walk to work now.
  const after = await game<{ walk: number; car: number }>(page, `
    g.ui.closePanel();
    const city = g.city, { x, z } = window.__p;
    const r = C.buildRoad(city, C.previewRoad(city, 'street', C.snap(city, x + 400, z, 'street'), C.snap(city, x + 400, z + 260, 'street'), null));
    if (!r.ok) throw new Error(r.error);
    window.__meridian.fastForward(city, 24 * 3);
    city.mobility.runNow();
    return { walk: city.mobility.stats.walk, car: city.mobility.stats.car };`);
  expect(after.walk).toBeGreaterThan(before.walk + 0.1);
  expect(after.car).toBeLessThan(before.car - 0.1);

  // The Commutes layer tints homes; a home's inspector says how its people get to work.
  await page.keyboard.press('KeyL');
  await page.locator('.layer-row[data-layer="commute"]').click();
  expect(await game<string>(page, 'return g.world.overlays.mode;')).toBe('commute');
  const tinted = await game<number>(page, `
    const f = g.world.buildings.overlayValue; let n = 0;
    for (const b of g.city.buildings.all.values()) if (f && f(b) > 0) n++;
    return n;`);
  expect(tinted).toBeGreaterThan(3);
  await page.locator('.layer-row[data-layer="commute"]').click();
  await game(page, `
    const city = g.city;
    const home = [...city.buildings.all.values()].find((b) => b.zone === 2 && b.state === 1 && city.mobility.commuteOf(b) !== null);
    g.select({ kind: 'building', id: home.id });`);
  await expect(page.locator('.inspector')).toContainText('Commute');
  await expect(page.locator('.inspector')).toContainText('Getting to work');
  await shot(page, 'mobility-inspector');
  expect(errors).toEqual([]);
});
