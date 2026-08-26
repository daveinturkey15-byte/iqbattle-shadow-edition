/**
 * V2 GAUNTLET — PUZZLE PROBE (bugs-puzzle ticket)
 * -----------------------------------------------
 * Headless unit-probe of all 9 puzzle families + the dealPuzzle meta-loop:
 *   1. 200 seeds x diff 1..5 per family: option count/distinctness, hole
 *      position, independent-solver agreement, DNA density cap (<=24 marks).
 *   2. Decoy-distance: rasterize every answer/decoy glyph to a 64x64 mask
 *      and compute IoU(answer, decoy); flags decoys visually indistinguishable
 *      from the answer (IoU >= 0.985) and options identical to a VISIBLE cell.
 *   3. Seed sensitivity: is a family's board identical across seeds?
 *   4. Depth meta-loop (mirrors main.ts dealPuzzle): hue=(depth-1)%6,
 *      famIdx=(depth-1)%9, diff=min(5,1+floor(depth/6)) -> reachable
 *      (family,hue) pairings, repeat periods.
 *
 * Run:  node --experimental-strip-types research/v2-gauntlet/probe-puzzle.ts
 * Pure logic + offscreen math only — no DOM, no Pixi, deterministic.
 */
import { FAMILIES } from '../../v2/src/puzzles/families.ts';
import { FAMILIES2 } from '../../v2/src/puzzles/families2.ts';
import { FAMILIES3 } from '../../v2/src/puzzles/families3.ts';
import type { Family } from '../../v2/src/puzzles/types.ts';
import type { Prim } from '../../v2/src/glyphs.ts';

const ALL: Family[] = [...FAMILIES, ...FAMILIES2, ...FAMILIES3];
const HUE = '#d4a017';
const SEEDS = 200;
const DIFFS = [1, 2, 3, 4, 5];

/* ---------- canonical key (mirrors families2/3 glyphKey) ---------- */
const r2 = (v: number): number => Math.round(v * 100) / 100;
function glyphKey(prims: Prim[]): string {
  const norm = prims.map((p) => {
    switch (p.k) {
      case 'tri': return { k: 'tri', x: r2(p.x), y: r2(p.y), s: r2(p.s) };
      case 'dot': return { k: 'dot', x: r2(p.x), y: r2(p.y), r: r2(p.r) };
      case 'diamond': return { k: 'diamond', x: r2(p.x), y: r2(p.y), s: r2(p.s) };
      case 'line': return { k: 'line', x1: r2(p.x1), y1: r2(p.y1), x2: r2(p.x2), y2: r2(p.y2) };
    }
  });
  return JSON.stringify(norm.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}

/* ---------- 64x64 rasterization + IoU ---------- */
const RES = 64;
type Mask = Uint8Array;
function rasterize(prims: Prim[]): Mask {
  const m: Mask = new Uint8Array(RES * RES);
  const put = (x: number, y: number): void => {
    const px = Math.round(x), py = Math.round(y);
    if (px >= 0 && px < RES && py >= 0 && py < RES) m[py * RES + px] = 1;
  };
  const disk = (cx: number, cy: number, rad: number): void => {
    const rad2 = Math.max(rad, 1.4);
    for (let dy = -Math.ceil(rad2); dy <= Math.ceil(rad2); dy++)
      for (let dx = -Math.ceil(rad2); dx <= Math.ceil(rad2); dx++)
        if (dx * dx + dy * dy <= rad2 * rad2) put(cx + dx, cy + dy);
  };
  const scale = RES / 100;
  for (const p of prims) {
    switch (p.k) {
      case 'dot': disk(p.x * scale, p.y * scale, p.r * scale); break;
      case 'diamond': {
        const cx = p.x * scale, cy = p.y * scale, s = p.s * scale;
        for (let dy = -Math.ceil(s); dy <= Math.ceil(s); dy++)
          for (let dx = -Math.ceil(s); dx <= Math.ceil(s); dx++)
            if (Math.abs(dx) + Math.abs(dy) <= s) put(cx + dx, cy + dy);
        break;
      }
      case 'tri': {
        // filled triangle with a small outward bias (stroke approx; consistent bias)
        const x = p.x * scale, y = p.y * scale, s = p.s * scale;
        const v: [number, number][] = [[x, y - s], [x + s * 0.9, y + s * 0.7], [x - s * 0.9, y + s * 0.7]];
        const sign = (a: [number, number], b: [number, number], c: [number, number]): number =>
          (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1]);
        for (let py = Math.floor(y - s); py <= Math.ceil(y + s); py++)
          for (let px = Math.floor(x - s); px <= Math.ceil(x + s); px++) {
            const P: [number, number] = [px, py];
            const d1 = sign(v[0], v[1], P), d2 = sign(v[1], v[2], P), d3 = sign(v[2], v[0], P);
            const neg = d1 < 1.5 || d2 < 1.5 || d3 < 1.5, pos = d1 > -1.5 || d2 > -1.5 || d3 > -1.5;
            if (!(neg && pos)) put(px, py);
          }
        break;
      }
      case 'line': {
        const steps = Math.max(2, Math.ceil(Math.hypot(p.x2 - p.x1, p.y2 - p.y1) * scale));
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          disk((p.x1 + (p.x2 - p.x1) * t) * scale, (p.y1 + (p.y2 - p.y1) * t) * scale, 1.4);
        }
        break;
      }
    }
  }
  return m;
}
function iou(a: Mask, b: Mask): number {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) inter++;
    if (a[i] || b[i]) uni++;
  }
  return uni === 0 ? 1 : inter / uni;
}

