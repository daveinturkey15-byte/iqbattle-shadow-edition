/**
 * modes/snake.js — SERPENT: playable-snake takeover stage (vanilla JS/Canvas, asset-free).
 *
 * Registration shape (research/mode-contract.md v1):
 *   window.IQ.Stage.register({
 *     id: 'snake-playable',
 *     name: 'SERPENT',
 *     weight: 6,
 *     net: 'seed',                       // challenge fully derivable from ctx.seed
 *     mount: function (container, ctx) { ... return Promise.resolve(stageResult); },
 *     cleanup: function () { ... }       // engine timeout/abort teardown (no resolve)
 *   });
 *
 * ctx fields consumed:
 *   depth    (int)        -> step interval: max(55, 90 - (depth-1)*5) ms
 *   rng      (mulberry32) -> ONLY randomness source for anything MP-visible (apple sequence)
 *   seed     (uint32)     -> identity of the deterministic board (see MP note)
 *   mp       ({on,...})   -> when mp.on, shows the seed-sync note in the stage header
 *   timerLen (int)        -> round timer seconds; this stage self-limits to min(45s, timerLen)
 *   audio    (AU bridge)  -> optional .p(name) blips; every call guarded, never required
 *   world/align/hp/score/streak -> displayed read-only in the header strip; never mutated.
 *
 * StageResult fields resolved (RAW points; engine layers streak/curse/hook modifiers):
 *   {
 *     kind:    'score',
 *     correct: true | false // true = survived the time cap OR ate 8 apples ('APEX SERPENT');
 *                           //        false = died (wall hit / self bite).
 *                           // NOTE: the earlier draft used null-on-death; the frozen contract
 *                           // reserves null for NEUTRAL rounds, so deaths report false.
 *     points:  apples*APPLE_PTS[diff] + bonus   // balance pass 2026-08-25:
 *               APPLE_PTS [12,24,40,40,40] · APEX_BONUS [50,70,90,110,130] ·
 *               SURVIVE_BONUS [40,60,80,100,120] · bonus 0 on death.
 *               Solid (apex) play pays ~104-121% of the puzzle baseline
 *               100*diff+40; death forfeits the survival stipend. Verified by
 *               research/bal-retro-snake.js
 *   }
 *   This file NEVER touches window.G, engine internals, or localStorage; the engine applies results.
 *
 * MP determinism (net:'seed'): the ENTIRE apple sequence is drawn from ctx.rng once at mount
 * (Fisher-Yates over the 17x17 grid minus spawn cells), so the same seed yields identical
 * boards on host and clients; inputs are local skill only — like puzzle picks, per-player
 * outcomes differ and the engine relays/sanitizes each StageResult.
 *
 * Self-play / soak hook: while a round is live this file exposes window.__SERPENT__:
 *   .step(dir)   dir: 'up'|'down'|'left'|'right' — queues a turn and advances EXACTLY one
 *   .state()  -> {len, apples, dead, survived, elapsedMs, head:{x,y},
 *                 apple:{x,y}|null, body:[{x,y}]}   // body: smoke/audit only
 *   .finish()    force-end as survival (cap) — fast-forward for soak tests
 */
