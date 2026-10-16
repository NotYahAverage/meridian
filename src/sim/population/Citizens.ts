import type { Population } from './Population';

/**
 * Individual people, derived on demand from the households that hold them.
 * A household stores only its size and up to two workers; who its members
 * are (names, ages, what they do) follows deterministically from the
 * household's slot and move-in tick, so nothing extra is saved and a person
 * keeps their identity for as long as the household lives in the city.
 */

const FIRST = [
  'Mara', 'Tomas', 'Ines', 'Yusuf', 'Lena', 'Arjun', 'Sofia', 'Kofi', 'Hana', 'Mateo', 'Ada', 'Felix', 'Nadia', 'Oskar', 'Priya', 'Jonas',
  'Amara', 'Leo', 'Rosa', 'Emil', 'Zara', 'Idris', 'Elif', 'Bruno', 'Noor', 'Theo', 'Mei', 'Samir', 'Greta', 'Rafael', 'Ayla', 'Viktor',
  'Lucia', 'Kenji', 'Freya', 'Omar', 'Talia', 'Hugo', 'Signe', 'Dario', 'Aiko', 'Benedikt', 'Chiara', 'Dmitri', 'Esme', 'Farah', 'Gideon',
  'Halima', 'Ilya', 'Jasmin', 'Kwame', 'Liv', 'Malik', 'Nina', 'Olu', 'Paloma', 'Quinn', 'Ravi', 'Saoirse', 'Tariq', 'Uma', 'Valentin',
  'Wen', 'Ximena', 'Yara', 'Zeno', 'Alba', 'Bao', 'Cosmin', 'Dalia', 'Eitan', 'Fatou', 'Goran', 'Helga', 'Imran', 'Juno', 'Kasia',
  'Lior', 'Marisol', 'Niko', 'Odile', 'Pavel', 'Rania', 'Soren', 'Thandi', 'Ugo', 'Vera', 'Wim', 'Yasmin', 'Zoltan', 'Anouk', 'Bilal',
  'Carmen', 'Desmond', 'Eun-ji', 'Florin', 'Gaia', 'Hamza', 'Isla', 'Jae', 'Karim', 'Lotte', 'Mirela', 'Nils', 'Orla', 'Pedro', 'Rin',
  'Salma', 'Tobias', 'Ulla', 'Vikram', 'Willa', 'Xavier', 'Yuki', 'Zainab', 'Aurelio', 'Birgit', 'Caio', 'Dunya', 'Elio', 'Femi', 'Giulia',
];

const FAMILY = [
  'Lindqvist', 'Okafor', 'Moreau', 'Haddad', 'Kowalski', 'Tanaka', 'Fernández', 'Mensah', 'Novak', 'Rossi', 'Iyer', 'Schmidt', 'Byrne',
  'Nakamura', 'Costa', 'Petrov', 'Adeyemi', 'Larsen', 'Duarte', 'Varga', 'Chen', 'Oyelaran', 'Bianchi', 'Kaplan', 'Sato', 'Murphy',
  'Hosseini', 'Andersen', 'Silva', 'Horvat', 'Nguyen', 'Brennan', 'Abdi', 'Kumar', 'Weber', 'Laurent', 'Mbeki', 'Svensson', 'Ortiz',
  'Yilmaz', 'Park', 'Dubois', 'Asante', 'Lehmann', 'Moretti', 'Nowak', 'Rahman', 'Eriksen', 'Gallagher', 'Castillo', 'Ivanova', 'Kim',
  'Achebe', 'Hoffmann', 'Marchetti', 'Sokolov', 'Takahashi', 'Quinlan', 'Reyes', 'Dahl', 'Farouk', 'Galvez', 'Holm', 'Ibrahim', 'Jansen',
  'Kovač', 'Lamarre', 'Mwangi', 'Nilsen', 'Oduya', 'Pires', 'Rinaldi', 'Sharma', 'Tran', 'Ueda', 'Vasquez', 'Wójcik', 'Xu', 'Yamada',
  'Zimmermann', 'Aalto', 'Bergström', 'Carvalho', 'Delacroix', 'Ekwueme', 'Fontaine', 'Grünewald', 'Hartmann', 'Ilić', 'Jovanović',
  'Kerr', 'Lund', 'Morales', 'Ndiaye', 'Olsen', 'Papadopoulos', 'Quispe', 'Romero', 'Sandoval', 'Toivonen', 'Uchenna', 'Valdés', 'Whitlock',
];

