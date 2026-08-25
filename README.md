# IQ Versus: SHADOW

A faithful-looking clone of [iqversus.com](https://www.iqversus.com/) head-to-head abstract-reasoning puzzles that starts identical to the original… and slowly rots into an evil Shadow-themed meta game. Built as a static site — no backend, no build step.

## Play

- **Solo**: open the site, enter a name, Create Room, START. You face house demons.
- **Friends (same browser profile / local)**: Host creates a room (a 5-char code appears in the lobby title). Friends enter the code and Join. Transport: BroadcastChannel + localStorage bus (same-browser tabs) with PeerJS WebRTC for cross-device when the public broker cooperates.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repo (keep the file layout flat — `index.html` must sit at the repo root).
2. Repo → Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)`.
3. Done: `https://<you>.github.io/<repo>/`. The `.nojekyll` file skips Jekyll processing.

Cross-device multiplayer uses the free PeerJS cloud broker (`unpkg.com/peerjs@1.4.7` + `0.peerjs.com`) — no keys, no server of your own. If the broker is busy, same-browser play still works via the storage bus, and solo is always fully playable.

## Files

| File | Role |
|---|---|
| `index.html` | Shell: screens, acts/corruption timeline, scoring, AI demons, emeralds, alignment planner, endless-to-death flow |
| `puzzles.js` | Seeded procedural puzzle generator (matrix / sequence / odd-one-out), validator |
| `audio.js` | 100% procedural WebAudio SFX + act-reactive ambience |
| `chaos.js` | Screen juice: shake, glitch, flash, invert, embers, scanlines |
| `shadow.js` | Shadow persona: quips, speech, avatar, per-round corruption timeline |
| `net.js` | PeerJS + BroadcastChannel + storage-bus multiplayer (host-authoritative) |
| `luxe.css` | The luxe theme (stages 0-3 of visual corruption) |
| `sanctuary.js` | HEAVEN SWAP-BACK: good rounds flip the whole chrome back to faithful iqversus.com |
| `hellheaven.js` | 7-layers-of-hell campaign: descent tracker, limbo/purgatory bands, negative-hp zones, grace overshield |
| `hell-skin.js` | Layer-reactive chrome escalation (vignette/crimson bleed, motion-safe) |
| `pack-hellaudio.js` | Dread drone + demon screams reacting to hell layer; sanctuary shimmer resolve |
| `pack-story.js` | Lore arc: chapter cards, descent whispers, sanctuary continuation lines, despair/defiance beats |
| `cameo-pack.js` | Pop-culture silhouette cameos present inside rounds (seeded, budgeted) |
| `pack-cavern.js` | Cave discovery beat: crystal veins (heal) or the dragon (burns one answer) |
| `pack-funny.js` | Death ledger (tracks your failures) + bad-trip flashback consumer |
| `pack-popcult-a/b.js` | Dolphin pod / shark trench / symbiote / lair teases; ring-mountain + gold-shrine critter worlds |
| `gen_depth.js` | Deep-depth puzzle families `compound` + `relay` (independently audited, fire at depth 10+) |
| `pack-onboard-w4.js` / `pack-quips-w4.js` | First-visit legends + event-reactive Shadow voice |
| `landing-polish.js` | Landing a11y polish: focus trap, feature glyphs, room-name memory |
| `modes/*.js` | 24 takeover stages in the director rotation (arcade, reflex, spectacle, narrative, rhythm) |

## The corruption arc

- **Rounds 1–2**: pixel-faithful IQ Versus. A power-cut "zap" hits mid-round 1. Something tiny is off in round 2.
- **Round 3+**: the palette drains, the title flickers, Shadow starts talking, a Chaos Emerald surfaces (pick your poison — only at rounds 3/6/9).
- **Round 7+**: IQ VERSUS: SHADOW. Black/crimson/emerald hell, corrupted and impossible puzzles — survivable with the right emerald (CHAOS CONTROL).

## Security note

Multiplayer is host-authoritative: the host generates each puzzle and broadcasts it **without the answer key** (same pattern the original's server uses). Clients send picks; the host sends reveals. No accounts, no personal data, everything stays in your browser's localStorage.
