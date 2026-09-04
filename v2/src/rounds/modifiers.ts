/* ============================================================================
 * ROUND MODIFIERS — pure rules, deterministic application, and teardowns for
 * in-round gameplay twists.
 *
 * Designed to run headless under node (zero Pixi, zero DOM) using duck-typed
 * container targets, while integrating cleanly with the Pixi render tree in
 * client scenes.
 *
 * All randomness is seeded strictly from ctx.seed and ctx.depth using a local
 * mulberry32 generator — no Math.random, no Date.now.
 * ==========================================================================*/

import { MODIFIERS2 } from './modifiers2.ts';

export interface ModCtx {
  depth: number;
  seed: number;
  layer: number;
  align: string;
  motion: boolean;
}

export interface RoundModifier {
  id: string;
  when(ctx: ModCtx): boolean;
  apply(ctx: ModCtx, scene: unknown): ModifierStop;
  banner?: string;
}

/**
 * Teardown returned by apply(). Optionally exposes a pure step(tMs) that the
 * scene frame-loop drives; time arrives only as this argument (no ambient
 * clock, no Date.now). Calling stop() always restores the pre-apply state
 * exactly.
 */
export type ModifierStop = (() => void) & {
  step?: (tMs: number) => void;
};

/** Duck-typed container interface matching Pixi Container transform props. */
export interface BoardTarget {
  scale: { x: number; y: number };
  x: number;
  y: number;
  /** Radians. Set by rotate-90. */
  rotation?: number;
  /** Fog-bank occlusion (alpha ≤ 0.4 → board always ≥ 60% visible). */
  fog?: { alpha: number; x: number; y: number; r: number };
  /** Ink-splatter occlusion (alpha decays to 0 as it wipes away). */
  ink?: { alpha: number; x: number; y: number; r: number };
  /**
   * Scanline-roll band. f = band centre as a fraction of board-panel height
   * (0 = top, 1 = bottom); main.ts maps it onto the board column so the band
   * always stays inside the panel. Alpha ≤ 0.4 → board always ≥ 60% visible.
   */
  scanline?: { f: number; bandH: number; alpha: number };
  /** Tilt-3d perspective pitch (radians). */
  tilt?: { pitch: number };
  /** Piano-keys restyle flag for the option tiles. */
  pianoKeys?: boolean;
  /** Inverted-controls flag. */
  inverted?: boolean;
  /**
   * Inverted-controls INPUT MAP, the pure state main.ts actually installs:
   * clicking the tile in slot `i` selects option `invertMap[i]`. It is a
   * permutation, so every option stays reachable — the board is unchanged and
   * which option is CORRECT is unchanged; only the route to it is mirrored.
   * The flag above says "this round is inverted"; this array says how.
   */
  invertMap?: number[];
  /** Option-shuffle permutation of the 8 option slots. */
  optionOrder?: number[];
}

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
 * Mirror Flip: horizontally inverts the board container (scale.x = -1) with a
 * slow seeded wobble around the flipped scale. Time arrives only via the
 * exposed pure step(tMs); the scene frame-loop drives it. Static mode pins the
 * plain flip (identical rules, no motion). Teardown restores the exact
 * previous scale and position.
 */
