/**
 * modes/pacman.js — GLUTTON (`pacman-maze`): eat-the-maze takeover stage.
 * Vanilla JS/Canvas, asset-free. Never touches window.G; engine applies the result.
 *
 * Registration shape (speculative against research/mode-contract.md; thin adapter):
 *   window.IQ.Stage.register({
 *     id: 'pacman-maze',
 *     name: 'GLUTTON',
 *     weight: 6,
 *     mount: function (container, ctx) { ...returns Promise<StageResult>... }
 *   });
 * Defensive: if IQ.Stage is absent at load, the descriptor is queued on
 * window.__stagePending (StageCore drains it later).
 *
 * ctx fields consumed:
 *   depth (number)     -> diff = clamp(1 + floor(depth/6), 1, 5)
 *   rng   (mulberry32) -> ONLY randomness source: maze mirror coin-flip at mount,
 *                         plus ghost intersection coin-flips in a FIXED draw order
 *                         (frame order × ghost id — identical on every tab).
 *   mp    (boolean)    -> shows the seed-sync note in the header
 *   world/align/hp/score/streak/seed -> accepted, read-only (display only).
 *
 * Controls:
 *   Keyboard: Arrows / WASD steer (turns buffered, applied at intersections;
 *             instant mid-corridor reversal supported).
 *   Touch: swipe anywhere on the canvas (24 px dead-zone against tremor).
 *
 * StageResult fields resolved:
 *   {
 *     kind:    'score',
 *     correct: cleared || (!caught && pelletsEaten >= 0.85*total at cap)
 *     points:  2*pelletsEaten + (cleared ? 120 : 0) + 50*ghostsEaten   // typ. 90–330
 *     hpDelta: caught ? -15 : 0
 *     summary: 'MAZE DEVOURED' | 'CAUGHT — x/y PELLETS'
 *            | 'SURVIVED — x/y PELLETS' | 'STARVED — x/y PELLETS'
 *   }
 *
 * Determinism (PATTERN Q): authored 19×15 maze + its horizontal mirror chosen by
 * ctx.rng; ghost AI is an FSM (house → exiting → scatter/chase ⇄ fright → eyes)
 * whose every intersection coin-flip draws ctx.rng in fixed order; fright windows
 * are pure functions of elapsed play-time, hence replay-exact. Only direction
 * events would ever be relayed.
 *
 * Depth scaling: ghosts 1→4 (diff 1/2/3/4+); ghost speed 0.80→1.05× player;
 * frightened window 6 s→2.5 s; diff≥4 alternates chase/scatter faster
 * (scatter 7 s→4 s).
 *
 * Fairness rails: visible eye-direction; personal-space halo ring around every
 * ghost; contact hitbox 60% of sprite (forgiving); death is a deflation
 * animation (never a strobe); tunnel escape left↔right always available;
 * 3 s READY freeze shows the control legend; IQB_MUTED gates WebAudio;
 * no fullscreen flashes; cap 40 s play + 3 s ready, absolute self-resolve 45 s.
 *
 * Headless smoke hook (documented):
 *   window.__GLUTTON__.step(dir[, ms]) // dir: 'up'|'down'|'left'|'right' — steers
 *                                      // and advances the sim synchronously by
 *                                      // ms (default 40) of play time
 *   window.__GLUTTON__.state()         // -> {eaten,total,pelletsLeft,pos,ghostsEaten,
 *                                      //     caught,cleared,finished,phase,playMs,
 *                                      //     ghosts:[{state,c,r}]}
 *   window.__GLUTTON__.maze()          // -> post-mirror layout strings (audit)
 *   window.__GLUTTON__.finish()        // force-resolve as cap-expiry (soak tests)
 */
