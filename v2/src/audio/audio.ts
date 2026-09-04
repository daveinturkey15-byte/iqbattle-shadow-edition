/**
 * audio.ts — v2 procedural audio CORE: lazy context, mute gate, SFX registry,
 * and the shared WebAudio voice helpers that beds.ts builds on.
 *
 * Port of frozen-v1 `audio.js` patterns (mechanic, not code). Zero assets:
 * every sound is oscillators/noise/waveshaper synthesis.
 *
 * Exports (for main.ts / scenes):
 *   initAudio()      — idempotent; ALSO self-binds a one-shot `pointerdown`
 *                      listener, so the AudioContext is only ever CREATED on
 *                      (or after) a real user gesture. Safe to call early.
 *   setMuted(b)      — writes IQB_MUTED localStorage + ramps master gain.
 *   setVolume(v)     — writes IQB_VOL (0..1, clamped) + ramps master gain.
 *   getVolume()      — current volume preference (default VOLUME_DEFAULT).
 *   sfx(name, opts?) — procedural one-shots, every voice <= 900 ms,
 *                      per-name throttle + concurrent-voice caps.
 *   isMuted()        — current gate state.
 *   onAudioReady(cb) — fires once when the graph first exists (beds.ts uses
 *                      this to start the pending alignment bed).
 *   onAudioPrefChange(cb) — fires after mute OR volume changes, whether from
 *                      setMuted/setVolume here or picked up by the poll from
 *                      another tab. Returns an unsubscribe. scenes/volume.ts
 *                      redraws off this.
 *
 * Fairness / rails:
 *  - Master gain HARD-CAPPED at MASTER_CAP = 0.15. The IQB_VOL preference
 *    MULTIPLIES the cap (master = muted ? 0 : MASTER_CAP * volume), so the
 *    slider can only ever go down from the ceiling. Default 0.5 = half of the
 *    pre-slider level (owner ask 2026-09-04: "half the volume").
 *  - IQB_MUTED and IQB_VOL are read at init and re-polled every 400 ms; while
 *    muted, sfx() schedules NOTHING and master sits at 0 -> zero output
 *    guaranteed twice, whatever the slider says.
 *  - Determinism: no Math.random / Date.now anywhere in this module. All
 *    stochastic texture (noise buffer fill, glitch blips) comes from an own
 *    mulberry32 — same algorithm as scenes/takeovers/redlight.ts, mirrored
 *    here to keep this module Pixi-free and runnable under plain node.
 * ========================================================================*/

/** Hard ceiling on the master bus. Everything routes through this. */
export const MASTER_CAP = 0.15;
/** Shipped IQB_VOL when the user has never touched the slider. */
export const VOLUME_DEFAULT = 0.5;

const POLL_MS = 400;
const GLOBAL_VOICE_CAP = 28;

export type SfxName =
  | 'chime' | 'click' | 'tick' | 'heart' | 'glitch'
  | 'scream' | 'levelup' | 'sacrifice' | 'zap' | 'laugh';

export const SFX_NAMES: readonly SfxName[] = [
  'chime', 'click', 'tick', 'heart', 'glitch',
  'scream', 'levelup', 'sacrifice', 'zap', 'laugh',
];

/** Per-name admission policy. minGap is in SECONDS of ctx clock. */
const POLICY: Record<SfxName, { minGap: number; maxVoices: number }> = {
  chime:     { minGap: 0.12, maxVoices: 3 },
  click:     { minGap: 0.04, maxVoices: 6 },
  tick:      { minGap: 0.03, maxVoices: 8 },
  heart:     { minGap: 0.18, maxVoices: 4 },
  glitch:    { minGap: 0.15, maxVoices: 3 },
  scream:    { minGap: 6.0,  maxVoices: 1 },  // losing scream: long cooldown
  levelup:   { minGap: 0.25, maxVoices: 2 },
  sacrifice: { minGap: 0.80, maxVoices: 2 },
  zap:       { minGap: 0.05, maxVoices: 8 },
  laugh:     { minGap: 0.90, maxVoices: 2 },
};

/* ------------------------------------------------------------------ */
/* PRNG + prefs                                                        */
/* ------------------------------------------------------------------ */

/** mulberry32 — mirrors scenes/takeovers/redlight.ts (the one PRNG in v2). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shared stochastic stream for SFX texture (deterministic given play order). */
const sfxRng = mulberry32(0xa0d10f1);

