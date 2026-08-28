# V1 → V2 FEATURE LEDGER (definitive)

Owner: V1V2Ledger · Date: 2026-08-26 · READ-ONLY deliverable.

**Sources:** full inventory of root `*.js` (89 files), `modes/*.js` (26 files),
root `index.html` inline engine (1123 lines incl. stage director), vs
`v2/src/**` (69 files at scan time); cross-checked against every v2 module's
own header ("port of frozen-v1 X") and this session's wave reports
(`GATES.md`, `bugs-puzzle.md`, `bugs-takeover.md`, `bugs-mparc.md`,
`layout-audit.md`, `perf-report.md`, `a11y-audit.md`).

**Law:** `v2/DNA.md` is ground truth. v1 mechanics that violate the DNA
(color-rotation rules, rainbow palettes) are excluded **by design**, not lost.
"Mechanic, not code" — v2 re-implements; nothing was copied verbatim.

## Status legend

| Tag | Meaning |
|-----|---------|
| PORTED | Mechanic lives in v2 and is wired into the live flow |
| PARTIAL | Core mechanic ported; breadth/sub-features still missing |
| QUEUED | Owned decision: wanted in v2, not started |
| N/A | Superseded by architecture, excluded by DNA rails, or dev tooling |

---

## 1. Engine core & scene flow

| V1 | V2 counterpart | Status | Notes |
|----|----------------|--------|-------|
| `index.html` inline engine (profile store, AU/CX bridges, IQ.Stage registry + director, board render, reveal beat, run/end flow) | `src/main.ts` + `scenes/*` | PORTED | Scene graph Boot→Landing→Lobby→Game→Interlude→End per DNA §V2 architecture. Stage registry replaced by typed takeover mount list (`TAKEOVERS`). Reveal beat extracted to `fx/reveal.ts`. |

## 2. Puzzle generation (root generators)

| V1 | V2 counterpart | Status | Notes |
|----|----------------|--------|-------|
| `puzzles.js` (IQ.Puzzles base generator + renderer) | `puzzles/types.ts`, `glyphs.ts`, `main.ts dealPuzzle` | PORTED | Rebuilt on DNA prim system (tri/dot/diamond/line); color-step kinds dropped per DNA anti-patterns. Family contract adds independent `solve()` (gauntlet G2). |
| `gen_count.js` ('count') | `families.ts 'count-grid'` | PORTED | Count arithmetic across rows/cols; structural marks instead of color. |
| `gen_missing.js` ('missingSec') | `families.ts 'missing-section'` | PORTED | Repeating motif field, hole bottom-right. |
| `gen_rotate.js` ('rotate') | `families.ts 'rotation-composite'` + `'dot-matrix-rotate'` | PORTED | Rotation progression kept, rebuilt structural (DNA-real). |
| `gen_morph.js` ('morph') | `'size-ladder'`, `'rotation-composite'` | PARTIAL | Scale axis → size-ladder; rotate axis covered; nested-frame morph variants queued. |
| `gen_logic1.js` ('logicA'), `gen_logic2.js` ('logicB') | `families3.ts 'line-reflection'`, `'size-ladder'` (structural subsets) | PARTIAL | Multi-attribute binding packs were largely color-keyed; structural archetypes partially re-covered, rest queued. |
| `gen_cycle.js` ('cycle') | — | QUEUED | Shape-cycle along axis is DNA-compatible (structural), not yet built. |
| `gen_sets.js` ('sets') | — | QUEUED | Set-completion (shape classes per row/col) is fully structural; strong candidate. |
| `gen_depth.js` ('compound','relay'), `gen_depth2.js` ('parquet','pendulum') | — | QUEUED | Deep-composition families; audited designs exist in v1 to mine. |
| `gen_wild.js` ('wild') | — | QUEUED | Rule-twist corruption mode; deferred until DNA-real set exhausted. |
| `gen_dual.js`, `gen_iqb.js`, `gen_latin.js`, `gen_shade.js` | — | N/A | Color/hue-step rules — banned by DNA rule 1 + anti-patterns. |
| `gen_seqpack.js` (sequences) | — | N/A | Arithmetic *color*-step sequences; structural sequence variant folded into QUEUED ideas above. |
| `gen_retro_a.js`, `gen_retro_b.js` (retro puzzle envelopes feeding retro-* stages) | takeover scenes own their logic | N/A | Superseded: each v2 takeover is a self-contained scene with its own seeded sim + `selfTest()`. |

