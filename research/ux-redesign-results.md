# UX REDESIGN SPEC — RESULTS · EMERALD INTERLUDE · HOST LOBBY
### Shadow-themed pass for IQ Battle: Shadow · implementable by Main in one pass · zero external assets

**Author:** UXResults · **Date:** 2026-08-24

---

## 0. Ground rules (read first)

1. **No assets.** Everything is HTML + CSS + inline SVG. No images, no fonts, no fetches.
2. **Preserve wiring contracts** — these are load-bearing and MUST survive the redesign:
   - Lobby: `#scr-lobby`, `.panel` (RoomUI mounts on the *first* `.panel`), `#lobby-title`,
     `#lobby-count` (MutationObserver fallback), all `#cfg-rounds / #cfg-timer / #cfg-diff /
     #cfg-forged / #cfg-shadow / #cfg-start / #lobby-back` IDs, and the two buttons'
     flex row. `room-ui.js` injects its presence block *below* `#lobby-count`.
   - Interlude: `.interlude-bg` overlay element created in `emeraldPick()`;
     `.relic-card[data-i]` with `role="button" tabindex="0"` per card (JS binds click +
     Enter/Space and focuses the first card). Keep every class/data attribute.
   - Results: rendered into `#center-content`; buttons keep IDs `#home-btn` / `#again-btn`
     (handlers bind by ID after innerHTML swap).
   - Shadow speech (`SH.say`) stays bottom-right bubbles for mid-run quips, BUT on these
     three screens the **headline line is central, high, large** — see §1.3. No TTS anywhere.
3. **Palette discipline:** reuse luxe tokens where the scene is "calm" (`--panel --ink
   --muted --acc-a --acc-b --grad`); introduce one new local token block `--shx-*` for
   Shadow-realm chrome (crimson/emerald). All new CSS goes in ONE appended block in
   `luxe.css` marked `/* ===== shadow ux redesign (ux-results) ===== */`.
4. **Motion safety:** every animation wrapped in `@media (prefers-reduced-motion: reduce)
   { animation: none }` guard — one combined guard at the end of the block covers all.
5. Mobile: all three screens verified at 375px — specs use `min()/clamp()` sizing and
   `flex-wrap`; no fixed widths above 94vw.

New tokens (append once):

```css
/* ===== shadow ux redesign (ux-results) ===== */
:root{
  --shx-crimson:#c01028;
  --shx-crimson-hot:#ff2038;
  --shx-emerald:#00e68a;
  --shx-emerald-deep:#067a4b;
  --shx-parchment:#0d0a14;
  --shx-parchment-edge:#1a1424;
  --shx-wax:#8e1220;
  --shx-wax-hi:#c22a38;
}
```

---

## 1. RESULTS — "THE CONTRACT"

A match-end scroll: a dark parchment contract whose body text legally records what just
happened, with the final score pressed into a wax seal. Shadow's verdict sits CENTRAL,
HIGH, LARGE above the scroll.

### 1.1 Layout (single column, centered)

```
        [ SHADOW VERDICT LINE — central, high, large ]
        [ small sub-line: match terminated · date-of-descent ]
        [ ================= CONTRACT SCROLL ================= ]
        |  top deckle edge (CSS zigzag)                      |
        |  "CONTRACT OF ASCENSION — CLAUSE VII"              |
        |  body clauses (name, rival, rounds, verdict text)  |
        |  followers strip (unchanged content, restyled)     |
        |  [WAX SEAL overlapping bottom-right of scroll]     |
        [ =========== end scroll =========== ]
        [ Back To Lobby ]  [ Descend Again ]                 (existing btns, same IDs)
```

### 1.2 Exact HTML (replacement for the `$('#center-content').innerHTML=…` block in
`endRun()`, index.html ~line 503). Template-literal style identical to current code.

