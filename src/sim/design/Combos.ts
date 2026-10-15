import type { FeatureId, WallKind } from '../style/Movements';
import type { Concept } from './Concept';
import type { GroupId } from './Tastes';

/**
 * Combos: recipes architects recognise. A design that puts the right ideas
 * together (trees on every floor of a tower; stone, ornament and a mansard
 * roof) is more than the sum of its parts: people notice, and a style built
 * on it carries a gameplay effect once the city adopts it.
 */

export interface ComboTraits {
  /** Homes and jobs in new buildings in the style (×). */
  capacity?: number;
  /** Jobs only (offices and shops) (×). */
  jobs?: number;
  /** Construction speed (×). */
  speed?: number;
  /** Happiness of the people living and working in it. */
  mood?: number;
  /** Share of smog its residents shrug off (planting, clean power). */
  clean?: number;
  /** Monthly tourism per building in the style ($). */
  tourism?: number;
}

export interface ComboDef {
  id: string;
  name: string;
  blurb: string;
  /** A clue while it is undiscovered. */
  hint: string;
  icon: string;
  traits: ComboTraits;
  /** What the traits do, in words. */
  effect: string;
  /** Groups who especially love it. */
  fans: GroupId[];
  test: (c: Concept) => boolean;
}

const has = (c: Concept, ...f: FeatureId[]) => f.some((x) => c.look.features.includes(x));
const wall = (c: Concept, ...w: WallKind[]) => w.includes(c.look.wall);
const tall = (c: Concept) => c.height === 'tall' || c.height === 'sky';
const low = (c: Concept) => c.height === 'house' || c.height === 'row' || c.height === 'low';
const homes = (c: Concept) => c.use === 'homes' || c.use === 'mixed';

