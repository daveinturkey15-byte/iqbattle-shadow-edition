import type { PackCue } from '../fate/pack-kit.ts';
import type { RewardId } from '../fate/rewards.ts';
import './backdrops.ts';
import { list, type Align, type WorldDef } from './registry.ts';

export interface EncounterEvent {
  id: string;
  bannerText: string;
  cue?: PackCue;
  hpDelta?: number;
  scoreMul?: number;
  rewardId?: RewardId | null;
}

export interface WorldPressure {
  id: string;
  hpDelta: number;
  scoreMul: number;
  cue: PackCue;
}

export interface WorldEncounter {
  id: string;
  eventId: string;
  worldId: string;
  align: Align;
  bannerText: string;
  pressure: WorldPressure;
  identitySeed: number;
  rewardId: RewardId | null;
}

interface Rider {
  hpDelta: number;
  scoreMul: number;
  cue: PackCue;
}

const DEFAULT_RIDER: Record<Align, Rider> = {
  bad: { hpDelta: -3, scoreMul: 1, cue: { shake: { intensity: 0.25, ms: 180 } } },
  chaotic: { hpDelta: -2, scoreMul: 1, cue: { glitch: 180 } },
  neutral: { hpDelta: 0, scoreMul: 1, cue: { scanlines: true } },
  good: { hpDelta: 4, scoreMul: 1.05, cue: { flash: { color: 0x22d3a5, ms: 140 } } },
};

const WORLD_RIDERS: Record<string, Partial<Record<Align, Rider>>> = {
  'acid-rain': { bad: { hpDelta: -5, scoreMul: 1, cue: { melt: 0.22, flash: { color: 0x9be15d, ms: 130 } } } },
  'arena-lights': { chaotic: { hpDelta: -1, scoreMul: 1.15, cue: { flash: { color: 0x7dd3fc, ms: 140 } } } },
  'cave-crystal': { neutral: { hpDelta: 2, scoreMul: 1.05, cue: { flash: { color: 0x7dd3fc, ms: 140 } } } },
  'dolphin-pod': { good: { hpDelta: 8, scoreMul: 1.1, cue: { flash: { color: 0x38bdf8, ms: 160 } } } },
  'golden-mastermind': { good: { hpDelta: 5, scoreMul: 1.1, cue: { flash: { color: 0xffd700, ms: 160 } } } },
  'green-war': { neutral: { hpDelta: -1, scoreMul: 1, cue: { shake: { intensity: 0.15, ms: 150 } } } },
  'shark-shelf': { bad: { hpDelta: -7, scoreMul: 1.05, cue: { shake: { intensity: 0.4, ms: 180 } } } },
  'sanctuary': { good: { hpDelta: 6, scoreMul: 1.05, cue: { flash: { color: 0xe2ebf5, ms: 140 } } } },
  'volcano': { bad: { hpDelta: -5, scoreMul: 1, cue: { embers: 24, shake: { intensity: 0.3, ms: 180 } } } },
};

const PACK_WORLDS: Record<string, Partial<Record<Align, readonly string[]>>> = {
  ailments: { bad: ['acid-rain'] },
  arcade: { chaotic: ['cyber-hunt', 'sky-laser'], good: ['golden-mastermind'] },
  brit: { bad: ['trench'], neutral: ['mountain-ascent'], good: ['garden', 'stars'] },
  cavern: { bad: ['dragon-hoard', 'serpent-pit', 'abyss'], neutral: ['cave-crystal'] },
  court: { chaotic: ['arena-lights'], neutral: ['golden-mastermind'] },
  'deep-blue': { bad: ['shark-shelf'], good: ['dolphin-pod'] },
  divine: { good: ['sanctuary', 'heaven', 'golden-mastermind'], bad: ['hell-7-throne-of-ash'] },
  dread: { bad: ['basement', 'black-hole', 'abyss', 'hell-1-outer-dark'], chaotic: ['black-hole'] },
  gunship: { bad: ['trench', 'riot'], neutral: ['green-war'] },
  mantles: { bad: ['volcano', 'dragon-hoard'], neutral: ['mountain-ascent'] },
  nam: { bad: ['trench'], neutral: ['green-war', 'jungle'] },
  stadium: { chaotic: ['arena-lights'] },
  stones: { neutral: ['cave-crystal', 'mountain-ascent'] },
  tower: { bad: ['basement'], neutral: ['stair-of-heaven', 'mountain-ascent'] },
  undead: { bad: ['abyss', 'serpent-pit'], chaotic: ['black-hole'] },
  vermin: { chaotic: ['ant-tide', 'spider-nest'] },
};

function hashIdentity(seed: number, depth: number, identity: string): number {
  let hash = (seed ^ Math.imul(depth, 0x9e3779b1) ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < identity.length; i++) {
    hash = Math.imul(hash ^ identity.charCodeAt(i), 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  return hash >>> 0;
}

function packId(eventId: string): string | null {
  const parts = eventId.split(':');
  return parts[0] === 'pk' ? parts[1] ?? null : null;
}

function worldFor(seed: number, depth: number, align: Align, eventId: string): WorldDef {
  const aligned = list().filter((world) => world.align === align);
  if (aligned.length === 0) throw new Error(`no registered worlds for '${align}'`);

  const hintedIds = PACK_WORLDS[packId(eventId) ?? '']?.[align] ?? [];
  const hinted = aligned.filter((world) => hintedIds.includes(world.id));
  const pool = hinted.length > 0 ? hinted : aligned;
  return pool[hashIdentity(seed, depth, eventId) % pool.length]!;
}

function titleFromId(worldId: string): string {
  return worldId.replace(/[^a-z0-9]+/gi, ' ').trim().toUpperCase();
}

/** Resolve one event, its aligned backdrop and its bounded gameplay rider from the same identity. */
export function resolveEncounter(
  seed: number,
  depth: number,
  align: Align,
  event: EncounterEvent | null = null,
): WorldEncounter {
  const sourceId = event?.id || `world:${align}:${depth}`;
  const world = worldFor(seed, depth, align, sourceId);
  const rider = WORLD_RIDERS[world.id]?.[align] ?? DEFAULT_RIDER[align];
  const eventId = event?.id || `world:${world.id}:${depth}`;
  const pressure: WorldPressure = {
    id: eventId,
    hpDelta: Math.max(-8, Math.min(8, event?.hpDelta ?? rider.hpDelta)),
    scoreMul: Math.max(0.8, Math.min(1.2, event?.scoreMul ?? rider.scoreMul)),
    cue: event?.cue ?? rider.cue,
  };
  const identity = `${eventId}:${world.id}`;
  return {
    id: eventId,
    eventId,
    worldId: world.id,
    align,
    bannerText: event?.bannerText || `WORLD PRESSURE · ${titleFromId(world.id)}`,
    pressure,
    identitySeed: hashIdentity(seed, depth, identity),
    rewardId: event?.rewardId ?? null,
  };
}
