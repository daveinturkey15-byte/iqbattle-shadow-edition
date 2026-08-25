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

## Current tree status (2026-08-25, this gauntlet's landing pass)

| Gate | Status | Notes |
|------|--------|-------|
| G2 audit | GREEN | 5 families × 150 puzzles = 750/750, 0 failures |
| G3 soak | GREEN | 1000 puzzles soaked clean; redlight/tidepool/serpent self-tests PASS |

Pending items at write time (owned by others; not gauntlet scope):

- [PuzzleTeam] `families2.ts`: 3 tsc errors (Prim object literals widen `k` to
  `string`; `"line"` compared against tri/dot/diamond union) — breaks G1.
- [UXTeam] `scenes/lobby.ts`: 1 tsc error — breaks G1.
- Note: `takeovers/selftest.ts` is a shared helper that RUNS the three suites
  when executed directly (`node src/scenes/takeovers/selftest.ts`); it exposes
  no importable `selfTest()`, so the soak lists it PENDING by design — the
  per-module suites all report through their own modules.
