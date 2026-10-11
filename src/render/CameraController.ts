import * as THREE from 'three';
import { clamp, damp, lerp, wrapAngle } from '../core/math';
import { WORLD_SIZE } from '../sim/constants';

export interface CameraState {
  x: number;
  z: number;
  distance: number;
  yaw: number;
  pitch: number;
}

const MIN_DIST = 18;
const MAX_DIST = 3600;
const DEFAULT_YAW = 0.45;
const DEFAULT_PITCH = 0.95;

/**
 * Strategic city camera orbiting a ground target. All motion is smoothed:
 * inputs move the *goal* state and the camera eases toward it.
 */
export class CameraController {
  readonly goal: CameraState;
  readonly cur: CameraState;
  readonly target = new THREE.Vector3();
  private flight: { from: CameraState; to: CameraState; t: number; dur: number } | null = null;
  edgeScroll = false;
  invertRotate = false;
  /** Mouse look / rotate sensitivity (1 = default). */
  lookSpeed = 1;
  /** Height of the ground below the target (provided by the world). */
  groundHeight: (x: number, z: number) => number = () => 0;
  /** Highest obstacle (building roof) at a point, or -Infinity (provided by the world). */
  obstacleHeight: (x: number, z: number) => number = () => -Infinity;
  /** Smoothed extra height that keeps the camera above rooftops. */
  private lift = 0;
  private keys = new Set<string>();
  /** Is a held camera action's key down? (Set by the game from the keybinds.) */
  isHeld: (action: string, pressed: Set<string>) => boolean = () => false;
  /** Classic camera style: Q / E style rotation keys turn the camera. */
  rotateKeys: () => boolean = () => false;

  constructor(private camera: THREE.PerspectiveCamera) {
    this.goal = { x: WORLD_SIZE / 2, z: WORLD_SIZE / 2, distance: 600, yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH };
    this.cur = { ...this.goal };
  }

