# IQ VERSUS: SHADOW — v2 Player + Dev Cheat Sheet

Vite + TypeScript + PixiJS v8 rebuild of iqversus.com with the corruption arc layered on top.
Fixed 1600×900 logical stage, letterboxed to any viewport. Ground truth for the puzzle engine:
`v2/DNA.md`. The old v1 build stays frozen at repo root (`modes/*.js` — read-only reference).

---

## Run it

**Dev (hot reload)**

```sh
cd v2
npm i          # once
npm run dev    # vite --port 8792 --strictPort → http://localhost:8792
```

**Built (root server :8791)**

```sh
cd v2 && npm run build     # tsc + vite build → v2/dist
cd .. && bun dev-server.js # http://localhost:8791
```

The root Bun server serves `v2/dist` at `/` (SPA fallback included), the legacy v1 build under
`/v1/`, and sends `no-store` everywhere so browser cache never shadows an iteration.

**Checks**

```sh
npx tsc                          # strict typecheck (clean project-wide)
node src/puzzles/audit2.ts       # family solver gauntlet (see Gauntlet below)
node --experimental-strip-types src/scenes/takeovers/selftest.ts   # + other suites below
```

---

## How a run plays

Landing → **CREATE ROOM** (name + optional room name) → Lobby (round timer 1–120 s, default 60,
5-char room code) → START → depths descend one round at a time until HP hits 0 or the arc plan is
exhausted. End screen: score, depth, DESCEND AGAIN / BACK TO LANDING.

Each depth deals either a **puzzle round** (the iqversus core) or a **takeover round** (chaos
stage). Rules of the deal (`main.ts`):

- **Puzzles**: difficulty ramps `min(5, 1 + floor(depth/6))`; correct answer pays
  `100·diff + 40 + 20·(streak−1)`; wrong costs 40 pts + 12 hp; timeout costs 12 hp.
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

Eleven stages are wired into the live rotation (`main.ts` `TAKEOVERS`, same order as
`TAKEOVER_NAMES` and `meta/onboard.ts` `MOUNTED_STAGE_IDS`). Nine wave-1 ports plus two rhythm
ports exist as scenes with goal cards and self-tests but are not yet in the rotation array.

| # | Name | File | Goal | Controls |
|---|------|------|------|----------|
| 1 | RED LIGHT | `redlight.ts` | Solve on green, freeze dead-still on red | Click/tap or press 1–4 |
| 2 | TIDE POOL | `tidepool.ts` | Answer only from a dry pool — the tide decides when | Click/tap a dry pool or press 1–8 |
| 3 | SERPENT | `serpent.ts` | Eat, grow, don't bite yourself | Arrows / WASD / swipe |
| 4 | FLOOR-FALL | `floorfall.ts` | Answer before the tile under you drops | Click/tap a standing tile or keys 1–8 |
| 5 | HUNTER-DODGE | `hunterdodge.ts` | Stay out of the lock-on cone; break the lock with an answer | Move out of the beam · click/tap or keys 1–8 |
| 6 | LASER-STORM | `laserstorm.ts` | Pick a lane the sky is not about to fry | Click/tap a cold lane · never a firing one · keys 1–8 |
| 7 | DRONE SWARM | `dronedodge.ts` | Dodge the swarm, answer when the sky clears | Move to evade · click/tap or keys 1–8 |
| 8 | SABER CLASH | `saberclash.ts` | Strike inside the sweet arc, three rings | Space / click/tap to strike |
| 9 | ONE-ARMED GOD | `slots.ts` | Stop the reels; any payout beats the house | Space / click/tap to stop each reel |
| 10 | SLIME GALLERY | `slimegallery.ts` | Pop slimes, never shoot the crown | Click/tap / keys 1–9 |
| 11 | THE WELL | `well.ts` | Stack lines, clear, survive | ←→ move · ↑/X cw · Z ccw · ↓ soft · SPACE drop · P pause |

Ported, awaiting rotation (goal cards live in `meta/onboard.ts`):

