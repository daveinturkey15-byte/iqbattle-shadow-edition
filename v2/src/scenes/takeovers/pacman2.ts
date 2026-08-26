/**
 * GLUTTON 2 — maze-munch takeover scene (v2 port of modes/pacman.js,
 * mechanic not code). Exclusive new file — owns nothing shared.
 *
 * MECHANIC — clear-or-survive quota:
 *   Authored 15x11 maze-lite (seeded horizontal mirror), pellets on every
 *   open cell. Arrows/WASD steer (buffered at cell centres, instant reversal).
 *   TWO ghosts chase with STEERING-LAG: at each centre a ghost steers toward
 *   where you were LAG ms ago (no reversing unless dead-end). Power pellets
 *   FLIP THE HUNTERS for 6 s — frightened ghosts flee, and a touch eats them
 *   for points instead of you. Quota:
 *     all pellets eaten, OR cap reached with >= 85% eaten  -> correct true
 *     caught by a hunter                                    -> false (-40/-12 hp)
 *     cap reached under 85%                                 -> neutral half-pay
 *
 * POINTS CURVE vs puzzle par 100*diff+40 (diff = clamp(1+floor(depth/6),1,5)):
 *   pellet  = diff            (1..5)      77 pellets + 2 power per board
 *   ghost   = 30*diff         per hunter eaten
 *   clear   = 40 + 20*diff    bonus
 *   Full-clear wins land ~98-125% of par (d1 ~137+, d5 ~525-675 vs 540);
 *   survive-at-cap keeps banked pellets only; starve pays half bank.
 *
 * DETERMINISM: maze mirror coin, power-pellet corners and NOTHING ELSE come
 * from an own mulberry32 (salted) in FIXED draw order at creation. Ghost
 * steering is pure positional math — zero runtime draws. No Math.random,
 * no Date.now — the clock is Pixi's shared ticker delta fed through a fixed
 * 4 ms simulation sub-step, so replays are exact.
 *
 * FAIRNESS RAILS: 1.2 s READY freeze shows the legend; chase speed stays
 * <= 1.02x player (d1 ghost is 0.78x — escapable); contact radius 55% of a
 * cell; hunters visibly change MARK (never hue) when flipped; eaten hunters
 * fly home as eye-pairs before rejoining; Esc bails NEUTRAL; every text
 * >= 11 px; self-resolves inside ctx.timerLen; StageResult settles exactly
 * once via onceResolve and ctx.container is emptied on done.
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

/** Authored maze-lite, 15x11, border-sealed. '#' wall, '.' open. */
export const MAZE: string[] = [
  '###############',
  '#.............#',
  '#.##.#####.##.#',
  '#.#.........#.#',
  '#.#.##.#.##.#.#',
  '#......#......#',
  '#.#.##.#.##.#.#',
  '#.#.........#.#',
  '#.##.#####.##.#',
  '#.............#',
  '###############',
];
export const MAZE_W = 15;
export const MAZE_H = 11;

const PAC_SALT = 0x1ace7ea5;

export const PLAYER_CELL = { x: 7, y: 9 };
export const GHOST_CELLS = [{ x: 6, y: 1 }, { x: 8, y: 1 }];
export const HOME_CELL = { x: 7, y: 1 };

/** Horizontal mirror — the one seeded layout coin-flip. */
export function mirrorMaze(rows: string[]): string[] {
  return rows.map((r) => [...r].reverse().join(''));
}

export function isOpen(rows: string[], x: number, y: number): boolean {
  return y >= 0 && y < rows.length && x >= 0 && x < rows[y].length && rows[y][x] !== '#';
}

