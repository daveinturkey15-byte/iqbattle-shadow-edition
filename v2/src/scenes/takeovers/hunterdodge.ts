/**
 * HUNTER-DODGE — takeover scene (v2 port of modes/hunterdodge.js, mechanic not code).
 *
 * A chrome hunter patrols a seeded Lissajous curve around the board edge; its
 * searchlight cone chases YOUR cursor at a finite turn rate (sharp jinks shake
 * the lock — circling beats it). Beam overlap fills a cumulative EXPOSURE
 * clock; outside the cone it drains at HALF rate. Crossing 2.0 s cumulative =
 * damage tick −10 hp + 400 ms control stutter; each additional full second
 * re-crosses at −6. Click the matching option tile to win (keys 1–8 too).
 * Esc bails NEUTRAL.
 *
 * POINTS CURVE vs par(d) = 100*d + 40 (parFor imported from floorfall.ts):
 *   win   = round(par * min(1, 0.45 + 0.55 * leftFrac))
 *           [+40 GHOST when peak exposure never crossed the 2 s limit]
 *   fail  = 0 pts, hpDelta unchanged (exposure ticks already folded in)
 *   timeo = neutral (correct:null), 0 pts, hpDelta - 5
 *
 * Determinism: patrol frequencies/phases/turn rate/cone are a pure function
 * of ctx.seed via an own mulberry32 in FIXED DRAW ORDER. No Math.random,
 * no Date.now — the clock is Pixi's shared ticker delta. Self-limits to
 * ctx.timerLen; StageResult settles exactly once via onceResolve; container
 * emptied on done.
 *
 * Fairness rails: damage feedback is a localized meter flash (<200 ms,
 * <=3 Hz, never fullscreen strobe); depth >= 8 decoy beam is COSMETIC ONLY
 * and can never damage; motion gated behind localStorage IQB_MOTION ('0' =
 * off → static cone outline, no sweep animation); overlays escapable; all
 * text >= 11 px.
 */
import { Container, Graphics, Rectangle, Sprite, Texture, Ticker } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { Chip } from './redlight.ts';
import { CHIP_KINDS, chipPrims } from './redlight.ts';
import { mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';
import { tileCanvas } from '../../glyphs.ts';
import { panel, text, spriteFrom } from '../game.ts';
import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import { parFor } from './floorfall.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested below)                                      */
/* ------------------------------------------------------------------ */

const HD_SALT = 0xb0ea51;
const SETTLE_MS = 700;

export const EXPOSE_LIMIT_MS = 2000;
export const EXPOSE_STEP_MS = 1000;
export const STUTTER_MS = 400;

export interface HunterParams {
  /** Lissajous cycles across / down */
  fx: number;
  fy: number;
  /** phases [0,1) */
  px: number;
  py: number;
  /** max turn rate rad/s at this depth */
  turnRate: number;
  /** half-cone radians */
  coneHalf: number;
  /** beam length px */
  range: number;
}

/** Seeded hunter — FIXED DRAW ORDER: fx, fy, px, py. Depth scales turn/cone. */
export function hunterParams(seed: number, depth: number): HunterParams {
  const rng = mulberry32((seed ^ HD_SALT) >>> 0);
  const d = Math.max(1, Math.min(10, Math.floor(depth)));
  return {
    fx: 2 + Math.floor(rng() * 3),
    fy: 2 + Math.floor(rng() * 3),
    px: rng(),
    py: rng(),
    turnRate: 2.2 * (1 + 0.15 * Math.min(d - 1, 10)),
    coneHalf: (((24 - 8 * ((d - 1) / 9)) / 2) * Math.PI) / 180, // 24°→16° full cone
    range: 520,
  };
}

/** Lissajous patrol around the upper board band. */
export function patrolPos(p: HunterParams, tMs: number): { x: number; y: number } {
  const t = tMs / 1000;
  return {
    x: STAGE_W / 2 + 560 * Math.sin(2 * Math.PI * (p.fx * t + p.px)),
    y: 380 + 110 * Math.sin(2 * Math.PI * (p.fy * t + p.py)),
  };
}

export function wrapAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= 2 * Math.PI;
  while (r < -Math.PI) r += 2 * Math.PI;
  return r;
}

