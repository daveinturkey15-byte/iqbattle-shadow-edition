/* IQ.GenV['latin'] — iqversus-faithful color-latin grids for IQ BATTLE.
   One shape type per puzzle; exactly ONE attribute (color) varies, stepping by a
   constant k (mod 8) along every column (or every row). One punched hole.
   Options: the rule-satisfying tile + 7 decoys that each violate the color step. */
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};

  const SHAPES = ['plus', 'ring', 'square', 'triangle', 'diamond', 'cross'];
  const key = (x) => JSON.stringify(x);

  // --- mulberry32 seeded RNG (same flavor as puzzles.js) ---
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
    chance(p) { return this.next() < p; }
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
      'Quarterly palette audit. Complete the assessment.',
      'A routine evaluation. The colors know the way. Follow them.',
      'Select the missing piece. Compliance is its own reward.',
    ],
    [ // difficulty 3-4
      'The pattern is watching you solve it. Choose carefully.',
      'Every column hums the same tune. One note is missing.',
      'The hole in this grid goes deeper than it looks. Seal it.',
    ],
    [ // difficulty 5
      'THE GRID IS A MOUTH. FEED IT THE CORRECT SHAPE.',
      'IT WEARS YOUR REFLECTION NOW. ANSWER, AND PERHAPS IT GIVES IT BACK.',
      'There was never a missing tile. There was only ever the hole. CHOOSE.',
    ],
  ];

  const mod8 = (x) => ((x % 8) + 8) % 8;

  // Colors of every cell if the grid were whole: start[l] + k*pos along the axis.
  function makeCells(r, n, axis, k, hi, hj) {
    const starts = [];
    for (let l = 0; l < n; l++) starts.push(r.int(8));
    const cells = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === hi && j === hj) { cells.push(null); continue; }
        const line = axis === 'column' ? j : i;
        const pos = axis === 'column' ? i : j;
        cells.push({ color: mod8(starts[line] + k * pos), shape: null, rot: 0 });
      }
    }
    return { cells, starts };
  }

  // All hole colors compatible with SOME constant-step rule the visible cells support.
  // Scans both axes and every step k in 0..7 against all known gaps.
  function acceptableHoleColors(cells, n, hi, hj) {
    const at = (i, j) => cells[i * n + j];
    const accepted = new Set();
    for (const axis of ['column', 'row']) {
      for (let k = 0; k < 8; k++) {
        let ok = true;
        for (let line = 0; line < n && ok; line++) {
          let lastPos = null;
          let lastColor = null;
          for (let pos = 0; pos < n; pos++) {
            const c = axis === 'column' ? at(pos, line) : at(line, pos);
            if (!c) continue;
            if (lastPos !== null && mod8(c.color - lastColor - k * (pos - lastPos)) !== 0) { ok = false; break; }
            lastPos = pos; lastColor = c.color;
          }
        }
        if (!ok) continue;
        // Extrapolate the hole from its nearest known neighbor on this line.
        let expected = null;
        let bestDist = Infinity;
        for (let pos = 0; pos < n; pos++) {
          const c = axis === 'column' ? at(pos, hj) : at(hi, pos);
          if (!c) continue;
          const dist = Math.abs(pos - (axis === 'column' ? hi : hj));
          if (dist < bestDist) { bestDist = dist; expected = mod8(c.color + k * dist * (pos > (axis === 'column' ? hi : hj) ? -1 : 1)); }
        }
        if (expected !== null) accepted.add(expected);
      }
    }
    return [...accepted];
  }

  const tile = (cell) => ({ cols: 1, rows: 1, cells: [{ shape: cell.shape, color: cell.color, rot: cell.rot }] });

  function generate(difficulty, seed) {
    difficulty = Math.min(5, Math.max(1, Math.floor(Number(difficulty) || 2)));
    seed = (seed != null ? Number(seed) : (Date.now() ^ (Math.random() * 0xffffffff))) >>> 0;
    const r = new Rng(seed);

    const n = [4, 4, 5, 6, 7][difficulty - 1]; // 4x4 (d1) .. 7x7 (d5)
    const shape = r.chance(0.7) ? 'plus' : (r.chance(0.5) ? 'ring' : 'square');

    let axis, k, hi, hj, cells, expected;
    for (;;) { // retry until the visible grid pins exactly one rule (near-always first try)
      axis = r.chance(0.5) ? 'column' : 'row';
      k = 1 + r.int(7);
      hi = r.int(n);
      hj = r.int(n);
      const built = makeCells(r, n, axis, k, hi, hj);
      cells = built.cells.map((c) => (c ? { shape, color: c.color, rot: 0 } : null));
      const accepted = acceptableHoleColors(cells, n, hi, hj);
      if (accepted.length === 1) { expected = accepted[0]; break; }
    }

    const decoyColors = shuffled(r, [0, 1, 2, 3, 4, 5, 6, 7].filter((v) => v !== expected)).slice(0, 7);
    const pool = decoyColors.map((v) => tile({ shape, color: v, rot: 0 }));
    const answer = r.int(8);
    const options = pool.slice();
    options.splice(answer, 0, tile({ shape, color: expected, rot: 0 }));

    return {
      id: `latin-matrix-${difficulty}-${seed.toString(36)}`,
      kind: 'matrix',
      difficulty,
      prompt: PROMPTS[difficulty <= 2 ? 0 : difficulty <= 4 ? 1 : 2][r.int(3)],
      rule: `One shape only. Its color steps by a constant amount (wrapping around the palette) along each ${axis}. One space is hollow — choose the tile that seals it.`,
      board: { cols: n, rows: n, cells, holeIndex: hi * n + hj },
      options,
      answer,
    };
  }

  function validate(p) {
    const errors = [];
    if (!p || typeof p !== 'object') return { ok: false, errors: ['not an object'] };
    const push = (e) => errors.push(e);

    if (typeof p.id !== 'string' || !p.id) push('bad id');
    if (p.kind !== 'matrix') push(`bad kind: ${p.kind}`);
    if (!Number.isInteger(p.difficulty) || p.difficulty < 1 || p.difficulty > 5) push('bad difficulty');
    if (typeof p.prompt !== 'string' || !p.prompt) push('bad prompt');
    if (typeof p.rule !== 'string' || !p.rule) push('bad rule');

    const isCell = (c) => !!c && typeof c === 'object'
      && SHAPES.includes(c.shape)
      && Number.isInteger(c.color) && c.color >= 0 && c.color < 8
      && Number.isInteger(c.rot) && c.rot >= 0 && c.rot < 4;

    let board = null;
    if (!p.board || typeof p.board !== 'object') push('board missing');
    else {
      board = p.board;
      const { cols, rows, cells, holeIndex } = board;
      if (!Number.isInteger(cols) || cols < 4 || cols > 7) push(`board cols out of range: ${cols}`);
      if (cols !== rows) push('board not square');
      if (!Array.isArray(cells)) push('board cells missing');
      else {
        if (Number.isInteger(cols) && cells.length !== cols * cols) push('board cells length mismatch');
        if (!cells.every((c) => c === null || isCell(c))) push('board has malformed cells');
        const holes = cells.filter((c) => c === null).length;
        if (holes !== 1) push('board must hold exactly one hole');
        if (!Number.isInteger(holeIndex) || holeIndex < 0 || holeIndex >= cells.length) push('holeIndex out of range');
        else if (cells[holeIndex] !== null) push('holeIndex does not point at the hole');
        // ONE shape type per puzzle, rot frozen: every visible cell shares shape and rot.
        const visible = cells.filter(Boolean);
        if (visible.length) {
          if (new Set(visible.map((c) => c.shape)).size !== 1) push('more than one shape type on the board');
          if (new Set(visible.map((c) => c.rot)).size !== 1) push('rot varies — only color may vary');
        }
      }
    }

    const isTile = (t) => !!t && typeof t === 'object'
      && t.cols === 1 && t.rows === 1
      && Array.isArray(t.cells) && t.cells.length === 1 && isCell(t.cells[0]);

    if (!Array.isArray(p.options) || p.options.length !== 8) {
      push('options must hold exactly 8 entries');
    } else {
      if (new Set(p.options.map(key)).size !== 8) push('duplicate options');
      p.options.forEach((o, i) => { if (!isTile(o)) push(`option ${i} malformed`); });
    }
    if (!Number.isInteger(p.answer) || p.answer < 0 || p.answer > 7) push('bad answer index');

    // --- Rule check: EXACTLY ONE option may satisfy the constant-step color rule. ---
    if (board && Array.isArray(board.cells) && Array.isArray(p.options) && p.options.every(isTile)) {
      const n = board.cols;
      if (Number.isInteger(n) && n >= 4 && n <= 7 && board.cells.length === n * n) {
        const hi = Math.floor(board.holeIndex / n);
        const hj = board.holeIndex % n;
        const accepted = acceptableHoleColors(board.cells, n, hi, hj);
        if (accepted.length === 0) push('no constant-step color rule fits the visible grid');
        const satisfies = (t) => accepted.includes(t.cells[0].color)
          && t.cells[0].shape === board.cells.find((c) => c).shape
          && t.cells[0].rot === board.cells.find((c) => c).rot;
        const winners = p.options.filter(satisfies);
        if (winners.length !== 1) push(`exactly one option must satisfy the rule — found ${winners.length}`);
        if (winners.length === 1 && p.options[p.answer] !== winners[0]) push('answer does not point at the rule-satisfying option');
      }
    }

    return { ok: errors.length === 0, errors };
  }

  const api = { name: 'latin', generate, validate };
  root.IQ.GenV = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
