export type RoadTypeId = 'lane' | 'street' | 'avenue' | 'boulevard' | 'parkway' | 'highway' | 'expressway';

export interface RoadType {
  id: RoadTypeId;
  name: string;
  description: string;
  /** Lanes per direction. */
  lanes: number;
  laneWidth: number;
  /** Width of the central median (0 = painted centre line). */
  median: number;
  medianKind: 'paint' | 'double' | 'grass' | 'barrier';
  /** Asphalt beyond the outermost lane (gutter / shoulder). */
  gutter: number;
  /** Sidewalk width on each side (0 for highways). */
  sidewalk: number;
  /** Grass verge beyond sidewalk/shoulder. */
  verge: number;
  /** Speed limit in m/s. */
  speed: number;
  /** Vehicles per hour per lane. */
  capacityPerLane: number;
  costPerMeter: number;
  /** Monthly upkeep per meter. */
  upkeepPerMeter: number;
  zoning: boolean;
  /** Junctions involving this road are signalised. */
  signals: boolean;
  /** Traffic noise factor for land value. */
  noise: number;
  unlockPopulation: number;
  /** Grade-separated freeway class (highway, expressway): no buses, services or roundabouts. */
  freeway: boolean;
  /** Centre markings: 0 dashed white, 1 double yellow, 2 yellow edge at a median, 3 none. */
  markings: 0 | 1 | 2 | 3;
  /** Painted edge lines along the outer lanes. */
  edgeLines: boolean;
  /** Street lamps: on one side (alternating), both sides, or down the median. */
  lamps: 'one' | 'both' | 'median';
  /** Derived. */
  asphaltHalf: number;
  halfWidth: number;
  speedKmh: number;
}

function make(t: Omit<RoadType, 'asphaltHalf' | 'halfWidth' | 'speedKmh'>): RoadType {
  const asphaltHalf = t.median / 2 + t.lanes * t.laneWidth + t.gutter;
  return {
    ...t,
    asphaltHalf,
    halfWidth: asphaltHalf + t.sidewalk + t.verge,
    speedKmh: Math.round(t.speed * 3.6),
  };
}

