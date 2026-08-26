# V2 Layout Audit — IQ Versus: SHADOW (READ-ONLY visual gauntlet)

Auditor: LayoutAudit · Date: 2026-08-26 · App: http://127.0.0.1:8792 (hub iqbattle-v2, vite :8792)
Method: headless Chromium 151 via raw CDP; three emulated viewports (1024×576, 1920×1080, 2560×1440, deviceScaleFactor 1).
Stage is a fixed 1600×900 logical space letterbox-fitted (v2/src/theme.ts:24-26, main.ts fit()); all coordinates below are STAGE px unless marked css.
Canvas rect per viewport verified from live page: 1024→1024×576 (scale 0.64), 1920→1920×1080 (1.2), 2560→2560×1440 (1.6) — exact 16:9 fit, no letterbox bars anywhere.
Clicks: CDP Input.dispatchMouseEvent at stage→css mapped points. Screenshots: research/v2-gauntlet/shots/<viewport>/<scene>.png; state log: layout-log.jsonl; driver: layout-driver.cjs (rev8).

Severity: BLOCKER = broken/unusable · MAJOR = DNA contract violation or element escape/overlap · MINOR = polish.

---

## 0. Cross-cutting (affect every in-run scene)

| # | Sev | Finding | Evidence (file:line) | Screenshot + coordinate (stage px) |
|---|-----|---------|----------------------|-------------------------------------|
| X1 | BLOCKER | In-run scenes paint a full-stage opaque bg sprite that buries Shell chrome: room title, LEAVE, LOBBY link, gradient timer bar, and Shell sidebar/player cards are all invisible during play. The player cannot leave a run (no live LEAVE control) and the DNA header/status contract is only half-present. Nuance: takeover rounds keep header/strip visible (their bg starts at y164) but bury the sidebar instead — see §3b T1. | v2/src/scenes/game.ts:12-14 bg added AFTER Shell.attach (v2/src/main.ts:212); same pattern in takeovers, e.g. redlight.ts:210-213 (box at 40,164 + own full bg) | shots/1024x576/game-d1.png — no LEAVE anywhere; header shows only static LOBBY/PRIVATE ROOM texts (game.ts:17-18) |
| X2 | MAJOR | Status strip shows wrong state forever: DEPTH always "DEPTH 1" (main.ts dealPuzzle→buildGameScene(p, cb) never passes depth; default =1 at game.ts:8), timer text hardwired "01:00" at fixed x=820 (game.ts:23) with no countdown driver ((strip as any).__timer at game.ts:24 has no reader — grep: only write site). DNA requires live "Round N/M + MM:SS + gradient bar". | game.ts:22-24; main.ts:dealPuzzle | shots/1024x576/game-d2.png — strip reads "DEPTH 1" + "01:00" while round 2 is live; strip panel (40,70)-(960,144), timer right edge x≈880 vs DNA right-pad 896 (16px misalignment) |
| X3 | MAJOR | Options grid overflows the board panel bottom on every multi-row board: panel is (40,164,920,640) → bottom edge y=804 (game.ts:27). Options row tops: oy=164+40+rows·(cell+14)+36; rows=3 (cell 118): row2 spans y768-886 → 82px past panel; rows=2 (cell 150): row2 spans y732-850 → 46px past panel. Row 2 hangs in space below the panel. | game.ts:28-45 (cellSize, oy math), panel h=640 at game.ts:27 | shots/1024x576/game-d1.png — options 5-8 clearly below panel edge (panel bottom css y514; tiles end css y553); shots/1024x576/game-d2.png — options 5-8 end css y521 vs panel 514 |
| X4 | MAJOR | Rule line at (40,840) sits INSIDE the options band (rows=3: options y768-886; horizontal overlap x243-340 vs rule text from x40): rule text renders underneath/behind option tiles 5-6 and is unreadable; not visible in any captured game frame. | game.ts:66 (rule at 40,840); options x243..757 from game.ts:43-44 | shots/1024x576/game-d1.png — bottom-left (40..340, 820..870): no legible rule text; band occupied by option tiles |
| X5 | MAJOR | Sidebar is a dead zone: panel (984,70,576,734) contains only "YOU" (24,20), hardcoded "0" at fixed x=500 (not right-aligned; right edge should be ~552), "shadow awaits" (24,48). No player cards, rank diamonds, avatars, response clocks — DNA sidebar contract (rank/avatar/name/clock/score) unmet; ~684px of empty panel below y~120. | game.ts:58-61 | shots/1024x576/game-d1.png — sidebar (984,70)-(1560,804): content only in top 60px, rest empty |
| X6 | MINOR | Corruption-arc visuals never render in-run: applyArc/sanctuary tint nodes by Pixi label convention (bg…/panel…/tile…), but buildGameScene and takeover scenes create unlabeled nodes, and the 'arc-vignette' node is never mounted, so layer vignettes/sanctuary chrome swaps are no-ops. (Visible consequence: all rounds share identical chrome regardless of arc plan.) | v2/src/scenes/arc.ts:47-60 label convention; game.ts creates unlabeled Sprites | shots/1024x576/game-d1.png vs game-d2.png — identical chrome, only board hue differs |

