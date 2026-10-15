import { expect, test } from '@playwright/test';
import { boot, frames, game, shot, trackErrors } from './helpers';

/**
 * What to do with a verdict, through the interface: adopt one prototype and
 * watch its style spread through the neighbourhood, refine another and
 * rebuild it on its own lot, and scrap a third.
 */
test('verdicts: adopt a style and watch it spread, refine and rebuild, scrap', async ({ page }) => {
  test.setTimeout(400_000);
  page.setDefaultTimeout(30_000);
  const errors = trackErrors(page);
  await boot(page);
  await game(page, `
    await g.startNewCity({ name: 'Draughts', seed: 7, preset: 'lakes', unlimited: false });
    g.settings.tutorial = false; g.setSpeed(0);
    const city = g.city;
    city.economy.money = 5_000_000;
    const sp = city.terrain.spawn;
    const s = { x: sp.endX, z: sp.endZ };
    const road = (ax, az, bx, bz, t = 'avenue') => C.buildRoad(city, C.previewRoad(city, t, C.snap(city, ax, az, t), C.snap(city, bx, bz, t), null)).ok;
    if (!road(s.x, s.z, s.x + 700, s.z)) throw new Error('road');
    city.peakPopulation = 2500;
    for (const [id, dx, dz] of [['wind_turbine', 20, -24], ['wind_turbine', 70, -24], ['water_tower', 130, -24], ['treatment_plant', 640, -30], ['fire_station', 420, 30]]) {
      const r = C.placeService(city, id, s.x + dx, s.z + dz);
      if (!r.ok) throw new Error(id + ': ' + r.error);
    }
    city.peakPopulation = 0;
    C.fillZone(city, s.x + 300, s.z + 30, 1);
    window.__meridian.fastForward(city, 24 * 100);
    for (const i of window.__meridian.sim.IDEAS) city.design.learn(i.id);
    // Three prototypes on the south side, tested side by side.
    const texts = ['white timber row houses with a green roof and balconies', 'a 12-storey raw concrete tower', 'a brick cottage with a mansard roof'];
    const placed = [];
    let x = s.x + 200;
    for (const t of texts) {
      const sk = city.design.saveSketch({ text: t, added: [], removed: [] });
      let ok = false;
      for (let k = 0; k < 30 && !ok; k++) {
        const r = C.placePrototype(city, sk.id, x + k * 6, s.z - 30);
        if (r.ok) { ok = true; placed.push(r.building.id); x = r.building.cx + sk.concept.w / 2 + 30; }
      }
      if (!ok) throw new Error('could not place ' + t);
    }
    window.__meridian.fastForward(city, 24 * 30 * 7);
    window.__s = s;`);
  const states = await game<string[]>(page, `return g.city.design.trials.map((t) => t.state);`);
  expect(states).toEqual(['done', 'done', 'done']);

  // The choices under each verdict.
  await game(page, `g.ui.studio.open({ tab: 'prototypes', trialId: g.city.design.trials[0].id });`);
  await expect(page.locator('.tr-choices')).toHaveCount(3);
  await page.waitForTimeout(400);
  await shot(page, 'styles-decide');

  // Adopt the rows.
  const rows = page.locator('.tr-card', { hasText: 'Rows' }).first();
  await rows.locator('.tr-choice[data-choice="adopt"]').click();
  const confirm = page.locator('.modal-backdrop:not(.hidden) .btn', { hasText: 'Adopt anyway' });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page.locator('.tr-decided.good')).toBeVisible();
  const st = await game<{ id: number; name: string }>(page, `const s = g.city.design.styles[0]; return { id: s.id, name: s.name };`);
  expect(st.name).toMatch(/style$/);
  await page.locator('.tr-decided.good .btn', { hasText: 'City style' }).click();
  await expect(page.locator('.st-card[data-style]')).toHaveCount(1);
  await expect(page.locator('.st-card[data-style]')).toContainText(st.name);

  // Months pass: it spreads through the houses across the street.
  await game(page, `g.ui.studio.close(); window.__meridian.fastForward(g.city, 24 * 30 * 4);`);
  const spread = await game<{ renovated: number; inStyle: number }>(page, `const s = g.city.design.styles[0]; return { renovated: s.renovated, inStyle: g.city.design.styleCounts().get(s.id) ?? 0 };`);
  expect(spread.renovated).toBeGreaterThan(0);
  await game(page, `g.ui.studio.open({ tab: 'styles' });`);
  await expect(page.locator('.st-stat', { hasText: 'Buildings' }).nth(1)).toContainText(String(spread.inStyle));
  await page.waitForTimeout(400);
  await shot(page, 'styles-tab');
  // Encourage it.
  await page.locator('.st-card[data-style] .rs-seg-btn[data-push="1.5"]').click();
  expect(await game<number>(page, `return g.city.design.styles[0].push;`)).toBe(1.5);
  await page.locator('.st-card[data-style] .btn', { hasText: 'Show on map' }).click();
  await expect(page.locator('.design-modal')).toBeHidden();
  await game(page, `const s = g.city.design.styles[0]; g.cam.jumpTo({ x: s.x + 40, z: s.z + 30, distance: 230, pitch: 0.62 });`);
  await page.waitForTimeout(1800);
  await frames(page, 6);
  await shot(page, 'styles-spread');
  // A renovated house says what style it is in.
  await game(page, `const s = g.city.design.styles[0]; const b = [...g.city.buildings.all.values()].find((x) => x.movement === s.id && x.typeId !== 'proto'); g.select({ kind: 'building', id: b.id });`);
  await expect(page.locator('.inspector', { hasText: st.name }).or(page.locator('.insp-body', { hasText: st.name })).first()).toBeVisible();

  // Refine the tower, and rebuild it on its own lot.
  await game(page, `g.select(null); g.ui.studio.open({ tab: 'prototypes' });`);
  const tower = page.locator('.tr-card', { hasText: 'Tower' }).first();
  await tower.locator('.tr-choice[data-choice="refine"]').click();
  await expect(page.locator('.ds-refine')).toBeVisible();
  await expect(page.locator('.ds-name')).toHaveValue(/ II$/);
  const text = page.locator('.ds-text');
  await text.fill('');
  await text.pressSequentially('a 12-storey timber tower with planted balconies and shops at the bottom', { delay: 6 });
  await expect(page.locator('.ds-chip', { hasText: 'Timber' }).first()).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, 'styles-refine');
  const oldTower = await game<{ id: number; x: number; z: number }>(page, `const t = g.city.design.trials[1]; return { id: t.buildingId, x: t.x, z: t.z };`);
  expect(oldTower.id).toBeGreaterThan(0);
  await page.locator('.ds-rebuild').click();
  await expect(page.locator('.design-modal')).toBeHidden();
  const second = await game<{ parent: number; months: number; ambition: number; x: number; z: number; oldGone: boolean; rev: number }>(page, `
    const d = g.city.design; const t = d.trials[d.trials.length - 1]; const sk = d.sketches.find((k) => k.id === t.sketchId);
    return { parent: t.parent, months: t.months, ambition: t.concept.ambition, x: t.x, z: t.z, oldGone: !g.city.buildings.get(${oldTower.id}), rev: sk.rev };`);
  expect(second.parent).toBe(await game<number>(page, `return g.city.design.trials[1].id;`));
  expect(second.months).toBe(Math.max(1, second.ambition - 1));
  expect(second.oldGone).toBe(true);
  expect(second.rev).toBe(2);
  expect(Math.hypot(second.x - oldTower.x, second.z - oldTower.z)).toBeLessThan(25);

  // Scrap the cottage, and demolish it.
  await game(page, `g.ui.studio.open({ tab: 'prototypes' });`);
  const cottage = page.locator('.tr-card', { hasText: 'House' }).first();
  const cottageId = await game<number>(page, `return g.city.design.trials[2].buildingId;`);
  await cottage.locator('.tr-choice[data-choice="scrap"]').click();
  await page.locator('.modal-backdrop:not(.hidden) [data-choice="demolish"]').click();
  await expect(page.locator('.tr-decided.bad')).toBeVisible();
  expect(await game<boolean>(page, `return !g.city.buildings.get(${cottageId});`)).toBe(true);
  await page.waitForTimeout(300);
  await shot(page, 'styles-decided');

  // All of it survives a save.
  const saved = await game<string>(page, `return JSON.stringify(g.city.design.serialize());`);
  await game(page, `g.ui.studio.close(); if (!(await g.save())) throw new Error('save failed'); await g.loadSlot(g.slotId);`);
  await frames(page, 5);
  expect(await game<string>(page, `return JSON.stringify(g.city.design.serialize());`)).toBe(saved);
  expect(errors).toEqual([]);
});
