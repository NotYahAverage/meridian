import { ROAD_TYPES, type RoadTypeId } from '../roads/RoadTypes';
import { SERVICE_TYPES } from '../services/ServiceTypes';
import { Zone, ZONE_INFO } from '../types';

export interface Milestone {
  population: number;
  title: string;
  reward: number;
}

export const MILESTONES: Milestone[] = [
  { population: 0, title: 'Settlement', reward: 0 },
  { population: 500, title: 'Village', reward: 15_000 },
  { population: 1_000, title: 'Small Town', reward: 25_000 },
  { population: 2_500, title: 'Town', reward: 40_000 },
  { population: 6_000, title: 'City', reward: 60_000 },
  { population: 12_000, title: 'Large City', reward: 90_000 },
  { population: 25_000, title: 'Metropolis', reward: 150_000 },
  { population: 50_000, title: 'Megalopolis', reward: 250_000 },
];

export const ZONE_UNLOCK: Record<Zone, number> = {
  [Zone.None]: 0,
  [Zone.ResLow]: 0,
  [Zone.ResMed]: 0,
  [Zone.ResHigh]: 2_500,
  [Zone.Commercial]: 0,
  [Zone.Office]: 1_000,
  [Zone.Industrial]: 0,
  [Zone.CommercialHigh]: 4_000,
  [Zone.IndustrialLight]: 1_500,
};

export function milestoneIndexFor(peak: number): number {
  let idx = 0;
  for (let i = 0; i < MILESTONES.length; i++) if (peak >= MILESTONES[i].population) idx = i;
  return idx;
}

/** Population at which buses (stops, lines, depots) become available. */
export const TRANSIT_UNLOCK = 1_000;

/** Human-readable list of what a milestone unlocks. */
export function unlocksAt(population: number): string[] {
  const out: string[] = [];
  for (const rt of Object.values(ROAD_TYPES)) if (rt.unlockPopulation === population && population > 0) out.push(rt.name);
  for (const [z, p] of Object.entries(ZONE_UNLOCK)) {
    if (p === population && population > 0) {
      out.push(Number(z) === Zone.Office ? 'Office zoning' : Number(z) === Zone.ResHigh ? 'High-density residential' : ZONE_INFO[Number(z) as Zone].name);
    }
  }
  for (const s of SERVICE_TYPES) if (s.unlockPopulation === population && population > 0) out.push(s.name);
  if (population === TRANSIT_UNLOCK) out.push('Bus stops & lines');
  if (population === 5_000) out.push('Metro lines');
  return out;
}

export function roadUnlocked(type: RoadTypeId, peak: number): boolean {
  return peak >= ROAD_TYPES[type].unlockPopulation;
}

export interface Goal {
  id: string;
  title: string;
  hint: string;
  reward: number;
}

export const GOALS: Goal[] = [
  { id: 'connect', title: 'Connect to the highway', hint: 'Open the Roads menu and draw a street starting from the end of the highway.', reward: 2_000 },
  { id: 'zoneRes', title: 'Zone homes', hint: 'Use Zoning → Low-Density Residential and paint along your new streets.', reward: 2_000 },
  { id: 'zoneJobs', title: 'Zone workplaces', hint: 'Paint some Commercial and Industrial zones so residents have jobs.', reward: 2_000 },
  { id: 'power', title: 'Generate electricity', hint: 'Place Wind Turbines next to a connected road (Utilities).', reward: 3_000 },
  { id: 'water', title: 'Supply water', hint: 'Build a Water Tower, or a Pumping Station on the shoreline.', reward: 3_000 },
  { id: 'sewage', title: 'Handle sewage', hint: 'Place a Sewage Outfall near water, downstream of your pumps.', reward: 3_000 },
  { id: 'pop100', title: 'Welcome 100 residents', hint: 'Keep zoning and watch homes fill up.', reward: 5_000 },
  { id: 'service', title: 'Provide a city service', hint: 'Build a Fire Station, Police Station, Clinic or School.', reward: 4_000 },
  { id: 'park', title: 'Plant a park', hint: 'Parks raise land value — and happier residents pay more.', reward: 2_000 },
  { id: 'design', title: 'Design a building', hint: 'Open the Design Studio and describe a building in your own words, then save it to the sketchbook.', reward: 3_000 },
  { id: 'pop500', title: 'Grow to 500 residents', hint: 'Balance housing, jobs and services as the demand bars change.', reward: 8_000 },
  { id: 'prototype', title: 'Build a prototype', hint: 'In the Design Studio, choose Build prototype and place it beside a road. People will tell you what they think.', reward: 6_000 },
  { id: 'bus', title: 'Run a bus line', hint: 'At 1,000 residents open Transit: build a Bus Depot, place stops and connect them into a line.', reward: 10_000 },
  { id: 'policy', title: 'Enact a city policy', hint: 'Open City Policies on the left and switch one on — recycling and smoke detectors are good starts.', reward: 5_000 },
  { id: 'adopt', title: 'Adopt a style', hint: 'When a prototype gets its verdict, adopt it: your city starts building in its style, and it spreads from there.', reward: 10_000 },
  { id: 'landmark', title: 'Build a landmark', hint: 'Landmarks like the City Hall (Parks tray) lift the whole area and bring tourists.', reward: 15_000 },
  { id: 'movement', title: 'Found a movement', hint: 'Let your adopted styles take hold across the city until a movement is born, with a signature landmark of its own.', reward: 30_000 },
  { id: 'pop6000', title: 'Become a city of 6,000', hint: 'Keep services ahead of growth; offices need educated workers from high schools.', reward: 25_000 },
  { id: 'metro', title: 'Open a metro line', hint: 'From 5,000 residents build Metro Stations (Transit) at least 240 m apart and join them with the Metro Line tool.', reward: 30_000 },
];
