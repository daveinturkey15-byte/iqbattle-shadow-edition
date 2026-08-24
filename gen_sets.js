/* IQ.Gens2['sets'] — SET-COMPLETION grids for IQ BATTLE.
 * Every row and every column holds EXACTLY ONE of each class:
 *   3x3 (difficulty 1-3): three classes — shapes ARE the classes (3 picked shapes).
 *   4x4 (difficulty 4-5): four style classes mapped to shapes —
 *     solid('plus'), hollow('ring'), square-outline('square'), small('cross').
 * Colors are constant across the board, or per-class (one color per class).
 * The hole is ALWAYS bottom-right; the answer is the one class missing from both
 * its row and its column (rule-uniqueness is checked in validate + self-test).
 * Decoys: every distractor repeats a class already present in the hole's row
 * (a duplicate-class-in-row violation); only their rotation may differ.
 * Same drop-in shape as IQ.Puzzles: {id,kind,difficulty,prompt,rule,board,options[8],answer}. */
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};

  const SHAPES = ['plus', 'ring', 'square', 'triangle', 'diamond', 'cross'];
  // Fixed 4x4 style classes, in spec order.
  const STYLE_CLASSES = [
    { name: 'solid', shape: 'plus' },
    { name: 'hollow', shape: 'ring' },
    { name: 'square-outline', shape: 'square' },
    { name: 'small', shape: 'cross' },
  ];
  const key = (c) => `${c.shape}|${c.color}|${c.rot}`;

  // --- mulberry32 seeded RNG (same recipe as puzzles.js / sibling gens) ---
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
    pick(arr) { return arr[this.int(arr.length)]; }
  }
  function shuffled(r, arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = r.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  const PROMPTS = [
    [ // difficulty 1-2
      'Compliance check: every row, every column — one of each. Complete the set.',
      'The inventory is short exactly one item. The ledger does not forgive gaps.',
      'Each line wants one of everything. Do not disappoint the lines.',
    ],
    [ // difficulty 3
      'The rows hum in sets. The columns answer in kind. One voice is missing.',
      'Balance is mandatory here. The hole in the corner is where it went.',
      'It counted what you owe: one of each, in every row, in every column. PAY.',
    ],
    [ // difficulty 4-5
      'THE SET MUST BE COMPLETE. IT KNOWS WHEN YOU GUESS.',
      'Every row is a mouth wanting one of each. The bottom one opens WIDEST.',
      'There is exactly one piece that fits. It has always been yours. TAKE IT.',
    ],
  ];

  // --- puzzle plan: grid size, class shapes, coloring ---
  // d1-2: 3x3 constant color · d3: 3x3 per-class colors · d4: 4x4 constant · d5: 4x4 per-class.
  function makePlan(r, difficulty) {
    const n = difficulty >= 4 ? 4 : 3;
    let shapes;
    if (n === 4) {
      shapes = STYLE_CLASSES.map((c) => c.shape);
    } else {
      shapes = shuffled(r, SHAPES).slice(0, 3);
    }
    const perClass = difficulty === 3 || difficulty === 5;
    let colors = null;
    if (perClass) {
      const pool = shuffled(r, [0, 1, 2, 3, 4, 5, 6, 7]).slice(0, n);
      colors = new Map(shapes.map((s, i) => [s, pool[i]]));
    }
    const names = new Map(
      n === 4 ? STYLE_CLASSES.map((c) => [c.shape, c.name])
        : shapes.map((s) => [s, s]),
    );
    return { n, shapes, colors, perClass, names };
  }

  // Random Latin square: cyclic base, then shuffle rows, columns, and symbol names.
  // Any row/column/symbol permutation preserves the one-of-each-per-line property.
  function latinClasses(r, plan) {
    const n = plan.n;
    const rowPerm = shuffled(r, [...Array(n).keys()]);
    const colPerm = shuffled(r, [...Array(n).keys()]);
    const symPerm = shuffled(r, plan.shapes);
    const g = [];
    for (let i = 0; i < n; i++) {
      const row = [];
      for (let j = 0; j < n; j++) {
        row.push(symPerm[(rowPerm[i] + colPerm[j]) % n]);
      }
      g.push(row);
    }
    return g;
  }

  function cellAt(plan, shape) {
    return { shape, color: plan.perClass ? plan.colors.get(shape) : plan.color, rot: 0 };
  }

  function ruleText(plan) {
    const list = plan.n === 4
      ? 'solid, hollow ring, square outline, small mark'
      : plan.shapes.join(', ');
    const colorNote = plan.perClass ? ' Each class wears its own color.' : ' The color never changes.';
    return `Set completion — every row and every column holds exactly one of each: ${list}.${colorNote} Rotation does not matter.`;
  }

  function build(difficulty, seed) {
    const r = new Rng(seed);
    const plan = makePlan(r, difficulty);
    plan.color = r.int(8);
    const grid = latinClasses(r, plan);
    const n = plan.n;

    // Hole is ALWAYS bottom-right; the answer is the class missing from row n-1,
    // which the Latin property guarantees equals the class missing from column n-1.
    const hi = n - 1;
    const hj = n - 1;
    const answerShape = grid[hi][hj];
    const correct = cellAt(plan, answerShape);

    const cells = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        cells.push(i === hi && j === hj ? null : cellAt(plan, grid[i][j]));
      }
    }

    // Decoys: any tile of a DIFFERENT class duplicates a class already in the
    // hole's row (and column). Rotation is free flavor; class identity is not.
    const seen = new Set([key(correct)]);
    const pool = [];
    const cand = [];
    for (const shape of plan.shapes) {
      if (shape === answerShape) continue;
      for (let rot = 0; rot < 4; rot++) cand.push({ shape, color: correct.color === undefined ? plan.color ?? 0 : undefined, rot });
    }
    // rebuild candidates through cellAt so per-class colors stay coherent
    cand.length = 0;
    for (const shape of plan.shapes) {
      if (shape === answerShape) continue;
      const base = cellAt(plan, shape);
      for (let rot = 0; rot < 4; rot++) cand.push({ ...base, rot });
    }
    for (const c of shuffled(r, cand)) {
      if (pool.length >= 7) break;
      if (!seen.has(key(c))) { seen.add(key(c)); pool.push(c); }
    }
    if (pool.length < 7) return null; // caller re-seeds

    const options = pool.slice();
    const answer = r.int(8);
    options.splice(answer, 0, correct);

    return {
      id: `iq-sets-matrix-${difficulty}-${seed.toString(36)}`,
      kind: 'matrix',
      difficulty,
      prompt: r.pick(PROMPTS[Math.min(2, Math.floor((difficulty - 1) / 2))]),
      rule: ruleText(plan),
      board: { cols: n, rows: n, cells, holeIndex: n * n - 1 },
      options,
      answer,
    };
  }

  function generate(opts = {}) {
    const difficulty = Math.min(5, Math.max(1, Math.floor(Number(opts.difficulty) || 2)));
    let seed = (opts.seed != null ? Number(opts.seed) : (Date.now() ^ (Math.random() * 0xffffffff))) >>> 0;
    let puz = null;
    for (let tries = 0; tries < 50 && !puz; tries++) {
      puz = build(difficulty, seed);
      if (!puz) seed = (seed + 0x9E3779B9) >>> 0;
    }
    return puz;
  }

  // --- validate: contract + set rule + RULE UNIQUENESS ---
  // Recomputes the completion purely from the visible board: the hole's row and
  // column must each miss exactly one class, both the SAME one, and it must be
  // the answer. Every decoy must violate the set rule (duplicate class in row).
  function validate(p) {
    const errors = [];
    if (!p || typeof p !== 'object') return { ok: false, errors: ['not an object'] };
    const push = (e) => errors.push(e);
    const isCell = (c) => !!c && typeof c === 'object'
      && SHAPES.includes(c.shape)
      && Number.isInteger(c.color) && c.color >= 0 && c.color < 8
      && Number.isInteger(c.rot) && c.rot >= 0 && c.rot < 4;

    if (typeof p.id !== 'string' || !p.id.startsWith('iq-sets-')) push('bad id');
    if (p.kind !== 'matrix') push('bad kind: ' + p.kind);
    if (!Number.isInteger(p.difficulty) || p.difficulty < 1 || p.difficulty > 5) push('bad difficulty');
    if (typeof p.prompt !== 'string' || !p.prompt) push('bad prompt');
    if (typeof p.rule !== 'string' || !p.rule) push('bad rule');

    const b = p.board;
    let n = 0;
    if (!b || typeof b !== 'object') { push('board missing'); return { ok: false, errors }; }
    n = b.cols;
    if (!Number.isInteger(b.cols) || b.cols < 3 || b.cols > 4) push('board cols out of range');
    if (b.rows !== b.cols) push('board must be square');
    if (!Array.isArray(b.cells) || b.cells.length !== b.cols * b.rows) { push('cells mismatch'); return { ok: false, errors }; }
    if (b.holeIndex !== b.cells.length - 1) push('hole must be bottom-right');
    if (b.cells[b.cells.length - 1] !== null) push('bottom-right cell is not the hole');
    if (b.cells.filter((c) => c === null).length !== 1) push('must hold exactly one hole');
    if (!b.cells.every((c) => c === null || isCell(c))) push('malformed cells');
    if (!b.cells.every((c) => c === null || c.rot === 0)) push('board cells must be unrotated');
    if (errors.length) return { ok: false, errors };

    // --- set rule over visible cells ---
    const shapeAt = (i, j) => b.cells[i * n + j] && b.cells[i * n + j].shape;
    const classes = new Set();
    for (const c of b.cells) if (c) classes.add(c.shape);
    let unique = true;
    const want = (line) => (line === n - 1 ? n - 1 : n); // only the hole line misses one
    for (let i = 0; i < n && unique; i++) {
      const row = new Set(); const col = new Set();
      for (let j = 0; j < n; j++) {
        const rs = shapeAt(i, j); if (rs) row.add(rs);
        const cs = shapeAt(j, i); if (cs) col.add(cs);
      }
      if (row.size !== want(i) || col.size !== want(i)) unique = false;
    }
    if (!unique) push('visible rows/columns already contain a duplicate class');

    // --- rule uniqueness: exactly ONE class completes both hole line ---
    if (!Array.isArray(p.options) || p.options.length !== 8) {
      push('options must hold exactly 8 entries');
    } else {
      if (new Set(p.options.map(key)).size !== 8) push('duplicate options');
      if (!Number.isInteger(p.answer) || p.answer < 0 || p.answer > 7) push('bad answer index');
      else {
        const ans = p.options[p.answer];
        if (!isCell(ans)) push('options[answer] is not a valid cell');
        else if (ans.rot !== 0) push('answer cell must be unrotated');
        else {
          const rowMissing = [...classes].filter((s) => {
            for (let j = 0; j < n; j++) if (j !== n - 1 && shapeAt(n - 1, j) === s) return false;
            return true;
          });
          const colMissing = [...classes].filter((s) => {
            for (let i = 0; i < n; i++) if (i !== n - 1 && shapeAt(i, n - 1) === s) return false;
            return true;
          });
          if (classes.size !== n) push(`expected ${n} classes, saw ${classes.size}`);
          if (rowMissing.length !== 1 || colMissing.length !== 1 || rowMissing[0] !== colMissing[0]) {
            push('rule not unique: hole row/column do not agree on one missing class');
          } else if (ans.shape !== rowMissing[0]) {
            push('answer is not the unique completing class');
          }
          p.options.forEach((o, idx) => {
            if (idx !== p.answer && o && o.shape === ans.shape) push('decoy duplicates the answer class (no violation)');
          });
        }
      }
    }
    return { ok: errors.length === 0, errors };
  }

  // --- self-test: 100 puzzles (5 difficulties x 20), independent recomputation ---
  function selfTest(samplesPerDiff = 20) {
    let total = 0; let valid = 0; let dupes = 0; let bad = 0; let answerWrong = 0;
    const slots = new Array(8).fill(0);
    for (let d = 1; d <= 5; d++) {
      for (let s = 0; s < samplesPerDiff; s++) {
        let sd = (d * 7919 + s * 104729) >>> 0;
        let puz = null;
        for (let t = 0; t < 50 && !puz; t++) {
          puz = build(d, sd);
          if (!puz) sd = (sd + 0x9E3779B9) >>> 0;
        }
        total++;
        if (!puz) { bad++; continue; }
        const v = validate(puz);
        if (v.ok) valid++; else { bad++; continue; }
        if (new Set(puz.options.map(key)).size !== 8) dupes++;
        slots[puz.answer]++;
        const b = puz.board; const n = b.cols;
        const shapeAt = (i, j) => b.cells[i * n + j] && b.cells[i * n + j].shape;
        const classes = new Set();
        for (const c of b.cells) if (c) classes.add(c.shape);
        const missing = [...classes].filter((sh) => {
          for (let j = 0; j < n - 1; j++) if (shapeAt(n - 1, j) === sh) return false;
          for (let i = 0; i < n - 1; i++) if (shapeAt(i, n - 1) === sh) return false;
          return true;
        });
        const ans = puz.options[puz.answer];
        if (missing.length !== 1 || ans.shape !== missing[0]) answerWrong++;
        puz.options.forEach((o, idx) => {
          if (idx !== puz.answer && o.shape === ans.shape) bad++;
        });
      }
    }
    const lo = Math.min(...slots); const hiSlot = Math.max(...slots);
    const pass = valid === total && dupes === 0 && bad === 0 && answerWrong === 0;
    return {
      pass,
      line: `GenV sets self-test: ${total} puzzles (5 difficulties x ${samplesPerDiff}, 3x3+4x4 set completion), `
        + `${valid}/${total} valid, ${dupes} duplicate-option sets, ${bad} rule/uniqueness violations, `
        + `${answerWrong} wrong answers, answer slots ${lo}-${hiSlot}/8 — ${pass ? 'PASS' : 'FAIL'}`,
    };
  }

  const api = { name: 'sets', generate, validate, selfTest };
  root.IQ.Gens2 = root.IQ.Gens2 || {};
  root.IQ.Gens2.sets = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
