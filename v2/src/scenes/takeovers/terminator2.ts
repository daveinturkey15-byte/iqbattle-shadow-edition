/**
 * TERMINATOR2 — "THE HUNT" takeover scene (v2 port of modes/terminator.js,
 * mechanic not code).
 *
 * The board splits into a spawn GATE (top), SIX exposed LANES and your SAFE
 * ZONE strip (bottom). A T-800-parody silhouette marches DOWN the lanes at a
 * seeded, depth-scaled speed while its column CHASES your cursor-x at a finite
 * rate (pursuer, not wall — sharp jukes visibly re-aim it).
 *
 * Micro-patterns run while you evade: a seeded 3-glyph sequence + one hole;
 * pick the next glyph from 4 options before the pattern budget ends.
 *   correct AND fast (<= 55% of budget): SHOVED BACK one lane + brief stall
 *   correct but slow: counts toward escape, it keeps its ground
 *   wrong pick / expiry: it ADVANCES one lane
 *
 * EXPOSURE CLOCK: while it stands inside your strip, exposure accrues; every
 * cumulative 2000 ms = a damage tick (-10 first contact, -6 per re-crossing),
 * a stutter stall, a localized track flash, and it resets TWO LANES back —
 * "IT COMES BACK." hpDelta is self-clamped >= -60 (never instant-death).
 *
 * Solve `need` patterns -> DOOR SLAM escape (escapeFor(diff) points, +40
 * GHOST bonus if you were never damaged). Timeout -> survival exit (80 pts,
 * always worse than escaping).
 *
 * Polish rails (parent checklist): goal card shows title / controls / win
 * condition for the first 2 s and input unlocks only after it clears; no HUD
 * element overlaps the option row or rule line; picks tint instantly (<100 ms
 * feedback); the Esc hint is on the goal card AND the permanent footer; every
 * summary <= 64 chars.
 *
 * Determinism: everything derives from ctx.seed via an own mulberry32 in a
 * FIXED draw order (column phase, drift width, scan phase, scan period, then
 * patterns sequentially). No Math.random, no Date.now — the clock is Pixi's
 * shared ticker delta. Self-limits to ctx.timerLen; Esc bails NEUTRAL;
 * StageResult settles exactly once via onceResolve; container emptied on done.
 *
 * Fairness rails: catch feedback = localized track flash (<=200 ms, skipped
 * entirely when IQB_MOTION off) + status text; red eye scan is gutter-only,
 * <=150 ms, >=500 ms gap, static glow without motion; IQB_MUTED silences the
 * metallic footstep thuds; all text >= 11 px; escapable at any moment.
 */
import { Container, Graphics, Sprite, Text, Texture, Ticker } from 'pixi.js';
import type { Prim } from '../../glyphs.ts';
import { tileCanvas } from '../../glyphs.ts';
import { panel, text, spriteFrom } from '../game.ts';
import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import {
  type StageResult,
  type TakeoverCtx,
  mulberry32,
  onceResolve,
  escaped,
} from './redlight.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested below)                                      */
/* ------------------------------------------------------------------ */

export const LANES = 6;
export const RESET_LANES = 2;
export const CATCH_HP_FIRST = 10;
export const CATCH_HP_NEXT = 6;
export const EXPOSE_TICK_MS = 2000;
export const SURVIVE_POINTS = 80;
export const GHOST_BONUS = 40;
export const EYE_FLASH_MS = 150;
export const EYE_MIN_GAP_MS = 500;
export const PUSHBACK_STALL_MS = 1100;
export const WRONG_STALL_MS = 350;
export const SOLVE_STALL_MS = 450;
export const CATCH_STALL_MS = 1600;
export const OPTIONS = 4;
export const CAP_S = 45;
export const SETTLE_MS = 700;
/** Goal card hold; input unlocks when it clears. */
export const READY_MS = 2000;
/** hpDelta floor — the host clamp rail made local (never instant-death). */
export const HP_FLOOR = -60;

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

/* ---- depth scaling (advance speed, turn rate, patterns 2->4) -------- */
export function needFor(depth: number): number {
  return clamp(2 + Math.floor(((depth | 0) - 3) / 3), 2, 4);
}

export function diffFor(depth: number): number {
  return Math.min(5, Math.max(1, 1 + Math.floor(((depth | 0) - 1) / 6)));
}

export function escapeFor(diff: number): number {
  return 100 * diff + 80;
}

export interface HuntParams {
  /** lanes/s base march */
  v: number;
  /** px/s column chase (finite turn rate) */
  colRate: number;
  /** ms to answer a micro-pattern */
  patMs: number;
  fastFrac: number;
  need: number;
}

