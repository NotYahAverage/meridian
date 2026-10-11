import type { Building } from '../../sim/buildings/Buildings';
import type { City } from '../../sim/City';
import { GRID_CELL, GRID_RES, ZONE_CELL, ZONE_RES } from '../../sim/constants';
import type { CoverageKind } from '../../sim/services/ServiceTypes';
import { BuildingState, ZONE_INFO, Zone, isResidential } from '../../sim/types';
import type { BuildingRenderer } from '../buildings/BuildingRenderer';
import type { RoadRenderer } from '../roads/RoadRenderer';
import { globalUniforms } from '../shared';
import type { TerrainRenderer } from '../terrain/TerrainRenderer';

export type OverlayId =
  | 'none'
  | 'traffic'
  | 'landValue'
  | 'pollution'
  | 'noise'
  | 'police'
  | 'fire'
  | 'health'
  | 'education'
  | 'garbage'
  | 'park'
  | 'power'
  | 'water'
  | 'happiness'
  | 'districts'
  | 'transit';

export const OVERLAYS: { id: OverlayId; label: string; group: string; legend: [string, string] }[] = [
  { id: 'traffic', label: 'Traffic', group: 'City', legend: ['Free flowing', 'Gridlock'] },
  { id: 'landValue', label: 'Land Value', group: 'City', legend: ['Low', 'High'] },
  { id: 'happiness', label: 'Happiness', group: 'City', legend: ['Unhappy', 'Happy'] },
  { id: 'districts', label: 'Districts', group: 'City', legend: ['', ''] },
  { id: 'transit', label: 'Public Transit', group: 'City', legend: ['Far from a stop', 'Short walk'] },
  { id: 'pollution', label: 'Pollution', group: 'Environment', legend: ['Clean', 'Polluted'] },
  { id: 'noise', label: 'Noise', group: 'Environment', legend: ['Quiet', 'Loud'] },
  { id: 'power', label: 'Electricity', group: 'Utilities', legend: ['No power', 'Powered'] },
  { id: 'water', label: 'Water & Sewage', group: 'Utilities', legend: ['No service', 'Served'] },
  { id: 'police', label: 'Police', group: 'Services', legend: ['None', 'Full coverage'] },
  { id: 'fire', label: 'Fire', group: 'Services', legend: ['None', 'Full coverage'] },
  { id: 'health', label: 'Healthcare', group: 'Services', legend: ['None', 'Full coverage'] },
  { id: 'education', label: 'Education', group: 'Services', legend: ['None', 'Full coverage'] },
  { id: 'garbage', label: 'Garbage', group: 'Services', legend: ['None', 'Full coverage'] },
  { id: 'park', label: 'Parks', group: 'Services', legend: ['None', 'Full coverage'] },
];

const COVER_COLORS: Record<CoverageKind, [number, number, number]> = {
  police: [60, 130, 255],
  fire: [255, 80, 50],
  health: [255, 110, 170],
  education: [170, 110, 255],
  garbage: [170, 190, 60],
  park: [60, 210, 110],
};

function ramp(t: number): [number, number, number] {
  // red → yellow → green
  const x = Math.max(0, Math.min(1, t));
  if (x < 0.5) return [230, Math.round(60 + 340 * x), 40];
  return [Math.round(230 - 380 * (x - 0.5)), 210, Math.round(40 + 100 * (x - 0.5))];
}

/** Maintains the zone/data overlay textures and per-building overlay tints. */
export class Overlays {
  mode: OverlayId = 'none';
  /** 0–1 visibility of the zonable-area hint (zoning tool). */
  zonableHint = 0;
  private timer = 0;
  private zoneVersion = -1;
  private zoneTimer = 0;

  constructor(private city: City, private terrain: TerrainRenderer, private roads: RoadRenderer, private buildings: BuildingRenderer) {}

