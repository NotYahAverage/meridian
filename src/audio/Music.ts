/**
 * Generative ambient score. Slow, warm pad chords drift through a progression
 * (major by day, minor at night) over a soft bass, while sparse marimba-like
 * notes from the same scale ring out through a tape-style delay and a long
 * reverb. Everything is synthesised; nothing repeats exactly.
 */

const DAY = [
  // D major: Dmaj9, Bm9, Gmaj7#11, A6/9 (MIDI notes)
  [50, 57, 61, 64, 66, 69],
  [47, 54, 57, 62, 64, 66],
  [43, 50, 54, 57, 61, 62],
  [45, 52, 57, 59, 61, 64],
  [50, 57, 62, 64, 66, 71],
  [52, 59, 62, 66, 67, 69],
];
const NIGHT = [
  // B minor: Bm9, Gmaj7, Em9, F#m7(b13)
  [47, 54, 57, 61, 62, 66],
  [43, 50, 54, 57, 59, 62],
  [40, 47, 50, 54, 55, 59],
  [42, 49, 54, 57, 61, 62],
];
const DAY_SCALE = [62, 64, 66, 69, 71, 74, 76, 78, 81];
const NIGHT_SCALE = [59, 61, 62, 66, 69, 71, 73, 74, 78];

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class Music {
  readonly out: GainNode;
  private reverb: ConvolverNode;
  private delay: DelayNode;
  private padBus: GainNode;
  private pluckBus: GainNode;
  private filter: BiquadFilterNode;
  private nextChord = 0;
  private nextPluck = 0;
  private chordIndex = 0;
  private started = false;
  /** 0 day … 1 night (set by the game). */
  night = 0;
  /** 0 quiet … 1 busy city (more melody). */
  activity = 0.5;

  constructor(private ctx: AudioContext, dest: AudioNode) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.out);
    // Pads pass a slowly breathing low-pass filter.
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 900;
    this.filter.Q.value = 0.4;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 380;
    lfo.connect(lfoGain).connect(this.filter.frequency);
    lfo.start();
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 0.6;
    this.padBus.connect(this.filter);
    this.filter.connect(this.out);
    this.filter.connect(this.reverb);
    // Plucks echo through a filtered feedback delay.
    this.pluckBus = ctx.createGain();
    this.pluckBus.gain.value = 0.75;
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = 0.46;
    const fb = ctx.createGain();
    fb.gain.value = 0.36;
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2400;
    this.delay.connect(dl).connect(fb).connect(this.delay);
    dl.connect(this.reverb);
    this.pluckBus.connect(this.out);
    this.pluckBus.connect(this.delay);
    this.pluckBus.connect(this.reverb);
  }

  /** Stereo exponential-decay noise impulse for the reverb. */
  private impulse(seconds: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return buf;
  }

  setVolume(v: number): void {
    this.out.gain.setTargetAtTime(v * 0.9, this.ctx.currentTime, 0.8);
  }

  /** Schedules upcoming chords and notes; call every frame. */
  update(): void {
    const t = this.ctx.currentTime;
    if (!this.started) {
      this.started = true;
      this.nextChord = t + 0.2;
      this.nextPluck = t + 4;
    }
    if (t > this.nextChord - 0.3) {
      const len = 13 + Math.random() * 5;
      this.chord(this.nextChord, len);
      this.nextChord += len - 3.5;
    }
    if (t > this.nextPluck - 0.2) {
      this.phrase(this.nextPluck);
      const density = 0.5 + this.activity * 0.8 - this.night * 0.35;
      this.nextPluck += (3.5 + Math.random() * 6) / Math.max(0.25, density);
    }
  }

  private chord(start: number, len: number): void {
    const prog = this.night > 0.5 ? NIGHT : DAY;
    // Wander through the progression, mostly forward.
    this.chordIndex = (this.chordIndex + (Math.random() < 0.8 ? 1 : 2)) % prog.length;
    const notes = prog[this.chordIndex];
    notes.forEach((n, k) => {
      const f = midi(n);
      const vol = (k === 0 ? 0.55 : 0.32) / notes.length;
      for (const det of [-6, 6]) this.padVoice(f, det, start + k * 0.18, len, vol, k === 0 ? 'sine' : 'sawtooth');
    });
    // Soft sub bass on the root.
    this.padVoice(midi(notes[0] - 12), 0, start, len, 0.12, 'sine');
  }

  private padVoice(freq: number, cents: number, start: number, len: number, vol: number, type: OscillatorType): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = cents;
    const g = ctx.createGain();
    const attack = 3.2, release = 4.5;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start + attack);
    g.gain.setValueAtTime(vol, start + len - release);
    g.gain.linearRampToValueAtTime(0, start + len);
    o.connect(g).connect(this.padBus);
    o.start(start);
    o.stop(start + len + 0.1);
  }

  /** One to four notes, like a hand idly playing a marimba. */
  private phrase(start: number): void {
    const scale = this.night > 0.5 ? NIGHT_SCALE : DAY_SCALE;
    const n = 1 + Math.floor(Math.random() * (this.night > 0.5 ? 2 : 4));
    let idx = Math.floor(Math.random() * scale.length);
    for (let i = 0; i < n; i++) {
      idx = Math.max(0, Math.min(scale.length - 1, idx + Math.round((Math.random() - 0.5) * 4)));
      this.pluck(midi(scale[idx]), start + i * (0.32 + Math.random() * 0.25), 0.11 + Math.random() * 0.05);
    }
  }

  private pluck(freq: number, start: number, vol: number): void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, start + 1.8);
    g.connect(this.pluckBus);
    // Fundamental plus a bright, fast-decaying overtone (marimba-ish).
    for (const [mult, type, amp] of [[1, 'sine', 1], [4, 'sine', 0.22], [2, 'triangle', 0.18]] as [number, OscillatorType, number][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * mult;
      const og = ctx.createGain();
      og.gain.setValueAtTime(amp, start);
      if (mult > 1) og.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
      o.connect(og).connect(g);
      o.start(start);
      o.stop(start + 1.9);
    }
  }
}
