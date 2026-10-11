import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { boot, frames, game, screenOf, trackErrors } from './helpers';

test('coach marks guide a new city', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await page.getByRole('button', { name: 'New city' }).click();
  await page.getByRole('button', { name: 'Found city' }).click();
  await page.waitForFunction(() => (window as any).__meridian.game.state === 'playing', null, { timeout: 60_000 });
  await game(page, `g.ui.closePanel();`);
  await page.waitForTimeout(800);
  await expect(page.locator('.coach-bubble')).toBeVisible();
  await expect(page.locator('.coach-title')).toHaveText('Connect to the highway');
  await expect(page.locator('.tb-money')).toHaveText(/^\$[\d,]+$/);
    // Opening the roads menu hides the tip.
  await page.locator('.rail-btn[data-cat="roads"]').click();
  await page.waitForTimeout(400);
  await expect(page.locator('.coach-bubble')).toBeHidden();
  await page.keyboard.press('Escape');
  // Pretend the first goals are done: the tip moves on.
  await game(page, `for (const id of ['connect', 'zoneRes', 'zoneJobs', 'power', 'water', 'sewage', 'pop100', 'service', 'park', 'pop500', 'bus']) g.city.goalsDone.add(id); g.setTool('inspect'); g.ui.toolbar.close();`);
  await page.waitForTimeout(600);
  await expect(page.locator('.coach-title')).toHaveText('Enact a city policy');
    await page.locator('.coach-off').click();
  await page.waitForTimeout(400);
  await expect(page.locator('.coach-bubble')).toBeHidden();
  expect(await game<boolean>(page, `return g.settings.tutorial;`)).toBe(false);
  await game(page, `g.settings.tutorial = true; window.__meridian.storage && 0;`);
  expect(errors).toEqual([]);
});

test('photo mode', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await game(page, `g.ui.hideMenu(); g.state = 'playing'; g.ui.showHud(); g.setSpeed(0); g.hour = 17.5; g.env.updateEnvironmentMap(true);
    const s = g.city.startPoint; g.cam.jumpTo({ x: s.x + 120, z: s.z + 40, distance: 300, pitch: 0.5, yaw: 2.0 });`);
  await page.waitForTimeout(800);
  await page.keyboard.press('KeyP');
  await expect(page.locator('.hud')).toBeHidden();
  await expect(page.locator('.photo-hint')).toBeVisible();
  await page.waitForTimeout(3600);
  await frames(page, 4);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  const file = await dl.path();
  const size = fs.statSync(file!).size;
  console.log('DOWNLOAD', dl.suggestedFilename(), size);
  expect(dl.suggestedFilename()).toMatch(/\.png$/);
  expect(size).toBeGreaterThan(200_000);
  await page.keyboard.press('Escape');
  await expect(page.locator('.hud')).toBeVisible();
  expect(errors).toEqual([]);
});

test('road grid tool', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await page.getByRole('button', { name: 'New city' }).click();
  await page.getByRole('button', { name: 'Found city' }).click();
  await page.waitForFunction(() => (window as any).__meridian.game.state === 'playing', null, { timeout: 60_000 });
  const sp = await game<{ endX: number; endZ: number }>(page, `g.ui.closePanel(); g.settings.tutorial = false; g.setSpeed(0); g.hour = 11; const s = g.city.terrain.spawn; g.cam.jumpTo({ x: s.endX + 160, z: s.endZ + 140, distance: 700, pitch: 1.25, yaw: Math.PI / 2 }); return s;`);
  await frames(page, 6);
  const segs0 = await game<number>(page, 'return g.city.roads.segments.size;');
  await page.locator('.rail-btn[data-cat="roads"]').click();
  await page.locator('.tray .mode-btn', { hasText: 'Grid' }).click();
  const a = await screenOf(page, sp.endX, sp.endZ);
  const b = await screenOf(page, sp.endX + 270, sp.endZ);
  const c = await screenOf(page, sp.endX + 270, sp.endZ + 180);
  await page.mouse.click(a.x, a.y);
  await page.mouse.move(b.x, b.y);
  await frames(page, 2);
  await page.mouse.click(b.x, b.y);
  await page.mouse.move(c.x, c.y, { steps: 5 });
  await page.waitForTimeout(300);
  await frames(page, 3);
    console.log('LABEL', await page.locator('.cursor-label').innerText());
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(300);
  const segs1 = await game<number>(page, 'g.city.processRoadChanges(); return g.city.roads.segments.size;');
  console.log('SEGMENTS', segs0, '→', segs1);
  expect(segs1).toBeGreaterThan(segs0 + 10);
  await page.keyboard.press('Escape');
  await frames(page, 6);
    expect(errors).toEqual([]);
});

