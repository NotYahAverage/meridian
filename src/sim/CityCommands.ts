import { type OBB, type PolyPoint, obbBounds, obbIntersects, pointAt } from '../core/geom2d';
import { dredgeBerth } from './world/Terraform';
import { formatInt } from '../core/math';
import type { City } from './City';
import { type Building, lotOBB, newBuilding } from './buildings/Buildings';
import { type LotFrame, lotFrame } from './buildings/Spawner';
import { TRANSIT_UNLOCK, roadUnlocked, ZONE_UNLOCK } from './progress/Progress';
import type { RoadNode, RoadSegment } from './roads/RoadNetwork';
import { type RoadPlan, type Snap, planParams, planRoad, snapPoint, subCurveControl } from './roads/RoadPlanner';
import { isFreeway, ROAD_TYPES, type RoadTypeId, canBeOneWay } from './roads/RoadTypes';
import { SERVICE_BY_ID, type ServiceType } from './services/ServiceTypes';
import { BUS, type BusStop, type TransitLine } from './transit/Transit';
import { METRO_UNLOCK, type MetroLine } from './transit/Metro';
import { BuildingState, Zone } from './types';
import { MAX_ACTIVE_TRIALS, type ProtoSpec, protoSpec } from './design/Trials';
import { WATER_LEVEL } from './constants';
import { TreeKind } from './world/Nature';

export { TRANSIT_UNLOCK } from './progress/Progress';

export interface CommandResult {
  ok: boolean;
  error?: string;
  cost?: number;
}

function err(error: string): CommandResult {
  return { ok: false, error };
}

// ── Roads ───────────────────────────────────────────────────────────────────

export function previewRoad(city: City, type: RoadTypeId, start: Snap, end: Snap, ctrl: { x: number; z: number } | null, raised = false): RoadPlan {
  const plan = planRoad(city.roads, city.terrain, type, start, end, ctrl, raised);
  if (plan.valid && !roadUnlocked(type, city.peakPopulation)) {
    plan.valid = false;
    plan.error = `Unlocks at ${formatInt(ROAD_TYPES[type].unlockPopulation)} population`;
  }
  if (plan.valid && !city.economy.canAfford(plan.cost)) {
    plan.valid = false;
    plan.error = 'Not enough money';
  }
  return plan;
}

export function snap(city: City, x: number, z: number, type: RoadTypeId, enabled = true): Snap {
  return snapPoint(city.roads, x, z, type, enabled);
}

/** Resolves a snapped endpoint to a node, splitting segments as needed. */
function resolveSnap(city: City, s: Snap): RoadNode {
  const net = city.roads;
  if (s.kind === 'node' && s.nodeId !== undefined && net.nodes.has(s.nodeId)) return net.getNode(s.nodeId);
  if (s.kind === 'segment' || s.kind === 'node') {
    const hit = net.nearestSegment(s.x, s.z, 3);
    if (hit) {
      if (hit.proj.s < 1) return net.getNode(hit.seg.a);
      if (hit.proj.s > hit.seg.length - 1) return net.getNode(hit.seg.b);
      return net.splitSegment(hit.seg.id, hit.proj.s).node;
    }
  }
  const existing = net.nearestNode(s.x, s.z, 0.5);
  if (existing) return existing;
  return net.addNode(s.x, s.z);
}

function inheritName(city: City, node: RoadNode, dir: { x: number; z: number }, type: RoadTypeId): string | null {
  const tmp = { x: 0, z: 0 };
  for (const sid of node.segs) {
    const seg = city.roads.getSegment(sid);
    if (seg.type !== type) continue;
    city.roads.endDirection(seg, node.id, tmp);
    // Continuation: existing road leaves the node opposite to the new one.
    if (tmp.x * dir.x + tmp.z * dir.z < -0.8) return seg.name;
  }
  return null;
}