```html
<div class="verdict-wrap">
  <div class="shx-verdict ${won?'win':'lose'}">${won?(G.stage>=3?'SHADOW BOWS. YOU WON.':'YOU OUTSCORED THE ROOM'):'THE ROOM OUTSCORED YOU'}</div>
  <div class="shx-verdict-sub">match terminated &middot; contract sealed</div>

  <div class="contract-scroll" role="document" aria-label="Match contract">
    <div class="scroll-deckle top"></div>
    <div class="scroll-body">
      <div class="contract-head">CONTRACT OF ASCENSION &mdash; CLAUSE VII</div>
      <div class="contract-rule"></div>
      <p class="clause">This document certifies that subject
        <b class="cl-name">${esc(P.name)}</b> descended ${G.totalRounds} rounds into the
        gauntlet and emerged with ${won?'favor':'debt'}.</p>
      <p class="clause">Rival tally: <b>${topRival}</b>. Subject tally:
        <b class="${won?'good':'bad'}">${G.score}</b>.
        ${won?'The house acknowledges the upset.':'The house keeps what it is owed.'}</p>
      ${newF.length?'<div class="followers-strip">'+newF.map(f=>`<div class="follower-chip">${esc(f)}</div>`).join('')+'</div><p class="clause fine">Signatories bound to your next descent:</p>':''}
    </div>
    <div class="scroll-deckle bottom"></div>
    <div class="wax-seal ${won?'seal-win':'seal-loss'}" aria-hidden="true">
      <span class="wax-score">${G.score}</span>
    </div>
  </div>

  <div style="display:flex;gap:12px;margin-top:22px">
    <button class="btn btn-primary" id="home-btn">Back To Lobby</button>
    <button class="btn btn-danger" id="again-btn">Descend Again</button>
  </div>
</div>
```

Keep the existing post-innerHTML bindings verbatim (`$('#again-btn').onclick`,
`$('#home-btn').onclick`, `AU.p(won?'laugh':'scream')`, `CX.shake(10,380)`,
`if(G.stage>=3)SH.say(...)`).

### 1.3 Shadow speech placement rule (applies to ALL three screens)

The verdict line IS the Shadow line when stage ≥ 3 — it must be:

```css
.shx-verdict{
  font-size:clamp(28px,min(7vw,58px));font-weight:900;letter-spacing:.04em;
  text-align:center;text-transform:uppercase;line-height:1.05;
  max-width:min(92vw,880px);margin:0 auto;
}
.shx-verdict.win{color:var(--shx-emerald);
  text-shadow:0 0 18px rgba(0,230,138,.35),0 0 60px rgba(0,230,138,.15)}
.shx-verdict.lose{color:var(--shx-crimson-hot);
  text-shadow:0 0 18px rgba(255,32,56,.35),0 0 60px rgba(255,32,56,.15)}
.shx-verdict-sub{font-size:11px;letter-spacing:.34em;text-transform:uppercase;
  color:var(--muted);text-align:center;margin-top:10px}
```

It sits at the TOP of `#center-content` (high), centered horizontally (central), and is
the largest type on screen (large). The bottom-right `SH.say` bubble may still fire —
it is secondary garnish, never the headline.

### 1.4 Contract scroll CSS

```css
.verdict-wrap{display:flex;flex-direction:column;align-items:center;
  width:min(760px,94vw);margin:0 auto;padding:26px 12px 40px}

.contract-scroll{position:relative;width:min(620px,90vw);margin-top:26px;filter:drop-shadow(0 24px 50px rgba(0,0,0,.6))}
.scroll-body{
  background:
    repeating-linear-gradient(0deg,rgba(255,255,255,.016) 0 1px,transparent 1px 4px),
    linear-gradient(180deg,var(--shx-parchment) 0%,#120c1c 100%);
  border-left:1px solid var(--shx-parchment-edge);
  border-right:1px solid var(--shx-parchment-edge);
  padding:30px 44px;color:#d9cfe8}
.contract-head{text-align:center;font-weight:900;font-size:14px;
  letter-spacing:.42em;color:#b39ad0;text-transform:uppercase}
.contract-rule{height:2px;margin:14px auto 20px;width:70%;
  background:linear-gradient(90deg,transparent,var(--shx-crimson),transparent)}
.clause{font-size:13.5px;line-height:1.75;margin:10px 0}
.clause b{color:#fff}
.clause.fine{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
.cl-name{color:var(--shx-emerald)} .clause b.good{color:var(--shx-emerald)} .clause b.bad{color:var(--shx-crimson-hot)}

/* deckle (torn) edges: zigzag via conic gradient strips */
.scroll-deckle{height:14px;background:
  conic-gradient(from -45deg at 50% 100%,var(--shx-parchment) 90deg,transparent 0) 0 0/22px 100% repeat-x}
.scroll-deckle.top{transform:scaleY(-1)}
```

