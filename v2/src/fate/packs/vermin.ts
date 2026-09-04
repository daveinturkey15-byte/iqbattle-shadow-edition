/**
 * PACK: VERMIN AND RUST — Snakes, spiders, ants, rusty nails and acid rain.
 *
 * Pure data. See src/fate/pack-kit.ts for the contract: every event ships a
 * banner + a non-empty chaos-bus cue + optional riders. Text-only is not done.
 * Ids are namespaced 'pk:vermin:<slug>'.
 *
 * CONTENT RULE: skin-crawling and close-up, but invented throughout. No real
 * person, no brand, no trademarked creature — just the things living in the
 * walls of this building.
 */

import { type PackDef } from '../pack-kit.ts';

export const PACK_VERMIN: PackDef = {
  id: 'vermin',
  title: 'VERMIN AND RUST',
  events: [
    {
      id: 'pk:vermin:spider-collar',
      kind: 'vermin',
      bannerText: 'A SPIDER WALKS INTO YOUR COLLAR. DO NOT MOVE. (HP −3)',
      aligns: ['bad', 'chaotic', 'neutral'],
      minDepth: 3,
      weight: 1.8,
      cue: { glitch: 300, shake: { intensity: 0.2, ms: 900 } },
      hpDelta: -3,
    },
    {
      id: 'pk:vermin:web-catch',
      kind: 'reprieve',
      bannerText: 'A WEB CATCHES WHAT WAS FALLING ON YOU (HP +7)',
      aligns: ['good', 'neutral'],
      minDepth: 3,
      weight: 1.6,
      cue: { flash: { color: 0xccffdd, ms: 120 }, embers: 8 },
      hpDelta: 7,
    },
    {
      id: 'pk:vermin:rusty-nail',
      kind: 'rust',
      bannerText: 'A RUSTY NAIL FINDS YOUR PALM — THE RUST GETS IN (HP −9)',
      aligns: ['bad', 'chaotic'],
      minDepth: 4,
      weight: 1.3,
      cue: { flash: { color: 0x993322, ms: 120 }, shake: { intensity: 0.45, ms: 400 } },
      hpDelta: -9,
    },
    {
      id: 'pk:vermin:ant-tide',
      kind: 'vermin',
      bannerText: 'THE ANT TIDE CROSSES YOUR DESK AND DOES NOT STOP',
      aligns: ['neutral', 'chaotic'],
      minDepth: 4,
      weight: 1.5,
      cue: { scanlines: true, embers: 20 },
      hpDelta: -2,
    },
    {
      id: 'pk:vermin:black-mould',
      kind: 'rust',
      bannerText: 'BLACK MOULD BLOOMS BEHIND THE SCOREBOARD (HP −6)',
      aligns: ['bad', 'neutral'],
      minDepth: 5,
      weight: 1.1,
      cue: { melt: 0.5, scanlines: true },
      hpDelta: -6,
    },
    {
      id: 'pk:vermin:coiled-boot',
      kind: 'vermin',
      bannerText: 'SOMETHING COILED IS ALREADY IN YOUR BOOT (HP −7)',
      aligns: ['bad', 'chaotic'],
      minDepth: 5,
      weight: 1.2,
      cue: { shake: { intensity: 0.5, ms: 500 }, glitch: 250 },
      hpDelta: -7,
    },
    {
      id: 'pk:vermin:small-red-beetle',
      kind: 'reprieve',
      bannerText: 'A SMALL RED BEETLE LANDS ON YOUR HAND. GOOD OMEN.',
      aligns: ['good'],
      minDepth: 6,
      weight: 1,
      cue: { flash: { color: 0xff7766, ms: 100 }, embers: 6 },
      hpDelta: 4,
      scoreMul: 1.25,
    },
    {
      id: 'pk:vermin:acid-rain',
      kind: 'rust',
      bannerText: 'ACID RAIN — THE ROOF DRIPS AND THE DRIPS SMOKE (HP −11)',
      aligns: ['bad'],
      minDepth: 6,
      weight: 1,
      cue: { melt: 0.6, embers: 10, scanlines: true },
      hpDelta: -11,
    },
    {
      id: 'pk:vermin:wall-nest',
      kind: 'vermin',
      bannerText: 'THE NEST IN THE WALL WAKES UP. ALL OF IT. (HP −12)',
      aligns: ['bad', 'chaotic'],
      minDepth: 7,
      weight: 0.8,
      cue: { shake: { intensity: 0.7, ms: 800 }, embers: 32, glitch: 200 },
      hpDelta: -12,
    },
    {
      id: 'pk:vermin:the-swarm',
      kind: 'vermin',
      bannerText: 'THE SWARM TAKES THE ROOM — CONTROLS INVERTED (1.2s)',
      aligns: ['chaotic'],
      minDepth: 10,
      weight: 0.5,
      cue: { invert: 1200, glitch: 500, embers: 48 },
      hpDelta: -8,
    },
    {
      id: 'pk:vermin:rats-organised',
      kind: 'vermin',
      bannerText: 'THE RATS HAVE ORGANISED. THEY HAVE A LEADER NOW. (HP −10)',
      aligns: ['chaotic'],
      minDepth: 12,
      weight: 0.6,
      cue: { shake: { intensity: 0.6, ms: 700 }, glitch: 600, scanlines: true },
      hpDelta: -10,
      scoreMul: 1.4,
    },
  ],
};
