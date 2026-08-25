/**
 * modes/battleship.js — SALVOS: hidden-fleet duel takeover stage (vanilla JS/Canvas, asset-free).
 *
 * Registration shape (draft research/mode-contract.md; thin adapter — refinements are one-line):
 *   window.IQ.Stage.register({
 *     id: 'battleship-volley',
 *     name: 'SALVOS',
 *     weight: 4,
 *     mount: function (container, ctx) {
 *       // ctx = {depth, world, align, hp, score, streak, rng, seed, mp}
 *       return new Promise(function (resolve) { ... resolve(stageResult); });
 *     }
 *   });
 * If window.IQ.Stage is absent at load, the def queues on window.__stagePending
 * (StageCore drains it once the Stage module lands).
 *
 * Controls:
 *   Pointer:   click/tap a water cell on the LEFT (enemy) grid to fire.
 *   Keyboard:  type column letter + row number (`a1`..`h8`) then Enter; Backspace edits.
 *   No timers within a salvo — thinking time is free; the 35s round cap bounds the round.
 *
 * StageResult fields resolved:
 *   {
 *     kind:    'score',
 *     correct: true  -> whole shadow fleet sunk within the salvos,
 *                null -> >=5 distinct hits but ships survive,
 *                false -> fewer than 5 hits,
 *     points:  40*cellHits + 120*shipsSunk + (allSunk?60:0) - 20*incomingHitsOnMyWater,
 *     hpDelta: clamp(-5*shipsAfloat - (diff>=5 ? 5*incomingHits : 0), -15, 0),
 *     summary: 'FLEET SUNK — 9/9' | 'TWO HUNTERS REMAIN' (<=48 chars)
 *   }
 *   NEVER touches window.G; the engine applies scoring/hp host-side after resolve.
 *
 * Determinism — PATTERN V (secret-host + validated events), reference impl of the
 * sanitizeRound discipline for stages:
 *   - Round payload equivalents: grid dims + shell counts ONLY. The enemy fleet
 *     (one 4, one 3, one 2 = 9 cells) is placed lazily on the AUTHORITY (host, or
 *     the solo tab) from ctx.rng and NEVER enters any frame.
 *   - Shot:    client->host {t:'stageShot', n, mode:'battleship-volley', uid, r, c}
 *              (the host's own sends loop back through IQ.Net.send, so host play
 *              takes the identical validated path — no role getter needed).
 *   - Verdict: host->all  {t:'stageVerdict', n, uid, r, c, hit, sunk, len}
 *              shooters filter on uid; duplicate shots are idempotent.
 *   - Return fire: enemy hunt/target salvos are computed ONLY on the authority and
 *     broadcast as {t:'stageSalvo', n, uid, cells:[{r,c,hit}]} so every tab renders
 *     identical incoming fire. Your own fleet comes from a DEDICATED seed stream
 *     (mulberry32(seed ^ TAG)) so it is byte-identical on all tabs and independent
 *     of the host's secret draws.
 *   - SOLO shortcut: !ctx.mp -> zero frames; everything local.
 *
 * Depth scaling (diff = clamp(1+floor(depth/6),1,5)):
 *   salvos 5/5/4/4/3 by diff; diff 1-2 enemy never fires back; diff>=3 one return
 *   shell per salvo (-20 pts per hit on your water); diff>=5 two return shells and
 *   -5 hp per hit (both telegraphed: 400 ms amber reticle BEFORE impact).
 *
 * Fairness rails: no fullscreen flashes (localized ripple markers only); colorblind-safe
 * markers (hit = filled ring + X glyph, miss = dot — never hue alone); IQB_MOTION kills
 * the ripple pulse; IQB_MUTED silences audio; pointer + keyboard parity.
 *
 * Self-play / smoke hook:
 *   window.__SALVOS__.fire(r, c)   // fire one shell programmatically (async verdict)
 *   window.__SALVOS__.state()      // -> {salvo, shellsLeft, hits, sunk, afloat, done}
 *   window.__SALVOS__.finish()     // force-resolve now with current tallies
 */
