import type { City } from '../City';
import { WORLD_SIZE } from '../constants';
import { BuildingState } from '../types';

export interface Tornado {
  x: number;
  z: number;
  /** Unit heading. */
  dx: number;
  dz: number;
  speed: number;
  /** Seconds since touchdown. */
  age: number;
  /** Radius of total destruction (m); damage reaches twice as far. */
  radius: number;
  /** Buildings already damaged (a damaged building can still be destroyed by the core). */
  hit: Set<number>;
  destroyed: number;
  damaged: number;
}

/** Tornado season: March to August. */
const SEASON = new Set([2, 3, 4, 5, 6, 7]);

/**
 * Optional natural disasters (off unless the player enables them): a rare
 * tornado touches down at the edge of the map and tracks across it,
 * flattening buildings and trees near its core and damaging homes nearby.
 * Tornadoes are short-lived and are not saved.
 */
export class Disasters {
  enabled = false;
  tornado: Tornado | null = null;
  /** Wobble phase for a slightly wandering track. */
  private wobble = 0;
  /** Turn rate of the wandering track (rad/s); aimed tornadoes go straight. */
  private wander = 0.012;

  constructor(private city: City) {}

  /** Called once per game hour; may start a tornado in season (about one a year). */
  tickHour(): void {
    if (!this.enabled || this.tornado) return;
    const c = this.city;
    if (!SEASON.has(c.clock.month) || c.stats.population < 400) return;
    if (c.weather.kind !== 'storm' && c.weather.kind !== 'rain') return;
    if (c.rng.chance(1 / 500)) this.start();
  }

  /** Touches down at the map edge, heading across the city (or from a given point and heading). */
  start(at?: { x: number; z: number; heading: number }): Tornado {
    const c = this.city;
    let x: number, z: number, h: number;
    if (at) {
      x = at.x;
      z = at.z;
      h = at.heading;
    } else {
      // Aim through the built-up area from a random edge.
      let cx = 0, cz = 0, n = 0;
      for (const b of c.buildings.all.values()) {
        cx += b.cx;
        cz += b.cz;
        n++;
      }
      cx = n ? cx / n : WORLD_SIZE / 2;
      cz = n ? cz / n : WORLD_SIZE / 2;
      const a = c.rng.next() * Math.PI * 2;
      x = cx + Math.cos(a) * 1300;
      z = cz + Math.sin(a) * 1300;
      h = Math.atan2(cz - z, cx - x) + (c.rng.next() - 0.5) * 0.5;
    }
    this.wobble = c.rng.next() * 10;
    this.wander = at ? 0 : 0.012;
    this.tornado = { x, z, dx: Math.cos(h), dz: Math.sin(h), speed: 16, age: 0, radius: 26, hit: new Set(), destroyed: 0, damaged: 0 };
    c.emitNotice({ severity: 'critical', icon: 'weather', title: 'Tornado warning!', text: 'A tornado has touched down and is heading for the city. Take cover!', x, z });
    return this.tornado;
  }

  /** Moves the tornado and applies damage; `dt` is game-speed-scaled seconds. */
  update(dt: number): void {
    const t = this.tornado;
    if (!t || dt <= 0) return;
    const c = this.city;
    t.age += dt;
    // A gently wandering track.
    const turn = Math.sin(t.age * 0.11 + this.wobble) * this.wander * dt;
    const ca = Math.cos(turn), sa = Math.sin(turn);
    const ndx = t.dx * ca - t.dz * sa, ndz = t.dx * sa + t.dz * ca;
    t.dx = ndx;
    t.dz = ndz;
    t.x += t.dx * t.speed * dt;
    t.z += t.dz * t.speed * dt;
    const r = t.radius;
    for (const b of c.buildings.queryRadius(t.x, t.z, r * 2.2)) {
      const d = Math.hypot(b.cx - t.x, b.cz - t.z) - Math.min(b.hw, b.hd) * 0.5;
      if (d < r) {
        if (t.hit.delete(b.id)) t.damaged--;
        t.destroyed++;
        c.removeBuilding(b.id, 'disaster');
      } else if (d < r * 2.2 && !t.hit.has(b.id) && b.state === BuildingState.Active) {
        t.hit.add(b.id);
        t.damaged++;
        b.unhappyDays += 8;
        b.happiness = Math.max(0, b.happiness - 25);
      }
    }
    c.nature.clearDisc(t.x, t.z, r * 1.3);
    // Out of the map, or blown itself out after a few minutes.
    const out = t.x < -200 || t.z < -200 || t.x > WORLD_SIZE + 200 || t.z > WORLD_SIZE + 200;
    if (out || t.age > 200) this.finish();
  }

  private finish(): void {
    const t = this.tornado;
    if (!t) return;
    this.tornado = null;
    const c = this.city;
    c.achievements.counters.tornadoes++;
    c.news.tornado(t.destroyed, t.damaged, t.x, t.z);
    c.coverageDirty = true;
    c.recomputeUtilities();
    c.emitNotice({
      severity: t.destroyed ? 'warning' : 'info',
      icon: 'weather',
      title: 'The tornado has passed',
      text: t.destroyed || t.damaged ? `It destroyed ${t.destroyed} building${t.destroyed === 1 ? '' : 's'} and damaged ${t.damaged}. Zoned lots will rebuild.` : 'It stayed clear of the city.',
      x: t.x,
      z: t.z,
    });
  }
}