## 1. Landing (shots/<vp>/landing.png — captured at all three viewports)

| # | Sev | Finding | Coordinate (stage px) |
|---|-----|---------|------------------------|
| L1 | MAJOR | Join-by-code row escapes the Create-A-Room card: card is (560,496,480,330) → bottom y=826; Room code input + JOIN button occupy y806-852 (card-rel y310,h46) → 26px hangs below the card edge. Clearly visible at 1024 and 2560. | landing.ts:14-16 (card cy=496,ch=330), landing.ts:63-64 (row y310) | shots/1024x576/landing.png — input bottom css y546 vs card bottom css y527 |
| L2 | MINOR | JOIN button right edge (abs x960) not aligned with the name/room inputs' right edge (x1000): 40px ragged right rail inside the card. | landing.ts:63-66 (codeIn w=inW-150; JOIN x=inW-100,w=100) | shots/1024x576/landing.png — JOIN pill right css x600 vs inputs right x625 |
| L3 | OK | Hero headline, feature-card row (296..1304, y268-436, 24px gaps), header logo/left-right links: centered and evenly spaced per DNA. | landing.ts:31-60 | shots/1024x576/landing.png |

## 2. Lobby (shots/1024x576/lobby.png, shots/1920x1080/lobby.png, shots/2560x1440/lobby.png)

| # | Sev | Finding | Coordinate |
|---|-----|---------|------------|
| B1 | MINOR | Large dead zone in central panel between player list and button row when solo: panel (440,140,720,620); with 1 player, content ends ~y356 (timer row) and buttons sit at y664-720 → ~300px empty band. DNA "no element floats into empty space" is satisfied but the void reads unbalanced at all viewports. | lobby.ts:36-77 | shots/1024x576/lobby.png — empty band css (275..725, 225..415) |
| B2 | MINOR | Player-card response clock shows "waiting…" in mono at card right (w-24 right-aligned ✓); score "0" right-aligned ✓; rank diamond + avatar + tags present ✓ — lobby matches DNA card spec (unlike in-run sidebar X5). | shell.ts:214-262 | shots/1024x576/lobby.png — card (472,204)-(1128,276) |
| B3 | OK | Header title "Player's Room · C5AUR" properly center-measured (headerBar uses text width); stepper group centered on panel axis; START/LEAVE symmetric 32px insets. | lobby.ts:29, 60-77 | shots/1024x576/lobby.png |

## 3. Game — puzzle rounds, depths 1-6 (shots/1024x576/game-d1.png, game-d2.png; further depths blocked, see §7)

Captured families: d1 = 3×3 count-grid, gold #d4a017; d2 = 2×2 accretion, orange #ff7a1a — one hue per board, primitive marks (triangles/dots/diamonds/line segments), '?' hole cell. DNA visual grammar §1-3 PASSES on both boards; hue wheel rotates per depth (theme.ts boardHues[(depth-1)%6]) ✓.

Layout defects on these scenes: X1-X5 above all apply verbatim. Additional measurements:
- Board cluster is horizontally centered in the left panel (boardW centered via bx=(920-boardW)/2, game.ts:31-32) ✓; board top pad 40px ✓.
- Option index labels (1-8) sit inside tile bottom-left (s.x+6, s.y+optSize-22, game.ts:51) ✓ readable.
- Option grid gaps are 14 stage px (≈9 css px @1024, 17 @1920, 22 @2560): at the 1024 headless default this is below the 12px cramped-gap threshold; DNA ref (1706 wide) implies ~12-15px intent. MINOR at 1024 only. | shots/1024x576/game-d1.png — 9css gap between option rows.
- Header title "PRIVATE ROOM" centered via hardcoded STAGE_W/2-90 (game.ts:18) instead of measured width: rendered string is ~132px wide → true center start x≈734, drawn at x710 → ~22px left of center. MINOR-MAJOR boundary; report MAJOR as it is the pattern DNA calls out (room title center). | shots/1024x576/game-d1.png — title spans css x455-547, canvas center 512, title center ≈501.

