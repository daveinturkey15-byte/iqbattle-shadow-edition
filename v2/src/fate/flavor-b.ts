/**
 * FLAVOR-B — wave-3 country micro-events (frozen ref pack-countries.js,
 * mechanic not code) as EXTRA fate modifiers beside src/fate/fate.ts (frozen
 * — this module never modifies it, it only imports its ctx type).
 *
 * Roll scheme (single ctx draw; micro-events are rare seasoning on any round):
 *   depth < 3        : always null (rounds 1-2 stay baseline parity)
 *   any align        : r < 0.14 -> one of six seeded country micro-events:
 *
 *   fb:usa-fireworks .... FIREWORKS: correct answers during an active streak
 *                         get a cosmetic firework burst + a visual streak
 *                         chip (+streak visual bonus — zero score payload).
 *   fb:germany-punctual . PÜNKTLICHKEIT: answer correctly within the first
 *                         10s of the round -> NEXT round's timer +2s
 *                         (engine applies on the following round start).
 *   fb:japan-precision .. PRECISION: this round's first-pick correct answer
 *                         pays x1.1 (nextCorrectMul with requirePerfect flag;
 *                         a wrong pick wastes nothing but forfeits the bonus).
 *   fb:brazil-carnival .. CARNIVAL: controls invert for 400ms (under the
 *                         fairness rail's 700ms cap, never stacks with other
 *                         invert sources) + cosmetic confetti.
 *   fb:uk-drizzle ....... DRIZZLE: purely cosmetic drizzle overlay.
 *   fb:egypt-sandhaze ... SAND-HAZE: purely cosmetic veil over the board.
 *
 * Ids are prefixed 'fb:' — guaranteed disjoint from fate.ts's
 * { nuke, midas, eclipse, toll, carnival_box, comet, poltergeist, lollipop,
 *   sticker }, cursepack.ts's 'cp2:*' and flavor-a.ts's 'fa:*' namespaces
 *   (asserted in selfTest).
 *
 * Determinism: own mulberry32 from (seed ^ depth-salt ^ FB_SALT) — a stream
 * distinct from FATE_SALT / CP_SALT / FA_SALT — or the caller's injected rng
 * (host stream). Zero Math.random / Date.now in decisions. Purity:
 * maybeFlavorB NEVER mutates run state; plain modifier data only; zero side
 * effects.
 *
 * Fairness rails: fireworks/drizzle/sand-haze/confetti are presentation-only
 * (no flashes >3Hz fullscreen); germany/japan payloads are small positive
 * nudges telegraphed by banner; brazil inversion is 400ms and never stacks;
 * nothing here recolors or animates question/answer glyphs.
 */

import { mulberry32 } from '../scenes/takeovers/redlight.ts';
import { type FateCtx } from './fate.ts';

/** Micro-event window (any align). */
export const W_FB_MICRO = 0.14;

/** Distinct stream salt — deliberately unlike FATE/CP/FA salts. */
const FB_SALT = 0xfb2b3;

/** Germany punctuality parameters. */
export const PUNCTUAL_WINDOW_MS = 10000;
export const PUNCTUAL_BONUS_S = 2;

export interface CountryMod {
  id: string;
  kind: 'micro';
  bannerText: string;
  /** presentation-only effect id for the engine renderer */
  cosmetic?: string;
  /** ms of inverted controls (brazil 400) */
  invertMs?: number;
  /** multiplier applied to this round's first-pick correct answer (japan x1.1) */
  nextCorrectMul?: number;
  /** opaque pass-through flags (punctualTimerBonus / streakVisual etc.) */
  flag?: Record<string, unknown>;
  /**
   * Declarative chaos-bus cue — PURE DATA. The engine (main.ts) performs it
   * via the chaos bus; this module never imports or calls the bus.
   * Limits: flash.ms <= 200, shake.intensity <= 1, embers <= 64, melt 0..1.
   */
  cue?: {
    shake?: { intensity: number; ms: number };
    glitch?: number;          // ms
    flash?: { color: number; ms: number };
    embers?: number;
    scanlines?: boolean;
    melt?: number;            // 0..1
    invert?: number;          // ms
  };
}

