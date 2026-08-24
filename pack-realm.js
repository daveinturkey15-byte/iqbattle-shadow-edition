/* ============================================================================
 * IQ.Realm — pack-realm.js — heaven/hell traversal army pack
 * (contract: hooks.js window.IQ.Hooks; worlds: research/w1-contracts.md C3)
 *
 * Maps Dave's spec lines to mechanics:
 *
 *  [1] SEVEN LAYERS OF HELL — world id 'hell-layer' (ONE parametrized def;
 *      def.layer carries the active depth 1..7, fed by ctx.hellLayer from
 *      ContinuityV2 during deepest arcs, else derived arithmetically from
 *      ctx.round). Roman-numeral banner every layer. Layer-appropriate play:
 *        r1 VESTIBULE OF STATIC    — moaning embers, cosmetic only
 *        r2 SMOLDERING GARDEN     — ash fall, cosmetic only
 *        r3 SERPENT GALLERY       — serpents slither the lower edge (cosmetic)
 *        r4 WEB OF ARACHNE        — TELEGRAPHED: one random option is webbed
 *                                   (disabled) for the first 3s of the round,
 *                                   then released
 *        r5 MIDDEN OF ANTS        — ant swarm crawls the bottom edge (cosmetic)
 *        r6 FIELD OF RUSTED NAILS — TELEGRAPHED: a picked wrong answer bleeds
 *                                   an EXTRA -8 hp (never lethal from full hp)
 *        r7 PILLARS OF FIRE       — TELEGRAPHED: flame strips flash in the
 *                                   gutters BETWEEN options, each flash <=150ms
 *                                   at <=2Hz, motion-gated
 * [2] SANCTUM LIGHT — world 'sanctum-light' (align good): healing halo grants
 *      +8 hp on every correct answer (TELEGRAPHED banner); angels drift as
 *      cosmetic rings; the GOD BEAM fires ONCE per round — pure light show
 *      that gilds the BOARD FRAME border gold (never touches options).
 * [3] BLACK HOLE VOID — world 'void-black' (align chaotic, rare): gravity
 *      pull wobbles the answer tiles via an injected CSS translate drift;
 *      answering within 5s banks a VOID TOKEN (Hooks.state 'pack-realm:*');
 *      at 3 tokens the next void round auto-spends them — the LENS collapses
 *      one randomly-chosen option for that round (blind draw from ctx.rng;
 *      engine guarantees >=1 option stays selectable).
 * [4] HAZARD PIT — world 'hazard-pit' (align bad): each round rolls ONE mini
 *      hazard (serpents / webs / nails) via ctx.rng and TELEGRAPHS it in the
 *      round-start banner before anything applies.
 *
 * Hard rules honored:
 *   - every damaging/disabling effect is announced in a round-start banner
 *     BEFORE it can bite (acceptance: hazards always telegraphed);
 *   - worst case damage is -8 per wrong answer => no instant deaths from
 *     full hp, and nothing here ends a run except hp<=0 (engine-owned);
 *   - deterministic: all choices come from ctx.rng (or Hooks.makeRng seeded
 *     from ctx.seed/round as fallback); Math.random is never used. The ONLY
 *     wall-clock reads are DURATION measurements (the 3s web window, the 5s
 *     token window, FX teardown timers) — human input latency is not a
 *     deterministic quantity by nature, and no outcome choice depends on it;
 *   - overlays are pointer-events:none, hug the edges/gutters, never cover
 *     the board or answer glyphs; flashes <=150ms at <=2-3Hz; all ambient
 *     motion behind IQB_MOTION (static fallback when off);
 *   - asset-free: canvas + CSS + oscillator blips only.
 * ============================================================================*/
