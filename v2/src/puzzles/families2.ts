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

/** Clamp requested difficulty to the solvable 1..12 band; beyond holds hardest. */
function clampDiff(diff: number): number {
  const f = Math.floor(diff);
  if (!isFinite(f)) return 12;
  return Math.max(1, Math.min(12, f));
}

function posOf(p: Prim): { x: number; y: number } | null {
  switch (p.k) {
    case 'tri': return { x: p.x, y: p.y };
    case 'dot': return { x: p.x, y: p.y };
    case 'diamond': return { x: p.x, y: p.y };
    case 'line': return null;
  }
}

/** True when any two marks would visibly overlap (centre distance too small). */
function hasOverlap(prims: Prim[]): boolean {
  const pts: { x: number; y: number }[] = [];
  for (const p of prims) {
    const q = posOf(p);
    if (q) pts.push(q);
  }
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x;
      const dy = pts[i].y - pts[j].y;
      if (Math.hypot(dx, dy) < 7.5) return true;
    }
  }
  return false;
}

/* ========================================================================
 * ROTATION COMPOSITE — live round 4 DNA: a center diamond with an orbiting
 * dot ring; every step rotates the whole ring 90° clockwise AND one new dot
 * joins the trail just behind the previous newcomer. Options mutate exactly
 * one attribute: rotation phase, dot count, chirality, or one dot's place.
 * Difficulty ramp (monotonic, clamped): base trail length 1..4 grows with
 * diff (more marks to track, larger progression), decoys go from coarse
 * multi-attribute gaps (±90°, far orbit Δ13) to fine single-attribute gaps
 * (±45°, near orbit Δ5, single-dot move to the one empty slot).
 * ====================================================================== */

const RC_SLOTS = 8;           // slots 45° apart
const RC_ROT = 2;             // 90° per step, in slots
const RC_RING_R = 33;

function rcSlotPos(slot: number, radius = RC_RING_R): { x: number; y: number } {
  const ang = ((slot * 45) - 90) * Math.PI / 180;
  return { x: r2(50 + radius * Math.cos(ang)), y: r2(50 + radius * Math.sin(ang)) };
}

/** Dot of `age` steps (0 = oldest) at absolute time `step`. */
function rcSlotOf(start: number, age: number, step: number): number {
  return (((start + RC_ROT * (step - age) + age) % RC_SLOTS) + RC_SLOTS) % RC_SLOTS;
}

/** All ring slots present at absolute time T (T+1 dots, distinct mod 8). */
function rcSlotsAt(start: number, t: number): number[] {
  const out: number[] = [];
  for (let age = 0; age <= t; age++) out.push(rcSlotOf(start, age, t));
  return out;
}

function rcGlyphAt(start: number, t: number, radius = RC_RING_R): Prim[] {
  const prims: Prim[] = [{ k: 'diamond', x: 50, y: 50, s: 13 }];
  for (const s of rcSlotsAt(start, t)) {
    prims.push({ k: 'dot', ...rcSlotPos(s, radius), r: 4.6 });
  }
  return prims;
}

/** Base trail length grows 1..4 across diff 1..12, then holds. */
function rcBaseFor(d: number): number {
  return 1 + Math.min(3, Math.floor((d - 1) / 3));
}

