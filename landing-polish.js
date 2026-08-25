/* ============================================================
   IQ VERSUS: SHADOW — landing-polish.js (W4 progressive enhancement)
   ------------------------------------------------------------
   PURPOSE : Pure-enhancement polish layer for the boot-screen landing
             rework. Every feature is individually guarded and degrades
             to a silent no-op when its element is absent, so this file
             can load on any page state (missing pieces => zero layout
             shift, zero errors).
   SHAPE   : Self-invoking IIFE, no registrations on IQ.Stage/Worlds/
             Hooks. Exposes a tiny test surface `window.IQBLandingPolish`
             ({version, cycle}) — safe to ignore in production.
   MECHANIC:
     1. Feature-card glyphs  — procedural inline SVG (dice/shield/link)
        prepended to each .feat-card b. No assets, no network.
     2. HOW TO PLAY modal    — imperative role="dialog"/aria-modal,
        focus trap (Tab cycles inside, Shift+Tab reverses), Esc closes,
        focus returns to #htp-link. Wraps Main's existing onclicks
        rather than replacing them.
     3. Room-name memory     — capture-phase click listener on #boot-host
        persists the trimmed #boot-room value to localStorage key
        'IQB_ROOMNAME_V1' (never blocks the click); restored on load
        only when the input is empty.
     4. Boot-card entrance   — one injected <style id="iqv-lp-style">,
        single fade-up <=400ms, gated behind
        @media (prefers-reduced-motion: no-preference).
     5. Hero H1 gradient     — reads accent colours from the computed
        style of .boot-logo (falls back to #2b74eb/#357df4) and applies
        the same background-clip:text treatment to .hero-h1.
   DETERMINISM: no Math.random, no Date.now, no timers, no network.
   FAIRNESS RAILS: gameplay untouched; overlays remain escapable (Esc
   added); focus never stolen from inputs; storage failures swallowed.
   PLACEMENT: <script> tag LAST in <body>, AFTER the modes/madmax.js tag.
   ============================================================ */
