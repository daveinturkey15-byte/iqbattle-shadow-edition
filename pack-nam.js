/* ============================================================================
 * pack-nam.js — Remake-army B4 pack: VIETNAM-ERA JUNGLE RECON ("NAM")
 * ============================================================================
 * Registers via window.IQ.Hooks.add(pack) per hooks.js contract, and registers
 * its own backdrop world 'nam-jungle' via window.IQ.Worlds.register().
 *
 * SPEC -> MECHANIC MAP
 *   1. FOG OF WAR ......... pack id 'jungle-recon' (single pack record)
 *       Persistent veil over the puzzle board (#board-frame). Pointer
 *       proximity reveals a soft circle around the cursor: motion ON = CSS
 *       mask-image radial-gradient following the pointer; motion OFF
 *       (IQB_MOTION falsy) = static reveal grid, cells snap clear instantly,
 *       no transitions. Coverage is tracked as a 10x7 cell grid; the fraction
 *       of EVER-revealed cells is mirrored to Hooks.state 'pack-nam:cov'.
 *       Answering with <30% ever-revealed triggers, from onPreAnswer,
 *       { scoreMul: 0.85 } — a request only; scoring stays host-owned.
 *   2. NAPALM STRIKE ...... same pack id 'jungle-recon'
 *       Telegraphed at round start ('INCOMING — WATCH THE SKY'). Seeded at
 *       60-75% of timerLen (ctx.rng, drawn in a FIXED unconditional order);
 *       zone = ONE options-grid column (positions col and col+4 of the 4x2
 *       grid). 1.2s marked-target warning, then a 2s burn: gutter-only strip
 *       over that column, single 140ms impact flash, flicker pulses <=3Hz and
 *       <=150ms bright phase, all suppressed when IQB_MOTION is off. The two
 *       column options are asserted disabled via disableOptionIdx every tick
 *       of the burn and cleared with disableOptionIdx:[] after (hunter-beam
 *       convention). NEVER the same column two rounds running: last column is
 *       persisted in Hooks.state 'pack-nam:lastCol' and re-rolled +1 mod 4.
 *   3. RADIO CHATTER ...... flavor banners seeded every ~12s (12s cadence +
 *       rng jitter, precomputed unconditionally at roundStart). War-movie
 *       tone, no gore.
 *   4. AMMO SYNERGY ....... doom-pickup ammo tokens (Hooks.state key
 *       'packhunters:ammo', owner pack-hunters) can be spent HERE: 2 tokens =
 *       8s full fog lift. Spend button rendered in the HUD footer when >=2
 *       tokens are held.
 *
 * ENGINE REALITIES THIS FILE ADAPTS TO (verified against index.html/hooks.js)
 *   E1. The engine's onTick ctx carries NO world/align, so a worlds-bound pack
 *       would never tick. This pack binds always:true (weight 0.6) and
 *       SELF-FILTERS every handler: active iff ctx.world === 'nam-jungle' or
 *       Hooks.state 'pack-nam:world' says the round started in our world.
 *   E2. overlayHTML is truncated to 2000 chars and auto-expires (~3.2s), so
 *       the persistent veil + interactive spend CANNOT ride that channel.
 *       Transient cosmetics (telegraph, marker, burn strip) DO use
 *       overlayHTML; the persistent HUD layer (veil cells + footer) is a
 *       pack-owned fixed-position root, same precedent as pack-horror's
 *       pack-owned listeners. The spend button sets pointer-events:auto on
 *       itself only; it never overlaps option buttons and captures nothing
 *       (no Escape handling, no focus trap).
 *   E3. ctx.timerLen is documented but the current dispatcher omits it;
 *       default 60s is used (house convention: (ctx.timerLen || 60)).
 *   E4. The engine never clears G.disabledOpts mid-round; emitting
 *       disableOptionIdx:[] after the burn matches the hunter-beam "clear"
 *       convention and lights the way for an engine that honors it.
 *
 * DETERMINISM: every gameplay decision derives from ctx.rng drawn in a fixed
 * unconditional order at roundStart (strike fraction, strike column, chatter
 * jitters). Clocks (performance.now deltas) drive presentation timing only.
 * Coverage math is a pure function of the pointer sample sequence over the
 * fixed 10x7 grid (exposed as IQ.Nam.markCells for parity tests).
 *
 * FAIRNESS: IQB_MOTION gates all animation/flashes; flash caps honored
 * (<=200ms, <=3Hz, gutter-only — never fullscreen); veil covers the puzzle
 * board canvas only, never question text or option tiles; HUD footer is
 * escapable, non-trapping, pointer-events scoped to the button; no pre-reveal
 * answer leakage (we never read correctIdx; strike columns are position-based
 * public layout, not answers); scoring requests (scoreMul) only.
 * ============================================================================*/
