/**
 * PACK: THE TOWER AND THE RING — Parody high fantasy: the tower, the eye, the burden, the dragon.
 *
 * Pure data. See src/fate/pack-kit.ts for the contract: every event ships a
 * banner + a non-empty chaos-bus cue + optional riders. Text-only is not done.
 * Ids are namespaced 'pk:tower:<slug>'.
 *
 * Parody only. Every name here is invented — small folk, the grey wanderer,
 * the lidless stare, the worm on the gold, the under-road. No character,
 * place or title from any published work, and no real people.
 *
 * Composition notes:
 *   - 'good' is served by the shared lunch (a small kindness, HP +7) and the
 *     late wings; neither carries a negative hpDelta.
 *   - 'neutral' rounds get the high-weight, low-stakes atmosphere.
 *   - exactly ONE invert (the under-road), telegraphed with BACKWARD.
 *   - riders stay inside -20..+15 hp and 0.7..2.0 scoreMul for balance.
 */

import { type PackDef } from '../pack-kit.ts';

export const PACK_TOWER: PackDef = {
  id: 'tower',
  title: 'THE TOWER AND THE RING',
  events: [
    {
      id: 'pk:tower:lidless-stare',
      kind: 'eye',
      bannerText: '👁 THE LIDLESS STARE SWEEPS THE PLAIN — KEEP VERY STILL',
      aligns: ['bad', 'chaotic'],
      minDepth: 5,
      weight: 1,
      cue: { flash: { color: 0xff6600, ms: 160 }, glitch: 350 },
      hpDelta: -8,
    },
    {
      id: 'pk:tower:the-burden',
      kind: 'burden',
      bannerText: '💍 THE BURDEN GROWS HEAVIER THE NEARER YOU CARRY IT',
      aligns: ['bad', 'neutral'],
      minDepth: 4,
      weight: 1.4,
      cue: { melt: 0.4, shake: { intensity: 0.2, ms: 500 } },
      hpDelta: -5,
    },
    {
      id: 'pk:tower:shared-lunch',
      kind: 'kindness',
      bannerText: '🍄 SMALL FOLK SHARE THEIR LUNCH WITH A STRANGER — HP +7',
      aligns: ['good', 'neutral'],
      minDepth: 3,
      weight: 1.8,
      cue: { embers: 12, flash: { color: 0xffdd88, ms: 150 } },
      hpDelta: 7,
    },
    {
      id: 'pk:tower:grey-wanderer',
      kind: 'warning',
      bannerText: '🧙 THE GREY WANDERER FORBIDS IT. HE WILL NOT SAY WHAT.',
      aligns: ['neutral', 'bad'],
      minDepth: 3,
      weight: 1.6,
      cue: { scanlines: true, glitch: 200 },
    },
    {
      id: 'pk:tower:marching-ants',
      kind: 'army',
      bannerText: '🐜 TEN THOUSAND SPEARS MOVE AS ONE — PROBABLY NOT FOR YOU',
      aligns: ['bad', 'chaotic'],
      minDepth: 7,
      weight: 0.9,
      cue: { embers: 32, shake: { intensity: 0.5, ms: 800 } },
      hpDelta: -10,
    },
    {
      id: 'pk:tower:broken-blade',
      kind: 'relic',
      bannerText: '🗡 THE BLADE THAT BROKE STAYS BROKEN — SCORE x0.85',
      aligns: ['bad', 'neutral'],
      minDepth: 6,
      weight: 1,
      cue: { flash: { color: 0xccddff, ms: 110 }, shake: { intensity: 0.35, ms: 350 } },
      scoreMul: 0.85,
    },
    {
      id: 'pk:tower:long-stair',
      kind: 'ascent',
      bannerText: '🪜 THE LONG STAIR. NO RAIL. SOMETHING BREATHES ABOVE YOU.',
      aligns: ['bad', 'neutral'],
      minDepth: 8,
      weight: 0.8,
      cue: { melt: 0.5, scanlines: true },
      hpDelta: -9,
    },
    {
      id: 'pk:tower:worm-on-the-gold',
      kind: 'dragon',
      bannerText: '🐲 THE WORM ON THE GOLD OPENS ONE EYE. IT COUNTED IT ALL.',
      aligns: ['bad', 'chaotic'],
      minDepth: 10,
      weight: 0.5,
      cue: { shake: { intensity: 0.85, ms: 900 }, embers: 40, flash: { color: 0xff3311, ms: 130 } },
      hpDelta: -15,
    },
    {
      id: 'pk:tower:under-road',
      kind: 'delve',
      bannerText: '⛏ THE UNDER-ROAD RUNS BACKWARD — AND SO DO YOUR CONTROLS',
      aligns: ['chaotic'],
      minDepth: 9,
      weight: 0.7,
      cue: { invert: 1100, glitch: 400 },
    },
    {
      id: 'pk:tower:something-wet',
      kind: 'riddle',
      bannerText: '🕯 SOMETHING WET ASKS A RIDDLE. LOSE, AND IT KEEPS YOUR NAME.',
      aligns: ['neutral', 'chaotic'],
      minDepth: 4,
      weight: 1.5,
      cue: { scanlines: true, glitch: 250, embers: 6 },
    },
    {
      id: 'pk:tower:late-wings',
      kind: 'rescue',
      bannerText: '🦅 GREAT WINGS ARRIVE LATE, AS THEY ALWAYS DO — SCORE x1.4',
      aligns: ['good', 'neutral', 'chaotic'],
      minDepth: 6,
      weight: 0.9,
      cue: { embers: 18, flash: { color: 0xffeecc, ms: 150 } },
      scoreMul: 1.4,
    },
  ],
};
