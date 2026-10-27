import { getCtx } from './audio.js';

// Everything for demoing the app without a real chirping detector.

const TONE_HZ = 3100; // where real smoke detectors beep

// One beep at the given loudness (0 to 1), through the phone or laptop speaker.
function beep(ctx, when, seconds, gain) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = TONE_HZ;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(gain, when + 0.01);
  g.gain.setValueAtTime(gain, when + seconds - 0.02);
  g.gain.linearRampToValueAtTime(0, when + seconds);
  osc.connect(g).connect(ctx.destination);
  osc.start(when);
  osc.stop(when + seconds + 0.02);
  return osc;
}

// Five chirps that get louder, like walking toward a detector. The microphone
// hears these for real, so the whole detection path is exercised.
export async function playPracticeChirps() {
  const ctx = getCtx();
  if (ctx.state === 'suspended') await ctx.resume();
  const t0 = ctx.currentTime + 1.2;
  [0.08, 0.16, 0.3, 0.55, 0.95].forEach((gain, i) => beep(ctx, t0 + i * 2.4, 0.16, gain));
  return 1.2 + 4 * 2.4 + 0.5;
}

// The standard three-beep smoke alarm pattern, used for the test demo.
export async function playTestAlarm() {
  const ctx = getCtx();
  if (ctx.state === 'suspended') await ctx.resume();
  const t0 = ctx.currentTime + 0.3;
  for (let i = 0; i < 3; i++) beep(ctx, t0 + i * 1.0, 0.5, 0.9);
}

// Stands in for the microphone: scripted readings, no sound needed. It has the
// same read() and stop() as Listener, so the screens cannot tell the difference.
export class ScriptedListener {
  // plan: chirp strengths in dB above the room, played one every `gap` ms.
  // alarm: when set, one steady loud tone starting at that many ms.
  constructor({ chirps = [], gap = 2200, first = 1500, alarmAt = null, alarmMs = 1800 } = {}) {
    this.t0 = performance.now();
    this.chirps = chirps;
    this.gap = gap;
    this.first = first;
    this.alarmAt = alarmAt;
    this.alarmMs = alarmMs;
  }

  async start() {}

  read() {
    const t = performance.now() - this.t0;
    const noise = -80 + (Math.random() - 0.5) * 2;
    let over = 0;
    const k = Math.floor((t - this.first) / this.gap);
    if (k >= 0 && k < this.chirps.length && (t - this.first) % this.gap < 160) over = this.chirps[k];
    if (this.alarmAt !== null && t >= this.alarmAt && t < this.alarmAt + this.alarmMs) over = 60;
    if (over) return { level: noise + over, tonal: 30, peakHz: TONE_HZ };
    return { level: noise, tonal: 4, peakHz: 0 };
  }

  stop() {}
}

// A walk toward a detector: each chirp louder than the last.
export const walkThrough = () => new ScriptedListener({ chirps: [20, 28, 36, 45, 56] });
