/**
 * PACK: DREAD ICONS — Parody horror icons — the puzzle-box, the dream-blade, the tape, the hive.
 *
 * Pure data. See src/fate/pack-kit.ts for the contract: every event ships a
 * banner + a non-empty chaos-bus cue + optional riders. Text-only is not done.
 * Ids are namespaced 'pk:dread:<slug>'.
 *
 * PARODY RULE. Every figure here is an original invention that merely evokes a
 * familiar shape. No franchise names, no character names, no titles from any
 * published work, no real people — the reference lives in the imagery only.
 */

import { type PackDef } from '../pack-kit.ts';

export const PACK_DREAD: PackDef = {
  id: 'dread',
  title: 'DREAD ICONS',
  events: [
    {
      id: 'pk:dread:cheap-sequel',
      kind: 'dread',
      bannerText: '🎬 THE SEQUEL NOBODY ASKED FOR — SAME MASK, WORSE BUDGET',
      aligns: ['neutral', 'chaotic'],
      minDepth: 3,
      weight: 1.8,
      cue: { scanlines: true, glitch: 250 },
    },
    {
      id: 'pk:dread:storm-drain-balloon',
      kind: 'dread',
      bannerText: '🎈 A RED BALLOON RISES FROM THE DRAIN — NOBODY IS HOLDING IT',
      aligns: ['neutral', 'bad'],
      minDepth: 4,
      weight: 1.5,
      cue: { embers: 12, glitch: 200 },
    },
    {
      id: 'pk:dread:last-one-standing',
      kind: 'dread',
      bannerText: '🔦 THE LAST ONE STANDING SHARES HER TORCH — HP +10',
      aligns: ['good', 'neutral'],
      minDepth: 5,
      weight: 1.2,
      cue: { flash: { color: 0xffee99, ms: 130 }, embers: 14 },
      hpDelta: 10,
    },
    {
      id: 'pk:dread:knife-fingered-lodger',
      kind: 'dread',
      bannerText: '💤 THE KNIFE-FINGERED LODGER VISITS WHEN YOU BLINK (HP −8)',
      aligns: ['bad', 'chaotic'],
      minDepth: 5,
      weight: 1.0,
      cue: { scanlines: true, glitch: 450 },
      hpDelta: -8,
    },
    {
      id: 'pk:dread:unowned-tape',
      kind: 'dread',
      bannerText: '📼 A TAPE NOBODY OWNS PLAYS ITSELF — SEVEN ROUNDS, ROUGHLY',
      aligns: ['chaotic', 'bad'],
      minDepth: 6,
      weight: 0.9,
      cue: { glitch: 800, scanlines: true, melt: 0.25 },
      hpDelta: -5,
    },
    {
      id: 'pk:dread:folding-toy',
      kind: 'dread',
      bannerText: '🧩 THE FOLDING TOY OPENS ITSELF — NOBODY TOUCHED IT (HP −10)',
      aligns: ['bad', 'chaotic'],
      minDepth: 7,
      weight: 0.7,
      cue: { shake: { intensity: 0.5, ms: 600 }, flash: { color: 0x881122, ms: 150 } },
      hpDelta: -10,
    },
    {
      id: 'pk:dread:mirror-side',
      kind: 'dread',
      bannerText: '🪞 YOU SLIP TO THE MIRROR SIDE — CONTROLS INVERTED, BRIEFLY',
      aligns: ['chaotic'],
      minDepth: 7,
      weight: 0.7,
      cue: { invert: 800, glitch: 300 },
    },
    {
      id: 'pk:dread:hollow-below',
      kind: 'dread',
      bannerText: '🙃 THE HOLLOW BELOW SHOWS THROUGH — A FACELESS THING FACES YOU',
      aligns: ['chaotic', 'bad'],
      minDepth: 8,
      weight: 0.6,
      cue: { melt: 0.6, flash: { color: 0x110022, ms: 160 }, shake: { intensity: 0.3, ms: 400 } },
      hpDelta: -6,
    },
    {
      id: 'pk:dread:vent-bleeder',
      kind: 'dread',
      bannerText: '🥚 SOMETHING IN THE VENTS BLEEDS THROUGH THE FLOOR (HP −11)',
      aligns: ['bad'],
      minDepth: 9,
      weight: 0.5,
      cue: { melt: 0.45, shake: { intensity: 0.6, ms: 650 } },
      hpDelta: -11,
    },
    {
      id: 'pk:dread:gentleman-of-pins',
      kind: 'dread',
      bannerText: '📌 THE GENTLEMAN OF PINS WOULD LIKE TO SHOW YOU SOMETHING (−14)',
      aligns: ['bad'],
      minDepth: 9,
      weight: 0.5,
      cue: { melt: 0.5, glitch: 700 },
      hpDelta: -14,
    },
    {
      id: 'pk:dread:brood-mother',
      kind: 'dread',
      bannerText: '🕷 THE BROOD MOTHER RATES YOUR PERFORMANCE — SCORE ×0.8',
      aligns: ['bad', 'chaotic'],
      minDepth: 10,
      weight: 0.5,
      cue: { scanlines: true, embers: 10 },
      scoreMul: 0.8,
    },
  ],
};
