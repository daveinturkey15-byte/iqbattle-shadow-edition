/**
 * ladder.ts — DEPTH-LADDER chrome element for v2 (lore visual).
 *
 * A slim vertical ladder mounted on the stage edge that shows progress
 * through the seven hell layers:
 *   - current rung GLOWS crimson (pale blue while a SANCTUARY round holds)
 *   - rungs already descended past are CLEARED and sit dim
 *   - rungs still ahead are ghost outlines
 * plus a depth numeral above the rail (rounds survived).
 *
 * Rails respected:
 *   - Pure/state split: rungStateFor()/clampLayer()/glowColor() are pure and
 *     carry ALL decisions; the Pixi renderer below is a thin deterministic
 *     painter (no Ticker, no randomness, no Date.now anywhere).
 *   - One-hue discipline: exactly ONE accent hue paints the current rung per
 *     frame — crimson, or pale blue only while sanctuary light is up. It
 *     NEVER varies between rungs within one paint.
 *   - Static chrome: no animation loops; glow is painted alpha, so reduced-
 *     motion users get identical output by construction.
 *   - HUD clearance: default mount hugs the right stage edge, vertically
 *     centred — outside the board panel's ~60% region, so it can never
 *     overlap option tiles or the rule line (DNA layout contract).
 *   - Contrast: depth numeral is T.ink (#f5f8ff) at 24 px over bg (#04070f)
 *     — worst-case backdrop stays well above readable.
 *
 * Integration (Main):
 *   const ladder = buildLadder(plan.layer, run.depth);   // once per run
 *   scene.addChild(ladder);
 *   updateLadder(ladder, plan.layer, plan.sanctuary);    // every round
 *   // optional: setDepth(ladder, run.depth) after interlude grants
 * Self-test:  node --experimental-strip-types src/scenes/ladder.ts
 */
import { Container, Graphics, Text } from 'pixi.js';
import { T, STAGE_W, STAGE_H } from '../theme.ts';

/* ------------------------------------------------------------------ */
/* Pure ladder logic (self-tested — no Pixi objects constructed here)  */
/* ------------------------------------------------------------------ */

/** Fixed lore: seven layers of hell, one rung each. */
export const LADDER_RUNGS = 7;

export type RungState =
  | 'cleared' // descended past — dim
  | 'current' // where the player hangs — glowing
  | 'ahead'; // still below them in the descent — ghost

/** Current-rung accent: crimson pressure, or pale-blue sanctuary light. */
export const CRIMSON_GLOW: string = '#e0245e';
export const SANCTUARY_GLOW: string = '#48bfff';

const CLEARED_FILL = T.muted;
const AHEAD_EDGE = '#3a475c';

/** Arc data guarantees layer 1..7; hostile input clamps instead of lying. */
export function clampLayer(layer: number): number {
  return Math.min(LADDER_RUNGS, Math.max(1, Math.round(layer)));
}

/** Rung index is 1-based to mirror layer numbering directly. */
export function rungStateFor(rung: number, layer: number): RungState {
  const l = clampLayer(layer);
  if (rung < l) return 'cleared';
  if (rung === l) return 'current';
  return 'ahead';
}

/** The single accent hue for the current rung this frame. */
export function glowColor(sanctuary: boolean): string {
  return sanctuary ? SANCTUARY_GLOW : CRIMSON_GLOW;
}

/* ------------------------------------------------------------------ */
/* Renderer — thin deterministic painter over the pure logic           */
/* ------------------------------------------------------------------ */

const RUNG_W = 26;
const RUNG_H = 6;
const RUNG_GAP = 32; // baseline-to-baseline spacing between rungs
const NUMERAL_SIZE = 24; // v2 text rail floor for chrome numerals
const NUMERAL_H = 30;
const RAIL_PAD = 12;

export interface LadderHandle extends Container {
  /** One Graphics per rung, index 0 = layer 1 (top) .. 6 = layer 7 (bottom). */
  readonly rungs: readonly Graphics[];
  /** Depth numeral (rounds survived) sitting above the rail. */
  readonly numeral: Text;
  readonly rail: Graphics;
}

function drawRung(g: Graphics, state: RungState, sanctuary: boolean): void {
  g.clear();
  if (state === 'current') {
    const c = glowColor(sanctuary);
    // soft painted halo, then the solid core — no filters, no animation
    g.roundRect(-6, -6, RUNG_W + 12, RUNG_H + 12, (RUNG_H + 12) / 2)
      .fill({ color: c, alpha: 0.22 });
    g.roundRect(0, 0, RUNG_W, RUNG_H, RUNG_H / 2)
      .fill({ color: c, alpha: 1 });
  } else if (state === 'cleared') {
    g.roundRect(3, 0, RUNG_W - 6, RUNG_H, RUNG_H / 2)
      .fill({ color: CLEARED_FILL, alpha: 0.35 });
  } else {
    g.roundRect(5, 1, RUNG_W - 10, RUNG_H - 2, (RUNG_H - 2) / 2)
      .stroke({ width: 1, color: AHEAD_EDGE, alpha: 0.85 });
  }
}

function paint(handle: LadderHandle, layer: number, sanctuary: boolean): void {
  const l = clampLayer(layer);
  handle.rungs.forEach((g, i) => drawRung(g, rungStateFor(i + 1, l), sanctuary));
}

/**
 * Build the depth-ladder. Default mount hugs the right stage edge,
 * vertically centred (callers may reposition the returned container).
 */
