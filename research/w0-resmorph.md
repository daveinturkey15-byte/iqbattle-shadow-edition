# W0 Deep Capture - Live iqversus.com Puzzle System (ResMorph)

**Date:** 2026-08-24 · **Agent:** ResMorph · **Target:** live https://www.iqversus.com/ solo gauntlets
**Method:** CDP JSON-RPC over WebSocket to shared headless Chrome (DevToolsActivePort port 52607, daemon 0618...), short-lived node -e children, page-side JS drivers, OffscreenCanvas alpha-mask decoding of runtime blob-PNG tiles (bbox w/h, centroid, fill, aspect, perimeter ratio, dominant HSL, 24x24 hex silhouette). Ground truth from post-answer reveal classes.

## Capture score

| Metric | Value |
|---|---|
| Gauntlets launched | 4 (A1, B1 aborted, C1 partial, D1 throttled) |
| Rounds captured with full mask stats + silhouettes | **7** (target 10+; infra losses below) |
| Morph / under-sampled archetypes among them | **7 / 7** |
| v1 baseline (rsh2/rsh_caps from PuzzleResearch) | 20 rounds, structural modes only |

Archetype counts captured: rotation-morph x1, dot-lattice positional-morph x1, inner-glyph morph x1, set-completion checkerboard x1, multi-attribute composite x1, single-panel fused x1, color-step geometry-invariant x1. All seven are archetypes v1 never analyzed.

## Key mechanic discoveries (3)

1. **Morph sequences are rotation-driven.** A1-R3: elongated comet shape steps ~45deg per cell. Signature from pixel masks alone: bbox aspect oscillates **0.83 <-> 1.20 with period 4** (=180deg bbox symmetry over 4 steps => full 360deg cycle over 8 cells), |w-h| up to 37px of 220, centroid orbits center +-0.05 as tail swings, hue/fill family constant. Engine implication: synthesize morphs as angle-stepped variants; grade via aspect signature; no sprites needed.
2. **Positional morphs are micro-dot-lattice occupancy shifts, not translations.** A1-R4: tile is a 3x3 lattice of ~40px dots inside a 212px cell; across frames w/h/area/fill constant while occupied sub-slots change; mask centroid drifts monotonically upward cy **0.625 -> 0.539 -> 0.497** (decelerating; predicted next ~0.46). Model sub-slot occupancy, not whole-shape motion.
3. **Option grids are not isometric with the board; set rules bind color to class.** Fused rounds (A1-R1): options are degenerate SOLID squares (fill=1.0) graded purely on color identity vs the fused panel dominant component (#ee2266 vs decoy #8811dd). Set-completion boards (A1-R5) run strict checkerboard parity of two outline classes bound to colors (ring-outline teal fill .27/pr 10.0 vs square-frame orange fill .36/pr 12.0; hole needs parity class - predictor hit it exactly). Generators need per-role tile grammars, not one uniform tile schema.

## Parameter-axis table (estimated from masks)

| Round | Archetype | Parameter axis | Step direction | Magnitude | Start state |
|---|---|---|---|---|---|
| A1-R3 | rotation morph | rotation angle ~45deg/cell | CW along row-major sequence | aspect period 4; d(w,h) <=37px; cx,cy orbit +-0.05 | tail down-right (asp 1.196) |
| A1-R4 | positional morph | occupancy on 3x3 micro-lattice | upward, decelerating | cy -0.086 then -0.042 per step; w/h/fill const | bottom-heavy cluster (cy .625) |
| A1-R2 | inner-glyph morph | inner glyph variant + frame notch side | alternates L/R; glyph morphs | fill step .188<->.157 (-16% rel); frame const 170px | X glyph + centered bar |
| C1-R2 | color-step | hue only | one odd cell breaks run | hue 275->275->132; geometry d(fill)=0.001 | purple, purple, green |
| A1-R5 | set-completion | class parity (shape x color bound) | strict checkerboard | ring .266 fill vs frame .356 fill classes | teal ring at origin corner |
| A1-R6 | composite matrix | color x fill x corner-offset axes | independent per cell | fill .164-.463; hues {340,275,50}; centroids +-0.13 off-center | pink mid-fill centered |
| A1-R1 | single-panel fused | panel dominant-color identity | n/a (one panel) | comp areaPct .889 of 660^2 | rounded solid-ish panel |

## Structural facts (engine-relevant)

- Modes: matrix **2x2 hole always idx3**, **3x3 hole always idx8** (bottom-right convention confirmed live), single-image 660x660 fused with no hole slot.
- Tiles are **runtime-generated blob PNGs** (220x220 per cell), not sprites - blob-decode capture pipeline is correct.
- Answer grid: .luxe-game-answer-grid with 8 .luxe-game-answer-option; reveal taxonomy: -correct-reveal, -self-wrong-reveal, -dimmed => reliable ground-truth channel.
- Timers (solo): observed 00:56-01:00 on all captured rounds (element .luxe-game-round-status-time); v1 also saw 18-31s short timers on easier sets => timer scales with difficulty, not round index alone.
- Flow gotchas: POST /api/rooms rejects room titles outside [letters numbers spaces apostrophes] (400 invalid_room_title); SPA routes games to /room/<CODE>; Get Ready 3-2-1 precedes each round; first answer locks per round.
- Hole positions distribution: bottom-right in EVERY matrix round seen (v1 + mine, n=17).

## Why 7 and not 10+ (infra post-mortem)

1. Origin localStorage quota (~5MB, shared with prior researchers keys) silently swallowed stashes until harvesting+deleting own keys between rounds.
2. Background-tab throttling freezes game rendering; focus emulation drops when the fire-and-forget child disconnects - D1 died at Round 1 ("no question" after 45s while its timer showed 42s elapsed).
3. Shared-browser cross-agent interference caused spontaneous tab reloads (proven navigation type=reload) killing in-page runners mid-game (C1 lost after R2).
Mitigations validated: dedicated fresh tab per run, incremental harvest-and-delete after each stash, broker-side writer for file delivery (node_repl is EPERM-blocked under AppContainer for Desktop/stuff writes).

## Files
- research/w0-resmorph.md (this report)
- research/w0-resmorph-data.json (structured rounds, mask stats, silhouettes, analyses)
