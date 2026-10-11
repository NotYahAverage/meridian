// Large-city simulation benchmark: grows a ~25k-resident city headlessly and
// reports tick times. Run with `npm run bench` (DAYS=n to change the length).
import { tickCity } from '../src/sim/CitySim';
import { serializeCity } from '../src/sim/save/Serializer';
import { buildBigCity } from './cityBuilder';

function fmt(ms: number): string {
  return ms.toFixed(1).padStart(7);
}

const city = buildBigCity();
city.economy.money = 1e9;
const t0 = performance.now();
let slow = 0;
const days = Number(process.env.DAYS ?? 240);
for (let day = 1; day <= days; day++) {
  const ds = performance.now();
  let worst = 0;
  for (let h = 0; h < 24; h++) {
    const s = performance.now();
    tickCity(city);
    const d = performance.now() - s;
    worst = Math.max(worst, d);
    if (d > 33) slow++;
  }
  // Exercise live traffic as the game would at speed 3 (about 1 s of sim per hour).
  for (let f = 0; f < 10; f++) city.live.update(1 / 60, 6, (day * 24) % 24 + 8);
  const de = performance.now() - ds;
  if (day % 20 === 0) {
    console.log(
      `day ${String(day).padStart(4)}: pop ${String(city.population.residents).padStart(6)} bldg ${String(city.buildings.count).padStart(5)} ` +
        `veh ${String(city.vehicles.count).padStart(4)} day ${fmt(de)} ms worst tick ${fmt(worst)} ms`,
    );
  }
}
console.log(`total ${((performance.now() - t0) / 1000).toFixed(1)} s, ticks over 33 ms: ${slow}`);

// Live traffic cost per frame at the end state.
const lt = performance.now();
for (let f = 0; f < 600; f++) city.live.update(1 / 60, 6, 8);
console.log(`live traffic: ${((performance.now() - lt) / 600).toFixed(2)} ms/frame with ${city.vehicles.count} vehicles`);
const st = performance.now();
const save = serializeCity(city);
console.log(`save: ${(performance.now() - st).toFixed(0)} ms, ${(JSON.stringify(save).length / 1024).toFixed(0)} KB`);
