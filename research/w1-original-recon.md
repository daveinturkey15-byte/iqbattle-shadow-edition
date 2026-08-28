# W1 · Original-Site Recon — parity baseline (2026-08-24)

Live-verified today via headless Chromium (room `14QKVJ40`, 3-round solo host match). This is the look/feel contract for rounds 1–N before the shadow diverges into W1 content.

## Match flow (observed end-to-end)

1. **Landing** `/`: hero H1 "Challenge your friends with IQ-style logic and abstract reasoning puzzles.", three feature cards (Random Puzzle Generation / No Registration Required / Invite Friends Easily), Create-a-room card: Display name + Room name + Create Room button. Header right: HOW TO PLAY link (`/how-to-play`), SIGN IN (disabled).
2. **Lobby** `/room/<CODE>`: H1 `<room> (n/24)`; INVITE (copy link) + LEAVE buttons; player cards ("OxAlpha, you, host" + crown icon); host-only settings panel: Rounds (default 10, range 1–30), Round Timer s (default 60, range 1–120); Start button. Give Host / Kick via selecting another player card (confirmation-gated).
3. **Match**: header = LOBBY (return) · room name · LEAVE. Status row: "Round N/M" + "MM:SS" time remaining + progress bar. Board: 3×3 grid of rendered tiles, bottom-right cell "?" — plus 8 answer-option buttons (image tiles) in a grid below/beside. Sidebar player card: rank badge, name, "Waiting for answer" state, live response clock (e.g. `12.226s`), score.
4. **Answer lock**: first click locks instantly (buttons stop being interactive); reveal follows shortly after (solo observed ≲5s later); then next round starts automatically with a fresh timer.
5. **Final scoreboard**: ranked list (badge, name, total), BACK TO LOBBY + LEAVE. Per-round review and accolades render on player cards (multiplayer).

## Rules that must hold in shadow (from official guide)

- Everyone gets the same pattern + same answer set. First choice locks for the round.
- Reveal when everyone has answered or timer expires. Speed matters: faster correct ⇒ more points.
- Puzzle families: **3×3** (rule across rows / down columns / both), **2×2**, **missing-section** (larger pattern, one region removed). All shown with **8 answer choices**.
- Scoring surface per round: result, response time, points gained, updated ranking.
- Accolades (final): King of the Hill · Not of this Earth (1st every round) · Front Runner (most round wins) · Lone Wolf (only solver, ≥4 players) · Lightning Strike (fastest correct) · Hot Streak · Flawless · Rapid Response (fastest avg). Ties share accolades.

## Visual tokens (computed styles, live)

| Token | Value |
|---|---|
| Body bg | `rgb(4, 8, 18)` |
| Panel bg | `rgb(2, 14, 32)` |
| Round-status bg | `rgb(2, 12, 29)` |
| Footer bg | `rgb(4, 11, 22)`, top border `rgba(255,255,255,.075)` |
| Text | `rgb(245, 248, 255)`; muted `rgb(154, 167, 186)`; disabled `rgb(111, 127, 150)` |
| Accent gradient | `linear-gradient(135deg, rgba(43,116,235,.14), transparent 36%)` panels; active buttons `90deg rgba(43,116,235,.28), rgba(53,125,244,.28)` |
| Accent borders | `rgba(64,137,238,.16)` panels, `.38` active button (`rgba(72,191,255,.38)`) |
| Radii | 22px panels · 16px status · 12px mobile switch · 8px buttons · 6px selects |
| Font | Oxanium (fallback Eurostile), body 16px, small 12.8px |
| DOM class system | `luxe-*`: `app-shell`, `luxe-background-mosaic`, `luxe-route-slot`, `luxe-screen luxe-game-screen`, `luxe-surface luxe-panel`, `luxe-game-board-panel`, `luxe-game-sidebar`, `luxe-footer*` |

Our repo's `luxe.css` already mirrors this language (git: "Fidelity pass: Oxanium font, 4-stop signature gradient"). Parity work = diff against these exact values, not reinvention.

## Notes

- Original runs Google ads (`adsbygoogle`) — do NOT replicate.
- SIGN IN disabled for anonymous users; rooms are the only identity.
- Solo matches still show the sidebar response clock and per-round flow identical to MP.
