/* IQ.GenV2 'morph' — MORPH SEQUENCE puzzles.
 * Every fragment is one animation frame of a SINGLE transformation axis,
 * advanced along reading order; the color never changes. Axes:
 *   scale    — the mark swells/shrinks step by step (nested-tile span 4→1),
 *   rotate   — an elongated twin-dot comet sweeps ~45° per cell (wide, SE-diagonal,
 *              tall, NE-diagonal — the live bbox-aspect oscillation, A1-R3),
 *   position — lit sub-slots of a 3×3 micro-dot lattice climb upward with a
 *              decelerating centroid drift at constant fill (A1-R4),
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
  // Rotation-comet orientations (ResMorph A1-R3): an elongated two-dot comet
  // advanced in ~45° steps — wide, SE-diagonal, tall, NE-diagonal — the discrete
  // analogue of the live bbox-aspect oscillation (0.83 <-> 1.20, period 4).
  // Encoded structurally as nested domino/diagonal tiles; leaf rot stays unused.
  const dot = (color) => leaf('square', color, 0);
  function cometMark(o, color) {
    switch (((o % 4) + 4) % 4) {
      case 0: return mkTile(2, 1, [dot(color), dot(color)]); // wide
      case 1: return mkTile(2, 2, [dot(color), null, null, dot(color)]); // SE diagonal
      case 2: return mkTile(1, 2, [dot(color), dot(color)]); // tall
      default: return mkTile(2, 2, [null, dot(color), dot(color), null]); // NE diagonal
    }
  }
  // Occupancy-lattice paths (ResMorph A1-R4): a 3×3 micro-dot lattice whose lit
  // sub-slots climb upward while the dot count stays fixed — centroid dy
  // -0.75, -0.5, -0.25 mirrors the live decelerating cy drift (.625→.539→.497).
  const OCC_SEQS = {
    3: [[4, 6, 7, 8], [1, 3, 4, 7], [0, 1, 3, 4]],
    4: [[4, 6, 7, 8], [1, 3, 4, 7], [0, 1, 3, 4], [0, 1, 2, 3]],
  };
  const latticeTile = (set, color) => {
    const cells = new Array(9).fill(null);
    for (const i of set) cells[i] = dot(color);
    return mkTile(3, 3, cells);
  };
  const sameSet = (a, b) => a.slice().sort().join() === b.slice().sort().join();
  const reflectRows = (set) => set.map((i) => (2 - Math.floor(i / 3)) * 3 + (i % 3));
  const SQUASH_SEQS = {
    3: [[3, 1], [2, 2], [1, 3]],
    4: [[3, 1], [2, 1], [1, 2], [1, 3]],
  };

  function frameTile(axis, p, L, st) {
    switch (axis) {
      case 'scale': return paddedTile(st.spans[p % L], 0, st.mark);
      case 'rotate': {
        // ~45°-per-cell sweep of the elongated comet, wrapped in a fixed glass frame.
        const o = ((st.dir * p) % 4 + 4) % 4;
        return paddedTile(3, 4, cometMark(o, st.color));
      }
      case 'position':
        // Occupancy shift on the micro-dot lattice — the whole cluster never translates.
        return latticeTile(OCC_SEQS[L][p % L], st.color);
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
      rotate: `the twin-dot comet sweeps ${st.dir > 0 ? 'clockwise' : 'counter-clockwise'}, turning the same amount every frame`,
      position: `the lit cells of its little dot-lattice climb upward, slowing as they rise, then begin afresh`,
      squash: `the frame squeezes steadily from wide to tall`,
    }[axis];
    return head + body + '; the color never changes' + kindTail;
  }

  // Decoys = wrong continuations of the SAME parameter (nearest misses first),
  // then off-rule corruptions (tint / collapsed comet / wrong dot count). Never the truth.
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
      const expO = ((st.dir * 8) % 4 + 4) % 4;
      for (const o of shuffle(r, [0, 1, 2, 3])) {
        if (o !== expO) push(paddedTile(3, 4, cometMark(o, st.color)));
      }
      push(paddedTile(3, 4, singleTile(dot(st.color)))); // right phase, comet collapsed to a lone dot
      let g = 0;
      while (pool.length < want && g++ < 100) {
        push(paddedTile(3, 4, cometMark(r.int(4), (st.color + r.range(1, 7)) % 8))); // tinted comet
      }
    } else if (axis === 'position') {
      const seq = OCC_SEQS[L];
      const expSet = seq[8 % L];
      for (const s of shuffle(r, seq)) if (!sameSet(s, expSet)) push(latticeTile(s, st.color));
      push(latticeTile(reflectRows(expSet), st.color)); // reversal: the drift sinks instead of climbing
      let g = 0;
      while (pool.length < want && g++ < 100) {
        const n = 2 + r.int(4); // wrong dot count breaks the constant-fill occupancy law
        push(latticeTile(shuffle(r, [0, 1, 2, 3, 4, 5, 6, 7, 8]).slice(0, n), st.color));
      }
    } else { // squash
      const cand = [[1, 1], [2, 1], [1, 2], [2, 2], [3, 1], [1, 3]];
      for (const [c, rw] of shuffle(r, cand)) {
        const [ec, er] = [expected.cols, expected.rows];
        if (!(c === ec && rw === er)) push(filledTile(st.flip ? rw : c, st.flip ? c : rw, st.mark));
      }
    }
    // Tier 2 for scale/squash — corrupt the truth itself: tinted / stray rot.
    let guard = 0;
    while (pool.length < want && guard++ < 400) {
      const m = { ...st.mark };
      if (r.chance(0.5)) m.color = (st.color + r.range(1, 7)) % 8;
      else m.rot = (m.rot + r.range(1, 3)) % 4;
      if (axis === 'scale') push(paddedTile(expected.cols, 0, m));
      else {
        const [ec, er] = [expected.cols, expected.rows];
        push(filledTile(ec, er, m));
      }
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
    const st = { color, mark: leaf(r.pick(['square', 'diamond', 'ring']), color, 0), dir: 1, flip: false, spans: [] };
    if (axis === 'rotate') st.dir = difficulty >= 4 && r.chance(0.5) ? -1 : 1;
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
  const isTile = (t, depth) => {
    if (depth == null) depth = 2; // board cell -> nested mark tile -> leaves
    return !!t && typeof t === 'object'
      && Number.isInteger(t.cols) && t.cols >= 1 && t.cols <= 4
      && Number.isInteger(t.rows) && t.rows >= 1 && t.rows <= 4
      && Array.isArray(t.cells) && t.cells.length === t.cols * t.rows
      && t.cells.every((c) => c === null || isLeaf(c) || (depth > 1 && isTile(c, depth - 1)));
  };

  function tileColors(t, acc) {
    for (const c of t.cells) {
      if (!c) continue;
      if (c.cells) tileColors(c, acc);
      else acc.add(c.color);
    }
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
        // Options must be pairwise distinct — a repeated decoy is a grading ambiguity.
        if (new Set(p.options.map(canon)).size !== 8) push('options must be pairwise distinct');
        // Per-axis structural laws (ResMorph): comets stay elongated, lattices hold fill.
        const am = /^iq-morph-([a-z]+)-/.exec(p.id || '');
        const axis = am ? am[1] : '';
        if (axis === 'rotate') {
          const okComet = per.frames.every((f) => {
            const solid = f.cells.filter(Boolean);
            return solid.length === 1 && solid[0].cells && solid[0].cells.filter(Boolean).length === 2;
          });
          if (!okComet) push('rotate frames must each carry one nested two-dot comet');
        } else if (axis === 'position') {
          const cnt = (f) => f.cells.filter(Boolean).length;
          if (!per.frames.every((f) => cnt(f) === cnt(per.frames[0]))) {
            push('lattice frames must keep dot count constant (fill-invariant occupancy)');
          }
        }
      }
    }
    return { ok: errors.length === 0, errors };
  }

  // Self-test: every generated puzzle validates, the answer is the unique
  // continuation, and generation is deterministic under a fixed seed.
  function selfTest(iterations = 100) {
    const failures = [];
    const axesSeen = new Set();
    for (let i = 0; i < iterations; i++) {
      const seed = (0x9E3779B9 ^ (i * 0x85EBCA6B)) >>> 0;
      const difficulty = (i % 5) + 1;
      let pz;
      try { pz = generate({ difficulty, seed }); } catch (e) { failures.push({ i, stage: 'generate', error: String(e) }); continue; }
      axesSeen.add(pz.id.split('-')[2]);
      const v = validate(pz);
      if (!v.ok) failures.push({ i, stage: 'validate', errors: v.errors, id: pz.id });
      const dup = generate({ difficulty, seed });
      if (canon(dup) !== canon(pz)) failures.push({ i, stage: 'determinism', id: pz.id });
    }
    for (const a of AXES) if (!axesSeen.has(a)) failures.push({ stage: 'coverage', missing: a });
    return { name: 'morph', ok: failures.length === 0, iterations, checked: iterations * 2, axes: [...axesSeen], failures };
  }
  const GenMorph = { name: 'morph', generate, validate, selfTest };
  root.IQ.Gens2.morph = GenMorph;
  if (typeof module !== 'undefined' && module.exports) module.exports = GenMorph;
  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    console.log(JSON.stringify(selfTest()));
  }
})();
