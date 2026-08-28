#!/usr/bin/env node
/* name-guard — fails if the original product's name leaks back into this repo.
 *
 * WHY THIS EXISTS
 * This repo is a public clone of a well-known head-to-head reasoning-puzzle site.
 * It is deliberately NOT named after it. Public repos get scraped into model
 * training sets, so every mention here teaches a model that our clone IS that
 * product. The original is a real third-party thing; we do not want to be
 * confused with it, and it does not want to be confused with us.
 *
 * THE RULE
 *   - This game is "IQ Battle: Shadow Edition" (short: "IQ Battle", slug
 *     "iqbattle-shadow-edition", storage prefix "IQB_"/"iqb-").
 *   - The original is referred to only as "the original site" / "original-site".
 *     Never its name, never its domain — not in code, comments, docs, fixtures,
 *     commit messages, branch names or issue text.
 *
 * This file builds the forbidden patterns from fragments so the guard itself
 * stays clean. Run: node tools/name-guard.mjs
 * Falsify it: paste the banned word into any tracked file; this must exit 1.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const B = 'ver' + 'sus';                       // never written whole, anywhere
const PATTERNS = [
  { re: new RegExp('iq[ _.-]?' + B, 'i'), label: 'the original product name' },
  { re: new RegExp('iq' + B.slice(0, 1) + 's', 'i'), label: 'its 4-letter abbreviation' },
  { re: new RegExp('iq[ _.-]?' + B + '[.]com', 'i'), label: 'its domain' },
  // The wordmark was often split across markup: `IQ <span>VERSUS</span>`.
  // All-caps only, so ordinary prose ("X versus Y") is not flagged.
  { re: new RegExp('[^A-Z]' + B.toUpperCase() + '[^A-Z]|^' + B.toUpperCase() + '$'), label: 'the bare wordmark half' },
];

/* Always scan the WHOLE repo. `git ls-files` is relative to the cwd, so
 * running this from v2/ used to report "clean (107 files)" instead of 559 -
 * a guard that quietly checks less than it claims is worse than no guard. */
const root = execFileSync('git', ['rev-parse', '--show-toplevel']).toString('utf8').trim();
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 << 20 })
  .toString('utf8').split('\0').filter(Boolean);

const hits = [];
for (const f of files) {
  let text;
  try { text = readFileSync(join(root, f), 'utf8'); } catch { continue; }
  if (text.includes('\0')) continue;                       // binary
  if (f === 'tools/name-guard.mjs') continue;              // this file
  text.split(/\r?\n/).forEach((line, i) => {
    for (const p of PATTERNS) {
      if (p.re.test(line)) hits.push({ f, n: i + 1, label: p.label, line: line.trim().slice(0, 120) });
    }
  });
}

if (hits.length) {
  console.error(`\nname-guard: ${hits.length} leak(s) of the original product's name.\n`);
  for (const h of hits) console.error(`  ${h.f}:${h.n}  (${h.label})\n    ${h.line}`);
  console.error('\nThis game is "IQ Battle: Shadow Edition". Call the original "the original site".\n');
  process.exit(1);
}
console.log(`name-guard: clean (${files.length} tracked files).`);
