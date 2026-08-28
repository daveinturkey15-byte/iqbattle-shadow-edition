/* IQ Battle: Shadow — gfx-title.js
 * Boot + menu title motion upgrade. Presentation ONLY: no game logic,
 * no scoring. Self-initialising; observes body class changes (stage
 * machine act-0..act-3) and section visibility. Everything degrades
 * silently and is disabled under prefers-reduced-motion (and the app's
 * "Screen chaos" toggle for the stage-3 corruption effects).
 */
(function () {
  'use strict';
  var Gfx = {};
  if (typeof window === 'undefined') return;
  var IQ = window.IQ = window.IQ || {};
  IQ.GfxTitle = Gfx;

  var reduceMq = (typeof matchMedia === 'function') ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reduced() { return !!(reduceMq && reduceMq.matches); }
  function chaosOk() { /* app-level "Screen chaos" toggle (store JSON) */
    try { var v = localStorage.getItem('IQB_MOTION'); return v == null ? true : JSON.parse(v) !== false; }
    catch (e) { return true; }
  }

  var GLITCH_MAP = { 'I': '1', 'E': '3', 'O': '0', 'S': '5', 'U': 'V' };
  var STYLE_ID = 'iq-gfxtitle-style';
  var CSS = [
    /* ---- boot logo stagger drop-in (letters wrapped as .gxt-ch) ---- */
    '.gxt-ch{display:inline-block;white-space:pre;animation:gxt-drop .55s cubic-bezier(.2,.85,.3,1.25) backwards}',
    '@keyframes gxt-drop{0%{opacity:0;transform:translateY(-.9em)}60%{opacity:1}100%{opacity:1;transform:none}}',

    /* ---- slow chromatic shimmer sweep on visible menu/boot titles ---- */
    /* double class bumps specificity above luxe.css body.act-N .boot-logo rules */
    'body .gxt-title.gxt-title{position:relative}',
    'body .gxt-title.gxt-title.gxt-shimmer-on{' +
      'background-image:linear-gradient(115deg,rgba(255,255,255,0) 40%,rgba(255,255,255,.55) 50%,rgba(255,255,255,0) 60%),' +
      'linear-gradient(90deg,var(--acc-a,#3f7dff),var(--acc-b,#ff2e88));' +
      'background-size:260% 100%,100% 100%;animation:gxt-sweep 7s ease-in-out infinite}',
    '@keyframes gxt-sweep{0%{background-position:-95% 0,0 0}46%{background-position:195% 0,0 0}100%{background-position:195% 0,0 0}}',

    /* ---- stage 3: logo drips (original design) ---- */
    'body.gxt-stage3 .gxt-drip{position:relative}',
    'body.gxt-stage3 .gxt-drip::before,body.gxt-stage3 .gxt-drip::after{' +
      "content:'';position:absolute;top:calc(100% - 4px);width:4px;height:0;" +
      'border-radius:0 0 4px 4px;background:linear-gradient(180deg,#e01030,#00e68a);' +
      'opacity:0;pointer-events:none;animation:gxt-drip 5.5s ease-in infinite}',
    'body.gxt-stage3 .gxt-drip::before{left:16%;animation-delay:1.2s}',
    'body.gxt-stage3 .gxt-drip::after{left:63%;width:3px;animation-delay:3.7s;animation-duration:6.9s}',
    '@keyframes gxt-drip{0%{height:0;opacity:0;transform:none}12%{opacity:.85}' +
      '62%{height:22px;opacity:.85;transform:none}78%{height:26px;opacity:.85}' +
      '100%{height:26px;transform:translateY(54px);opacity:0}}',

    /* ---- single-letter glitch swap flash ---- */
    '.gxt-ch.gxt-swap{transform:translateY(-2px) skewX(-9deg);filter:brightness(1.7)}',

    /* ---- button hover sheen sweep ---- */
    '.btn{position:relative;overflow:hidden}',
    ".btn::after{content:'';position:absolute;top:-15%;bottom:-15%;left:-48%;width:36%;" +
      'background:linear-gradient(100deg,rgba(255,255,255,0),rgba(255,255,255,.28),rgba(255,255,255,0));' +
      'transform:skewX(-18deg);opacity:0;pointer-events:none}',
    '.btn:hover::after,.btn:focus-visible::after{opacity:1;left:132%;' +
      'transition:left .65s cubic-bezier(.4,0,.2,1),opacity .08s linear}',

    /* ---- accessibility: kill all of it under prefers-reduced-motion ---- */
    '@media (prefers-reduced-motion:reduce){' +
      '.gxt-ch{animation:none!important}' +
      'body .gxt-title.gxt-title.gxt-shimmer-on{animation:none!important;' +
        'background-image:linear-gradient(90deg,var(--acc-a,#3f7dff),var(--acc-b,#ff2e88))!important;' +
        'background-size:100% 100%!important}' +
      'body.gxt-stage3 .gxt-drip::before,body.gxt-stage3 .gxt-drip::after{animation:none!important;opacity:0!important}' +
      '.gxt-ch.gxt-swap{transform:none!important;filter:none!important}' +
      '.btn:hover::after,.btn:focus-visible::after{transition:none!important;left:-48%!important;opacity:0!important}}'
  ].join('\n');

  function injectCSS() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  var titles = [];
  var glitchBusy = false;

  function wrapLetters(el) {
    if (el.__gxtWrapped) return;
    el.__gxtWrapped = true;
    var text = el.textContent;
    el.setAttribute('aria-label', text);
    el.classList.add('gxt-title', 'gxt-drip');
    el.textContent = '';
    for (var i = 0; i < text.length; i++) {
      var sp = document.createElement('span');
      sp.className = 'gxt-ch';
      sp.setAttribute('aria-hidden', 'true');
      sp.textContent = text.charAt(i);
      sp.style.animationDelay = (i * 55) + 'ms';
      el.appendChild(sp);
    }
  }

  function visible(el) {
    var n = el;
    while (n && n !== document.body) {
      if (n.classList && n.classList.contains('hidden')) return false;
      n = n.parentNode;
    }
    return true;
  }

  function stage3() {
    return document.body.classList.contains('act-3') || document.body.classList.contains('corr-3');
  }

  function update() {
    var s3 = stage3();
    document.body.classList.toggle('gxt-stage3', s3);
    var anyVisible = false;
    titles.forEach(function (el) {
      var vis = visible(el);
      if (vis) anyVisible = true;
      el.classList.toggle('gxt-shimmer-on', vis && !reduced());
    });
    return anyVisible;
  }

  function glitchTick() {
    if (glitchBusy || reduced() || !chaosOk() || !stage3()) return;
    if (Math.random() > 0.45) return;
    var cands = titles.filter(function (el) { return el.__gxtWrapped && visible(el); });
    var el = cands[(Math.random() * cands.length) | 0];
    if (!el) return;
    var chs = el.querySelectorAll('.gxt-ch');
    var pool = [];
    chs.forEach(function (sp) { if (GLITCH_MAP[sp.textContent.toUpperCase()]) pool.push(sp); });
    if (!pool.length) return;
    var sp = pool[(Math.random() * pool.length) | 0];
    var orig = sp.textContent;
    glitchBusy = true;
    sp.textContent = GLITCH_MAP[orig.toUpperCase()];
    sp.classList.add('gxt-swap');
    setTimeout(function () {
      sp.textContent = orig;
      sp.classList.remove('gxt-swap');
      glitchBusy = false;
    }, 140 + Math.random() * 120);
  }

  function init() {
    if (Gfx._inited) return;
    Gfx._inited = true;
    if (typeof document === 'undefined' || !document.body) return;
    injectCSS();

    titles = [].slice.call(document.querySelectorAll('.boot-logo, .menu-title'));
    titles.forEach(wrapLetters);

    var mo = new MutationObserver(function () { update(); });
    /* body class (stage machine act-N/corr-N) + section visibility (.hidden toggles) */
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });

    setInterval(glitchTick, 4200);

    update();
  }

  Gfx.refresh = update;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
