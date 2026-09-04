/**
 * LANTERN GUARD — takeover scene (the last never-started v1 mode; designed here).
 *
 * ==== REGISTRATION REQUEST (Main-owned wiring — this file touches nothing shared) ====
 *   stage id     : 'lantern-guard'
 *   mount export : mountLanternGuard      -> append to main.ts TAKEOVERS
 *   display name : 'LANTERN GUARD'        -> TAKEOVER_NAMES
 *   goal card    : title    'LANTERN GUARD'
 *                  goal     'DRAFTS COME FOR YOUR FLAME. SHUTTER THE SIDE THEY BLOW FROM,
 *                            AND FEED THE LANTERN BY ANSWERING THE BOARD.'
 *                  controls 'MOVE TO AIM THE SHUTTER · ARROWS / WASD · CLICK OR KEYS 1–6'
 * =====================================================================================
 *
 * THE ROUND
 *   A lantern burns in the middle of the stage and its FLAME drains every second.
 *   A seeded schedule of DRAFTS blows in from N / E / S / W; each one telegraphs
 *   with an arrow for warnMs before it lands. Your SHUTTER covers exactly one
 *   side — it follows the angle from the lantern to your pointer (arrows / WASD
 *   drive it too, keyboard parity). A draft that lands on the shuttered side is
 *   BLOCKED (+3 flame). A draft that lands anywhere else SNUFFS (-gustCost flame).
 *
 *   Answering the board is how you FEED the lantern: pick the option tile that
 *   matches the posted mark, and the flame jumps +26 and a fresh board deals.
 *   Reach feedQuota(depth) feeds before the flame reaches zero and you win.
 *   A wrong tile SPILLS fuel (-14 flame, -4 hp) and burns out that tile; the
 *   round continues, so a loss is always a chain of your own choices.
 *
 *   The tension is deliberate: the option tiles sit BELOW the lantern, so every
 *   trip down to answer swings the shutter south and leaves three sides open.
 *   Answer in the gaps between drafts, not on top of one.
 *
 * POINTS CURVE vs par(d) = 100*d + 40 (parFor imported from floorfall.ts):
 *   win     = round(par * (0.55 + 0.45 * flameFrac)) [+30 UNSNUFFED if no draft landed]
 *   lose    = flame hit zero: correct false, 0 pts, hpDelta - 10
 *   timeout = neutral (correct:null), 25 * feeds banked, hpDelta as accrued
 *             (strictly below the smallest possible win — never stall-optimal)
 *
 * DETERMINISM: the draft schedule is a pure function of ctx.seed via an own
 *   mulberry32 in FIXED DRAW ORDER (per draft: side, feint roll, feint dir, gap
 *   jitter); the boards come off a second seeded stream in deal order. No
 *   Math.random, no Date.now — the clock is Pixi's shared ticker delta.
 *   Self-limits to ctx.timerLen; StageResult settles exactly once via
 *   onceResolve; ctx.container is emptied on done and every listener/ticker
 *   is removed.
 *
 * FAIRNESS RAILS: every draft telegraphs before it lands (900 ms -> 580 ms by
 *   depth) and a depth>=7 FEINT still shows its true side for half the warning;
 *   snuff feedback is a localized vignette (<= 180 ms, never a fullscreen
 *   strobe); all text >= 11 px; one hue per board from T.boardHues; DNA
 *   primitive marks only. Motion gate (localStorage IQB_MOTION === '0' or
 *   prefers-reduced-motion): the flame stops flickering and the draft arrows
 *   stop pulsing — sizes/positions are the exact same functions of state, and
 *   every rule is identical.
 */
