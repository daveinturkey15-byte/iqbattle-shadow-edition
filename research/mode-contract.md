# W2 Polymorphic Stage Contract (research/mode-contract.md)

Owner this wave: **StageCore** (exclusive `index.html` ownership).
Consumers: standalone mode files under `modes/*.js` delivered by sibling agents.

Rounds are polymorphic: a **director** picks one registered STAGE per depth.
The classic puzzle round is Stage `puzzle` — Mode #1, dominant (~70% of depths
early, ~55% deep) but no longer exclusive. Each stage owns its entire play
surface, input model, and resolution.

---

## 1. Registration

```js
window.IQ.Stage.register({
  id: 'redlight',            // unique, stable, lowercase. Shipped in MP frames.
  name: 'RED LIGHT',         // human label (banners, logs).
  weight: 6,                 // relative weight in the director wheel (puzzle excluded).
  minDepth: 3,               // optional (default 1): never picked before this depth.
  worlds: ['realm'],         // optional: restrict to these world theme ids.
  aligns: ['chaos'],         // optional: restrict to these alignment ids.
  net: 'seed',               // 'seed' (default): challenge derivable from ctx.seed.
                             // 'relay': stage runs its own MP protocol (advanced).
  mount(container, ctx) {    // REQUIRED. Build the play surface inside `container`.
    return Promise.resolve({ kind:'score', correct:true, points:120, hpDelta:0, summary:'SURVIVED' });
  },
  describe() { ... },        // optional: serializable round info for host scoring.
  cleanup() { ... },         // optional: called on timeout/abort. Remove listeners!
});
```

Rules:

- Register at script top level (script tags live at the bottom of `index.html`).
  Registration is idempotent per `id` (last write wins).
- **Modes NEVER touch `window.G`, engine internals, or localStorage.** Everything
  a mode may observe or do arrives through `ctx`. The ENGINE applies results.
- Never append overlays to `document.body` — build inside `container`.
  Full-screen *feel* is fine (`position:absolute; inset:0` inside the stage root).

## 2. ctx (read-only snapshot + bridges)

| field | type | meaning |
|---|---|---|
| `depth` | int | 1-based round/depth counter |
| `tier` | 0–3 | corruption tier (drives palettes/audio intensity) |
| `diff` | 1–5 | effective puzzle difficulty for this depth |
| `world` | string\|null | world theme id (from Align planner) |
| `align` | string\|null | alignment id |
| `hp` | number | current vitality 0–100 |
| `score` | number | current run score |
| `streak` | number | current correct streak |
| `seed` | uint32 | round seed — identical host/clients this round |
| `rng` | fn()->[0,1) | **the ONLY randomness source** for anything MP-visible |
| `mp` | `{on,host,client}` | multiplayer posture |
| `timerLen` | int | round timer seconds |
| `leftFrac()` | fn | fraction of round timer remaining at call time |
| `expired` | bool | true once the engine timer fired (finish fast!) |
| `frame` | obj\|null | client role only: sanitized host frame for this round |
| `forgedPool` | array | player-forged puzzles (puzzle stage consumes) |
| `audio` | AU bridge | `.p(name,opts)` sound player |
| `fx` | CX bridge | `.shake/.flash/.glitch` (motion-gated by engine) |
| `banner(txt)` | fn | transient event banner |
| `say(txt)` / `quip(kind)` | fn | shadow voice / taunt text |
| `net.send(obj)` / `net.uid()` | fn | client->host frames / stable uid |
| `name` | string | local display name |
| `board` | IQ.Board | shared SVG kit: `tileSVG(tile,size,tier,showQ)`, `optTile(t)` |

## 3. StageResult semantics

```js
{ kind:'score',            // literal; future kinds reserved
  correct: true|false|null,// null = NEUTRAL round (impossible/nobody-wins)
  points:  number,         // RAW points. Engine layers ALL flavor modifiers.
  hpDelta: number,         // negative hurts the local player. Omit on wrong => -15 default.
  summary: string,         // short flavor line shown after resolution (≤64 chars)
  relay:   true|undefined  // set relay:false to suppress the automatic client->host
                           // result relay (stage speaks its own MP protocol instead)
}
```

Engine-side application (host-authoritative, single funnel `applyStageResult`):

