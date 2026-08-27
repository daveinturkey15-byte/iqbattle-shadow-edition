/* ============================================================================
 * CHAOS JUICE BUS SELFTEST — verifies the a11y rails, determinism, and exact
 * teardown of the chaos bus over 200 seeded runs.
 *
 * Run from v2/:
 *   node --experimental-strip-types src/fx/selftest-chaos.ts
 * ==========================================================================*/

import {
  createChaos,
  FLASH_MAX_MS,
  FLASH_MAX_HZ,
  SHAKE_MAX_AMP,
  type ChaosBus,
  type ChaosState,
} from './chaos.ts';

const SEED_COUNT = 200;
const TICK_MS = 16;

function neutral(): ChaosState {
  return {
    shakeX: 0,
    shakeY: 0,
    shakeAmp: 0,
    flashColor: 0,
    flashAlpha: 0,
    glitch: 0,
    melt: 0,
    invert: 0,
    embers: 0,
    scanlines: false,
    scanPhase: 0,
    intensity: 1,
    timeMs: 0,
  };
}

function sameState(a: ChaosState, b: ChaosState): boolean {
  return (
    a.shakeX === b.shakeX &&
    a.shakeY === b.shakeY &&
    a.shakeAmp === b.shakeAmp &&
    a.flashColor === b.flashColor &&
    a.flashAlpha === b.flashAlpha &&
    a.glitch === b.glitch &&
    a.melt === b.melt &&
    a.invert === b.invert &&
    a.embers === b.embers &&
    a.scanlines === b.scanlines &&
    a.scanPhase === b.scanPhase &&
    a.intensity === b.intensity &&
    a.timeMs === b.timeMs
  );
}

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  function check(name: string, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function assert(cond: boolean, msg: string): void {
    if (!cond) throw new Error(msg);
  }

  // --- Determinism: same seed + same tick sequence = identical state --------
  check(`determinism over ${SEED_COUNT} seeds`, () => {
    for (let s = 0; s < SEED_COUNT; s++) {
      const a = createChaos(s, true);
      const b = createChaos(s, true);
      a.shake(0.7, 300);
      a.flash(0xff0000, 150);
      a.glitch(200);
      a.melt(0.5);
      a.invert(120);
      a.embers(5);
      a.scanlines(true);
      a.intensity(0.8);
      b.shake(0.7, 300);
      b.flash(0xff0000, 150);
      b.glitch(200);
      b.melt(0.5);
      b.invert(120);
      b.embers(5);
      b.scanlines(true);
      b.intensity(0.8);
      for (let t = 0; t < 30; t++) {
        a.tick(TICK_MS);
        b.tick(TICK_MS);
        if (!sameState(a.state(), b.state())) {
          throw new Error(`seed ${s} tick ${t}: state diverged`);
        }
      }
    }
  });

  // --- Flash duration cap ----------------------------------------------------
  check(`flash duration capped at ${FLASH_MAX_MS} ms over ${SEED_COUNT} seeds`, () => {
    for (let s = 0; s < SEED_COUNT; s++) {
      const bus = createChaos(s, true);
      bus.flash(0x00ff00, 5000); // ask for 5 s
      bus.tick(1);
      const st = bus.state();
      assert(st.flashAlpha > 0, `seed ${s}: flash never started`);
      // After FLASH_MAX_MS + margin the flash must be over.
      for (let t = 0; t < Math.ceil((FLASH_MAX_MS + 100) / TICK_MS); t++) {
        bus.tick(TICK_MS);
      }
      assert(
        bus.state().flashAlpha === 0 && bus.state().flashColor === 0,
        `seed ${s}: flash still active after ${FLASH_MAX_MS + 100} ms`
      );
    }
  });

  // --- Flash rate limit: spam must be clamped to <= 3 Hz ----------------------
  check(`flash rate limit clamps spam over ${SEED_COUNT} seeds`, () => {
    for (let s = 0; s < SEED_COUNT; s++) {
      const bus = createChaos(s, true);
      // Spam 10 flashes back-to-back with no ticks between: only the first
      // may take effect; the rest must be dropped.
      for (let i = 0; i < 10; i++) bus.flash(0x0000ff, 100);
      bus.tick(1);
      assert(
        bus.state().flashAlpha > 0,
        `seed ${s}: first flash did not start`
      );
      // While a flash is active, further flashes are dropped.
      bus.flash(0xff0000, 100);
      bus.tick(1);
      assert(
        bus.state().flashColor === 0x0000ff,
        `seed ${s}: flash replaced while active (rate limit broken)`
      );
      // Let it finish, then verify the 3 Hz gap: a flash started at t=0
      // means the next one cannot start before 1000/3 ms.
      for (let t = 0; t < 20; t++) bus.tick(TICK_MS);
      bus.flash(0x00ff00, 100);
      bus.tick(1);
      const st = bus.state();
      assert(
        st.flashAlpha === 0 || st.flashColor === 0x0000ff,
        `seed ${s}: flash started inside the 3 Hz gap`
      );
    }
  });

  // --- Shake bound: amplitude bounded regardless of argument -----------------
  check(`shake amplitude bounded over ${SEED_COUNT} seeds`, () => {
    for (let s = 0; s < SEED_COUNT; s++) {
      const bus = createChaos(s, true);
      bus.shake(999, 500); // absurd intensity
      bus.shake(-5, 500); // negative
      bus.shake(NaN, 500); // NaN
      bus.shake(0.9, 500);
      for (let t = 0; t < 40; t++) {
        bus.tick(TICK_MS);
        const st = bus.state();
        assert(
          st.shakeAmp <= SHAKE_MAX_AMP + 1e-9,
          `seed ${s} tick ${t}: shakeAmp ${st.shakeAmp} exceeds bound`
        );
        assert(
          Math.abs(st.shakeX) <= SHAKE_MAX_AMP + 1e-9 &&
            Math.abs(st.shakeY) <= SHAKE_MAX_AMP + 1e-9,
          `seed ${s} tick ${t}: shake offset exceeds bound`
        );
      }
    }
  });

  // --- Static variant: motion=false reports no movement at all ---------------
  check(`motion=false static variant over ${SEED_COUNT} seeds`, () => {
    for (let s = 0; s < SEED_COUNT; s++) {
      const bus = createChaos(s, false);
      bus.shake(1, 500);
      bus.glitch(300);
      bus.flash(0xffffff, 150);
      bus.melt(0.6);
      bus.invert(200);
      bus.embers(8);
      bus.scanlines(true);
      bus.intensity(0.9);
      for (let t = 0; t < 40; t++) {
        bus.tick(TICK_MS);
        const st = bus.state();
        assert(
          st.shakeX === 0 && st.shakeY === 0 && st.shakeAmp === 0,
          `seed ${s} tick ${t}: motion=false reported shake movement`
        );
        assert(
          st.glitch === 0,
          `seed ${s} tick ${t}: motion=false reported glitch movement`
        );
        assert(
          st.scanPhase === 0,
          `seed ${s} tick ${t}: motion=false reported scanline movement`
        );
      }
    }
  });

  // --- stop() restores neutral exactly ---------------------------------------
  check(`stop() restores neutral exactly over ${SEED_COUNT} seeds`, () => {
    for (let s = 0; s < SEED_COUNT; s++) {
      const bus = createChaos(s, true);
      bus.shake(0.8, 400);
      bus.flash(0x123456, 150);
      bus.glitch(250);
      bus.melt(0.7);
      bus.invert(300);
      bus.embers(12);
      bus.scanlines(true);
      bus.intensity(0.3);
      for (let t = 0; t < 10; t++) bus.tick(TICK_MS);
      bus.stop();
      assert(
        sameState(bus.state(), neutral()),
        `seed ${s}: state after stop() is not neutral`
      );
      // And the bus must be usable again after stop().
      bus.shake(0.5, 200);
      bus.tick(TICK_MS);
      assert(
        bus.state().shakeAmp > 0,
        `seed ${s}: bus dead after stop()`
      );
    }
  });

  return { ok: failures.length === 0, failures };
}

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  Boolean(
    process.argv[1] &&
      /selftest-chaos(\.ts)?$/.test(process.argv[1].replace(/\\/g, '/'))
  );

if (isMain) {
  const res = selfTest();
  if (res.ok) {
    console.log('[chaos-selftest] ALL PASS');
    process.exit(0);
  } else {
    for (const f of res.failures) console.error('  FAIL ' + f);
    process.exit(1);
  }
}
