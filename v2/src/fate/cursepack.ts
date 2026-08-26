/**
 * CURSEPACK — wave-2 port of v1's curse breadth (curse-pack.js, mechanic not
 * code) as EXTRA fate modifiers beside src/fate/fate.ts (which is frozen —
 * this module never modifies it, it only imports its weights/types/table).
 *
 * Roll scheme (single ctx draw, mutually-exclusive windows, mirroring v1's
 * ~18% curse / ~25% blessing split):
 *   depth < 3              : always null (rounds 1-2 stay baseline parity)
 *   good                   : r < 0.25 -> GRACE (forgiveNext) | SUNLIT (+10 hp)
 *   bad | chaotic          : r < 0.18 -> one of four curses:
 *                               PESTILENCE  fly-mote cosmetic overlay + timerDelta -5
 *                               HORSEMEN    4 staggered rider banners + hpDelta -20
 *                               MARK        skull chip beside player name until
 *                                           the next blessing clears it
 *                               TOIL        score x0.75 this round
 *   neutral                : always null
 *
 * Ids are prefixed 'cp2:' — guaranteed disjoint from fate.ts's
 * { nuke, midas, eclipse, toll, carnival_box, comet, poltergeist,
 *   lollipop, sticker } namespace (asserted in selfTest).
 *
 * Determinism: own mulberry32 from (seed ^ depth-salt ^ CP_SALT) — a stream
 * distinct from fate.ts's FATE_SALT — or the caller's injected rng (host
 * stream; passing the SAME rng instance as maybeFate chains draws and stays
 * replay-exact). Zero Math.random / Date.now in decisions.
 * Purity: maybeCurse NEVER mutates run state; it returns plain modifier data
 * the engine aggregates. The ONLY side effects live in the explicit
 * meta-visual helpers below (curse-mark chip, localStorage-guarded, node-safe)
 * and are invoked by the CALLER, never by the roll.
 *
 * Fairness rails: PESTILENCE motes and HORSEMEN banners are presentation-only
 * (text/colour data the engine renders; no flashes >3Hz fullscreen); MARK is
 * a visual chip with zero mechanical payload; nothing here recolors or
 * animates question/answer glyphs; engine still clamps hpDelta [-60,60].
 *
 * Integration (Main, once per round start, after/beside maybeFate):
 *   const c = maybeCurse({ depth, align, seed, rng: mulberry((seed ^ Math.imul(depth, 0xCA75E)) >>> 0) });
 *   - c.timerDelta/scoreMul/hpDelta -> aggregate into round modifiers
 *   - c.forgiveNext                 -> next wrong answer scores 0 (one shot)
 *   - c.cosmetic 'fly-motes'        -> 4s mote overlay (IQB_MOTION-gated)
 *   - c.riderBanners                -> render 4 banners staggered (~420ms)
 *   - c.flag.curseMark              -> setCurseMark(); show skull chip by name
 *   - c.flag.clearCurseMark         -> clearCurseMark(); remove chip
 *   - hasCurseMark()                -> whether the chip should currently show
 */

import { mulberry32 } from '../scenes/takeovers/redlight.ts';
import { FATES, W_BLESS, type FateCtx } from './fate.ts';

/** Hostile-round curse window (mirrors v1's 18%). Good rounds use fate.ts's W_BLESS (25%). */
export const W_CURSE = 0.18;

/** Distinct stream salt — deliberately different from fate.ts's FATE_SALT. */
const CP_SALT = 0xc05e2;

/** localStorage key for the curse-mark chip (meta-visual state only). */
const MARK_KEY = 'IQB_CURSE_MARK_V2';

