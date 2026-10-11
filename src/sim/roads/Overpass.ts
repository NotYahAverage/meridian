import type { RoadNetwork, RoadSegment } from './RoadNetwork';

/** Raised highways run this far above the ground road surface. */
export const OVERPASS_CLEARANCE = 7.5;
/** Ramp grade where a raised highway comes down to the ground. */
export const OVERPASS_GRADE = 0.08;
/** Roads may only cross under a raised highway where it is at least this high. */
export const OVERPASS_MIN_CROSS = 5.6;
/** Raised highway cost per metre, relative to the ground version. */
export const OVERPASS_COST_FACTOR = 3;

/** A node stays up in the air when every road meeting there is raised. */
export function nodeRaised(net: RoadNetwork, nodeId: number): boolean {
  const n = net.nodes.get(nodeId);
  if (!n || n.segs.length < 2) return false;
  for (const sid of n.segs) if (!net.segments.get(sid)?.raised) return false;
  return true;
}

/** Lift above the ground road surface for a raised road with given end states and length. */
export function liftProfile(s: number, length: number, upA: boolean, upB: boolean): number {
  const a = (upA ? OVERPASS_CLEARANCE : 0) + OVERPASS_GRADE * Math.max(0, s);
  const b = (upB ? OVERPASS_CLEARANCE : 0) + OVERPASS_GRADE * Math.max(0, length - s);
  return Math.min(OVERPASS_CLEARANCE, a, b);
}

/** Height of a raised segment above the ground road surface at distance `s` along it (0 if not raised). */
export function raisedLift(net: RoadNetwork, seg: RoadSegment, s: number): number {
  if (!seg.raised) return 0;
  return liftProfile(s, seg.length, nodeRaised(net, seg.a), nodeRaised(net, seg.b));
}

/** Lift at a node (junctions between raised pieces float with them). */
export function nodeLift(net: RoadNetwork, nodeId: number): number {
  return nodeRaised(net, nodeId) ? OVERPASS_CLEARANCE : 0;
}

/** Lift along a road that is about to be built between two snapped ends. */
export function plannedLift(net: RoadNetwork, start: { kind: string; nodeId?: number }, end: { kind: string; nodeId?: number }, length: number): (s: number) => number {
  const up = (e: { kind: string; nodeId?: number }) => {
    if (e.kind !== 'node' || e.nodeId === undefined) return false;
    const n = net.nodes.get(e.nodeId);
    return !!n && n.segs.length > 0 && n.segs.every((sid) => !!net.segments.get(sid)?.raised);
  };
  const a = up(start), b = up(end);
  return (s) => liftProfile(s, length, a, b);
}
