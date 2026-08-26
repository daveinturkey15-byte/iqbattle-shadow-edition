/**
 * PHOENIX2 — SEED RITUAL takeover scene (v2 port of modes/phoenixritual.js,
 * mechanic not code).
 *
 * MECHANIC — plant -> grow -> burn -> reborn:
 *   PLANT  : the seed sits in the ash bed; first press begins the ritual.
 *   GROW   : 1-3 spurts (depth-scaled). Hold SPACE/mouse — the seedling climbs
 *            the ash meter. RELEASE inside the glowing timing band for a clean
 *            spurt. Overshoot auto-releases past the band (miss). Band centre
 *            and width are seeded; width shrinks with depth.
 *   BURN   : the grown plant catches fire (~1.6 s, motion-gated flicker).
 *   REBORN : payout tiers — III every spurt clean (big points + heal),
 *            II majority clean, I at least one clean, 0 ash ("the seed
 *            refuses"). Verdict settles exactly once after the reveal.
 *
 * DEPTH CURVES (pure, self-tested):
 *   spurts        = clamp(1 + floor((depth-1)/3), 1, 3)
 *   bandWidth ms  = max(110, 260 - 18*(depth-1))
 *   hold cap      = bandHi + 450 ms auto-release (round always advances)
 *
 * POINTS CURVE vs par(diff) = 100*diff + 40 (parFor imported from floorfall.ts):
 *   tier III  = round(par*1.05) — flawless win
 *   tier II   = round(par*0.80) — majority-clean win
 *   tier I    = round(par*0.35) — mercy (NOT a win, no heal)
 *   tier 0    = 0 pts ("the seed refuses")
 *
 * DETERMINISM: one mulberry32(seed ^ SALT) draws the spurt bands in FIXED
 * order at mount. No Math.random, no Date.now — clock is Pixi shared ticker
 * delta. StageResult settles exactly once via onceResolve; container emptied
 * on done; self-limits to ctx.timerLen.
 *
 * FAIRNESS RAILS: one hue (boardHues wheel); burn flicker is localized and
 * <=200 ms flashes; IQB_MOTION=0 renders a static flame and static meter glow;
 * band always visible before the hold starts; Esc bails NEUTRAL; text >=11px.
 */
import { Graphics, Sprite, Texture, Ticker } from 'pixi.js';
import type { Container, Text } from 'pixi.js';

import { T, STAGE_W, STAGE_H } from '../../theme.ts';
import { panel, text } from '../game.ts';
import { mulberry32, onceResolve, escaped } from './redlight.ts';
import type { StageResult, TakeoverCtx } from './redlight.ts';
import { parFor } from './floorfall.ts';

/* ------------------------------------------------------------------ */
/* Pure logic (self-tested)                                            */
/* ------------------------------------------------------------------ */

export const SALT = 0x6e1c3a7;
/** One growth spurt: release anywhere in [bandLo, bandHi] ms of hold. */
export interface Spurt {
  center: number;
  width: number;
}
/** Hold longer than this past the band and the stem snaps (auto-release). */
export const OVERSHOOT_MS = 450;

export function spurtCount(depth: number): number {
  return Math.min(3, Math.max(1, 1 + Math.floor((Math.max(1, depth) - 1) / 3)));
}

export function bandWidth(depth: number): number {
  return Math.max(110, 260 - 18 * (Math.max(1, depth) - 1));
}

/** Seeded spurt plan: centres drawn in fixed rng order inside [700, 1300) ms. */
export function makeSpurts(rng: () => number, depth: number): Spurt[] {
  const w = bandWidth(depth);
  const n = spurtCount(depth);
  const out: Spurt[] = [];
  for (let i = 0; i < n; i++) {
    const c = 700 + rng() * 600;
    out.push({ center: Math.round(c), width: w });
  }
  return out;
}

export function inBand(sp: Spurt, heldMs: number): boolean {
  return heldMs >= sp.center - sp.width / 2 && heldMs <= sp.center + sp.width / 2;
}

export type Tier = 0 | 1 | 2 | 3;

/** III all clean · II majority · I any · 0 none. */
export function tierFor(clean: number, total: number): Tier {
  if (total <= 0) return 0;
  if (clean >= total) return 3;
  if (clean * 2 > total) return 2;
  if (clean >= 1) return 1;
  return 0;
}

export interface Payout {
  correct: boolean;
  points: number;
  hpDelta: number;
}

