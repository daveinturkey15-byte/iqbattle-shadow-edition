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
    rotation: s.rotation,
    fog: s.fog ? { ...s.fog } : undefined,
    ink: s.ink ? { ...s.ink } : undefined,
    scanline: s.scanline ? { ...s.scanline } : undefined,
    tilt: s.tilt ? { ...s.tilt } : undefined,
    pianoKeys: s.pianoKeys,
    inverted: s.inverted,
    optionOrder: s.optionOrder ? [...s.optionOrder] : undefined,
  };
}

function sameState(a: BoardTarget, b: BoardTarget): boolean {
  if (a.scale.x !== b.scale.x || a.scale.y !== b.scale.y) return false;
  if (a.x !== b.x || a.y !== b.y) return false;
  if (a.rotation !== b.rotation) return false;
  if (a.pianoKeys !== b.pianoKeys) return false;
  if (a.inverted !== b.inverted) return false;
  const fa = a.fog;
  const fb = b.fog;
  if ((fa === undefined) !== (fb === undefined)) return false;
  if (fa && fb && (fa.alpha !== fb.alpha || fa.x !== fb.x || fa.y !== fb.y || fa.r !== fb.r)) return false;
  const ia = a.ink;
  const ib = b.ink;
  if ((ia === undefined) !== (ib === undefined)) return false;
  if (ia && ib && (ia.alpha !== ib.alpha || ia.x !== ib.x || ia.y !== ib.y || ia.r !== ib.r)) return false;
  const sa = a.scanline;
  const sb = b.scanline;
  if ((sa === undefined) !== (sb === undefined)) return false;
  if (sa && sb && (sa.f !== sb.f || sa.bandH !== sb.bandH || sa.alpha !== sb.alpha)) return false;
  const ta = a.tilt;
  const tb = b.tilt;
  if ((ta === undefined) !== (tb === undefined)) return false;
  if (ta && tb && ta.pitch !== tb.pitch) return false;
  const oa = a.optionOrder;
  const ob = b.optionOrder;
  if ((oa === undefined) !== (ob === undefined)) return false;
  if (oa && ob) {
    if (oa.length !== ob.length) return false;
    for (let i = 0; i < oa.length; i++) if (oa[i] !== ob[i]) return false;
  }
  return true;
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

  check('MODIFIERS registry contains exactly the expected modifiers', () => {
    assert(MODIFIERS.length === 12, `expected 12 modifiers, got ${MODIFIERS.length}`);
    const ids = MODIFIERS.map((m) => m.id);
    assert(ids.includes('mirror-flip'), 'missing mirror-flip modifier');
    assert(ids.includes('board-drift'), 'missing board-drift modifier');
    assert(ids.includes('rotate-90'), 'missing rotate-90 modifier');
    assert(ids.includes('breathing'), 'missing breathing modifier');
    assert(ids.includes('lurch'), 'missing lurch modifier');
    assert(ids.includes('inverted-controls'), 'missing inverted-controls modifier');
    assert(ids.includes('option-shuffle'), 'missing option-shuffle modifier');
    assert(ids.includes('fog-bank'), 'missing fog-bank modifier');
    assert(ids.includes('ink-splatter'), 'missing ink-splatter modifier');
    assert(ids.includes('scanline-roll'), 'missing scanline-roll modifier');
    assert(ids.includes('piano-keys'), 'missing piano-keys modifier');
    assert(ids.includes('tilt-3d'), 'missing tilt-3d modifier');
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
          sameState(appliedStateA, appliedStateB),
          `[${mod.id} seed=${seed} depth=${depth}] non-deterministic apply under motion=true`
        );

        // Teardown check: restores exact pre-apply values
        teardownA();
        assert(
          sameState(initialA, snapshotA),
          `[${mod.id} seed=${seed} depth=${depth}] teardown failed to restore exact pre-apply values (motion=true)`
        );

        teardownB();
        assert(
          sameState(initialB, snapshotA),
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
          sameState(staticAppliedA, staticAppliedB),
          `[${mod.id} seed=${seed} depth=${depth}] non-deterministic apply under motion=false`
        );

        // Teardown check for static variant
        staticTeardownA();
        assert(
          sameState(staticStubA, staticSnapshot),
          `[${mod.id} seed=${seed} depth=${depth}] teardown failed to restore exact pre-apply values (motion=false)`
        );

        staticTeardownB();
        assert(
          sameState(staticStubB, staticSnapshot),
          `[${mod.id} seed=${seed} depth=${depth}] teardownB failed to restore exact pre-apply values (motion=false)`
        );
      }
    });
  }

  /* P5: scanline-roll — the gate asserts the state main.ts actually paints:
   * scene.scanline = { f, bandH, alpha }. A no-op implementation (never
   * setting the field) fails here. */
  const sl = MODIFIERS.find((m) => m.id === 'scanline-roll');
  check(`scanline-roll painted state (${SEED_COUNT} seeds)`, () => {
    assert(!!sl, 'scanline-roll missing from MODIFIERS');
    if (!sl) return;
    for (let i = 0; i < SEED_COUNT; i++) {
      const seed = (i * 1664525 + 1013904223) >>> 0;
      const depth = (i % 25) + 1;
      const layer = i % 5;
      const align = ALIGNS[i % ALIGNS.length]!;
      const ctx: ModCtx = { depth, seed, layer, align, motion: true };

      const stubA = createStub(1, 1, 150, 250);
      const stopA = sl.apply(ctx, stubA);
      assert(stopA.step !== undefined, `[scanline-roll seed=${seed}] motion stop must expose step(tMs) for the scene tick`);

      const a0 = stubA.scanline;
      if (!a0) {
        assert(false, `[scanline-roll seed=${seed}] motion apply must set scene.scanline (main.ts paints from it)`);
        continue;
      }
      assert(a0.alpha >= 0.2 && a0.alpha <= 0.4, `[scanline-roll seed=${seed}] alpha out of 0.2–0.4 cap (got ${a0.alpha})`);
      assert(a0.bandH >= 24 && a0.bandH <= 48, `[scanline-roll seed=${seed}] bandH out of 24–48 (got ${a0.bandH})`);
      assert(a0.f > 0 && a0.f < 1, `[scanline-roll seed=${seed}] band centre f outside 0..1 (got ${a0.f})`);

      // Determinism: a second apply at the same seed yields the same state.
      const stubB = createStub(1, 1, 150, 250);
      const stopB = sl.apply(ctx, stubB);
      assert(sameState(stubA, stubB), `[scanline-roll seed=${seed}] non-deterministic apply (motion=true)`);

      // The state must actually move under step(tMs) — this is what makes the
      // band roll on screen. Sample the same clock the scene tick uses.
      let sawMovement = false;
      for (const t of [250, 500, 750, 1000, 1500, 2000, 4000]) {
        stopA.step!(t);
        const cur = stubA.scanline!;
        if (cur.f !== a0.f || cur.bandH !== a0.bandH || cur.alpha !== a0.alpha) sawMovement = true;
        assert(cur.f > 0 && cur.f < 1, `[scanline-roll seed=${seed}] f left 0..1 at t=${t} (got ${cur.f})`);
      }
      assert(sawMovement, `[scanline-roll seed=${seed}] band never moved across step(250..4000)`);
      // Alpha and bandH are constants for the round: only f may move.
      assert(stubA.scanline!.bandH === a0.bandH && stubA.scanline!.alpha === a0.alpha,
        `[scanline-roll seed=${seed}] bandH/alpha drifted during the round`);

      // Teardown: deletes the field (it was absent before apply).
      stopA();
      assert(stubA.scanline === undefined, `[scanline-roll seed=${seed}] teardown did not delete scene.scanline (motion=true)`);
      stopB();
      assert(stubB.scanline === undefined, `[scanline-roll seed=${seed}] teardownB did not delete scene.scanline (motion=true)`);

      // Static variant: pinned band, NO step (no reported movement), still valid.
      const sctx: ModCtx = { depth, seed, layer, align, motion: false };
      const sStub = createStub(1.5, 0.8, -50, 75);
      const sStop = sl.apply(sctx, sStub);
      const sState = sStub.scanline;
      assert(!!sState, `[scanline-roll seed=${seed}] static apply must set scene.scanline`);
      assert(sState !== undefined && sState.alpha >= 0.2 && sState.alpha <= 0.4,
        `[scanline-roll seed=${seed}] static alpha out of cap (got ${sState?.alpha})`);
      assert(sState !== undefined && sState.f > 0 && sState.f < 1,
        `[scanline-roll seed=${seed}] static f outside 0..1 (got ${sState?.f})`);
      assert(sStop.step === undefined, `[scanline-roll seed=${seed}] motion=false stop must NOT expose step (no reported movement)`);
      sStop();
      assert(sStub.scanline === undefined, `[scanline-roll seed=${seed}] teardown did not delete scene.scanline (motion=false)`);
    }
  });

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
