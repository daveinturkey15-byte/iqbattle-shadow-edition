/**
 * sfx2.ts — v2 audio EXTENSION pack: the deeper v1 identity one-shots plus
 * the ember-crackle ambience bus, consumed by director.ts (act-reactive
 * layers live there; this module only synthesises voices).
 *
 * Port of frozen-v1 `audio.js` identity mechanics (mechanic, not code):
 *   win      — correct-reveal rising major arpeggio (C5 E5 G5 C6). The
 *              director raises `rate` with the streak so hot runs jingle
 *              brighter and faster.
 *   lose     — wrong-reveal falling saw pair through the v1 bitcrush shaper.
 *   fanfare  — Chaos-Emerald pickup: saw+triangle octave stack through a
 *              sweeping lowpass with a sparkle tail.
 *   cascade  — corruption stinger: seeded random blips through a coarse crush
 *              bus plus a noise tick (glitch cascade).
 *   chatter  — demon chatter burst: low square blips with downward glides.
 *
 * Rails:
 *  - Every ONE-SHOT is <= 900 ms. Only the ember crackle LOOP is continuous.
 *  - Master cap is inherited: every voice routes into audioGraph().master,
 *    which audio.ts hard-caps at MASTER_CAP = 0.15; per-voice gains here stay
 *    <= 0.5 on top of that.
 *  - Mute gate: while IQB_MUTED is set, playSfx2() schedules NOTHING and
 *    emberCrackle(false) tears the loop down.
 *  - Determinism: all stochastic texture comes from OWN mulberry32 streams
 *    (fixed seeds) — no Math.random / Date.now anywhere.
 *  - Admission control mirrors audio.ts sfx() but keeps its OWN registries,
 *    so this pack never fights audio.ts's throttle windows.
 * ========================================================================*/

import {
  audioGraph, isMuted, motionEnabled, mulberry32,
  envGain, toneOsc, lowpassFilter, crushShaper, noiseSource,
} from './audio.ts';

export type Sfx2Name = 'win' | 'lose' | 'fanfare' | 'cascade' | 'chatter';

export const SFX2_NAMES: readonly Sfx2Name[] = ['win', 'lose', 'fanfare', 'cascade', 'chatter'];

/** Per-name admission policy. minGap in SECONDS of ctx clock. */
const POLICY2: Record<Sfx2Name, { minGap: number; maxVoices: number }> = {
  win:     { minGap: 0.30, maxVoices: 1 },
  lose:    { minGap: 0.40, maxVoices: 1 },
  fanfare: { minGap: 1.20, maxVoices: 1 },   // emerald pickup: rare by design
  cascade: { minGap: 2.50, maxVoices: 1 },   // corruption stinger spacing
  chatter: { minGap: 8.00, maxVoices: 1 },   // demon chatter budget: 1 burst / 8 s
};

/* ------------------------------------------------------------------ */
/* One-shots — every generator <= 900 ms                               */
/* ------------------------------------------------------------------ */

/** Each generator schedules at absolute t0 and returns its END OFFSET (s). */
type Sfx2Fn = (c: AudioContext, dest: AudioNode, t0: number, vol: number, rate: number) => number;

const SFX2: Record<Sfx2Name, Sfx2Fn> = {
  // correct reveal: rising major arpeggio, streak scales rate (v1 recipe)
  win(c, dest, t0, v, r) {
    const step = Math.min(0.09, 0.09 / Math.max(0.7, r));
    let end = 0;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const t = t0 + i * step;
      const g = envGain(c, dest, v * 0.32, t, 0.01, i * step + 0.34);
      const o = toneOsc(c, 'triangle', f, t);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.38);
      end = Math.max(end, i * step + 0.38);
    });
    return Math.min(0.9, end); // ~0.65 s at rate 1
  },

  // wrong reveal: harsh falling saws through the bitcrush (v1 buzz recipe)
  lose(c, dest, t0, v) {
    const g = envGain(c, dest, v * 0.4, t0, 0.008, 0.55);
    const cr = crushShaper(c, 12);
    cr.connect(g);
    const o1 = toneOsc(c, 'sawtooth', 329.63, t0);   // E4
    o1.frequency.exponentialRampToValueAtTime(116.54, t0 + 0.5); // Bb3-ish fall
    o1.connect(cr);
    o1.start(t0);
    o1.stop(t0 + 0.56);
    const o2 = toneOsc(c, 'sawtooth', 164.81, t0);   // E3 weight
    o2.frequency.exponentialRampToValueAtTime(58.27, t0 + 0.5);
    o2.connect(cr);
    o2.start(t0);
    o2.stop(t0 + 0.56);
    return 0.58;
  },

  // Chaos-Emerald pickup fanfare: bright octave stack + sweeping lowpass
  fanfare(c, dest, t0, v) {
    const lp = lowpassFilter(c, 700, 1.2);
    lp.frequency.setValueAtTime(700, t0);
    lp.frequency.exponentialRampToValueAtTime(4200, t0 + 0.35);
    const g = envGain(c, dest, v * 0.42, t0, 0.02, 0.82);
    lp.connect(g);
    [523.25, 783.99, 1046.5].forEach((f, i) => {
      const t = t0 + i * 0.11;
      const a = toneOsc(c, 'sawtooth', f, t);
      const b = toneOsc(c, 'triangle', f * 2, t);
      for (const o of [a, b]) {
        o.connect(lp);
        o.start(t);
        o.stop(t + 0.62);
      }
    });
    const sp = toneOsc(c, 'sine', 2093, t0 + 0.36);  // sparkle tail
    const sg = envGain(c, dest, v * 0.15, t0 + 0.36, 0.01, 0.3);
    sp.connect(sg);
    sp.start(t0 + 0.36);
    sp.stop(t0 + 0.72);
    return 0.86;
  },

  // corruption glitch cascade: seeded blips through a coarse crush bus
  cascade(c, dest, t0, v) {
    const rng = mulberry32(0xca5cad3);
    const g = envGain(c, dest, v * 0.35, t0, 0.004, 0.42);
    const cr = crushShaper(c, 5);
    cr.connect(g);
    for (let i = 0; i < 7; i++) {
      const f = 220 + rng() * 2300;
      const t = t0 + i * (0.032 + rng() * 0.02);
      const o = toneOsc(c, 'square', f, t);
      o.connect(cr);
      o.start(t);
      o.stop(t + 0.03);
    }
    const nz = noiseSource(c, t0, 0.09);
    const ng = envGain(c, dest, v * 0.22, t0, 0.003, 0.09);
    nz.connect(ng);
    return 0.45;
  },

  // demon chatter burst: low square blips with downward glides
  chatter(c, dest, t0, v) {
    const rng = mulberry32(0xdea110c);
    const g = envGain(c, dest, v * 0.3, t0, 0.006, 0.5);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 300;
    bp.Q.value = 2;
    bp.connect(g);
    let t = t0;
    for (let i = 0; i < 3; i++) {
      const f = 85 + rng() * 60;
      const o = toneOsc(c, 'square', f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.07);
      o.connect(bp);
      o.start(t);
      o.stop(t + 0.08);
      t += 0.1 + rng() * 0.08;
    }
    return 0.52;
  },
};