export function paramsFor(depth: number): HuntParams {
  const d = clamp((depth | 0) - 1, 0, 14);
  return {
    v: 0.055 + 0.012 * d,
    colRate: 120 + 18 * clamp(d, 0, 10),
    patMs: clamp(6800 - 280 * ((depth | 0) - 1), 4000, 6800),
    fastFrac: 0.55,
    need: needFor(depth),
  };
}

/* ---- exposure math --------------------------------------------------- */
/** Damage dealt by the n-th exposure tick (1-based): -10 first, -6 after. */
export function tickDamage(catchNo: number): number {
  return catchNo <= 1 ? CATCH_HP_FIRST : CATCH_HP_NEXT;
}

/** Cumulative damage after n ticks. */
export function damageAfterTicks(n: number): number {
  if (n <= 0) return 0;
  return CATCH_HP_FIRST + CATCH_HP_NEXT * (n - 1);
}

/** Result hpDelta after n ticks, honoring the -60 floor. */
export function hpDeltaAfterTicks(n: number): number {
  return Math.max(HP_FLOOR, -damageAfterTicks(n));
}

/* ---- micro-pattern factory (pure fn of rng; fixed draw order) -------- */
/**
 * Sequence kinds, structure-carried (DNA: one hue per board, primitive marks):
 *   0 COUNT STEP  — dot grids grow arithmetically      ("THE COUNT GROWS")
 *   1 ROTATION STEP — a pointer sweeps 45 deg steps    ("ROTATION MARCHES ON")
 *   2 ORBIT STEP  — a dot hops around a center marker  ("IT ORBITS FORWARD")
 */
export interface HuntGlyph {
  kind: number;
  val: number;
}

export interface HuntPattern {
  kind: number;
  vals: number[];
  answerVal: number;
  options: number[];
  answerIdx: number;
  rule: string;
}

export const SEQ_KINDS = 3;
const SPACE_BY_KIND = [9, 8, 8];
const RULES = ['THE COUNT GROWS', 'ROTATION MARCHES ON', 'IT ORBITS FORWARD'];

export function makeSeqPattern(rng: () => number): HuntPattern {
  const kind = Math.floor(rng() * SEQ_KINDS);
  const space = SPACE_BY_KIND[kind];
  const vals: number[] = [];
  let answerVal: number;
  if (kind === 0) {
    const base = 1 + Math.floor(rng() * 2);
    const step = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < 3; i++) vals.push(base + i * step);
    answerVal = base + 3 * step;
  } else {
    const step = kind === 1 ? 1 + Math.floor(rng() * 2) : 1 + Math.floor(rng() * 3);
    const base = Math.floor(rng() * space);
    for (let i = 0; i < 3; i++) vals.push((base + i * step) % space);
    answerVal = (base + 3 * step) % space;
  }
  /* exactly 3 unique distractors: nearest unseen successors of the answer.
     Count tiles never offer 0 dots — an empty tile is not an option. */
  const pool: number[] = [];
  for (let d = 1; d < space && pool.length < 3; d++) {
    const cand = (answerVal + d) % space;
    if (cand === 0 && kind === 0) continue;
    if (!vals.includes(cand) && !pool.includes(cand)) pool.push(cand);
  }
  let w = kind === 0 ? 1 : 0;
  while (pool.length < 3 && w < space) {
    if (w !== answerVal && !pool.includes(w) && !vals.includes(w)) pool.push(w);
    w++;
  }
  const ordVals = [answerVal, ...pool];
  for (let i = ordVals.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ordVals[i], ordVals[j]] = [ordVals[j], ordVals[i]];
  }
  return {
    kind,
    vals,
    answerVal,
    options: ordVals,
    answerIdx: ordVals.indexOf(answerVal),
    rule: RULES[kind],
  };
}

function gridPos(i: number, n: number): { x: number; y: number } {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return {
    x: 50 + ((i % cols) - (cols - 1) / 2) * 26,
    y: 50 + (Math.floor(i / cols) - (rows - 1) / 2) * 26,
  };
}