**Family totals:** v2 ships **9 families** (`count-grid`, `accretion`,
`count-positions`, `dot-matrix-rotate`, `line-reflection`, `missing-section`,
`position-orbit`, `rotation-composite`, `size-ladder`) across `families.ts` /
`families2.ts` / `families3.ts`; all solver-audited (G2 GREEN per GATES.md;
BugPuzzle probe: 9×1000 boards clean).

## 3. Presentation & juice

| V1 | V2 counterpart | Status | Notes |
|----|----------------|--------|-------|
| `gfx-background.js` (stage-reactive bg canvas) | `worlds/backdrops.ts`, `worlds/hellbacks.ts` | PORTED | Alignment-keyed procedural backdrops, pure f(t), seeded pick. |
| `gfx-board.js` (board frame/tile presentation) | `theme.ts`, `scenes/game.ts panel/edgeRect`, `scenes/shell.ts` | PORTED | DNA layout contract (board ~60% left, sidebar ~35%). |
| `hell-skin.js` (hell escalation skin) | `worlds/hellbacks.ts` (7 layers + sanctuary) + `scenes/arc.ts` tokens | PORTED | Landed this batch (HellBackdrops/HellHeaven waves). |
| `sanctuary.js` (faithful-skin refuge on good rounds) | `arc-data.ts plan.sanctuary`, `arc.ts sanctuaryOn/Off`, `hellbacks.ts 'sanctuary'`, `large.ts announceLarge('sanctuary')` | PORTED | Clean flip verified as G4 checklist item. |
| `emerald-fx.js` + index emerald layer | `scenes/interlude.ts` | PARTIAL | Pick-your-poison relic cards every 4th depth ported; orbiting screen-edge emerald visual not. |
| `chaos.js` (shake/glitch/flash/embers bus) | `fx/reveal.ts` + `arc.ts` layer treatment | PARTIAL | Event voices exist; global shake/glitch/intensity bus not yet ported. |
| `fun.js` (presentation juice overlay) | spread across `reveal.ts`/takeover juice | PARTIAL | Per-scene juice present; shell-level overlay layer absent. |
| `horror.js` (atmosphere overlays: tendrils, whispers, breathing) | arc layer banners + dark backdrops | PARTIAL | Mood carried by layers/backdrops; dedicated overlay FX queued. |
| `landing-polish.js` (progressive landing enhancement) | `scenes/landing.ts` | PORTED | Landing rebuilt natively faithful (header/hero/cards/create-room/join-by-code); enhancement layer obsolete. |
| `intro.js` (boot film) | — | QUEUED | |
| `gfx-title.js` (title motion) | — | QUEUED | |
| `transitions.js` (stage-scaled transition film) | — | QUEUED | Hard cut between depths today. |
| `cursor.js` (cursed cursor wisp) | — | QUEUED | Native cursor everywhere; takeovers implement their own cursors where gameplay needs it. |
| `boardmove.js` (stage≥2 board drift/lurch) | — | QUEUED | Puzzle frame static in v2. |
| `dims.js` ('3d'/'4d'/'606d' perspective modes) | `takeovers/hypercube2.ts` (606D as takeover) | PARTIAL | Perspective wrapper modes not ported; the 606D joke survives as its own scene. |
| `cleanse.js` ("HIP TO BE SQUARE" relief round) | — | QUEUED | |
| `board-skins.css` | BoardSkins wave (in flight this batch) | QUEUED | Not part of *.js inventory; tracked for completeness. |

## 4. Audio

| V1 | V2 counterpart | Status | Notes |
|----|----------------|--------|-------|
| `audio.js` (procedural SFX core) | `audio/audio.ts` + `audio/sfx2.ts` | PORTED | Lazy ctx, mute gate, SFX registry; identity one-shots in sfx2. |
| `music-pack.js` (alignment-reactive music director) | `audio/beds.ts` | PORTED | Four synth beds keyed by alignment + dread layer + stings. |
| `demon-audio.js` (shadow-flavor layer) | `audio/director.ts` | PORTED | Act-reactive corruption bus + reveal/hp/emerald event voices. |
| `pack-hellaudio.js` (fire/chaos escalation hooks) | `audio/director.ts` act-reactive layers | PORTED | Mechanic folded into the director's act bus. |