/** Hooks-style round-start modifier. Plain data; engine aggregates. */
export interface CurseMod {
  id: string;
  kind: 'curse' | 'blessing';
  bannerText: string;
  hpDelta?: number;
  /** this round's score multiplier (TOIL x0.75) */
  scoreMul?: number;
  /** seconds removed from this round's timer (PESTILENCE -5) */
  timerDelta?: number;
  /** GRACE: the next wrong answer scores 0 instead of its penalty */
  forgiveNext?: boolean;
  /** presentation-only effect id for the engine renderer (PESTILENCE 'fly-motes') */
  cosmetic?: string;
  /** HORSEMEN: four banner lines the engine renders staggered top-to-bottom */
  riderBanners?: ReadonlyArray<{ text: string; color: string }>;
  /** opaque pass-through flags (curseMark / clearCurseMark) */
  flag?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Curse-mark chip persistence (meta-visual, guarded, node-safe)       */
/* ------------------------------------------------------------------ */

export function hasCurseMark(): boolean {
  try {
    return globalThis.localStorage?.getItem(MARK_KEY) === '1';
  } catch {
    return false;
  }
}

/** Show the skull chip beside the player name (caller invokes on cp2:mark). */
export function setCurseMark(): void {
  try {
    globalThis.localStorage?.setItem(MARK_KEY, '1');
  } catch {
    /* headless / storage-disabled: chip lost, run continues */
  }
}

/** Any cp2 blessing ends a lingering mark ("until next blessing"). */
export function clearCurseMark(): void {
  try {
    globalThis.localStorage?.removeItem(MARK_KEY);
  } catch {
    /* headless / storage-disabled: nothing to clear */
  }
}

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

const HORSEMEN: ReadonlyArray<{ text: string; color: string }> = [
  { text: '☠ WAR RIDES WITH YOU', color: '#d84b4b' },
  { text: '☠ FAMINE COUNTS YOUR COINS', color: '#e0c341' },
  { text: '☠ PESTILENCE BREATHES NEAR', color: '#8db95b' },
  { text: '☠ DEATH TAKES NOTES', color: '#b9b9c9' },
];

type CurseFactory = () => CurseMod;

export const CURSES: readonly CurseFactory[] = [
  () => ({
    id: 'cp2:pestilence', kind: 'curse',
    bannerText: '🪰 PESTILENCE — THE FLIES ARRIVE',
    timerDelta: -5,
    cosmetic: 'fly-motes',
  }),
  () => ({
    id: 'cp2:horsemen', kind: 'curse',
    bannerText: '🐴 THE FOUR HAVE BEEN SUMMONED',
    hpDelta: -20,
    riderBanners: HORSEMEN,
  }),
  () => ({
    id: 'cp2:mark', kind: 'curse',
    bannerText: '💀 MARKED — SOMETHING FOLLOWS YOU',
    flag: { curseMark: true },
  }),
  () => ({
    id: 'cp2:toil', kind: 'curse',
    bannerText: '⛏ TOIL — YOUR LAURELS WEIGH LESS',
    scoreMul: 0.75,
  }),
];

export const BLESSINGS: readonly CurseFactory[] = [
  () => ({
    id: 'cp2:grace', kind: 'blessing',
    bannerText: '🕊 GRACE — ONE WRONG WILL BE FORGIVEN',
    forgiveNext: true,
    flag: { clearCurseMark: true },
  }),
  () => ({
    id: 'cp2:sunlit', kind: 'blessing',
    bannerText: '☀ SUNLIT — WARMTH MENDS THE EDGES',
    hpDelta: 10,
    flag: { clearCurseMark: true },
  }),
];

/* ------------------------------------------------------------------ */
/* Roll                                                                */
/* ------------------------------------------------------------------ */

/**
 * One roll per round start. Returns null when nothing fires.
 * - depth < 3: always null (rounds 1-2 stay baseline parity).
 * - good:      blessing window only (W_BLESS).
 * - bad/chaotic: curse window (W_CURSE). neutral: quiet.
 */
export function maybeCurse(ctx: FateCtx): CurseMod | null {
  if (!(ctx.depth >= 3)) return null;
  const rng = ctx.rng ?? mulberry32((ctx.seed ^ Math.imul(ctx.depth + 1, 2654435761) ^ CP_SALT) >>> 0);

  const r = rng();

  if (ctx.align === 'good') {
    if (r >= W_BLESS) return null;
    return BLESSINGS[Math.floor(rng() * BLESSINGS.length)]();
  }

  if ((ctx.align === 'bad' || ctx.align === 'chaotic') && r < W_CURSE) {
    return CURSES[Math.floor(rng() * CURSES.length)]();
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Self-test                                                           */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  const roll = (seed: number, depth: number, align: FateCtx['align']): CurseMod | null =>
    maybeCurse({ seed, depth, align });

  /* --- determinism --- */
  for (const [d, a] of [[5, 'bad'], [9, 'chaotic'], [4, 'neutral'], [6, 'good']] as const) {
    const x = roll(12345, d, a);
    const y = roll(12345, d, a);
    if (JSON.stringify(x) !== JSON.stringify(y)) failures.push(`nondeterministic align=${a} depth=${d}`);
  }

  /* --- forced-rng window mapping (stubbed stream) --- */
  let call = 0;
  const fixed = (v: number) => () => (call++ === 0 ? v : 0.99); // first draw pinned

  // curse window lower edge
  call = 0;
  let m = maybeCurse({ seed: 1, depth: 3, align: 'bad', rng: fixed(0) });
  if (!m || m.kind !== 'curse') failures.push(`curse window low edge missed: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeCurse({ seed: 1, depth: 3, align: 'chaotic', rng: fixed(W_CURSE - 0.0001) });
  if (!m || m.kind !== 'curse') failures.push(`curse window high-inside missed: ${JSON.stringify(m)}`);
  // exactly at the boundary is OUTSIDE (strict <)
  call = 0;
  m = maybeCurse({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_CURSE) });
  if (m !== null) failures.push(`curse fired AT boundary (must be strict <): ${JSON.stringify(m)}`);
  // past the window -> quiet hostile round
  call = 0;
  m = maybeCurse({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_CURSE + 0.0001) });
  if (m !== null) failures.push(`quiet hostile round fired: ${JSON.stringify(m)}`);

  // blessing window
  call = 0;
  m = maybeCurse({ seed: 1, depth: 3, align: 'good', rng: fixed(W_BLESS - 0.0001) });
  if (!m || m.kind !== 'blessing') failures.push(`blessing window inside missed: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeCurse({ seed: 1, depth: 3, align: 'good', rng: fixed(W_BLESS) });
  if (m !== null) failures.push(`blessing fired AT boundary: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeCurse({ seed: 1, depth: 3, align: 'good', rng: fixed(W_BLESS + 0.01) });
  if (m !== null) failures.push(`blessing fired past window: ${JSON.stringify(m)}`);

  // windows are per-align: an r inside the blessing window on hostile fires NOTHING
  call = 0;
  m = maybeCurse({ seed: 1, depth: 5, align: 'bad', rng: fixed(W_CURSE + 0.01) });
  if (m !== null) failures.push(`hostile round stole blessing-window r: ${JSON.stringify(m)}`);

  // neutral is always quiet; depth<3 is always quiet
  for (const v of [0, 0.1, 0.5, 0.99]) {
    call = 0;
    if (maybeCurse({ seed: 1, depth: 7, align: 'neutral', rng: fixed(v) }) !== null)
      failures.push(`neutral fired at r=${v}`);
    call = 0;
    if (maybeCurse({ seed: 1, depth: 2, align: 'bad', rng: fixed(v) }) !== null)
      failures.push(`event below depth 3 at r=${v}`);
    call = 0;
    if (maybeCurse({ seed: 1, depth: 2, align: 'good', rng: fixed(v) }) !== null)
      failures.push(`blessing below depth 3 at r=${v}`);
  }

  /* --- statistical sweep: 20k seeds per scenario --- */
  const N = 20000;
  let curseHits = 0, blessHits = 0;
  const curseIds = new Map<string, number>();
  const blessIds = new Map<string, number>();
  const payloads = new Map<string, CurseMod>();
  for (let s = 0; s < N; s++) {
    const c = roll(s, 5, 'bad');
    if (c) {
      if (c.kind !== 'curse') failures.push(`expected curse at d5 bad, got ${c.id}`);
      curseHits++;
      curseIds.set(c.id, (curseIds.get(c.id) ?? 0) + 1);
      payloads.set(c.id, c);
    }
    if (roll(s, 5, 'chaotic')?.kind === 'blessing') failures.push('blessing on chaotic');
    if (roll(s, 5, 'neutral') !== null) failures.push(`neutral fired seed=${s}`);
    const b = roll(s, 5, 'good');
    if (b) {
      blessHits++;
      if (b.kind !== 'blessing') failures.push(`expected blessing, got ${b.id}`);
      blessIds.set(b.id, (blessIds.get(b.id) ?? 0) + 1);
      payloads.set(b.id, b);
    }
  }
  const pCurse = curseHits / N, pBless = blessHits / N;
  if (Math.abs(pCurse - W_CURSE) > 0.008) failures.push(`curse rate ${pCurse.toFixed(4)} != 0.18±0.008`);
  if (Math.abs(pBless - W_BLESS) > 0.008) failures.push(`bless rate ${pBless.toFixed(4)} != 0.25±0.008`);
  if (curseIds.size !== CURSES.length) failures.push(`only ${curseIds.size}/${CURSES.length} curses observed`);
  if (blessIds.size !== BLESSINGS.length) failures.push(`only ${blessIds.size}/${BLESSINGS.length} blessings observed`);
  for (const [, n] of curseIds) if (n < N * 0.018) failures.push(`curse starved: ${n}`);
  for (const [, n] of blessIds) if (n < N * 0.05) failures.push(`blessing starved: ${n}`);

  /* --- payloads well-formed (exact v1 mechanics) --- */
  const pest = payloads.get('cp2:pestilence');
  if (pest && (pest.timerDelta !== -5 || pest.cosmetic !== 'fly-motes'))
    failures.push(`pestilence payload wrong: ${JSON.stringify(pest)}`);
  const horse = payloads.get('cp2:horsemen');
  if (horse && (horse.hpDelta !== -20 || !horse.riderBanners || horse.riderBanners.length !== 4))
    failures.push(`horsemen payload wrong: ${JSON.stringify(horse)}`);
  const mark = payloads.get('cp2:mark');
  if (mark && (mark.flag?.curseMark !== true || mark.hpDelta !== undefined || mark.scoreMul !== undefined))
    failures.push(`mark payload wrong (must be purely visual): ${JSON.stringify(mark)}`);
  const toil = payloads.get('cp2:toil');
  if (toil && (toil.scoreMul !== 0.75 || toil.hpDelta !== undefined))
    failures.push(`toil payload wrong: ${JSON.stringify(toil)}`);
  const grace = payloads.get('cp2:grace');
  if (grace && (grace.forgiveNext !== true || grace.flag?.clearCurseMark !== true))
    failures.push(`grace payload wrong: ${JSON.stringify(grace)}`);
  const sunlit = payloads.get('cp2:sunlit');
  if (sunlit && (sunlit.hpDelta !== 10 || sunlit.flag?.clearCurseMark !== true))
    failures.push(`sunlit payload wrong: ${JSON.stringify(sunlit)}`);
  for (const [, p] of payloads) if (!p.bannerText || p.bannerText.length < 8) failures.push(`bad banner ${p.id}`);

  /* --- id collisions with fate.ts --- */
  const fateIds = new Set<string>(FATES.map((f) => f().id).concat(['nuke', 'lollipop', 'sticker']));
  const seenCp2 = new Set<string>();
  for (const factory of [...CURSES, ...BLESSINGS]) {
    const mod = factory();
    if (!mod.id.startsWith('cp2:')) failures.push(`id missing cp2: prefix: ${mod.id}`);
    if (fateIds.has(mod.id)) failures.push(`id collides with fate.ts: ${mod.id}`);
    if (seenCp2.has(mod.id)) failures.push(`duplicate id: ${mod.id}`);
    seenCp2.add(mod.id);
  }

  /* --- curse-mark persistence until cleared (stubbed storage) --- */
  const g = globalThis as { localStorage?: Storage };
  const prevStore = g.localStorage;
  const mem = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  try {
    if (hasCurseMark()) failures.push('mark present before any curse');
    setCurseMark();
    // survives arbitrarily many subsequent rounds (no roll may clear it implicitly)
    for (let s = 0; s < 200; s++) {
      roll(s, 5, 'good');
      roll(s, 5, 'bad');
      if (!hasCurseMark()) {
        failures.push(`mark vanished without explicit clear at seed=${s}`);
        break;
      }
    }
    clearCurseMark();
    if (hasCurseMark()) failures.push('mark survived clearCurseMark()');
    // re-set -> persists again
    setCurseMark();
    if (!hasCurseMark() ) failures.push('mark re-set failed');
    clearCurseMark();
  } finally {
    g.localStorage = prevStore;
  }

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;

/* Node smoke entry: node --experimental-strip-types src/fate/cursepack.ts */
if (typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('/cursepack.ts')) {
  const r = selfTest();
  console.log(r.ok ? '[selftest] CURSEPACK OK' : `[selftest] CURSEPACK FAIL\n  ${r.failures.join('\n  ')}`);
  process.exitCode = r.ok ? 0 : 1;
}
