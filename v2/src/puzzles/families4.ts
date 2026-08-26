import type { Family, Puzzle } from './types.ts';
import { rngFrom } from './types.ts';
import type { Prim } from '../glyphs.ts';

/* ---- shared helpers (module-local, mirrors families3 conventions) ------- */

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

const mod4 = (v: number): number => ((v % 4) + 4) % 4;

/* ========================================================================
 * ARROW CHAIN — snake-path DNA: each cell holds a centered chevron head
 * plus a tail of perpendicular tick marks. Read along the boustrophedon
 * snake path the arrow's DIRECTION rotates 90° clockwise per step while
 * the tail GAINS one tick per step. Options mutate exactly one attribute:
 * phase (+90/−90/180), tick count, or tail side.
 * ====================================================================== */

const AC_VEC: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // up,right,down,left (cw)

/** Snake path over the 3×3 grid: step s visits grid cell AC_PATH[s]. */
const AC_PATH = [0, 1, 2, 5, 4, 3, 6, 7, 8];

type AcLine = Extract<Prim, { k: 'line' }>;

/** Chevron head pointing `dir` + `n` tail ticks strung out behind the tip. */
function acGlyph(dir: number, n: number, ahead = false): Prim[] {
  const [dx, dy] = AC_VEC[mod4(dir)];
  const bx = -dx, by = -dy;                       // back direction
  const s = Math.SQRT1_2, L = 15;
  const out: Prim[] = [
    { k: 'line', x1: 50, y1: 50, x2: r2(50 + (bx - by) * s * L), y2: r2(50 + (bx + by) * s * L) },
    { k: 'line', x1: 50, y1: 50, x2: r2(50 + (bx + by) * s * L), y2: r2(50 + (by - bx) * s * L) },
  ];
  const px = -dy, py = dx;                        // perpendicular to dir
  for (let i = 0; i < n; i++) {
    const t = ahead ? 1 : -1;
    const dist = 6 + i * (38 / Math.max(n - 1, 1));
    const cx = 50 + t * dx * dist, cy = 50 + t * dy * dist;
    out.push({ k: 'line', x1: r2(cx - px * 4), y1: r2(cy - py * 4), x2: r2(cx + px * 4), y2: r2(cy + py * 4) });
  }
  return out;
}

interface AcObs { dir: number; n: number; ahead: boolean }

/** Parse a cell into its chevron direction + tail-tick count — null off-DNA. */
function acParse(cell: Prim[]): AcObs | null {
  if (cell.length < 3) return null;
  const lines: AcLine[] = [];
  for (const p of cell) {
    if (p.k !== 'line') return null;
    lines.push(p);
  }
  const atCenter = lines.filter(l =>
    (Math.abs(l.x1 - 50) < 0.8 && Math.abs(l.y1 - 50) < 0.8) ||
    (Math.abs(l.x2 - 50) < 0.8 && Math.abs(l.y2 - 50) < 0.8));
  if (atCenter.length !== 2) return null;
  const ticks = lines.filter(l => !atCenter.includes(l));
  if (ticks.length !== cell.length - 2 || ticks.length === 0) return null;
  // wings: far endpoints of the two center-anchored lines, equal length,
  // perpendicular, bisecting backward
  const wv = atCenter.map(l => {
    const near1 = Math.abs(l.x1 - 50) < 0.8 && Math.abs(l.y1 - 50) < 0.8;
    return near1 ? { x: l.x2 - 50, y: l.y2 - 50 } : { x: l.x1 - 50, y: l.y1 - 50 };
  });
  const l1 = Math.hypot(wv[0].x, wv[0].y), l2 = Math.hypot(wv[1].x, wv[1].y);
  if (Math.abs(l1 - 15) > 1.2 || Math.abs(l2 - 15) > 1.2) return null;
  if (Math.abs((wv[0].x * wv[1].x + wv[0].y * wv[1].y) / (l1 * l2)) > 0.06) return null;
  const bx = wv[0].x / l1 + wv[1].x / l2, by = wv[0].y / l1 + wv[1].y / l2;
  const bl = Math.hypot(bx, by);
  if (bl < 0.2) return null;
  const ux = -bx / bl, uy = -by / bl;
  let dir = -1, bestC = 0.7;
  for (let d = 0; d < 4; d++) {
    const c = ux * AC_VEC[d][0] + uy * AC_VEC[d][1];
    if (c > bestC) { bestC = c; dir = d; }
  }
  if (dir < 0) return null;
  const [dx, dy] = AC_VEC[dir];
  const px = -dy, py = dx;
  let ahead = false;
  const ds: number[] = [];
  for (const tk of ticks) {
    const mx = (tk.x1 + tk.x2) / 2 - 50, my = (tk.y1 + tk.y2) / 2 - 50;
    const pd = Math.abs(mx * px + my * py);
    const a = mx * dx + my * dy;
    if (pd > 1.0 || Math.abs(a) < 4.5 || Math.abs(a) > 46) return null;
    const tx = tk.x2 - tk.x1, ty = tk.y2 - tk.y1, tl = Math.hypot(tx, ty);
    if (Math.abs(tl - 8) > 1.0) return null;
    if (tl === 0 || Math.abs((tx * dx + ty * dy) / tl) > 0.1) return null;   // must sit across the axis
    if (ds.length === 0) ahead = a > 0;
    else if ((a > 0) !== ahead) return null;
    ds.push(Math.abs(a));
  }
  for (let i = 1; i < ds.length; i++) {
    if (ds[i] <= ds[i - 1] || ds[i] - ds[i - 1] < 3.5) return null;
  }
  return { dir, n: ticks.length, ahead };
}

