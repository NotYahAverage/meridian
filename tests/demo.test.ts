import { describe, expect, it } from 'vitest';
import { buildDemoCity } from '../src/game/demo';
import { SERVICE_BY_ID } from '../src/sim/services/ServiceTypes';
import { BuildingState, Problem } from '../src/sim/types';

describe('main menu demo town', () => {
  it('is a healthy, living town (first impression)', () => {
    const city = buildDemoCity(20251, 'coastal');
    const kinds = new Set<string>();
    for (const b of city.buildings.all.values()) if (b.kind === 'service') kinds.add(SERVICE_BY_ID.get(b.typeId)!.kind);
    for (const k of ['power', 'water', 'sewage', 'fire', 'police', 'health', 'education', 'garbage', 'park']) expect(kinds.has(k), `missing ${k}`).toBe(true);
    expect(city.population.residents).toBeGreaterThan(600);
    let active = 0, problems = 0;
    const severe = Problem.NoPower | Problem.NoWater | Problem.NoSewage | Problem.Garbage | Problem.NoRoad;
    for (const b of city.buildings.all.values()) {
      if (b.kind !== 'zoned' || b.state !== BuildingState.Active) continue;
      active++;
      if (b.problems & severe) problems++;
    }
    expect(active).toBeGreaterThan(40);
    expect(problems / active).toBeLessThan(0.05);
  }, 60_000);
});
