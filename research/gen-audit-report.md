# Generator Archetype Audit — QUALITY PASS (GenDoctor)

Method: `research/gen-audit-harness.js` — 20 seeded samples per archetype
(difficulty sweep 1..5) across all four owned generator packs, each checked
against an INDEPENDENT solver (truth recomputed from visible data / public
meta only). Bars: (a) one-sentence visually verifiable rule, (b) matrix hole
always bottom-right, (c) 8 distinct options, exactly one correct, decoys are
single-attribute mutations, plus a rotation-pile degeneracy detector
("rot is the only varying attribute") and a truth-copies-visible-cell probe.

Result line: `PASS/FIXED <arch> (N samples)`; harness exits non-zero on any
bar violation. Final run: **errors=0 across 16 archetypes (340 puzzles)**.

## gen_logic1.js — IQ.Gens.logicA

| Verdict | Archetype | Rule sentence | Notes |
|---|---|---|---|
| PASS | chain | shapes march one step along a fixed chain across each row | d>=4 adds per-row offset. Low-d period-3 cycles let the truth equal a visible cell — accepted easy-tier property, rule stays verifiable. |
| PASS | xor | two ghost layers overlap: the shade is their XOR (form their sum at d4+) | classic matrix archetype; decoy mutations stay single-attribute. |
| PASS | lattice | shades follow the diagonals, cycling through k hues | k grows 2→5 with difficulty (real difficulty knob). |
| **FIXED** | rotpile | every step turns the mark a quarter-turn while the shade deepens row by row (and drifts across it at d>=4) | WAS the QA degenerate family inside our own packs: shape+color frozen, only rot varied, truth tile byte-equal to cell 0 (copy cell 0 → win). Now two channels bind every tile; rs+cs constrained off 0 mod 4 so the truth never duplicates a visible cell; harness shows ZERO degeneracy flags. |
| PASS | cluster | each shade counts the marked neighbours around it | seed count scales with difficulty. |

## gen_logic2.js — IQ.Gens.logicB

| Verdict | Archetype | Rule sentence | Notes |
|---|---|---|---|
| **FIXED (critical)** | lockShape | low d: three fixed shades, one per band · high d: three fixed shades cycling steadily along the diagonals | The shipped ANSWER contradicted its own printed rule at EVERY d>=3: truth was copied off cells[6] (slot (x+y)%3=2) while the diagonal cycle demands slot 1 — a player who learned the stated pattern was marked wrong ~100% of the time at high tier. Truth is now derived from the slot rule; SOLVERS.lockShape recomputes it from visible cells; rule text states the actually-visible arrangement. |
| PASS | mirrorCols | right column mirrors the left at a fixed hue offset; center mirrors itself top-to-bottom | decoys = wrong offset / no offset / wild hue. |
| **FIXED (minor)** | diagGrad | color climbs the main diagonal, rotation climbs the anti-diagonal | one decoy branch mutated color AND rot (double mutation, bar-c violation); now single-attribute only. |
| PASS | parityGrid | even cells are hollow, odd cells are solid; each row keeps one color | truth always equals cells[6] (adjacent ring) — accepted easy tell; decoys carry the parity lie. |
| **FIXED (minor)** | freqSet | exactly one color appears exactly twice — the hole completes that pair | removed a color+rot double-mutation decoy branch; rot-only twist now restricted to triangles (invisible on 90°-symmetric shapes). |

Pack-wide logicB fix: rotations are normalized to 0 whenever the shape has
90-degree symmetry (everything except triangle) — previously a decoy could
render pixel-identical to the truth while differing in JSON ("two right
answers" on screen).

## gen_seqpack.js — IQ.Gens.seqPack

| Verdict | Family | Rule sentence | Notes |
|---|---|---|---|
| PASS | arith | colors advance by the same step each time | classic arithmetic sequence. |
| PASS | geo3 | each color holds one run, every run lasts twice the previous (d3+) | chain length forced strictly inside a run (geo3Len) so the continuation is unique. |
| **FIXED** | rotAccum | steady beat: mark quarter-turns by a fixed beat while the shade deepens every second step · hard: each turn sweeps further — one, two, three quarters, round again — as the shade deepens every second step | WAS rotation-family #2: single-channel rotation pile as a sequence, and the fib-mod-4 hard mode produced CONSECUTIVE DUPLICATE tiles (a==0 ⇒ t(n)==t(n+1)). Shade channel added (color = c0 + floor(i/2)); fib replaced with widening turns (+1,+2,+3 cycling, steps never 0). Zero degeneracy flags; validate()'s independent expand() recompute still proves the shipped answer. |
| PASS | dual | color moves on one turn, rotation moves on the next, alternating | two interleaved channels. |
| PASS | ladder | shapes climb the ladder plus-ring-square-triangle while colors keep stepping | two channels. |
**Pack-wide visibility pass (logicA + seqPack, browser-verified):** only the
triangle renders rotation (all other shapes have 90-degree symmetry), so
(1) every rotation-bearing family — logicA `rotpile`, seqPack `rotAccum`,
`dual` — now wears the triangle, and (2) on rotation-frozen families the
invisible rot is canonicalized to 0 and decoy rot-mutants are redirected to
shape mutations. Before this, a rot-mutant decoy on a diamond/plus/square
board rendered pixel-identical to the truth — two visually-correct options,
the same "near-identical options" class as the QA report.

## gen_missing.js — IQ.Gens.missingSec

| Verdict | Family | Rule sentence | Notes |
|---|---|---|---|
| **FIXED** | missing section | e.g. "each band of the field keeps one face color" (+ rotation/spacing clauses) | The removed SECTION position was RANDOM (`r.int(BGX/BGY)`) — this is the QA screenshot's TOP-LEFT hole. Pinned to bottom-right unconditionally (original-site convention); `validate()` now rejects any other holeIndex. Decoy sections remain phase-shift/orientation/color single-mutations; 40-sample re-audit clean. |

## modes/mode-puzzle.js — generator tables (table lines only)

- `'rotate'` DEMOTED OUT of every tier. It fails bar (c) structurally — its own
  header admits "the 8 options necessarily repeat wrong rots" (only 4 rot
  states exist) — and fails bar (b) with `holeIndex = r.int(cols*rows)`
  (gen_rotate.js:144). This is the exact puzzle in
  `research/refs/qa-depth6-puzzle.webp`: triangle-only grid, hole anywhere,
  near-identical options.
- iqb kept/boosted dominant early (tier<=2), latin/cycle retained beside it;
  count/dual/wild weights untouched; retroA/retroB gate untouched.
- **HANDOFF (not my files):** `modes/floorfall.js`, `modes/hunterdodge.js`,
  `modes/laserstorm.js`, `modes/dronedodge.js` carry copy-pasted tables that
  still include `'rotate'`; and `gen_rotate.js` itself needs an owner fix
  (bottom-right hole, >4 genuinely distinct option states) before it can be
  re-tabled anywhere.

## Accepted properties (documented, not defects)

- Periodic families (chain/xor/lattice/cluster/parityGrid/freqSet/geo3) can
  place a tile equal to the truth among visible cells — inherent to small-period
  cycles, matches real Raven's-style matrices; the RULE remains the arbiter and
  all 8 OPTIONS stay distinct with exactly one correct under the independent
  solvers.
- The two rebuilt families (rotpile, rotAccum) guarantee the truth NEVER
  duplicates a visible cell — verified at 0 flags over the full sample sweep.
