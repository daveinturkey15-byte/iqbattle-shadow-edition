/**
 * GAUNTLET2 — FOUR RIDERS takeover scene (v2 port of modes/gauntlet.js,
 * mechanic not code; no cross-round state carry in v2 — the director owns it).
 *
 * MECHANIC — four micro-trials in fixed order (the ritual IS the identity):
 *   1 CONQUEST  pick   : three crowns slide in; claim the one bearing the
 *                        demanded mark count (seeded positions).
 *   2 WAR       mash   : press SPACE / tap until the war drum fills to the
 *                        depth-scaled quota inside the trial budget.
 *   3 FAMINE    pick   : four portion glyphs; take the SMALLEST share. One
 *                        shot — greed (any bigger portion) fails the rider.
 *   4 DEATH     still  : be still — touch NOTHING for 3 s. Any key or pointer
 *                        resets the vigil. The dead do not chase input.
 * Each trial gets timerLen/4 (minus settle margins) so the stage always
 * completes inside ctx.timerLen. Verdict aggregates over pass counts.
 *   passes >= 3 -> correct true · points = passes*30 - fails*10
 *   hpDelta = -fails*3 · summary lists per-rider marks (C/W/F/D).
 *
 * DETERMINISM: one mulberry32(seed ^ SALT) draws crown counts/positions and
 * famine portions in FIXED order at mount. No Math.random, no Date.now —
 * clock is Pixi shared ticker delta. StageResult settles exactly once via
 * onceResolve; container emptied on done.
 *
 * FAIRNESS RAILS: one hue (boardHues wheel); every trial's demand is stated
 * on screen before input matters; DNA primitives only — structure carries the
 * difference, never colour; Esc bails NEUTRAL mid-ritual; text >=11px.
 */
import { Container, Graphics, Sprite, Texture, Ticker } from 'pixi.js';
import type { Text } from 'pixi.js';

import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import type { Prim } from '../../glyphs.ts';
import { tileCanvas } from '../../glyphs.ts';
import { panel, text, spriteFrom } from '../game.ts';
import { mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested)                                            */
/* ------------------------------------------------------------------ */

export const SALT = 0x4f1d5e9;
export const RIDER_NAMES = ['CONQUEST', 'WAR', 'FAMINE', 'DEATH'] as const;
export const DEATH_VIGIL_MS = 3000;

/** War drum quota: presses needed, depth-scaled but budget-feasible (~7/s). */
export function warQuota(depth: number): number {
  return Math.min(40, 12 + Math.max(1, depth) * 3);
}
/** Per-trial budget: even split of the round timer minus a settle margin,
 *  capped at the design's ~8 s per rider so long timers stay snappy. */
export function trialBudgetSec(timerLenSec: number): number {
  return Math.max(2, Math.min(8, Math.floor((Math.max(6, timerLenSec) - 2) / 4)));
}
/** Crown demand: distinct mark counts, answer index seeded. */
export interface Crowns {
  counts: number[]; // exactly three DISTINCT counts
  demanded: number; // == counts[answer]
  answer: number;
}

export function makeCrowns(rng: () => number, depth: number): Crowns {
  void depth;
  const base = 3 + Math.floor(rng() * 5); // 3..7
  const demanded = base;
  const others = [base - 2, base + 1, base + 2, base + 3].filter((n) => n >= 1 && n !== base);
  const a = Math.floor(rng() * 3);
  const counts: number[] = [];
  let oi = 0;
  for (let i = 0; i < 3; i++) {
    if (i === a) counts.push(demanded);
    else counts.push(others[oi++] ?? base + 4);
  }
  return { counts, demanded, answer: a };
}

/** Famine shares: four distinct counts; smallest is the only honest take. */
export function makePortions(rng: () => number): { counts: number[]; answer: number } {
  const lo = 2 + Math.floor(rng() * 3);
  const counts = [lo, lo + 2 + Math.floor(rng() * 3), lo + 5 + Math.floor(rng() * 3), lo + 8 + Math.floor(rng() * 3)];
  // seeded shuffle of positions (Fisher-Yates, fixed draw order)
  for (let i = counts.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [counts[i], counts[j]] = [counts[j], counts[i]];
  }
  return { counts, answer: counts.indexOf(lo) };
}

