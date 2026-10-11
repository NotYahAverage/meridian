import { describe, expect, it } from 'vitest';
import { FireworksRenderer } from '../src/render/effects/FireworksRenderer';

describe('fireworks', () => {
  it('launch, burst, light the sky and burn out', () => {
    const fw = new FireworksRenderer();
    expect(fw.busy).toBe(false);
    fw.start(100, 200, 5, 8);
    let maxGlow = 0, maxLive = 0, launches = 0, bursts = 0;
    for (let t = 0; t < 20; t += 1 / 30) {
      fw.update(1 / 30);
      maxGlow = Math.max(maxGlow, fw.glow);
      maxLive = Math.max(maxLive, (fw as unknown as { live: number }).live);
      for (const s of fw.sounds) {
        if (s.kind === 'launch') launches++;
        else {
          bursts++;
          // Shells burst well above the launch site, near where they were fired.
          expect(s.y).toBeGreaterThan(60);
          expect(Math.hypot(s.x - 100, s.z - 200)).toBeLessThan(120);
        }
      }
      fw.sounds.length = 0;
    }
    expect(launches).toBeGreaterThan(4);
    expect(bursts).toBe(launches);
    expect(maxLive).toBeGreaterThan(200);
    expect(maxGlow).toBeGreaterThan(0.4);
    // Twenty seconds later everything has burned out.
    expect(fw.busy).toBe(false);
    expect(fw.points.visible).toBe(false);
  });

  it('stop clears the sky at once', () => {
    const fw = new FireworksRenderer();
    fw.start(0, 0, 0, 30);
    for (let k = 0; k < 120; k++) fw.update(1 / 30);
    expect(fw.busy).toBe(true);
    fw.stop();
    fw.update(1 / 30);
    expect(fw.busy).toBe(false);
  });
});
