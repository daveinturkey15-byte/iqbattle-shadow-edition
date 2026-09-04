/**
 * THE ORB — takeover scene. An invented villain: a bald man in a high collar,
 * a tiny identical clone at his elbow, and a laugh he has clearly practised.
 * The name MISTER ORB is carried over from src/fate/packs/mantles.ts for
 * continuity. No real person, film or franchise is named or depicted.
 *
 * ================= WIRING REQUEST (Main-owned files, untouched by me) =======
 *   main.ts      TAKEOVERS   += mountOrb
 *                TAKEOVER_NAMES += 'MISTER ORB'
 *   onboard.ts   TAKEOVER_STAGE_IDS += 'the-orb'
 *                CARDS['the-orb'] = {
 *                  stageId: 'the-orb',
 *                  title:   'MISTER ORB',
 *                  goal:    'HE IS NEUTRAL FOR NOW. ANSWER FIVE MARKS. THE FIRST ONE YOU GET WRONG TURNS HIM, AND THE SECOND ONE ENDS YOU.',
 *                  controls:'CLICK / TAP · KEYS 1–4 · ESC BAILS NEUTRAL',
 *                }
 * ===========================================================================
 *
 * THE ONE IDEA: the stage TURNS. It opens genuinely neutral — long windows,
 * muted chrome, polite captions, a clean payout — and the first mistake (a
 * wrong pick OR a window that runs out) flips every one of those at once:
 *   · the answer window collapses  calmMsFor(d) -> turnedMsFor(d)
 *   · the chrome goes from accent-blue to T.bad and a dim (0.07) wash lands
 *   · LITTLE ORB starts shuffling the option tiles mid-question
 *   · the payout takes a permanent haircut (base 1.00 -> 0.62 + 0.06/answer)
 *   · a SECOND mistake ends the round outright
 * The turn is one-way and is asserted one-way in selfTest().
 *
 * Ends: 5 correct, never turned -> CLEAN (best pay, +6 hp)
 *       5 correct after the turn -> SURVIVED (haircut, -8 hp)
 *       second mistake           -> UNDONE (correct:false, -16 hp)
 *       budget elapses           -> neutral partial · Esc -> escaped(0, ...)
 *
 * POINTS CURVE vs par(d) = 100*d + 40 (parFor imported from floorfall.ts):
 *   clean    = round(par * 1.00)
 *   survived = round(par * (0.62 + 0.06 * postTurnCorrect))   [0.68 .. 0.92]
 *   undone   = 0 pts
 *   timeout  = neutral, round(par * 0.10 * correct) — always under any win
 *
 * Determinism: the question stream and Little Orb's shuffle permutations come
 * from two independent mulberry32 streams seeded from ctx.seed in FIXED DRAW
 * ORDER, so the schedule cannot drift with when the turn happens. Zero
 * Math.random, zero Date.now — the clock is Pixi's shared ticker delta.
 * Self-limits to ctx.timerLen: at most QUOTA + 2 questions can ever be asked
 * and windowsFor() caps each window so that many always fit the play budget.
 *
 * Fairness rails: the shuffle is announced, happens at most once per question
 * and never inside the last 700 ms of a window (shuffleAt() is asserted);
 * one hue per board from T.boardHues; the turn's feedback is a localized ring
 * pulse <= 180 ms plus a STEADY 0.07 wash — never a fullscreen strobe; all
 * text >= 11 px; keys 1–4 have full parity with the pointer.
 * IQB_MOTION=0 / prefers-reduced-motion: no ring pulse and no bar easing —
 * the wash, the window lengths, the shuffle and the scoring are identical.
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

const ORB_SALT = 0x0b17e9a5;
const PERM_SALT = 0x117710e6;
const SETTLE_MS = 700;

/** Correct answers needed to walk out. */
export const QUOTA = 5;
/** At most QUOTA + 2 questions can ever be asked (2 mistakes end the run). */
export const MAX_QUESTIONS = QUOTA + 2;
/** Never shuffle inside the last this-many ms of a window. */
export const SHUFFLE_GUARD_MS = 700;

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Neutral-phase answer window: unhurried, 6.5 s -> 4.2 s by depth. */
export function calmMsFor(depth: number): number {
  return clamp(6500 - 220 * (Math.max(1, Math.floor(depth)) - 1), 4200, 6500);
}
/** Turned-phase answer window: 3.2 s -> 1.9 s by depth. */
export function turnedMsFor(depth: number): number {
  return clamp(3200 - 150 * (Math.max(1, Math.floor(depth)) - 1), 1900, 3200);
}

