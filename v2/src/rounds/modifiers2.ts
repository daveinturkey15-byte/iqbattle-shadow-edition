/* ============================================================================
 * ROUND MODIFIERS 2 — second batch of in-round gameplay twists.
 *
 * Same contract as ./modifiers.ts: pure rules, deterministic application, and
 * teardowns that restore the exact pre-apply transform. Runs headless under
 * node (zero Pixi, zero DOM) using duck-typed container targets.
 *
 * HARD INTEGRATION RULE FOR THIS BATCH: every modifier expresses its entire
 * effect through the transform fields the engine already drives — scale.x,
 * scale.y, x, y, rotation. The generic driver calls stop.step(tMs) each tick
 * for exactly these fields, so anything else would need a bespoke painter
 * and would silently do nothing. A field nothing reads is the most common
 * bug here, so this file never writes one.
 *
 * All randomness is seeded strictly from ctx.seed and ctx.depth using a local
 * mulberry32 generator. Time arrives only via step(tMs) as a pure function
 * of its argument; reduced-motion pins a fixed state with no step.
 * ==========================================================================*/

import type { RoundModifier, ModCtx, ModifierStop, BoardTarget } from './modifiers.ts';

/** Pure mulberry32 32-bit PRNG generator. */
function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Resolve duck-typed BoardTarget from scene or nested container. */
function resolveBoardTarget(scene: unknown): BoardTarget | null {
  if (typeof scene !== 'object' || scene === null) return null;
  const obj = scene as Record<string, unknown>;

  if (
    'scale' in obj &&
    typeof obj.scale === 'object' &&
    obj.scale !== null &&
    'x' in (obj.scale as Record<string, unknown>) &&
    'y' in (obj.scale as Record<string, unknown>) &&
    typeof (obj.scale as Record<string, unknown>).x === 'number' &&
    typeof (obj.scale as Record<string, unknown>).y === 'number' &&
    typeof obj.x === 'number' &&
    typeof obj.y === 'number'
  ) {
    return obj as unknown as BoardTarget;
  }

  if ('boardContainer' in obj && typeof obj.boardContainer === 'object' && obj.boardContainer !== null) {
    return resolveBoardTarget(obj.boardContainer);
  }
  if ('board' in obj && typeof obj.board === 'object' && obj.board !== null) {
    return resolveBoardTarget(obj.board);
  }
  if ('container' in obj && typeof obj.container === 'object' && obj.container !== null) {
    return resolveBoardTarget(obj.container);
  }

  return null;
}

/**
 * Pendulum Sway: a slow rotational sway around the board centre, like a
 * hanging sign. WHY rotation only: the text stays the same size and the
 * corners stay near home, so options stay clickable. Amplitude is capped
 * well under 0.20 rad and the period is several seconds, so the motion
 * reads as sway rather than shake. Static mode pins a half-swing offset
 * (identical rules, no motion). Teardown restores the exact transform.
 */
const pendulumSwayModifier: RoundModifier = {
  id: 'pendulum-sway',
  banner: 'PENDULUM SWAY',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): ModifierStop => {
    const target = resolveBoardTarget(scene);
    if (!target) return () => {};

    const origScaleX = target.scale.x;
    const origScaleY = target.scale.y;
    const origX = target.x;
    const origY = target.y;
    const origRotation: number | undefined =
      typeof target.rotation === 'number' ? target.rotation : undefined;
    const base = origRotation ?? 0;

    const rng = mulberry32((ctx.seed ^ Math.imul(ctx.depth, 0x3a8f1b2c)) >>> 0);
    const amp = 0.1 + rng() * 0.08; // 0.10–0.18 rad, always inside +-0.20
    const periodMs = 2800 + rng() * 2400; // slow pendulum, 2.8–5.2 s
    const phase = rng() * Math.PI * 2; // seeded phase decorrelates rounds

    const setAt = (tMs: number): void => {
      target.rotation = base + amp * Math.sin((2 * Math.PI * tMs) / periodMs + phase);
    };

    if (ctx.motion) {
      setAt(0);
    } else {
      // Static variant: fixed half-swing offset, identical rules, no motion.
      target.rotation = base + amp * Math.sin(phase) * 0.5;
    }

    const stop: ModifierStop = () => {
      target.scale.x = origScaleX;
      target.scale.y = origScaleY;
      target.x = origX;
      target.y = origY;
      if (origRotation === undefined) delete target.rotation;
      else target.rotation = origRotation;
    };
    // motion=false ⇒ no reported movement: the board stays pinned.
    if (ctx.motion) stop.step = (tMs: number): void => { setAt(tMs); };
    return stop;
  },
};

