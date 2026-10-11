export enum Zone {
  None = 0,
  ResLow = 1,
  ResMed = 2,
  ResHigh = 3,
  Commercial = 4,
  Office = 5,
  Industrial = 6,
  /** Hotels, department stores and retail towers (counts as commercial). */
  CommercialHigh = 7,
  /** Clean workshops, greenhouses and research parks (counts as industrial, little pollution). */
  IndustrialLight = 8,
}

export const ZONE_COUNT = 9;

export type DemandKind = 'residential' | 'commercial' | 'industrial' | 'office';

export function zoneDemandKind(z: Zone): DemandKind | null {
  switch (zoneBase(z)) {
    case Zone.ResLow:
    case Zone.ResMed:
    case Zone.ResHigh:
      return 'residential';
    case Zone.Commercial:
      return 'commercial';
    case Zone.Office:
      return 'office';
    case Zone.Industrial:
      return 'industrial';
    default:
      return null;
  }
}

/** The zone a variant behaves as for demand, jobs and taxes (high-density commercial is commercial, light industry is industrial). */
export function zoneBase(z: Zone): Zone {
  return z === Zone.CommercialHigh ? Zone.Commercial : z === Zone.IndustrialLight ? Zone.Industrial : z;
}

export function isResidential(z: Zone): boolean {
  return z === Zone.ResLow || z === Zone.ResMed || z === Zone.ResHigh;
}

export const ZONE_INFO: Record<Zone, { name: string; short: string; color: [number, number, number] }> = {
  [Zone.None]: { name: 'Unzoned', short: '—', color: [0, 0, 0] },
  [Zone.ResLow]: { name: 'Low-Density Residential', short: 'R1', color: [0.36, 0.78, 0.38] },
  [Zone.ResMed]: { name: 'Medium-Density Residential', short: 'R2', color: [0.2, 0.62, 0.3] },
  [Zone.ResHigh]: { name: 'High-Density Residential', short: 'R3', color: [0.09, 0.46, 0.25] },
  [Zone.Commercial]: { name: 'Commercial', short: 'C', color: [0.27, 0.56, 0.95] },
  [Zone.Office]: { name: 'Office', short: 'O', color: [0.62, 0.45, 0.95] },
  [Zone.Industrial]: { name: 'Industrial', short: 'I', color: [0.96, 0.72, 0.2] },
  [Zone.CommercialHigh]: { name: 'High-Density Commercial', short: 'C2', color: [0.14, 0.36, 0.86] },
  [Zone.IndustrialLight]: { name: 'Light Industry', short: 'I2', color: [0.98, 0.86, 0.46] },
};

export enum BuildingState {
  Construction = 0,
  Active = 1,
  Abandoned = 2,
  Burning = 3,
  Collapsed = 4,
}

/** Bit flags describing what a building lacks. */
export const Problem = {
  NoPower: 1,
  NoWater: 2,
  NoSewage: 4,
  Garbage: 8,
  NoRoad: 16,
  Crime: 32,
  Pollution: 64,
  NoWorkers: 128,
  NoCustomers: 256,
  Fire: 512,
  NoGoods: 1024,
  Sickness: 2048,
} as const;

export type GameSpeed = 0 | 1 | 2 | 3;
export const SPEED_MULT: Record<GameSpeed, number> = { 0: 0, 1: 1, 2: 2.5, 3: 6 };