function readMutedPref(): boolean {
  try {
    const v = globalThis.localStorage?.getItem('IQB_MUTED');
    return v != null && JSON.parse(v) === true;
  } catch {
    return false;
  }
}

function clampVolume(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : VOLUME_DEFAULT;
}

/** IQB_VOL: number 0..1; absent / unparsable -> VOLUME_DEFAULT. */
function readVolumePref(): number {
  try {
    const v = globalThis.localStorage?.getItem('IQB_VOL');
    if (v == null) return VOLUME_DEFAULT;
    const n = Number(JSON.parse(v));
    return clampVolume(n);
  } catch {
    return VOLUME_DEFAULT;
  }
}

/** IQB_MOTION equivalent — ambient LFO flavour gates on this. */
export function motionEnabled(): boolean {
  try {
    const v = globalThis.localStorage?.getItem('IQB_MOTION');
    return v == null ? true : JSON.parse(v) !== false;
  } catch {
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* Core state                                                          */
/* ------------------------------------------------------------------ */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = readMutedPref();
let volume = readVolumePref();
/** setInterval handle shape across node/browser lib combos. */
type IntervalHandle = NodeJS.Timeout | number;

let pollTimer: IntervalHandle | null = null;
let gestureBound = false;
const readyCbs: Array<() => void> = [];
let firedReady = false;
const prefCbs = new Set<() => void>();

/** Master bus target for the current prefs. Mute wins over the slider. */
function masterTarget(): number {
  return muted ? 0 : MASTER_CAP * volume;
}

function notifyPrefs(): void {
  for (const cb of prefCbs) {
    try { cb(); } catch { /* a listener must not break the audio core */ }
  }
}

/** Graph accessor — null until a user gesture created the context. */
export function audioGraph(): { ctx: AudioContext; master: GainNode } | null {
  return ctx && master ? { ctx, master } : null;
}

export function isMuted(): boolean {
  return muted;
}

export function getVolume(): number {
  return volume;
}

/** Subscribe to mute/volume changes (local or cross-tab). Returns unsubscribe. */
export function onAudioPrefChange(cb: () => void): () => void {
  prefCbs.add(cb);
  return () => { prefCbs.delete(cb); };
}

export function onAudioReady(cb: () => void): void {
  if (firedReady) cb();
  else readyCbs.push(cb);
}

function audioCtor(): (typeof AudioContext) | null {
  const g = globalThis as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  try {
    return g.AudioContext ?? g.webkitAudioContext ?? null;
  } catch {
    return null;
  }
}

function bindGestureOnce(): void {
  if (gestureBound || typeof document === 'undefined') return;
  gestureBound = true;
  document.addEventListener('pointerdown', () => { ensureCtx(); }, { once: true });
}

/** Create/resume the context. Idempotent; the ONLY place ctx is created. */
function ensureCtx(): boolean {
  bindGestureOnce();
  if (ctx) {
    try { if (ctx.state === 'suspended') void ctx.resume().catch(() => {}); } catch { /* noop */ }
    return true;
  }
  const AC = audioCtor();
  if (!AC) return false;
  try {
    muted = readMutedPref(); // gate checked at INIT, not just module load
    volume = readVolumePref();
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = masterTarget();
    master.connect(ctx.destination);
    startPoll();
    firedReady = true;
    for (const cb of readyCbs.splice(0)) {
      try { cb(); } catch { /* listeners must not break init */ }
    }
    return true;
  } catch {
    ctx = null;
    master = null;
    return false;
  }
}

function startPoll(): void {
  if (pollTimer) return;
  pollTimer = every(POLL_MS, () => {
    /* Both prefs re-read on the same clock, so a second tab that moves the
     * slider or hits mute is picked up here the same way. */
    const m = readMutedPref();
    const v = readVolumePref();
    if (m === muted && v === volume) return;
    muted = m;
    volume = v;
    applyMaster();
    notifyPrefs();
  });
}

/** setInterval that never keeps node alive during self-tests. */
function every(ms: number, fn: () => void): IntervalHandle {
  const t = setInterval(fn, ms);
  const r = t as unknown as { unref?: () => void };
  if (typeof r.unref === 'function') r.unref();
  return t;
}

/** Ramp the master bus to masterTarget() — one 80 ms time constant, no clicks. */
function applyMaster(): void {
  if (!ctx || !master) return;
  try {
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setTargetAtTime(masterTarget(), t, 0.08);
  } catch { /* noop */ }
}

/** Public API — Main calls this from (or before) the first pointerdown. */
export function initAudio(): boolean {
  return ensureCtx();
}

export function setMuted(b: boolean): void {
  muted = !!b;
  try { globalThis.localStorage?.setItem('IQB_MUTED', JSON.stringify(!!b)); } catch { /* noop */ }
  applyMaster();
  notifyPrefs();
}

/** Set the volume preference (clamped 0..1), persist it, ramp the master bus. */
export function setVolume(v: number): void {
  volume = clampVolume(v);
  try { globalThis.localStorage?.setItem('IQB_VOL', JSON.stringify(volume)); } catch { /* noop */ }
  applyMaster();
  notifyPrefs();
}

/** @internal test seam — clears the mute-poll interval. */
export function stopAudioClocks(): void {
  if (pollTimer === null) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

/* ------------------------------------------------------------------ */
/* Shared voice helpers (also consumed by beds.ts)                     */
/* ------------------------------------------------------------------ */

/** Percussive envelope gain routed into `dest`. endOff = seconds to silence. */
export function envGain(
  c: AudioContext, dest: AudioNode, vol: number, t0: number, att: number, endOff: number,
): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t0 + Math.max(0.001, att));
  if (endOff > att) g.gain.exponentialRampToValueAtTime(0.0001, t0 + endOff);
  g.connect(dest);
  return g;
}

/** Oscillator with its start frequency pinned; caller connects/start/stops. */
export function toneOsc(c: AudioContext, type: OscillatorType, freq: number, t0: number): OscillatorNode {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  return o;
}

export function lowpassFilter(c: AudioContext, freq: number, q?: number): BiquadFilterNode {
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  f.Q.value = q ?? 0.7;
  return f;
}

/** Cheap bitcrush-flavoured quantising waveshaper (v1 recipe). */
export function crushShaper(c: AudioContext, steps: number): WaveShaperNode {
  const ws = c.createWaveShaper();
  const n = 256;
  const curve = new Float32Array(n);
  const q = Math.max(2, Math.round(steps));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.round(x * q) / q;
  }
  ws.curve = curve;
  ws.oversample = 'none';
  return ws;
}

