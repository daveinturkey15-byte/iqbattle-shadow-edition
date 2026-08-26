/**
 * selftest-retro2.ts — pure-logic self-tests for the retro-2 takeover ports
 * (GLUTTON 2 · THE WELL 2 · SALVOS 2 · CORRIDOR 2).
 * Run from v2/: node --experimental-strip-types src/scenes/takeovers/selftest-retro2.ts
 */
import { selfTest as pacman2 } from './pacman2.ts';
import { selfTest as tetris2 } from './tetris2.ts';
import { selfTest as battleship2 } from './battleship2.ts';
import { selfTest as doom2 } from './doom2.ts';

export function runAll(): boolean {
  const suites: Array<[string, { ok: boolean; failures: string[] }]> = [
    ['GLUTTON 2', pacman2()],
    ['THE WELL 2', tetris2()],
    ['SALVOS 2', battleship2()],
    ['CORRIDOR 2', doom2()],
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
  if (failed === 0) console.log('[takeover-selftest] RETRO2 ALL PASS');
  else console.error(`[takeover-selftest] ${failed} SUITE(S) FAILED`);
  return failed === 0;
}

runAll();
