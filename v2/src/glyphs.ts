/**
 * Glyph primitives — the small marks real iqversus puzzles are built from
 * (see v2/DNA.md): triangle outlines, dots, diamonds, line segments.
 * Rendered with 2D canvas into textures; one hue per board (never per-cell).
 */

export type Prim =
  | { k: 'tri'; x: number; y: number; s: number }
  | { k: 'dot'; x: number; y: number; r: number }
  | { k: 'diamond'; x: number; y: number; s: number }
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number };

/** Paint primitives onto a 2d context. Coordinates are cell-local (0..size). */
export function paintPrims(c: CanvasRenderingContext2D, prims: Prim[], hue: string, size: number): void {
  const u = size / 100; // design in a 100x100 cell space
  c.strokeStyle = hue; c.fillStyle = hue; c.lineWidth = 2.2 * u; c.lineCap = 'round';
  for (const p of prims) {
    switch (p.k) {
      case 'tri': {
        const s = p.s * u, x = p.x * u, y = p.y * u;
        c.beginPath();
        c.moveTo(x, y - s);
        c.lineTo(x + s * 0.9, y + s * 0.7);
        c.lineTo(x - s * 0.9, y + s * 0.7);
        c.closePath(); c.stroke();
        break;
      }
      case 'dot': {
        c.beginPath(); c.arc(p.x * u, p.y * u, p.r * u, 0, Math.PI * 2); c.fill();
        break;
      }
      case 'diamond': {
        const s = p.s * u, x = p.x * u, y = p.y * u;
        c.beginPath();
        c.moveTo(x, y - s); c.lineTo(x + s, y); c.lineTo(x, y + s); c.lineTo(x - s, y);
        c.closePath(); c.fill();
        break;
      }
      case 'line': {
        c.beginPath(); c.moveTo(p.x1 * u, p.y1 * u); c.lineTo(p.x2 * u, p.y2 * u); c.stroke();
        break;
      }
    }
  }
}

/** Render a cell (list of prims) into an offscreen canvas of `size` px. */
export function cellCanvas(prims: Prim[], hue: string, size: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const c = cv.getContext('2d')!;
  paintPrims(c, prims, hue, size);
  return cv;
}

/** A cell tile = rounded dark tile + centered glyph. Returns a canvas. */
export function tileCanvas(prims: Prim[], hue: string, size: number, opts?: { hole?: boolean }): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const c = cv.getContext('2d')!;
  const r = size * 0.14;
  // luxe tile: #000 fill, accent hairline, faint accent inner glow
  c.fillStyle = '#000000';
  roundRect(c, 0.5, 0.5, size - 1, size - 1, r); c.fill();
  c.save();
  roundRect(c, 0.5, 0.5, size - 1, size - 1, r); c.clip();
  c.shadowColor = 'rgba(64,137,238,0.30)';
  c.shadowBlur = Math.max(3, size * 0.06);
  c.strokeStyle = 'rgba(64,137,238,0.18)';
  c.lineWidth = 2;
  roundRect(c, 1.5, 1.5, size - 3, size - 3, r * 0.92); c.stroke(); c.stroke();
  c.restore();
  c.strokeStyle = 'rgba(64,137,238,0.24)';
  c.lineWidth = 1.5;
  roundRect(c, 0.5, 0.5, size - 1, size - 1, r); c.stroke();
  if (opts?.hole) {
    c.fillStyle = '#f5f8ff';
    c.font = `800 ${Math.round(size * 0.42)}px Oxanium, "Segoe UI", sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('?', size / 2, size / 2 + size * 0.02);
    return cv;
  }
  const inner = size * 0.78;
  c.save();
  c.translate((size - inner) / 2, (size - inner) / 2);
  paintPrims(c, prims, hue, inner);
  c.restore();
  return cv;
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
