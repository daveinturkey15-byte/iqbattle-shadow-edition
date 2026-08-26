# LMS wiring pass — 2026-08-26

Closes handoff item **2 (LMS UI wiring)** and, along the way, six defects — four of them
live-only, invisible to both the node gates and a screenshot — plus one regression this pass
introduced and caught.

Entry state: handoff grade 8.2/10, all gates green, `mpfeat.ts` built and self-tested but
"the in-run UI/scoreboard integration into main.ts is pending".

---

## What shipped

### The match layer now has a middle

`mpfeat.ts` was pure per-call rules and `mp.ts` was the wire; neither held MATCH state, so
main.ts was left to invent it. Three modules now sit between them, split by what a node gate
can reach:

| Module | Owns | Gate |
|---|---|---|
| `scenes/lms.ts` | Match-state reducer — every export returns a NEW state | `node --experimental-strip-types src/scenes/lms.ts` |
| `scenes/lmsdirector.ts` | Sequencing behind injected effects: who folds what, when a depth closes | driven by the gate below |
| `scenes/selftest-lms.ts` | A full 3-seat match through the real `MpSession` on a loopback wire | `node --experimental-strip-types src/scenes/selftest-lms.ts` |
| `scenes/attackmenu.ts` | Weapon-pick overlay, priced per depth, escapable | covered by G4 |

main.ts keeps only effects (Pixi scenes, toasts, timers, advance) and is ~40 lines of wiring
to the director. The sequencing that decides whether two screens agree is now testable.

### Protocol additions (`scenes/mp.ts`, additive)

- `scores{n,scores,hp,reason}` — an out-of-band table push. Deliberately **not** a reveal:
  reveal is the advance signal, so a mid-depth score correction riding one would make every
  client skip a round the moment somebody threw a tomato.
- `hp` map on both `reveal` and `scores`. Elimination is host-decided, so without a broadcast
  HP map a curse could drain a client to death with no visible warning — the ladder now shows
  a health rail per seat.

### Host authority, hardened past the v1 relay

A client's `sr` frame carries a **claim**, not a score. On puzzle depths the host recomputes
the points itself from (difficulty, the streak it tracks for that seat, midas) via the same
`pointsFor()` the solo path uses, so a tampered client can at most lie about whether it was
right. Only takeover depths adopt a reported delta, under `clampSr` plus a takeover ceiling.
Duplicate `sr` frames for one depth are dropped host-side — the answer lock is on the wire,
not just in the scene.

Verified: a client claiming `points: 9999, hpDelta: 60` on a puzzle depth gains exactly
`pointsFor(diff, streak, midas)` and heals nothing.

### Depth lifecycle

Closes when every ALIVE seat has answered, or when the host's clock expires (silent seats eat
the wrong-answer bite; answerers are spared). Host then broadcasts `reveal` → runs the
elimination sweep → `elim` / `end` as needed. Clients never advance on anything but a reveal.

### Attacks

Click a rival's sidebar card → weapon menu. Depth-scaled straight off the v1 balance curves;
one attack per seat per depth; depths 1–2 parity-guarded (no card is even clickable). Refused
inbound frames die silently rather than telling a client which rail it hit.

---

## Defects found and fixed

**D1 — ghost/danger buttons had no hit area (severity: blocker).**
`makeButton`'s ghost/danger branch draws one `Graphics` face, which is then also assigned as
`sheen.mask`. Pixi excludes masks from hit-testing, so those buttons had no hittable child at
all: **visible, correctly bounded, and completely unclickable**. That is the landing **JOIN**
button — the entire join-by-code entry path — plus every LEAVE and both lobby timer steppers.
`getBounds()` still reported the right rect, which is why nothing caught it; a screenshot
cannot catch it either. Fixed by giving `makeButton`/`luxePill` an explicit `hitArea`
rectangle. Almost certainly a regression from the luxe restyle (9cd245e).

**D2 — client rounds stacked forever (severity: major).**
`mountRemoteRound` called `clearCurrent()` then mounted the board straight into `view`. Since
`current` was null by then, nothing ever removed it: every client round parented to an
untracked container and accumulated for the whole run — chrome-less boards piling up, and no
shell header, timer or backdrop on the client at all. `deal()` now takes an optional remote
round plan and owns the scene lifecycle for both roles.

**D3 — the emerald interlude drowned you (severity: major).**
The round tick kept counting under the relic-pick screen, so a player deliberating past the
timer took the timeout hp bite and got advanced mid-choice. In MP it would have swept the
whole table for a depth nobody could answer. The interlude now stops the tick.

**D4 — `addSeat` resurrected the eliminated (severity: blocker; self-inflicted, caught by the
new gate).** The host re-syncs the roster every depth. The first cut of `addSeat` defaulted a
known seat's phase back to `'alive'`, so every sweep was undone one depth later: eliminated
players kept scoring, and end-when-one never fired. A seat's phase is now initialised exactly
once and never rewritten — rejoining under the same uid does not buy a way out of elimination.

