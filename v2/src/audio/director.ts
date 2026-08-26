/**
 * director.ts — v2 ACT-REACTIVE AUDIO DIRECTOR: the deeper v1 identity layered
 * ON TOP of beds.ts alignment beds (those keep playing; this module adds a
 * parallel corruption bus + reveal/hp/pickup event voices).
 *
 * Port of frozen-v1 `audio.js` setAct() ambience mechanics (mechanic, not
 * code), extended to the 4-act v2 arc:
 *
 *   act 0 — silent bus (alignment bed alone).
 *   act 1 — faint detuned hum pair (60 / 90.5 Hz × 1.007) + slow 0.25 Hz
 *           pulse LFO on the bus gain.
 *   act 2 — hell drone core: E1/F1/B1 saw cluster (±12 cents) through a
 *           lowpass, dark bandpassed noise; glitch-cascade stingers begin.
 *   act 3 — act 2 plus a dissonant triangle cluster and a faster 0.5 Hz LFO;
 *           demon-chatter bursts join (budget: max one burst per 8 s).
 *
 * Also owns:
 *   - corruption stingers: seeded glitch cascades during act >= 2, ember
 *     crackle LOOP gated by IQB_MOTION while act >= 2 (sfx2.ts),
 *   - win/lose jingles per reveal with streak-scaled rate,
 *   - emerald-pickup fanfare,
 *   - heartbeat acceleration below hp 25: edge-triggered once per crossing,
 *     beat interval tightens as hp falls (~1.05 s at 24 -> ~0.41 s at 1).
 *
 * Rails:
 *  - Master cap inherited: every voice routes into audioGraph().master,
 *    hard-capped at MASTER_CAP = 0.15 in audio.ts; bus gains here stay small.
 *  - Mute gate: IQB_MUTED closes everything (no scheduling, loops torn down).
 *    Calls made before a user gesture are REMEMBERED and applied via
 *    audio.ts's onAudioReady hook (same pattern as beds.ts).
 *  - Determinism: texture decisions come from an own mulberry32 stream;
 *    no Math.random / Date.now. Timers are unref'd so node self-tests exit.
 * ========================================================================*/

import {
  audioGraph, isMuted, motionEnabled, mulberry32, onAudioReady, sfx,
  toneOsc, lowpassFilter, noiseSource,
} from './audio.ts';
import { playSfx2, emberCrackle, emberCrackleBus } from './sfx2.ts';

const FADE = 1.8;      // seconds, layer crossfade (mirrors v1's 2 s feel)
const TICK_MS = 150;   // scheduler lookahead cadence
const LOOKAHEAD = 0.4; // seconds scheduled ahead of ctx clock

/** Bus gain per act (relative; master caps absolute output at 0.15). */
const ACT_GAIN: readonly number[] = [0, 0.18, 0.30, 0.44];
/** Pulse-LFO depth per act (ambient flavour only). */
const ACT_LFO: readonly number[] = [0, 0.05, 0.08, 0.10];

const CASCADE_GAP_S = 2.5;   // min seconds between glitch-cascade stingers
const CHATTER_BUDGET_S = 8;  // demon chatter budget: max one burst per 8 s
const HP_THRESHOLD = 25;     // heartbeat rail arms below this

interface Layer {
  gain: GainNode;
  nodes: AudioScheduledSourceNode[];
}

let wantAct = 0;       // last requested act (clamped 0..3)
let builtAct = -1;     // act whose layer currently sounds (-1 = none)
let layer: Layer | null = null;

let hpLow = false;     // heartbeat rail armed state (edge-triggered)
let lastHp = 100;
let nextBeatT = 0;

let cascadeLastT = -1e9;
let chatterLastT = -1e9;

let timer: IntervalHandle | null = null;
let inited = false;

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

/** Own stochastic stream for stinger/chatter decisions + crackle wobble. */
const dirRng = mulberry32(0x0ac7feed);

/* ------------------------------------------------------------------ */
/* Act layers                                                          */
/* ------------------------------------------------------------------ */

function buildLayer(act: number, c: AudioContext, t0: number): Layer | null {
  if (act <= 0) return null;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(ACT_GAIN[act], t0 + FADE);
  const g = audioGraph();
  gain.connect(g ? g.master : c.destination);

  const nodes: AudioScheduledSourceNode[] = [];
  const add = (n: AudioScheduledSourceNode): void => {
    n.start(t0);
    nodes.push(n);
  };

  if (act === 1) {
    // v1 act-1 recipe: same hum, slightly detuned, slow pulse to come
    const lp = lowpassFilter(c, 520);
    lp.connect(gain);
    for (const f of [60, 90.5]) {
      const o = toneOsc(c, 'sine', f * 1.007, t0);
      o.connect(lp);
      add(o);
    }
  } else {
    // acts 2..3 share the hell-drone core (v1 buildBed2 recipe)
    const lp = lowpassFilter(c, act >= 3 ? 420 : 300, 0.9);
    lp.connect(gain);
    [41.2, 43.65, 61.7].forEach((f, i) => {
      const o = toneOsc(c, 'sawtooth', f, t0); // E1/F1/B1 cluster
      o.detune.value = (i - 1) * 12;
      o.connect(lp);
      add(o);
    });
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 180;
    bp.Q.value = 0.7;
    const ng = c.createGain();
    ng.gain.value = 0.35;
    bp.connect(ng);
    ng.connect(gain);
    const nz = noiseSource(c, t0, 0, true);
    nz.connect(bp);
    add(nz);
    if (act >= 3) {
      const lp2 = lowpassFilter(c, 1200);
      lp2.connect(gain);
      for (const f of [233.08, 246.94]) { // Bb3/B3 semitone rub
        const o = toneOsc(c, 'triangle', f, t0);
        o.connect(lp2);
        add(o);
      }
    }
  }

  // Slow pulse LFO on the bus gain — ambient flavour, gated behind IQB_MOTION
  if (motionEnabled()) {
    const lfo = toneOsc(c, 'sine', act >= 3 ? 0.5 : 0.25, t0);
    const lg = c.createGain();
    lg.gain.value = ACT_LFO[act];
    lfo.connect(lg);
    lg.connect(gain.gain);
    add(lfo);
  }

  return { gain, nodes };
}

