/**
 * SERPENT — takeover scene (v2 port of modes/snake.js, mechanic not code).
 *
 * Grid snake on Pixi. Arrows / WASD / swipe steer; walls WRAP (only
 * self-collision kills). Eat the apple quota (12 + depth) before the round
 * timer: correct = true, points = apples*15 + survive bonus. Self-bite ends
 * the run early as a fail (-40 / -12 hp). Timeout resolves NEUTRAL with the
 * partial harvest (apples*15).
 *
 * Determinism: the ENTIRE apple spawn queue is drawn from ctx.seed via an own
 * mulberry32 once at mount (Fisher-Yates over the grid minus spawn cells), so
 * step clock is Pixi's shared ticker delta. Esc bails NEUTRAL; StageResult
 * settles exactly once; container emptied on done.
 */
import { Container, Graphics, Sprite, Text, Texture, Ticker } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import { panel, text } from '../game.ts';
import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import { mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested)                                            */
/* ------------------------------------------------------------------ */

export const GRID_COLS = 26;
export const GRID_ROWS = 15;
/** spawn: 3 segments heading right at these cells (excluded from apple draws) */
export const SPAWN_CELLS: Array<{ x: number; y: number }> = [
  { x: 4, y: Math.floor(GRID_ROWS / 2) },
  { x: 5, y: Math.floor(GRID_ROWS / 2) },
  { x: 6, y: Math.floor(GRID_ROWS / 2) },
];

export function quota(depth: number): number {
  return 12 + depth;
}

export function stepMs(depth: number): number {
  return Math.max(55, 90 - (depth - 1) * 5);
}

export function surviveBonus(depth: number): number {
  return Math.min(40 + depth * 20, 200);
}

export interface Cell {
  x: number;
  y: number;
}

/**
 * The full deterministic apple sequence for a seed: every free cell,
 * Fisher-Yates-shuffled with an own mulberry32. At runtime the head of the
 * queue is skipped forward past any cell the snake body occupies.
 */