Node proof harnesses: `audio/selftest-audio.ts`, `selftest-director.ts`
(v2-only additions).

## 5. Shadow persona

| V1 | V2 counterpart | Status | Notes |
|----|----------------|--------|-------|
| `shadow.js` (corruption persona quips) | `shadow/shadow.ts` + `shadow/pools.ts` | PORTED | Speech budget (8 s throttle semantics from chaos-balance §5) ported. |
| `demonsay.js` (dialogue banner) | `shadow/shadow.ts` (channel) + `shadow/large.ts` (major beats) | PORTED | LARGE presence channel (grow-on-emphasis) is a v2 extension. |
| `shadow-avatar.js` (SVG persona avatar) | `shadow/avatar2.ts` (layered procedural silhouette) | PORTED | Upgraded renderer landed this batch (ShadowAvatarV2). |
| `taunts.js` (contextual taunts) | `pools.ts` contextual pools fed by `say('wrong'|'right')`, streak events | PORTED | Mistake-specific lines carried in pool design. |
| `content_quips.js` (persona quip banks) | `shadow/pools.ts` | PORTED | Voice + best lines ported (≤90 chars cap kept). |
| `content_prompts.js` (evil prompt overlays) | family `rule` sentences (`puzzles/types.ts`) | N/A | Superseded: reveal shows the puzzle's own one-sentence rule (DNA G4 item 4). |

## 6. Worlds

| V1 | V2 counterpart | Status | Notes |
|----|----------------|--------|-------|
| `worlds.js` (registry + jungle/volcano/hell/riot/ocean/heaven/cave/limbo) | `worlds/registry.ts` + `backdrops.ts` | PARTIAL | Registry + pick contract ported (one-rng deterministic). Backdrops present: volcano, ocean, riot, limbo, heaven (+garden, purgatory, stars, trench, upside-down, womb, lsd-melt). Missing: jungle, cave, hell (replaced by hellbacks 7 layers). |
| `worlds-pop.js` (cyber-hunter, wasteland-roads, golden-mastermind, sky-laser, symbiote-party, doll-game, sharks, dolphins) | — | QUEUED | None registered 1:1 yet. |
| `worlds-mind.js` (basement-thing, mountain-ascent, womb, bad-trip, stair-of-heaven) | `backdrops.ts 'womb'` (+ lsd-melt ≈ bad-trip mood) | PARTIAL | womb ported; other four queued. |
| `worlds-realm.js` (seed-garden + continuity realms) | `backdrops.ts 'garden'`, `'purgatory'` (mood-level) | PARTIAL | Continuity realm set not 1:1; alignment planner carries the arc logic instead (`arc-data.ts`). |

World count today: **20 backdrops** (12 general + 7 hell layers + sanctuary)
vs **25 v1 world registrations**.

## 7. Multiplayer

| V1 | V2 counterpart | Status | Notes |
|----|----------------|--------|-------|
| `net.js` (PeerJS star, host-authoritative) | `net/net2.ts` | PORTED | Dual-transport TS port + wave-5 robustness; stress-audited (`bugs-mparc.md`). |
| `room-ui.js` (lobby presence UI) | `scenes/lobby.ts` + `scenes/shell.ts` player cards | PORTED | |
| `lms.js` (last-man-standing + point attacks) | `scenes/mpfeat.ts` | PORTED | Build-B semantics onto the v2 wire; MP flow in `scenes/mp.ts`. |

## 8. Meta / continuity

