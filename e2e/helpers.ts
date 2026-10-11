import { type Page, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export const SHOTS = path.join(process.cwd(), 'e2e', 'screenshots');

export async function shot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

/** Collects console errors and uncaught exceptions for later assertions. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

export async function boot(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await expect(page.locator('.main-menu')).toBeVisible({ timeout: 90_000 });
  await page.waitForFunction(() => (window as any).__meridian?.game?.state === 'menu');
}

/** Evaluates inside the page with the game handle. */
export async function game<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(async () => { const m = window.__meridian; const g = m.game; const C = m.CityCommands; ${fn} })()`) as Promise<T>;
}

/** Screen position (CSS px) of a world point on the ground. */
export async function screenOf(page: Page, x: number, z: number): Promise<{ x: number; y: number; visible: boolean }> {
  return game(page, `return g.worldToScreen(${x}, g.city.terrain.heightAt(${x}, ${z}), ${z});`);
}

export async function frames(page: Page, n = 3): Promise<void> {
  await page.evaluate((k) => new Promise<void>((res) => {
    let i = 0;
    const f = () => (++i >= k ? res() : requestAnimationFrame(f));
    requestAnimationFrame(f);
  }), n);
}
