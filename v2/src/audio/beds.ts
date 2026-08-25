/**
 * beds.ts — v2 alignment-reactive music director + dread layer + stings.
 *
 * Port of frozen-v1 `music-pack.js` patterns (mechanic, not code). Four
 * procedurally synthesised beds, zero assets:
 *
 *   bad     — heartbeat drone: detuned saw/triangle rub at 55 Hz + irregular
 *             ~52 bpm lub-dub thumps with seeded jitter and skipped beats.
 *   good    — warm I-IV pad (detuned triangles) + gentle 8th-note arp plinks.
 *   chaotic — crushed stutter arps through a bitcrush bus + nervous square
 *             drone; wobble LFO gated behind IQB_MOTION.
 *   neutral — airy perfect-fifth drone with sparse high pings; breathing LFO
 *             gated behind IQB_MOTION.
 *
 * Exports (for main.ts):
 *   setAlignment(a)  — 'bad'|'good'|'chaotic'|'neutral'; 2 s gain crossfade
 *                      between beds (linear ramps scheduled on ctx clock).
 *   setLayer(1..7)   — depth-reactive dread drone; maps layer -> lowpass
 *                      brightness (90 Hz .. 1.9 kHz). 0 = silent.
 *   sting('pain'|'heal') — one-shot dissonant grind / major chime relief.
 *   stopBedClocks()  — @internal test seam.
 *
 * Determinism: every bed pattern comes from an own mulberry32 seeded per
 * alignment (stable seeds) — no Math.random / Date.now. The scheduler is a
 * 120 ms lookahead clock driving only the ACTIVE bed's tick. If setAlignment
 * is called before any user gesture, the choice is remembered and activated
 * via audio.ts's onAudioReady hook.
 * ========================================================================*/

import {
  audioGraph, isMuted, motionEnabled, mulberry32, onAudioReady,
  envGain, toneOsc, lowpassFilter, crushShaper,
} from './audio.ts';

const FADE = 2.0;        // seconds, bed crossfade
const LOOKAHEAD = 0.45;  // seconds scheduled ahead of ctx clock
const TICK_MS = 120;

export type Align = 'bad' | 'good' | 'chaotic' | 'neutral';

const ALIGNS: readonly Align[] = ['bad', 'good', 'chaotic', 'neutral'];

/** Stable per-alignment seeds — bed patterns are pure functions of these. */
const SEEDS: Record<Align, number> = {
  bad: 0xbada55,
  good: 0x0600dca7,
  chaotic: 0xc0ffee,
  neutral: 0x4e27741,
};

/** A running ambience bus: its own gain into master + continuous voices. */
interface Bed {
  name: Align;
  gain: GainNode;
  nodes: Array<OscillatorNode | AudioBufferSourceNode>;
  rng: () => number;
  next: number;
  tick: ((rng: () => number, tNow: number) => void) | null;
}

type BedBuilder = (bed: Bed, c: AudioContext, t0: number) => (rng: () => number, tNow: number) => void;

const beds: Partial<Record<Align, Bed>> = {};
let current: Align = 'neutral';
let curLayer = 0;
let schedTimer: IntervalHandle | null = null;
let lastSting = -1e9;
let dread: { lp: BiquadFilterNode; g: GainNode } | null = null;

/** setInterval handle shape across node/browser lib combos. */
type IntervalHandle = NodeJS.Timeout | number;

function every(ms: number, fn: () => void): IntervalHandle {
  const t = setInterval(fn, ms);
  const r = t as unknown as { unref?: () => void };
  if (typeof r.unref === 'function') r.unref();
  return t;
}

function later(ms: number, fn: () => void): void {
  const t = setTimeout(fn, ms);
  const r = t as unknown as { unref?: () => void };
  if (typeof r.unref === 'function') r.unref();
}

/* ------------------------------------------------------------------ */
/* Bed builders                                                        */
/* ------------------------------------------------------------------ */