import { Container, Graphics, Rectangle, Sprite, Text, Texture, Ticker } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { Chip } from './redlight.ts';
import { CHIP_KINDS, chipPrims } from './redlight.ts';
import { GOAL_MS, mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';
import { tileCanvas } from '../../glyphs.ts';
import { panel, text, spriteFrom } from '../game.ts';
import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import { parFor } from './floorfall.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested below — no Pixi, no DOM, no timers)         */
/* ------------------------------------------------------------------ */

const LG_SALT = 0x1a27e871;
const SETTLE_MS = 800;

/** 0 = N · 1 = E · 2 = S · 3 = W. The shutter covers exactly one. */
export const SIDES = 4;
export const FLAME_MAX = 100;
export const FLAME_START = 78;
/** Flame regained per blocked draft. */
export const BLOCK_REWARD = 3;
/** Flame regained per correct answer — answering IS the fuel. */
export const FEED_FUEL = 26;
/** Flame lost per wrong tile. */
export const SPILL = 14;
/** Option tiles on the board. */
export const OPTS = 6;
/** hp cost of a spilled feed. */
export const SPILL_HP = 4;
/** hp cost of letting the lantern go out. */
export const DEATH_HP = 10;

export interface LGParams {
  /** flame units lost per second of burn */
  drainPerSec: number;
  /** flame units lost when a draft lands unshuttered */
  gustCost: number;
  /** telegraph time before a draft lands */
  warnMs: number;
  /** nominal gap between drafts */
  gapMs: number;
  /** +/- fraction applied to gapMs */
  jitter: number;
  /** depth >= 7: some drafts swap side halfway through their warning */
  feints: boolean;
  /** chance a draft feints, when feints are on */
  feintChance: number;
}

export function lanternParams(depth: number): LGParams {
  const d = Math.max(1, Math.min(10, Math.floor(depth)));
  const u = (d - 1) / 9;
  return {
    drainPerSec: 4.2 + 2.8 * u, // 4.2 -> 7.0
    gustCost: Math.round(12 + 6 * u), // 12 -> 18
    warnMs: Math.round(900 - 320 * u), // 900 -> 580
    gapMs: Math.round(2600 - 900 * u), // 2.6 s -> 1.7 s
    jitter: 0.25,
    feints: d >= 7,
    feintChance: 0.35,
  };
}

/** Feeds needed to win: 2 at shallow depth, 4 deep. */
export function feedQuota(depth: number): number {
  const d = Math.max(1, Math.floor(depth));
  return 2 + Math.min(2, Math.floor((d - 1) / 4));
}

export interface Draft {
  /** ms into the play budget when the draft lands */
  t: number;
  /** side the telegraph shows first */
  side: number;
  /** side the draft actually lands on (differs only on a feint) */
  finalSide: number;
}

/**
 * Seeded draft schedule — FIXED DRAW ORDER (do not reorder):
 * per draft: side, feint roll, feint direction, then the gap jitter.
 * Always lands inside timerLenSec*1000 - SETTLE_MS.
 */
export function buildDrafts(seed: number, depth: number, timerLenSec: number): Draft[] {
  const p = lanternParams(depth);
  const rng = mulberry32((seed ^ LG_SALT) >>> 0);
  const budget = Math.max(5, timerLenSec) * 1000 - SETTLE_MS;
  const drafts: Draft[] = [];
  let t = Math.max(p.warnMs + 300, 1400);
  while (t < budget) {
    const side = Math.floor(rng() * SIDES);
    const feintRoll = rng();
    const dir = rng() < 0.5 ? 1 : SIDES - 1; // adjacent side either way, never opposite
    const finalSide = p.feints && feintRoll < p.feintChance ? (side + dir) % SIDES : side;
    drafts.push({ t: Math.round(t), side, finalSide });
    t += Math.round(p.gapMs * (1 - p.jitter + 2 * p.jitter * rng()));
  }
  return drafts;
}

/** Which side the shutter covers for a pointer offset from the lantern centre. */
export function sideFromAngle(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 2; // degenerate: keep the last sane reading (south)
  const q = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 2)) % SIDES) + SIDES) % SIDES;
  return [1, 2, 3, 0][q]; // atan2 quadrant order E,S,W,N -> our N,E,S,W indexing
}

/** A draft is stopped only when the shutter is on the side it actually lands on. */
export function draftBlocked(shutter: number, draft: Draft): boolean {
  return shutter === draft.finalSide;
}

/** Flame after dtMs of plain burn — clamped to [0, FLAME_MAX]. */
export function burn(flame: number, dtMs: number, drainPerSec: number): number {
  return clampFlame(flame - (drainPerSec * dtMs) / 1000);
}

export function clampFlame(v: number): number {
  return Math.max(0, Math.min(FLAME_MAX, v));
}

/**
 * Win payout. flameFrac is the flame left (0..1) at the winning feed; noSnuff
 * is true only when every scheduled draft that landed was shuttered.
 */
export function winPoints(depth: number, flameFrac: number, noSnuff: boolean): number {
  const f = Math.max(0, Math.min(1, flameFrac));
  return Math.round(parFor(depth) * (0.55 + 0.45 * f)) + (noSnuff ? 30 : 0);
}

