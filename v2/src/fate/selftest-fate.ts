/* ============================================================================
 * FATE ROSTER SELFTEST — verifies the full fate event roster across
 * fate.ts / flavor-a.ts / flavor-b.ts / cursepack.ts:
 *   - every event id is unique across all files
 *   - EVERY event carries a cue
 *   - every cue is within the chaos-bus limits
 *   - bannerText is non-empty and fits the banner row (90 chars)
 *   - the event pickers are deterministic for a given (seed, depth)
 *
 * Run from v2/:
 *   node --experimental-strip-types src/fate/selftest-fate.ts
 * ==========================================================================*/

import { FATES, maybeFate, type FateCtx, type FateMod } from './fate.ts';
import { maybeFlavorA, type FlavorMod } from './flavor-a.ts';
import { COUNTRIES, maybeFlavorB, type CountryMod } from './flavor-b.ts';
import { CURSES, BLESSINGS, maybeCurse, type CurseMod } from './cursepack.ts';

/** Banner row: main.ts toastNow slices to 90 chars (panel 920x40). */
const BANNER_MAX = 90;

/** Chaos-bus limits (mirrors v2/src/fx/chaos.ts — data limits, not the bus). */
const FLASH_MAX_MS = 200;
const SHAKE_MAX_AMP = 1;
const MAX_EMBERS = 64;

type AnyMod = FateMod | FlavorMod | CountryMod | CurseMod;

interface Cue {
  shake?: { intensity: number; ms: number };
  glitch?: number;
  flash?: { color: number; ms: number };
  embers?: number;
  scanlines?: boolean;
  melt?: number;
  invert?: number;
}

/** Collect every event in the roster (factories + inline roll outcomes). */
function collectEvents(): AnyMod[] {
  const out: AnyMod[] = [];
  for (const f of FATES) out.push(f());
  for (const f of COUNTRIES) out.push(f());
  for (const f of CURSES) out.push(f());
  for (const f of BLESSINGS) out.push(f());
  // Inline events produced by the roll functions (not in factory tables).
  // Cues mirror the inline objects in fate.ts maybeFate().
  out.push({ id: 'lollipop', kind: 'blessing', bannerText: '🍭 LOLLIPOP — A SWEET TOKEN YOURS',
    cue: { flash: { color: 0xff9ecf, ms: 150 } } });
  out.push({ id: 'sticker', kind: 'blessing', bannerText: '🌟 STICKER — WEAR IT PROUDLY',
    cue: { flash: { color: 0xfff2a8, ms: 150 }, embers: 12 } });
  out.push({ id: 'nuke', kind: 'nuke', bannerText: '☢ NUKE — EVERYONE LEFT AT 1 HP · NEXT ROUND FORCED GOOD',
    cue: { flash: { color: 0xff3030, ms: 200 }, shake: { intensity: 1, ms: 600 } } });
  // flavor-a.ts inline events (16 total)
  out.push({ id: 'fa:slam-entrance', kind: 'entrance', bannerText: '⚔ ENTRANCE: THE PAPER TITAN — "READ A DICTIONARY COVER TO COVER"',
    cue: { shake: { intensity: 0.8, ms: 900 } } });
  out.push({ id: 'fa:tape-curse', kind: 'curse', bannerText: '📼 THE UNLABELED TAPE PLAYS — WATCH (5S) OR HP −15',
    cue: { glitch: 400, scanlines: true } });
  out.push({ id: 'fa:taunt', kind: 'taunt', bannerText: '🗤 TAUNT: "YOU CALLED THAT A STRATEGY?"',
    cue: { glitch: 200 } });
  out.push({ id: 'fa:reversal', kind: 'reversal', bannerText: '🔄 REVERSAL — CONTROLS INVERTED FOR 500ms',
    cue: { invert: 500, shake: { intensity: 0.4, ms: 400 } } });
  out.push({ id: 'fa:sanctuary', kind: 'sanctuary', bannerText: '✨ SANCTUARY — A MOMENT OF CALM (COSMETIC)',
    cue: { flash: { color: 0x44ff88, ms: 150 }, embers: 16 } });
  out.push({ id: 'fa:glitch-curse', kind: 'curse', bannerText: '🗸 GLITCH CURSE — SCREEN CORRUPTS (HP −10)',
    cue: { glitch: 600, scanlines: true } });
  out.push({ id: 'fa:pyro-entrance', kind: 'entrance', bannerText: '🔥 PYRO ENTRANCE: LORD HUSTLEBUCK CATCHES FIRE',
    cue: { shake: { intensity: 0.9, ms: 800 }, embers: 32 } });
  out.push({ id: 'fa:static-curse', kind: 'curse', bannerText: '📡 STATIC CURSE — SIGNAL LOST (HP −8)',
    cue: { glitch: 800, scanlines: true } });
  out.push({ id: 'fa:echo', kind: 'taunt', bannerText: '🕊 ECHO — YOUR TAUNTS BOUNCE BACK',
    cue: { glitch: 300, embers: 6 } });
  out.push({ id: 'fa:brit-drizzle', kind: 'weather', bannerText: 'MIND THE DRIZZLE.',
    cue: { scanlines: true, embers: 8 } });
  out.push({ id: 'fa:fog', kind: 'weather', bannerText: '🌫 FOG ROLLS IN — VISIBILITY DROPS (COSMETIC)',
    cue: { scanlines: true, embers: 4 } });
  out.push({ id: 'fa:thunder', kind: 'weather', bannerText: '⚡ THUNDER — A DISTANT RUMBLE',
    cue: { flash: { color: 0xffffff, ms: 100 }, shake: { intensity: 0.5, ms: 300 } } });
  out.push({ id: 'fa:quiet-blessing', kind: 'blessing', bannerText: '🔀 QUIET BLESSING — A SMALL FORTUNE (COSMETIC)',
    cue: { flash: { color: 0x88ffcc, ms: 120 }, embers: 10 } });
  out.push({ id: 'fa:taunt-neutral', kind: 'taunt', bannerText: '🎭 TAUNT: "NOT BAD. FOR A TUESDAY."',
    cue: { glitch: 150 } });
  out.push({ id: 'fa:reversal-neutral', kind: 'reversal', bannerText: '🔀 REVERSAL — BRIEF INVERSION (400ms)',
    cue: { invert: 400 } });
  out.push({ id: 'fa:aurora', kind: 'weather', bannerText: '🌌 AURORA — THE SKY DANCES (COSMETIC)',
    cue: { flash: { color: 0x44ffaa, ms: 180 }, embers: 20 } });
  return out;
}

