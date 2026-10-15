import { expect, test } from '@playwright/test';
import { boot, frames, game, screenOf, shot, trackErrors } from './helpers';

/**
 * The whole research loop through the real interface: build a research centre,
 * run experiments and take their decisions in the research window, discover a
 * generated building, build it from the window, then save and reload.
 */
test('research centre to a discovered building, through save and load', async ({ page }) => {
  test.setTimeout(400_000);
  const errors = trackErrors(page);
  await boot(page);
  // A small serviced town with power to spare.
  await game(page, `
    await g.startNewCity({ name: 'Scienceton', seed: 7, preset: 'lakes', unlimited: false });
    g.settings.tutorial = false; g.setSpeed(0);
    const city = g.city;
    city.research.civSeed = 424242;
    city.economy.money = 3_000_000;
    city.peakPopulation = 3000;
    const s = city.startPoint;
    const road = (ax, az, bx, bz, t = 'avenue') => C.buildRoad(city, C.previewRoad(city, t, C.snap(city, ax, az, t), C.snap(city, bx, bz, t), null)).ok;
    road(s.x - 100, s.z, s.x + 500, s.z);
    const coal = C.placeService(city, 'coal_plant', s.x + 120, s.z + 50);
    if (!coal.ok) throw new Error(coal.error);
    window.__s = s;`);
  // Build the centre with the place tool, clicking on the map.
  await game(page, `g.ui.toolbar.select('services'); g.setTool('place', (t) => t.configure('research_center')); g.cam.jumpTo({ x: window.__s.x + 300, z: window.__s.z, distance: 420, pitch: 0.9, yaw: 0.2 });`);
  await frames(page, 20);
  await expect(page.locator('.card', { hasText: 'Utility Lab' })).toBeVisible();
  const at = await screenOf(page, 0, 0).then(() => game<{ x: number; z: number }>(page, `return { x: window.__s.x + 300, z: window.__s.z - 40 };`));
  const pt = await screenOf(page, at.x, at.z);
  await page.mouse.move(pt.x, pt.y);
  await frames(page, 5);
  await page.mouse.click(pt.x, pt.y);
  await frames(page, 5);
  const centre = await game<{ id: number; name: string; field: string } | null>(page, `const c = [...g.city.research.centers.values()][0]; return c ? { id: c.id, name: c.name, field: c.field } : null;`);
  expect(centre).not.toBeNull();
  console.log('centre', JSON.stringify(centre));
  await game(page, `g.setTool('inspect'); window.__meridian.fastForward(g.city, 24 * 10);`);
  // The research window from the rail.
  await page.locator('.rail-btn[data-cat="research"]').click();
  await expect(page.locator('.research-modal')).toBeVisible();
  await expect(page.locator('.rs-centre-name')).toHaveText(centre!.name);
  await expect(page.locator('.rs-plan').first()).toBeVisible();
  await shot(page, 'research-centre');

  // Run experiments until one designs a building (failures teach and offer follow-ups).
  let design: string | null = null;
  for (let attempt = 0; attempt < 8 && !design; attempt++) {
    // Prefer a proposal that can become a facility.
    const plans = page.locator('.rs-plan');
    const n = await plans.count();
    let pick = 0;
    for (let i = 0; i < n; i++) if ((await plans.nth(i).innerText()).includes('Pilot facility')) { pick = i; break; }
    const ready = plans.nth(pick).locator('button.btn.primary');
    await expect(ready).toBeEnabled();
    await ready.click();
    await expect(page.locator('.rs-active')).toBeVisible();
    for (let day = 0; day < 90; day++) {
      const state = await game<{ pending: boolean; active: boolean; disc: number }>(page, `
        window.__meridian.fastForward(g.city, 24);
        const c = g.city.research.centers.get(${centre!.id});
        return { pending: !!c.active?.pending, active: !!c.active, disc: g.city.research.discoveries.length };`);
      if (state.pending) {
        await frames(page, 3);
        if (!(await page.locator('.research-modal').isVisible())) await page.locator('.rail-btn[data-cat="research"]').click();
        const opts = page.locator('.rs-option');
        await expect(opts.first()).toBeVisible();
        const texts = await opts.allInnerTexts();
        const pilot = texts.findIndex((t) => t.startsWith('Build a pilot'));
        // A pilot facility at the first decision; the careful option at the second.
        await opts.nth(pilot >= 0 ? pilot : texts.length - 1).click();
        if (attempt === 0 && pilot >= 0) await shot(page, 'research-decision');
      }
      if (!state.active) break;
    }
    await frames(page, 6);
    design = await game<string | null>(page, `return [...g.city.research.designs.values()][0]?.serviceId ?? null;`);
    if (await page.locator('.discovery-modal').isVisible()) {
      await shot(page, design ? 'research-discovery' : `research-discovery-${attempt}`);
      if (!design) await page.locator('.discovery-modal .btn.primary').click();
    }
    if (design) break;
    if (!(await page.locator('.research-modal').isVisible())) await page.locator('.rail-btn[data-cat="research"]').click();
    await page.locator('.rs-tabs .ci-tab', { hasText: 'Labs' }).click();
  }
  expect(design).not.toBeNull();
  // From the discovery to the Buildings tab, inspect it, and build it.
  if (await page.locator('.discovery-modal').isVisible()) await page.locator('.discovery-modal .btn.primary').click();
  else {
    if (!(await page.locator('.research-modal').isVisible())) await page.locator('.rail-btn[data-cat="research"]').click();
    await page.locator('.rs-tabs .ci-tab', { hasText: 'Buildings' }).click();
  }
  await expect(page.locator('.rs-design').first()).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, 'research-buildings');
  const info = await game<{ name: string; w: number; d: number; fn: string; cost: number }>(page, `const d = [...g.city.research.designs.values()][0]; return { name: d.name, w: d.stats.w, d: d.stats.d, fn: d.fn, cost: d.stats.cost };`);
  console.log('design', JSON.stringify(info));
  await page.locator('.rs-design .btn.primary').first().click();
  await expect(page.locator('.research-modal')).toBeHidden();
  await expect(page.locator('.card', { hasText: info.name })).toBeVisible();
  const spot = await game<{ x: number; z: number }>(page, `g.cam.jumpTo({ x: window.__s.x + 80, z: window.__s.z, distance: 420, pitch: 0.9, yaw: 0.2 }); return { x: window.__s.x + 60, z: window.__s.z - 60 };`);
  await frames(page, 20);
  const p2 = await screenOf(page, spot.x, spot.z);
  await page.mouse.move(p2.x, p2.y);
  await frames(page, 5);
  await page.mouse.click(p2.x, p2.y);
  await frames(page, 5);
  const built = await game<number>(page, `return [...g.city.buildings.all.values()].filter((b) => b.typeId === '${design}').length;`);
  expect(built).toBe(1);
  // It works: finish construction and check the city uses it.
  await game(page, `g.setTool('inspect'); window.__meridian.fastForward(g.city, 24 * 14); g.city.recomputeUtilities();`);
  const working = await game<{ state: number; kind: string; power: number; storage: number }>(page, `
    const b = [...g.city.buildings.all.values()].find((x) => x.typeId === '${design}');
    const st = window.__meridian.sim.SERVICE_BY_ID.get(b.typeId);
    return { state: b.state, kind: st.kind, power: g.city.utilities.totals.power.production, storage: g.city.utilities.storage.capacity };`);
  console.log('working', JSON.stringify(working));
  expect(working.state).toBe(1);
  await game(page, `g.cam.jumpTo({ x: window.__s.x + 160, z: window.__s.z, distance: 260, pitch: 0.7, yaw: 0.3 }); g.hour = 12;`);
  await frames(page, 30);
  await page.waitForTimeout(500);
  await shot(page, 'research-built');

  // Save and load: the discovery, the design and the building come back exactly.
  const before = await game<string>(page, `return JSON.stringify({ d: g.city.research.discoveries.map((d) => [d.id, d.name, d.quality]), g: [...g.city.research.designs.values()].map((d) => [d.id, d.name, JSON.stringify(d.arch)]), r: g.city.research.records.length });`);
  await game(page, `if (!(await g.save())) throw new Error('save failed'); window.__slot = g.slotId;`);
  await game(page, `await g.loadSlot(window.__slot);`);
  await frames(page, 10);
  const after = await game<string>(page, `return JSON.stringify({ d: g.city.research.discoveries.map((d) => [d.id, d.name, d.quality]), g: [...g.city.research.designs.values()].map((d) => [d.id, d.name, JSON.stringify(d.arch)]), r: g.city.research.records.length });`);
  expect(after).toBe(before);
  const still = await game<number>(page, `return [...g.city.buildings.all.values()].filter((b) => b.typeId === '${design}').length;`);
  expect(still).toBe(1);
  await page.locator('.rail-btn[data-cat="research"]').click();
  await page.locator('.rs-tabs .ci-tab', { hasText: 'Discoveries' }).click();
  await expect(page.locator('.rs-disc').first()).toBeVisible();
  await shot(page, 'research-archive');
  expect(errors).toEqual([]);
});
