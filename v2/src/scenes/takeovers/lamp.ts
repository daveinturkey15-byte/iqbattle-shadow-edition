/**
 * THE LAMP — takeover stage (NEW; owner spec: "a genie and a lamp" — a wish
 * with a catch). Not a port: original mechanic built to the v2 contract.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * REGISTER ME (main.ts / meta/onboard.ts are Main-owned — NOT edited here):
 *   stage id     : 'lamp'
 *   display name : 'THE LAMP'
 *   goal card    : 'THE LAMP SELLS EVERY DOOR. EACH WISH PRINTS ITS PRICE IN
 *                   TIME, BLOOD OR GOLD. THE MARK YOU NEED IS RARELY BEHIND
 *                   THE CHEAP ONE.'                        (128 ch <= GOAL_MAX)
 *   controls     : 'CLICK A WISH TO GRANT (Q/W/E) · CLICK A TILE OR KEYS 1-6'
 *                                                          (56 ch <= CONTROLS_MAX)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * MECHANIC
 * Six answer tiles are laid out behind THREE WISHES, two tiles per wish. One
 * tile matches the posted mark. Every tile is face-up from the first frame —
 * there is no hidden information — but a tile is SEALED until you grant the
 * wish that owns it, and every wish prints its full price on its own card
 * BEFORE you commit:
 *   WISH OF TIME  — seconds cut straight off your own clock (cutMs(depth))
 *   WISH OF BLOOD — hp, taken the instant it is granted (bloodHp(depth))
 *   WISH OF GOLD  — your payout multiplied by GOLD_MUL for the rest of the
 *                   round (the price is on the score, never on the board)
 * The catch is that the price is real and the lamp is not generous with
 * placement: the matching mark sits behind the HARSHEST door ~70 % of seeds,
 * and the cheapest door is stocked with NEAR MISSES (same kind ±1 mark, or the
 * same count in another kind) that read as the answer at a glance. Reading the
 * board beats taking the cheap wish. Nothing is charged that was not printed:
 * costLine() and the code that applies the cost are asserted equal in
 * selfTest(), because a hidden cost would be a cheat and a stated cost the
 * player takes anyway is a good round.
 *
 * You may grant more than one wish. Every grant charges again and the
 * multipliers compound (mulFor), so the skilled line is ONE wish, the right
 * one: that pays CLEAN_BONUS on top.
 *
 * POINTS CURVE vs par(d) = 100*d + 40 (parFor imported from floorfall.ts):
 *   win   = round(round(par * min(1, 0.45 + 0.55*leftFrac)) * mul)
 *           [+25 CLEAN LAMP when exactly one wish was granted]
 *   wrong = 0 pts, hpDelta - 10
 *   timeout / Esc = neutral (correct:null), 0 pts, hpDelta as spent
 *           (the wishes were granted; the lamp does not refund)
 *
 * Determinism: target, cost permutation, answer door, answer slot and every
 * decoy come from ctx.seed via an own mulberry32 in FIXED DRAW ORDER (target
 * kind, target n, cost shuffle, door roll, alt door, slot roll, then tiles in
 * wish-major order). Ambient smoke has its own cosmetic seed. No Math.random,
 * no Date.now — the clock is Pixi's shared ticker delta.
 *
 * Self-limits to ctx.timerLen (the WISH OF TIME can only ever pull the
 * deadline IN, never out, and always leaves MIN_TAIL_MS to act — applyCut).
 * StageResult settles exactly once via onceResolve; container emptied on done.
 *
 * Fairness rails: every price printed before commit; grant feedback is a
 * card-local 180 ms wash (never a fullscreen strobe); ambient smoke gated
 * behind IQB_MOTION / prefers-reduced-motion (motion off = one static plume,
 * rules identical); one hue per board from T.boardHues; DNA primitive marks
 * only; all text >= 12 px; Esc bails NEUTRAL; full keyboard parity
 * (Q/W/E grant, 1-6 pick) so the stage never requires a pointer.
 */
import { Container, Graphics, Sprite, Texture, Ticker } from 'pixi.js';
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

const LAMP_SALT = 0x1a3f9c0d;
const SETTLE_MS = 700;

