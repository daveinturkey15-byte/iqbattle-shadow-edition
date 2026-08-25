/**
 * SLOTS — ONE-ARMED GOD takeover scene (v2 port of modes/slots.js, mechanic not
 * code).
 *
 * MECHANIC — three spins, you stop every reel yourself:
 *   Space / Enter / click stops the leftmost spinning reel (one press per reel,
 *   three per spin, three spins). An un-stopped reel auto-stops after 7 s so
 *   the round always resolves inside ctx.timerLen.
 *   The landed payline pays: PAIR = small, TRIPLE = big, THREE STARS = JACKPOT
 *   (+10 hp bonus). Total paid 0 across all spins -> correct false ("the house
 *   wins"); anything paid -> correct true.
 *
 * DEPTH CURVES (pure, self-tested):
 *   diff = clamp(1 + floor(depth/6), 1, 5)
 *   VOID skulls per reel = floor((diff-1)*1.25)  (0 -> 25% of the strip)
 *   paytables scale UP with depth: pair 10*diff · triple 45*diff ·
 *   jackpot 250 + 350*diff (= 600 at diff 1, parity with the frozen build)
 *
 * DETERMINISM: three strips of 20 are composed ONCE from mulberry32(seed^TAG)
 * in FIXED draw order (stars -> voids -> filler per reel). The landing offset
 * is a pure function of the pressed 40 ms tick index and a seed-derived salt:
 * idx = (tickIndex*7 + salt[reel]) mod 20. No Math.random, no Date.now.
 *
 * FAIRNESS RAILS: payline glow only (no fullscreen flashes); paytable always
 * on screen; copy never taunts and never claims rigging; whole-cabinet tap
 * target; Esc bails NEUTRAL; every text >= 11 px.
 */
import { Sprite, Texture, Ticker } from 'pixi.js';
import type { Container, Text } from 'pixi.js';

import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import type { Prim } from '../../glyphs.ts';
import { tileCanvas } from '../../glyphs.ts';
import { panel, text, spriteFrom } from '../game.ts';
import { mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested)                                            */
/* ------------------------------------------------------------------ */

export const REELS = 3;
export const STRIP_LEN = 20;
export const SPIN_TICK_MS = 40;
export const AUTO_STOP_MS = 7000;

/** STAR = wildcard + jackpot symbol · VOID = skull-equivalent, breaks pairs. */
export const STAR = 0;
export const VOID = 1;
export const SYMBOL_COUNT = 6;

const SLOT_SALT = 0x0a11aced;

export function diffFor(depth: number): number {
  return Math.min(5, Math.max(1, 1 + Math.floor(Math.max(1, depth) / 6)));
}

export interface Paytable {
  pair: number;
  triple: number;
  jackpot: number;
}

/** Payout tables scale UP with depth; jackpot = 600 at diff 1 (v1 parity). */
export function paytableFor(diff: number): Paytable {
  return { pair: 10 * diff, triple: 45 * diff, jackpot: 250 + 350 * diff };
}

export interface SlotStrips {
  /** strips[reel][symbolIndex] -> symbol id */
  strips: number[][];
  salts: number[];
}

/**
 * Seeded strips — FIXED DRAW ORDER (do not reorder):
 *   per reel: salt rng(), then strip composition top-down:
 *   stars (2..3) -> voids (floor((diff-1)*1.25)) -> filler (uniform 2..5)
 */
export function buildStrips(seed: number, depth: number): SlotStrips {
  const rng = mulberry32((seed ^ SLOT_SALT) >>> 0);
  const diff = diffFor(depth);
  const voidsPerReel = Math.floor((diff - 1) * 1.25);
  const strips: number[][] = [];
  const salts: number[] = [];
  for (let r = 0; r < REELS; r++) {
    salts.push(Math.floor(rng() * STRIP_LEN));
    const strip: number[] = [];
    for (let i = 0; i < 2 + Math.floor(rng() * 2); i++) strip.push(STAR);
    for (let i = 0; i < voidsPerReel; i++) strip.push(VOID);
    while (strip.length < STRIP_LEN) strip.push(2 + Math.floor(rng() * (SYMBOL_COUNT - 2)));
    strips.push(strip);
  }
  return { strips, salts };
}

/** Landing offset: pure function of pressed tick index and the reel salt. */
export function landingIdx(tickIndex: number, salt: number): number {
  return (((tickIndex * 7 + salt) % STRIP_LEN) + STRIP_LEN) % STRIP_LEN;
}

