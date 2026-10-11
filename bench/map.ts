// Writes a top-down PNG of the benchmark city's zoning and lots (bench/.out/map.png).
import { tickCity } from '../src/sim/CitySim';
import { buildBigCity } from './cityBuilder';
import { writePng } from './png';
const city = buildBigCity();
for (let i = 0; i < 24 * Number(process.env.DAYS ?? 120); i++) tickCity(city);
const zm = city.zones;
const sp = city.terrain.spawn;
const x0 = Math.floor((sp.endX - 20) / 4), z0 = Math.floor((sp.endZ - 820) / 4);
const W = 420, H = 420;
const rgb = new Uint8Array(W * H * 3);
const zc = [[60, 60, 60], [120, 200, 120], [70, 170, 70], [30, 120, 30], [90, 140, 230], [180, 120, 230], [230, 200, 70]];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (z0 + y) * zm.res + (x0 + x);
  let c = zc[zm.zone[i]] ?? [0, 0, 0];
  if (zm.roadCover[i]) c = [20, 20, 20];
  else if (zm.occupant[i]) c = c.map((v) => v * 0.45);
  else if (!zm.zonable[i]) c = [200, 200, 190];
  rgb.set(c, (y * W + x) * 3);
}
writePng('bench/.out/map.png', W, H, rgb);
console.log('written');
