/**
 * selftest.ts — runs the PURE logic self-tests of the three takeover scenes.
 * No DOM, no Pixi objects, no timers are touched by the tests themselves.
 * Run with a TS-capable runner from the v2/ directory, e.g.:
 *   node --experimental-strip-types src/scenes/takeovers/selftest.ts
 */
import { selfTest as redLightTest } from './redlight.ts';
import { selfTest as tidePoolTest } from './tidepool.ts';
import { selfTest as serpentTest } from './serpent.ts';

export function runAll(): boolean {
  const suites: Array<[string, { ok: boolean; failures: string[] }]> = [
    ['RED LIGHT', redLightTest()],
    ['TIDE POOL', tidePoolTest()],
    ['SERPENT', serpentTest()],
  ];
  let failed = 0;
  for (const [name, r] of suites) {
    if (r.ok) {
      console.log(`[takeover-selftest] ${name}: OK`);
    } else {
      failed++;
      console.error(`[takeover-selftest] ${name}: FAIL`);
      for (const f of r.failures) console.error(`  - ${f}`);
    }
  }
  if (failed === 0) console.log('[takeover-selftest] ALL PASS');
  else console.error(`[takeover-selftest] ${failed} SUITE(S) FAILED`);
  return failed === 0;
}

runAll();
