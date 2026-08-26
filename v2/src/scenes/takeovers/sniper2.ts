/**
 * SNIPER2 — OVERWATCH takeover scene (v2 port of modes/sniperstage.js,
 * mechanic not code).
 *
 * MECHANIC — dense far-field, your scope is the whole game:
 *   A field of tiny primitive-mark FIGURES (shoulders bar + diamond body +
 *   head-dot row; the HEAD-DOT COUNT is the figure's kind) renders at
 *   near-invisible contrast. The circular scope lens follows the mouse and
 *   reveals crisp marks inside its ring (masked bright layer). Click to
 *   CONFIRM a figure whose kind matches the posted quota; wrong-kind confirms
 *   sting (-5). HOLD SPACE for BREATH: wobble settles for up to 2 s per
 *   breath, then a 1.2 s forced exhale. Reach the confirmed-hit quota before
 *   the timer dies.
 *
 * DEPTH CURVES (pure, self-tested):
 *   quota(depth) = clamp(4 + floor(depth/2), 4, 8)
 *   density(depth) = min(48, 26 + 2*depth); wobble amplitude fixed but the
 *   answer-kind share of the field stays quota+3 so it is always winnable.
 *   per-confirm = ceil(par(diff)/(quota*1.1)) — quota-exact win ≈ 91% of par;
 *   timeout pays half per-confirm (never beats a win at the same progress)
 *
 * DETERMINISM: field layout + kinds drawn ONCE from mulberry32(seed ^ SALT)
 * in FIXED order (Fisher-Yates over a composed grid bag). No Math.random, no
 * Date.now — clock and wobble phase derive from accumulated ticker delta.
 * StageResult settles exactly once via onceResolve; container emptied on
 * done; self-limits to ctx.timerLen.
 *
 * FAIRNESS RAILS: IQB_MOTION=0 removes wobble entirely (identical field);
 * hit feedback is a localized <=200 ms ring flash; the demand ("CONFIRM THE
 * n-DOT SENTINELS") is always on screen; whiffs cost nothing; Esc bails
 * NEUTRAL; text >=11px.
 */
import { Container, Graphics, Sprite, Texture, Ticker } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';

