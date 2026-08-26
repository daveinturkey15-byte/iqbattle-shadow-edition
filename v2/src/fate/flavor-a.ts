/**
 * FLAVOR-A — wave-3 flavor breadth (frozen refs pack-wwe.js / pack-horror.js /
 * pack-brit.js, mechanic not code) as EXTRA fate modifiers beside
 * src/fate/fate.ts (frozen — this module never modifies it).
 *
 * Roll scheme (single ctx draw, mutually-exclusive windows):
 *   depth < 3                        : always null (rounds 1-2 stay baseline)
 *   bad | chaotic : r < 0.06         -> fa:slam-entrance
 *                   r < 0.06 + 0.05  -> fa:tape-curse
 *   neutral       : r < 0.08         -> fa:brit-drizzle
 *   good                             : always null (blessings own good rounds)
 *
 *   SLAM ENTRANCE (WWE-parody) .... hostile rounds open with an entrance
 *      banner for a seeded parody persona from an original roster (zero real
 *      names/likenesses, pack-wwe tone) + a 'rope-shake' cosmetic the engine
 *      renders as a brief ring-rope shake (IQB_MOTION-gated, <=400ms, never
 *      on option buttons or glyphs). Pure theatre — no mechanical payload.
 *   TAPE CURSE (ring-parody; v1 well-tape mechanic compressed to one round)
 *      .... a watch-the-tape countdown overlay runs 5000ms; if the player
 *      answers CORRECTLY while it runs the curse is forgiven, otherwise the
 *      engine applies hpDelta -15 ("you didn't watch the tape"). The mod
 *      carries hpDelta AND flag.tapeForgiveMs; the ENGINE owns the judgement
 *      (this layer never reads answer streams). Mirror of v1's 7-round cycle,
 *      per Dave's wave spec: 5s overlay or hp -15.
 *   BRIT WEATHER .... a drizzle overlay cosmetic + one dry-understatement
 *      banner from a seeded pool ('mind the drizzle' family, pack-brit tone).
 *      Cosmetic only.
 *
 * Ids are prefixed 'fa:' — guaranteed disjoint from fate.ts's
 * { nuke, midas, eclipse, toll, carnival_box, comet, poltergeist, lollipop,
 *   sticker }, cursepack.ts's 'cp2:*' namespace and flavor-b.ts's 'fb:*'
 *   namespace (asserted in selfTest).
 *
 * Determinism: own mulberry32 from (seed ^ depth-salt ^ FA_SALT) — a stream
 * distinct from fate.ts's FATE_SALT and cursepack.ts's CP_SALT — or the
 * caller's injected rng (host stream). Zero Math.random / Date.now in
 * decisions. Purity: maybeFlavorA NEVER mutates run state; it returns plain
 * modifier data the engine aggregates. Zero side effects.
 *
 * Fairness rails: rope-shake/drizzle/tape overlays are presentation-only
 * (text/colour data; no flashes >3Hz fullscreen); TAPE CURSE is the only
 * mechanical payload (-15 hp, engine-judged, telegraphed by banner);
 * nothing here recolors or animates question/answer glyphs; engine still
 * clamps hpDelta [-60,60].
 *
 * Integration (Main, once per round start, beside maybeFate/maybeCurse):
 *   const f = maybeFlavorA({ depth, align, seed });
 *   - f.cosmetic            -> render overlay effect id (motion-gated)
 *   - f.flag.tapeForgiveMs  -> correct answer within that window cancels
 *                             f.hpDelta; expiry applies it
 */

import { mulberry32 } from '../scenes/takeovers/redlight.ts';
import { type FateCtx } from './fate.ts';

/** Hostile-round windows: entrance then tape (mutually exclusive slices). */
export const W_FA_ENTRANCE = 0.06;
export const W_FA_TAPE = 0.05;
/** Neutral-round weather window. */
export const W_FA_WEATHER = 0.08;

/** Distinct stream salt — deliberately unlike FATE_SALT / CP_SALT. */
const FA_SALT = 0xfa1a7;

