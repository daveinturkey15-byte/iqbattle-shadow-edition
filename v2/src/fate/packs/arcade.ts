/**
 * PACK: ARCADE PICKUPS — Parody retro pickups: rings, coins, fruit, extra lives.
 *
 * Pure data. See src/fate/pack-kit.ts for the contract: every event ships a
 * banner + a non-empty chaos-bus cue + optional riders. Text-only is not done.
 * Ids are namespaced 'pk:arcade:<slug>'.
 *
 * TONE: bright, chiptune-adjacent, nostalgic — and deliberately the kindest
 * pack in the set, so it leans good/neutral. PARODY ONLY: every pickup is
 * described by what it does, never by whose it was. No character names, no
 * franchise names, no console names, no real people.
 */

import { type PackDef } from '../pack-kit.ts';

export const PACK_ARCADE: PackDef = {
  id: 'arcade',
  title: 'ARCADE PICKUPS',
  events: [
    /* ---- the generous half -------------------------------------------- */
    {
      id: 'pk:arcade:coin-run',
      kind: 'coins',
      bannerText: '🪙 A ROW OF COINS, EACH ONE A LITTLE CHIME (HP +6)',
      aligns: ['good', 'neutral'],
      minDepth: 3,
      weight: 1.9,
      cue: { flash: { color: 0xffd23f, ms: 120 }, embers: 18 },
      hpDelta: 6,
    },
    {
      id: 'pk:arcade:apes-fruit',
      kind: 'fruit',
      bannerText: '🍌 THE APE DROPS FRUIT FROM THE SCAFFOLD, ON PURPOSE (HP +7)',
      aligns: ['good', 'neutral'],
      minDepth: 4,
      weight: 1.6,
      cue: { flash: { color: 0xf7e04b, ms: 100 }, embers: 24, shake: { intensity: 0.25, ms: 300 } },
      hpDelta: 7,
    },
    {
      id: 'pk:arcade:crate-medkit',
      kind: 'medkit',
      bannerText: '🧰 A MEDKIT IN A CRATE NOBODY OWNS (HP +10)',
      aligns: ['good', 'neutral'],
      minDepth: 4,
      weight: 1.4,
      cue: { flash: { color: 0x4dff88, ms: 130 }, embers: 10 },
      hpDelta: 10,
    },
    {
      id: 'pk:arcade:checkpoint-flag',
      kind: 'checkpoint',
      bannerText: '🚩 CHECKPOINT. A FLAG, A CHIRP, A SMALL MERCY. (HP +4)',
      aligns: ['good', 'neutral'],
      minDepth: 5,
      weight: 1.5,
      cue: { flash: { color: 0x66ff66, ms: 90 }, scanlines: true },
      hpDelta: 4,
    },
    {
      id: 'pk:arcade:extra-life',
      kind: 'life',
      bannerText: '🆙 EXTRA LIFE — THE COUNTER TICKS UP AND YOU FEEL SILLY (HP +15)',
      aligns: ['good'],
      minDepth: 7,
      weight: 0.7,
      cue: { flash: { color: 0xffffff, ms: 150 }, embers: 44 },
      hpDelta: 15,
    },

    /* ---- neutral cabinet noise ---------------------------------------- */
    {
      id: 'pk:arcade:ammo-crate',
      kind: 'ammo',
      bannerText: '📦 AMMO CRATE. NO GUN. STILL, LOVELY WEIGHT. (SCORE ×1.25)',
      aligns: ['neutral', 'chaotic'],
      minDepth: 5,
      weight: 1.2,
      cue: { shake: { intensity: 0.3, ms: 260 }, flash: { color: 0xbba766, ms: 80 } },
      scoreMul: 1.25,
    },

    /* ---- the mean half ------------------------------------------------- */
    {
      id: 'pk:arcade:rings-scatter',
      kind: 'rings',
      bannerText: '🔵 THE BLUE SPRITE IS CLIPPED — RINGS EVERYWHERE (HP −10)',
      aligns: ['bad', 'chaotic'],
      minDepth: 3,
      weight: 1.1,
      cue: { shake: { intensity: 0.65, ms: 420 }, embers: 52, flash: { color: 0xffcc00, ms: 70 } },
      hpDelta: -10,
    },
    {
      id: 'pk:arcade:cherry-reel',
      kind: 'reels',
      bannerText: '🍒 THE REELS LAND CHERRY-CHERRY-BELL (SCORE ×1.6)',
      aligns: ['chaotic', 'bad'],
      minDepth: 6,
      weight: 0.9,
      cue: { glitch: 620, flash: { color: 0xff3366, ms: 110 }, embers: 16 },
      scoreMul: 1.6,
    },
    {
      id: 'pk:arcade:wrong-pipe',
      kind: 'warp',
      bannerText: '🟩 THE PIPE GOES SOMEWHERE THE ARTISTS NEVER FINISHED (HP −12)',
      aligns: ['bad', 'chaotic'],
      minDepth: 8,
      weight: 0.7,
      cue: { melt: 0.7, glitch: 800, shake: { intensity: 0.4, ms: 600 } },
      hpDelta: -12,
    },
    {
      id: 'pk:arcade:mirrored-cabinet',
      kind: 'cabinet',
      bannerText: '🕹 THE CABINET MIRRORS YOUR STICK FOR 700ms',
      aligns: ['chaotic'],
      minDepth: 9,
      weight: 0.55,
      cue: { invert: 700, glitch: 340, scanlines: true },
    },
    {
      id: 'pk:arcade:misspelled-score',
      kind: 'highscore',
      bannerText: '🏆 THE HIGH SCORE TABLE SPELLS YOUR NAME WRONG. FOREVER. (HP −4)',
      aligns: ['bad', 'neutral'],
      minDepth: 6,
      weight: 1.0,
      cue: { glitch: 300, scanlines: true, flash: { color: 0x8888ff, ms: 60 } },
      hpDelta: -4,
    },
  ],
};