/** Validate one cue against the bus limits. Throws on violation. */
function assertCueWithinLimits(id: string, cue: Cue): void {
  if (cue.shake !== undefined) {
    if (!(cue.shake.intensity >= 0 && cue.shake.intensity <= SHAKE_MAX_AMP))
      throw new Error(`${id}: shake.intensity ${cue.shake.intensity} outside 0..${SHAKE_MAX_AMP}`);
    if (!(cue.shake.ms > 0)) throw new Error(`${id}: shake.ms must be > 0`);
  }
  if (cue.glitch !== undefined && !(cue.glitch > 0))
    throw new Error(`${id}: glitch ms must be > 0`);
  if (cue.flash !== undefined) {
    if (!(cue.flash.ms > 0 && cue.flash.ms <= FLASH_MAX_MS))
      throw new Error(`${id}: flash.ms ${cue.flash.ms} outside 0..${FLASH_MAX_MS}`);
    if (!(Number.isInteger(cue.flash.color) && cue.flash.color >= 0 && cue.flash.color <= 0xffffff))
      throw new Error(`${id}: flash.color ${cue.flash.color} not a 0x000000..0xffffff int`);
  }
  if (cue.embers !== undefined && !(cue.embers >= 0 && cue.embers <= MAX_EMBERS))
    throw new Error(`${id}: embers ${cue.embers} outside 0..${MAX_EMBERS}`);
  if (cue.melt !== undefined && !(cue.melt >= 0 && cue.melt <= 1))
    throw new Error(`${id}: melt ${cue.melt} outside 0..1`);
  if (cue.invert !== undefined && !(cue.invert > 0))
    throw new Error(`${id}: invert ms must be > 0`);
}

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  function check(name: string, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
  }

  const events = collectEvents();

  check(`roster non-empty (${events.length} events)`, () => {
    assert(events.length >= 20, `expected >= 20 events, got ${events.length}`);
  });

  check(`every event id unique across all files (${events.length} events)`, () => {
    const seen = new Map<string, string>();
    for (const ev of events) {
      assert(typeof ev.id === 'string' && ev.id.length > 0, 'empty event id');
      if (seen.has(ev.id)) throw new Error(`duplicate id "${ev.id}"`);
      seen.set(ev.id, ev.id);
    }
  });

  check(`EVERY event has a cue`, () => {
    for (const ev of events) {
      assert(ev.cue !== undefined, `${ev.id} has no cue`);
    }
  });

  check(`every cue within bus limits (flash<=${FLASH_MAX_MS}ms, shake<=${SHAKE_MAX_AMP}, embers<=${MAX_EMBERS})`, () => {
    for (const ev of events) {
      assertCueWithinLimits(ev.id, ev.cue as Cue);
    }
  });

  check(`bannerText non-empty and fits the banner row (<=${BANNER_MAX} chars)`, () => {
    for (const ev of events) {
      assert(typeof ev.bannerText === 'string' && ev.bannerText.length > 0, `${ev.id}: empty bannerText`);
      assert(ev.bannerText.length <= BANNER_MAX, `${ev.id}: bannerText ${ev.bannerText.length} chars > ${BANNER_MAX}`);
    }
  });

  // --- Picker determinism: same (seed, depth) => identical outcome ----------
  const SEEDS = [1, 7, 42, 1337, 0xdeadbeef];
  const DEPTHS = [3, 5, 8, 12, 20];
  const ALIGNS: FateCtx['align'][] = ['good', 'neutral', 'bad', 'chaotic'];

  function pickAll(seed: number, depth: number, align: FateCtx['align']): string {
    const ctx: FateCtx = { seed, depth, align, hp: 50 };
    const f = maybeFate(ctx);
    const a = maybeFlavorA(ctx);
    const b = maybeFlavorB(ctx);
    const c = maybeCurse(ctx);
    return JSON.stringify([f?.id ?? null, a?.id ?? null, b?.id ?? null, c?.id ?? null]);
  }

  check(`pickers deterministic for a given (seed, depth) over ${SEEDS.length * DEPTHS.length * ALIGNS.length} cases`, () => {
    for (const seed of SEEDS) {
      for (const depth of DEPTHS) {
        for (const align of ALIGNS) {
          const first = pickAll(seed, depth, align);
          for (let rep = 0; rep < 3; rep++) {
            assert(pickAll(seed, depth, align) === first,
              `seed=${seed} depth=${depth} align=${align} not deterministic`);
          }
        }
      }
    }
  });

  return { ok: failures.length === 0, failures };
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  Boolean(
    process.argv[1] &&
      /selftest-fate(\.ts)?$/.test(process.argv[1].replace(/\\/g, '/'))
  );

if (isMain) {
  const res = selfTest();
  if (res.ok) {
    console.log('[fate-selftest] ALL PASS');
    process.exit(0);
  } else {
    for (const f of res.failures) console.error('  FAIL ' + f);
    process.exit(1);
  }
}
