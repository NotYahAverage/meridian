import {
  type P2,
  type PolyPoint,
  type Polyline,
  type Projection,
  bezierTangent,
  pointAt,
  polylineIntersections,
  projectOnPolyline,
  sampleBezier,
  tAt,
} from '../../core/geom2d';
import type { Terrain } from '../world/Terrain';
import type { RoadNetwork, RoadSegment } from './RoadNetwork';
import { OVERPASS_COST_FACTOR, OVERPASS_MIN_CROSS, liftProfile, nodeRaised, raisedLift } from './Overpass';
import { isFreeway, ROAD_TYPES, type RoadTypeId } from './RoadTypes';

export interface Snap {
  kind: 'free' | 'node' | 'segment';
  x: number;
  z: number;
  nodeId?: number;
  segId?: number;
  s?: number;
}

export interface PlanEvent {
  /** Arc length along the new road. */
  s: number;
  x: number;
  z: number;
  kind: 'node' | 'cross';
  nodeId?: number;
  segId?: number;
}

export interface RoadPlan {
  type: RoadTypeId;
  start: Snap;
  end: Snap;
  ctrl: P2;
  curved: boolean;
  poly: Polyline;
  length: number;
  cost: number;
  /** Intermediate junctions created or reused along the new road. */
  events: PlanEvent[];
  valid: boolean;
  error?: string;
  /** The road crosses water and is built as a bridge. */
  elevated: boolean;
  /** Length over water (m). */
  bridgeLength: number;
  /** Build as a one-way road in the drawing direction. */
  oneway?: boolean;
  /** Build as a raised highway (overpass). */
  raised?: boolean;
}

/** Longest water crossing a single bridge can make. */
export const MAX_BRIDGE_SPAN = 700;
/** Bridge spans cost this many times the normal road price per metre. */
export const BRIDGE_COST_FACTOR = 4;

export const SNAP_NODE_RADIUS = 9;
const MIN_PIECE = 7;
const MIN_ANGLE = (22 * Math.PI) / 180;

/** Snaps a cursor position onto existing road nodes or segments. */
/** How close the cursor must come to a road-less highway entry to snap to it. */
const ENTRY_SNAP_RADIUS = 60;

