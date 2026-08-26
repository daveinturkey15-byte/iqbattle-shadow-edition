/**
 * Board tile skins — v1 board-skins parity, one treatment per act:
 *   act0  clean dark tiles with white 6% borders (the DNA baseline tile)
 *   act1  slight crimson edge
 *   act2  heavier crimson edge + inner glow
 *   act3  cracked-edge treatment
 *
 * All painting is pure f(ctx, …); the act3 cracks come from a fixed-seed
 * PRNG, so equal inputs render byte-identical output (determinism rail).
 * `tileSkin()` is a drop-in wrapper around glyphs.tileCanvas: same canvas
 * product, plus the per-act skin under the glyph.
 */

import { T } from '../theme.ts';
import { paintPrims, type Prim } from '../glyphs.ts';

export interface TileSkinOpts {
  /** glyph primitives painted centered, same geometry as glyphs.tileCanvas */
  prims?: Prim[];
  /** hole tile: draws the '?' mark instead of prims */
  hole?: boolean;
}

const ACT_COUNT = 4;
const CRACK_SEED = 0xb04ad5;

function mulberry32(a: number): () => number {
  let s = a >>> 0;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let z = Math.imul(s ^ (s >>> 15), 1 | s);
    z = (z ^ (z >>> 7)) | 0;
    z = (z + (z << 13)) ^ z;
    return ((z ^ (z >>> 16)) >>> 0) / 4294967296;
  };
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** Paint one jagged crack growing inward from a point on an edge. */
function paintCrack(
  c: CanvasRenderingContext2D,
  rng: () => number,
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  len: number,
): void {
  c.beginPath();
  c.moveTo(x0, y0);
  let x = x0;
  let y = y0;
  for (let i = 0; i < 3; i++) {
    x += dx * (len / 3) + (rng() - 0.5) * len * 0.35;
    y += dy * (len / 3) + (rng() - 0.5) * len * 0.35;
    c.lineTo(x, y);
  }
  c.stroke();
}

/** Act3 cracked edges: deterministic jagged fissures cutting inward from each side. */
export function paintCracks(c: CanvasRenderingContext2D, size: number): void {
  const rng = mulberry32(CRACK_SEED);
  c.strokeStyle = 'rgba(245,248,255,0.13)';
  c.lineWidth = 1;
  const margin = size * 0.2;
  const span = size - margin * 2;
  const cracksPerEdge = Math.max(2, Math.round(size / 48));
  const len = size * 0.16;
  for (let i = 0; i < cracksPerEdge; i++) {
    const p = margin + (span * (i + 0.5)) / cracksPerEdge + (rng() - 0.5) * (span / cracksPerEdge) * 0.6;
    paintCrack(c, rng, p, 0.5, (rng() - 0.5) * 0.4, 1, len); // top → down
    paintCrack(c, rng, p, size - 0.5, (rng() - 0.5) * 0.4, -1, len); // bottom → up
    paintCrack(c, rng, 0.5, p, 1, (rng() - 0.5) * 0.4, len); // left → right
    paintCrack(c, rng, size - 0.5, p, -1, (rng() - 0.5) * 0.4, len); // right → left
  }
}

/**
 * Paint the per-act skin background onto `c` (size×size px).
 * Pure f(ctx, act, size): no globals, no randomness beyond the fixed-seed
 * crack PRNG. Acts wrap modulo 4 so any integer act yields a valid skin.
 */
export function paintSkin(c: CanvasRenderingContext2D, act: number, size: number): void {
  const a = ((Math.trunc(act) % ACT_COUNT) + ACT_COUNT) % ACT_COUNT;
  const r = size * 0.14;
  c.fillStyle = T.tile;
  roundRect(c, 0.5, 0.5, size - 1, size - 1, r);
  c.fill();
  switch (a) {
    case 0: {
      // DNA baseline: clean dark tile, white 6% border
      c.strokeStyle = T.tileEdge;
      c.lineWidth = 1.5;
      c.stroke();
      break;
    }
    case 1: {
      // baseline border + slight crimson accent line just inside it
      c.strokeStyle = T.tileEdge;
      c.lineWidth = 1.5;
      c.stroke();
      c.strokeStyle = 'rgba(224,36,94,0.30)';
      c.lineWidth = 1;
      roundRect(c, 1.75, 1.75, size - 3.5, size - 3.5, r * 0.86);
      c.stroke();
      break;
    }
    case 2: {
      // heavier crimson edge + soft inner glow band
      c.strokeStyle = 'rgba(224,36,94,0.55)';
      c.lineWidth = 2.5;
      c.stroke();
      const glow = Math.max(4, size * 0.09);
      c.strokeStyle = 'rgba(224,36,94,0.10)';
      c.lineWidth = glow;
      roundRect(c, 1 + glow / 2, 1 + glow / 2, size - 2 - glow, size - 2 - glow, r * 0.8);
      c.stroke();
      break;
    }
    default: {
      // act3: cracked-edge treatment over the baseline border
      c.strokeStyle = T.tileEdge;
      c.lineWidth = 1.5;
      c.stroke();
      paintCracks(c, size);
      break;
    }
  }
}

/** Paint the full tile: skin + ('?' hole mark | centered prims). Pure f(ctx, …). */
export function paintTile(
  c: CanvasRenderingContext2D,
  act: number,
  size: number,
  hue: string,
  opts?: TileSkinOpts,
): void {
  paintSkin(c, act, size);
  if (opts?.hole) {
    c.fillStyle = T.ink;
    c.font = `800 ${Math.round(size * 0.42)}px Oxanium, "Segoe UI", sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('?', size / 2, size / 2 + size * 0.02);
    return;
  }
  const prims = opts?.prims;
  if (prims && prims.length > 0) {
    const inner = size * 0.78;
    c.save();
    c.translate((size - inner) / 2, (size - inner) / 2);
    paintPrims(c, prims, hue, inner);
    c.restore();
  }
}

/**
 * Styled board tile for act `act`: skin + optional prims/hole, rendered into
 * an offscreen `size`×`size` canvas. Drop-in for glyphs.tileCanvas — Main
 * wires game.ts cell/option/hole tiles through this per current act.
 */
export function tileSkin(act: number, size: number, hue: string, opts?: TileSkinOpts): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  paintTile(cv.getContext('2d')!, act, size, hue, opts);
  return cv;
}
