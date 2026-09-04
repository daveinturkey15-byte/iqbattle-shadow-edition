/**
 * THE POD — takeover stage (NEW; owner spec pair "dolphins (good), sharks
 * (bad)", this is the GOOD side). Not a port: original mechanic built to the
 * v2 contract. Tone shares the water with src/fate/packs/deep-blue.ts but
 * duplicates none of its events — that pack is banners, this is a round.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * REGISTER ME (main.ts / meta/onboard.ts are Main-owned — NOT edited here):
 *   stage id     : 'pod'
 *   display name : 'THE POD'
 *   goal card    : 'STAY INSIDE THE POD AND THEY FERRY THE MARKS UP TO YOU AND
 *                   HEAL YOU WHILE THEY DO IT. BREAK AWAY AND YOU ARE FASTER,
 *                   ALONE, AND COUNTED.'                   (135 ch <= GOAL_MAX)
 *   controls     : 'MOVE TO SWIM · WASD / ARROWS · CLICK A SURFACED TILE OR KEYS 1-6'
 *                                                          (72 ch <= CONTROLS_MAX)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * MECHANIC — the relief round that is still a round.
 * Six marks lie face-down on the seabed; one matches the posted mark. A pod
 * swims a seeded loop through the dark water. Your marker is your body.
 *
 *   INSIDE THE ESCORT (marker within escortR of the pod centre)
 *     · the pod FERRIES one seabed mark up every ferryMs — slow, free, safe;
 *     · exposure DECAYS, so the grey shape outside can never reach you;
 *     · CALM banks +CALM_HP hp every CALM_MS, up to +CALM_MAX for the stage.
 *       This is a genuine heal: hpDelta can finish POSITIVE, and it survives a
 *       timeout, because relief you were given is not taken back.
 *
 *   BROKEN AWAY
 *     · any submerged mark within reachPx of your marker surfaces INSTANTLY —
 *       far faster than the ferry;
 *     · calm resets and exposure RISES; each full point of exposure is one
 *       pass from the grey shape: −PASS_HP and the exposure clock restarts.
 *
 * The seabed row sits provably below the lowest reach of the escort circle
 * (asserted in selfTest), so surfacing a mark by hand ALWAYS means leaving the
 * pod — the fast lane is never free.
 *
 * SOLVABILITY RAIL: the matching mark is always inside the first
 * ANSWER_MAX_SLOT ferry slots, so the pure escort line always delivers the
 * answer, and it fits the shortest engine timer (asserted in selfTest).
 *
 * FAIL STATE: a wrong surfaced mark is absorbed ONCE — the pod pushes you back
 * up for −NUDGE_HP and play continues. The second wrong mark ends the stage.
 *
 * POINTS CURVE vs par(d) = 100*d + 40 (parFor imported from floorfall.ts):
 *   win   = round(par * min(1, 0.45 + 0.55*leftFrac))
 *           [+20 ESCORTED when you never surfaced by hand and took no pass]
 *   fail  = 0 pts, hpDelta - 8   (calm already banked stays banked)
 *   timeout / Esc = neutral (correct:null), 0 pts, hpDelta as banked
 * Breaking away buys leftFrac; staying buys hp and the ESCORTED bonus. Neither
 * line dominates, and no line is stall-optimal: a timeout pays 0 points.
 *
 * Determinism: deck, ferry order, pod path, the grey shape's orbit and the pod
 * formation all come from ctx.seed via an own mulberry32 in FIXED DRAW ORDER
 * (deck, order, path, orbit, formation). No Math.random, no Date.now — the
 * clock is Pixi's shared ticker delta.
 * Self-limits to ctx.timerLen; StageResult settles exactly once via
 * onceResolve; container emptied on done.
 *
 * Fairness rails: motion gated behind IQB_MOTION / prefers-reduced-motion —
 * with motion off the pod and the grey shape advance on a MOTION_STEP_MS
 * lattice in the SIMULATION as well as on screen (podAt/circlerAt take the
 * same stepMs the escort test uses), so what you see is what is measured and
 * every rule, rate and payout is identical. Pass feedback is a 180 ms wash at
 * alpha 0.14 — never a fullscreen strobe. One hue per board from T.boardHues;
 * DNA primitive marks only (no likeness, no scraped art); text >= 12 px;
 * keyboard parity via a virtual marker (WASD / arrows) and keys 1–6; Esc bails
 * NEUTRAL and keeps the hp you were given.
 */
