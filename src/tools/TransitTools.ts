import type * as THREE from 'three';
import { formatInt, formatMoney } from '../core/math';
import { type StopPreview, createLine, createMetroLine, placeStop, previewMetroLine, previewStop } from '../sim/CityCommands';
import { METRO_UNLOCK } from '../sim/transit/Metro';
import { BUS } from '../sim/transit/Transit';
import type { Route } from '../sim/traffic/Pathfinder';
import { type CursorLabel, type PointerInfo, Tool } from './Tool';

/** Places bus stops on the curb of the nearest road. */
export class BusStopTool extends Tool {
  readonly id = 'busStop';
  private preview: StopPreview | null = null;

  activate(): void {
    if (this.game.world) this.game.world.transit.toolActive = true;
  }

  deactivate(): void {
    const w = this.game.world;
    if (!w) return;
    w.transit.toolActive = false;
    w.ghost.setMarkers([]);
    this.preview = null;
  }

  onMove(p: THREE.Vector3 | null): void {
    const city = this.game.city;
    const w = this.game.world;
    if (!city || !w || !p) return;
    this.preview = previewStop(city, p.x, p.z);
    const pts = [...city.transit.stops.values()].map((s) => ({ x: s.x, z: s.z, kind: 1 }));
    if (this.preview.seg) pts.unshift({ x: this.preview.x, z: this.preview.z, kind: 0 });
    w.ghost.setMarkers(pts, this.preview.valid || !this.preview.seg);
  }

  onDown(p: THREE.Vector3 | null, e: PointerInfo): void {
    const city = this.game.city;
    if (!city || !p) return;
    const res = placeStop(city, p.x, p.z);
    if (!res.ok) {
      this.game.toastError(res.error ?? 'Cannot place a stop here');
      return;
    }
    this.game.audio.play('build');
    this.game.flashMoney(-(res.cost ?? 0));
    this.onMove(p);
    void e;
  }

  label(): CursorLabel | null {
    const pv = this.preview;
    return {
      title: 'Bus Stop',
      lines: [`Cost ${formatMoney(BUS.stopCost)}`, 'Then connect stops with the Bus Line tool'],
      error: pv && !pv.valid ? pv.error : undefined,
      good: pv?.valid,
    };
  }
}

/** Builds a bus line by clicking stops in order; click the first stop (or Enter) to finish. */
export class BusLineTool extends Tool {
  readonly id = 'busLine';
  private stops: number[] = [];
  private hoverStop: number | null = null;
  private error = '';

  activate(): void {
    this.stops = [];
    this.error = '';
    if (this.game.world) this.game.world.transit.toolActive = true;
    this.refresh();
  }

  deactivate(): void {
    const w = this.game.world;
    this.stops = [];
    if (!w) return;
    w.transit.toolActive = false;
    w.transit.setPreview(null);
    w.ghost.setMarkers([]);
  }

  private routes(extra: number | null): { routes: Route[]; ok: boolean } {
    const city = this.game.city!;
    const ids = extra !== null && extra !== this.stops[this.stops.length - 1] ? [...this.stops, extra] : [...this.stops];
    const routes: Route[] = [];
    let ok = true;
    for (let k = 0; k + 1 < ids.length; k++) {
      const a = city.transit.stops.get(ids[k]);
      const b = city.transit.stops.get(ids[k + 1]);
      if (!a || !b) continue;
      const r = city.paths.find(city.transit.routePoint(a), city.transit.routePoint(b));
      if (r) routes.push(r);
      else ok = false;
    }
    return { routes, ok };
  }

  private refresh(): void {
    const city = this.game.city;
    const w = this.game.world;
    if (!city || !w) return;
    const { routes, ok } = this.routes(this.hoverStop);
    this.error = ok ? '' : 'These stops are not connected by road';
    w.transit.setPreview(routes, ok);
    const chosen = new Set(this.stops);
    w.ghost.setMarkers(
      [...city.transit.stops.values()].map((s) => ({ x: s.x, z: s.z, kind: chosen.has(s.id) ? 2 : s.id === this.hoverStop ? 0 : 1 })),
      true,
    );
  }

