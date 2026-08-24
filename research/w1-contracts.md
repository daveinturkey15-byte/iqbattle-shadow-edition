# W1 Contracts — FROZEN v1 (2026-08-24)

Grounded in live engine read of index.html#116-785, net.js#1-52. Builders MUST NOT break these.

## C1 · Round frame v2 (net.js / index.html)
Host `broadcastRound()` adds ONE optional field:
```
{t:'round', …existing, w1?:{theme:'jungle', align:'bad'|'good'|'chaotic'|'neutral', dim:'2d'|'3d'|'4d'|'606d', heal?:1, amp?:1}}
```
- Absent `w1` ⇒ legacy behavior everywhere. Clients never trust client-side w1; host decides all.
- Answers still NEVER ship before reveal (net.js security warning stands).
- `applyIncomingRound` copies `pl.w1` into `G.w1`.

## C2 · AlignmentDirector — `alignment.js` → `window.IQ.Align`
- `Align.begin(roomSeed, totalRounds)` → builds full-round plan array at match start (host-only), deterministic from seed.
- `Align.at(round) → {align, themeId, dim, heal, amp}` — host slices into frame `w1`.
- Cadence: blocks of 4–6 bad/chaotic then 1 good (target ≈5:1 over ≥30 rounds); no two good rounds within 4 of each other; chaotic overrides ~1-in-8 bad rounds; neutral allowed in limbo/purgatory themes.
- Continuity: a good round's themeId resumes the theme of the previous good round when ≥4 rounds apart (redemption arc).
- Wraps, does not replace, r3/r5/r7 stage gates (setStage still fires).

## C3 · Worlds registry — `worlds.js` → `window.IQ.Worlds`
- `Worlds.register({id, align, palette:[8 colors], bg(ctx,w,h,t), skin:'css-class', patch:{name, params}, mods:{diffDelta, timerDelta, optStyle}, enterFx(), exitFx()})`
- `Worlds.apply(themeId)` → sets `body.world-<id>`, swaps active palette row used by `pal()` indirection, starts bg loop, swaps audio patch. `Worlds.clear()` back to base.
- HARD RULES: asset-free (canvas/CSS/SVG/oscillators only); never recolor/animate question or answer glyphs (readability floor); all motion behind `IQB_MOTION`; flashes ≤200ms / ≤3Hz.

## C4 · HP & amplifiers
- `G.hp` (100 cap, start 100) rendered as thin bar under timer. Solo+MP both.
- Wrong answer: hp −15. Curse/pestilence/horsemen events: hp −10..−25 (BalanceModel finalizes). Good/heal round entry: hp +30. Death (hp≤0): solo=endRun('THE DARK CLAIMS YOU'); MP-LMS=eliminated (spectator).
- Amplifier (`amp:1` in frame): previous round alignment ≠ current ⇒ one-shot 'pain' beat on round start: CX.shake + desaturate filter 600ms + AU sting. No score change (fairness).

## C5 · Retro takeovers
- New generator families register in `window.IQ.Gens` like existing ones but return `kind:'retro'`, `retro:{game:'snake'|'tetris'|…}`, and STILL satisfy the 8-options + answer contract (option tiles encode outcomes; picking = playing one move OR choosing the outcome tile — implementer picks simplest per game, documented in the gen file header).
- Renderer: `retro-*.js` draws into `#board-frame` via canvas; teardown on reveal; reverts next round automatically (frame-driven).

## C6 · Dimensions
- `dim:'3d'`: wrap `#board-frame` content in perspective container, slight rotateX/Y oscillation (IQB_MOTION-gated), tiles remain clickable (hit-testing unchanged — transforms only visual, pointer-events preserved).
- `'4d'`: projected extra axis = color-phase shift cycling on one board axis.
- `'606d'`: joke mode — animated hypercube/lattice SVG background BEHIND an ordinary puzzle; chaos is cosmetic only.

## C7 · MP last-man-standing + attacks
- Lobby toggle `cfg-lms`. Host loops rounds past `total` while ≥2 players have score >0; score floor 0 in LMS; elimination broadcast via new frame `{t:'elim', uid}`; end when 1 remains → `{t:'end'}`.
- Attacks: new client→host frame `{t:'attack', targetUid, weapon:'rotten'|'curse'}` costing attacker points (constants from BalanceModel); host validates affordability, applies −N to target, includes results in next reveal scores[] (no extra frame type needed for state).

## C8 · Parity rule (first rounds identical)
While `G.round <= 2 && !anyW1Flagged`: no world skins, no dim modes, no retro, no amp beats — pure baseline clone matching iqversus.com tokens (research/w1-original-recon.md). Divergence begins round 3+ (or immediately if host toggles W1 OFF→ shadow classic).
