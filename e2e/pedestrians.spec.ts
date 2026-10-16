import { expect, test } from '@playwright/test';
import { boot, game, shot, trackErrors } from './helpers';

/**
 * People on foot through the interface: they come out onto the streets of a
 * small town, can be clicked to see who they are, and followed.
 */
test('people on foot: click someone, see who they are, follow them', async ({ page }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(30_000);
  const errors = trackErrors(page);
  await boot(page);
  await game(page, `
    await g.startNewCity({ name: 'Stroll', seed: 11, preset: 'lakes', unlimited: false });
    g.settings.tutorial = false; g.setSpeed(0);
    const city = g.city;
    city.economy.money = 5_000_000;
    city.peakPopulation = 2500;
    const sp = city.terrain.spawn;
    const x = sp.endX, z = sp.endZ;
    const road = (ax, az, bx, bz, t = 'street') => {
      const r = C.buildRoad(city, C.previewRoad(city, t, C.snap(city, ax, az, t), C.snap(city, bx, bz, t), null));
      if (!r.ok) throw new Error(t + ': ' + r.error);
    };
    road(x, z, x + 600, z, 'avenue');
    for (const dx of [200, 350]) road(x + dx, z - 220, x + dx, z + 220);
    for (const [id, dx, dz] of [['wind_turbine', 20, -24], ['wind_turbine', 70, -24], ['water_tower', 130, 30], ['treatment_plant', 540, -30]]) {
      const r = C.placeService(city, id, x + dx, z + dz);
      if (!r.ok) throw new Error(id + ': ' + r.error);
    }
    city.peakPopulation = 0;
    for (const [dx, dz, zone] of [[270, 40, 4], [270, -40, 2], [270, 120, 2], [270, -120, 2], [420, 40, 2], [420, -40, 4]]) C.fillZone(city, x + dx, z + dz, zone);
    window.__meridian.fastForward(city, 24 * 60);
    window.__p = { x, z };
    g.settings.dayNight = true; g.hour = 8.2;
    g.cam.jumpTo({ x: x + 280, z, distance: 90, pitch: 0.8, yaw: 0.4 });
    g.setSpeed(1);`);
  await page.waitForFunction(() => (window as any).__meridian.game.city.pedestrians.count >= 6, null, { timeout: 60_000 });

  // Click on someone walking.
  const target = await game<{ x: number; y: number; i: number } | null>(page, `
    const ped = g.city.pedestrians;
    g.ui.closePanel();
    g.setSpeed(0);
    for (let i = 0; i < ped.max; i++) {
      if (!ped.active[i] || ped.state[i] !== 1 || ped.scale[i] < 1) continue;
      const s = g.worldToScreen(ped.x[i], ped.y[i] + 0.9, ped.z[i]);
      // Only someone out in the open on the map (not under a panel).
      if (s.visible && document.elementFromPoint(s.x, s.y)?.id === 'view') return { x: s.x, y: s.y, i };
    }
    return null;`);
  expect(target).not.toBeNull();
  await page.mouse.move(target!.x, target!.y);
  await page.mouse.click(target!.x, target!.y);
  const sel = await game<{ kind: string; id: number }>(page, `return g.selection;`);
  expect(sel.kind).toBe('person');
  const panel = page.locator('.inspector');
  await expect(panel).toContainText('Lives at');
  await expect(panel.locator('.insp-sub')).toContainText(/\d+ · /);
  // What the panel says matches who they are in the simulation.
  const name = await game<string>(page, `
    const ped = g.city.pedestrians, i = g.selection.id;
    const c = window.__meridian.sim.citizenOf(g.city.population, ped.household[i], ped.member[i]);
    return c.first + ' ' + c.family;`);
  await expect(panel.locator('.insp-title')).toHaveText(name);

  // Follow them for a while: the camera keeps them in the middle.
  await game(page, `g.setSpeed(1);`);
  await panel.locator('[data-follow]').click();
  await page.waitForTimeout(4000);
  const gap = await game<number>(page, `
    const ped = g.city.pedestrians, s = g.selection;
    if (!ped.alive(s.id, s.serial)) return 0;
    return Math.hypot(g.cam.goal.x - ped.x[s.id], g.cam.goal.z - ped.z[s.id]);`);
  expect(gap).toBeLessThan(3);
  await shot(page, 'pedestrians-follow');
  expect(await game<number>(page, `return g.city.pedestrians.stats.redLight;`)).toBe(0);
  expect(errors).toEqual([]);
});
