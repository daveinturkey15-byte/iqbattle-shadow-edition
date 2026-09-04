/**
 * PACK: THE DEEP BLUE — Dolphins that help, sharks that do not, and everything under the shelf.
 *
 * Pure data. See src/fate/pack-kit.ts for the contract: every event ships a
 * banner + a non-empty chaos-bus cue + optional riders. Text-only is not done.
 * Ids are namespaced 'pk:deep-blue:<slug>'.
 *
 * TONE: terse, uppercase, dark British comedy. The owner's pairing is load
 * bearing — DOLPHINS ARE GOOD, SHARKS ARE BAD — so this pack is one of the
 * run's main suppliers of relief: two warm dolphin events sit on 'good' rounds
 * with positive hp, and everything that bites is kept off 'good' entirely.
 */

import { type PackDef } from '../pack-kit.ts';

export const PACK_DEEP_BLUE: PackDef = {
  id: 'deep-blue',
  title: 'THE DEEP BLUE',
  events: [
    /* ---- relief: the dolphins ---------------------------------------- */
    {
      id: 'pk:deep-blue:pod-escort',
      kind: 'dolphin',
      bannerText: '🐬 A POD ESCORTS YOU THROUGH THE DARK WATER (HP +8)',
      aligns: ['good', 'neutral'],
      minDepth: 3,
      weight: 1.8,
      cue: { flash: { color: 0x66ddff, ms: 130 }, embers: 12 },
      hpDelta: 8,
    },
    {
      id: 'pk:deep-blue:dolphin-nudge',
      kind: 'dolphin',
      bannerText: '🐬 SOMETHING KIND NUDGES YOU BACK TOWARD THE LIGHT (HP +5)',
      aligns: ['good'],
      minDepth: 4,
      weight: 1.5,
      cue: { flash: { color: 0x9beeff, ms: 110 }, embers: 20 },
      hpDelta: 5,
    },

    /* ---- neutral water ------------------------------------------------ */
    {
      id: 'pk:deep-blue:slack-tide',
      kind: 'tide',
      bannerText: '🌫 SLACK TIDE. EVERYTHING WAITS, POLITELY, TO SEE WHAT YOU DO.',
      aligns: ['neutral'],
      minDepth: 3,
      weight: 1.6,
      cue: { scanlines: true, embers: 6 },
    },
    {
      id: 'pk:deep-blue:whale-call',
      kind: 'whale',
      bannerText: '🐋 A CALL ARRIVES FROM SIX MILES OFF. IT IS NOT FOR YOU.',
      aligns: ['neutral', 'good'],
      minDepth: 4,
      weight: 1.3,
      cue: { shake: { intensity: 0.18, ms: 900 }, scanlines: true },
    },
    {
      id: 'pk:deep-blue:bioluminescence',
      kind: 'bloom',
      bannerText: '✨ BIOLUMINESCENCE — THE DARK LIGHTS UP AND SO DO YOU (SCORE ×1.3)',
      aligns: ['neutral', 'good', 'chaotic'],
      minDepth: 5,
      weight: 1.1,
      cue: { embers: 40, flash: { color: 0x33ffbb, ms: 140 } },
      scoreMul: 1.3,
    },
    {
      id: 'pk:deep-blue:shelf-edge',
      kind: 'shelf',
      bannerText: '🌊 THE SHELF ENDS. THE FLOOR DOES NOT RESUME.',
      aligns: ['neutral', 'bad'],
      minDepth: 5,
      weight: 1.0,
      cue: { melt: 0.3, scanlines: true },
    },

    /* ---- the water that bites ----------------------------------------- */
    {
      id: 'pk:deep-blue:shark-pass',
      kind: 'shark',
      bannerText: '🦈 A GREY SHAPE TURNS AND COMES BACK (HP −12)',
      aligns: ['bad', 'chaotic'],
      minDepth: 3,
      weight: 0.9,
      cue: { shake: { intensity: 0.72, ms: 520 }, flash: { color: 0xcc2233, ms: 90 } },
      hpDelta: -12,
    },
    {
      id: 'pk:deep-blue:the-pressure',
      kind: 'pressure',
      bannerText: '🫧 THE PRESSURE FINDS YOUR FILLINGS (HP −9)',
      aligns: ['bad'],
      minDepth: 6,
      weight: 0.85,
      cue: { melt: 0.55, shake: { intensity: 0.35, ms: 700 } },
      hpDelta: -9,
    },
    {
      id: 'pk:deep-blue:passing-under',
      kind: 'leviathan',
      bannerText: '🕳 SOMETHING ENORMOUS PASSES UNDER YOU. IT DOES NOT HURRY. (HP −6)',
      aligns: ['bad', 'chaotic'],
      minDepth: 7,
      weight: 0.8,
      cue: { shake: { intensity: 0.5, ms: 1400 }, melt: 0.2, glitch: 260 },
      hpDelta: -6,
    },
    {
      id: 'pk:deep-blue:jelly-bloom',
      kind: 'jellyfish',
      bannerText: '🪼 A JELLYFISH BLOOM. YOUR CONTROLS SWIM BACKWARD FOR 900ms',
      aligns: ['chaotic'],
      minDepth: 8,
      weight: 0.6,
      cue: { invert: 900, glitch: 500, embers: 28 },
    },
    {
      id: 'pk:deep-blue:the-trench',
      kind: 'trench',
      bannerText: '🌑 THE TRENCH OPENS. NOTHING DOWN THERE HAS EYES. (HP −15)',
      aligns: ['bad', 'chaotic'],
      minDepth: 11,
      weight: 0.5,
      cue: { melt: 0.85, scanlines: true, shake: { intensity: 0.6, ms: 1100 } },
      hpDelta: -15,
    },
  ],
};
