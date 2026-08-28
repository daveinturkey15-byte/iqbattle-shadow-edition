# PANDemonium Gauntlet — Unified Engine Spec

*Author: EngineSpec. This is the contract Main integrates the expansion lanes against.*

**Sources (merged):**
- **(a) v1 capture** — PuzzleResearch's original-site capture (raw evidence: headless-profile localStorage keys `rsh_caps` = gauntlet-1, `rsh2_0..9` + `rsh2_idx` = gauntlet-2 with per-tile base64 PNGs; report delivered to Main).
- **(b) sibling specialist contracts** — `gen_morph.js` (GenMorph), `gen_sets.js` (GenSets), `gen_shade.js` (GenShade). All three verified live on disk: each registers into `IQ.Gens2`, `generate({difficulty,seed})` returns a valid puzzle, `validate(p) → {ok,errors[]}` passes.
- **(c) engine cell shape** — `puzzles.js` / `gen_iqb.js`: cell `{shape,color,rot}`, tile `{cols,rows,cells}`.

---

## 0. Module registration contract

Every generator is an IIFE registering:

```js
root.IQ.Gens2[rootName] = { name, generate(opts), validate(p), selfTest?, explain? };
```

- `generate({difficulty 1..5, seed uint32, kind?})` → puzzle envelope (§1). Same seed ⇒ byte-identical puzzle.
- `validate(p)` → `{ok:boolean, errors:string[]}` — structural §6 checks **plus** its archetype's semantic rule check (§7).
- `selfTest(n=100)` → `{pass, fail, details}` — validate + determinism + uniqueness across kinds × difficulties. Run via `node gen_<name>.js`.
- RNG: mulberry32 exactly as `IQ.Puzzles` (`a|=0; a=(a+0x6D2B79F5)|0; t=Math.imul(a^(a>>>15),1|a); …`), wrapped in an `Rng{f,int,chance,pick,range,shuffle}` helper. Seed derivation: `(opts.seed != null ? opts.seed : (Date.now() ^ Math.random()*1e9)) >>> 0`; seed echoed in `id`.

> **Legacy note:** `gen_iqb.js` and `gen_latin.js` assign `root.IQ.GenV = api`, overwriting each other on load order. New modules MUST use the `IQ.Gens2[name]` namespace above; Main's gauntlet runner reads `IQ.Gens2` only.

## 1. Core data model

```js
cell  = { shape: 'plus'|'ring'|'square'|'triangle'|'diamond'|'cross',
          color: int 0..7,        // palette index, §3
          rot:   int 0..3 }       // quarter-turns clockwise
tile  = { cols: int ≥1, rows: int ≥1, cells: (cell|null)[cols*rows] }  // row-major
board = { cols: int, rows: int, cells: (cell|nestedTile|null)[], holeIndex }
```

Puzzle envelope (all archetypes):

```js
{ id, kind:'matrix'|'sequence'|'oddone', difficulty 1..5,
  prompt, rule,
  board | seq:[cell] | oddBoard:{cols,rows,cells,oddIndex},
  options:[8],           // matrix → tiles, sequence/oddone → cells
  answer: 0..7 }
```

**Nested-tile standard (morph parameter encoding)** — every board entry AND option of a morph puzzle is a nested tile whose leaves are plain cells or `null`:

- Exactly **one nesting level** — no tile-in-tile-in-tile (renderer recursion path `tileSVG` handles one level only).
- Leaf `null` renders as a faint background rect = visible frame extent (not empty space).
- Mark offset = leaf sub-index in row-major reading order inside the nested tile.

Per-axis encodings (L = sequence period ∈ {3,4}; board cell p shows frame `p mod L`):

| Axis | Tile shape | Parameter |
|---|---|---|
| scale | `{cols:S, rows:S}`, S∈1..4, single mark at sub-index 0, rest null | span S grows/shrinks monotonically along reading order (spans sorted asc or desc) |
| rotate | `{cols:1, rows:1}` | leaf `rot:(base+step*p)%4`, step 1; step 3 (ccw) allowed at difficulty ≥4; shape pinned `triangle` by design |
| position | L=3 → dims `[3,1]`, mark at sub-index `p%3`; L=4 → dims `[2,2]`, corner orbit `[0,1,3,2]` clockwise | drift offset via padding |
| squash | fully filled tiles, width≠height; L=3 seq `[[3,1],[2,2],[1,3]]`, L=4 `[[3,1],[2,1],[1,2],[1,3]]`, random `[c,r]→[r,c]` flip | aspect swap |

Morph invariants: color constant across ALL leaves of board + options; frames pairwise distinct (that is how validate recovers L).