/** The WISH OF TIME can never leave you less than this to act. */
export const MIN_TAIL_MS = 3000;
/** WISH OF GOLD: payout multiplier for the rest of the round. */
export const GOLD_MUL = 0.45;
/** Paid for resolving on exactly one granted wish. */
export const CLEAN_BONUS = 25;
/** Wrong tile sting. */
export const WRONG_HP = 10;
/** Probability the matching mark sits behind the harshest door. */
export const HARSH_BIAS = 0.7;

export type LampCost = 'time' | 'blood' | 'gold';
export const LAMP_COSTS: readonly LampCost[] = ['time', 'blood', 'gold'];

/** WISH OF BLOOD price in hp, charged the instant the wish is granted. */
export function bloodHp(depth: number): number {
  const d = Math.max(1, Math.min(20, Math.floor(depth)));
  return Math.min(16, 8 + Math.floor(d / 2));
}

/** WISH OF TIME price in ms, cut off the round's own deadline. */
export function cutMs(depth: number): number {
  const d = Math.max(1, Math.min(20, Math.floor(depth)));
  return Math.min(9000, 5000 + 400 * d);
}

/**
 * How much a door hurts, on one comparable scale, so "harshest" and
 * "cheapest" are well defined. The +0.1 / +0.2 offsets make the order STRICT
 * at every depth (asserted in selfTest) — a tie would make the harsh-door
 * bias ambiguous.
 */
export function harshness(cost: LampCost, depth: number): number {
  switch (cost) {
    case 'time': return cutMs(depth) / 1000;
    case 'gold': return (1 - GOLD_MUL) * 20 + 0.1;
    default: return bloodHp(depth) + 0.2;
  }
}

/**
 * The exact line printed on the wish card. selfTest() asserts it carries the
 * same number the scene actually charges — a price that drifts from its
 * label is the one thing this stage may never do.
 */
export function costLine(cost: LampCost, depth: number): string {
  switch (cost) {
    case 'time': return `COST: ${(cutMs(depth) / 1000).toFixed(1)}s OFF YOUR CLOCK`;
    case 'blood': return `COST: ${bloodHp(depth)} HP, TAKEN NOW`;
    default: return `COST: PAYOUT ×${GOLD_MUL.toFixed(2)}`;
  }
}

export function wishTitle(cost: LampCost): string {
  return cost === 'time' ? 'WISH OF TIME' : cost === 'blood' ? 'WISH OF BLOOD' : 'WISH OF GOLD';
}

/** Compounded payout multiplier for the wishes granted so far. */
export function mulFor(granted: readonly LampCost[]): number {
  let m = 1;
  for (const c of granted) if (c === 'gold') m *= GOLD_MUL;
  return m;
}

/** A decoy that reads as the answer at a glance: one mark off, or one kind off. */
export function isNearMiss(target: Chip, c: Chip): boolean {
  if (c.kind === target.kind) return Math.abs(c.n - target.n) === 1;
  return c.n === target.n;
}

export interface LampWish {
  cost: LampCost;
  tiles: [Chip, Chip];
}

export interface LampBoard {
  target: Chip;
  wishes: [LampWish, LampWish, LampWish];
  /** which door owns the matching mark */
  answerWish: number;
  /** 0 = left tile · 1 = right tile */
  answerSlot: number;
  /** door with the lowest harshness — stocked with near misses */
  cheapWish: number;
  /** door with the highest harshness — holds the answer HARSH_BIAS of seeds */
  harshWish: number;
}

const chipKey = (c: Chip): string => `${c.kind}:${c.n}`;

/**
 * Seeded board — FIXED DRAW ORDER (do not reorder):
 *   target.kind, target.n, cost shuffle (2 draws), door roll, alt door,
 *   answer slot, then tiles in wish-major / slot-minor order.
 */
