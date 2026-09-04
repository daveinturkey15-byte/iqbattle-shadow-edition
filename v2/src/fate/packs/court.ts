/**
 * PACK: THE COURT OF JESTERS — Jesters, pixies, wizards, warlocks and witches holding court over the board.
 *
 * Pure data. See src/fate/pack-kit.ts for the contract: every event ships a
 * banner + a non-empty chaos-bus cue + optional riders. Text-only is not done.
 * Ids are namespaced 'pk:court:<slug>'.
 */

import { type PackDef } from '../pack-kit.ts';

export const PACK_COURT: PackDef = {
  id: 'court',
  title: 'THE COURT OF JESTERS',
  events: [
    {
      id: 'pk:court:bells-ring',
      kind: 'court',
      bannerText: '🔔 THE COURT BELLS RING — SOMEONE HAS DECIDED YOU ARE FUNNY',
      aligns: ['neutral', 'chaotic'],
      minDepth: 3,
      weight: 2.0,
      cue: { flash: { color: 0xffe066, ms: 90 }, embers: 6 },
    },
    {
      id: 'pk:court:wizard-nods-off',
      kind: 'court',
      bannerText: '🧙 THE WIZARD HAS NODDED OFF — NOBODY DARES WAKE HIM',
      aligns: ['neutral', 'chaotic'],
      minDepth: 3,
      weight: 1.8,
      cue: { melt: 0.15, scanlines: true },
    },
    {
      id: 'pk:court:jester-juggles',
      kind: 'court',
      bannerText: '🃏 THE JESTER JUGGLES YOUR OPTIONS — HE IS NOT GOOD AT IT',
      aligns: ['bad', 'chaotic'],
      minDepth: 4,
      weight: 1.4,
      cue: { glitch: 350, embers: 8 },
      scoreMul: 0.85,
    },
    {
      id: 'pk:court:court-applauds',
      kind: 'court',
      bannerText: '🎉 THE COURT APPLAUDS YOU — BRIEFLY, AND WITH CONFUSION',
      aligns: ['good', 'neutral'],
      minDepth: 4,
      weight: 1.2,
      cue: { flash: { color: 0x66ffaa, ms: 130 }, embers: 18 },
      hpDelta: 10,
    },
    {
      id: 'pk:court:pixie-pocket',
      kind: 'court',
      bannerText: '🧚 A PIXIE TAKES SOMETHING SMALL — YOU LIKED THAT SOMETHING',
      aligns: ['bad', 'chaotic'],
      minDepth: 5,
      weight: 1.1,
      cue: { glitch: 260, embers: 4 },
      scoreMul: 0.9,
    },
    {
      id: 'pk:court:witch-weighs-you',
      kind: 'court',
      bannerText: '🧹 THE WITCH WEIGHS YOU AGAINST A DUCK — INCONCLUSIVE',
      aligns: ['neutral', 'bad'],
      minDepth: 6,
      weight: 1.0,
      cue: { scanlines: true, glitch: 200 },
    },
    {
      id: 'pk:court:hex-of-itching',
      kind: 'court',
      bannerText: '🐜 A HEX OF ITCHING — THE JESTER SAYS IT PASSES BY SPRING',
      aligns: ['bad', 'chaotic'],
      minDepth: 6,
      weight: 0.9,
      cue: { shake: { intensity: 0.35, ms: 500 } },
      hpDelta: -5,
    },
    {
      id: 'pk:court:cauldron-boils',
      kind: 'court',
      bannerText: '🍲 THE CAULDRON BOILS OVER — THE COURT DOES NOT HELP',
      aligns: ['bad', 'chaotic'],
      minDepth: 8,
      weight: 0.8,
      cue: { embers: 40, melt: 0.35 },
      hpDelta: -12,
    },
    {
      id: 'pk:court:toad-verdict',
      kind: 'court',
      bannerText: '🐸 THE COURT VOTES TOAD — THE SPELL ONLY HALF LANDS',
      aligns: ['bad', 'chaotic'],
      minDepth: 9,
      weight: 0.7,
      cue: { melt: 0.5, flash: { color: 0x66aa33, ms: 120 }, shake: { intensity: 0.5, ms: 420 } },
      hpDelta: -8,
    },
    {
      id: 'pk:court:spell-misfires',
      kind: 'court',
      bannerText: '🌀 A SPELL MISFIRES — YOUR HANDS OBEY THE MIRROR A WHILE',
      aligns: ['chaotic'],
      minDepth: 10,
      weight: 0.6,
      cue: { invert: 650, glitch: 300 },
    },
    {
      id: 'pk:court:warlock-contract',
      kind: 'court',
      bannerText: '📜 THE WARLOCK OFFERS TERMS — MORE POINTS, LESS OF YOU',
      aligns: ['bad', 'chaotic'],
      minDepth: 12,
      weight: 0.5,
      cue: { scanlines: true, flash: { color: 0x330066, ms: 140 }, embers: 12 },
      hpDelta: -18,
      scoreMul: 1.9,
    },
  ],
};
