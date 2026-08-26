/**
 * SALVOS 2 — hidden-fleet duel takeover scene (v2 port of modes/battleship.js,
 * mechanic not code). Exclusive new file — owns nothing shared.
 *
 * MECHANIC — duel the shadow fleet:
 *   Two 8x8 grids. The enemy fleet (one 4, one 3, one 2 = 9 cells) is placed
 *   by the seed on the left grid; YOUR fleet comes from an independent salted
 *   stream so incoming fire is identical for a given seed. You spend SHELLS
 *   clicking enemy water; every third shell provokes RETURN FIRE (diff >= 3)
 *   resolved by a seeded hunt/target gun against your fleet. Each incoming
 *   hit costs -20 POINTS.
 *     whole shadow fleet sunk            -> correct true
 *     out of shells with >= 5 hits       -> null (fleet survives, partial pay)
 *     out of shells with fewer than 5    -> false (-40 / -12 hp)
 *
 * SHELLS + POINTS CURVE vs puzzle par 100*diff+40 (diff = clamp(1+floor(depth/6),1,5)):
 *   shells      = 17 - diff                       (16 down to 12)
 *   hit         = 5 + 4*diff
 *   sunk bonus  = 12 + 6*diff                     per ship (3 ships)
 *   all-sunk    = 30 + 15*diff                    bonus
 *   incoming    = -20 per hit on your water (diff>=3 only)
 *   A clean full sink lands ~84-130% of par (d1 ~180/140 hot when you thread
 *   return fire, d5 ~480/540 because nine hits at 26 pts cannot reach par
 *   without overscaling — documented mercy). Fail pays -40 parity.
 *
 * DETERMINISM: enemy fleet, your fleet and the ENTIRE return-fire plan are
 * drawn from two own mulberry32 streams (distinct salts) in FIXED draw order
 * at mount. No Math.random, no Date.now — verdicts are pure functions of the
 * seed and your shot sequence, so a host could replay shot integers alone.
 *
 * FAIRNESS RAILS: markers are colorblind-safe STRUCTURE (hit = X-cross pair,
 * miss = dot, sunk = filled diamond row) in ONE hue — never hue alone;
 * return fire is telegraphed one beat before it lands on your board; no
 * fullscreen flashes; pointer + keyboard parity (type column,row e.g. `a1`
 * then Enter); Esc bails NEUTRAL; every text >= 11 px; self-resolves inside
 * ctx.timerLen; StageResult settles exactly once via onceResolve.
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

export const GRID = 8;
export const FLEET = [4, 3, 2];
export const ENEMY_SALT = 0x0a7f1e1d;
export const HOME_SALT = 0x0b0b5711;

export function diffFor(depth: number): number {
  return Math.min(5, Math.max(1, 1 + Math.floor(Math.max(0, depth) / 6)));
}
export const shellsFor = (diff: number): number => 17 - diff;
export const hitPts = (diff: number): number => 5 + 4 * diff;
export const sunkPts = (diff: number): number => 12 + 6 * diff;
export const allSunkPts = (diff: number): number => 30 + 15 * diff;
export const INCOMING_COST = 20;

/** One placed ship: anchor + horizontal flag; cells derived. */
export interface Ship {
  len: number;
  x: number;
  y: number;
  horiz: boolean;
}
export function shipCells(s: Ship): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < s.len; i++) out.push(s.horiz ? [s.x + i, s.y] : [s.x, s.y + i]);
  return out;
}

/** Place FLEET with no overlaps. rng draws: orientation, x, y — per ship, fixed order. */
export function placeFleet(rng: () => number): Ship[] | null {
  const taken = new Set<string>();
  const ships: Ship[] = [];
  for (const len of FLEET) {
    let ship: Ship | null = null;
    for (let attempt = 0; attempt < 200; attempt++) {
      const horiz = rng() < 0.5;
      const x = Math.floor(rng() * (horiz ? GRID - len + 1 : GRID));
      const y = Math.floor(rng() * (horiz ? GRID : GRID - len + 1));
      const cand: Ship = { len, x, y, horiz };
      const cells = shipCells(cand);
      if (cells.every(([cx, cy]) => !taken.has(`${cx},${cy}`))) {
        for (const [cx, cy] of cells) taken.add(`${cx},${cy}`);
        ship = cand;
        break;
      }
    }
    if (!ship) return null; // impossible in practice at 8x8/9 cells
    ships.push(ship);
  }
  return ships;
}

