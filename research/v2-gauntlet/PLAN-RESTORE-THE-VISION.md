# PLAN — RESTORE THE VISION
### IQ Battle: SHADOW · written 2026-08-26 for the next model

> Owner, after playing the current build:
> *"the game is feeling good but defo a lot less chaotic and fun than the original
> before we built it, but we have a good base now, please ensure from all i
> originally specced and the giant list of ideas, everything is in? feels like so
> much of my vision is missing"*

He is right, and this document says exactly **why**, exactly **what is missing**,
and **what to build in what order**. Read it before touching code.

---

## 0. The one-paragraph answer

The v2 rebuild traded **breadth for rails**. Every load-bearing system is now
correct, deterministic and gate-audited — and that is genuinely worth keeping.
But the rebuild only ported the *systems*, not the *density*. v1 had 89 root
scripts and 25+ "army packs" firing constantly; v2 has **four fate modules
holding 28 text banners between them**. And critically, **the chaos only lives
in takeover rounds** — which are roughly 1 round in 3. The other two-thirds are
puzzle rounds, and a v2 puzzle round is pixel-clean vanilla IQ Battle with, at
best, one line of pink text over it.

The owner's spec says the opposite:

> *"yes it's predominantly like a puzzle game like [IQ Battle] and will mainly
> revert to that **but there'll be alterations of the gameplay**"*

**That is the gap.** The puzzle round — the thing you spend most of the game
inside — never changes. Fix that first and the game will feel like his again.
Everything else in this plan is breadth on top.

---

## 1. Diagnosis, with numbers

Measured against the live tree at commit `8f08d8b`.