/** Map-edge entry nodes that have lost their road. */
function looseEntry(net: RoadNetwork, x: number, z: number, r: number) {
  let best = null;
  let bestD = r * r;
  for (const n of net.nodes.values()) {
    if (!n.outside || n.segs.length) continue;
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

export function snapPoint(net: RoadNetwork, x: number, z: number, type: RoadTypeId, enabled = true): Snap {
  if (!enabled) return { kind: 'free', x, z };
  const hw = ROAD_TYPES[type].halfWidth;
  // A highway entry left without its road (after demolishing it) snaps from far away, so it can be rebuilt.
  const entry = looseEntry(net, x, z, ENTRY_SNAP_RADIUS);
  if (entry) return { kind: 'node', x: entry.x, z: entry.z, nodeId: entry.id };
  const node = net.nearestNode(x, z, Math.max(SNAP_NODE_RADIUS, hw * 0.8));
  if (node) return { kind: 'node', x: node.x, z: node.z, nodeId: node.id };
  const hit = net.nearestSegment(x, z, 24);
  if (hit && hit.proj.dist <= ROAD_TYPES[hit.seg.type].halfWidth + 2) {
    const seg = hit.seg;
    if (hit.proj.s < MIN_PIECE + 1) {
      const n = net.getNode(seg.a);
      return { kind: 'node', x: n.x, z: n.z, nodeId: n.id };
    }
    if (hit.proj.s > seg.length - MIN_PIECE - 1) {
      const n = net.getNode(seg.b);
      return { kind: 'node', x: n.x, z: n.z, nodeId: n.id };
    }
    return { kind: 'segment', x: hit.proj.x, z: hit.proj.z, segId: seg.id, s: hit.proj.s };
  }
  return { kind: 'free', x, z };
}

function fail(plan: RoadPlan, error: string): RoadPlan {
  plan.valid = false;
  plan.error = error;
  return plan;
}

function angleBetween(ax: number, az: number, bx: number, bz: number): number {
  const d = Math.max(-1, Math.min(1, ax * bx + az * bz));
  return Math.acos(d);
}

/** Validates and prices a proposed road between two snapped points. */
export function planRoad(
  net: RoadNetwork,
  terrain: Terrain,
  type: RoadTypeId,
  start: Snap,
  end: Snap,
  ctrlIn: P2 | null,
  raised = false,
): RoadPlan {
  const rt = ROAD_TYPES[type];
  const ctrl = ctrlIn ?? { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 };
  const poly = sampleBezier(start.x, start.z, ctrl.x, ctrl.z, end.x, end.z, 2);
  const plan: RoadPlan = {
    type,
    start,
    end,
    ctrl,
    curved: ctrlIn !== null,
    poly,
    length: poly.length,
    cost: Math.round(poly.length * rt.costPerMeter),
    events: [],
    valid: true,
    elevated: false,
    bridgeLength: 0,
  };

  if (raised) plan.raised = true;
  if (start.kind === 'node' && end.kind === 'node' && start.nodeId === end.nodeId) return fail(plan, 'Road is too short');
  if (raised && !isFreeway(type)) return fail(plan, 'Only highways and expressways can be raised');
  // A raised road stays up where it joins other raised highways and ramps down everywhere else.
  const endUp = (s: Snap) => {
    if (s.kind !== 'node' || s.nodeId === undefined) return false;
    const n = net.nodes.get(s.nodeId);
    return !!n && n.segs.length > 0 && n.segs.every((sid) => net.getSegment(sid).raised);
  };
  const upA = raised && endUp(start), upB = raised && endUp(end);
  const liftAt = (s: number) => (raised ? liftProfile(s, poly.length, upA, upB) : 0);
  for (const sn of [start, end]) {
    // Raised highways are joined only at their ends; a ground road can't meet one in mid-air.
    if (sn.kind === 'segment' && net.segments.get(sn.segId!)?.raised) return fail(plan, 'Join a raised highway at its end');
    if (!raised && sn.kind === 'node' && nodeRaised(net, sn.nodeId!)) return fail(plan, 'Ground roads can\'t join a raised highway in mid-air');
  }
  if (poly.length < 10) return fail(plan, 'Road is too short');
  if (poly.length > 1400) return fail(plan, 'Road is too long — place it in shorter pieces');

  if (ctrlIn) {
    const t0 = bezierTangent(start.x, start.z, ctrl.x, ctrl.z, end.x, end.z, 0, { x: 0, z: 0 });
    const t1 = bezierTangent(start.x, start.z, ctrl.x, ctrl.z, end.x, end.z, 1, { x: 0, z: 0 });
    if (angleBetween(t0.x, t0.z, t1.x, t1.z) > (140 * Math.PI) / 180) return fail(plan, 'Curve is too sharp');
  }

  // Existing direct connection between the same two nodes?
  if (start.kind === 'node' && end.kind === 'node') {
    const a = net.getNode(start.nodeId!);
    for (const sid of a.segs) {
      const s = net.getSegment(sid);
      if (net.otherEnd(s, a.id) === end.nodeId && !ctrlIn) return fail(plan, 'These points are already connected');
    }
  }

  // Terrain and bounds. Roads that cross water become bridges.
  // A road ending on a highway entry may run right up to the map edge there.
  const entries = [start, end].filter((e) => e.kind === 'node' && net.nodes.get(e.nodeId!)?.outside);
  const nearEntry = (x: number, z: number) => entries.some((e) => Math.hypot(e.x - x, e.z - z) < 10);
  const p: PolyPoint = { x: 0, z: 0, tx: 0, tz: 0, i: 0 };
  for (let s = 0; s <= poly.length + 0.01; s += 4) {
    pointAt(poly, s, p);
    if (!terrain.inBounds(p.x, p.z, 2) && !nearEntry(p.x, p.z)) return fail(plan, 'Outside the city limits');
    if (!terrain.owned(p.x, p.z) && !nearEntry(p.x, p.z)) return fail(plan, 'You don\'t own this land yet. Buy it in City Info → Land');
    if (terrain.isWater(p.x, p.z, 0.35)) {
      if (raised) return fail(plan, 'Raised highways can\'t cross water; draw a normal bridge');
      plan.elevated = true;
      plan.bridgeLength += 4;
    }
  }
  if (plan.elevated) {
    if (plan.bridgeLength > MAX_BRIDGE_SPAN) return fail(plan, 'Bridge is too long');
    // Both ends must be back on the ground so the ramps fit inside this road.
    if (terrain.needsDeck(start.x, start.z, 0.4) || terrain.needsDeck(end.x, end.z, 0.4)) {
      return fail(plan, 'Start and end the bridge further from the water so its ramps fit');
    }
    let deckLen = 0;
    for (let s = 0; s <= poly.length + 0.01; s += 4) {
      pointAt(poly, s, p);
      if (terrain.needsDeck(p.x, p.z, 1)) deckLen += 4;
    }
    plan.cost = Math.round((poly.length + deckLen * (BRIDGE_COST_FACTOR - 1)) * rt.costPerMeter);
  }
  if (raised) plan.cost = Math.round(poly.length * rt.costPerMeter * OVERPASS_COST_FACTOR);
  const heightAt = (x: number, z: number) => (plan.elevated ? Math.max(terrain.groundRoadHeightAt(x, z), terrain.deckHeightAt(x, z)) : terrain.roadHeightAt(x, z));
  let prevH = 0;
  let prevS = 0;
  for (let s = 0; s <= poly.length + 0.01; s += 4) {
    pointAt(poly, s, p);
    const h = heightAt(p.x, p.z) + liftAt(s);
    if (s > 0 && s - prevS >= 8) {
      if (Math.abs(h - prevH) / (s - prevS) > 0.16) return fail(plan, 'Terrain is too steep here');
      prevH = h;
      prevS = s;
    }
    if (s === 0) prevH = h;
  }

  // Collect crossings with existing roads.
  const startSeg = start.kind === 'segment' ? start.segId : undefined;
  const endSeg = end.kind === 'segment' ? end.segId : undefined;
  const endpointNodes = new Set<number>();
  if (start.nodeId !== undefined) endpointNodes.add(start.nodeId);
  if (end.nodeId !== undefined) endpointNodes.add(end.nodeId);
  const pad = rt.halfWidth + 20;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < poly.count; i++) {
    minX = Math.min(minX, poly.pts[i * 2]);
    maxX = Math.max(maxX, poly.pts[i * 2]);
    minZ = Math.min(minZ, poly.pts[i * 2 + 1]);
    maxZ = Math.max(maxZ, poly.pts[i * 2 + 1]);
  }
  const nearby = net.segmentsIn(minX - pad, minZ - pad, maxX + pad, maxZ + pad);
  const events: PlanEvent[] = [];
  const addNodeEvent = (nodeId: number, s: number) => {
    if (endpointNodes.has(nodeId)) return;
    if (events.some((e) => e.kind === 'node' && e.nodeId === nodeId)) return;
    const n = net.getNode(nodeId);
    events.push({ s, x: n.x, z: n.z, kind: 'node', nodeId });
  };

  for (const seg of nearby) {
    if (seg.id === startSeg || seg.id === endSeg) continue;
    const hits = polylineIntersections(poly, seg.poly);
    for (const h of hits) {
      if (h.sA < 3 || h.sA > poly.length - 3) continue;
      // Over- and underpasses: no junction where one of the two is a raised highway high enough.
      if (raised || seg.raised) {
        if (raised && seg.raised) return fail(plan, 'Raised highways can\'t cross each other');
        const clear = raised ? liftAt(h.sA) : raisedLift(net, seg, h.sB);
        if (clear >= OVERPASS_MIN_CROSS) continue;
        return fail(plan, raised ? 'Too low to pass over that road: cross it further from the ramp' : 'Too close to the ramp to pass under the raised highway');
      }
      if (h.sB < MIN_PIECE) {
        addNodeEvent(seg.a, h.sA);
        continue;
      }
      if (h.sB > seg.length - MIN_PIECE) {
        addNodeEvent(seg.b, h.sA);
        continue;
      }
      if (h.angle < MIN_ANGLE) return fail(plan, 'Crossing angle is too shallow');
      if ((seg.elevated || plan.elevated) && terrain.needsDeck(h.x, h.z, 0.4)) return fail(plan, 'Roads can only join a bridge where it meets the ground');
      events.push({ s: h.sA, x: h.x, z: h.z, kind: 'cross', segId: seg.id });
    }
  }
  // Pass-through of existing nodes that lie on the new road.
  const proj: Projection = { s: 0, dist: 0, x: 0, z: 0, side: 1 };
  const seenNodes = new Set<number>();
  for (const seg of nearby) {
    for (const nid of [seg.a, seg.b]) {
      if (seenNodes.has(nid) || endpointNodes.has(nid)) continue;
      seenNodes.add(nid);
      const n = net.getNode(nid);
      projectOnPolyline(poly, n.x, n.z, proj);
      if (proj.dist < 3 && proj.s > 3 && proj.s < poly.length - 3) {
        if (raised && liftAt(proj.s) >= OVERPASS_MIN_CROSS) continue;
        if (raised) return fail(plan, 'Too low to pass over that junction');
        if (nodeRaised(net, nid)) continue;
        addNodeEvent(nid, proj.s);
      }
    }
  }
  events.sort((a, b) => a.s - b.s);
  // Merge crossing events that coincide with node events.
  const merged: PlanEvent[] = [];
  for (const e of events) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.s - e.s) < 2) {
      if (e.kind === 'node') merged[merged.length - 1] = e;
      continue;
    }
    merged.push(e);
  }
  plan.events = merged;

  // Spacing between consecutive junctions along the new road.
  const stops = [0, ...merged.map((e) => e.s), poly.length];
  for (let i = 1; i < stops.length; i++) {
    if (stops[i] - stops[i - 1] < MIN_PIECE) return fail(plan, 'Too close to an existing junction');
  }

  // Connection angles at the endpoints.
  const dirStart = bezierTangent(start.x, start.z, ctrl.x, ctrl.z, end.x, end.z, 0, { x: 0, z: 0 });
  const dirEnd = bezierTangent(start.x, start.z, ctrl.x, ctrl.z, end.x, end.z, 1, { x: 0, z: 0 });
  dirEnd.x = -dirEnd.x;
  dirEnd.z = -dirEnd.z;
  const checkEnd = (snap: Snap, d: P2): string | null => {
    const tmp = { x: 0, z: 0 };
    if (snap.kind === 'node') {
      const n = net.getNode(snap.nodeId!);
      if (n.segs.length >= 6) return 'Too many roads meet at this junction';
      for (const sid of n.segs) {
        net.endDirection(net.getSegment(sid), n.id, tmp);
        if (angleBetween(tmp.x, tmp.z, d.x, d.z) < MIN_ANGLE) return 'Angle with existing road is too sharp';
      }
    } else if (snap.kind === 'segment') {
      const seg = net.getSegment(snap.segId!);
      const pp: PolyPoint = { x: 0, z: 0, tx: 0, tz: 0, i: 0 };
      pointAt(seg.poly, snap.s!, pp);
      const a = angleBetween(pp.tx, pp.tz, d.x, d.z);
      if (a < MIN_ANGLE || a > Math.PI - MIN_ANGLE) return 'Angle with existing road is too sharp';
    }
    return null;
  };
  const e1 = checkEnd(start, dirStart) ?? checkEnd(end, dirEnd);
  if (e1) return fail(plan, e1);
  // Joining an existing bridge in mid-air is not possible.
  for (const snap of [start, end]) {
    if (snap.kind === 'free') continue;
    const touches = snap.kind === 'segment' ? [snap.segId!] : net.getNode(snap.nodeId!).segs;
    if (touches.some((sid) => net.getSegment(sid).elevated) && terrain.needsDeck(snap.x, snap.z, 0.4)) {
      return fail(plan, 'Roads can only join a bridge where it meets the ground');
    }
  }

  // Overlap with parallel roads (not at junction points).
  const eventS = [0, ...merged.map((e) => e.s), poly.length];
  const connected = new Set<number>();
  if (startSeg !== undefined) connected.add(startSeg);
  if (endSeg !== undefined) connected.add(endSeg);
  for (const nid of endpointNodes) for (const sid of net.getNode(nid).segs) connected.add(sid);
  for (const e of merged) {
    if (e.kind === 'node') for (const sid of net.getNode(e.nodeId!).segs) connected.add(sid);
    if (e.segId !== undefined) connected.add(e.segId);
  }
  for (let s = 0; s <= poly.length; s += 3) {
    let nearEvent = Infinity;
    for (const es of eventS) nearEvent = Math.min(nearEvent, Math.abs(es - s));
    pointAt(poly, s, p);
    for (const seg of nearby) {
      projectOnPolyline(seg.poly, p.x, p.z, proj);
      const minSep = (rt.asphaltHalf + ROAD_TYPES[seg.type].asphaltHalf) * 0.95 + 1;
      if (proj.dist >= minSep) continue;
      // One road may run over the other where the raised one is high enough.
      if ((raised || seg.raised) && !(raised && seg.raised) && (raised ? liftAt(s) : raisedLift(net, seg, proj.s)) >= OVERPASS_MIN_CROSS) continue;
      if (connected.has(seg.id)) {
        // Allowed near the shared junction where geometry naturally converges.
        if (nearEvent < minSep * 2.2 + 6) continue;
      }
      return fail(plan, 'Overlaps an existing road');
    }
  }

  return plan;
}

/** Control point of the quadratic Bezier restricted to [t0, t1] (blossoming). */
export function subCurveControl(
  ax: number, az: number, cx: number, cz: number, bx: number, bz: number, t0: number, t1: number,
): P2 {
  const w0 = (1 - t0) * (1 - t1);
  const w1 = (1 - t0) * t1 + t0 * (1 - t1);
  const w2 = t0 * t1;
  return { x: w0 * ax + w1 * cx + w2 * bx, z: w0 * az + w1 * cz + w2 * bz };
}

/** Bezier parameters for each event of the plan (start=0, end=1 included). */
export function planParams(plan: RoadPlan): number[] {
  return [0, ...plan.events.map((e) => tAt(plan.poly, e.s)), 1];
}

export function findSegmentAt(net: RoadNetwork, x: number, z: number, exclude: Set<number>): { seg: RoadSegment; s: number } | null {
  const hit = net.nearestSegment(x, z, 4, (s) => !exclude.has(s.id));
  if (!hit) return null;
  return { seg: hit.seg, s: hit.proj.s };
}
