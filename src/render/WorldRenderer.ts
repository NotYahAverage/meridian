import * as THREE from 'three';
import { ShipRenderer } from './boats/ShipRenderer';
import { FireworksRenderer } from './effects/FireworksRenderer';
import { AirportRenderer } from './airport/AirportRenderer';
import { BoatRenderer } from './boats/BoatRenderer';
import { TornadoRenderer } from './effects/TornadoRenderer';
import { WelcomeSign } from './props/WelcomeSign';
import { VEHICLE_LENGTH } from '../sim/traffic/Vehicles';
import type { City } from '../sim/City';
import { WORLD_SIZE, DAYS_PER_MONTH } from '../sim/constants';
import { ROAD_TYPES } from '../sim/roads/RoadTypes';
import type { AssetLibrary } from './assets/AssetLibrary';
import { seasonUniforms } from './assets/AssetMaterials';
import { BuildingRenderer } from './buildings/BuildingRenderer';
import { TransitRenderer } from './transit/TransitRenderer';
import { Precipitation } from './effects/Precipitation';
import { Effects } from './effects/Effects';
import { StatusIcons } from './effects/StatusIcons';
import type { Environment } from './Environment';
import { Ghost } from './overlays/Ghost';
import { Overlays } from './overlays/Overlays';
import { PedestrianRenderer, personSize } from './pedestrians/Pedestrians';
import { PropRenderer } from './props/PropRenderer';
import { RoadRenderer } from './roads/RoadRenderer';
import { globalUniforms } from './shared';
import { TerrainRenderer } from './terrain/TerrainRenderer';
import { VehicleRenderer } from './vehicles/VehicleRenderer';
import { WaterRenderer } from './water/WaterRenderer';
import { GRID_RES } from '../sim/constants';

const SEASON_TINTS: [number, number, number, number][] = [
  // tint r, g, b, amount  (by month Jan..Dec)
  [0.75, 0.68, 0.55, 0.65], [0.78, 0.72, 0.58, 0.55], [1.05, 1.1, 0.95, 0.25], [1.1, 1.15, 0.9, 0.3],
  [1, 1, 1, 0], [1, 1, 1, 0], [0.95, 0.95, 0.85, 0.15], [1.0, 0.95, 0.75, 0.2],
  [1.15, 0.95, 0.55, 0.35], [1.45, 0.82, 0.38, 0.75], [1.35, 0.7, 0.35, 0.8], [0.8, 0.7, 0.55, 0.6],
];

/**
 * The rendered city. Owns every visual subsystem for one City and keeps them
 * in sync with simulation state each frame.
 */
export class WorldRenderer {
  readonly root = new THREE.Group();
  readonly terrain: TerrainRenderer;
  readonly water: WaterRenderer;
  readonly roads: RoadRenderer;
  readonly buildings: BuildingRenderer;
  readonly props: PropRenderer;
  readonly vehicles: VehicleRenderer;
  readonly pedestrians: PedestrianRenderer;
  readonly effects: Effects;
  readonly icons: StatusIcons;
  readonly ghost: Ghost;
  readonly transit: TransitRenderer;
  readonly airport: AirportRenderer;
  readonly boats: BoatRenderer;
  readonly tornado: TornadoRenderer;
  readonly fireworks = new FireworksRenderer();
  readonly ships: ShipRenderer;
  readonly welcome: WelcomeSign;
  readonly precipitation = new Precipitation();
  /** Smoothed weather for rendering (the simulation steps hourly). */
  readonly sky = { cloud: 0, fog: 0, rain: 0, snow: 0, wet: 0, snowCover: 0, wind: 0.3 };
  private lightningTimer = 4;
  /** Seconds until the thunder of the last flash is heard (audio polls this). */
  thunderIn = -1;
  thunderStrength = 0;
  readonly overlays: Overlays;
  private raycaster = new THREE.Raycaster();