(function (root) {
  'use strict';
  if (root.__IQB_LANDING_POLISH__) return; // idempotent injection guard

  var ROOM_KEY = 'IQB_ROOMNAME_V1';
  var FALLBACK_A = '#2b74eb';
  var FALLBACK_B = '#357df4';
  var doc = root.document;
  if (!doc || !doc.body) return;

  function q(sel) { return doc.querySelector(sel); }
  function qa(sel, el) { return Array.prototype.slice.call((el || doc).querySelectorAll(sel)); }

  /* ---------- 1. feature-card glyphs (procedural SVG only) ---------- */
  var GLYPHS = {
    dice:
      '<svg class="iqv-lp-glyph" width="13" height="13" viewBox="0 0 24 24" fill="none"' +
      ' stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false">' +
      '<rect x="3" y="3" width="18" height="18" rx="3"/>' +
      '<circle cx="8.5" cy="8.5" r="1.7" fill="currentColor" stroke="none"/>' +
      '<circle cx="15.5" cy="8.5" r="1.7" fill="currentColor" stroke="none"/>' +
      '<circle cx="8.5" cy="15.5" r="1.7" fill="currentColor" stroke="none"/>' +
      '<circle cx="15.5" cy="15.5" r="1.7" fill="currentColor" stroke="none"/></svg>',
    shield:
      '<svg class="iqv-lp-glyph" width="13" height="13" viewBox="0 0 24 24" fill="none"' +
      ' stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false">' +
      '<path d="M12 3l7 3v5.2c0 4.8-3.4 7.9-7 9-3.6-1.1-7-4.2-7-9V6z"/></svg>',
    link:
      '<svg class="iqv-lp-glyph" width="13" height="13" viewBox="0 0 24 24" fill="none"' +
      ' stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false">' +
      '<path d="M10.5 13.5a4.6 4.6 0 0 0 6.5 0l2.2-2.2a4.6 4.6 0 0 0-6.5-6.5L11.6 5.9"/>' +
      '<path d="M13.5 10.5a4.6 4.6 0 0 0-6.5 0l-2.2 2.2a4.6 4.6 0 0 0 6.5 6.5l1.1-1.1"/></svg>'
  };
  // keyword -> glyph, with positional fallback (cards render in fixed order)
  var GLYPH_ORDER = ['dice', 'shield', 'link'];

  function pickGlyph(text, i) {
    var t = (text || '').toUpperCase();
    if (t.indexOf('GENERATION') >= 0) return GLYPHS.dice;
    if (t.indexOf('REGISTRATION') >= 0) return GLYPHS.shield;
    if (t.indexOf('FRIEND') >= 0) return GLYPHS.link;
    return GLYPHS[GLYPH_ORDER[i % GLYPH_ORDER.length]];
  }

  function initFeatIcons() {
    var bs = qa('.feat-card b');
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i];
      if (b.getAttribute('data-lp-glyph')) continue; // per-node idempotence
      b.setAttribute('data-lp-glyph', '1');
      b.innerHTML = pickGlyph(b.textContent, i) + b.innerHTML;
    }
  }

  /* ---------- 4. injected stylesheet (once, under #iqv-lp-style) ---------- */
  var LP_CSS =
    '.iqv-lp-glyph{vertical-align:-2px;margin-right:5px}' +
    '@media (prefers-reduced-motion:no-preference){' +
    '.boot-card{animation:iqv-lp-fadeup .38s cubic-bezier(.2,.7,.3,1) both}' +
    '}' +
    '@keyframes iqv-lp-fadeup{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}';

  function initStyle() {
    if (q('#iqv-lp-style')) return;
    var st = doc.createElement('style');
    st.setAttribute('id', 'iqv-lp-style');
    if ('textContent' in st) st.textContent = LP_CSS; else st.innerHTML = LP_CSS;
    (doc.head || doc.body).appendChild(st);
  }

  /* ---------- 5. hero H1 gradient from .boot-logo tokens ---------- */
  function logoAccents() {
    var a = FALLBACK_A, b = FALLBACK_B;
    try {
      var logo = q('.boot-logo');
      if (!logo || typeof root.getComputedStyle !== 'function') return [a, b];
      var cs = root.getComputedStyle(logo);
      var grad = /linear-gradient\([^)]*\)/.exec(cs.backgroundImage || '');
      var cols = grad ? grad[0].match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g) : null;
      if (cols && cols.length >= 2) return [cols[0], cols[cols.length - 1]];
      var va = (cs.getPropertyValue('--acc-a') || '').trim();
      var vb = (cs.getPropertyValue('--acc-b') || '').trim();
      if (va) a = va;
      if (vb) b = vb;
    } catch (_) { /* computed style unavailable -> fallback tokens */ }
    return [a, b];
  }

  function initHeroGradient() {
    var h1 = q('.hero-h1');
    if (!h1 || h1.getAttribute('data-lp-hero')) return;
    var ab = logoAccents();
    h1.setAttribute('data-lp-hero', ab.join('|'));
    h1.style.backgroundImage = 'linear-gradient(90deg,' + ab[0] + ',' + ab[1] + ')';
    h1.style.webkitBackgroundClip = 'text';
    h1.style.backgroundClip = 'text';
    h1.style.color = 'transparent';
  }

  /* ---------- 2. HOW TO PLAY modal: roles + focus trap ---------- */
  var FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  // pure cycle step (exported for smoke): next index given direction
  function cycle(len, idx, shift) {
    if (!len) return -1;
    if (idx < 0) return shift ? len - 1 : 0;
    return shift ? (idx <= 0 ? len - 1 : idx - 1) : (idx === len - 1 ? 0 : idx + 1);
  }

  function initHtpTrap() {
    var modal = q('#htp-modal');
    if (!modal || modal.getAttribute('data-lp-trap')) return;
    modal.setAttribute('data-lp-trap', '1');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    var h2 = modal.querySelector('h2');
    if (h2) {
      if (!h2.id) h2.id = 'htp-title';
      modal.setAttribute('aria-labelledby', h2.id);
    }

    var link = q('#htp-link');
    var closeBtn = q('#htp-close');

    function isOpen() { return !modal.classList.contains('hidden'); }
    function focusables() { return qa(FOCUSABLE, modal); }

    function focusFirst() {
      var f = focusables();
      if (f.length && f[0].focus) f[0].focus();
    }
    function restoreFocus() {
      if (link && link.focus) link.focus();
    }
    function closeModal() {
      if (closeBtn && closeBtn.click) { closeBtn.click(); }
      else { modal.classList.add('hidden'); }
      if (!isOpen()) restoreFocus();
    }

    // wrap Main's existing handlers instead of replacing them
    if (link && typeof link.onclick === 'function' && !link.getAttribute('data-lp-open')) {
      var prevOpen = link.onclick;
      link.setAttribute('data-lp-open', '1');
      link.onclick = function (e) {
        var opener = doc.activeElement;
        var wasOpen = isOpen();
        var r = prevOpen.apply(this, arguments);
        if (!wasOpen && isOpen()) {
          modal.setAttribute('data-lp-opener', '1');
          focusFirst();
        }
        return r;
      };
    }
    if (closeBtn && typeof closeBtn.onclick === 'function' && !closeBtn.getAttribute('data-lp-close')) {
      var prevClose = closeBtn.onclick;
      closeBtn.setAttribute('data-lp-close', '1');
      closeBtn.onclick = function (e) {
        var r = prevClose.apply(this, arguments);
        if (!isOpen()) restoreFocus();
        return r;
      };
    }

    doc.addEventListener('keydown', function (ev) {
      if (!isOpen()) return;
      var k = ev.key || '';
      if (k === 'Escape' || k === 'Esc') {
        if (ev.preventDefault) ev.preventDefault();
        closeModal();
        return;
      }
      if (k !== 'Tab') return;
      var f = focusables();
      if (ev.preventDefault) ev.preventDefault();
      if (!f.length) return;
      var cur = f.indexOf(doc.activeElement);
      var nxt = cycle(f.length, cur, !!ev.shiftKey);
      if (f[nxt] && f[nxt].focus) f[nxt].focus();
    });
  }

  /* ---------- 3. room-name persistence ---------- */
  function lsGet(k) { try { return root.localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { root.localStorage.setItem(k, v); } catch (_) { /* private mode */ } }

  function initRoomMemory() {
    var room = q('#boot-room');
    if (!room || room.getAttribute('data-lp-room')) return;
    room.setAttribute('data-lp-room', '1');
    var saved = lsGet(ROOM_KEY);
    if (saved && !room.value) room.value = saved;
    var host = q('#boot-host');
    if (host && !host.getAttribute('data-lp-host')) {
      host.setAttribute('data-lp-host', '1');
      // capture phase, never blocks Main's own HOST handler
      host.addEventListener('click', function () {
        var v = (room.value || '').replace(/^\s+|\s+$/g, '');
        if (v) lsSet(ROOM_KEY, v);
      }, true);
    }
  }

  /* ---------- entry ---------- */
  function init() {
    try { initStyle(); } catch (_) {}
    try { initFeatIcons(); } catch (_) {}
    try { initHeroGradient(); } catch (_) {}
    try { initHtpTrap(); } catch (_) {}
    try { initRoomMemory(); } catch (_) {}
  }
  init();

  root.__IQB_LANDING_POLISH__ = true;
  root.IQBLandingPolish = { version: '1.0.0', cycle: cycle };
})(typeof window !== 'undefined' ? window : globalThis);
