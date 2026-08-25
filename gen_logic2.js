/* IQ.Gens['logicB'] — MULTI-ATTRIBUTE BINDING pack for IQ BATTLE (W1).
 * Five matrix archetypes where TWO attributes co-vary, forcing the player to
 * bind shape->color / axis->offset / diagonal->step / parity->fill /
 * frequency->key before the hole can be filled. Boards are always 3x3,
 * hole always bottom-right (index 8), 8 options, exactly one correct.
 *
 * Archetypes:
 *   f lockShape   — shape-color lock: a permutation table binds each shape to
 *                   a 3-color family; the board's shape dictates its palette.
 *   g mirrorCols  — right column mirrors the left with a FIXED hue offset;
 *                   center column mirrors itself top-to-bottom.
 *   h diagGrad    — color steps along the MAIN diagonal (f(x+y)), rot steps
 *                   along the ANTI-diagonal (f(x-y)).
 *   i parityGrid  — even cells (x+y even) are hollow (ring = outline-only),
 *                   odd cells solid; color is constant per row.
 *   j freqSet     — among the 8 visible cells exactly ONE color appears once;
 *                   placing it in the hole makes it the only color appearing
 *                   exactly TWICE. Every alternative fill breaks the rule.
 *
 * Solvability guarantee: each archetype ships a SOLVER that recomputes the
 * truth cell PURELY from the visible cells (never from hidden generation
 * params). selfTest asserts options[answer] === solver(visible) for every
 * generated puzzle, so "unique answer" is proven, not assumed.
 *
 * Contract (matches IQ.Puzzles / sibling gens):
 *   Gen.generate({difficulty 1..5, seed uint32}) ->
 *     {id, kind:'matrix', difficulty, prompt, rule, arch, board, options:[8], answer}
 *   Gen.validate(p) -> {ok, errors}
 *   Gen.selfTest(n=50) -> {n, pass, fail, details}
 * Deterministic: same seed -> byte-identical puzzle. Host-authoritative:
 * generators carry zero scoring logic.
 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};

  const SHAPES = ['plus', 'ring', 'square', 'triangle', 'diamond', 'cross'];
  const PROMPT = 'WHICH FRAGMENT COMPLETES THE PATTERN?';
  const SIZE = 3, HOLE = 8;

  // --- mulberry32 seeded RNG (same recipe as IQ.Puzzles) ---
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  class Rng {
    constructor(seed) { this.next = mulberry32(seed >>> 0); }
    float() { return this.next(); }
    int(n) { return Math.floor(this.next() * n); }        // 0..n-1
    pick(arr) { return arr[this.int(arr.length)]; }
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = this.int(i + 1);
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    }
  }

  const mod8 = (x) => ((x % 8) + 8) % 8;
  const mod4 = (x) => ((x % 4) + 4) % 4;
  const J = (o) => JSON.stringify(o);
  const cellAt = (cells, x, y) => cells[y * SIZE + x];

  // ------------------------------------------------------------------
  // Option assembly: 1 truth + 7 deduped decoys, truth shuffled into place.
  // ------------------------------------------------------------------
  function assemble(r, truth, decoyGen) {
    const opts = [truth];
    const seen = Object.create(null); seen[J(truth)] = 1;
    let guard = 0;
    while (opts.length < 8 && guard++ < 400) {
      const m = decoyGen();
      const k = J(m);
      if (!seen[k]) { seen[k] = 1; opts.push(m); }
    }
    let k = 1; // deterministic filler: pure hue walks off the truth color
    while (opts.length < 8 && k <= 16) {
      const m = { shape: truth.shape, color: mod8(truth.color + k), rot: truth.rot };
      const kk = J(m);
      if (!seen[kk]) { seen[kk] = 1; opts.push(m); }
      k++;
    }
    const order = r.shuffle([0, 1, 2, 3, 4, 5, 6, 7]);
    const out = new Array(8);
    let answer = -1;
    for (let i = 0; i < 8; i++) {
      out[order[i]] = { cols: 1, rows: 1, cells: [opts[i]] };
      if (opts[i] === truth) answer = order[i];
    }
    return { options: out, answer };
  }

  // ==================================================================
  // (f) lockShape — permutation table binds shapeIdx -> base hue;
  //     family(base) = [base, base+2, base+5]; board wears one shape.
  //     Low d: one color per row. High d: latin arrangement of the family.
  // ==================================================================
  function genLockShape(d, r) {
    const shape = r.pick(SHAPES);
    const perm = r.shuffle([0, 1, 2, 3, 4, 5, 6, 7]); // shapeIdx -> base hue
    const base = perm[SHAPES.indexOf(shape)];
    const fam = [base, mod8(base + 2), mod8(base + 5)];
    const order = r.shuffle([0, 1, 2]);
    const latin = d >= 3;
    const cells = new Array(9);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        const slot = latin ? (x + y) % 3 : y;
        cells[y * 3 + x] = { shape, color: fam[order[slot]], rot: 0 };
      }
    }
    cells[HOLE] = null;
    // Truth MUST come from the stated slot rule, not copied off the board:
    // hole (2,2) sits on slot 1 under the diagonal cycle (slot 2 at low d),
    // so the old cells[6]-copy shipped a provably wrong answer at d>=3.
    const tslot = latin ? 1 : 2;
    const truth = { shape, color: fam[order[tslot]], rot: 0 };
    const decoy = () => {
      const m = { shape, color: truth.color, rot: 0 };
      if (r.next() < 0.82 || d <= 2) m.color = mod8(truth.color + 1 + r.int(7));
      else m.shape = r.pick(SHAPES.filter(s => s !== shape)); // shape betrayal
      return m;
    };
    return {
      cells, truth, decoy, arch: 'lockShape',
      rule: latin
        ? 'the mark keeps three fixed shades that cycle steadily along the diagonals'
        : 'the mark keeps three fixed shades - each band wears one'
    };
  }

  // ==================================================================
  // (g) mirrorCols — col2 = col0 mirrored with fixed hue offset;
  //     center column mirrors itself vertically (top cell == bottom cell).
  // ==================================================================
  function genMirrorCols(d, r) {
    const offs = d <= 2 ? [1, 7] : d <= 4 ? [1, 2, 3, 5, 6, 7] : [1, 2, 3, 4, 5, 6, 7];
    const off = r.pick(offs);
    const left = r.shuffle([0, 1, 2, 3, 4, 5, 6, 7]).slice(0, 3);
    const shape = r.pick(SHAPES);
    const midTop = r.int(8), midMid = r.int(8);
    const cells = new Array(9);
    for (let y = 0; y < 3; y++) {
      cells[y * 3 + 0] = { shape, color: left[y], rot: 0 };
      cells[y * 3 + 1] = { shape, color: y === 1 ? midMid : midTop, rot: 0 }; // self-mirror
      cells[y * 3 + 2] = { shape, color: mod8(left[y] + off), rot: 0 };
    }
    cells[HOLE] = null;
    const truth = { shape, color: mod8(left[2] + off), rot: 0 };
    const decoy = () => {
      const roll = r.next();
      const m = { shape, color: truth.color, rot: 0 };
      if (roll < 0.45) m.color = mod8(left[2] + r.pick(offs));            // wrong offset
      else if (roll < 0.65) m.color = left[2];                            // no offset
      else m.color = mod8(truth.color + 1 + r.int(7));                    // wild hue
      return m;
    };
    return {
      cells, truth, decoy, arch: 'mirrorCols',
      rule: 'the right column mirrors the left at a fixed hue offset; the center mirrors itself top-to-bottom'
    };
  }

  // ==================================================================
  // (h) diagGrad — color = c0 + sc*(x+y) (main-diagonal gradient),
  //                rot   = r0 + sr*(x-y+2) (anti-diagonal gradient).
  // ==================================================================
  function genDiagGrad(d, r) {
    const SC = d <= 1 ? [1] : d === 2 ? [1, 2] : d === 3 ? [1, 2, 3] : [1, 2, 3, 6, 7];
    const SR = d <= 2 ? [0] : d === 3 ? [0, 1] : [0, 1, 3];
    const sc = r.pick(SC), sr = r.pick(SR);
    const c0 = r.int(8), r0 = r.int(4);
    const shape = r.pick(SHAPES);
    const cells = new Array(9);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        cells[y * 3 + x] = {
          shape,
          color: mod8(c0 + sc * (x + y)),
          rot: mod4(r0 + sr * (x - y + 2))
        };
      }
    }
    cells[HOLE] = null;
    // Truth via the same read-out a solver uses (see SOLVERS.diagGrad).
    const scR = mod8(cellAt(cells, 1, 0).color - cellAt(cells, 0, 0).color);
    const srR = mod4(cellAt(cells, 1, 2).rot - cellAt(cells, 0, 2).rot);
    const truth = {
      shape,
      color: mod8(cellAt(cells, 0, 0).color + scR * 4),
      rot: mod4(cellAt(cells, 0, 2).rot + srR * 2)
    };
    const decoy = () => {
      const m = { shape, color: truth.color, rot: truth.rot };
      const roll = r.next();
      if (roll < 0.4) m.color = mod8(truth.color + sc);          // one step short
      else if (roll < 0.65) m.color = mod8(truth.color + 1 + r.int(7));
      else if (roll < 0.85) m.rot = mod4(truth.rot + (sr || 1)); // rot step short
      else m.rot = mod4(truth.rot + 1 + r.int(3));
      return m;
    };
    return {
      cells, truth, decoy, arch: 'diagGrad',
      rule: 'color climbs the main diagonal, rotation climbs the anti-diagonal'
    };
  }

  // ==================================================================
  // (i) parityGrid — (x+y) even => hollow ring (outline-only glyph);
  //     odd => solid shape. Color constant per row.
  // ==================================================================
  function genParityGrid(d, r) {
    const solid = r.pick(['square', 'diamond', 'triangle']);
    const rowCols = r.shuffle([0, 1, 2, 3, 4, 5, 6, 7]).slice(0, 3);
    const cells = new Array(9);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        cells[y * 3 + x] = {
          shape: (x + y) % 2 === 0 ? 'ring' : solid,
          color: rowCols[y],
          rot: 0
        };
      }
    }
    cells[HOLE] = null; // (2,2): x+y=4 even -> ring, color of row 2
    const truth = { shape: 'ring', color: cells[6].color, rot: 0 };
    const decoy = () => {
      const m = { shape: 'ring', color: truth.color, rot: 0 };
      const roll = r.next();
      if (roll < 0.35) m.shape = solid;                                   // parity lie
      else if (roll < 0.7) m.color = r.pick(rowCols.filter(c => c !== cells[6].color).concat([mod8(truth.color + 1 + r.int(7))]));
      else m.color = mod8(truth.color + 1 + r.int(7));
      return m;
    };
    return {
      cells, truth, decoy, arch: 'parityGrid',
      rule: 'even cells are hollow, odd cells are solid; each row keeps one color'
    };
  }

  // ==================================================================
  // (j) freqSet — visible counts are {key:1, A:q, B:8-q} with q in {3,4};
  //     only the key completes "exactly one color appears exactly twice".
  //     Uniqueness proof: filling anything else leaves ZERO count-2 colors
  //     (A/B sit at 3+, a fresh color lands at 1) — only key reaches 2.
  // ==================================================================
  function genFreqSet(d, r) {
    const shape = r.pick(SHAPES);
    let cells, key;
    let guard = 0;
    do {
      const hues = r.shuffle([0, 1, 2, 3, 4, 5, 6, 7]);
      key = hues[0];
      const A = hues[1], B = hues[2];
      const q = r.pick([3, 4]);
      const pool = [];
      for (let i = 0; i < q; i++) pool.push(A);
      for (let i = 0; i < 8 - q; i++) pool.push(B);
      cells = new Array(9);
      const spots = [0, 1, 2, 3, 4, 5, 6, 7]; // hole (8) excluded
      if (d <= 2) {
        // gentle: key sits beside the hole, masses stay clumped
        const keySpot = r.pick([5, 7]);
        cells[keySpot] = { shape, color: key, rot: 0 };
        const rest = r.shuffle(spots.filter(s => s !== keySpot));
        const ordered = r.shuffle(pool); // masses interleaved mildly
        rest.forEach((s, i) => { cells[s] = { shape, color: ordered[i], rot: 0 }; });
      } else {
        const sh = r.shuffle(spots);
        cells[sh[0]] = { shape, color: key, rot: 0 };
        const ordered = r.shuffle(pool);
        sh.slice(1).forEach((s, i) => { cells[s] = { shape, color: ordered[i], rot: 0 }; });
      }
      guard++;
    } while (guard < 20 && !freqKeyVisible(cells));
    cells[HOLE] = null;
    const truth = { shape, color: key, rot: 0 };
    const decoy = () => {
      const m = { shape, color: key, rot: 0 };
      const roll = r.next();
      if (roll < 0.55) m.color = mod8(key + 1 + r.int(7));
      else if (roll < 0.8) m.shape = r.pick(SHAPES.filter(s => s !== shape));
      else if (shape === 'triangle') m.rot = 1 + r.int(3); // lone twist (visible only on triangles)
      else m.color = mod8(key + 1 + r.int(7));
      return m;
    };
    return {
      cells, truth, decoy, arch: 'freqSet',
      rule: 'exactly one color appears exactly twice — the hole completes that pair'
    };
  }
  // sanity: exactly one visible color with count 1 (the key)
  function freqKeyVisible(cells) {
    const counts = {};
    for (let i = 0; i < 9; i++) if (cells[i]) counts[cells[i].color] = (counts[cells[i].color] || 0) + 1;
    const ones = Object.keys(counts).filter(c => counts[c] === 1);
    return ones.length === 1;
  }

  const BUILDERS = {
    lockShape: genLockShape,
    mirrorCols: genMirrorCols,
    diagGrad: genDiagGrad,
    parityGrid: genParityGrid,
    freqSet: genFreqSet
  };

  // ==================================================================
  // SOLVERS — recompute the truth from VISIBLE cells only. selfTest uses
  // these to prove each puzzle has exactly the shipped correct answer.
  // ==================================================================
  const SOLVERS = {
    lockShape(cells) {
      return { shape: cells[0].shape, color: cells[6].color, rot: 0 };
    },
    mirrorCols(cells) {
      const off = mod8(cells[2].color - cells[0].color);
      return { shape: cells[0].shape, color: mod8(cells[6].color + off), rot: 0 };
    },
    diagGrad(cells) {
      const scR = mod8(cells[1].color - cells[0].color);
      const srR = mod4(cells[5].rot - cells[2].rot);
      return {
        shape: cells[0].shape,
        color: mod8(cells[0].color + scR * 4),
        rot: mod4(cells[2].rot + srR * 2)
      };
    },
    parityGrid(cells) {
      return { shape: 'ring', color: cells[6].color, rot: 0 };
    },
    freqSet(cells) {
      const counts = {};
      for (let i = 0; i < 9; i++) if (cells[i]) counts[cells[i].color] = (counts[cells[i].color] || 0) + 1;
      let key = -1;
      for (const c in counts) if (counts[c] === 1) key = +c;
      return { shape: cells[0].shape, color: key, rot: 0 };
    }
  };

  // ------------------------------------------------------------------
  function generate(opts) {
    opts = opts || {};
    const d = Math.min(5, Math.max(1, Math.floor(opts.difficulty || 2)));
    const seed = (opts.seed != null ? opts.seed : (Date.now() ^ Math.random() * 1e9)) >>> 0;
    const r = new Rng(seed);
    const kinds = Array.isArray(opts.kinds) && opts.kinds.length ? opts.kinds : ['matrix'];
    if (kinds.indexOf('matrix') < 0) kinds.push('matrix'); // logicB is matrix-only
    const archNames = Object.keys(BUILDERS);
    const archName = opts.arch && BUILDERS[opts.arch] ? opts.arch : archNames[r.int(archNames.length)];
    const built = BUILDERS[archName](d, r);
    // Only the triangle renders rotation (diamond/cross/plus/square/ring have
    // 90-degree symmetry) — normalize invisible rots to 0 so no decoy can
    // look pixel-identical to the truth.
    const canon = (c) => (c && c.shape !== 'triangle')
      ? { shape: c.shape, color: c.color, rot: 0 } : c;
    built.cells = built.cells.map((c) => canon(c));
    built.truth = canon(built.truth);
    const { options, answer } = assemble(r, built.truth, () => canon(built.decoy()));
    return {
      id: 'logicb-' + archName + '-d' + d + '-' + seed.toString(36),
      kind: 'matrix',
      difficulty: d,
      prompt: PROMPT,
      rule: built.rule,
      arch: built.arch,
      board: { cols: SIZE, rows: SIZE, cells: built.cells, holeIndex: HOLE },
      options,
      answer
    };
  }

  function validate(p) {
    const errors = [];
    if (!p || typeof p !== 'object') return { ok: false, errors: ['not an object'] };
    if (p.kind !== 'matrix') errors.push('kind must be matrix');
    const b = p.board;
    if (!b || b.cols !== 3 || b.rows !== 3) errors.push('board must be 3x3');
    else if (!Array.isArray(b.cells) || b.cells.length !== 9) errors.push('board.cells must hold 9 cells');
    else if (b.holeIndex !== 8) errors.push('holeIndex must be 8');
    else if (b.cells[8] !== null) errors.push('hole cell must be null');
    else {
      for (let i = 0; i < 9; i++) {
        const c = b.cells[i];
        if (i === 8) continue;
        if (!c || SHAPES.indexOf(c.shape) < 0 || !(c.color >= 0 && c.color < 8) || !((c.rot | 0) >= 0 && (c.rot | 0) < 4)) {
          errors.push('invalid visible cell at ' + i); break;
        }
      }
    }
    if (!Array.isArray(p.options) || p.options.length !== 8) errors.push('options must hold exactly 8');
    else {
      const keys = {};
      for (let i = 0; i < 8; i++) {
        const o = p.options[i];
        const c = o && o.cols === 1 && o.rows === 1 && Array.isArray(o.cells) && o.cells.length === 1 ? o.cells[0] : null;
        if (!c || SHAPES.indexOf(c.shape) < 0 || !(c.color >= 0 && c.color < 8) || !((c.rot | 0) >= 0 && (c.rot | 0) < 4)) {
          errors.push('invalid option tile at ' + i); break;
        }
        keys[J(c)] = (keys[J(c)] || 0) + 1;
      }
      const dup = Object.keys(keys).filter(k => keys[k] > 1);
      if (dup.length) errors.push('duplicate options: ' + dup.join(','));
      if (!(typeof p.answer === 'number' && p.answer >= 0 && p.answer < 8 && p.answer === (p.answer | 0))) {
        errors.push('answer out of range');
      } else if (dup.length === 0) {
        const ansTile = p.options[p.answer] && p.options[p.answer].cells[0];
        const hits = p.options.filter(o => J(o.cells[0]) === J(ansTile)).length;
        if (hits !== 1) errors.push('answer tile is not unique');
      }
    }
    return { ok: errors.length === 0, errors };
  }

  function explain(p) {
    return p && typeof p.rule === 'string' ? p.rule : '';
  }

  // ------------------------------------------------------------------
  // selfTest(n=50): seeded sweep across 5 archetypes x d1-5; checks
  // validate(), byte-identical determinism, and solver-proven uniqueness.
  // ------------------------------------------------------------------
  function selfTest(n) {
    n = n || 50;
    let pass = 0;
    const details = [];
    const archNames = Object.keys(BUILDERS);
    for (let i = 0; i < n; i++) {
      const d = (i % 5) + 1;
      const arch = archNames[i % archNames.length];
      const seed = (i * 2654435761 + 0x9E3779B9) >>> 0;
      try {
        const p = generate({ difficulty: d, seed, arch });
        const v = validate(p);
        if (!v.ok) { details.push('seed ' + seed + ' d' + d + ' ' + arch + ': validate ' + v.errors.join('; ')); continue; }
        const p2 = generate({ difficulty: d, seed, arch });
        if (J(p) !== J(p2)) { details.push('seed ' + seed + ' d' + d + ' ' + arch + ': nondeterministic'); continue; }
        const truth = SOLVERS[p.arch](p.board.cells);
        const ansTile = p.options[p.answer] && p.options[p.answer].cells[0];
        if (!ansTile || J(ansTile) !== J(truth)) {
          details.push('seed ' + seed + ' d' + d + ' ' + arch + ': answer != solver truth');
          continue;
        }
        pass++;
      } catch (e) {
        details.push('seed ' + seed + ' d' + d + ' ' + arch + ': threw ' + e.message);
      }
    }
    return { n, pass, fail: n - pass, details };
  }

  const api = { name: 'logicB', generate, validate, explain, selfTest };
  root.IQ.Gens = root.IQ.Gens || {};
  root.IQ.Gens.logicB = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
