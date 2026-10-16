import { Container, Graphics, Sprite, Texture, Ticker } from 'pixi.js';
import { T, STAGE_H, STAGE_W } from '../../theme.ts';
import { panel, text } from '../game.ts';
import { GOAL_MS, mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';

export const STAGE_ID = 'collectibles';
export const STAGE_TITLE = 'TOKEN RUN';
export const STAGE_GOAL = 'RUN THE THREE-LANE TRAIL, COLLECT THE POSTED TOKEN SET IN ORDER, AND DODGE THE GAPS.';
export const STAGE_CONTROLS = 'ARROWS / WASD · CLICK LANE / KEYS 1–3 · ESC BAILS NEUTRAL';

export type TokenKind = 'ring' | 'coin' | 'banana';
export type LaneMark = TokenKind | 'gap' | 'clear';

export interface TrailGate {
  kind: 'collect' | 'gap';
  target: TokenKind | null;
  lanes: [LaneMark, LaneMark, LaneMark];
  /** Only collect gates have one exact answer lane; gap gates allow either clear lane. */
  answerLane: number | null;
}

const TOKEN_KINDS: readonly TokenKind[] = ['ring', 'coin', 'banana'];
const TOKEN_COUNT = 4;
const GATE_COUNT = 6;
const COURSE_SALT = 0x71a11;
const SETTLE_MS = 400;
const LANE_W = 250;
const LANE_H = 270;
const LANE_GAP = 28;

/** A seeded four-token sequence, with two explicit gap gates between pickups. */
export function buildCourse(seed: number): TrailGate[] {
  const rng = mulberry32((seed ^ COURSE_SALT) >>> 0);
  const start = Math.floor(rng() * TOKEN_KINDS.length);
  const direction = rng() < 0.5 ? 1 : 2;
  const targets = Array.from({ length: TOKEN_COUNT }, (_, i) =>
    TOKEN_KINDS[(start + i * direction) % TOKEN_KINDS.length] as TokenKind,
  );

  const collectGate = (target: TokenKind): TrailGate => {
    const answerLane = Math.floor(rng() * 3);
    const decoys = TOKEN_KINDS.filter((kind) => kind !== target);
    if (rng() < 0.5) decoys.reverse();
    const lanes: [LaneMark, LaneMark, LaneMark] = ['clear', 'clear', 'clear'];
    lanes[answerLane] = target;
    let nextDecoy = 0;
    for (let lane = 0; lane < lanes.length; lane++) {
      if (lane !== answerLane) lanes[lane] = decoys[nextDecoy++] as TokenKind;
    }
    return { kind: 'collect', target, lanes, answerLane };
  };
  const gapGate = (): TrailGate => {
    const gapLane = Math.floor(rng() * 3);
    const lanes: [LaneMark, LaneMark, LaneMark] = ['clear', 'clear', 'clear'];
    lanes[gapLane] = 'gap';
    return { kind: 'gap', target: null, lanes, answerLane: null };
  };

  return [
    collectGate(targets[0] as TokenKind),
    collectGate(targets[1] as TokenKind),
    gapGate(),
    collectGate(targets[2] as TokenKind),
    gapGate(),
    collectGate(targets[3] as TokenKind),
  ];
}

export function correctLane(gate: TrailGate, lane: number): boolean {
  if (!Number.isInteger(lane) || lane < 0 || lane >= 3) return false;
  if (gate.kind === 'collect') return lane === gate.answerLane;
  return gate.lanes[lane] !== 'gap';
}

/** Pure settlement used by the scene and self-test. */
export function resolveTokenRun(
  course: readonly TrailGate[],
  choices: readonly number[],
  depth: number,
  leftFrac: number,
): StageResult {
  let collected = 0;
  for (let i = 0; i < Math.min(course.length, choices.length); i++) {
    const gate = course[i];
    if (!gate || !correctLane(gate, choices[i] as number)) {
      return { correct: false, points: 0, hpDelta: -12, summary: 'MISSED THE TOKEN ROUTE' };
    }
    if (gate.kind === 'collect') collected++;
  }
  if (choices.length < course.length) return escaped(0, 'THE TRAIL MOVED ON');
  if (collected !== TOKEN_COUNT) return { correct: false, points: 0, hpDelta: -12, summary: 'TOKEN SET INCOMPLETE' };

  const par = 100 * Math.max(1, Math.floor(depth)) + 40;
  const time = Math.max(0, Math.min(1, leftFrac));
  return {
    correct: true,
    points: Math.round(par * (0.7 + 0.3 * time)),
    hpDelta: 6,
    summary: 'FOUR TOKENS BANKED',
  };
}

function drawToken(g: Graphics, kind: TokenKind, x: number, y: number, size: number, color: string): void {
  g.clear();
  const r = size * 0.3;
  const stroke = Math.max(3, size * 0.075);
  if (kind === 'ring') {
    g.circle(x, y, r).stroke({ width: stroke, color });
  } else if (kind === 'coin') {
    g.circle(x, y, r).stroke({ width: stroke, color });
    g.roundRect(x - size * 0.045, y - r * 0.55, size * 0.09, r * 1.1, size * 0.04).fill({ color });
  } else {
    g.moveTo(x - size * 0.34, y + size * 0.1)
      .lineTo(x - size * 0.24, y - size * 0.17)
      .lineTo(x - size * 0.03, y - size * 0.25)
      .lineTo(x + size * 0.2, y - size * 0.13)
      .lineTo(x + size * 0.34, y + size * 0.11)
      .lineTo(x + size * 0.17, y + size * 0.04)
      .lineTo(x - size * 0.02, y + size * 0.12)
      .lineTo(x - size * 0.2, y + size * 0.25)
      .closePath()
      .fill({ color });
  }
}

function drawLaneMark(g: Graphics, mark: LaneMark, x: number, y: number, size: number, color: string): void {
  if (mark === 'gap') {
    g.clear();
    g.ellipse(x, y, size * 0.38, size * 0.21).fill({ color: T.bg });
    g.ellipse(x, y, size * 0.38, size * 0.21).stroke({ width: 3, color });
    g.moveTo(x - size * 0.18, y).lineTo(x + size * 0.18, y).stroke({ width: 3, color });
    return;
  }
  if (mark === 'clear') {
    g.clear();
    g.roundRect(x - size * 0.26, y - size * 0.22, size * 0.52, size * 0.44, size * 0.08)
      .stroke({ width: 4, color });
    return;
  }
  drawToken(g, mark, x, y, size, color);
}

function hueFor(seed: number): string {
  return T.boardHues[Math.abs(seed) % T.boardHues.length] as string;
}

export function mountCollectibles(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const settle = onceResolve(ctx.onDone);
  const course = buildCourse(ctx.seed);
  const targetOrder = course.filter((item) => item.kind === 'collect').map((item) => item.target as TokenKind);
  const hue = hueFor(ctx.seed);
  const budgetMs = Math.max(0, ctx.timerLen * 1000 - GOAL_MS - SETTLE_MS);
  const choices: number[] = [];
  let gateIndex = 0;
  let collected = 0;
  let runnerLane = 1;
  let introLeft = GOAL_MS;
  let playElapsed = 0;
  let dead = false;

  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  text(root, 'TOKEN RUN', STAGE_W / 2 - 93, 34, 25, T.gold, true);
  const targetPanel = panel(root, STAGE_W / 2 - 300, 82, 600, 160);
  text(targetPanel, 'COLLECT THIS SET IN ORDER', 28, 18, 15, T.muted, true);
  const targetArts: Graphics[] = [];
  for (let i = 0; i < TOKEN_COUNT; i++) {
    const art = new Graphics();
    art.x = 76 + i * 144;
    art.y = 100;
    targetPanel.addChild(art);
    targetArts.push(art);
  }

  const laneWidthTotal = 3 * LANE_W + 2 * LANE_GAP;
  const laneStartX = (STAGE_W - laneWidthTotal) / 2;
  const laneBorders: Graphics[] = [];
  const laneArts: Graphics[] = [];
  const laneMarkers: Graphics[] = [];
  const laneNames = ['LEFT LANE', 'CENTER LANE', 'RIGHT LANE'];
  for (let i = 0; i < 3; i++) {
    const card = new Container();
    card.x = laneStartX + i * (LANE_W + LANE_GAP);
    card.y = 305;
    panel(card, 0, 0, LANE_W, LANE_H);
    const border = new Graphics();
    card.addChild(border);
    const art = new Graphics();
    card.addChild(art);
    text(card, String(i + 1), 18, 14, 17, T.muted, true);
    text(card, laneNames[i] as string, 24, 218, 14, T.ink, true);
    const marker = new Graphics();
    marker.circle(LANE_W / 2, LANE_H - 18, 10).fill({ color: hue });
    card.addChild(marker);
    laneMarkers.push(marker);
    card.eventMode = 'static';
    card.cursor = 'pointer';
    card.on('pointerdown', () => submit(i));
    root.addChild(card);
    laneBorders.push(border);
    laneArts.push(art);
  }

  const stepText = text(root, '', 0, 262, 18, T.ink, true);
  const status = text(root, '', 0, 810, 17, T.good, true);
  const controls = text(root, STAGE_CONTROLS, STAGE_W / 2 - 264, 854, 13, T.muted);
  const goal = panel(root, (STAGE_W - 680) / 2, 300, 680, 220);
  text(goal, STAGE_TITLE, 28, 22, 26, T.gold, true);
  text(goal, 'RUN THE THREE-LANE TRAIL. COLLECT RING, COIN, AND BANANA TOKENS', 28, 70, 15, T.ink);
  text(goal, 'IN ORDER, AND DODGE THE GAPS.', 28, 94, 15, T.ink);
  text(goal, STAGE_CONTROLS, 28, 132, 13, T.muted);
  const unlock = text(goal, 'INPUT UNLOCKS IN 2…', 28, 170, 14, T.good, true);

  function finish(result: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(result);
  }

  function updateBoard(): void {
    const gate = course[gateIndex];
    targetArts.forEach((art, i) => {
      const target = targetOrder[i];
      if (target) drawToken(art, target, 34, 28, 66, hue);
      art.alpha = i < collected ? 0.35 : 1;
    });
    if (gate) {
      stepText.text = gate.kind === 'collect' ? `GATE ${gateIndex + 1} / ${GATE_COUNT} · NEXT TOKEN: ${gate.target?.toUpperCase()}` : `GATE ${gateIndex + 1} / ${GATE_COUNT} · DODGE THE GAP`;
      stepText.x = STAGE_W / 2 - stepText.width / 2;
      gate.lanes.forEach((mark, lane) => {
        const art = laneArts[lane] as Graphics;
        drawLaneMark(art, mark, LANE_W / 2, 128, 118, hue);
        const border = laneBorders[lane] as Graphics;
        border.clear();
        border.roundRect(1, 1, LANE_W - 2, LANE_H - 2, 20).stroke({ width: 4, color: lane === runnerLane ? hue : T.panelEdge });
        (laneMarkers[lane] as Graphics).visible = lane === runnerLane;
      });
      status.text = gate.kind === 'collect' ? 'CHOOSE THE LANE WITH THE NEXT TOKEN' : 'CHOOSE EITHER OPEN LANE';
    }
    status.x = STAGE_W / 2 - status.width / 2;
    controls.x = STAGE_W / 2 - controls.width / 2;
  }

  function submit(lane: number): void {
    if (dead || introLeft > 0) return;
    const gate = course[gateIndex];
    if (!gate) return;
    runnerLane = lane;
    choices.push(lane);
    if (!correctLane(gate, lane)) {
      const leftFrac = Math.max(0, (budgetMs - playElapsed) / Math.max(1, budgetMs));
      finish(resolveTokenRun(course, choices, ctx.depth, leftFrac));
      return;
    }
    if (gate.kind === 'collect') collected++;
    gateIndex++;
    if (gateIndex >= course.length) {
      const leftFrac = Math.max(0, (budgetMs - playElapsed) / Math.max(1, budgetMs));
      finish(resolveTokenRun(course, choices, ctx.depth, leftFrac));
      return;
    }
    updateBoard();
  }

  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      finish(escaped(0, 'BAILED FROM THE TOKEN TRAIL'));
      return;
    }
    if (introLeft > 0 || e.repeat) return;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      submit(0);
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      submit(2);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'w' || e.key === 'W' || e.key === 's' || e.key === 'S') {
      e.preventDefault();
      submit(1);
    } else if (e.key === '1' || e.key === '2' || e.key === '3') {
      e.preventDefault();
      submit(Number(e.key) - 1);
    }
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
    if (playElapsed >= budgetMs) finish(escaped(0, 'THE TRAIL MOVED ON'));
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.removeChildren().forEach((child) => child.destroy({ children: true }));
  }

  updateBoard();
}

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  for (let seed = 0; seed < 256; seed++) {
    const course = buildCourse(seed);
    if (course.length !== GATE_COUNT) failures.push(`seed ${seed}: expected ${GATE_COUNT} gates`);
    const targets = course.filter((gate) => gate.kind === 'collect');
    if (targets.length !== TOKEN_COUNT || !TOKEN_KINDS.every((kind) => targets.some((gate) => gate.target === kind))) {
      failures.push(`seed ${seed}: course does not post all three tokens`);
    }
    for (const gate of course) {
      if (gate.kind === 'collect') {
        if (gate.answerLane === null || gate.lanes.filter((mark) => mark === gate.target).length !== 1) {
          failures.push(`seed ${seed}: collect gate lacks one unique target lane`);
        }
      } else if (gate.lanes.filter((mark) => mark === 'gap').length !== 1 || gate.lanes.filter((mark) => mark === 'clear').length !== 2) {
        failures.push(`seed ${seed}: gap gate must retain two safe lanes`);
      }
    }
    const winning = course.map((gate) => gate.kind === 'collect' ? gate.answerLane as number : gate.lanes.indexOf('clear'));
    const won = resolveTokenRun(course, winning, 5, 0.5);
    if (won.correct !== true || won.points <= 0 || won.hpDelta !== 6) failures.push(`seed ${seed}: valid route must win and heal`);
    const wrong = [...winning];
    wrong[0] = ((wrong[0] as number) + 1) % 3;
    const missed = resolveTokenRun(course, wrong, 5, 0.5);
    if (missed.correct !== false || missed.points !== 0 || missed.hpDelta !== -12) failures.push(`seed ${seed}: missed token must lose`);
    const partial = resolveTokenRun(course, winning.slice(0, 2), 5, 0.5);
    if (partial.correct !== null || partial.points !== 0) failures.push(`seed ${seed}: unfinished route must be neutral`);
  }
  return { ok: failures.length === 0, failures };
}