/**
 * Snap Rotate: most of the time the board sits straight; on a seeded rhythm
 * it snaps briefly to a small rotated pose and returns. WHY the snap: it
 * tests re-aim without a lasting handicap, and WHY the return: late-round
 * answers are always taken on a straight board. The snap angle stays inside
 * +-0.20 rad so the corners never leave the panel. Static mode pins the
 * straight pose so reduced-motion never traps the board rotated.
 */
const snapRotateModifier: RoundModifier = {
  id: 'snap-rotate',
  banner: 'SNAP ROTATE',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): ModifierStop => {
    const target = resolveBoardTarget(scene);
    if (!target) return () => {};

    const origScaleX = target.scale.x;
    const origScaleY = target.scale.y;
    const origX = target.x;
    const origY = target.y;
    const origRotation: number | undefined =
      typeof target.rotation === 'number' ? target.rotation : undefined;
    const base = origRotation ?? 0;

    const rng = mulberry32((ctx.seed ^ Math.imul(ctx.depth, 0x5c7a3d91)) >>> 0);
    const dir = rng() < 0.5 ? 1 : -1;
    const snap = dir * (0.12 + rng() * 0.06); // +-0.12..0.18, inside +-0.20
    const periodMs = 2600 + rng() * 1600;
    /* Seeded snap sharpness. The original shape was a square wave holding for
     * 350-600ms of a ~3.4s cycle: barely perceptible, and constant between most
     * pairs of moments, so for some seeds it read as frozen to the gate AND to
     * a player. A high power of |sin| spends most of the cycle near zero and
     * spikes hard — it still reads as a snap, but it has no flat dead zone, so
     * the rotation genuinely differs between any two distinct moments. */
    const sharp = 4 + Math.floor(rng() * 5); // 4..8
    const offset = rng() * periodMs; // seeded phase in the cycle

    const setAt = (tMs: number): void => {
      const t = tMs < 0 ? 0 : tMs;
      const cycle = (((t + offset) % periodMs) + periodMs) % periodMs;
      /* A binary hold/release square wave is constant between most pairs of
       * sample times, so for some seeds it reads as frozen — to a gate AND to
       * a player who blinks. This is a CONTINUOUS pulse instead: sin^6 rises
       * hard and falls slowly, so it still reads as a snap, but the rotation
       * differs between any two distinct moments. holdMs shapes how much of
       * the cycle the pulse occupies. */
      const phase = cycle / periodMs;
      const pulse = Math.pow(Math.abs(Math.sin(Math.PI * phase)), sharp);
      target.rotation = base + snap * pulse;
    };

    if (ctx.motion) {
      setAt(0);
    } else {
      // Static variant: pinned straight, identical rules, no motion.
      target.rotation = base;
    }

    const stop: ModifierStop = () => {
      target.scale.x = origScaleX;
      target.scale.y = origScaleY;
      target.x = origX;
      target.y = origY;
      if (origRotation === undefined) delete target.rotation;
      else target.rotation = origRotation;
    };
    // motion=false ⇒ no reported movement: the board stays straight.
    if (ctx.motion) stop.step = (tMs: number): void => { setAt(tMs); };
    return stop;
  },
};

