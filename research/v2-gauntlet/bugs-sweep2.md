# bugs-sweep2 — live bug sweep of :8791 v2 build (2026-08-26, BugSweepLive)

Read-only live drive of the current build (all wave-1..3 fixes in) across **five separate
runs, 40+ depth transitions observed** (deepest clean drive: depth 13; one runaway run's
counter reached 626 before termination). Environment note: sibling squads were saving
`v2/src` during the sweep — every save full-page-reloads the dev server and wipes the
in-memory run; several runs were killed this way (repro'd 4×). Evidence shots in
`shots/sweep2/` (PNG names preserved from webp captures).

---

## 1. Fix-verification table (recent fixes, verified live)

| # | Fix under test | Verdict | Evidence |
|---|---|---|---|
| 1 | **Rule text hidden pre-answer** (DNA: board teaches the rule) | ✅ PASS | Every fresh board (d1–d13, all families) renders zero rule text; `THE RULE` banner + toast appear only after answering. `OK-rule-reveal-post-answer-d1.png`, `OK-countdown-ticking-rule-reveal-fresh.png` |
| 2 | **Hole `?` renders on 2×2 AND 3×3** | ✅ PASS | 3×3 count-grid (d1) and 2×2 accretion / rotation-composite / missing-section (d2, d3, d5) all show the `?` tile bottom-right. `OK-rule-reveal-post-answer-d1.png` (3×3), `OK-hole-q-2x2-instant-red-tint-d2.png` (2×2) |
| 3 | **Live countdown ticks** | ✅ PASS | MM:SS decrements 1/s across shot pairs: 00:59→00:58, 00:53→00:52, 00:45→00:44→00:42; gradient bar drains. `OK-countdown-ticking-rule-reveal-fresh.png`, `OK-countdown-d6-takeover-ticking.png` |
| 4 | **DEPTH label advances** | ⚠️ PARTIAL | Label advances correctly on clean single answers (+140 run: 1→2→3). BUT under rapid answers / timer expiries it jumps, repeats, and even runs backward (bugs 3–6 below). |
| 5 | **Takeover goal cards show** | ✅ PASS | LASER-STORM, ONE-ARMED GOD, SLIME GALLERY, SERPENT all show title + win condition + controls + `ESC …` hint + `INPUT UNLOCKS IN 2…` countdown before input. `OK-takeover-goalcard-laserstorm-esc-hint.png`, `OK-takeover-goalcard-serpent.png` |
| 6 | **Emerald interlude every 4th depth** | ⚠️ PARTIAL | Interlude fires at d4 and d8 (`OK-interlude-d8-chaos-emerald-autopick.png`: "A CHAOS EMERALD SURFACES", 3 relic cards, auto-pick countdown, pick toast). BUT it is **skipped entirely when advances cluster** (see bug 3) — the d4 interlude vanished between two rapid deals. |
| 7 | **Shadow LARGE beats on layer crossings** | ⚠️ PARTIAL | Layer banner text renders at crossings (pink banner "something followed you d…" at d3+ in 4 shots) **but the text is clipped at the board-panel edge** (bug 10). The full-screen LARGE beat moment was never captured intact — banner lifetime vs. deal cadence. |
| 8 | **Backdrop changes per alignment** | ✅ PASS | Distinct backdrops observed: red/ember (bad), purple vine (bad variant), gold/sanctuary light, blue-grey (neutral), pink haze (chaotic). Per-depth world pick confirmed live. |
| 9 | **Reveal FX play** | ✅ PASS (visual core) | Answer feedback is instant (<130 ms): picked option tint red/green same-frame, `THE RULE` banner + result toast slide in. `OK-correct-answer-green-140pts-d1.png` (green +140), `OK-hole-q-2x2-instant-red-tint-d2.png` (red tint). Particle layer not distinguishable in stills. |
| 10 | **DPR-crisp rendering / layout shell** | ✅ PASS | 1600×900 letterbox, canvas 2000×1125 @ DPR 1.25, no overlap of board/options/sidebar on standard 16:9. |

Polish-checklist items observed live: goal card ≤2s pre-input ✅ (all 4 takeovers), HUD
text ≥11px ✅, Esc hint visible ✅ (all takeover goal cards), instant click tint ✅,
summary strings short ✅. **Esc-resolves-neutral: NOT verified** — Esc was pressed during
LASER-STORM input-lock and during slots; no neutral resolve was observed either time
(see bug 7).

---

## 2. New bugs (all repro'd live; ordered by severity)

### BUG 1 — CRITICAL: post-death runaway loop — depth counter climbs forever, end screen flickers
- **Repro**: play until HP hits 0 (wrong answers / timeouts) and leave the tab idle. The
  match "terminates", then re-terminates in a loop: the end screen re-renders ~4–6×/s
  with a **different DEPTH each time**.
- **Observed**: one idle run climbed to `DEPTH 626 · SCORE 410`; a second showed
  `481 → 513 → 497` across three shots seconds apart (**non-monotonic** — the counter
  goes down as well as up). `BUG-runaway-end-481.png`, `-513-`, `-497-nonmonotonic.png`,
  `OK-…626` sequence in sweep notes.
- **Mechanism (high confidence)**: each `deal()` starts a 250 ms `setInterval` (tickTimer)
  and stops it via a `root.destroy` wrapper. At least one interval survives its scene
  (root replaced/destroyed without the wrapper firing, or a deal that throws between
  `setInterval` and `show()`). Once `run.hp` is 0, that ghost ticker fires `left <= 0`
  **every 250 ms forever**: `hp-=12; depth++; deal()` → `endRun()` → show → ghost not
  destroyed → repeat. The stale-guard `if (rr.depthStartedAt !== r.depthStartedAt) return;`
  is **dead code** — `rr` and `r` are the same singleton `run` object, so the comparison is
  always false.
- **Impact**: after one death the game is an unkillable CPU loop; DESCEND AGAIN is hard to
  click (screen re-renders constantly); MP/host presence would desync. **Owner: main.ts
  deal()/tickTimer.**

### BUG 2 — CRITICAL: no answer-lock; rapid multi-click skips depths (named fix REGRESSED/absent)
- **Repro**: answer a puzzle, then click 2–5 more option tiles within ~2 s.
- **Observed**: every click fires `onAnswer` (score/streak/toast each time) and schedules
  its own `setTimeout(advance, 1400)`. Live results: 3 clicks on one board → depth jumped
  3→5 **skipping the depth-4 emerald interlude entirely**; in an earlier run, depth
  11→13 between two shots 350 ms apart. Source confirms: `game.ts` option handler has no
  answered-guard; `dealPuzzle` schedules one advance per answer.
- **Impact**: exactly the regression the fix wave claimed to close. **Owner: game.ts +
  main.ts dealPuzzle.**

### BUG 3 — HIGH: answered board re-deals the SAME depth instead of advancing
- **Repro**: answer a puzzle; watch ~2 s.
- **Observed** (twice): after a correct d3 answer the board re-dealt depth 3 with the
  timer **reset to 01:00** (00:59→01:00 backward) instead of advancing; in the final run
  the board stayed on depth 3 through two answers and 4.3 s of shots, then jumped 3→5
  (skipping the interlude). `BUG-no-advance-after-answer-stuck-d3.png`.
- **Consistent with** ghost/stale advance timers firing late and in bursts (tab-timer
  throttling in hidden tabs makes it worse; the game must not depend on foreground
  timers for state advances). **Owner: main.ts.**

### BUG 4 — HIGH: "TIME DROWNED YOU" fires while the clock shows 00:54 remaining
- **Repro**: observed live on a depth-3 board 6 s into its cycle.
- **Observed**: full timeout toast (−12 HP, streak reset) with 00:54 on the clock and no
  depth advance. Second timeout-path defect: expiry during the interlude silently skips
  the relic pick. `BUG-timeout-toast-at-0054-remaining.png`. **Owner: main.ts tickTimer.**

### BUG 5 — HIGH: zombie scene dealt OVER the MATCH TERMINATED screen
- **Repro**: die with any pending answer/interlude/takeover timer.
- **Observed**: `MATCH TERMINATED · DEPTH 13` screen, then 3 s later a live depth-13
  puzzle board (timer running, toasts firing) on top of the terminated run;
  `BUG-match-terminated-then.png` → `BUG-zombie-board-after-terminate.png`. `endRun()`
  does not clear pending scene timers, and `run` is never nulled. **Owner: main.ts
  endRun().**

### BUG 6 — MEDIUM: depth header non-monotonic across normal-looking play
- **Observed**: DEPTH 7 (slime-gallery takeover) → DEPTH 6 puzzle → DEPTH 5 puzzle in
  consecutive shots seconds apart, same run. `BUG-ghost-takeover-depth7.png`,
  `BUG-nonmonotonic-depth6-after-7.png`. Any HUD/logic trusting `depth` monotonicity
  (arcs, layers, difficulty ramp `1+floor(depth/6)`) desyncs. **Owner: main.ts.**

### BUG 7 — MEDIUM: Esc does not resolve takeovers (neutral path dead?)
- **Repro**: LASER-STORM (after input unlock) and ONE-ARMED GOD: press Esc.
- **Observed**: no resolve, no toast, no advance; slots sat at `SPIN 3/3` indefinitely
  until the shell timer drowned it (`BUG-depth11-slots-SPIN3of3-stuck.png`). Goal cards
  advertise "ESC NEUTRAL / ESC SLITHERS OUT / ESC LEAVES NEUTRAL". **Owner: takeover
  scenes + onboard copy.**

### BUG 8 — MEDIUM: takeover overlay covers the sidebar; roster shows PLAYERS 0
- **Observed**: during all four takeovers the full-width takeover panel overlaps the
  sidebar region and the strip reads **PLAYERS 0** while solo (a clipped player chip
  "PE…" peeks bottom-left). Puzzle depths correctly show PLAYERS 1.
  `BUG-depth11-slots-SPIN3of3-stuck.png` top-right. HUD-clearance violation. **Owner:
  takeover scenes / Shell.**

### BUG 9 — LOW-MEDIUM: layer banner text clipped at panel edge
- **Observed**: layer-crossing banner renders as "something followed you d…" — truncated
  mid-word at the board panel boundary (visible in 4 shots, e.g. the d3 captures). Text
  is laid out from a fixed x and overflows the clip. **Owner: main.ts layerBanner call
  (spec.x−160) / arc.ts.**

### BUG 10 — LOW: display name sometimes not committed
- **Observed**: typed `SWEEPER` (visible in the field), CREATE ROOM → lobby card showed
  default "Player" (one occurrence out of ~8 entries; other entries took the name).
  Focus/commit race in the Pixi text input. **Owner: shell.ts makeTextInput / landing.**

### BUG 11 — LOW (env robustness): any `v2/src` save hard-kills the run
- **Observed 4×**: Vite full reloads on sibling saves wipe the in-memory run to landing
  with no recovery prompt. With squads landing polish continuously this makes long runs
  untestable. Consider localStorage run-resume or an explicit "session ended" screen
  instead of silent reset to landing.

---

## 3. Jank log (felt, not crash-grade)

- Advance pacing after an answer is inconsistent: sometimes +1.4 s sharp, sometimes
  2–4 s, sometimes never-without-a-second-answer (bug 3). Feels laggy/unresponsive
  between answer and next board.
- Toasts persist across scene changes when deals cluster (same toast visible over two
  different boards).
- Interlude auto-pick countdown reads "AUTO-PICK IN 0s" while still waiting — countdown
  label floors at 0 before the pick fires.
- Slots takeover needs one input PER REEL ("SPACE STOPS EACH REEL") but the goal card
  reads "THREE SPINS" — first-time players will think 3 presses total; it stalls looking
  stuck (see bug 7 repro path).
- Sidebar score updates only on deal, so the +pts toast disagrees with the visible score
  for a full round.

## 4. Integration notes for Main

1. **Blocker-grade**: bugs 1–3 share one root complex (per-depth `setInterval` + per-answer
   `setTimeout` + dead stale-guard + no answer-lock). Recommended fix shape: single
   run-scoped advance token (`run.advanceId`) checked inside every deferred callback;
   replace the `rr.depthStartedAt !== r.depthStartedAt` self-comparison with a real
   generation counter; route ALL scene timers through the existing `onSceneStop` registry
   instead of the destroy-wrapper (which is what leaks).
2. The named "answer-lock" fix from the earlier wave is **not in the served build**
   (`game.ts` option handler + `dealPuzzle` have no guard) — either it was lost in the
   Shell/game.ts refactor or never merged; needs re-landing + a rapid-click selftest.
3. Verified-green list (rule-reveal, hole `?` both grids, countdown, goal cards,
   interlude presence, backdrops, instant feedback, DPR crispness) should NOT be
   regressed by the timer refactor — all are independent of the advance pipeline.
4. Env caveat for any live-QA peer: sibling saves to `v2/src` full-reload :8791 and wipe
   runs (bug 11). Coordinate save-holds through Main; hidden/headless tabs also throttle
   game timers — drive with the tab foregrounded (`page.bringToFront()`).