export interface GauntletVerdict {
  correct: boolean;
  points: number;
  hpDelta: number;
  summary: string;
}

export function aggregate(passes: boolean[]): GauntletVerdict {
  const passCount = passes.filter(Boolean).length;
  const fails = passes.length - passCount;
  const marks = ['C', 'W', 'F', 'D']
    .map((m, i) => `${m}${passes[i] ? '✓' : '✗'}`)
    .join(' ');
  return {
    correct: passCount >= 3,
    points: passCount * 30 - fails * 10,
    hpDelta: -fails * 3,
    summary: passCount === 4 ? `ALL FOUR RIDE · ${marks}` : `THE RIDERS JUDGE · ${marks}`,
  };
}

/** Crown glyph: base bar + n triangles + n dots — count is THE signal. */
export function crownPrims(n: number): Prim[] {
  const prims: Prim[] = [
    { k: 'line', x1: 14, y1: 82, x2: 86, y2: 82 },
  ];
  for (let i = 0; i < n; i++) {
    const x = 20 + (60 * i) / Math.max(1, n - 1 || 1);
    prims.push({ k: 'tri', x, y: 46, s: 13 });
    prims.push({ k: 'dot', x, y: 66, r: 4 });
  }
  return prims;
}

/** Portion glyph: a diamond pile of n dots (2 rows max). */
export function portionPrims(n: number): Prim[] {
  const prims: Prim[] = [];
  for (let i = 0; i < n; i++) {
    const row = i < 4 ? 0 : 1;
    const col = i % 4;
    prims.push({ k: 'dot', x: 32 + col * 12, y: 38 + row * 16, r: 5 });
  }
  prims.push({ k: 'diamond', x: 50, y: 78, s: 8 });
  return prims;
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

type Phase = 'intro' | 'trial' | 'wipe' | 'done';

interface TrialState {
  kind: typeof RIDER_NAMES[number];
  passed: boolean;
}

export function mountGauntlet2(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const rng = mulberry32((ctx.seed ^ SALT) >>> 0);
  const settle = onceResolve(ctx.onDone);
  const hue = T.boardHues[(ctx.seed >>> 2) % T.boardHues.length];
  const budgetMs = trialBudgetSec(ctx.timerLen) * 1000;
  const crowns = makeCrowns(rng, ctx.depth);
  const portions = makePortions(rng);
  const quota = warQuota(ctx.depth);

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  const title = text(root, 'FOUR RIDERS', 0, 44, 30, hue, true);
  title.anchor.set(0.5, 0);
  title.x = STAGE_W / 2;
  const status = text(root, 'THE RIDERS SUMMON YOU', 0, 92, 17, T.gold, true);
  status.anchor.set(0.5, 0);
  status.x = STAGE_W / 2;
  const hint = text(root, '', 0, 806, 13, T.muted);
  hint.anchor.set(0.5, 0);
  hint.x = STAGE_W / 2;

  const trialPanel = panel(root, STAGE_W / 2 - 420, 170, 840, 480);
  void trialPanel;

  /* ---- shared trial UI ---- */
  const tiles = new Container();
  root.addChild(tiles);
  const drum = new Graphics();
  root.addChild(drum);

  /* ---- state ---- */
  let phase: Phase = 'intro';
  let trialIdx = -1;
  const passes: boolean[] = [];
  let phaseMs = 0;
  let elapsedMs = 0;
  let dead = false;
  let mashCount = 0;
  let flinchReset = false;
  let answeredThisTrial = false;
  const results: TrialState[] = [];

  function clearTiles(): void {
    tiles.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  function settleNow(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function finish(): void {
    const v = aggregate(passes);
    settleNow({ ...v });
  }

  function startTrial(i: number): void {
    trialIdx = i;
    phase = 'trial';
    phaseMs = 0;
    answeredThisTrial = false;
    mashCount = 0;
    flinchReset = false;
    clearTiles();
    const name = RIDER_NAMES[i];
    status.text = `${name}`;
    if (name === 'CONQUEST') {
      status.text = `CONQUEST — CLAIM THE CROWN OF ${crowns.demanded} MARKS`;
      hint.text = 'CLICK A CROWN';
      for (let c = 0; c < 3; c++) {
        const cv = tileCanvas(crownPrims(crowns.counts[c]), hue, 150);
        const sp = spriteFrom(cv);
        sp.x = STAGE_W / 2 - 260 + c * 200;
        sp.y = 320;
        sp.eventMode = 'static';
        sp.cursor = 'pointer';
        const idx = c;
        sp.on('pointerdown', () => pickCrown(idx));
        tiles.addChild(sp);
      }
    } else if (name === 'WAR') {
      status.text = `WAR — SOUND THE DRUM ×${quota}`;
      hint.text = 'MASH SPACE / TAP';
    } else if (name === 'FAMINE') {
      status.text = 'FAMINE — TAKE THE SMALLEST SHARE';
      hint.text = 'CLICK A PORTION';
      for (let c = 0; c < 4; c++) {
        const cv = tileCanvas(portionPrims(portions.counts[c]), hue, 130);
        const sp = spriteFrom(cv);
        sp.x = STAGE_W / 2 - 290 + c * 195;
        sp.y = 340;
        sp.eventMode = 'static';
        sp.cursor = 'pointer';
        const idx = c;
        sp.on('pointerdown', () => pickPortion(idx));
        tiles.addChild(sp);
      }
    } else {
      status.text = 'DEATH — BE STILL FOR 3 SECONDS';
      hint.text = 'TOUCH NOTHING. ANY INPUT RESETS THE VIGIL.';
    }
  }

  function endTrial(passed: boolean): void {
    if (answeredThisTrial) return;
    answeredThisTrial = true;
    passes.push(passed);
    results.push({ kind: RIDER_NAMES[trialIdx], passed });
    phase = 'wipe';
    phaseMs = 0;
    status.text = `${RIDER_NAMES[trialIdx]} · ${passed ? 'PASSES' : 'DENIES YOU'}`;
    clearTiles();
    drum.clear();
  }

  function pickCrown(idx: number): void {
    if (phase !== 'trial' || answeredThisTrial || RIDER_NAMES[trialIdx] !== 'CONQUEST') return;
    endTrial(idx === crowns.answer);
  }

  function pickPortion(idx: number): void {
    if (phase !== 'trial' || answeredThisTrial || RIDER_NAMES[trialIdx] !== 'FAMINE') return;
    // greed check: anything but the strict minimum starves you too
    endTrial(idx === portions.answer);
  }

  function mash(): void {
    if (phase !== 'trial' || answeredThisTrial || RIDER_NAMES[trialIdx] !== 'WAR') return;
    mashCount++;
    if (mashCount >= quota) endTrial(true);
  }

  function anyInputResetsVigil(): void {
    if (phase !== 'trial' || answeredThisTrial || RIDER_NAMES[trialIdx] !== 'DEATH') return;
    phaseMs = 0;
    flinchReset = true;
  }

  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      settleNow(escaped(0, 'YOU FLED THE TEMPLE'));
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      if (!e.repeat) mash();
      anyInputResetsVigil();
    } else {
      anyInputResetsVigil();
    }
  }

  function onDown(): void {
    if (dead) return;
    mash(); // pointer mashes War; picks are handled by their own sprites
    anyInputResetsVigil();
  }

  window.addEventListener('keydown', onKey);
  root.eventMode = 'static';
  root.on('pointerdown', onDown);

  function drawDrum(): void {
    drum.clear();
    if (phase !== 'trial' || RIDER_NAMES[trialIdx] !== 'WAR') return;
    const w = 520;
    const x = STAGE_W / 2 - w / 2;
    const y = 600;
    drum.roundRect(x, y, w, 26, 12).fill(T.tile);
    drum.roundRect(x, y, Math.min(w, (w * mashCount) / quota), 26, 12).fill(hue);
  }

  const onTick = (tk: Ticker): void => {
    if (dead) return;
    const dt = tk.deltaMS;
    elapsedMs += dt;
    if (elapsedMs >= ctx.timerLen * 1000) {
      // hard stop: score what stands
      while (passes.length < 4) passes.push(false);
      finish();
      return;
    }
    if (phase === 'intro') {
      phaseMs += dt;
      if (phaseMs >= 900) startTrial(0);
      return;
    }
    if (phase === 'wipe') {
      phaseMs += dt;
      if (phaseMs >= 700) {
        if (passes.length >= 4) finish();
        else startTrial(passes.length);
      }
      return;
    }
    if (phase === 'trial') {
      phaseMs += dt;
      const name = RIDER_NAMES[trialIdx];
      if (name === 'WAR') drawDrum();
      if (name === 'DEATH') {
        const left = Math.ceil((DEATH_VIGIL_MS - phaseMs) / 1000);
        if (flinchReset) status.text = `DEATH — FLINCH. STILL FOR ${left}s`;
        else status.text = `DEATH — BE STILL FOR ${left}s`;
        if (phaseMs >= DEATH_VIGIL_MS) endTrial(true);
      }
      // DEATH's 3 s vigil is the rider's identity — never cut shorter
      const limit = name === 'DEATH' ? Math.max(budgetMs, DEATH_VIGIL_MS + 400) : budgetMs;
      if (phaseMs >= limit) endTrial(name === 'WAR' && mashCount >= quota);
    }
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.off('pointerdown', onDown);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }
}

/* ------------------------------------------------------------------ */
/* Self-test (pure)                                                    */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  for (let seed = 1; seed <= 400; seed++) {
    const mk = () => makeCrowns(mulberry32((seed ^ SALT) >>> 0), 3);
    const a = mk();
    const b = mk();
    if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`makeCrowns nondeterministic seed=${seed}`);
    if (a.counts.length !== 3) failures.push(`crowns wrong arity seed=${seed}`);
    if (new Set(a.counts).size !== 3) failures.push(`crown counts not distinct seed=${seed}: ${a.counts}`);
    if (a.counts[a.answer] !== a.demanded) failures.push(`blessed crown mismatch seed=${seed}`);
    const p1 = makePortions(mulberry32((seed ^ SALT) >>> 7));
    const p2 = makePortions(mulberry32((seed ^ SALT) >>> 7));
    if (JSON.stringify(p1) !== JSON.stringify(p2)) failures.push(`makePortions nondeterministic seed=${seed}`);
    if (new Set(p1.counts).size !== 4) failures.push(`portions not distinct seed=${seed}`);
    const min = Math.min(...p1.counts);
    if (p1.counts[p1.answer] !== min) failures.push(`famine answer not smallest seed=${seed}`);
  }
  for (let depth = 1; depth <= 15; depth++) {
    if (warQuota(depth) < 12) failures.push(`warQuota(${depth}) below floor`);
    if (warQuota(depth) > 45) failures.push(`warQuota(${depth}) above budget ceiling`);
  }
  for (const tl of [10, 12, 20, 30, 45]) {
    if (trialBudgetSec(tl) * 4 > Math.max(6, tl) - 2) failures.push(`trial budgets overrun timerLen=${tl}`);
    if (trialBudgetSec(tl) < 2) failures.push(`trial budget below floor at timerLen=${tl}`);
  }
  // aggregation contract
  const all = aggregate([true, true, true, true]);
  if (!all.correct || all.points !== 120 || all.hpDelta !== 0) failures.push('aggregate all-pass wrong');
  const three = aggregate([true, false, true, true]);
  if (!three.correct || three.points !== 80 || three.hpDelta !== -3) failures.push('aggregate 3-pass wrong');
  const two = aggregate([true, false, true, false]);
  if (two.correct || two.points !== 40 || two.hpDelta !== -6) failures.push('aggregate 2-pass must fail');
  const none = aggregate([false, false, false, false]);
  if (none.correct || none.points !== -40 || none.summary.indexOf('D✗') < 0) failures.push('aggregate zero-pass wrong');
  // glyph counts visible: crowns differ structurally by triangle count
  const c3 = crownPrims(3).filter((p) => p.k === 'tri').length;
  const c6 = crownPrims(6).filter((p) => p.k === 'tri').length;
  if (c3 !== 3 || c6 !== 6) failures.push('crown tri-count does not match demand');
  const q5 = portionPrims(5).filter((p) => p.k === 'dot').length;
  if (q5 !== 5) failures.push('portion dot-count does not match share');
  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;
