import type { RoadLayout } from '../roads/RoadLayout';

export interface SignalState {
  nodeId: number;
  /** Each phase lists the incoming segment ids that get a green. */
  phases: number[][];
  phase: number;
  timer: number;
  /** True during the all-red clearance interval. */
  clearing: boolean;
}

const GREEN = 16;
const CLEAR = 2.5;

/** Fixed-time traffic signal controllers for signalised junctions. */
export class Signals {
  readonly states = new Map<number, SignalState>();
  version = 0;

  constructor(private layout: RoadLayout) {}

  rebuild(): void {
    const old = this.states;
    const next = new Map<number, SignalState>();
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
      const prev = old.get(lay.nodeId);
      next.set(lay.nodeId, {
        nodeId: lay.nodeId,
        phases,
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
      } else if (st.timer >= GREEN) {
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
    return st.timer > GREEN - 3 ? 1 : 2;
  }
}