| V1 | V2 counterpart | Status | Notes |
|----|----------------|--------|-------|
| `alignment.js` (IQ.Align descent arcs + continuity planner) | `arc-data.ts planArc` + `scenes/arc.ts applyArc/layerBanner` + `beds.setAlignment` | PORTED | Mostly bad/chaotic, ~1-in-5 good heal rounds, deepening layers. |
| `accolades.js` | `meta/accolades.ts` + `end.ts` chip strip | PORTED | Pure match-record engine, frozen recon §19 semantics. |
| `review.js` (per-round review) | `scenes/end.ts` | PORTED | Review renders inside the end scene. |
| `onboard.js` (first-run hints) | `meta/onboard.ts` goal cards + legends | PORTED | Goal card at deal time (title/controls/win condition). |
| `pack-onboard-w4.js` (first-visit legends for W4 beats) | `meta/onboard.ts` stage-id coverage (+`selftest-onboard.ts`) | PORTED | |
| `pack-quips-w4.js` (event-reactive voice beats) | `pools.ts` + `large.ts` announce channels | PARTIAL | Six W4 one-shot reactions not individually mapped; channel + budget exist. |
| `pack-story.js` (descent mythology / redemption arc) | `arc-data.ts` redemption-thread inheritance + story quips in `pools.ts` | PARTIAL | Lore beat breadth queued. |

## 9. Fate / hooks / army packs

The v1 runtime `IQ.Hooks.add({handlers})` bus does not exist in v2 by design:
round modifiers are **pure fate layers** Main rolls once per deal
(`fate/fate.ts`, `cursepack.ts`, `flavor-a.ts`, `flavor-b.ts`), and big
takeover beats are **director-owned scenes**. That architectural replacement
is why most hook packs below are QUEUED rather than ported — their *event*
surface changed shape.

| V1 | V2 counterpart | Status | Notes |
|----|----------------|--------|-------|
| `hooks.js` (hook backbone + modifier vocabulary) | fate modules + `main.ts` director scheduling | PORTED | Modifier vocabulary (hpDelta/scoreMul/banner) preserved in fate result types. |
| `curse-pack.js` (blessing/curse rolls) | `fate/cursepack.ts` | PORTED | Roll scheme mirrors v1 mutually-exclusive windows. |
| `pack-events.js` (horsemen chain etc.) | `fate/fate.ts` | PORTED | |
| `pack-fate-w4.js` (six more fate events) | folded into `fate/fate.ts` breadth | PORTED | |
| `pack-wwe.js` (slam events + slam-arena world) | `fate/flavor-a.ts` (events only) | PARTIAL | World queued. |
| `pack-horror.js` (5 horror packs + 5 worlds) | `flavor-a.ts` (micro-events) | PARTIAL | Sandman/sleep-meter etc. queued. |
| `pack-brit.js` (blighty humour) | `flavor-a.ts` (+ brit tone in pools) | PARTIAL | World queued. |
| `pack-countries.js` (nation rounds) | `fate/flavor-b.ts` | PARTIAL | Micro-events ported; full nation rounds queued. |
| `pack-interludes.js` (slime gallery, machine interludes…) | `takeovers/slimegallery.ts`, `takeovers/slots.ts` | PARTIAL | Two biggest interludes are now full takeovers; remaining gallery beats queued. |
| `pack-hunters.js` (8 themed gameplay packs) | hunter-dodge / overwatch mechanics exist as scenes | PARTIAL | Hook breadth (ammo banking etc.) queued. |
| `pack-realm.js` (heaven/hell traversal) | hellbacks 7 layers (backdrops) + layer banners | PARTIAL | Traversal campaign loop queued. |
| `hellheaven.js` (7-layer campaign layer) | `worlds/hellbacks.ts` hell-1…hell-7 + sanctuary + `arc.ts` layer escalation | PARTIAL | Visual ladder landed this batch; campaign state machine queued. |
| `pack-muses.js` | muse voice lines in `pools.ts` | PARTIAL | muse-garden world + interlude queued. |
| `cameo-pack.js` (silhouette cameos) | — | QUEUED | No cameo code in v2. |
| `pack-ailments.js` | — | QUEUED | |
| `pack-cavern.js` | — | QUEUED | |
| `pack-chaos.js` (jester court jests) | — | QUEUED | |
| `pack-density-a.js` (6 parody worlds + beats) | — | QUEUED | |
| `pack-funny.js` (dread tracker, flashback) | — | QUEUED | |
| `pack-gunship.js` (warzone-pavelow) | — | QUEUED | |
| `pack-undead.js` (4 undead packs + worlds) | — | QUEUED | |
| `pack-nam.js` (jungle recon) | — | QUEUED | |
| `pack-stones.js` (gauntlet stones + temple) | — | QUEUED | gauntlet2 covers horsemen ritual only. |
| `pack-popcult-a.js`, `pack-popcult-b.js` | — | QUEUED | |
| `pack-void-extra.js` | — | QUEUED | |