export function buildRoad(city: City, plan: RoadPlan): CommandResult & { segIds?: number[] } {
  if (!plan.valid) return err(plan.error ?? 'Invalid road');
  if (!roadUnlocked(plan.type, city.peakPopulation)) return err('Road type is locked');
  if (!city.economy.spend(plan.cost)) return err('Not enough money');
  const net = city.roads;
  const ts = planParams(plan);
  const startNode = resolveSnap(city, plan.start);
  const mids: RoadNode[] = [];
  for (const e of plan.events) {
    if (e.kind === 'node' && e.nodeId !== undefined && net.nodes.has(e.nodeId)) mids.push(net.getNode(e.nodeId));
    else mids.push(resolveSnap(city, { kind: 'segment', x: e.x, z: e.z }));
  }
  const endNode = resolveSnap(city, plan.end);
  const nodes = [startNode, ...mids, endNode];

  const sx = plan.start.x, sz = plan.start.z, cx = plan.ctrl.x, cz = plan.ctrl.z, ex = plan.end.x, ez = plan.end.z;
  const p: PolyPoint = { x: 0, z: 0, tx: 0, tz: 0, i: 0 };
  pointAt(plan.poly, 0, p);
  let name = inheritName(city, startNode, { x: p.tx, z: p.tz }, plan.type);
  if (!name) {
    pointAt(plan.poly, plan.poly.length, p);
    name = inheritName(city, endNode, { x: -p.tx, z: -p.tz }, plan.type);
  }
  if (!name) name = city.namer.next(plan.type);

  const segIds: number[] = [];
  for (let k = 0; k < nodes.length - 1; k++) {
    if (nodes[k].id === nodes[k + 1].id) continue;
    const ctrl = plan.curved ? subCurveControl(sx, sz, cx, cz, ex, ez, ts[k], ts[k + 1]) : undefined;
    const oneway = plan.oneway && canBeOneWay(plan.type) ? 1 : 0;
    const seg = net.addSegment(nodes[k].id, nodes[k + 1].id, plan.type, { ctrl, name, builtTick: city.clock.tick, elevated: plan.elevated, oneway, raised: !!plan.raised });
    segIds.push(seg.id);
  }
  city.processRoadChanges();
  city.events.emit('built', { x: (sx + ex) / 2, z: (sz + ez) / 2, kind: 'road' });
  return { ok: true, cost: plan.cost, segIds };
}

/** Refund given when bulldozing a road (generous if built very recently). */
export function roadRefund(city: City, seg: RoadSegment): number {
  const cost = seg.length * ROAD_TYPES[seg.type].costPerMeter;
  const recent = city.clock.tick - seg.builtTick < 48;
  return Math.round(cost * (recent ? 0.9 : 0.2));
}

/** Buildings that would lose road access if the segment were removed. */
export function buildingsCutOffBy(city: City, segId: number): Building[] {
  const out: Building[] = [];
  for (const b of city.buildings.onSegment(segId)) {
    const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
    const fx = b.cx + sa * b.hd;
    const fz = b.cz - ca * b.hd;
    const zonedOnly = b.kind === 'zoned';
    const hit = city.roads.nearestSegment(fx, fz, 30, (s) => s.id !== segId && (!zonedOnly || ROAD_TYPES[s.type].zoning));
    if (!hit || hit.proj.dist > ROAD_TYPES[hit.seg.type].halfWidth + 6) out.push(b);
  }
  return out;
}

export function bulldozeRoad(city: City, segId: number): CommandResult {
  const seg = city.roads.segments.get(segId);
  if (!seg) return err('Road not found');
  const refund = roadRefund(city, seg);
  const mid = { x: seg.poly.pts[Math.floor(seg.poly.count / 2) * 2], z: seg.poly.pts[Math.floor(seg.poly.count / 2) * 2 + 1] };
  city.roads.removeSegment(segId);
  city.processRoadChanges();
  city.economy.refund(refund);
  city.events.emit('demolished', { x: mid.x, z: mid.z, kind: 'road' });
  return { ok: true, cost: -refund };
}

/** "Maple Street" upgraded to an avenue becomes "Maple Avenue". */
export function renameForType(name: string, type: RoadTypeId, fresh: () => string): string {
  const parts = name.split(' ');
  if (isFreeway(type) || parts.length < 2 || name.startsWith('Route') || name.startsWith('Interstate') || name.includes('Expressway')) return fresh();
  const root = parts.slice(0, -1).join(' ');
  const suffix = type === 'avenue' ? 'Avenue' : type === 'boulevard' ? 'Boulevard' : type === 'lane' ? 'Lane' : type === 'parkway' ? 'Parkway' : 'Street';
  return `${root} ${suffix}`;
}

export function upgradeCost(seg: RoadSegment, type: RoadTypeId): number {
  const diff = ROAD_TYPES[type].costPerMeter - ROAD_TYPES[seg.type].costPerMeter;
  return Math.max(0, Math.round(seg.length * diff * 1.1));
}

export function upgradeRoad(city: City, segId: number, type: RoadTypeId): CommandResult {
  const raisedSeg = city.roads.segments.get(segId);
  if (raisedSeg?.raised && !isFreeway(type)) return err('Raised highways stay highways');
  const seg = city.roads.segments.get(segId);
  if (!seg) return err('Road not found');
  if (seg.type === type) return err('Already this road type');
  if (!roadUnlocked(type, city.peakPopulation)) return err(`Unlocks at ${formatInt(ROAD_TYPES[type].unlockPopulation)} population`);
  const cost = upgradeCost(seg, type);
  if (!city.economy.spend(cost)) return err('Not enough money');
  city.roads.retypeSegment(segId, type);
  seg.name = renameForType(seg.name, type, () => city.namer.next(type));
  city.processRoadChanges();
  city.events.emit('built', { x: (seg.minX + seg.maxX) / 2, z: (seg.minZ + seg.maxZ) / 2, kind: 'road' });
  return { ok: true, cost };
}

