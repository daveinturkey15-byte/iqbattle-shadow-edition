/**
 * THE WELL 2 — sprint-tetris takeover scene (v2 port of modes/tetris.js,
 * mechanic not code). Exclusive new file — owns nothing shared.
 *
 * MECHANIC — clear the quota before the stack tops out:
 *   An 8x15 well. Classic seven pieces fall under seeded gravity; Left/Right
 *   move · Down soft drop · Up/X rotate CW · Z rotate CCW · Space hard drop
 *   (wall kicks 0/±1/±2). Clear the LINE QUOTA before a blocked spawn buries
 *   you:
 *     lines >= quota (4 + floor(depth/3), clamped 4..9) -> correct true
 *     cap expiry with some lines but under quota         -> null half-pay
 *     topout, or cap expiry with ZERO lines              -> false (-40/-15 hp)
 *
 * POINTS CURVE vs puzzle par 100*diff+40 (diff = clamp(1+floor(depth/6),1,5)):
 *   line value = 10 + 6*diff
 *   win        = BASE 30 + lines*lineValue + WIN_BONUS 50 + DEPTH_BONUS
 *                where DEPTH_BONUS = 2*min(depth,30)
 *   Quota wins land ~90-105% of par across ALL depths (the quota saturates
 *   at 9 lines, so the small depth bonus keeps deep wins near par without
 *   ever overshooting). Failures pay -40 so engine wrong-answer parity
 *   applies; partial caps pay half line value and stay neutral.
 * DETERMINISM: the piece queue is pure seeded 7-bag shuffles from an own
 * mulberry32 (salted, FIXED draw order: one full bag at a time). No
 * Math.random, no Date.now — the clock is Pixi's shared ticker delta.
 *
 * FAIRNESS RAILS: line-clear flash <=160 ms localized to the cleared row;
 * lock delay 300 ms; topout requires a blocked SPAWN with one row of grace
 * nudge; next-piece preview always visible; controls hint always visible;
 * Esc bails NEUTRAL; every text >= 11 px; self-resolves inside ctx.timerLen;
 * StageResult settles exactly once via onceResolve.
 */
import { Sprite, Texture, Ticker } from 'pixi.js';

import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import type { Prim } from '../../glyphs.ts';
import { tileCanvas } from '../../glyphs.ts';
import { text } from '../game.ts';
import { mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested)                                            */
/* ------------------------------------------------------------------ */

export const COLS = 8;
export const ROWS = 15;
export const LOCK_DELAY_MS = 300;
export const CLEAR_FLASH_MS = 160;
export const BASE_PTS = 30;

const WELL_SALT = 0x7e115eCd;
export const WIN_BONUS = 50;
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
  return Math.max(200, 850 - (Math.max(1, depth) - 1) * 45);
}
export function diffFor(depth: number): number {
  return Math.min(5, Math.max(1, 1 + Math.floor(Math.max(0, depth) / 6)));
}
export function lineValue(depth: number): number {
  return 10 + 6 * diffFor(depth);
}
export function depthBonus(depth: number): number {
  return 2 * Math.min(Math.max(0, depth), 30);
}
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
  cells: Array<[number, number]>;
  size: number;
  x: number;
  y: number;
}

export function makePiece(id: number): Piece {
  const def = SHAPE_DEFS[id % PIECE_COUNT];
  return { id: id % PIECE_COUNT, cells: def.cells.map((c) => [...c] as [number, number]), size: def.size, x: 2, y: 0 };
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
export function rotatedCells(piece: Piece, cw = true): Array<[number, number]> {
  return cw
    ? piece.cells.map(([x, y]) => [piece.size - 1 - y, x] as [number, number])
    : piece.cells.map(([x, y]) => [y, piece.size - 1 - x] as [number, number]);
}
export function tryRotate(grid: WellGrid, piece: Piece, cw = true): boolean {
  if (piece.size === 2) return false;
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
export function mergePiece(grid: WellGrid, piece: Piece): void {
  for (const [cx, cy] of piece.cells) {
    const x = piece.x + cx;
    const y = piece.y + cy;
    if (y >= 0 && y < ROWS && x >= 0 && x < COLS) grid[y * COLS + x] = piece.id;
  }
}
/** Remove every full row; returns how many fell. */
export function clearFullRows(grid: WellGrid): number {
  /* W5: remove ALL full rows in one pass — the old bottom-up shift stranded
   * adjacent stacks (2-stack cleared 1, 3-stack cleared 2). */
  const keep: number[][] = [];
  let cleared = 0;
  for (let y = 0; y < ROWS; y++) {
    let full = true;
    for (let x = 0; x < COLS; x++) {
      if (cellAt(grid, x, y) < 0) { full = false; break; }
    }
    if (full) { cleared++; continue; }
    keep.push(Array.from({ length: COLS }, (_, x) => cellAt(grid, x, y)));
  }
  while (keep.length < ROWS) keep.unshift(Array.from({ length: COLS }, () => -1));
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) grid[y * COLS + x] = keep[y][x];
  }
  return cleared;
}

