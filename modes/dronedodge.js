/* ============================================================================
   modes/dronedodge.js — DRONE SWARM DODGE (themed takeover, design §4)
   research/modes-themed-design.md §4 · bind worlds 'wasteland-roads' (primary),
   'riot' (rotate pool), both align 'bad'. Supersedes nothing hook-side; the
   streak-guard economy it banks feeds an aftermath hook next round.

   Registration shape (research/mode-contract.md v1):
     window.IQ.Stage.register({
       id:'dronedodge', name:'DRONE SWARM', weight:6,
       worlds:['wasteland-roads','riot'], aligns:['bad'], net:'seed',
       mount(container,ctx) -> Promise<StageResult>
     });
   If IQ.Stage is absent the spec queues onto window.__stagePending.

   Controls:
     pointer/touch — move your cursor/body; click option tiles to answer.
     WASD / arrows — nudges the cursor (keyboard-evader fairness rail).
     Escape        — bail out (neutral settle, escapable rail).

   Mechanic (seeded-world + input-relay): spawn TIMES/edges are seeded from
   ctx.rng at stage start; drones home on THIS client's cursor with turn-rate-
   limited steering (circling defeats them). A hit costs hp −7, breaks your
   answer streak (relayed as a count the aftermath pipeline can spend) and
   grants 0.6 s invulnerability. Every 3 consecutive drones dodged banks +1
   STREAK GUARD (max 2 held) into IQ.Hooks.state['droneswarm:guards']; guards
   auto-spend NEXT round (first wrong while holding one does not break streak).
   Depth ≥7: surviving drones split into two slower shards (same hp rules).

   StageResult fields resolved (design §4 table; live stings folded into the
   end-of-stage hpDelta because the current contract draft exposes no mid-stage
   hp bridge — engine clamps [−60,60]):
     correct: true (win) | false (wrong) | null (timeout/bail/impossible)
     points:  base(≈100·diff + leftFrac·80) + 15·guardsBankedThisStage | 0
     hpDelta: −7 per hit, −5 timeout/bail
     summary: SWARM OUTFLOWN ×2 GUARDS · SWARM OUTFLOWN · STUNG BUT CORRECT
              · THE SWARM WON · DODGED FOREVER, ANSWERED NEVER

   Determinism / fairness:
     - Spawn schedule + puzzle = seed-deterministic; homing/dodging is local
       skill; guard banking relays PURE COUNTS (no timestamps).
     - All motion behind IQB_MOTION (+prefers-reduced-motion): motion off ⇒
       drones advance in discrete 400 ms steps, no trails/shake — rules identical.
     - Audio behind IQB_MUTED. Never reads hidden answers pre-reveal; never
       touches window.G. Self-limits to min(timerLen,45s). Escape always works.

   Smoke hook: window.__DD__.{state,cursor,finish} (manual soak); node smokes
   use exported pure sim (module.exports in node): paramsFor, speedMult,
   buildSpawns, steer, wrapAngle, onDodgeBank.
   ============================================================================ */
