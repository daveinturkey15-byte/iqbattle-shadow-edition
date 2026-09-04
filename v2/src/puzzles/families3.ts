import type { Family, Puzzle } from './types.ts';
import { rngFrom } from './types.ts';
import type { Prim } from '../glyphs.ts';

/* ---- shared helpers (module-local, mirrors families2 conventions) ------- */

function r2(v: number): number { return Math.round(v * 100) / 100; }

/** Canonical structural key of a glyph: order-independent, float-safe. */
function glyphKey(prims: Prim[]): string {
  const norm = prims.map(p => {
    switch (p.k) {
      case 'tri': return { k: 'tri', x: r2(p.x), y: r2(p.y), s: r2(p.s) };
      case 'dot': return { k: 'dot', x: r2(p.x), y: r2(p.y), r: r2(p.r) };
      case 'diamond': return { k: 'diamond', x: r2(p.x), y: r2(p.y), s: r2(p.s) };
      case 'line': return { k: 'line', x1: r2(p.x1), y1: r2(p.y1), x2: r2(p.x2), y2: r2(p.y2) };
    }
  });
  return JSON.stringify(norm.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

function shuffled(opts: Prim[][], seed: number): Prim[][] {
  const rr = rngFrom(seed);
  const out = [...opts];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rr() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Build the option list: answer first, decoys after; dedupe deterministically
 *  and top back up from `filler` candidates so exactly 8 distinct glyphs ship. */
function finalize(answer: Prim[], decoys: Prim[][], filler: Prim[][], seed: number): { opts: Prim[][]; answerIdx: number } {
  const seen = new Set<string>([glyphKey(answer)]);
  const pool: Prim[][] = [];
  for (const d of [...decoys, ...filler]) {
    if (pool.length >= 7) break;
    const k = glyphKey(d);
    if (!seen.has(k)) { seen.add(k); pool.push(d); }
  }
  const opts = shuffled([answer, ...pool], seed);
  return { opts, answerIdx: opts.findIndex(o => glyphKey(o) === glyphKey(answer)) };
}

const mod8 = (v: number): number => ((v % 8) + 8) % 8;
const mod9 = (v: number): number => ((v % 9) + 9) % 9;
/** signed delta in a modulus space, folded into (-m/2, m/2] */
function foldDelta(d: number, m: number): number {
  let x = ((d % m) + m) % m;
  if (x > m / 2) x -= m;
  return x;
}

/* ========================================================================
 * DOT MATRIX ROTATE — live round-1 DNA: 3x3 of dot-cluster arcs on an
 * 8-slot ring. The arc's start slot rotates 90 degrees (2 slots) per column
 * AND the cluster gains one dot per row. Ramp 1..12: longer arcs, free
 * rotation sign and prepend/append growth at high diff, decoy window slides
 * from coarse (count/180deg) to fine (1-slot / single-dot nudge).
 * ====================================================================== */

const DM_SLOTS = 8;
const DM_ROT = 2;          // slots per 90-degree column step
const DM_RADIUS = 30;

function dmPos(slot: number, radius = DM_RADIUS): { x: number; y: number } {
  const ang = ((mod8(slot) * 45) - 90) * Math.PI / 180;
  return { x: r2(50 + radius * Math.cos(ang)), y: r2(50 + radius * Math.sin(ang)) };
}

/** Consecutive-slot dot arc: `n` dots starting at `head`, stepping `spacing`. */
function dmGlyph(head: number, n: number, spacing = 1): Prim[] {
  const out: Prim[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ k: 'dot', ...dmPos(mod8(head + spacing * i)), r: 4.4 });
  }
  return out;
}

/** Parse a cell into its consecutive arc {head, n} — null when off-DNA. */
function dmParse(cell: Prim[]): { head: number; n: number } | null {
  if (cell.length < 2 || cell.length > 6) return null;
  const slots: number[] = [];
  for (const p of cell) {
    if (p.k !== 'dot') return null;
    const dx = p.x - 50, dy = p.y - 50;
    if (Math.abs(Math.hypot(dx, dy) - DM_RADIUS) > 1.5) return null;
    const deg = (Math.atan2(dy, dx) * 180 / Math.PI + 450) % 360; // 0 at top, cw
    const slot = Math.round(deg / 45) % DM_SLOTS;
    if (Math.abs(deg - slot * 45) > 1) return null;
    slots.push(slot);
  }
  const set = new Set(slots);
  if (set.size !== slots.length) return null;
  for (let h = 0; h < DM_SLOTS; h++) {
    let ok = true;
    for (let i = 0; i < slots.length; i++) if (!set.has(mod8(h + i))) { ok = false; break; }
    if (ok && set.size === slots.length) return { head: h, n: slots.length };
  }
  return null;
}

export const dotMatrixRotate: Family = {
  id: 'dot-matrix-rotate',
  generate(seed, diff, hue): Puzzle {
    const r = rngFrom(seed);
    const D = Math.max(1, Math.min(12, Math.floor(diff)));
    // ramp: arc length grows 2 -> 3 -> 4 (clamped so answer n <= 6)
    const base = D <= 2 ? 2 : D <= 5 ? 3 : 4;
    const head0 = Math.floor(r() * DM_SLOTS);
    const dirDraw = r();
    const growDraw = r();
    // ramp: low diff always clockwise + append; high diff randomises sign/growth
    const dir = D >= 7 ? (dirDraw < 0.5 ? 1 : -1) : 1;
    const grow = D >= 5 ? (growDraw < 0.5 ? 0 : -1) : 0;
    const headAt = (row: number, col: number): number => mod8(head0 + dir * DM_ROT * col + grow * row);
    const nAt = (row: number): number => base + row;
    const cells: Prim[][] = [];
    for (let i = 0; i < 8; i++) {
      const row = Math.floor(i / 3), col = i % 3;
      cells.push(dmGlyph(headAt(row, col), nAt(row)));
    }
    const aHead = headAt(2, 2), aN = nAt(2);
    // mirrored (chirality-flipped) arc head
    const mHead = mod8(-(aHead + aN - 1));
    const gapDots: Prim[] = [...dmGlyph(aHead, aN - 1), { k: 'dot', ...dmPos(mod8(aHead - 2)), r: 4.4 }];
    const tailShift: Prim[] = [...dmGlyph(aHead, aN - 1), { k: 'dot', ...dmPos(mod8(aHead + aN)), r: 4.4 }];
    const headShift: Prim[] = [{ k: 'dot', ...dmPos(mod8(aHead - 1)), r: 4.4 }, ...dmGlyph(mod8(aHead + 1), aN - 1)];
    const extraCount = aN + 1 <= 6 ? dmGlyph(aHead, aN + 1) : dmGlyph(mod8(aHead + 4), aN);
    const stretchCand = (2 * aN <= DM_SLOTS) ? dmGlyph(aHead, aN, 2) : dmGlyph(mod8(aHead + 3), aN);
    // master decoy ladder ordered coarse -> fine (one attribute each)
    const master: Prim[][] = [
      dmGlyph(aHead, aN - 1),                    // 0 short count (easy)
      extraCount,                                // 1 extra count
      dmGlyph(mod8(aHead + 4), aN),              // 2 opposite 180deg
      dmGlyph(mod8(aHead + DM_ROT), aN),         // 3 phase +90deg
      dmGlyph(mod8(aHead - DM_ROT), aN),         // 4 phase -90deg
      dmGlyph(mHead, aN),                        // 5 mirrored arc
      stretchCand,                               // 6 stretched / far phase
      gapDots,                                   // 7 tail relocated by 2
      dmGlyph(mod8(aHead + 1), aN),              // 8 phase +1 slot (fine)
      dmGlyph(mod8(aHead - 1), aN),              // 9 phase -1 slot
      tailShift,                                 // 10 tail nudged by 1 (finest)
      headShift,                                 // 11 head nudged by 1
    ];
    const start = Math.floor((D - 1) * (master.length - 7) / 11);
    const decoys = master.slice(start, start + 7);
    const filler: Prim[][] = [
      ...[1, 2, 3, 4, 5, 6, 7].map(k => dmGlyph(mod8(aHead + k), aN)),
      dmGlyph(mod8(aHead + 1), aN - 1),
      dmGlyph(mod8(aHead - 1), aN - 1),
      aN + 1 <= 6 ? dmGlyph(mod8(aHead + 1), aN + 1) : dmGlyph(mod8(aHead + 2), aN - 1),
      tailShift,
      headShift,
      gapDots,
    ];
    const answer = dmGlyph(aHead, aN);
    const { opts, answerIdx } = finalize(answer, decoys, filler, seed ^ 0x3a11);
    return {
      family: 'dot-matrix-rotate', cols: 3, rows: 3,
      cells, holeIndex: 8, options: opts, answer: answerIdx,
      hue, rule: 'the dot arc turns 90° per column and gains one dot per row',
    };
  },
  solve(p): number {
    if (p.cells.length !== 8) return -1;
    const arcs = p.cells.map(dmParse);
    if (arcs.some(a => a === null)) return -1;
    const A = arcs as { head: number; n: number }[];
    const at = (row: number, col: number) => A[row * 3 + col];
    // counts: constant across each row, +1 per row
    for (let row = 0; row < 3; row++) {
      if (at(row, 1).n !== at(row, 0).n) return -1;
    }
    if (at(1, 0).n !== at(0, 0).n + 1 || at(2, 0).n !== at(1, 0).n + 1) return -1;
    // heads: constant ±DM_ROT column step everywhere observable
    let d: number | null = null;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 2; col++) {
        if (row === 2 && col === 1) break;   // (2,2) is the hole
        const step = foldDelta(at(row, col + 1).head - at(row, col).head, DM_SLOTS);
        if (Math.abs(step) !== DM_ROT) return -1;
        if (d === null) d = step;
        else if (step !== d) return -1;
      }
    }
    if (d === null) return -1;
    // growth direction down a column: head stays (append at tail) or head −1 (prepend)
    let g: number | null = null;
    for (let col = 0; col < 2; col++) {
      const step = foldDelta(at(1, col).head - at(0, col).head, DM_SLOTS);
      const step2 = foldDelta(at(2, col).head - at(1, col).head, DM_SLOTS);
      if (step !== step2 || (step !== 0 && step !== -1)) return -1;
      if (g === null) g = step;
      else if (step !== g) return -1;
    }
    if (g === null) return -1;
    // hole sits in the BOTTOM ROW: count stays at row 2's count; only the
    // column rotation advances by d.
    const expHead = mod8(at(2, 1).head + d);
    const expN = at(2, 1).n;
    const ke = glyphKey(dmGlyph(expHead, expN));
    const hits: number[] = [];
    p.options.forEach((o, i) => { if (glyphKey(o) === ke) hits.push(i); });
    return hits.length === 1 ? hits[0] : -1;
  },
};