| Layer | v1 | v2 today | Verdict |
|---|---|---|---|
| Takeover stages | 26 modes | **25 mounted** | ✅ parity — this part is done |
| Puzzle families | ~14 generators | **12, all solver-audited** | ✅ better than v1 (v1's were partly colour-keyed, banned by DNA) |
| Worlds / backdrops | ~25 registrations | **20** (12 general + 7 hell + sanctuary) | 🟡 short, and none are the *named* settings |
| Fate / event breadth | 25+ army packs | **4 modules, 28 banner strings total** | 🔴 **this is the hole** |
| Round modifiers on PUZZLE rounds | `boardmove.js`, `dims.js`, `chaos.js`, `fun.js`, `horror.js` | **none** | 🔴 **this is the bigger hole** |
| Cameos / characters in scene | `cameo-pack.js` | **none** | 🔴 missing entirely |
| Shared juice bus (shake/glitch/flash/melt) | `chaos.js` | per-scene only | 🔴 no shared API, so events cannot *feel* |

### What actually happens on a v2 puzzle round today

Roll rates, depth ≥ 3, per round: curse 18%, fate 12% (+2.5% nuke), flavor-A
11%, flavor-B ~15%. So **a bit over half of rounds show nothing at all**, and
when something does fire it is **one line of text** — `bannerText` plus, at
most, an invisible `hpDelta` or `scoreMul`. There is no art change, no audio
sting authored per event, no gameplay consequence you can see.

28 events, text-only, on 47% of rounds. That is the entire "chaos" surface.

The spec asks for *"hundreds of variants"* where the theme *"effects not just
what the round looks like but the way the level is in a gameplay"*.

---

## 2. Coverage against the owner's list

Source: `_dave-spec-recovered-wrapped.txt` (MSG 2 / MSG 8, the "giant prompt").
Every named idea, classified against the live tree. **LIVE** = you can see it
in a run. **TEXT** = exists only as a banner string. **MISSING** = not present.

### 2.1 Structure and rules

| Ask | Status |
|---|---|
| Predominantly puzzle, reverting to IQ Battle between chaos | ✅ LIVE |
| Mostly bad/evil, ~1 in 5–6 good round that heals | ✅ LIVE (`arc-data.ts`) |
| Endless, no round limit, play until you die | ✅ LIVE (2000-depth plan = effectively endless) |
| No difficulty setting | ✅ LIVE (ramps off depth only) |
| No grimoire / everything lives inside the round | ✅ LIVE |
| Descend worse and worse, then a good round, repeat | ✅ LIVE (layers 1–7) |
| **Good round CONTINUES the good round from 5 rounds ago** | 🔴 MISSING — arc has redemption threads internally, but nothing on screen ever calls back |
| Negative health in parts of hell/heaven | 🔴 MISSING — hp floors at 0 |
| 7 layers of hell parody | 🟡 PARTIAL — 7 backdrops + banners; no traversal state machine |
| Art style AND music change between good/bad | 🟡 PARTIAL — music yes (`beds.ts`), art only via backdrop |
| MP: see rivals' points, throw things, deplete them, last-man-standing | ✅ LIVE (landed today) |

### 2.2 Gameplay alterations — **the missing pillar**

| Ask | Status |
|---|---|
| 2D pops into 3D, confusing but solvable | 🔴 MISSING (`dims.js` not ported) |
| A 4D one | 🔴 MISSING |
| 606D hypercube joke | ✅ LIVE — as its own takeover |
| Inverted controls | 🔴 MISSING |
| Piano round | 🔴 MISSING |
| Noodles thrown at you | 🔴 MISSING |
| Fractal visual distortion | 🟡 takeover only |
| Board drift / lurch as corruption deepens | 🔴 MISSING (`boardmove.js` not ported) |
| Melting / burning / shaking / screaming escalation in shadow mode | 🟡 PARTIAL — audio ramps; almost no visual |

### 2.3 Named worlds and settings

**LIVE as backdrops (12):** garden, heaven, limbo, lsd-melt *(≈ bad trip)*,
ocean, purgatory, riot *(city riot)*, stars, trench, upside-down, volcano
*(lava)*, womb — plus 7 hell layers and sanctuary.

**MISSING (named in the spec, no world):** jungle, cave *(crystals or the
dragon)*, mountain ascent, basement-with-the-creepy-person, biblical stair to
heaven, abyss/void, black holes, sharks, dolphins, snakes/spiders/ants/rusty
nails, acid rain, Vietnam, country themes (USA / Israel / Iran / China / Russia
/ Germany), WWE arena, symbiote party, doll game, wasteland roads,
cyber-hunter, sky-laser, golden mastermind, beautiful-women round.

### 2.4 Named characters, cameos and pop-culture rounds

| Ask | Status |
|---|---|
| Terminator (bad) | ✅ LIVE — `terminator2` |
| Mad Max (bad) | ✅ LIVE — `fury2` |
| Superman / Independence Day laser | ✅ LIVE — `skyfire2` |
| Squid Game red light / green light | ✅ LIVE — `redlight` |
| Floor falling | ✅ LIVE — `floorfall` |
| Retro: Snake, Tetris, Battleship, Pac-Man, Doom (medkits + ammo) | ✅ LIVE — all five |
| Sniper scope | ✅ LIVE — `sniper2` |
| Slime gun | ✅ LIVE — `slimegallery` |
| Fruit machine / slots | ✅ LIVE — `slots` |
| Four horsemen / curse / pestilence | 🟡 `gauntlet2` + TEXT banners |
| Seed → grows into a plant | ✅ LIVE — `phoenix2` |
| Devils burn it down → phoenix reborn | ✅ LIVE — `phoenix2` |
| Drones / drone swarms | ✅ LIVE — `dronedodge` |
| Lightsabers / Jedi / Sith | ✅ LIVE — `saberclash` |
| Lollipop / sticker / cute rewards | 🟡 TEXT only |
| Nuke → everyone to 1 hp → heaven round | 🟡 TEXT only; the forced-good round is not wired |
| Dolphins (good), sharks (bad) | 🔴 MISSING |
| Dr Evil (neutral, turns bad on a mistake) | 🔴 MISSING |
| Venom / symbiote party | 🔴 MISSING |
| Thanos + Infinity Stones | 🔴 MISSING (`pack-stones` queued) |
| Black Panther, Dr Doom | 🔴 MISSING |
| Hellraiser, Freddy Krueger, Stranger Things, The Ring, xenomorphs | 🔴 MISSING |
| Jesters, pixies, wizards, warlocks, witches, undead skeletons | 🔴 MISSING |
| Angels / God / Jesus / healing | 🔴 MISSING |
| Genie and a lamp | 🔴 MISSING |
| Julius Caesar, wise old man | 🔴 MISSING |
| Sonic rings, Mario coins, DK bananas | 🔴 MISSING |
| AC-130 / Pave Low gunship | 🔴 MISSING (`pack-gunship` queued) |
| Ailments (diabetes, AIDS) costing health | 🔴 MISSING (`pack-ailments` queued) |
| Cyclists in the way, London shouting, Mr Blobby, British humour | 🟡 tone only, in quip pools |
| Miley Cyrus, Britney, Slipknot, Linkin Park, Michael Jackson | 🟡 `popglitter2` + `metal2` are the music rounds; no named cameos |
| WWE events | 🟡 TEXT only |
| Hobbits / Sauron / dragons / ants | 🔴 MISSING |

**Tally: ~24 of the ~90 named ideas are LIVE. ~12 are text-only. ~54 are
missing.** That is the honest answer to *"is everything in?"* — **no, roughly a
quarter of it is.**

One item is deliberately excluded: MSG 17's request to generate sexualised
imagery of the women characters. The *level theme* is in scope as art
direction; producing that imagery is not something I'll do, so plan the round
without it.

---

## 3. The plan

Ordered by **felt impact per unit of work**, not by list order. Phase 1 is worth
more than phases 3–7 combined, because it changes the rounds you actually spend
your time in.

### P1 — Round modifiers on PUZZLE rounds ★ the big one

**Goal:** a puzzle round is never plain twice in a row once the descent starts.

Build `src/rounds/modifiers.ts`: a registry of modifiers that mutate a *puzzle*
round without breaking it. Main rolls 1–3 per depth, scaling with layer/depth,
deterministic from the run seed.

Shape (mirrors the fate modules, which already work well):

```ts
export interface RoundModifier {
  id: string;
  /** Where it may fire. */
  when(ctx: ModCtx): boolean;
  /** Mutate the live scene. MUST return a teardown. */
  apply(ctx: ModCtx, scene: Container): () => void;
  /** One short line for the banner row. */
  banner?: string;
}
```

First 40, drawn straight from the spec:

- **Perspective:** 2D→3D tilt, 4D shear, mirror-flip, rotate-90 board,
  fish-eye, split-screen double vision.
- **Motion:** board drift, lurch on wrong answer, slow breathing scale, tile
  jitter, options orbit slowly, board sinks as the timer drains.
- **Input:** inverted controls, mirrored controls, sticky pointer, one-shot
  lock (first click commits), option shuffle mid-round, keys remapped.
- **Occlusion:** fog bank, ink splatter that wipes, tendrils across the board,
  a cameo silhouette walking in front, acid-rain streaks, TV scanline roll.
- **Theme skins:** piano keys as option tiles, casino felt, jungle vines, cave
  crystal frame, hospital chart, Vietnam grain, riot barricade.
- **Comedy:** noodles thrown across the board, Mr Blobby cameo, a cyclist
  crossing, jester juggling the options, confetti burst on a streak.

**Hard rails (non-negotiable, these are what keep it fun rather than broken):**

1. **Never unsolvable.** A modifier may obscure, move or restyle — never change
   which option is correct, and never fully hide the board. Gate: for every
   modifier × 200 seeds, the correct option must remain hittable and at least
   60% visible at some point during the round.
2. **Deterministic.** Seeded from `(runSeed, depth)`; no `Math.random`.
3. **Motion-gated.** Every modifier needs a static variant under `IQB_MOTION=0`
   / `prefers-reduced-motion`, with identical rules.
4. **Teardown-complete.** `apply()` returns a stop; the frame-loop audit must
   show zero leaked tickers after 200 depths.
5. **Legible.** If a modifier changes the *controls*, it must say so on the
   banner row — the same lesson as the goal cards.

**Gate:** `src/rounds/selftest-modifiers.ts` — every modifier, 200 seeds:
solvable, deterministic, static variant exists, teardown clean.

### P2 — The chaos juice bus

Build `src/fx/chaos.ts`: the shared, budgeted, motion-gated API that P1, the
fate layer and the takeovers all call. v1 had this (`chaos.js`); v2 lost it,
which is why nothing *feels* like anything.

```ts
chaos.shake(intensity, ms) · chaos.glitch(ms) · chaos.flash(color, ms)
chaos.melt(amount) · chaos.invert(ms) · chaos.embers(n) · chaos.scanlines(on)
chaos.intensity(0..1)   // global corruption dial the arc drives
```

Rails: flashes ≤200 ms and ≤3 Hz (a11y, already a project rail — do not weaken
it), one global intensity dial driven by `plan.layer`, everything a no-op under
the motion gate. **Gate:** flash-rate and shake-budget assertions, plus a leak
probe.

### P3 — Cameos and characters in the scene

Port the `cameo-pack.js` mechanic: seeded parody **silhouettes** that appear
inside rounds, themed to the world and the fate event. This is the owner's
*"different avatars and icons and characters which are present in these
scenes"* — currently zero.

Silhouette-only, parody, DNA-primitive construction (no scraped art, no
licensed likenesses). Roster from §2.4's missing list.

**Gate:** budgeted (≤N per round), never overlaps the board's answer area,
deterministic, torn down with the scene.

### P4 — Event breadth: 28 → ~200

Grow the fate layer along the queued packs the ledger already names: ailments,
cavern, jester court, density-a, funny (dread tracker + flashback), gunship,
undead ×4, nam, stones + temple, popcult A/B, void-extra, plus full rounds for
wwe / horror / brit / countries beyond today's micro-events.

**The rule that makes this worth doing:** every new event must ship as
`banner + a chaos-bus call + an optional rider`. A text-only event does not
count as done — that is precisely what made the current 28 feel like nothing.

Also finish the two half-events already in the tree: the **nuke** must actually
force the next round good, and **lollipop/sticker** must be visible objects.

### P5 — Worlds: 20 → ~34

Add the named settings from §2.3. Same pure `f(t)` procedural contract as
`backdrops.ts`; register in `worlds/registry.ts`; extend `worlds/selftest.ts`
(it already asserts deterministic pick + idempotent teardown, so this is cheap).

### P6 — Continuity, and the payoff the arc never delivers

1. **Redemption callback.** The good round must visibly continue the good round
   from ~5 depths ago — same world, same character, one line that references
   what happened last time. The arc planner already threads this internally;
   nothing surfaces it. This is the single strongest "someone designed this"
   signal in the whole spec, and it is currently invisible.
2. **Hell traversal state machine** — layers 1→7 as a campaign, not just a skin.
3. **Negative HP zones** in the deepest layers / heaven, per spec.
4. **Nuke → forced heaven round.**

### P7 — Remaining stages

`lanternguard` is the only never-started v1 mode left. From the spec, still
unbuilt as stages: Sonic rings, Mario coins, DK bananas, genie/lamp, piano
round, Thanos gauntlet (today's `gauntlet2` is the horsemen), Vietnam, gunship
(AC-130), dolphins, sharks, Dr Evil.

Follow `TAKEOVER2-MECHANICS.md` and the existing scene contract: seeded, pure
`selfTest()`, `StageResult` exactly once, escapable with Esc, self-resolving
inside `ctx.timerLen`. **And add the stage id to `onboard.TAKEOVER_STAGE_IDS`
with a goal card** — the selftest now fails if you don't.

---

## 4. Rails you must not break

These are why the base is worth building on. Breaking one to ship faster will
cost more than it saves.

- **DNA is law.** `v2/DNA.md` is ground truth for puzzles: one hue per board,
  primitive marks only, no colour-rotation rules, hole bottom-right, 8 distinct
  single-attribute options. A gate failure is a defect in the game, never in
  the gate.
- **Determinism.** Own `mulberry32(seed^salt)` in fixed draw order. Zero
  `Math.random` / `Date.now` in gameplay paths. This is what lets multiplayer
  work at all.
- **Host authority.** A client's `sr` frame is a *claim*, never a score — the
  host re-derives puzzle points from `lms.pointsFor(diff, streak, mul)`. One
  scoring formula, shared by the solo path and the host. Do not add a second.
- **Fairness / a11y.** Flashes ≤200 ms and ≤3 Hz, text ≥11 px, overlays
  escapable, every motion effect has a static variant.
- **Ordering contracts.** `onboard.TAKEOVER_STAGE_IDS` ↔ `main.TAKEOVERS`, and
  `roundPlan`'s pick formulas ↔ `main.dealPuzzle`/`dealTakeover`. Both are
  selftest-enforced. They exist because both have already drifted once.
- **Every module ships a pure `selfTest()`.** No Pixi, no DOM, no timers inside
  it. That culture is why the rebuild is trustworthy — keep it.

---

## 5. Working style the owner has asked for repeatedly

He has asked, in his words, for *"a whole swarm of teams, and teams of swarms
… 20-40 agents at least across many hours to work in parallel"*. Phases P1, P4,
P5 and P7 are embarrassingly parallel — one agent per modifier, per pack, per
world, per stage, each with its own file and its own selftest. **Exclusive file
ownership per agent** is what makes that safe: every one of these lands as a
new module plus a registry line.

Two things he has pushed back on hard, twice each, and will again:

- **Do not bolt more onto the surface and call it a rework.**
- **Do not report done until it is actually in the live rotation.** "Ported but
  unwired" reads as missing, because it is.

---

## 6. State of the tree, right now

Branch `lms-wiring-and-elimination`, two commits ahead of `main`:

- `e9b265b` — LMS wired end to end; elimination made reachable; 7 defects fixed.
- `8f08d8b` — seeded puzzle pool; goal cards on all 25 chaos rounds; overlay
  layering.

All gates green: tsc clean · 1800/1800 solver audit · soak 1000 puzzles + 26
takeover self-tests · 14 selftest suites · LMS reducer + 60-match convergence
sweep · `vite build` clean. Verified live in two browser tabs.

To put it on main:

```
cd C:\Users\david\Desktop\stuff\iqbattle
git checkout main && git merge lms-wiring-and-elimination
```

### Run it

```
cd C:\Users\david\Desktop\stuff\iqbattle\v2
node node_modules/vite/bin/vite.js --port 8792 --strictPort --host 0.0.0.0
```

`npm` is broken on this machine ("not a valid Win32 application") — call the
binaries through `node` directly, and `node --experimental-strip-types` for any
`.ts` selftest.

### Gate order

```
node node_modules/typescript/bin/tsc --noEmit
node --experimental-strip-types src/puzzles/audit2.ts
node --experimental-strip-types ../research/v2-gauntlet/soak.ts
node --experimental-strip-types src/scenes/selftest-lms.ts      # MP convergence
node --experimental-strip-types src/net/selftest.ts             # transport + pool
node --experimental-strip-types src/meta/selftest-onboard.ts    # goal-card coverage
# ...plus the other suites listed in v2/README-V2.md
node node_modules/vite/bin/vite.js build
```

### Driving the browser (gate G4 is scriptable now)

`vite dev` installs `window.__QA` (`v2/src/qa.ts`, stripped from production):
`texts()`, `sees(str)`, `click(logicalX, logicalY)` in 1600×900 stage space,
`clickLabel('opt3')`, `type()`, `state()`, `hit(x, y)`.

**Read this or you will lose an hour:** a tab that is not compositing (hidden
pane, headless, background tab) never runs Pixi's ticker, so world transforms
are stale and `renderer.events.rootBoundary.rootTarget` is null — every hit
test misses and every synthetic click is swallowed *silently*. Call
`app.render()` once before driving and after any layout change. A background
tab also reports a 0×0 viewport, so emulate a size and dispatch `resize` first.

---

## 7. Known open defects and gaps

- **Chaos rounds show no ladder and take no attacks in multiplayer** — the
  takeover scene owns the whole stage. Defensible as design; it is a choice,
  not an oversight. Revisit if MP chaos rounds feel dead.
- **Client HP during a chaos round** is authoritative only at the next reveal.
- **`v2/dist` black-screened once** historically when served from the root Bun
  server; the Vite dev server is the reliable play path.
- Everything in §2 marked 🔴 or 🟡.

---

## 8. If you only do one thing

Do **P1**. Two-thirds of the rounds in this game are puzzle rounds, and right
now every one of them is clean, correct, and exactly the same as the last.
The owner's whole spec is about what happens *to* those rounds. Give the puzzle
round forty ways to go wrong — while never once making it unsolvable — and the
game becomes his again.