export const arrowChain: Family = {
  id: 'arrow-chain',
  generate(seed, diff, hue): Puzzle {
    const r = rngFrom(seed);
    const dir0 = Math.floor(r() * 4);
    const n0 = diff >= 3 ? 3 : 2;
    const cells: Prim[][] = new Array(9);
    for (let step = 0; step < 8; step++) {
      cells[AC_PATH[step]] = acGlyph(mod4(dir0 + step), n0 + step);
    }
    cells.length = 8;                              // slot (2,2) stays the hole
    const aDir = mod4(dir0 + 8), aN = n0 + 8;     // 9th snake step fills the hole
    const { opts, answerIdx } = finalize(
      acGlyph(aDir, aN),
      [
        acGlyph(mod4(aDir + 1), aN),              // over-rotated 90°
        acGlyph(mod4(aDir - 1), aN),              // under-rotated 90°
        acGlyph(mod4(aDir + 2), aN),              // reversed chevron
        acGlyph(aDir, aN - 1),                    // tail one tick short
        acGlyph(aDir, aN + 1),                    // tail one tick extra
        acGlyph(aDir, aN, true),                  // tail ahead of the tip
        acGlyph(aDir, aN + 2),                    // two ticks extra
      ],
      [
        acGlyph(mod4(aDir + 1), aN + 1),
        acGlyph(mod4(aDir - 1), aN - 1),
        acGlyph(mod4(aDir + 2), aN + 1),
        acGlyph(mod4(aDir + 1), aN - 1),
        acGlyph(aDir, aN - 2),
        acGlyph(mod4(aDir + 2), aN - 2),
      ],
      seed ^ 0x47f0,
    );
    return {
      family: 'arrow-chain', cols: 3, rows: 3,
      cells, holeIndex: 8, options: opts, answer: answerIdx,
      hue, rule: 'the arrow turns 90° each step; its tail gains a tick',
    };
  },
  solve(p): number {
    if (p.cells.length !== 8) return -1;
    const O: (AcObs | null)[] = new Array(9).fill(null);
    for (let gi = 0; gi < 8; gi++) {
      O[gi] = acParse(p.cells[gi]);
      if (O[gi] === null) return -1;
    }
    for (let step = 0; step < 7; step++) {
      const cur = O[AC_PATH[step]] as AcObs, nxt = O[AC_PATH[step + 1]] as AcObs;
      if (cur.ahead || nxt.ahead) return -1;
      if (mod4(nxt.dir - cur.dir) !== 1) return -1;
      if (nxt.n !== cur.n + 1) return -1;
    }
    const last = O[AC_PATH[7]] as AcObs;
    const ke = glyphKey(acGlyph(mod4(last.dir + 1), last.n + 1));
    const hits: number[] = [];
    p.options.forEach((o, i) => { if (glyphKey(o) === ke) hits.push(i); });
    return hits.length === 1 ? hits[0] : -1;
  },
};