## 2. Archetype matrix (difficulty × kind × archetype)

Seven canonical ids (capture-faithful): `colorRow`, `colorCol`, `latinSquare3`, `hueStepDiag`, `monoGlyphSequence`, `morphSquashStretch`, `setCompletion`. Plus engine-native `shadeStep` (tint-family variant of hue stepping).

| Archetype | Kind(s) | Grid by difficulty | Hole | Attribute(s) varied | Stage gate (G.stage) |
|---|---|---|---|---|---|
| colorRow | matrix | d1: 2×2 · d2+: 3×3 | bottom-right (`n−1`) | color per row (one hue/row) | 0 (entry archetype) |
| colorCol | matrix | same | bottom-right | color per column | 0 |
| latinSquare3 | matrix | 2×2 (hues=2) · 3×3 (hues=3) | bottom-right | color = `(x+y)%h` Latin square | 1 |
| hueStepDiag | matrix | 3×3 | bottom-right | color steps +k along reading order | 1 |
| monoGlyphSequence | sequence | len 3 (d≤2) · 4 · 5 (d5) | — (next-item) | color along cycle, fixed glyph | 0–1 |
| shadeStep | matrix 3×3 always · sequence 3–5 · oddone 3×3 | fixed 3×3 | bottom-right / next / impostor | tint family `[h,(h+2)%8,(h+5)%8]`, constant step mod 3; shape+rot frozen | 1–2 |
| setCompletion | matrix | d1–2: 3×3 const color · d3: 3×3 per-class · d4: 4×4 const · d5: 4×4 per-class | bottom-right | class membership (Latin square over shapes / style classes); rot pinned 0 | 2 |
| morphSquashStretch | matrix | 3×3 always; L=3 (d≤3), L=4 (d≥4) | index 8 | single transform axis (scale/rotate/position/squash); color frozen | 2–3 |

Difficulty ladder conventions shared by all modules:
- Difficulty scales: grid size, period L, prompt tier, decoy subtlety, and (shade/morph) step direction trickiness (ccw/backwards allowed at d≥4).
- Prompts follow the three-tier menace register already established in `puzzles.js` PROMPTS (corporate → corrupted → full hell).

Timers (from capture): easy rounds **18–31 s**, hard rounds **60 s**; lobby defaults **10 rounds / 60 s timer**.

## 3. Palette & glyph vocabulary

Core hues (capture order, indices 0–6):

| idx | hex |
|---|---|
| 0 | `#e73d23` |
| 1 | `#e02e6f` |
| 2 | `#1dbf3d` |
| 3 | `#8518d8` |
| 4 | `#e66814` |
| 5 | `#049baf` |
| 6 | `#d1b815` |

Tint/shade variants are same-hue lighter/darker fills (capture examples `#f09dbc/#660f2f/#f5b88e/#5e2a08`). The engine encodes them by **palette-index arithmetic**, never raw hex: `family(hue) = [hue, (hue+2)%8, (hue+5)%8]` read as [base, light, dark].

Glyph vocab (capture): square, h-bar, v-bar, circle, ellipse, ring, hollow-square, diamond, triangle-up/down, crossX, plus, D-shape, thin-squiggle. Engine mapping: the six `SHAPES` names cover the core set; tiles are flat fills over the subtle dot-grid backdrop, 220 px/tile, single-image mode fuses 8 tiles into one panel with the hole slot cut out.

> **OPEN for Main/GfxBoard:** value domain is mod 8 but the captured core palette has 7 hues. Index 7 is legal output (e.g. `family(2)` dark = 7) and currently has NO mapped hex. Either pin a hex for index 7 (recommend an ash/void tone fitting stage-3 palette) or clamp shade-family arithmetic to emit only 0..6. Decide before integration; generators must not change.

## 4. Decoy generation rules per archetype

Universal invariants (all archetypes):
- Exactly **one** rule-satisfying option among the 8; it sits at `options[answer]`, answer slot uniform-random.
- Options pairwise unique under canonical key (order-insensitive JSON deep-equal).
- **Deliberate divergence from capture:** the original site sometimes ships duplicate correct-looking options (observed 3 identical). We do NOT — uniqueness is enforced by every validator. Better UX, and reveal highlighting needs distinct nodes.

