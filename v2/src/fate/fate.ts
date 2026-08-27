/**
 * FATE — v2 port of the frozen v1 event layer (curse-pack.js + pack-events.js,
 * mechanic not code). Pure decision layer Main calls once per round start.
 *
 * Roll scheme (single ctx draw, mirroring v1's mutually-exclusive windows so
 * replays stay exact regardless of branch):
 *   good rounds            : r < 1/4            -> LOLLIPOP / STICKER blessing
 *                             (flair chip persisted to localStorage IQB_FLAIR_V2)
 *   hostile/neutral, d >= 3: r < 1/40           -> NUKE (hostile AND depth>=8 only)
 *                             r < 1/40 + 12%    -> one of six fates:
 *                               MIDAS       next correct answer pays x1.5
 *                               ECLIPSE     cosmetic veil over the board
 *                               TOLL        score x0.9 this round
 *                               CARNIVAL    a coin on a correct answer (50%)
 *                               COMET       timer +6s
 *                               POLTERGEIST controls invert for 700ms
 *
 * Determinism: own mulberry32 from ctx.seed ^ depth salt — or the caller's
 * injected rng (host stream). Zero Math.random / Date.now in decisions.
 * Purity: maybeFate NEVER mutates run state; it returns plain Hooks-style
 * modifier data the engine consumes. The only side effect is the blessing
 * flair chip in localStorage (meta-progression, guarded, node-safe).
 *
 * Fairness rails: POLTERGEIST inversion is 700ms and never stacks; ECLIPSE is
 * cosmetic only; nothing here recolors or animates question/answer glyphs;
 * banners are text the engine renders. Nuke forces the NEXT round to good
 * via flag { nuke:true, forcedAlign:'good' } — Main owns the forcing.
 */

import { mulberry32 } from '../scenes/takeovers/redlight.ts';

/* ------------------------------------------------------------------ */
/* Windows                                                             */
/* ------------------------------------------------------------------ */

export const W_NUKE = 1 / 40;
export const W_FATE = 0.12;
export const W_BLESS = 0.25;

const FATE_SALT = 0x0f47e;

export type Align = 'good' | 'bad' | 'chaotic' | 'neutral';

export interface FateCtx {
  depth: number;
  align: Align;
  seed: number;
  /** current hp — enables the exact "everyone to 1" delta on NUKE */
  hp?: number;
  /** host rng stream; omitted -> seeded fallback (deterministic either way) */
  rng?: () => number;
}

