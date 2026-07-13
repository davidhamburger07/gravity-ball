// AudioManager.js — procedural sound effects via the Web Audio API. No audio assets required:
// every SFX is synthesized from oscillators + gain envelopes, so the game ships self-contained
// and works offline. Mute state persists in localStorage. The AudioContext is created lazily and
// resumed inside the input gesture that triggers the first sound (browser autoplay policy).
const MUTE_KEY = 'gravityball:muted';

class AudioManagerImpl {
  constructor() {
    this.ctx = null;
    this.muted = typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1';
  }

  _ctxOrNull() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      return this.ctx;
    } catch {
      return null;
    }
  }

  // One enveloped oscillator "blip". freqTo (optional) sweeps the pitch for whooshes/thuds.
  _tone({ freq = 440, type = 'sine', dur = 0.12, gain = 0.16, freqTo = null, delay = 0 }) {
    if (this.muted) return;
    const ctx = this._ctxOrNull();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  shift() { this._tone({ type: 'triangle', freq: 300, freqTo: 640, dur: 0.14, gain: 0.12 }); }
  bounce(strength = 1) {
    const f = 170 + Phaser.Math.Clamp(strength, 0, 1) * 240;
    this._tone({ type: 'sine', freq: f, freqTo: f * 0.6, dur: 0.12, gain: 0.15 });
  }
  death() { this._tone({ type: 'sawtooth', freq: 320, freqTo: 60, dur: 0.34, gain: 0.16 }); }
  stick() { this._tone({ type: 'sine', freq: 200, dur: 0.08, gain: 0.12 }); }
  key() { [660, 990].forEach((f, i) => this._tone({ type: 'triangle', freq: f, dur: 0.1, gain: 0.13, delay: i * 0.06 })); }
  smash() { this._tone({ type: 'square', freq: 140, freqTo: 50, dur: 0.16, gain: 0.18 }); }
  portal() { this._tone({ type: 'sine', freq: 500, freqTo: 900, dur: 0.14, gain: 0.12 }); }
  swap() { this._tone({ type: 'square', freq: 360, dur: 0.05, gain: 0.09 }); this._tone({ type: 'square', freq: 540, dur: 0.05, gain: 0.09, delay: 0.05 }); }
  deny() { this._tone({ type: 'square', freq: 130, freqTo: 90, dur: 0.12, gain: 0.1 }); }
  win() {
    [523, 659, 784, 1047].forEach((f, i) =>
      this._tone({ type: 'triangle', freq: f, dur: 0.16, gain: 0.14, delay: i * 0.09 })
    );
  }
  ui() { this._tone({ type: 'square', freq: 460, dur: 0.05, gain: 0.05 }); }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0'); } catch { /* ignore */ }
    return this.muted;
  }
}

export const AudioManager = new AudioManagerImpl();