/** BFS flood from (sx,sy); returns how many open cells are reachable. */
export function bfsReachable(rows: string[], sx: number, sy: number): number {
  if (!isOpen(rows, sx, sy)) return 0;
  const seen = new Set<number>([sy * MAZE_W + sx]);
  const q = [[sx, sy]];
  while (q.length > 0) {
    const [x, y] = q.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      const key = ny * MAZE_W + nx;
      if (isOpen(rows, nx, ny) && !seen.has(key)) {
        seen.add(key);
        q.push([nx, ny]);
      }
    }
  }
  return seen.size;
}

export function countOpen(rows: string[]): number {
  let n = 0;
  for (const row of rows) for (const ch of row) if (ch !== '#') n++;
  return n;
}

export function diffFor(depth: number): number {
  return Math.min(5, Math.max(1, 1 + Math.floor(Math.max(0, depth) / 6)));
}
export const pelletPts = (diff: number): number => diff;
export const ghostPts = (diff: number): number => 30 * diff;
export const clearBonus = (diff: number): number => 40 + 20 * diff;
export const SURVIVE_RATIO = 0.85;
export const FRIGHT_MS = 6000;

export interface PacActor {
  cx: number; cy: number;       // current cell
  dx: number; dy: number;       // heading (unit axis or 0,0)
  p: number;                    // progress 0..1 toward next cell
}
export interface PacGhost extends PacActor {
  mode: 'chase' | 'fright' | 'eyes';
}

export interface PacSim {
  maze: string[];
  pellets: Uint8Array;          // 0 none · 1 pellet · 2 power
  total: number; eaten: number;
  player: PacActor;
  bufDx: number; bufDy: number;
  ghosts: PacGhost[];
  /** flat player-centre history: t,cx,cy triples — the lag memory */
  trail: number[];
  t: number;                    // sim ms
  readyMs: number;
  frightMs: number;
  diff: number;
  lagMs: number;
  kills: number;
  caught: boolean;
}

export interface PacEvents {
  pellet: boolean; power: boolean; kill: boolean; caught: boolean; cleared: boolean;
}

const STEP_MS = 4;
const PLAYER_SPEED = 0.0055;    // cells per ms

function ghostSpeed(s: PacSim, g: PacGhost): number {
  if (g.mode === 'eyes') return 0.009;
  if (g.mode === 'fright') return 0.003;
  return Math.min(0.0056, PLAYER_SPEED * (0.72 + 0.06 * s.diff));
}

export function createPacSim(seed: number, depth: number): PacSim {
  const rng = mulberry32((seed ^ PAC_SALT) >>> 0);
  const maze = rng() < 0.5 ? MAZE : mirrorMaze(MAZE);
  const pellets = new Uint8Array(MAZE_W * MAZE_H);
  let total = 0;
  for (let y = 0; y < MAZE_H; y++) {
    for (let x = 0; x < MAZE_W; x++) {
      if (!isOpen(maze, x, y)) continue;
      const spawnCell =
        (x === PLAYER_CELL.x && y === PLAYER_CELL.y) ||
        GHOST_CELLS.some((g) => g.x === x && g.y === y);
      if (!spawnCell) { pellets[y * MAZE_W + x] = 1; total++; }
    }
  }
  // two opposite-ish corners become power pellets — FIXED draw order
  const corners = [[1, 1], [13, 1], [1, 9], [13, 9]];
  const i = Math.floor(rng() * 4);
  let j = Math.floor(rng() * 3);
  if (j >= i) j++;
  for (const [cx, cy] of [corners[i], corners[j]]) pellets[cy * MAZE_W + cx] = 2;
  return {
    maze,
    pellets,
    total, eaten: 0,
    player: { cx: PLAYER_CELL.x, cy: PLAYER_CELL.y, dx: -1, dy: 0, p: 0 },
    bufDx: 0, bufDy: 0,
    ghosts: GHOST_CELLS.map((g, gi) => ({
      cx: g.x, cy: g.y, dx: gi === 0 ? -1 : 1, dy: 0, p: 0,
      mode: 'chase' as const,
    })),
    trail: [0, PLAYER_CELL.x, PLAYER_CELL.y],
    t: 0,
    readyMs: 1200,
    frightMs: 0,
    diff: diffFor(depth),
    lagMs: Math.max(350, 900 - 100 * diffFor(depth)),
    kills: 0,
    caught: false,
  };
}

