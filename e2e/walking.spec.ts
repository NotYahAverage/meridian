import { expect, test } from '@playwright/test';
import { boot, frames, game, shot, trackErrors } from './helpers';

/**
 * Walkable streets through the interface: crosswalks with pedestrian signals
 * that follow the traffic lights, and the Walking map layer (the network, the
 * roads people can't cross, and how far one can walk from the cursor).
 */
test('walkable streets: pedestrian signals and the walking layer', async ({ page }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(30_000);
  const errors = trackErrors(page);
  await boot(page);
  await game(page, `
    await g.startNewCity({ name: 'Stride', seed: 21, preset: 'lakes', unlimited: false });
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
    road(x + 300, z - 220, x + 300, z + 220);
    road(x + 450, z + 120, x + 650, z + 120, 'parkway');
    road(x + 500, z - 220, x + 500, z + 260);
    // A dead end just beyond the parkway, with no junction on it.
    road(x + 600, z + 152, x + 600, z + 280);
    city.peakPopulation = 0;
    window.__p = { x, z };`);

  // Pedestrian signals stand at both ends of every crosswalk at the lights, and walk only while traffic across is held.
  const sig = await game<{ heads: number; walkOk: boolean; walked: number }>(page, `
    const city = g.city, { x, z } = window.__p;
    const n = city.roads.nearestNode(x + 300, z, 15);
    const arms = city.layout.get(n.id).arms.map((a) => a.segId);
    let walkOk = true;
    const walked = new Set();
    for (let t = 0; t < 120; t += 0.25) {
      city.signals.update(0.25);
      for (const id of arms) {
        const l = city.signals.walkLight(n.id, id);
        if (l !== 0 && city.signals.isGreen(n.id, id)) walkOk = false;
        if (l === 2) walked.add(id);
      }
    }
    g.world.roads.rebuild(1e6);
    return { heads: g.world.roads.allWalkSignals().filter((h) => h.nodeId === n.id).length, walkOk, walked: walked.size };`);
  expect(sig.heads).toBe(8);
  expect(sig.walkOk).toBe(true);
  expect(sig.walked).toBe(4);

  // The Walking layer from the map-layer panel.
  await page.keyboard.press('KeyL');
  await page.locator('.layer-row[data-layer="walking"]').click();
  expect(await game<string>(page, 'return g.world.overlays.mode;')).toBe('walking');
  await expect(page.locator('.layer-legend-title')).toHaveText('Walking');
  await game(page, `const { x, z } = window.__p; g.cam.jumpTo({ x: x + 330, z: z + 20, distance: 420, pitch: 0.95, yaw: 0.4 });`);
  await page.waitForTimeout(1500);
  await frames(page, 6);
  const drawn = await game<{ visible: boolean; verts: number; shaded: number }>(page, `
    const o = g.world.overlays, d = g.world.terrain.overlayData;
    let shaded = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) shaded++;
    return { visible: o.walk.mesh.visible, verts: o.walk.mesh.geometry.getAttribute('position').count, shaded };`);
  expect(drawn.visible).toBe(true);
  expect(drawn.verts).toBeGreaterThan(200);
  expect(drawn.shaded).toBeGreaterThan(50);
  await shot(page, 'walking-layer');
  // Across the parkway between junctions is out of reach on foot; across at the lights is fine.
  const reach = await game<{ near: boolean; viaLights: boolean; across: boolean }>(page, `
    const { x, z } = window.__p, w = g.city.walk;
    const t = w.timesFrom(w.nearest(x + 500, z + 60, 30), 1800);
    const at = (px, pz) => { const l = w.nearest(px, pz, 30); const e = w.edgeAt(l); return Number.isFinite(Math.min(t[w.ea[e]], t[w.eb[e]])); };
    return { near: at(x + 500, z - 100), viaLights: at(x + 500, z + 220), across: at(x + 600, z + 230) };`);
  expect(reach).toEqual({ near: true, viaLights: true, across: false });
  await page.locator('.layer-row[data-layer="walking"]').click();
  expect(await game<boolean>(page, 'return g.world.overlays.walk.mesh.visible;')).toBe(false);
  expect(errors).toEqual([]);
});
