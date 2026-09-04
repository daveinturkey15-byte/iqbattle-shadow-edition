/**
 * THE RECITAL — takeover scene (the owner's still-unbuilt "a piano round").
 *
 * ==== REGISTRATION REQUEST (Main-owned wiring — this file touches nothing shared) ====
 *   stage id     : 'piano-round'
 *   mount export : mountPiano              -> append to main.ts TAKEOVERS
 *   display name : 'THE RECITAL'           -> TAKEOVER_NAMES
 *   goal card    : title    'THE RECITAL'
 *                  goal     'WATCH THE PHRASE, PLAY IT BACK ON THE KEYBOARD, THEN FINISH ON
 *                            THE KEY WEARING THE MARK COUNT THE HOUSE ASKS FOR.'
 *                  controls 'CLICK / TAP A KEY · KEYS 1–8 · A S D F G H J K · ESC NEUTRAL'
 *   NOTE: the id must NOT be 'piano-keys' — that string already belongs to the
 *   round MODIFIER in src/rounds/modifiers.ts, which only restyles the ordinary
 *   option tiles. This is the separate full chaos round.
 * =====================================================================================
 *
 * THE ROUND — three phases, one keyboard.
 *   The eight keys each wear a DISTINCT mark count (1..8) in DNA primitives, so
 *   a count names exactly one key and the board is never ambiguous.
 *
 *   1. LISTEN  — a seeded PHRASE plays: keys light in order, one per stepMs, and
 *      the ribbon above fills with the same keys' glyphs in order, numbered. The
 *      phrase is carried ENTIRELY by the picture. Audio (a soft note per key via
 *      the shared audio graph) is additive decoration and is never required: with
 *      sound off, muted, or unavailable the round plays identically. DEAF-PLAYABLE
 *      IS A HARD RULE HERE, not a nice-to-have.
 *   2. ECHO    — the ribbon blanks to numbered '?' slots and you play the phrase
 *      back. Each right key fills its slot. A wrong key is a STUMBLE: -6 hp, the
 *      phrase replays from the top. The third stumble ends the recital.
 *   3. FINALE  — the house asks for a mark count. Play the one key wearing it.
 *
 * POINTS CURVE vs par(d) = 100*d + 40 (parFor imported from floorfall.ts):
 *   win     = max(floor(0.40*par), round(par * (0.55 + 0.45*leftFrac)) - 30*stumbles)
 *             [+25 FLAWLESS when stumbles === 0]
 *   fail    = third stumble, or the wrong finale key: correct false, 0 pts,
 *             hpDelta - 10 (the -6 per stumble is already in hpDelta)
 *   timeout = neutral (correct:null), 0 pts, hpDelta as accrued
 *
 * DETERMINISM: the phrase and the whole keyboard are pure functions of ctx.seed
 *   via an own mulberry32 in FIXED DRAW ORDER (8 kind rolls, the 1..8 count
 *   shuffle, then the asked count; the phrase comes off its own salted stream).
 *   No Math.random, no Date.now — the clock is Pixi's shared ticker delta.
 *   Self-limits to ctx.timerLen; StageResult settles exactly once via
 *   onceResolve; ctx.container is emptied on done, listeners and ticker removed.
 *
 * FAIRNESS RAILS: the lit-key highlight and the wrong-key sting are both <= 180 ms
 *   and localized — no fullscreen strobe anywhere; all text >= 11 px; one hue per
 *   board from T.boardHues; DNA primitive marks only, no scraped art and no
 *   likenesses. Keyboard parity is total (keys 1-8 and the A S D F G H J K home
 *   row do everything the pointer does). Motion gate (localStorage IQB_MOTION
 *   === '0' or prefers-reduced-motion): LISTEN presents the whole phrase at once
 *   as a static numbered ribbon for the SAME window instead of a travelling
 *   highlight — the phrase, the echo and every rule are identical.
 */