export const ROAD_TYPES: Record<RoadTypeId, RoadType> = {
  street: make({
    id: 'street',
    name: 'Street',
    description: 'Two-lane neighbourhood street with sidewalks. Cheap and zonable.',
    lanes: 1,
    laneWidth: 3.5,
    median: 0,
    medianKind: 'paint',
    gutter: 1.0,
    sidewalk: 2.5,
    verge: 0,
    speed: 40 / 3.6,
    capacityPerLane: 650,
    costPerMeter: 40,
    upkeepPerMeter: 0.35,
    zoning: true,
    signals: false,
    noise: 0.25,
    unlockPopulation: 0,
    freeway: false,
    markings: 0,
    edgeLines: false,
    lamps: 'one',
  }),
  avenue: make({
    id: 'avenue',
    name: 'Avenue',
    description: 'Four-lane avenue for busier corridors. Signalised junctions.',
    lanes: 2,
    laneWidth: 3.4,
    median: 0.6,
    medianKind: 'double',
    gutter: 0.8,
    sidewalk: 3,
    verge: 0,
    speed: 50 / 3.6,
    capacityPerLane: 850,
    costPerMeter: 85,
    upkeepPerMeter: 0.7,
    zoning: true,
    signals: true,
    noise: 0.55,
    unlockPopulation: 0,
    freeway: false,
    markings: 1,
    edgeLines: true,
    lamps: 'both',
  }),
  boulevard: make({
    id: 'boulevard',
    name: 'Boulevard',
    description: 'Six-lane tree-lined boulevard with a planted median. High capacity.',
    lanes: 3,
    laneWidth: 3.3,
    median: 4,
    medianKind: 'grass',
    gutter: 0.7,
    sidewalk: 3.5,
    verge: 0,
    speed: 60 / 3.6,
    capacityPerLane: 950,
    costPerMeter: 150,
    upkeepPerMeter: 1.2,
    zoning: true,
    signals: true,
    noise: 0.8,
    unlockPopulation: 1000,
    freeway: false,
    markings: 2,
    edgeLines: true,
    lamps: 'both',
  }),
  highway: make({
    id: 'highway',
    name: 'Highway',
    description: 'Fast four-lane expressway. No zoning or sidewalks; noisy.',
    lanes: 2,
    laneWidth: 3.6,
    median: 2.4,
    medianKind: 'barrier',
    gutter: 2.5,
    sidewalk: 0,
    verge: 1.5,
    speed: 90 / 3.6,
    capacityPerLane: 1700,
    costPerMeter: 220,
    upkeepPerMeter: 1.8,
    zoning: false,
    signals: true,
    noise: 1.0,
    unlockPopulation: 2500,
    freeway: true,
    markings: 2,
    edgeLines: true,
    lamps: 'median',
  }),
  lane: make({
    id: 'lane',
    name: 'Lane',
    description: 'Narrow, quiet residential lane with slim sidewalks. The cheapest zonable road; slow and low capacity.',
    lanes: 1,
    laneWidth: 3.0,
    median: 0,
    medianKind: 'paint',
    gutter: 0.6,
    sidewalk: 1.8,
    verge: 0,
    speed: 30 / 3.6,
    capacityPerLane: 420,
    costPerMeter: 25,
    upkeepPerMeter: 0.22,
    zoning: true,
    signals: false,
    noise: 0.12,
    unlockPopulation: 0,
    freeway: false,
    markings: 3,
    edgeLines: false,
    lamps: 'one',
  }),
  parkway: make({
    id: 'parkway',
    name: 'Parkway',
    description: 'Scenic four-lane road with a wide planted median and grass verges. Fast and fairly quiet; no zoning or sidewalks.',
    lanes: 2,
    laneWidth: 3.5,
    median: 6,
    medianKind: 'grass',
    gutter: 1.4,
    sidewalk: 0,
    verge: 2.5,
    speed: 70 / 3.6,
    capacityPerLane: 1150,
    costPerMeter: 140,
    upkeepPerMeter: 1.0,
    zoning: false,
    signals: true,
    noise: 0.5,
    unlockPopulation: 1500,
    freeway: false,
    markings: 2,
    edgeLines: true,
    lamps: 'both',
  }),
  expressway: make({
    id: 'expressway',
    name: 'Expressway',
    description: 'Six-lane freeway for heavy regional traffic. Can be raised on piers. Very noisy; no zoning.',
    lanes: 3,
    laneWidth: 3.6,
    median: 3,
    medianKind: 'barrier',
    gutter: 2.5,
    sidewalk: 0,
    verge: 1.5,
    speed: 100 / 3.6,
    capacityPerLane: 1800,
    costPerMeter: 340,
    upkeepPerMeter: 2.6,
    zoning: false,
    signals: true,
    noise: 1.2,
    unlockPopulation: 8000,
    freeway: true,
    markings: 2,
    edgeLines: true,
    lamps: 'median',
  }),
};

/** The pre-built regional highway; maintained by the region, not the city. */
export const REGIONAL_ROAD_NAME = 'Meridian Expressway';

export const ROAD_TYPE_LIST: RoadType[] = [ROAD_TYPES.lane, ROAD_TYPES.street, ROAD_TYPES.avenue, ROAD_TYPES.boulevard, ROAD_TYPES.parkway, ROAD_TYPES.highway, ROAD_TYPES.expressway];

/** Highway-class roads (highway, expressway). */
export function isFreeway(type: RoadTypeId): boolean {
  return ROAD_TYPES[type].freeway;
}

/** Lateral offset of a lane centre from the road centreline (positive = right of travel). */
export function laneOffset(t: RoadType, lane: number): number {
  return t.median / 2 + (lane + 0.5) * t.laneWidth;
}

/** Road types that can be made one-way (undivided roads). */
export function canBeOneWay(type: RoadTypeId): boolean {
  return type === 'lane' || type === 'street' || type === 'avenue';
}

/** Lane offset from the centreline on a one-way road (all lanes flow one way, left to right). */
export function onewayLaneOffset(t: RoadType, lane: number): number {
  const n = t.lanes * 2;
  return (lane + 0.5 - n / 2) * t.laneWidth;
}

export function segmentCapacity(t: RoadType): number {
  return t.lanes * 2 * t.capacityPerLane;
}
