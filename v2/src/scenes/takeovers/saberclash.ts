/**
 * SABER CLASH — takeover scene (v2 port of modes/saberclash.js, mechanic not code).
 *
 * MECHANIC — three timed taps, one verb:
 *   A marker sweeps around a ring; a seeded SWEET ARC is marked on the ring.
 *   Tap (Space / click / touch) while the marker is inside the arc = HIT.
 *   Three rounds, one ring each; a miss OR a 4 s ring timeout burns the round.
 *   Verdict re-weights the round stake:
 *     3 hits -> correct true  (points 80 + 20*depth)
 *     2 hits -> correct null, partial (points 25 + 8*depth)
 *    <=1 hit -> correct false (points -40 / -12 hp, engine wrong-parity)
 *
 * DEPTH CURVES (pure, self-tested):
 *   sweet-arc full width 26% -> 14% of the ring (halfwidth 0.13 -> 0.07)
 *   marker speed x(1 + 0.12 * min(depth-1, 12)) laps/s, base 0.35 laps/s
 *   depth >= 6: every ring carries ONE telegraphed FEINT — the marker blinks
 *   for 350 ms before a direction REVERSAL at feintMs. Judgment math is
 *   identical with or without the feint.
 *
 * DETERMINISM: rings (arc centers, directions, feint times) are pure from
 * ctx.seed via an own mulberry32 in FIXED draw order. Tap times are quantized
 * to 60 ms buckets before judgment, so verdicts are reproducible from
 * (seed, buckets). No Math.random, no Date.now — clock is Pixi's ticker delta.
 *
 * FAIRNESS RAILS: feedback is a <=160 ms localized arc pulse (never fullscreen);
 * feint telegraph is a small marker blink; Esc bails NEUTRAL at any time; every
 * text >= 11 px; self-resolves well inside ctx.timerLen (3 rounds x 4 s cap).
 */
import { Container, Graphics, Sprite, Texture, Ticker } from 'pixi.js';
import type { Text } from 'pixi.js';

import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import { mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';
import { text } from '../game.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested)                                            */
/* ------------------------------------------------------------------ */

export const TAP_BUCKET_MS = 60;
export const ROUNDS = 3;
export const ROUND_CAP_MS = 4000;
/** telegraph window before the feint reversal (marker blinks) */
export const FEINT_TELEGRAPH_MS = 350;

const CLASH_SALT = 0x51ab3e7;

export interface Ring {
  /** sweet-arc center as fraction of the ring [0,1) */
  center: number;
  /** half width of the sweet arc as fraction of the ring */
  halfWidth: number;
  /** sweep speed in laps per second */
  speed: number;
  dir: 1 | -1;
  /** seeded reversal time (ms into the round); null = no feint this ring */
  feintMs: number | null;
}

/** Sweet-arc HALF width: 13% of the ring at depth 1 -> 7% floor by depth ~11. */
export function arcHalfWidth(depth: number): number {
  return Math.max(0.07, 0.13 - (Math.max(1, depth) - 1) * 0.006);
}

/** Marker speed in laps/second: 0.35 base, +12% per depth step (capped at +12 steps). */
export function speedFor(depth: number): number {
  return 0.35 * (1 + 0.12 * Math.min(Math.max(0, depth - 1), 12));
}

/**
 * Seeded plan — FIXED DRAW ORDER (do not reorder):
 *   per ring: center rng(), direction rng(), feint time rng() (depth>=6 only)
 */
export function buildPlan(seed: number, depth: number): Ring[] {
  const rng = mulberry32((seed ^ CLASH_SALT) >>> 0);
  const rings: Ring[] = [];
  for (let i = 0; i < ROUNDS; i++) {
    rings.push({
      center: rng(),
      halfWidth: arcHalfWidth(depth),
      speed: speedFor(depth),
      dir: rng() < 0.5 ? -1 : 1,
      feintMs: depth >= 6 ? 1000 + Math.floor(rng() * 500) : null,
    });
  }
  return rings;
}

/** Marker position on the ring at ms into the round, wrapped to [0,1). */
export function posAt(ring: Ring, ms: number): number {
  const rev = ring.feintMs !== null && ms >= ring.feintMs ? -1 : 1;
  const p = ring.center + ring.dir * rev * ring.speed * (ms / 1000);
  return ((p % 1) + 1) % 1;
}

/** Shortest distance between two ring fractions (wrap-aware). */
function angDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
}

