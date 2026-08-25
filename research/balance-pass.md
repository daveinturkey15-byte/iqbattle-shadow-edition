# Balance Pass — Economy Audit (READ-ONLY)

Scope: full scoring/hp economy across the engine funnel, demon sim, takeover
StageResult bands, emeralds, curse/gauntlet hp drains, and LMS attacks.
Every constant cites `file:line` in the live build. Recommendations are exact
constants for Main to apply after review.

---

## 0. Ground truth: how a point / hp point actually moves

| Path | Value | Source |
|---|---|---|
| Puzzle correct | `round(100*pz.difficulty + leftFrac*80)` | modes/mode-puzzle.js:118 |
| Puzzle wrong | `points:-40, hpDelta:-15` | modes/mode-puzzle.js:119 |
| Timeout injected | `points:-40, hpDelta:-15` ("TIME DROWNED YOU") | index.html:574 |
| Stage crash injected | `points:-40, hpDelta:-15` | index.html:565 |
| Missing-hpDelta fallback (non-good/non-neutral) | `-15` | index.html:684 |
| Good-points clamp | `[−200, 500]` | index.html:655 |
| Wrong-points clamp | `[−200, 500]` | index.html:664 |
| hpDelta clamp | `[−60, 60]` | index.html:684 |
| Streak bonus | `(streak−1)*20`, **uncapped** | index.html:655 |
| Solo score floor | **none** — `G.score+=shown` can go negative | index.html:675 |
| MP score floor | `SCORE_FLOOR = 0` (LMS only) | lms.js:54 |
| Difficulty curve | `depthDiff() = clamp(1+floor(round/6),1,5)` | index.html:280 |
| Stage gates | rounds 3/5/7 → acts 1/2/3 | index.html:482 |

Depth map: rounds 1–6 = diff 1, 7–12 = diff 2, 13–18 = diff 3, 19–24 = diff 4,
25+ = diff 5 (index.html:280). Puzzle difficulty is fed from
`ctx.diff = clamp(depthDiff()+amp,1,5)` (index.html:519) into the generators
(modes/mode-puzzle.js:47), so puzzle income scales 100→500 base across a run.

### Why Dave saw −200 at depth 6

Solo has **no score floor** (index.html:675). A 6-round opening at 50%:
3 correct ≈ +140 avg each (`100·1 + ~40 speed`) = +420, minus 3 wrongs
(−40) = +300… but every *failed takeover*, timeout, and crash also bills −40
(index.html:574, 565) with **zero payout**, and hp bleeds −15 per miss. Two
demons bank ~158/round in the same window (§2). The scoreboard reads negative
fast and nothing stops it. LMS already codifies the fix philosophy:
scores never go negative (lms.js:54, C7).

---

## 1. (a) Wrong-answer penalty curve by depth

Current: flat `−40 pts / −15 hp` at every depth (modes/mode-puzzle.js:119;
index.html:565, 574; default hp −15 index.html:684).

Problem: at depth 1–6 the player banks ~140–180/correct, so −40 is ~25% of a
good answer AND −15 hp is ~2.5 misses from triage territory; stacked with
horsemen (−20, §4) a bad minute ends runs before stage 2 unlocks (round 5,
index.html:482). At depth 20+ the same −40 is noise against 300–500 income.

**Recommendation — depth-scaled, keep the §8 grief boundary** (victim recovers
inside 2 good answers; lms.js:31-42):

| Depth (diff d) | Pts penalty now | → proposed | HP now | → proposed |
|---|---|---|---|---|
| d1 (r1–6) | −40 | **−20** | −15 | **−7** |
| d2 (r7–12) | −40 | **−30** | −15 | **−9** |
| d3 (r13–18) | −40 | **−40** (unchanged) | −15 | **−11** |
| d4 (r19–24) | −40 | **−50** | −15 | **−13** |
| d5 (r25+) | −40 | **−60** | −15 | **−15** (unchanged) |

Exact constants: `wrongPts = −(10 + 10*d)`, `wrongHp = −(5 + 2*d)` where
`d = depthDiff()` (index.html:280). Touch points: modes/mode-puzzle.js:119
(stage may read `ctx.diff`), index.html:565, 574, and the :684 default.

Timeout: **half the pts penalty, min −15** (`max(−15, wrongPts/2)`), same hp
curve. Thinking-too-long ≠ confidently-wrong (matches balance.md:27 intent);
still bills hp so timer abuse doesn't become a strategy.

Solo score floor: apply `G.score = Math.max(0, G.score + shown)` at
index.html:675, mirroring LMS SCORE_FLOOR (lms.js:54). The board should never
read −200; elimination pressure lives on the HP track, where it's legible.

---

## 2. (b) Demon sim — accuracy curve + per-round cap