export type CitizenRole = 'worker' | 'jobseeker' | 'retired' | 'student' | 'pupil' | 'child' | 'carer';

export interface Citizen {
  first: string;
  family: string;
  age: number;
  role: CitizenRole;
  /** Workplace building id (0 if none). */
  job: number;
  /** Home building id. */
  home: number;
  household: number;
  member: number;
}

/** Small stable integer hash. */
export function mix(a: number, b: number, c = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

const unit = (h: number) => (h % 10007) / 10007;

/** Number of adults in a household (the rest are children). */
export function adultsIn(pop: Population, h: number): number {
  const size = pop.size[h], workers = pop.workers[h];
  if (workers === 0) return Math.min(size, 2);
  // A single worker often lives with a partner who stays home; two workers are the adults.
  if (workers === 1 && size >= 2 && unit(mix(h, pop.moveInTick[h], 77)) < 0.6) return 2;
  return Math.min(size, workers);
}

/** Who member `k` of household `h` is. */
export function citizenOf(pop: Population, h: number, k: number): Citizen {
  const tick = pop.moveInTick[h];
  const seed = mix(h, tick, k + 1);
  const hhSeed = mix(h, tick);
  const workers = pop.workers[h];
  const adults = adultsIn(pop, h);
  let role: CitizenRole;
  let age: number;
  let job = 0;
  if (k < workers) {
    job = pop.job[h * 2 + k];
    role = job ? 'worker' : 'jobseeker';
    age = 22 + Math.floor(unit(seed) * 42);
  } else if (k < adults) {
    if (workers === 0) {
      // Households without workers: mostly retirees, some students.
      const retired = unit(hhSeed >>> 3) < 0.65;
      role = retired ? 'retired' : 'student';
      age = retired ? 64 + Math.floor(unit(seed) * 26) : 19 + Math.floor(unit(seed) * 8);
    } else {
      role = 'carer';
      // Close in age to the household's worker.
      age = Math.max(20, Math.min(70, 22 + Math.floor(unit(mix(h, tick, 1)) * 42) + Math.floor(unit(seed) * 11) - 5));
    }
  } else {
    age = 1 + Math.floor(unit(seed) * 17);
    role = age >= 5 ? 'pupil' : 'child';
  }
  // Partners share the family name most of the time; children always do.
  const ownName = k > 0 && k < adults && unit(seed >>> 5) < 0.3;
  return {
    first: FIRST[seed % FIRST.length],
    family: FAMILY[(ownName ? seed >>> 7 : hhSeed) % FAMILY.length],
    age,
    role,
    job,
    home: pop.home[h],
    household: h,
    member: k,
  };
}

/** Height (relative to a 1.75 m adult) and build of a person of a given age, from their look seed. */
export function bodySize(age: number, look: number): { h: number; w: number } {
  const v = ((look >>> 8) % 1000) / 1000;
  const b = ((look >>> 18) % 1000) / 1000;
  const h = age < 5 ? 0.55 + v * 0.06 : age < 13 ? 0.62 + (age - 5) * 0.035 + v * 0.05 : age < 17 ? 0.88 + v * 0.1 : 0.93 + v * 0.14 - (age > 75 ? 0.04 : 0);
  return { h, w: 0.92 + b * 0.22 };
}

/** A stable seed for how a person looks (outfit, build). */
export function lookOf(pop: Population, h: number, k: number): number {
  return mix(h, pop.moveInTick[h], k + 101);
}
