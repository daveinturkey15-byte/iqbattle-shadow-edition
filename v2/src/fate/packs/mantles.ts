/**
 * PACK: MASKS AND MANTLES — Parody heroes and villains: the mantle, the mask, the doctor, the symbiote.
 *
 * Pure data. See src/fate/pack-kit.ts for the contract: every event ships a
 * banner + a non-empty chaos-bus cue + optional riders. Text-only is not done.
 * Ids are namespaced 'pk:mantles:<slug>'.
 *
 * Every figure here is invented. The joke lives in the silhouette, never in a
 * name: a cowl, a cape, a green mask, an egg with ambitions.
 */

import { type PackDef } from '../pack-kit.ts';

export const PACK_MANTLES: PackDef = {
  id: 'mantles',
  title: 'MASKS AND MANTLES',
  events: [
    /* ---- the king in the cat's mantle ---------------------------------- */
    {
      id: 'pk:mantles:obsidian-jaguar',
      kind: 'mantle',
      bannerText: '🐆 THE OBSIDIAN JAGUAR TAKES THE THRONE, THE SUIT AND THE HERBS',
      aligns: ['bad', 'chaotic'],
      minDepth: 6,
      weight: 0.9,
      cue: { shake: { intensity: 0.6, ms: 620 }, flash: { color: 0x4422aa, ms: 120 } },
      hpDelta: -9,
    },
    {
      id: 'pk:mantles:mantle-passes',
      kind: 'mantle',
      bannerText: '👘 THE MANTLE PASSES TO SOMEONE BETTER SUITED. RUDE, BUT FAIR.',
      aligns: ['good', 'neutral'],
      minDepth: 4,
      weight: 1.3,
      cue: { flash: { color: 0x9977ff, ms: 130 }, embers: 14 },
      scoreMul: 1.25,
    },

    /* ---- the doctor with the metal face -------------------------------- */
    {
      id: 'pk:mantles:doctor-verdigris',
      kind: 'mask',
      bannerText: '🩺 DOCTOR VERDIGRIS SMILES. THE FACE IS METAL. IT DOES NOT MOVE.',
      aligns: ['bad', 'chaotic'],
      minDepth: 5,
      weight: 1,
      cue: { glitch: 700, scanlines: true },
      hpDelta: -11,
    },
    /* ---- the bald one, his tiny copy, and the laugh --------------------- */
    {
      id: 'pk:mantles:mister-orb-waits',
      kind: 'villain',
      bannerText: '🥚 MISTER ORB IS NEUTRAL FOR NOW. DO NOT GET ONE WRONG.',
      aligns: ['neutral', 'good'],
      minDepth: 3,
      weight: 2,
      cue: { embers: 6, flash: { color: 0xdddddd, ms: 80 } },
    },
    {
      id: 'pk:mantles:mister-orb-turns',
      kind: 'villain',
      bannerText: '🥚 YOU GOT ONE WRONG. MISTER ORB IS NO LONGER NEUTRAL.',
      aligns: ['bad', 'chaotic'],
      minDepth: 6,
      weight: 0.9,
      cue: { shake: { intensity: 0.7, ms: 560 }, glitch: 300 },
      hpDelta: -13,
    },
    {
      id: 'pk:mantles:little-orb',
      kind: 'villain',
      bannerText: '🫧 LITTLE ORB ARRIVES. SAME HEAD. SMALLER. SOMEHOW WORSE.',
      aligns: ['neutral', 'chaotic'],
      minDepth: 4,
      weight: 1.5,
      cue: { melt: 0.25, embers: 9 },
    },
    {
      id: 'pk:mantles:unconvincing-laugh',
      kind: 'villain',
      bannerText: '😈 AN EVIL LAUGH, PERFORMED BADLY, HELD FAR TOO LONG',
      aligns: ['neutral', 'chaotic'],
      minDepth: 3,
      weight: 1.7,
      cue: { glitch: 240, shake: { intensity: 0.2, ms: 300 } },
    },

    /* ---- the ink that wants to be worn ---------------------------------- */
    {
      id: 'pk:mantles:ink-wants-in',
      kind: 'symbiote',
      bannerText: '🖤 THE INK SLIDES ON — EVERYTHING READS BACKWARD FOR A MOMENT',
      aligns: ['chaotic'],
      minDepth: 10,
      weight: 0.5,
      cue: { invert: 800, melt: 0.4, flash: { color: 0x111111, ms: 100 } },
    },
    {
      id: 'pk:mantles:ink-throws-a-party',
      kind: 'symbiote',
      bannerText: '🎉 THE INK THROWS A PARTY. NOBODY ASKED FOR THE DANCING.',
      aligns: ['chaotic', 'bad'],
      minDepth: 7,
      weight: 0.8,
      cue: { embers: 44, flash: { color: 0xff44cc, ms: 150 }, melt: 0.3 },
      scoreMul: 1.5,
    },

    /* ---- the cape and the cowl ------------------------------------------ */
    {
      id: 'pk:mantles:caped-lad',
      kind: 'hero',
      bannerText: '🦸 A CAPED LAD LANDS IN A CRATER, KNEE FIRST, GRINNING',
      aligns: ['good', 'neutral'],
      minDepth: 3,
      weight: 1.6,
      cue: { flash: { color: 0x66ccff, ms: 140 }, embers: 18 },
      hpDelta: 10,
    },
    {
      id: 'pk:mantles:the-cowl',
      kind: 'hero',
      bannerText: '🦇 THE COWL BROODS ON A GARGOYLE. IT HAS NOTES ON YOUR FORM.',
      aligns: ['bad', 'neutral'],
      minDepth: 8,
      weight: 0.7,
      cue: { scanlines: true, melt: 0.2, shake: { intensity: 0.25, ms: 350 } },
      scoreMul: 0.85,
    },
  ],
};
