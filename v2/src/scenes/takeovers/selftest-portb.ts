/**
 * selftest-portb.ts — pure-logic self-tests for the PortB takeover scenes
 * (SABER CLASH · ONE-ARMED GOD · SLIME GALLERY · THE WELL).
 * Kept separate from selftest.ts so concurrent port waves never collide.
 * Run from v2/: node --experimental-strip-types src/scenes/takeovers/selftest-portb.ts
 */
import { selfTest as saberClash } from './saberclash.ts';
import { selfTest as slots } from './slots.ts';
import { selfTest as slimeGallery } from './slimegallery.ts';
import { selfTest as well } from './well.ts';

export function runAll(): boolean {
  const suites: Array<[string, { ok: boolean; failures: string[] }]> = [
    ['SABER CLASH', saberClash()],
    ['ONE-ARMED GOD', slots()],
    ['SLIME GALLERY', slimeGallery()],
    ['THE WELL', well()],
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
  if (failed === 0) console.log('[takeover-selftest] PORTB ALL PASS');
  else console.error(`[takeover-selftest] ${failed} SUITE(S) FAILED`);
  return failed === 0;
}

runAll();