*(Deckle trick: top edge flips the same zigzag so both ends look torn off the roll.
If `conic-gradient` support is a concern on target browsers, acceptable fallback:
`background:linear-gradient(-45deg,transparent 75%,var(--shx-parchment) 0) 0 0/16px 16px,
 linear-gradient(45deg,transparent 75%,var(--shx-parchment) 0) 8px 0/16px 16px repeat-x`.)*

### 1.5 Wax seal (pure CSS blob + embossed digits)

```css
.wax-seal{
  position:absolute;right:-26px;bottom:-30px;
  width:112px;height:112px;display:flex;align-items:center;justify-content:center;
  /* irregular wax blob: four uneven radii + tiny rotation */
  border-radius:46% 54% 52% 48% / 51% 47% 53% 49%;
  transform:rotate(-8deg);
  background:
    radial-gradient(circle at 32% 28%,var(--shx-wax-hi),transparent 46%),
    radial-gradient(circle at 68% 74%,rgba(0,0,0,.55),transparent 52%),
    radial-gradient(circle at 50% 50%,var(--shx-wax) 62%,#5f0a14 100%);
  box-shadow:inset 0 3px 8px rgba(255,255,255,.18),
             inset 0 -6px 12px rgba(0,0,0,.6),
             0 10px 26px rgba(0,0,0,.55);
  animation:wax-press .45s cubic-bezier(.2,1.6,.4,1) .5s backwards}
.wax-score{font-size:26px;font-weight:900;font-variant-numeric:tabular-nums;color:rgba(0,0,0,.55);
  text-shadow:0 1px 0 rgba(255,255,255,.25);letter-spacing:.02em}
.seal-win .wax-score{color:var(--shx-emerald-deep);text-shadow:0 1px 0 rgba(255,255,255,.3)}
@keyframes wax-press{from{transform:rotate(-8deg) scale(2.2);opacity:0}
  60%{transform:rotate(-8deg) scale(.94);opacity:1}to{transform:rotate(-8deg) scale(1)}}
@media(max-width:520px){.wax-seal{right:-8px;bottom:-24px;width:92px;height:92px}.wax-score{font-size:21px}}
```

Seal slams down (scale 2.2→1 overshoot) half a second after the screen lands — reads as
the stamp moment. Pair with one extra `AU.p('stamp')` if audio.js grows it; otherwise the
existing `AU.p('laugh'/'scream')` covers the beat.

---

## 2. EMERALD INTERLUDE — "THE OFFERING"

Round 3/6/9 overlay. Shadow's gloved hand rises from the bottom of the screen, palm-up,
offering three floating Chaos Emeralds above it. Player takes one; the other two sink
back with the hand. **Interaction contract unchanged**: same `.relic-card[data-i]`
buttons, same key handling — the hand/emeralds are presentation layered around them.

### 2.1 Exact HTML (replacement for the `w.innerHTML=` assignment in `emeraldPick()`,
index.html ~line 474)

