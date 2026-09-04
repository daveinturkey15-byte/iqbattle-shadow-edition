/**
 * PACK: THE DIVINE — Angels, the stair, the lamp and its occupant, the wise old man.
 *
 * Pure data. See src/fate/pack-kit.ts for the contract: every event ships a
 * banner + a non-empty chaos-bus cue + optional riders. Text-only is not done.
 * Ids are namespaced 'pk:divine:<slug>'.
 *
 * This is the pack that carries the game's GOOD rounds: six of the eleven are
 * eligible on 'good' and none of those takes hp away.
 */

import { type PackDef } from '../pack-kit.ts';

export const PACK_DIVINE: PackDef = {
  id: 'divine',
  title: 'THE DIVINE',
  events: [
    {
      id: 'pk:divine:the-stair',
      kind: 'divine',
      bannerText: '🪜 A STAIR OPENS IN THE AIR — CLIMB TWO STEPS, THEN IT SHUTS',
      aligns: ['good', 'neutral'],
      minDepth: 3,
      weight: 2.0,
      cue: { flash: { color: 0xfff2cc, ms: 140 }, embers: 14 },
      hpDelta: 10,
    },
    {
      id: 'pk:divine:small-mercy',
      kind: 'divine',
      bannerText: '🕊 A SMALL MERCY IS GRANTED — NOBODY SAYS WHY',
      aligns: ['good', 'neutral'],
      minDepth: 3,
      weight: 1.9,
      cue: { flash: { color: 0xcceeff, ms: 120 }, embers: 8 },
      hpDelta: 6,
    },
    {
      id: 'pk:divine:angel-third-step',
      kind: 'divine',
      bannerText: '👼 THE ANGEL OF THE THIRD STEP MARKS YOUR NAME KINDLY',
      aligns: ['good'],
      minDepth: 4,
      weight: 1.6,
      cue: { embers: 22, glitch: 180 },
      scoreMul: 1.25,
    },
    {
      id: 'pk:divine:laurel-emperor',
      kind: 'divine',
      bannerText: '👑 EMPEROR VARENIUS, LAURELLED, RATES YOUR ANSWER "ADEQUATE"',
      aligns: ['neutral', 'bad'],
      minDepth: 4,
      weight: 1.5,
      cue: { scanlines: true, flash: { color: 0xd4af37, ms: 100 } },
      scoreMul: 0.9,
    },
    {
      id: 'pk:divine:old-man-crossroads',
      kind: 'divine',
      bannerText: '🧓 THE OLD MAN AT THE CROSSROADS: "I HAVE SEEN THIS BEFORE"',
      aligns: ['good', 'neutral'],
      minDepth: 5,
      weight: 1.3,
      cue: { scanlines: true, glitch: 240 },
    },
    {
      id: 'pk:divine:withheld-miracle',
      kind: 'divine',
      bannerText: '🚪 THE MIRACLE IS WITHHELD TODAY — NO REASON IS OFFERED',
      aligns: ['bad', 'neutral'],
      minDepth: 6,
      weight: 1.0,
      cue: { glitch: 420, scanlines: true },
      hpDelta: -6,
    },
    {
      id: 'pk:divine:healing-water',
      kind: 'divine',
      bannerText: '💧 HEALING WATER FROM A CRACKED CUP — DRINK IT ANYWAY',
      aligns: ['good', 'neutral'],
      minDepth: 8,
      weight: 1.0,
      cue: { embers: 16, melt: 0.2 },
      hpDelta: 12,
    },
    {
      id: 'pk:divine:oracle-speaks-backward',
      kind: 'divine',
      bannerText: '🔮 THE ORACLE SPEAKS BACKWARD — AND SO DO YOUR HANDS',
      aligns: ['bad', 'chaotic'],
      minDepth: 7,
      weight: 0.8,
      cue: { invert: 800, glitch: 260 },
    },
    {
      id: 'pk:divine:the-lamp-opens',
      kind: 'divine',
      bannerText: '🪔 THE LAMP OPENS — THE THING INSIDE IS IN A GENEROUS MOOD',
      aligns: ['good', 'chaotic'],
      minDepth: 9,
      weight: 0.7,
      cue: { flash: { color: 0xffcc33, ms: 150 }, embers: 30, glitch: 220 },
      hpDelta: 14,
    },
    {
      id: 'pk:divine:wish-with-a-catch',
      kind: 'divine',
      bannerText: '🧞 THE WISH IS GRANTED EXACTLY AS WORDED — THAT WAS THE CATCH',
      aligns: ['bad', 'chaotic'],
      minDepth: 10,
      weight: 0.6,
      cue: { glitch: 700, melt: 0.4 },
      hpDelta: -16,
      scoreMul: 1.9,
    },
    {
      id: 'pk:divine:wrath',
      kind: 'divine',
      bannerText: '⚡ WRATH — THE SKY OBJECTS TO YOU PERSONALLY',
      aligns: ['bad', 'chaotic'],
      minDepth: 11,
      weight: 0.5,
      cue: { shake: { intensity: 0.85, ms: 700 }, flash: { color: 0xffffff, ms: 90 }, embers: 26 },
      hpDelta: -20,
    },
  ],
};
