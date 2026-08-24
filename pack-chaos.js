/* ============================================================================
 * IQ BATTLE — pack-chaos.js — Funny/wild rounds pack (PackChaos)
 * Zero assets. Vanilla JS/CSS. Registers into window.IQ.* only.
 *
 * Dave's spec line -> mechanic map:
 *   [1] JESTER COURT  (world id 'jester-court', align 'chaotic')
 *       ONE seeded jest per round, picked from:
 *         a) PIANO MODE      - all UI sounds pitched up an octave
 *                              (modifiers: sfx:'zap' cue + flag:{piano:true}
 *                              carrying the octave-up intent; banner
 *                              'PLAY US A TUNE').
 *         b) MIRROR JEST     - invertControlsMs = full round; option hover/click
 *                              positions mirrored via injected CSS on #opts-grid
 *                              shipped inside overlayHTML wrapper class
 *                              iqb-jester-mirror (+ flag:{inverted:true}).
 *                              Double scaleX(-1) keeps glyph text readable while
 *                              positions swap.
 *         c) PIXIES          - a tiny sprite steals ONE option's key label
 *                              (cosmetic only; the key itself still works).
 *                              DOCUMENTED DEVIATION per the anti-leak rail:
 *                              pre-reveal ctx carries no answer-derived hint,
 *                              so the target is a SEEDED RANDOM key (ctx.rng
 *                              when present => host and clients pick the SAME
 *                              key).
 *         d) NOODLES         - a noodle drapes across the board periodically
 *                              (purely cosmetic SVG sweep, IQB_MOTION-gated);
 *                              exactly ONCE per round the noodle "bites" and a
 *                              400ms click-block is forced pre-answer via the
 *                              documented invertControlsMs modifier.
 *   [2] FRACTAL VOID  (world id 'fractal-void', align 'chaotic')
 *       Canvas fractal zoom backdrop (static frame when IQB_MOTION off) +
 *       onRoundStart ships an overlay <style> giving the board container a
 *       gentle <=1.6deg rotational sway (CSS animation, motion-gated).
 *   [3] GENIE DEN     (world id 'genie-den', align 'chaotic')
 *       onRoundStart the genie offers ONE wish via overlayHTML buttons:
 *         wisdom -> disables 2 WRONG options   | TWIST: disables the RIGHT one
 *         wealth -> +80 score                  | TWIST: costs 30 score
 *         time   -> +10s                       | TWIST: subtracts 5s
 *       Twist is a 25% seeded per-round roll, revealed HONESTLY in the banner
 *       only AFTER the choice. Effects are delivered exclusively through the
 *       documented modifiers (disableWrongRandom/disableRightRandom/
 *       scoreDelta/timerDelta — sanctioned fields, hooks.js header) flushed
 *       on the next onTick — scoring math untouched. The engine MAY silently
 *       decline disableRightRandom on good/neutral rounds to keep them
 *       solvable; refusal is treated as normal and never detected.
 *   [4] WISE CAESAR   (no world; any NEUTRAL round, low weight ~12%)
 *       Pre-round one-line advice banner that is TRUE exactly 75% of the time
 *       (seeded) about which attribute will matter ('BEWARE ROTATION').
 *       Truth set is derived only from facts this pack/engine actually
 *       controls (active jest, board dim level => rotation, alignment);
 *       the lie variant names an attribute that is NOT active this round.
 *
 * Contract notes (confirmed with HooksCore against landed hooks.js):
 *   - Handlers receive ctx {round,world,align,hp,score,streak,timerLen,
 *     optCount,rng,runId,seed}; every read is defensive with window.G
 *     fallbacks. ctx NEVER exposes answer-derived data pre-reveal.
 *   - Handlers return modifier objects merged by HooksCore; this pack uses
 *     bannerText, overlayHTML, invertControlsMs, timerDelta, scoreDelta,
 *     disableWrongRandom, disableRightRandom, sfx (string cue), flag.
 *   - overlayHTML replaces the overlay layer content; this pack clears its
 *     own overlay on onReveal/onInterlude and never leaves body classes behind
 *     => every effect is fully reversible next round.
 *   - If IQ.Hooks is not loaded yet, registration is queued onto
 *     window.IQ.__hooksPending for HooksCore to drain.
 *
 * Gates: all animation honors IQB_MOTION (static frames, no CSS animation),
 * sound-related modifiers honor IQB_MUTED upstream; flashes none (>3Hz n/a);
 * question/answer glyph text readability is sacred (mirror jest double-flips
 * glyphs back upright; pixies hide keycaps, never answer content).
 * Nothing here can end a run: only hp<=0 does, and hpDelta is never emitted.
 * ============================================================================*/
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  function bodyMark(cls, on) {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle(cls, !!on);
  }
  root.IQ = root.IQ || {};

  /* ---------- tiny deterministic helpers ---------- */

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  }
  function hashSeed(str) {
    var h = 2166136261 >>> 0;
    var s = String(str == null ? '' : str);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function motionOK() {
    try {
      var v = root.localStorage && root.localStorage.getItem('IQB_MOTION');
      return v == null ? true : JSON.parse(v) !== false;
    } catch (e) { return true; }
  }
  function muted() {
    try {
      var v = root.localStorage && root.localStorage.getItem('IQB_MUTED');
      return v != null && JSON.parse(v) === true;
    } catch (e) { return false; }
  }

  /* ---------- engine lookups (defensive; engine is inline in index.html) ---------- */

  function g() { return root.G || null; }
  function roundOf(ctx) {
    if (ctx && ctx.round != null) return ctx.round | 0;
    var G = g();
    return G && G.round ? G.round | 0 : 0;
  }
  function seedSource(ctx) {
    if (ctx && ctx.seed != null) return ctx.seed;
    var G = g();
    if (G) {
      if (G.seed != null) return G.seed;
      if (G.mpCfg && G.mpCfg.seed != null) return G.mpCfg.seed;
      if (G.roomCode != null) return G.roomCode;
    }
    try {
      var rc = root.localStorage && root.localStorage.getItem('iqb-room');
      if (rc) return rc;
    } catch (e) {}
    return 'pack-chaos';
  }
  /* Per-round deterministic rng — same seed+round => same jest everywhere. */
  function rngFor(ctx, salt) {
    var h = hashSeed(seedSource(ctx) + ':' + roundOf(ctx) + ':' + (salt || 'chaos'));
    return mulberry32(h);
  }
  function timerMs(ctx) {
    if (ctx && ctx.timerMs != null) return Math.max(0, ctx.timerMs | 0);
    if (ctx && ctx.timerLen != null) return Math.max(0, ctx.timerLen * 1000) | 0;
    var G = g();
    var len = G && G.timerLen ? G.timerLen : 60;
    return len * 1000;
  }
  function alignOf(ctx) {
    if (ctx && ctx.align) return String(ctx.align);
    try {
      if (root.IQ && IQ.Align && IQ.Align.at) {
        var e = IQ.Align.at(roundOf(ctx));
        if (e && e.align) return e.align;
      }
    } catch (e2) {}
    var G = g();
    return G && G.w1 && G.w1.align ? G.w1.align : 'neutral';
  }
  function themeOf(ctx) {
    if (ctx && ctx.theme) return String(ctx.theme);
    if (ctx && ctx.world) return String(ctx.world);
    var G = g();
    return G && G.w1 && G.w1.theme ? G.w1.theme : '';
  }
  function optCount() {
    var el = typeof document !== 'undefined' && document.getElementById('opts-grid');
    if (el && el.children.length) return el.children.length;
    var G = g();
    if (G && G.puzzle && G.puzzle.options) return G.puzzle.options.length;
    return 4;
  }

  /* ---------- injected CSS (one static sheet, self-contained classes) ---------- */

  var styleDone = false;
  function ensureStyle() {
    if (styleDone || typeof document === 'undefined') return;
    styleDone = true;
    var st = document.createElement('style');
    st.id = 'iqb-pack-chaos-style';
    st.textContent =
      /* [1b] mirror jest: flip grid positions, flip each tile back so glyph
         text stays upright/readable; hover/click positions are swapped. */
      '.iqb-jester-mirror #opts-grid{transform:scaleX(-1)}' +
      '.iqb-jester-mirror #opts-grid>*{transform:scaleX(-1)}' +
      /* [1c] pixie-stolen keycap (cosmetic only) */
      '#opts-grid .opt-btn.iqb-keyless .opt-key{visibility:hidden}' +
      '.iqb-pixie{position:absolute;z-index:74;width:14px;height:14px;border-radius:50%;' +
      'background:radial-gradient(circle at 35% 35%,#fff8c9,#ffd23e 55%,rgba(255,210,62,0));' +
      'box-shadow:0 0 6px #ffd23e;pointer-events:none;animation:iqbPixieFloat 1.6s ease-in-out infinite alternate}' +
      '@keyframes iqbPixieFloat{from{transform:translate(0,0)}to{transform:translate(3px,-5px)}}' +
      /* [2] fractal void board sway (<=1.6deg, slow, motion-gated at inject time) */
      '@keyframes iqbVoidSway{0%{transform:rotate(-1.6deg)}50%{transform:rotate(1.6deg)}100%{transform:rotate(-1.6deg)}}' +
      '.iqb-void-sway .board-zone{animation:iqbVoidSway 9s ease-in-out infinite;' +
      'transform-origin:50% 55%;will-change:transform}' +
      /* [1d] noodle sweep across the board */
      '@keyframes iqbNoodleDrape{0%{transform:translateX(-130%) rotate(-7deg)}' +
      '45%,60%{transform:translateX(0) rotate(-4deg)}' +
      '100%{transform:translateX(130%) rotate(-2deg)}}' +
      '.iqb-noodle{position:absolute;left:-10%;top:34%;width:120%;height:56px;z-index:66;' +
      'pointer-events:none;filter:drop-shadow(0 4px 6px rgba(0,0,0,.45))}' +
      '.iqb-noodle-move{animation:iqbNoodleDrape 8.5s ease-in-out infinite}' +
      /* [3] genie wish panel */
      '.iqb-genie-panel{position:absolute;left:50%;top:12px;transform:translateX(-50%);z-index:75;' +
      'display:flex;gap:8px;align-items:center;padding:10px 14px;border-radius:14px;' +
      'background:linear-gradient(160deg,rgba(38,10,64,.92),rgba(10,4,28,.92));' +
      'border:1px solid #b78bff;box-shadow:0 6px 22px rgba(80,20,160,.5);pointer-events:auto}' +
      '.iqb-genie-panel .iqb-genie-label{font-size:11px;font-weight:900;letter-spacing:.18em;color:#e6d4ff;margin-right:4px}' +
      '.iqb-genie-panel button{cursor:pointer;font-weight:900;font-size:12px;letter-spacing:.06em;' +
      'padding:7px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.35);color:#fff;' +
      'background:rgba(255,255,255,.08)}' +
      '.iqb-genie-panel button:hover{background:rgba(255,255,255,.2)}' +
      '.iqb-genie-panel button:disabled{opacity:.35;cursor:default}' +
      '.iqb-genie-verdict{position:absolute;left:50%;top:64px;transform:translateX(-50%);z-index:75;' +
      'font-size:12px;font-weight:900;letter-spacing:.12em;padding:6px 14px;border-radius:999px;' +
      'color:#ffe9a8;background:rgba(30,8,52,.9);border:1px solid #b78bff;pointer-events:none}';
    document.head.appendChild(st);
  }

  /* ---------- pack state (fully rebuilt every round => reversible) ---------- */

  var S = freshState();
  function freshState() {
    return {
      round: 0,
      world: '',            /* active theme id */
      jest: null,           /* 'piano' | 'mirror' | 'pixies' | 'noodles' | null */
      pixieTargetPos: -1,   /* display position (1-based) whose keycap is stolen */
      noodleBiteAt: 0,      /* elapsed-ms threshold for the one 400ms bite */
      noodleBit: false,
      caesarLine: '',       /* pre-round advice banner (may be a lie) */
      genie: null,          /* {twist:boolean, chosen:false, kind:'', verdict:''} */
      pendingMods: null,    /* flushed on next onTick (late genie effects) */
      overlayShown: false,  /* did THIS round ship overlay content? */
      obs: null             /* MutationObserver watching #opts-grid */
    };
  }

  /* ---------- overlay lifecycle ---------- */

  function clearBodyMarks() {
    if (typeof document === 'undefined') return;
    document.body.classList.remove('iqb-jester-mirror', 'iqb-void-sway');
  }
  function teardownRoundDom() {
    clearBodyMarks();
    if (S.obs) { try { S.obs.disconnect(); } catch (e) {} S.obs = null; }
    var px = typeof document !== 'undefined' && document.querySelector('.iqb-pixie');
    while (px) { px.parentNode.removeChild(px); px = document.querySelector('.iqb-pixie'); }
  }

  /* ---------- [1c] pixies ---------- */

  function watchOptsForPixies() {
    if (typeof document === 'undefined') return;
    var grid = document.getElementById('opts-grid');
    if (!grid) return;
    var apply = function () {
      var kids = grid.children;
      if (!kids.length || S.jest !== 'pixies') return;
      for (var i = 0; i < kids.length; i++) {
        var wantSteal = (i + 1) === S.pixieTargetPos;
        kids[i].classList.toggle('iqb-keyless', wantSteal);
        var existing = kids[i].querySelector('.iqb-pixie');
        if (wantSteal && !existing && motionOK()) {
          var sp = document.createElement('span');
          sp.className = 'iqb-pixie';
          /* perch where the keycap used to sit */
          sp.style.right = '6px'; sp.style.top = '6px';
          kids[i].appendChild(sp);
        } else if (!wantSteal && existing) {
          existing.parentNode.removeChild(existing);
        }
      }
    };
    apply();
    if (typeof MutationObserver !== 'undefined') {
      S.obs = new MutationObserver(apply);
      S.obs.observe(grid, { childList: true });
    }
  }

  /* ---------- [3] genie ---------- */

  function geniePanelHTML() {
    return '<div class="iqb-genie-panel" id="iqb-genie-panel">' +
      '<span class="iqb-genie-label">ONE WISH</span>' +
      '<button data-wish="wisdom" title="Disable two wrong options">WISDOM</button>' +
      '<button data-wish="wealth" title="+80 score">WEALTH</button>' +
      '<button data-wish="time" title="+10 seconds">TIME</button>' +
      '</div>';
  }

  function wireGeniePanel(doc) {
    var panel = doc.getElementById('iqb-genie-panel');
    if (!panel) return;
    var btns = panel.querySelectorAll('button[data-wish]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].onclick = makeWishHandler(btns[i].getAttribute('data-wish'));
    }
  }

  function makeWishHandler(kind) {
    return function () { API.chooseWish(kind); };
  }

  /* Applies the wish through DOCUMENTED modifiers only; queued for the next
   * onTick so HooksCore merges them like any handler return value. */
  function resolveWish(kind) {
    var G = g();
    var twist = !!(S.genie && S.genie.twist);
    var mods = {};
    var verdict;

    if (kind === 'wisdom') {
      if (!twist) {
        /* engine picks 2 random WRONG options without leaking the answer
         * (sanctioned field; see hooks.js header) */
        mods.disableWrongRandom = 2;
        verdict = 'THE GENIE GRANTS WISDOM';
      } else {
        /* engine-side disable of a CORRECT option; the engine MAY silently
         * decline on good/neutral rounds to keep them solvable — refusal is
         * normal and MUST NOT be detected (documented caveat, honored here). */
        mods.disableRightRandom = 1;
        verdict = 'TWISTED! THE GENIE SEALS THE TRUE PATH';
      }
    } else if (kind === 'wealth') {
      /* sanctioned flat score modifier — scoring math stays host-side */
      mods.scoreDelta = twist ? -30 : 80;
      verdict = twist ? 'TWISTED! THE LAMP TAKES 30 BACK' : 'THE GENIE POURS OUT GOLD';
    } else if (kind === 'time') {
      mods.timerDelta = twist ? -5 : 10;
      verdict = twist ? 'TWISTED! SAND DRAINS FROM YOUR HOURGLASS' : 'THE GENIE STILLS THE SAND';
    } else {
      return;
    }

    if (muted()) { /* silent */ }
    S.genie.chosen = true;
    S.genie.kind = kind;
    S.genie.verdict = verdict;
    S.pendingMods = mods; /* flushed by onTick */

    /* immediate honest visual feedback on the panel itself */
    if (typeof document !== 'undefined') {
      var panel = document.getElementById('iqb-genie-panel');
      if (panel) {
        var btns = panel.querySelectorAll('button');
        for (var j = 0; j < btns.length; j++) btns[j].disabled = true;
        var v = document.createElement('div');
        v.className = 'iqb-genie-verdict';
        v.textContent = verdict;
        panel.parentNode.appendChild(v);
      }
    }
    void G;
  }

  /* ---------- [4] wise caesar ---------- */

  /* Attributes this pack/engine can genuinely verify for the round. Each entry:
   * {key, true:'advice if active', false:'the lie names it anyway'} */
  function caesarTruthSet(jestKey, dim) {
    var set = [];
    if (jestKey === 'mirror') set.push({ key: 'mirror', say: 'MIRROR THE OPTIONS' });
    if (jestKey === 'piano') set.push({ key: 'pitch', say: 'LISTEN AN OCTAVE HIGHER' });
    if (jestKey === 'pixies') set.push({ key: 'pixies', say: 'A KEY WILL GO MISSING' });
    if (jestKey === 'noodles') set.push({ key: 'noodle', say: 'MIND THE NOODLE' });
    if (dim && dim !== '2d') set.push({ key: 'rotation', say: 'BEWARE ROTATION' });
    return set;
  }
  function caesarLie(set, r) {
    var all = [
      { key: 'rotation', lie: 'ROTATION COMES. IT DOES NOT.' },
      { key: 'mirror', lie: 'YOUR CLICKS WILL MIRROR. TRUST ME.' },
      { key: 'pitch', lie: 'ALL SOUNDS RING HIGH TODAY.' },
      { key: 'pixies', lie: 'PIXIES HAVE TAKEN A KEY.' },
      { key: 'noodle', lie: 'A NOODLE HUNGERS THIS ROUND.' }
    ];
    var actives = {};
    set.forEach(function (s) { actives[s.key] = true; });
    var lies = all.filter(function (l) { return !actives[l.key]; });
    if (!lies.length) return null;
    return lies[Math.floor(r() * lies.length)].lie;
  }
  function rollCaesar(ctx) {
    if (alignOf(ctx) !== 'neutral') return '';
    var r = rngFor(ctx, 'caesar');
    if (r() >= 0.12) return ''; /* low weight */
    var dim = '2d';
    try {
      var e = root.IQ && IQ.Align && IQ.Align.at && IQ.Align.at(roundOf(ctx));
      if (e && e.dim) dim = e.dim;
    } catch (err) {}
    var set = caesarTruthSet(S.jest, dim);
    var truthful = r() < 0.75; /* TRUE exactly 75% of the time, seeded */
    if (truthful) {
      if (!set.length) return 'CAESAR SAYS: THE SWIFT MIND FEASTS'; /* always true */
      return 'CAESAR SAYS: ' + set[Math.floor(r() * set.length)].say;
    }
    var lie = caesarLie(set, r);
    return lie ? 'CAESAR SAYS: ' + lie : '';
  }

  /* ---------- [1a-d] jest selection ---------- */

  var JESTS = ['piano', 'mirror', 'pixies', 'noodles'];
  function rollJest(ctx) {
    var r = rngFor(ctx, 'jester');
    var jest = JESTS[Math.floor(r() * JESTS.length)];
    var st = { jest: jest };

    if (jest === 'pixies') {
      /* DOCUMENTED DEVIATION (anti-leak rail): pre-reveal ctx carries no
       * answer-derived hint, so the pixie perches on a SEEDED RANDOM key,
       * purely cosmetic (the key itself still works). Seeded from ctx.rng
       * when present so host and clients pick the SAME key. */
      var n = (ctx && ctx.optCount) || optCount() || 8;
      var pr = (ctx && typeof ctx.rng === 'function') ? ctx.rng : rngFor(ctx, 'pixie');
      st.pixieTargetPos = 1 + Math.floor(pr() * n);
    } else if (jest === 'noodles') {
      /* the single bite lands somewhere in the middle third of the round */
      st.noodleBiteAt = timerMs(ctx) * (0.3 + 0.4 * r());
      st.noodleBit = false;
    }
    return st;
  }

  function noodleSVG() {
    return '<svg class="iqb-noodle iqb-noodle-move" viewBox="0 0 1200 60" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="M0,40 C120,5 240,65 360,32 C480,0 600,62 720,30 C840,2 960,64 1080,30 C1140,14 1180,26 1200,22" ' +
      'fill="none" stroke="#ffcf5e" stroke-width="16" stroke-linecap="round"/>' +
      '<path d="M0,40 C120,5 240,65 360,32 C480,0 600,62 720,30 C840,2 960,64 1080,30 C1140,14 1180,26 1200,22" ' +
      'fill="none" stroke="#fff3c4" stroke-width="5" stroke-linecap="round" opacity=".7"/>' +
      '</svg>';
  }

  /* ---------- worlds ---------- */

  function registerWorlds() {
    if (!(root.IQ && IQ.Worlds && typeof IQ.Worlds.register === 'function')) return false;

    /* [1] JESTER COURT — motley harlequin diamonds, gently breathing hues */
    IQ.Worlds.register({
      id: 'jester-court',
      align: 'chaotic',
      pal: ['#1b0f2e', '#2d1b4e', '#ffd23e', '#ff5d8f', '#3ec6ff', '#7cffb2', '#ff9f43', '#f6f7f9'],
      draw: function (c, w, h, t) {
        var mo = motionOK();
        var tt = mo ? t : 0;
        c.save();
        c.fillStyle = '#150b24';
        c.fillRect(0, 0, w, h);
        var cell = Math.max(46, Math.min(w, h) / 12);
        var cols = Math.ceil(w / cell) + 2, rows = Math.ceil(h / cell) + 2;
        var drift = mo ? (tt * 6) % (cell * 2) : 0;
        var colsPal = ['#ffd23e', '#ff5d8f', '#3ec6ff', '#7cffb2', '#ff9f43'];
        for (var ry = -1; ry < rows; ry++) {
          for (var rx = -1; rx < cols; rx++) {
            var x = rx * cell - (ry % 2 ? cell / 2 : 0) - drift * 0.3;
            var y = ry * cell - drift * 0.15;
            var idx = (rx + ry) % colsPal.length;
            var pulse = mo ? 0.05 + 0.04 * Math.sin(tt * 1.4 + rx * 0.7 + ry * 0.9) : 0.06;
            c.globalAlpha = pulse;
            c.fillStyle = colsPal[(idx + colsPal.length) % colsPal.length];
            /* harlequin diamond */
            c.beginPath();
            c.moveTo(x + cell / 2, y);
            c.lineTo(x + cell, y + cell / 2);
            c.lineTo(x + cell / 2, y + cell);
            c.lineTo(x, y + cell / 2);
            c.closePath();
            c.fill();
          }
        }
        c.globalAlpha = 1;
        /* vignette so glyph text stays readable */
        var vg = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.72);
        vg.addColorStop(0, 'rgba(21,11,36,0)');
        vg.addColorStop(1, 'rgba(21,11,36,0.88)');
        c.fillStyle = vg;
        c.fillRect(0, 0, w, h);
        c.restore();
      }
    });

    /* [2] FRACTAL VOID — infinite-zoom self-similar square fractal */
    IQ.Worlds.register({
      id: 'fractal-void',
      align: 'chaotic',
      pal: ['#04030a', '#0d0a24', '#241a54', '#4b2f8f', '#8b5cf6', '#c4b5fd', '#67e8f9', '#f0abfc'],
      draw: function (c, w, h, t) {
        var mo = motionOK();
        var tt = mo ? t : 0;
        c.save();
        c.fillStyle = '#04030a';
        c.fillRect(0, 0, w, h);

        var cx = w / 2, cy = h / 2;
        var span = Math.max(w, h);
        /* two interleaved zoom phases crossfade for a seamless loop */
        for (var ph = 0; ph < 2; ph++) {
          var p = ((tt * 0.18 + ph * 0.5) % 1 + 1) % 1;      /* 0..1 zoom phase */
          var scale = Math.pow(2, p);                        /* doubles each loop */
          var fade = ph === 0 ? Math.min(1, p * 4) : Math.min(1, (1 - p) * 4);
          var rot = tt * 0.05 + ph * Math.PI / 8;
          c.globalAlpha = 0.85 * fade;
          drawBranch(c, cx, cy, span * 0.55 * scale, rot, 0);
        }
        c.globalAlpha = 1;

        function drawBranch(c2, x, y, size, angle, depth) {
          if (depth > 5 || size < 3) return;
          c2.save();
          c2.translate(x, y);
          c2.rotate(angle);
          var hueShade = ['#241a54', '#4b2f8f', '#8b5cf6', '#c4b5fd', '#67e8f9', '#f0abfc'][depth];
          c2.strokeStyle = hueShade;
          c2.lineWidth = Math.max(0.6, 2.2 - depth * 0.35);
          c2.strokeRect(-size / 2, -size / 2, size, size);
          var s3 = size / 2;
          drawBranch(c2, -s3 / 2, -s3 / 2, s3, 0.22, depth + 1);
          drawBranch(c2, s3 / 2, s3 / 2, s3, -0.22, depth + 1);
          c2.restore();
        }

        /* starfield dust (parallax-free, cheap) */
        var sr = mulberry32(0x00BADA55);
        c.fillStyle = '#c4b5fd';
        for (var i = 0; i < 60; i++) {
          var sx = sr() * w, sy = sr() * h, ss = sr();
          var tw = mo ? 0.25 + 0.5 * Math.abs(Math.sin(tt * 0.8 + ss * 6.28)) : 0.5;
          c.globalAlpha = tw * 0.5;
          c.fillRect(sx, sy, 1.5, 1.5);
        }
        c.globalAlpha = 1;
        /* vignette */
        var vg = c.createRadialGradient(cx, cy, span * 0.18, cx, cy, span * 0.75);
        vg.addColorStop(0, 'rgba(4,3,10,0)');
        vg.addColorStop(1, 'rgba(4,3,10,0.9)');
        c.fillStyle = vg;
        c.fillRect(0, 0, w, h);
        c.restore();
      }
    });

    /* [3] GENIE DEN — lamp glow, smoke curls, drifting embers */
    IQ.Worlds.register({
      id: 'genie-den',
      align: 'chaotic',
      pal: ['#1c0714', '#3a0f2a', '#6d1f4e', '#a83a6b', '#ff9e64', '#ffd166', '#b78bff', '#ffe9a8'],
      draw: function (c, w, h, t) {
        var mo = motionOK();
        var tt = mo ? t : 0;
        c.save();
        c.fillStyle = '#1c0714';
        c.fillRect(0, 0, w, h);

        /* lamp glow rising from bottom center */
        var glowY = h * 1.02;
        var breathe = mo ? 0.9 + 0.1 * Math.sin(tt * 1.1) : 1;
        var gr = c.createRadialGradient(w / 2, glowY, 10, w / 2, glowY, h * 0.95 * breathe);
        gr.addColorStop(0, 'rgba(255,209,102,0.55)');
        gr.addColorStop(0.35, 'rgba(168,58,107,0.32)');
        gr.addColorStop(1, 'rgba(28,7,20,0)');
        c.fillStyle = gr;
        c.fillRect(0, 0, w, h);

        /* smoke curls */
        c.strokeStyle = 'rgba(183,139,255,0.16)';
        c.lineWidth = 8;
        for (var s = 0; s < 3; s++) {
          c.beginPath();
          var bx = w * (0.3 + 0.2 * s);
          c.moveTo(bx, h);
          for (var yy = h; yy > h * 0.25; yy -= 14) {
            var prog = (h - yy) / h;
            var wob = mo ? Math.sin(tt * 0.9 + prog * 7 + s * 2.1) * 40 * prog : 0;
            c.lineTo(bx + wob + prog * 30 * (s - 1), yy);
          }
          c.stroke();
        }

        /* ember motes */
        var er = mulberry32(0x5EED01);
        c.fillStyle = '#ffd166';
        for (var i = 0; i < 26; i++) {
          var ex = er() * w;
          var spd = 0.02 + er() * 0.05;
          var ey = mo ? (h - ((tt * spd * h / 2 + er() * h) % h)) : er() * h * 0.6 + h * 0.4;
          c.globalAlpha = 0.25 + 0.35 * er();
          c.beginPath();
          c.arc(ex, ey, 1 + er() * 1.6, 0, 6.284);
          c.fill();
        }
        c.globalAlpha = 1;

        /* vignette */
        var vg = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.22, w / 2, h / 2, Math.max(w, h) * 0.75);
        vg.addColorStop(0, 'rgba(28,7,20,0)');
        vg.addColorStop(1, 'rgba(28,7,20,0.86)');
        c.fillStyle = vg;
        c.fillRect(0, 0, w, h);
        c.restore();
      }
    });

    return true;
  }

  /* ---------- hook registration ---------- */

  var HANDLERS = {

    /* ---- round start: roll everything deterministically, ship overlays ---- */
    onRoundStart: function (ctx) {
      ensureStyle();
      teardownRoundDom();
      S = freshState();
      S.round = roundOf(ctx);
      S.world = themeOf(ctx);

      var mods = {};
      var overlayParts = [];

      /* [1] JESTER COURT — exactly ONE jest per round */
      if (S.world === 'jester-court') {
        var rolled = rollJest(ctx);
        S.jest = rolled.jest;
        S.pixieTargetPos = rolled.pixieTargetPos != null ? rolled.pixieTargetPos : -1;
        S.noodleBiteAt = rolled.noodleBiteAt || 0;

        if (S.jest === 'piano') {
          /* [1a] octave-up UI sounds + tune banner */
          if (!muted()) {
            /* sfx is a STRING cue (hooks.js vocab); the octave-up intent
             * travels in flag.piano for engines that honor it */
            mods.sfx = 'zap';
            mods.flag = { piano: true };
          }
          mods.bannerText = 'PLAY US A TUNE';
        } else if (S.jest === 'mirror') {
          /* [1b] inverted controls the whole round + mirrored option grid.
           * Body class drives the CSS; flag tells the engine/host. */
          bodyMark('iqb-jester-mirror', true);
          mods.invertControlsMs = timerMs(ctx);
          if (!mods.flag) mods.flag = {};
          mods.flag.inverted = true;
          mods.bannerText = 'LEFT IS RIGHT, RIGHT IS WRONG';
        } else if (S.jest === 'pixies') {
          /* [1c] sprites steal one wrong keycap (applied when opts render) */
          mods.bannerText = 'PIXIES PINCHED A KEY';
          overlayParts.push('<style>/* pixie watch armed */</style>');
        } else if (S.jest === 'noodles') {
          /* [1d] cosmetic periodic noodle; the single 400ms bite fires onTick */
          overlayParts.push('<style>#board-frame{position:relative}</style>');
          overlayParts.push('<div style="position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:65">' +
            (motionOK() ? noodleSVG()
              : noodleSVG().replace('iqb-noodle-move', 'iqb-noodle-static')) +
            '</div>');
          mods.bannerText = 'NOODLE INBOUND';
        }
      }

      /* [2] FRACTAL VOID — gentle <=1.6deg board sway via overlay style tag */
      if (S.world === 'fractal-void' && motionOK()) {
        bodyMark('iqb-void-sway', true);
        overlayParts.push('<style>/* void sway active via body.iqb-void-sway */</style>');
      }

      /* [3] GENIE DEN — ONE wish choice, 25% seeded twist */
      if (S.world === 'genie-den') {
        var twist = rngFor(ctx, 'genie-twist')() < 0.25;
        S.genie = { twist: twist, chosen: false, kind: '', verdict: '' };
        overlayParts.push(geniePanelHTML());
        mods.bannerText = 'THE GENIE OFFERS ONE WISH';
      }

      /* [4] WISE CAESAR — optional pre-round advice on neutral rounds.
       * Composes with any jest/genie banner rather than being crowded out. */
      S.caesarLine = rollCaesar(ctx);
      if (S.caesarLine) {
        mods.bannerText = mods.bannerText
          ? mods.bannerText + ' | ' + S.caesarLine
          : S.caesarLine;
      }

      /* arm pixie watcher (options may render after this point) */
      if (S.jest === 'pixies') watchOptsForPixies();

      if (overlayParts.length) {
        S.overlayShown = true;
        mods.overlayHTML = overlayParts.join('');
        if (S.genie && typeof document !== 'undefined') {
          /* wire buttons once the overlay lands (next frame) */
          setTimeout(function () {
            if (document.getElementById('iqb-genie-panel')) wireGeniePanel(document);
          }, 0);
        }
      }
      return Object.keys(mods).length ? mods : null;
    },

    /* ---- per-tick: flush late genie modifiers + the single noodle bite ---- */
    onTick: function (ctx) {
      var out = null;

      /* genie effects chosen mid-round travel via documented modifiers */
      if (S.pendingMods) {
        out = S.pendingMods;
        S.pendingMods = null;
        if (S.genie) out.bannerText = S.genie.verdict; /* honest AFTER choice */
      }

      /* [1d] the one noodle bite: a single 400ms click-block pre-answer */
      if (S.jest === 'noodles' && !S.noodleBit) {
        var el = (ctx && ctx.elapsedMs != null) ? ctx.elapsedMs
          : (ctx && ctx.t != null) ? ctx.t * 1000
          : 0;
        if (el >= S.noodleBiteAt) {
          S.noodleBit = true;
          out = out || {};
          out.invertControlsMs = 400; /* documented input-block channel */
          if (!out.bannerText) out.bannerText = 'THE NOODLE BITES — HANDS OFF!';
        }
      }
      return out;
    },

    /* ---- answer: freeze the genie UI, nothing gameplay-touching ---- */
    onAnswer: function () {
      if (typeof document !== 'undefined') {
        var panel = document.getElementById('iqb-genie-panel');
        if (panel) {
          var btns = panel.querySelectorAll('button');
          for (var i = 0; i < btns.length; i++) btns[i].disabled = true;
        }
      }
      return null;
    },

    /* ---- reveal: strip every trace this pack added ---- */
    onReveal: function () {
      teardownRoundDom();
      if (S.overlayShown) { S.overlayShown = false; return { overlayHTML: '', flag: { packChaosClear: true } }; }
      return null;
    },

    /* ---- interlude: same hygiene between rounds ---- */
    onInterlude: function () {
      teardownRoundDom();
      if (S.overlayShown) { S.overlayShown = false; return { overlayHTML: '', flag: { packChaosClear: true } }; }
      return null;
    }
  };

  function registerHooks() {
    var payload = {
      id: 'pack-chaos',
      worlds: ['jester-court', 'fractal-void', 'genie-den'],
      handlers: HANDLERS
    };
    if (root.IQ.Hooks && typeof root.IQ.Hooks.add === 'function') {
      try { IQ.Hooks.add(payload); return true; } catch (e) { /* fall through */ }
    }
    /* HooksCore hasn't landed yet — queue for it to drain. */
    (root.IQ.__hooksPending = root.IQ.__hooksPending || []).push(payload);
    return false;
  }

  /* ---------- public surface ---------- */

  var API = {
    id: 'pack-chaos',
    worlds: ['jester-court', 'fractal-void', 'genie-den'],
    /* Genie overlay buttons call this. Effects flow ONLY through documented
     * modifiers on the next onTick; scoring math is never touched here. */
    chooseWish: function (kind) {
      if (!S.genie || S.genie.chosen) return null;
      resolveWish(String(kind || ''));
      return { kind: S.genie.kind, twist: S.genie.twist, verdict: S.genie.verdict };
    },
    /* introspection for tests/debug */
    _state: function () { return JSON.parse(JSON.stringify({
      round: S.round, world: S.world, jest: S.jest,
      pixieTargetPos: S.pixieTargetPos, genie: S.genie,
      caesarLine: S.caesarLine, noodleBit: S.noodleBit
    })); }
  };
  root.IQ.PackChaos = API;

  ensureStyle();
  registerWorlds();
  API.worldsRegistered = registerHooks();

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