```html
<div class="offer-stage">
  <svg class="offer-hand" viewBox="0 0 320 300" aria-hidden="true">
    <!-- forearm: black glove, white cuff (original fan-art silhouette) -->
    <path d="M150 300 L146 210 Q144 190 160 182 L196 164 Q216 154 232 168 L252 188 Q262 200 250 212 L214 240 L206 300 Z"
          fill="#0b0b12" stroke="#1d1d2b" stroke-width="2"/>
    <!-- knuckle ridge -->
    <path d="M198 172 Q222 158 244 180" fill="none" stroke="#26263a" stroke-width="3" stroke-linecap="round"/>
    <!-- white cuff -->
    <rect x="128" y="272" width="96" height="26" rx="10" fill="#e8ecf6"/>
    <rect x="128" y="272" width="96" height="26" rx="10" fill="url(#cuffShade)"/>
    <defs>
      <linearGradient id="cuffShade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".85"/>
        <stop offset="1" stop-color="#aab4cc" stop-opacity=".6"/>
      </linearGradient>
    </defs>
    <!-- palm glow -->
    <ellipse cx="205" cy="185" rx="52" ry="20" fill="#00e68a" opacity=".12"/>
  </svg>

  <div class="offer-head">a chaos emerald surfaces</div>
  <div class="offer-sub">take one. the rest belong to shadow.</div>

  <div class="relic-row">
    <!-- UNCHANGED per-card template from current code: -->
    <div class="relic-card offer-card" role="button" tabindex="0" aria-label="Pick ${r.n}" data-i="${i}">
      <svg class="offer-gem" viewBox="0 0 64 72" aria-hidden="true">
        <polygon points="32,2 58,20 48,64 16,64 6,20" fill="#0aff9d" opacity=".16"/>
        <polygon points="32,2 58,20 32,30 6,20" fill="#7dffce" opacity=".85"/>
        <polygon points="6,20 32,30 16,64" fill="#00e68a" opacity=".8"/>
        <polygon points="58,20 32,30 48,64" fill="#06b26b" opacity=".9"/>
        <polygon points="32,30 48,64 16,64" fill="#038a54"/>
        <polygon points="32,2 58,20 32,30 6,20" fill="none" stroke="#bfffe6" stroke-width="1.4"/>
        <polyline points="6,20 32,30 58,20" fill="none" stroke="#bfffe6" stroke-width="1.2" opacity=".7"/>
      </svg>
      <div class="relic-icon">${r.icon}</div>
      <div class="relic-name">${r.n}</div>
      <div class="relic-desc">${r.d}</div>
    </div>
    <!-- ×3 -->
  </div>
</div>
```

Notes for Main:
- The gem `<svg>` replaces nothing functionally — it sits ABOVE `.relic-icon` inside each
  card as the offered stone; `.relic-icon` emoji stays as the relic glyph.
- Overlay root still gets `class="interlude-bg"` and the existing `AU.p('sacrifice')`,
  pick handlers, focus call — untouched.

### 2.2 CSS

```css
.interlude-bg{background:rgba(3,2,8,.93)} /* deepened for this scene */

.offer-stage{position:relative;display:flex;flex-direction:column;align-items:center;width:100%}
.offer-hand{
  position:fixed;left:50%;bottom:-8px;transform:translateX(-46%);
  width:min(340px,70vw);pointer-events:none;z-index:0;
  filter:drop-shadow(0 -6px 30px rgba(0,230,138,.12));
  animation:hand-rise 1.1s cubic-bezier(.2,.9,.25,1) both}
.offer-head{position:relative;z-index:1;font-size:26px;font-weight:900;
  letter-spacing:.3em;color:#fff;text-transform:uppercase;text-align:center;
  margin-top:min(20vh,170px)} /* clears the rising forearm */
.offer-sub{position:relative;z-index:1;font-size:11px;letter-spacing:.24em;
  opacity:.5;margin-top:6px;text-align:center}
.relic-row{position:relative;z-index:1;margin-top:26px}

/* offered stones hover over the cards */
.offer-gem{width:52px;height:58px;display:block;margin:0 auto 6px;
  filter:drop-shadow(0 0 14px rgba(0,230,138,.5));
  animation:gem-float 2.6s ease-in-out infinite}
.offer-card:nth-child(2) .offer-gem{animation-delay:.4s}
.offer-card:nth-child(3) .offer-gem{animation-delay:.8s}
.relic-card.offer-card:hover .offer-gem,
.relic-card.offer-card:focus-visible .offer-gem{filter:drop-shadow(0 0 26px rgba(0,230,138,.95))}

@keyframes hand-rise{from{transform:translateX(-46%) translateY(105%)}
  to{transform:translateX(-46%) translateY(0)}}
@keyframes gem-float{0%,100%{transform:translateY(0) rotate(-2deg)}
  50%{transform:translateY(-7px) rotate(2deg)}}
@media(max-width:600px){
  .offer-hand{width:60vw;bottom:-4vw}
  .offer-head{margin-top:min(24vh,140px);font-size:19px}
  .relic-row{gap:10px}
}
```

