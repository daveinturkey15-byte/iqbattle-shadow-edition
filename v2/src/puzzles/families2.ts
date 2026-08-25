import type { Family, Puzzle } from './types.ts';
import { rngFrom } from './types.ts';
import type { Prim } from '../glyphs.ts';

/* ---- shared helpers ---------------------------------------------------- */

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
function r2(v: number): number { return Math.round(v * 100) / 100; }

function shuffled(opts: Prim[][], seed: number): Prim[][] {
  const rr = rngFrom(seed);
  const out = [...opts];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rr() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ========================================================================
 * ROTATION COMPOSITE — live round 4 DNA: a center diamond with an orbiting
 * dot ring; every step rotates the whole ring 90° clockwise AND one new dot
 * joins the trail just behind the previous newcomer. Options mutate exactly
 * one attribute: rotation phase, dot count, chirality, or one dot's place.
 * ====================================================================== */

const RC_SLOTS = 8;           // slots 45° apart
const RC_ROT = 2;             // 90° per step, in slots
const RC_RING_R = 33;

function rcSlotPos(slot: number, radius = RC_RING_R): { x: number; y: number } {
  const ang = ((slot * 45) - 90) * Math.PI / 180;
  return { x: r2(50 + radius * Math.cos(ang)), y: r2(50 + radius * Math.sin(ang)) };
}

/** Dot of `age` steps (0 = oldest) at `step`: rotates 90°/step; each new dot
 *  enters one slot further along the ring than the previous newcomer. */
function rcSlotOf(start: number, age: number, step: number): number {
  return (((start + RC_ROT * (step - age) + age) % RC_SLOTS) + RC_SLOTS) % RC_SLOTS;
}

function rcGlyph(start: number, step: number): Prim[] {
  const prims: Prim[] = [{ k: 'diamond', x: 50, y: 50, s: 13 }];
  for (let age = 0; age <= step; age++) {
    prims.push({ k: 'dot', ...rcSlotPos(rcSlotOf(start, age, step)), r: 4.6 });
  }
  return prims;
}

export const rotationComposite: Family = {
  id: 'rotation-composite',
  generate(seed, diff, hue): Puzzle {
    const r = rngFrom(seed);
    const start = Math.floor(r() * RC_SLOTS);
    void diff;
    const cells = [rcGlyph(start, 0), rcGlyph(start, 1), rcGlyph(start, 2)];
    const answer = rcGlyph(start, 3);
    const slots3 = [0, 1, 2, 3].map(age => rcSlotOf(start, age, 3)); // ascending age
    const dia: Prim = { k: 'diamond', x: 50, y: 50, s: 13 };
    const ringAt = (slotOf: (age: number) => number, radius = RC_RING_R): Prim[] =>
      [0, 1, 2, 3].map(age => ({ k: 'dot', ...rcSlotPos(slotOf(age), radius), r: 4.6 }));
    const decoys: Prim[][] = [
      // wrong rotation phase (+90° / −90°): every dot shifted one step ahead/back
      [dia, ...ringAt(age => slots3[age] + RC_ROT)],
      [dia, ...ringAt(age => slots3[age] - RC_ROT)],
      // wrong dot count: newest dot missing / extra dot across the ring
      [dia, ...slots3.slice(0, 3).map(s => ({ k: 'dot' as const, ...rcSlotPos(s), r: 4.6 }))],
      [dia, ...ringAt(age => slots3[age]), { k: 'dot', ...rcSlotPos(slots3[3] + 4), r: 4.6 }],
      // mirrored ring (chirality flip)
      [dia, ...ringAt(age => (RC_SLOTS - slots3[age]) % RC_SLOTS)],
      // newest dot misplaced one slot back along the ring
      [dia, ...ringAt(age => slots3[age]).slice(0, 3), { k: 'dot', ...rcSlotPos(slots3[3] - 1), r: 4.6 }],
      // newest dot at the wrong orbit radius
      [dia, ...ringAt(age => slots3[age]).slice(0, 3), { k: 'dot', ...rcSlotPos(slots3[3], 24), r: 4.6 }],
    ];
    const opts = shuffled([answer, ...decoys], seed ^ 0x0be5);
    return {
      family: 'rotation-composite', cols: 2, rows: 2,
      cells, holeIndex: 3, options: opts,
      answer: opts.findIndex(o => glyphKey(o) === glyphKey(answer)),
      hue, rule: 'the dot ring spins 90° each step while one more dot joins',
    };
  },
  solve(p): number {
    const slotSets: (number[] | null)[] = p.cells.map(cell => {
      const out: number[] = [];
      let hasDiamond = false;
      for (const prim of cell) {
        if (prim.k === 'diamond') { hasDiamond = true; continue; }
        if (prim.k !== 'dot') return null;
        const dx = prim.x - 50, dy = prim.y - 50;
        if (Math.hypot(dx, dy) < 10) return null; // unexpected center dot
        const deg = (Math.atan2(dy, dx) * 180 / Math.PI + 450) % 360; // 0 at top, cw
        const slot = Math.round(deg / 45) % RC_SLOTS;
        if (Math.abs(deg - slot * 45) > 1) return null; // not on the 45° lattice
        out.push(slot);
      }
      return hasDiamond && out.length ? out : null;
    });
    if (slotSets.length !== 3 || slotSets.some(s => s === null)) return -1;
    const ss = slotSets as number[][];
    if (ss[1].length !== ss[0].length + 1 || ss[2].length !== ss[1].length + 1) return -1;
    // find the rotation direction consistent with both transitions and track
    // where each step's newcomer enters (the anchor)
    const rot = (slots: number[], d: number): number[] =>
      slots.map(s => (((s + d) % RC_SLOTS) + RC_SLOTS) % RC_SLOTS);
    const advance = (from: number[], to: number[], d: number): number | null => {
      const rest = [...to];
      for (const m of rot(from, d)) {
        const i = rest.indexOf(m);
        if (i < 0) return null;
        rest.splice(i, 1);
      }
      return rest.length === 1 ? rest[0] : null;
    };
    let dir: number | null = null;
    let anchors: number[] | null = null;
    for (const d of [RC_ROT, -RC_ROT]) {
      const a0 = advance(ss[0], ss[1], d);
      const a1 = a0 === null ? null : advance(ss[1], ss[2], d);
      if (a0 !== null && a1 !== null) {
        if (dir !== null) return -1; // ambiguous symmetry
        dir = d;
        anchors = [a0, a1];
      }
    }
    if (dir === null || anchors === null) return -1;
    const drift = (((anchors[1] - anchors[0]) % RC_SLOTS) + RC_SLOTS) % RC_SLOTS;
    const newSlot = (anchors[1] + drift) % RC_SLOTS;
    const expectSlots = rot(ss[2], dir);
    if (expectSlots.includes(newSlot)) return -1; // newcomer would overlap
    expectSlots.push(newSlot);
    const diamond = p.cells[0].find(pr => pr.k === 'diamond');
    if (!diamond) return -1;
    const expect: Prim[] = [diamond, ...expectSlots.map((s): Prim => ({ k: 'dot', ...rcSlotPos(s), r: 4.6 }))];
    const ke = glyphKey(expect);
    const hits: number[] = [];
    p.options.forEach((o, i) => { if (glyphKey(o) === ke) hits.push(i); });
    return hits.length === 1 ? hits[0] : -1;
  },
};

/* ========================================================================
 * POSITION ORBIT — 3×3 DNA: one dot orbits a fixed center marker; its angle
 * advances a fixed step per column and its orbit radius widens a fixed step
 * per row. Options move the dot along exactly one axis (angle or radius).
 * ====================================================================== */

function poGlyph(angleDeg: number, radius: number): Prim[] {
  const a = angleDeg * Math.PI / 180;
  return [
    { k: 'diamond', x: 50, y: 50, s: 6 },
    { k: 'dot', x: r2(50 + radius * Math.cos(a)), y: r2(50 + radius * Math.sin(a)), r: 4.2 },
  ];
}

export const positionOrbit: Family = {
  id: 'position-orbit',
  generate(seed, diff, hue): Puzzle {
    const r = rngFrom(seed);
    const a0 = Math.floor(r() * 24) * 15;
    const da = diff >= 4 ? 30 : 40;
    const radii = [12, 22, 32];
    const angle = (_row: number, col: number) => a0 + col * da;
    const cells: Prim[][] = [];
    for (let i = 0; i < 8; i++) {
      const row = Math.floor(i / 3), col = i % 3;
      cells.push(poGlyph(angle(row, col), radii[row]));
    }
    const answer = poGlyph(angle(2, 2), radii[2]);
    const decoys: Prim[][] = [
      poGlyph(angle(2, 2) + da, radii[2]),
      poGlyph(angle(2, 2) + 2 * da, radii[2]),
      poGlyph(angle(2, 2) - da, radii[2]),
      poGlyph(angle(2, 2) - 2 * da, radii[2]),
      poGlyph(angle(2, 2) - 3 * da, radii[2]),
      poGlyph(angle(2, 2), radii[2] + 10),
      poGlyph(angle(2, 2), radii[2] - 10),
    ];
    const opts = shuffled([answer, ...decoys], seed ^ 0x06b17);
    return {
      family: 'position-orbit', cols: 3, rows: 3,
      cells, holeIndex: 8, options: opts,
      answer: opts.findIndex(o => glyphKey(o) === glyphKey(answer)),
      hue, rule: 'the dot steps a fixed angle per column; its orbit widens per row',
    };
  },
  solve(p): number {
    const obs: ({ theta: number; rho: number } | null)[] = p.cells.map(cell => {
      const dot = cell.find(pr => pr.k === 'dot');
      if (!dot || dot.k !== 'dot' || cell.length !== 2) return null;
      const dx = dot.x - 50, dy = dot.y - 50;
      return {
        theta: (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360,
        rho: Math.hypot(dx, dy),
      };
    });
    if (obs.length !== 8 || obs.some(o => o === null)) return -1;
    const o = obs as { theta: number; rho: number }[];
    const angDiff = (from: number, to: number) => ((to - from + 540) % 360) - 180;
    // column angle step must be constant everywhere it is observable
    let daStep: number | null = null;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 2; col++) {
        const i = row * 3 + col;
        if (i > 6) break;              // cell i+1 would be the hole
        const d = angDiff(o[i].theta, o[i + 1].theta);
        if (daStep === null) daStep = d;
        else if (Math.abs(angDiff(daStep, d)) > 0.5) return -1;
      }
    }
    if (daStep === null || Math.abs(daStep) < 1) return -1;
    // radius: constant within a row, equal step across rows
    for (let row = 0; row < 3; row++) {
      if (Math.abs(o[row * 3].rho - o[row * 3 + 1].rho) > 0.25) return -1;
    }
    if (Math.abs(o[3].rho - o[0].rho - (o[6].rho - o[3].rho)) > 0.25) return -1;
    // expected hole dot: one more column step from cell 7, same orbit radius.
    // Match options GEOMETRICALLY (not by rounded keys): derived theta/rho
    // carry rounding noise, while decoys sit >=30 deg / >=10 units away, so a
    // tolerance of a few degrees/units is unambiguous.
    const theta = o[7].theta + daStep;
    const rho = o[7].rho;
    const hits: number[] = [];
    p.options.forEach((op, i) => {
      if (op.length !== 2 || !op.some(pr => pr.k === 'diamond')) return;
      const dot = op.find(pr => pr.k === 'dot');
      if (!dot || dot.k !== 'dot') return;
      const dx = dot.x - 50, dy = dot.y - 50;
      const rho2 = Math.hypot(dx, dy);
      if (Math.abs(rho2 - rho) > 1.5) return;
      const th2 = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      const dAng = Math.abs(((th2 - theta + 540) % 360) - 180);
      if (dAng <= 1.5) hits.push(i);
    });
    return hits.length === 1 ? hits[0] : -1;
  },
};

