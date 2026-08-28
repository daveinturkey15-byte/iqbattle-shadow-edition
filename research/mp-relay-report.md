# MP Relay Verification Report — staged two-browser multiplayer
**Wave A · agent `QAMPRelay` · 2026-08-25 · project root `C:/Users/david/Desktop/stuff/iqbattle`**
Scope: read-only audit of game code; NEW files only (`research/mp-relay-report.md`). Dev server: hub daemon `iqbattle-dev` (Bun, port **8791**, `Cache-Control: no-store` verified via curl). Browser tool, two named tabs `host` / `join` at `http://localhost:8791/`.

## ⚠ Build pinning note
`index.html` was edited mid-session by another writer (mtime 12:47; file tag changed `#145E`→`#2209`). Two builds were exercised:
- **Build A** (loaded ≈12:0x): used for steps 1–5 and the first elimination run.
- **Build B** (current, loaded ≈12:5x): adds `IQ.LMS.evaluateElimination`, `{t:'elim'}` broadcast/receiver, `G.humanHp`. Used for the re-run of step 6.
Findings below state which build they apply to. Line numbers cite **Build B (current)** unless marked [A].

## Results matrix
| Step | What was verified | Verdict |
|---|---|---|
| 1 | HOSTER hosts, 5-char code in lobby title | **PASS** |
| 2 | JOINER joins; both lobbies show identical 2-player roster | **PASS** |
| 3 | Both tabs mount same stage id+seed after START | **FAIL natively** (D1) / **PASS via harness-relayed frame** |
| 4 | Answers relayed; reveal scores fold both sides; totals match | **PASS** (with intermittent anomaly D5) |
| 5 | LMS toggle → JOINER attacks HOSTER (rotten + curse); cost/dmg/hp/banners | **PASS mechanics** / **FAIL transport** (D2) |
| 6 | Elimination path, spectator state, end-with-one | **PARTIAL** — spectator ✔ (both sides), elim frame ✔, end-with-one ✔ on build A, **blocked** on build B when survivor spectates (D6) |

## Per-step evidence

### Step 1 — Host room · PASS
`HOSTER` → HOST ROOM. Lobby title: `Room 8NLK9 — share this code!`; `G.mp={on:true,host:true,code:'8NLK9'}`; `IQ.Net.myUid()==='HOST'`; banner `OPENING ROOM 8NLK9…`.

### Step 2 — Join · PASS
JOINER revealed code input (`#toggle-join`), entered `8NLK9`, JOIN. Both tabs then showed `#lobby-count`=2 and byte-identical rosters: `[iqb-8NLK9/HOSTER/isHost:true, Cmt8l51jz7ow/JOINER/isHost:false]`. Repeatable in later rooms (X8U3M, EWZZ2, GB789, GJL2J).

### Step 3 — Stage parity after START · FAIL native / PASS harness-relayed
Host clicked START: `begin` frame reached joiner (net debug ring `begin in`), both entered `scr-play`.
- **Build A+B**: host dealt round normally (`G.curStage='puzzle'`, `G.stageSeed=…`) but **the round frame never shipped**: `localStorage['iqb-neterr'] === "extra is not defined"`. Root cause D1 below. Joiner stuck forever: `screen:'play', round:0, awaitingRound:true`, empty board, `DEPTH 1` label — a permanently hung lobby-to-play transition for any real same-browser pair (and any PeerJS-client too, since the crash is pre-broadcast).
- Harness workaround: rebuilt the intended frame host-side (identical to `broadcastRound()` lines 658–664 minus the bug) and wrote it onto the game's own storage bus key (`iqb-bus-<code>`, `src:'HOST'`). Join tab applied it through the normal `applyIncomingRound` path.
- Parity result: join mounted `round:n, curStage:'puzzle', stageSeed` **identical** to host every time (e.g. seed `1657912208`, `533493012`, `2764054303`, `1661935505`, `1876018507`, `2674715676`).
- Sanitize check on the wire: frame keys = `t,n,timerLen,w1,stg,kind,board,oddBoard,seq,options,ord,imp` — **no `answer`/`rule`/`explanation`** (`frameHasAnswer:false`).