export type WaterGrid = Int8Array; // GRID*GRID: -1 water else ship index

export function fleetGrid(ships: Ship[]): WaterGrid {
  const g = new Int8Array(GRID * GRID).fill(-1);
  ships.forEach((s, i) => {
    for (const [cx, cy] of shipCells(s)) g[cy * GRID + cx] = i;
  });
  return g;
}

export interface ShotOutcome {
  hit: boolean;
  shipIdx: number; // -1 miss
  sunkLen: number; // 0 unless this shot sank a ship
}

/** Apply a shot to a live tally; returns outcome. Pure given state arrays. */
export function applyShot(
  grid: WaterGrid,
  hitsPerShip: number[],
  sunk: boolean[],
  r: number,
  c: number,
): ShotOutcome {
  if (r < 0 || r >= GRID || c < 0 || c >= GRID) return { hit: false, shipIdx: -1, sunkLen: 0 };
  const idx = grid[r * GRID + c];
  if (idx < 0) return { hit: false, shipIdx: -1, sunkLen: 0 };
  if (sunk[idx]) return { hit: false, shipIdx: idx, sunkLen: 0 }; // dead water
  // NOTE: repeat-cell guards are the CALLER'S job (scene marks / plan set).
  hitsPerShip[idx]++;
  if (hitsPerShip[idx] >= FLEET[idx]) {
    sunk[idx] = true;
    return { hit: true, shipIdx: idx, sunkLen: FLEET[idx] };
  }
  return { hit: true, shipIdx: idx, sunkLen: 0 };
}

/**
 * Precompute the ENTIRE incoming-fire plan (hunt/target) against your fleet
 * with a dedicated seeded stream. Fixed draw order: hunt shots draw
 * orientation-free random cells; after a hit the four neighbours queue in
 * N,W,E,S order. Never repeats a cell while water remains.
 */
export function buildIncomingPlan(rng: () => number, homeShips: Ship[], maxShots: number): Array<[number, number]> {
  const grid = fleetGrid(homeShips);
  const hp = [0, 0, 0];
  const sunk = [false, false, false];
  const shot = new Set<number>();
  const plan: Array<[number, number]> = [];
  let stack: Array<[number, number]> = [];
  while (plan.length < maxShots && shot.size < GRID * GRID) {
    let cell: [number, number] | null = null;
    while (stack.length > 0) {
      const cand = stack.shift()!;
      if (!shot.has(cand[0] * GRID + cand[1])) { cell = cand; break; }
    }
    if (!cell) {
      // hunt: random unshot cell (rejection draws are part of the fixed order)
      let r = 0, c = 0;
      do {
        r = Math.floor(rng() * GRID);
        c = Math.floor(rng() * GRID);
      } while (shot.has(r * GRID + c) && shot.size < GRID * GRID);
      cell = [r, c];
    }
    if (shot.has(cell[0] * GRID + cell[1])) continue;
    shot.add(cell[0] * GRID + cell[1]);
    plan.push(cell);
    const out = applyShot(grid, hp, sunk, cell[0], cell[1]);
    if (out.hit) {
      const [r, c] = cell;
      stack.push([r - 1, c], [r, c - 1], [r, c + 1], [r + 1, c]); // N, W, E, S
    }
  }
  return plan;
}

export function returnShotsFor(diff: number): number {
  if (diff < 3) return 0;
  const perSalvo = diff >= 5 ? 2 : 1;
  return perSalvo * Math.floor(shellsFor(diff) / 3);
}

export interface SalvoTally {
  hits: number;
  uniqueHits: number;
  sunkLens: number[];
  incomingHits: number;
}

