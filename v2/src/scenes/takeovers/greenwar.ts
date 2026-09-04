/**
 * THE GREEN WAR — takeover scene. Jungle-war ATMOSPHERE only: heat, monsoon,
 * film grain, a tree line, a rotor going somewhere else, and a great deal of
 * waiting. No real conflict, place, unit, weapon or person is named or shown,
 * nothing is killed, and nothing here is celebratory. Tone borrowed from
 * src/fate/packs/nam.ts; none of its lines are reused.
 *
 * ================= WIRING REQUEST (Main-owned files, untouched by me) =======
 *   main.ts      TAKEOVERS   += mountGreenWar
 *                TAKEOVER_NAMES += 'THE GREEN WAR'
 *   onboard.ts   TAKEOVER_STAGE_IDS += 'green-war'
 *                CARDS['green-war'] = {
 *                  stageId: 'green-war',
 *                  title:   'THE GREEN WAR',
 *                  goal:    'A FLARE SHOWS THE MARK. THE RAIN HIDES THE TREE LINE. HOLD THE MARK IN YOUR HEAD UNTIL A LULL LETS YOU ANSWER.',
 *                  controls:'CLICK / TAP · KEYS 1–8 · ESC BAILS NEUTRAL',
 *                }
 * ===========================================================================
 *
 * THE ONE IDEA: the wait. Two things you need are never available at once.
 *   · FLARES (buildFlares) light the MARK you have to match — briefly.
 *   · LULLS in the monsoon (buildWeather) are the only moments the tree line
 *     is legible enough to answer in.
 * Between them the veil goes up and the option tiles go INERT — you are not
 * punished for answering blind, you simply cannot. So you hold the mark in
 * your head through the rain and wait, and the round's whole cost is time.
 *
 * Ends: right tile in a lull -> READ · wrong tile -> MISREAD (fail)
 *       budget elapses -> neutral · Esc -> escaped(0, ...)
 *
 * POINTS CURVE vs par(d) = 100*d + 40 (parFor imported from floorfall.ts):
 *   read    = round(par * min(1, 0.62 + 0.38 * leftFrac)) [+25 STILL, +5 hp
 *             when you never once grabbed at the veil]
 *   misread = 0 pts, hpDelta - 10
 *   timeout = neutral, 0 pts, hpDelta - 3 · Esc = escaped(0, ...)
 *
 * SOLVABILITY RAIL (asserted over 600 seed/depth pairs in selfTest()):
 *   every round contains at least one flare followed by a lull whose readable
 *   stretch is >= MIN_READ_MS and lands inside the play budget — the wait is
 *   always long enough to end, and never longer than the round.
 *
 * Determinism: weather bands, flare times and the tree line are pure
 * functions of ctx.seed through an own mulberry32 in FIXED DRAW ORDER. Zero
 * Math.random, zero Date.now — the clock is Pixi's shared ticker delta.
 * Self-limits to ctx.timerLen; StageResult settles exactly once via
 * onceResolve; the container is emptied on done.
 *
 * Fairness rails: no flash of any kind — the flare RAMPS over 200 ms and the
 * veil is a steady alpha, so there is nothing to strobe; one hue per board
 * from T.boardHues; DNA primitive marks only; all text >= 11 px; keys 1–8
 * carry the same inert-during-rain rule as the pointer, so parity is exact.
 * IQB_MOTION=0 / prefers-reduced-motion: the rain is a STATIC hatch and the
 * veil steps in 10 % rungs — the weather schedule, the read floor, the flares
 * and the scoring are byte-identical.
 */
import { Graphics, Sprite, Texture, Ticker } from 'pixi.js';
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

const GW_SALT = 0x67772a12;
const FLARE_SALT = 0xf1a4e5;
const TREE_SALT = 0x7e3115;
const SETTLE_MS = 700;

