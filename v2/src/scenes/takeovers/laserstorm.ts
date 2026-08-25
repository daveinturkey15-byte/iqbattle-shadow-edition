/**
 * LASER-STORM — takeover scene (v2 port of modes/laserstorm.js, mechanic not code).
 *
 * 8 answer chips sit one per LANCE LANE. Lane order, period, telegraphs and
 * salvos are a pure function of ctx.seed (fixed draw order) and the round
 * clock: each strike GLOWS (telegraph 0.9 s→0.55 s by depth), FIRES for
 * 0.4 s, cools. Clicking inside a FIRING lane vaporizes the pick — instant
 * loss (correct:false) plus −10 hp. A winning click made ≤0.5 s before an
 * ADJACENT lane fires earns "+20 THREADED". Depth ≥5 adds a counter-rotating
 * second sweep; depth ≥9 rolls triple-lane salvos. Esc bails NEUTRAL.
 *
 * POINTS CURVE vs par(d) = 100*d + 40 (parFor imported from floorfall.ts):
 *   win   = round(par * min(1, 0.45 + 0.55 * leftFrac)) [+20 THREADED]
 *   vapor = 0 pts, hp −10 (correct:false)
 *   fail  = 0 pts ("WRONG LANE, SAFE MOMENT")
 *   timeo = neutral (correct:null), 0 pts, hp −5
 *
 * SOLVABILITY RAIL (asserted over 500 seeds in selfTest()): never more than
 * half the grid — 4 of 8 lanes — fires at once, so safe lanes always exist.
 *
 * Determinism: no Math.random, no Date.now — schedule derives from an own
 * mulberry32; verdicts derive from Pixi's shared ticker clock. Self-limits
 * to ctx.timerLen; StageResult settles exactly once via onceResolve;
 * container emptied on done.
 *
 * Fairness rails: every fire is telegraphed BEFORE it can hurt; motion gated
 * behind localStorage IQB_MOTION ('0' = off → static warning outlines, no
 * pulse); damage feedback localized (<200 ms flash); overlays escapable;
 * text >= 11 px.
 */