/** Judge a tap made `ms` into the round (time quantized to TAP_BUCKET_MS). */
export function judgeTap(ring: Ring, ms: number): boolean {
  const bucket = Math.round(ms / TAP_BUCKET_MS) * TAP_BUCKET_MS;
  return angDist(posAt(ring, bucket), ring.center) <= ring.halfWidth;
}

export interface ClashVerdict {
  correct: boolean | null;
  points: number;
  hpDelta: number;
}

/** Verdict table: 3 hits win · 2 partial · <=1 fail. */
export function verdictFor(hits: number, depth: number): ClashVerdict {
  if (hits >= ROUNDS) return { correct: true, points: 80 + 20 * depth, hpDelta: 0 };
  if (hits === ROUNDS - 1) return { correct: null, points: 25 + 8 * depth, hpDelta: 0 };
  return { correct: false, points: -40, hpDelta: -12 };
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

interface LiveUi {
  status: Text;
  progress: Text;
  ringGfx: Graphics;
  pulse: Graphics;
  marker: Sprite;
}

export function mountSaberClash(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const hue = T.boardHues[ctx.seed % T.boardHues.length];
  const hueNum = parseInt(hue.slice(1), 16);
  const settle = onceResolve(ctx.onDone);
  const plan = buildPlan(ctx.seed, ctx.depth);

  /* ---- static chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  text(root, 'SABER CLASH', STAGE_W / 2 - 92, 96, 30, hue, true);
  text(root, 'STRIKE WHILE THE MARKER CROSSES THE ARC', STAGE_W / 2 - 190, 148, 15, T.muted);

  const cx = STAGE_W / 2;
  const cy = 440;
  const R = 230;

  const ui: LiveUi = {
    status: text(root, '', STAGE_W / 2 - 120, 700, 17, T.ink, true),
    progress: text(root, '', STAGE_W / 2 - 110, 736, 15, T.muted),
    ringGfx: new Graphics(),
    pulse: new Graphics(),
    marker: new Sprite(Texture.WHITE),
  };
  ui.marker.width = 26;
  ui.marker.height = 26;
  root.addChild(ui.ringGfx);
  root.addChild(ui.pulse);
  root.addChild(ui.marker);

  text(root, 'SPACE / CLICK TO STRIKE · ESC DECLINES', STAGE_W / 2 - 150, 780, 13, T.muted);

  /* ---- state machine ---- */
  let round = 0;
  let hits = 0;
  let roundMs = 0;
  let pulseMs = -10000;
  let dead = false;

  function refreshProgress(): void {
    ui.progress.text = `ROUND ${round + 1}/${ROUNDS} · STRIKES ${hits}/${ROUNDS}`;
  }

  function finish(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function settleVerdict(): void {
    const v = verdictFor(hits, ctx.depth);
    finish({
      ...v,
      summary: v.correct === true ? 'THREE CLEAN STRIKES' : `${hits}/${ROUNDS} STRIKES`,
    });
  }

  /** A missed tap or an unanswered ring burns the current round. */
  function burnRound(): void {
    if (dead) return;
    if (round + 1 >= ROUNDS) {
      settleVerdict();
      return;
    }
    round++;
    roundMs = 0;
    refreshProgress();
  }

  function tap(): void {
    if (dead) return;
    if (judgeTap(plan[round], roundMs)) {
      hits++;
      pulseMs = roundMs;
      ui.status.text = hits === 1 ? 'CLEAN STRIKE' : 'STRUCK AGAIN';
      refreshProgress();
      if (hits >= ROUNDS) settleVerdict();
    } else {
      ui.status.text = 'WIDE — ROUND BURNED';
      burnRound();
    }
  }

  /* ---- drawing ---- */
  function drawRing(): void {
    const ring = plan[round];
    const g = ui.ringGfx;
    g.clear();
    g.circle(cx, cy, R).stroke({ color: T.muted, width: 6, alpha: 0.25 });
    const a0 = (ring.center - ring.halfWidth) * Math.PI * 2 - Math.PI / 2;
    const a1 = (ring.center + ring.halfWidth) * Math.PI * 2 - Math.PI / 2;
    g.arc(cx, cy, R, a0, a1).stroke({ color: hueNum, width: 14, alpha: 1 });
  }

  /** <=160 ms localized success pulse on the sweet arc (flash-rail compliant). */
  function drawPulse(localMs: number): void {
    const dt = localMs - pulseMs;
    const g = ui.pulse;
    g.clear();
    if (dt < 0 || dt > 160) return;
    const ring = plan[Math.min(round, ROUNDS - 1)];
    const a0 = (ring.center - ring.halfWidth) * Math.PI * 2 - Math.PI / 2;
    const a1 = (ring.center + ring.halfWidth) * Math.PI * 2 - Math.PI / 2;
    g.arc(cx, cy, R, a0, a1).stroke({ color: T.good, width: 22, alpha: 1 - dt / 160 });
  }

  const onTick = (tk: Ticker): void => {
    if (dead) return;
    roundMs += tk.deltaMS;
    const ring = plan[round];

    // feint telegraph: blink the marker during the window before reversal
    const telegraph =
      ring.feintMs !== null && roundMs >= ring.feintMs - FEINT_TELEGRAPH_MS && roundMs < ring.feintMs;
    const blinkOff = telegraph && Math.floor(roundMs / 90) % 2 === 0;
    const ang = posAt(ring, roundMs) * Math.PI * 2 - Math.PI / 2;
    ui.marker.x = cx + Math.cos(ang) * R - 13;
    ui.marker.y = cy + Math.sin(ang) * R - 13;
    ui.marker.tint = blinkOff ? T.bad : 0xffffff;
    ui.marker.alpha = blinkOff ? 0.85 : 1;

    drawRing();
    drawPulse(roundMs);

    if (roundMs >= ROUND_CAP_MS) burnRound();
  };
  Ticker.shared.add(onTick);

  function onDown(): void {
    tap();
  }
  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      finish(escaped(0, 'DUEL DECLINED'));
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      tap();
    }
  }
  window.addEventListener('pointerdown', onDown);
  window.addEventListener('keydown', onKey);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('pointerdown', onDown);
    window.removeEventListener('keydown', onKey);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  refreshProgress();
  drawRing();
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // determinism + curve bounds across depths/seeds
  for (let seed = 1; seed <= 60; seed++) {
    for (const depth of [1, 3, 5, 6, 9, 14]) {
      const a = buildPlan(seed * 7919 + depth, depth);
      const b = buildPlan(seed * 7919 + depth, depth);
      if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`plan nondeterministic seed=${seed} depth=${depth}`);
      if (a.length !== ROUNDS) failures.push(`plan size seed=${seed} depth=${depth}`);
      for (const r of a) {
        if (r.halfWidth < 0.07 || r.halfWidth > 0.13) failures.push(`halfwidth out of band depth=${depth}`);
        if (r.speed <= 0) failures.push(`nonpositive speed depth=${depth}`);
        if ((r.feintMs === null) !== (depth < 6)) failures.push(`feint gating wrong depth=${depth}`);
        if (r.feintMs !== null && r.feintMs < FEINT_TELEGRAPH_MS + 400) failures.push(`feint before telegraph depth=${depth}`);
        for (const ms of [0, 300, 1000, 2500, 3999]) {
          const p = posAt(r, ms);
          if (p < 0 || p >= 1) failures.push(`posAt unwrapped depth=${depth}`);
        }
      }
    }
  }

  // speed scales up with depth, arc shrinks
  if (!(speedFor(4) > speedFor(1))) failures.push('speed should scale with depth');
  if (!(speedFor(30) === speedFor(13))) failures.push('speed cap missing');
  if (!(arcHalfWidth(11) === 0.07 && arcHalfWidth(1) === 0.13)) failures.push('arc width curve wrong');

  // tap quantization: same-bucket taps judge identically
  const ring = buildPlan(42, 1)[0];
  for (let ms = 200; ms < 2000; ms += 37) {
    const b0 = Math.round(ms / TAP_BUCKET_MS) * TAP_BUCKET_MS;
    for (const eps of [-20, 20]) {
      if (judgeTap(ring, ms) !== judgeTap(ring, b0 + eps)) {
        failures.push('tap judgment not bucket-stable');
        ms = 99999;
        break;
      }
    }
  }

  // verdict table bounds
  const expect: Array<[number, boolean | null]> = [
    [3, true],
    [2, null],
    [1, false],
    [0, false],
  ];
  for (const [h, corr] of expect) {
    for (const depth of [1, 8]) {
      const v = verdictFor(h, depth);
      if (v.correct !== corr) failures.push(`verdict(${h}) wrong`);
      if (v.points < -40 || v.points > 500) failures.push(`verdict(${h}) points out of band`);
    }
  }
  if (verdictFor(3, 5).points <= verdictFor(3, 1).points) failures.push('win pay should scale with depth');

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;