export function pacInput(s: PacSim, dx: number, dy: number): void {
  s.bufDx = dx; s.bufDy = dy;
}

function lagTarget(s: PacSim): [number, number] {
  const q = s.t - s.lagMs;
  for (let i = s.trail.length - 3; i >= 0; i -= 3) {
    if (s.trail[i] <= q) return [s.trail[i + 1], s.trail[i + 2]];
  }
  return [s.trail[1], s.trail[2]];
}

type Decide = (a: PacActor) => void;

/** Advance an actor; decisions happen exactly at cell centres. */
function moveActor(a: PacActor, speed: number, steps: number, decide: Decide): boolean {
  let arrived = false;
  if (a.dx === 0 && a.dy === 0) {
    decide(a);
    if (a.dx === 0 && a.dy === 0) return arrived;
  }
  a.p += speed * steps;
  while (a.p >= 1) {
    a.cx += a.dx; a.cy += a.dy; a.p -= 1;
    arrived = true;
    decide(a);
    if (a.dx === 0 && a.dy === 0) { a.p = 0; break; }
  }
  return arrived;
}

const DIRS: ReadonlyArray<readonly [number, number]> = [[0, -1], [-1, 0], [0, 1], [1, 0]];

function decidePlayer(s: PacSim): Decide {
  return (a) => {
    if (s.bufDx !== 0 || s.bufDy !== 0) {
      if (isOpen(s.maze, a.cx + s.bufDx, a.cy + s.bufDy)) {
        a.dx = s.bufDx; a.dy = s.bufDy;
        s.bufDx = 0; s.bufDy = 0;
        s.trail.push(s.t, a.cx, a.cy);
        if (s.trail.length > 192) s.trail.splice(0, 3);
        return;
      }
    }
    if (!isOpen(s.maze, a.cx + a.dx, a.cy + a.dy)) { a.dx = 0; a.dy = 0; }
    s.trail.push(s.t, a.cx, a.cy);
    if (s.trail.length > 192) s.trail.splice(0, 3);
  };
}

function decideGhost(s: PacSim, g: PacGhost): Decide {
  return () => {
    if (g.mode === 'eyes' && g.cx === HOME_CELL.x && g.cy === HOME_CELL.y) {
      g.mode = 'chase';
    }
    const revX = -g.dx, revY = -g.dy;
    const opts = DIRS.filter(
      ([dx, dy]) => !(dx === revX && dy === revY) && isOpen(s.maze, g.cx + dx, g.cy + dy),
    );
    const cand = opts.length > 0 ? opts : (DIRS.filter(([dx, dy]) => isOpen(s.maze, g.cx + dx, g.cy + dy)));
    if (cand.length === 0) return;
    let best = cand[0];
    if (g.mode === 'fright') {
      let far = -Infinity;
      for (const [dx, dy] of cand) {
        const d = (g.cx + dx - s.player.cx) ** 2 + (g.cy + dy - s.player.cy) ** 2;
        if (d > far) { far = d; best = [dx, dy]; }
      }
    } else {
      // steering-lag: chase where the player WAS lagMs ago (eyes chase home)
      const [tx, ty] = g.mode === 'eyes' ? [HOME_CELL.x, HOME_CELL.y] : lagTarget(s);
      let near = Infinity;
      for (const [dx, dy] of cand) {
        const d = (g.cx + dx - tx) ** 2 + (g.cy + dy - ty) ** 2;
        if (d < near) { near = d; best = [dx, dy]; }
      }
    }
    g.dx = best[0]; g.dy = best[1];
  };
}