type CountryFactory = () => CountryMod;

/* ------------------------------------------------------------------ */
/* Country table                                                       */
/* ------------------------------------------------------------------ */

export const COUNTRIES: readonly CountryFactory[] = [
  () => ({
    id: 'fb:usa-fireworks',
    kind: 'micro',
    bannerText: '\uD83C\uDF86 FIREWORKS — EVERY STREAK ANSWER GETS A SKY BURST (VISUAL BONUS)',
    cosmetic: 'fireworks',
    flag: { streakVisual: true },
    cue: { flash: { color: 0xff5577, ms: 120 }, embers: 32 },
  }),
  () => ({
    id: 'fb:germany-punctual',
    kind: 'micro',
    bannerText: `\u23F1 PÜNKTLICHKEIT — ANSWER WITHIN ${PUNCTUAL_WINDOW_MS / 1000}S AND NEXT ROUND GAINS +${PUNCTUAL_BONUS_S}S`,
    flag: { punctualTimerBonusS: PUNCTUAL_BONUS_S, punctualWindowMs: PUNCTUAL_WINDOW_MS },
    cue: { flash: { color: 0x66aaff, ms: 100 } },
  }),
  () => ({
    id: 'fb:japan-precision',
    kind: 'micro',
    bannerText: '\u2713 PRECISION — A FIRST-PICK CORRECT ANSWER PAYS ×1.1 THIS ROUND',
    nextCorrectMul: 1.1,
    flag: { requirePerfect: true },
    cue: { flash: { color: 0xffffff, ms: 100 } },
  }),
  () => ({
    id: 'fb:brazil-carnival',
    kind: 'micro',
    bannerText: '\uD83C\uDF89 CARNIVAL — YOUR HANDS SAMBA WITHOUT YOU (400ms)',
    cosmetic: 'carnival-confetti',
    invertMs: 400,
    cue: { invert: 400, shake: { intensity: 0.4, ms: 400 }, embers: 20 },
  }),
  () => ({
    id: 'fb:uk-drizzle',
    kind: 'micro',
    bannerText: '\uD83C\uDF27 MIND THE DRIZZLE. (PURELY COSMETIC)',
    cosmetic: 'drizzle',
    cue: { scanlines: true },
  }),
  () => ({
    id: 'fb:egypt-sandhaze',
    kind: 'micro',
    bannerText: '\uD83C\uDFDC SAND-HAZE VEILS THE BOARD (COSMETIC)',
    cosmetic: 'sand-haze',
    cue: { melt: 0.3, embers: 10 },
  }),
  () => ({
    id: 'fb:france-bagel',
    kind: 'micro',
    bannerText: '\uD83C\uDF60 BAGEL BREAK — A CROISSANT LANDS ON THE BOARD (COSMETIC)',
    cosmetic: 'croissant',
    cue: { embers: 8 },
  }),
  () => ({
    id: 'fb:italy-pasta',
    kind: 'micro',
    bannerText: '\uD83D\uDC37 PASTA TANGLE — CONTROLS SLIP FOR 300ms',
    cosmetic: 'pasta-tangle',
    invertMs: 300,
    cue: { invert: 300, shake: { intensity: 0.3, ms: 300 } },
  }),
  () => ({
    id: 'fb:canada-maps',
    kind: 'micro',
    bannerText: '\uD83C\uDF41 MAPS — THE BOARD IS NOW A PARK (COSMETIC)',
    cosmetic: 'park-maps',
    cue: { scanlines: true },
  }),
  () => ({
    id: 'fb:australia-sun',
    kind: 'micro',
    bannerText: '\u2600\uFE0F SUNBURN — THE BOARD GLOWS (COSMETIC)',
    cosmetic: 'sunburn',
    cue: { flash: { color: 0xffcc44, ms: 150 } },
  }),
  () => ({
    id: 'fb:sweden-fika',
    kind: 'micro',
    bannerText: '\u2615 FIKA — A COFFEE BREAK (NEXT ROUND +1s)',
    flag: { punctualTimerBonusS: 1, punctualWindowMs: 10000 },
    cue: { flash: { color: 0x886644, ms: 100 } },
  }),
  () => ({
    id: 'fb:greece-marble',
    kind: 'micro',
    bannerText: '\uD83D\uDD49 MARBLE — THE BOARD IS NOW A TEMPLE (COSMETIC)',
    cosmetic: 'marble-temple',
    cue: { flash: { color: 0xeeeeee, ms: 120 } },
  }),
  () => ({
    id: 'fb:argentina-tango',
    kind: 'micro',
    bannerText: '\uD83D\uDC68\u200D\uD83D\uDC68 TANGO — CONTROLS SWAY FOR 350ms',
    cosmetic: 'tango-sway',
    invertMs: 350,
    cue: { invert: 350, shake: { intensity: 0.35, ms: 350 } },
  }),
];

