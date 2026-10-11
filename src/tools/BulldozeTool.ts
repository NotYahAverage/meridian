import type * as THREE from 'three';
import { formatMoney } from '../core/math';
import { buildingsCutOffBy, bulldozeBuilding, bulldozeRoad, removeStop, roadRefund } from '../sim/CityCommands';
import { SERVICE_BY_ID } from '../sim/services/ServiceTypes';
import { BuildingState } from '../sim/types';
import { ARCHETYPE_BY_ID } from '../sim/buildings/Archetypes';
import { type CursorLabel, type PointerInfo, Tool } from './Tool';

/** Removes roads and buildings; hovering previews exactly what will go. */
export class BulldozeTool extends Tool {
  readonly id = 'bulldoze';
  private target: { kind: 'building' | 'road' | 'stop'; id: number } | null = null;
  private affected: number[] = [];
  private dragging = false;

  activate(): void {
    this.game.canvas.style.cursor = 'crosshair';
  }

  deactivate(): void {
    this.clear();
    this.game.canvas.style.cursor = 'default';
  }

  private clear(): void {
    const w = this.game.world;
    if (!w) return;
    w.buildings.clearHighlights(3);
    w.buildings.clearHighlights(4);
    w.roads.clearHighlights();
    w.ghost.setMarkers([]);
    this.target = null;
    this.affected = [];
    this.game.reapplySelection();
  }

  onMove(p: THREE.Vector3 | null, e: PointerInfo): void {
    const w = this.game.world;
    const city = this.game.city;
    if (!w || !city) return;
    const stop = p ? city.transit.stopNear(p.x, p.z, 5) : null;
    const b = stop ? null : w.pickBuilding(e.ndc, this.game.renderer.camera, p);
    const r = !stop && b === null && p ? w.pickSegment(p) : null;
    const next = stop ? { kind: 'stop' as const, id: stop.id } : b !== null ? { kind: 'building' as const, id: b } : r !== null ? { kind: 'road' as const, id: r } : null;
    if (next?.kind !== this.target?.kind || next?.id !== this.target?.id) {
      this.clear();
      this.target = next;
      if (next?.kind === 'building') w.buildings.setHighlight([next.id], 3);
      if (next?.kind === 'stop') {
        const st = city.transit.stops.get(next.id);
        if (st) w.ghost.setMarkers([{ x: st.x, z: st.z, kind: 0 }], false);
      } else w.ghost.setMarkers([]);
      if (next?.kind === 'road') {
        w.roads.setHighlight([next.id], 3);
        this.affected = buildingsCutOffBy(city, next.id).map((x) => x.id);
        w.buildings.setHighlight(this.affected, 4);
      }
    }
    if (this.dragging && e.down) this.apply();
  }

  private apply(): void {
    const city = this.game.city;
    if (!city || !this.target) return;
    const t = this.target;
    const res = t.kind === 'building' ? bulldozeBuilding(city, t.id) : t.kind === 'stop' ? removeStop(city, t.id) : bulldozeRoad(city, t.id);
    const hadEntry = t.kind === 'road' && !city.looseEntry();
    if (res.ok) {
      this.game.audio.play('bulldoze');
      if (res.cost) this.game.flashMoney(-res.cost);
      // Demolishing the road at the map edge cuts the city off; say how to undo it.
      const entry = hadEntry ? city.looseEntry() : null;
      if (entry) {
        this.game.ui.toast({ severity: 'warning', icon: 'road', title: 'Highway connection cut', text: 'No one can reach the city. Draw any road back to the highway entry at the map edge (click to go there).', x: entry.x, z: entry.z });
      }
    }
    this.clear();
  }

  onDown(p: THREE.Vector3 | null, e: PointerInfo): void {
    this.dragging = true;
    this.onMove(p, e);
    this.apply();
  }

  onUp(): void {
    this.dragging = false;
  }

  label(): CursorLabel | null {
    const city = this.game.city;
    if (!city) return null;
    if (!this.target) return { title: 'Bulldoze', lines: ['Click or drag over roads and buildings'] };
    if (this.target.kind === 'stop') {
      const n = city.transit.linesAt(this.target.id).length;
      return { title: 'Remove bus stop', lines: [n ? `Served by ${n} line${n > 1 ? 's' : ''}` : 'Not on any line'] };
    }
    if (this.target.kind === 'road') {
      const seg = city.roads.segments.get(this.target.id);
      if (!seg) return null;
      const lines = [`Refund ${formatMoney(roadRefund(city, seg))}`];
      if (this.affected.length) lines.push(`${this.affected.length} building${this.affected.length > 1 ? 's' : ''} lose road access`);
      return { title: `Remove ${seg.name || 'road'}`, lines, error: seg.type === 'highway' && city.roads.getNode(seg.a).outside ? 'This disconnects the highway!' : undefined };
    }
    const b = city.buildings.get(this.target.id);
    if (!b) return null;
    if (b.kind === 'service') {
      const st = SERVICE_BY_ID.get(b.typeId)!;
      const refund = Math.round(st.cost * (b.state === BuildingState.Construction ? 0.9 : 0.25));
      return { title: `Demolish ${st.name}`, lines: [`Refund ${formatMoney(refund)}`] };
    }
    const arch = ARCHETYPE_BY_ID.get(b.typeId);
    const who = b.residents ? `${b.residents} residents will leave` : b.workers ? `${b.workers} jobs will be lost` : 'Empty building';
    return { title: `Demolish ${arch ? humanize(arch.id) : 'building'}`, lines: [who] };
  }
}

export function humanize(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