test('touch gestures', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await game(page, `g.ui.hideMenu(); g.state = 'playing'; g.ui.showHud(); g.settings.tutorial = false; g.setSpeed(0);
    const s = g.city.startPoint; g.cam.jumpTo({ x: s.x + 150, z: s.z, distance: 600, pitch: 0.9, yaw: 1.0 });
    window.__touch = (type, id, x, y) => g.canvas.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, isPrimary: id === 1 }));`);
  await frames(page, 3);
  const cam = () => game<{ d: number; yaw: number; x: number; z: number }>(page, `return { d: g.cam.goal.distance, yaw: g.cam.goal.yaw, x: g.cam.goal.x, z: g.cam.goal.z };`);
  const c0 = await cam();
  // Pinch out (fingers apart) zooms in; twist rotates.
  await game(page, `__touch('pointerdown', 1, 700, 450); __touch('pointerdown', 2, 900, 450);
    for (let k = 1; k <= 10; k++) { __touch('pointermove', 1, 700 - k * 15, 450 - k * 6); __touch('pointermove', 2, 900 + k * 15, 450 + k * 6); }
    __touch('pointerup', 1, 550, 390); __touch('pointerup', 2, 1050, 510);`);
  const c1 = await cam();
  console.log('PINCH', JSON.stringify(c0), JSON.stringify(c1));
  expect(c1.d).toBeLessThan(c0.d * 0.8);
  expect(Math.abs(c1.yaw - c0.yaw)).toBeGreaterThan(0.05);
  // One finger drag pans while inspecting.
  await game(page, `__touch('pointerdown', 3, 800, 450); for (let k = 1; k <= 10; k++) __touch('pointermove', 3, 800 + k * 20, 450); __touch('pointerup', 3, 1000, 450);`);
  const c2 = await cam();
  console.log('PAN', JSON.stringify(c2));
  expect(Math.hypot(c2.x - c1.x, c2.z - c1.z)).toBeGreaterThan(20);
  expect(await game<string>(page, 'return JSON.stringify(g.selection);')).toBe('null');
  // A tap selects what is under the finger.
  await game(page, `const b = [...g.city.buildings.all.values()].find((q) => q.kind === 'zoned' && q.floors >= 3); window.__tapB = b; g.cam.jumpTo({ x: b.cx, z: b.cz, distance: 160, pitch: 0.9, yaw: 1.0 });`);
  await frames(page, 3);
  // Measured once the camera has arrived.
  const target = await game<{ x: number; y: number }>(page, `const b = window.__tapB; return g.worldToScreen(b.cx, b.y + 6, b.cz);`);
  await game(page, `__touch('pointerdown', 4, ${target.x}, ${target.y}); __touch('pointerup', 4, ${target.x}, ${target.y});`);
  const sel = await game<string>(page, 'return JSON.stringify(g.selection);');
  console.log('TAP', sel);
  expect(JSON.parse(sel)?.kind).toBe('building');
  expect(errors).toEqual([]);
});