  constructor(readonly city: City, assets: AssetLibrary, private scene: THREE.Scene) {
    this.terrain = new TerrainRenderer(city.terrain, GRID_RES);
    this.water = new WaterRenderer(city.terrain);
    this.roads = new RoadRenderer(city);
    this.buildings = new BuildingRenderer(city);
    // Cars arriving at a house with an empty driveway can pull into it.
    city.vehicles.arrivalSpot = (id) => this.buildings.driveways.get(id) ?? null;
    this.props = new PropRenderer(city, assets, this.roads, this.buildings);
    this.vehicles = new VehicleRenderer(assets);
    this.pedestrians = new PedestrianRenderer(assets);
    this.effects = new Effects(city);
    this.icons = new StatusIcons(city, this.buildings);
    this.ghost = new Ghost(city, this.roads.uniforms, this.buildings.uniforms);
    this.transit = new TransitRenderer(city, assets);
    this.airport = new AirportRenderer(city, assets);
    this.root.add(this.airport.group);
    this.boats = new BoatRenderer(city, assets);
    this.root.add(this.boats.group);
    this.tornado = new TornadoRenderer(city);
    this.root.add(this.tornado.group);
    this.root.add(this.fireworks.points);
    this.ships = new ShipRenderer(city, assets);
    this.root.add(this.ships.group);
    this.welcome = new WelcomeSign(city);
    this.root.add(this.welcome.group);
    this.overlays = new Overlays(city, this.terrain, this.roads, this.buildings);
    this.root.add(
      this.terrain.group,
      this.water.mesh,
      this.roads.group,
      this.buildings.group,
      this.props.group,
      this.vehicles.group,
      this.pedestrians.group,
      this.effects.points,
      this.icons.mesh,
      this.ghost.group,
      this.overlays.walk.mesh,
      this.transit.group,
      this.precipitation.group,
    );
    scene.add(this.root);
    this.buildings.rebuildAll();
    this.props.markAllDirty();
  }

  /** Builds everything synchronously (used behind the loading screen). */
  warmUp(): void {
    this.roads.sync();
    this.roads.rebuild(1e6);
    this.buildings.sync();
    // Buildings around where the camera starts (the middle of the city) now, the rest over the next frames.
    let n = 0, sx = 0, sz = 0;
    for (const b of this.city.buildings.all.values()) {
      sx += b.cx;
      sz += b.cz;
      n++;
    }
    if (n) this.buildings.warmNear(sx / n, sz / n, 1800);
    else this.buildings.rebuild(1e6);
    this.buildings.updateState(0, true);
    this.terrain.syncDirty();
  }