(function () {
  'use strict';
  var CAP_MS = 45000;

  /* ---------------- pure sim (exported; zero DOM) ---------------- */

  function paramsFor(depth) {
    var u = (Math.max(1, Math.min(10, depth | 0)) - 1) / 9;
    return {
      spawnInt: Math.round(2200 - 1300 * u),   /* 2.2 s → 0.9 s */
      jitter: 0.3,                             /* ±30% seeded gap jitter */
      life: 7000,                              /* ms before a dodged drone leaves */
      shardLife: 3500,
      splitAt: 6000,                           /* depth ≥7 survival split point */
      maxTurn: 2.4,                            /* rad/s — circling defeats them */
      hitR: 13, shardR: 9, cursorR: 9,
      invulnMs: 600,
      maxAlive: 14,
      splitters: depth >= 7,
      speedMul: speedMult(depth)
    };
  }

  function speedMult(depth) { return 1 + 0.1 * Math.min(Math.max(1, depth | 0) - 1, 12); }

  /* Seeded spawn schedule: times jitter around the interval, edges + offsets drawn once. */
  function buildSpawns(rng, depth, horizonMs) {
    var P = paramsFor(depth), ev = [], t = 1200;
    while (t < horizonMs) {
      var side = Math.floor(rng() * 4);          /* 0 top 1 right 2 bottom 3 left */
      var off = rng();                            /* position along the edge, 0..1 */
      var spd = 0.85 + rng() * P.jitter * 2;      /* 0.85..1.15 */
      ev.push({ t: Math.round(t), side: side, off: off, spd: spd });
      t += P.spawnInt * (0.85 + rng() * P.jitter * 2);
    }
    return ev;
  }

  function wrapAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  /* Turn-rate-limited homing step. Mutates d {x,y,a,spd}; returns new heading. */
  function steer(d, tx, ty, dt, maxTurn) {
    var want = Math.atan2(ty - d.y, tx - d.x);
    var diff = wrapAngle(want - d.a);
    var turn = Math.max(-maxTurn * dt, Math.min(maxTurn * dt, diff));
    d.a = wrapAngle(d.a + turn);
    d.x += Math.cos(d.a) * d.spd * dt;
    d.y += Math.sin(d.a) * d.spd * dt;
    return d.a;
  }

  /* Pure guard-banking rule: call after each dodge with the running streak. */
  function onDodgeBank(dodgeStreak, heldGuards) {
    if (dodgeStreak > 0 && dodgeStreak % 3 === 0 && heldGuards < 2) {
      return { bank: true, held: heldGuards + 1 };
    }
    return { bank: false, held: heldGuards };
  }

  /* ---------------- puzzle source (mirrors mode-puzzle.js, minimal) -------- */

  function fallbackPuzzle() {
    var cells = [], i, correct;
    for (i = 0; i < 9; i++) cells.push(i === 4 ? null : { shape: 'plus', color: (i % 2 === 0 ? i : i + 2) % 8, rot: i % 4 });
    correct = { shape: 'plus', color: 2, rot: 0 };
    return {
      id: 'fb-dd', kind: 'matrix', difficulty: 1, rule: 'colors advance along rows',
      board: { cols: 3, rows: 3, cells: cells, holeIndex: 4 },
      options: Array.from({ length: 8 }, function (_, i) {
        return { cols: 1, rows: 1, cells: [i ? Object.assign({}, correct, { color: (correct.color + i) % 8 }) : correct] };
      }),
      answer: 0
    };
  }

  function makePuzzle(root, ctx) {
    var Gens = root.Gens || {}, table, gname, gen, kinds, p, okShape;
    table = ctx.tier <= 0 ? ['iqvs', 'iqvs', 'latin', 'cycle']
      : ctx.tier === 1 ? ['iqvs', 'iqvs', 'latin', 'cycle', 'count']
      : ['iqvs', 'latin', 'cycle', 'count', 'dual', 'logicA', 'seqPack'];
    gname = table[Math.floor(ctx.rng() * table.length)];
    gen = Gens[gname];
    kinds = ctx.tier >= 2 ? ['matrix', 'sequence', 'oddone'] : ['matrix', 'matrix', 'sequence'];
    if (gen && gen.generate) {
      try {
        p = gen.generate({ difficulty: ctx.diff, kinds: kinds });
        okShape = p && p.options && p.options.length === 8 && Number.isFinite(p.difficulty) &&
          (p.board || p.seq || p.oddBoard || (p.kind === 'retro' && p.retro));
        if (okShape && (!gen.validate || gen.validate(p).ok !== false)) return p;
      } catch (e) { /* fall through */ }
    }
    try { return root.Puzzles.generate({ difficulty: ctx.diff }); } catch (e) { return fallbackPuzzle(); }
  }

  /* ---------------- registration ---------------- */

  var spec = {
    id: 'dronedodge',
    name: 'DRONE SWARM',
    weight: 6,
    worlds: ['wasteland-roads', 'riot'],
    aligns: ['bad'],
    net: 'seed',
    describe: function () { return { kind: 'dronedodge' }; },
    mount: function (container, ctx) {
      var root = window.IQ = window.IQ || {};
      return new Promise(function (resolve) {
        var S = { done: false, picked: false };
        var motionOn = true, muted = false;
        try { motionOn = window.localStorage.getItem('IQB_MOTION') == null ? true : JSON.parse(window.localStorage.getItem('IQB_MOTION')) !== false; } catch (e) {}
        try { muted = window.localStorage.getItem('IQB_MUTED') === '1'; } catch (e) {}
        try { motionOn = motionOn && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}

        /* ---- seeded world ---- */
        var budget = Math.min(CAP_MS, Math.max(8000, (ctx.timerLen | 0) * 1000));
        var P = paramsFor(ctx.depth);
        var spawns = buildSpawns(ctx.rng, ctx.depth, budget);
        var pz = makePuzzle(root, ctx);
        var impossible = pz.answer === -99 || pz.impossible;
        var order = Array.from({ length: 8 }, function (_, i) { return i; });
        var i, j, t;
        for (i = order.length - 1; i > 0; i--) { j = Math.floor(ctx.rng() * (i + 1)); t = order[i]; order[i] = order[j]; order[j] = t; }

        /* ---- dom ---- */
        var el = document.createElement('div');
        el.className = 'stage-view';
        el.setAttribute('data-stage', 'dronedodge');
        el.innerHTML =
          '<div class="dd-head"><span class="dd-title">SCRAPPER SWARM · DEPTH ' + (ctx.depth | 0) + '</span>' +
          '<span class="dd-hint">dodge with the cursor · answers need cursor presence</span></div>' +
          '<div class="dd-board"></div>' +
          '<div class="dd-opts"></div>' +
          '<canvas class="dd-canvas"></canvas>' +
          '<div class="dd-cursor" aria-hidden="true"></div>' +
          '<div class="dd-foot" role="status"></div>';
        container.appendChild(el);

        var css = document.createElement('style');
        css.textContent =
          '.stage-view[data-stage=dronedodge]{display:flex;flex-direction:column;align-items:center;gap:6px;' +
          'color:#e8e2cf;font-family:\'Oxanium\',monospace;padding:8px;position:relative;touch-action:none}' +
          '.dd-head{width:min(96vw,900px);display:flex;justify-content:space-between;font-size:13px;' +
          'letter-spacing:.18em;color:#ffb01e}.dd-hint{font-size:11px;color:#9b8f6c;letter-spacing:.08em}' +
          '.dd-board svg{max-width:min(92vw,420px);max-height:26vh;height:auto;display:block;margin:0 auto}' +
          '.dd-opts{display:grid;grid-template-columns:repeat(4,minmax(70px,110px));gap:8px;' +
          'position:relative;z-index:3}' +
          '.dd-opts .opt-btn{display:flex;align-items:center;justify-content:center;padding:4px;cursor:pointer;' +
          'border:1px solid rgba(255,176,30,.3);border-radius:6px;background:rgba(10,10,6,.55)}' +
          '.dd-opts .opt-btn svg{width:100%;height:auto}' +
          '.dd-opts .opt-btn.picked{outline:2px solid #ffb01e}.dd-opts .opt-btn.correct{outline:2px solid #00e68a}' +
          '.dd-opts .opt-btn.wrongpick{outline:2px solid #ff2038}' +
          '.dd-canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4}' +
          '.dd-cursor{position:absolute;width:18px;height:18px;border:2px solid #00e68a;border-radius:50%;' +
          'margin:-9px 0 0 -9px;pointer-events:none;z-index:5;box-shadow:0 0 8px rgba(0,230,138,.5)}' +
          '.dd-foot{font-size:12px;letter-spacing:.12em;color:#f4eeda;min-height:34px;text-align:center;' +
          'position:relative;z-index:3}';
        el.appendChild(css);
        if (ctx.mp && ctx.mp.on) {
          var note = document.createElement('div');
          note.className = 'dd-hint';
          note.style.fontSize = '11px';
          note.textContent = 'seed-synced swarm schedule — drones chase YOUR cursor';
          el.insertBefore(note, el.querySelector('.dd-foot'));
        }

        var boardEl = el.querySelector('.dd-board');
        var optsEl = el.querySelector('.dd-opts');
        var canvas = el.querySelector('.dd-canvas');
        var cursorEl = el.querySelector('.dd-cursor');
        var foot = el.querySelector('.dd-foot');
        try {
          var B = root.Board;
          boardEl.innerHTML = B ? B.tileSVG(pz.board || { cols: 1, rows: 1, cells: pz.seq || [{ cols: 1, rows: 1, cells: [null] }] },
            Math.max(160, Math.min(300, window.innerWidth - 140, window.innerHeight - 380)), ctx.tier, true) : '';
        } catch (e) { boardEl.innerHTML = ''; }

        var btns = [];
        var optSvg = (root.Board && root.Board.optTile) || function (p) { return p; };
        order.forEach(function (oi, pos) {
          var b = document.createElement('div');
          b.className = 'opt-btn';
          b.dataset.i = oi;
          try { b.innerHTML = root.Board.tileSVG(optSvg(pz.options[oi]), 84, ctx.tier, false) + '<span class="opt-key">' + (pos + 1) + '</span>'; }
          catch (e) { b.textContent = String(pos + 1); }
          b.addEventListener('click', function () { pick(pos); });
          optsEl.appendChild(b);
          btns.push(b);
        });

        /* ---- audio ---- */
        var AC = null;
        function beep(freq, ms) {
          if (muted) return;
          try {
            if (!AC) { var A = window.AudioContext || window.webkitAudioContext; if (!A) return; AC = new A(); }
            var o = AC.createOscillator(), g = AC.createGain();
            o.type = 'sawtooth'; o.frequency.value = freq;
            g.gain.setValueAtTime(0.05, AC.currentTime);
            g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + ms / 1000);
            o.connect(g).connect(AC.destination);
            o.start(); o.stop(AC.currentTime + ms / 1000);
          } catch (e) {}
        }

        /* ---- guard persistence (cross-round carry, design §0.1) ---- */
        function hooksState() {
          try {
            var H = root.Hooks;
            if (H && H.state) return H.state;
          } catch (e) {}
          return null;
        }
        var guardsHeld = 0;
        var st0 = hooksState();
        if (st0 && typeof st0['droneswarm:guards'] === 'number') guardsHeld = Math.max(0, Math.min(2, st0['droneswarm:guards'] | 0));
        var bankedThisStage = 0, hits = 0;
        function persist() {
          var st = hooksState();
          if (st) { st['droneswarm:guards'] = guardsHeld; st['droneswarm:streakBreaks'] = hits; }
        }
        persist();

        /* ---- clock ---- */
        var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        function now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0; }

        /* ---- cursor ---- */
        var cw = 800, ch = 500, cx = 400, cy = 250;
        function fit() {
          var r = el.getBoundingClientRect();
          cw = Math.max(60, r.width); ch = Math.max(60, r.height);
          canvas.width = Math.round(cw); canvas.height = Math.round(ch);
          cx = Math.max(10, Math.min(cw - 10, cx)); cy = Math.max(10, Math.min(ch - 10, cy));
          placeCursor();
        }
        function placeCursor() {
          cursorEl.style.left = cx + 'px';
          cursorEl.style.top = cy + 'px';
        }
        function localXY(clientX, clientY) {
          var r = el.getBoundingClientRect();
          return [clientX - r.left, clientY - r.top];
        }
        function onMove(e) {
          if (S.done) return;
          var p = localXY(e.clientX, e.clientY);
          cx = Math.max(6, Math.min(cw - 6, p[0]));
          cy = Math.max(6, Math.min(ch - 6, p[1]));
          placeCursor();
        }
        el.addEventListener('pointermove', onMove, { passive: true });
        el.addEventListener('touchmove', function (e) {
          if (e.changedTouches && e.changedTouches[0]) { onMove(e); e.preventDefault(); }
        }, { passive: false });
        function onKey(e) {
          if (e.key === 'Escape') { e.preventDefault(); bail(); return; }
          if (e.key.indexOf('Arrow') === 0 || 'wasd'.indexOf(e.key.toLowerCase()) >= 0) {
            e.preventDefault();
          } else {
            var n = parseInt(e.key, 10);
            if (n >= 1 && n <= 8) pick(n - 1);
            return;
          }
          var k = e.key.toLowerCase(), step = 42;
          if (k === 'arrowleft' || k === 'a') cx -= step;
          if (k === 'arrowright' || k === 'd') cx += step;
          if (k === 'arrowup' || k === 'w') cy -= step;
          if (k === 'arrowdown' || k === 's') cy += step;
          cx = Math.max(6, Math.min(cw - 6, cx));
          cy = Math.max(6, Math.min(ch - 6, cy));
          placeCursor();
        }
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', fit);

        /* ---- drones (local input-relay sim) ---- */
        var drones = [], spawnPtr = 0, lastT = 0, acc = 0;
        var invulnUntil = -1e9;
        var dodgeStreak = 0, dodges = 0;

        function spawnAt(ev) {
          var m = 26, w = cw, h = ch, x, y;
          if (ev.side === 0) { x = ev.off * w; y = -m; }
          else if (ev.side === 1) { x = w + m; y = ev.off * h; }
          else if (ev.side === 2) { x = ev.off * w; y = h + m; }
          else { x = -m; y = ev.off * h; }
          var base = Math.max(70, Math.min(cw, ch) * 0.17);
          drones.push({
            x: x, y: y, a: Math.atan2(ch / 2 - y, cw / 2 - x),
            spd: base * P.speedMul * ev.spd, r: P.hitR,
            age: 0, life: P.life, shard: false
          });
        }
        function splitDrone(idx) {
          var d = drones[idx];
          var shards = [], k;
          for (k = 0; k < 2; k++) {
            shards.push({
              x: d.x, y: d.y, a: wrapAngle(d.a + (k ? 0.7 : -0.7)),
              spd: d.spd * 0.62, r: P.shardR, age: 0, life: P.shardLife, shard: true
            });
          }
          drones.splice.apply(drones, [idx, 1].concat(shards));
        }
        function registerDodge(isSplitSurvive) {
          dodges++;
          if (!isSplitSurvive) dodgeStreak++; else dodgeStreak++;
          var bank = onDodgeBank(dodgeStreak, guardsHeld);
          if (bank.bank) {
            guardsHeld = bank.held;
            bankedThisStage++;
            persist();
            try { ctx.banner('+1 STREAK GUARD BANKED'); } catch (e) {}
            beep(1320, 120);
          }
        }
        function registerHit() {
          hits++;
          dodgeStreak = 0;
          invulnUntil = now() + P.invulnMs;
          persist();
          try { ctx.audio.p('buzz', { vol: 0.4 }); ctx.fx.shake(12, 260); } catch (e) {}
          beep(90, 200);
        }

        function physics(dt) {
          /* due spawns */
          var tn = now();
          while (spawnPtr < spawns.length && spawns[spawnPtr].t <= tn) {
            if (drones.length < P.maxAlive) spawnAt(spawns[spawnPtr]);
            spawnPtr++;
          }
          var idx, d;
          for (idx = drones.length - 1; idx >= 0; idx--) {
            d = drones[idx];
            d.age += dt * 1000;
            steer(d, cx, cy, dt, P.maxTurn);
            /* splitter rule: survived long enough → twin shards */
            if (P.splitters && !d.shard && d.age >= P.splitAt) {
              registerDodge(true);
              splitDrone(idx);
              continue;
            }
            if (d.age >= d.life) { registerDodge(false); drones.splice(idx, 1); continue; }
            var dx = d.x - cx, dy = d.y - cy;
            if (dx * dx + dy * dy < (d.r + P.cursorR) * (d.r + P.cursorR)) {
              if (tn >= invulnUntil) {
                registerHit();
                drones.splice(idx, 1);   /* kamikaze: the diver dies with its sting */
              }
            }
          }
        }

        function draw() {
          var g = canvas.getContext && canvas.getContext('2d');
          if (!g) return;
          g.clearRect(0, 0, canvas.width, canvas.height);
          var invuln = now() < invulnUntil;
          drones.forEach(function (d) {
            g.beginPath();
            g.arc(d.x, d.y, d.r, 0, Math.PI * 2);
            g.fillStyle = d.shard ? 'rgba(255,176,30,.75)' : 'rgba(255,32,56,.85)';
            g.fill();
            /* heading whisker — telegraphs the chase vector (readability rail) */
            g.strokeStyle = 'rgba(255,220,150,.8)';
            g.lineWidth = 2;
            g.beginPath();
            g.moveTo(d.x, d.y);
            g.lineTo(d.x + Math.cos(d.a) * (d.r + 8), d.y + Math.sin(d.a) * (d.r + 8));
            g.stroke();
          });
          cursorEl.style.opacity = invuln ? '0.35' : '1';
        }

        /* ---- resolution ---- */
        var rafId = 0, settleT = 0;
        function finish(res) {
          if (S.done) return;
          S.done = true;
          window.cancelAnimationFrame(rafId);
          window.clearTimeout(settleT);
          window.removeEventListener('keydown', onKey, true);
          window.removeEventListener('resize', fit);
          persist();
          setTimeout(function () { resolve(res); }, 60);
        }
        function basePoints() {
          return Math.round(100 * (Number.isFinite(pz.difficulty) ? pz.difficulty : 1) + (ctx.leftFrac ? ctx.leftFrac() : 0.5) * 80);
        }
        function timeoutResult(summary) {
          return { kind: 'score', correct: null, points: 0, hpDelta: Math.max(-60, -(hits * 7) - 5), summary: summary };
        }
        function bail() {
          if (S.done || S.picked) return;
          S.picked = true;
          finish(timeoutResult('BAILED FROM THE SWARM'));
        }

        function pick(pos) {
          if (S.done || S.picked) return;
          S.picked = true;
          var oi = order[pos];
          var correctOpt = !impossible && oi === pz.answer;
          btns.forEach(function (b, p) { if (p === pos) b.classList.add('picked'); });
          if (!impossible) {
            if (!correctOpt) btns[pos].classList.add('wrongpick');
            setTimeout(function () {
              var cb = btns[order.indexOf(pz.answer)];
              if (cb) cb.classList.add('correct');
            }, 250);
          }
          var res;
          if (impossible) {
            res = { kind: 'score', correct: null, points: 0, hpDelta: Math.max(-60, -(hits * 7)), summary: '' };
          } else if (correctOpt) {
            var pts = basePoints() + 15 * bankedThisStage;
            var sum = bankedThisStage >= 2 ? 'SWARM OUTFLOWN ×2 GUARDS'
              : bankedThisStage === 1 ? 'SWARM OUTFLOWN' : 'STUNG BUT CORRECT';
            res = { kind: 'score', correct: true, points: pts, hpDelta: Math.max(-60, -(hits * 7)), summary: sum };
          } else {
            res = { kind: 'score', correct: false, points: 0, hpDelta: Math.max(-60, -(hits * 7)), summary: 'THE SWARM WON' };
          }
          try { ctx.audio.p(correctOpt ? 'levelup' : 'sting', { vol: 0.35 }); } catch (e) {}
          foot.textContent = res.summary || '';
          settleT = window.setTimeout(function () { finish(res); }, 900);
        }

        /* ---- main loop ---- */
        function frame(ts) {
          if (S.done) return;
          var tn = now();
          if (tn >= budget) { finish(timeoutResult('DODGED FOREVER, ANSWERED NEVER')); return; }
          if (lastT === 0) lastT = ts;
          var dtReal = Math.min(0.05, Math.max(0, (ts - lastT) / 1000));
          lastT = ts;
          if (motionOn) {
            physics(dtReal);
          } else {
            /* motion gate: discrete 400 ms steps, identical rules */
            acc += dtReal;
            while (acc >= 0.4) { acc -= 0.4; physics(0.4); }
          }
          draw();
          foot.textContent = 'guards ' + new Array(guardsHeld + 1).join('\u25C9') + new Array(2 - guardsHeld + 1).join('\u25CB') +
            ' · dodges ' + dodges + ' · stings ' + hits +
            ' · ' + Math.max(0, Math.ceil((budget - tn) / 1000)) + 's';
          rafId = window.requestAnimationFrame(frame);
        }

        fit();
        try { ctx.audio.p('heart', { vol: 0.25 }); } catch (e) {}
        rafId = window.requestAnimationFrame(frame);

        /* ---- smoke hook ---- */
        window.__DD__ = {
          state: function () {
            return {
              done: S.done, picked: S.picked, elapsedMs: Math.round(now()),
              drones: drones.length, dodges: dodges, hits: hits,
              guards: guardsHeld, banked: bankedThisStage, streak: dodgeStreak
            };
          },
          cursor: function (x, y) { cx = x; cy = y; placeCursor(); },
          finish: function () { if (!S.done) finish(timeoutResult('DODGED FOREVER, ANSWERED NEVER')); },
          params: P, spawns: spawns
        };
      });
    }
  };

  if (typeof window !== 'undefined') {
    if (window.IQ && window.IQ.Stage && typeof window.IQ.Stage.register === 'function') {
      window.IQ.Stage.register(spec);
    } else {
      (window.__stagePending = window.__stagePending || []).push(spec);
    }
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { paramsFor: paramsFor, speedMult: speedMult, buildSpawns: buildSpawns, steer: steer, wrapAngle: wrapAngle, onDodgeBank: onDodgeBank };
  }
})();
