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
  apply(ctx: ModCtx, scene: unknown): () => void;
  banner?: string;
}

/** Duck-typed container interface matching Pixi Container transform props. */
export interface BoardTarget {
  scale: { x: number; y: number };
  x: number;
  y: number;
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

/** The active registry of round modifiers. */
export const MODIFIERS: RoundModifier[] = [mirrorFlipModifier, boardDriftModifier];

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
