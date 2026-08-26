/* BugSweepLive scratch: recover 16-bit run seed from observed depth-1 board,
 * then emit a per-depth plan + answer table for driving the live build.
 * Read-only vs game source; lives in research/v2-gauntlet/. */
import { planArc } from '../../v2/src/arc-data.ts';
import { FAMILIES } from '../../v2/src/puzzles/families.ts';
import { FAMILIES2 } from '../../v2/src/puzzles/families2.ts';
import { FAMILIES3 } from '../../v2/src/puzzles/families3.ts';
import { T } from '../../v2/src/theme.ts';

const ALL = [...FAMILIES, ...FAMILIES2, ...FAMILIES3];
const im = Math.imul;
const TAKEVERS = 11;

function puzzleFor(seed: number, depth: number) {
  const famIdx = (depth - 1) % ALL.length;
  const fam = ALL[famIdx];
  const hue = T.boardHues[(depth - 1) % T.boardHues.length];
  const diff = Math.min(5, 1 + Math.floor(depth / 6));
  const p = fam.generate((seed ^ im(depth, 7919)) >>> 0, diff, hue);
  return { famIdx, p };
}

function takeoverDue(seed: number, depth: number, align: string, lastTakeover: number) {
  return align !== 'good' && depth >= 4 && depth - lastTakeover >= 3 &&
    ((seed ^ im(depth, 2654435761)) >>> 0) % 100 < 42;
}

// ---- brute force seed from depth-1 observations ----
// observed: 3x3, hole bottom-right (idx 8), counts row1: 2,4,8
export function findSeeds(obs: { cols: number; hole: number; counts: number[] }): number[] {
  const hits: number[] = [];
  for (let s = 0; s < 65536; s++) {
    const { p } = puzzleFor(s, 1);
    if (p.cols !== obs.cols || p.holeIndex !== obs.hole) continue;
    let ok = true;
    for (let i = 0; i < obs.counts.length; i++) {
      if ((p.cells[i]?.length ?? -1) !== obs.counts[i]) { ok = false; break; }
    }
    if (ok) hits.push(s);
  }
  return hits;
}

export function table(seed: number, maxDepth = 32) {
  const plan = planArc(seed, 2000);
  const rows: any[] = [];
  let lastTakeover = -99;
  for (let d = 1; d <= maxDepth; d++) {
    const a = plan[d - 1];
    const due = takeoverDue(seed, d, a.align, lastTakeover);
    if (due) {
      const idx = ((seed ^ im(d, 97)) >>> 0) % TAKEVERS;
      rows.push({ d, align: a.align, layer: a.layer, sanct: a.sanctuary, kind: 'TK', idx });
      lastTakeover = d;
    } else {
      const { p } = puzzleFor(seed, d);
      rows.push({ d, align: a.align, layer: a.layer, sanct: a.sanctuary, kind: 'PZ', fam: (d - 1) % ALL.length, ans: p.answer + 1, cols: p.cols, hole: p.holeIndex, rule: p.rule });
    }
  }
  return rows;
}

// CLI: bun sweep-solve.ts <counts csv> <cols> <hole>
if (import.meta.main) {
  const [, , countsCsv, colsS, holeS] = process.argv;
  const counts = countsCsv.split(',').map(Number);
  const seeds = findSeeds({ cols: Number(colsS), hole: Number(holeS), counts });
  console.log('seed candidates:', seeds);
  for (const s of seeds.slice(0, 5)) {
    console.log(JSON.stringify(table(s, 32), null, 1));
  }
}
