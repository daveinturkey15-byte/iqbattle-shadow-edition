# V2 Gauntlet — MP × ARC stress findings (`BugMPArc`, 2026-08-26)

Scope: headless stress of `v2/src/net/net2.ts`, `v2/src/scenes/mp.ts`, `v2/src/arc-data.ts`
(game code strictly READ-ONLY; findings in Main-owned `main.ts` are reported with evidence,
fixes left to Main). Live two-tab flow deliberately NOT exercised — that's Main's.

Method: deterministic stub transports (sync FIFO delivery, controlled reorder/dup injection)
importing the real `createNet`/`MpSession`/`planArc`. Harness committed at
`research/v2-gauntlet/mparc-stress.ts`; run:

```
cd v2 && node node_modules/esbuild/bin/esbuild ../research/v2-gauntlet/mparc-stress.ts \
  --bundle --format=esm --platform=node --external:pixi.js \
  --outfile=%TEMP%\mparc-stress.mjs --log-level=error && node %TEMP%\mparc-stress.mjs
```

Final run: **43 checks ok, 4 FAIL rows — every FAIL row below is a reproduced defect**
(no unexpected regressions; several defects were additionally confirmed with `ok`-marked
"DEFECT CONFIRMED" assertions written to expect the buggy behavior).

## 1. Scenario table

| # | Scenario | Result |
|---|----------|--------|
| S1 | begin → 20 depths × 2 clients answering staggered; sr/reveal/pick relay | PASS — exactly-once everywhere: 40/40 sr folded at host, reveal 20× per client, dual-transport copies collapse via epoch watermark |
| S2 | client joins mid-round (depth 3 live), catch-up replay | PASS on content — joiner receives replayed `begin{sd}` + current `round{n:3,stg}` exactly once each (watermark *hole* tolerance admits the stale-seq replay) |
| S2b | round frames out of order (host deals 9 then 8; bus burst reversed) | **DEFECT D1** — client remounts STALE depth 8 / 11 after newer one; no monotonic guard |
| S3 | peer-legged client disconnects gracefully mid-round | PASS — conn close ⇒ `peer-leave` + roster shrink |
| S3b | bus-only client leaves politely / vanishes (tab kill) | **DEFECT D2** — roster haunted forever; no bye frame, no liveness probe |
| S3c | host dies while client bus-connected (the COMMON same-machine topology) / fully brokerless | **DEFECT D3** — client receives NOTHING (no `end{reason:host-left}`), hangs on a dead room |
| S4 | host LMS-eliminates client while its sr is in flight | PASS — elim delivered, post-elim sr still relayed without crash; `'and'` semantics + floor boundary `pts<=floor` verified; missing hp defaults alive |
| S5 | sr spoof attempts past clamps | Rails hold at [-200,500]/[-60,60]; junk payloads dropped — BUT **DEFECTS D4 (anti-spoof ceiling dead code)** and **D5 (forged uid accepted verbatim)** |
| S5b | 300× attack-frame flood | NOTE N5 — all relayed, no rate limit |
| S6 | double-begin (different seeds/timers) | Both begins delivered verbatim; catch-up replays latest only. NOTE N3 — restart hazard owned by main.ts |
| S8 | 50× wire-level replay of one captured round frame | PASS — collapses to exactly-once (per-epoch watermark works as designed) |
| ARC | planArc battery: depth 1 / 39 / 40, sanctuary-on-d1, layer ceiling, redemption continuity, ratio, chaotic share, determinism | see D6–D8 + passes |

## 2. Defects

### D1 · Stale round remount — no monotonic guard on `round` frames · **P2 (major)**
`mp.ts:359-372` — `listen('round')` calls `handlers.onRemoteRound` for EVERY normalized
round frame; nothing rejects `n <= lastN`. Transport reorder (or any replay path) delivers an
older frame after a newer one and the client remounts the OLD puzzle, resetting its timer/board.
Repro: host `mh.round(9,…)` then `mh.round(8,…)` → client's last mount is depth 8. Also shown
with a genuinely reversed bus burst (mounted 11 after 12). Watermark dedupe collapses
duplicates but deliberately passes unseen-lower sequence numbers, so ordering is unguarded at
every layer. Fix hint: ignore `round` with `n <= lastRoundN` per session (except explicit
replay requests).

### D2 · Bus-only departures haunt the room forever (ghost players) · **P2 (major)**
`net2.ts:1119-1125` — `leave()` is a purely local `teardown()`; **no bye frame exists** in the
protocol (grep: no `bye`/`leave` frame anywhere). On the PeerJS leg the closing dataconn fires
`onConnGone` (`net2.ts:658-667`) so the host learns of the departure — but a bus-connected
client (see D3: this is the normal same-machine case) disappears silently. Repro: brokerless
room, client `net.leave()` → host roster still `["HOST","GHOST"]` indefinitely. Consequences:
LMS alive-count and score tables keep the ghost; "≤1 alive → endMatch" can stall forever.

