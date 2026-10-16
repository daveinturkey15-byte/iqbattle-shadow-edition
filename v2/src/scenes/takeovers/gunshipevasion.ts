import { Container, Graphics, Sprite, Texture, Ticker } from 'pixi.js';
import type { Text } from 'pixi.js';
import { T, STAGE_H, STAGE_W } from '../../theme.ts';
import { panel, text } from '../game.ts';
import { GOAL_MS, mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';

export const STAGE_ID = 'gunship-evasion';
export const STAGE_TITLE = 'GUNSHIP PASS';
export const STAGE_GOAL = 'READ THE TELEGRAPHED SEARCHLIGHT SWEEP AND MOVE TO A SHELTERED LANE BEFORE EACH PASS.';
export const STAGE_CONTROLS = 'LEFT / RIGHT OR A / D · CLICK SHELTER / KEYS 1–3 · ESC BAILS NEUTRAL';

const PASS_COUNT = 6;
const SWEEP_SALT = 0x6a05e;
const SETTLE_MS = 400;
const LANE_W = 240;
const LANE_H = 238;
const LANE_GAP = 28;

/** Six deterministic searchlight targets; consecutive passes never hit the same lane. */
export function buildSweeps(seed: number): number[] {
  const rng = mulberry32((seed ^ SWEEP_SALT) >>> 0);
  const targets: number[] = [];
  for (let i = 0; i < PASS_COUNT; i++) {
    let lane = Math.floor(rng() * 3);
    if (lane === targets[i - 1]) lane = (lane + 1) % 3;
    targets.push(lane);
  }
  return targets;
}

export function resolveEvasion(
  targets: readonly number[],
  choices: readonly number[],
  depth: number,
  leftFrac: number,
): StageResult {
  let hits = 0;
  for (let i = 0; i < Math.min(targets.length, choices.length); i++) {
    if (targets[i] === choices[i]) hits++;
  }
  if (choices.length < targets.length) return escaped(0, 'THE SEARCHLIGHT PASSED');
  if (targets.length !== PASS_COUNT) return { correct: false, points: 0, hpDelta: -16, summary: 'THE PASS SEQUENCE BROKE' };

  const time = Math.max(0, Math.min(1, leftFrac));
  const par = 100 * Math.max(1, Math.floor(depth)) + 40;
  if (hits <= 1) {
    return {
      correct: true,
      points: Math.max(0, Math.round(par * (0.76 + 0.24 * time) - hits * 10)),
      hpDelta: hits === 0 ? 6 : -6,
      summary: hits === 0 ? 'ALL SIX PASSES DODGED' : 'FIVE PASSES DODGED · ONE NEAR MISS',
    };
  }
  return {
    correct: false,
    points: 0,
    hpDelta: -Math.min(32, hits * 8),
    summary: `SEARCHLIGHT CAUGHT YOU ${hits} TIMES`,
  };
}

function hueFor(seed: number): string {
  return T.boardHues[Math.abs(seed) % T.boardHues.length] as string;
}

export function mountGunshipEvasion(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const settle = onceResolve(ctx.onDone);
  const targets = buildSweeps(ctx.seed);
  const hue = hueFor(ctx.seed);
  const budgetMs = Math.max(0, ctx.timerLen * 1000 - GOAL_MS - SETTLE_MS);
  const warnMs = Math.max(400, Math.min(900, (budgetMs / PASS_COUNT) * 0.72));
  const choices: number[] = [];
  let selectedLane = 1;
  let wave = 0;
  let waveElapsed = 0;
  let playElapsed = 0;
  let misses = 0;
  let introLeft = GOAL_MS;
  let dead = false;

  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  text(root, 'GUNSHIP PASS', STAGE_W / 2 - 117, 34, 25, T.gold, true);
  const plane = new Graphics();
  plane.moveTo(STAGE_W / 2, 112)
    .lineTo(STAGE_W / 2 + 30, 164)
    .lineTo(STAGE_W / 2 + 106, 183)
    .lineTo(STAGE_W / 2 + 106, 197)
    .lineTo(STAGE_W / 2 + 30, 192)
    .lineTo(STAGE_W / 2 + 18, 218)
    .lineTo(STAGE_W / 2 - 18, 218)
    .lineTo(STAGE_W / 2 - 30, 192)
    .lineTo(STAGE_W / 2 - 106, 197)
    .lineTo(STAGE_W / 2 - 106, 183)
    .lineTo(STAGE_W / 2 - 30, 164)
    .closePath()
    .fill({ color: hue });
  root.addChild(plane);

  const beam = new Graphics();
  root.addChild(beam);
  const laneWidthTotal = 3 * LANE_W + 2 * LANE_GAP;
  const laneStartX = (STAGE_W - laneWidthTotal) / 2;
  const laneBorders: Graphics[] = [];
  const shelterMarks: Graphics[] = [];
  const laneLabels: Text[] = [];
  const laneCenters: number[] = [];
  for (let i = 0; i < 3; i++) {
    const card = new Container();
    card.x = laneStartX + i * (LANE_W + LANE_GAP);
    card.y = 430;
    panel(card, 0, 0, LANE_W, LANE_H);
    const border = new Graphics();
    card.addChild(border);
    const shelter = new Graphics();
    shelter.moveTo(64, 108).lineTo(120, 66).lineTo(176, 108).stroke({ width: 5, color: hue });
    shelter.roundRect(76, 104, 88, 78, 10).stroke({ width: 5, color: hue });
    shelter.roundRect(106, 138, 28, 44, 5).stroke({ width: 4, color: hue });
    card.addChild(shelter);
    text(card, `SHELTER ${i + 1}`, 0, 16, 14, T.ink, true).x = LANE_W / 2 - 62;
    const label = text(card, '', 0, 202, 12, T.muted, true);
    card.eventMode = 'static';
    card.cursor = 'pointer';
    card.on('pointerdown', () => { selectedLane = i; updateBoard(); });
    root.addChild(card);
    laneBorders.push(border);
    shelterMarks.push(shelter);
    laneLabels.push(label);
    laneCenters.push(card.x + LANE_W / 2);
  }

  const sweepText = text(root, '', 0, 256, 18, T.ink, true);
  const status = text(root, '', 0, 292, 14, T.good, true);
  const help = text(root, STAGE_CONTROLS, 0, 840, 13, T.muted);
  const goal = panel(root, (STAGE_W - 700) / 2, 300, 700, 220);
  text(goal, STAGE_TITLE, 28, 22, 26, T.gold, true);
  text(goal, 'READ THE SEARCHLIGHT SWEEP, THEN MOVE TO A SHELTERED LANE', 28, 70, 15, T.ink);
  text(goal, 'BEFORE EACH PASS.', 28, 94, 15, T.ink);
  text(goal, STAGE_CONTROLS, 28, 132, 13, T.muted);
  const unlock = text(goal, 'INPUT UNLOCKS IN 2…', 28, 170, 14, T.good, true);

  function centerLabel(label: Text): void {
    label.x = STAGE_W / 2 - label.width / 2;
  }
  function finish(result: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(result);
  }

  function updateBoard(): void {
    const target = targets[wave];
    if (target === undefined) return;
    const center = laneCenters[target] as number;
    beam.clear();
    beam.moveTo(STAGE_W / 2 - 24, 216)
      .lineTo(center - 110, 438)
      .lineTo(center + 110, 438)
      .closePath()
      .fill({ color: hue, alpha: 0.18 });
    sweepText.text = `PASS ${wave + 1} / ${PASS_COUNT} · SEARCHLIGHT INCOMING ON LANE ${target + 1}`;
    centerLabel(sweepText);
    status.text = `YOU IN SHELTER ${selectedLane + 1} · PASSES DODGED ${wave - misses} · NEAR MISSES ${misses}`;
    status.style.fill = misses > 0 ? T.bad : T.good;
    centerLabel(status);
    laneBorders.forEach((border, lane) => {
      border.clear();
      const stroke = lane === selectedLane ? hue : lane === target ? T.bad : T.panelEdge;
      border.roundRect(1, 1, LANE_W - 2, LANE_H - 2, 20).stroke({ width: lane === selectedLane || lane === target ? 4 : 2, color: stroke });
      const mark = shelterMarks[lane] as Graphics;
      mark.alpha = lane === target ? 0.45 : 1;
      const label = laneLabels[lane] as Text;
      label.text = lane === selectedLane ? 'YOU ARE HERE' : lane === target ? 'SEARCHLIGHT TARGET' : 'COVER';
      label.style.fill = lane === target ? T.bad : lane === selectedLane ? T.good : T.muted;
      label.x = LANE_W / 2 - label.width / 2;
    });
    help.x = STAGE_W / 2 - help.width / 2;
  }

  function finishPass(): void {
    const target = targets[wave];
    if (target === undefined) return;
    choices.push(selectedLane);
    if (selectedLane === target) misses++;
    wave++;
    waveElapsed = 0;
    if (wave >= targets.length) {
      const leftFrac = Math.max(0, (budgetMs - playElapsed) / Math.max(1, budgetMs));
      finish(resolveEvasion(targets, choices, ctx.depth, leftFrac));
      return;
    }
    updateBoard();
  }

  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      finish(escaped(0, 'LEFT THE SEARCHLIGHT ZONE'));
      return;
    }
    if (introLeft > 0 || e.repeat) return;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      selectedLane = Math.max(0, selectedLane - 1);
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      selectedLane = Math.min(2, selectedLane + 1);
    } else {
      const value = Number.parseInt(e.key, 10);
      if (Number.isInteger(value) && value >= 1 && value <= 3) {
        e.preventDefault();
        selectedLane = value - 1;
      } else return;
    }
    updateBoard();
  }
  window.addEventListener('keydown', onKey);

  const onTick = (ticker: Ticker): void => {
    if (dead) return;
    if (introLeft > 0) {
      introLeft -= ticker.deltaMS;
      if (introLeft <= 0) {
        introLeft = 0;
        goal.visible = false;
      } else {
        unlock.text = `INPUT UNLOCKS IN ${Math.ceil(introLeft / 1000)}…`;
      }
      return;
    }
    playElapsed += ticker.deltaMS;
    if (playElapsed >= budgetMs) {
      finish(escaped(-misses * 4, 'THE SEARCHLIGHT PASSED'));
      return;
    }
    waveElapsed += ticker.deltaMS;
    if (waveElapsed >= warnMs) finishPass();
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.removeChildren().forEach((child) => child.destroy({ children: true }));
  }

  updateBoard();
  centerLabel(help);
}

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  for (let seed = 0; seed < 256; seed++) {
    const targets = buildSweeps(seed);
    if (targets.length !== PASS_COUNT || targets.some((lane) => lane < 0 || lane > 2)) failures.push(`seed ${seed}: invalid sweep schedule`);
    if (targets.some((lane, i) => i > 0 && lane === targets[i - 1])) failures.push(`seed ${seed}: adjacent passes must change lane`);
    if (JSON.stringify(targets) !== JSON.stringify(buildSweeps(seed))) failures.push(`seed ${seed}: sweep schedule is not deterministic`);
    const safe = targets.map((lane) => (lane + 1) % 3);
    const clean = resolveEvasion(targets, safe, 5, 0.5);
    if (clean.correct !== true || clean.points <= 0 || clean.hpDelta !== 6) failures.push(`seed ${seed}: clean route must win and heal`);
    safe[0] = targets[0] as number;
    const oneHit = resolveEvasion(targets, safe, 5, 0.5);
    if (oneHit.correct !== true || oneHit.hpDelta !== -6) failures.push(`seed ${seed}: one near miss must remain recoverable`);
    safe[1] = targets[1] as number;
    const caught = resolveEvasion(targets, safe, 5, 0.5);
    if (caught.correct !== false || caught.points !== 0 || caught.hpDelta !== -16) failures.push(`seed ${seed}: repeated hits must lose`);
    const partial = resolveEvasion(targets, safe.slice(0, 3), 5, 0.5);
    if (partial.correct !== null || partial.points !== 0) failures.push(`seed ${seed}: unfinished passes must be neutral`);
  }
  return { ok: failures.length === 0, failures };
}
