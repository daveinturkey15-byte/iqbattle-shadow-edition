# V2 GAUNTLET — GATES

Self-policing checklist every build loop must clear before "done". The gauntlet
is node-side (`research/v2-gauntlet/`); browser verification is Main's job via
the omp browser tool against the dev server (hub name `iqbattle-v2`,
http://127.0.0.1:8792).

## Law

`v2/DNA.md` is ground truth. Any runner failure is a defect in the game code,
never in the expectation — fix the family/takeover/scene, not the gate.

## Gate order (run top to bottom; all must be green)

### G1 — Project TypeScript clean

```
cd v2 && npx tsc
```

Exit 0. No `any` escape hatches anywhere.

### G2 — Solver audit green

```
cd v2 && node ../research/v2-gauntlet/audit-runner.ts
```

- Imports every family module (`src/puzzles/families.ts`, `families2.ts`;
  extend `FAMILY_MODULES` in the runner when a module is added).
- Per family: 30 seeds × diff 1..5 → **150 puzzles**, tolerance **0 wrong**:
  - independent solver re-derives key: `solve(p) === p.answer`
    (contract: solver sees visible data only, returns -1 on contradiction)
  - options pairwise distinct (serialized prim comparison)
  - hole bottom-right (`holeIndex === cols*rows - 1`)
  - single hue per board (non-empty board-wide hue string)
- Prints per-family PASS/FAIL; exit non-zero on any FAIL.
- A missing module prints PENDING and does not flip the gate; a module that
  loads but exports no `Family` objects FAILS.
- Duplicate family ids across modules FAIL.

### G3 — Soak green

```
cd v2 && node ../research/v2-gauntlet/soak.ts
```

- 200 deterministic seeds per family (diff sweeps 1..5), headless / Pixi-free:
  - every prim within the 0..100 cell design space (centers and line endpoints;
    sizes/radii in (0,50]; finite values)
  - ≤ 40 marks per cell (DNA readable-density target is ≤24 — aim there)
  - cells + options both checked
- Takeover logic self-tests: every `src/scenes/takeovers/*.ts` must export a
  PURE `selfTest(): { ok: boolean; failures: string[] }` (alias `__selfTest`
  accepted; boolean or `string[]` returns also interpreted). Bare-node import
  of the module happens first — pixi.js imports resolve fine under Node ≥23,
  but `selfTest()` itself must never construct Pixi/DOM/timer state.
  - SELFTEST FAIL flips the gate. PENDING (no export yet) / BLOCKED (import
    error) are reported and listed as pending items without flipping it.
- Exit non-zero on any prim violation or failing self-test.

### G3b — LMS match convergence green

```
cd v2 && node --experimental-strip-types src/scenes/lms.ts
cd v2 && node --experimental-strip-types src/scenes/selftest-lms.ts
```

`lms.ts` gates the match REDUCER (scoring formula parity with the solo path, score
floor, answer lock, parity guard, weapon economics, the grief boundary, elimination
needing both floors, rank deltas, roster re-sync never resurrecting the eliminated).

`selftest-lms.ts` gates the match SEQUENCING: a full 3-seat match played through the
real `MpSession` and the real `lmsdirector.ts` over a loopback wire. Its central
assertion is **convergence** — after every depth, every screen's score table must be
byte-identical to the host's. It also asserts that an inflated client claim gains only
what `pointsFor()` allows, that a landed attack propagates on a `scores` frame rather
than a reveal, that a timeout closes the depth punishing only the silent, that a
spectator can neither answer nor attack, and that end-when-one crowns exactly one seat.

It closes with a seeded sweep of 60 differently-shaped matches (randomised answers,
attacks, timeouts and departures) which asserts convergence on every depth AND that
matches actually resolve: at least 80% must reach a last-one-standing, with a median
end depth of 6 or more. Those two thresholds are the regression guard on the
elimination rule — a change that makes matches unwinnable, or that wipes the table
instantly, fails here rather than in front of a player.

Any desync is a defect in the game code, never in the gate.

### G4 — Browser checklist (Main, Playwright via browser tool)

Against http://127.0.0.1:8792 at 1600×900 logical stage AND an ultrawide
viewport:

1. **Layout fills/letterboxes** — stage letterbox-scales; nothing floats into
   empty space; board panel centered left (~60%), sidebar right (~35%).
2. **One hue per board** — all 8 cells + 8 options share a single accent hue;
   no color rotation across steps.
3. **Options distinct** — visually distinguishable at a glance; decoys differ
   by exactly one attribute.
4. **Reveal advances** — clicking an option reveals correct/wrong, shows the
   rule sentence, advances round N/M with timer reset.
5. **Sanctuary flip** — sanctuary state toggles cleanly without leaking into
   puzzle rounds.
6. **Takeover mounts/unmounts** — director drops takeover scene between puzzle
   blocks; mounts its own container, self-limits to its timer, escapable,
   returns a StageResult `{correct, points, hpDelta, summary}`; touch parity.

### G4 driving surface

`vite dev` installs `window.__QA` (`v2/src/qa.ts`; stripped from `vite build` output) so G4
can be driven instead of eyeballed: `texts()`, `sees(str)`, `click(logicalX, logicalY)`,
`clickLabel('opt3')`, `type(str)`, `state()`, `hit(x, y)`. Two tabs on the same origin share
the BroadcastChannel bus, so a full host+join LMS match runs from the console.

**Gotcha.** A tab that is not compositing (hidden pane, headless) never runs Pixi's ticker,
so world transforms are stale and `renderer.events.rootBoundary.rootTarget` is null — every
hit test misses and every click is silently swallowed. Call `app.render()` once before
driving, and after any layout change. Symptom without it: the driver reports success while
nothing on screen reacts.

**Do not infer a control's hit area from its art.** `makeButton`/`luxePill` now set an
explicit `hitArea` rectangle, because the ghost/danger variants' only geometry doubles as the
sheen mask and Pixi excludes masks from hit-testing. Bounds still measured correctly, so the
buttons looked fine and reported the right rect while being completely unclickable. That is
what a hit-test probe catches and a screenshot never will.

## Current tree status (2026-08-25, this gauntlet's landing pass)

| Gate | Status | Notes |
|------|--------|-------|
| G2 audit | GREEN | 5 families × 150 puzzles = 750/750, 0 failures |
| G3 soak | GREEN | 1000 puzzles soaked clean; redlight/tidepool/serpent self-tests PASS |

## Tree status (2026-08-26, LMS wiring pass)

| Gate | Status | Notes |
|------|--------|-------|
| G1 tsc | GREEN | project-wide, strict, no `any` escapes |
| G2 audit | GREEN | 12 families × 150 = 1800/1800 |
| G3 selftests | GREEN | 15 suites (takeovers ×5, net, audio ×2, worlds, meta, boardskins, mpfeat, lms ×2) |
| G3b LMS | GREEN | reducer + full 3-seat match; convergence asserted every depth |
| G3b sweep | GREEN | 60 matches x 24 depths: 59/60 reach a winner, end depth median 15 |
| G4 browser | GREEN | live two-tab host+join match driven to depth 6, zero runtime errors |

G4 evidence (2026-08-26, `vite dev` on :8792, two tabs on one origin): join by code →
identical round mounted on both screens with full chrome → client answer holds for the
reveal while its response clock shows → host answer closes the depth and both tables
converge (`DAVE:0 / MIRA:140`, i.e. `pointsFor(1,1)` re-derived host-side) → parity guard
exposes no target at depth 2 → depth-3 attack menu prices rotten 105/120 and curse 175/190
exactly per the mpfeat curves → ROTTEN lands, both screens converge on `DAVE:20 / MIRA:195`,
budget spent → emerald interlude no longer runs the round clock → chaos round (LASER-STORM)
mounts on both screens. `__DBG.errors` and `__sessErr` empty throughout.

Pending items at write time (owned by others; not gauntlet scope):

- [PuzzleTeam] `families2.ts`: 3 tsc errors (Prim object literals widen `k` to
  `string`; `"line"` compared against tri/dot/diamond union) — breaks G1.
- [UXTeam] `scenes/lobby.ts`: 1 tsc error — breaks G1.
- Note: `takeovers/selftest.ts` is a shared helper that RUNS the three suites
  when executed directly (`node src/scenes/takeovers/selftest.ts`); it exposes
  no importable `selfTest()`, so the soak lists it PENDING by design — the
  per-module suites all report through their own modules.
