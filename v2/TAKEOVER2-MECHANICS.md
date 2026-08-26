# TAKEOVER2 WAVE — MECHANICS DOCS

Five narrative/visual takeover ports to the v2 contract (`TakeoverCtx` /
`StageResult`, see `src/scenes/takeovers/redlight.ts`). Each scene: seeded
(mulberry32, fixed draw order), no `Math.random`/`Date.now` (clock = Pixi
shared ticker delta), exactly-once StageResult via `onceResolve`, escapable
(Esc -> neutral `escaped(0,...)`), self-limits to `ctx.timerLen`,
IQB_MOTION-gated ambient motion, one hue per board from `T.boardHues`,
DNA primitive marks only, text >= 11 px, flashes <= 200 ms.

Wiring (Main-owned `main.ts`): import the five `mount*` functions, append to
`TAKEOVERS`, extend `TAKEOVER_NAMES`
(`'SEED RITUAL','FOUR RIDERS','DEEP ZOOM','606D','OVERWATCH'`).
Self-tests: `node --experimental-strip-types src/scenes/takeovers/selftest-takeover2.ts`

---

## PHOENIX2 — 'SEED RITUAL' (`phoenix2.ts`, SALT 0x6e1c3a7)

Phases: PLANT (press starts) -> GROW (hold-release timing) -> BURN (1.6 s,
motion-gated flicker) -> REBORN reveal (1.5 s) -> settle.

- Spurts: `spurtCount(d)=clamp(1+floor((d-1)/3),1,3)`; hold SPACE/mouse, the
  seedling climbs the meter at TRACK_W/1800 px/ms; release inside the glowing
  band `[center±width/2]` = clean spurt. Auto-release (miss) past
  `center+width/2+450 ms` so a stuck hold can never stall the round.
- Bands: centre = 700+rng()*600 ms per spurt (fixed order);
  `bandWidth(d)=max(110,260-18*(d-1))`.
- Payout tiers: III all clean · II strict majority · I any · 0 none.
  `payoutFor`: pts 0/20+d5/55+d5/90+d10; hpDelta 0/0/+4/+10;
  `correct = tier>=2`.
- Motion off: static flame + static band glow; input logic identical.

## GAUNTLET2 — 'FOUR RIDERS' (`gauntlet2.ts`, SALT 0x4f1d5e9)

Fixed-order micro-trials, ~timerLen/4 each (cap 8 s, floor 2 s):
1. CONQUEST — click the crown bearing the demanded tri-count (3 crowns,
   distinct counts, blessed index seeded).
2. WAR — mash SPACE/tap to `warQuota(d)=min(40,12+3d)` inside budget.
3. FAMINE — one shot: click the smallest of four distinct dot-share portions.
4. DEATH — stillness vigil 3 s; ANY key/pointer resets the countdown; its 3 s
   identity is never cut by a short trial budget.
Aggregation: passes>=3 -> correct; points = 30·passes − 10·fails;
hpDelta = −3·fails; summary marks C/W/F/D. Timer overrun scores what stands.

## FRACTAL2 — 'DEEP ZOOM' (`fractal2.ts`, SALT 0xd00dfe1)

- Backdrop: Julia set escape-time buffer (176×99, ITER 22) painted into a
  canvas texture (~30 fps refresh), upscaled full-stage; one-hue ramp only.
  Seeded c-point (`cPointFor`) kept out of the cardioid core; view shrinks
  geometrically (`makeZoom`: scale halves ~every beat, deeper = faster).
- The STABLE ISLAND (150 px glyph, n triangles over diamond) carries the
  question count; four option tiles carry distinct counts (spread widens with
  depth: `min(3, 1+floor(d/4))`). Click to answer.
- STABILIZE: hold SPACE freezes zoom advance, draining a 1200 ms pool per
  use, max 2. Zero-stabilize answer with motion ON = +30 DEEP READER bonus.
- Scoring: correct 60+d5 (+30 bonus); wrong −30 pts/−8 hp; Esc/timeout neutral.
- IQB_MOTION=0: ONE static keyframe; stabilize inert; Deep Reader disabled.

## HYPERCUBE2 — '606D' (`hypercube2.ts`, SALT 0x7e55ba11)

- Real tesseract geometry: 16 sign-vector vertices, 32 edges (differ in
  exactly one coordinate, every vertex degree 4). Closed-form projection:
  rotate XW then YZ planes, w-perspective f=D/(D−w), fixed X-tilt.
- Ambient dual-plane spin 0.22 rad/s (motion-gated); DRAG adds damped angular
  velocity to steer candidate tiles toward readable projections.
- Question: header count n (dots over diamond); 4 option tiles CLING TO
  projected vertices (seeded spread assignment [0,7,10,13,5,2,8,14]->4),
  riding the rotation; always clickable.
- H GOGGLES: max 2 uses; unfolds options to flat-net slots for 5 s
  (rotation paused, tiles static). Motion-off: permanent net layout, H inert.
- Verdict on click: correct 65+d5; wrong −30/−8 hp; timeout/Esc neutral.

## SNIPER2 — 'OVERWATCH' (`sniper2.ts`, SALT 0x0ff1ce5)

- Field: `density(d)=min(48,26+2d)` tiny figures on a shuffled 20×8 grid
  (never overlapping, inside FIELD rect). Figure = shoulders line + diamond
  body + head-dot row; the DOT COUNT (3..7) is the kind. Exactly
  quota+3 figures match the answer kind, so the round is always winnable.
- Scope: 95 px lens follows the mouse; dim layer alpha 0.13 everywhere, crisp
  layer masked to the lens circle. Seeded two-sine wobble (amp 14 px,
  bounded) until steadied.
- BREATH: hold SPACE up to 2000 ms (wobble -> 0), then forced 1200 ms exhale.
- CONFIRM: click near the nearest unconfirmed figure within 85% of SCOPE_R.
  Right kind: +progress, green <=200 ms ring flash. Wrong kind: sting (−5 at
  payout, red flash). Whiff: free. `quota(d)=clamp(4+floor(d/2),4,8)`.
- Win: correct true, points 18·hits + d5 − 5·wrongPings. Timeout: neutral
  partial (9·hits). IQB_MOTION=0: wobble removed entirely.