  set(mode: OverlayId): void {
    this.mode = mode;
    this.timer = 0;
    const bldMode = mode === 'power' || mode === 'water' || mode === 'happiness';
    this.buildings.uniforms.uBldOverlay.value = bldMode ? 1 : 0;
    this.buildings.overlayValue = bldMode ? this.buildingValue(mode) : null;
    this.roads.uniforms.uTrafficOverlay.value = mode === 'traffic' ? 1 : 0;
    globalUniforms.uDesat.value = mode === 'none' ? 0 : bldMode ? 0.4 : 0.75;
    this.terrain.uniforms.uOverlayOpacity.value = mode === 'none' || mode === 'traffic' || bldMode ? 0 : 0.78;
    this.buildings.updateState(0, true);
    if (mode === 'traffic') this.roads.updateTraffic();
  }

  private buildingValue(mode: OverlayId): (b: Building) => number {
    if (mode === 'happiness') {
      return (b) => (b.kind === 'zoned' && b.state === BuildingState.Active ? 1 + Math.round((b.happiness / 100) * 254) : 0);
    }
    if (mode === 'power') return (b) => (b.kind === 'zoned' && b.state === BuildingState.Active ? (b.power ? 255 : 1) : 0);
    return (b) => (b.kind === 'zoned' && b.state === BuildingState.Active ? (b.water && b.sewage ? 255 : b.water || b.sewage ? 128 : 1) : 0);
  }

  update(dt: number): void {
    this.zoneTimer -= dt;
    if (this.city.zones.version !== this.zoneVersion && this.zoneTimer <= 0) {
      const first = !this.zonesWritten;
      this.zoneVersion = this.city.zones.version;
      this.zoneTimer = 0.25;
      // Only the changed parts of the (big) zone map are rewritten.
      const rects = this.city.zones.dirtyRects.splice(0);
      this.writeZones(first ? null : rects);
      this.zonesWritten = true;
    }
    this.terrain.uniforms.uZonableOpacity.value = this.zonableHint;
    this.timer -= dt;
    if (this.timer > 0 || this.mode === 'none') return;
    this.timer = 1;
    if (this.mode === 'traffic') {
      this.roads.updateTraffic();
      return;
    }
    if (this.mode === 'power' || this.mode === 'water' || this.mode === 'happiness') return;
    this.writeGrid();
  }

  private zonesWritten = false;

  /** Writes zone colours for the given world rectangles (or everything). */
  private writeZones(rects: { minX: number; minZ: number; maxX: number; maxZ: number }[] | null): void {
    const z = this.city.zones;
    const data = this.terrain.zoneData;
    const zonable = this.terrain.zonableData;
    const cols = Object.values(ZONE_INFO).map((i) => i.color.map((v) => Math.round(v * 255)));
    const cell = (v: number) => Math.min(ZONE_RES - 1, Math.max(0, Math.floor(v / ZONE_CELL)));
    for (const r of rects ?? [{ minX: 0, minZ: 0, maxX: ZONE_RES * ZONE_CELL, maxZ: ZONE_RES * ZONE_CELL }]) {
      const ix0 = cell(r.minX), ix1 = cell(r.maxX), iz0 = cell(r.minZ), iz1 = cell(r.maxZ);
      for (let iz = iz0; iz <= iz1; iz++) for (let i = iz * ZONE_RES + ix0, end = iz * ZONE_RES + ix1; i <= end; i++) this.writeZoneCell(i, z, data, zonable, cols);
    }
    this.terrain.zoneTex.needsUpdate = true;
    this.terrain.zonableTex.needsUpdate = true;
  }

  private writeZoneCell(i: number, z: City['zones'], data: Uint8Array, zonable: Uint8Array, cols: number[][]): void {
    const zone = z.zone[i] as Zone;
    const occ = z.occupant[i] !== 0;
    const o = i * 4;
    if (zone !== Zone.None && !occ) {
      const c = cols[zone];
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = 200;
    } else {
      data[o + 3] = 0;
    }
    zonable[i] = z.zonable[i] && !occ && zone === Zone.None ? 255 : 0;
  }

