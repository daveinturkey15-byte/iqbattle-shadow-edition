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
    invertMap: s.invertMap ? [...s.invertMap] : undefined,
    optionOrder: s.optionOrder ? [...s.optionOrder] : undefined,
  };
}

function sameState(a: BoardTarget, b: BoardTarget): boolean {
  if (a.scale.x !== b.scale.x || a.scale.y !== b.scale.y) return false;
  if (a.x !== b.x || a.y !== b.y) return false;
  if (a.rotation !== b.rotation) return false;
  if (a.pianoKeys !== b.pianoKeys) return false;
  if (a.inverted !== b.inverted) return false;
  const ma = a.invertMap;
  const mb = b.invertMap;
  if ((ma === undefined) !== (mb === undefined)) return false;
  if (ma && mb && (ma.length !== mb.length || ma.some((v, i) => v !== mb[i]))) return false;
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

/* The clock the scene tick drives step(tMs) with: 250 ms increments. Every
 * step-exposing modifier must visibly move across this sample. */
const TICK_SAMPLE_MS = [250, 500, 750, 1000, 1500, 2000, 4000];

/**
 * Ambient-clock trap. The modifier contract is "time arrives only as the
 * step(tMs) argument": no timers, no wall clock, no Math.random. Every one of
 * those globals is replaced for the duration of the gate; any call is recorded
 * against the modifier under test. A modifier that leaks a setInterval into
 * teardown, or reads Date.now inside step, fails here — even though the state
 * it produced might otherwise look deterministic in a single-process run.
 */
function trapAmbientClock(onCall: (what: string) => void): () => void {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Array<[Record<string, unknown>, string, unknown]> = [];
  const trap = (obj: Record<string, unknown>, key: string, ret: unknown): void => {
    if (!(key in obj)) return;
    saved.push([obj, key, obj[key]]);
    obj[key] = (): unknown => { onCall(key); return ret; };
  };
  trap(g, 'setInterval', 0);
  trap(g, 'setTimeout', 0);
  trap(g, 'setImmediate', 0);
  trap(g, 'requestAnimationFrame', 0);
  trap(g, 'queueMicrotask', undefined);
  trap(Math as unknown as Record<string, unknown>, 'random', 0);
  trap(Date as unknown as Record<string, unknown>, 'now', 0);
  if (typeof g.performance === 'object' && g.performance !== null) {
    trap(g.performance as Record<string, unknown>, 'now', 0);
  }
  return () => { for (const [obj, key, orig] of saved) obj[key] = orig; };
}

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  function assert(cond: boolean, msg: string): void {
    if (!cond) failures.push(msg);
  }

  let ambientPhase = 'gate setup';
  function check(name: string, fn: () => void): void {
    ambientPhase = name;
    try {
      fn();
    } catch (e) {
      failures.push(name + ': ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  const restoreClock = trapAmbientClock((what) => {
    failures.push(`[${ambientPhase}] ambient clock: ${what}() was called — time may only arrive via step(tMs)`);
  });
  try {
    runChecks();
  } finally {
    restoreClock();
  }
  return { ok: failures.length === 0, failures };

  function runChecks(): void {

  check('MODIFIERS registry contains exactly the expected modifiers', () => {
    /* Was `=== 12` — a snapshot of the roster, not a contract, and the fifth
     * hardcoded-roster gate this project has hit. What matters is that the
     * roster never silently SHRINKS; every real assertion below iterates
     * MODIFIERS and therefore covers whatever is registered. */
    assert(MODIFIERS.length >= 12, `modifier roster shrank to ${MODIFIERS.length}`);
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

        // Step purity: whatever exposes step(tMs) must be a pure function of
        // (seed, depth, tMs). Same tMs on two stubs ⇒ same state; revisiting
        // an earlier tMs ⇒ exactly the earlier state (no hidden accumulator);
        // and the state must actually move across the 250 ms scene clock (a
        // step that ignores its argument is a frozen animation).
        if (teardownA.step !== undefined) {
          assert(teardownB.step !== undefined,
            `[${mod.id} seed=${seed} depth=${depth}] step exposed on one apply but not the other`);
          let sawMovement = false;
          for (const t of TICK_SAMPLE_MS) {
            teardownA.step(t);
            teardownB.step?.(t);
            assert(sameState(initialA, initialB),
              `[${mod.id} seed=${seed} depth=${depth}] step(${t}) diverged between two applies at the same tMs`);
            if (!sameState(initialA, appliedStateA)) sawMovement = true;
          }
          assert(sawMovement,
            `[${mod.id} seed=${seed} depth=${depth}] step(tMs) never changed the state across ${TICK_SAMPLE_MS.join('/')} ms — animation is frozen`);
          teardownA.step(1000);
          const at1000 = cloneStub(initialA);
          teardownA.step(4000);
          teardownA.step(1000);
          assert(sameState(initialA, at1000),
            `[${mod.id} seed=${seed} depth=${depth}] step(1000) after step(4000) differs from the first step(1000) — hidden accumulator`);
          teardownA.step(0);
          assert(sameState(initialA, appliedStateA),
            `[${mod.id} seed=${seed} depth=${depth}] step(0) does not return the state to its apply-time (t=0) value`);
          teardownB.step?.(0);
        }

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

  /* P5: ink-splatter — the gate asserts the state main.ts actually paints:
   * scene.ink = { alpha, x, y, r }. A no-op implementation (never setting the
   * field) fails here. */
  const ink = MODIFIERS.find((m) => m.id === 'ink-splatter');
  check(`ink-splatter painted state (${SEED_COUNT} seeds)`, () => {
    assert(!!ink, 'ink-splatter missing from MODIFIERS');
    if (!ink) return;
    for (let i = 0; i < SEED_COUNT; i++) {
      const seed = (i * 1664525 + 1013904223) >>> 0;
      const depth = (i % 25) + 1;
      const layer = i % 5;
      const align = ALIGNS[i % ALIGNS.length]!;
      const ctx: ModCtx = { depth, seed, layer, align, motion: true };

      const stubA = createStub(1, 1, 150, 250);
      const stopA = ink.apply(ctx, stubA);
      assert(stopA.step !== undefined, `[ink-splatter seed=${seed}] motion stop must expose step(tMs) for the scene tick`);

      const a0 = stubA.ink;
      if (!a0) {
        assert(false, `[ink-splatter seed=${seed}] motion apply must set scene.ink (main.ts paints from it)`);
        continue;
      }
      assert(a0.alpha >= 0.2 && a0.alpha <= 0.4, `[ink-splatter seed=${seed}] alpha out of 0.2–0.4 cap (got ${a0.alpha})`);
      assert(a0.r >= 70 && a0.r <= 120, `[ink-splatter seed=${seed}] radius out of 70–120 (got ${a0.r})`);
      assert(Math.abs(a0.x) <= 70, `[ink-splatter seed=${seed}] x offset out of ±70 (got ${a0.x})`);
      assert(Math.abs(a0.y) <= 45, `[ink-splatter seed=${seed}] y offset out of ±45 (got ${a0.y})`);

      // Determinism: a second apply at the same seed yields the same state.
      const stubB = createStub(1, 1, 150, 250);
      const stopB = ink.apply(ctx, stubB);
      assert(sameState(stubA, stubB), `[ink-splatter seed=${seed}] non-deterministic apply (motion=true)`);

      // The state must actually change under step(tMs) — this is what makes
      // the blot wipe away on screen. Sample the same clock the scene tick
      // uses. Alpha must decay toward 0; x, y, r are constants for the round.
      let sawWipe = false;
      for (const t of [250, 500, 750, 1000, 1500, 2000, 4000]) {
        stopA.step!(t);
        const cur = stubA.ink!;
        if (cur.alpha !== a0.alpha) sawWipe = true;
        assert(cur.alpha >= 0 && cur.alpha <= 0.4, `[ink-splatter seed=${seed}] alpha out of cap at t=${t} (got ${cur.alpha})`);
        assert(cur.x === a0.x && cur.y === a0.y && cur.r === a0.r,
          `[ink-splatter seed=${seed}] x/y/r drifted during the wipe at t=${t}`);
      }
      assert(sawWipe, `[ink-splatter seed=${seed}] alpha never wiped across step(250..4000)`);

      // Teardown: deletes the field (it was absent before apply).
      stopA();
      assert(stubA.ink === undefined, `[ink-splatter seed=${seed}] teardown did not delete scene.ink (motion=true)`);
      stopB();
      assert(stubB.ink === undefined, `[ink-splatter seed=${seed}] teardownB did not delete scene.ink (motion=true)`);

      // Static variant: pinned mid-wipe blot, NO step (no reported movement).
      const sctx: ModCtx = { depth, seed, layer, align, motion: false };
      const sStub = createStub(1.5, 0.8, -50, 75);
      const sStop = ink.apply(sctx, sStub);
      const sState = sStub.ink;
      assert(!!sState, `[ink-splatter seed=${seed}] static apply must set scene.ink`);
      assert(sState !== undefined && sState.alpha >= 0.1 && sState.alpha <= 0.2,
        `[ink-splatter seed=${seed}] static alpha out of mid-wipe 0.1–0.2 (got ${sState?.alpha})`);
      assert(sStop.step === undefined, `[ink-splatter seed=${seed}] motion=false stop must NOT expose step (no reported movement)`);
      sStop();
      assert(sStub.ink === undefined, `[ink-splatter seed=${seed}] teardown did not delete scene.ink (motion=false)`);
    }
  });

  /* P5: fog-bank — the gate asserts the state main.ts actually paints:
   * scene.fog = { alpha, x, y, r }. A no-op implementation (never setting the
   * field) fails here. */
  const fog = MODIFIERS.find((m) => m.id === 'fog-bank');
  check(`fog-bank painted state (${SEED_COUNT} seeds)`, () => {
    assert(!!fog, 'fog-bank missing from MODIFIERS');
    if (!fog) return;
    for (let i = 0; i < SEED_COUNT; i++) {
      const seed = (i * 1664525 + 1013904223) >>> 0;
      const depth = (i % 25) + 1;
      const layer = i % 5;
      const align = ALIGNS[i % ALIGNS.length]!;
      const ctx: ModCtx = { depth, seed, layer, align, motion: true };

      const stubA = createStub(1, 1, 150, 250);
      const stopA = fog.apply(ctx, stubA);
      assert(stopA.step !== undefined, `[fog-bank seed=${seed}] motion stop must expose step(tMs) for the scene tick`);

      const a0 = stubA.fog;
      if (!a0) {
        assert(false, `[fog-bank seed=${seed}] motion apply must set scene.fog (main.ts paints from it)`);
        continue;
      }
      assert(a0.alpha >= 0.2 && a0.alpha <= 0.4, `[fog-bank seed=${seed}] alpha out of 0.2–0.4 cap (got ${a0.alpha})`);
      assert(a0.r >= 90 && a0.r <= 150, `[fog-bank seed=${seed}] radius out of 90–150 (got ${a0.r})`);
      // drift centre ±80/±50 plus drift radius 30–60 → x ∈ ±140, y ∈ ±110
      assert(Math.abs(a0.x) <= 140, `[fog-bank seed=${seed}] x offset out of ±140 (got ${a0.x})`);
      assert(Math.abs(a0.y) <= 110, `[fog-bank seed=${seed}] y offset out of ±110 (got ${a0.y})`);

      // Determinism: a second apply at the same seed yields the same state.
      const stubB = createStub(1, 1, 150, 250);
      const stopB = fog.apply(ctx, stubB);
      assert(sameState(stubA, stubB), `[fog-bank seed=${seed}] non-deterministic apply (motion=true)`);

      // The state must actually drift under step(tMs) — this is what makes the
      // bank roll on screen. Alpha and r are constants for the round; x/y move.
      let sawDrift = false;
      for (const t of [250, 500, 750, 1000, 1500, 2000, 4000]) {
        stopA.step!(t);
        const cur = stubA.fog!;
        if (cur.x !== a0.x || cur.y !== a0.y) sawDrift = true;
        assert(cur.alpha >= 0.2 && cur.alpha <= 0.4, `[fog-bank seed=${seed}] alpha out of cap at t=${t} (got ${cur.alpha})`);
        assert(cur.r === a0.r, `[fog-bank seed=${seed}] radius drifted during the round at t=${t}`);
      }
      assert(sawDrift, `[fog-bank seed=${seed}] fog bank never drifted across step(250..4000)`);

      // Teardown: deletes the field (it was absent before apply).
      stopA();
      assert(stubA.fog === undefined, `[fog-bank seed=${seed}] teardown did not delete scene.fog (motion=true)`);
      stopB();
      assert(stubB.fog === undefined, `[fog-bank seed=${seed}] teardownB did not delete scene.fog (motion=true)`);

      // Static variant: pinned bank at its seeded centre, NO step.
      const sctx: ModCtx = { depth, seed, layer, align, motion: false };
      const sStub = createStub(1.5, 0.8, -50, 75);
      const sStop = fog.apply(sctx, sStub);
      const sState = sStub.fog;
      assert(!!sState, `[fog-bank seed=${seed}] static apply must set scene.fog`);
      assert(sState !== undefined && sState.alpha >= 0.2 && sState.alpha <= 0.4,
        `[fog-bank seed=${seed}] static alpha out of cap (got ${sState?.alpha})`);
      assert(sState !== undefined && sState.r >= 90 && sState.r <= 150,
        `[fog-bank seed=${seed}] static radius out of 90–150 (got ${sState?.r})`);
      // Static pins the bank at its seeded centre: cx ∈ ±80, cy ∈ ±50.
      assert(sState !== undefined && Math.abs(sState.x) <= 80,
        `[fog-bank seed=${seed}] static x outside seeded centre ±80 (got ${sState?.x})`);
      assert(sState !== undefined && Math.abs(sState.y) <= 50,
        `[fog-bank seed=${seed}] static y outside seeded centre ±50 (got ${sState?.y})`);
      assert(sStop.step === undefined, `[fog-bank seed=${seed}] motion=false stop must NOT expose step (no reported movement)`);
      sStop();
      assert(sStub.fog === undefined, `[fog-bank seed=${seed}] teardown did not delete scene.fog (motion=false)`);
    }
  });

  /* P5: tilt-3d — the gate asserts the state main.ts actually applies:
   * scene.tilt = { pitch }. main.ts turns pitch (radians) into scale.y =
   * cos(pitch) and skew.y = -pitch on the scene container. A no-op
   * implementation (never setting the field) fails here. */
  const tilt = MODIFIERS.find((m) => m.id === 'tilt-3d');
  check(`tilt-3d painted state (${SEED_COUNT} seeds)`, () => {
    assert(!!tilt, 'tilt-3d missing from MODIFIERS');
    if (!tilt) return;
    for (let i = 0; i < SEED_COUNT; i++) {
      const seed = (i * 1664525 + 1013904223) >>> 0;
      const depth = (i % 25) + 1;
      const layer = i % 5;
      const align = ALIGNS[i % ALIGNS.length]!;
      const ctx: ModCtx = { depth, seed, layer, align, motion: true };

      const stubA = createStub(1, 1, 150, 250);
      const stopA = tilt.apply(ctx, stubA);
      assert(stopA.step !== undefined, `[tilt-3d seed=${seed}] motion stop must expose step(tMs) for the scene tick`);

      const a0 = stubA.tilt;
      if (!a0) {
        assert(false, `[tilt-3d seed=${seed}] motion apply must set scene.tilt (main.ts applies scale/skew from it)`);
        continue;
      }
      // base 0.15–0.30 rad ± swing 0.05–0.10 → pitch ∈ [0.05, 0.40]
      assert(a0.pitch >= 0.05 && a0.pitch <= 0.40, `[tilt-3d seed=${seed}] pitch out of 0.05–0.40 rad (got ${a0.pitch})`);

      // Determinism: a second apply at the same seed yields the same state.
      const stubB = createStub(1, 1, 150, 250);
      const stopB = tilt.apply(ctx, stubB);
      assert(sameState(stubA, stubB), `[tilt-3d seed=${seed}] non-deterministic apply (motion=true)`);

      // The pitch must actually oscillate under step(tMs) — this is what makes
      // the board visibly lean on screen.
      let sawOsc = false;
      for (const t of [250, 500, 750, 1000, 1500, 2000, 4000]) {
        stopA.step!(t);
        const cur = stubA.tilt!;
        if (cur.pitch !== a0.pitch) sawOsc = true;
        assert(cur.pitch >= 0.05 && cur.pitch <= 0.40, `[tilt-3d seed=${seed}] pitch out of 0.05–0.40 at t=${t} (got ${cur.pitch})`);
      }
      assert(sawOsc, `[tilt-3d seed=${seed}] pitch never oscillated across step(250..4000)`);

      // Teardown: deletes the field (it was absent before apply).
      stopA();
      assert(stubA.tilt === undefined, `[tilt-3d seed=${seed}] teardown did not delete scene.tilt (motion=true)`);
      stopB();
      assert(stubB.tilt === undefined, `[tilt-3d seed=${seed}] teardownB did not delete scene.tilt (motion=true)`);

      // Static variant: pinned at the seeded base pitch, NO step.
      const sctx: ModCtx = { depth, seed, layer, align, motion: false };
      const sStub = createStub(1.5, 0.8, -50, 75);
      const sStop = tilt.apply(sctx, sStub);
      const sState = sStub.tilt;
      assert(!!sState, `[tilt-3d seed=${seed}] static apply must set scene.tilt`);
      // Static pins the board at the base pitch: 0.15–0.30 rad.
      assert(sState !== undefined && sState.pitch >= 0.15 && sState.pitch <= 0.30,
        `[tilt-3d seed=${seed}] static pitch out of base 0.15–0.30 (got ${sState?.pitch})`);
      assert(sStop.step === undefined, `[tilt-3d seed=${seed}] motion=false stop must NOT expose step (no reported movement)`);
      sStop();
      assert(sStub.tilt === undefined, `[tilt-3d seed=${seed}] teardown did not delete scene.tilt (motion=false)`);
    }
  });

  /* P5: piano-keys — the gate asserts the state main.ts actually consumes:
   * the static scene.pianoKeys === true flag (no step — identical under
   * motion and static). A no-op implementation (never setting the flag)
   * fails here. */
  const piano = MODIFIERS.find((m) => m.id === 'piano-keys');
  check(`piano-keys flag state (${SEED_COUNT} seeds)`, () => {
    assert(!!piano, 'piano-keys missing from MODIFIERS');
    if (!piano) return;
    for (let i = 0; i < SEED_COUNT; i++) {
      const seed = (i * 1664525 + 1013904223) >>> 0;
      const depth = (i % 25) + 1;
      const layer = i % 5;
      const align = ALIGNS[i % ALIGNS.length]!;

      // Motion variant: the flag is set and the stop is a plain teardown.
      const mctx: ModCtx = { depth, seed, layer, align, motion: true };
      const mStub = createStub(1, 1, 150, 250);
      const mStop = piano.apply(mctx, mStub);
      assert(mStub.pianoKeys === true, `[piano-keys seed=${seed}] motion apply must set scene.pianoKeys === true (main.ts restyles the option tiles from it)`);
      assert(mStop.step === undefined, `[piano-keys seed=${seed}] static flag must NOT expose step (no reported movement)`);

      // Determinism: a second apply at the same seed yields the same state.
      const mStub2 = createStub(1, 1, 150, 250);
      const mStop2 = piano.apply(mctx, mStub2);
      assert(sameState(mStub, mStub2), `[piano-keys seed=${seed}] non-deterministic apply (motion=true)`);

      // Teardown: deletes the field (it was absent before apply).
      mStop();
      assert(mStub.pianoKeys === undefined, `[piano-keys seed=${seed}] teardown did not delete scene.pianoKeys (motion=true)`);
      mStop2();
      assert(mStub2.pianoKeys === undefined, `[piano-keys seed=${seed}] teardown2 did not delete scene.pianoKeys (motion=true)`);

      // Static variant: identical flag, identical teardown, NO step.
      const sctx: ModCtx = { depth, seed, layer, align, motion: false };
      const sStub = createStub(1.5, 0.8, -50, 75);
      const sStop = piano.apply(sctx, sStub);
      assert(sStub.pianoKeys === true, `[piano-keys seed=${seed}] static apply must set scene.pianoKeys === true`);
      assert(sStop.step === undefined, `[piano-keys seed=${seed}] motion=false stop must NOT expose step (no reported movement)`);
      sStop();
      assert(sStub.pianoKeys === undefined, `[piano-keys seed=${seed}] teardown did not delete scene.pianoKeys (motion=false)`);

      // Teardown must RESTORE a pre-existing flag, not just delete it.
      const preStub: BoardTarget = createStub(1, 1, 150, 250);
      preStub.pianoKeys = false;
      const pStop = piano.apply(sctx, preStub);
      const pFlag = (): boolean | undefined => preStub.pianoKeys;
      assert(pFlag() === true, `[piano-keys seed=${seed}] apply must override a preset flag to true`);
      pStop();
      assert(pFlag() === false, `[piano-keys seed=${seed}] teardown over a preset flag must restore the original value`);
    }
  });

  /* option-shuffle: a no-op implementation (never setting optionOrder)
   * fails here. main.ts moves the option tiles' positions from this
   * permutation, so it must be a valid permutation of 0..7, deterministic,
   * step-free in both motion modes, torn down, and the banner must say the
   * options moved. */
  const shuf = MODIFIERS.find((m) => m.id === 'option-shuffle');
  check(`option-shuffle permutation state (${SEED_COUNT} seeds)`, () => {
    assert(!!shuf, 'option-shuffle missing from MODIFIERS');
    if (!shuf) return;
    assert(shuf.banner === 'OPTIONS HAVE MOVED', 'option-shuffle banner must say the options moved');
    for (let i = 0; i < SEED_COUNT; i++) {
      const seed = (i * 1664525 + 1013904223) >>> 0;
      const depth = (i % 25) + 1;
      const layer = i % 5;
      const align = ALIGNS[i % ALIGNS.length]!;

      // Motion variant: a valid permutation of 0..7, NO step.
      const mctx: ModCtx = { depth, seed, layer, align, motion: true };
      const mStub = createStub(1, 1, 150, 250);
      const mStop = shuf.apply(mctx, mStub);
      const mOrder = (): number[] | undefined => mStub.optionOrder;
      const mo = mOrder();
      assert(mo !== undefined, `[option-shuffle seed=${seed}] motion apply must set scene.optionOrder (main.ts moves tiles from it)`);
      if (mo) {
        assert(mo.length === 8, `[option-shuffle seed=${seed}] optionOrder must permute all 8 options, got ${mo.length}`);
        const sorted = [...mo].sort((a, b) => a - b);
        for (let k = 0; k < 8; k++) {
          assert(sorted[k] === k, `[option-shuffle seed=${seed}] optionOrder is not a permutation of 0..7: ${mo.join(',')}`);
        }
      }
      assert(mStop.step === undefined, `[option-shuffle seed=${seed}] static permutation must NOT expose step (no reported movement)`);

      // Determinism: a second apply at the same seed yields the same order.
      const mStub2 = createStub(1, 1, 150, 250);
      const mStop2 = shuf.apply(mctx, mStub2);
      assert(sameState(mStub, mStub2), `[option-shuffle seed=${seed}] non-deterministic apply (motion=true)`);

      // Static variant: identical permutation, NO step. (Compared BEFORE any
      // teardown, since teardown deletes the field.)
      const sctx: ModCtx = { depth, seed, layer, align, motion: false };
      const sStub = createStub(1.5, 0.8, -50, 75);
      const sStop = shuf.apply(sctx, sStub);
      const sOrder = (): number[] | undefined => sStub.optionOrder;
      assert(sOrder() !== undefined, `[option-shuffle seed=${seed}] static apply must set scene.optionOrder`);
      const so = sOrder();
      const mo2 = (): number[] | undefined => mStub2.optionOrder;
      const mo2v = mo2();
      assert(so !== undefined && mo2v !== undefined && so.join(',') === mo2v.join(','), `[option-shuffle seed=${seed}] motion and static permutations differ for the same seed`);
      assert(sStop.step === undefined, `[option-shuffle seed=${seed}] motion=false stop must NOT expose step (no reported movement)`);

      // Teardown: deletes the field (it was absent before apply).
      mStop();
      assert(mOrder() === undefined, `[option-shuffle seed=${seed}] teardown did not delete scene.optionOrder (motion=true)`);
      mStop2();
      sStop();
      assert(sOrder() === undefined, `[option-shuffle seed=${seed}] teardown did not delete scene.optionOrder (motion=false)`);

      // Teardown must RESTORE a pre-existing order, not just delete it.
      const preStub: BoardTarget = createStub(1, 1, 150, 250);
      preStub.optionOrder = [7, 6, 5, 4, 3, 2, 1, 0];
      const pStop = shuf.apply(sctx, preStub);
      const pOrder = (): number[] | undefined => preStub.optionOrder;
      assert(pOrder() !== undefined && pOrder()!.length === 8, `[option-shuffle seed=${seed}] apply must override a preset order`);
      pStop();
      const restored = pOrder();
      assert(restored !== undefined && restored.join(',') === '7,6,5,4,3,2,1,0', `[option-shuffle seed=${seed}] teardown over a preset order must restore the original value`);
    }
  });

  /* mirror-flip — writes the container transform directly (scale.x). The gate
   * asserts the flip lands (scale.x = -orig), the wobble stays within ±0.02 of
   * it and moves under step(tMs), and nothing else on the transform is
   * touched. Static: plain flip, NO step. */
  const mirror = MODIFIERS.find((m) => m.id === 'mirror-flip');
  check(`mirror-flip transform state (${SEED_COUNT} seeds)`, () => {
    assert(!!mirror, 'mirror-flip missing from MODIFIERS');
    if (!mirror) return;
    for (let i = 0; i < SEED_COUNT; i++) {
      const seed = (i * 1664525 + 1013904223) >>> 0;
      const depth = (i % 25) + 1;
      const layer = i % 5;
      const align = ALIGNS[i % ALIGNS.length]!;
      const ctx: ModCtx = { depth, seed, layer, align, motion: true };

      const stub = createStub(1.25, 0.9, 150, 250);
      const stop = mirror.apply(ctx, stub);
      assert(stop.step !== undefined, `[mirror-flip seed=${seed}] motion stop must expose step(tMs) for the scene tick`);
      assert(stub.scale.x === -1.25, `[mirror-flip seed=${seed}] apply must flip scale.x to -orig (got ${stub.scale.x})`);

      let sawWobble = false;
      for (const t of TICK_SAMPLE_MS) {
        stop.step!(t);
        if (stub.scale.x !== -1.25) sawWobble = true;
        assert(Math.abs(stub.scale.x + 1.25) <= 0.02 + 1e-12,
          `[mirror-flip seed=${seed}] wobble left ±0.02 of the flip at t=${t} (got ${stub.scale.x})`);
        assert(stub.scale.y === 0.9 && stub.x === 150 && stub.y === 250,
          `[mirror-flip seed=${seed}] step(${t}) touched scale.y/x/y — only scale.x may wobble`);
      }
      assert(sawWobble, `[mirror-flip seed=${seed}] scale.x never wobbled across step(${TICK_SAMPLE_MS.join('/')})`);
      stop();
      assert(stub.scale.x === 1.25 && stub.scale.y === 0.9 && stub.x === 150 && stub.y === 250,
        `[mirror-flip seed=${seed}] teardown did not restore the exact transform (motion=true)`);

      // Static variant: plain flip, NO step (no reported movement).
      const sctx: ModCtx = { depth, seed, layer, align, motion: false };
      const sStub = createStub(1.5, 0.8, -50, 75);
      const sStop = mirror.apply(sctx, sStub);
      assert(sStub.scale.x === -1.5, `[mirror-flip seed=${seed}] static apply must be the plain flip (got ${sStub.scale.x})`);
      assert(sStop.step === undefined, `[mirror-flip seed=${seed}] motion=false stop must NOT expose step (no reported movement)`);
      sStop();
      assert(sStub.scale.x === 1.5 && sStub.scale.y === 0.8 && sStub.x === -50 && sStub.y === 75,
        `[mirror-flip seed=${seed}] teardown did not restore the exact transform (motion=false)`);
    }
  });

  /* board-drift — writes the container transform directly (x, y). The gate
   * asserts the seeded offset stays within the 12–24 px amplitude, moves under
   * step(tMs), and leaves scale alone. Static: half-amplitude pinned offset,
   * NO step. */
  const drift = MODIFIERS.find((m) => m.id === 'board-drift');
  check(`board-drift transform state (${SEED_COUNT} seeds)`, () => {
    assert(!!drift, 'board-drift missing from MODIFIERS');
    if (!drift) return;
    for (let i = 0; i < SEED_COUNT; i++) {
      const seed = (i * 1664525 + 1013904223) >>> 0;
      const depth = (i % 25) + 1;
      const layer = i % 5;
      const align = ALIGNS[i % ALIGNS.length]!;
      const ctx: ModCtx = { depth, seed, layer, align, motion: true };

      const stub = createStub(1, 1, 150, 250);
      const stop = drift.apply(ctx, stub);
      assert(stop.step !== undefined, `[board-drift seed=${seed}] motion stop must expose step(tMs) for the scene tick`);
      const dist0 = Math.hypot(stub.x - 150, stub.y - 250);
      assert(dist0 >= 12 - 1e-9 && dist0 <= 24 + 1e-9,
        `[board-drift seed=${seed}] t=0 offset outside the 12–24 px amplitude (got ${dist0})`);
      const x0 = stub.x;
      const y0 = stub.y;

      let sawDrift = false;
      for (const t of TICK_SAMPLE_MS) {
        stop.step!(t);
        if (stub.x !== x0 || stub.y !== y0) sawDrift = true;
        assert(Math.abs(stub.x - 150) <= 24 + 1e-9 && Math.abs(stub.y - 250) <= 24 + 1e-9,
          `[board-drift seed=${seed}] drift left the ±24 px envelope at t=${t} (got dx=${stub.x - 150}, dy=${stub.y - 250})`);
        assert(stub.scale.x === 1 && stub.scale.y === 1,
          `[board-drift seed=${seed}] step(${t}) touched scale — only x/y may drift`);
      }
      assert(sawDrift, `[board-drift seed=${seed}] board never drifted across step(${TICK_SAMPLE_MS.join('/')})`);
      stop();
      assert(stub.x === 150 && stub.y === 250 && stub.scale.x === 1 && stub.scale.y === 1,
        `[board-drift seed=${seed}] teardown did not restore the exact transform (motion=true)`);

      // Static variant: half-amplitude pinned offset (6–12 px), NO step.
      const sctx: ModCtx = { depth, seed, layer, align, motion: false };
      const sStub = createStub(1.5, 0.8, -50, 75);
      const sStop = drift.apply(sctx, sStub);
      const sDist = Math.hypot(sStub.x + 50, sStub.y - 75);
      assert(sDist >= 6 - 1e-9 && sDist <= 12 + 1e-9,
        `[board-drift seed=${seed}] static offset outside the half-amplitude 6–12 px (got ${sDist})`);
      assert(sStop.step === undefined, `[board-drift seed=${seed}] motion=false stop must NOT expose step (no reported movement)`);
      sStop();
      assert(sStub.x === -50 && sStub.y === 75 && sStub.scale.x === 1.5 && sStub.scale.y === 0.8,
        `[board-drift seed=${seed}] teardown did not restore the exact transform (motion=false)`);
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
  }
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
