/**
 * FLAVOR-A — wave-3 flavor breadth (frozen refs pack-wwe.js / pack-horror.js /
 * pack-brit.js, mechanic not code) as EXTRA fate modifiers beside
 * src/fate/fate.ts (frozen — this module never modifies it).
 *
 * Roll scheme (single ctx draw, mutually-exclusive windows):
 *   depth < 3                        : always null (rounds 1-2 stay baseline)
 *   bad | chaotic :
 *     r < 0.06                       -> fa:slam-entrance
 *     r < 0.11                       -> fa:tape-curse
 *     r < 0.13                       -> fa:taunt
 *     r < 0.15                       -> fa:reversal
 *     r < 0.17                       -> fa:sanctuary
 *     r < 0.19                       -> fa:glitch-curse
 *     r < 0.21                       -> fa:pyro-entrance
 *     r < 0.23                       -> fa:static-curse
 *     r < 0.25                       -> fa:echo
 *     r < 0.27                       -> fa:slam-drop
 *     r < 0.29                       -> fa:frost-bite
 *     r < 0.31                       -> fa:mirror-taunt
 *     r < 0.33                       -> fa:hearth
 *     r < 0.35                       -> fa:rot-curse
 *     r < 0.37                       -> fa:wrong-bell
 *     r < 0.39                       -> fa:venom-curse
 *     r < 0.41                       -> fa:slow-clap
 *     r < 0.43                       -> fa:spotter
 *     r < 0.45                       -> fa:dust-storm
 *   neutral:
 *     r < 0.08                       -> fa:brit-drizzle
 *     r < 0.10                       -> fa:fog
 *     r < 0.12                       -> fa:thunder
 *     r < 0.14                       -> fa:quiet-blessing
 *     r < 0.16                       -> fa:taunt-neutral
 *     r < 0.18                       -> fa:reversal-neutral
 *     r < 0.20                       -> fa:aurora
 *     r < 0.22                       -> fa:snowfall
 *     r < 0.24                       -> fa:coffee
 *     r < 0.26                       -> fa:mist
 *     r < 0.28                       -> fa:humming
 *     r < 0.30                       -> fa:sundown
 *     r < 0.32                       -> fa:mint-tonic
 *     r < 0.34                       -> fa:loud-crowd
 *     r < 0.36                       -> fa:ember-rain
 *     r < 0.38                       -> fa:starfall
 *     r < 0.40                       -> fa:luck-drip
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
 *   TAUNT .... a dry taunt banner, cosmetic only.
 *   REVERSAL .... controls invert briefly (invertMs), mechanical.
 *   SANCTUARY .... a calm moment, cosmetic glow, no penalty.
 *   GLITCH CURSE .... screen corrupts, hpDelta -10.
 *   PYRO ENTRANCE .... fire entrance, shake + embers, persona from roster.
 *   STATIC CURSE .... signal lost, hpDelta -8.
 *   ECHO .... taunts bounce back, cosmetic.
 *   FOG .... visibility drops, cosmetic.
 *   THUNDER .... distant rumble, flash + shake.
 *   QUIET BLESSING .... a small fortune, cosmetic glow.
 *   TAUNT-NEUTRAL .... a neutral taunt, cosmetic.
 *   REVERSAL-NEUTRAL .... brief inversion, mechanical.
 *   AURORA .... the sky dances, cosmetic.
 *   P6 BATCH (all cosmetic, cue-only — zero engine changes; appended so every
 *   existing slice keeps its exact r-range):
 *   SLAM DROP / MIRROR TAUNT / WRONG-BELL / SLOW CLAP .... hostile theatre.
 *   FROST BITE / ROT CURSE / VENOM CURSE / DUST STORM .... hostile curses.
 *   HEARTH / SPOTTER .... hostile-round calm corners.
 *   SNOWFALL / MIST / SUNDOWN / EMBER RAIN / STARFALL .... neutral weather.
 *   COFFEE / MINT TONIC / LUCK DRIP .... neutral blessings.
 *   HUMMING / LOUD CROWD .... neutral taunts.
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

/** Hostile-round windows (mutually exclusive slices, in order). */
export const W_FA_ENTRANCE = 0.06;
export const W_FA_TAPE = 0.05;
export const W_FA_TAUNT = 0.02;
export const W_FA_REVERSAL = 0.02;
export const W_FA_SANCTUARY = 0.02;
export const W_FA_GLITCH = 0.02;
export const W_FA_PYRO = 0.02;
export const W_FA_STATIC = 0.02;
export const W_FA_ECHO = 0.02;
/** Neutral-round windows (mutually exclusive slices, in order). */
export const W_FA_WEATHER = 0.08;
export const W_FA_FOG = 0.02;
export const W_FA_THUNDER = 0.02;
export const W_FA_BLESS = 0.02;
export const W_FA_TAUNT_N = 0.02;
export const W_FA_REVERSAL_N = 0.02;
export const W_FA_AURORA = 0.02;
/** P6 batch — hostile windows (appended; existing slices unchanged). */
export const W_FA_SLAM_DROP = 0.02;
export const W_FA_FROST = 0.02;
export const W_FA_MIRROR = 0.02;
export const W_FA_HEARTH = 0.02;
export const W_FA_ROT = 0.02;
export const W_FA_BELL = 0.02;
export const W_FA_VENOM = 0.02;
export const W_FA_SLOW_CLAP = 0.02;
export const W_FA_SPOTTER = 0.02;
export const W_FA_DUST = 0.02;
/** P6 batch — neutral windows (appended; existing slices unchanged). */
export const W_FA_SNOWFALL = 0.02;
export const W_FA_COFFEE = 0.02;
export const W_FA_MIST = 0.02;
export const W_FA_HUM = 0.02;
export const W_FA_SUNDOWN = 0.02;
export const W_FA_MINT = 0.02;
export const W_FA_CROWD = 0.02;
export const W_FA_EMBER_RAIN = 0.02;
export const W_FA_STARFALL = 0.02;
export const W_FA_LUCK = 0.02;