const mirrorFlipModifier: RoundModifier = {
  id: 'mirror-flip',
  banner: 'MIRROR FLIP',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): ModifierStop => {
    const target = resolveBoardTarget(scene);
    if (!target) return () => {};

    const origScaleX = target.scale.x;
    const origScaleY = target.scale.y;
    const origX = target.x;
    const origY = target.y;

    const rng = mulberry32((ctx.seed ^ Math.imul(ctx.depth, 0x45d9f3b)) >>> 0);
    const flippedX = origScaleX > 0 ? -origScaleX : -1;
    const wobbleSpeed = 0.5 + rng() * 0.5;
    // Same cadence the old 16 ms tick produced (0.05 rad/tick × wobbleSpeed),
    // now expressed per millisecond so the state is a pure function of tMs.
    const wobbleRadPerMs = (0.05 * wobbleSpeed) / 16;

    const setAt = (tMs: number): void => {
      target.scale.x = flippedX + Math.sin(wobbleRadPerMs * tMs) * 0.02;
    };

    if (ctx.motion) {
      setAt(0); // plain flip at t=0; the wobble grows from here
    } else {
      // Static variant: plain flip, identical rules, no motion.
      target.scale.x = flippedX;
    }

    const stop: ModifierStop = () => {
      target.scale.x = origScaleX;
      target.scale.y = origScaleY;
      target.x = origX;
      target.y = origY;
    };
    // motion=false ⇒ no reported movement, same rail as the chaos bus: the
    // board stays pinned at its plain flip.
    if (ctx.motion) stop.step = (tMs: number): void => { setAt(tMs); };
    return stop;
  },
};

/**
 * Board Drift: slow deterministic drift of the board container. Time arrives
 * only via the exposed pure step(tMs); the scene frame-loop drives it. Static
 * mode (motion=false) applies a fixed half-amplitude offset (identical rules,
 * no motion). Teardown restores the exact previous coordinates and scale.
 */
const boardDriftModifier: RoundModifier = {
  id: 'board-drift',
  banner: 'BOARD DRIFT',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): ModifierStop => {
    const target = resolveBoardTarget(scene);
    if (!target) return () => {};

    const origScaleX = target.scale.x;
    const origScaleY = target.scale.y;
    const origX = target.x;
    const origY = target.y;

    const rng = mulberry32((ctx.seed ^ Math.imul(ctx.depth, 0x9e3779b9)) >>> 0);
    const angle = rng() * Math.PI * 2;
    const amplitude = 12 + rng() * 12;
    const speed = 0.8 + rng() * 0.6;
    // Same cadence the old 16 ms tick produced (0.05 rad/tick × speed), now
    // expressed per millisecond so the state is a pure function of tMs.
    const driftRadPerMs = (0.05 * speed) / 16;

    const setAt = (tMs: number): void => {
      const t = driftRadPerMs * tMs;
      target.x = origX + Math.cos(angle + t) * amplitude;
      target.y = origY + Math.sin(angle + t * 0.7) * amplitude;
    };

    if (ctx.motion) {
      setAt(0); // full-amplitude seeded offset at t=0; the drift grows from here
    } else {
      // Static variant: fixed half-amplitude seeded offset, identical rules.
      target.x = origX + Math.cos(angle) * (amplitude * 0.5);
      target.y = origY + Math.sin(angle) * (amplitude * 0.5);
    }

    const stop: ModifierStop = () => {
      target.scale.x = origScaleX;
      target.scale.y = origScaleY;
      target.x = origX;
      target.y = origY;
    };
    // motion=false ⇒ no reported movement, same rail as the chaos bus: the
    // board stays pinned at its seeded half-amplitude offset.
    if (ctx.motion) stop.step = (tMs: number): void => { setAt(tMs); };
    return stop;
  },
};

/**
 * Rotate-90: rotates the board container a quarter turn (seeded direction).
 * A pure transform — identical under motion and static. Teardown restores the
 * exact previous rotation (including the absent case).
 */
const rotate90Modifier: RoundModifier = {
  id: 'rotate-90',
  banner: 'BOARD ROTATED 90°',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): ModifierStop => {
    const target = resolveBoardTarget(scene);
    if (!target) return () => {};

    const origRotation: number | undefined =
      typeof target.rotation === 'number' ? target.rotation : undefined;

    const rng = mulberry32((ctx.seed ^ Math.imul(ctx.depth, 0x27d1b6e3)) >>> 0);
    const dir = rng() < 0.5 ? 1 : -1;
    target.rotation = (origRotation ?? 0) + dir * (Math.PI / 2);

    return () => {
      if (origRotation === undefined) delete target.rotation;
      else target.rotation = origRotation;
    };
  },
};