## 10. Dev tooling (root)

| V1 | V2 counterpart | Status |
|-----|----------------|--------|
| `dev-server.js` (static server, v2/dist at root) | Vite dev server (hub `iqbattle-v2`, :8792) | N/A — superseded |
| `smoke-pack-undead.js`, `smoke-slime.js`, `smoke-terminator.js` | per-module pure `selfTest()` exports run by G3 soak (`soak.ts`) + `research/v2-gauntlet/*.ts` probes | N/A — superseded |

## 11. Takeover stages — `modes/*.js` (appendix)

Director wiring today (`main.ts TAKEOVERS`, 11 mounted): redlight, tidepool,
serpent, floorfall, hunterdodge, laserstorm, dronedodge, saberclash, slots,
slimegallery, well.

| V1 mode | V2 scene | Status |
|---------|----------|--------|
| `mode-puzzle.js` (base puzzle stage) | `scenes/game.ts` + `dealPuzzle` — architectural replacement | N/A |
| `mode-redlight.js` | `takeovers/redlight.ts` | PORTED · mounted |
| `tidepool.js` | `takeovers/tidepool.ts` | PORTED · mounted |
| `snake.js` | `takeovers/serpent.ts` | PORTED · mounted |
| `floorfall.js` | `takeovers/floorfall.ts` | PORTED · mounted |
| `hunterdodge.js` | `takeovers/hunterdodge.ts` | PORTED · mounted |
| `laserstorm.js` | `takeovers/laserstorm.ts` | PORTED · mounted |
| `dronedodge.js` | `takeovers/dronedodge.ts` | PORTED · mounted |
| `saberclash.js` | `takeovers/saberclash.ts` | PORTED · mounted |
| `slots.js` | `takeovers/slots.ts` | PORTED · mounted |
| `slime.js` | `takeovers/slimegallery.ts` | PORTED · mounted |
| `tetris.js` | `takeovers/well.ts` (mounted) + `takeovers/tetris2.ts` (alt port) | PORTED · mounted (+alt unwired) |
| `pacman.js` | `takeovers/pacman2.ts` | PORTED · unwired |
| `battleship.js` | `takeovers/battleship2.ts` | PORTED · unwired |
| `doom.js` | `takeovers/doom2.ts` | PORTED · unwired |
| `fractalsolve.js` | `takeovers/fractal2.ts` | PORTED · unwired |
| `gauntlet.js` | `takeovers/gauntlet2.ts` | PORTED · unwired |
| `hypercube606.js` | `takeovers/hypercube2.ts` | PORTED · unwired |
| `metal-stage.js` | `takeovers/metal2.ts` | PORTED · unwired |
| `phoenixritual.js` | `takeovers/phoenix2.ts` | PORTED · unwired |
| `pop-glitter-stage.js` | `takeovers/popglitter2.ts` | PORTED · unwired |
| `sniperstage.js` | `takeovers/sniper2.ts` | PORTED · unwired |
| `lanternguard.js` | — | QUEUED |
| `madmax.js` (fury-roadrun) | — | QUEUED |
| `skylaser.js` | — | QUEUED |
| `terminator.js` (terminator-hunt) | — | QUEUED |

All 21 ported takeover scenes export pure `selfTest()` runners
(`selftest*.ts` suites); the 11 wired ones passed the BugTakeover parity
audit (`bugs-takeover.md`).

## 12. V2-only additions (no v1 root counterpart)

- `theme.ts` — DNA design tokens, single source of truth.
- `glyphs.ts` + `puzzles/types.ts` — DNA prim system, Family contract,
  independent-solver contract (`solve(p)===p.answer` gate).
- `puzzles/audit2.ts` + `research/v2-gauntlet/audit-runner.ts` — G2 solver
  audit gate (0 wrong tolerance).