/* ========================================================================
 * LINE REFLECTION — real original-site mirror family: a 2x2 of line-segment
 * figures on a 3x3 point lattice. The right column mirrors the left
 * horizontally (across the figure's vertical center axis); the bottom row
 * mirrors the top vertically. Hole = double mirror = 180-degree rotation of
 * the base figure. Ramp 1..12: more segments (2..7, clamped) and decoy
 * window from missing-mirror coarse to single-segment fine.
 * ====================================================================== */

const LR_PTS = [28, 50, 72];
type LRPt = { x: number; y: number };

/** All king-adjacent undirected edges of the 3x3 lattice, canonical form. */
const LR_EDGES: string[] = (() => {
  const out: string[] = [];
  const key = (a: LRPt, b: LRPt): string =>
    JSON.stringify(a.x <= b.x || (a.x === b.x && a.y <= b.y) ? [a.x, a.y, b.x, b.y] : [b.x, b.y, a.x, a.y]);
  for (const x1 of LR_PTS) for (const y1 of LR_PTS)
    for (const x2 of LR_PTS) for (const y2 of LR_PTS) {
      if (Math.abs(x1 - x2) > 22 || Math.abs(y1 - y2) > 22) continue;
      if (x1 === x2 && y1 === y2) continue;
      const k = key({ x: x1, y: y1 }, { x: x2, y: y2 });
      if (!out.includes(k)) out.push(k);
    }
  return out;
})();