  onMove(p: THREE.Vector3 | null): void {
    const city = this.game.city;
    if (!city || !p) return;
    const st = city.transit.stopNear(p.x, p.z, 16);
    const id = st ? st.id : null;
    if (id === this.hoverStop) return;
    this.hoverStop = id;
    this.refresh();
  }

  onDown(p: THREE.Vector3 | null): void {
    const city = this.game.city;
    if (!city || !p) return;
    const st = city.transit.stopNear(p.x, p.z, 16);
    if (!st) {
      this.game.toastError(city.transit.stops.size ? 'Click a bus stop' : 'Place bus stops first');
      return;
    }
    if (this.stops.length >= 2 && st.id === this.stops[0]) {
      this.finish();
      return;
    }
    if (this.stops.includes(st.id)) {
      this.game.toastError('This stop is already on the line');
      return;
    }
    this.stops.push(st.id);
    this.game.audio.play('click');
    this.refresh();
  }

  private finish(): void {
    const city = this.game.city;
    if (!city) return;
    if (this.error) {
      this.game.toastError(this.error);
      return;
    }
    const res = createLine(city, this.stops);
    if (!res.ok || !res.line) {
      this.game.toastError(res.error ?? 'Cannot create the line');
      return;
    }
    this.game.audio.play('build');
    this.game.flashMoney(-(res.cost ?? 0));
    city.transit.refreshRoutes(true);
    const l = res.line;
    this.game.ui.toast({
      severity: l.problem ? 'warning' : 'good',
      icon: 'traffic',
      title: `${l.name} created`,
      text: l.problem === 'depot' ? 'Build a Bus Depot so buses can start running.' : `${l.stops.length} stops, ${l.buses} buses. Manage it in the Transit panel.`,
    });
    this.stops = [];
    this.refresh();
    this.game.ui.openPanel('transit');
  }

  onKey(code: string): boolean {
    if (this.game.keys.matches('lineFinish', code)) {
      if (this.stops.length >= 2) this.finish();
      return true;
    }
    if (this.game.keys.matches('lineUndo', code)) {
      this.stops.pop();
      this.refresh();
      return true;
    }
    return false;
  }

  onCancel(): boolean {
    if (this.stops.length) {
      this.stops.pop();
      this.refresh();
      return true;
    }
    return false;
  }

  label(): CursorLabel | null {
    const n = this.stops.length;
    const lines = n === 0
      ? ['Click the stops in order', `New line ${formatMoney(BUS.lineCost)}`]
      : [`${n} stop${n > 1 ? 's' : ''} · click the first stop or press Enter to finish`, 'Right-click removes the last stop'];
    return { title: 'Bus Line', lines, error: this.error || undefined, good: !this.error && n >= 2 };
  }
}

/** Builds a metro line by clicking stations in order; click the first station (or Enter) to finish. */
export class MetroLineTool extends Tool {
  readonly id = 'metroLine';
  private stations: number[] = [];
  private hoverStation: number | null = null;
  private preview = { cost: 0, tunnel: 0, error: '' };

  activate(): void {
    this.stations = [];
    if (this.game.world) this.game.world.transit.toolActive = true;
    this.refresh();
  }

  deactivate(): void {
    const w = this.game.world;
    this.stations = [];
    if (!w) return;
    w.transit.toolActive = false;
    w.transit.setMetroPreview(null);
    w.ghost.setMarkers([]);
  }

