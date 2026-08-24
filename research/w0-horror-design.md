# W0 · Horror-Corruption Design Doc — *IQ VERSUS* rots into PANDemonium

**Author:** HorrorDoc (research + design pass; zero game-code edits)
**Date:** 2026-08-24
**Constraint honored:** vanilla JS/CSS/SVG/Canvas only, **no external assets**, builds on the live engine in `iqbattle/`.

---

## 0. Scope & method

Part A extracts repeatable techniques from four canon "cheerful game turns evil" titles (*Inscryption*, *Doki Doki Literature Club*, *Pony Island*, *IMSCARED*) plus horror-pacing literature, organized around the five axes Main asked for: escalating fourth-wall breaks, UI that moves/bleeds/rots, fake-vs-real crashes, reward-calm pacing, and text-only entity dialogue.

Part B is a concrete design doc for OUR engine, grounded in what already ships today (`chaos.js`, `shadow.js`, `setStage()` act gates, host-broadcast round frames). Every technique names its implementation path in vanilla JS/CSS and carries an implementation-cost tag: **S** ≤ half-day, **M** 1–2 days, **L** 3+ days or needs new subsystem.

---

## PART A — Technique extraction

### A.1 Doki Doki Literature Club (Dan Salvato, 2017)

Observed mechanics (sources [1], [2], [5]):

| Move | Detail |
|---|---|
| File-level narrative | Characters die by their `.chr` files being deleted/corrupted; the player must delete `monika.chr` to proceed. |
| Persistent memory | `firstrun` file makes meta-events survive "New Game"; restoring deleted files gets detected and mocked — the game watches out-of-game actions. |
| UI-channel hijack | History log silently overwritten with *"Can you hear me?"* — the UI chrome itself becomes the entity's mouth. |
| Scripted instability aesthetics | `hxppy th0ughts.png`, realistic blinking eyes pasted onto a sprite: corruption is *content-shaped*, not just noise. |
| Personalized crash artifacts | Scripted "crashes" write a `traceback.txt` containing Monika's diary-like message — a diagnostic tool as love letter. |
| Menu amputation | The *Just Monika* room removes all standard menus; a void room + direct second-person address replaces the game. |

### A.2 Pony Island (Daniel Mullins, 2016)

Sources ([6], [7], [8]):

- **The game IS the antagonist**: the "boss fight" is against interface integrity itself, not a monster.
- **Fake platform UI**: fake error pop-ups, fake Steam chat from a dead friend, fake Steam dialogs — intrusion escalates from *in-game* to *platform* to *desktop*.
- **Degradation as escalation signal**: unresponsive menus, endlessly scrolling file paths, corrupted save/load telegraph that the fiction is failing on purpose.
- **Cryptic constants** (the `106008` signature) flickering inside broken menus sell "genuinely dying software" better than random noise.
- **Taught tools turn traitor**: the simple laser/hacking puzzles you learned become the verbs you use to attack the game itself.
- **Climax = self-deletion**: the player is asked to "delete Pony Island" from a convincing fake library/desktop — a trust-leap the whole game trains you for.

### A.3 IMSCARED — A Pixelated Nightmare (2012/2016)

Sources ([12], [13], [14], [15]):

- **Entity escapes into the OS**: real files appear in a desktop `imscared/` folder; they are hints *and* letters from White Face.
- **Persistence across launches**: `white.ini` stores progress/events; hauntings continue between sessions.
- **The real close**: at one scripted beat the game *actually quits* — the ultimate "fake crash was never fake" inversion.
- **Text-first presence**: White Face is a face + sparse centered text; no voice. Lo-fi presentation makes direct address feel closer, not cheaper.
- **Hijack ramp**: the longer you play, the more sinister files appear and the more the computer feels "hijacked" — escalation measured in intrusiveness steps.

### A.4 Inscryption (Daniel Mullins, 2021)

Sources ([16], [17]):

- **Horror host runs a cozy genre**: a warm wooden cabin card game with lethal stakes; dread comes from the gap between tone and consequence.
- **The table talks back**: cards whisper advice/threats; objects in the cabin are puzzles — the *game surface* is alive.
- **Looking away is a mechanic** (cuckoo clock beat): attention itself is played with.
- **Structural rupture as escalation**: acts don't just get darker, the *genre* is replaced; Act II recontextualizes everything seen in Act I.
- **Ritual calm between kills**: map walks, candles, card-picking interludes are genuinely peaceful — which is why the matches feel lethal.

