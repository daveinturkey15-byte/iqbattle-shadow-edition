# V2 LIVE JANK HUNT — read-only feel audit of :8791 (dev)

**Agent:** JankHunt · **Date:** 2026-08-26 · **Method:** headless Chrome 151 (1600×900, DSF 1) driven over trusted CDP input against a local read-through proxy of the dev server (`jank-proxy.cjs` — injects observation-only hooks `window.__Q`/`__START` into the served `main.ts`; **no repo file was modified**). Deterministic round prediction (`jank-solver.cjs`) mirrors `deal()`/`dealPuzzle()`/`roundPlan()` so every depth is answered from the real puzzle objects.

**Coverage:** 2 full runs (seeds 20260826, 20260827) + targeted Esc probe (seed 20260828) — **50 unique depths** observed, 61 puzzle answers, 31 interlude attempts, 3 takeover encounters (THE WELL visible; SABER CLASH / ONE-ARMED GOD skipped by defect J1). Logs: `jank-log.jsonl` (71 records), `jank-probe.jsonl`. Screenshots: `shots/jank/*.png` (per-depth `-a` mount, `-b` +120ms feedback, `-c/-d` transition on every 3rd depth).

**Revision caveat:** v2 was being refactored *during* the hunt (main.ts grew 386→448 lines mid-session; a persistent-`view` refactor landed between passes). Findings are timestamped; re-verify J1/J2 on the landed revision.

---

## FINDINGS (ranked by feel damage)

### J1 · CRITICAL · Audio scheduler throw aborts the next deal → 60s frozen screen, skipped depth, stolen HP
- **Evidence:** `InvalidStateError: Failed to execute 'start' on 'AudioBufferSourceNode': cannot call start more than once` at `src/audio/director.ts:52` (`add()` inside `buildLayer`), fired **9×** (pass 2 depths 3, 5, 11, 13, 19, 25, 27, 32, 34; pass 1 depths 3, 9, 14).
- **Feel impact:** the throw happens inside `deal()` **before `show()`**, so the previous depth's reveal stays on screen with its shell timer still ticking. The player stares at a dead reveal for the remaining round budget; when the stale timer expires the engine charges **−12 HP ("TIME DROWNED YOU") for a puzzle already answered correctly** and **skips a depth** (two takeover stages — SABER CLASH d14, ONE-ARMED GOD d33 — never rendered at all).
  - pass 2 d3→d4: stuck 10:49:35→10:50:31 (~56s), interlude skipped, hp 100→88 (`shots/jank/d04-a.png`, `d04-hint.png` — header still "DEPTH 3", reveal band + toast frozen, timer 00:05→00:02 counting down).
  - pass 2 d5→d6: stuck 10:50:37→10:51:32 (~55s), hp 88→76 (`d06-a.png` — "DEPTH 5" reveal while engine is at depth 6).
  - pass 2 d13→d14 and d32→d33: takeover stages skipped entirely (probe log `takeover-esc … dt=51348`).
- **Rate:** ~1 in 3.5 depth transitions during pass 2 (8 stuck transitions / 34 depths). This is THE jank defect.
- **Likely mechanism:** `onAct()` runs early in `deal()`; the director's layer rebuild schedules an `AudioBufferSourceNode` that was already started/ended (`add()` at director.ts:52 calls `.start()` on a spent node). Intermittent because it depends on whether the previous layer's nodes have ended when the act ramp rebuilds (act changes at layer thresholds — hence the clustering at layer jumps).
- **Fix (rank 1):** in `director.ts` `add()`/`buildLayer`, never reuse scheduled sources — create fresh nodes per rebuild and `stop()`/disconnect old ones in the teardown path; wrap the per-deal `onAct()` call in `try/catch` inside `deal()` so an audio failure can **never** kill scene mounting (audio is cosmetic; geometry is not).

### J2 · HIGH · Reveal rule-band covers the board at the exact moment the player verifies the answer
- **Evidence:** answering tints the chosen tile and slides in a "THE RULE …" band across the board panel, obscuring 2–4 board cells (`shots/jank/d07-b.png`, `d03-c.png`, `d06-b.png`).
- **Feel impact:** the 1.4s reveal beat is when the player checks the completed pattern against the stated rule; the band defeats that. During J1 freezes it also makes the stuck state look identical to a live reveal.
- **Fix (rank 2):** move the rule line to the toast strip only (it already appears there), or dock the band below the board / above the options row (`layouthelper.ts` has `BOARD_OPTIONS_GAP=24` of reserved clearance) so cells stay visible.