| Archetype | Decoy recipe (priority order) |
|---|---|
| colorRow/colorCol/latinSquare3/hueStepDiag | wrong hue from palette (60%) > sibling glyph same category (20%) > stray rotation (20%); near-miss ratio ~4–6 of 8; higher difficulty biases to ±1-step hue errors |
| monoGlyphSequence | off-cycle hue (+k wrong k), then shape-category error; never break the fixed glyph mid-options |
| shadeStep | COLOR-only lies (shape/rot frozen): wrong step order = the two off-position family shades; skip-shades = off-family indices (+1/+3/+4 jumps). Answer's shade appears exactly once; decoy repeats allowed |
| setCompletion | EVERY distractor repeats a class already present in the hole's row (duplicate-class-in-row violation); only rot may differ from the answer |
| morphSquashStretch | wrong continuations first: freeze-on-last-frame, backward overshoot, off-progression param values; then corruptions: tint shift, stray rot, doubled mark. Never the truth |

Near-miss budget (engine-wide): 1–2 near-misses (single-attribute mutation) per 8 options at low difficulty, rest harder multi-attribute mutations — matches `puzzles.js makeOptions` and the captured ~4–6-of-8 ratio.

## 5. Corruption interaction (host-side, post-generation)

Board corruption (`chaos-balance.md`) hue-shifts ONE non-hole cell AFTER generation and must never touch options. Corrupt shifts use mod-8 arithmetic; validators run on the PRE-corruption puzzle. Impossible rounds (`imp` flag) ship all-correct-looking options — they bypass §7 semantic validation deliberately and are host-pre-committed, never client-re-rolled.

## 6. Universal validation rules

Structural envelope (every module's `validate`):
1. `id` non-empty string containing seed; `kind` ∈ KINDS; `difficulty` int 1..5; `prompt`, `rule` non-empty strings.
2. `options.length === 8`, pairwise canonically-distinct, `answer` int 0..7.
3. Cell well-formedness: `shape` ∈ SHAPES, `color` int 0..7, `rot` int 0..3.
4. Tile well-formedness: `cols`,`rows` ≥ 1, `cells.length === cols*rows`, all entries valid cells (or `null` for nested-tile padding).
5. Board grids: dims within archetype's §2 row; exactly one hole; `holeIndex` points at the null; oddone boards fully populated with valid `oddIndex`. Sequence `seq` length 3..5, no holes.
6. Nested tiles (morph): exactly one nesting level; leaf count matches dims; color constant across all leaves of board + options.

> **Change vs `puzzles.js` validator:** current `checkGrid` requires cols/rows ≥ 3. Capture-faithful generators emit 2×2 easy boards. Main's integrated validator MUST accept dims 2..5 for matrix boards.

Semantic rules (per archetype — see §7): recomputed-from-visible-board rule recovery + rule-uniqueness.

Self-test gate: `selfTest(100)` must show zero fails across kinds × difficulties before a generator is considered shippable.

## 7. Rule-uniqueness (the load-bearing invariant)

Each generator's validate recomputes the expected answer purely from VISIBLE cells (never from generation state) and requires:

- **Exactly one** option deep-equals the recomputed expectation;
- that option IS `options[answer]`.

Implementations:
- latin/shade: scan both axes × all steps k against visible gaps; hole color must be the UNIQUE rule-admitting candidate (`acceptableHoleColors` pattern from `gen_latin.js`; shade restricts to family membership, recovering `(base,step) mod 3`).
- sets: hole's row and column each miss exactly one class, both the SAME class, equal to the answer; every decoy violates the set rule.
- morph: detect period L∈{3,4} from pairwise-distinct visible frames; expected = `frames[8 % L]`; exactly one option matches canonically.
- capture-faithful four (`colorRow/colorCol/latinSquare3/hueStepDiag`): derive truth from the hole's row/column/(x+y)/reading-order position as in `gen_iqb.js`; decoys must fail the derived rule under the §4 priority mutations.

Determinism check: `JSON.stringify(generate({difficulty:d, seed:s}))` identical across two calls, for sampled (d,s) pairs — part of selfTest.

## 8. Reveal contract (UI parity)

After answering, option nodes receive exactly one of: `-correct-reveal` (the true tile), `-self-wrong-reveal` (player's pick when wrong), `-dimmed` (everything else). All archetypes share this; single-image mode dims fused sub-tiles equivalently.

---

### Integration checklist for Main
1. Registry: read `IQ.Gens2` only; ignore legacy `IQ.GenV` overwrites (or shim `GenV → Gens2` once, in the loader, not in modules).
2. Relax board-dims floor to 2 (§6 note) if reusing `puzzles.js validate` as the universal gate.
3. Resolve palette index 7 (§3 OPEN) before wiring the renderer.
4. Per-round archetype pick keyed to `G.stage` via §2 gate column; corruption/impossible layers applied strictly post-validation per §5.
5. Ship-gate each lane on its `selfTest(100)` result.
