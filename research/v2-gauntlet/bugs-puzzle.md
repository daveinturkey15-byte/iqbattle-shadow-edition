# V2 PUZZLE GAUNTLET — bugs-puzzle.md

Ticket: deep-playthrough bot of the v2 puzzle flow (`http://127.0.0.1:8792`) + headless family probe.
Owner: BugPuzzle. Date: 2026-08-26. READ-ONLY audit of game code — no game file was modified.

## Method & tooling (evidence of thoroughness)

- **Headless unit probe** — `research/v2-gauntlet/probe-puzzle.ts` (run: `node --experimental-strip-types research/v2-gauntlet/probe-puzzle.ts`):
  all **9 families × 200 seeds × diff 1..5** (1,000 boards/family, 9,000 total): option count/distinctness,
  hole position, independent-solver agreement, DNA density cap (≤24 marks/cell), decoy visual distance
  (64×64 rasterization + IoU per answer/decoy pair), seed-sensitivity, and the `dealPuzzle` depth→(family,hue,diff) meta-loop.
- **Collision detail probes** — `research/v2-gauntlet/probe-collide.ts`, `probe-lrfreq.ts` (500 seeds × diff 1/3/5 frequency count).
- **Live browser playthrough** — real Chromium against the dev server: landing → lobby → START → depths answered
  right and wrong via puppeteer mouse; screenshots at each step; `window.__DBG` monitored.
- **Static read** of `main.ts`, `scenes/game.ts`, `scenes/shell.ts`, `scenes/mp.ts` (roundPlan), `arc-data.ts`,
  `puzzles/types.ts`, `families.ts`, `families2.ts`, `families3.ts`, `glyphs.ts`, `theme.ts`.

**Solver audit: CLEAN.** 9,000 generated boards — `solve(p) === p.answer` on every one; 8/8 distinct options
everywhere; hole always bottom-right *in the data*. The engine's self-consistency is not the problem — the
**presentation layer and decoy design** are (findings below).

