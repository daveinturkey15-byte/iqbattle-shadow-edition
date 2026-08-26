# V2 TAKEOVER BALANCE SWEEP — points curves vs puzzle par

Date: 2026-08-26 · Auditor: BalanceSweep · Scope: ALL 20 mounted takeover scenes
(11 mounted `MOUNTED_STAGE_IDS` + 9 port `PORT_STAGE_IDS`, `v2/src/meta/onboard.ts:55-82`).
READ-ONLY audit — no game files touched.

## Method

- **Par** `parFor(d) = 100*d + 40` — `v2/src/scenes/takeovers/floorfall.ts:55`.
- **Difficulty** `diff = clamp(1 + floor(depth/6), 1, 5)` — mirrors `main.ts:349`
  (`dealPuzzle`). Depth windows: d1 = 1–5, d2 = 6–11, d3 = 12–17, d4 = 18–23,
  d5 = 24+ (runs plan up to 2000 depths, `main.ts:193`, so depth is effectively
  unbounded while par clamps at 540).
- **Band**: a canonical win should pay 60 %–135 % of par
  ([84,189] / [144,324] / [216,486] / [264,594] / [324,729]).
- **Timeout rule**: timing out must never pay more than any winning line.
- Canonical win = the scene's own documented quota/full-clear success at honest
  play; best/worst achievable under the rules noted where they cross the band.
- MP cross-check: `mp.ts:196` `srCeiling` shaves verdict points above
  `100*diff+40` in multiplayer — any SP curve over par is silently nerfed in MP,
  so over-par curves are also SP/MP economy divergences, not just generosity.

## Scoreboard

| # | Scene | File | Win formula (canonical) | d1 | d2 | d3 | d4 | d5 | Verdict |
|---|-------|------|--------------------------|----|----|----|----|----|---------|
| 1 | RED LIGHT | redlight.ts | 120 banked + 50 + 20·**depth** | 136 % | 138–163 % | 114–142 % | 114–143 % | 128–143 % | **FAIL over** |
| 2 | TIDE POOL | tidepool.ts | TP_PAY tier indexed by **raw depth** | 93 % | 143–192 % | 128 % | 105 % | 85 % | **FAIL over** |
| 3 | SERPENT | serpent.ts | (12+depth)·15 + min(40+20·depth, 200) | 182 % | 179–227 % | 156–176 % | 148–165 % | 137–151 %+ | **FAIL over** |
| 4 | FLOOR-FALL | floorfall.ts | par·(0.45+0.55·leftFrac) [+25] | 45–132 % | … | … | … | 46–105 % | PASS (tail note) |
| 5 | HUNTER-DODGE | hunterdodge.ts | same [+40 ghost] | 64–129 % | … | … | … | 52–105 % | PASS (tail note) |
| 6 | LASER-STORM | laserstorm.ts | same [+20 threaded] | 59–114 % | … | … | … | 49–105 % | PASS (tail note) |
| 7 | DRONE SWARM | dronedodge.ts | same [+15·guards, ≤2] | 56–121 % | … | … | … | 49–105 % | PASS (tail note) |
| 8 | SABER CLASH | saberclash.ts | 80 + 20·**raw depth** | 71 % | 83–125 % | 89–117 % | 100–123 % | 104 %→141 %+ | **FAIL deep-run over** |
| 9 | ONE-ARMED GOD | slots.ts | luck pay, flat CAP 500 | pair 7 % … jackpot 357 % | … | jackpot 139 %+ | 113 % | 93 % | **FAIL** |
| 10 | SLIME GALLERY | slimegallery.ts | normalized: quota-min = par exactly | 100 % | 100 % | 100 % | 100 % | 100 % | PASS (cap note) |
| 11 | THE WELL | well.ts | 30 + quota·(22+2·min(depth,8)) + 50 | 126–171 % | 118–144 % | 107–117 % | 96 % | 78 % | **FAIL over** |
| 12 | PACMAN2 | pacman2.ts | pellets·diff + 40+20·diff + ghosts·30·diff | 99 % (ghost-heavy 142 %) | 99 % | 99 % | 99 % | 99 % (ghost-heavy 210 %) | PASS (ghost note) |
| 13 | TETRIS2 | tetris2.ts | 30 + q·(10+6·diff) + 50 + 2·min(depth,30) | 104–121 % | 94–107 % | 92–101 % | 96–98 % | 91–93 % | PASS |
| 14 | DOOM2 | doom2.ts | kills·(20+5·diff) + 60+15·diff | 125 % | 100 % | 88 % | 91 % | 92 % | PASS |
| 15 | BATTLESHIP2 | battleship2.ts | hits·(5+4·diff)+sunk·(12+6·diff)+allSunk | 129 % | ~110 % | ~100 % | ~95 % | 89 % | PASS |
| 16 | PHOENIX2 | phoenix2.ts | TIER_POINTS[0,20,55,90] + 5·depth | II 43 % · III 68 % | II 35 % · III 50 % | II 32 % · III 42 % | II 33 % · III 42 % | II 32 % · III 39 % | **FAIL under** |
| 17 | GAUNTLET2 | gauntlet2.ts | passes·30 − fails·10 (flat) | 86 % | 50 % | 33 % | 27 % | 22 % | **FAIL under** |
| 18 | FRACTAL2 | fractal2.ts | 60 + 5·depth [+30 deep] (single solve) | 46–68 % | 38–50 % | 35–42 % | 36–42 % | 34–39 % | **FAIL under** |
| 19 | HYPERCUBE2 | hypercube2.ts | 65 + 5·depth (single solve) | 50 % | 38 % | 35 % | 36 % | 34 % | **FAIL under** |
| 20 | SNIPER2 | sniper2.ts | confirms·18 + 5·depth − 5·pings | 55–69 % | 65–75 % | 57–64 % | 53–59 % | 49–54 % | **FAIL under** |