import { Container, Graphics, Rectangle, Sprite, Texture, Ticker } from 'pixi.js';
import type { Chip } from './redlight.ts';
import { CHIP_KINDS, chipPrims } from './redlight.ts';
import { mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';
import { tileCanvas } from '../../glyphs.ts';
import { panel, text, spriteFrom } from '../game.ts';
import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import { parFor } from './floorfall.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested below)                                      */
/* ------------------------------------------------------------------ */

const LS_SALT = 0x1a5e12;
const SETTLE_MS = 700;
export const LANES = 8;

export function paramsFor(depth: number): {
  period: number; tele: number; beam: number; leadIn: number;
  dual: boolean; salvo: boolean; salvoP: number; maxFiring: number;
} {
  const d = Math.max(1, Math.min(10, Math.floor(depth)));
  const u = (d - 1) / 9;
  return {
    period: Math.round(3200 - 1800 * u), // 3.2 s → 1.4 s
    tele: Math.round(900 - 350 * u),     // 0.9 s → 0.55 s
    beam: 400,
    leadIn: 1600,
    dual: d >= 5,
    salvo: d >= 9,
    salvoP: 0.22,
    maxFiring: LANES / 2,
  };
}

export interface Strike {
  lane: number;
  warnStart: number;
  fireStart: number;
  fireEnd: number;
}

function permute(rng: () => number): number[] {
  const a = [0, 1, 2, 3, 4, 5, 6, 7];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** peak lanes firing at any instant inside [t0,t1) */
export function firingCount(strikes: Strike[], t0: number, t1: number): number {
  let best = 0;
  for (let t = t0; t < t1; t += 20) {
    const c = strikes.filter((s) => s.fireStart <= t && t < s.fireEnd).length;
    if (c > best) best = c;
  }
  return best;
}

/**
 * Seeded schedule — FIXED DRAW ORDER (do not reorder):
 * permA, permB, then per wave: base lane, dual lane, salvo roll + extra lane,
 * gap jitter. A lane is skipped while busy/cooling and the 4-concurrent rail
 * is checked at generation AND asserted in selfTest().
 */
export function buildSchedule(seed: number, depth: number, timerLenSec: number): Strike[] {
  const p = paramsFor(depth);
  const rng = mulberry32((seed ^ LS_SALT) >>> 0);
  const permA = permute(rng);
  const permB = permute(rng);
  const budget = Math.max(5, timerLenSec) * 1000 - SETTLE_MS;
  const strikes: Strike[] = [];
  const addLane = (lane: number, start: number): void => {
    if (strikes.some((s) => s.lane === lane && start < s.fireEnd + 120)) return; // busy/cooldown
    if (firingCount(strikes, start, start + p.beam) >= p.maxFiring) return;      // solvability rail
    strikes.push({ lane, warnStart: start, fireStart: start + p.tele, fireEnd: start + p.tele + p.beam });
  };
  let ia = 0;
  let ib = 4 % LANES;
  let t = p.leadIn;
  const waveSpan = p.dual ? Math.round(p.period / 2) : 0;
  while (t + waveSpan + p.tele + p.beam < budget) {
    addLane(permA[ia % LANES], t);
    ia++;
    if (p.dual) {
      addLane(permB[ib % LANES], t + Math.round(p.period / 2));
      ib++;
    }
    if (p.salvo && rng() < p.salvoP) addLane(Math.floor(rng() * LANES), t + Math.floor(rng() * p.tele));
    t += Math.round(p.period * (0.85 + 0.3 * rng()));
  }
  strikes.sort((a, b) => a.fireStart - b.fireStart || a.lane - b.lane);
  return strikes;
}

export function laneFiringAt(strikes: Strike[], lane: number, t: number): boolean {
  return strikes.some((s) => s.lane === lane && t >= s.fireStart && t <= s.fireEnd);
}

/** winning click ≤500 ms before an ADJACENT lane (mod 8) fires */
export function isThreaded(strikes: Strike[], lane: number, t: number): boolean {
  return strikes.some((s) => {
    const diff = Math.abs(s.lane - lane);
    const adj = diff === 1 || diff === LANES - 1;
    return adj && s.fireStart - t > 0 && s.fireStart - t <= 500;
  });
}

function makeBoard(rng: () => number): { opts: Chip[]; answerIdx: number } {
  const key = (c: Chip): string => `${c.kind}:${c.n}`;
  const ans: Chip = { kind: Math.floor(rng() * CHIP_KINDS), n: 2 + Math.floor(rng() * 6) };
  const opts: Chip[] = [{ ...ans }];
  while (opts.length < LANES) {
    const c: Chip = { kind: Math.floor(rng() * CHIP_KINDS), n: 2 + Math.floor(rng() * 6) };
    if (!opts.some((o) => key(o) === key(c))) opts.push(c);
  }
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  return { opts, answerIdx: opts.findIndex((o) => key(o) === key(ans)) };
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

const TILE_W = 168;
const GAP = 18;
const ROW_Y = 640;
const BEAM_TOP = 210;

interface LaneUi {
  glow: Graphics;
  beamG: Graphics;
  x: number;
}

export function mountLaserStorm(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const MOTION = typeof localStorage === 'undefined' || localStorage.getItem('IQB_MOTION') !== '0';
  const rng = mulberry32((ctx.seed ^ 0xfeedface) >>> 0);
  const hue = T.boardHues[ctx.seed % T.boardHues.length];
  const settle = onceResolve(ctx.onDone);
  const p = paramsFor(ctx.depth);

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  panel(root, STAGE_W / 2 - 330, 46, 660, 130);
  text(root, 'LASER-STORM', STAGE_W / 2 - 76, 56, 24, T.gold, true);

  const board = makeBoard(rng);
  const targetChip = board.opts[board.answerIdx];
  const tgt = spriteFrom(tileCanvas(chipPrims(targetChip.kind, targetChip.n), hue, 96));
  tgt.x = STAGE_W / 2 - 48;
  tgt.y = 84;
  root.addChild(tgt);
  text(root, 'NEVER CLICK A LANE THAT IS FIRING', STAGE_W / 2 - 118, 190, 13, T.muted);

  const status = text(root, '', 40, 866, 16, T.ink, true);
  text(root, 'TELEGRAPH GLOWS PRECEDE EVERY SHOT · KEYS 1–8 ANSWER', STAGE_W / 2 - 200, 838, 12, T.muted);

  /* ---- lanes ---- */
  const rowW = LANES * TILE_W + (LANES - 1) * GAP;
  const ox = (STAGE_W - rowW) / 2;
  const lanes: LaneUi[] = [];
  board.opts.forEach((chip, i) => {
    const x = ox + i * (TILE_W + GAP);
    const glow = new Graphics();
    glow.rect(x, BEAM_TOP, TILE_W, ROW_Y - BEAM_TOP).fill({ color: hue, alpha: 0 });
    const beamG = new Graphics();
    beamG.rect(x, BEAM_TOP, TILE_W, ROW_Y - BEAM_TOP).fill({ color: 0xffffff, alpha: 0 });
    root.addChild(glow, beamG);
    lanes.push({ glow, beamG, x });

    const spr = spriteFrom(tileCanvas(chipPrims(chip.kind, chip.n), hue, TILE_W));
    spr.x = x;
    spr.y = ROW_Y;
    spr.eventMode = 'static';
    spr.cursor = 'pointer';
    spr.on('pointerdown', () => pick(i));
    root.addChild(spr);
    text(root, String(i + 1), x + 8, ROW_Y + TILE_W - 24, 13, T.muted);
  });

  /* ---- state ---- */
  const strikes = buildSchedule(ctx.seed, ctx.depth, ctx.timerLen);
  const budgetMs = Math.max(5, ctx.timerLen) * 1000 - SETTLE_MS;
  let clock = 0;
  let hpDelta = 0;
  let dead = false;

  function finish(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function pick(i: number): void {
    if (dead) return;
    if (laneFiringAt(strikes, i, clock)) {
      hpDelta -= 10;
      finish({ correct: false, points: 0, hpDelta, summary: 'VAPORIZED MID-THOUGHT' });
      return;
    }
    if (i === board.answerIdx) {
      const leftFrac = Math.max(0, Math.min(1, (budgetMs - clock) / budgetMs));
      const base = Math.round(parFor(ctx.depth) * Math.min(1, 0.45 + 0.55 * leftFrac));
      const threaded = isThreaded(strikes, i, clock);
      finish({
        correct: true,
        points: base + (threaded ? 20 : 0),
        hpDelta,
        summary: threaded ? 'THREADED THE STORM' : 'STORM RIDE COMPLETE',
      });
    } else {
      finish({ correct: false, points: 0, hpDelta, summary: 'WRONG LANE, SAFE MOMENT' });
    }
  }

  /* ---- input ---- */
  root.eventMode = 'static';
  root.hitArea = new Rectangle(0, 0, STAGE_W, STAGE_H);

  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      finish(escaped(hpDelta - 5, 'THE SKY KEPT FIRING'));
      return;
    }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= LANES) pick(n - 1);
  }
  window.addEventListener('keydown', onKey);

  /* ---- clock ---- */
  const onTick = (tk: Ticker): void => {
    if (dead) return;
    clock += tk.deltaMS;
    if (clock >= budgetMs) {
      finish(escaped(hpDelta - 5, 'THE SKY KEPT FIRING'));
      return;
    }

    // per-lane telegraph/fire paint
    for (let i = 0; i < LANES; i++) {
      const l = lanes[i];
      const strike = strikes.find(
        (s) => s.lane === i && ((clock >= s.warnStart && clock < s.fireStart) || (clock >= s.fireStart && clock <= s.fireEnd)),
      );
      if (!strike) {
        l.glow.renderable = false;
        l.beamG.renderable = false;
        continue;
      }
      if (clock >= strike.fireStart) {
        // firing: white-hot core, brief localized flash on the tile row
        l.glow.renderable = false;
        l.beamG.renderable = true;
        l.beamG.alpha = 0.55 + 0.25 * (1 - (clock - strike.fireStart) / p.beam);
      } else if (MOTION) {
        // telegraph pulse ~2 Hz, alpha capped low
        l.glow.renderable = true;
        l.glow.alpha = 0.16 + 0.12 * Math.sin((clock - strike.warnStart) / 80);
        l.beamG.renderable = false;
      } else {
        // reduced motion: static warning outline
        l.glow.renderable = true;
        l.glow.alpha = 0.18;
        l.beamG.renderable = false;
      }
    }
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  // params curve bounds
  const p1 = paramsFor(1);
  const p10 = paramsFor(10);
  if (p1.period !== 3200 || p10.period !== 1400) failures.push('period curve wrong');
  if (p1.tele !== 900 || p10.tele !== 550) failures.push('telegraph curve wrong');
  if (!p10.dual || !p10.salvo || p1.dual || p1.salvo) failures.push('dual/salvo gating wrong');

  // 500 seeds: determinism + fit + structure + concurrency rail
  for (let seed = 1; seed <= 500; seed++) {
    const depth = 1 + ((seed * 13) % 10);
    const timerLen = 15 + ((seed * 5) % 46);
    const a = buildSchedule(seed, depth, timerLen);
    const b = buildSchedule(seed, depth, timerLen);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      failures.push(`schedule nondeterministic seed=${seed}`);
      break;
    }
    const budget = Math.max(5, timerLen) * 1000 - SETTLE_MS;
    if (a.some((s) => s.lane < 0 || s.lane >= LANES || s.warnStart >= s.fireStart || s.fireStart >= s.fireEnd || s.fireEnd > budget)) {
      failures.push(`bad strike geometry seed=${seed}`);
      break;
    }
    if (firingCount(a, 0, budget) > LANES / 2) {
      failures.push(`concurrency rail broken seed=${seed} peak=${firingCount(a, 0, budget)}`);
      break;
    }
    if (failures.length > 0) break;
  }
  if (buildSchedule(99, 1, 30).length === 0) failures.push('no strikes scheduled for depth 1 / 30 s');

  // verdict helpers on synthetic strikes
  const syn: Strike[] = [
    { lane: 2, warnStart: 0, fireStart: 900, fireEnd: 1300 },
    { lane: 3, warnStart: 200, fireStart: 1100, fireEnd: 1500 }, // adjacent to 2
    { lane: 0, warnStart: 400, fireStart: 1700, fireEnd: 2100 },
  ];
  if (!laneFiringAt(syn, 2, 900) || !laneFiringAt(syn, 2, 1300) || laneFiringAt(syn, 2, 1301)) {
    failures.push('laneFiringAt boundaries wrong');
  }
  if (!isThreaded(syn, 2, 650) || !isThreaded(syn, 2, 600) || isThreaded(syn, 2, 599)) {
    failures.push('threaded window wrong');
  }
  if (isThreaded(syn, 5, 650)) failures.push('threaded must require adjacency');
  if (!isThreaded(syn, 7, 1200)) failures.push('threaded wrap-around adjacency wrong');
  if (isThreaded(syn, 2, 1500)) failures.push('threaded must be BEFORE the adjacent shot');
  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/scenes/takeovers/laserstorm.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/laserstorm.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] LASER-STORM OK' : `[selftest] LASER-STORM FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
