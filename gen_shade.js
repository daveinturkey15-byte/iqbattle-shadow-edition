/* IQ.Gens2['shade'] — SHADE-STEP variant for IQ BATTLE.
 *
 * Philosophy: ONE hue, ONE shape, one idea. Every tile shares the same shape
 * and rot; only the palette index moves, stepping through a single tint
 * family in a FIXED ORDER — base -> light -> dark — using palette-index
 * arithmetic as the tint proxy:
 *   family(hue) = [hue, (hue+2)%8, (hue+5)%8]
 * The step advances one family slot per axis position (constant signed step,
 * mod 3, never zero). Boards are always 3x3: each axis line shows the full
 * base/light/dark cycle, so the rule is discoverable in seconds.
 *
 * Drop-in contract (matches IQ.Puzzles):
 *   Gen.generate({difficulty, kind, seed}) ->
 *     {id, kind, difficulty, prompt, rule, board|seq|oddBoard, options:[8], answer}
 *   Gen.validate(p) -> {ok, errors}
 *   Gen.selfTest(n=100) -> {pass, fail, details}
 * Deterministic: same seed -> byte-identical puzzle.
 *
 * Decoy note: with shape and rot frozen, decoys are COLOR-only lies —
 *   - wrong step ORDER: the two off-position family shades (light where dark
 *     belongs, etc.), and
 *   - SKIP shades: palette indices outside the family entirely (+1/+3/+4
 *     jumps that "skip" ahead of the true progression).
 * Exactly one option carries the rule-satisfying shade; decoys may repeat
 * shades but NEVER the answer's.
 */
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};

  const KINDS = ['matrix', 'sequence', 'oddone'];
  const SHAPES = ['plus', 'ring', 'square', 'triangle', 'diamond', 'cross'];

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
    chance(p) { return this.next() < p; }
    pick(arr) { return arr[this.int(arr.length)]; }
  }
  function shuffle(r, arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = r.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // --- shade arithmetic ---
  const mod3 = (x) => ((x % 3) + 3) % 3;
  // Tint-family proxy for a hue: [base, light, dark].
  const family = (hue) => [mod8(hue), mod8(hue + 2), mod8(hue + 5)];
  function mod8(x) { return ((x % 8) + 8) % 8; }
  // Which family slot (0..2) does this palette index occupy for this hue? -1 if off-family.
  function slotOf(fam, color) {
    for (let s = 0; s < 3; s++) if (fam[s] === color) return s;
    return -1;
  }
  const tileOf = (shape, fam, state) => ({ shape, color: fam[mod3(state)], rot: 0 });

  // Human-readable rule sentence — mirrors IQ.Puzzles tone.
  function stepWords(step, axisWord) {
    const dir = step === 1 ? 'deepens' : 'lifts';
    const order = step === 1 ? 'base, then light, then dark' : 'dark, then light, then base';
    return `one hue only — every ${axisWord} ${dir} one shade: ${order}, cycling`;
  }
  function kindTail(kind) {
    return kind === 'matrix'
      ? '. One space is hollow — choose the tile that seals it.'
      : kind === 'sequence'
        ? '. Choose what comes next.'
        : '. Every tile obeys — except one. Find the impostor.';
  }

  const PROMPTS = [
    [ // difficulty 1-2
      'Shading audit. One hue, three depths. File the correct depth.',
      'A routine toner test. The shade knows where it belongs. Help it.',
    ],
    [ // difficulty 3-4
      'The hue drains whether you watch or not. Predict its next depth.',
      'Something in this grid keeps sinking. Choose the shade that completes it.',
    ],
    [ // difficulty 5
      'THE COLOR IS LEAVING. FEED THE GRID ITS LAST TRUE SHADE.',
      'IT HAS BEEN DARKENING THIS WHOLE TIME. SHADE IT OR BE SHADED.',
    ],
  ];

  // Signed step along the 3-slot family: 1 (base->light->dark) or 2 (= backwards).
  function pickStep(d, r) {
    if (d <= 2) return 1;
    return r.chance(0.65) ? 1 : 2;
  }

  // Axis coordinate for matrix position.
  const posAt = (axis, i, j) => (axis === 'column' ? i : j);
  // Recover (step, baseState) for a run of observed slots at positions p[].
  // slots[k] may be null (hole); returns null when no constant step fits.
  function fitRule(obs) {
    for (const step of [1, 2]) {
      for (let b = 0; b < 3; b++) {
        let ok = true;
        for (const { p, slot } of obs) {
          if (slot === null || slot === undefined) continue;
          if (mod3(b + step * p) !== slot) { ok = false; break; }
        }
        if (ok) return { step, baseState: b };
      }
    }
    return null;
  }

  // Decoy shades: wrong-step-order family members + off-family skip shades.
  // Never includes the correct color; repeats allowed (only 7 other shades exist).
  function makeOptions(correctTile, fam, d, r) {
    const wrongOrder = shuffle(r, fam.filter((c) => c !== correctTile.color));
    const skips = shuffle(r, [0, 1, 2, 3, 4, 5, 6, 7]
      .filter((c) => slotOf(fam, c) === -1 && c !== correctTile.color));
    // Higher difficulty leans harder on subtle wrong-order decoys.
    const bias = d <= 2 ? 0.4 : d <= 4 ? 0.6 : 0.75;
    const pool = [];
    let oi = 0, si = 0;
    for (let i = 0; i < 7; i++) {
      const useOrder = (oi < wrongOrder.length) && (si >= skips.length || r.f() < bias);
      pool.push(useOrder ? wrongOrder[oi++ % wrongOrder.length] : skips[si++ % skips.length]);
    }
    const answer = r.int(8);
    const options = pool.map((color) => ({ shape: correctTile.shape, color, rot: 0 }));
    options.splice(answer, 0, { shape: correctTile.shape, color: correctTile.color, rot: 0 });
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
    const hue = r.int(8);
    const fam = family(hue);
    const shape = r.pick(SHAPES);
    const step = pickStep(difficulty, r);
    const baseState = r.int(3);
    const axis = r.chance(0.5) ? 'column' : 'row';
    const axisWord = axis; // tiles advance down/across the named line
    const prompt = r.pick(PROMPTS[difficulty <= 2 ? 0 : difficulty <= 4 ? 1 : 2]);

    const shadeAt = (t) => tileOf(shape, fam, baseState + step * t);

    const puz = {
      id: `iq-${kind}-${difficulty}-shade-${seed.toString(36)}`,
      kind,
      difficulty,
      prompt,
      rule: stepWords(step, axisWord) + kindTail(kind),
    };

    if (kind === 'matrix') {
      const hi = r.int(3);
      const hj = r.int(3);
      const cells = [];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          cells.push(i === hi && j === hj ? null : shadeAt(posAt(axis, i, j)));
        }
      }
      puz.board = { cols: 3, rows: 3, cells, holeIndex: hi * 3 + hj };
      Object.assign(puz, makeOptions(shadeAt(posAt(axis, hi, hj)), fam, difficulty, r));
    } else if (kind === 'sequence') {
      const len = difficulty <= 2 ? 3 : difficulty <= 4 ? 4 : 5;
      const seq = [];
      for (let t = 0; t < len; t++) seq.push(shadeAt(t));
      puz.seq = seq;
      Object.assign(puz, makeOptions(shadeAt(len), fam, difficulty, r));
    } else { // oddone
      const oddIndex = r.int(9);
      const oi = Math.floor(oddIndex / 3);
      const oj = oddIndex % 3;
      const cells = [];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) cells.push(shadeAt(posAt(axis, i, j)));
      }
      // Impostor: any shade EXCEPT the rule's prediction for its position.
      const expected = shadeAt(posAt(axis, oi, oj)).color;
      const bad = shuffle(r, [0, 1, 2, 3, 4, 5, 6, 7].filter((c) => c !== expected))[0];
      cells[oddIndex] = { shape, color: bad, rot: 0 };
      puz.oddBoard = { cols: 3, rows: 3, cells, oddIndex };
      Object.assign(puz, makeOptions(cells[oddIndex], fam, difficulty, r));
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

    // Options: exactly 8 well-formed tiles, ONE shape/rot throughout, answer unique.
    if (!Array.isArray(p.options) || p.options.length !== 8) {
      push('options must hold exactly 8 entries');
    } else if (!p.options.every(isCell)) {
      push('option malformed');
    } else {
      if (new Set(p.options.map((o) => o.shape)).size !== 1) push('options vary shape — shade variant pins shape');
      if (new Set(p.options.map((o) => o.rot)).size !== 1) push('options vary rot — shade variant pins rot');
      if (!Number.isInteger(p.answer) || p.answer < 0 || p.answer > 7) push('bad answer index');
    }

    const keyOf = (c) => (isCell(c) ? `${c.shape}:${c.color}:${c.rot}` : '');

    // Fit the shade rule against observed (position, family-slot) pairs.
    const fitAgainst = (fam, obs) => {
      const fitted = fitRule(obs.map(({ p: q, color }) => ({ p: q, slot: slotOf(fam, color) })));
      if (!fitted) return null;
      // Off-family colors anywhere (except a sanctioned impostor) break the hue.
      for (const { color } of obs) {
        if (color != null && slotOf(fam, color) === -1) return null;
      }
      return fitted;
    };
    const axisFromRule = () => (/column/.test(p.rule) ? 'column' : 'row');

    // Infer the single hue: which tint family contains EVERY observed shade?
    // Full cycles expose all 3 slots, so the family (and hue) is unique.
    function inferHue(obsColors) {
      const distinct = [...new Set(obsColors)];
      const hits = [];
      for (let h = 0; h < 8; h++) {
        const fam = family(h);
        if (distinct.every((c) => slotOf(fam, c) !== -1)) hits.push(h);
      }
      return hits.length === 1 ? hits[0] : -1;
    }

    const checkGrid = (g, label) => {
      if (!g || typeof g !== 'object') { push(`${label} missing`); return false; }
      const { cols, rows, cells } = g;
      if (cols !== 3 || rows !== 3) { push(`${label} must be 3x3`); return false; }
      if (!Array.isArray(cells) || cells.length !== 9) { push(`${label} cells malformed`); return false; }
      if (!cells.every((c) => c === null || isCell(c))) { push(`${label} malformed cells`); return false; }
      const solid = cells.filter((c) => c !== null);
      if (!solid.length) { push(`${label} has no visible cells`); return false; }
      if (new Set(solid.map((c) => c.shape)).size > 1) push(`${label} varies shape`);
      if (new Set(solid.map((c) => c.rot)).size > 1) push(`${label} varies rot`);
      return true;
    };

    if (p.kind === 'matrix') {
      if (!checkGrid(p.board, 'board')) return { ok: false, errors };
      const { cells, holeIndex } = p.board;
      if (!Number.isInteger(holeIndex) || holeIndex < 0 || holeIndex >= 9
        || cells[holeIndex] !== null) { push('holeIndex wrong'); return { ok: false, errors }; }
      if (cells.filter((c) => c === null).length !== 1) { push('board needs exactly one hole'); return { ok: false, errors }; }
      const axis = axisFromRule();
      const obsColors = cells.filter((c) => c !== null).map((c) => c.color);
      const hue = inferHue(obsColors);
      if (hue === -1) { push('no single hue family fits the visible shades'); return { ok: false, errors }; }
      const fam = family(hue);
      const obs = [];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const c = cells[i * 3 + j];
          if (c !== null) obs.push({ p: posAt(axis, i, j), color: c.color });
        }
      }
      const fit = fitAgainst(fam, obs);
      if (!fit) { push('board does not follow one constant shade step'); return { ok: false, errors }; }
      const hi = Math.floor(holeIndex / 3);
      const hj = holeIndex % 3;
      const predicted = tileOf(cells.find((c) => c !== null).shape, fam, fit.baseState + fit.step * posAt(axis, hi, hj));
      if (Array.isArray(p.options) && p.options.every(isCell) && Number.isInteger(p.answer)) {
        const winners = p.options.filter((o) => keyOf(o) === keyOf(predicted));
        if (winners.length !== 1) push(`rule admits ${winners.length} options — must admit exactly 1`);
        else if (keyOf(p.options[p.answer]) !== keyOf(predicted)) push('answer does not satisfy the shade rule at the hole');
      }
    } else if (p.kind === 'sequence') {
      if (!Array.isArray(p.seq) || p.seq.length < 3 || p.seq.length > 5) push('seq length out of range');
      else if (!p.seq.every(isCell)) push('seq holds malformed cells');
      else {
        const hue = inferHue(p.seq.map((c) => c.color));
        if (hue === -1) { push('no single hue family fits the sequence'); return { ok: false, errors }; }
        const fam = family(hue);
        const obs = p.seq.map((c, t) => ({ p: t, color: c.color }));
        const fit = fitAgainst(fam, obs);
        if (!fit) push('seq does not follow one constant shade step');
        else if (Array.isArray(p.options) && p.options.every(isCell) && Number.isInteger(p.answer)) {
          const predicted = tileOf(p.seq[0].shape, fam, fit.baseState + fit.step * p.seq.length);
          const winners = p.options.filter((o) => keyOf(o) === keyOf(predicted));
          if (winners.length !== 1) push(`rule admits ${winners.length} options — must admit exactly 1`);
          else if (keyOf(p.options[p.answer]) !== keyOf(predicted)) push('answer does not continue the shade rule');
        }
      }
    } else { // oddone
      if (!checkGrid(p.oddBoard, 'oddBoard')) return { ok: false, errors };
      const { cells, oddIndex } = p.oddBoard;
      if (!Number.isInteger(oddIndex) || oddIndex < 0 || oddIndex >= 9) { push('oddIndex wrong'); return { ok: false, errors }; }
      const axis = axisFromRule();
      const kept = cells.filter((_, idx) => idx !== oddIndex);
      const keptColors = kept.map((c) => c.color);
      const hue = inferHue(keptColors);
      if (hue === -1) { push('no single hue family fits the oddBoard majority'); return { ok: false, errors }; }
      const fam = family(hue);
      const obs = [];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          if (i * 3 + j === oddIndex) continue;
          obs.push({ p: posAt(axis, i, j), color: cells[i * 3 + j].color });
        }
      }
      const fit = fitAgainst(fam, obs);
      if (!fit) { push('oddBoard majority does not follow one constant shade step'); return { ok: false, errors }; }
      const oi = Math.floor(oddIndex / 3);
      const oj = oddIndex % 3;
      const expected = tileOf(kept[0].shape, fam, fit.baseState + fit.step * posAt(axis, oi, oj)).color;
      const impostor = cells[oddIndex];
      if (!impostor) push('oddone impostor cell missing');
      else if (impostor.color === expected) push('impostor obeys the rule — not an impostor');
      if (Array.isArray(p.options) && p.options.every(isCell) && Number.isInteger(p.answer)) {
        const winners = p.options.filter((o) => keyOf(o) === keyOf(impostor));
        if (winners.length !== 1) push(`rule admits ${winners.length} options — must admit exactly 1`);
        else if (keyOf(p.options[p.answer]) !== keyOf(impostor)) push('answer is not the impostor cell');
      }
    }
    return { ok: errors.length === 0, errors };
  }

  function explain(p) {
    return p && typeof p.rule === 'string' ? p.rule : '';
  }

  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // Self-test: n puzzles across all kinds x difficulties; validate + determinism
  // + answer-uniqueness + decoys-differ-only-in-shade (shape/rot frozen).
  function selfTest(n = 100) {
    let fail = 0;
    const details = [];
    for (let t = 0; t < n; t++) {
      const kind = KINDS[t % 3];
      const difficulty = (t % 5) + 1;
      const seed = 0x9e3779b9 ^ (t * 2654435761);
      try {
        const p = generate({ kind, difficulty, seed });
        const v = validate(p);
        if (!v.ok) { fail++; details.push(`#${t} ${kind} d${difficulty}: validate: ${v.errors.join('; ')}`); continue; }
        if (!eq(p, generate({ kind, difficulty, seed }))) { fail++; details.push(`#${t}: nondeterministic`); continue; }
        const proto = p.options[p.answer];
        const key = (c) => JSON.stringify(c);
        if (p.options.filter((o) => key(o) === key(proto)).length !== 1) {
          fail++; details.push(`#${t}: answer not unique among options`); continue;
        }
        const badDecoy = p.options.some((o, i) => i !== p.answer
          && (o.shape !== proto.shape || o.rot !== proto.rot));
        if (badDecoy) { fail++; details.push(`#${t}: decoy varies shape/rot`); continue; }
      } catch (e) {
        fail++; details.push(`#${t}: threw ${e.message}`);
      }
    }
    return { pass: n - fail, fail, details: details.slice(0, 10) };
  }

  const Gen = { name: 'shade', generate, validate, explain, selfTest };
  root.IQ.Gens2 = root.IQ.Gens2 || {};
  root.IQ.Gens2.shade = Gen;
  if (typeof module !== 'undefined') module.exports = Gen;
})();
