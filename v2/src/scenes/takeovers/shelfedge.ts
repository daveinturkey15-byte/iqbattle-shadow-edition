/**
 * SHELF EDGE — takeover scene. The BAD half of the owner's water pairing
 * (dolphins good, sharks bad). No dolphin lives here; another stage owns that.
 *
 * ================= WIRING REQUEST (Main-owned files, untouched by me) =======
 *   main.ts      TAKEOVERS   += mountShelfEdge
 *                TAKEOVER_NAMES += 'SHELF EDGE'
 *   onboard.ts   TAKEOVER_STAGE_IDS += 'shelf-edge'
 *                CARDS['shelf-edge'] = {
 *                  stageId: 'shelf-edge',
 *                  title:   'SHELF EDGE',
 *                  goal:    'SOMETHING CIRCLES AT THE EDGE OF SIGHT AND CLOSES WHILE YOU DITHER. COMMIT: A FAST WRONG GUESS COSTS LESS THAN A SLOW RIGHT ONE.',
 *                  controls:'CLICK / TAP · KEYS 1–4 · ESC BAILS NEUTRAL',
 *                }
 * ===========================================================================
 *
 * THE ONE IDEA: hesitation is the enemy, not error. You are over the shelf
 * edge in open water. A grey shape circles at the limit of visibility. Its
 * DISTANCE drains while a call is unanswered, and the drain ACCELERATES the
 * longer you sit on it (integral of a ramping rate). A wrong pick costs a
 * flat, comparatively cheap wrongCost(depth) and rolls a fresh call with a
 * fresh clock. A committed correct pick PUSHES the shape back out.
 *
 * The teaching is a hard, asserted rail at every depth 1..20:
 *     ditherCost(d, COMMIT_MS) <  wrongCost(d) <  ditherCost(d, DITHER_MS)
 * i.e. answering fast and wrong beats answering slow and right. The round
 * teaches commitment; it never teaches caution.
 *
 * Ends: quota of calls answered -> WIN · distance hits 0 -> CAUGHT (fail)
 *       play budget elapses -> neutral partial · Esc -> escaped(0, ...)
 *
 * POINTS CURVE vs par(d) = 100*d + 40 (parFor imported from floorfall.ts):
 *   win     = round(par * (0.62 + 0.38 * distFrac)) + COMMIT_PTS * commits
 *   caught  = 0 pts, hpDelta - 14
 *   timeout = neutral, PARTIAL_PTS * callsDone (asserted below every win)
 *   Esc     = escaped(0, ...)
 *
 * Determinism: the circler's opening bearing and angular velocity, and every
 * call's target + distractors, are pure functions of ctx.seed through an own
 * mulberry32 in FIXED DRAW ORDER. Zero Math.random, zero Date.now — the clock
 * is Pixi's shared ticker delta only. Self-limits to ctx.timerLen; the drain
 * is a second, independent guarantee that the round ends.
 *
 * Fairness rails: the shape is a SILHOUETTE (dorsal fin over a body line),
 * never a colour cue; one hue per board from T.boardHues; threshold feedback
 * is a localized ring pulse <= 180 ms centred on you, never a fullscreen
 * strobe; all text >= 11 px; keyboard parity (1–4) with the pointer.
 * IQB_MOTION=0 / prefers-reduced-motion: bearing advances in discrete 500 ms
 * steps and the visibility ring snaps to 10 % distance rungs — the drain,
 * the costs and the scoring are byte-identical.
 */
import { Container, Graphics, Sprite, Texture, Ticker } from 'pixi.js';
import type { Chip, StageResult, TakeoverCtx } from './redlight.ts';
import { CHIP_KINDS, chipPrims, GOAL_MS, mulberry32, onceResolve, escaped } from './redlight.ts';
import type { Prim } from '../../glyphs.ts';
import { cellCanvas, tileCanvas } from '../../glyphs.ts';
import { panel, text, spriteFrom } from '../game.ts';
import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import { parFor } from './floorfall.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested below — no Pixi, no DOM, no timers)         */
/* ------------------------------------------------------------------ */

const SE_SALT = 0x5e17ed6e;
const SETTLE_MS = 700;

