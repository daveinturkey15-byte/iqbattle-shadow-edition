# Playable Takeover Modes — Design Pass (read-only)

Grounding sources read before writing: `index.html` (round loop, `startTimer`, `answer`, `broadcastRound`,
`applyIncomingRound`, emerald/cleanse interludes, `depthDiff`), `net.js` (host-authoritative star topology,
frame vocabulary, `sanitizeRound` warning block), `hooks.js` (`makeRng` = mulberry32, dispatch/ctx shape,
per-match state), `alignment.js` (slice `{align, theme, dim, arcDepth, amp, harsh, phase, …}`),
`gen_retro_a.js` (existing *puzzle-about-retro* generators — these modes are the PLAYABLE counterparts;
gameplay IS the retro game, no option tiles, no question text).

Every mode below implements the Stage contract (`window.IQ.Stage.register`, see
`research/mode-contract.md`): `mountAsync(container, ctx) -> Promise<StageResult>` with
`StageResult = { kind:'score', correct:boolean|null, points:number, hpDelta:number, summary:string }`.
Modes NEVER touch `G`; the engine applies scoring/hp host-side after resolve.

---

## 0. Shared machinery (all modes)

### 0.1 Surface & lifecycle
- Mount point: the container the engine passes (the parent of `#board-frame`). Mode owns 100% of it.
- Each mode creates ONE `<canvas>` sized `min(container.clientWidth, 720) × min(clientHeight, 520)`,
  DPR-aware (`canvas.width = cssW * devicePixelRatio`). Vector/CSS overlays (HUD, banners) are absolutely
  positioned divs inside the container — same styling conventions as luxe.css tokens (Oxanium, letterspaced
  microcopy, palette via `IQ.Worlds.palRow()`).
- Modes run THEIR OWN `requestAnimationFrame` loop and MUST cancel it plus remove every listener they
  added in a `teardown()` invoked before resolving (precedent: engine's `nav()` does
  `cancelAnimationFrame(G.raf); clearInterval(G.shuffleIv)`). Engine key handler (`keydown` digits →
  options) is inert during stages because `G.answered` gating moves to the engine's stage wrapper; modes
  additionally call `e.preventDefault()` on arrows/space to stop page scroll.
- Countdown: mode drives the EXISTING topbar timer (`#timer-fill`, `#timer-num`) with the same
  `scaleX` transform the engine uses, so the chrome never changes. Hard cap: every mode self-resolves at
  its `DURATION_CAP` (≤45s) regardless of state.

### 0.2 Determinism patterns (choose ONE per mode; declared per section)
- **PATTERN S — seeded-sim:** everything derivable from `ctx.rng` (seeded from
  `Hooks.makeRng(ctx.seed ^ round)`). Zero relay; host recomputes every player's outcome locally.
  Only valid when player input cannot change the outcome.
- **PATTERN Q — seeded-world + input-relay (lockstep-lite):** world layout/AI/spawn tables come from
  `ctx.rng` (identical on every tab). Player inputs are relayed to the host, which replays them through
  its own sim of the SAME seeded world and issues the authoritative `StageResult`. Frames:
  - client→host `{t:'stageInput', n:<round>, mode:<id>, seq:<n>, ev:[[dtMs,key],…]}` — batched every
    250 ms (≤ ~180 frames/45 s; trivial for PeerJS DataChannel),
  - host→client `{t:'stageAck', n:<round>, ok:1}` only on desync/error (correction path; normally silent).
- **PATTERN V — secret-host + validated events (pick-style):** for modes with a hidden solution
  (battleship placements). Host holds the secret; each player action is one validated frame, exactly
  mirroring today's `pick` → immediate verdict → `reveal`. The secret NEVER enters the round payload —
  this is the `sanitizeRound` discipline restated for stages: *round payloads ship seed + public tables
  only; anything that pre-answers the round (ship coords, hidden reel stop, demon positions behind fog)
  stays host-side.*
- **SOLO shortcut:** when `!ctx.mp`, all patterns collapse to local execution — no frames sent ever.

### 0.3 Outcome → StageResult conventions (kept comparable with puzzle economics)
Puzzle rounds pay `≈100·diff + speed·80 (+streak·20)` ≈ 100–580 pts and punish −40 pts / −15 hp.
Arcade modes target the same band so LMS attack costs (80/150 pts) and the scoreboard stay meaningful:
- `correct`: `true` = primary objective met; `false` = failed it; `null` allowed only for
  partial/neutral resolutions defined per mode.