/* ========================================================================
 * DOT BALANCE — balance-beam DNA: each cell is a beam through the center
 * tilted toward the heavier dot stack (3 units of sag per net dot) with
 * stacks parked on side ledges at x=13/x=87. The signed imbalance follows
 * an arithmetic grid: it steps by cStep per column (constant across rows)
 * and shifts by a constant row step, flipping the heavy side every row.
 * Options mutate exactly one attribute: column rung, stack size, tilt.
 * ====================================================================== */

type DbLine = Extract<Prim, { k: 'line' }>;

function dbGlyph(left: number, right: number): Prim[] {
  const d = right - left;
  const out: Prim[] = [{ k: 'line', x1: 28, y1: 50 - 3 * d, x2: 72, y2: 50 + 3 * d }];
  const sp = Math.min(10, 72 / Math.max(left, right, 1));
  for (let i = 0; i < left; i++) out.push({ k: 'dot', x: 13, y: r2(50 + (i - (left - 1) / 2) * sp), r: 4 });
  for (let i = 0; i < right; i++) out.push({ k: 'dot', x: 87, y: r2(50 + (i - (right - 1) / 2) * sp), r: 4 });
  return out;
}

interface DbObs { left: number; right: number }

/** Parse a cell into its ledge-stack counts — null when off-DNA. */
function dbParse(cell: Prim[]): DbObs | null {
  if (cell.length < 3) return null;
  const lines = cell.filter((p): p is DbLine => p.k === 'line');
  if (lines.length !== 1) return null;
  const ln = lines[0];
  const loX = Math.min(ln.x1, ln.x2), hiX = Math.max(ln.x1, ln.x2);
  if (Math.abs(loX - 28) > 0.8 || Math.abs(hiX - 72) > 0.8) return null;
  const yLowEnd = ln.x1 < ln.x2 ? ln.y1 : ln.y2;
  const yHighEnd = ln.x1 < ln.x2 ? ln.y2 : ln.y1;
  const dd = (yHighEnd - yLowEnd) / 6;            // signed imbalance, + = right heavy
  const rd = Math.round(dd);
  if (Math.abs(dd - rd) > 0.02 || Math.abs(rd) < 1 || Math.abs(rd) > 8) return null;
  let left = 0, right = 0;
  for (const p of cell) {
    if (p.k === 'line') continue;
    if (p.k !== 'dot' || p.r !== 4) return null;
    if (Math.abs(p.x - 13) < 0.8) left++;
    else if (Math.abs(p.x - 87) < 0.8) right++;
    else return null;
  }
  if (left < 1 || right < 1 || right - left !== rd) return null;
  return { left, right };
}