/** Bike lanes: building cost and monthly upkeep per metre of road (both sides), painted and protected. */
export const BIKE_LANE = {
  name: ['No bike lanes', 'Painted bike lanes', 'Protected bike lanes'],
  costPerMeter: [0, 14, 48],
  upkeepPerMeter: [0, 0.04, 0.1],
} as const;

/** Whether a road can have bike lanes (it needs kerbs and sidewalks; not on highways or roundabouts). */
export function canHaveBikeLane(seg: RoadSegment): boolean {
  const rt = ROAD_TYPES[seg.type];
  return rt.sidewalk > 0 && !rt.freeway && !seg.ring;
}

export function bikeLaneCost(seg: RoadSegment, kind: 0 | 1 | 2): number {
  return Math.round(seg.length * BIKE_LANE.costPerMeter[kind]);
}

/** Adds (or changes, or removes) bike lanes on a road. */
export function setBikeLane(city: City, segId: number, kind: 0 | 1 | 2): CommandResult {
  const seg = city.roads.segments.get(segId);
  if (!seg) return err('Road not found');
  if (!canHaveBikeLane(seg)) return err(seg.ring ? 'Not on a roundabout' : `${ROAD_TYPES[seg.type].name}s have no room for bike lanes`);
  if (seg.bikeLane === kind) return err(kind ? `Already has ${BIKE_LANE.name[kind].toLowerCase()}` : 'No bike lanes to remove');
  const cost = bikeLaneCost(seg, kind);
  if (!city.economy.spend(cost)) return err('Not enough money');
  city.roads.setBikeLane(segId, kind);
  city.processRoadChanges();
  if (kind) city.events.emit('built', { x: (seg.minX + seg.maxX) / 2, z: (seg.minZ + seg.maxZ) / 2, kind: 'road' });
  return { ok: true, cost };
}

/** Cycles a road between two-way, one-way (a→b) and one-way (b→a). */
export function cycleRoadDirection(city: City, segId: number): CommandResult & { oneway?: 0 | 1 | -1 } {
  const seg = city.roads.segments.get(segId);
  if (!seg) return err('Road not found');
  if (!canBeOneWay(seg.type)) return err(`${ROAD_TYPES[seg.type].name}s are already divided`);
  const next: 0 | 1 | -1 = seg.oneway === 0 ? 1 : seg.oneway === 1 ? -1 : 0;
  const cost = 150;
  if (!city.economy.spend(cost)) return err('Not enough money');
  city.roads.setOneway(segId, next);
  city.processRoadChanges();
  return { ok: true, cost, oneway: next };
}

// ── Zoning ──────────────────────────────────────────────────────────────────

export function zoneUnlocked(city: City, zone: Zone): boolean {
  return city.peakPopulation >= ZONE_UNLOCK[zone];
}

function flagRezoned(city: City, minX: number, minZ: number, maxX: number, maxZ: number): void {
  for (const b of city.buildings.queryRect(minX, minZ, maxX, maxZ)) {
    // Prototypes were placed by hand, not grown from the zone.
    if (b.kind !== 'zoned' || b.typeId === 'proto') continue;
    let mismatch = 0;
    let total = 0;
    for (const i of city.zones.cellsInOBB(lotOBB(b), -1)) {
      total++;
      if (city.zones.zone[i] !== b.zone) mismatch++;
    }
    if (total && mismatch > total * 0.5) {
      if (!b.rezoneDays) b.rezoneDays = 3;
    } else b.rezoneDays = 0;
  }
}

export function paintZone(city: City, x: number, z: number, radius: number, zone: Zone): CommandResult & { changed?: number } {
  if (!zoneUnlocked(city, zone)) return err(`Unlocks at ${formatInt(ZONE_UNLOCK[zone])} population`);
  const changed = city.zones.paintCircle(x, z, radius, zone);
  if (changed) flagRezoned(city, x - radius - 40, z - radius - 40, x + radius + 40, z + radius + 40);
  return { ok: true, changed };
}

/** The street side a "fill" click at (x, z) refers to. */
export function fillTarget(city: City, x: number, z: number): { seg: RoadSegment; side: number } | null {
  const hit = city.roads.nearestSegment(x, z, 60, (s) => ROAD_TYPES[s.type].zoning && !s.elevated);
  if (!hit) return null;
  return { seg: hit.seg, side: hit.proj.side };
}

/** Zones one whole side of the nearest street. */
export function fillZone(city: City, x: number, z: number, zone: Zone): CommandResult & { changed?: number } {
  if (!zoneUnlocked(city, zone)) return err(`Unlocks at ${formatInt(ZONE_UNLOCK[zone])} population`);
  const t = fillTarget(city, x, z);
  if (!t) return err('Click near a street to fill along it');
  const changed = city.zones.fillSide(t.seg, t.side, zone);
  if (changed) flagRezoned(city, t.seg.minX - 60, t.seg.minZ - 60, t.seg.maxX + 60, t.seg.maxZ + 60);
  return { ok: true, changed };
}

