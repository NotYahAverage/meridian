import * as THREE from 'three';
import type { City } from '../../sim/City';
import { BuildingRenderer } from '../buildings/BuildingRenderer';

/** Icon atlas slots: 0 fire, 1 power, 2 water, 3 sewage, 4 garbage, 5 workers, 6 road, 7 abandoned. */
const ICONS = 8;

function drawAtlas(): THREE.CanvasTexture {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S * ICONS;
  c.height = S;
  const ctx = c.getContext('2d')!;
  const colors = ['#ff5a2a', '#ffc21a', '#38a8ff', '#8d6b4a', '#7cbf42', '#b98cff', '#f0f0f0', '#9aa0a6'];
  for (let i = 0; i < ICONS; i++) {
    const x0 = i * S;
    ctx.save();
    ctx.translate(x0 + S / 2, S / 2);
    // Badge
    ctx.fillStyle = 'rgba(16,20,26,0.88)';
    ctx.beginPath();
    ctx.arc(0, -2, 25, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-8, 20);
    ctx.lineTo(8, 20);
    ctx.lineTo(0, 30);
    ctx.fill();
    ctx.strokeStyle = colors[i];
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, -2, 25, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = colors[i];
    ctx.strokeStyle = colors[i];
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    switch (i) {
      case 0: // flame
        ctx.beginPath();
        ctx.moveTo(0, -18);
        ctx.bezierCurveTo(12, -6, 12, 6, 0, 12);
        ctx.bezierCurveTo(-12, 6, -12, -6, -2, -10);
        ctx.bezierCurveTo(-2, -2, 2, 0, 0, -18);
        ctx.fill();
        break;
      case 1: // bolt
        ctx.beginPath();
        ctx.moveTo(4, -18);
        ctx.lineTo(-8, 2);
        ctx.lineTo(0, 2);
        ctx.lineTo(-4, 16);
        ctx.lineTo(9, -4);
        ctx.lineTo(1, -4);
        ctx.closePath();
        ctx.fill();
        break;
      case 2: // droplet
        ctx.beginPath();
        ctx.moveTo(0, -18);
        ctx.bezierCurveTo(10, -4, 12, 4, 0, 13);
        ctx.bezierCurveTo(-12, 4, -10, -4, 0, -18);
        ctx.fill();
        break;
      case 3: // pipe
        ctx.beginPath();
        ctx.moveTo(-14, -8);
        ctx.lineTo(4, -8);
        ctx.quadraticCurveTo(12, -8, 12, 0);
        ctx.lineTo(12, 14);
        ctx.stroke();
        ctx.fillRect(-16, -14, 4, 12);
        break;
      case 4: // bin
        ctx.fillRect(-10, -8, 20, 22);
        ctx.fillRect(-13, -13, 26, 4);
        ctx.fillRect(-4, -17, 8, 4);
        break;
      case 5: // person
        ctx.beginPath();
        ctx.arc(0, -9, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-11, 14);
        ctx.quadraticCurveTo(0, -6, 11, 14);
        ctx.fill();
        break;
      case 6: // road with cross
        ctx.beginPath();
        ctx.moveTo(-6, 16);
        ctx.lineTo(-3, -16);
        ctx.moveTo(6, 16);
        ctx.lineTo(3, -16);
        ctx.stroke();
        ctx.strokeStyle = '#ff4d4d';
        ctx.beginPath();
        ctx.moveTo(-12, -10);
        ctx.lineTo(12, 10);
        ctx.stroke();
        break;
      case 7: // boarded house
        ctx.beginPath();
        ctx.moveTo(-14, -2);
        ctx.lineTo(0, -16);
        ctx.lineTo(14, -2);
        ctx.lineTo(14, 14);
        ctx.lineTo(-14, 14);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-8, 2);
        ctx.lineTo(8, 10);
        ctx.moveTo(8, 2);
        ctx.lineTo(-8, 10);
        ctx.stroke();
        break;
    }
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Floating problem badges above buildings (billboards in one draw call). */
export class StatusIcons {
  readonly mesh: THREE.InstancedMesh;
  private icon: THREE.InstancedBufferAttribute;
  private timer = 0;
  private cap = 2048;
  visible = true;

  constructor(private city: City, private buildings: BuildingRenderer) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.icon = new THREE.InstancedBufferAttribute(new Float32Array(this.cap), 1);
    geo.setAttribute('aIcon', this.icon);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: drawAtlas() }, uTime: { value: 0 }, uSize: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aIcon;
        uniform float uTime;
        uniform float uSize;
        varying vec2 vUv;
        varying float vIcon;
        void main() {
          vUv = uv;
          vIcon = aIcon;
          vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float bob = sin(uTime * 2.4 + instanceMatrix[3].x * 0.3) * 0.08;
          float s = uSize * (-center.z) * 0.035;
          center.xy += (position.xy + vec2(0.0, bob)) * s;
          gl_Position = projectionMatrix * center;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        varying vec2 vUv;
        varying float vIcon;
        void main() {
          vec2 uv = vec2((vIcon + vUv.x) / ${ICONS.toFixed(1)}, vUv.y);
          vec4 c = texture2D(uAtlas, uv);
          if (c.a < 0.05) discard;
          gl_FragColor = c;
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
  }

  update(dt: number, camDistance: number, time: number): void {
    const mat = this.mesh.material as THREE.ShaderMaterial;
    mat.uniforms.uTime.value = time;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.4;
    let n = 0;
    const m = new THREE.Matrix4();
    const show = this.visible && camDistance < 1700;
    if (show) {
      for (const b of this.city.buildings.all.values()) {
        const ic = BuildingRenderer.iconFor(b);
        if (ic < 0) continue;
        if (n >= this.cap) break;
        const h = this.buildings.heightOf(b.id);
        m.makeTranslation(b.cx, b.y + h + 6, b.cz);
        this.mesh.setMatrixAt(n, m);
        this.icon.setX(n, ic);
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.icon.needsUpdate = true;
    mat.uniforms.uSize.value = 1;
  }
}
