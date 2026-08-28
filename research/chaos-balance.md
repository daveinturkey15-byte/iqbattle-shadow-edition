# Chaos Pacing Design — IQ Battle: Shadow

*Author: ChaosBalance. Grounded in `shadow.js` `Shadow.TIMELINE` (L202–231), `index.html` stage gates (L255–296) + answer flow (L393–430), `chaos.js` effects API (`setAct`, `setIntensity`, `embers`, `shake`, `glitch`, `flash`, `invert`, `pulse`).*

**Run shape:** rounds clamp to **5–20** (`startRun`, L243); reference run = **10 rounds / 60s timer**. Stage gates are fixed round numbers, not probabilities (`nextRound`, L261):

| Gate | Round | Stage | Body class | Chaos layer |
|---|---|---|---|---|
| G1 | 3 | 1 | `act-1 corr-1` | crimson mist, intensity `.40` |
| G2 | 5 | 2 | `act-2 corr-2` | embers begin, intensity `.70`, dual/wild gens enter |
| G3 | 7 | 3 | `act-3 corr-3` | full hellscape, Shadow appears banner, intensity `1.0` |

---

## 1. Per-stage chaos probability table

One roll per round at deal time (host-side, seeded like puzzles so MP clients agree). `corrupt` = one non-hole cell hue-shifted after generation (`index.html` L281–284). Proposed values replace/augment `TIMELINE`; "current" column is what ships today.

| Effect | Stage 0 (r1–2) | Stage 1 (r3–4) | Stage 2 (r5–6) | Stage 3 (r7+) |
|---|---|---|---|---|
| `subtleGlitch` (UI-only) | r2 only | 20% | 30% | 40% |
| `paletteLevel` | 0 | 1 | 2 | 3 |
| `corruptChance` (board lie) | 0% | 15% | 25% | 35% (cap) |
| `zapAtFraction` mid-round power cut | r1 only @ .45–.55 | 0 | 10% @ .50–.65 | 15% @ .45–.65 |
| board drift starts (see §3) | never | never | 40% of rounds | 100% of rounds |
| cleanser (HIP TO BE SQUARE, see §2) | never | never | eligible | eligible |
| impossible round (see §4) | never | never | 6% | 10% |

Current-vs-proposed deltas: `TIMELINE` corrupt `0.15+0.05·(r−4)` cap `.35` already matches stages 1–3 if mapped by gate instead of raw round — keep formula, key it off `G.stage`. `impossibleChance` today is `min(0.12, 0.2)` = flat **12% from round 6** — too frequent and undramatic; replaced by §4.

**Anti-streak rule:** never two chaos effects on the same round beyond stage 2's cap of one "board-touching" effect (corrupt XOR zap XOR drift-onset XOR impossible). Roll order: impossible → cleanser → zap → corrupt → glitch; first hit wins. Guarantees puzzle solvability reads stay intact (a corrupted board must never ALSO be an impossible round).

## 2. HIP TO BE SQUARE trigger rates (relief, not interruption)

Cleanser contract (per CleanseSmith direction): all-square grid, trivially findable rule, no corruption/drift/zap possible, short timer bonus feel. Target cadence **every 4–7 rounds, stage 2+ only**, implemented as a pity counter, not pure RNG:

cleanseGap = eligible rounds since last cleanser (stage-2+ rounds only; a stage-0/1 round does not advance the counter)
trigger when rand() < 0.25 per eligible round
force trigger when cleanseGap >= 6          // hard ceiling: never more than 5 quiet eligible rounds
never two rounds in a row (Cleanse contract: consecutive suppression)
never on: impossible rounds, round 1, final round, or a round that rolled a zap
hard cap: 2 cleansers per run of <=12 rounds, 3 for 13+ round runs (reset() clears at startRun)
```

Expected gap with p=.25 + force-at-6: mean ≈ 4–5 eligible rounds, max 6 — inside the 4–7 target. **Deviation flag:** the shipped `IQ.Cleanse` draft uses flat 12% (mean gap ≈8 eligible rounds) — outside spec; bump to .25 + pity-force or accept slower cadence consciously.

Expected cadence (reference 10-round run): earliest possible = round 5 (first stage-2 round); typical first cleanser rounds 5–8, second rounds 9–12 if run extended; a 20-round run gets exactly 3 (cap).

| Property | Value | Why it feels like relief |
|---|---|---|
| Difficulty | d1, single-attribute rule | 10–20s solve vs 40s+ normal |
| Visual | palette snaps to clean luxe-navy for the round, `CX.inten(.15)` dip, embers paused | sensory exhale |
| Audio | `AU.p('levelup')` chime, no laugh/buzz stingers | positive contrast |
| Scoring | standard pts + guaranteed streak continuation (wrong answer still allowed but no −penalty) | low stakes |
| Shadow behavior | silent OR one mock-generous line ("Enjoy the gift. It's the last.") at ≤25% rate | he resents the mercy |
| Post-cleanse ramp | next round always full-intensity stage effects | whiplash back into horror |
## 3. Moving-board intensity curve

BoardMove real API (per MoverBoard): `IQ.BoardMove.setStage(n)`, `setEnabled(bool)`, `pause(ms)` (+ requested `setIntensity(0..1)` scalar multiplying amplitude). Drift params randomized per activation within stage-banded ranges:

| Stage | Amplitude | Period | Rotation | Extra |
|---|---|---|---|---|
| 0–1 | 0 (drift off) | — | — | static — learn the rules |
| 2 | 30–50 px | 12–20 s | ±1–2.5° | frame & opts-grid counter-phase (π offset, independent sin harmonics) |
| 3 | 55–90 px | 8–14 s | ±2–3° | lurches: random ±45 px kick, ~120 ms attack / ~700 ms decay every 6–12 s, each paired with `CX.shake(10–18px, 420ms)` |
| Cleanser round | intensity forced to 0 via `setIntensity(0)` / `pause()` | — | — | full stillness is part of the relief |
| Timer ≤5 s | `pause(remaining*1000)` — **shell-driven**: boardmove.js reads no game state, timer tick calls `IQ.BoardMove.pause()`/`setIntensity(0)` | — | — | fairness under clock pressure |

Safety already in contract: per-frame clamp keeps option centers ≥8 px inside viewport (breach flips drift direction); `prefers-reduced-motion` or `setEnabled(false)` fully disables. Confirmed with MoverBoard: `setIntensity(0..1)` ships (scales amplitude+rotation linearly), and pointer/touch ducking to 0.2× is built into boardmove.js while a pointer is down over an `.opt-btn` — picks never fight mid-drift. Remaining shell duties: cleanser → `setIntensity(0)`, impossible → `pause()`, last-5s → `pause(remaining*1000)`, reveal snap-back 200 ms ease-out.


## 4. Impossible-round rates (rare, dramatic)

Replace flat 12%-from-r6. Budget: ~**1 per run** typical, 2 maximum even in a 20-round deep run.

| Stage | Rate | Expected count (10r / 20r runs) |
|---|---|---|
| 0–1 | 0% | 0 / 0 |
| 2 (r5–6) | 6%, max 1 per run | 0.06 / 0.12 |
| 3 (r7+) | 10%, max 1 more per run, never back-to-back | 0.3 / 1.2 |

Drama requirements: host pre-commits at deal time (`pz.impossible`, shipped to clients as `imp` flag — existing path, L341); all 8 options render correct-looking; board freeze tell (§3); `SH.say(SH.q('impossible'))` fires on the *reveal*, never before (no pre-warning); banner "THIS ROUND MADE NO SENSE. NOBODY WINS."; −25 pts softened to −10 if player holds an emerald antidote (existing `chaos_control` / `crimson_veil` paths, L408–411). In MP the host rolls it once and broadcasts — clients must never re-roll locally.

## 5. Demon-speech frequency (present, not spammy)

Budget model: count every `SH.say` fire; enforce per-run quota. Existing call sites (all in `index.html`): appear (stage-3 entry, L203 — mandatory, uncounted), zap (L355), wrong 35% @ stage≥2 (L428), right 50% @ streak≥4 (L420), impossible (L411), relic pickup (L482), win/lose (L516).

| Stage | Max lines per round | Effective rate | Notes |
|---|---|---|---|
| 0–1 | 0–1 | ≤1 per 2 rounds | only milestone lines (round3 pool) — he's not there yet |
| 2 | 1 | ≤1 per round, suppress after 2 consecutive speaking rounds (1-round cooldown) | reactive only (wrong/right/impossible) |
| 3 | 1 | every round, but priority arbitration below | his domain |
| Cleanser round | 0–1 | ≤25% chance, mock-generous pool only | see §2 |

Priority arbitration when multiple triggers land same round (pick highest, drop rest): `impossible > appear > zap > relic > wrong/right (mutually exclusive) > milestone`. Hard caps: never >2 bubbles stacked (already enforced, shadow.js L166), never speak during timer's last 5s (don't cover reading the clock), quip pools cycle without repeat until exhausted (8-line pools × shuffle = 8 unique lines before reuse). Voice/TTS stays off by default per spec — text bubbles only; `opts.voice` remains opt-in flag.

---

### Implementation notes for owners
- **CleanseSmith:** your `IQ.Cleanse.maybeTrigger(stage,round)` / `end()` / `reset()` contract stands; adopt the §2 constants — rate .25/eligible round + pity-force at gap 6 (your draft's flat 12% lands ~every 8 eligible rounds, outside the 4–7 spec), keep never-consecutive, cap 2 (≤12r) / 3 (13+r). Shell integration: `Cleanse.active` suppresses embers/shake/glitch/drift that round; `end()` glitch snap + "back to my world." line counts toward the §5 stage-3 speech budget.
- **MoverBoard:** your banded amplitude/period/rotation table is adopted verbatim in §3; please add `setIntensity(0..1)` (cleanser + impossible rounds drive it to 0), plus touch-down amplitude ease (~20% while a pick is in progress). `prefers-reduced-motion` handling you already have covers the `IQB_MOTION` requirement.
- **shadow.js TIMELINE owner (DemonSay):** replace flat `impossibleChance` with §4 stage-keyed rates; add `cleanseEligible` + `driftOn` fields to the returned timeline object; keep mulberry32 seeding so host/client timelines match.