function lrPrims(keys: Iterable<string>): Prim[] {
  return [...keys].sort().map(k => {
    const [x1, y1, x2, y2] = JSON.parse(k) as number[];
    return { k: 'line' as const, x1, y1, x2, y2 };
  });
}

function lrKeys(cell: Prim[]): Set<string> | null {
  const set = new Set<string>();
  for (const p of cell) {
    if (p.k !== 'line') return null;
    const sx = lrSnap(p.x1), sy = lrSnap(p.y1), ex = lrSnap(p.x2), ey = lrSnap(p.y2);
    if (sx === null || sy === null || ex === null || ey === null) return null;
    const a = { x: sx, y: sy }, b = { x: ex, y: ey };
    if (a.x === b.x && a.y === b.y) return null;
    set.add(JSON.stringify(a.x <= b.x || (a.x === b.x && a.y <= b.y) ? [a.x, a.y, b.x, b.y] : [b.x, b.y, a.x, a.y]));
  }
  return set.size ? set : null;
}

function lrSnap(v: number): number | null {
  for (const g of LR_PTS) if (Math.abs(v - g) < 1.0) return g;
  return null;
}

function lrMap(cell: Prim[], f: (p: LRPt) => LRPt): Prim[] {
  return cell.map(p => {
    if (p.k !== 'line') throw new Error('lrMap: non-line');
    const a = f({ x: p.x1, y: p.y1 }), b = f({ x: p.x2, y: p.y2 });
    return { k: 'line' as const, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  });
}
const lrH = (cell: Prim[]): Prim[] => lrMap(cell, p => ({ x: 100 - p.x, y: p.y }));
const lrV = (cell: Prim[]): Prim[] => lrMap(cell, p => ({ x: p.x, y: 100 - p.y }));
const lrT = (cell: Prim[]): Prim[] => lrMap(cell, p => ({ x: p.y, y: p.x }));
const lrA = (cell: Prim[]): Prim[] => lrMap(cell, p => ({ x: 100 - p.y, y: 100 - p.x }));

export const lineReflection: Family = {
  id: 'line-reflection',
  generate(seed, diff, hue): Puzzle {
    const r = rngFrom(seed);
    const D = Math.max(1, Math.min(12, Math.floor(diff)));
    // ramp: segment count climbs 2..7 then clamps (still 1..24 marks)
    const want = Math.min(7, 2 + Math.floor((D - 1) / 2));
    let base: Prim[] = [];
    // deterministic rejection sampling: base must break every mirror symmetry
    for (let attempt = 0; attempt < 64; attempt++) {
      const chosen = new Set<string>();
      while (chosen.size < want) chosen.add(LR_EDGES[Math.floor(r() * LR_EDGES.length)]);
      const cand = lrPrims(chosen);
      const h = glyphKey(lrH(cand)), v = glyphKey(lrV(cand)), hv = glyphKey(lrH(lrV(cand)));
      const g = glyphKey(cand);
      if (h !== g && v !== g && hv !== g) { base = cand; break; }
    }
    if (!base.length) base = lrPrims(LR_EDGES.slice(0, want));
    const ans = lrH(lrV(base));
    const ansSet = lrKeys(ans)!;
    const sortedAns = [...ansSet].sort();
    const outside = LR_EDGES.filter(e => !ansSet.has(e)).sort();
    const dropVariants: Prim[][] = sortedAns.map(e => lrPrims([...ansSet].filter(x => x !== e)));
    const addVariants: Prim[][] = outside.map(e => lrPrims([...ansSet, e]));
    // master ladder coarse -> fine: missing mirrors, wrong axes, rotations, then 1-segment edits
    const master: Prim[][] = [
      base,
      lrH(base),
      lrV(base),
      lrT(ans),
      lrA(ans),
      lrMap(ans, p => ({ x: p.y, y: 100 - p.x })),
      lrMap(ans, p => ({ x: 100 - p.y, y: p.x })),
      ...dropVariants,
      ...addVariants,
    ];
    const start = master.length > 7 ? Math.floor((D - 1) * (master.length - 7) / 11) : 0;
    const decoys = master.slice(start, start + 7);
    // seeded fallback ladder: remaining single edits then double edits
    const filler: Prim[][] = [
      ...dropVariants,
      ...addVariants,
      ...sortedAns.slice(0, Math.min(3, sortedAns.length)).map(e => {
        const rest = new Set([...ansSet].filter(x => x !== e));
        const add = outside[0];
        if (add !== undefined) rest.add(add);
        return lrPrims(rest);
      }),
      lrT(ans),
      lrA(ans),
      base,
    ];
    const { opts, answerIdx } = finalize(ans, decoys, filler, seed ^ 0x5eed);
    return {
      family: 'line-reflection', cols: 2, rows: 2,
      cells: [base, lrH(base), lrV(base)], holeIndex: 3,
      options: opts, answer: answerIdx,
      hue, rule: 'the right column mirrors the left horizontally; the bottom row mirrors the top vertically',
    };
  },
  solve(p): number {
    if (p.cells.length !== 3) return -1;
    // both mirrors must hold on the VISIBLE cells (integer coords, exact keys)
    if (glyphKey(lrH(p.cells[0])) !== glyphKey(p.cells[1])) return -1;
    if (glyphKey(lrV(p.cells[0])) !== glyphKey(p.cells[2])) return -1;
    // expected hole: both mirrors composed on the base figure
    const ke = glyphKey(lrH(lrV(p.cells[0])));
    const hits: number[] = [];
    p.options.forEach((o, i) => { if (glyphKey(o) === ke) hits.push(i); });
    return hits.length === 1 ? hits[0] : -1;
  },
};

/* ========================================================================
 * COUNT POSITIONS — marks occupy spots on a 3x3 lattice inside each cell.
 * The COUNT is constant everywhere; the occupied-position SET advances one
 * lattice-step (row-major wrap) per column, with each row starting at a
 * different phase. Ramp 1..12: count 2..5 (clamped) and decoys from
 * count-different coarse to single-relocation fine.
 * ====================================================================== */

const CP_COORDS = [26, 50, 74];

function cpPos(i: number): { x: number; y: number } {
  return { x: CP_COORDS[i % 3], y: CP_COORDS[Math.floor(i / 3)] };
}

function cpGlyph(set: Iterable<number>): Prim[] {
  return [...set].sort((a, b) => a - b).map(i => ({ k: 'diamond' as const, ...cpPos(i), s: 6.2 }));
}

function cpInc(set: Set<number>, k: number): Set<number> {
  const out = new Set<number>();
  for (const p of set) out.add(mod9(p + k));
  return out;
}

function cpParse(cell: Prim[]): Set<number> | null {
  const out = new Set<number>();
  for (const p of cell) {
    if (p.k !== 'diamond') return null;
    let idx: number | null = null;
    for (let i = 0; i < 9; i++) {
      const q = cpPos(i);
      if (Math.abs(q.x - p.x) < 1 && Math.abs(q.y - p.y) < 1) { idx = i; break; }
    }
    if (idx === null) return null;
    if (out.has(idx)) return null;
    out.add(idx);
  }
  return out.size ? out : null;
}

export const countPositions: Family = {
  id: 'count-positions',
  generate(seed, diff, hue): Puzzle {
    const r = rngFrom(seed);
    const D = Math.max(1, Math.min(12, Math.floor(diff)));
    // ramp: mark count 2..5 then clamps (evenly spaced diamonds, no overlap)
    const K = Math.min(5, 2 + Math.floor((D - 1) / 3));
    const S0 = new Set<number>();
    while (S0.size < K) S0.add(Math.floor(r() * 9));
    const rowPhase = r() < 0.5 ? 3 : 2;
    const setAt = (row: number, col: number) => cpInc(S0, col + row * rowPhase);
    const cells: Prim[][] = [];
    for (let i = 0; i < 8; i++) cells.push(cpGlyph(setAt(Math.floor(i / 3), i % 3)));
    const ans = cpInc(setAt(2, 1), 1);
    const free: number[] = [];
    for (let i = 0; i < 9; i++) if (!ans.has(i)) free.push(i);
    const sortedAns = [...ans].sort((a, b) => a - b);
    const swapOut = sortedAns[1 % sortedAns.length];
    const swapped = new Set([...ans].filter(v => v !== swapOut));
    swapped.add(free[0]);
    const mirrored = new Set([...ans].map(i => Math.floor(i / 3) * 3 + (2 - (i % 3))));
    const transposed = new Set([...ans].map(i => (i % 3) * 3 + Math.floor(i / 3)));
    const missing = new Set(sortedAns.slice(0, ans.size - 1));
    const extra = new Set([...ans, free[0]]);
    // per-mark relocation variants (drop each mark, backfill lowest free): finest
    const relocations: Prim[][] = sortedAns.map(e => {
      const rest = new Set([...ans].filter(v => v !== e));
      const f = [0, 1, 2, 3, 4, 5, 6, 7, 8].find(i => i !== e && !rest.has(i))!;
      rest.add(f);
      return cpGlyph(rest);
    });
    // master coarse -> fine: count differs, far shifts, global transforms, near shifts, relocations
    const master: Prim[][] = [
      cpGlyph(missing),
      cpGlyph(extra),
      cpGlyph(cpInc(ans, 4)),
      cpGlyph(cpInc(ans, 3)),
      cpGlyph(cpInc(ans, 2)),
      cpGlyph(mirrored),
      cpGlyph(transposed),
      cpGlyph(cpInc(ans, -1)),
      cpGlyph(cpInc(ans, 1)),
      cpGlyph(swapped),
      ...relocations,
    ];
    const start = Math.floor((D - 1) * (master.length - 7) / 11);
    const decoys = master.slice(start, start + 7);
    const filler: Prim[][] = [
      ...[2, 3, 4, 5].map(k => cpGlyph(cpInc(ans, k))),
      cpGlyph(cpInc(ans, -1)),
      cpGlyph(cpInc(ans, 1)),
      ...relocations,
      cpGlyph(mirrored),
      cpGlyph(transposed),
      cpGlyph(missing),
      cpGlyph(extra),
    ];
    const { opts, answerIdx } = finalize(cpGlyph(ans), decoys, filler, seed ^ 0x70a5);
    return {
      family: 'count-positions', cols: 3, rows: 3,
      cells, holeIndex: 8, options: opts, answer: answerIdx,
      hue, rule: 'the mark count never changes; the occupied lattice spots advance one step per column',
    };
  },
  solve(p): number {
    if (p.cells.length !== 8) return -1;
    const sets = p.cells.map(cpParse);
    if (sets.some(s => s === null)) return -1;
    const S = sets as Set<number>[];
    const n = S[0].size;
    if (S.some(s => s.size !== n)) return -1;                 // count constant
    const eq = (a: Set<number>, b: Set<number>): boolean =>
      a.size === b.size && [...a].every(v => b.has(v));
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 2; col++) {
        if (row === 2 && col === 1) break;   // (2,2) is the hole
        if (!eq(S[row * 3 + col + 1], cpInc(S[row * 3 + col], 1))) return -1; // one step per column
      }
    }
    const ke = glyphKey(cpGlyph(cpInc(S[7], 1)));
    const hits: number[] = [];
    p.options.forEach((o, i) => { if (glyphKey(o) === ke) hits.push(i); });
    return hits.length === 1 ? hits[0] : -1;
  },
};