  update(dt: number, simDt: number, camera: THREE.PerspectiveCamera, env: Environment, focus: THREE.Vector3, camDist: number, viewportH: number, simRunning: boolean): void {
    this.water.syncTerrain(this.city.terrain, dt);
    this.terrain.syncSoil(dt);
    globalUniforms.uTime.value += dt;
    const city = this.city;
    this.terrain.syncDirty();
    this.terrain.syncLand(city.land);
    this.roads.sync();
    this.roads.rebuild(6);
    this.buildings.sync();
    // A little more while the far side of a just-loaded city is still filling in.
    this.buildings.rebuild(this.buildings.backlog > 8 ? 9 : 6);
    this.buildings.updateState(dt);
    this.buildings.updateLod(focus);
    this.overlays.update(dt);
    this.terrain.updateLOD(camera.position, focus);
    this.props.update(camera, dt);
    city.vehicles.lodX = focus.x;
    city.vehicles.lodZ = focus.z;
    // Full-rate updates only where cars are big enough on screen for coarser steps to show.
    city.vehicles.lodRadius = camDist < 500 ? Math.max(600, Math.min(camDist * 1.2, 1000)) : Math.max(220, 600 - (camDist - 500) * 0.38);
    this.vehicles.update(city.vehicles, camera, focus, simDt);
    // After a road edit the walking network is rebuilt a few milliseconds a frame (no stutter in big cities).
    city.walk.sliced = true;
    city.walk.step(3);
    // People on foot live around the camera's focus; they only move while the game runs.
    city.pedestrians.update(simDt, focus, camera.position, camDist, env.hour);
    this.pedestrians.update(city.pedestrians, camera.position, camDist, city.weather);
    this.effects.update(dt, this.labActivity(), camera.position, viewportH, camera.fov, simRunning);
    this.icons.update(dt, camDist, globalUniforms.uTime.value);
    this.ghost.update();
    this.updateWeather(dt, camera, env, viewportH);
    this.transit.showLines = this.overlays.mode === 'transit' || this.transit.toolActive || this.transit.panelOpen;
    this.transit.update();
    this.airport.update(simDt, camera.position);
    this.boats.update(simDt);
    this.ships.update(simDt, dt);
    this.tornado.update(dt, camera);
    this.fireworks.update(dt);
    env.fireGlow = this.fireworks.glow;
    env.fireColor.copy(this.fireworks.glowColor);
    this.welcome.update();
    // Each month's tint peaks mid-month and blends into its neighbours.
    const m = city.clock.month;
    const f = (city.clock.dayOfMonth - 0.5) / DAYS_PER_MONTH - 0.5;
    const a = SEASON_TINTS[m], b = SEASON_TINTS[(m + (f < 0 ? 11 : 1)) % 12];
    const k = Math.abs(f);
    seasonUniforms.uSeasonTint.value.setRGB(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
    seasonUniforms.uSeasonAmount.value = a[3] + (b[3] - a[3]) * k;
  }

  /** Prop emitters, plus steam from the vents of research centres with work under way. */
  private labActivity(): PropRenderer['emitters'] {
    const list = this.props.emitters;
    const r = this.city.research;
    if (!r.centers.size) return list;
    const extra: PropRenderer['emitters'] = [];
    for (const c of r.centers.values()) {
      if (!c.active || c.active.pending) continue;
      const b = this.city.buildings.get(c.id);
      if (!b || b.progress < 1) continue;
      const h = this.buildings.heightOf(b.id);
      const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
      // A vent towards the back corner of the roof.
      const lx = b.hw * 0.45, lz = b.hd * 0.35;
      extra.push({ x: b.cx + lx * ca - lz * sa, y: b.y + h + 0.5, z: b.cz + lx * sa + lz * ca, kind: 'steam', scale: 0.45 + 0.15 * c.equipment });
    }
    return extra.length ? list.concat(extra) : list;
  }

  private updateWeather(dt: number, camera: THREE.PerspectiveCamera, env: Environment, viewportH: number): void {
    const w = this.city.weather;
    const s = this.sky;
    const k = Math.min(1, dt * 0.6);
    s.cloud += (w.cloud - s.cloud) * k;
    s.fog += (w.fog - s.fog) * k;
    s.rain += (w.rain - s.rain) * k;
    s.snow += (w.snow - s.snow) * k;
    s.wet += (w.wet - s.wet) * k;
    s.snowCover += (w.snowCover - s.snowCover) * k * 0.5;
    s.wind += (w.wind - s.wind) * k;
    env.cloud = s.cloud;
    env.windDrift = s.wind;
    env.fogAmount = s.fog;
    env.precip = Math.max(s.rain, s.snow);
    globalUniforms.uWet.value = s.wet;
    globalUniforms.uSnow.value = s.snowCover;
    globalUniforms.uRain.value = s.rain;
    // Cloud shadows drift over the city on broken-cloud days (not when overcast or at night).
    const cs = globalUniforms.uCloudShadow.value;
    const drift = (4 + s.wind * 14) * dt;
    cs.x = (cs.x + drift) % 50_000;
    cs.y = (cs.y + drift * 0.35) % 50_000;
    cs.z = Math.min(0.8, s.cloud * 1.05);
    const broken = Math.max(0, Math.min(1, (s.cloud - 0.12) / 0.23)) * (1 - Math.max(0, Math.min(1, (s.cloud - 0.7) / 0.22)));
    cs.w = 0.4 * broken * (1 - env.night);
    this.precipitation.update(camera, viewportH, s.rain, s.snow, s.wind);
    // Lightning during thunderstorms; the thunder follows a moment later.
    env.flash = Math.max(0, env.flash - dt * 6);
    if (w.kind === 'storm' && s.rain > 0.5) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 3 + Math.random() * 9;
        env.flash = 0.6 + Math.random() * 0.6;
        this.thunderIn = 0.4 + Math.random() * 2.2;
        this.thunderStrength = 1.2 - this.thunderIn * 0.3;
      }
    }
    if (this.thunderIn >= 0) this.thunderIn -= dt;
  }

  // ── Picking ──────────────────────────────────────────────────────────────

  /** Intersects a camera ray with the terrain heightfield. */
  pickGround(ndc: THREE.Vector2, camera: THREE.Camera): THREE.Vector3 | null {
    this.raycaster.setFromCamera(ndc, camera);
    const o = this.raycaster.ray.origin;
    const d = this.raycaster.ray.direction;
    const terrain = this.city.terrain;
    let t = 0;
    let prevT = 0;
    const maxT = 12000;
    for (let i = 0; i < 2000 && t < maxT; i++) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const h = terrain.heightAt(x, z);
      if (y <= h) {
        let lo = prevT, hi = t;
        for (let k = 0; k < 18; k++) {
          const mid = (lo + hi) / 2;
          const mx = o.x + d.x * mid, my = o.y + d.y * mid, mz = o.z + d.z * mid;
          if (my <= terrain.heightAt(mx, mz)) hi = mid;
          else lo = mid;
        }
        return new THREE.Vector3(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi);
      }
      prevT = t;
      t += Math.max(1, (y - h) * 0.5);
    }
    // Fall back to the water plane for rays that never hit land.
    if (d.y < -1e-4) {
      const tw = -o.y / d.y;
      const p = new THREE.Vector3(o.x + d.x * tw, 0, o.z + d.z * tw);
      if (p.x > -WORLD_SIZE && p.x < WORLD_SIZE * 2) return p;
    }
    return null;
  }

  /** Nearest building whose box the ray passes through. */
  /** Vehicle under the cursor (ray against each vehicle's oriented box). */
  /** The person on foot under the cursor (nearest along the ray), if any. */
  pickPerson(ndc: THREE.Vector2, camera: THREE.Camera): number | null {
    const ped = this.city.pedestrians;
    if (!this.pedestrians.visible || !ped.count) return null;
    this.raycaster.setFromCamera(ndc, camera);
    const o = this.raycaster.ray.origin, d = this.raycaster.ray.direction;
    let best: number | null = null;
    let bestT = Infinity;
    const horiz = Math.hypot(d.x, d.z);
    for (let i = 0; i < ped.max; i++) {
      if (!ped.active[i] || ped.scale[i] < 0.3) continue;
      const size = personSize(ped.age[i], ped.look[i]);
      const top = ped.y[i] + 1.8 * size.h;
      // Closest approach of the ray to the person's vertical axis, in plan.
      const px = ped.x[i] - o.x, pz = ped.z[i] - o.z;
      const t = horiz > 1e-6 ? (px * d.x + pz * d.z) / (horiz * horiz) : 0;
      if (t <= 0 || t >= bestT) continue;
      const cx = o.x + d.x * t - ped.x[i], cz = o.z + d.z * t - ped.z[i];
      // Generous radius: people are small on screen.
      const r = 0.55 + t * 0.004;
      if (cx * cx + cz * cz > r * r) continue;
      const y = o.y + d.y * t;
      if (y < ped.y[i] - 0.2 || y > top + 0.3) continue;
      bestT = t;
      best = i;
    }
    return best;
  }

  pickVehicle(ndc: THREE.Vector2, camera: THREE.Camera): number | null {
    this.raycaster.setFromCamera(ndc, camera);
    const ray = this.raycaster.ray;
    const v = this.city.vehicles;
    let best: number | null = null;
    let bestT = Infinity;
    const o = ray.origin, d = ray.direction;
    for (let i = 0; i < v.max; i++) {
      if (!v.active[i]) continue;
      const len = VEHICLE_LENGTH[v.model[i]] * 0.5 + 0.4;
      const m = v.model[i];
      const wid = (m >= 4 && m !== 7 ? 1.35 : 1.05) + 0.3;
      const ht = m >= 3 && m !== 7 ? 3.2 : 1.7;
      // Ray in the vehicle frame (x forward, z right, y up).
      const c = Math.cos(v.heading[i]), s = Math.sin(v.heading[i]);
      const px = o.x - v.x[i], py = o.y - v.y[i], pz = o.z - v.z[i];
      const lox = px * c + pz * s, loz = -px * s + pz * c;
      const ldx = d.x * c + d.z * s, ldz = -d.x * s + d.z * c;
      let t0 = -Infinity, t1 = Infinity;
      const slab = (p: number, dd: number, lo: number, hi: number) => {
        if (Math.abs(dd) < 1e-9) return p >= lo && p <= hi;
        let a = (lo - p) / dd, b = (hi - p) / dd;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
        return t0 <= t1;
      };
      if (!slab(lox, ldx, -len, len) || !slab(py, d.y, 0, ht) || !slab(loz, ldz, -wid, wid)) continue;
      if (t0 > 0 && t0 < bestT) {
        bestT = t0;
        best = i;
      }
    }
    return best;
  }

  pickBuilding(ndc: THREE.Vector2, camera: THREE.Camera, ground: THREE.Vector3 | null): number | null {
    this.raycaster.setFromCamera(ndc, camera);
    const ray = this.raycaster.ray;
    const candidates = new Set<number>();
    const probe = ground ?? ray.at(300, new THREE.Vector3());
    for (const b of this.city.buildings.queryRadius(probe.x, probe.z, 120)) candidates.add(b.id);
    // Tall buildings along the ray in front of the ground point.
    if (ground) {
      const steps = 8;
      for (let k = 1; k <= steps; k++) {
        const p = ray.origin.clone().lerp(ground, k / (steps + 1));
        for (const b of this.city.buildings.queryRadius(p.x, p.z, 60)) candidates.add(b.id);
      }
    }
    let best: number | null = null;
    let bestT = Infinity;
    const inv = new THREE.Matrix4();
    const local = new THREE.Ray();
    const box = new THREE.Box3();
    const hit = new THREE.Vector3();
    for (const id of candidates) {
      const b = this.city.buildings.get(id)!;
      const h = Math.max(3, this.buildings.heightOf(id) * Math.min(1, Math.max(0.05, b.progress)));
      const m = new THREE.Matrix4().makeRotationY(-b.angle).setPosition(b.cx, b.y, b.cz);
      inv.copy(m).invert();
      local.copy(ray).applyMatrix4(inv);
      box.min.set(-b.hw, -0.5, -b.hd);
      box.max.set(b.hw, h, b.hd);
      if (local.intersectBox(box, hit)) {
        const t = hit.applyMatrix4(m).distanceTo(ray.origin);
        if (t < bestT) {
          bestT = t;
          best = id;
        }
      }
    }
    if (best !== null && ground) {
      const g = ground.distanceTo(ray.origin);
      // Prefer the ground (roads) if the building hit is only the flat lot behind it.
      if (bestT > g + 2) return null;
    }
    return best;
  }

  pickSegment(p: THREE.Vector3): number | null {
    const hit = this.city.roads.nearestSegment(p.x, p.z, 40);
    if (!hit) return null;
    if (hit.proj.dist > ROAD_TYPES[hit.seg.type].halfWidth + 1) return null;
    return hit.seg.id;
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.roads.dispose();
    this.buildings.dispose();
    this.transit.dispose();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}
