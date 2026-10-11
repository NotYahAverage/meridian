import { clamp } from '../../core/math';
import type { Building } from '../buildings/Buildings';
import type { City } from '../City';
import { BuildingState } from '../types';

/** Tunables for the underground. */
export const METRO = {
  /** Passengers per train. */
  capacity: 480,
  /** Average speed between stations including acceleration (m/s). */
  speed: 16,
  /** Seconds at each station. */
  dwell: 30,
  fare: 0.35,
  upkeepPerTrain: 1_600,
  /** Boring a new tunnel, per metre. */
  tunnelPerMeter: 95,
  lineCost: 12_000,
  /** People walk this far to a station. */
  walkRadius: 520,
  maxTrainsPerLine: 16,
  serviceHours: 19,
  minSpacing: 240,
  maxSpacing: 3_200,
};

export const METRO_UNLOCK = 5_000;

export const METRO_COLORS = [0x1565c0, 0xd84315, 0x2e7d32, 0x6a1b9a, 0xf9a825, 0x00838f, 0xad1457, 0x4e342e];

export type MetroProblem = '' | 'stations' | 'building';

export interface MetroLine {
  id: number;
  name: string;
  color: number;
  /** Station building ids in visiting order; trains loop back to the first. */
  stations: number[];
  trains: number;
  // ── Derived ──
  times: number[];
  loopSeconds: number;
  lengthM: number;
  problem: MetroProblem;
  ridersPerDay: number;
  capacityPerDay: number;
}

export interface MetroSave {
  lines: { id: number; name: string; color: number; stations: number[]; trains: number }[];
  tunnels: string[];
  nextLineId: number;
}

export const isMetroStation = (b: Building | undefined): b is Building => !!b && b.kind === 'service' && b.typeId === 'metro_station';

const tunnelKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/**
 * Underground lines between metro stations. Tunnels run straight from
 * station to station; once bored they can be shared by later lines for free.
 * Ridership is decided together with buses in Transit.updateRidership.
 */
export class Metro {
  readonly lines = new Map<number, MetroLine>();
  /** Bored tunnels, keyed by the two station ids. */
  readonly tunnels = new Set<string>();
  /** Riders waiting per station (for display). */
  readonly waiting = new Map<number, number>();
  nextLineId = 1;
  version = 0;
  totalRiders = 0;
  private key = '';

  constructor(private city: City) {}

  station(id: number): Building | undefined {
    const b = this.city.buildings.get(id);
    return isMetroStation(b) ? b : undefined;
  }

  stations(): Building[] {
    return [...this.city.buildings.all.values()].filter((b) => isMetroStation(b) && b.state !== BuildingState.Collapsed);
  }

