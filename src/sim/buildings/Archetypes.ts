import { Zone } from '../types';

export type ZonedStyle =
  | 'hotel'
  | 'house'
  | 'townhouse'
  | 'lowrise'
  | 'midrise'
  | 'tower'
  | 'shop'
  | 'stripmall'
  | 'mixeduse'
  | 'bigbox'
  | 'office'
  | 'officeTower'
  | 'workshop'
  | 'warehouse'
  | 'factory'
  | 'depot'
  | 'modernHouse'
  | 'gasStation'
  | 'diner'
  | 'supermarket'
  | 'officeCampus'
  | 'greenhouse';

export type ServiceStyle =
  | 'police'
  | 'fire'
  | 'clinic'
  | 'hospital'
  | 'school'
  | 'highschool'
  | 'university'
  | 'cargoPort'
  | 'landfill'
  | 'recycling'
  | 'parkSmall'
  | 'plaza'
  | 'parkTown'
  | 'parkLarge'
  | 'sportsField'
  | 'communityGarden'
  | 'sportsCourts'
  | 'botanicalGarden'
  | 'wind'
  | 'coal'
  | 'solar'
  | 'waterTower'
  | 'pump'
  | 'outfall'
  | 'treatment'
  | 'busDepot'
  | 'metroStation'
  | 'airport'
  | 'cityHall'
  | 'museum'
  | 'cathedral'
  | 'stadium'
  | 'obsTower'
  | 'policeHQ'
  | 'library'
  | 'incinerator'
  | 'gasPlant'
  | 'nuclear'
  | 'purification';

/** Styles composed procedurally: research centres ("lab:<field>") and discovered designs ("arch:<id>"). */
export type ProceduralStyle = `lab:${string}` | `arch:${string}`;

export type StyleId = ZonedStyle | ServiceStyle | ProceduralStyle;

export interface Archetype {
  id: string;
  zone: Zone;
  style: ZonedStyle;
  frontage: [number, number];
  depth: [number, number];
  floors: [number, number];
  levels: [number, number];
  weight: number;
}