Live sim (index.html:621-630): once per round, delayed `rnd(5, spd*1.5)` s;
success `p = clamp(acc − (depthDiff()−2)*0.05, .30, .95)` pays `ri(80,140)`
(avg 110), miss pays `ri(−30,20)` (avg −5). Solo fields exactly two demons,
`ROSTER.slice(0,2)` = BEELZEBOT (.72/.11s) + MALGORATH (.64/.14s)
(index.html:347-350, 470).

Expected pts/round today (E = p·110 − (1−p)·5):

| Depth | acc mod | Bee p → E | Mal p → E | Pair E/round |
|---|---|---|---|---|
| d1 (r1–6) | **+0.05** | .77 → 83.5 | .69 → 74.4 | **≈158** |
| d2 | 0 | .72 → 77.8 | .64 → 68.6 | ≈146 |
| d3 | −0.05 | .67 → 72.0 | .59 → 62.9 | ≈135 |
| d5 | −0.15 | .57 → 60.5 | .49 → 51.3 | ≈112 |

Two structural problems:

1. **Early inversion**: the `−(diff−2)` baseline zeroes at diff 2, so demons
   get a **+.05 accuracy boost during rounds 1–6** (index.html:623) — exactly
   when the player earns least (§0). Demons are strongest while the player is
   weakest; this is the "crushing by depth 6" amplifier.
2. **No per-round cap**: a demon can bank 140 in a round where the player
   failed a takeover for 0 (takeover fails pay 0, §3) — a 140-pt swing per
   demon per round.

**Recommendation:**

| Knob | Now | → Proposed | Source to touch |
|---|---|---|---|
| acc curve | `acc−(d−2)*.05` | `acc−(d−1)*.05` (zero at d1, keep the depth softening) | index.html:623 |
| Success payout | `ri(80,140)` | `ri(60,100)` (avg 80) | index.html:623 |
| Miss payout | `ri(−30,20)` | keep | index.html:623 |
| Per-round cap | none | `o.pts += Math.min(gain, 100)` | index.html:623 |

Resulting pair expectation: d1 ≈ **105/round** (Bee .72·80−1.4 ≈ 56.2,
Mal .64·80−1.8 ≈ 49.4) vs reference player ≈140–180 → the player leads at
decent play, demons close only when the player misses. Deep game: pair ≈85 vs
player 300+ — correct, because takeover payouts (§3) are the intended catch-up
income, and lms.js's own derivation treats 2×avg-gain as the recovery ceiling
(lms.js:35-42). Update the mirrored constants comment there
(`GOOD_GAIN_MIN/MAX`, lms.js:51-52) to 60/100 when applying.

---

## 3. (c) Takeover points normalization — puzzle stays primary

Live payout bands (all resolve through the engine clamp [−200,500],
index.html:655):

| Stage | Formula | Typical | Max | Source |
|---|---|---|---|---|
| **puzzle** | `100·diff + leftFrac·80` | 120–180 (d1) / 240–320 (d2) | 580 + streak | modes/mode-puzzle.js:118 |
| snake | `apples·25 + (apex 50 / survive 20)`, win = 8 apples / 45 s cap | ~120 (4 apples) | **250** | modes/snake.js:30-32, 52-53, 207-211 |
| redlight | `120 + tier·40` | 160 | 240 | modes/mode-redlight.js:37 |
| tetris | `60 + 45·lines + (early 70)` | 105–340 | ~340 | modes/tetris.js:30, 448 |
| pacman | `2·pellets + 120 + 50·ghosts` | 90–330 | ~330+ | modes/pacman.js:32, 479 |
| doom | `140 + 60·kills + 80(exit) − 10·miss` | 140–380 | ~400 | modes/doom.js:37, 531 |
| battleship | `40·hits + 120·sunk + 60 − 20·incoming` | varies | **>500 pre-clamp** | modes/battleship.js:28, 624-625 |
| slots | 3 spins; jackpot line **600** "sanctioned breach" | varies | 600 → **silently clamped to 500** | modes/slots.js:30-31, 406; index.html:655 |
| fractalsolve | 100 / deep 130 | 100–130 | 130 | modes/fractalsolve.js:195 |
| hypercube606 | 100 / native 150 | 100–150 | 150 | modes/hypercube606.js:177 |
| hunterdodge / dronedodge / floorfall | `round(100·diff + leftFrac·80)` + small bonus | = puzzle parity | parity +40/+15·guards/+25 | modes/hunterdodge.js:39; modes/dronedodge.js:33; modes/floorfall.js:39 |
| gauntlet | 30 iff 4/4 riders pass | 0–30 | 30 | modes/gauntlet.js:131 |
| saberclash | always 0 (re-weights pending stake) | 0 | 0 | modes/saberclash.js:29, 322 |

Findings:

- Three stages already use puzzle-parity bases (hunterdodge, dronedodge,
  floorfall) — that IS the house style; the fixed-payout stages predate it.
- At depth 7–12 (d2) a *survivable-failure* action stage pays up to
  340–400+ while mastering the puzzle at the same depth nets ~240–320.
  Action stages currently out-pay the core skill by ~1.3–1.6× with lower
  cognitive load — the hierarchy is inverted.
- Slots' documented 600 ceiling is dead code under the engine's 500 clamp
  (index.html:655) — doc/engine mismatch (modes/slots.js:30-31 vs
  index.html:655).

**Recommendation — one global rule + three constants:**

1. **Global takeover cap** (engine-side, applied to `res.points` when
   `G.curStage !== 'puzzle'` and `res.correct === true`):
   `cap = 100*d + 60` → d1 160, d2 260, d3 360, d4 460, d5 560 (engine 500
   clamp still binds at d5). Rationale: median puzzle answer at diff d with
   ~half clock = `100·d + 40`; takeovers may beat par by ≤20 but never reach
   the skilled-fast puzzle ceiling (`100·d + 80` + streak). Touch point:
   index.html:655 (add the conditional before the clamp).
2. **snake retune** (it fires earliest and hardest — weight 6, DEPTH-1
   eligible): `points = apples*20 + (apex ? 40 : survived ? 15 : 0)`
   → apex max **200** (= d1 cap), survival capout 175, typical 4-apple 95.
   Touch: modes/snake.js:207-211 (and header contract line 30).
3. **redlight retune**: `120 + tier*40` → `90 + tier*30` (90–180), keeping
   its fail side at the (now depth-scaled) wrong curve. Touch:
   modes/mode-redlight.js:37.
4. **slots doc fix**: change the header comment to "600 natural, engine
   clamps 500" OR exempt `kind:'score'` jackpots — recommend the comment fix;
   600 through a 500 clamp is a silent lie players can feel.
   Touch: modes/slots.js:30-31.

Leave tetris/pacman/doom/battleship/fractal/hypercube/gauntlet formulas alone —
the global cap trims their tails without touching tuned internals, and
base-parity stages stay byte-identical.

Net check at d2 (rounds 7–12): puzzle skilled ≈ 300+, puzzle median ≈ 260 =
cap → mastery is the only way past the cap; a great snake run lands 200–260.
Takeovers pay fairly, never better.

---

## 4. HP ledger — drains vs heals

Drains (all flow through the [−60,60] clamp, index.html:684):

| Source | Amount | Source ref |
|---|---|---|
| Wrong answer / timeout / crash | −15 (→ §1 curve) | modes/mode-puzzle.js:119; index.html:565, 574 |
| Horsemen curse | −20 | curse-pack.js:254 (roll: 18% on bad/chaotic aligns, curse-pack.js:318-320) |
| Gauntlet Famine 'curse' mark | **−20 extra on next wrong** | modes/gauntlet.js:222 |
| Gauntlet Death 'flinch' | −10 on round entry | modes/gauntlet.js:201 |
| LMS curse weapon | −10 hp on target | lms.js:59 |
| Red light fail | −12 (or `T.hurt`) | modes/mode-redlight.js:30 |
| Snake wall/self-bite | −10 | modes/snake.js:212 |
| Tetris 0 lines | −15 | modes/tetris.js:449 |
| Pacman caught | −15 | modes/pacman.js:480 |
| Dronedodge hits | −7 each, batched | modes/dronedodge.js:34, 445 |
| Laserstorm vaporize / bail | −10 / −5 | modes/laserstorm.js:32, 324, 347 |
| Slime escapes ≥6 | −10 (−15 fire phase) | modes/slime.js:47 |
| Neutral "nobody wins" | −25 **pts**, 0 hp | index.html:652 |

Heals:

| Source | Amount | Source ref |
|---|---|---|
| Good-aligned world entry | +30 (round>2) | index.html:325 |
| Pickup `{kind:'health'}` | clamp(value,1,40), default 10 | index.html:311 |
| Sunlit blessing | +10 (25% on good aligns) | curse-pack.js:293, 314-316 |
| Slots jackpot | +10 | modes/slots.js:33, 407 |
| Doom medkits | +8 each (net hpDelta clamp ±15) | modes/doom.js:38-39, 533 |

**Bug-shaped constant:** the Famine 'curse' aftermath emits `hpDelta:-20`
ONCE *on top of* the wrong-answer −15 (modes/gauntlet.js:214-222) → real cost
**−35**, while its own design comment says "baseline −15 plus the rider's
extra −5" = −20 total (modes/gauntlet.js:184-185). Either the value or the
comment is wrong. **Recommend: emit `hpDelta:-5`** (honors the documented
design, total −20).