### A.5 Pacing literature (tension/release)

- Constant intensity is numbing; horror needs rhythm — peaks, valleys, an escalation curve ([9]).
- Safe rooms work because *contrast* makes threat legible; relief is part of the fear mechanism ([10], [11]).
- Anticipation + uncertainty beat jump scares; discipline about when NOT to scare ([10]).

### A.6 Extraction by requested axis

| Axis | Canonical moves | Our technique IDs (§3.2) |
|---|---|---|
| Escalating 4th-wall breaks | UI-hijack → platform spoof → OS residue → self-deletion ladder (DDLC, PI, IMSCARED) | T2, T8, T9, T12, T13, T18, T20 |
| UI moves / bleeds / rots | Degradation-as-signal, content-shaped corruption (PI, DDLC) | T4, T5, T6, T14, T17 |
| Fake crashes vs real | Traceback.txt lies, fake dialogs, the real close (DDLC, PI, IMSCARED) | T11 (+ §3.3 doctrine) |
| Reward-calm pacing | Safe rooms, ritual interludes, contrast principle (Inscryption, [9][10][11]) | T15, T19, phase budgeting §3.1 |
| Text entity dialogue, no voice | White Face centered text, Just-Monika direct address, history-log hijack | T7 (+ §3.6 voice guide), T8, T14 |

---

## PART B — Design doc for OUR game

### 3.0 Grounding: hooks that already ship

Verified in the current tree (`index.html`, `chaos.js`, `shadow.js`) — we build on these, not beside them:

- `body.act-0..3` + `corr-N` classes; `setStage(n)` hard gates at rounds **3 / 5 / 7**; `PAL[4]` stage palettes.
- `CX` bridge → `IQ.Chaos`: `shake/glitch/flash/invert/pulse/embers/setIntensity/setAct`; canvas embers; breathing red vignette (act 2); scheduled ambient micro-glitches (act 1); scanline layer.
- `SH` bridge → `IQ.Shadow`: corner speech bubbles (max 2, 4s fade, optional TTS), context quip pools, and `Shadow.TIMELINE(round)` returning `zapAtFraction` (r1), `subtleGlitch` (r2), `paletteLevel`, `corruptChance` (r≥4), `shadowTalks` (r≥3), `impossibleChance` (r≥6).
- Host-authoritative MP: round frames already carry `corrupted` / `impossible` flags and a fixed option order — scoring-affecting horror is already broadcast-safe.
- `store` wrapper + `IQB_PROFILE_V1` (incl. `deepestStage`) = free cross-session memory; `IQB_MOTION` toggle = existing reduced-motion kill-switch.

**Gap analysis:** the current Shadow persona reads *comedic* (Sonic-flavored quips), presence is a small corner toast, rot is additive sparkle (embers/flash) rather than *decay of familiar things*, there is no central entity moment, no fake-crash beat, no choreographed calm-after-spike, and no cross-run haunting. The techniques below close those gaps.

### 3.1 Director model: `CorruptionDirector`

One module owns horror. Everything else subscribes.

```js
// New file horror.js — vanilla, no deps. Extends, does not replace, Chaos/Shadow.
IQ.Horror = (function () {
  var c = 0; // corruption 0..100
  var fx = []; // {id, min, max, weight, cooldownRounds, run(ctx)}
  function tick(evt, ctx) {
    // evt: 'roundStart' | 'answerRight' | 'answerWrong' | 'reveal' | 'idle'
    // pick eligible effects by corruption band, seeded PRNG per (roomCode,round,evt)
    // so MP tabs converge cosmetically with ZERO extra network traffic.
  }
  return { set: function(v){ c = v; }, band: function(){ return c; }, on: tick, register: function(e){ fx.push(e); } };
})();
```