/**
 * Sharp Inhale: an asymmetric breath — quick inhale, slow exhale — distinct
 * from the symmetric breathing round. WHY asymmetric: a different rhythm
 * keeps the two breath rounds from syncing in players' heads. Implemented
 * as a two-segment cosine ease (28% rise, 72% fall) so the peak is smooth
 * and the scale never jumps. Swing is 4–8% so |scale| stays near 1.
 * Static mode pins a mid-breath scale (identical rules, no motion).
 */
const sharpInhaleModifier: RoundModifier = {
  id: 'sharp-inhale',
  banner: 'SHARP INHALE',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): ModifierStop => {
    const target = resolveBoardTarget(scene);
    if (!target) return () => {};

    const origScaleX = target.scale.x;
    const origScaleY = target.scale.y;
    const origX = target.x;
    const origY = target.y;
    const origRotation: number | undefined =
      typeof target.rotation === 'number' ? target.rotation : undefined;

    const rng = mulberry32((ctx.seed ^ Math.imul(ctx.depth, 0x1e4b7a3f)) >>> 0);
    const amp = 0.04 + rng() * 0.04; // 4–8% swell
    const periodMs = 3000 + rng() * 2000;
    const phaseFrac = rng(); // 0..1 seeded phase
    const inhaleFrac = 0.28; // 28% inhale, 72% exhale: WHY sharp in, slow out

    const setAt = (tMs: number): void => {
      const raw = tMs / periodMs + phaseFrac;
      const p = ((raw % 1) + 1) % 1;
      let eased: number;
      if (p < inhaleFrac) {
        eased = (1 - Math.cos(Math.PI * (p / inhaleFrac))) * 0.5;
      } else {
        eased = (1 + Math.cos(Math.PI * ((p - inhaleFrac) / (1 - inhaleFrac)))) * 0.5;
      }
      const s = 1 + amp * eased; // 1..1.08, always inside 0.85..1.15
      target.scale.x = origScaleX * s;
      target.scale.y = origScaleY * s;
    };

    if (ctx.motion) {
      setAt(0);
    } else {
      // Static variant: fixed mid-breath swell, identical rules, no motion.
      const s = 1 + amp * 0.5;
      target.scale.x = origScaleX * s;
      target.scale.y = origScaleY * s;
    }

    const stop: ModifierStop = () => {
      target.scale.x = origScaleX;
      target.scale.y = origScaleY;
      target.x = origX;
      target.y = origY;
      if (origRotation === undefined) delete target.rotation;
      else target.rotation = origRotation;
    };
    // motion=false ⇒ no reported movement: the swell stays pinned.
    if (ctx.motion) stop.step = (tMs: number): void => { setAt(tMs); };
    return stop;
  },
};

/**
 * Single-Axis Drift: a slow drift along ONE axis only (seeded horizontal or
 * vertical). WHY one axis: full 2D drift can smear the reading order, while
 * a single axis preserves it — rows stay rows or columns stay columns.
 * Amplitude 12–24 px keeps the board inside the 1600x900 stage with every
 * option clickable. Static mode pins a half-amplitude offset on the same
 * axis (identical rules, no motion).
 */
const singleAxisDriftModifier: RoundModifier = {
  id: 'single-axis-drift',
  banner: 'SIDE DRIFT',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): ModifierStop => {
    const target = resolveBoardTarget(scene);
    if (!target) return () => {};

    const origScaleX = target.scale.x;
    const origScaleY = target.scale.y;
    const origX = target.x;
    const origY = target.y;
    const origRotation: number | undefined =
      typeof target.rotation === 'number' ? target.rotation : undefined;

    const rng = mulberry32((ctx.seed ^ Math.imul(ctx.depth, 0x6d2c4e5a)) >>> 0);
    const useX = rng() < 0.5; // seeded axis choice
    const amp = 12 + rng() * 12; // 12–24 px, inside +-30
    const periodMs = 5000 + rng() * 4000;
    const phase = rng() * Math.PI * 2;

    const setAt = (tMs: number): void => {
      const v = amp * Math.sin((2 * Math.PI * tMs) / periodMs + phase);
      target.x = origX + (useX ? v : 0);
      target.y = origY + (useX ? 0 : v);
    };

    if (ctx.motion) {
      setAt(0);
    } else {
      // Static variant: fixed half-amplitude offset on the seeded axis.
      const v = amp * Math.sin(phase) * 0.5;
      target.x = origX + (useX ? v : 0);
      target.y = origY + (useX ? 0 : v);
    }

    const stop: ModifierStop = () => {
      target.scale.x = origScaleX;
      target.scale.y = origScaleY;
      target.x = origX;
      target.y = origY;
      if (origRotation === undefined) delete target.rotation;
      else target.rotation = origRotation;
    };
    // motion=false ⇒ no reported movement: the offset stays pinned.
    if (ctx.motion) stop.step = (tMs: number): void => { setAt(tMs); };
    return stop;
  },
};