/**
 * Breathing: slow deterministic scale oscillation. Time arrives only via the
 * exposed pure step(tMs); the scene frame-loop drives it. Static mode applies
 * a fixed mid-breath scale (identical rules, no motion). Teardown restores the
 * exact previous scale.
 */
const breathingModifier: RoundModifier = {
  id: 'breathing',
  banner: 'THE BOARD IS BREATHING',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): ModifierStop => {
    const target = resolveBoardTarget(scene);
    if (!target) return () => {};

    const origScaleX = target.scale.x;
    const origScaleY = target.scale.y;

    const rng = mulberry32((ctx.seed ^ Math.imul(ctx.depth, 0x9666f0f9)) >>> 0);
    const amp = 0.04 + rng() * 0.04;        // 4–8% scale swing
    const periodMs = 2400 + rng() * 1200;   // slow breath
    const phase = rng() * Math.PI * 2;

    const setAt = (tMs: number): void => {
      const s = 1 + amp * Math.sin((2 * Math.PI * tMs) / periodMs + phase);
      target.scale.x = origScaleX * s;
      target.scale.y = origScaleY * s;
    };

    if (ctx.motion) {
      setAt(0);
    } else {
      // Static variant: fixed mid-breath scale, identical rules, no motion.
      target.scale.x = origScaleX * (1 + amp * 0.5);
      target.scale.y = origScaleY * (1 + amp * 0.5);
    }

    const stop: ModifierStop = () => {
      target.scale.x = origScaleX;
      target.scale.y = origScaleY;
    };
    stop.step = (tMs: number): void => {
      setAt(tMs);
    };
    return stop;
  },
};

/**
 * Lurch: a one-shot positional jolt that decays to zero over ~400 ms. Time
 * arrives only via the exposed pure step(tMs); the scene frame-loop drives it.
 * Static mode applies a fixed quarter-magnitude offset (identical rules, no
 * motion). Teardown restores the exact previous position.
 */
const lurchModifier: RoundModifier = {
  id: 'lurch',
  banner: 'THE BOARD LURCHES',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): ModifierStop => {
    const target = resolveBoardTarget(scene);
    if (!target) return () => {};

    const origX = target.x;
    const origY = target.y;

    const rng = mulberry32((ctx.seed ^ Math.imul(ctx.depth, 0x6a09e667)) >>> 0);
    const angle = rng() * Math.PI * 2;
    const mag = 14 + rng() * 10; // 14–24 px jolt
    const dx = Math.cos(angle) * mag;
    const dy = Math.sin(angle) * mag;
    const durationMs = 400;

    const setAt = (tMs: number): void => {
      const k = Math.max(0, 1 - tMs / durationMs); // linear decay to exactly 0
      target.x = origX + dx * k;
      target.y = origY + dy * k;
    };

    if (ctx.motion) {
      setAt(0); // full jolt at t=0
    } else {
      // Static variant: fixed quarter-magnitude offset, identical rules.
      target.x = origX + dx * 0.25;
      target.y = origY + dy * 0.25;
    }

    const stop: ModifierStop = () => {
      target.x = origX;
      target.y = origY;
    };
    // motion=false ⇒ no reported movement, same rail as the chaos bus: the
    // splatter stays pinned at its seeded mid-wipe alpha.
    if (ctx.motion) stop.step = (tMs: number): void => { setAt(tMs); };
    return stop;
  },
};

/**
 * Inverted-controls: flips input direction for the round. Pure flag on the
 * target; identical under motion and static. The banner MUST announce the
 * control change. Teardown restores the exact previous flag state.
 */
