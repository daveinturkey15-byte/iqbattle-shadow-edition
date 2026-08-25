/**
 * Corruption ARC data — deterministic descent planner + chrome token sets.
 *
 * Dave's lore (v2 law): mostly bad/chaotic, ~1-in-5 good rounds that heal,
 * descent gets worse with depth, good rounds continue the previous redemption
 * thread (inherit the closed block's depth), and on heaven rounds the ENTIRE
 * chrome reverts to faithful original-iqversus tokens (SANCTUARY).
 *
 * Lineage: v1 alignment.js (blocks of 4-6 hostile closed by exactly 1 good =>
 * long-run ~5:1; redemption continuity inherits arcDepth) + v1 sanctuary.js
 * ("the light remembers you" faithful-skin refuge). Pure data — no game logic.
 */
import { rngFrom } from './puzzles/types.ts';

export type Align = 'bad' | 'chaotic' | 'neutral' | 'good';

/** Plan slice for one puzzle depth (round). */
export interface ArcPlan {
  align: Align;
  /** Descent act 0..3; ramps toward the abyss with absolute depth. */
  act: 0 | 1 | 2 | 3;
  /** True only on good rounds — full chrome revert to SANCTUARY_TOKENS. */
  sanctuary: boolean;
  /** Consecutive-hostile pressure 1..7 (crimson vignette strength). */
  layer: number;
}

/**
 * Deterministic per-depth arc plan.
 *
 * Structure mirrors v1 alignment.js SPEC 6: blocks of 4-6 hostile rounds
 * closed by exactly 1 good round (long-run ~5 hostile : 1 good). Chaotic
 * rounds are ~1-in-8 of hostile rounds. After a long block one NEUTRAL
 * limbo round may precede the good closer (v1 SPEC 2). The good closer
 * INHERITS the closed block's depth as its layer (v1 SPEC 3 redemption
 * continuity) — heaven ascends out of the arc it closes.
 */
export function planArc(seed: number, maxDepth = 40): ArcPlan[] {
  const rnd = rngFrom(seed);
  const plans: ArcPlan[] = [];
  const actSpan = Math.max(1, Math.ceil(maxDepth / 4));
  let consecHostile = 0;

  while (plans.length < maxDepth) {
    let blockLen = 4 + Math.floor(rnd() * 3); // 4..6 hostile
    // Tail fit: shrink a final short block so the redemption closer still
    // lands inside maxDepth (keeps the long-run ~5:1 honest at every seed).
    const remaining = maxDepth - plans.length;
    const clamped = remaining - 1 < blockLen;
    if (clamped) blockLen = Math.min(blockLen, Math.max(0, remaining - 1));
    const limbo = !clamped && blockLen >= 5 && rnd() < 0.25; // rare neutral before relief
    const closeLayer = Math.min(7, Math.max(1, blockLen));

    for (let i = 0; i < blockLen && plans.length < maxDepth; i++) {
      consecHostile++;
      plans.push({
        align: rnd() < 1 / 8 ? 'chaotic' : 'bad',
        act: Math.min(3, Math.floor(plans.length / actSpan)) as 0 | 1 | 2 | 3,
        sanctuary: false,
        layer: Math.min(7, consecHostile),
      });
    }
    if (limbo && plans.length < maxDepth) {
      plans.push({
        align: 'neutral',
        act: Math.min(3, Math.floor(plans.length / actSpan)) as 0 | 1 | 2 | 3,
        sanctuary: false,
        layer: closeLayer, // limbo hangs at the closed block's depth
      });
    }
    if (plans.length < maxDepth) {
      plans.push({
        align: 'good',
        act: Math.min(3, Math.floor(plans.length / actSpan)) as 0 | 1 | 2 | 3,
        sanctuary: true,
        layer: closeLayer, // redemption continuity: inherit closed depth
      });
      consecHostile = 0;
    }
  }
  return plans;
}

