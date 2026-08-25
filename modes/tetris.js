/**
 * modes/tetris.js — THE WELL (`tetris-drop`): sprint-tetris takeover stage.
 * Vanilla JS/Canvas, asset-free. Never touches window.G; engine applies the result.
 *
 * Registration shape (speculative against research/mode-contract.md; thin adapter):
 *   window.IQ.Stage.register({
 *     id: 'tetris-drop',
 *     name: 'THE WELL',
 *     weight: 6,
 *     mount: function (container, ctx) { ...returns Promise<StageResult>... }
 *   });
 * Defensive: if IQ.Stage is absent at load, the descriptor is queued on
 * window.__stagePending (StageCore drains it later).
 *
 * ctx fields consumed:
 *   depth (number)     -> diff = clamp(1 + floor(depth/6), 1, 5)
 *   rng   (mulberry32) -> ONLY randomness source (7-bag shuffle, garbage hole cols)
 *   mp    (boolean)    -> shows the seed-sync note in the header
 *   world/align/hp/score/streak/seed -> accepted, read-only (display only).
 *
 * Controls:
 *   Keyboard: Left/Right move · Down soft drop · Up/X rotate CW · Z rotate CCW ·
 *             Space hard drop · P (or Esc) pause (pauses gravity AND the cap timer).
 *   Touch: on-canvas button row  ◀ ▶ ⟳ ⟲ ▼ DROP  (each ≥44 px, hold-to-repeat).
 *
 * StageResult fields resolved:
 *   {
 *     kind:    'score',
 *     correct: lines >= QUOTA                       // QUOTA scales 2→6 with diff
 *     points:  30 + LINE_PTS[diff]*lines + (quotaMetEarly ? WIN_BONUS : 0)
 *              // balance pass 2026-08-25: BASE_PTS 30, LINE_PTS [40,52,62,70,70],
 *              // WIN_BONUS 50. Quota-met wins land ~96-114% of the puzzle baseline
 *              // 100*diff+40; cap-expiry partials always pay less than winning at
 *              // the same depth, so running out the clock is never optimal.
 *              // Verified by research/bal-retro-tetris.js
 *     summary: 'WELL CLEARED — n LINES' | 'BURIED — n LINES' | 'n LINES'
 *   }
 *
 * Determinism (PATTERN Q, canonical seeded-world case): the piece QUEUE is pure
 * ctx.rng 7-bag shuffle — host and client hold byte-identical sequences; only
 * move/rotate/drop events would ever be relayed. Garbage hole columns (diff≥3)
 * are also drawn from ctx.rng at mount in fixed order.
 *
 * Depth scaling: QUOTA 2→6; gravity 900 ms→220 ms; diff≥3 inserts one seeded
 * garbage row at 33%/66% elapsed (700 ms bottom-row glow telegraph BEFORE it
 * rises); diff≥5 hides the next-piece preview.
 *
 * Fairness rails: line-clear flash ≤160 ms and well-localized; lock delay
 * 300 ms; topout needs 2 consecutive rim offenses (grace); no fullscreen
 * flashes; IQB_MOTION gates the hard-drop shake; IQB_MUTED gates WebAudio;
 * pause card escapable (P/Esc/tap); controls hint visible first 3 s; cap 45 s.
 *
 * Headless smoke hook (documented):
 *   window.__WELL__.step(cmd)   // cmd: 'left'|'right'|'cw'|'ccw'|'soft'|'hard'
 *                               // applies the command, then advances EXACTLY one
 *                               // gravity step synchronously (rAF keeps running)
 *   window.__WELL__.state()     // -> {lines,quota,dead,won,finished,elapsedMs,garbage,piece}
 *   window.__WELL__.finish()    // force-resolve as cap-expiry (fast soak tests)
 */
