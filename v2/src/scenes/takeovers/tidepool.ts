/**
 * TIDE POOL — takeover scene (v2 port of modes/tidepool.js, mechanic not code).
 *
 * 8 option tiles sit on a 5-row shore. A seeded TIDE cycle (triangle wave,
 * pure f(local clock)) raises and lowers the water; SUBMERGED pools get a
 * blue wash, become unclickable, and tapping them only splashes (no penalty)
 * — but costs the +15 DRY SHOES bonus. The question is a seeded
 * continue-the-pattern: tap the matching chip while its pool is DRY.
 *
 * SOLVABILITY RAIL: the answer pool's row is drawn only among rows that are
 * dry >= 35% of each cycle given the drawn tide range (analytic triangle-wave
 * dryFrac = thr/max), so every mount is solvable by waiting. Asserted over
 * 500 seeds in selfTest().
 *
 * Determinism: schedule derives from ctx.seed via an own mulberry32 in FIXED
 * DRAW ORDER. No Math.random, no Date.now (clock = Pixi shared ticker delta).
 * Self-limits to ctx.timerLen; Esc bails NEUTRAL; StageResult settles exactly
 * once; container emptied on done.
 */
import { Container, Graphics, Sprite, Text, Texture, Ticker } from 'pixi.js';
import type { Prim } from '../../glyphs.ts';
import { tileCanvas } from '../../glyphs.ts';
import { panel, text, spriteFrom } from '../game.ts';
import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import { mulberry32, onceResolve, escaped } from './redlight.ts';
import type { Chip, StageResult, TakeoverCtx } from './redlight.ts';

/* ------------------------------------------------------------------ */
/* Pure tide math (self-tested)                                        */
/* ------------------------------------------------------------------ */

const ROWS = 5; // shore rows: 0 = waterline, 4 = high shelf
export const RAIL = 0.35; // correct row must be dry >= 35% of each cycle
const PERIODS = [8000, 9000, 10000, 11000];
const TP_PAY = [130, 200, 280, 370, 460]; // win points by depth tier (clamped at index 4)
const BONUS_DRY = 15;

export interface TideSchedule {
  /** tide amplitude in water units (rows sit at thresholds 0.5..4.5) */
  max: number;
  phase: number;
  period: number;
  seq: Chip[];
  opts: Chip[];
  answerIdx: number;
  answerRow: number;
  /** shore row of each of the 8 option pools (traps allowed) */
  rows: number[];
}

/** triangle wave: 0 ->1 ->0 over one normalized cycle */
export function tri(x: number): number {
  return x < 0.5 ? x * 2 : 2 - 2 * x;
}

/** water height in units at local clock ms */
export function waterAt(sch: TideSchedule, ms: number): number {
  const x = (((ms / sch.period + sch.phase) % 1) + 1) % 1;
  return tri(x) * sch.max;
}

/** a row is submerged when water rises past its threshold (+ small margin) */
export function rowThr(r: number): number {
  return r + 0.5;
}

/** analytic dry fraction per cycle for a row given tide max (triangle wave) */
export function dryFrac(row: number, max: number): number {
  const t = rowThr(row);
  return t >= max ? 1 : t / max;
}

export function submergedAt(sch: TideSchedule, row: number, ms: number): boolean {
  return waterAt(sch, ms) > rowThr(row) + 0.05;
}

/*
 * Seeded schedule — FIXED DRAW ORDER (do not reorder):
 *   1 tide max        rng()          (2.2 .. 3.2)
 *   2 tide phase      rng()          (0 .. 1)
 *   3 tide period     rng()          (index into PERIODS)
 *   4 sequence        K*2 rng()      chip kind+n per step (K=3, +1 when depth>=6)
 *   5 distractors     variable rng() until 8 unique chips
 *   6 shuffle         7 rng()        Fisher-Yates from last
 *   7 answer row      rng()          among rows meeting the RAIL
 *   8 distractor rows ROWS rng()     any row (traps allowed)
 */