/** Distance the shape starts at, in abstract "visibility" units. */
export const START_DIST = 100;
/** The drain rate doubles every RAMP_MS of dithering on one call. */
export const RAMP_MS = 2200;
/** Answer inside this and it counts as a COMMIT (scores a bonus). */
export const COMMIT_MS = 1200;
/** Reference dithering time used by the teaching rail. */
export const DITHER_MS = 2600;
export const PUSH_MAX = 22;
export const PUSH_MIN = 6;
export const PUSH_FLOOR_MS = 3000;
export const COMMIT_PTS = 8;
export const PARTIAL_PTS = 20;
/** hp cost of one wrong pick (the shape is closer, you are not hurt yet). */
export const WRONG_HP = 4;
export const CAUGHT_HP = 14;

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Depth pressure saturates at depth 7 so deep runs stay survivable. */
export function depthRung(depth: number): number {
  return Math.min(Math.max(1, Math.floor(depth)) - 1, 6);
}

/** Distance units the shape closes per second at the START of a call. */
export function drainBase(depth: number): number {
  return 5.5 + 0.9 * depthRung(depth);
}

/**
 * Distance closed by dithering `ms` on one call — the integral of the
 * accelerating rate drainBase * (1 + t / RAMP_MS). Pure, monotone, convex.
 */
export function ditherCost(depth: number, ms: number): number {
  const t = Math.max(0, ms);
  return drainBase(depth) * (t / 1000 + (t * t) / (2000 * RAMP_MS));
}

/** Flat distance price of a wrong pick. Cheap on purpose — see the rail. */
export function wrongCost(depth: number): number {
  return 12 + 1.4 * depthRung(depth);
}

/** Distance a correct pick pushes the shape back out — faster = further. */
export function pushFor(ms: number): number {
  const k = clamp(Math.max(0, ms) / PUSH_FLOOR_MS, 0, 1);
  return PUSH_MAX - (PUSH_MAX - PUSH_MIN) * k;
}

/** Calls you must answer to survive the round: 4 -> 7 by depth. */
export function callQuota(depth: number): number {
  return clamp(4 + Math.floor((Math.max(1, Math.floor(depth)) - 1) / 4), 4, 7);
}

export interface Circler {
  /** opening bearing in radians */
  bearing0: number;
  /** signed angular velocity, rad/s */
  omega: number;
}

/** Seeded circler. FIXED DRAW ORDER: bearing, direction, speed. */
export function circlerFor(seed: number): Circler {
  const rng = mulberry32((seed ^ SE_SALT) >>> 0);
  const bearing0 = rng() * Math.PI * 2;
  const dir = rng() < 0.5 ? -1 : 1;
  const omega = dir * (0.28 + rng() * 0.34);
  return { bearing0, omega };
}

const TAU = Math.PI * 2;

/** Bearing at play time `ms`, wrapped into [0, 2pi). */
export function bearingAt(c: Circler, ms: number): number {
  const b = (c.bearing0 + (c.omega * ms) / 1000) % TAU;
  return b < 0 ? b + TAU : b;
}

export interface Call {
  target: Chip;
  options: Chip[];
  answerIdx: number;
}

const chipKey = (c: Chip): string => `${c.kind}:${c.n}`;

/**
 * One call: a target mark plus 3 distractors that differ in kind or count.
 * FIXED DRAW ORDER: target kind, target n, then candidate kind/n pairs, then
 * the Fisher-Yates shuffle. Drawn from a persistent stream so re-rolls after
 * a wrong pick stay deterministic.
 */
export function makeCall(rng: () => number): Call {
  const target: Chip = { kind: Math.floor(rng() * CHIP_KINDS), n: 2 + Math.floor(rng() * 6) };
  const options: Chip[] = [{ ...target }];
  while (options.length < 4) {
    const cand: Chip = { kind: Math.floor(rng() * CHIP_KINDS), n: 2 + Math.floor(rng() * 6) };
    if (!options.some((o) => chipKey(o) === chipKey(cand))) options.push(cand);
  }
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { target, options, answerIdx: options.findIndex((o) => chipKey(o) === chipKey(target)) };
}

