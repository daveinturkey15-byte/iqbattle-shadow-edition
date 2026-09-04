import type { Family, Puzzle } from './types.ts';
import { rngFrom } from './types.ts';
import type { Prim } from '../glyphs.ts';

const keyOf = (ps: Prim[]): string => ps.length + ':' + JSON.stringify(ps.map(p => JSON.stringify(p)).sort());

function isVSym(cell: Prim[]): boolean {
  const m = new Map<string, number>();
  for (const p of cell) {
    if (p.k !== 'dot') return false;
    const k = p.x + ',' + p.y;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  for (const [k, c] of m) {
    const parts = k.split(',');
    const mx = 100 - Number(parts[0]);
    const mk = mx + ',' + parts[1];
    if ((m.get(mk) ?? 0) !== c) return false;
  }
  return true;
}

function isHSym(cell: Prim[]): boolean {
  const m = new Map<string, number>();
  for (const p of cell) {
    if (p.k !== 'dot') return false;
    const k = p.x + ',' + p.y;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  for (const [k, c] of m) {
    const parts = k.split(',');
    const my = 100 - Number(parts[1]);
    const mk = parts[0] + ',' + my;
    if ((m.get(mk) ?? 0) !== c) return false;
  }
  return true;
}

function minDist(ps: Prim[]): number {
  let best = 999;
  const pts: Array<{ x: number; y: number }> = [];
  for (const p of ps) {
    if (p.k === 'dot') pts.push({ x: p.x, y: p.y });
    else if (p.k === 'tri') pts.push({ x: p.x, y: p.y });
    else if (p.k === 'diamond') pts.push({ x: p.x, y: p.y });
  }
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x;
      const dy = pts[i].y - pts[j].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < best) best = d;
    }
  }
  return pts.length < 2 ? 99 : best;
}

/**
 * DUAL-AXIS — two-axis progression: dot count grows left→right (columns),
 * triangle count grows top→bottom (rows). D(r,c)=d0+c*dStep, T(r,c)=t0+r*tStep.
 * Hole bottom-right. Diff ramps steps 1,1 → 2,1 → 2,2 and decoy closeness.
 */
