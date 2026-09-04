/**
 * PACK: GUNSHIP AND SKY — Circling gunships, drone swarms and orbital light.
 *
 * Pure data. See src/fate/pack-kit.ts for the contract: every event ships a
 * banner + a non-empty chaos-bus cue + optional riders. Text-only is not done.
 * Ids are namespaced 'pk:gunship:<slug>'.
 *
 * TONE: atmosphere, not casualties. Weather, waiting, a light that finds you,
 * the gap between the flash and the sound. Every designation here is invented
 * ("THE SLOW CIRCLE", "the lamp", "the swarm") — no real aircraft, units,
 * operations or people, in banners, ids or comments.
 */

import { type PackDef } from '../pack-kit.ts';

export const PACK_GUNSHIP: PackDef = {
  id: 'gunship',
  title: 'GUNSHIP AND SKY',
  events: [
    /* --- the mild, high-weight end: weather and waiting ------------------ */
    {
      id: 'pk:gunship:all-clear',
      kind: 'reprieve',
      bannerText: '✓ ALL CLEAR CALLED. THE SKY GOES BACK TO BEING SKY.',
      aligns: ['good', 'neutral'],
      minDepth: 3,
      weight: 2.0,
      cue: { flash: { color: 0x9fd8ff, ms: 140 }, embers: 12 },
      hpDelta: 8,
    },
    {
      id: 'pk:gunship:cloud-base',
      kind: 'weather',
      bannerText: 'CLOUD BASE TOO LOW. THE CIRCLE WAITS. SO DO YOU.',
      aligns: ['good', 'neutral'],
      minDepth: 3,
      weight: 1.8,
      cue: { scanlines: true, embers: 6 },
      hpDelta: 3,
    },
    {
      id: 'pk:gunship:thermal-grain',
      kind: 'optics',
      bannerText: 'THERMAL GRAIN. EVERYTHING WARM IS NOW A SHAPE.',
      aligns: ['neutral', 'bad'],
      minDepth: 4,
      weight: 1.4,
      cue: { scanlines: true, glitch: 500 },
    },
    {
      id: 'pk:gunship:heavy-rotor',
      kind: 'rotor',
      bannerText: '≋ SOMETHING HEAVY PASSES LOW. THE ROOF DISAGREES.',
      aligns: ['neutral', 'bad'],
      minDepth: 5,
      weight: 1.2,
      cue: { shake: { intensity: 0.45, ms: 1100 }, embers: 10 },
      hpDelta: -3,
    },
    {
      id: 'pk:gunship:patient-dot',
      kind: 'scope',
      bannerText: '• A SMALL PATIENT DOT DECIDES YOU ARE NOT WORTH IT.',
      aligns: ['neutral', 'chaotic'],
      minDepth: 6,
      weight: 1.0,
      cue: { glitch: 250, scanlines: true },
    },

    /* --- the circle tightens --------------------------------------------- */
    {
      id: 'pk:gunship:slow-circle',
      kind: 'gunship',
      bannerText: '✈ THE SLOW CIRCLE COMES ROUND AGAIN. IT HAS ALL NIGHT.',
      aligns: ['bad', 'chaotic'],
      minDepth: 5,
      weight: 1.0,
      cue: { shake: { intensity: 0.35, ms: 900 }, scanlines: true },
      hpDelta: -6,
    },
    {
      id: 'pk:gunship:the-lamp',
      kind: 'searchlight',
      bannerText: '☀ THE LAMP FINDS YOU. HOLD VERY STILL AND ANSWER.',
      aligns: ['bad'],
      minDepth: 6,
      weight: 0.9,
      cue: { flash: { color: 0xfff4c8, ms: 180 }, shake: { intensity: 0.25, ms: 500 } },
      hpDelta: -8,
    },
    {
      id: 'pk:gunship:the-swarm',
      kind: 'drones',
      bannerText: '⋯ THE SWARM ARRIVES. ELEVEN SMALL POLITE ENGINES.',
      aligns: ['chaotic', 'bad'],
      minDepth: 7,
      weight: 0.8,
      cue: { embers: 24, glitch: 350 },
      hpDelta: -5,
    },
    {
      id: 'pk:gunship:count-the-delay',
      kind: 'ordnance',
      bannerText: 'THE FLASH ARRIVES FIRST. COUNT. THEN THE SOUND.',
      aligns: ['bad', 'chaotic'],
      minDepth: 8,
      weight: 0.7,
      cue: { flash: { color: 0xffe9a8, ms: 120 }, shake: { intensity: 0.55, ms: 700 } },
      hpDelta: -10,
    },

    /* --- the one invert, and the deep end -------------------------------- */
    {
      id: 'pk:gunship:mirrored-chatter',
      kind: 'radio',
      bannerText: 'GUNNERY CHATTER MIRRORS YOUR CONTROLS FOR 900ms. SORRY.',
      aligns: ['chaotic'],
      minDepth: 7,
      weight: 0.6,
      cue: { invert: 900, glitch: 300 },
      hpDelta: -4,
    },
    {
      id: 'pk:gunship:orbital-lamp',
      kind: 'orbital',
      bannerText: '✦ ORBITAL LIGHT. THE AIR GOES SOFT AND SLIGHTLY WRONG.',
      aligns: ['chaotic'],
      minDepth: 10,
      weight: 0.5,
      cue: { melt: 0.5, flash: { color: 0xff66aa, ms: 90 } },
      hpDelta: -12,
      scoreMul: 1.5,
    },
  ],
};
