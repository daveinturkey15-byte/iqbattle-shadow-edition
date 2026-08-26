/**
 * RED LIGHT — takeover scene (v2 port of modes/mode-redlight.js, mechanic not code).
 *
 * GREEN phase: a micro-pattern question is live — match the highlighted shape
 *   among 4 option tiles. Correct pick banks +40 and advances; wrong pick ends
 *   the run (-40 / -12 hp).
 * RED phase: total freeze. ANY input (big pointer move, click, key) costs
 *   -8 hp and RESETS the current pattern. The run itself continues.
 *
 * Determinism: everything derives from ctx.seed via an own mulberry32 — the
 * light cadence AND every pattern are pure functions of the seed. No
 * Math.random, no Date.now (the clock is Pixi's shared ticker delta).
 * A 2 s goal card freezes the clock and locks input (except Esc) before play;
 * its cost comes out of the play budget so the stage still resolves inside
 * ctx.timerLen. Esc bails with a NEUTRAL result;
 * StageResult settles exactly once and ctx.container is emptied on done.
 */
import { Container, Sprite, Text, Texture, Ticker } from 'pixi.js';
import type { Prim } from '../../glyphs.ts';
import { tileCanvas } from '../../glyphs.ts';
import { panel, text, spriteFrom } from '../game.ts';
import { T, STAGE_W, STAGE_H } from '../../theme.ts';

/* ------------------------------------------------------------------ */
/* Shared takeover contract — tidepool.ts and serpent.ts import these. */
/* ------------------------------------------------------------------ */

export interface StageResult {
  /** true = won the stage · false = lost it · null = neutral (timeout/Esc). */
  correct: boolean | null;
  points: number;
  hpDelta: number;
  summary: string;
}

export interface TakeoverCtx {
  depth: number;
  seed: number;
  /** round timer in seconds; the scene MUST self-resolve within it */
  timerLen: number;
  container: Container;
  rng: () => number;
  onDone: (r: StageResult) => void;
}

/** mulberry32 — the one PRNG allowed in v2 takeovers. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wrap onDone so StageResult settles exactly once no matter who calls. */
export function onceResolve(onDone: (r: StageResult) => void): (r: StageResult) => void {
  let settled = false;
  return (r) => {
    if (settled) return;
    settled = true;
    onDone(r);
  };
}

/** Neutral escape result (Esc key / timeout). */
export function escaped(hpDelta: number, summary: string): StageResult {
  return { correct: null, points: 0, hpDelta, summary };
}

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested below)                                      */
/* ------------------------------------------------------------------ */

export interface RLPhase {
  greenMs: number;
  redMs: number;
}

const RL_SALT = 0x5f3759df;

/**
 * Seeded cadence. Greens shrink as the run goes on (and with depth); reds
 * grow. Each duration carries a seed-driven ±80 ms jitter (F9), so schedules
 * vary across seeds while staying monotone (jitter < the 190 ms green step)
 * and inside timerLen*1000 minus a settle margin, so the scene always
 * self-resolves before the engine timer would.
 */
export function buildCadence(seed: number, depth: number, timerLenSec: number): RLPhase[] {
  const rng = mulberry32((seed ^ RL_SALT) >>> 0);
  const budget = Math.max(5, timerLenSec) * 1000 - 700;
  const phases: RLPhase[] = [];
  let used = 0;
  for (let i = 0; i < 12; i++) {
    // per-phase rng gate: ±80 ms on both durations (draw order fixed)
    const greenMs = Math.max(950, Math.round(2500 - i * 190 - (depth - 1) * 80)) + Math.round(rng() * 160) - 80;
    const redMs = Math.min(2600, 900 + Math.round((i + depth) * 140)) + Math.round(rng() * 160) - 80;
    if (used + greenMs + redMs > budget || greenMs <= 0 || redMs <= 0) break;
    phases.push({ greenMs, redMs });
    used += greenMs + redMs;
  }
  if (phases.length === 0) phases.push({ greenMs: 1200, redMs: 800 });
  return phases;
}

/**
 * Pattern chips are DNA-primitive compositions: kind indexes the mark family,
 * n is how many marks. One hue per board (chosen at mount), structure carries
 * the difference — never color.
 */
export interface Chip {
  kind: number;
  n: number;
}

export const CHIP_KINDS = 6;

const chipKey = (c: Chip): string => `${c.kind}:${c.n}`;

function gridPos(i: number, n: number): { x: number; y: number } {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return {
    x: 50 + ((i % cols) - (cols - 1) / 2) * 26,
    y: 50 + (Math.floor(i / cols) - (rows - 1) / 2) * 26,
  };
}

