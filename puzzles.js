/* IQ.Puzzles — deterministic abstract-reasoning puzzle generator for IQ BATTLE. */
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};

  const SHAPES = ['plus', 'ring', 'square', 'triangle', 'diamond', 'cross'];
  const KINDS = ['matrix', 'sequence', 'oddone'];
  const RULE_NAMES = ['colorRotation', 'shapeProgression', 'countRule', 'xorOverlay', 'rotationRule'];
  // Exact-fit tile dimensions (cols,rows) for mark counts 1..5.
  const DIMS = [[1, 1], [2, 1], [3, 1], [2, 2], [5, 1]];

  const key = (x) => JSON.stringify(x);

  // --- mulberry32 seeded RNG ---
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
  function pickDiff(r, v, lo, hi) {
    let x;
    do { x = r.range(lo, hi); } while (x === v);
    return x;
  }

  // --- rules: each mutates attrs {si,co,ro} by `step` along its axis ---
  const RULES = {
    colorRotation: {
      kinds: KINDS,
      init: (r) => ({ k: r.range(1, 3) }),
      apply: (a, step, st) => { a.co += st.k * step; },
      desc: (st, ax) => `color shifts +${st.k} (wrapping) along each ${ax}`,
    },
    shapeProgression: {
      kinds: KINDS,
      init: (r) => ({ dir: r.chance(0.5) ? 1 : -1 }),
      apply: (a, step, st) => { a.si += st.dir * step; },
      desc: (st, ax) => `shapes march ${st.dir > 0 ? 'forward' : 'backward'} through the cycle along each ${ax}`,
    },
    rotationRule: {
      kinds: KINDS,
      init: () => ({}),
      apply: (a, step) => { a.ro += step; },
      desc: (st, ax) => `every ${ax} turns the figure 90 degrees clockwise`,
    },
    // Matrix-only: mark count grows per step; rot on the board echoes the count.
    countRule: {
      kinds: ['matrix'],
      init: () => ({ base: 1 }),
      apply: (a, step, st) => { a.ro = st.base + step - 1; },
      desc: (st, ax) => `the marks multiply — one more with each ${ax}`,
    },
    xorOverlay: {
      kinds: KINDS,
      init: (r) => ({ cm: r.pick([1, 2, 3, 5]), rm: r.pick([1, 2, 3]) }),
      apply: (a, step, st) => { a.co ^= (st.cm * step) & 7; a.ro ^= (st.rm * step) & 3; },
      desc: (st, ax) => `two hidden layers — a color mask and a turning mask — overlap to bind each ${ax}`,
    },
  };

  const PROMPTS = [
    [ // difficulty 1-2: clean corporate menace
      'Quarterly pattern audit. Complete the assessment. Your result will be filed, permanently.',
      'A routine evaluation. The previous candidate also hesitated here. We no longer speak of them.',
      'Select the missing piece. Compliance is its own reward. Noncompliance has other rewards.',
    ],
    [ // difficulty 3-4: corrupted
      'The pattern is watching you solve it. Try not to disappoint it.',
      'Something beneath the grid is smiling. Choose the tile. Choose carefully.',
      'These rules were written by something that is still here. Complete the sequence.',
      'The hole in this grid goes deeper than it looks. Seal it.',
    ],
    [ // difficulty 5: full hell
      'THE GRID IS A MOUTH. FEED IT THE CORRECT SHAPE.',
      'There was never a missing tile. There was only ever the hole. CHOOSE.',
      'IT WEARS YOUR REFLECTION NOW. ANSWER, AND PERHAPS IT GIVES IT BACK.',
    ],
  ];

  function pickRules(kind, difficulty, r) {
    const pool = RULE_NAMES.filter((n) => RULES[n].kinds.includes(kind));
    if (difficulty <= 2 || pool.length === 1) return [r.pick(pool)];
    for (;;) {
      const a = r.pick(pool);
      const b = r.pick(pool);
      if (a === b) continue;
      // countRule echoes count via rot; never pair with rules that also steer rot.
      const bad = (a === 'countRule' && (b === 'rotationRule' || b === 'xorOverlay')) ||
        (b === 'countRule' && (a === 'rotationRule' || a === 'xorOverlay'));
      if (bad) continue;
      return [a, b];
    }
  }

  function attrsAt(base, rules, states, steps) {
    const a = { si: base.si, co: base.co, ro: base.ro };
    for (let i = 0; i < rules.length; i++) rules[i].apply(a, steps[i], states[i]);
    return {
      shape: SHAPES[((a.si % 6) + 6) % 6],
      color: ((a.co % 8) + 8) % 8,
      rot: ((a.ro % 4) + 4) % 4,
    };
  }

  function countTile(cell, cnt) {
    const [cols, rows] = DIMS[cnt - 1];
    const cells = [];
    for (let i = 0; i < cnt; i++) cells.push({ shape: cell.shape, color: cell.color, rot: cell.rot });
    return { cols, rows, cnt, cells };
  }

  function mutateCell(c, r, nAttrs) {
    const out = { shape: c.shape, color: c.color, rot: c.rot };
    const attrs = shuffle(r, ['shape', 'color', 'rot']).slice(0, nAttrs);
    for (const at of attrs) {
      if (at === 'shape') out.shape = r.pick(shuffle(r, SHAPES).filter((s) => s !== out.shape));
      else if (at === 'color') out.color = pickDiff(r, out.color, 0, 7);
      else out.rot = pickDiff(r, out.rot, 0, 3);
    }
    return out;
  }

  function mutateTile(tile, r, hard) {
    const cnt = tile.cnt | 0;
    if (cnt && r.chance(hard ? 0.5 : 0.45)) return countTile(tile.cells[0], pickDiff(r, cnt, 1, 5));
    const nAttrs = hard ? (r.chance(0.5) ? 2 : 3) : 1;
    const cell = mutateCell(tile.cells[0], r, nAttrs);
    if (!cnt) return { cols: 1, rows: 1, cells: [cell] };
    const cells = [];
    for (let i = 0; i < tile.cells.length; i++) cells.push({ ...cell });
    return { cols: tile.cols, rows: tile.rows, cnt, cells };
  }

  // 7 unique distractors (1-2 near-misses, rest harder) + correct inserted at a uniform slot.
  function makeOptions(correct, r, tileMode) {
    const seen = new Set([key(correct)]);
    const pool = [];
    const near = 1 + (r.chance(0.5) ? 1 : 0);
    let guard = 0;
    while (pool.length < 7 && guard++ < 400) {
      const hard = pool.length >= near;
      const c = tileMode ? mutateTile(correct, r, hard)
        : mutateCell(correct, r, hard ? (r.chance(0.5) ? 2 : 3) : 1);
      const k = key(c);
      if (!seen.has(k)) { seen.add(k); pool.push(c); }
    }
    while (pool.length < 7) { // paranoia fill; mutation space is vast
      const c = tileMode ? mutateTile(correct, r, true) : mutateCell(correct, r, 2);
      const k = key(c);
      if (!seen.has(k)) { seen.add(k); pool.push(c); }
    }
    const answer = r.int(8);
    const options = pool.slice();
    options.splice(answer, 0, correct);
    return { options, answer };
  }

  function matrixSize(d, r) {
    if (d <= 1) return [3, 3];
    if (d === 2) return r.pick([[3, 3], [3, 4], [4, 3]]);
    if (d === 3) return [4, 4];
    if (d === 4) return r.pick([[4, 4], [4, 5], [5, 4]]);
    return [5, 5];
  }
  function oddSize(d) { return d <= 2 ? [3, 3] : d <= 4 ? [4, 4] : [5, 5]; }

  function generate(opts = {}) {
    const difficulty = Math.min(5, Math.max(1, Math.floor(Number(opts.difficulty) || 2)));
    const asked = Array.isArray(opts.kinds) ? opts.kinds.filter((k) => KINDS.includes(k)) : [];
    const kinds = asked.length ? asked : KINDS.slice();
    const seed = (opts.seed != null ? Number(opts.seed)
      : (Date.now() ^ (Math.random() * 0xffffffff))) >>> 0;
    const r = new Rng(seed);
    const kind = r.pick(kinds);
    const prompt = r.pick(PROMPTS[difficulty <= 2 ? 0 : difficulty <= 4 ? 1 : 2]);

    const base = { si: r.int(6), co: r.int(8), ro: r.int(4) };
    const names = pickRules(kind, difficulty, r);
    const rules = names.map((n) => RULES[n]);
    const states = rules.map((ru) => ru.init(r));

    let axisWords;
    if (kind === 'matrix') axisWords = rules.length === 2 ? ['column', 'row'] : [r.pick(['column', 'row'])];
    else axisWords = rules.map(() => (kind === 'sequence' ? 'step' : 'position'));
    const stepFor = (ri, i, j) => (kind === 'matrix' ? (axisWords[ri] === 'column' ? j : i) : i);

    const ruleText = names.map((n, ri) => RULES[n].desc(states[ri], axisWords[ri])).join('; ') +
      (kind === 'matrix'
        ? '. One space is hollow — choose the tile that seals it.'
        : kind === 'sequence'
          ? '. Choose what comes next.'
          : '. Every cell obeys — except one. Find the impostor.');

    const puz = {
      id: `iq-${kind}-${difficulty}-${seed.toString(36)}`,
      kind,
      difficulty,
      prompt,
      rule: ruleText,
    };

    if (kind === 'matrix') {
      const [cols, rows] = matrixSize(difficulty, r);
      const holeIndex = r.int(cols * rows);
      const hi = Math.floor(holeIndex / cols);
      const hj = holeIndex % cols;
      const cells = [];
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          cells.push(i === hi && j === hj
            ? null
            : attrsAt(base, rules, states, rules.map((_, ri) => stepFor(ri, i, j))));
        }
      }
      const ci = names.indexOf('countRule');
      const holeCell = attrsAt(base, rules, states, rules.map((_, ri) => stepFor(ri, hi, hj)));
      const correct = ci >= 0
        ? countTile(holeCell, Math.min(5, states[ci].base + stepFor(ci, hi, hj)))
        : { cols: 1, rows: 1, cells: [holeCell] };
      puz.board = { cols, rows, cells, holeIndex };
      Object.assign(puz, makeOptions(correct, r, true));
    } else if (kind === 'sequence') {
      const len = difficulty <= 2 ? 3 : difficulty <= 4 ? 4 : 5;
      const at = (p) => attrsAt(base, rules, states, rules.map(() => p));
      const seq = [];
      for (let p = 0; p < len; p++) seq.push(at(p));
      puz.seq = seq;
      Object.assign(puz, makeOptions(at(len), r, false));
    } else {
      const [cols, rows] = oddSize(difficulty);
      const n = cols * rows;
      const oddIndex = r.int(n);
      const at = (p) => attrsAt(base, rules, states, rules.map(() => p));
      const cells = [];
      for (let p = 0; p < n; p++) cells.push(at(p));
      cells[oddIndex] = mutateCell(cells[oddIndex], r, 1);
      puz.oddBoard = { cols, rows, cells, oddIndex };
      Object.assign(puz, makeOptions(cells[oddIndex], r, false));
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
      const { cols, rows, cells, holeIndex } = g;
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
        if (!Number.isInteger(holeIndex) || holeIndex < 0 || holeIndex >= cells.length) {
          push(`${label} holeIndex out of range`);
        } else if (cells[holeIndex] !== null) push(`${label} holeIndex does not point at the hole`);
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

  root.IQ.Puzzles = { generate, validate, explain };
  if (typeof module !== 'undefined') module.exports = root.IQ.Puzzles;
})();