**tsc:** `npx tsc --noEmit` in `v2/` currently fails ONLY inside `src/scenes/takeovers/pacman2.ts` (a sibling
agent's file being written mid-gauntlet — syntax errors, in-flight). Zero errors in any puzzle/game file audited.

---

## Findings (severity ordered)

### F1 · CRITICAL — line-reflection ships decoys that are PIXEL-IDENTICAL to the answer (~21% of boards)
Two visually-correct options; only one scores correct. The player literally cannot lose gracefully — a perfect
match can be marked wrong.
- **Frequency (probe-lrfreq.ts, 500 seeds each):** diff 1: **106/500** puzzles affected; diff 3: **101/500**; diff 5: **114/500**.
- **Mechanism:** the answer `lrH(lrV(base))` (families3.ts, `lineReflection.generate`) is composed WITHOUT
  re-canonicalizing segment endpoints, so it contains direction-flipped duplicate segments (e.g. both
  `(50,50)-(50,72)` and `(50,72)-(50,50)`). The per-edge "drop/add one segment" mutation fillers then produce a
  DIFFERENT edge set that decomposes the same strokes differently (vertical doubled vs horizontal doubled) —
  distinct `glyphKey`, identical rendering. Verified prim dumps, e.g. seed=2654435761:
  - answer: `V↓ + V↑ + H(72,50→50,50)` — renders full vertical + top horizontal
  - decoy opt2: `H(50,50→72,50) + V↑ + H(72,50→50,50)` — renders the same L twice over
  `keys equal? false`, rasterized IoU = 1.0000.
- **Why solvers didn't catch it:** `solve()` matches exact `glyphKey`, finds exactly one structural match → returns
  it. Only a *rendering*-level comparison (or canonical dedupe after every transform) reveals the collision.
- **Fix direction:** canonicalize+dedupe segments after every `lrH/lrV/lrT/lrA` composition AND before every
  decoy/answer comparison; add a render-mask (or segment-union) distinctness gate to `finalize()`.
- Repro (headless): `node --experimental-strip-types research/v2-gauntlet/probe-collide.ts`.

### F2 · CRITICAL — options never lock after answering: multi-click = multi-score + depth skipping
Every `pointerdown` on any option runs the full scoring block and schedules ANOTHER `depth++`.
- **File:** `main.ts:316-355` (`dealPuzzle` onAnswer: no `answered` guard; `setTimeout(() => { r.depth++; deal(); }, 1400)` per click).
- **Live-confirmed:** two rapid clicks on depth 1 produced TWO scoring events and the run jumped depth 1→3
  (depth-2 board never shown; hue/family of the next screen match depth 3, not 2). Clicking all 8 options = up to
  +correct-points and −40×7 (floored at 0), streak corrupted, and up to 8 depths skipped in one board.
- **Fix direction:** latch a `settled` flag on first answer; `eventMode='none'` on remaining options.

### F3 · CRITICAL — the rule sentence is printed on screen DURING play (pre-reveal give-away)
Every board shows e.g. "columns double the count; each row starts 2 higher" at the bottom while the player is
solving. Zero deduction required; puzzles become read-the-hint exercises. Directly contradicts
`puzzles/types.ts:13` ("rule … shown at reveal") and DNA's spirit (rule carried by structure).
- **File:** `scenes/game.ts:63-64` — `text(root, p.rule, 40, 840, 14, T.muted)` added unconditionally at build time.
- **Live-confirmed:** screenshot depth 1 and depth 3 both show the rule before any answer.
- **Fix direction:** render the rule only in the post-answer toast/reveal state.

### F4 · HIGH — the hole "?" tile is never rendered on 8 of 9 families
`buildGameScene` draws `for (i = 0; i < p.cells.length; i++)` and marks `hole = i === p.holeIndex`
(`scenes/game.ts:31-38`), but only `count-grid` generates 9 cells (incl. the hole). Every other family generates
3 cells (2×2: accretion, rotation-composite, missing-section, line-reflection) or 8 cells (3×3: position-orbit,
dot-matrix-rotate, count-positions, size-ladder) with `holeIndex = 3/8` — the loop never reaches it. The board
just shows a blank gap where the "?" slot should be; on 2×2 boards a quarter of the grid is empty.
- **Live-confirmed:** depth-3 rotation-composite screenshot shows 3 tiles + bare panel, no "?" (depth-1 count-grid
  shows "?" correctly — the one family that works).
- **Fix direction:** draw the hole tile at `p.holeIndex` explicitly (it's derivable without a cell).

### F5 · HIGH — puzzle timer is frozen: static "01:00", no gradient bar, no timeout
- **File:** `scenes/game.ts:23-24` — `text(strip, '01:00', ...)`, stored as `__timer`, then `void timer` at :66.
  Nothing ever updates it; there is no ticker, no countdown, and `dealPuzzle` never reads `r.timerLen` — a puzzle
  round can sit forever with no hp/score consequence.
- **The working implementation exists but is buried:** `shell.ts:124-155` `statusStrip()` has the DEPTH label,
  MM:SS and the DNA gradient timer bar with `setTimer()/setDepth()` — but `main.ts:223` discards the
  `Shell.attach` handle and never calls `setTimer/setDepth` (grep: zero callers in the game flow; only lobby.ts uses them).
- **Live-confirmed:** timer read 01:00 in every screenshot across ~3 minutes of play.
- **Fix direction:** keep the Shell handle; drive `setTimer` per tick; resolve the round NEUTRAL on expiry.

### F6 · HIGH — game.ts paints duplicate static chrome OVER Shell's live chrome
`deal()` attaches Shell (header with room title + DEPTH, timer strip, sidebar with player cards), then
`dealPuzzle` adds `buildGameScene` to the same root — its own bg sprite (1600×900), static "LOBBY/PRIVATE ROOM"
header, static strip and empty sidebar render ON TOP, hiding all live Shell UI. That's why the header shows bare
"PRIVATE ROOM" instead of `roomTitle = roomName + ' · DEPTH ' + depth` (main.ts:214) and why the sidebar shows a
static "YOU / 0 / shadow awaits" instead of player cards.
- **Files:** `scenes/game.ts:17-27,55-60` vs `main.ts:223` and `shell.ts:456-480`.

### F7 · HIGH — status-strip depth label is permanently "DEPTH 1"
`buildGameScene(p, onAnswer, depth = 1)` — `main.ts:296` calls it WITHOUT the depth argument.
- **Live-confirmed:** at true depth 3 (proven by family+hue mapping after the F2 double-advance) the strip still read "DEPTH 1".
- **Fix:** pass `depth` (or better: drop game.ts's strip and use Shell's `setDepth`, see F5/F6).

### F8 · HIGH — accretion family is seed- AND diff-invariant: the same board every single time
Probe: `seedInvariant=true`; `generate` ignores both seed and diff (`void r; void diff`, families.ts accretion
block). Only the option SHUFFLE varies. rotation-composite is nearly as bad: exactly 8 distinct boards (start slot only).
The landing page promises "you will never see the same puzzle twice" (landing.ts:20) — false for these families.
- **Fix direction:** parameterize accretion by seed (rotation of the base, dot-ring order, which element joins at each step).

### F9 · MEDIUM — accretion decoys are visually indistinguishable (IoU 0.9857 — ~1 px at tile size)
Decoy "dot size mutated" changes dot radius 3.4→4.4 (families.ts decoy #2) and "one edge dot shrunk" 3.4→2.4
(decoy #6). At the 118 px option tile that is a ≈1 px difference — probe measured IoU 0.9857 vs the answer
(only family other than line-reflection above the 0.985 ambiguity threshold). Players must guess pixels.

### F10 · MEDIUM — count-grid breaches the DNA density cap and uses ±1-count decoys on huge clusters
- At diff ≥ 4 (`step=3`): max cell = `(2+3·2)·2² = 32` marks — DNA cap is 24 (`DNA.md` rule 2). Probe: **400/1000**
  boards over the cap (max 32). Marks self-shrink to ~5 px to fit (types.ts `triCluster`).
- At ALL diffs the hole count is 24 (diff ≤3) with decoys at 23/25 — counting 23 vs 24 tiny triangles is tedium,
  not reasoning ("decoys too close at low diff" — confirmed; the ±1 decoys should be gated to low counts).
- **File:** `puzzles/families.ts` countGrid (`rowBase = 2 + step*row`, `colMult = 2`, deltas `[-3..4]`).

### F11 · MEDIUM — options that duplicate VISIBLE board cells (feels broken; Dave's "regressed" note)
Decoy tables copy board glyphs verbatim: position-orbit ships **3 per board** (decoys `-da`, `-2da`, `radius-10`
are exactly cells (2,1), (0,0), (1,2) — families2.ts positionOrbit decoys); size-ladder ~3.3/board;
dot-matrix-rotate ~2.1/board; count-positions ~1.75/board; missing-section at diff 1. Probe
(option-equals-board-cell counts in probe-puzzle.ts output). Players see "answers" already sitting on the board.

### F12 · MEDIUM — family/hue pairing is locked: only 18 of 54 combinations can ever appear
`famIdx = (depth-1) % 9` (mp.ts roundPlan:269) and `hue = boardHues[(depth-1) % 6]` (main.ts:290) are both pure
functions of depth → pairing period 18, and only hue indices ≡ family index (mod 3) occur: count-grid is ALWAYS
gold or sky-blue, never orange/crimson/violet/green, etc. Also depth 1 is count-grid in EVERY run — the family
sequence never varies by seed (the "hue/family repeating too often" play-test complaint, root-caused).
- **Fix direction:** derive `famIdx` and the hue offset from the round seed (`seed ^ imul(depth, …)`), not bare depth.

### F13 · LOW — rule text overlaps option tiles on 3×3 boards
Rule drawn at y=840 (game.ts:64) while option row 2 spans y≈768-886 — live screenshot 1 shows the sentence
printed across option 5. (Moot if F3 moves the rule to reveal.)

### F14 · LOW — option row 2 overflows the board panel
Board panel is 920×640 at y=164 (bottom = 804). On 3×3 boards options span to y≈886 — the second option row
hangs below the panel edge (live screenshot 1). `scenes/game.ts:27-53` (panel h=640, `oy = 40 + rows*132 + 36`).

### F15 · INFO — no reveal wash / correct-answer highlight
On a wrong answer the only reveal affordance is toast text "WRONG — answer N · <rule>" (main.ts:349-352);
the correct tile is never highlighted and options stay interactive (see F2). DNA/v1 parity expects a visible
reveal state. (Toast itself auto-fades after 1.4 s, matching the advance delay.)

### F16 · INFO — engine-side numbers are healthy (positive finding)
9,000 boards: solver agreement 100%, duplicate options 0, bad hole 0, consecutive family/hue never repeats.
The "buggy/not aligned" play-test symptoms trace to F1-F7 (presentation + flow), not generation logic — with
F8-F11 as the puzzle-design exceptions.

---

## Reproduction index

| Finding | Repro |
|---|---|
| F1 | `node --experimental-strip-types research/v2-gauntlet/probe-collide.ts` (prints colliding prim dumps) |
| F2 | Start run → click two options within 1.4 s → depth advances twice, two toasts |
| F3/F13/F14 | Screenshot at depth 1 (count-grid): rule text visible + overlapping option 5 |
| F4 | Any non-count-grid board (e.g. depth 3 rotation-composite): blank hole, no "?" |
| F5/F7 | Any puzzle board: strip reads "DEPTH 1 / 01:00" forever |
| F8 | `node --experimental-strip-types research/v2-gauntlet/probe-puzzle.ts` (seedInvariant column) |
| F10-F12 | `node --experimental-strip-types research/v2-gauntlet/probe-puzzle.ts` (stats + meta-loop sections) |

## Probe outputs (verbatim summaries)

```
count-grid         solveMismatch=0 dupOpts=0 density>24:400 (max 32) closestDecoyIoU=0.8936 seedInvariant=true
accretion          solveMismatch=0 dupOpts=0 density>24:  0 (max 11) closestDecoyIoU=0.9857 seedInvariant=true
rotation-composite solveMismatch=0 dupOpts=0 density>24:  0 (max  4) closestDecoyIoU=0.9074 seedInvariant=true
position-orbit     solveMismatch=0 dupOpts=0 density>24:  0 (max  2) closestDecoyIoU=0.3731 optEqualsCell=3000/1000 boards
missing-section    solveMismatch=0 dupOpts=0 density>24:  0 (max  4) closestDecoyIoU=0.6697 optEqualsCell=200
dot-matrix-rotate  solveMismatch=0 dupOpts=0 density>24:  0 (max  6) closestDecoyIoU=0.8571 optEqualsCell=2116
line-reflection    solveMismatch=0 dupOpts=0 density>24:  0 (max  4) closestDecoyIoU=1.0000 optEqualsCell=3000
count-positions    solveMismatch=0 dupOpts=0 density>24:  0 (max  4) closestDecoyIoU=0.8000 optEqualsCell=1752
size-ladder        solveMismatch=0 dupOpts=0 density>24:  0 (max  3) closestDecoyIoU=0.3811 optEqualsCell=3265
line-reflection pixel-identical-decoy frequency: diff1 106/500 · diff3 101/500 · diff5 114/500
depth meta-loop: 18/54 (family,hue) pairings reachable; depth 1 = count-grid + gold in every run
```

(Each family row = 1,000 boards = 200 seeds × diff 1..5. `optEqualsCell` = total option-collides-with-visible-cell
events across those boards.)

## Environment notes

- Dev server (`hub` name `iqbattle-v2`, :8792) was healthy for the first three depths, then the served module
  stopped booting (top-level `await app.init()` never resolves, `#app` empty, `window.__DBG` undefined) —
  consistent with concurrent sibling edits landing mid-audit (vite currently also serves the in-flight
  `pacman2.ts` with syntax errors). WebGL itself verified working in the same tab. All live evidence above was
  captured BEFORE the wedge; findings are code-anchored and unaffected.
- No game files were modified. New files added by this audit only:
  `research/v2-gauntlet/probe-puzzle.ts`, `probe-collide.ts`, `probe-lrfreq.ts`, this report.