### Step 4 — Answer → reveal fold · PASS
Driven twice (rooms 8NLK9 round 2, EWZZ2 rounds 1–2), second run fully clean:
1. Joiner clicked tile → SD frame `{t:'pick',n,pos,name:'JOINER',uid:'C…'}` observed leaving the join tab; host `onRemotePick` registered it keyed by stable uid.
2. Host picked → reveal broadcast ~2.65 s later: `{t:'reveal',answer,imp,scores:[{uid:'HOST',…},{uid:'C…',…}]}`.
3. Fold verified: join `G.score` == host ledger entry for its uid; host `G.humans[uid].pts` == join score; `.correct` class painted on the right tile; side-panel rows agreed (`🜂HOSTER rival 385 / 🜃JOINER you 140`).
Final LMS-run totals matched across tabs at every captured reveal (e.g. `[HOST 185, JOINER 140]`, `[385,280]`, `[840,300]`, `[1625,760]`).
Anomaly D5 (intermittent, build A, room 8NLK9 round 2): first reveal of that match shipped scores **without** the joiner entry although his pick was registered pre-answer; the next round's reveal carried him (+140). Client idempotence (index.html:1007-1009) then applied only one of the two reveals. Not reproduced under instrumentation (build B trace shows pick→reveal ordering correct); hypotheses listed under D5.

### Step 5 — LMS toggle + attacks · mechanics PASS, transport FAIL
Room EWZZ2 (build A) and GJL2J (build B), `#cfg-lms` toggled ON before START (flag propagates via `begin` frame; `G.lms=true` both sides ✓).
Score cards render click-bound for rivals when `G.lms&&G.mp.on` (index.html:507 area, renderScores binding) ✓. JOINER clicked HOSTER card → blocking `prompt('ATTACK … — type rotten or curse')` → accepted via harness.
- **rotten**: banner `ATTACK SENT — ROTTEN` (attacker) and `YOU WERE HIT — ROTTEN` (host target); next prc applied exact `weaponFor('rotten',1)` math: attacker 280→**205** (−cost 75), target 390→**310** (−dmg 80) ✓.
- **curse**: banner `YOU WERE HIT — CURSE`; **host hp 100→90** (`hurtHp(10)`, index.html:826); ledger −cost 125 / −dmg 130 exact ✓. Note: rotten has **no hp component by design** (lms.js:58 vs :59/:67) — “hp sting” requires curse.
- **Transport defect D2**: the attack frame sent by the joiner **never reached the host listener** over the storage-bus transport (host debug ring shows no `attack` in-event; `G.remoteAttacks` stayed empty; nothing resolved). Verified host-side handler whitelist drops it (see D2). Attack pipeline was then exercised by looping the frame through the host's own `Net.send` self-emission (net.js:456-458) — everything downstream (validate → deduct → banner → reveal fold) is real game code and behaved exactly.
- Corollary observations: parity guard `parity-guard` exists in `validateAttack` (lms.js:151-165) but `postRoundChain` never passes `parityGuard`, so attacks land during parity rounds 1–2 (C8 rail not enforced here). Attacker gets **no hit-confirmation feedback** (resolution banners fire host-side only).

### Step 6 — Elimination, spectator, end-with-one · PARTIAL
**Spectator state — PASS (both sides, independently):**
- Host (ambient hp drain from wrongs/hooks): banner `THE DARK CLAIMS YOU — SPECTATING`, `G.spectating=true`, play continued (rounds kept dealing). Flag is **sticky** — later heals raised hp above 0 but spectating never clears (index.html:322-325 is the only writer).
- Joiner: banner `YOU ARE OUT — SPECTATING`, `G.spectating=true`, via two cooperating paths: local hp≤0 (hurtMp branch) and the new-build `{t:'elim'}` receiver (`u===my` branch, index.html:1003-1006).