(function () {
'use strict';
var root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};

var TAU = Math.PI * 2;

/* ---------- helpers ---------- */

function motionOK() { return root.IQB_MOTION !== false; }

/* Monotonic ms clock — used ONLY to measure elapsed durations (web window,
 * token window, FX teardown). Never used to pick outcomes. */
function nowMs() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function rngOf(ctx) {
  if (ctx && typeof ctx.rng === 'function') return ctx.rng;
  var H = root.IQ && root.IQ.Hooks;
  var seed = ((ctx && ctx.seed) >>> 0) ^ (((ctx && ctx.round) || 0) * 2654435761);
  return (H && H.makeRng) ? H.makeRng(seed) : function () { return 0.5; };
}

function st(k, v) {
  var H = root.IQ && root.IQ.Hooks;
  if (H && H.state) {
    if (arguments.length === 1) return H.state.get(k);
    return H.state.set(k, v);
  }
  return undefined; /* per-match store absent — tokens simply don't persist */
}

function vgrad(c, h, stops) {
  var g = c.createLinearGradient(0, 0, 0, h);
  for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
  c.fillStyle = g; c.fillRect(0, 0, c.canvas.width, h);
}

/* ---------- injected CSS ---------- */

var styleDone = false;
function ensureStyle() {
  if (styleDone || typeof document === 'undefined') return;
  styleDone = true;
  var s = document.createElement('style');
  s.id = 'iqb-realm-style';
  s.textContent =
    '.realm-ov{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:5}' +
    /* [1r7] fire pillars: lit ~115ms of every 500ms (~2Hz, <=150ms) */
    '@keyframes realm-flicker{0%,22%{opacity:.9}23%,100%{opacity:.05}}' +
    '@keyframes realm-flicker-b{0%,16%{opacity:.75}17%,58%{opacity:.05}59%,74%{opacity:.6}75%,100%{opacity:.05}}' +
    /* [1r3] serpents: gentle sway of the whole ribbon strip */
    '@keyframes realm-sway{0%,100%{transform:translateY(0)}50%{transform:translateY(6px)}}' +
    /* [1r5] ants marching along the bottom edge */
    '@keyframes realm-march{from{transform:translateX(-8vw)}to{transform:translateX(108vw)}}' +
    /* [2] angels bobbing */
    '@keyframes realm-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}' +
    /* [3] gravity drift on the answer tiles (subtle, slow, motion-gated by JS) */
    '@keyframes realm-drift{0%,100%{transform:translate(0,0)}33%{transform:translate(1.6px,-1.2px)}66%{transform:translate(-1.4px,1px)}}' +
    '.realm-void .opt-btn{animation:realm-drift 4.2s ease-in-out infinite}' +
    '.realm-void .opt-btn:nth-child(2n){animation-duration:5.1s;animation-delay:-1.3s}' +
    '.realm-void .opt-btn:nth-child(3n){animation-duration:4.7s;animation-delay:-2.2s}' +
    /* [2] god beam: gilds the BOARD FRAME border only — never the glyphs */
    '#board-frame{transition:box-shadow .45s ease}' +
    '.realm-godbeam #board-frame{box-shadow:0 0 0 2px rgba(255,216,130,.95),0 0 44px 12px rgba(255,206,92,.5),inset 0 0 18px rgba(255,226,150,.25)}' +
    '.realm-godbeam-static #board-frame{box-shadow:0 0 0 2px rgba(255,216,130,.8),0 0 26px 6px rgba(255,206,92,.32)}' +
    '';
  (document.head || document.documentElement).appendChild(s);
}

/* ---------- round state (mirrors per-match facts; rebuilt every round) ---- */

var S = {
  mode: null,          /* 'hell' | 'sanctum' | 'void' | 'pit' | null */
  layer: 0,            /* hell depth 1..7 (0 = not hell) */
  pit: null,           /* 'serpents' | 'webs' | 'nails' in pit mode */
  web: null,           /* {idx:number, until:number} active web snare */
  nails: false,        /* rusted-nails bleed armed this round */
  qStart: 0,           /* round-start monotonic ms (token window origin) */
  beamFired: false     /* god beam once-per-round guard */
};

var ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

var LAYERS = {
  1: { name: 'THE VESTIBULE OF STATIC', fx: 'embers' },
  2: { name: 'THE SMOLDERING GARDEN', fx: 'ash' },
  3: { name: 'THE SERPENT GALLERY', fx: 'serpents' },
  4: { name: 'THE WEB OF ARACHNE', fx: 'webs' },
  5: { name: 'THE MIDDEN OF ANTS', fx: 'ants' },
  6: { name: 'THE FIELD OF RUSTED NAILS', fx: 'nails' },
  7: { name: 'THE PILLARS OF FIRE', fx: 'fire' }
};

function hellLayerFor(worldId, ctx) {
  var l = ctx ? (ctx.hellLayer != null ? ctx.hellLayer : ctx.layer) : null;
  l = parseInt(l, 10);
  if (!(l >= 1 && l <= 7)) {
    /* No ContinuityV2 depth signal: derive arithmetically from the round so
     * the descent stays deterministic and deepens through long arcs. */
    l = Math.min(7, 1 + Math.floor((((ctx && ctx.round) || 1)) / 3));
  }
  return l;
}

function modeFor(ctx) {
  var w = ctx ? String(ctx.world || '') : '';
  if (w === 'hell-layer') return 'hell';
  if (w === 'sanctum-light') return 'sanctum';
  if (w === 'void-black') return 'void';
  if (w === 'hazard-pit') return 'pit';
  /* align-refinement fallback if the planner ever binds us without a world id */
  var a = ctx ? String(ctx.align || '') : '';
  if (a === 'good') return 'sanctum';
  if (a === 'chaotic') return 'void';
  return null;
}

/* ---------- overlay builders (edge-hugging, pointer-events:none) ---------- */

function ovOpen() { return '<div class="realm-ov">'; }
function ovClose() { return '</div>'; }

/* [1r3]/[4] serpents: two beaded ribbons slithering along the lower edge. */
function serpentsOverlay(r) {
  var bits = '';
  for (var sn = 0; sn < 2; sn++) {
    var yBase = 88 + sn * 5;                       /* vh */
    var hue = sn ? '#7fbf3f' : '#3f8f2f';
    for (var i = 0; i < 14; i++) {
      var ph = i * 0.55 + sn * 1.9 + r();
      var x = 4 + i * 6.6 + (r() * 2 - 1);
      var y = yBase + Math.sin(ph) * 2.2;
      bits += '<span style="position:absolute;left:' + x.toFixed(1) + '%;top:' + y.toFixed(1) +
        '%;width:' + (9 - (i % 3)) + 'px;height:' + (9 - (i % 3)) + 'px;border-radius:50%;background:' + hue +
        ';opacity:.8"></span>';
    }
    /* head */
    bits += '<span style="position:absolute;left:' + (4 + 14 * 6.6).toFixed(1) + '%;top:' + (yBase - 0.6).toFixed(1) +
      '%;width:13px;height:11px;border-radius:60% 40% 50% 50%;background:' + hue + '"></span>';
  }
  return ovOpen() + bits + ovClose();
}

/* [1r5] ants: a marching column of specks pinned to the bottom strip. */
function antsOverlay(r) {
  var bits = '';
  for (var i = 0; i < 16; i++) {
    var dur = 5 + r() * 4, delay = -r() * 8, lane = 92 + (i % 4) * 1.9, sz = 4 + (i % 3);
    bits += '<span style="position:absolute;top:' + lane.toFixed(1) + 'vh;width:' + sz + 'px;height:' + (sz - 1) +
      'px;background:#120b06;border-radius:40%;opacity:.85;' +
      'animation:realm-march ' + dur.toFixed(2) + 's linear ' + delay.toFixed(2) + 's infinite"></span>';
  }
  var inner = bits;
  if (!motionOK()) { /* static speckle fallback */
    inner = '';
    for (i = 0; i < 16; i++) {
      inner += '<span style="position:absolute;left:' + (r() * 96).toFixed(1) + '%;top:' + (91 + (i % 4) * 1.9).toFixed(1) +
        'vh;width:4px;height:3px;background:#120b06;opacity:.7"></span>';
    }
  }
  return ovOpen() + inner + ovClose();
}

/* [1r7] fire pillars: thin flame strips in the LEFT/RIGHT gutters and the
 * horizontal gaps between option rows — never overlapping the tiles. */
function fireOverlay() {
  function strip(left, top, w, h, delay, alt) {
    return '<span style="position:absolute;left:' + left + ';top:' + top + ';width:' + w + ';height:' + h +
      ';background:linear-gradient(180deg,rgba(255,236,170,.95),rgba(255,120,20,.65) 55%,rgba(160,20,0,.15));' +
      'border-radius:6px;filter:blur(1px);animation:' + (alt ? 'realm-flicker-b' : 'realm-flicker') +
      ' .5s linear ' + delay + 's infinite"></span>';
  }
  var b =
    strip('1.2%', '18%', '10px', '62%', 0, false) +
    strip('calc(98.8% - 10px)', '24%', '10px', '54%', .17, false) +
    strip('14%', '-6px', '72%', '6px', .09, true) +
    strip('14%', 'calc(50% - 3px)', '72%', '6px', .31, true) +
    strip('14%', '94%', '72%', '6px', .23, true);
  if (!motionOK()) { /* static embers: animation suppressed via inline override */
    b = b.replace(/animation:[^;"]+/g, 'animation:none').replace(/opacity:\.9|opacity:\.75/g, 'opacity:.12');
  }
  return ovOpen() + b + ovClose();
}

/* [1r1/r2] embers & ash: sparse drifting motes near the edges. */
function motesOverlay(r, ash) {
  var bits = '';
  for (var i = 0; i < 14; i++) {
    var x = 2 + r() * 96, y = ash ? (6 + r() * 88) : (40 + r() * 56);
    var col = ash ? 'rgba(200,190,180,.5)' : 'rgba(255,140,40,.75)';
    bits += '<span style="position:absolute;left:' + x.toFixed(1) + '%;top:' + y.toFixed(1) +
      '%;width:3px;height:' + (ash ? 3 : 5) + 'px;background:' + col + ';border-radius:50%"></span>';
  }
  return ovOpen() + bits + ovClose();
}

/* [2] angel rings: two halos bobbing in the upper corners. */
function angelsOverlay(r) {
  function angel(x, y, d, delay) {
    return '<span style="position:absolute;left:' + x + '%;top:' + y + '%;width:' + d + 'px;height:' + (d * 0.42) +
      'px;border:2px solid rgba(255,232,170,.85);border-radius:50%;box-shadow:0 0 18px rgba(255,222,140,.45)' +
      (motionOK() ? ';animation:realm-bob 3.4s ease-in-out ' + delay + 's infinite' : '') + '"></span>' +
      '<span style="position:absolute;left:calc(' + x + '% + ' + (d * 0.28) + 'px);top:calc(' + y + '% + ' + (d * 0.42) +
      'px);width:' + (d * 0.44) + 'px;height:' + (d * 0.44) + 'px;border-radius:50%;background:rgba(255,240,200,.35);filter:blur(2px)' +
      (motionOK() ? ';animation:realm-bob 3.4s ease-in-out ' + delay + 's infinite' : '') + '"></span>';
  }
  return ovOpen() + angel(2.5, 6, 46, 0) + angel(93, 9, 38, -1.7) + ovClose();
}

/* [2] god beam — once per round, on the first tick: gild #board-frame. */
function fireGodBeam() {
  if (typeof document === 'undefined') return;
  ensureStyle();
  var cls = motionOK() ? 'realm-godbeam' : 'realm-godbeam-static';
  document.body.classList.add(cls);
  setTimeout(function () { document.body.classList.remove('realm-godbeam', 'realm-godbeam-static'); }, 2400);
}

/* [3] void tile drift: toggles a body class; CSS does the wobble. */
function voidDrift(on) {
  if (typeof document === 'undefined') return;
  ensureStyle();
  document.body.classList.toggle('realm-void', !!on && motionOK());
}

/* ==========================================================================
 * HOOK PACK
 * ========================================================================*/

var HANDLERS = {

  /* ---- round start: resolve realm, TELEGRAPH every hazard, arm effects --- */
  onRoundStart: function (ctx) {
    var r = rngOf(ctx);
    var prev = S.mode;
    S.mode = modeFor(ctx);
    S.web = null; S.nails = false; S.beamFired = false;
    S.qStart = nowMs();
    S.pit = null;
    voidDrift(S.mode === 'void');
    if (prev !== S.mode) { /* nothing persistent crosses realms */ }

    if (!S.mode) return;

    if (S.mode === 'hell') {
      S.layer = hellLayerFor(ctx.world, ctx);
      if (typeof HELL_DEF !== 'undefined') HELL_DEF.layer = S.layer;
      var L = LAYERS[S.layer];
      var head = 'LAYER ' + ROMAN[S.layer - 1] + ' — ' + L.name;
      switch (L.fx) {
        case 'webs':
          /* TELEGRAPH then snare: one random option webbed for 3s. */
          var idx = Math.min(ctx.optCount || 8, Math.max(0, Math.floor(r() * (ctx.optCount || 8))));
          S.web = { idx: idx, until: nowMs() + 3000 };
          return { disableOptionIdx: [idx], bannerText: head + ' · A PATH IS WEBBED (3s)', sfx: 'zap', flag: 'hell-web' };
        case 'nails':
          /* TELEGRAPH the bleed BEFORE any wrong answer can trigger it. */
          S.nails = true;
          return { bannerText: head + ' · WRONG PICKS BLEED −8', sfx: 'zap', flag: 'hell-nails' };
        case 'fire':
          /* TELEGRAPH the strobe; flashes stay <=150ms @ ~2Hz, gutter-only. */
          return { overlayHTML: fireOverlay(), bannerText: head + ' · MIND THE PILLARS', flag: 'hell-fire' };
        case 'serpents':
          return { overlayHTML: serpentsOverlay(r), bannerText: head, flag: 'hell-snakes' };
        case 'ants':
          return { overlayHTML: antsOverlay(r), bannerText: head, flag: 'hell-ants' };
        default:
          return { overlayHTML: motesOverlay(r, L.fx === 'ash'), bannerText: head, flag: 'hell-' + S.layer };
      }
    }

    if (S.mode === 'sanctum') {
      return {
        bannerText: 'SANCTUM LIGHT · THE HALO MENDS (+8)',
        overlayHTML: angelsOverlay(r),
        sfx: 'chime',
        flag: 'sanctum-halo'
      };
    }

    if (S.mode === 'void') {
      var tokens = st('pack-realm:voidTokens') || 0;
      if (tokens >= 3) {
        /* LENS: spend 3 tokens to collapse one random option this round.
         * Blind draw from ctx.rng — the engine guarantees >=1 selectable. */
        st('pack-realm:voidTokens', tokens - 3);
        var oc = ctx.optCount || 8;
        var li = Math.min(oc, Math.max(0, Math.floor(r() * oc)));
        return {
          disableOptionIdx: [li],
          bannerText: 'EVENT HORIZON · LENS DEVOURS 3 TOKENS — ONE PATH COLLAPSES',
          sfx: 'zap',
          pickup: { kind: 'coin', value: -3 },
          flag: 'void-lens'
        };
      }
      return {
        bannerText: 'EVENT HORIZON · ANSWER IN 5s FOR A VOID TOKEN (' + tokens + '/3)',
        flag: 'void-pull'
      };
    }

    /* pit: roll ONE mini hazard and telegraph it before anything applies */
    var roll = r();
    if (roll < 0.34) {
      S.pit = 'serpents';
      return { overlayHTML: serpentsOverlay(r), bannerText: 'HAZARD PIT · SERPENTS BELOW', flag: 'pit-snakes' };
    } else if (roll < 0.67) {
      S.pit = 'webs';
      var wi = Math.min(ctx.optCount || 8, Math.max(0, Math.floor(r() * (ctx.optCount || 8))));
      S.web = { idx: wi, until: nowMs() + 3000 };
      return { disableOptionIdx: [wi], bannerText: 'HAZARD PIT · SPIDER WEBS — A PATH IS WEBBED (3s)', sfx: 'zap', flag: 'pit-webs' };
    } else {
      S.pit = 'nails'; S.nails = true;
      return { bannerText: 'HAZARD PIT · RUSTED NAILS — WRONG PICKS BLEED −8', sfx: 'zap', flag: 'pit-nails' };
    }
  },

  /* ---- tick: sustain the 3s web window; fire the once-per-round god beam -- */
  onTick: function (ctx) {
    void ctx;
    if (S.mode === 'sanctum' && !S.beamFired) {
      S.beamFired = true;
      fireGodBeam(); /* pure light show on the board frame border */
    }
    if (S.web) {
      if (nowMs() < S.web.until) return { disableOptionIdx: [S.web.idx] };
      S.web = null; /* 3s elapsed — the web releases; stop sustaining */
    }
    return;
  },

  /* ---- answer: nails bleed, halo heal, void tokens ------------------------ */
  onAnswer: function (ctx) {
    var res = ctx && ctx.res;
    if (!res) return;

    if (S.nails && !res.correct && res.picked >= 0) {
      /* worst case −8: cannot kill from full hp; death stays engine-owned */
      return { hpDelta: -8, bannerText: 'RUSTED NAILS · −8', sfx: 'zap', flag: 'nail-bite' };
    }

    if (S.mode === 'sanctum' && res.correct) {
      return { hpDelta: +8, bannerText: 'HALO MENDS · +8', sfx: 'chime', flag: 'halo-heal' };
    }

    if (S.mode === 'void' && res.correct) {
      var dt = nowMs() - S.qStart;
      if (dt >= 0 && dt < 5000) {
        var n = (st('pack-realm:voidTokens') || 0) + 1;
        st('pack-realm:voidTokens', n);
        return {
          bannerText: 'VOID TOKEN BANKED (' + n + '/3)',
          pickup: { kind: 'coin', value: 1 },
          sfx: 'chime',
          flag: 'void-token'
        };
      }
    }
    return;
  },

  /* ---- interlude: drop all transient realm classes ------------------------ */
  onInterlude: function () {
    S.web = null; S.nails = false;
    voidDrift(false);
    if (typeof document !== 'undefined') {
      document.body.classList.remove('realm-godbeam', 'realm-godbeam-static');
    }
    return;
  }
};

/* Late-safe registration: hooks.js may load after us depending on order. */
(function regHook(attempt) {
  var H = root.IQ && root.IQ.Hooks;
  if (H && typeof H.add === 'function') {
    H.add({
      id: 'pack-realm',
      worlds: ['hell-layer', 'sanctum-light', 'void-black', 'hazard-pit'],
      weight: 2,
      handlers: HANDLERS
    });
    return;
  }
  if (attempt < 40 && typeof setTimeout === 'function') {
    setTimeout(function () { regHook(attempt + 1); }, 50);
  }
})(0);

/* ==========================================================================
 * WORLDS
 * ========================================================================*/

/* [1] hell-layer — ONE parametrized inferno; depth comes from def.layer,
 * kept in sync by the hook above (ctx.hellLayer from ContinuityV2 when live). */
var HELL_DEF = {
  id: 'hell-layer', layer: 1, align: 'bad',
  pal: ['#ff3b16', '#7a0e00', '#ff8a4d', '#16030a', '#ffb37a', '#4a0d02', '#ffd9a0', '#26040c'],
  draw: function (c, w, h, t) {
    var L = Math.min(7, Math.max(1, this.layer || 1)), d = L / 7;   /* depth 0..1 */
    var hot = Math.floor(30 + 90 * d);
    vgrad(c, h, [
      [0, 'rgb(' + (18 + hot) + ',' + (4 + 8 * d) + ',6)'],
      [0.55, 'rgb(' + (40 + hot) + ',' + (8 + 14 * d) + ',8)'],
      [1, 'rgb(' + (10 + hot * 0.6) + ',3,4)']
    ]);
    /* far stalactites multiply with depth */
    var nSt = 5 + L * 2;
    c.fillStyle = 'rgba(8,1,3,.8)';
    for (var i = 0; i < nSt; i++) {
      var sx = ((i * 137.5) % 100) / 100 * w;
      var len = h * (0.08 + ((i * 61.8) % 40) / 100) * (0.7 + 0.6 * d);
      var wd = 14 + ((i * 29) % 22);
      c.beginPath();
      c.moveTo(sx - wd / 2, 0); c.lineTo(sx + wd / 2, 0); c.lineTo(sx, len);
      c.closePath(); c.fill();
    }
    /* lava lake: rippling surface whose glow rises with depth */
    var ly = h * (0.82 - 0.06 * d);
    var lg = c.createLinearGradient(0, ly, 0, h);
    lg.addColorStop(0, 'rgba(255,' + Math.floor(90 + 80 * d) + ',20,.95)');
    lg.addColorStop(0.4, 'rgba(210,40,0,.9)');
    lg.addColorStop(1, 'rgba(60,4,0,.95)');
    c.fillStyle = lg;
    c.beginPath(); c.moveTo(0, h); c.lineTo(0, ly);
    for (var x = 0; x <= w; x += 14) c.lineTo(x, ly + Math.sin(x * 0.02 + t * (0.8 + d)) * (3 + 5 * d));
    c.lineTo(w, h); c.closePath(); c.fill();
    /* rising embers, faster and denser with depth (t-driven, deterministic) */
    var nE = 10 + L * 3;
    for (i = 0; i < nE; i++) {
      var seedX = ((i * 97.3) % 100) / 100;
      var ey = h - ((t * (26 + 14 * d) * (0.5 + seedX) + i * 83) % (h * 0.9));
      var ex = seedX * w + Math.sin(t * 1.7 + i) * 14;
      c.fillStyle = 'rgba(255,170,70,' + (0.55 - 0.4 * (ey / h)).toFixed(3) + ')';
      c.fillRect(ex, ey, 3, 3 + (i % 2));
    }
    /* per-layer signature silhouettes */
    if (L >= 3) { /* serpent ridges along the shore */
      c.strokeStyle = 'rgba(20,40,10,.85)'; c.lineWidth = 4 + d * 3;
      c.beginPath();
      for (x = 0; x <= w; x += 10) {
        var sy = ly - 8 - Math.abs(Math.sin(x * 0.015 + t * 1.1)) * (14 + 8 * Math.sin(t * 0.6 + x * 0.004));
        if (x === 0) c.moveTo(x, sy); else c.lineTo(x, sy);
      }
      c.stroke();
    }
    if (L >= 4 && L !== 5 && L !== 6) { /* corner webs thicken toward r7 haze */
      c.strokeStyle = 'rgba(230,225,215,' + (0.10 + 0.03 * L).toFixed(2) + ')'; c.lineWidth = 1;
      for (i = 0; i < 7; i++) {
        c.beginPath(); c.moveTo(0, 0);
        c.lineTo(w * 0.3, h * (0.06 + i * 0.05)); c.stroke();
        c.beginPath(); c.moveTo(w, 0);
        c.lineTo(w * 0.7, h * (0.06 + i * 0.05)); c.stroke();
      }
    }
    if (L >= 5) { /* ant columns crossing the dark band above the lava */
      c.fillStyle = 'rgba(10,6,2,.9)';
      for (i = 0; i < 12; i++) {
        var ax = (i * 53 + t * (18 + i % 5 * 6)) % w;
        c.fillRect(ax, h * 0.68 + (i % 3) * 7, 4, 3);
      }
    }
    if (L >= 7) { /* pillar glows framing the arena */
      for (i = 0; i < 4; i++) {
        var px = w * (0.12 + i * 0.25), pw = 16 + 8 * Math.sin(t * 3 + i * 1.4);
        var pg = c.createLinearGradient(px - pw, 0, px + pw, 0);
        pg.addColorStop(0, 'rgba(255,120,20,0)');
        pg.addColorStop(0.5, 'rgba(255,220,140,' + (0.22 + 0.1 * Math.sin(t * 4 + i)).toFixed(2) + ')');
        pg.addColorStop(1, 'rgba(255,120,20,0)');
        c.fillStyle = pg; c.fillRect(px - pw, 0, pw * 2, ly);
      }
    }
  }
};

/* [2] sanctum-light */
var SANCTUM_DEF = {
  id: 'sanctum-light', align: 'good',
  pal: ['#ffe9ad', '#c8b06a', '#fff8e0', '#20304a', '#ffd47a', '#3a4a68', '#ffffff', '#2a3a58'],
  draw: function (c, w, h, t) {
    vgrad(c, h, [[0, '#2c3d5e'], [0.5, '#48587e'], [1, '#202c46']]);
    /* god rays pivoting gently from a high source */
    var rx = w * 0.5, ry = -h * 0.12;
    for (var i = 0; i < 7; i++) {
      var a0 = -Math.PI / 2 + (i - 3) * 0.16 + Math.sin(t * 0.25 + i) * 0.03;
      var spread = 0.035;
      c.fillStyle = 'rgba(255,236,170,' + (0.05 + 0.03 * Math.sin(t * 0.6 + i * 1.3)).toFixed(3) + ')';
      c.beginPath(); c.moveTo(rx, ry);
      c.lineTo(rx + Math.cos(a0 - spread) * h * 1.6, ry + Math.sin(a0 - spread) * h * 1.6);
      c.lineTo(rx + Math.cos(a0 + spread) * h * 1.6, ry + Math.sin(a0 + spread) * h * 1.6);
      c.closePath(); c.fill();
    }
    /* cloud banks drifting slowly */
    for (i = 0; i < 5; i++) {
      var cy = h * (0.3 + i * 0.14), cx = ((i * 173 + t * (7 + i * 3)) % (w + 320)) - 160;
      c.fillStyle = 'rgba(235,238,250,' + (0.10 + 0.04 * (i % 2)).toFixed(2) + ')';
      c.beginPath(); c.ellipse(cx, cy, 150 + i * 22, 20 + i * 4, 0, 0, TAU); c.fill();
    }
    /* angels: orbiting rings with halos (cosmetic circles) */
    for (i = 0; i < 3; i++) {
      var ang = t * (0.22 + i * 0.05) + i * 2.1;
      var ax = w * 0.5 + Math.cos(ang) * w * (0.3 + i * 0.07);
      var ay = h * (0.24 + i * 0.09) + Math.sin(t * 0.9 + i) * 8;
      c.strokeStyle = 'rgba(255,232,170,.8)'; c.lineWidth = 2;
      c.beginPath(); c.ellipse(ax, ay, 20 - i * 3, 8 - i, 0, 0, TAU); c.stroke();
      c.fillStyle = 'rgba(255,244,210,.5)';
      c.beginPath(); c.arc(ax, ay + 12 - i * 2, 7 - i, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(255,222,140,.35)';
      c.beginPath(); c.arc(ax, ay + 12 - i * 2, 12 - i, 0, TAU); c.stroke();
    }
    /* hallowed floor mist */
    var fg = c.createLinearGradient(0, h * 0.78, 0, h);
    fg.addColorStop(0, 'rgba(255,240,200,0)');
    fg.addColorStop(1, 'rgba(255,240,200,.14)');
    c.fillStyle = fg; c.fillRect(0, h * 0.78, w, h * 0.22);
  }
};

/* [3] void-black */
var VOID_DEF = {
  id: 'void-black', align: 'chaotic',
  pal: ['#9b6cff', '#2a1450', '#c9b2ff', '#020204', '#6a3bd8', '#150a2e', '#e8ddff', '#0a0514'],
  draw: function (c, w, h, t) {
    c.fillStyle = '#020204'; c.fillRect(0, 0, w, h);
    var cx = w * 0.5, cy = h * 0.52;
    /* stars spiral inward and are consumed, then reborn at the rim */
    for (var i = 0; i < 60; i++) {
      var ph = ((i * 61.8) % 100) / 100;
      var rad = (0.15 + 0.85 * ph) * Math.max(w, h) * 0.55 * (1 - ((t * 0.02 + ph) % 1) * 0.86);
      var a = ph * TAU + t * (0.05 + 0.12 * ph) + i;
      c.fillStyle = 'rgba(200,180,255,' + (0.15 + 0.5 * (1 - rad / (Math.max(w, h) * 0.55))).toFixed(2) + ')';
      c.fillRect(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad * 0.62, 2, 2);
    }
    /* accretion disc */
    c.save(); c.translate(cx, cy); c.rotate(-0.42);
    for (i = 0; i < 3; i++) {
      c.strokeStyle = 'rgba(' + (155 - i * 30) + ',' + (108 - i * 24) + ',255,' + (0.16 - i * 0.04).toFixed(2) + ')';
      c.lineWidth = 10 - i * 2;
      c.beginPath(); c.ellipse(0, 0, 120 + i * 26 + Math.sin(t + i) * 4, 34 + i * 8, 0, 0, TAU); c.stroke();
    }
    /* the hole itself */
    c.fillStyle = '#000';
    c.beginPath(); c.arc(0, 0, 46, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(201,178,255,.5)'; c.lineWidth = 1.5; c.stroke();
    c.restore();
    /* faint violet horizon fog at the feet of the screen */
    var fg = c.createLinearGradient(0, h * 0.8, 0, h);
    fg.addColorStop(0, 'rgba(60,20,120,0)');
    fg.addColorStop(1, 'rgba(60,20,120,.25)');
    c.fillStyle = fg; c.fillRect(0, h * 0.8, w, h * 0.2);
  }
};

/* [4] hazard-pit */
var PIT_DEF = {
  id: 'hazard-pit', align: 'bad',
  pal: ['#c9a227', '#5a4a10', '#8f7a1e', '#141007', '#e0c25a', '#2e2610', '#ffdf7a', '#1c1808'],
  draw: function (c, w, h, t) {
    vgrad(c, h, [[0, '#1a1608'], [0.55, '#2e2610'], [1, '#0c0a04']]);
    /* hazard chevron band along the top rim */
    c.save(); c.beginPath(); c.rect(0, 0, w, 16); c.clip();
    for (var x = -32; x < w + 32; x += 32) {
      c.fillStyle = (x / 32 | 0) % 2 ? '#c9a227' : '#141007';
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 16, 0); c.lineTo(x + 32, 16); c.lineTo(x + 16, 16);
      c.closePath(); c.fill();
    }
    c.restore();
    /* stake walls: sharpened posts leaning inward, left and right */
    c.fillStyle = '#171104';
    for (var i = 0; i < 8; i++) {
      var yy = h * (0.2 + i * 0.1);
      c.beginPath();
      c.moveTo(0, yy); c.lineTo(w * 0.1, yy - 6); c.lineTo(w * 0.09, yy + 14); c.lineTo(0, yy + 20);
      c.closePath(); c.fill();
      c.beginPath();
      c.moveTo(w, yy); c.lineTo(w * 0.9, yy - 6); c.lineTo(w * 0.91, yy + 14); c.lineTo(w, yy + 20);
      c.closePath(); c.fill();
    }
    /* the pit mouth: jagged dark chasm across the floor */
    var py = h * 0.84;
    c.fillStyle = '#050403';
    c.beginPath(); c.moveTo(0, h); c.lineTo(0, py);
    for (var x = 0; x <= w; x += 26) c.lineTo(x, py + Math.sin(x * 0.7) * 6 + 4);
    c.lineTo(w, h); c.closePath(); c.fill();
    /* torches on the stakes: flickering dots (slow, no strobe) */
    for (i = 0; i < 4; i++) {
      var tx = i % 2 ? w * 0.9 : w * 0.1, ty = h * (0.24 + (i >> 1) * 0.4);
      var fl = 0.5 + 0.3 * Math.sin(t * 6 + i * 2.2);
      c.fillStyle = 'rgba(255,180,70,' + fl.toFixed(2) + ')';
      c.beginPath(); c.arc(tx, ty, 5 + 2 * fl, 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,120,20,' + (fl * 0.4).toFixed(2) + ')';
      c.beginPath(); c.arc(tx, ty + 6, 9, 0, TAU); c.fill();
    }
    /* bones scattered at the rim */
    c.strokeStyle = 'rgba(210,200,170,.35)'; c.lineWidth = 3;
    for (i = 0; i < 6; i++) {
      var bx = ((i * 149) % 90 + 5) / 100 * w, by = py - 8 - (i % 3) * 5;
      c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + 12 + (i % 3) * 5, by - 3); c.stroke();
    }
  }
};

/* Late-safe worlds registration (same poll pattern as worlds-pop.js). */
(function regWorlds(attempt) {
  var W = root.IQ && root.IQ.Worlds;
  if (W && typeof W.register === 'function') {
    [HELL_DEF, SANCTUM_DEF, VOID_DEF, PIT_DEF].forEach(function (d) { W.register(d); });
    return;
  }
  if (attempt < 40 && typeof setTimeout === 'function') {
    setTimeout(function () { regWorlds(attempt + 1); }, 50);
  }
})(0);

root.IQ.Realm = {
  id: 'pack-realm',
  snapshot: function () {
    return { mode: S.mode, layer: S.layer, pit: S.pit, nails: S.nails, web: S.web };
  },
  worlds: ['hell-layer', 'sanctum-light', 'void-black', 'hazard-pit']
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { id: 'pack-realm', worlds: root.IQ.Realm.worlds, handlers: HANDLERS };
}
})();