## 3b. Game — takeover round (shots/1024x576/takeover-d5.png — SERPENT, live capture)

| # | Sev | Finding | Coordinate (stage px) |
|---|-----|---------|------------------------|
| T1 | MAJOR | Takeover box buries the sidebar: dealTakeover places the box at (40,164) sized 1600×900 (main.ts dealTakeover: box.x=40; box.y=164), so its bg covers x40-1640 × y164-1064 — the Shell sidebar (984,70,576,734) survives only as a 94px sliver above y164; everything below is takeover surface. Header + status strip DO stay visible here (unlike puzzle scenes, cf. X1): title 'PRIVATE ROOM · DEPTH 5' and LEAVE render correctly. | main.ts dealTakeover; redlight-style box pattern | shots/1024x576/takeover-d5.png — sidebar visible only css y45-104 right; below that takeover panel spans full width |
| T2 | MAJOR | Descent layer banner overlaps the status strip: banner text ('the light is very far away', 26px bad-red) renders at y≈120-150, inside the strip band (70-144), and is x-shifted by spec.x-160 (main.ts deal()) so it is not centered either; it visually collides with the strip's gradient timer bar and the takeover caption line beneath. | main.ts deal(): text(root, spec.text, spec.x - 160, 120, 26, T.bad) | shots/1024x576/takeover-d5.png — red text centered ≈ css (512, 87) cutting across strip bottom edge |
| T3 | MINOR | Sidebar player count lies: header shows 'PLAYERS 0' while a solo player is in-run — Shell.addPlayerCard is never called by the solo flow, so no card + wrong count. | shell.ts countLabel; main.ts never calls addPlayerCard outside lobby/preview | shots/1024x576/takeover-d5.png — 'PLAYERS 0' at css (655,63) |
| T4 | MINOR | All takeover content is shifted 40px right of stage center: the box origin (40,164) is treated as (0,0) by takeover scenes (they center on 1600-wide box space), so their 'centered' UI actually centers at x=840. Serpent board measured center ≈ x818 (panel x331-1305). Systematic 40px right bias for every takeover. | main.ts dealTakeover box.x=40 vs takeover-internal STAGE_W/2 centering | shots/1024x576/takeover-d5.png — SERPENT title center css ≈525 vs canvas 512 |
| T5 | OK | Gradient timer bar (pink→blue, Shell statusStrip) IS present and full-width in takeover rounds — confirming X2's corollary that puzzle scenes specifically bury it. Bar never depletes (no driver), consistent with X2. | shell.ts:133-156 | shots/1024x576/takeover-d5.png — bar css (25..613, 74) |

NOTE (depth labels): driver shot labels can drift from the app's true depth when a sweep click double-fires during the 1400ms reveal window (two onAnswer calls → two depth++ in main.ts dealPuzzle's setTimeout chain). 'takeover-d5' is the first takeover encountered; treat depth labels as ≥ their number, not exact. The layout findings are depth-independent.

## 4. Emerald interlude, depth 4 (design: interlude.ts)

Not captured live: flows that reached depth ≥4 skipped the interlude because sweep double-answers advance two depths per reveal window (1400ms setTimeout chain, main.ts dealPuzzle), jumping over the depth%4==0 slot; later attempts died to the concurrent-edit overlay (§7). Static geometry audit:
- Title "A CHAOS EMERALD SURFACES" at STAGE_W/2-190 hardcoded (interlude.ts:169): string at 30px bold ≈ 420-440px wide → drawn ~25-30px left of true center; same hardcoded-offset pattern as game header. MAJOR (same class as §3 title offset).
- "CHOOSE YOUR POISON" at STAGE_W/2-122 (interlude.ts:170) — same class, ~10-20px off for its measured width.
- Cards: 3×(340×400) + 36 gaps → x254..1346, y230..630: horizontally centered ✓, 36px gaps ✓, desc text wraps at cardW-44 ✓.
- Backdrop is T.bg @ alpha 0.92 over the deal()-root (which still carries Shell chrome): faint ghost rectangles of header/strip/sidebar bleed through behind the overlay. MINOR. | interlude.ts:158-164.
- Hint line y700 centered by measured width ✓; auto-pick 8s / Esc-after-1s deterministic ✓.