/* ---------- probes ---------- */
interface Finding { family: string; diff: number; kind: string; detail: string }
const findings: Finding[] = [];
function note(family: string, diff: number, kind: string, detail: string): void {
  findings.push({ family, diff, kind, detail });
}
function countKind(family: string, kind: string): number {
  return findings.filter(f => f.family === family && f.kind === kind).length;
}

interface FamStats {
  id: string; total: number; solveMismatch: number; dupOptions: number; badHole: number;
  densityViolations: number; maxMarks: number; closestDecoyIoU: number; closestDecoyDetail: string;
  cellDuplicateOptions: number; seedInvariant: boolean;
}

for (const fam of ALL) {
  const st: FamStats = {
    id: fam.id, total: 0, solveMismatch: 0, dupOptions: 0, badHole: 0,
    densityViolations: 0, maxMarks: 0, closestDecoyIoU: 0, closestDecoyDetail: '',
    cellDuplicateOptions: 0, seedInvariant: false,
  };
  // seed-invariance: same diff, two seeds -> identical board?
  const pa = fam.generate(101, 3, HUE), pb = fam.generate(202, 3, HUE);
  st.seedInvariant =
    JSON.stringify(pa.cells.map(glyphKey)) === JSON.stringify(pb.cells.map(glyphKey));

  for (const diff of DIFFS) {
    for (let s = 0; s < SEEDS; s++) {
      const seed = (((s + 1) * 2654435761) ^ ((diff * 40503) >>> 0)) >>> 0;
      const p = fam.generate(seed, diff, HUE);
      st.total++;
      const where = `${fam.id} diff=${diff} seed=${seed}`;

      if (p.options.length !== 8) note(fam.id, diff, 'option-count', `${where}: ${p.options.length} options`);
      const keys = p.options.map(glyphKey);
      if (new Set(keys).size !== 8) {
        st.dupOptions++;
        if (st.dupOptions <= 2) note(fam.id, diff, 'dup-options', `${where}: ${new Set(keys).size}/8 distinct`);
      }
      if (p.holeIndex !== p.cols * p.rows - 1) { st.badHole++; note(fam.id, diff, 'hole', `${where}: holeIndex=${p.holeIndex}`); }
      if (!(p.answer >= 0 && p.answer < p.options.length)) {
        note(fam.id, diff, 'answer-index', `${where}: answer=${p.answer}`);
      } else {
        const got = fam.solve(p);
        if (got !== p.answer) {
          st.solveMismatch++;
          if (st.solveMismatch <= 3) note(fam.id, diff, 'solve-mismatch', `${where}: solve=${got} answer=${p.answer}`);
        }
      }
      const mx = Math.max(...p.cells.map(c => c.length));
      if (mx > st.maxMarks) st.maxMarks = mx;
      if (mx > 24) {
        st.densityViolations++;
        if (st.densityViolations <= 2) note(fam.id, diff, 'dna-density', `${where}: cell has ${mx} marks (DNA cap 24)`);
      }

      // decoy visual distance
      const ansMask = rasterize(p.options[p.answer]);
      const cellKeys = new Set(p.cells.map(glyphKey));
      let ambiguousLogged = countKind(fam.id, 'decoy-ambiguous');
      p.options.forEach((o, i) => {
        if (i === p.answer) return;
        const v = iou(ansMask, rasterize(o));
        const detail = `opt${i} IoU=${v.toFixed(4)}`;
        if (v > st.closestDecoyIoU) { st.closestDecoyIoU = v; st.closestDecoyDetail = detail; }
        if (v >= 0.985 && ambiguousLogged < 3) {
          ambiguousLogged++;
          note(fam.id, diff, 'decoy-ambiguous', `${where}: ${detail} — decoy visually near-identical to answer`);
        }
        if (cellKeys.has(keys[i])) {
          st.cellDuplicateOptions++;
          if (st.cellDuplicateOptions <= 2) note(fam.id, diff, 'option-equals-board-cell', `${where}: opt${i} identical to a visible board cell`);
        }
      });
    }
  }
  console.log(
    `${st.id.padEnd(20)} total=${st.total} solveMismatch=${st.solveMismatch} dupOpts=${st.dupOptions}` +
    ` badHole=${st.badHole} density>24:${String(st.densityViolations).padStart(3)} (maxMarks ${st.maxMarks})` +
    ` closestDecoyIoU=${st.closestDecoyIoU.toFixed(4)} [${st.closestDecoyDetail}]` +
    ` optEqualsCell=${String(st.cellDuplicateOptions).padStart(3)} seedInvariant=${st.seedInvariant}`,
  );
}