(function () {
  'use strict';

  var GRID = 17;
  var CAP_MS = 45000;
  /* Scoring economy (balance pass 2026-08-25): payout tracks the engine puzzle
   * baseline good-answer = 100*diff+40, diff = clamp(1+floor(depth/6),1,5).
   * APEX (8 apples) lands ~104-121% of baseline; a surviving median run
   * ~70-90%; death keeps apple credit but forfeits the survival stipend.
   * Idling out the clock is impossible (the serpent never stops moving), so
   * survival is never a farmable optimum. Determinism untouched: these are
   * pure functions of ctx.depth. */
  var DIFF_FOR = function (depth) {
    return Math.max(1, Math.min(5, 1 + Math.floor((depth | 0) / 6)));
  };
  var APPLE_PTS = [0, 12, 24, 40, 40, 40];       // per apple, by diff
  var APEX_BONUS = [0, 50, 70, 90, 110, 130];    // ate APPLES_TO_WIN early
  var SURVIVE_BONUS = [0, 40, 60, 80, 100, 120]; // reached the cap alive
  var APPLES_TO_WIN = 8;
  var active = null; // live-round handle for cleanup()

  function stepMsFor(depth) {
    var d = Math.max(1, depth | 0);
    return Math.max(55, 90 - (d - 1) * 5);
  }

  function stopActive() {
    if (active) active.abort();
  }

  window.IQ && window.IQ.Stage && typeof window.IQ.Stage.register === 'function' &&
  window.IQ.Stage.register({
    id: 'snake-playable',
    name: 'SERPENT',
    goalText: "EAT. GROW. DON'T BITE YOURSELF.",
    controls: 'ARROWS / WASD / SWIPE',
    weight: 6,
    net: 'seed',
    mount: function (container, ctx) {
      return new Promise(function (resolve) {
        /* ---------- dom (inside container only) ---------- */
        var wrap = document.createElement('div');
        wrap.className = 'stage-view iq-serpent';
        wrap.setAttribute('data-stage', 'snake-playable');
        var head = document.createElement('div');
        head.className = 'iq-serpent-head';
        var title = document.createElement('span');
        title.textContent = 'SERPENT · DEPTH ' + (ctx.depth | 0);
        var meta = document.createElement('span');
        meta.className = 'iq-serpent-meta';
        meta.textContent = 'ARROWS / WASD / SWIPE';
        head.appendChild(title);
        head.appendChild(meta);
        var canvas = document.createElement('canvas');
        var foot = document.createElement('div');
        foot.className = 'iq-serpent-foot';
        wrap.appendChild(head);
        wrap.appendChild(canvas);
        var ready = document.createElement('div');
        ready.className = 'iq-serpent-ready';
        ready.textContent = 'SERPENT \u2014 EAT. GROW. DON\u2019T BITE YOURSELF.' +
          ' \u00B7 ARROWS / WASD / SWIPE';
        wrap.appendChild(ready);
        wrap.appendChild(foot);
        container.appendChild(wrap);

        if (ctx.mp && ctx.mp.on) {
          var note = document.createElement('div');
          note.className = 'iq-serpent-note';
          note.textContent = 'SEED-SYNCED BOARD — SAME SEED, SAME APPLES; SKILL IS YOURS';
          wrap.appendChild(note);
        }
        var style = document.createElement('style');
        style.textContent =
          '.stage-view.iq-serpent{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;' +
          'color:#baffcf;font-family:\'Oxanium\',sans-serif;background:#020402;padding:10px;' +
          'border-radius:8px;width:100%;box-sizing:border-box}' +
          '.iq-serpent-head{display:flex;justify-content:space-between;width:100%;max-width:420px;' +
          'font-size:13px;letter-spacing:.2em;color:#00e68a;text-transform:uppercase}' +
          '.iq-serpent-meta{color:#4f7f5f;font-size:11px}' +
          '.iq-serpent-note{font-size:11px;color:#7fbf95;text-align:center}' +
          '.iq-serpent-foot{font-size:12px;color:#eafef0;letter-spacing:.15em;min-height:16px;' +
          'text-transform:uppercase}' +
          '@media (prefers-reduced-motion:none){.iq-serpent canvas{transition:border-color .3s}}' +
          '.iq-serpent canvas{image-rendering:pixelated;background:#060a06;' +
          'border:2px solid #12402a;border-radius:4px;touch-action:none}' +
          '.iq-serpent-ready{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);' +
          'background:rgba(2,6,3,.92);border:1px solid #1d5c39;color:#baffcf;font-size:13px;' +
          'letter-spacing:.15em;padding:10px 16px;border-radius:6px;text-transform:uppercase;' +
          'text-align:center;pointer-events:none;transition:opacity .5s;max-width:90%}';
        wrap.appendChild(style);

        /* ---------- deterministic apple sequence ---------- */
        var startLen = 3;
        var cx = (GRID / 2) | 0;
        var cy = (GRID / 2) | 0;
        var cells = [];
        for (var y = 0; y < GRID; y++) {
          for (var x = 0; x < GRID; x++) {
            if (!(y === cy && x >= cx - (startLen - 1) && x <= cx)) cells.push({ x: x, y: y });
          }
        }
        for (var i = cells.length - 1; i > 0; i--) {
          var j = Math.floor(ctx.rng() * (i + 1));
          var tmp = cells[i]; cells[i] = cells[j]; cells[j] = tmp;
        }
        var applePtr = 0;
        function nextApple(snakeSet) {
          while (applePtr < cells.length) {
            var c = cells[applePtr++];
            if (!snakeSet.has(c.x + ',' + c.y)) return c;
          }
          return null;
        }

        /* ---------- state ---------- */
        var snake = [{ x: cx, y: cy }, { x: cx - 1, y: cy }, { x: cx - 2, y: cy }];
        var dir = { x: 1, y: 0 };
        var queue = [];
        var apple = nextApple(new Set(snake.map(segKey)));
        var applesEaten = 0;
        var dead = false;
        var finished = false;
        var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        var stepMs = stepMsFor(ctx.depth);
        var diff = DIFF_FOR(ctx.depth);
        var capMs = Math.min(CAP_MS, Math.max(10000, ((ctx.timerLen | 0) || 45) * 1000));
        var timerId = null;
        var rafId = 0;
        var readyT = 0;

        function segKey(s) { return s.x + ',' + s.y; }

        /* ---------- audio via engine bridge (guarded, never required) ---------- */
        function sfx(name) {
          try { if (ctx.audio && typeof ctx.audio.p === 'function') ctx.audio.p(name); } catch (e) {}
        }

        /* ---------- sizing / render ---------- */
        var cell = 16;
        function fit() {
          var w = (container.clientWidth || 320) - 24;
          var size = Math.max(GRID * 10, Math.min(w, 420));
          cell = Math.max(6, Math.floor(size / GRID));
          canvas.width = cell * GRID;
          canvas.height = cell * GRID;
          draw();
        }
        function draw() {
          var g = canvas.getContext('2d');
          g.fillStyle = '#060a06';
          g.fillRect(0, 0, canvas.width, canvas.height);
          /* subtle backdrop texture: static cell grid + vignette so the board
           * never reads as a blank void (fully static -> motion-safe) */
          g.strokeStyle = '#0c170c';
          g.lineWidth = 1;
          g.beginPath();
          for (var gi = 1; gi < GRID; gi++) {
            g.moveTo(gi * cell + 0.5, 0);
            g.lineTo(gi * cell + 0.5, canvas.height);
            g.moveTo(0, gi * cell + 0.5);
            g.lineTo(canvas.width, gi * cell + 0.5);
          }
          g.stroke();
          var vg = g.createRadialGradient(
            canvas.width / 2, canvas.height / 2, canvas.width * 0.32,
            canvas.width / 2, canvas.height / 2, canvas.width * 0.78
          );
          vg.addColorStop(0, 'rgba(0,0,0,0)');
          vg.addColorStop(1, 'rgba(0,0,0,0.45)');
          g.fillStyle = vg;
          g.fillRect(0, 0, canvas.width, canvas.height);
          if (apple) {
            g.fillStyle = '#ff2038';
            g.fillRect(apple.x * cell + 1, apple.y * cell + 1, cell - 2, cell - 2);
          }
          for (var k = snake.length - 1; k >= 0; k--) {
            var s = snake[k];
            g.fillStyle = k === 0 ? '#66ffbb' : (k % 2 ? '#0a9c5c' : '#00e68a');
            g.fillRect(s.x * cell + 1, s.y * cell + 1, cell - 2, cell - 2);
          }
          foot.textContent = dead ? '' :
            'LEN ' + snake.length + ' · APPLES ' + applesEaten + '/' + APPLES_TO_WIN +
            ' · ' + Math.max(0, Math.ceil((capMs - elapsed()) / 1000)) + 'S';
        }
        function elapsed() {
          return (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
        }

        /* ---------- resolution ---------- */
        function teardown() {
          window.clearTimeout(timerId);
          window.clearTimeout(readyT);
          window.cancelAnimationFrame(rafId);
          window.removeEventListener('keydown', onKey, true);
          window.removeEventListener('resize', fit);
          canvas.removeEventListener('touchstart', onTouchStart);
          canvas.removeEventListener('touchmove', onTouchMove);
          canvas.removeEventListener('touchend', onTouchEnd);
        }
        function finish(survived, apex, silent) {
          if (finished) return;
          finished = true;
          teardown();
          ready.style.opacity = '0';   // round over — drop the onboarding legend
          if (silent) return;               // engine-aborted: engine injects its own result
          var bonus = apex ? APEX_BONUS[diff] : (survived ? SURVIVE_BONUS[diff] : 0);
          resolve({
            kind: 'score',
            correct: !!survived,
            points: dead ? -(10 + 10 * diff) : applesEaten * APPLE_PTS[diff] + bonus,
            hpDelta: dead ? -10 : 0,
            summary: ('snake len ' + snake.length + (apex ? ' · APEX SERPENT' : '')).slice(0, 64)
          });
        }

        /* ---------- tick ---------- */
        function tick() {
          if (finished) return;
          if (!dead) {
            if (queue.length) dir = queue.shift();
            var h = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
            if (h.x < 0 || h.y < 0 || h.x >= GRID || h.y >= GRID) {
              dead = true;
            } else {
              var willEat = apple && h.x === apple.x && h.y === apple.y;
              var bodyEnd = willEat ? snake.length : snake.length - 1;
              for (var k = 0; k < bodyEnd; k++) {
                if (snake[k].x === h.x && snake[k].y === h.y) { dead = true; break; }
              }
              if (!dead) {
                snake.unshift(h);
                if (willEat) {
                  applesEaten++;
                  sfx('serpent_apple');
                  apple = nextApple(new Set(snake.map(segKey)));
                  if (applesEaten >= APPLES_TO_WIN) { finish(true, true, false); return; }
                  if (!apple) { finish(true, true, false); return; }
                } else {
                  snake.pop();
                }
              }
            }
            if (dead) { sfx('serpent_die'); finish(false, false, false); return; }
          }
          if (elapsed() >= capMs) { finish(true, false, false); return; }
          timerId = window.setTimeout(tick, stepMs);
        }
        timerId = window.setTimeout(tick, stepMs);

        function raf() {
          if (finished) return;
          draw();
          rafId = window.requestAnimationFrame(raf);
        }
        rafId = window.requestAnimationFrame(raf);

        /* ---------- input ---------- */
        function pushDir(x, y) {
          var last = queue.length ? queue[queue.length - 1] : dir;
          if (last.x === -x && last.y === -y) return;   // no instant 180°
          if (last.x === x && last.y === y) return;
          if (queue.length < 2) { queue.push({ x: x, y: y }); sfx('serpent_turn'); }
        }
        var KEYS = {
          ArrowUp: [0, -1], KeyW: [0, -1],
          ArrowDown: [0, 1], KeyS: [0, 1],
          ArrowLeft: [-1, 0], KeyA: [-1, 0],
          ArrowRight: [1, 0], KeyD: [1, 0]
        };
        function onKey(e) {
          var m = KEYS[e.code];
          if (!m) return;
          e.preventDefault();
          pushDir(m[0], m[1]);
        }
        var tx = 0, ty = 0;
        function onTouchStart(e) {
          tx = e.changedTouches[0].clientX;
          ty = e.changedTouches[0].clientY;
        }
        function onTouchMove(e) { e.preventDefault(); }
        function onTouchEnd(e) {
          var dx = e.changedTouches[0].clientX - tx;
          var dy = e.changedTouches[0].clientY - ty;
          if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
          if (Math.abs(dx) > Math.abs(dy)) pushDir(dx > 0 ? 1 : -1, 0);
          else pushDir(0, dy > 0 ? 1 : -1);
        }
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', fit);
        canvas.addEventListener('touchstart', onTouchStart, { passive: true });
        canvas.addEventListener('touchmove', onTouchMove, { passive: false });
        canvas.addEventListener('touchend', onTouchEnd);

        /* ---------- self-play / soak hook ---------- */
        window.__SERPENT__ = {
          step: function (d) {
            var v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[d];
            if (!v || finished || dead) return false;
            pushDir(v[0], v[1]);
            window.clearTimeout(timerId);
            tick();               // advances exactly one tick; tick re-arms the timer
            return !finished;
          },
          state: function () {
            return {
              len: snake.length, apples: applesEaten,
              dead: dead, survived: finished && !dead,
              elapsedMs: Math.round(elapsed()),
              head: { x: snake[0].x, y: snake[0].y },
              apple: apple ? { x: apple.x, y: apple.y } : null,
              body: snake.map(function (s) { return { x: s.x, y: s.y }; }) // smoke/audit
            };
          },
          finish: function () { if (!dead) finish(true, false, false); }
        };
        active = { abort: function () { finish(false, false, true); } };

        readyT = window.setTimeout(function () { ready.style.opacity = '0'; }, 3000);
        fit();
      });
    },
    cleanup: stopActive
  });
})();
