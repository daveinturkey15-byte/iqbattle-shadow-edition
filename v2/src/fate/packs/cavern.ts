/**
 * PACK: THE CAVERN AND THE PEAK — Caves, crystals, the thing that sleeps below, the climb, and the abyss.
 *
 * Pure data. See src/fate/pack-kit.ts for the contract: every event ships a
 * banner + a non-empty chaos-bus cue + optional riders. Text-only is not done.
 * Ids are namespaced 'pk:cavern:<slug>'.
 *
 * Composition notes (the gate checks the shape, not the taste):
 *   - 'good' is served by the geode and the silver vein — the cave gives as
 *     well as takes, and neither carries a negative hpDelta.
 *   - 'neutral' rounds get the mild, high-weight atmosphere (drip, cold stone,
 *     thin air) so the common case is texture rather than damage.
 *   - exactly ONE invert (the abyss), telegraphed with MIRROR in the banner.
 *   - riders stay inside -20..+15 hp and 0.7..2.0 scoreMul for balance.
 */

import { type PackDef } from '../pack-kit.ts';

export const PACK_CAVERN: PackDef = {
  id: 'cavern',
  title: 'THE CAVERN AND THE PEAK',
  events: [
    {
      id: 'pk:cavern:crystal-hum',
      kind: 'cavern',
      bannerText: '💎 THE CRYSTALS HUM — SOMETHING BELOW HUMS BACK',
      aligns: ['bad', 'chaotic'],
      minDepth: 4,
      weight: 1.2,
      cue: { embers: 20, flash: { color: 0x66ddff, ms: 140 } },
      hpDelta: -6,
    },
    {
      id: 'pk:cavern:the-drip',
      kind: 'atmosphere',
      bannerText: '💧 DRIP. DRIP. THE CAVE IS COUNTING YOUR MISTAKES.',
      aligns: ['neutral', 'bad'],
      minDepth: 3,
      weight: 2,
      cue: { scanlines: true, embers: 6 },
    },
    {
      id: 'pk:cavern:geode-gift',
      kind: 'boon',
      bannerText: '💎 A GEODE SPLITS OPEN — THE CAVE GIVES SOMETHING BACK. HP +8',
      aligns: ['good', 'neutral'],
      minDepth: 3,
      weight: 1.6,
      cue: { flash: { color: 0x88ffee, ms: 150 }, embers: 14 },
      hpDelta: 8,
    },
    {
      id: 'pk:cavern:sleeper-below',
      kind: 'dragon',
      bannerText: '🐉 SOMETHING VAST TURNS OVER BELOW. DO NOT WAKE IT.',
      aligns: ['bad', 'chaotic'],
      minDepth: 8,
      weight: 0.6,
      cue: { shake: { intensity: 0.75, ms: 900 }, embers: 28 },
      hpDelta: -14,
    },
    {
      id: 'pk:cavern:thin-air',
      kind: 'ascent',
      bannerText: '🏔 THIN AIR AT THE SUMMIT — YOUR THOUGHTS ARRIVE LATE',
      aligns: ['bad', 'neutral'],
      minDepth: 6,
      weight: 1,
      cue: { melt: 0.35, scanlines: true },
      hpDelta: -5,
    },
    {
      id: 'pk:cavern:abyss-looks-back',
      kind: 'abyss',
      bannerText: '🕳 THE ABYSS LOOKS BACK — AND MIRRORS YOUR CONTROLS',
      aligns: ['chaotic'],
      minDepth: 7,
      weight: 0.8,
      cue: { invert: 900, glitch: 300 },
    },
    {
      id: 'pk:cavern:hole-in-the-floor',
      kind: 'void',
      bannerText: '🌌 A HOLE IN THE FLOOR OF THE WORLD — SCORE BENDS x1.6',
      aligns: ['chaotic', 'bad'],
      minDepth: 10,
      weight: 0.5,
      cue: { melt: 0.8, glitch: 700, flash: { color: 0x110022, ms: 120 } },
      scoreMul: 1.6,
    },
    {
      id: 'pk:cavern:the-basement',
      kind: 'dread',
      bannerText: '🚪 THE ONE IN THE BASEMENT HAS STOPPED PRETENDING TO SLEEP',
      aligns: ['bad', 'chaotic'],
      minDepth: 5,
      weight: 1.1,
      cue: { scanlines: true, glitch: 450, shake: { intensity: 0.25, ms: 300 } },
      hpDelta: -7,
    },
    {
      id: 'pk:cavern:rope-goes-slack',
      kind: 'ascent',
      bannerText: '🧗 THE ROPE GOES SLACK. NOBODY HOLDS THE OTHER END.',
      aligns: ['bad'],
      minDepth: 9,
      weight: 0.7,
      cue: { shake: { intensity: 0.9, ms: 600 }, flash: { color: 0xffffff, ms: 90 } },
      hpDelta: -12,
    },
    {
      id: 'pk:cavern:cold-stone',
      kind: 'atmosphere',
      bannerText: '🪨 COLD STONE. NO HURRY. THE PEAK HAS OUTLASTED BETTER.',
      aligns: ['neutral'],
      minDepth: 3,
      weight: 1.8,
      cue: { embers: 4, melt: 0.15 },
    },
    {
      id: 'pk:cavern:silver-vein',
      kind: 'boon',
      bannerText: '⛏ A SILVER VEIN OPENS UNDER YOUR HAND — SCORE x1.3',
      aligns: ['good', 'neutral', 'chaotic'],
      minDepth: 6,
      weight: 0.9,
      cue: { embers: 24, flash: { color: 0xffcc44, ms: 160 } },
      scoreMul: 1.3,
    },
  ],
};
