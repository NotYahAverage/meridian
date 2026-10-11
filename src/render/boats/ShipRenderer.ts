import * as THREE from 'three';
import type { City } from '../../sim/City';
import type { Building } from '../../sim/buildings/Buildings';
import { WATER_LEVEL, WORLD_SIZE } from '../../sim/constants';
import { BuildingState } from '../../sim/types';
import type { AssetLibrary } from '../assets/AssetLibrary';
import { Pool, createAssetMaterial, writeMatrix } from '../assets/AssetMaterials';
import { globalUniforms } from '../shared';
import { wakeTexture } from './BoatRenderer';

const CELL = 24;
const N = Math.ceil(WORLD_SIZE / CELL);
const MAX_SHIPS = 8;
const LIVERIES = [0x1b3a6b, 0x8c1c13, 0x1e5631, 0x2b2b2b, 0x0b5e7a, 0x6b4f1d];
const SPEED = 7;
/** Seconds of sim time alongside the quay, and waiting out at sea. */
const DOCKED = 70;
const AWAY = 45;

/** A cell of water deep and wide enough for a ship, with no bridge over it. */
function shipable(city: City, x: number, z: number): boolean {
  const t = city.terrain;
  if (!t.inBounds(x, z, 30)) return false;
  for (const [dx, dz] of [[0, 0], [10, 0], [-10, 0], [0, 10], [0, -10]]) {
    if (t.sampleBase(x + dx, z + dz) > WATER_LEVEL - 3.5) return false;
    if (t.roadHeightAt(x + dx, z + dz) >= WATER_LEVEL + 2) return false;
  }
  return true;
}

export function shippingWater(city: City): Uint8Array {
  const g = new Uint8Array(N * N);
  for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) g[iz * N + ix] = shipable(city, (ix + 0.5) * CELL, (iz + 0.5) * CELL) ? 1 : 0;
  return g;
}

/** Where a ship ties up: just off the middle of the quay, parallel to it. */
export function berthOf(port: Pick<Building, 'cx' | 'cz' | 'angle' | 'hd'>): { x: number; z: number; angle: number; nx: number; nz: number } {
  const ca = Math.cos(port.angle), sa = Math.sin(port.angle);
  const nx = -sa, nz = ca;
  return { x: port.cx + nx * (port.hd + 13), z: port.cz + nz * (port.hd + 13), angle: port.angle, nx, nz };
}

/**
 * Shipping lane from open water to a port: a breadth-first search over a
 * coarse water grid to the nearest open sea (the map edge) or, on a lake, its
 * far shore, string-pulled into a few straight legs. Returns the points
 * from sea to berth, or null when the port has no route to open water.
 */
export function planLane(water: Uint8Array, port: Pick<Building, 'cx' | 'cz' | 'angle' | 'hd'>): number[] | null {
  const b = berthOf(port);
  // The first deep cell straight out from the quay.
  let start = -1, ax = 0, az = 0;
  for (let k = 0; k < 10 && start < 0; k++) {
    const x = b.x + b.nx * k * 12, z = b.z + b.nz * k * 12;
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    if (ix < 0 || iz < 0 || ix >= N || iz >= N) break;
    if (water[iz * N + ix]) {
      start = iz * N + ix;
      ax = x;
      az = z;
    }
  }
  if (start < 0) return null;
  const dist = new Int32Array(N * N).fill(-1);
  const prev = new Int32Array(N * N).fill(-1);
  const queue = new Int32Array(N * N);
  let head = 0, tail = 0;
  queue[tail++] = start;
  dist[start] = 0;
  // Ships come in from the nearest open sea (the map edge); on a lake, from its far side.
  let far = start, sea = -1;
  while (head < tail) {
    const c = queue[head++];
    const cx = c % N, cz = (c / N) | 0;
    if (dist[c] > dist[far]) far = c;
    if (sea < 0 && dist[c] >= 8 && (cx <= 2 || cz <= 2 || cx >= N - 3 || cz >= N - 3)) sea = c;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const n = nz * N + nx;
      if (!water[n] || dist[n] >= 0) continue;
      // No cutting corners past land.
      if (dx && dz && (!water[cz * N + nx] || !water[nz * N + cx])) continue;
      dist[n] = dist[c] + 1;
      prev[n] = c;
      queue[tail++] = n;
    }
  }
  const best = sea >= 0 ? sea : far;
  if (dist[best] < 8 || (sea < 0 && dist[best] < 12)) return null;
  const cells: number[] = [];
  for (let c = best; c >= 0; c = prev[c]) cells.push(c);
  const centre = (c: number): [number, number] => [((c % N) + 0.5) * CELL, (((c / N) | 0) + 0.5) * CELL];
  // String-pull: from each point, jump to the farthest cell still in clear sight.
  const clear = (x0: number, z0: number, x1: number, z1: number) => {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 8);
    for (let k = 1; k < n; k++) {
      const x = x0 + ((x1 - x0) * k) / n, z = z0 + ((z1 - z0) * k) / n;
      const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
      if (!water[iz * N + ix]) return false;
    }
    return true;
  };
  const pts: number[] = [...centre(cells[0])];
  let i = 0;
  while (i < cells.length - 1) {
    const [x0, z0] = centre(cells[i]);
    let j = cells.length - 1;
    while (j > i + 1 && !clear(x0, z0, ...centre(cells[j]))) j--;
    pts.push(...centre(cells[j]));
    i = j;
  }
  pts.push(ax, az, b.x, b.z);
  return pts;
}

