// Builds a city on real terrain, edits it, and writes a save plus a signature of where everything is.
import fs from 'node:fs';
import { tickCity } from '../src/sim/CitySim';
import { saveToJSON } from '../src/sim/save/Serializer';
import { plantTrees } from '../src/sim/CityCommands';
import { terraform } from '../src/sim/world/Terraform';
import { buildBigCity } from './cityBuilder';
const city = buildBigCity(900, 100, false);
for (let i = 0; i < 24 * 20; i++) tickCity(city);
const sp = city.terrain.spawn;
terraform(city, { mode: 'raise', x: sp.endX + 1300, z: sp.endZ - 700, radius: 60, strength: 3 });
plantTrees(city, sp.endX + 1250, sp.endZ - 600, 30, 8);
const nat = city.nature;
const alive: number[] = [];
for (let i = 0; i < nat.naturalCount; i++) if (nat.alive[i]) alive.push(i);
const sig = {
  buildings: [...city.buildings.all.values()].map((b) => [b.id, b.cx, b.cz, Math.round(city.terrain.heightAt(b.cx, b.cz) * 100) / 100]),
  hill: Math.round(city.terrain.heightAt(sp.endX + 1300, sp.endZ - 700) * 100) / 100,
  naturalAlive: alive.length,
  naturalRemoved: nat.naturalCount - alive.length,
  sampleTrees: alive.filter((_, k) => k % 997 === 0).map((i) => [i, nat.x[i], nat.z[i]]),
  planted: nat.count - nat.naturalCount,
  pop: city.population.residents,
  segs: city.roads.segments.size,
};
fs.writeFileSync(process.argv[2] + '.save.json', saveToJSON(city));
fs.writeFileSync(process.argv[2] + '.sig.json', JSON.stringify(sig));
console.log('saved', sig.buildings.length, 'buildings', sig.pop, 'pop', sig.naturalRemoved, 'trees removed');