const invertedControlsModifier: RoundModifier = {
  id: 'inverted-controls',
  banner: 'CONTROLS INVERTED',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): ModifierStop => {
    const target = resolveBoardTarget(scene);
    if (!target) return () => {};

    const origInverted: boolean | undefined =
      typeof target.inverted === 'boolean' ? target.inverted : undefined;
    const origMap: number[] | undefined =
      Array.isArray(target.invertMap) ? [...target.invertMap] : undefined;

    /* The 8 option slots are a 4x2 grid. Reversing the whole run — slot i
     * selects option 7-i — mirrors the grid in BOTH axes, which is the
     * strongest, most readable inversion available and is still a
     * permutation: every option remains reachable from exactly one slot, so
     * the round can never become unsolvable. Identical under motion and
     * static (no step is exposed): this is an input mapping, not an
     * animation, so the reduced-motion variant is the same round. */
    const map: number[] = [];
    for (let i = 0; i < 8; i++) map.push(7 - i);

    target.inverted = true;
    target.invertMap = map;

    return () => {
      if (origInverted === undefined) delete target.inverted;
      else target.inverted = origInverted;
      if (origMap === undefined) delete target.invertMap;
      else target.invertMap = origMap;
    };
  },
};

/**
 * Option-shuffle: permutes the 8 option slots with a seeded Fisher-Yates.
 * Pure data on the target; identical under motion and static. The banner MUST
 * announce that the options moved. Teardown restores the exact previous
 * optionOrder (deletes it if absent).
 */
const optionShuffleModifier: RoundModifier = {
  id: 'option-shuffle',
  banner: 'OPTIONS HAVE MOVED',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): ModifierStop => {
    const target = resolveBoardTarget(scene);
    if (!target) return () => {};

    const origOrder: number[] | undefined =
      Array.isArray(target.optionOrder) ? [...target.optionOrder] : undefined;

    const rng = mulberry32((ctx.seed ^ Math.imul(ctx.depth, 0x1266e2c5)) >>> 0);
    const order = [0, 1, 2, 3, 4, 5, 6, 7];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = order[i]!;
      order[i] = order[j]!;
      order[j] = tmp;
    }
    target.optionOrder = order;

    return () => {
      if (origOrder === undefined) delete target.optionOrder;
      else target.optionOrder = origOrder;
    };
  },
};

/**
 * Fog-bank: a drifting partial occlusion. Alpha is capped at 0.4 so the board
 * is always ≥ 60% visible. Time arrives only via the exposed pure step(tMs);
 * the scene frame-loop drives the drift. Static mode pins the fog at its
 * seeded center (identical rules, no motion). Teardown removes the fog (or
 * restores the exact previous fog state).
 */
const fogBankModifier: RoundModifier = {
  id: 'fog-bank',
  banner: 'A FOG BANK ROLLS IN',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): ModifierStop => {
    const target = resolveBoardTarget(scene);
    if (!target) return () => {};

    const origFog: { alpha: number; x: number; y: number; r: number } | undefined =
      target.fog ? { ...target.fog } : undefined;

    const rng = mulberry32((ctx.seed ^ Math.imul(ctx.depth, 0x9e2a15ab)) >>> 0);
    const alpha = 0.2 + rng() * 0.2; // 0.2–0.4 → board always ≥ 60% visible
    const r = 90 + rng() * 60; // fog radius
    const cx = (rng() - 0.5) * 160; // drift center, board-relative
    const cy = (rng() - 0.5) * 100;
    const driftR = 30 + rng() * 30;
    const periodMs = 5000 + rng() * 3000;
    const phase = rng() * Math.PI * 2;

    const setAt = (tMs: number): void => {
      const a = (2 * Math.PI * tMs) / periodMs + phase;
      target.fog = {
        alpha,
        x: cx + driftR * Math.cos(a),
        y: cy + driftR * Math.sin(a),
        r,
      };
    };

    if (ctx.motion) {
      setAt(0);
    } else {
      // Static variant: fog pinned at its seeded center, identical rules.
      target.fog = { alpha, x: cx, y: cy, r };
    }

    const stop: ModifierStop = () => {
      if (origFog === undefined) delete target.fog;
      else target.fog = { ...origFog };
    };
    // motion=false ⇒ no reported movement, same rail as the chaos bus: the
    // bank stays pinned at its seeded centre.
    if (ctx.motion) stop.step = (tMs: number): void => { setAt(tMs); };
    return stop;
  },
};