(function () {
  'use strict';

  var WID = 'nam-jungle';
  var PID = 'pack-nam';
  var K = {
    world: PID + ':world',
    cov: PID + ':cov',
    lastCol: PID + ':lastCol'
  };
  var AMMO_KEY = 'packhunters:ammo'; /* owned by pack-hunters 'doom-pickups' */

  var COLS = 10, ROWS = 7;          /* fog grid over the board */
  var REVEAL_R = 110;               /* px reveal radius around cursor */
  var BURN_S = 2.0;                 /* napalm burn duration */
  var MARK_LEAD = 1.2;              /* marked-target warning lead */
  var LIFT_COST = 2, LIFT_S = 8;    /* ammo synergy */

  var root = typeof window !== 'undefined' ? window : globalThis;
  var IQ = (root.IQ = root.IQ || {});

  /* ---- guarded Hooks fallback (house stub-queue pattern) ------------------ */
  if (!IQ.Hooks || typeof IQ.Hooks.add !== 'function') {
    console.warn('[pack-nam] IQ.Hooks absent — installing stub queue.');
    IQ.Hooks = IQ.Hooks || {};
    IQ.Hooks.add = function (pack) { (IQ.Hooks._q = IQ.Hooks._q || []).push(pack); };
  }
  if (!IQ.Hooks.state || typeof IQ.Hooks.state.get !== 'function') {
    var mem = Object.create(null);
    IQ.Hooks.state = {
      get: function (k) { return mem[k]; },
      set: function (k, v) { mem[k] = v; return v; },
      has: function (k) { return k in mem; },
      del: function (k) { delete mem[k]; }
    };
  }

  /* ---- world backdrop: nam-jungle (dusk canopy, mist, distant flares) ----- */
  if (IQ.Worlds && typeof IQ.Worlds.register === 'function') {
    IQ.Worlds.register({
      id: WID,
      align: 'bad',
      pal: ['#8fbf6a', '#4a7c3f', '#2f5233', '#16301f', '#d9b45a', '#c97b2e', '#9fd08c', '#e8e4d8'],
      draw: function (c, w, h, t) {
        var g = c.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#04120a');
        g.addColorStop(0.65, '#0a2415');
        g.addColorStop(1, '#123021');
        c.fillStyle = g; c.fillRect(0, 0, w, h);
        /* slow amber flare glow on the horizon (distant, implied — no gore) */
        var fx = w * (0.3 + 0.4 * (0.5 + 0.5 * Math.sin(t * 0.07)));
        var fg = c.createRadialGradient(fx, h * 0.72, 4, fx, h * 0.72, 150);
        fg.addColorStop(0, 'rgba(217,180,90,' + (0.10 + 0.06 * Math.sin(t * 0.9)).toFixed(3) + ')');
        fg.addColorStop(1, 'rgba(217,180,90,0)');
        c.fillStyle = fg; c.fillRect(fx - 160, h * 0.72 - 160, 320, 320);
        /* drifting mist bands */
        for (var i = 0; i < 6; i++) {
          c.fillStyle = 'rgba(159,208,140,' + (0.03 + 0.02 * (i % 2)) + ')';
          var mx = ((i * 173 + t * (8 + i * 3)) % (w + 260)) - 130;
          c.beginPath();
          c.ellipse(mx, h * (0.3 + 0.09 * i), 120 + i * 18, 16 + i * 3, 0, 0, 7);
          c.fill();
        }
        /* canopy silhouettes, three depths */
        canopy(c, w, h, 0.78, 'rgba(6,26,15,.9)', 0.011, t * 0.12);
        canopy(c, w, h, 0.86, 'rgba(4,18,11,.94)', 0.008, t * 0.07 + 2);
        canopy(c, w, h, 0.94, 'rgba(2,12,7,.97)', 0.006, t * 0.04 + 4);
        /* fireflies / distant tracers */
        for (var j = 0; j < 22; j++) {
          var f = (t * 0.25 + j * 0.41) % 1;
          c.fillStyle = 'rgba(232,228,216,' + (0.5 * (1 - f)).toFixed(3) + ')';
          c.fillRect((j * 131) % w, (h * 0.15 + ((j * 67) % Math.floor(h * 0.5)) + f * 24) | 0, 2, 2);
        }
      }
    });
  } else {
    console.warn('[pack-nam] IQ.Worlds absent — backdrop not registered; hooks stay inert until world appears.');
  }

  function canopy(c, w, h, yBase, color, freq, phase) {
    c.fillStyle = color;
    c.beginPath(); c.moveTo(0, h);
    for (var x = 0; x <= w; x += 20) {
      var y = h * yBase + Math.sin(x * freq + phase) * h * 0.035 +
              Math.sin(x * freq * 3.1 + phase * 2) * h * 0.012;
      c.lineTo(x, y);
    }
    c.lineTo(w, h); c.closePath(); c.fill();
  }

  /* ---- shared helpers ----------------------------------------------------- */
  function nowMs() {
    return (root.performance && performance.now) ? performance.now() : Date.now();
  }
  function motionOK() {
    try {
      if (root.IQB_MOTION === false) return false;
      var v = null;
      try { v = root.localStorage.getItem('IQB_MOTION'); } catch (e) {}
      return v == null ? true : JSON.parse(v) !== false;
    } catch (e) { return true; }
  }

  /* Per-round runtime record (single active round; presentation clocks only). */
  var cur = null;

  function seedRecord(ctx) {
    var L = Math.max(1, (ctx.timerLen || 60));
    var rng = ctx.rng;
    /* FIXED unconditional draw order — parity requirement */
    var frac = 0.60 + 0.15 * rng();            /* strike mark: 60-75% of L */
    var col = Math.floor(rng() * 4) % 4;       /* strike column 0..3 */
    var prev = IQ.Hooks.state.get(K.lastCol);
    if (prev === col) col = (col + 1) % 4;     /* never two in a row */
    IQ.Hooks.state.set(K.lastCol, col);

    var chatter = [];
    var CHATTER = [
      'command says hold tight',
      'static on the wire...',
      'hawk flight is ninety seconds out',
      'do NOT light anything that burns',
      'radio check. radio check.',
      'if you hear rotors, hold position',
      'command wants eyes on the treeline',
      'nobody shoots unless I say so'
    ];
    for (var tt = 12; tt < L - 1; tt += 12) {
      var jit = rng() * 4;                     /* unconditional jitter draw */
      var at = tt + jit;
      if (at < L - 0.5) chatter.push({ at: at, line: CHATTER[chatter.length % CHATTER.length], done: false });
    }

    var markAt = Math.min(frac * L, Math.max(0.5, L - BURN_S));
    return {
      L: L, markAt: markAt, burnEnd: markAt + BURN_S, col: col,
      chatter: chatter, clock: 0, last: nowMs(),
      cells: new Array(COLS * ROWS).fill(false),
      revealed: 0, sig: '', oKind: '', rect: null, ogRect: null,
      liftUntil: -1, pendingBanner: null, didDisable: false,
      didClear: false, didBurnBanner: false, didMarker: false
    };
  }

  /* Advance + return clamped seconds since previous tick (presentation only). */
  function step(r) {
    var t = nowMs();
    var dt = Math.min((t - r.last) / 1000, 0.25);
    r.last = t;
    r.clock += dt;
    return dt;
  }

  /* PURE coverage kernel — exposed for parity/smoke tests via IQ.Nam. */
  function markCells(cells, revealed, x, y, rect) {
    if (!rect || rect.w <= 0 || rect.h <= 0) return revealed;
    var cw = rect.w / COLS, ch = rect.h / ROWS;
    for (var cy = 0; cy < ROWS; cy++) {
      for (var cx = 0; cx < COLS; cx++) {
        var idx = cy * COLS + cx;
        if (cells[idx]) continue;
        var dx = (cx + 0.5) * cw - x, dy = (cy + 0.5) * ch - y;
        if (dx * dx + dy * dy <= REVEAL_R * REVEAL_R) {
          cells[idx] = true;
          revealed++;
        }
      }
    }
    return revealed;
  }

  function coverageOf(r) {
    return r.revealed / (COLS * ROWS);
  }

  function isActive(ctx) {
    if (ctx && ctx.world === WID) return true;
    return IQ.Hooks.state.get(K.world) === WID;
  }

  function beginIfWorld(ctx) {
    IQ.Hooks.state.set(K.world, ctx && ctx.world ? String(ctx.world) : '');
    if ((ctx && ctx.world) !== WID) { teardown(); return false; }
    return true;
  }

  function teardown() {
    cur = null;
    try {
      var n = document.querySelectorAll('.iq-nam-hud');
      for (var i = 0; i < n.length; i++) n[i].remove();
    } catch (e) {}
  }

  /* ---- persistent HUD layer ----------------------------------------------
   * Pack-owned fixed root because the engine's overlayHTML channel truncates
   * at 2000 chars and auto-expires (header E2). Interactive surface is ONLY
   * the spend button (pointer-events:auto on itself). Escapable: no focus
   * trap, no Escape interception; it never overlaps option tiles. */
  var STYLE_ID = 'iq-nam-style';
  function ensureStyle() {
    try {
      if (document.getElementById(STYLE_ID)) return;
      var st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent =
        '.iq-nam-hud{position:fixed;inset:0;pointer-events:none;z-index:65;' +
        "font-family:'Oxanium',monospace}" +
        '.iq-nam-veil{position:absolute;overflow:hidden;border-radius:10px;' +
        'background:repeating-linear-gradient(135deg,rgba(10,28,16,.02) 0 6px,rgba(10,28,16,.05) 6px 12px)}' +
        '.iq-nam-cell{position:absolute;background:rgba(6,20,11,.92);box-shadow:inset 0 0 0 1px rgba(140,190,120,.06)}' +
        '.iq-nam-cell.r{background:rgba(6,20,11,.16)}' +
        (motionOK() ? '.iq-nam-cell{transition:background .35s linear}' : '') +
        '@media (prefers-reduced-motion:reduce){.iq-nam-cell{transition:none}}';
      document.head.appendChild(st);
    } catch (e) {}
  }

  function boardRects() {
    try {
      var bf = document.getElementById('board-frame');
      if (!bf) return null;
      var b = bf.getBoundingClientRect();
      if (b.width < 8 || b.height < 8) return null;
      var out = { x: b.left, y: b.top, w: b.width, h: b.height, og: null };
      var og = document.getElementById('opts-grid');
      if (og) {
        var o = og.getBoundingClientRect();
        if (o.width > 8) out.og = { x: o.left, y: o.top, w: o.width, h: o.height };
      }
      return out;
    } catch (e) { return null; }
  }

  function buildHUD(r) {
    ensureStyle();
    var rect = boardRects();
    r.rect = rect ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : r.rect;
    r.ogRect = rect && rect.og ? rect.og : r.ogRect;
    var mo = motionOK();
    var lift = r.clock < r.liftUntil;

    var html = '<div class="iq-nam-hud" aria-hidden="true">';
    if (r.rect && !lift) {
      html += '<div class="iq-nam-veil" style="left:' + r.rect.x + 'px;top:' + r.rect.y +
        'px;width:' + r.rect.w + 'px;height:' + r.rect.h + 'px;' +
        (mo
          ? '-webkit-mask-image:radial-gradient(circle ' + REVEAL_R + 'px at var(--mx,-999px) var(--my,-999px),transparent 55%,#000 96%);' +
            'mask-image:radial-gradient(circle ' + REVEAL_R + 'px at var(--mx,-999px) var(--my,-999px),transparent 55%,#000 96%);'
          : '') +
        (r.mx ? '--mx:' + r.mx + 'px;--my:' + r.my + 'px;' : '') + '">';
      var cw = r.rect.w / COLS, chh = r.rect.h / ROWS;
      for (var cy = 0; cy < ROWS; cy++) {
        for (var cx = 0; cx < COLS; cx++) {
          html += '<div class="iq-nam-cell' + (r.cells[cy * COLS + cx] ? ' r' : '') +
            '" style="left:' + (cx * cw).toFixed(1) + 'px;top:' + (cy * chh).toFixed(1) +
            'px;width:' + (cw + 0.5).toFixed(1) + 'px;height:' + (chh + 0.5).toFixed(1) + 'px"></div>';
        }
      }
      html += '</div>';
      if (!mo) {
        html += '<div style="position:absolute;left:' + r.rect.x + 'px;top:' + (r.rect.y - 16) +
          'px;font-size:10px;letter-spacing:.18em;color:#9fd08c">FOG ' +
          Math.round(coverageOf(r) * 100) + '% REVEALED</div>';
      }
    }
    if (lift && r.rect) {
      html += '<div style="position:absolute;left:' + r.rect.x + 'px;top:' + (r.rect.y - 16) +
        'px;font-size:10px;letter-spacing:.18em;color:#d9b45a">CLEAR SKY — ' +
        Math.max(0, Math.ceil(r.liftUntil - r.clock)) + 's</div>';
    }

    /* footer: ammo spend (spec 4) */
    var ammo = IQ.Hooks.state.get(AMMO_KEY) || 0;
    var canSpend = ammo >= LIFT_COST && !!cur && r.clock >= r.liftUntil &&
                   coverageOf(r) < 1 && !!r.rect;
    html += '<div style="position:fixed;left:14px;bottom:14px;display:flex;gap:10px;align-items:center;' +
      'background:rgba(8,24,14,.87);border:1px solid rgba(150,200,130,.35);border-radius:8px;' +
      'padding:6px 10px;color:#cfe8c6;font-size:12px;letter-spacing:.06em">' +
      '<span>RECON &#183; FOG ' + Math.round(coverageOf(r) * 100) + '% &#183; AMMO \u00D7' + ammo + '</span>';
    if (canSpend) {
      html += '<button type="button" class="iq-nam-spend" style="pointer-events:auto;cursor:pointer;' +
        'background:#1c3320;color:#ffd98a;border:1px solid #d9b45a;border-radius:6px;' +
        "padding:4px 10px;font:700 11px 'Oxanium',monospace;letter-spacing:.08em\">" +
        'SPEND ' + LIFT_COST + ' \u00B7 LIFT FOG ' + LIFT_S + 's</button>';
    }
    html += '</div></div>';
    return html;
  }

  function mountHUD(r) {
    try {
      var old = document.querySelectorAll('.iq-nam-hud');
      for (var i = 0; i < old.length; i++) old[i].remove();
      var wrap = document.createElement('div');
      wrap.innerHTML = buildHUD(r);
      var node = wrap.firstChild;
      if (node) document.body.appendChild(node);
    } catch (e) {}
  }

  /* Live-node updates that must not rebuild the whole HUD (cheap, frequent). */
  function liveNodes() {
    try { return document.querySelectorAll('.iq-nam-hud'); } catch (e) { return []; }
  }

  /* ---- pointer wiring (delegated, installed once) ------------------------- */
  if (typeof document !== 'undefined' && document.addEventListener) {
    var movePending = false, lastPX = 0, lastPY = 0;
    document.addEventListener('pointermove', function (ev) {
      if (!cur) return;
      lastPX = ev.clientX; lastPY = ev.clientY;
      if (movePending) return;
      movePending = true;
      requestAnimationFrame(function () {
        movePending = false;
        var r = cur;
        if (!r || !r.rect) return;
        var vx = lastPX - r.rect.x, vy = lastPY - r.rect.y;
        var inside = vx >= -REVEAL_R && vy >= -REVEAL_R &&
                     vx <= r.rect.w + REVEAL_R && vy <= r.rect.h + REVEAL_R;
        if (!inside) return;
        /* soft mask follows the cursor (motion mode) */
        if (motionOK()) {
          r.mx = vx; r.my = vy;
          var veils = liveNodes();
          for (var i = 0; i < veils.length; i++) {
            var v = veils[i].querySelector ? veils[i].querySelector('.iq-nam-veil') : null;
            if (v) { v.style.setProperty('--mx', vx + 'px'); v.style.setProperty('--my', vy + 'px'); }
          }
        }
        /* coverage kernel (both modes) */
        var before = r.revealed;
        r.revealed = markCells(r.cells, r.revealed, vx, vy, r.rect);
        if (r.revealed !== before) {
          IQ.Hooks.state.set(K.cov, Math.round(coverageOf(r) * 10000) / 10000);
          if (!motionOK()) {
            /* static grid: snap newly revealed cells clear, no animation */
            var cw = r.rect.w / COLS, chh = r.rect.h / ROWS;
            var huds = liveNodes();
            for (var n = 0; n < huds.length; n++) {
              var cells = huds[n].querySelectorAll('.iq-nam-cell');
              for (var ci = 0; ci < cells.length; ci++) {
                if (r.cells[ci]) cells[ci].classList.add('r');
              }
            }
          }
        }
      });
    }, { passive: true });

    document.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('.iq-nam-spend') : null;
      if (btn && root.IQ && root.IQ.Nam) root.IQ.Nam.spend();
    });
  }

  /* ---- public API (spend + parity-test kernels) --------------------------- */
  root.IQ.Nam = {
    /* Spend 2 banked ammo tokens to lift the fog for 8s. Returns true on spend. */
    spend: function () {
      var r = cur;
      if (!r) return false;
      if (r.clock < r.liftUntil) return false;
      var ammo = IQ.Hooks.state.get(AMMO_KEY) || 0;
      if (ammo < LIFT_COST) return false;
      IQ.Hooks.state.set(AMMO_KEY, ammo - LIFT_COST);
      r.liftUntil = r.clock + LIFT_S;
      /* a lifted board is a seen board: mark every cell revealed */
      for (var i = 0; i < r.cells.length; i++) r.cells[i] = true;
      r.revealed = r.cells.length;
      IQ.Hooks.state.set(K.cov, 1);
      r.pendingBanner = 'FOG LIFTED \u2014 ' + LIFT_S + ' SECONDS OF CLEAR SKY';
      mountHUD(r);
      return true;
    },
    coverage: function () { return cur ? coverageOf(cur) : (IQ.Hooks.state.get(K.cov) || 0); },
    /* Debug/parity accessor: seeded strike plan of the active round. */
    strikeInfo: function () {
      return cur ? { col: cur.col, markAt: cur.markAt, burnEnd: cur.burnEnd, L: cur.L } : null;
    },
    markCells: markCells,
    GRID: { COLS: COLS, ROWS: ROWS, R: REVEAL_R },
    active: function () { return !!cur; }
  };

  /* ---- cosmetic overlay strips (contract channel, sig-gated) -------------- */
  function stripHTML(r, kind) {
    if (!r.ogRect) return '';
    var cw = r.ogRect.w / 4;
    var left = r.ogRect.x + r.col * cw;
    var base = 'position:fixed;left:' + left.toFixed(1) + 'px;top:' + r.ogRect.y.toFixed(1) +
      'px;width:' + cw.toFixed(1) + 'px;height:' + r.ogRect.h.toFixed(1) + 'px;pointer-events:none;';
    if (kind === 'marker') {
      return '<div style="' + base + 'border:2px dashed rgba(255,190,80,.75);border-radius:8px;' +
        'background:rgba(255,170,50,.06)">';

    }
    if (kind === 'burn') {
      var mo = motionOK();
      return '<div style="' + base +
        'border:1px solid rgba(255,170,60,.6);border-radius:8px;' +
        'background:linear-gradient(180deg,rgba(255,150,40,.30),rgba(120,40,5,.24));' +
        (mo ? 'animation:iq-nam-flick .4s steps(1,end) infinite;' : 'opacity:.55;') + '">' +
        '<div style="margin-top:6px;text-align:center;font-size:10px;letter-spacing:.2em;' +
        'color:#ffd98a">BURNING</div></div>' +
        (mo ?
          '<style>@keyframes iq-nam-flick{0%{opacity:.45}10%{opacity:.9}22%{opacity:.4}' +
          '50%{opacity:.85}62%{opacity:.38}100%{opacity:.45}}' +
          '@keyframes iq-nam-hit{from{opacity:.95}to{opacity:0}}</style>' +
          '<div style="' + base + 'background:rgba(255,224,150,.95);border-radius:8px;' +
          'animation:iq-nam-hit .14s ease-out 1 forwards"></div>'
          : '');
    }
    return '';
  }

  /* ---- THE PACK ------------------------------------------------------------ */
  IQ.Hooks.add({
    id: 'jungle-recon',
    /* always:true + self-filter (header E1): the engine's tick ctx carries no
     * world, so worlds-bound packs would never receive onTick. Every handler
     * gates on isActive(ctx) / beginIfWorld(ctx). */
    always: true,
    weight: 0.6,
    handlers: {

      onRoundStart: function (ctx) {
        if (!beginIfWorld(ctx)) return null;
        teardown();                       /* fresh veil per round */
        cur = seedRecord(ctx);
        mountHUD(cur);
        return {
          bannerText: 'INCOMING \u2014 WATCH THE SKY',
          overlayHTML: '<div style="position:fixed;left:50%;top:8%;transform:translateX(-50%);' +
            'background:rgba(30,10,4,.85);border:1px solid #ff9f1c;border-radius:6px;' +
            'padding:6px 14px;color:#ffd98a;font:700 12px \'Oxanium\',monospace;' +
            'letter-spacing:.22em;pointer-events:none">\u2708 INCOMING \u2014 WATCH THE SKY</div>',
          sfx: 'zap',
          flag: 'nam-round-start'
        };
      },

      onTick: function (ctx) {
        var r = cur;
        if (!r || !isActive(ctx)) return null;
        step(r);
        var mod = {};
        var mo = motionOK();

        /* radio chatter (spec 3) */
        for (var i = 0; i < r.chatter.length; i++) {
          var ch = r.chatter[i];
          if (!ch.done && r.clock >= ch.at) {
            ch.done = true;
            mod.bannerText = '\u201C' + ch.line + '\u201D';
            break;
          }
        }

        /* napalm strike phases (spec 2). Overlay strips are emitted ONCE per
         * phase kind — the engine appends a new overlay node per emission and
         * transient strips self-expire (overlayMs ~3.2s), so re-asserting the
         * markup every tick would stack dozens of nodes during the burn. */
        var phase = r.clock >= r.markAt && r.clock < r.burnEnd ? 'burn'
          : (r.clock >= r.markAt - MARK_LEAD && r.clock < r.markAt ? 'marker' : '');
        if (phase === 'marker' && !r.didMarker) {
          r.didMarker = true;
          r.oKind = 'marker';
          mod.overlayHTML = stripHTML(r, 'marker');
          mod.bannerText = mod.bannerText || 'STRIKE MARKED \u2014 STAND CLEAR OF COLUMN ' + (r.col + 1);
        }
        if (phase === 'burn') {
          if (!r.didBurnBanner) {
            r.didBurnBanner = true;
            mod.bannerText = 'NAPALM \u2014 COLUMN ' + (r.col + 1) + ' BURNING';
          }
          /* assert column lockdown every tick of the burn (hunter-beam style) */
          var idxs = columnOptionIndices(r);
          if (idxs) { mod.disableOptionIdx = idxs; r.didDisable = true; }
          if (r.oKind !== 'burn') {          /* strip + impact flash once */
            r.oKind = 'burn';
            mod.overlayHTML = stripHTML(r, 'burn');
          }
        } else if (r.didDisable && !r.didClear && r.clock >= r.burnEnd) {
          r.didClear = true;
          r.oKind = '';
          mod.disableOptionIdx = [];      /* house "clear" convention (E4) */
        }

        /* ammo-lift expiry + pending spend banner (spec 4) */
        if (r.pendingBanner) { mod.bannerText = r.pendingBanner; r.pendingBanner = null; }

        /* persistent HUD refresh on discrete state changes only */
        var ammo = IQ.Hooks.state.get(AMMO_KEY) || 0;
        var sig = [
          r.clock < r.liftUntil ? 'L' : 'F',
          Math.round(coverageOf(r) * 100),
          ammo,
          r.clock >= r.markAt && r.clock < r.burnEnd ? 'B' :
            (r.clock >= r.markAt - MARK_LEAD && r.clock < r.markAt ? 'M' : ''),
          mo ? 'mo' : 'st',
          Math.round(r.clock)
        ].join('|');
        if (sig !== r.sig) {
          r.sig = sig;
          mountHUD(r);
        }

        return Object.keys(mod).length ? mod : null;
      },

      onPreAnswer: function (ctx) {
        var r = cur;
        if (!r || !isActive(ctx)) return null;
        /* blind-through-the-fog penalty (spec 1): host still owns the math */
        if (coverageOf(r) < 0.30) {
          return {
            scoreMul: 0.85,
            bannerText: 'ANSWERED BLIND THROUGH THE FOG \u2014 PAY \u00D70.85',
            flag: 'nam-blind'
          };
        }
        return null;
      },

      onAnswer: function (ctx) {
        if (!cur || !isActive(ctx)) return null;
        teardown();                        /* reveal must be fully readable */
        return null;
      },

      onInterlude: function () {
        teardown();
        return null;
      }
    }
  });

  /* Map the burning grid COLUMN (0..3 of the 4x2 options grid) to the engine's
   * option INDICES (dataset.i), reading only public shuffle layout. Falls back
   * to null (visual-only strike) if the DOM is unavailable. Never touches
   * correctIdx — positions are player-visible layout, not answers. */
  function columnOptionIndices(r) {
    try {
      var btns = document.querySelectorAll('#opts-grid .opt-btn');
      if (!btns || btns.length < 8) return null;
      var a = btns[r.col], b = btns[r.col + 4];
      if (!a || !b) return null;
      var ia = parseInt(a.dataset && a.dataset.i, 10), ib = parseInt(b.dataset && b.dataset.i, 10);
      if (!isFinite(ia) || !isFinite(ib)) return null; /* degrade to visual-only strike */
      return [ia, ib];
    } catch (e) { return null; }
  }

  console.info('[pack-nam] registered: jungle-recon (world ' + WID + ')');

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { id: 'jungle-recon', world: WID };
  }
})();
