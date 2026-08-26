/**
 * ONBOARD selftest runner — goal-card coverage (11 mounted + 9 incoming port
 * stage ids), family-legend coverage (9 DNA-real families), once-per-run
 * legend semantics, and text-length caps.
 * Kept separate so concurrent waves never collide (see takeovers/selftest.ts).
 * Run from v2/: node --experimental-strip-types src/meta/selftest-onboard.ts
 */
import { selfTest } from './onboard.ts';

const r = selfTest();
if (r.ok) {
  console.log('[onboard-selftest] OK');
} else {
  console.error('[onboard-selftest] FAIL');
  for (const f of r.failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