  setKey(code: string, down: boolean): void {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  clearKeys(): void {
    this.keys.clear();
  }

  jumpTo(s: Partial<CameraState>): void {
    Object.assign(this.goal, s);
    Object.assign(this.cur, this.goal);
    this.flight = null;
  }

  /** Abandons any cinematic flight in progress. */
  stopFlight(): void {
    this.flight = null;
  }

  /** Smooth cinematic flight to a point. */
  flyTo(x: number, z: number, distance?: number, dur = 1.4): void {
    const to: CameraState = { ...this.goal, x, z, distance: distance ?? Math.min(this.goal.distance, 420) };
    this.flight = { from: { ...this.cur }, to, t: 0, dur };
  }

  /** Home: the default heading and tilt, looking at the same spot. */
  resetView(): void {
    this.flight = null;
    this.goal.yaw = DEFAULT_YAW + Math.round((this.goal.yaw - DEFAULT_YAW) / (Math.PI * 2)) * Math.PI * 2;
    this.goal.pitch = DEFAULT_PITCH;
  }

  /** Called when the player moves the camera by hand (stops vehicle following). */
  onManualMove: () => void = () => {};

  pan(dxScreen: number, dyScreen: number, viewportH: number): void {
    this.onManualMove();
    // Convert screen drag to world distance at the target depth.
    const worldPerPx = (2 * this.cur.distance * Math.tan((this.camera.fov * Math.PI) / 360)) / viewportH;
    const c = Math.cos(this.goal.yaw), s = Math.sin(this.goal.yaw);
    // Forward on the ground (camera looks along -offset) and screen-right.
    const fx = -c, fz = -s;
    const rx = -fz, rz = fx;
    const vy = 1 / Math.max(0.4, Math.sin(this.cur.pitch));
    this.goal.x += (-dxScreen * rx + dyScreen * vy * fx) * worldPerPx;
    this.goal.z += (-dxScreen * rz + dyScreen * vy * fz) * worldPerPx;
    this.flight = null;
    this.clampGoal();
  }

  rotate(dx: number, dy: number): void {
    const sgn = this.invertRotate ? -1 : 1;
    this.goal.yaw = this.goal.yaw + dx * 0.006 * sgn * this.lookSpeed;
    this.goal.pitch = clamp(this.goal.pitch + dy * 0.005 * this.lookSpeed, 0.32, 1.5);
    this.flight = null;
  }

  /**
   * Turns the view in place, free-cam style: the camera
   * stays where it is and the point it looks at swings around it.
   */
  look(dx: number, dy: number): void {
    const g = this.goal;
    const sgn = this.invertRotate ? -1 : 1;
    const cp = Math.cos(g.pitch);
    // Camera position (ground-relative) before turning.
    const px = g.x + Math.cos(g.yaw) * cp * g.distance;
    const pz = g.z + Math.sin(g.yaw) * cp * g.distance;
    const height = Math.sin(g.pitch) * g.distance;
    g.yaw += dx * 0.005 * sgn * this.lookSpeed;
    g.pitch = clamp(g.pitch + dy * 0.004 * this.lookSpeed, 0.32, 1.5);
    const cp2 = Math.cos(g.pitch);
    // Keep the same height above the ground while the gaze tilts.
    g.distance = clamp(height / Math.sin(g.pitch), MIN_DIST, MAX_DIST);
    g.x = px - Math.cos(g.yaw) * cp2 * g.distance;
    g.z = pz - Math.sin(g.yaw) * cp2 * g.distance;
    this.flight = null;
    this.clampGoal();
    this.onManualMove();
  }

  /** Zooms toward a world point (the cursor) so the point under the mouse stays put. */
  zoom(delta: number, focus?: { x: number; z: number }): void {
    const factor = Math.exp(delta * 0.0012);
    const nd = clamp(this.goal.distance * factor, MIN_DIST, MAX_DIST);
    const real = nd / this.goal.distance;
    if (focus && real !== 1) {
      this.goal.x = focus.x + (this.goal.x - focus.x) * real;
      this.goal.z = focus.z + (this.goal.z - focus.z) * real;
    }
    this.goal.distance = nd;
    this.flight = null;
    this.clampGoal();
  }

  private clampGoal(): void {
    const m = -200;
    this.goal.x = clamp(this.goal.x, m, WORLD_SIZE - m);
    this.goal.z = clamp(this.goal.z, m, WORLD_SIZE - m);
  }

  update(dt: number, viewportH: number, pointer: { x: number; y: number; inside: boolean }, viewportW: number): void {
    // Keyboard pan/rotate/tilt.
    const k = this.keys;
    // Shift moves slowly for precise framing.
    const slow = k.has('ShiftLeft') || k.has('ShiftRight') ? 0.3 : 1;
    const speed = this.goal.distance * 1.1 * dt * slow;
    let fx = 0, fz = 0;
    const held = (a: string) => this.isHeld(a, k);
    if (held('camForward')) fz += 1;
    if (held('camBack')) fz -= 1;
    if (held('camLeft')) fx -= 1;
    if (held('camRight')) fx += 1;
    if (this.edgeScroll && pointer.inside) {
      const e = 6;
      if (pointer.x < e) fx -= 1;
      if (pointer.x > viewportW - e) fx += 1;
      if (pointer.y < e) fz += 1;
      if (pointer.y > viewportH - e) fz -= 1;
    }
    if (fx || fz) {
      this.onManualMove();
      const c = Math.cos(this.goal.yaw), s = Math.sin(this.goal.yaw);
      const forwardX = -c, forwardZ = -s;
      const rightX = -forwardZ, rightZ = forwardX;
      this.goal.x += (forwardX * fz + rightX * fx) * speed;
      this.goal.z += (forwardZ * fz + rightZ * fx) * speed;
      this.flight = null;
      this.clampGoal();
    }
    if (this.rotateKeys() && held('camRotateLeft')) this.goal.yaw -= dt * 1.6;
    if (this.rotateKeys() && held('camRotateRight')) this.goal.yaw += dt * 1.6;
    if (held('camTiltUp')) this.goal.pitch = clamp(this.goal.pitch + dt * 0.9, 0.32, 1.5);
    if (held('camTiltDown')) this.goal.pitch = clamp(this.goal.pitch - dt * 0.9, 0.32, 1.5);
    if (held('camZoomIn')) this.zoom(-dt * 900);
    if (held('camZoomOut')) this.zoom(dt * 900);

    if (this.flight) {
      const f = this.flight;
      f.t += dt / f.dur;
      const t = Math.min(1, f.t);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      // Arc out slightly during long flights.
      const span = Math.hypot(f.to.x - f.from.x, f.to.z - f.from.z);
      const lift = Math.sin(t * Math.PI) * Math.min(span * 0.35, 900);
      this.goal.x = lerp(f.from.x, f.to.x, e);
      this.goal.z = lerp(f.from.z, f.to.z, e);
      this.goal.distance = lerp(f.from.distance, f.to.distance, e) + lift;
      Object.assign(this.cur, this.goal);
      if (t >= 1) this.flight = null;
    } else {
      const a = damp(9, dt);
      this.cur.x = lerp(this.cur.x, this.goal.x, a);
      this.cur.z = lerp(this.cur.z, this.goal.z, a);
      this.cur.distance = lerp(this.cur.distance, this.goal.distance, damp(8, dt));
      this.cur.yaw = this.cur.yaw + wrapAngle(this.goal.yaw - this.cur.yaw) * damp(10, dt);
      this.cur.pitch = lerp(this.cur.pitch, this.goal.pitch, damp(10, dt));
    }
    this.apply(dt);
  }

  apply(dt = 0): void {
    const c = this.cur;
    const gy = this.groundHeight(c.x, c.z);
    this.target.set(c.x, gy, c.z);
    // Flatten the view a bit when zoomed in close for a street-level feel.
    const closeTilt = clamp((c.distance - 30) / 250, 0, 1);
    const pitch = lerp(Math.min(c.pitch, 0.55), c.pitch, closeTilt);
    const cp = Math.cos(pitch);
    const offX = Math.cos(c.yaw) * cp * c.distance;
    const offZ = Math.sin(c.yaw) * cp * c.distance;
    const offY = Math.sin(pitch) * c.distance;
    let camY = gy + offY;
    const camX = c.x + offX;
    const camZ = c.z + offZ;
    const floor = this.groundHeight(camX, camZ) + 6;
    if (camY < floor) camY = floor;
    // Rise over buildings instead of clipping through them (eased so it never pops).
    const roof = this.obstacleHeight(camX, camZ) + 4;
    const need = Math.max(0, roof - camY);
    this.lift = dt > 0 ? lerp(this.lift, need, damp(need > this.lift ? 14 : 4, dt)) : need;
    camY += this.lift;
    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(this.target);
    this.camera.near = clamp(c.distance * 0.02, 0.5, 30);
    this.camera.far = 16000;
    this.camera.updateProjectionMatrix();
  }

  get distance(): number {
    return this.cur.distance;
  }
}