export function buildLamp(seed: number, depth: number): LampBoard {
  const rng = mulberry32((seed ^ LAMP_SALT) >>> 0);

  const target: Chip = { kind: Math.floor(rng() * CHIP_KINDS), n: 2 + Math.floor(rng() * 6) };

  const costs = LAMP_COSTS.slice();
  for (let i = costs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [costs[i], costs[j]] = [costs[j], costs[i]];
  }

  const rank = costs.map((c) => harshness(c, depth));
  let harshWish = 0;
  let cheapWish = 0;
  for (let i = 1; i < 3; i++) {
    if (rank[i] > rank[harshWish]) harshWish = i;
    if (rank[i] < rank[cheapWish]) cheapWish = i;
  }

  // unconditional draws keep the schedule seed-stable whichever branch wins
  const others = [0, 1, 2].filter((i) => i !== harshWish);
  const doorRoll = rng();
  const altDoor = others[Math.floor(rng() * 2)];
  const answerWish = doorRoll < HARSH_BIAS ? harshWish : altDoor;
  const answerSlot = rng() < 0.5 ? 0 : 1;

  const used = new Set<string>([chipKey(target)]);

  const randomChip = (): Chip => {
    for (let t = 0; t < 64; t++) {
      const c: Chip = { kind: Math.floor(rng() * CHIP_KINDS), n: 2 + Math.floor(rng() * 6) };
      if (!used.has(chipKey(c))) {
        used.add(chipKey(c));
        return c;
      }
    }
    // deterministic sweep — 36 combos exist and at most 6 are ever taken
    for (let k = 0; k < CHIP_KINDS; k++) {
      for (let n = 2; n <= 7; n++) {
        const c = { kind: k, n };
        if (!used.has(chipKey(c))) {
          used.add(chipKey(c));
          return c;
        }
      }
    }
    return { kind: 0, n: 2 };
  };

  const nearMiss = (): Chip => {
    const cands: Chip[] = [];
    if (target.n > 2) cands.push({ kind: target.kind, n: target.n - 1 });
    if (target.n < 7) cands.push({ kind: target.kind, n: target.n + 1 });
    for (let k = 0; k < CHIP_KINDS; k++) if (k !== target.kind) cands.push({ kind: k, n: target.n });
    const free = cands.filter((c) => !used.has(chipKey(c)));
    if (free.length === 0) return randomChip();
    const c = free[Math.floor(rng() * free.length)];
    used.add(chipKey(c));
    return c;
  };

  const wishes: LampWish[] = [];
  for (let w = 0; w < 3; w++) {
    const tiles: Chip[] = [];
    for (let s = 0; s < 2; s++) {
      if (w === answerWish && s === answerSlot) tiles.push({ ...target });
      else tiles.push(w === cheapWish ? nearMiss() : randomChip());
    }
    wishes.push({ cost: costs[w], tiles: [tiles[0], tiles[1]] });
  }

  return {
    target,
    wishes: [wishes[0], wishes[1], wishes[2]],
    answerWish,
    answerSlot,
    cheapWish,
    harshWish,
  };
}

/**
 * WISH OF TIME. Pulls the deadline IN only: never past the current budget,
 * never closer than minTail from where the clock already stands.
 */
export function applyCut(budgetMs: number, clockMs: number, cut: number, minTail: number): number {
  return Math.min(budgetMs, Math.max(clockMs + minTail, budgetMs - cut));
}

/** Payout for a correct tile. mul comes from mulFor(granted). */
export function scoreLamp(depth: number, leftFrac: number, mul: number, clean: boolean): number {
  const lf = Math.max(0, Math.min(1, leftFrac));
  const base = Math.round(parFor(depth) * Math.min(1, 0.45 + 0.55 * lf));
  return Math.max(0, Math.round(base * mul) + (clean ? CLEAN_BONUS : 0));
}

/** The lamp itself, in DNA primitives (100x100 cell space). Parody, no likeness. */
export function lampPrims(): Prim[] {
  return [
    { k: 'diamond', x: 46, y: 60, s: 19 },
    { k: 'line', x1: 64, y1: 54, x2: 88, y2: 42 },
    { k: 'line', x1: 88, y1: 42, x2: 83, y2: 53 },
    { k: 'line', x1: 27, y1: 56, x2: 12, y2: 66 },
    { k: 'line', x1: 12, y1: 66, x2: 27, y2: 73 },
    { k: 'line', x1: 22, y1: 82, x2: 70, y2: 82 },
    { k: 'dot', x: 91, y: 33, r: 4 },
  ];
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

const CARD_W = 440;
const CARD_H = 306;
const CARD_Y = 300;
const CARD_GAP = 40;
const TILE_SIZE = 150;
const TILE_GAP = 24;
const BAR_W = 1400;
const ROMAN = ['I', 'II', 'III'] as const;
const GRANT_KEYS = ['q', 'w', 'e'] as const;
const FLASH_MS = 180;
const HINT_MS = 1300;

function motionOn(): boolean {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('IQB_MOTION') === '0') return false;
  } catch { /* gate optional */ }
  try {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  } catch { /* gate optional */ }
  return true;
}