export function appleQueue(seed: number): Cell[] {
  const rng = mulberry32((seed ^ 0x2545f491) >>> 0);
  const spawnKeys = new Set(SPAWN_CELLS.map((c) => `${c.x},${c.y}`));
  const cells: Cell[] = [];
  for (let y = 0; y < GRID_ROWS; y++) {
    for (let x = 0; x < GRID_COLS; x++) {
      if (!spawnKeys.has(`${x},${y}`)) cells.push({ x, y });
    }
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells;
}

const APPLE_PTS = 15;

interface Dir {
  dx: number;
  dy: number;
}

const DIRS: Record<'up' | 'down' | 'left' | 'right', Dir> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

export function mountSerpent(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const hue = T.boardHues[ctx.seed % T.boardHues.length];
  const settle = onceResolve(ctx.onDone);
  const N = quota(ctx.depth);

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  text(root, 'SERPENT', STAGE_W / 2 - 56, 48, 30, T.ink, true);
  const status = text(root, `EAT ${N} APPLES`, STAGE_W / 2 - 80, 94, 17, T.gold, true);
  text(root, 'ARROWS · WASD · SWIPE — WALLS WRAP, YOUR OWN TAIL DOES NOT', STAGE_W / 2 - 250, 812, 13, T.muted);

  const boardW = GRID_COLS * 38;
  const boardH = GRID_ROWS * 38;
  panel(root, (STAGE_W - boardW) / 2 - 16, 130 - 16 + 0, boardW + 32, boardH + 32);
  const gfx = new Graphics();
  gfx.x = (STAGE_W - boardW) / 2;
  gfx.y = 130;
  root.addChild(gfx);

  /* ---- state ---- */
  let body: Cell[] = SPAWN_CELLS.slice();
  let dir: Dir = DIRS.right;
  const pendingDirs: Dir[] = [];
  const queue = appleQueue(ctx.seed);
  let qHead = 0;
  let eaten = 0;
  let dead = false;
  let elapsedMs = 0;
  let stepAccum = 0;
  const interval = stepMs(ctx.depth);

  const bodyKeys = (): Set<string> => new Set(body.map((c) => `${c.x},${c.y}`));

  function nextApple(): Cell | null {
    while (qHead < queue.length) {
      const c = queue[qHead];
      if (!bodyKeys().has(`${c.x},${c.y}`)) return c;
      qHead++;
    }
    return null; // unreachable below quota (queue >> quota)
  }
  let apple = nextApple();

  function settleNow(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function win(): void {
    settleNow({
      correct: true,
      points: eaten * APPLE_PTS + surviveBonus(ctx.depth),
      hpDelta: 0,
      summary: `APEX SERPENT · ${eaten} APPLES`,
    });
  }
  function die(): void {
    settleNow({ correct: false, points: -40, hpDelta: -12, summary: 'THE SERPENT BIT ITSELF' });
  }
  function timeUp(): void {
    settleNow({
      correct: null,
      points: eaten * APPLE_PTS,
      hpDelta: 0,
      summary: `TIME — ${eaten} APPLES HARVESTED`,
    });
  }

  function turn(name: keyof typeof DIRS): void {
    if (pendingDirs.length >= 2) return;
    pendingDirs.push(DIRS[name]);
  }

  function step(): void {
    // consume one queued turn, rejecting reversals against current dir
    while (pendingDirs.length > 0) {
      const d = pendingDirs.shift()!;
      if (d.dx !== -dir.dx || d.dy !== -dir.dy) {
        dir = d;
        break;
      }
    }
    const head = body[0];
    const nx = (head.x + dir.dx + GRID_COLS) % GRID_COLS; // wrap walls
    const ny = (head.y + dir.dy + GRID_ROWS) % GRID_ROWS;

    const growing = apple !== null && nx === apple.x && ny === apple.y;
    // self-collision: tail cell vacates this tick unless we grow
    const checkLen = growing ? body.length : body.length - 1;
    for (let i = 0; i < checkLen; i++) {
      if (body[i].x === nx && body[i].y === ny) {
        die();
        return;
      }
    }
    body.unshift({ x: nx, y: ny });
    if (growing && apple) {
      eaten++;
      status.text = `EAT ${N} APPLES · ${eaten}/${N}`;
      if (eaten >= N) {
        win();
        return;
      }
      apple = nextApple();
    } else {
      body.pop();
    }
    draw();
  }

  function draw(): void {
    gfx.clear();
    gfx.roundRect(0, 0, boardW, boardH, T.radius).fill(T.tile);
    const cell = 38;
    for (let i = body.length - 1; i >= 0; i--) {
      const s = body[i];
      gfx.roundRect(s.x * cell + 3, s.y * cell + 3, cell - 6, cell - 6, 7).fill({ color: hue, alpha: i === 0 ? 1 : 0.72 });
    }
    if (apple) {
      const cxp = apple.x * cell + cell / 2;
      const cyp = apple.y * cell + cell / 2;
      const r = 11;
      gfx.poly([cxp, cyp - r, cxp + r, cyp, cxp, cyp + r, cxp - r, cyp]).fill(T.accentA);
    }
  }

  /* ---- input ---- */
  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    switch (e.key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        e.preventDefault();
        turn('up');
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        e.preventDefault();
        turn('down');
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        e.preventDefault();
        turn('left');
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        e.preventDefault();
        break;
      case 'Escape':
        timeEscapeNeutral();
        break;
      default:
        break;
    }
  }
  function timeEscapeNeutral(): void {
    timeUp();
  }

  let swipeStart: { x: number; y: number } | null = null;
  function onDown(e: FederatedPointerEvent): void {
    swipeStart = { x: e.globalX, y: e.globalY };
  }
  function onUp(e: FederatedPointerEvent): void {
    if (!swipeStart || dead) return;
    const dx = e.globalX - swipeStart.x;
    const dy = e.globalY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) turn(dx > 0 ? 'right' : 'left');
    else turn(dy > 0 ? 'down' : 'up');
  }
  window.addEventListener('keydown', onKey);
  root.eventMode = 'static';
  root.on('pointerdown', onDown);
  root.on('pointerup', onUp);

  /* ---- clock ---- */
  const onTick = (tk: Ticker): void => {
    if (dead) return;
    elapsedMs += tk.deltaMS;
    stepAccum += tk.deltaMS;
    while (stepAccum >= interval) {
      stepAccum -= interval;
      step();
      if (dead) return;
    }
    if (elapsedMs >= ctx.timerLen * 1000) timeUp();
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.off('pointerdown', onDown);
    root.off('pointerup', onUp);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  draw();
}

/* ------------------------------------------------------------------ */
/* Self-test (pure)                                                    */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  for (let depth = 1; depth <= 12; depth++) {
    if (quota(depth) !== 12 + depth) failures.push(`quota(${depth}) != 12+depth`);
    if (stepMs(depth) < 55) failures.push(`stepMs(${depth}) below floor`);
  }
  for (let seed = 1; seed <= 300; seed++) {
    const a = appleQueue(seed);
    const b = appleQueue(seed);
    if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`appleQueue nondeterministic seed=${seed}`);
    const keys = new Set(a.map((c) => `${c.x},${c.y}`));
    if (keys.size !== a.length) failures.push(`appleQueue duplicates seed=${seed}`);
    if (a.some((c) => c.x < 0 || c.x >= GRID_COLS || c.y < 0 || c.y >= GRID_ROWS)) failures.push(`appleQueue off-grid seed=${seed}`);
    const spawnKeys = new Set(SPAWN_CELLS.map((c) => `${c.x},${c.y}`));
    if (a.some((c) => spawnKeys.has(`${c.x},${c.y}`))) failures.push(`appleQueue overlaps spawn seed=${seed}`);
    if (a.length !== GRID_COLS * GRID_ROWS - SPAWN_CELLS.length) failures.push(`appleQueue wrong size seed=${seed}`);
  }
  // first apples of two different seeds should differ often (real shuffle)
  let differing = 0;
  for (let seed = 1; seed <= 100; seed += 2) {
    if (appleQueue(seed)[0].x !== appleQueue(seed + 1)[0].x || appleQueue(seed)[0].y !== appleQueue(seed + 1)[0].y) differing++;
  }
  if (differing < 30) failures.push(`apple sequences barely vary across seeds (${differing}/50)`);
  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;
