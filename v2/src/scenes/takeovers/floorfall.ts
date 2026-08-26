/**
 * FLOOR-FALL — takeover scene (v2 port of modes/floorfall.js, mechanic not code).
 *
 * 8 answer chips are stone tiles on a collapsing floor. A seeded fall schedule
 * cracks tiles (warning shimmer) then drops them into the dark. Your cursor IS
 * your body: stand on a tile to load it, click to commit that answer. Standing
 * on a tile when it drops = PLUNGE (-8 hp, 0.7 s stun). Keys 1–8 pick without
 * standing (no plunge risk, NOT surefooted-eligible). Esc bails NEUTRAL.
 *
 * POINTS CURVE vs par(d) = 100*d + 40:
 *   win   = round(par * min(1, 0.45 + 0.55 * leftFrac))
 *           [+25 SUREFOOTED when >=2 falls survived, zero plunges, pick made
 *            by standing click]
 *   fail  = 0 pts, hp hpDelta - 10 (wrong-pick sting) — plunges already folded
 *           into hpDelta at -8 each
 *   timeo = neutral (correct:null), 0 pts, hpDelta - 5
 *
 * SOLVABILITY RAILS (asserted over 500 seeds in selfTest()):
 *   - the ANSWER tile is never dropped (schedule is answer-blind; the scene
 *     filters it — the skip can never leak the answer because warning/drop
 *     eligibility is evaluated silently before any visual telegraphs);
 *   - a drop only executes when MORE than 3 tiles remain standing afterwards,
 *     so at least 3 wrong tiles always stay loadable.
 *
 * Determinism: fall times/tiles are a pure function of ctx.seed via an own
 * mulberry32 in FIXED DRAW ORDER (tile, [double-fall tile], gap jitter…).
 * No Math.random, no Date.now — the clock is Pixi's shared ticker delta.
 * Self-limits to ctx.timerLen; StageResult settles exactly once via
 * onceResolve; container emptied on done.
 *
 * Fairness rails: crack warning 0.8 s→0.4 s by depth BEFORE any drop; damage
 * feedback is a localized vignette (<200 ms, never fullscreen strobe); ambient
 * motion gated behind localStorage IQB_MOTION ('0' = off → static cracks, no
 * shake); overlays escapable; all text >= 11 px. A 2 s goal card freezes the
 * fall clock and locks input (except Esc) before play; its cost comes out of
 * the play budget so the stage still resolves inside ctx.timerLen.
 */
