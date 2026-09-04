/*****
 * Hell traversal — seven layers as state machine, not a skin.
 *
 * Parody descent in the game's dry register: a run of hostile beats works
 * downward 1 -> 7 one layer per depth, and only a good beat can lift it.
 * Good beats exit to heaven (layer 0, not in hell); neutral beats hold.
 * Crossing lines are deterministic per (seed, depth, layer) via an owned
 * mulberry32. Only layers 6-7 allow negative hp.
 *
 * Pure data + traversal. No rendering, no I/O, no timers.
 */
import type { ArcPlan } from '../arc-data.ts';

/** Real arc beat type (alias — do not redefine the contract). */
export type ArcBeat = ArcPlan;

export interface HellState {
  layer: number; // 1..7, or 0 when not in hell
  depthsInLayer: number;
  crossed: boolean; // true on the depth a new layer is entered
  crossingLine: string | null; // uppercase, <= 90 chars, only on a crossing
  allowsNegativeHp: boolean;
  hpFloor: number; // 0 for most layers, negative deep down
}

/** Distinct parody layer names, dry register. Index 0 = layer 1. */
export const LAYER_NAMES: readonly string[] = [
  'THE LOBBY OF SMALL ANNOYANCES',
  'THE OPEN-PLAN OFFICE',
  'THE ENDLESS PARKING GARAGE',
  'THE COMMENT SECTION',
  'THE ALL-HANDS MEETING',
  'THE REPLY-ALL ABYSS',
  'THE BOTTOM OF THE INBOX',
];

/**
 * Crossing line pools. Index 0 = layer 1. Every entry is uppercase and
 * <= 90 chars. Each pool has at least 3 variants.
 */
export const CROSSING_LINES: readonly (readonly string[])[] = [
  [
    'PLEASE TAKE A NUMBER. YOUR NUMBER WILL NOT BE CALLED.',
    'WELCOME. THE EXIT IS BEHIND YOU. IT WAS ALWAYS PAINTED ON.',
    'MIND THE WET FLOOR. IT HAS BEEN WET SINCE 1997.',
    'YOUR WAIT IS IMPORTANT TO US. PLEASE CONTINUE WAITING.',
  ],
  [
    'HOT-DESKING IS FOREVER. SOMEONE IS ALREADY IN YOUR CHAIR.',
    'THE AIR CONDITIONING IS SET TO MILD REGRET.',
    'PLEASE DO NOT ADJUST YOUR HEADSET. IT HEARS YOU.',
    'YOUR DESK HAS BEEN MOVED. YOUR CHAIR HAS BEEN PROMOTED.',
  ],
  [
    'LEVEL B4. YOUR CAR IS ON LEVEL B5. THERE IS NO LEVEL B5.',
    'THE RAMPS ONLY GO DOWN. THE SIGNS ONLY POINT UP.',
    'PARKING VALIDATION FAILED. PLEASE REVERSE ETERNALLY.',
    'YOU LEFT YOUR HEADLIGHTS ON. SO DID EVERYONE. FOREVER.',
  ],
  [
    'EVERYONE HERE IS WRONG. ESPECIALLY YOU. ESPECIALLY NOW.',
    'THIS THREAD HAS 40,000 REPLIES. ALL OF THEM ARE FIRST.',
    'YOU HAVE BEEN QUOTED OUT OF CONTEXT. WELCOME BACK.',
    'THE MODS HAVE BEEN NOTIFIED. THE MODS ARE ALSO LOST.',
  ],
  [
    'THIS MEETING COULD HAVE BEEN AN EMAIL. IT IS NOW FOREVER.',
    'PLEASE HOLD YOUR QUESTIONS UNTIL THE END OF TIME.',
    'SLIDES 4 THROUGH 400 CONCERN SYNERGY. PLEASE SIT DOWN.',
    'ATTENDANCE IS MANDATORY. THE AGENDA IS DECORATIVE.',
  ],
  [
    'YOU REPLIED ALL. EVERYONE SAW. EVERYONE IS STILL HERE.',
    'THE THREAD INCLUDES YOU. IT WILL ALWAYS INCLUDE YOU.',
    'UNSUBSCRIBE FAILED. THE BUTTON WAS DECORATIVE.',
    'YOUR OUT OF OFFICE REPLY HAS BEEN DENIED. PLEASE STAY.',
  ],
  [
    'THE INBOX IS EMPTY EXCEPT FOR THIS ONE. IT IS YOURS.',
    'NO NEW NOTIFICATIONS. ONLY THIS ONE. STILL THIS ONE.',
    'YOU HAVE REACHED THE BOTTOM. THE BOTTOM SCROLLS TOO.',
    'MARK ALL AS READ FAILED. THEY REMEMBER BEING UNREAD.',
  ],
];

