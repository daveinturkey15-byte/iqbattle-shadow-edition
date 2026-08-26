# V2 Frame-Time & Leak Audit — live measurement

**Date:** 2026-08-26 · **Target:** http://127.0.0.1:8792 (v2 dev server) · **Method:** live Chromium tab, CDP-instrumented main world
**Session:** 34 measured depth transitions, 1,201 seconds of active frame samples, 470 texture-cache inserts, across a play session driven by synthetic input.

## Method (so the numbers are interpretable)

- Probes injected into the app's **main world** via CDP (`Runtime.evaluate` + `Page.addScriptToEvaluateOnNewDocument`), persisted through Vite reloads via `localStorage` (`__perfAudV2`).
- **Frame times:** in-page `requestAnimationFrame` delta sampling (`performance.now()` in the rAF callback), aggregated into 1-second buckets (n / mean / p50 / p95 / max) and flushed to localStorage every second.
- **Texture memory:** two independent counters — (a) WebGL `texImage2D` wrap on the live context (tile uploads, byte-accurate), (b) Pixi `TextureSource.prototype.update` wrap via the app's own pixi module instance (per-frame re-upload demand). Depth transitions detected as `spriteFrom` → `toDataURL()` bursts (>500 ms gap = new deal).
- **Listeners:** `Window.prototype.addEventListener/removeEventListener` wrap (live per-type counts + add/remove totals). `getEventListeners` is DevTools-console-only, so a prototype-wrap heuristic was used instead.
- **GC pressure:** `performance.memory.usedJSHeapSize` at 1 Hz.
- **Caveats:** headless Chromium produces frames only while driven and runs uncapped (~180 fps, software GL) — frame *times* measure CPU-side frame production; GPU upload costs are reported as measured *nominal* re-upload demand (bytes × rate), which is what saturates a real machine. Concurrent wave-2 edits caused several Vite full reloads mid-session; all counters are reload-safe (deltas fold into persisted totals), per-epoch loop counts are noted where relevant. One 56.7 s frame stall in the data is a Vite mid-save reload, not game code.

## Measured results

### Frame-time distribution (active play, 1,201 sampled seconds)

| Metric | Value |
|---|---|
| frame p50 | **5.60 ms** (pinned by the 180 fps headless cadence — loop keeps up in software GL) |
| frame p95 | **11.0 ms** |
| frame p99 | 11.1 ms |
| worst-second max, p50 / p95 / p99 | 13.3 / **44.4** / 105.6 ms (excl. one 56.7 s Vite-reload outlier) |
| fps p50 / p95 / min | 173 / 180 / 49 |

Early vs late session thirds: p50 flat at 5.60 ms; mean-of-p95 7.3 → 7.6 → 6.4 ms. In this environment the loop does **not** visibly degrade with depth — because software GL defers the upload cost the next risk quantifies. The per-second max spikes (p95 = 44 ms) line up with deal frames (see Risk 3).

### Texture memory growth over depth transitions (measured, n=34 deals)

| Metric | Value |
|---|---|
| `spriteFrom` → `toDataURL` calls | 470 over 34 deals = **13.8 tiles/deal** (10–17 per deal) |
| Unique tile px per deal | mean 209,430 px → **~818 KB GPU per deal**, retained forever |
| WebGL tile uploads (byte-accurate wrap) | 166.9 MB cumulative this session |
| `TextureSource.update` calls (Pixi-level) | **9,850 in 14 s** of play ≈ 3.9 concurrent backdrop loops × 180 fps |
| Nominal re-upload demand | **52.8 GB per 14 s = 3.8 GB/s** at headless fps — i.e. K stacked backdrops × 5.76 MB × frame-rate on real hardware |

### Listener leak probe (window)