/** Turn-rate-limited steering toward a target heading. */
export function stepHeading(heading: number, targetAngle: number, dtSec: number, maxTurn: number): number {
  const diff = wrapAngle(targetAngle - heading);
  const step = Math.max(-maxTurn * dtSec, Math.min(maxTurn * dtSec, diff));
  return heading + step;
}

export function beamHits(
  hx: number, hy: number, heading: number,
  cx: number, cy: number, p: HunterParams,
): boolean {
  const dx = cx - hx;
  const dy = cy - hy;
  if (Math.hypot(dx, dy) > p.range) return false;
  return Math.abs(wrapAngle(Math.atan2(dy, dx) - heading)) <= p.coneHalf;
}

export interface ExposureState {
  /** cumulative ms inside the beam */
  clock: number;
  /** next threshold that deals damage when crossed */
  nextAt: number;
  /** accumulated hp damage so far (negative) */
  dmg: number;
}

/**
 * Pure exposure integrator. Inside: clock grows; crossing nextAt deals
 * −10 (first) / −6 per additional full second. Outside: drains at half
 * rate, floored at 0; thresholds stay advanced so re-crossings cost −6.
 */
export function advanceExposure(
  st: ExposureState, inside: boolean, dtMs: number,
): { st: ExposureState; hitHp: number } {
  const clock = inside ? st.clock + dtMs : Math.max(0, st.clock - dtMs / 2);
  let nextAt = st.nextAt;
  let hitHp = 0;
  while (clock >= nextAt) {
    hitHp += nextAt === EXPOSE_LIMIT_MS ? -10 : -6;
    nextAt += EXPOSE_STEP_MS;
  }
  return { st: { clock, nextAt, dmg: st.dmg + hitHp }, hitHp };
}