/** Readable hp floor curve. Index 0 = layer 1. */
export const HP_FLOORS: readonly number[] = [0, 0, 0, 0, 0, -10, -25];

/* ------------------------------------------------------------------ */
/* Deterministic RNG (owned mulberry32 from seed + depth + layer)      */
/* ------------------------------------------------------------------ */

function mulberry32(state: number): () => number {
  let a = state >>> 0;
  return (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mixSeed(seedU32: number, depthInt: number, layer: number): number {
  let h = (seedU32 >>> 0) ^ Math.imul((depthInt | 0) + 0x9e37, 0x85ebca6b);
  h = (h ^ Math.imul((layer | 0) + 0xc2b2, 0x27d4eb2f)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h ^ (h >>> 7), 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

function pickCrossingLine(seedU32: number, depthInt: number, layer: number): string {
  const pool = CROSSING_LINES[layer - 1] as readonly string[] | undefined;
  if (pool === undefined || pool.length === 0) return 'YOU DESCEND. THE PAPERWORK FOLLOWS.';
  const rng = mulberry32(mixSeed(seedU32, depthInt, layer));
  const idx = Math.floor(rng() * pool.length) % pool.length;
  const line = pool[idx] as string | undefined;
  return typeof line === 'string' ? line : 'YOU DESCEND. THE PAPERWORK FOLLOWS.';
}

function notInHell(): HellState {
  return {
    layer: 0,
    depthsInLayer: 0,
    crossed: false,
    crossingLine: null,
    allowsNegativeHp: false,
    hpFloor: 0,
  };
}

function hpFloorFor(layer: number): number {
  if (layer >= 1 && layer <= HP_FLOORS.length) {
    const v = HP_FLOORS[layer - 1] as number | undefined;
    return typeof v === 'number' ? v : 0;
  }
  return 0;
}

/**
 * Pure deterministic hell traversal.
 *
 * Walk beats 0..depth (clamped into plan). Hostile beats (bad/chaotic)
 * descend exactly one layer per depth (1 -> 2 -> ... -> 7, capped at 7).
 * Neutral holds the current layer. Good lifts out to layer 0. Layer never
 * increases by more than 1 per depth and never skips downward; only a good
 * beat can decrease it.
 */
export function hellState(seed: number, depth: number, plan: readonly ArcBeat[]): HellState {
  const seedU32 = Number.isFinite(seed) ? (Math.floor(seed) >>> 0) : 0;
  if (!Number.isFinite(depth)) return notInHell();
  if (!Array.isArray(plan) || plan.length === 0) return notInHell();
  const depthInt = Math.floor(depth);
  if (depthInt < 0) return notInHell();
  const eff = depthInt >= plan.length ? plan.length - 1 : depthInt;

  let layer = 0;
  let depthsInLayer = 0;
  let beforeFinal = 0;

  for (let i = 0; i <= eff; i++) {
    if (i === eff) beforeFinal = layer;
    const beat = (plan as readonly ArcBeat[])[i] as ArcBeat | undefined;
    const align = beat?.align;
    if (align === 'good') {
      layer = 0;
      depthsInLayer = 0;
    } else if (align === 'neutral') {
      if (layer === 0) {
        depthsInLayer = 0;
      } else {
        depthsInLayer += 1;
      }
    } else if (align === 'bad' || align === 'chaotic') {
      if (layer === 0) {
        layer = 1;
        depthsInLayer = 1;
      } else if (layer < 7) {
        layer += 1;
        depthsInLayer = 1;
      } else {
        layer = 7;
        depthsInLayer += 1;
      }
    } else {
      // Unknown / malformed beat: hold (never throw, never teleport).
      if (layer !== 0) depthsInLayer += 1;
    }
  }

  const crossed = layer !== beforeFinal;
  const crossingLine: string | null =
    crossed && layer >= 1 && layer <= 7 ? pickCrossingLine(seedU32, eff, layer) : null;
  const allowsNegativeHp = layer === 6 || layer === 7;
  const hpFloor = hpFloorFor(layer);

  return {
    layer,
    depthsInLayer,
    crossed,
    crossingLine,
    allowsNegativeHp,
    hpFloor,
  };
}

/* ------------------------------------------------------------------ */
/* Self-check (pure): import { selfTest } from './hell.ts'             */
/* ------------------------------------------------------------------ */

function mkBeat(align: 'bad' | 'chaotic' | 'neutral' | 'good'): ArcBeat {
  return {
    align,
    act: 0,
    sanctuary: align === 'good',
    layer: 1,
  } as ArcBeat;
}

function sameState(a: HellState, b: HellState): boolean {
  return (
    a.layer === b.layer &&
    a.depthsInLayer === b.depthsInLayer &&
    a.crossed === b.crossed &&
    a.crossingLine === b.crossingLine &&
    a.allowsNegativeHp === b.allowsNegativeHp &&
    a.hpFloor === b.hpFloor
  );
}

export function selfTest(): string {
  const fails: string[] = [];
  const ok = (cond: boolean, msg: string): void => {
    if (!cond) fails.push(msg);
  };

  // Pools: 7 distinct names, >=3 variants each, uppercase, <= 90 chars.
  ok(LAYER_NAMES.length === 7, 'LAYER_NAMES must have 7 entries');
  ok(new Set(LAYER_NAMES).size === 7, 'LAYER_NAMES must be distinct');
  LAYER_NAMES.forEach((n, i) => {
    ok(typeof n === 'string' && n.length > 0, `LAYER_NAMES[${i}] missing`);
    ok(n === n.toUpperCase(), `LAYER_NAMES[${i}] must be uppercase`);
  });
  ok(CROSSING_LINES.length === 7, 'CROSSING_LINES must have 7 pools');
  CROSSING_LINES.forEach((pool, i) => {
    ok(pool.length >= 3, `CROSSING_LINES[${i}] needs >= 3 variants`);
    pool.forEach((line, j) => {
      ok(typeof line === 'string' && line.length > 0, `line L${i + 1}[${j}] missing`);
      ok(line.length <= 90, `line L${i + 1}[${j}] len ${line.length} > 90`);
      ok(line === line.toUpperCase(), `line L${i + 1}[${j}] must be uppercase`);
    });
  });

  // Floor curve: readable, negative only at 6-7.
  ok(HP_FLOORS.length === 7, 'HP_FLOORS must have 7 entries');
  HP_FLOORS.forEach((f, i) => {
    const layer = i + 1;
    if (layer <= 5) ok(f === 0, `hpFloor L${layer} must be 0, got ${f}`);
    if (layer === 6) ok(f === -10, `hpFloor L6 must be -10, got ${f}`);
    if (layer === 7) ok(f === -25, `hpFloor L7 must be -25, got ${f}`);
  });
  ok((HP_FLOORS[6] as number) < (HP_FLOORS[5] as number), 'hpFloor must deepen 6 -> 7');

  // Determinism: same inputs, same outputs (states + lines).
  const mixedPlan: readonly ArcBeat[] = [
    mkBeat('bad'),
    mkBeat('bad'),
    mkBeat('chaotic'),
    mkBeat('neutral'),
    mkBeat('bad'),
    mkBeat('good'),
    mkBeat('bad'),
    mkBeat('bad'),
    mkBeat('bad'),
    mkBeat('bad'),
    mkBeat('bad'),
    mkBeat('bad'),
    mkBeat('bad'),
    mkBeat('good'),
  ];
  for (const seed of [0, 1, 7, 42, 12345, 4294967295]) {
    for (let d = 0; d < mixedPlan.length; d++) {
      const a = hellState(seed, d, mixedPlan);
      const b = hellState(seed, d, mixedPlan);
      ok(sameState(a, b), `determinism failed seed=${seed} d=${d}`);
      if (a.crossingLine !== null) {
        const c = hellState(seed, d, mixedPlan);
        ok(c.crossingLine === a.crossingLine, `line determinism failed seed=${seed} d=${d}`);
      }
    }
  }
  // Distinct seeds still valid (no throw); lines drawn from pool.
  {
    const seen = new Set<string>();
    for (let s = 0; s < 30; s++) {
      const st = hellState(s, 2, [mkBeat('bad'), mkBeat('bad'), mkBeat('bad')]);
      if (st.crossingLine !== null) seen.add(st.crossingLine);
    }
    ok(seen.size >= 1, 'expected at least one crossing line variant');
  }

  // Canonical all-bad run: 1..7 monotonic, no skips, then caps at 7.
  {
    const plan: ArcBeat[] = [];
    for (let i = 0; i < 10; i++) plan.push(mkBeat('bad'));
    const seq: number[] = [];
    for (let d = 0; d < plan.length; d++) seq.push(hellState(99, d, plan).layer);
    const expected = [1, 2, 3, 4, 5, 6, 7, 7, 7, 7];
    ok(JSON.stringify(seq) === JSON.stringify(expected), `all-bad run expected ${expected}, got ${seq}`);
  }

  // All-good run: never in hell.
  {
    const plan: ArcBeat[] = [];
    for (let i = 0; i < 6; i++) plan.push(mkBeat('good'));
    for (let d = 0; d < plan.length; d++) {
      const st = hellState(5, d, plan);
      ok(st.layer === 0, `all-good d=${d} layer must be 0`);
      ok(st.depthsInLayer === 0, `all-good d=${d} depthsInLayer must be 0`);
      ok(st.allowsNegativeHp === false && st.hpFloor === 0, `all-good d=${d} hp must be 0/false`);
    }
  }

  // Good lifts: deep then good exits to 0.
  {
    const plan: ArcBeat[] = [
      mkBeat('bad'),
      mkBeat('bad'),
      mkBeat('bad'),
      mkBeat('bad'),
      mkBeat('good'),
      mkBeat('bad'),
    ];
    const deep = hellState(3, 3, plan);
    ok(deep.layer === 4, `pre-good layer expected 4, got ${deep.layer}`);
    const out = hellState(3, 4, plan);
    ok(out.layer === 0, 'good must lift to layer 0');
    ok(out.crossed === true, 'exit to heaven must mark crossed (change)');
    ok(out.crossingLine === null, 'exit to heaven carries no hell crossing line');
    const re = hellState(3, 5, plan);
    ok(re.layer === 1, `re-entry after good must restart at 1, got ${re.layer}`);
    ok(re.crossed === true && re.crossingLine !== null, 're-entry must cross with a line');
  }

  // Walk invariants over several shapes x seeds (monotonicity, crossed, floors, lines).
  const shapes: Array<{ name: string; plan: ArcBeat[] }> = [
    {
      name: 'blocks-5-1',
      plan: (() => {
        const p: ArcBeat[] = [];
        for (let b = 0; b < 8; b++) {
          for (let i = 0; i < 5; i++) p.push(mkBeat(i === 2 ? 'chaotic' : 'bad'));
          p.push(mkBeat('good'));
        }
        return p;
      })(),
    },
    { name: 'all-bad-20', plan: Array.from({ length: 20 }, () => mkBeat('bad')) },
    { name: 'all-chaotic-20', plan: Array.from({ length: 20 }, () => mkBeat('chaotic')) },
    {
      name: 'limbo-hold',
      plan: [
        mkBeat('bad'),
        mkBeat('bad'),
        mkBeat('neutral'),
        mkBeat('neutral'),
        mkBeat('bad'),
        mkBeat('bad'),
        mkBeat('good'),
        mkBeat('neutral'),
        mkBeat('good'),
      ],
    },
    {
      name: 'alternating',
      plan: Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? mkBeat('bad') : mkBeat('good'))),
    },
  ];
  for (const shape of shapes) {
    for (const seed of [1, 2, 3]) {
      let prev: HellState | null = null;
      for (let d = 0; d < shape.plan.length; d++) {
        const cur = hellState(seed, d, shape.plan);
        ok(Number.isInteger(cur.layer) && cur.layer >= 0 && cur.layer <= 7, `${shape.name} s=${seed} d=${d} layer range`);
        ok(Number.isInteger(cur.depthsInLayer) && cur.depthsInLayer >= 0, `${shape.name} s=${seed} d=${d} depths range`);
        ok(cur.hpFloor === hpFloorFor(cur.layer), `${shape.name} s=${seed} d=${d} floor curve`);
        ok(cur.allowsNegativeHp === (cur.layer === 6 || cur.layer === 7), `${shape.name} s=${seed} d=${d} negative only 6-7`);
        if (cur.layer <= 5) ok(cur.hpFloor === 0 && cur.allowsNegativeHp === false, `${shape.name} s=${seed} d=${d} shallow must be 0/false`);
        if (cur.crossingLine !== null) {
          ok(cur.crossed === true, `${shape.name} s=${seed} d=${d} line requires crossed`);
          ok(cur.layer >= 1 && cur.layer <= 7, `${shape.name} s=${seed} d=${d} line requires hell layer`);
          ok(cur.crossingLine.length <= 90, `${shape.name} s=${seed} d=${d} line > 90`);
          ok(cur.crossingLine === cur.crossingLine.toUpperCase(), `${shape.name} s=${seed} d=${d} line uppercase`);
        } else {
          if (prev !== null && cur.layer !== prev.layer && cur.layer >= 1) {
            ok(false, `${shape.name} s=${seed} d=${d} entered L${cur.layer} without a line`);
          }
        }
        if (prev === null) {
          ok(cur.crossed === (cur.layer !== 0), `${shape.name} s=${seed} d=${d} crossed@0 must equal entered-hell`);
        } else {
          ok(cur.crossed === (cur.layer !== prev.layer), `${shape.name} s=${seed} d=${d} crossed exactly on change`);
          const delta = cur.layer - prev.layer;
          ok(delta <= 1, `${shape.name} s=${seed} d=${d} rose by ${delta} (>1, skipped)`);
          if (delta > 0) ok(delta === 1, `${shape.name} s=${seed} d=${d} skipped layer (+${delta})`);
          if (delta < 0) {
            ok(shape.plan[d]?.align === 'good', `${shape.name} s=${seed} d=${d} only good can lift`);
          }
          if (shape.plan[d]?.align === 'good') {
            ok(cur.layer <= prev.layer, `${shape.name} s=${seed} d=${d} good must not deepen`);
            ok(cur.layer === 0, `${shape.name} s=${seed} d=${d} good must exit to 0`);
          }
          // depthsInLayer continuity.
          if (cur.layer === 0) {
            ok(cur.depthsInLayer === 0, `${shape.name} s=${seed} d=${d} depths 0 outside hell`);
          } else if (cur.layer === prev.layer) {
            ok(cur.depthsInLayer === prev.depthsInLayer + 1, `${shape.name} s=${seed} d=${d} depths must increment on hold`);
          } else {
            ok(cur.depthsInLayer === 1, `${shape.name} s=${seed} d=${d} depths must be 1 on fresh layer`);
          }
        }
        prev = cur;
      }
    }
  }

  // 200-depth walk never throws (mixed hostile + relief + limbo).
  try {
    const long: ArcBeat[] = [];
    for (let i = 0; i < 200; i++) {
      const m = i % 7;
      if (m === 6) long.push(mkBeat('good'));
      else if (m === 5) long.push(mkBeat('neutral'));
      else long.push(mkBeat(m === 3 ? 'chaotic' : 'bad'));
    }
    for (let d = 0; d < 200; d++) {
      const st = hellState(20260704, d, long);
      ok(st.layer >= 0 && st.layer <= 7, `long walk d=${d} range`);
      if (st.crossingLine !== null) {
        ok(st.crossingLine.length <= 90, `long walk d=${d} line > 90`);
        ok(st.crossingLine === st.crossingLine.toUpperCase(), `long walk d=${d} line uppercase`);
      }
    }
    // Out-of-range / empty inputs never throw.
    hellState(1, -1, long);
    hellState(1, 9999, long);
    hellState(1, 0, []);
    hellState(Number.NaN, 0, long);
  } catch (e) {
    ok(false, `200-depth walk threw: ${(e as Error).message}`);
  }

  if (fails.length > 0) throw new Error(`hell self-check FAILED:\n  - ${fails.join('\n  - ')}`);
  return (
    `hell self-check OK — 7 layers x crossing pools, 200-depth walk clean\n` +
    `  layers: ${LAYER_NAMES.map((n, i) => `${i + 1}:${n}`).join(' / ')}\n` +
    `  floors: ${HP_FLOORS.map((f, i) => `L${i + 1}:${f}`).join(' ')}\n` +
    `  monotonic: +1 max per depth, lift only via good, crossed exactly on change`
  );
}

/* ------------------------------------------------------------------ */
/* Node smoke entry: exits 1 on failure when run directly.             */
/* ------------------------------------------------------------------ */

function isHellMainEntry(): boolean {
  try {
    const g = globalThis as unknown as { process?: { argv?: string[] } };
    const argv = g.process?.argv;
    if (argv === undefined || argv.length === 0) return false;
    const last = argv[argv.length - 1] as string | undefined;
    if (typeof last !== 'string') return false;
    return last.endsWith('hell.ts') || last.endsWith('hell.js');
  } catch {
    return false;
  }
}

if (isHellMainEntry()) {
  try {
    const out = selfTest();
    const g = globalThis as unknown as {
      console?: { log(x: string): void; error(x: string): void };
    };
    g.console?.log(out);
  } catch (err) {
    const g = globalThis as unknown as {
      console?: { log(x: string): void; error(x: string): void };
      process?: { exit(code: number): void };
    };
    g.console?.error((err as Error).message);
    g.process?.exit(1);
    throw err;
  }
}