export const ARCHETYPES: Archetype[] = [
  // Low-density residential
  { id: 'house_small', zone: Zone.ResLow, style: 'house', frontage: [14, 17], depth: [24, 30], floors: [1, 1], levels: [1, 1], weight: 1 },
  { id: 'house_family', zone: Zone.ResLow, style: 'house', frontage: [16, 20], depth: [26, 32], floors: [1, 2], levels: [1, 2], weight: 1.2 },
  { id: 'house_large', zone: Zone.ResLow, style: 'house', frontage: [20, 24], depth: [30, 36], floors: [2, 2], levels: [2, 3], weight: 1 },
  { id: 'house_modern', zone: Zone.ResLow, style: 'modernHouse', frontage: [18, 24], depth: [30, 36], floors: [2, 2], levels: [2, 3], weight: 0.6 },
  // Medium-density residential
  { id: 'townhouse_row', zone: Zone.ResMed, style: 'townhouse', frontage: [22, 32], depth: [24, 30], floors: [2, 3], levels: [1, 3], weight: 1.2 },
  { id: 'lowrise_apts', zone: Zone.ResMed, style: 'lowrise', frontage: [26, 34], depth: [28, 36], floors: [3, 4], levels: [1, 2], weight: 1 },
  { id: 'midrise_apts', zone: Zone.ResMed, style: 'midrise', frontage: [30, 38], depth: [30, 38], floors: [5, 6], levels: [2, 3], weight: 0.8 },
  // High-density residential
  { id: 'apartment_block', zone: Zone.ResHigh, style: 'midrise', frontage: [32, 40], depth: [32, 40], floors: [6, 9], levels: [1, 2], weight: 1 },
  { id: 'res_tower', zone: Zone.ResHigh, style: 'tower', frontage: [32, 40], depth: [34, 40], floors: [10, 18], levels: [1, 2], weight: 1 },
  { id: 'res_tower_tall', zone: Zone.ResHigh, style: 'tower', frontage: [36, 40], depth: [36, 40], floors: [16, 30], levels: [2, 3], weight: 0.9 },
  // Commercial
  { id: 'corner_shop', zone: Zone.Commercial, style: 'shop', frontage: [14, 20], depth: [18, 26], floors: [1, 2], levels: [1, 2], weight: 1.2 },
  { id: 'strip_mall', zone: Zone.Commercial, style: 'stripmall', frontage: [36, 48], depth: [34, 40], floors: [1, 1], levels: [1, 2], weight: 0.8 },
  { id: 'mixed_use', zone: Zone.Commercial, style: 'mixeduse', frontage: [22, 30], depth: [24, 32], floors: [3, 5], levels: [2, 3], weight: 1 },
  { id: 'big_box', zone: Zone.Commercial, style: 'bigbox', frontage: [48, 60], depth: [38, 40], floors: [1, 1], levels: [1, 3], weight: 0.45 },
  { id: 'gas_station', zone: Zone.Commercial, style: 'gasStation', frontage: [26, 32], depth: [26, 32], floors: [1, 1], levels: [1, 2], weight: 0.35 },
  { id: 'diner', zone: Zone.Commercial, style: 'diner', frontage: [22, 30], depth: [24, 32], floors: [1, 1], levels: [1, 3], weight: 0.6 },
  { id: 'supermarket', zone: Zone.Commercial, style: 'supermarket', frontage: [40, 52], depth: [38, 40], floors: [1, 1], levels: [1, 3], weight: 0.45 },
  // Hotels only appear near attractions (see Spawner.tourismAt), never by chance.
  { id: 'hotel', zone: Zone.Commercial, style: 'hotel', frontage: [30, 40], depth: [32, 40], floors: [6, 14], levels: [2, 3], weight: 0 },
  // Office
  { id: 'office_low', zone: Zone.Office, style: 'office', frontage: [28, 36], depth: [30, 38], floors: [3, 6], levels: [1, 2], weight: 1 },
  { id: 'office_mid', zone: Zone.Office, style: 'office', frontage: [32, 40], depth: [32, 40], floors: [7, 12], levels: [2, 3], weight: 0.9 },
  { id: 'office_tower', zone: Zone.Office, style: 'officeTower', frontage: [36, 40], depth: [36, 40], floors: [14, 34], levels: [2, 3], weight: 0.8 },
  { id: 'office_campus', zone: Zone.Office, style: 'officeCampus', frontage: [40, 52], depth: [38, 40], floors: [2, 4], levels: [1, 3], weight: 0.6 },
  // Industrial
  { id: 'workshop', zone: Zone.Industrial, style: 'workshop', frontage: [20, 26], depth: [26, 32], floors: [1, 1], levels: [1, 2], weight: 1 },
  { id: 'warehouse', zone: Zone.Industrial, style: 'warehouse', frontage: [32, 44], depth: [36, 40], floors: [1, 1], levels: [1, 3], weight: 1.1 },
  { id: 'factory', zone: Zone.Industrial, style: 'factory', frontage: [40, 52], depth: [38, 40], floors: [1, 1], levels: [1, 3], weight: 0.9 },
  { id: 'depot', zone: Zone.Industrial, style: 'depot', frontage: [30, 40], depth: [34, 40], floors: [1, 1], levels: [1, 2], weight: 0.6 },
  { id: 'greenhouse', zone: Zone.Industrial, style: 'greenhouse', frontage: [34, 44], depth: [36, 40], floors: [1, 1], levels: [1, 2], weight: 0.5 },
  // High-density commercial
  { id: 'dept_store', zone: Zone.CommercialHigh, style: 'mixeduse', frontage: [30, 38], depth: [32, 40], floors: [5, 8], levels: [1, 3], weight: 1 },
  { id: 'mall', zone: Zone.CommercialHigh, style: 'bigbox', frontage: [52, 60], depth: [38, 40], floors: [1, 1], levels: [1, 2], weight: 0.5 },
  { id: 'hotel_tower', zone: Zone.CommercialHigh, style: 'hotel', frontage: [32, 40], depth: [34, 40], floors: [10, 18], levels: [2, 3], weight: 0.6 },
  { id: 'retail_tower', zone: Zone.CommercialHigh, style: 'officeTower', frontage: [36, 40], depth: [36, 40], floors: [12, 26], levels: [2, 3], weight: 0.7 },
  // Light industry
  { id: 'light_workshop', zone: Zone.IndustrialLight, style: 'workshop', frontage: [20, 28], depth: [26, 34], floors: [1, 1], levels: [1, 2], weight: 1 },
  { id: 'urban_farm', zone: Zone.IndustrialLight, style: 'greenhouse', frontage: [34, 44], depth: [36, 40], floors: [1, 1], levels: [1, 2], weight: 0.8 },
  { id: 'tech_park', zone: Zone.IndustrialLight, style: 'officeCampus', frontage: [40, 52], depth: [38, 40], floors: [2, 3], levels: [1, 3], weight: 0.9 },
];