On pick, before `w.remove()`, add one class for the retreat beat (optional, 400ms):
`w.classList.add('taking')` then remove after timeout —

```css
.interlude-bg.taking .offer-hand{transition:transform .4s ease-in;transform:translateX(-46%) translateY(110%)}
.interlude-bg.taking .relic-card:not(:hover):not([data-taken]) .offer-gem{opacity:.15}
```

(Simpler accepted variant: skip `.taking`, keep instant removal — behavior unchanged.)

---

## 3. HOST LOBBY — "THE WATCHER"

Lobby panel stays functionally identical; Shadow now looms BEHIND it, half-lit, red eyes
glowing, quill silhouette breaking the panel's top edge. He watches the roster: the eye
glow intensifies as player count grows (pure CSS via `data-count` set in one line).

### 3.1 Exact HTML (full replacement for `#scr-lobby` section, index.html lines 39–55)

```html
<section id="scr-lobby" class="hidden" style="flex:1;display:flex;align-items:center;justify-content:center">
  <div class="watcher-scene">
    <svg class="watcher" viewBox="0 0 420 260" aria-hidden="true">
      <!-- original fan-art silhouette: angular quilled head, three upward quills -->
      <g fill="#07070d" stroke="#15151f" stroke-width="2">
        <path d="M60 250 L84 150 Q92 118 122 108 L96 44 Q130 66 148 96 Q160 60 186 40 Q192 78 184 104 Q214 88 246 100 Q222 124 208 136 L232 250 Z"/>
      </g>
      <!-- red streak quills -->
      <path d="M96 44 L118 92 M148 96 L162 102 M186 40 L184 98" stroke="#c01028" stroke-width="7" stroke-linecap="round" fill="none" opacity=".85"/>
      <!-- eyes: glow driven by --eye (set via data-count) -->
      <g class="watcher-eyes">
        <ellipse cx="150" cy="132" rx="11" ry="7" fill="#ff2038"/>
        <ellipse cx="196" cy="128" rx="11" ry="7" fill="#ff2038"/>
        <ellipse cx="153" cy="131" rx="4" ry="2.6" fill="#ffd9de"/>
        <ellipse cx="199" cy="127" rx="4" ry="2.6" fill="#ffd9de"/>
      </g>
      <!-- sneer -->
      <path d="M150 168 Q176 178 204 166" stroke="#c01028" stroke-width="4" fill="none" stroke-linecap="round"/>
    </svg>

    <div class="panel lobby-panel">
      <h2 id="lobby-title">Room</h2>
      <!-- ALL rows below are byte-identical to current markup: -->
      <div class="cfg-row"><label>Rounds</label><input type="number" id="cfg-rounds" min="5" max="20" value="10"></div>
      <div class="cfg-row"><label>Round Timer (s)</label><input type="number" id="cfg-timer" min="15" max="120" value="60"></div>
      <div class="cfg-row"><label>Torment</label><div class="seg" id="cfg-diff">
        <button data-v="1">Gentle</button><button data-v="2" class="on">Standard</button><button data-v="3">Hard</button><button data-v="4">Brutal</button><button data-v="5">Impossible</button>
      </div></div>
      <div class="cfg-row"><label>Include Forged</label><div class="sw" id="cfg-forged"></div></div>
      <div class="cfg-row"><label>Shadow Mode</label><div class="sw on" id="cfg-shadow"></div></div>
      <div class="roster-note">Players here: <b id="lobby-count">1</b></div>
      <div style="display:flex;gap:12px">
        <button class="btn btn-danger" id="lobby-back">Leave</button>
        <button class="btn btn-primary" id="cfg-start" style="flex:1">START</button>
      </div>
    </div>
  </div>
</section>
```

