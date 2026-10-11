// Works out a band of heightmap rows for a new or loaded city (see generateBaseParallel).
import { Terrain, generateBaseRows, type MapPreset } from './Terrain';

self.onmessage = (e: MessageEvent<{ seed: number; preset: MapPreset; iz0: number; iz1: number }>) => {
  const { seed, preset, iz0, iz1 } = e.data;
  const rows = generateBaseRows(new Terrain(seed, preset, { shapeOnly: true }), iz0, iz1);
  (self as unknown as Worker).postMessage({ iz0, rows }, [rows.buffer]);
};
