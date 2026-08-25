/**
 * V2 GAUNTLET — SOAK
 * ------------------
 * Headless, Pixi-free simulation sweep:
 *
 *   1. For 200 deterministic seeds per family: generate a puzzle per family and
 *      verify render-prim invariants — every prim inside the 0..100 cell design
 *      space, sane mark sizes, and at most 40 marks per cell.
 *   2. For every module in v2/src/scenes/takeovers/: run its exported pure
 *      self-test (selfTest / __selfTest, returning {ok,failures} | boolean |
 *      string[]). Modules import pixi.js fine under bare node; selfTest() never
 *      constructs Pixi objects (team contract).
 *
 * Exit code 1 on any prim violation or failing self-test. Missing takeover
 * self-tests report PENDING and do not flip the gate.
 *
 * Run:  node research/v2-gauntlet/soak.ts
 */
import { readdirSync } from 'fs';
import { join } from 'path';
import { checkPuzzlePrims, loadFamilyModule } from './lib.ts';
import type { Family, Puzzle } from '../../v2/src/puzzles/types.ts';

const SEEDS = 200;
const MAX_PRINTED_FAILURES = 12;

const FAMILY_MODULES: ReadonlyArray<readonly [file: string, specifier: string]> = [
  ['families.ts', '../../v2/src/puzzles/families.ts'],
  ['families2.ts', '../../v2/src/puzzles/families2.ts'],
];
const TAKEOVER_DIR = join(import.meta.dirname, '../../v2/src/scenes/takeovers');

function describeError(e: unknown): string {
  return (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).split('\n')[0];
}

/* ------------------------------------------------------------------ */
/* Part 1 — puzzle generation soak                                     */
/* ------------------------------------------------------------------ */

interface SoakResult {
  id: string;
  puzzles: number;
  failures: string[];
}

function soakFamily(f: Family, seeds: number): SoakResult {
  const failures: string[] = [];
  let puzzles = 0;
  for (let seed = 0; seed < seeds; seed++) {
    const diff = (seed % 5) + 1; // sweep all difficulties across the seed range
    let p: Puzzle;
    try {
      p = f.generate(seed, diff, '#d4a017');
    } catch (e) {
      failures.push(`seed=${seed} diff=${diff} generate() threw — ${describeError(e)}`);
      continue;
    }
    puzzles++;
    checkPuzzlePrims(p, `seed=${seed} diff=${diff}`, (msg) => failures.push(msg));
  }
  return { id: f.id, puzzles, failures };
}

/* ------------------------------------------------------------------ */
/* Part 2 — takeover self-tests                                        */
/* ------------------------------------------------------------------ */

type SelfTestFn = () => unknown;

function findSelfTest(mod: Record<string, unknown>): SelfTestFn | null {
  for (const [key, value] of Object.entries(mod)) {
    if (/selftest/i.test(key) && typeof value === 'function') return value as SelfTestFn;
  }
  return null;
}

/** Normalize any agreed self-test return shape into ok/failures. */
function interpretSelfTest(result: unknown): { ok: boolean; failures: string[] } {
  if (typeof result === 'boolean') return { ok: result, failures: result ? [] : ['selfTest() returned false'] };
  if (typeof result === 'object' && result !== null) {
    const r = result as { ok?: unknown; failures?: unknown };
    if (typeof r.ok === 'boolean') {
      const failures = Array.isArray(r.failures) ? r.failures.map(String) : [];
      return { ok: r.ok && failures.length === 0, failures };
    }
    if (Array.isArray(result)) {
      const failures = (result as unknown[]).map(String);
      return { ok: failures.length === 0, failures };
    }
  }
  return { ok: false, failures: [`unrecognized selfTest() return shape: ${String(result).slice(0, 80)}`] };
}

async function soakTakeovers(): Promise<{ ran: number; failed: boolean; lines: string[] }> {
  const lines: string[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(TAKEOVER_DIR)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
      .sort();
  } catch {
    lines.push('  (takeovers dir absent — nothing to self-test yet)');
    return { ran: 0, failed: false, lines };
  }
  if (files.length === 0) lines.push('  (no takeover modules yet)');

  let ran = 0;
  let failed = false;
  for (const file of files) {
    const specifier = `../../v2/src/scenes/takeovers/${file}`;
    let mod: Record<string, unknown>;
    try {
      mod = (await import(specifier)) as Record<string, unknown>;
    } catch (e) {
      lines.push(`  [${file}] BLOCKED — import failed: ${describeError(e)}`);
      continue;
    }
    const selfTest = findSelfTest(mod);
    if (!selfTest) {
      lines.push(`  [${file}] PENDING — no pure self-test export (expected selfTest(): {ok,failures})`);
      continue;
    }
    ran++;
    try {
      const verdict = interpretSelfTest(selfTest());
      if (verdict.ok) {
        lines.push(`  [${file}] SELFTEST PASS`);
      } else {
        failed = true;
        lines.push(`  [${file}] SELFTEST FAIL`);
        for (const msg of verdict.failures.slice(0, MAX_PRINTED_FAILURES)) lines.push(`      - ${msg}`);
        if (verdict.failures.length > MAX_PRINTED_FAILURES) {
          lines.push(`      ... and ${verdict.failures.length - MAX_PRINTED_FAILURES} more`);
        }
      }
    } catch (e) {
      failed = true;
      lines.push(`  [${file}] SELFTEST FAIL — threw: ${describeError(e)}`);
    }
  }
  return { ran, failed, lines };
}

/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  console.log('== IQ VERSUS V2 — SOAK ==');
  console.log(`${SEEDS} seeds/family, diff sweeps 1..5 | prim invariants + takeover self-tests\n`);

  /* Part 1 */
  let totalPuzzles = 0;
  let soakFailed = false;
  for (const [file, specifier] of FAMILY_MODULES) {
    const m = await loadFamilyModule(file, specifier);
    if (m.status !== 'ok') {
      console.log(`[${m.file}] ${m.status === 'missing' ? 'PENDING' : 'BLOCKED'} — ${m.error}`);
      if (m.status === 'error') soakFailed = true;
      continue;
    }
    for (const fam of m.families) {
      const r = soakFamily(fam, SEEDS);
      totalPuzzles += r.puzzles;
      const ok = r.failures.length === 0;
      if (!ok) soakFailed = true;
      console.log(
        `[${r.id}] ${ok ? 'PASS' : 'FAIL'}  ${r.puzzles} puzzles soaked, all prims within 0..100, <=40 marks/cell`,
      );
      for (const msg of r.failures.slice(0, MAX_PRINTED_FAILURES)) console.log(`    - ${msg}`);
      if (r.failures.length > MAX_PRINTED_FAILURES) {
        console.log(`    ... and ${r.failures.length - MAX_PRINTED_FAILURES} more`);
      }
    }
  }

  /* Part 2 */
  console.log('\ntakeover self-tests:');
  const t = await soakTakeovers();
  for (const line of t.lines) console.log(line);

  console.log('');
  if (soakFailed || t.failed) {
    console.log(`RESULT: FAIL (${totalPuzzles} puzzles soaked across families; see failures above)`);
    process.exitCode = 1;
  } else {
    console.log(`RESULT: PASS (${totalPuzzles} puzzles soaked, ${t.ran} takeover self-tests green)`);
  }
}

void main();
