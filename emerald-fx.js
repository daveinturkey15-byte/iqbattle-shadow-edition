/* IQ.EmeraldFX — chaos-emerald visual layer for IQ VERSUS: SHADOW.
   One original SVG fan-art emerald (faceted green gem, inner glow), reused for:
     (a) floating emerald orbiting the screen edge at stage >= 2 (tiny rAF),
     (b) interlude relic-card icons upgraded from emoji to the gem,
     (c) emerald pickup burst (particle ring, pure CSS animation),
     (d) stage 3: emerald afterimages trailing IQ.ShadowAvatar appearances.
   Owns its injected CSS; honors prefers-reduced-motion (static / no particles).
   Self-initialising, never throws. */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var IQ = root.IQ || (root.IQ = {});
  if (IQ.EmeraldFX) return;

  // ---------- injected stylesheet ----------
  var STYLE_ID = 'iq-emerald-fx-style';
  function ensureStyle() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      '.iqef-orb{position:fixed;left:0;top:0;z-index:80;pointer-events:none;',
        'will-change:transform;filter:drop-shadow(0 0 10px rgba(0,230,138,.55))}',
      '.iqef-orb .iqef-gem{display:block;animation:iqef-spin 16s linear infinite}',
      '.iqef-orb.iqef-static{left:auto;top:20px;right:20px;transform:none;opacity:.55}',
      '.iqef-icon{filter:drop-shadow(0 0 14px rgba(0,230,138,.5));line-height:1}',
      '.iqef-icon svg{display:block;margin:0 auto}',
      '.iqef-burst{position:fixed;left:0;top:0;z-index:120;pointer-events:none;width:0;height:0}',
      '.iqef-shard{position:absolute;left:-4px;top:-4px;width:8px;height:8px;',
        'background:linear-gradient(135deg,#baffdd,#00e68a);',
        'clip-path:polygon(50% 0,100% 38%,81% 100%,19% 100%,0 38%);',
        'box-shadow:0 0 8px rgba(0,230,138,.8);',
        'animation:iqef-fly var(--dur,.7s) cubic-bezier(.2,.8,.4,1) forwards}',
      '@keyframes iqef-fly{',
        'from{transform:translate(0,0) scale(.6) rotate(0deg);opacity:1}',
        'to{transform:translate(var(--dx),var(--dy)) scale(1.05) rotate(var(--rot,180deg));opacity:0}}',
      '.iqef-flash{position:absolute;left:-26px;top:-26px;width:52px;height:52px;border-radius:50%;',
        'background:radial-gradient(circle,rgba(186,255,221,.9),rgba(0,230,138,.25) 55%,transparent 72%)}',
      '.iqef-after{position:fixed;z-index:79;pointer-events:none;',
        'filter:drop-shadow(0 0 8px rgba(0,230,138,.45));',
        'animation:iqef-fade .95s ease-out forwards;animation-delay:var(--dly,0ms)}',
      '.iqef-after svg{transform:scale(.55)}',
      '@keyframes iqef-fade{',
        '0%{opacity:.75;transform:var(--tf,translateX(0)) scale(.92)}',
        '70%{opacity:.28}',
        '100%{opacity:0;transform:var(--tf,translateX(0)) scale(1.06)}}',
      '@keyframes iqef-spin{to{transform:rotate(360deg)}}',
      /* reduced motion: no spin, no particles, no trails; orbit parks statically */
      '@media (prefers-reduced-motion: reduce){',
        '.iqef-orb .iqef-gem,.iqef-shard,.iqef-after{animation:none!important;display:none!important}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ---------- original SVG fan-art (pure geometry) ----------
  /* Faceted hexagonal green gem: dark crown table, six kite facets around a
     bright pavilion core, radial inner glow, two spark ticks. Drawn from
     primitive shapes only — not traced from any source. Gradient ids are
     uniquified so several gems can coexist in one DOM. */
  var SVG_SEQ = 0;
  function emeraldSVG(size) {
    size = size || 40;
    var u = 'iqefg' + (++SVG_SEQ);
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 64 64" aria-hidden="true">' +
      '<defs>' +
        '<radialGradient id="' + u + '-glow" cx="50%" cy="58%" r="55%">' +
          '<stop offset="0%" stop-color="#c8ffe6"/>' +
          '<stop offset="45%" stop-color="#00e68a" stop-opacity=".55"/>' +
          '<stop offset="100%" stop-color="#00e68a" stop-opacity="0"/>' +
        '</radialGradient>' +
        '<linearGradient id="' + u + '-f1" x1="0" y1="0" x2="1" y2="1">' +
          '<stop offset="0%" stop-color="#7dffbe"/><stop offset="100%" stop-color="#00a35c"/>' +
        '</linearGradient>' +
        '<linearGradient id="' + u + '-f2" x1="1" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#4cd694"/><stop offset="100%" stop-color="#027a44"/>' +
        '</linearGradient>' +
      '</defs>' +
      '<circle cx="32" cy="34" r="30" fill="url(#' + u + '-glow)"/>' +
      /* outer hex outline */
      '<polygon points="32,4 57,19 57,47 32,62 7,47 7,19" fill="#03301c" stroke="#0f5c36" stroke-width="2"/>' +
      /* six kite facets alternating light/dark greens */
      '<polygon points="32,10 53,21.5 32,33" fill="url(#' + u + '-f1)" opacity=".9"/>' +
      '<polygon points="53,21.5 53,44.5 32,33" fill="url(#' + u + '-f2)" opacity=".85"/>' +
      '<polygon points="53,44.5 32,56 32,33" fill="url(#' + u + '-f1)" opacity=".7"/>' +
      '<polygon points="32,56 11,44.5 32,33" fill="url(#' + u + '-f2)" opacity=".75"/>' +
      '<polygon points="11,44.5 11,21.5 32,33" fill="url(#' + u + '-f1)" opacity=".8"/>' +
      '<polygon points="11,21.5 32,10 32,33" fill="url(#' + u + '-f2)" opacity=".9"/>' +
      /* crown table */
      '<polygon points="32,13 48,22 32,31 16,22" fill="#bfffdf" opacity=".85"/>' +
      /* inner core glow */
      '<ellipse cx="32" cy="37" rx="9" ry="11" fill="#d6ffee" opacity=".8"/>' +
      '<ellipse cx="32" cy="39" rx="5" ry="6.5" fill="#ffffff" opacity=".9"/>' +
      /* spark ticks */
      '<path d="M50 10l3 3M53 10l-3 3" stroke="#eafff4" stroke-width="1.6" stroke-linecap="round"/>' +
    '</svg>';
  }

  // ---------- helpers ----------
  function rm() {
    return typeof root.matchMedia === 'function' &&
      root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function makeEl(cls, cssText) {
    var el = document.createElement('div');
    el.className = cls;
    if (cssText) el.style.cssText += cssText;
    return el;
  }
  function stage3() {
    var b = document.body;
    return !!(b && (b.classList.contains('act-3') || b.classList.contains('corr-3')));
  }
  function activeStage() {
    var b = document.body;
    if (!b) return false;
    return b.classList.contains('act-2') || b.classList.contains('corr-2') || stage3();
  }

  // ---------- (a) floating emerald orbiting the screen edge ----------
  var orb = { el: null, raf: 0, t: Math.random() * 1000, last: 0 };
  function startOrbit() {
    if (typeof document === 'undefined' || orb.el) return;
    ensureStyle();
    var el = makeEl('iqef-orb');
    el.innerHTML = '<span class="iqef-gem">' + emeraldSVG(30) + '</span>';
    document.body.appendChild(el);
    orb.el = el;
    if (rm()) { el.classList.add('iqef-static'); return; } // parked, no motion
    orb.last = 0;
    var step = function (ts) {
      if (!orb.el) return;
      if (!orb.last) orb.last = ts;
      var dt = Math.min((ts - orb.last) / 1000, 0.05);
      orb.last = ts;
      orb.t += dt * 42;                                  // ~42px of perimeter per second
      var w = root.innerWidth, h = root.innerHeight;
      var inset = 46, sides = [w - inset * 2, h - inset * 2];
      var per = 2 * (sides[0] + sides[1]);
      var s = ((orb.t % per) + per) % per, x, y;
      if (s < sides[0])                      { x = inset + s;            y = inset; }
      else if (s < sides[0] + sides[1])      { x = w - inset;            y = inset + (s - sides[0]); }
      else if (s < 2 * sides[0] + sides[1])  { x = w - inset - (s - sides[0] - sides[1]); y = h - inset; }
      else                                   { x = inset;                y = h - inset - (s - 2 * sides[0] - sides[1]); }
      var time = ts / 1000;
      var bob = Math.sin(time * 2.1) * 3;
      var tilt = Math.sin(time * 1.3) * 8;
      var op = 0.6 + 0.16 * Math.sin(time * 1.7);
      el.style.transform = 'translate(' + x + 'px,' + (y + bob) + 'px) rotate(' + tilt + 'deg)';
      el.style.opacity = op.toFixed(3);
      orb.raf = root.requestAnimationFrame(step);
    };
    orb.raf = root.requestAnimationFrame(step);
  }
  function stopOrbit() {
    if (orb.raf) { root.cancelAnimationFrame(orb.raf); orb.raf = 0; }
    if (orb.el && orb.el.parentNode) orb.el.parentNode.removeChild(orb.el);
    orb.el = null;
  }

  // ---------- (c) emerald pickup burst ----------
  function burst(x, y) {
    if (typeof document === 'undefined') return;
    ensureStyle();
    var c = makeEl('iqef-burst');
    c.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    if (!rm()) {
      for (var i = 0; i < 12; i++) {
        var ang = (i / 12) * Math.PI * 2 + Math.random() * 0.4;
        var rad = 34 + Math.random() * 22;
        var sh = makeEl('iqef-shard');
        sh.style.setProperty('--dx', (Math.cos(ang) * rad).toFixed(1) + 'px');
        sh.style.setProperty('--dy', (Math.sin(ang) * rad).toFixed(1) + 'px');
        sh.style.setProperty('--rot', (90 + Math.random() * 240).toFixed(0) + 'deg');
        sh.style.setProperty('--dur', (550 + Math.random() * 260).toFixed(0) + 'ms');
        c.appendChild(sh);
      }
    }
    c.appendChild(makeEl('iqef-flash'));
    document.body.appendChild(c);
    setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); }, 950);
  }

  // ---------- (b) interlude relic-card icon upgrade + pickup burst ----------
  function upgradeInterlude(bg) {
    var cards = bg.querySelectorAll('.relic-card');
    for (var i = 0; i < cards.length; i++) {
      (function (card) {
        var icon = card.querySelector('.relic-icon');
        if (icon && !icon.classList.contains('iqef-icon')) {
          icon.classList.add('iqef-icon');
          icon.innerHTML = emeraldSVG(42);
        }
        if (!card.__iqefBurst) {
          card.__iqefBurst = true;
          card.addEventListener('click', function () {
            var r = card.getBoundingClientRect();
            burst(r.left + r.width / 2, r.top + r.height / 2);
          });
        }
      })(cards[i]);
    }
  }

  function watchBody() {
    if (typeof MutationObserver === 'undefined' || !document.body) return;
    new MutationObserver(function () {   // stage classes drive the orbit
      if (activeStage()) startOrbit(); else stopOrbit();
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

    new MutationObserver(function (muts) { // interlude overlay appears
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType === 1 && n.classList && n.classList.contains('interlude-bg')) {
            upgradeInterlude(n);
          }
        }
      }
    }).observe(document.body, { childList: true });
  }

  // ---------- (d) stage-3 emerald afterimages trailing Shadow appearances ----------
  function trailAppear(edge, res) {
    if (!res || !res.el || rm() || !stage3()) return;
    var av = res.el;
    var side = av.style.left !== '' ? 'left' : 'right';
    var vert = av.style.top !== '' ? 'top:' + av.style.top + ';' : 'bottom:' + av.style.bottom + ';';
    var dir = side === 'left' ? -1 : 1;
    for (var i = 0; i < 4; i++) {
      var off = dir * (128 - i * 36);                    // along the 140px slide-in path
      var g = makeEl('iqef-after', side + ':-140px;' + vert);
      g.style.setProperty('--tf', 'translateX(' + off + 'px)');
      g.style.setProperty('--dly', (i * 80) + 'ms');
      g.innerHTML = emeraldSVG(24);
      document.body.appendChild(g);
      (function (node, delay) {
        setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); },
          1100 + delay);
      })(g, i * 80);
    }
  }
  function hookShadowAvatar() {
    var SA = IQ.ShadowAvatar;
    if (!SA || SA.__iqefHooked || typeof SA.appear !== 'function') return false;
    SA.__iqefHooked = true;
    var orig = SA.appear;
    SA.appear = function (edge, opts) {
      var res = orig.apply(this, arguments);
      try { trailAppear(edge, res); } catch (e) { /* cosmetic only */ }
      return res;
    };
    return true;
  }
  function hookWhenReady(tries) {       // shadow-avatar.js may load after this file
    if (hookShadowAvatar() || tries <= 0) return;
    setTimeout(function () { hookWhenReady(tries - 1); }, 400);
  }

  // ---------- init ----------
  function init() {
    if (typeof document === 'undefined') return;
    ensureStyle();
    watchBody();
    if (activeStage()) startOrbit();
    hookWhenReady(25);
    // public API
    IQ.EmeraldFX = {
      emeraldSVG: emeraldSVG,
      burst: burst,
      orbit: { start: startOrbit, stop: stopOrbit }
    };
  }
  init();

  // Node guard export.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { IQ: IQ, EmeraldFX: IQ.EmeraldFX };
  }
})();
