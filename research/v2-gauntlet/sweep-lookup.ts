/* Precompute per-seed drive tables for seeds 0..65535 -> compact JSON lookup.
 * For each seed: first 10 depth entries with kind + answer (puzzles) so live
 * digit probes can filter to a unique seed instantly. */
import { planArc } from '../../v2/src/arc-data.ts';
import { FAMILIES } from '../../v2/src/puzzles/families.ts';
import { FAMILIES2 } from '../../v2/src/puzzles/families2.ts';
import { FAMILIES3 } from '../../v2/src/puzzles/families3.ts';
import { T } from '../../v2/src/theme.ts';

const ALL = [...FAMILIES, ...FAMILIES2, ...FAMILIES3];
const im = Math.imul;

function due(seed: number, d: number, align: string, last: number): boolean {
  return align !== 'good' && d >= 4 && d - last >= 3 && ((seed ^ im(d, 2654435761)) >>> 0) % 100 < 42;
}

const out: Record<string, string> = {};
for (let s = 0; s < 65536; s++) {
  const plan = planArc(s, 2000);
  const parts: string[] = [];
  let last = -99;
  for (let d = 1; d <= 10; d++) {
    const a = plan[d - 1];
    if (due(s, d, a.align, last)) {
      const idx = ((s ^ im(d, 97)) >>> 0) % 11;
      parts.push('T' + idx);
      last = d;
      continue;
    }
    if (d % 4 === 0 && d > 1) { parts.push('I'); continue; }
    const fam = ALL[(d - 1) % ALL.length];
    const hue = T.boardHues[(d - 1) % T.boardHues.length];
    const diff = Math.min(5, 1 + Math.floor(d / 6));
    const p = fam.generate(s, diff, hue);
    parts.push(String(p.answer + 1) + (p.cols === 3 ? 'w' : 'n')); // w=wide(3x3) n=narrow(2x2)
  }
  out[s] = parts.join(',');
}
await Bun.write(import.meta.dir + '/seed-lookup.json', JSON.stringify(out));
console.log('written', Object.keys(out).length);
