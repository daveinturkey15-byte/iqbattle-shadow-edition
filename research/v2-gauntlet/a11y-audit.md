# V2 Accessibility Audit — wave 2 (A11yPass, 2026-08-26)

Read-only sweep of `v2/src` against DNA.md rails + rebuild-brief hard rails:
text ≥ 11 px · contrast · focus/modal traps · keyboard reachability · IQB_MOTION
gating · flash ≤ 3 Hz ≤ 200 ms · overlay escapability.

**Method.** Full grep sweeps over `src/scenes/**`, `src/scenes/takeovers/**`,
`src/main.ts`, `src/theme.ts`, `src/shadow/shadow.ts` for: `fontSize`,
`text(…, N, …)` size args, `Math.sin/cos/setInterval`, `alpha =`,
`eventMode|pointerdown|pointerup|cursor=`, `Escape|keydown|.key`,
`MOTION|reduced|prefers-reduced`. Every hit manually read in context; theme
token pairs contrast-computed with the WCAG relative-luminance formula (script
in §7). Line numbers verified against current file snapshots.

**Scope note.** The audit ran twice: an initial sweep, then a re-sweep after
concurrent wave-1 siblings landed `takeovers/{pacman2,metal2,hypercube2,
fractal2,popglitter2,gauntlet2,phoenix2}.ts`, `scenes/end.ts`, `meta/*`,
`fx/reveal.ts`, `worlds/backdrops.ts`, `shadow/large.ts`,
`audio/{director,sfx2}.ts`. All findings below include those files.
`scenes/game.ts`, `main.ts`, `theme.ts` are Main-owned — audited
read-only, findings reported for Main.

Severity: **P1** hard-rail violation · **P2** major gap · **P3** minor · **P4** info/accepted.

---

## 1. Findings table