/** Paint a chip into DNA primitives in a 100x100 cell space. */
export function chipPrims(kind: number, n: number): Prim[] {
  const prims: Prim[] = [];
  for (let i = 0; i < n; i++) {
    const p = gridPos(i, n);
    switch (kind) {
      case 0: // triangle outlines
        prims.push({ k: 'tri', x: p.x, y: p.y, s: 10 });
        break;
      case 1: // filled diamonds
        prims.push({ k: 'diamond', x: p.x, y: p.y, s: n === 1 ? 20 : 9 });
        break;
      case 2: // dots
        prims.push({ k: 'dot', x: p.x, y: p.y, r: 7 });
        break;
      case 3: // plus (two line segments)
        prims.push(
          { k: 'line', x1: p.x - 8, y1: p.y, x2: p.x + 8, y2: p.y },
          { k: 'line', x1: p.x, y1: p.y - 8, x2: p.x, y2: p.y + 8 },
        );
        break;
      case 4: // cross (diagonal segments)
        prims.push(
          { k: 'line', x1: p.x - 7, y1: p.y - 7, x2: p.x + 7, y2: p.y + 7 },
          { k: 'line', x1: p.x - 7, y1: p.y + 7, x2: p.x + 7, y2: p.y - 7 },
        );
        break;
      default: // dash
        prims.push({ k: 'line', x1: p.x - 10, y1: p.y, x2: p.x + 10, y2: p.y });
        break;
    }
  }
  return prims;
}

export interface RLPattern {
  target: Chip;
  options: Chip[];
  answerIdx: number;
}

/** Seeded pattern: target chip + 3 distractors that differ in kind or count. */
export function makePattern(rng: () => number): RLPattern {
  const target: Chip = {
    kind: Math.floor(rng() * CHIP_KINDS),
    n: 2 + Math.floor(rng() * 6), // 2..7 marks — readable density
  };
  const options: Chip[] = [{ ...target }];
  while (options.length < 4) {
    const cand: Chip = {
      kind: Math.floor(rng() * CHIP_KINDS),
      n: 2 + Math.floor(rng() * 6),
    };
    if (!options.some((o) => chipKey(o) === chipKey(cand))) options.push(cand);
  }
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { target, options, answerIdx: options.findIndex((o) => chipKey(o) === chipKey(target)) };
}

const QUOTA = 3;
const BANK_PER_SOLVE = 40;
const TWITCH_HP = 8;
/** Goal-card freeze: input locked and clock stopped for this long at mount. */
export const GOAL_MS = 2000;