**D5 — persona overlays outlived the run (severity: minor).**
`initShadow`/`initLarge` mount into `view`, not the scene root, by design (they must outlive a
depth). Nothing detached them, so the last chaos-round banner and the Shadow bubble sat on the
landing page after LEAVE. `toLanding()` now calls the existing `__detach`/`__detachLarge`.

**D6 — the Shell drew a dead second sidebar (severity: minor).**
`Shell` painted its own player panel at exactly `layouthelper.SIDEBAR`, which the puzzle scene
then painted over — two stacked luxe panels and a frozen "PLAYERS 0" header showing through
beneath the live one. The chrome sidebar is now opt-in (`ShellOpts.sidebar`, default off).

**R1 — solo runs could not die (regression, caught live, fixed).**
Every run in this game is a hosted room, so `lms` is non-null even solo — which routed the
solo player past the `hp <= 0` death check and, worse, let the elimination sweep promote the
lone seat to `'spectator'`, locking them out of their own run. Elimination is now skipped
entirely below two alive seats, and `deal()` applies the solo HP rule whenever the room is not
a contest (`director.isContest()`).

---

## Streamline pass (owner directive 2026-08-22: leave it simpler than you found it)

Auditing `main.ts` for single-occurrence identifiers turned up four more things **imported or
stored and then never used** — the same "built but not wired" class as the LMS item itself:

| Symbol | Was | Now |
|---|---|---|
| `playReveal` (`fx/reveal.ts`) | imported since the FX wave, never called — the answer-reveal juice the README advertises has never run | called on every puzzle answer, handle torn down via `onSceneStop` (verified: adds one layer, `destroy()` removes it cleanly) |
| `maybeShowLegend` (`meta/onboard.ts`) | imported, never called — family legends never appeared | first sight of a family at depths 1–3 renders its plain-language line above the board (verified live: *"Columns double the count; each row starts a step higher."*) |
| `onHpThreshold` (`audio/director.ts`) | imported, never called — the low-HP audio ramp never fired | fed from `mirrorLocal()` on every hp change |
| `run.fateScoreMul` | assigned by `maybeCurse`, never read — curse score multipliers did nothing | real: `pointsFor(diff, streak, mul)` |

The `midas: boolean` input generalised to `scoreMul: number` (clamped to 0.25–3), which also
retires main.ts's `fateMidasActive()` TODO — midas is now just `mul > 1`.

**Multipliers are solo-only, deliberately.** `maybeCurse` rolls off the shared seed *and* the
player's own hp, so two screens can legitimately disagree about whether a curse fired. A
personal fate event must never move a shared ladder, so in a contest everyone scores on the
clean curve; solo, the multiplier applies (and the toast reads `CURSED ·` / `MIDAS ·`).

Also removed: the dead `setLayer` import (only the `setDreadLayer` alias was ever used), the
computed-but-unread `takeoverDue` local, `run.forgiveNext`, and the vestigial
`run.token`/`runToken` pair — staleness is guarded by run *identity* (`run !== r`) everywhere,
which is what the deferred-advance fix in c113796 actually relies on.

---

## Gate status

| Gate | Result |
|---|---|
| G1 `tsc --noEmit` project-wide, strict | PASS |
| G2 solver audit, 12 families × 150 | 1800/1800 PASS |
| G3 selftests (15 suites) | PASS |
| G3 soak (1000 puzzles + 26 takeover self-tests) | PASS |
| G3b LMS reducer + full-match convergence | PASS |
| G3b sweep, 60 matches × 24 depths | PASS — convergence held on every depth |
| G4 live browser, two tabs | PASS |
| `vite build` | clean; `__QA` hooks absent from output (0 occurrences) |

### G4 evidence

`vite dev` on :8792, two tabs on one origin (shared BroadcastChannel bus):

1. Host CREATE ROOM → code; joiner JOIN by code → roster 2. *(Only possible after D1.)*
2. START → client mounts the identical round **with full chrome** — shell header, DEPTH label,
   live timer, backdrop, 2-player sidebar. *(Only possible after D2.)*
3. Client answers → its own response clock lights (19.089s), the host still shows "waiting…",
   and the client does **not** advance.
4. Host answers → reveal → both tables converge on `DAVE:0 / MIRA:140`. 140 is
   `pointsFor(1, 1, false)` re-derived host-side from a bare `correct` claim.
5. Depth 2: clicking a rival card opens nothing — parity guard.
6. Depth 3: menu prices ROTTEN `cost 105 / −120` and CURSE `cost 175 / −190 · −10 HP`, exactly
   the mpfeat curves at d=3. Budget line reads "1 ATTACK LEFT THIS DEPTH".
7. ROTTEN lands: both screens converge on `DAVE:20 / MIRA:195` (attacker paid 105, victim took
   120); host toasts "DAVE TAKES −120", client "ROTTEN THROWN"; budget spent, card no longer
   targetable.
