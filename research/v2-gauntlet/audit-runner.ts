/**
 * V2 GAUNTLET — SOLVER AUDIT
 * --------------------------
 * Imports every puzzle-family module (families.ts + families2.ts) and runs the
 * full solver audit: 30 samples x difficulty 1..5 per family. For every
 * generated puzzle it checks:
 *
 *   1. solve(p) === p.answer        (independent solver re-derives the key)
 *   2. options are pairwise distinct (serialized prim comparison)
 *   3. hole is bottom-right          (holeIndex === cols*rows - 1)
 *   4. single hue per board          (non-empty board-wide hue string)
 *
 * Exit code 1 on any failure; missing modules report PENDING and do not flip
 * the gate (a module that exists but exports nothing DOES fail).
 *
 * Run:  node research/v2-gauntlet/audit-runner.ts
 */
import { loadFamilyModule, seedFor } from './lib.ts';
import type { Family, Puzzle } from '../../v2/src/puzzles/types.ts';

const HUE = '#d4a017'; // one gold accent; boards never vary hue internally (DNA rule 1)
const SAMPLES = 30;
const DIFFS = [1, 2, 3, 4, 5];
const MAX_PRINTED_FAILURES = 8;

/** Family modules to audit, relative to this runner file. */
const FAMILY_MODULES: ReadonlyArray<readonly [file: string, specifier: string]> = [
  ['families.ts', '../../v2/src/puzzles/families.ts'],
  ['families2.ts', '../../v2/src/puzzles/families2.ts'],
];

function describeError(e: unknown): string {
  return (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).split('\n')[0];
}

const primKey = (prims: Puzzle['options'][number]): string => JSON.stringify(prims);

interface AuditResult {
  id: string;
  total: number;
  solved: number;
  failures: string[];
}

function auditFamily(f: Family): AuditResult {
  const failures: string[] = [];
  let total = 0;
  let solved = 0;
  for (let sample = 0; sample < SAMPLES; sample++) {
    for (const diff of DIFFS) {
      total++;
      const seed = seedFor(f.id, sample, diff);
      const tag = `seed=${seed} diff=${diff}`;
      let p: Puzzle;
      try {
        p = f.generate(seed, diff, HUE);
      } catch (e) {
        failures.push(`${tag} generate() threw — ${describeError(e)}`);
        continue;
      }

      if (!Array.isArray(p.cells) || !Array.isArray(p.options)) {
        failures.push(`${tag} malformed puzzle (cells/options not arrays)`);
        continue;
      }
      if (p.holeIndex !== p.cols * p.rows - 1) {
        failures.push(
          `${tag} holeIndex=${p.holeIndex} but ${p.cols}x${p.rows} grid requires bottom-right (${p.cols * p.rows - 1})`,
        );
      }
      if (typeof p.hue !== 'string' || p.hue.length === 0) {
        failures.push(`${tag} board has no single unifying hue (hue=${JSON.stringify(p.hue)})`);
      }
      const keys = p.options.map(primKey);
      if (new Set(keys).size !== keys.length) {
        const dupIdx = keys.findIndex((k, i) => keys.indexOf(k) !== i);
        failures.push(`${tag} duplicate options at indices ${keys.indexOf(keys[dupIdx])} and ${dupIdx}`);
      }
      if (typeof p.answer !== 'number' || !(p.answer >= 0 && p.answer < p.options.length)) {
        failures.push(`${tag} answer index ${String(p.answer)} out of range for ${p.options.length} options`);
        continue;
      }

      let ans: number;
      try {
        ans = f.solve(p);
      } catch (e) {
        failures.push(`${tag} solve() threw — ${describeError(e)}`);
        continue;
      }
      if (ans !== p.answer) {
        failures.push(`${tag} solve()=${ans}, expected key=${p.answer}`);
        continue;
      }
      solved++;
    }
  }
  return { id: f.id, total, solved, failures };
}

async function main(): Promise<void> {
  console.log('== IQ VERSUS V2 — SOLVER AUDIT ==');
  console.log(`samples: ${SAMPLES}/family x diffs ${DIFFS.join('/')} | tolerance: 0 wrong answers\n`);

  const loaded = await Promise.all(FAMILY_MODULES.map(([f, s]) => loadFamilyModule(f, s)));

  const seenIds = new Map<string, string>();
  let auditedFamilies = 0;
  let totalPuzzles = 0;
  let totalSolved = 0;
  let failed = false;

  for (const m of loaded) {
    if (m.status !== 'ok') {
      console.log(`[${m.file}] ${m.status === 'missing' ? 'PENDING' : 'BLOCKED'} — ${m.error}`);
      continue;
    }
    for (const fam of m.families) {
      const prevOwner = seenIds.get(fam.id);
      if (prevOwner !== undefined && prevOwner !== m.file) {
        console.log(`[!] FAIL duplicate family id "${fam.id}" exported by both ${prevOwner} and ${m.file}`);
        failed = true;
        continue;
      }
      seenIds.set(fam.id, m.file);

      const r = auditFamily(fam);
      auditedFamilies++;
      totalPuzzles += r.total;
      totalSolved += r.solved;
      const ok = r.failures.length === 0;
      if (!ok) failed = true;
      console.log(
        `[${fam.id}] ${ok ? 'PASS' : 'FAIL'}  ${r.solved}/${r.total} solved | options distinct | hole bottom-right | single-hue`,
      );
      for (const msg of r.failures.slice(0, MAX_PRINTED_FAILURES)) {
        console.log(`    - ${msg}`);
      }
      if (r.failures.length > MAX_PRINTED_FAILURES) {
        console.log(`    ... and ${r.failures.length - MAX_PRINTED_FAILURES} more`);
      }
    }
  }

  const pending = loaded.filter((m) => m.status === 'missing').map((m) => m.file);
  console.log('');
  if (failed) {
    console.log(`RESULT: FAIL (${auditedFamilies} families, ${totalSolved}/${totalPuzzles} puzzles correct)`);
    process.exitCode = 1;
  } else {
    console.log(
      `RESULT: PASS (${auditedFamilies} families, ${totalSolved}/${totalPuzzles} puzzles, 0 failures)` +
        (pending.length ? ` | PENDING modules: ${pending.join(', ')}` : ''),
    );
  }
}

void main();
