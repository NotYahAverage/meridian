import { Music } from './Music';

export type Sfx = 'click' | 'tick' | 'select' | 'build' | 'bulldoze' | 'zone' | 'error' | 'notify' | 'good' | 'milestone' | 'warning' | 'open' | 'close' | 'dig' | 'plant' | 'chop';

/**
 * Interface sounds recorded from JDSherbert's Ultimate UI SFX Pack (trimmed to
 * their audible part), with the gain each plays at.
 */
/** Level of the recorded city ambience relative to the old synthesised hum. */
const CITY_LOOP_GAIN = 0.75;

const SAMPLES: Partial<Record<Sfx, number>> = { click: 0.32, tick: 0.28, select: 0.38, open: 0.36, close: 0.32, error: 0.42, notify: 0.42 };

/**
 * Sound effects and ambience (Web Audio). Interface sounds are short samples;
 * world sounds and ambience are synthesised at runtime.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private noise!: AudioBuffer;
  private cityGain!: GainNode;
  private windGain!: GainNode;
  private rainGain!: GainNode;
  private jetGain!: GainNode;
  private stormGain!: GainNode;
  private industryGain!: GainNode;
  private surfGain!: GainNode;
  private birdTimer = 0;
  volume = { master: 0.8, sfx: 0.8, ambient: 0.5, music: 0.4 };
  private music: Music | null = null;
  private lastPlay = new Map<Sfx, number>();
  private samples = new Map<Sfx, AudioBuffer>();
  /** Recorded city ambience (replaces the synthesised hum once loaded). */
  private cityLoop: GainNode | null = null;

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.amb = ctx.createGain();
    this.amb.connect(this.master);
    this.music = new Music(ctx, this.master);
    this.applyVolume();
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // Brown-ish noise for softer rumble.
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2 + w * 0.08;
    }
    this.startAmbience();
    void this.loadSamples(ctx);
    void this.loadCityLoop(ctx);
  }

  /** Fetches the interface samples; until one arrives its synthesised stand-in plays. */
  private async loadSamples(ctx: AudioContext): Promise<void> {
    const base = import.meta.env.BASE_URL ?? './';
    await Promise.all(
      (Object.keys(SAMPLES) as Sfx[]).map(async (name) => {
        try {
          const res = await fetch(`${base}assets/sfx/${name}.wav`);
          if (res.ok) this.samples.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch (e) {
          console.warn(`Sound ${name} failed to load`, e);
        }
      }),
    );
  }

  /** Urban ambience recording (Mixkit), looped seamlessly under the city. */
  private async loadCityLoop(ctx: AudioContext): Promise<void> {
    try {
      const base = import.meta.env.BASE_URL ?? './';
      const res = await fetch(`${base}assets/ambience/city.wav`);
      if (!res.ok) return;
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(g).connect(this.amb);
      // Start at a random point so it doesn't always open on the same car.
      src.start(0, Math.random() * buf.duration);
      this.cityLoop = g;
    } catch (e) {
      console.warn('City ambience failed to load', e);
    }
  }

  private playSample(buf: AudioBuffer, vol: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.sfx);
    src.start();
  }

  applyVolume(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.volume.master;
    this.sfx.gain.value = this.volume.sfx;
    this.amb.gain.value = this.volume.ambient;
    this.music?.setVolume(this.volume.music);
  }

  private startAmbience(): void {
    const ctx = this.ctx!;
    const mk = (freq: number, q: number, type: BiquadFilterType) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 0.7 + Math.random() * 0.2;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.amb);
      src.start();
      return g;
    };
    this.cityGain = mk(380, 0.6, 'lowpass');
    this.windGain = mk(700, 0.4, 'bandpass');
    this.rainGain = mk(2600, 0.3, 'highpass');
    this.jetGain = mk(520, 0.8, 'lowpass');
    this.stormGain = mk(240, 0.9, 'lowpass');
    // Industry: a low rumble with a mains-like drone under it.
    this.industryGain = mk(150, 0.7, 'lowpass');
    const drone = ctx.createOscillator();
    drone.frequency.value = 55;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.05;
    drone.connect(droneGain).connect(this.industryGain);
    drone.start();
    // Surf: band-passed noise that swells and fades like waves on a beach.
    const surf = mk(750, 0.5, 'bandpass');
    const swell = ctx.createGain();
    swell.gain.value = 0;
    surf.disconnect();
    surf.gain.value = 1;
    surf.connect(swell).connect(this.amb);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    const offset = ctx.createConstantSource();
    offset.offset.value = 0.6;
    lfo.connect(depth).connect(swell.gain);
    offset.connect(swell.gain);
    lfo.start();
    offset.start();
    this.surfGain = surf;
    this.surfGain.gain.value = 0;
  }

  /** A shell whistling skyward, with the thump of the mortar. */
  fireworkLaunch(vol: number, delay: number): void {
    if (!this.ctx || vol < 0.01) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f0 = 800 + Math.random() * 500;
    o.frequency.setValueAtTime(f0, t + 0.05);
    o.frequency.exponentialRampToValueAtTime(f0 * 2.3, t + 1.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.035 * vol, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(g).connect(this.amb);
    o.start(t);
    o.stop(t + 1.7);
    this.noiseHit(t, 0.25, 'lowpass', 180, 0.5 * vol, 0.6);
  }

  /** The boom of a burst; crackling stars add a shower of pops. */
  fireworkBurst(vol: number, delay: number, big: boolean, crackle: boolean): void {
    if (!this.ctx || vol < 0.01) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.45 + Math.random() * 0.15;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1600, t);
    f.frequency.exponentialRampToValueAtTime(110, t + 1.4);
    const g = ctx.createGain();
    const peak = (big ? 1.1 : 0.75) * vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.015);
    g.gain.exponentialRampToValueAtTime(peak * 0.3, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2);
    src.connect(f).connect(g).connect(this.amb);
    src.start(t, Math.random());
    src.stop(t + 2.1);
    if (crackle) for (let k = 0; k < 16; k++) this.noiseHit(t + 0.7 + Math.random() * 1.3, 0.035, 'highpass', 2500 + Math.random() * 3000, 0.22 * vol, 1);
  }

  private noiseHit(t: number, dur: number, type: BiquadFilterType, freq: number, vol: number, rate: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.amb);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  /** Rolling thunder: filtered noise with a slow decay. */
  thunder(strength: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.35 + Math.random() * 0.15;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t0);
    f.frequency.exponentialRampToValueAtTime(140, t0 + 2.5);
    const g = ctx.createGain();
    const peak = Math.max(0.05, Math.min(1, strength)) * 1.6;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.08);
    g.gain.exponentialRampToValueAtTime(peak * 0.45, t0 + 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 4.5);
    src.connect(f).connect(g).connect(this.amb);
    src.start(t0, Math.random());
    src.stop(t0 + 4.6);
  }

  update(dt: number, p: { camDist: number; population: number; night: number; paused: boolean; buildingsNear: number; rain?: number; wind?: number; jet?: number; storm?: number; industry?: number; shore?: number; parks?: number }): void {
    if (!this.ctx) return;
    if (this.music) {
      this.music.night = p.night;
      this.music.activity = Math.min(1, 0.3 + p.population / 10000);
      if (this.volume.music > 0.001) this.music.update();
    }
    const t = this.ctx.currentTime;
    const close = Math.max(0, 1 - p.camDist / 2200);
    const urban = Math.min(1, p.buildingsNear / 60);
    const cityLevel = (p.paused ? 0.35 : 1) * close * (0.15 + 0.85 * urban) * Math.min(1, 0.2 + p.population / 4000) * 0.55;
    const windLevel = (0.12 + 0.25 * (1 - urban)) * (0.4 + 0.6 * (1 - close)) * 0.5 * (0.6 + (p.wind ?? 0.35) * 1.4);
    this.rainGain.gain.setTargetAtTime((p.rain ?? 0) * (0.35 + 0.3 * close), t, 1.2);
    // The recording takes over from the synthesised hum once it has loaded.
    this.cityGain.gain.setTargetAtTime(this.cityLoop ? 0 : cityLevel, t, 0.6);
    this.cityLoop?.gain.setTargetAtTime(cityLevel * CITY_LOOP_GAIN * (1 - 0.35 * p.night), t, 0.6);
    this.windGain.gain.setTargetAtTime(windLevel, t, 0.8);
    this.jetGain.gain.setTargetAtTime(p.paused ? 0 : Math.min(1, p.jet ?? 0) * 0.9, t, 0.5);
    this.stormGain.gain.setTargetAtTime(Math.min(1.4, (p.storm ?? 0) * 1.6), t, 0.8);
    this.industryGain.gain.setTargetAtTime((p.industry ?? 0) * close * (p.paused ? 0.4 : 1) * (1 - 0.4 * p.night) * 0.55, t, 1.2);
    this.surfGain.gain.setTargetAtTime((p.shore ?? 0) * (0.2 + 0.4 * close) * (0.7 + (p.wind ?? 0.35) * 0.8) * 0.55, t, 1.5);
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 1.5 + Math.random() * 5;
      const leafy = urban < 0.7 || (p.parks ?? 0) > 0.25;
      if (!p.paused && p.night < 0.4 && p.camDist < 700 && leafy && (p.rain ?? 0) < 0.2) this.chirp();
      // Parks and woods are livelier.
      if ((p.parks ?? 0) > 0.4) this.birdTimer *= 0.6;
    }
  }

  private chirp(): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 3);
    const base = 2400 + Math.random() * 1600;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const st = t0 + i * 0.13;
      o.frequency.setValueAtTime(base, st);
      o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.4), st + 0.07);
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(0.025, st + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.09);
      o.connect(g).connect(this.amb);
      o.start(st);
      o.stop(st + 0.1);
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, freq: number, type: BiquadFilterType, vol: number, delay = 0, q = 0.8): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 1.5;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  play(name: Sfx): void {
    if (!this.ctx) return;
    const now = performance.now();
    if (now - (this.lastPlay.get(name) ?? 0) < 45) return;
    this.lastPlay.set(name, now);
    const sample = this.samples.get(name);
    if (sample) {
      this.playSample(sample, SAMPLES[name] ?? 0.4);
      return;
    }
    switch (name) {
      case 'select':
      case 'close':
      case 'click':
        this.tone(1650, 0.045, 'sine', 0.09);
        break;
      case 'tick':
        this.tone(980, 0.05, 'triangle', 0.08);
        break;
      case 'open':
        this.tone(520, 0.12, 'sine', 0.05, 0, 780);
        break;
      case 'build':
        this.tone(150, 0.22, 'sine', 0.35, 0, 55);
        this.burst(0.12, 1400, 'bandpass', 0.25);
        this.tone(420, 0.06, 'square', 0.04, 0.03);
        break;
      case 'bulldoze':
        this.burst(0.5, 520, 'lowpass', 0.6);
        this.tone(75, 0.4, 'sawtooth', 0.12, 0, 40);
        this.burst(0.25, 2200, 'bandpass', 0.15, 0.08, 1.2);
        break;
      case 'zone':
        this.burst(0.28, 3800, 'bandpass', 0.18, 0, 0.6);
        this.tone(660, 0.12, 'sine', 0.04, 0.02, 880);
        break;
      case 'error':
        this.tone(230, 0.09, 'square', 0.05);
        this.tone(175, 0.12, 'square', 0.05, 0.1);
        break;
      case 'notify':
        this.tone(880, 0.14, 'sine', 0.07);
        this.tone(1320, 0.2, 'sine', 0.06, 0.12);
        break;
      case 'warning':
        this.tone(560, 0.16, 'triangle', 0.08);
        this.tone(420, 0.24, 'triangle', 0.08, 0.16);
        break;
      case 'good':
        [660, 880, 1100].forEach((f, i) => this.tone(f, 0.18, 'sine', 0.07, i * 0.09));
        break;
      case 'dig':
        // Earth moving: a low, gravelly rumble.
        this.burst(0.32, 320, 'lowpass', 0.32, 0, 0.9);
        this.tone(58, 0.28, 'sine', 0.1, 0, 46);
        this.burst(0.18, 1500, 'bandpass', 0.05, 0.05, 1.6);
        break;
      case 'plant':
        // Soft rustle of leaves and a thud of soil.
        this.burst(0.16, 3200, 'bandpass', 0.09, 0, 1.4);
        this.tone(110, 0.08, 'sine', 0.08, 0.02, 80);
        break;
      case 'chop':
        this.burst(0.06, 2400, 'highpass', 0.18);
        this.tone(140, 0.12, 'triangle', 0.12, 0, 70);
        this.burst(0.5, 900, 'lowpass', 0.12, 0.12, 0.7);
        break;
      case 'milestone':
        [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.08, i * 0.11));
        this.burst(1.2, 6000, 'highpass', 0.05, 0.4);
        break;
    }
  }
}