interface LiveUi {
  status: Text;
  progress: Text;
  wash: Sprite;
  bar: Sprite;
  dynamic: Container;
  /** instant '+40 BANKED' click-to-feedback flash (never animated motion) */
  flash: Text;
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

export function mountRedLight(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const rng = mulberry32((ctx.seed ^ 0x1234567) >>> 0);
  const hue = T.boardHues[ctx.seed % T.boardHues.length];
  const settle = onceResolve(ctx.onDone);

  /* ---- static chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  const ui: LiveUi = {
    status: text(root, 'GREEN LIGHT — SOLVE', STAGE_W / 2 - 150, 108, 24, T.good, true),
    progress: text(root, '', STAGE_W / 2 - 130, 668, 17, T.ink),
    wash: new Sprite(Texture.WHITE),
    bar: new Sprite(Texture.WHITE),
    dynamic: new Container(),
    flash: text(root, '+40 BANKED', STAGE_W / 2, 612, 22, T.good, true),
  };
  ui.flash.visible = false;
  ui.wash.width = STAGE_W;
  ui.wash.height = STAGE_H;
  ui.wash.alpha = 0.06;
  root.addChild(ui.wash); // light wash sits directly above bg, below chrome
  root.addChild(ui.dynamic);

  const barW = 620;
  ui.bar.x = (STAGE_W - barW) / 2;
  ui.bar.y = 152;
  ui.bar.height = 6;
  root.addChild(ui.bar);

  text(root, 'ANSWER ON GREEN · ANY INPUT ON RED COSTS 8 HP · ESC BAILS NEUTRAL', STAGE_W / 2 - 230, 720, 13, T.muted);

  /* ---- goal card (first GOAL_MS: input locked, clock frozen) ----
   * Mirrors meta/onboard.ts CARDS['red-light'] — keep in step if that moves. */
  const CARD_W = 620;
  const card = panel(root, (STAGE_W - CARD_W) / 2, 300, CARD_W, 176);
  text(card, 'RED LIGHT', 28, 20, 26, T.gold, true);
  text(card, 'SOLVE ON GREEN. FREEZE ON RED.', 28, 64, 15, T.ink);
  text(card, 'CLICK / TAP OR PRESS 1–4 · ESC BAILS NEUTRAL', 28, 94, 13, T.muted);
  const unlockTxt = text(card, 'INPUT UNLOCKS IN 2…', 28, 130, 14, T.good, true);

  /* ---- dynamic pattern layer ---- */
  const optSize = 138;

  function renderPattern(p: RLPattern): void {
    ui.dynamic.removeChildren().forEach((c) => c.destroy({ children: true }));

    const tgt = spriteFrom(tileCanvas(chipPrims(p.target.kind, p.target.n), hue, 170));
    tgt.x = (STAGE_W - 170) / 2;
    tgt.y = 240;
    ui.dynamic.addChild(tgt);
    text(ui.dynamic, 'MATCH THIS SHAPE', STAGE_W / 2 - 96, 206, 15, T.muted);

    const gap = 20;
    const rowW = 4 * optSize + 3 * gap;
    const ox = (STAGE_W - rowW) / 2;
    p.options.forEach((chip, i) => {
      const s = spriteFrom(tileCanvas(chipPrims(chip.kind, chip.n), hue, optSize));
      s.x = ox + i * (optSize + gap);
      s.y = 452;
      s.eventMode = 'static';
      s.cursor = 'pointer';
      s.on('pointerdown', () => press(i));
      ui.dynamic.addChild(s);
      text(ui.dynamic, String(i + 1), s.x + 8, s.y + optSize - 24, 13, T.muted);
    });
  }

  function setLight(green: boolean, label: string): void {
    ui.status.text = label;
    ui.status.style.fill = green ? T.good : T.bad;
    ui.wash.tint = green ? 0x00e68a : 0xff2038;
    ui.wash.alpha = green ? 0.05 : 0.09;
  }

  function refreshProgress(): void {
    ui.progress.text = `SOLVED ${solved}/${QUOTA} · BANKED ${banked} · HP ${hpDelta}`;
  }

  /* ---- state machine ---- */
  const playBudgetMs = Math.max(6000, ctx.timerLen * 1000 - GOAL_MS);
  const phases = buildCadence(ctx.seed, ctx.depth, Math.round(playBudgetMs / 1000));
  let phaseIdx = 0;
  let inGreen = false;
  let phaseElapsed = 0;
  let totalMs = 0;
  let banked = 0;
  let hpDelta = 0;
  let solved = 0;
  let answered = false;
  let pattern = makePattern(rng);
  let dead = false;
  let introLeft = GOAL_MS;
  let flashT = -1;

  function finish(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function win(): void {
    finish({
      correct: true,
      points: banked + 50 + ctx.depth * 20,
      hpDelta,
      summary: `CROSSED THE FIELD · ${solved} PATTERNS`,
    });
  }
  function wrongPick(): void {
    finish({ correct: false, points: -40, hpDelta: hpDelta - 12, summary: 'PATTERN BROKE — OUT OF SYNC' });
  }
  function timeUp(): void {
    // neutral: banked patterns keep their points, no hp swing beyond twitches
    finish({ correct: null, points: banked, hpDelta, summary: 'TIME — THE FIELD KEEPS ITS SECRETS' });
  }

  function goGreen(): void {
    inGreen = true;
    answered = false;
    phaseElapsed = 0;
    pattern = makePattern(rng);
    renderPattern(pattern);
    setLight(true, 'GREEN LIGHT — SOLVE');
  }

  function goRed(): void {
    inGreen = false;
    answered = false;
    phaseElapsed = 0;
    setLight(false, 'RED LIGHT — FREEZE');
  }

  function press(i: number): void {
    if (dead || introLeft > 0 || !inGreen || answered) return;
    answered = true;
    if (i === pattern.answerIdx) {
      banked += BANK_PER_SOLVE;
      solved++;
      refreshProgress();
      // instant click-to-feedback: the +40 flash lands this frame
      ui.flash.text = '+40 BANKED';
      ui.flash.x = STAGE_W / 2 - ui.flash.width / 2;
      ui.flash.visible = true;
      flashT = 0;
      if (solved >= QUOTA) {
        win();
        return;
      }
      goRed();
    } else {
      wrongPick();
    }
  }

  /* ---- freeze detectors (red) ---- */
  let lastXY: [number, number] | null = null;

  function twitch(): void {
    if (dead || inGreen) return;
    hpDelta -= TWITCH_HP;
    answered = false;
    refreshProgress();
    ui.flash.visible = false;
    flashT = -1;
    setLight(false, 'THE DOLL SAW YOU MOVE · -8 HP');
    pattern = makePattern(rng); // pattern resets
    renderPattern(pattern);
  }

  function onMove(e: PointerEvent): void {
    if (!inGreen) {
      const r = root.getBounds();
      if (e.clientX < r.left - 80 || e.clientX > r.right + 80 || e.clientY < r.top - 80 || e.clientY > r.bottom + 80) return;
      if (!lastXY) lastXY = [e.clientX, e.clientY];
      else if (Math.hypot(e.clientX - lastXY[0], e.clientY - lastXY[1]) > 26) {
        lastXY = null;
        twitch();
      }
    }
  }
  function onDown(): void {
    if (!inGreen) twitch();
  }
  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      timeUp();
      return;
    }
    if (inGreen) {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 4) press(n - 1);
    } else if (e.key !== 'Shift') {
      twitch();
    }
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerdown', onDown);
  window.addEventListener('keydown', onKey);

