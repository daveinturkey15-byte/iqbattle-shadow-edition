/**
 * THE WELL — sprint-tetris takeover scene (v2 port of modes/tetris.js,
 * mechanic not code).
 *
 * MECHANIC — clear the quota before the stack tops out:
 *   An 8x14 well. Pieces fall under seeded gravity; Left/Right move · Down
 *   soft drop · Up/X rotate CW · Z rotate CCW · Space hard drop. Clear the
 *   LINE QUOTA before a blocked spawn buries you:
 *     lines >= quota (4 + depth/3, clamped 4..9) -> correct true
 *     cap expiry with some lines but < quota                     -> null
 *     topout, or cap expiry with ZERO lines                      -> false (-15 hp)
 *
 * DEPTH CURVES (pure, self-tested):
 *   quota      = min(9, 4 + floor(depth/3))
 *   gravity    = clamp(900 - (depth-1)*55, 220, 900) ms per row
 *   line value = 22 + 2*min(depth, 8) points; wins add BASE 30 + WIN BONUS 50
 *
 * DETERMINISM: the piece queue is pure ctx-seeded 7-bag shuffles from an own
 * mulberry32 (FIXED draw order: one bag at a time). No Math.random, no
 * Date.now — the clock is Pixi's shared ticker delta.
 *
 * FAIRNESS RAILS: the line-clear flash is <=160 ms and localized to cleared
 * rows; lock delay 300 ms; topout requires a blocked SPAWN (one row of grace);
 * controls hint always visible; Esc bails NEUTRAL; every text >= 11 px;
 * self-resolves inside ctx.timerLen.
 */
import { Sprite, Texture, Ticker } from 'pixi.js';
import type { Text } from 'pixi.js';

import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import type { Prim } from '../../glyphs.ts';
import { tileCanvas } from '../../glyphs.ts';
import { panel, text } from '../game.ts';
import { mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested)                                            */
/* ------------------------------------------------------------------ */

export const COLS = 8;
export const ROWS = 14;
export const LOCK_DELAY_MS = 300;
export const CLEAR_FLASH_MS = 160;
export const BASE_PTS = 30;
export const WIN_BONUS = 50;

const WELL_SALT = 0x7e11c0de;

/** Classic seven, each with a spawn-safe offset set inside `size`. */
const SHAPE_DEFS: Array<{ size: number; cells: Array<[number, number]> }> = [
  { size: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] }, // I
  { size: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] }, // J
  { size: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] }, // L
  { size: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] }, // O
  { size: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] }, // T
  { size: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] }, // S
  { size: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] }, // Z
];

export const PIECE_COUNT = SHAPE_DEFS.length;

export function quotaFor(depth: number): number {
  return Math.min(9, 4 + Math.floor(Math.max(0, depth) / 3));
}

export function gravityFor(depth: number): number {
  return Math.max(220, 900 - (Math.max(1, depth) - 1) * 55);
}

export function linePtsFor(depth: number): number {
  return 22 + 2 * Math.min(Math.max(1, depth), 8);
}