export const dualAxis: Family = {
  id: 'dual-axis',
  generate(seed, diff, hue): Puzzle {
    const eff = diff < 1 ? 1 : diff > 12 ? 12 : Math.floor(diff);
    const rr = rngFrom(seed ^ 0xd41a);
    const dStep = eff <= 3 ? 1 : 2;
    const tStep = eff >= 9 ? 2 : 1;
    const d0 = 1 + Math.floor(rr() * (eff <= 6 ? 2 : 3));
    const t0 = 1 + Math.floor(rr() * (eff <= 6 ? 2 : 3));
    const lay = (d: number, t: number): Prim[] => {
      const out: Prim[] = [];
      const gd = Math.min(20, 64 / Math.max(1, d));
      for (let i = 0; i < d; i++) {
        const x = 50 + (i - (d - 1) / 2) * gd;
        out.push({ k: 'dot', x, y: 30, r: 3.4 } as Prim);
      }
      const gt = Math.min(20, 64 / Math.max(1, t));
      for (let i = 0; i < t; i++) {
        const x = 50 + (i - (t - 1) / 2) * gt;
        out.push({ k: 'tri', x, y: 70, s: 7 } as Prim);
      }
      return out;
    };
    const D = (c: number) => d0 + c * dStep;
    const T = (r: number) => t0 + r * tStep;
    const cells: Prim[][] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cells.push(lay(D(c), T(r)));
    const aD = D(2);
    const aT = T(2);
    const correct = lay(aD, aT);
    let deltas: Array<[number, number]>;
    if (eff <= 2) deltas = [[4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, -3], [4, 4], [-4, -4], [3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, -2]];
    else if (eff <= 5) deltas = [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, -2], [3, 3], [-3, -3], [2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, -1]];
    else if (eff <= 8) deltas = [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, -1], [2, 2], [-2, -2], [1, 0], [-1, 0], [0, 1], [0, -1], [3, 0], [0, 3]];
    else deltas = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2], [2, 1], [1, 2], [-2, -1], [-1, -2]];
    const fall: Array<[number, number]> = [[5, 0], [-5, 0], [0, 5], [0, -5], [5, 5], [-5, -5], [6, 0], [0, 6], [-6, 0], [0, -6]];
    const seen = new Set<string>();
    seen.add(keyOf(correct));
    const opts: Prim[][] = [correct];
    const tryPush = (d: number, t: number): boolean => {
      if (d < 1 || d > 12 || t < 1 || t > 12 || d + t < 1 || d + t > 24) return false;
      if (d === aD && t === aT) return false;
      const cand = lay(d, t);
      const k = keyOf(cand);
      if (seen.has(k)) return false;
      seen.add(k);
      opts.push(cand);
      return true;
    };
    for (const [dd, dt] of deltas) {
      if (opts.length >= 8) break;
      tryPush(aD + dd, aT + dt);
    }
    for (const [dd, dt] of fall) {
      if (opts.length >= 8) break;
      tryPush(aD + dd, aT + dt);
    }
    const sr = rngFrom(seed ^ 0x5f5f);
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(sr() * (i + 1));
      const tmp = opts[i]; opts[i] = opts[j]; opts[j] = tmp;
    }
    const ansKey = keyOf(correct);
    return {
      family: 'dual-axis', cols: 3, rows: 3,
      cells, holeIndex: 8, options: opts,
      answer: opts.findIndex(o => keyOf(o) === ansKey),
      hue, rule: 'dots grow across, triangles grow down',
    };
  },
  solve(p): number {
    const dc = (i: number) => p.cells[i].filter(q => q.k === 'dot').length;
    const tc = (i: number) => p.cells[i].filter(q => q.k === 'tri').length;
    if (!(dc(0) === dc(3) && dc(3) === dc(6) && dc(1) === dc(4) && dc(4) === dc(7))) return -1;
    if (!(tc(0) === tc(1) && tc(1) === tc(2) && tc(3) === tc(4) && tc(4) === tc(5) && tc(6) === tc(7))) return -1;
    const ds = dc(7) - dc(6);
    const ts = tc(5) - tc(2);
    if (!(ds > 0 && ts > 0)) return -1;
    const eD = dc(7) + ds;
    const eT = tc(5) + ts;
    return p.options.findIndex(o => o.filter(q => q.k === 'dot').length === eD && o.filter(q => q.k === 'tri').length === eT);
  },
};

/**
 * MIRROR-MEND — symmetry completion: every visible cell is mirror-symmetric
 * (V at low diff, H at mid diff, both at high diff). Answer restores it.
 * Dots only, one hue. Decoys break the symmetry by one shifted dot.
 */
