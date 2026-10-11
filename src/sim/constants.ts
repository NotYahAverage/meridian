/** World extent in meters (square). The whole map spans [0, WORLD_SIZE]². */
export const WORLD_SIZE = 6144;

/**
 * The original map: the terrain is generated in its units, and cities start in
 * it. It sits in the middle of the world; the land around it is bought later.
 */
export const CORE_SIZE = 3072;
export const CORE_OFFSET = (WORLD_SIZE - CORE_SIZE) / 2;

/** Heightmap vertex spacing in meters. */
export const HM_STEP = 4;
export const HM_RES = WORLD_SIZE / HM_STEP + 1;

/** Render/sim chunk size in meters. */
export const CHUNK_SIZE = 256;
export const CHUNKS = WORLD_SIZE / CHUNK_SIZE;

/** Zoning grid resolution. */
export const ZONE_CELL = 4;
export const ZONE_RES = WORLD_SIZE / ZONE_CELL;

/** Coarse analysis grid (coverage, land value, pollution, districts). */
export const GRID_CELL = 16;
export const GRID_RES = WORLD_SIZE / GRID_CELL;

export const WATER_LEVEL = 0;

/** How far from a road edge land can be zoned. */
export const ZONE_DEPTH = 40;

export const TICKS_PER_DAY = 24;
export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const TICKS_PER_MONTH = TICKS_PER_DAY * DAYS_PER_MONTH;

/** Real seconds per simulation tick (one game hour) at 1× speed. */
export const TICK_SECONDS = 0.2;

/** Visual day/night cycle length in real seconds at 1× speed. */
export const DAY_CYCLE_SECONDS = 480;

export const MAX_VEHICLES = 3200;

export const START_MONEY = 260_000;
