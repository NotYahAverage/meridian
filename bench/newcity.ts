// Time to create a new city on real terrain (and to load a saved one).
import { City } from '../src/sim/City';
const t0 = performance.now();
const c = new City({ name: 'T', seed: 3, preset: 'coastal' });
console.log('new city ms', Math.round(performance.now() - t0), 'trees', c.nature.count);
