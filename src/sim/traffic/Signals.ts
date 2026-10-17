import type { RoadLayout } from '../roads/RoadLayout';
import { ROAD_TYPES } from '../roads/RoadTypes';
import { hasCrosswalk, hasRefuge } from '../walk/WalkNetwork';

/** What the detectors on one approach see. */
export interface Sense {
  /** Vehicles close to the stop line, moving toward it or waiting. */
  near: number;
  /** Of those, the ones turning left. */
  left: number;
}

export enum Stage {
  /** Protected left-turn arrow (left and right turns only) before the main green. */
  Arrow = 0,
  Green = 1,
  Amber = 2,
  /** All red. */
  Clear = 3,
}

export interface SignalState {
  nodeId: number;
  /** Each phase lists the incoming segment ids that get a green. */
  phases: number[][];
  /** Shortest green of each phase (long enough for people to finish crossing). */
  green: number[];
  /** Per phase: arms whose crosswalk shows the walk signal while it runs. */
  walks: number[][];
  /** Per phase: seconds of steady "walk" at the start of the green, before the flashing hand. */
  walkTime: number[];
  phase: number;
  stage: Stage;
  timer: number;
  /** Length of the arrow at the start of this phase (0 when there isn't one). */
  arrow: number;
  /** Phases someone has pressed the crossing button for. */
  calls: Uint8Array;
  /** Phases whose left-turners went without an arrow last time round (they get one next time). */
  leftSkips: Uint8Array;
  /** Countdown to the next look at the detectors. */
  look: number;
  /** True during the all-red clearance interval (kept for older callers). */
  clearing: boolean;
}

/** Fixed-time green when nothing is detected. */
const GREEN = 16;
const MIN_GREEN = 8;
const MAX_GREEN = 40;
const AMBER = 3;
const CLEAR = 2;
/** Shortest steady walk interval. */
const WALK_MIN = 5;
/** Walking pace the crossing time is planned for (a little slower than average, so everyone makes it). */
const CLEARANCE_SPEED = 1.2;

export type Turn = 'left' | 'through' | 'right';

export enum WalkLight {
  DontWalk = 0,
  /** Flashing hand: finish crossing, don't start. */
  Flashing = 1,
  Walk = 2,
}

/** Distance a person crosses in one go at an arm's crosswalk (to the median refuge where there is one). */
export function crossingSpan(type: keyof typeof ROAD_TYPES): number {
  const rt = ROAD_TYPES[type];
  return hasRefuge(rt) ? rt.asphaltHalf - rt.median / 2 : rt.asphaltHalf * 2;
}

/**
 * Traffic-actuated signal controllers for signalised junctions. Opposite
 * approaches share a phase; people cross the arms whose traffic is held at red.
 * A green lasts while cars keep arriving (up to a limit) and ends early when the
 * road is clear and someone else is waiting; where left-turners pile up, the
 * phase opens with a protected arrow. With nothing detected, the lights simply
 * cycle through their shortest greens.
 */
export class Signals {
  readonly states = new Map<number, SignalState>();
  version = 0;
  /** Reads the detectors on approach `segId` of junction `nodeId` (set by the vehicles). */
  sense: ((nodeId: number, segId: number, out: Sense) => void) | null = null;
  private s: Sense = { near: 0, left: 0 };

  constructor(private layout: RoadLayout) {}