export const OPTS = 8;
/** Visibility at which the tree line becomes legible — and answerable. */
export const READ_FLOOR = 0.55;
/** A lull only counts as usable if it stays readable this long. */
export const MIN_READ_MS = 700;
export const SQUALL_VIS = 0.12;
export const LULL_VIS = 0.95;
/** Weather ramps in and out over this — long enough that nothing strobes. */
export const VIS_RAMP_MS = 350;
export const STILL_BONUS = 25;
export const MISREAD_HP = 10;
export const TIMEOUT_HP = 3;
export const STILL_HP = 5;

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Fraction of the ramp you must climb before the line is legible. */
const READ_K = (READ_FLOOR - SQUALL_VIS) / (LULL_VIS - SQUALL_VIS);
/** Ms of ramp spent below the read floor at each end of a lull. */
export const RAMP_BLIND_MS = READ_K * VIS_RAMP_MS;

/** How long the rain holds off: 2.6 s -> 1.5 s by depth (before jitter). */
export function lullMsFor(depth: number): number {
  return clamp(2600 - 110 * (Math.max(1, Math.floor(depth)) - 1), 1500, 2600);
}
/** How long it comes down for: 1.8 s -> 3.6 s by depth (before jitter). */
export function squallMsFor(depth: number): number {
  return clamp(1800 + 130 * (Math.max(1, Math.floor(depth)) - 1), 1800, 3600);
}
/** How long a flare burns: 1.7 s -> 1.1 s by depth. */
export function flareMsFor(depth: number): number {
  return clamp(1700 - 70 * (Math.max(1, Math.floor(depth)) - 1), 1100, 1700);
}

export interface Band {
  t0: number;
  t1: number;
  lull: boolean;
}

/** Every lull is long enough to ramp up, be read, and ramp back down. */
const MIN_LULL_MS = 2 * VIS_RAMP_MS + MIN_READ_MS;

/**
 * Seeded monsoon. Bands tile [0, budget) exactly — no gaps, no overlaps —
 * opening on a short squall so the round starts wet. FIXED DRAW ORDER: one
 * jitter draw per band. A band that will not fit the remaining budget is
 * never emitted truncated: the tail is given to the band before it, so every
 * lull the scene ever shows is a FULL lull and readWindows() can promise
 * MIN_READ_MS on all of them.
 */
export function buildWeather(seed: number, depth: number, budgetMs: number): Band[] {
  const rng = mulberry32((seed ^ GW_SALT) >>> 0);
  const budget = Math.max(4000, Math.floor(budgetMs));
  const bands: Band[] = [];
  let t = 0;
  let lull = false;
  let first = true;
  while (t < budget) {
    const jit = 0.8 + rng() * 0.4;
    const base = lull ? lullMsFor(depth) : squallMsFor(depth) * (first ? 0.5 : 1);
    const len = lull ? Math.max(MIN_LULL_MS, Math.round(base * jit)) : Math.max(600, Math.round(base * jit));
    if (t + len > budget) {
      if (bands.length > 0) bands[bands.length - 1].t1 = budget;
      else bands.push({ t0: 0, t1: budget, lull: false });
      break;
    }
    bands.push({ t0: t, t1: t + len, lull });
    t += len;
    lull = !lull;
    first = false;
  }
  return bands;
}

/** Visibility in [SQUALL_VIS, LULL_VIS] at play time `ms`. Trapezoidal. */
export function visibilityAt(bands: Band[], ms: number): number {
  for (const b of bands) {
    if (ms < b.t0 || ms >= b.t1) continue;
    if (!b.lull) return SQUALL_VIS;
    const up = Math.min(1, (ms - b.t0) / VIS_RAMP_MS);
    const down = Math.min(1, (b.t1 - ms) / VIS_RAMP_MS);
    return SQUALL_VIS + (LULL_VIS - SQUALL_VIS) * Math.max(0, Math.min(up, down));
  }
  return SQUALL_VIS;
}

export interface Span {
  t0: number;
  t1: number;
}

/** The stretches where visibility >= READ_FLOOR — i.e. where you may answer. */
export function readWindows(bands: Band[]): Span[] {
  const out: Span[] = [];
  for (const b of bands) {
    if (!b.lull) continue;
    const t0 = b.t0 + RAMP_BLIND_MS;
    const t1 = b.t1 - RAMP_BLIND_MS;
    if (t1 - t0 > 0) out.push({ t0, t1 });
  }
  return out;
}

/**
 * Seeded flares. FIXED DRAW ORDER: one gap-jitter draw per flare.
 * The first is early so nobody stares at rain wondering what the round is.
 */