function costColor(cost: LampCost): string {
  return cost === 'time' ? T.orange : cost === 'blood' ? T.bad : T.gold;
}

interface WishUi {
  wash: Sprite;
  seal: ReturnType<typeof text>;
  button: Sprite;
  buttonLabel: ReturnType<typeof text>;
  tiles: [Sprite, Sprite];
  flashAt: number;
}

export function mountLamp(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const motion = motionOn();
  const depth = Math.max(1, Math.floor(ctx.depth));
  const hue = T.boardHues[ctx.seed % T.boardHues.length];
  const settle = onceResolve(ctx.onDone);
  const board = buildLamp(ctx.seed, depth);
  const smokeRng = mulberry32((ctx.seed ^ 0x5eed1a37) >>> 0);

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  text(root, 'THE LAMP', 60, 34, 30, T.gold, true);
  text(root, 'THE PRICE IS ON THE CARD. THE LAMP NEVER CHARGES WHAT IT DID NOT PRINT.', 60, 74, 13, T.muted);

  const lamp = spriteFrom(cellCanvas(lampPrims(), hue, 170));
  lamp.x = 74;
  lamp.y = 108;
  root.addChild(lamp);

  const smoke = new Graphics();
  root.addChild(smoke);
  const puffs: Array<{ x: number; y: number; r: number; v: number; p: number }> = [];
  for (let i = 0; i < 7; i++) {
    puffs.push({
      x: 74 + 0.9 * 170 + (smokeRng() - 0.5) * 26,
      y: 108 + 0.32 * 170,
      r: 3 + smokeRng() * 5,
      v: 10 + smokeRng() * 16,
      p: smokeRng(),
    });
  }

  text(root, 'MATCH THIS MARK', STAGE_W / 2 - 82, 96, 14, T.muted);
  const tgt = spriteFrom(tileCanvas(chipPrims(board.target.kind, board.target.n), hue, TILE_SIZE));
  tgt.x = (STAGE_W - TILE_SIZE) / 2;
  tgt.y = 120;
  root.addChild(tgt);

  const bar = new Sprite(Texture.WHITE);
  bar.x = (STAGE_W - BAR_W) / 2;
  bar.y = 272;
  bar.height = 6;
  bar.width = BAR_W;
  bar.tint = 0x22d3a5;
  root.addChild(bar);

  const status = text(root, '', 60, 828, 17, T.ink, true);
  const hint = text(root, '', 60, 860, 13, T.orange);
  text(
    root,
    'CLICK A WISH TO GRANT (Q / W / E) · CLICK A TILE OR KEYS 1–6 · ESC BAILS NEUTRAL',
    STAGE_W / 2 - 300,
    860,
    13,
    T.muted,
  );

  /* ---- wish cards ---- */
  const cardsX = (STAGE_W - (3 * CARD_W + 2 * CARD_GAP)) / 2;
  const uis: WishUi[] = [];

  board.wishes.forEach((wish, w) => {
    const cx = cardsX + w * (CARD_W + CARD_GAP);
    const card = panel(root, cx, CARD_Y, CARD_W, CARD_H);

    text(card, `WISH ${ROMAN[w]} · ${wishTitle(wish.cost)}`, 24, 16, 20, T.gold, true);
    text(card, costLine(wish.cost, depth), 24, 48, 15, costColor(wish.cost), true);

    const button = new Sprite(Texture.WHITE);
    button.x = (CARD_W - 240) / 2;
    button.y = 80;
    button.width = 240;
    button.height = 36;
    button.tint = 0x2d7cff;
    button.alpha = 0.24;
    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.on('pointerdown', () => grant(w));
    card.addChild(button);
    const buttonLabel = text(card, `GRANT — ${GRANT_KEYS[w].toUpperCase()}`, 0, 88, 15, T.ink, true);
    buttonLabel.x = (CARD_W - buttonLabel.width) / 2;

    const tx = (CARD_W - (2 * TILE_SIZE + TILE_GAP)) / 2;
    const tiles: Sprite[] = [];
    wish.tiles.forEach((chip, s) => {
      const spr = spriteFrom(tileCanvas(chipPrims(chip.kind, chip.n), hue, TILE_SIZE));
      spr.x = tx + s * (TILE_SIZE + TILE_GAP);
      spr.y = 134;
      spr.alpha = 0.3;
      spr.eventMode = 'static';
      spr.cursor = 'pointer';
      spr.on('pointerdown', () => pick(w * 2 + s));
      card.addChild(spr);
      text(card, String(w * 2 + s + 1), spr.x + 8, spr.y + TILE_SIZE - 24, 13, T.muted);
      tiles.push(spr);
    });

    const seal = text(card, 'SEALED UNTIL GRANTED', 0, 272, 13, T.muted);
    seal.x = (CARD_W - seal.width) / 2;

    const wash = new Sprite(Texture.WHITE);
    wash.width = CARD_W;
    wash.height = CARD_H;
    wash.tint = 0x22d3a5;
    wash.alpha = 0;
    card.addChild(wash);

    uis.push({ wash, seal, button, buttonLabel, tiles: [tiles[0], tiles[1]], flashAt: -1 });
  });

  /* ---- goal card (first GOAL_MS: input locked, clock frozen) ----
   * Mirrors the onboard goal card requested at the top of this file. */
  const GOAL_W = 620;
  const goalCard = panel(root, (STAGE_W - GOAL_W) / 2, 320, GOAL_W, 190);
  text(goalCard, 'THE LAMP', 28, 20, 26, T.gold, true);
  text(goalCard, 'EVERY DOOR HAS A PRICE ON IT.', 28, 62, 15, T.ink);
  text(goalCard, 'THE MARK YOU NEED IS RARELY BEHIND THE CHEAP ONE.', 28, 90, 14, T.muted);
  text(goalCard, 'Q/W/E GRANT · 1–6 PICK · ESC BAILS NEUTRAL', 28, 118, 13, T.muted);
  const unlockTxt = text(goalCard, 'INPUT UNLOCKS IN 2…', 28, 150, 14, T.good, true);

  /* ---- state ---- */
  const initialBudget = Math.max(6000, ctx.timerLen * 1000 - GOAL_MS) - SETTLE_MS;
  let budgetMs = initialBudget;
  let clock = 0;
  let introLeft = GOAL_MS;
  let hpDelta = 0;
  let dead = false;
  let hintLeft = 0;
  const granted: boolean[] = [false, false, false];
  const grantedCosts: LampCost[] = [];

  function refreshHud(): void {
    const names = grantedCosts.length === 0 ? 'NONE' : grantedCosts.map((c) => wishTitle(c).replace('WISH OF ', '')).join(' + ');
    const mul = mulFor(grantedCosts);
    status.text = `GRANTED ${names} · PAYOUT ×${mul.toFixed(2)} · HP ${hpDelta}`;
    status.style.fill = hpDelta < 0 ? T.bad : T.ink;
  }

  function say(msg: string): void {
    hint.text = msg;
    hintLeft = HINT_MS;
  }

  function finish(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function grant(w: number): void {
    if (dead || introLeft > 0 || granted[w]) return;
    const cost = board.wishes[w].cost;
    granted[w] = true;
    grantedCosts.push(cost);
    if (cost === 'time') {
      budgetMs = applyCut(budgetMs, clock, cutMs(depth), MIN_TAIL_MS);
      say(`THE LAMP TOOK ${(cutMs(depth) / 1000).toFixed(1)}s OFF YOUR CLOCK`);
    } else if (cost === 'blood') {
      hpDelta -= bloodHp(depth);
      say(`THE LAMP TOOK ${bloodHp(depth)} HP`);
    } else {
      say(`THE LAMP TOOK A CUT — PAYOUT ×${mulFor(grantedCosts).toFixed(2)}`);
    }
    const ui = uis[w];
    ui.tiles[0].alpha = 1;
    ui.tiles[1].alpha = 1;
    ui.seal.text = 'GRANTED';
    ui.seal.style.fill = T.good;
    ui.seal.x = (CARD_W - ui.seal.width) / 2;
    ui.button.tint = 0x22d3a5;
    ui.button.alpha = 0.3;
    ui.buttonLabel.text = 'GRANTED';
    ui.buttonLabel.x = (CARD_W - ui.buttonLabel.width) / 2;
    // card-local wash, <= 180 ms, never fullscreen (instant in motion-off)
    ui.wash.alpha = 0.22;
    ui.flashAt = motion ? clock : -1;
    if (!motion) ui.wash.alpha = 0;
    refreshHud();
  }

  function pick(i: number): void {
    if (dead || introLeft > 0) return;
    const w = Math.floor(i / 2);
    const s = i % 2;
    if (!granted[w]) {
      say(`WISH ${ROMAN[w]} IS NOT YOURS YET — ${costLine(board.wishes[w].cost, depth)}`);
      return;
    }
    const leftFrac = budgetMs > 0 ? Math.max(0, Math.min(1, (budgetMs - clock) / budgetMs)) : 0;
    if (w === board.answerWish && s === board.answerSlot) {
      const clean = grantedCosts.length === 1;
      finish({
        correct: true,
        points: scoreLamp(depth, leftFrac, mulFor(grantedCosts), clean),
        hpDelta,
        summary: clean ? 'ONE WISH, ONE MARK — CLEAN LAMP' : 'GRANTED, AT THE LAMP’S PRICE',
      });
    } else {
      finish({
        correct: false,
        points: 0,
        hpDelta: hpDelta - WRONG_HP,
        summary: 'THE LAMP GRANTED EXACTLY WHAT YOU ASKED FOR',
      });
    }
  }

  /* ---- input ---- */
  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      finish(escaped(hpDelta, 'YOU PUT THE LAMP DOWN'));
      return;
    }
    if (introLeft > 0) return;
    const g = GRANT_KEYS.indexOf(e.key.toLowerCase() as (typeof GRANT_KEYS)[number]);
    if (g >= 0) {
      grant(g);
      return;
    }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 6) pick(n - 1);
  }
  window.addEventListener('keydown', onKey);

  /* ---- clock: Pixi ticker only, never Date.now ---- */
  function paintSmoke(t: number): void {
    smoke.clear();
    for (const p of puffs) {
      const k = motion ? (p.p + (t / 1000) * (p.v / 60)) % 1 : p.p;
      const y = p.y - k * 88;
      smoke.circle(p.x, y, p.r * (1 - k * 0.4)).fill({ color: 0x9aa7ba, alpha: 0.16 * (1 - k) });
    }
  }

  const onTick = (tk: Ticker): void => {
    if (dead) return;
    const dt = tk.deltaMS;
    if (introLeft > 0) {
      introLeft -= dt;
      if (introLeft <= 0) goalCard.visible = false;
      else unlockTxt.text = `INPUT UNLOCKS IN ${Math.ceil(introLeft / 1000)}…`;
      paintSmoke(0);
      return;
    }
    clock += dt;
    if (clock >= budgetMs) {
      finish(escaped(hpDelta, 'THE LAMP COOLED IN YOUR HANDS'));
      return;
    }
    if (hintLeft > 0) {
      hintLeft -= dt;
      if (hintLeft <= 0) hint.text = '';
    }
    for (const ui of uis) {
      if (ui.flashAt >= 0) {
        const k = (clock - ui.flashAt) / FLASH_MS;
        ui.wash.alpha = k >= 1 ? 0 : 0.22 * (1 - k);
        if (k >= 1) ui.flashAt = -1;
      }
    }
    const left = Math.max(0, (budgetMs - clock) / initialBudget);
    bar.width = Math.max(2, BAR_W * Math.min(1, left));
    bar.tint = left < 0.25 ? 0xff2e88 : 0x22d3a5;
    if (motion) paintSmoke(clock);
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.removeChildren().forEach((c: Container) => c.destroy({ children: true }));
  }

  paintSmoke(0);
  refreshHud();
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const key = (c: Chip): string => `${c.kind}:${c.n}`;

  /* ---- price curve: strictly ordered, monotone, capped ---- */
  for (let d = 1; d <= 25; d++) {
    const hs = LAMP_COSTS.map((c) => harshness(c, d));
    if (new Set(hs).size !== 3) failures.push(`harshness ties at depth ${d}: ${hs.join(',')}`);
    if (bloodHp(d) < 8 || bloodHp(d) > 16) failures.push(`bloodHp out of band at depth ${d}`);
    if (cutMs(d) < 5000 || cutMs(d) > 9000) failures.push(`cutMs out of band at depth ${d}`);
    if (d > 1) {
      if (bloodHp(d) < bloodHp(d - 1)) failures.push(`bloodHp not monotone at depth ${d}`);
      if (cutMs(d) < cutMs(d - 1)) failures.push(`cutMs not monotone at depth ${d}`);
    }
  }
  if (bloodHp(0) !== bloodHp(1) || cutMs(-5) !== cutMs(1)) failures.push('depth clamp broken');

  /* ---- PRINTED PRICE == CHARGED PRICE (the stage's core honesty rail) ---- */
  for (let d = 1; d <= 20; d++) {
    if (!costLine('blood', d).includes(String(bloodHp(d)))) {
      failures.push(`blood cost line hides the ${bloodHp(d)} hp it charges at depth ${d}`);
    }
    if (!costLine('time', d).includes((cutMs(d) / 1000).toFixed(1))) {
      failures.push(`time cost line hides the ${cutMs(d)} ms it charges at depth ${d}`);
    }
    if (!costLine('gold', d).includes(GOLD_MUL.toFixed(2))) {
      failures.push('gold cost line hides its multiplier');
    }
  }

  /* ---- board: deterministic, well formed, exactly one answer ---- */
  const doorHits = [0, 0, 0];
  const harshHits = { yes: 0, total: 0 };
  for (let seed = 1; seed <= 600; seed++) {
    const depth = 1 + ((seed * 13) % 14);
    const a = buildLamp(seed, depth);
    const b = buildLamp(seed, depth);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      failures.push(`board nondeterministic seed=${seed}`);
      break;
    }
    const all = a.wishes.flatMap((w) => w.tiles);
    if (all.length !== 6) failures.push(`seed=${seed}: expected 6 tiles`);
    if (new Set(all.map(key)).size !== 6) {
      failures.push(`seed=${seed}: duplicate tile on the board`);
      break;
    }
    if (all.some((c) => c.kind < 0 || c.kind >= CHIP_KINDS || c.n < 2 || c.n > 7)) {
      failures.push(`seed=${seed}: chip out of range`);
      break;
    }
    if (all.filter((c) => key(c) === key(a.target)).length !== 1) {
      failures.push(`seed=${seed}: board must hold exactly one matching mark`);
      break;
    }
    if (key(a.wishes[a.answerWish].tiles[a.answerSlot]) !== key(a.target)) {
      failures.push(`seed=${seed}: answerWish/answerSlot does not point at the match`);
      break;
    }
    if (new Set(a.wishes.map((w) => w.cost)).size !== 3) {
      failures.push(`seed=${seed}: cost kinds must be a permutation`);
      break;
    }
    // the cheap door is stocked with near misses, so it is tempting and wrong
    a.wishes[a.cheapWish].tiles.forEach((c, s) => {
      if (a.cheapWish === a.answerWish && s === a.answerSlot) return;
      if (!isNearMiss(a.target, c)) failures.push(`seed=${seed}: cheap door tile is not a near miss`);
    });
    // cheap/harsh doors really are the extremes of harshness
    const hr = a.wishes.map((w) => harshness(w.cost, depth));
    if (hr[a.cheapWish] !== Math.min(...hr) || hr[a.harshWish] !== Math.max(...hr)) {
      failures.push(`seed=${seed}: cheap/harsh door mislabelled`);
      break;
    }
    doorHits[a.answerWish]++;
    harshHits.total++;
    if (a.answerWish === a.harshWish) harshHits.yes++;
    if (failures.length > 0) break;
  }
  if (doorHits.some((n) => n === 0)) failures.push(`some door is never the answer: ${doorHits.join('/')}`);
  const harshRate = harshHits.total > 0 ? harshHits.yes / harshHits.total : 0;
  if (harshRate < 0.55 || harshRate > 0.85) {
    failures.push(`harsh-door bias ${harshRate.toFixed(3)} outside 0.55..0.85 (HARSH_BIAS=${HARSH_BIAS})`);
  }

  /* ---- near-miss predicate ---- */
  if (!isNearMiss({ kind: 2, n: 4 }, { kind: 2, n: 5 })) failures.push('near miss: same kind ±1 must qualify');
  if (!isNearMiss({ kind: 2, n: 4 }, { kind: 5, n: 4 })) failures.push('near miss: same count other kind must qualify');
  if (isNearMiss({ kind: 2, n: 4 }, { kind: 5, n: 7 })) failures.push('near miss: far chip must not qualify');
  if (isNearMiss({ kind: 2, n: 4 }, { kind: 2, n: 4 })) failures.push('near miss: the target is not its own near miss');

  /* ---- applyCut: pulls in only, always leaves a tail ---- */
  for (const budget of [6000, 12000, 30000, 60000]) {
    for (const clockMs of [0, 1000, 5000, 11000, 29000]) {
      if (clockMs >= budget) continue;
      for (const cut of [0, 3000, 5000, 9000, 90000]) {
        const out = applyCut(budget, clockMs, cut, MIN_TAIL_MS);
        if (out > budget) failures.push(`applyCut extended the deadline (${out} > ${budget})`);
        if (out < clockMs + Math.min(MIN_TAIL_MS, budget - clockMs)) {
          failures.push(`applyCut left less than the ${MIN_TAIL_MS} ms tail (${out - clockMs} ms)`);
        }
        if (cut > 0 && budget - clockMs > MIN_TAIL_MS + cut && out !== budget - cut) {
          failures.push('applyCut did not charge the full stated cut when there was room');
        }
      }
    }
  }
  // repeated cuts can never spin the deadline past the clock
  {
    let b = 30000;
    for (let i = 0; i < 20; i++) b = applyCut(b, 4000, cutMs(10), MIN_TAIL_MS);
    if (b !== 4000 + MIN_TAIL_MS) failures.push(`repeated cuts settle wrong (${b})`);
  }

  /* ---- multiplier compounding ---- */
  if (mulFor([]) !== 1) failures.push('no wish must pay full');
  if (mulFor(['time', 'blood']) !== 1) failures.push('time/blood must not touch the multiplier');
  if (Math.abs(mulFor(['gold']) - GOLD_MUL) > 1e-12) failures.push('gold multiplier wrong');
  if (Math.abs(mulFor(['gold', 'gold']) - GOLD_MUL * GOLD_MUL) > 1e-12) failures.push('gold must compound');

  /* ---- points curve vs par(d) = 100*d + 40 ---- */
  for (let d = 1; d <= 12; d++) {
    const par = parFor(d);
    if (par !== 100 * d + 40) failures.push('parFor drifted from 100*d + 40');
    const best = scoreLamp(d, 1, 1, true);
    const worst = scoreLamp(d, 0, GOLD_MUL, false);
    if (best > 1.4 * par) failures.push(`best win ${best} above 140 % of par ${par} at depth ${d}`);
    if (best < par) failures.push(`clean full-clock win ${best} below par ${par} at depth ${d}`);
    if (worst <= 0) failures.push(`worst win ${worst} must still beat a timeout at depth ${d}`);
    if (scoreLamp(d, 1, 1, false) >= best) failures.push('CLEAN LAMP bonus not applied');
    if (scoreLamp(d, 1, 1, true) - scoreLamp(d, 1, 1, false) !== CLEAN_BONUS) {
      failures.push('CLEAN LAMP bonus is not CLEAN_BONUS');
    }
    if (scoreLamp(d, 1, GOLD_MUL, false) >= scoreLamp(d, 1, 1, false)) {
      failures.push('a granted gold wish must pay strictly less');
    }
    // monotone non-decreasing in time left
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const v = scoreLamp(d, i / 20, 1, false);
      if (v < prev) failures.push(`payout not monotone in leftFrac at depth ${d}`);
      prev = v;
    }
    if (scoreLamp(d, -3, 1, false) !== scoreLamp(d, 0, 1, false)) failures.push('leftFrac not clamped low');
    if (scoreLamp(d, 9, 1, false) !== scoreLamp(d, 1, 1, false)) failures.push('leftFrac not clamped high');
  }

  /* ---- the lamp glyph is DNA primitives only ---- */
  const okKinds = new Set(['tri', 'dot', 'diamond', 'line']);
  if (lampPrims().some((p) => !okKinds.has(p.k))) failures.push('lampPrims uses a non-DNA primitive');
  if (lampPrims().length < 5) failures.push('lampPrims is too sparse to read as a lamp');

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/scenes/takeovers/lamp.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/lamp.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] THE LAMP OK' : `[selftest] THE LAMP FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
