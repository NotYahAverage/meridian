import { expect, test } from '@playwright/test';
import { boot, frames, game, shot, trackErrors } from './helpers';

/**
 * The research system's long-term layer through the interface: budget and
 * decision settings, the first-experiment guide, a joint experiment between
 * two centres with the tracker on the map, decision trade-offs, the knowledge
 * web and milestones, retrofits, renaming and comparing a design, the timeline
 * and a policy made possible by research.
 */
test('research: budget, joint work, decisions, knowledge web, retrofits, names and policies', async ({ page }) => {
  test.setTimeout(400_000);
  page.setDefaultTimeout(30_000);
  const errors = trackErrors(page);
  await boot(page);
  await game(page, `
    await g.startNewCity({ name: 'Academia', seed: 7, preset: 'lakes', unlimited: false });
    g.settings.tutorial = false; g.setSpeed(0);
    const city = g.city;
    city.research.civSeed = 515151;
    city.economy.money = 5_000_000;
    city.peakPopulation = 3000;
    const s = city.startPoint;
    const road = (ax, az, bx, bz, t = 'avenue') => C.buildRoad(city, C.previewRoad(city, t, C.snap(city, ax, az, t), C.snap(city, bx, bz, t), null)).ok;
    road(s.x - 100, s.z, s.x + 600, s.z);
    for (const [id, dx] of [['coal_plant', 120], ['research_center', 300], ['research_center', 420]]) {
      const r = C.placeService(city, id, s.x + dx, s.z + 50);
      if (!r.ok) throw new Error(id + ': ' + r.error);
    }
    window.__meridian.fastForward(city, 24 * 10);
    window.__s = s;`);
  const ids = await game<number[]>(page, `return [...g.city.research.centers.keys()];`);
  expect(ids).toHaveLength(2);

  // The window: settings, the guide and partners.
  await page.locator('.rail-btn[data-cat="research"]').click();
  await expect(page.locator('.research-modal')).toBeVisible();
  await expect(page.locator('.rs-controls')).toBeVisible();
  await expect(page.locator('.rs-guide')).toBeVisible();
  const slider = page.locator('.rs-budget');
  await slider.fill('150');
  await slider.dispatchEvent('change');
  expect(await game<number>(page, `return g.city.research.funding;`)).toBe(1.5);
  await page.locator('.rs-seg-btn', { hasText: 'Take the careful option' }).click();
  expect(await game<boolean>(page, `return g.city.research.autoDecide;`)).toBe(true);
  await page.locator('.rs-seg-btn', { hasText: 'Wait for me' }).click();
  const plan = page.locator('.rs-plan').first();
  await expect(plan.locator('.rs-partner')).toBeVisible();
  await plan.locator('.rs-partner').selectOption({ index: 1 });
  await expect(page.locator('.rs-plan').first().locator('.rs-factors')).toContainText('Joint team');
  await shot(page, 'research2-centre');
  await page.locator('.rs-plan').first().locator('button.btn.primary').click();
  await expect(page.locator('.rs-active')).toBeVisible();
  const joint = await game<{ lead: number; partner: number | undefined; assisting: number | undefined }>(page, `
    const [a, b] = [...g.city.research.centers.values()];
    const lead = a.active ? a : b, other = a.active ? b : a;
    return { lead: lead.id, partner: lead.active.partnerId, assisting: other.assisting };`);
  expect(joint.partner).toBeDefined();
  expect(joint.assisting).toBe(joint.lead);

  // The tracker on the map.
  await page.keyboard.press('Escape');
  await expect(page.locator('.research-modal')).toBeHidden();
  await expect(page.locator('.rs-tracker .rs-track')).toHaveCount(1);

  // Run to the first decision: each option shows its trade-offs.
  for (let d = 0; d < 60; d++) {
    const pending = await game<boolean>(page, `window.__meridian.fastForward(g.city, 24); return !!g.city.research.centers.get(${joint.lead}).active?.pending;`);
    if (pending) break;
  }
  await frames(page, 4);
  await expect(page.locator('.rs-tracker .rs-track.alert')).toHaveCount(1);
  await expect(page.locator('.rail-btn[data-cat="research"].alert')).toHaveCount(1);
  await page.locator('.rs-tracker .rs-track').click();
  await expect(page.locator('.rs-option').first()).toBeVisible();
  await expect(page.locator('.rs-option').first().locator('.rs-bar')).toHaveCount(4);
  await page.locator('.rs-decision').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await shot(page, 'research2-decision');
  // Take every decision through the interface until the experiment ends (a pilot where offered).
  for (let k = 0; k < 6; k++) {
    const opts = page.locator('.rs-option');
    if (!(await opts.count())) break;
    const texts = await opts.allInnerTexts();
    let pick = texts.findIndex((t) => t.startsWith('Build a pilot'));
    if (pick < 0) pick = texts.length - 1;
    if (texts.some((t) => t.startsWith('Keep it in the lab'))) {
      await expect(page.locator('.rs-sites .rs-link').first()).toBeVisible();
      await shot(page, 'research2-site');
      pick = 0;
    }
    await opts.nth(pick).click();
    for (let d = 0; d < 80; d++) {
      const s = await game<{ pending: boolean; active: boolean }>(page, `window.__meridian.fastForward(g.city, 24); const c = g.city.research.centers.get(${joint.lead}); return { pending: !!c.active?.pending, active: !!c.active };`);
      if (s.pending || !s.active) break;
    }
    await frames(page, 4);
    if (await page.locator('.discovery-modal').isVisible()) await page.locator('.discovery-modal .btn').first().click();
    if (!(await page.locator('.research-modal').isVisible())) await page.locator('.rail-btn[data-cat="research"]').click();
    if (!(await game<boolean>(page, `return !!g.city.research.centers.get(${joint.lead}).active;`))) break;
  }
  const done = await game<{ records: number; partnerFree: boolean; xp: number }>(page, `
    const r = g.city.research; const ids = [...r.centers.keys()];
    const lead = r.centers.get(${joint.lead}); const other = r.centers.get(ids.find((i) => i !== ${joint.lead}));
    return { records: r.records.length, partnerFree: other.assisting === undefined, xp: Object.values(lead.mastery ?? {}).reduce((a, b) => a + b, 0) };`);
  expect(done.records).toBe(1);
  expect(done.partnerFree).toBe(true);
  expect(done.xp).toBeGreaterThan(0);

  // Give the civilization a facility design and an emission-capture method (as experiments would).
  await game(page, `
    const r = g.city.research;
    const Gen = await import('/src/sim/research/Generate.ts');
    const info = { id: 1, name: r.centers.get(${joint.lead}).name, field: 'energy', secondary: [], equipment: 2 };
    const plan = (id, principle, resource, field) => ({ id, centerId: 1, title: '', summary: '', field, principle, resource, basis: [], kind: 'study', cost: 1, monthly: 1, days: 1, power: 0, risk: 0, prospects: [], clues: [] });
    const made = Gen.makeDiscovery(r.civ(), plan('ui1', 'combustion', 'peat', 'energy'), { outcome: 'breakthrough', quality: 0.7, chance: 0.7, direction: 'apply', field: 'energy', principle: 'combustion' }, info, r.nextIds());
    r.adopt(made);
    r.adopt(Gen.makeDiscovery(r.civ(), plan('ui2', 'capture', 'peat', 'environment'), { outcome: 'success', quality: 0.6, chance: 0.7, direction: 'refine', field: 'environment', principle: 'capture' }, info, r.nextIds()));
    r.adopt(Gen.makeDiscovery(r.civ(), plan('ui3', 'pavements', 'granite', 'transport'), { outcome: 'success', quality: 0.4, chance: 0.7, direction: 'theory', field: 'transport', principle: 'pavements' }, info, r.nextIds()));
    window.__design = made.design.id;`);

  // The knowledge web and milestones.
  await page.locator('.rs-tabs .ci-tab', { hasText: 'Knowledge web' }).click();
  await expect(page.locator('.rs-web')).toBeVisible();
  expect(await page.locator('.rs-web .web-node.found').count()).toBeGreaterThanOrEqual(3);
  expect(await page.locator('.rs-web .web-node.open').count()).toBeGreaterThan(0);
  await expect(page.locator('.rs-milestone.done').first()).toContainText('First discovery');
  await page.waitForTimeout(400);
  await shot(page, 'research2-web');

  // Retrofit the coal plant from the Buildings tab, then rename and compare the design.
  await page.locator('.rs-tabs .ci-tab', { hasText: 'Buildings' }).click();
  const retro = page.locator('.rs-retrofits .rs-retrofit').filter({ hasText: 'power plant' }).first();
  await expect(retro).toBeVisible();
  const before = await game<number>(page, `const b = [...g.city.buildings.all.values()].find((x) => x.typeId === 'coal_plant'); return window.__meridian.game.city && (await import('/src/sim/CitySim.ts')).landValueMods(g.city).pollution(b);`);
  await retro.locator('.btn').click();
  await expect(page.locator('.rs-retrofits .rs-retrofit.done').first()).toBeVisible();
  const after = await game<number>(page, `const b = [...g.city.buildings.all.values()].find((x) => x.typeId === 'coal_plant'); return (await import('/src/sim/CitySim.ts')).landValueMods(g.city).pollution(b);`);
  expect(after).toBeLessThan(before);
  const card = page.locator(`.rs-design[data-design]`).first();
  const rename = card.locator('.rs-rename');
  await rename.fill('Academia Firing Hall');
  await rename.press('Enter');
  expect(await game<string>(page, `return g.city.research.designs.get(window.__design).name;`)).toBe('Academia Firing Hall');
  await page.locator('.rs-design').first().locator('summary', { hasText: 'Compare' }).click();
  await expect(page.locator('.rs-compare tr.mine')).toContainText('Academia Firing Hall');
  await page.locator('.rs-design').first().locator('summary', { hasText: 'History' }).click();
  await shot(page, 'research2-buildings');

  // The timeline.
  await page.locator('.rs-tabs .ci-tab', { hasText: 'Experiment log' }).click();
  await expect(page.locator('.rs-tl-item').first()).toBeVisible();
  await expect(page.locator('.rs-tl-item.rs-tl-ms').first()).toBeVisible();
  expect(await page.locator('.rs-tl-item.rs-tl-ms').first().evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
  await shot(page, 'research2-log');

  // Congestion pricing (unlocked by population since research became a utilities branch).
  await page.keyboard.press('Escape');
  await game(page, `g.ui.openPanel('policies');`);
  const policy = page.locator('.policy', { hasText: 'Congestion Pricing' });
  await expect(policy).toBeVisible();
  await policy.locator('.switch').click();
  expect(await game<boolean>(page, `return g.city.policies.has('congestionPricing');`)).toBe(true);
  await shot(page, 'research2-policy');

  // Save and load keep all of it.
  const before2 = await game<string>(page, `return JSON.stringify(g.city.research.serialize());`);
  await game(page, `if (!(await g.save())) throw new Error('save failed'); window.__slot = g.slotId; await g.loadSlot(window.__slot);`);
  await frames(page, 5);
  expect(await game<string>(page, `return JSON.stringify(g.city.research.serialize());`)).toBe(before2);
  expect(errors).toEqual([]);
});