export function buildFlares(seed: number, depth: number, budgetMs: number): Span[] {
  const rng = mulberry32((seed ^ FLARE_SALT) >>> 0);
  const budget = Math.max(4000, Math.floor(budgetMs));
  const burn = flareMsFor(depth);
  const out: Span[] = [];
  let t = 800;
  while (t + burn < budget) {
    out.push({ t0: t, t1: t + burn });
    t += Math.round((3200 + 900 * (rng() - 0.5)) + burn);
  }
  return out;
}

/**
 * Is the round winnable? True when some flare is followed by a readable
 * stretch of at least MIN_READ_MS that finishes inside the budget.
 */
export function winnable(flares: Span[], reads: Span[], budgetMs: number): boolean {
  for (const f of flares) {
    for (const r of reads) {
      const start = Math.max(r.t0, f.t0);
      const end = Math.min(r.t1, budgetMs);
      if (end - start >= MIN_READ_MS) return true;
    }
  }
  return false;
}

export interface Tree {
  x: number;
  s: number;
}

/** Seeded tree line — a silhouette of triangles, nothing else. */
export function buildTreeLine(seed: number, count = 26): Tree[] {
  const rng = mulberry32((seed ^ TREE_SALT) >>> 0);
  const out: Tree[] = [];
  for (let i = 0; i < count; i++) {
    const x = (i + 0.5) / count;
    out.push({ x, s: 0.45 + rng() * 0.55 });
  }
  return out;
}

export interface Question {
  target: Chip;
  options: Chip[];
  answerIdx: number;
}

const chipKey = (c: Chip): string => `${c.kind}:${c.n}`;

/** FIXED DRAW ORDER: target kind, target n, candidate pairs, then shuffle. */
export function buildQuestion(seed: number): Question {
  const rng = mulberry32((seed ^ 0x2f7c19b3) >>> 0);
  const target: Chip = { kind: Math.floor(rng() * CHIP_KINDS), n: 2 + Math.floor(rng() * 6) };
  const options: Chip[] = [{ ...target }];
  while (options.length < OPTS) {
    const cand: Chip = { kind: Math.floor(rng() * CHIP_KINDS), n: 2 + Math.floor(rng() * 6) };
    if (!options.some((o) => chipKey(o) === chipKey(cand))) options.push(cand);
  }
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { target, options, answerIdx: options.findIndex((o) => chipKey(o) === chipKey(target)) };
}

export type GWEnd = 'read' | 'misread' | 'timeout' | 'escape';

export interface GWState {
  depth: number;
  /** fraction of the play budget still unspent, 0..1 */
  leftFrac: number;
  /** taps made at inert tiles while the rain was down */
  blindTries: number;
  hpDelta: number;
}