  rebuild(): void {
    const old = this.states;
    const next = new Map<number, SignalState>();
    const net = this.layout.net;
    for (const lay of this.layout.nodes.values()) {
      if (lay.control !== 'signal') continue;
      const arms = lay.arms;
      const used = new Set<number>();
      const phases: number[][] = [];
      for (let i = 0; i < arms.length; i++) {
        if (used.has(i)) continue;
        used.add(i);
        let best = -1;
        let bestDot = -0.6;
        for (let j = 0; j < arms.length; j++) {
          if (used.has(j)) continue;
          const dot = arms[i].dx * arms[j].dx + arms[i].dz * arms[j].dz;
          if (dot < bestDot) {
            bestDot = dot;
            best = j;
          }
        }
        const phase = [arms[i].segId];
        if (best >= 0) {
          used.add(best);
          phase.push(arms[best].segId);
        }
        phases.push(phase);
      }
      // Arms with a crosswalk, and how far people walk across each.
      const span = new Map<number, number>();
      for (const a of arms) {
        const seg = net.segments.get(a.segId);
        if (seg && hasCrosswalk(this.layout, lay.nodeId, seg)) span.set(a.segId, crossingSpan(seg.type));
      }
      const walks = phases.map((p) => [...span.keys()].filter((id) => !p.includes(id)));
      const green = walks.map((w) => Math.max(MIN_GREEN, WALK_MIN + Math.max(0, ...w.map((id) => span.get(id)!)) / CLEARANCE_SPEED));
      const walkTime = walks.map((w, p) => Math.max(WALK_MIN, green[p] - Math.max(0, ...w.map((id) => span.get(id)!)) / CLEARANCE_SPEED));
      const prev = old.get(lay.nodeId);
      next.set(lay.nodeId, {
        nodeId: lay.nodeId,
        phases,
        green,
        walks,
        walkTime,
        phase: prev ? prev.phase % phases.length : (lay.nodeId * 7) % phases.length,
        stage: prev && prev.phases.length === phases.length ? prev.stage : Stage.Green,
        timer: prev ? prev.timer : (lay.nodeId * 3.7) % GREEN,
        arrow: prev && prev.phases.length === phases.length ? prev.arrow : 0,
        calls: new Uint8Array(phases.length),
        leftSkips: new Uint8Array(phases.length),
        look: 0,
        clearing: prev ? prev.clearing : false,
      });
    }
    this.states.clear();
    for (const [k, v] of next) this.states.set(k, v);
    this.version++;
  }

  /** Detector totals for one phase. */
  private phaseSense(st: SignalState, p: number): Sense {
    const s = this.s;
    let near = 0, left = 0;
    if (this.sense) {
      for (const id of st.phases[p]) {
        this.sense(st.nodeId, id, s);
        near += s.near;
        left += s.left;
      }
    }
    s.near = near;
    s.left = left;
    return s;
  }

  private begin(st: SignalState, p: number): void {
    st.phase = p;
    st.timer = 0;
    st.calls[p] = 0;
    st.arrow = 0;
    if (this.sense) {
      const left = this.phaseSense(st, p).left;
      if (left >= 3 || (left >= 1 && st.leftSkips[p] >= 2)) {
        st.arrow = Math.min(14, Math.max(6, 3 + left * 2));
        st.leftSkips[p] = 0;
      } else if (left > 0) st.leftSkips[p]++;
    }
    st.stage = st.arrow > 0 ? Stage.Arrow : Stage.Green;
    st.clearing = false;
  }

  update(dt: number): void {
    for (const st of this.states.values()) {
      st.timer += dt;
      switch (st.stage) {
        case Stage.Arrow: {
          // Short if the turn lane empties early.
          let done = st.timer >= st.arrow;
          if (!done && st.timer >= 4 && (st.look -= dt) <= 0) {
            st.look = 0.5;
            done = this.phaseSense(st, st.phase).left === 0;
          }
          if (done) {
            st.stage = Stage.Green;
            st.timer = 0;
          }
          break;
        }
        case Stage.Green: {
          const min = st.green[st.phase];
          if (st.timer < min) break;
          if (!this.sense) {
            if (st.timer >= Math.max(GREEN, min)) this.toAmber(st);
            break;
          }
          if ((st.look -= dt) > 0 && st.timer < MAX_GREEN) break;
          st.look = 0.5;
          if (st.timer >= MAX_GREEN) {
            this.toAmber(st);
            break;
          }
          // Keep the green while cars are still coming; end it when the road is clear.
          if (this.phaseSense(st, st.phase).near > 0) {
            // Others waiting: don't hold them forever.
            if (st.timer > 22 && this.othersWaiting(st)) this.toAmber(st);
            break;
          }
          this.toAmber(st);
          break;
        }
        case Stage.Amber:
          if (st.timer >= AMBER) {
            st.stage = Stage.Clear;
            st.clearing = true;
            st.timer = 0;
          }
          break;
        case Stage.Clear:
          if (st.timer >= CLEAR) this.begin(st, (st.phase + 1) % st.phases.length);
          break;
      }
    }
  }

  private toAmber(st: SignalState): void {
    st.stage = Stage.Amber;
    st.timer = 0;
  }