/** Distinct stream salt — deliberately unlike FATE_SALT / CP_SALT. */
const FA_SALT = 0xfa1a7;

/** TAPE CURSE overlay length (ms) and its hp penalty. */
export const TAPE_MS = 5000;
export const TAPE_HP = -15;

export interface FlavorMod {
  id: string;
  kind: 'entrance' | 'curse' | 'weather' | 'taunt' | 'reversal' | 'sanctuary' | 'blessing';
  bannerText: string;
  /** presentation-only effect id for the engine renderer */
  cosmetic?: string;
  /** overlay duration in ms (engine clamps to round length) */
  overlayMs?: number;
  hpDelta?: number;
  /** controls inversion duration in ms (reversal events) */
  invertMs?: number;
  /** opaque pass-through flags (tapeForgiveMs etc.) */
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
/* Shipped event roster (pure data — the gate validates THIS, not copies) */
/* ------------------------------------------------------------------ */
/*
 * The 36 flavor-a events (16 original + 20 P6 batch), exported as data
 * exactly like fate.ts's FATES,
 * flavor-b.ts's COUNTRIES and cursepack.ts's CURSES/BLESSINGS.
 * maybeFlavorA() selects from this roster; selftest-fate.ts imports it.
 * Entrance banners show roster persona #1; the engine swaps in the seeded
 * persona (same id/weight/cue/selection as before this lift — only the
 * banner template's persona name changes, ids/weights unchanged).
 */
export const FA_EVENTS: readonly FlavorMod[] = [
  {
    id: 'fa:slam-entrance',
    kind: 'entrance',
    bannerText: '⚔ ENTRANCE: THE PAPER TITAN — "READ A DICTIONARY COVER TO COVER"',
    cosmetic: 'rope-shake',
    overlayMs: 4200,
    flag: { persona: ROSTER[0]!.name },
    cue: { shake: { intensity: 0.8, ms: 900 } },
  },
  {
    id: 'fa:tape-curse',
    kind: 'curse',
    bannerText: '📼 THE UNLABELED TAPE PLAYS — WATCH (5S) OR HP −15',
    cosmetic: 'tape-countdown',
    overlayMs: TAPE_MS,
    hpDelta: TAPE_HP,
    flag: {
      tapeForgiveMs: TAPE_MS,
      tapeForgivenBanner: '➻ YOU WATCHED. THE WELL REMEMBERS.',
      tapePunishedBanner: "📼 YOU DIDN'T WATCH THE TAPE — HP −15",
    },
    cue: { glitch: 400, scanlines: true },
  },
  {
    id: 'fa:taunt',
    kind: 'taunt',
    bannerText: '🗤 TAUNT: "YOU CALLED THAT A STRATEGY?"',
    cosmetic: 'taunt-bubble',
    cue: { glitch: 200 },
  },
  {
    id: 'fa:reversal',
    kind: 'reversal',
    bannerText: '🔄 REVERSAL — CONTROLS INVERTED FOR 500ms',
    invertMs: 500,
    cue: { invert: 500, shake: { intensity: 0.4, ms: 400 } },
  },
  {
    id: 'fa:sanctuary',
    kind: 'sanctuary',
    bannerText: '✨ SANCTUARY — A MOMENT OF CALM (COSMETIC)',
    cosmetic: 'sanctuary-glow',
    cue: { flash: { color: 0x44ff88, ms: 150 }, embers: 16 },
  },
  {
    id: 'fa:glitch-curse',
    kind: 'curse',
    bannerText: '🗸 GLITCH CURSE — SCREEN CORRUPTS (HP −10)',
    cosmetic: 'glitch-overlay',
    hpDelta: -10,
    cue: { glitch: 600, scanlines: true },
  },
  {
    id: 'fa:pyro-entrance',
    kind: 'entrance',
    bannerText: '🔥 PYRO ENTRANCE: THE PAPER TITAN CATCHES FIRE',
    cosmetic: 'pyro-entrance',
    overlayMs: 3500,
    flag: { persona: ROSTER[0]!.name },
    cue: { shake: { intensity: 0.9, ms: 800 }, embers: 32 },
  },
  {
    id: 'fa:static-curse',
    kind: 'curse',
    bannerText: '📡 STATIC CURSE — SIGNAL LOST (HP −8)',
    cosmetic: 'static-overlay',
    hpDelta: -8,
    cue: { glitch: 800, scanlines: true },
  },
  {
    id: 'fa:echo',
    kind: 'taunt',
    bannerText: '🕊 ECHO — YOUR TAUNTS BOUNCE BACK',
    cosmetic: 'echo-ring',
    cue: { glitch: 300, embers: 6 },
  },
  {
    id: 'fa:brit-drizzle',
    kind: 'weather',
    bannerText: 'MIND THE DRIZZLE.',
    cosmetic: 'drizzle',
    overlayMs: 8000,
    cue: { scanlines: true, embers: 8 },
  },
  {
    id: 'fa:fog',
    kind: 'weather',
    bannerText: '🌫 FOG ROLLS IN — VISIBILITY DROPS (COSMETIC)',
    cosmetic: 'fog',
    overlayMs: 6000,
    cue: { scanlines: true, embers: 4 },
  },
  {
    id: 'fa:thunder',
    kind: 'weather',
    bannerText: '⚡ THUNDER — A DISTANT RUMBLE',
    cosmetic: 'thunder-flash',
    cue: { flash: { color: 0xffffff, ms: 100 }, shake: { intensity: 0.5, ms: 300 } },
  },
  {
    id: 'fa:quiet-blessing',
    kind: 'blessing',
    bannerText: '🔀 QUIET BLESSING — A SMALL FORTUNE (COSMETIC)',
    cosmetic: 'blessing-glow',
    cue: { flash: { color: 0x88ffcc, ms: 120 }, embers: 10 },
  },
  {
    id: 'fa:taunt-neutral',
    kind: 'taunt',
    bannerText: '🎭 TAUNT: "NOT BAD. FOR A TUESDAY."',
    cosmetic: 'taunt-bubble',
    cue: { glitch: 150 },
  },
  {
    id: 'fa:reversal-neutral',
    kind: 'reversal',
    bannerText: '🔀 REVERSAL — BRIEF INVERSION (400ms)',
    invertMs: 400,
    cue: { invert: 400 },
  },
  {
    id: 'fa:aurora',
    kind: 'weather',
    bannerText: '🌌 AURORA — THE SKY DANCES (COSMETIC)',
    cosmetic: 'aurora',
    overlayMs: 7000,
    cue: { flash: { color: 0x44ffaa, ms: 180 }, embers: 20 },
  },
  /* --- P6 batch: 10 hostile + 10 neutral, all cosmetic + cue-only --- */
  {
    id: 'fa:slam-drop',
    kind: 'taunt',
    bannerText: '💥 SLAM DROP — THE FLOOR REMEMBERS (COSMETIC)',
    cue: { shake: { intensity: 0.7, ms: 400 }, embers: 10 },
  },
  {
    id: 'fa:frost-bite',
    kind: 'curse',
    bannerText: '🧊 FROST BITE — THE PIXELS FREEZE (COSMETIC)',
    cue: { flash: { color: 0x88ccff, ms: 120 }, scanlines: true },
  },
  {
    id: 'fa:mirror-taunt',
    kind: 'taunt',
    bannerText: '🪞 MIRROR TAUNT: "THAT WOULD\'VE BEEN MINE."',
    cue: { glitch: 250 },
  },
  {
    id: 'fa:hearth',
    kind: 'sanctuary',
    bannerText: '🕯 QUIET CORNER — A LAMP TURNS ON (COSMETIC)',
    cue: { flash: { color: 0xffcc66, ms: 200 } },
  },
  {
    id: 'fa:rot-curse',
    kind: 'curse',
    bannerText: '🌀 ROT CURSE — THE EDGES MELT (COSMETIC)',
    cue: { melt: 0.35, shake: { intensity: 0.3, ms: 300 } },
  },
  {
    id: 'fa:wrong-bell',
    kind: 'taunt',
    bannerText: '🔔 WRONG-BELL — THE CROWD HONKES (COSMETIC)',
    cue: { glitch: 350, shake: { intensity: 0.2, ms: 200 } },
  },
  {
    id: 'fa:venom-curse',
    kind: 'curse',
    bannerText: '🐍 VENOM CURSE — GREEN STATIC CREEPS IN (COSMETIC)',
    cue: { scanlines: true, embers: 12 },
  },
  {
    id: 'fa:slow-clap',
    kind: 'taunt',
    bannerText: '👏 SLOW CLAPS FROM THE BALCONY (COSMETIC)',
    cue: { glitch: 200 },
  },
  {
    id: 'fa:spotter',
    kind: 'sanctuary',
    bannerText: '🏋 SPOTTER MODE — SOMEONE HAS YOUR BACK (COSMETIC)',
    cue: { flash: { color: 0x66ffcc, ms: 150 }, embers: 6 },
  },
  {
    id: 'fa:dust-storm',
    kind: 'curse',
    bannerText: '🌪 DUST STORM — THE HUD BUFFS UP (COSMETIC)',
    cue: { shake: { intensity: 0.5, ms: 450 }, melt: 0.25 },
  },
  {
    id: 'fa:snowfall',
    kind: 'weather',
    bannerText: '❄ SNOWFALL — THE PIXELS DRIFT (COSMETIC)',
    cue: { embers: 10, flash: { color: 0xffffff, ms: 100 } },
  },
  {
    id: 'fa:coffee',
    kind: 'blessing',
    bannerText: '☕ A COFFEE APPEARS ON THE DESK (COSMETIC)',
    cue: { flash: { color: 0xffaa66, ms: 140 } },
  },
  {
    id: 'fa:mist',
    kind: 'weather',
    bannerText: '🌫 MIST — EVERYTHING GOES SOFT (COSMETIC)',
    cue: { scanlines: true },
  },
  {
    id: 'fa:humming',
    kind: 'taunt',
    bannerText: '🎵 SOMEONE HUMS THE THEME ALONG (COSMETIC)',
    cue: { glitch: 180 },
  },
  {
    id: 'fa:sundown',
    kind: 'weather',
    bannerText: '🌇 SUNDOWN HAZE — COLORS WARM UP (COSMETIC)',
    cue: { flash: { color: 0xff8844, ms: 180 }, embers: 8 },
  },
  {
    id: 'fa:mint-tonic',
    kind: 'blessing',
    bannerText: '🌿 MINT TONIC — THE MIND SHARPENS (COSMETIC)',
    cue: { flash: { color: 0x88ff88, ms: 120 }, embers: 5 },
  },
  {
    id: 'fa:loud-crowd',
    kind: 'taunt',
    bannerText: '📣 THE CROWD GUESSES OUT LOUD (COSMETIC)',
    cue: { glitch: 300, shake: { intensity: 0.15, ms: 250 } },
  },
  {
    id: 'fa:ember-rain',
    kind: 'weather',
    bannerText: '🔥 EMBER RAIN — THE SKY IS IN A MOOD (COSMETIC)',
    cue: { embers: 32, flash: { color: 0xff6622, ms: 160 } },
  },
  {
    id: 'fa:starfall',
    kind: 'weather',
    bannerText: '✨ STARFALL — THE CEILING GOES QUIET (COSMETIC)',
    cue: { embers: 18, flash: { color: 0xccccff, ms: 200 } },
  },
  {
    id: 'fa:luck-drip',
    kind: 'blessing',
    bannerText: '🍀 LUCK DRIP — A SMALL FORTUNE DRIFTS BY',
    cue: { flash: { color: 0x44ff44, ms: 130 }, embers: 9 },
  },
];

/** Window -> roster index (hostile slices, in roll order). */
const FA_HOSTILE: readonly (readonly [w: number, i: number])[] = [
  [W_FA_ENTRANCE, 0], // fa:slam-entrance
  [W_FA_TAPE, 1],     // fa:tape-curse
  [W_FA_TAUNT, 2],    // fa:taunt
  [W_FA_REVERSAL, 3], // fa:reversal
  [W_FA_SANCTUARY, 4],// fa:sanctuary
  [W_FA_GLITCH, 5],   // fa:glitch-curse
  [W_FA_PYRO, 6],     // fa:pyro-entrance
  [W_FA_STATIC, 7],   // fa:static-curse
  [W_FA_ECHO, 8],     // fa:echo
  [W_FA_SLAM_DROP, 16], // fa:slam-drop
  [W_FA_FROST, 17],     // fa:frost-bite
  [W_FA_MIRROR, 18],    // fa:mirror-taunt
  [W_FA_HEARTH, 19],    // fa:hearth
  [W_FA_ROT, 20],       // fa:rot-curse
  [W_FA_BELL, 21],      // fa:wrong-bell
  [W_FA_VENOM, 22],     // fa:venom-curse
  [W_FA_SLOW_CLAP, 23], // fa:slow-clap
  [W_FA_SPOTTER, 24],   // fa:spotter
  [W_FA_DUST, 25],      // fa:dust-storm
];

/** Window -> roster index (neutral slices, in roll order). */
const FA_NEUTRAL: readonly (readonly [w: number, i: number])[] = [
  [W_FA_WEATHER, 9],  // fa:brit-drizzle
  [W_FA_FOG, 10],     // fa:fog
  [W_FA_THUNDER, 11], // fa:thunder
  [W_FA_BLESS, 12],   // fa:quiet-blessing
  [W_FA_TAUNT_N, 13], // fa:taunt-neutral
  [W_FA_REVERSAL_N, 14], // fa:reversal-neutral
  [W_FA_AURORA, 15],  // fa:aurora
  [W_FA_SNOWFALL, 26], // fa:snowfall
  [W_FA_COFFEE, 27],   // fa:coffee
  [W_FA_MIST, 28],     // fa:mist
  [W_FA_HUM, 29],      // fa:humming
  [W_FA_SUNDOWN, 30],  // fa:sundown
  [W_FA_MINT, 31],     // fa:mint-tonic
  [W_FA_CROWD, 32],    // fa:loud-crowd
  [W_FA_EMBER_RAIN, 33], // fa:ember-rain
  [W_FA_STARFALL, 34], // fa:starfall
  [W_FA_LUCK, 35],     // fa:luck-drip
];

/** Roster events that template in a seeded persona / weather line. */
function materialize(ev: FlavorMod, rng: () => number): FlavorMod {
  if (ev.id === 'fa:slam-entrance' || ev.id === 'fa:pyro-entrance') {
    const foe = ROSTER[Math.floor(rng() * ROSTER.length) % ROSTER.length];
    const banner =
      ev.id === 'fa:slam-entrance'
        ? `⚔ ENTRANCE: ${foe.name} — "${foe.tagline}"`
        : `🔥 PYRO ENTRANCE: ${foe.name} CATCHES FIRE`;
    return { ...ev, bannerText: banner, flag: { persona: foe.name } };
  }
  if (ev.id === 'fa:brit-drizzle') {
    const line = WEATHER_LINES[Math.floor(rng() * WEATHER_LINES.length) % WEATHER_LINES.length];
    return { ...ev, bannerText: line };
  }
  return ev;
}

/* ------------------------------------------------------------------ */
/* Roll                                                                */
/* ------------------------------------------------------------------ */

/**
 * One roll per round start. Returns null when nothing fires.
 * - depth < 3:    always null (rounds 1-2 stay baseline parity).
 * - bad/chaotic:  entrance, tape, taunt, reversal, sanctuary, glitch, pyro, static, echo,
 *                then P6: slam-drop, frost, mirror, hearth, rot, bell, venom, slow-clap,
 *                spotter, dust windows.
 * - neutral:      weather, fog, thunder, blessing, taunt, reversal, aurora, then P6:
 *                snowfall, coffee, mist, humming, sundown, mint, crowd, ember-rain,
 *                starfall, luck windows.
 * - good:         quiet (blessings own it).
 */
export function maybeFlavorA(ctx: FateCtx): FlavorMod | null {
  if (!(ctx.depth >= 3)) return null;
  const rng =
    ctx.rng ??
    mulberry32((ctx.seed ^ Math.imul(ctx.depth + 1, 2654435761) ^ FA_SALT) >>> 0);

  const r = rng();

  const windows =
    ctx.align === 'bad' || ctx.align === 'chaotic' ? FA_HOSTILE :
    ctx.align === 'neutral' ? FA_NEUTRAL : null;
  if (windows === null) return null;

  let acc = 0;
  for (const [w, i] of windows) {
    acc += w;
    if (r < acc) return materialize(FA_EVENTS[i]!, rng);
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

  // hostile: entrance slice
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
  // taunt slice
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_FA_ENTRANCE + W_FA_TAPE) });
  if (!m || m.id !== 'fa:taunt') failures.push(`taunt slice start wrong: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_FA_ENTRANCE + W_FA_TAPE + W_FA_TAUNT - 0.0001) });
  if (!m || m.id !== 'fa:taunt') failures.push(`taunt slice high-inside missed: ${JSON.stringify(m)}`);
  // reversal slice
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_FA_ENTRANCE + W_FA_TAPE + W_FA_TAUNT) });
  if (!m || m.id !== 'fa:reversal') failures.push(`reversal slice start wrong: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_FA_ENTRANCE + W_FA_TAPE + W_FA_TAUNT + W_FA_REVERSAL - 0.0001) });
  if (!m || m.id !== 'fa:reversal') failures.push(`reversal slice high-inside missed: ${JSON.stringify(m)}`);
  // sanctuary slice
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_FA_ENTRANCE + W_FA_TAPE + W_FA_TAUNT + W_FA_REVERSAL) });
  if (!m || m.id !== 'fa:sanctuary') failures.push(`sanctuary slice start wrong: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_FA_ENTRANCE + W_FA_TAPE + W_FA_TAUNT + W_FA_REVERSAL + W_FA_SANCTUARY - 0.0001) });
  if (!m || m.id !== 'fa:sanctuary') failures.push(`sanctuary slice high-inside missed: ${JSON.stringify(m)}`);
  // glitch-curse slice
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_FA_ENTRANCE + W_FA_TAPE + W_FA_TAUNT + W_FA_REVERSAL + W_FA_SANCTUARY) });
  if (!m || m.id !== 'fa:glitch-curse') failures.push(`glitch-curse slice start wrong: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_FA_ENTRANCE + W_FA_TAPE + W_FA_TAUNT + W_FA_REVERSAL + W_FA_SANCTUARY + W_FA_GLITCH - 0.0001) });
  if (!m || m.id !== 'fa:glitch-curse') failures.push(`glitch-curse slice high-inside missed: ${JSON.stringify(m)}`);
  // pyro-entrance slice
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_FA_ENTRANCE + W_FA_TAPE + W_FA_TAUNT + W_FA_REVERSAL + W_FA_SANCTUARY + W_FA_GLITCH) });
  if (!m || m.id !== 'fa:pyro-entrance') failures.push(`pyro-entrance slice start wrong: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_FA_ENTRANCE + W_FA_TAPE + W_FA_TAUNT + W_FA_REVERSAL + W_FA_SANCTUARY + W_FA_GLITCH + W_FA_PYRO - 0.0001) });
  if (!m || m.id !== 'fa:pyro-entrance') failures.push(`pyro-entrance slice high-inside missed: ${JSON.stringify(m)}`);
  // static-curse slice
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_FA_ENTRANCE + W_FA_TAPE + W_FA_TAUNT + W_FA_REVERSAL + W_FA_SANCTUARY + W_FA_GLITCH + W_FA_PYRO) });
  if (!m || m.id !== 'fa:static-curse') failures.push(`static-curse slice start wrong: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_FA_ENTRANCE + W_FA_TAPE + W_FA_TAUNT + W_FA_REVERSAL + W_FA_SANCTUARY + W_FA_GLITCH + W_FA_PYRO + W_FA_STATIC - 0.0001) });
  if (!m || m.id !== 'fa:static-curse') failures.push(`static-curse slice high-inside missed: ${JSON.stringify(m)}`);
  // echo slice
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_FA_ENTRANCE + W_FA_TAPE + W_FA_TAUNT + W_FA_REVERSAL + W_FA_SANCTUARY + W_FA_GLITCH + W_FA_PYRO + W_FA_STATIC) });
  if (!m || m.id !== 'fa:echo') failures.push(`echo slice start wrong: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_FA_ENTRANCE + W_FA_TAPE + W_FA_TAUNT + W_FA_REVERSAL + W_FA_SANCTUARY + W_FA_GLITCH + W_FA_PYRO + W_FA_STATIC + W_FA_ECHO - 0.0001) });
  if (!m || m.id !== 'fa:echo') failures.push(`echo slice high-inside missed: ${JSON.stringify(m)}`);
  // P6 batch: seam between old hostile tail and new hostile head
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_FA_ENTRANCE + W_FA_TAPE + W_FA_TAUNT + W_FA_REVERSAL + W_FA_SANCTUARY + W_FA_GLITCH + W_FA_PYRO + W_FA_STATIC + W_FA_ECHO) });
  if (!m || m.id !== 'fa:slam-drop') failures.push(`slam-drop slice start wrong: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_FA_ENTRANCE + W_FA_TAPE + W_FA_TAUNT + W_FA_REVERSAL + W_FA_SANCTUARY + W_FA_GLITCH + W_FA_PYRO + W_FA_STATIC + W_FA_ECHO + W_FA_SLAM_DROP + W_FA_FROST + W_FA_MIRROR + W_FA_HEARTH + W_FA_ROT + W_FA_BELL + W_FA_VENOM + W_FA_SLOW_CLAP + W_FA_SPOTTER + W_FA_DUST - 0.0001) });
  if (!m || m.id !== 'fa:dust-storm') failures.push(`dust-storm slice high-inside missed: ${JSON.stringify(m)}`);
  // past all hostile windows -> quiet hostile round
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'bad', rng: fixed(W_FA_ENTRANCE + W_FA_TAPE + W_FA_TAUNT + W_FA_REVERSAL + W_FA_SANCTUARY + W_FA_GLITCH + W_FA_PYRO + W_FA_STATIC + W_FA_ECHO + W_FA_SLAM_DROP + W_FA_FROST + W_FA_MIRROR + W_FA_HEARTH + W_FA_ROT + W_FA_BELL + W_FA_VENOM + W_FA_SLOW_CLAP + W_FA_SPOTTER + W_FA_DUST + 0.0001) });
  if (m !== null) failures.push(`quiet hostile round fired: ${JSON.stringify(m)}`);

  // neutral: weather window
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'neutral', rng: fixed(W_FA_WEATHER - 0.0001) });
  if (!m || m.id !== 'fa:brit-drizzle' || m.kind !== 'weather')
    failures.push(`weather window inside missed: ${JSON.stringify(m)}`);
  // fog slice
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'neutral', rng: fixed(W_FA_WEATHER) });
  if (!m || m.id !== 'fa:fog') failures.push(`fog slice start wrong: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'neutral', rng: fixed(W_FA_WEATHER + W_FA_FOG - 0.0001) });
  if (!m || m.id !== 'fa:fog') failures.push(`fog slice high-inside missed: ${JSON.stringify(m)}`);
  // thunder slice
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'neutral', rng: fixed(W_FA_WEATHER + W_FA_FOG) });
  if (!m || m.id !== 'fa:thunder') failures.push(`thunder slice start wrong: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'neutral', rng: fixed(W_FA_WEATHER + W_FA_FOG + W_FA_THUNDER - 0.0001) });
  if (!m || m.id !== 'fa:thunder') failures.push(`thunder slice high-inside missed: ${JSON.stringify(m)}`);
  // blessing slice
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'neutral', rng: fixed(W_FA_WEATHER + W_FA_FOG + W_FA_THUNDER) });
  if (!m || m.id !== 'fa:quiet-blessing') failures.push(`blessing slice start wrong: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'neutral', rng: fixed(W_FA_WEATHER + W_FA_FOG + W_FA_THUNDER + W_FA_BLESS - 0.0001) });
  if (!m || m.id !== 'fa:quiet-blessing') failures.push(`blessing slice high-inside missed: ${JSON.stringify(m)}`);
  // taunt-neutral slice
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'neutral', rng: fixed(W_FA_WEATHER + W_FA_FOG + W_FA_THUNDER + W_FA_BLESS) });
  if (!m || m.id !== 'fa:taunt-neutral') failures.push(`taunt-neutral slice start wrong: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'neutral', rng: fixed(W_FA_WEATHER + W_FA_FOG + W_FA_THUNDER + W_FA_BLESS + W_FA_TAUNT_N - 0.0001) });
  if (!m || m.id !== 'fa:taunt-neutral') failures.push(`taunt-neutral slice high-inside missed: ${JSON.stringify(m)}`);
  // reversal-neutral slice
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'neutral', rng: fixed(W_FA_WEATHER + W_FA_FOG + W_FA_THUNDER + W_FA_BLESS + W_FA_TAUNT_N) });
  if (!m || m.id !== 'fa:reversal-neutral') failures.push(`reversal-neutral slice start wrong: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'neutral', rng: fixed(W_FA_WEATHER + W_FA_FOG + W_FA_THUNDER + W_FA_BLESS + W_FA_TAUNT_N + W_FA_REVERSAL_N - 0.0001) });
  if (!m || m.id !== 'fa:reversal-neutral') failures.push(`reversal-neutral slice high-inside missed: ${JSON.stringify(m)}`);
  // aurora slice
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'neutral', rng: fixed(W_FA_WEATHER + W_FA_FOG + W_FA_THUNDER + W_FA_BLESS + W_FA_TAUNT_N + W_FA_REVERSAL_N) });
  if (!m || m.id !== 'fa:aurora') failures.push(`aurora slice start wrong: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'neutral', rng: fixed(W_FA_WEATHER + W_FA_FOG + W_FA_THUNDER + W_FA_BLESS + W_FA_TAUNT_N + W_FA_REVERSAL_N + W_FA_AURORA - 0.0001) });
  if (!m || m.id !== 'fa:aurora') failures.push(`aurora slice high-inside missed: ${JSON.stringify(m)}`);
  // P6 batch: seam between old neutral tail and new neutral head
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'neutral', rng: fixed(W_FA_WEATHER + W_FA_FOG + W_FA_THUNDER + W_FA_BLESS + W_FA_TAUNT_N + W_FA_REVERSAL_N + W_FA_AURORA) });
  if (!m || m.id !== 'fa:snowfall') failures.push(`snowfall slice start wrong: ${JSON.stringify(m)}`);
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'neutral', rng: fixed(W_FA_WEATHER + W_FA_FOG + W_FA_THUNDER + W_FA_BLESS + W_FA_TAUNT_N + W_FA_REVERSAL_N + W_FA_AURORA + W_FA_SNOWFALL + W_FA_COFFEE + W_FA_MIST + W_FA_HUM + W_FA_SUNDOWN + W_FA_MINT + W_FA_CROWD + W_FA_EMBER_RAIN + W_FA_STARFALL + W_FA_LUCK - 0.0001) });
  if (!m || m.id !== 'fa:luck-drip') failures.push(`luck-drip slice high-inside missed: ${JSON.stringify(m)}`);
  // past all neutral windows -> quiet neutral round
  call = 0;
  m = maybeFlavorA({ seed: 1, depth: 3, align: 'neutral', rng: fixed(W_FA_WEATHER + W_FA_FOG + W_FA_THUNDER + W_FA_BLESS + W_FA_TAUNT_N + W_FA_REVERSAL_N + W_FA_AURORA + W_FA_SNOWFALL + W_FA_COFFEE + W_FA_MIST + W_FA_HUM + W_FA_SUNDOWN + W_FA_MINT + W_FA_CROWD + W_FA_EMBER_RAIN + W_FA_STARFALL + W_FA_LUCK + 0.0001) });
  if (m !== null) failures.push(`quiet neutral round fired: ${JSON.stringify(m)}`);
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
  const hostileHits: Record<string, number> = {};
  const neutralHits: Record<string, number> = {};
  const entPersonas = new Set<string>();
  const seenIds = new Set<string>();
  const wxLines = new Set<string>();
  const hostileKinds = new Set(['entrance', 'curse', 'taunt', 'reversal', 'sanctuary']);
  for (let s = 0; s < N; s++) {
    const e = roll(s, 5, 'bad');
    if (e) {
      seenIds.add(e.id);
      hostileHits[e.id] = (hostileHits[e.id] ?? 0) + 1;
      if (!hostileKinds.has(e.kind)) failures.push(`hostile fired non-hostile kind ${e.id}`);
      if (e.kind === 'entrance') { entPersonas.add(String(e.flag?.persona)); }
      if (e.kind === 'curse' && e.id === 'fa:tape-curse') {
        if (e.hpDelta !== TAPE_HP) failures.push(`tape hp wrong: ${e.hpDelta}`);
        if (e.flag?.tapeForgiveMs !== TAPE_MS) failures.push(`tape window wrong: ${String(e.flag?.tapeForgiveMs)}`);
      }
    }
    const w = roll(s, 5, 'neutral');
    if (w) {
      seenIds.add(w.id);
      neutralHits[w.id] = (neutralHits[w.id] ?? 0) + 1;
      if (w.id === 'fa:brit-drizzle') { wxLines.add(w.bannerText); }
    }
    if (roll(s, 5, 'chaotic')?.kind === 'weather') failures.push('weather on chaotic');
    if (roll(s, 5, 'good') !== null) failures.push(`good round fired seed=${s}`);
  }
  // Rate checks for hostile windows
  const pEnt = (hostileHits['fa:slam-entrance'] ?? 0) / N;
  const pTape = (hostileHits['fa:tape-curse'] ?? 0) / N;
  const pTaunt = (hostileHits['fa:taunt'] ?? 0) / N;
  const pReversal = (hostileHits['fa:reversal'] ?? 0) / N;
  const pSanctuary = (hostileHits['fa:sanctuary'] ?? 0) / N;
  const pGlitch = (hostileHits['fa:glitch-curse'] ?? 0) / N;
  const pPyro = (hostileHits['fa:pyro-entrance'] ?? 0) / N;
  const pStatic = (hostileHits['fa:static-curse'] ?? 0) / N;
  const pEcho = (hostileHits['fa:echo'] ?? 0) / N;
  const pSlamDrop = (hostileHits['fa:slam-drop'] ?? 0) / N;
  const pFrost = (hostileHits['fa:frost-bite'] ?? 0) / N;
  const pMirror = (hostileHits['fa:mirror-taunt'] ?? 0) / N;
  const pHearth = (hostileHits['fa:hearth'] ?? 0) / N;
  const pRot = (hostileHits['fa:rot-curse'] ?? 0) / N;
  const pBell = (hostileHits['fa:wrong-bell'] ?? 0) / N;
  const pVenom = (hostileHits['fa:venom-curse'] ?? 0) / N;
  const pClap = (hostileHits['fa:slow-clap'] ?? 0) / N;
  const pSpotter = (hostileHits['fa:spotter'] ?? 0) / N;
  const pDust = (hostileHits['fa:dust-storm'] ?? 0) / N;
  if (Math.abs(pEnt - W_FA_ENTRANCE) > 0.008) failures.push(`entrance rate ${pEnt.toFixed(4)} != 0.06±0.008`);
  if (Math.abs(pTape - W_FA_TAPE) > 0.008) failures.push(`tape rate ${pTape.toFixed(4)} != 0.05±0.008`);
  if (Math.abs(pTaunt - W_FA_TAUNT) > 0.008) failures.push(`taunt rate ${pTaunt.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pReversal - W_FA_REVERSAL) > 0.008) failures.push(`reversal rate ${pReversal.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pSanctuary - W_FA_SANCTUARY) > 0.008) failures.push(`sanctuary rate ${pSanctuary.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pGlitch - W_FA_GLITCH) > 0.008) failures.push(`glitch rate ${pGlitch.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pPyro - W_FA_PYRO) > 0.008) failures.push(`pyro rate ${pPyro.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pStatic - W_FA_STATIC) > 0.008) failures.push(`static rate ${pStatic.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pEcho - W_FA_ECHO) > 0.008) failures.push(`echo rate ${pEcho.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pSlamDrop - W_FA_SLAM_DROP) > 0.008) failures.push(`slam-drop rate ${pSlamDrop.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pFrost - W_FA_FROST) > 0.008) failures.push(`frost-bite rate ${pFrost.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pMirror - W_FA_MIRROR) > 0.008) failures.push(`mirror-taunt rate ${pMirror.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pHearth - W_FA_HEARTH) > 0.008) failures.push(`hearth rate ${pHearth.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pRot - W_FA_ROT) > 0.008) failures.push(`rot-curse rate ${pRot.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pBell - W_FA_BELL) > 0.008) failures.push(`wrong-bell rate ${pBell.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pVenom - W_FA_VENOM) > 0.008) failures.push(`venom-curse rate ${pVenom.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pClap - W_FA_SLOW_CLAP) > 0.008) failures.push(`slow-clap rate ${pClap.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pSpotter - W_FA_SPOTTER) > 0.008) failures.push(`spotter rate ${pSpotter.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pDust - W_FA_DUST) > 0.008) failures.push(`dust-storm rate ${pDust.toFixed(4)} != 0.02±0.008`);
  // Rate checks for neutral windows
  const pWx = (neutralHits['fa:brit-drizzle'] ?? 0) / N;
  const pFog = (neutralHits['fa:fog'] ?? 0) / N;
  const pThunder = (neutralHits['fa:thunder'] ?? 0) / N;
  const pBless = (neutralHits['fa:quiet-blessing'] ?? 0) / N;
  const pTauntN = (neutralHits['fa:taunt-neutral'] ?? 0) / N;
  const pReversalN = (neutralHits['fa:reversal-neutral'] ?? 0) / N;
  const pAurora = (neutralHits['fa:aurora'] ?? 0) / N;
  const pSnow = (neutralHits['fa:snowfall'] ?? 0) / N;
  const pCoffee = (neutralHits['fa:coffee'] ?? 0) / N;
  const pMist = (neutralHits['fa:mist'] ?? 0) / N;
  const pHum = (neutralHits['fa:humming'] ?? 0) / N;
  const pSundown = (neutralHits['fa:sundown'] ?? 0) / N;
  const pMint = (neutralHits['fa:mint-tonic'] ?? 0) / N;
  const pCrowd = (neutralHits['fa:loud-crowd'] ?? 0) / N;
  const pEmberRain = (neutralHits['fa:ember-rain'] ?? 0) / N;
  const pStarfall = (neutralHits['fa:starfall'] ?? 0) / N;
  const pLuck = (neutralHits['fa:luck-drip'] ?? 0) / N;
  if (Math.abs(pWx - W_FA_WEATHER) > 0.008) failures.push(`weather rate ${pWx.toFixed(4)} != 0.08±0.008`);
  if (Math.abs(pFog - W_FA_FOG) > 0.008) failures.push(`fog rate ${pFog.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pThunder - W_FA_THUNDER) > 0.008) failures.push(`thunder rate ${pThunder.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pBless - W_FA_BLESS) > 0.008) failures.push(`blessing rate ${pBless.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pTauntN - W_FA_TAUNT_N) > 0.008) failures.push(`taunt-neutral rate ${pTauntN.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pReversalN - W_FA_REVERSAL_N) > 0.008) failures.push(`reversal-neutral rate ${pReversalN.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pAurora - W_FA_AURORA) > 0.008) failures.push(`aurora rate ${pAurora.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pSnow - W_FA_SNOWFALL) > 0.008) failures.push(`snowfall rate ${pSnow.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pCoffee - W_FA_COFFEE) > 0.008) failures.push(`coffee rate ${pCoffee.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pMist - W_FA_MIST) > 0.008) failures.push(`mist rate ${pMist.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pHum - W_FA_HUM) > 0.008) failures.push(`humming rate ${pHum.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pSundown - W_FA_SUNDOWN) > 0.008) failures.push(`sundown rate ${pSundown.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pMint - W_FA_MINT) > 0.008) failures.push(`mint-tonic rate ${pMint.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pCrowd - W_FA_CROWD) > 0.008) failures.push(`loud-crowd rate ${pCrowd.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pEmberRain - W_FA_EMBER_RAIN) > 0.008) failures.push(`ember-rain rate ${pEmberRain.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pStarfall - W_FA_STARFALL) > 0.008) failures.push(`starfall rate ${pStarfall.toFixed(4)} != 0.02±0.008`);
  if (Math.abs(pLuck - W_FA_LUCK) > 0.008) failures.push(`luck-drip rate ${pLuck.toFixed(4)} != 0.02±0.008`);
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
  // reversal payload
  call = 0;
  m = maybeFlavorA({ seed: 7, depth: 3, align: 'bad', rng: fixed(W_FA_ENTRANCE + W_FA_TAPE + W_FA_TAUNT) });
  if (m && m.id === 'fa:reversal' && m.invertMs !== 500)
    failures.push(`reversal payload wrong: ${JSON.stringify(m)}`);
  // glitch-curse payload
  call = 0;
  m = maybeFlavorA({ seed: 7, depth: 3, align: 'bad', rng: fixed(W_FA_ENTRANCE + W_FA_TAPE + W_FA_TAUNT + W_FA_REVERSAL + W_FA_SANCTUARY) });
  if (m && m.id === 'fa:glitch-curse' && m.hpDelta !== -10)
    failures.push(`glitch-curse payload wrong: ${JSON.stringify(m)}`);
  // static-curse payload
  call = 0;
  m = maybeFlavorA({ seed: 7, depth: 3, align: 'bad', rng: fixed(W_FA_ENTRANCE + W_FA_TAPE + W_FA_TAUNT + W_FA_REVERSAL + W_FA_SANCTUARY + W_FA_GLITCH + W_FA_PYRO) });
  if (m && m.id === 'fa:static-curse' && m.hpDelta !== -8)
    failures.push(`static-curse payload wrong: ${JSON.stringify(m)}`);

  /* --- id collisions with fate.ts / cursepack.ts namespaces --- */
  const foreignIds: Record<string, true> = {
    nuke: true, midas: true, eclipse: true, toll: true, carnival_box: true,
    comet: true, poltergeist: true, lollipop: true, sticker: true,
  };
  const ownIds: Record<string, true> = {
    'fa:slam-entrance': true,
    'fa:tape-curse': true,
    'fa:brit-drizzle': true,
    'fa:taunt': true,
    'fa:reversal': true,
    'fa:sanctuary': true,
    'fa:glitch-curse': true,
    'fa:pyro-entrance': true,
    'fa:static-curse': true,
    'fa:echo': true,
    'fa:fog': true,
    'fa:thunder': true,
    'fa:quiet-blessing': true,
    'fa:taunt-neutral': true,
    'fa:reversal-neutral': true,
    'fa:aurora': true,
    'fa:slam-drop': true,
    'fa:frost-bite': true,
    'fa:mirror-taunt': true,
    'fa:hearth': true,
    'fa:rot-curse': true,
    'fa:wrong-bell': true,
    'fa:venom-curse': true,
    'fa:slow-clap': true,
    'fa:spotter': true,
    'fa:dust-storm': true,
    'fa:snowfall': true,
    'fa:coffee': true,
    'fa:mist': true,
    'fa:humming': true,
    'fa:sundown': true,
    'fa:mint-tonic': true,
    'fa:loud-crowd': true,
    'fa:ember-rain': true,
    'fa:starfall': true,
    'fa:luck-drip': true,
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
