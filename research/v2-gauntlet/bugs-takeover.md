# Takeover Scenes — V2 Parity & Polish Gauntlet (bugs-takeover.md)

Auditor: BugTakeover · 2026-08-26 · Scope: the 11 mounted takeover scenes + 2 selftest runners
(`v2/src/scenes/takeovers/`: redlight, tidepool, serpent, floorfall, hunterdodge, laserstorm,
dronedodge, saberclash, slots, slimegallery, well, selftest.ts, selftest-portb.ts).
READ-ONLY on game code; this file is the deliverable.

Note: sibling agents landed additional scenes in `takeovers/` mid-audit (battleship2, fractal2,
hypercube2, metal2, pacman2, phoenix2, popglitter2, sniper2, tetris2, doom2 …). Those are OUT of
scope here.

## Method (evidence basis)

1. **Pure selfTests headless** (Node 24, `node --experimental-strip-types`, from `v2/`):
   - `selftest.ts` → RED LIGHT OK · TIDE POOL OK · SERPENT OK · ALL PASS (exit 0)
   - `selftest-portb.ts` → SABER CLASH OK · ONE-ARMED GOD OK · SLIME GALLERY OK · THE WELL OK (exit 0)
   - Orphan smoke entries → LASER-STORM OK · FLOOR-FALL OK · DRONE-DODGE OK · HUNTER-DODGE OK
2. **Adversarial pure-logic probes** beyond the shipped suites (2000-seed sweeps, exact event-sweep
   peak concurrency, stacked-clear repros, boundary depths 0/1/27/40).
3. **Live-mount matrix** in real Chromium against dev server :8792: each of the 11 mount functions
   driven with fake ctx + real Pixi `Ticker.shared` stepped at fixed 16.67 ms. Per scene ×4 runs:
   idle @ depth 27 / timerLen 20 · tight timerLen 8 · Esc @ 600 ms · determinism re-run.
   Measured: settle count, settle time vs `timerLen*1000`, post-settle abuse (300 extra ticks +
   Esc spam), ticker/window-listener deltas, destroyed-children count, result JSON.
4. **Scoped tsc**: `npx tsc --noEmit` in v2 → 20 errors, ALL syntax errors in `doom2.ts` /
   `pacman2.ts` (concurrent sibling edits, not my scope). **My 13 in-scope files contribute 0 tsc
   errors.** Project-wide validation remains Main's job.

## Per-scene verdict table

Legend: S1 = settles exactly once · TMR = self-resolves ≤ ctx.timerLen · CLN = cleanup removes
ticker/listeners/children · DET = same seed ⇒ same schedule/result · FAIR = fairness rails hold.
✅ pass · ❌ fail · ⚠️ conditional/latent

| Scene | S1 | TMR | CLN | DET | FAIR | Verdict |
|---|---|---|---|---|---|---|
| RED LIGHT | ✅ | ✅ (⚠️ tl<5) | ✅ | ✅ | ❌ seed-blind cadence (F9) | **REGRESSED** |
| TIDE POOL | ✅ | ✅ | ✅ | ✅ | ❌ ambiguous answer 64% (F7), NaN @ depth 0 (F12) | **BROKEN (fairness)** |
| SERPENT | ✅ | ✅ (moot) | ✅ | ✅ | ❌ instant death (F2), no right turn (F3) | **BROKEN (unplayable)** |
| FLOOR-FALL | ✅ | ✅ (⚠️ tl<5) | ⚠️ pointermove leak (F13) | ✅ | ✅ rails hold | MINOR FIXES |
| HUNTER-DODGE | ✅ | ✅ (⚠️ tl<5) | ⚠️ pointermove leak (F13) | ✅ | ⚠️ kb-only play has zero dodge risk; MOTION=0 snaps beam onto cursor ("rules identical" is false) | MINOR FIXES |
| LASER-STORM | ✅ | ✅ (⚠️ tl<5) | ✅ (dead status Text, F15) | ✅ | ✅ true peak concurrency ≤2 over 400 seeds (rail 4) | NEAR-CLEAN |
| DRONE-DODGE | ✅ | ✅ (⚠️ tl<5) | ⚠️ pointermove leak (F13) | ✅ | ❌ hitting drone never despawns (F11) | NEEDS FIX |
| SABER CLASH | ✅ | ❌ fixed ~12 s wall, ignores timerLen (F4) | ✅ | ✅ | ❌ feint teleport ≈47% of ring (F10); pay curve unbounded (F18) | **BROKEN (timer)** |
| ONE-ARMED GOD | ✅ | ❌ worst ≈25 s wall, ignores timerLen (F5) | ✅ | ✅ | ⚠️ VOID pair doc mismatch (F14) | **BROKEN (timer)** |
| SLIME GALLERY | ✅ (Esc only) | ❌ frozen — tick never registered (F1); ROUND_MS=30 s hard-coded (F6) | ✅ (removes what was never added) | n/a (never advances) | n/a | **BROKEN (frozen)** |
| THE WELL | ✅ | ✅ | ✅ | ✅ | ❌ multi-line clears undercounted/stranded (F8) | NEEDS FIX |

