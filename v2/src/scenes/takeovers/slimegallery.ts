/**
 * SLIME GALLERY — carnival shooting-gallery takeover scene (v2 port of
 * modes/slime.js, mechanic not code).
 *
 * MECHANIC — quota under the big top:
 *   Nine portholes (3x3). A seeded PUBLIC schedule pops slimes (~26 across
 *   30 s). Click / tap a lane (or keys 1-9) to fire — 250 ms recoil cooldown.
 *   SPLAT every plain slime you can: hit the QUOTA (12 splats = win,
 *   6..11 = partial) before the booth closes.
 *   CROWNED slimes are DECOYS: shooting one COSTS you double a splat's worth.
 *   The crown is the single distinguishing attribute (DNA: structure, never
 *   color — all three kinds share the board hue).
 *
 * DEPTH CURVES (pure, self-tested):
 *   eff = clamp(1 + floor(depth/6), 1, 5)
 *   up-window   1100 -> 550 ms      (step 140 per eff)
 *   decoy ratio 10% -> 30%          (step 5% per eff)
 *   double pops from eff>=3 · gold flees early at eff>=5
 *
 * SCORING: normal = 5+3*eff · gold = x3 · crowns cost 2x · escapes -2 each.
 * Wins are normalized so quota-minimum play lands at the puzzle par
 * (100*eff+40); a failing round (<6 splats) pays the wrong-answer parity
 * -(10+10*eff). Six or more escapes cost 10 hp (booth dims as warning).
 *
 * DETERMINISM: the whole schedule is pure from ctx.seed via an own mulberry32
 * in FIXED draw order (time gaps -> lane -> type -> doubles). No hidden
 * answers, no Math.random, no Date.now — clock is Pixi's ticker delta.
 *
 * FAIRNESS RAILS: feedback is per-lane only (never fullscreen); crosshair /
 * controls hint always visible; crowns readable at 11 px+; Esc ends the round
 * NEUTRAL with resolved tallies; every text >= 11 px.
 */
import { Sprite, Texture, Ticker } from 'pixi.js';
import type { Text } from 'pixi.js';

import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import type { Prim } from '../../glyphs.ts';
import { tileCanvas } from '../../glyphs.ts';
import { panel, text, spriteFrom } from '../game.ts';
import { mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested)                                            */
/* ------------------------------------------------------------------ */

export const LANES = 9;
export const ROUND_MS = 30000;
/** generous window around emergence/descent where a shot still connects */
export const HIT_WINDOW_MS = 120;
export const FIRE_COOLDOWN_MS = 250;
export const QUOTA_WIN = 12;
export const QUOTA_PART = 6;
export const ESCAPE_HP_COST = 10;
export const POINTS_CAP = 500;

const GALLERY_SALT = 0xba11a1d5;
export const GOLD_RATIO = 0.10;

export type SlimeType = 'normal' | 'decoy' | 'gold';

export interface Pop {
  lane: number;
  /** ms into the round when the slime starts rising */
  t: number;
  /** time fully up before it sinks away */
  up: number;
  type: SlimeType;
}

export function effFor(depth: number): number {
  return Math.min(5, Math.max(1, 1 + Math.floor(Math.max(1, depth) / 6)));
}

export function upMsFor(eff: number): number {
  return Math.max(550, 1100 - (eff - 1) * 140);
}

export function decoyRatioFor(eff: number): number {
  return Math.min(0.3, 0.1 + (eff - 1) * 0.05);
}

function rollType(roll: number, decoyR: number): SlimeType {
  if (roll < GOLD_RATIO) return 'gold';
  if (roll < GOLD_RATIO + decoyR) return 'decoy';
  return 'normal';
}

/**
 * Seeded public schedule — FIXED DRAW ORDER (do not reorder):
 *   per slot: lane rng(), type rng(), double-pop check rng(), gap rng()
 *   (doubles, eff>=3 only: companion lane rng(), companion type rng())
 */
export function buildSchedule(seed: number, depth: number): Pop[] {
  const rng = mulberry32((seed ^ GALLERY_SALT) >>> 0);
  const eff = effFor(depth);
  const decoyR = decoyRatioFor(eff);
  const baseUp = upMsFor(eff);
  const pops: Pop[] = [];
  let t = 700;
  while (pops.length < 44 && t < ROUND_MS - baseUp) {
    const lane = Math.floor(rng() * LANES);
    const type = rollType(rng(), decoyR);
    const up = type === 'gold' && eff >= 5 ? Math.round(baseUp * 0.6) : baseUp;
    pops.push({ lane, t, up, type });
    if (eff >= 3 && rng() < 0.18 && t + 400 < ROUND_MS) {
      let lane2 = Math.floor(rng() * (LANES - 1));
      if (lane2 >= lane) lane2++;
      const type2 = rollType(rng(), decoyR);
      const up2 = type2 === 'gold' && eff >= 5 ? Math.round(baseUp * 0.6) : baseUp;
      pops.push({ lane: lane2, t, up: up2, type: type2 });
    }
    t += Math.round(1150 * (0.72 + 0.56 * rng()));
  }
  return pops;
}