(function () {
  'use strict';

  var COLS = 19;
  var ROWS = 15;
  var CAP_MS = 40000;
  var READY_MS = 3000;
  var ABS_GUARD_MS = 45000;
  var PLAYER_SPEED = 5.2;          // tiles / second

  /* T=closed maze (one authored layout; its horizontal mirror is chosen by rng) */
  var BASE_MAZE = [
    '###################',
    '#o.......#.......o#',
    '#.##.###.#.###.##.#',
    '#.................#',
    '#.##.#.#####.#.##.#',
    '#....#...#...#....#',
    '####.##.....##.####',
    '........#-#........',
    '#.##.#..#.#..#.##.#',
    '#.####.#####.####.#',
    '#..........#......#',
    '#.##.##.....##.##.#',
    '#.##.#.#####.#.##.#',
    '#o.......#.......o#',
    '###################'
  ];
  var SPAWN = { c: 9, r: 11 };
  var HOUSE = { c: 9, r: 8 };
  var CORNERS = [{ c: 1, r: 1 }, { c: 17, r: 1 }, { c: 1, r: 13 }, { c: 17, r: 13 }];

  function diffFor(depth) {
    return Math.max(1, Math.min(5, 1 + Math.floor((depth | 0) / 6)));
  }
  var GHOST_COUNT = [0, 1, 2, 3, 4, 4];
  var GHOST_SPEED = [0, 0.80, 0.88, 0.96, 1.00, 1.05];
  var FRIGHT_MS = [0, 6000, 5000, 4000, 3200, 2500];
  var RELEASE_AT = [400, 2600, 4800, 7000];

  var DESCRIPTOR = {
    id: 'pacman-maze',
    name: 'GLUTTON',
    weight: 6,
    mount: function (container, ctx) {
      return new Promise(function (resolve) {
        var diff = diffFor(ctx.depth);
        var nGhosts = GHOST_COUNT[diff];
        var ghostFactor = GHOST_SPEED[diff];
        var frightMs = FRIGHT_MS[diff];
        var scatterMs = diff >= 4 ? 4000 : 7000;
        var chaseMs = 20000;
        var rng = ctx.rng;

        /* ---------- maze parse (mirror coin-flip is the ONLY mount rng draw) --- */
        var mirrored = rng() < 0.5;
        var layout = BASE_MAZE.map(function (row) {
          return mirrored ? row.split('').reverse().join('') : row.slice();
        });
        var grid = [];           // 0 empty · 1 wall · 2 pellet · 3 power · 4 door
        var totalPellets = 0;
        for (var y = 0; y < ROWS; y++) {
          var rowCells = [];
          for (var x = 0; x < COLS; x++) {
            var ch = layout[y][x];
            var v = ch === '#' ? 1 : ch === '-' ? 4 : ch === 'o' ? 3 : ch === '.' ? 2 : 0;
            if (v === 2 || v === 3) totalPellets++;
            rowCells.push(v);
          }
          grid.push(rowCells);
        }
        grid[SPAWN.r][SPAWN.c] = 0;   // spawn tile is never a pellet
        var HOUSE_C = mirrored ? COLS - 1 - HOUSE.c : HOUSE.c;

        function normC(c) { return ((c % COLS) + COLS) % COLS; }
        function cellAt(c, r) {
          if (r < 0 || r >= ROWS) return 1;
          return grid[r][normC(c)];
        }
        function open(c, r, ghost, doorOk) {
          var v = cellAt(c, r);
          if (v === 1) return false;
          if (v === 4) return !!(ghost && doorOk);
          return true;
        }

        /* ---------- dom ---------- */
        var wrap = document.createElement('div');
        wrap.className = 'iq-glutton';
        var head = document.createElement('div');
        head.className = 'iq-glutton-head';
        var title = document.createElement('span');
        title.textContent = 'GLUTTON · DEPTH ' + (ctx.depth | 0);
        var meta = document.createElement('span');
        meta.className = 'iq-glutton-meta';
        meta.textContent = 'arrows / WASD / swipe';
        head.appendChild(title);
        head.appendChild(meta);
        var hud = document.createElement('div');
        hud.className = 'iq-glutton-hud';
        var canvas = document.createElement('canvas');
        var foot = document.createElement('div');
        foot.className = 'iq-glutton-foot';
        var legend = document.createElement('div');
        legend.className = 'iq-glutton-legend';
        legend.textContent = 'READY — ARROWS / WASD / SWIPE · EAT EVERYTHING';
        wrap.appendChild(head);
        wrap.appendChild(hud);
        wrap.appendChild(canvas);
        wrap.appendChild(foot);
        wrap.appendChild(legend);
        container.appendChild(wrap);

        if (ctx.mp) {
          var note = document.createElement('div');
          note.className = 'iq-glutton-note';
          note.textContent = 'seed-synced maze + ghost AI — same seed, same hunt; skill is yours';
          wrap.appendChild(note);
        }
        var style = document.createElement('style');
        style.textContent =
          '.iq-glutton{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;' +
          'color:#ffe9b8;font-family:Oxanium,monospace;background:#050510;padding:8px;border-radius:8px}' +
          '.iq-glutton-head{display:flex;justify-content:space-between;width:100%;font-size:13px;' +
          'letter-spacing:1px;color:#ffd23f}.iq-glutton-meta{color:#7f7f9e;font-size:12px}' +
          '.iq-glutton-hud{font-size:12px;color:#ffe9b8;min-height:15px;letter-spacing:1px}' +
          '.iq-glutton-note{font-size:11px;color:#bdbdf0}.iq-glutton-foot{font-size:12px;color:#fff;' +
          'min-height:15px}.iq-glutton canvas{background:#050510;border:2px solid #232352;' +
          'border-radius:4px;touch-action:none;display:block}' +
          '.iq-glutton-legend{position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);' +
          'background:rgba(4,4,14,.88);border:1px solid #3a3a70;color:#ffe9b8;font-size:13px;' +
          'letter-spacing:1px;padding:10px 16px;border-radius:6px;pointer-events:none}';
        wrap.appendChild(style);

        /* ---------- audio ---------- */
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

        /* ---------- actors ---------- */
        var player = {
          c: SPAWN.c, r: SPAWN.r, dx: 0, dy: -1, prog: 0,
          want: { dx: 0, dy: -1 }, stopped: false
        };
        var ghosts = [];
        for (var i = 0; i < nGhosts; i++) {
          ghosts.push({
            id: i,
            c: HOUSE_C, r: HOUSE.r, dx: 0, dy: 1, prog: 0,
            state: 'house',                    // house → exiting → out|fright → eyes
            releaseAt: RELEASE_AT[i],
            corner: CORNERS[mirrored ? (i % 2 === 0 ? i + 1 : i - 1) : i]
          });
        }
        var eaten = 0, pelletsLeft = totalPellets, ghostsEaten = 0;
        var caught = false, cleared = false;
        var finished = false;
        var phase = 'ready';                   // ready | play | dying | cleared | done
        var readyMs = READY_MS, dieMs = 0, clearMs = 0;
        var playMs = 0, frightUntil = -1;
        var rafId = 0;
        var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        var absGuard = setTimeout(function () { if (!finished) finishCap(); }, ABS_GUARD_MS);

        function posOf(a) {
          return { x: normC(a.c) + 0.5 + a.dx * a.prog, y: a.r + 0.5 + a.dy * a.prog };
        }
        function isScatter() { return (playMs % (scatterMs + chaseMs)) < scatterMs; }
        function wrapDistX(ax, bx) {
          var d = Math.abs(ax - bx);
          return Math.min(d, COLS - d);
        }

        /* ---------- eating ---------- */
        function eatAt(c, r) {
          var cc = normC(c);
          var v = grid[r][cc];
          if (v !== 2 && v !== 3) return;
          grid[r][cc] = 0;
          pelletsLeft--;
          eaten++;
          if (v === 3) {
            frightUntil = playMs + frightMs;
            ghosts.forEach(function (g) {
              if (g.state === 'out') {
                g.state = 'fright';
                flipMidEdge(g);
              }
            });
            beep(220, 160);
          } else {
            beep(760, 30);
          }
          if (pelletsLeft <= 0 && !finished) {
            cleared = true;
            phase = 'cleared';
            clearMs = 0;
            beep(980, 200);
          }
        }

        /* ---------- movement core (tile-to-tile with progress) ---------- */
        function flipMidEdge(a) {
          if (a.prog > 0.05 && (a.dx || a.dy)) {
            a.c = normC(a.c + a.dx);
            a.r += a.dy;
            a.dx = -a.dx; a.dy = -a.dy;
            a.prog = 1 - a.prog;
          }
        }
        function advance(a, dist, isGhost) {
          var guard = 0;
          while (dist > 0 && !(a.stopped) && guard++ < 60) {
            var need = 1 - a.prog;
            if (dist < need) { a.prog += dist; dist = 0; break; }
            dist -= need;
            a.c = normC(a.c + a.dx);
            a.r += a.dy;
            a.prog = 0;
            if (isGhost) ghostArrive(a); else playerArrive(a);
            if (finished || phase !== 'play') return;
          }
        }
        function playerArrive(p) {
          eatAt(p.c, p.r);
          if (finished || phase !== 'play') return;
          var w = p.want;
          if (w && open(p.c + w.dx, p.r + w.dy, false, false)) {
            p.dx = w.dx; p.dy = w.dy; p.stopped = false;
          } else if (!open(p.c + p.dx, p.r + p.dy, false, false)) {
            p.stopped = true; p.dx = 0; p.dy = 0;
          }
        }
        function ghostSpeed(g) {
          var base = PLAYER_SPEED * ghostFactor;
          if (g.state === 'fright') return base * 0.55;
          if (g.state === 'eyes') return base * 1.8;
          if (g.state === 'exiting' || g.state === 'house') return 3;
          return base;
        }
        function ghostArrive(g) {
          if (g.state === 'house') return;
          if (g.state === 'exiting') {
            if (g.r <= 6) { g.state = 'out'; decide(g); }
            /* else keep rising through the door corridor */
            return;
          }
          if (g.state === 'eyes' && g.c === normC(HOUSE_C) && g.r === HOUSE.r) {
            g.state = 'exiting';      // delivered: revive and climb back out
            g.dx = 0; g.dy = -1; g.prog = 0;
            return;
          }
          decide(g);
        }
        function decide(g) {
          var DIRS = [{ dx: 0, dy: -1 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 1, dy: 0 }];
          var doorOk = g.state === 'eyes';
          var cands = [];
          for (var k = 0; k < DIRS.length; k++) {
            var d = DIRS[k];
            if (d.dx === -g.dx && d.dy === -g.dy) continue;    // ghosts never reverse here
            if (open(g.c + d.dx, g.r + d.dy, true, doorOk)) cands.push(d);
          }
          if (!cands.length) { g.dx = -g.dx; g.dy = -g.dy; return; }
          var pick = null;
          if (g.state === 'fright') {
            pick = cands[Math.floor(rng() * cands.length)];    // seeded panic (fixed order)
          } else {
            var target;
            if (g.state === 'eyes') {
              target = (g.c === normC(HOUSE_C) && g.r <= 6)
                ? { c: normC(HOUSE_C), r: HOUSE.r }
                : { c: normC(HOUSE_C), r: 6 };                 // aim for the doorstep, then dive
            } else if (isScatter()) {
              target = g.corner;
            } else {
              target = { c: player.c, r: player.r };
            }
            var best = Infinity, ties = [];
            for (var m = 0; m < cands.length; m++) {
              var nc = normC(g.c + cands[m].dx);
              var nr = g.r + cands[m].dy;
              var dd = (nc - target.c) * (nc - target.c) + (nr - target.r) * (nr - target.r);
              if (dd < best - 1e-9) { best = dd; ties = [m]; }
              else if (dd < best + 1e-9) ties.push(m);
            }
            pick = ties.length > 1
              ? cands[ties[Math.floor(rng() * ties.length)]]     // seeded coin-flip (fixed order)
              : cands[ties[0]];
          }
          g.dx = pick.dx; g.dy = pick.dy;
        }
        function updateGhosts(dt) {
          for (var i = 0; i < ghosts.length; i++) {
            var g = ghosts[i];
            if (g.state === 'house') {
              if (playMs >= g.releaseAt) { g.state = 'exiting'; g.dx = 0; g.dy = -1; g.prog = 0; }
              continue;
            }
            if (g.state === 'fright' && playMs > frightUntil) g.state = 'out';
            var dist = (ghostSpeed(g) * dt) / 1000;
            advance(g, dist, true);
            if (finished || phase !== 'play') return;
          }
        }

        /* ---------- collisions ---------- */
        function collisions() {
          var pp = posOf(player);
          for (var i = 0; i < ghosts.length; i++) {
            var g = ghosts[i];
            if (g.state === 'house' || g.state === 'exiting' || g.state === 'eyes') continue;
            var gp = posOf(g);
            var dx = wrapDistX(pp.x, gp.x);
            var dy = Math.abs(pp.y - gp.y);
            if (Math.sqrt(dx * dx + dy * dy) < 0.6) {         // 60% sprite hitbox
              if (g.state === 'fright') {
                g.state = 'eyes';
                ghostsEaten++;
                flipMidEdge(g);
                beep(520, 120);
              } else {
                caught = true;
                phase = 'dying';
                dieMs = 0;
                beep(110, 400);
                return;
              }
            }
          }
        }

        /* ---------- steering ---------- */
        function steer(dx, dy) {
          if (finished || phase !== 'play') return;
          player.want = { dx: dx, dy: dy };
          if (player.stopped) {
            if (open(player.c + dx, player.r + dy, false, false)) {
              player.dx = dx; player.dy = dy; player.stopped = false;
            }
          } else if (dx === -player.dx && dy === -player.dy) {
            flipMidEdge(player);
            eatAt(player.c, player.r);       // reversal re-enters previous tile
          }
        }

        /* ---------- update ---------- */
        function update(dt) {
          if (finished) return;
          if (phase === 'ready') {
            readyMs -= dt;
            if (readyMs <= 0) { phase = 'play'; legend.style.display = 'none'; }
            return;
          }
          if (phase === 'dying') {
            dieMs += dt;
            if (dieMs >= 900) finishEnd();
            return;
          }
          if (phase === 'cleared') {
            clearMs += dt;
            if (clearMs >= 600) finishEnd();
            return;
          }
          if (phase !== 'play') return;
          playMs += dt;
          if (playMs >= CAP_MS) { finishCap(); return; }

          if (!player.stopped) {
            advance(player, (PLAYER_SPEED * dt) / 1000, false);
            if (finished || phase !== 'play') return;
          }
          updateGhosts(dt);
          if (finished || phase !== 'play') return;
          collisions();
        }

        /* ---------- resolution ---------- */
        function resultFor(capPath) {
          var clearedNow = cleared;
          var correct = clearedNow ||
            (!caught && capPath && eaten >= 0.85 * totalPellets);
          var pts = 2 * eaten + (clearedNow ? 120 : 0) + 50 * ghostsEaten;
          var summary;
          if (clearedNow) summary = 'MAZE DEVOURED';
          else if (caught) summary = 'CAUGHT — ' + eaten + '/' + totalPellets + ' PELLETS';
          else if (correct) summary = 'SURVIVED — ' + eaten + '/' + totalPellets + ' PELLETS';
          else summary = 'STARVED — ' + eaten + '/' + totalPellets + ' PELLETS';
          return {
            kind: 'score',
            correct: !!correct,
            points: pts,
            hpDelta: caught ? -15 : 0,
            summary: summary.length <= 48 ? summary : summary.slice(0, 48)
          };
        }
        function teardown() {
          finished = true;
          phase = 'done';
          clearTimeout(absGuard);
          cancelAnimationFrame(rafId);
          window.removeEventListener('keydown', onKey, true);
          window.removeEventListener('resize', fit);
          canvas.removeEventListener('touchstart', onTouchStart);
          canvas.removeEventListener('touchmove', onTouchMove);
          canvas.removeEventListener('touchend', onTouchEnd);
        }
        function finishEnd() {
          if (finished) return;
          var res = resultFor(false);
          teardown();
          foot.textContent = res.summary;
          resolve(res);
        }
        function finishCap() {
          if (finished) return;
          var res = resultFor(true);
          teardown();
          foot.textContent = res.summary;
          resolve(res);
        }

        /* ---------- sizing / render ---------- */
        var tile = 20, cssW = 0, cssH = 0, dpr = 1;
        function fit() {
          dpr = (typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0)
            ? window.devicePixelRatio : 1;
          var availW = (container.clientWidth || 420) - 28;
          var availH = (container.clientHeight || 480) - 96;
          tile = Math.max(9, Math.min(Math.floor(availW / COLS), Math.floor(availH / ROWS), 34));
          cssW = tile * COLS;
          cssH = tile * ROWS;
          canvas.width = Math.round(cssW * dpr);
          canvas.height = Math.round(cssH * dpr);
          canvas.style.width = cssW + 'px';
          canvas.style.height = cssH + 'px';
        }
        function drawGhost(g) {
          var p = posOf(g);
          var cxp = p.x * tile, cyp = p.y * tile;
          var rad = tile * 0.42;
          var ctx2 = canvas.getContext('2d');
          if (!ctx2 || !ctx2.fillRect) return;
          /* personal-space halo (positional tell, never audio-only) */
          ctx2.strokeStyle = 'rgba(255,255,255,0.22)';
          ctx2.lineWidth = 1;
          ctx2.beginPath();
          ctx2.arc(cxp, cyp, rad + 4, 0, Math.PI * 2);
          ctx2.stroke();

          var bodyColor;
          if (g.state === 'eyes') bodyColor = null;
          else if (g.state === 'fright') {
            var remain = frightUntil - playMs;
            var blink = remain < 1500 && Math.floor(playMs / 180) % 2 === 0;
            bodyColor = blink ? '#f4f4ff' : '#4a4ae8';
          } else {
            bodyColor = ['#ff5e6c', '#3fd8e0', '#ffb3d9', '#ff9f43'][g.id % 4];
          }
          if (bodyColor) {
            ctx2.fillStyle = bodyColor;
            ctx2.beginPath();
            ctx2.arc(cxp, cyp - rad * 0.15, rad, Math.PI, 0);
            ctx2.lineTo(cxp + rad, cyp + rad * 0.7);
            /* skirt zigzag */
            var steps = 3, w = (rad * 2) / (steps * 2);
            for (var z = 0; z < steps * 2; z++) {
              ctx2.lineTo(cxp + rad - w * (z + (z % 2 ? 0 : 1)), cyp + (z % 2 ? rad * 0.7 : rad * 0.35));
            }
            ctx2.closePath();
            ctx2.fill();
          }
          /* eyes show direction even when frightened/blue */
          var exo = g.dx * rad * 0.22, eyo = g.dy * rad * 0.22;
          ctx2.fillStyle = '#ffffff';
          ctx2.beginPath();
          ctx2.arc(cxp - rad * 0.34 + exo * 0.5, cyp - rad * 0.2 + eyo * 0.5, rad * 0.26, 0, Math.PI * 2);
          ctx2.arc(cxp + rad * 0.34 + exo * 0.5, cyp - rad * 0.2 + eyo * 0.5, rad * 0.26, 0, Math.PI * 2);
          ctx2.fill();
          ctx2.fillStyle = '#1a1a4a';
          ctx2.beginPath();
          ctx2.arc(cxp - rad * 0.34 + exo, cyp - rad * 0.2 + eyo, rad * 0.13, 0, Math.PI * 2);
          ctx2.arc(cxp + rad * 0.34 + exo, cyp - rad * 0.2 + eyo, rad * 0.13, 0, Math.PI * 2);
          ctx2.fill();
        }
        function draw() {
          var g2 = canvas.getContext('2d');
          if (!g2 || !g2.fillRect) return;
          g2.setTransform(dpr, 0, 0, dpr, 0, 0);
          g2.clearRect(0, 0, cssW, cssH);
          var x, y;
          for (y = 0; y < ROWS; y++) {
            for (x = 0; x < COLS; x++) {
              var v = grid[y][x];
              var px = x * tile, py = y * tile;
              if (v === 1) {
                g2.fillStyle = '#2b3fa8';
                g2.fillRect(px + 1, py + 1, tile - 2, tile - 2);
              } else if (v === 4) {
                g2.fillStyle = '#ffb3d9';
                g2.fillRect(px, py + tile / 2 - 1, tile, 2);
              } else if (v === 2) {
                g2.fillStyle = '#ffd7a8';
                g2.fillRect(px + tile / 2 - 1, py + tile / 2 - 1, 3, 3);
              } else if (v === 3) {
                var pr = tile * 0.28 + (motionOff() ? 0 : Math.sin(playMs / 120) * tile * 0.06);
                g2.fillStyle = '#ffd23f';
                g2.beginPath();
                g2.arc(px + tile / 2, py + tile / 2, Math.max(2, pr), 0, Math.PI * 2);
                g2.fill();
              }
            }
          }
          /* tunnel hints */
          g2.fillStyle = '#232352';
          g2.fillRect(0, 7 * tile, 3, tile);
          g2.fillRect(cssW - 3, 7 * tile, 3, tile);

          for (var i = 0; i < ghosts.length; i++) drawGhost(ghosts[i]);

          /* player (deflates on death — never a strobe) */
          var pp = posOf(player);
          var pcxp = pp.x * tile, pcyp = pp.y * tile;
          var prad = tile * 0.42;
          if (phase === 'dying') {
            prad *= Math.max(0, 1 - dieMs / 900);
          }
          var mouth = player.stopped ? 0.25 : (0.08 + 0.18 * Math.abs(Math.sin(playMs / 90)));
          var ang = Math.atan2(player.dy || (phase === 'dying' ? -1 : 0), player.dx || (phase === 'dying' ? 0 : 1));
          if (prad > 0.5) {
            g2.fillStyle = '#ffd23f';
            g2.beginPath();
            g2.moveTo(pcxp, pcyp);
            g2.arc(pcxp, pcyp, prad, ang + mouth * Math.PI, ang - mouth * Math.PI);
            g2.closePath();
            g2.fill();
          }

          hud.textContent = 'PELLETS ' + eaten + '/' + totalPellets +
            ' · GHOSTS ' + ghostsEaten +
            ' · ' + Math.max(0, Math.ceil((CAP_MS - playMs) / 1000)) + 's';
          if (phase === 'ready') foot.textContent = 'get ready…';
          else if (phase === 'dying') foot.textContent = 'GLUTTON DOWN';
          else if (phase === 'cleared') foot.textContent = 'MAZE DEVOURED';
          else foot.textContent = '';

          var tf = document.getElementById('timer-fill');
          if (tf && tf.style) tf.style.transform = 'scaleX(' + Math.max(0, Math.min(1, 1 - playMs / CAP_MS)) + ')';
          var tn = document.getElementById('timer-num');
          if (tn) tn.textContent = String(Math.max(0, Math.ceil((CAP_MS - playMs) / 1000)));
        }
        function motionOff() {
          try { return window.localStorage.getItem('IQB_MOTION') === '0'; } catch (e) { return false; }
        }

        /* ---------- input ---------- */
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
          steer(m[0], m[1]);
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
          if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;   // tremor dead-zone
          if (Math.abs(dx) > Math.abs(dy)) steer(dx > 0 ? 1 : -1, 0);
          else steer(0, dy > 0 ? 1 : -1);
        }
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', fit);
        canvas.addEventListener('touchstart', onTouchStart, { passive: true });
        canvas.addEventListener('touchmove', onTouchMove, { passive: false });
        canvas.addEventListener('touchend', onTouchEnd);

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

        /* ---------- self-play / smoke hook ---------- */
        window.__GLUTTON__ = {
          step: function (dirName, ms) {
            if (finished || phase !== 'play') {
              /* let READY elapse synchronously so headless drivers reach play */
              if (phase === 'ready') { phase = 'play'; readyMs = 0; legend.style.display = 'none'; }
              else return false;
            }
            var v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dirName];
            if (!v) return false;
            steer(v[0], v[1]);
            update(Math.max(1, ms || 40));
            return !finished && phase === 'play';
          },
          state: function () {
            return {
              eaten: eaten, total: totalPellets, pelletsLeft: pelletsLeft,
              pos: { c: normC(player.c), r: player.r, moving: !player.stopped },
              ghostsEaten: ghostsEaten, caught: caught, cleared: cleared,
              finished: finished, phase: phase, playMs: Math.round(playMs),
              ghosts: ghosts.map(function (g) {
                return { state: g.state, c: normC(g.c), r: g.r };
              })
            };
          },
          maze: function () { return layout.slice(); },
          finish: function () { if (!finished) finishCap(); }
        };

        fit();
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
