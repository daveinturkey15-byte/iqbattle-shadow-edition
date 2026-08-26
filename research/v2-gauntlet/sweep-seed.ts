/* Brute-force 16-bit run seed from answer digits (gen seed == runSeed per depth). */
import { planArc } from '../../v2/src/arc-data.ts';
import { FAMILIES } from '../../v2/src/puzzles/families.ts';
import { FAMILIES2 } from '../../v2/src/puzzles/families2.ts';
import { FAMILIES3 } from '../../v2/src/puzzles/families3.ts';
import { T } from '../../v2/src/theme.ts';

const ALL = [...FAMILIES, ...FAMILIES2, ...FAMILIES3];

// CLI: bun sweep-seed.ts "d1a,d2a,..."  e.g. "2,4,7"
const digits = process.argv[2].split(',').map(Number);
const hits: number[] = [];
for (let s = 0; s < 65536; s++) {
  let ok = true;
  for (let i = 0; i < digits.length; i++) {
    const depth = i + 1;
    const fam = ALL[(depth - 1) % ALL.length];
    const hue = T.boardHues[(depth - 1) % T.boardHues.length];
    const diff = Math.min(5, 1 + Math.floor(depth / 6));
    const p = fam.generate(s, diff, hue);
    if (p.answer + 1 !== digits[i]) { ok = false; break; }
  }
  if (ok) hits.push(s);
}
console.log('candidates:', hits);

/* emit drive table for the first candidate (or all if few) */
function takeoverDue(seed: number, depth: number, align: string, last: number) {
  return align !== 'good' && depth >= 4 && depth - last >= 3 && ((seed ^ Math.imul(depth, 2654435761)) >>> 0) % 100 < 42;
}
import { planArc } from '../../v2/src/arc-data.ts';
for (const seed of hits.slice(0, 3)) {
  const plan = planArc(seed, 2000);
  const rows: string[] = [];
  let last = -99;
  for (let d = 1; d <= 30; d++) {
    const a = plan[d - 1];
    if (takeoverDue(seed, d, a.align, last)) {
      const idx = ((seed ^ Math.imul(d, 97)) >>> 0) % 11;
      rows.push(`d${d} ${a.align} L${a.layer}${a.sanctuary ? ' SANCT' : ''} TAKEOVER idx=${idx}`);
      last = d;
      continue;
    }
    if (d % 4 === 0 && d > 1) { rows.push(`d${d} ${a.align} L${a.layer}${a.sanctuary ? ' SANCT' : ''} INTERLUDE`); continue; }
    const fam = ALL[(d - 1) % ALL.length];
    const hue = T.boardHues[(d - 1) % T.boardHues.length];
    const diff = Math.min(5, 1 + Math.floor(d / 6));
    const p = fam.generate(seed, diff, hue);
    rows.push(`d${d} ${a.align} L${a.layer}${a.sanctuary ? ' SANCT' : ''} fam${(d - 1) % ALL.length} ans=${p.answer + 1} cols=${p.cols} hole=${p.holeIndex}`);
  }
  console.log(`\n== seed ${seed} ==\n` + rows.join('\n'));
}