**Elimination pipeline — PASS (build B):** drove joiner to `pts≤0 && humanHp≤0`: rot applied `30→0` (SCORE_FLOOR clamp, lms.js attackResult), host broadcast **`{t:'elim',uids:['Cmt8mfbs869y']}`** (index.html:838), banners `STRIKE LANDED — ROTTEN` + `THE REAPER MARKS 1`. Note the new `mode:'and'` gate needs **score-floor AND hp-death**; `humanHp` drains only via curse (−10, index.html:824), so a floored-but-healthy player is *not* eliminated — and once floored, `target-down` blocks further attacks, making the ordering (drain hp while solvent, then floor) mandatory. Old build A had no elim broadcast at all; a floored player ended the match immediately via the remaining() gate.
**End-with-one — PASS on build A / BLOCKED edge on build B (D6):** build A room EWZZ2: joiner floored → `endMatchBroadcast`+`endRun` fired; host showed end screen (“match terminated / SHADOW BOWS. YOU WON.”), join got `MATCH TERMINATED` + folded scores. Build B room GJL2J: elim fired but **no `{t:'end'}` ever followed** because the surviving host was himself `spectating`, and the gate reads `if(!G.spectating&&alive&&alive.length<=1)` (index.html:842-843). Match limped on past round 22 with one eliminated + one spectator.

## Defect list (root cause + file:line)

**D1 · Round frame never broadcasts — multiplayer unplayable past lobby (CRITICAL, all builds)**
`broadcastRound()`: `if(def&&def.frame){const f=def.frame();if(f&&typeof f==='object')extra=f} IQ.Net.broadcast(Object.assign(base,extra));`
`extra` is never declared; script runs `'use strict'` → ReferenceError on every host round → swallowed into `localStorage['iqb-neterr']` (observed value: `"extra is not defined"`). Clients hang at `awaitingRound=true` with an empty board indefinitely.
Fix shape: declare `let extra;` (or `extra=null`) — index.html:662-664 [A: 661-662].

**D2 · Storage-bus host handler whitelists only hello/pick — client→host frames silently dropped (HIGH, all builds)**
net.js:97-113: `lsHandler` handles `hello` and `pick` for role host, relays everything for role client, and **drops all other host-inbound types** (`attack`, future `sr` seed-net verdicts, anything new). Same-browser two-tab play runs exclusively on this transport when the PeerJS data channel isn't established (observed: broker reachable, but data-channel `open` never seen; `debugLog` shows `begin out ok:false`, i.e. zero open conns while bus traffic flowed). Net effect: **attacks can never land in the flagship same-browser scenario**; any future seed-net `sr` scoring will silently no-op the same way.
Fix shape: default-branch host inbound like the client branch (`emit(m.t,m)` after hello/pick special-casing), keeping uid stamping.

**D3 · Reveal/end frames carry identity-less or lossy rosters (MEDIUM, all builds)**
- `reveal` (index.html:810) has **no round number**; client dedup keys off its own current round (1007-1009), so any skew double-applies or swallows updates (observed interplay in D5).
- `endMatchBroadcast` (873-877) builds scores from `G.remotePicks` — already cleared by the reveal (812) — and **omits `G.humans` entirely**: the eliminated player's final total never ships. Observed: end frame `scores:[{uid:'HOST',pts:525}]` only; join tab froze at “you 40” while truth was 0/eliminated.

**D4 · End gate suppressed when the last alive player is a spectator (MEDIUM, build B)**
index.html:842-843: `if(!G.spectating&&alive&&alive.length<=1)`. A surviving host whose hp latched `spectating` (sticky, 324) never ends an LMS match even after everyone else is eliminated. Observed live: elim fired at round 20, match still dealing at round 22+, `ends:0`.

