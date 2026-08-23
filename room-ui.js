/* ============================================================================
 * IQ.RoomUI — live lobby presence UI for IQ BATTLE.
 *
 * Loaded AFTER net.js. Self-contained: touches nothing but window.IQ + DOM.
 * Injects its own <style>; renders inside the lobby .panel below the
 * "Players here:" row:
 *   - room code, HUGE monospaced, one-click copy (clipboard API w/ fallback)
 *   - live player chips: name + crown for host + "(you)" marker
 *   - status line: waiting vs ready
 * Live updates come from IQ.Net.on('lobby') when present, with a
 * MutationObserver on #lobby-count as fallback (count-only degrade).
 * Every public call is no-throw: a failure here must never break solo play.
 * ==========================================================================*/
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};

  var mounted = false;
  var unsubLobby = null;      // IQ.Net.on('lobby') unsubscribe
  var observer = null;        // MutationObserver on #lobby-count
  var lastPlayers = null;     // latest players array from lobby frames
  var els = null;             // cached DOM refs

  /* ---- tiny helpers (all guarded) ---------------------------------------- */

  function $(sel) {
    try { return document.querySelector(sel); } catch (e) { return null; }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function myName() {
    try {
      var raw = root.localStorage && root.localStorage.getItem('IQB_PROFILE_V1');
      if (!raw) return '';
      var p = JSON.parse(raw);
      return p && typeof p.name === 'string' ? p.name : '';
    } catch (e) { return ''; }
  }

  /* Extract the room code from "#lobby-title" text like
   * "Room ABC12 — share this code!" / "Room ABC12". Returns '' for solo. */
  function roomCode() {
    var el = $('#lobby-title');
    var txt = el ? String(el.textContent || '') : '';
    var m = txt.match(/room\s+([A-Za-z0-9]{3,12})/i);
    return m ? m[1].toUpperCase() : '';
  }

  /* ---- styling ------------------------------------------------------------ */

  var CSS = [
    '.ru-block{margin:14px 0 4px;padding:14px;border-radius:14px;',
    'background:#0f1a30;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);color:#fff;',
    'font-family:inherit;text-align:center}',
    '.ru-code-row{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:6px}',
    '.ru-code{font-family:"Cascadia Code",Consolas,"Courier New",monospace;font-size:34px;font-weight:900;',
    'letter-spacing:.22em;line-height:1;background:linear-gradient(135deg,#3f7dff,#ff2e88);',
    '-webkit-background-clip:text;background-clip:text;color:transparent;user-select:all}',
    '.ru-copy{border:0;cursor:pointer;color:#fff;background:linear-gradient(135deg,#3f7dff,#ff2e88);',
    'padding:6px 12px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.08em;',
    'text-transform:uppercase;opacity:.9;transition:transform .12s,opacity .12s}',
    '.ru-copy:hover{opacity:1;transform:translateY(-1px)}',
    '.ru-chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:10px 0 8px}',
    '.ru-chip{display:inline-flex;align-items:center;gap:5px;padding:5px 13px;border-radius:999px;',
    'background:#101d38;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);',
    'font-size:12px;font-weight:600;color:#fff;white-space:nowrap}',
    '.ru-chip.me{background:linear-gradient(135deg,rgba(63,125,255,.28),rgba(255,46,136,.28));',
    'box-shadow:inset 0 0 0 1px rgba(255,255,255,.3)}',
    '.ru-crown{filter:drop-shadow(0 0 4px rgba(255,200,60,.7))}',
    '.ru-you{font-size:10px;opacity:.65;font-weight:400;text-transform:uppercase;letter-spacing:.06em}',
    '.ru-status{font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin-top:4px}',
    '.ru-status.wait{color:#8fa0c4}',
    '.ru-status.ready{color:#22d3a5}',
    '.ru-solo{font-size:13px;font-style:italic;color:#8fa0c4;padding:2px 0}'
  ].join('');

  function injectStyle() {
    if ($('style[data-ru]')) return;
    try {
      var st = document.createElement('style');
      st.setAttribute('data-ru', '1');
      st.textContent = CSS;
      document.head.appendChild(st);
    } catch (e) {}
  }

  /* ---- rendering ----------------------------------------------------------- */

  function copyCode(code, btn) {
    var done = function () {
      try {
        btn.textContent = 'COPIED ✓';
        setTimeout(function () { btn.textContent = 'COPY'; }, 1200);
      } catch (e) {}
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(done, function () { legacy(); });
        return;
      }
    } catch (e) {}
    legacy();

    function legacy() {
      try {
        var ta = document.createElement('textarea');
        ta.value = code;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
      } catch (e) {
        try { btn.textContent = 'FAILED'; setTimeout(function () { btn.textContent = 'COPY'; }, 1200); } catch (_e) {}
      }
    }
  }

  function chipHTML(p, idx) {
    var name = p && p.name ? String(p.name).slice(0, 16) : ('PLAYER ' + (idx + 1));
    var isHost = !!(p && p.isHost);
    var isMe = !!lastMyName && name.toLowerCase() === lastMyName.toLowerCase();
    return '<span class="ru-chip' + (isMe ? ' me' : '') + '">' +
      (isHost ? '<span class="ru-crown">👑</span>' : '') +
      esc(name) +
      (isMe ? '<span class="ru-you">(you)</span>' : '') +
      '</span>';
  }

  var lastMyName = '';

  function render() {
    if (!els || !els.root) return;
    var code = roomCode();
    var count = 0;
    try { count = parseInt($('#lobby-count').textContent, 10) || 0; } catch (e) {}

    if (!code) {
      // Solo / private room: no code to share.
      els.root.innerHTML =
        '<div class="ru-solo">Solo gauntlet — house demons await</div>' +
        '<div class="ru-status wait">' + count + ' in the room</div>';
      return;
    }

    var players = Array.isArray(lastPlayers) ? lastPlayers :
      (Array.isArray(root.__lastLobbyPlayers) ? root.__lastLobbyPlayers : null);
    var n = players ? players.length : count;
    lastMyName = myName();

    var chips;
    if (players && players.length) {
      chips = '<div class="ru-chips">' + players.map(chipHTML).join('') + '</div>';
    } else {
      // Count-only degrade: net.js gave us no roster yet.
      chips = '<div class="ru-status wait">' + n + ' player' + (n === 1 ? '' : 's') + ' connected…</div>';
    }

    var status = n >= 2
      ? '<div class="ru-status ready">Ready — host can START</div>'
      : '<div class="ru-status wait">Waiting for players… share the code</div>';

    els.root.innerHTML =
      '<div class="ru-code-row">' +
        '<span class="ru-code">' + esc(code) + '</span>' +
        '<button type="button" class="ru-copy">COPY</button>' +
      '</div>' +
      chips + status;

    var btn = els.root.querySelector('.ru-copy');
    if (btn) btn.addEventListener('click', function () { copyCode(code, btn); });
  }

  /* ---- live updates --------------------------------------------------------- */

  function hookNet() {
    try {
      if (!(root.IQ && IQ.Net && typeof IQ.Net.on === 'function')) return;
      lastPlayers = (typeof root.__lastLobbyPlayers !== 'undefined' && root.__lastLobbyPlayers) || lastPlayers;
      var off = IQ.Net.on('lobby', function (pl) {
        try {
          var arr = pl && Array.isArray(pl.players) ? pl.players : [];
          lastPlayers = arr;
          try { root.__lastLobbyPlayers = arr; } catch (e) {} // expose for other consumers
          render();
        } catch (e) {}
      });
      if (typeof off === 'function') unsubLobby = off;
    } catch (e) {}
  }

  function hookCountObserver() {
    try {
      var el = $('#lobby-count');
      if (!el || typeof MutationObserver === 'undefined') return;
      observer = new MutationObserver(function () {
        try { render(); } catch (e) {}
      });
      observer.observe(el, { childList: true, characterData: true, subtree: true });
    } catch (e) {}
  }

  /* ---- public API ------------------------------------------------------------ */

  IQ.RoomUI = {
    /** Inject the presence block into the lobby panel. Idempotent + no-throw. */
    mount: function () {
      try {
        if (mounted) { render(); return true; }
        injectStyle();
        var panel = $('.panel');                    // lobby panel (first .panel on page)
        var anchor = $('#lobby-count');             // "Players here:" row
        if (!panel || !anchor) return false;

        var root_ = document.createElement('div');
        root_.className = 'ru-block';
        // insert below the Players row (its direct parent inside the panel)
        (anchor.parentElement || panel).insertBefore(root_, anchor.nextSibling);

        els = { root: root_ };
        mounted = true;
        hookNet();
        hookCountObserver();
        render();
        return true;
      } catch (e) { return false; }
    },

    /** Re-read state and repaint (safe to call any time). */
    refresh: function () {
      try { render(); } catch (e) {}
    },

    /** Tear down observers/listeners (for tests or full leave). */
    unmount: function () {
      try { if (unsubLobby) unsubLobby(); } catch (e) {}
      try { if (observer) observer.disconnect(); } catch (e) {}
      try { if (els && els.root && els.root.parentElement) els.root.parentElement.removeChild(els.root); } catch (e) {}
      unsubLobby = observer = els = null;
      mounted = false;
    }
  };

  // Auto-mount once DOM is ready — the lobby may not exist until navigated to,
  // but the nodes are static in index.html, so DOMContentLoaded suffices.
  function boot() {
    try { IQ.RoomUI.mount(); } catch (e) {}
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }
})();
