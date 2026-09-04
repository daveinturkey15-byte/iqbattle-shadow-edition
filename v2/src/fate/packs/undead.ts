/**
 * PACK: THE UNDEAD — Skeletons, crypts, liches and the walking dead.
 *
 * Pure data. See src/fate/pack-kit.ts for the contract: every event ships a
 * banner + a non-empty chaos-bus cue + optional riders. Text-only is not done.
 * Ids are namespaced 'pk:undead:<slug>'.
 *
 * COMPRESSION NOTE. The frozen v1 build carried four separate undead packs
 * (skeletons / crypt / lich / risen) that overlapped almost entirely. This is
 * their single replacement: one roster, no duplicate imagery, riders limited to
 * the two the engine actually applies (hpDelta, scoreMul).
 */

import { type PackDef } from '../pack-kit.ts';

export const PACK_UNDEAD: PackDef = {
  id: 'undead',
  title: 'THE UNDEAD',
  events: [
    {
      id: 'pk:undead:grave-dirt',
      kind: 'undead',
      bannerText: '⚰ GRAVE DIRT IN YOUR SHOES — WALK IT OFF',
      aligns: ['neutral', 'bad'],
      minDepth: 3,
      weight: 1.8,
      cue: { embers: 6, scanlines: true },
      hpDelta: -2,
    },
    {
      id: 'pk:undead:bone-choir',
      kind: 'undead',
      bannerText: '🎵 THE BONE CHOIR FINDS ITS KEY — IT IS THE WRONG KEY',
      aligns: ['neutral', 'chaotic'],
      minDepth: 3,
      weight: 1.6,
      cue: { glitch: 350, embers: 8 },
    },
    {
      id: 'pk:undead:crypt-draft',
      kind: 'undead',
      bannerText: '💀 A DRAFT FROM THE CRYPT — SOMETHING SAT UP (HP −7)',
      aligns: ['bad', 'chaotic'],
      minDepth: 4,
      weight: 1.0,
      cue: { shake: { intensity: 0.4, ms: 600 }, scanlines: true },
      hpDelta: -7,
    },
    {
      id: 'pk:undead:relit-candle',
      kind: 'undead',
      bannerText: '🕯 A DEAD RELATIVE RELIGHTS YOUR CANDLE — HP +8',
      aligns: ['good', 'neutral'],
      minDepth: 4,
      weight: 1.2,
      cue: { flash: { color: 0xffcc66, ms: 140 }, embers: 12 },
      hpDelta: 8,
    },
    {
      id: 'pk:undead:orderly-queue',
      kind: 'undead',
      bannerText: '🚶 THE DEAD QUEUE UP PROPERLY — YOU ARE NOT NEAR THE FRONT',
      aligns: ['neutral', 'bad'],
      minDepth: 5,
      weight: 1.4,
      cue: { glitch: 250, scanlines: true },
    },
    {
      id: 'pk:undead:hand-through-floor',
      kind: 'undead',
      bannerText: '🖐 A HAND COMES UP THROUGH THE FLOOR — IT WANTS YOUR ANSWER',
      aligns: ['bad', 'chaotic'],
      minDepth: 5,
      weight: 1.0,
      cue: { shake: { intensity: 0.55, ms: 500 }, melt: 0.2 },
      hpDelta: -6,
    },
    {
      id: 'pk:undead:ossuary-payout',
      kind: 'undead',
      bannerText: '🦴 THE OSSUARY PAYS OUT — BONE DUST IS CURRENCY HERE (×1.4)',
      aligns: ['chaotic', 'neutral'],
      minDepth: 6,
      weight: 0.9,
      cue: { embers: 24, flash: { color: 0xaa88ff, ms: 110 } },
      scoreMul: 1.4,
    },
    {
      id: 'pk:undead:debt-collector',
      kind: 'undead',
      bannerText: '📒 THE DEBT COLLECTOR DIED FIRST — HE KEPT THE LEDGER (HP −9)',
      aligns: ['bad'],
      minDepth: 6,
      weight: 0.8,
      cue: { scanlines: true, glitch: 500 },
      hpDelta: -9,
    },
    {
      id: 'pk:undead:coffin-shuffle',
      kind: 'undead',
      bannerText: '🪦 COFFIN SHUFFLE — PALLBEARERS SWAP ENDS, CONTROLS MIRRORED',
      aligns: ['chaotic'],
      minDepth: 7,
      weight: 0.7,
      cue: { invert: 700, shake: { intensity: 0.35, ms: 400 } },
    },
    {
      id: 'pk:undead:lich-tithe',
      kind: 'undead',
      bannerText: '👑 THE LICH TAKES A TITHE — HALF THE SHINE, ALL THE TIME (×0.75)',
      aligns: ['bad', 'chaotic'],
      minDepth: 8,
      weight: 0.6,
      cue: { flash: { color: 0x223355, ms: 120 }, melt: 0.3 },
      scoreMul: 0.75,
    },
    {
      id: 'pk:undead:second-death',
      kind: 'undead',
      bannerText: '☠ THE SECOND DEATH IS QUIETER — NOBODY COMES (HP −12)',
      aligns: ['bad', 'chaotic'],
      minDepth: 10,
      weight: 0.5,
      cue: {
        shake: { intensity: 0.7, ms: 700 },
        flash: { color: 0x000000, ms: 180 },
        melt: 0.4,
      },
      hpDelta: -12,
    },
  ],
};