export const dotBalance: Family = {
  id: 'dot-balance',
  generate(seed, diff, hue): Puzzle {
    const r = rngFrom(seed);
    const base = 1 + Math.floor(r() * 2);           // dots on the light ledge: 1..2
    const cStep = diff >= 3 ? 2 : 1;
    const rStep = diff >= 4 ? 1 : 0;
    const m0 = 1 + Math.floor(r() * 2);             // base imbalance: 1..2
    const imb = (row: number, col: number): number =>
      (row % 2 === 0 ? 1 : -1) * (m0 + col * cStep + row * rStep);   // heavy side flips per row
    const counts = (d: number): [number, number] => (d > 0 ? [base, base + d] : [base - d, base]);
    const cells: Prim[][] = [];
    for (let i = 0; i < 8; i++) {
      const [L, Rt] = counts(imb(Math.floor(i / 3), i % 3));
      cells.push(dbGlyph(L, Rt));
    }
    const dA = imb(2, 2);
    const [aL, aR] = counts(dA);
    const dr = imb(1, 0) - imb(0, 0);
    const { opts, answerIdx } = finalize(
      dbGlyph(aL, aR),
      [
        dbGlyph(...counts(dA + cStep)),             // one column rung too far
        dbGlyph(...counts(dA - cStep)),             // one column rung short
        dbGlyph(aL, aR + 1),                        // extra heavy dot
        dbGlyph(aL + 1, aR),                        // extra light dot
        dbGlyph(aL, Math.max(1, aR - 1)),           // heavy dot missing
        [{ ...dbGlyph(aL, aR)[0] }, ...dbGlyph(aR, aL).slice(1)],   // tilt contradicts the stacks
        dbGlyph(base + 1, base + 1 + dA),           // both stacks shifted up
      ],
      [
        dbGlyph(...counts(dA + 2 * cStep)),
        dbGlyph(...counts(dA + dr)),
        dbGlyph(base + 2, base + 2 + dA),
        dbGlyph(...counts(dA - 1)),
        dbGlyph(...counts(dA + 1)),
      ],
      seed ^ 0xba1a,
    );
    return {
      family: 'dot-balance', cols: 3, rows: 3,
      cells, holeIndex: 8, options: opts, answer: answerIdx,
      hue, rule: 'the beam tips to the heavier stack; the gap steps up per column',
    };
  },
  solve(p): number {
    if (p.cells.length !== 8) return -1;
    const obs = p.cells.map(dbParse);
    if (obs.some(o => o === null)) return -1;
    const O = obs as DbObs[];
    const D = O.map(o => o.right - o.left);
    const M = D.map(Math.abs), SG = D.map(Math.sign);
    const mag = (row: number, col: number): number => M[row * 3 + col];
    // imbalance MAGNITUDE climbs a constant rung per column in every row
    const g0 = mag(0, 1) - mag(0, 0), g1 = mag(1, 1) - mag(1, 0), g2 = mag(2, 1) - mag(2, 0);
    if (g0 !== g1 || g1 !== g2 || g0 === 0) return -1;
    // constant magnitude step down the rows wherever observable
    if (mag(1, 0) - mag(0, 0) !== mag(2, 0) - mag(1, 0)) return -1;
    if (mag(1, 1) - mag(0, 1) !== mag(2, 1) - mag(1, 1)) return -1;
    // the heavy side flips on every row change
    for (let col = 0; col < 2; col++) {
      if (SG[0 + col] !== -SG[3 + col] || SG[3 + col] !== -SG[6 + col]) return -1;
    }
    // light-side stack size never changes
    const light = O.map(o => Math.min(o.left, o.right));
    if (light.some(v => v !== light[0])) return -1;
    const dHole = (mag(2, 1) + g0) * SG[6];
    const [eL, eR] = dHole > 0 ? [light[7], light[7] + dHole] : [light[7] - dHole, light[7]];
    const ke = glyphKey(dbGlyph(eL, eR));
    const hits: number[] = [];
    p.options.forEach((o, i) => { if (glyphKey(o) === ke) hits.push(i); });
    return hits.length === 1 ? hits[0] : -1;
  },
};

/* ========================================================================
 * RING NEST — concentric-ring DNA: dots sit on circles around the center.
 * The RING COUNT steps +1 per column while the radial GAP between rings
 * steps +1 per row. Options mutate exactly one attribute: ring count,
 * gap width, rotation phase, or ring integrity.
 * ====================================================================== */

const RN_DOTS = 6;

function rnGlyphR(radii: number[], phaseDeg = 0): Prim[] {
  const out: Prim[] = [];
  for (const rad of radii) {
    for (let j = 0; j < RN_DOTS; j++) {
      const a = (j * 60 + phaseDeg - 90) * Math.PI / 180;
      out.push({ k: 'dot', x: r2(50 + rad * Math.cos(a)), y: r2(50 + rad * Math.sin(a)), r: 3.5 });
    }
  }
  return out;
}

function rnGlyph(n: number, g: number): Prim[] {
  return rnGlyphR(Array.from({ length: n }, (_, i) => g * (i + 1)));
}

interface RnObs { n: number; g: number }

/** Parse a cell into its ring count + radial gap — null when off-DNA. */
function rnParse(cell: Prim[]): RnObs | null {
  if (cell.length === 0 || cell.length % RN_DOTS !== 0) return null;
  const dists: number[] = [];
  for (const p of cell) {
    if (p.k !== 'dot' || p.r !== 3.5) return null;
    const dl = Math.hypot(p.x - 50, p.y - 50);
    if (dl < 5 || dl > 47) return null;
    dists.push(dl);
  }
  dists.sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const dv of dists) {
    const lg = groups[groups.length - 1];
    if (lg && dv - lg[0] < 1.4) lg.push(dv);
    else groups.push([dv]);
  }
  if (groups.length < 1 || groups.length > 4) return null;
  if (groups.some(gr => gr.length !== RN_DOTS)) return null;
  const g = groups[0][0];
  if (g < 7) return null;
  for (let i = 1; i < groups.length; i++) {
    if (Math.abs(groups[i][0] - g * (i + 1)) > 1.0) return null;
  }
  return { n: groups.length, g };
}

