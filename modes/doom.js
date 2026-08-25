/**
 * modes/doom.js — THE CORRIDOR (`doom-corridor`): raycast-lite corridor-crawl takeover stage.
 * Vanilla JS/Canvas only, no deps/assets. Flat-shaded column raycaster at 320x200 internal,
 * upscaled pixelated. Design: research/modes-arcade-design.md §4 (+§0 shared machinery).
 *
 * Registration shape (speculative against research/mode-contract.md; adapter stays thin):
 *   window.IQ.Stage && window.IQ.Stage.register({
 *     id: 'doom-corridor',
 *     name: 'THE CORRIDOR',
 *     weight: 7,
 *     mount: function (container, ctx) { ... return Promise.resolve(stageResult); }
 *   });
 * Defensive: if IQ.Stage is absent at load, the definition queues on window.__stagePending
 * (StageCore drains it). This file NEVER touches window.G or any engine state.
 *
 * ctx fields consumed:
 *   depth (number)     -> difficulty via diff = clamp(1+floor(depth/6),1,5): demons 2..6,
 *                         demon speed 0.6..1.0x player, ammo scarce from diff>=4.
 *   rng   (mulberry32) -> ONLY randomness source for MP-visible world gen (PATTERN Q).
 *   seed   (number)    -> identity of the deterministic world; fallback rng seed.
 *   mp    (boolean)    -> shows the seed-sync note in the stage header.
 *   world/align/hp/score/streak -> header read-only; align.dim ('3d'/'4d') shrinks the
 *                         torch radius 30%/50% (darkness never hides the compass).
 *
 * CONTROLS:
 *   W/Up = forward, S/Down = back, A/D = strafe, Left/Right arrows (or mouse-x drag) = turn,
 *   Space / left-click / FIRE button = shoot. Walk over medkits + ammo to take them (no E key).
 *   Touch: LEFT half of canvas = virtual stick (fwd/back + strafe), RIGHT half drag = turn,
 *   FIRE button bottom-right (>=44px). ESC = pause card (escapable instantly, clock halts).
 *
 * StageResult fields resolved:
 *   {
 *     kind:    'score',
 *     correct: true  = reached exit cell (or within 3 tiles of it when the cap fires),
 *              false = internal HP pool hit 0 ('CONSUMED BY THE CORRIDOR'),
 *              null  = cap fired while lost (partial — see design doc)
 *     points:  doomPayout() — depth-tiered vs puzzle par 100*diff+40 (see below):
 *              win   = (50+15k) + kills*(20+5k) + (50+20k) - 10*misses  // k=diff tier
 *              dead  = -(10+10k)  // wrong-answer parity: dying never banks income
 *              lost  = max(0, win formula without exit bonus); engine ignores (neutral)
 *              wins land ~100-130% of par; engine caps any takeover at 100*k+60
 *     hpDelta: clamp(medkitsTaken*8 - hitsTaken*5, -15, +15)  // THE healing mode:
 *              every medkit banks real hp (+8); demon hits claw it back (-5 each);
 *              clamped both ways so a great run nets +15 max.
 *     summary: 'EXITED — N DEMONS DOWN' | 'CONSUMED BY THE CORRIDOR' | 'LOST IN THE CORRIDOR'
 *   }
 *
 * Determinism (PATTERN Q — seeded-world + input-relay ready): map (recursive backtracker +
 * 6 knocked walls), exit cell, pickups, demons and their patrol waypoints are ALL drawn from
 * ctx.rng in fixed order — identical on every tab for one seed. Demon activation, lunge
 * telegraphs and shot hit-resolution are pure functions of (positions, tick, shot angle),
 * so a host can replay quantized input frames through its own sim of the same seed. In solo
 * (!ctx.mp) nothing is relayed. The mode never reads hidden answers; scoring flows only
 * through the resolved StageResult.
 *
 * Fairness rails: muzzle flash is a 90ms WEAPON-LOCAL bloom (never fullscreen); damage
 * feedback is a red edge-vignette RAMP (~600ms decay, no strobe); demons pulse an outline
 * 400ms BEFORE lunging (visual + positional growl); compass arrow to the exit renders above
 * fog at all times; IQB_MOTION=false kills view-bob/torch flicker; IQB_MUTED=true silences
 * WebAudio; pause card escapable; touch targets >=44px.
 *
 * Self-play / smoke hook (after mount, and while a round is live):
 *   window.__DOOM__.step(act)  // act: 'fwd'|'back'|'sl'|'sr'|'tl'|'tr'|'fire' — advances
 *                              // the sim EXACTLY 100ms synchronously (rAF keeps running)
 *   window.__DOOM__.state()    // -> {pool, shells, kills, medkits, hits, shots, misses,
 *                              //     exited, dead, finished, elapsedMs, x, y, a}
 *   window.__DOOM__.finish()   // force-resolve as cap-reached (fast soak tests)
 */