/* ========================================================================
 * SIZE LADDER — a single centered equilateral-triangle outline per cell.
 * Its SIZE steps up an arithmetic ladder per column while its ROTATION
 * turns 90 degrees per row (the triangle's 120-degree symmetry makes each
 * rung look distinct). Ramp 1..12: rung width narrows 10..4 (finer size
 * discrimination, clamped) and angle decoys close in 90..15 degrees.
 * ====================================================================== */

/** Equilateral triangle outline centered at (50,50); circumradius `size`,
 *  apex pointing at `deg` degrees clockwise from up. */
function slTri(size: number, deg: number): Prim[] {
  const verts: { x: number; y: number }[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (deg + k * 120 - 90) * Math.PI / 180;
    verts.push({ x: r2(50 + size * Math.cos(a)), y: r2(50 + size * Math.sin(a)) });
  }
  return [
    { k: 'line', x1: verts[0].x, y1: verts[0].y, x2: verts[1].x, y2: verts[1].y },
    { k: 'line', x1: verts[1].x, y1: verts[1].y, x2: verts[2].x, y2: verts[2].y },
    { k: 'line', x1: verts[2].x, y1: verts[2].y, x2: verts[0].x, y2: verts[0].y },
  ];
}

interface SlObs { size: number; ang: number }