**D5 · Intermittent reveal omission of a registered pick (LOW/MEDIUM, observed once, build A, not reproduced instrumented)**
One reveal shipped without a pick that was verifiably in `G.remotePicks` pre-answer; the following round's reveal included it (+140 late credit). Hypotheses (most→least likely): (a) dual transport paths (storage event + 400 ms poll, net.js:90-139) racing the single `state.seen` nonce map produced a late duplicate registration between reveal-build and clear (812); (b) rAF suspension in hidden headless tabs desynchronized the 1250 ms pick-hold / 1400 ms reveal timers from wall-clock expectations, letting the clear at 812 run between registration read and snapshot; (c) single-key bus (`iqb-bus-<code>` last-value-wins, net.js:119) dropping a frame under burst. Recommend: include `n` in reveals (fixes the dedup half) and unit-smoke `onRemotePick→hostRevealBroadcast` ordering.

**D6 · Cosmetic:** recurring console `404` for `/favicon.ico` (no favicon asset). No other console errors/pageerrors captured in any phase; audio/AU warnings none.

**Environment caveat (not a game bug):** hidden headless tabs never fire `requestAnimationFrame`, so puzzle-stage round timers (`startTimer`, index.html rAF loop) freeze when idle; takeover stages self-resolve (interval/setTimeout-driven), which masked the freeze intermittently. Any future automated soak must drive clicks rather than rely on expiry, or launch the browser with frame-forcing flags.

## Fairness rails audit (observed)
- Round payload sanitize: PASS — wire frame carries no answer/rule/explanation (key dump in step 3); client mount rebuilds strictly from frame with `answer:-99` sentinel (modes/mode-puzzle.js:150-156).
- Determinism: same `stg.seed` mounted identically on both tabs across 10+ relayed rounds; correctPos derived from host `describe().ord` always matched the client's tile layout (shared `ord` in frame).
- Parity rule C8: rounds 1–2 always dealt classic `puzzle` ✓, but attack parity-guard is not wired (D2 corollary).
- Motion/flashes/overlay rails: not exercised in depth (MP focus); ambient hook banners observed obeyed short-lived single-element pattern.

## Console error log (per step)
| Phase | Tab | Entry |
|---|---|---|
| every host round | host | `localStorage['iqb-neterr'] = "extra is not defined"` (D1; written via catch, not console.error — visible as persistent artifact) |
| step2 / step5 / step6 / step6b | join | `Failed to load resource: 404` → `/favicon.ico` (D6) |
| all phases | both | no `pageerror`, no other console errors/warnings captured |
| PeerJS | both | `unpkg.com/peerjs@1.4.7` 200; `0.peerjs.com` broker 200; data channel never opened (bus carried all traffic) |

## Reproduction notes (harness shape)
Driver = browser-tool evaluate snippets; no game file modified. Core primitives (installed per tab, main world):
- `__qaDrive.setVal/click` — native setter + `el.click()` (puppeteer actionability times out on animated overlays).
- Banner recorder: MutationObserver on `.event-banner` (auto-removed ≤1400 ms).
- Outbound frame tap: wraps `IQ.Net.broadcast/send` (inbound frames reach neither tap nor `__qa.frames`; use `IQ.Net.debugLog()` for inbound).
- Round relay (works around D1): host stashes `JSON.stringify(Object.assign({t:'round',n,timerLen,stg:{id,seed}}, def.frame()))` → harness writes `{bc:1,src:'HOST',_n:<fresh>}` onto `iqb-bus-<code>` → client poll applies it (400 ms).
- Deterministic answering (QA introspection only): host `IQ.Stage.get(stage).describe()` → `ord.indexOf(answer)`; identical display order both sides via frame `ord`.
- Attack prompt: Node-side `page.on('dialog')` must be re-registered per weapon choice (first handler persists otherwise).
- State reads: function-form `tab.evaluate` reaches page globals (`G`, `IQ`); string-form evaluates in an isolated world (DOM shared, JS heap not).

Server `iqbattle-dev` stopped via hub after capture (see final section).
