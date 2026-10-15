import { expect, test } from '@playwright/test';
import { boot, frames, game, shot, trackErrors } from './helpers';

/**
 * Taste groups through the interface: who will like a design while it is
 * being drawn, a petition answered in the People tab, a protest in the
 * streets, and a prototype's verdict broken down by group.
 */
test('taste groups: who likes what, petitions, protests and verdicts by group', async ({ page }) => {
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
    window.__meridian.fastForward(city, 24 * 60);
    for (const i of window.__meridian.sim.IDEAS) city.design.learn(i.id);
    window.__s = s;`);
  expect(await game<number>(page, `return g.city.population.residents;`)).toBeGreaterThan(20);

  // While designing: who will like it.
  await page.locator('.rail-btn[data-cat="design"]').click();
  await page.locator('.ds-text').pressSequentially('a 14-storey raw concrete tower with prefab panels', { delay: 6 });
  await expect(page.locator('.ds-who-chip')).toHaveCount(6);
  await expect(page.locator('.ds-who-chip.pos', { hasText: 'Forward' })).toBeVisible();
  await expect(page.locator('.ds-who-chip.neg', { hasText: 'Old Town' })).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, 'people-design');

  // A group pushed too far petitions; the mayor promises.
  await game(page, `g.ui.studio.close(); g.city.people.remember('heritage', -45, 'Concrete everywhere'); window.__meridian.fastForward(g.city, 24 * 35);`);
  const pet = await game<{ id: number; text: string; state: string } | null>(page, `const p = g.city.people.petitions.find((x) => x.group === 'heritage'); return p ? { id: p.id, text: p.text, state: p.state } : null;`);
  expect(pet).not.toBeNull();
  await game(page, `g.ui.studio.open({ tab: 'people' });`);
  await expect(page.locator('.pp-card')).toHaveCount(6);
  const card = page.locator(`.pp-petition[data-petition="${pet!.id}"]`);
  await expect(card).toContainText(pet!.text);
  await page.waitForTimeout(400);
  await shot(page, 'people-tab');
  await card.locator('[data-answer="promise"]').click();
  expect(await game<string>(page, `return g.city.people.petitions.find((x) => x.id === ${pet!.id}).state;`)).toBe('promised');
  await expect(page.locator(`.pp-petition[data-petition="${pet!.id}"]`)).toContainText('you promised');

  // Another group, ignored for too long, takes to the streets.
  await game(page, `g.ui.studio.close(); g.city.people.remember('locals', -80, 'Towers over the houses'); window.__meridian.fastForward(g.city, 24 * 45);`);
  const protest = await game<{ x: number; z: number; sign: string } | null>(page, `
    const p = g.city.people.protests[0] || null;
    return p ? { x: p.x, z: p.z, sign: p.sign } : null;`);
  if (protest) {
    await game(page, `g.cam.jumpTo({ x: ${protest.x}, z: ${protest.z} + 40, distance: 300, pitch: 0.7 });`);
    await page.waitForTimeout(1200);
    await frames(page, 5);
    await expect(page.locator('.proto-protest')).toBeVisible();
    await shot(page, 'people-protest');
  } else {
    // It may already be over; it must have happened.
    expect(await game<boolean>(page, `return g.city.notifications.recent.some((n) => /protest/i.test(n.title));`)).toBe(true);
  }

  // A prototype's verdict, group by group.
  await game(page, `
    const city = g.city, s = window.__s;
    const sk = city.design.saveSketch({ text: 'timber flats with planted balconies, a green roof and solar panels, five storeys', added: [], removed: [] });
    let ok = false;
    for (let k = 0; k < 30 && !ok; k++) ok = C.placePrototype(city, sk.id, s.x + 200 + k * 7, s.z - 30).ok;
    if (!ok) throw new Error('no lot');
    window.__meridian.fastForward(city, 24 * 30 * 6);`);
  await game(page, `g.ui.studio.open({ tab: 'prototypes', trialId: g.city.design.trials[0].id });`);
  await expect(page.locator('.tr-group')).toHaveCount(6);
  await expect(page.locator('.tr-quote .grp-tag').first()).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, 'people-verdict');
  const by = await game<Record<string, number>>(page, `return g.city.design.trials[0].verdict.byGroup;`);
  expect(by.green).toBeGreaterThan(by.business);

  // All of it survives a save.
  const saved = await game<string>(page, `return JSON.stringify(g.city.people.serialize());`);
  await game(page, `g.ui.studio.close(); if (!(await g.save())) throw new Error('save failed'); await g.loadSlot(g.slotId);`);
  await frames(page, 5);
  expect(await game<string>(page, `return JSON.stringify(g.city.people.serialize());`)).toBe(saved);
  expect(errors).toEqual([]);
});