/** Re-derive (size, orientation mod 120-degrees) from a rendered triangle. */
function slParse(cell: Prim[]): SlObs | null {
  if (cell.length !== 3 || cell.some(p => p.k !== 'line')) return null;
  const pts: { x: number; y: number }[] = [];
  for (const p of cell) {
    if (p.k !== 'line') return null;
    for (const [x, y] of [[p.x1, p.y1], [p.x2, p.y2]] as const) {
      if (!pts.some(q => Math.abs(q.x - x) < 0.6 && Math.abs(q.y - y) < 0.6)) pts.push({ x, y });
    }
  }
  if (pts.length !== 3) return null;
  const cx = (pts[0].x + pts[1].x + pts[2].x) / 3;
  const cy = (pts[0].y + pts[1].y + pts[2].y) / 3;
  if (Math.abs(cx - 50) > 1.5 || Math.abs(cy - 50) > 1.5) return null;
  const radii = pts.map(q => Math.hypot(q.x - cx, q.y - cy));
  const size = (radii[0] + radii[1] + radii[2]) / 3;
  if (Math.max(...radii) - Math.min(...radii) > 1.0) return null;
  const ang = ((Math.atan2(pts[0].y - cy, pts[0].x - cx) * 180 / Math.PI + 450) % 120 + 120) % 120;
  return { size, ang };
}