type Phase = 'in' | 'docked' | 'out' | 'away';

interface Ship {
  portId: number;
  lane: number[];
  /** Index of the waypoint being steered for. */
  leg: number;
  phase: Phase;
  wait: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  color: number;
  phase0: number;
}

/**
 * Container ships for cargo harbours: each port keeps one ship busy, sailing
 * in from open water along a planned lane, tying up alongside the quay while
 * the cranes work, and heading back out to sea.
 */
export class ShipRenderer {
  readonly group = new THREE.Group();
  private pool: Pool;
  private wakes: THREE.InstancedMesh;
  private ships = new Map<number, Ship>();
  /** Whether each port's lane reaches the map edge. */
  private seaRoute = new Map<number, boolean>();
  private water: Uint8Array | null = null;
  private key = '';
  private time = 0;
  private check = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private col = new THREE.Color();
  private roll = new THREE.Matrix4();

  constructor(private city: City, assets: AssetLibrary) {
    this.pool = new Pool(assets.get('container_ship'), createAssetMaterial('container_ship'), MAX_SHIPS, { shadows: true, colors: true });
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.wakes = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: wakeTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), MAX_SHIPS);
    this.wakes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SHIPS * 3), 3);
    this.wakes.count = 0;
    this.wakes.frustumCulled = false;
    this.wakes.renderOrder = 3;
    this.group.add(this.pool.mesh, this.wakes);
  }

  /** What the port's ship is doing, for the inspector. */
  status(portId: number): string {
    const s = this.ships.get(portId);
    if (!s) return 'Opens when construction finishes';
    if (!s.lane.length) return 'No route for ships: needs a larger stretch of open water';
    const sea = this.seaRoute.get(portId) ? 'from the open sea' : 'across the lake';
    if (s.phase === 'docked') return `Ship alongside, unloading (lane ${sea})`;
    if (s.phase === 'in') return `Ship arriving ${sea}`;
    return s.phase === 'out' ? 'Ship departing' : 'Next ship on its way';
  }

  private ports(): Building[] {
    const out: Building[] = [];
    for (const b of this.city.buildings.all.values()) if (b.typeId === 'cargo_port' && b.state === BuildingState.Active) out.push(b);
    return out;
  }

  /** Rebuilds lanes when the water or the bridges change, and adds or drops ships with their ports. */
  private sync(): void {
    const ports = this.ports();
    let decks = 0;
    for (const s of this.city.roads.segments.values()) if (s.elevated) decks += s.id;
    const key = `${this.city.terrain.waterVersion}:${decks}`;
    if (key !== this.key) {
      this.key = key;
      this.water = ports.length ? shippingWater(this.city) : null;
      for (const s of this.ships.values()) s.lane = [];
    }
    const ids = new Set(ports.map((p) => p.id));
    for (const id of this.ships.keys()) if (!ids.has(id)) this.ships.delete(id);
    for (const p of ports.slice(0, MAX_SHIPS)) {
      let s = this.ships.get(p.id);
      if (s && s.lane.length) continue;
      if (!this.water) this.water = shippingWater(this.city);
      const lane = planLane(this.water, p) ?? [];
      if (lane.length) {
        const ex = lane[0], ez = lane[1], m = CELL * 3.5;
        this.seaRoute.set(p.id, ex < m || ez < m || ex > WORLD_SIZE - m || ez > WORLD_SIZE - m);
      }
      const berth = berthOf(p);
      if (!s) {
        // A new port opens with a ship already alongside.
        s = { portId: p.id, lane, leg: 0, phase: 'docked', wait: 20 + (p.id % 5) * 9, x: berth.x, z: berth.z, heading: berth.angle, speed: 0, color: LIVERIES[p.id % LIVERIES.length], phase0: p.id * 1.7 };
        this.ships.set(p.id, s);
      } else {
        s.lane = lane;
        s.leg = 0;
        if (s.phase === 'in' || s.phase === 'out') {
          s.phase = 'docked';
          s.x = berth.x;
          s.z = berth.z;
          s.heading = berth.angle;
          s.wait = 10;
        }
      }
    }
  }

  update(simDt: number, realDt: number): void {
    this.check -= realDt;
    if (this.check <= 0) {
      this.check = 2;
      this.sync();
    }
    const dt = Math.min(simDt, 0.5);
    this.time += dt;
    let n = 0, w = 0;
    for (const s of this.ships.values()) {
      if (!s.lane.length) continue;
      this.step(s, dt);
      const sw = this.time * 0.9 + s.phase0;
      const y = WATER_LEVEL - 5 + 0.12 * Math.sin(sw);
      this.q.setFromEuler(this.e.set(0, -s.heading, 0, 'YXZ'));
      this.m.compose(this.v.set(s.x, y, s.z), this.q, this.s.set(1, 1, 1));
      this.roll.makeRotationX(0.012 * Math.sin(sw * 0.7));
      this.m.multiply(this.roll);
      this.m.toArray(this.pool.matrices, n * 16);
      if (this.pool.colors) {
        this.col.setHex(s.color);
        this.pool.colors.set([this.col.r, this.col.g, this.col.b], n * 3);
      }
      n++;
      if (s.speed > 0.8) {
        const len = 30 + s.speed * 7;
        const back = 59 + len / 2;
        writeMatrix(this.wakes.instanceMatrix.array as Float32Array, w * 16, s.x - Math.cos(s.heading) * back, WATER_LEVEL + 0.1, s.z - Math.sin(s.heading) * back, s.heading + Math.PI, len, 1, 22 + s.speed * 2);
        const k = Math.min(1, s.speed / SPEED) * 0.38 * (1 - 0.75 * globalUniforms.uNight.value);
        (this.wakes.instanceColor!.array as Float32Array).set([k, k, k], w * 3);
        w++;
      }
    }
    this.pool.mesh.count = n;
    this.pool.mesh.instanceMatrix.needsUpdate = true;
    if (this.pool.mesh.instanceColor) this.pool.mesh.instanceColor.needsUpdate = true;
    this.wakes.count = w;
    this.wakes.instanceMatrix.needsUpdate = true;
    this.wakes.instanceColor!.needsUpdate = true;
  }

  private step(s: Ship, dt: number): void {
    const L = s.lane;
    const last = L.length / 2 - 1;
    if (s.phase === 'docked' || s.phase === 'away') {
      s.speed = Math.max(0, s.speed - dt * 0.5);
      s.wait -= dt;
      if (s.wait <= 0) {
        if (s.phase === 'docked') {
          s.phase = 'out';
          s.leg = last - 1;
        } else {
          s.phase = 'in';
          s.leg = 1;
        }
      }
      if (s.phase === 'docked') {
        // Hold alongside, parallel to the quay.
        const port = this.city.buildings.get(s.portId);
        if (port) {
          const b = berthOf(port);
          s.x += (b.x - s.x) * Math.min(1, dt * 0.3);
          s.z += (b.z - s.z) * Math.min(1, dt * 0.3);
          let d = b.angle - s.heading;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          // Either end may face forward; turn to whichever is closer.
          if (Math.abs(d) > Math.PI / 2) d = Math.atan2(Math.sin(d + Math.PI), Math.cos(d + Math.PI));
          s.heading += d * Math.min(1, dt * 0.25);
        }
      }
      return;
    }
    const inbound = s.phase === 'in';
    const tx = L[s.leg * 2], tz = L[s.leg * 2 + 1];
    const dx = tx - s.x, dz = tz - s.z;
    const dist = Math.hypot(dx, dz);
    // Distance to the end of the trip, to slow for the berth.
    const end = inbound ? last : 0;
    const ex = L[end * 2] - s.x, ez = L[end * 2 + 1] - s.z;
    const toEnd = Math.hypot(ex, ez);
    const isFinal = s.leg === end;
    if (dist < (isFinal ? 6 : 30)) {
      if (isFinal) {
        s.phase = inbound ? 'docked' : 'away';
        s.wait = inbound ? DOCKED : AWAY;
        return;
      }
      s.leg += inbound ? 1 : -1;
      return;
    }
    let diff = Math.atan2(dz, dx) - s.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    // Ships pivot slowly; between the quay and the deep-water point tugs push them sideways.
    const crab = (inbound && isFinal) || (!inbound && s.leg === last - 1);
    if (crab) {
      const port = this.city.buildings.get(s.portId);
      if (port && inbound) {
        let d = port.angle - s.heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        if (Math.abs(d) > Math.PI / 2) d = Math.atan2(Math.sin(d + Math.PI), Math.cos(d + Math.PI));
        s.heading += Math.max(-0.08 * dt, Math.min(0.08 * dt, d));
      }
    } else s.heading += Math.max(-0.12 * dt, Math.min(0.12 * dt, diff));
    const want = SPEED * Math.min(1, toEnd / 220 + 0.12) * (crab ? 0.4 : 1 - Math.min(0.75, Math.abs(diff)));
    s.speed += Math.max(-0.6 * dt, Math.min(0.35 * dt, want - s.speed));
    if (crab) {
      s.x += (dx / dist) * s.speed * dt;
      s.z += (dz / dist) * s.speed * dt;
    } else {
      s.x += Math.cos(s.heading) * s.speed * dt;
      s.z += Math.sin(s.heading) * s.speed * dt;
    }
  }
}
