/**
 * PACK: THE STONES AND THE TEMPLE — Six coloured stones, a gauntlet, and the temple that guards them.
 *
 * Pure data. See src/fate/pack-kit.ts for the contract: every event ships a
 * banner + a non-empty chaos-bus cue + optional riders. Text-only is not done.
 * Ids are namespaced 'pk:stones:<slug>'.
 *
 * Parody only: a colour, a glove and a very calm man with a plan. No names.
 */

import { type PackDef } from '../pack-kit.ts';

export const PACK_STONES: PackDef = {
  id: 'stones',
  title: 'THE STONES AND THE TEMPLE',
  events: [
    /* ---- the six stones ------------------------------------------------ */
    {
      id: 'pk:stones:violet-set',
      kind: 'stone',
      bannerText: '🟣 THE VIOLET STONE SETS — HALF YOUR SCORE, HALF YOUR PATIENCE',
      aligns: ['bad', 'chaotic'],
      minDepth: 7,
      weight: 0.6,
      cue: { flash: { color: 0xaa66ff, ms: 160 }, melt: 0.35 },
      scoreMul: 0.75,
    },
    {
      id: 'pk:stones:azure-step',
      kind: 'stone',
      bannerText: '🔵 THE AZURE STONE OPENS A DOOR YOU DID NOT ASK FOR',
      aligns: ['chaotic', 'neutral'],
      minDepth: 4,
      weight: 1.4,
      cue: { glitch: 380, flash: { color: 0x3388ff, ms: 90 } },
    },
    {
      id: 'pk:stones:crimson-lie',
      kind: 'stone',
      bannerText: '🔴 THE CRIMSON STONE REWRITES THE QUESTION MID-SENTENCE',
      aligns: ['bad', 'chaotic'],
      minDepth: 5,
      weight: 1,
      cue: { glitch: 620, scanlines: true },
      hpDelta: -8,
    },
    {
      id: 'pk:stones:amber-toll',
      kind: 'stone',
      bannerText: '🟠 THE AMBER STONE WANTS SOMEONE YOU LOVE. IT SETTLES FOR HP.',
      aligns: ['bad'],
      minDepth: 9,
      weight: 0.5,
      cue: { embers: 28, flash: { color: 0xff9933, ms: 140 } },
      hpDelta: -16,
    },
    {
      id: 'pk:stones:gold-mind',
      kind: 'stone',
      bannerText: '🟡 THE GOLD STONE READS YOUR MIND AND FINDS A SHOPPING LIST',
      aligns: ['neutral', 'good'],
      minDepth: 3,
      weight: 1.9,
      cue: { embers: 12, scanlines: true },
    },
    {
      id: 'pk:stones:emerald-rewind',
      kind: 'stone',
      bannerText: '🟢 THE EMERALD STONE REWINDS THE BAD BIT — YOU LOOK CLEVER',
      aligns: ['good', 'neutral'],
      minDepth: 4,
      weight: 1.3,
      cue: { flash: { color: 0x55ee99, ms: 120 }, embers: 10 },
      hpDelta: 8,
    },

    /* ---- the glove and the man wearing it ------------------------------ */
    {
      id: 'pk:stones:jewelled-glove',
      kind: 'gauntlet',
      bannerText: '🧤 THE JEWELLED GLOVE FITS. OF COURSE IT DOES. IT ALWAYS DOES.',
      aligns: ['bad', 'chaotic'],
      minDepth: 8,
      weight: 0.7,
      cue: { shake: { intensity: 0.85, ms: 700 }, flash: { color: 0xffcc44, ms: 150 } },
      hpDelta: -12,
    },
    {
      id: 'pk:stones:reasonable-tyrant',
      kind: 'tyrant',
      bannerText: '👑 THE TYRANT EXPLAINS HIS PLAN. CALMLY. AT SOME LENGTH.',
      aligns: ['bad', 'chaotic', 'neutral'],
      minDepth: 6,
      weight: 1.1,
      cue: { melt: 0.2, scanlines: true },
      scoreMul: 0.9,
    },

    /* ---- the temple that keeps them ------------------------------------ */
    {
      id: 'pk:stones:rolling-boulder',
      kind: 'temple',
      bannerText: '🪨 BOULDER. CORRIDOR. NO SIDE PASSAGES. RUN, THEN.',
      aligns: ['bad', 'chaotic'],
      minDepth: 5,
      weight: 1.2,
      cue: { shake: { intensity: 0.95, ms: 900 }, embers: 8 },
      hpDelta: -10,
    },
    {
      id: 'pk:stones:weighing-floor',
      kind: 'temple',
      bannerText: '⚖ THE FLOOR WEIGHS YOU AND IS DISAPPOINTED BY THE RESULT',
      aligns: ['neutral', 'chaotic'],
      minDepth: 3,
      weight: 1.7,
      cue: { shake: { intensity: 0.3, ms: 500 }, scanlines: true },
    },
    {
      id: 'pk:stones:swapped-idol',
      kind: 'temple',
      bannerText: '🗿 IDOL SWAPPED FOR A BAG OF SAND — YOUR CONTROLS SWAP TOO',
      aligns: ['chaotic'],
      minDepth: 11,
      weight: 0.5,
      cue: { invert: 900, shake: { intensity: 0.5, ms: 450 }, glitch: 260 },
    },
  ],
};