// ── Service placement ───────────────────────────────────────────────────────

export interface PlacementPreview {
  valid: boolean;
  error?: string;
  type: ServiceType;
  frame: LotFrame | null;
  /** Zoned buildings that will be replaced. */
  conflicts: Building[];
}

export function previewPlacement(city: City, typeId: string, x: number, z: number, flip = false): PlacementPreview {
  const st = SERVICE_BY_ID.get(typeId);
  if (!st) throw new Error(`Unknown service ${typeId}`);
  const res: PlacementPreview = { valid: false, type: st, frame: null, conflicts: [] };
  const hit = city.roads.nearestSegment(x, z, Math.max(st.w, st.d) + 30, (s) => !isFreeway(s.type) && !s.elevated);
  if (!hit) {
    res.error = 'Must be placed next to a road';
    return res;
  }
  const seg = hit.seg;
  const half = st.w / 2;
  const s = Math.min(Math.max(hit.proj.s, seg.trimA + half + 0.5), seg.length - seg.trimB - half - 0.5);
  const side = flip ? -hit.proj.side : hit.proj.side;
  const f = lotFrame(city.terrain, seg, Number.isFinite(s) ? s : seg.length / 2, side, st.w, st.d, 1);
  res.frame = f;
  if (seg.length - seg.trimA - seg.trimB < st.w * 0.6) {
    res.error = 'Road segment is too short';
    return res;
  }
  if (st.unique && [...city.buildings.all.values()].some((b) => b.typeId === st.id)) {
    res.error = 'Your city already has one';
    return res;
  }
  if (city.peakPopulation < st.unlockPopulation) {
    res.error = `Unlocks at ${formatInt(st.unlockPopulation)} population`;
    return res;
  }
  const o = f.obb;
  const ground = groundProblem(city, o);
  if (ground) {
    res.error = ground;
    return res;
  }
  const ca = Math.cos(o.angle), sa = Math.sin(o.angle);
  if (st.needsShore && city.terrain.shoreDistanceAt(o.cx, o.cz) > Math.max(o.hw, o.hd) + 50) {
    res.error = 'Must be placed on a shoreline';
    return res;
  }
  if (st.id === 'cargo_port') {
    // The back of the lot is the quay: water right behind it (the berth is dredged)
    // and deep water not far beyond.
    const base = (k: number) => city.terrain.sampleBase(o.cx - (o.hd + k) * sa, o.cz + (o.hd + k) * ca);
    if (base(14) > WATER_LEVEL - 0.3) {
      res.error = 'The quay (back of the lot) must face the water';
      return res;
    }
    if (![40, 70, 100, 130].some((k) => base(k) < WATER_LEVEL - 3)) {
      res.error = 'Needs deep water within about 130 m of the quay';
      return res;
    }
  }
  const clash = overlapProblem(city, o, res.conflicts);
  if (clash) {
    res.error = clash;
    return res;
  }
  if (!city.economy.canAfford(st.cost)) {
    res.error = 'Not enough money';
    return res;
  }
  res.valid = true;
  return res;
}