import { Container, Graphics, Sprite, Text, Texture, Ticker } from 'pixi.js';
import { CHIP_KINDS, chipPrims } from './redlight.ts';
import { GOAL_MS, mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';
import { tileCanvas } from '../../glyphs.ts';
import { panel, text, spriteFrom } from '../game.ts';
import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import { parFor } from './floorfall.ts';
import { audioGraph, envGain, isMuted, toneOsc } from '../../audio/audio.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested below — no Pixi, no DOM, no timers)         */
/* ------------------------------------------------------------------ */

const PK_SALT = 0x88a1c0de;
const SETTLE_MS = 900;

export const KEYS = 8;
/** Stumbles you may survive; the next one ends the recital. */
export const MAX_STUMBLES = 2;
export const LEADIN_MS = 600;
export const TAIL_MS = 400;
export const STUMBLE_HP = 6;
export const FAIL_HP = 10;
/** Highlight / sting window — the fairness ceiling for any flash here. */
export const FLASH_MS = 180;

/** Phrase length by depth: 3 at the top of the run, 6 deep. */
export function phraseLen(depth: number): number {
  const d = Math.max(1, Math.floor(depth));
  return Math.max(3, Math.min(6, 3 + Math.floor((d - 1) / 3)));
}

/** Time each phrase key holds during LISTEN. */
export function stepMsFor(depth: number): number {
  const d = Math.max(1, Math.min(10, Math.floor(depth)));
  return Math.max(380, 620 - 30 * (d - 1));
}

/** Total LISTEN window (lead-in + the phrase + a tail before ECHO opens). */
export function listenMs(depth: number): number {
  return LEADIN_MS + phraseLen(depth) * stepMsFor(depth) + TAIL_MS;
}

/**
 * Seeded phrase — a list of key indices with no immediate repeat (a repeated
 * key is unreadable as two events, on screen or in the ear).
 * FIXED DRAW ORDER: one roll per step, re-rolled only to dodge a repeat.
 */
export function buildPhrase(seed: number, depth: number): number[] {
  const rng = mulberry32((seed ^ PK_SALT) >>> 0);
  const n = phraseLen(depth);
  const out: number[] = [];
  while (out.length < n) {
    const k = Math.floor(rng() * KEYS);
    if (out.length > 0 && out[out.length - 1] === k) continue;
    out.push(k);
  }
  return out;
}

export interface Keyboard {
  /** DNA mark family per key (decorative variety; the COUNT is the question). */
  kinds: number[];
  /** mark count per key — a permutation of 1..KEYS, so a count names one key */
  counts: number[];
  /** the count the finale asks for */
  askN: number;
  /** the single key wearing askN */
  answerIdx: number;
}

/**
 * Seeded keyboard — FIXED DRAW ORDER: KEYS kind rolls, then the Fisher-Yates
 * shuffle of the counts 1..KEYS, then the asked count.
 */
export function buildKeyboard(rng: () => number): Keyboard {
  const kinds: number[] = [];
  for (let i = 0; i < KEYS; i++) kinds.push(Math.floor(rng() * CHIP_KINDS));
  const counts: number[] = [];
  for (let i = 1; i <= KEYS; i++) counts.push(i);
  for (let i = counts.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [counts[i], counts[j]] = [counts[j], counts[i]];
  }
  const askN = counts[Math.floor(rng() * KEYS)];
  return { kinds, counts, askN, answerIdx: counts.indexOf(askN) };
}

export type EchoVerdict = 'advance' | 'complete' | 'stumble';

/** What a key press does during ECHO. Pure so the rule is testable. */
export function echoStep(phrase: readonly number[], idx: number, pressed: number): EchoVerdict {
  if (idx < 0 || idx >= phrase.length) return 'stumble';
  if (phrase[idx] !== pressed) return 'stumble';
  return idx + 1 >= phrase.length ? 'complete' : 'advance';
}

/**
 * Win payout. leftFrac = play budget remaining at the finale key (0..1).
 * Stumbles cost 30 each but the payout never falls through the 40 % floor —
 * a shaky recital that still lands pays, it just pays badly.
 */
export function recitalPoints(depth: number, stumbles: number, leftFrac: number): number {
  const par = parFor(depth);
  const f = Math.max(0, Math.min(1, leftFrac));
  const s = Math.max(0, Math.floor(stumbles));
  const raw = Math.round(par * (0.55 + 0.45 * f)) - 30 * s;
  return Math.max(Math.floor(0.4 * par), raw) + (s === 0 ? 25 : 0);
}

/** Semitone offsets: a major pentatonic-ish run so the phrase never sours. */
const SEMIS = [0, 2, 4, 7, 9, 12, 14, 16] as const;

/** Note frequency for a key index (C4 root). Pure — the audio path is optional. */
export function freqForKey(i: number): number {
  const k = Math.max(0, Math.min(KEYS - 1, Math.floor(i)));
  return 261.63 * Math.pow(2, SEMIS[k] / 12);
}

/** Play budget the scene actually gets, after the goal card and settle margin. */
export function playBudgetMs(timerLenSec: number): number {
  return Math.max(6, timerLenSec - GOAL_MS / 1000) * 1000 - SETTLE_MS;
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

const KEY_W = 148;
const KEY_GAP = 6;
const KEY_H = 320;
const KEY_Y = 420;
const KB_W = KEYS * KEY_W + (KEYS - 1) * KEY_GAP;
const KB_X = (STAGE_W - KB_W) / 2;
const GLYPH = 104;
/** Black caps sit on the boundaries after keys 0,1,3,4,5 — the piano pattern. */
const BLACK_AFTER = [0, 1, 3, 4, 5];
const BLACK_W = 62;
const BLACK_H = 150;
const RIB_TILE = 84;
const RIB_GAP = 16;
const RIB_Y = 130;
const HOME_ROW = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k'];

type Phase = 'listen' | 'echo' | 'finale';

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

/**
 * A single soft note. Entirely optional: no audio graph (no user gesture yet),
 * muted, or any throw at all and the recital plays on unchanged. Voice gain is
 * 0.2 under the graph master, which audio.ts hard-caps at MASTER_CAP.
 */
function playNote(keyIdx: number): void {
  try {
    if (isMuted()) return;
    const g = audioGraph();
    if (!g) return;
    const t0 = g.ctx.currentTime + 0.005;
    const env = envGain(g.ctx, g.master, 0.2, t0, 0.012, 0.26);
    const osc = toneOsc(g.ctx, 'triangle', freqForKey(keyIdx), t0);
    osc.connect(env);
    osc.start(t0);
    osc.stop(t0 + 0.28);
  } catch {
    /* audio is decoration — never let it touch the round */
  }
}

export function mountPiano(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const MOTION = motionOn();
  const rng = mulberry32((ctx.seed ^ 0x51a9d3) >>> 0);
  const hue = T.boardHues[ctx.seed % T.boardHues.length];
  const settle = onceResolve(ctx.onDone);
  const kb = buildKeyboard(rng);
  const phrase = buildPhrase(ctx.seed, ctx.depth);
  const stepMs = stepMsFor(ctx.depth);
  const listenWindow = listenMs(ctx.depth);

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  text(root, 'THE RECITAL', STAGE_W / 2 - 88, 26, 26, T.gold, true);
  text(root, 'WATCH THE PHRASE · PLAY IT BACK · FINISH ON THE ASKED COUNT', STAGE_W / 2 - 250, 62, 13, T.muted);

  /* ---- ribbon: the phrase, always carried by the picture ---- */
  const ribbon = new Container();
  root.addChild(ribbon);
  const ribW = phrase.length * RIB_TILE + (phrase.length - 1) * RIB_GAP;
  const ribX = (STAGE_W - ribW) / 2;

  /* ---- prompt + hud ---- */
  const prompt = text(root, '', 0, 268, 22, T.ink, true);
  const sub = text(root, '', 0, 302, 14, T.muted);
  const hud = text(root, '', 60, 786, 16, T.ink, true);
  text(root, 'CLICK / TAP A KEY · KEYS 1–8 · A S D F G H J K · ESC BAILS NEUTRAL', 60, 824, 12, T.muted);

  function centre(t: Text, y: number): void {
    t.x = Math.round(STAGE_W / 2 - t.width / 2);
    t.y = y;
  }

  /* ---- keyboard ---- */
  const keyLayer = new Container();
  root.addChild(keyLayer);
  const keyBodies: Sprite[] = [];
  const keyDeco = new Graphics();
  keyDeco.eventMode = 'none';

  for (let i = 0; i < KEYS; i++) {
    const x = KB_X + i * (KEY_W + KEY_GAP);
    const body = new Sprite(Texture.WHITE);
    body.x = x;
    body.y = KEY_Y;
    body.width = KEY_W;
    body.height = KEY_H;
    body.tint = 0x070d18;
    body.eventMode = 'static';
    body.cursor = 'pointer';
    body.on('pointerdown', () => press(i));
    keyLayer.addChild(body);
    keyBodies.push(body);
  }
  keyLayer.addChild(keyDeco);

  // glyphs and labels sit above the caps but take no pointer events
  const keyMarks = new Container();
  keyMarks.eventMode = 'none';
  root.addChild(keyMarks);
  for (let i = 0; i < KEYS; i++) {
    const x = KB_X + i * (KEY_W + KEY_GAP);
    const spr = spriteFrom(tileCanvas(chipPrims(kb.kinds[i], kb.counts[i]), hue, GLYPH));
    spr.x = x + (KEY_W - GLYPH) / 2;
    spr.y = KEY_Y + 168;
    keyMarks.addChild(spr);
    text(keyMarks, String(i + 1), x + 10, KEY_Y + KEY_H - 26, 13, T.muted);
    text(keyMarks, HOME_ROW[i].toUpperCase(), x + KEY_W - 24, KEY_Y + KEY_H - 26, 13, T.muted);
  }

  /* ---- goal card (first GOAL_MS: input locked, clock frozen) ----
   * Mirrors the goal card requested at the top of this file — keep in step. */
  const CARD_W = 620;
  const card = panel(root, (STAGE_W - CARD_W) / 2, 300, CARD_W, 176);
  text(card, 'THE RECITAL', 28, 20, 26, T.gold, true);
  text(card, 'WATCH THE PHRASE. PLAY IT BACK. THEN THE ASKED COUNT.', 28, 64, 15, T.ink);
  text(card, 'CLICK / TAP · KEYS 1–8 · A S D F G H J K · ESC NEUTRAL', 28, 94, 13, T.muted);
  const unlockTxt = text(card, 'INPUT UNLOCKS IN 2…', 28, 130, 14, T.good, true);

  /* ---- state ---- */
  const budgetMs = playBudgetMs(ctx.timerLen);
  let clock = 0;
  let introLeft = GOAL_MS;
  let phase: Phase = 'listen';
  let listenT = 0;
  let lastLit = -2;
  let echoIdx = 0;
  let stumbles = 0;
  let hpDelta = 0;
  let flashKey = -1;
  let flashAt = -1;
  let flashGood = false;
  let dead = false;

  function finish(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  /* ---- ribbon rendering ---- */
  function renderRibbon(): void {
    ribbon.removeChildren().forEach((c) => c.destroy({ children: true }));
    for (let i = 0; i < phrase.length; i++) {
      const k = phrase[i];
      // LISTEN shows the phrase (all of it when motion is off, progressively
      // otherwise); ECHO blanks what you have not played back yet.
      const shown = phase === 'listen'
        ? (!MOTION || i <= currentLit())
        : i < echoIdx;
      const cv = shown
        ? tileCanvas(chipPrims(kb.kinds[k], kb.counts[k]), hue, RIB_TILE)
        : tileCanvas([], hue, RIB_TILE, { hole: true });
      const spr = spriteFrom(cv);
      spr.x = ribX + i * (RIB_TILE + RIB_GAP);
      spr.y = RIB_Y;
      spr.alpha = shown ? 1 : 0.55;
      ribbon.addChild(spr);
      text(ribbon, String(i + 1), spr.x + 8, RIB_Y + RIB_TILE - 22, 12, T.muted);
    }
  }

  /** Index of the phrase step currently lit during LISTEN (-1 = lead-in). */
  function currentLit(): number {
    if (phase !== 'listen') return phrase.length - 1;
    if (listenT < LEADIN_MS) return -1;
    return Math.min(phrase.length - 1, Math.floor((listenT - LEADIN_MS) / stepMs));
  }

  function refreshHud(): void {
    const left = MAX_STUMBLES - stumbles;
    hud.text = `STUMBLES ${stumbles}/${MAX_STUMBLES + 1} · ${left >= 0 ? left + ' FORGIVEN LEFT' : 'NONE LEFT'} · HP ${hpDelta}`;
    hud.style.fill = hpDelta < 0 ? T.bad : T.ink;
    if (phase === 'listen') {
      prompt.text = 'LISTEN — THE PHRASE IS ON THE RIBBON';
      sub.text = MOTION ? 'KEYS LIGHT IN ORDER · THE PICTURE IS THE WHOLE PHRASE' : 'STATIC PHRASE — READ THE RIBBON LEFT TO RIGHT';
    } else if (phase === 'echo') {
      prompt.text = `PLAY IT BACK — ${echoIdx + 1} OF ${phrase.length}`;
      sub.text = 'EACH RIGHT KEY FILLS ITS SLOT · A WRONG KEY REPLAYS THE PHRASE';
    } else {
      prompt.text = `NOW PLAY THE KEY WEARING ${kb.askN} MARK${kb.askN === 1 ? '' : 'S'}`;
      sub.text = 'ONE KEY ONLY WEARS THAT COUNT';
    }
    centre(prompt, 268);
    centre(sub, 302);
  }

  /* ---- phase moves ---- */
  function startListen(): void {
    phase = 'listen';
    listenT = 0;
    lastLit = -2;
    echoIdx = 0;
    renderRibbon();
    refreshHud();
  }

  function startEcho(): void {
    phase = 'echo';
    echoIdx = 0;
    renderRibbon();
    refreshHud();
  }

  function startFinale(): void {
    phase = 'finale';
    renderRibbon();
    refreshHud();
  }

  function stumble(key: number): void {
    stumbles++;
    hpDelta -= STUMBLE_HP;
    flashKey = key;
    flashAt = clock;
    flashGood = false;
    if (stumbles > MAX_STUMBLES) {
      refreshHud();
      finish({ correct: false, points: 0, hpDelta: hpDelta - FAIL_HP, summary: 'THE RECITAL FELL APART' });
      return;
    }
    startListen();
  }

  function press(i: number): void {
    if (dead || introLeft > 0) return;
    if (phase === 'listen') return; // the house is still playing
    if (phase === 'echo') {
      const v = echoStep(phrase, echoIdx, i);
      if (v === 'stumble') {
        stumble(i);
        return;
      }
      echoIdx++;
      flashKey = i;
      flashAt = clock;
      flashGood = true;
      playNote(i);
      if (v === 'complete') {
        startFinale();
        return;
      }
      renderRibbon();
      refreshHud();
      return;
    }
    // finale
    flashKey = i;
    flashAt = clock;
    flashGood = i === kb.answerIdx;
    if (i === kb.answerIdx) {
      playNote(i);
      const leftFrac = Math.max(0, Math.min(1, (budgetMs - clock) / budgetMs));
      finish({
        correct: true,
        points: recitalPoints(ctx.depth, stumbles, leftFrac),
        hpDelta,
        summary: stumbles === 0 ? 'FLAWLESS RECITAL' : `RECITAL LANDED · ${stumbles} STUMBLE${stumbles === 1 ? '' : 'S'}`,
      });
      return;
    }
    finish({ correct: false, points: 0, hpDelta: hpDelta - FAIL_HP, summary: 'WRONG KEY AT THE CLOSE' });
  }

  /* ---- input ---- */
  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      finish(escaped(hpDelta, 'LEFT THE STOOL EMPTY'));
      return;
    }
    if (introLeft > 0) return; // goal card up — input locked, Esc excepted
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= KEYS) {
      press(n - 1);
      return;
    }
    const home = HOME_ROW.indexOf(e.key.toLowerCase());
    if (home >= 0) press(home);
  }
  window.addEventListener('keydown', onKey);

  /* ---- painting ---- */
  function paint(): void {
    const lit = phase === 'listen' ? currentLit() : -1;
    const litKey = lit >= 0 ? phrase[lit] : -1;
    const flashing = flashAt >= 0 && clock - flashAt < FLASH_MS;
    if (!flashing && flashAt >= 0) {
      flashAt = -1;
      flashKey = -1;
    }

    for (let i = 0; i < KEYS; i++) {
      let tint = 0x070d18;
      if (phase === 'listen' && (MOTION ? i === litKey : phrase.includes(i))) tint = 0x1d2c48;
      if (flashing && i === flashKey) tint = flashGood ? 0x123c33 : 0x3d1120;
      keyBodies[i].tint = tint;
    }

    keyDeco.clear();
    for (let i = 0; i < KEYS; i++) {
      const x = KB_X + i * (KEY_W + KEY_GAP);
      const hot = phase === 'listen' && (MOTION ? i === litKey : phrase.includes(i));
      keyDeco.roundRect(x + 0.5, KEY_Y + 0.5, KEY_W - 1, KEY_H - 1, 10)
        .stroke({ width: hot ? 3 : 1.5, color: hot ? hue : 0x2a3550, alpha: hot ? 0.95 : 0.5 });
      // ivory cap — what makes the slab read as a key at a glance
      keyDeco.roundRect(x + 8, KEY_Y + KEY_H - 16, KEY_W - 16, 8, 4)
        .fill({ color: '#e9eef8', alpha: hot ? 0.95 : 0.55 });
    }
    for (const b of BLACK_AFTER) {
      const bx = KB_X + (b + 1) * (KEY_W + KEY_GAP) - KEY_GAP / 2 - BLACK_W / 2;
      keyDeco.roundRect(bx, KEY_Y, BLACK_W, BLACK_H, 7)
        .fill({ color: 0x000000, alpha: 0.92 })
        .stroke({ width: 1.5, color: 0x27334d, alpha: 0.8 });
    }
  }

  /* ---- clock: Pixi ticker only, never Date.now ---- */
  const onTick = (tk: Ticker): void => {
    if (dead) return;
    if (introLeft > 0) {
      // goal card: phrase clock frozen, input locked (guards above), Esc works
      introLeft -= tk.deltaMS;
      if (introLeft <= 0) card.visible = false;
      else unlockTxt.text = `INPUT UNLOCKS IN ${Math.ceil(introLeft / 1000)}…`;
      paint();
      return;
    }
    const dt = tk.deltaMS;
    clock += dt;
    if (clock >= budgetMs) {
      finish({ correct: null, points: 0, hpDelta, summary: 'THE HOUSE LIGHTS CAME UP' });
      return;
    }

    if (phase === 'listen') {
      listenT += dt;
      const lit = currentLit();
      if (lit !== lastLit) {
        lastLit = lit;
        if (lit >= 0) {
          playNote(phrase[lit]); // audio follows the picture, never replaces it
          if (MOTION) renderRibbon();
        }
      }
      if (listenT >= listenWindow) startEcho();
    }
    paint();
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  startListen();
  paint();
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed, no timers)   */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  /* --- schedule ladders --- */
  if (phraseLen(1) !== 3 || phraseLen(3) !== 3 || phraseLen(4) !== 4 || phraseLen(10) !== 6 || phraseLen(40) !== 6) {
    failures.push('phraseLen ladder wrong');
  }
  if (phraseLen(0) !== 3 || phraseLen(-9) !== 3) failures.push('phraseLen must clamp depth');
  if (stepMsFor(1) !== 620 || stepMsFor(9) !== 380 || stepMsFor(30) !== 380) failures.push('stepMs ladder wrong');
  for (let d = 1; d <= 12; d++) {
    if (stepMsFor(d) < FLASH_MS * 2) failures.push(`step ${stepMsFor(d)} too short to read at depth ${d}`);
    if (d > 1 && stepMsFor(d) > stepMsFor(d - 1)) failures.push(`step must not grow at depth ${d}`);
    if (d > 1 && phraseLen(d) < phraseLen(d - 1)) failures.push(`phrase must not shrink at depth ${d}`);
  }

  /* --- timing rails: the round always fits, and always self-resolves --- */
  for (let d = 1; d <= 12; d++) {
    // one full listen must fit even in the shortest sane round
    if (listenMs(d) >= playBudgetMs(15)) failures.push(`listen ${listenMs(d)} does not fit a 15 s round at depth ${d}`);
    // a full recital with every forgiven stumble used must fit a default round
    const worst = listenMs(d) * (MAX_STUMBLES + 1) + phraseLen(d) * 400 + 1500;
    if (worst >= playBudgetMs(60)) failures.push(`worst-case recital ${worst} does not fit a 60 s round at depth ${d}`);
  }
  if (playBudgetMs(1) <= 0 || playBudgetMs(120) <= playBudgetMs(60)) failures.push('play budget curve wrong');

  /* --- phrase: determinism, legal keys, no immediate repeats, seed spread --- */
  for (let seed = 1; seed <= 400; seed++) {
    const depth = 1 + ((seed * 11) % 12);
    const a = buildPhrase(seed, depth);
    const b = buildPhrase(seed, depth);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      failures.push(`phrase nondeterministic seed=${seed}`);
      break;
    }
    if (a.length !== phraseLen(depth)) failures.push(`phrase length wrong seed=${seed}`);
    if (a.some((k) => !Number.isInteger(k) || k < 0 || k >= KEYS)) failures.push(`phrase key out of range seed=${seed}`);
    if (a.some((k, i) => i > 0 && a[i - 1] === k)) failures.push(`phrase repeats a key back-to-back seed=${seed}`);
    if (failures.length > 0) break;
  }
  {
    const variants = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) variants.add(JSON.stringify(buildPhrase(seed, 7)));
    if (variants.size < 20) failures.push(`phrase seed-blind: ${variants.size} variants over 300 seeds`);
  }

  /* --- keyboard: unique counts, the ask names exactly one key --- */
  for (let seed = 1; seed <= 400; seed++) {
    const a = buildKeyboard(mulberry32(seed));
    const b = buildKeyboard(mulberry32(seed));
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      failures.push(`keyboard nondeterministic seed=${seed}`);
      break;
    }
    if (a.counts.length !== KEYS || a.kinds.length !== KEYS) failures.push(`keyboard size wrong seed=${seed}`);
    const sorted = [...a.counts].sort((x, y) => x - y);
    if (sorted.some((v, i) => v !== i + 1)) failures.push(`counts are not a 1..${KEYS} permutation seed=${seed}`);
    if (a.kinds.some((k) => k < 0 || k >= CHIP_KINDS)) failures.push(`bad key kind seed=${seed}`);
    if (a.counts.filter((c) => c === a.askN).length !== 1) failures.push(`asked count is ambiguous seed=${seed}`);
    if (a.counts[a.answerIdx] !== a.askN) failures.push(`answerIdx does not wear askN seed=${seed}`);
    if (failures.length > 0) break;
  }
  {
    const asks = new Set<number>();
    for (let seed = 1; seed <= 300; seed++) asks.add(buildKeyboard(mulberry32(seed)).askN);
    if (asks.size < 5) failures.push(`asked count seed-blind: ${asks.size} distinct asks over 300 seeds`);
  }

  /* --- echo rule --- */
  {
    const ph = [3, 1, 6];
    if (echoStep(ph, 0, 3) !== 'advance') failures.push('right key must advance');
    if (echoStep(ph, 0, 4) !== 'stumble') failures.push('wrong key must stumble');
    if (echoStep(ph, 2, 6) !== 'complete') failures.push('last right key must complete');
    if (echoStep(ph, 3, 6) !== 'stumble') failures.push('an index past the phrase must not pass');
    if (echoStep(ph, -1, 3) !== 'stumble') failures.push('a negative index must not pass');
    // a full correct run reaches complete exactly once, at the last step
    let idx = 0;
    let completes = 0;
    for (const k of ph) {
      const v = echoStep(ph, idx, k);
      if (v === 'stumble') failures.push('a correct echo stumbled');
      if (v === 'complete') completes++;
      idx++;
    }
    if (completes !== 1) failures.push(`echo completed ${completes} times`);
  }

  /* --- notes: optional, but ordered and finite --- */
  for (let i = 0; i < KEYS; i++) {
    const f = freqForKey(i);
    if (!Number.isFinite(f) || f < 200 || f > 800) failures.push(`note ${i} out of range: ${f}`);
    if (i > 0 && f <= freqForKey(i - 1)) failures.push(`notes not ascending at key ${i}`);
  }
  if (freqForKey(-5) !== freqForKey(0) || freqForKey(99) !== freqForKey(KEYS - 1)) failures.push('note index must clamp');

  /* --- points curve vs par(d) = 100*d + 40 --- */
  for (let d = 1; d <= 12; d++) {
    const par = parFor(d);
    const best = recitalPoints(d, 0, 1);
    const worst = recitalPoints(d, MAX_STUMBLES, 0);
    if (best > 1.35 * par) failures.push(`best ${best} above band at depth ${d} (par ${par})`);
    if (worst < 0.35 * par) failures.push(`worst ${worst} below band at depth ${d} (par ${par})`);
    if (best <= recitalPoints(d, 1, 1)) failures.push(`a stumble must cost points at depth ${d}`);
    if (recitalPoints(d, 0, 1) <= recitalPoints(d, 0, 0)) failures.push(`speed must pay at depth ${d}`);
    for (let s = 1; s <= MAX_STUMBLES; s++) {
      if (recitalPoints(d, s, 0.5) > recitalPoints(d, s - 1, 0.5)) failures.push(`payout not monotone in stumbles at depth ${d}`);
    }
    // stalling is never optimal: the timeout pays nothing, any win pays
    if (worst <= 0) failures.push(`a landed recital must beat the 0-point timeout at depth ${d}`);
  }
  if (recitalPoints(5, -3, 2) !== recitalPoints(5, 0, 1)) failures.push('payout must clamp its inputs');

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/scenes/takeovers/pianokeys.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/pianokeys.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] THE RECITAL OK' : `[selftest] THE RECITAL FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