### D3 · Host death silences bus-connected clients (common path!) · **P2 (major)**
`end{reason:'host-left'}` is emitted only from `onConnGone` (`net2.ts:668-675`) when a live
dataconn dies. But `join()` settles the handshake via the bus and then ABORTS the PeerJS leg
(`net2.ts:966`: `if (settled || role !== 'client') return;`) — so a same-machine joiner
normally has **no conn to die**, and when the host leaves it receives nothing: tab hangs on a
dead room with no end screen and no error. Reproduced both with a broker present (bus-first
join) and fully brokerless. Fix hint: host broadcasts an `end{reason:'host-left'}` in
`teardown()` when a match was active, and/or clients time out on host-silence.

### D4 · Anti-spoof point ceiling is dead code · **P2 (fairness rail)**
`mp.ts:196-198` defines `srCeiling(points,diff)=min(points,100*diff+40)`; header comment
(`mp.ts:19-22`) claims the host applies it. **Zero production callers** (grep: only definition +
selftest). Repro: malicious client sends `{t:'sr',n:1,sr:{correct:1,points:500,hpDelta:60}}` at
depth 1 → session delivers the full 500 pts (legit depth-1 max ≈ 140); only the generic
[-200,500] clamp applies. Caveat for the fix: `main.ts:300` awards streak bonus (+20/streak)
and MIDAS ×1.5, so legit verdicts CAN exceed `100*diff+40` — the ceiling formula needs
streak/midas awareness before wiring, or it will clip honest scores.

### D5 · Forged uid accepted — verdicts attributable to any player · **P2 (integrity)**
`net2.ts:553`: `if (!msg.uid) msg.uid = conn ? connKey(conn) ?? conn.peer : msg.src;` — the
connection-derived identity is filled in ONLY when the field is absent. A client sending
`{t:'sr', n:1, uid:'HOST', sr:{…}}` gets the event attributed to `HOST` (verified at host).
Any client can therefore fabricate or poison another player's verdict row. Fix hint: always
override `msg.uid` with the validated conn/src identity instead of trusting inbound.

### D6 · Double sanctuary at the maxDepth tail (~15% of seeds) · **P3 (polish)**
`arc-data.ts:49-51` — tail-fit sets `blockLen = min(blockLen, max(0, remaining-1))`, which
allows `blockLen=0` when `remaining==1` right after a completed block+closer, pushing an ORPHAN
good round that closes nothing and inherits `layer=min(7,max(1,0))=1`. Measured: **303/2000
seeds ≈ 15.2%** produce back-to-back sanctuary rounds; seed 7 tail reads
`bad(l1) bad(l2) bad(l3) chaotic(l4) good(l4) good(l1)` — violates v1 SPEC "exactly 1 good
closes a block" and breaks redemption continuity (second heaven inherits layer 1 regardless of
the descent). Fix hint: if the previous plan is already `good`, extend the preceding hostile
block (steal a slot) or emit `neutral` limbo instead.

### D7 · Layer 7 is unreachable — dead content · **P3 (content)**
`arc-data.ts:45,52,60` — `blockLen ∈ 4..6` and every hostile block is force-closed by a good
round (`consecHostile` resets, `arc-data.ts:78`), so `consecHostile` never exceeds 6 and
`Math.min(7, consecHostile)` never yields 7. Verified over 600 seeds × 40 depths: max observed
layer = **6**; `LAYER_TOKENS[6]` ("nothing above us now", alpha .58, `arc-data.ts:179`) and
ShadowBrain's act-3 tier entry can never trigger from generated plans. If layer 7 is wanted,
carry `consecHostile` across blocks when a limbo/neutral intervenes, or allow rare long blocks.

### D8 · Depth-40 hard stop contradicts the endless spec · **P2 (spec violation)**
`arc-data.ts:38` — `planArc(seed, maxDepth = 40)`; `main.ts:180` stores `planArc(seed)`;
`main.ts:208` — `if (r.hp <= 0 || r.depth > r.plan.length) { endRun(); … }`. Dave's hard order
(rebuild brief MSG 7): **no round limit — endless until death**. Every MP/solo run terminates
at depth 40 with hp > 0. In MP both sides end deterministically so they stay in sync, but the
match just… stops, uninvited. Fix hint: extend plans past 40 on demand (deterministic
continuation from the same rng stream) rather than a fixed table.

## 3. Integration findings (Main-owned `main.ts` — evidence only)