function eatAtCentre(s: PacSim, ev: PacEvents): void {
  const pl = s.player;
  const v = s.pellets[pl.cy * MAZE_W + pl.cx];
  if (v === 0) return;
  s.pellets[pl.cy * MAZE_W + pl.cx] = 0;
  s.eaten++;
  ev.pellet = true;
  if (v === 2) {
    ev.power = true;
    s.frightMs = FRIGHT_MS;
    for (const g of s.ghosts) {
      if (g.mode === 'chase') {
        g.mode = 'fright';
        g.dx = -g.dx; g.dy = -g.dy;
      }
    }
  }
  if (s.eaten >= s.total) ev.cleared = true;
}

/** Advance the whole simulation by dtMs of sim time (fixed 4 ms sub-steps). */
export function stepPacSim(s: PacSim, dtMs: number): PacEvents {
  const ev: PacEvents = { pellet: false, power: false, kill: false, caught: false, cleared: false };
  let acc = dtMs;
  while (acc > 0 && !s.caught && !ev.cleared) {
    const step = Math.min(STEP_MS, acc);
    acc -= step;
    s.t += step;
    if (s.readyMs > 0) { s.readyMs -= step; continue; }
    if (s.frightMs > 0) {
      s.frightMs -= step;
      if (s.frightMs === 0) {
        for (const g of s.ghosts) if (g.mode === 'fright') g.mode = 'chase';
      }
    }
    const pdArrived = moveActor(s.player, PLAYER_SPEED, step, decidePlayer(s));
    if (pdArrived) eatAtCentre(s, ev);
    for (const g of s.ghosts) {
      moveActor(g, ghostSpeed(s, g), step, decideGhost(s, g));
      const gx = g.cx + g.dx * g.p, gy = g.cy + g.dy * g.p;
      const px = s.player.cx + s.player.dx * s.player.p, py = s.player.cy + s.player.dy * s.player.p;
      if ((gx - px) ** 2 + (gy - py) ** 2 < 0.55 * 0.55) {
        if (g.mode === 'fright') {
          g.mode = 'eyes'; g.dx = 0; g.dy = 0; g.p = 0;
          s.kills++;
          ev.kill = true;
        } else if (g.mode === 'chase') {
          s.caught = true;
          ev.caught = true;
          return ev;
        }
      }
    }
  }
  return ev;
}

export interface PacTally {
  eaten: number; total: number; kills: number; caught: boolean; cleared: boolean;
}