**Tally: 11 PASS / 9 FLAGGED** (5 over-par: redlight, tidepool, serpent, well,
slots-jackpot + saberclash deep runs; 5 under-par: phoenix2, gauntlet2,
fractal2, hypercube2, sniper2).

---

## Flagged outliers — exact constants and recommendations

### OVER-PAR (players earn more than a solved puzzle ever could; MP shaves it)

**F1 · redlight.ts — rider scales with raw depth, bank is flat**
Win: `banked + 50 + ctx.depth * 20` (`redlight.ts:301`), banked =
`QUOTA * BANK_PER_SOLVE = 3 * 40` (`redlight.ts:190-191`).
Depth 2 already pays 210 vs par 140 (**150 %**); depth 5 pays 270 (**193 %**);
past depth ≈ 16/22/29 each window overshoots again and pay grows unbounded.
Fix: tie both terms to diff —
`redlight.ts:191`: `const BANK_PER_SOLVE = 40` → per-mount
`Math.round(parFor(diffFor(ctx.depth)) * 0.4)` (import `parFor` from
floorfall.ts, add local `diffFor`), and `redlight.ts:301`:
`points: banked + 40 + diffFor(ctx.depth) * 20`.
Result: 60·d·0.4·… lands ≈ 86–81 % of par across all five windows.

**F2 · tidepool.ts — pay tiers indexed by raw depth instead of diff tier**
`TP_PAY = [130, 200, 280, 370, 460]` (`tidepool.ts:35`), mounted as
`payFor(ctx.depth)` (`tidepool.ts:196`). Depth 5 still sits in diff 1 but pays
460 vs par 140 (**329 %**); the whole d2 window pays 192 %. The table itself is
perfectly tuned — **as diff tiers**: 130/140 = 93 %, 200/240 = 83 %,
280/360 = 78 %, 370/440 = 84 %, 460/540 = 85 %.
Fix (one line): `tidepool.ts:196` →
`const pay = payFor(Math.min(5, Math.max(1, 1 + Math.floor(ctx.depth / 6))));
` (+`BONUS_DRY 15` keeps the worst case at 104 %, in band).

**F3 · serpent.ts — double raw-depth scaling (quota AND bonus)**
`quota(depth) = 12 + depth` (`serpent.ts:37-39`), `surviveBonus =
min(40 + depth*20, 200)` (`serpent.ts:45-47`), `APPLE_PTS = 15`
(`serpent.ts:75`), win at `serpent.ts:175`. Depth 1 already pays
13·15+60 = 255 vs par 140 (**182 %**) and EVERY window is over; pay grows
without bound (~181 % again at depth 40).
Fix: normalize the apple to diff — at mount compute
`applePts = Math.max(4, Math.round(parFor(diffFor(ctx.depth)) / N))`
(replaces constant `APPLE_PTS` use at `serpent.ts:175,186`) and
`serpent.ts:46`: `return Math.min(60, 20 * diffFor(depth));`.
Result: 87–116 % across all windows; timeout harvest stays strictly < win.