export interface WellVerdict {
  correct: boolean | null;
  points: number;
  hpDelta: number;
}

/** Verdict ladder — see header curve. */
export function verdictFor(lines: number, depth: number, buried: boolean): WellVerdict {
  const quota = quotaFor(depth);
  if (lines >= quota) {
    return {
      correct: true,
      points: BASE_PTS + lines * lineValue(depth) + WIN_BONUS + depthBonus(depth),
      hpDelta: 0,
    };
  }
  if (buried || lines === 0) {
    return { correct: false, points: -40, hpDelta: -15 };
  }
  return { correct: null, points: Math.round((lines * lineValue(depth)) / 2), hpDelta: 0 };
}

/** Each tetromino carries its own primitive mark (DNA: structure over color). */
function piecePrims(id: number): Prim[] {
  switch (((id % 7) + 7) % 7) {
    case 0: return [{ k: 'line', x1: 18, y1: 50, x2: 82, y2: 50 }];
    case 1: return [{ k: 'tri', x: 50, y: 52, s: 13 }];
    case 2: return [{ k: 'diamond', x: 50, y: 50, s: 14 }];
    case 3: return [{ k: 'dot', x: 50, y: 50, r: 10 }];
    case 4: return [
      { k: 'line', x1: 50, y1: 30, x2: 50, y2: 70 },
      { k: 'line', x1: 30, y1: 50, x2: 70, y2: 50 },
    ];
    case 5: return [{ k: 'line', x1: 32, y1: 68, x2: 68, y2: 32 }];
    default: return [
      { k: 'dot', x: 37, y: 37, r: 5 },
      { k: 'dot', x: 63, y: 63, r: 5 },
    ];
  }
}