(function () {
  'use strict';

  var COLS = 10;
  var ROWS = 18;
  var CAP_MS = 45000;
  var LOCK_DELAY = 300;
  var CLEAR_FLASH_MS = 160;
  var GLOW_TELEGRAPH_MS = 700;

  function diffFor(depth) {
    return Math.max(1, Math.min(5, 1 + Math.floor((depth | 0) / 6)));
  }
  /* Scoring economy (balance pass 2026-08-25): quota-met wins land ~96-114%
   * of the engine puzzle baseline good-answer = 100*diff+40 (diff =
   * clamp(1+floor(depth/6),1,5)). Cap-expiry partial credit is always worth
   * less than winning at the same depth — waiting out the clock never beats
   * playing; topout/cap with zero lines still costs 15 hp (unchanged rail).
   * LINE_PTS stays flat diff4→5 to keep the quota-6 jackpot under the
   * engine's 500-point clamp. Pure functions of ctx.depth: determinism
   * untouched. */
  var BASE_PTS = 30;
  var LINE_PTS = [0, 40, 52, 62, 70, 70];   // per cleared line, by diff
  var WIN_BONUS = 50;                       // quota met (early resolve)
  var QUOTA_BY_DIFF = [0, 2, 3, 4, 5, 6];
  var GRAV_BY_DIFF = [0, 900, 730, 560, 380, 220];

  /* 7 tetrominoes: cell-offset tables for all 4 rotations, precomputed. */
  var PIECES = (function () {
    var mats = [
      [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],   // I
      [[1, 0, 0], [1, 1, 1], [0, 0, 0]],                           // J
      [[0, 0, 1], [1, 1, 1], [0, 0, 0]],                           // L
      [[1, 1], [1, 1]],                                            // O
      [[0, 1, 1], [1, 1, 0], [0, 0, 0]],                           // S
      [[0, 1, 0], [1, 1, 1], [0, 0, 0]],                           // T
      [[1, 1, 0], [0, 1, 1], [0, 0, 0]]                            // Z
    ];
    var COLORS = ['#3fd8e0', '#5a7bff', '#ff9f43', '#ffd93d', '#6ee76e', '#c084fc', '#ff5e6c'];
    function rotCW(m) {
      var n = m.length, r = [], y, x;
      for (y = 0; y < n; y++) { r.push([]); for (x = 0; x < n; x++) r[y].push(m[n - 1 - x][y]); }
      return r;
    }
    function cells(m) {
      var out = [], y, x;
      for (y = 0; y < m.length; y++) for (x = 0; x < m.length; x++) if (m[y][x]) out.push([x, y]);
      return out;
    }
    return mats.map(function (m, i) {
      var cur = m, rots = [];
      for (var k = 0; k < 4; k++) { rots.push(cells(cur)); cur = rotCW(cur); }
      return { rots: rots, color: COLORS[i] };
    });
  })();

  var DESCRIPTOR = {
    id: 'tetris-drop',
    name: 'THE WELL',
    goalText: 'STACK LINES. CLEAR. SURVIVE THE WELL.',
    controls: '\u2190\u2192 move \u00B7 \u2191/X cw \u00B7 Z ccw \u00B7 \u2193 soft \u00B7 SPACE drop \u00B7 P pause',
    weight: 6,
    mount: function (container, ctx) {
      return new Promise(function (resolve) {
        var diff = diffFor(ctx.depth);
        var QUOTA = QUOTA_BY_DIFF[diff];
        var gravMs = GRAV_BY_DIFF[diff];
        var hideNext = diff >= 5;
        var rng = ctx.rng;

        /* ---------- dom ---------- */
        var wrap = document.createElement('div');
        wrap.className = 'iq-well';
        var head = document.createElement('div');
        head.className = 'iq-well-head';
        var title = document.createElement('span');
        title.textContent = 'THE WELL · DEPTH ' + (ctx.depth | 0) + ' · QUOTA ' + QUOTA;
        var meta = document.createElement('span');
        meta.className = 'iq-well-meta';
        meta.textContent = '←→ move · ↑/X cw · Z ccw · ↓ soft · SPACE drop · P pause';
        head.appendChild(title);
        head.appendChild(meta);
        var canvas = document.createElement('canvas');
        var pad = document.createElement('div');
        pad.className = 'iq-well-pad';
        var BTN_DEFS = [
          ['◀', 'left'], ['▶', 'right'], ['⟳', 'cw'], ['⟲', 'ccw'], ['▼', 'soft'], ['DROP', 'hard']
        ];
        var padBtns = {};
        BTN_DEFS.forEach(function (def) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'iq-well-btn';
          b.textContent = def[0];
          b.setAttribute('aria-label', def[1]);
          pad.appendChild(b);
          padBtns[def[1]] = b;
        });
        var foot = document.createElement('div');
        foot.className = 'iq-well-foot';
        var pauseCard = document.createElement('div');
        pauseCard.className = 'iq-well-pause';
        pauseCard.textContent = 'PAUSED — P / ESC / TAP TO RESUME';
        pauseCard.style.display = 'none';
        wrap.appendChild(head);
        wrap.appendChild(canvas);
        wrap.appendChild(pad);
        var readyCard = document.createElement('div');
        readyCard.className = 'iq-well-ready';
        readyCard.textContent = 'THE WELL \u2014 STACK LINES. CLEAR. SURVIVE THE WELL.' +
          ' \u00B7 \u2190\u2192 move \u00B7 \u2191/X cw \u00B7 Z ccw \u00B7 \u2193 soft \u00B7 SPACE drop \u00B7 P pause';
        wrap.appendChild(readyCard);
        wrap.appendChild(foot);
        wrap.appendChild(pauseCard);
        container.appendChild(wrap);

        if (ctx.mp) {
          var note = document.createElement('div');
          note.className = 'iq-well-note';
          note.textContent = 'seed-synced piece queue — same seed, same pieces; skill is yours';
          wrap.appendChild(note);
        }
        var style = document.createElement('style');
        style.textContent =
          '.iq-well{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;' +
          'color:#dfe6ff;font-family:Oxanium,monospace;background:#06070f;padding:8px;border-radius:8px}' +
          '.iq-well-head{display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px;width:100%;' +
          'font-size:13px;letter-spacing:1px;color:#8fa3ff}.iq-well-meta{color:#5d6c9e;font-size:12px}' +
          '.iq-well-note{font-size:11px;color:#8fa3ff}.iq-well-foot{font-size:12px;color:#eef2ff;' +
          'min-height:16px}.iq-well canvas{background:#06070f;border:2px solid #232c52;border-radius:4px;' +
          'touch-action:none;display:block}' +
          '.iq-well-pad{display:flex;gap:6px;width:100%;max-width:420px}' +
          '.iq-well-btn{flex:1;min-width:44px;min-height:44px;font-size:16px;font-family:inherit;' +
          'color:#dfe6ff;background:#10162e;border:1px solid #2c3766;border-radius:6px;cursor:pointer;' +
          'padding:0;-webkit-tap-highlight-color:transparent}' +
          '.iq-well-btn:active{background:#1c2750}' +
          '.iq-well-ready{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);' +
          'background:rgba(6,8,20,.92);border:1px solid #2c3766;color:#dfe6ff;font-size:13px;' +
          'letter-spacing:.08em;padding:10px 16px;border-radius:6px;pointer-events:none;' +
          'z-index:2;text-align:center;transition:opacity .5s;max-width:92%}' +
          '.iq-well-pause{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
          'background:rgba(4,6,16,.82);color:#dfe6ff;font-size:15px;letter-spacing:2px;cursor:pointer;z-index:2}';
        wrap.appendChild(style);

        /* ---------- audio (IQ.Audio preferred; muted-gated fallback osc) ---------- */
        var audioCtx = null;
        function muted() {
          try { return window.localStorage.getItem('IQB_MUTED') === '1'; } catch (e) { return false; }
        }
        function beep(freq, ms) {
          if (muted()) return;
          try {
            if (window.IQ && window.IQ.Audio && typeof window.IQ.Audio.blip === 'function') {
              window.IQ.Audio.blip(freq, ms);
              return;
            }
            if (!audioCtx) {
              var AC = window.AudioContext || window.webkitAudioContext;
              if (!AC) return;
              audioCtx = new AC();
            }
            var o = audioCtx.createOscillator();
            var g = audioCtx.createGain();
            o.type = 'square';
            o.frequency.value = freq;
            g.gain.setValueAtTime(0.04, audioCtx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000);
            o.connect(g).connect(audioCtx.destination);
            o.start();
            o.stop(audioCtx.currentTime + ms / 1000);
          } catch (e) { /* never let audio break gameplay */ }
        }

        /* ---------- seeded piece queue (pure ctx.rng 7-bag) ---------- */
        var bag = [];
        function refill() {
          var idx = [0, 1, 2, 3, 4, 5, 6];
          for (var i = idx.length - 1; i > 0; i--) {
            var j = Math.floor(rng() * (i + 1));
            var t = idx[i]; idx[i] = idx[j]; idx[j] = t;
          }
          bag = bag.concat(idx);
        }
        function nextType() {
          if (!bag.length) refill();
          return bag.shift();
        }
        var upcoming = [nextType(), nextType(), nextType()];

        /* ---------- seeded garbage schedule (diff>=3) ---------- */
        var garbageEvents = [];
        if (diff >= 3) {
          [0.33, 0.66].forEach(function (frac) {
            garbageEvents.push({
              at: CAP_MS * frac,
              hole: Math.floor(rng() * COLS),
              telegraphed: false,
              fired: false
            });
          });
        }

        /* ---------- state ---------- */
        var grid = [];           // grid[y][x] = piece index | -1
        for (var gy = 0; gy < ROWS; gy++) {
          var row = [];
          for (var gx = 0; gx < COLS; gx++) row.push(-1);
          grid.push(row);
        }
        var piece = null;        // {type,rot,x,y}
        var lines = 0;
        var clearing = null;     // {rows:[y...], until:activeMs}
        var activeMs = 0;
        var gravAcc = 0;
        var lockPending = false;
        var readyT = 0;
        var lockAt = 0;
        var softDrop = false;
        var paused = false;
        var finished = false;
        var wonEarly = false;
        var deadByTopout = false;
        var rimOffenses = 0;     // 2 consecutive => buried
        var garbageRisen = 0;
        var shakeMs = 0;
        var rafId = 0;
        var holdIv = null;
        var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

        function motionOff() {
          try { return window.localStorage.getItem('IQB_MOTION') === '0'; } catch (e) { return false; }
        }

        /* ---------- piece ops ---------- */
        function cellsOf(p) {
          return PIECES[p.type].rots[p.rot].map(function (c) { return [p.x + c[0], p.y + c[1]]; });
        }
        function collides(px, py, rot, type) {
          var cs = PIECES[type].rots[rot];
          for (var i = 0; i < cs.length; i++) {
            var gx = px + cs[i][0], gy = py + cs[i][1];
            if (gx < 0 || gx >= COLS || gy >= ROWS) return true;
            if (gy >= 0 && grid[gy][gx] !== -1) return true;
          }
          return false;
        }
        function spawn() {
          var type = upcoming.shift();
          upcoming.push(nextType());
          var p = { type: type, rot: 0, x: 3, y: -1 };
          if (collides(p.x, p.y, p.rot, p.type)) {
            piece = null;                 // rim blocked; retry next gravity step
            registerOffense();
            return;
          }
          piece = p;
          lockPending = false;
        }
        function registerOffense() {
          rimOffenses++;
          if (rimOffenses >= 2) { deadByTopout = true; finish(false); }
        }
        function clearOffense() { rimOffenses = 0; }
        function tryMove(dx, dy) {
          if (!piece) return false;
          if (collides(piece.x + dx, piece.y + dy, piece.rot, piece.type)) return false;
          piece.x += dx; piece.y += dy;
          return true;
        }
        function tryRotate(dr) {
          if (!piece || PIECES[piece.type].rots.length !== 4) return false; // O spins in place
          var nr = (piece.rot + dr + 4) % 4;
          var kicks = [0, -1, 1, -2, 2];
          for (var i = 0; i < kicks.length; i++) {
            if (!collides(piece.x + kicks[i], piece.y, nr, piece.type)) {
              piece.x += kicks[i]; piece.rot = nr;
              return true;
            }
          }
          return false;
        }
        function gravityStep() {
          if (!piece) { spawn(); return; }
          if (tryMove(0, 1)) {
            gravAcc = 0;
            lockPending = false;
          } else {
            if (!lockPending) { lockPending = true; lockAt = activeMs + LOCK_DELAY; }
          }
        }
        function lockPiece() {
          lockPending = false;
          var lostAbove = false;
          cellsOf(piece).forEach(function (c) {
            if (c[1] < 0) { lostAbove = true; return; }
            grid[c[1]][c[0]] = piece.type;
          });
          piece = null;
          if (lostAbove) { registerOffense(); } else { clearOffense(); }
          if (finished) return;
          var full = [];
          for (var y = 0; y < ROWS; y++) {
            var solid = true;
            for (var x = 0; x < COLS; x++) if (grid[y][x] === -1) { solid = false; break; }
            if (solid) full.push(y);
          }
          if (full.length) {
            lines += full.length;
            clearing = { rows: full, until: activeMs + CLEAR_FLASH_MS };
            beep(660, 80);
            if (lines >= QUOTA && !wonEarly) {
              wonEarly = true;
              // resolve right after the flash renders
              clearing = { rows: full, until: activeMs + CLEAR_FLASH_MS, thenWin: true };
            }
          } else {
            spawn();
          }
        }
        function collapseRows(rows) {
          rows.sort(function (a, b) { return a - b; });
          for (var i = 0; i < rows.length; i++) {
            grid.splice(rows[i], 1);
            var fresh = [];
            for (var x = 0; x < COLS; x++) fresh.push(-1);
            grid.unshift(fresh);
          }
        }
        function riseGarbage(ev) {
          ev.fired = true;
          garbageRisen++;
          if (grid[0].some(function (v) { return v !== -1; })) registerOffense();
          else clearOffense();
          grid.shift();
          var grow = [];
          for (var x = 0; x < COLS; x++) grow.push(x === ev.hole ? -1 : 7);
          grid.push(grow);
          if (piece && collides(piece.x, piece.y, piece.rot, piece.type)) {
            if (!tryMove(0, -1) && !tryMove(0, -2)) { piece = null; }
          }
          beep(140, 120);
        }
        function hardDrop() {
          if (!piece) return;
          var dist = 0;
          while (tryMove(0, 1)) dist++;
          if (dist > 0 && !motionOff()) shakeMs = 90;
          lockPiece();
        }

        /* ---------- update (pure function of active-time delta) ---------- */
        function update(dt) {
          if (finished || paused) return;
          activeMs += dt;
          if (shakeMs > 0) shakeMs = Math.max(0, shakeMs - dt);
          if (activeMs >= CAP_MS) { finish(false); return; }

          for (var i = 0; i < garbageEvents.length; i++) {
            var ev = garbageEvents[i];
            if (!ev.fired) {
              if (!ev.telegraphed && activeMs >= ev.at - GLOW_TELEGRAPH_MS) ev.telegraphed = true;
              if (activeMs >= ev.at) riseGarbage(ev);
            }
          }
          if (finished) return;

          if (clearing) {
            if (activeMs >= clearing.until) {
              var rows = clearing.rows;
              var thenWin = clearing.thenWin;
              clearing = null;
              collapseRows(rows);
              if (thenWin) { finish(true); return; }
              spawn();
            }
            return;
          }
          if (deadByTopout || wonEarly) return;

          var interval = softDrop ? Math.min(gravMs, 50) : gravMs;
          gravAcc += dt;
          var guard = 0;
          while (gravAcc >= interval && guard++ < 40) {
            gravAcc -= interval;
            gravityStep();
            if (finished) return;
            if (!piece && !deadByTopout) { /* spawn deferred; keep looping */ }
          }
          if (lockPending && activeMs >= lockAt) { lockPiece(); if (finished) return; }
          if (!piece && !clearing) spawn();
        }

        /* ---------- resolution ---------- */
        function finish(winPath) {
          if (finished) return;
          finished = true;
          cancelAnimationFrame(rafId);
          stopHold();
          clearTimeout(readyT);
          readyCard.style.opacity = '0';   // round over — drop the onboarding legend
          window.removeEventListener('keydown', onKey, true);
          window.removeEventListener('keyup', onKeyUp, true);
          window.removeEventListener('resize', fit);
          canvas.removeEventListener('pointerdown', onPadPointer);
          pad.removeEventListener('pointerdown', onPadPointer);
          pad.removeEventListener('pointerup', stopHold);
          pad.removeEventListener('pointercancel', stopHold);
          pad.removeEventListener('pointerleave', stopHold);
          pauseCard.removeEventListener('pointerdown', togglePause);
          var summary;
          if (wonEarly) summary = 'WELL CLEARED — ' + lines + ' LINES';
          else if (deadByTopout) summary = 'BURIED — ' + lines + ' LINES';
          else summary = lines + ' LINES';
          foot.textContent = summary;
          resolve({
            kind: 'score',
            correct: lines >= QUOTA,
            points: wonEarly ? BASE_PTS + LINE_PTS[diff] * lines + WIN_BONUS : 0,
            hpDelta: lines === 0 ? -15 : 0,
            summary: summary.length <= 48 ? summary : summary.slice(0, 48)
          });
        }

        /* ---------- sizing / render ---------- */
        var cell = 18, panelW = 108, cssW = 0, cssH = 0, dpr = 1;
        function fit() {
          dpr = (typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0)
            ? window.devicePixelRatio : 1;
          var availW = (container.clientWidth || 360) - 28;
          var availH = (container.clientHeight || 480) - 96;
          cssW = Math.max(220, Math.min(availW, 560));
          cssH = Math.max(240, Math.min(availH, 520));
          cell = Math.max(8, Math.min(Math.floor((cssW - panelW) / COLS), Math.floor(cssH / ROWS)));
          canvas.width = Math.round(cssW * dpr);
          canvas.height = Math.round(cssH * dpr);
          canvas.style.width = cssW + 'px';
          canvas.style.height = cssH + 'px';
        }
        function drawBlock(g, px, py, colorIdx, alpha) {
          g.globalAlpha = alpha == null ? 1 : alpha;
          g.fillStyle = PIECES[colorIdx].color;
          g.fillRect(px + 1, py + 1, cell - 2, cell - 2);
          g.globalAlpha = 1;
        }
        function draw() {
          var g = canvas.getContext('2d');
          if (!g || !g.fillRect) return;
          var sx = shakeMs > 0 && !motionOff() ? (Math.random() * 2 - 1) : 0;
          var sy = shakeMs > 0 && !motionOff() ? (Math.random() * 2 - 1) : 0;
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          g.clearRect(0, 0, cssW, cssH);
          g.translate(sx, sy);
          var wellW = COLS * cell;
          var ox = Math.floor((cssW - panelW - wellW) / 2);
          var oy = Math.floor((cssH - ROWS * cell) / 2);

          g.fillStyle = '#0a0d1c';
          g.fillRect(ox, oy, wellW, ROWS * cell);
          g.strokeStyle = '#1b2344';
          g.lineWidth = 1;
          for (var x = 1; x < COLS; x++) {
            g.beginPath(); g.moveTo(ox + x * cell, oy); g.lineTo(ox + x * cell, oy + ROWS * cell); g.stroke();
          }
          for (var y = 1; y < ROWS; y++) {
            g.beginPath(); g.moveTo(ox, oy + y * cell); g.lineTo(ox + wellW, oy + y * cell); g.stroke();
          }

          var cy2, cx2;
          for (cy2 = 0; cy2 < ROWS; cy2++) {
            for (cx2 = 0; cx2 < COLS; cx2++) {
              if (grid[cy2][cx2] !== -1) drawBlock(g, ox + cx2 * cell, oy + cy2 * cell, grid[cy2][cx2]);
            }
          }

          /* garbage telegraph: bottom-row amber glow BEFORE the row rises */
          for (var gi = 0; gi < garbageEvents.length; gi++) {
            var ev = garbageEvents[gi];
            if (ev.telegraphed && !ev.fired) {
              g.globalAlpha = 0.25 + 0.2 * Math.sin(activeMs / 60);
              g.fillStyle = '#ffb347';
              g.fillRect(ox, oy + (ROWS - 1) * cell, wellW, cell);
              g.globalAlpha = 1;
            }
          }

          if (piece) {
            /* landing ghost outline */
            var gy2 = piece.y;
            while (!collides(piece.x, gy2 + 1, piece.rot, piece.type)) gy2++;
            g.strokeStyle = 'rgba(143,163,255,0.4)';
            PIECES[piece.type].rots[piece.rot].forEach(function (c) {
              var bx = piece.x + c[0], by = gy2 + c[1];
              if (by >= 0) g.strokeRect(ox + bx * cell + 2, oy + by * cell + 2, cell - 4, cell - 4);
            });
            PIECES[piece.type].rots[piece.rot].forEach(function (c) {
              var bx = piece.x + c[0], by = piece.y + c[1];
              if (by >= 0) drawBlock(g, ox + bx * cell, oy + by * cell, piece.type);
            });
          }

          if (clearing) {
            var a = Math.max(0, (clearing.until - activeMs) / CLEAR_FLASH_MS);
            g.globalAlpha = a;
            g.fillStyle = '#ffffff';
            clearing.rows.forEach(function (ry) {
              g.fillRect(ox, oy + ry * cell, wellW, cell);
            });
            g.globalAlpha = 1;
          }

          /* right panel */
          var px = ox + wellW + 8;
          var py2 = oy;
          g.fillStyle = '#8fa3ff';
          g.font = '12px Oxanium, monospace';
          g.fillText('NEXT', px, py2 + 14);
          if (hideNext) {
            g.fillStyle = '#3a4570';
            g.fillText('? ? ?', px + 4, py2 + 34);
          } else {
            var nc = PIECES[upcoming[0]].rots[0];
            var minx = 99, miny = 99;
            nc.forEach(function (c) { minx = Math.min(minx, c[0]); miny = Math.min(miny, c[1]); });
            nc.forEach(function (c) {
              drawBlock(g, px + (c[0] - minx) * 10, py2 + 22 + (c[1] - miny) * 10, upcoming[0]);
            });
          }
          g.fillStyle = '#8fa3ff';
          g.fillText('QUOTA', px, py2 + 78);
          for (var q = 0; q < QUOTA; q++) {
            g.fillStyle = q < lines ? '#6ee76e' : '#232c52';
            g.fillRect(px + (q % 3) * 18, py2 + 86 + Math.floor(q / 3) * 18, 14, 14);
          }
          g.fillStyle = '#8fa3ff';
          g.fillText('LINES ' + lines, px, py2 + 140);
          var secs = Math.max(0, Math.ceil((CAP_MS - activeMs) / 1000));
          g.fillStyle = secs <= 10 ? '#ff5e6c' : '#8fa3ff';
          g.fillText(secs + 's', px, py2 + 158);

          foot.textContent = wonEarly ? 'WELL CLEARED' :
            (deadByTopout ? 'BURIED' :
              'lines ' + lines + '/' + QUOTA + ' · ' + secs + 's' + (paused ? ' · PAUSED' : ''));

          /* defensive topbar drive (engine chrome; absent in isolation) */
          var tf = document.getElementById('timer-fill');
          if (tf && tf.style) tf.style.transform = 'scaleX(' + Math.max(0, Math.min(1, 1 - activeMs / CAP_MS)) + ')';
          var tn = document.getElementById('timer-num');
          if (tn) tn.textContent = String(secs);
        }
        /* ---------- input ---------- */
        function act(cmd) {
          if (finished || paused) return;
          var moved = false;
          if (cmd === 'left') moved = tryMove(-1, 0);
          else if (cmd === 'right') moved = tryMove(1, 0);
          else if (cmd === 'cw') moved = tryRotate(1);
          else if (cmd === 'ccw') moved = tryRotate(-1);
          else if (cmd === 'soft') moved = tryMove(0, 1);
          else if (cmd === 'hard') { hardDrop(); return; }
          if (moved) {
            if (lockPending) lockAt = activeMs + LOCK_DELAY;  // lock-delay reset on live move
            if (cmd === 'soft') gravAcc = 0;
            beep(320, 25);
          }
        }
        function togglePause() {
          if (finished) return;
          paused = !paused;
          pauseCard.style.display = paused ? 'flex' : 'none';
        }
        var GAME_KEYS = {
          ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'cw', ArrowDown: 'soft',
          KeyX: 'cw', KeyZ: 'ccw', Space: 'hard'
        };
        function onKey(e) {
          if (e.code === 'KeyP' || e.code === 'Escape') {
            e.preventDefault();
            togglePause();
            return;
          }
          var cmd = GAME_KEYS[e.code];
          if (!cmd) return;
          e.preventDefault();
          if (cmd === 'soft') softDrop = true;
          else act(cmd);
        }
        function onKeyUp(e) {
          if (GAME_KEYS[e.code] === 'soft') softDrop = false;
        }
        function stopHold() {
          if (holdIv) { clearInterval(holdIv); holdIv = null; }
        }
        function onPadPointer(e) {
          var label = e.currentTarget && e.currentTarget.getAttribute &&
            e.currentTarget.getAttribute('aria-label');
          if (!label) return;
          e.preventDefault();
          if (label === 'soft') {
            act('soft');
            stopHold();
            holdIv = setInterval(function () { act('soft'); }, 100);
            return;
          }
          act(label);
          if (label === 'left' || label === 'right') {
            stopHold();
            holdIv = setInterval(function () { act(label); }, 120);
          }
        }
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('resize', fit);
        pad.addEventListener('pointerdown', onPadPointer);
        pad.addEventListener('pointerup', stopHold);
        pad.addEventListener('pointercancel', stopHold);
        pad.addEventListener('pointerleave', stopHold);
        pauseCard.addEventListener('pointerdown', togglePause);

        /* ---------- main loop ---------- */
        var last = t0;
        function frame(now) {
          if (finished) return;
          var dt = Math.min(100, now - last);
          last = now;
          update(dt);
          if (!finished) draw();
          if (!finished) rafId = window.requestAnimationFrame(frame);
        }
        window.__WELL__ = {
          step: function (cmd) {
            if (finished || paused) return false;
            act(cmd);
            if (finished) return false;
            // advance EXACTLY one gravity step synchronously: one gravity
            // period of active time (soft drop halves the period)
            update(softDrop ? Math.min(gravMs, 50) : gravMs);
            return !finished;
          },
          state: function () {
            return {
              lines: lines, quota: QUOTA, dead: deadByTopout, won: wonEarly,
              finished: finished, elapsedMs: Math.round(activeMs),
              garbage: garbageRisen, piece: piece ? PIECES[piece.type].color : null
            };
          },
          finish: function () { if (!finished) finish(false); }
        };
        spawn();
        fit();
        readyT = window.setTimeout(function () { readyCard.style.opacity = '0'; }, 3000);
        rafId = window.requestAnimationFrame(frame);
      });
    }
  };

  if (window.IQ && window.IQ.Stage && typeof window.IQ.Stage.register === 'function') {
    window.IQ.Stage.register(DESCRIPTOR);
  } else {
    (window.__stagePending = window.__stagePending || []).push(DESCRIPTOR);
  }
})();
