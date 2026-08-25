/* ============================================================================
   pack-onboard-w4.js — WAVE FOUR FIRST-VISIT LEGENDS (onboarding flavour pack)
   ----------------------------------------------------------------------------
   Wave-4 worlds carry new beats (the Eye's luck, the Shrine's critters, the
   negative-hp Abyss, Sanctuary chrome). Players meet each beat exactly once
   blind — this pack makes that first meeting legible, in the spirit of
   onboard.js (dismissible toasts, auto-fade) but expressed purely through
   hook modifiers so the ENGINE owns all DOM surfaces.

     IQ.Hooks.add({
       id: 'onboard-w4',
       always: true,
       weight: 0.1,   // cosmetic: run LAST so sibling packs' state is fresh
       handlers: { onRoundStart(ctx) -> { bannerText } | { overlayHTML } | null }
     });

   MECHANIC (pure flavour — zero score/hp/timer changes):
   * PER-WORLD LEGENDS, once per RUN each (IQ.Hooks.state key 'ob4:<worldId>'):
       ring-mountain            -> 'THE EYE WATCHES · HALFLING LUCK FAVORS THE BOLD'
       gold-shrine              -> 'CATCH ALL SIX CRITTERS · THE SHRINE REMEMBERS'
       abyss-void OR active     -> 'BELOW ZERO · THE ABYSS LENDS LIFE IT WILL RECLAIM'
         hh-negative-zone         (zone predicate read live from
                                   IQ.HellHeaven.negativeZone(); this pack runs
                                   after 'hell-heaven' in the dispatch fan, so
                                   the layer it reports is THIS round's)
       sanctuary beat           -> 'SANCTUARY · THE ORIGINAL LIGHT, BRIEFLY'
         (sanctuary trigger contract, mirrored read-only: ctx.world==='heaven'
          OR ctx.align==='good' — see sanctuary.js TRIGGER CONTRACT)
   * ONCE-PER-RUN INTRO CARD: first round with depth >= 3 also emits
       { overlayHTML:'WAVE FOUR · THE WORLD GREWS TEETH', overlayMs:5000 }
     The engine (.hook-overlay) already guarantees pointer-events:none and
     removal after overlayMs; the card itself adds a short fade-in animation
     gated by BOTH localStorage IQB_MOTION and prefers-reduced-motion
     (static card when reduced). Escapable by construction: no focus traps,
     clicks pass straight through to the board.
   * Cavern beats (crystal/dragon) are NOT covered — pack-cavern.js legends
     its own branches; skipped deliberately to avoid double-bannering.
   * PARITY RAIL C8: fully inert on rounds/depth <= 2.
   * Determinism: zero Math.random()/Date.now()/performance.now() anywhere;
     handlers are pure functions of (ctx, own 'ob4:*' state). No ctx.rng
     consumption at all — nothing here may perturb MP rng streams.
   * Never touches answers/scoring; never ships answer data pre-reveal.

   SELF TEST: node --check pack-onboard-w4.js
              node research/smoke-onboardw4.js
   ============================================================================*/
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;

  const ID = 'onboard-w4';
  const INTRO_KEY = 'ob4:intro';
  const INTRO_MS = 5000;
  const PARITY_ROUNDS = 2;

  /* ---- legend table: [stateKey, predicate(ctx), bannerText] --------------- */
  function abyssActive() {
    try {
      const HH = root.IQ && root.IQ.HellHeaven;
      return !!(HH && typeof HH.negativeZone === 'function' && HH.negativeZone());
    } catch (e) { return false; }
  }
  const LEGENDS = [
    ['ob4:ring-mountain',
     function (c) { return c.world === 'ring-mountain'; },
     'THE EYE WATCHES \u00b7 HALFLING LUCK FAVORS THE BOLD'],
    ['ob4:gold-shrine',
     function (c) { return c.world === 'gold-shrine'; },
     'CATCH ALL SIX CRITTERS \u00b7 THE SHRINE REMEMBERS'],
    ['ob4:abyss-void',
     function (c) { return c.world === 'abyss-void' || abyssActive(); },
     'BELOW ZERO \u00b7 THE ABYSS LENDS LIFE IT WILL RECLAIM'],
    ['ob4:sanctuary',
     function (c) { return c.world === 'heaven' || c.align === 'good'; },
     'SANCTUARY \u00b7 THE ORIGINAL LIGHT, BRIEFLY']
  ];

  /* ---- motion gating (same convention as hooks.js exemplars) -------------- */
  function motionOff() {
    try {
      if (typeof root.IQB_MOTION !== 'undefined' && !root.IQB_MOTION) return true;
      return typeof localStorage !== 'undefined' &&
             localStorage.getItem('IQB_MOTION') === '0';
    } catch (e) { return false; }
  }

  function introCard() {
    const animate = !motionOff();
    const css = animate
      ? '<style>.ob4-intro{animation:ob4in .5s ease both}' +
        '@media (prefers-reduced-motion:reduce){.ob4-intro{animation:none}}</style>' +
        '<style>@keyframes ob4in{from{opacity:0;transform:translateY(-8px)}' +
        'to{opacity:1;transform:none}}</style>'
      : '';
    return css +
      '<div class="ob4-intro" style="pointer-events:none;text-align:center;' +
      'padding:14px 26px;background:rgba(4,6,10,.82);border:1px solid #3a2a55;' +
      'border-radius:12px;color:#e8e2f4;font-size:13px;letter-spacing:.14em;' +
      'line-height:1.9;box-shadow:0 0 24px rgba(20,8,40,.6)">' +
      'WAVE FOUR<span style="display:block;font-size:11px;color:#a89cc8;' +
      'margin-top:6px">THE WORLD GREWS TEETH</span></div>';
  }

  /* ---- round gate ---------------------------------------------------------- */
  function roundDepth(c) {
    const d = c.depth != null ? Number(c.depth) : Number(c.round);
    return isFinite(d) ? d : NaN;
  }

  function onRoundStart(ctx) {
    try {
      const c = ctx || {};
      const d = roundDepth(c);
      if (!(d > PARITY_ROUNDS)) return null;           /* C8: inert rounds <= 2 */

      const st = root.IQ.Hooks.state;
      const out = {};

      /* first-seen-this-run world legends */
      for (let i = 0; i < LEGENDS.length; i++) {
        const key = LEGENDS[i][0];
        if (!st.has(key) && LEGENDS[i][1](c)) {
          st.set(key, true);
          if (!out.bannerText) out.bannerText = LEGENDS[i][2];
        }
      }

      /* once-per-run wave intro, first time depth reaches 3 */
      if (!st.has(INTRO_KEY) && d >= 3) {
        st.set(INTRO_KEY, true);
        out.overlayHTML = introCard();
        out.overlayMs = INTRO_MS;
        out.flag = 'ob4-intro';
      }

      return Object.keys(out).length ? out : null;
    } catch (e) {
      try { console.warn('[' + ID + '] onRoundStart swallowed:', e && e.message || e); } catch (_) {}
      return null;
    }
  }

  /* ---- registration (direct add, or canonical pending queue) --------------- */
  const PACK = { id: ID, always: true, weight: 0.1, handlers: { onRoundStart: onRoundStart } };
  try {
    if (root.IQ && root.IQ.Hooks && typeof root.IQ.Hooks.add === 'function') {
      root.IQ.Hooks.add(PACK);
    } else {
      root.IQ = root.IQ || {};
      (root.IQ.__hooksPending = root.IQ.__hooksPending || []).push(PACK);
    }
  } catch (e) {
    try { console.warn('[' + ID + '] registration swallowed:', e && e.message || e); } catch (_) {}
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { id: ID, onRoundStart: onRoundStart, LEGENDS: LEGENDS,
      /* handler sources for research/smoke-onboardw4.js determinism scans */
      _code: String(onRoundStart) + String(introCard) +
             String(motionOff) + String(abyssActive) };
  }
})();