⚠ RoomUI compat: it queries `$('.panel')` (first on page) and anchors under
`#lobby-count`. The watcher `<svg>` precedes the panel inside a NEW wrapper
(`.watcher-scene`) — the lobby panel remains the page's FIRST `.panel`, so mounting is
unaffected. Verify `IQ.RoomUI.mount()` renders inside `.lobby-panel`.

### 3.2 One-line JS hook (in `listenNet()`'s lobby handler AND after join/host sets count —
i.e., wherever `$('#lobby-count').textContent=…` is assigned, append):

```js
const wc=document.querySelector('.watcher');if(wc)wc.dataset.count=Math.min(+G.players.length||1,5);
```

(Fallback-safe: if `.watcher` missing, no-op.)

### 3.3 CSS

```css
.watcher-scene{position:relative;display:flex;align-items:center;justify-content:center;width:100%}
.watcher{
  position:absolute;top:-118px;left:50%;transform:translateX(-58%) scale(.9);
  width:min(380px,72vw);pointer-events:none;z-index:0;
  opacity:.92;filter:drop-shadow(0 18px 40px rgba(0,0,0,.7));
  animation:watcher-breathe 5.2s ease-in-out infinite}
/* he leans over the panel's shoulder: panel overlaps his lower half */
.lobby-panel{position:relative;z-index:1;margin-top:64px;
  box-shadow:var(--shadow),0 0 60px rgba(192,16,40,.08)}

/* eye heat scales with headcount */
.watcher-eyes ellipse{transition:filter .6s}
.watcher[data-count="1"] .watcher-eyes{filter:drop-shadow(0 0 4px rgba(255,32,56,.5))}
.watcher[data-count="2"] .watcher-eyes{filter:drop-shadow(0 0 9px rgba(255,32,56,.8))}
.watcher[data-count="3"] .watcher-eyes{filter:drop-shadow(0 0 14px rgba(255,32,56,1))}
.watcher[data-count="4"] .watcher-eyes{filter:drop-shadow(0 0 20px rgba(255,32,56,1))}
.watcher[data-count="5"] .watcher-eyes{filter:drop-shadow(0 0 26px #ff2038)}

.roster-note{font-size:11px;opacity:.55;margin:4px 0 10px}

@keyframes watcher-breathe{
  0%,100%{transform:translateX(-58%) scale(.9)}
  50%{transform:translateX(-57.2%) scale(.925) rotate(-.6deg)}}

@media(max-width:600px){
  .watcher{top:-86px;width:78vw}
  .lobby-panel{margin-top:44px;padding:20px 18px}
}
@media(prefers-reduced-motion:reduce){
  .wax-seal,.offer-hand,.offer-gem,.watcher{animation:none}
}
```

Optional garnish (recommended, +1 line in `openLobby()`):
`AU.p('whisper',{vol:.15})` — low ambience cue as the Watcher appears.

---

## 4. Integration checklist for Main (one pass)

| # | File | Change |
|---|------|--------|
| 1 | `luxe.css` | Append §0 tokens + §1.3–1.5 + §2.2 + §3.3 blocks, one banner comment |
| 2 | `index.html` `endRun()` (~L503) | Swap innerHTML block for §1.2 (keep all bindings below it) |
| 3 | `index.html` `emeraldPick()` (~L474) | Swap `w.innerHTML` for §2.1 (keep overlay class, AU.p, handlers, focus) |
| 4 | `index.html` `#scr-lobby` (~L39–55) | Replace section with §3.1 (all cfg/count/button IDs intact) |
| 5 | `index.html` `listenNet()` lobby handler + host/join count writes | Add the one-line `.watcher` dataset hook (§3.2) |
| 6 | Optional | `.taking` retreat class on pick (§2.2); whisper SFX in `openLobby()` |

Regression gates: solo run to results shows seal-stamp animation and correct score in
seal; emerald round keyboard-only (Tab → Enter) picks a card; 2-player lobby shows
RoomUI chips under `Players here:` and eyes brighten on second join; 375px viewport —
no horizontal scroll on any of the three screens; zero console errors.