/**
 * Barrel Roll: the board completes exactly one full turn mid-round, then
 * stays pinned at the completed turn. WHY a full 2π turn: it is coterminal
 * with straight, so after the roll the board is pixel-identical to upright
 * and answers stay stable. This modifier IS a rotation, so it is the one
 * case allowed past +-0.20 rad — the motion is the point. Direction and
 * duration (6–10 s) are seeded. Static mode pins the upright pose with no
 * spin, since a spin can never be reduced-motion safe.
 */
const barrelRollModifier: RoundModifier = {
  id: 'barrel-roll',
  banner: 'BARREL ROLL',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): ModifierStop => {
    const target = resolveBoardTarget(scene);
    if (!target) return () => {};

    const origScaleX = target.scale.x;
    const origScaleY = target.scale.y;
    const origX = target.x;
    const origY = target.y;
    const origRotation: number | undefined =
      typeof target.rotation === 'number' ? target.rotation : undefined;
    const base = origRotation ?? 0;

    const rng = mulberry32((ctx.seed ^ Math.imul(ctx.depth, 0x2b9f8a1d)) >>> 0);
    const dir = rng() < 0.5 ? 1 : -1;
    const durationMs = 6000 + rng() * 4000; // one full roll over 6–10 s

    const setAt = (tMs: number): void => {
      const t = tMs < 0 ? 0 : tMs;
      const k = Math.min(t / durationMs, 1); // linear roll, then pinned
      target.rotation = base + dir * Math.PI * 2 * k;
    };

    if (ctx.motion) {
      setAt(0);
    } else {
      // Static variant: pinned upright, identical rules, no motion.
      target.rotation = base;
    }

    const stop: ModifierStop = () => {
      target.scale.x = origScaleX;
      target.scale.y = origScaleY;
      target.x = origX;
      target.y = origY;
      if (origRotation === undefined) delete target.rotation;
      else target.rotation = origRotation;
    };
    // motion=false ⇒ no reported movement: no spin is reported.
    if (ctx.motion) stop.step = (tMs: number): void => { setAt(tMs); };
    return stop;
  },
};

/**
 * Figure-Eight Drift: the board centre traces a seeded figure-eight
 * (Lissajous 1:2) using x/y only — the tilt-like tracking feel without any
 * new field. WHY the eight: it exercises pursuit in both axes yet crosses
 * its own centre twice per loop, so the board keeps returning home and
 * corners never strand off-panel. The y lobe is halved so the eight stands
 * upright on a wide stage and stays inside +-30 px. Static mode pins the
 * seeded t=0 point on the loop.
 */