(function () {
  'use strict';

  var CAP_MS = 45000;
  var MAP = 16;               // rooms per side
  var TW = MAP * 2 + 1;       // tile grid side (33x33, odd tiles are rooms)
  var IW = 320, IH = 200;     // internal render resolution
  var FOVTAN = 0.66;          // ~66 deg horizontal fov plane length
  var PLAYER_SPEED = 3.2;     // tiles/s
  var TURN_SPEED = 2.8;       // rad/s
  var HIT_R = 0.65;           // demon melee contact radius
  var PICK_R = 0.45;          // walk-over pickup radius
  var MUZZLE_MS = 90;
  var FIRE_CD = 280;

  /* ---------- tiny utils ---------- */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function fallbackRng(seed) {
    var s = (seed | 0) || 1;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function angNorm(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

  /* ---------- payout model (pure; shared by resolveAll and smoke harnesses) ----------
   * Economy parity (research/balance-pass.md §3c): puzzle par at difficulty tier
   * k is 100*k+40. Takeover wins land inside [60%,135%] of par and the engine
   * additionally caps any non-puzzle win at 100*k+60. Failure pays wrong-answer
   * parity -(10+10*k) — index.html:745 uses STAGE points on correct:false, so a
   * positive death payout would be free income (the old math banked +140..+380
   * for being eaten). Timeout is never optimal: every exited run clears 60% of
   * par, the corridor self-resolves at 45s (< the engine clock), and dying costs
   * strictly more than the loss it replaces. Exposed as window.__DOOM_PAY__. */
  function doomPayout(t) {
    var k = clamp(t.diff | 0, 1, 5);
    var exited = !!t.exited, dead = !!t.dead;
    var correct = exited ? true : (dead ? false : null);
    var points;
    if (correct === false) {
      points = -(10 + 10 * k);                      // death = a wrong answer, never income
    } else {
      points = Math.max(0,
        (50 + 15 * k) +                             // survival base
        (t.kills | 0) * (20 + 5 * k) +              // demon bounties scale with tier
        (exited ? 50 + 20 * k : 0) -                // exit bonus
        10 * (t.misses | 0));                       // wasted shells
    }
    return {
      correct: correct, points: points,
      hpDelta: clamp((t.medkitsTaken | 0) * 8 - (t.hitsTaken | 0) * 5, -15, 15)
    };
  }
  window.__DOOM_PAY__ = doomPayout;                 // headless smoke hook (pure)

  /* pre-shaded palettes, 16 brightness levels (torch falloff), built once per mount */
  function hexToRgb(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function buildRamp(hex) {
    var c = hexToRgb(hex), out = [];
    for (var i = 0; i < 16; i++) {
      var b = i / 15;

      out.push('rgb(' + ((c[0] * b) | 0) + ',' + ((c[1] * b) | 0) + ',' + ((c[2] * b) | 0) + ')');
    }
    return out;
  }

  /* sprite bitmaps: rows of chars; . = transparent. Drawn as billboarded columns. */
  var PATTERNS = {
    demon: [
      '.y.....y.',
      '.yr...ry.',
      '..rrrrr..',
      '.rrrrrrr.',
      '.rkrrrkr.',
      '.rrrrrrr.',
      '..rrrrr..',
      '.rdrrrdr.',
      '.r.rer.r.',
      '..dd.dd..'
    ],
    medkit: [
      'wwwwwwww',
      'wwwwwwww',
      'wwwrrwww',
      'wrrrrrrw',
      'wwwrrwww',
      'wwwwwwww',
      'wwwwwwww',
      'kkkkkkkk'
    ],
    ammo: [
      'aaaaaaaa',
      'aAAAAAAa',
      'aabbbbaa',
      'aabbbbaa',
      'aabbbbaa',
      'aAAAAAAa',
      'aaaaaaaa',
      'kkkkkkkk'
    ]
  };
  var PATCOLORS = {
    r: '#b3241f', d: '#5e120e', y: '#ffd23e', k: '#101010',
    w: '#ececec', a: '#6e5626', A: '#c79a44', b: '#4c3a18'
  };
  var WALL_RAMP = buildRamp('#8a4632');     // corridor brick
  var WALL2_RAMP = buildRamp('#4a5a6a');    // border rock (outer shell)

  function register(def) {
    try {
      if (window.IQ && window.IQ.Stage && typeof window.IQ.Stage.register === 'function') {
        window.IQ.Stage.register(def);
        return true;
      }
    } catch (e) { /* fall through to pending queue */ }
    if (!window.__stagePending) window.__stagePending = [];
    window.__stagePending.push(def);
    return false;
  }

  register({
    id: 'doom-corridor',
    name: 'THE CORRIDOR',
    weight: 7,
    mount: function (container, ctx) {
      return new Promise(function (resolve) {
        var rng = (typeof ctx.rng === 'function') ? ctx.rng : fallbackRng(ctx.seed);
        var depth = Math.max(1, ctx.depth | 0);
        var diff = clamp(1 + Math.floor(depth / 6), 1, 5);
        var motionOff = lsGet('IQB_MOTION') === 'false';
        var alDim = (ctx.align && typeof ctx.align === 'object') ? ctx.align.dim : null;
        var torch = 7.5 * (alDim === '4d' ? 0.5 : (alDim === '3d' ? 0.7 : 1));
        var nDemons = 1 + diff;                    // 2..6
        var demonSpd = PLAYER_SPEED * (0.6 + 0.1 * (diff - 1)); // 0.6..1.0x player
        var nMed = Math.max(2, 5 - (diff >> 1));   // 5..3 medkits
        var nAmmoC = diff >= 4 ? 1 : 2;
        var startShells = diff >= 4 ? 8 : 14;      // scarce ammo on hard depths
        var cacheShells = diff >= 4 ? 5 : 8;

        /* ================= seeded world gen (PATTERN Q) ================= */
        var solid = new Uint8Array(TW * TW).fill(1);
        function S(tx, ty) {
          if (tx < 0 || ty < 0 || tx >= TW || ty >= TW) return 1;
          return solid[ty * TW + tx];
        }
        (function carveMaze() {
          var visited = new Uint8Array(MAP * MAP);
          var stack = [[0, 0]];
          visited[0] = 1;
          solid[(1) * TW + 1] = 0;
          var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
          while (stack.length) {
            var top = stack[stack.length - 1];
            var opts = [];
            for (var d = 0; d < 4; d++) {
              var nx = top[0] + DIRS[d][0], ny = top[1] + DIRS[d][1];
              if (nx >= 0 && ny >= 0 && nx < MAP && ny < MAP && !visited[ny * MAP + nx]) opts.push([nx, ny]);
            }
            if (!opts.length) { stack.pop(); continue; }
            var pick = opts[(rng() * opts.length) | 0];
            visited[pick[1] * MAP + pick[0]] = 1;
            solid[(top[1] * 2 + 1 + (pick[1] - top[1])) * TW + (top[0] * 2 + 1 + (pick[0] - top[0]))] = 0;
            solid[(pick[1] * 2 + 1) * TW + (pick[0] * 2 + 1)] = 0;
            stack.push(pick);
          }
          /* knock 6 extra walls -> loops so the corridor breathes */
          var knocked = 0, guard = 0;
          while (knocked < 6 && guard++ < 500) {
            var wx = 1 + ((rng() * (TW - 2)) | 0), wy = 1 + ((rng() * (TW - 2)) | 0);
            if (!solid[wy * TW + wx]) continue;
            var horiz = S(wx - 1, wy) === 0 && S(wx + 1, wy) === 0;
            var vert = S(wx, wy - 1) === 0 && S(wx, wy + 1) === 0;
            if (horiz !== vert) { solid[wy * TW + wx] = 0; knocked++; }
          }
        })();

        /* BFS room distances from spawn room (0,0) */
        var distMap = (function () {
          var dist = new Int16Array(TW * TW).fill(-1);
          var q = [[1, 1]]; dist[TW + 1] = 0;
          while (q.length) {
            var c = q.shift(), d0 = dist[c[1] * TW + c[0]];
            var N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (var i = 0; i < 4; i++) {
              var nx = c[0] + N4[i][0], ny = c[1] + N4[i][1];
              if (!S(nx, ny) && dist[ny * TW + nx] < 0) { dist[ny * TW + nx] = d0 + 1; q.push([nx, ny]); }
            }
          }
          return dist;
        })();

        /* exit = farthest open tile; dead-ends = rooms with exactly one open neighbor */
        var exitT = { x: 1, y: 1 }, bestD = -1;
        var rooms = [], deadEnds = [];
        for (var ry = 0; ry < MAP; ry++) {
          for (var rx = 0; rx < MAP; rx++) {
            var tx = rx * 2 + 1, ty = ry * 2 + 1;
            var d = distMap[ty * TW + tx];
            if (d < 0) continue;
            rooms.push({ x: tx, y: ty });
            if (d > bestD) { bestD = d; exitT = { x: tx, y: ty }; }
            var open = (!S(tx + 1, ty)) + (!S(tx - 1, ty)) + (!S(tx, ty + 1)) + (!S(tx, ty - 1));
            if (open === 1) deadEnds.push({ x: tx, y: ty });
          }
        }
        /* seeded shuffle helper */
        function shuffle(arr) {
          for (var i = arr.length - 1; i > 0; i--) {
            var j = (rng() * (i + 1)) | 0;
            var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
          }
          return arr;
        }
        shuffle(rooms); shuffle(deadEnds);

        function farFromSpawn(c) {
          return distMap[c.y * TW + c.x] >= 4;
        }
        var spawn = { x: 1.5, y: 1.5 };

        /* place medkits then ammo caches in shuffled dead-ends (fallback: rooms) */
        var medkits = [], caches = [], usedKeys = {};
        function takeCells(n, pool) {
          var got = [];
          for (var i = 0; i < pool.length && got.length < n; i++) {
            var c = pool[i], k = c.x + ',' + c.y;
            if (usedKeys[k] || (c.x === exitT.x && c.y === exitT.y)) continue;
            usedKeys[k] = 1; got.push({ x: c.x + 0.5, y: c.y + 0.5 });
          }
          return got;
        }
        medkits = takeCells(nMed, deadEnds.length >= nMed ? deadEnds : rooms);
        caches = takeCells(nAmmoC, deadEnds.concat(rooms));

        /* demons: seeded cells away from spawn + 3 patrol waypoints each */
        var demonPool = shuffle(rooms.filter(farFromSpawn));
        var demons = [];
        for (var di = 0; di < nDemons && demonPool.length; di++) {
          var dc = demonPool.shift();
          demons.push({
            x: dc.x + 0.5, y: dc.y + 0.5,
            wps: shuffle(rooms.slice()).slice(0, 3).map(function (w) { return { x: w.x + 0.5, y: w.y + 0.5 }; }),
            wpI: 0, state: 'patrol', tel: 0, cd: 0, lx: 0, ly: 0, lt: 0
          });
        }

        /* ================= dom / style ================= */
        var wrap = document.createElement('div');
        wrap.className = 'iq-doom';
        var head = document.createElement('div');
        head.className = 'iq-doom-head';
        var title = document.createElement('span');
        title.textContent = 'THE CORRIDOR · DEPTH ' + depth;
        var meta = document.createElement('span');
        meta.className = 'iq-doom-meta';
        meta.textContent = 'WASD move · arrows/mouse turn · space fire · esc pause';
        head.appendChild(title); head.appendChild(meta);
        var hud = document.createElement('div');
        hud.className = 'iq-doom-hud';
        var canvas = document.createElement('canvas');
        var foot = document.createElement('div');
        foot.className = 'iq-doom-foot';
        var fireBtn = document.createElement('button');
        fireBtn.className = 'iq-doom-fire';
        fireBtn.type = 'button';
        fireBtn.textContent = 'FIRE';
        wrap.appendChild(head); wrap.appendChild(canvas); wrap.appendChild(fireBtn); wrap.appendChild(hud); wrap.appendChild(foot);
        container.appendChild(wrap);
        if (ctx.mp) {
          var note = document.createElement('div');
          note.className = 'iq-doom-note';
          note.textContent = 'seed-synced corridor — same seed, same maze; skill is yours';
          wrap.appendChild(note);
        }
        var style = document.createElement('style');
        style.textContent =
          '.iq-doom{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;' +
          'color:#ffd9c0;font-family:monospace;background:#0b0604;padding:8px;border-radius:8px}' +
          '.iq-doom-head{display:flex;justify-content:space-between;width:100%;font-size:13px;' +
          'letter-spacing:1px;color:#ff9a54}.iq-doom-meta{color:#8a6a52;font-size:11px}' +
          '.iq-doom-note{font-size:11px;color:#bf9578}.iq-doom-hud{font-size:12px;color:#ff6a4a;' +
          'min-height:16px}.iq-doom-foot{font-size:12px;color:#ffe9dc;min-height:16px}' +
          '.iq-doom canvas{image-rendering:pixelated;background:#000;border:2px solid #3c1810;' +
          'border-radius:4px;touch-action:none;cursor:crosshair}' +
          '.iq-doom-fire{position:absolute;right:14px;bottom:34px;width:64px;height:64px;' +
          'border-radius:50%;border:2px solid #ff6a4a;background:rgba(60,10,6,.75);color:#ffd9c0;' +
          'font-family:monospace;font-size:13px;letter-spacing:1px;z-index:2;display:none}' +
          '.iq-doom-card{position:absolute;inset:0;background:rgba(5,3,2,.88);display:flex;' +
          'flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#ffd9c0;' +
          'font-size:13px;text-align:center;z-index:3;border-radius:8px}';
        wrap.appendChild(style);

        /* ================= state ================= */
        var px = spawn.x, py = spawn.y, pa = 0;
        var pool = 100, shells = startShells;
        var kills = 0, medkitsTaken = 0, hitsTaken = 0, shots = 0, misses = 0;
        var lastFire = -1e9, muzzleUntil = -1e9, vignetteAt = -1e9;
        var exited = false, dead = false, finished = false, paused = false;
        var elapsed = 0, bobPhase = 0;
        var keys = {};
        var stickId = null, stickOx = 0, stickOy = 0, stickVX = 0, stickVY = 0;
        var turnDragId = null, turnDragLastX = 0;
        var audioCtx = null;

        function muted() { return lsGet('IQB_MUTED') === 'true'; }
        function tone(freq, ms, gain, type) {
          if (muted()) return;
          try {
            if (!audioCtx) {
              var AC = window.AudioContext || window.webkitAudioContext;
              if (!AC) return;
              audioCtx = new AC();
            }
            var o = audioCtx.createOscillator(), g = audioCtx.createGain();
            o.type = type || 'square';
            o.frequency.value = freq;
            g.gain.setValueAtTime(gain || 0.04, audioCtx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000);
            o.connect(g); g.connect(audioCtx.destination);
            o.start(); o.stop(audioCtx.currentTime + ms / 1000);
          } catch (e) { /* never let audio break gameplay */ }
        }

        /* ================= collision helpers ================= */
        function blocked(x, y) {
          var r = 0.22;
          return S((x - r) | 0, (y - r) | 0) || S((x + r) | 0, (y - r) | 0) ||
                 S((x - r) | 0, (y + r) | 0) || S((x + r) | 0, (y + r) | 0);
        }
        function slideMove(ent, dx, dy) {
          if (!blocked(ent.x + dx, ent.y)) ent.x += dx;
          if (!blocked(ent.x, ent.y + dy)) ent.y += dy;
        }
        function los(x0, y0, x1, y1) {
          var dx = x1 - x0, dy = y1 - y0, dist = Math.hypot(dx, dy);
          var steps = Math.ceil(dist / 0.2);
          for (var i = 1; i < steps; i++) {
            var t = i / steps;
            if (S((x0 + dx * t) | 0, (y0 + dy * t) | 0)) return false;
          }
          return true;
        }

        /* ================= shooting (pure fn of state — replayable) ================= */
        function fire() {
          if (finished || paused || nowMs() - lastFire < FIRE_CD) return false;
          lastFire = nowMs();
          if (shells <= 0) { tone(180, 60, 0.03); return false; }
          shells--; shots++;
          muzzleUntil = lastFire + MUZZLE_MS;
          tone(110, 90, 0.06, 'sawtooth'); tone(320, 50, 0.04);
          var best = null, bestD = 9;
          for (var i = 0; i < demons.length; i++) {
            var dm = demons[i];
            var dx = dm.x - px, dy = dm.y - py;
            var dist = Math.hypot(dx, dy);
            if (dist > bestD || dist < 0.01) continue;
            var off = Math.abs(angNorm(Math.atan2(dy, dx) - pa));
            if (off > Math.atan(0.38 / Math.max(dist, 0.5))) continue;
            if (!los(px, py, dm.x, dm.y)) continue;
            best = dm; bestD = dist;
          }
          if (best) {
            demons.splice(demons.indexOf(best), 1);
            kills++;
            tone(70, 160, 0.05, 'sawtooth');
          } else {
            misses++;
          }
          return true;
        }

        /* ================= demon AI (tick-pure: f(positions, tick, angle)) ================= */
        var tickN = 0;
        function demonTick(dt) {
          tickN++;
          for (var i = 0; i < demons.length; i++) {
            var dm = demons[i];
            var dx = px - dm.x, dy = py - dm.y;
            var dist = Math.hypot(dx, dy) || 0.0001;
            if (dm.cd > 0) dm.cd -= dt * 1000;
            if (dm.state === 'patrol') {
              if (dist < 5.5 && los(dm.x, dm.y, px, py)) {   // activation: LOS-gated
                dm.state = 'chase';
                tone(85, 260, clamp(0.07 - dist * 0.006, 0.02, 0.06), 'sawtooth'); // positional growl
              } else {
                var wp = dm.wps[dm.wpI];
                var wdx = wp.x - dm.x, wdy = wp.y - dm.y;
                var wd = Math.hypot(wdx, wdy);
                if (wd < 0.3) dm.wpI = (dm.wpI + 1) % dm.wps.length;
                else slideMove(dm, (wdx / wd) * demonSpd * 0.45 * dt, (wdy / wd) * demonSpd * 0.45 * dt);
                continue;
              }
            }
            if (dm.state === 'telegraph') {
              dm.tel -= dt * 1000;
              if (dm.tel <= 0) {                                // lunge toward stored player pos
                dm.state = 'lunge'; dm.lt = 260; dm.lx = dx / dist; dm.ly = dy / dist;
              }
              continue;
            }
            if (dm.state === 'lunge') {
              dm.lt -= dt * 1000;
              slideMove(dm, dm.lx * demonSpd * 2.5 * dt, dm.ly * demonSpd * 2.5 * dt);
              var hx = px - dm.x, hy = py - dm.y, hd = Math.hypot(hx, hy);
              if (hd < HIT_R) {                                 // melee lands
                pool -= 10; hitsTaken++;
                vignetteAt = nowMs();
                dm.cd = 1400; dm.state = 'chase';
                tone(55, 220, 0.07, 'sawtooth');
                if (pool <= 0 && !exited) { dead = true; resolveAll(); return; }
              } else if (dm.lt <= 0) {
                dm.cd = Math.max(dm.cd, 800); dm.state = 'chase';
              }
              continue;
            }
            /* chase */
            if (dist < 1.5 && dm.cd <= 0 && los(dm.x, dm.y, px, py)) {
              dm.state = 'telegraph'; dm.tel = 400;             // fairness: 400ms outline pulse
            } else if (dist > 0.35) {
              slideMove(dm, (dx / dist) * demonSpd * dt, (dy / dist) * demonSpd * dt);
            }
          }
        }

        /* ================= pickups ================= */
        function pickupTick() {
          var i;
          for (i = medkits.length - 1; i >= 0; i--) {
            var mk = medkits[i];
            if (Math.hypot(mk.x - px, mk.y - py) < PICK_R) {
              medkits.splice(i, 1); medkitsTaken++; pool = Math.min(100, pool + 25);
              tone(660, 80, 0.04); tone(990, 80, 0.03);
            }
          }
          for (i = caches.length - 1; i >= 0; i--) {
            var ac = caches[i];
            if (Math.hypot(ac.x - px, ac.y - py) < PICK_R) {
              caches.splice(i, 1); shells += cacheShells;
              tone(440, 60, 0.04);
            }
          }
        }

        /* ================= sim step ================= */
        function update(dt) {
          if (paused || finished) return;
          var fwd = 0, strafe = 0, turn = 0;
          if (keys.fwd) fwd += 1;
          if (keys.back) fwd -= 1;
          if (keys.sl) strafe -= 1;
          if (keys.sr) strafe += 1;
          if (keys.tl) turn -= 1;
          if (keys.tr) turn += 1;
          fwd += stickVY; strafe += stickVX;
          fwd = clamp(fwd, -1, 1); strafe = clamp(strafe, -1, 1);
          pa += turn * TURN_SPEED * dt;
          var ca = Math.cos(pa), sa = Math.sin(pa);
          var spd = PLAYER_SPEED * dt * Math.min(1, Math.hypot(fwd, strafe));
          var mx = (ca * fwd + -sa * strafe) , my = (sa * fwd + ca * strafe);
          var ml = Math.hypot(mx, my);
          if (ml > 0.001) {
            mx /= ml; my /= ml;
            var p = { x: px, y: py };
            slideMove(p, mx * spd, my * spd);
            px = p.x; py = p.y;
            if (!motionOff) bobPhase += dt * 9;
          }
          demonTick(dt);
          pickupTick();
          elapsed += dt * 1000;
          if (!dead && !exited &&
              Math.hypot(exitT.x + 0.5 - px, exitT.y + 0.5 - py) < 0.6) {
            exited = true; resolveAll(); return;
          }
          if (elapsed >= CAP_MS) {
            exited = Math.hypot(exitT.x + 0.5 - px, exitT.y + 0.5 - py) <= 3.0; // grace win
            resolveAll();
          }
        }

        /* ================= resolution ================= */
        var rafId = 0;
        function resolveAll() {
          if (finished) return;
          finished = true;
          paused = false;
          window.cancelAnimationFrame(rafId);
          teardownInput();
          var out = doomPayout({ diff: diff, kills: kills, exited: exited,
            dead: dead, misses: misses, medkitsTaken: medkitsTaken, hitsTaken: hitsTaken });
          var points = out.points;
          var correct = out.correct;
          var hpDelta = out.hpDelta;
          var summary = exited
            ? 'EXITED — ' + kills + ' DEMON' + (kills === 1 ? '' : 'S') + ' DOWN'
            : (dead ? 'CONSUMED BY THE CORRIDOR'
                    : 'LOST IN THE CORRIDOR' + (kills ? ' · ' + kills + ' DOWN' : ''));
          foot.textContent = exited ? 'YOU FOUND THE WAY OUT' :
            (dead ? 'THE CORRIDOR KEEPS YOU' : 'TIME DIED IN THE DARK');
          resolve({
            kind: 'score', correct: correct, points: points,
            hpDelta: hpDelta, summary: summary
          });
        }

        /* ================= rendering ================= */
        var g2 = canvas.getContext('2d');
        var zbuf = new Float32Array(IW);

        function drawScene() {
          var horizon = (IH >> 1) + (motionOff ? 0 : Math.round(Math.sin(bobPhase) * 3));
          var flick = motionOff ? 1 : (1 + Math.sin(nowMs() / 130) * 0.03);
          var torchR = torch * flick;
          var ca = Math.cos(pa), sa = Math.sin(pa);
          var plX = -sa * FOVTAN, plY = ca * FOVTAN;

          g2.fillStyle = '#14100c';                       // ceiling
          g2.fillRect(0, 0, IW, horizon);
          g2.fillStyle = '#221a12';                       // floor
          g2.fillRect(0, horizon, IW, IH - horizon);

          for (var col = 0; col < IW; col++) {
            var camX = 2 * col / IW - 1;
            var rdx = ca + plX * camX, rdy = sa + plY * camX;
            var mapX = px | 0, mapY = py | 0;
            var ddx = Math.abs(rdx) < 1e-9 ? 1e9 : Math.abs(1 / rdx);
            var ddy = Math.abs(rdy) < 1e-9 ? 1e9 : Math.abs(1 / rdy);
            var stepX = rdx < 0 ? -1 : 1, stepY = rdy < 0 ? -1 : 1;
            var sdx = (rdx < 0 ? (px - mapX) : (mapX + 1 - px)) * ddx;
            var sdy = (rdy < 0 ? (py - mapY) : (mapY + 1 - py)) * ddy;
            var side = 0, tile = 1, guard = 0;
            while (guard++ < 128) {
              if (sdx < sdy) { sdx += ddx; mapX += stepX; side = 0; }
              else { sdy += ddy; mapY += stepY; side = 1; }
              if (S(mapX, mapY)) { tile = S(mapX, mapY); break; }
            }
            var pdist = side === 0 ? (sdx - ddx) : (sdy - ddy);
            if (pdist < 0.01) pdist = 0.01;
            zbuf[col] = pdist;
            var hgt = (IH / pdist) | 0;
            var y0 = horizon - (hgt >> 1);
            var b = clamp(1.25 - pdist / torchR, 0.05, 1);
            var lvl = (b * 15) | 0;
            var ramp = tile === 1 ? WALL_RAMP : WALL2_RAMP;
            if (side === 1 && lvl > 1) lvl -= 2;           // fake face shading
            g2.fillStyle = ramp[lvl];
            g2.fillRect(col, y0, 1, hgt);
          }

          /* sprites (painter order: farthest first), clipped against wall zbuf */
          var ents = [];
          var i;
          for (i = 0; i < demons.length; i++) ents.push({ e: demons[i], pat: 'demon', sc: 0.72 });
          for (i = 0; i < medkits.length; i++) ents.push({ e: medkits[i], pat: 'medkit', sc: 0.42 });
          for (i = 0; i < caches.length; i++) ents.push({ e: caches[i], pat: 'ammo', sc: 0.42 });
          for (i = 0; i < ents.length; i++) {
            ents[i].d = (ents[i].e.x - px) * (ents[i].e.x - px) + (ents[i].e.y - py) * (ents[i].e.y - py);
          }
          ents.sort(function (a, b) { return b.d - a.d; });
          var invDet = 1 / (plX * sa - ca * plY);
          for (i = 0; i < ents.length; i++) {
            var ent = ents[i];
            var sx = ent.e.x - px, sy = ent.e.y - py;
            var tx = invDet * (sa * sx - ca * sy);         // camera-space x
            var ty = invDet * (-plY * sx + plX * sy);      // depth
            if (ty <= 0.08) continue;
            var scrX = ((IW / 2) * (1 + tx / ty)) | 0;
            var size = ((IH / ty) * ent.sc) | 0;
            if (size < 2) continue;
            var pat = PATTERNS[ent.pat], pw = pat[0].length, ph = pat.length;
            var x0 = scrX - (size >> 1);
            var stripeW = size / pw;
            var rowH = size / ph;
            var yTop = horizon - (size >> 1);
            var bright = clamp(1.25 - Math.sqrt(ent.d) / torchR, 0.08, 1);
            var tele = ent.pat === 'demon' && ent.e.state === 'telegraph' &&
                       (((ent.e.tel / 100) | 0) % 2 === 0);  // 400ms outline pulse
            for (var cx = 0; cx < pw; cx++) {
              var scx = (x0 + cx * stripeW) | 0;
              if (scx < 0 || scx >= IW) continue;
              if (ty >= zbuf[scx]) continue;               // hidden behind wall
              for (var crow = 0; crow < ph; crow++) {
                var ch = pat[crow][cx];
                if (ch === '.') continue;
                var yy = (yTop + crow * rowH) | 0;
                if (yy < 0 || yy >= IH) continue;
                var rgb = PATCOLORS[ch];
                if (tele) rgb = '#ffffff';
                g2.globalAlpha = clamp(bright + (tele ? 0.35 : 0), 0, 1);
                g2.fillStyle = rgb;
                g2.fillRect(scx, yy, Math.max(1, stripeW | 0) + 1, Math.max(1, rowH | 0) + 1);
              }
            }
            g2.globalAlpha = 1;
          }

          /* weapon-local muzzle bloom (never fullscreen) */
          var gunBaseY = IH - 26 + (motionOff ? 0 : Math.round(Math.sin(bobPhase) * 2));
          g2.fillStyle = '#241812';
          g2.fillRect(IW / 2 - 10, gunBaseY, 20, 26);
          g2.fillStyle = '#3a261a';
          g2.fillRect(IW / 2 - 6, gunBaseY - 8, 12, 10);
          if (nowMs() < muzzleUntil) {
            g2.fillStyle = '#ffe27a';
            g2.beginPath();
            g2.moveTo(IW / 2 - 9, gunBaseY - 8);
            g2.lineTo(IW / 2, gunBaseY - 30);
            g2.lineTo(IW / 2 + 9, gunBaseY - 8);
            g2.closePath(); g2.fill();
          }

          /* crosshair */
          g2.fillStyle = 'rgba(255,226,122,.8)';
          g2.fillRect(IW / 2 - 1, IH / 2 - 1, 3, 3);

          /* damage feedback: red EDGE vignette ramp (no strobe) */
          var vt = nowMs() - vignetteAt;
          if (vt >= 0 && vt < 600 && pool < 100) {
            var va = (1 - vt / 600) * 0.55;
            var grad = g2.createRadialGradient(IW / 2, IH / 2, IH * 0.32, IW / 2, IH / 2, IH * 0.78);
            grad.addColorStop(0, 'rgba(160,20,20,0)');
            grad.addColorStop(1, 'rgba(160,20,20,' + va.toFixed(3) + ')');
            g2.fillStyle = grad;
            g2.fillRect(0, 0, IW, IH);
          }

          /* HUD compass — ALWAYS visible, above fog */
          var bear = Math.atan2(exitT.y + 0.5 - py, exitT.x + 0.5 - px) - pa;
          var ccx = IW - 26, ccy = 26, cr = 17;
          g2.fillStyle = 'rgba(0,0,0,.6)';
          g2.beginPath(); g2.arc(ccx, ccy, cr, 0, 7); g2.fill();
          g2.strokeStyle = '#ff9a54'; g2.lineWidth = 1;
          g2.stroke();
          g2.save();
          g2.translate(ccx, ccy); g2.rotate(bear);
          g2.fillStyle = '#ffe27a';
          g2.beginPath();
          g2.moveTo(0, -cr + 5); g2.lineTo(4, 4); g2.lineTo(-4, 4);
          g2.closePath(); g2.fill();
          g2.restore();
        }

        function fit() {
          var w = (container.clientWidth || 340) - 28;
          var h = (container.clientHeight || 260) - 96;
          var scale = Math.max(1, Math.floor(Math.min(w / IW, Math.max(h, 120) / IH) || 1));
          canvas.width = IW * scale;
          canvas.height = IH * scale;
          drawFrame();
        }
        function drawFrame() {
          drawScene();
          hud.innerHTML = '';
          var pip = '';
          for (var i = 0; i < 10; i++) pip += pool > i * 10 ? '\u25AE' : '\u25AF';
          hud.textContent =
            pip + '  shells ' + shells + '  demons down ' + kills + '/' + (nDemons) +
            '  \u2192 exit ' + Math.max(0, Math.ceil(CAP_MS / 1000 - elapsed / 1000)) + 's';
          if (medkitsTaken) foot.textContent = 'medkits banked: +' + (medkitsTaken * 8) + ' hp';
        }

        /* ================= main loop ================= */
        var lastTs = nowMs();
        function raf(ts) {
          if (finished) return;
          var dt = Math.min(0.05, Math.max(0.001, (ts || nowMs()) - lastTs) / 1000);
          lastTs = ts || nowMs();
          update(dt);
          if (finished) return;
          drawFrame();
          rafId = window.requestAnimationFrame(raf);
        }
        rafId = window.requestAnimationFrame(raf);

        /* ================= input ================= */
        function setKey(code, v) {
          switch (code) {
            case 'KeyW': case 'ArrowUp': keys.fwd = v; return true;
            case 'KeyS': case 'ArrowDown': keys.back = v; return true;
            case 'KeyA': keys.sl = v; return true;
            case 'KeyD': keys.sr = v; return true;
            case 'ArrowLeft': keys.tl = v; return true;
            case 'ArrowRight': keys.tr = v; return true;
            case 'Space': if (v && !keys.Space) fire(); keys.Space = v; return true;
            case 'Escape': if (v) togglePause(); return true;
          }
          return false;
        }
        function onKeyDown(e) {
          if (setKey(e.code, true)) e.preventDefault();
        }
        function onKeyUp(e) {
          if (setKey(e.code, false)) e.preventDefault();
        }

        var touchMode = false;
        function onPointerDown(e) {
          if (e.pointerType === 'touch') touchMode = true;
          if (touchMode && e.pointerType === 'touch') {
            var rect = canvas.getBoundingClientRect();
            var rel = (e.clientX - rect.left) / rect.width;
            if (rel < 0.5 && stickId === null) {
              stickId = e.pointerId; stickOx = e.clientX; stickOy = e.clientY;
              stickVX = 0; stickVY = 0;
            } else if (rel >= 0.5 && turnDragId === null) {
              turnDragId = e.pointerId; turnDragLastX = e.clientX;
            }
            canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
          } else {
            fire();
          }
          e.preventDefault();
        }
        function onPointerMove(e) {
          if (e.pointerType === 'mouse') return;             // mouse-x drag turning handled by move below
          if (e.pointerId === stickId) {
            stickVX = clamp((e.clientX - stickOx) / 48, -1, 1);
            stickVY = clamp(-(e.clientY - stickOy) / 48, -1, 1);
          } else if (e.pointerId === turnDragId) {
            pa += (e.clientX - turnDragLastX) * 0.006;
            turnDragLastX = e.clientX;
          }
        }
        function onMouseMoveDrag(e) {
          if (e.buttons & 1) {                               // hold left button + drag x = turn
            pa += e.movementX * 0.004;
          }
        }
        function onPointerUp(e) {
          if (e.pointerId === stickId) { stickId = null; stickVX = 0; stickVY = 0; }
          if (e.pointerId === turnDragId) turnDragId = null;
        }
        function onFireBtn(e) { fire(); e.preventDefault(); }

        var card = null;
        function togglePause() {
          if (finished) return;
          if (paused) {
            if (card && card.parentNode) card.parentNode.removeChild(card);
            card = null; paused = false; lastTs = nowMs();
            return;
          }
          paused = true;
          card = document.createElement('div');
          card.className = 'iq-doom-card';
          card.innerHTML =
            '<div>PAUSED — THE CORRIDOR WAITS</div>' +
            '<div>W/S forward·back · A/D strafe · arrows or mouse-drag turn<br>' +
            'space / click / FIRE = shoot · walk into medkits + ammo<br>' +
            'follow the gold compass to the EXIT</div>' +
            '<div>[ESC or tap here to resume]</div>';
          card.addEventListener('pointerdown', togglePause);
          wrap.appendChild(card);
        }

        function teardownInput() {
          window.removeEventListener('keydown', onKeyDown, true);
          window.removeEventListener('keyup', onKeyUp, true);
          canvas.removeEventListener('pointerdown', onPointerDown);
          canvas.removeEventListener('pointermove', onPointerMove);
          canvas.removeEventListener('mousemove', onMouseMoveDrag);
          window.removeEventListener('pointerup', onPointerUp);
          window.removeEventListener('resize', fit);
          fireBtn.removeEventListener('pointerdown', onFireBtn);
        }
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('keyup', onKeyUp, true);
        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('mousemove', onMouseMoveDrag);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('resize', fit);
        fireBtn.addEventListener('pointerdown', onFireBtn);
        /* show the FIRE button once touch input appears (parity without desktop clutter) */
        var fireBtnCheck = window.setInterval(function () {
          if (touchMode) {
            fireBtn.style.display = 'block';
            window.clearInterval(fireBtnCheck);
          }
          if (finished) window.clearInterval(fireBtnCheck);
        }, 400);

        /* ================= self-play / smoke hook ================= */
        window.__DOOM__ = {
          step: function (act) {
            if (finished) return false;
            switch (act) {
              case 'fwd': keys.fwd = true; break;
              case 'back': keys.back = true; break;
              case 'sl': keys.sl = true; break;
              case 'sr': keys.sr = true; break;
              case 'tl': keys.tl = true; break;
              case 'tr': keys.tr = true; break;
              case 'fire': fire(); return true;
              default: return false;
            }
            update(0.1);                                     // advance EXACTLY 100ms
            keys.fwd = keys.back = keys.sl = keys.sr = keys.tl = keys.tr = false;
            return !finished;
          },
          state: function () {
            return {
              pool: pool, shells: shells, kills: kills, medkits: medkitsTaken,
              hits: hitsTaken, shots: shots, misses: misses,
              exited: exited, dead: dead, finished: finished,
              elapsedMs: Math.round(elapsed),
              x: +px.toFixed(3), y: +py.toFixed(3), a: +pa.toFixed(3)
            };
          },
          finish: function () {
            if (finished) return;
            exited = Math.hypot(exitT.x + 0.5 - px, exitT.y + 0.5 - py) <= 3.0;
            resolveAll();
          }
        };

        fit();
      });
    }
  });
})();
