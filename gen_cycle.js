/* IQ.GenV 'cycle' — shape repeats through a small ordered cycle along the axis; color never changes. */
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};

  const SHAPES = ['plus', 'ring', 'square', 'triangle', 'diamond', 'cross'];
  const KINDS = ['matrix', 'sequence', 'oddone'];

  const key = (x) => JSON.stringify(x);

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

  const cell = (shape, color) => ({ shape, color, rot: 0 });
  const tile1 = (c) => ({ cols: 1, rows: 1, cells: [{ ...c }] });

  const PROMPTS = [
    [ // difficulty 1-2
      'The shapes take turns in a fixed order. Spot the rotation and complete it.',
      'A tidy little relay: each shape hands off to the next along the line. Fill the gap.',
    ],
    [ // difficulty 3-4
      'The cycle is longer now. Count carefully — the shapes only look disorganized.',
      'Same old rotation, more room to lose your place. Complete the pattern.',
      'Something down there keeps repeating itself. Finish what it started.',
    ],
    [ // difficulty 5
      'THE WHEEL TURNS WHETHER YOU TRACK IT OR NOT. NAME THE NEXT SPOKE.',
      'IT HAS ALWAYS BEEN THE SAME THREE SHAPES, FOREVER, IN ORDER. CHOOSE.',
    ],
  ];

  function cycleLen(d, r) {
    if (d <= 2) return 2;
    if (d <= 3) return r.pick([2, 3]);
    return 3;
  }
  function gridSize(d, r) {
    if (d <= 1) return [4, 4];
    if (d === 2) return r.pick([[4, 4], [4, 5], [5, 4]]);
    return [5, 5];
  }
  function seqLen(d) { return d <= 2 ? 3 : d <= 4 ? 4 : 5; }

  // Decoys: shapes sitting at the WRONG position in the cycle (near-misses),
  // then off-cycle shapes, then tinted/turned variants — never the correct entry.
  // Everything shares the board's constant color until the filler tier.
  function decoyCells(correctShapeIdx, cycIdxs, color, r, need) {
    const seen = new Set();
    const pool = [];
    const push = (c) => {
      const k = key(c);
      if (!seen.has(k)) { seen.add(k); pool.push(c); }
    };
    // Tier 1 — wrong slot in the cycle (the canonical near-miss).
    const wrongSlot = shuffle(r,
      SHAPES.map((_, i) => i)
        .filter((i) => !cycIdxs.includes(i))
        .concat(cycIdxs.filter((i) => i !== correctShapeIdx)));
    for (const si of wrongSlot) push(cell(SHAPES[si], color));
    // Tier 2 — same shape family, shifted hue or turned: still obviously off-pattern.
    let guard = 0;
    while (pool.length < need && guard++ < 400) {
      const si = wrongSlot.length ? r.pick(wrongSlot) : r.pick(SHAPES.map((_, i) => i).filter((i) => i !== correctShapeIdx));
      const c = cell(SHAPES[si], color);
      if (r.chance(0.5)) c.color = (c.color + r.range(1, 7)) % 8;
      else c.rot = r.range(1, 3);
      push(c);
    }
    const shapePool = SHAPES.map((_, i) => i).filter((i) => i !== correctShapeIdx);
    while (pool.length < need) push(cell(SHAPES[r.pick(shapePool)], (color + r.range(1, 7)) % 8));
    return shuffle(r, pool).slice(0, need);
  }

  function makeOptions(correctCell, correctShapeIdx, cycIdxs, color, r, tileMode) {
    const ck = key(correctCell);
    let decoys = decoyCells(correctShapeIdx, cycIdxs, color, r, 8).filter((c) => key(c) !== ck).slice(0, 7);
    if (tileMode) decoys = decoys.map(tile1);
    else decoys = decoys.map((c) => ({ ...c }));
    const answer = r.int(8);
    const options = decoys.slice();
    options.splice(answer, 0, correctCell);
    return { options, answer };
  }

  function generate(opts = {}) {
    const difficulty = Math.min(5, Math.max(1, Math.floor(Number(opts.difficulty) || 2)));
    const asked = Array.isArray(opts.kinds) ? opts.kinds.filter((k) => KINDS.includes(k)) : [];
    const kinds = asked.length ? asked : KINDS.slice();
    const seed = (opts.seed != null ? Number(opts.seed)
      : (Date.now() ^ (Math.random() * 0xffffffff))) >>> 0;
    const r = new Rng(seed);

    const kind = r.pick(kinds);
    const prompt = r.pick(PROMPTS[difficulty <= 2 ? 0 : difficulty <= 4 ? 1 : 2]);

    // The whole puzzle hangs on one cycle + one constant color.
    const L = cycleLen(difficulty, r);
    const cycIdxs = shuffle(r, SHAPES.map((_, i) => i)).slice(0, L);
    const color = r.int(8);
    const shapeAt = (step) => SHAPES[cycIdxs[((step % L) + L) % L]];

    let axisWord;
    if (kind === 'matrix') axisWord = r.pick(['column', 'row']);
    else axisWord = kind === 'sequence' ? 'step' : 'position';

    const ruleText =
      `shapes repeat in the order ${cycIdxs.map((i) => SHAPES[i]).join(' → ')} along each ${axisWord}` +
      '; the color never changes' +
      (kind === 'matrix'
        ? '. One space is hollow — choose the tile that seals it.'
        : kind === 'sequence'
          ? '. Choose what comes next.'
          : '. Every cell obeys — except one. Find the impostor.');

    const puz = {
      id: `iq-cycle-${kind}-${difficulty}-${seed.toString(36)}`,
      kind,
      difficulty,
      prompt,
      rule: ruleText,
    };

    if (kind === 'matrix') {
      const [cols, rows] = gridSize(difficulty, r);
      const stepOf = axisWord === 'column'
        ? (i, j) => j // down each column
        : (i, j) => i; // across each row
      const holeIndex = r.int(cols * rows);
      const hi = Math.floor(holeIndex / cols);
      const hj = holeIndex % cols;
      const cells = [];
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          cells.push(i === hi && j === hj ? null : cell(shapeAt(stepOf(i, j)), color));
        }
      }
      const step = stepOf(hi, hj);
      const correct = cell(shapeAt(step), color);
      puz.board = { cols, rows, cells, holeIndex };
      Object.assign(puz, makeOptions(tile1(correct), cycIdxs[step % L], cycIdxs, color, r, true));
    } else if (kind === 'sequence') {
      const len = seqLen(difficulty);
      const seq = [];
      for (let p = 0; p < len; p++) seq.push(cell(shapeAt(p), color));
      puz.seq = seq;
      const nextIdx = cycIdxs[len % L];
      Object.assign(puz, makeOptions(cell(SHAPES[nextIdx], color), nextIdx, cycIdxs, color, r));
    } else {
      const [cols, rows] = gridSize(Math.max(2, difficulty), r);
      const n = cols * rows;
      const stepOf = axisWord === 'column'
        ? (idx) => idx % cols
        : (idx) => Math.floor(idx / cols);
      const oddIndex = r.int(n);
      const cells = [];
      for (let p = 0; p < n; p++) cells.push(cell(shapeAt(stepOf(p)), color));
      // Impostor: a shape from the WRONG slot in the cycle (never the expected one).
      const expected = cycIdxs[stepOf(oddIndex) % L];
      const wrongPool = SHAPES.map((_, i) => i).filter((i) => i !== expected);
      cells[oddIndex] = cell(SHAPES[r.pick(wrongPool)], color);
      puz.oddBoard = { cols, rows, cells, oddIndex };
      Object.assign(puz, makeOptions({ ...cells[oddIndex] }, -1, cycIdxs, color, r));
    }
    return puz;
  }

  function validate(p) {
    const errors = [];
    if (!p || typeof p !== 'object') return { ok: false, errors: ['not an object'] };
    const push = (e) => errors.push(e);
    if (typeof p.id !== 'string' || !p.id) push('bad id');
    if (!KINDS.includes(p.kind)) push('bad kind: ' + p.kind);
    if (!Number.isInteger(p.difficulty) || p.difficulty < 1 || p.difficulty > 5) push('bad difficulty');
    if (typeof p.prompt !== 'string' || !p.prompt) push('bad prompt');
    if (typeof p.rule !== 'string' || !p.rule) push('bad rule');

    const isCell = (c) => !!c && typeof c === 'object'
      && SHAPES.includes(c.shape)
      && Number.isInteger(c.color) && c.color >= 0 && c.color < 8
      && Number.isInteger(c.rot) && c.rot >= 0 && c.rot < 4;
    const isTile = (t) => !!t && typeof t === 'object'
      && Number.isInteger(t.cols) && t.cols >= 1
      && Number.isInteger(t.rows) && t.rows >= 1
      && Array.isArray(t.cells) && t.cells.length === t.cols * t.rows
      && t.cells.every(isCell);

    if (!Array.isArray(p.options) || p.options.length !== 8) {
      push('options must hold exactly 8 entries');
    } else {
      if (new Set(p.options.map(key)).size !== 8) push('duplicate options');
      const checker = p.kind === 'matrix' ? isTile : isCell;
      p.options.forEach((o, i) => { if (!checker(o)) push(`option ${i} malformed`); });
    }
    if (!Number.isInteger(p.answer) || p.answer < 0 || p.answer > 7) push('bad answer index');

    const checkGrid = (g, label, allowHole) => {
      if (!g || typeof g !== 'object') { push(`${label} missing`); return false; }
      const { cols, rows, cells } = g;
      if (!Number.isInteger(cols) || cols < 3 || cols > 5) push(`${label} cols out of range`);
      if (!Number.isInteger(rows) || rows < 3 || rows > 5) push(`${label} rows out of range`);
      if (!Array.isArray(cells)) { push(`${label} cells missing`); return false; }
      if (Number.isInteger(cols) && Number.isInteger(rows) && cells.length !== cols * rows) {
        push(`${label} cells length mismatch`);
      }
      if (!cells.every((c) => c === null || isCell(c))) push(`${label} has malformed cells`);
      if (allowHole) {
        const holes = cells.filter((c) => c === null).length;
        if (holes !== 1) push(`${label} must hold exactly one hole`);
        if (!Number.isInteger(g.holeIndex) || g.holeIndex < 0 || g.holeIndex >= cells.length) {
          push(`${label} holeIndex out of range`);
        } else if (cells[g.holeIndex] !== null) push(`${label} holeIndex does not point at the hole`);
      } else {
        if (!cells.every(isCell)) push(`${label} must be fully populated`);
        if (!Number.isInteger(g.oddIndex) || g.oddIndex < 0 || g.oddIndex >= cells.length) {
          push(`${label} oddIndex out of range`);
        }
      }
      return true;
    };

    if (p.kind === 'matrix') {
      if (checkGrid(p.board, 'board', true) && Array.isArray(p.options)
        && Number.isInteger(p.answer) && !isTile(p.options[p.answer])) {
        push('options[answer] is not a valid tile');
      }
    } else if (p.kind === 'sequence') {
      if (!Array.isArray(p.seq) || p.seq.length < 3 || p.seq.length > 5) push('seq length out of range');
      else if (!p.seq.every(isCell)) push('seq holds malformed cells');
      if (Array.isArray(p.options) && Number.isInteger(p.answer) && !isCell(p.options[p.answer])) {
        push('options[answer] is not a valid cell');
      }
    } else if (p.kind === 'oddone') {
      if (checkGrid(p.oddBoard, 'oddBoard', false) && Array.isArray(p.options)
        && Number.isInteger(p.answer) && !isCell(p.options[p.answer])) {
        push('options[answer] is not a valid cell');
      }
    }
    return { ok: errors.length === 0, errors };
  }

  function explain(p) {
    return p && typeof p.rule === 'string' ? p.rule : '';
  }

  // Self-test: every generated puzzle validates, the answer matches an
  // independently recomputed cycle, and no decoy equals the solution.
  function selfTest(iterations = 300) {
    const errors = [];
    for (let s = 0; s < iterations; s++) {
      const seed = (0xC9C1E + s * 7919) % 0xffffffff;
      for (const kind of KINDS) {
        for (const d of [1, 2, 3, 4, 5]) {
          const p = generate({ seed, kind, difficulty: d });
          const v = validate(p);
          if (!v.ok) { errors.push(`seed ${seed} ${kind} d${d}: ${v.errors.join('; ')}`); continue; }
          if (p.kind === 'matrix') {
            // Recompute the expected cell at the hole from the rule text's cycle.
            const m = /order ([a-z]+(?: → [a-z]+)+) along each (column|row)/.exec(p.rule);
            if (!m) { errors.push(`seed ${seed}: unparsable rule`); continue; }
            const cyc = m[1].split(' → ');
            const { cols, rows, cells, holeIndex } = p.board;
            const step = m[2] === 'column' ? holeIndex % cols : Math.floor(holeIndex / cols);
            const expectShape = cyc[((step % cyc.length) + cyc.length) % cyc.length];
            if (p.options[p.answer].cells[0].shape !== expectShape) {
              errors.push(`seed ${seed} matrix d${d}: answer violates cycle`);
            }
          } else if (p.kind === 'sequence') {
            const m = /order ([a-z]+(?: → [a-z]+)+) along/.exec(p.rule);
            const cyc = m[1].split(' → ');
            const expectShape = cyc[p.seq.length % cyc.length];
            if (p.options[p.answer].shape !== expectShape) {
              errors.push(`seed ${seed} sequence d${d}: answer violates cycle`);
            }
          } else {
            const { cols, cells, oddIndex } = p.oddBoard;
            const colPattern = new Set(cells.map((c) => c.shape));
            // Odd-one answer must differ from its own axis-neighbors' expectation:
            // simply confirm the impostor exists (board holds exactly 2 shapes when L=2,
            // or the odd cell mismatches its column/row majority).
            const rowMates = cells.filter((_, i) => Math.floor(i / cols) === Math.floor(oddIndex / cols) && i !== oddIndex);
            const colMates = cells.filter((_, i) => i % cols === oddIndex % cols && i !== oddIndex);
            const odd = cells[oddIndex];
            const matchesRow = rowMates.every((c) => c.shape === odd.shape);
            const matchesCol = colMates.every((c) => c.shape === odd.shape);
            if (matchesRow || matchesCol) {
              errors.push(`seed ${seed} oddone d${d}: impostor not detectable along axis`);
            }
            void colPattern;
          }
        }
      }
    }
    return { ok: errors.length === 0, checked: iterations * KINDS.length * 5, errors: errors.slice(0, 10) };
  }

  const GenV = { name: 'cycle', generate, validate, explain, selfTest };
  root.IQ.GenV = GenV;
  if (typeof module !== 'undefined') module.exports = GenV;
  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    console.log(JSON.stringify(selfTest()));
  }
})();