const noiseCache = new WeakMap<AudioContext, AudioBuffer>();

/** Shared 2s white-noise buffer, filled from the seeded PRNG (no Math.random). */
export function sharedNoise(c: AudioContext): AudioBuffer {
  const hit = noiseCache.get(c);
  if (hit && hit.sampleRate === c.sampleRate) return hit;
  const len = Math.floor(c.sampleRate * 2);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  const rng = mulberry32(0x40155eed);
  for (let i = 0; i < len; i++) d[i] = rng() * 2 - 1;
  noiseCache.set(c, buf);
  return buf;
}

/** Looping or finite noise source off the shared buffer. */
export function noiseSource(c: AudioContext, t0: number, dur: number, loop?: boolean): AudioBufferSourceNode {
  const s = c.createBufferSource();
  s.buffer = sharedNoise(c);
  s.loop = !!loop;
  if (loop || !(dur > 0)) s.start(t0);
  else { s.start(t0); s.stop(t0 + dur); }
  return s;
}

/* ------------------------------------------------------------------ */
/* One-shots — every voice <= 900 ms                                   */
/* ------------------------------------------------------------------ */

/** Each generator schedules at absolute time t0 and returns its END OFFSET. */
type SfxFn = (c: AudioContext, dest: AudioNode, t0: number, vol: number, rate: number) => number;

