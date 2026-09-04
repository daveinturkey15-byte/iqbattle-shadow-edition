/**
 * PACK-KIT — the shared contract for P4 event packs (fate breadth 64 -> ~200).
 *
 * WHY A NEW SHAPE. flavor-a.ts grew by hand-maintained cumulative windows
 * (W_FA_* constants) plus a hand-written `ownIds` table in its own selftest.
 * That works at 36 events and is unmaintainable at 200: every new event has to
 * be threaded through three places, and the id table drifts silently. A pack is
 * instead pure data with its own eligibility and weight, and ONE weighted
 * picker reads whatever is registered. Adding an event is adding a record.
 *
 * THE RULE THAT MAKES THIS WORTH DOING (PLAN-RESTORE-THE-VISION.md P4):
 * every event ships as `banner + a chaos-bus cue + an optional rider`. A
 * text-only event does not count as done — that is exactly what made the
 * original 28 feel like nothing. `cue` is therefore REQUIRED and must carry at
 * least one field; `validatePack()` rejects an empty one.
 *
 * Purity: packs are data. No Pixi, no DOM, no timers, no Math.random,
 * no Date.now. The engine (main.ts) performs the cue through the chaos bus and
 * applies the riders; nothing in here imports the bus.
 */

import { type FateCtx } from './fate.ts';

export type PackAlign = 'good' | 'bad' | 'chaotic' | 'neutral';

/**
 * Declarative chaos-bus cue — PURE DATA, identical in shape to the cue on
 * FateMod / FlavorMod / CurseMod so main.ts's performCue() takes it unchanged.
 * Limits: flash.ms <= 200, shake.intensity <= 1, embers <= 64, melt 0..1.
 */
export interface PackCue {
  shake?: { intensity: number; ms: number };
  glitch?: number;          // ms
  flash?: { color: number; ms: number };
  embers?: number;
  scanlines?: boolean;
  melt?: number;            // 0..1
  invert?: number;          // ms
}

export interface PackEvent {
  /** 'pk:<packId>:<slug>' — namespace keeps it disjoint from fa:/fb:/cp2:/fate. */
  id: string;
  /** Free tone label, for reading the roster. Not consumed by the engine. */
  kind: string;
  /** Banner row text. <= BANNER_MAX chars (main.ts slices at 90). */
  bannerText: string;
  /** Round alignments this event may fire on. Non-empty. */
  aligns: readonly PackAlign[];
  /** Earliest depth this may fire on. >= 1. Rounds 1-2 stay baseline: use >= 3. */
  minDepth: number;
  /** Relative weight inside the eligible set. > 0. */
  weight: number;
  /** REQUIRED and non-empty — see the module header. */
  cue: PackCue;

  /* ---- optional riders ------------------------------------------------
   * ONLY the two the engine really applies are allowed here. main.ts honours
   * hpDelta and scoreMul generically, and performs cue.invert through the
   * chaos bus. It does NOT read timerDelta (r.timerLen is run-wide and
   * broadcast to clients — mutating it per round would desync the room),
   * nextCorrectMul, or an opaque `flag`. Declaring one of those would ship an
   * event that reads mechanical and does nothing: the exact stub drift that
   * left seven round modifiers as silent no-ops. If the engine ever grows a
   * handler, widen this type and the ALLOWED_KEYS gate in the same commit. */
  /** hp change, -60..60 (main.ts clamps hp to 0..100 anyway). */
  hpDelta?: number;
  /** this round's score multiplier, > 0. Multiplies into run.fateScoreMul. */
  scoreMul?: number;
}

/** The complete field set. Anything else on an event is invented — see above. */
export const ALLOWED_KEYS: readonly string[] = [
  'id', 'kind', 'bannerText', 'aligns', 'minDepth', 'weight', 'cue', 'hpDelta', 'scoreMul',
];

export interface PackDef {
  /** Short slug, matches the middle segment of every event id. */
  id: string;
  /** Human title for reports. */
  title: string;
  events: readonly PackEvent[];
}

/* ------------------------------------------------------------------ */
/* Limits (mirror selftest-fate.ts / chaos.ts — data limits, not the bus) */
/* ------------------------------------------------------------------ */

export const BANNER_MAX = 90;
export const FLASH_MAX_MS = 200;
export const SHAKE_MAX_AMP = 1;
export const MAX_EMBERS = 64;
export const HP_MAX_ABS = 60;

export const INVERT_MAX_MS = 1500;

const ALIGNS: readonly PackAlign[] = ['good', 'bad', 'chaotic', 'neutral'];

/**
 * Validate one pack. Returns a list of failures (empty = valid).
 * This is the single source of truth the pack gate and every pack's own
 * `selfTest()` both call — there is no second copy of these rules.
 */
