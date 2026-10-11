import { describe, expect, it } from 'vitest';
import { generateBuilding } from '../src/render/buildings/generators';
import { ARCHETYPES } from '../src/sim/buildings/Archetypes';
import { SERVICE_TYPES } from '../src/sim/services/ServiceTypes';

describe('building generators', () => {
  it('every zoned archetype builds clean geometry at its size extremes', () => {
    for (const a of ARCHETYPES) {
      for (const [w, d] of [[a.frontage[0], a.depth[0]], [a.frontage[1], a.depth[1]]]) {
        for (let level = a.levels[0]; level <= a.levels[1]; level++) {
          for (const seed of [1, 99, 12345]) {
            const geo = generateBuilding({ style: a.style, w, d, floors: a.floors[1], level, seed }, 500, 500, 0.3, 12);
            expect(geo.vertexCount, a.id).toBeGreaterThan(40);
            expect(geo.height, a.id).toBeGreaterThan(2);
            for (let i = 0; i < geo.pos.length; i++) if (!Number.isFinite(geo.pos[i])) throw new Error(`${a.id}: NaN position`);
          }
        }
      }
    }
  });

  it('every service building generates', () => {
    for (const st of SERVICE_TYPES) {
      const geo = generateBuilding({ style: st.style, w: st.w, d: st.d, floors: 2, level: 1, seed: 7 }, 500, 500, 0, 12);
      expect(geo.vertexCount, st.id).toBeGreaterThan(20);
      for (let i = 0; i < geo.pos.length; i++) if (!Number.isFinite(geo.pos[i])) throw new Error(`${st.id}: NaN position`);
    }
  });
});
