/**
 * selftest-takeover2.ts — pure-logic self-tests for the takeover2 port wave
 * (PHOENIX2 · GAUNTLET2 · FRACTAL2 · HYPERCUBE2 · SNIPER2).
 * Kept separate from selftest.ts / selftest-portb.ts so concurrent port
 * waves never collide.
 * Run from v2/: node --experimental-strip-types src/scenes/takeovers/selftest-takeover2.ts
 */
import { selfTest as phoenix2 } from './phoenix2.ts';
import { selfTest as gauntlet2 } from './gauntlet2.ts';
import { selfTest as fractal2 } from './fractal2.ts';
import { selfTest as hypercube2 } from './hypercube2.ts';
import { selfTest as sniper2 } from './sniper2.ts';

export function runAll(): boolean {
  const suites: Array<[string, { ok: boolean; failures: string[] }]> = [
    ['PHOENIX2 SEED RITUAL', phoenix2()],
    ['GAUNTLET2 FOUR RIDERS', gauntlet2()],
    ['FRACTAL2 DEEP ZOOM', fractal2()],
    ['HYPERCUBE2 606D', hypercube2()],
    ['SNIPER2 OVERWATCH', sniper2()],
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
  if (failed === 0) console.log('[takeover-selftest] TAKEOVER2 ALL PASS');
  else console.error(`[takeover-selftest] ${failed} SUITE(S) FAILED`);
  return failed === 0;
}

runAll();