/** Full StageResult for every ending — pure, so the payout band self-tests. */
export function resolveGreenWar(end: GWEnd, s: GWState): StageResult {
  const par = parFor(Math.max(1, Math.floor(s.depth)));
  const still = s.blindTries === 0;
  switch (end) {
    case 'read': {
      const frac = clamp(s.leftFrac, 0, 1);
      return {
        correct: true,
        points: Math.round(par * Math.min(1, 0.62 + 0.38 * frac)) + (still ? STILL_BONUS : 0),
        hpDelta: s.hpDelta + (still ? STILL_HP : 0),
        summary: still ? 'YOU WAITED. THE RAIN GAVE IT UP.' : 'READ AT LAST, AFTER SOME GRABBING',
      };
    }
    case 'misread':
      return { correct: false, points: 0, hpDelta: s.hpDelta - MISREAD_HP, summary: 'WRONG SHAPE IN THE TREE LINE' };
    case 'timeout':
      return { correct: null, points: 0, hpDelta: s.hpDelta - TIMEOUT_HP, summary: 'THE RAIN OUTLASTED YOU. IT USUALLY DOES.' };
    default:
      return escaped(0, 'YOU WALKED OUT OF THE WEATHER');
  }
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

const OPT_SIZE = 150;
const OPT_GAP = 22;
const COLS = 4;
const GRID_Y = 440;
const TGT_SIZE = 140;
const TREE_BASE = 232;
const TREE_H = 104;
const RAIN_LINES = 96;

const WAIT_LINES = [
  'THE RAIN COMES BACK. IT ALWAYS COMES BACK.',
  'SOMETHING IS BURNING WET WOOD, UPWIND.',
  'THE RADIO SAYS NOTHING FOR A LONG TIME.',
  'YOU COUNT THE TREES AGAIN. SAME NUMBER.',
  'A ROTOR, MILES OFF, GOING SOMEWHERE ELSE.',
  'THE HEAT SITS DOWN NEXT TO YOU AND STAYS.',
];
const LULL_LINES = [
  'A LULL. THE LINE COMES BACK. USE IT.',
  'THE WATER THINS OUT. YOU CAN SEE AGAIN.',
  'FOR A MINUTE IT IS ONLY A HILLSIDE.',
];

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

/** A rotor seen from underneath: hub dot and four blade lines. Silhouette. */
function rotorPrims(): Prim[] {
  return [
    { k: 'dot', x: 50, y: 50, r: 6 },
    { k: 'line', x1: 6, y1: 36, x2: 94, y2: 64 },
    { k: 'line', x1: 6, y1: 64, x2: 94, y2: 36 },
  ];
}

export function mountGreenWar(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const motion = motionOn();
  const settle = onceResolve(ctx.onDone);
  const depth = Math.max(1, Math.floor(ctx.depth));
  const hue = T.boardHues[ctx.seed % T.boardHues.length];

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  text(root, 'THE GREEN WAR', 40, 26, 24, T.gold, true);
  const hud = text(root, '', 40, 58, 15, T.ink, true);

  const barW = 620;
  const barX = (STAGE_W - barW) / 2;
  const barBack = new Sprite(Texture.WHITE);
  barBack.x = barX;
  barBack.y = 88;
  barBack.width = barW;
  barBack.height = 8;
  barBack.tint = T.panelEdge;
  barBack.alpha = 0.5;
  root.addChild(barBack);
  const bar = new Sprite(Texture.WHITE);
  bar.x = barX;
  bar.y = 88;
  bar.height = 8;
  root.addChild(bar);

  /* ---- tree line (static silhouette, drawn once) ---- */
  const trees = new Graphics();
  for (const t of buildTreeLine(ctx.seed)) {
    const x = t.x * STAGE_W;
    const h = TREE_H * t.s;
    trees.moveTo(x - h * 0.42, TREE_BASE).lineTo(x, TREE_BASE - h).lineTo(x + h * 0.42, TREE_BASE).closePath();
  }
  trees.fill({ color: '#0a1a12', alpha: 0.95 });
  trees.moveTo(0, TREE_BASE).lineTo(STAGE_W, TREE_BASE).stroke({ width: 2, color: '#14301f' });
  root.addChild(trees);

  const rotor = spriteFrom(cellCanvas(rotorPrims(), '#2a3f31', 90));
  rotor.x = 1330;
  rotor.y = 120;
  root.addChild(rotor);

  const question = buildQuestion(ctx.seed);

  /* ---- the tree line's option tiles ---- */
  const rowW = COLS * OPT_SIZE + (COLS - 1) * OPT_GAP;
  const ox = (STAGE_W - rowW) / 2;
  const tiles: Sprite[] = [];
  question.options.forEach((chip, i) => {
    const s = spriteFrom(tileCanvas(chipPrims(chip.kind, chip.n), hue, OPT_SIZE));
    s.x = ox + (i % COLS) * (OPT_SIZE + OPT_GAP);
    s.y = GRID_Y + Math.floor(i / COLS) * (OPT_SIZE + OPT_GAP);
    s.eventMode = 'static';
    s.cursor = 'pointer';
    s.on('pointerdown', () => pick(i));
    root.addChild(s);
    text(root, String(i + 1), s.x + 8, s.y + OPT_SIZE - 24, 13, T.muted);
    tiles.push(s);
  });

  /* ---- weather veil + rain (above the board, below the chrome) ---- */
  const veil = new Sprite(Texture.WHITE);
  veil.x = 0;
  veil.y = TREE_BASE - TREE_H - 10;
  veil.width = STAGE_W;
  veil.height = STAGE_H - veil.y;
  veil.tint = T.bg;
  veil.alpha = 0;
  root.addChild(veil);

  const rainRng = mulberry32((ctx.seed ^ 0x9a11) >>> 0);
  const rainX: number[] = [];
  const rainPhase: number[] = [];
  for (let i = 0; i < RAIN_LINES; i++) {
    rainX.push(rainRng() * STAGE_W);
    rainPhase.push(rainRng());
  }
  const rain = new Graphics();
  root.addChild(rain);

  /* ---- grain (static, drawn once, very low alpha) ---- */
  const grain = new Graphics();
  for (let y = veil.y; y < STAGE_H; y += 4) grain.moveTo(0, y).lineTo(STAGE_W, y);
  grain.stroke({ width: 1, color: '#000000', alpha: 0.16 });
  root.addChild(grain);

  /* ---- the mark: a flare over YOUR position, so it cuts THROUGH the
   * weather layers above. Legible only while a flare burns; the rain
   * never touches it, and it is never legible at the same time as the
   * tree line unless the seeds happen to overlap. ---- */
  text(root, 'THE MARK', STAGE_W / 2 - 44, 250, 13, T.muted);
  const tgt = spriteFrom(tileCanvas(chipPrims(question.target.kind, question.target.n), hue, TGT_SIZE));
  tgt.x = STAGE_W / 2 - TGT_SIZE / 2;
  tgt.y = 272;
  root.addChild(tgt);
  const tgtVeil = new Sprite(Texture.WHITE);
  tgtVeil.x = tgt.x - 6;
  tgtVeil.y = tgt.y - 6;
  tgtVeil.width = TGT_SIZE + 12;
  tgtVeil.height = TGT_SIZE + 12;
  tgtVeil.tint = T.bg;
  root.addChild(tgtVeil);

  const caption = text(root, WAIT_LINES[0], 40, 782, 15, T.muted);
  const markTag = text(root, 'MARK NOT YET SEEN', 40, 810, 14, T.gold, true);
  text(root, 'THE TILES ONLY ANSWER IN A LULL · CLICK / TAP · KEYS 1–8 · ESC BAILS NEUTRAL', 40, 838, 12, T.muted);

  /* ---- goal card (first GOAL_MS: input locked, clock frozen) ----
   * Mirrors the requested onboard.ts CARDS['green-war'] — keep in step. */
  const CARD_W = 660;
  const card = panel(root, (STAGE_W - CARD_W) / 2, 300, CARD_W, 190);
  text(card, 'THE GREEN WAR', 28, 20, 26, T.gold, true);
  text(card, 'A FLARE SHOWS THE MARK. THE RAIN HIDES THE LINE.', 28, 62, 15, T.ink);
  text(card, 'HOLD THE MARK UNTIL A LULL LETS YOU ANSWER.', 28, 90, 13, T.muted);
  text(card, 'CLICK / TAP · KEYS 1–8 · ESC BAILS NEUTRAL', 28, 116, 13, T.muted);
  const unlockTxt = text(card, 'INPUT UNLOCKS IN 2…', 28, 148, 14, T.good, true);

  /* ---- state ---- */
  const playMs = Math.max(6000, ctx.timerLen * 1000 - GOAL_MS - SETTLE_MS);
  const bands = buildWeather(ctx.seed, depth, playMs);
  const flares = buildFlares(ctx.seed, depth, playMs);
  let clock = 0;
  let introLeft = GOAL_MS;
  let blindTries = 0;
  let hpDelta = 0;
  let held = false;
  let dead = false;
  let lastLull = false;
  let captionIdx = 0;

  function vis(): number {
    return visibilityAt(bands, clock);
  }
  function readable(): boolean {
    return vis() >= READ_FLOOR;
  }
  function flareOn(): number {
    for (const f of flares) {
      if (clock >= f.t0 && clock < f.t1) {
        // 200 ms ramp at each end — a ramp, never a flash
        return Math.min(1, Math.min(clock - f.t0, f.t1 - clock) / 200);
      }
    }
    return 0;
  }

  function finish(end: GWEnd): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(resolveGreenWar(end, {
      depth,
      leftFrac: Math.max(0, (playMs - clock) / playMs),
      blindTries,
      hpDelta,
    }));
  }

  function pick(i: number): void {
    if (dead || introLeft > 0) return;
    if (!readable()) {
      blindTries++;
      caption.text = 'YOU CANNOT SEE THE LINE. NOT YET.';
      return;
    }
    if (i === question.answerIdx) finish('read');
    else finish('misread');
  }

  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      finish('escape');
      return;
    }
    if (introLeft > 0) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= OPTS) pick(n - 1);
  }
  window.addEventListener('keydown', onKey);

  /* ---- paint ---- */
  function paint(): void {
    const rawV = vis();
    // motion off: the veil steps in 10 % rungs instead of easing per frame
    const v = motion ? rawV : Math.round(rawV * 10) / 10;
    const veilA = clamp((0.86 * (READ_FLOOR - v)) / READ_FLOOR, 0, 0.86);
    veil.alpha = veilA;
    for (const t of tiles) {
      t.eventMode = readable() ? 'static' : 'none';
      t.cursor = readable() ? 'pointer' : 'default';
    }

    const fl = flareOn();
    tgtVeil.alpha = 1 - fl;
    if (fl > 0.5 && !held) {
      held = true;
      markTag.text = 'MARK HELD';
      markTag.style.fill = T.good;
    }

    rain.clear();
    const dropA = clamp(0.34 * (1 - v), 0, 0.34);
    if (dropA > 0.01) {
      for (let i = 0; i < RAIN_LINES; i++) {
        // motion on: the streak falls · motion off: a fixed hatch, same seeds
        const p = motion ? (rainPhase[i] + clock / 900) % 1 : rainPhase[i];
        const y = veil.y + p * (STAGE_H - veil.y);
        rain.moveTo(rainX[i], y).lineTo(rainX[i] - 7, y + 34);
      }
      rain.stroke({ width: 1.5, color: '#8fb9c8', alpha: dropA });
    }

    bar.width = Math.max(2, barW * Math.max(0, 1 - clock / playMs));
    bar.tint = readable() ? T.good : T.accentA;
    hud.text = `VISIBILITY ${Math.round(rawV * 100)}% · ${readable() ? 'LINE LEGIBLE' : 'RAIN — TILES INERT'} · HP ${hpDelta}`;
    hud.style.fill = readable() ? T.ink : T.muted;
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
    clock += tk.deltaMS;
    if (clock >= playMs) {
      finish('timeout');
      return;
    }
    const nowLull = readable();
    if (nowLull !== lastLull) {
      lastLull = nowLull;
      caption.text = nowLull
        ? LULL_LINES[captionIdx % LULL_LINES.length]
        : WAIT_LINES[captionIdx % WAIT_LINES.length];
      if (!nowLull) captionIdx++;
    }
    paint();
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  paint();
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  /* --- weather ladders --- */
  if (lullMsFor(1) !== 2600 || lullMsFor(99) !== 1500) failures.push('lull ladder wrong');
  if (squallMsFor(1) !== 1800 || squallMsFor(99) !== 3600) failures.push('squall ladder wrong');
  if (flareMsFor(1) !== 1700 || flareMsFor(99) !== 1100) failures.push('flare ladder wrong');
  for (let d = 1; d < 30; d++) {
    if (lullMsFor(d + 1) > lullMsFor(d)) failures.push(`lulls must shrink with depth d=${d}`);
    if (squallMsFor(d + 1) < squallMsFor(d)) failures.push(`squalls must grow with depth d=${d}`);
    if (flareMsFor(d + 1) > flareMsFor(d)) failures.push(`flares must shorten with depth d=${d}`);
  }

  /* --- bands tile the budget: no gaps, no overlaps, first band is rain --- */
  for (let seed = 1; seed <= 200; seed++) {
    const d = 1 + (seed % 20);
    const budget = 9000 + (seed % 7) * 5000;
    const a = buildWeather(seed, d, budget);
    if (JSON.stringify(a) !== JSON.stringify(buildWeather(seed, d, budget))) {
      failures.push(`weather nondeterministic seed=${seed}`);
      break;
    }
    if (a.length === 0 || a[0].t0 !== 0 || a[0].lull) failures.push(`weather must open on rain seed=${seed}`);
    for (let i = 0; i < a.length; i++) {
      if (a[i].t1 <= a[i].t0) failures.push(`empty band seed=${seed} i=${i}`);
      if (i > 0 && a[i].t0 !== a[i - 1].t1) failures.push(`band gap/overlap seed=${seed} i=${i}`);
      if (i > 0 && a[i].lull === a[i - 1].lull) failures.push(`bands must alternate seed=${seed} i=${i}`);
    }
    if (a[a.length - 1].t1 < budget) failures.push(`weather stops short of the budget seed=${seed}`);
  }

  /* --- visibility: bounded, continuous, and honest about the read floor --- */
  for (let seed = 1; seed <= 60; seed++) {
    const bands = buildWeather(seed, 1 + (seed % 20), 24000);
    let prev = visibilityAt(bands, 0);
    for (let t = 0; t <= 24000; t += 16) {
      const v = visibilityAt(bands, t);
      if (v < SQUALL_VIS - 1e-9 || v > LULL_VIS + 1e-9) failures.push(`visibility out of range seed=${seed} t=${t}`);
      if (Math.abs(v - prev) > 0.05) failures.push(`visibility jumps (strobe risk) seed=${seed} t=${t}`);
      prev = v;
    }
    if (visibilityAt(bands, -100) !== SQUALL_VIS || visibilityAt(bands, 999999) !== SQUALL_VIS) {
      failures.push(`out-of-band visibility must be rain seed=${seed}`);
    }
    // readWindows must agree with visibilityAt to the millisecond
    for (const w of readWindows(bands)) {
      if (w.t1 - w.t0 < MIN_READ_MS) failures.push(`read window too short to use seed=${seed}`);
      if (visibilityAt(bands, w.t0 + 1) < READ_FLOOR) failures.push(`read window starts blind seed=${seed}`);
      if (visibilityAt(bands, (w.t0 + w.t1) / 2) < READ_FLOOR) failures.push(`read window not legible seed=${seed}`);
      if (visibilityAt(bands, w.t0 - 30) >= READ_FLOOR) failures.push(`read window starts late seed=${seed}`);
      if (visibilityAt(bands, w.t1 + 30) >= READ_FLOOR) failures.push(`read window ends late seed=${seed}`);
    }
  }

  /* --- SOLVABILITY RAIL: every round has a flare with a lull after it --- */
  for (let seed = 1; seed <= 600; seed++) {
    const d = 1 + (seed % 20);
    const budget = 8000 + (seed % 9) * 4000;
    const bands = buildWeather(seed, d, budget);
    const flares = buildFlares(seed, d, budget);
    if (JSON.stringify(flares) !== JSON.stringify(buildFlares(seed, d, budget))) {
      failures.push(`flares nondeterministic seed=${seed}`);
      break;
    }
    if (flares.length === 0) failures.push(`no flare at all seed=${seed} budget=${budget}`);
    for (let i = 0; i < flares.length; i++) {
      if (flares[i].t1 > budget) failures.push(`flare overruns the budget seed=${seed}`);
      if (i > 0 && flares[i].t0 <= flares[i - 1].t1) failures.push(`flares overlap seed=${seed}`);
    }
    if (!winnable(flares, readWindows(bands), budget)) {
      failures.push(`unwinnable round seed=${seed} depth=${d} budget=${budget}`);
    }
  }
  if (winnable([], [{ t0: 0, t1: 9000 }], 9000)) failures.push('no flare must not be winnable');
  if (winnable([{ t0: 0, t1: 900 }], [{ t0: 100, t1: 300 }], 9000)) failures.push('a 200 ms lull must not count');

  /* --- board: deterministic, valid, 8 distinct options, seed-varying --- */
  const openers = new Set<string>();
  for (let seed = 1; seed <= 300; seed++) {
    const q = buildQuestion(seed);
    if (JSON.stringify(q) !== JSON.stringify(buildQuestion(seed))) {
      failures.push(`question nondeterministic seed=${seed}`);
      break;
    }
    if (q.options.length !== OPTS) failures.push(`option count wrong seed=${seed}`);
    if (new Set(q.options.map((o) => `${o.kind}:${o.n}`)).size !== OPTS) failures.push(`duplicate option seed=${seed}`);
    if (q.answerIdx < 0 || q.answerIdx >= OPTS) failures.push(`answer missing seed=${seed}`);
    if (q.options.some((o) => o.kind < 0 || o.kind >= CHIP_KINDS || o.n < 2 || o.n > 7)) failures.push(`bad chip seed=${seed}`);
    const ans = q.options[q.answerIdx];
    if (ans.kind !== q.target.kind || ans.n !== q.target.n) failures.push(`answerIdx mislabels seed=${seed}`);
    openers.add(JSON.stringify(q.target));
  }
  if (openers.size < 20) failures.push(`board seed-blind: ${openers.size} distinct marks over 300 seeds`);

  /* --- tree line: deterministic, in frame, seed-varying --- */
  const lines = new Set<string>();
  for (let seed = 1; seed <= 200; seed++) {
    const t = buildTreeLine(seed);
    if (JSON.stringify(t) !== JSON.stringify(buildTreeLine(seed))) failures.push(`tree line nondeterministic seed=${seed}`);
    if (t.some((n) => n.x < 0 || n.x > 1 || n.s < 0.45 || n.s > 1)) failures.push(`tree out of frame seed=${seed}`);
    lines.add(t.map((n) => n.s.toFixed(3)).join(','));
  }
  if (lines.size < 150) failures.push(`tree line seed-blind: ${lines.size} distinct over 200 seeds`);

  /* --- POINTS BAND vs par(d) = 100d + 40, and the patience premium --- */
  for (let d = 1; d <= 12; d++) {
    const par = parFor(d);
    const best = resolveGreenWar('read', { depth: d, leftFrac: 1, blindTries: 0, hpDelta: 0 });
    const worst = resolveGreenWar('read', { depth: d, leftFrac: 0, blindTries: 3, hpDelta: 0 });
    if (best.correct !== true || worst.correct !== true) failures.push(`a read must be a win at d=${d}`);
    if (best.points > 1.35 * par) failures.push(`best read ${best.points} above band vs par ${par} d=${d}`);
    if (worst.points < 0.6 * par) failures.push(`worst read ${worst.points} below band vs par ${par} d=${d}`);
    if (best.points <= worst.points) failures.push(`patience + time must pay at d=${d}`);
    if (best.hpDelta !== STILL_HP || worst.hpDelta !== 0) failures.push(`still-bonus hp wrong at d=${d}`);
    // grabbing at the veil only costs the bonus, never the round
    const grabbed = resolveGreenWar('read', { depth: d, leftFrac: 1, blindTries: 1, hpDelta: 0 });
    if (grabbed.points !== best.points - STILL_BONUS) failures.push(`blind tries must cost exactly the bonus at d=${d}`);

    const miss = resolveGreenWar('misread', { depth: d, leftFrac: 0.5, blindTries: 0, hpDelta: -2 });
    if (miss.correct !== false || miss.points !== 0 || miss.hpDelta !== -12) failures.push(`misread wrong at d=${d}`);
    const to = resolveGreenWar('timeout', { depth: d, leftFrac: 0, blindTries: 4, hpDelta: 0 });
    if (to.correct !== null || to.points !== 0 || to.hpDelta !== -TIMEOUT_HP) failures.push(`timeout wrong at d=${d}`);
    if (to.points >= worst.points) failures.push(`stalling beats a win at d=${d}`);
  }
  {
    const esc = resolveGreenWar('escape', { depth: 7, leftFrac: 0.3, blindTries: 9, hpDelta: -40 });
    if (esc.correct !== null || esc.points !== 0 || esc.hpDelta !== 0) failures.push('Esc must be a clean neutral');
  }
  for (const end of ['read', 'misread', 'timeout', 'escape'] as GWEnd[]) {
    for (const blind of [0, 2]) {
      const r = resolveGreenWar(end, { depth: 5, leftFrac: 0.5, blindTries: blind, hpDelta: 0 });
      if (r.summary.length > 48) failures.push(`summary too long for ${end}: ${r.summary}`);
      if (r.summary.length === 0) failures.push(`empty summary for ${end}`);
    }
  }

  /* --- caption pools are non-empty and carry no borrowed lines --- */
  if (WAIT_LINES.length < 3 || LULL_LINES.length < 2) failures.push('caption pools too thin');

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/scenes/takeovers/greenwar.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/greenwar.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] THE GREEN WAR OK' : `[selftest] THE GREEN WAR FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