const SFX: Record<SfxName, SfxFn> = {
  // fake-cheerful corporate arpeggio (C-E-G-C), v1 recipe
  chime(c, dest, t0, v, r) {
    const step = Math.min(0.09, 0.09 / r);
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const t = t0 + i * step;
      const g = envGain(c, dest, v * 0.32, t, 0.01, 0.51);
      for (const [k, mult] of [[0, 1], [1, 2.01]] as const) {
        const os = toneOsc(c, k ? 'sine' : 'triangle', f * mult * r, t);
        os.connect(g);
        os.start(t);
        os.stop(t + 0.52);
      }
    });
    return step * 3 + 0.55;
  },

  click(c, dest, t0, v, r) {
    const g = envGain(c, dest, v * 0.5, t0, 0.002, Math.min(0.08, 0.08 / r));
    const sq = toneOsc(c, 'square', 1400 * r, t0);
    sq.frequency.exponentialRampToValueAtTime(700 * r, t0 + 0.06);
    sq.connect(g);
    sq.start(t0);
    sq.stop(t0 + 0.1);
    return 0.1;
  },

  tick(c, dest, t0, v, r) {
    const g = envGain(c, dest, v * 0.35, t0, 0.001, 0.05);
    const os = toneOsc(c, 'square', 2400 * r, t0);
    os.connect(g);
    os.start(t0);
    os.stop(t0 + 0.05);
    return 0.05;
  },

  // single heartbeat thump (lub) + body knock
  heart(c, dest, t0, v, r) {
    const g = envGain(c, dest, v, t0, 0.01, 0.28);
    const os = toneOsc(c, 'sine', 65 * r, t0);
    os.frequency.exponentialRampToValueAtTime(38 * r, t0 + 0.22);
    os.connect(g);
    os.start(t0);
    os.stop(t0 + 0.3);
    const ng = envGain(c, dest, v * 0.25, t0, 0.005, 0.09);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 150;
    bp.Q.value = 2;
    noiseSource(c, t0, 0.1).connect(bp);
    bp.connect(ng);
    return 0.3;
  },

  // bitcrush-y burst of seeded blips (v1 used Math.random; v2 is seeded)
  glitch(c, dest, t0, v, r) {
    const g = envGain(c, dest, v * 0.5, t0, 0.002, 0.3);
    const cr = crushShaper(c, 6);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 800;
    cr.connect(hp);
    hp.connect(g);
    for (let i = 0; i < 10; i++) {
      const t = t0 + sfxRng() * 0.22;
      const os = toneOsc(c, sfxRng() < 0.5 ? 'square' : 'sawtooth', 200 + sfxRng() * 3500, t);
      os.connect(cr);
      os.start(t);
      os.stop(t + 0.03);
    }
    const ng = envGain(c, dest, v * 0.25, t0, 0.002, 0.15);
    noiseSource(c, t0, 0.15).connect(ng);
    return 0.28;
  },

  // losing scream: descending distorted shriek, clamped <= 850 ms
  scream(c, dest, t0, v, r) {
    const dur = Math.min(0.85, 0.85 / Math.max(r, 0.001));
    const g = envGain(c, dest, v * 0.7, t0, 0.03, dur);
    const cr = crushShaper(c, 10);
    cr.connect(g);
    ([880, 1245] as const).forEach((f, i) => {
      const os = toneOsc(c, i ? 'square' : 'sawtooth', f * r, t0);
      os.frequency.exponentialRampToValueAtTime(f * 0.18 * r, t0 + dur);
      const vib = toneOsc(c, 'sine', 9 * r, t0);
      const vg = c.createGain();
      vg.gain.value = 40 * r;
      vib.connect(vg);
      vg.connect(os.frequency);
      vib.start(t0);
      vib.stop(t0 + dur);
      os.connect(cr);
      os.start(t0);
      os.stop(t0 + dur);
    });
    const hg = envGain(c, dest, v * 0.2, t0, 0.05, dur);
    const hpf = c.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 2000;
    noiseSource(c, t0, dur).connect(hpf);
    hpf.connect(hg);
    return dur;
  },

  // level-up fanfare: rising major-pentatonic arp with sparkle octave
  levelup(c, dest, t0, v, r) {
    const step = Math.min(0.08, 0.08 / r);
    [523.25, 587.33, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const t = t0 + i * step;
      const g = envGain(c, dest, v * 0.3, t, 0.008, 0.44);
      for (const [k, mult] of [[0, 1], [1, 2]] as const) {
        const os = toneOsc(c, k ? 'sine' : 'triangle', f * mult * r, t);
        os.connect(g);
        os.start(t);
        os.stop(t + 0.46);
      }
    });
    return step * 4 + 0.47;
  },

  // dark ritual gong: inharmonic partials, compressed to <= 850 ms (v1 rang 3.6s)
  sacrifice(c, dest, t0, v) {
    const partials = [72, 108.5, 151, 197.3, 262.7];
    partials.forEach((f, i) => {
      const rel = Math.max(0.3, 0.8 - i * 0.12);
      const g = envGain(c, dest, (v * 0.3) / (i + 1.5), t0, 0.02, rel);
      const os = toneOsc(c, i % 2 ? 'triangle' : 'sine', f, t0);
      os.frequency.linearRampToValueAtTime(f * 0.985, t0 + rel);
      os.connect(g);
      os.start(t0);
      os.stop(t0 + rel + 0.04);
    });
    const ng = envGain(c, dest, v * 0.3, t0, 0.003, 0.25);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 600;
    bp.Q.value = 1;
    noiseSource(c, t0, 0.3).connect(bp);
    bp.connect(ng);
    const sg = envGain(c, dest, v * 0.5, t0, 0.05, 0.55);
    const sub = toneOsc(c, 'sine', 36, t0);
    sub.connect(sg);
    sub.start(t0);
    sub.stop(t0 + 0.6);
    return 0.85;
  },

  // zappy chirp: fast upward square sweep through light crush
  zap(c, dest, t0, v) {
    const g = envGain(c, dest, v * 0.4, t0, 0.003, 0.12);
    const cr = crushShaper(c, 8);
    cr.connect(g);
    const os = toneOsc(c, 'square', 520, t0);
    os.frequency.exponentialRampToValueAtTime(1560, t0 + 0.09);
    os.connect(cr);
    os.start(t0);
    os.stop(t0 + 0.12);
    return 0.12;
  },

  // evil layered laugh synth: pitched descending "ha" pulses (tightened <= 850 ms)
  laugh(c, dest, t0, v, r) {
    const base = 220 * r;
    for (let layer = 0; layer < 3; layer++) {
      const detune = 1 - layer * 0.13;
      for (let i = 0; i < 6; i++) {
        const t = t0 + i * 0.115 + layer * 0.03;
        const f = base * detune * Math.pow(0.92, i);
        const g = envGain(c, dest, v * 0.22 * (1 - layer * 0.25), t, 0.02, 0.15);
        const os = toneOsc(c, 'sawtooth', f, t);
        os.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.12);
        const lp = lowpassFilter(c, 900, 4);
        os.connect(lp);
        lp.connect(g);
        os.start(t);
        os.stop(t + 0.17);
      }
    }
    return 0.85;
  },
};

