import { HM_RES } from '../constants';
import type { MapPreset } from './Terrain';

/**
 * Generates a map's heightmap on several background threads at once (the
 * slowest part of starting or loading a city on the large world). Resolves to
 * undefined if workers aren't available, and the city then generates it itself.
 */
export async function generateBaseParallel(seed: number, preset: MapPreset): Promise<Float32Array | undefined> {
  if (typeof Worker === 'undefined') return undefined;
  const threads = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
  const base = new Float32Array(HM_RES * HM_RES);
  const workers: Worker[] = [];
  try {
    const rowsPer = Math.ceil(HM_RES / threads);
    const jobs: Promise<void>[] = [];
    for (let k = 0; k < threads; k++) {
      const iz0 = k * rowsPer, iz1 = Math.min(HM_RES, iz0 + rowsPer);
      if (iz0 >= iz1) break;
      const w = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
      workers.push(w);
      jobs.push(new Promise<void>((resolve, reject) => {
        w.onmessage = (e: MessageEvent<{ iz0: number; rows: Float32Array }>) => {
          base.set(e.data.rows, e.data.iz0 * HM_RES);
          resolve();
        };
        w.onerror = (e) => reject(e instanceof ErrorEvent ? e.error ?? new Error(e.message) : new Error('terrain worker failed'));
        w.postMessage({ seed, preset, iz0, iz1 });
      }));
    }
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('terrain workers timed out')), 30_000));
    await Promise.race([Promise.all(jobs), timeout]);
    return base;
  } catch (e) {
    console.warn('Generating terrain on this thread instead:', e);
    return undefined;
  } finally {
    for (const w of workers) w.terminate();
  }
}
