/* IQ.GenV ('rotate') — rotation-progression puzzle variant for IQ BATTLE.
 *
 * Philosophy: one shape, one color, one idea. A single triangle sits in every
 * cell; its rotation advances by a CONSTANT step along the reading axis
 * (column/row for matrices, step for sequences, position for odd-one-out).
 * Nothing else ever varies — the rule is discoverable in seconds.
 *
 * Drop-in contract (matches IQ.Puzzles):
 *   GenV.generate({difficulty, kind, seed}) -> standard puzzle object
 *     {id, kind, difficulty, prompt, rule, board|seq|oddBoard, options:[8], answer}
 *   GenV.validate(p) -> {ok, errors}
 *   GenV.selfTest(n) -> {pass, fail, details}
 * Deterministic: same seed -> byte-identical puzzle.
 *
 * Shape note: among the rotatable shapes only TRIANGLE is visually asymmetric —
 * diamond and cross have 90-degree symmetry (tileSVG renders rot 0 == rot 2),
 * which would make answers look duplicated on screen. So this variant draws
 * triangles exclusively; rotation stays the star of the show.
 *
 * Decoy note: with shape and color pinned, only 4 distinct rot states exist,
 * so the 8 options necessarily repeat wrong rots. Uniqueness is therefore
 * enforced BY RULE: exactly one option satisfies the progression (the answer
 * appears exactly once); decoys are wrong rotation steps only.
 */
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};

  const SHAPE = 'triangle';
  const KINDS = ['matrix', 'sequence', 'oddone'];

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

  // Rotation arithmetic: signed step s (nonzero, |s|<=3), normalized to 0..3.
  const norm4 = (x) => ((x % 4) + 4) % 4;
  const cell = (color, rot) => ({ shape: SHAPE, color, rot: norm4(rot) });

  // Human-readable rule sentence — mirrors IQ.Puzzles tone.
  function stepWords(s, axisWord) {
    const mag = Math.abs(norm4(s)) || 4;
    const dir = (norm4(s) === 1 || norm4(s) === 2) ? 'clockwise' : 'counter-clockwise';
    const turn = mag === 1 ? 'quarter turn' : mag === 2 ? 'half turn' : 'three-quarter turn';
    return `every ${axisWord} turns the figure ${dir} — ${mag} × 90°, one ${turn} at a time`;
  }
  function kindTail(kind) {
    return kind === 'matrix'
      ? '. One space is hollow — choose the tile that seals it.'
      : kind === 'sequence'
        ? '. Choose what comes next.'
        : '. Every cell obeys — except one. Find the impostor.';
  }

  const PROMPTS = [
    [ // difficulty 1-2
      'Rotation audit. One figure is missing its orientation. File the correct angle.',
      'A simple turning test. The previous candidate spun out. Do better.',
    ],
    [ // difficulty 3-4
      'The figure turns whether you watch or not. Predict its next face.',
      'Something in the grid keeps rotating. Choose the angle that completes it.',
    ],
    [ // difficulty 5
      'THE WHEEL DOES NOT STOP. FEED IT THE ONLY TRUE ANGLE.',
      'IT HAS BEEN TURNING THIS WHOLE TIME. TURN WITH IT OR BE TURNED.',
    ],
  ];

  // Grid sizing 4x4 .. 6x6, scaled by difficulty.
  function gridSize(d, r) {
    if (d <= 1) return [4, 4];
    if (d === 2) return r.pick([[4, 4], [4, 5], [5, 4]]);
    if (d === 3) return r.pick([[5, 5], [4, 6], [6, 4]]);
    if (d === 4) return r.pick([[5, 5], [5, 6], [6, 5]]);
    return [6, 6];
  }
  function seqLen(d) { return d <= 2 ? 4 : d <= 4 ? 5 : 6; }

  // Signed step: magnitude grows a little with difficulty, direction random.
  function pickStep(d, r) {
    const mags = d <= 2 ? [1, 3] : d <= 4 ? [1, 2, 3] : [1, 2, 3];
    const mag = r.pick(mags);
    return (r.chance(0.5) ? mag : 4 - mag) % 4 || 1; // signed quarter-turns, never 0
  }

  function makeOptions(correctCell, r) {
    const wrongs = shuffle(r, [1, 2, 3].map((w) => norm4(correctCell.rot + w)));
    const pool = [];
    for (let i = 0; i < 7; i++) pool.push(cell(correctCell.color, wrongs[i % 3]));
    const answer = r.int(8);
    const options = pool.slice();
    options.splice(answer, 0, correctCell);
    return { options, answer };
  }

  function generate(opts = {}) {
    const difficulty = Math.min(5, Math.max(1, Math.floor(Number(opts.difficulty) || 2)));
    const asked = Array.isArray(opts.kinds) ? opts.kinds.filter((k) => KINDS.includes(k))
      : KINDS.includes(opts.kind) ? [opts.kind] : [];
    const kinds = asked.length ? asked : KINDS.slice();
    const seed = (opts.seed != null ? Number(opts.seed)
      : (Date.now() ^ (Math.random() * 0xffffffff))) >>> 0;
    const r = new Rng(seed);
    const kind = r.pick(kinds);
    const color = r.int(8);
    const step = pickStep(difficulty, r);
    const prompt = r.pick(PROMPTS[difficulty <= 2 ? 0 : difficulty <= 4 ? 1 : 2]);

    const puz = {
      id: `iq-${kind}-${difficulty}-rot-${seed.toString(36)}`,
      kind,
      difficulty,
      prompt,
    };

    if (kind === 'matrix') {
      const axisCol = r.chance(0.5);
      const axisWord = axisCol ? 'column' : 'row';
      puz.rule = stepWords(step, axisWord) + kindTail(kind);
      const [cols, rows] = gridSize(difficulty, r);
      const holeIndex = r.int(cols * rows);
      const hi = Math.floor(holeIndex / cols);
      const hj = holeIndex % cols;
      const baseRot = r.int(4);
      const at = (i, j) => cell(color, baseRot + step * (axisCol ? j : i));
      const cells = [];
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) cells.push(i === hi && j === hj ? null : at(i, j));
      }
      puz.board = { cols, rows, cells, holeIndex };
      Object.assign(puz, makeOptions(at(hi, hj), r));
    } else if (kind === 'sequence') {
      puz.rule = stepWords(step, 'step') + kindTail(kind);
      const len = seqLen(difficulty);
      const baseRot = r.int(4);
      const at = (p) => cell(color, baseRot + step * p);
      const seq = [];
      for (let p = 0; p < len; p++) seq.push(at(p));
      puz.seq = seq;
      Object.assign(puz, makeOptions(at(len), r));
    } else {
      puz.rule = stepWords(step, 'position') + kindTail(kind);
      const [cols, rows] = gridSize(difficulty, r);
      const n = cols * rows;
      const oddIndex = r.int(n);
      const baseRot = r.int(4);
      const at = (p) => cell(color, baseRot + step * p);
      const cells = [];
      for (let p = 0; p < n; p++) cells.push(at(p));
      // Impostor: any rot EXCEPT the rule's prediction for its position.
      const expected = at(oddIndex).rot;
      const bad = shuffle(r, [0, 1, 2, 3].filter((v) => v !== expected))[0];
      cells[oddIndex] = cell(color, bad);
      puz.oddBoard = { cols, rows, cells, oddIndex };
      Object.assign(puz, makeOptions(cells[oddIndex], r));
    }
    return puz;
  }

  // Recover (step, baseRot) for a fully-populated run of positions 0..n-1.
  function fitRule(rots) {
    for (let s = 1; s <= 3; s++) {
      for (const sg of [1, -1]) {
        const stp = norm4(s * sg) || norm4(-s);
        if (!stp) continue;
        const b = norm4(rots[0]);
        let ok = true;
        for (let p = 1; p < rots.length; p++) {
          if (norm4(b + stp * p) !== norm4(rots[p])) { ok = false; break; }
        }
        if (ok) return { step: stp, baseRot: b };
      }
    }
    return null;
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
      && c.shape === SHAPE
      && Number.isInteger(c.color) && c.color >= 0 && c.color < 8
      && Number.isInteger(c.rot) && c.rot >= 0 && c.rot < 4;

    // Options: 8 valid cells, all same color, answer present exactly ONCE
    // (uniqueness-by-rule — rot-only decoys legitimately repeat rots).
    if (!Array.isArray(p.options) || p.options.length !== 8) {
      push('options must hold exactly 8 entries');
    } else {
      if (!p.options.every(isCell)) push('option malformed or wrong shape (want ' + SHAPE + ')');
      const colors = new Set(p.options.map((o) => o.color));
      if (colors.size !== 1) push('options vary color — rotation variant pins color');
      const key = (c) => `${c.shape}:${c.color}:${c.rot}`;
      const hits = p.options.filter((o) => key(o) === key(p.options[p.answer] || {})).length;
      if (!Number.isInteger(p.answer) || p.answer < 0 || p.answer > 7) push('bad answer index');
      else if (hits !== 1) push(`answer cell appears ${hits}× — must be unique by rule`);
    }

    const checkGrid = (g, label, allowHole) => {
      if (!g || typeof g !== 'object') { push(`${label} missing`); return false; }
      const { cols, rows, cells, holeIndex } = g;
      if (!Number.isInteger(cols) || cols < 4 || cols > 6) push(`${label} cols out of 4..6`);
      if (!Number.isInteger(rows) || rows < 4 || rows > 6) push(`${label} rows out of 4..6`);
      if (!Array.isArray(cells)) { push(`${label} cells missing`); return false; }
      if (Number.isInteger(cols) && Number.isInteger(rows) && cells.length !== cols * rows) {
        push(`${label} cells length mismatch`);
        return false;
      }
      if (!cells.every((c) => c === null || isCell(c))) { push(`${label} malformed cells`); return false; }
      const solid = cells.filter((c) => c !== null);
      if (new Set(solid.map((c) => c.color)).size > 1) push(`${label} varies color`);
      if (allowHole) {
        if (cells.filter((c) => c === null).length !== 1) push(`${label} needs exactly one hole`);
        if (!Number.isInteger(holeIndex) || holeIndex < 0 || holeIndex >= cells.length
          || cells[holeIndex] !== null) push(`${label} holeIndex wrong`);
      } else if (!Number.isInteger(g.oddIndex) || g.oddIndex < 0 || g.oddIndex >= cells.length) {
        push(`${label} oddIndex wrong`);
      }
      return true;
    };

    // Uniqueness-by-rule core: recover the constant step from the board/seq,
    // predict the missing cell, and require the answer to be that exact cell.
    const keyOf = (c) => (c ? `${c.shape}:${c.color}:${c.rot}` : '');

    if (p.kind === 'matrix') {
      if (!checkGrid(p.board, 'board', true)) return { ok: false, errors };
      const { cols, rows, cells, holeIndex } = p.board;
      const hi = Math.floor(holeIndex / cols);
      const hj = holeIndex % cols;
      const axisCol = new RegExp(/column/).test(p.rule);
      const pos = (i, j) => (axisCol ? j : i);
      const seen = [];
      const coords = [];
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          if (cells[i * cols + j] !== null) { seen.push(cells[i * cols + j].rot); coords.push(pos(i, j)); }
        }
      }
      // Align observed rots against their axis positions to fit the step.
      const minP = Math.min(...coords);
      const aligned = coords.map((q) => ({ q, rot: null }));
      const byP = new Map(coords.map((q, idx) => [q, seen[idx]]));
      const chain = [];
      for (let q = minP; ; q++) {
        if (!byP.has(q)) break;
        chain.push(byP.get(q));
      }
      const fit = chain.length >= 2 ? fitRule(chain) : null;
      if (!fit) push('board does not follow one constant rotation step');
      else {
        // Verify EVERY solid cell against the fitted rule, then predict hole.
        let allOk = true;
        for (let i = 0; i < rows && allOk; i++) {
          for (let j = 0; j < cols; j++) {
            const c = cells[i * cols + j];
            if (c === null) continue;
            if (norm4(fit.baseRot + fit.step * pos(i, j)) !== c.rot) { allOk = false; break; }
          }
        }
        if (!allOk) push('some board cells break the fitted rotation step');
        const solidColor = cells.find((c) => c !== null).color;
        const predicted = cell(solidColor, fit.baseRot + fit.step * pos(hi, hj));
        if (Array.isArray(p.options) && Number.isInteger(p.answer)) {
          if (keyOf(p.options[p.answer]) !== keyOf(predicted)) {
            push('answer does not satisfy the rotation rule at the hole');
          }
          const goodOnes = p.options.filter((o) => keyOf(o) === keyOf(predicted)).length;
          if (goodOnes !== 1) push(`rule admits ${goodOnes} options — must admit exactly 1`);
        }
      }
    } else if (p.kind === 'sequence') {
      if (!Array.isArray(p.seq) || p.seq.length < 3 || p.seq.length > 6) push('seq length out of range');
      else if (!p.seq.every(isCell)) push('seq holds malformed cells');
      else {
        const fit = fitRule(p.seq.map((c) => c.rot));
        if (!fit) push('seq does not follow one constant rotation step');
        else if (Array.isArray(p.options) && Number.isInteger(p.answer)) {
          const predicted = cell(p.seq[0].color, fit.baseRot + fit.step * p.seq.length);
          if (keyOf(p.options[p.answer]) !== keyOf(predicted)) {
            push('answer does not continue the rotation rule');
          }
          const goodOnes = p.options.filter((o) => keyOf(o) === keyOf(predicted)).length;
          if (goodOnes !== 1) push(`rule admits ${goodOnes} options — must admit exactly 1`);
        }
      }
    } else if (p.kind === 'oddone') {
      if (!checkGrid(p.oddBoard, 'oddBoard', false)) return { ok: false, errors };
      const { cols, cells, oddIndex } = p.oddBoard;
      const rotsByP = [];
      const kept = cells.map((c, idx) => (idx === oddIndex ? null : c));
      for (let pidx = 0; pidx < kept.length; pidx++) {
        if (kept[pidx] !== null) rotsByP.push({ p: pidx, rot: kept[pidx].rot });
      }
      let fitted = null;
      for (let s = 1; s <= 3 && !fitted; s++) {
        for (const sg of [1, -1]) {
          const stp = norm4(s * sg) || norm4(-s);
          if (!stp) continue;
          const b = norm4(rotsByP[0].rot - stp * rotsByP[0].p);
          if (rotsByP.every(({ p, rot }) => norm4(b + stp * p) === rot)) { fitted = { step: stp, baseRot: norm4(b) }; break; }
        }
      }
      if (!fitted) push('oddBoard majority does not follow one constant rotation step');
      else {
        const expected = norm4(fitted.baseRot + fitted.step * oddIndex);
        const impostor = cells[oddIndex];
        if (impostor.rot === expected) push('impostor obeys the rule — not an impostor');
        if (Array.isArray(p.options) && Number.isInteger(p.answer)) {
          if (keyOf(p.options[p.answer]) !== keyOf(impostor)) push('answer is not the impostor cell');
        }
      }
    }
    return { ok: errors.length === 0, errors };
  }

  function explain(p) {
    return p && typeof p.rule === 'string' ? p.rule : '';
  }

  function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  // Self-test: n puzzles across all kinds × difficulties; validate + determinism
  // + answer-uniqueness + decoys-differ-only-in-rotation.
  function selfTest(n = 100) {
    let fail = 0;
    const details = [];
    for (let t = 0; t < n; t++) {
      const kind = KINDS[t % 3];
      const difficulty = (t % 5) + 1;
      const seed = 0x9e3779b9 ^ (t * 2654435761);
      let p;
      try {
        p = generate({ kind, difficulty, seed });
        const v = validate(p);
        if (!v.ok) { fail++; details.push(`#${t} ${kind} d${difficulty}: validate: ${v.errors.join('; ')}`); continue; }
        if (!eq(p, generate({ kind, difficulty, seed }))) {
          fail++; details.push(`#${t}: nondeterministic`); continue;
        }
        const key = (c) => JSON.stringify(c);
        if (p.options.filter((o) => key(o) === key(p.options[p.answer])).length !== 1) {
          fail++; details.push(`#${t}: answer not unique among options`); continue;
        }
        const proto = p.options[p.answer];
        const badDecoy = p.options.some((o, i) => i !== p.answer
          && (o.shape !== proto.shape || o.color !== proto.color));
        if (badDecoy) { fail++; details.push(`#${t}: decoy varies shape/color`); continue; }
        if (new Set(p.options.map(key)).size > 4) {
          fail++; details.push(`#${t}: more than 4 distinct cells — non-rot drift`); continue;
        }
      } catch (e) {
        fail++; details.push(`#${t}: threw ${e.message}`);
      }
    }
    return { pass: n - fail, fail, details: details.slice(0, 10) };
  }

  const GenV = { name: 'rotate', generate, validate, explain, selfTest };
  root.IQ.GenV = GenV;
  if (typeof module !== 'undefined') module.exports = GenV;
})();
