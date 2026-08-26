/**
 * Gauntlet gate — independent solver audit for EVERY puzzle family
 * (v1 set from families.ts + v2 set from families2.ts + wave-3 set from families3.ts).
 *
 * Run directly with node (type stripping):
 *   node src/puzzles/audit2.ts
 *
 * For every family: 30 seeds x difficulty 1..5, asserting
 *   - generate() passes the board hue through untouched (single-hue rule),
 *   - exactly 8 pairwise-distinct options,
 *   - hole pinned bottom-right,
 *   - the INDEPENDENT solver re-derives exactly the keyed answer.
 * Prints one PASS line per family; exits non-zero on any failure.
 */
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';
import type { Family, Puzzle } from './types.ts';

/** Canonical order-independent structural key (mirrors glyphKey in families2). */
function key(prims: unknown[]): string {
  return JSON.stringify(
    [...prims].map(p => JSON.parse(JSON.stringify(p)))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
}

interface FamilyModules {
  FAMILIES: Family[];
  FAMILIES2: Family[];
  FAMILIES3: Family[];
  FAMILIES4: Family[];
}

/**
 * The sibling puzzle sources are plain-TS modules whose internal imports are
 * resolved by bundler/tsc; transpile them to CommonJS in a temp dir so the
 * audit runs under bare node regardless of import-extension style upstream.
 */
function loadFamilies(): FamilyModules {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(tmpdir(), `iqb-audit2-${process.pid}`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  const sources: Array<[string, string]> = [
    ['types.ts', join(here, 'types.ts')],
    ['glyphs.ts', resolve(here, '../glyphs.ts')],
    ['families.ts', join(here, 'families.ts')],
    ['families2.ts', join(here, 'families2.ts')],
    ['families3.ts', join(here, 'families3.ts')],
    ['families4.ts', join(here, 'families4.ts')],
  ];
  for (const [name, path] of sources) {
    const src = readFileSync(path, 'utf8');
    const js = ts.transpileModule(src, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText
      // flatten relative specifiers onto the flat outDir; '.ts' -> '.js'
      .replace(/require\((["'])\.\.?\/[^"']*?([^/\\']+\.ts)\1\)/g,
        (_m, q: string, base: string) => `require(${q}./${base.replace(/\.ts$/, '.js')}${q})`);
    writeFileSync(join(outDir, name.replace(/\.ts$/, '.js')), js);
  }
  const req = createRequire(join(outDir, 'entry.js'));
  const families = req('./families.js');
  const families2 = req('./families2.js');
  const families3 = req('./families3.js');
  const families4 = req('./families4.js');
  return { FAMILIES: families.FAMILIES, FAMILIES2: families2.FAMILIES2, FAMILIES3: families3.FAMILIES3, FAMILIES4: families4.FAMILIES4 };
}

function auditFamily(f: Family, hue: string): string[] {
  const errors: string[] = [];
  let solved = 0;
  let total = 0;
  for (let diff = 1; diff <= 5; diff++) {
    for (let sample = 0; sample < 30; sample++) {
      const seed = ((sample + 1) * 1013904223 + diff * 104729 + (f.id.length * 7919)) | 0;
      total++;
      const where = `${f.id} seed=${seed} diff=${diff}`;
      let p: Puzzle;
      try {
        p = f.generate(seed, diff, hue);
      } catch (e) {
        errors.push(`${where}: generate threw ${(e as Error).message}`);
        continue;
      }
      if (p.hue !== hue) errors.push(`${where}: hue drifted (${p.hue})`);
      if (p.holeIndex !== p.cols * p.rows - 1) {
        errors.push(`${where}: holeIndex ${p.holeIndex} not bottom-right`);
      }
      if (p.options.length !== 8) errors.push(`${where}: ${p.options.length} options`);
      const keys = new Set(p.options.map(o => key(o)));
      if (keys.size !== p.options.length) {
        errors.push(`${where}: duplicate options (${keys.size}/${p.options.length} distinct)`);
      }
      if (!(p.answer >= 0 && p.answer < p.options.length)) {
        errors.push(`${where}: answer index ${p.answer} out of range`);
        continue;
      }
      let got: number;
      try {
        got = f.solve(p);
      } catch (e) {
        errors.push(`${where}: solve threw ${(e as Error).message}`);
        continue;
      }
      if (got !== p.answer) {
        errors.push(`${where}: solve=${got} answer=${p.answer}`);
      } else {
        solved++;
      }
    }
  }
  if (errors.length === 0) {
    console.log(`PASS ${f.id}: ${solved}/${total} puzzles re-solved, 8 distinct options, single hue`);
  }
  return errors;
}

export function runAudit(): boolean {
  const hue = '#d4a017';
  const mods = loadFamilies();
  const all = [...mods.FAMILIES, ...mods.FAMILIES2, ...mods.FAMILIES3, ...mods.FAMILIES4];
  console.log(`auditing ${all.length} families x 30 seeds x diff 1..5 @ hue ${hue}`);
  const errors = all.flatMap(f => auditFamily(f, hue));
  if (errors.length > 0) {
    for (const e of errors.slice(0, 40)) console.error('FAIL ' + e);
    if (errors.length > 40) console.error(`FAIL ...and ${errors.length - 40} more`);
    console.error(`AUDIT FAILED: ${errors.length} error(s) across ${all.length} families`);
    return false;
  }
  console.log(`ALL FAMILIES PASS (${all.length} families)`);
  return true;
}

const invoked = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;
if (invoked) {
  process.exitCode = runAudit() ? 0 : 1;
}