/** Verdict ladder — see header curve. */
export function salvoVerdict(
  t: SalvoTally, diff: number,
): { correct: boolean | null; points: number; hpDelta: number; summary: string } {
  const sunkCount = t.sunkLens.length;
  const base = t.uniqueHits * hitPts(diff) + sunkCount * sunkPts(diff) - INCOMING_COST * t.incomingHits;
  if (sunkCount >= FLEET.length) {
    return {
      correct: true,
      points: base + allSunkPts(diff),
      hpDelta: 0,
      summary: 'FLEET SUNK',
    };
  }
  if (t.uniqueHits >= 5) {
    return {
      correct: null,
      points: base,
      hpDelta: 0,
      summary: `${FLEET.reduce((a, b) => a + b, 0) - t.uniqueHits} HULL CELLS STILL AFLOAT`,
    };
  }
  return { correct: false, points: -40, hpDelta: -12, summary: 'THE SHADOW FLEET OUTLASTED YOU' };
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

const CELL = 46;
const BOARD_PX = GRID * CELL;

const MARK_HIT: Prim[] = [
  { k: 'line', x1: 30, y1: 30, x2: 70, y2: 70 },
  { k: 'line', x1: 70, y1: 30, x2: 30, y2: 70 },
];
const MARK_MISS: Prim[] = [{ k: 'dot', x: 50, y: 50, r: 5 }];
const MARK_SUNK: Prim[] = [{ k: 'diamond', x: 50, y: 50, s: 16 }];
const MARK_SHIP: Prim[] = [
  { k: 'line', x1: 22, y1: 50, x2: 78, y2: 50 },
  { k: 'dot', x: 36, y: 38, r: 4 },
];

export function mountBattleship2(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const hue = T.boardHues[(ctx.seed >>> 9) % T.boardHues.length];
  const settle = onceResolve(ctx.onDone);
  const diff = diffFor(ctx.depth);

  const enemyShips = placeFleet(mulberry32((ctx.seed ^ ENEMY_SALT) >>> 0))!;
  const homeShips = placeFleet(mulberry32((ctx.seed ^ HOME_SALT) >>> 0))!;
  const enemyGrid = fleetGrid(enemyShips);
  const homeGrid = fleetGrid(homeShips);
  const plan = buildIncomingPlan(mulberry32((ctx.seed ^ HOME_SALT ^ 0x55aa) >>> 0), homeShips, returnShotsFor(diff));

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W; bg.height = STAGE_H; bg.tint = T.bg;
  root.addChild(bg);

  text(root, 'SALVOS 2', STAGE_W / 2 - 62, 88, 30, hue, true);

  const gap = 96;
  const totalW = BOARD_PX * 2 + gap;
  const ox = (STAGE_W - totalW) / 2;
  const oy = 168;

  const status = text(root, 'FIRE AT WILL', ox, oy + BOARD_PX + 34, 19, T.ink, true);
  const progress = text(root, '', ox, oy + BOARD_PX + 72, 15, T.muted);
  text(root, 'CLICK ENEMY WATER · OR TYPE COLUMN+ROW (A1..H8) + ENTER · EVERY 3RD SHELL PROVOKES RETURN FIRE',
    ox, oy + BOARD_PX + 106, 13, T.muted);

  /* ---- boards ---- */
  const hitTex = Texture.from(tileCanvas(MARK_HIT, hue, CELL));
  const missTex = Texture.from(tileCanvas(MARK_MISS, hue, CELL));
  const sunkTex = Texture.from(tileCanvas(MARK_SUNK, hue, CELL));
  const shipTex = Texture.from(tileCanvas(MARK_SHIP, hue, CELL));

  function boardLabel(str: string, bx: number): void {
    text(root, str, bx, oy - 30, 15, T.muted, true);
  }

  const enemyMarks: Array<Sprite | null> = Array.from({ length: GRID * GRID }, () => null);
  const homeMarks: Array<Sprite | null> = Array.from({ length: GRID * GRID }, () => null);

  function markSprite(tex: Texture, bx: number, r: number, c: number, layer: Array<Sprite | null>): void {
    const i = r * GRID + c;
    if (layer[i]) return;
    const sp = new Sprite(tex);
    sp.x = bx + c * CELL;
    sp.y = oy + r * CELL;
    root.addChild(sp);
    layer[i] = sp;
  }

  // enemy board tiles (clickable)
  const enemyBx = ox;
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const tile = new Sprite(Texture.WHITE);
      tile.width = CELL - 2; tile.height = CELL - 2;
      tile.x = enemyBx + c * CELL; tile.y = oy + r * CELL;
      tile.tint = 0x0d1524;
      tile.eventMode = 'static';
      tile.cursor = 'pointer';
      tile.on('pointerdown', () => fire(r, c));
      root.addChild(tile);
    }
  }
  boardLabel('SHADOW FLEET — FIRE HERE', enemyBx);

  // home board tiles (ships visible, incoming fire lands here)
  const homeBx = ox + BOARD_PX + gap;
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const tile = new Sprite(Texture.WHITE);
      tile.width = CELL - 2; tile.height = CELL - 2;
      tile.x = homeBx + c * CELL; tile.y = oy + r * CELL;
      tile.tint = 0x0a101c;
      root.addChild(tile);
      if (homeGrid[r * GRID + c] >= 0) {
        const sp = new Sprite(shipTex);
        sp.x = homeBx + c * CELL; sp.y = oy + r * CELL;
        root.addChild(sp);
      }
    }
  }
  boardLabel('YOUR WATER', homeBx);

  /* ---- state ---- */
  const hp = [0, 0, 0];           // enemy hits per ship
  const sunkE = [false, false, false];
  const hpHome = [0, 0, 0];
  const sunkH = [false, false, false];
  let shells = shellsFor(diff);
  let shots = 0;
  let hits = 0;                   // distinct successful hits on enemy
  let incomingHits = 0;
  let dead = false;
  let kb = '';

  function finish(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function tally(): SalvoTally {
    return {
      hits: shots,
      uniqueHits: hits,
      sunkLens: FLEET.filter((_, i) => sunkE[i]),
      incomingHits,
    };
  }

  function refresh(): void {
    progress.text =
      `SHELLS ${shells} · HITS ${hits}/9 · SUNK ${tally().sunkLens.length}/3` +
      (diff >= 3 ? ` · INCOMING HITS ${incomingHits} (-20 EACH)` : '');
  }

  /** Resolve end-of-ammo / cap through the ladder. */
  function resolve(summarySuffix: string): void {
    const v = salvoVerdict(tally(), diff);
    finish({ ...v, summary: `${v.summary}${summarySuffix}` });
  }

  function deliverIncoming(count: number): void {
    for (let i = 0; i < count; i++) {
      const shotIdx = incomingHits + i;
      if (shotIdx >= plan.length) break;
      const [r, c] = plan[shotIdx];
      const out = applyShot(homeGrid, hpHome, sunkH, r, c);
      markSprite(out.hit ? (out.sunkLen > 0 ? sunkTex : hitTex) : missTex, homeBx, r, c, homeMarks);
      if (out.hit) incomingHits++;
    }
  }

  function fire(r: number, c: number): void {
    if (dead || shells <= 0) return;
    if (r < 0 || r >= GRID || c < 0 || c >= GRID) return;
    const i = r * GRID + c;
    if (enemyMarks[i]) return; // already fired there
    const out = applyShot(enemyGrid, hp, sunkE, r, c);
    markSprite(out.hit ? (out.sunkLen > 0 ? sunkTex : hitTex) : missTex, enemyBx, r, c, enemyMarks);
    shells--;
    shots++;
    if (out.hit) {
      hits++;
      status.text = out.sunkLen > 0 ? `SHE GOES DOWN — ${out.sunkLen} DECKS` : 'DIRECT HIT';
    } else {
      status.text = 'SPLASH — MISS';
    }
    if (shots % 3 === 0 && diff >= 3) {
      deliverIncoming(diff >= 5 ? 2 : 1);
    }
    refresh();
    if (tally().sunkLens.length === FLEET.length) resolve(' — ALL HULLS LOST');
    else if (shells <= 0) resolve(hits >= 5 ? '' : '');
  }

  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      finish(escaped(0, 'WITHDREW UNDER WHITE FLAG'));
      return;
    }
    if (/^[a-hA-H]$/.test(e.key)) {
      kb = e.key.toLowerCase();
      return;
    }
    if (/^[1-8]$/.test(e.key) && kb !== '') {
      fire(Number(e.key) - 1, kb.charCodeAt(0) - 97); // row from digit, col from letter
      kb = '';
      return;
    }
    if (e.key === 'Enter') kb = '';
  }
  window.addEventListener('keydown', onKey);

  let clockMs = 0;
  const onTick = (tk: Ticker): void => {
    if (dead) return;
    clockMs += tk.deltaMS;
    if (clockMs >= ctx.timerLen * 1000) resolve(' — THE TIDE TURNED');
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }


  refresh();
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // fleet placements over 300 seeds: valid, exact sizes, deterministic
  for (let seed = 1; seed <= 300; seed++) {
    const a = placeFleet(mulberry32((seed ^ ENEMY_SALT) >>> 0));
    const b = placeFleet(mulberry32((seed ^ ENEMY_SALT) >>> 0));
    if (!a) { failures.push(`placement failed seed=${seed}`); continue; }
    if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`fleet nondeterministic seed=${seed}`);
    const cells = a.flatMap(shipCells);
    if (cells.length !== 9) failures.push('fleet is not 9 cells');
    const keys = cells.map(([r, c]) => `${r},${c}`);
    if (new Set(keys).size !== keys.length) failures.push('overlapping ship cells');
    for (const [r, c] of cells) {
      if (r < 0 || r >= GRID || c < 0 || c >= GRID) failures.push('ship out of bounds');
    }
    if (a.map((s) => s.len).join() !== FLEET.join()) failures.push('wrong ship lengths');

    // home fleet independent stream: same seed -> same plan
    const home = placeFleet(mulberry32((seed ^ HOME_SALT) >>> 0))!;
    const planA = buildIncomingPlan(mulberry32((seed ^ HOME_SALT ^ 0x55aa) >>> 0), home, returnShotsFor(3));
    const planB = buildIncomingPlan(mulberry32((seed ^ HOME_SALT ^ 0x55aa) >>> 0), home, returnShotsFor(3));
    if (JSON.stringify(planA) !== JSON.stringify(planB)) failures.push(`plan nondeterministic seed=${seed}`);
    const pkeys = planA.map(([r, c]) => `${r},${c}`);
    if (new Set(pkeys).size !== pkeys.length) failures.push(`incoming plan repeats a shot seed=${seed}`);
  }
  const ships = [{ len: 4, x: 0, y: 0, horiz: true }];
  const grid = fleetGrid(ships);
  const hp = [0];
  const sunk = [false];
  if (applyShot(grid, hp, sunk, 5, 5).hit) failures.push('water registered as hit');
  if (applyShot(grid, hp, sunk, -1, 0).hit || applyShot(grid, hp, sunk, 0, 8).hit) failures.push('out-of-bounds registered as hit');
  if (!applyShot(grid, hp, sunk, 0, 0).hit) failures.push('first deck hit missed');
  applyShot(grid, hp, sunk, 0, 1);
  applyShot(grid, hp, sunk, 0, 2);
  const sSink = applyShot(grid, hp, sunk, 0, 3);
  if (!sSink.hit || sSink.sunkLen !== 4) failures.push('ship did not sink on final hit');
  if (applyShot(grid, hp, sunk, 0, 0).hit) failures.push('dead water counted again');

  // verdict ladder + documented pay band vs par
  for (let d = 1; d <= 5; d++) {
    const v = salvoVerdict({ hits: 9, uniqueHits: 9, sunkLens: [4, 3, 2], incomingHits: 0 }, d);
    const par = 100 * d + 40;
    if (v.correct !== true) failures.push('full sink must win');
    if (v.points < 0.8 * par || v.points > 1.4 * par) {
      failures.push(`sink pay off-band diff=${d} pay=${v.points} par=${par}`);
    }
  }
  const vPart = salvoVerdict({ hits: 7, uniqueHits: 6, sunkLens: [2], incomingHits: 1 }, 4);
  if (vPart.correct !== null || vPart.points < 0) failures.push('>=5-hit partial must be neutral');
  const vFail = salvoVerdict({ hits: 12, uniqueHits: 3, sunkLens: [], incomingHits: 0 }, 2);
  if (vFail.correct !== false || vFail.points !== -40 || vFail.hpDelta !== -12) failures.push('fail verdict wrong');

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;