(function () {
  'use strict';

  var GRID = 8;
  var FLEET = [4, 3, 2];               // 9 occupied cells
  var TOTAL_CELLS = 9;
  var CAP_MS = 35000;                  // <=45s hard self-resolve
  var SHELLS_PER_SALVO = 3;
  var SALVOS_BY_DIFF = [5, 5, 4, 4, 3];
  var VERDICT_TIMEOUT_MS = 3000;

  /* ---------- tiny shared helpers (per-file, no deps) ---------- */

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    var h = 2166136261, i;
    s = String(s);
    for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function diffFor(depth) {
    return Math.max(1, Math.min(5, 1 + Math.floor((depth | 0) / 6)));
  }
  function flag(name) {
    try { return window.localStorage.getItem(name) === '1'; } catch (e) { return false; }
  }
  function register(def) {
    if (window.IQ && window.IQ.Stage && typeof window.IQ.Stage.register === 'function') {
      window.IQ.Stage.register(def);
    } else {
      (window.__stagePending = window.__stagePending || []).push(def);
    }
  }

  /* ---------- fleet placement (rejection sample, shared by both waters) ---------- */

  function placeFleet(rng) {
    var occ = new Array(GRID * GRID);
    var i;
    for (i = 0; i < occ.length; i++) occ[i] = false;
    var ships = [];
    for (i = 0; i < FLEET.length; i++) {
      var len = FLEET[i], guard = 0;
      while (guard++ < 600) {
        var horiz = rng() < 0.5;
        var r = (rng() * GRID) | 0, c = (rng() * GRID) | 0;
        var dr = horiz ? 0 : 1, dc = horiz ? 1 : 0;
        if (r + dr * (len - 1) >= GRID || c + dc * (len - 1) >= GRID) continue;
        var cells = [], ok = true, k;
        for (k = 0; k < len; k++) {
          var idx = (r + dr * k) * GRID + (c + dc * k);
          if (occ[idx]) { ok = false; break; }
          cells.push(idx);
        }
        if (!ok) continue;
        for (k = 0; k < cells.length; k++) occ[cells[k]] = true;
        ships.push({ len: len, cells: cells, hits: 0, sunk: false });
        break;
      }
    }
    return { ships: ships, occ: occ };
  }

  /* ---------- enemy hunt/target gun (AUTHORITY ONLY, per player) ---------- */

  function mkGun(rng) {
    var queue = [], tried = {};
    function take() {
      for (;;) {
        while (queue.length) {
          var q = queue.shift();
          if (!tried[q]) { tried[q] = true; return q; }
        }
        var v = (rng() * GRID * GRID) | 0;
        if (!tried[v]) { tried[v] = true; return v; }
      }
    }
    return {
      fire: take,
      onHit: function (idx) {
        var r = (idx / GRID) | 0, c = idx % GRID;
        var ns = [], d, rr, cc;
        for (d = 0; d < 4; d++) {
          rr = r + (d === 0 ? -1 : d === 1 ? 1 : 0);
          cc = c + (d === 2 ? -1 : d === 3 ? 1 : 0);
          if (rr >= 0 && cc >= 0 && rr < GRID && cc < GRID && !tried[rr * GRID + cc]) {
            ns.push(rr * GRID + cc);
          }
        }
        for (var i = ns.length - 1; i > 0; i--) {
          var j = (rng() * (i + 1)) | 0, t = ns[i]; ns[i] = ns[j]; ns[j] = t;
        }
        queue.push.apply(queue, ns);
      }
    };
  }

  /* ---------- registration ---------- */

  register({
    id: 'battleship-volley',
    name: 'SALVOS',
    weight: 4,
    mount: function (container, ctx) {
      return new Promise(function (resolve) {
        var diff = diffFor(ctx.depth);
        var salvosTotal = SALVOS_BY_DIFF[diff - 1];
        var shellsPerEnemySalvo = diff >= 5 ? 2 : (diff >= 3 ? 1 : 0);
        var mp = !!ctx.mp;
        var net = (window.IQ && window.IQ.Net) || null;
        var roundNum = (ctx.round != null ? ctx.round : 0) | 0;
        var motionOff = flag('IQB_MOTION');
        var myKey = mp && net ? (net.myUid() || 'me') : 'me';

        /* ---------- dom ---------- */
        var wrap = document.createElement('div');
        wrap.className = 'iq-salvos';
        var head = document.createElement('div');
        head.className = 'iq-salvos-head';
        var title = document.createElement('span');
        title.textContent = 'SALVOS · DEPTH ' + (ctx.depth | 0);
        var meta = document.createElement('span');
        meta.className = 'iq-salvos-meta';
        meta.textContent = 'tap enemy water · or type a1…h8 + enter';
        head.appendChild(title); head.appendChild(meta);
        var canvas = document.createElement('canvas');
        var foot = document.createElement('div');
        foot.className = 'iq-salvos-foot';
        wrap.appendChild(head); wrap.appendChild(canvas); wrap.appendChild(foot);
        var style = document.createElement('style');
        style.textContent =
          '.iq-salvos{display:flex;flex-direction:column;align-items:center;gap:6px;' +
          'color:#cfe8ff;font-family:monospace;background:#04101e;padding:8px;border-radius:8px}' +
          '.iq-salvos-head{display:flex;justify-content:space-between;width:100%;font-size:13px;' +
          'letter-spacing:1px;color:#7fc4ff}.iq-salvos-meta{color:#4a7a9e;font-size:11px;' +
          'text-align:right}.iq-salvos-foot{font-size:12px;color:#eaf6ff;min-height:16px;' +
          'letter-spacing:1px}.iq-salvos canvas{background:#06182a;border:2px solid #14395a;' +
          'border-radius:4px;touch-action:none;cursor:crosshair}';
        wrap.appendChild(style);
        container.appendChild(wrap);

        /* ---------- boards ---------- */
        // My fleet: dedicated seed stream -> identical on every tab, independent of
        // the host's secret draws (so relayed verdicts always match what you see).
        var mine = placeFleet(mulberry32((ctx.seed | 0) ^ 0x51A105));
        // Enemy secret: lazily created on the AUTHORITY ONLY. Never in a frame.
        var secret = null;
        var guns = {};                      // key -> hunt/target gun (authority)
        var salvoState = {};                // key -> {shots, resolvedThisSalvo}

        function ensureSecret() {
          if (!secret) secret = placeFleet(ctx.rng);
          return secret;
        }
        function gunFor(key) {
          if (!guns[key]) guns[key] = mkGun(mulberry32((((ctx.seed | 0) ^ 0xE44D1) ^ hashStr(key)) | 0));
          return guns[key];
        }

        /* ---------- play state ---------- */
        var enemyMarks = new Array(GRID * GRID);   // undefined | 'miss' | 'hit'
        var myMarks = new Array(GRID * GRID);      // undefined | 'miss' | 'hit'
        var telegraphs = {};                        // idx -> expireAt (perf ms)
        var salvoIndex = 1;
        var shellsLeft = SHELLS_PER_SALVO;
        var hits = 0, sunk = 0, incomingHits = 0;
        var firedKeys = {};                         // idempotence: 'r,c' -> true
        var finished = false, allSunk = false;
        var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        var rafId = 0, capTimer = 0;
        var timeouts = [];
        var netOffs = [];
        var kbBuf = '';
        var phase = 'aim';                          // 'aim' | 'incoming' | 'done'

        function elapsed() {
          return (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
        }
        function later(fn, ms) {
          var id = window.setTimeout(fn, ms);
          timeouts.push(id);
          return id;
        }

        /* ---------- audio (IQB_MUTED-gated, lazily created) ---------- */
        var audioCtx = null;
        function beep(freq, ms) {
          if (flag('IQB_MUTED')) return;
          try {
            if (!audioCtx) {
              var AC = window.AudioContext || window.webkitAudioContext;
              if (!AC) return;
              audioCtx = new AC();
            }
            var o = audioCtx.createOscillator(), g = audioCtx.createGain();
            o.type = 'square'; o.frequency.value = freq;
            g.gain.setValueAtTime(0.04, audioCtx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000);
            o.connect(g).connect(audioCtx.destination);
            o.start(); o.stop(audioCtx.currentTime + ms / 1000);
          } catch (e) { /* never let audio break gameplay */ }
        }

        /* ---------- authority: validate a shot against the secret ---------- */
        function authorityResolve(key, r, c) {
          var sec = ensureSecret();
          var idx = r * GRID + c;
          var hit = sec.occ[idx] === true;
          var sunkLen = 0, wreck = null;
          if (hit) {
            for (var i = 0; i < sec.ships.length; i++) {
              var sh = sec.ships[i];
              if (sh.cells.indexOf(idx) >= 0) {
                sh.hits++;
                if (sh.hits >= sh.len && !sh.sunk) {
                  sh.sunk = true; sunkLen = sh.len; wreck = sh.cells.slice();
                }
                break;
              }
            }
          }
          if (mp && net) {
            net.broadcast({ t: 'stageVerdict', n: roundNum, mode: 'battleship-volley',
              uid: key, r: r, c: c, hit: hit, sunk: sunkLen > 0, len: sunkLen,
              wreck: wreck });
          }
          return { r: r, c: c, hit: hit, sunk: sunkLen > 0, len: sunkLen, wreck: wreck };
        }

        /* ---------- shooter: apply a verdict locally ---------- */
        function applyVerdict(v) {
          if (finished) return;
          var key = v.r + ',' + v.c;
          if (firedKeys[key] === 'done') return;
          firedKeys[key] = 'done';
          var idx = v.r * GRID + v.c;
          enemyMarks[idx] = v.hit ? 'hit' : 'miss';
          if (v.hit) {
            hits++;
            beep(660, 90);
            if (v.sunk) {
              sunk++;
              beep(220, 220);
              // wreck reveal: the verdict carries the sunk ship's cells (public
              // the moment it sinks) — mark them all as hits.
              if (v.wreck && v.wreck.length) {
                for (var wi = 0; wi < v.wreck.length; wi++) enemyMarks[v.wreck[wi]] = 'hit';
              }
            }
          } else {
            beep(180, 60);
          }
          var st = salvoState.__local || (salvoState.__local = { resolved: 0 });
          st.resolved++;
          updateFoot();
          if (v.hit && sunk >= FLEET.length) { allSunk = true; later(finish, 650); return; }
          if (st.resolved >= SHELLS_PER_SALVO) beginIncoming();
        }

        /* ---------- enemy salvo (authority computes, everyone renders) ---------- */
        function beginIncoming() {
          if (finished || allSunk) return;
          if (!mp) {
            presentIncoming(computeIncoming('me'));
            return;
          }
          // MP: whoever finished their shells requests the enemy salvo through the
          // same client->host pipe — the frame lands on the authority (the host's
          // own sends loop back via IQ.Net.send), which computes and broadcasts.
          if (net) {
            net.send({ t: 'stageSalvoReq', n: roundNum, mode: 'battleship-volley',
              uid: myKey });
          } else {
            presentIncoming([]);   // degraded transport: silent sea, keep moving
          }
        }
        function computeIncoming(key) {
          if (shellsPerEnemySalvo === 0) return [];
          var gun = gunFor(key);
          var st = salvoState[key] || (salvoState[key] = {});
          var out = [], i;
          for (i = 0; i < shellsPerEnemySalvo; i++) {
            var idx = gun.fire();
            var hit = mine.occ[idx] === true;
            if (hit) gun.onHit(idx);
            out.push({ r: (idx / GRID) | 0, c: idx % GRID, hit: hit });
          }
          return out;
        }
        function presentIncoming(cells) {
          phase = 'incoming';
          updateFoot();
          var i;
          for (i = 0; i < cells.length; i++) {
            (function (shell, slot) {
              var at = slot * 900;
              later(function () {
                var idx = shell.r * GRID + shell.c;
                telegraphs[idx] = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 400;
                beep(shell.hit ? 330 : 520, 120);
              }, at);
              later(function () {
                var idx = shell.r * GRID + shell.c;
                delete telegraphs[idx];
                myMarks[idx] = shell.hit ? 'hit' : 'miss';
                if (shell.hit) {
                  incomingHits++;
                  beep(140, 200);
                  updateFoot();
                }
              }, at + 400);
            })(cells[i], i);
          }
          later(function () {
            if (finished || allSunk) return;
            if (salvoIndex < salvosTotal) {
              salvoIndex++;
              shellsLeft = SHELLS_PER_SALVO;
              salvoState.__local = { resolved: 0 };
              phase = 'aim';
              updateFoot();
            } else {
              finish();
            }
          }, cells.length * 900 + 550);
        }

        /* ---------- firing ---------- */
        function fireShell(r, c) {
          if (finished || phase !== 'aim' || shellsLeft <= 0) return false;
          if (r < 0 || c < 0 || r >= GRID || c >= GRID) return false;
          var key = r + ',' + c;
          if (firedKeys[key]) return false;
          firedKeys[key] = 'sent';
          shellsLeft--;
          updateFoot();
          if (!mp) {
            later(function () { applyVerdict(authorityResolve('me', r, c)); }, 120);
          } else if (net) {
            sendShot(r, c, true);
          } else {
            // degraded MP (no transport): treat as silent water, keep round moving
            later(function () { applyVerdict({ r: r, c: c, hit: false, sunk: false, len: 0 }); }, 400);
          }
          return true;
        }
        function sendShot(r, c, allowRetry) {
          var payload = { t: 'stageShot', n: roundNum, mode: 'battleship-volley',
            uid: myKey, r: r, c: c };
          var got = false;
          var offs = [
            net.on('stageVerdict', function (m) {
              if (m && m.uid === myKey && m.n === roundNum && m.r === r && m.c === c) {
                got = true;
                applyVerdict(m);
                offs[0](); offs[1]();
              }
            })
          ];
          offs.push(window.setTimeout(function () {
            offs[0]();
            if (!got && allowRetry) sendShot(r, c, false);   // idempotent on the host
          }, VERDICT_TIMEOUT_MS));
          netOffs.push(offs[0]);
          timeouts.push(offs[1]);
          net.send(payload);
        }

        /* ---------- MP wiring ---------- */
        if (mp && net) {
          netOffs.push(net.on('stageShot', function (m) {
            // Fires only where client->host frames land: the authority.
            if (!m || m.mode !== 'battleship-volley' || m.n !== roundNum) return;
            var r = m.r | 0, c = m.c | 0;
            if (r < 0 || c < 0 || r >= GRID || c >= GRID) return;
            var key = String(m.uid || 'me');
            authorityResolve(key, r, c);   // idempotent: verdicts are pure lookups
          }));
          netOffs.push(net.on('stageSalvoReq', function (m) {
            // Client->host frame: lands on the authority only. Compute that
            // player's enemy salvo against the seeded mirror fleet, broadcast it.
            if (!m || m.mode !== 'battleship-volley' || m.n !== roundNum) return;
            var key = String(m.uid || 'me');
            var cells = computeIncoming(key);
            net.broadcast({ t: 'stageSalvo', n: roundNum, mode: 'battleship-volley',
              uid: key, cells: cells });
          }));
          netOffs.push(net.on('stageSalvo', function (m) {
            if (!m || m.mode !== 'battleship-volley' || m.n !== roundNum) return;
            if (m.uid !== myKey || !m.cells) return;         // someone else's incoming fire
            presentIncoming(m.cells);
          }));
          netOffs.push(net.on('stageVerdict', function (m) {
            if (!m || m.uid !== myKey || m.n !== roundNum) return;
            // Safety net for retries whose dedicated listener already died.
            var key = m.r + ',' + m.c;
            if (firedKeys[key] === 'sent') applyVerdict(m);
          }));
        }

        /* ---------- rendering ---------- */
        var cssW = 480, cssH = 260, dpr = 1, geo = null;
        function fit() {
          var w = (container.clientWidth || 500) - 24;
          var h = (container.clientHeight || 320) - 64;
          cssW = Math.max(280, Math.min(w, 720));
          cssH = Math.max(200, Math.min(h, 380));
          dpr = window.devicePixelRatio || 1;
          canvas.width = Math.round(cssW * dpr);
          canvas.height = Math.round(cssH * dpr);
          canvas.style.width = cssW + 'px';
          canvas.style.height = cssH + 'px';
          var pad = 10, label = 14, gap = 18;
          var cellW = (cssW - pad * 2 - gap - label) / (GRID * 2);
          var cellH = (cssH - pad * 2 - label) / GRID;
          var cell = Math.max(10, Math.min(cellW, cellH, 34));
          geo = {
            cell: cell, pad: pad, label: label, gap: gap,
            ex: pad, ey: pad + label,
            mx: pad + GRID * cell + gap, my: pad + label
          };
        }
        function cellRect(gx, gy, r, c) {
          return { x: gx + c * geo.cell, y: gy + r * geo.cell, w: geo.cell, h: geo.cell };
        }
        function drawGrid(g, gx, gy, marks, showShips, now) {
          var r, c, idx;
          for (r = 0; r < GRID; r++) {
            for (c = 0; c < GRID; c++) {
              idx = r * GRID + c;
              var rect = cellRect(gx, gy, r, c);
              g.fillStyle = '#0a2233';
              g.fillRect(rect.x, rect.y, geo.cell - 1, geo.cell - 1);
              g.strokeStyle = '#1d4a66';
              g.lineWidth = 1;
              g.strokeRect(rect.x + 0.5, rect.y + 0.5, geo.cell - 2, geo.cell - 2);
              var m = marks[idx];
              var cx = rect.x + geo.cell / 2, cy = rect.y + geo.cell / 2;
              if (showShips && mine.occ[idx]) {
                g.fillStyle = '#2f9e6e';
                g.fillRect(rect.x + 2, rect.y + 2, geo.cell - 5, geo.cell - 5);
              }
              if (m === 'miss') {
                g.fillStyle = '#6fa8c9';
                g.beginPath();
                g.arc(cx, cy, Math.max(1.5, geo.cell * 0.11), 0, Math.PI * 2);
                g.fill();
              } else if (m === 'hit') {
                // colorblind-safe: filled ring PLUS X glyph, never hue alone
                g.strokeStyle = '#ff4757';
                g.lineWidth = Math.max(1.5, geo.cell * 0.12);
                g.beginPath();
                g.arc(cx, cy, geo.cell * 0.32, 0, Math.PI * 2);
                g.stroke();
                var arm = geo.cell * 0.22;
                g.beginPath();
                g.moveTo(cx - arm, cy - arm); g.lineTo(cx + arm, cy + arm);
                g.moveTo(cx + arm, cy - arm); g.lineTo(cx - arm, cy + arm);
                g.stroke();
              }
            }
          }
          // live telegraph reticles (amber, pulsing once — localized, 400ms)
          for (idx in telegraphs) {
            if (!Object.prototype.hasOwnProperty.call(telegraphs, idx)) continue;
            if (telegraphs[idx] < now) { delete telegraphs[idx]; continue; }
            var tr = (idx / GRID) | 0, tc = idx % GRID;
            var trect = cellRect(gx, gy, tr, tc);
            g.strokeStyle = motionOff ? '#ffb142' :
              (Math.floor(now / 100) % 2 ? '#ffb142' : '#ff8c00');
            g.lineWidth = 2;
            g.strokeRect(trect.x + 1, trect.y + 1, geo.cell - 3, geo.cell - 3);
          }
        }
        function draw(now) {
          if (!geo) return;
          var g = canvas.getContext('2d');
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          g.fillStyle = '#06182a';
          g.fillRect(0, 0, cssW, cssH);
          g.font = '12px monospace';
          g.fillStyle = '#7fc4ff';
          g.fillText('ENEMY WATERS', geo.ex, geo.ey - 3);
          g.fillText('YOUR WATERS', geo.mx, geo.my - 3);
          drawGrid(g, geo.ex, geo.ey, enemyMarks, false, now);
          drawGrid(g, geo.mx, geo.my, myMarks, true, now);
        }
        function updateFoot() {
          if (finished) return;
          var afloat = FLEET.length - sunk;
          var warn = afloat > 0 && diff >= 3 ? ' — THEY WILL BITE' : '';
          foot.textContent = phase === 'incoming'
            ? 'INCOMING FIRE'
            : 'SALVO ' + salvoIndex + '/' + salvosTotal + ' · SHELLS ' + shellsLeft +
              ' · HITS ' + hits + '/9 · HUNTERS ' + afloat + warn +
              ' · ' + Math.max(0, Math.ceil((CAP_MS - elapsed()) / 1000)) + 's';
        }

        /* ---------- input ---------- */
        function canvasCell(ev) {
          if (!geo) return null;
          var rect = canvas.getBoundingClientRect();
          var px = ev.clientX - rect.left, py = ev.clientY - rect.top;
          var grids = [[geo.ex, geo.ey]];
          for (var i = 0; i < grids.length; i++) {
            var gx = grids[i][0], gy = grids[i][1];
            var c = Math.floor((px - gx) / geo.cell);
            var r = Math.floor((py - gy) / geo.cell);
            if (r >= 0 && c >= 0 && r < GRID && c < GRID &&
                px >= gx && py >= gy) return { r: r, c: c };
          }
          return null;
        }
        function onPointer(e) {
          var cell = canvasCell(e);
          if (cell) { e.preventDefault(); fireShell(cell.r, cell.c); }
        }
        function onKey(e) {
          if (e.code === 'Enter') {
            e.preventDefault();
            var m = /^([a-h])([1-8])$/.exec(kbBuf);
            if (m) fireShell(Number(m[2]) - 1, m[1].charCodeAt(0) - 97);
            kbBuf = '';
            updateFoot();
            return;
          }
          if (e.key === 'Backspace') { kbBuf = kbBuf.slice(0, -1); updateFoot(); return; }
          var k = e.key.toLowerCase();
          if ((k >= 'a' && k <= 'h') || (k >= '1' && k <= '8')) {
            if (kbBuf.length < 2) kbBuf += k;
            meta.textContent = 'fire: ' + (kbBuf || '?') + ' + enter';
            e.preventDefault();
          }
        }

        /* ---------- resolution ---------- */
        function finish() {
          if (finished) return;
          finished = true;
          phase = 'done';
          window.clearTimeout(capTimer);
          cancelAnimationFrame(rafId);
          for (var i = 0; i < timeouts.length; i++) window.clearTimeout(timeouts[i]);
          for (i = 0; i < netOffs.length; i++) {
            if (typeof netOffs[i] === 'function') netOffs[i]();
          }
          window.removeEventListener('keydown', onKey, true);
          window.removeEventListener('resize', fit);
          canvas.removeEventListener('pointerdown', onPointer);
          var afloat = FLEET.length - sunk;
          var correct = allSunk ? true : (hits >= 5 ? null : false);
          var points = Math.max(0,
            40 * hits + 120 * sunk + (allSunk ? 60 : 0) - 20 * incomingHits);
          var hpDelta = Math.max(-15,
            -5 * afloat - (diff >= 5 ? 5 * incomingHits : 0));
          var names = ['ZERO', 'ONE', 'TWO', 'THREE'];
          var summary = allSunk
            ? 'FLEET SUNK — 9/9'
            : names[afloat] + ' HUNTER' + (afloat === 1 ? '' : 'S') + ' REMAIN';
          foot.textContent = summary;
          resolve({ kind: 'score', correct: correct, points: points,
            hpDelta: hpDelta, summary: summary });
        }

        /* ---------- loop ---------- */
        function raf() {
          if (finished) return;
          draw(typeof performance !== 'undefined' ? performance.now() : Date.now());
          try {
            var frac = Math.max(0, 1 - elapsed() / CAP_MS);
            var tf = document.getElementById('timer-fill');
            if (tf) tf.style.transform = 'scaleX(' + frac + ')';
            var tn = document.getElementById('timer-num');
            if (tn) tn.textContent = String(Math.ceil(Math.max(0, (CAP_MS - elapsed()) / 1000)));
          } catch (e) { /* topbar chrome is optional */ }
          rafId = window.requestAnimationFrame(raf);
        }

        window.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', fit);
        canvas.addEventListener('pointerdown', onPointer);
        capTimer = window.setTimeout(finish, CAP_MS);
        salvoState.__local = { resolved: 0 };

        /* ---------- smoke / self-play hook ---------- */
        window.__SALVOS__ = {
          fire: function (r, c) { return fireShell(r | 0, c | 0); },
          state: function () {
            return {
              salvo: salvoIndex, salvos: salvosTotal, shellsLeft: shellsLeft,
              hits: hits, sunk: sunk, afloat: FLEET.length - sunk,
              incomingHits: incomingHits, phase: phase, done: finished,
              elapsedMs: Math.round(elapsed())
            };
          },
          finish: finish,
          // Gated dev peek: ONLY present when window.__IQ_SMOKE__ is set before
          // load; lets the smoke harness drive the allSunk win-path honestly.
          peek: window.__IQ_SMOKE__
            ? function () {
                var s = ensureSecret();
                return s.ships.map(function (sh) { return sh.cells.slice(); });
              }
            : null,
        };

        fit();
        updateFoot();
        rafId = window.requestAnimationFrame(raf);
      });
    }
  });
})();