/* ------------------------------------------------------------------ */
/* Admission control (own registries — mirrors audio.ts)               */
/* ------------------------------------------------------------------ */

const liveEnds2: Partial<Record<Sfx2Name, number[]>> = {};
const lastStart2: Partial<Record<Sfx2Name, number>> = {};

function pruneVoices2(nowT: number): void {
  for (const name of SFX2_NAMES) {
    const ends = liveEnds2[name];
    if (!ends) continue;
    const kept = ends.filter((e) => e > nowT - 0.02);
    if (kept.length) liveEnds2[name] = kept;
    else delete liveEnds2[name];
  }
}

export interface Sfx2Opts { vol?: number; rate?: number }

/**
 * Play an extension one-shot. No-throw; returns false when audio is
 * unavailable, the mute gate is closed (nothing scheduled), or the per-name
 * throttle / voice cap rejects the request.
 */
export function playSfx2(name: Sfx2Name, opts?: Sfx2Opts): boolean {
  const fn = SFX2[name];
  if (!fn) return false;
  if (isMuted()) return false;                   // zero output: nothing scheduled
  const g = audioGraph();
  if (!g) return false;
  try {
    if (g.ctx.state === 'suspended') void g.ctx.resume().catch(() => {});
    const nowT = g.ctx.currentTime;
    pruneVoices2(nowT);
    const pol = POLICY2[name];
    const prev = lastStart2[name];
    if (prev != null && nowT - prev < pol.minGap) return false;
    const mine = liveEnds2[name];
    if (mine && mine.length >= pol.maxVoices) return false;
    const vol = Math.min(1, Math.max(0.0001, opts?.vol ?? 1));
    const rate = Math.max(0.05, opts?.rate ?? 1);
    const t0 = nowT + 0.005;
    const endOff = fn(g.ctx, g.master, t0, vol, rate);
    liveEnds2[name] = [...(liveEnds2[name] ?? []), t0 + endOff];
    lastStart2[name] = t0;
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Ember crackle loop (motion-gated ambience bus, NOT a one-shot)       */
/* ------------------------------------------------------------------ */

let crackleBus: GainNode | null = null;

/** The loop's gain node — director wobbles this for crackle texture. */
export function emberCrackleBus(): GainNode | null {
  return crackleBus;
}

/**
 * Start/stop the ember crackle loop (bandpassed shared noise). Gates on the
 * mute state and IQB_MOTION: a request to run while either gate is closed
 * tears down instead. Returns whether the loop is running afterwards.
 */
export function emberCrackle(on: boolean): boolean {
  const g = audioGraph();
  if (!on || !g || isMuted() || !motionEnabled()) {
    if (crackleBus) {
      try { crackleBus.disconnect(); } catch { /* noop */ }
      crackleBus = null;
    }
    return false;
  }
  if (crackleBus) return true;
  try {
    const c = g.ctx;
    const bus = c.createGain();
    bus.gain.value = 0.06;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 0.6;
    bp.connect(bus);
    bus.connect(g.master);
    noiseSource(c, c.currentTime, 0, true).connect(bp); // infinite loop source
    crackleBus = bus;
    return true;
  } catch {
    crackleBus = null;
    return false;
  }
}