const CELL = 38;
export function mountTetris2(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const hue = T.boardHues[(ctx.seed >>> 5) % T.boardHues.length];
  const settle = onceResolve(ctx.onDone);
  const rng = mulberry32((ctx.seed ^ WELL_SALT) >>> 0);
  const quota = quotaFor(ctx.depth);
  const gravityMs = gravityFor(ctx.depth);

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W; bg.height = STAGE_H; bg.tint = T.bg;
  root.addChild(bg);

  const wx = (STAGE_W - COLS * CELL) / 2;
  const wy = 170;
  text(root, 'THE WELL 2', wx - 24, 96, 30, hue, true);
  const status = text(root, 'CLEAR THE QUOTA BEFORE IT BURIES YOU', wx - 24, wy + ROWS * CELL + 40, 19, T.ink, true);
  const progress = text(root, '', wx - 24, wy + ROWS * CELL + 78, 15, T.muted);
  text(root, 'LEFT/RIGHT MOVE · DOWN SOFT · UP/X ROTATE · Z CCW · SPACE DROP',
    wx - 24, wy + ROWS * CELL + 112, 13, T.muted);

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
    sp.visible = true;
  }

  function redraw(): void {
    for (const [, sp] of cellSprites) sp.visible = false;
    for (let y = 0; y < ROWS; y++) {
      const flashing = flashUntil > clock && y === flashRow;
      if (flashing) {
        for (let x = 0; x < COLS; x++) drawCell(x, y, 0, true);
        continue;
      }
      for (let x = 0; x < COLS; x++) {
        if (cellAt(grid, x, y) >= 0) drawCell(x, y, cellAt(grid, x, y));
      }
    }
    for (const [cx, cy] of cur.cells) {
      const x = cur.x + cx;
      const y = cur.y + cy;
      if (y >= 0) drawCell(x, y, cur.id);
    }
  }

  function refresh(): void {
    progress.text = `LINES ${lines}/${quota} · NEXT UP`;
  }

  function findFirstFullRow(): number {
    for (let y = 0; y < ROWS; y++) {
      let full = true;
      for (let x = 0; x < COLS; x++) {
        if (cellAt(grid, x, y) < 0) { full = false; break; }
      }
      if (full) return y;
    }
    return -1;
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
    refresh();
    cur = makePiece(nextId);
    nextId = pullNext();
    if (collides(grid, cur)) {
      cur.y -= 1; // one row of grace before the bury
      if (collides(grid, cur)) {
        finish({ ...verdictFor(lines, ctx.depth, true), summary: 'BURIED' });
        return;
      }
    }
    if (lines >= quota) {
      finish({ ...verdictFor(lines, ctx.depth, false), summary: 'WELL CLEARED' });
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    switch (e.key) {
      case 'Escape':
        finish(escaped(0, 'CLIMBED OUT OF THE WELL'));
        return;
      case 'ArrowLeft': if (!collides(grid, cur, -1, 0)) { cur.x += -1; restMs = 0; } break;
      case 'ArrowRight': if (!collides(grid, cur, 1, 0)) { cur.x += 1; restMs = 0; } break;
      case 'ArrowDown':
        if (!collides(grid, cur, 0, 1)) { cur.y++; gravAcc = 0; restMs = 0; }
        break;
      case 'ArrowUp': case 'x': case 'X': tryRotate(grid, cur, true); break;
      case 'z': case 'Z': tryRotate(grid, cur, false); break;
      case ' ':
        e.preventDefault();
        while (!collides(grid, cur, 0, 1)) cur.y++;
        lockPiece();
        redraw();
        return;
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
  status.text = 'CLEAR THE QUOTA BEFORE IT BURIES YOU';
  refresh();
  redraw();
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // curves
  if (quotaFor(1) !== 4 || quotaFor(3) !== 5 || quotaFor(27) !== 9 || quotaFor(90) !== 9) failures.push('quota curve wrong');
  if (gravityFor(1) !== 850 || gravityFor(15) !== 220 || gravityFor(40) !== 200) failures.push('gravity curve wrong');
  for (let d = 1; d <= 30; d++) {
    if (gravityFor(d) < 200 || gravityFor(d) > 850) failures.push(`gravity out of band d=${d}`);
    if (quotaFor(d) < 4 || quotaFor(d) > 9) failures.push(`quota out of band d=${d}`);
  }

  // bags over 300 seeds: permutations + determinism
  for (let seed = 1; seed <= 300; seed++) {
    const a = makeBag(mulberry32(seed));
    const b = makeBag(mulberry32(seed));
    if (JSON.stringify(a) !== JSON.stringify(b)) failures.push('bag nondeterministic');
    const sorted = [...a].sort((p, q) => p - q);
    if (sorted.some((v, i) => v !== i)) failures.push('bag not a permutation');
  }

  // rotation math: every piece stays inside its box through 4 turns
  for (let id = 0; id < PIECE_COUNT; id++) {
    const p = makePiece(id);
    for (let turn = 0; turn < 4; turn++) {
      const ok = rotatedCells(p).every(([x, y]) => x >= 0 && x < p.size && y >= 0 && y < p.size);
      if (!ok) failures.push(`rotation escapes box piece=${id}`);
      p.cells = rotatedCells(p);
    }
    if (makePiece(id).cells.length !== SHAPE_DEFS[id].cells.length) failures.push('piece cell count wrong');
  }

  // collision / merge / clear on a synthetic stack
  const g = emptyGrid();
  const o = makePiece(3); // O-piece
  o.x = 0;
  o.y = ROWS - 2;
  mergePiece(g, o);
  const probe = makePiece(3);
  probe.x = 0;
  probe.y = ROWS - 3;
  if (!collides(g, probe)) failures.push('stack collision missed');
  if (clearFullRows(g) !== 0) failures.push('cleared a non-full row');
  for (let x = 0; x < COLS; x++) g[(ROWS - 3) * COLS + x] = 1;
  if (clearFullRows(g) !== 1) failures.push('full row not cleared');
  if (cellAt(g, 0, ROWS - 2) !== 3) failures.push('block below cleared row must stay put');

  // verdict ladder + documented pay band vs par 100*diff+40
  for (let d = 1; d <= 5; d++) {
    const depth = d * 6 - 5; // diff(depth) === d exactly
    const q = quotaFor(depth);
    const win = verdictFor(q, depth, false);
    const par = 100 * d + 40;
    if (win.points < 0.85 * par || win.points > 1.4 * par) {
      failures.push(`win pay off-band diff=${d} pay=${win.points} par=${par}`);
    }
  }
  const vBuried = verdictFor(0, 4, true);
  if (vBuried.correct !== false || vBuried.points !== -40 || vBuried.hpDelta !== -15) failures.push('buried verdict wrong');
  if (verdictFor(0, 4, false).correct !== false) failures.push('zero-line cap must fail');
  const vPart = verdictFor(quotaFor(4) - 1, 4, false);
  if (vPart.correct !== null || vPart.points < 0) failures.push('partial verdict wrong');

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;