const slAngDiff = (a: number, b: number): number => foldDelta(b - a, 120);

export const sizeLadder: Family = {
  id: 'size-ladder',
  generate(seed, diff, hue): Puzzle {
    const r = rngFrom(seed);
    const D = Math.max(1, Math.min(12, Math.floor(diff)));
    const deg0 = Math.floor(r() * 24) * 15;
    const s0 = 12 + 2 * Math.floor(r() * 3);   // 12 / 14 / 16
    // ramp: rung width narrows with difficulty (finer discrimination), clamped
    const STEPS = [10, 10, 9, 9, 8, 8, 7, 7, 6, 6, 5, 4];
    const cStep = STEPS[D - 1];
    const sizeAt = (_row: number, col: number) => s0 + col * cStep;
    const degAt = (row: number, _col: number) => deg0 + row * 90;
    const cells: Prim[][] = [];
    for (let i = 0; i < 8; i++) {
      const row = Math.floor(i / 3), col = i % 3;
      cells.push(slTri(sizeAt(row, col), degAt(row, col)));
    }
    const sAns = sizeAt(2, 2), aAns = degAt(2, 2);
    const big2 = sAns + 2 * cStep <= 38 ? sAns + 2 * cStep : 36;
    const small2 = sAns - 2 * cStep >= 10 ? sAns - 2 * cStep : 10;
    const halfBig = sAns + cStep / 2 <= 38 ? sAns + cStep / 2 : sAns - cStep / 2;
    const halfSmall = sAns - cStep / 2 >= 8 ? sAns - cStep / 2 : sAns + cStep / 2;
    // master coarse -> fine: far sizes, one-rung sizes, far angles, near angles, half-rungs
    const master: Prim[][] = [
      slTri(big2, aAns),
      slTri(small2, aAns),
      slTri(sAns + cStep, aAns),
      slTri(sAns - cStep, aAns),
      slTri(sAns, aAns + 90),
      slTri(sAns, aAns + 60),
      slTri(sAns, aAns + 45),
      slTri(sAns, aAns + 30),
      slTri(sAns, aAns + 24),
      slTri(sAns, aAns + 15),
      slTri(halfBig, aAns),
      slTri(halfSmall, aAns),
    ];
    const start = Math.floor((D - 1) * (master.length - 7) / 11);
    const decoys = master.slice(start, start + 7);
    const filler: Prim[][] = [
      slTri(sAns, aAns + 45),
      slTri(sAns, aAns - 24),
      slTri(sAns, aAns - 15),
      slTri(sAns, aAns - 30),
      slTri(sAns, aAns + 12),
      slTri(sAns + cStep, aAns),
      slTri(sAns - cStep, aAns),
      slTri(halfBig, aAns),
      slTri(big2, aAns),
      slTri(small2, aAns),
    ];
    const { opts, answerIdx } = finalize(slTri(sAns, aAns), decoys, filler, seed ^ 0x1add);
    return {
      family: 'size-ladder', cols: 3, rows: 3,
      cells, holeIndex: 8, options: opts, answer: answerIdx,
      hue, rule: 'the triangle climbs one size rung per column and turns 90° per row',
    };
  },
  solve(p): number {
    if (p.cells.length !== 8) return -1;
    const obs: (SlObs | null)[] = p.cells.map(slParse);
    if (obs.some(o => o === null)) return -1;
    const O = obs as SlObs[];
    const at = (row: number, col: number) => O[row * 3 + col];
    // size: arithmetic ladder per column — equal step in every observable row
    const s01 = at(0, 1).size - at(0, 0).size;
    const s11 = at(1, 1).size - at(1, 0).size;
    const s21 = at(2, 1).size - at(2, 0).size;
    if (Math.abs(s01 - s11) > 0.25 || Math.abs(s11 - s21) > 0.25) return -1;
    if (Math.abs(s01) < 2) return -1;
    // rotation: constant within a row (mod 120), fixed step across rows
    for (let row = 0; row < 3; row++) {
      if (Math.abs(slAngDiff(at(row, 0).ang, at(row, 1).ang)) > 2) return -1;
    }
    const r0 = slAngDiff(at(0, 0).ang, at(1, 0).ang);
    const r1 = slAngDiff(at(1, 0).ang, at(2, 0).ang);
    if (Math.abs(r0 - r1) > 2 || Math.abs(r0) < 5) return -1;
    // hole sits in the BOTTOM ROW: size climbs one more column rung, rotation
    // stays at row 2's orientation (the 90-degree/row step is already fully visible).
    const expSize = at(2, 1).size + s01;
    const expAng = at(2, 1).ang;
    const hits: number[] = [];
    p.options.forEach((op, i) => {
      const o = slParse(op);
      if (!o) return;
      if (Math.abs(o.size - expSize) > 1.2) return;
      if (Math.abs(slAngDiff(o.ang, expAng)) > 2) return;
      hits.push(i);
    });
    return hits.length === 1 ? hits[0] : -1;
  },
};