/** Verdict ladder — see header curve. */
export function pacVerdict(
  tl: PacTally, diff: number,
): { correct: boolean | null; points: number; hpDelta: number; summary: string } {
  const banked = tl.eaten * pelletPts(diff) + tl.kills * ghostPts(diff);
  if (tl.caught) {
    return { correct: false, points: -40, hpDelta: -12, summary: `CAUGHT — ${tl.eaten}/${tl.total} PELLETS` };
  }
  const ratio = tl.total > 0 ? tl.eaten / tl.total : 1;
  if (tl.cleared || ratio >= SURVIVE_RATIO) {
    return {
      correct: true,
      points: banked + (tl.cleared ? clearBonus(diff) : 0),
      hpDelta: 0,
      summary: tl.cleared ? 'MAZE DEVOURED' : `SURVIVED — ${tl.eaten}/${tl.total} PELLETS`,
    };
  }
  return {
    correct: null,
    points: Math.round(banked * 0.5),
    hpDelta: 0,
    summary: `STARVED — ${tl.eaten}/${tl.total} PELLETS`,
  };
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

const CELL = 44;
const BOARD_W = MAZE_W * CELL;
const BOARD_H = MAZE_H * CELL;

function actorPrims(kind: 'player' | 'ghost' | 'fright' | 'eyes'): Prim[] {
  switch (kind) {
    case 'player': return [{ k: 'tri', x: 50, y: 52, s: 16 }];
    case 'ghost': return [
      { k: 'diamond', x: 50, y: 50, s: 15 },
      { k: 'dot', x: 40, y: 34, r: 4 },
      { k: 'dot', x: 60, y: 34, r: 4 },
    ];
    case 'fright': return [
      { k: 'tri', x: 50, y: 58, s: 15 },
      { k: 'line', x1: 32, y1: 32, x2: 68, y2: 32 },
    ];
    default: return [
      { k: 'dot', x: 41, y: 46, r: 6 },
      { k: 'dot', x: 59, y: 46, r: 6 },
    ];
  }
}

export function mountPacman2(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const hue = T.boardHues[(ctx.seed >>> 3) % T.boardHues.length];
  const settle = onceResolve(ctx.onDone);

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W; bg.height = STAGE_H; bg.tint = T.bg;
  root.addChild(bg);

  const bx = (STAGE_W - BOARD_W) / 2;
  const by = 176;
  text(root, 'GLUTTON 2', STAGE_W / 2 - 74, 92, 30, hue, true);
  const status = text(root, '', bx, by + BOARD_H + 22, 19, T.ink, true);
  const progress = text(root, '', bx, by + BOARD_H + 58, 15, T.muted);
  text(root, 'ARROWS / WASD STEER · POWER DIAMONDS FLIP THE HUNTERS FOR 6 SECONDS',
    bx, by + BOARD_H + 92, 13, T.muted);

  /* ---- static board layer ---- */
  const sim = createPacSim(ctx.seed, ctx.depth);
  const wallTex = Texture.WHITE;
  const pelletTex = Texture.from(tileCanvas([{ k: 'dot', x: 50, y: 50, r: 4 }], hue, CELL));
  const powerTex = Texture.from(tileCanvas([{ k: 'diamond', x: 50, y: 50, s: 13 }], hue, CELL));
  const pelletSprites: Array<{ sp: Sprite; kind: number }> = [];

  for (let y = 0; y < MAZE_H; y++) {
    for (let x = 0; x < MAZE_W; x++) {
      if (!isOpen(sim.maze, x, y)) {
        const w = new Sprite(wallTex);
        w.width = CELL - 2; w.height = CELL - 2;
        w.x = bx + x * CELL + 1; w.y = by + y * CELL + 1;
        w.tint = 0x18233a;
        root.addChild(w);
        continue;
      }
      const kind = sim.pellets[y * MAZE_W + x];
      if (kind > 0) {
        const sp = new Sprite(kind === 2 ? powerTex : pelletTex);
        sp.x = bx + x * CELL; sp.y = by + y * CELL;
        root.addChild(sp);
        pelletSprites.push({ sp, kind });
      }
    }
  }

  /* ---- actors ---- */
  const mkActor = (prims: Prim[]): Sprite => {
    const s = new Sprite(Texture.from(tileCanvas(prims, hue, CELL)));
    s.width = CELL; s.height = CELL;
    root.addChild(s);
    return s;
  };
  const playerSpr = mkActor(actorPrims('player'));
  const ghostSprs = sim.ghosts.map(() => ({
    chase: mkActor(actorPrims('ghost')),
    fright: mkActor(actorPrims('fright')),
    eyes: mkActor(actorPrims('eyes')),
  }));
  const readyCard = text(root, 'READY — ARROWS / WASD TO STEER', STAGE_W / 2 - 148, by - 40, 20, hue, true);

  /* ---- state ---- */
  let dead = false;
  let acc = 0;

  function finish(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function refresh(): void {
    const frac = sim.total > 0 ? Math.floor((sim.eaten / sim.total) * 100) : 100;
    progress.text =
      `PELLETS ${sim.eaten}/${sim.total} (${frac}% · QUOTA ${Math.round(SURVIVE_RATIO * 100)}%)` +
      ` · HUNTERS EATEN ${sim.kills}` +
      (sim.frightMs > 0 ? ` · FLIPPED ${(sim.frightMs / 1000).toFixed(1)}s` : '');
  }

  function render(): void {
    const pl = sim.player;
    playerSpr.x = bx + (pl.cx + pl.dx * pl.p) * CELL;
    playerSpr.y = by + (pl.cy + pl.dy * pl.p) * CELL;
    playerSpr.rotation = Math.atan2(pl.dy, pl.dx) + Math.PI / 2;
    sim.ghosts.forEach((g, i) => {
      const set = ghostSprs[i];
      set.chase.visible = g.mode === 'chase';
      set.fright.visible = g.mode === 'fright';
      set.fright.alpha = sim.frightMs > 0 && sim.frightMs < 1500
        ? 0.45 + 0.55 * Math.abs(Math.sin(sim.t / 90))
        : 1;
      set.eyes.visible = g.mode === 'eyes';
      const cur = g.mode === 'chase' ? set.chase : g.mode === 'fright' ? set.fright : set.eyes;
      cur.x = bx + (g.cx + g.dx * g.p) * CELL;
      cur.y = by + (g.cy + g.dy * g.p) * CELL;
      for (const k of ['chase', 'fright', 'eyes'] as const) {
        if (ghostSprs[i][k] !== cur) ghostSprs[i][k].visible = false;
      }
      cur.visible = true;
    });
    for (const ps of pelletSprites) {
      if (ps.kind === 2 && ps.sp.visible) {
        ps.sp.alpha = 0.65 + 0.35 * Math.abs(Math.sin(sim.t / 260));
      }
    }
  }

  function hidePellet(cx: number, cy: number): void {
    const hit = pelletSprites.find((ps) =>
      ps.sp.visible &&
      Math.abs(ps.sp.x - (bx + cx * CELL)) < 1 &&
      Math.abs(ps.sp.y - (by + cy * CELL)) < 1,
    );
    if (hit) hit.sp.visible = false;
  }

  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    switch (e.key) {
      case 'Escape':
        finish(escaped(0, 'SLIPPED OUT OF THE MAZE'));
        return;
      case 'ArrowUp': case 'w': case 'W': pacInput(sim, 0, -1); break;
      case 'ArrowDown': case 's': case 'S': pacInput(sim, 0, 1); break;
      case 'ArrowLeft': case 'a': case 'A': pacInput(sim, -1, 0); break;
      case 'ArrowRight': case 'd': case 'D': pacInput(sim, 1, 0); break;
      default: return;
    }
    e.preventDefault();
  }

  window.addEventListener('keydown', onKey);

  const onTick = (tk: Ticker): void => {
    if (dead) return;
    const dt = Math.min(100, tk.deltaMS);
    acc += dt;
    let cleared = false;
    while (acc >= STEP_MS && !dead && !cleared && !sim.caught) {
      acc -= STEP_MS;
      const before = sim.eaten;
      const ev = stepPacSim(sim, STEP_MS);
      if (sim.eaten > before) hidePellet(sim.player.cx, sim.player.cy);
      if (ev.kill) status.text = 'HUNTER DEVOURED';
      if (ev.power) status.text = 'THE HUNTERS ARE FLIPPED — EAT THEM';
      if (ev.cleared) cleared = true;
    }
    if (readyCard.visible && sim.readyMs <= 0) readyCard.visible = false;
    if (sim.caught) {
      finish(pacVerdict(tallyOf(sim), sim.diff));
      return;
    }
    if (cleared) {
      finish(pacVerdict({ ...tallyOf(sim), cleared: true }, sim.diff));
      return;
    }
    if (sim.t >= ctx.timerLen * 1000) {
      finish(pacVerdict(tallyOf(sim), sim.diff));
      return;
    }
    if (!dead) { render(); refresh(); }
  };
  Ticker.shared.add(onTick);
  const tallyOf = (s: PacSim) => ({
    eaten: s.eaten, total: s.total, kills: s.kills, caught: s.caught, cleared: s.eaten >= s.total,
  });

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  refresh();
  render();
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // maze rails: both orientations fully connected, sealed borders, sane size
  for (const rows of [MAZE, mirrorMaze(MAZE)]) {
    if (rows.length !== MAZE_H || rows[0].length !== MAZE_W) failures.push('maze dims wrong');
    if (bfsReachable(rows, 7, 9) !== countOpen(rows)) failures.push('maze has unreachable pellets');
    if (!isOpen(rows, PLAYER_CELL.x, PLAYER_CELL.y)) failures.push('player spawn is a wall');
    for (const g of GHOST_CELLS) if (!isOpen(rows, g.x, g.y)) failures.push('ghost spawn is a wall');
    if (bfsReachable(rows, 0, 0) !== 0) failures.push('border not sealed');
  }

  // curve sanity
  for (let d = 1; d <= 5; d++) {
    const par = 100 * d + 40;
    const fullClear = (MAZE_H * 0 + countOpen(MAZE) - 3) * pelletPts(d) + clearBonus(d);
    if (fullClear < 0.9 * par || fullClear > 1.4 * par) {
      failures.push(`clear pay off-par diff=${d} pay=${fullClear} par=${par}`);
    }
  }

  // determinism + rails over 300 seeds with scripted seeded inputs
  for (let seed = 1; seed <= 300; seed++) {
    const a = createPacSim(seed, ((seed * 7) % 30) + 1);
    const b = createPacSim(seed, ((seed * 7) % 30) + 1);
    if (a.maze.join('|') !== b.maze.join('|')) failures.push(`mirror nondeterministic seed=${seed}`);
    let powers = 0;
    for (let i = 0; i < a.pellets.length; i++) if (a.pellets[i] === 2) powers++;
    if (powers !== 2) failures.push(`power pellet count != 2 seed=${seed}`);
    if (a.total < 60) failures.push(`too few pellets seed=${seed}`);

    const steer = mulberry32((seed ^ 0xbeef) >>> 0);
    let sawPower = false;
    for (let frame = 0; frame < 4000 && !a.caught && a.eaten < a.total; frame++) {
      if (frame % 120 === 0) {
        const dirs: Array<[number, number]> = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        const [dx, dy] = dirs[Math.floor(steer() * 4)];
        pacInput(a, dx, dy);
        pacInput(b, dx, dy);
      }
      const ea = stepPacSim(a, STEP_MS);
      stepPacSim(b, STEP_MS);
      if (ea.power) sawPower = true;
    }
    if (
      a.eaten !== b.eaten || a.kills !== b.kills || a.caught !== b.caught ||
      a.player.cx !== b.player.cx || a.player.cy !== b.player.cy
    ) failures.push(`sim nondeterministic seed=${seed}`);
    if (a.frightMs > FRIGHT_MS) failures.push(`fright over 6s seed=${seed}`);
  }

  // verdict ladder
  const vCatch = pacVerdict({ eaten: 10, total: 79, kills: 0, caught: true, cleared: false }, 2);
  if (vCatch.correct !== false || vCatch.points !== -40 || vCatch.hpDelta !== -12) failures.push('caught verdict wrong');
  const vClear = pacVerdict({ eaten: 79, total: 79, kills: 1, caught: false, cleared: true }, 3);
  if (vClear.correct !== true || vClear.points !== 79 * 3 + 90 + 100) failures.push('clear verdict wrong');
  const vSurv = pacVerdict({ eaten: 70, total: 79, kills: 0, caught: false, cleared: false }, 3);
  if (vSurv.correct !== true) failures.push('>=85% survive must win');
  const vStarve = pacVerdict({ eaten: 20, total: 79, kills: 0, caught: false, cleared: false }, 3);
  if (vStarve.correct !== null || vStarve.points !== Math.round(20 * 3 * 0.5)) failures.push('starve verdict wrong');

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;
