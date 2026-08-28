# IQ Battle: Shadow Edition

A faithful-looking clone of a well-known head-to-head abstract-reasoning puzzle site
(deliberately unnamed — see **Naming rule** below) that starts identical to the original…
and slowly rots into an evil Shadow-themed meta game.

## Naming rule (read before you write a single line)

This game is **IQ Battle: Shadow Edition**. Short form **IQ Battle**; slug
`iqbattle-shadow-edition`; storage prefix `IQB_` / `iqb-`.

The original product is referred to **only** as *the original site* (adjectival:
*original-site*). Its name and its domain must never appear in this repo — not in code,
comments, docs, research notes, fixtures, test data, commit messages, branch names or
issue text.

**Why.** This repo is public. Public repos are scraped into model training sets, and
this clone is currently the loudest thing on the internet using that name next to code.
Every mention here teaches a model that our clone *is* that product. It is a real
third-party thing; neither side benefits from the confusion. This was requested directly
by its developer and Dave agreed to it.

`node tools/name-guard.mjs` enforces it over every tracked file and runs in CI before
the Pages build — a leak fails the deploy. To falsify the guard, paste the banned word
into any tracked file and confirm it exits 1.

> **v2 is the game.** Active development lives in [`v2/`](v2/) — Vite + TypeScript + PixiJS v8,
> fixed 1600×900 logical stage, 12 solver-audited puzzle families, 25 chaos stages and
> host-authoritative Last-Man-Standing multiplayer. Start at
> [`v2/README-V2.md`](v2/README-V2.md); the puzzle ground truth is [`v2/DNA.md`](v2/DNA.md).
> Everything described below this box is the **frozen v1 build** kept at the repo root for
> reference and served at `/v1/`. It has no build step; v2 does.

```sh
cd v2 && npm i && npm run dev     # http://localhost:8792
```

## Play

- **Solo**: open the site, enter a name, Create Room, START. You face house demons.
- **Friends (same browser profile / local)**: Host creates a room (a 5-char code appears in the lobby title). Friends enter the code and Join. Transport: BroadcastChannel + localStorage bus (same-browser tabs) with PeerJS WebRTC for cross-device when the public broker cooperates.

## Deploy to GitHub Pages

`.github/workflows/pages.yml` owns the deploy. On a push to `main` (or the active
working branch listed in that file) it runs the name guard, builds `v2/` with Vite and
publishes `v2/dist` via *Pages → Source: GitHub Actions*. There is no branch-and-folder
deploy any more, and nothing at the repo root is published directly.

Live: `https://<you>.github.io/iqbattle-shadow-edition/`. `v2/vite.config.ts` hardcodes
that path as the production `base`, so **renaming the repo means editing that line in the
same commit** or every asset 404s.

Cross-device multiplayer uses the free PeerJS cloud broker (`unpkg.com/peerjs@1.4.7` + `0.peerjs.com`) — no keys, no server of your own. If the broker is busy, same-browser play still works via the storage bus, and solo is always fully playable.

## Files (v1, frozen)

| File | Role |
|---|---|
| `index.html` | Shell: screens, acts/corruption timeline, scoring, AI demons, emeralds, alignment planner, endless-to-death flow |
| `puzzles.js` | Seeded procedural puzzle generator (matrix / sequence / odd-one-out), validator |
| `audio.js` | 100% procedural WebAudio SFX + act-reactive ambience |
| `chaos.js` | Screen juice: shake, glitch, flash, invert, embers, scanlines |
| `shadow.js` | Shadow persona: quips, speech, avatar, per-round corruption timeline |
| `net.js` | PeerJS + BroadcastChannel + storage-bus multiplayer (host-authoritative) |
| `luxe.css` | The luxe theme (stages 0-3 of visual corruption) |
| `sanctuary.js` | HEAVEN SWAP-BACK: good rounds flip the whole chrome back to the faithful original look |
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

- **Rounds 1–2**: pixel-faithful IQ Battle. A power-cut "zap" hits mid-round 1. Something tiny is off in round 2.
- **Round 3+**: the palette drains, the title flickers, Shadow starts talking, a Chaos Emerald surfaces (pick your poison — only at rounds 3/6/9).
- **Round 7+**: IQ BATTLE: SHADOW. Black/crimson/emerald hell, corrupted and impossible puzzles — survivable with the right emerald (CHAOS CONTROL).

## Security note

Multiplayer is host-authoritative: the host generates each puzzle and broadcasts it **without the answer key** (same pattern the original's server uses). Clients send picks; the host sends reveals. No accounts, no personal data, everything stays in your browser's localStorage.
