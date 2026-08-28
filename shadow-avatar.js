/* IQ.ShadowAvatar — original SVG fan-art persona avatar for IQ BATTLE: SHADOW.
   Pure-geometry black quill-head silhouette with crimson-streak quills,
   glowing red eyes and a smirk. No copyrighted assets, no external files.
   Owns its injected CSS; honors prefers-reduced-motion (static poses). */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var IQ = root.IQ || (root.IQ = {});

  // Deterministic PRNG (mulberry32) so scheduled hauntings are reproducible.
  function mulberry32(seed) {
    seed = seed >>> 0;
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- injected stylesheet ----------
  var STYLE_ID = 'iq-shadow-avatar-style';
  function ensureStyle() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent =
      '.iqsa-wrap{position:fixed;z-index:9998;pointer-events:none;' +
      'width:140px;height:140px;display:flex;align-items:center;justify-content:center;' +
      'opacity:0;will-change:transform,opacity;}' +
      '@keyframes iqsa-in{from{opacity:0}to{opacity:1}}' +
      '@keyframes iqsa-out{from{opacity:1}to{opacity:0}}' +
      '@keyframes iqsa-glow{0%,100%{filter:brightness(1)}50%{filter:brightness(2.1)}}' +
      '@keyframes iqsa-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}' +
      '@keyframes iqsa-emerge{from{opacity:0;transform:scale(.82)}to{opacity:1;transform:scale(1)}}' +
      '.iqsa-in{animation:iqsa-in .6s ease forwards}' +
      '.iqsa-out{animation:iqsa-out .7s ease forwards}' +
      '.iqsa-pulse .iqsa-eyes{animation:iqsa-glow 1.4s ease-in-out infinite}' +
      '.iqsa-center .iqsa-svg{animation:iqsa-breathe 2.8s ease-in-out infinite}' +
      '.iqsa-emerge{animation:iqsa-emerge .9s cubic-bezier(.2,.9,.3,1) forwards}' +
      '@media (prefers-reduced-motion: reduce){' +
      '.iqsa-in,.iqsa-out,.iqsa-emerge{animation-duration:.01ms !important;animation-delay:0s !important}' +
      '.iqsa-pulse .iqsa-eyes,.iqsa-center .iqsa-svg{animation:none}}';
    document.head.appendChild(st);
  }

  // ---------- original SVG fan-art (pure geometry) ----------
  /* Angular black head mass swept left; three crimson streak-quills rake
     back off the crown; slanted glowing red eyes; thin asymmetric smirk.
     Drawn from primitive shapes only — not traced from any source. */
  var SVG_SEQ = 0;
  function avatarSVG(size) {
    size = size || 96;
    var uid = 'iqsa' + (++SVG_SEQ);
    return (
      '<svg class="iqsa-svg" xmlns="http://www.w3.org/2000/svg" width="' + size +
      '" height="' + size + '" viewBox="0 0 96 96" role="img" aria-label="Shadow avatar">' +
      '<defs>' +
      '<radialGradient id="' + uid + 'g" cx="50%" cy="50%" r="55%">' +
      '<stop offset="0%" stop-color="#ff2038" stop-opacity=".95"/>' +
      '<stop offset="60%" stop-color="#c01028" stop-opacity=".35"/>' +
      '<stop offset="100%" stop-color="#c01028" stop-opacity="0"/>' +
      '</radialGradient>' +
      '</defs>' +
      // three back-raking crimson streak quills
      '<path d="M40 30 L6 14 L34 38 Z" fill="#a00c22"/>' +
      '<path d="M46 24 L20 -4 L52 28 Z" fill="#e01830"/>' +
      '<path d="M52 22 L48 -10 L62 26 Z" fill="#c01028"/>' +
      // quill-head silhouette: angular dark mass
      '<path d="M26 44 C22 62 32 78 47 80 C63 82 74 71 76 57 C77 45 70 35 59 32 ' +
      'C58 24 51 18 43 21 C37 23 33 29 34 35 C30 37 27 40 26 44 Z" fill="#0a0a0f" stroke="#1c1c2a" stroke-width="2"/>' +
      // muzzle facet
      '<path d="M48 68 L64 65 L58 78 Z" fill="#141420"/>' +
      // smirk: thin asymmetric stroke
      '<path d="M46 66 C52 70 60 69 64 63" fill="none" stroke="#3a0d16" stroke-width="2.4" stroke-linecap="round"/>' +
      // glowing red eyes (class hook for pulse)
      '<g class="iqsa-eyes">' +
      '<ellipse cx="39" cy="48" rx="8" ry="4.6" transform="rotate(-20 39 48)" fill="url(#' + uid + 'g)"/>' +
      '<ellipse cx="61" cy="45" rx="8" ry="4.6" transform="rotate(14 61 45)" fill="url(#' + uid + 'g)"/>' +
      '<ellipse cx="39" cy="48" rx="3.6" ry="2" transform="rotate(-20 39 48)" fill="#ff3040"/>' +
      '<ellipse cx="61" cy="45" rx="3.6" ry="2" transform="rotate(14 61 45)" fill="#ff3040"/>' +
      '</g>' +
      '</svg>'
    );
  }

  // ---------- DOM helpers ----------
  function makeWrap(cls, style) {
    ensureStyle();
    var el = document.createElement('div');
    el.className = cls;
    el.style.cssText = style;
    el.innerHTML = avatarSVG(140);
    document.body.appendChild(el);
    return el;
  }
  // Edge anchor -> fixed-position cssText (slide-in distance is always 140px).
  var EDGES = {
    left:        'left:-140px;top:38%;',
    right:       'right:-140px;top:38%;',
    'top-left':  'left:-140px;top:12%;',
    'top-right': 'right:-140px;top:12%;',
    'bottom-left':  'left:-140px;bottom:12%;',
    'bottom-right': 'right:-140px;bottom:12%;'
  };

  // appear(edge): slide in 140px from the named edge/corner, idle ~3s, exit.
  // Mirrored horizontally on right-side edges so the face looks inward.
  function appear(edge, opts) {
    opts = opts || {};
    if (typeof document === 'undefined') return null;
    var pos = EDGES[edge] || EDGES.right;
    var wrap = makeWrap('iqsa-wrap', pos);
    var svgEl = wrap.firstChild;
    if (/right/.test(pos)) svgEl.style.transform = 'scaleX(-1)';
    // slide-in: settle onto screen over .6s, then hold idle 3s, then exit.
    var slideFrom = /left/.test(pos) ? 'translateX(-140px)' : 'translateX(140px)';
    wrap.style.transform = slideFrom;
    wrap.classList.add('iqsa-in');
    wrap.classList.add('iqsa-pulse');           // eye-glow pulse while visible
    requestAnimationFrame(function () {
      wrap.style.transition = 'transform .6s cubic-bezier(.2,.9,.3,1)';
      wrap.style.transform = 'translateX(0)';
    });
    var IDLE_MS = opts.idleMs || 3000, EXIT_MS = 700;
    var done = false;
    function leave() {
      if (done) return; done = true;
      wrap.classList.remove('iqsa-in');
      wrap.classList.add('iqsa-out');
      wrap.style.transform = slideFrom;
      setTimeout(function () {
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      }, EXIT_MS);
    }
    setTimeout(leave, IDLE_MS + 600);
    return { el: wrap, leave: leave };
  }

  // emerald(): full centered presence — large avatar emerging mid-screen
  // with breathing motion and pulsing eyes, holds, then dissolves.
  function emerald(opts) {
    opts = opts || {};
    if (typeof document === 'undefined') return null;
    ensureStyle();
    var size = opts.size || 260;
    var wrap = document.createElement('div');
    wrap.className = 'iqsa-wrap iqsa-center';
    wrap.style.cssText =
      'left:50%;top:50%;margin:' + (-size / 2) + 'px 0 0 ' + (-size / 2) + 'px;' +
      'width:' + size + 'px;height:' + size + 'px;';
    wrap.innerHTML = avatarSVG(size);
    document.body.appendChild(wrap);
    var halo = document.createElement('div');
    halo.style.cssText =
      'position:absolute;inset:-18%;border-radius:50%;z-index:-1;' +
      'background:radial-gradient(circle,rgba(255,32,56,.28) 0%,rgba(160,12,34,.10) 45%,transparent 70%);';
    wrap.insertBefore(halo, wrap.firstChild);
    wrap.classList.add('iqsa-emerge', 'iqsa-pulse');
    var HOLD = opts.holdMs || 3200, FADE = 800;
    var gone = false;
    function dissolve() {
      if (gone) return; gone = true;
      wrap.style.transition = 'opacity ' + FADE + 'ms ease, transform ' + FADE + 'ms ease';
      wrap.style.opacity = '0';
      wrap.style.transform = 'scale(1.08)';
      setTimeout(function () {
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      }, FADE);
    }
    setTimeout(dissolve, HOLD);
    return { el: wrap, dissolve: dissolve };
  }

  // Corruption stage from round number (matches TIMELINE pacing):
  // stage 1 = rounds 1-2, stage 2 = 3-5, stage 3 = 6+.
  function stageFor(round) {
    if (!isFinite(round)) return 0;
    if (round >= 6) return 3;
    if (round >= 3) return 2;
    return 1;
  }

  // watch(round): once stage >= 2, the avatar haunts random corners every
  // 20-30s (stage 3 tightens to 12-20s). Each visit pulses the eye glow.
  // Returns { stop() }; safe to call repeatedly per round.
  function watch(round) {
    var stage = stageFor(round);
    if (stage < 2 || typeof document === 'undefined') return { stop: function () {} };
    var rng = mulberry32((round | 0) * 104729 + 17);
    var stopped = false, timer = null;

    function schedule() {
      if (stopped) return;
      var lo = stage >= 3 ? 12000 : 20000;
      var hi = stage >= 3 ? 20000 : 30000;
      timer = setTimeout(visit, lo + rng() * (hi - lo));
    }
    var CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    function visit() {
      if (stopped) return;
      appear(CORNERS[Math.floor(rng() * CORNERS.length)]);
      schedule();
    }
    schedule();
    return {
      stop: function () {
        stopped = true;
        if (timer) clearTimeout(timer);
      }
    };
  }

  var ShadowAvatar = {
    avatarSVG: avatarSVG,
    appear: appear,
    emerald: emerald,
    watch: watch,
    stageFor: stageFor
  };

  IQ.ShadowAvatar = ShadowAvatar;

  // Node guard export.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { IQ: IQ, ShadowAvatar: ShadowAvatar };
  }
})();
