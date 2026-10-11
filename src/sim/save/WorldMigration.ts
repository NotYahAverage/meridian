import { base64ToBytes, bytesToBase64, decodeFloat32, encodeTyped, rleDecode, rleEncode } from '../../core/encoding';
import { CORE_OFFSET, CORE_SIZE, GRID_CELL, HM_RES, HM_STEP, WORLD_SIZE, ZONE_CELL } from '../constants';
import { REGIONAL_ROAD_NAME } from '../roads/RoadTypes';
import { LAND_TILE, LAND_TILES } from '../world/Land';
import type { EditRuns } from '../world/Terraform';
import type { SaveData } from './Serializer';

/** Size of the world before it grew (the starting map is the old world). */
const OLD = CORE_SIZE;
const O = CORE_OFFSET;

/** Copies an old square grid (cell size `cell`) into the middle of a new one. */
function embed<T extends Uint8Array | Float32Array>(old: T, cell: number, make: (n: number) => T, plusOne = false): T {
  const on = OLD / cell + (plusOne ? 1 : 0);
  const nn = WORLD_SIZE / cell + (plusOne ? 1 : 0);
  const off = O / cell;
  const out = make(nn * nn);
  for (let z = 0; z < on; z++) out.set(old.subarray(z * on, z * on + on), (z + off) * nn + off);
  return out;
}

function embedRle(b64: string, cell: number, plusOne = false): string {
  const on = OLD / cell + (plusOne ? 1 : 0);
  return rleEncode(embed(rleDecode(b64, on * on), cell, (n) => new Uint8Array(n), plusOne));
}

function embedFloat(b64: string, cell: number): string {
  const old = decodeFloat32(b64);
  const on = OLD / cell;
  if (old.length !== on * on) return '';
  return encodeTyped(embed(new Float32Array(old), cell, (n) => new Float32Array(n)));
}

/** Terrain edit runs index the old heightmap; split them into rows of the new one. */
function embedRuns(runs: EditRuns): EditRuns {
  const on = OLD / HM_STEP + 1;
  const off = O / HM_STEP;
  const out: EditRuns = [];
  for (const [start, b64] of runs) {
    const bytes = base64ToBytes(b64);
    const vals = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    let k = 0;
    while (k < vals.length) {
      const i = start + k;
      const ix = i % on, iz = Math.floor(i / on);
      const len = Math.min(vals.length - k, on - ix);
      const part = Int16Array.from(vals.subarray(k, k + len));
      out.push([(iz + off) * HM_RES + ix + off, bytesToBase64(new Uint8Array(part.buffer))]);
      k += len;
    }
  }
  return out;
}

/** Moves every {x, z} found in news editions (map links in articles). */
function shiftPoints(v: unknown): void {
  if (!v || typeof v !== 'object') return;
  if (Array.isArray(v)) {
    for (const e of v) shiftPoints(e);
    return;
  }
  const o = v as Record<string, unknown>;
  if (typeof o.x === 'number' && typeof o.z === 'number') {
    o.x += O;
    o.z += O;
  }
  for (const k of Object.keys(o)) shiftPoints(o[k]);
}

/**
 * Version 3: the world is four times bigger. The old map becomes its middle,
 * so everything in the save moves by the same offset; the highway is
 * extended out to the new edge of the world.
 */
export function migrateToBigWorld(d: SaveData): SaveData {
  const near = (v: number) => v < 1 || v > OLD - 1;
  // Roads
  const nodes = d.roads.nodes.map(([id, x, z, out]) => [id, x + O, z + O, out] as [number, number, number, 0 | 1]);
  const segments = d.roads.segments.map((s) => {
    const c = [...s] as typeof s;
    c[4] += O;
    c[5] += O;
    return c;
  });
  let nextNodeId = d.roads.nextNodeId;
  let nextSegId = d.roads.nextSegId;
  for (const n of [...nodes]) {
    if (!n[3]) continue;
    const ox = n[1] - O, oz = n[2] - O;
    if (!near(ox) && !near(oz)) continue;
    // Out to the nearest edge of the new world, straight on from the old one.
    const dists: [number, number, number][] = [[ox, 0, n[2]], [OLD - ox, WORLD_SIZE, n[2]], [oz, n[1], 0], [OLD - oz, n[1], WORLD_SIZE]];
    dists.sort((a, b) => a[0] - b[0]);
    const [, ex, ez] = dists[0];
    const edge = [nextNodeId++, ex, ez, 1] as [number, number, number, 0 | 1];
    n[3] = 0;
    nodes.push(edge);
    const name = segments.find((s) => s[1] === n[0] || s[2] === n[0])?.[6] ?? REGIONAL_ROAD_NAME;
    segments.push([nextSegId++, edge[0], n[0], 'highway', (ex + n[1]) / 2, (ez + n[2]) / 2, name, 0]);
  }
  const roundabouts = d.roads.roundabouts?.map(([id, x, z, r]) => [id, x + O, z + O, r] as [number, number, number, number]);

  // Buildings
  const buildings = d.buildings.map((b) => {
    const c = [...b] as typeof b;
    c[5] += O;
    c[6] += O;
    return c;
  });

  // Land: older saves without any owned the whole old map.
  const owned = new Array<number>(LAND_TILES * LAND_TILES).fill(0);
  const ot = OLD / LAND_TILE, off = O / LAND_TILE;
  for (let z = 0; z < ot; z++) for (let x = 0; x < ot; x++) owned[(z + off) * LAND_TILES + x + off] = d.land ? (d.land.owned[z * ot + x] ? 1 : 0) : 1;
  const land = d.land?.rings && d.land.cx !== undefined && d.land.cz !== undefined
    ? { owned, bought: d.land.bought, rings: true, cx: d.land.cx + off, cz: d.land.cz + off }
    : { owned, bought: 0 };

  // Trees: natural ones keep their indices; planted ones move.
  let nature = d.nature;
  if (nature?.planted) {
    const data = new Float32Array(decodeFloat32(nature.planted));
    for (let i = 0; i < data.length; i += 5) {
      data[i] += O;
      data[i + 1] += O;
    }
    nature = { ...nature, planted: encodeTyped(data) };
  }

  const transit = structuredClone(d.transit);
  for (const st of transit.stops) {
    st.x += O;
    st.z += O;
  }
  const news = d.news ? structuredClone(d.news) : d.news;
  if (news) shiftPoints(news.editions);
  const edits = d.terrainEdits && {
    base: embedRuns(d.terrainEdits.base),
    road: embedRuns(d.terrainEdits.road),
    soil: d.terrainEdits.soil ? embedRle(d.terrainEdits.soil, HM_STEP, true) : undefined,
  };

  return {
    ...d,
    version: 3,
    roads: { nodes, segments, roundabouts, nextNodeId, nextSegId },
    buildings,
    zones: embedRle(d.zones, ZONE_CELL),
    landValue: { value: embedFloat(d.landValue.value, GRID_CELL), pollution: embedFloat(d.landValue.pollution, GRID_CELL) },
    districts: { ...d.districts, grid: embedRle(d.districts.grid, GRID_CELL) },
    transit,
    news,
    terrainEdits: edits,
    land,
    nature,
  };
}