export const rotationComposite: Family = {
  id: 'rotation-composite',
  generate(seed, diff, hue): Puzzle {
    const r = rngFrom(seed);
    const start = Math.floor(r() * RC_SLOTS);
    const d = clampDiff(diff);
    const base = rcBaseFor(d);
    // absolute times: step i holds base+i dots; answer holds base+3 dots (max 7)
    const cells = [rcGlyphAt(start, base - 1), rcGlyphAt(start, base), rcGlyphAt(start, base + 1)];
    const answer = rcGlyphAt(start, base + 2);
    const ansSlots = rcSlotsAt(start, base + 2);
    const dia: Prim = { k: 'diamond', x: 50, y: 50, s: 13 };
    const ringAt = (slots: number[], radius = RC_RING_R): Prim[] =>
      [dia, ...slots.map((s): Prim => ({ k: 'dot', ...rcSlotPos(((s % RC_SLOTS) + RC_SLOTS) % RC_SLOTS, radius), r: 4.6 }))];
    const mod = (s: number): number => (((s % RC_SLOTS) + RC_SLOTS) % RC_SLOTS);
    const empty: number[] = [];
    for (let s = 0; s < RC_SLOTS; s++) if (!ansSlots.map(mod).includes(s)) empty.push(s);
    const extra = empty.length ? empty[0] : mod(ansSlots[0] + 4);
    const movedSlot = empty.length ? empty[0] : mod(ansSlots[ansSlots.length - 1] + 1);
    const newestReplaced: number[] = [...ansSlots.slice(0, ansSlots.length - 1), movedSlot];
    const rotP2 = ringAt(ansSlots.map(s => s + RC_ROT));
    const rotM2 = ringAt(ansSlots.map(s => s - RC_ROT));
    const rotP1 = ringAt(ansSlots.map(s => s + 1));
    const rotM1 = ringAt(ansSlots.map(s => s - 1));
    const countMinus = ringAt(ansSlots.slice(0, ansSlots.length - 1));
    const countPlus = ringAt([...ansSlots, extra]);
    const mirror = ringAt(ansSlots.map(s => (RC_SLOTS - mod(s)) % RC_SLOTS));
    const moved = ringAt(newestReplaced);
    const radClose = ringAt(ansSlots, 28); // Δ5 subtle arm step
    const radInner = ringAt(ansSlots, 23); // Δ10
    const radOuter = ringAt(ansSlots, 38); // Δ5 outward
    const radFar = ringAt(ansSlots, 20);   // Δ13 coarse
    // Primary ladder ordered by difficulty: easy coarse multi-gap first,
    // hard fine single-attribute first. Every entry differs by construction
    // in rotation, count, chirality, arrangement, or 5px-separated radius.
    let primary: Prim[][];
    if (d <= 3) {
      primary = [rotP2, rotM2, countMinus, countPlus, mirror, radFar, moved, rotP1, radClose, radOuter];
    } else if (d <= 6) {
      primary = [rotP2, rotM2, countMinus, countPlus, mirror, moved, radFar, rotP1, rotM1, radClose];
    } else {
      primary = [rotP1, rotM1, moved, countMinus, countPlus, radClose, mirror, rotP2, radInner, radOuter];
    }
    // Fallback ladder separated BY CONSTRUCTION (arm length in 5px steps and
    // mark count), never by angle jitter alone, so high-diff small steps can
    // never round to the same canonical key.
    const fallback: Prim[][] = [
      ringAt(ansSlots, 28),
      ringAt(ansSlots, 23),
      ringAt(ansSlots, 38),
      ringAt(ansSlots, 43),
      ringAt(ansSlots.slice(0, ansSlots.length - 1), 28),
      ringAt([...ansSlots, extra], 28),
      ringAt(newestReplaced, 28),
      ringAt(ansSlots.map(s => (RC_SLOTS - mod(s)) % RC_SLOTS), 28),
      ringAt(ansSlots, 20),
      ringAt(ansSlots.slice(0, Math.max(1, ansSlots.length - 2))),
    ];
    // Explicit distinctness check: canonical key Set, reject collisions.
    const seen = new Set<string>([glyphKey(answer)]);
    const picked: Prim[][] = [];
    const consider = (cand: Prim[]): void => {
      if (picked.length >= 7) return;
      if (cand.length < 1 || cand.length > 24) return;
      if (hasOverlap(cand)) return;
      const k = glyphKey(cand);
      if (seen.has(k)) return;
      seen.add(k);
      picked.push(cand);
    };
    for (const c of primary) { if (picked.length >= 7) break; consider(c); }
    for (const c of fallback) { if (picked.length >= 7) break; consider(c); }
    let extraR = 48;
    while (picked.length < 7 && extraR < 80) {
      consider(ringAt(ansSlots, extraR));
      extraR += 5;
    }
    const opts = shuffled([answer, ...picked], seed ^ 0x0be5);
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
    const rot = (slots: number[], dd: number): number[] =>
      slots.map(s => (((s + dd) % RC_SLOTS) + RC_SLOTS) % RC_SLOTS);
    const advance = (from: number[], to: number[], dd: number): number | null => {
      const rest = [...to];
      for (const m of rot(from, dd)) {
        const i = rest.indexOf(m);
        if (i < 0) return null;
        rest.splice(i, 1);
      }
      return rest.length === 1 ? rest[0] : null;
    };
    let dir: number | null = null;
    let anchors: number[] | null = null;
    for (const dd of [RC_ROT, -RC_ROT]) {
      const a0 = advance(ss[0], ss[1], dd);
      const a1 = a0 === null ? null : advance(ss[1], ss[2], dd);
      if (a0 !== null && a1 !== null) {
        if (dir !== null) return -1; // ambiguous symmetry
        dir = dd;
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
 * Difficulty ramp: angle step 45°→36°→30°→24° (finer to track) and radial
 * step 8→9→10 (larger progression); decoys tighten from coarse ±2 steps /
 * ±10 arm gaps with two-attribute lures to fine single-attribute ±15° /
 * ±5 arm gaps. Arm gaps always use 5px construction steps.
 * ====================================================================== */

function poGlyph(angleDeg: number, radius: number): Prim[] {
  const a = angleDeg * Math.PI / 180;
  return [
    { k: 'diamond', x: 50, y: 50, s: 6 },
    { k: 'dot', x: r2(50 + radius * Math.cos(a)), y: r2(50 + radius * Math.sin(a)), r: 4.2 },
  ];
}

function poDaFor(d: number): number {
  if (d <= 3) return 45;
  if (d <= 6) return 36;
  if (d <= 9) return 30;
  return 24;
}
function poDrFor(d: number): number {
  if (d <= 3) return 8;
  if (d <= 6) return 9;
  return 10;
}

export const positionOrbit: Family = {
  id: 'position-orbit',
  generate(seed, diff, hue): Puzzle {
    const r = rngFrom(seed);
    const a0 = Math.floor(r() * 24) * 15;
    const d = clampDiff(diff);
    const da = poDaFor(d);
    const dr = poDrFor(d);
    const r0 = 12;
    const radii = [r0, r0 + dr, r0 + 2 * dr];
    const angle = (_row: number, col: number) => a0 + col * da;
    const cells: Prim[][] = [];
    for (let i = 0; i < 8; i++) {
      const row = Math.floor(i / 3), col = i % 3;
      cells.push(poGlyph(angle(row, col), radii[row]));
    }
    const A = angle(2, 2);
    const R = radii[2];
    const answer = poGlyph(A, R);
    // Candidate decoys: each varies ONE axis unless noted (easy allows two).
    const cAngP1 = poGlyph(A + da, R);
    const cAngM1 = poGlyph(A - da, R);
    const cAngP2 = poGlyph(A + 2 * da, R);
    const cAngM2 = poGlyph(A - 2 * da, R);
    const cFineP = poGlyph(A + 15, R);
    const cFineM = poGlyph(A - 15, R);
    const cRadP5 = poGlyph(A, R + 5);
    const cRadM5 = poGlyph(A, R - 5);
    const cRadP10 = poGlyph(A, R + 10);
    const cRadM10 = poGlyph(A, R - 10);
    const cTwoA = poGlyph(A + da, R + 10);
    const cTwoB = poGlyph(A - da, R - 10);
    const cTwoC = poGlyph(A + 2 * da, R + 5);
    let primary: Prim[][];
    if (d <= 3) {
      primary = [cAngP1, cAngM1, cAngP2, cRadP10, cRadM10, cTwoA, cTwoB, cTwoC, cFineP, cRadP5];
    } else if (d <= 6) {
      primary = [cAngP1, cAngM1, cFineP, cFineM, cRadP5, cRadM5, cRadP10, cAngP2, cTwoA, cTwoB];
    } else {
      // hard: every decoy differs by ONE attribute with a fine gap
      primary = [cFineP, cFineM, cAngP1, cAngM1, cRadP5, cRadM5, cRadP10, cAngP2, cAngM2, cRadM10];
    }
    // Fallback ladder separated BY CONSTRUCTION: arm length in 5px steps and
    // fixed 15° angle offsets, so keys stay ≥5px apart after rounding.
    const fallback: Prim[][] = [
      poGlyph(A, R + 5),
      poGlyph(A, R - 5),
      poGlyph(A, R + 10),
      poGlyph(A, R - 10),
      poGlyph(A, R + 15),
      poGlyph(A + 15, R + 5),
      poGlyph(A - 15, R - 5),
      poGlyph(A + 15, R),
      poGlyph(A - 15, R),
      poGlyph(A + da, R + 5),
    ];
    const seen = new Set<string>([glyphKey(answer)]);
    const picked: Prim[][] = [];
    const consider = (cand: Prim[]): void => {
      if (picked.length >= 7) return;
      if (cand.length < 1 || cand.length > 24) return;
      if (hasOverlap(cand)) return;
      const k = glyphKey(cand);
      if (seen.has(k)) return;
      seen.add(k);
      picked.push(cand);
    };
    for (const c of primary) { if (picked.length >= 7) break; consider(c); }
    for (const c of fallback) { if (picked.length >= 7) break; consider(c); }
    let rr = 15;
    while (picked.length < 7 && rr < 60) {
      consider(poGlyph(A, R + rr));
      consider(poGlyph(A + 30, R - 5));
      rr += 5;
    }
    const opts = shuffled([answer, ...picked], seed ^ 0x06b17);
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
        const dd = angDiff(o[i].theta, o[i + 1].theta);
        if (daStep === null) daStep = dd;
        else if (Math.abs(angDiff(daStep, dd)) > 0.5) return -1;
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
    // carry rounding noise, while decoys sit >=12 deg / >=5 units away, so a
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
 * Difficulty ramp: column/row steps 1/1 → 1/2 → 2/2 → 2/3 → 3/3 (larger
 * second-order totals) and base density +0→+2; decoys tighten from coarse
 * two-attribute lures (±2..4 counts, wrong kind plus wrong count) to fine
 * single-attribute lures (±1 counts, or right count with wrong kind).
 * ====================================================================== */

const MS_KINDS = ['diamond', 'dot', 'tri'] as const;
type MsKind = typeof MS_KINDS[number];

/** Lay `n` small marks of one kind out in a tidy centered mini-grid. */
function msLayout(kind: MsKind, n: number): Prim[] {
  const out: Prim[] = [];
  if (n < 1 || n > 24) return out;
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
    else if (kind === 'dot') out.push({ k: 'dot', x, y, r: 4.2 });
    else out.push({ k: 'diamond', x, y, s: 7 });
  }
  return out;
}

function msStepsFor(d: number): { col: number; row: number } {
  if (d <= 1) return { col: 1, row: 1 };
  if (d <= 3) return { col: 1, row: 2 };
  if (d <= 5) return { col: 2, row: 2 };
  if (d <= 8) return { col: 2, row: 3 };
  return { col: 3, row: 3 };
}

export const missingSection: Family = {
  id: 'missing-section',
  generate(seed, diff, hue): Puzzle {
    const r = rngFrom(seed);
    const k0 = Math.floor(r() * 3);
    const baseRand = Math.floor(r() * 2);
    const d = clampDiff(diff);
    const st = msStepsFor(d);
    const colStep = st.col;
    const rowStep = st.row;
    const base = 1 + baseRand + Math.floor((d - 1) / 4); // 1..4, denser when hard
    const count = (qr: number, qc: number) => base + qc * colStep + qr * rowStep;
    const kindOf = (qr: number, qc: number) => MS_KINDS[(k0 + qr * 2 + qc) % 3];
    const quad = (qr: number, qc: number) => msLayout(kindOf(qr, qc), count(qr, qc));
    const cells = [quad(0, 0), quad(0, 1), quad(1, 0)];
    const answer = quad(1, 1);
    const hn = count(1, 1);
    const hk = kindOf(1, 1);
    const others = MS_KINDS.filter(k => k !== hk);
    const cnt = (delta: number): Prim[] => msLayout(hk, hn + delta);
    let primary: Prim[][];
    if (d <= 3) {
      // easy: coarse gaps, several two-attribute lures (wrong kind + wrong count)
      primary = [
        cnt(2), cnt(-2), cnt(3), msLayout(others[0], hn + 2),
        msLayout(others[1], hn - 2), msLayout(others[0], hn), cnt(-3),
        cnt(1), cnt(-1), msLayout(others[1], hn),
      ];
    } else if (d <= 6) {
      primary = [
        cnt(-1), cnt(1), cnt(-2), cnt(2),
        msLayout(others[0], hn), msLayout(others[1], hn), cnt(3),
        msLayout(others[0], hn + 1), cnt(-3), msLayout(others[1], hn + 2),
      ];
    } else {
      // hard: every decoy differs by ONE attribute only (count ±1/±2 with
      // right kind, or right count with wrong kind)
      primary = [
        cnt(-1), cnt(1), msLayout(others[0], hn), msLayout(others[1], hn),
        cnt(-2), cnt(2), cnt(3),
        cnt(-3), msLayout(others[0], hn + 1), msLayout(others[1], hn - 1),
      ];
    }
    // Fallback ladder separated BY CONSTRUCTION: mark count steps of 1 and
    // kind swaps guarantee distinct canonical keys (different lengths/kinds
    // and different mini-grid arrangements), never angle jitter.
    const fallback: Prim[][] = [
      msLayout(hk, hn + 4), msLayout(hk, hn - 4),
      msLayout(hk, hn + 5), msLayout(hk, hn - 5),
      msLayout(others[0], hn + 3), msLayout(others[1], hn - 3),
      msLayout(others[0], hn + 1), msLayout(others[1], hn + 1),
      msLayout(hk, hn + 6), msLayout(hk, hn - 6),
    ];
    const seen = new Set<string>([glyphKey(answer)]);
    const picked: Prim[][] = [];
    const consider = (cand: Prim[]): void => {
      if (picked.length >= 7) return;
      if (cand.length < 1 || cand.length > 24) return;
      if (hasOverlap(cand)) return;
      const k = glyphKey(cand);
      if (seen.has(k)) return;
      seen.add(k);
      picked.push(cand);
    };
    for (const c of primary) { if (picked.length >= 7) break; consider(c); }
    for (const c of fallback) { if (picked.length >= 7) break; consider(c); }
    let dd = 7;
    while (picked.length < 7 && dd < 20) {
      consider(msLayout(hk, hn + dd));
      consider(msLayout(others[0], hn + dd));
      dd += 1;
    }
    const opts = shuffled([answer, ...picked], seed ^ 0x5ec7);
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