8. Emerald interlude at depth 4 holds without draining the clock; chaos round (LASER-STORM) at
   depth 6 mounts on both screens with tables still converged.
9. Solo re-check: 1-second round timer, 11 depths of timeouts → hp 0 → **MATCH TERMINATED /
   DESCEND AGAIN** (the solo end screen, not the ladder), phase still `alive`.

`__DBG.errors` and `__sessErr` empty throughout every run above.

### Driving the browser

`vite dev` installs `window.__QA` (`v2/src/qa.ts`, stripped from `vite build`): `texts()`,
`sees()`, `click(logicalX, logicalY)`, `clickLabel('opt3')`, `type()`, `state()`, `hit(x, y)`.
Gate G4 no longer has to be eyeballed.

**Gotcha (cost an hour).** A tab that is not compositing — hidden pane, headless, background
tab — never runs Pixi's ticker, so world transforms are stale and
`renderer.events.rootBoundary.rootTarget` is null. Every hit test misses and every synthetic
click is swallowed *silently*: the driver reports success while nothing reacts. Call
`app.render()` once before driving and after any layout change. A background tab also reports
a 0×0 viewport, so emulate a size and dispatch a `resize` before mapping coordinates.

---

## The elimination rule — measured, then fixed (owner-approved)

**The finding.** The seeded sweep (60 matches × 24 depths, randomised answers/attacks/
timeouts/departures) landed **201 attacks and 439 timeouts but only 6 eliminations across 1440
depths, and 0 of 60 matches ended.** An LMS match that cannot eliminate anyone is not an LMS
match: it ends when people get bored and leave.

**Why.** v1's `'and'` verdict kills a seat only when its score is at the floor *and* its hp is
at zero *in the same sweep*. Score recovers at 60–100 per answer while hp moved a flat −12 per
mistake, so the two floors essentially never coincided. And the AND was not really a balance
choice — it existed because every seat **starts on 0 points**, so a naive `'or'` would wipe the
whole table on the very first sweep, before anyone had scored. The rule was papering over a
contradiction rather than expressing a design.

**The fix — HP is the life bar, score is ammunition.** The score floor comes out of the death
test entirely (`ELIMINATION_RULE` = `{ mode: 'or', floor: -Infinity }`, so `pts <= floor` is
unreachable) and HP alone decides. Score keeps both of its real jobs — the ladder, and paying
for attacks — and the `target-down` guard still stops anyone kicking a seat with nothing left
to take. `mp.ts` and `mpfeat.ts` are untouched; their rails already took this configuration.

**And the descent got teeth.** A wrong answer or timeout now costs `12 + 4·(diff−1)` HP:

| depths | 1–5 | 6–11 | 12–17 | 18–23 | 24+ |
|---|---|---|---|---|---|
| bite | −12 | −16 | −20 | −24 | −28 |

Depths 1–5 are byte-identical to v1, so the opening is unchanged; the sanctuary heal stays a
flat +20, so a reprieve is worth relatively less the deeper you go. This applies solo as well
as in a match — one formula, and an endless descent whose mistakes never got costlier had no
teeth either.

**Result, same sweep, same seeds:**

| | before | after |
|---|---|---|
| eliminations | 6 | **104** |
| matches reaching a winner | **0 / 60** | **59 / 60** |
| end depth (min / median / max) | — | **10 / 15 / 24** |

That is under deliberately adversarial play (12% of seats go silent every depth); real players
who answer more will last longer. Both thresholds — ≥80% of matches resolving, median end
depth ≥6 — are now **asserted in the gate**, so a future change that makes matches unwinnable
or wipes the table instantly fails in node rather than in front of a player.

### Refinements shipped with it

Making HP the life bar makes HP the most important number on screen, so it is now readable:
the sidebar card carries the health rail **and** an exact numeral (glanceable and precise); the
attack menu shows the target's HP and flags `ONE PUSH FROM THE DARK` at 25 or below, because a
curse's −10 is a kill move now rather than chip damage; and the elimination toast names the
seats that drowned instead of counting them.

## Still open

- ~~**Handoff item 1 — idle-host join**~~ — **verified 2026-08-26.** A host was left sitting in
  its lobby for **10.4 minutes**, then a **cold** client tab (fresh page load) entered the code
  and joined: roster converged to 2, room label resolved, `__sessErr` empty. Note that until D1
  this could not have been reproduced at all — the JOIN button never fired.
- **Handoff item 3** — 5 v1 hook-pack breadths still need converting to the fate-module shape.
- **Handoff item 4** — human-feel tuning; needs a human.
- **Handoff item 5** — LevelEffect wiring for ranked board skins; pop-risk DoS hardening.
- **New:** chaos rounds show no ladder and take no attacks — the takeover scene owns the whole
  stage. Defensible as design (chaos rounds are chaos), but it is a choice, not an oversight.