/* ========================================================================
 * MISSING SECTION — 2×2 of quadrant glyphs, each quadrant a small field of
 * ONE primitive mark kind. Counts form an additive grid across columns and
 * rows; the mark kind cycles diamond → dot → triangle in reading order, so
 * the removed bottom-right section repeats the top-left kind. Options are
 * complete sections mutated in count alone or kind alone.
 * ====================================================================== */

const MS_KINDS = ['diamond', 'dot', 'tri'] as const;
type MsKind = typeof MS_KINDS[number];

/** Lay `n` small marks of one kind out in a tidy centered mini-grid. */
function msLayout(kind: MsKind, n: number): Prim[] {
  const out: Prim[] = [];
  const perRow = Math.max(2, Math.ceil(Math.sqrt(n * 1.4)));
  const rows = Math.ceil(n / perRow);
  const gapX = Math.min(26, 76 / perRow);
  const gapY = Math.min(28, 76 / rows);
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / perRow), col = i % perRow;
    const inRow = Math.min(perRow, n - row * perRow);
    const x = r2(50 + (col - (inRow - 1) / 2) * gapX);
    const y = r2(50 + (row - (rows - 1) / 2) * gapY);
    if (kind === 'tri') out.push({ k: 'tri', x, y, s: 8 });
    else if (kind === 'dot') out.push({ k: 'dot', x, y, r: 3.6 });
    else out.push({ k: 'diamond', x, y, s: 7 });
  }
  return out;
}

