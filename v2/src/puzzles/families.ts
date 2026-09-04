import type { Family, Puzzle } from './types.ts';
import { rngFrom, triCluster } from './types.ts';
import type { Prim } from '../glyphs.ts';

/**
 * COUNT GRID — real original-site round-5 DNA: a 3×3 of triangle clusters whose
 * counts form an arithmetic(row) × geometric(col) grid. Options differ ONLY
 * in count (single-attribute decoys). Hole bottom-right.
 *
 * count(r,c) = rowBase(r) * colMult^c,  rowBase(r) = start + step*r
 * diff ramps start/step (1,1 → 2,1 → 1,2 → 2,2, max 24) and decoy closeness
 * (far ±4 at diff 1 → close ±1 at diff 9+, clamped hardest past 12).
 */
export const countGrid: Family = {
  id: 'count-grid',
  generate(seed, diff, hue): Puzzle {
    const eff = diff < 1 ? 1 : diff > 12 ? 12 : Math.floor(diff);
    let start: number;
    let step: number;
    if (eff <= 3) { start = 1; step = 1; }
    else if (eff <= 6) { start = 2; step = 1; }
    else if (eff <= 9) { start = 1; step = 2; }
    else { start = 2; step = 2; }
    const colMult = 2;
    const rowBase = (row: number) => start + step * row;
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
    let ordered: number[];
    if (eff <= 2) ordered = [4, -4, 5, -5, 6, -6, 7, -7, 3, -3, 8, -8, 2, -2, 9, -9, 1, -1, 10, -10];
    else if (eff <= 5) ordered = [3, -3, 4, -4, 5, -5, 6, -6, 2, -2, 7, -7, 1, -1, 8, -8, 9, -9, 10, -10];
    else if (eff <= 8) ordered = [2, -2, 3, -3, 4, -4, 5, -5, 1, -1, 6, -6, 7, -7, 8, -8, 9, -9, 10, -10];
    else ordered = [1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8, -8, 9, -9, 10, -10];
    const keyOf = (ps: Prim[]): string => ps.length + ':' + JSON.stringify(ps.map(p => JSON.stringify(p)).sort());
    const seen = new Set<string>();
    const opts: Prim[][] = [];
    const correctCell = triCluster(answer);
    seen.add(keyOf(correctCell));
    opts.push(correctCell);
    for (const d of ordered) {
      if (opts.length >= 8) break;
      const n = answer + d;
      if (n < 1 || n > 24 || n === answer) continue;
      const cand = triCluster(n);
      const k = keyOf(cand);
      if (seen.has(k)) continue;
      seen.add(k);
      opts.push(cand);
    }
    // fallback ladder separated BY CONSTRUCTION (mark count in larger steps)
    const fallbackSteps = [11, -11, 12, -12, 13, -13, 14, -14, 15, -15];
    for (const d of fallbackSteps) {
      if (opts.length >= 8) break;
      const n = answer + d;
      if (n < 1 || n > 24) continue;
      const cand = triCluster(n);
      const k = keyOf(cand);
      if (seen.has(k)) continue;
      seen.add(k);
      opts.push(cand);
    }
    // shuffle options deterministically
    const rr = rngFrom(seed ^ 0x5f5f);
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(rr() * (i + 1));
      [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    const ansKey = keyOf(correctCell);
    return {
      family: 'count-grid', cols: 3, rows: 3,
      cells, holeIndex: 8, options: opts,
      answer: opts.findIndex(o => keyOf(o) === ansKey),
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
 * ACCRETION — real original-site round-4 DNA: a 2×2 where a base diamond gains
 * structural elements each step (diagonal + corner dots, then both diagonals
 * + more dots, then edge-dot ring). Options mutate which elements appear.
 * Hole bottom-right. Diff ramps dot load (0 → 8) and hard single-attribute
 * decoy share (0/7 → 7/7), clamped hardest past 9.
 */
export const accretion: Family = {
  id: 'accretion',
  generate(seed, diff, hue): Puzzle {
    const eff = diff < 1 ? 1 : diff > 12 ? 12 : Math.floor(diff);
    const DIA: Prim = { k: 'diamond', x: 50, y: 50, s: 14 };
    const D1: Prim = { k: 'line', x1: 30, y1: 30, x2: 70, y2: 70 };
    const D2: Prim = { k: 'line', x1: 70, y1: 30, x2: 30, y2: 70 };
    const pool: Prim[] = [
      { k: 'dot', x: 20, y: 20, r: 3.4 },
      { k: 'dot', x: 80, y: 80, r: 3.4 },
      { k: 'dot', x: 80, y: 20, r: 3.4 },
      { k: 'dot', x: 20, y: 80, r: 3.4 },
      { k: 'dot', x: 30, y: 50, r: 3.4 },
      { k: 'dot', x: 70, y: 50, r: 3.4 },
      { k: 'dot', x: 50, y: 30, r: 3.4 },
      { k: 'dot', x: 50, y: 70, r: 3.4 },
    ];
    const EDGE: Prim[] = [
      { k: 'dot', x: 50, y: 14, r: 3.4 },
      { k: 'dot', x: 50, y: 86, r: 3.4 },
      { k: 'dot', x: 14, y: 50, r: 3.4 },
      { k: 'dot', x: 86, y: 50, r: 3.4 },
    ];
    const k1 = Math.min(4, Math.floor((eff - 1) / 2));
    const k2 = Math.min(8, eff - 1);
    const c0: Prim[] = [{ ...DIA } as Prim];
    const c1: Prim[] = [{ ...DIA } as Prim, { ...D1 } as Prim, ...pool.slice(0, k1).map(p => ({ ...p } as Prim))];
    const c2: Prim[] = [{ ...DIA } as Prim, { ...D1 } as Prim, { ...D2 } as Prim, ...pool.slice(0, k2).map(p => ({ ...p } as Prim))];
    const correct: Prim[] = [...c2.map(p => ({ ...p } as Prim)), ...EDGE.map(p => ({ ...p } as Prim))];
    const cells = [c0, c1, c2, [...correct.map(p => ({ ...p } as Prim))]];
    // single-attribute hard pool (ONE differing attribute, 5px / 1.5r separated)
    const isEdge = (p: Prim, x: number, y: number) => p.k === 'dot' && p.x === x && p.y === y;
    const isD2 = (p: Prim) => p.k === 'line' && p.x1 === 70 && p.y1 === 30;
    const H1: Prim[] = correct.filter(p => !isEdge(p, 86, 50)).map(p => ({ ...p } as Prim));
    const H2: Prim[] = correct.map(p => (p.k === 'diamond' ? { ...p, s: 19 } : { ...p }) as Prim);
    const H3: Prim[] = correct.map(p => (p.k === 'diamond' ? { ...p, s: 9 } : { ...p }) as Prim);
    const H4: Prim[] = correct.map(p => (isEdge(p, 50, 14) ? { ...p, r: 5.4 } : { ...p }) as Prim);
    const H5: Prim[] = correct.map(p => (isEdge(p, 50, 86) ? { ...p, r: 1.9 } : { ...p }) as Prim);
    const H6: Prim[] = correct.map(p => (isEdge(p, 50, 14) ? { ...p, y: 22 } : { ...p }) as Prim);
    const H7: Prim[] = correct.filter(p => !isD2(p)).map(p => ({ ...p } as Prim));
    const hardPool: Prim[][] = [H1, H2, H3, H4, H5, H6, H7];
    // multi-attribute easy pool (several differing attributes, large gaps)
    const E1: Prim[] = correct.filter(p => !isD2(p) && !isEdge(p, 86, 50) && !isEdge(p, 14, 50)).map(p => ({ ...p } as Prim));
    const E2: Prim[] = correct.map(p => (p.k === 'diamond' ? { ...p, s: 4 } : { ...p }) as Prim).filter(p => !isEdge(p, 86, 50));
    const E3: Prim[] = correct.filter(p => !(isEdge(p, 50, 86) || isEdge(p, 14, 50) || isEdge(p, 86, 50))).map(p => ({ ...p } as Prim));
    const E4: Prim[] = correct.map(p => (isEdge(p, 50, 14) || isEdge(p, 50, 86) || isEdge(p, 14, 50) || isEdge(p, 86, 50) ? { ...p, r: 5.4 } : { ...p }) as Prim);
    const E5: Prim[] = correct.map(p => {
      if (p.k === 'diamond') return { ...p, s: 24 } as Prim;
      if (isEdge(p, 50, 14) || isEdge(p, 50, 86) || isEdge(p, 14, 50) || isEdge(p, 86, 50)) return { ...p, r: 5.4 } as Prim;
      return { ...p } as Prim;
    });
    const E6: Prim[] = correct.filter(p => p.k !== 'line').map(p => ({ ...p } as Prim));
    const E7: Prim[] = correct.map(p => {
      if (p.k === 'diamond') return { ...p, s: 4 } as Prim;
      if (isEdge(p, 50, 14) || isEdge(p, 50, 86) || isEdge(p, 14, 50) || isEdge(p, 86, 50)) return { ...p, r: 5.4 } as Prim;
      return { ...p } as Prim;
    });
    const easyPool: Prim[][] = [E1, E2, E3, E4, E5, E6, E7];
    const hardCount = eff <= 2 ? 0 : eff >= 9 ? 7 : eff - 2;
    const orderedCands: Prim[][] = [...hardPool.slice(0, hardCount), ...easyPool.slice(0, 7 - hardCount)];
    const keyOf = (ps: Prim[]): string => JSON.stringify(ps.map(p => JSON.stringify(p)).sort());
    const seen = new Set<string>();
    seen.add(keyOf(correct));
    const decoys: Prim[][] = [];
    for (const cand of orderedCands) {
      if (decoys.length >= 7) break;
      const k = keyOf(cand);
      if (seen.has(k)) continue;
      seen.add(k);
      decoys.push(cand);
    }
    // fallback ladder separated BY CONSTRUCTION: diamond arm in 5px steps,
    // edge-dot count, line arm in 5px steps (never angle jitter).
    const F1: Prim[] = correct.map(p => (p.k === 'diamond' ? { ...p, s: 24 } : { ...p }) as Prim);
    const F2: Prim[] = correct.map(p => (p.k === 'diamond' ? { ...p, s: 4 } : { ...p }) as Prim);
    const F3: Prim[] = correct.filter(p => !isEdge(p, 50, 86) && !isEdge(p, 86, 50)).map(p => ({ ...p } as Prim));
    const F4: Prim[] = correct.filter(p => !(isEdge(p, 50, 86) || isEdge(p, 14, 50) || isEdge(p, 86, 50))).map(p => ({ ...p } as Prim));
    const F5: Prim[] = correct.map(p => (p.k === 'line' && p.x1 === 30 ? { ...p, x1: 35, y1: 35, x2: 65, y2: 65 } : { ...p }) as Prim);
    const F6: Prim[] = correct.map(p => (p.k === 'line' && p.x1 === 30 ? { ...p, x1: 40, y1: 40, x2: 60, y2: 60 } : { ...p }) as Prim);
    const F7: Prim[] = correct.map(p => (p.k === 'diamond' ? { ...p, s: 19 } : { ...p }) as Prim).filter(p => !isEdge(p, 86, 50));
    const F8: Prim[] = correct.map(p => (p.k === 'diamond' ? { ...p, s: 9 } : { ...p }) as Prim).filter(p => !isEdge(p, 14, 50));
    const fallback: Prim[][] = [F1, F2, F3, F4, F5, F6, F7, F8];
    for (const cand of fallback) {
      if (decoys.length >= 7) break;
      const k = keyOf(cand);
      if (seen.has(k)) continue;
      seen.add(k);
      decoys.push(cand);
    }
    const opts: Prim[][] = [correct, ...decoys.slice(0, 7)];
    const rr = rngFrom(seed ^ 0xa11ce);
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(rr() * (i + 1));
      [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    const ansKey = keyOf(correct);
    return {
      family: 'accretion', cols: 2, rows: 2,
      cells, holeIndex: 3, options: opts,
      answer: opts.findIndex(o => keyOf(o) === ansKey),
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
