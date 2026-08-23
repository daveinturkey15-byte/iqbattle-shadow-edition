/* IQ.GenV 'dual' — two-axis grid puzzles: a color step along COLUMNS and (difficulty 3+)
 * a second, independent step (another color step OR a 90° clockwise turn) along ROWS.
 * Each axis rule stays trivially visible; the challenge is holding two separable rules
 * at once (the original's hardest style). Every decoy breaks EXACTLY ONE axis.
 * Same drop-in shape as IQ.Puzzles: {id,kind,difficulty,prompt,rule,board|oddBoard,options[8],answer}. */
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};

  const SHAPES = ['plus', 'ring', 'square', 'triangle', 'diamond', 'cross'];
  const KINDS = ['matrix', 'oddone']; // sequence has no second axis — excluded by design

  // --- mulberry32 seeded RNG (same recipe as puzzles.js) ---
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
  const key = (c) => `${c.shape}|${c.color}|${c.rot}`;

  const PROMPTS = [
    'Pattern audit, extended form. Two rules are in effect. Complete the assessment.',
    'The grid moves on two rails. Find where the rails cross the hollow — and seal it.',
    'One of these cells was not invited. It came anyway. Point it out.',
  ];

  // --- axis parameters ---
  // Column axis: ALWAYS a color step kc (wrapping) — visible left-to-right.
  // Row axis (difficulty 3+): ANOTHER color step kr != kc, OR +1 rotation per row.
  function makeParams(r, difficulty) {
    const dual = difficulty >= 3;
    const kc = r.pick([1, 3]); // odd steps => full 8-color period => no wrap duplicates
    let rowMode = null;
    let kr = 0;
    if (dual) {
      rowMode = r.chance(0.5) ? 'color' : 'rot';
      if (rowMode === 'color') kr = kc === 1 ? 3 : 1;
    }
    const sizes = difficulty <= 2 ? [[5, 5]]
      : difficulty === 3 ? [[5, 5], [6, 6]]
        : difficulty === 4 ? [[6, 6], [6, 7], [7, 6]]
          : [[6, 6], [7, 7]];
    const [cols, rows] = r.pick(sizes);
    return {
      dual, kc, kr, rowMode, cols, rows,
      si: r.int(6), co: r.int(8), ro: r.int(4),
    };
  }

  // The one formula every cell obeys. Shape never varies — color/rot carry both axes.
  function cellAt(P, i, j) {
    return {
      shape: SHAPES[P.si],
      color: (P.co + P.kc * j + (P.rowMode === 'color' ? P.kr * i : 0)) % 8,
      rot: P.rowMode === 'rot' ? (P.ro + i) % 4 : P.ro,
    };
  }

  function ruleText(P, kind) {
    let t = `every column steps the color forward by ${P.kc} (wrapping)`;
    if (P.dual) {
      t += P.rowMode === 'color'
        ? `; every row steps the color forward by ${P.kr}`
        : '; every row turns the figure 90 degrees clockwise';
    }
    t += kind === 'matrix'
      ? '. One space is hollow — choose the tile that seals it.'
      : '. Every cell obeys — except one. Find the impostor.';
    return t;
  }

  // --- decoys: break EXACTLY ONE axis ---
  // Col-break candidates satisfy the row rule but sit at a wrong column value.
  // Row-break candidates satisfy the column rule but sit at a wrong row value.
  function axisBreakCells(P, hi, hj) {
    const correct = cellAt(P, hi, hj);
    // Full residue sweep (odd steps => all 8 colors reachable) keeps the families
    // rich enough for 7 unique decoys even on 5x5 boards.
    const colFam = []; // break COLUMN axis only — row component stays intact
    for (let jj = 0; jj < 8; jj++) {
      const c = cellAt(P, hi, jj);
      if (key(c) !== key(correct)) colFam.push(c);
    }
    const rowFam = []; // break ROW axis only — column component stays intact
    if (P.dual) {
      if (P.rowMode === 'rot') {
        for (let rt = 0; rt < 4; rt++) {
          if (rt !== correct.rot) rowFam.push({ shape: SHAPES[P.si], color: correct.color, rot: rt });
        }
      } else {
        for (let ii = 0; ii < 8; ii++) {
          const c = cellAt(P, ii, hj);
          if (key(c) !== key(correct)) rowFam.push(c);
        }
      }
    }
    // A tile matching BOTH family descriptions is ambiguous — drop it from each.
    const rk = new Set(rowFam.map(key));
    const ck = new Set(colFam.map(key));
    return { col: colFam.filter((c) => !rk.has(key(c))), row: rowFam.filter((c) => !ck.has(key(c))) };
  }

  function makeOptions(P, correct, hi, hj, r) {
    const fam = axisBreakCells(P, hi, hj);
    const seen = new Set([key(correct)]);
    const pool = [];
    for (const c of shuffle(r, fam.col.concat(fam.row))) {
      if (pool.length >= 7) break;
      if (!seen.has(key(c))) { seen.add(key(c)); pool.push(c); }
    }
    if (pool.length < 7) return null; // caller re-seeds (rare with odd steps)
    const answer = r.int(8);
    const options = pool.slice();
    options.splice(answer, 0, correct);
    return { options, answer };
  }

  function build(kind, difficulty, seed) {
    const r = new Rng(seed);
    const P = makeParams(r, difficulty);
    const prompt = r.pick(PROMPTS);

    if (kind === 'matrix') {
      const holeIndex = r.int(P.cols * P.rows);
      const hi = Math.floor(holeIndex / P.cols);
      const hj = holeIndex % P.cols;
      const cells = [];
      for (let i = 0; i < P.rows; i++) {
        for (let j = 0; j < P.cols; j++) cells.push(i === hi && j === hj ? null : cellAt(P, i, j));
      }
      const correct = cellAt(P, hi, hj);
      const puz = {
        id: `iq-dual-matrix-${difficulty}-${seed.toString(36)}`,
        kind, difficulty, prompt,
        rule: ruleText(P, kind),
        board: { cols: P.cols, rows: P.rows, cells, holeIndex },
      };
      const opts = makeOptions(P, correct, hi, hj, r);
      if (!opts) return null; // caller re-seeds
      Object.assign(puz, opts);
      return { puz, P, hi, hj };
    }

    // oddone: full grid, one cell corrupted in exactly ONE attribute.
    const oi = r.int(P.rows);
    const oj = r.int(P.cols);
    const cells = [];
    for (let i = 0; i < P.rows; i++) {
      for (let j = 0; j < P.cols; j++) cells.push(cellAt(P, i, j));
    }
    const others = new Set(cells.filter((_, p) => p !== oi * P.cols + oj).map(key));
    const oddIndex = oi * P.cols + oj;
    let impostor = null;
    for (let attempt = 0; attempt < 40 && !impostor; attempt++) {
      const c = { ...cells[oddIndex] };
      const at = r.pick(['shape', 'color', 'rot']);
      if (at === 'shape') c.shape = SHAPES[(SHAPES.indexOf(c.shape) + 1 + r.int(5)) % 6];
      else if (at === 'color') c.color = (c.color + 1 + r.int(7)) % 8;
      else c.rot = (c.rot + 1 + r.int(3)) % 4;
      if (!others.has(key(c))) impostor = c; // must not masquerade as a legal cell elsewhere
    }
    if (!impostor) return null; // caller re-seeds
    cells[oddIndex] = impostor;

    // Decoys for oddone must OBEY the rules (breaking an axis would mint extra impostors).
    // Small boards hold too few DISTINCT law-abiding cells, so draw from the full
    // rule-consistent space: any column-slot color x any valid row rotation.
    const seen = new Set([key(impostor)]);
    const pool = [];
    const cand = [];
    for (let j2 = 0; j2 < Math.max(P.cols, 8); j2++) {
      const color = (P.co + P.kc * j2) % 8;
      if (P.rowMode === 'rot') {
        for (let i2 = 0; i2 < P.rows; i2++) cand.push({ shape: SHAPES[P.si], color, rot: (P.ro + i2) % 4 });
      } else {
        cand.push({ shape: SHAPES[P.si], color, rot: P.ro });
      }
    }
    for (const c of shuffle(r, cand)) {
      if (pool.length >= 7) break;
      if (!seen.has(key(c))) { seen.add(key(c)); pool.push(c); }
    }
    const answer = r.int(8);
    const options = pool.slice();
    options.splice(answer, 0, impostor);

    const puz = {
      id: `iq-dual-oddone-${difficulty}-${seed.toString(36)}`,
      kind, difficulty, prompt,
      rule: ruleText(P, kind),
      oddBoard: { cols: P.cols, rows: P.rows, cells, oddIndex },
      options,
      answer,
    };
    return { puz, P, hi: oi, hj: oj };
  }

  function generate(opts = {}) {
    const difficulty = Math.min(5, Math.max(1, Math.floor(Number(opts.difficulty) || 2)));
    const asked = Array.isArray(opts.kinds) ? opts.kinds.filter((k) => KINDS.includes(k)) : [];
    const kinds = asked.length ? asked : KINDS.slice();
    let seed = (opts.seed != null ? Number(opts.seed) : (Date.now() ^ (Math.random() * 0xffffffff))) >>> 0;
    let built = null;
    for (let tries = 0; tries < 50 && !built; tries++) {
      built = build(kinds[seed % kinds.length], difficulty, seed);
      if (!built) seed = (seed + 0x9E3779B9) >>> 0;
    }
    return built.puz;
  }

  // --- validate: mirrors IQ.Puzzles.validate, boards widened to 5..7 ---
  function validate(p) {
    const errors = [];
    if (!p || typeof p !== 'object') return { ok: false, errors: ['not an object'] };
    const push = (e) => errors.push(e);
    const isCell = (c) => !!c && typeof c === 'object'
      && SHAPES.includes(c.shape)
      && Number.isInteger(c.color) && c.color >= 0 && c.color < 8
      && Number.isInteger(c.rot) && c.rot >= 0 && c.rot < 4;
    const isTile = (t) => !!t && typeof t === 'object'
      && Number.isInteger(t.cols) && t.cols >= 1
      && Number.isInteger(t.rows) && t.rows >= 1
      && Array.isArray(t.cells) && t.cells.length === t.cols * t.rows
      && t.cells.every(isCell);
    if (typeof p.id !== 'string' || !p.id.startsWith('iq-dual-')) push('bad id');
    if (!KINDS.includes(p.kind)) push('bad kind: ' + p.kind);
    if (!Number.isInteger(p.difficulty) || p.difficulty < 1 || p.difficulty > 5) push('bad difficulty');
    if (typeof p.prompt !== 'string' || !p.prompt) push('bad prompt');
    if (typeof p.rule !== 'string' || !p.rule) push('bad rule');
    if (!Array.isArray(p.options) || p.options.length !== 8) {
      push('options must hold exactly 8 entries');
    } else if (new Set(p.options.map(key)).size !== 8) push('duplicate options');
    if (!Array.isArray(p.options) || !Number.isInteger(p.answer) || p.answer < 0 || p.answer > 7) {
      push('bad answer index');
    }
    const checkGrid = (g, label, allowHole) => {
      if (!g || typeof g !== 'object') { push(`${label} missing`); return false; }
      const { cols, rows, cells } = g;
      if (!Number.isInteger(cols) || cols < 5 || cols > 7) push(`${label} cols out of range`);
      if (!Number.isInteger(rows) || rows < 5 || rows > 7) push(`${label} rows out of range`);
      if (!Array.isArray(cells) || cells.length !== cols * rows) { push(`${label} cells mismatch`); return false; }
      if (allowHole) {
        if (cells.filter((c) => c === null).length !== 1) push(`${label} must hold exactly one hole`);
        if (!Number.isInteger(g.holeIndex) || g.holeIndex < 0 || g.holeIndex >= cells.length || cells[g.holeIndex] !== null) {
          push(`${label} holeIndex does not point at the hole`);
        }
        if (!cells.every((c) => c === null || isCell(c))) push(`${label} has malformed cells`);
      } else {
        if (!cells.every(isCell)) push(`${label} must be fully populated`);
        if (!Number.isInteger(g.oddIndex) || g.oddIndex < 0 || g.oddIndex >= cells.length) push(`${label} oddIndex out of range`);
      }
      return true;
    };
    if (p.kind === 'matrix') {
      if (checkGrid(p.board, 'board', true) && Array.isArray(p.options)
        && Number.isInteger(p.answer) && !isTile({ cols: 1, rows: 1, cells: [p.options[p.answer]] })) {
        push('options[answer] is not a valid cell-tile');
      }
    } else if (checkGrid(p.oddBoard, 'oddBoard', false) && Array.isArray(p.options)
      && Number.isInteger(p.answer) && !isCell(p.options[p.answer])) {
      push('options[answer] is not a valid cell');
    }
    return { ok: errors.length === 0, errors };
  }

  // --- self-test ---
  function selfTest(samplesPerDiff = 60) {
    let total = 0; let valid = 0; let dupes = 0; let decoyViolations = 0; let answerWrong = 0;
    const slots = new Array(8).fill(0);
    for (let d = 1; d <= 5; d++) {
      for (let s = 0; s < samplesPerDiff; s++) {
        const kind = (s % 2 === 0) ? 'matrix' : 'oddone';
        let built = null;
        let sd = (d * 7919 + s * 104729) >>> 0;
        for (let t = 0; t < 50 && !built; t++) {
          built = build(kind, d, sd);
          if (!built) sd = (sd + 0x9E3779B9) >>> 0;
        }
        total++;
        if (!built) { decoyViolations++; continue; }
        const { puz, P, hi, hj } = built;
        const v = validate(puz);
        if (v.ok) valid++; else { decoyViolations++; continue; }
        if (new Set(puz.options.map(key)).size !== 8) dupes++;
        slots[puz.answer]++;
        const ruleCell = cellAt(P, hi, hj);
        const impKey = kind === 'oddone' ? key(puz.oddBoard.cells[puz.oddBoard.oddIndex]) : null;
        const expectedKey = kind === 'matrix' ? key(ruleCell) : impKey;
        if (key(puz.options[puz.answer]) !== expectedKey) answerWrong++;
        if (kind === 'matrix') {
          // every decoy breaks EXACTLY one axis: member of exactly one family
          const fam = axisBreakCells(P, hi, hj);
          const colFam = new Set(fam.col.map(key));
          const rowFam = new Set(fam.row.map(key));
          puz.options.forEach((o, idx) => {
            if (idx === puz.answer) return;
            if (colFam.has(key(o)) === rowFam.has(key(o))) decoyViolations++;
          });
        } else {
          // oddone decoys must OBEY the rules and never masquerade as the impostor
          puz.options.forEach((o, idx) => {
            if (idx === puz.answer) return;
            const rotOk = P.rowMode === 'rot' ? true : o.rot === P.ro;
            if (o.shape !== SHAPES[P.si] || !rotOk || key(o) === impKey) decoyViolations++;
          });
          const b = puz.oddBoard;
          if (b.cells.filter((c) => key(c) === impKey).length !== 1) decoyViolations++;
        }
      }
    }
    const lo = Math.min(...slots); const hiSlot = Math.max(...slots);
    const pass = valid === total && dupes === 0 && decoyViolations === 0 && answerWrong === 0;
    return {
      pass,
      line: `GenV dual self-test: ${total} puzzles (5 difficulties x ${samplesPerDiff}, matrix+oddone), `
        + `${valid}/${total} valid, ${dupes} duplicate-option sets, ${decoyViolations} decoy axis violations, `
        + `${answerWrong} wrong answers, answer slots ${lo}-${hiSlot}/8 — ${pass ? 'PASS' : 'FAIL'}`,
    };
  }

  root.IQ.GenV = { name: 'dual', kinds: KINDS, generate, validate, selfTest };
  if (typeof module !== 'undefined') module.exports = root.IQ.GenV;
})();