import { Container, Graphics, Rectangle, Sprite, Texture, Ticker } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { Prim } from '../../glyphs.ts';
import type { Chip } from './redlight.ts';
import { CHIP_KINDS, chipPrims, GOAL_MS, mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';
import { cellCanvas, tileCanvas } from '../../glyphs.ts';
import { panel, text, spriteFrom } from '../game.ts';
import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import { parFor } from './floorfall.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested below)                                      */
/* ------------------------------------------------------------------ */

const POD_SALT = 0x0d01f11a;
const SETTLE_MS = 700;

/** hp granted per CALM_MS held inside the escort. */
export const CALM_MS = 1400;
export const CALM_HP = 3;
/** total heal the pod will give in one stage. */
export const CALM_MAX = 15;
/** one pass from the grey shape. */
export const PASS_HP = 9;
/** the pod absorbs the FIRST wrong mark. */
export const NUDGE_HP = 6;
/** the second wrong mark ends it. */
export const WRONG_HP = 8;
/** paid for never surfacing by hand and never taking a pass. */
export const ESCORT_BONUS = 20;
/** the matching mark is never later than this in the ferry order. */
export const ANSWER_MAX_SLOT = 3;
/** reduced-motion lattice — applied to the SIM, not only the paint. */
export const MOTION_STEP_MS = 400;
export const TILES = 6;

/** Swim field: the pod loop is built inside this envelope. */
export const FIELD = {
  cx: 800,
  cy: 350,
  axMin: 240,
  axSpan: 220,
  ayMin: 55,
  aySpan: 55,
} as const;

/** Seabed row geometry — kept below every reachable escort edge. */
export const TILE_ROW_Y = 650;
export const TILE_SIZE = 150;
export const TILE_GAP = 22;

export function tileCentre(i: number): { x: number; y: number } {
  const rowW = TILES * TILE_SIZE + (TILES - 1) * TILE_GAP;
  const ox = (STAGE_W - rowW) / 2;
  return { x: ox + i * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2, y: TILE_ROW_Y + TILE_SIZE / 2 };
}

export function podParams(depth: number): {
  ferryMs: number;
  riseMs: number;
  decayMs: number;
  escortR: number;
  reachPx: number;
} {
  const d = Math.max(1, Math.min(20, Math.floor(depth)));
  return {
    ferryMs: Math.min(2600, 1600 + 90 * d),
    riseMs: Math.max(1700, 3000 - 90 * d),
    decayMs: 1800,
    escortR: Math.max(130, 172 - 3 * d),
    reachPx: 110,
  };
}

export interface PodPath {
  ax: number;
  ay: number;
  ox: number;
  oy: number;
  wx: number;
  wy: number;
  ph: number;
}

export interface PodOrbit {
  rx: number;
  ry: number;
  cx: number;
  cy: number;
  omega: number;
  phase: number;
}

export interface PodBuild {
  deck: Chip[];
  answerIdx: number;
  /** ferry order — a permutation of 0..TILES-1, answer inside ANSWER_MAX_SLOT */
  order: number[];
  path: PodPath;
  orbit: PodOrbit;
  members: Array<{ dx: number; dy: number; face: number }>;
}

/**
 * stepMs > 0 quantizes time onto a lattice. The scene feeds the SAME stepMs to
 * the escort test that it feeds to the paint, so reduced motion changes what
 * moves, never what counts.
 */
export function podAt(tMs: number, p: PodPath, stepMs = 0): { x: number; y: number } {
  const t = (stepMs > 0 ? Math.floor(tMs / stepMs) * stepMs : tMs) / 1000;
  return { x: p.ox + p.ax * Math.sin(p.wx * t + p.ph), y: p.oy + p.ay * Math.sin(p.wy * t) };
}

export function circlerAt(tMs: number, o: PodOrbit, stepMs = 0): { x: number; y: number; a: number } {
  const t = (stepMs > 0 ? Math.floor(tMs / stepMs) * stepMs : tMs) / 1000;
  const a = o.phase + o.omega * t;
  return { x: o.cx + o.rx * Math.cos(a), y: o.cy + o.ry * Math.sin(a), a };
}

/** Exposure in [0, 1.5]. 1.0 = the grey shape makes a pass. */
export function exposureStep(
  inEscort: boolean,
  exposure: number,
  dtMs: number,
  riseMs: number,
  decayMs: number,
): number {
  const next = inEscort ? exposure - dtMs / decayMs : exposure + dtMs / riseMs;
  return Math.max(0, Math.min(1.5, next));
}

/** Calm only banks while escorted, and breaking away drops the partial. */
export function calmStep(
  inEscort: boolean,
  acc: number,
  dtMs: number,
  calmMs: number,
): { acc: number; heal: number } {
  if (!inEscort) return { acc: 0, heal: 0 };
  let a = acc + dtMs;
  let heal = 0;
  while (a >= calmMs) {
    a -= calmMs;
    heal += CALM_HP;
  }
  return { acc: a, heal };
}

export function scorePod(depth: number, leftFrac: number, escorted: boolean): number {
  const lf = Math.max(0, Math.min(1, leftFrac));
  const base = Math.round(parFor(depth) * Math.min(1, 0.45 + 0.55 * lf));
  return Math.max(0, base + (escorted ? ESCORT_BONUS : 0));
}

const chipKey = (c: Chip): string => `${c.kind}:${c.n}`;

/**
 * Seeded build — FIXED DRAW ORDER (do not reorder):
 *   deck fill, deck shuffle, ferry-order shuffle, answer rescue slot,
 *   path (ax, ay, wx, wy, ph), orbit (rx, ry, omega, phase),
 *   formation (dx, dy, face) per pod member.
 */
export function buildPod(seed: number, depth: number): PodBuild {
  const rng = mulberry32((seed ^ POD_SALT) >>> 0);
  void depth; // difficulty lives in podParams; the board is depth-blind by design

  const answer: Chip = { kind: Math.floor(rng() * CHIP_KINDS), n: 2 + Math.floor(rng() * 6) };
  const deck: Chip[] = [{ ...answer }];
  while (deck.length < TILES) {
    const c: Chip = { kind: Math.floor(rng() * CHIP_KINDS), n: 2 + Math.floor(rng() * 6) };
    if (!deck.some((o) => chipKey(o) === chipKey(c))) deck.push(c);
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const answerIdx = deck.findIndex((c) => chipKey(c) === chipKey(answer));

  const order: number[] = [];
  for (let i = 0; i < TILES; i++) order.push(i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  // SOLVABILITY RAIL: the escort line must always be able to deliver the answer
  const rescue = Math.floor(rng() * ANSWER_MAX_SLOT); // drawn unconditionally
  const at = order.indexOf(answerIdx);
  if (at >= ANSWER_MAX_SLOT) {
    [order[at], order[rescue]] = [order[rescue], order[at]];
  }

  const path: PodPath = {
    ax: FIELD.axMin + rng() * FIELD.axSpan,
    ay: FIELD.ayMin + rng() * FIELD.aySpan,
    ox: FIELD.cx,
    oy: FIELD.cy,
    wx: 0.3 + rng() * 0.3,
    wy: 0.45 + rng() * 0.45,
    ph: rng() * Math.PI * 2,
  };

  const orbit: PodOrbit = {
    rx: 520 + rng() * 80,
    ry: 230 + rng() * 60,
    cx: FIELD.cx,
    cy: FIELD.cy,
    omega: 0.45 + rng() * 0.35,
    phase: rng() * Math.PI * 2,
  };

  const members: Array<{ dx: number; dy: number; face: number }> = [];
  for (let i = 0; i < 5; i++) {
    members.push({
      dx: (rng() - 0.5) * 160,
      dy: (rng() - 0.5) * 92,
      face: rng() < 0.5 ? -1 : 1,
    });
  }

  return { deck, answerIdx, order, path, orbit, members };
}

/** A pod member, in DNA primitives (100x100 cell space). Parody, no likeness. */
export function dolphinPrims(): Prim[] {
  return [
    { k: 'diamond', x: 50, y: 52, s: 15 },
    { k: 'line', x1: 63, y1: 47, x2: 86, y2: 41 },
    { k: 'line', x1: 50, y1: 37, x2: 43, y2: 21 },
    { k: 'line', x1: 43, y1: 21, x2: 57, y2: 35 },
    { k: 'line', x1: 35, y1: 56, x2: 14, y2: 43 },
    { k: 'line', x1: 35, y1: 56, x2: 14, y2: 69 },
    { k: 'dot', x: 67, y: 46, r: 3 },
  ];
}

/** The thing that circles. Never named, never a likeness — an outline and a count. */
export function circlerPrims(): Prim[] {
  return [
    { k: 'tri', x: 50, y: 44, s: 22 },
    { k: 'line', x1: 28, y1: 62, x2: 72, y2: 62 },
    { k: 'line', x1: 50, y1: 62, x2: 50, y2: 78 },
    { k: 'dot', x: 50, y: 30, r: 3 },
  ];
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

const KB_STEP = 46;
const FLASH_MS = 180;
const HINT_MS = 1400;

function motionOn(): boolean {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('IQB_MOTION') === '0') return false;
  } catch { /* gate optional */ }
  try {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  } catch { /* gate optional */ }
  return true;
}

function bar(v: number, n = 6): string {
  const k = Math.max(0, Math.min(n, Math.round(v * n)));
  return '▮'.repeat(k) + '▯'.repeat(n - k);
}

export function mountPod(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const motion = motionOn();
  const stepMs = motion ? 0 : MOTION_STEP_MS;
  const depth = Math.max(1, Math.floor(ctx.depth));
  const hue = T.boardHues[ctx.seed % T.boardHues.length];
  const settle = onceResolve(ctx.onDone);
  const p = podParams(depth);
  const build = buildPod(ctx.seed, depth);

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  const left = panel(root, 40, 30, 360, 200);
  text(left, 'THE POD', 24, 16, 26, T.gold, true);
  text(left, 'MATCH THIS MARK', 24, 52, 13, T.muted);
  const tgtChip = build.deck[build.answerIdx];
  const tgt = spriteFrom(tileCanvas(chipPrims(tgtChip.kind, tgtChip.n), hue, 120));
  tgt.x = 208;
  tgt.y = 62;
  left.addChild(tgt);
  text(left, 'THE WATER IS WARM', 24, 88, 13, T.good);
  text(left, 'INSIDE THE POD.', 24, 108, 13, T.good);
  text(left, 'OUTSIDE, YOU ARE', 24, 138, 13, T.muted);
  text(left, 'BEING COUNTED.', 24, 158, 13, T.muted);

  const right = panel(root, STAGE_W - 400, 30, 360, 200);
  const hudCalm = text(right, '', 24, 22, 14, T.good, true);
  const hudExp = text(right, '', 24, 62, 14, T.muted, true);
  const hudHp = text(right, '', 24, 102, 16, T.ink, true);
  const hudFerry = text(right, '', 24, 142, 13, T.muted);

  const waterLayer = new Container();
  root.addChild(waterLayer);
  const escortRing = new Graphics();
  waterLayer.addChild(escortRing);

  /* ---- pod + the grey shape ---- */
  const podLayer = new Container();
  waterLayer.addChild(podLayer);
  const podSprites = build.members.map((m) => {
    const s = spriteFrom(cellCanvas(dolphinPrims(), hue, 74));
    s.anchor.set(0.5);
    s.scale.x = m.face;
    podLayer.addChild(s);
    return s;
  });
  const circler = spriteFrom(cellCanvas(circlerPrims(), T.muted, 66));
  circler.anchor.set(0.5);
  circler.alpha = 0.2;
  waterLayer.addChild(circler);

  const marker = new Graphics();
  marker.circle(0, 0, 11).stroke({ width: 2, color: T.ink });
  marker.circle(0, 0, 3).fill({ color: T.ink });
  waterLayer.addChild(marker);

  /* ---- seabed marks ---- */
  const holeSprites: Sprite[] = [];
  const chipSprites: Sprite[] = [];
  build.deck.forEach((chip, i) => {
    const c = tileCentre(i);
    const hole = spriteFrom(tileCanvas([], hue, TILE_SIZE, { hole: true }));
    hole.x = c.x - TILE_SIZE / 2;
    hole.y = c.y - TILE_SIZE / 2;
    hole.alpha = 0.5;
    hole.eventMode = 'static';
    hole.cursor = 'pointer';
    hole.on('pointerdown', () => pick(i));
    root.addChild(hole);
    holeSprites.push(hole);

    const spr = spriteFrom(tileCanvas(chipPrims(chip.kind, chip.n), hue, TILE_SIZE));
    spr.x = hole.x;
    spr.y = hole.y;
    spr.visible = false;
    spr.eventMode = 'static';
    spr.cursor = 'pointer';
    spr.on('pointerdown', () => pick(i));
    root.addChild(spr);
    chipSprites.push(spr);

    text(root, String(i + 1), hole.x + 8, hole.y + TILE_SIZE - 24, 13, T.muted);
  });

  const vignette = new Sprite(Texture.WHITE);
  vignette.width = STAGE_W;
  vignette.height = STAGE_H;
  vignette.tint = 0xff2e88;
  vignette.alpha = 0;
  root.addChild(vignette);

  const status = text(root, '', 60, 816, 17, T.ink, true);
  const hint = text(root, '', 60, 848, 13, T.good);
  text(
    root,
    'MOVE TO SWIM · WASD / ARROWS · CLICK A SURFACED MARK OR KEYS 1–6 · ESC BAILS NEUTRAL',
    STAGE_W / 2 - 310,
    848,
    13,
    T.muted,
  );

  /* ---- goal card (first GOAL_MS: input locked, clock frozen) ----
   * Mirrors the onboard goal card requested at the top of this file. */
  const GOAL_W = 640;
  const goalCard = panel(root, (STAGE_W - GOAL_W) / 2, 300, GOAL_W, 196);
  text(goalCard, 'THE POD', 28, 20, 26, T.gold, true);
  text(goalCard, 'STAY WITH THEM: THEY FERRY THE MARKS UP AND HEAL YOU.', 28, 62, 15, T.ink);
  text(goalCard, 'BREAK AWAY: FASTER, ALONE, AND COUNTED.', 28, 92, 14, T.muted);
  text(goalCard, 'MOVE TO SWIM · KEYS 1–6 PICK · ESC BAILS NEUTRAL', 28, 122, 13, T.muted);
  const unlockTxt = text(goalCard, 'INPUT UNLOCKS IN 2…', 28, 154, 14, T.good, true);

  /* ---- state ---- */
  const budgetMs = Math.max(6000, ctx.timerLen * 1000 - GOAL_MS) - SETTLE_MS;
  let clock = 0;
  let introLeft = GOAL_MS;
  let hpDelta = 0;
  let healed = 0;
  let calmAcc = 0;
  let exposure = 0;
  let ferryAcc = 0;
  let ferryPtr = 0;
  let passes = 0;
  let handSurfaced = 0;
  let nudged = false;
  let dead = false;
  let hintLeft = 0;
  let vignetteAt = -1;
  const surfaced: boolean[] = build.deck.map(() => false);

  let cursor: { x: number; y: number } | null = null;
  let kbCursor: { x: number; y: number } | null = null;
  const effMarker = (): { x: number; y: number } => kbCursor ?? cursor ?? { x: FIELD.cx, y: FIELD.cy };

  function say(msg: string, good = true): void {
    hint.text = msg;
    hint.style.fill = good ? T.good : T.bad;
    hintLeft = HINT_MS;
  }

  function finish(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function surface(i: number, byHand: boolean): void {
    if (surfaced[i]) return;
    surfaced[i] = true;
    holeSprites[i].visible = false;
    chipSprites[i].visible = true;
    if (byHand) handSurfaced++;
  }

  function pick(i: number): void {
    if (dead || introLeft > 0) return;
    if (!surfaced[i]) {
      say('THAT MARK IS STILL UNDER — LET THEM BRING IT UP', false);
      return;
    }
    const leftFrac = Math.max(0, Math.min(1, (budgetMs - clock) / budgetMs));
    if (i === build.answerIdx) {
      const escorted = handSurfaced === 0 && passes === 0;
      finish({
        correct: true,
        points: scorePod(depth, leftFrac, escorted),
        hpDelta,
        summary: escorted ? 'CARRIED HOME BY THE POD' : 'YOU SWAM FOR IT AND MADE IT',
      });
      return;
    }
    if (!nudged) {
      nudged = true;
      hpDelta -= NUDGE_HP;
      say('THE POD NUDGES YOU BACK UP — ONE MORE MISS ENDS IT', false);
      return;
    }
    finish({
      correct: false,
      points: 0,
      hpDelta: hpDelta - WRONG_HP,
      summary: 'THE POD MOVED ON WITHOUT YOU',
    });
  }

  /* ---- input ---- */
  root.eventMode = 'static';
  root.hitArea = new Rectangle(0, 0, STAGE_W, STAGE_H);
  const onMove = (e: FederatedPointerEvent): void => {
    cursor = { x: e.global.x, y: e.global.y };
    kbCursor = null;
  };
  root.on('pointermove', onMove);

  function nudge(dx: number, dy: number): void {
    const c = kbCursor ?? cursor ?? { x: FIELD.cx, y: FIELD.cy };
    kbCursor = {
      x: Math.max(0, Math.min(STAGE_W, c.x + dx)),
      y: Math.max(0, Math.min(STAGE_H, c.y + dy)),
    };
  }

  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      finish(escaped(hpDelta, 'YOU LET THE WATER CLOSE OVER IT'));
      return;
    }
    if (introLeft > 0) return;
    switch (e.key) {
      case 'w': case 'W': case 'ArrowUp': nudge(0, -KB_STEP); return;
      case 's': case 'S': case 'ArrowDown': nudge(0, KB_STEP); return;
      case 'a': case 'A': case 'ArrowLeft': nudge(-KB_STEP, 0); return;
      case 'd': case 'D': case 'ArrowRight': nudge(KB_STEP, 0); return;
    }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= TILES) pick(n - 1);
  }
  window.addEventListener('keydown', onKey);

  /* ---- paint ---- */
  function paint(pod: { x: number; y: number }, inEscort: boolean): void {
    escortRing.clear();
    escortRing
      .circle(pod.x, pod.y, p.escortR)
      .stroke({ width: 2, color: inEscort ? T.good : T.muted, alpha: inEscort ? 0.55 : 0.25 });
    build.members.forEach((m, i) => {
      podSprites[i].x = pod.x + m.dx;
      podSprites[i].y = pod.y + m.dy;
    });
    const c = circlerAt(clock, build.orbit, stepMs);
    circler.x = c.x;
    circler.y = c.y;
    circler.rotation = c.a + Math.PI / 2;
    circler.alpha = 0.16 + 0.6 * Math.min(1, exposure);
    const m = effMarker();
    marker.x = m.x;
    marker.y = m.y;
    marker.alpha = inEscort ? 0.85 : 0.45;
    if (vignetteAt >= 0) {
      const k = (clock - vignetteAt) / FLASH_MS;
      vignette.alpha = k >= 1 ? 0 : 0.14 * (1 - k);
      if (k >= 1) vignetteAt = -1;
    }
  }

  function refreshHud(): void {
    hudCalm.text = `CALM  ${bar(healed / CALM_MAX, 5)}  +${healed} HP`;
    hudExp.text = `EXPOSURE  ${bar(Math.min(1, exposure), 5)}`;
    hudExp.style.fill = exposure > 0.6 ? T.bad : T.muted;
    hudHp.text = `HP ${hpDelta >= 0 ? '+' : ''}${hpDelta}`;
    hudHp.style.fill = hpDelta < 0 ? T.bad : T.good;
    const up = surfaced.filter(Boolean).length;
    hudFerry.text = `MARKS UP ${up}/${TILES} · PASSES ${passes}`;
  }

  /* ---- clock: Pixi ticker only, never Date.now ---- */
  const onTick = (tk: Ticker): void => {
    if (dead) return;
    const dt = tk.deltaMS;
    if (introLeft > 0) {
      introLeft -= dt;
      if (introLeft <= 0) goalCard.visible = false;
      else unlockTxt.text = `INPUT UNLOCKS IN ${Math.ceil(introLeft / 1000)}…`;
      paint(podAt(0, build.path, stepMs), false);
      refreshHud();
      return;
    }
    clock += dt;
    if (clock >= budgetMs) {
      finish(escaped(hpDelta, 'THE POD SWAM ON. THE WATER KEPT THE REST.'));
      return;
    }
    if (hintLeft > 0) {
      hintLeft -= dt;
      if (hintLeft <= 0) hint.text = '';
    }

    // the escort test reads the SAME quantized position the player sees
    const pod = podAt(clock, build.path, stepMs);
    const m = effMarker();
    const inEscort = Math.hypot(m.x - pod.x, m.y - pod.y) <= p.escortR;

    // relief: calm heals, capped for the stage
    const cs = calmStep(inEscort, calmAcc, dt, CALM_MS);
    calmAcc = cs.acc;
    if (cs.heal > 0 && healed < CALM_MAX) {
      const add = Math.min(cs.heal, CALM_MAX - healed);
      healed += add;
      hpDelta += add;
      say(`THE POD BREATHES WITH YOU — +${add} HP`);
    }

    // risk: exposure only accrues outside the escort
    exposure = exposureStep(inEscort, exposure, dt, p.riseMs, p.decayMs);
    if (exposure >= 1) {
      exposure = 0;
      passes++;
      hpDelta -= PASS_HP;
      vignetteAt = clock;
      say(`THE GREY SHAPE MADE A PASS — ${PASS_HP} HP`, false);
    }

    // slow lane: the pod ferries marks up while you stay with it
    if (inEscort) {
      ferryAcc += dt;
      for (;;) {
        while (ferryPtr < TILES && surfaced[build.order[ferryPtr]]) ferryPtr++;
        if (ferryPtr >= TILES || ferryAcc < p.ferryMs) break;
        ferryAcc -= p.ferryMs;
        surface(build.order[ferryPtr++], false);
      }
      if (ferryPtr >= TILES) ferryAcc = 0;
    }

    // fast lane: reach a mark yourself (the row is always outside the escort)
    for (let i = 0; i < TILES; i++) {
      if (surfaced[i]) continue;
      const c = tileCentre(i);
      if (Math.hypot(m.x - c.x, m.y - c.y) <= p.reachPx) surface(i, true);
    }

    const escorted = handSurfaced === 0 && passes === 0;
    status.text = inEscort
      ? `WITH THE POD${escorted ? ' · ESCORTED (+' + ESCORT_BONUS + ')' : ''}`
      : 'BROKEN AWAY — SOMETHING IS COUNTING YOUR STROKES';
    status.style.fill = inEscort ? T.good : T.bad;

    paint(pod, inEscort);
    refreshHud();
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.off('pointermove', onMove);
    root.removeChildren().forEach((c: Container) => c.destroy({ children: true }));
  }

  paint(podAt(0, build.path, stepMs), false);
  refreshHud();
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const key = (c: Chip): string => `${c.kind}:${c.n}`;

  /* ---- params: banded, monotone, clamped ---- */
  for (let d = 1; d <= 25; d++) {
    const p = podParams(d);
    if (p.ferryMs < 1600 || p.ferryMs > 2600) failures.push(`ferryMs out of band at depth ${d}`);
    if (p.riseMs < 1700 || p.riseMs > 3000) failures.push(`riseMs out of band at depth ${d}`);
    if (p.escortR < 130 || p.escortR > 172) failures.push(`escortR out of band at depth ${d}`);
    if (d > 1) {
      const q = podParams(d - 1);
      if (p.ferryMs < q.ferryMs) failures.push(`ferry must not speed up with depth (${d})`);
      if (p.riseMs > q.riseMs) failures.push(`exposure must not slow down with depth (${d})`);
      if (p.escortR > q.escortR) failures.push(`escort must not widen with depth (${d})`);
    }
  }
  if (podParams(0).ferryMs !== podParams(1).ferryMs || podParams(-9).escortR !== podParams(1).escortR) {
    failures.push('depth clamp broken');
  }

  /* ---- SOLVABILITY: the pure escort line fits the shortest engine timer ---- */
  for (let d = 1; d <= 20; d++) {
    const need = podParams(d).ferryMs * ANSWER_MAX_SLOT + GOAL_MS + SETTLE_MS;
    if (need > 15000) failures.push(`escort-only win needs ${need} ms at depth ${d} — over a 15 s round`);
  }

  /* ---- GEOMETRY: the seabed row is always outside the escort ---- */
  {
    const maxPodY = FIELD.cy + FIELD.ayMin + FIELD.aySpan;
    const minPodY = FIELD.cy - (FIELD.ayMin + FIELD.aySpan);
    const maxPodX = FIELD.cx + FIELD.axMin + FIELD.axSpan;
    const minPodX = FIELD.cx - (FIELD.axMin + FIELD.axSpan);
    const rMax = podParams(1).escortR;
    const rowTop = tileCentre(0).y - TILE_SIZE / 2;
    if (maxPodY + rMax >= rowTop) {
      failures.push(`escort can reach the seabed row (${maxPodY + rMax} >= ${rowTop}) — hand-surfacing would be free`);
    }
    if (minPodY - rMax < 0 || maxPodY + rMax > STAGE_H) failures.push('escort circle leaves the stage vertically');
    if (minPodX - rMax < 0 || maxPodX + rMax > STAGE_W) failures.push('escort circle leaves the stage horizontally');
    for (let i = 0; i < TILES; i++) {
      const c = tileCentre(i);
      if (c.x - TILE_SIZE / 2 < 0 || c.x + TILE_SIZE / 2 > STAGE_W) failures.push(`tile ${i} off stage`);
      if (c.y + TILE_SIZE / 2 > STAGE_H) failures.push(`tile ${i} below the stage`);
    }
  }

  /* ---- build: deterministic, well formed, always deliverable ---- */
  const slotHits = [0, 0, 0];
  for (let seed = 1; seed <= 500; seed++) {
    const depth = 1 + ((seed * 11) % 16);
    const a = buildPod(seed, depth);
    const b = buildPod(seed, depth);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      failures.push(`build nondeterministic seed=${seed}`);
      break;
    }
    if (a.deck.length !== TILES || new Set(a.deck.map(key)).size !== TILES) {
      failures.push(`seed=${seed}: deck must be ${TILES} distinct chips`);
      break;
    }
    if (a.deck.some((c) => c.kind < 0 || c.kind >= CHIP_KINDS || c.n < 2 || c.n > 7)) {
      failures.push(`seed=${seed}: chip out of range`);
      break;
    }
    if (a.answerIdx < 0 || a.answerIdx >= TILES) {
      failures.push(`seed=${seed}: answerIdx invalid`);
      break;
    }
    if (a.order.length !== TILES || new Set(a.order).size !== TILES || a.order.some((i) => i < 0 || i >= TILES)) {
      failures.push(`seed=${seed}: ferry order is not a permutation`);
      break;
    }
    const at = a.order.indexOf(a.answerIdx);
    if (at < 0 || at >= ANSWER_MAX_SLOT) {
      failures.push(`seed=${seed}: answer ferries at slot ${at}, past the ${ANSWER_MAX_SLOT}-slot rail`);
      break;
    }
    slotHits[at]++;
    // path and orbit stay inside the field envelope for all time
    for (let t = 0; t <= 60000; t += 137) {
      const pos = podAt(t, a.path);
      if (Math.abs(pos.x - FIELD.cx) > FIELD.axMin + FIELD.axSpan + 1e-9) {
        failures.push(`seed=${seed}: pod path leaves the x envelope`);
        break;
      }
      if (Math.abs(pos.y - FIELD.cy) > FIELD.ayMin + FIELD.aySpan + 1e-9) {
        failures.push(`seed=${seed}: pod path leaves the y envelope`);
        break;
      }
      const q = podAt(t, a.path, MOTION_STEP_MS);
      const ref = podAt(Math.floor(t / MOTION_STEP_MS) * MOTION_STEP_MS, a.path);
      if (Math.abs(q.x - ref.x) > 1e-12 || Math.abs(q.y - ref.y) > 1e-12) {
        failures.push(`seed=${seed}: reduced-motion lattice does not track the live path`);
        break;
      }
      const cc = circlerAt(t, a.orbit);
      if (cc.x < 0 || cc.x > STAGE_W || cc.y < 0 || cc.y > STAGE_H) {
        failures.push(`seed=${seed}: the circler leaves the stage`);
        break;
      }
    }
    if (failures.length > 0) break;
  }
  if (slotHits.some((n) => n === 0)) failures.push(`ferry slot never used: ${slotHits.join('/')}`);

  /* ---- exposure: rises only outside, decays inside, clamped ---- */
  {
    const p = podParams(5);
    let e = 0;
    let ms = 0;
    while (e < 1 && ms < 20000) {
      e = exposureStep(false, e, 16, p.riseMs, p.decayMs);
      ms += 16;
    }
    if (e < 1) failures.push('exposure never reaches a pass outside the escort');
    if (Math.abs(ms - p.riseMs) > 32) failures.push(`exposure takes ${ms} ms to build, expected ~${p.riseMs}`);
    // inside the escort it can never build, however long you sit there
    let held = 0;
    for (let t = 0; t < 120000; t += 16) held = exposureStep(true, held, 16, p.riseMs, p.decayMs);
    if (held !== 0) failures.push('escorted exposure must settle at zero');
    let decaying = 1.0;
    let dms = 0;
    while (decaying > 0 && dms < 20000) {
      decaying = exposureStep(true, decaying, 16, p.riseMs, p.decayMs);
      dms += 16;
    }
    if (Math.abs(dms - p.decayMs) > 32) failures.push(`exposure decay ${dms} ms, expected ~${p.decayMs}`);
    if (exposureStep(false, 1.5, 5000, p.riseMs, p.decayMs) !== 1.5) failures.push('exposure not clamped high');
    if (exposureStep(true, 0, 5000, p.riseMs, p.decayMs) !== 0) failures.push('exposure not clamped low');
  }

  /* ---- calm: heals only while escorted, cap is exactly reachable ---- */
  {
    if (CALM_HP * 5 !== CALM_MAX) failures.push('CALM_MAX is not a whole number of calm ticks');
    const out = calmStep(false, 1399, 16, CALM_MS);
    if (out.acc !== 0 || out.heal !== 0) failures.push('breaking away must drop partial calm and heal nothing');
    let acc = 0;
    let heal = 0;
    for (let t = 0; t < 7000; t += 16) {
      const r = calmStep(true, acc, 16, CALM_MS);
      acc = r.acc;
      heal += r.heal;
    }
    if (heal !== CALM_HP * Math.floor(7000 / CALM_MS)) failures.push(`calm heal wrong over 7 s: ${heal}`);
    if (heal < CALM_MAX) failures.push(`the pod cannot reach its own +${CALM_MAX} cap in 7 s of escort`);
    const big = calmStep(true, 0, CALM_MS * 3 + 5, CALM_MS);
    if (big.heal !== CALM_HP * 3 || Math.abs(big.acc - 5) > 1e-9) failures.push('calm does not catch up on a long frame');
    // RELIEF RAIL: a clean escort run finishes better off than it started
    if (CALM_MAX <= 0) failures.push('the good-aligned stage must be able to heal');
  }

  /* ---- points curve vs par(d) = 100*d + 40 ---- */
  for (let d = 1; d <= 12; d++) {
    const par = parFor(d);
    if (par !== 100 * d + 40) failures.push('parFor drifted from 100*d + 40');
    const best = scorePod(d, 1, true);
    const rushed = scorePod(d, 1, false);
    const slow = scorePod(d, 0, true);
    if (best > 1.35 * par) failures.push(`best win ${best} above 135 % of par ${par} at depth ${d}`);
    if (best <= rushed) failures.push('ESCORTED bonus not applied');
    if (best - rushed !== ESCORT_BONUS) failures.push('ESCORTED bonus is not ESCORT_BONUS');
    if (slow <= 0) failures.push('a slow escorted win must still beat a timeout');
    if (slow < 0.4 * par) failures.push(`slow escorted win ${slow} below 40 % of par ${par}`);
    // the two lines are genuinely competing: neither dominates at every clock
    if (scorePod(d, 1, false) <= scorePod(d, 0.35, true)) {
      failures.push(`breaking away never pays at depth ${d} — the fast lane is dead weight`);
    }
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const v = scorePod(d, i / 20, false);
      if (v < prev) failures.push(`payout not monotone in leftFrac at depth ${d}`);
      prev = v;
    }
    if (scorePod(d, -2, false) !== scorePod(d, 0, false)) failures.push('leftFrac not clamped low');
    if (scorePod(d, 7, false) !== scorePod(d, 1, false)) failures.push('leftFrac not clamped high');
  }

  /* ---- marks are DNA primitives only ---- */
  {
    const okKinds = new Set(['tri', 'dot', 'diamond', 'line']);
    if (dolphinPrims().some((p) => !okKinds.has(p.k))) failures.push('dolphinPrims uses a non-DNA primitive');
    if (circlerPrims().some((p) => !okKinds.has(p.k))) failures.push('circlerPrims uses a non-DNA primitive');
    if (dolphinPrims().length < 5 || circlerPrims().length < 3) failures.push('pod marks too sparse to read');
  }

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/scenes/takeovers/pod.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/pod.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] THE POD OK' : `[selftest] THE POD FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