test('fireworks wait for nightfall', async ({ page }) => {
  const errors = trackErrors(page);
  await boot(page);
  await game(page, `g.ui.hideMenu(); g.state = 'playing'; g.ui.showHud(); g.settings.tutorial = false; g.setSpeed(0); g.hour = 13; g.celebrate(8);`);
  await page.waitForTimeout(1500);
  expect(await game<boolean>(page, 'return g.world.fireworks.busy;')).toBe(false);
  await game(page, `g.hour = 22; g.env.updateEnvironmentMap(true);`);
  await page.waitForTimeout(3500);
  const live = await game<number>(page, 'return g.world.fireworks.live;');
  console.log('FIREWORKS', live);
  expect(live).toBeGreaterThan(50);
  expect(errors).toEqual([]);
});

test('interface: rail, dock, layers, city info, inspector, notifications', async ({ page }) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await boot(page);
  await game(page, `g.ui.hideMenu(); g.state = 'playing'; g.ui.showHud(); g.settings.tutorial = false; g.setSpeed(0);`);
  // Build opens the dock on its last category; tabs switch the tool; Esc closes.
  await page.keyboard.press('KeyC');
  await expect(page.locator('.tray')).toBeVisible();
  await expect(page.locator('.tray-tab.active')).toHaveText('Roads');
  expect(await game<string>(page, 'return g.tool.id;')).toBe('road');
  await page.locator('.tray-tab[data-tab="zoning"]').click();
  expect(await game<string>(page, 'return g.tool.id;')).toBe('zone');
  await expect(page.locator('.rail-btn[data-cat="zoning"]')).toHaveClass(/active/);
  // Cards show rendered models of what they build (Dezone keeps its icon).
  await expect(page.locator('.tray .card-thumb.ready')).toHaveCount(8);
  expect(await page.locator('.tray .card-thumb.ready').first().getAttribute('src')).toMatch(/^data:image\/png/);
  // The dock keeps one size on every tab; longer rows scroll sideways instead.
  const dockSize = async () => { const b = (await page.locator('.tray').boundingBox())!; return `${Math.round(b.width)}x${Math.round(b.height)}`; };
  const size = await dockSize();
  for (const tab of ['roads', 'services', 'transit', 'landscaping', 'zoning']) {
    await page.locator(`.tray-tab[data-tab="${tab}"]`).click();
    expect(await dockSize(), tab).toBe(size);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('.tray')).toBeHidden();
  // Number keys 1–7 pick the main tools; Shift + 1–3 set the speed.
  await page.keyboard.press('Digit2');
  expect(await game<string>(page, 'return g.tool.id;')).toBe('road');
  await page.keyboard.press('Digit4');
  await expect(page.locator('.tray-tab.active')).toHaveText('Services');
  await page.keyboard.press('Digit7');
  await expect(page.locator('.tray-tab.active')).toHaveText('Landscaping');
  await page.keyboard.press('Digit1');
  await expect(page.locator('.tray')).toBeHidden();
  expect(await game<string>(page, 'return g.tool.id;')).toBe('inspect');
  await page.keyboard.press('Shift+Digit3');
  expect(await game<number>(page, 'return g.speed;')).toBe(3);
  await page.keyboard.press('Space');
  expect(await game<number>(page, 'return g.speed;')).toBe(0);
  await expect(page.locator('.minimap')).toHaveCount(0);
  // Utilities shortcut; parks & landmarks sit under Services; Landscaping is terrain.
  await page.keyboard.press('KeyU');
  await expect(page.locator('.tray-tab.active')).toHaveText('Utilities');
  await page.locator('.tray-tab[data-tab="services"]').click();
  await page.locator('.tray .mode-btn', { hasText: 'Parks & landmarks' }).click();
  await expect(page.locator('.tray-tab.active')).toHaveText('Services');
  await expect(page.locator('.tray .card', { hasText: 'Pocket Park' })).toHaveCount(1);
  await page.locator('.tray-tab[data-tab="landscaping"]').click();
  expect(await game<string>(page, 'return g.tool.id;')).toBe('terraform');
  await page.keyboard.press('Escape');
  // Map layers: switches are exclusive and drive the real overlay.
  await page.keyboard.press('KeyL');
  await page.locator('.layer-row[data-layer="traffic"]').click();
  expect(await game<string>(page, 'return g.world.overlays.mode;')).toBe('traffic');
  await page.locator('.layer-row[data-layer="noise"]').click();
  expect(await game<string>(page, 'return g.world.overlays.mode;')).toBe('noise');
  await expect(page.locator('.layer-row.active')).toHaveCount(1);
  await page.locator('.layer-row[data-layer="noise"]').click();
  expect(await game<string>(page, 'return g.world.overlays.mode;')).toBe('none');
  await page.keyboard.press('KeyL');
  await expect(page.locator('.layers-host .panel')).toBeHidden();
  // City info tabs and the inspector beneath it.
  await page.keyboard.press('KeyI');
  await page.locator('.ci-tab[data-panel="budget"]').click();
  await expect(page.locator('.ci-tab.active')).toHaveText('Budget');
  await expect(page.locator('.city-info .budget-hero')).toBeVisible();
  await game(page, `const b = [...g.city.buildings.all.values()].find((q) => q.kind === 'zoned' && q.state === 1 && q.zone <= 3); g.select({ kind: 'building', id: b.id });`);
  await expect(page.locator('.inspector .insp-occ')).toBeVisible();
  await expect(page.locator('.inspector .kv', { hasText: 'Tax revenue' })).toBeVisible();
  await expect(page.locator('.inspector .svc-dot')).toHaveCount(6);
  // Top bar indicators reflect the utility totals.
  const power = await game<string>(page, `const t = g.city.utilities.totals.power; return t.production > 0 ? Math.round(t.consumption / t.production * 100) + '%' : '—';`);
  await page.waitForTimeout(700);
  await expect(page.locator('.tb-util').first()).toContainText(power);
  // Notifications can be dismissed.
  await game(page, `g.ui.toast({ severity: 'warning', icon: 'power', title: 'Test notice', text: 'Dismiss me' });`);
  const toast = page.locator('.toast', { hasText: 'Test notice' });
  await toast.hover();
  await toast.locator('.toast-close').click();
  await expect(toast).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('placing police, fire or health highlights the ones already built', async ({ page }) => {
  await boot(page);
  const r = await game<string>(page, `
    g.ui.hideMenu(); g.state = 'playing'; g.ui.showHud(); g.settings.tutorial = false;
    const ids = (types) => [...g.city.buildings.all.values()].filter((b) => types.includes(b.typeId)).map((b) => b.id).sort((a, b) => a - b).join(',');
    const lit = () => [...g.world.buildings.highlights].filter(([, c]) => c === 5).map(([id]) => id).sort((a, b) => a - b).join(',');
    const out = [];
    for (const [t, same] of [['police_station', ['police_station']], ['fire_station', ['fire_station']], ['hospital', ['clinic', 'hospital']], ['water_tower', []]]) {
      g.setTool('place', (p) => p.configure(t));
      out.push(t + ':' + (lit() === ids(same) && (same.length === 0 || lit() !== '')));
    }
    g.setTool('inspect');
    out.push('cleared:' + (lit() === ''));
    return out.join(' ');`);
  expect(r).toBe('police_station:true fire_station:true hospital:true water_tower:true cleared:true');
});

test('clicking a demand bar opens its breakdown with fixes', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await boot(page);
  await game(page, `g.ui.hideMenu(); g.state = 'playing'; g.ui.showHud(); g.settings.tutorial = false; g.city.economy.taxes.commercial = 16; g.setSpeed(1);`);
  await expect.poll(() => game<number>(page, `return g.city.demand.factors.commercial.find((f) => f.label === 'Taxes')?.value ?? 0;`)).toBeLessThan(0);
  // Hovering alone does nothing; clicking the C bar opens the Commercial tab.
  await page.locator('.dbar', { hasText: 'C' }).hover();
  await expect(page.locator('.demand-pop')).toBeHidden();
  await page.locator('.dbar', { hasText: 'C' }).click();
  await expect(page.locator('.dp-tab.active')).toContainText('Commercial');
  const onTop = await page.evaluate(() => {
    const t = document.querySelector('.demand-pop')!.getBoundingClientRect();
    return !!document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2)?.closest('.demand-pop');
  });
  expect(onTop).toBe(true);
  // A problem explains itself and its button goes to the fix.
  await expect(page.locator('.dp-factor', { hasText: 'Taxes' })).toContainText('Commercial tax is 16%');
  await page.locator('.dp-factor', { hasText: 'Taxes' }).locator('.dp-fix').click();
  await expect(page.locator('.demand-pop')).toBeHidden();
  await expect(page.locator('.ci-tabs .active')).toContainText('Budget');
  // Tabs switch; the same bar again closes; Esc closes.
  await page.locator('.dbar', { hasText: 'R' }).click();
  await page.locator('.dp-tab[data-kind="industrial"]').click();
  await expect(page.locator('.dp-tab.active')).toContainText('Industrial');
  await page.locator('.dbar', { hasText: 'I' }).click();
  await expect(page.locator('.demand-pop')).toBeHidden();
  await page.locator('.dbar', { hasText: 'O' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.demand-pop')).toBeHidden();
});

test('free cam: Q / E switch dock tabs; right-drag looks around in place', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await boot(page);
  await game(page, `g.ui.hideMenu(); g.state = 'playing'; g.ui.showHud(); g.settings.tutorial = false; g.setSpeed(0); g.settings.cameraStyle = 'free';`);
  await page.locator('.rail-btn[data-cat="roads"]').click();
  await expect(page.locator('.tray-tab.active')).toHaveText('Roads');
  await page.keyboard.press('KeyE');
  await expect(page.locator('.tray-tab.active')).toHaveText('Zoning');
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('KeyQ');
  await expect(page.locator('.tray-tab.active')).toHaveText('Landscaping');
  // Holding Q / E no longer turns the camera.
  const yaw0 = await game<number>(page, 'return g.cam.goal.yaw;');
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyE');
  expect(await game<number>(page, 'return g.cam.goal.yaw;')).toBeCloseTo(yaw0, 5);
  await page.keyboard.press('Escape');
  // Right-drag turns the view but the camera itself stays put.
  await page.waitForTimeout(800);
  const before = await game<number[]>(page, 'const p = g.renderer.camera.position; return [p.x, p.z, g.cam.goal.yaw];');
  await page.mouse.move(640, 300);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(760, 300, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(1200);
  const after = await game<number[]>(page, 'const p = g.renderer.camera.position; return [p.x, p.z, g.cam.goal.yaw];');
  expect(Math.abs(after[2] - before[2])).toBeGreaterThan(0.3);
  expect(Math.hypot(after[0] - before[0], after[1] - before[1])).toBeLessThan(15);
  // Middle-drag pans.
  const t0 = await game<number[]>(page, 'return [g.cam.goal.x, g.cam.goal.z];');
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(800, 420, { steps: 8 });
  await page.mouse.up({ button: 'middle' });
  const t1 = await game<number[]>(page, 'return [g.cam.goal.x, g.cam.goal.z];');
  expect(Math.hypot(t1[0] - t0[0], t1[1] - t0[1])).toBeGreaterThan(20);
});

test('double-click glides to a spot; Home resets the view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await boot(page);
  await game(page, `g.ui.hideMenu(); g.state = 'playing'; g.ui.showHud(); g.settings.tutorial = false; g.setSpeed(0);`);
  await page.waitForTimeout(600);
  const t0 = await game<number[]>(page, 'return [g.cam.goal.x, g.cam.goal.z, g.cam.goal.distance];');
  await page.mouse.dblclick(1000, 250);
  await page.waitForTimeout(1500);
  const t1 = await game<number[]>(page, 'return [g.cam.goal.x, g.cam.goal.z, g.cam.goal.distance];');
  expect(Math.hypot(t1[0] - t0[0], t1[1] - t0[1])).toBeGreaterThan(50);
  expect(t1[2]).toBeLessThan(t0[2]);
  await game(page, 'g.cam.goal.yaw += 2; g.cam.goal.pitch = 0.4;');
  await page.keyboard.press('Home');
  const v = await game<number[]>(page, 'return [Math.cos(g.cam.goal.yaw - 0.45), g.cam.goal.pitch];');
  expect(v[0]).toBeCloseTo(1, 5);
  expect(v[1]).toBeCloseTo(0.95, 5);
});

