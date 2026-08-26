/**
 * Family clarity probe — analytic option-separation measurement.
 * For every family (families.ts..families4.ts), across seeds x diffs:
 *   - rebuild each option set, locate the truth glyph,
 *   - per decoy compute `vis` = bidirectional nearest-feature distance between
 *     decoy and truth prims (cell units, 0..100). Feature distance between two
 *     prims = same kind ? max(euclid(centers), |sizeDelta|) : CELL_DIAG
 *     (cross-kind marks are trivially distinguishable; co-located size mutants
 *     score exactly their size delta).
 *   - asserts no shipped option duplicates the truth.
 * Run: node research/v2-gauntlet/family-clarity-probe.ts
 */
import { FAMILIES } from '../../v2/src/puzzles/families.ts';
import { FAMILIES2 } from '../../v2/src/puzzles/families2.ts';
import { FAMILIES3 } from '../../v2/src/puzzles/families3.ts';
import { FAMILIES4 } from '../../v2/src/puzzles/families4.ts';

const ALL = [...FAMILIES, ...FAMILIES2, ...FAMILIES3, ...FAMILIES4];
const CELL_DIAG = 141;

function sizeOf(p) {
  if (p.k === 'dot') return p.r;
  if (p.k === 'line') return Math.hypot(p.x2 - p.x1, p.y2 - p.y1);
  return p.s;
}

function fdist(a, b) {
  if (a.k !== b.k) return CELL_DIAG;
  if (a.k === 'line') {
    // endpoint-matched distance: catches axis flips that preserve midpoint+length
    const d11 = Math.hypot(a.x1 - b.x1, a.y1 - b.y1), d22 = Math.hypot(a.x2 - b.x2, a.y2 - b.y2);
    const d12 = Math.hypot(a.x1 - b.x2, a.y1 - b.y2), d21 = Math.hypot(a.x2 - b.x1, a.y2 - b.y1);
    return Math.max(Math.min(d11, d12), Math.min(d22, d21));
  }
  return Math.max(Math.hypot(a.x - b.x, a.y - b.y), Math.abs(sizeOf(a) - sizeOf(b)));
}
/** bidirectional nearest-feature distance */
function vis(A, B) {
  let worst = 0;
  for (const X of [A, B]) for (const Y of [A, B].filter(z => z !== X)) {
    for (const a of X) {
      let best = Infinity;
      for (const b of Y) best = Math.min(best, fdist(a, b));
      if (best > worst) worst = best;
    }
  }
  return worst;
}
function key(prims) {
  return JSON.stringify([...prims].map(p => JSON.parse(JSON.stringify(p)))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

let dupes = 0;
for (const fam of ALL) {
  let worst = { vis: Infinity, desc: '' };
  for (let diff = 1; diff <= 5; diff++) {
    for (let s = 0; s < 60; s++) {
      const seed = ((s + 1) * 2654435761 ^ (diff * 40503)) >>> 0;
      const p = fam.generate(seed, diff, '#d4a017');
      const truth = p.options[p.answer];
      const tk = key(truth);
      p.options.forEach((o, oi) => {
        if (oi === p.answer) return;
        if (key(o) === tk) dupes++;
        const v = vis(o, truth);
        if (v < worst.vis) {
          worst = { vis: v, desc: `seed=${seed} d=${diff} opt#${oi} cntΔ=${o.length - truth.length} kinds=${o.map(q => q.k).join('')}` };
        }
      });
    }
  }
  console.log(`${fam.id.padEnd(20)} minVis=${worst.vis.toFixed(2).padStart(7)}  ${worst.desc}`);
}
console.log(dupes === 0 ? 'no duplicate options' : `${dupes} DUPLICATE OPTIONS`);