| Stage | File | Goal | Controls |
|-------|------|------|----------|
| GLUTTON | `pacman2.ts` | Eat every pellet; big dots turn the tables | Arrows / WASD / swipe |
| THE WELL II | `tetris2.ts` | Same well, deeper water | Same as THE WELL |
| SALVOS | `battleship2.ts` | Sink the fleet; every salvo calls its shot | Click/tap a grid cell |
| THE CORRIDOR | `doom2.ts` | Walk the corridor; answer before it answers you | WASD move · click/tap or keys 1–8 |
| PHOENIX RITUAL | `phoenix2.ts` | Keep the flame alive through every ritual step | Click/tap the ritual steps |
| HORSEMEN GAUNTLET | `gauntlet2.ts` | Outrun the four horsemen; solving gains ground | Arrows / WASD · click/tap or keys 1–8 |
| FRACTAL SOLVE | `fractal2.ts` | Find the missing branch hidden inside the pattern | Click/tap or keys 1–8 |
| HYPERCUBE 606D | `hypercube2.ts` | Read the spinning cube; pick the next face | Click/tap or keys 1–8 |
| LONG QUIET | `sniper2.ts` | One breath, one shot into the crosshair | Aim with mouse · click/tap or keys 1–8 |
| CHART TOPPER | `popglitter2.ts` | 4-lane pop rhythm set; combos pay directly | D F J K / 1–4 / tap pads |
| FORGE SET | `metal2.ts` | Heavier twin of CHART TOPPER; ×2 downbeat accents | D F J K / 1–4 / tap pads |

Every takeover: own `mulberry32` seeded from `ctx.seed` (+ fixed salt), self-resolves inside
`ctx.timerLen`, settles its `StageResult` exactly once (`onceResolve`), empties `ctx.container`
on done.

---

## Puzzle families (9, all DNA-real)

One hue per board from the `T.boardHues` wheel (gold, orange, crimson, sky, violet, mint) — color
never varies within a board; glyphs are primitive marks only (triangles, dots, diamonds, lines,
via `glyphs.ts`). Hole is always bottom-right; 8 pairwise-distinct options; every family ships an
independent solver that re-derives the answer from visible data.

| Family | Rule (from the legends shown at depths 1–3, once per family per run) |
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

Sources: `puzzles/families.ts`, `families2.ts`, `families3.ts`; shapes in `puzzles/types.ts`.

---

## Corruption arc · sanctuary · hell layers

`arc-data.ts` plans the whole descent deterministically from the run seed:

- Blocks of **4–6 hostile rounds** (bad, ~1-in-8 chaotic) closed by exactly **1 good round** —
  long-run ≈5:1 hostile:good. Rare neutral "limbo" round may precede the closer.
- **Acts 0–3** (SURFACE → DESCENT → INFERNO → ABYSS) tint bg/panel/tile chrome as depth grows;
  accents stay cold-blue until the descent turns crimson.
- **Layers 1–7** track consecutive hostile rounds: a deepening crimson vignette plus a whispered
  banner ("something followed you down" → "nothing above us now").
- **Sanctuary**: on every good round the entire chrome reverts to faithful original-iqversus
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
   BroadcastChannel + localStorage-ring fallback for same-machine/offline play; contiguous
   watermark + replay valve means frames arrive exactly-once in order.
4. Protocol (`scenes/mp.ts`): host ships `begin{timer,lms,rn,sd}` — clients regenerate the
   IDENTICAL arc locally from the run seed. Each depth, `roundPlan()` mirrors the local pick
   formulas exactly, so clients mount the same family/stage at the same seed; puzzle payloads
   never cross the wire (answers can't leak by construction). Clients return integer verdicts
   `{sr{correct,points,hpDelta}}`; the host clamps them (points [−200,500], hp [−60,60],
   anti-spoof ceiling `100·diff+40`) before folding into the authoritative reveal.
5. LMS + attacks (`scenes/mpfeat.ts`): score-floor/hp-death elimination ('and' mode; 'or'
   hardcore), eliminated players spectate, last player standing ends the match. Attack menu
   (rotten / curse, depth-scaled costs) — host validates then adopts the fresh table; rage quit
   slams the door without ending the match.

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
  mp.ts                 MP orchestration over net2 (lobby/begin/round/sr/reveal/LMS/meta)
  mpfeat.ts             Pure LMS/attack game rules + UI specs (standings, attack menu, rage quit)
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
```

Individual scenes also carry their own smoke entries
(`node --experimental-strip-types src/scenes/takeovers/<scene>.ts`). Self-tests probe hundreds of
seeds each (e.g. RED LIGHT's cadence check asserts ≥10 distinct schedules across 300 seeds) so
seed-blindness and determinism regressions fail loudly. Layout-vs-DNA visual diffs stay manual:
launch the dev server and eyeball against `DNA.md`'s layout contract.
