import type { Family, Puzzle } from './types.ts';
import { rngFrom, triCluster } from './types.ts';
import type { Prim } from '../glyphs.ts';

/**
 * COUNT GRID — real iqversus round-5 DNA: a 3×3 of triangle clusters whose
 * counts form an arithmetic(row) × geometric(col) grid. Options differ ONLY
 * in count (single-attribute decoys). Hole bottom-right.
 *
 * count(r,c) = rowBase(r) * colMult^c,  rowBase(r) = 2 + step*r
 * diff scales step (2→3) and colMult stays 2 (readable doubling).
 */
export const countGrid: Family = {
  id: 'count-grid',
  generate(seed, diff, hue): Puzzle {
    const r = rngFrom(seed);
    const step = diff >= 4 ? 3 : 2;
    const colMult = 2;
    const rowBase = (row: number) => 2 + step * row;
    const count = (row: number, col: number) => rowBase(row) * Math.pow(colMult, col);
    const cells: Prim[][] = [];
    const counts: number[] = [];
    for (let i = 0; i < 9; i++) {
      const row = Math.floor(i / 3), col = i % 3;
      const n = count(row, col);
      counts.push(n);
      cells.push(triCluster(n));
    }
    const answer = counts[8];
    const deltas = [-3, -2, -1, 1, 2, 3, 4].map(d => answer + d).filter(n => n >= 1 && n !== answer);
    const opts: Prim[][] = [triCluster(answer)];
    for (const n of deltas.slice(0, 7)) opts.push(triCluster(n));
    // shuffle options deterministically
    const rr = rngFrom(seed ^ 0x5f5f);
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(rr() * (i + 1));
      [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    return {
      family: 'count-grid', cols: 3, rows: 3,
      cells, holeIndex: 8, options: opts,
      answer: opts.findIndex(o => o.length === answer),
      hue, rule: `columns double the count; each row starts ${step} higher`,
    };
  },
  solve(p): number {
    // independent: every row must share one col-ratio; row bases must step evenly;
    // hole (2,2) = last visible in its row times the ratio.
    const n = (i: number) => p.cells[i].length;
    const ratio = (row: number) => n(row * 3 + 1) / n(row * 3);
    if (!(Math.abs(ratio(0) - ratio(1)) < 1e-9 && Math.abs(ratio(1) - ratio(2)) < 1e-9)) return -1;
    const b0 = n(0), b1 = n(3), b2 = n(6);
    if (b1 - b0 !== b2 - b1) return -1;
    const holeCount = Math.round(n(7) * ratio(2));
    return p.options.findIndex(o => o.length === holeCount);
  },
};

/**
 * ACCRETION — real iqversus round-4 DNA: a 2×2 where a base diamond gains
 * structural elements each step (diagonal + corner dots, then both diagonals
 * + more dots). Options mutate which elements appear. Hole bottom-right.
 */
export const accretion: Family = {
  id: 'accretion',
  generate(seed, diff, hue): Puzzle {
    const r = rngFrom(seed);
    const diamond: Prim = { k: 'diamond', x: 50, y: 50, s: 14 };
    const diag1: Prim = { k: 'line', x1: 20, y1: 20, x2: 80, y2: 80 };
    const diag2: Prim = { k: 'line', x1: 80, y1: 20, x2: 20, y2: 80 };
    const dots2: Prim[] = [{ k: 'dot', x: 20, y: 20, r: 3.4 }, { k: 'dot', x: 80, y: 80, r: 3.4 }];
    const dots4: Prim[] = [...dots2, { k: 'dot', x: 80, y: 20, r: 3.4 }, { k: 'dot', x: 20, y: 80, r: 3.4 }];
    const step0: Prim[] = [diamond];
    const step1: Prim[] = [diamond, diag1, ...dots2];
    const step2: Prim[] = [diamond, diag1, diag2, ...dots4];
    // step3 (the hole): add edge-mid dots (diff>=3 adds a second ring)
    const step3: Prim[] = [...step2,
      { k: 'dot', x: 50, y: 14, r: 3.4 }, { k: 'dot', x: 50, y: 86, r: 3.4 },
      { k: 'dot', x: 14, y: 50, r: 3.4 }, { k: 'dot', x: 86, y: 50, r: 3.4 }];
    const cells = [step0, step1, step2, step3];
    // decoys: single-attribute mutations of step3
    const decoys: Prim[][] = [
      [diamond, diag2, ...dots4, { k: 'dot', x: 50, y: 14, r: 3.4 }, { k: 'dot', x: 50, y: 86, r: 3.4 }], // one diagonal missing
      [...step3.slice(0, 4), { k: 'dot', x: 50, y: 14, r: 5.2 }, { k: 'dot', x: 50, y: 86, r: 5.2 }, { k: 'dot', x: 14, y: 50, r: 5.2 }, { k: 'dot', x: 86, y: 50, r: 5.2 }], // dot size mutated (+53 %, was +29 %)
      [...step3.slice(0, 6)], // two edge dots missing
      [diamond, diag1, diag2, { k: 'dot', x: 26, y: 26, r: 3.4 }, { k: 'dot', x: 74, y: 74, r: 3.4 }, { k: 'dot', x: 74, y: 26, r: 3.4 }, { k: 'dot', x: 26, y: 74, r: 3.4 }], // corner dots misplaced
      [...step3, { k: 'dot', x: 26, y: 26, r: 3.4 }], // extra corner dot added
      [...step3.slice(0, 6), { k: 'dot', x: 86, y: 50, r: 2.0 }], // one edge dot shrunk (−41 %, was −29 %)
      [{ k: 'diamond', x: 50, y: 50, s: 8 }, ...step3.slice(1)], // diamond shrunk (−43 %, was −29 %)
    ];
    const opts: Prim[][] = [step3, ...decoys];
    const rr = rngFrom(seed ^ 0xa11ce);
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(rr() * (i + 1));
      [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    void r; void diff;
    return {
      family: 'accretion', cols: 2, rows: 2,
      cells, holeIndex: 3, options: opts,
      answer: opts.indexOf(step3),
      hue, rule: 'each step adds one structure: diagonal, then corners, then edge dots',
    };
  },
  solve(p): number {
    // independent: cells must grow strictly (superset chain 0<1<2), and the
    // answer is the option that is cell2 plus exactly the same-size edge-dot ring.
    const key = (prims: Prim[]) => JSON.stringify([...prims].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    if (!(p.cells[1].length > p.cells[0].length && p.cells[2].length > p.cells[1].length)) return -1;
    const expect: Prim[] = [...p.cells[2],
      { k: 'dot', x: 50, y: 14, r: 3.4 }, { k: 'dot', x: 50, y: 86, r: 3.4 },
      { k: 'dot', x: 14, y: 50, r: 3.4 }, { k: 'dot', x: 86, y: 50, r: 3.4 }];
    const ke = key(expect);
    return p.options.findIndex(o => key(o) === ke);
  },
};

export const FAMILIES: Family[] = [countGrid, accretion];