export const mirrorMend: Family = {
  id: 'mirror-mend',
  generate(seed, diff, hue): Puzzle {
    const eff = diff < 1 ? 1 : diff > 12 ? 12 : Math.floor(diff);
    const rr = rngFrom(seed ^ 0x9e1d);
    const mode: string = eff <= 4 ? 'V' : eff <= 8 ? 'H' : 'VH';
    const dot = (x: number, y: number): Prim => ({ k: 'dot', x, y, r: 3.4 } as Prim);
    const mPick = (): number => {
      if (eff <= 3) return 3 + Math.floor(rr() * 3);
      if (eff <= 6) return 5 + Math.floor(rr() * 3);
      if (eff <= 9) return 7 + Math.floor(rr() * 3);
      return 8 + Math.floor(rr() * 5);
    };
    const pickN = <T>(arr: T[], n: number): T[] => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rr() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a.slice(0, n);
    };
    const makeV = (): Prim[] => {
      for (let att = 0; att < 12; att++) {
        const m = mPick();
        const pairs = Math.floor(m / 2);
        const centers = m % 2;
        const slots: Array<[number, number]> = [];
        for (const x of [20, 30, 38]) for (const y of [20, 32, 44, 56, 68, 80]) slots.push([x, y]);
        const ch = pickN(slots, pairs);
        const cyPool = [20, 32, 44, 56, 68, 80];
        const cys = pickN(cyPool, centers);
        const out: Prim[] = [];
        for (const [x, y] of ch) { out.push(dot(x, y)); out.push(dot(100 - x, y)); }
        for (const y of cys) out.push(dot(50, y));
        if (isVSym(out) && !isHSym(out) && minDist(out) >= 7) return out;
      }
      return [dot(20, 20), dot(80, 20), dot(50, 80)];
    };
    const makeH = (): Prim[] => {
      for (let att = 0; att < 12; att++) {
        const m = mPick();
        const pairs = Math.floor(m / 2);
        const centers = m % 2;
        const slots: Array<[number, number]> = [];
        for (const y of [20, 30, 38]) for (const x of [20, 32, 44, 56, 68, 80]) slots.push([x, y]);
        const ch = pickN(slots, pairs);
        const cxPool = [20, 32, 44, 56, 68, 80];
        const cxs = pickN(cxPool, centers);
        const out: Prim[] = [];
        for (const [x, y] of ch) { out.push(dot(x, y)); out.push(dot(x, 100 - y)); }
        for (const x of cxs) out.push(dot(x, 50));
        if (isHSym(out) && !isVSym(out) && minDist(out) >= 7) return out;
      }
      return [dot(20, 20), dot(20, 80), dot(80, 50)];
    };
    const makeVH = (): Prim[] => {
      for (let att = 0; att < 12; att++) {
        const m = mPick();
        const quads = Math.floor(m / 4);
        const rem = m % 4;
        const qslots: Array<[number, number]> = [];
        for (const x of [20, 30, 38]) for (const y of [20, 30, 38]) qslots.push([x, y]);
        const ch = pickN(qslots, quads);
        const out: Prim[] = [];
        for (const [x, y] of ch) { out.push(dot(x, y)); out.push(dot(100 - x, y)); out.push(dot(x, 100 - y)); out.push(dot(100 - x, 100 - y)); }
        if (rem === 1) out.push(dot(50, 50));
        else if (rem === 2) { out.push(dot(50, 28)); out.push(dot(50, 72)); }
        else if (rem === 3) { out.push(dot(50, 50)); out.push(dot(50, 28)); out.push(dot(50, 72)); }
        if (isVSym(out) && isHSym(out) && minDist(out) >= 7) return out;
      }
      return [dot(20, 20), dot(80, 20), dot(20, 80), dot(80, 80), dot(50, 50)];
    };
    const mk = (): Prim[] => (mode === 'V' ? makeV() : mode === 'H' ? makeH() : makeVH());
    const vis: Prim[][] = [];
    for (let i = 0; i < 8; i++) vis.push(mk());
    const correct: Prim[] = mk();
    const cells: Prim[][] = [...vis, correct.map(p => ({ ...p } as Prim))];
    const want = (c: Prim[]): boolean => (mode === 'V' ? isVSym(c) && !isHSym(c) : mode === 'H' ? isHSym(c) && !isVSym(c) : isVSym(c) && isHSym(c));
    const moves: Array<[number, number]> = eff <= 3
      ? [[14, 0], [-14, 0], [0, 14], [0, -14], [10, 10], [-10, -10]]
      : eff <= 6
        ? [[10, 0], [-10, 0], [0, 10], [0, -10], [8, 8], [-8, -8]]
        : [[8, 0], [-8, 0], [0, 8], [0, -8], [6, 6], [-6, -6], [6, -6], [-6, 6]];
    const seen = new Set<string>();
    seen.add(keyOf(correct));
    const decoys: Prim[][] = [];
    const okSpot = (c: Prim[]): boolean => {
      for (const p of c) {
        if (p.k !== 'dot') return false;
        if (p.x < 14 || p.x > 86 || p.y < 14 || p.y > 86) return false;
      }
      return minDist(c) >= 7;
    };
    outer: for (let idx = 0; idx < correct.length; idx++) {
      for (const [dx, dy] of moves) {
        if (decoys.length >= 7) break outer;
        const cand = correct.map(p => ({ ...p } as Prim));
        const tp = cand[idx];
        if (tp.k !== 'dot') continue;
        tp.x += dx; tp.y += dy;
        if (!okSpot(cand)) continue;
        if (want(cand)) continue;
        const k = keyOf(cand);
        if (seen.has(k)) continue;
        seen.add(k);
        decoys.push(cand);
      }
    }
    const fallMoves: Array<[number, number]> = [[16, 0], [-16, 0], [0, 16], [0, -16], [12, 12], [-12, -12]];
    for (let idx = 0; idx < correct.length && decoys.length < 7; idx++) {
      for (const [dx, dy] of fallMoves) {
        if (decoys.length >= 7) break;
        const cand = correct.map(p => ({ ...p } as Prim));
        const tp = cand[idx];
        if (tp.k !== 'dot') continue;
        tp.x += dx; tp.y += dy;
        if (!okSpot(cand)) continue;
        if (want(cand)) continue;
        const k = keyOf(cand);
        if (seen.has(k)) continue;
        seen.add(k);
        decoys.push(cand);
      }
    }
    if (decoys.length < 7) {
      const drop = correct.slice(1);
      if (drop.length >= 1 && !want(drop) && !seen.has(keyOf(drop)) && minDist(drop) >= 7) { seen.add(keyOf(drop)); decoys.push(drop); }
    }
    if (decoys.length < 7) {
      const extra = correct.map(p => ({ ...p } as Prim));
      const spots = [dot(14, 50), dot(86, 50), dot(50, 14), dot(50, 86), dot(14, 14)];
      for (const s of spots) {
        if (decoys.length >= 7) break;
        const cand = [...extra.map(p => ({ ...p } as Prim)), s];
        if (!okSpot(cand)) continue;
        if (want(cand)) continue;
        const k = keyOf(cand);
        if (seen.has(k)) continue;
        seen.add(k);
        decoys.push(cand);
        break;
      }
    }
    const opts: Prim[][] = [correct, ...decoys.slice(0, 7)];
    const sr = rngFrom(seed ^ 0xa11ce);
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(sr() * (i + 1));
      const t = opts[i]; opts[i] = opts[j]; opts[j] = t;
    }
    const ansKey = keyOf(correct);
    return {
      family: 'mirror-mend', cols: 3, rows: 3,
      cells, holeIndex: 8, options: opts,
      answer: opts.findIndex(o => keyOf(o) === ansKey),
      hue, rule: mode === 'VH' ? 'each cell mirrors both ways' : mode === 'V' ? 'each cell mirrors left to right' : 'each cell mirrors top to bottom',
    };
  },
  solve(p): number {
    const vis: Prim[][] = p.cells.filter((_, i) => i !== p.holeIndex);
    const allV = vis.every(isVSym);
    const allH = vis.every(isHSym);
    if (!allV && !allH) return -1;
    let want: (c: Prim[]) => boolean;
    if (allV && !allH) want = (c) => isVSym(c) && !isHSym(c);
    else if (allH && !allV) want = (c) => isHSym(c) && !isVSym(c);
    else want = (c) => isVSym(c) && isHSym(c);
    return p.options.findIndex(o => want(o));
  },
};

export const FAMILIES5: Family[] = [dualAxis, mirrorMend];

export function selfTest(): boolean {
  const hues = ['amber'];
  for (const f of FAMILIES5) {
    for (let s = 1; s <= 6; s++) {
      for (let d = 1; d <= 12; d++) {
        const p = f.generate(s * 7919 + d * 131, d, hues[0]);
        if (p.options.length !== 8) return false;
        if (p.holeIndex !== p.cells.length - 1) return false;
        for (const c of p.cells) if (c.length < 1 || c.length > 24) return false;
        for (const o of p.options) if (o.length < 1 || o.length > 24) return false;
        const keys = new Set(p.options.map(keyOf));
        if (keys.size !== 8) return false;
        if (f.solve(p) !== p.answer) return false;
      }
    }
  }
  return true;
}

const g = globalThis as unknown as { process?: { argv?: string[] }; console?: { log: (m: string) => void } };
if (g.process?.argv?.[1]?.endsWith('families5.ts')) {
  g.console?.log('selfTest:' + (selfTest() ? 'OK' : 'FAIL'));
}
