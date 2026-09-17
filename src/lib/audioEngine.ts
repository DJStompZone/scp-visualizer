/* ============================================================
   AUDIO ENGINE — FFT / beat detection / multi-source input
   Sources: idle (simulated) | demo (generative synth) | file | mic
   ============================================================ */

export type AudioMode = "idle" | "demo" | "file" | "mic";

export interface BandLevels {
  bass: number;
  lowMid: number;
  mid: number;
  highMid: number;
  treble: number;
  energy: number;
  rms: number;
  beat: boolean;
  beatPulse: number; // decaying 1 -> 0
}

const BAND_RANGES: Array<[number, number]> = [
  [20, 160], // bass
  [160, 400], // lowMid
  [400, 1200], // mid
  [1200, 4000], // highMid
  [4000, 14000], // treble
];

function midiToFreq(m: number) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

class AudioEngine {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  mixGain: GainNode | null = null;
  masterGain: GainNode | null = null;
  mediaSource: MediaElementAudioSourceNode | null = null;
  micSource: MediaStreamAudioSourceNode | null = null;
  micStream: MediaStream | null = null;

  audioEl: HTMLAudioElement | null = null;
  fileName: string = "";
  filePlaying = false;
  fileDuration = 0;
  fileCurrentTime = 0;

  mode: AudioMode = "idle";
  fftSize = 2048;
  smoothing = 0.82;
  volume = 0.85;
  beatThreshold = 0.32;
  beatCooldownMs = 280;

  freqData: Uint8Array = new Uint8Array(1024);
  timeData: Uint8Array = new Uint8Array(2048);

  // offline mode
  offlineData: { freq: Uint8Array; time: Uint8Array }[] | null = null;
  offlineFps = 60;
  offlineFrame = 0;

  // beat tracking
  private bassHistory: number[] = [];
  private lastBeatTime = 0;
  private beatPulse = 0;
  private beatFlag = false;

  // idle simulation
  private idleTime = 0;
  private idleNextKick = 0;

  // demo sequencer
  demoPlaying = false;
  bpm = 128;
  private demoStep = 0;
  private demoNextTime = 0;
  private demoTimer: number | null = null;
  private demoNodes: AudioNode[] = [];
  private demoBus: GainNode | null = null;
  private demoDelay: DelayNode | null = null;