### J3 · HIGH · Takeover goal-card text overlaps the large announce banner (HUD clearance)
- **Evidence:** `shots/jank/d10-a.png` (THE WELL, pass 1): goal line "THE WELL — ←→ move · /X cw · Z ccw · ↓ soft · SPACE drop · P pause" (13px `T.muted`) renders at the same y-band as the 26px pink announce "something followed you down" — the controls string is directly overprinted and unreadable. Same overlap on every announce depth (`d04-hint.png`: announce clipped through by the status strip; text collides with the strip's bottom edge at y≈144).
- **Checklist:** violates #1 (goal card legible in first 2s) and #2 (no HUD overlap).
- **Fix (rank 3):** offset `announceLarge` text to y≥170 (below status strip, above takeover box y=164 is impossible — use y=170..200 inside the box top margin) or delay the announce until the goal card has had its 2s window; never render both in the same band.

### J4 · MEDIUM · Toast hard-sliced at 90 chars truncates mid-word
- **Evidence:** `shots/jank/d07-b.png`: "+240 — the right column mirrors the left horizontally; the bottom row mirrors the top vert" — cut inside "vertically". `toastNow` does `msg.slice(0, 90)` (main.ts).
- **Checklist:** violates #6 (no truncated words; ≤64 chars guidance).
- **Fix (rank 4):** truncate on a word boundary with ellipsis, and cap rule text length at the source (family `rule` strings) to ≤64 chars.

### J5 · MEDIUM · Takeover sidebar renders "PLAYERS 0" (dead sidebar)
- **Evidence:** `shots/jank/d10-a.png` (THE WELL): sidebar "PLAYERS 0", no player row; puzzle depths show "PLAYERS 1 · JANK YOU" (`d07-a.png`). The live-sidebar hooks passed to `buildGameScene` are not wired for takeover mounts.
- **Fix (rank 5):** pass the same `players()` getter into takeover mounts (or render the solo fallback row `buildLiveSidebar` already supports).

### J6 · MEDIUM · Reveal→next-deal hold is 1.4s (v1 baseline: 1.25s) and is dead time
- **Evidence:** 20 clean puzzle advances: **median 1439ms, min 1409, max 1545** click→next-mount (design `setTimeout(1400)`; v1 `mode-puzzle.js` used 1250ms). Interlude pick→next 880–950ms (design 900); takeover resolve→next 1500ms.
- **Feel verdict:** with the answer already tinted and the toast up at +120ms, a flat 1.4s hold reads sluggish on a streak; v1's 1.25s felt tighter. Not a defect alone — but combined with J2 (board hidden during the hold) the beat feels longer than it measures.
- **Fix (rank 6):** drop the puzzle hold to ~1150–1250ms, or make the hold skippable (any key/click after +400ms advances) — keeps pace for hot-streak players without rushing the reveal.

### J7 · LOW · Main-thread stalls at deal transitions (up to 131ms pass 1, 68ms pass 2)
- **Evidence:** rAF gap probe + PerformanceObserver longtasks: pass 1 — 6 longtasks 54–114ms clustered at depth transitions (d1 95ms, d9 54ms, d10 86ms, d11 114ms, d12 87ms), max frame gap 131ms; pass 2 — 1 longtask 63ms, max gap 68ms (improved mid-hunt as sibling perf work landed).
- **Feel impact:** a 100ms+ hitch exactly when the next board mounts; visible as a one-frame stutter of the timer bar.
- **Fix (rank 7):** keep glyph `tileCanvas` rasterization out of the deal path (pre-render/cache per hue+size), and defer backdrop swap by one frame.

### J8 · LOW · Interlude Esc-decline could not be exercised through J1; auto-pick and click paths verified
- **Evidence:** of 31 interlude attempts only 7 ever rendered (auto-pick d8: ok 372ms; card clicks d16/d24/d32: ok 871–885ms); the other 24 attempts pressed Esc/clicked against a J1-frozen screen. Esc-decline on a *visible* interlude: see probe results below (§ Probe).
- **Fix:** subsumed by J1; re-audit Esc after J1 lands.

### Verified-good (no action)
- **Click-to-feedback (<100ms rail):** option tint (green/red) + rule band + toast all present in the +120ms screenshot (`d07-b.png`, `d03-c.png`) — instant local feedback before resolve. PASS.
- **One hue per board / glyph discipline:** every rendered board stays single-hue (gold/pink/crimson/violet per depth), primitive marks only (`d07-a`, `d03-*`). PASS.
- **Timer accuracy on live scenes:** countdown text+bar track real time (THE WELL 00:05 near expiry; frozen-screen timers expose J1 rather than a timer bug).
## Esc-path probe (seed 20260828, `jank-probe.jsonl`)
- **Interlude Esc-decline: PASS when the interlude actually mounts.** Depth 8 interlude visible (`shots/jank/il08-hint.png` — hint "ESC TO DECLINE · AUTO-PICK IN 7s" rendered at 14px, ≥11px rail): Esc declined in **953ms** with 0 HP loss. Hint appears 1s after mount (ESCAPE_AFTER_MS=1000) — acceptable, but showing "AUTO-PICK IN Ns" alone for the first second hides that Esc exists; consider showing both from t=0.
- **Depth 3→4 froze for the 3rd consecutive run** (il4: Esc pressed against another J1-frozen screen, no advance, 58s dead air). The first act-ramp (`onAct` 0→1 at the layer jump near depth 3–4) is a near-deterministic J1 trigger — 3/3 runs. Fix J1 and this regression test writes itself: "start run, answer d1–d3, assert depth-4 interlude renders within 2s".
- **Takeover Esc: UNVERIFIED live** — every takeover the solver predicted (SABER CLASH d14, ONE-ARMED GOD d33, plus probe-run gates) was skipped by J1 before rendering; THE WELL (pass 1) mounted but was left to run its timer. Needs re-audit after J1. Note THE WELL's on-screen controls advertise "P pause" but no Esc hint (checklist #4 exposure).
- **Cosmetic (new, minor):** the interlude's 0.92-dim backdrop lets the frozen shell's fate banner ("THE WALLS ARE TITTERING") collide with the gold title "A CHAOS EMERALD SURFACES" in the same y-band (`il08-hint.png`). Same band-collision class as J3.


## Polish-checklist scorecard (Main's 6 points)
| # | Point | Verdict |
|---|-------|---------|
| 1 | Goal card first 2s, no option overlap | **FAIL** — takeover goal line overprinted by announce banner (J3); interlude cards PASS |
| 2 | HUD clearance, ≥11px + contrast | **FAIL** — announce/goal band collision (J3), fate-banner vs interlude title (probe); all text ≥11px PASS |
| 3 | Click-to-feedback <100ms | **PASS** — tint+toast at +120ms (`d07-b.png`); but ~25% of transitions never mount (J1) |
| 4 | Esc hint in 2s, Esc resolves neutral | **PARTIAL** — interlude PASS when mounted (953ms neutral); takeover Esc UNVERIFIED, no Esc hint on takeover goal lines |
| 5 | Contrast worst-case | **PASS (borderline)** — 13px muted goal line over busy backdrop is the worst case; readable unless overlapped (J3) |
| 6 | Summary ≤64 chars, no truncation | **FAIL** — 90-char hard slice truncates mid-word ("top vert", `d07-b.png`) (J4) |

## Ranked fix list (hand to scene owners)
1. **J1** director.ts: never restart spent AudioBufferSourceNodes; try/catch `onAct` inside `deal()` (audio must never block mounting). Restores ~25% of depth transitions currently freezing for ~60s.
2. **J2** game.ts `revealRule`: keep board cells visible during the reveal beat.
3. **J3** takeover goal card vs announce: separate bands (announce y≥170 or delayed 2s).
4. **J4** toast: word-boundary truncation + ≤64-char rule strings.
5. **J5** takeover mounts: wire live sidebar hooks (kill "PLAYERS 0").
6. **J6** reveal hold 1400→~1200ms or skippable after +400ms (v1 parity 1250ms).
7. **J7** move glyph rasterization out of the deal path.