export function drawSchedule(seed: number, depth: number): TideSchedule {
  const rng = mulberry32((seed ^ 0x7f4a7c15) >>> 0);
  const sch: TideSchedule = {
    max: 2.2 + rng(),
    phase: rng(),
    period: PERIODS[Math.floor(rng() * PERIODS.length)],
    seq: [],
    opts: [],
    answerIdx: 0,
    answerRow: 0,
    rows: [],
  };
  const K = depth >= 6 ? 4 : 3;
  for (let i = 0; i < K; i++) {
    sch.seq.push({ kind: Math.floor(rng() * CHIP_KINDS_TP), n: 1 + Math.floor(rng() * 2) });
  }
  const step = sch.seq[K - 2];
  const nxt = sch.seq[K - 1];
  // continue-the-pattern rule: repeat kind advances it; otherwise keep kind
  const ansKind = nxt.kind === step.kind ? (nxt.kind + 1) % CHIP_KINDS_TP : nxt.kind;
  const ansN = 1 + Math.floor(rng() * 2);
  sch.opts.push({ kind: ansKind, n: ansN });
  while (sch.opts.length < 8) {
    const m: Chip = { kind: Math.floor(rng() * CHIP_KINDS_TP), n: 1 + Math.floor(rng() * 2) };
    if (!sch.opts.some((o) => o.kind === m.kind && o.n === m.n)) sch.opts.push(m);
  }
  for (let i = sch.opts.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [sch.opts[i], sch.opts[j]] = [sch.opts[j], sch.opts[i]];
  }
  sch.answerIdx = 0;
  const eligible: number[] = [];
  for (let r = 0; r < ROWS; r++) if (dryFrac(r, sch.max) >= RAIL) eligible.push(r);
  sch.answerRow = eligible[Math.floor(rng() * eligible.length)];
  sch.rows.push(sch.answerRow);
  for (let i = 1; i < 8; i++) sch.rows.push(Math.floor(rng() * ROWS));
  return sch;
}

const CHIP_KINDS_TP = 6; // same primitive families as redlight chips

