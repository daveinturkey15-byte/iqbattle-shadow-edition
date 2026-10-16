import { Graphics, Sprite, Texture, Ticker } from 'pixi.js';
import { T, STAGE_H, STAGE_W } from '../../theme.ts';
import { panel, text, spriteFrom } from '../game.ts';
import { tileCanvas } from '../../glyphs.ts';
import type { Prim } from '../../glyphs.ts';
import { GOAL_MS, mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';

export const STAGE_ID = 'six-stones';
export const STAGE_TITLE = 'SIX STONES';
export const STAGE_GOAL = 'WATCH SIX MARKED STONES, THEN ACTIVATE THEM IN THE SHOWN ORDER BEFORE THE SEAL CLOSES.';
export const STAGE_CONTROLS = 'CLICK STONES · KEYS 1–6 · ESC BAILS NEUTRAL';

const STONE_COUNT = 6;
const ORDER_SALT = 0x51a0e;
const REVEAL_ON_MS = 180;
const REVEAL_OFF_MS = 500;
const SETTLE_MS = 400;
const STONE_SIZE = 138;

const STONE_MARKS: Prim[][] = [
  [{ k: 'tri', x: 50, y: 50, s: 30 }],
  [{ k: 'dot', x: 50, y: 50, r: 17 }],
  [{ k: 'diamond', x: 50, y: 50, s: 25 }],
  [{ k: 'line', x1: 24, y1: 50, x2: 76, y2: 50 }],
  [{ k: 'line', x1: 27, y1: 27, x2: 73, y2: 73 }, { k: 'line', x1: 73, y1: 27, x2: 27, y2: 73 }],
  [{ k: 'dot', x: 35, y: 50, r: 8 }, { k: 'dot', x: 65, y: 50, r: 8 }, { k: 'line', x1: 35, y1: 75, x2: 65, y2: 75 }],
];

/** Seeded permutation: every marked stone appears once in the memory path. */
export function buildStoneSequence(seed: number): number[] {
  const rng = mulberry32((seed ^ ORDER_SALT) >>> 0);
  const sequence = Array.from({ length: STONE_COUNT }, (_, i) => i);
  for (let i = sequence.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const value = sequence[i] as number;
    sequence[i] = sequence[j] as number;
    sequence[j] = value;
  }
  return sequence;
}

export function resolveStoneAttempt(
  sequence: readonly number[],
  choices: readonly number[],
  depth: number,
  leftFrac: number,
): StageResult {
  for (let i = 0; i < Math.min(sequence.length, choices.length); i++) {
    if (sequence[i] !== choices[i]) {
      return { correct: false, points: 0, hpDelta: -14, summary: `ORDER BROKE AT STONE ${i + 1}` };
    }
  }
  if (choices.length < sequence.length) return escaped(0, 'THE SEAL CLOSED BEFORE THE LAST STONE');
  if (sequence.length !== STONE_COUNT) return { correct: false, points: 0, hpDelta: -14, summary: 'THE STONE PATH IS INCOMPLETE' };

  const par = 100 * Math.max(1, Math.floor(depth)) + 40;
  const time = Math.max(0, Math.min(1, leftFrac));
  return {
    correct: true,
    points: Math.round(par * (0.68 + 0.32 * time)),
    hpDelta: 8,
    summary: 'ALL SIX STONES ANSWERED',
  };
}

function hueFor(seed: number): string {
  return T.boardHues[Math.abs(seed) % T.boardHues.length] as string;
}

export function mountStoneTrial(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const settle = onceResolve(ctx.onDone);
  const sequence = buildStoneSequence(ctx.seed);
  const hue = hueFor(ctx.seed);
  const afterGoalMs = Math.max(0, ctx.timerLen * 1000 - GOAL_MS - SETTLE_MS);
  const revealMs = Math.min(STONE_COUNT * (REVEAL_ON_MS + REVEAL_OFF_MS), afterGoalMs * 0.58);
  const revealStepMs = Math.max(1, revealMs / STONE_COUNT);
  const flashMs = Math.min(REVEAL_ON_MS, revealStepMs * 0.42);
  const answerBudgetMs = Math.max(0, afterGoalMs - revealMs);
  const choices: number[] = [];
  let introLeft = GOAL_MS;
  let revealElapsed = 0;
  let answerElapsed = 0;
  let phase: 'intro' | 'reveal' | 'answer' = 'intro';
  let dead = false;

  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  text(root, 'SIX STONES', STAGE_W / 2 - 105, 35, 25, T.gold, true);
  text(root, 'MEMORIZE THE MARKS, THEN REPEAT THEIR ORDER', STAGE_W / 2 - 245, 78, 14, T.muted, true);
  const startX = (STAGE_W - (3 * STONE_SIZE + 2 * 42)) / 2;
  const startY = 185;
  const reveals: Graphics[] = [];
  for (let i = 0; i < STONE_COUNT; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = startX + col * (STONE_SIZE + 42);
    const y = startY + row * 232;
    const tile = spriteFrom(tileCanvas(STONE_MARKS[i] as Prim[], hue, STONE_SIZE));
    tile.x = x;
    tile.y = y;
    tile.eventMode = 'static';
    tile.cursor = 'pointer';
    tile.on('pointerdown', () => choose(i));
    root.addChild(tile);

    const reveal = new Graphics();
    reveal.roundRect(x - 7, y - 7, STONE_SIZE + 14, STONE_SIZE + 14, 16).stroke({ width: 5, color: hue });
    reveal.visible = false;
    root.addChild(reveal);
    reveals.push(reveal);
    const number = text(root, String(i + 1), 0, y + STONE_SIZE + 8, 15, T.muted, true);
    number.x = x + STONE_SIZE / 2 - number.width / 2;
  }

  const status = text(root, 'WATCH THE SEQUENCE', 0, 710, 17, T.good, true);
  const progress = text(root, '', 0, 748, 14, T.muted);
  const help = text(root, STAGE_CONTROLS, 0, 840, 13, T.muted);
  const goal = panel(root, (STAGE_W - 700) / 2, 300, 700, 220);
  text(goal, STAGE_TITLE, 28, 22, 26, T.gold, true);
  text(goal, 'WATCH SIX MARKED STONES, THEN ACTIVATE THEM', 28, 70, 15, T.ink);
  text(goal, 'IN THE SHOWN ORDER BEFORE THE SEAL CLOSES.', 28, 94, 15, T.ink);
  text(goal, STAGE_CONTROLS, 28, 132, 13, T.muted);
  const unlock = text(goal, 'INPUT UNLOCKS IN 2…', 28, 170, 14, T.good, true);

  function centerLabel(label: typeof status): void {
    label.x = STAGE_W / 2 - label.width / 2;
  }

  function finish(result: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(result);
  }

  function updateProgress(): void {
    progress.text = `STONES ACTIVATED ${choices.length} / ${STONE_COUNT}`;
    centerLabel(progress);
    centerLabel(status);
  }

  function choose(index: number): void {
    if (dead || phase !== 'answer') return;
    choices.push(index);
    const leftFrac = Math.max(0, (answerBudgetMs - answerElapsed) / Math.max(1, answerBudgetMs));
    if (sequence[choices.length - 1] !== index || choices.length >= STONE_COUNT) {
      finish(resolveStoneAttempt(sequence, choices, ctx.depth, leftFrac));
      return;
    }
    updateProgress();
  }

  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      finish(escaped(0, 'LEFT THE STONE CIRCLE'));
      return;
    }
    if (phase !== 'answer' || e.repeat) return;
    const value = Number.parseInt(e.key, 10);
    if (Number.isInteger(value) && value >= 1 && value <= STONE_COUNT) choose(value - 1);
  }
  window.addEventListener('keydown', onKey);

  const onTick = (ticker: Ticker): void => {
    if (dead) return;
    if (phase === 'intro') {
      introLeft -= ticker.deltaMS;
      if (introLeft <= 0) {
        introLeft = 0;
        goal.visible = false;
        phase = 'reveal';
        status.text = 'WATCH THE SEQUENCE';
        centerLabel(status);
      } else {
        unlock.text = `INPUT UNLOCKS IN ${Math.ceil(introLeft / 1000)}…`;
      }
      return;
    }
    if (phase === 'reveal') {
      revealElapsed += ticker.deltaMS;
      const index = Math.floor(revealElapsed / revealStepMs);
      const within = revealElapsed - index * revealStepMs;
      reveals.forEach((mark, i) => { mark.visible = i === sequence[index] && within < flashMs; });
      if (revealElapsed >= revealMs) {
        reveals.forEach((mark) => { mark.visible = false; });
        phase = 'answer';
        status.text = 'NOW REPEAT THE ORDER';
        centerLabel(status);
        updateProgress();
      }
      return;
    }
    answerElapsed += ticker.deltaMS;
    if (answerElapsed >= answerBudgetMs) finish(escaped(0, 'THE SEAL CLOSED BEFORE THE LAST STONE'));
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.removeChildren().forEach((child) => child.destroy({ children: true }));
  }

  centerLabel(status);
  centerLabel(progress);
  centerLabel(help);
  updateProgress();
}

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  for (let seed = 0; seed < 256; seed++) {
    const sequence = buildStoneSequence(seed);
    if (sequence.length !== STONE_COUNT || new Set(sequence).size !== STONE_COUNT) {
      failures.push(`seed ${seed}: sequence must be a six-stone permutation`);
    }
    const exact = resolveStoneAttempt(sequence, sequence, 5, 0.5);
    if (exact.correct !== true || exact.points <= 0 || exact.hpDelta !== 8) failures.push(`seed ${seed}: exact recall must win and heal`);
    const wrong = [...sequence];
    wrong[0] = ((wrong[0] as number) + 1) % STONE_COUNT;
    const missed = resolveStoneAttempt(sequence, wrong, 5, 0.5);
    if (missed.correct !== false || missed.points !== 0 || missed.hpDelta !== -14) failures.push(`seed ${seed}: wrong first stone must lose`);
    const partial = resolveStoneAttempt(sequence, sequence.slice(0, 3), 5, 0.5);
    if (partial.correct !== null || partial.points !== 0) failures.push(`seed ${seed}: incomplete recall must be neutral`);
  }
  return { ok: failures.length === 0, failures };
}