/* ---------- depth meta-loop (mirrors main.ts dealPuzzle) ---------- */
console.log('\n=== DEPTH META-LOOP (dealPuzzle mapping, takeovers aside) ===');
const hues = ['#d4a017', '#ff7a1a', '#e0245e', '#38bdf8', '#a78bfa', '#34d399'];
const pairsSeen = new Map<string, number>();
let prevFam = '', prevHue = '', famRepeatAt = -1, hueRepeatAt = -1;
for (let depth = 1; depth <= 72; depth++) {
  const fi = (depth - 1) % ALL.length;
  const hi = (depth - 1) % hues.length;
  const pair = `${ALL[fi].id}|hue${hi}`;
  pairsSeen.set(pair, (pairsSeen.get(pair) ?? 0) + 1);
  if (depth > 1) {
    if (ALL[fi].id === prevFam && famRepeatAt < 0) famRepeatAt = depth;
    if (hues[hi] === prevHue && hueRepeatAt < 0) hueRepeatAt = depth;
  }
  prevFam = ALL[fi].id; prevHue = hues[hi];
}
console.log(`reachable (family,hue) pairings over 72 depths: ${pairsSeen.size}/${ALL.length * hues.length} possible`);
for (const fam of ALL) {
  const hs: string[] = [];
  for (let h = 0; h < hues.length; h++) if (pairsSeen.has(`${fam.id}|hue${h}`)) hs.push(String(h));
  console.log(`  ${fam.id.padEnd(20)} hue idx [${hs.join(',')}]`);
}
console.log(`first consecutive family repeat after depth 1: depth ${famRepeatAt < 0 ? 'none<72' : famRepeatAt}`);
console.log(`first consecutive hue repeat after depth 1: depth ${hueRepeatAt < 0 ? 'none<72' : hueRepeatAt}`);

console.log('\n=== FINDINGS (first occurrences, capped 3/family/kind) ===');
for (const f of findings) console.log(`[${f.kind}] ${f.detail}`);
console.log(`\ntotal finding rows: ${findings.length}`);
