/* ============================================================================
 * PACK GATE — validates the shipped P4 event packs.
 *
 *   - every pack passes validatePack() (id namespace, banner fit, REQUIRED
 *     non-empty cue, cue/rider limits, control-inversion telegraphed)
 *   - every event id is unique across ALL fate modules, not just the packs
 *   - every registered pack carries at least MIN_PER_PACK events
 *   - every alignment has something eligible once the descent starts
 *   - maybePack is deterministic and only ever returns ids in the roster
 *   - the whole fate roster reaches the P4 target of 200 events
 *
 * Run from v2/:
 *   node --experimental-strip-types src/fate/selftest-packs.ts
 * ==========================================================================*/

import { FATES, FATE_INLINE_EVENTS, type FateCtx } from './fate.ts';
import { FA_EVENTS } from './flavor-a.ts';
import { COUNTRIES } from './flavor-b.ts';
import { CURSES, BLESSINGS } from './cursepack.ts';
import { eligible, validatePack, type PackAlign } from './pack-kit.ts';
import { PACKS, PACK_EVENTS, maybePack, PACK_MIN_DEPTH } from './packs/registry.ts';

/** P4 target from PLAN-RESTORE-THE-VISION.md: "Event breadth: 28 -> ~200". */
export const TARGET_TOTAL = 200;
/** A registered pack that is not filled in is a lie in the registry. */
export const MIN_PER_PACK = 10;

const ALIGNS: readonly PackAlign[] = ['good', 'bad', 'chaotic', 'neutral'];

/** Every event id shipped by the older fate modules. */
function legacyIds(): string[] {
  const out: string[] = [];
  for (const f of FATES) out.push(f().id);
  for (const f of COUNTRIES) out.push(f().id);
  for (const f of CURSES) out.push(f().id);
  for (const f of BLESSINGS) out.push(f().id);
  for (const e of FA_EVENTS) out.push(e.id);
  for (const e of FATE_INLINE_EVENTS) out.push(e.id);
  return out;
}

export function totalRosterSize(): number {
  return legacyIds().length + PACK_EVENTS.length;
}

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  function check(name: string, fn: () => void): void {
    try { fn(); } catch (e) {
      failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(msg); }

  /* --- per-pack structural validation ------------------------------------ */
  for (const p of PACKS) {
    check(`pack ${p.id} valid (${p.events.length} events)`, () => {
      const f = validatePack(p);
      assert(f.length === 0, f.slice(0, 6).join(' | ') + (f.length > 6 ? ` (+${f.length - 6} more)` : ''));
    });
    check(`pack ${p.id} carries >= ${MIN_PER_PACK} events`, () => {
      assert(p.events.length >= MIN_PER_PACK,
        `only ${p.events.length} — a registered pack must be filled in or removed`);
    });
  }

  /* --- global id uniqueness --------------------------------------------- */
  check(`every id unique across all fate modules (${totalRosterSize()} events)`, () => {
    const seen = new Set<string>();
    for (const id of [...legacyIds(), ...PACK_EVENTS.map((e) => e.id)]) {
      assert(!seen.has(id), `duplicate id "${id}"`);
      seen.add(id);
    }
  });

  /* --- coverage: nothing may leave an alignment empty -------------------- */
  check(`every alignment has eligible events from depth ${PACK_MIN_DEPTH}`, () => {
    for (const align of ALIGNS) {
      const ctx: FateCtx = { seed: 1, depth: PACK_MIN_DEPTH, align, hp: 50 };
      const n = PACK_EVENTS.filter((e) => eligible(e, ctx)).length;
      assert(n > 0, `align "${align}" has no eligible pack event at depth ${PACK_MIN_DEPTH}`);
    }
  });

  /* --- picker: only roster ids, over a wide sweep ------------------------ */
  check(`maybePack only ever returns ids in the shipped roster (400 seeds)`, () => {
    const roster = new Set(PACK_EVENTS.map((e) => e.id));
    const bad: string[] = [];
    for (let seed = 0; seed < 400; seed++) {
      for (const depth of [1, 2, 3, 7, 13, 21, 40]) {
        for (const align of ALIGNS) {
          const m = maybePack({ seed, depth, align, hp: 50 });
          if (m && !roster.has(m.id)) bad.push(m.id);
          if (m && depth < PACK_MIN_DEPTH) bad.push(`fired at depth ${depth}: ${m.id}`);
        }
      }
    }
    assert(bad.length === 0, [...new Set(bad)].slice(0, 6).join(', '));
  });

  /* --- picker: deterministic -------------------------------------------- */
  check(`maybePack deterministic for a given (seed, depth, align)`, () => {
    for (const seed of [1, 7, 42, 1337, 0xdeadbeef]) {
      for (const depth of [3, 5, 8, 12, 20]) {
        for (const align of ALIGNS) {
          const first = maybePack({ seed, depth, align, hp: 50 })?.id ?? null;
          for (let rep = 0; rep < 3; rep++) {
            assert((maybePack({ seed, depth, align, hp: 50 })?.id ?? null) === first,
              `seed=${seed} depth=${depth} align=${align} not deterministic`);
          }
        }
      }
    }
  });

  /* --- picker: the roster is actually reachable -------------------------- */
  check(`>= 80% of pack events are reachable over 4000 rolls`, () => {
    const hit = new Set<string>();
    for (let seed = 0; seed < 1000; seed++) {
      for (const align of ALIGNS) {
        const m = maybePack({ seed, depth: 12, align, hp: 50 });
        if (m) hit.add(m.id);
      }
    }
    const frac = PACK_EVENTS.length === 0 ? 0 : hit.size / PACK_EVENTS.length;
    assert(frac >= 0.8, `only ${hit.size}/${PACK_EVENTS.length} (${(frac * 100).toFixed(1)}%) reachable`);
  });

  /* --- the P4 target ----------------------------------------------------- */
  check(`fate roster reaches the P4 target of ${TARGET_TOTAL} events`, () => {
    const n = totalRosterSize();
    assert(n >= TARGET_TOTAL, `roster is ${n} events, target ${TARGET_TOTAL} (legacy ${legacyIds().length} + packs ${PACK_EVENTS.length})`);
  });

  return { ok: failures.length === 0, failures };
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  Boolean(process.argv[1] && /selftest-packs(\.ts)?$/.test(process.argv[1].replace(/\\/g, '/')));

if (isMain) {
  const res = selfTest();
  console.log(`[pack-selftest] roster: ${legacyIds().length} legacy + ${PACK_EVENTS.length} pack = ${totalRosterSize()} events across ${PACKS.length} packs`);
  if (res.ok) {
    console.log('[pack-selftest] ALL PASS');
    process.exit(0);
  } else {
    for (const f of res.failures) console.error('  FAIL ' + f);
    process.exit(1);
  }
}
