import type { RoadLayout } from '../roads/RoadLayout';
import { ROAD_TYPES } from '../roads/RoadTypes';
import { hasCrosswalk, hasRefuge } from '../walk/WalkNetwork';

export interface SignalState {
  nodeId: number;
  /** Each phase lists the incoming segment ids that get a green. */
  phases: number[][];
  /** Green time of each phase (long enough for people to finish crossing). */
  green: number[];
  /** Per phase: arms whose crosswalk shows the walk signal while it runs. */
  walks: number[][];
  /** Per phase: seconds of steady "walk" at the start of the green, before the flashing hand. */
  walkTime: number[];
  phase: number;
  timer: number;
  /** True during the all-red clearance interval. */
  clearing: boolean;
}

const GREEN = 16;
const CLEAR = 2.5;
/** Shortest steady walk interval. */
const WALK_MIN = 5;
/** Walking pace the crossing time is planned for (a little slower than average, so everyone makes it). */
const CLEARANCE_SPEED = 1.2;

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
 * Fixed-time traffic signal controllers for signalised junctions. Opposite
 * approaches share a phase; people cross the arms whose traffic is held at red.
 */
export class Signals {
  readonly states = new Map<number, SignalState>();
  version = 0;

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
      const green = walks.map((w) => Math.max(GREEN, WALK_MIN + Math.max(0, ...w.map((id) => span.get(id)!)) / CLEARANCE_SPEED));
      const walkTime = walks.map((w, p) => Math.max(WALK_MIN, green[p] - Math.max(0, ...w.map((id) => span.get(id)!)) / CLEARANCE_SPEED));
      const prev = old.get(lay.nodeId);
      next.set(lay.nodeId, {
        nodeId: lay.nodeId,
        phases,
        green,
        walks,
        walkTime,
        phase: prev ? prev.phase % phases.length : (lay.nodeId * 7) % phases.length,
        timer: prev ? prev.timer : (lay.nodeId * 3.7) % GREEN,
        clearing: false,
      });
    }
    this.states.clear();
    for (const [k, v] of next) this.states.set(k, v);
    this.version++;
  }

  update(dt: number): void {
    for (const st of this.states.values()) {
      st.timer += dt;
      if (st.clearing) {
        if (st.timer >= CLEAR) {
          st.clearing = false;
          st.timer = 0;
          st.phase = (st.phase + 1) % st.phases.length;
        }
      } else if (st.timer >= st.green[st.phase]) {
        st.clearing = true;
        st.timer = 0;
      }
    }
  }

  /** Whether traffic arriving from `segId` may enter junction `nodeId`. */
  isGreen(nodeId: number, segId: number): boolean {
    const st = this.states.get(nodeId);
    if (!st) return true;
    if (st.clearing) return false;
    return st.phases[st.phase].includes(segId);
  }

  /** 0 = red, 1 = amber, 2 = green for rendering signal heads. */
  lightFor(nodeId: number, segId: number): 0 | 1 | 2 {
    const st = this.states.get(nodeId);
    if (!st) return 2;
    const mine = st.phases[st.phase].includes(segId);
    if (!mine) return 0;
    if (st.clearing) return 0;
    return st.timer > st.green[st.phase] - 3 ? 1 : 2;
  }

  /** The pedestrian signal at the crosswalk across arm `segId` of junction `nodeId`. */
  walkLight(nodeId: number, segId: number): WalkLight {
    const st = this.states.get(nodeId);
    if (!st || st.clearing || !st.walks[st.phase].includes(segId)) return WalkLight.DontWalk;
    return st.timer < st.walkTime[st.phase] ? WalkLight.Walk : WalkLight.Flashing;
  }

  /** Seconds until the crosswalk across `segId` next shows "walk" (0 while it does). */
  untilWalk(nodeId: number, segId: number): number {
    const st = this.states.get(nodeId);
    if (!st) return 0;
    if (!st.clearing && st.walks[st.phase].includes(segId) && st.timer < st.walkTime[st.phase]) return 0;
    let t = st.clearing ? CLEAR - st.timer : st.green[st.phase] - st.timer + CLEAR;
    for (let k = 1; k <= st.phases.length; k++) {
      const p = (st.phase + k) % st.phases.length;
      if (st.walks[p].includes(segId)) return t;
      t += st.green[p] + CLEAR;
    }
    return t;
  }

  /** Average wait for someone arriving at a random moment at the crosswalk across `segId`. */
  meanWalkWait(nodeId: number, segId: number): number {
    const st = this.states.get(nodeId);
    if (!st) return 0;
    let cycle = 0, walk = 0;
    for (let p = 0; p < st.phases.length; p++) {
      cycle += st.green[p] + CLEAR;
      if (st.walks[p].includes(segId)) walk += st.walkTime[p];
    }
    return cycle > 0 ? ((cycle - walk) * (cycle - walk)) / (2 * cycle) : 0;
  }
}