/** Timeout / Esc payout: banked feeds only, always below the smallest win. */
export function neutralPoints(feeds: number): number {
  return 25 * Math.max(0, feeds);
}

/**
 * Pure play simulation used by the rails below (and nothing else). Steps the
 * flame at `stepMs`, blocks drafts per `blockAll`, and feeds every
 * `feedEveryMs`. Returns the feeds reached and whether the flame survived.
 */
export function simulateGuard(
  seed: number, depth: number, timerLenSec: number,
  opts: { blockAll: boolean; feedEveryMs: number },
): { feeds: number; flame: number; won: boolean; diedAt: number } {
  const p = lanternParams(depth);
  const quota = feedQuota(depth);
  const drafts = buildDrafts(seed, depth, timerLenSec);
  const budget = Math.max(5, timerLenSec) * 1000 - SETTLE_MS;
  const STEP = 16;
  let flame = FLAME_START;
  let feeds = 0;
  let di = 0;
  let nextFeed = opts.feedEveryMs;
  for (let t = STEP; t <= budget; t += STEP) {
    flame = burn(flame, STEP, p.drainPerSec);
    while (di < drafts.length && drafts[di].t <= t) {
      flame = clampFlame(flame + (opts.blockAll ? BLOCK_REWARD : -p.gustCost));
      di++;
    }
    if (flame <= 0) return { feeds, flame: 0, won: false, diedAt: t };
    if (opts.feedEveryMs > 0 && t >= nextFeed) {
      feeds++;
      nextFeed += opts.feedEveryMs;
      if (feeds >= quota) return { feeds, flame, won: true, diedAt: -1 };
      flame = clampFlame(flame + FEED_FUEL);
    }
  }
  return { feeds, flame, won: false, diedAt: -1 };
}

interface Board {
  opts: Chip[];
  answerIdx: number;
}

/** One board: OPTS distinct chips, one of which matches the posted mark. */
export function makeBoard(rng: () => number): Board {
  const key = (c: Chip): string => `${c.kind}:${c.n}`;
  const ans: Chip = { kind: Math.floor(rng() * CHIP_KINDS), n: 2 + Math.floor(rng() * 6) };
  const opts: Chip[] = [{ ...ans }];
  while (opts.length < OPTS) {
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

const LX = STAGE_W / 2;
const LY = 262;
const RING_R = 118;
const ARROW_R = 168;
const OPT_SIZE = 150;
const OPT_GAP = 22;
const OPT_Y = 580;
const BAR_W = 520;
const BAR_Y = 470;
const KB_SIDE_KEYS: Readonly<Record<string, number>> = {
  ArrowUp: 0, w: 0, W: 0,
  ArrowRight: 1, d: 1, D: 1,
  ArrowDown: 2, s: 2, S: 2,
  ArrowLeft: 3, a: 3, A: 3,
};

/** IQB_MOTION === '0' or prefers-reduced-motion -> static variant. */
function motionOn(): boolean {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('IQB_MOTION') === '0') return false;
  } catch { /* storage blocked — treat as motion on */ }
  try {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  } catch { /* no matchMedia — treat as motion on */ }
  return true;
}

