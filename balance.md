# IQ BATTLE: SHADOW — Balance Proposal

Target: a **decent player** (≈70% correct, uses ~45% of the clock) should beat a competent demon field about **half** the time, and every emerald should be a real choice, never an auto-pick.

Baseline math (current build):

| Actor | Per-round expectation |
|---|---|
| Decent player, diff 3 | `0.7·(300+36+streak≈24) − 0.3·40` ≈ **245 pts** |
| BEELZEBOT (acc .72) | `.72·110 + .28·(−5)` ≈ **78 pts** |
| MALGORATH (acc .64) | ≈ **68 pts** |

Solo mode fields `ROSTER.slice(0,2)` (Bee + Mal), best-of-two ≈ **112 pts/round** — under half the player. The hidden amplifier: `simOpponent` fires **once per round** after a `rnd(5, spd·1.5)` s delay and is cancelled if `G.answered` fires first. A fast player denies demons *all* their points. Games are currently blowouts, not coin flips.

---

## 1. Base points formula

Current: `100*diff + speed*80 + (streak−1)*20`, wrong = `−40`.

| Knob | Now | Proposed | Why |
|---|---|---|---|
| Base | `100·diff` | `100·diff` | Keep. Difficulty scaling is the clearest signal in the game. |
| Speed bonus | `speed·80` | `speed·55` | 80 makes raw reflexes worth more than a full difficulty tier; 55 keeps fast play rewarded (~+41 typical) without letting a lucky clicker outrun thinkers. |
| Streak | `(streak−1)·20` uncapped | `min(streak−1,5)·25` | Cap stops runaway snowballs in long runs (20-round games hit ×19 = +360/round today); +25/step feels better than +20 and caps at +125. |
| Wrong answer | `−40` flat | `−30 − 10·(diff≥4 ? 1 : 0)` | Softens feel-bad at low diff; hard modes stay punishing. |
| Timeout (`pos===−1`) | same −40 | `−15` | Timing out while thinking ≠ confidently wrong. Encourages engagement instead of rage-quits. |

Net effect on the reference player: ≈ **215 pts/round** (was 245) — lowers the bar demons must reach.

## 2. Demon AI (ROSTER) — accuracy / speed / payout

Current: one tick per round, delay `rnd(5, spd·1.5)`s, gain `ri(80,140)` (avg 110) or `ri(−30,20)` (avg −5).

| Demon | acc now | acc → | spd now | spd → | E[pts]/round now | → |
|---|---|---|---|---|---|---|
| BEELZEBOT | .72 | .76 | 11 | 11 | 78 | **106** |
| MALGORATH | .64 | .70 | 14 | 14 | 68 | **97** |
| LILITH.EXE | .76 | .79 | 10 | 10 | 81 | **110** |
| SKELEVON | .56 | .63 | 16 | 16 | 58 | **87** |
| THE AUDITOR | .85 | .88 | 8 | 8 | 93 | **123** |
| payout | `ri(80,140)` | **`ri(105,165)`** (avg 135) | miss | `ri(−30,20)` | — | avg −5, keep |
| first-tick floor | `5s` | **`4s`** | — | — | — | sub-4s players still fully deny; 4–6s players no longer do for free |

Reasoning: with payout avg 135 and the new accuracies, best-of-two (Bee+Mal) expects ≈ **max(102, 94) + spread ≈ 150–160/round**, i.e. **~70–75% of the reference player's 215** — close enough that streak swings and corruption events decide games, instead of the outcome being settled by round 4. THE AUDITOR stays the raid boss (123) for players who want a sweat; SKELEVON remains the warm-up. Difficulty coupling `acc − (G.diff−2)·0.05` stays exactly as-is — it's good design (harder puzzles genuinely rattle demons).

## 3. Corruption timeline (Shadow.TIMELINE)

| Event | Now | Proposed | Why |
|---|---|---|---|
| `corruptChance` | `min(.15+.05(r−4), .35)` from r4 | `min(.12+.04(r−4), .32)` from r4 | Slightly gentler ramp; late-game corruption was hitting >1 in 3 rounds and reading as noise, not threat. |
| `impossibleChance` | flat `Math.min(.12,.20)` = **0.12** from r6 | `Math.min(.05+.03(r−6), .11)` from r6 | The `min(.12,.20)` is a bug-shaped constant (always .12) — over rounds 6–10 that's a ~46% chance of at least one "NOBODY WINS" round, directly violating "puzzles must make sense." Ramp to a lower cap: ~29% chance of one across the back five, usually zero-to-one per run. |
| paletteLevel / zap / shadowTalks | unchanged | unchanged | Presentation pacing is fine. |

Side effect: CRIMSON VEIL's expected value drops with fewer impossible rounds — compensated below.

## 4. Emerald tradeoffs (EMERALDS)

Design rule applied: **no emerald should exceed ~±12% of a run's total score in expectation**, and each needs a real cost.

| Emerald | Now | Proposed | Why |
|---|---|---|---|
| 💠 CHAOS CONTROL | frozen impossible round = +150 | **+175**, but pick locks out DOOM BLOOM offer next pick | Pure insurance had near-zero opportunity cost; pairing it against the greediest offensive gem forces an identity choice. |
| 🌹 DOOM BLOOM | +30% pts, wrong stinks rivals 20 | **+22% pts, sting 25, self-cost −10 on your own wrong** | 30% multiplicative on the strongest scorer was mandatory-pick territory (+70/round for a decent player). 22% + a personal wrong-tax makes it greed with teeth. |
| 🧲 GRAVITY GREED | pull 60 from leader per correct | **pull 45, capped at draining to ≥0, +0 if you're the leader** | 60/round × ~7 post-pick rounds ≈ +420 swing — the whole game. 45 with the leader-exclusion clause turns it into a catch-up tool, not a win-more engine. |
| 🏹 BLACK ARROW | one skip, +10 | **one skip, banks 40 pts, immune to that round's wrong-answer penalty** | Weakest gem by far (net +10 vs −40 avoided). +40 flat makes it a genuine tempo play on a corrupted board. |
| 🩸 CRIMSON VEIL | corrupt/impossible can't hurt you (+40 on impossible) | keep immunity; impossible now pays **+55**; corrupted rounds you answer correctly grant **+15 bonus** | Compensates for §3 lowering impossible frequency; the +15 converts pure defense into mild aggression so it competes with offense picks. |
| 🌀 FINAL CHAOS | last round ×2, bomb halves run | last round **×1.75**, bomb costs **40%** of run | ×2/+50% swing on one round made finals a coin-flip spectacle regardless of the previous nine; 1.75/−40% keeps drama, trims variance slightly. |

---

## Expected outcome

Reference player ≈ 215/round vs demon best-of-two ≈ 155/round: a player performing at reference level wins most games, a player at 55% correct (~160/round) loses most — the crossover sits almost exactly at "decent," which is where win rate converges to ~50%. Every emerald now trades something (doom bloom self-tax, gravity greed leader clause, final chaos smaller ceiling/floor) so picks express intent rather than math homework.