export function validatePack(p: PackDef): string[] {
  const f: string[] = [];
  const push = (m: string): void => { f.push(m); };

  if (!p.id || !/^[a-z0-9-]+$/.test(p.id)) push(`pack id "${p.id}" must be lower-kebab`);
  if (!p.title) push(`pack ${p.id}: empty title`);
  if (!Array.isArray(p.events)) { push(`pack ${p.id}: events is not an array`); return f; }

  const seen = new Set<string>();
  for (const e of p.events) {
    const at = `${p.id}/${e.id}`;

    if (typeof e.id !== 'string' || !e.id) { push(`${p.id}: event with empty id`); continue; }
    if (!e.id.startsWith(`pk:${p.id}:`)) push(`${at}: id must start with "pk:${p.id}:"`);
    if (!/^pk:[a-z0-9-]+:[a-z0-9-]+$/.test(e.id)) push(`${at}: id must be pk:<pack>:<slug>, lower-kebab`);
    if (seen.has(e.id)) push(`${at}: duplicate id inside the pack`);
    seen.add(e.id);

    if (typeof e.kind !== 'string' || !e.kind) push(`${at}: empty kind`);

    if (typeof e.bannerText !== 'string' || !e.bannerText) push(`${at}: empty bannerText`);
    else if (e.bannerText.length > BANNER_MAX)
      push(`${at}: bannerText ${e.bannerText.length} chars > ${BANNER_MAX}`);

    if (!Array.isArray(e.aligns) || e.aligns.length === 0) push(`${at}: aligns must be non-empty`);
    else for (const a of e.aligns) if (!ALIGNS.includes(a)) push(`${at}: unknown align "${a}"`);

    if (!Number.isInteger(e.minDepth) || e.minDepth < 1) push(`${at}: minDepth must be an int >= 1`);
    if (!(typeof e.weight === 'number' && e.weight > 0 && Number.isFinite(e.weight)))
      push(`${at}: weight must be a finite number > 0`);

    /* The P4 rule: banner + chaos-bus cue. A text-only event is not done. */
    if (!e.cue || typeof e.cue !== 'object') push(`${at}: cue is REQUIRED (text-only events do not count)`);
    else {
      const c = e.cue;
      const fields = ['shake', 'glitch', 'flash', 'embers', 'scanlines', 'melt', 'invert'] as const;
      if (!fields.some((k) => c[k] !== undefined)) push(`${at}: cue is empty — it must do something on screen`);
      if (c.shake !== undefined) {
        if (!(c.shake.intensity > 0 && c.shake.intensity <= SHAKE_MAX_AMP))
          push(`${at}: shake.intensity ${c.shake.intensity} outside 0..${SHAKE_MAX_AMP}`);
        if (!(c.shake.ms > 0 && c.shake.ms <= 2000)) push(`${at}: shake.ms ${c.shake.ms} outside 1..2000`);
      }
      if (c.glitch !== undefined && !(c.glitch > 0 && c.glitch <= 2000))
        push(`${at}: glitch ${c.glitch} outside 1..2000 ms`);
      if (c.flash !== undefined) {
        if (!(c.flash.ms > 0 && c.flash.ms <= FLASH_MAX_MS))
          push(`${at}: flash.ms ${c.flash.ms} outside 1..${FLASH_MAX_MS}`);
        if (!(Number.isInteger(c.flash.color) && c.flash.color >= 0 && c.flash.color <= 0xffffff))
          push(`${at}: flash.color not a 0x000000..0xffffff int`);
      }
      if (c.embers !== undefined && !(c.embers >= 0 && c.embers <= MAX_EMBERS))
        push(`${at}: embers ${c.embers} outside 0..${MAX_EMBERS}`);
      if (c.melt !== undefined && !(c.melt >= 0 && c.melt <= 1)) push(`${at}: melt ${c.melt} outside 0..1`);
      if (c.invert !== undefined && !(c.invert > 0 && c.invert <= INVERT_MAX_MS))
        push(`${at}: cue.invert ${c.invert} outside 1..${INVERT_MAX_MS} ms`);
    }

    if (e.hpDelta !== undefined && !(Number.isFinite(e.hpDelta) && Math.abs(e.hpDelta) <= HP_MAX_ABS))
      push(`${at}: hpDelta ${e.hpDelta} outside +-${HP_MAX_ABS}`);
    if (e.scoreMul !== undefined && !(e.scoreMul > 0 && e.scoreMul <= 5))
      push(`${at}: scoreMul ${e.scoreMul} outside 0..5`);

    /* No invented fields. A rider the engine never reads is a silent no-op
     * dressed as a mechanic — see ALLOWED_KEYS. */
    for (const k of Object.keys(e))
      if (!ALLOWED_KEYS.includes(k))
        push(`${at}: field "${k}" is not part of the event contract (the engine never reads it)`);

    /* Fairness rail: if it changes the CONTROLS, the banner must say so —
     * same lesson as the goal cards (PLAN-RESTORE-THE-VISION.md P1 rail 5). */
    const inverts = (e.cue?.invert ?? 0) > 0;
    if (inverts && !/INVERT|REVERS|MIRROR|BACKWARD|SWAP/i.test(e.bannerText))
      push(`${at}: inverts the controls but the banner never says so`);

    /* Fairness rail: a good round must never be a punishment. */
    if (e.aligns.length === 1 && e.aligns[0] === 'good' && (e.hpDelta ?? 0) < 0)
      push(`${at}: good-only event with negative hpDelta`);
  }

  return f;
}

/** Eligibility: a pack event may fire on this round. Pure. */
export function eligible(e: PackEvent, ctx: FateCtx): boolean {
  return ctx.depth >= e.minDepth && e.aligns.includes(ctx.align as PackAlign);
}
