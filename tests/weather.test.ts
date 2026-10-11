import { describe, expect, it } from 'vitest';
import { Weather } from '../src/sim/world/Weather';

/** Runs a year of weather and collects what happened. */
function year(seed: number) {
  const w = new Weather(seed);
  const seen = new Map<string, number>();
  let maxSnow = 0, maxWet = 0, summerSnow = 0, minT = 99, maxT = -99;
  for (let day = 0; day < 360; day++) {
    const month = Math.floor(day / 30);
    for (let hour = 0; hour < 24; hour++) {
      w.tick(month, hour);
      seen.set(w.displayKind, (seen.get(w.displayKind) ?? 0) + 1);
      maxSnow = Math.max(maxSnow, w.snowCover);
      maxWet = Math.max(maxWet, w.wet);
      if (month >= 5 && month <= 7) summerSnow = Math.max(summerSnow, w.snowCover);
      minT = Math.min(minT, w.temperature);
      maxT = Math.max(maxT, w.temperature);
    }
  }
  return { seen, maxSnow, maxWet, summerSnow, minT, maxT };
}

describe('weather', () => {
  it('produces seasonal variety', () => {
    const r = year(42);
    const hours = (k: string) => r.seen.get(k) ?? 0;
    // Mostly fair weather, with rain, fog and some winter snow.
    expect(hours('clear') + hours('cloudy')).toBeGreaterThan(360 * 24 * 0.5);
    expect(hours('rain')).toBeGreaterThan(100);
    expect(hours('snow')).toBeGreaterThan(20);
    expect(r.maxSnow).toBeGreaterThan(0.3);
    expect(r.maxWet).toBeGreaterThan(0.8);
    // Snow melts away by summer; temperatures stay plausible.
    expect(r.summerSnow).toBe(0);
    expect(r.minT).toBeLessThan(0);
    expect(r.maxT).toBeGreaterThan(22);
    expect(r.maxT).toBeLessThan(35);
  });

  it('effects stay within sensible bounds', () => {
    const w = new Weather(1);
    for (let i = 0; i < 2000; i++) {
      w.tick(i % 12, i % 24);
      expect(w.roadSpeed()).toBeGreaterThan(0.5);
      expect(w.roadSpeed()).toBeLessThanOrEqual(1);
      expect(w.windPower()).toBeGreaterThan(0.7);
      expect(w.solarPower()).toBeGreaterThan(0.3);
      expect(w.fireRisk()).toBeGreaterThan(0.1);
    }
  });

  it('round-trips through a save', () => {
    const a = new Weather(7);
    for (let i = 0; i < 500; i++) a.tick(1, i % 24);
    const b = new Weather(99);
    b.load(JSON.parse(JSON.stringify(a.serialize())));
    for (let i = 0; i < 200; i++) {
      a.tick(2, i % 24);
      b.tick(2, i % 24);
    }
    expect(b.kind).toBe(a.kind);
    expect(b.snowCover).toBeCloseTo(a.snowCover, 6);
  });
});
