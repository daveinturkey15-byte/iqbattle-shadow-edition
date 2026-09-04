/**
 * PACK REGISTRY — every P4 event pack, and the ONE weighted picker that reads
 * them. Adding an event is adding a record to a pack file; nothing here
 * changes. That is the whole point of the pack shape (see ../pack-kit.ts).
 *
 * Roll scheme (single ctx draw, mirroring the other fate modules):
 *   depth < 3            : always null — rounds 1-2 stay baseline
 *   r >= W_PACK          : null
 *   r <  W_PACK          : one event, weighted, from the events eligible for
 *                          (depth, align)
 *
 * Determinism: own mulberry32 from (seed ^ depth-salt ^ PK_SALT) — a stream
 * distinct from FATE_SALT / FA_SALT / FB_SALT / CP_SALT — or the caller's
 * injected rng (host stream). Zero Math.random / Date.now. maybePack NEVER
 * mutates run state; it returns plain data the engine aggregates.
 */

import { mulberry32 } from '../../scenes/takeovers/redlight.ts';
import { type FateCtx } from '../fate.ts';
import { eligible, type PackDef, type PackEvent } from '../pack-kit.ts';

import { PACK_AILMENTS } from './ailments.ts';
import { PACK_ARCADE } from './arcade.ts';
import { PACK_BRIT } from './brit.ts';
import { PACK_CAVERN } from './cavern.ts';
import { PACK_COURT } from './court.ts';
import { PACK_DEEP_BLUE } from './deep-blue.ts';
import { PACK_DIVINE } from './divine.ts';
import { PACK_DREAD } from './dread.ts';
import { PACK_GUNSHIP } from './gunship.ts';
import { PACK_MANTLES } from './mantles.ts';
import { PACK_NAM } from './nam.ts';
import { PACK_STADIUM } from './stadium.ts';
import { PACK_STONES } from './stones.ts';
import { PACK_TOWER } from './tower.ts';
import { PACK_UNDEAD } from './undead.ts';
import { PACK_VERMIN } from './vermin.ts';

/** Every registered pack, in a fixed order (the order is part of the seed). */
export const PACKS: readonly PackDef[] = [
  PACK_AILMENTS,
  PACK_ARCADE,
  PACK_BRIT,
  PACK_CAVERN,
  PACK_COURT,
  PACK_DEEP_BLUE,
  PACK_DIVINE,
  PACK_DREAD,
  PACK_GUNSHIP,
  PACK_MANTLES,
  PACK_NAM,
  PACK_STADIUM,
  PACK_STONES,
  PACK_TOWER,
  PACK_UNDEAD,
  PACK_VERMIN,
];

/** Flat shipped roster — the gate validates THIS, never a copy. */
export const PACK_EVENTS: readonly PackEvent[] = PACKS.flatMap((p) => p.events);

/** Chance that a pack event fires at all on an eligible round. */
export const W_PACK = 0.3;

/** Rounds 1-2 stay baseline, same as flavor-a. */
export const PACK_MIN_DEPTH = 3;

/** Distinct stream salt — deliberately unlike FATE_SALT / FA_SALT / CP_SALT. */
const PK_SALT = 0x9c4a1;

/**
 * Roll one pack event for this round, or null.
 *
 * Two draws, always taken in the same order so the stream stays exact whether
 * or not the window hits: the first decides "does anything fire", the second
 * picks which. (Taking the second draw unconditionally is what keeps an
 * injected host rng in lockstep with a client's.)
 */
export function maybePack(ctx: FateCtx): PackEvent | null {
  const rng =
    ctx.rng ?? mulberry32(((ctx.seed ^ Math.imul(ctx.depth, 0x1f2f3) ^ PK_SALT) >>> 0));

  const r = rng();
  const pick = rng();

  if (ctx.depth < PACK_MIN_DEPTH) return null;
  if (r >= W_PACK) return null;

  const pool = PACK_EVENTS.filter((e) => eligible(e, ctx));
  if (pool.length === 0) return null;

  let total = 0;
  for (const e of pool) total += e.weight;
  let acc = pick * total;
  for (const e of pool) {
    acc -= e.weight;
    if (acc <= 0) return e;
  }
  return pool[pool.length - 1]!;
}
