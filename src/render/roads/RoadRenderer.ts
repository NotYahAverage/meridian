import * as THREE from 'three';
import type { City } from '../../sim/City';
import { CHUNKS, CHUNK_SIZE } from '../../sim/constants';
import { ROAD_TYPES } from '../../sim/roads/RoadTypes';
import { type PropInstance, RoadGeo, type SignalHead, buildNode, buildSegment, buildIsland } from './RoadMeshBuilder';
import { nodeRaised } from '../../sim/roads/Overpass';
import { type RoadUniforms, createRoadMaterial } from './RoadMaterial';

const SEG_TEX = 128;

interface RoadChunk {
  mesh: THREE.Mesh | null;
  segs: Set<number>;
  nodes: Set<number>;
}

function chunkOf(x: number, z: number): number {
  const cx = Math.min(CHUNKS - 1, Math.max(0, Math.floor(x / CHUNK_SIZE)));
  const cz = Math.min(CHUNKS - 1, Math.max(0, Math.floor(z / CHUNK_SIZE)));
  return cz * CHUNKS + cx;
}

export function toBufferGeometry(g: RoadGeo): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
  geo.setAttribute('aRoad', new THREE.Float32BufferAttribute(g.road, 2));
  geo.setAttribute('aSurf', new THREE.Float32BufferAttribute(g.surf, 4));
  geo.setAttribute('aSlot', new THREE.Float32BufferAttribute(g.slot, 1));
  geo.setIndex(g.idx.length > 65535 * 3 || g.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(g.idx, 1) : new THREE.Uint16BufferAttribute(g.idx, 1));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Batches road geometry per chunk. Segment/node "signatures" detect which
 * chunks need rebuilding after edits, so only touched areas are regenerated.
 */
export class RoadRenderer {
  readonly group = new THREE.Group();
  readonly uniforms: RoadUniforms;
  readonly material: THREE.MeshStandardMaterial;
  readonly segData = new Uint8Array(SEG_TEX * SEG_TEX * 4);
  private segTex: THREE.DataTexture;
  private chunks: RoadChunk[] = [];
  private segSig = new Map<number, string>();
  private nodeSig = new Map<number, string>();
  private segChunk = new Map<number, number>();
  private nodeChunk = new Map<number, number>();
  private slots = new Map<number, number>();
  private freeSlots: number[] = [];
  private nextSlot = 0;
  private dirty = new Set<number>();
  private lastVersion = -1;
  private lastLayout = -1;
  /** Props per chunk (consumed by the prop renderer). */
  readonly chunkProps = new Map<number, PropInstance[]>();
  readonly chunkSignals = new Map<number, SignalHead[]>();
  propsVersion = 0;

  constructor(private city: City) {
    this.segTex = new THREE.DataTexture(this.segData, SEG_TEX, SEG_TEX, THREE.RGBAFormat);
    this.segTex.magFilter = THREE.NearestFilter;
    this.segTex.minFilter = THREE.NearestFilter;
    this.segTex.needsUpdate = true;
    this.uniforms = {
      uSegTex: { value: this.segTex },
      uSegTexSize: { value: SEG_TEX },
      uTrafficOverlay: { value: 0 },
      uGhost: { value: 0 },
      uGhostColor: { value: new THREE.Color(0.3, 0.9, 0.8) },
    };
    this.material = createRoadMaterial(this.uniforms);
    for (let i = 0; i < CHUNKS * CHUNKS; i++) this.chunks.push({ mesh: null, segs: new Set(), nodes: new Set() });
  }

  slotOf(segId: number): number {
    let s = this.slots.get(segId);
    if (s === undefined) {
      s = this.freeSlots.length ? this.freeSlots.pop()! : this.nextSlot++;
      if (s >= SEG_TEX * SEG_TEX) s = SEG_TEX * SEG_TEX - 1;
      this.slots.set(segId, s);
    }
    return s;
  }

  private nodeSignature(nodeId: number): string {
    const lay = this.city.layout.get(nodeId);
    if (!lay) return 'none';
    const sig = this.city.signals.states.has(nodeId) ? 'S' : '';
    return `${lay.kind}${sig}|${lay.arms.map((a) => `${a.segId}:${a.trim.toFixed(2)}:${this.city.roads.segments.get(a.segId)?.type}`).join(',')}`;
  }