| # | Sev | File:Line | Issue | Fix snippet |
|---|-----|-----------|-------|-------------|
| 1 | P1 | `src/scenes/landing.ts:85` | Sub-11 px text: `'abstract reasoning · corrupted'` rendered at **fontSize 10** (`text(card, …, 0, 72, 10, T.muted)`). Direct breach of "text ≥ 11 px". | `const sub = text(card, 'abstract reasoning · corrupted', 0, 70, 11, T.muted);` |
| 2 | P1 | `src/scenes/takeovers/saberclash.ts:253` | Feint telegraph blink `Math.floor(roundMs / 90) % 2 === 0` toggles every 90 ms → **5.6 Hz repeating flash**, above the ≤3 Hz rail. Localized to a 26 px marker, but the rail is frequency-based. | Half-period 170 ms → `Math.floor(roundMs / 170) % 2 === 0` (= 2.94 Hz). Also gate with `motionOn()` so reduced-motion users get a static tint swap at `feintMs - FEINT_TELEGRAPH_MS`. |
| 3 | P2 | `src/scenes/shell.ts:95` | Quiet header actions render `T.muted` at `alpha = 0.4` → composited **#404753/#444e5e, ratio 2.15–2.23:1** (needs 4.5:1). Landing's SIGN IN is quiet → fails AA today. | Drop alpha to ≥0.75 (`t.alpha = 0.75;` → 4.81:1) or keep 1.0 and dim via color `#768295`. |
| 4 | P2 | `src/scenes/game.ts:50-51` + `src/main.ts:286-318` | Puzzle answering is **pointer-only**: options wire only `pointerdown`; no window key handler anywhere in `dealPuzzle`. Inconsistent — the takeover stages accept number keys. Keyboard-only users cannot answer any puzzle. | In `dealPuzzle`, after mounting: <br>`const onKey = (e: KeyboardEvent): void => { const n = parseInt(e.key, 10); if (n >= 1 && n <= p.options.length) sceneAnswer(n - 1); };`<br>wire via a `pick(idx)` callback into `buildGameScene` and remove the listener on advance. |
| 5 | P2 | `src/scenes/takeovers/hunterdodge.ts:272-274` | Cursor follows `pointermove` only — no keyboard path (Arrow/WASD nudge like `dronedodge.ts:299-305` `kbCursor`). Keyboard-only users cannot evade; dronedodge already proves the parity pattern. | Port dronedodge's `kbCursor`: `case 'ArrowLeft': case 'a': kbNudge(-KB_STEP, 0); …` and use `kbCursor ?? cursor` in aim/exposure math. |
| 6 | P2 | `takeovers/dronedodge.ts:160`, `floorfall.ts:156`, `hunterdodge.ts:168`, `laserstorm.ts:174`, `metal2.ts:158`, `popglitter2.ts:223`, `hypercube2.ts:168`, `fractal2.ts:160`, `phoenix2.ts:124` | MOTION gates read **only** `localStorage IQB_MOTION !== '0'`; OS-level `prefers-reduced-motion` is ignored. `fx/reveal.ts:105-118`, `shadow/large.ts:291-296` and `shadow/shadow.ts:223-228` do both — the rail says "IQB_MOTION/reduced-motion", coverage is inconsistent per file. | Promote `revealMotionEnabled()` (`fx/reveal.ts:105`) into a shared module (e.g. `theme.ts`) and import it in every takeover instead of the inline localStorage ternary. |
| 7 | P2 | `src/scenes/takeovers/slots.ts:44,344-351` | Reel spin cycles full symbol textures every **SPIN_TICK_MS = 40 ms (25 Hz)** across three 120 px cells, ungated by IQB_MOTION. Not a luminance strobe of one region, but 25 Hz high-chroma swapping is a vestibular hazard and sits badly against the ≤3 Hz spirit. | Under motion-off step reels at ≥400 ms (dronedodge precedent), or raise SPIN_TICK_MS floor: `const tick = motionOn() ? SPIN_TICK_MS : 400;` |
| 8 | P2 | `src/main.ts:194-201` | End screen ("DESCEND AGAIN" / "BACK TO LANDING") buttons are bare pointer panels — **no keyboard path and no Esc**. This screen is a dead end for keyboard users after every run. | Reuse `makeButton` once it gains key support (see #9) or add `window.addEventListener('keydown', …)` mapping `1`/`2` + `Escape→toLanding`. |
| 9 | P2 | `src/scenes/shell.ts:101-109,280-315` | `makeLink`/`makeButton` wire only `pointerdown`; no Enter/Space activation, no visible focus ring, no Tab order. Every header action (LOBBY/LEAVE/SIGN IN/HOW TO PLAY) and every button (lobby steppers, START/LEAVE, landing CREATE ROOM/JOIN) is unreachable by keyboard alone. Pixi has no DOM focus — needs an app-level router. | Central registry: `makeButton` pushes `{ node: c, onClick }` into an exported `focusables` array; one module-level `keydown` handler tracks index (Tab/Shift+Tab), draws a 2 px accent stroke on the focused node, fires `onClick` on Enter/Space. Same for `makeLink`. |
| 10 | P3 | `src/scenes/shell.ts:237-272` | Toast dismiss is click-only (`holder.on('pointerdown', kill)`); no Esc. Auto-fade at 1400 ms bounds it, but the header comment claims "escapable" — it isn't by keyboard. Fade also ungated by motion (one-shot 350 ms opacity ramp — benign). | `window.addEventListener('keydown', function esc(e){ if (e.key==='Escape'){ kill(); window.removeEventListener('keydown', esc);} })` inside `toast()` (removed in `tick` teardown too). |
| 11 | P3 | `src/scenes/shell.ts:369` | Input placeholder `#5a6b92` on `#0a1224` = **3.51:1** (<4.5). Value text itself passes (ink 17.6:1). | `const phT = text(c, placeholder, 0, 0, 14, '#7e8fb3');` → 5.75:1. |
| 12 | P3 | `src/scenes/interlude.ts:178-182` | Emerald cards are pointer-only; Esc declines but there are no `1..3` pick keys. Esc also ignored for first 1000 ms (`ESCAPE_AFTER_MS`) — documented on-screen, auto-pick at 8 s bounds it; acceptable but worth a key path. | In `onKey`: `const n = parseInt(e.key, 10); if (n >= 1 && n <= offers.length) pick(n - 1);` |
| 13 | P3 | `src/scenes/shell.ts:331-337,421-430` | TextInput: click-to-focus only, no Tab traversal between the landing form's 3 inputs; global hook permanently installed (module singleton — fine, listeners are leak-safe via `destroyed`). Caret blink 1 Hz ungated (benign, standard affordance). | With #9's focus router, Tab should move focus between TextInputs (`handle.focus()`), restoring drawFrame(true). |
| 14 | P4 | `slimegallery.ts:300-317`, `serpent.ts`, `tidepool.ts:344-349`, `well.ts`, `saberclash.ts:254` | Gameplay-relevant animation (targets rising/sinking, marker orbit, piece gravity, splash arcs) is intentionally NOT behind IQB_MOTION. Accepted: gating would change rules/pacing; rails gate *ambient* motion. Documented here so the choice is explicit. Dronedodge goes further (steps its drones discretely) — fine either way since rules stay identical. | none (accepted) |
| 15 | P4 | `arc.ts:180-181` + `main.ts:223` | Crimson `#e0245e` banner text on panel/bg = 4.09–4.40:1. Passes as large text (22–26 px bold ≥ 3:1 threshold) but would fail at body sizes. | Keep banners ≥19 px bold; never reuse crimson for <19 px copy. |
| 16 | P1 | `src/scenes/takeovers/pacman2.ts:481-482` | Fright ghost blink `0.45 + 0.55 * Math.abs(Math.sin(sim.t / 90))` — the abs doubles the rate → **3.5 Hz repeating alpha flash** across every frightened ghost, above the ≤3 Hz rail and ungated by IQB_MOTION. | Use `Math.sin(sim.t / 210)` without abs (≈1.5 Hz), or gate: `sim.frightMs < 1500 && motionOn()` with a static mid alpha when off. |
| 17 | P2 | `src/scenes/takeovers/hypercube2.ts:218-221,309-316` | Answer tiles are pointer-only; keyboard gets only Esc/H (goggles). No digit path to answer — keyboard-only users time out of every hypercube round. | In `onKey`: `const n = parseInt(e.key, 10); if (n >= 1 && n <= opts.length) answer(n - 1);` |
| 18 | P2 | `src/scenes/takeovers/gauntlet2.ts:230-252,295-308` | WAR trial is space-mashable ✅ but DEATH's crown/portion picks wire only `pointerdown` (`pickCrown`/`pickPortion`) — those trials are unanswerable by keyboard. | Map digits during pick phases: `if (pickOpen && n >= 1 && n <= choices.length) pickCrown(n - 1);` |
| 19 | P3 | `src/scenes/takeovers/phoenix2.ts:254` | Flame flick `Math.sin(t / 45)` wobbles flame height at **3.5 Hz**. Motion-gated ✅ and it is deformation (not an on/off strobe), so graded P3 not P1 — still nominally over the ≤3 Hz line. | Slow to `Math.sin(t / 60)` (2.7 Hz) or clamp flicker updates to ≥340 ms steps under reduced motion (already static today — keep). |

---

## 2. Text size sweep (rail: ≥ 11 px)

All `text(...size...)` call sites and literal `fontSize:` styles grepped.
Sizes found across scenes/takeovers/main/shell: 10 ❌, 11, 12, 13, 14, 15,
16, 17, 18, 20, 21, 22+, 26, 30, 34, 42, 72.

- **landing.ts:85 — fontSize 10 (finding #1, the only violation).**
- Boundary cases that PASS: option index chips at 12 px (`game.ts:53`),
  13 px lane numbers in every takeover (`redlight.ts:260`,
  `laserstorm.ts:221`, `hunterdodge.ts:222`, `dronedodge.ts:207`,
  `floorfall.ts:207`, `slimegallery.ts:236`), player-card clock
  and tags at exactly 11 px (`shell.ts:195,198`), end-screen review rows at
  14-18 px (`end.ts:116-199`). Second sweep of the seven new takeovers,
  `meta/*`, `fx/reveal.ts`, `worlds/backdrops.ts`, `shadow/large.ts` found
  no further sub-11 px text (`large.ts` band is MIN_PX=24..40).
- DNA glyph primitives ~10 px (`glyphs.ts`, family renderers, `slots.ts`
  symbolPrims) are **marks, not text** — exempt per DNA visual grammar.

## 3. Contrast (computed from theme tokens, WCAG 2.x ratios)

Backgrounds: bg `#04070f`, panel `#0a1220`, tile `#0a0d14`, input `#0a1224`.

| fg \ bg | bg | panel | tile |
|---|---|---|---|
| ink `#f5f8ff` | 18.95 ✅ | 17.63 ✅ | 18.28 ✅ |
| muted `#9aa7ba` | 8.26 ✅ | 7.69 ✅ | 7.97 ✅ |
| gold `#d4a017` | 8.48 ✅ | 7.89 ✅ | 8.18 ✅ |
| good `#00e68a` | 12.17 ✅ | 11.32 ✅ | 11.74 ✅ |
| bad `#ff2038` | 5.29 ✅ | 4.92 ✅ | 5.10 ✅ |
| accentA `#ff2e7e` | 5.70 ✅ | 5.31 ✅ | 5.50 ✅ |
| accentB `#2d7cff` | 5.22 ✅ | 4.85 ✅ | 5.03 ✅ |
| crimson `#e0245e` | 4.40 ⚠ large-text only | 4.09 ⚠ | 4.24 ⚠ (graphics OK) |
| boardHues `#38bdf8/#a78bfa/#34d399` on tile | — | — | >7 ✅ (glyph marks ≥3:1 graphics) |

Failures/specials:
- muted @ alpha 0.4 (quiet links): **2.15 / 2.23 ❌** → finding #3.
- placeholder `#5a6b92`: **3.51 ❌** → finding #11.
- toast ink on panel(0.96) over bg: 17.65 ✅.
- rank colors `#c9d3e0` (diamond/avatar marks): graphics, ≥3:1 ✅; `#b0763b`
  diamond on panel ≈ 3.2:1 — graphics pass, do not use for text.

## 4. Focus traps & modal-ish overlays

Inventory of overlays found: interlude emerald picker, toast/banner, shadow
speech bubble, end screen, lobby/landing full scenes. No DOM focus exists
(Pixi canvas app), so "focus trap" reduces to *can you leave/resolve the
overlay without the mouse*:

| Overlay | Pointer-out? | Keyboard out? | Auto-resolve? | Verdict |
|---|---|---|---|---|
| Interlude (`interlude.ts:148-255`) | cards click | Esc after 1 s (:241), digits missing (#12) | 8 s auto-pick | OK, minor gap |
| Toast (`shell.ts:237-272`) | click :269 | none (#10) | fades ≤1.75 s | minor gap |
| Shadow bubble (`shadow/shadow.ts:283-330`) | non-blocking | non-blocking | 4 s hold + gated fade | ✅ best-in-class |
| End screen (`main.ts:190-203`) | two buttons | none (#8) | never | **dead end for KB users** |
| Takeover stages | all playable | Esc in all 18 takeovers (verified in §6) | timer budget self-resolves | ✅ |

No trap holds input hostage: the shell keyTarget hook is cleared when the
input is destroyed (`shell.ts:427-430`), so landing inputs can't swallow keys
during gameplay.

## 5. Keyboard reachability

Every clickable inventoried (`eventMode`/`on('pointerdown')` sweep):

| Surface | Key path? |
|---|---|
| Puzzle options ×8 (`game.ts:50-51`) | ❌ **none** (#4) |
| redlight options | ✅ 1-4 on green (`redlight.ts:377-379`) |
| tidepool / hunterdodge / laserstorm / slimegallery option tiles | ✅ 1-8 digits |
| serpent | ✅ arrows/WASD (`serpent.ts:229-247`) |
| well | ✅ arrows + Z/X rotate + Space drop (`well.ts:411-419`) |
| slots / saberclash | ✅ Space/Enter |
| floorfall | ✅ 1-TILES digits |
| Header links LOBBY/LEAVE/SIGN IN/HOW TO PLAY (`shell.ts:101-109`) | ❌ (#9) |
| pacman2 | ✅ arrows/WASD (`pacman2.ts:515-517`) |
| metal2 / popglitter2 | ✅ D·F·J·K + 1-4 (`metal2.ts:188-189`, `popglitter2.ts:250-251`) |
| fractal2 | ✅ Space stabilize (`fractal2.ts:288`) |
| phoenix2 | ✅ Space hold/release (`phoenix2.ts:267,283`) |
| hypercube2 answer tiles | ❌ only Esc/H (#17) |
| gauntlet2 crown/portion picks | ❌ pointer-only in those trials (#18) |
| All makeButton instances (lobby, landing, steppers) | ❌ (#9) |
| Landing text inputs | typing ✅ once focused; focus itself click-only (#13) |
| Interlude cards | Esc ✅, picks ❌ (#12) |
| End-screen buttons | ❌ (#8) |
| dronedodge evader movement | ✅ WASD/arrows (`:309-316`) |
| hunterdodge evasion cursor | ❌ pointer-move only (#5) |

## 6. Motion gates & flash compliance

Gated correctly behind `localStorage IQB_MOTION !== '0'`:
- `beds.ts:211,266` + `sfx2.ts:227` + `director.ts:152,185` (audio LFOs and
  ember-crackle loop), `floorfall.ts:346-347` (shimmer ≈1.8 Hz, hover lift),
  `hunterdodge.ts:312` (cone snap), `laserstorm.ts:300-308`
  (pulse ≈2.0 Hz → static outline), `dronedodge.ts:355-362` (discrete 400 ms
  stepping), `metal2.ts:276,362,379` / `popglitter2.ts:329,399` (110 ms
  render quanta, shake off, static telegraphs — judgment stays real-time),
  `hypercube2.ts:257,303,344` (static net), `fractal2.ts:270,303` (one static
  keyframe, Deep Reader bonus disabled),
  `phoenix2.ts:254` (static flame).

**Dual-gate reference implementations** (IQB_MOTION **and**
prefers-reduced-motion): `fx/reveal.ts:105-118 revealMotionEnabled()`,
`shadow/large.ts:291-296 motionOn()` + `motionPolicy()`,
`worlds/backdrops.ts` applyBackdrop, `shadow/shadow.ts:223-228`. Finding #6
asks the localStorage-only takeover gates to adopt `revealMotionEnabled()` as
the one shared helper.

Ungated decorative/transition animation (all sub-3 Hz one-shots or standard
affordances — acceptable, see #6 for gate-unification): shell caret blink
1 Hz (`shell.ts:421-425`), toast fade 350 ms one-shot, button hover alpha.

Flash-frequency audit of every periodic animation literal:

| Site | Waveform | Frequency | ≤3 Hz? | Gated? |
|---|---|---|---|---|
| `pacman2.ts:482` fright blink | abs(sin(t/90)) alpha | **3.5 Hz** | ❌ #16 | ❌ |
| `phoenix2.ts:254` flame flick | sin(t/45) height | 3.5 Hz | ⚠ #19 (deformation) | ✅ |
| `metal2.ts:379` / `popglitter2.ts` telegraph ring | sin(clock/80) | 1.99 Hz | ✅ | ✅ |
| `pacman2.ts:495` power pellet | abs(sin(t/260)) | 1.22 Hz | ✅ | ❌ (gameplay) |
| `large.ts:498` eye pulse | sin(t/650) | 0.25 Hz | ✅ | ✅ |
| `backdrops.ts` lava/beacon/cones | sin(t/900…5200) | ≤0.18 Hz | ✅ | ✅ |
| `reveal.ts` wash/embers/combo | one-shot ≤ FLASH_MS, one per round | n/a | ✅ | ✅ |
| `saberclash.ts:253` feint blink | square, tint+alpha | **5.6 Hz** | ❌ #2 | ❌ |
| `laserstorm.ts:303` | sin(t/80) | 1.99 Hz | ✅ | ✅ |
| `floorfall.ts:346` | sin(t/90) | 1.77 Hz | ✅ | ✅ |
| `slots.ts:44` reel cycling | texture steps | 25 Hz swaps | ⚠ #7 | ❌ |
| `shell.ts:424` caret | square 500 ms | 1 Hz | ✅ | n/a |
| one-shots: `well.ts:44` 160 ms clear flash, `saberclash.ts:238` ≤160 ms pulse, `dronedodge.ts:421`/`floorfall.ts:352` 180 ms vignettes, `hunterdodge.ts:337` 180 ms meter flash | single decay | n/a | ✅ ≤200 ms | n/a |

Escapability cross-check (rail: every overlay escapable): all 18 takeovers
handle `Escape` → neutral `escaped(...)` result and remove their listeners in
teardown — `redlight.ts:373`, `tidepool.ts:311`, `serpent.ts:252`,
`floorfall.ts:302`, `hunterdodge.ts:278`, `laserstorm.ts:266`,
`dronedodge.ts:310`, `saberclash.ts:272`, `slots.ts:361`,
`slimegallery.ts:367`, `well.ts:408`, `pacman2.ts:512`,
`metal2.ts:324`, `hypercube2.ts:311`, `fractal2.ts:284`,
`popglitter2.ts:369`, `gauntlet2.ts:297`, `phoenix2.ts:263`. Interlude Esc
delayed 1 s (documented in-hint). Gaps: toast (#10), end screen (#8).

## 7. Method artifacts

Contrast script (run against `theme.ts` tokens, WCAG relative luminance):
composite `fg over bg` at alpha via channel lerp before ratio;
`ratio = (L_light+0.05)/(L_dark+0.05)`. Frequencies from waveform literals:
sin(t/N) Hz = 1000/(2πN); square toggle every M ms Hz = 500/M.

**Summary: 3 × P1 (#1 landing 10 px text, #2 saberclash 5.6 Hz blink, #16
pacman2 3.5 Hz fright flash) · 9 × P2 (#3, #4, #5, #6, #7, #8, #9, #17,
#18) · 5 × P3 (#10, #11, #12, #13, #19) · 2 × P4 (#14, #15).**
The engine-side rails (takeover escapability ×18, damage-flash windows,
audio gating, shadow/reveal/backdrop motion policies) are in strong shape;
the gaps cluster in shared chrome (keyboard routing for puzzles + shell
widgets, quiet-link contrast) and three hard-rail violations (#1, #2, #16).