## Findings

### CRITICAL

**F1 · SLIME GALLERY is born frozen — `onTick` is never registered.**
`slimegallery.ts:347` defines `onTick`; teardown (`slimegallery.ts:377`) calls
`Ticker.shared.remove(onTick)`; **no `Ticker.shared.add(onTick)` exists anywhere in the file**
(every other takeover scene has it — grep `Ticker.shared.add` across `takeovers/`). Live proof:
after mount `Ticker.shared.count` unchanged; 2700 fixed ticks produced 0 invocations of the scene
tick, 0 spawns, no time progress; the only exit is Esc. The gallery never opens.
Repro: mount with any ctx → observe clock/bar static; only Escape settles.

**F2 · SERPENT dies on its very first step — spawn faces into its own body.**
`serpent.ts:29-33` orders `SPAWN_CELLS` x = 4,5,6 while `step()` treats `body[0]` as the head
(`serpent.ts:181`). Head starts at x=4 with two segments AHEAD of it in the travel direction;
dir initializes to `right` (`serpent.ts:118`), so the first step moves the head into `body[1]`
(5,7), caught by the self-collision check (`serpent.ts:187-193`) → `die()` ≈55–100 ms after
mount, every run, every seed/depth. Live proof: all four scenarios settled with
`THE SERPENT BIT ITSELF` (-40 pts / −12 hp) — including the Esc scenario before the Esc key was
even dispatched. The stage is a guaranteed loss. Fix: reverse `SPAWN_CELLS` order (head at x=6)
or init `dir = DIRS.left`.
Repro: `mountSerpent({depth:1,seed:1,…})` → wait one step interval → settled `correct:false`.

**F3 · SERPENT cannot steer right — ArrowRight/D handler is empty.**
`serpent.ts:247-251`: `case 'ArrowRight': case 'd': case 'D': break;` — missing
`turn('right')` and `e.preventDefault()` (all three other directions have both). Even with F2
fixed the snake could never turn right via keyboard (swipe only).

### HIGH

