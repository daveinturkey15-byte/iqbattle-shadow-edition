/**
 * WORLD REGISTRY — v2 backdrop worlds (Dave's spec: "the music and art style of
 * everything changes" per alignment). Worlds are asset-free procedural canvas
 * backdrops keyed by alignment ('bad' | 'chaotic' | 'neutral' | 'good').
 *
 * Registration shape:
 *   register({ id, align, draw(ctx, w, h, t) })
 *
 * Determinism rails: draw MUST be a pure f(t) over fixed constants — zero
 * Math.random / Date.now. pick(align, rng) consumes EXACTLY ONE variate from
 * the supplied seeded rng (mulberry32-style () => number), so a seed fully
 * determines the world. Backdrops are ambience only — they never touch puzzle
 * glyphs, answers, or scoring (DNA.md rails).
 */

export type Align = 'bad' | 'chaotic' | 'neutral' | 'good';

export interface WorldDef {
  id: string;
  align: Align;
  /** Pure function of time (ms since scene start) over fixed constants. */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void;
}

export const ALIGNS: readonly Align[] = ['bad', 'chaotic', 'neutral', 'good'];

const worlds = new Map<string, WorldDef>();

/** Register a world. Same-id re-registration replaces (HMR-safe). */
export function register(def: WorldDef): void {
  worlds.set(def.id, def);
}

/** All registered worlds in registration order. */
export function list(): WorldDef[] {
  return [...worlds.values()];
}

export function byId(id: string): WorldDef | undefined {
  return worlds.get(id);
}

/**
 * Deterministic seeded pick among worlds of one alignment.
 * Consumes exactly ONE rng() call — same seed ⇒ same world, forever.
 */
export function pick(align: Align, rng: () => number): WorldDef {
  const pool = list().filter((d) => d.align === align);
  if (pool.length === 0) throw new Error(`no worlds registered for align '${align}'`);
  return pool[Math.floor(rng() * pool.length)];
}
