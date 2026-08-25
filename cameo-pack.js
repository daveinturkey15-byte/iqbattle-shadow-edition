/* ============================================================================
   cameo-pack.js — SILHOUETTE CAMEOS (pop-culture presence pack)
   ----------------------------------------------------------------------------
   Dave's wave-2 ask: pop-culture characters PRESENT IN the rounds, not just
   backdrop palettes. A generic silhouette-cameo system driven by ONE
   always-on hook:

     IQ.Hooks.add({
       id: 'cameo-pack',
       always: true,
       handlers: {
         onRoundStart(ctx) -> { overlayHTML } | undefined,
         onAnswer(ctx)     -> { bannerText } | undefined
       }
     });

   MECHANIC (pure presence flavour — zero score/hp changes):
   * onRoundStart maps ctx.world -> cameo spec from a fixed table
     (procedural inline-SVG silhouettes only; no images, no trademark text).
   * SEEDED PRESENCE: cameo appears iff ctx.rng() < 0.45 AND no cameo showed
     last round (never two rounds in a row; tracked as IQ.Hooks.state key
     'cameo-pack:last'). One rng value is consumed EVERY eligible round so
     MP tabs stay byte-identical regardless of outcome.
   * ONE MECHANICAL WINK MAX: onAnswer correct while the cameo is visible ->
     10% seeded chance of { bannerText: '<NAME> APPROVES' }. Nothing else.
   * minDepth gate: nothing happens before depth 3 (rounds 1–2 parity rule).

   FAIRNESS / DETERMINISM RAILS:
   * Overlay: pointer-events:none, escapable by construction, opacity .5,
     z-index 1 (below the options grid), text-free artwork (>=11px rule N/A).
   * Idle bob is a gentle CSS animation gated by BOTH localStorage IQB_MOTION
     and prefers-reduced-motion (static silhouette when reduced).
   * Zero Math.random()/Date.now() in gameplay decisions; handlers are pure
     functions of (ctx, own 'cameo-pack:*' state).
   * Never reads or leaks correct answers pre-reveal; banner fires AFTER
     scoring on a correct pick only.

   SELF TEST: node --check cameo-pack.js
              node -e "require('./cameo-pack.js').selfTest()"
   ============================================================================*/
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : globalThis;

  /* ---------- tuning constants ---------- */
  var HOOK_ID = 'cameo-pack';
  var MIN_DEPTH = 3;        /* parity: silent through rounds 1–2 */
  var SHOW_CHANCE = 0.45;   /* seeded presence chance */
  var WINK_CHANCE = 0.10;   /* seeded approval-banner chance */
  var LAST_KEY = 'cameo-pack:last';
  var WINK_KEY = 'cameo-pack:winked';

  /* ---------- cameo table (world id -> spec) ----------
   * Every entry: parody name + procedural SVG (viewBox 0 0 120 120).
   * Geometry only — no raster images, no external refs, no trademark text. */
  var REQUIRED_WORLDS = [
    'cyber-hunter', 'wasteland-roads', 'symbiote-party', 'doll-game',
    'gauntlet-temple', 'jester-court', 'metal-forge', 'pop-glitter',
    'scope-range'
  ];

  var TABLE = {

    /* chrome skull-and-eyes sentinel */
    'cyber-hunter': {
      name: 'CHROME SENTINEL',
      svg:
        '<defs><linearGradient id="iqc-chrome" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#e8f4ff"/><stop offset=".45" stop-color="#9fb4c8"/>' +
        '<stop offset=".55" stop-color="#5f7488"/><stop offset="1" stop-color="#c9dbea"/></linearGradient></defs>' +
        '<path d="M60 12c-25 0-40 17-40 37 0 14 6 23 11 27l4 20h50l4-20c5-4 11-13 11-27 0-20-15-37-40-37z" fill="url(#iqc-chrome)" stroke="#39506b" stroke-width="2"/>' +
        '<ellipse cx="43" cy="54" rx="11" ry="13" fill="#0b1622"/>' +
        '<circle cx="43" cy="54" r="5" fill="#59e6ff"/><circle cx="41" cy="52" r="1.6" fill="#eaffff"/>' +
        '<ellipse cx="77" cy="54" rx="11" ry="13" fill="#0b1622"/>' +
        '<circle cx="77" cy="54" r="5" fill="#59e6ff"/><circle cx="75" cy="52" r="1.6" fill="#eaffff"/>' +
        '<path d="M48 88v10M60 88v13M72 88v10" stroke="#39506b" stroke-width="3" stroke-linecap="round"/>'
    },

    /* interceptor car with driver spike */
    'wasteland-roads': {
      name: 'ROAD INTERCEPTOR',
      svg:
        '<polygon points="60,46 65,26 71,46" fill="#3b3b3b"/>' +                       /* driver spike */
        '<polygon points="8,88 16,66 40,57 62,44 94,46 110,60 114,88" fill="#8a4b1e" stroke="#4d2a0e" stroke-width="2"/>' +
        '<polygon points="46,60 64,49 88,51 100,61 78,63" fill="#1c130a"/>' +          /* canopy */
        '<polygon points="2,84 10,80 10,88 2,92" fill="#ffb01e" opacity=".85"/>' +      /* exhaust flare */
        '<circle cx="34" cy="89" r="12" fill="#171512"/><circle cx="34" cy="89" r="5" fill="#5c564e"/>' +
        '<circle cx="92" cy="89" r="12" fill="#171512"/><circle cx="92" cy="89" r="5" fill="#5c564e"/>' +
        '<rect x="106" y="70" width="7" height="6" fill="#ff2038"/>'
    },

    /* grinning black mask */
    'symbiote-party': {
      name: 'MIDNIGHT GRIN',
      svg:
        '<path d="M60 14c27 0 43 19 43 44S84 106 60 106 17 83 17 58 33 14 60 14z" fill="#101014"/>' +
        '<path d="M31 50q11-13 24-1q-12 11-24 1z" fill="#f2f2f2"/>' +
        '<path d="M89 50q-11-13-24-1q12 11 24 1z" fill="#f2f2f2"/>' +
        '<path d="M29 73q31 27 62 0q-6 25-31 25T29 73z" fill="#f2f2f2"/>' +
        '<path d="M42 79v13M52 83v13M62 83v13M72 79v13" stroke="#101014" stroke-width="3"/>'
    },

    /* giant doll face */
    'doll-game': {
      name: 'THE DOLL',
      svg:
        '<circle cx="18" cy="66" r="12" fill="#7a4bd6"/><circle cx="102" cy="66" r="12" fill="#7a4bd6"/>' +
        '<circle cx="60" cy="64" r="41" fill="#ffe3ec" stroke="#d98aa8" stroke-width="2"/>' +
        '<path d="M20 52q6-30 40-30t40 30q-14-12-40-12T20 52z" fill="#7a4bd6"/>' +
        '<ellipse cx="44" cy="62" rx="9" ry="11" fill="#ffffff"/>' +
        '<circle cx="44" cy="64" r="5" fill="#35507a"/><circle cx="42" cy="62" r="1.6" fill="#ffffff"/>' +
        '<ellipse cx="76" cy="62" rx="9" ry="11" fill="#ffffff"/>' +
        '<circle cx="76" cy="64" r="5" fill="#35507a"/><circle cx="74" cy="62" r="1.6" fill="#ffffff"/>' +
        '<ellipse cx="32" cy="80" rx="7" ry="4" fill="#ff9db5" opacity=".7"/>' +
        '<ellipse cx="88" cy="80" rx="7" ry="4" fill="#ff9db5" opacity=".7"/>' +
        '<path d="M53 87q7 6 14 0" stroke="#c96a86" stroke-width="3" fill="none" stroke-linecap="round"/>'
    },

    /* four rider silhouettes in a row */
    'gauntlet-temple': {
      name: 'FOUR RIDERS',
      svg:
        '<rect x="6" y="96" width="108" height="4" fill="#3d2f14"/>' +
        '<g fill="#181322">' +
        '<g><path d="M6 96q1-13 13-15l5-9h7l2 9q12 2 12 15z"/><circle cx="30" cy="64" r="5"/>' +
        '<path d="M22 76l8-8 6 8z"/></g>' +
        '<g><path d="M34 96q1-13 13-15l5-9h7l2 9q12 2 12 15z"/><circle cx="58" cy="64" r="5"/>' +
        '<path d="M50 76l8-8 6 8z"/></g>' +
        '<g><path d="M62 96q1-13 13-15l5-9h7l2 9q12 2 12 15z"/><circle cx="86" cy="64" r="5"/>' +
        '<path d="M78 76l8-8 6 8z"/></g>' +
        '<g><path d="M90 96q1-13 13-15l5-9h7l2 9q12 2 12 15z" transform="translate(-8 0)"/>' +
        '<circle cx="106" cy="64" r="5"/><path d="M98 76l8-8 6 8z"/></g>' +
        '</g>'
    },

    /* bell-hat jester */
    'jester-court': {
      name: 'COURT JESTER',
      svg:
        '<path d="M30 46q2-24 22-22q8-16 16 0q20-2 22 22z" fill="#5b2ea6"/>' +
        '<circle cx="47" cy="22" r="5" fill="#ffd23e" stroke="#b8891c" stroke-width="1.5"/>' +
        '<circle cx="60" cy="14" r="5" fill="#ffd23e" stroke="#b8891c" stroke-width="1.5"/>' +
        '<circle cx="76" cy="22" r="5" fill="#ffd23e" stroke="#b8891c" stroke-width="1.5"/>' +
        '<circle cx="60" cy="66" r="26" fill="#f6e7d7" stroke="#c9a888" stroke-width="2"/>' +
        '<path d="M24 88l10-10 10 10 8-12 8 12 10-10 10 10q-20 12-46 0z" fill="#ff5d8f"/>' +
        '<circle cx="50" cy="62" r="3.4" fill="#2b1b3d"/><circle cx="70" cy="62" r="3.4" fill="#2b1b3d"/>' +
        '<path d="M52 74q8 7 16 0" stroke="#2b1b3d" stroke-width="3" fill="none" stroke-linecap="round"/>'
    },

    /* horned devil horns */
    'metal-forge': {
      name: 'FORGE DEVIL',
      svg:
        '<circle cx="60" cy="86" r="30" fill="#ff6a1a" opacity=".18"/>' +
        '<path d="M36 112C20 86 22 54 46 30c-10 28-4 54 12 76z" fill="#c9202e"/>' +
        '<path d="M84 112c16-26 14-58-10-82 10 28 4 54-12 76z" fill="#c9202e"/>' +
        '<path d="M42 100C32 80 33 60 46 44c-6 20-2 38 8 52z" fill="#ff5a4a" opacity=".55"/>' +
        '<path d="M78 100c10-20 9-40-4-56 6 20 2 38-8 52z" fill="#ff5a4a" opacity=".55"/>'
    },

    /* diva mic silhouette */
    'pop-glitter': {
      name: 'GLITTER DIVA',
      svg:
        '<circle cx="60" cy="32" r="17" fill="#23202a"/>' +
        '<path d="M46 26h28M44 33h32M46 40h28" stroke="#4a4454" stroke-width="2"/>' +
        '<polygon points="53,48 67,48 73,94 47,94" fill="#33303c"/>' +
        '<rect x="40" y="96" width="40" height="7" rx="3" fill="#23202a"/>' +
        '<path d="M22 20l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#ffd23e"/>' +
        '<path d="M96 52l2.4 6.4 6.4 2.4-6.4 2.4-2.4 6.4-2.4-6.4-6.4-2.4 6.4-2.4z" fill="#ff7ac2"/>' +
        '<path d="M24 66l2 5.2 5.2 2-5.2 2-2 5.2-2-5.2-5.2-2 5.2-2z" fill="#7dd3fc"/>'
    },

    /* glinting scope ring */
    'scope-range': {
      name: 'THE SCOPE',
      svg:
        '<circle cx="60" cy="60" r="45" fill="#0d2413"/>' +
        '<circle cx="60" cy="60" r="45" fill="none" stroke="#9fe08a" stroke-width="6"/>' +
        '<circle cx="60" cy="60" r="31" fill="none" stroke="#9fe08a" stroke-width="2"/>' +
        '<path d="M60 15v14M60 91v14M15 60h14M91 60h14" stroke="#9fe08a" stroke-width="3"/>' +
        '<circle cx="60" cy="60" r="2.4" fill="#d6ffc2"/>' +
        '<path d="M30 34l7 3-3 7-7-3z" fill="#eaffea" opacity=".85"/>'
    }
  };

  /* ---------- pure decision helpers (unit-tested by selfTest) ---------- */

  /* Seeded presence: appears this round iff roll passes AND last round was
   * cameo-free. Never two rounds in a row. */
  function showDecision(roll, hadLastRound) {
    return !hadLastRound && roll < SHOW_CHANCE;
  }

  /* One mechanical wink max: correct answer while visible + seeded 10%. */
  function winkDecision(roll, alreadyWinked) {
    return !alreadyWinked && roll < WINK_CHANCE;
  }

  /* ---------- presentation ---------- */

  function motionOK() {
    try {
      if (root.localStorage && root.localStorage.getItem('IQB_MOTION') === 'false') return false;
    } catch (e) { /* default allow */ }
    try {
      if (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    } catch (e) { /* default allow */ }
    return true;
  }

  function buildOverlay(spec) {
    var anim = motionOK()
      ? 'animation:iqCameoBob 3.2s ease-in-out infinite;'
      : '';
    return (
      '<div class="iq-cameo" style="position:absolute;left:12px;bottom:8px;width:120px;height:120px;' +
      'pointer-events:none;opacity:.5;z-index:1;line-height:0;user-select:none">' +
      '<style>@keyframes iqc-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}' +
      '@media(prefers-reduced-motion:reduce){.iq-cameo svg{animation:none!important}}</style>' +
      '<svg viewBox="0 0 120 120" style="width:100%;height:100%;display:block;' + anim + '">' +
      spec.svg +
      '</svg></div>'
    );
  }

  /* ---------- hook handlers ---------- */

  function stateApi() {
    return root.IQ && root.IQ.Hooks ? root.IQ.Hooks.state : null;
  }

  function onRoundStart(ctx) {
    if (!ctx || typeof ctx.depth !== 'number' || ctx.depth < MIN_DEPTH) return undefined;
    var spec = TABLE[ctx.world];
    if (!spec) return undefined;
    var st = stateApi();

    var roll = ctx.rng(); /* consumed EVERY eligible round — parity-safe */
    var hadLast = st ? st.has(LAST_KEY) : false;

    if (!showDecision(roll, hadLast)) {
      if (st) st.del(LAST_KEY); /* clear the back-off once a quiet round passes */
      return undefined;
    }
    if (st) st.set(LAST_KEY, ctx.world);
    return { overlayHTML: buildOverlay(spec), flag: 'cameo-visible:' + ctx.world };
  }

  function onAnswer(ctx) {
    if (!ctx || !ctx.res || !ctx.res.correct) return undefined; /* post-score only */
    var spec = TABLE[ctx.world];
    if (!spec) return undefined;
    var st = stateApi();
    if (!st || !st.has(LAST_KEY)) return undefined; /* cameo not visible this round */
    var winked = st.has(WINK_KEY);

    var roll = ctx.rng(); /* consumed only on correct-answer-with-cameo events */
    if (!winkDecision(roll, winked)) return undefined;
    st.set(WINK_KEY, true);
    return { bannerText: spec.name + ' APPROVES', flag: 'cameo-wink' };
  }

  /* ---------- registration ---------- */

  function registerHook() {
    var payload = {
      id: HOOK_ID,
      always: true,
      handlers: { onRoundStart: onRoundStart, onAnswer: onAnswer }
    };
    if (root.IQ && root.IQ.Hooks && typeof root.IQ.Hooks.add === 'function') {
      try { root.IQ.Hooks.add(payload); return true; } catch (e) { /* fall through */ }
    }
    (root.IQ = root.IQ || {}).__hooksPending = root.IQ.__hooksPending || [];
    root.IQ.__hooksPending.push(payload);
    return false;
  }

  /* ---------- embedded self test ---------- */

  function selfTest() {
    var fails = [];
    function ok(cond, msg) { if (!cond) fails.push(msg); }

    /* T1: table complete for every listed world id, no undefined entries */
    for (var i = 0; i < REQUIRED_WORLDS.length; i++) {
      var w = REQUIRED_WORLDS[i];
      var s = TABLE[w];
      ok(s && typeof s === 'object', 'table missing entry for ' + w);
      if (s) {
        ok(typeof s.name === 'string' && s.name.length >= 3, 'bad name for ' + w);
        ok(typeof s.svg === 'string' && s.svg.indexOf('<svg') !== 0, '' + w + ': svg is fragment (host supplies <svg> wrapper)');
        ok(s.svg.length > 40, 'suspiciously short svg for ' + w);
        /* asset-free rails: no images, no network refs inside svg bodies */
        ok(s.svg.indexOf('<img') === -1, w + ': svg contains <img');
        ok(s.svg.toLowerCase().indexOf('http') === -1, w + ': svg contains http ref');
      }
    }
    ok(Object.keys(TABLE).length === REQUIRED_WORLDS.length,
       'table has entries outside the audited world list');

    /* T2: rng-gated visibility logic */
    ok(showDecision(0.44, false) === true, 'roll .44 should show');
    ok(showDecision(0.46, false) === false, 'roll .46 should not show');
    ok(showDecision(0.0, true) === false, 'back-off: never two rounds in a row');
    ok(winkDecision(0.09, false) === true, 'wink roll .09 fires');
    ok(winkDecision(0.11, false) === false, 'wink roll .11 stays quiet');
    ok(winkDecision(0.0, true) === false, 'one mechanical wink max');

    /* T3: deterministic simulation — no consecutive cameo rounds across seeds */
    function mulberry(a) {
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    for (var seed = 1; seed <= 25; seed++) {
      var r = mulberry(seed * 7919), lastShown = false, shows = 0;
      for (var round = 0; round < 200; round++) {
        var shown = showDecision(r(), lastShown);
        if (lastShown && shown) fails.push('consecutive cameo in seed ' + seed);
        if (shown) shows++;
        lastShown = shown;
      }
      ok(shows > 0 && shows < 200, 'seed ' + seed + ' degenerate schedule');
    }

    if (fails.length) {
      return { ok: false, fails: fails };
    }
    return { ok: true, checks: REQUIRED_WORLDS.length + 6 + 25 };
  }

  /* ---------- public surface ---------- */

  var API = {
    id: HOOK_ID,
    worlds: REQUIRED_WORLDS.slice(),
    table: TABLE,
    showDecision: showDecision,
    winkDecision: winkDecision,
    selfTest: selfTest
  };
  root.IQ = root.IQ || {};
  root.IQ.Cameos = API;

  API.hookRegistered = registerHook();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
})();
