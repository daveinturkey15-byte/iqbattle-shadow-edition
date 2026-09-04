/**
 * WORLD KIT — the only helpers a P5 world file may use.
 *
 * Every world is a pure f(t) over fixed constants: zero Math.random, zero
 * Date.now. `hash(n)` is the ONLY source of per-index variation, exactly as
 * backdrops.ts does it. Motion gating happens in applyBackdrop (a static frame
 * at t=0), so a world never needs to check a preference itself.
 */
import { type WorldDef } from '../registry.ts';
export type { WorldDef };

/** Deterministic per-index variate in [0,1) — the only "randomness" allowed. */
export function hash(n: number): number {
  return ((Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1 + 1) % 1;
}

export function wrap(v: number, m: number): number {
  return ((v % m) + m) % m;
}

/** Soft elliptical blob via radial gradient; rgb = 'r,g,b'. */
export function softBlob(
  c: CanvasRenderingContext2D, x: number, y: number,
  rx: number, ry: number, rgb: string, a: number,
): void {
  c.save();
  c.translate(x, y);
  c.scale(rx / 100, ry / 100);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, 100);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g;
  c.fillRect(-100, -100, 200, 200);
  c.restore();
}

/** Vertical linear wash, top rgb -> bottom rgb. */
export function wash(
  c: CanvasRenderingContext2D, w: number, h: number, top: string, bottom: string,
): void {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}