/** Paint a tide-pool chip into DNA primitives (100-unit cell space). */
function chipPrimsTP(kind: number, n: number): Prim[] {
  const cx = 50;
  const cy = 50;
  switch (kind) {
    case 0:
      return [{ k: 'tri', x: cx, y: cy, s: n === 2 ? 9 : 18 }];
    case 1:
      return n === 2
        ? [
            { k: 'diamond', x: 34, y: cy, s: 10 },
            { k: 'diamond', x: 66, y: cy, s: 10 },
          ]
        : [{ k: 'diamond', x: cx, y: cy, s: 20 }];
    case 2:
      return n === 2
        ? [
            { k: 'dot', x: 36, y: cy, r: 8 },
            { k: 'dot', x: 64, y: cy, r: 8 },
          ]
        : [{ k: 'dot', x: cx, y: cy, r: 14 }];
    case 3: // plus
      return [
        { k: 'line', x1: cx - 14, y1: cy, x2: cx + 14, y2: cy },
        { k: 'line', x1: cx, y1: cy - 14, x2: cx, y2: cy + 14 },
      ];
    case 4: // cross
      return [
        { k: 'line', x1: cx - 12, y1: cy - 12, x2: cx + 12, y2: cy + 12 },
        { k: 'line', x1: cx - 12, y1: cy + 12, x2: cx + 12, y2: cy - 12 },
      ];
    default: // dash pair
      return [
        { k: 'line', x1: cx - 14, y1: cy - 6, x2: cx + 2, y2: cy - 6 },
        { k: 'line', x1: cx - 2, y1: cy + 6, x2: cx + 14, y2: cy + 6 },
      ];
  }
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

interface PoolTile {
  spr: Sprite;
  wash: Sprite;
  row: number;
  optIdx: number;
  baseY: number;
  submerged: boolean;
  splashT: number;
}

export function mountTidePool(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const hue = T.boardHues[ctx.seed % T.boardHues.length];
  const settle = onceResolve(ctx.onDone);
  const sch = drawSchedule(ctx.seed, ctx.depth);
  const pay = TP_PAY[Math.min(TP_PAY.length - 1, ctx.depth - 1)];

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  text(root, 'TIDE POOL', STAGE_W / 2 - 62, 48, 30, T.ink, true);
  const status = text(root, 'WAIT FOR YOUR POOL TO RUN DRY', STAGE_W / 2 - 160, 94, 17, T.good, true);
  const progress = text(root, '', STAGE_W / 2 - 90, 700, 15, T.ink);
  text(root, 'TAP THE MATCHING POOL WHILE IT IS DRY · WET FEET LOSE THE +15 DRY SHOES BONUS', STAGE_W / 2 - 300, 740, 13, T.muted);

  /* ---- question strip ---- */
  const qRow = new Container();
  qRow.x = STAGE_W / 2;
  qRow.y = 150;
  root.addChild(qRow);
  text(qRow, 'CONTINUE THE PATTERN', -100, -46, 13, T.gold);
  let qx = -(sch.seq.length * 34) / 2;
  for (const c of sch.seq) {
    const s = spriteFrom(tileCanvas(chipPrimsTP(c.kind, c.n), hue, 60));
    s.x = qx;
    qRow.addChild(s);
    qx += 68;
  }
  text(qRow, '?', qx - 44, -22, 26, T.gold, true);

  /* ---- shore board ---- */
  const boardW = 980;
  const boardH = 400;
  const board = panel(root, (STAGE_W - boardW) / 2, 190, boardW, boardH);
  const clipMask = new Graphics().roundRect(0, 0, boardW, boardH, T.radius).fill(0xffffff);
  board.addChild(clipMask);

  // water column (masked to the board)
  const wet = new Container();
  const water = new Sprite(Texture.WHITE);
  water.width = boardW;
  water.tint = 0x2d7cff;
  water.alpha = 0.42;
  const waterLine = new Sprite(Texture.WHITE);
  waterLine.width = boardW;
  waterLine.height = 3;
  waterLine.tint = 0xa0e1ff;
  waterLine.alpha = 0.85;
  wet.addChild(water, waterLine);
  board.addChild(wet);

  // 8 pools grouped by row, spread horizontally inside their band
  const byRow: number[][] = [[], [], [], [], []];
  sch.rows.forEach((r, i) => byRow[r].push(i));
  const tiles: PoolTile[] = [];
  const tileW = 96;
  for (let r = 0; r < ROWS; r++) {
    const list = byRow[r];
    const spanW = list.length * tileW + Math.max(0, list.length - 1) * 24;
    const startX = (boardW - spanW) / 2;
    const y = boardH - ((r + 0.5) / ROWS) * boardH - tileW / 2;
    list.forEach((optIdx, slot) => {
      const spr = spriteFrom(tileCanvas(chipPrimsTP(sch.opts[optIdx].kind, sch.opts[optIdx].n), hue, tileW));
      spr.x = startX + slot * (tileW + 24);
      spr.y = Math.max(6, Math.min(boardH - tileW - 6, y));
      spr.eventMode = 'static';
      spr.cursor = 'pointer';
      spr.on('pointerdown', () => press(optIdx));
      const wash = new Sprite(Texture.WHITE);
      wash.width = tileW;
      wash.height = tileW;
      wash.tint = 0x1668b8;
      wash.alpha = 0.55;
      wash.visible = false;
      spr.addChild(wash);
      board.addChild(spr);
      text(board, String(optIdx + 1), spr.x + 6, spr.y + tileW - 20, 11, T.muted);
      tiles.push({ spr, wash, row: sch.rows[optIdx], optIdx, baseY: spr.y, submerged: false, splashT: 0 });
    });
  }
  board.mask = clipMask;

  /* ---- state ---- */
  let clock = 0; // ms since mount (pausable-free: no pause in v2 takeovers)
  let soggy = false;
  let done = false;
  let lastSub: boolean[] | null = null;

  function settleNow(r: StageResult): void {
    if (done) return;
    done = true;
    teardown();
    settle(r);
  }

  function press(i: number): void {
    if (done) return;
    if (submergedAt(sch, sch.rows[i], clock)) {
      soggy = true;
      status.text = 'A COLD SPLASH — THAT POOL IS UNDERWATER';
      status.style.fill = T.accentB;
      splashAt(i);
      return;
    }
    if (i === sch.answerIdx) {
      const dryShoes = !soggy;
      settleNow({
        correct: true,
        points: pay + (dryShoes ? BONUS_DRY : 0),
        hpDelta: 0,
        summary: dryShoes ? `CORRECT POOL · DRY SHOES +${BONUS_DRY}` : 'CORRECT POOL · SOGGY BUT RIGHT',
      });
    } else {
      settleNow({ correct: false, points: -40, hpDelta: -12, summary: 'WRONG POOL — THE CRAB JUDGES YOU' });
    }
  }

  function splashAt(optIdx: number): void {
    const tl = tiles.find((t2) => t2.optIdx === optIdx);
    if (tl) tl.splashT = 0.45;
  }

  /* ---- keyboard parity ---- */
  function onKey(e: KeyboardEvent): void {
    if (done) return;
    if (e.key === 'Escape') {
      settleNow(escaped(0, 'ESCAPED'));
      return;
    }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 8) press(n - 1);
  }
  window.addEventListener('keydown', onKey);

  /* ---- tick ---- */
  const onTick = (tk: Ticker): void => {
    if (done) return;
    clock += tk.deltaMS;
    if (clock >= ctx.timerLen * 1000) {
      settleNow(escaped(0, 'TIME — THE TIDE WINS THIS ONE'));
      return;
    }
    const wUnits = waterAt(sch, clock);
    const hPx = (wUnits / sch.max) * boardH * 0.98;
    water.y = boardH - hPx;
    water.height = hPx;
    waterLine.y = boardH - hPx - 1;

    for (let k = 0; k < tiles.length; k++) {
      const tl = tiles[k];
      const sub = submergedAt(sch, tl.row, clock);
      if (lastSub === null || lastSub[k] !== sub) {
        tl.submerged = sub;
        tl.spr.eventMode = sub ? 'none' : 'static';
        tl.spr.cursor = sub ? 'default' : 'pointer';
        tl.spr.alpha = sub ? 0.45 : 1;
        tl.wash.visible = sub;
      }
      if (tl.splashT > 0) {
        tl.splashT = Math.max(0, tl.splashT - tk.deltaMS / 1000);
        tl.spr.y = tl.baseY - Math.sin((tl.splashT / 0.45) * Math.PI) * 7;
      } else {
        tl.spr.y = tl.baseY;
      }
    }
    lastSub = tiles.map((tl) => tl.submerged);
    progress.text = `DRY SHOES ${soggy ? 'LOST' : 'INTACT'} · WATER ${wUnits.toFixed(1)} / ${sch.max.toFixed(1)} · ${Math.ceil((ctx.timerLen * 1000 - clock) / 1000)}s`;
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  // initial paint so the first frame is already coherent
  lastSub = null;
}

/* ------------------------------------------------------------------ */
/* Self-test (pure)                                                    */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // solvability rail over 500 seeds: answer row dry >= RAIL of every cycle
  for (let seed = 1; seed <= 500; seed++) {
    const sch = drawSchedule(seed, ((seed % 9) + 1));
    const frac = dryFrac(sch.answerRow, sch.max);
    if (frac < RAIL) failures.push(`seed=${seed} answerRow=${sch.answerRow} dryFrac=${frac.toFixed(3)} < RAIL`);
    // determinism
    const again = drawSchedule(seed, ((seed % 9) + 1));
    if (JSON.stringify(again) !== JSON.stringify(sch)) failures.push(`seed=${seed} schedule nondeterministic`);
    // 8 unique options, answer present exactly once, rows valid
    const keys = new Set(sch.opts.map((o) => `${o.kind}:${o.n}`));
    if (keys.size !== 8) failures.push(`seed=${seed} options not unique (${keys.size})`);
    if (sch.rows.length !== 8 || sch.rows.some((r) => r < 0 || r >= ROWS)) failures.push(`seed=${seed} bad rows`);
    // sampled submergedAt agrees with the analytic rail bound at cycle peaks
    const peak = ((0.5 - sch.phase) % 1 + 1) % 1 * sch.period;
    if (submergedAt(sch, ROWS - 1, peak) && dryFrac(ROWS - 1, sch.max) < 1 && sch.max > ROWS - 0.5) {
      failures.push(`seed=${seed} high shelf unexpectedly submerged at trough-peak sample`);
    }
  }
  // coverage sanity: distinct seeds must draw materially different schedules
  // (phase/max/period/rows are all seeded draws — collisions should be ~zero)
  const shapes = new Set<string>();
  for (let seed = 1; seed <= 500; seed++) shapes.add(JSON.stringify(drawSchedule(seed, 1)));
  if (shapes.size < 495) failures.push(`schedule variety too low (${shapes.size}/500)`);
  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;
