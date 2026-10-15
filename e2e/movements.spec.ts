import { expect, test } from '@playwright/test';
import { boot, frames, game, screenOf, shot, trackErrors } from './helpers';

/**
 * Combos, movements and signature landmarks through the interface: a combo
 * found while designing, the combo collection, a movement born from an
 * adopted style, and its signature landmark placed and opened.
 */
test('combos, a movement is born, and its signature landmark', async ({ page }) => {
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
    if (!road(s.x, s.z, s.x + 800, s.z)) throw new Error('road');
    city.peakPopulation = 2500;
    for (const [id, dx, dz] of [['wind_turbine', 20, -24], ['wind_turbine', 70, -24], ['water_tower', 130, -24], ['treatment_plant', 740, -30], ['fire_station', 420, 30]]) {
      const r = C.placeService(city, id, s.x + dx, s.z + dz);
      if (!r.ok) throw new Error(id + ': ' + r.error);
    }
    city.peakPopulation = 0;
    C.fillZone(city, s.x + 300, s.z + 30, 1);
    window.__meridian.fastForward(city, 24 * 90);
    for (const i of window.__meridian.sim.IDEAS) city.design.learn(i.id);
    window.__s = s;`);

  // A combo, spotted while designing.
  await page.locator('.rail-btn[data-cat="design"]').click();
  await page.locator('.ds-text').pressSequentially('cosy row houses with green roofs and balconies', { delay: 6 });
  await expect(page.locator('.ds-combo.new[data-combo="gardenCity"]')).toBeVisible();
  await page.waitForTimeout(900);
  await shot(page, 'combo-design');
  await page.locator('.ds-actions .btn', { hasText: 'Save to sketchbook' }).click();
  expect(await game<boolean>(page, `return g.city.design.found.has('gardenCity');`)).toBe(true);
  await expect(page.locator('.ds-combo[data-combo="gardenCity"]:not(.new)')).toBeVisible();
  await page.locator('.design-modal .ci-tab', { hasText: 'Ideas' }).click();
  await expect(page.locator('.ds-idea.combo[data-combo="gardenCity"]:not(.locked)')).toBeVisible();
  await expect(page.locator('.ds-idea.combo.locked')).toHaveCount(9);
  await shot(page, 'combo-ideas');

  // Tested, adopted, and taken up across the town: a movement is born.
  await game(page, `
    g.ui.studio.close();
    const city = g.city, s = window.__s, d = city.design;
    const sk = d.sketches[0];
    let ok = false;
    for (let k = 0; k < 40 && !ok; k++) ok = C.placePrototype(city, sk.id, s.x + 200 + k * 7, s.z - 30).ok;
    if (!ok) throw new Error('no lot');
    const t = d.trials[0];
    window.__meridian.fastForward(city, 24 * 30 * (t.months + 1) + 48);
    const st = d.adopt(t.id);
    if (!st) throw new Error('not adopted');
    const zoned = [...city.buildings.all.values()].filter((b) => b.kind === 'zoned' && b.typeId !== 'proto');
    for (const b of zoned.slice(0, Math.max(15, Math.ceil(zoned.length * 0.6)))) if (st.kinds.includes(b.style)) city.style.restyle(b, st.id);
    window.__meridian.fastForward(city, 24 * (30 - (city.clock.day % 30)) + 30);`);
  const born = await game<{ id: number; name: string } | null>(page, `const b = g.city.design.births[0]; return b ? { id: b.id, name: b.name } : null;`);
  expect(born).not.toBeNull();
  await game(page, `g.ui.studio.open({ tab: 'styles' });`);
  await expect(page.locator('.st-identity')).toContainText(born!.name);
  const card = page.locator(`.st-card.movement[data-born="${born!.id}"]`);
  await expect(card).toBeVisible();
  await expect(card.locator('.mv-form')).toHaveCount(3);
  await page.waitForTimeout(1500);
  await shot(page, 'movement-tab');

  // Commission the tower and place it with the mouse.
  await card.locator('.mv-form[data-form="tower"]').click();
  await expect(page.locator('.design-modal')).toBeHidden();
  expect(await game<string>(page, `return g.tool.id;`)).toBe('place');
  const site = await game<{ x: number; z: number }>(page, `const s = window.__s; g.cam.jumpTo({ x: s.x + 470, z: s.z - 60, distance: 420, pitch: 0.6 }); return { x: s.x + 470, z: s.z - 40 };`);
  await page.waitForTimeout(1200);
  const p = await screenOf(page, site.x, site.z);
  await page.mouse.move(p.x, p.y);
  await page.mouse.move(p.x + 3, p.y + 2, { steps: 3 });
  await page.waitForTimeout(500);
  await page.mouse.click(p.x + 3, p.y + 2);
  const placed = await game<{ id: number; floors: number; movement: number } | null>(page, `
    const b = [...g.city.buildings.all.values()].find((x) => x.typeId === g.city.design.births[0].landmark?.serviceId);
    return b ? { id: b.id, floors: b.floors, movement: b.movement } : null;`);
  expect(placed).not.toBeNull();
  expect(placed!.floors).toBe(30);
  expect(placed!.movement).toBe(born!.id);
  await game(page, `g.setTool('inspect'); window.__meridian.fastForward(g.city, 24 * 40);`);
  expect(await game<number | undefined>(page, `return g.city.design.births[0].landmark.opened;`)).toBeDefined();
  await game(page, `const b = g.city.buildings.get(${placed!.id}); g.select(null); g.cam.jumpTo({ x: b.cx - 40, z: b.cz + 60, distance: 260, pitch: 0.35 });`);
  await page.waitForTimeout(1500);
  await frames(page, 6);
  await shot(page, 'landmark');

  // All of it survives a save.
  const saved = await game<string>(page, `return JSON.stringify(g.city.design.serialize());`);
  await game(page, `if (!(await g.save())) throw new Error('save failed'); await g.loadSlot(g.slotId);`);
  await frames(page, 5);
  expect(await game<string>(page, `return JSON.stringify(g.city.design.serialize());`)).toBe(saved);
  expect(await game<string>(page, `const b = g.city.buildings.get(${placed!.id}); return g.city.style.movementOf(b)?.name ?? '';`)).toBe(born!.name);
  expect(errors).toEqual([]);
});
