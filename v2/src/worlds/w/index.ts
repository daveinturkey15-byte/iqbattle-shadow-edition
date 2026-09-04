/**
 * P5 WORLDS — the named settings from the owner's spec that existed only as
 * events until now. Importing this module registers all 22.
 *
 * Every file here obeys src/worlds/w/kit.ts: draw() is a pure f(t) over fixed
 * constants, variation comes only from hash(i), and motion gating is handled
 * upstream by applyBackdrop. The worlds gate asserts determinism AND that no
 * two worlds paint the same op stream — bulk-authored backdrops are exactly
 * where near-duplicates hide.
 */
import { register } from '../registry.ts';
import { WORLD as W_JUNGLE } from './jungle.ts';
import { WORLD as W_CAVE_CRYSTAL } from './cave-crystal.ts';
import { WORLD as W_DRAGON_HOARD } from './dragon-hoard.ts';
import { WORLD as W_MOUNTAIN_ASCENT } from './mountain-ascent.ts';
import { WORLD as W_BASEMENT } from './basement.ts';
import { WORLD as W_STAIR_OF_HEAVEN } from './stair-of-heaven.ts';
import { WORLD as W_ABYSS } from './abyss.ts';
import { WORLD as W_BLACK_HOLE } from './black-hole.ts';
import { WORLD as W_SHARK_SHELF } from './shark-shelf.ts';
import { WORLD as W_DOLPHIN_POD } from './dolphin-pod.ts';
import { WORLD as W_SERPENT_PIT } from './serpent-pit.ts';
import { WORLD as W_SPIDER_NEST } from './spider-nest.ts';
import { WORLD as W_ANT_TIDE } from './ant-tide.ts';
import { WORLD as W_ACID_RAIN } from './acid-rain.ts';
import { WORLD as W_GREEN_WAR } from './green-war.ts';
import { WORLD as W_ARENA_LIGHTS } from './arena-lights.ts';
import { WORLD as W_SYMBIOTE_PARTY } from './symbiote-party.ts';
import { WORLD as W_DOLL_HOUSE } from './doll-house.ts';
import { WORLD as W_WASTELAND_ROAD } from './wasteland-road.ts';
import { WORLD as W_CYBER_HUNT } from './cyber-hunt.ts';
import { WORLD as W_SKY_LASER } from './sky-laser.ts';
import { WORLD as W_GOLDEN_MASTERMIND } from './golden-mastermind.ts';

/** Fixed order — the registry's pick() consumes one variate over this list. */
export const P5_WORLDS = [
  W_JUNGLE,
  W_CAVE_CRYSTAL,
  W_DRAGON_HOARD,
  W_MOUNTAIN_ASCENT,
  W_BASEMENT,
  W_STAIR_OF_HEAVEN,
  W_ABYSS,
  W_BLACK_HOLE,
  W_SHARK_SHELF,
  W_DOLPHIN_POD,
  W_SERPENT_PIT,
  W_SPIDER_NEST,
  W_ANT_TIDE,
  W_ACID_RAIN,
  W_GREEN_WAR,
  W_ARENA_LIGHTS,
  W_SYMBIOTE_PARTY,
  W_DOLL_HOUSE,
  W_WASTELAND_ROAD,
  W_CYBER_HUNT,
  W_SKY_LASER,
  W_GOLDEN_MASTERMIND,
] as const;

for (const w of P5_WORLDS) register(w);
