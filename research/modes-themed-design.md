# Themed Takeover Modes — Design Pass

READ-ONLY design for Dave's total rework (`C:/Users/david/Desktop/stuff/iqbattle`).
Scope: **9** themed/reflex takeover modes (red-light-green-light is StageCore's exemplar — deliberately excluded).
Companion docs: `research/mode-contract.md` (Stage contract, canonical `StageResult`) and `research/modes-arcade-design.md` (ModeDesignA — arcade modes; no mode overlap).
Thesis: each mode is a **full-screen takeover with its own input model**, not a modifier skin. If a mode can be described as "the round, plus X", it has failed this brief.

---

## 0 · Shared contracts

### 0.1 StageResult (canonical, per Stage contract)

Every mode terminates by returning **one** canonical result. Modes never emit hooks modifiers themselves; the ENGINE applies scoring/hp host-side:

```js
StageResult = {
  kind:     'score',
  correct:  true | false | null, // win → true · fail → false · timeout/structural → null
  points:   <number>,            // flat score award (replaces any scoreDelta idea)
  hpDelta:  <number>,            // signed hp applied by engine
  summary:  <string>,            // ≤48 chars, shown at interlude (banner role)
}
```

Mapping rule used throughout this doc: design-level `outcome 'win'|'fail'|'expired'` → `correct: true|false|null`. Per-round live damage that happens *inside* a stage still flows through the standard round pipeline (`hpDelta` modifier requests, host-clamped) while the stage runs; the StageResult's `hpDelta` covers only end-of-stage settlement.

**Cross-round carry:** the canonical shape has no carry field, so anything a mode hands to the NEXT round is written directly to the existing `IQ.Hooks.state` store under the mode's prefixed keys (e.g. `gauntlet:war`) — read by a thin aftermath hook on next `onRoundStart`. No contract extension needed.

### 0.2 MP determinism strategy

Three named patterns, aligned 1:1 with §0 of `research/modes-arcade-design.md`; each mode cites its pattern below:

- **seeded-sim** (= D1): every schedule a client can see — beam paths, laser cadences, fall times, rotation angles — is a *pure function of the round clock*: `f(t, params)`, params from `ctx.rng` at stage start. Zero per-frame RNG, zero `Date.now()`/`performance.now()` in gameplay decisions (hooks.js determinism rules 1–3 apply unchanged). Host and clients render identical choreography.
- **seeded-world + input-relay** (= D2/D3): the shared choreography is seeded, but pressure driven by *this player's* pointer/keys (hover dwell, flinch, hold-release, tap counts) resolves **locally** — your drones chase *your* cursor — and reaches score/hp only as integer verdicts relayed to the host, which clamps and broadcasts.
- **secret-host + validated-events**: used only where a stage must know something clients must not (Floor-Fall's spared-tile skip). The decision runs host-side pre-reveal; clients observe only the resulting visible events, which are themselves seeded and therefore replayable.

Timing judgments are always **quantized to 60 ms buckets** and reported as counts, never timestamps — replays/parity tools re-derive every verdict from `(seed, bucket counts)`.

### 0.3 Duration

Hard cap **≤ 45 s** per stage including intro/outro wipes. Modes that end early on player action list typical vs cap.

### 0.4 Relationship to existing packs

`pack-hunters.js` ships in-round modifier versions of floor-fall, sky-laser, hunter-beam; `dims.js` ships a cosmetic `'606d'`. When the takeover runner lands, each mode below **supersedes** its hook ancestor on its bound worlds (takeover registration wins by weight); the hook version remains as the low-depth fallback for rounds 1–2, respecting parity rule C8. Migration is deletion of the hook body once takeover variants pass parity smoke — no shim layer.

---

## 1 · FLOOR-FALL — the ground betrays your picks

**Bind:** bad-align worlds — primary `volcano`, rotate pool `wasteland-roads`, `hazard-pit` (all registered, align `bad`). Supersedes the pack-hunters floor-fall hook.

**Fantasy:** the 8 answer options are stone tiles on a collapsing floor over lava. Hesitation kills tiles — possibly *your* pick.

**Input model:** pointer/touch only. The cursor is your body: standing on a tile loads it. Click commits the answer under the cursor. Keyboard fallback: `1–8` pick without standing (no fall risk, no bonus eligibility).

**Mechanic:**
- Fall schedule: seeded at stage start from `ctx.rng`; first fall at 25% of stage budget, then every `gap` seconds (seeded-sim: times fixed at start).
- A tile cracks (0.8 s warning shimmer) → drops. Dropped option = gone (engine disables that option slot).
- Standing on a tile when it drops: you plunge — `hp −12` (live, standard pipeline), screen shake, respawn on a random surviving tile after 0.7 s.
- Solvability rail: never fewer than **3 surviving tiles**. If the correct tile would drop while ≥3 wrong tiles remain, the schedule skips it — decided **secret-host** pre-reveal; the skip never leaks which tile was correct.

**Win / lose:**
- **Win** — click the correct option while its tile stands. Standard scoring, **+25 "surefooted" bonus** if ≥2 falls survived and you never plunged.
- **Fail** — wrong pick, or correct tile dropped leaving only wrong tiles and you pick one.
- Plunges wound live mid-stage; they don't themselves end the stage.

**StageResult mapping** (live plunge damage already flowed through the round pipeline):

| end | correct | points | hpDelta | summary |
|---|---|---|---|---|
| correct pick, no plunge, ≥2 falls | `true` | base + 25 | 0 | `SUREFOOTED · FLOOR CLEARED` |
| correct pick otherwise | `true` | base | 0 | `FLOOR CLEARED` |
| wrong pick / forced pick | `false` | 0 | 0 | `THE FLOOR TOOK YOU` |
| timer out | `null` | 0 | −5 | `BURIED WITH THE TILES` |

**Determinism:** schedule = seeded-sim. Plunge detection = input-relay (local hover), relayed as hp requests. Skip logic = secret-host on the seeded order.

**Depth scaling:** `gap` 4.0 s → 2.2 s (linear to depth 10, clamped; diff ladder `clamp(1+floor(depth/6),1,5)` may be used instead if the contract finalizes on it — same curve, coarser steps); crack warning 0.8 → 0.4 s; depth ≥ 6: **double-falls** (two adjacent tiles per beat); depth ≥ 9: floor tilts visually (cosmetic only, hitboxes unchanged).

**Duration:** typical 20–35 s (ends on answer); cap 45 s.

---

## 2 · HUNTER DODGE — solve while it stalks you

**Bind:** `cyber-hunter` (align `bad`, worlds-pop.js). Supersedes the hunter-beam slot-lockdown hook.

**Fantasy:** a chrome hunter patrols the board's edge, sweeping a searchlight cone. Its gaze accumulates on you. The puzzle waits for no one.

**Input model:** cursor-as-body. The beam **tracks your cursor with lag** (pursuer, not wall): beam heading chases cursor angle at finite turn rate, so sharp direction changes shake the lock. Options are clicked normally — every approach line is exposed.

**Mechanic:**
- Exposure meter: beam-cone overlap with cursor fills a **cumulative exposure clock**; leaving the beam drains it at half rate.
- Crossing **2.0 s cumulative**: damage tick `hp −10` (live) + 400 ms control stutter (engine stutter request) + meter flash. Re-crossings every additional full second: `hp −6` each.
- Patrol path: Lissajous curve over the stage; beam origin rides it (seeded-sim).

**Win / lose:**
- **Win** — correct answer; **+40 "ghost" bonus** if peak exposure stayed < 2.0 s (never damaged).
- **Fail** — wrong pick or timeout. Damage ticks already applied live.
- The hunter never ends the stage directly; hp 0 ends the run through the normal engine path.

**StageResult mapping:**

| end | correct | points | hpDelta | summary |
|---|---|---|---|---|
| correct, undamaged | `true` | base + 40 | 0 | `GHOST · UNSEEN, UNSCATHED` |
| correct, damaged | `true` | base | 0 | `HUNTER EVADED` |
| wrong | `false` | 0 | 0 | `MARKED BY THE BEAM` |
| timeout | `null` | 0 | −5 | `IT NEVER BLINKS` |

**Determinism:** path + turn rate = seeded-sim. Beam-vs-cursor overlap = input-relay (your exposure is yours), damage requests host-clamped.

**Depth scaling:** beam turn rate ×(1 + 0.15·min(depth−1, 10)); cone width 24° → 16°; depth ≥ 8: second, slower decoy beam in opposite phase (**cosmetic only — never damages**, rendered at 40% opacity; fairness rail).

**Duration:** typical 25–40 s; cap 45 s.

---

## 3 · LASER STORM — safe-lane timing puzzle

**Bind:** `sky-laser` (align `good` — the takeover reframes the spectacle world from assist to trial). Supersedes the sky-laser one-shot lance hook.

**Fantasy:** orbital lances sweep the answer grid in columns. Telegraph, fire, cool. Cross the lanes between strikes.

**Input model:** pointer/touch; keyboard `1–8` unaffected. Pure movement-timing — no new verbs.

**Mechanic:**
- Grid columns are lanes. Rotating strike schedule: lane glows 0.9 s ahead (telegraph) → 0.4 s full-column beam → cooldown.
- Clicking an option in a **firing** lane: the beam vaporizes your pick — the engine scores it wrong (`forceWrong` semantics preserved inside the takeover runner) + `hp −10`, summary `VAPORIZED MID-THOUGHT`.
- Lane order and period fixed at stage start from `ctx.rng` (seeded-sim).

**Win / lose:**
- **Win** — correct pick in a safe window; **+20 "threaded"** if the winning click landed ≤ 0.5 s before an adjacent-lane strike fired (risk crossing, judged from the seeded schedule — parity-safe by construction).
- **Fail** — wrong pick (vaporized or not) or timeout.

**StageResult mapping** (vaporize hp sting already applied live):

| end | correct | points | hpDelta | summary |
|---|---|---|---|---|
| correct, threaded | `true` | base + 20 | 0 | `THREADED THE STORM` |
| correct | `true` | base | 0 | `STORM RIDE COMPLETE` |
| wrong, vaporized | `false` | 0 | 0 | `VAPORIZED MID-THOUGHT` |
| wrong, safe | `false` | 0 | 0 | `WRONG LANE, SAFE MOMENT` |
| timeout | `null` | 0 | −5 | `THE SKY KEPT FIRING` |

**Determinism:** schedule fully seeded-sim; beam-state at click time derives from the round clock — the host recomputes and confirms every vaporization, so client disagreement is impossible.

**Depth scaling:** period 3.2 s → 1.4 s; telegraph 0.9 → 0.55 s; depth ≥ 5: counter-rotating second sweep (lanes alternate direction); depth ≥ 9: occasional triple-lane salvo (schedule-visible; never more than half the grid firing at once — solvability rail).

**Duration:** typical 15–30 s; cap 45 s.

---

## 4 · DRONE SWARM DODGE — protect the streak

**Bind:** `wasteland-roads` primary; rotate pool `riot` (both align `bad`, registered).

**Fantasy:** scavenger drones dive-bomb the cursor. Your answer streak is a physical thing worth shielding.

**Input model:** cursor-only evasion layered over normal answering — the tension is that answers require cursor presence where drones converge.

**Mechanic:**
- Drones spawn on screen edges on a seeded interval (seeded-sim), home on the **cursor position with steering lag** (turn-rate limited — circling defeats them).
- Hit: `hp −7` (live) **and streak break** through the standard streak pipeline, 0.6 s invulnerability after each hit.
- Survival streak: every 3 consecutive drones dodged banks **+1 streak guard** (max 2 held) into `IQ.Hooks.state` (`droneswarm:guards`). Guards auto-spend next round: first wrong answer while holding a guard does **not** break the streak (guard consumed; hp penalty still applies — guards protect momentum, not flesh).
- Swarm density is independent of the answer; the round timer runs underneath.

**Win / lose:**
- **Win** — correct answer whenever you dare; **+15 per guard banked** (max +30).
- **Fail** — wrong answer (a guard may have absorbed the streak break; the answer is still wrong) or timeout.

**StageResult mapping:**

| end | correct | points | hpDelta | summary |
|---|---|---|---|---|
| correct, 2 guards | `true` | base + 30 | 0 | `SWARM OUTFLOWN ×2 GUARDS` |
| correct, guards held | `true` | base + 15·n | 0 | `SWARM OUTFLOWN` |
| correct, no guards | `true` | base | 0 | `STUNG BUT CORRECT` |
| wrong | `false` | 0 | 0 | `THE SWARM WON` |
| timeout | `null` | 0 | −5 | `DODGED FOREVER, ANSWERED NEVER` |

Guards persist in state across outcomes (they're momentum, not loot).

**Determinism:** textbook seeded-world + input-relay — spawn schedule seeded; homing targets each client's own cursor; guard banking relays integer dodge counts (60 ms-bucket-free, pure counts).

**Depth scaling:** spawn interval 2.2 → 0.9 s; speed ×(1 + 0.1·min(depth−1, 12)); depth ≥ 7: **splitters** (survived drone splits into two slower shards — threat doubling, same hp rules).

**Duration:** typical 20–40 s; cap 45 s.

---

## 5 · SABER CLASH — three taps settle the stake

**Bind:** interlude-stage slot; primary world `wizard-duel` (pack-undead, neutral — duelling arcs already live there); also fires on any world when a curse-pack curse or bonus is **pending resolution**, as the referee stage.

**Fantasy:** a blade duel decides whether the queued curse lands full-force, halves, or shatters — or whether a queued bonus empowers.

**Input model:** one verb — **tap** (Space / click / touch). Three timed taps against closing marker rings. Nothing else.

**Mechanic:**
- A marker sweeps a ring; a **sweet arc** sits somewhere on it (position + speed seeded from `ctx.rng`). Tap inside the arc: HIT. Three rings, escalating speed.
- Motion gate (`IQB_MOTION` off): static bar, zone marked, taps timed against a countdown — judgment identical, no animation.

**Resolution ladder** (rewrites the pending stake):

| hits | correct | stake effect |
|---|---|---|
| 3 | `true` | curse nullified / bonus ×1.5 |
| 2 | `null` (partial) | curse halved / bonus ×1.2 |
| ≤1 | `false` | curse lands full / bonus lost |

The stake arrives from `IQ.Hooks.state` (`saberclash:stake = {kind:'curse'|'bonus', payload}`) written by the originating pack; the saber stage rewrites its magnitude via `saberclash:verdict`.

**StageResult mapping:** `points` 0 and `hpDelta` **always 0** — the duel re-weights a pending effect; it never wounds or pays directly (the rewritten stake pays/punishes later, through its own pack). `summary` per ladder: `DUEL WON · CURSE SHATTERED` / `PARTIAL PARRY` / `DISARMED · CURSE LANDS`.

**Determinism:** arcs/speeds seeded-sim; verdicts quantized-bucket judgments; stake rewrite executes host-side from the verdict enum.

**Depth scaling:** arc width 26% → 14%; marker speed ×(1 + 0.12·min(depth−1, 12)); depth ≥ 6: **feint** — marker reverses once mid-ring (telegraphed by a 150 ms glow, ≤3 Hz compliant).

**Duration:** ~9 s typical (3 rings × ~2.5 s + intro card), hard cap **15 s** — well under the ceiling.

---

## 6 · FRACTAL SOLVE — the pattern lives in the deep zoom

**Bind:** chaotic-align worlds — primary `cave`; rotate pool `bad-trip`, `upside-down` (worlds-mind / pack-horror, both chaotic).

**Fantasy:** the answer geometry is an island of stability inside a slowly zooming Julia-set layer wrapped around the board. Find the still point in the storm.

**Input model:** standard point/click answering (the puzzle itself is a normal generator round), plus one verb: **hold SPACE** (or two-finger touch-hold) to *stabilize* — zoom freezes 1.2 s, costs 3 s of round timer, twice per round max.

**Mechanic:**
- Fractal layer: canvas Julia set whose seed point and zoom-path keyframes come from `ctx.rng` at stage start (seeded-sim). The **true option tile's motif** recurs as a self-similar island on the zoom cycle; decoy islands recur off-phase.
- Reading recurrence — which island repeats *in phase with the puzzle's motif* — identifies the correct option. Solvable by attention alone; stabilize buys reading time.
- Decoy placement drawn exclusively from `ctx.rng` post-answer-encryption — the layer cannot leak `correctIdx` (pre-reveal anti-leak rule).

**Win / lose:** standard round scoring; **+30 "deep reader"** for solving with zero stabilizations.

**StageResult mapping:**

| end | correct | points | hpDelta | summary |
|---|---|---|---|---|
| correct, no stabilize | `true` | base + 30 | 0 | `DEEP READER` |
| correct | `true` | base | 0 | `PATTERN FOUND IN THE DEEP` |
| wrong | `false` | 0 | 0 | `LOST IN THE ZOOM` |
| timeout | `null` | 0 | −5 | `THE FRACTAL CLOSED OVER YOU` |

**Motion gate:** static deep-zoom frame (one keyframe, pattern embedded once); stabilize free and unnecessary; bonus disabled. Same vocabulary otherwise.

**Determinism:** fractal params seeded-sim; rendering view-only; scoring untouched by the layer.

**Depth scaling:** zoom rate ×(1 + 0.08·depth); islands shrink per depth; decoys 2 → 5; depth ≥ 8: lateral drift component joins the zoom path (still fully seeded-sim).

**Duration:** bounded by the round timer; fractal loop caps at 40 s.

---

## 7 · HYPERCUBE 606D — the joke that fights back

**Bind:** `jester-court` (pack-chaos, chaotic) primary; consumes the legacy `dims.js` `'606d'` flag as its trigger — the cosmetic background hypercube graduates into this stage. Supersedes dims cosmetic 606d on trigger.

**Fantasy:** a real 4D tesseract rotates through projected space. Your eight options cling to its eight projected **vertices**. One vertex holds the truth. Good luck.

**Input model:** drag to steer the rotation (changes which vertices overlap on screen), click a vertex-option to answer, one panic verb: **H — hyper-goggles**, once per round, unfolds the tesseract into its flat 8-cube net (readable 2×4 layout) for 5 s, costing 4 s of round timer.

**Mechanic:**
- Vertices project with perspective divide on w (near vertices large/bright, far small/dim). Option labels stay rigidly attached to their vertices through every rotation — **tracking one vertex is always possible**; that's the skill ceiling.
- Rotation: closed-form function of the round clock — constant angular rates on two 4D planes, seeded (pure seeded-sim; identical pixels on every peer).
- The true option occupies a vertex chosen at stage start from `ctx.rng` *after* answer encryption (anti-leak preserved: the stage receives the shuffled option set, never `correctIdx`).

**Win / lose:** standard scoring; **+50 "4D native"** without goggles.

**StageResult mapping:**

| end | correct | points | hpDelta | summary |
|---|---|---|---|---|
| correct, no goggles | `true` | base + 50 | 0 | `4D NATIVE` |
| correct | `true` | base | 0 | `VERTEX FOUND` |
| wrong | `false` | 0 | 0 | `LOST IN THE FOURTH AXIS` |
| timeout | `null` | 0 | −5 | `STILL ROTATING` |

**Fairness rails:** labels never scale below legibility (min font clamp); far-side vertices dim but clickable; motion gate → static wireframe at a fixed disorienting-but-readable angle, goggles free, bonus disabled.

**Depth scaling:** rotation rate ×(1 + 0.07·min(depth−1, 12)); depth ≥ 8: counter-rotating second tesseract behind as occluding wireframe decoys (**cosmetic only** — hit-testing exclusive to the option-bearing front cell).

**Duration:** round timer governs; presentation loop caps at 45 s.

---

## 8 · SEED-PHOENIX RITUAL — plant, grow, burn, reborn

**Bind:** narrative interlude-stage; primary world `heaven` (worlds.js, align good); rotate pool `womb`, `stair-of-heaven` (both worlds-mind.js, good). Offered rounds ≡ 0 (mod 5) in bound worlds.

**Fantasy:** a quiet ceremony between rounds. Choose what to plant, nurse it, watch it burn, collect what rises from ash. The run's economy breathes here.

**Input model:** three beats, three verbs — **pick** (choose 1 of 3 seeds), **hold-and-release** (grow), **watch** (burn — deliberate no-input beat, the pacing signature).

**Mechanic:**
- **PLANT (≤4 s):** choose — `ember` (ambition), `dew` (mending), `thorn` (greed).
- **GROW (6 s):** a breathing circle expands/contracts (~0.25 Hz; motion-gated: static ring + countdown). Hold while it swells, release at peak. Release inside the peak band (±250 ms): full yield. Early/late: ×0.5. Never releasing: ×0.25 and the ritual still completes — failing the ritual is never punished beyond a weak harvest.
- **BURN (4 s, no input):** the seed consumes itself; embers rise (skippable after 1 s — respect for pace).
- **REBORN (≤4 s):** payout reveal.

**Payouts (before grow multiplier):**

| seed | yield |
|---|---|
| ember | `points +40` |
| dew | `hpDelta +12` |
| thorn | gamble (roll from `ctx.rng` at stage start): 60% → `points +90`; 40% → `hpDelta −10` |

Phoenix tiers: every 3rd ritual in a run raises the tier (`IQ.Hooks.state` key `phoenix:tier`); tier multiplies yields ×1.5 at tier 2, ×2 at tier 3 (cap).

**StageResult mapping:** the ritual structurally always completes — `correct: null` would misread it, so it reports **`correct: true`** when the harvest beats its seed's floor (any non-minimal yield) and `false` only on the minimal-yield path:

| end | correct | points | hpDelta | summary |
|---|---|---|---|---|
| full yield | `true` | seed yield ×tier | dew +12 / ember 0 | `REBORN IN FLAME` |
| partial yield | `true` | ×0.5 | per seed | `A WEAK BLOOM` |
| never released | `false` | ×0.25 | per seed (thorn miss possible) | `THE ASH KEEPS ITS SECRET` |

Thorn's failure branch is the only negative (−10 hp, softer than a wrong answer — deliberate: rituals are pacing valleys, not traps).

**Determinism:** thorn roll seeded at stage start; grow judgment one quantized-band verdict on release; tiers integer-counted in shared state.

**Depth scaling:** peak band ±250 ms → ±140 ms; swell rate up; payouts +10%/depth (round-half-down, host-computed); cadence unchanged with depth — the ritual is a metronome, not an escalation.

**Duration:** 18 s hard cap (4+6+4+4).

---

## 9 · HORSEMEN GAUNTLET — four trials, each haunting the next round

**Bind:** arena world `gauntlet-temple` (pack-stones, neutral — the only registered horseman-themed world). **Trigger:** the `horsemen` EVENT in curse-pack.js (currently four staggered banner overlays) is replaced by this stage — the banners become the four wipe transitions. Note: `horsemen` itself is an event id, not a world; the gauntlet binds to `gauntlet-temple` and fires wherever the event rolls.

**Fantasy:** the road opens; four riders pass one by one. Each demands a micro-trial — and each leaves a mark on the puzzle that follows.

**Input model:** four different verbs in sequence — pick, mash, aim-click, freeze. The gauntlet samples every other mode's grammar in 40 seconds.

**Trials (fixed order, ~8 s each incl. wipe):**

| # | rider | trial | input | pass effect on NEXT round | fail effect on NEXT round |
|---|---|---|---|---|---|
| 1 | **Conquest** | Crown claim: 3 crowns slide, pick the blessed one (seeded) | click | `scoreMul 1.3` next round | nothing (crown was lead) |
| 2 | **War** | Tap-frenzy 6 s, hits counted | mash | hits ≥ 8 → `timerDelta +5` | hits < 3 → `timerDelta −5`; 3–7 neutral |
| 3 | **Famine** | Portion split: 8 rations, click the unfairly-large share | aim-click | banks 1 ration → next wrong answer's hp penalty absorbed once | next wrong answer −5 extra hp (once) |
| 4 | **Death** | Stillness 3 s: zero input, cursor frozen | freeze | passed → silence IS the reward (no mark) | flinch (> 8 px move / any input) → `hp −10` on next round entry |

**Aggregation:** ONE StageResult for the whole stage:

```js
{ kind: 'score',
  correct: passes >= 3 ? true : (passes >= 2 ? null : false),
  points: passes === 4 ? 30 : 0,
  hpDelta: 0,                    // Death's mark applies next round, not now
  summary: 'TWO RIDERS PASSED' } // reflects pass count, ≤48 chars
```

Per-trial marks are written to `IQ.Hooks.state` (`gauntlet:{conquest,war,famine,death}`) and consumed by a thin `gauntlet-aftermath` hook on next `onRoundStart` (reads the four keys, emits the corresponding modifier requests, deletes them) — keeping the stage runner ignorant of per-round mechanics, consistent with the hooks architecture.

**Determinism:** crown blessing + ration layout seeded at stage start; war counts and stillness relayed as integers; all next-round effects flow through standard modifier requests, host-applied.

**Motion gates:** War is input-driven (no animation dependency); Conquest/Famine degrade to static layouts; Death needs nothing visual.

**Depth scaling:** War quota 8 → 12 hits; Famine share delta shrinks (obvious → subtle); Death stillness 3 s → 5 s; Conquest crown slide speeds up. Trial order and structure never vary — the ritual of the riders is the identity.

**Duration:** 4 × ~8 s + wipes = **≤ 40 s** (under the 45 s cap).

---

## Appendix A · World-binding index

All bindings reference entities already present in the live registry — zero new world defs required.

| mode | primary world | rotate pool | registry source |
|---|---|---|---|
| Floor-Fall | `volcano` | `wasteland-roads`, `hazard-pit` | worlds.js / worlds-pop.js / pack-realm.js |
| Hunter Dodge | `cyber-hunter` | — | worlds-pop.js |
| Laser Storm | `sky-laser` | — | worlds-pop.js |
| Drone Swarm Dodge | `wasteland-roads` | `riot` | worlds-pop.js / worlds.js |
| Saber Clash | `wizard-duel` (interlude) | any world w/ pending stake | pack-undead.js |
| Fractal Solve | `cave` | `bad-trip`, `upside-down` | worlds.js / worlds-mind.js / pack-horror.js |
| Hypercube 606D | `jester-court` (via dims `606d` flag) | — | pack-chaos.js / dims.js |
| Seed-Phoenix Ritual | `heaven` (interlude) | `womb`, `stair-of-heaven` | worlds.js / worlds-mind.js |
| Horsemen Gauntlet | `gauntlet-temple` | — (triggered by curse-pack `horsemen` event) | pack-stones.js / curse-pack.js |

## Appendix B · Open items for implementers

1. ~~StageResult transport~~ — RESOLVED: canonical `{kind:'score', correct, points, hpDelta, summary}` per `research/mode-contract.md` / StageCore exemplar; cross-round carry goes through `IQ.Hooks.state` prefixed keys (§0.1).
2. **Supersession order:** takeover registrations must outrank `pack-hunters` ancestors by weight; deletion of hook bodies happens only after takeover parity smoke passes (parity rule C8: rounds 1–2 stay baseline).
3. **Saber stake producers:** curse-pack currently resolves curses inline; wiring the pending-stake handoff (`saberclash:stake`) is a small follow-up edit in curse-pack.js — flagged, not designed here.
4. **Horsemen event swap:** curse-pack's `horsemen` theater function becomes the gauntlet trigger; keep the event id and roll odds untouched so balance.md stays valid.
5. **Balance numbers** (bonuses +15..+50, penalties −5..−12) sit inside the balance.md envelope (wrong −30/timeout −15 baseline); BalanceModel owns final tuning.