/* ------------------------------------------------------------------ */
/* Roll                                                                */
/* ------------------------------------------------------------------ */

/**
 * One roll per round start. Returns null when nothing fires.
 * - depth < 3: always null. Otherwise r < W_FB_MICRO picks one of six
 *   countries uniformly via the second draw of the same stream.
 */
export function maybeFlavorB(ctx: FateCtx): CountryMod | null {
  if (!(ctx.depth >= 3)) return null;
  const rng =
    ctx.rng ??
    mulberry32((ctx.seed ^ Math.imul(ctx.depth + 1, 2654435761) ^ FB_SALT) >>> 0);

  const r = rng();
  if (r >= W_FB_MICRO) return null;
  return COUNTRIES[Math.floor(rng() * COUNTRIES.length) % COUNTRIES.length]();
}

/* ------------------------------------------------------------------ */
/* Self-test                                                           */
/* ------------------------------------------------------------------ */

/** Static string-keyed namespaces we must never collide with. */
const FLAVOR_A_IDS: Record<string, true> = {
  'fa:slam-entrance': true,
  'fa:tape-curse': true,
  'fa:brit-drizzle': true,
};

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  const roll = (seed: number, depth: number, align: FateCtx['align']): CountryMod | null =>
    maybeFlavorB({ seed, depth, align });

  /* --- determinism --- */
  for (const [d, a] of [[5, 'bad'], [9, 'chaotic'], [4, 'neutral'], [6, 'good']] as const) {
    const x = roll(12345, d, a);
    const y = roll(12345, d, a);
    if (JSON.stringify(x) !== JSON.stringify(y)) failures.push(`nondeterministic align=${a} depth=${d}`);
  }

  /* --- forced-rng window mapping (stubbed stream) --- */
  let call = 0;
  const fixed = (v: number) => () => (call++ === 0 ? v : 0.99); // first draw pinned

  // window edges
  call = 0;
  let m = maybeFlavorB({ seed: 1, depth: 3, align: 'neutral', rng: fixed(0) });
  if (!m || m.kind !== 'micro') failures.push(`micro low edge missed: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFlavorB({ seed: 1, depth: 4, align: 'bad', rng: fixed(W_FB_MICRO - 0.0001) });
  if (!m || m.kind !== 'micro') failures.push(`micro high-inside missed: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFlavorB({ seed: 1, depth: 3, align: 'good', rng: fixed(W_FB_MICRO) });
  if (m !== null) failures.push(`micro fired AT boundary (must be strict <): ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFlavorB({ seed: 1, depth: 3, align: 'chaotic', rng: fixed(W_FB_MICRO + 0.0001) });
  if (m !== null) failures.push(`quiet round fired past window: ${JSON.stringify(m)}`);

  // depth<3 is always quiet
  for (const v of [0, 0.05, 0.13, 0.5, 0.99]) {
    call = 0;
    if (maybeFlavorB({ seed: 1, depth: 2, align: 'neutral', rng: fixed(v) }) !== null)
      failures.push(`event below depth 3 at r=${v}`);
  }

  /* --- statistical sweep: 20k seeds per scenario --- */
  const N = 20000;
  let hits = 0;
  const ids = new Map<string, number>();
  const payloads = new Map<string, CountryMod>();
  for (let s = 0; s < N; s++) {
    const c = roll(s, 5, 'neutral');
    if (!c) continue;
    hits++;
    ids.set(c.id, (ids.get(c.id) ?? 0) + 1);
    payloads.set(c.id, c);
  }
  // same seed must give the SAME event regardless of align (align-blind table)
  for (let s = 0; s < 500; s++) {
    const a = roll(s, 5, 'bad');
    const b = roll(s, 5, 'good');
    if ((a?.id ?? null) !== (b?.id ?? null)) failures.push(`align leaked into table choice at seed=${s}`);
  }
  const p = hits / N;
  if (Math.abs(p - W_FB_MICRO) > 0.008) failures.push(`micro rate ${p.toFixed(4)} != 0.14±0.008`);
  if (ids.size !== COUNTRIES.length) failures.push(`only ${ids.size}/${COUNTRIES.length} countries observed`);
  for (const [, n] of ids) if (n < N * 0.01) failures.push(`country starved: ${n}`);

  /* --- payload shapes (exact spec mechanics) --- */
  const usa = payloads.get('fb:usa-fireworks');
  if (usa && (usa.cosmetic !== 'fireworks' || usa.flag?.streakVisual !== true ||
    usa.nextCorrectMul !== undefined || usa.invertMs !== undefined))
    failures.push(`usa payload wrong (visual bonus only): ${JSON.stringify(usa)}`);
  const ger = payloads.get('fb:germany-punctual');
  if (ger && (ger.flag?.punctualTimerBonusS !== 2 || ger.flag?.punctualWindowMs !== 10000))
    failures.push(`germany payload wrong: ${JSON.stringify(ger)}`);
  const jap = payloads.get('fb:japan-precision');
  if (jap && (jap.nextCorrectMul !== 1.1 || jap.flag?.requirePerfect !== true))
    failures.push(`japan payload wrong: ${JSON.stringify(jap)}`);
  const bra = payloads.get('fb:brazil-carnival');
  if (bra && (bra.invertMs !== 400 || bra.invertMs > 700))
    failures.push(`brazil payload wrong (must be <=700ms rail): ${JSON.stringify(bra)}`);
  const uk = payloads.get('fb:uk-drizzle');
  if (uk && (uk.cosmetic !== 'drizzle' || uk.invertMs !== undefined || uk.nextCorrectMul !== undefined))
    failures.push(`uk payload wrong (must be purely visual): ${JSON.stringify(uk)}`);
  const egy = payloads.get('fb:egypt-sandhaze');
  if (egy && (egy.cosmetic !== 'sand-haze' || egy.invertMs !== undefined || egy.nextCorrectMul !== undefined))
    failures.push(`egypt payload wrong (must be purely visual): ${JSON.stringify(egy)}`);
  for (const [, c] of payloads) if (!c.bannerText || c.bannerText.length < 8) failures.push(`bad banner ${c.id}`);

  /* --- id collisions with fate.ts / cursepack.ts / flavor-a.ts namespaces --- */
  const foreignIds: Record<string, true> = {
    nuke: true, midas: true, eclipse: true, toll: true, carnival_box: true,
    comet: true, poltergeist: true, lollipop: true, sticker: true,
  };
  const seen = new Set<string>();
  for (const factory of COUNTRIES) {
    const mod = factory();
    if (!mod.id.startsWith('fb:')) failures.push(`id missing fb: prefix: ${mod.id}`);
    if (foreignIds[mod.id]) failures.push(`id collides with fate.ts: ${mod.id}`);
    if (seen.has(mod.id)) failures.push(`duplicate id: ${mod.id}`);
    seen.add(mod.id);
  }

  /* --- cross-module disjointness vs flavor-a's fa:* namespace --- */
  for (const id of seen) {
    if (FLAVOR_A_IDS[id]) failures.push(`id collides with flavor-a.ts: ${id}`);
  }

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/fate/flavor-b.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/flavor-b.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] FLAVOR-B OK' : `[selftest] FLAVOR-B FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