/** The first `n` calls for a seed — the schedule the scene actually plays. */
export function buildCalls(seed: number, n: number): Call[] {
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const out: Call[] = [];
  for (let i = 0; i < n; i++) out.push(makeCall(rng));
  return out;
}

export type ShelfEnd = 'quota' | 'caught' | 'timeout' | 'escape';

export interface ShelfState {
  depth: number;
  dist: number;
  commits: number;
  callsDone: number;
  hpDelta: number;
}

/** Full StageResult for every ending — pure, so the payout band self-tests. */
export function resolveShelf(end: ShelfEnd, s: ShelfState): StageResult {
  const par = parFor(Math.max(1, Math.floor(s.depth)));
  switch (end) {
    case 'quota': {
      const frac = clamp(s.dist / START_DIST, 0, 1);
      return {
        correct: true,
        points: Math.round(par * (0.62 + 0.38 * frac)) + COMMIT_PTS * s.commits,
        hpDelta: s.hpDelta,
        summary: s.commits >= s.callsDone ? 'NEVER ONCE HESITATED' : 'YOU HELD. IT KEPT ITS DISTANCE.',
      };
    }
    case 'caught':
      return { correct: false, points: 0, hpDelta: s.hpDelta - CAUGHT_HP, summary: 'THE GREY SHAPE STOPPED CIRCLING' };
    case 'timeout':
      return { correct: null, points: PARTIAL_PTS * s.callsDone, hpDelta: s.hpDelta, summary: 'YOU DITHERED. THE WATER GOT BORED.' };
    default:
      return escaped(0, 'LEFT THE WATER. LEARNED NOTHING.');
  }
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

const CX = STAGE_W / 2;
const CY = 200;
const RX_MIN = 200;
const RX_SPAN = 420;
const RY_MIN = 40;
const RY_SPAN = 80;
const OPT_SIZE = 150;
const OPT_GAP = 22;
const OPT_Y = 500;
const TGT_SIZE = 140;
const PULSE_MS = 180;

/** Motion gate: IQB_MOTION === '0' or prefers-reduced-motion. */
function motionOn(): boolean {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('IQB_MOTION') === '0') return false;
  } catch { /* opaque storage */ }
  try {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  } catch { /* opaque media query */ }
  return true;
}

/** The shape: a dorsal fin over a body line. Silhouette, never a hue cue. */
function circlerPrims(): Prim[] {
  return [
    { k: 'line', x1: 16, y1: 62, x2: 84, y2: 62 },
    { k: 'tri', x: 50, y: 40, s: 22 },
    { k: 'line', x1: 16, y1: 62, x2: 6, y2: 46 },
    { k: 'line', x1: 84, y1: 62, x2: 96, y2: 74 },
  ];
}

/** You: one small diamond at the centre of the ring. */
function selfPrims(): Prim[] {
  return [{ k: 'diamond', x: 50, y: 50, s: 16 }];
}