/** Seeded 7-bag: a full permutation of piece ids, Fisher-Yates. */
export function makeBag(rng: () => number): number[] {
  const bag = Array.from({ length: PIECE_COUNT }, (_, i) => i);
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

export interface Piece {
  id: number;
  /** offsets inside the shape box */
  cells: Array<[number, number]>;
  size: number;
  x: number;
  y: number;
}

export function makePiece(id: number): Piece {
  const def = SHAPE_DEFS[id];
  return { id, cells: def.cells.map((c) => [...c] as [number, number]), size: def.size, x: 3, y: 0 };
}

export type WellGrid = Int8Array; // ROWS*COLS, -1 empty else piece id

export function emptyGrid(): WellGrid {
  return new Int8Array(ROWS * COLS).fill(-1);
}

export function cellAt(grid: WellGrid, x: number, y: number): number {
  return grid[y * COLS + x];
}

export function collides(grid: WellGrid, piece: Piece, ox = 0, oy = 0, cells = piece.cells): boolean {
  for (const [cx, cy] of cells) {
    const x = piece.x + cx + ox;
    const y = piece.y + cy + oy;
    if (x < 0 || x >= COLS || y >= ROWS) return true;
    if (y >= 0 && cellAt(grid, x, y) >= 0) return true;
  }
  return false;
}

/** Rotate cell offsets a quarter turn (CW by default, CCW otherwise). */
export function rotatedCells(piece: Piece, cw = true): Array<[number, number]> {
  return cw
    ? piece.cells.map(([x, y]) => [piece.size - 1 - y, x] as [number, number])
    : piece.cells.map(([x, y]) => [y, piece.size - 1 - x] as [number, number]);
}

export function mergePiece(grid: WellGrid, piece: Piece): void {
  for (const [cx, cy] of piece.cells) {
    const x = piece.x + cx;
    const y = piece.y + cy;
    if (y >= 0 && y < ROWS && x >= 0 && x < COLS) grid[y * COLS + x] = piece.id;
  }
}

/** Remove every full row; returns how many fell. */
export function clearFullRows(grid: WellGrid): number {
  let cleared = 0;
  for (let y = ROWS - 1; y >= 0; y--) {
    let full = true;
    for (let x = 0; x < COLS; x++) {
      if (cellAt(grid, x, y) < 0) {
        full = false;
        break;
      }
    }
    if (!full) continue;
    cleared++;
    for (let yy = y; yy > 0; yy--) {
      for (let x = 0; x < COLS; x++) grid[yy * COLS + x] = grid[(yy - 1) * COLS + x];
    }
    for (let x = 0; x < COLS; x++) grid[x] = -1;
  }
  return cleared;
}

/** Try a rotation (CW/CCW) with simple wall kicks (0, ±1, ±2 horizontal). */
export function tryRotate(grid: WellGrid, piece: Piece, cw = true): boolean {
  if (piece.size === 2) return false; // O never rotates
  const cells = rotatedCells(piece, cw);
  for (const kick of [0, -1, 1, -2, 2]) {
    if (!collides(grid, piece, kick, 0, cells)) {
      piece.x += kick;
      piece.cells = cells;
      return true;
    }
  }
  return false;
}

export interface WellVerdict {
  correct: boolean | null;
  points: number;
  hpDelta: number;
}

/**
 * Verdict ladder: quota met = win · buried/zero-line cap = fail parity ·
 * anything between = neutral partial that still pays half line value.
 */
export function verdictFor(lines: number, depth: number, buried: boolean): WellVerdict {
  const quota = quotaFor(depth);
  const lp = linePtsFor(depth);
  if (lines >= quota) {
    return { correct: true, points: BASE_PTS + lines * lp + WIN_BONUS, hpDelta: 0 };
  }
  if (buried || lines === 0) {
    return { correct: false, points: -40, hpDelta: -15 };
  }
  return { correct: null, points: Math.round(lines * lp * 0.5), hpDelta: 0 };
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

const CELL = 38;

/** Each tetromino carries its own primitive mark (DNA: structure over color). */
function piecePrims(id: number): Prim[] {
  switch (id % 7) {
    case 0: return [{ k: 'line', x1: 20, y1: 50, x2: 80, y2: 50 }];
    case 1: return [{ k: 'tri', x: 50, y: 52, s: 12 }];
    case 2: return [{ k: 'diamond', x: 50, y: 50, s: 13 }];
    case 3: return [{ k: 'dot', x: 50, y: 50, r: 9 }];
    case 4: return [
      { k: 'line', x1: 50, y1: 30, x2: 50, y2: 70 },
      { k: 'line', x1: 30, y1: 50, x2: 70, y2: 50 },
    ];
    case 5: return [{ k: 'line', x1: 32, y1: 68, x2: 68, y2: 32 }];
    default: return [
      { k: 'dot', x: 38, y: 38, r: 5 },
      { k: 'dot', x: 62, y: 62, r: 5 },
    ];
  }
}

interface LiveUi {
  status: Text;
  progress: Text;
}

export function mountWell(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const hue = T.boardHues[(ctx.seed >>> 7) % T.boardHues.length];
  const hueNum = parseInt(hue.slice(1), 16);
  const settle = onceResolve(ctx.onDone);
  const rng = mulberry32((ctx.seed ^ WELL_SALT) >>> 0);
  const quota = quotaFor(ctx.depth);
  const gravityMs = gravityFor(ctx.depth);

  /* ---- static chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  text(root, 'THE WELL', STAGE_W / 2 - 76, 84, 30, hue, true);

  const wx = (STAGE_W - COLS * CELL) / 2;
  const wy = 170;
  panel(root, wx - 24, wy - 24, COLS * CELL + 48, ROWS * CELL + 48);

  const ui: LiveUi = {
    status: text(root, '', wx - 24, wy + ROWS * CELL + 40, 19, T.ink, true),
    progress: text(root, '', wx - 24, wy + ROWS * CELL + 78, 15, T.muted),
  };
  text(
    root,
    'LEFT/RIGHT MOVE · DOWN SOFT · UP/X ROTATE · Z CCW · SPACE DROP',
    wx - 24, wy + ROWS * CELL + 112, 13, T.muted,
  );

  // next-piece preview
  text(root, 'NEXT', wx + COLS * CELL + 60, wy + 6, 15, T.muted);
  const nextSprite = new Sprite(Texture.WHITE);
  nextSprite.width = CELL;
  nextSprite.height = CELL;
  nextSprite.x = wx + COLS * CELL + 60;
  nextSprite.y = wy + 34;
  root.addChild(nextSprite);

  /* ---- textures ---- */
  const texByPiece = Array.from({ length: PIECE_COUNT }, (_, id) =>
    Texture.from(tileCanvas(piecePrims(id), hue, CELL)),
  );
  const flashTex = Texture.from(tileCanvas([{ k: 'diamond', x: 50, y: 50, s: 10 }], '#ffffff', CELL));

  /* ---- state ---- */
  const grid = emptyGrid();
  let queue: number[] = [];
  const pullNext = (): number => {
    if (queue.length === 0) queue = makeBag(rng);
    return queue.shift()!;
  };
  let cur = makePiece(pullNext());
  let nextId = pullNext();
  let lines = 0;
  let clock = 0;
  let gravAcc = 0;
  let restMs = 0;
  let flashUntil = -1;
  let flashRow = -1;
  let dead = false;

  function refreshProgress(): void {
    ui.progress.text = `LINES ${lines}/${quota}`;
  }

  function finish(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function lockPiece(): void {
    mergePiece(grid, cur);
    const firstFull = findFirstFullRow();
    if (firstFull >= 0) {
      flashUntil = clock + CLEAR_FLASH_MS;
      flashRow = firstFull;
    }
    const cleared = clearFullRows(grid);
    lines += cleared;
    refreshProgress();
    cur = makePiece(nextId);
    nextId = pullNext();
    nextSprite.texture = texByPiece[nextId];
    if (collides(grid, cur)) {
      // one row of grace: nudge up, then bury
      cur.y -= 1;
      if (collides(grid, cur)) {
        finish({ ...verdictFor(lines, ctx.depth, true), summary: 'BURIED' });
        return;
      }
    }
    if (lines >= quota) {
      finish({
        ...verdictFor(lines, ctx.depth, false),
        summary: 'WELL CLEARED',
      });
    }
  }

  function findFirstFullRow(): number {
    for (let y = 0; y < ROWS; y++) {
      let full = true;
      for (let x = 0; x < COLS; x++) {
        if (cellAt(grid, x, y) < 0) {
          full = false;
          break;
        }
      }
      if (full) return y;
    }
    return -1;
  }

  /* ---- rendering ---- */
  const cellSprites = new Map<string, Sprite>();

  function drawCell(x: number, y: number, id: number, flashing = false): void {
    const key = `${x},${y}`;
    let sp = cellSprites.get(key);
    if (!sp) {
      sp = new Sprite(flashing ? flashTex : texByPiece[id]);
      sp.x = wx + x * CELL;
      sp.y = wy + y * CELL;
      root.addChild(sp);
      cellSprites.set(key, sp);
    } else {
      sp.texture = flashing ? flashTex : texByPiece[id];
    }
  }

  function redraw(): void {
    for (const [, sp] of cellSprites) sp.visible = false;
    for (let y = 0; y < ROWS; y++) {
      const flashing = flashUntil > clock && y === flashRow;
      for (let x = 0; x < COLS; x++) {
        const id = cellAt(grid, x, y);
        if (id >= 0 && !flashing) {
          drawCell(x, y, id);
          cellSprites.get(`${x},${y}`)!.visible = true;
        }
      }
      if (flashing) {
        for (let x = 0; x < COLS; x++) {
          drawCell(x, y, 0, true);
        }
      }
    }
    for (const [cx, cy] of cur.cells) {
      const x = cur.x + cx;
      const y = cur.y + cy;
      if (y >= 0) {
        drawCell(x, y, cur.id);
        cellSprites.get(`${x},${y}`)!.visible = true;
      }
    }
  }

  /* ---- commands ---- */
  function move(dx: number): void {
    if (!collides(grid, cur, dx, 0)) {
      cur.x += dx;
      restMs = 0;
    }
  }
  function softDrop(): void {
    if (!collides(grid, cur, 0, 1)) {
      cur.y++;
      gravAcc = 0;
      restMs = 0;
    }
  }
  function hardDrop(): void {
    while (!collides(grid, cur, 0, 1)) cur.y++;
    lockPiece();
  }
  function rotate(cw: boolean): void {
    tryRotate(grid, cur, cw);
  }

  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    switch (e.key) {
      case 'Escape':
        finish(escaped(0, 'CLIMBED OUT OF THE WELL'));
        return;
      case 'ArrowLeft': move(-1); break;
      case 'ArrowRight': move(1); break;
      case 'ArrowDown': softDrop(); break;
      case 'ArrowUp':
      case 'x':
      case 'X': rotate(true); break;
      case 'z':
      case 'Z': rotate(false); break;
      case ' ': e.preventDefault(); hardDrop(); break;
      default: return;
    }
    e.preventDefault();
    redraw();
  }

  window.addEventListener('keydown', onKey);

  const onTick = (tk: Ticker): void => {
    if (dead) return;
    const dt = tk.deltaMS;
    clock += dt;

    if (collides(grid, cur, 0, 1)) {
      restMs += dt;
      if (restMs >= LOCK_DELAY_MS) {
        restMs = 0;
        lockPiece();
      }
    } else {
      gravAcc += dt;
      while (gravAcc >= gravityMs && !collides(grid, cur, 0, 1)) {
        gravAcc -= gravityMs;
        cur.y++;
      }
    }

    if (!dead && clock >= ctx.timerLen * 1000) {
      finish({
        ...verdictFor(lines, ctx.depth, false),
        summary: lines > 0 ? `${lines} LINES` : 'THE WELL KEEPS YOU',
      });
      return;
    }
    if (!dead) redraw();
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  nextSprite.texture = texByPiece[nextId];
  refreshProgress();
  ui.status.text = 'CLEAR THE QUOTA BEFORE IT BURIES YOU';
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // curves
  if (quotaFor(1) !== 4 || quotaFor(3) !== 5 || quotaFor(30) !== 9) failures.push('quota curve wrong');
  if (gravityFor(1) !== 900 || gravityFor(13) !== 240 || gravityFor(40) !== 220) failures.push('gravity curve wrong');
  for (let d = 1; d <= 25; d++) {
    if (gravityFor(d) < 220 || gravityFor(d) > 900) failures.push(`gravity out of band d=${d}`);
    if (quotaFor(d) < 4 || quotaFor(d) > 9) failures.push(`quota out of band d=${d}`);
  }

  // bags: full permutations, deterministic
  for (let seed = 1; seed <= 100; seed++) {
    const rngA = mulberry32(seed);
    const rngB = mulberry32(seed);
    const a = makeBag(rngA);
    const b = makeBag(rngB);
    if (JSON.stringify(a) !== JSON.stringify(b)) failures.push('bag nondeterministic');
    const sorted = [...a].sort((p, q) => p - q);
    if (sorted.some((v, i) => v !== i)) failures.push('bag not a permutation');
  }

  // rotation math: I-piece rotates inside its box
  const ip = makePiece(0);
  const rc = rotatedCells(ip);
  if (!(rc.every(([x, y]) => x >= 0 && x < ip.size && y >= 0 && y < ip.size))) failures.push('rotation escapes box');
  if (rc.length !== 4) failures.push('rotation lost cells');

  // collision / merge / clear on a synthetic stack
  const g = emptyGrid();
  const o = makePiece(3); // O at x=3,y=0
  if (collides(g, o)) failures.push('empty well should not collide');
  o.y = ROWS - 2;
  mergePiece(g, o);
  const probe = makePiece(3);
  probe.y = ROWS - 3;
  if (!collides(g, probe)) failures.push('stack collision missed');
  // fill row above the O block partially -> not full -> no clear
  if (clearFullRows(g) !== 0) failures.push('cleared a non-full row');
  for (let x = 0; x < COLS; x++) g[(ROWS - 3) * COLS + x] = 1;
  if (clearFullRows(g) !== 1) failures.push('full row not cleared');
  if (cellAt(g, 3, ROWS - 2) !== 3) failures.push('block below cleared row must stay put');

  // verdict ladder
  const q = quotaFor(4);
  const vWin = verdictFor(q, 4, false);
  if (vWin.correct !== true || vWin.hpDelta !== 0) failures.push('win verdict wrong');
  const vBuried = verdictFor(0, 4, true);
  if (vBuried.correct !== false || vBuried.points >= 0 || vBuried.hpDelta !== -15) failures.push('buried verdict wrong');
  const vZero = verdictFor(0, 4, false);
  if (vZero.correct !== false) failures.push('zero-line cap must fail');
  const vPart = verdictFor(q - 1, 4, false);
  if (vPart.correct !== null || vPart.points < 0) failures.push('partial verdict wrong');
  const d1 = verdictFor(quotaFor(1), 1, false).points;
  const d10 = verdictFor(quotaFor(10), 10, false).points;
  if (d10 <= d1) failures.push('win pay should scale with depth');

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;