- Structural families new-but-DNA-aligned: `count-positions`,
  `dot-matrix-rotate`, `line-reflection`, `size-ladder`.
- `scenes/shell.ts` — shared chrome extraction (header/status strip/player
  cards/toasts/widgets).
- `scenes/arc.ts` token-driven chrome mutation (label-convention applier).
- `fx/reveal.ts` — reveal beat as a reusable module.
- `shadow/large.ts` — major-beat presence channel; `shadow/avatar2.ts` —
  upgraded silhouette renderer (this batch).
- `worlds/hellbacks.ts` — hell-1…hell-7 + sanctuary backdrops (this batch).
- Selftest culture: `net/selftest.ts`, `audio/selftest-audio.ts`,
  `selftest-director.ts`, `worlds/selftest.ts`, `meta/selftest-onboard.ts`,
  five `takeovers/selftest*.ts` suites.
- `window.__DBG` telemetry surface (used by perf/layout/playthrough audits).

## 13. Remaining delta (queued work, priority order implied by rails)

1. **Wire the 11 unwired but finished takeover ports** into the director
   rotation: pacman2, battleship2, doom2, fractal2, gauntlet2, hypercube2,
   metal2, phoenix2, popglitter2, sniper2, tetris2 (all have passing
   self-tests; only `TAKEOVERS` + goal-card ids needed).
2. **Four takeovers never started:** lanternguard, madmax (fury-roadrun),
   skylaser, terminator-hunt.
3. **World breadth:** ~14 missing registrations vs v1 (jungle, cave,
   cyber-hunter, wasteland-roads, golden-mastermind, sky-laser,
   symbiote-party, doll-game, sharks, dolphins, basement-thing,
   mountain-ascent, bad-trip, stair-of-heaven + realm set).
4. **Army-pack breadth** (events/worlds): ailments, cavern, jester court
   (pack-chaos), density-a, funny, gunship, undead ×4, nam, stones +
   gauntlet-temple, popcult A/B, void-extra; horror/brit/wwe/countries full
   rounds beyond flavor micro-events.
5. **Presentation queue:** transitions film, intro boot film, title motion,
   cursed cursor, board drift, dims 3d/4d wrappers, cleanse relief round,
   horror atmosphere overlays, chaos juice bus remainder, orbiting-emerald
   visual, board skins (BoardSkins wave in flight).
6. **Generator queue (structural/DNA-safe only):** sets, cycle,
   compound/relay/parquet/pendulum depth packs, wild corruption, remaining
   logicA/B structural archetypes, morph nested-frame variants.
7. **Campaign/state:** hellheaven traversal loop + pack-realm event layer;
   pack-story lore beats; pack-quips-w4 six one-shot reactions.
8. **Known defects** live in the session audit files, not here:
   `bugs-puzzle.md`, `bugs-takeover.md`, `bugs-mparc.md`,
   `layout-audit.md`, `a11y-audit.md`, `perf-report.md`.

## 14. Totals

Root `*.js`: **89 files**

| Status | Count |
|--------|-------|
| PORTED | 30 |
| PARTIAL | 22 |
| QUEUED | 25 |
| N/A (superseded / DNA-excluded / tooling) | 12 |

`modes/*.js`: **26 files** — PORTED·mounted 11 (well+tetris2 gives tetris an
extra alt port), PORTED·unwired 10, QUEUED 4, N/A 1.

`v2/src/**`: **69 files** at scan time (live tree: `hellbacks.ts`,
`avatar2.ts` landed mid-inventory from concurrent waves) — 55 carry ported v1
mechanics (incl. hybrid ports like `families2/3.ts`, `large.ts`,
`hellbacks.ts`), 14 are v2-only infrastructure/tests listed in §12.

Engine core: index.html inline engine → `main.ts` + `scenes/*` (PORTED).

**Bottom line:** the entire load-bearing path (engine, puzzle engine, audio,
shadow persona, MP, arc/sanctuary, hell skin, 11-wire takeover rotation) is
ported and gate-audited; the open delta is breadth — unwired finished
takeovers, ~14 worlds, the army-pack long tail, and the presentation juice
queue.