- `points`: 60–350 typical; jackpots capped at 500 (slot-machine exception: 600).
- `hpDelta`: negative only for failure states, floor −15 per round (same as a wrong puzzle answer);
  positive only where the mode explicitly grants healing (doom-corridor medkits, slot jackpot), ceiling +15.
- `summary`: ≤48 chars, shown in the interlude banner, e.g. `"WELL CLEARED — 5 LINES"`.

### 0.4 Difficulty-by-depth
All modes scale off `diff = clamp(1 + floor(ctx.depth/6), 1, 5)` — the exact `depthDiff()` curve —
plus the Align slice (`ctx.align`, `ctx.arcDepth`): `align:'bad'|'chaotic'` adds one difficulty notch of
pressure (never two), `phase:'fire'` (`harsh:2`) doubles hazard magnitudes, `calm:1` limbo slices downgrade
one notch, `phase:'phoenix'` multiplies final points ×1.5 (matching the plan's `scoreMul:1.5` intent).

### 0.5 Fairness rails (every mode, non-negotiable)
- Fullscreen flashes: none. Feedback is localized (particles, vignette) or ≤200 ms and ≤3 Hz if full-bleed.
- All overlays (pause card, how-to strip) escapable ≤12 s; controls hint visible for the first 3 s.
- `IQB_MOTION=false`: disable screen shake, view-bob, spin-blur (slot reels snap instead of animate);
  gameplay logic unchanged.
- `IQB_MUTED=true`: no WebAudio (route through `IQ.Audio` so the gear toggle covers modes automatically).
- Telegraphed hazards: 400 ms warning tint before any unavoidable damage; ghost/demon approach cues are
  visual AND positional (no audio-only tells).
- Readable text: HUD ≥12px Oxanium, contrast ≥4.5:1 against `palRow()` backdrop.
- Touch parity: every key control has a pointer equivalent (documented per mode); minimum hit target 44 px.

---

## 1. `snake-playable` — "SERPENT"

**Feel:** you ARE the snake. Grid crawls; eat the quota before the timer or your own tail.

- **Surface:** 21×21 cell canvas grid (cell ≈ 22 px), walls drawn as palRow-colored blocks.
- **Controls:** Arrows/WASD steer (queued, max 2 buffered turns per tick); touch = swipe anywhere on the
  canvas (direction of swipe). No other input.
- **Win/Lose:** eat `QUOTA` food orbs → win early; hit wall/self → lose early; 40 s cap otherwise.
- **Duration cap:** 40 s (`DURATION_CAP`).
- **StageResult:** `correct = (food >= QUOTA)`; `points = 40 + 30·food + (win ? 80 : 0)` (typ. 70–290);
  `hpDelta = lose ? −15 : 0`; summary `"SERPENT FED x/y"`.
- **Determinism:** PATTERN Q. Food spawn positions from `ctx.rng` (rejection-sampled away from body);
  direction-change events relayed. Host replays at fixed 8 Hz logical tick (interp rendered at rAF).
- **Depth scaling:** tick rate 8→14 Hz; QUOTA 4→9; from diff≥3 border walls become moving spike columns
  (telegraphed one tick ahead with a 400 ms amber tint); diff≥5 food expires after 6 s (blinks final 2 s).
- **Fairness:** death flash is a localized body-shatter particle burst; swipe dead-zone 24 px so tremor
  input doesn't missteer; first 3 s frozen with control legend overlay.

## 2. `tetris-drop` — "THE WELL"

**Feel:** a sprint well. Clear the line quota before the stack eats you or time dies.

- **Surface:** single well canvas, 10 wide × 18 tall, right-side next-piece + quota pips.
- **Controls:** ←/→ move, ↓ soft drop, ↑ or X rotate CW, Z rotate CCW, Space hard drop, P pause (overlay,
  escapable, pauses BOTH timer and gravity); touch = on-canvas button row (◀ ▶ ⟳ ▼ DROP) ≥44 px.
- **Win/Lose:** clear `QUOTA` lines → win early; stack tops out → lose early; 45 s cap.
- **StageResult:** `correct = (lines >= QUOTA)`; `points = 60 + 45·lines + (win ? 70 : 0)`
  (typ. 105–340); `hpDelta = lines === 0 ? −15 : 0` (partial credit never hurts hp); summary `"x LINES"`.
- **Determinism:** PATTERN Q, and the cheapest one: the piece QUEUE is pure `ctx.rng` (7-bag shuffle), so
  host and client hold identical sequences — the relay carries ONLY move/rotate/drop events. Host replays
  them at 60 Hz gravity steps. This is the canonical example of "seeded world makes relay tiny".
- **Depth scaling:** QUOTA 2→6; gravity step 900 ms→220 ms; diff≥3 adds 1 seeded garbage row at 33%/66%
  elapsed (announced by a 700 ms bottom-row glow BEFORE rising — telegraph); diff≥5 hides next-piece.
- **Fairness:** line-clear flash ≤160 ms well-localized; lock-delay 300 ms so imprecise touch drops don't
  insta-kill; topout requires 2 consecutive ticks above the rim (grace).

## 3. `pacman-maze` — "GLUTTON"

**Feel:** eat the maze. Ghosts hunt. One life, one maze, forty seconds.

- **Surface:** fixed 19×15 tile maze (one authored layout + its horizontal mirror, chosen by `ctx.rng`),
  rendered on canvas; pellets, 4 power-pellet corners, tunnel wraps left↔right.
- **Controls:** Arrows/WASD (turn buffered at intersections, classic cornering); touch = swipe steering.
- **Win/Lose:** eat ALL pellets → win; touched by a non-frightened ghost → lose; 40 s cap (survive with
  ≥85% pellets = win at the cap).
- **StageResult:** `correct = cleared || (pellets ≥ 0.85·total at cap)`; 
  `points = 2·pellets + (cleared ? 120 : 0) + 50·ghostsEaten` (typ. 90–330); 
  `hpDelta = caught ? −15 : 0`; summary e.g. `"MAZE DEVOURED"`.
- **Determinism:** PATTERN Q. Ghost AI is a finite state machine whose every intersection coin-flip comes
  from `ctx.rng` in a FIXED draw order (ghost id × tick) — identical on all tabs. Relay = direction
  events only. Power-pellet frighten windows are pure functions of tick count, hence replay-exact.
- **Depth scaling:** ghosts 1→4 (diff 1/2/3/4+); ghost speed 0.8→1.05× player; frightened duration
  6 s→2.5 s; diff≥4 ghosts alternate chase/scatter faster (scatter 7 s→4 s).
- **Fairness:** ghosts have visible eye-direction and a 16 px personal-space halo; contact hitbox is 60% of
  sprite (forgiving); death is a deflation animation (no strobe); tunnel escape always available.

## 4. `doom-corridor` — "THE CORRIDOR"

**Feel:** raycast corridor crawl. Find the exit, gun down what blocks it, grab medkits and shells.

- **Surface:** canvas raycaster at 320×200 internal resolution upscaled (image-rendering: pixelated);
  column cast over a seeded map. HUD: health pips, shell count, mini compass arrow pointing to exit.
- **World gen:** 16×16 grid maze from `ctx.rng` (recursive backtracker, then knock 6 extra walls),
  exit cell placed far from spawn; `K` demons, `M` medkits, `A` ammo caches at seeded dead-ends.
- **Controls:** WASD/arrows (strafe on A/D, turn on ←/→ or mouse-x drag), Space/left-click fire;
  touch = left virtual stick (move) + right FIRE button. E not needed — walking over a pickup takes it.
- **Win/Lose:** reach exit cell → win; demon melee reduces internal HP pool (starts 100); pool ≤0 → lose;
  45 s cap (at cap: win if within 3 tiles of exit, else `null` partial — see below).
- **StageResult:** `correct = exited ? true : (dead ? false : null)`; 
  `points = 140 + 60·kills + (exited ? 80 : 0) − 10·shotsMissed` (floor 0, typ. 140–380); 
  `hpDelta = clamp(medkits·(+8) − deathsHits·(−5), −15, +15)` — THE healing mode: medkits bank real hp,
  capped so a great run nets +15; summary `"EXITED — 3 DEMONS DOWN"` / `"CONSUMED BY THE CORRIDOR"`.
- **Determinism:** PATTERN Q. Map/pickups/demon patrol waypoints all from `ctx.rng`; demon activation and
  hit resolution are functions of (position, tick, shot angle) — host replays the input stream
  (move vectors quantized to 50 ms buckets + shot events `{tick, angle}`) and re-derives hits.
- **Depth scaling:** demons 2→6, demon speed 0.6→1.0× player; maze exits farther (backtracker branch
  pruning reduced); diff≥4 ammo scarce (must land ≥50% or melee-only); `dim:'3d'/'4d'` Align slices shrink
  torch radius 30%/50% (darkness is atmosphere, never hides the compass).
- **Fairness:** muzzle flash is a 90 ms weapon-local bloom (not fullscreen); damage feedback = red edge
  vignette ramp (no strobe); demons emit a positional growl + outline pulse 400 ms before lunging;
  `IQB_MOTION=false` kills view-bob and head-tilt.

## 5. `battleship-volley` — "SALVOS"

**Feel:** duel the shadow fleet. Their waters are hidden; every shell either sings or drowns.

- **Surface:** two 8×8 grids side by side (enemy left, yours right, drawn canvas + hit ripples). Enemy
  fleet: 1×4, 2×3, 2×2 (9 occupied cells) placed by the HOST via `ctx.rng` and kept secret.
- **Controls:** pointer click/tap a water cell to fire; keyboard = type column letter+row number
  (`a1`…`h8`, Enter); touch = same tap. 3 shells per salvo, 4 salvos = 12 shells max.
- **Flow:** fire 3 → enemy salvo resolves (see determinism) → repeat ×4 or until fleet sunk.
- **Win/Lose:** sink all enemy ships within 12 shells → win; end of salvos with ships alive → partial.
- **StageResult:** `points = 40·hits + 120·shipsSunk + (allSunk ? 60 : 0)` (typ. 80–420); 
  `correct = allSunk ? true : (hits ≥ 5 ? null : false)`; 
  `hpDelta = −5·(enemy ships still afloat at end), floored at −15, telegraphed ("TWO HUNTERS REMAIN —
  THEY WILL BITE")`; summary `"FLEET SUNK — 9/9"`.
- **Determinism:** PATTERN V — the closest cousin of today's puzzle flow, and the reference
  implementation of the sanitizeRound rule for stages: the round payload contains grid dims + shell count
  ONLY. Each shot is one frame `{t:'stageShot', n, r, c}`; host replies `{t:'stageVerdict', n, r, c,
  hit, sunk, shipId?}` immediately (sub-frame latency, feels instant). Enemy return fire is generated
  from `ctx.rng` in fixed order (hunt/target algorithm, deterministic given hit history) and broadcast as
  `{t:'stageSalvo', cells:[…], dmgScore}` so all tabs render identical incoming fire.
- **Depth scaling:** diff 1–2: enemy never fires back; diff≥3: enemy returns 1 shell/salvo costing
  −20 points per hit on your water; diff≥5: 2 shells/salvo and −5 hp per hit on your water
  (both announced by a 400 ms targeting reticle on the threatened cell BEFORE impact — telegraphed).
- **Fairness:** no timers within a salvo (thinking time is free, the 35 s cap bounds the round);
  colorblind-safe markers (hit = filled ring + ✗ glyph, miss = dot, not hue alone).

## 6. `slime-gun-gallery` — "SLIME GALLERY"

**Feel:** carnival booth. Slimes pop, you splat. Decoys wear crowns — shooting those COSTS you.

- **Surface:** painted booth backdrop (CSS/SVG), 9 lanes (3×3 portholes). Crosshair follows pointer.
- **Spawn schedule:** built entirely from `ctx.rng` at round start: ~26 pops over 30 s, each
  `{lane, tMs, type, upMs}` where type ∈ normal(70%) / decoy(20%) / gold(10%). The schedule is PUBLIC —
  shipped identically to every tab (reflex game; hiding it would only enable host cheats, not prevent them).
- **Controls:** click/tap lane (pointer position → nearest lane); keyboard 1–9 fires the matching lane.
  Cooldown 250 ms between shots (recoil), shown as a crosshair ring refill.
- **Win/Lose:** no lose state; score-attack. Round ends at cap.
- **StageResult:** `correct = hits ≥ 12 ? true : (hits ≥ 6 ? null : false)`; 
  `points = 25·normalHits + 80·goldHits − 30·decoyShots − 10·escapes` (floor 0, typ. 100–380); 
  `hpDelta = escapes ≥ 6 ? −10 : 0` (only sustained neglect hurts, telegraphed by the booth dimming);
  summary `"23 SPLATS · 2 GOLD"`.
- **Determinism:** PATTERN V-lite ("event validation", recommended template for all reflex modes):
  schedule is shared, so the relay is only shot events `{t:'stageShotEvent', n, lane, tick}` (~20 per
  round). Host validates each against the public schedule — hit iff `|tick − tMs| ≤ 180 + slack(diff)`
  and lane matches — and scores authoritatively WITHOUT running a sim. Cheapest honest pattern that
  exists; no lockstep, no replay.
- **Depth scaling:** up-window 1100 ms→550 ms; decoy ratio 10%→30%; double-pops (two lanes at once)
  from diff≥3; diff≥5 gold slimes flee after 700 ms.
- **Fairness:** hit window generous (±180 ms baseline); splat effect is per-lane particles (never
  fullscreen flash); crosshair always visible; decoys are marked with a crown icon readable at 12 px.

## 7. `slot-machine` — "ONE-ARMED GOD"

**Feel:** three spins. Stop each reel yourself. The house is the Shadow; sometimes it pays.

- **Surface:** 3-reel cabinet (canvas), paytable printed beside it, credits meter = live points preview.
- **Reel strips:** 3 fixed public strips of 20 symbols each (weights differ per reel), stored in the mode
  file. Symbol set themed per Align: `bad/chaotic` injects the cursed skull (pays nothing, breaks
  pairs); `good` injects the star (wildcard).
- **Controls:** Space / click / tap = STOP the currently spinning reel (one press per reel, 3 presses per
  spin, 3 spins). Keyboard fallback: Enter = same as Space. Nothing else to learn.
- **Spin math:** while spinning, reel position advances one symbol per 40 ms tick. When the player presses
  stop, the landing offset = `(currentTickIndex · 7 + reelSalt) mod 20` — a PURE function of the pressed
  tick index and `ctx.rng`-derived salt, so both sides compute the identical landing from the relayed tick.
- **StageResult:** `correct = totalPayout ≥ 3·stake ? true : (totalPayout > 0 ? null : false)`; 
  `points = totalPayout` where stake = 20/spin and paytable pays 0–260 per spin (jackpot triple-star =
  600 total, the one sanctioned 500-cap breach); 
  `hpDelta = jackpot ? +10 : (totalPayout === 0 ? −10 : 0)` — rare heal, telegraphed by the cabinet
  glowing green on jackpot-line anticipation; summary `"THE GOD PAYS 240"` / `"THE HOUSE WINS"`.
- **Determinism:** PATTERN Q-scalar: relay is exactly 9 numbers per round
  (`{t:'stageStops', n, ticks:[t1..t9]}`) — smallest possible input-relay. Host recomputes payouts.
  Client renders its OWN result immediately (feels responsive) and reconciles silently if the host's
  authoritative `StageResult` differs (it won't, the math is pure).
- **Depth scaling:** stake 20→60; paytable tightens (top pair pays 40→15); cursed skull frequency
  0%→25%; diff≥5: third spin is "double or nothing" (auto-staked, clearly labeled).
- **Fairness:** reels DECELERATE visibly for the final 5 symbols (landing is honest, no snap-cut);
  `IQB_MOTION=false` replaces spinning with instant per-symbol flips; paytable always on screen;
  near-miss framing is forbidden in copy (no "SO CLOSE" taunts — Shadow quips may fire but never
  claim the outcome was rigged either way).

---

## 8. Engine wiring notes (for the Stage refactor, not this doc's scope to implement)

- Weight suggestion for the director: puzzle 0.70 early → 0.55 deep; remaining mass split
  snake .06, tetris .06, pacman .05, corridor .04, battleship .04, gallery .03, slot .02 (tune in balance).
- Hooks precedence: `onRoundStart` mods (timer deltas, banners, scoreMul) apply BEFORE `mountAsync`;
  `onAnswer`/`onReveal` fire AFTER resolve with `res` synthesized from the StageResult
  (`res.correct = result.correct`, `res.picked = -1`). Packs therefore flavor stages without knowing them.
- Emerald interlude (every 4th depth) and Cleanse remain OUTSIDE stage selection, exactly as today.
- Review/accolades: stage rounds call `IQ.Review.snap({round, boardSVGString:'', options:[],
  ord:[], correctIdx: result.correct===true?0:(result.correct===false?-1:-99), pickedIdxByUid:{me:0},
  timesMsByUid:{}})` — accolades that count correctness keep working unchanged.
- New frame types (`stageInput`, `stageShot`, `stageVerdict`, `stageSalvo`, `stageShotEvent`,
  `stageStops`, `stageAck`) ride the existing `IQ.Net.on/send/broadcast` plumbing; all are ignored by tabs
  not in the matching stage round (`if(pl.n !== G.round) return`), matching the idempotence guard already
  used for `reveal`.