/* ------------------------------------------------------------------ */
/* Token sets                                                          */
/* ------------------------------------------------------------------ */

/** Chrome tokens for one descent act. act0 is near-original; act3 is black/crimson. */
export interface ActTokens {
  name: string;
  bg: string;
  panel: string;
  tile: string;
  edge: string;
  accent: string;
  ink: string;
  muted: string;
}

/** Per-act chrome. Index = ArcPlan.act. One hue discipline: accents stay cold-blue until the descent turns crimson. */
export const ARC_TOKENS: readonly [ActTokens, ActTokens, ActTokens, ActTokens] = [
  {
    name: 'SURFACE',
    bg: '#04070f',
    panel: '#0a1220',
    tile: '#0a0d14',
    edge: 'rgba(64,137,238,0.16)',
    accent: '#2d7cff',
    ink: '#f5f8ff',
    muted: '#9aa7ba',
  },
  {
    name: 'DESCENT',
    bg: '#070510',
    panel: '#120c1e',
    tile: '#0d0916',
    edge: 'rgba(139,92,246,0.15)',
    accent: '#8b5cf6',
    ink: '#efe9ff',
    muted: '#8f86a8',
  },
  {
    name: 'INFERNO',
    bg: '#0a0307',
    panel: '#1c0812',
    tile: '#140509',
    edge: 'rgba(224,36,94,0.18)',
    accent: '#e0245e',
    ink: '#ffeef4',
    muted: '#a87f92',
  },
  {
    name: 'ABYSS',
    bg: '#030102',
    panel: '#12020a',
    tile: '#0b0104',
    edge: 'rgba(255,32,56,0.22)',
    accent: '#ff2038',
    ink: '#ffdade',
    muted: '#94555f',
  },
];

/**
 * Faithful original-iqversus chrome (v1 sanctuary.js; research/w1-original-recon.md).
 * Applied wholesale on good/heaven rounds — "the light remembers you".
 */
export const SANCTUARY_TOKENS = {
  name: 'SANCTUARY',
  bg: '#040812',
  panel: '#020e20',
  panelAlt: '#020c1d',
  footer: '#040b16',
  border: 'rgba(64,137,238,0.16)',
  borderActive: 'rgba(72,191,255,0.38)',
  text: '#f5f8ff',
  muted: '#9aa7ba',
  disabled: '#6f7f96',
  accent: '#2d7cff',
} as const;

/** Crimson vignette pressure per consecutive-hostile layer (1..7). */
export interface LayerTokens {
  /** Overlay alpha — escalates with consecutive hostile rounds. */
  alpha: number;
  /** Vignette color (crimson family, deepening). */
  color: string;
  /** Whisper shown by the layer banner. */
  label: string;
}

export const LAYER_TOKENS: readonly LayerTokens[] = [
  { alpha: 0.08, color: '#2a060c', label: '' },
  { alpha: 0.14, color: '#38080f', label: 'the walls are listening' },
  { alpha: 0.21, color: '#47070f', label: 'something followed you down' },
  { alpha: 0.29, color: '#56060e', label: 'it knows your name' },
  { alpha: 0.38, color: '#65040d', label: 'the light is very far away' },
  { alpha: 0.48, color: '#72030b', label: 'do not answer it' },
  { alpha: 0.58, color: '#80010a', label: 'nothing above us now' },
];

/* ------------------------------------------------------------------ */
/* Self-check (node-runnable): import { __selfTest } from './arc-data' */
/* ------------------------------------------------------------------ */