function makeBoard(rng: () => number): { opts: Chip[]; answerIdx: number } {
  const key = (c: Chip): string => `${c.kind}:${c.n}`;
  const ans: Chip = { kind: Math.floor(rng() * CHIP_KINDS), n: 2 + Math.floor(rng() * 6) };
  const opts: Chip[] = [{ ...ans }];
  while (opts.length < 8) {
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
const GAP = 22;
const COLS = 4;
const GRID_Y = 520;
const METER_W = 620;

export function mountHunterDodge(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const MOTION = typeof localStorage === 'undefined' || localStorage.getItem('IQB_MOTION') !== '0';
  const rng = mulberry32((ctx.seed ^ 0xfeedbee) >>> 0);
  const hue = T.boardHues[ctx.seed % T.boardHues.length];
  const settle = onceResolve(ctx.onDone);
  const hp = hunterParams(ctx.seed, ctx.depth);

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  text(root, 'HUNTER-DODGE', STAGE_W / 2 - 84, 34, 24, T.gold, true);

  const board = makeBoard(rng);
  const targetChip = board.opts[board.answerIdx];
  const tgt = spriteFrom(tileCanvas(chipPrims(targetChip.kind, targetChip.n), hue, 130));
  tgt.x = STAGE_W / 2 - 65;
  tgt.y = 78;
  root.addChild(tgt);
  text(root, 'PICK WHILE DODGING THE SEARCHLIGHT', STAGE_W / 2 - 138, 52, 13, T.muted);

  /* exposure meter */
  const meterBg = new Sprite(Texture.WHITE);
  meterBg.tint = 0x1a2333;
  meterBg.x = (STAGE_W - METER_W) / 2;
  meterBg.y = 232;
  meterBg.width = METER_W;
  meterBg.height = 10;
  root.addChild(meterBg);
  const meter = new Sprite(Texture.WHITE);
  meter.tint = T.bad;
  meter.x = meterBg.x;
  meter.y = meterBg.y;
  meter.height = 10;
  root.addChild(meter);

  const status = text(root, '', 40, 868, 16, T.ink, true);
  text(root, 'THE CONE CHASES YOUR CURSOR · 2 S EXPOSED = −10 HP · KEYS 1–8 ANSWER', STAGE_W / 2 - 260, 838, 12, T.muted);

  /* ---- options ---- */
  const rowW = COLS * OPT_SIZE + (COLS - 1) * GAP;
  const ox = (STAGE_W - rowW) / 2;
  board.opts.forEach((chip, i) => {
    const x = ox + (i % COLS) * (OPT_SIZE + GAP);
    const y = GRID_Y + Math.floor(i / COLS) * (OPT_SIZE + GAP);
    const spr = spriteFrom(tileCanvas(chipPrims(chip.kind, chip.n), hue, OPT_SIZE));
    spr.x = x;
    spr.y = y;
    spr.eventMode = 'static';
    spr.cursor = 'pointer';
    spr.on('pointerdown', () => pick(i));
    root.addChild(spr);
    text(root, String(i + 1), x + 8, y + OPT_SIZE - 24, 13, T.muted);
  });

  /* ---- dynamic layer ---- */
  const fxLayer = new Container();
  root.addChild(fxLayer);

  const decoyCone = new Graphics();
  const cone = new Graphics();
  const hunterSpr = spriteFrom(tileCanvas(chipPrims(1, 1), hue, 44)); // filled diamond
  const crosshair = new Graphics();
  fxLayer.addChild(decoyCone, cone, hunterSpr, crosshair);

  /* ---- state ---- */
  const budgetMs = Math.max(5, ctx.timerLen) * 1000 - SETTLE_MS;
  let clock = 0;
  let heading = Math.PI / 2;
  let cursor: { x: number; y: number } | null = null;
  let exposure: ExposureState = { clock: 0, nextAt: EXPOSE_LIMIT_MS, dmg: 0 };
  let stutterUntil = -1;
  let flashUntil = -1;
  let dead = false;

  function finish(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function pick(i: number): void {
    if (dead || clock < stutterUntil) return;
    if (i === board.answerIdx) {
      const leftFrac = Math.max(0, Math.min(1, (budgetMs - clock) / budgetMs));
      const base = Math.round(parFor(ctx.depth) * Math.min(1, 0.45 + 0.55 * leftFrac));
      const ghost = exposure.dmg === 0;
      finish({
        correct: true,
        points: base + (ghost ? 40 : 0),
        hpDelta: exposure.dmg,
        summary: ghost ? 'GHOST · UNSEEN, UNSCATHED' : 'HUNTER EVADED',
      });
    } else {
      finish({ correct: false, points: 0, hpDelta: exposure.dmg, summary: 'MARKED BY THE BEAM' });
    }
  }

  /* ---- input ---- */
  root.eventMode = 'static';
  root.hitArea = new Rectangle(0, 0, STAGE_W, STAGE_H);
  const onMove = (e: FederatedPointerEvent): void => {
    cursor = { x: e.global.x, y: e.global.y };
  };
  root.on('pointermove', onMove);

  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      finish(escaped(exposure.dmg - 5, 'IT NEVER BLINKS'));
      return;
    }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 8) pick(n - 1);
  }
  window.addEventListener('keydown', onKey);

  /* ---- clock ---- */
  const drawCone = (g: Graphics, h: number, alpha: number): void => {
    g.clear();
    g.moveTo(hunterSpr.x, hunterSpr.y)
      .arc(hunterSpr.x, hunterSpr.y, hp.range, h - hp.coneHalf, h + hp.coneHalf)
      .closePath()
      .fill({ color: hue, alpha });
  };

  const onTick = (tk: Ticker): void => {
    if (dead) return;
    const dt = tk.deltaMS;
    clock += dt;
    if (clock >= budgetMs) {
      finish(escaped(exposure.dmg - 5, 'IT NEVER BLINKS'));
      return;
    }

    const pos = patrolPos(hp, clock);
    hunterSpr.x = pos.x;
    hunterSpr.y = pos.y;

    // beam steers toward the cursor with finite turn rate
    if (cursor) {
      const want = Math.atan2(cursor.y - pos.y, cursor.x - pos.x);
      if (MOTION) heading = stepHeading(heading, want, dt / 1000, hp.turnRate);
      else heading = want; // reduced motion: beam snaps, rules identical

      drawCone(cone, heading, 0.16);
      if (ctx.depth >= 8) drawCone(decoyCone, heading + Math.PI, 0.06); // cosmetic only

      const inside = beamHits(pos.x, pos.y, heading, cursor.x, cursor.y, hp);
      const before = exposure;
      const res = advanceExposure(before, inside, dt);
      exposure = res.st;
      if (res.hitHp < 0) {
        stutterUntil = clock + STUTTER_MS;
        flashUntil = clock;
        status.text = `MARKED! ${res.hitHp} HP`;
        status.style.fill = T.bad;
      }

      // meter shows how close the lock is (fills toward the 2 s limit)
      meter.width = Math.max(2, METER_W * Math.min(1, exposure.clock / EXPOSE_LIMIT_MS));

      crosshair.clear();
      crosshair.circle(cursor.x, cursor.y, 9).stroke({ width: 2, color: T.ink, alpha: 0.8 });
    }

    // localized meter flash decays inside the fairness window
    if (flashUntil >= 0 && clock - flashUntil > 180) {
      meter.tint = 0x1a2333;
      flashUntil = -1;
    } else if (flashUntil >= 0) {
      meter.tint = T.ink;
    }
    if (clock >= stutterUntil && status.text.startsWith('MARKED')) {
      status.text = `EXPOSED ${(exposure.clock / 1000).toFixed(1)}S · HP ${exposure.dmg}`;
      status.style.fill = exposure.dmg < 0 ? T.bad : T.ink;
    }
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    root.off('pointermove', onMove);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }
}