export const ARCHETYPE_BY_ID = new Map(ARCHETYPES.map((a) => [a.id, a]));

export function archetypesFor(zone: Zone, level: number): Archetype[] {
  return ARCHETYPES.filter((a) => a.zone === zone && level >= a.levels[0] && level <= a.levels[1]);
}

export interface Capacity {
  households: number;
  jobs: number;
}

const LEVEL_JOB = [0, 1, 1.25, 1.5];

export function capacityFor(style: ZonedStyle, w: number, d: number, floors: number, level: number): Capacity {
  const lj = LEVEL_JOB[Math.max(1, Math.min(3, level))];
  switch (style) {
    case 'house':
      return { households: 1, jobs: 0 };
    case 'townhouse':
      return { households: Math.max(2, Math.floor(w / 6.5)) * (floors >= 3 ? 1 : 1), jobs: 0 };
    case 'lowrise':
    case 'midrise':
      return { households: Math.max(4, Math.floor((w * 0.72 * d * 0.55) / 88) * floors), jobs: 0 };
    case 'tower':
      return { households: Math.max(20, Math.floor((Math.min(w, d) * 0.62) ** 2 / 92) * floors), jobs: 0 };
    case 'shop':
      return { households: 0, jobs: Math.round(5 * floors * lj) };
    case 'hotel':
      return { households: 0, jobs: Math.round((10 + floors * 3) * lj) };
    case 'stripmall':
      return { households: 0, jobs: Math.round(w * 0.45 * lj) };
    case 'mixeduse':
      return { households: 0, jobs: Math.round((10 + floors * 6) * lj) };
    case 'bigbox':
      return { households: 0, jobs: Math.round(48 * lj) };
    case 'office':
      return { households: 0, jobs: Math.round(((w * 0.75 * d * 0.6) / 30) * floors * lj * 0.55) };
    case 'officeTower':
      return { households: 0, jobs: Math.round(((Math.min(w, d) * 0.62) ** 2 / 26) * floors * lj * 0.55) };
    case 'workshop':
      return { households: 0, jobs: Math.round(12 * lj) };
    case 'warehouse':
      return { households: 0, jobs: Math.round(22 * lj) };
    case 'factory':
      return { households: 0, jobs: Math.round(48 * lj) };
    case 'depot':
      return { households: 0, jobs: Math.round(16 * lj) };
    case 'modernHouse':
      return { households: 1, jobs: 0 };
    case 'gasStation':
      return { households: 0, jobs: Math.round(8 * lj) };
    case 'diner':
      return { households: 0, jobs: Math.round(12 * lj) };
    case 'supermarket':
      return { households: 0, jobs: Math.round(40 * lj) };
    case 'officeCampus':
      return { households: 0, jobs: Math.round(((w * d * 0.35) / 30) * floors * lj * 0.55) };
    case 'greenhouse':
      return { households: 0, jobs: Math.round(18 * lj) };
  }
}

/** Average household size by zone. */
export function householdSize(zone: Zone): number {
  switch (zone) {
    case Zone.ResLow:
      return 3.1;
    case Zone.ResMed:
      return 2.5;
    case Zone.ResHigh:
      return 2.0;
    default:
      return 0;
  }
}