  /** Detects changed segments/nodes and marks their chunks dirty. */
  sync(): void {
    const net = this.city.roads;
    if (net.version === this.lastVersion && this.city.layout.version === this.lastLayout) return;
    this.lastVersion = net.version;
    this.lastLayout = this.city.layout.version;
    const seenNodes = new Set<number>();
    for (const n of net.nodes.values()) {
      seenNodes.add(n.id);
      const sig = this.nodeSignature(n.id);
      const ch = chunkOf(n.x, n.z);
      if (this.nodeSig.get(n.id) !== sig || this.nodeChunk.get(n.id) !== ch) {
        const old = this.nodeChunk.get(n.id);
        if (old !== undefined) {
          this.chunks[old].nodes.delete(n.id);
          this.dirty.add(old);
        }
        this.nodeSig.set(n.id, sig);
        this.nodeChunk.set(n.id, ch);
        this.chunks[ch].nodes.add(n.id);
        this.dirty.add(ch);
      }
    }
    for (const [id, ch] of this.nodeChunk) {
      if (seenNodes.has(id)) continue;
      this.chunks[ch].nodes.delete(id);
      this.nodeChunk.delete(id);
      this.nodeSig.delete(id);
      this.dirty.add(ch);
    }
    const seenSegs = new Set<number>();
    for (const s of net.segments.values()) {
      seenSegs.add(s.id);
      const mid = Math.floor(s.poly.count / 2) * 2;
      const ch = chunkOf(s.poly.pts[mid], s.poly.pts[mid + 1]);
      const sig = `${s.type}|${s.oneway}|${s.elevated ? 1 : 0}|${s.raised ? `R${nodeRaised(this.city.roads, s.a) ? 1 : 0}${nodeRaised(this.city.roads, s.b) ? 1 : 0}` : ''}|${s.trimA.toFixed(2)}|${s.trimB.toFixed(2)}|${this.nodeSig.get(s.a)}|${this.nodeSig.get(s.b)}`;
      if (this.segSig.get(s.id) !== sig || this.segChunk.get(s.id) !== ch) {
        const old = this.segChunk.get(s.id);
        if (old !== undefined) {
          this.chunks[old].segs.delete(s.id);
          this.dirty.add(old);
        }
        this.segSig.set(s.id, sig);
        this.segChunk.set(s.id, ch);
        this.chunks[ch].segs.add(s.id);
        this.dirty.add(ch);
      }
    }
    for (const [id, ch] of this.segChunk) {
      if (seenSegs.has(id)) continue;
      this.chunks[ch].segs.delete(id);
      this.segChunk.delete(id);
      this.segSig.delete(id);
      const slot = this.slots.get(id);
      if (slot !== undefined) {
        this.slots.delete(id);
        this.freeSlots.push(slot);
        this.segData[slot * 4 + 1] = 0;
      }
      this.dirty.add(ch);
    }
  }

  /** Rebuilds up to `budget` dirty chunks. */
  rebuild(budget = 6): void {
    let n = 0;
    for (const ch of this.dirty) {
      if (n++ >= budget) break;
      this.dirty.delete(ch);
      this.rebuildChunk(ch);
    }
  }

  get pending(): number {
    return this.dirty.size;
  }

  private rebuildChunk(index: number): void {
    const c = this.chunks[index];
    const city = this.city;
    const g = new RoadGeo();
    for (const sid of c.segs) {
      const seg = city.roads.segments.get(sid);
      if (seg) buildSegment(g, seg, city.roads, city.layout, city.terrain, this.slotOf(sid));
    }
    for (const nid of c.nodes) {
      if (city.roads.nodes.has(nid)) buildNode(g, nid, city.roads, city.layout, city.terrain, city.signals.states.has(nid));
    }
    for (const rb of city.roads.roundabouts.values()) {
      if (chunkOf(rb.x, rb.z) === index) buildIsland(g, rb.x, rb.z, rb.r, rb.r >= 30 ? 'avenue' : 'street', city.terrain);
    }
    if (c.mesh) {
      this.group.remove(c.mesh);
      c.mesh.geometry.dispose();
      c.mesh = null;
    }
    if (g.vertexCount > 0) {
      const mesh = new THREE.Mesh(toBufferGeometry(g), this.material);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = false;
      c.mesh = mesh;
      this.group.add(mesh);
    }
    this.chunkProps.set(index, g.props);
    this.chunkSignals.set(index, g.signals);
    this.propsVersion++;
    this.segTex.needsUpdate = true;
  }

  /** Writes traffic congestion into the per-segment texture (overlay + vehicles). */
  updateTraffic(): void {
    const t = this.city.traffic;
    for (const [segId, slot] of this.slots) {
      const r = t.ratio(segId);
      this.segData[slot * 4] = Math.min(255, Math.round((r / 2) * 255));
    }
    this.segTex.needsUpdate = true;
  }

  setHighlight(segIds: Iterable<number>, code: number): void {
    for (const id of segIds) {
      const s = this.slots.get(id);
      if (s !== undefined) this.segData[s * 4 + 1] = code;
    }
    this.segTex.needsUpdate = true;
  }

  clearHighlights(): void {
    for (let i = 1; i < this.segData.length; i += 4) this.segData[i] = 0;
    this.segTex.needsUpdate = true;
  }

  /** Approximate surface height and width info for picking. */
  static halfWidth(type: keyof typeof ROAD_TYPES): number {
    return ROAD_TYPES[type].halfWidth;
  }

  allSignals(): SignalHead[] {
    const out: SignalHead[] = [];
    for (const list of this.chunkSignals.values()) out.push(...list);
    return out;
  }

  dispose(): void {
    for (const c of this.chunks) c.mesh?.geometry.dispose();
    this.material.dispose();
    this.segTex.dispose();
  }
}
