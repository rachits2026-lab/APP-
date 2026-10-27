// Microphone analysis. Nothing is recorded: samples pass through an
// AnalyserNode, are reduced to two numbers, and are dropped.

const BAND_LO = 2000;
const BAND_HI = 5000;

export class Listener {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.freq = null;
    this.binHz = 0;
    this.lo = 0;
    this.hi = 0;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0;
    src.connect(this.analyser);
    this.freq = new Float32Array(this.analyser.frequencyBinCount);
    this.binHz = this.ctx.sampleRate / this.analyser.fftSize;
    this.lo = Math.floor(BAND_LO / this.binHz);
    this.hi = Math.ceil(BAND_HI / this.binHz);
  }

  // level: loudest bin in the alarm band, in dB (about -100 to 0).
  // tonal: how far that peak stands above the band median, in dB. Alarms are
  // one sharp tone; speech and room noise are not.
  read() {
    this.analyser.getFloatFrequencyData(this.freq);
    let peak = -Infinity;
    let peakBin = this.lo;
    const band = [];
    for (let i = this.lo; i <= this.hi; i++) {
      const v = this.freq[i];
      band.push(v);
      if (v > peak) { peak = v; peakBin = i; }
    }
    band.sort((a, b) => a - b);
    const median = band[band.length >> 1];
    return { level: peak, tonal: peak - median, peakHz: peakBin * this.binHz };
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.stream = this.ctx = this.analyser = null;
  }
}

export function micErrorText(err) {
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'This browser cannot reach the microphone. Open the app over https in Safari or Chrome.';
  }
  if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
    return 'Microphone access was blocked. Allow it in your browser settings for this site, then try again.';
  }
  if (err && err.name === 'NotFoundError') return 'No microphone was found on this device.';
  return 'The microphone could not be started.';
}

// Tracks the noise floor and turns raw readings into chirp events.
export class ChirpDetector {
  constructor({ margin = 14, minTonal = 14 } = {}) {
    this.margin = margin;
    this.minTonal = minTonal;
    this.floor = null;
    this.active = false;
    this.peak = -Infinity;
    this.startedAt = 0;
    this.lastOn = 0;
  }

  // Feed one reading. Returns { peak, floor, ms } when a chirp has just ended.
  push(r, now) {
    if (this.floor === null) this.floor = r.level;
    const loud = r.level > this.floor + this.margin && r.tonal > this.minTonal;
    if (loud) {
      if (!this.active) { this.active = true; this.peak = r.level; this.startedAt = now; }
      this.peak = Math.max(this.peak, r.level);
      this.lastOn = now;
      return null;
    }
    // Floor drops quickly and rises slowly, so a chirp does not raise it.
    const k = r.level < this.floor ? 0.2 : 0.01;
    this.floor += (r.level - this.floor) * k;
    if (this.active && now - this.lastOn > 120) {
      this.active = false;
      const ms = this.lastOn - this.startedAt;
      // Detector chirps last roughly 50 to 400 ms. Much longer is a steady
      // sound, much shorter is a click.
      if (ms >= 25 && ms <= 900) return { peak: this.peak, floor: this.floor, ms };
    }
    return null;
  }
}

// Map a chirp's loudness over the floor to a 0..100 meter value.
export function meterValue(peak, floor) {
  const over = peak - floor;
  return Math.max(0, Math.min(100, ((over - 14) / 36) * 100));
}

export function buzz(pattern) {
  try { navigator.vibrate?.(pattern); } catch {}
}