Live counts at session end: `pointerup: 1, resize: 1, keydown: 1`; totals adds=3 / removes=1 this epoch (net +2 = `resize` from main.ts:40 + shell's one-shot keydown, shell.ts:330-335). Static check: all 11 takeover scenes, interlude and net2 pair every `addEventListener` with a teardown `removeEventListener` (verified per file). **No listener leak.**

### GC pressure indicators

- JS heap band **10.2–35.5 MB** over 1,200 one-second samples; no runaway growth (GC keeps pace).
- Churn sources: per deal ~14 canvases rasterized + PNG-encoded (`toDataURL`) + ~818 KB textures retained; per-answer `setTimeout` chains. The deal-frame spike (44 ms second-max p95) is this synchronous batch.

## Leaks found (file:line)

1. **Backdrop rAF loops stack per depth transition and are never torn down** — `main.ts:233` calls `applyBackdrop(root, wid)` and **discards the returned teardown**; the loop at `worlds/backdrops.ts:605-609` (`frame = (now) => { def.draw(...); tex.source.update(); raf = requestAnimationFrame(frame); }`) reschedules unconditionally and its `teardown` (`backdrops.ts:612-616`) is therefore never invoked. Each deal also retains the previous scene root via the closure. Measured: loop count tracks deals-since-load; 3.9–7 concurrent loops observed; nominal re-upload demand 3.8 GB/s (headless fps) ≈ **K × 345 MB/s + K × ~1 ms CPU draw per frame at 60 fps** — the 16.7 ms budget is gone around depth ~10–15 on real hardware.
2. **Unbounded texture cache** — `scenes/game.ts:86-93`: module-level `Map<string, Texture>` keyed by `cv.toDataURL()`, never evicted, textures never `destroy()`ed. Measured growth **~818 KB GPU + equal CPU canvas retention per deal**; a 100-round run ≈ 80–100 MB GPU + same CPU, plus the PNG-encode cost on *every* call (cache hit or not).
3. **Deal-frame main-thread stall** — `main.ts:206-263 deal()` synchronously rasterizes + PNG-encodes 10–17 canvases and uploads them in one go (via `buildGameScene` → `spriteFrom`); measured as the 44 ms second-max spikes. Same frame also mounts the backdrop (leak 1).
4. **Per-mount `Texture.from(canvas)` in takeovers** — `slimegallery.ts:218-223`, `well.ts:263-266`, `slots.ts:214-215` create fresh canvases per mount; a fresh canvas is a fresh cache source per mount, and `destroy({ children: true })` in their teardowns does not destroy textures. Growth per mount is small (3–6 small tiles) but accumulates across runs; same pattern family as leak 2.
5. **No listener leak** (explicitly checked, negative result) — see probe above.

## Top-5 ranked risks

1. **CRITICAL — backdrop loop stack (`main.ts:233` + `backdrops.ts:605-609`).** Unbounded per-depth growth of full-screen canvas redraws + 5.76 MB-per-frame texture re-uploads; measured 3.8 GB/s nominal demand and multiple concurrent loops within a 34-depth session. This is the frame budget killer on real hardware.
2. **HIGH — `spriteFrom` cache never evicts (`game.ts:86-93`).** Linear GPU+CPU growth with every round played; also taxes every call with a PNG encode. Deterministic to fix, trivially reproducible (measured 470 entries / 34 deals).
3. **MEDIUM — deal-frame stall (44 ms spikes).** One-frame hitch after every answer; compounds with risk 1 on the same frame.
4. **MEDIUM-LOW — takeover per-mount textures (`slimegallery.ts:218-223`, `well.ts:263-266`, `slots.ts:214-215`).** Small per-mount growth, unbounded across runs; same fix shape as risk 2.
5. **LOW — JS heap churn** (per-deal canvas + string allocations). Bounded today (10–35 MB band) but scales with risk 2's retention.

## Recommendations (ranked)

1. **Fix the backdrop lifecycle:** capture `const stopBg = applyBackdrop(root, wid)` in `deal()` and invoke it wherever the scene is replaced (`clearCurrent()` in main.ts:68-70 is the natural owner). Longer term, drive backdrops from a single `Ticker.shared` callback (auto-removed on teardown) instead of one private rAF per mount, and skip `tex.source.update()` when motion is off (already gated) or the frame is unchanged.
2. **Bound and re-key the `spriteFrom` cache:** key structurally (`hue|size|prims` hash) instead of `toDataURL()` — removes the per-call PNG encode — and evict LRU (≈256 entries) with `tex.destroy(true)`.
3. **Spread deal work off the answer frame:** pre-render the next board during the 1,400 ms result toast (`setTimeout` in `dealPuzzle` main.ts:315 / `dealTakeover` main.ts:280), or chunk tile creation across rAF ticks.
4. **Give takeovers a shared texture table:** module-level `Map<hue|kind|n, Texture>` (or route them through the fixed `spriteFrom`) so remounts reuse textures; destroy on last use.
5. **No action needed for listeners** — the add/remove pairing convention is holding; keep it as a review rule for new scenes.

*Raw data: `perfaudit-data.json` snapshot (buckets/trans/heap/listener counters) retained in the session temp dir; all counters reproducible via the localStorage probe (`__perfAudV2`) on any tab of the dev server.*
