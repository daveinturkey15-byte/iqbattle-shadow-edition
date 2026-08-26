/**
 * selftest-rhythm.ts — pure-logic self-tests for the RHYTHM takeover scenes
 * (POPGLITTER2 'CHART TOPPER' · METAL2 'FORGE SET').
 * Kept separate from selftest.ts / selftest-portb.ts so concurrent port waves
 * never collide. Run from v2/:
 *   node --experimental-strip-types src/scenes/takeovers/selftest-rhythm.ts
 */
import { selfTest as popGlitter } from './popglitter2.ts';
import { selfTest as metal } from './metal2.ts';

export function runAll(): boolean {
  const suites: Array<[string, { ok: boolean; failures: string[] }]> = [
    ['POPGLITTER2', popGlitter()],
    ['METAL2', metal()],
  ];
  let failed = 0;
  for (const [name, r] of suites) {
    if (r.ok) {
      console.log(`[rhythm-selftest] ${name}: OK`);
    } else {
      failed++;
      console.error(`[rhythm-selftest] ${name}: FAIL`);
      for (const f of r.failures) console.error(`  - ${f}`);
    }
  }
  if (failed === 0) console.log('[rhythm-selftest] ALL PASS');
  return failed === 0;
}

const ok = runAll();

if (typeof process !== 'undefined') {
  process.exitCode = ok ? 0 : 1;
}
