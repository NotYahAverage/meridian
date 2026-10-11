import { _electron as electron, expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const ELECTRON = path.join(ROOT, 'desktop', 'node_modules', 'electron');

/** Launches the Electron app on the production build and checks native saves. */
test('desktop app boots and saves to disk', async () => {
  test.skip(!fs.existsSync(ELECTRON) || !fs.existsSync(path.join(ROOT, 'dist', 'index.html')), 'run `npm --prefix desktop install` and `npm run build` first');
  test.setTimeout(180_000);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-e2e-'));
  // PACKAGED=1 tests the electron-builder output instead of the dev shell.
  const packaged = process.env.PACKAGED ? path.join(ROOT, 'desktop', 'release', 'win-unpacked', 'Meridian.exe') : null;
  const executablePath = packaged ?? ((await import(path.join(ELECTRON, 'index.js'))).default as unknown as string);
  const args = packaged ? ['--e2e'] : [path.join(ROOT, 'desktop'), '--e2e'];
  const app = await electron.launch({ executablePath, args, env: { ...process.env, MERIDIAN_USER_DATA: userData } });
  try {
    const win = await app.firstWindow();
    await expect(win.locator('.main-menu')).toBeVisible({ timeout: 90_000 });
    expect(await win.evaluate(() => typeof (window as any).meridianNative?.storage?.save)).toBe('function');
    expect(await win.title()).toContain('Meridian');
    // Start playing the menu town and save it through the native bridge.
    await win.evaluate(async () => {
      const g = (window as any).__meridian.game;
      g.ui.hideMenu();
      g.state = 'playing';
      g.slotId = 'desktop-e2e';
      if (!(await g.save())) throw new Error('save failed');
    });
    const files = fs.readdirSync(path.join(userData, 'saves'));
    expect(files).toContain('desktop-e2e.json.gz');
    expect(files).toContain('desktop-e2e.meta.json');
    const slots = await win.evaluate(() => (window as any).meridianNative.storage.list());
    expect(slots.map((s: { id: string }) => s.id)).toContain('desktop-e2e');
    const data = await win.evaluate(() => (window as any).meridianNative.storage.load('desktop-e2e'));
    expect(data.format).toBe('meridian-city');
    // Ids that try to leave the saves folder are rejected.
    await expect(win.evaluate(() => (window as any).meridianNative.storage.load('../evil'))).rejects.toThrow();
  } finally {
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

/** The window's close button lets the game offer to save first (packaged build only). */
test('closing the window offers to save', async () => {
  const exe = path.join(ROOT, 'desktop', 'release', 'win-unpacked', 'Meridian.exe');
  test.skip(!process.env.PACKAGED || !fs.existsSync(exe), 'packaged build only (PACKAGED=1)');
  test.setTimeout(180_000);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'meridian-e2e-'));
  const app = await electron.launch({ executablePath: exe, args: ['--e2e'], env: { ...process.env, MERIDIAN_USER_DATA: userData } });
  const win = await app.firstWindow();
  await expect(win.locator('.main-menu')).toBeVisible({ timeout: 90_000 });
  await win.evaluate(async () => { const g = (window as any).__meridian.game; await g.startNewCity({ name: 'Close Test', seed: 5, preset: 'coastal', unlimited: false }); g.settings.tutorial = false; });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect(win.locator('.modal-title', { hasText: 'Quit Meridian' })).toBeVisible();
  await win.locator('[data-choice="cancel"]').click();
  await win.waitForTimeout(500);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  const closed = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await win.locator('[data-choice="save"]').click();
  await closed;
  expect(fs.readdirSync(path.join(userData, 'saves')).some((f) => f.startsWith('city-5-') && f.endsWith('.json.gz'))).toBe(true);
});