/* ------------------------------------------------------------------ */
/* Self-test (pure — no DOM, no Pixi objects constructed)              */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  // 500 seeds: params deterministic, bounded, positive
  for (let seed = 1; seed <= 500; seed++) {
    const depth = 1 + ((seed * 11) % 10);
    const a = hunterParams(seed, depth);
    const b = hunterParams(seed, depth);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      failures.push(`params nondeterministic seed=${seed}`);
      break;
    }
    if (a.coneHalf <= 0 || a.turnRate <= 0 || a.range <= 0) {
      failures.push(`bad params seed=${seed}`);
      break;
    }
    // patrol stays inside its band for a whole minute of samples
    for (let t = 0; t < 60000; t += 137) {
      const p = patrolPos(a, t);
      if (p.x < 200 || p.x > STAGE_W - 200 || p.y < 250 || p.y > 510) {
        failures.push(`patrol out of band seed=${seed} t=${t}`);
        break;
      }
    }
    if (failures.length > 0) break;
  }
  // depth scaling monotone: faster turns, tighter cones
  if (hunterParams(7, 10).turnRate <= hunterParams(7, 1).turnRate) failures.push('turn rate should grow with depth');
  if (hunterParams(7, 10).coneHalf >= hunterParams(7, 1).coneHalf) failures.push('cone should shrink with depth');
  // steering: converges, respects turn cap, wraps correctly
  const halfPi = Math.PI / 2;
  if (Math.abs(stepHeading(0, halfPi, 0.5, 2.2) - 1.1) > 1e-9) failures.push('steering ignores turn cap');
  if (Math.abs(wrapAngle(Math.PI * 3 - Math.PI)) > 1e-9) failures.push('wrapAngle broken');
  let h = 0;
  for (let i = 0; i < 200; i++) h = stepHeading(h, 0.05, 0.05, 2.2);
  if (h < 0.049) failures.push('steering does not converge');
  // exposure: first tick exactly at the limit, −10; re-crosses −6/s; drains at half rate
  let st: ExposureState = { clock: 0, nextAt: EXPOSE_LIMIT_MS, dmg: 0 };
  let r = advanceExposure(st, true, 1999);
  if (r.hitHp !== 0 || r.st.clock !== 1999) failures.push('early exposure tick');
  // clean walk: 2000ms inside → −10, another 1000 → −6
  st = { clock: 0, nextAt: EXPOSE_LIMIT_MS, dmg: 0 };
  for (let i = 0; i < 20; i++) st = advanceExposure(st, true, 100).st;
  if (st.dmg !== -10 || st.nextAt !== 3000) failures.push(`first tick wrong dmg=${st.dmg}`);
  for (let i = 0; i < 10; i++) st = advanceExposure(st, true, 100).st;
  if (st.dmg !== -16) failures.push(`second tick wrong dmg=${st.dmg}`);
  // outside: half-rate drain, floored at zero, ghost intact when never exposed
  st = { clock: 1000, nextAt: EXPOSE_LIMIT_MS, dmg: 0 };
  st = advanceExposure(st, false, 100).st;
  if (st.clock !== 950) failures.push('drain not half-rate');
  st = { clock: 0, nextAt: EXPOSE_LIMIT_MS, dmg: 0 };
  for (let i = 0; i < 50; i++) st = advanceExposure(st, false, 100).st;
  if (st.clock !== 0 || st.dmg !== 0) failures.push('drain floor/ghost broken');
  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/scenes/takeovers/hunterdodge.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/hunterdodge.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] HUNTER-DODGE OK' : `[selftest] HUNTER-DODGE FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
