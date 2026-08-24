/* IQ.Gens2['sets'] — SET-COMPLETION grids for IQ BATTLE.
 * Every row and every column holds EXACTLY ONE of each class:
 *   3x3 (difficulty 1-3): three classes — shapes ARE the classes (3 picked shapes).
 *   4x4 (difficulty 4-5): four style classes mapped to shapes —
 *     solid('plus'), hollow('ring'), square-outline('square'), small('cross').
 * Three modes (live-capture w0-ressets findings):
 *   categorical (d1-3): classic Latin set completion; decoys are WRONG-CLASS
 *     tiles (duplicate-class-in-row violations), rotation-only flavor.
 *   micro (d4-5): hardest rounds use MICRO-VARIANT decoy twins — every decoy
 *     is the SAME class and color as the answer, differing only in parametric
 *     jitter (nested-tile size ±1 step, rotation ±1); the answer alone is the
 *     canonical family member the visible board repeats.
 *   parity (d4-5): class-color binding on a STRICT checkerboard — cell color
 *     = parityColors[(i+j)&1], each class appears only on its bound parity;
 *     decoys are wrong-class twins in hole-parity color plus answer-class
 *     twins in the off-parity color (parity-binding violations).
 * The hole is ALWAYS bottom-right; the answer is the one class missing from
 * both its row and its column (rule-uniqueness checked in validate+self-test).
 * Same drop-in shape as IQ.Puzzles: {id,kind,difficulty,mode,prompt,rule,
 * board,options[8],answer}. Cells gain an OPTIONAL `size` (0-4, default mid)
 * used only by micro mode; engines ignoring it stay compatible. */
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};

  const SHAPES = ['plus', 'ring', 'square', 'triangle', 'diamond', 'cross'];
  const MODES = ['categorical', 'micro', 'parity'];
  // Micro-variant jitter lattice: nested-tile size steps; the family canonical
  // sits at BASE_SIZE/rot 0, decoys jitter ±1 step in size and/or rotation.
  const BASE_SIZE = 2;
  const MIN_SIZE = 0;
  const MAX_SIZE = 4;
  const key = (c) => `${c.shape}|${c.color}|${c.rot}|${c.size == null ? '' : c.size}`;
  const STYLE_CLASSES = [
    { name: 'solid', shape: 'plus' },
    { name: 'hollow', shape: 'ring' },
    { name: 'square-outline', shape: 'square' },
    { name: 'small', shape: 'cross' },
  ];
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
  // --- puzzle plan: grid size, class shapes, coloring, mode ---
  // d1-2: 3x3 constant color · d3: 3x3 per-class colors (categorical).
  // d4-5: 4x4 in micro-variant or checkerboard-parity mode (seeded pick).
  function makePlan(r, difficulty) {
    const n = difficulty >= 4 ? 4 : 3;
    const mode = difficulty >= 4 ? (r.int(2) ? 'micro' : 'parity') : 'categorical';
    let shapes;
    if (n === 4) {
      shapes = STYLE_CLASSES.map((c) => c.shape);
    } else {
      shapes = shuffled(r, SHAPES).slice(0, 3);
    }
    // Per-class colors survive only on d3; micro twins must share one color,
    // and parity mode colors cells positionally, not per class.
    const perClass = difficulty === 3;
    let colors = null;
    if (perClass) {
      const pool = shuffled(r, [0, 1, 2, 3, 4, 5, 6, 7]).slice(0, n);
      colors = new Map(shapes.map((s, i) => [s, pool[i]]));
    }
    let parityColors = null;
    if (mode === 'parity') {
      // Two distinct hues for the strict checkerboard.
      let even = r.int(8);
      let odd = r.int(8);
      while (odd === even) odd = r.int(8);
      parityColors = [even, odd];
      // Slot parity alternates by construction (see buildGrid); order the
      // style classes so slots 0,2 are parity-0 bound and 1,3 parity-1 bound.
      const evens = shuffled(r, shapes.filter((_, i) => i % 2 === 0));
      const odds = shuffled(r, shapes.filter((_, i) => i % 2 === 1));
      shapes = [evens[0], odds[0], evens[1], odds[1]];
    }
    const names = new Map(
      n === 4 ? STYLE_CLASSES.map((c) => [c.shape, c.name])
        : shapes.map((s) => [s, s]),
    );
    return { n, shapes, colors, perClass, names, mode, parityColors };
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

  // Grid builder. Parity mode uses a cyclic Latin square whose symbol slots
  // alternate class-parity, then shuffles rows/columns ONLY within same-parity
  // pairs — that keeps (i+j)&1 predicting the bound class parity exactly.
  function buildGrid(r, plan) {
    const n = plan.n;
    if (plan.mode !== 'parity') return latinClasses(r, plan);
    const rowPerm = [0, 1, 2, 3];
    const colPerm = [0, 1, 2, 3];
    for (const p of [0, 1]) {
      // Swap only same-parity indices: perm[i] must stay ≡ i (mod 2) so the
      // slot formula keeps (rowPerm[i]+colPerm[j])&1 === (i+j)&1.
      if (r.int(2)) [rowPerm[p], rowPerm[p + 2]] = [rowPerm[p + 2], rowPerm[p]];
      if (r.int(2)) [colPerm[p], colPerm[p + 2]] = [colPerm[p + 2], colPerm[p]];
    }
    const g = [];
    for (let i = 0; i < n; i++) {
      const row = [];
      for (let j = 0; j < n; j++) row.push(plan.shapes[(rowPerm[i] + colPerm[j]) % n]);
      g.push(row);
    }
    return g;
  }

  function cellAt(plan, shape, i, j) {
    if (plan.mode === 'parity') {
      // Strict checkerboard: color is a function of position parity alone.
      return { shape, color: plan.parityColors[(i + j) & 1], rot: 0 };
    }
    const c = { shape, color: plan.perClass ? plan.colors.get(shape) : plan.color, rot: 0 };
    if (plan.mode === 'micro') c.size = BASE_SIZE;
    return c;
  }


  function ruleText(plan) {
    const list = plan.n === 4
      ? 'solid, hollow ring, square outline, small mark'
      : plan.shapes.join(', ');
    if (plan.mode === 'micro') {
      return `Set completion — every row and every column holds exactly one of each: ${list}. `
        + 'The family repeats one exact form; its near-twins are off by a hair of size or turn. '
        + 'Take the piece that matches the family perfectly.';
    }
    if (plan.mode === 'parity') {
      return `Checkerboard set completion — every row and column holds one of each: ${list}. `
        + 'Each class is bound to the color of its squares; the hole sits on an even square '
        + 'and only wears the even color.';
    }
    const colorNote = plan.perClass ? ' Each class wears its own color.' : ' The color never changes.';
    return `Set completion — every row and every column holds exactly one of each: ${list}.${colorNote} Rotation does not matter.`;
  }

  function build(difficulty, seed) {
    const r = new Rng(seed);
    const plan = makePlan(r, difficulty);
    plan.color = r.int(8);
    const grid = buildGrid(r, plan);
    const n = plan.n;

    // Hole is ALWAYS bottom-right; the answer is the class missing from row n-1,
    // which the Latin property guarantees equals the class missing from column n-1.
    const hi = n - 1;
    const hj = n - 1;
    const answerShape = grid[hi][hj];
    const correct = cellAt(plan, answerShape, hi, hj);

    const cells = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        cells.push(i === hi && j === hj ? null : cellAt(plan, grid[i][j], i, j));
      }
    }

    // Decoys by mode. Every decoy must violate the set rule:
    //   categorical — wrong class (duplicates a class already in the hole's row).
    //   micro       — near-identical twin of the ANSWER: same class + color,
    //                 jittered off-canonical by size ±1 step and/or rotation ±1.
    //   parity      — wrong class in hole-parity color, or the answer class in
    //                 the off-parity color (class-color binding violation).
    const seen = new Set([key(correct)]);
    const pool = [];
    const cand = [];
    if (plan.mode === 'micro') {
      for (let size = MIN_SIZE; size <= MAX_SIZE; size++) {
        for (let rot = 0; rot < 4; rot++) {
          if (size === BASE_SIZE && rot === 0) continue; // that is the answer
          cand.push({ shape: correct.shape, color: correct.color, rot, size });
        }
      }
    } else if (plan.mode === 'parity') {
      const evenColor = plan.parityColors[0]; // hole sits on an even square
      const oddColor = plan.parityColors[1];
      for (const shape of plan.shapes) {
        if (shape === answerShape) continue;
        for (let rot = 0; rot < 2; rot++) cand.push({ shape, color: evenColor, rot });
      }
      for (let rot = 0; rot < 4; rot++) cand.push({ shape: answerShape, color: oddColor, rot });
    } else {
      for (const shape of plan.shapes) {
        if (shape === answerShape) continue;
        for (let rot = 0; rot < 4; rot++) cand.push({ ...cellAt(plan, shape, hi, hj), rot });
      }
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
      mode: plan.mode,
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
  // the answer. Every decoy must violate the set rule, per mode:
  //   categorical — duplicate class in the hole's row; never the answer's class.
  //   micro       — twin of the answer (same class+color) jittered off-canonical.
  //   parity      — strict checkerboard colors, class-parity binding on the
  //                 board, answer wears hole-parity color; decoys may repeat
  //                 the answer class only in the OFF-parity color.
  function validate(p) {
    const errors = [];
    if (!p || typeof p !== 'object') return { ok: false, errors: ['not an object'] };
    const push = (e) => errors.push(e);
    const isCell = (c) => !!c && typeof c === 'object'
      && SHAPES.includes(c.shape)
      && Number.isInteger(c.color) && c.color >= 0 && c.color < 8
      && Number.isInteger(c.rot) && c.rot >= 0 && c.rot < 4
      && (c.size == null || (Number.isInteger(c.size) && c.size >= MIN_SIZE && c.size <= MAX_SIZE));

    if (typeof p.id !== 'string' || !p.id.startsWith('iq-sets-')) push('bad id');
    if (p.kind !== 'matrix') push('bad kind: ' + p.kind);
    if (!Number.isInteger(p.difficulty) || p.difficulty < 1 || p.difficulty > 5) push('bad difficulty');
    if (!MODES.includes(p.mode)) push('bad mode: ' + p.mode);
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

    // --- mode-specific board invariants ---
    if (p.mode === 'micro') {
      if (!b.cells.every((c) => c === null || c.size === BASE_SIZE)) {
        push('micro board cells must all be the canonical family size');
      }
    } else if (p.mode === 'parity') {
      // Strict checkerboard: one color per (i+j) parity across visible cells.
      let evenColor = null; let oddColor = null; let checker = true;
      b.cells.forEach((c, k) => {
        if (!c) return;
        const par = (Math.floor(k / n) + (k % n)) & 1;
        if (par === 0) { if (evenColor == null) evenColor = c.color; else if (evenColor !== c.color) checker = false; }
        else { if (oddColor == null) oddColor = c.color; else if (oddColor !== c.color) checker = false; }
      });
      if (!checker || evenColor == null || (oddColor != null && evenColor === oddColor)) {
        push('parity board is not a strict two-color checkerboard');
      }
      // Class-color binding: each class appears on exactly one parity.
      const bind = new Map();
      let bound = true;
      b.cells.forEach((c, k) => {
        if (!c) return;
        const par = (Math.floor(k / n) + (k % n)) & 1;
        if (bind.has(c.shape)) { if (bind.get(c.shape) !== par) bound = false; }
        else bind.set(c.shape, par);
      });
      if (!bound) push('parity board violates class-parity binding');
    }

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
            if (idx === p.answer || !o || !isCell(o)) return;
            if (p.mode === 'micro') {
              if (o.shape !== ans.shape || o.color !== ans.color) {
                push('micro decoy is not a twin of the answer class+color');
              } else if (o.rot === ans.rot && o.size === ans.size) {
                push('micro decoy does not jitter off the canonical twin');
              }
            } else if (p.mode === 'parity') {
              if (o.shape === ans.shape && o.color === ans.color) {
                push('parity decoy duplicates the exact answer tile');
              }
            } else if (o.shape === ans.shape) {
              push('decoy duplicates the answer class (no violation)');
            }
          });
          if (p.mode === 'micro' && ans.size !== BASE_SIZE) push('micro answer must be the canonical base-size twin');
          if (p.mode === 'parity') {
            // Answer must wear the hole-parity color: hole (n-1,n-1) has even parity.
            const holeCell = b.cells[0];
            if (holeCell && ans.color !== holeCell.color) push('parity answer does not wear the hole-parity color');
          }
        }
      }
    }
    return { ok: errors.length === 0, errors };
  }

  // --- self-test: 100 puzzles (5 difficulties x 20), independent recomputation ---
  function selfTest(samplesPerDiff = 20) {
    let total = 0; let valid = 0; let dupes = 0; let bad = 0; let answerWrong = 0;
    const slots = new Array(8).fill(0);
    const modeCount = { categorical: 0, micro: 0, parity: 0 };
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
        modeCount[puz.mode] = (modeCount[puz.mode] || 0) + 1;
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
          if (idx === puz.answer) return;
          if (puz.mode === 'micro') {
            // Independent recomputation: decoys are jitter twins of the answer.
            if (!(o.shape === ans.shape && o.color === ans.color
              && (o.rot !== ans.rot || o.size !== ans.size))) bad++;
          } else if (puz.mode === 'parity') {
            if (o.shape === ans.shape && o.color === ans.color) bad++;
          } else if (o.shape === ans.shape) {
            bad++;
          }
        });
      }
    }
    const lo = Math.min(...slots); const hiSlot = Math.max(...slots);
    const modesOk = d4plusCovered(modeCount);
    const pass = valid === total && dupes === 0 && bad === 0 && answerWrong === 0 && modesOk;
    return {
      pass,
      line: `GenV sets self-test: ${total} puzzles (5 difficulties x ${samplesPerDiff}, `
        + `categorical ${modeCount.categorical} / micro ${modeCount.micro} / parity ${modeCount.parity}), `
        + `${valid}/${total} valid, ${dupes} duplicate-option sets, ${bad} rule/uniqueness violations, `
        + `${answerWrong} wrong answers, answer slots ${lo}-${hiSlot}/8 — ${pass ? 'PASS' : 'FAIL'}`,
    };
  }

  // d4-5 must exercise BOTH live-capture modes (micro twins + checkerboard parity).
  function d4plusCovered(modeCount) {
    return modeCount.micro > 0 && modeCount.parity > 0;
  }

  const api = { name: 'sets', generate, validate, selfTest };
  root.IQ.Gens2 = root.IQ.Gens2 || {};
  root.IQ.Gens2.sets = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