- **Continuous meter** `corruption ∈ [0,100]`. Stage gates stay (r3/r5/r7 → bands 15/40/70 baseline) but effects read the *meter*, so pacing can drift within a stage.
- Meter moves: +6..10 per wrong answer, +3 per right answer in late stages (success attracts attention — DDLC's Monika punishes loving the club), −12 during engineered calms (T15), slow passive creep +1/round in P2+.
- **Budget rule:** at most ONE "hard" effect (T10, T11, T16) per round, at most TWO "soft" effects. Scarcity preserves potency — mirrors jump-scare discipline in [10].

**Phase ladder**

| Phase | Corruption | Feel | Signature techniques |
|---|---|---|---|
| P0 Cheerful | 0–14 | pristine bright quiz | nothing wrong |
| P1 Off Note | 15–34 | exactly one wrong thing per round | T1, T5, T12 |
| P2 Rot | 35–59 | familiar things decay | T4, T6, T14, T17 |
| P3 Breach | 60–84 | it knows YOU; the frame fails | T7, T8, T9, T11, T16 |
| P4 PANDemonium | 85–100 | takeover → epilogue | T18, T19, T20 |

---

(continued in part 2 — sections 3.2 through 5)
### 3.2 The twenty techniques

#### T1 · The Off Note — **cost S**
One single wrong detail while everything else stays cheerful (P1). Ref: DDLC's early wrongness; Inscryption's tone-gap.
**Impl:** after a correct reveal, one confetti particle falls *upward*; or the win-chime plays one semitone flat via Web Audio detune (repo has `audio.js` hooks). Once per round max.
**Why it works:** contrast priming — cheap, and it teaches players to distrust calm before you abuse calm.

#### T2 · Escalation Ladder (structural rupture) — **cost M**
Ref: Inscryption act replacements; DDLC's 4 acts; PI's arcade→OS→desktop climb.
**Impl:** keep `setStage` hard gates, but each gate *removes* something beloved, not just adds grime: r3 the lobby music loses its melody line (Web Audio: mute one oscillator bus); r5 the settings gear icon stops opening ("later."); r7 the LEAVE button label changes to "STAY." Escalation measured by *lost affordances*.
**Note:** never remove functions players need to finish a room — only delay/decorate them.

#### T3 · Corruption Meter — **cost M**
Described in §3.1. Backbone for every technique below; all effects register `{min,max}` bands against it. Deterministic mulberry32 seed = `hash(roomCode, round, effectId)` so multiplayer tabs see the same cosmetic rot with no packets.

#### T4 · UI Autonomy: Tile Drift & Bleed — **cost M**
Ref: PI degrading interface; DDLC script degradation. Answer tiles are the "familiar things" that must rot.

**Impl:** `#opts-grid .opt` gets a per-round CSS custom property `--rot`; keyframes translate/rotate tiles ±2–6px with 8–14s ease-in-out loops (subtle breathing, never during click targeting — pause animation on `pointerdown`). Bleed: `::after` radial-gradient blob anchored to a random corner, `mix-blend-mode:multiply`, scaleY drip animation, color sampled from `PAL[G.stage]` darkened. Board frame cracks: `#board-frame::before` with 2–3 thin `linear-gradient` streaks at corruption >50.
**Guard:** all under the `store.get('IQB_MOTION')` check exactly like `CX.shake` does today.

#### T5 · Palette Rot (continuous) — **cost S**
Between the discrete `PAL` stages, interpolate hue continuously: `#app { filter: hue-rotate(calc(var(--corr) * -0.6deg)) saturate(calc(1 - var(--corr) * 0.004)); }` driven by one rAF-updated CSS var. Cheap global sickness that makes hard stage-gates feel inevitable rather than sudden.

#### T6 · The Watcher Timer — **cost M**
Ref: Inscryption's watching table. The round timer becomes a character.
**Impl:** `#timer-fill` gains a pupil (`::after`, 8px dot) that tracks the mouse via a throttled `mousemove` handler mapping cursor X to a small translate (only P3+, only final 10s of a round). At corruption spikes the bar briefly runs backwards 300ms then snaps forward (visual only — real time unchanged, fairness preserved).

#### T7 · Central Typewriter Entity ("THE VOICE") — **cost M**
**The core ask.** Ref: White Face's sparse centered text; Just-Monika direct address; DDLC history-log hijack.
**Impl:** new `voiceOverlay(lines, done)`:
```js
function voiceOverlay(lines, done) {
  var d = el('div', 'voice-overlay');        // fixed inset-0, rgba(0,0,0,.82)
  var t = el('div', 'voice-text'); d.appendChild(t);
  // .voice-text: absolutely centered, font-family:'Courier New',monospace,
  // font-size clamp(28px, 6vw, 64px), font-weight 700, letter-spacing .04em,
  // color #e8e8f0; text-align center; max-width 80vw; user-select none;
  // z-index above #fx-layer.
  var li = 0, ci = 0;
  (function step() {
    if (li >= lines.length) return done && done();
    var line = lines[li];
    t.textContent = line.slice(0, ++ci);
    if (!t.textContent) { li++; ci = 0; return setTimeout(step, 700); } // inter-line breath
    var ch = line[ci - 1];
    if (/[.!?,]/.test(ch)) return setTimeout(step, 260 + Math.random() * 180); // punctuation pause
    setTimeout(step, 34 + Math.random() * 46);                                 // uneven cadence = alive
  })();
}
```
- Key words flip color mid-type by wrapping in a span (class `vx` → crimson `#ff2038`).
- Optional glyph shake on the LAST word of a threat: `animation: vx-jitter .12s steps(2) 3`.
- **Interrupt rule:** any player click during type-in completes the line instantly (never traps input), then auto-fades after ~1.6s dwell.
- Reuse for breach beats only (≤2 per match) — scarcity IS the horror. Existing corner bubbles (`SH.say`) remain for low-tier banter; the contrast between tiny corner whispers and one full-screen sentence is the escalation ladder made visible.
- No voice audio, ever: silence + typography (see T19). Optional single sub-bass thud via `audio.js` if present.

#### T8 · Name Theft — **cost S**
Ref: DDLC / IMSCARED personal address. The entity uses what the player typed.
**Impl:** `P.name` and room code already sit in localStorage. Quips carry a `YOU` token replaced at render: `quip.split('YOU').join(P.name || 'PLAYER_0')`. Late-game variant: entity calls the player by the name minus its last letter — it almost knows you.

#### T9 · Tab Awareness — **cost S**
Ref: IMSCARED's computer-awareness.
**Impl:** `document.addEventListener('visibilitychange', ...)`: if hidden ≤4s during a round, on return queue ONE Voice-lite bubble: "You looked away." + tiny `CX.glitch(120)`. Cooldown: once per match. Zero gameplay effect.

#### T10 · Cursor Gaslight — **cost M (recommended) / L (with divergence)**
Ref: PI interface betrayal.

**Impl (scripted beat ONLY, once per match, P3):** spawn a duplicate cursor div mirroring the real cursor with growing lag (200→600ms), then diverging toward a wrong answer; real cursor hidden (`body{cursor:none}`) for ≤3s. Breaking condition: two fast clicks anywhere, or 3s timeout — control returns with a Voice line "that wasn't me." **Never** move the real pointer or block clicks; the dodge is theater.

(continued in part 3 — T11 through sources)

#### T11 · Fake Crash: The Blue Lie — **cost M**
Ref: DDLC traceback.txt, PI fake error dialogs, IMSCARED real close (we deliberately do the *fake* version — see §3.3).
**Impl:** fullscreen overlay child of `#fx-layer`: near-black blue `#000a33`, big ":(" glyph, fake stop-code `PANDA_0x1Q84`, frozen timestamp = session boot time (tell #1), progress counter that hits 100% then counts DOWN (tell #2). After 2.6–4s the overlay TEARS: animated jagged `clip-path: polygon(...)` slit, THE VOICE types one line through the tear ("still here."), overlay dissolves, flow resumes exactly where the inter-round gap left it.
**Rules:** DOM-only (§3.3); skippable (Esc ×3 or 5 clicks or 4s timeout); scheduled in the inter-round gap so zero fairness impact in MP; once per match.

#### T12 · Console Séance — **cost S**
Ref: DDLC log hijack.
**Impl:** on stage-gate crossings, `console.log('%c ', cssBigArt)` + plain lines referencing the live room code. Also log a fake stack trace whose frame names spell P-A-N-D-A vertically (Pony Island's `106008` energy). ~20 LOC, zero risk.

#### T13 · Title-Bar Whisper — **cost S**
Ref: browser-native fourth wall.
**Impl:** sequence `document.title`: "IQ Versus" → "IQ Versu­s" (soft hyphen) → "are you still there?" → restore, 900ms apart, once at P3 entry. Favicon: draw the smiley tile on a 32×32 canvas; at P3 redraw hollow-eyed and swap via `link.href = canvas.toDataURL()`. No permissions needed.

#### T14 · Scoreboard Possession — **cost M**
Ref: talking cards / roster corruption.
**Impl:** one rival row (`.score-card`) chosen at match start (seeded). From P2 its name decays letter-by-letter across rounds (string mask keyed by `corruption`). From P3 its score ticks +7 whenever the PLAYER answers wrong ("it feeds on your misses") — pure theater; real standings untouched until match end where the theater row is revealed as always-last. Hooks the existing `renderScores()`.

#### T15 · Reward-Calm Interludes — **cost S**
**The tension-release engine.** Ref: Inscryption cabin rituals; safe-room contrast ([9],[10],[11]).
**Impl:** every hard beat (T10/T11/T16/T18) schedules the NEXT round as a Calm Round: `body.calm` class → warm palette override (hue-rotate toward 0, saturation +10%), `CX.inten(0.1)`, an easy puzzle (existing difficulty-1 generator path), confetti pulse reused from the win flow, and a Shadow bubble that is almost kind ("that one was fair. enjoy it."). Exactly ONE wrong detail smuggled in (T1 pattern) — e.g., the confetti is grey. Meter −12.
**Budget:** never two spikes adjacent; cadence is spike → calm → normal → spike… Players learn calm = suspicious, which is the point.

#### T16 · The Deletion Beat — **cost M**
Ref: DDLC file deletion; PI deletion finale (miniaturized).
**Impl (host-driven, shipped in the round frame like today's `corrupted` flag):** at P3 one WRONG option renders normally, then mid-round visibly "deletes": strikethrough → `visibility:hidden` with a Voice line "removed. you weren't going to pick it." Ground truth preserved (it was wrong anyway); clicking it in time scores normal-wrong. Flag arrives from host broadcast → MP-consistent. Once per match.

#### T17 · Zalgo Creep — **cost S**
Ref: DDLC glitch aesthetics.
**Impl:** combining-char injector `zalgo(str, n)` adding n marks from U+0300–U+036F to vowels; density = f(corruption). Applied ONLY to entity lines and the possessed rival's name (T14) — never question/answer text (readability = fairness).

#### T18 · Desktop Residue (opt-in) — **cost M**
Ref: IMSCARED's desktop folder.
**Impl:** web-safe version: at P4 entry THE VOICE offers "i kept something for you." → button generates `panda_note.txt` ("see you next run.") via `Blob` + `URL.createObjectURL` download. **Default OFF behind a Settings toggle** (writing real files needs consent); in-page fallback: fake file-panel modal showing the note. Zero filesystem access without explicit opt-in.

#### T19 · Silence Weaponized — **cost S**
Ref: pacing lit — absence as spike.
**Impl:** since THE VOICE has no audio, the music bed is the tell: duck master gain to 0 over 400ms at spike onset (via existing `AU` bridge), hold silent through the beat, restore over 2s. Pair with vignette darkening. By round 6, sudden silence alone triggers dread — conditioned response, no assets required.

#### T20 · Reset With Memory — **cost M**
Ref: DDLC `firstrun`; IMSCARED `white.ini`.
**Impl:** epilogue after P4: UI visually restores to P0 (all filters cleared, cheerful palette) — then one line: "thank you for playing. again sometime, NAME." Persist `deepestStage` (already stored!) plus new `IQB_HAUNT_V1 = { metVoice:true, missedCategories:[...] }`. Next run's P1 Off Note references last run: "back so soon. you missed CATEGORY last time." Cross-session haunting, zero backend.

---

### 3.3 Fake-vs-real crash doctrine (non-negotiables)

1. **Fake crashes are DOM-only.** Overlay div inside `#fx-layer`; never intercept `window.onerror`, never `location.reload()`, never storage wipes, never unload handlers. Real errors route to an honest, boring toast (separate path, ships today).
2. **Plausible-but-wrong details are load-bearing**: frozen boot-time clock, backwards progress, nonsense-yet-formatted stop-code (`PANDA_0x1Q84`). On reflection the player realizes it lied — that delayed realization is the reward loop (Pony Island's `106008` trick).
3. **Always escapable:** Esc ×3 / 5-click / 4s hard timeout. Never trap input, especially in MP rooms.
4. **Never fake a REAL event we don't control:** don't simulate tab-close, don't fake WebRTC disconnects — players will troubleshoot real networking against a lie.
5. **Schedule in dead zones:** inter-round gaps only; the host's round timer never pauses for cosmetics.

### 3.4 Multiplayer & fairness rules

- **Cosmetics** (T4, T5, T6, T12, T13, T17, T19): client-local, seeded deterministically per (roomCode, round) → converge without packets.
- **Narrative beats** (T7, T8, T9, T11, T15, T18, T20): client-local timing off the shared round number; no sync needed because they touch no state.
- **State-touching beats** (T16 deletion, existing `impossible`/`corrupted` flags): host-decided, shipped in the round frame exactly like today's flags. Clients never invent scoring events.
- One player's fake crash says nothing about another's screen; each tab experiences meta-events privately — that asymmetry is a feature (streamer clip fuel).

### 3.5 Safety & accessibility rails

- All motion gated on the existing `IQB_MOTION` preference (pattern already used by `CX.shake`).
- Photosensitivity: no full-screen flashes above 3 Hz; `CX.flash` capped ≤200ms; fake-crash tear is a slow clip-path morph, not a strobe.
- Readability floor: question/answer text never zalgo'd, never animated, never recolored beyond `PAL` stages (fairness = horror you can opt out of; confusion you can't).
- Content ceiling: dread via implication; no gore text, no real-OS threats ("i will delete your files" banned; "i kept something for you" allowed).
- Lobby "Shadow Mode" toggle evolves to three-way **Nightmare: OFF / GENTLE / FULL** — OFF strips all P3+ meta beats for accessibility and streamer-safety.

### 3.6 Copy guide for THE VOICE (text-only, no voice audio)

- Second person, present tense, ≤12 words per line, one line per beat (two max).
- Never exclamation marks. Periods only. At P4 the periods start disappearing.
- It capitalizes YOUR name perfectly; its own words drift lowercase as corruption rises.
- It never lies about gameplay facts (what it says about answers is true; what it says about itself is not).
- Sample ladder: P1 "nice." → P2 "you always pick third." → P3 "DAVE. that is your word for you." → P4 "keep the points. i kept you."

---

## 4. Top 5 techniques (highest dread-per-line-of-code)

1. **T7 Central Typewriter Entity** (M) — biggest presence upgrade; pure DOM text, zero assets.
2. **T15 Reward-Calm Interludes** (S) — converts existing win-flow into dread conditioning; cheapest multiplier on every other technique.
3. **T11 Fake Crash: The Blue Lie** (M) — signature meta beat; DOM-only doctrine keeps it safe.
4. **T3 Corruption Meter + T2 Escalation Ladder** (M) — the spine; turns binary stage flips into paced inevitability.
5. **T4 UI Autonomy: Tile Drift & Bleed** (M) — makes the familiar quiz surface itself the antagonist (Pony Island's core move).

## 5. Sources

- [1] shapes.inc — DDLC File Manipulation & Meta-Horror: https://shapes.inc/fandom/doki-doki-literature-club/meta-elements
- [2] Simply Put Psych — DDLC and the Horror of Being Edited: https://simplyputpsych.squarespace.com/gaming-psych/inside-the-minds-of-doki-doki-literature-club
- [5] DDLC Wiki — Possible Endings: https://doki-doki-literature-club.fandom.com/wiki/Possible_Endings
- [6] PlayXIX — Pony Island's Deletion Sequence: https://playxix.com/blog/pony-island-deletion-sequence-meta-boss-2016-1776221199973
- [7] Wikipedia — Pony Island: https://en.wikipedia.org/wiki/Pony_Island
- [8] Baidu Baike — Pony Island: https://baike.baidu.com/en/item/Pony%20Island/3328837
- [9] Lighthouse Keeper — The Slow Burn: Pacing Tension Across a Night of Horror: https://www.lighthousekeepergame.com/blog/pacing-tension-horror-game
- [10] Solana.garden — Game Horror Design Explained: https://solana.garden/guides/game-horror-design-explained/
- [11] The Games Edge — The Safe Room: How Game Designers Create Horror: https://thegamesedge.com/the-safe-room-how-game-designers-create-horror/
- [12] IMSCARED Wiki — Files: https://imscared.fandom.com/wiki/Files
- [13] Steam Community — IMSCARED desktop invasiveness thread: https://steamcommunity.com/app/429720/discussions/0/3812908123778885272/
- [14] The Codex — White Face: https://thecodex.wiki/IMSCARED_-_A_Pixelated_Nightmare/White_Face
- [15] TV Tropes — Imscared: https://tvtropes.org/pmwiki/pmwiki.php/VideoGame/Imscared
- [16] Inscryption Wiki — Act I: https://inscryption.fandom.com/wiki/Act_I
- [17] Ludo.guide — Act I: Leshy's Cabin: https://www.ludo.guide/guide/inscryption/act-i-leshys-cabin
