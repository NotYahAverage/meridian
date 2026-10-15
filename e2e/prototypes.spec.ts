import { expect, test } from '@playwright/test';
import { boot, frames, game, screenOf, shot, trackErrors } from './helpers';

/**
 * Prototypes through the interface: design a building, build it on a real
 * street with the mouse, watch it go up, hear what people say about it in
 * speech bubbles over the building, follow the trial in the studio and the
 * inspector, and read the verdict. Trials survive a save and reload.
 */
test('prototypes: build a design on a street, hear the reactions, get the verdict', async ({ page }) => {
  test.setTimeout(400_000);
  page.setDefaultTimeout(30_000);
  const errors = trackErrors(page);
  await boot(page);
  await game(page, `
    await g.startNewCity({ name: 'Draughts', seed: 7, preset: 'lakes', unlimited: false });
    g.settings.tutorial = false; g.setSpeed(0);
    const city = g.city;
    city.economy.money = 3_000_000;
    const sp = city.terrain.spawn;
    const s = { x: sp.endX, z: sp.endZ };
    const road = (ax, az, bx, bz, t = 'avenue') => C.buildRoad(city, C.previewRoad(city, t, C.snap(city, ax, az, t), C.snap(city, bx, bz, t), null)).ok;
    if (!road(s.x, s.z, s.x + 600, s.z)) throw new Error('road');
    if (![...city.roads.segments.values()].every((x) => city.isConnectedToOutside(x.id))) throw new Error('not connected');
    city.peakPopulation = 2500;
    for (const [id, dx, dz] of [['wind_turbine', 20, -24], ['wind_turbine', 70, -24], ['water_tower', 130, -24], ['treatment_plant', 520, -30]]) {
      const r = C.placeService(city, id, s.x + dx, s.z + dz);
      if (!r.ok) throw new Error(id + ': ' + r.error);
    }
    city.peakPopulation = 0;
    // A row of houses along the north side for neighbours.
    C.fillZone(city, s.x + 300, s.z + 30, 1);
    window.__meridian.fastForward(city, 24 * 30);
    for (const i of window.__meridian.sim.IDEAS) city.design.learn(i.id);
    window.__s = s;`);
  const houses = await game<number>(page, `return [...g.city.buildings.all.values()].filter((b) => b.kind === 'zoned').length;`);
  expect(houses).toBeGreaterThan(3);

  // Design it and send it to the street.
  await page.locator('.rail-btn[data-cat="design"]').click();
  await expect(page.locator('.design-modal')).toBeVisible();
  await page.locator('.ds-text').pressSequentially('affordable brick flats, five storeys, with planted balconies and shops at the bottom', { delay: 8 });
  await expect(page.locator('.ds-chip', { hasText: 'Vertical forest' }).first()).toBeVisible();
  await expect(page.locator('.ds-stats')).toContainText('Prototype');
  await page.locator('.ds-build').click();
  await expect(page.locator('.design-modal')).toBeHidden();
  expect(await game<string>(page, `return g.tool.id;`)).toBe('prototype');
  expect(await game<number>(page, `return g.city.design.sketches.length;`)).toBe(1);

  // Choose a lot on the south side, among nothing but fields, then on the north among the houses.
  const lot = await game<{ x: number; z: number }>(page, `const s = window.__s; g.flyTo(s.x + 300, s.z + 20, 260); return { x: s.x + 300, z: s.z + 28 };`);
  await page.waitForTimeout(2200);
  const p = await screenOf(page, lot.x, lot.z);
  await page.mouse.move(p.x, p.y);
  await page.mouse.move(p.x + 4, p.y + 2, { steps: 4 });
  await page.waitForTimeout(600);
  await shot(page, 'proto-place');
  const before = await game<number>(page, `return g.city.economy.money;`);
  await page.mouse.click(p.x + 4, p.y + 2);
  await expect.poll(() => game<number>(page, `return g.city.design.trials.length;`)).toBe(1);
  const t0 = await game<{ state: string; cost: number; building: string; kind: string; reactions: number }>(page, `
    const t = g.city.design.trials[0]; const b = g.city.buildings.get(t.buildingId);
    return { state: t.state, cost: t.cost, building: b.typeId, kind: b.style, reactions: t.reactions.length };`);
  expect(t0.state).toBe('building');
  expect(t0.building).toBe('proto');
  expect(t0.kind).toBe('mixeduse');
  expect(t0.reactions).toBe(1);
  expect(await game<number>(page, `return g.city.economy.money;`)).toBe(before - t0.cost);
  expect(await game<string>(page, `return g.tool.id;`)).toBe('inspect');
  // The inspector follows it.
  await expect(page.locator('.insp-trial')).toBeVisible();

  // It goes up and opens; then people start talking.
  await game(page, `window.__meridian.fastForward(g.city, 24 * 25);`);
  expect(await game<string>(page, `return g.city.design.trials[0].state;`)).toBe('testing');
  await game(page, `window.__meridian.fastForward(g.city, 24 * 12); g.setSpeed(1);`);
  await expect(page.locator('.proto-badge')).toBeVisible();
  await expect(page.locator('.proto-bubble').first()).toBeVisible({ timeout: 15_000 });
  await game(page, `const t = g.city.design.trials[0]; const b = g.city.buildings.get(t.buildingId); g.cam.flyTo(b.cx, b.cz, 200, 0.4); g.select(null);`);
  await page.waitForTimeout(900);
  await game(page, `g.setSpeed(0);`);
  await shot(page, 'proto-bubbles');
  const talk = await game<{ n: number; approval: number; texts: string[] }>(page, `const t = g.city.design.trials[0]; return { n: t.reactions.length, approval: t.approval, texts: t.reactions.map((r) => r.text) };`);
  expect(talk.n).toBeGreaterThanOrEqual(3);
  expect(new Set(talk.texts).size).toBeGreaterThan(1);

  // Follow it in the studio, from the badge.
  await page.locator('.proto-badge').click();
  await expect(page.locator('.design-modal')).toBeVisible();
  await expect(page.locator('.tr-card.focus')).toBeVisible();
  await expect(page.locator('.tr-quote').first()).toBeVisible();
  await expect(page.locator('.tr-aspect')).toHaveCount(6);
  await page.waitForTimeout(500);
  await shot(page, 'proto-trial');
  await page.locator('.design-modal .modal-head [aria-label="Close"]').click();

  // To the verdict.
  const months = await game<number>(page, `return g.city.design.trials[0].months;`);
  await game(page, `window.__meridian.fastForward(g.city, 24 * 30 * ${months});`);
  await frames(page, 4);
  const v = await game<{ state: string; grade: string; summary: string; history: number[]; news: boolean }>(page, `
    const t = g.city.design.trials[0];
    return { state: t.state, grade: t.verdict && t.verdict.grade, summary: t.verdict && t.verdict.summary, history: t.history, news: false };`);
  expect(v.state).toBe('done');
  expect(['loved', 'liked', 'mixed', 'disliked', 'hated']).toContain(v.grade);
  expect(v.summary.length).toBeGreaterThan(20);
  expect(v.history.length).toBe(months);
  await expect(page.locator('.proto-badge')).toContainText('Verdict');
  expect(await game<boolean>(page, `return g.city.notifications.recent.some((n) => n.title.startsWith('Verdict on'));`)).toBe(true);
  await game(page, `g.ui.studio.open({ tab: 'prototypes', trialId: g.city.design.trials[0].id });`);
  await expect(page.locator('.tr-verdict')).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, 'proto-verdict');
  await game(page, `g.ui.studio.close(); const t = g.city.design.trials[0]; g.select({ kind: 'building', id: t.buildingId });`);
  await expect(page.locator('.insp-trial')).toContainText('Verdict');
  await shot(page, 'proto-inspector');

  // Saved and reloaded, the trial and its building come back as they were.
  const saved = await game<string>(page, `return JSON.stringify(g.city.design.serialize().trials);`);
  await game(page, `if (!(await g.save())) throw new Error('save failed'); await g.loadSlot(g.slotId);`);
  await frames(page, 5);
  expect(await game<string>(page, `return JSON.stringify(g.city.design.serialize().trials);`)).toBe(saved);
  expect(await game<boolean>(page, `const t = g.city.design.trials[0]; const b = g.city.buildings.get(t.buildingId); return !!b && b.typeId === 'proto' && g.city.style.movementOf(b) === t.concept.look;`)).toBe(true);
  expect(errors).toEqual([]);
});