  /** Nearest station to a point, within `radius`. */
  stationNear(x: number, z: number, radius = 30): Building | null {
    let best: Building | null = null;
    let bd = radius;
    for (const b of this.stations()) {
      const d = Math.hypot(b.cx - x, b.cz - z) - Math.max(b.hw, b.hd) * 0.5;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  /** Why two consecutive stations can't be joined ('' if fine). */
  checkHop(a: number, b: number): string {
    const sa = this.station(a), sb = this.station(b);
    if (!sa || !sb) return 'Click metro stations';
    const d = Math.hypot(sa.cx - sb.cx, sa.cz - sb.cz);
    if (d < METRO.minSpacing) return 'Stations are too close together';
    if (d > METRO.maxSpacing) return 'Too far for one tunnel: add a station in between';
    return '';
  }

  /** New tunnel length (m) a loop through these stations needs. */
  newTunnelLength(stations: number[], loop = true): number {
    let len = 0;
    const n = stations.length;
    const seen = new Set<string>();
    for (let k = 0; k < (loop ? n : n - 1); k++) {
      const a = stations[k], b = stations[(k + 1) % n];
      const key = tunnelKey(a, b);
      if (a === b || this.tunnels.has(key) || seen.has(key)) continue;
      seen.add(key);
      const sa = this.station(a), sb = this.station(b);
      if (sa && sb) len += Math.hypot(sa.cx - sb.cx, sa.cz - sb.cz);
    }
    return len;
  }

  costOf(stations: number[], loop = true): number {
    return Math.round(METRO.lineCost + this.newTunnelLength(stations, loop) * METRO.tunnelPerMeter);
  }

  addLine(stations: number[], name?: string): MetroLine {
    const id = this.nextLineId++;
    const used = new Set([...this.lines.values()].map((l) => l.color));
    const color = METRO_COLORS.find((c) => !used.has(c)) ?? METRO_COLORS[id % METRO_COLORS.length];
    for (let k = 0; k < stations.length; k++) this.tunnels.add(tunnelKey(stations[k], stations[(k + 1) % stations.length]));
    const line: MetroLine = {
      id,
      name: name ?? `Metro ${id}`,
      color,
      stations: [...stations],
      trains: clamp(Math.round(stations.length * 0.75), 2, METRO.maxTrainsPerLine),
      times: [],
      loopSeconds: 0,
      lengthM: 0,
      problem: '',
      ridersPerDay: 0,
      capacityPerDay: 0,
    };
    this.lines.set(id, line);
    this.touch();
    this.refresh(true);
    return line;
  }

  removeLine(id: number): void {
    if (this.lines.delete(id)) this.touch();
  }

  setTrains(id: number, n: number): void {
    const line = this.lines.get(id);
    if (!line) return;
    line.trains = clamp(Math.round(n), 1, METRO.maxTrainsPerLine);
    this.capacity(line);
    this.touch();
  }

  linesAt(stationId: number): MetroLine[] {
    return [...this.lines.values()].filter((l) => l.stations.includes(stationId));
  }

  /** A station was demolished: lines skip it (and lines left with one station close). */
  onBuildingRemoved(id: number): void {
    let changed = false;
    for (const line of [...this.lines.values()]) {
      if (!line.stations.includes(id)) continue;
      line.stations = line.stations.filter((s) => s !== id);
      if (line.stations.length < 2) this.lines.delete(line.id);
      changed = true;
    }
    for (const k of [...this.tunnels]) if (k.split('-').map(Number).includes(id)) this.tunnels.delete(k);
    this.waiting.delete(id);
    if (changed) this.touch();
  }

  private touch(): void {
    this.version++;
    this.key = '';
  }

  /** Recomputes timings and capacity when stations or lines changed. */
  refresh(force = false): void {
    let key = `${this.version}`;
    for (const line of this.lines.values()) for (const id of line.stations) key += `,${this.station(id)?.state ?? 'x'}`;
    if (!force && key === this.key) return;
    this.key = key;
    for (const line of this.lines.values()) {
      line.times = [0];
      line.loopSeconds = 0;
      line.lengthM = 0;
      line.problem = '';
      const st = line.stations.map((id) => this.station(id));
      if (st.length < 2 || st.some((b) => !b)) {
        line.problem = 'stations';
        line.capacityPerDay = 0;
        continue;
      }
      if (st.some((b) => b!.state !== BuildingState.Active)) line.problem = 'building';
      let t = 0;
      for (let k = 0; k < st.length; k++) {
        const a = st[k]!, b = st[(k + 1) % st.length]!;
        const d = Math.hypot(a.cx - b.cx, a.cz - b.cz);
        line.lengthM += d;
        t += d / METRO.speed + METRO.dwell;
        if (k < st.length - 1) line.times.push(t);
      }
      line.loopSeconds = t;
      this.capacity(line);
    }
  }

  private capacity(line: MetroLine): void {
    if (line.problem || line.loopSeconds <= 0) {
      line.capacityPerDay = 0;
      return;
    }
    const loops = (METRO.serviceHours * 3600) / line.loopSeconds;
    line.capacityPerDay = line.trains * METRO.capacity * loops * 1.6;
  }

  waitSeconds(line: MetroLine): number {
    return Math.min(900, line.loopSeconds / Math.max(1, line.trains) / 2);
  }

  monthlyUpkeep(): number {
    let n = 0;
    for (const line of this.lines.values()) if (line.problem !== 'stations') n += line.trains;
    return n * METRO.upkeepPerTrain;
  }

  monthlyFares(free: boolean): number {
    return free ? 0 : this.totalRiders * 30 * METRO.fare;
  }

  serialize(): MetroSave {
    return {
      lines: [...this.lines.values()].map((l) => ({ id: l.id, name: l.name, color: l.color, stations: [...l.stations], trains: l.trains })),
      tunnels: [...this.tunnels],
      nextLineId: this.nextLineId,
    };
  }

  load(data: MetroSave | undefined): void {
    this.lines.clear();
    this.tunnels.clear();
    if (!data) return;
    for (const l of data.lines) {
      this.lines.set(l.id, { ...l, stations: [...l.stations], times: [], loopSeconds: 0, lengthM: 0, problem: '', ridersPerDay: 0, capacityPerDay: 0 });
    }
    for (const k of data.tunnels) this.tunnels.add(k);
    this.nextLineId = data.nextLineId;
    this.touch();
  }
}

export function metroProblemText(p: MetroProblem): string {
  switch (p) {
    case 'stations':
      return 'A line needs at least two stations';
    case 'building':
      return 'Trains start once every station is finished';
    default:
      return '';
  }
}
