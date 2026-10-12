import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GradePass, ScenePass } from './post/ScenePass';
import { type QualitySettings, QUALITY_PRESETS } from './shared';

/**
 * Owns the WebGL context, the main scene/camera and the post-processing chain:
 * scene (multisampled, with ambient occlusion) → bloom → tone map and grade.
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  readonly scenePass: ScenePass;
  readonly grade: GradePass;
  quality: QualitySettings = { ...QUALITY_PRESETS.high };
  private width = 1;
  private height = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.88;
    // Tone mapping happens in the grade pass at the end of the chain.
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.camera = new THREE.PerspectiveCamera(42, 1, 2, 16000);
    // The composer's own buffers only carry post-processing; the scene pass multisamples.
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.composer = new EffectComposer(this.renderer, rt);
    this.scenePass = new ScenePass(this.scene, this.camera);
    this.composer.addPass(this.scenePass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.4, 0.92);
    this.composer.addPass(this.bloom);
    this.grade = new GradePass();
    this.composer.addPass(this.grade);
    this.resize();
  }

  setQuality(q: QualitySettings): void {
    this.quality = { ...q };
    this.renderer.shadowMap.enabled = q.shadows;
    this.bloom.enabled = q.bloom;
    this.scenePass.setSamples(q.antialias ? 4 : 0);
    this.scenePass.ao = q.ao;
    this.resize();
  }

  /** Bloom grows at night so lit windows and street lamps glow; the grade cools. */
  setNight(night: number): void {
    // By day only real highlights (sun glints) bloom; at night lit windows and lamps do.
    this.bloom.strength = 0.06 + night * 0.46;
    this.bloom.threshold = 2.4 - night * 1.55;
    this.bloom.radius = 0.35 + night * 0.15;
    this.grade.uniforms.uNight.value = night;
  }

  /** Ambient occlusion fades out with distance so it doesn't darken the haze. */
  setFogRange(near: number, far: number): void {
    this.scenePass.fade.set(Math.max(300, near * 0.9), Math.max(800, near * 0.9 + (far - near) * 0.35));
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.width = w;
    this.height = h;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  render(): void {
    this.grade.uniforms.uExposure.value = this.renderer.toneMappingExposure;
    this.composer.render();
  }

  /**
   * Compiles every material in the scene up front, in parallel where the driver
   * supports it, so the first visible frame doesn't stall on shader compilation.
   */
  async precompile(): Promise<void> {
    const t0 = performance.now();
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch (e) {
      console.warn('Shader precompile failed; compiling on first use', e);
    }
    performance.measure('boot:compileAsync', { start: t0, end: performance.now() });
    const t1 = performance.now();
    // Shadow and post-processing programs compile on the first real frame.
    this.render();
    performance.measure('boot:firstFrame', { start: t1, end: performance.now() });
  }

  /** Renders one frame and returns a small JPEG thumbnail (for save slots). */
  captureThumbnail(width = 320, height = 180): string {
    this.render();
    const src = this.renderer.domElement;
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    if (!ctx) return '';
    const sr = src.width / src.height;
    const dr = width / height;
    let sw = src.width, sh = src.height, sx = 0, sy = 0;
    if (sr > dr) {
      sw = src.height * dr;
      sx = (src.width - sw) / 2;
    } else {
      sh = src.width / dr;
      sy = (src.height - sh) / 2;
    }
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, width, height);
    return c.toDataURL('image/jpeg', 0.78);
  }

  dispose(): void {
    this.composer.dispose();
    this.renderer.dispose();
  }
}
