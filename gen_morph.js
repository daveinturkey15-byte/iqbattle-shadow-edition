/* IQ.GenV2 'morph' — MORPH SEQUENCE puzzles.
 * Every fragment is one animation frame of a SINGLE transformation axis,
 * advanced along reading order; the color never changes. Axes:
 *   scale    — the mark swells/shrinks step by step (nested-tile span 4→1),
 *   rotate   — a triangle spins by a constant step (visible rot only),
 *   position — the mark drifts through a tiny frame (nested-tile padding),
 *   squash   — the frame squashes wide↔tall (width≠height nested tiles).
 * Board is always 3×3, hole bottom-right (index 8); cell p shows frame
 * (p mod L) for L ∈ {3,4}. Options: the true next frame + 7 decoys that are
 * wrong continuations of the parameter. Deterministic mulberry32.
 */
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};
  root.IQ.Gens2 = root.IQ.Gens2 || {};

  const AXES = ['scale', 'rotate', 'position', 'squash'];

  // --- mulberry32 seeded RNG (same as IQ.Puzzles) ---
  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  class Rng {
    constructor(seed) { this.next = mulberry32(seed >>> 0); }
    f() { return this.next(); }
    int(n) { return Math.min(n - 1, Math.floor(this.next() * n)); }
    range(a, b) { return a + this.int(b - a + 1); }
    pick(arr) { return arr[this.int(arr.length)]; }
    chance(p) { return this.next() < p; }
  }
  function shuffle(r, arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = r.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // --- canonical deep-equality (order-insensitive object keys) ---
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') {
      const ks = Object.keys(v).sort();
      return '{' + ks.map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    }
    return JSON.stringify(v);
  }

  // --- tile factories (leaf cells only; one nesting level, renderer-safe) ---
  const leaf = (shape, color, rot) => ({ shape, color, rot });
  const mkTile = (cols, rows, cells) => ({ cols, rows, cells });
  function paddedTile(span, markIdx, mark) {
    const cells = new Array(span * span).fill(null);
    cells[markIdx] = { ...mark };
    return mkTile(span, span, cells);
  }
  function filledTile(cols, rows, mark) {
    const cells = [];
    for (let i = 0; i < cols * rows; i++) cells.push({ ...mark });
    return mkTile(cols, rows, cells);
  }
  const singleTile = (mark) => mkTile(1, 1, [{ ...mark }]);

  const PROMPTS = [
    [ // difficulty 1-2
      'Each fragment is one frame of a single smooth transformation. Read in order and pick the next frame.',
      'The sigil is animating — one parameter changes frame by frame. Complete the motion.',
    ],
    [ // difficulty 3-4
      'It swells, spins, drifts, or squeezes — but only ever one thing at a time. Follow the parameter.',
      'The metamorphosis is steady. Track it across the grid and choose the frame that comes next.',
      'Something in the glass is mid-change. It will not stop. Predict the next stage.',
    ],
    [ // difficulty 5
      'IT CHANGES BETWEEN GLANCES. NAME THE SHAPE IT WEARS WHEN THE HOLE CLOSES.',
      'THE FRAME NEVER STOPPED MOVING. IT WAS ONLY EVER WAITING FOR YOU TO LOOK AWAY. CHOOSE.',
    ],
  ];

  // Position-axis orbits: 3 frames slide along a top-row strip, 4 frames
  // orbit the corners of a 2×2 viewfinder clockwise.
  const POS_PATHS = { 3: { dims: [3, 1], path: [0, 1, 2] }, 4: { dims: [2, 2], path: [0, 1, 3, 2] } };
  const SQUASH_SEQS = {
    3: [[3, 1], [2, 2], [1, 3]],
    4: [[3, 1], [2, 1], [1, 2], [1, 3]],
  };

  function frameTile(axis, p, L, st) {
    switch (axis) {
      case 'scale': return paddedTile(st.spans[p % L], 0, st.mark);
      case 'rotate': return singleTile(leaf('triangle', st.color, (st.baseRot + st.rotStep * p) % 4));
      case 'position': {
        const { dims, path } = POS_PATHS[L];
        const cells = new Array(dims[0] * dims[1]).fill(null);
        cells[path[p % L]] = { ...st.mark };
        return mkTile(dims[0], dims[1], cells);
      }
      default: { // squash
        let [c, rw] = SQUASH_SEQS[L][p % L];
        if (st.flip) [c, rw] = [rw, c];
        return filledTile(c, rw, st.mark);
      }
    }
  }

  function ruleText(axis, st, L, kindTail) {
    const head = `one fragment repeats as animation frames — `;
    const body = {
      scale: `it ${st.spans[0] > st.spans[L - 1] ? 'swells' : 'shrinks'} by equal attention, frame after frame`,
      rotate: `the triangle turns the same amount every step (${st.rotStep === 1 ? 'clockwise' : 'counter-clockwise'})`,
      position: `the mark advances one notch along its little viewfinder, wrapping as it goes`,
      squash: `the frame squeezes steadily from wide to tall`,
    }[axis];
    return head + body + '; the color never changes' + kindTail;
  }

  // Decoys = wrong continuations of the SAME parameter (nearest misses first),
  // then off-rule corruptions (tint / extra mark / stray rot). Never the truth.
  function decoys(axis, st, L, frames, expected, r) {
    const want = 7;
    const seen = new Set([canon(expected)]);
    const pool = [];
    const push = (t) => {
      const k = canon(t);
      if (!seen.has(k)) { seen.add(k); pool.push(t); }
    };
    const expSpan = expected.cols; // scale: span == cols == rows
    // Tier 1 — parameter near-misses.
    push(frames[(8 - 1) % L]); // the motion freezes on the last visible frame
    push(frames[(8 - 2) % L]); // the motion overshoots backward
    if (axis === 'scale') {
      for (const s of shuffle(r, [1, 2, 3, 4])) if (s !== expSpan) push(paddedTile(s, 0, st.mark));
    } else if (axis === 'rotate') {
      for (const v of shuffle(r, [0, 1, 2, 3])) {
        if (v !== expected.cells[0].rot) push(singleTile(leaf('triangle', st.color, v)));
      }
    } else if (axis === 'position') {
      const { dims, path } = POS_PATHS[L];
      const n = dims[0] * dims[1];
      for (let i = 0; i < n; i++) {
        if (!path.includes(i) || path.indexOf(i) !== (8 % L)) {
          const cells = new Array(n).fill(null);
          cells[i] = { ...st.mark };
          push(mkTile(dims[0], dims[1], cells));
        }
      }
    } else { // squash
      const cand = [[1, 1], [2, 1], [1, 2], [2, 2], [3, 1], [1, 3]];
      for (const [c, rw] of shuffle(r, cand)) {
        const [ec, er] = [expected.cols, expected.rows];
        if (!(c === ec && rw === er)) push(filledTile(st.flip ? rw : c, st.flip ? c : rw, st.mark));
      }
    }
    // Tier 2 — corrupt the truth itself: tinted, spun, doubled.
    let guard = 0;
    while (pool.length < want && guard++ < 400) {
      const marks = expected.cells.filter(Boolean);
      const m = { ...marks[r.int(marks.length)] };
      const w = r.int(3);
      if (w === 0) m.color = (st.color + r.range(1, 7)) % 8;
      else if (w === 1 && axis !== 'rotate') m.rot = (m.rot + r.range(1, 3)) % 4;
      else {
        // doubled mark: clone the frame with an extra mark in a free slot
        const t = { cols: expected.cols, rows: expected.rows, cells: expected.cells.map((c) => (c ? { ...c } : null)) };
        const free = t.cells.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
        if (!free.length || expected.cells.length < 2) { m.color = (st.color + r.range(1, 7)) % 8; push(singleTile(m)); continue; }
        t.cells[free[r.int(free.length)]] = { ...marks[0] };
        continue;
      }
      if (axis === 'rotate') push(singleTile(m));
      else if (axis === 'scale') push(paddedTile(expected.cols, 0, m));
      else push(mkTile(expected.cols, expected.rows, expected.cells.map((c, i) => (i === expected.cells.findIndex(Boolean) ? { ...m } : (c ? { ...c } : null)))));
    }
    // Paranoia fill.
    while (pool.length < want) push(paddedTile(1 + (pool.length % 4), 0, { ...st.mark, color: (st.color + 1 + pool.length) % 8 }));
    return shuffle(r, pool).slice(0, want);
  }

  function generate(opts = {}) {
    const difficulty = Math.min(5, Math.max(1, Math.floor(Number(opts.difficulty) || 2)));
    const seed = (opts.seed != null ? Number(opts.seed)
      : (Date.now() ^ (Math.random() * 0xffffffff))) >>> 0;
    const r = new Rng(seed);

    const axis = r.pick(AXES);
    const color = r.int(8);
    const L = difficulty <= 2 ? 3 : r.pick([3, 4]);
    const st = { color, mark: leaf(r.pick(['square', 'diamond', 'ring']), color, 0), baseRot: r.int(4), rotStep: 1, flip: false, spans: [] };
    if (axis === 'rotate') st.rotStep = difficulty >= 4 && r.chance(0.5) ? 3 : 1;
    if (axis === 'scale') {
      const dir = r.chance(0.5) ? 1 : -1;
      st.spans = shuffle(r, [1, 2, 3, 4]).slice(0, L).sort((a, b) => dir * (a - b));
    }
    if (axis === 'squash') st.flip = r.chance(0.5);

    // Board: 3×3, reading-order parameter, hole bottom-right.
    const cells = [];
    for (let p = 0; p < 8; p++) cells.push(frameTile(axis, p, L, st));
    cells.push(null);
    const expected = frameTile(axis, 8, L, st);

    const ds = decoys(axis, st, L, cells, expected, r);
    const answer = r.int(8);
    const options = ds.slice();
    options.splice(answer, 0, expected);

    const tail = '. One space is hollow — choose the frame that seals it.';
    return {
      id: `iq-morph-${axis}-${difficulty}-${seed.toString(36)}`,
      kind: 'matrix',
      difficulty,
      prompt: r.pick(PROMPTS[difficulty <= 2 ? 0 : difficulty <= 4 ? 1 : 2]),
      rule: ruleText(axis, st, L, tail),
      board: { cols: 3, rows: 3, cells, holeIndex: 8 },
      options,
      answer,
    };
  }

  // --- validation ---
  const isLeaf = (c) => !!c && typeof c === 'object'
    && typeof c.shape === 'string'
    && Number.isInteger(c.color) && c.color >= 0 && c.color < 8
    && Number.isInteger(c.rot) && c.rot >= 0 && c.rot < 4;
  const isTile = (t) => !!t && typeof t === 'object'
    && Number.isInteger(t.cols) && t.cols >= 1 && t.cols <= 4
    && Number.isInteger(t.rows) && t.rows >= 1 && t.rows <= 4
    && Array.isArray(t.cells) && t.cells.length === t.cols * t.rows
    && t.cells.every((c) => c === null || isLeaf(c));

  function tileColors(t, acc) {
    for (const c of t.cells) if (c) acc.add(c.color);
    return acc;
  }

  // Detect the frame period L ∈ {3,4} purely from the visible cells.
  function detectPeriod(cells) {
    for (const L of [3, 4]) {
      const frames = cells.slice(0, L);
      let ok = true;
      for (let p = 0; p < cells.length; p++) {
        if (canon(cells[p]) !== canon(frames[p % L])) { ok = false; break; }
      }
      if (!ok) continue;
      if (new Set(frames.map(canon)).size === L) return { L, frames }; // frames must truly differ
    }
    return null;
  }

  function validate(p) {
    const errors = [];
    if (!p || typeof p !== 'object') return { ok: false, errors: ['not an object'] };
    const push = (e) => errors.push(e);
    if (typeof p.id !== 'string' || !p.id.startsWith('iq-morph-')) push('bad id');
    if (p.kind !== 'matrix') push('bad kind: ' + p.kind);
    if (!Number.isInteger(p.difficulty) || p.difficulty < 1 || p.difficulty > 5) push('bad difficulty');
    if (typeof p.prompt !== 'string' || !p.prompt) push('bad prompt');
    if (typeof p.rule !== 'string' || !p.rule) push('bad rule');

    const b = p.board;
    if (!b || typeof b !== 'object' || b.cols !== 3 || b.rows !== 3) push('board must be 3×3');
    else {
      if (!Array.isArray(b.cells) || b.cells.length !== 9) push('board cells length mismatch');
      if (b.holeIndex !== 8) push('hole must be bottom-right (index 8)');
      if (Array.isArray(b.cells)) {
        if (b.cells.filter((c) => c === null).length !== 1) push('board must hold exactly one hole');
        if (b.holeIndex === 8 && b.cells[8] !== null) push('cells[8] must be the hole');
        b.cells.forEach((c, i) => { if (i !== 8 && !isTile(c)) push(`board cell ${i} malformed`); });
      }
    }

    if (!Array.isArray(p.options) || p.options.length !== 8) push('options must hold 8 entries');
    else p.options.forEach((o, i) => { if (!isTile(o)) push(`option ${i} malformed`); });
    if (!Number.isInteger(p.answer) || p.answer < 0 || p.answer > 7) push('bad answer index');

    // --- Rule check: constant color + reading-order periodicity + UNIQUE continuation. ---
    if (!errors.length) {
      const colors = new Set();
      b.cells.forEach((c) => { if (c) tileColors(c, colors); });
      if (colors.size !== 1) push(`color must stay constant, saw ${colors.size}`);

      const vis = b.cells.slice(0, 8);
      const per = detectPeriod(vis);
      if (!per) push('no 3- or 4-frame reading-order period found');
      else {
        const expected = per.frames[8 % per.L];
        const hits = p.options.map((o, i) => ({ o, i })).filter(({ o }) => canon(o) === canon(expected));
        if (hits.length !== 1) push(`rule-uniqueness broken: ${hits.length} options satisfy the continuation`);
        else if (hits[0].i !== p.answer) push(`answer index ${p.answer} is not the unique continuation (index ${hits[0].i})`);
      }
    }
    return { ok: errors.length === 0, errors };
  }

  // Self-test: every generated puzzle validates, the answer is the unique
  // continuation, and generation is deterministic under a fixed seed.
  function selfTest(iterations = 100) {
    const failures = [];
    for (let i = 0; i < iterations; i++) {
      const seed = (0x9E3779B9 ^ (i * 0x85EBCA6B)) >>> 0;
      const difficulty = (i % 5) + 1;
      let pz;
      try { pz = generate({ difficulty, seed }); } catch (e) { failures.push({ i, stage: 'generate', error: String(e) }); continue; }
      const v = validate(pz);
      if (!v.ok) failures.push({ i, stage: 'validate', errors: v.errors, id: pz.id });
      const dup = generate({ difficulty, seed });
      if (canon(dup) !== canon(pz)) failures.push({ i, stage: 'determinism', id: pz.id });
    }
    return { name: 'morph', ok: failures.length === 0, iterations, checked: iterations * 2, failures };
  }

  const GenMorph = { name: 'morph', generate, validate, selfTest };
  root.IQ.Gens2.morph = GenMorph;
  if (typeof module !== 'undefined' && module.exports) module.exports = GenMorph;
  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    console.log(JSON.stringify(selfTest()));
  }
})();