  private writeGrid(): void {
    const out = this.terrain.overlayData;
    const n = GRID_RES * GRID_RES;
    const lv = this.city.landValue;
    const mode = this.mode;
    if (mode === 'transit') {
      // Walking catchment of stops on working lines.
      out.fill(0);
      for (const st of this.city.transit.catchments()) {
        const r = st.r;
        const ix0 = Math.max(0, Math.floor((st.x - r) / GRID_CELL)), ix1 = Math.min(GRID_RES - 1, Math.floor((st.x + r) / GRID_CELL));
        const iz0 = Math.max(0, Math.floor((st.z - r) / GRID_CELL)), iz1 = Math.min(GRID_RES - 1, Math.floor((st.z + r) / GRID_CELL));
        for (let iz = iz0; iz <= iz1; iz++) {
          for (let ix = ix0; ix <= ix1; ix++) {
            const d = Math.hypot((ix + 0.5) * GRID_CELL - st.x, (iz + 0.5) * GRID_CELL - st.z);
            if (d > r) continue;
            const o = (iz * GRID_RES + ix) * 4;
            // Short walks are bright teal, long walks fade to a thin blue.
            const t = d / r;
            const a = Math.round(40 + 190 * (1 - t) ** 1.5);
            if (a > out[o + 3]) {
              out[o] = Math.round(42 - 2 * t);
              out[o + 1] = Math.round(200 - 57 * t);
              out[o + 2] = Math.round(210 + 4 * t);
              out[o + 3] = a;
            }
          }
        }
      }
    } else if (mode === 'districts') {
      const d = this.city.districts;
      for (let i = 0; i < n; i++) {
        const id = d.grid[i];
        const o = i * 4;
        const dist = id ? d.list.get(id) : undefined;
        if (!dist) {
          out[o + 3] = 0;
          continue;
        }
        const ix = i % GRID_RES, iz = Math.floor(i / GRID_RES);
        const edge = (ix > 0 && d.grid[i - 1] !== id) || (ix < GRID_RES - 1 && d.grid[i + 1] !== id) || (iz > 0 && d.grid[i - GRID_RES] !== id) || (iz < GRID_RES - 1 && d.grid[i + GRID_RES] !== id);
        out[o] = Math.round(dist.color[0] * 255);
        out[o + 1] = Math.round(dist.color[1] * 255);
        out[o + 2] = Math.round(dist.color[2] * 255);
        out[o + 3] = edge ? 230 : 110;
      }
    } else {
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        let r = 0, g = 0, b = 0, a = 0;
        if (mode === 'landValue') {
          [r, g, b] = ramp(lv.value[i]);
          a = 190;
        } else if (mode === 'pollution') {
          const v = lv.pollution[i];
          r = 150 + 80 * v;
          g = 120 - 40 * v;
          b = 30;
          a = Math.round(Math.min(1, v * 1.6) * 230);
        } else if (mode === 'noise') {
          const v = lv.noise[i];
          r = 240;
          g = 150 - 100 * v;
          b = 40;
          a = Math.round(Math.min(1, v * 1.5) * 230);
        } else {
          const kind = mode as CoverageKind;
          const v = this.city.coverage.grids[kind]?.[i] ?? 0;
          [r, g, b] = COVER_COLORS[kind] ?? [255, 255, 255];
          a = Math.round(v * 200);
        }
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = a;
      }
    }
    this.terrain.overlayTex.needsUpdate = true;
  }

  /** Short explanation for the legend. */
  static describe(mode: OverlayId): string {
    switch (mode) {
      case 'traffic': return 'Road colour shows peak-hour load versus capacity.';
      case 'landValue': return 'Parks, services, shops and water views raise value; pollution and noise lower it.';
      case 'pollution': return 'Ground pollution from industry and power plants. Keep homes away.';
      case 'noise': return 'Traffic noise from busy roads and highways.';
      case 'power': return 'Buildings with and without electricity.';
      case 'water': return 'Buildings with water and sewage service (amber = only one).';
      case 'happiness': return 'How satisfied residents and businesses are.';
      case 'districts': return 'Named districts painted with the District tool.';
      case 'transit': return 'Bus lines and how far people walk to a stop. Commuters ride when the bus is competitive with driving.';
      default: return 'Coverage from service buildings. Effectiveness drops when overloaded.';
    }
  }

  static isResidentialBuilding(b: Building): boolean {
    return isResidential(b.zone);
  }
}