export const FAMILIES3: Family[] = [dotMatrixRotate, lineReflection, countPositions, sizeLadder];

/* ------------------------------------------------------------------ */
/* Self-test (node-runnable): import { selfTest } from './families3'  */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const all = FAMILIES3;
  const hue = '#d4a017';
  for (const fam of all) {
    for (let diff = 1; diff <= 12; diff++) {
      for (let sample = 0; sample < 30; sample++) {
        const seed = ((sample + 1) * 2654435761 ^ (diff * 40503)) >>> 0;
        const where = `${fam.id} seed=${seed} diff=${diff}`;
        const p = fam.generate(seed, diff, hue);
        if (p.hue !== hue) failures.push(`${where}: hue drifted`);
        if (p.holeIndex !== p.cols * p.rows - 1) failures.push(`${where}: hole not bottom-right`);
        if (p.options.length !== 8) failures.push(`${where}: ${p.options.length} options`);
        const keys = new Set(p.options.map(glyphKey));
        if (keys.size !== 8) failures.push(`${where}: duplicate options (${keys.size}/8)`);
        if (!(p.answer >= 0 && p.answer < 8)) { failures.push(`${where}: answer index ${p.answer}`); continue; }
        const got = fam.solve(p);
        if (got !== p.answer) failures.push(`${where}: solve=${got} answer=${p.answer}`);
        if (p.rule.length < 10) failures.push(`${where}: rule sentence missing`);
      }
    }
  }
  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;