export type LineKind = 'jackpot' | 'triple' | 'pair' | 'none';

/** Evaluate one payline. Stars wildcard; VOIDs pay nothing and break pairs. */
export function evalLine(line: number[], pay: Paytable): { kind: LineKind; amount: number } {
  if (line.length !== REELS || line.some((s) => s < 0 || s >= SYMBOL_COUNT)) return { kind: 'none', amount: 0 };
  const stars = line.filter((s) => s === STAR).length;
  if (stars === REELS) return { kind: 'jackpot', amount: pay.jackpot };
  let best = 0;
  for (let sym = 2; sym < SYMBOL_COUNT; sym++) {
    best = Math.max(best, line.filter((s) => s === sym).length + stars);
  }
  if (best >= REELS) return { kind: 'triple', amount: pay.triple };
  if (best === REELS - 1) return { kind: 'pair', amount: pay.pair };
  return { kind: 'none', amount: 0 };
}

export const POINTS_CAP = 500;

export interface SlotsVerdict {
  correct: boolean | null;
  points: number;
  hpDelta: number;
}

/** Verdict: anything paid = win (jackpot adds hp) · nothing paid = fail. */
export function verdictFor(total: number, jackpot: boolean): SlotsVerdict {
  if (total > 0) {
    return { correct: true, points: Math.min(total, POINTS_CAP), hpDelta: jackpot ? 10 : 0 };
  }
  return { correct: false, points: -40, hpDelta: -10 };
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

const SPINS = 3;

/** Primitive glyph per symbol id (DNA marks only — structure carries meaning). */
function symbolPrims(sym: number): Prim[] {
  switch (sym) {
    case STAR:
      return [
        { k: 'diamond', x: 50, y: 50, s: 14 },
        { k: 'line', x1: 50, y1: 22, x2: 50, y2: 32 },
        { k: 'line', x1: 50, y1: 68, x2: 50, y2: 78 },
        { k: 'line', x1: 22, y1: 50, x2: 32, y2: 50 },
        { k: 'line', x1: 68, y1: 50, x2: 78, y2: 50 },
      ];
    case VOID:
      return [
        { k: 'tri', x: 50, y: 42, s: 11 },
        { k: 'dot', x: 50, y: 70, r: 5 },
      ];
    case 2:
      return [{ k: 'diamond', x: 50, y: 50, s: 13 }];
    case 3:
      return [{ k: 'tri', x: 50, y: 52, s: 12 }];
    case 4:
      return [{ k: 'dot', x: 50, y: 50, r: 9 }];
    default:
      return [
        { k: 'line', x1: 38, y1: 38, x2: 62, y2: 62 },
        { k: 'line', x1: 38, y1: 62, x2: 62, y2: 38 },
      ];
  }
}

interface ReelWin {
  top: Sprite;
  mid: Sprite;
  bot: Sprite;
}

interface LiveUi {
  status: Text;
  progress: Text;
  wins: ReelWin[];
}

export function mountSlots(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const hue = T.boardHues[(ctx.seed >>> 3) % T.boardHues.length];
  const settle = onceResolve(ctx.onDone);
  const pay = paytableFor(diffFor(ctx.depth));
  const { strips, salts } = buildStrips(ctx.seed, ctx.depth);

  /* ---- static chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  text(root, 'ONE-ARMED GOD', STAGE_W / 2 - 116, 84, 30, hue, true);
  text(root, 'SPACE / CLICK STOPS EACH REEL · THREE SPINS', STAGE_W / 2 - 186, 130, 15, T.muted);

  // always-visible paytable (fairness rail)
  text(
    root,
    `PAIR ${pay.pair}   TRIPLE ${pay.triple}   THREE STARS ${pay.jackpot} (+10 HP)`,
    STAGE_W / 2 - 218, 162, 15, T.gold, true,
  );

  /* ---- reel windows ---- */
  const cell = 120;
  const gap = 26;
  const rowW = REELS * cell + (REELS - 1) * gap;
  const ox = (STAGE_W - rowW) / 2;
  const oy = 230;
  panel(root, ox - 30, oy - 36, rowW + 60, cell * 3 + 150);

  const symTex = Array.from({ length: SYMBOL_COUNT }, (_, s) =>
    Texture.from(tileCanvas(symbolPrims(s), s === VOID ? '#e0245e' : hue, cell)),
  );

  const ui: LiveUi = {
    status: text(root, '', STAGE_W / 2 - 140, oy + cell * 3 + 52, 21, T.ink, true),
    progress: text(root, '', STAGE_W / 2 - 130, oy + cell * 3 + 96, 15, T.muted),
    wins: [],
  };

  for (let r = 0; r < REELS; r++) {
    const wx = ox + r * (cell + gap);
    const win: ReelWin = {
      top: new Sprite(symTex[0]),
      mid: new Sprite(symTex[0]),
      bot: new Sprite(symTex[0]),
    };
    win.top.x = wx; win.mid.x = wx; win.bot.x = wx;
    win.top.y = oy; win.mid.y = oy + cell; win.bot.y = oy + cell * 2;
    root.addChild(win.top, win.mid, win.bot);
    ui.wins.push(win);
  }

  /* ---- reel state ----
   * Spinning reel r shows strip[-phase[r]] in the middle row (it climbs
   * backwards through the strip). A stopped reel freezes at frozenIdx[r].
   */
  const phase = [0, 0, 0];
  const frozen: Array<number | null> = [0, 0, 0];

  function shownSym(reel: number, pos: number): number {
    return strips[reel][(((pos % STRIP_LEN) + STRIP_LEN) % STRIP_LEN)];
  }

  function redrawReels(): void {
    for (let r = 0; r < REELS; r++) {
      const base = frozen[r] ?? -phase[r];
      const w = ui.wins[r];
      w.top.texture = symTex[shownSym(r, base - 1)];
      w.mid.texture = symTex[shownSym(r, base)];
      w.bot.texture = symTex[shownSym(r, base + 1)];
      w.top.tint = 0x8a8a8a;
      w.bot.tint = 0x8a8a8a;
      w.mid.tint = 0xffffff;
    }
  }

  function refreshProgress(): void {
    ui.progress.text = `SPIN ${Math.min(spin + 1, SPINS)}/${SPINS} · BANKED ${total}`;
  }

  /* ---- state machine ---- */
  let spin = 0; // completed spin count while idle · current spin index while spinning
  let total = 0;
  let jackpotHit = false;
  let spinning = false;
  let stopCount = 0;
  let tickAcc = 0;
  let tickIndex = 0;
  let settleMs = 600; // pause between spins / before verdict
  let dead = false;

  function finish(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function startSpin(): void {
    spinning = true;
    stopCount = 0;
    tickAcc = 0;
    tickIndex = 0;
    phase[0] = 1; phase[1] = 2; phase[2] = 3; // staggered starts
    frozen[0] = null; frozen[1] = null; frozen[2] = null;
    ui.status.text = 'SPINNING… STOP THE REELS';
    refreshProgress();
  }

  function stopCurrentReel(): void {
    const r = stopCount;
    frozen[r] = landingIdx(Math.max(6, tickIndex), salts[r]);
    stopCount++;
    redrawReels();
    if (stopCount >= REELS) resolveSpin();
  }

  function resolveSpin(): void {
    spinning = false;
    const line = [0, 1, 2].map((r) => shownSym(r, frozen[r] ?? 0));
    const res = evalLine(line, pay);
    total += res.amount;
    if (res.kind === 'jackpot') jackpotHit = true;
    ui.status.text =
      res.kind === 'jackpot' ? 'JACKPOT!'
      : res.kind === 'triple' ? `TRIPLE — PAYS ${res.amount}`
      : res.kind === 'pair' ? `PAIR — PAYS ${res.amount}`
      : 'THE GOD KEEPS IT';
    refreshProgress();
    settleMs = 1100;
    // next tick block transitions to the following spin or the verdict
    spin++;
  }

  function endGame(): void {
    const v = verdictFor(total, jackpotHit);
    const label =
      jackpotHit ? `JACKPOT — THE GOD PAYS ${v.points}`
      : v.correct ? `THE GOD PAYS ${v.points}`
      : 'THE HOUSE WINS';
    finish({ ...v, summary: label });
  }

  const onTick = (tk: Ticker): void => {
    if (dead) return;
    const dt = tk.deltaMS;

    if (!spinning) {
      settleMs -= dt;
      if (settleMs <= 0) {
        if (spin >= SPINS) {
          endGame();
          return;
        }
        startSpin();
      }
      return;
    }

    tickAcc += dt;
    while (tickAcc >= SPIN_TICK_MS && spinning) {
      tickAcc -= SPIN_TICK_MS;
      tickIndex++;
      for (let r = stopCount; r < REELS; r++) phase[r]++;
      redrawReels();
      if (tickIndex * SPIN_TICK_MS >= AUTO_STOP_MS) stopCurrentReel();
    }
  };
  Ticker.shared.add(onTick);

  function onPress(): void {
    if (dead) return;
    if (spinning && stopCount < REELS) stopCurrentReel();
  }
  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      finish(escaped(0, 'LEFT THE CABINET'));
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onPress();
    }
  }
  root.eventMode = 'static';
  root.on('pointerdown', onPress);
  window.addEventListener('keydown', onKey);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.off('pointerdown', onPress);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  redrawReels();
  refreshProgress();
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // strip determinism + composition bounds
  for (let seed = 1; seed <= 80; seed++) {
    for (const depth of [1, 5, 11, 30]) {
      const diff = diffFor(depth);
      const a = buildStrips(seed * 104729 + depth, depth);
      const b = buildStrips(seed * 104729 + depth, depth);
      if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`strips nondeterministic seed=${seed}`);
      for (const strip of a.strips) {
        if (strip.length !== STRIP_LEN) failures.push(`strip length ${strip.length}`);
        const voids = strip.filter((s) => s === VOID).length;
        if (voids !== Math.floor((diff - 1) * 1.25)) failures.push(`void count wrong depth=${depth}`);
        const stars = strip.filter((s) => s === STAR).length;
        if (stars < 2 || stars > 3) failures.push(`star count ${stars} out of band`);
        if (strip.some((s) => s < 0 || s >= SYMBOL_COUNT)) failures.push('symbol out of range');
      }
      if (a.salts.some((s) => s < 0 || s >= STRIP_LEN)) failures.push('salt out of range');
    }
  }

  // diff curve clamps
  if (diffFor(0) !== 1 || diffFor(300) !== 5) failures.push('diff clamp broken');

  // landing offset purity + range
  for (let t = 0; t < 500; t += 7) {
    for (let salt = 0; salt < STRIP_LEN; salt += 3) {
      const idx = landingIdx(t, salt);
      if (idx < 0 || idx >= STRIP_LEN) failures.push('landing out of range');
      if (idx !== landingIdx(t, salt)) failures.push('landing impure');
    }
  }

  // payline evaluation
  const p1 = paytableFor(1);
  if (evalLine([5, 5, STAR], p1).kind !== 'triple') failures.push('wildcard should complete a triple');
  if (evalLine([5, STAR, 3], p1).kind !== 'pair') failures.push('wildcard-assisted pair missed');
  if (evalLine([STAR, STAR, STAR], p1).kind !== 'jackpot') failures.push('triple stars not jackpot');
  if (evalLine([STAR, STAR, STAR], p1).amount !== 600) failures.push('jackpot should be 600 at diff 1');
  if (evalLine([STAR, 2, 2], p1).kind !== 'triple') failures.push('star wildcard triple missed');
  if (evalLine([STAR, 3, VOID], p1).kind !== 'pair') failures.push('star pair missed');
  if (evalLine([VOID, VOID, 2], p1).kind !== 'none') failures.push('voids must break pairs');
  if (evalLine([2, 3, 4], p1).kind !== 'none') failures.push('no false triple');
  if (evalLine([2, 2, 2], p1).kind !== 'triple') failures.push('plain triple missed');
  if (evalLine([STAR, STAR, 2], p1).kind !== 'triple') failures.push('two-star wildcard triple missed');

  // paytables scale up, stay positive
  let prev = { pair: 0, triple: 0, jackpot: 0 };
  for (let d = 1; d <= 5; d++) {
    const pd = paytableFor(d);
    if (pd.pair <= prev.pair || pd.triple <= prev.triple || pd.jackpot <= prev.jackpot) {
      failures.push(`paytable not monotonic at diff=${d}`);
    }
    if (pd.pair <= 0 || pd.triple <= 0 || pd.jackpot <= 0) failures.push('nonpositive pay');
    prev = pd;
  }

  // verdict bounds: worst-case nine triples must clamp, fail parity negative
  const maxTotal = paytableFor(5).triple * SPINS;
  const vMax = verdictFor(maxTotal, false);
  if (vMax.correct !== true || vMax.points > POINTS_CAP) failures.push('win points cap broken');
  const vJack = verdictFor(paytableFor(3).jackpot, true);
  if (vJack.hpDelta !== 10) failures.push('jackpot hp bonus missing');
  const vFail = verdictFor(0, false);
  if (vFail.correct !== false || vFail.points >= 0 || vFail.hpDelta !== -10) failures.push('fail verdict wrong');

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;
