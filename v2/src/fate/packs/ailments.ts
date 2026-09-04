/**
 * PACK: AILMENTS — Afflictions that cost you health — original ailments, no real diseases named.
 *
 * Pure data. See src/fate/pack-kit.ts for the contract: every event ships a
 * banner + a non-empty chaos-bus cue + optional riders. Text-only is not done.
 * Ids are namespaced 'pk:ailments:<slug>'.
 *
 * CONTENT RULE: every affliction here is invented for this world. No real
 * illness, no real person, no brand. The joke is always on the contestant and
 * on the building, never on anyone who is actually ill.
 */

import { type PackDef } from '../pack-kit.ts';

export const PACK_AILMENTS: PackDef = {
  id: 'ailments',
  title: 'AILMENTS',
  events: [
    {
      id: 'pk:ailments:the-itch',
      kind: 'ailment',
      bannerText: 'THE ITCH — IT MOVES WHEN YOU LOOK AT IT (HP −4)',
      aligns: ['bad', 'chaotic', 'neutral'],
      minDepth: 3,
      weight: 2,
      cue: { glitch: 220 },
      hpDelta: -4,
    },
    {
      id: 'pk:ailments:tin-tonic',
      kind: 'relief',
      bannerText: 'THE TIN TONIC — BITTER, HONEST, IT WORKS (HP +10)',
      aligns: ['good', 'neutral'],
      minDepth: 3,
      weight: 1.6,
      cue: { flash: { color: 0x66ffbb, ms: 130 }, embers: 12 },
      hpDelta: 10,
    },
    {
      id: 'pk:ailments:sugar-shakes',
      kind: 'ailment',
      bannerText: 'THE SUGAR SHAKES — YOUR HANDS BETRAY YOU (HP −8)',
      aligns: ['bad', 'chaotic'],
      minDepth: 4,
      weight: 1.4,
      cue: { shake: { intensity: 0.5, ms: 500 }, glitch: 250 },
      hpDelta: -8,
    },
    {
      id: 'pk:ailments:sleep-debt',
      kind: 'ailment',
      bannerText: 'SLEEP DEBT CALLED IN — THE ROOM SWIMS (HP −5)',
      aligns: ['neutral', 'bad'],
      minDepth: 4,
      weight: 1.5,
      cue: { melt: 0.45, glitch: 300 },
      hpDelta: -5,
    },
    {
      id: 'pk:ailments:the-thirst',
      kind: 'ailment',
      bannerText: 'THE THIRST — YOUR TONGUE IS A DRY STONE (HP −6)',
      aligns: ['bad', 'neutral'],
      minDepth: 5,
      weight: 1.2,
      cue: { melt: 0.3, scanlines: true },
      hpDelta: -6,
    },
    {
      id: 'pk:ailments:grey-cough',
      kind: 'ailment',
      bannerText: 'THE GREY COUGH — SOMETHING RATTLES LOOSE (HP −10)',
      aligns: ['bad'],
      minDepth: 5,
      weight: 1,
      cue: { scanlines: true, glitch: 500 },
      hpDelta: -10,
    },
    {
      id: 'pk:ailments:one-good-night',
      kind: 'relief',
      bannerText: "ONE GOOD NIGHT'S SLEEP — YOU WAKE UNBROKEN (HP +6)",
      aligns: ['good'],
      minDepth: 5,
      weight: 1.1,
      cue: { flash: { color: 0xaad4ff, ms: 110 }, scanlines: true },
      hpDelta: 6,
      scoreMul: 1.15,
    },
    {
      id: 'pk:ailments:crooked-limp',
      kind: 'ailment',
      bannerText: 'THE CROOKED LIMP — YOUR KNEE FILES A COMPLAINT (HP −5)',
      aligns: ['bad', 'chaotic'],
      minDepth: 6,
      weight: 1,
      cue: { shake: { intensity: 0.35, ms: 700 } },
      hpDelta: -5,
    },
    {
      id: 'pk:ailments:kiln-fever',
      kind: 'ailment',
      bannerText: 'KILN FEVER — YOU ARE BURNING FROM THE INSIDE (HP −12)',
      aligns: ['bad', 'chaotic'],
      minDepth: 7,
      weight: 0.8,
      cue: { flash: { color: 0xff5522, ms: 140 }, embers: 24, shake: { intensity: 0.4, ms: 600 } },
      hpDelta: -12,
    },
    {
      id: 'pk:ailments:marsh-swoon',
      kind: 'ailment',
      bannerText: 'MARSH SWOON — THE ROOM MIRRORS, CONTROLS SWAP (0.9s)',
      aligns: ['chaotic'],
      minDepth: 8,
      weight: 0.7,
      cue: { invert: 900, glitch: 400, melt: 0.25 },
      hpDelta: -6,
    },
    {
      id: 'pk:ailments:slow-wasting',
      kind: 'ailment',
      bannerText: 'THE SLOW WASTING — YOU WEIGH LESS THAN LAST ROUND (HP −14)',
      aligns: ['bad'],
      minDepth: 11,
      weight: 0.5,
      cue: { melt: 0.7, scanlines: true, glitch: 700 },
      hpDelta: -14,
      scoreMul: 1.3,
    },
  ],
};