/** TAPE CURSE overlay length (ms) and its hp penalty. */
export const TAPE_MS = 5000;
export const TAPE_HP = -15;

export interface FlavorMod {
  id: string;
  kind: 'entrance' | 'curse' | 'weather';
  bannerText: string;
  /** presentation-only effect id for the engine renderer */
  cosmetic?: string;
  /** overlay duration in ms (engine clamps to round length) */
  overlayMs?: number;
  hpDelta?: number;
  /** opaque pass-through flags (tapeForgiveMs etc.) */
  flag?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Parody roster (all original gimmicks — zero real names/likenesses)  */
/* ------------------------------------------------------------------ */

interface Persona { name: string; tagline: string }

const ROSTER: readonly Persona[] = [
  { name: 'THE PAPER TITAN', tagline: 'READ A DICTIONARY COVER TO COVER' },
  { name: 'LORD HUSTLEBUCK', tagline: 'SELLS TICKETS TO HIS OWN ENTRANCE' },
  { name: 'THE CRIMSON CHINSTRAP', tagline: 'A JAW OF PURE CONFIDENCE' },
  { name: 'MISS MULTIPLE CHOICE', tagline: '50/50 ODDS, 100% SHOWMANSHIP' },
  { name: 'THE ABACUS BRUISER', tagline: 'CARRIES HIS BEADS EVERYWHERE' },
  { name: 'EL CALCULADOR', tagline: 'NEVER MET A REMAINDER HE LIKED' },
];

/* Dry-understatement weather lines (pack-brit tone, original text). */
const WEATHER_LINES: readonly string[] = [
  'MIND THE DRIZZLE.',
  'BIT DRIZZLY OUT. TYPICAL.',
  'THE WEATHER REMAINS DISAPPOINTING. SO DO THE ODDS.',
  'AN UMBRELLA IS SUGGESTED. KNOWLEDGE IS NOT.',
  'PLEASE FORM AN ORDERLY QUEUE FOR THE RAIN.',
];

/* ------------------------------------------------------------------ */
/* Roll                                                                */
/* ------------------------------------------------------------------ */

/**
 * One roll per round start. Returns null when nothing fires.
 * - depth < 3:    always null (rounds 1-2 stay baseline parity).
 * - bad/chaotic:  entrance slice [0, W_FA_ENTRANCE), tape slice after it.
 * - neutral:      weather window only. good: quiet (blessings own it).
 */
export function maybeFlavorA(ctx: FateCtx): FlavorMod | null {
  if (!(ctx.depth >= 3)) return null;
  const rng =
    ctx.rng ??
    mulberry32((ctx.seed ^ Math.imul(ctx.depth + 1, 2654435761) ^ FA_SALT) >>> 0);

  const r = rng();

  if (ctx.align === 'bad' || ctx.align === 'chaotic') {
    if (r < W_FA_ENTRANCE) {
      const foe = ROSTER[Math.floor(rng() * ROSTER.length) % ROSTER.length];
      return {
        id: 'fa:slam-entrance',
        kind: 'entrance',
        bannerText: `\u2694 ENTRANCE: ${foe.name} — "${foe.tagline}"`,
        cosmetic: 'rope-shake',
        overlayMs: 4200,
        flag: { persona: foe.name },
      };
    }
    if (r < W_FA_ENTRANCE + W_FA_TAPE) {
      return {
        id: 'fa:tape-curse',
        kind: 'curse',
        bannerText: `\uD83D\uDCFC THE UNLABELED TAPE PLAYS — WATCH (${TAPE_MS / 1000}S) OR HP \u221215`,
        cosmetic: 'tape-countdown',
        overlayMs: TAPE_MS,
        hpDelta: TAPE_HP,
        flag: {
          tapeForgiveMs: TAPE_MS,
          tapeForgivenBanner: '\u27B4 YOU WATCHED. THE WELL REMEMBERS.',
          tapePunishedBanner: "\uD83D\uDCFC YOU DIDN'T WATCH THE TAPE \u2014 HP \u221215",
        },
      };
    }
    return null;
  }

  if (ctx.align === 'neutral' && r < W_FA_WEATHER) {
    const line = WEATHER_LINES[Math.floor(rng() * WEATHER_LINES.length) % WEATHER_LINES.length];
    return {
      id: 'fa:brit-drizzle',
      kind: 'weather',
      bannerText: line,
      cosmetic: 'drizzle',
      overlayMs: 8000,
    };
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Self-test                                                           */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  const roll = (seed: number, depth: number, align: FateCtx['align']): FlavorMod | null =>
    maybeFlavorA({ seed, depth, align });

  /* --- determinism --- */
  for (const [d, a] of [[5, 'bad'], [9, 'chaotic'], [4, 'neutral'], [6, 'good']] as const) {
    const x = roll(12345, d, a);
    const y = roll(12345, d, a);
    if (JSON.stringify(x) !== JSON.stringify(y)) failures.push(`nondeterministic align=${a} depth=${d}`);
  }

  /* --- forced-rng window mapping (stubbed stream) --- */
  let call = 0;
  const fixed = (v: number) => () => (call++ === 0 ? v : 0.99); // first draw pinned

  // hostile: entrance slice low edge and high-inside
  call = 0;
  let m = maybeFlavorA({ seed: 1, depth: 3, align: 'bad', rng: fixed(0) });
  if (!m || m.id !== 'fa:slam-entrance') failures.push(`entrance low edge missed: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 4, align: 'chaotic', rng: fixed(W_FA_ENTRANCE - 0.0001) });
  if (!m || m.id !== 'fa:slam-entrance') failures.push(`entrance high-inside missed: ${JSON.stringify(m)}`);
  // exactly at the slice boundary is OUTSIDE (strict <)
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_FA_ENTRANCE) });
  if (!m || m.id !== 'fa:tape-curse') failures.push(`tape slice start wrong: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_FA_ENTRANCE + W_FA_TAPE - 0.0001) });
  if (!m || m.id !== 'fa:tape-curse') failures.push(`tape slice high-inside missed: ${JSON.stringify(m)}`);
  // past both windows -> quiet hostile round
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_FA_ENTRANCE + W_FA_TAPE + 0.0001) });
  if (m !== null) failures.push(`quiet hostile round fired: ${JSON.stringify(m)}`);

  // neutral: weather window
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'neutral', rng: fixed(W_FA_WEATHER - 0.0001) });
  if (!m || m.id !== 'fa:brit-drizzle' || m.kind !== 'weather')
    failures.push(`weather window inside missed: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'neutral', rng: fixed(W_FA_WEATHER) });
  if (m !== null) failures.push(`weather fired AT boundary (must be strict <): ${JSON.stringify(m)}`);
  // weather must NOT fire on good or hostile even inside the window
  for (const a of ['good', 'bad', 'chaotic'] as const) {
    call = 0;
    m = maybeFlavorA({ seed: 1, depth: 6, align: a, rng: fixed(0.01) });
    if (a === 'good' && m !== null) failures.push('weather leaked onto good round');
    if (a !== 'good' && (!m || m.id === 'fa:brit-drizzle')) failures.push(`weather leaked onto ${a}`);
  }

  // neutral is otherwise quiet; depth<3 is always quiet
  for (const v of [0, 0.05, 0.09, 0.5, 0.99]) {
    if (v < W_FA_WEATHER) {
      call = 0;
      if (maybeFlavorA({ seed: 1, depth: 7, align: 'neutral', rng: fixed(v) })?.id !== 'fa:brit-drizzle')
        failures.push(`neutral weather missing at r=${v}`);
    }
    call = 0;
    if (maybeFlavorA({ seed: 1, depth: 2, align: 'bad', rng: fixed(v) }) !== null)
      failures.push(`event below depth 3 at r=${v}`);
    call = 0;
    if (maybeFlavorA({ seed: 1, depth: 2, align: 'good', rng: fixed(v) }) !== null)
      failures.push(`blessing-window leak below depth 3 at r=${v}`);
  }

  /* --- statistical sweep: 20k seeds per scenario --- */
  const N = 20000;
  let entHits = 0, tapeHits = 0, wxHits = 0;
  const entPersonas = new Set<string>();
  const seenIds = new Set<string>();
  const wxLines = new Set<string>();
  for (let s = 0; s < N; s++) {
    const e = roll(s, 5, 'bad');
    if (e) {
      seenIds.add(e.id);
      if (e.kind !== 'entrance' && e.kind !== 'curse') failures.push(`hostile fired non-hostile kind ${e.id}`);
      if (e.kind === 'entrance') { entHits++; entPersonas.add(String(e.flag?.persona)); }
      if (e.kind === 'curse') {
        tapeHits++;
        if (e.hpDelta !== TAPE_HP) failures.push(`tape hp wrong: ${e.hpDelta}`);
        if (e.flag?.tapeForgiveMs !== TAPE_MS) failures.push(`tape window wrong: ${String(e.flag?.tapeForgiveMs)}`);
      }
    }
    const w = roll(s, 5, 'neutral');
    if (w) {
      seenIds.add(w.id);
      if (w.id !== 'fa:brit-drizzle') failures.push(`neutral fired non-weather ${w.id}`);
      else { wxHits++; wxLines.add(w.bannerText); }
    }
    if (roll(s, 5, 'chaotic')?.kind === 'weather') failures.push('weather on chaotic');
    if (roll(s, 5, 'good') !== null) failures.push(`good round fired seed=${s}`);
  }
  const pEnt = entHits / N, pTape = tapeHits / N, pWx = wxHits / N;
  if (Math.abs(pEnt - W_FA_ENTRANCE) > 0.008) failures.push(`entrance rate ${pEnt.toFixed(4)} != 0.06±0.008`);
  if (Math.abs(pTape - W_FA_TAPE) > 0.008) failures.push(`tape rate ${pTape.toFixed(4)} != 0.05±0.008`);
  if (Math.abs(pWx - W_FA_WEATHER) > 0.008) failures.push(`weather rate ${pWx.toFixed(4)} != 0.08±0.008`);
  if (entPersonas.size !== ROSTER.length) failures.push(`only ${entPersonas.size}/${ROSTER.length} personas observed`);
  if (wxLines.size !== WEATHER_LINES.length) failures.push(`only ${wxLines.size}/${WEATHER_LINES.length} weather lines observed`);

  /* --- payload shapes --- */
  call = 0;
  m = maybeFlavorA({ seed: 7, depth: 3, align: 'bad', rng: fixed(0) });
  if (m && (m.cosmetic !== 'rope-shake' || m.hpDelta !== undefined || !m.bannerText.includes(m.flag?.persona as string)))
    failures.push(`entrance payload wrong: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFlavorA({ seed: 7, depth: 3, align: 'neutral', rng: fixed(0) });
  if (m && (m.cosmetic !== 'drizzle' || m.hpDelta !== undefined))
    failures.push(`weather payload wrong (must be purely visual): ${JSON.stringify(m)}`);

  /* --- id collisions with fate.ts / cursepack.ts namespaces --- */
  const foreignIds: Record<string, true> = {
    nuke: true, midas: true, eclipse: true, toll: true, carnival_box: true,
    comet: true, poltergeist: true, lollipop: true, sticker: true,
  };
  const ownIds: Record<string, true> = {
    'fa:slam-entrance': true,
    'fa:tape-curse': true,
    'fa:brit-drizzle': true,
  };
  for (const id of seenIds) {
    if (!ownIds[id]) failures.push(`unexpected id produced: ${id}`);
    if (!id.startsWith('fa:')) failures.push(`id missing fa: prefix: ${id}`);
    if (foreignIds[id]) failures.push(`id collides with fate.ts: ${id}`);
  }
  if (seenIds.size !== Object.keys(ownIds).length) failures.push(`only ${seenIds.size} distinct ids observed`);

  return { ok: failures.length === 0, failures };
}


export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/fate/flavor-a.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/flavor-a.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] FLAVOR-A OK' : `[selftest] FLAVOR-A FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
