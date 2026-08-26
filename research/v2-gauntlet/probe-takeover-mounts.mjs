/**
 * probe-takeover-mounts.mjs — reusable live-mount harness for v2 takeover scenes.
 * Extracted from BugTakeover's gauntlet run (2026-08-26). Read-only against game code.
 *
 * WHAT IT DOES
 *   Drives mount functions headlessly inside a real Chromium tab on the vite dev server
 *   (:8792) with a fake TakeoverCtx + real Pixi Ticker.shared stepped at fixed 16.67 ms.
 *   Asserts per scenario: settles exactly once, settle time vs ctx.timerLen*1000,
 *   ticker-listener delta === 0 after teardown, WINDOW listener delta === 0 (add/remove
 *  EventListener instrumentation), container.children.length === 0, determinism re-run match.
 *
 * HOW TO RUN (xd://browser or any puppeteer evaluate):
 *   1. action:"open", url "http://localhost:8792/"
 *   2. action:"run", code:
 *        const result = await page.evaluate(async () => {
 *          const src = await (await fetch('/research/v2-gauntlet/probe-takeover-mounts.mjs')).text();
 *          return await eval(`(async () => { ${src} ; return __probeTakeoverMounts(['redlight','dronedodge','floorfall','hunterdodge']); })()`);
 *        });
 *      (vite serves /research/ statically? NO — it does not. Instead paste the file body
 *       into the evaluate wrapper above, minus this header comment.)
 *   The page-side entry point is the function `__probeTakeoverMounts(files, opts)` defined
 *   below; everything else is setup it performs itself.
 */

/* ---------------- page-side harness (paste into page.evaluate) ---------------- */

async function __probeTakeoverMounts(files, opts = {}) {
  // instrument window listeners BEFORE importing scene modules
  if (!window.__wlPatched) {
    const rawAdd = window.addEventListener.bind(window);
    const rawRem = window.removeEventListener.bind(window);
    window.__wl = {};
    window.addEventListener = function (t, f, o) { window.__wl[t] = (window.__wl[t] || 0) + 1; return rawAdd(t, f, o); };
    window.removeEventListener = function (t, f, o) { window.__wl[t] = (window.__wl[t] || 0) - 1; return rawRem(t, f, o); };
    window.__wlPatched = true;
  }
  const txt = await (await fetch(`/src/scenes/takeovers/${files[0]}.ts`)).text();
  const PIX = await import(txt.match(/from\s*["']([^"']*pixi[^"']*)["']/)[1]); // exact same module instance the scenes use
  const tk = PIX.Ticker.shared;
  const STEP = 1000 / 60;
  const BASE_T = 1e7;

  async function scenario(file, opts2) {
    const mod = await import(`/src/scenes/takeovers/${file}.ts`);
    const mountName = 'mount' + file[0].toUpperCase() + file.slice(1).replace(/([a-z])([A-Z])/g, '$1$2');
    const mount = mod[Object.keys(mod).find(k => k.startsWith('mount'))];
    const container = new PIX.Container();
    const settles = [];
    const ctx = {
      depth: opts2.depth ?? 27,
      seed: opts2.seed ?? 424242,
      timerLen: opts2.timerLen ?? 20,
      container,
      rng: () => 0.5,
      onDone: (r) => settles.push({ correct: r.correct, points: r.points, hpDelta: r.hpDelta, summary: r.summary }),
    };
    const wlBefore = Object.values(window.__wl).reduce((a, b) => a + Math.max(0, b), 0);
    const tickBefore = tk.count;
    tk.stop(); // keep RAF out; we drive manually for determinism
    let mountErr = null;
    try { mount(ctx); } catch (e) { mountErr = String(e && e.message || e); }
    tk.stop();
    let t = 0, crash = null, settleMs = -1;
    const limit = Math.ceil((opts2.maxSimMs ?? 45000) / STEP);
    for (let i = 0; i < limit; i++) {
      t += STEP;
      if (opts2.actions) for (const a of opts2.actions) if (!a.done && t >= a.at) { a.done = true; try { a.fn(); } catch (e) { crash = 'action:' + String(e); } }
      try { tk.update(BASE_T + t); } catch (e) { crash = String(e && e.message || e); break; }
      if (settles.length) { settleMs = t; break; }
    }
    // post-settle abuse: extra ticks + Esc spam must NOT re-settle and must not throw
    for (let i = 0; i < 300; i++) {
      t += STEP;
      try { tk.update(BASE_T + t); } catch (e) { crash = crash || ('post:' + String(e)); break; }
    }
    try { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); } catch (e) {}
    const wlAfter = Object.values(window.__wl).reduce((a, b) => a + Math.max(0, b), 0);
    return {
      scene: file,
      settledOnce: settles.length === 1,
      settleMs: settleMs === -1 ? null : Math.round(settleMs),
      overTimer: settleMs > ctx.timerLen * 1000,
      result: settles[0] || null,
      mountErr, crash,
      // THE assertion FixMisc wants: both must be 0
      tickerLeak: tk.count - tickBefore,
      windowListenerLeak: wlAfter - wlBefore,
      childrenLeft: container.children.length,
    };
  }

  const out = {};
  for (const f of files) {
    out[f] = {
      idle: await scenario(f, { timerLen: opts.timerLen ?? 20 }),
      esc: await scenario(f, { timerLen: 20, seed: 99, maxSimMs: 6000, actions: [{ at: 600, fn: () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) }] }),
      detA: await scenario(f, { timerLen: 8, seed: 777 }),
      detB: await scenario(f, { timerLen: 8, seed: 777 }),
    };
    out[f].detMatch = JSON.stringify(out[f].detA.result) === JSON.stringify(out[f].detB.result)
      && out[f].detA.settleMs === out[f].detB.settleMs;
  }
  return out;
}

/* Acceptance helper: every row must satisfy
     r.tickerLeak === 0 && r.windowListenerLeak === 0 && r.childrenLeft === 0
       && r.settledOnce && !r.crash && !r.mountErr
   For scenes whose idle path ignores ctx.timerLen (saberclash/slots/slimegallery at time of
   audit) expect overTimer=true on tight timers until Main lands the timerLen fixes.        */