**F4 · well.ts — line value scales with raw depth inside a frozen-diff window**
`line value = 22 + 2*min(depth, 8)` (header `well.ts:16`),
win `BASE_PTS + lines*lp + WIN_BONUS` (`well.ts:189`), quota `4+floor(depth/3)`
clamp 9 (`well.ts:63-65`). Depths 3–5 pay 220/230/240 vs par 140
(**157/164/171 %**); depths 9–11 pay 346 vs par 240 (**144 %**).
Fix: cap at the band top exactly like the ports already do —
`well.ts:189` → `points: Math.min(BASE_PTS + lines * lp + WIN_BONUS,
takeoverBandCap(diffFor(depth)))` importing `takeoverBandCap`
(`popglitter2.ts:56-59`; consider re-homing next to `parFor` in floorfall.ts).
Depth 5 then pays the 189 cap = 135 % (boundary-inclusive, matches ports).

**F5 · slots.ts — flat POINTS_CAP 500 ignores diff**
`POINTS_CAP = 500` (`slots.ts:151`), `verdictFor` caps there
(`slots.ts:160-164`), jackpot `250 + 350*diff` = 600 at diff 1
(`slots.ts:99`). A d1 jackpot pays 500 vs par 140 (**357 %**); d2 window
208 %; d3 139 %. Secondary: any single pair pays 10 at d1 → a "win"
at **7 %** of par (band floor 60 %).
Fix: `slots.ts:151` → export a function
`pointsCap(diff) { return Math.min(480, Math.round((100*diff+40) * 1.35)); }`
(i.e. reuse `takeoverBandCap`) and call `verdictFor(total, jackpot,
diffFor(ctx.depth))` at `slots.ts:352`. For the floor: either scale `pair` up
at low diff or require ≥2 paid lines before `correct: true`.

**F6 · saberclash.ts — win scales with raw depth forever**
`verdictFor`: `80 + 20 * depth` (`saberclash.ts:139`), called with raw
`ctx.depth` (`saberclash.ts:212`). In-band through depth ≈ 32 (133 %), then
**137 %+ at depth 33**, 148 %+ at 36+, unbounded.
Fix: `saberclash.ts:139` →
`points: Math.min(80 + 20 * depth, Math.round((100 * diffFor(depth) + 40) * 1.25))
` (and mirror-cap the partial `25 + 8 * depth`), with `diffFor` shared as above.

### UNDER-PAR (winning a takeover is strictly worse than the puzzle it replaced)

**F7 · phoenix2.ts — fixed tier table + token depth rider**
`TIER_POINTS = [0, 20, 55, 90]`, rider `+depth*5` (`phoenix2.ts:92-99`).
Tier II is a WIN (`correct: tier >= 2`) yet pays 43 %→32 % of par; even a
flawless Tier III peaks at 68 % (d1) and falls to 39 % (d5).
Fix: fraction-based payout — `phoenix2.ts:96-101` →
`points: Math.round(parFor(diffFor(depth)) * [0, 0.35, 0.8, 1.05][tier])`
(Tier II win ≈ 80 %, Tier III ≈ 105 %, all windows green).

**F8 · gauntlet2.ts — flat pay, no diff term at all**
`aggregate`: `passCount * 30 - fails * 10` (`gauntlet2.ts:104`), max 120.
In band ONLY at diff 1 (86 %); diff 5 all-pass pays **22 %**.
Fix: thread diff in — `gauntlet2.ts:96` signature `aggregate(passes, diff)`,
`gauntlet2.ts:104` →
`points: Math.round(passCount * (100 * diff + 40) / 4) - fails * 10`;
call site `finish()` (`gauntlet2.ts:205-208`) passes
`diffFor(ctx.depth)` (add the helper locally). All-pass = 100 % of par,
3-pass ≈ 73 % — in band. Update the four pinned selfTest expectations at
`gauntlet2.ts:405-412` accordingly.

**F9 · fractal2.ts — single solve pays 60 + 5·depth**
`fractal2.ts:246`: `60 + ctx.depth * 5 + (deepReader ? DEEP_BONUS : 0)`
(`DEEP_BONUS = 30`, `fractal2.ts:48`). Best case 46 %→39 % of par through the
whole realistic curve. Also fails wrong-answer parity: `-30` vs engine `-40`.
Fix: `fractal2.ts:246` →
`const points = right ? Math.round(parFor(diffFor(ctx.depth)) *
(deepReader ? 1.1 : 0.95)) : -40;` (95–110 %, Deep Reader stays the max-play
bonus without breaking 135 %).

**F10 · hypercube2.ts — same flat curve, worst offender**
`hypercube2.ts:292`: `65 + ctx.depth * 5` → 50 % at depth 1, **34 %** in the
d5 window; fail `-30` parity miss too.
Fix: `hypercube2.ts:292` →
`points: right ? Math.round(parFor(diffFor(ctx.depth)) * 1.0) : -40`.

