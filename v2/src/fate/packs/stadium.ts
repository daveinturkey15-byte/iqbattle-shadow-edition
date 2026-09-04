/**
 * PACK: THE STADIUM — Crowd events inside the parody arena — the run-in, the count, the belt.
 *
 * Pure data. See src/fate/pack-kit.ts for the contract: every event ships a
 * banner + a non-empty chaos-bus cue + optional riders. Text-only is not done.
 * Ids are namespaced 'pk:stadium:<slug>'.
 *
 * flavor-a.ts owns the ENTRANCES and its own six personas. This pack is what
 * happens after the bell. Every persona here is invented and original — no
 * real wrestlers, promotions, shows or companies, and no overlap with the
 * flavor-a roster.
 */

import { type PackDef } from '../pack-kit.ts';

export const PACK_STADIUM: PackDef = {
  id: 'stadium',
  title: 'THE STADIUM',
  events: [
    /* --- crowd noise: mild, common, heavy weight ---------------------- */
    {
      id: 'pk:stadium:chant',
      kind: 'crowd',
      bannerText: '🗣 A CHANT STARTS. IT IS ABOUT YOU. IT DOES NOT RHYME KINDLY.',
      aligns: ['neutral', 'bad'],
      minDepth: 3,
      weight: 1.8,
      cue: { glitch: 220 },
      hpDelta: -4,
    },
    {
      id: 'pk:stadium:botched-spot',
      kind: 'crowd',
      bannerText: '🤕 A SPOT GOES WRONG. EVERYONE AGREES TO PRETEND IT DID NOT.',
      aligns: ['neutral', 'chaotic'],
      minDepth: 3,
      weight: 1.7,
      cue: { scanlines: true, glitch: 300 },
      scoreMul: 0.95,
    },
    {
      id: 'pk:stadium:manager-apron',
      kind: 'interference',
      bannerText: '🎩 MADAME COMMISSION CLIMBS THE APRON. THE OFFICIAL LOOKS AWAY.',
      aligns: ['neutral', 'bad'],
      minDepth: 4,
      weight: 1.5,
      cue: { glitch: 260, shake: { intensity: 0.2, ms: 220 } },
      scoreMul: 0.9,
    },

    /* --- the two that can land on a good round ------------------------ */
    {
      id: 'pk:stadium:two-count',
      kind: 'nearfall',
      bannerText: '🖐 THE THREE-COUNT GOES TO TWO. THE CROWD EXHALES. YOU LIVE.',
      aligns: ['good', 'neutral'],
      minDepth: 3,
      weight: 1.6,
      cue: { flash: { color: 0xffffff, ms: 110 }, shake: { intensity: 0.35, ms: 260 } },
      hpDelta: 4,
    },
    {
      id: 'pk:stadium:belt-up',
      kind: 'gold',
      bannerText: '🏆 THE BELT GOES UP. THE LIGHTS FIND YOU. HOLD IT WHILE IT LASTS.',
      aligns: ['good', 'neutral'],
      minDepth: 6,
      weight: 1.1,
      cue: { flash: { color: 0xffd24a, ms: 190 }, embers: 24 },
      hpDelta: 8,
      scoreMul: 1.15,
    },

    /* --- the match turns against you ---------------------------------- */
    {
      id: 'pk:stadium:crowd-turns',
      kind: 'crowd',
      bannerText: '📢 THE CROWD HAS TURNED ON YOU. THEY WERE NEVER WITH YOU.',
      aligns: ['bad', 'neutral'],
      minDepth: 5,
      weight: 1.3,
      cue: { scanlines: true, shake: { intensity: 0.3, ms: 500 } },
      scoreMul: 0.8,
    },
    {
      id: 'pk:stadium:countout',
      kind: 'referee',
      bannerText: '🔢 THE COUNT REACHES NINE. YOU ARE STILL OUTSIDE THE RING.',
      aligns: ['bad', 'chaotic'],
      minDepth: 6,
      weight: 1.2,
      cue: { glitch: 420, melt: 0.2 },
      hpDelta: -9,
    },
    {
      id: 'pk:stadium:run-in',
      kind: 'interference',
      bannerText: '🏃 RUN-IN FROM THE BACK — THE VELVET LARIAT IS NOT ON THE CARD.',
      aligns: ['bad', 'chaotic'],
      minDepth: 7,
      weight: 1.0,
      cue: { shake: { intensity: 0.65, ms: 600 }, embers: 12 },
      hpDelta: -12,
    },
    {
      id: 'pk:stadium:chair',
      kind: 'weapon',
      bannerText: '🪑 A CHAIR COMES OUT FROM UNDER THE RING. NOBODY SAW WHO.',
      aligns: ['bad', 'chaotic'],
      minDepth: 8,
      weight: 0.9,
      cue: { flash: { color: 0xff4422, ms: 120 }, shake: { intensity: 0.7, ms: 350 } },
      hpDelta: -14,
      scoreMul: 1.2,
    },

    /* --- the big two, late and rare ------------------------------------ */
    {
      id: 'pk:stadium:heel-turn',
      kind: 'betrayal',
      bannerText: '🔃 THE HEEL TURN — ALLEGIANCES SWAP. SO DO YOUR CONTROLS.',
      aligns: ['chaotic', 'bad'],
      minDepth: 10,
      weight: 0.6,
      cue: { invert: 800, glitch: 350, flash: { color: 0x2244ff, ms: 130 } },
      scoreMul: 1.5,
    },
    {
      id: 'pk:stadium:table',
      kind: 'weapon',
      bannerText: '🪵 A TABLE IS SET UP AT RINGSIDE. IT WILL NOT BE USED KINDLY.',
      aligns: ['chaotic', 'bad'],
      minDepth: 12,
      weight: 0.5,
      cue: { shake: { intensity: 0.95, ms: 700 }, embers: 40, melt: 0.35 },
      hpDelta: -15,
      scoreMul: 1.7,
    },
  ],
};
