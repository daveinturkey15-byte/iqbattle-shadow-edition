/* IQ Versus: Shadow — onboard.js
 * First-run hint system. Loaded after fun.js. Shell calls
 * window.IQ.Onboard.start() when a game begins; on the very first game
 * (no localStorage flag 'IQB_ONBOARDED') it stacks three dismissible
 * hint toasts styled to the luxe theme, each auto-fading after 5s.
 * Never shows again after the flag is set. Everything degrades silently:
 * no throw paths, safe under file:// and https, respects
 * prefers-reduced-motion.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  var IQ = window.IQ = window.IQ || {};

  var FLAG = 'IQB_ONBOARDED';
  var FADE_MS = 5000;
  var STAGGER_MS = 700;

  var HINTS = [
    'Pick the tile that completes the pattern',
    'Keys 1-8 answer faster',
    'When it stops making sense\u2026 adapt.'
  ];

  /* ---------- CSS injection (luxe tokens with fallbacks) ---------- */
  var STYLE_ID = 'iq-onboard-style';
  var CSS = [
    '.iq-hint{position:fixed;left:50%;bottom:24px;z-index:80;display:flex;align-items:center;gap:10px;' +
      'max-width:min(92vw,420px);padding:10px 14px;border-radius:var(--radius,14px);' +
      'background:var(--panel,#0f1a30);border:1px solid rgba(63,125,255,.35);color:var(--ink,#eef2fb);' +
      'font-family:sans-serif;font-size:13px;line-height:1.4;box-shadow:var(--shadow,0 10px 30px rgba(0,20,60,.35));' +
      'transform:translateX(-50%);opacity:0;transition:opacity .45s ease,transform .45s ease;pointer-events:auto}',
    '.iq-hint.on{opacity:1;transform:translateX(-50%) translateY(-6px)}',
    '.iq-hint.off{opacity:0;transform:translateX(-50%) translateY(8px)}',
    '.iq-hint .iq-hint-dot{flex:none;width:7px;height:7px;border-radius:50%;' +
      'background:linear-gradient(135deg,var(--acc-a,#3f7dff),var(--acc-b,#ff2e88))}',
    '.iq-hint .iq-hint-x{flex:none;margin-left:4px;background:none;border:0;padding:2px 4px;' +
      'color:var(--muted,#8fa0c4);font-size:14px;font-weight:700;line-height:1;cursor:pointer}' +
      '.iq-hint .iq-hint-x:hover{color:var(--ink,#eef2fb)}'
  ].join('\n');

  function injectCSS() {
    try {
      if (typeof document === 'undefined') return;
      if (document.getElementById(STYLE_ID)) return;
      var st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = CSS;
      document.head.appendChild(st);
    } catch (e) { /* head unavailable */ }
  }

  function reducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  /* ---------- flag ---------- */
  function seen() {
    try { return !!window.localStorage.getItem(FLAG); } catch (e) { return false; }
  }
  function markSeen() {
    try { window.localStorage.setItem(FLAG, '1'); } catch (e) { /* private mode */ }
  }

  /* ---------- toast ---------- */
  function toast(text, i) {
    try {
      var el = document.createElement('div');
      el.className = 'iq-hint';
      el.style.bottom = (24 + i * 52) + 'px';
      el.setAttribute('role', 'status');

      var dot = document.createElement('span');
      dot.className = 'iq-hint-dot';

      var msg = document.createElement('span');
      msg.textContent = text; // textContent: no HTML injection

      var x = document.createElement('button');
      x.className = 'iq-hint-x';
      x.type = 'button';
      x.setAttribute('aria-label', 'Dismiss hint');
      x.textContent = '\u00d7';
      x.onclick = function () { kill(); };

      el.appendChild(dot);
      el.appendChild(msg);
      el.appendChild(x);
      document.body.appendChild(el);

      var gone = false;
      var timers = [];
      function kill() {
        if (gone) return;
        gone = true;
        for (var t = 0; t < timers.length; t++) clearTimeout(timers[t]);
        el.classList.remove('on');
        el.classList.add('off'); // fade class; transition handles motion
        setTimeout(function () {
          try { el.parentNode && el.parentNode.removeChild(el); } catch (e) {}
        }, reducedMotion() ? 50 : 500);
      }

      var delay = i * STAGGER_MS;
      if (delay > 0 && !reducedMotion()) {
        timers.push(setTimeout(function () { el.classList.add('on'); }, 30 + delay));
      } else {
        timers.push(setTimeout(function () { el.classList.add('on'); }, 30));
      }
      // auto-fade 5s after the toast becomes visible
      timers.push(setTimeout(kill, (delay > 0 && !reducedMotion() ? 30 + delay : 30) + FADE_MS));
    } catch (e) { /* DOM unavailable */ }
  }

  /* ---------- public API ---------- */
  var Onboard = {
    /** Call at game start. Shows hints once, ever. No-throw. */
    start: function () {
      try {
        if (seen()) return false;
        markSeen();
        injectCSS();
        for (var i = 0; i < HINTS.length; i++) toast(HINTS[i], i);
        return true;
      } catch (e) { return false; }
    },
    /** Test hook: forget onboarding so the next start() shows again. */
    reset: function () {
      try { window.localStorage.removeItem(FLAG); } catch (e) {}
    }
  };

  IQ.Onboard = Onboard;
})();