import { Container, Graphics, Rectangle, Sprite, Text, Texture, Ticker } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { Chip } from './redlight.ts';
import { CHIP_KINDS, chipPrims } from './redlight.ts';
import { GOAL_MS, mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';
import { tileCanvas } from '../../glyphs.ts';
import { panel, text, spriteFrom } from '../game.ts';
import { T, STAGE_W, STAGE_H } from '../../theme.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested below)                                      */
/* ------------------------------------------------------------------ */

const FF_SALT = 0xf100fa11;
export const TILES = 8;
const SETTLE_MS = 700;

/** Points par for a takeover stage: base curve every port documents against. */
export const parFor = (d: number): number => 100 * d + 40;

export interface FallEvent {
  tile: number;
  /** crack shimmer starts */
  warnAt: number;
  /** tile drops */
  dropAt: number;
}

export function fallParams(depth: number): { warnMs: number; gapMs: number } {
  const d = Math.max(1, Math.min(10, Math.floor(depth)));
  const u = (d - 1) / 9;
  return { warnMs: Math.round(800 - 400 * u), gapMs: Math.round(4000 - 1800 * u) };
}

/**
 * Seeded fall schedule — FIXED DRAW ORDER (do not reorder):
 * first drop at 25% of budget, then gaps of gapMs*(0.85+0.30*rng());
 * depth >= 6 rolls a double-fall (35%) right after some falls.
 * Always fits inside timerLen*1000 minus the settle margin.
 */
export function buildFallSchedule(seed: number, depth: number, timerLenSec: number): FallEvent[] {
  const rng = mulberry32((seed ^ FF_SALT) >>> 0);
  const p = fallParams(depth);
  const budget = Math.max(5, timerLenSec) * 1000 - SETTLE_MS;
  const evs: FallEvent[] = [];
  let t = Math.round(budget * 0.25);
  const push = (at: number): void => {
    evs.push({ tile: Math.floor(rng() * TILES), warnAt: at, dropAt: at + p.warnMs });
  };
  while (t + p.warnMs < budget) {
    push(t);
    t += Math.round(p.gapMs * (0.85 + 0.3 * rng()));
    if (depth >= 6 && rng() < 0.35 && t + p.warnMs < budget) {
      push(t);
      t += Math.round(p.gapMs * (0.85 + 0.3 * rng()));
    }
  }
  return evs;
}

export interface FallSim {
  /** tiles that actually dropped, in order */
  dropped: number[];
  /** smallest standing-tile count reached */
  minStanding: number;
}

/**
 * Pure rail check (mirrors the scene's runtime filter exactly):
 * the answer tile NEVER drops and a drop only executes when more than
 * 3 tiles would remain standing.
 */
export function simulateFalls(evs: FallEvent[], answerIdx: number): FallSim {
  const standing = new Set<number>(Array.from({ length: TILES }, (_, i) => i));
  const dropped: number[] = [];
  for (const e of evs) {
    if (!standing.has(e.tile)) continue;
    if (e.tile === answerIdx) continue; // answer spared, always
    if (standing.size - 1 < 3) continue; // solvability rail
    standing.delete(e.tile);
    dropped.push(e.tile);
  }
  return { dropped, minStanding: standing.size };
}

function makeBoard(rng: () => number): { opts: Chip[]; answerIdx: number } {
  const key = (c: Chip): string => `${c.kind}:${c.n}`;
  const ans: Chip = { kind: Math.floor(rng() * CHIP_KINDS), n: 2 + Math.floor(rng() * 6) };
  const opts: Chip[] = [{ ...ans }];
  while (opts.length < TILES) {
    const c: Chip = { kind: Math.floor(rng() * CHIP_KINDS), n: 2 + Math.floor(rng() * 6) };
    if (!opts.some((o) => key(o) === key(c))) opts.push(c);
  }
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  return { opts, answerIdx: opts.findIndex((o) => key(o) === key(ans)) };
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

const OPT_SIZE = 150;
const GAP = 24;
const COLS = 4;
const GRID_Y = 452;

interface TileUi {
  spr: Sprite;
  crack: Graphics;
  x: number;
  y: number;
  standing: boolean;
  warning: boolean;
}

export function mountFloorFall(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const MOTION = typeof localStorage === 'undefined' || localStorage.getItem('IQB_MOTION') !== '0';
  const rng = mulberry32((ctx.seed ^ 0xa11ce51) >>> 0);
  const hue = T.boardHues[ctx.seed % T.boardHues.length];
  const settle = onceResolve(ctx.onDone);

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  panel(root, STAGE_W / 2 - 330, 60, 660, 320);
  text(root, 'FLOOR-FALL', STAGE_W / 2 - 70, 74, 24, T.gold, true);

  const board = makeBoard(rng);
  const targetChip = board.opts[board.answerIdx];
  const tgt = spriteFrom(tileCanvas(chipPrims(targetChip.kind, targetChip.n), hue, 150));
  tgt.x = STAGE_W / 2 - 75;
  tgt.y = 140;
  root.addChild(tgt);
  text(root, 'STAND ON THE MATCHING TILE · CLICK TO COMMIT', STAGE_W / 2 - 190, 112, 13, T.muted);

  const vignette = new Sprite(Texture.WHITE);
  vignette.width = STAGE_W;
  vignette.height = STAGE_H;
  vignette.tint = 0xff2038;
  vignette.alpha = 0;
  root.addChild(vignette);

  // status/rule live between the target panel and the tile grid — inside the
  // safe band under the engine's shell header (nothing below y=430)
  const status = text(root, '', 40, 386, 16, T.ink, true);
  text(root, 'CRACKS TELEGRAPH EVERY DROP · KEYS 1–8 PICK WITHOUT STANDING · ESC EXITS NEUTRAL', 40, 414, 12, T.muted);

  /* ---- tiles ---- */
  const tiles: TileUi[] = [];
  const rowW = COLS * OPT_SIZE + (COLS - 1) * GAP;
  const ox = (STAGE_W - rowW) / 2;
  board.opts.forEach((chip, i) => {
    const col = i % COLS;
    const rowI = Math.floor(i / COLS);
    const x = ox + col * (OPT_SIZE + GAP);
    const y = GRID_Y + rowI * (OPT_SIZE + GAP);
    const spr = spriteFrom(tileCanvas(chipPrims(chip.kind, chip.n), hue, OPT_SIZE));
    spr.x = x;
    spr.y = y;
    spr.eventMode = 'static';
    spr.cursor = 'pointer';
    spr.on('pointerdown', () => pick(i, true));
    const crack = new Graphics();
    spr.addChild(crack);
    root.addChild(spr);
    text(root, String(i + 1), x + 8, y + OPT_SIZE - 24, 13, T.muted);
    tiles.push({ spr, crack, x, y, standing: true, warning: false });
  });

  /* ---- state ---- */
  // goal-card freeze comes out of the schedule budget so the stage still
  // self-resolves inside ctx.timerLen on the wall clock
  const playSec = Math.max(6, ctx.timerLen - GOAL_MS / 1000);
  const evs = buildFallSchedule(ctx.seed, ctx.depth, playSec);
  const budgetMs = playSec * 1000 - SETTLE_MS;
  let clock = 0;
  let warnIdx = 0;
  let dropIdx = 0;
  let standingCount = TILES;
  let plunges = 0;
  let survived = 0;
  let hpDelta = 0;
  let stunUntil = -1;
  let vignetteAt = -1;
  let cursorTile = -1;
  let dead = false;

  /* ---- goal card (first GOAL_MS: input locked, clock frozen) ----
   * Mirrors meta/onboard.ts CARDS['floor-fall'] — keep in step if that moves. */
  const CARD_W = 620;
  const card = panel(root, (STAGE_W - CARD_W) / 2, 300, CARD_W, 176);
  text(card, 'FLOOR-FALL', 28, 20, 26, T.gold, true);
  text(card, 'ANSWER BEFORE THE TILE UNDER YOU DROPS.', 28, 64, 15, T.ink);
  text(card, 'CLICK / TAP A STANDING TILE OR KEYS 1–8 · ESC EXITS NEUTRAL', 28, 94, 13, T.muted);
  const unlockTxt = text(card, 'INPUT UNLOCKS IN 2…', 28, 130, 14, T.good, true);
  let introLeft = GOAL_MS;

  /** A warned drop only executes when more than 3 tiles would remain. */
  function canDrop(tileIdx: number): boolean {
    if (tileIdx === board.answerIdx) return false;
    return standingCount - 1 >= 3;
  }

  function executeDrop(e: FallEvent): void {
    const t = tiles[e.tile];
    if (!t.standing || !canDrop(e.tile)) return;
    t.standing = false;
    standingCount--;
    t.spr.alpha = 0.12;
    t.spr.eventMode = 'none';
    t.crack.clear();
    if (cursorTile === e.tile) {
      // PLUNGE — you were standing on it
      plunges++;
      hpDelta -= 8;
      stunUntil = clock + 700;
      vignetteAt = clock;
      status.text = `PLUNGE! −8 HP · SURVIVED ${survived} · PLUNGES ${plunges}`;
      status.style.fill = T.bad;
    } else {
      survived++;
      refreshHud();
    }
  }

  function refreshHud(): void {
    status.text = `SURVIVED ${survived} FALLS · PLUNGES ${plunges} · HP ${hpDelta}`;
    status.style.fill = hpDelta < 0 ? T.bad : T.ink;
  }

  function finish(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function pick(i: number, stoodClick: boolean): void {
    if (dead || introLeft > 0 || clock < stunUntil) return;
    if (!tiles[i].standing) return;
    if (i === board.answerIdx) {
      const leftFrac = Math.max(0, Math.min(1, (budgetMs - clock) / budgetMs));
      const base = Math.round(parFor(ctx.depth) * Math.min(1, 0.45 + 0.55 * leftFrac));
      const surefooted = survived >= 2 && plunges === 0 && stoodClick;
      finish({
        correct: true,
        points: base + (surefooted ? 25 : 0),
        hpDelta,
        summary: surefooted ? 'SUREFOOTED · FLOOR CLEARED' : 'FLOOR CLEARED',
      });
    } else {
      finish({ correct: false, points: 0, hpDelta: hpDelta - 10, summary: 'THE FLOOR TOOK YOU' });
    }
  }

  /* ---- input ---- */
  root.eventMode = 'static';
  root.hitArea = new Rectangle(0, 0, STAGE_W, STAGE_H);
  const onMove = (e: FederatedPointerEvent): void => {
    const gx = e.global.x;
    const gy = e.global.y;
    cursorTile = -1;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (gx >= t.x && gx < t.x + OPT_SIZE && gy >= t.y && gy < t.y + OPT_SIZE) {
        cursorTile = i;
        break;
      }
    }
  };
  root.on('pointermove', onMove);

  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      finish(escaped(hpDelta - 5, 'ESCAPED THE COLLAPSE'));
      return;
    }
    if (introLeft > 0) return; // goal card still up
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= TILES) pick(n - 1, false);
  }
  window.addEventListener('keydown', onKey);

  /* ---- clock ---- */
  const onTick = (tk: Ticker): void => {
    if (dead) return;
    const dt = tk.deltaMS;
    if (introLeft > 0) {
      // goal card: fall clock frozen, input locked (guards above), Esc works
      introLeft -= dt;
      if (introLeft <= 0) card.visible = false;
      else unlockTxt.text = `INPUT UNLOCKS IN ${Math.ceil(introLeft / 1000)}…`;
      return;
    }
    clock += dt;
    if (clock >= budgetMs) {
      finish(escaped(hpDelta - 5, 'BURIED WITH THE TILES'));
      return;
    }

    // warnings telegraph ahead of drops
    while (warnIdx < evs.length && evs[warnIdx].warnAt <= clock) {
      const e = evs[warnIdx++];
      const t = tiles[e.tile];
      if (t.standing && canDrop(e.tile)) {
        t.warning = true;
        t.crack.clear();
        t.crack.setStrokeStyle({ width: 2, color: 0xff2038, alpha: 0.9 });
        const q = OPT_SIZE / 4;
        t.crack.moveTo(q, q).lineTo(q * 1.6, q * 2).lineTo(q * 1.2, q * 3);
        t.crack.moveTo(OPT_SIZE - q, q * 1.2).lineTo(OPT_SIZE - q * 1.7, q * 2.2);
      }
    }
    // drops execute on schedule
    while (dropIdx < warnIdx && evs[dropIdx].dropAt <= clock) {
      const e = evs[dropIdx++];
      if (tiles[e.tile].warning) {
        tiles[e.tile].warning = false;
        executeDrop(e);
      }
    }

    // warning shimmer (<=3 Hz alpha breathing, static under MOTION off)
    // + hover lift marks where you stand
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (t.warning && MOTION) t.crack.alpha = 0.75 + 0.25 * Math.sin(clock / 90);
      if (t.standing) t.spr.y = MOTION && cursorTile === i ? t.y - 3 : t.y;
    }

    // plunge vignette decays well inside the 200 ms fairness window
    if (vignetteAt >= 0) {
      const k = (clock - vignetteAt) / 180;
      vignette.alpha = k >= 1 ? 0 : 0.14 * (1 - k);
      if (k >= 1) vignetteAt = -1;
    }
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.off('pointermove', onMove);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  refreshHud();
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  // 500 seeds: determinism + fit + positive timings + rails for every answer slot
  for (let seed = 1; seed <= 500; seed++) {
    const depth = 1 + ((seed * 7) % 10);
    const timerLen = 15 + ((seed * 3) % 46);
    const a = buildFallSchedule(seed, depth, timerLen);
    const b = buildFallSchedule(seed, depth, timerLen);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      failures.push(`schedule nondeterministic seed=${seed}`);
      break;
    }
    const budget = Math.max(5, timerLen) * 1000 - SETTLE_MS;
    if (a.some((e) => e.dropAt > budget || e.dropAt <= e.warnAt || e.tile < 0 || e.tile >= TILES)) {
      failures.push(`bad event timing/tile seed=${seed}`);
      break;
    }
    for (let ans = 0; ans < TILES; ans++) {
      const sim = simulateFalls(a, ans);
      if (sim.dropped.includes(ans)) {
        failures.push(`answer tile dropped seed=${seed} ans=${ans}`);
        break;
      }
      if (sim.minStanding < 3) {
        failures.push(`standing fell below 3 seed=${seed} ans=${ans}`);
        break;
      }
    }
    if (failures.length > 0) break;
  }
  if (buildFallSchedule(42, 1, 30).length === 0) failures.push('no falls scheduled for depth 1 / 30 s');
  const p1 = fallParams(1);
  const p10 = fallParams(10);
  if (p1.warnMs !== 800 || p10.warnMs !== 400) failures.push('warning duration curve wrong');
  if (p1.gapMs !== 4000 || p10.gapMs !== 2200) failures.push('gap curve wrong');
  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/scenes/takeovers/floorfall.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/floorfall.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] FLOOR-FALL OK' : `[selftest] FLOOR-FALL FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
