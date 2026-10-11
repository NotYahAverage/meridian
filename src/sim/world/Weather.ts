import { clamp, lerp } from '../../core/math';
import { Rng } from '../../core/rng';

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow';

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  clear: 'Clear',
  cloudy: 'Overcast',
  rain: 'Rain',
  storm: 'Thunderstorm',
  fog: 'Fog',
  snow: 'Snow',
};

/** Mean daily temperature (°C) by month, Jan..Dec. */
const MONTH_TEMP = [-2, 0, 5, 10, 15, 20, 23, 22, 17, 11, 5, 0];

type Season = 'winter' | 'spring' | 'summer' | 'autumn';
const SEASON_OF_MONTH: Season[] = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];

/** Chance of each next state per season (precipitation turns to snow when cold). */
const NEXT: Record<Season, [WeatherKind, number][]> = {
  winter: [['clear', 0.3], ['cloudy', 0.3], ['rain', 0.2], ['fog', 0.15], ['storm', 0.05]],
  spring: [['clear', 0.38], ['cloudy', 0.27], ['rain', 0.24], ['storm', 0.06], ['fog', 0.05]],
  summer: [['clear', 0.56], ['cloudy', 0.18], ['rain', 0.1], ['storm', 0.13], ['fog', 0.03]],
  autumn: [['clear', 0.3], ['cloudy', 0.3], ['rain', 0.25], ['storm', 0.05], ['fog', 0.1]],
};

const DURATION: Record<WeatherKind, [number, number]> = {
  clear: [18, 60],
  cloudy: [10, 30],
  rain: [5, 20],
  storm: [3, 8],
  fog: [4, 10],
  snow: [8, 30],
};

/** Target values for each state: cloud cover, precipitation, fog, wind. */
const TARGET: Record<WeatherKind, { cloud: number; precip: number; fog: number; wind: number }> = {
  clear: { cloud: 0.08, precip: 0, fog: 0, wind: 0.35 },
  cloudy: { cloud: 0.75, precip: 0, fog: 0.1, wind: 0.5 },
  rain: { cloud: 0.9, precip: 0.65, fog: 0.25, wind: 0.6 },
  storm: { cloud: 1, precip: 1, fog: 0.35, wind: 1 },
  fog: { cloud: 0.55, precip: 0, fog: 1, wind: 0.1 },
  snow: { cloud: 0.9, precip: 0.7, fog: 0.35, wind: 0.45 },
};

export interface WeatherSave {
  kind: WeatherKind;
  hoursLeft: number;
  cloud: number;
  precip: number;
  fog: number;
  wind: number;
  wet: number;
  snowCover: number;
  temperature?: number;
  rng: number;
}

/**
 * Seasonal weather as a simple Markov chain of states with smooth
 * transitions. Advances once per simulation hour and exposes continuous
 * values (cloud cover, rain/snow intensity, fog, wind, road wetness and
 * lying snow) used by both the simulation and the renderer.
 */
export class Weather {
  kind: WeatherKind = 'clear';
  hoursLeft = 72;
  cloud = 0.08;
  /** Precipitation intensity 0–1 (rain or snow depending on temperature). */
  precip = 0;
  fog = 0;
  wind = 0.35;
  /** Surface wetness 0–1 (lags rain, dries in sun). */
  wet = 0;
  /** Lying snow 0–1. */
  snowCover = 0;
  temperature = 8;
  private rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x3ea7);
  }

  /** Rain intensity (0 when it snows). */
  get rain(): number {
    return this.temperature > 0.5 ? this.precip : 0;
  }

  /** Falling snow intensity. */
  get snow(): number {
    return this.temperature <= 0.5 ? this.precip : 0;
  }

  /** Display state (rain in freezing weather shows as snow). */
  get displayKind(): WeatherKind {
    if ((this.kind === 'rain' || this.kind === 'storm' || this.kind === 'snow') && this.temperature <= 0.5) return 'snow';
    if (this.kind === 'snow' && this.temperature > 0.5) return 'rain';
    return this.kind;
  }

  /** Advances one hour. `month` is 0–11 (Jan..Dec), `hour` 0–23. */
  tick(month: number, hour: number): WeatherKind | null {
    let changed: WeatherKind | null = null;
    if (--this.hoursLeft <= 0) {
      const season = SEASON_OF_MONTH[month];
      let next = this.rng.weighted(NEXT[season], (e) => e[1])![0];
      if (next === this.kind && next !== 'clear') next = 'cloudy';
      // Storms only build up from clouds or rain.
      if (next === 'storm' && this.kind === 'clear') next = 'cloudy';
      const [a, b] = DURATION[next];
      this.hoursLeft = Math.round(this.rng.range(a, b));
      if (next !== this.kind) changed = next;
      this.kind = next;
    }
    const tg = TARGET[this.kind];
    this.cloud = lerp(this.cloud, tg.cloud, 0.25);
    this.precip = lerp(this.precip, tg.precip, 0.35);
    if (this.precip < 0.02 && tg.precip === 0) this.precip = 0;
    this.fog = lerp(this.fog, tg.fog * (hour < 10 || hour > 20 ? 1 : 0.6), 0.3);
    this.wind = lerp(this.wind, tg.wind + (this.rng.next() - 0.5) * 0.2, 0.3);
    const diurnal = -Math.cos(((hour - 4) / 24) * Math.PI * 2) * 4;
    const target = MONTH_TEMP[month] + diurnal - this.cloud * 2 - this.precip * 2;
    this.temperature = lerp(this.temperature, target, 0.3);
    // Surfaces: rain wets them quickly; sun and wind dry them slowly.
    if (this.rain > 0.05) this.wet = Math.min(1, this.wet + this.rain * 0.35);
    else this.wet = Math.max(0, this.wet - (0.04 + 0.08 * (1 - this.cloud)) * (this.temperature > 0 ? 1 : 0.3));
    // Snow lies when it is cold and melts when it warms up.
    if (this.snow > 0.05) this.snowCover = Math.min(1, this.snowCover + this.snow * 0.08);
    else if (this.temperature > 1) this.snowCover = Math.max(0, this.snowCover - (this.temperature - 1) * 0.012 - this.rain * 0.05);
    return changed;
  }

  /** Multiplier on wind turbine output. */
  windPower(): number {
    return 0.8 + 0.35 * clamp(this.wind, 0, 1);
  }

  /** Multiplier on solar output. */
  solarPower(): number {
    return 1 - 0.35 * this.cloud - 0.25 * this.snowCover;
  }

  /** Vehicle speed multiplier from road conditions. */
  roadSpeed(): number {
    return 1 - 0.1 * this.wet - 0.22 * this.snowCover - 0.12 * this.fog;
  }

  /** Multiplier on the chance of building fires. */
  fireRisk(): number {
    return clamp((this.temperature > 22 ? 1.4 : 1) * (1 - 0.7 * this.wet), 0.2, 1.6);
  }

  serialize(): WeatherSave {
    return { kind: this.kind, hoursLeft: this.hoursLeft, cloud: this.cloud, precip: this.precip, fog: this.fog, wind: this.wind, wet: this.wet, snowCover: this.snowCover, temperature: this.temperature, rng: this.rng.state };
  }

  load(d: WeatherSave): void {
    Object.assign(this, { kind: d.kind, hoursLeft: d.hoursLeft, cloud: d.cloud, precip: d.precip, fog: d.fog, wind: d.wind, wet: d.wet, snowCover: d.snowCover });
    if (d.temperature !== undefined) this.temperature = d.temperature;
    this.rng.state = d.rng;
  }
}