export const missingSection: Family = {
  id: 'missing-section',
  generate(seed, diff, hue): Puzzle {
    const r = rngFrom(seed);
    const k0 = Math.floor(r() * 3);
    const base = 1 + Math.floor(r() * 2);
    const colStep = diff >= 4 ? 2 : 1;
    const rowStep = diff >= 2 ? 2 : 1;
    const count = (qr: number, qc: number) => base + qc * colStep + qr * rowStep;
    const kindOf = (qr: number, qc: number) => MS_KINDS[(k0 + qr * 2 + qc) % 3];
    const quad = (qr: number, qc: number) => msLayout(kindOf(qr, qc), count(qr, qc));
    const cells = [quad(0, 0), quad(0, 1), quad(1, 0)];
    const answer = quad(1, 1);
    const hn = count(1, 1);
    const hk = kindOf(1, 1);
    const others = MS_KINDS.filter(k => k !== hk);
    const decoys: Prim[][] = [
      msLayout(hk, hn - 2),
      msLayout(hk, hn - 1),
      msLayout(hk, hn + 1),
      msLayout(hk, hn + 2),
      msLayout(hk, hn + 3),
      msLayout(others[0], hn),
      msLayout(others[1], hn),
    ];
    const opts = shuffled([answer, ...decoys], seed ^ 0x5ec7);
    return {
      family: 'missing-section', cols: 2, rows: 2,
      cells, holeIndex: 3, options: opts,
      answer: opts.findIndex(o => glyphKey(o) === glyphKey(answer)),
      hue, rule: 'section counts grow across and down; mark kind cycles reading-order',
    };
  },
  solve(p): number {
    const parse = (cell: Prim[]): { n: number; kind: MsKind } | null => {
      const first = cell[0];
      if (!first) return null;
      if (first.k === 'line') return null;
      const kind: MsKind = first.k;
      return cell.every(pr => pr.k === kind) ? { n: cell.length, kind } : null;
    };
    const q00 = parse(p.cells[0]), q01 = parse(p.cells[1]), q10 = parse(p.cells[2]);
    if (!q00 || !q01 || !q10) return -1;
    const ki = (k: MsKind) => MS_KINDS.indexOf(k);
    if (ki(q01.kind) !== (ki(q00.kind) + 1) % 3) return -1;
    if (ki(q10.kind) !== (ki(q00.kind) + 2) % 3) return -1;
    const colStep = q01.n - q00.n, rowStep = q10.n - q00.n;
    if (colStep <= 0 || rowStep <= 0) return -1;
    const expect = msLayout(q00.kind, q01.n + q10.n - q00.n);
    const ke = glyphKey(expect);
    const hits: number[] = [];
    p.options.forEach((o, i) => { if (glyphKey(o) === ke) hits.push(i); });
    return hits.length === 1 ? hits[0] : -1;
  },
};

export const FAMILIES2: Family[] = [rotationComposite, positionOrbit, missingSection];