export function mountLanternGuard(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const MOTION = motionOn();
  const rng = mulberry32((ctx.seed ^ 0x9e3779b1) >>> 0);
  const hue = T.boardHues[ctx.seed % T.boardHues.length];
  const settle = onceResolve(ctx.onDone);
  const p = lanternParams(ctx.depth);
  const quota = feedQuota(ctx.depth);

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  text(root, 'LANTERN GUARD', LX - 112, 30, 26, T.gold, true);
  text(root, 'SHUTTER THE SIDE THE DRAFT COMES FROM · FEED THE FLAME BY ANSWERING', LX - 300, 66, 13, T.muted);

  /* ---- the mark to match ---- */
  panel(root, 92, 158, 210, 250);
  text(root, 'FEED THIS MARK', 112, 178, 13, T.muted);
  const targetHolder = new Container();
  targetHolder.x = 122;
  targetHolder.y = 208;
  root.addChild(targetHolder);

  /* ---- hud ---- */
  panel(root, STAGE_W - 302, 158, 210, 250);
  const feedTxt = text(root, '', STAGE_W - 282, 186, 18, T.ink, true);
  const flameTxt = text(root, '', STAGE_W - 282, 222, 18, T.good, true);
  const hpTxt = text(root, '', STAGE_W - 282, 258, 16, T.ink);
  const snuffTxt = text(root, '', STAGE_W - 282, 292, 14, T.muted);
  const shutterTxt = text(root, '', STAGE_W - 282, 326, 14, T.muted);

  /* ---- lantern + shutter + drafts (one Graphics, repainted per frame) ---- */
  const lamp = new Graphics();
  root.addChild(lamp);

  /* ---- flame bar ---- */
  const barBack = new Graphics();
  barBack.roundRect(LX - BAR_W / 2, BAR_Y, BAR_W, 18, 9).fill({ color: 0x0b1220 }).stroke({ width: 1.5, color: 0x27334d });
  root.addChild(barBack);
  const barFill = new Graphics();
  root.addChild(barFill);
  text(root, 'FLAME', LX - BAR_W / 2 - 74, BAR_Y - 1, 14, T.muted, true);

  /* ---- vignette (snuff sting, <= 180 ms, localized alpha, never a strobe) ---- */
  const vignette = new Sprite(Texture.WHITE);
  vignette.width = STAGE_W;
  vignette.height = STAGE_H;
  vignette.tint = 0xff2038;
  vignette.alpha = 0;
  root.addChild(vignette);

  /* ---- option tiles ---- */
  const optLayer = new Container();
  root.addChild(optLayer);

  const status = text(root, '', 60, 790, 16, T.ink, true);
  text(root, 'MOVE THE POINTER AROUND THE LANTERN TO AIM THE SHUTTER · ARROWS / WASD ALSO AIM · CLICK OR KEYS 1–6 TO FEED · ESC BAILS NEUTRAL', 60, 830, 12, T.muted);

  /* ---- goal card (first GOAL_MS: input locked, clock frozen) ----
   * Mirrors the goal card requested at the top of this file — keep in step. */
  const CARD_W = 620;
  const card = panel(root, (STAGE_W - CARD_W) / 2, 300, CARD_W, 176);
  text(card, 'LANTERN GUARD', 28, 20, 26, T.gold, true);
  text(card, 'SHUTTER THE DRAFTS. FEED THE FLAME BY ANSWERING.', 28, 64, 15, T.ink);
  text(card, 'MOVE TO AIM · ARROWS / WASD · CLICK OR KEYS 1–6 · ESC NEUTRAL', 28, 94, 13, T.muted);
  const unlockTxt = text(card, 'INPUT UNLOCKS IN 2…', 28, 130, 14, T.good, true);

  /* ---- state ---- */
  const playSec = Math.max(6, ctx.timerLen - GOAL_MS / 1000);
  const drafts = buildDrafts(ctx.seed, ctx.depth, playSec);
  const budgetMs = Math.max(5, playSec) * 1000 - SETTLE_MS;
  let clock = 0;
  let draftIdx = 0;
  let flame = FLAME_START;
  let feeds = 0;
  let hpDelta = 0;
  let snuffed = 0;
  let blocked = 0;
  let shutter = 2; // south: where the tiles are, where your hands start
  let vignetteAt = -1;
  let introLeft = GOAL_MS;
  let dead = false;
  let board = makeBoard(rng);
  const burned = new Set<number>();
  let flicker = 0;

  function finish(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function refreshHud(): void {
    feedTxt.text = `FED ${feeds}/${quota}`;
    flameTxt.text = `FLAME ${Math.ceil(flame)}%`;
    flameTxt.style.fill = flame < 25 ? T.bad : flame < 55 ? T.gold : T.good;
    hpTxt.text = `HP ${hpDelta}`;
    hpTxt.style.fill = hpDelta < 0 ? T.bad : T.ink;
    snuffTxt.text = `BLOCKED ${blocked} · SNUFFED ${snuffed}`;
    shutterTxt.text = `SHUTTER ${['NORTH', 'EAST', 'SOUTH', 'WEST'][shutter]}`;
    status.text = feeds >= quota
      ? 'THE LANTERN HOLDS'
      : `THE LANTERN NEEDS ${quota - feeds} MORE FEED${quota - feeds === 1 ? '' : 'S'}`;
  }

  /* ---- board rendering ---- */
  function dealBoard(): void {
    burned.clear();
    board = makeBoard(rng);
    renderBoard();
  }

  function renderBoard(): void {
    optLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    targetHolder.removeChildren().forEach((c) => c.destroy({ children: true }));

    const ansChip = board.opts[board.answerIdx];
    const tgt = spriteFrom(tileCanvas(chipPrims(ansChip.kind, ansChip.n), hue, 150));
    targetHolder.addChild(tgt);

    const rowW = OPTS * OPT_SIZE + (OPTS - 1) * OPT_GAP;
    const ox = (STAGE_W - rowW) / 2;
    board.opts.forEach((chip, i) => {
      const x = ox + i * (OPT_SIZE + OPT_GAP);
      const spr = spriteFrom(tileCanvas(chipPrims(chip.kind, chip.n), hue, OPT_SIZE));
      spr.x = x;
      spr.y = OPT_Y;
      if (burned.has(i)) {
        spr.alpha = 0.22;
      } else {
        spr.eventMode = 'static';
        spr.cursor = 'pointer';
        spr.on('pointerdown', () => pick(i));
      }
      optLayer.addChild(spr);
      text(optLayer, String(i + 1), x + 8, OPT_Y + OPT_SIZE - 24, 13, burned.has(i) ? T.bad : T.muted);
    });
  }

  /* ---- answers ---- */
  function pick(i: number): void {
    if (dead || introLeft > 0 || burned.has(i)) return;
    if (i === board.answerIdx) {
      feeds++;
      if (feeds >= quota) {
        refreshHud();
        finish({
          correct: true,
          points: winPoints(ctx.depth, flame / FLAME_MAX, snuffed === 0),
          hpDelta,
          summary: snuffed === 0 ? 'THE LANTERN NEVER GUTTERED' : `LANTERN KEPT · ${blocked} DRAFTS SHUTTERED`,
        });
        return;
      }
      flame = clampFlame(flame + FEED_FUEL);
      dealBoard();
      refreshHud();
      return;
    }
    // spill: fuel down the side of the lamp, that tile is burned out, play goes on
    burned.add(i);
    flame = clampFlame(flame - SPILL);
    hpDelta -= SPILL_HP;
    vignetteAt = clock;
    renderBoard();
    refreshHud();
    if (flame <= 0) lanternOut('SPILLED THE LAST OF THE OIL');
  }

  function lanternOut(why: string): void {
    finish({ correct: false, points: 0, hpDelta: hpDelta - DEATH_HP, summary: why });
  }

  /* ---- input ---- */
  root.eventMode = 'static';
  root.hitArea = new Rectangle(0, 0, STAGE_W, STAGE_H);
  const onMove = (e: FederatedPointerEvent): void => {
    if (dead) return;
    shutter = sideFromAngle(e.global.x - LX, e.global.y - LY);
    refreshHud();
  };
  root.on('pointermove', onMove);

  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      finish(escaped(hpDelta, 'WALKED AWAY FROM THE LIGHT'));
      return;
    }
    if (introLeft > 0) return; // goal card up — input locked, Esc excepted
    const side = KB_SIDE_KEYS[e.key];
    if (side !== undefined) {
      shutter = side;
      refreshHud();
      return;
    }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= OPTS) pick(n - 1);
  }
  window.addEventListener('keydown', onKey);

  /* ---- painting ---- */
  function paint(): void {
    const frac = flame / FLAME_MAX;
    lamp.clear();

    // lantern housing
    lamp.circle(LX, LY, RING_R).stroke({ width: 3, color: 0x27334d, alpha: 0.9 });
    lamp.circle(LX, LY, RING_R - 10).stroke({ width: 1.5, color: 0x27334d, alpha: 0.5 });
    lamp.moveTo(LX - 26, LY - RING_R - 16).lineTo(LX + 26, LY - RING_R - 16).stroke({ width: 4, color: 0x3a465e });

    // the flame itself: height reads the fuel at a glance, colour reads the danger
    const wobble = MOTION ? 1 + 0.05 * Math.sin(flicker / 110) : 1;
    const h = (26 + 74 * frac) * wobble;
    const w = 20 + 26 * frac;
    const col = frac < 0.25 ? T.bad : frac < 0.55 ? T.gold : hue;
    lamp.circle(LX, LY, 30 + 60 * frac).fill({ color: col, alpha: 0.07 + 0.05 * frac });
    lamp
      .moveTo(LX, LY + 44 - h)
      .lineTo(LX + w * 0.62, LY + 20)
      .lineTo(LX, LY + 44)
      .lineTo(LX - w * 0.62, LY + 20)
      .closePath()
      .fill({ color: col, alpha: 0.85 });
    lamp.circle(LX, LY + 24, Math.max(4, 12 * frac)).fill({ color: '#ffffff', alpha: 0.55 });
    // wick base so a dying flame still has an anchor to read against
    lamp.moveTo(LX - 26, LY + 48).lineTo(LX + 26, LY + 48).stroke({ width: 3, color: 0x3a465e });

    // shutter: a thick arc over the guarded side
    const mid = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][shutter];
    lamp.arc(LX, LY, RING_R + 14, mid - Math.PI / 4, mid + Math.PI / 4)
      .stroke({ width: 13, color: T.ink, alpha: 0.92 });
    lamp.arc(LX, LY, RING_R + 14, mid - Math.PI / 4, mid + Math.PI / 4)
      .stroke({ width: 3, color: hue, alpha: 0.9 });

    // telegraphs: every incoming draft inside its warning window
    for (let i = draftIdx; i < drafts.length; i++) {
      const d = drafts[i];
      const left = d.t - clock;
      if (left > p.warnMs) break;
      if (left < 0) continue;
      // a feint shows its true side for the second half of the warning
      const shown = left > p.warnMs / 2 ? d.side : d.finalSide;
      const a = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][shown];
      const k = 1 - left / p.warnMs; // 0 -> 1 as it closes in
      const rOuter = ARROW_R + 46 * (1 - k);
      const ax = LX + Math.cos(a) * rOuter;
      const ay = LY + Math.sin(a) * rOuter;
      const bx = LX + Math.cos(a) * (rOuter - 46);
      const by = LY + Math.sin(a) * (rOuter - 46);
      const alpha = MOTION ? 0.35 + 0.55 * k : 0.85;
      lamp.moveTo(ax, ay).lineTo(bx, by).stroke({ width: 6, color: T.bad, alpha });
      const px = Math.cos(a + Math.PI / 2) * 15;
      const py = Math.sin(a + Math.PI / 2) * 15;
      lamp.moveTo(bx, by).lineTo(bx + px - Math.cos(a) * -16, by + py - Math.sin(a) * -16)
        .stroke({ width: 5, color: T.bad, alpha });
      lamp.moveTo(bx, by).lineTo(bx - px - Math.cos(a) * -16, by - py - Math.sin(a) * -16)
        .stroke({ width: 5, color: T.bad, alpha });
    }

    barFill.clear();
    barFill
      .roundRect(LX - BAR_W / 2 + 2, BAR_Y + 2, Math.max(2, (BAR_W - 4) * frac), 14, 7)
      .fill({ color: frac < 0.25 ? T.bad : frac < 0.55 ? T.gold : T.good });

    if (vignetteAt >= 0) {
      const k = (clock - vignetteAt) / 180;
      vignette.alpha = k >= 1 ? 0 : 0.14 * (1 - k);
      if (k >= 1) vignetteAt = -1;
    }
  }

  /* ---- clock: Pixi ticker only, never Date.now ---- */
  let stepAcc = 0;
  const onTick = (tk: Ticker): void => {
    if (dead) return;
    if (introLeft > 0) {
      // goal card: flame clock frozen, input locked (guards above), Esc still works
      introLeft -= tk.deltaMS;
      if (introLeft <= 0) card.visible = false;
      else unlockTxt.text = `INPUT UNLOCKS IN ${Math.ceil(introLeft / 1000)}…`;
      paint();
      return;
    }
    const dt = tk.deltaMS;
    clock += dt;
    flicker += dt;
    if (clock >= budgetMs) {
      finish({
        correct: null,
        points: neutralPoints(feeds),
        hpDelta,
        summary: 'DAWN CAME FIRST · THE LANTERN STILL BURNS',
      });
      return;
    }

    flame = burn(flame, dt, p.drainPerSec);
    while (draftIdx < drafts.length && drafts[draftIdx].t <= clock) {
      const d = drafts[draftIdx];
      if (draftBlocked(shutter, d)) {
        blocked++;
        flame = clampFlame(flame + BLOCK_REWARD);
      } else {
        snuffed++;
        flame = clampFlame(flame - p.gustCost);
        vignetteAt = clock;
      }
      draftIdx++;
    }
    refreshHud();
    if (flame <= 0) {
      lanternOut(snuffed > 0 ? 'THE DRAFT TOOK IT' : 'THE OIL RAN OUT');
      return;
    }

    // reduced motion: repaint on a 120 ms quantum, identical state, no flicker
    if (!MOTION) {
      stepAcc += dt;
      if (stepAcc < 120) return;
      stepAcc -= 120;
    }
    paint();
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.off('pointermove', onMove);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  renderBoard();
  refreshHud();
  paint();
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed, no timers)   */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  /* --- params ladder --- */
  const p1 = lanternParams(1);
  const p10 = lanternParams(10);
  if (Math.abs(p1.drainPerSec - 4.2) > 1e-9 || Math.abs(p10.drainPerSec - 7.0) > 1e-9) failures.push('drain curve wrong');
  if (p1.warnMs !== 900 || p10.warnMs !== 580) failures.push('warn curve wrong');
  if (p1.gapMs !== 2600 || p10.gapMs !== 1700) failures.push('gap curve wrong');
  if (p1.feints || !p10.feints) failures.push('feint gating wrong');
  if (lanternParams(0).warnMs !== 900 || lanternParams(99).warnMs !== 580) failures.push('params must clamp depth');
  // the warning is never shorter than the half-window a feint needs to be fair
  if (p10.warnMs / 2 < 250) failures.push('feint reveal window below the 250 ms fairness floor');

  /* --- quota ladder --- */
  if (feedQuota(1) !== 2 || feedQuota(4) !== 2 || feedQuota(5) !== 3 || feedQuota(9) !== 4 || feedQuota(40) !== 4) {
    failures.push('feedQuota ladder wrong');
  }

  /* --- shutter geometry --- */
  if (sideFromAngle(0, -100) !== 0) failures.push('north aim wrong');
  if (sideFromAngle(100, 0) !== 1) failures.push('east aim wrong');
  if (sideFromAngle(0, 100) !== 2) failures.push('south aim wrong');
  if (sideFromAngle(-100, 0) !== 3) failures.push('west aim wrong');
  if (sideFromAngle(0, 0) !== 2) failures.push('degenerate aim must not throw the shutter off-board');
  for (let a = 0; a < 360; a += 3) {
    const r = (a * Math.PI) / 180;
    const s = sideFromAngle(Math.cos(r) * 90, Math.sin(r) * 90);
    if (s < 0 || s >= SIDES || !Number.isInteger(s)) failures.push(`aim out of range at ${a} deg`);
  }

  /* --- schedule: determinism, fit, legal sides, seed spread --- */
  for (let seed = 1; seed <= 400; seed++) {
    const depth = 1 + ((seed * 13) % 12);
    const timerLen = 15 + ((seed * 7) % 46);
    const a = buildDrafts(seed, depth, timerLen);
    const b = buildDrafts(seed, depth, timerLen);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      failures.push(`drafts nondeterministic seed=${seed}`);
      break;
    }
    const budget = Math.max(5, timerLen) * 1000 - SETTLE_MS;
    const warn = lanternParams(depth).warnMs;
    if (a.some((d, i) => d.t > budget || d.t < warn || (i > 0 && d.t <= a[i - 1].t))) {
      failures.push(`bad draft times seed=${seed}`);
      break;
    }
    if (a.some((d) => d.side < 0 || d.side >= SIDES || d.finalSide < 0 || d.finalSide >= SIDES)) {
      failures.push(`bad draft side seed=${seed}`);
      break;
    }
    // a feint never jumps to the opposite side — the shutter can always reach it
    if (a.some((d) => d.finalSide !== d.side && (d.finalSide - d.side + SIDES) % SIDES === 2)) {
      failures.push(`feint crossed to the opposite side seed=${seed}`);
      break;
    }
    if (lanternParams(depth).feints === false && a.some((d) => d.finalSide !== d.side)) {
      failures.push(`feint leaked below depth 7 seed=${seed}`);
      break;
    }
  }
  if (buildDrafts(31, 1, 30).length < 6) failures.push('too few drafts at depth 1 / 30 s');
  {
    const variants = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) variants.add(JSON.stringify(buildDrafts(seed, 7, 30)));
    if (variants.size < 10) failures.push(`draft schedule seed-blind: ${variants.size} variants over 300 seeds`);
  }

  /* --- flame arithmetic --- */
  if (burn(50, 1000, 5) !== 45) failures.push('burn rate wrong');
  if (burn(2, 1000, 5) !== 0) failures.push('burn must clamp at zero');
  if (clampFlame(FLAME_MAX + 40) !== FLAME_MAX) failures.push('flame must cap at FLAME_MAX');
  if (draftBlocked(1, { t: 0, side: 3, finalSide: 1 }) !== true) failures.push('block must test the LANDING side');
  if (draftBlocked(3, { t: 0, side: 3, finalSide: 1 }) !== false) failures.push('a feint must beat the telegraphed shutter');

  /* --- solvability rails (the point of the stage) --- */
  for (let seed = 1; seed <= 200; seed++) {
    for (const depth of [1, 5, 9, 12]) {
      // A guard who shutters every draft and answers briskly always reaches quota.
      const good = simulateGuard(seed, depth, 60, { blockAll: true, feedEveryMs: 4500 });
      if (!good.won) failures.push(`perfect guard failed seed=${seed} depth=${depth} died=${good.diedAt}`);
      // Someone who shutters nothing and never answers always loses the lantern.
      const idle = simulateGuard(seed, depth, 60, { blockAll: false, feedEveryMs: 0 });
      if (idle.won || idle.diedAt < 0) failures.push(`idle guard survived seed=${seed} depth=${depth}`);
      // Dawdling (blocking, but answering slowly) must NOT be free at depth.
      if (depth >= 9) {
        const slow = simulateGuard(seed, depth, 60, { blockAll: true, feedEveryMs: 12000 });
        if (slow.won) failures.push(`dawdling won at depth=${depth} seed=${seed}`);
      }
    }
    if (failures.length > 0) break;
  }
  // and the short-timer case still resolves: nothing can outlive the budget
  for (const timerLen of [6, 10, 15, 30, 60, 120]) {
    const d = buildDrafts(99, 6, timerLen);
    const budget = Math.max(5, timerLen) * 1000 - SETTLE_MS;
    if (d.length && d[d.length - 1].t >= budget) failures.push(`draft past budget at timerLen=${timerLen}`);
  }

  /* --- boards --- */
  for (let seed = 1; seed <= 300; seed++) {
    const a = makeBoard(mulberry32(seed));
    const b = makeBoard(mulberry32(seed));
    if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`board nondeterministic seed=${seed}`);
    if (a.opts.length !== OPTS) failures.push(`board size wrong seed=${seed}`);
    if (a.answerIdx < 0 || a.answerIdx >= OPTS) failures.push(`board answer missing seed=${seed}`);
    const keys = new Set(a.opts.map((c) => `${c.kind}:${c.n}`));
    if (keys.size !== OPTS) failures.push(`duplicate option chip seed=${seed}`);
    if (a.opts.some((c) => c.kind < 0 || c.kind >= CHIP_KINDS || c.n < 1)) failures.push(`bad chip seed=${seed}`);
  }
  // Only WRONG picks burn a tile, so the answer tile is always still there —
  // but brute-forcing the board must never be a free strategy: burning every
  // wrong tile costs more than 80 % of a full lantern (before any burn-down).
  if ((OPTS - 1) * SPILL < 0.8 * FLAME_START) failures.push('process-of-elimination is too cheap');
  if ((OPTS - 1) * SPILL_HP < 16) failures.push('process-of-elimination costs too little hp');

  /* --- points curve vs par(d) = 100*d + 40 --- */
  for (let d = 1; d <= 12; d++) {
    const par = parFor(d);
    const lo = winPoints(d, 0, false);
    const hi = winPoints(d, 1, true);
    if (lo < 0.5 * par) failures.push(`win floor ${lo} below band at depth ${d} (par ${par})`);
    if (hi > 1.35 * par) failures.push(`win ceiling ${hi} above band at depth ${d} (par ${par})`);
    if (winPoints(d, 0.5, false) <= lo || hi <= winPoints(d, 1, false)) {
      failures.push(`win payout not monotone in flame/no-snuff at depth ${d}`);
    }
    // stalling is never optimal: the best neutral pays less than the worst win
    const bestNeutral = neutralPoints(feedQuota(d) - 1);
    if (bestNeutral >= lo) failures.push(`neutral ${bestNeutral} not below the worst win ${lo} at depth ${d}`);
  }
  if (neutralPoints(0) !== 0) failures.push('a neutral with no feeds must pay nothing');

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/scenes/takeovers/lanternguard.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/lanternguard.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] LANTERN GUARD OK' : `[selftest] LANTERN GUARD FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
