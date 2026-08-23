/* IQ GenV 'count' — count-progression puzzle generator for IQ BATTLE.
   Every cell is a tile holding 1..5 identical marks (DIMS exact-fit packing).
   The mark count steps +1/-1 along the chosen axis; shape and color never change.
   Decoys are off-by-one counts and wrong colors only — the rule is visible in seconds. */
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};

  const SHAPES = ['plus', 'ring', 'square', 'triangle', 'diamond', 'cross'];
  const KINDS = ['matrix', 'sequence', 'oddone'];
  // Exact-fit tile dimensions for mark counts 1..5 (same packing as IQ.Puzzles).
  const DIMS = [[1, 1], [2, 1], [3, 1], [2, 2], [5, 1]];

  const key = (x) => JSON.stringify(x);

  // --- mulberry32 seeded RNG (same recipe as IQ.Puzzles) ---
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

  // A tile holding `cnt` copies of one identical mark.
  function countTile(mark, cnt) {
    const n = Math.min(5, Math.max(1, cnt));
    const [cols, rows] = DIMS[n - 1];
    const cells = [];
    for (let i = 0; i < n; i++) cells.push({ shape: mark.shape, color: mark.color, rot: mark.rot });
    return { cols, rows, cnt: n, cells };
  }

  const PROMPTS = [
    ['Stack tally audit. How many does the hollow one hold?', 'A counting exercise. The last candidate guessed. Do not guess.',
      'Marks accumulate. Select the stack that completes the ledger.'],
    ['The marks breed when you look away. Count them anyway.', 'Something in the grid is multiplying. Feed it the right amount.',
      'One space hungers for a precise number of shapes. Choose.', 'Count twice. The grid rewards precision and punishes haste.'],
    ['THE MARKS MULTIPLY. COUNT OR BE COUNTED.', 'THE HOLE DEMANDS AN EXACT NUMBER. IT KNOWS IF YOU GUESS.',
      'ONE STACK SEALS THE VOID. EVERY OTHER STACK FEEDS IT.'],
  ];

  // Grid size by difficulty: 3x3 .. 5x5 (mixed orientations mid-range).
  function gridSize(d, r) {
    if (d <= 1) return [3, 3];
    if (d === 2) return r.pick([[3, 3], [3, 4], [4, 3]]);
    if (d === 3) return [4, 4];
    if (d === 4) return r.pick([[4, 4], [4, 5], [5, 4]]);
    return [5, 5];
  }
  // 4 shown + next keeps every count inside 1..5 (a 5-term ladder would need six values).
  function seqLen(d) { return d <= 2 ? 3 : 4; }

  // Count at axis position p: ascending 1,2,3,... or descending 5,4,3,...
  function makeCounter(r) {
    return r.chance(0.5)
      ? { dir: 1, at: (p) => Math.min(5, 1 + p) }
      : { dir: -1, at: (p) => Math.max(1, 5 - p) };
  }

  // Decoys: adjacent counts (off-by-one, same color) first, then wrong colors,
  // then count+color mixes. 7 unique + correct inserted at a uniform slot.
  function makeOptions(correct, r) {
    const seen = new Set([key(correct)]);
    const cnt = correct.cnt;
    const co = correct.cells[0].color;
    const adj = [];
    const wrongColor = [];
    const rest = [];
    for (const c of [cnt - 1, cnt + 1]) {
      if (c >= 1 && c <= 5) adj.push(countTile(correct.cells[0], c));
    }
    for (let k = 1; k < 8; k++) {
      const mark = { ...correct.cells[0], color: (co + k) % 8 };
      const sameCnt = countTile(mark, cnt);
      const bumped = countTile(mark, cnt === 5 ? 4 : cnt + 1);
      if (r.chance(0.5)) wrongColor.push(sameCnt), rest.push(bumped);
      else wrongColor.push(bumped), rest.push(sameCnt);
    }
    const pool = [];
    for (const t of [...shuffle(r, adj), ...shuffle(r, wrongColor), ...shuffle(r, rest)]) {
      if (pool.length >= 7) break;
      const k = key(t);
      if (!seen.has(k)) { seen.add(k); pool.push(t); }
    }
    let guard = 0;
    while (pool.length < 7 && guard++ < 400) {
      const t = countTile({ ...correct.cells[0], color: r.int(8) }, r.int(5) + 1);
      const k = key(t);
      if (!seen.has(k)) { seen.add(k); pool.push(t); }
    }
    const answer = r.int(8);
    const options = pool.slice(0, 7);
    options.splice(answer, 0, correct);
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

    const mark = { shape: r.pick(SHAPES), color: r.int(8), rot: r.pick([0, 1]) };
    const counter = makeCounter(r);

    const ruleText = `every step along its axis ${counter.dir > 0 ? 'adds' : 'removes'} exactly one mark`
      + '. Shape and color never change — only the count.'
      + (kind === 'matrix' ? ' One space is hollow — choose the tile that seals it.'
        : kind === 'sequence' ? ' Choose what comes next.'
          : ' Every stack obeys — except one. Find the impostor.');

    const puz = {
      id: `iqc-${kind}-${difficulty}-${seed.toString(36)}`,
      kind,
      difficulty,
      prompt,
      rule: ruleText,
    };

    if (kind === 'matrix') {
      const [cols, rows] = gridSize(difficulty, r);
      const byRow = r.chance(0.5); // count advances along rows or down columns
      const stepOf = (i, j) => (byRow ? j : i);
      const holeIndex = r.int(cols * rows);
      const hi = Math.floor(holeIndex / cols);
      const hj = holeIndex % cols;
      const cells = [];
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          cells.push(i === hi && j === hj ? null : countTile(mark, counter.at(stepOf(i, j))));
        }
      }
      puz.board = { cols, rows, cells, holeIndex };
      Object.assign(puz, makeOptions(countTile(mark, counter.at(stepOf(hi, hj))), r));
    } else if (kind === 'sequence') {
      const len = seqLen(difficulty);
      const seq = [];
      for (let p = 0; p < len; p++) seq.push(countTile(mark, counter.at(p)));
      puz.seq = seq;
      Object.assign(puz, makeOptions(countTile(mark, counter.at(len)), r));
    } else {
      const [cols, rows] = gridSize(difficulty, r);
      const n = cols * rows;
      const byRow = r.chance(0.5);
      const stepOf = (i, j) => (byRow ? j : i);
      const oddIndex = r.int(n);
      const cells = [];
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) cells.push(countTile(mark, counter.at(stepOf(i, j))));
      }
      // Impostor: off-by-one count (wrong color at high difficulty); must not
      // replicate any other tile on the board, or the answer becomes ambiguous.
      const base = cells[oddIndex];
      const taken = new Set(cells.filter((_, i2) => i2 !== oddIndex).map(key));
      let impostor = null;
      if (difficulty >= 4 && r.chance(0.4)) {
        impostor = countTile({ ...mark, color: (mark.color + r.range(1, 7)) % 8 }, base.cnt);
      }
      if (!impostor || taken.has(key(impostor))) {
        impostor = null;
        for (const delta of shuffle(r, [-1, 1])) {
          const nc = base.cnt + delta;
          if (nc < 1 || nc > 5) continue;
          const t = countTile(mark, nc);
          if (!taken.has(key(t))) { impostor = t; break; }
        }
      }
      if (!impostor) impostor = countTile({ ...mark, color: (mark.color + r.range(1, 7)) % 8 }, base.cnt);
      cells[oddIndex] = impostor;
      puz.oddBoard = { cols, rows, cells, oddIndex };
      Object.assign(puz, makeOptions(impostor, r));
    }
    return puz;
  }

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
      && Number.isInteger(t.cnt) && t.cnt >= 1 && t.cnt <= 5
      && t.cells.length === t.cnt
      && t.cells.every(isCell)
      && t.cells.every((c) => key(c) === key(t.cells[0]));

    if (typeof p.id !== 'string' || !p.id) push('bad id');
    if (!KINDS.includes(p.kind)) push('bad kind: ' + p.kind);
    if (!Number.isInteger(p.difficulty) || p.difficulty < 1 || p.difficulty > 5) push('bad difficulty');
    if (typeof p.prompt !== 'string' || !p.prompt) push('bad prompt');
    if (typeof p.rule !== 'string' || !p.rule) push('bad rule');

    if (!Array.isArray(p.options) || p.options.length !== 8) {
      push('options must hold exactly 8 entries');
    } else {
      if (new Set(p.options.map(key)).size !== 8) push('duplicate options');
      p.options.forEach((o, i) => { if (!isTile(o)) push(`option ${i} malformed`); });
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
      if (!cells.every((c) => c === null || isTile(c))) push(`${label} has malformed cells`);
      if (allowHole) {
        const holes = cells.filter((c) => c === null).length;
        if (holes !== 1) push(`${label} must hold exactly one hole`);
        const hi = g.holeIndex;
        if (!Number.isInteger(hi) || hi < 0 || hi >= cells.length) push(`${label} holeIndex out of range`);
        else if (cells[hi] !== null) push(`${label} holeIndex does not point at the hole`);
      } else {
        if (!cells.every(isTile)) push(`${label} must be fully populated`);
        const oi = g.oddIndex;
        if (!Number.isInteger(oi) || oi < 0 || oi >= cells.length) push(`${label} oddIndex out of range`);
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
      else if (!p.seq.every(isTile)) push('seq holds malformed tiles');
      if (Array.isArray(p.options) && Number.isInteger(p.answer) && !isTile(p.options[p.answer])) {
        push('options[answer] is not a valid tile');
      }
    } else if (p.kind === 'oddone') {
      if (checkGrid(p.oddBoard, 'oddBoard', false) && Array.isArray(p.options)
        && Number.isInteger(p.answer) && !isTile(p.options[p.answer])) {
        push('options[answer] is not a valid tile');
      }
    }
    return { ok: errors.length === 0, errors };
  }

  // Behavioral self-test: every generated puzzle validates, the count truly
  // progresses by ±1 along one axis, shape/color are constant, decoys are
  // off-by-one counts or wrong colors, and the answer carries exactly the
  // count its position demands.
  function selfTest(rounds = 400) {
    const errors = [];
    let checked = 0;
    for (let s = 0; s < rounds; s++) {
      const seed = 1000 + s * 7919;
      const difficulty = (s % 5) + 1;
      const kind = KINDS[s % 3];
      const p = generate({ seed, difficulty, kinds: [kind] });
      const v = validate(p);
      if (!v.ok) { errors.push(`seed ${seed}: ${v.errors.join('; ')}`); continue; }
      checked++;
      const fail = (msg) => errors.push(`seed ${seed}: ${msg}`);
      const markOf = (t) => t.cells[0];
      const expectConst = (tiles, label) => {
        const first = tiles.find(Boolean);
        for (const t of tiles) {
          if (!t) continue;
          const mk = markOf(t);
          if (mk.shape !== markOf(first).shape || mk.color !== markOf(first).color) {
            fail(`${label} breaks constant shape/color`);
            return;
          }
        }
      };
      if (p.kind === 'matrix') {
        const { cols, rows, cells } = p.board;
        // shape must be constant everywhere; only counts progress
        expectConst(cells.filter(Boolean).map((t) => ({ ...t, cells: [{ ...t.cells[0], color: 0 }] })), 'board');
        // classify axes from visible adjacent pairs
        const vPairs = [], hPairs = [];
        for (let i = 0; i < rows; i++) {
          for (let j = 0; j < cols; j++) {
            const t = cells[i * cols + j];
            if (!t) continue;
            if (i + 1 < rows && cells[(i + 1) * cols + j]) vPairs.push(Math.abs(cells[(i + 1) * cols + j].cnt - t.cnt));
            if (j + 1 < cols && cells[i * cols + j + 1]) hPairs.push(Math.abs(cells[i * cols + j + 1].cnt - t.cnt));
          }
        }
        const allPairs = (ps, step) => ps.every((d) => d === step);
        const vertVaries = vPairs.some((d) => d === 1);
        const horizVaries = hPairs.some((d) => d === 1);
        const axisOk = (vertVaries && allPairs(vPairs, 1) && allPairs(hPairs, 0))
          || (horizVaries && allPairs(hPairs, 1) && allPairs(vPairs, 0));
        if (!axisOk) fail('counts do not step by exactly ±1 along a single axis');
        // answer tile must be the ±1 continuation of its neighbor on the varying axis
        const ansT = p.options[p.answer];
        const hi = Math.floor(p.board.holeIndex / cols);
        const hj = p.board.holeIndex % cols;
        const axisNeighbors = vertVaries
          ? [[hi - 1, hj], [hi + 1, hj]]
          : [[hi, hj - 1], [hi, hj + 1]];
        const nb = axisNeighbors
          .filter(([ni, nj]) => ni >= 0 && ni < rows && nj >= 0 && nj < cols)
          .map(([ni, nj]) => cells[ni * cols + nj])
          .find(Boolean);
        if (!nb || Math.abs(nb.cnt - ansT.cnt) !== 1) {
          fail(`answer count ${ansT.cnt} not a ±1 continuation of axis neighbor`);
        }
      } else if (p.kind === 'sequence') {
        expectConst(p.seq, 'seq');
        for (let i = 1; i < p.seq.length; i++) {
          if (Math.abs(p.seq[i].cnt - p.seq[i - 1].cnt) !== 1) fail('seq step not ±1');
        }
        if (Math.abs(p.options[p.answer].cnt - p.seq[p.seq.length - 1].cnt) !== 1) {
          fail('answer not adjacent to last seq tile');
        }
      } else {
        const b = p.oddBoard;
        // shape must be constant everywhere (color may differ on a d>=4 impostor)
        expectConst(b.cells.map((t) => ({ ...t, cells: [{ ...t.cells[0], color: 0 }] })), 'oddBoard');
        const odd = b.cells[b.oddIndex];
        const others = b.cells.filter((_, i) => i !== b.oddIndex);
        if (others.some((t) => key(t) === key(odd))) fail('odd tile duplicates another board tile');
        // the impostor must be a near-miss of the regular tiles: one count off
        // or same count with a different color
        const nearMiss = others.some((t) => Math.abs(t.cnt - odd.cnt) === 1)
          || others.some((t) => t.cnt === odd.cnt && t.cells[0].color !== odd.cells[0].color);
        if (!nearMiss) fail('impostor is not a near-miss');
      }
      // decoy audit: every wrong option is an off-by-one count or a wrong color
      const ansT = p.options[p.answer];
      for (let oi = 0; oi < 8; oi++) {
        if (oi === p.answer) continue;
        const d = p.options[oi];
        const cntDiffers = d.cnt !== ansT.cnt;
        const colDiffers = d.cells[0].color !== ansT.cells[0].color;
        if (cntDiffers && Math.abs(d.cnt - ansT.cnt) > 1) {
          if (!colDiffers) fail(`decoy ${oi} far-off count without color cue`);
        }
      }
    }
    return { ok: errors.length === 0, checked, errors: errors.slice(0, 10) };
  }

  const api = { name: 'count', generate, validate, selfTest };
  root.IQ.GenV = api;
  root.IQ.Gens = root.IQ.Gens || {};
  root.IQ.Gens.count = api;
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    const res = api.selfTest();
    console.log(res.ok ? `self-test OK (${res.checked}/${res.checked} puzzles verified)` : `self-test FAILED:\n${res.errors.join('\n')}`);
    process.exit(res.ok ? 0 : 1);
  }
})();