const figureEightDriftModifier: RoundModifier = {
  id: 'figure-eight-drift',
  banner: 'FIGURE EIGHT',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): ModifierStop => {
    const target = resolveBoardTarget(scene);
    if (!target) return () => {};

    const origScaleX = target.scale.x;
    const origScaleY = target.scale.y;
    const origX = target.x;
    const origY = target.y;
    const origRotation: number | undefined =
      typeof target.rotation === 'number' ? target.rotation : undefined;

    const rng = mulberry32((ctx.seed ^ Math.imul(ctx.depth, 0x4d1a7c33)) >>> 0);
    const ax = 10 + rng() * 10; // 10–20 px horizontal lobe
    const ay = 8 + rng() * 8; // 8–16 px before halving → y stays small
    const periodMs = 6000 + rng() * 4000;
    const phase = rng() * Math.PI * 2;

    const setAt = (tMs: number): void => {
      const a = (2 * Math.PI * tMs) / periodMs + phase;
      target.x = origX + ax * Math.sin(a);
      target.y = origY + ay * 0.5 * Math.sin(2 * a);
    };

    if (ctx.motion) {
      setAt(0);
    } else {
      // Static variant: pinned at the seeded t=0 point on the loop.
      const a = phase;
      target.x = origX + ax * Math.sin(a);
      target.y = origY + ay * 0.5 * Math.sin(2 * a);
    }

    const stop: ModifierStop = () => {
      target.scale.x = origScaleX;
      target.scale.y = origScaleY;
      target.x = origX;
      target.y = origY;
      if (origRotation === undefined) delete target.rotation;
      else target.rotation = origRotation;
    };
    // motion=false ⇒ no reported movement: the loop point stays pinned.
    if (ctx.motion) stop.step = (tMs: number): void => { setAt(tMs); };
    return stop;
  },
};

/**
 * Prime Pulse: a scale pulse on a prime-number rhythm (2, 3, 5 or 7 s,
 * seeded). WHY prime: prime periods refuse to sync with the breathing and
 * wobble periods, so stacked rounds stay polyrhythmic instead of locking
 * into one throb. The pulse shape is a squared half-sine — swelling and
 * releasing smoothly — with 5–9% swell so |scale| stays inside 0.85..1.15.
 * Static mode pins a quarter-pulse swell (identical rules, no motion).
 */
const primePulseModifier: RoundModifier = {
  id: 'prime-pulse',
  banner: 'PRIME PULSE',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): ModifierStop => {
    const target = resolveBoardTarget(scene);
    if (!target) return () => {};

    const origScaleX = target.scale.x;
    const origScaleY = target.scale.y;
    const origX = target.x;
    const origY = target.y;
    const origRotation: number | undefined =
      typeof target.rotation === 'number' ? target.rotation : undefined;

    const rng = mulberry32((ctx.seed ^ Math.imul(ctx.depth, 0x71c2e8a5)) >>> 0);
    const primes = [2, 3, 5, 7];
    const idx = Math.floor(rng() * primes.length);
    const prime = primes[idx] ?? 3;
    const periodMs = prime * 1000; // prime-second rhythm: WHY no sync
    const amp = 0.05 + rng() * 0.04; // 5–9% swell
    const phase = rng() * Math.PI * 2;

    const setAt = (tMs: number): void => {
      const s = Math.sin((2 * Math.PI * tMs) / periodMs + phase);
      const pulse = s <= 0 ? 0 : s * s; // squared half-sine pulse 0..1
      const k = 1 + amp * pulse; // 1..1.09
      target.scale.x = origScaleX * k;
      target.scale.y = origScaleY * k;
    };

    if (ctx.motion) {
      setAt(0);
    } else {
      // Static variant: fixed quarter-pulse swell, identical rules.
      const k = 1 + amp * 0.25;
      target.scale.x = origScaleX * k;
      target.scale.y = origScaleY * k;
    }

    const stop: ModifierStop = () => {
      target.scale.x = origScaleX;
      target.scale.y = origScaleY;
      target.x = origX;
      target.y = origY;
      if (origRotation === undefined) delete target.rotation;
      else target.rotation = origRotation;
    };
    // motion=false ⇒ no reported movement: the swell stays pinned.
    if (ctx.motion) stop.step = (tMs: number): void => { setAt(tMs); };
    return stop;
  },
};

