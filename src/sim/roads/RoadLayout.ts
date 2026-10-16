import { type PolyPoint, lineIntersect, pointAt } from '../../core/geom2d';
import { TAU } from '../../core/math';
import type { RoadNetwork, RoadSegment } from './RoadNetwork';
import { isFreeway, ROAD_TYPES } from './RoadTypes';

export type NodeControl = 'none' | 'yield' | 'signal' | 'roundabout';

export interface Arm {
  segId: number;
  /** True when the node is the segment's `a` end. */
  atA: boolean;
  /** Outgoing direction at the node. */
  dx: number;
  dz: number;
  angle: number;
  trim: number;
  /** Trimmed end point on the centreline, and tangent pointing away from the node. */
  px: number;
  pz: number;
  tx: number;
  tz: number;
  halfWidth: number;
  asphaltHalf: number;
}

export interface NodeLayout {
  nodeId: number;
  kind: 'isolated' | 'end' | 'through' | 'junction';
  control: NodeControl;
  /** Arms sorted by ascending angle (each next arm lies to the right of the previous). */
  arms: Arm[];
  radius: number;
}

const CORNER_RADIUS: Record<string, number> = { street: 3.5, avenue: 5, boulevard: 6.5, highway: 7 };

/** Derives junction geometry (segment trims, controls) from the road graph. */
export class RoadLayout {
  readonly nodes = new Map<number, NodeLayout>();
  /** Bumped whenever any node layout changes (used by renderers). */
  version = 0;

  constructor(readonly net: RoadNetwork) {}

  rebuildAll(): void {
    this.nodes.clear();
    for (const id of this.net.nodes.keys()) this.updateNode(id);
    for (const seg of this.net.segments.values()) this.fixTrims(seg);
    this.version++;
  }

  /** Recomputes layouts for the given nodes (and fixes trims of their segments). */
  update(nodeIds: Iterable<number>): void {
    const segs = new Set<RoadSegment>();
    for (const id of nodeIds) {
      if (!this.net.nodes.has(id)) {
        this.nodes.delete(id);
        continue;
      }
      this.updateNode(id);
      for (const sid of this.net.getNode(id).segs) segs.add(this.net.getSegment(sid));
    }
    for (const seg of segs) this.fixTrims(seg);
    this.version++;
  }

  get(nodeId: number): NodeLayout | undefined {
    return this.nodes.get(nodeId);
  }

  private updateNode(nodeId: number): void {
    const net = this.net;
    const node = net.getNode(nodeId);
    const arms: Arm[] = [];
    const dir = { x: 0, z: 0 };
    for (const sid of node.segs) {
      const seg = net.getSegment(sid);
      net.endDirection(seg, nodeId, dir);
      const rt = ROAD_TYPES[seg.type];
      arms.push({
        segId: sid,
        atA: seg.a === nodeId,
        dx: dir.x,
        dz: dir.z,
        angle: Math.atan2(dir.z, dir.x),
        trim: 0,
        px: node.x,
        pz: node.z,
        tx: dir.x,
        tz: dir.z,
        halfWidth: rt.halfWidth,
        asphaltHalf: rt.asphaltHalf,
      });
    }
    arms.sort((p, q) => p.angle - q.angle);

    let kind: NodeLayout['kind'] = 'junction';
    if (arms.length === 0) kind = 'isolated';
    else if (arms.length === 1) kind = 'end';
    else if (arms.length === 2) {
      const dot = arms[0].dx * arms[1].dx + arms[0].dz * arms[1].dz;
      const sameWidth = Math.abs(arms[0].halfWidth - arms[1].halfWidth) < 0.01;
      if (dot < -0.82 && sameWidth) kind = 'through';
    }

    if (kind === 'junction') {
      const n = arms.length;
      for (let i = 0; i < n; i++) {
        const ai = arms[i];
        const aj = arms[(i + 1) % n];
        let gap = aj.angle - ai.angle;
        if (n === 1) continue;
        if (gap <= 0) gap += TAU;
        if (gap >= Math.PI - 0.08) continue;
        // Right edge of arm i meets left edge of arm j.
        const rix = -ai.dz, riz = ai.dx;
        const ljx = aj.dz, ljz = -aj.dx;
        const hit = lineIntersect(
          node.x + rix * ai.halfWidth, node.z + riz * ai.halfWidth, ai.dx, ai.dz,
          node.x + ljx * aj.halfWidth, node.z + ljz * aj.halfWidth, aj.dx, aj.dz,
        );
        if (!hit) continue;
        if (hit.t > ai.trim) ai.trim = hit.t;
        if (hit.u > aj.trim) aj.trim = hit.u;
      }
      let maxOtherHalf = 0;
      for (const a of arms) maxOtherHalf = Math.max(maxOtherHalf, a.asphaltHalf);
      for (const a of arms) {
        const seg = net.getSegment(a.segId);
        const r = CORNER_RADIUS[seg.type] ?? 4;
        let trim = Math.max(a.trim, 0) + r;
        trim = Math.max(trim, maxOtherHalf * 0.75 + 1.5);
        trim = Math.min(trim, 48, seg.length * 0.45);
        a.trim = trim;
      }
    }

    let control: NodeControl = 'none';
    if (arms.length >= 3) {
      const types = arms.map((a) => net.getSegment(a.segId).type);
      const allHighway = types.every((t) => isFreeway(t));
      const anyMajor = types.some((t) => ROAD_TYPES[t].signals);
      control = allHighway ? 'none' : anyMajor ? 'signal' : 'yield';
      if (arms.some((a) => net.getSegment(a.segId).ring)) control = 'roundabout';
    }

    let radius = 0;
    for (const a of arms) radius = Math.max(radius, a.trim);
    const layout: NodeLayout = { nodeId, kind, control, arms, radius };
    this.nodes.set(nodeId, layout);

    for (const a of arms) {
      const seg = net.getSegment(a.segId);
      if (a.atA) seg.trimA = a.trim;
      else seg.trimB = a.trim;
    }
  }

  /** Ensures trims leave a usable middle section and records trimmed end frames. */
  private fixTrims(seg: RoadSegment): void {
    const maxTotal = seg.length * 0.9;
    const total = seg.trimA + seg.trimB;
    if (total > maxTotal && total > 0) {
      const k = maxTotal / total;
      seg.trimA *= k;
      seg.trimB *= k;
    }
    const p: PolyPoint = { x: 0, z: 0, tx: 0, tz: 0, i: 0 };
    for (const end of [seg.a, seg.b]) {
      const lay = this.nodes.get(end);
      if (!lay) continue;
      const arm = lay.arms.find((a) => a.segId === seg.id && a.atA === (end === seg.a));
      if (!arm) continue;
      if (arm.atA) {
        arm.trim = seg.trimA;
        pointAt(seg.poly, seg.trimA, p);
        arm.px = p.x;
        arm.pz = p.z;
        arm.tx = p.tx;
        arm.tz = p.tz;
      } else {
        arm.trim = seg.trimB;
        pointAt(seg.poly, seg.length - seg.trimB, p);
        arm.px = p.x;
        arm.pz = p.z;
        arm.tx = -p.tx;
        arm.tz = -p.tz;
      }
    }
  }
}