**Recommendation — heal bumps** (drains already softened by §1):

| Knob | Now | → Proposed | Touch |
|---|---|---|---|
| World heal | +30 | **+35** | index.html:325 |
| Sunlit | +10 | **+15** | curse-pack.js:293 |
| Pickup health default | 10 | **15** (clamp 1–40 keep) | index.html:311 |

Sanity model, reference player (70% correct) over depths 1–12: wrongs 3–4 ×
new curve (−7/−9) ≈ −30 hp; horsemen EV ≈ 18% of bad-aligned rounds × −20 ≈
−8; flinch/famine occasional ≈ −10. Total ≈ −48 vs heals: 1–2 world entries
(+35) + sunlit EV ≈ +40 → net ≈ break-even at decent play. Sloppy play
(50%) still bleeds ≈ −80 over the same span and dies around depth 20–25
instead of 8–10. Chaos stays present; death is earned, not ambushed.

---

## 5. (e) Attack economy sanity at depth 5+

Weapons are static (lms.js:57-60; UI mirror index.html:443):

| Weapon | Cost | Score dmg | HP | Recovery boundary check (2 good answers) |
|---|---|---|---|---|
| rotten | 80 | 120 | 0 | 120 ≤ 2×80..140 ✓ (lms.js:35) |
| curse | 150 | 200 | −10 | 200 ≈ 2×110 avg ✓, exceeds worst-case 160 by design (lms.js:36-42) |

At d5 the average good answer pays 300–580 (§0), so rotten dmg 120 is <half a
single answer and curse 200 barely one — attacks become confetti exactly when
LMS endgames happen. Costs, however, stay meaningful against any score, so
**scale damage, not cost, and scale cost only mildly**:

| Weapon | Cost now → prop | Dmg now → prop (d = depthDiff) |
|---|---|---|
| rotten | 80 → `60 + 15*d` (d1 75 · d3 105 · d5 135) | 120 → `60 + 20*d` (d1 80 · d3 120 · d5 160) |
| curse | 150 → `100 + 25*d` (d1 125 · d3 175 · d5 225) | 200 → `100 + 30*d` (d1 130 · d3 190 · d5 250), hpDelta −10 flat keep |

Boundary check holds at every d because victim income scales with the same
`d` (≥2 good answers recover any dmg). Touch: lms.js:57-60 (make dmg/cost
functions of `req.depthDiff` passed by host — postRoundChain at
index.html:736-737 already has `G.round` in scope) **and delete the duplicate
table at index.html:443** — read `IQ.LMS.WEAPONS` there instead; two copies
of the constants WILL drift (they already disagree structurally: the HTML copy
omits `hpDelta`).

Parity guard note: attacks are rejected rounds ≤2 (lms.js:147) — keep; with
the §1 softened early penalties, early attacks would be disproportionately
cruel anyway.

---

## 6. Emerald side-notes (audit complete; changes optional, low priority)

| Emerald | Live behavior | Note |
|---|---|---|
| CHAOS CONTROL | frozen round pays +150, once/run | index.html:650 |
| CRIMSON VEIL | impossible pays +40 instead of −25 | index.html:651 vs :652 |
| DOOM BLOOM | ×1.3 good; wrong stings rivals 20 | index.html:656, 666 |
| GRAVITY GREED | steals 60 from leader per correct | index.html:657 |
| FINAL CHAOS | ×2 every 10th depth; a bombed 10th **halves the ENTIRE run score** | index.html:658, 665 |

Only flag: FINAL CHAOS's bomb (`G.score*.5`, index.html:665) is the single
largest swing in the game and compounds the −200 feeling when it lands mid-
slump. If Main wants one more knob: cap the bomb loss at `min(G.score*0.5,
300)`. Emerald offer cadence is every 4th depth, solo-only (requires
`G.opps.length>0`, index.html:749) — unchanged.

---

## 7. Apply order (for Main)

1. §1 wrong curve + solo floor (index.html:565, 574, 664-675, 684;
   modes/mode-puzzle.js:119) — biggest feel fix, smallest diff.
2. §2 demon curve/cap (index.html:623; comments lms.js:50-53).
3. §4 famine −5 fix (modes/gauntlet.js:222) + heal bumps (index.html:325, 311;
   curse-pack.js:293).
4. §3 takeover cap (index.html:655) + snake/redlight retunes +
   slots comment (modes/snake.js, modes/mode-redlight.js:37, modes/slots.js).
5. §5 weapon scaling + de-dupe index.html:443 → `IQ.LMS.WEAPONS`.

After applying, re-run the smoke set (`.smoke-gauntlet.js` asserts the 30-pt
aggregation; `.smoke-phoenixritual.js` asserts payout tables) and update
lms.js:31-42 header derivation numbers to match §2.
