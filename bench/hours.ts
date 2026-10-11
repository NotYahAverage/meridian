// Which hour of the day is slowest in a big city (after growing it).
import { tickCity } from '../src/sim/CitySim';
import { buildBigCity } from './cityBuilder';
const city = buildBigCity(Number(process.env.SIZE ?? 3600), 100, true);
for (let i = 0; i < 24 * Number(process.env.DAYS ?? 100); i++) tickCity(city);
const sum = new Float64Array(24), worst = new Float64Array(24);
for (let d = 0; d < 10; d++) for (let h = 0; h < 24; h++) {
  const hour = city.clock.hour;
  const t = performance.now();
  tickCity(city);
  const ms = performance.now() - t;
  sum[hour] += ms / 10;
  worst[hour] = Math.max(worst[hour], ms);
}
console.log(`pop ${city.population.residents}`);
for (let h = 0; h < 24; h++) console.log(`hour ${h}: avg ${sum[h].toFixed(1)} worst ${worst[h].toFixed(1)}`);