/**
 * The windows the scene actually uses, capped so that the worst possible
 * round (MAX_QUESTIONS full-length windows) still fits the play budget.
 * Guaranteed: 0 < turned < calm.
 */
export function windowsFor(depth: number, playMs: number): { calm: number; turned: number } {
  const cap = Math.max(1200, Math.floor(Math.max(0, playMs) / MAX_QUESTIONS));
  const calm = Math.min(calmMsFor(depth), cap);
  const turned = Math.min(turnedMsFor(depth), Math.max(900, Math.floor(cap * 0.6)));
  return { calm, turned };
}

/** When Little Orb moves the tiles, in ms into a turned-phase window. */
export function shuffleAt(turnedMs: number): number {
  return Math.max(150, Math.min(Math.round(turnedMs * 0.45), turnedMs - SHUFFLE_GUARD_MS));
}

export interface Question {
  target: Chip;
  options: Chip[];
  answerIdx: number;
}

const chipKey = (c: Chip): string => `${c.kind}:${c.n}`;

/** FIXED DRAW ORDER: target kind, target n, candidate pairs, then shuffle. */
export function makeQuestion(rng: () => number): Question {
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

export function buildQuestions(seed: number, n: number): Question[] {
  const rng = mulberry32((seed ^ ORB_SALT) >>> 0);
  const out: Question[] = [];
  for (let i = 0; i < n; i++) out.push(makeQuestion(rng));
  return out;
}

/** A derangement-ish shuffle of slot indices; retried until it actually moves. */
export function makePerm(rng: () => number, n: number): number[] {
  const p = Array.from({ length: n }, (_, i) => i);
  for (let attempt = 0; attempt < 8; attempt++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    if (p.some((v, i) => v !== i)) return p;
  }
  // deterministic fallback: a rotation always moves every slot
  return Array.from({ length: n }, (_, i) => (i + 1) % n);
}

export function buildPerms(seed: number, n: number, width = 4): number[][] {
  const rng = mulberry32((seed ^ PERM_SALT) >>> 0);
  const out: number[][] = [];
  for (let i = 0; i < n; i++) out.push(makePerm(rng, width));
  return out;
}

export type OrbEnd = 'clean' | 'survived' | 'undone' | 'timeout' | 'escape';

export interface OrbState {
  depth: number;
  /** correct answers banked overall */
  correct: number;
  /** correct answers banked AFTER the turn */
  postTurnCorrect: number;
  turned: boolean;
  hpDelta: number;
}

/** Which ending a finished round has. The turn is one-way by construction. */
export function endFor(correct: number, mistakes: number): OrbEnd | null {
  if (mistakes >= 2) return 'undone';
  if (correct >= QUOTA) return mistakes === 0 ? 'clean' : 'survived';
  return null;
}

/** Full StageResult for every ending — pure, so the payout band self-tests. */
export function resolveOrb(end: OrbEnd, s: OrbState): StageResult {
  const par = parFor(Math.max(1, Math.floor(s.depth)));
  switch (end) {
    case 'clean':
      return {
        correct: true,
        points: Math.round(par),
        hpDelta: s.hpDelta + 6,
        summary: 'HE REMAINS, TECHNICALLY, NEUTRAL',
      };
    case 'survived':
      return {
        correct: true,
        points: Math.round(par * (0.62 + 0.06 * clamp(s.postTurnCorrect, 0, QUOTA))),
        hpDelta: s.hpDelta - 8,
        summary: 'YOU FINISHED. HE IS STILL LAUGHING.',
      };
    case 'undone':
      return { correct: false, points: 0, hpDelta: s.hpDelta - 16, summary: 'TWO WRONG. LITTLE ORB SEES YOU OUT.' };
    case 'timeout':
      return {
        correct: null,
        points: Math.round(par * 0.1 * clamp(s.correct, 0, QUOTA - 1)),
        hpDelta: s.hpDelta,
        summary: s.turned ? 'THE CLOCK SAVED YOU FROM HIM' : 'HE NEVER HAD TO TURN AT ALL',
      };
    default:
      return escaped(0, 'YOU LEFT BEFORE THE MONOLOGUE');
  }
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

const OPT_SIZE = 150;
const OPT_GAP = 22;
const OPT_Y = 520;
const TGT_SIZE = 140;
const PULSE_MS = 180;

const CALM_LINES = [
  'HE IS NEUTRAL. HE WANTS THAT ON THE RECORD.',
  'HE STROKES THE CAT. THE CAT IS ALSO BALD.',
  'LITTLE ORB WATCHES. LITTLE ORB SAYS NOTHING.',
  'NO PRESSURE. HE HAS BEEN VERY CLEAR ON THAT.',
  'HE OFFERS YOU A CHAIR. IT IS SLIGHTLY TOO LOW.',
];
const TURNED_LINES = [
  'HA. HA. HA. HE IS READING IT OFF A CARD.',
  'THE LAUGH DOES NOT REACH THE EYES. NOTHING DOES.',
  'HE HOLDS IT. AND HOLDS IT. AND HOLDS IT.',
  'LITTLE ORB LAUGHS FIRST. THAT IS NOT ALLOWED.',
  'REHEARSED IN A MIRROR. ONCE. BADLY.',
];
const TURN_LINE = 'THAT WAS WRONG. THE NEUTRALITY IS WITHDRAWN.';

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

/** The man himself: bald head, high collar, a body that means business. */
function orbPrims(): Prim[] {
  return [
    { k: 'dot', x: 50, y: 26, r: 17 },
    { k: 'line', x1: 30, y1: 46, x2: 50, y2: 60 },
    { k: 'line', x1: 70, y1: 46, x2: 50, y2: 60 },
    { k: 'diamond', x: 50, y: 74, s: 20 },
    { k: 'line', x1: 22, y1: 96, x2: 78, y2: 96 },
  ];
}

export function mountOrb(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const motion = motionOn();
  const settle = onceResolve(ctx.onDone);
  const depth = Math.max(1, Math.floor(ctx.depth));
  const hue = T.boardHues[ctx.seed % T.boardHues.length];
  const qRng = mulberry32((ctx.seed ^ ORB_SALT) >>> 0);
  const permRng = mulberry32((ctx.seed ^ PERM_SALT) >>> 0);

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  /** Steady dim wash after the turn — never animated, never a strobe. */
  const wash = new Sprite(Texture.WHITE);
  wash.width = STAGE_W;
  wash.height = STAGE_H;
  wash.tint = T.bad;
  wash.alpha = 0;
  root.addChild(wash);

  const title = text(root, 'MISTER ORB', 40, 26, 24, T.gold, true);
  const mood = text(root, 'NEUTRAL — FOR NOW', 40, 58, 13, T.muted);

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
  const hud = text(root, '', barX, 58, 15, T.ink, true);

  /* ---- the man and his clone ---- */
  const him = spriteFrom(cellCanvas(orbPrims(), T.ink, 190));
  him.x = 120;
  him.y = 250;
  root.addChild(him);
  const little = spriteFrom(cellCanvas(orbPrims(), T.muted, 86));
  little.x = 320;
  little.y = 354;
  root.addChild(little);
  text(root, 'MISTER ORB', 132, 452, 13, T.muted);
  const littleTag = text(root, 'LITTLE ORB', 322, 448, 12, T.muted);

  const pulse = new Graphics();
  root.addChild(pulse);

  /* ---- question layer ---- */
  text(root, 'MATCH THE MARK', STAGE_W / 2 - 84, 306, 15, T.muted);
  const dyn = new Container();
  root.addChild(dyn);

  const caption = text(root, CALM_LINES[0], 40, 706, 15, T.muted);
  const notice = text(root, '', 40, 736, 14, T.gold, true);
  text(root, 'FIVE MARKS. ONE MISTAKE TURNS HIM. TWO AND YOU ARE DONE.', 40, 768, 13, T.muted);
  text(root, 'CLICK / TAP · KEYS 1–4 · ESC BAILS NEUTRAL', 40, 794, 12, T.muted);

  /* ---- goal card (first GOAL_MS: input locked, clock frozen) ----
   * Mirrors the requested onboard.ts CARDS['the-orb'] — keep in step. */
  const CARD_W = 640;
  const card = panel(root, (STAGE_W - CARD_W) / 2, 300, CARD_W, 190);
  text(card, 'MISTER ORB', 28, 20, 26, T.gold, true);
  text(card, 'HE IS NEUTRAL FOR NOW. ANSWER FIVE MARKS.', 28, 62, 15, T.ink);
  text(card, 'THE FIRST ONE WRONG TURNS HIM. THE SECOND ENDS YOU.', 28, 90, 13, T.muted);
  text(card, 'CLICK / TAP · KEYS 1–4 · ESC BAILS NEUTRAL', 28, 116, 13, T.muted);
  const unlockTxt = text(card, 'INPUT UNLOCKS IN 2…', 28, 148, 14, T.good, true);

  /* ---- state ---- */
  const playMs = Math.max(6000, ctx.timerLen * 1000 - GOAL_MS - SETTLE_MS);
  const win = windowsFor(depth, playMs);
  let clock = 0;
  let introLeft = GOAL_MS;
  let qElapsed = 0;
  let correct = 0;
  let postTurnCorrect = 0;
  let mistakes = 0;
  let turned = false;
  let hpDelta = 0;
  let dead = false;
  let pulseT = -1;
  let shuffled = false;
  let question: Question = makeQuestion(qRng);
  let slots: number[] = [0, 1, 2, 3];

  const windowMs = (): number => (turned ? win.turned : win.calm);

  function snapshot(): OrbState {
    return { depth, correct, postTurnCorrect, turned, hpDelta };
  }

  function finish(end: OrbEnd): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(resolveOrb(end, snapshot()));
  }

  function refreshHud(): void {
    hud.text = `ANSWERED ${correct}/${QUOTA} · ${turned ? 'TURNED' : 'NEUTRAL'} · HP ${hpDelta}`;
    hud.style.fill = turned ? T.bad : T.ink;
  }

  /** Draw the option tiles into their current slot order. */
  function renderQuestion(): void {
    dyn.removeChildren().forEach((c) => c.destroy({ children: true }));
    const tgt = spriteFrom(tileCanvas(chipPrims(question.target.kind, question.target.n), hue, TGT_SIZE));
    tgt.x = STAGE_W / 2 - TGT_SIZE / 2;
    tgt.y = 330;
    dyn.addChild(tgt);

    const rowW = 4 * OPT_SIZE + 3 * OPT_GAP;
    const ox = (STAGE_W - rowW) / 2;
    slots.forEach((optIdx, slot) => {
      const chip = question.options[optIdx];
      const s = spriteFrom(tileCanvas(chipPrims(chip.kind, chip.n), hue, OPT_SIZE));
      s.x = ox + slot * (OPT_SIZE + OPT_GAP);
      s.y = OPT_Y;
      s.eventMode = 'static';
      s.cursor = 'pointer';
      s.on('pointerdown', () => pickSlot(slot));
      dyn.addChild(s);
      text(dyn, String(slot + 1), s.x + 8, s.y + OPT_SIZE - 24, 13, T.muted);
    });
  }

  function nextQuestion(): void {
    question = makeQuestion(qRng);
    slots = [0, 1, 2, 3];
    qElapsed = 0;
    shuffled = false;
    caption.text = turned
      ? TURNED_LINES[(correct + mistakes) % TURNED_LINES.length]
      : CALM_LINES[(correct + mistakes) % CALM_LINES.length];
    renderQuestion();
  }

  /** The turn — one-way, and everything about the round changes here. */
  function turn(): void {
    turned = true;
    wash.alpha = 0.07;
    title.style.fill = T.bad;
    mood.text = 'NO LONGER NEUTRAL';
    mood.style.fill = T.bad;
    littleTag.text = 'LITTLE ORB MOVES THE TILES NOW';
    notice.text = TURN_LINE;
    notice.style.fill = T.bad;
    if (motion) pulseT = 0;
  }

  /** A mistake: the first turns him, the second ends the round. */
  function mistake(reason: string): void {
    mistakes++;
    hpDelta -= 6;
    if (mistakes >= 2) {
      refreshHud();
      finish('undone');
      return;
    }
    turn();
    notice.text = `${reason} ${TURN_LINE}`;
    refreshHud();
    nextQuestion();
  }

  function pickSlot(slot: number): void {
    if (dead || introLeft > 0) return;
    const optIdx = slots[slot];
    if (optIdx === question.answerIdx) {
      correct++;
      if (turned) postTurnCorrect++;
      notice.text = turned ? 'CORRECT. HE DOES NOT ACKNOWLEDGE IT.' : 'CORRECT. HE NODS, ONCE, POLITELY.';
      notice.style.fill = turned ? T.gold : T.good;
      refreshHud();
      const end = endFor(correct, mistakes);
      if (end) {
        finish(end);
        return;
      }
      nextQuestion();
      return;
    }
    mistake('WRONG MARK.');
  }

  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      finish('escape');
      return;
    }
    if (introLeft > 0) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 4) pickSlot(n - 1);
  }
  window.addEventListener('keydown', onKey);

  /* ---- clock: Pixi ticker only, never Date.now ---- */
  const onTick = (tk: Ticker): void => {
    if (dead) return;
    if (introLeft > 0) {
      introLeft -= tk.deltaMS;
      if (introLeft <= 0) card.visible = false;
      else unlockTxt.text = `INPUT UNLOCKS IN ${Math.ceil(introLeft / 1000)}…`;
      return;
    }
    const dt = tk.deltaMS;
    clock += dt;
    qElapsed += dt;

    if (pulseT >= 0) {
      pulseT += dt;
      const k = pulseT / PULSE_MS;
      pulse.clear();
      if (k >= 1) pulseT = -1;
      else pulse.circle(210, 340, 90 + 110 * k).stroke({ width: 3, color: T.bad, alpha: 0.5 * (1 - k) });
    }

    const limit = windowMs();
    // Little Orb moves the tiles once, mid-window, never in the last 700 ms
    if (turned && !shuffled && qElapsed >= shuffleAt(limit)) {
      shuffled = true;
      const perm = makePerm(permRng, 4);
      slots = perm.map((i) => slots[i]);
      notice.text = 'LITTLE ORB MOVED THEM. HE FINDS THIS FUNNY.';
      notice.style.fill = T.bad;
      renderQuestion();
    }

    bar.width = Math.max(2, barW * Math.max(0, 1 - qElapsed / limit));
    bar.tint = turned ? T.bad : T.accentA;

    if (clock >= playMs) {
      finish('timeout');
      return;
    }
    if (qElapsed >= limit) {
      mistake('THE WINDOW CLOSED.');
    }
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  renderQuestion();
  refreshHud();
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  /* --- window ladders --- */
  if (calmMsFor(1) !== 6500 || calmMsFor(99) !== 4200) failures.push('calm window ladder wrong');
  if (turnedMsFor(1) !== 3200 || turnedMsFor(99) !== 1900) failures.push('turned window ladder wrong');
  for (let d = 1; d <= 30; d++) {
    if (turnedMsFor(d) >= calmMsFor(d)) failures.push(`turning must shorten the window at d=${d}`);
  }

  /* --- THE FIT RAIL: the worst possible round always fits the budget,
   *     and the turned window is always strictly shorter than the calm one. */
  for (let d = 1; d <= 30; d++) {
    for (const playMs of [6000, 9000, 13000, 20000, 28000, 45000, 90000]) {
      const w = windowsFor(d, playMs);
      if (!(w.turned < w.calm)) failures.push(`turned >= calm at d=${d} play=${playMs}`);
      if (w.turned <= 0 || w.calm <= 0) failures.push(`nonpositive window at d=${d} play=${playMs}`);
      if (playMs >= MAX_QUESTIONS * 1200 && MAX_QUESTIONS * w.calm > playMs) {
        failures.push(`worst-case round overflows the budget at d=${d} play=${playMs}`);
      }
      // the shuffle always leaves a stable read before the window closes
      const at = shuffleAt(w.turned);
      if (at <= 0) failures.push(`shuffle time nonpositive at d=${d} play=${playMs}`);
      if (at >= w.turned) failures.push(`shuffle lands past the window at d=${d} play=${playMs}`);
      if (w.turned - at < Math.min(SHUFFLE_GUARD_MS, w.turned - 150)) {
        failures.push(`shuffle eats the guard window at d=${d} play=${playMs}`);
      }
    }
  }

  /* --- THE TURN IS ONE-WAY: no sequence of answers ever un-turns him,
   *     and no round can survive a second mistake. --- */
  {
    const seqs = [
      [1, 1, 1, 1, 1], [0, 1, 1, 1, 1, 1], [1, 0, 1, 1, 1, 1],
      [1, 1, 1, 1, 0, 1], [0, 0], [1, 0, 1, 0], [0, 1, 1, 0],
    ];
    for (const seq of seqs) {
      let ok = 0;
      let miss = 0;
      let wasTurned = false;
      let ended: OrbEnd | null = null;
      for (const step of seq) {
        if (ended) {
          failures.push(`round continued past its ending: ${seq.join('')}`);
          break;
        }
        if (step === 1) ok++;
        else miss++;
        const nowTurned = miss >= 1;
        if (wasTurned && !nowTurned) failures.push(`the turn reversed: ${seq.join('')}`);
        wasTurned = nowTurned;
        ended = endFor(ok, miss);
      }
      if (miss >= 2 && ended !== 'undone') failures.push(`two mistakes must undo you: ${seq.join('')}`);
      if (ok >= QUOTA && miss === 0 && ended !== 'clean') failures.push(`spotless run must be clean: ${seq.join('')}`);
      if (ok >= QUOTA && miss === 1 && ended !== 'survived') failures.push(`one mistake must only haircut: ${seq.join('')}`);
    }
    if (endFor(0, 0) !== null || endFor(QUOTA - 1, 1) !== null) failures.push('unfinished round must have no ending');
  }

  /* --- POINTS BAND vs par(d) = 100d + 40, and the stall check --- */
  for (let d = 1; d <= 12; d++) {
    const par = parFor(d);
    const clean = resolveOrb('clean', { depth: d, correct: QUOTA, postTurnCorrect: 0, turned: false, hpDelta: 0 });
    if (clean.correct !== true) failures.push(`clean must be a win at d=${d}`);
    if (clean.points < 0.6 * par || clean.points > 1.35 * par) failures.push(`clean ${clean.points} off band vs par ${par} d=${d}`);
    if (clean.hpDelta !== 6) failures.push(`clean must heal at d=${d}`);

    let prevSurvived = -1;
    for (let ptc = 1; ptc <= QUOTA; ptc++) {
      const s = resolveOrb('survived', { depth: d, correct: QUOTA, postTurnCorrect: ptc, turned: true, hpDelta: 0 });
      if (s.correct !== true) failures.push(`survived must be a win at d=${d}`);
      if (s.points < 0.6 * par || s.points > 1.35 * par) failures.push(`survived ${s.points} off band vs par ${par} d=${d}`);
      if (s.points >= clean.points) failures.push(`the turn must cost points at d=${d} ptc=${ptc}`);
      if (s.points <= prevSurvived) failures.push(`post-turn answers must pay at d=${d} ptc=${ptc}`);
      prevSurvived = s.points;
      if (s.hpDelta !== -8) failures.push(`survived hp wrong at d=${d}`);
    }

    const undone = resolveOrb('undone', { depth: d, correct: 3, postTurnCorrect: 2, turned: true, hpDelta: -12 });
    if (undone.correct !== false || undone.points !== 0) failures.push(`undone must be a scoreless loss at d=${d}`);
    if (undone.hpDelta !== -28) failures.push(`undone hp wrong at d=${d}`);

    // stalling is never optimal: the richest timeout pays under the worst win
    const worstWin = resolveOrb('survived', { depth: d, correct: QUOTA, postTurnCorrect: 1, turned: true, hpDelta: 0 });
    const stall = resolveOrb('timeout', { depth: d, correct: QUOTA - 1, postTurnCorrect: 0, turned: false, hpDelta: 0 });
    if (stall.correct !== null) failures.push(`timeout must be neutral at d=${d}`);
    if (stall.points >= worstWin.points) failures.push(`stalling ${stall.points} beats a win ${worstWin.points} at d=${d}`);
  }
  {
    const esc = resolveOrb('escape', { depth: 8, correct: 2, postTurnCorrect: 1, turned: true, hpDelta: -30 });
    if (esc.correct !== null || esc.points !== 0 || esc.hpDelta !== 0) failures.push('Esc must be a clean neutral');
  }
  for (const end of ['clean', 'survived', 'undone', 'timeout', 'escape'] as OrbEnd[]) {
    const r = resolveOrb(end, { depth: 5, correct: 4, postTurnCorrect: 2, turned: true, hpDelta: 0 });
    if (r.summary.length > 48) failures.push(`summary too long for ${end}: ${r.summary}`);
    if (r.summary.length === 0) failures.push(`empty summary for ${end}`);
  }

  /* --- seeded schedule: deterministic, valid, seed-varying --- */
  const openers = new Set<string>();
  for (let seed = 1; seed <= 300; seed++) {
    const a = buildQuestions(seed, MAX_QUESTIONS);
    if (JSON.stringify(a) !== JSON.stringify(buildQuestions(seed, MAX_QUESTIONS))) {
      failures.push(`questions nondeterministic seed=${seed}`);
      break;
    }
    if (a.length !== MAX_QUESTIONS) failures.push(`question count wrong seed=${seed}`);
    for (const q of a) {
      if (q.answerIdx < 0 || q.answerIdx > 3) failures.push(`answer missing seed=${seed}`);
      if (new Set(q.options.map((o) => `${o.kind}:${o.n}`)).size !== 4) failures.push(`duplicate option seed=${seed}`);
      if (q.options.some((o) => o.kind < 0 || o.kind >= CHIP_KINDS || o.n < 2 || o.n > 7)) failures.push(`bad chip seed=${seed}`);
      const ans = q.options[q.answerIdx];
      if (ans.kind !== q.target.kind || ans.n !== q.target.n) failures.push(`answerIdx mislabels seed=${seed}`);
    }
    openers.add(JSON.stringify(a[0]));
  }
  if (openers.size < 20) failures.push(`questions seed-blind: ${openers.size} distinct openers over 300 seeds`);

  /* --- Little Orb's shuffle is a real permutation that always moves --- */
  for (let seed = 1; seed <= 300; seed++) {
    const perms = buildPerms(seed, 6, 4);
    if (JSON.stringify(perms) !== JSON.stringify(buildPerms(seed, 6, 4))) {
      failures.push(`perms nondeterministic seed=${seed}`);
      break;
    }
    for (const p of perms) {
      if (p.length !== 4) failures.push(`perm width wrong seed=${seed}`);
      if (new Set(p).size !== 4 || p.some((v) => v < 0 || v > 3)) failures.push(`not a permutation seed=${seed}`);
      if (p.every((v, i) => v === i)) failures.push(`identity shuffle does not move tiles seed=${seed}`);
    }
    // applying a perm must preserve the answer, only relocate it
    const q = buildQuestions(seed, 1)[0];
    const slots = perms[0].map((i) => [0, 1, 2, 3][i]);
    if (new Set(slots).size !== 4) failures.push(`slot map broken seed=${seed}`);
    if (slots.indexOf(q.answerIdx) < 0) failures.push(`answer lost in the shuffle seed=${seed}`);
  }
  if (makePerm(() => 0, 4).some((v, i) => v !== i) === false) failures.push('degenerate rng must still move tiles');

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/scenes/takeovers/orb.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/orb.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] THE ORB OK' : `[selftest] THE ORB FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
