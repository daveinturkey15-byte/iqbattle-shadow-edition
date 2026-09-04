/**
 * PACK: BRITISH INCONVENIENCE — Cyclists, queues, shouting, wobbly pink nuisances and dry apology.
 *
 * Pure data. See src/fate/pack-kit.ts for the contract: every event ships a
 * banner + a non-empty chaos-bus cue + optional riders. Text-only is not done.
 * Ids are namespaced 'pk:brit:<slug>'.
 *
 * Tone: understated, passive-aggressive, nothing is ever quite said out loud.
 * All personas are invented — no real people, shows, characters or companies.
 * WOBBLETON is an original large pink nuisance and resembles nobody.
 */

import { type PackDef } from '../pack-kit.ts';

export const PACK_BRIT: PackDef = {
  id: 'brit',
  title: 'BRITISH INCONVENIENCE',
  events: [
    /* --- mild, common, heavy weight ---------------------------------- */
    {
      id: 'pk:brit:cyclist',
      kind: 'nuisance',
      bannerText: '🚲 A CYCLIST IS IN THE WAY. HE HAS OPINIONS ABOUT THE BOARD.',
      aligns: ['neutral', 'bad'],
      minDepth: 3,
      weight: 1.8,
      cue: { glitch: 200, shake: { intensity: 0.18, ms: 300 } },
      scoreMul: 0.9,
    },
    {
      id: 'pk:brit:queue',
      kind: 'nuisance',
      bannerText: '🧍 A QUEUE HAS FORMED BEHIND YOU. NOBODY WILL SAY ANYTHING.',
      aligns: ['neutral', 'bad'],
      minDepth: 3,
      weight: 1.7,
      cue: { scanlines: true, glitch: 150 },
      scoreMul: 0.85,
    },
    {
      id: 'pk:brit:tutting',
      kind: 'disapproval',
      bannerText: '😒 SOMEONE TUTS. NO FURTHER ACTION IS TAKEN. IT IS ENOUGH.',
      aligns: ['neutral', 'bad'],
      minDepth: 4,
      weight: 1.6,
      cue: { glitch: 120 },
      hpDelta: -3,
    },

    /* --- the two kind ones (good rounds may fire these) --------------- */
    {
      id: 'pk:brit:apology',
      kind: 'kindness',
      bannerText: '🙇 SOMEONE APOLOGISES TO YOU. THEY DID NOTHING WRONG AT ALL.',
      aligns: ['good', 'neutral'],
      minDepth: 3,
      weight: 1.5,
      cue: { flash: { color: 0xffe6b0, ms: 140 }, embers: 6 },
      hpDelta: 5,
    },
    {
      id: 'pk:brit:kettle',
      kind: 'kindness',
      bannerText: '🫖 THE KETTLE HAS BOILED. TAKE THE MOMENT. NOBODY EARNED IT.',
      aligns: ['good', 'neutral'],
      minDepth: 5,
      weight: 1.2,
      cue: { flash: { color: 0xffb266, ms: 180 }, embers: 10 },
      hpDelta: 6,
      scoreMul: 1.1,
    },

    /* --- middling annoyances ------------------------------------------ */
    {
      id: 'pk:brit:pigeon',
      kind: 'wildlife',
      bannerText: '🐦 A PIGEON HAS LANDED ON THE BOARD. IT IS UNIMPRESSED.',
      aligns: ['neutral', 'chaotic'],
      minDepth: 4,
      weight: 1.3,
      cue: { shake: { intensity: 0.25, ms: 250 }, embers: 8 },
    },
    {
      id: 'pk:brit:roadworks',
      kind: 'nuisance',
      bannerText: '🚧 ROADWORKS. THREE CONES, NO WORKERS, NO END DATE GIVEN.',
      aligns: ['bad', 'neutral'],
      minDepth: 6,
      weight: 1.1,
      cue: { melt: 0.2, scanlines: true },
      scoreMul: 0.8,
    },
    {
      id: 'pk:brit:shouting',
      kind: 'nuisance',
      bannerText: '📣 LONDON IS SHOUTING AT YOU. IT IS NOT CLEAR WHY. IT NEVER IS.',
      aligns: ['bad', 'chaotic'],
      minDepth: 5,
      weight: 1.0,
      cue: { glitch: 500, shake: { intensity: 0.45, ms: 500 } },
      hpDelta: -6,
    },

    /* --- the loud ones, late and rare --------------------------------- */
    {
      id: 'pk:brit:replacement-bus',
      kind: 'transport',
      bannerText: '🚌 RAIL REPLACEMENT SERVICE — EVERY CONTROL NOW RUNS IN REVERSE.',
      aligns: ['bad', 'chaotic'],
      minDepth: 8,
      weight: 0.7,
      cue: { invert: 900, glitch: 300, shake: { intensity: 0.3, ms: 400 } },
      scoreMul: 1.25,
    },
    {
      id: 'pk:brit:heatwave',
      kind: 'weather',
      bannerText: '☀ 24 DEGREES. A NATIONAL EMERGENCY IS DECLARED. STAY INDOORS.',
      aligns: ['chaotic', 'bad'],
      minDepth: 9,
      weight: 0.8,
      cue: { flash: { color: 0xffcc33, ms: 200 }, embers: 28, melt: 0.3 },
      hpDelta: -8,
      scoreMul: 1.4,
    },
    {
      id: 'pk:brit:wobbleton',
      kind: 'nuisance',
      bannerText: '💗 WOBBLETON IS HERE. HE IS PINK. HE HAS KNOCKED THE BOARD OVER.',
      aligns: ['chaotic', 'bad'],
      minDepth: 11,
      weight: 0.5,
      cue: { shake: { intensity: 0.85, ms: 800 }, melt: 0.5, glitch: 450 },
      hpDelta: -10,
      scoreMul: 1.5,
    },
  ],
};
