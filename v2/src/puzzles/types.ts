import type { Prim } from '../glyphs.ts';

/** A generated puzzle. One hue per board (DNA rule 1). */
export interface Puzzle {
  family: string;
  cols: number;
  rows: number;
  cells: Prim[][];
  holeIndex: number;      // bottom-right by convention
  options: Prim[][];
  answer: number;         // index into options
  hue: string;
  rule: string;           // one sentence, shown at reveal
}

export interface Family {
  id: string;
  /** difficulty 1..5 */
  generate(seed: number, diff: number, hue: string): Puzzle;
  /** Independent solver: re-derives the answer index from VISIBLE data only.
   *  Returns -1 when the visible data contradicts the rule (gauntlet catches). */
  solve(p: Puzzle): number;
}

/** Deterministic rng from an integer seed (mulberry32). */
export function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Arrange `n` triangle marks in tidy rows, self-scaled to fit the 100-unit cell. */
export function triCluster(n: number): Prim[] {
  const out: Prim[] = [];
  const perRow = Math.max(3, Math.ceil(Math.sqrt(n * 1.6)));
  const rows = Math.ceil(n / perRow);
  /* self-fit: shrink mark size and spacing so the block stays inside ~84 units */
  const s = Math.min(9, 74 / (perRow * 2.4), 74 / (rows * 2.6));
  const gapX = Math.min(24, 78 / perRow);
  const gapY = Math.min(26, 78 / rows);
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / perRow), col = i % perRow;
    const inRow = Math.min(perRow, n - r * perRow);
    const x = 50 + (col - (inRow - 1) / 2) * gapX;
    const y = 50 + (r - (rows - 1) / 2) * gapY;
    out.push({ k: 'tri', x, y, s });
  }
  return out;
}