export function __selfTest(): string {
  const fails: string[] = [];
  const ok = (cond: boolean, msg: string): void => {
    if (!cond) fails.push(msg);
  };

  // Tokens complete: acts 0-3 and layers 1-7 fully defined.
  ok(ARC_TOKENS.length === 4, 'ARC_TOKENS must have 4 acts');
  ARC_TOKENS.forEach((t, i) => {
    for (const k of ['name', 'bg', 'panel', 'tile', 'edge', 'accent', 'ink', 'muted'] as const) {
      ok(typeof t[k] === 'string' && t[k].length > 0, `ARC_TOKENS[${i}].${k} missing`);
    }
  });
  ok(LAYER_TOKENS.length === 7, 'LAYER_TOKENS must have layers 1..7');
  LAYER_TOKENS.forEach((l, i) => {
    ok(typeof l.alpha === 'number' && l.alpha > 0, `LAYER_TOKENS[${i}].alpha must be > 0`);
    if (i > 0) ok(l.alpha > LAYER_TOKENS[i - 1].alpha, `LAYER_TOKENS alpha not escalating at ${i + 1}`);
  });

  let totalGood = 0;
  let totalHostile = 0;

  for (let seed = 1; seed <= 20; seed++) {
    const plans = planArc(seed, 40);
    ok(plans.length === 40, `seed ${seed}: expected 40 depths`);

    // Ratio ~5:1 over 40 depths (hostile:good within 4..6.5 given 4-6 blocks + rare limbo).
    const good = plans.filter((p) => p.align === 'good').length;
    const hostile = plans.filter((p) => p.align === 'bad' || p.align === 'chaotic').length;
    totalGood += good;
    totalHostile += hostile;
    ok(good >= 4 && good <= 10, `seed ${seed}: good count ${good} outside 4..10`);
    const ratio = hostile / Math.max(1, good);
    ok(ratio >= 3.5 && ratio <= 6.5, `seed ${seed}: hostile:good ${ratio.toFixed(2)} outside ~5:1`);

    // Sanctuary iff good; acts valid + non-decreasing with depth.
    let prevAct = 0;
    plans.forEach((p, d) => {
      ok(p.sanctuary === (p.align === 'good'), `seed ${seed} d${d}: sanctuary must be true exactly on good`);
      ok(p.act >= prevAct, `seed ${seed} d${d}: act regressed`);
      ok(p.layer >= 1 && p.layer <= 7, `seed ${seed} d${d}: layer ${p.layer} out of 1..7`);
      prevAct = p.act;
    });

    // Layer monotonic within blocks: hostile layers climb with consecutive count.
    let consec = 0;
    for (const p of plans) {
      if (p.align === 'bad' || p.align === 'chaotic') {
        consec++;
        ok(p.layer === Math.min(7, consec), `seed ${seed}: hostile layer ${p.layer} != min(7,${consec})`);
      } else {
        ok(
          p.align === 'neutral' ? p.layer <= Math.max(1, consec) || consec === 0 : true,
          `seed ${seed}: limbo layer continuity`,
        );
        consec = 0;
      }
    }

    // Determinism: same seed, same plan.
    const again = planArc(seed, 40);
    ok(JSON.stringify(plans) === JSON.stringify(again), `seed ${seed}: planArc not deterministic`);
  }

  const aggRatio = totalHostile / Math.max(1, totalGood);
  ok(aggRatio >= 4 && aggRatio <= 6, `aggregate hostile:good ${aggRatio.toFixed(2)} outside ~5:1`);

  if (fails.length > 0) throw new Error(`arc-data self-check FAILED:\n  - ${fails.join('\n  - ')}`);
  return (
    `arc-data self-check OK — 20 seeds x 40 depths\n` +
    `  aggregate hostile:good = ${totalHostile}:${totalGood} (${aggRatio.toFixed(2)}:1)\n` +
    `  acts: ${ARC_TOKENS.map((t) => `${t.name}(${t.bg}/${t.accent})`).join('  ')}\n` +
    `  sanctuary: bg=${SANCTUARY_TOKENS.bg} panel=${SANCTUARY_TOKENS.panel} accent=${SANCTUARY_TOKENS.accent}\n` +
    `  layers 1..7 alphas: ${LAYER_TOKENS.map((l) => l.alpha.toFixed(2)).join(', ')}`
  );
}