export function buildLadder(layer: number, depth: number): LadderHandle {
  const rungs: Graphics[] = [];
  for (let i = 0; i < LADDER_RUNGS; i++) rungs.push(new Graphics());

  const numeral = new Text({
    text: String(Math.max(0, Math.floor(depth))),
    style: {
      fontFamily: T.font,
      fontSize: NUMERAL_SIZE,
      fontWeight: '800',
      fill: T.ink,
      letterSpacing: 1,
    },
  });
  numeral.anchor.set(0.5);
  numeral.position.set(RAIL_PAD + RUNG_W / 2, NUMERAL_H / 2);

  // descent reads downward: layer 1 (surface) at the top, layer 7 (abyss) lowest
  const firstY = NUMERAL_H + 14;
  const lastY = firstY + (LADDER_RUNGS - 1) * RUNG_GAP;
  const rail = new Graphics();
  rail.roundRect(RAIL_PAD + RUNG_W / 2 - 1, firstY, 2, lastY - firstY, 1)
    .fill({ color: T.muted, alpha: 0.16 });

  const root: LadderHandle = Object.assign(new Container(), {
    rungs: rungs as readonly Graphics[],
    numeral,
    rail,
  });

  root.addChild(rail, numeral);
  rungs.forEach((g, i) => {
    g.position.set(RAIL_PAD, firstY + i * RUNG_GAP);
    root.addChild(g);
  });

  const totalH = lastY + RUNG_H;
  root.position.set(STAGE_W - RAIL_PAD * 2 - RUNG_W, (STAGE_H - totalH) / 2);

  paint(root, layer, false);
  return root;
}

/** Per-round repaint: new layer, and pale-blue glow while sanctuary holds. */
export function updateLadder(handle: LadderHandle, layer: number, sanctuary = false): void {
  paint(handle, layer, sanctuary);
}

/** Depth numeral refresh (rounds survived) without touching rung states. */
export function setDepth(handle: LadderHandle, depth: number): void {
  handle.numeral.text = String(Math.max(0, Math.floor(depth)));
}

/* ------------------------------------------------------------------ */
/* Self-test (node-runnable, pure — mirrors repo convention)            */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  /* clamp keeps hostile input inside the lore range */
  if (clampLayer(0) !== 1 || clampLayer(-4) !== 1) failures.push('clamp must floor at 1');
  if (clampLayer(8) !== 7 || clampLayer(999) !== 7) failures.push('clamp must cap at 7');
  for (let l = 1; l <= 7; l++) {
    if (clampLayer(l) !== l) failures.push(`clamp disturbed valid layer ${l}`);
    if (clampLayer(l + 0.4) !== l) failures.push(`clamp should round ${l}.4 down`);
  }

  /* glow hues: crimson by default, pale blue under sanctuary, always valid hex */
  const hex = /^#[0-9a-f]{6}$/;
  if (!hex.test(CRIMSON_GLOW) || !hex.test(SANCTUARY_GLOW)) failures.push('glow colors must be #rrggbb');
  if (CRIMSON_GLOW === SANCTUARY_GLOW) failures.push('sanctuary glow must differ from crimson');
  if (glowColor(false) !== CRIMSON_GLOW) failures.push('non-sanctuary glow must be crimson');
  if (glowColor(true) !== SANCTUARY_GLOW) failures.push('sanctuary glow must be pale blue');

  /* rung states sweep across EVERY layer 1..7 */
  for (let layer = 1; layer <= 7; layer++) {
    let cleared = 0;
    let current = 0;
    let ahead = 0;
    for (let rung = 1; rung <= LADDER_RUNGS; rung++) {
      const s = rungStateFor(rung, layer);
      if (s !== rungStateFor(rung, layer)) failures.push(`state impure at layer ${layer} rung ${rung}`);
      if (s === 'cleared') cleared++;
      else if (s === 'current') current++;
      else ahead++;
    }
    if (current !== 1) failures.push(`layer ${layer}: expected exactly 1 current rung, got ${current}`);
    if (cleared !== layer - 1) failures.push(`layer ${layer}: expected ${layer - 1} cleared, got ${cleared}`);
    if (ahead !== LADDER_RUNGS - layer) failures.push(`layer ${layer}: expected ${LADDER_RUNGS - layer} ahead, got ${ahead}`);
    // structure: cleared strictly above the current rung, ahead strictly below
    for (let rung = 1; rung <= LADDER_RUNGS; rung++) {
      const s = rungStateFor(rung, layer);
      if (rung < layer && s !== 'cleared') failures.push(`layer ${layer}: rung ${rung} above current must be cleared`);
      if (rung === layer && s !== 'current') failures.push(`layer ${layer}: rung ${rung} must be current`);
      if (rung > layer && s !== 'ahead') failures.push(`layer ${layer}: rung ${rung} below current must be ahead`);
    }
  }

  /* boundary sweeps: layer 1 has nothing cleared, layer 7 has nothing ahead */
  if (rungStateFor(1, 1) !== 'current') failures.push('layer 1 top rung must be current');
  for (let rung = 2; rung <= 7; rung++) {
    if (rungStateFor(rung, 1) !== 'ahead') failures.push(`layer 1: rung ${rung} must be ahead`);
  }
  for (let rung = 1; rung <= 6; rung++) {
    if (rungStateFor(rung, 7) !== 'cleared') failures.push(`layer 7: rung ${rung} must be cleared`);
  }
  if (rungStateFor(7, 7) !== 'current') failures.push('layer 7 bottom rung must be current');

  /* out-of-range rungs still classify deterministically (defensive parity) */
  if (rungStateFor(0, 4) !== 'cleared' && rungStateFor(0, 4) !== 'ahead') {
    failures.push('out-of-range rung must still yield a defined state');
  }

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/scenes/ladder.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/ladder.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] DEPTH-LADDER OK' : `[selftest] DEPTH-LADDER FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