**F11 · sniper2.ts — per-confirm pay too small for the quota curve**
Win `confirmed * 18 + ctx.depth * 5 - wrongPings * 5` (`sniper2.ts:221`),
quota 4→8 (`sniper2.ts:54-56`). Undershoots at d1 (55 %), recovers mid, then
decays to **49–54 %** in the d5 window.
Fix: derive the per-confirm from par at mount —
`per = Math.ceil(parFor(diffFor(ctx.depth)) / (quota(ctx.depth) * 1.1))`,
`sniper2.ts:221` → `points: confirmed * per - wrongPings * 5`.
Quota-exact win ≈ 91 % of par; +3 overconfirm headroom stays ≤ 117 %.

### Secondary notes (not band failures, worth knowing)

- **pacman2.ts ghost snowball**: 4 hunters × `30*diff` on top of a full clear
  reaches ~142 % (d1) / ~210 % (d5) — `pacman2.ts:18,343-353`. Same
  `takeoverBandCap(diff)` cap as F4/F5 would close it without touching the
  pellet curve (which is otherwise exemplary: 99 % at every diff).
- **slimegallery.ts flat cap 500** (`slimegallery.ts:63`): the normalization
  (`scoreRound`, `slimegallery.ts:149-166`) is the model citizen — quota-min
  play = exactly 100 % of par — but gold-heavy runs can ride raw·scale past
  135 % at low diff before the flat 500 cap. Swap cap → `takeoverBandCap(eff)`.
- **Dodge-family low tail**: floorfall/hunterdodge/laserstorm/dronedodge wins
  pay `par*(0.45+0.55*leftFrac)` + bonus — a win earned in the last quarter of
  the timer can land 45–59 % (below band floor) when the skill bonus is missed.
  By-design risk/reward; if Main wants the floor honored, raise the intercept
  0.45 → 0.52 in the four `pick()` handlers (floorfall.ts:275 area,
  hunterdodge.ts:260, laserstorm.ts:250, dronedodge.ts:291).
- **metal2/popglitter2** cap = exactly `round(par*1.35)`
  (`popglitter2.ts:56-59`, pinned by selftest `popglitter2.ts:540`) — the band
  top is boundary-inclusive here; treat as the reference implementation.

---

## Wave-fix verification

- **Timer budgets (FixTimers rail) — LANDED everywhere checked**: redlight
  cadence budget `timerLen*1000 − 700` (`redlight.ts:90`); slots F5 worst-path
  scaling (`slots.ts:66-73`, selftest sweeps tl = 1..120 at `slots.ts:490`);
  saberclash F4 ring budget (`saberclash.ts:53-56`, selftest `:380`); gauntlet2
  trial budgets (`gauntlet2.ts:52-54`, selftest `:400`); dronedodge
  `SETTLE_MS` reserve (`dronedodge.ts:47,237-238`); slimegallery F6 settle
  budget honors `ctx.timerLen` (`slimegallery.ts:272`, regression test
  `:540+`); serpent/redlight always self-resolve before the engine timer.
- **PortA/PortB/Retro port budgets**: pacman2, tetris2, battleship2, doom2
  landed **in band** (99/91–121/~100–129/88–125 % respectively) with their own
  band selftests (tetris2.ts:446-455, pacman2.ts:585-591,
  battleship2.ts:474-483). The four remaining retro ports (phoenix2, gauntlet2,
  fractal2, hypercube2, sniper2) shipped flat/raw-depth curves — see F7–F11.

## Timeout-never-optimal sweep — CLEAN

Every scene's timeout/Esc/neutral branch pays strictly less than its own win
branch with identical progress: redlight `banked` < banked+50+rider;
serpent `apples*15` < apples*15+bonus; pacman starve = ½bank < clear;
battleship partial lacks `allSunk` bonus; doom lost-path lacks exit bonus;
tetris2/well partials pay ½ line value; sniper timeout pays ½ per-confirm
(`sniper2.ts:326`); dodge quartet timeouts/fails pay 0; fractal/hypercube/
phoenix/gauntlet Esc → `escaped()` = 0 pts. No scene rewards stalling.

## Recommended fix order (cheapest first)

1. F2 tidepool (one line, table already correct).
2. F10/F9 hypercube/fractal (one expression each + parity restore).
3. F8 gauntlet (one expression + 4 selftest pins).
4. F1 redlight, F4 well, F6 saberclash (share one `diffFor` + band-cap helper).
5. F5 slots + pacman/slime cap swap (same helper).
6. F7 phoenix, F11 sniper (small per-scene math).