export const COMBOS: ComboDef[] = [
  {
    id: 'verticalForest', name: 'Vertical Forest', icon: 'tree', fans: ['green'],
    blurb: 'A tower clothed in trees, with gardens in the sky.',
    hint: 'Something tall, with trees on every floor and gardens up in the air.',
    traits: { clean: 0.4, mood: 3 }, effect: 'Its residents shrug off 40% of smog, and are happier.',
    test: (c) => tall(c) && has(c, 'planters') && has(c, 'skyGarden', 'roofGarden'),
  },
  {
    id: 'gardenCity', name: 'Garden City', icon: 'parks', fans: ['family', 'green', 'locals'],
    blurb: 'Low homes, gardens on the roofs and green between them.',
    hint: 'Small homes with planted roofs and somewhere green to sit outside.',
    traits: { mood: 5 }, effect: 'People living in it are much happier.',
    test: (c) => low(c) && homes(c) && (has(c, 'greenRoof', 'roofGarden') || c.look.roof === 'green') && has(c, 'courtyard', 'balconies', 'terraces'),
  },
  {
    id: 'megablock', name: 'Brutalist Megablock', icon: 'factory', fans: ['business', 'modern'],
    blurb: 'Raw concrete, stacked high and deep. Cheap, dense and unapologetic.',
    hint: 'Raw concrete, big and cheap, with heavy walls or deep loggias.',
    traits: { capacity: 1.25, speed: 1.3 }, effect: 'New buildings in it hold 25% more and go up 30% faster.',
    test: (c) => wall(c, 'beton') && !low(c) && has(c, 'monumental', 'loggias') && c.level <= 2,
  },
  {
    id: 'beauxArts', name: 'Beaux-Arts', icon: 'museum', fans: ['heritage'],
    blurb: 'Dressed stone, carved ornament and a grand roof: a building to be photographed.',
    hint: 'Stone, carved detail and a grand roof, perhaps with an arcade.',
    traits: { tourism: 35, mood: 2 }, effect: 'Each building in it draws $35 a month in tourism.',
    test: (c) => wall(c, 'stone') && has(c, 'ornament') && (c.look.roof === 'mansard' || has(c, 'arcade', 'monumental')),
  },
  {
    id: 'solarVillage', name: 'Solar Village', icon: 'sun', fans: ['green', 'family'],
    blurb: 'Houses that make their own power, in warm timber under living roofs.',
    hint: 'Houses or rows with solar panels, in timber or under green roofs.',
    traits: { clean: 0.25, mood: 3 }, effect: 'Its residents shrug off 25% of smog, and are happier.',
    test: (c) => (c.height === 'house' || c.height === 'row') && has(c, 'solarSkin') && (wall(c, 'timber') || c.look.roof === 'green' || has(c, 'greenRoof')),
  },
  {
    id: 'highTech', name: 'High-Tech', icon: 'office', fans: ['modern', 'business'],
    blurb: 'Glass and steel, structure on show, floors that float.',
    hint: 'Glass offices with daring structure: overhangs, columns or sun fins.',
    traits: { jobs: 1.2 }, effect: 'New offices and shops in it hold 20% more jobs.',
    test: (c) => wall(c, 'glass') && (c.use === 'offices' || tall(c)) && has(c, 'cantilever', 'pilotis', 'briseSoleil'),
  },
  {
    id: 'workersHousing', name: 'Workers’ Housing', icon: 'people', fans: ['family', 'business'],
    blurb: 'Factory-made flats with a balcony each, for people who need a home now.',
    hint: 'Affordable flats in prefab panels, each with somewhere to sit outside.',
    traits: { speed: 2, capacity: 1.1 }, effect: 'New buildings in it go up twice as fast and hold 10% more.',
    test: (c) => wall(c, 'panel') && c.level === 1 && homes(c) && has(c, 'balconies', 'loggias'),
  },
  {
    id: 'arcology', name: 'Arcology', icon: 'metro', fans: ['modern', 'green'],
    blurb: 'A city in one building: homes, shops, gardens and its own clean power.',
    hint: 'A skyscraper of homes over shops, with gardens and its own power.',
    traits: { capacity: 1.2, clean: 0.3 }, effect: 'New buildings in it hold 20% more; residents shrug off 30% of smog.',
    test: (c) => c.height === 'sky' && c.use === 'mixed' && has(c, 'skyGarden', 'terraces') && has(c, 'solarSkin', 'windCrown'),
  },
  {
    id: 'marketStreet', name: 'Market Street', icon: 'shop', fans: ['business', 'heritage'],
    blurb: 'Shops under an arcade, homes above, in brick, stone or render.',
    hint: 'Shops under an arcade, not too tall, in a traditional material.',
    traits: { jobs: 1.25, tourism: 15 }, effect: 'New shops in it hold 25% more jobs, and draw $15 a month in visitors.',
    test: (c) => (c.use === 'shops' || c.use === 'mixed') && has(c, 'arcade') && !tall(c) && wall(c, 'brick', 'stone', 'render'),
  },
  {
    id: 'hillside', name: 'Hillside Terraces', icon: 'terrain', fans: ['green', 'family'],
    blurb: 'Floors stepping back into planted terraces, like a hillside village.',
    hint: 'A building that steps back floor by floor, with planting on every step.',
    traits: { mood: 4, clean: 0.2 }, effect: 'People living in it are happier, and shrug off 20% of smog.',
    test: (c) => (c.look.massing === 'terraced' || has(c, 'terraces')) && has(c, 'planters', 'greenRoof', 'roofGarden') && !tall(c),
  },
];
export const COMBO_BY_ID = new Map(COMBOS.map((c) => [c.id, c]));

/** The combos a design achieves. */
export function combosOf(c: Concept): string[] {
  return COMBOS.filter((x) => x.test(c)).map((x) => x.id);
}

/** Traits of several combos together (multipliers multiply, the rest add). */
export function mergeTraits(ids: string[]): ComboTraits {
  const t: Required<ComboTraits> = { capacity: 1, jobs: 1, speed: 1, mood: 0, clean: 0, tourism: 0 };
  for (const id of ids) {
    const c = COMBO_BY_ID.get(id)?.traits;
    if (!c) continue;
    t.capacity *= c.capacity ?? 1;
    t.jobs *= c.jobs ?? 1;
    t.speed *= c.speed ?? 1;
    t.mood += c.mood ?? 0;
    t.clean = Math.min(0.8, t.clean + (c.clean ?? 0));
    t.tourism += c.tourism ?? 0;
  }
  return t;
}
