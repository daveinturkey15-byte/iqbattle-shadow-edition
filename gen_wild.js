/* IQ.GenV ("wild") — late-game corruption mode for IQ VERSUS: SHADOW (stage 3 only).
   Surreal puzzles whose rule ALMOST holds, then twists mid-axis (a color step
   reverses at the midpoint, a march stutters every third cell, …). Every puzzle
   still has exactly one defensible answer: the twist is a pure function of
   position, so the hidden cell is uniquely determined. Marked corrupt=true.
   Same puzzle contract as IQ.Puzzles — drop-in for the integrator. */
(() => {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const IQ = root.IQ = root.IQ || {};

  const SHAPES = ['plus', 'ring', 'square', 'triangle', 'diamond', 'cross'];
  const KINDS = ['matrix', 'sequence', 'oddone'];

  // --- mulberry32 seeded RNG (identical to puzzles.js) ---
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
  const key = (x) => JSON.stringify(x);
  const mod = (v, m) => ((v % m) + m) % m;

  // ---------- corruption twists ----------
  // Each twisted attribute keeps a LINEAR drift (lin[step]) so the board looks
  // obedient — until the twist warps how the drift maps onto positions.
  // All twists are bijections of `step`, so the answer stays unique.
  const TWISTS = {
    reflect: {
      // drift reverses at the pivot: rises to mid-axis, then crawls back
      desc: (drift, st, ax) =>
        `${drift} along each ${ax} — until the middle, where the current reverses and drains back`,
    },
    stutter: {
      // every third position jolts one extra notch
      map: (step, st) => step + (step > 0 && step % 3 === 0 ? st.bump : 0),
      desc: (drift, st, ax) =>
        `${drift}, but every third cell of the ${ax} it jolts ${st.bump > 0 ? 'one extra notch' : 'one notch backward'}`,
    },
    slipreflect: {
      // reverses at the pivot AND slips one extra unit — almost a mirror, not quite
      map: (step, st) => (step <= st.pivot ? step : 2 * st.pivot - step + st.slip),
      desc: (drift, st, ax) =>
        `${drift} along each ${ax}, and past the midpoint the flow reverses — though it never quite finds its old track again`,
    },
  };

  const ATTRS = {
    si: {
      name: 'The shapes',
      linWord: (lin) => lin > 0 ? 'march forward through their cycle'
        : lin < 0 ? 'march backward through their cycle' : 'hold still',
    },
    co: {
      name: 'The colors',
      linWord: (lin) => lin > 0 ? `drift ${lin} step${lin > 1 ? 's' : ''} along the palette`
        : lin < 0 ? `drift ${-lin} step${lin < -1 ? 's' : ''} back along the palette` : 'hold still',
    },
    ro: {
      name: 'The figures',
      linWord: (lin) => lin !== 0 ? `turn a quarter-turn ${lin > 0 ? 'clockwise' : 'counter-clockwise'} at a time` : 'hold still',
    },
  };
  const PROMPTS = [
    'THE PATTERN REMEMBERS BEING WHOLE. GUESS WHAT IT FORGOT.',
    'The rule held. Then the rule blinked. Answer for what it became.',
    'Something rewound part of this grid and left the seam showing. Seal the seam.',
    'Half of this grid obeys. The other half obeys backwards. CHOOSE.',
    'It was a clean pattern once. Something walked through it in the dark. Complete it.',
  ];

  function pickLinears(r, twistedKeys) {
    // Linear drift per attribute; twisted attributes MUST drift (a twist of a
    // frozen attribute would be invisible). At least one attribute moves.
    const lin = {};
    lin.si = r.pick([1, -1, 0, 0]);
    lin.co = r.pick([1, 2, 3, -1, -2, 0]);
    lin.ro = r.pick([1, -1, 0, 0]);
    for (const k of twistedKeys) {
      if (k === 'si') lin.si = r.chance(0.5) ? 1 : -1;
      else if (k === 'co') lin.co = r.pick([1, 2, 3, -1]);
      else lin.ro = r.chance(0.5) ? 1 : -1;
    }
    if (!lin.si && !lin.co && !lin.ro) lin[r.pick(['si', 'co', 'ro'])] = 1;
    return lin;
  }

  function buildTwists(r, kind, cols, rows, len) {
    // 1 or 2 corrupted attributes (never both shape+rot — too tangled to read).
    const pool = shuffle(r, ['si', 'co', 'ro']);
    let keys;
    for (;;) {
      keys = pool.slice(0, r.chance(0.45) ? 2 : 1);
      if (!(keys.includes('si') && keys.includes('ro'))) break;
    }
    const lin = pickLinears(r, keys);
    const axisOf = {}; // attribute -> human axis name
    if (kind === 'sequence') {
      for (const k of keys) axisOf[k] = { name: 'step', span: len - 1 };
    } else if (kind === 'oddone') {
      for (const k of keys) axisOf[k] = { name: 'reading order', span: cols * rows - 1 };
    } else if (keys.length === 2) {
      axisOf[keys[0]] = { name: 'column', span: cols - 1, coord: 1 };
      axisOf[keys[1]] = { name: 'row', span: rows - 1, coord: 0 };
    } else {
      const c = r.pick(['column', 'row']);
      axisOf[keys[0]] = { name: c, span: (c === 'column' ? cols : rows) - 1, coord: c === 'column' ? 1 : 0 };
    }
    const twists = keys.map((k) => {
      const ax = axisOf[k];
      const pivot = Math.max(1, Math.floor(axisOf[k].span / 2));
      const name = r.pick(Object.keys(TWISTS));
      const st = { pivot, bump: r.chance(0.5) ? 1 : -1, slip: r.chance(0.5) ? 1 : -1 };
      return {
        attrKey: k,
        lin: lin[k],
        st,
        axis: axisOf[k],
        map: (step) => TWISTS[name].map(step, st),
        text: TWISTS[name].desc(ATTRS[k].linWord(lin[k]), st, ax.name),
        pivot,
      };
    });
    return { twists, lin };
  }

  function cellAt(base, twists, lin, pos) {
    // pos: {p} for sequence/oddone; {p,i,j} for matrix. A twist's step is its
    // assigned axis coordinate; clean attributes drift along reading order.
    const val = {};
    for (const k of ['si', 'co', 'ro']) {
      const tw = twists.find((t) => t.attrKey === k);
      const s = tw
        ? (tw.axis.coord === 1 ? pos.j : tw.axis.coord === 0 ? pos.i : pos.p)
        : pos.p;
      val[k] = base[k] + lin[k] * s;
    }
    return {
      shape: SHAPES[mod(val.si, 6)],
      color: mod(val.co, 8),
      rot: mod(val.ro, 4),
    };
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

  // 7 unique distractors (1-2 near-misses, rest harder) + correct at a uniform slot.
  function makeOptions(correct, r, tileMode) {
    const wrap = (c) => (tileMode ? { cols: 1, rows: 1, cells: [c] } : c);
    correct = wrap(correct);
    const seen = new Set([key(correct)]);
    const pool = [];
    const near = 1 + (r.chance(0.5) ? 1 : 0);
    let guard = 0;
    while (pool.length < 7 && guard++ < 400) {
      const hard = pool.length >= near;
      const c = wrap(mutateCell(correct.cells ? correct.cells[0] : correct, r, hard ? (r.chance(0.5) ? 2 : 3) : 1));
      const k = key(c);
      if (!seen.has(k)) { seen.add(k); pool.push(c); }
    }
    while (pool.length < 7) {
      const c = wrap(mutateCell(correct.cells[0], r, 2));
      const k = key(c);
      if (!seen.has(k)) { seen.add(k); pool.push(c); }
    }
    const answer = r.int(8);
    const options = pool.slice();
    options.splice(answer, 0, correct);
    return { options, answer };
  }

  function generate(opts = {}) {
    // Stage 3 corruption mode: always late-game difficulty.
    const difficulty = 5;
    const asked = Array.isArray(opts.kinds) ? opts.kinds.filter((k) => KINDS.includes(k)) : [];
    const kinds = asked.length ? asked : KINDS.slice();
    const seed = (opts.seed != null ? Number(opts.seed)
      : (Date.now() ^ (Math.random() * 0xffffffff))) >>> 0;
    const r = new Rng(seed);
    const kind = r.pick(kinds);
    const prompt = r.pick(PROMPTS);

    let cols, rows, len, n;
    if (kind === 'matrix') [cols, rows] = r.pick([[4, 4], [4, 5], [5, 4], [5, 5]]);
    else if (kind === 'sequence') len = 5;
    else [cols, rows] = r.pick([[4, 4], [5, 5]]);
    n = cols * rows;

    const base = { si: r.int(6), co: r.int(8), ro: r.int(4) };
    const { twists, lin } = buildTwists(r, kind, cols, rows, len || n);

    const ruleText = twists.map((t) => t.text).join('; ') +
      (kind === 'matrix'
        ? '. One space is hollow — choose the tile that seals it.'
        : kind === 'sequence'
          ? '. Choose what comes next.'
          : '. Every cell obeys — except one. Find the impostor.');

    const puz = {
      id: `wild-${kind}-${seed.toString(36)}`,
      kind,
      difficulty,
      corrupt: true,
      prompt,
      rule: ruleText,
    };

    if (kind === 'matrix') {
      const holeIndex = r.int(n);
      const hi = Math.floor(holeIndex / cols);
      const hj = holeIndex % cols;
      const cells = [];
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          cells.push(i === hi && j === hj
            ? null
            : cellAt(base, twists, lin, { p: i * cols + j, i, j }));
        }
      }
      const correct = cellAt(base, twists, lin, { p: hi * cols + hj, i: hi, j: hj });
      puz.board = { cols, rows, cells, holeIndex };
      Object.assign(puz, makeOptions(correct, r, true));
    } else if (kind === 'sequence') {
      const seq = [];
      for (let p = 0; p < len; p++) seq.push(cellAt(base, twists, lin, { p }));
      puz.seq = seq;
      Object.assign(puz, makeOptions(cellAt(base, twists, lin, { p: len }), r));
    } else {
      const oddIndex = r.int(n);
      const cells = [];
      for (let p = 0; p < n; p++) cells.push(cellAt(base, twists, lin, { p }));
      cells[oddIndex] = mutateCell(cells[oddIndex], r, 1);
      puz.oddBoard = { cols, rows, cells, oddIndex };
      Object.assign(puz, makeOptions(cells[oddIndex], r));
    }
    return puz;
  }

  function explain(p) {
    return p && typeof p.rule === 'string' ? p.rule : '';
  }

  function validate(p) {
    // Delegate to the canonical validator — drop-in puzzles MUST pass it.
    if (root.IQ && root.IQ.Puzzles && typeof root.IQ.Puzzles.validate === 'function') {
      return root.IQ.Puzzles.validate(p);
    }
    return { ok: false, errors: ['puzzles.js not loaded — IQ.Puzzles.validate unavailable'] };
  }

  IQ.GenV = { name: 'wild', generate, validate, explain };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { IQ, GenV: IQ.GenV };
  }

  // --- self-test: node gen_wild.js (requires ./puzzles.js for validate) ---
  if (typeof require !== 'undefined' && require.main === module) {
    const Puzzles = require('./puzzles.js');
    void Puzzles; // loading it registers IQ.Puzzles.validate on globalThis
    let fails = 0;
    const kindsTally = { matrix: 0, sequence: 0, oddone: 0 };
    for (let i = 0; i < 50; i++) {
      const seed = 100000 + i * 7919;
      const kinds = [['matrix'], ['sequence'], ['oddone'], undefined][i % 4];
      const p = generate({ seed, kinds });
      kindsTally[p.kind]++;
      const v = validate(p);
      if (!v.ok) { console.log(`FAIL seed=${seed} kind=${p.kind}: ${v.errors.join('; ')}`); fails++; continue; }
      if (p.corrupt !== true) { console.log(`FAIL seed=${seed}: missing corrupt flag`); fails++; }
      if (p.difficulty !== 5 || p.id.indexOf('wild-') !== 0) { console.log(`FAIL seed=${seed}: bad id/difficulty`); fails++; }
      // determinism
      if (JSON.stringify(p) !== JSON.stringify(generate({ seed, kinds }))) {
        console.log(`FAIL seed=${seed}: nondeterministic`); fails++;
      }
    }
    console.log(`gen_wild self-test: 50/50 generated, ${50 - fails}/50 valid+unique` +
      ` (matrix ${kindsTally.matrix}, sequence ${kindsTally.sequence}, oddone ${kindsTally.oddone})`);
    process.exitCode = fails ? 1 : 0;
  }
})();