/**
 * Ink-splatter: an occlusion that wipes away. Alpha starts at a seeded value
 * (≤ 0.4 → board always ≥ 60% visible) and decays to 0 over a seeded duration
 * via the exposed pure step(tMs); the scene frame-loop drives it. Static mode
 * applies a fixed mid-wipe alpha (identical rules, no motion). Teardown removes
 * the ink (or restores the exact previous ink state).
 */
const inkSplatterModifier: RoundModifier = {
  id: 'ink-splatter',
  banner: 'INK SPLATTERS ACROSS THE BOARD',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): ModifierStop => {
    const target = resolveBoardTarget(scene);
    if (!target) return () => {};

    const origInk: { alpha: number; x: number; y: number; r: number } | undefined =
      target.ink ? { ...target.ink } : undefined;

    const rng = mulberry32((ctx.seed ^ Math.imul(ctx.depth, 0x8f14e456)) >>> 0);
    const startAlpha = 0.2 + rng() * 0.2; // 0.2–0.4 → board always ≥ 60% visible
    const r = 70 + rng() * 50;
    const x = (rng() - 0.5) * 140;
    const y = (rng() - 0.5) * 90;
    const durationMs = 1200 + rng() * 800; // wipe-away time

    const setAt = (tMs: number): void => {
      const k = Math.max(0, 1 - tMs / durationMs); // linear wipe to exactly 0
      target.ink = { alpha: startAlpha * k, x, y, r };
    };

    if (ctx.motion) {
      setAt(0);
    } else {
      // Static variant: fixed mid-wipe alpha, identical rules, no motion.
      target.ink = { alpha: startAlpha * 0.5, x, y, r };
    }

    const stop: ModifierStop = () => {
      if (origInk === undefined) delete target.ink;
      else target.ink = { ...origInk };
    };
    // motion=false ⇒ no reported movement, same rail as the chaos bus: the
    // splatter stays pinned at its seeded mid-wipe alpha.
    if (ctx.motion) stop.step = (tMs: number): void => { setAt(tMs); };
    return stop;
  },
};

/**
 * Scanline-roll: a rolling scanline band sweeping across the board. Alpha is
 * capped at 0.4 so the board is always ≥ 60% visible. Time arrives only via the
 * exposed pure step(tMs); the scene frame-loop drives the roll. Static mode
 * pins the band at its seeded position (identical rules, no motion). Teardown
 * removes the scanline (or restores the exact previous scanline state).
 */
const scanlineRollModifier: RoundModifier = {
  id: 'scanline-roll',
  banner: 'A SCANLINE ROLLS ACROSS',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): ModifierStop => {
    const target = resolveBoardTarget(scene);
    if (!target) return () => {};

    const origScanline: { f: number; bandH: number; alpha: number } | undefined =
      target.scanline ? { ...target.scanline } : undefined;

    const rng = mulberry32((ctx.seed ^ Math.imul(ctx.depth, 0x2c58f1a3)) >>> 0);
    const alpha = 0.2 + rng() * 0.2; // 0.2–0.4 → board always ≥ 60% visible
    const bandH = 24 + rng() * 24;
    const travelF = 0.25 + rng() * 0.2; // centre sweeps 0.5±(0.25..0.45) of panel height
    const periodMs = 3000 + rng() * 2000;
    const phase = rng() * Math.PI * 2;

    const setAt = (tMs: number): void => {
      const a = (2 * Math.PI * tMs) / periodMs + phase;
      target.scanline = {
        f: 0.5 + travelF * Math.sin(a),
        bandH,
        alpha,
      };
    };

    if (ctx.motion) {
      setAt(0);
    } else {
      // Static variant: band pinned at its seeded t=0 position, identical rules.
      target.scanline = { f: 0.5 + travelF * Math.sin(phase), bandH, alpha };
    }

    const stop: ModifierStop = () => {
      if (origScanline === undefined) delete target.scanline;
      else target.scanline = { ...origScanline };
    };
    // motion=false ⇒ no reported movement, same rail as the chaos bus: the
    // band stays pinned at its seeded position.
    if (ctx.motion) stop.step = (tMs: number): void => { setAt(tMs); };
    return stop;
  },
};

