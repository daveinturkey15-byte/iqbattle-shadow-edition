/**
 * PACK: THE GREEN WAR — Jungle-war atmosphere: rotors, grain, tripwires, monsoon.
 *
 * Pure data. See src/fate/pack-kit.ts for the contract: every event ships a
 * banner + a non-empty chaos-bus cue + optional riders. Text-only is not done.
 * Ids are namespaced 'pk:nam:<slug>'.
 *
 * TONE: melancholy and damp, never exciting. Heat, rain, waiting, a radio
 * playing something cheerful at the wrong moment. No real conflict, place,
 * unit or person is named anywhere — this is invented weather, not history.
 */

import { type PackDef } from '../pack-kit.ts';

export const PACK_NAM: PackDef = {
  id: 'nam',
  title: 'THE GREEN WAR',
  events: [
    /* --- the tender one, and the mild high-weight end -------------------- */
    {
      id: 'pk:nam:letter-home',
      kind: 'letter',
      bannerText: '✉ A LETTER FROM HOME. SHE SAYS THE GARDEN CAME BACK.',
      aligns: ['good', 'neutral'],
      minDepth: 3,
      weight: 2.0,
      cue: { flash: { color: 0xffd9a0, ms: 150 }, embers: 14 },
      hpDelta: 10,
    },
    {
      id: 'pk:nam:first-light',
      kind: 'reprieve',
      bannerText: 'FIRST LIGHT. THE RAIN STOPS. NOBODY SAYS ANYTHING.',
      aligns: ['good', 'neutral', 'bad'],
      minDepth: 3,
      weight: 1.7,
      cue: { embers: 10, flash: { color: 0x8fb98f, ms: 120 } },
      hpDelta: 4,
    },
    {
      id: 'pk:nam:film-grain',
      kind: 'film',
      bannerText: 'THE GRAIN THICKENS. SOMEBODY IS FILMING ALL OF THIS.',
      aligns: ['neutral', 'chaotic'],
      minDepth: 3,
      weight: 1.6,
      cue: { scanlines: true, glitch: 300 },
    },
    {
      id: 'pk:nam:monsoon',
      kind: 'weather',
      bannerText: 'THE MONSOON ARRIVES ON TIME. NOTHING ELSE DOES.',
      aligns: ['neutral', 'bad'],
      minDepth: 4,
      weight: 1.5,
      cue: { scanlines: true, shake: { intensity: 0.2, ms: 1200 } },
    },
    {
      id: 'pk:nam:transistor',
      kind: 'radio',
      bannerText: '♫ THE TRANSISTOR FINDS A CHEERFUL SONG. NOBODY STOPS IT.',
      aligns: ['neutral', 'chaotic'],
      minDepth: 4,
      weight: 1.3,
      cue: { glitch: 250, embers: 4 },
    },

    /* --- damp, heavy, unpleasant ----------------------------------------- */
    {
      id: 'pk:nam:the-heat',
      kind: 'heat',
      bannerText: 'THE HEAT DOES NOT LIFT. IT HAS NEVER ONCE LIFTED.',
      aligns: ['bad', 'neutral'],
      minDepth: 5,
      weight: 1.2,
      cue: { melt: 0.35 },
      hpDelta: -4,
    },
    {
      id: 'pk:nam:rotor-wash',
      kind: 'rotor',
      bannerText: '≋ ROTOR WASH FLATTENS THE GRASS. NOBODY WAVES BACK.',
      aligns: ['bad', 'chaotic'],
      minDepth: 5,
      weight: 1.1,
      cue: { shake: { intensity: 0.5, ms: 1000 }, embers: 8 },
      hpDelta: -6,
    },
    {
      id: 'pk:nam:leeches',
      kind: 'vermin',
      bannerText: 'CHECK YOUR BOOTS. SOMETHING FOUND YOU HOURS AGO.',
      aligns: ['bad'],
      minDepth: 6,
      weight: 0.9,
      cue: { glitch: 400, melt: 0.2 },
      hpDelta: -7,
    },
    {
      id: 'pk:nam:tree-line',
      kind: 'dread',
      bannerText: 'THE TREE LINE IS NEARER THAN IT WAS AN HOUR AGO.',
      aligns: ['bad', 'chaotic'],
      minDepth: 7,
      weight: 0.8,
      cue: { shake: { intensity: 0.3, ms: 800 }, scanlines: true },
      hpDelta: -8,
    },
    {
      id: 'pk:nam:tripwire',
      kind: 'tripwire',
      bannerText: 'A THIN BRIGHT LINE AT ANKLE HEIGHT. DO NOT EXHALE.',
      aligns: ['bad', 'chaotic'],
      minDepth: 8,
      weight: 0.7,
      cue: { flash: { color: 0xffffff, ms: 90 }, shake: { intensity: 0.6, ms: 600 } },
      hpDelta: -12,
    },

    /* --- the one invert --------------------------------------------------- */
    {
      id: 'pk:nam:swapped-compass',
      kind: 'navigation',
      bannerText: 'THE COMPASS SWAPS NORTH FOR ELSEWHERE. CONTROLS SWAPPED.',
      aligns: ['chaotic'],
      minDepth: 9,
      weight: 0.55,
      cue: { invert: 800, glitch: 350 },
      hpDelta: -5,
    },
  ],
};
