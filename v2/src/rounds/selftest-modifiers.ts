/* ============================================================================
 * ROUND MODIFIERS SELFTEST — verifies determinism, teardown purity, static
 * accessibility variants, and modifier picking gates over 200+ seeded rounds.
 *
 * Run from v2/:
 *   node --experimental-strip-types src/rounds/selftest-modifiers.ts
 * ==========================================================================*/

import {
  MODIFIERS,
  pickModifiers,
  type BoardTarget,
  type ModCtx,
} from './modifiers.ts';

function createStub(sx = 1, sy = 1, x = 100, y = 200): BoardTarget {
  return {
    scale: { x: sx, y: sy },
    x,
    y,
  };
}

function cloneStub(s: BoardTarget): BoardTarget {
  return {
    scale: { x: s.scale.x, y: s.scale.y },
    x: s.x,
    y: s.y,
  };
}

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  function assert(cond: boolean, msg: string): void {
    if (!cond) failures.push(msg);
  }

  function check(name: string, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      failures.push(name + ': ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  check('MODIFIERS registry contains exactly the two expected modifiers', () => {
    assert(MODIFIERS.length === 2, `expected 2 modifiers, got ${MODIFIERS.length}`);
    const ids = MODIFIERS.map((m) => m.id);
    assert(ids.includes('mirror-flip'), 'missing mirror-flip modifier');
    assert(ids.includes('board-drift'), 'missing board-drift modifier');
  });

  const ALIGNS = ['chaos', 'order', 'void', 'nexus'];
  const SEED_COUNT = 200;

  for (const mod of MODIFIERS) {
    check(`modifier ${mod.id} determinism, teardown and static behavior over ${SEED_COUNT} seeds`, () => {
      for (let i = 0; i < SEED_COUNT; i++) {
        const seed = (i * 1664525 + 1013904223) >>> 0;
        const depth = (i % 25) + 1;
        const layer = i % 5;
        const align = ALIGNS[i % ALIGNS.length]!;

        // 1. Dynamic / Motion variant
        const motionCtx: ModCtx = { depth, seed, layer, align, motion: true };
        const initialA = createStub(1, 1, 150, 250);
        const initialB = createStub(1, 1, 150, 250);
        const snapshotA = cloneStub(initialA);

        const teardownA = mod.apply(motionCtx, initialA);
        const appliedStateA = cloneStub(initialA);

        const teardownB = mod.apply(motionCtx, initialB);
        const appliedStateB = cloneStub(initialB);

        // Determinism check: same (seed, depth) produces identical state
        assert(
          appliedStateA.scale.x === appliedStateB.scale.x &&
            appliedStateA.scale.y === appliedStateB.scale.y &&
            appliedStateA.x === appliedStateB.x &&
            appliedStateA.y === appliedStateB.y,
          `[${mod.id} seed=${seed} depth=${depth}] non-deterministic apply under motion=true`
        );

        // Teardown check: restores exact pre-apply values
        teardownA();
        assert(
          initialA.scale.x === snapshotA.scale.x &&
            initialA.scale.y === snapshotA.scale.y &&
            initialA.x === snapshotA.x &&
            initialA.y === snapshotA.y,
          `[${mod.id} seed=${seed} depth=${depth}] teardown failed to restore exact pre-apply values (motion=true)`
        );

        teardownB();
        assert(
          initialB.scale.x === snapshotA.scale.x &&
            initialB.scale.y === snapshotA.scale.y &&
            initialB.x === snapshotA.x &&
            initialB.y === snapshotA.y,
          `[${mod.id} seed=${seed} depth=${depth}] teardownB failed to restore exact pre-apply values (motion=true)`
        );

        // 2. Static / No-motion variant
        const staticCtx: ModCtx = { depth, seed, layer, align, motion: false };
        const staticStubA = createStub(1.5, 0.8, -50, 75);
        const staticStubB = createStub(1.5, 0.8, -50, 75);
        const staticSnapshot = cloneStub(staticStubA);

        const staticTeardownA = mod.apply(staticCtx, staticStubA);
        const staticAppliedA = cloneStub(staticStubA);

        const staticTeardownB = mod.apply(staticCtx, staticStubB);
        const staticAppliedB = cloneStub(staticStubB);

        // Determinism check for static variant
        assert(
          staticAppliedA.scale.x === staticAppliedB.scale.x &&
            staticAppliedA.scale.y === staticAppliedB.scale.y &&
            staticAppliedA.x === staticAppliedB.x &&
            staticAppliedA.y === staticAppliedB.y,
          `[${mod.id} seed=${seed} depth=${depth}] non-deterministic apply under motion=false`
        );

        // Teardown check for static variant
        staticTeardownA();
        assert(
          staticStubA.scale.x === staticSnapshot.scale.x &&
            staticStubA.scale.y === staticSnapshot.scale.y &&
            staticStubA.x === staticSnapshot.x &&
            staticStubA.y === staticSnapshot.y,
          `[${mod.id} seed=${seed} depth=${depth}] teardown failed to restore exact pre-apply values (motion=false)`
        );

        staticTeardownB();
        assert(
          staticStubB.scale.x === staticSnapshot.scale.x &&
            staticStubB.scale.y === staticSnapshot.scale.y &&
            staticStubB.x === staticSnapshot.x &&
            staticStubB.y === staticSnapshot.y,
          `[${mod.id} seed=${seed} depth=${depth}] teardownB failed to restore exact pre-apply values (motion=false)`
        );
      }
    });
  }

  check(`pickModifiers determinism and max bound over ${SEED_COUNT} seeds`, () => {
    for (let i = 0; i < SEED_COUNT; i++) {
      const seed = (i * 1103515245 + 12345) >>> 0;
      const depth = (i % 20) + 1;
      const layer = i % 4;
      const align = ALIGNS[i % ALIGNS.length]!;

      for (const motion of [true, false]) {
        const ctx: ModCtx = { depth, seed, layer, align, motion };

        for (const max of [0, 1, 2, 5]) {
          const picked1 = pickModifiers(ctx, max);
          const picked2 = pickModifiers(ctx, max);

          assert(
            picked1.length <= max,
            `pickModifiers returned ${picked1.length} which exceeds max=${max} for seed=${seed}`
          );
          assert(
            picked1.length <= MODIFIERS.length,
            `pickModifiers returned ${picked1.length} which exceeds total modifiers count`
          );

          const ids1 = picked1.map((m) => m.id).join(',');
          const ids2 = picked2.map((m) => m.id).join(',');
          assert(
            ids1 === ids2,
            `pickModifiers non-deterministic for seed=${seed} depth=${depth} max=${max}: '${ids1}' vs '${ids2}'`
          );
        }
      }
    }
  });

  return { ok: failures.length === 0, failures };
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  Boolean(process.argv[1] && /selftest-modifiers(\.ts)?$/.test(process.argv[1].replace(/\\/g, '/')));

if (isMain) {
  const res = selfTest();
  if (res.ok) {
    console.log('[modifiers-selftest] ALL PASS');
    process.exit(0);
  } else {
    for (const f of res.failures) console.error('  FAIL ' + f);
    process.exit(1);
  }
}