function bedBad(bed: Bed, c: AudioContext, t0: number): (rng: () => number, tNow: number) => void {
  // Drone bus: detuned pair a minor second apart at the bottom — constant rub.
  const bus = c.createGain();
  bus.gain.value = 0.5;
  const lp = lowpassFilter(c, 260, 0.8);
  lp.connect(bus);
  bus.connect(bed.gain);
  for (const f of [55.0, 58.27]) {
    const o = toneOsc(c, f === 55 ? 'sawtooth' : 'triangle', f, t0);
    o.connect(lp);
    o.start(t0);
    bed.nodes.push(o);
  }

  const BEAT = 60 / 52; // ~52 bpm heartbeat

  function thump(t: number, amp: number): void {
    const o = toneOsc(c, 'sine', 82, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    const eg = envGain(c, bed.gain, 0.85 * amp, t, 0.012, 0.28);
    o.connect(eg);
    o.start(t);
    o.stop(t + 0.32);
  }

  return (rng, tNow) => {
    if (bed.next < tNow) bed.next = tNow + 0.05;
    while (bed.next < tNow + LOOKAHEAD) {
      const t = bed.next;
      thump(t, 0.9);                                        // lub
      if (rng() < 0.75) thump(t + 0.16 + rng() * 0.04, 0.35); // dub
      const skip = rng() < 0.12;                            // occasional missed beat
      bed.next = t + BEAT * (skip ? 2 : 1) * (0.82 + rng() * 0.36);
    }
  };
}

const GOOD_CHORDS: ReadonlyArray<{ pad: readonly number[]; arp: readonly number[] }> = [
  // I : C major
  { pad: [130.81, 196.0, 261.63, 329.63], arp: [261.63, 329.63, 392.0, 523.25] },
  // IV : F major
  { pad: [174.61, 220.0, 349.23, 440.0], arp: [349.23, 440.0, 523.25, 698.46] },
];

function bedGood(bed: Bed, c: AudioContext, t0: number): (rng: () => number, tNow: number) => void {
  // Warm pad: I and IV chord groups crossfading inside the bed on a slow loop.
  const groups = GOOD_CHORDS.map((chord) => {
    const gg = c.createGain();
    gg.gain.value = 0.0001;
    gg.connect(bed.gain);
    for (const f of chord.pad) {
      for (const cents of [-3, 3]) {           // gentle detune width = warmth
        const o = toneOsc(c, 'triangle', f, t0);
        o.detune.value = cents;
        const og = c.createGain();
        og.gain.value = 0.12 / chord.pad.length;
        o.connect(og);
        og.connect(gg);
        o.start(t0);
        bed.nodes.push(o);
      }
    }
    return gg;
  });

  const BAR = 8;                // 8th-notes per chord before I<->IV swap
  const STEP = 60 / 92 / 2;     // 8th notes at a gentle 92 bpm
  let barIdx = -1;

  function plink(t: number, f: number, amp: number): void {
    const o = toneOsc(c, 'triangle', f, t);
    const eg = envGain(c, bed.gain, amp, t, 0.02, 0.42);
    o.connect(eg);
    o.start(t);
    o.stop(t + 0.48);
  }

  return (rng, tNow) => {
    if (bed.next < tNow) bed.next = tNow + 0.05;
    while (bed.next < tNow + LOOKAHEAD) {
      const t = bed.next;
      const steps = Math.round((t - t0) / STEP);
      const stepInBar = steps % BAR;
      const chord = Math.floor(steps / BAR) % 2;
      if (stepInBar === 0 && chord !== barIdx) {
        barIdx = chord;
        const tt = c.currentTime;
        groups.forEach((gg, gi) => {
          gg.gain.cancelScheduledValues(tt);
          gg.gain.setTargetAtTime(gi === chord ? 0.9 : 0.0001, tt, FADE / 3);
        });
      }
      // Gentle 8th-note arpeggio over the live chord.
      const tones = GOOD_CHORDS[chord].arp;
      const f = tones[Math.floor(rng() * tones.length)] * (rng() < 0.15 ? 2 : 1);
      plink(t, f, 0.06);
      bed.next += STEP;
    }
  };
}

function bedChaotic(bed: Bed, c: AudioContext, t0: number): (rng: () => number, tNow: number) => void {
  // Crush bus for the stutter arps + a nervous low drone for continuity.
  const crush = crushShaper(c, 6);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 900;
  bp.Q.value = 0.9;
  crush.connect(bp);
  bp.connect(bed.gain);

  const dg = c.createGain();
  dg.gain.value = 0.25;
  dg.connect(bed.gain);
  const lpDrone = lowpassFilter(c, 140, 0.6);
  lpDrone.connect(dg);
  const dOsc = toneOsc(c, 'square', 55, t0);
  dOsc.connect(lpDrone);
  dOsc.start(t0);
  bed.nodes.push(dOsc);

  if (motionEnabled()) {
    // Wobble counts as motion flavour — gated behind IQB_MOTION.
    const lfo = toneOsc(c, 'sine', 6.3, t0);
    const lg = c.createGain();
    lg.gain.value = 180;
    lfo.connect(lg);
    lg.connect(bp.frequency);
    lfo.start(t0);
    bed.nodes.push(lfo);
  }

  const SCALE = [0, 3, 5, 7, 10, 12]; // minor pentatonic + octave
  const BASE = 110;
  let lastIdx = 0;

  function zapNote(t: number, f: number, dur: number, amp: number): void {
    const o = toneOsc(c, 'square', f, t);
    const eg = envGain(c, crush, amp, t, 0.006, dur);
    o.connect(eg);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  return (rng, tNow) => {
    if (bed.next < tNow) bed.next = tNow + 0.05;
    while (bed.next < tNow + LOOKAHEAD) {
      let t = bed.next;
      // Stutter: repeat a pitch 1-4 times fast; wild seeded skips between groups.
      const reps = 1 + Math.floor(rng() * 4);
      let idx = lastIdx;
      if (rng() < 0.7) idx = Math.min(SCALE.length - 1, Math.max(0, lastIdx + Math.floor(rng() * 5) - 2));
      else idx = Math.floor(rng() * SCALE.length);
      lastIdx = idx;
      for (let r = 0; r < reps; r++) {
        const dur = 0.07 + rng() * 0.13;
        zapNote(t, BASE * Math.pow(2, SCALE[idx] / 12), dur, 0.09 + rng() * 0.05);
        t += dur + rng() * 0.06;
      }
      bed.next = t + rng() * 0.22; // ragged gate
    }
  };
}

function bedNeutral(bed: Bed, c: AudioContext, t0: number): (rng: () => number, tNow: number) => void {
  // Airy perfect-fifth drone, very quiet; sparse high pings.
  const g = c.createGain();
  g.gain.value = 0.32;
  g.connect(bed.gain);
  for (const [type, f] of [['sine', 110.0], ['sine', 164.81], ['triangle', 329.63]] as const) {
    const o = toneOsc(c, type, f, t0);
    o.connect(g);
    o.start(t0);
    bed.nodes.push(o);
  }

  if (motionEnabled()) {
    // Slow breathing on the drone — motion flavour, gated.
    const lfo = toneOsc(c, 'sine', 0.08, t0);
    const lg = c.createGain();
    lg.gain.value = 0.08;
    lfo.connect(lg);
    lg.connect(g.gain);
    lfo.start(t0);
    bed.nodes.push(lfo);
  }

  function ping(t: number, f: number, amp: number): void {
    const o = toneOsc(c, 'sine', f, t);
    const eg = envGain(c, bed.gain, amp, t, 0.03, 2.2);
    o.connect(eg);
    o.start(t);
    o.stop(t + 2.3);
  }

  return (rng, tNow) => {
    if (bed.next < tNow) bed.next = tNow + 2 + rng() * 4;
    while (bed.next < tNow + LOOKAHEAD) {
      const t = bed.next;
      ping(t, [1046.5, 1318.5, 1568.0][Math.floor(rng() * 3)], 0.035);
      bed.next = t + 4 + rng() * 6; // sparse by design
    }
  };
}

const BUILDERS: Record<Align, BedBuilder> = {
  bad: bedBad,
  good: bedGood,
  chaotic: bedChaotic,
  neutral: bedNeutral,
};

/* ------------------------------------------------------------------ */
/* Build / teardown / director                                         */
/* ------------------------------------------------------------------ */

function buildBed(name: Align, c: AudioContext, t0: number): Bed {
  const bed: Bed = {
    name,
    gain: c.createGain(),
    nodes: [],
    rng: mulberry32(SEEDS[name]),
    next: 0,
    tick: null,
  };
  bed.gain.gain.value = 0.0001;
  bed.gain.connect(audioGraph()!.master);
  bed.tick = BUILDERS[name](bed, c, t0);
  beds[name] = bed;
  return bed;
}

function teardownBed(bed: Bed): void {
  delete beds[bed.name];
  try {
    for (const n of bed.nodes) {
      try { n.stop(); } catch { /* already stopped */ }
    }
  } catch { /* noop */ }
  try {
    const g = audioGraph();
    if (!g) return;
    const t = g.ctx.currentTime;
    bed.gain.gain.cancelScheduledValues(t);
    bed.gain.gain.setValueAtTime(Math.max(0.0001, bed.gain.gain.value), t);
    bed.gain.gain.linearRampToValueAtTime(0.0001, t + 0.1);
    later(300, () => { try { bed.gain.disconnect(); } catch { /* noop */ } });
  } catch { /* noop */ }
}

function ensureScheduler(): void {
  if (schedTimer) return;
  schedTimer = every(TICK_MS, schedulerTick);
}

function schedulerTick(): void {
  try {
    const g = audioGraph();
    if (!g) return;
    const bed = beds[current];
    if (!bed || !bed.tick) return;
    bed.tick(bed.rng, g.ctx.currentTime);
  } catch { /* never let the clock die */ }
}

function activate(name: Align, t0: number): void {
  const g = audioGraph();
  if (!g) return;
  const bed = beds[name] ?? buildBed(name, g.ctx, t0);
  const p = bed.gain.gain;
  p.cancelScheduledValues(t0);
  p.setValueAtTime(Math.max(0.0001, p.value), t0);
  p.linearRampToValueAtTime(1, t0 + FADE);            // 2 s fade-in
  for (const other of ALIGNS) {
    if (other === name) continue;
    const b = beds[other];
    if (!b) continue;
    const q = b.gain.gain;
    q.cancelScheduledValues(t0);
    q.setValueAtTime(Math.max(0.0001, q.value), t0);
    q.linearRampToValueAtTime(0.0001, t0 + FADE);     // 2 s fade-out
    later((FADE + 0.4) * 1000, () => {
      if (current !== other && beds[other] === b) teardownBed(b);
    });
  }
  ensureDread(g);
  ensureScheduler();
}

/** @internal test seam — snapshot of live beds + current alignment. */
export function bedStates(): { current: Align; built: Align[] } {
  return { current, built: ALIGNS.filter((a) => beds[a] != null) };
}

/** @internal test seam — run one scheduler lookahead pass manually. */
export function schedulerPass(): void {
  schedulerTick();
}

/** @internal test seam — clears the scheduler interval. */
export function stopBedClocks(): void {
  if (schedTimer !== null) {
    clearInterval(schedTimer);
    schedTimer = null;
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Swap the active bed with a 2 s crossfade. Remembers pre-init choices. */
export function setAlignment(a: Align): boolean {
  if (!ALIGNS.includes(a)) return false;
  current = a;
  const g = audioGraph();
  if (g) activate(a, g.ctx.currentTime + 0.02);
  return true;
}

/**
 * Depth-reactive dread drone (1..7). Maps layer to lowpass brightness over a
 * detuned saw pair: layer 1 = 90 Hz murk, layer 7 = 1.9 kHz menace. 0 mutes.
 */
export function setLayer(n: number): void {
  curLayer = Math.max(0, Math.min(7, Math.round(n)));
  const g = audioGraph();
  if (!g) return;
  ensureDread(g);
  const t = g.ctx.currentTime;
  const freq = 90 * Math.pow(1900 / 90, (curLayer - 1) / 6);
  dread!.lp.frequency.setTargetAtTime(curLayer >= 1 ? freq : 90, t, 0.4);
  dread!.g.gain.setTargetAtTime(curLayer >= 1 ? 0.09 + 0.012 * (curLayer - 1) : 0.0001, t, 0.4);
}

/** One-shots: 'pain' = dissonant falling grind, 'heal' = rising major chime. */
export function sting(kind: 'pain' | 'heal'): boolean {
  const g = audioGraph();
  if (!g || isMuted()) return false;
  const t0 = g.ctx.currentTime + 0.02;
  if (t0 - lastSting < 0.25) return false; // anti-spam so stings can't stack
  lastSting = t0;
  if (kind === 'pain') stingPain(g.ctx, g.master, t0);
  else stingHeal(g.ctx, g.master, t0);
  return true;
}

/* ------------------------------------------------------------------ */
/* Dread drone                                                         */
/* ------------------------------------------------------------------ */

function ensureDread(g: { ctx: AudioContext; master: GainNode }): void {
  if (dread) return;
  const c = g.ctx;
  const lp = lowpassFilter(c, 90, 1.1);
  const gn = c.createGain();
  gn.gain.value = 0.0001;
  lp.connect(gn);
  gn.connect(g.master);
  for (const f of [41.2, 41.7]) {
    const o = toneOsc(c, 'sawtooth', f, c.currentTime);
    o.connect(lp);
    o.start();
  }
  dread = { lp, g: gn };
}

// Activate whatever was requested before the user gesture arrived.
onAudioReady(() => {
  const g = audioGraph();
  if (!g) return;
  ensureDread(g);
  setLayer(curLayer);       // applies pending layer to the now-real chain
  activate(current, g.ctx.currentTime + 0.02);
});

/* ------------------------------------------------------------------ */
/* Stingers                                                            */
/* ------------------------------------------------------------------ */

function stingPain(c: AudioContext, dest: AudioNode, t0: number): void {
  // Amplifier pain: minor-2nd saw pair grinding downward + body blow.
  const dist = crushShaper(c, 10);
  const lp = lowpassFilter(c, 1400, 1.2);
  dist.connect(lp);
  lp.connect(dest);
  ([233.08, 220.0] as const).forEach((f, i) => {
    const o = toneOsc(c, 'sawtooth', f * 1.06, t0);
    o.frequency.exponentialRampToValueAtTime(f * 0.72, t0 + 0.55); // falls in pain
    const eg = envGain(c, dist, i ? 0.12 : 0.2, t0, 0.02, 0.6);
    o.connect(eg);
    o.start(t0);
    o.stop(t0 + 0.65);
  });
  const thump = toneOsc(c, 'sine', 70, t0);
  thump.frequency.exponentialRampToValueAtTime(34, t0 + 0.2);
  const tg = envGain(c, dest, 0.5, t0, 0.01, 0.3);
  thump.connect(tg);
  thump.start(t0);
  thump.stop(t0 + 0.35);
}

function stingHeal(c: AudioContext, dest: AudioNode, t0: number): void {
  // C major chime climbing out of the dark (compressed <= 900 ms).
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((f, i) => {
    const t = t0 + i * 0.09;
    for (const [wave, amp] of [['sine', 0.11], ['triangle', 0.06]] as const) {
      const o = toneOsc(c, wave, f, t);
      const eg = envGain(c, dest, amp, t, 0.015, 0.58);
      o.connect(eg);
      o.start(t);
      o.stop(t + 0.62);
    }
  });
}