export const ringNest: Family = {
  id: 'ring-nest',
  generate(seed, diff, hue): Puzzle {
    const r = rngFrom(seed);
    const n0 = diff >= 3 ? 2 : 1;
    const gStep = 1;
    const g0 = diff >= 3 ? 9 : 8;
    const nAt = (col: number): number => n0 + col;
    const gAt = (row: number): number => g0 + row * gStep;
    const cells: Prim[][] = [];
    for (let i = 0; i < 8; i++) cells.push(rnGlyph(nAt(i % 3), gAt(Math.floor(i / 3))));
    const aN = nAt(2), aG = gAt(2);               // hole sits in column 2 itself
    const broken = rnGlyph(aN, aG);
    broken.splice(Math.floor(broken.length / 2), 1);
    const { opts, answerIdx } = finalize(
      rnGlyph(aN, aG),
      [
        rnGlyph(aN - 1, aG),                                        // innermost ring missing
        aN + 1 <= 4 ? rnGlyph(aN + 1, aG) : rnGlyph(aN, aG + 1),    // one ring extra
        rnGlyph(aN, aG + 1),                                        // gap one step wider
        aG - 1 >= 8 && aN * (aG - 1) <= 46 ? rnGlyph(aN, aG - 1) : rnGlyph(Math.max(1, aN - 1), aG + 1),
        rnGlyphR(Array.from({ length: aN }, (_, i) => aG * (i + 1)), 30),   // half-slot twist
        broken,                                                     // a dot missing from a ring
        [...rnGlyph(aN, aG), { k: 'dot' as const, x: 50, y: 50, r: 3.5 }],  // stray hub dot
      ],
      [
        ...[1, 2, 3, 4].filter(k => k !== aN && k * (aG + 1) <= 46 && k * (aG + 1) >= 7).map(k => rnGlyph(k, aG + 1)),
        ...[8, 9, 10, 11].filter(gg => gg !== aG && aN * gg <= 46).map(gg => rnGlyph(aN, gg)),
      ],
      seed ^ 0x21b6,
    );
    return {
      family: 'ring-nest', cols: 3, rows: 3,
      cells, holeIndex: 8, options: opts, answer: answerIdx,
      hue, rule: 'one more ring per column; ring spacing widens per row',
    };
  },
  solve(p): number {
    if (p.cells.length !== 8) return -1;
    const obs = p.cells.map(rnParse);
    if (obs.some(o => o === null)) return -1;
    const O = obs as RnObs[];
    const at = (row: number, col: number): RnObs => O[row * 3 + col];
    for (let row = 0; row < 3; row++) {
      if (at(row, 1).n !== at(row, 0).n + 1) return -1;             // +1 ring per column
      if (Math.abs(at(row, 1).g - at(row, 0).g) > 0.25) return -1;   // gap fixed within a row
    }
    for (let col = 0; col < 2; col++) {
      const st = at(1, col).g - at(0, col).g;
      const st2 = at(2, col).g - at(1, col).g;
      if (Math.abs(st - st2) > 0.25 || Math.abs(st) < 0.25) return -1;   // gap steps per row
    }
    const ke = glyphKey(rnGlyph(at(2, 1).n + 1, at(2, 1).g));
    const hits: number[] = [];
    p.options.forEach((o, i) => { if (glyphKey(o) === ke) hits.push(i); });
    return hits.length === 1 ? hits[0] : -1;
  },
};

export const FAMILIES4: Family[] = [arrowChain, dotBalance, ringNest];

/* ------------------------------------------------------------------ */
/* Self-test (node-runnable): import { selfTest } from './families4'  */
/* ------------------------------------------------------------------ */

export function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const all = FAMILIES4;
  const hue = '#d4a017';
  for (const fam of all) {
    for (let diff = 1; diff <= 5; diff++) {
      for (let sample = 0; sample < 300; sample++) {
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
        if (p.rule.length < 10 || p.rule.length > 64) failures.push(`${where}: rule sentence length ${p.rule.length}`);
      }
    }
  }
  return { ok: failures.length === 0, failures };
}

export const __selfTest = selfTest;
