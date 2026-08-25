/**
 * modes/hypercube606.js — HYPERCUBE 606D: the joke that fights back.
 *
 * Design doc: research/modes-themed-design.md §7.
 * Bind: `jester-court` (pack-chaos, chaotic) primary. Consumes the legacy
 * dims.js '606d' flag as its trigger when present (ctx.dim or ctx.frame.dim ===
 * '606d'); otherwise eligible normally through the director. The dims cosmetic
 * background hypercube graduates into this full takeover stage.
 *
 * Registration shape (research/mode-contract.md §1):
 *   window.IQ.Stage.register({
 *     id: 'hypercube606', name: 'HYPERCUBE 606D', weight: 8, net: 'seed',
 *     worlds: ['jester-court'], aligns: ['chaotic'],
 *     mount(container, ctx) -> Promise<StageResult>
 *   });
 * If window.IQ.Stage is absent the definition queues onto window.__stagePending.
 *
 * Controls:
 *   - DRAG to steer the rotation (changes which vertices overlap on screen).
 *   - CLICK an option-bearing vertex to answer.
 *   - H — hyper-goggles, ONCE per round: unfolds the tesseract into its flat
 *     readable 2x4 cube-net for 5 s, costing 4 s of round timer.
 *
 * Geometry: a REAL tesseract — 16 vertices / 32 edges — rotated about two 4D
 * planes (XW + YZ) at constant seeded rates that are a closed-form function of
 * the stage clock (pure seeded-sim: identical pixels on every peer; drag and
 * goggles are local input layered on top). Vertices project with perspective
 * divide on w (near vertices large/bright, far small/dim). Option labels stay
 * rigidly attached to their assigned vertex through every rotation.
 *
 * Anti-leak: the true option occupies a vertex assigned at stage start AFTER
 * answer generation; nothing reads engine reveal state — the shuffled option set
 * is all this stage ever knows.
 *
 * ctx fields consumed:
 *   depth      -> rotation rate x(1+0.07*min(depth-1,12)); depth>=8 adds a
 *                 counter-rotating REAR wireframe (cosmetic decoys ONLY — hit-
 *                 testing stays exclusive to the option-bearing front cell)
 *   rng        -> ONLY randomness source (rates, phases, vertex assignment)
 *   seed       -> identity of the deterministic challenge
 *   mp         -> seed-sync note
 *   timerLen   -> stage budget (capped 45 s)
 *   world/align/hp/score/streak -> header strip, read-only, never mutated
 *
 * StageResult (design §7 table):
 *   correct, no goggles -> true, base+50, '4D NATIVE'
 *   correct             -> true, base,   'VERTEX FOUND'
 *   wrong               -> false, 0, hpDelta 0, 'LOST IN THE FOURTH AXIS'
 *   timeout             -> null, 0, hpDelta -5, 'STILL ROTATING'
 *
 * Fairness rails: labels never render below an 11 px font clamp; far-side
 * vertices dim but clickable (generous hit radius); IQB_MOTION off => static
 * wireframe at a fixed disorienting-but-readable angle, goggles FREE, bonus
 * disabled; IQB_MUTED gates synth audio; no fullscreen flashes.
 */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : globalThis;

  var CAP_MS = 45000;
  var GOGGLES_MS = 5000;
  var GOGGLES_COST_MS = 4000;
  var FONT_MIN = 11;
  var HIT_MIN_PX = 26;
  var D4 = 3, D3 = 6;

  /* ---------- gates ---------- */
  function motionOn() {
    try {
      var v = root.localStorage && root.localStorage.getItem('IQB_MOTION');
      if (v != null && JSON.parse(v) === false) return false;
    } catch (e) {}
    try {
      if (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    } catch (e) {}
    return true;
  }
  function muted() {
    try { return JSON.parse(root.localStorage.getItem('IQB_MUTED')) === true || root.localStorage.getItem('IQB_MUTED') === '1'; }
    catch (e) { return false; }
  }

  /* ======================================================================
   * PURE CORE — exported for node smoke.
   * ====================================================================== */
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  /** All 16 tesseract vertices as sign vectors. */
  var VERTICES = [];
  (function () {
    for (var i = 0; i < 16; i++) {
      VERTICES.push([
        (i & 1) ? 1 : -1, (i & 2) ? 1 : -1,
        (i & 4) ? 1 : -1, (i & 8) ? 1 : -1
      ]);
    }
  })();
  /** 32 edges: vertex pairs differing in exactly one coordinate. */
  var EDGES = [];
  (function () {
    for (var i = 0; i < 16; i++) {
      for (var j = i + 1; j < 16; j++) {
        var diff = i ^ j;
        if (diff === 1 || diff === 2 || diff === 4 || diff === 8) EDGES.push([i, j]);
      }
    }
  })();

  /** Rotation rate multiplier: x(1 + 0.07*min(depth-1,12)). */
  function rateMulFor(depth) { return 1 + 0.07 * clamp((depth | 0) - 1, 0, 12); }

  /**
   * Rotate a 4-point through XW plane by ax, YZ plane by ay, then project
   * 4D->3D (perspective divide on w) and 3D->2D (divide on z).
   * Pure closed form — identical pixels on every peer for identical clocks.
   */
  function project(v, ax, ay) {
    var c1 = Math.cos(ax), s1 = Math.sin(ax), c2 = Math.cos(ay), s2 = Math.sin(ay);
    var x = v[0], y = v[1], z = v[2], w = v[3];
    var x1 = x * c1 - w * s1, w1 = x * s1 + w * c1;      // XW plane
    var y1 = y * c2 - z * s2, z1 = y * s2 + z * c2;      // YZ plane
    var p4 = D4 / (D4 - w1);                              // 4D->3D divide on w
    var X = x1 * p4, Y = y1 * p4, Z = z1 * p4;
    var p3 = D3 / (D3 - Z);                               // 3D->2D divide on z
    return { sx: X * p3, sy: Y * p3, near: w1, scale: p4 }; // near: [-2..2]
  }

  /** Assign the 8 options onto 8 distinct vertices (seeded shuffle). */
  function assignVertices(rng) {
    var order = [];
    for (var i = 0; i < 16; i++) order.push(i);
    for (var k = order.length - 1; k > 0; k--) {
      var j = Math.floor(rng() * (k + 1));
      var tmp = order[k]; order[k] = order[j]; order[j] = tmp;
    }
    return order.slice(0, 8);
  }

  /** Legibility clamp for projected label fonts. */
  function legible(px) { return Math.max(FONT_MIN, Math.round(px)); }

  /* ---------- deterministic mini-generator ---------- */
  function genQuestion(rng) {
    var q, ans;
    if (rng() < 0.5) {
      var a = 2 + Math.floor(rng() * 14), d = 2 + Math.floor(rng() * 9);
      q = a + ' · ' + (a + d) + ' · ' + (a + 2 * d) + ' · ' + (a + 3 * d) + ' · ?';
      ans = a + 4 * d;
    } else {
      var x = 2 + Math.floor(rng() * 11), b = 1 + Math.floor(rng() * 19), m = 2 + Math.floor(rng() * 5);
      q = m + 'x + ' + b + ' = ' + (m * x + b) + '  ·  x = ?';
      ans = x;
    }
    var opts = [String(ans)];
    while (opts.length < 8) {
      var delta = 1 + Math.floor(rng() * 11);
      var cand = String(rng() < 0.5 ? ans - delta : ans + delta);
      if (opts.indexOf(cand) < 0) opts.push(cand);
    }
    var correctIdx = 0;
    for (var i = opts.length - 1; i > 0; i--) {
      var jj = Math.floor(rng() * (i + 1));
      var tmp2 = opts[i]; opts[i] = opts[jj]; opts[jj] = tmp2;
      if (correctIdx === i) correctIdx = jj;
      else if (correctIdx === jj) correctIdx = i;
    }
    return { q: q, opts: opts, correctIdx: correctIdx };
  }

  /* ---------- scoring mapping (design §7 table) ---------- */
  function scoreFor(res) {
    if (res.correct === true) {
      var native = !res.gogglesUsed && res.motionOn;
      return {
        correct: true,
        points: native ? 150 : 100,
        hpDelta: 0,
        summary: native ? '4D NATIVE' : 'VERTEX FOUND'
      };
    }
    if (res.correct === false) {
      return { correct: false, points: 0, hpDelta: 0, summary: 'LOST IN THE FOURTH AXIS' };
    }
    return { correct: null, points: 0, hpDelta: -5, summary: 'STILL ROTATING' };
  }

  /* ====================================================================== */

  function def() {
    return {
      id: 'hypercube606',
      name: 'HYPERCUBE 606D',
      weight: 8,
      net: 'seed',
      worlds: ['jester-court'],
      aligns: ['chaotic'],
      mount: function (container, ctx) {
        return new Promise(function (resolve) {
          var depth = Math.max(1, ctx.depth | 0);
          var motion = motionOn();
          var mul = rateMulFor(depth);

          /* dims '606d' trigger consumption (legacy flag, when present) */
          var triggered606 = false;
          try {
            if (ctx.dim === '606d') triggered606 = true;
            else if (ctx.frame && ctx.frame.dim === '606d') triggered606 = true;
          } catch (e) {}

          /* question + vertex assignment (anti-leak ordering) */
          var quiz = genQuestion(ctx.rng);
          var vertOfOpt = assignVertices(ctx.rng);

          /* seeded base rotation rates/phases (closed-form of clock) */
          var wxw = (0.42 + ctx.rng() * 0.16) * mul * (ctx.rng() < 0.5 ? 1 : -1);
          var wyz = (0.27 + ctx.rng() * 0.12) * mul * (ctx.rng() < 0.5 ? 1 : -1);
          var phx = ctx.rng() * Math.PI * 2, phy = ctx.rng() * Math.PI * 2;
          var STATIC_AX = 0.9, STATIC_AY = 0.55;       // motion-off fixed angle

          /* ---------- dom ---------- */
          var wrap = document.createElement('div');
          wrap.className = 'stage-view';
          wrap.setAttribute('data-stage', 'hypercube606');
          var head = document.createElement('div');
          head.className = 'iq-hc-head';
          var title = document.createElement('span');
          title.textContent = 'HYPERCUBE 606D · DEPTH ' + depth +
            (triggered606 ? ' · 606D TRIGGER' : '');
          var meta = document.createElement('span');
          meta.className = 'iq-hc-meta';
          meta.textContent = 'drag to steer · click your answer\'s VERTEX' +
            (ctx.mp && ctx.mp.on ? ' · seed-synced pixels' : '');
          head.appendChild(title); head.appendChild(meta);

          var boardWrap = document.createElement('div');
          boardWrap.className = 'iq-hc-board';
          var cv = document.createElement('canvas');
          cv.style.touchAction = 'none';
          boardWrap.appendChild(cv);

          var qEl = document.createElement('div');
          qEl.className = 'iq-hc-q';
          qEl.textContent = quiz.q;

          var foot = document.createElement('div');
          foot.className = 'iq-hc-foot';
          foot.textContent = 'H = HYPER-GOGGLES (once' + (motion ? ', -4s' : ', free') + ')';

          wrap.appendChild(head); wrap.appendChild(boardWrap);
          wrap.appendChild(qEl); wrap.appendChild(foot);
          var style = document.createElement('style');
          style.textContent =
            '.stage-view[data-stage=hypercube606]{position:absolute;inset:0;display:flex;' +
            'flex-direction:column;align-items:center;gap:8px;padding:8px;' +
            "font-family:'Oxanium',monospace;background:#0b0716;color:#ffe9b8}" +
            '.iq-hc-head{display:flex;gap:16px;font-size:13px;letter-spacing:.2em;' +
            'color:#ffd75e;text-transform:uppercase}.iq-hc-meta{font-size:11px;color:#b39ddb}' +
            '.iq-hc-board{position:relative;width:min(92vw,600px);flex:1;min-height:140px;' +
            'border:1px solid #3a2f6b;border-radius:10px;overflow:hidden;cursor:grab}' +
            '.iq-hc-board canvas{width:100%;height:100%;display:block}' +
            '.iq-hc-q{font-size:16px;color:#fff}' +
            '.iq-hc-foot{font-size:11px;color:#9f92cf;min-height:15px;letter-spacing:.14em}' +
            '.iq-hc-net{position:absolute;inset:0;display:grid;' +
            'grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(2,1fr);gap:6px;' +
            'padding:8px;background:rgba(11,7,22,.94)}' +
            '.iq-hc-cell{display:flex;align-items:center;justify-content:center;gap:8px;' +
            'border:2px solid #6a5acd;border-radius:8px;color:#fff;font-size:16px;' +
            'cursor:pointer;background:#171034}' +
            '.iq-hc-cell:hover{background:#251a52}';
          wrap.appendChild(style);
          container.appendChild(wrap);

          /* ---------- audio ---------- */
          var actx = null;
          function beep(freq, ms) {
            if (muted()) return;
            try {
              if (!actx) {
                var AC = root.AudioContext || root.webkitAudioContext;
                if (!AC) return;
                actx = new AC();
              }
              var o = actx.createOscillator(), gn = actx.createGain();
              o.type = 'sawtooth'; o.frequency.value = freq;
              gn.gain.setValueAtTime(0.04, actx.currentTime);
              gn.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + ms / 1000);
              o.connect(gn).connect(actx.destination);
              o.start(); o.stop(actx.currentTime + ms / 1000);
            } catch (e) {}
          }

          function fitBoard() {
            var r = boardWrap.getBoundingClientRect();
            cv.width = Math.max(140, Math.round(r.width));
            cv.height = Math.max(120, Math.round(r.height));
          }
          fitBoard();

          /* ---------- state machine ---------- */
          var finished = false, resolved = false;
          var gogglesUsed = false, gogglesUntil = 0, netEl = null;
          var penaltyMs = 0;                       // goggles timer cost accrues here
          var budgetMs = Math.min((ctx.timerLen | 0) > 0 ? ctx.timerLen * 1000 : CAP_MS, CAP_MS);
          var nowFn = function () { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); };
          var t0 = nowFn();
          var rafId = 0;
          var viewAx = 0, viewAy = 0;              // drag steering offsets (local)
          var dragging = false, dragMoved = 0, lastX = 0, lastY = 0;

          function remainingMs() { return budgetMs - (nowFn() - t0) - penaltyMs; }
          function baseAngles(tSec) {
            if (!motion) return { ax: STATIC_AX, ay: STATIC_AY };
            return { ax: phx + wxw * tSec, ay: phy + wyz * tSec };
          }

          function projected() {
            var t = (nowFn() - t0) / 1000;
            var ang = baseAngles(t);
            var ax = ang.ax + viewAx, ay = ang.ay + viewAy;
            var W = cv.width, H = cv.height;
            var sc = Math.min(W, H) * 0.21;
            var cx = W / 2, cy = H / 2;
            var pts = [];
            for (var i = 0; i < 16; i++) {
              var p = project(VERTICES[i], ax, ay);
              pts.push({
                x: cx + p.sx * sc,
                y: cy + p.sy * sc,
                near: p.near,
                fs: clamp((p.near + 2.4) / 4.4, 0, 1)   // 0 far .. 1 near
              });
            }
            return pts;
          }

          function draw(g, pts, alpha, edgeCol) {
            g.strokeStyle = edgeCol;
            g.lineWidth = Math.max(1, alpha * 2.2);
            for (var e = 0; e < EDGES.length; e++) {
              var a = pts[EDGES[e][0]], b = pts[EDGES[e][1]];
              g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
            }
          }

          function loop() {
            if (finished) return;
            var rem = remainingMs();
            if (rem <= 0) { finish(scoreFor({ correct: null })); return; }

            var g = cv.getContext('2d');
            g.fillStyle = '#0b0716';
            g.fillRect(0, 0, cv.width, cv.height);
            var pts = projected();

            // depth >= 8: counter-rotating REAR wireframe — cosmetic decoys only
            if (depth >= 8 && motion) {
              var t2 = -(nowFn() - t0) / 1000;
              var backPts = [];
              var sc = Math.min(cv.width, cv.height) * 0.21 * 0.68;
              var cx = cv.width / 2, cy = cv.height / 2;
              for (var bi = 0; bi < 16; bi++) {
                var bp = project(VERTICES[bi], -STATIC_AX * 0 + phx - wxw * t2, phy - wyz * t2);
                backPts.push({ x: cx + bp.sx * sc, y: cy + bp.sy * sc });
              }
              draw(g, backPts, 0.18, '#4a3f85');
            }

            draw(g, pts, 1, '#7c6ff0');

            // option labels rigidly attached to their vertices
            for (var oi = 0; oi < 8; oi++) {
              var pt = pts[vertOfOpt[oi]];
              var f = pt.fs;
              g.globalAlpha = 0.45 + 0.55 * f;           // far side dim BUT clickable
              g.fillStyle = f > 0.45 ? '#ffe9b8' : '#c9b6ff';
              var pxSize = legible(9 + 9 * f);
              g.font = 'bold ' + pxSize + "px 'Oxanium',monospace";
              g.textAlign = 'center';
              g.fillText(quiz.opts[oi], pt.x, pt.y - 12 - 8 * f);
              g.beginPath(); g.arc(pt.x, pt.y, 4 + 3 * f, 0, Math.PI * 2);
              g.fillStyle = f > 0.45 ? '#ffd75e' : '#8f86c2';
              g.fill();
              g.globalAlpha = 1;
            }

            foot.textContent = gogglesActive()
              ? 'HYPER-GOGGLES — flat net readable · ' +
                Math.ceil((gogglesUntil - nowFn()) / 1000) + 's'
              : 'H = HYPER-GOGGLES (' + (gogglesUsed ? 'spent' :
                  (motion ? 'once, -4s' : 'free')) + ') · ' + Math.ceil(rem / 1000) + 's';

            rafId = root.requestAnimationFrame(loop);
          }

          function gogglesActive() { return nowFn() < gogglesUntil; }

          /** Unfold into the flat 8-cube net (readable 2x4 layout). */
          function openGoggles() {
            if (finished || gogglesUsed || gogglesActive()) return false;
            gogglesUsed = true;
            if (motion) penaltyMs += GOGGLES_COST_MS;    // free under motion gate
            gogglesUntil = nowFn() + GOGGLES_MS;
            beep(300, 90);
            netEl = document.createElement('div');
            netEl.className = 'iq-hc-net';
            for (var i = 0; i < 8; i++) {
              (function (idx) {
                var cell = document.createElement('button');
                cell.className = 'iq-hc-cell';
                cell.textContent = quiz.opts[idx];
                cell.addEventListener('click', function () { answer(idx); });
                netEl.appendChild(cell);
              })(i);
            }
            boardWrap.appendChild(netEl);
            root.setTimeout(closeGoggles, GOGGLES_MS);
            return true;
          }
          function closeGoggles() {
            if (netEl && netEl.parentNode) netEl.parentNode.removeChild(netEl);
            netEl = null;
          }

          function answer(idx) {
            if (finished) return;
            var right = idx === quiz.correctIdx;
            beep(right ? 880 : 160, right ? 80 : 170);
            finish(scoreFor({ correct: right, gogglesUsed: gogglesUsed, motionOn: motion }));
          }

          function finish(result) {
            if (finished) return;
            finished = true;
            closeGoggles();
            root.clearTimeout(watchdog);
            root.cancelAnimationFrame(rafId);
            root.removeEventListener('keydown', onKey, true);
            cv.removeEventListener('pointerdown', onDown);
            root.removeEventListener('pointermove', onMove, true);
            root.removeEventListener('pointerup', onUp, true);
            root.removeEventListener('resize', fitBoard);
            foot.textContent = result.summary;
            if (!resolved) { resolved = true; resolve({
              kind: 'score',
              correct: result.correct,
              points: result.points,
              hpDelta: result.hpDelta,
              summary: result.summary.length <= 48 ? result.summary : result.summary.slice(0, 48)
            }); }
          }

          var watchdog = root.setTimeout(function () {
            finish(scoreFor({ correct: null }));
          }, budgetMs);

          /* ---------- input: drag steering + vertex picking + H goggles ---------- */
          function hitVertex(mx, my) {
            var pts = projected();
            var best = -1, bestD = Infinity;
            for (var oi = 0; oi < 8; oi++) {
              var pt = pts[vertOfOpt[oi]];
              var d = Math.hypot(pt.x - mx, pt.y - my);
              var rad = Math.max(HIT_MIN_PX, 14 + 10 * pt.fs);
              if (d <= rad && d < bestD) { bestD = d; best = oi; }
            }
            return best;
          }
          function localXY(e) {
            var r = cv.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
          }
          function onDown(e) {
            var p = localXY(e);
            dragging = true; dragMoved = 0; lastX = p.x; lastY = p.y;
          }
          function onMove(e) {
            if (!dragging) return;
            var p = localXY(e);
            var dx = p.x - lastX, dy = p.y - lastY;
            dragMoved += Math.abs(dx) + Math.abs(dy);
            viewAy += dx * 0.006;                       // steer which vertices overlap
            viewAx += dy * 0.006;
            lastX = p.x; lastY = p.y;
          }
          function onUp(e) {
            if (!dragging) return;
            dragging = false;
            if (dragMoved < 6) {
              var p = localXY(e);
              var hit = hitVertex(p.x, p.y);
              if (hit >= 0) answer(hit);
            }
          }
          function onKey(e) {
            if (e.code === 'KeyH' || e.key === 'h' || e.key === 'H') {
              e.preventDefault();
              openGoggles();
            }
          }
          cv.addEventListener('pointerdown', onDown);
          root.addEventListener('pointermove', onMove, true);
          root.addEventListener('pointerup', onUp, true);
          root.addEventListener('keydown', onKey, true);
          root.addEventListener('resize', fitBoard);

          root.__HYPERCUBE606__ = {
            pick: function (i) { return answer(i); },
            goggles: openGoggles,
            state: function () {
              return {
                gogglesUsed: gogglesUsed, gogglesActive: gogglesActive(),
                resolved: resolved,
                remainingMs: Math.round(Math.max(0, remainingMs())),
                motionOn: motion
              };
            }
          };

          loop();
        });
      },
      cleanup: function () { /* teardown happens inside finish-once */ }
    };
  }

  /* ======================================================================
   * HEADLESS SMOKE — pure paths only. node -e "..._smoke()"
   * ====================================================================== */
  function _smoke() {
    var checks = [];
    var ok = function (name, cond) { checks.push({ name: name, ok: !!cond }); };
    function mulberry(a) {
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    // 1. geometry integrity
    ok('16 vertices, 32 edges', VERTICES.length === 16 && EDGES.length === 32);
    ok('vertices are +/-1 sign vectors', VERTICES.every(function (v) {
      return v.length === 4 && v.every(function (c) { return c === 1 || c === -1; });
    }));

    // 2. projection sanity across a full revolution
    var finite = true, nearRange = [Infinity, -Infinity];
    for (var step = 0; step < 64; step++) {
      var ax = step / 64 * Math.PI * 2, ay = step / 32;
      for (var vi = 0; vi < 16; vi++) {
        var p = project(VERTICES[vi], ax, ay);
        if (!isFinite(p.sx) || !isFinite(p.sy) || !isFinite(p.near)) finite = false;
        if (p.near < nearRange[0]) nearRange[0] = p.near;
        if (p.near > nearRange[1]) nearRange[1] = p.near;
      }
    }
    ok('projection always finite over full revolutions', finite);
    ok('w coordinate spans (-2,2)', nearRange[0] > -2 && nearRange[1] < 2);
    ok('near vertex projects larger than far vertex',
      project([1, -1, -1, 1], Math.PI / 2, 0).scale > project([-1, -1, -1, 1], Math.PI / 2, 0).scale);

    // 3. determinism: assignment + question from identical seeds
    var aV = assignVertices(mulberry(99)), bV = assignVertices(mulberry(99));
    ok('same seed -> identical vertex assignment', JSON.stringify(aV) === JSON.stringify(bV));
    ok('assignment covers 8 distinct vertices',
      new Set(aV).size === 8 && aV.every(function (v) { return v >= 0 && v < 16; }));
    var qA = genQuestion(mulberry(4242)), qB = genQuestion(mulberry(4242));
    ok('same seed -> identical question', JSON.stringify(qA) === JSON.stringify(qB));
    ok('8 unique options, answer present',
      new Set(qA.opts).size === 8 && qA.opts[qA.correctIdx] != null);
    ok('rate multiplier exact', Math.abs(rateMulFor(13) - 1.84) < 1e-9 && rateMulFor(1) === 1);

    // 4. legibility clamp
    ok('labels clamp at 11px floor', legible(3) === FONT_MIN && legible(40) === 40);

    // 5. scoring mapping (design §7 table)
    var s1 = scoreFor({ correct: true, gogglesUsed: false, motionOn: true }),
      s2 = scoreFor({ correct: true, gogglesUsed: true, motionOn: true }),
      s3 = scoreFor({ correct: true, gogglesUsed: false, motionOn: false }),
      s4 = scoreFor({ correct: false }),
      s5 = scoreFor({ correct: null });
    ok('no-goggles solve earns 4D NATIVE +50', s1.points === 150 && s1.summary === '4D NATIVE');
    ok('goggled solve pays base', s2.points === 100);
    ok('motion-off solve never earns the bonus', s3.points === 100);
    ok('wrong = false/0/hp 0', s4.correct === false && s4.points === 0 && s4.hpDelta === 0);
    ok('timeout = null/-5hp', s5.correct === null && s5.hpDelta === -5);
    [s1, s2, s3, s4, s5].forEach(function (v) { ok('summary <=48: ' + v.summary, v.summary.length <= 48); });

    var fails = checks.filter(function (c) { return !c.ok; });
    checks.forEach(function (c) { console.log((c.ok ? '  ok  ' : 'FAIL  ') + c.name); });
    console.log(fails.length ? '[hypercube606] smoke FAILURES: ' + fails.length : '[hypercube606] smoke: ALL PASS');
    return { ok: fails.length === 0, checks: checks };
  }

  /* ---------- registration (queues when Stage absent) ---------- */
  function register() {
    var d = def();
    if (root.IQ && root.IQ.Stage && typeof root.IQ.Stage.register === 'function') {
      root.IQ.Stage.register(d);
    } else {
      root.__stagePending = root.__stagePending || [];
      root.__stagePending.push(d);
    }
  }

  root.IQ = root.IQ || {};
  root.IQ.Hypercube606 = { _smoke: _smoke };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      _smoke: _smoke,
      project: project, assignVertices: assignVertices, genQuestion: genQuestion,
      scoreFor: scoreFor, legible: legible, rateMulFor: rateMulFor,
      VERTICES: VERTICES, EDGES: EDGES
    };
  }

  register();
})();