export function mountShelfEdge(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const motion = motionOn();
  const settle = onceResolve(ctx.onDone);
  const depth = Math.max(1, Math.floor(ctx.depth));
  const hue = T.boardHues[ctx.seed % T.boardHues.length];
  const quota = callQuota(depth);
  const wrongPrice = wrongCost(depth);
  const circler = circlerFor(ctx.seed);
  const callRng = mulberry32((ctx.seed ^ 0x9e3779b9) >>> 0);

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  text(root, 'SHELF EDGE', 40, 26, 24, T.gold, true);
  text(root, 'THE FLOOR ENDED A WHILE AGO', 40, 58, 13, T.muted);

  const barW = 620;
  const barX = (STAGE_W - barW) / 2;
  const barBack = new Sprite(Texture.WHITE);
  barBack.x = barX;
  barBack.y = 74;
  barBack.width = barW;
  barBack.height = 8;
  barBack.tint = T.panelEdge;
  barBack.alpha = 0.5;
  root.addChild(barBack);
  const bar = new Sprite(Texture.WHITE);
  bar.x = barX;
  bar.y = 74;
  bar.height = 8;
  root.addChild(bar);
  const distTxt = text(root, '', barX, 44, 15, T.ink, true);

  /* ---- water ring layer ---- */
  const ring = new Graphics();
  root.addChild(ring);
  const pulse = new Graphics();
  root.addChild(pulse);

  const you = spriteFrom(cellCanvas(selfPrims(), T.ink, 40));
  you.x = CX - 20;
  you.y = CY - 20;
  root.addChild(you);

  const shape = spriteFrom(cellCanvas(circlerPrims(), '#9aa7ba', 54));
  shape.anchor.set(0.5);
  root.addChild(shape);

  /* ---- question layer ---- */
  text(root, 'MATCH THE MARK', CX - 84, 306, 15, T.muted);
  const dyn = new Container();
  root.addChild(dyn);

  const status = text(root, '', 40, 700, 16, T.ink, true);
  const caption = text(root, '', 40, 730, 14, T.muted);
  text(root, 'COMMIT. A FAST WRONG GUESS COSTS LESS THAN A SLOW RIGHT ONE.', 40, 762, 13, T.muted);
  text(root, 'CLICK / TAP · KEYS 1–4 · ESC BAILS NEUTRAL', 40, 790, 12, T.muted);

  /* ---- goal card (first GOAL_MS: input locked, clock frozen) ----
   * Mirrors the requested onboard.ts CARDS['shelf-edge'] — keep in step. */
  const CARD_W = 640;
  const card = panel(root, (STAGE_W - CARD_W) / 2, 300, CARD_W, 190);
  text(card, 'SHELF EDGE', 28, 20, 26, T.gold, true);
  text(card, 'SOMETHING CIRCLES. IT CLOSES WHILE YOU DITHER.', 28, 62, 15, T.ink);
  text(card, 'A FAST WRONG GUESS COSTS LESS THAN A SLOW RIGHT ONE.', 28, 90, 13, T.muted);
  text(card, 'CLICK / TAP · KEYS 1–4 · ESC BAILS NEUTRAL', 28, 116, 13, T.muted);
  const unlockTxt = text(card, 'INPUT UNLOCKS IN 2…', 28, 148, 14, T.good, true);

  /* ---- state ---- */
  const playMs = Math.max(6000, ctx.timerLen * 1000 - GOAL_MS - SETTLE_MS);
  let clock = 0;
  let callT = 0;
  let introLeft = GOAL_MS;
  let dist = START_DIST;
  let commits = 0;
  let callsDone = 0;
  let wrongs = 0;
  let hpDelta = 0;
  let dead = false;
  let pulseT = -1;
  let nextThreshold = 60;
  let call: Call = makeCall(callRng);

  function snapshot(): ShelfState {
    return { depth, dist, commits, callsDone, hpDelta };
  }

  function finish(end: ShelfEnd): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(resolveShelf(end, snapshot()));
  }

  function refreshHud(): void {
    const pct = Math.max(0, Math.round(dist));
    distTxt.text = `DISTANCE ${pct} · CALLS ${callsDone}/${quota} · WRONG COSTS ${Math.round(wrongPrice)}`;
    status.text = `COMMITS ${commits} · MISREADS ${wrongs} · HP ${hpDelta}`;
    status.style.fill = hpDelta < 0 ? T.bad : T.ink;
  }

  function renderCall(): void {
    dyn.removeChildren().forEach((c) => c.destroy({ children: true }));
    const tgt = spriteFrom(tileCanvas(chipPrims(call.target.kind, call.target.n), hue, TGT_SIZE));
    tgt.x = CX - TGT_SIZE / 2;
    tgt.y = 330;
    dyn.addChild(tgt);

    const rowW = 4 * OPT_SIZE + 3 * OPT_GAP;
    const ox = (STAGE_W - rowW) / 2;
    call.options.forEach((chip, i) => {
      const s = spriteFrom(tileCanvas(chipPrims(chip.kind, chip.n), hue, OPT_SIZE));
      s.x = ox + i * (OPT_SIZE + OPT_GAP);
      s.y = OPT_Y;
      s.eventMode = 'static';
      s.cursor = 'pointer';
      s.on('pointerdown', () => pick(i));
      dyn.addChild(s);
      text(dyn, String(i + 1), s.x + 8, s.y + OPT_SIZE - 24, 13, T.muted);
    });
  }

  function newCall(): void {
    call = makeCall(callRng);
    callT = 0;
    renderCall();
  }

  function pick(i: number): void {
    if (dead || introLeft > 0) return;
    if (i === call.answerIdx) {
      if (callT <= COMMIT_MS) commits++;
      dist = Math.min(START_DIST, dist + pushFor(callT));
      callsDone++;
      caption.text = callT <= COMMIT_MS ? 'COMMITTED. IT DRIFTS BACK OUT.' : 'RIGHT, EVENTUALLY. IT BARELY MOVED.';
      refreshHud();
      if (callsDone >= quota) {
        finish('quota');
        return;
      }
      newCall();
    } else {
      wrongs++;
      hpDelta -= WRONG_HP;
      dist -= wrongPrice;
      caption.text = 'WRONG MARK — CHEAP. DITHERING IS NOT.';
      refreshHud();
      if (dist <= 0) {
        finish('caught');
        return;
      }
      newCall();
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      finish('escape');
      return;
    }
    if (introLeft > 0) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 4) pick(n - 1);
  }
  window.addEventListener('keydown', onKey);

  /* ---- paint ---- */
  function paint(): void {
    const rawFrac = clamp(dist / START_DIST, 0, 1);
    // motion off: the ring snaps to 10 % rungs instead of breathing per frame
    const frac = motion ? rawFrac : Math.round(rawFrac * 10) / 10;
    const rx = RX_MIN + RX_SPAN * frac;
    const ry = RY_MIN + RY_SPAN * frac;
    ring.clear();
    ring.ellipse(CX, CY, rx, ry).stroke({ width: 2, color: frac > 0.5 ? T.accentA : T.bad, alpha: 0.5 });
    ring.ellipse(CX, CY, rx * 0.62, ry * 0.62).stroke({ width: 1, color: T.panelEdge, alpha: 0.5 });

    // motion off: bearing advances in discrete 500 ms steps
    const bt = motion ? clock : Math.floor(clock / 500) * 500;
    const b = bearingAt(circler, bt);
    shape.x = CX + rx * Math.cos(b);
    shape.y = CY + ry * Math.sin(b);
    shape.rotation = motion ? Math.atan2(-Math.sin(b) * ry, -Math.cos(b) * rx) + Math.PI : 0;

    bar.width = Math.max(2, barW * rawFrac);
    bar.tint = rawFrac > 0.5 ? T.good : rawFrac > 0.25 ? T.gold : T.bad;

    pulse.clear();
    if (pulseT >= 0) {
      const k = pulseT / PULSE_MS;
      if (k >= 1) pulseT = -1;
      else pulse.circle(CX, CY, 40 + 90 * k).stroke({ width: 3, color: T.bad, alpha: 0.55 * (1 - k) });
    }
  }

  /* ---- clock: Pixi ticker only, never Date.now ---- */
  const onTick = (tk: Ticker): void => {
    if (dead) return;
    if (introLeft > 0) {
      introLeft -= tk.deltaMS;
      if (introLeft <= 0) card.visible = false;
      else unlockTxt.text = `INPUT UNLOCKS IN ${Math.ceil(introLeft / 1000)}…`;
      paint();
      return;
    }
    const dt = tk.deltaMS;
    clock += dt;
    if (pulseT >= 0) pulseT += dt;

    // accelerating drain, taken as the exact integral difference so the live
    // stage and the pure ditherCost() curve can never disagree
    const before = ditherCost(depth, callT);
    callT += dt;
    dist -= ditherCost(depth, callT) - before;

    if (dist <= nextThreshold && nextThreshold > 0) {
      // localized ring pulse (<= 180 ms), never a fullscreen strobe
      pulseT = 0;
      caption.text = nextThreshold >= 60 ? 'IT IS INSIDE THE RING NOW.' : 'CLOSE ENOUGH TO COUNT ITS TEETH.';
      nextThreshold = nextThreshold >= 60 ? 30 : -1;
    }
    if (dist <= 0) {
      finish('caught');
      return;
    }
    if (clock >= playMs) {
      finish('timeout');
      return;
    }
    refreshHud();
    paint();
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  renderCall();
  refreshHud();
  paint();
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  /* --- the drain curve: zero at zero, monotone, and ACCELERATING --- */
  for (const d of [1, 3, 7, 12, 20]) {
    if (ditherCost(d, 0) !== 0) failures.push(`ditherCost(${d},0) must be 0`);
    let prev = -1;
    for (let t = 0; t <= 8000; t += 100) {
      const c = ditherCost(d, t);
      if (c < prev) failures.push(`ditherCost not monotone d=${d} t=${t}`);
      prev = c;
    }
    const firstSec = ditherCost(d, 1000);
    const secondSec = ditherCost(d, 2000) - firstSec;
    if (secondSec <= firstSec) failures.push(`drain does not accelerate at d=${d}`);
    if (ditherCost(d, -500) !== 0) failures.push(`negative dither must clamp d=${d}`);
  }

  /* --- THE TEACHING RAIL (this is the whole stage) ---
   * committing is cheaper than a wrong guess; dithering is dearer. */
  for (let d = 1; d <= 20; d++) {
    const w = wrongCost(d);
    if (ditherCost(d, COMMIT_MS) >= w) failures.push(`commit costs >= a wrong guess at d=${d}`);
    if (ditherCost(d, DITHER_MS) <= w) failures.push(`dithering is cheaper than a wrong guess at d=${d}`);
    // slack rail: you can always afford two misreads plus one committed call
    if (START_DIST <= 2 * w + ditherCost(d, COMMIT_MS)) failures.push(`no misread slack at d=${d}`);
  }

  /* --- push curve --- */
  if (pushFor(0) !== PUSH_MAX) failures.push('pushFor(0) must be PUSH_MAX');
  if (pushFor(PUSH_FLOOR_MS) !== PUSH_MIN || pushFor(99999) !== PUSH_MIN) failures.push('push floor wrong');
  for (let t = 0; t < PUSH_FLOOR_MS; t += 120) {
    if (pushFor(t + 120) > pushFor(t)) failures.push(`push must fall with time t=${t}`);
  }

  /* --- SOLVABILITY: committing every call always survives the quota --- */
  for (let d = 1; d <= 20; d++) {
    let dist = START_DIST;
    const q = callQuota(d);
    for (let i = 0; i < q; i++) {
      dist -= ditherCost(d, COMMIT_MS);
      if (dist <= 0) {
        failures.push(`committed play still drowns at d=${d} call=${i}`);
        break;
      }
      dist = Math.min(START_DIST, dist + pushFor(COMMIT_MS));
    }
  }
  /* --- and pure dithering always ends the round well inside a budget --- */
  for (let d = 1; d <= 20; d++) {
    let dist = START_DIST;
    let t = 0;
    while (dist > 0 && t < 60000) {
      const before = ditherCost(d, t);
      t += 16;
      dist -= ditherCost(d, t) - before;
    }
    if (t >= 60000) failures.push(`dithering never resolves at d=${d}`);
  }

  /* --- quota ladder --- */
  if (callQuota(1) !== 4 || callQuota(5) !== 5 || callQuota(13) !== 7 || callQuota(99) !== 7 || callQuota(-3) !== 4) {
    failures.push('callQuota ladder wrong');
  }

  /* --- seeded schedule: deterministic, valid, and seed-varying --- */
  const variants = new Set<string>();
  for (let seed = 1; seed <= 300; seed++) {
    const a = buildCalls(seed, 6);
    const b = buildCalls(seed, 6);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      failures.push(`calls nondeterministic seed=${seed}`);
      break;
    }
    for (const c of a) {
      if (c.answerIdx < 0 || c.answerIdx > 3) failures.push(`answer missing seed=${seed}`);
      if (c.options.length !== 4) failures.push(`option count wrong seed=${seed}`);
      if (new Set(c.options.map((o) => `${o.kind}:${o.n}`)).size !== 4) failures.push(`duplicate option seed=${seed}`);
      if (c.options.some((o) => o.kind < 0 || o.kind >= CHIP_KINDS || o.n < 2 || o.n > 7)) failures.push(`bad chip seed=${seed}`);
      const ans = c.options[c.answerIdx];
      if (ans.kind !== c.target.kind || ans.n !== c.target.n) failures.push(`answerIdx mislabels seed=${seed}`);
    }
    variants.add(JSON.stringify(a[0]));
  }
  if (variants.size < 20) failures.push(`calls seed-blind: ${variants.size} distinct openers over 300 seeds`);

  /* --- circler: deterministic, wrapped, seed-varying, never stalled --- */
  const circVariants = new Set<string>();
  for (let seed = 1; seed <= 300; seed++) {
    const c = circlerFor(seed);
    if (JSON.stringify(c) !== JSON.stringify(circlerFor(seed))) failures.push(`circler nondeterministic seed=${seed}`);
    if (Math.abs(c.omega) < 0.27) failures.push(`circler barely moves seed=${seed}`);
    if (c.bearing0 < 0 || c.bearing0 >= Math.PI * 2) failures.push(`bearing0 out of range seed=${seed}`);
    for (const t of [0, 1234, 9999, 45000]) {
      const b = bearingAt(c, t);
      if (!(b >= 0 && b < Math.PI * 2)) failures.push(`bearing unwrapped seed=${seed} t=${t}`);
    }
    circVariants.add(`${c.bearing0.toFixed(4)}|${c.omega.toFixed(4)}`);
  }
  if (circVariants.size < 200) failures.push(`circler seed-blind: ${circVariants.size} distinct over 300 seeds`);
  if (bearingAt({ bearing0: 0, omega: -1 }, 1000) <= Math.PI) failures.push('negative omega must wrap forward');

  /* --- POINTS BAND vs par(d) = 100d + 40, and the stall check --- */
  for (let d = 1; d <= 12; d++) {
    const par = parFor(d);
    const q = callQuota(d);
    const best = resolveShelf('quota', { depth: d, dist: START_DIST, commits: q, callsDone: q, hpDelta: 0 });
    const worst = resolveShelf('quota', { depth: d, dist: 1, commits: 0, callsDone: q, hpDelta: -12 });
    if (best.correct !== true || worst.correct !== true) failures.push(`quota ending must be a win at d=${d}`);
    if (best.points > 1.35 * par) failures.push(`best win ${best.points} above band vs par ${par} at d=${d}`);
    if (worst.points < 0.6 * par) failures.push(`worst win ${worst.points} below band vs par ${par} at d=${d}`);
    if (best.points <= worst.points) failures.push(`distance must pay at d=${d}`);
    // stalling is never optimal: the richest timeout pays less than any win
    const stall = resolveShelf('timeout', { depth: d, dist: 50, commits: 0, callsDone: q - 1, hpDelta: 0 });
    if (stall.correct !== null) failures.push(`timeout must be neutral at d=${d}`);
    if (stall.points >= worst.points) failures.push(`stalling ${stall.points} beats a win ${worst.points} at d=${d}`);
    const caught = resolveShelf('caught', { depth: d, dist: 0, commits: 2, callsDone: 2, hpDelta: -8 });
    if (caught.correct !== false || caught.points !== 0) failures.push(`caught must be a scoreless loss at d=${d}`);
    if (caught.hpDelta !== -8 - CAUGHT_HP) failures.push(`caught hp wrong at d=${d}`);
  }
  const esc = resolveShelf('escape', { depth: 9, dist: 12, commits: 3, callsDone: 3, hpDelta: -20 });
  if (esc.correct !== null || esc.points !== 0 || esc.hpDelta !== 0) failures.push('Esc must be a clean neutral');
  for (const r of [resolveShelf('quota', { depth: 4, dist: 90, commits: 4, callsDone: 5, hpDelta: 0 }), esc]) {
    if (r.summary.length > 48) failures.push(`summary too long: ${r.summary}`);
  }

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/scenes/takeovers/shelfedge.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/shelfedge.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] SHELF EDGE OK' : `[selftest] SHELF EDGE FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
