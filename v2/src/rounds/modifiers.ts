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
  /** Scanline-roll band (partial height, alpha ≤ 0.4). */
  scanline?: { y: number; bandH: number; alpha: number };
  /** Tilt-3d perspective pitch (radians). */
  tilt?: { pitch: number };
  /** Piano-keys restyle flag for the option tiles. */
  pianoKeys?: boolean;
  /** Inverted-controls flag. */
  inverted?: boolean;
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
 * Mirror Flip: horizontally inverts the board container (scale.x = -1).
 * Teardown cleanly restores previous scale and position.
 */
const mirrorFlipModifier: RoundModifier = {
  id: 'mirror-flip',
  banner: 'MIRROR FLIP',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): (() => void) => {
    const target = resolveBoardTarget(scene);
    if (!target) return () => {};

    const origScaleX = target.scale.x;
    const origScaleY = target.scale.y;
    const origX = target.x;
    const origY = target.y;

    const rng = mulberry32((ctx.seed ^ Math.imul(ctx.depth, 0x45d9f3b)) >>> 0);
    target.scale.x = origScaleX > 0 ? -origScaleX : -1;

    let timer: ReturnType<typeof setInterval> | null = null;
    if (ctx.motion) {
      const wobbleSpeed = 0.5 + rng() * 0.5;
      let step = 0;
      if (typeof setInterval !== 'undefined') {
        timer = setInterval(() => {
          step++;
          const t = step * 0.05 * wobbleSpeed;
          target.scale.x = (origScaleX > 0 ? -origScaleX : -1) + Math.sin(t) * 0.02;
        }, 16);
        if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
          (timer as { unref: () => void }).unref();
        }
      }
    }

    return () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      target.scale.x = origScaleX;
      target.scale.y = origScaleY;
      target.x = origX;
      target.y = origY;
    };
  },
};

/**
 * Board Drift: slow deterministic drift of the board container.
 * Static mode (motion=false) applies a fixed deterministic offset with zero timer overhead.
 * Teardown cleanly restores previous coordinates and scale.
 */
const boardDriftModifier: RoundModifier = {
  id: 'board-drift',
  banner: 'BOARD DRIFT',
  when: (ctx: ModCtx): boolean => ctx.depth >= 0,
  apply: (ctx: ModCtx, scene: unknown): (() => void) => {
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

    let timer: ReturnType<typeof setInterval> | null = null;

    if (!ctx.motion) {
      target.x = origX + Math.cos(angle) * (amplitude * 0.5);
      target.y = origY + Math.sin(angle) * (amplitude * 0.5);
    } else {
      target.x = origX + Math.cos(angle) * amplitude;
      target.y = origY + Math.sin(angle) * amplitude;

      let step = 0;
      if (typeof setInterval !== 'undefined') {
        timer = setInterval(() => {
          step++;
          const t = step * 0.05 * speed;
          target.x = origX + Math.cos(angle + t) * amplitude;
          target.y = origY + Math.sin(angle + t * 0.7) * amplitude;
        }, 16);
        if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
          (timer as { unref: () => void }).unref();
        }
      }
    }

    return () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      target.scale.x = origScaleX;
      target.scale.y = origScaleY;
      target.x = origX;
      target.y = origY;
    };
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

/** The active registry of round modifiers. */
export const MODIFIERS: RoundModifier[] = [
  mirrorFlipModifier,
  boardDriftModifier,
  rotate90Modifier,
  breathingModifier,
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