/* ------------------------------------------------------------------ */
/* Admission control                                                   */
/* ------------------------------------------------------------------ */

// Scheduled end times per name (ctx clock); pruned on every sfx() call.
const liveEnds: Partial<Record<SfxName, number[]>> = {};
const lastStart: Partial<Record<SfxName, number>> = {};

function pruneVoices(nowT: number): number {
  let total = 0;
  for (const name of SFX_NAMES) {
    const ends = liveEnds[name];
    if (!ends) continue;
    const kept = ends.filter((e) => e > nowT - 0.02);
    if (kept.length) liveEnds[name] = kept;
    else delete liveEnds[name];
    total += kept.length;
  }
  return total;
}

/* ------------------------------------------------------------------ */
/* Public play API                                                     */
/* ------------------------------------------------------------------ */

export interface SfxOpts { vol?: number; rate?: number }

/**
 * Play a named one-shot. No-throw; returns false when the name is unknown,
 * audio is unavailable, the mute gate is closed (nothing is scheduled), or a
 * per-name throttle / voice cap rejects the request.
 */
export function sfx(name: SfxName, opts?: SfxOpts): boolean {
  const fn = SFX[name];
  if (!fn) return false;
  if (muted) return false;                       // zero output: nothing scheduled
  const g = audioGraph();
  if (!g) return false;
  try {
    if (g.ctx.state === 'suspended') void g.ctx.resume().catch(() => {});
    const nowT = g.ctx.currentTime;
    const total = pruneVoices(nowT);
    const pol = POLICY[name];
    const prevStart = lastStart[name];
    if (prevStart != null && nowT - prevStart < pol.minGap) return false;
    const mine = liveEnds[name];
    if (mine && mine.length >= pol.maxVoices) return false;
    if (total >= GLOBAL_VOICE_CAP) return false;
    const vol = Math.min(1, Math.max(0.0001, opts?.vol ?? 1));
    const rate = Math.max(0.05, opts?.rate ?? 1);
    const t0 = nowT + 0.005;
    const endOff = fn(g.ctx, g.master, t0, vol, rate);
    liveEnds[name] = [...(liveEnds[name] ?? []), t0 + endOff];
    lastStart[name] = t0;
    return true;
  } catch {
    return false;
  }
}

