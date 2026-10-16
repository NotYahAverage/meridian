import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WALK_LAMP_OUT, WALK_LAMP_Y } from '../roads/RoadMeshBuilder';

/** Pole and signal housing of a pedestrian signal, facing +X (merged, with the asset material's attributes). */
export function walkSignalGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, col: number[]) => {
    const n = g.getAttribute('position').count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set(col, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
    g.deleteAttribute('uv');
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  const pole = new THREE.CylinderGeometry(0.055, 0.065, 2.4, 8);
  pole.translate(0, 1.2, 0);
  add(pole, [0.2, 0.21, 0.22]);
  const housing = new THREE.BoxGeometry(0.28, 0.72, 0.32);
  housing.translate(0.13, (WALK_LAMP_Y.hand + WALK_LAMP_Y.walk) / 2, 0);
  add(housing, [0.11, 0.115, 0.12]);
  // Visors over each lamp.
  for (const y of [WALK_LAMP_Y.hand, WALK_LAMP_Y.walk]) {
    const visor = new THREE.BoxGeometry(0.1, 0.03, 0.3);
    visor.translate(WALK_LAMP_OUT + 0.03, y + 0.15, 0);
    add(visor, [0.09, 0.09, 0.1]);
  }
  return mergeGeometries(parts)!;
}

/** A lamp lens facing +X at height `y` (instance colour lights it). */
export function walkLampGeometry(y: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(0.26, 0.26);
  g.rotateY(Math.PI / 2);
  g.translate(WALK_LAMP_OUT, y, 0);
  return g;
}

/** Lens textures: the raised hand ("don't walk") and the walking person. */
export function walkLampTexture(kind: 'hand' | 'walk'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (kind === 'hand') {
    ctx.beginPath();
    ctx.roundRect(20, 28, 25, 24, 6);
    ctx.fill();
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.roundRect(20 + k * 6.4, 10 + (k === 0 || k === 3 ? 5 : 0), 5.2, 24, 2.6);
      ctx.fill();
    }
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(22, 44);
    ctx.lineTo(13, 32);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(35, 11, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 6.5;
    ctx.beginPath();
    ctx.moveTo(33, 20);
    ctx.lineTo(29, 38);
    ctx.moveTo(29, 38);
    ctx.lineTo(20, 56);
    ctx.moveTo(29, 38);
    ctx.lineTo(39, 55);
    ctx.moveTo(32, 23);
    ctx.lineTo(22, 33);
    ctx.moveTo(32, 23);
    ctx.lineTo(42, 31);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