import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import { tileCanvas } from '../../glyphs.ts';
import type { Prim } from '../../glyphs.ts';
import { panel, text, spriteFrom } from '../game.ts';
import { mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';
import { parFor } from './floorfall.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested)                                            */
/* ------------------------------------------------------------------ */

export const SALT = 0x0ff1ce5;
export const SCOPE_R = 95;
export const BREATH_MS = 2000;
export const EXHALE_MS = 1200;
export const WOBBLE_AMP = 14;

/** Logical field rect inside the stage. */
export const FIELD = { x: 150, y: 170, w: 1300, h: 560 };

export function quota(depth: number): number {
  return Math.min(8, Math.max(4, 4 + Math.floor(Math.max(1, depth) / 2)));
}

export function density(depth: number): number {
  return Math.min(48, 26 + Math.max(1, depth) * 2);
}

/** Shared difficulty ladder: min(5, max(1, 1 + floor(depth/6))). */
export function diffFor(depth: number): number {
  return Math.min(5, Math.max(1, 1 + Math.floor(Math.max(0, depth) / 6)));
}

/** Per-confirm pay derived from ladder par so a quota-exact run ≈ 91% of par. */
export function perConfirm(diff: number, quotaN: number): number {
  return Math.ceil(parFor(Math.min(5, Math.max(1, Math.floor(diff)))) / (quotaN * 1.1));
}

export interface Figure {
  x: number;
  y: number;
  dots: number; // kind marker: head-dot count 3..7
}

/**
 * Seeded far-field: exactly quota+3 figures of the answer kind, the rest
 * spread across other kinds; positions come from a shuffled grid so no two
 * figures ever overlap and every one stays inside FIELD.
 */
export function makeField(rng: () => number, depth: number): { figures: Figure[]; answerDots: number } {
  const answerDots = 3 + Math.floor(rng() * 5);
  const total = density(depth);
  const cols = 20;
  const rows = 8;
  const cells: Array<{ x: number; y: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({
        x: FIELD.x + 40 + c * ((FIELD.w - 80) / (cols - 1)),
        y: FIELD.y + 36 + r * ((FIELD.h - 72) / (rows - 1)),
      });
    }
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  const figures: Figure[] = [];
  let answerLeft = Math.min(quota(depth) + 3, total);
  for (let i = 0; i < total && i < cells.length; i++) {
    const cell = cells[i];
    let dots = 3 + Math.floor(rng() * 5);
    if (answerLeft > 0) dots = answerDots;
    if (dots === answerDots) answerLeft--;
    figures.push({ x: cell.x, y: cell.y, dots });
  }
  return { figures, answerDots };
}

/** Aim hit-test: centre distance within the confirm tolerance. */
export function hitTest(ax: number, ay: number, f: Figure, tol: number): boolean {
  return Math.hypot(ax - f.x, ay - f.y) <= tol;
}

/** Seeded wobble offsets at time t (px), bounded by amp. */
export function wobble(seed: number, tMs: number, amp: number): { dx: number; dy: number } {
  const p1 = (seed % 628) / 100;
  const p2 = ((seed >>> 7) % 628) / 100;
  return {
    dx: amp * 0.7 * Math.sin(tMs / 340 + p1) + amp * 0.3 * Math.sin(tMs / 131 + p2),
    dy: amp * 0.7 * Math.cos(tMs / 290 + p2) + amp * 0.3 * Math.sin(tMs / 173 + p1),
  };
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

const CONFIRM_TOL = SCOPE_R * 0.85;

/** Tiny primitive-mark figure: shoulders + diamond body + n-dot head row. */
function figurePrims(dots: number): Prim[] {
  const prims: Prim[] = [
    { k: 'line', x1: 38, y1: 52, x2: 62, y2: 52 },
    { k: 'line', x1: 44, y1: 66, x2: 56, y2: 66 },
    { k: 'diamond', x: 50, y: 58, s: 8 },
  ];
  for (let i = 0; i < dots; i++) {
    prims.push({ k: 'dot', x: 32 + (36 * i) / Math.max(1, dots - 1), y: 34, r: 4 });
  }
  return prims;
}

export function mountSniper2(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const MOTION = typeof localStorage === 'undefined' || localStorage.getItem('IQB_MOTION') !== '0';
  const rng = mulberry32((ctx.seed ^ SALT) >>> 0);
  const settle = onceResolve(ctx.onDone);
  const hue = T.boardHues[(ctx.seed >>> 8) % T.boardHues.length];

  const need = quota(ctx.depth);
  const { figures, answerDots } = makeField(rng, ctx.depth);
  const per = perConfirm(ctx.depth, need);

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  panel(root, FIELD.x - 20, FIELD.y - 30, FIELD.w + 40, FIELD.h + 50);

  const status = text(root, `OVERWATCH — CONFIRM ${need} × ${answerDots}-DOT SENTINELS`, 0, 60, 22, T.gold, true);
  status.anchor.set(0.5, 0);
  status.x = STAGE_W / 2;
  const hint = text(root, 'HOLD SPACE TO STEADY · CLICK TO CONFIRM', 0, 96, 13, T.muted);
  hint.anchor.set(0.5, 0);
  hint.x = STAGE_W / 2;

  /* ---- dim layer (whole field, barely visible) ---- */
  const dimLayer = new Container();
  root.addChild(dimLayer);
  for (const f of figures) {
    const sp = spriteFrom(tileCanvas(figurePrims(f.dots), hue, 64));
    sp.x = f.x - 32;
    sp.y = f.y - 32;
    sp.alpha = 0.13;
    dimLayer.addChild(sp);
  }

  /* ---- bright layer masked by the scope circle ---- */
  const crispTex = new Map<number, Texture>();
  for (let d = 3; d <= 7; d++) {
    crispTex.set(d, Texture.from(tileCanvas(figurePrims(d), hue, 64)));
  }
  const brightLayer = new Container();
  root.addChild(brightLayer);
  for (const f of figures) {
    const sp = new Sprite(crispTex.get(f.dots)!);
    sp.x = f.x - 32;
    sp.y = f.y - 32;
    brightLayer.addChild(sp);
  }
  const scopeMask = new Graphics();
  root.addChild(scopeMask);
  brightLayer.mask = scopeMask;

  /* ---- scope ring + crosshair ---- */
  const ring = new Graphics();
  root.addChild(ring);

  /* ---- state ---- */
  let mouseX = STAGE_W / 2;
  let mouseY = STAGE_H / 2;
  let elapsedMs = 0;
  let dead = false;
  let confirmed = 0;
  let wrongPings = 0;
  const done = new Set<Figure>();
  let breathPool = BREATH_MS;
  let exhaleMs = 0;
  let holdingBreath = false;
  let flashUntil = 0;
  let flashKindWrong = false;
  let flashX = mouseX;
  let flashY = mouseY;

  function settleNow(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function win(): void {
    settleNow({
      correct: true,
      points: confirmed * per - wrongPings * 5,
      hpDelta: 0,
      summary: `QUOTA MET · ${confirmed} CONFIRMED`,
    });
  }

  function onMove(e: FederatedPointerEvent): void {
    mouseX = e.globalX;
    mouseY = e.globalY;
  }

  function confirm(): void {
    if (dead) return;
    const wob = MOTION && !holdingBreath ? wobble(ctx.seed, elapsedMs, WOBBLE_AMP) : { dx: 0, dy: 0 };
    const ax = mouseX + wob.dx;
    const ay = mouseY + wob.dy;
    // nearest unconfirmed figure under the aim
    let best: Figure | null = null;
    let bestD = Infinity;
    for (const f of figures) {
      if (done.has(f)) continue;
      const d = Math.hypot(ax - f.x, ay - f.y);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    if (!best || bestD > CONFIRM_TOL) return; // whiff: no penalty, no progress
    flashX = best.x;
    flashY = best.y;
    if (best.dots === answerDots) {
      done.add(best);
      confirmed++;
      flashUntil = elapsedMs + 200;
      flashKindWrong = false;
      status.text = `${confirmed}/${need} CONFIRMED`;
      if (confirmed >= need) win();
    } else {
      wrongPings++;
      flashUntil = elapsedMs + 160;
      flashKindWrong = true;
    }
  }

  function onDown(): void {
    confirm();
  }
  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      settleNow(escaped(0, 'STOOD DOWN'));
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      if (!e.repeat && !holdingBreath && exhaleMs <= 0) holdingBreath = true;
    }
  }
  function onKeyUp(e: KeyboardEvent): void {
    if (e.key === ' ') holdingBreath = false;
  }
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  root.eventMode = 'static';
  root.on('pointermove', onMove);
  root.on('pointerdown', onDown);

  const onTick = (tk: Ticker): void => {
    if (dead) return;
    elapsedMs += tk.deltaMS;

    // breath economy
    if (holdingBreath) {
      breathPool -= tk.deltaMS;
      if (breathPool <= 0) {
        breathPool = BREATH_MS;
        holdingBreath = false;
        exhaleMs = EXHALE_MS;
      }
    } else if (exhaleMs > 0) {
      exhaleMs -= tk.deltaMS;
    }

    const wob = MOTION && !holdingBreath ? wobble(ctx.seed, elapsedMs, WOBBLE_AMP) : { dx: 0, dy: 0 };
    const sx = mouseX + wob.dx;
    const sy = mouseY + wob.dy;

    scopeMask.clear().circle(sx, sy, SCOPE_R).fill(0xffffff);
    ring.clear()
      .circle(sx, sy, SCOPE_R).stroke({ color: hue, width: 2, alpha: 0.9 })
      .moveTo(sx - 10, sy).lineTo(sx + 10, sy).stroke({ color: hue, width: 1, alpha: 0.7 })
      .moveTo(sx, sy - 10).lineTo(sx, sy + 10).stroke({ color: hue, width: 1, alpha: 0.7 });

    if (flashUntil > elapsedMs) {
      ring.circle(flashX, flashY, 30).stroke({ color: flashKindWrong ? T.bad : T.good, width: 3, alpha: 1 });
    }

    hint.text = holdingBreath
      ? `BREATH ${(Math.ceil(breathPool / 100) / 10).toFixed(1)}s`
      : exhaleMs > 0 ? `EXHALE ${(exhaleMs / 1000).toFixed(1)}s`
      : 'HOLD SPACE TO STEADY · CLICK TO CONFIRM';

    if (elapsedMs >= ctx.timerLen * 1000) {
      settleNow({
        correct: null,
        points: confirmed * Math.floor(per / 2),
        hpDelta: 0,
        summary: `TIME — ${confirmed}/${need} CONFIRMED`,
      });
    }
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
    root.off('pointermove', onMove);
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
    for (const depth of [1, 4, 9, 15]) {
      const a = makeField(mulberry32((seed ^ SALT) >>> 0), depth);
      const b = makeField(mulberry32((seed ^ SALT) >>> 0), depth);
      if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`makeField nondeterministic seed=${seed} depth=${depth}`);
      if (a.figures.length !== density(depth)) failures.push(`field density mismatch seed=${seed} depth=${depth}`);
      const answers = a.figures.filter((f) => f.dots === a.answerDots).length;
      if (answers < quota(depth)) failures.push(`not enough answer-kind figures seed=${seed} depth=${depth}`);
      if (a.answerDots < 3 || a.answerDots > 7) failures.push(`answer kind out of range seed=${seed}`);
      // no overlapping positions
      const seen = new Set(a.figures.map((f) => `${f.x},${f.y}`));
      if (seen.size !== a.figures.length) failures.push(`field positions collide seed=${seed}`);
      for (const f of a.figures) {
        if (f.x < FIELD.x || f.x > FIELD.x + FIELD.w || f.y < FIELD.y || f.y > FIELD.y + FIELD.h) {
          failures.push(`figure outside field seed=${seed}`);
          break;
        }
      }
    }
  }
  for (let depth = 1; depth <= 15; depth++) {
    if (quota(depth) < 4 || quota(depth) > 8) failures.push(`quota(${depth}) out of range`);
    if (density(depth) < 26 || density(depth) > 48) failures.push(`density(${depth}) out of range`);
  }
  if (quota(30) !== 8) failures.push('quota must cap at 8');
  if (!hitTest(0, 0, { x: 3, y: 4, dots: 3 }, 5)) failures.push('hitTest 3-4-5 should hit');
  if (hitTest(0, 0, { x: 10, y: 0, dots: 3 }, 5)) failures.push('hitTest far target should miss');
  // wobble bounded by amp and deterministic
  for (let t = 0; t < 60000; t += 137) {
    const w = wobble(12345, t, WOBBLE_AMP);
    if (Math.abs(w.dx) > WOBBLE_AMP + 1e-9 || Math.abs(w.dy) > WOBBLE_AMP + 1e-9) {
      failures.push('wobble exceeds amplitude bound');
      break;
    }
  }
  const w1 = wobble(42, 500, 10);
  const w2 = wobble(42, 500, 10);
  if (w1.dx !== w2.dx || w1.dy !== w2.dy) failures.push('wobble nondeterministic');
  // figure glyphs encode kind structurally
  for (let d = 3; d <= 7; d++) {
    const n = figurePrims(d).filter((p) => p.k === 'dot').length;
    if (n !== d) failures.push(`figurePrims(${d}) dot-count mismatch`);
  }
  // payout band: quota-exact win stays in 60-135% of ladder par at every window
  for (let d = 1; d <= 5; d++) {
    const depth = 6 * d - 5;
    if (diffFor(depth) !== d) failures.push(`diffFor ladder broken at window ${d}`);
    const q = quota(depth);
    const per = perConfirm(d, q);
    const frac = (q * per) / parFor(d);
    if (frac < 0.6 || frac > 1.35) failures.push(`quota-exact win out of band at diff ${d}: ${(frac * 100).toFixed(0)}%`);
    // timeout best case (quota-1 confirms at half pay) must stay under the win
    if ((q - 1) * Math.floor(per / 2) >= q * per - 4 * 5) failures.push(`timeout can meet win at diff ${d}`);
  }
  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;