/** A shot connects iff fired inside the live window and not already resolved. */
export function popLiveAt(pop: Pop, ms: number): boolean {
  return ms >= pop.t - HIT_WINDOW_MS && ms <= pop.t + pop.up + HIT_WINDOW_MS;
}

export interface ScoreInput {
  /** plain slimes splatted */
  normal: number;
  /** gold slimes splatted */
  gold: number;
  /** crowned decoys shot (costly!) */
  decoy: number;
  /** plain/gold slimes that sank unshot */
  escapes: number;
}

export interface GalleryVerdict {
  correct: boolean | null;
  points: number;
  hpDelta: number;
  summary: string;
}

export function scoreRound(s: ScoreInput, depth: number): GalleryVerdict {
  const eff = effFor(depth);
  const n0 = 5 + 3 * eff;
  const raw = s.normal * n0 + s.gold * n0 * 3 - s.decoy * n0 * 2 - s.escapes * 2;
  const hits = s.normal + s.gold;
  const par = 100 * eff + 40;
  // normalize: quota-minimum play with zero extras lands exactly on par
  const scale = par / (QUOTA_WIN * n0);
  const hpDelta = s.escapes >= 6 ? -ESCAPE_HP_COST : 0;
  const summary = `${hits} SPLATS · ${s.gold} GOLD`;
  if (hits >= QUOTA_WIN) {
    return { correct: true, points: Math.min(POINTS_CAP, Math.max(1, Math.round(raw * scale))), hpDelta, summary };
  }
  if (hits >= QUOTA_PART) {
    return { correct: null, points: Math.max(0, Math.round(raw * scale * 0.6)), hpDelta, summary };
  }
  return { correct: false, points: -(10 + 10 * eff), hpDelta, summary };
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

/** Primitive glyphs per kind — crown is the ONLY decoy tell, diamond the ONLY gold tell. */
function slimePrims(kind: SlimeType): Prim[] {
  const prims: Prim[] = [
    { k: 'dot', x: 38, y: 62, r: 8 },
    { k: 'dot', x: 62, y: 62, r: 8 },
    { k: 'dot', x: 50, y: 50, r: 9 },
    { k: 'dot', x: 44, y: 74, r: 7 },
    { k: 'dot', x: 57, y: 74, r: 7 },
  ];
  if (kind === 'gold') prims.push({ k: 'diamond', x: 50, y: 32, s: 8 });
  if (kind === 'decoy') {
    prims.push(
      { k: 'tri', x: 38, y: 26, s: 6 },
      { k: 'tri', x: 50, y: 22, s: 6 },
      { k: 'tri', x: 62, y: 26, s: 6 },
    );
  }
  return prims;
}

interface LiveSlime {
  pop: Pop;
  idx: number;
  sprite: Sprite;
  shot: boolean;
}

export function mountSlimeGallery(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const hue = T.boardHues[(ctx.seed >>> 5) % T.boardHues.length];
  const hueNum = parseInt(hue.slice(1), 16);
  const settle = onceResolve(ctx.onDone);
  const schedule = buildSchedule(ctx.seed, ctx.depth);

  /* ---- static chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  text(root, 'SLIME GALLERY', STAGE_W / 2 - 108, 84, 30, hue, true);
  text(root, 'SPLAT THE PLAIN SLIMES · NEVER SHOOT A CROWN', STAGE_W / 2 - 196, 130, 15, T.muted);

  /* ---- booth ---- */
  const cell = 150;
  const gap = 22;
  const cols = 3;
  const rows = 3;
  const rowW = cols * cell + (cols - 1) * gap;
  const ox = (STAGE_W - rowW) / 2;
  const oy = 200;
  panel(root, ox - 34, oy - 34, rowW + 68, rows * cell + (rows - 1) * gap + 190);

  const texByKind: Record<SlimeType, Texture> = {
    normal: Texture.from(tileCanvas(slimePrims('normal'), hue, cell)),
    decoy: Texture.from(tileCanvas(slimePrims('decoy'), hue, cell)),
    gold: Texture.from(tileCanvas(slimePrims('gold'), hue, cell)),
  };
  const holeTex = Texture.from(tileCanvas([], hue, cell)); // empty porthole

  const holes: Sprite[] = [];
  for (let lane = 0; lane < LANES; lane++) {
    const col = lane % cols;
    const row = Math.floor(lane / cols);
    const h = new Sprite(holeTex);
    h.x = ox + col * (cell + gap);
    h.y = oy + row * (cell + gap);
    h.eventMode = 'static';
    h.cursor = 'pointer';
    root.addChild(h);
    holes.push(h);
    text(root, String(lane + 1), h.x + 8, h.y + cell - 26, 13, T.muted);
  }

  const ui = {
    status: text(root, '', ox, oy + rows * (cell + gap) + 24, 19, T.ink, true),
    progress: text(root, '', ox, oy + rows * (cell + gap) + 64, 15, T.muted),
    timerBar: new Sprite(Texture.WHITE),
  };
  ui.timerBar.x = ox;
  ui.timerBar.y = oy + rows * (cell + gap) + 100;
  ui.timerBar.height = 6;
  root.addChild(ui.timerBar);

  text(root, 'CLICK A PORTHOLE OR PRESS 1-9 TO FIRE', ox, oy + rows * (cell + gap) + 128, 13, T.muted);

  function refreshProgress(): void {
    const splats = tallies.normal + tallies.gold;
    ui.progress.text =
      `SPLATS ${splats}/${QUOTA_WIN} · GOLD ${tallies.gold} · CROWNS SHOT ${tallies.decoy}`;
  }

  /* ---- state machine ---- */
  const liveByLane: Array<LiveSlime | null> = Array.from({ length: LANES }, () => null);
  const resolved = new Set<number>();
  const tallies: { normal: number; gold: number; decoy: number; escapes: number } = {
    normal: 0, gold: 0, decoy: 0, escapes: 0,
  };
  let clock = 0;
  let spawnIdx = 0;
  let lastFireMs = -FIRE_COOLDOWN_MS;
  let dead = false;

  function finish(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function endRound(): void {
    finish({ ...scoreRound(tallies, ctx.depth) });
  }

  function despawn(live: LiveSlime, shot: boolean): void {
    resolved.add(live.idx);
    if (live.sprite.parent) live.sprite.parent.removeChild(live.sprite);
    liveByLane[live.pop.lane] = null;
    if (!shot && live.pop.type !== 'decoy') {
      tallies.escapes++;
      refreshProgress();
    }
  }

  function spawnDue(): void {
    while (spawnIdx < schedule.length && schedule[spawnIdx].t <= clock) {
      const pop = schedule[spawnIdx];
      const idx = spawnIdx;
      spawnIdx++;
      // a lane still busy keeps its current slime; the pop escapes unresolved
      if (liveByLane[pop.lane] || resolved.has(idx)) continue;
      const sprite = new Sprite(texByKind[pop.type]);
      const hole = holes[pop.lane];
      sprite.x = hole.x;
      sprite.y = hole.y;
      sprite.alpha = 0; // rises via alpha/scale so it never covers neighbouring lanes
      sprite.scale.set(0.6);
      root.addChild(sprite);
      liveByLane[pop.lane] = { pop, idx, sprite, shot: false };
    }
  }

  /** Rise = alpha/scale in over 180 ms; sink = back out. No cross-lane overlap. */
  function animateSlimes(): void {
    for (const live of liveByLane) {
      if (!live) continue;
      const age = clock - live.pop.t;
      const rise = Math.min(1, Math.max(0, age / 180));
      const sinkAge = age - live.pop.up;
      const sink = sinkAge > 0 ? Math.min(1, sinkAge / 180) : 0;
      const vis = rise * (1 - sink);
      live.sprite.alpha = vis;
      live.sprite.scale.set(0.6 + 0.4 * vis);
      if (sink >= 1) despawn(live, false);
    }
  }

  function fire(lane: number): void {
    if (dead || clock - lastFireMs < FIRE_COOLDOWN_MS) return;
    lastFireMs = clock;
    const live = liveByLane[lane];
    if (live && !live.shot && popLiveAt(live.pop, clock)) {
      live.shot = true;
      if (live.pop.type === 'decoy') {
        tallies.decoy++;
        ui.status.text = 'THE CROWN COSTS YOU';
      } else if (live.pop.type === 'gold') {
        tallies.gold++;
        ui.status.text = 'GOLD SPLAT — TREBLE PAY';
      } else {
        tallies.normal++;
        ui.status.text = 'SPLAT!';
      }
      despawn(live, true);
      refreshProgress();
      if (tallies.normal + tallies.gold >= QUOTA_WIN) endRound();
    } else {
      ui.status.text = 'MISS — RECOILING';
    }
  }

  const barW = rowW;
  const onTick = (tk: Ticker): void => {
    if (dead) return;
    clock += tk.deltaMS;
    spawnDue();
    animateSlimes();
    ui.timerBar.width = Math.max(2, barW * Math.max(0, 1 - clock / ROUND_MS));
    ui.timerBar.tint = clock > ROUND_MS * 0.7 ? T.bad : hueNum;
    if (clock >= ROUND_MS || spawnIdx >= schedule.length) {
      const allResolved = spawnIdx >= schedule.length && liveByLane.every((l) => !l);
      if (clock >= ROUND_MS || allResolved) endRound();
    }
  };


  holes.forEach((h, lane) => {
    h.on('pointerdown', () => fire(lane));
  });

  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      finish(escaped(0, 'LEFT THE BOOTH'));
      return;
    }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= LANES) fire(n - 1);
  }
  window.addEventListener('keydown', onKey);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  refreshProgress();
  ui.status.text = 'THE GALLERY OPENS…';
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // schedule determinism + structural bounds
  for (let seed = 1; seed <= 80; seed++) {
    for (const depth of [1, 5, 11, 30]) {
      const s = seed * 48611 + depth;
      const a = buildSchedule(s, depth);
      const b = buildSchedule(s, depth);
      if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`schedule nondeterministic seed=${s}`);
      if (a.length < 14 || a.length > 44) failures.push(`pop count ${a.length} out of band`);
      let prevT = -1;
      for (const p of a) {
        if (p.lane < 0 || p.lane >= LANES) failures.push('lane out of range');
        if (p.t < 0 || p.t + p.up > ROUND_MS + HIT_WINDOW_MS) failures.push('pop overruns the round');
        if (p.t < prevT) failures.push('schedule not time-ordered');
        prevT = p.t;
      }
      const eff = effFor(depth);
      // tiny samples swing wildly; only flag absurd per-seed skew here
      const decoys = a.filter((p) => p.type === 'decoy').length;
      if (decoys / a.length > 0.7) failures.push(`decoy flood depth=${depth} seed=${s}`);
      for (const p of a) {
        if (p.up !== upMsFor(eff) && !(eff >= 5 && p.type === 'gold' && p.up === Math.round(upMsFor(eff) * 0.6))) {
          failures.push(`up-window curve violated depth=${depth}`);
          break;
        }
      }
    }
  }

  // pooled decoy ratio tracks the curve across seeds
  for (const depth of [1, 11, 30]) {
    let total = 0;
    let decoyTotal = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const a = buildSchedule(seed * 48611 + depth, depth);
      decoyTotal += a.filter((p) => p.type === 'decoy').length;
      total += a.length;
    }
    const pooled = decoyTotal / total;
    const target = decoyRatioFor(effFor(depth));
    if (pooled < target * 0.6 || pooled > target * 1.6) {
      failures.push(`pooled decoy ${pooled.toFixed(3)} off target ${target.toFixed(2)} depth=${depth}`);
    }
  }

  // curves clamp
  if (effFor(0) !== 1 || effFor(300) !== 5) failures.push('eff clamp broken');
  if (upMsFor(1) !== 1100 || upMsFor(4) !== 680 || upMsFor(5) !== 550 || upMsFor(9) !== 550) {
    failures.push('up-window curve wrong');
  }
  if (Math.abs(decoyRatioFor(1) - 0.1) > 1e-9 || Math.abs(decoyRatioFor(5) - 0.3) > 1e-9) {
    failures.push('decoy ratio curve wrong');
  }

  // live-window judgment
  const pop: Pop = { lane: 3, t: 1000, up: 800, type: 'normal' };
  if (!popLiveAt(pop, 1000) || !popLiveAt(pop, 900) || !popLiveAt(pop, 1920)) failures.push('live window too tight');
  if (popLiveAt(pop, 700) || popLiveAt(pop, 2100)) failures.push('live window too loose');

  // scoring bounds across tallies
  for (let seed = 1; seed <= 40; seed++) {
    const rng = mulberry32(seed);
    const s: ScoreInput = {
      normal: Math.floor(rng() * 20),
      gold: Math.floor(rng() * 8),
      decoy: Math.floor(rng() * 6),
      escapes: Math.floor(rng() * 12),
    };
    const hits = s.normal + s.gold;
    const v = scoreRound(s, seed % 20);
    if (hits >= QUOTA_WIN && v.correct !== true) failures.push('quota win verdict wrong');
    if (hits >= QUOTA_PART && hits < QUOTA_WIN && v.correct !== null) failures.push('partial verdict wrong');
    if (hits < QUOTA_PART && (v.correct !== false || v.points >= 0)) failures.push('fail parity missing');
    if (v.points > POINTS_CAP || v.points < -(10 + 10 * 5)) failures.push(`points ${v.points} out of band`);
    if (s.escapes < 6 && v.hpDelta !== 0) failures.push('unexpected hp cost');
    if (s.escapes >= 6 && v.hpDelta !== -ESCAPE_HP_COST) failures.push('escape hp cost missing');
  }

  // quota-minimum play lands on par
  const parCheck = scoreRound({ normal: QUOTA_WIN, gold: 0, decoy: 0, escapes: 0 }, 1);
  if (parCheck.points !== 140) failures.push(`par normalization off (${parCheck.points})`);

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;