/** Paint a hunt glyph into DNA primitives in a 100x100 cell space. */
export function glyphPrims(g: HuntGlyph): Prim[] {
  const prims: Prim[] = [];
  if (g.kind === 0) {
    for (let i = 0; i < g.val; i++) {
      const p = gridPos(i, g.val);
      prims.push({ k: 'dot', x: p.x, y: p.y, r: 7 });
    }
    return prims;
  }
  if (g.kind === 1) {
    // center diamond + pointer segment swept in 45-deg units + tip dot
    const a = (g.val * Math.PI) / 4;
    const cx = 50 + 30 * Math.cos(a);
    const cy = 50 + 30 * Math.sin(a);
    const tx = 50 - 22 * Math.cos(a);
    const ty = 50 - 22 * Math.sin(a);
    prims.push(
      { k: 'diamond', x: 50, y: 50, s: 9 },
      { k: 'line', x1: tx, y1: ty, x2: cx, y2: cy },
      { k: 'dot', x: cx, y: cy, r: 4 },
    );
    return prims;
  }
  // orbit: center diamond + fixed 12-o'clock reference tri + dot at slot val
  const a = -Math.PI / 2 + (g.val * Math.PI) / 4;
  prims.push(
    { k: 'diamond', x: 50, y: 52, s: 8 },
    { k: 'tri', x: 50, y: 14, s: 7 },
    { k: 'dot', x: 50 + 27 * Math.cos(a), y: 52 + 27 * Math.sin(a), r: 6 },
  );
  return prims;
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

const TRACK_W = 900;
const TRACK_H = 424;
const TRACK_X = (STAGE_W - TRACK_W) / 2;
const TRACK_Y = 398;
const GATE_H = 34;
const SAFE_H = 54;
const HUNT_SALT = 0x7e21a0;

const SEQ_TILE = 92;
const OPT_TILE = 116;

interface LiveUi {
  rule: Text;
  seqRow: Container;
  optRow: Container;
  status: Text;
  foot: Text;
  callout: Text;
  staticG: Graphics;
  dynG: Graphics;
  flash: Sprite;
  card: Container;
}

export function mountTerminator2(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const MOTION = typeof localStorage === 'undefined' || localStorage.getItem('IQB_MOTION') !== '0';
  const MUTED =
    typeof localStorage !== 'undefined' &&
    (localStorage.getItem('IQB_MUTED') === '1' || localStorage.getItem('IQB_MUTED') === 'true');
  const settle = onceResolve(ctx.onDone);
  const hue = T.boardHues[ctx.seed % T.boardHues.length];

  /* ---- seeded sim params: drawn FIRST, fixed order ---- */
  const P = paramsFor(ctx.depth);
  const rng = mulberry32((ctx.seed ^ HUNT_SALT) >>> 0);
  const colPhase = rng() * Math.PI * 2; // idle column drift phase
  const driftW = 0.4 + rng() * 0.3; // rad/s idle drift
  const scanPhase = rng(); // fraction of first scan period
  const scanPeriod = 2200 + rng() * 1300; // ms between eye scans
  const fastMs = P.patMs * P.fastFrac;
  const budgetMs = Math.min(Math.max(5, ctx.timerLen), CAP_S) * 1000 - SETTLE_MS;

  /* ---- chrome (nothing overlaps the option row at y 244..360) ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  panel(root, STAGE_W / 2 - 340, 24, 680, 72);
  text(root, `THE HUNT \u00B7 DEPTH ${ctx.depth | 0}`, STAGE_W / 2 - 130, 32, 22, T.bad, true);
  text(
    root,
    `OUTRUN IT \u00B7 SOLVE ${P.need} PATTERNS \u00B7 FAST SOLVES SHOVE IT BACK`,
    STAGE_W / 2 - 216,
    66,
    13,
    T.muted,
  );

  const ui: LiveUi = {
    rule: text(root, '', STAGE_W / 2 - 90, 108, 15, T.gold, true),
    seqRow: new Container(),
    optRow: new Container(),
    status: text(root, '', 60, 842, 16, T.ink, true),
    foot: text(root, '', STAGE_W / 2 - 250, 874, 12, T.muted),
    callout: text(root, '', TRACK_X, TRACK_Y + TRACK_H * 0.38, 26, T.bad, true),
    staticG: new Graphics(),
    dynG: new Graphics(),
    flash: new Sprite(Texture.WHITE),
    card: new Container(),
  };
  root.addChild(ui.seqRow, ui.optRow, ui.staticG, ui.dynG);
  ui.callout.style.align = 'center';
  ui.callout.visible = false;
  root.addChild(ui.callout);

  ui.flash.x = TRACK_X;
  ui.flash.y = TRACK_Y;
  ui.flash.width = TRACK_W;
  ui.flash.height = TRACK_H;
  ui.flash.alpha = 0;
  root.addChild(ui.flash);

  text(
    root,
    'MOUSE STEERS YOUR MARK IN THE SAFE STRIP \u00B7 KEYS 1\u20134 ANSWER',
    STAGE_W / 2 - 208,
    366,
    13,
    T.muted,
  );

  /* static geometry (drawn once) */
  const laneH = (TRACK_H - SAFE_H - GATE_H) / LANES;
  {
    const g = ui.staticG;
    g.rect(TRACK_X, TRACK_Y, TRACK_W, TRACK_H).fill({ color: 0x070204 });
    for (let ln = 0; ln < LANES; ln++) {
      const y = TRACK_Y + GATE_H + ln * laneH;
      g.rect(TRACK_X, y, TRACK_W, laneH).fill({ color: ln % 2 ? 0x14060b : 0x17070d });
      g.moveTo(TRACK_X, y).lineTo(TRACK_X + TRACK_W, y).stroke({ width: 1, color: 0x47121f });
    }
    // spawn gate hatch
    g.rect(TRACK_X, TRACK_Y, TRACK_W, GATE_H).fill({ color: 0x1c1016 });
    for (let hx = 0; hx < TRACK_W; hx += 18) {
      g.rect(TRACK_X + hx, TRACK_Y + GATE_H - 5, 9, 5).fill({
        color: (hx / 18) % 2 ? 0x3a1219 : 0x20101a,
      });
    }
    g.rect(TRACK_X, TRACK_Y, TRACK_W, GATE_H).stroke({ width: 1, color: 0x5c1a26 });
    // safe zone strip
    g.rect(TRACK_X, TRACK_Y + TRACK_H - SAFE_H, TRACK_W, SAFE_H).fill({ color: 0x00e68a, alpha: 0.06 });
    g.moveTo(TRACK_X, TRACK_Y + TRACK_H - SAFE_H)
      .lineTo(TRACK_X + TRACK_W, TRACK_Y + TRACK_H - SAFE_H)
      .stroke({ width: 1, color: 0x123f2c });
  }

  /* ---- GOAL CARD: title / controls / win condition, first 2 s ----
     Sits over the (empty) track region — never over the option row. */
  {
    const cw = 720;
    const ch = 210;
    const cx = (STAGE_W - cw) / 2;
    const cy = TRACK_Y + 60;
    panel(ui.card, cx, cy, cw, ch);
    text(ui.card, 'THE HUNT', cx + cw / 2 - 62, cy + 18, 24, T.bad, true);
    text(ui.card, 'IT MARCHES DOWN THE LANES — YOUR CURSOR IS THE TARGET', cx + 70, cy + 62, 14, T.ink);
    text(
      ui.card,
      `STEER IN THE GREEN STRIP \u00B7 SOLVE ${P.need} PATTERNS (KEYS 1\u20134 / CLICK)` +
        ` \u00B7 FAST SOLVES SHOVE IT BACK`,
      cx + 46,
      cy + 96,
      14,
      T.ink,
    );
    text(
      ui.card,
      'WIN: DOOR-SLAM ESCAPE (+40 GHOST IF UNTOUCHED) \u00B7 2 S IN ITS GRIP = HP TICK',
      cx + 66,
      cy + 130,
      14,
      T.gold,
    );
    text(ui.card, 'ESC BAILS NEUTRAL \u00B7 INPUT UNLOCKS WHEN THIS CARD CLEARS', cx + 88, cy + 168, 13, T.muted);
    root.addChild(ui.card); // last = topmost
  }

  /* ---- WebAudio: metallic footstep thuds (silenced by IQB_MUTED) ---- */
  let actx: AudioContext | null = null;
  function thud(vol: number, deep: boolean): void {
    if (MUTED) return;
    try {
      if (!actx) actx = new AudioContext();
      if (actx.state === 'suspended') void actx.resume();
      const t = actx.currentTime;
      const o = actx.createOscillator();
      const gn = actx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(deep ? 38 : 52, t);
      o.frequency.exponentialRampToValueAtTime(deep ? 24 : 30, t + 0.16);
      gn.gain.setValueAtTime(clamp(vol, 0.02, 0.5), t);
      gn.gain.exponentialRampToValueAtTime(0.001, t + (deep ? 0.34 : 0.2));
      o.connect(gn);
      gn.connect(actx.destination);
      o.start(t);
      o.stop(t + 0.4);
    } catch {
      /* audio optional */
    }
  }

  /* ---- round state ---- */
  let dead = false;
  let clock = 0;
  let pos = 0; // lanes marched (0 = gate, LANES = your strip)
  let marchClock = 0;
  let pauseUntil = READY_MS; // march starts when the goal card clears
  let colX = -1; // px inside the track, chased toward the cursor
  let pointerX = -1; // px inside the track; -1 = not inside yet
  let solved = 0;
  let catches = 0;
  let dmg = 0;
  let exposureMs = 0;
  let stepAccum = 0;
  let pat: HuntPattern | null = null;
  let patStart = 0;
  let patLocked = false;
  let nextPatternAt = READY_MS;
  let doorArmAt = -1;
  let slamWinAt = -1;
  let nextScanAt = scanPhase * scanPeriod;
  let lastFlashAt = -1e9;
  let flashUntil = -1;
  let calloutUntil = -1;

  function finish(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  /* ---- pattern lifecycle ---- */
  function renderSeq(p: HuntPattern): void {
    ui.rule.text = p.rule;
    ui.seqRow.removeChildren().forEach((c) => c.destroy({ children: true }));
    const gap = 12;
    const rowW = 4 * SEQ_TILE + 3 * gap;
    p.vals.forEach((v, i) => {
      const s = spriteFrom(tileCanvas(glyphPrims({ kind: p.kind, val: v }), hue, SEQ_TILE));
      s.x = (STAGE_W - rowW) / 2 + i * (SEQ_TILE + gap);
      s.y = 132;
      ui.seqRow.addChild(s);
    });
    const hole = spriteFrom(tileCanvas([], hue, SEQ_TILE, { hole: true }));
    hole.x = (STAGE_W - rowW) / 2 + 3 * (SEQ_TILE + gap);
    hole.y = 132;
    ui.seqRow.addChild(hole);
  }

  /** Instant pick feedback (<100 ms rail): tint now, resolve synchronously. */
  function tintPick(pickedIdx: number, right: boolean): void {
    const kids = ui.optRow.children;
    const picked = kids[pickedIdx * 2] as Sprite | undefined; // sprite, then its label
    if (picked) picked.tint = right ? 0x00e68a : 0xff2038;
    if (!right && pat) {
      const ans = kids[pat.answerIdx * 2] as Sprite | undefined;
      if (ans) ans.tint = 0xd4a017;
    }
  }

  function renderOpts(p: HuntPattern): void {
    ui.optRow.removeChildren().forEach((c) => c.destroy({ children: true }));
    const gap = 20;
    const rowW = OPTIONS * OPT_TILE + (OPTIONS - 1) * gap;
    p.options.forEach((v, i) => {
      const s = spriteFrom(tileCanvas(glyphPrims({ kind: p.kind, val: v }), hue, OPT_TILE));
      s.x = (STAGE_W - rowW) / 2 + i * (OPT_TILE + gap);
      s.y = 244;
      s.eventMode = 'static';
      s.cursor = 'pointer';
      s.on('pointerdown', () => choose(i));
      ui.optRow.addChild(s);
      text(ui.optRow, String(i + 1), s.x + 8, s.y + OPT_TILE - 24, 13, T.muted);
    });
  }

  function loadPattern(): void {
    pat = makeSeqPattern(rng);
    patStart = clock;
    patLocked = false;
    renderSeq(pat);
    renderOpts(pat);
  }
  function sayStatus(msg: string): void {
    ui.status.text = msg;
  }

  function callout(msg: string, ms: number): void {
    ui.callout.text = msg;
    ui.callout.visible = true;
    calloutUntil = clock + ms;
  }

  function advanceOrExpire(slow: boolean): void {
    patLocked = true;
    pos = Math.min(LANES, pos + 1);
    stepAccum += 1;
    sayStatus(slow ? 'TOO SLOW \u00B7 IT GAINS' : 'WRONG \u00B7 IT ADVANCES');
    thud(0.22, false);
    if (pos >= LANES) return; // exposure clock takes over inside the strip
    nextPatternAt = clock + WRONG_STALL_MS;
    pauseUntil = clock + WRONG_STALL_MS;
  }

  function solve(fast: boolean): void {
    patLocked = true;
    solved++;
    if (fast) {
      pos = Math.max(0, pos - 1);
      pauseUntil = clock + PUSHBACK_STALL_MS;
      sayStatus(`SHOVED BACK \u00B7 SOLVED ${solved}/${P.need}`);
      thud(0.18, false);
    } else {
      sayStatus(`SOLVED ${solved}/${P.need} \u00B7 IT KEEPS COMING`);
    }
    if (solved >= P.need) {
      doorArmAt = clock + 500;
      return;
    }
    nextPatternAt = clock + (fast ? SOLVE_STALL_MS : WRONG_STALL_MS);
    if (!fast) pauseUntil = clock + WRONG_STALL_MS;
  }

  function choose(i: number): void {
    if (dead || !pat || patLocked || clock < READY_MS) return;
    if (i < 0 || i >= OPTIONS) return;
    const fast = clock - patStart <= fastMs;
    const right = i === pat.answerIdx;
    tintPick(i, right); // instant feedback, before anything else
    if (right) solve(fast);
    else advanceOrExpire(false);
  }

  /* ---- exposure tick: it reached your strip and stayed ---- */
  function catchPlayer(): void {
    catches++;
    const tick = tickDamage(catches);
    dmg += tick;
    pos = LANES - RESET_LANES; // two lanes back — never death
    exposureMs = 0;
    pauseUntil = clock + CATCH_STALL_MS;
    nextPatternAt = clock + CATCH_STALL_MS;
    if (MOTION) flashUntil = clock + 180; // localized, <=200 ms
    thud(0.45, true);
    callout('IT COMES BACK.', 1300);
    sayStatus(`CAUGHT \u00B7 HP \u2212${tick}`);
  }

  function escapeDoor(): void {
    callout('\u25B8 DOOR SLAM \u25C2', 900);
    thud(0.5, true);
    sayStatus('DOOR SLAM \u00B7 ESCAPED');
    slamWinAt = clock + 850;
  }

  function slamEscape(): void {
    finish({
      correct: true,
      points: escapeFor(diffFor(ctx.depth)) + (dmg === 0 ? GHOST_BONUS : 0),
      hpDelta: hpDeltaAfterTicks(catches),
      summary: 'DOOR SLAM \u00B7 ESCAPED THE HUNT',
    });
  }

  function surviveExit(): void {
    finish({
      correct: true,
      points: SURVIVE_POINTS + (dmg === 0 ? GHOST_BONUS : 0),
      hpDelta: hpDeltaAfterTicks(catches),
      summary: 'SURVIVED THE HUNT \u00B7 IT WAITS',
    });
  }

  /* ---- input ---- */
  function onMove(e: PointerEvent): void {
    const b = root.getBounds();
    pointerX = clamp((e.clientX - b.left) / Math.max(1, b.width), 0, 1) * TRACK_W;
  }
  function digitOf(key: string): number {
    const n = parseInt(key, 10);
    return n >= 1 && n <= OPTIONS ? n : 0;
  }
  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      finish(escaped(hpDeltaAfterTicks(catches), 'THE HUNT CONTINUES WITHOUT YOU'));
      return;
    }
    const n = digitOf(e.key);
    if (n) {
      e.preventDefault();
      choose(n - 1);
    }
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('keydown', onKey);

  /* ---- drawing ---- */
  function drawTerm(g: Graphics, x: number, ty: number, sc: number, prox: number): void {
    const px = (dx: number): number => x + dx * sc;
    const py = (dy: number): number => ty + dy * sc;
    // torso: broad metal shoulders narrowing to waist
    g.poly([
      px(-26), py(16), px(-20), py(-8), px(-13), py(-14), px(13), py(-14),
      px(20), py(-8), px(26), py(16), px(12), py(22), px(-12), py(22),
    ]).fill({ color: 0x39424c });
    g.rect(px(-9), py(-6), 18 * sc, 20 * sc).fill({ color: 0x4d5866 });
    // skull head
    g.poly([
      px(-11), py(-15), px(-12), py(-33), px(-6), py(-35), px(6), py(-35),
      px(12), py(-33), px(11), py(-15), px(6), py(-11), px(0), py(-12), px(-6), py(-11),
    ]).fill({ color: 0x8b97a3 });
    g.rect(px(-8), py(-26), 16 * sc, 5 * sc).fill({ color: 0x20262d }); // visor slit
    const glow = 0.5 + prox * 0.5;
    g.rect(px(-6), py(-25), 4 * sc, 3 * sc).fill({ color: 0xff2038, alpha: glow });
    g.rect(px(2), py(-25), 4 * sc, 3 * sc).fill({ color: 0xff2038, alpha: glow });
    g.rect(px(-7), py(-19), 14 * sc, 3 * sc).fill({ color: 0x6b7683 }); // jaw hint
  }

  function proxOf(p: number): number {
    return clamp(p / LANES, 0, 1);
  }

  function draw(): void {
    const g = ui.dynG;
    g.clear();
    const prox = proxOf(pos);
    const ty = TRACK_Y + GATE_H + laneH * clamp(pos, 0, LANES - 0.08) + laneH / 2;
    drawTerm(g, TRACK_X + colX, ty, 0.8 + prox * 0.5, prox);

    // your cursor mark in the safe zone + aim line
    if (pointerX >= 0) {
      const mx = TRACK_X + clamp(pointerX, 14, TRACK_W - 14);
      const sy = TRACK_Y + TRACK_H - SAFE_H;
      g.poly([mx, sy + 10, mx - 8, sy + SAFE_H - 8, mx + 8, sy + SAFE_H - 8]).fill({ color: 0x00e68a });
      g.moveTo(mx, sy).lineTo(mx, TRACK_Y + TRACK_H).stroke({ width: 1, color: 0x00e68a, alpha: 0.4 });
    }

    // exposure meter above the safe strip (visible fairness cue)
    if (exposureMs > 0) {
      const w = (TRACK_W - 40) * clamp(exposureMs / EXPOSE_TICK_MS, 0, 1);
      g.rect(TRACK_X + 20, TRACK_Y + TRACK_H - SAFE_H - 10, w, 4).fill({ color: 0xff2038, alpha: 0.85 });
    }

    // gutter-only red eye scan (right edge), rate-limited, static without motion
    const eyeX = TRACK_X + TRACK_W - 12;
    const eyeY = TRACK_Y + 14;
    if (clock < flashUntil && MOTION) {
      g.circle(eyeX, eyeY, 7).fill({ color: 0xff2038, alpha: 0.85 });
    } else {
      g.circle(eyeX, eyeY, 5).fill({ color: 0x5c0713, alpha: 0.9 });
    }

    // localized catch flash over the track only
    ui.flash.alpha = clock < flashUntil && MOTION ? 0.16 : 0;
    ui.callout.visible = clock < calloutUntil;
  }

  /* ---- clock: Pixi ticker only, never Date.now ---- */
  const onTick = (tk: Ticker): void => {
    if (dead) return;
    const dtMs = Math.min(50, tk.deltaMS);
    clock += dtMs;
    if (clock >= budgetMs) {
      surviveExit();
      return;
    }
    if (nextPatternAt >= 0 && clock >= nextPatternAt) {
      nextPatternAt = -1;
      loadPattern();
    }
    if (doorArmAt >= 0 && clock >= doorArmAt) {
      doorArmAt = -1;
      escapeDoor();
    }
    const marching = clock >= pauseUntil;
    if (marching) {
      marchClock += dtMs;
      const prev = pos;
      pos = Math.min(LANES, pos + P.v * (dtMs / 1000));
      stepAccum += pos - prev;
      while (stepAccum >= 0.5) {
        stepAccum -= 0.5;
        thud(0.06 + proxOf(pos) * 0.3, false);
        if (proxOf(pos) > 0.66 && clock - lastFlashAt >= EYE_MIN_GAP_MS) {
          lastFlashAt = clock; // proximity flare shares the scan rate limiter
          flashUntil = clock + EYE_FLASH_MS;
        }
      }
      if (pos >= LANES) {
        exposureMs += dtMs;
        if (exposureMs >= EXPOSE_TICK_MS) catchPlayer();
      }
    }
    /* column chase: pursuer with a finite translate rate */
    const target =
      pointerX >= 0
        ? clamp(pointerX, 26, TRACK_W - 52)
        : TRACK_W / 2 + TRACK_W * 0.3 * Math.sin(driftW * (marchClock / 1000) + colPhase);
    if (colX < 0) colX = target;
    const maxDx = P.colRate * (dtMs / 1000);
    colX += clamp(target - colX, -maxDx, maxDx);

    /* pattern budget */
    if (pat && !patLocked && clock - patStart > P.patMs) advanceOrExpire(true);

    /* scheduled gutter scans */
    if (clock >= nextScanAt) {
      nextScanAt = clock + scanPeriod;
      if (clock - lastFlashAt >= EYE_MIN_GAP_MS) {
        lastFlashAt = clock;
        flashUntil = clock + EYE_FLASH_MS;
      }
    }

    draw();
    ui.foot.text =
      `DIST ${pos.toFixed(1)}/${LANES} LANES \u00B7 SOLVED ${solved}/${P.need}` +
      ` \u00B7 CAUGHT ${catches} (\u2212${dmg} HP) \u00B7 ESC BAILS`;
    if (slamWinAt >= 0 && clock >= slamWinAt) slamEscape();
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('keydown', onKey);
    try {
      void actx?.close();
    } catch {
      /* optional */
    }
    actx = null;
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  /* depth curves: march speed AND column-chase turn rate scale up; the
     pattern budget shrinks; need stays inside [2,4] */
  for (let d = 1; d <= 14; d++) {
    const a = paramsFor(d);
    const b = paramsFor(d + 1);
    if (b.v <= a.v) failures.push(`march speed not increasing at depth ${d}`);
    if (b.colRate < a.colRate) failures.push(`turn-rate not monotone at depth ${d}`);
    if (b.patMs > a.patMs) failures.push(`pattern budget not shrinking at depth ${d}`);
    if (a.need < 2 || a.need > 4) failures.push(`need out of band at depth ${d}: ${a.need}`);
  }
  if (paramsFor(12).colRate <= paramsFor(1).colRate) failures.push('turn-rate scaling broken');
  if (diffFor(1) !== 1 || diffFor(7) !== 2 || diffFor(13) !== 3 || diffFor(30) !== 5) {
    failures.push('diffFor ladder wrong');
  }
  if (escapeFor(1) !== 180 || escapeFor(5) !== 580) failures.push('escapeFor wrong');

  /* exposure math: -10 first contact, -6 per re-crossing, -60 floor */
  if (tickDamage(1) !== 10 || tickDamage(2) !== 6 || tickDamage(9) !== 6) {
    failures.push('exposure tick ladder wrong');
  }
  if (damageAfterTicks(0) !== 0 || damageAfterTicks(3) !== 22) failures.push('damage accumulation wrong');
  for (let n = 0; n <= 40; n++) {
    if (hpDeltaAfterTicks(n) < HP_FLOOR) failures.push(`hp floor breached at ${n} ticks`);
  }
  if (hpDeltaAfterTicks(40) !== HP_FLOOR) failures.push('hp clamp wrong');
  /* worst case by clock: a tick needs 2000 ms of exposure and after each tick
     it stalls CATCH_STALL_MS — ticks <= floor(budget/2000), and even that
     pathological ceiling must stay survivable from full hp thanks to the clamp */
  const budget45 = CAP_S * 1000 - SETTLE_MS;
  const maxTicks = Math.floor(budget45 / EXPOSE_TICK_MS);
  if (100 + hpDeltaAfterTicks(maxTicks) <= 0) failures.push('worst-case run can reach 0 hp from full');

  /* budget fit: escaping must fit inside every legal round timer */
  for (let depth = 1; depth <= 14; depth++) {
    for (const timerLen of [15, 30, 45, 60]) {
      const p = paramsFor(depth);
      const budget = Math.min(Math.max(5, timerLen), CAP_S) * 1000 - SETTLE_MS;
      const fastestEscapeMs =
        READY_MS +
        p.need * 600 /* min human solve */ +
        (p.need - 1) * SOLVE_STALL_MS +
        p.need * PUSHBACK_STALL_MS +
        500 /* door arm */ +
        850; /* slam window */
      if (fastestEscapeMs >= budget) {
        failures.push(`escape impossible depth=${depth} timerLen=${timerLen} need=${p.need}`);
      }
    }
  }

  /* summaries stay within the punch limit at every exit */
  const summaries = [
    'DOOR SLAM \u00B7 ESCAPED THE HUNT',
    'SURVIVED THE HUNT \u00B7 IT WAITS',
    'THE HUNT CONTINUES WITHOUT YOU',
  ];
  if (summaries.some((s) => s.length > 64)) failures.push('summary exceeds 64 chars');

  /* 300-seed probe: determinism, option integrity, glyph rails, param fit */
  for (let seed = 1; seed <= 300; seed++) {
    const depth = 1 + ((seed * 7) % 14);
    const timerLen = 15 + ((seed * 11) % 46);
    const salted = (seed ^ HUNT_SALT) >>> 0;
    const a = makeSeqPattern(mulberry32(salted));
    const b = makeSeqPattern(mulberry32(salted));
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      failures.push(`pattern nondeterministic seed=${seed}`);
      break;
    }
    if (a.answerIdx < 0 || a.options[a.answerIdx] !== a.answerVal) {
      failures.push(`answer missing/misplaced seed=${seed}`);
      break;
    }
    if (new Set(a.options).size !== OPTIONS) {
      failures.push(`options not unique seed=${seed}`);
      break;
    }
    if (a.kind === 0 && a.options.some((o) => o < 1)) {
      failures.push(`count option renders empty seed=${seed}`);
      break;
    }
    if (a.kind !== 0 && a.vals.includes(a.answerVal)) {
      failures.push(`answer leaks a seen value seed=${seed}`);
      break;
    }
    /* glyph rails: primitive marks, readable density, finite geometry */
    const glyphs: HuntGlyph[] = [
      ...a.vals.map((v) => ({ kind: a.kind, val: v })),
      ...a.options.map((v) => ({ kind: a.kind, val: v })),
    ];
    let bad = false;
    for (const gl of glyphs) {
      const prims = glyphPrims(gl);
      if (prims.length < 1 || prims.length > 24) {
        failures.push(`glyph density out of band kind=${gl.kind} val=${gl.val}`);
        bad = true;
        break;
      }
      for (const pr of prims) {
        const xs = pr.k === 'line' ? [pr.x1, pr.x2] : [pr.x];
        const ys = pr.k === 'line' ? [pr.y1, pr.y2] : [pr.y];
        if ([...xs, ...ys].some((c) => !Number.isFinite(c))) {
          failures.push(`glyph coord non-finite kind=${gl.kind} val=${gl.val}`);
          bad = true;
          break;
        }
      }
      if (bad) break;
    }
    if (bad) break;
    /* params fit this seed's tier too */
    const p = paramsFor(depth);
    const budget = Math.min(Math.max(5, timerLen), CAP_S) * 1000 - SETTLE_MS;
    if (p.patMs * p.fastFrac <= 0 || p.v <= 0 || p.colRate <= 0 || budget <= READY_MS + 3000) {
      failures.push(`param/budget fit broken depth=${depth} timerLen=${timerLen}`);
      break;
    }
  }
  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/scenes/takeovers/terminator2.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/terminator2.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] THE HUNT OK (300 seeds)' : `[selftest] THE HUNT FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