test('classic camera style: right-drag pans, Q / E tap switches tabs and hold turns', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await boot(page);
  await game(page, `g.ui.hideMenu(); g.state = 'playing'; g.ui.showHud(); g.settings.tutorial = false; g.setSpeed(0); g.settings.cameraStyle = 'classic';`);
  await page.waitForTimeout(500);
  const t0 = await game<number[]>(page, 'return [g.cam.goal.x, g.cam.goal.z, g.cam.goal.yaw];');
  await page.mouse.move(640, 300);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(800, 420, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  const t1 = await game<number[]>(page, 'return [g.cam.goal.x, g.cam.goal.z, g.cam.goal.yaw];');
  expect(Math.hypot(t1[0] - t0[0], t1[1] - t0[1])).toBeGreaterThan(20);
  expect(t1[2]).toBeCloseTo(t0[2], 5);
  await page.locator('.rail-btn[data-cat="roads"]').click();
  await page.keyboard.press('KeyE');
  await expect(page.locator('.tray-tab.active')).toHaveText('Zoning');
  const yaw0 = await game<number>(page, 'return g.cam.goal.yaw;');
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyE');
  expect(await game<number>(page, 'return g.cam.goal.yaw;')).toBeGreaterThan(yaw0 + 0.3);
  await expect(page.locator('.tray-tab.active')).toHaveText('Zoning');
});

