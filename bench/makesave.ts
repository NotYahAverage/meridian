// Grows the benchmark city on real terrain and writes a save for render tests.
import fs from 'node:fs';
import { tickCity } from '../src/sim/CitySim';
import { saveToJSON } from '../src/sim/save/Serializer';
import { buildBigCity } from './cityBuilder';
const city = buildBigCity(1600, 100, false);
const days = Number(process.env.DAYS ?? 160);
for (let i = 0; i < 24 * days; i++) tickCity(city);
fs.mkdirSync('bench/.out', { recursive: true });
fs.writeFileSync('bench/.out/bigcity.save.json', saveToJSON(city));
console.log(`saved: pop ${city.population.residents}, ${city.buildings.count} buildings, ${city.roads.segments.size} segments`);