  listeners = new Set<() => void>();

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  ensureCtx() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return this.ctx;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.volume;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = this.fftSize;
    this.analyser.smoothingTimeConstant = this.smoothing;
    this.mixGain = this.ctx.createGain();
    this.mixGain.gain.value = 1.0;
    // audible path: mix -> master -> speakers
    // analysis path: mix -> analyser as a TAP (analyser output is intentionally
    // left unconnected, so mic input can never feed back to the speakers)
    this.mixGain.connect(this.masterGain);
    this.mixGain.connect(this.analyser);
    this.masterGain.connect(this.ctx.destination);
    this.allocArrays();
    return this.ctx;
  }

  private allocArrays() {
    if (!this.analyser) return;
    const bins = this.analyser.frequencyBinCount;
    this.freqData = new Uint8Array(bins);
    const n = this.analyser.fftSize;
    this.timeData = new Uint8Array(n);
  }

  setFFTSize(n: number) {
    this.fftSize = n;
    if (this.analyser) {
      this.analyser.fftSize = n;
      this.allocArrays();
    }
    this.emit();
  }

  setSmoothing(v: number) {
    this.smoothing = v;
    if (this.analyser) this.analyser.smoothingTimeConstant = v;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
    }
  }

  setBeatThreshold(v: number) {
    this.beatThreshold = v;
  }

  setBpm(v: number) {
    this.bpm = v;
  }

  /* ---------------- mode switching ---------------- */

  async setMode(mode: AudioMode) {
    if (mode === this.mode && mode !== "mic") {
      this.emit();
      return;
    }
    // tear down previous live sources (keep file element paused state)
    this.stopDemoScheduler();
    this.disconnectMic();
    if (mode === "file") {
      this.ensureCtx();
      this.mode = "file";
      this.emit();
      return;
    }
    if (mode === "mic") {
      await this.enableMic();
      return;
    }
    if (mode === "demo") {
      this.ensureCtx();
      this.mode = "demo";
      this.startDemoScheduler();
      this.emit();
      return;
    }
    // idle
    this.mode = "idle";
    this.emit();
  }

  /** true only when a source is actually producing signal; otherwise idle sim fills in */
  get liveInput() {
    if (!this.ctx || this.ctx.state !== "running") return false;
    if (this.mode === "demo") return this.demoPlaying;
    if (this.mode === "mic") return !!this.micStream && this.micStream.active;
    if (this.mode === "file") return !!this.audioEl?.src && !this.audioEl.paused;
    return false;
  }

  /* ---------------- file ---------------- */

  private ensureAudioEl() {
    if (this.audioEl) return this.audioEl;
    const el = new Audio();
    el.crossOrigin = "anonymous";
    el.preload = "auto";
    el.addEventListener("play", () => {
      this.filePlaying = true;
      this.emit();
    });
    el.addEventListener("pause", () => {
      this.filePlaying = false;
      this.emit();
    });
    el.addEventListener("timeupdate", () => {
      this.fileCurrentTime = el.currentTime;
    });
    el.addEventListener("loadedmetadata", () => {
      this.fileDuration = el.duration || 0;
      this.emit();
    });
    this.audioEl = el;
    return el;
  }

  async loadFile(file: File) {
    this.ensureCtx();
    const el = this.ensureAudioEl();
    if (!this.ctx || !this.mixGain) return;
    if (!this.mediaSource) {
      this.mediaSource = this.ctx.createMediaElementSource(el);
      this.mediaSource.connect(this.mixGain);
    }
    const url = URL.createObjectURL(file);
    el.src = url;
    el.loop = true;
    this.fileName = file.name;
    this.fileCurrentTime = 0;
    this.mode = "file";
    this.stopDemoScheduler();
    this.disconnectMic();
    try {
      await el.play();
    } catch {
      /* user gesture needed */
    }
    this.emit();
  }

  async toggleFilePlay() {
    const el = this.ensureAudioEl();
    this.ensureCtx();
    if (el.paused) {
      try {
        await el.play();
      } catch {
        /* noop */
      }
    } else {
      el.pause();
    }
    this.emit();
  }

  seekFile(t: number) {
    if (this.audioEl) {
      this.audioEl.currentTime = t;
      this.fileCurrentTime = t;
    }
  }

  /* ---------------- offline (record mode) ---------------- */

  async loadOffline(file: File, fps: number): Promise<number> {
    this.ensureCtx();
    if (!this.ctx) return 0;
    
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    
    this.fileName = file.name;
    this.fileDuration = audioBuffer.duration;
    this.mode = "file";
    this.offlineFps = fps;
    this.offlineData = [];
    
    const offlineCtx = new OfflineAudioContext(
      audioBuffer.numberOfChannels,
      audioBuffer.length,
      audioBuffer.sampleRate
    );
    
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    
    const analyser = offlineCtx.createAnalyser();
    analyser.fftSize = this.fftSize;
    analyser.smoothingTimeConstant = this.smoothing;
    
    source.connect(analyser);
    analyser.connect(offlineCtx.destination);
    source.start(0);
    
    const totalFrames = Math.ceil(audioBuffer.duration * fps);
    
    // Schedule suspends for each frame
    for (let i = 0; i < totalFrames; i++) {
      const time = Math.max(0.0001, i / fps);
      offlineCtx.suspend(time).then(() => {
        const freq = new Uint8Array(analyser.frequencyBinCount);
        const timeDom = new Uint8Array(analyser.fftSize);
        analyser.getByteFrequencyData(freq);
        analyser.getByteTimeDomainData(timeDom);
        this.offlineData!.push({ freq, time: timeDom });
        offlineCtx.resume();
      });
    }
    
    await offlineCtx.startRendering();
    this.emit();
    return audioBuffer.duration;
  }

  seekOfflineFrame(frame: number) {
    if (!this.offlineData || !this.offlineData[frame]) return;
    this.offlineFrame = frame;
    this.freqData = this.offlineData[frame].freq;
    this.timeData = this.offlineData[frame].time;
  }

  /* ---------------- mic ---------------- */

  async enableMic() {
    this.ensureCtx();
    if (!this.ctx || !this.analyser) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      this.disconnectMic();
      this.micStream = stream;
      this.micSource = this.ctx.createMediaStreamSource(stream);
      // mic -> analyser only (no destination = no feedback)
      this.micSource.connect(this.analyser);
      this.mode = "mic";
      this.stopDemoScheduler();
    } catch (err) {
      console.warn("mic denied", err);
      this.mode = "idle";
    }
    this.emit();
  }

  private disconnectMic() {
    try {
      this.micSource?.disconnect();
    } catch {
      /* noop */
    }
    this.micSource = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
  }

  /* ---------------- demo generative techno ---------------- */

  private startDemoScheduler() {
    if (!this.ctx || !this.mixGain) return;
    if (this.demoTimer !== null) return;
    const ctx = this.ctx;
    // demo bus with a touch of drive + delay send
    this.demoBus = ctx.createGain();
    this.demoBus.gain.value = 0.9;
    this.demoBus.connect(this.mixGain);

    this.demoDelay = ctx.createDelay(1.0);
    this.demoDelay.delayTime.value = 60 / this.bpm / 2; // 8th note
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.demoDelay.connect(fb);
    fb.connect(this.demoDelay);
    this.demoDelay.connect(wet);
    wet.connect(this.demoBus);
    this.demoNodes.push(this.demoBus, this.demoDelay, fb, wet);

    this.demoPlaying = true;
    this.demoStep = 0;
    this.demoNextTime = ctx.currentTime + 0.08;
    this.demoTimer = window.setInterval(() => this.scheduleDemo(), 25);
    this.emit();
  }

  private stopDemoScheduler() {
    if (this.demoTimer !== null) {
      clearInterval(this.demoTimer);
      this.demoTimer = null;
    }
    this.demoPlaying = false;
    this.demoNodes.forEach((n) => {
      try {
        n.disconnect();
      } catch {
        /* noop */
      }
    });
    this.demoNodes = [];
    this.demoBus = null;
    this.demoDelay = null;
  }

  toggleDemo() {
    this.ensureCtx();
    if (this.mode !== "demo") {
      this.setMode("demo");
      return;
    }
    if (this.demoPlaying) {
      this.stopDemoScheduler();
      this.mode = "idle";
    } else {
      this.startDemoScheduler();
    }
    this.emit();
  }

  private scheduleDemo() {
    if (!this.ctx || !this.demoPlaying) return;
    const spb = 60 / this.bpm / 4; // 16th
    while (this.demoNextTime < this.ctx.currentTime + 0.14) {
      this.playDemoStep(this.demoStep, this.demoNextTime);
      this.demoNextTime += spb;
      this.demoStep = (this.demoStep + 1) % 64; // 4 bars
    }
  }

  private playDemoStep(step: number, t: number) {
    const bus = this.demoBus!;
    const s16 = step % 16;
    const bar = Math.floor(step / 16);

    // KICK — four on the floor + extra ghost
    if (s16 % 4 === 0 || (bar === 3 && s16 === 14)) this.kick(t, bus);
    // SNARE on 4 & 12
    if (s16 === 4 || s16 === 12) this.snare(t, bus);
    // HATS — offbeat open + 16th ticks
    if (s16 % 4 === 2) this.hat(t, bus, true, 0.5);
    else if (s16 % 2 === 1) this.hat(t, bus, false, 0.18 + Math.random() * 0.12);
    else if (Math.random() < 0.3) this.hat(t, bus, false, 0.1);
    // BASS — rolling minor pattern
    const bassSeq = [33, 33, 36, 33, 31, 33, 38, 36, 33, 33, 36, 41, 31, 33, 34, 36]; // A1 groove
    if (s16 % 2 === 0 || Math.random() < 0.25) {
      const n = bassSeq[s16] + (bar === 2 ? 2 : 0);
      this.bassNote(t, midiToFreq(n), bus, 0.22);
    }
    // ARP LEAD — sparse pentatonic
    const arpSeq = [69, -1, 72, -1, 76, 74, 72, -1, 69, -1, 79, 76, 74, 72, 71, 72];
    const an = arpSeq[s16];
    if (an > 0 && (bar % 2 === 1 || Math.random() < 0.4)) this.pluck(t, midiToFreq(an), bus);
    // PAD — chord stab at bar starts
    if (step % 32 === 0) {
      const roots = [57, 53, 55, 52]; // A3 F3 G3 E3
      this.pad(t, midiToFreq(roots[(bar / 2) | 0]), bus);
    }
    // RISER into bar 4
    if (bar === 3 && s16 === 0) this.riser(t, bus, (60 / this.bpm) * 4);
  }

  private kick(t: number, out: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    g.gain.setValueAtTime(1.0, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.36);
    // click
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.type = "square";
    o2.frequency.setValueAtTime(900, t);
    g2.gain.setValueAtTime(0.12, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    o2.connect(g2);
    g2.connect(out);
    o2.start(t);
    o2.stop(t + 0.03);
  }

  private snare(t: number, out: AudioNode) {
    const ctx = this.ctx!;
    // body
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.12);
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.22);
    // noise
    this.noiseBurst(t, out, 0.18, 1800, 0.5, "highpass");
  }

  private hat(t: number, out: AudioNode, open: boolean, vol: number) {
    this.noiseBurst(t, out, open ? 0.28 : 0.05, 7500, vol, "highpass");
  }

  private noiseBurst(t: number, out: AudioNode, dur: number, freq: number, vol: number, type: BiquadFilterType) {
    const ctx = this.ctx!;
    const len = Math.max(1, (dur * ctx.sampleRate) | 0);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    if (this.demoDelay && vol > 0.3) g.connect(this.demoDelay);
    src.start(t);
  }

  private bassNote(t: number, freq: number, out: AudioNode, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = "square";
    o2.frequency.value = freq / 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.4;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 9;
    f.frequency.setValueAtTime(freq * 8, t);
    f.frequency.exponentialRampToValueAtTime(freq * 1.5, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f);
    o2.connect(g2);
    g2.connect(f);
    f.connect(g);
    g.connect(out);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
  }

  private pluck(t: number, freq: number, out: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 6;
    f.frequency.setValueAtTime(freq * 6, t);
    f.frequency.exponentialRampToValueAtTime(freq * 1.2, t + 0.24);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(f);
    f.connect(g);
    g.connect(out);
    if (this.demoDelay) g.connect(this.demoDelay);
    o.start(t);
    o.stop(t + 0.34);
  }

  private pad(t: number, root: number, out: AudioNode) {
    const ctx = this.ctx!;
    [0, 3, 7, 12].forEach((iv) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = midiToFreq(12 * Math.log2(root / 440) + 69 + iv);
      o.detune.value = (Math.random() - 0.5) * 18;
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.8);
      g.gain.linearRampToValueAtTime(0.0001, t + 3.6);
      o.connect(f);
      f.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + 3.8);
    });
  }

  private riser(t: number, out: AudioNode, dur: number) {
    const ctx = this.ctx!;
    const len = (dur * ctx.sampleRate) | 0;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(6000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + dur * 0.95);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(t);
  }

  /* ---------------- analysis ---------------- */

  update(dt: number) {
    if (this.offlineData) {
      // In offline mode, freqData and timeData are injected via seekOfflineFrame
    } else if (this.analyser && this.liveInput && this.ctx?.state === "running") {
      this.analyser.getByteFrequencyData(this.freqData as Uint8Array<ArrayBuffer>);
      this.analyser.getByteTimeDomainData(this.timeData as Uint8Array<ArrayBuffer>);
    } else {
      this.simulateIdle(dt);
    }
    // decay beat pulse
    this.beatPulse *= Math.exp(-dt * 5.2);
    if (this.beatPulse < 0.01) this.beatPulse = 0;
    this.beatFlag = false;

    const bass = this.readBand(0);
    // beat detect on live OR simulated
    this.bassHistory.push(bass);
    if (this.bassHistory.length > 43) this.bassHistory.shift();
    const avg = this.bassHistory.reduce((a, b) => a + b, 0) / Math.max(1, this.bassHistory.length);
    const now = performance.now();
    if (
      bass > this.beatThreshold &&
      bass > avg * 1.12 &&
      now - this.lastBeatTime > this.beatCooldownMs &&
      (this.liveInput ? this.energyRaw() > 0.06 : true)
    ) {
      this.lastBeatTime = now;
      this.beatPulse = 1;
      this.beatFlag = true;
    }
  }

  private binHz() {
    if (!this.ctx || !this.analyser) return 23.4;
    return this.ctx.sampleRate / 2 / this.analyser.frequencyBinCount;
  }

  private readBand(i: number): number {
    if ((!this.liveInput && !this.offlineData) || !this.ctx) return this.simBand(i);
    const [lo, hi] = BAND_RANGES[i];
    const bh = this.binHz();
    const loBin = Math.max(1, Math.floor(lo / bh));
    const hiBin = Math.min(this.freqData.length - 1, Math.ceil(hi / bh));
    let sum = 0;
    for (let b = loBin; b <= hiBin; b++) sum += this.freqData[b] / 255;
    const n = Math.max(1, hiBin - loBin + 1);
    return Math.min(1, (sum / n) * 1.6);
  }

  private energyRaw(): number {
    let sum = 0;
    const n = Math.min(this.freqData.length, 512);
    for (let i = 1; i < n; i++) sum += this.freqData[i] / 255;
    return sum / Math.max(1, n - 1);
  }

  // simulated bands for idle
  private simBands = [0, 0, 0, 0, 0];
  private simBand(i: number) {
    return this.simBands[i] ?? 0;
  }

  private simulateIdle(dt: number) {
    this.idleTime += dt;
    const t = this.idleTime;
    // fake kick every 0.5s
    if (t >= this.idleNextKick) {
      this.idleNextKick = t + 0.5;
      this.simKick = 1;
    }
    this.simKick *= Math.exp(-dt * 7);
    const wob = (f: number, p: number) => 0.5 + 0.5 * Math.sin(t * f + p);
    this.simBands[0] = Math.min(1, 0.18 + this.simKick * 0.72 + wob(1.7, 0) * 0.08);
    this.simBands[1] = Math.min(1, 0.14 + this.simKick * 0.3 + wob(2.3, 1.4) * 0.16);
    this.simBands[2] = Math.min(1, 0.1 + wob(3.1, 2.2) * 0.2 + this.simKick * 0.12);
    this.simBands[3] = Math.min(1, 0.08 + wob(4.7, 0.6) * 0.18);
    this.simBands[4] = Math.min(1, 0.06 + wob(6.3, 3.1) * 0.14);
    // fake spectrum curve for the strip
    const n = this.freqData.length;
    for (let i = 0; i < n; i++) {
      const x = i / n;
      const env = Math.exp(-x * 5.2) * 0.9 + Math.exp(-Math.pow((x - 0.18) * 9, 2)) * 0.35;
      const ripple = 0.75 + 0.25 * Math.sin(i * 0.32 + t * 7) * Math.sin(i * 0.071 - t * 3.4);
      const v = Math.min(1, env * ripple * (0.55 + this.simKick * 0.9 + wob(2.1, i * 0.01) * 0.25));
      this.freqData[i] = Math.round(v * 255);
    }
    const m = this.timeData.length;
    for (let i = 0; i < m; i++) {
      const ph = (i / m) * Math.PI * 2;
      const v = Math.sin(ph * 3 + t * 9) * 0.4 + Math.sin(ph * 7 - t * 14) * 0.22 * this.simKick + Math.sin(ph * 23 + t * 31) * 0.08;
      this.timeData[i] = Math.round(128 + v * 90);
    }
  }
  private simKick = 0;

  getLevels(): BandLevels {
    const bass = this.readBand(0);
    const lowMid = this.readBand(1);
    const mid = this.readBand(2);
    const highMid = this.readBand(3);
    const treble = this.readBand(4);
    const energy = Math.min(1, bass * 0.42 + lowMid * 0.22 + mid * 0.18 + highMid * 0.1 + treble * 0.08);
    let rms = 0;
    if (this.liveInput || this.offlineData) {
      const m = Math.min(this.timeData.length, 2048);
      let s = 0;
      for (let i = 0; i < m; i += 2) {
        const v = (this.timeData[i] - 128) / 128;
        s += v * v;
      }
      rms = Math.sqrt(s / (m / 2));
    } else {
      rms = 0.12 + this.simKick * 0.4;
    }
    return { bass, lowMid, mid, highMid, treble, energy, rms, beat: this.beatFlag, beatPulse: this.beatPulse };
  }
}

export const audioEngine = new AudioEngine();