/** Tier payout fractions of the ladder par; II/III are wins, I is mercy. */
const TIER_FRACS = [0, 0.35, 0.8, 1.05];
const TIER_HP = [0, 0, 4, 10];

/** Shared difficulty ladder: min(5, max(1, 1 + floor(depth/6))). */
export function diffFor(depth: number): number {
  return Math.min(5, Math.max(1, 1 + Math.floor(Math.max(0, depth) / 6)));
}

/** Fraction-of-par tier payout; engine clamps apply downstream. */
export function payoutFor(tier: Tier, depth: number): Payout {
  return {
    correct: tier >= 2,
    points: Math.round(parFor(diffFor(depth)) * TIER_FRACS[tier]),
    hpDelta: TIER_HP[tier],
  };
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

const TRACK_W = 980;
const TRACK_H = 46;
/** px per held millisecond on the meter (1800 ms spans the full track). */
const PX_PER_MS = TRACK_W / 1800;
const BURN_MS = 1600;
const REVEAL_MS = 1500;

interface LiveUi {
  status: Text;
  meter: Graphics;
  plant: Graphics;
  flame: Graphics;
}

export function mountPhoenix2(ctx: TakeoverCtx): void {
  const root = ctx.container;
  const MOTION = typeof localStorage === 'undefined' || localStorage.getItem('IQB_MOTION') !== '0';
  const rng = mulberry32((ctx.seed ^ SALT) >>> 0);
  const settle = onceResolve(ctx.onDone);
  const hue = T.boardHues[ctx.seed % T.boardHues.length];
  const spurts = makeSpurts(rng, ctx.depth);

  /* ---- chrome ---- */
  const bg = new Sprite(Texture.WHITE);
  bg.width = STAGE_W;
  bg.height = STAGE_H;
  bg.tint = T.bg;
  root.addChild(bg);

  const title = text(root, 'SEED RITUAL', 0, 48, 30, hue, true);
  title.anchor.set(0.5, 0);
  title.x = STAGE_W / 2;
  const status = text(root, 'PLANT — PRESS TO BEGIN THE RITUAL', 0, 96, 17, T.gold, true);
  status.anchor.set(0.5, 0);
  status.x = STAGE_W / 2;
  text(root, 'HOLD SPACE / MOUSE TO GROW · RELEASE INSIDE THE BAND', 0, 806, 13, T.muted).anchor.set(0.5, 0);
  (root.children[root.children.length - 1] as Text).x = STAGE_W / 2;

  panel(root, STAGE_W / 2 - TRACK_W / 2 - 24, 470, TRACK_W + 48, TRACK_H + 120);

  const ui: LiveUi = {
    status,
    meter: new Graphics(),
    plant: new Graphics(),
    flame: new Graphics(),
  };
  root.addChild(ui.meter, ui.plant, ui.flame);
  const trackX = STAGE_W / 2 - TRACK_W / 2;
  const trackY = 520;

  /* ---- state ---- */
  let phase: 'plant' | 'grow' | 'burn' | 'reveal' = 'plant';
  let spurtIdx = 0;
  let holding = false;
  let heldMs = 0;
  let clean = 0;
  let dead = false;
  let elapsedMs = 0;
  let phaseMs = 0;
  let lastFlashUntil = 0;

  function settleNow(r: StageResult): void {
    if (dead) return;
    dead = true;
    teardown();
    settle(r);
  }

  function finishRitual(): void {
    const tier = tierFor(clean, spurts.length);
    const pay = payoutFor(tier, ctx.depth);
    settleNow({
      ...pay,
      summary: tier === 3 ? `REBORN IN FULL FLAME · TIER ${tier}`
        : tier === 0 ? 'THE SEED REFUSES THE ASH'
        : `THE PHOENIX STIRS · TIER ${tier}`,
    });
  }

  function release(): void {
    if (!holding || dead) return;
    holding = false;
    const okSpurt = inBand(spurts[spurtIdx], heldMs);
    if (okSpurt) clean++;
    lastFlashUntil = elapsedMs + 200;
    ui.status.text = okSpurt ? 'CLEAN SPURT' : heldMs < spurts[spurtIdx].center ? 'TOO EARLY' : 'TOO LATE';
    spurtIdx++;
    heldMs = 0;
    if (spurtIdx >= spurts.length) {
      phase = 'burn';
      phaseMs = 0;
      ui.status.text = 'BURN';
    }
  }

  function beginHold(): void {
    if (dead) return;
    if (phase === 'plant') {
      phase = 'grow';
      ui.status.text = 'GROW';
    }
    if (phase === 'grow') holding = true;
  }

  function drawMeter(): void {
    ui.meter.clear();
    ui.meter.roundRect(trackX, trackY, TRACK_W, TRACK_H, T.radius).fill({ color: T.tile, alpha: 1 });
    if (phase === 'grow' || phase === 'plant') {
      const sp = spurts[Math.min(spurtIdx, spurts.length - 1)];
      const bx = trackX + (sp.center - sp.width / 2) * PX_PER_MS;
      const bw = sp.width * PX_PER_MS;
      ui.meter.rect(bx, trackY, bw, TRACK_H).fill({ color: hue, alpha: 0.28 });
      ui.meter.rect(bx, trackY, 3, TRACK_H).fill(hue);
      ui.meter.rect(bx + bw - 3, trackY, 3, TRACK_H).fill(hue);
    }
    // marker
    const mx = trackX + Math.min(heldMs * PX_PER_MS, TRACK_W);
    ui.meter.rect(mx - 2, trackY - 8, 4, TRACK_H + 16).fill(T.ink);
  }

  function drawPlant(): void {
    ui.plant.clear();
    const grown = phase === 'plant' ? 0 : Math.min(1, heldMs / 1300);
    const h = 60 + 240 * Math.max(grown, spurtIdx / Math.max(1, spurts.length));
    const cxp = STAGE_W / 2;
    const baseY = 430;
    // stem
    ui.plant.moveTo(cxp, baseY).lineTo(cxp, baseY - h).stroke({ color: hue, width: 6, cap: 'round' });
    // leaf triangles up the stem
    const leaves = 3 + spurtIdx * 2;
    for (let i = 0; i < leaves; i++) {
      const ly = baseY - (h * (i + 1)) / (leaves + 1);
      const side = i % 2 === 0 ? 1 : -1;
      const s = 16;
      ui.plant.poly([cxp, ly, cxp + side * s * 0.9, ly + s * 0.6, cxp + side * s * 0.15, ly]).fill({ color: hue, alpha: 0.85 });
    }
    // seed diamond at base
    ui.plant.poly([cxp, baseY - 12, cxp + 12, baseY, cxp, baseY + 12, cxp - 12, baseY]).fill(hue);
  }
  function drawFlame(t: number): void {
    ui.flame.clear();
    if (phase !== 'burn') return;
    const p = phaseMs / BURN_MS;
    const cxp = STAGE_W / 2;
    const baseY = 430;
    const flick = MOTION ? Math.sin(t / 45) * 14 : 0;
    const fh = 120 + 160 * p + flick;
    ui.flame.poly([cxp - 40, baseY, cxp + 40, baseY, cxp, baseY - fh]).fill({ color: T.orange, alpha: 0.75 });
    ui.flame.poly([cxp - 20, baseY, cxp + 20, baseY, cxp, baseY - fh * 0.66]).fill({ color: T.gold, alpha: 0.9 });
  }

  /* ---- input ---- */
  function onKey(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === 'Escape') {
      settleNow(escaped(0, 'THE ASH BED COOLS — RITUAL ABANDONED'));
      return;
    }
    if (e.key === ' ' && !e.repeat) {
      e.preventDefault();
      beginHold();
    }
  }
  function onKeyUp(e: KeyboardEvent): void {
    if (dead) return;
    if (e.key === ' ') release();
  }
  function onDown(): void {
    beginHold();
  }
  function onUp(): void {
    release();
  }
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  root.eventMode = 'static';
  root.on('pointerdown', onDown);
  root.on('pointerup', onUp);
  root.on('pointerupoutside', onUp);

  /* ---- clock ---- */
  const onTick = (tk: Ticker): void => {
    if (dead) return;
    const dt = tk.deltaMS;
    elapsedMs += dt;
    if (holding) {
      heldMs += dt;
      if (heldMs >= spurts[spurtIdx].center + spurts[spurtIdx].width / 2 + OVERSHOOT_MS) release();
    }
    drawMeter();
    drawPlant();
    drawFlame(elapsedMs);
    if (lastFlashUntil > elapsedMs) {
      // localized feedback only — brief band tint pulse, never fullscreen
      drawFlame(elapsedMs);
    }
    if (phase === 'burn') {
      phaseMs += dt;
      if (phaseMs >= BURN_MS) {
        phase = 'reveal';
        phaseMs = 0;
        const tier = tierFor(clean, spurts.length);
        ui.plant.clear();
        ui.status.text = tier === 0 ? 'ASH.' : `REBORN — TIER ${tier}`;
      }
    } else if (phase === 'reveal') {
      phaseMs += dt;
      if (phaseMs >= REVEAL_MS) finishRitual();
    }
    if (elapsedMs >= ctx.timerLen * 1000) {
      settleNow(escaped(0, 'TIME — THE RITUAL NEVER LIT'));
    }
  };
  Ticker.shared.add(onTick);

  function teardown(): void {
    Ticker.shared.remove(onTick);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
    root.off('pointerdown', onDown);
    root.off('pointerup', onUp);
    root.off('pointerupoutside', onUp);
    root.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  drawMeter();
  drawPlant();
}

/* ------------------------------------------------------------------ */
/* Self-test (pure)                                                    */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  for (let depth = 1; depth <= 15; depth++) {
    if (spurtCount(depth) < 1 || spurtCount(depth) > 3) failures.push(`spurtCount(${depth}) out of range`);
    if (bandWidth(depth) < 110) failures.push(`bandWidth(${depth}) below floor`);
    if (bandWidth(depth) > 260) failures.push(`bandWidth(${depth}) above start width`);
  }
  for (let seed = 1; seed <= 300; seed++) {
    const rng = mulberry32((seed ^ SALT) >>> 0);
    const a = makeSpurts(rng, 4);
    const rng2 = mulberry32((seed ^ SALT) >>> 0);
    const b = makeSpurts(rng2, 4);
    if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`makeSpurts nondeterministic seed=${seed}`);
    if (a.length !== spurtCount(4)) failures.push(`wrong spurt count seed=${seed}`);
    for (const s of a) {
      if (s.center < 700 || s.center >= 1300) failures.push(`band centre out of range seed=${seed}`);
      if (s.width !== bandWidth(4)) failures.push(`band width mismatch seed=${seed}`);
    }
  }
  // spurts are sequential (heldMs resets to 0 each release), so the only
  // geometric constraint is that the earliest possible release stays positive
  if (bandWidth(1) / 2 >= 700) failures.push('half-band wider than minimum centre');
  if (tierFor(0, 3) !== 0) failures.push('tierFor(0,3) != 0');
  if (tierFor(2, 4) !== 1) failures.push('tierFor(2,4) should be minority -> 1');
  const p3 = payoutFor(3, 5);
  if (!p3.correct || p3.hpDelta <= 0 || p3.points <= 0) failures.push('tier III must win, heal and pay');
  const p0 = payoutFor(0, 5);
  if (p0.correct || p0.points !== 0 || p0.hpDelta !== 0) failures.push('tier 0 must not win or pay');
  // payout band: wins pay 60-135% of ladder par at every depth window
  for (let d = 1; d <= 5; d++) {
    const depth = 6 * d - 5;
    if (diffFor(depth) !== d) failures.push(`diffFor ladder broken at window ${d}`);
    const par = parFor(d);
    for (const tier of [2, 3] as const) {
      const pay = payoutFor(tier, depth);
      if (!pay.correct) failures.push(`tier ${tier} must win at diff ${d}`);
      const frac = pay.points / par;
      if (frac < 0.6 || frac > 1.35) failures.push(`tier ${tier} payout out of band at diff ${d}: ${(frac * 100).toFixed(0)}%`);
    }
    // mercy tier I stays strictly below any winning line
    if (payoutFor(1, depth).points >= payoutFor(2, depth).points) {
      failures.push(`tier I mercy must pay less than tier II win at diff ${d}`);
    }
  }
  // inBand boundaries
  const sp: Spurt = { center: 1000, width: 200 };
  if (!inBand(sp, 900) || !inBand(sp, 1000) || !inBand(sp, 1100)) failures.push('inBand misses in-range values');
  if (inBand(sp, 899) || inBand(sp, 1101)) failures.push('inBand accepts out-of-range values');
  // worst-case ritual duration: every spurt held to full cap, then burn+reveal
  const worstSpurtMs = 1300 + bandWidth(1) / 2 + OVERSHOOT_MS;
  const worstRitualMs = spurtCount(15) * worstSpurtMs + BURN_MS + REVEAL_MS;
  if (worstRitualMs > 19500) failures.push(`ritual can overrun 19.5s budget (${worstRitualMs}ms)`);
  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;