**F4 · SABER CLASH ignores `ctx.timerLen` — can overrun the round timer by 50%.**
Worst path = 3 rounds × `ROUND_CAP_MS` 4000 (`saberclash.ts:43`) with no total-budget check
anywhere in `onTick` (`saberclash.ts:245-264`; the header claim "self-resolves well inside
ctx.timerLen" is false for timerLen < 12). Live: timerLen 8000 → settled at **11917 ms**
(overTimer=true), verdict already `-40/-12`. MP wire allows `TIMER_MIN=1..120`
(`mp.ts:123-124`), so sub-12 s rounds are reachable. Fix: scale/cap per-round budget from
`ctx.timerLen` like redlight/laserstorm do.

**F5 · ONE-ARMED GOD ignores `ctx.timerLen` — worst-case ≈24.9 s wall time.**
`AUTO_STOP_MS` 7000 × 3 spins + inter-spin settles (`slots.ts:45,273,350`); no reference to
`ctx.timerLen` in the whole scene. Live: auto-play settled at **25067 ms** with both timerLen 20
(win path) and timerLen 8 (fail path). Same fix shape as F4.

**F6 · SLIME GALLERY also hard-codes a 30 s round.**
`ROUND_MS = 30000` (`slimegallery.ts:48`) drives the endRound check and timer bar; `ctx.timerLen`
is unused. Moot until F1 is fixed, but fixing F1 alone makes the overrun live.

**F7 · TIDE POOL correct answer is ambiguous in ~64% of schedules.**
The continue-the-pattern rule fixes only the answer KIND; n is rolled independently
(`tidepool.ts:104-109`) and distractor uniqueness excludes only exact kind:n duplicates
(`tidepool.ts:110-113`). So another pool with the SAME kind but different n routinely sits on the
board while the rule gives the player no way to prefer one n. 2000-seed probe: **64.3%** of
schedules contain such a decoy. This is exactly a "rule needs the answer key" DNA violation.
Fix: when rolling distractors, exclude any chip whose kind equals `ansKind`.

**F8 · THE WELL mis-handles simultaneous line clears (stacked rows get stranded).**
`clearFullRows` (`well.ts:135-153`) scans bottom-up and decrements y after clearing, so the row
that shifts INTO the cleared index is never re-examined; `lockPiece` calls it once per lock
(`well.ts:303`). Empirical: two adjacent full rows → returns `cleared=1` and leaves **one full
row stranded** mid-grid; a 3-stack → `cleared=2`, leftover 1. Effects: line counter/quota/points
undercount per lock ("WELL CLEARED" fires late), flash row ≠ cleared rows, stranded full rows
only clear on the NEXT lock. The shipped selfTest never tests adjacent full rows
(`well.ts:511-514` are single-row cases). Fix: loop without decrementing on clear (re-check the
same y), or iterate with a compaction filter.

### MEDIUM

**F9 · RED LIGHT cadence is completely seed-blind.**
`buildCadence` draws rng only into `if (… || rng() < 0)` — always false (`redlight.ts:94`);
mulberry32 output ∈ [0,1). Probe: seeds 111 and 999999 produce byte-identical schedules; the
schedule is a pure function of (depth, timerLen). Every red-light round at the same depth plays
identically — "Seeded cadence" header claim false, zero replay variety, and the drawn value does
nothing. Fix: actually use the roll (e.g. jitter green/red ±15%) or delete the draw.

**F10 · SABER CLASH feint teleports the marker ~47% of the ring.**
`posAt` mirrors position around the arc center at feint time instead of reversing direction:
`center + dir·rev·speed·t` (`saberclash.ts:91-95`). At `feintMs` the marker jumps discontinuously
— measured jump 0.469 of the full circumference (plan seed 9, depth 6) immediately after the
350 ms telegraph blink. A "reversal" should be continuous: `p(feint) then integrate −dir`.

**F11 · DRONE-DODGE: a drone that hits you never goes away.**
`registerHit` (`dronedodge.ts:249-255`) applies −7 hp + 600 ms invuln but leaves the drone homing
on your cursor; it re-hits every 600 ms indefinitely (homing keeps it glued). Live idle runs
accrued hpDelta **−131 over 19.2 s** and −33 over 8 s. Despawn (as a non-dodge) or bounce the
drone on contact.

**F12 · TIDE POOL pays NaN points at depth 0 (division/index boundary).**
`tidepool.ts:187`: `TP_PAY[Math.min(TP_PAY.length-1, ctx.depth-1)]` → `TP_PAY[-1] === undefined`
when `depth ≤ 0`; win payout becomes `NaN` (bonus add keeps NaN). Live probe (depth 0, seed
5150): `{correct:true, points:NaN, summary:"CORRECT POOL · DRY SHOES +15"}` — NaN would poison
`r.score + res.points` downstream. Latent today (director starts depth at 1) but one guard away
from a corrupted run. Clamp the index at 0 like every other scene clamps its curves.

**F13 · Anonymous `root.on('pointermove')` handlers leak on the engine-owned container.**
`floorfall.ts:287-298`, `dronedodge.ts:294-297`, `hunterdodge.ts:272-274` register unnamed
closures on `ctx.container`; their teardowns (`floorfall.ts:359-363`, `dronedodge.ts:428-432`,
`hunterdodge.ts:350-354`) remove only ticker/window/children — the root itself survives the
stage. Every Floor-Fall/Drone-Dodge/Hunter-Dodge mount adds another permanent move handler that
keeps running during all later stages (stale closures referencing dead tile/drone arrays).
Slots (`slots.ts:371,377`) and serpent (`serpent.ts:278-279,298-299`) show the correct pattern —
name the handler, `root.off` in teardown. Also note laserstorm/floorfall/dronedodge/hunterdodge
leave `root.eventMode='static'` + full-screen `hitArea` set on the shared container after finish.

### LOW / POLISH

**F14 · ONE-ARMED GOD: doc says "VOIDs break pairs", implementation disagrees.**
`evalLine([2, VOID, 2])` → `{kind:'pair', amount:10}` (`slots.ts:105-116`; probe-confirmed).
Only void-heavy lines fail to pay; a void sandwiched between a pair still pays. Align the doc,
the selfTest assertion (`slots.ts:431` tests only `[VOID,VOID,2]`), or the math.

**F15 · LASER-STORM: `status` Text created and never updated.** `laserstorm.ts:198` — dead UI.

**F16 · TIDE POOL initial-paint comment is a no-op.** `tidepool.ts:362-363` sets `lastSub=null`,
which it already is; water sprite is unpainted until the first tick.

**F17 · Hue-wheel derivation inconsistent across scenes.** `seed % len` (redlight.ts:206,
tidepool.ts:184, serpent.ts:93, saberclash.ts:136) vs `(seed>>>5)%len` (slimegallery.ts:193),
`>>>3` (slots.ts:184), `>>>7` (well.ts:223). One hue per board holds everywhere, but the same
seed shows different hues per scene — cosmetic cross-scene variance, worth unifying.

**F18 · Unbounded pay curves flatten against the engine clamp.** `verdictFor` win =
80+20·depth (saberclash.ts:117) crosses the engine's 500-point cap at depth ≥21; parFor consumers
(laserstorm.ts:247, floorfall.ts:271, dronedodge.ts:273) exceed it beyond depth ≈4.6. Harmless
(engine clamps) but scaling silently stops mattering; other scenes self-cap via POINTS_CAP.

**F19 · Selftest runner coverage gap.** laserstorm/floorfall/dronedodge/hunterdodge suites run
only via direct-node guards in their own files; neither `selftest.ts` nor `selftest-portb.ts`
includes them, so the standard runner entry points skip 4 of 11 scenes. (Also: none of the suites
would have caught F1/F2/F3/F8 — they test pure builders only, never mount wiring or `step()`.)

**F20 · Sub-5 s timers latent overrun.** Six scenes floor budgets at `Math.max(5, timerLen)`
(e.g. redlight.ts:88, laserstorm.ts:104, floorfall.ts:79, dronedodge.ts:92, hunterdodge.ts:236
and the SETTLE_MS margins); with MP's `TIMER_MIN=1` a timerLen < 5 round overruns by design.
Latent unless short timers get dealt.

## Verified clean (explicitly checked, held)

- **Settle-exactly-once**: 11/11 live — post-settle abuse (300 extra ticks + window Esc dispatch)
  produced `extraSettles:0` everywhere; `onceResolve` + per-scene `dead` guards hold even when
  both timeout and Esc race.
- **Cleanup**: ticker delta 0, window-listener delta 0, `container.children.length === 0` after
  settle for every functioning scene (window-level listeners; see F13 for pixi-root handlers).
- **Same-seed determinism**: identical result JSON and identical settle tick on re-run for all 11
  scenes under fixed-step drive; all schedule builders byte-stable across 100–500 seeds.
- **Timer respect** (for the 8 scenes that use ctx.timerLen): live settle ≤ timerLen·1000 in every
  tight_tl8 and idle_tl20 run (e.g. redlight 7017/8000, tidepool 7917/8000, well 7917/8000).
- **Esc neutrality**: neutral `correct:null` result from every scene still alive at Esc.
- **Summary length**: max observed 34 chars across all verdict constructors incl. extreme tallies
  (700 SPLATS · 200 GOLD); nothing approaches the 64-char limit.
- **Laser-storm solvability rail**: exact sweep (not sampled) peak concurrency ≤ 2 over 400
  seeds×depths — the 4-lane rail is never approached; schedule always fits budget−700 ms.
- **Depth extremes 3 vs 27**: all param curves clamp as documented (paramsFor/fallParams/
  diffFor/effFor/hunterParams/speedMult/arcHalfWidth/gravityFor/quotaFor); buildCadence fits
  42.6 s inside a 60 s budget at depth 27; serpent queue (387 cells) covers quota(27)=39.
- **No reachable division-by-zero at depth ≥ 1**: budgetMs > 0, scoreRound denominator > 0,
  period > 0, tide max ∈ [2.2, 3.2]; sole boundary defect is F12 at depth ≤ 0.
