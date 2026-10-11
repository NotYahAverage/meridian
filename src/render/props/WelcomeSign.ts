import * as THREE from 'three';
import { type PolyPoint, pointAt } from '../../core/geom2d';
import { formatInt } from '../../core/math';
import type { City } from '../../sim/City';
import { ROAD_TYPES } from '../../sim/roads/RoadTypes';

/**
 * A green highway sign greeting drivers as they arrive from the outside
 * connection: "Welcome to <city>" with the current population.
 */
export class WelcomeSign {
  readonly group = new THREE.Group();
  private canvas = document.createElement('canvas');
  private texture: THREE.CanvasTexture;
  private key = '';
  private placedFor = -1;

  constructor(private city: City) {
    this.canvas.width = 1024;
    this.canvas.height = 300;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const W = 13, H = 3.8;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: this.texture, roughness: 0.55, emissive: 0xffffff, emissiveMap: this.texture, emissiveIntensity: 0.12 }));
    face.position.set(0, 6.4, 0.08);
    const back = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, H + 0.3, 0.12), new THREE.MeshStandardMaterial({ color: 0x5a6066, roughness: 0.6, metalness: 0.4 }));
    back.position.set(0, 6.4, 0);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.45, metalness: 0.6 });
    for (const x of [-W / 2 + 1.5, W / 2 - 1.5]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 8.4, 10), postMat);
      post.position.set(x, 4.1, -0.15);
      this.group.add(post);
    }
    for (const m of [face, back]) {
      m.castShadow = true;
      this.group.add(m);
    }
    this.group.visible = false;
  }

  /** Places the sign beside the highway, facing traffic coming in from the map edge. */
  private place(): boolean {
    const net = this.city.roads;
    for (const seg of net.segments.values()) {
      if (seg.type !== 'highway') continue;
      const a = net.nodes.get(seg.a), b = net.nodes.get(seg.b);
      const fromA = !!a?.outside, fromB = !!b?.outside;
      if (!fromA && !fromB) continue;
      const p: PolyPoint = { x: 0, z: 0, tx: 0, tz: 0, i: 0 };
      const s = Math.min(seg.length * 0.5, 160);
      pointAt(seg.poly, fromA ? s : seg.length - s, p);
      // Direction of arriving traffic, and its right-hand side.
      const dx = fromA ? p.tx : -p.tx, dz = fromA ? p.tz : -p.tz;
      const off = ROAD_TYPES.highway.halfWidth + 7;
      const x = p.x - dz * off, z = p.z + dx * off;
      this.group.position.set(x, this.city.terrain.heightAt(x, z), z);
      // The face (+Z in model space) looks back at oncoming drivers.
      this.group.rotation.y = Math.atan2(-dx, -dz);
      return true;
    }
    return false;
  }

  update(): void {
    if (this.placedFor !== this.city.roads.version) {
      this.placedFor = this.city.roads.version;
      this.group.visible = this.place();
    }
    if (!this.group.visible) return;
    const pop = this.city.population.residents;
    const shown = pop < 1000 ? Math.round(pop / 10) * 10 : Math.round(pop / 100) * 100;
    const key = `${this.city.name}|${shown}`;
    if (key === this.key) return;
    this.key = key;
    this.draw(this.city.name, shown);
  }

  private draw(name: string, pop: number): void {
    const c = this.canvas;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#0f6b3a';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#f2f2ee';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.roundRect(14, 14, c.width - 28, c.height - 28, 22);
    ctx.stroke();
    ctx.fillStyle = '#f2f2ee';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 44px "Inter", system-ui, sans-serif';
    ctx.fillText('WELCOME TO', c.width / 2, 78);
    let size = 104;
    ctx.font = `700 ${size}px "Inter", system-ui, sans-serif`;
    while (ctx.measureText(name).width > c.width - 90 && size > 40) {
      size -= 4;
      ctx.font = `700 ${size}px "Inter", system-ui, sans-serif`;
    }
    ctx.fillText(name, c.width / 2, 160);
    ctx.font = '500 40px "Inter", system-ui, sans-serif';
    ctx.fillText(pop > 0 ? `POP. ${formatInt(pop)}` : 'EST. YEAR 1', c.width / 2, 240);
    this.texture.needsUpdate = true;
  }
}