/** Limits, land ownership, water and slope under a lot placed by hand. */
function groundProblem(city: City, o: OBB): string | undefined {
  const [minX, minZ, maxX, maxZ] = obbBounds(o);
  if (!city.terrain.inBounds(minX, minZ, 2) || !city.terrain.inBounds(maxX, maxZ, 2)) return 'Outside the city limits';
  if (!city.land.ownsRect(minX, minZ, maxX, maxZ)) return 'You don\'t own this land yet. Buy it in City Info → Land';
  const ca = Math.cos(o.angle), sa = Math.sin(o.angle);
  let lo = Infinity, hi = -Infinity;
  for (let u = -1; u <= 1.001; u += 0.5) {
    for (let v = -1; v <= 1.001; v += 0.5) {
      const px = o.cx + u * o.hw * ca - v * o.hd * sa;
      const pz = o.cz + u * o.hw * sa + v * o.hd * ca;
      if (city.terrain.isWater(px, pz, 0.3)) return 'Cannot build on water';
      const h = city.terrain.sampleBase(px, pz);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }
  if (hi - lo > 8) return 'Terrain is too steep';
  return undefined;
}

/** Roads and service buildings block a lot; zoned buildings in the way are listed to be replaced. */
function overlapProblem(city: City, o: OBB, conflicts: Building[], replacing = 0): string | undefined {
  if (!city.spawner.clearOfRoads(o, 0.4)) return 'Overlaps a road';
  const [minX, minZ, maxX, maxZ] = obbBounds(o);
  for (const b of city.buildings.queryRect(minX, minZ, maxX, maxZ)) {
    if (b.id === replacing || !obbIntersects(o, lotOBB(b), -0.3)) continue;
    if (b.kind === 'service' || b.typeId === 'proto') return 'Overlaps another building';
    conflicts.push(b);
  }
  return undefined;
}

export function placeService(city: City, typeId: string, x: number, z: number, flip = false): CommandResult & { building?: Building } {
  const pv = previewPlacement(city, typeId, x, z, flip);
  if (!pv.valid || !pv.frame) return err(pv.error ?? 'Cannot place here');
  const st = pv.type;
  const cost = city.research.costOf(st);
  if (!city.economy.spend(cost)) return err('Not enough money');
  for (const c of pv.conflicts) city.removeBuilding(c.id, 'replace');
  const f = pv.frame;
  const b = newBuilding({
    kind: 'service',
    typeId: st.id,
    style: st.style,
    cx: f.obb.cx,
    cz: f.obb.cz,
    angle: f.obb.angle,
    hw: f.obb.hw,
    hd: f.obb.hd,
    y: f.y,
    seed: Math.floor(city.rng.next() * 0x7fffffff),
    floors: st.floors ?? 2,
    level: st.look ? 3 : 1,
    // A signature landmark is drawn in its movement's style.
    movement: st.movementId ?? 0,
    buildDays: st.category === 'parks' ? 1.5 : 2 + Math.min(st.look ? 24 : 8, st.cost / 12_000),
    segId: f.seg.id,
    segS: f.s,
    side: f.side,
    jobs: st.jobs,
  });
  city.addBuilding(b);
  // Its id exists now: the centre takes its identity from the site.
  if (st.kind === 'research') city.research.onCenterPlaced(b);
  if (st.id === 'cargo_port') dredgeBerth(city, b);
  city.coverageDirty = true;
  city.recomputeUtilities();
  city.events.emit('built', { x: b.cx, z: b.cz, kind: 'service' });
  return { ok: true, cost, building: b };
}

// -- Prototypes ----------------------------------------------------------------

export interface PrototypePreview {
  valid: boolean;
  error?: string;
  frame: LotFrame | null;
  conflicts: Building[];
  spec: ProtoSpec;
}

/** Where a design from the sketchbook would go, facing the nearest road (optionally in place of a building). */
export function previewPrototype(city: City, sketchId: string, x: number, z: number, flip = false, replacing = 0): PrototypePreview {
  const sk = city.design.sketches.find((k) => k.id === sketchId);
  if (!sk) throw new Error(`Unknown sketch ${sketchId}`);
  const c = sk.concept;
  const spec = protoSpec(c);
  const res: PrototypePreview = { valid: false, frame: null, conflicts: [], spec };
  const hit = city.roads.nearestSegment(x, z, Math.max(c.w, c.d) + 30, (s) => !isFreeway(s.type) && !s.elevated && !s.ring);
  if (!hit) {
    res.error = 'Must be placed next to a road';
    return res;
  }
  const seg = hit.seg;
  const half = c.w / 2;
  const s = Math.min(Math.max(hit.proj.s, seg.trimA + half + 0.5), seg.length - seg.trimB - half - 0.5);
  const side = flip ? -hit.proj.side : hit.proj.side;
  const f = lotFrame(city.terrain, seg, Number.isFinite(s) ? s : seg.length / 2, side, c.w, c.d, 0.6);
  res.frame = f;
  if (seg.length - seg.trimA - seg.trimB < c.w * 0.6) {
    res.error = 'Road segment is too short';
    return res;
  }
  if (!city.design.canStartTrial()) {
    res.error = `Your architects can test ${MAX_ACTIVE_TRIALS} prototypes at a time`;
    return res;
  }
  if (c.floors > city.spawner.maxFloorsAt(f.obb.cx, f.obb.cz)) {
    res.error = 'The high-rise ban doesn\'t allow a building this tall here';
    return res;
  }
  const problem = groundProblem(city, f.obb) ?? overlapProblem(city, f.obb, res.conflicts, replacing);
  if (problem) {
    res.error = problem;
    return res;
  }
  if (!city.economy.canAfford(spec.cost)) {
    res.error = 'Not enough money';
    return res;
  }
  res.valid = true;
  return res;
}

/** Builds a design from the sketchbook as a prototype; its trial starts when it opens. */
export function placePrototype(city: City, sketchId: string, x: number, z: number, flip = false, replacing = 0): CommandResult & { building?: Building } {
  const pv = previewPrototype(city, sketchId, x, z, flip, replacing);
  if (!pv.valid || !pv.frame) return err(pv.error ?? 'Cannot place here');
  const sk = city.design.sketches.find((k) => k.id === sketchId)!;
  const { spec } = pv;
  if (!city.economy.spend(spec.cost)) return err('Not enough money');
  if (replacing && city.buildings.get(replacing)) city.removeBuilding(replacing, 'replace');
  for (const c of pv.conflicts) city.removeBuilding(c.id, 'replace');
  const f = pv.frame;
  const c = sk.concept;
  const b = newBuilding({
    kind: 'zoned',
    typeId: 'proto',
    style: spec.style,
    zone: spec.zone,
    cx: f.obb.cx,
    cz: f.obb.cz,
    angle: f.obb.angle,
    hw: f.obb.hw,
    hd: f.obb.hd,
    y: f.y,
    seed: Math.floor(city.rng.next() * 0x7fffffff),
    floors: c.floors,
    level: c.level,
    buildDays: spec.buildDays,
    segId: f.seg.id,
    segS: f.s,
    side: f.side,
    hhCap: spec.households,
    jobs: spec.jobs,
    landValue: city.landValue.at(f.obb.cx, f.obb.cz),
  });
  city.addBuilding(b);
  city.design.startTrial(sk, b, spec.cost);
  city.events.emit('built', { x: b.cx, z: b.cz, kind: 'service' });
  return { ok: true, cost: spec.cost, building: b };
}

/** Rebuilds a revised design on the lot of the prototype it revises. */
export function rebuildPrototype(city: City, sketchId: string, trialId: number): CommandResult & { building?: Building } {
  const t = city.design.trial(trialId);
  const old = t ? city.buildings.get(t.buildingId) : undefined;
  if (!t || !old) return err('The earlier prototype is gone: build the new one somewhere else');
  if (t.state === 'building' || t.state === 'testing') return err('Wait for the verdict before rebuilding it');
  // Its frontage point, so the new building faces the same street on the same side.
  const ca = Math.cos(old.angle), sa = Math.sin(old.angle);
  return placePrototype(city, sketchId, old.cx + old.hd * sa * 0.98, old.cz - old.hd * ca * 0.98, false, old.id);
}

export function bulldozeBuilding(city: City, id: number): CommandResult {
  const b = city.buildings.get(id);
  if (!b) return err('Building not found');
  let refund = 0;
  if (b.kind === 'service') {
    const st = SERVICE_BY_ID.get(b.typeId);
    if (st) refund = Math.round(city.research.costOf(st) * (b.state === BuildingState.Construction ? 0.9 : 0.25));
  }
  city.removeBuilding(id, 'bulldoze');
  if (refund) city.economy.refund(refund);
  city.coverageDirty = true;
  return { ok: true, cost: -refund };
}

export function lotOf(b: Building): OBB {
  return lotOBB(b);
}

// ── Public transit ──────────────────────────────────────────────────────────

export interface StopPreview {
  valid: boolean;
  error?: string;
  seg?: RoadSegment;
  s: number;
  side: number;
  x: number;
  z: number;
  /** Road direction at the stop. */
  tx: number;
  tz: number;
}

/** Where a bus stop would go for a cursor position (snapped to the nearest curb). */
export function previewStop(city: City, x: number, z: number): StopPreview {
  const res: StopPreview = { valid: false, s: 0, side: 1, x, z, tx: 1, tz: 0 };
  const hit = city.roads.nearestSegment(x, z, 24, (s) => !isFreeway(s.type) && !s.elevated);
  if (!hit) {
    res.error = 'Place bus stops along a road';
    return res;
  }
  const seg = hit.seg;
  res.seg = seg;
  res.s = hit.proj.s;
  res.side = hit.proj.side >= 0 ? 1 : -1;
  const p = city.transit.stopPoint(seg, res.s, res.side);
  Object.assign(res, { x: p.x, z: p.z, tx: p.tx, tz: p.tz });
  if (city.peakPopulation < TRANSIT_UNLOCK) {
    res.error = `Unlocks at ${formatInt(TRANSIT_UNLOCK)} population`;
    return res;
  }
  const e = city.transit.checkStop(seg, res.s, res.side);
  if (e) {
    res.error = e;
    return res;
  }
  if (!city.economy.canAfford(BUS.stopCost)) {
    res.error = 'Not enough money';
    return res;
  }
  res.valid = true;
  return res;
}

export function placeStop(city: City, x: number, z: number): CommandResult & { stop?: BusStop } {
  const pv = previewStop(city, x, z);
  if (!pv.valid || !pv.seg) return err(pv.error ?? 'Cannot place a stop here');
  if (!city.economy.spend(BUS.stopCost)) return err('Not enough money');
  const stop = city.transit.addStop(pv.seg, pv.s, pv.side);
  city.events.emit('built', { x: stop.x, z: stop.z, kind: 'stop' });
  return { ok: true, cost: BUS.stopCost, stop };
}

export function removeStop(city: City, id: number): CommandResult {
  const st = city.transit.stops.get(id);
  if (!st) return err('Stop not found');
  city.transit.removeStop(id);
  city.economy.refund(Math.round(BUS.stopCost * 0.5));
  city.events.emit('demolished', { x: st.x, z: st.z, kind: 'stop' });
  return { ok: true, cost: -Math.round(BUS.stopCost * 0.5) };
}

export function createLine(city: City, stops: number[], name?: string): CommandResult & { line?: TransitLine } {
  const unique = stops.filter((id, i) => city.transit.stops.has(id) && stops.indexOf(id) === i);
  if (unique.length < 2) return err('A bus line needs at least two stops');
  if (!city.economy.spend(BUS.lineCost)) return err('Not enough money');
  const line = city.transit.addLine(unique, name);
  return { ok: true, cost: BUS.lineCost, line };
}

export function deleteLine(city: City, id: number): CommandResult {
  if (!city.transit.lines.has(id)) return err('Line not found');
  city.transit.removeLine(id);
  return { ok: true };
}

export function setLineBuses(city: City, id: number, buses: number): CommandResult {
  if (!city.transit.lines.has(id)) return err('Line not found');
  city.transit.setBuses(id, buses);
  return { ok: true };
}

// ── Roundabouts ─────────────────────────────────────────────────────────────

export interface RoundaboutPreview {
  valid: boolean;
  error?: string;
  nodeId?: number;
  x: number;
  z: number;
  r: number;
  type: RoadTypeId;
  cost: number;
}

/** Checks whether the junction near (x, z) can become a roundabout. */
export function previewRoundabout(city: City, x: number, z: number): RoundaboutPreview {
  const res: RoundaboutPreview = { valid: false, x, z, r: 0, type: 'street', cost: 0 };
  const node = city.roads.nearestNode(x, z, 16);
  if (!node || node.segs.length < 3) {
    res.error = 'Click an intersection';
    return res;
  }
  res.nodeId = node.id;
  res.x = node.x;
  res.z = node.z;
  const segs = node.segs.map((id) => city.roads.getSegment(id));
  if (node.outside || segs.some((s) => isFreeway(s.type))) {
    res.error = 'Highways need interchanges, not roundabouts';
    return res;
  }
  if (segs.some((s) => s.ring)) {
    res.error = 'This is already a roundabout';
    return res;
  }
  if (segs.some((s) => s.elevated)) {
    res.error = 'Not on a bridge';
    return res;
  }
  const big = segs.some((s) => s.type !== 'street');
  res.type = big ? 'avenue' : 'street';
  res.r = big ? 30 : 21;
  if (segs.some((s) => s.length < res.r + 16)) {
    res.error = 'The roads at this junction are too short';
    return res;
  }
  res.cost = Math.round(2 * Math.PI * res.r * ROAD_TYPES[res.type].costPerMeter * 1.2 + 2000);
  if (!city.economy.canAfford(res.cost)) {
    res.error = 'Not enough money';
    return res;
  }
  res.valid = true;
  return res;
}

/** Replaces a junction with a one-way ring (counter-clockwise: right-hand traffic). */
export function buildRoundabout(city: City, x: number, z: number): CommandResult & { segIds?: number[] } {
  const pv = previewRoundabout(city, x, z);
  if (!pv.valid || pv.nodeId === undefined) return err(pv.error ?? 'Cannot build a roundabout here');
  if (!city.economy.spend(pv.cost)) return err('Not enough money');
  const net = city.roads;
  const center = net.getNode(pv.nodeId);
  const cx = center.x, cz = center.z, R = pv.r;
  const name = net.getSegment(center.segs[0]).name;
  // Cut every arm at the ring and drop the pieces inside it.
  const ring: { id: number; a: number }[] = [];
  for (const sid of [...center.segs]) {
    const seg = net.getSegment(sid);
    const atA = seg.a === center.id;
    const split = net.splitSegment(sid, atA ? R : seg.length - R);
    const inner = atA ? split.first : split.second;
    net.removeSegment(inner.id);
    ring.push({ id: split.node.id, a: Math.atan2(split.node.z - cz, split.node.x - cx) });
  }
  // Circulate in decreasing angle (counter-clockwise seen from above); fill wide gaps.
  ring.sort((p, q) => q.a - p.a);
  const full: { id: number; a: number }[] = [];
  for (let i = 0; i < ring.length; i++) {
    const from = ring[i];
    const to = ring[(i + 1) % ring.length];
    full.push(from);
    let gap = from.a - to.a;
    if (gap <= 0) gap += Math.PI * 2;
    const extra = Math.ceil(gap / (Math.PI * 0.55)) - 1;
    for (let k = 1; k <= extra; k++) {
      const a = from.a - (gap * k) / (extra + 1);
      const n = net.addNode(cx + Math.cos(a) * R, cz + Math.sin(a) * R);
      full.push({ id: n.id, a });
    }
  }
  const segIds: number[] = [];
  for (let i = 0; i < full.length; i++) {
    const from = full[i];
    const to = full[(i + 1) % full.length];
    let gap = from.a - to.a;
    if (gap <= 0) gap += Math.PI * 2;
    const mid = from.a - gap / 2;
    const k = R / Math.cos(gap / 2);
    const seg = net.addSegment(from.id, to.id, pv.type, {
      ctrl: { x: cx + Math.cos(mid) * k, z: cz + Math.sin(mid) * k },
      name: name ? `${name} Circle` : '',
      builtTick: city.clock.tick,
      oneway: 1,
      ring: true,
    });
    segIds.push(seg.id);
  }
  const id = net.nextRoundaboutId++;
  net.roundabouts.set(id, { id, x: cx, z: cz, r: R });
  city.processRoadChanges();
  city.events.emit('built', { x: cx, z: cz, kind: 'road' });
  return { ok: true, cost: pv.cost, segIds };
}

// ── Trees ───────────────────────────────────────────────────────────────────

export const TREE_COST = 25;
export const TREE_CLEAR_COST = 6;

/** Plants up to `count` saplings at random free spots within a disc. */
export function plantTrees(city: City, x: number, z: number, radius: number, count: number): CommandResult & { planted?: number } {
  const t = city.terrain;
  const nat = city.nature;
  const rng = nat.rng;
  let planted = 0;
  for (let attempt = 0; attempt < count * 5 && planted < count; attempt++) {
    if (!city.economy.canAfford(TREE_COST)) {
      if (!planted) return err('Not enough money');
      break;
    }
    const a = rng.next() * Math.PI * 2;
    const r = radius * Math.sqrt(rng.next());
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    if (!t.buildable(px, pz, 8)) continue;
    const h = t.sampleBase(px, pz);
    if (h < WATER_LEVEL + 1.2 || t.slopeAt(px, pz) > 0.6) continue;
    const zi = city.zones.index(px, pz);
    if (zi < 0 || city.zones.roadCover[zi] || city.zones.occupant[zi]) continue;
    const hit = city.roads.nearestSegment(px, pz, 24);
    if (hit && hit.proj.dist < ROAD_TYPES[hit.seg.type].halfWidth + 1.8) continue;
    if (city.transit.stopNear(px, pz, 4)) continue;
    if (nat.nearestTree(px, pz, 4.2) < 4.2) continue;
    const pick = rng.next();
    const kind = h > 32 ? (pick < 0.7 ? TreeKind.Pine : TreeKind.Oak) : pick < 0.45 ? TreeKind.Oak : pick < 0.8 ? TreeKind.Maple : pick < 0.95 ? TreeKind.Pine : TreeKind.Bush;
    const scale = kind === TreeKind.Bush ? rng.range(0.7, 1.1) : rng.range(0.85, 1.3);
    nat.add(px, pz, kind, scale, rng.next() * Math.PI * 2, city.clock.day);
    city.economy.spend(TREE_COST, 'Construction');
    planted++;
  }
  if (!planted) return err('No room for trees here');
  city.achievements.counters.treesPlanted += planted;
  return { ok: true, cost: planted * TREE_COST, planted };
}

/** Removes every tree within a disc. */
export function clearTrees(city: City, x: number, z: number, radius: number): CommandResult & { removed?: number } {
  const n = city.nature.countDisc(x, z, radius);
  if (!n) return err('No trees here');
  const cost = n * TREE_CLEAR_COST;
  if (!city.economy.spend(cost, 'Construction')) return err('Not enough money');
  city.nature.clearDisc(x, z, radius);
  return { ok: true, cost, removed: n };
}

// ── Metro ───────────────────────────────────────────────────────────────────

/** Checks a metro line through these stations (in order, looping back); returns cost and any error. */
export function previewMetroLine(city: City, stations: number[], loop = true): { cost: number; tunnel: number; error: string } {
  const m = city.transit.metro;
  const tunnel = m.newTunnelLength(stations, loop);
  const cost = m.costOf(stations, loop);
  if (city.peakPopulation < METRO_UNLOCK) return { cost, tunnel, error: `Metro unlocks at ${formatInt(METRO_UNLOCK)} residents` };
  const n = stations.length;
  for (let k = 0; k < (loop ? n : n - 1); k++) {
    if (n < 2) break;
    const e = m.checkHop(stations[k], stations[(k + 1) % n]);
    if (e) return { cost, tunnel, error: e };
  }
  return { cost, tunnel, error: '' };
}

export function createMetroLine(city: City, stations: number[], name?: string): CommandResult & { line?: MetroLine } {
  const m = city.transit.metro;
  const unique = stations.filter((id, i) => m.station(id) && stations.indexOf(id) === i);
  if (unique.length < 2) return err('A metro line needs at least two stations');
  const pv = previewMetroLine(city, unique);
  if (pv.error) return err(pv.error);
  if (!city.economy.spend(pv.cost)) return err('Not enough money');
  const line = m.addLine(unique, name);
  return { ok: true, cost: pv.cost, line };
}

export function deleteMetroLine(city: City, id: number): CommandResult {
  if (!city.transit.metro.lines.has(id)) return err('Line not found');
  city.transit.metro.removeLine(id);
  return { ok: true };
}

export function setMetroTrains(city: City, id: number, trains: number): CommandResult {
  if (!city.transit.metro.lines.has(id)) return err('Line not found');
  city.transit.metro.setTrains(id, trains);
  return { ok: true };
}
