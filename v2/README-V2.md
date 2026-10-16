# IQ BATTLE: SHADOW — v2 Player + Dev Cheat Sheet

Vite + TypeScript + PixiJS v8 rebuild of the original site with the corruption arc layered on top.
Fixed 1600×900 logical stage, letterboxed to any viewport. Ground truth for the puzzle engine:
`v2/DNA.md`. The old v1 build stays frozen at repo root (`modes/*.js` — read-only reference).

The public root is a version picker: **Current** retains the 4 September release;
**New / experimental** uses this October candidate. See [release instructions](../README.md#deploy-to-github-pages).
Publishing the candidate does not establish whole-game or cross-network acceptance.

---

## Run it

Use platform-native dependencies in an owned checkout; never reuse another OS's
`node_modules`, and never rebuild a protected historical `v2/dist`.

From `v2`, `npm ci && npm run dev` serves development at `http://127.0.0.1:8792/`.
`npm run build` typechecks and builds the candidate for `/iqbattle-shadow-edition/new/`,
then runs release guard regressions and assembles the two-version site under
`runtime/omarchy/build/site` at the repository root. Local assembly never writes `v2/dist`;
that path is staged only in a fresh GitHub Actions checkout for the existing publisher.
`npm run preview` previews only the newer build, at `/iqbattle-shadow-edition/new/`.
The root Bun server is historical; it is not the dual-version site entry.

---

## How a run plays

Landing → **CREATE ROOM** (name + optional room name) → Lobby (round timer 1–120 s, default 60,
5-char room code) → START → depths descend one round at a time until HP hits 0 or the arc plan is
exhausted. End screen: score, depth, DESCEND AGAIN / BACK TO LANDING.

Each depth deals either a **puzzle round** (the IQ Battle core) or a **takeover round** (chaos
stage). Rules of the deal (`main.ts`):

- **Puzzles**: difficulty ramps `min(5, 1 + floor(depth/6))`; correct answer pays
  `pointsFor(diff, streak, mul)` = `(100·diff + 40 + 20·(streak−1)) × mul`; wrong costs 40 pts
  + 12 hp; timeout costs 12 hp. `mul` is 1 unless a fate roll says otherwise (midas 1.5×, a
  curse can halve it; clamped to 0.25–3). **Multipliers apply solo only** — `maybeCurse` rolls
  partly off your own hp, so a personal event must never move a shared ladder.
- Depths 1–3 use curated, clean accretion/count/rotation puzzles. First encounters with supported
  families show a legend before answering; the answer-reveal juice is `fx/reveal.ts`.
- **Takeovers** fire only on hostile rounds, from depth 4, never closer than 3 depths apart,
  ~42 % of eligible depths. A goal card (title + controls) shows at stage entry; every takeover
  is escapable — **Esc bails with a neutral result**.
- Every 4th depth an **EMERALD interlude** offers one of three relic cards (seeded).
- Answer reveal juice, streak flames and combo text come from `fx/reveal.ts`.

### Puzzle round controls

Click/tap the option tile you think completes the board (options are labelled 1–8). That's all —
the rule sentence is revealed only after answering ("the board teaches the rule").

---

## Takeover stages

The live rotation contains 35 stage slots: the previous 32 plus TOKEN RUN, SIX STONES and
GUNSHIP PASS. `main.ts` `TAKEOVERS` and `meta/onboard.ts` are the mounted roster and goal-card
sources; the old “ported, awaiting rotation” distinction no longer applies.

| New stage | File | Goal | Controls |
|-----------|------|------|----------|
| TOKEN RUN | `collectibles.ts` | Follow the posted token order through three lanes; avoid gaps | Arrows / WASD / click lane / keys 1–3; Esc neutral |
| SIX STONES | `stonetrial.ts` | Watch six primitive stones, then recall their order | Click stones / keys 1–6; Esc neutral |
| GUNSHIP PASS | `gunshipevasion.ts` | Read each telegraphed searchlight lane and move to shelter | Left/right / A/D / click shelter / keys 1–3; Esc neutral |

These use the existing `TakeoverCtx`/`StageResult` contract, seeded state, ticker deadlines and
one settlement. Browser smoke exercised token success/failure, stone success, neutral exits,
and gunship loss; full mounted-game balance and gunship success remain acceptance work.

---

## Puzzle families (14, all DNA-real)

One hue per board from the `T.boardHues` wheel (gold, orange, crimson, sky, violet, mint) — color
never varies within a board; glyphs are primitive marks only (triangles, dots, diamonds, lines,
via `glyphs.ts`). Hole is always bottom-right; 8 pairwise-distinct options; every family ships an
independent solver that re-derives the answer from visible data.

| Core family | Legend |
|--------|----------------------------------------------------------------------|
| count-grid | Columns double the count; each row starts a step higher |
| accretion | Each step adds one structure: diagonal, then corners, then edge dots |
| rotation-composite | The dot ring spins 90° each step while one more dot joins |
| position-orbit | The dot steps a fixed angle per column; its orbit widens per row |
| missing-section | Section counts grow across and down; mark kind cycles reading-order |
| dot-matrix-rotate | The dot arc turns 90° per column and gains one dot per row |
| line-reflection | The right column mirrors the left horizontally; the bottom row mirrors the top |
| count-positions | The mark count never changes; occupied spots advance one step per column |
| size-ladder | The triangle climbs one size rung per column and turns 90° per row |

Additional mounted families: `arrow-chain`, `dot-balance`, `ring-nest`, `dual-axis`, `mirror-mend`.
Sources: `puzzles/families.ts` through `families5.ts`; shapes in `puzzles/types.ts`.
The repaired ring-nest generator was checked through difficulty 12 against solver, bounds
and the DNA maximum of 24 marks; see the current handoff for exact evidence.

---

## Corruption arc · sanctuary · hell layers

`arc-data.ts` plans the whole descent deterministically from the run seed:

- Blocks of **4–6 hostile rounds** (bad, ~1-in-8 chaotic) closed by exactly **1 good round** —
  long-run ≈5:1 hostile:good. Rare neutral "limbo" round may precede the closer.
- **Acts 0–3** (SURFACE → DESCENT → INFERNO → ABYSS) tint bg/panel/tile chrome as depth grows;
  accents stay cold-blue until the descent turns crimson.
- **Layers 1–7** track consecutive hostile rounds: a deepening crimson vignette plus a whispered
  banner ("something followed you down" → "nothing above us now").
- **Sanctuary**: on every good round the entire chrome reverts to faithful original-site
  tokens (`SANCTUARY_TOKENS`, "the light remembers you") and banishes the Shadow presence. The
  good closer inherits the closed block's depth as its layer — heaven ascends out of the arc it
  closes.

`scenes/arc.ts` applies/reverts tokens; `worlds/backdrops.ts` swaps the animated backdrop per
alignment; audio follows (`beds.ts` alignment beds + dread layer, `director.ts` act-reactive bus).

## Shadow persona

`shadow/shadow.ts` — budgeted speech bubble (British-menacing-witty deadpan, ≤90 chars/line, 8 s
throttle, priority preemption) driven by a deterministic pure brain. `shadow/large.ts` — LARGE
channel for major beats (layer crossings, sanctuary arrivals, impossible rounds, death), corner
eyes watching from act 2+, suppressed while sanctuary holds. Lines live in `shadow/pools.ts`.

## Audio

All procedural WebAudio, zero assets (`audio/`): `audio.ts` core (lazy context on first gesture,
mute gate `IQB_MUTED`, master cap 0.15), `beds.ts` four alignment beds + layer drone + stings,
`director.ts` act-reactive corruption bus, glitch cascades, win/lose jingles, low-hp heartbeat,
`sfx2.ts` identity one-shots + ember crackle loop. Ambient LFOs/flashes gate behind motion.

## Fate, curses, emeralds

- `fate/fate.ts` — per-round rolls: blessings (LOLLIPOP/STICKER) on good rounds; hostile rounds
  can roll MIDAS, ECLIPSE, TOLL, CARNIVAL, COMET, POLTERGEIST, or (depth ≥ 8) a NUKE forcing the
  next round good.
- `fate/cursepack.ts` — hostile-round curse window (~18 %) vs 25 % blessing window.
- `fate/flavor-a.ts` / `flavor-b.ts` — theatre-only entrance/tape and micro-event windows.
- Emerald relics (`scenes/interlude.ts`, offered every 4th depth): CHAOS CONTROL (bank an
  impossible round +150), CRIMSON VEIL (impossible rounds pay +40), DOOM BLOOM (correct ×1.3),
  GRAVITY GREED (steal 60 pts from the leader), FINAL CHAOS (every 10th depth ×2 / bomb halves),
  BLACK ARROW (one free skip).

## Worlds

12 procedural canvas backdrops keyed by alignment (`worlds/backdrops.ts` + `registry.ts`):
bad — volcano · riot · trench; chaotic — lsd-melt · upside-down; neutral — limbo · purgatory;
good — heaven · womb · ocean · garden · stars. Pure f(t), hash-seeded, motion-gated to a static
frame; ambience only — never touches glyphs or scoring.

---

## Multiplayer how-to

1. Host: landing **CREATE ROOM** → lobby shows `<room> · <CODE>`; share the 5-char code. Set the
   round timer (1–120 s), press START.
2. Joiner: enter name + code on the landing JOIN path.
3. Transport (`net/net2.ts`): PeerJS (script-loaded from unpkg when online) with a
   BroadcastChannel + localStorage-ring fallback for same-machine/offline play; sequence
   watermarks collapse cross-transport copies exactly once (they do not reorder delivery).
4. Protocol (`scenes/mp.ts`): host ships `begin{timer,lms,rn,sd}` — clients regenerate the
   IDENTICAL arc locally from the run seed. Each depth, `roundPlan()` mirrors the local pick
   formulas exactly, so clients mount the same family/stage at the same seed; puzzle payloads
   never cross the wire (answers can't leak by construction). Clients return integer verdicts
   `{sr{correct,points,hpDelta}}`; the host clamps them (points [−200,500], hp [−60,60],
   anti-spoof ceiling `100·diff+40`) before folding into the authoritative reveal.
5. LMS + attacks — **live and wired** (`scenes/mpfeat.ts` rules → `scenes/lms.ts` reducer →
   `scenes/lmsdirector.ts` sequencing → `main.ts` effects). See the section below.

### Catch-up and connection-loss contract

- A PeerJS connection closing or failing is loss of **one pipe**, not evidence that the host
  or guest left. Explicit goodbye frames retire seats immediately; otherwise the shared
  presence lease decides whether both paths have gone silent.
- Room-name requests fetch metadata only. `wireMain()` requests the atomic match snapshot
  **after** attaching the gameplay consumer, including when `MPJoin.start()` awaited lazy UI
  imports. An early live frame does not replace the full LMS ledger. Each targeted snapshot
  carries `_captureSq`, the existing host **broadcast** epoch/sequence at capture (not the
  recipient-specific unicast sequence, and not a wall-clock timestamp). The session brings
  its ledger forward with newer received round/score/reveal/elimination/end/departure events
  using the existing LMS reducers, without replaying their UI/scoring effects or `sr` claims.
  Already-mounted rounds retain their clock and do not remount; duplicate bootstraps are ignored.
  Frames at or before the installed capture are covered by its ledger and cannot roll it back.
  The pre-bootstrap journal is capped at 512 events and released on installation/leave. If a
  delayed capture predates discarded events, or a newer table lacks its round, the client asks
  for a fresh complete capture instead of installing partial state.
- Snapshot response clocks retain fractional seconds (for example `12.345`); they are not
  integer-rounded. `lmsdirector.ts` takes the minimum of captured and explicitly known local
  same-depth attack budgets, so a spent `0` cannot refill. An absent cold-consumer budget is
  not known spent authority; cold and genuinely newer-depth captures restore a legitimate `1`.
- Client reveal handling increments `run.depth` immediately, while the mounted board waits
  for the actual host next-round frame. Browser QA must use the mounted `DEPTH` label and
  real round-wire authority, not treat `__QA.state().depth` as the current board depth.
- `src/net/selftest.ts` retains manual delivery-order regressions for active, closed and ended
  joins, an OPEN snapshot delivered after a newer same-depth reveal, newer elimination/end
  authority, a bounded-journal recapture, a failed RTC upgrade after a successful bus join,
  duplicated snapshots, a surviving bus after RTC closure, and presence teardown. It uses real
  `createNet`, `MpSession` and `createDirector` consumers. Run from `v2` with
  `node --experimental-strip-types src/net/selftest.ts`.

The earlier October Windows transport checks covered complete active/closed/ended
catch-up, delayed snapshots, fractional clocks and spent attack budgets through actual
Main consumers. Those bounded historical receipts are not whole-game or WAN proof.

The dual-release Linux verification reran transport/session, ICE, LMS and lobby checks
and the strict TypeScript/Vite production build (831 modules). Owned-browser smoke
exercised both chooser links, both create-room/start paths, a correct candidate answer
awarding 140 points, and returning to the chooser. Desktop and narrow chooser pixels
were inspected. Retained release hashes and same-size corruption rejection were checked.
No whole-game, WAN/TURN, long-soak, hardware-GPU or heard-audio acceptance is implied.


### Last Man Standing (the MP match layer)

Every multiplayer room is an LMS match. The three modules split by testability:

| Module | Owns | Runs in node |
|---|---|---|
| `scenes/mpfeat.ts` | Pure rules: weapon curves, elimination verdict, rank deltas | yes |
| `scenes/lms.ts` | The match state reducer (every call returns a NEW state) | yes |
| `scenes/lmsdirector.ts` | Sequencing: who folds what, when a depth closes | yes |
| `main.ts` | Effects only: Pixi scenes, toasts, timers, advance | no |

- **Host authority.** A client's `sr` frame carries a CLAIM, not a score. On puzzle depths the
  host recomputes the points itself from (difficulty, the streak it tracks for that seat, midas)
  using the same `pointsFor()` the solo path uses, so a tampered client can at most lie about
  whether it was right. Only takeover depths adopt a reported delta, under `clampSr` plus a
  takeover ceiling. Duplicate `sr` frames for one depth are dropped host-side — the answer lock
  is enforced on the wire, not just in the scene.
- **Depth close.** A depth ends when every ALIVE seat has answered, or when the host's clock
  expires (the silent seats eat the wrong-answer bite). The host then broadcasts
  `reveal{n,answer,scores,hp}` — the only frame that advances a client — runs the elimination
  sweep, and broadcasts `elim{uids}` / `end{scores}` as needed.
- **Attacks.** Click a rival's sidebar card to open the weapon menu (`scenes/attackmenu.ts`).
  Depth-scaled off the v1 balance curves: rotten `cost 60+15d / dmg 60+20d`, curse
  `cost 100+25d / dmg 100+30d / −10 hp`. One attack per seat per depth. Depths 1–2 are
  parity-guarded — no card is even clickable. A landed attack rides its own `scores{n,scores,hp}`
  frame, never a reveal, so a tomato can never make everyone skip a round.
- **Elimination: HP is the life bar, score is ammunition.** A seat is out when its HP hits 0 —
  score never kills. (v1 shipped "score floor AND hp death", which existed only because every
  seat *starts* on 0 points; the side effect was that elimination was practically unreachable —
  measured at 6 eliminations and **zero completed matches** across 60 simulated matches. Naive
  `'or'` is worse: it wipes the table on the first sweep. So the score floor is out of the death
  test entirely — see `ELIMINATION_RULE` in `lms.ts`.) The dead spectate: greyed card, no
  answering, no attacking, no targets. Rage quit marks the seat `left`; the door slams and the
  match continues. The match ends when one seat remains, and a one-seat room is never "won" —
  solo hosts keep descending under the solo HP rule.
- **The bite deepens.** A wrong answer or a timeout costs `12 + 4·(diff−1)` HP: −12 through
  depth 5 (unchanged from v1), then −16, −20, −24, −28 as the difficulty ramp climbs. The
  sanctuary heal stays +20, so a reprieve is worth relatively less the deeper you are. Simulated
  pacing under adversarial play: matches end between depth **10 and 24, median 15**.
- **The ladder** is the sidebar: rank order with ▲/▼ swing glyphs since the last reveal, a health
  rail *and exact HP numeral* per seat (it is the life bar, so it has to be both glanceable and
  exact), response clocks, and OUT/LEFT tags. The attack menu shows the target's HP too, and
  flags `ONE PUSH FROM THE DARK` at 25 or below. The end screen replaces the solo summary
  with the full finishing order and each seat's fate.
- **Known gap:** chaos rounds show no ladder and take no attacks — the takeover scene owns the
  whole stage. Attacks resume on the next puzzle depth.

## End screen

`scenes/end.ts`: MATCH TERMINATED headline, per-round review strip with verdict chips, ranked
scoreboard (competition ranking, ties share), and accolade chips computed by
`meta/accolades.ts` (v1 parity — King of the Hill, Not of this Earth, …; ties share).

---

## Architecture map

```
v2/src/
main.ts                 App shell: Pixi init, landing→lobby→run flow, depth dealing, MP wiring
theme.ts                Design tokens (T), boardHues wheel, 1600×900 STAGE_W/H
glyphs.ts               Primitive glyph marks (tri/dot/diamond/line) painted to canvas textures
arc-data.ts             Deterministic arc planner + act/sanctuary/layer token sets
scenes/
  landing.ts            Faithful landing page (hero, feature cards, create/join)
  lobby.ts              Room screen: title+code, player cards, timer input, START/LEAVE
  game.ts               Puzzle play surface: board panel, 4×2 options, sidebar; panel/text helpers
  shell.ts              Shared chrome: header bar, status strip, gradient timer, toasts, widgets
  arc.ts                Applies arc plans / sanctuary chrome, layer whisper banners
  interlude.ts          EMERALD relic picks every 4th depth (frozen relic table)
  end.ts                End screen: review strip, scoreboard, accolade chips
  mp.ts                 MP wire: session, frame sanitizers, lobby/begin/round/sr/reveal/scores/elim
  mpfeat.ts             Pure LMS/attack game rules + UI specs (standings, attack menu, rage quit)
  lms.ts                LMS match-state reducer (pure; every call returns a new state)
  lmsdirector.ts        LMS sequencing behind injected effects (host authority, depth close)
  attackmenu.ts         Weapon-pick overlay (escapable, priced per depth)
  takeovers/            One file per chaos stage; redlight.ts owns the shared TakeoverCtx contract
fx/reveal.ts            Answer-reveal juice (wash/shake/combo/embers), motion-gated
audio/                  audio.ts core · beds.ts alignment music · director.ts act bus · sfx2.ts
shadow/                 shadow.ts persona bubble · large.ts LARGE channel · pools.ts quip pools
fate/                   fate.ts rolls · cursepack.ts curses · flavor-a/b.ts theatre events
worlds/                 registry.ts + backdrops.ts — 12 procedural alignment backdrops
meta/                   onboard.ts goal cards + family legends · accolades.ts end-screen awards
net/net2.ts             Dual-transport MP core (PeerJS + BroadcastChannel/localStorage fallback)
puzzles/                types.ts Family/Puzzle contracts · families{,2,3}.ts generators+solvers ·
                        audit2.ts gauntlet gate
qa.ts                   Dev-build-only browser-driver hooks (window.__QA) — stripped by vite build
```

Scene flow: Boot → Landing → Lobby → Game (puzzle | takeover, with Interlude every 4th depth)
→ End.

---

## Determinism + fairness rails

- **One PRNG**: mulberry32 (defined in `takeovers/redlight.ts`, mirrored node-safe in
  `audio/audio.ts`). Zero `Math.random`/`Date.now` in gameplay — clocks are injected or Pixi
  ticker deltas; solo run seeds draw entropy once at `startRun`.
- **Motion gate**: `IQB_MOTION` (localStorage `'0'`, global `'0'`) or `prefers-reduced-motion`
  switches every scene to a static variant with identical rules.
- Flashes ≤200 ms and ≤3 Hz, damage feedback localized, overlays always escapable (Esc ⇒ neutral
  result), all text ≥11 px.
- `StageResult` settles exactly once per takeover (`onceResolve`); scenes self-resolve within
  `ctx.timerLen`.
- Parody ids/personas only; one hue per board; glyphs are never recolored mid-round.

## Gauntlet harness

```sh
# solver audit — every family × 30 seeds × diff 1..5, hue/hole/options/solver asserted
node src/puzzles/audit2.ts                     # prints PASS per family; non-zero exit on failure

# scene/system self-tests (each exits non-zero on failure)
node --experimental-strip-types src/scenes/takeovers/selftest.ts            # RED LIGHT/TIDE POOL/SERPENT
node --experimental-strip-types src/scenes/takeovers/selftest-portb.ts      # SABER CLASH/ONE-ARMED GOD/SLIME GALLERY/THE WELL
node --experimental-strip-types src/scenes/takeovers/selftest-retro2.ts     # GLUTTON/WELL II/SALVOS/CORRIDOR
node --experimental-strip-types src/scenes/takeovers/selftest-takeover2.ts  # PHOENIX/HORSEMEN/FRACTAL/HYPERCUBE/LONG QUIET
node --experimental-strip-types src/scenes/takeovers/selftest-rhythm.ts     # CHART TOPPER/FORGE SET
node --experimental-strip-types src/meta/selftest-onboard.ts                # goal cards + legends
node --experimental-strip-types src/audio/selftest-audio.ts                 # audio core
node --experimental-strip-types src/audio/selftest-director.ts              # act director
node --experimental-strip-types src/shadow/large.ts                         # LARGE channel
node src/worlds/selftest.ts                                                 # 12 backdrops
node src/net/selftest.ts                                                    # MP transports end-to-end
node --experimental-strip-types src/scenes/lms.ts                           # LMS reducer
node --experimental-strip-types src/scenes/mpfeat.ts                        # LMS pure rules
node --experimental-strip-types src/scenes/selftest-lms.ts                  # FULL 3-seat match, real MpSession + director
```

`selftest-lms.ts` is the one that matters for multiplayer: it plays a whole LMS match through the
real `MpSession` over a loopback wire and asserts, after every depth, that all three screens'
tables are byte-identical to the host's. Desync is the bug class that made v1 matches
unarguable, so it is checked as a property, not by eye.

### Driving the browser (gate G4)

`vite dev` installs `window.__QA` (see `src/qa.ts`; absent from `vite build` output):

```js
__QA.texts()            // every string currently on the stage
__QA.sees('PLAYERS 2')  // substring probe
__QA.click(800, 621)    // click a LOGICAL 1600x900 coordinate (letterbox maths included)
__QA.clickLabel('opt3') // click a labelled node (option tiles are opt0..opt7)
__QA.type('DAVE')       // keystrokes into the focused text input
__QA.state()            // depth / score / hp / role / LMS table / phases / winner
__QA.hit(x, y)          // what Pixi believes is under a logical point
```

Two tabs on the same origin share the BroadcastChannel bus, so a full host+join match can be
driven end to end from the console. If a tab is not compositing (hidden pane, headless), call
`app.render()` once before hit-testing — Pixi's world transforms and event root are only
established by a render.

Individual scenes also carry their own smoke entries
(`node --experimental-strip-types src/scenes/takeovers/<scene>.ts`). Self-tests probe hundreds of
seeds each (e.g. RED LIGHT's cadence check asserts ≥10 distinct schedules across 300 seeds) so
seed-blindness and determinism regressions fail loudly. Layout-vs-DNA visual diffs stay manual:
launch the dev server and eyeball against `DNA.md`'s layout contract.
