// Prints the budget and key stats of the saved benchmark city.
import fs from 'node:fs';
import { projectEconomy } from '../src/sim/CitySim';
import { loadFromJSON } from '../src/sim/save/Serializer';
const city = loadFromJSON(fs.readFileSync(process.argv[2] ?? 'bench/.out/bigcity.save.json', 'utf8'));
projectEconomy(city);
const p = city.economy.projection;
const fmt = (o: Record<string, number | undefined>) => Object.entries(o).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([k, v]) => `  ${k.padEnd(18)} ${Math.round(v ?? 0).toLocaleString().padStart(10)}`).join('\n');
const s = city.stats;
console.log(`pop ${s.population} hh ${s.households} jobs ${s.jobs} employed ${s.employed}/${s.workers} happy ${s.happiness.toFixed(0)} services ${[...city.buildings.all.values()].filter((b) => b.kind === 'service').length} roads ${(([...city.roads.segments.values()].reduce((a, x) => a + x.length, 0)) / 1000).toFixed(1)} km`);
console.log('INCOME\n' + fmt(p.income) + '\nEXPENSE\n' + fmt(p.expense));
console.log('net', Math.round(city.economy.projectedNet), 'per resident', (city.economy.projectedNet / Math.max(1, s.population)).toFixed(2));