### D-I1 · Client mounts the WRONG puzzle seed — boards diverge from host · **P1 (critical)**
`main.ts:157`: `const sd = (e as unknown as { seed: number }).seed ?? 0;` — the round event has
NO top-level `seed` (`MpEvent` round shape `mp.ts:106`: `{t,n,stg:{id,seed},timerLen}`), so `sd`
is **always 0**. `mountPlan(rp, sd)` (`main.ts:164`) then generates via
`fam.generate((0 ^ imul(depth,7919))>>>0,…)` while the host used
`rp.seed = (runSeed ^ imul(depth,7919))>>>0` (`main.ts:256-261`). Unless the run seed is 0,
**client and host render different puzzles for the same depth** — answers don't match, reveals
are meaningless. Fix: use `e.stg.seed`.

### D-I2 · Client verdicts are never folded; reveal/LMS/scoring unwired · **P1 (critical)**
Both `wireMain` call sites (`main.ts:111-118` host, `main.ts:136-143` client) pass only
`onRound/onReveal/onBegin`. No consumer of the `sr` event exists outside tests (grep over src):
the host relays client verdicts into the void — no `foldScore`, no `mp.reveal(...)`, no
`evaluateElimination`, no `eliminate/endMatch` calls in production. Net effect: client answers
never score, the sidebar scoreboard never updates for clients, LMS never runs, and the match
cannot end via elimination. (Clients do progress — each next `round` frame remounts them.)

## 4. Notes / minor

- **N1** `net2.ts:160-190` `loadPeerJs`: the 8 s watchdog resolves null WITHOUT clearing the
  cached `peerScriptPromise` (only `onload`/`onerror` reset it). A slow CDN (>8 s) makes
  `loadPeerJs()` return null forever for the whole session — the keepalive reopen sweep then
  can never raise the cross-device leg even though the script eventually loaded. P3.
- **N2** `clampSr` (`mp.ts:181-193`) only nulls the whole verdict for non-object payloads;
  garbage `correct` with valid numbers passes through as `correct:null` (neutral) with the
  attacker-chosen points/hpDelta (clamped). Host fold policy must treat `null` deliberately.
- **N3** Double-begin is delivered verbatim twice (no generation counter). Protocol-level it's
  consistent (catch-up replays the latest), but Main must make `startRun` idempotent/guarded or
  a stray second begin restarts both clients mid-match.
- **N4** `attack` frames have no rate limit; 300 floods relayed 1:1 to every subscriber
  (`mp.ts:406-412`). Noise channel only (weapon 16 chars, target 40), but trivially capped.
- **N5** `roundPlan` with `depth < 1` yields `pz:-1`-style ids that `parseStg` rejects
  (`mp.ts:280`), so a client would silently mount nothing; unreachable via main.ts today.
- **N6** `realBusFactory` localStorage fallback re-parses every ring entry on every 400 ms tick
  per tab — O(tabs × rings × 256 JSON.parse)/tick. Works, but worth batching if bus-fallback
  rooms ever carry bursts.

## 5. What held up (verified good)

- Epoch-watermark dedupe: dual-transport copies and 50× wire replays collapse to exactly-once
  (S1/S8); catch-up replay survives precisely because unseen-lower seqs are tolerated (holes).
- Late-join catch-up content is correct: replayed `begin{sd}` matches the host run seed and the
  CURRENT round's `stg.id/seed` matches `roundPlan` exactly; not duplicated across transports.
- Engine rails clamp runaway verdicts to [−200,500]/[−60,60]; junk payloads dropped.
- Peer-legged disconnects surface correctly (`peer-leave`, roster shrink); LMS pure logic and
  `foldScore` upsert/order semantics correct; `parseStg`/`roundPlan` mirror main's formulas.
- `planArc`: deterministic; acts ramp monotonically; sanctuary ⇔ good; depth 1 always hostile
  layer 1 act 0 (sanctuary-on-depth-1 impossible at maxDepth 40 — only the degenerate
  `planArc(seed,1)` opens on sanctuary); depth 39/40 always populated; aggregate hostile:good
  ≈ 4.67:1 and chaotic share ≈ 1/8 within spec bands; good closers inherit closed-block pressure.

## 6. Validation status

- Harness final run: `43 ok / 4 FAIL` — all four FAIL rows are D1 (×2 repro forms), D2, D6;
  D3–D5, D7 additionally asserted as expected-defect `ok` rows with quantified detail.
- `npx tsc` project-wide NOT run here (siblings own concurrent edits; project-wide validation
  is Main's single-pass job). This audit modified ZERO v2 source files; the only artifacts are
  `research/v2-gauntlet/mparc-stress.ts` (harness) and this report.