/**
 * Seesaw Wobble: scale.x and scale.y oscillate in opposition — as width
 * grows, height shrinks, and back. WHY opposition: area stays roughly
 * constant so glyphs shear rather than balloon, keeping text legible while
 * the wobble is unmistakable. Swing is 4–8% per axis so each |scale| stays
 * inside 0.85..1.15. Static mode pins a half-wobble pose (identical rules,
 * no motion). Teardown restores the exact scale.
 */
const seesawWobbleModifier: RoundModifier = {
  id: 'seesaw-wobble',
  banner: 'SEESAW WOBBLE',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): ModifierStop => {
    const target = resolveBoardTarget(scene);
    if (!target) return () => {};

    const origScaleX = target.scale.x;
    const origScaleY = target.scale.y;
    const origX = target.x;
    const origY = target.y;
    const origRotation: number | undefined =
      typeof target.rotation === 'number' ? target.rotation : undefined;

    const rng = mulberry32((ctx.seed ^ Math.imul(ctx.depth, 0x1a9e4b7c)) >>> 0);
    const amp = 0.04 + rng() * 0.04; // 4–8% per axis
    const periodMs = 2200 + rng() * 1800;
    const phase = rng() * Math.PI * 2;

    const setAt = (tMs: number): void => {
      const w = amp * Math.sin((2 * Math.PI * tMs) / periodMs + phase);
      target.scale.x = origScaleX * (1 + w);
      target.scale.y = origScaleY * (1 - w);
    };

    if (ctx.motion) {
      setAt(0);
    } else {
      // Static variant: fixed half-wobble pose, identical rules, no motion.
      const w = amp * Math.sin(phase) * 0.5;
      target.scale.x = origScaleX * (1 + w);
      target.scale.y = origScaleY * (1 - w);
    }

    const stop: ModifierStop = () => {
      target.scale.x = origScaleX;
      target.scale.y = origScaleY;
      target.x = origX;
      target.y = origY;
      if (origRotation === undefined) delete target.rotation;
      else target.rotation = origRotation;
    };
    // motion=false ⇒ no reported movement: the pose stays pinned.
    if (ctx.motion) stop.step = (tMs: number): void => { setAt(tMs); };
    return stop;
  },
};

/**
 * Slow Orbit: the board circles slowly around its home point, like a stage
 * turntable. WHY a circle: constant radius means constant worst-case offset,
 * so capping the radius at 12–22 px trivially keeps every option on the
 * 1600x900 stage and clickable. The period is 12–20 s — deliberately the
 * slowest motion in the set — so aiming stays calm. Static mode pins the
 * seeded t=0 orbital point (identical rules, no motion).
 */
const slowOrbitModifier: RoundModifier = {
  id: 'slow-orbit',
  banner: 'SLOW ORBIT',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): ModifierStop => {
    const target = resolveBoardTarget(scene);
    if (!target) return () => {};

    const origScaleX = target.scale.x;
    const origScaleY = target.scale.y;
    const origX = target.x;
    const origY = target.y;
    const origRotation: number | undefined =
      typeof target.rotation === 'number' ? target.rotation : undefined;

    const rng = mulberry32((ctx.seed ^ Math.imul(ctx.depth, 0x3d5f2a18)) >>> 0);
    const radius = 12 + rng() * 10; // 12–22 px, inside +-30
    const periodMs = 12000 + rng() * 8000; // slowest motion in the set
    const phase = rng() * Math.PI * 2;

    const setAt = (tMs: number): void => {
      const a = (2 * Math.PI * tMs) / periodMs + phase;
      target.x = origX + radius * Math.cos(a);
      target.y = origY + radius * Math.sin(a);
    };

    if (ctx.motion) {
      setAt(0);
    } else {
      // Static variant: pinned at the seeded orbital point, no motion.
      target.x = origX + radius * Math.cos(phase);
      target.y = origY + radius * Math.sin(phase);
    }

    const stop: ModifierStop = () => {
      target.scale.x = origScaleX;
      target.scale.y = origScaleY;
      target.x = origX;
      target.y = origY;
      if (origRotation === undefined) delete target.rotation;
      else target.rotation = origRotation;
    };
    // motion=false ⇒ no reported movement: the orbital point stays pinned.
    if (ctx.motion) stop.step = (tMs: number): void => { setAt(tMs); };
    return stop;
  },
};