/**
 * Piano-keys: restyles the option tiles as piano keys. Pure flag on the
 * target; identical under motion and static. Teardown restores the exact
 * previous flag state (deletes it if absent).
 */
const pianoKeysModifier: RoundModifier = {
  id: 'piano-keys',
  banner: 'OPTIONS ARE PIANO KEYS',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): ModifierStop => {
    const target = resolveBoardTarget(scene);
    if (!target) return () => {};

    const origPianoKeys: boolean | undefined =
      typeof target.pianoKeys === 'boolean' ? target.pianoKeys : undefined;
    target.pianoKeys = true;

    return () => {
      if (origPianoKeys === undefined) delete target.pianoKeys;
      else target.pianoKeys = origPianoKeys;
    };
  },
};

/**
 * Tilt-3d: a 2D-to-3D perspective tilt (pitch in radians). Motion mode
 * oscillates the pitch slowly via the exposed pure step(tMs); the scene
 * frame-loop drives it. Static mode applies a fixed seeded pitch (identical
 * rules, no motion). Teardown removes the tilt (or restores the exact
 * previous tilt state).
 */
const tilt3dModifier: RoundModifier = {
  id: 'tilt-3d',
  banner: 'THE BOARD TILTS IN 3D',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): ModifierStop => {
    const target = resolveBoardTarget(scene);
    if (!target) return () => {};

    const origTilt: { pitch: number } | undefined =
      target.tilt ? { ...target.tilt } : undefined;

    const rng = mulberry32((ctx.seed ^ Math.imul(ctx.depth, 0x7d4a8e21)) >>> 0);
    const basePitch = 0.15 + rng() * 0.15; // 0.15–0.30 rad base tilt
    const swing = 0.05 + rng() * 0.05; // ± swing around the base
    const periodMs = 4000 + rng() * 2000;
    const phase = rng() * Math.PI * 2;

    const setAt = (tMs: number): void => {
      target.tilt = {
        pitch: basePitch + swing * Math.sin((2 * Math.PI * tMs) / periodMs + phase),
      };
    };

    if (ctx.motion) {
      setAt(0);
    } else {
      // Static variant: fixed seeded pitch, identical rules, no motion.
      target.tilt = { pitch: basePitch };
    }

    const stop: ModifierStop = () => {
      if (origTilt === undefined) delete target.tilt;
      else target.tilt = { ...origTilt };
    };
    // motion=false ⇒ no reported movement, same rail as the chaos bus: the
    // board stays pinned at its seeded base pitch.
    if (ctx.motion) stop.step = (tMs: number): void => { setAt(tMs); };
    return stop;
  },
};

/** The active registry of round modifiers. */
/* Batch two lives in its own file and imports only TYPES from here, so this
 * value import is a one-way edge at runtime — no cycle. Appending them means
 * pickModifiers and the gate both cover all 22 without a second code path:
 * the gate's ambient-clock trap and step-purity checks apply to them free. */
export const MODIFIERS: RoundModifier[] = [
  ...MODIFIERS2,
  mirrorFlipModifier,
  boardDriftModifier,
  rotate90Modifier,
  breathingModifier,
  lurchModifier,
  invertedControlsModifier,
  optionShuffleModifier,
  fogBankModifier,
  inkSplatterModifier,
  scanlineRollModifier,
  pianoKeysModifier,
  tilt3dModifier,
];

/**
 * Deterministically picks up to `max` modifiers eligible for the given context.
 */
export function pickModifiers(ctx: ModCtx, max: number): RoundModifier[] {
  if (max <= 0) return [];
  const eligible = MODIFIERS.filter((m) => m.when(ctx));
  if (eligible.length === 0) return [];

  const rng = mulberry32((ctx.seed ^ Math.imul(ctx.depth, 0x85ebca6b)) >>> 0);
  const pool = [...eligible];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  return pool.slice(0, Math.max(0, Math.min(max, pool.length)));
}
