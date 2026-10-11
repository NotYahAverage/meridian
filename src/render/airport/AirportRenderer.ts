import * as THREE from 'three';
import type { Building } from '../../sim/buildings/Buildings';
import type { City } from '../../sim/City';
import { BuildingState } from '../../sim/types';
import type { AssetLibrary } from '../assets/AssetLibrary';
import { Pool, createAssetMaterial } from '../assets/AssetMaterials';

/** Airline liveries (tail, engines and cheat line). */
const LIVERIES = [0x1f4fa8, 0xc0392b, 0x0e7c66, 0xe67e22, 0x6a1b9a, 0x00838f, 0x2c3e50, 0xd4a017];

/** Seconds of game time per arrival/departure cycle at 1× speed. */
const CYCLE = 96;

interface Key {
  t: number;
  x: number;
  z: number;
  y: number;
  /** Ease into this key: 'in' accelerates, 'out' decelerates. */
  ease?: 'in' | 'out';
  /** Moving backwards (pushback): the nose points against the motion. */
  reverse?: boolean;
}

// Lot-local coordinates (x along the frontage, z away from the road) for the
// regional airport generator: runway along x at z = 76, taxiway at z = 50,
// stands on the apron at z = 30.
const RUNWAY_Z = 76;
const TAXI_Z = 50;
const STANDS = [12, 44];

function departure(stand: number): Key[] {
  const sx = STANDS[stand];
  return [
    { t: 0, x: sx, z: 30, y: 0 },
    { t: 6, x: sx, z: 30, y: 0 },
    { t: 14, x: sx, z: TAXI_Z, y: 0, reverse: true },
    { t: 17, x: sx - 6, z: TAXI_Z, y: 0 },
    { t: 30, x: -111, z: TAXI_Z, y: 0 },
    { t: 33, x: -114, z: TAXI_Z + 6, y: 0 },
    { t: 36, x: -114, z: RUNWAY_Z - 4, y: 0 },
    { t: 38, x: -126, z: RUNWAY_Z, y: 0 },
    { t: 41, x: -126, z: RUNWAY_Z, y: 0 },
    { t: 49, x: 70, z: RUNWAY_Z, y: 0, ease: 'in' },
    { t: 53, x: 280, z: RUNWAY_Z, y: 22 },
    { t: 66, x: 1600, z: RUNWAY_Z, y: 190 },
  ];
}

function arrival(stand: number): Key[] {
  const sx = STANDS[stand];
  return [
    { t: 46, x: -1500, z: RUNWAY_Z, y: 84 },
    { t: 72, x: -112, z: RUNWAY_Z, y: 0.4 },
    { t: 73, x: -78, z: RUNWAY_Z, y: 0 },
    { t: 80, x: 88, z: RUNWAY_Z, y: 0, ease: 'out' },
    { t: 82, x: 101, z: RUNWAY_Z - 6, y: 0 },
    { t: 84, x: 101, z: TAXI_Z + 4, y: 0 },
    { t: 86, x: 95, z: TAXI_Z, y: 0 },
    { t: 91, x: sx + 4, z: TAXI_Z, y: 0 },
    { t: 93, x: sx, z: TAXI_Z - 5, y: 0 },
    { t: 96, x: sx, z: 30, y: 0 },
  ];
}

/** Position, heading and airborne state of a flight at time t (null before it starts / after it ends). */
function sample(keys: Key[], t: number): { x: number; z: number; y: number; dx: number; dz: number; dy: number; reverse: boolean; speed: number } | null {
  if (t < keys[0].t || t > keys[keys.length - 1].t) return null;
  let i = 1;
  while (i < keys.length - 1 && keys[i].t < t) i++;
  const a = keys[i - 1], b = keys[i];
  let f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  if (b.ease === 'in') f = f * f;
  else if (b.ease === 'out') f = 1 - (1 - f) * (1 - f);
  let dx = b.x - a.x, dz = b.z - a.z;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dz) < 0.01) {
    // Holding: keep the heading of the next move.
    const n = keys.slice(i).find((k) => Math.hypot(k.x - b.x, k.z - b.z) > 0.01);
    if (n) {
      dx = n.x - b.x;
      dz = n.z - b.z;
      if (n.reverse) {
        dx = -dx;
        dz = -dz;
      }
      return { x: a.x, z: a.z, y: a.y, dx, dz, dy: 0, reverse: false, speed: 0 };
    }
    dx = 0;
    dz = -1;
  }
  const speed = b.t > a.t ? Math.hypot(b.x - a.x, b.z - a.z, dy) / (b.t - a.t) : 0;
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, y: a.y + dy * f, dx, dz, dy, reverse: !!b.reverse, speed };
}