## 5. End screen (main.ts endRun)

Not captured live: shots/1024x576/end.png is a FALSE POSITIVE — it documents the vite esbuild error overlay (slimegallery.ts:267 still broken at capture time), which the scene classifier reads as 'end' because the overlay is a bare dark page. Static geometry:
- "MATCH TERMINATED" at STAGE_W/2-120 (main.ts:258) hardcoded offset — actual string @20px ≈ 205px → ~17px left of center. MINOR.
- "DEPTH n · SCORE s" at STAGE_W/2-150 (main.ts:259) — same class, off by ~15-25px depending on digits. MINOR.
- DESCEND AGAIN / BACK TO LANDING are plain panels with text (main.ts:261-268), not makeButton: flat rectangles break the pill/gradient button language used everywhere else; text left-padded 40/44 inside 240px panels → visually off-center labels. MINOR.
- Full-stage panel backdrop (0,0,1600,900) consistent with landing/lobby ✓.

## 6. Takeover scenes (redlight.ts read as representative; others share the shell)

- Same chrome burial as X1 (own full-stage bg at box origin 40,164 → bg spans x40-1640, y164-1064: also overflows the 1600×900 stage right/bottom — clipped by canvas, cosmetic only). MAJOR (chrome loss), MINOR (overflow clip).
- Hardcoded centering again: status at STAGE_W/2-150 (redlight.ts:207), 'MATCH THIS SHAPE' at -96 (redlight.ts:243), hint at -210 (redlight.ts:218) — same off-center class. MINOR each.
- Pattern options 4×138+3×20 at y452 box-rel: inside panel ✓.

## 7. Audit execution notes (why some cells say "not captured")

- Sibling builders were committing to v2/src during the audit. At least once, src/scenes/takeovers/slimegallery.ts was captured mid-write with a syntax error ("PUT 191.=384;" at line 267); vite's esbuild transform failed and the error overlay covered every open tab, freezing all flows (screenshots/OBS-60B3….png documents the overlay). The driver now waits out overlays and retries (rev6+).
- An earlier suspicion of spontaneous "ejection to landing" (shots/2560x1440/game-d1.png was byte-identical to landing.png in one run) is explained by these HMR overlay/reload cycles from concurrent edits, not necessarily by a net-layer bug; flagging for AuditMechanics/NetRobust to re-test on a quiet tree.
- shots/1024x576/end.png, STUCK-*.png, UNEXPECTED-*.png, ERROR-*.png, final-*.png are failure forensics (overlay/eject evidence), not layout states; the clean per-scene captures are landing/lobby/game-d1..d7/takeover-d5 per directory listing.
- Interlude (§4) and true end screen (§5) need a re-run on a quiet tree: driver at research/v2-gauntlet/layout-driver.cjs is seed-tolerant and retrying (4 attempts/viewport, overlay-aware).
- Viewport parity: because layout is stage-fixed and letterboxed, every stage-space defect above reproduces identically at 1920×1080 and 2560×1440 (scale 1.2/1.6); only the 14px gaps (X-§3) cross the 12px cramped threshold at 1024×576. Landing/lobby were visually verified at multiple viewports; game depths verified at 1024×576 (d1, d2) with the same scene code path for d3-d6 (family/hue rotate; geometry identical per §3 formulas).

## 8. Fix priorities (for builders)

1. X1: stop painting full-stage bg over Shell chrome (or attach Shell AFTER scene bg); restore LEAVE + live title.
2. X2: pass depth into buildGameScene; drive timer text + gradient bar from a real clock.
3. X3: size board panel to content (or shrink cell/option sizes) so options fit: need panel h ≥ 40+rows·pitch+36+2·118+14+pad.
4. X4: move rule line below options (y ≥ options bottom + 16) or inside panel header.
5. X5: use Shell.addPlayerCard in-run for the local player (component already exists).
6. L1: move join row up (card-rel y ≤ 280) or grow card to ch≥360.
7. Replace hardcoded ±offsets with measured centering (richLine pattern) everywhere (§3, §4, §5, §6).