function teardownLayer(old: Layer): void {
  later(Math.round(FADE * 1000) + 250, () => {
    for (const n of old.nodes) {
      try { n.stop(); } catch { /* already stopped */ }
    }
    try { old.gain.disconnect(); } catch { /* noop */ }
  });
}

function applyAct(): void {
  const g = audioGraph();
  if (!g || builtAct === wantAct) return;
  const t = g.ctx.currentTime + 0.01;
  const old = layer;
  layer = buildLayer(wantAct, g.ctx, t);
  builtAct = wantAct;
  if (old) teardownLayer(old);
}

function refreshCrackle(): void {
  // Ember crackle follows the act level AND the motion gate (fairness rails).
  emberCrackle(wantAct >= 2 && !!audioGraph());
}

/* ------------------------------------------------------------------ */
/* Scheduler                                                           */
/* ------------------------------------------------------------------ */

function initClocks(): void {
  if (timer !== null) return;
  timer = every(TICK_MS, schedulerTick);
}

/** Heartbeat interval tightens as hp falls: 24 -> ~1.06 s, 1 -> ~0.41 s. */
function beatInterval(): number {
  const hp = Math.max(1, Math.min(HP_THRESHOLD - 1, lastHp));
  return 0.38 + (hp / (HP_THRESHOLD - 1)) * 0.68;
}

function schedulerTick(): void {
  // The crackle loop re-asserts EVERY pass — including muted passes, so the
  // mute gate tears it down (zero-output guarantee covers loops too).
  refreshCrackle();
  const g = audioGraph();
  if (!g || isMuted()) return;
  const nowT = g.ctx.currentTime;

  // Corruption stingers: glitch cascade during act >= 2, seeded chance.
  if (wantAct >= 2 && nowT - cascadeLastT >= CASCADE_GAP_S && dirRng() < 0.10) {
    if (playSfx2('cascade')) cascadeLastT = nowT;
  }
  // Demon chatter bursts: act 3 only, budgeted one burst per 8 s.
  if (wantAct >= 3 && nowT - chatterLastT >= CHATTER_BUDGET_S && dirRng() < 0.35) {
    if (playSfx2('chatter')) chatterLastT = nowT;
  }

  const bus = emberCrackleBus();
  if (bus) bus.gain.setTargetAtTime(0.04 + dirRng() * 0.05, nowT, 0.3); // crackle wobble

  // Accelerated heartbeats below the HP threshold.
  if (hpLow) {
    if (nextBeatT < nowT) nextBeatT = nowT + 0.02;
    while (nextBeatT < nowT + LOOKAHEAD) {
      sfx('heart', { vol: 0.55 });
      nextBeatT += beatInterval();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Idempotent init. Safe before the first user gesture; applies then. */
export function initDirector(): void {
  if (inited) return;
  inited = true;
  onAudioReady(() => {
    initClocks();
    applyAct();
    refreshCrackle();
  });
  // Graph may already exist (gesture happened before this call).
  if (audioGraph()) {
    initClocks();
    applyAct();
    refreshCrackle();
  }
}

/** Act intensity ramp 0..3 (clamped). Returns true when the act changed. */
export function onAct(n: number): boolean {
  const act = Math.max(0, Math.min(3, Math.round(n)));
  if (act === wantAct) return false;
  wantAct = act;
  applyAct();
  refreshCrackle();
  return true;
}

/**
 * Reveal voice: rising win arpeggio (rate scales with streak, capped) or the
 * falling crush-buzz lose sting. Returns true when a jingle was scheduled.
 */
export function onReveal(correct: boolean, streak: number): boolean {
  if (correct) {
    const s = Math.max(0, Math.min(9, Math.round(streak)));
    return playSfx2('win', { rate: 1 + s * 0.05 });
  }
  return playSfx2('lose');
}

/** Chaos-Emerald pickup fanfare. */
export function onEmerald(): boolean {
  return playSfx2('fanfare');
}

/**
 * Heartbeat rail, EDGE-TRIGGERED: crossing below hp 25 arms accelerated
 * heartbeats exactly once; staying low or re-reporting the same side is a
 * no-op until hp crosses back to >= 25 (which re-arms silently).
 */
export function onHpThreshold(hp: number): boolean {
  lastHp = hp;
  const low = hp < HP_THRESHOLD;
  if (low === hpLow) return false;
  hpLow = low;
  if (low) {
    const g = audioGraph();
    nextBeatT = g ? g.ctx.currentTime + 0.15 : 0.15;
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Test seams                                                          */
/* ------------------------------------------------------------------ */

export interface DirectorSnapshot {
  wantAct: number;
  builtAct: number;
  hpLow: boolean;
  crackle: boolean;
  clocks: boolean;
}

/** @internal test seam — snapshot of director state. */
export function directorSnapshot(): DirectorSnapshot {
  return {
    wantAct,
    builtAct,
    hpLow,
    crackle: emberCrackleBus() != null,
    clocks: timer !== null,
  };
}

/** @internal test seam — run one scheduler lookahead pass manually. */
export function directorPass(): void {
  schedulerTick();
}

/** @internal test seam — clears the scheduler interval. */
export function stopDirectorClocks(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}