/**
 * Airliners at regional airports: one departure and one arrival every cycle,
 * with the plane that lands taxiing to the free stand to become the next
 * departure. Planes pause with the game and speed up with it.
 */
export class AirportRenderer {
  readonly group = new THREE.Group();
  private planes: Pool;
  private time = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private qp = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private yAxis = new THREE.Vector3(0, 1, 0);
  private zAxis = new THREE.Vector3(0, 0, 1);
  private color = new THREE.Color();
  /** 0–1: how loud the nearest jet is at the camera (for the audio). */
  loudness = 0;
  private ear = new THREE.Vector3();
  private airports: Building[] = [];
  private listKey = -1;

  constructor(private city: City, assets: AssetLibrary) {
    this.planes = new Pool(assets.get('airliner'), createAssetMaterial('airliner'), 16, { shadows: true, colors: true });
    this.group.add(this.planes.mesh);
  }

  update(simDt: number, ear?: THREE.Vector3): void {
    this.time += simDt;
    if (ear) this.ear.copy(ear);
    this.loudness = 0;
    // The airport list only changes when buildings are added or removed (or finish building).
    const key = this.city.buildings.count * 31 + this.city.stats.population;
    if (key !== this.listKey) {
      this.listKey = key;
      this.airports = [...this.city.buildings.all.values()].filter((q) => q.typeId === 'airport');
    }
    let n = 0;
    for (const b of this.airports) {
      if (b.state !== BuildingState.Active || !this.city.buildings.get(b.id)) continue;
      const phase = this.time + (b.id * 37) % CYCLE;
      const cycle = Math.floor(phase / CYCLE);
      const t = phase - cycle * CYCLE;
      const dep = cycle % 2, arr = 1 - dep;
      const liveryDep = LIVERIES[(cycle + b.id) % LIVERIES.length];
      const liveryArr = LIVERIES[(cycle + 1 + b.id) % LIVERIES.length];
      this.planes.ensure(n + 3);
      // Departing flight (it was parked at its stand since the last cycle).
      const d = sample(departure(dep), t);
      if (d) n = this.place(n, b, d, liveryDep);
      // Arriving flight, then parked at the other stand until it leaves next cycle.
      const a = sample(arrival(arr), t);
      if (a) n = this.place(n, b, a, liveryArr);
      // A plane in for maintenance, parked nose-in at the hangar.
      n = this.place(n, b, { x: 132, z: 44, y: 0, dx: 0, dz: -1, dy: 0, reverse: false, speed: 0 }, LIVERIES[(b.id + 3) % LIVERIES.length]);
    }
    this.planes.mesh.count = n;
    this.planes.mesh.instanceMatrix.needsUpdate = true;
    if (this.planes.mesh.instanceColor) this.planes.mesh.instanceColor.needsUpdate = true;
  }

  /** Writes one plane given lot-local position and motion. */
  private place(n: number, b: Building, s: { x: number; z: number; y: number; dx: number; dz: number; dy: number; reverse: boolean; speed: number }, livery: number): number {
    const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
    const lz = s.z - b.hd;
    const wx = b.cx + s.x * ca - lz * sa;
    const wz = b.cz + s.x * sa + lz * ca;
    let dxw = s.dx * ca - s.dz * sa;
    let dzw = s.dx * sa + s.dz * ca;
    if (s.reverse) {
      dxw = -dxw;
      dzw = -dzw;
    }
    const heading = Math.atan2(dzw, dxw);
    const horiz = Math.hypot(s.dx, s.dz);
    // Nose up a little in the air, more while climbing.
    const pitch = s.y > 0.2 ? Math.max(-0.02, Math.min(0.2, Math.atan2(s.dy, horiz) + 0.05)) : 0;
    this.q.setFromAxisAngle(this.yAxis, -heading);
    this.qp.setFromAxisAngle(this.zAxis, pitch);
    this.q.multiply(this.qp);
    this.m.compose(this.p.set(wx, b.y + s.y, wz), this.q, this.s);
    // Engines: a whine while taxiing, a roar on the takeoff roll and climb.
    const power = s.speed > 25 || s.y > 0.2 ? 1 : s.speed > 1 ? 0.3 : 0;
    if (power > 0) {
      const d = this.p.distanceTo(this.ear);
      this.loudness = Math.max(this.loudness, power / (1 + (d / 260) ** 2));
    }
    this.m.toArray(this.planes.matrices, n * 16);
    const cols = this.planes.colors;
    if (cols) {
      this.color.setHex(livery);
      cols[n * 3] = this.color.r;
      cols[n * 3 + 1] = this.color.g;
      cols[n * 3 + 2] = this.color.b;
    }
    return n + 1;
  }
}