test('controls: keyboard map, layouts and rebinding', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await boot(page);
  await page.locator('.main-menu .menu-btn', { hasText: 'Controls' }).click();
  // Free, used and shared keys are told apart.
  await expect(page.locator('.kb-key.free[data-code="KeyO"]')).toHaveCount(1);
  await expect(page.locator('.kb-key.used[data-code="KeyT"]')).toHaveCount(1);
  await expect(page.locator('.kb-key.shared[data-code="KeyQ"]')).toHaveCount(1);
  // A 60% keyboard has no Home key, so Reset view is flagged.
  await page.locator('.kb-size').selectOption('60');
  await expect(page.locator('.kb-key[data-code="Home"]')).toHaveCount(0);
  await expect(page.locator('.kb-warn')).toContainText('Reset view');
  // Rebind Reset view to H; it saves and works in game.
  await page.locator('.kb-chip[data-action="camReset"][data-slot="0"]').click();
  await page.keyboard.press('KeyH');
  await expect(page.locator('.kb-warn')).toHaveCount(0);
  expect(await game<string[]>(page, `return g.settings.keybinds.camReset;`)).toEqual(['KeyH']);
  await page.locator('.modal.controls .btn', { hasText: 'Done' }).click();
  await game(page, `g.ui.hideMenu(); g.state = 'playing'; g.ui.showHud(); g.settings.tutorial = false; g.cam.goal.yaw += 2;`);
  await page.keyboard.press('KeyH');
  expect(await game<number>(page, 'return Math.cos(g.cam.goal.yaw - 0.45);')).toBeCloseTo(1, 5);
  await game(page, `g.keys.reset(); g.settings.keybinds = {};`);
});

test('classic is the default camera style', async ({ page }) => {
  await boot(page);
  expect(await game<string>(page, 'return g.settings.cameraStyle;')).toBe('classic');
});
