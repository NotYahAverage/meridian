// Where do educated workers work? (office staffing diagnostics)
import fs from 'node:fs';
import { loadFromJSON } from '../src/sim/save/Serializer';
import { Zone } from '../src/sim/types';
const city = loadFromJSON(fs.readFileSync(process.argv[2] ?? 'bench/.out/bigcity.save.json', 'utf8'));
const pop = city.population;
const by = new Map<string, number>();
let edu = 0, eduEmployed = 0, workers = 0;
for (let i = 0; i < pop.count; i++) {
  if (!pop.alive[i]) continue;
  for (let k = 0; k < pop.workers[i]; k++) {
    workers++;
    const educated = k < pop.educated[i];
    if (educated) edu++;
    const j = pop.job[i * 2 + k];
    const b = j ? city.buildings.get(j) : undefined;
    const where = b ? (b.kind === 'service' ? 'service' : Zone[b.zone]) : 'unemployed';
    if (educated && b) eduEmployed++;
    const key = `${educated ? 'edu' : 'basic'}:${where}`;
    by.set(key, (by.get(key) ?? 0) + 1);
  }
}
let officeJobs = 0, officeFilled = 0;
for (const b of city.buildings.all.values()) if (b.zone === Zone.Office) { officeJobs += b.jobs; officeFilled += b.workers; }
console.log({ workers, edu, eduEmployed, officeJobs, officeFilled });
console.log([...by].sort().map(([k, v]) => `${k} ${v}`).join('\n'));