- `correct===true`  → streak++, engine adds streak bonus `(streak-1)*20`,
  then emerald/curse/hook multipliers (`doom_bloom ×1.3`, `gravity_greed` +60
  steal, `final_chaos ×2 every 10th depth`, `curseMul`, `hookScoreMul`),
  `score += pts`.
- `correct===false` → streak=0, `score += clamp(pts,-200,500)` (typically −40),
  `hurtHp(hpDelta ?? 15)`; grace (`forgiveNext`) zeroes it; `final_chaos`
  halves score on 10th-depth fails; `doom_bloom` stings rivals −20.
- `correct===null`  → impossible-round ladder: `chaos_control` +150 /
  `crimson_veil` +40 / else −25 and a shadow quip.
- Timeout (round timer hits 0 before the mount promise settles): engine calls
  `cleanup()`, injects `{correct:false, points:-40}` (same as a wrong answer).
  Stages SHOULD self-limit to `timerLen` seconds.
- Clamps applied engine-side: points ∈ [−200,500], hpDelta ∈ [−60,60].

## 4. Multiplayer determinism

Two supported patterns:

1. **seed-deterministic (`net:'seed'`, default)** — the HOST picks the stage id
   and `seed`, ships `{t:'round', stg:{id,seed}, ...frame}`. Every tab mounts
   the same stage; `ctx.rng(seed)` reproduces the identical challenge. Per-player
   outcomes differ by skill (that is fine — like puzzle picks). On resolve the
   engine relays the client's StageResult as `{t:'sr', n, sr:{correct,points}}`;
   the host sanitizes/clamps and folds it into the authoritative `reveal` score
   totals. NEVER trust unclamped client numbers.
2. **input-relay (`net:'relay'`)** — stage defines its own frames through
   `ctx.net.send` and handles them itself (see `mode-puzzle.js` legacy
   `t:'pick'` pattern + `describe()`). Only for stages that genuinely need it.

Director eligibility in MP: `minDepth/worlds/aligns` filters apply equally;
both host and clients must have the same mode files loaded (ship script tags).

## 5. Hooks precedence (cross-cutting flavor layer)

Hooks sit ABOVE stages, never inside them:

```
director picks stage → stage mounts & plays → StageResult
     ↑                                              │
hooks: onRoundStart/onTick/onPreAnswer/onAnswer/onReveal/onInterlude
```

- Hook modifiers (hp/score/timer/overlay/banner) are applied by the engine
  around the stage, before its result lands (`onRoundStart`) and at answer
  time (`onAnswer`). A stage can neither observe nor veto them.
- Precedence: world/align planning → curse roll → stage pick → hook
  onRoundStart → play → StageResult → emerald/curse/hook point layering →
  hook onReveal → interlude (emerald every 4th depth / cleanse) → next depth.

## 6. Styling conventions

- Fonts: `'Oxanium',sans-serif`; letterspaced uppercase labels (`letter-spacing:.2em+`).
- Palette: read `ctx.board` colors / tier; danger `#ff2038`, life `#00e68a`, gold `#ffb01e`.
- Respect `IQB_MOTION`: use `ctx.fx.shake/flash` (already gated) and CSS
  `@media (prefers-reduced-motion)` for ambient loops; fullscreen flashes
  ≤200 ms and ≤3 Hz (fairness rail).
- Overlays must remain escapable and ≤12 s; text ≥11 px, contrast-safe.
- Root element: `<div class="stage-view" data-stage="<your-id>">` filling the
  stage root; engine clears it between rounds.

## 7. Exemplars

- `modes/mode-puzzle.js` — the ported classic round (gen_* families, tables,
  forged puzzles, round-1 power cut, MP pick relay). Study this first.
- `modes/mode-redlight.js` — full takeover arcade stage (green = answer a mini
  pattern, red = freeze; move/click on red and you bleed). Shows: takeover
  surface, phase machine, seeded generation, motion-gated FX, StageResult.

## 8. Integration checklist for a new mode file

1. `window.IQ.Stage.register({...})` at top level, no side effects beyond that.
2. Drop the file in `modes/`; ask StageCore to add the script tag (index.html is
   exclusive this wave) — or land it together with a tag request via hub.
3. `node --check modes/your-mode.js` must pass.
4. Solo soak: stage must fire, resolve within `timerLen`, never throw, and
   always settle its promise exactly once.