/**
 * Settling Jitter: a fast two-tone jitter on both axes that decays
 * exponentially to stillness. WHY summed sines: they look like jitter yet
 * stay a pure function of tMs (no accumulators, fully reproducible), unlike
 * frame-to-frame noise. WHY the decay: early chaos resolves into a stable
 * late round, so the puzzle is never decided by a shake. Initial swing is
 * 10–18 px and only shrinks, so translation stays inside +-30 px. Static
 * mode pins a quarter-magnitude offset of the t=0 jitter (no shaking).
 */
const decayingJitterModifier: RoundModifier = {
  id: 'decaying-jitter',
  banner: 'SETTLING JITTER',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): ModifierStop => {
    const target = resolveBoardTarget(scene);
    if (!target) return () => {};

    const origScaleX = target.scale.x;
    const origScaleY = target.scale.y;
    const origX = target.x;
    const origY = target.y;
    const origRotation: number | undefined =
      typeof target.rotation === 'number' ? target.rotation : undefined;

    const rng = mulberry32((ctx.seed ^ Math.imul(ctx.depth, 0x5a3c7e21)) >>> 0);
    const baseAmp = 10 + rng() * 8; // 10–18 px initial swing
    const tauMs = 1500 + rng() * 1000; // decay constant 1.5–2.5 s
    const p1x = 90 + rng() * 60;
    const p2x = 130 + rng() * 80;
    const p1y = 100 + rng() * 70;
    const p2y = 140 + rng() * 90;
    const ph1x = rng() * Math.PI * 2;
    const ph2x = rng() * Math.PI * 2;
    const ph1y = rng() * Math.PI * 2;
    const ph2y = rng() * Math.PI * 2;

    const offsetAt = (tMs: number): { dx: number; dy: number } => {
      const t = tMs < 0 ? 0 : tMs;
      const decay = Math.exp(-t / tauMs); // 1 → 0: WHY stillness is guaranteed
      const dx = baseAmp * decay * (0.6 * Math.sin((2 * Math.PI * t) / p1x + ph1x) + 0.4 * Math.sin((2 * Math.PI * t) / p2x + ph2x));
      const dy = baseAmp * decay * (0.6 * Math.sin((2 * Math.PI * t) / p1y + ph1y) + 0.4 * Math.sin((2 * Math.PI * t) / p2y + ph2y));
      return { dx, dy };
    };

    const setAt = (tMs: number): void => {
      const { dx, dy } = offsetAt(tMs);
      target.x = origX + dx;
      target.y = origY + dy;
    };

    if (ctx.motion) {
      setAt(0);
    } else {
      // Static variant: fixed quarter of the t=0 jitter, identical rules.
      const { dx, dy } = offsetAt(0);
      target.x = origX + dx * 0.25;
      target.y = origY + dy * 0.25;
    }

    const stop: ModifierStop = () => {
      target.scale.x = origScaleX;
      target.scale.y = origScaleY;
      target.x = origX;
      target.y = origY;
      if (origRotation === undefined) delete target.rotation;
      else target.rotation = origRotation;
    };
    // motion=false ⇒ no reported movement: the offset stays pinned.
    if (ctx.motion) stop.step = (tMs: number): void => { setAt(tMs); };
    return stop;
  },
};

/** The second-batch registry of round modifiers. */
export const MODIFIERS2: RoundModifier[] = [
  pendulumSwayModifier,
  snapRotateModifier,
  sharpInhaleModifier,
  singleAxisDriftModifier,
  barrelRollModifier,
  figureEightDriftModifier,
  primePulseModifier,
  seesawWobbleModifier,
  slowOrbitModifier,
  decayingJitterModifier,
];