  private othersWaiting(st: SignalState): boolean {
    for (let p = 0; p < st.phases.length; p++) {
      if (p === st.phase) continue;
      if (st.calls[p] || this.phaseSense(st, p).near > 0) return true;
    }
    return false;
  }

  /** Someone pressed the button at the crosswalk across `segId`. */
  request(nodeId: number, segId: number): void {
    const st = this.states.get(nodeId);
    if (!st) return;
    for (let p = 0; p < st.phases.length; p++) if (p !== st.phase && st.walks[p].includes(segId)) st.calls[p] = 1;
  }

  /** Whether traffic arriving from `segId` may enter junction `nodeId` (making `turn`, when known). */
  isGreen(nodeId: number, segId: number, turn?: Turn): boolean {
    const st = this.states.get(nodeId);
    if (!st) return true;
    if (st.stage === Stage.Clear || !st.phases[st.phase].includes(segId)) return false;
    if (st.stage === Stage.Arrow) return turn === 'left' || turn === 'right';
    return true;
  }

  /** True while the light facing `segId` shows amber. */
  isAmber(nodeId: number, segId: number): boolean {
    const st = this.states.get(nodeId);
    return !!st && st.stage === Stage.Amber && st.phases[st.phase].includes(segId);
  }

  /** True while left-turners from `segId` have a protected arrow (oncoming traffic is held). */
  arrowOn(nodeId: number, segId: number): boolean {
    const st = this.states.get(nodeId);
    return !!st && st.stage === Stage.Arrow && st.phases[st.phase].includes(segId);
  }

  /** 0 = red, 1 = amber, 2 = green for rendering signal heads (red for straight-on traffic during an arrow). */
  lightFor(nodeId: number, segId: number): 0 | 1 | 2 {
    const st = this.states.get(nodeId);
    if (!st) return 2;
    if (!st.phases[st.phase].includes(segId)) return 0;
    return st.stage === Stage.Green ? 2 : st.stage === Stage.Amber ? 1 : 0;
  }

  /** The pedestrian signal at the crosswalk across arm `segId` of junction `nodeId`. */
  walkLight(nodeId: number, segId: number): WalkLight {
    const st = this.states.get(nodeId);
    if (!st || st.stage !== Stage.Green || !st.walks[st.phase].includes(segId)) return WalkLight.DontWalk;
    const p = st.phase;
    if (st.timer < st.walkTime[p]) return WalkLight.Walk;
    // The flashing hand lasts long enough to finish crossing; while the green goes on after that, a steady hand.
    return st.timer < st.green[p] ? WalkLight.Flashing : WalkLight.DontWalk;
  }

  /** Seconds until the crosswalk across `segId` next shows "walk" (0 while it does). */
  untilWalk(nodeId: number, segId: number): number {
    const st = this.states.get(nodeId);
    if (!st) return 0;
    if (this.walkLight(nodeId, segId) === WalkLight.Walk) return 0;
    const p0 = st.phase;
    let t: number;
    switch (st.stage) {
      case Stage.Arrow:
        if (st.walks[p0].includes(segId)) return Math.max(0, st.arrow - st.timer);
        t = Math.max(0, st.arrow - st.timer) + st.green[p0] + AMBER + CLEAR;
        break;
      case Stage.Green:
        t = Math.max(0, st.green[p0] - st.timer) + AMBER + CLEAR;
        break;
      case Stage.Amber:
        t = AMBER - st.timer + CLEAR;
        break;
      default:
        t = CLEAR - st.timer;
    }
    for (let k = 1; k <= st.phases.length; k++) {
      const p = (p0 + k) % st.phases.length;
      if (st.walks[p].includes(segId)) return t;
      t += st.green[p] + AMBER + CLEAR;
    }
    return t;
  }

  /** Average wait for someone arriving at a random moment at the crosswalk across `segId` (cycling at the shortest greens). */
  meanWalkWait(nodeId: number, segId: number): number {
    const st = this.states.get(nodeId);
    if (!st) return 0;
    let cycle = 0, walk = 0;
    for (let p = 0; p < st.phases.length; p++) {
      cycle += st.green[p] + AMBER + CLEAR;
      if (st.walks[p].includes(segId)) walk += st.walkTime[p];
    }
    return cycle > 0 ? ((cycle - walk) * (cycle - walk)) / (2 * cycle) : 0;
  }
}