/** Hooks-style round-start modifier. Plain data; engine aggregates. */
export interface FateMod {
  id: string;
  kind: 'nuke' | 'fate' | 'blessing';
  bannerText: string;
  hpDelta?: number;
  /** this round's score multiplier (TOLL x0.9) */
  scoreMul?: number;
  /** seconds added to this round's timer (COMET +6) */
  timerDelta?: number;
  /** multiplier applied to the NEXT correct answer (MIDAS x1.5) */
  nextCorrectMul?: number;
  /** chance a coin pickup drops on a correct answer (CARNIVAL BOX 0.5) */
  coinOnCorrectP?: number;
  /** ms of inverted controls (POLTERGEIST 700) */
  invertMs?: number;
  /** presentation-only effect id (ECLIPSE 'veil') */
  cosmetic?: string;
  /** opaque pass-through flags (nuke -> forcedAlign etc.) */
  flag?: Record<string, unknown>;
  /** flair chip granted by blessings */
  chip?: string;
  /**
   * Declarative chaos-bus cue — PURE DATA. The engine (main.ts) performs it
   * via the chaos bus; fate.ts never imports or calls the bus.
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

/* ------------------------------------------------------------------ */
/* Blessing chips (v1 lollipop/sticker flair, persisted)               */
/* ------------------------------------------------------------------ */

const FLAIR_KEY = 'IQB_FLAIR_V2';

function loadFlair(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(FLAIR_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Persist a flair chip. Meta-progression only — never gameplay state. */
export function grantChip(chip: string): void {
  try {
    const list = loadFlair();
    if (!list.includes(chip)) list.push(chip);
    globalThis.localStorage?.setItem(FLAIR_KEY, JSON.stringify(list));
  } catch {
    /* headless / storage-disabled: chip is lost, run continues */
  }
}

export function flairChips(): string[] {
  return loadFlair();
}

/* ------------------------------------------------------------------ */
/* Fate table                                                          */
/* ------------------------------------------------------------------ */

type FateFactory = () => FateMod;

export const FATES: readonly FateFactory[] = [
  () => ({
    id: 'midas', kind: 'fate',
    bannerText: '🪙 MIDAS — YOUR NEXT CORRECT ANSWER TURNS TO GOLD ×1.5',
    nextCorrectMul: 1.5,
    cue: { flash: { color: 0xffd700, ms: 180 } },
  }),
  () => ({
    id: 'eclipse', kind: 'fate',
    bannerText: '🌑 ECLIPSE — A VEIL FALLS OVER THE BOARD (COSMETIC)',
    cosmetic: 'veil',
    cue: { scanlines: true, melt: 0.35 },
  }),
  () => ({
    id: 'toll', kind: 'fate',
    bannerText: '⚰ THE TOLL — SCORE ×0.9 THIS ROUND',
    scoreMul: 0.9,
    cue: { glitch: 250 },
  }),
  () => ({
    id: 'carnival_box', kind: 'fate',
    bannerText: '🎪 CARNIVAL BOX — ANSWER TRUE AND A COIN MAY DROP',
    coinOnCorrectP: 0.5,
    cue: { flash: { color: 0xff66cc, ms: 150 }, embers: 24 },
  }),
  () => ({
    id: 'comet', kind: 'fate',
    bannerText: '☄ COMET — SIX SECONDS RETURNED TO THE CLOCK',
    timerDelta: 6,
    cue: { flash: { color: 0x66ccff, ms: 120 }, embers: 16 },
  }),
  () => ({
    id: 'poltergeist', kind: 'fate',
    bannerText: '👻 POLTERGEIST — YOUR HANDS ARE NOT YOUR OWN (700ms)',
    invertMs: 700,
    cue: { invert: 700, shake: { intensity: 0.5, ms: 700 } },
  }),
];

/* ------------------------------------------------------------------ */
/* Inline roll outcomes, exported as data (gate-visible)               */
/* ------------------------------------------------------------------ */

/**
 * Events produced by maybeFate() outside the FATES table: the two blessing
 * chips and the nuke. Shipped as pure data so selftest-fate.ts validates the
 * SAME objects the game serves — no hand-copied cues. maybeFate() selects
 * from this roster; dynamic fields (hpDelta) are added at roll time.
 * Selection behaviour (rng draws, windows) is unchanged.
 */
export const FATE_INLINE_EVENTS: readonly FateMod[] = [
  {
    id: 'lollipop', kind: 'blessing',
    bannerText: '🍭 LOLLIPOP — A SWEET TOKEN YOURS',
    chip: 'lollipop',
    cue: { flash: { color: 0xff9ecf, ms: 150 } },
  },
  {
    id: 'sticker', kind: 'blessing',
    bannerText: '🌟 STICKER — WEAR IT PROUDLY',
    chip: 'sticker',
    cue: { flash: { color: 0xfff2a8, ms: 150 }, embers: 12 },
  },
  {
    id: 'nuke', kind: 'nuke',
    bannerText: '☢ NUKE — EVERYONE LEFT AT 1 HP · NEXT ROUND FORCED GOOD',
    flag: { nuke: true, forcedAlign: 'good' },
    cue: { flash: { color: 0xff3030, ms: 200 }, shake: { intensity: 1, ms: 600 } },
  },
];

function inlineEvent(id: string): FateMod {
  const e = FATE_INLINE_EVENTS.find((x) => x.id === id);
  if (!e) throw new Error(`fate: unknown inline event ${id}`);
  return e;
}

/* ------------------------------------------------------------------ */
/* Roll                                                                */
/* ------------------------------------------------------------------ */

/**
 * One roll per round start. Returns null when nothing fires.
 * - depth < 3: always null (rounds 1-2 stay baseline parity).
 * - good:      blessing window only.
 * - hostile/neutral: nuke window (hostile & depth>=8) then fate window.
 */
export function maybeFate(ctx: FateCtx): FateMod | null {
  if (!(ctx.depth >= 3)) return null;
  const hostile = ctx.align === 'bad' || ctx.align === 'chaotic';
  const rng = ctx.rng ?? mulberry32((ctx.seed ^ Math.imul(ctx.depth + 1, 2654435761) ^ FATE_SALT) >>> 0);

  const r = rng();

  if (ctx.align === 'good') {
    if (r >= W_BLESS) return null;
    // second draw picks the chip; deterministic per seed+depth
    const chip = rng() < 0.5 ? 'lollipop' : 'sticker';
    grantChip(chip);
    return { ...inlineEvent(chip), chip };
  }

  if (hostile && ctx.depth >= 8 && r < W_NUKE) {
    const hp = typeof ctx.hp === 'number' ? Math.max(1, Math.floor(ctx.hp)) : null;
    return { ...inlineEvent('nuke'), ...(hp !== null ? { hpDelta: 1 - hp } : {}) };
  }

  if (r >= W_NUKE && r < W_NUKE + W_FATE) {
    return FATES[Math.floor(rng() * FATES.length)]();
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Self-test                                                           */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  const roll = (seed: number, depth: number, align: Align, hp?: number): FateMod | null =>
    maybeFate({ seed, depth, align, hp });

  /* --- determinism --- */
  for (const [d, a] of [[5, 'bad'], [9, 'chaotic'], [4, 'neutral'], [6, 'good']] as const) {
    const x = roll(12345, d, a, 50);
    const y = roll(12345, d, a, 50);
    if (JSON.stringify(x) !== JSON.stringify(y)) failures.push(`nondeterministic align=${a} depth=${d}`);
  }

  /* --- forced-rng window mapping (stubbed stream) --- */
  let call = 0;
  const fixed = (v: number) => () => (call++ === 0 ? v : 0.99); // first draw pinned
  // nuke window, eligible
  call = 0;
  let m = maybeFate({ seed: 1, depth: 8, align: 'bad', hp: 42, rng: fixed(W_NUKE / 2) });
  if (!m || m.id !== 'nuke' || m.hpDelta !== -41) failures.push(`nuke exact-delta failed: ${JSON.stringify(m)}`);
  if (!m?.flag || m.flag.forcedAlign !== 'good' || m.flag.nuke !== true) failures.push('nuke missing forcedAlign flag');
  // nuke window, NOT eligible (depth<8) -> falls through to fate? no: r<W_NUKE outside fate window too -> null... but fate window starts at W_NUKE, so r=W_NUKE/2 with depth<8 gives null
  call = 0;
  m = maybeFate({ seed: 1, depth: 7, align: 'bad', rng: fixed(W_NUKE / 2) });
  if (m !== null) failures.push(`nuke fired at depth<8: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFate({ seed: 1, depth: 8, align: 'neutral', rng: fixed(W_NUKE / 2) });
  if (m !== null) failures.push(`nuke fired on neutral: ${JSON.stringify(m)}`);
  // fate window lower edge
  call = 0;
  m = maybeFate({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_NUKE + 0.001) });
  if (!m || m.kind !== 'fate') failures.push(`fate window low edge missed: ${JSON.stringify(m)}`);
  // just below fate window upper edge
  call = 0;
  m = maybeFate({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_NUKE + W_FATE - 0.001) });
  if (!m || m.kind !== 'fate') failures.push(`fate window high edge missed: ${JSON.stringify(m)}`);
  // above both windows
  call = 0;
  m = maybeFate({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_NUKE + W_FATE + 0.001) });
  if (m !== null) failures.push(`quiet round fired: ${JSON.stringify(m)}`);
  // blessing window
  call = 0;
  m = maybeFate({ seed: 1, depth: 3, align: 'good', rng: fixed(0.1) });
  if (!m || m.kind !== 'blessing' || (m.chip !== 'lollipop' && m.chip !== 'sticker')) failures.push(`blessing window missed: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFate({ seed: 1, depth: 3, align: 'good', rng: fixed(W_BLESS + 0.01) });
  if (m !== null) failures.push(`blessing fired past window: ${JSON.stringify(m)}`);

  /* --- statistical sweep: 20k seeds per scenario --- */
  const N = 20000;
  let fateHits = 0, nukeHits = 0, blessHits = 0;
  const fateIds = new Map<string, number>();
  for (let s = 0; s < N; s++) {
    const f = roll(s, 3, 'bad');
    if (f) {
      if (f.kind !== 'fate') failures.push(`expected fate at d3, got ${f.id}`);
      fateHits++;
      fateIds.set(f.id, (fateIds.get(f.id) ?? 0) + 1);
    }
    const nk = roll(s, 8, 'chaotic', 60);
    if (nk?.id === 'nuke') { nukeHits++; if (nk.hpDelta !== -59) failures.push('nuke delta wrong'); }
    else if (nk?.kind === 'fate') { /* fine */ }
    const b = roll(s, 4, 'good');
    if (b) {
      blessHits++;
      if (b.kind !== 'blessing') failures.push(`expected blessing, got ${b.id}`);
    }
    // quiet zones
    if (roll(s, 2, 'bad') !== null) failures.push(`event below depth 3 seed=${s}`);
    if (roll(s, 5, 'neutral')?.kind === 'nuke') failures.push('nuke on neutral');
    if (roll(s, 5, 'good')?.kind !== 'blessing' && roll(s, 5, 'good') !== null) failures.push('non-blessing on good');
  }
  const pFate = fateHits / N, pNuke = nukeHits / N, pBless = blessHits / N;
  if (Math.abs(pFate - W_FATE) > 0.008) failures.push(`fate rate ${pFate.toFixed(4)} != 0.12±0.008`);
  if (Math.abs(pNuke - W_NUKE) > 0.004) failures.push(`nuke rate ${pNuke.toFixed(4)} != 1/40±0.004`);
  if (Math.abs(pBless - W_BLESS) > 0.008) failures.push(`bless rate ${pBless.toFixed(4)} != 0.25±0.008`);
  if (fateIds.size !== FATES.length) failures.push(`only ${fateIds.size}/${FATES.length} fates observed`);
  for (const [, n] of fateIds) if (n < N * 0.012) failures.push(`fate starved: ${n}`);

  /* --- fate payloads well-formed --- */
  for (let i = 0; i < 5000; i++) {
    const f = roll(i, 6, 'bad');
    if (!f || f.kind !== 'fate') continue;
    if (!f.bannerText || f.bannerText.length < 8) failures.push(`bad banner ${f.id}`);
    if (f.invertMs !== undefined && f.invertMs > 700) failures.push('inversion exceeds 700ms rail');
    if (f.cosmetic !== undefined && f.scoreMul !== undefined) failures.push(`${f.id} mixes cosmetic and mechanical`);
  }

  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;