  /* ---- clock: Pixi ticker only, never Date.now ---- */
  const onTick = (tk: Ticker): void => {
    if (dead) return;
    const dt = tk.deltaMS;
    if (introLeft > 0) {
      // goal card: clock frozen, input locked (guards above), Esc still works
      introLeft -= dt;
      if (introLeft <= 0) card.visible = false;
      else unlockTxt.text = `INPUT UNLOCKS IN ${Math.ceil(introLeft / 1000)}…`;
      return;
    }
    if (flashT >= 0) {
      flashT += dt;
      if (flashT >= 650) {
        ui.flash.visible = false;
        flashT = -1;
      }
    }
    totalMs += dt;
    phaseElapsed += dt;
    const cur = phases[Math.min(phaseIdx, phases.length - 1)];
    const limit = inGreen ? cur.greenMs : cur.redMs;
    ui.bar.width = Math.max(2, barW * Math.max(0, 1 - phaseElapsed / limit));
    ui.bar.tint = inGreen ? T.good : T.bad;
    if (totalMs >= playBudgetMs) {
      timeUp();
      return;
    }
    if (phaseElapsed >= limit) {
      if (inGreen) goRed();
      else {
        phaseIdx++;
        if (phaseIdx >= phases.length) timeUp();
        else goGreen();
      }
    }
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerdown', onDown);
    window.removeEventListener('keydown', onKey);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  refreshProgress();
  goGreen();
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  for (const depth of [1, 3, 7, 12]) {
    for (const timerLen of [15, 30, 60]) {
      const seed = depth * 7919 + timerLen;
      const a = buildCadence(seed, depth, timerLen);
      const b = buildCadence(seed, depth, timerLen);
      if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`cadence nondeterministic seed=${seed}`);
      const total = a.reduce((s, p) => s + p.greenMs + p.redMs, 0);
      if (total > timerLen * 1000 - 600) failures.push(`cadence overflows timerLen=${timerLen} depth=${depth} total=${total}`);
      if (a.some((p) => p.greenMs <= 0 || p.redMs <= 0)) failures.push(`nonpositive phase seed=${seed}`);
      if (a.length >= 2 && a[a.length - 1].greenMs > a[0].greenMs) failures.push(`greens should shrink seed=${seed}`);
    }
  }
  // F9 regression guard: cadence must actually vary across seeds (300-seed probe)
  const cadenceVariants = new Set<string>();
  for (let seed = 1; seed <= 300; seed++) {
    cadenceVariants.add(JSON.stringify(buildCadence(seed, 7, 30)));
  }
  if (cadenceVariants.size < 10) failures.push(`cadence seed-blind: only ${cadenceVariants.size} distinct schedules over 300 seeds`);
  if (JSON.stringify(buildCadence(111, 7, 30)) === JSON.stringify(buildCadence(999999, 7, 30))) {
    failures.push('cadence identical for seeds 111 and 999999');
  }
  for (let seed = 1; seed <= 200; seed++) {
    const pa = makePattern(mulberry32(seed));
    const pb = makePattern(mulberry32(seed));
    if (JSON.stringify(pa) !== JSON.stringify(pb)) failures.push(`pattern nondeterministic seed=${seed}`);
    if (pa.answerIdx < 0) failures.push(`answer missing seed=${seed}`);
    if (pa.options.some((o) => o.n < 1 || o.kind < 0 || o.kind >= CHIP_KINDS)) failures.push(`bad chip seed=${seed}`);
  }
  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;