  private refresh(): void {
    const city = this.game.city;
    const w = this.game.world;
    if (!city || !w) return;
    const m = city.transit.metro;
    const ids = this.hoverStation !== null && !this.stations.includes(this.hoverStation) ? [...this.stations, this.hoverStation] : [...this.stations];
    const closing = this.hoverStation !== null && this.stations.length >= 2 && this.hoverStation === this.stations[0];
    this.preview = ids.length >= 2 ? previewMetroLine(city, ids, closing) : { cost: m.costOf(ids, false), tunnel: 0, error: city.peakPopulation < METRO_UNLOCK ? `Metro unlocks at ${formatInt(METRO_UNLOCK)} residents` : '' };
    const pts = ids.map((id) => m.station(id)).filter((b) => !!b).map((b) => ({ x: b!.cx, z: b!.cz }));
    if (closing && pts.length) pts.push(pts[0]);
    w.transit.setMetroPreview(pts.length >= 2 ? pts : null, !this.preview.error);
    const chosen = new Set(this.stations);
    w.ghost.setMarkers(m.stations().map((b) => ({ x: b.cx, z: b.cz, kind: chosen.has(b.id) ? 2 : b.id === this.hoverStation ? 0 : 1 })), true);
  }

  private pick(p: THREE.Vector3, e: PointerInfo | null): number | null {
    const city = this.game.city!;
    const w = this.game.world;
    if (w && e) {
      const b = w.pickBuilding(e.ndc, this.game.renderer.camera, p);
      if (b !== null && city.transit.metro.station(b)) return b;
    }
    return city.transit.metro.stationNear(p.x, p.z, 30)?.id ?? null;
  }

  onMove(p: THREE.Vector3 | null, e: PointerInfo): void {
    if (!this.game.city || !p) return;
    const id = this.pick(p, e);
    if (id === this.hoverStation) return;
    this.hoverStation = id;
    this.refresh();
  }

  onDown(p: THREE.Vector3 | null, e: PointerInfo): void {
    const city = this.game.city;
    if (!city || !p) return;
    const id = this.pick(p, e);
    if (id === null) {
      this.game.toastError(city.transit.metro.stations().length ? 'Click a metro station' : 'Build metro stations first');
      return;
    }
    if (this.stations.length >= 2 && id === this.stations[0]) {
      this.finish();
      return;
    }
    if (this.stations.includes(id)) {
      this.game.toastError('This station is already on the line');
      return;
    }
    if (this.stations.length) {
      const err = city.transit.metro.checkHop(this.stations[this.stations.length - 1], id);
      if (err) {
        this.game.toastError(err);
        return;
      }
    }
    this.stations.push(id);
    this.game.audio.play('click');
    this.refresh();
  }

  private finish(): void {
    const city = this.game.city;
    if (!city) return;
    const res = createMetroLine(city, this.stations);
    if (!res.ok || !res.line) {
      this.game.toastError(res.error ?? 'Cannot create the line');
      return;
    }
    this.game.audio.play('build');
    this.game.flashMoney(-(res.cost ?? 0));
    const l = res.line;
    this.game.ui.toast({
      severity: l.problem ? 'warning' : 'good',
      icon: 'metro',
      title: `${l.name} opened`,
      text: l.problem === 'building' ? 'Trains start once every station is finished.' : `${l.stations.length} stations, ${l.trains} trains. Manage it in the Transit panel.`,
    });
    this.stations = [];
    this.refresh();
    this.game.ui.openPanel('transit');
  }

  onKey(code: string): boolean {
    if (this.game.keys.matches('lineFinish', code)) {
      if (this.stations.length >= 2) this.finish();
      return true;
    }
    if (this.game.keys.matches('lineUndo', code)) {
      this.stations.pop();
      this.refresh();
      return true;
    }
    return false;
  }

  onCancel(): boolean {
    if (this.stations.length) {
      this.stations.pop();
      this.refresh();
      return true;
    }
    return false;
  }

  label(): CursorLabel | null {
    const n = this.stations.length;
    const pv = this.preview;
    const lines = n === 0
      ? ['Click metro stations in the order trains visit them']
      : [`${n} station${n > 1 ? 's' : ''} · click the first station or press Enter to finish`, 'Right-click removes the last station'];
    if (n > 0 || this.hoverStation !== null) lines.push(`${pv.tunnel > 0 ? `New tunnel ${(pv.tunnel / 1000).toFixed(2)} km · ` : ''}Cost ${formatMoney(pv.cost)}`);
    return { title: 'Metro Line', lines, error: pv.error || undefined, good: !pv.error && n >= 2 };
  }
}
