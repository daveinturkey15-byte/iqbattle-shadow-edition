/* ============================================================================
   modes/laserstorm.js — LASER STORM (themed takeover, design §3)
   research/modes-themed-design.md §3 · bind world 'sky-laser' (align good).
   Supersedes the sky-laser one-shot lance hook once the runner lands.

   Registration shape (research/mode-contract.md v1):
     window.IQ.Stage.register({
       id:'laserstorm', name:'LASER STORM', weight:6,
       worlds:['sky-laser'], aligns:['good'], net:'seed',
       mount(container,ctx) -> Promise<StageResult>
     });
   If IQ.Stage is absent the spec queues onto window.__stagePending.

   Controls:
     pointer/touch — click an option tile; its COLUMN is a lance lane.
     keys 1–8      — pick a column directly (same lane-risk judgement).
     Escape        — bail out (neutral settle, escapable rail).

   Mechanic (seeded-sim): lane order, period, telegraphs and salvos are a pure
   function of (ctx.seed → ctx.rng, round clock). Lane glows telegraph 0.9→0.55s
   ahead, beam fires 0.4s, cools. Clicking inside a FIRING lane vaporizes the
   pick (forceWrong semantics: correct:false) + hp −10. Winning click ≤0.5s
   before an ADJACENT lane fires = "+20 THREADED". Depth ≥5 adds a counter-
   rotating second sweep; depth ≥9 rolls triple-lane salvos — never more than
   half the grid (4/8 lanes) fires at once (solvability rail).

   StageResult fields resolved (design §3 table; live sting folded into the
   end-of-stage hpDelta because the current contract draft exposes no
   mid-stage hp bridge — engine clamps [−60,60]):
     correct: true (win) | false (wrong/vaporized) | null (timeout/bail/impossible)
     points:  base(≈100·diff + leftFrac·80) [+20 threaded] | 0 otherwise
     hpDelta: −10 per vaporize, −5 timeout, else 0
     summary: THREADED THE STORM · STORM RIDE COMPLETE · VAPORIZED MID-THOUGHT
              · WRONG LANE, SAFE MOMENT · THE SKY KEPT FIRING

   Determinism / fairness:
     - Schedule = seeded-sim; click verdicts derive from the round clock,
       bucketed to 60 ms (parity tools re-derive from seed + buckets).
     - All motion behind IQB_MOTION (+prefers-reduced-motion): motion off ⇒
       no canvas beams; firing/warning lanes get static outlines + status text.
     - Audio behind IQB_MUTED. Never reads hidden answers pre-reveal; never
       touches window.G. Self-limits to min(timerLen,45s). Escape always works.

   Smoke hook: window.__LS__.{state,pick,finish} (manual soak); node smokes use
   the exported pure sim (module.exports when in node): paramsFor,
   buildSchedule, lanePhase, firingCount, isVaporized, isThreaded.
   ============================================================================ */
(function () {
  'use strict';
  var CAP_MS = 45000, BUCKET_MS = 60, LANES = 8;

  /* ---------------- pure sim (exported; zero DOM) ---------------- */

  function paramsFor(depth) {
    var u = (Math.max(1, Math.min(10, depth | 0)) - 1) / 9;
    return {
      period: Math.round(3200 - 1800 * u),   /* 3.2 s → 1.4 s */
      tele: Math.round(900 - 350 * u),       /* 0.9 s → 0.55 s */
      beam: 400,
      leadIn: 1600,
      dual: depth >= 5,                      /* counter-rotating second sweep */
      salvo: depth >= 9,                     /* triple-lane salvos */
      salvoP: 0.22,
      maxFiring: LANES / 2                   /* solvability rail */
    };
  }

  function permute(rng) {
    var a = [0, 1, 2, 3, 4, 5, 6, 7], i, j, t;
    for (i = a.length - 1; i > 0; i--) {
      j = Math.floor(rng() * (i + 1));
      t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* Count beams alive during [t, t+dur) among accepted strikes. */
  function firingCount(strikes, t, dur) {
    var n = 0, i, s;
    for (i = 0; i < strikes.length; i++) {
      s = strikes[i];
      if (s.start < t + dur && t < s.start + s.dur) n += 1 + s.extra.length;
    }
    return n;
  }

  function buildSchedule(rng, depth, horizonMs) {
    var P = paramsFor(depth), strikes = [];
    function sweep(offset, dir, id) {
      var order = permute(rng), k = 0, t, lane, s, cand, c, ln;
      for (t = P.leadIn + offset; t - P.tele <= horizonMs; t += P.period, k++) {
        if (k > 0 && k % LANES === 0) order = permute(rng);
        lane = dir > 0 ? order[k % LANES] : LANES - 1 - order[k % LANES];
        s = { lane: lane, start: t, dur: P.beam, tele: P.tele, sweep: id, extra: [] };
        if (P.salvo && rng() < P.salvoP) {
          cand = [(lane + 1) % LANES, (lane + 3) % LANES, (lane + 5) % LANES];
          for (c = 0; c < cand.length && s.extra.length < 2; c++) {
            ln = cand[c];
            if (ln === lane || s.extra.indexOf(ln) >= 0) continue;
            if (firingCount(strikes, t, P.beam) + 1 + s.extra.length + 1 <= P.maxFiring) s.extra.push(ln);
          }
        }
        strikes.push(s);
      }
    }
    sweep(0, rng() < 0.5 ? 1 : -1, 0);
    if (P.dual) sweep(Math.round(P.period / 2), -1, 1);
    strikes.sort(function (a, b) { return a.start - b.start; });
    return { P: P, strikes: strikes };
  }

  function lanePhase(sch, t, lane) {
    var i, s, hit;
    for (i = 0; i < sch.strikes.length; i++) {
      s = sch.strikes[i];
      hit = s.lane === lane || s.extra.indexOf(lane) >= 0;
      if (!hit) continue;
      if (t >= s.start && t < s.start + s.dur) return 'fire';
      if (t >= s.start - s.tele && t < s.start) return 'tele';
    }
    return 'idle';
  }

  function isVaporized(sch, t, lane) { return lanePhase(sch, t, lane) === 'fire'; }

  /* Winning click landed ≤500 ms before an ADJACENT column fires. */
  function isThreaded(sch, t, lane) {
    var i, s, lanes, j, L;
    for (i = 0; i < sch.strikes.length; i++) {
      s = sch.strikes[i];
      lanes = [s.lane].concat(s.extra);
      for (j = 0; j < lanes.length; j++) {
        L = lanes[j];
        if (Math.abs(L - lane) === 1 && s.start - t >= 0 && s.start - t <= 500) return true;
      }
    }
    return false;
  }

  /* ---------------- puzzle source (mirrors mode-puzzle.js, minimal) -------- */

  function fallbackPuzzle() {
    var cells = [], i, correct;
    for (i = 0; i < 9; i++) cells.push(i === 4 ? null : { shape: 'plus', color: (i % 2 === 0 ? i : i + 2) % 8, rot: i % 4 });
    correct = { shape: 'plus', color: 2, rot: 0 };
    return {
      id: 'fb-ls', kind: 'matrix', difficulty: 1, rule: 'colors advance along rows',
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
    id: 'laserstorm',
    name: 'LASER STORM',
    weight: 6,
    worlds: ['sky-laser'],
    aligns: ['good'],
    net: 'seed',
    describe: function () { return { kind: 'laserstorm' }; },
    mount: function (container, ctx) {
      var root = window.IQ = window.IQ || {};
      return new Promise(function (resolve) {
        var S = { done: false, picked: false };
        var motionOn = true, muted = false;
        try { motionOn = window.localStorage.getItem('IQB_MOTION') == null ? true : JSON.parse(window.localStorage.getItem('IQB_MOTION')) !== false; } catch (e) {}
        try { muted = window.localStorage.getItem('IQB_MUTED') === '1'; } catch (e) {}
        try { motionOn = motionOn && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}

        /* ---- schedule + board (seeded) ---- */
        var budget = Math.min(CAP_MS, Math.max(8000, (ctx.timerLen | 0) * 1000));
        var sch = buildSchedule(ctx.rng, ctx.depth, budget);
        var pz = makePuzzle(root, ctx);
        var impossible = pz.answer === -99 || pz.impossible;
        var order = Array.from({ length: LANES }, function (_, i) { return i; });
        var i, j, t;
        for (i = order.length - 1; i > 0; i--) { j = Math.floor(ctx.rng() * (i + 1)); t = order[i]; order[i] = order[j]; order[j] = t; }

        /* ---- dom ---- */
        var el = document.createElement('div');
        el.className = 'stage-view';
        el.setAttribute('data-stage', 'laserstorm');
        el.innerHTML =
          '<div class="ls-head"><span class="ls-title">ORBITAL LANCE GRID · DEPTH ' + (ctx.depth | 0) + '</span>' +
          '<span class="ls-hint">columns are lanes — cross between strikes</span></div>' +
          '<div class="ls-board"></div>' +
          '<div class="ls-lanewrap"><canvas class="ls-canvas"></canvas><div class="ls-lanes"></div></div>' +
          '<div class="ls-foot" role="status"></div>';
        container.appendChild(el);

        var css = document.createElement('style');
        css.textContent =
          '.stage-view[data-stage=laserstorm]{display:flex;flex-direction:column;align-items:center;gap:8px;' +
          'color:#cfe9ff;font-family:\'Oxanium\',monospace;padding:8px}' +
          '.ls-head{width:min(96vw,900px);display:flex;justify-content:space-between;font-size:13px;' +
          'letter-spacing:.18em;color:#7dd3fc}.ls-hint{font-size:11px;color:#5b7f9e;letter-spacing:.08em}' +
          '.ls-board svg{max-width:min(92vw,520px);max-height:34vh;height:auto;display:block;margin:0 auto}' +
          '.ls-lanewrap{position:relative;width:min(96vw,900px)}' +
          '.ls-lanes{display:flex;gap:4px}.ls-lanes .opt-btn{flex:1;min-width:0;display:flex;align-items:center;' +
          'justify-content:center;padding:4px;cursor:pointer;border:1px solid rgba(125,211,252,.25);border-radius:6px;' +
          'transition:border-color .15s,box-shadow .15s}' +
          '.ls-lanes .opt-btn svg{width:100%;max-width:86px;height:auto}' +
          '.ls-lanes .opt-btn.ls-warn{border-color:#ffb01e;box-shadow:0 0 10px rgba(255,176,30,.45)}' +
          '.ls-lanes .opt-btn.ls-hot{border-color:#ff2038;box-shadow:0 0 14px rgba(255,32,56,.6)}' +
          '.ls-lanes .opt-btn.picked{outline:2px solid #7dd3fc}.ls-lanes .opt-btn.correct{outline:2px solid #00e68a}' +
          '.ls-lanes .opt-btn.wrongpick{outline:2px solid #ff2038}' +
          '.ls-canvas{position:absolute;inset:-8px;width:calc(100% + 16px);height:calc(100% + 16px);' +
          'pointer-events:none;z-index:2}' +
          '.ls-foot{font-size:12px;letter-spacing:.12em;color:#eaf6ff;min-height:18px;text-align:center}';
        el.appendChild(css);
        if (ctx.mp && ctx.mp.on) {
          var note = document.createElement('div');
          note.className = 'ls-hint';
          note.style.fontSize = '11px';
          note.textContent = 'seed-synced strike schedule — same seed, same lances';
          el.insertBefore(note, el.querySelector('.ls-foot'));
        }

        var boardEl = el.querySelector('.ls-board');
        var lanesEl = el.querySelector('.ls-lanes');
        var canvas = el.querySelector('.ls-canvas');
        var foot = el.querySelector('.ls-foot');
        try {
          var B = root.Board;
          boardEl.innerHTML = B ? B.tileSVG(pz.board || { cols: 1, rows: 1, cells: pz.seq || [{ cols: 1, rows: 1, cells: [null] }] },
            Math.max(180, Math.min(330, window.innerWidth - 110, window.innerHeight - 340)), ctx.tier, true) : '';
        } catch (e) { boardEl.innerHTML = ''; }

        var btns = [];
        var optSvg = (root.Board && root.Board.optTile) || function (p) { return p; };
        order.forEach(function (oi, pos) {
          var b = document.createElement('div');
          b.className = 'opt-btn';
          b.dataset.i = oi;
          b.dataset.pos = pos;
          try { b.innerHTML = root.Board.tileSVG(optSvg(pz.options[oi]), 84, ctx.tier, false) + '<span class="opt-key">' + (pos + 1) + '</span>'; }
          catch (e) { b.textContent = String(pos + 1); }
          b.addEventListener('click', function () { pick(pos); });
          lanesEl.appendChild(b);
          btns.push(b);
        });

        /* ---- audio ---- */
        var AC = null;
        function beep(freq, ms) {
          if (muted) return;
          try {
            if (!AC) { var A = window.AudioContext || window.webkitAudioContext; if (!A) return; AC = new A(); }
            var o = AC.createOscillator(), g = AC.createGain();
            o.type = 'square'; o.frequency.value = freq;
            g.gain.setValueAtTime(0.04, AC.currentTime);
            g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + ms / 1000);
            o.connect(g).connect(AC.destination);
            o.start(); o.stop(AC.currentTime + ms / 1000);
          } catch (e) {}
        }

        /* ---- clock ---- */
        var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        function now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0; }
        function bucket(ms) { return Math.round(ms / BUCKET_MS) * BUCKET_MS; }

        /* ---- resolution ---- */
        var rafId = 0, settleT = 0;
        function finish(res) {
          if (S.done) return;
          S.done = true;
          window.cancelAnimationFrame(rafId);
          window.clearTimeout(settleT);
          window.removeEventListener('keydown', onKey, true);
          window.removeEventListener('resize', fit);
          setTimeout(function () { resolve(res); }, 60);
        }

        function basePoints() {
          return Math.round(100 * (Number.isFinite(pz.difficulty) ? pz.difficulty : 1) + (ctx.leftFrac ? ctx.leftFrac() : 0.5) * 80);
        }

        function pick(pos) {
          if (S.done || S.picked) return;
          S.picked = true;
          var tc = bucket(now());
          var lane = pos;
          var oi = order[pos];
          var correctOpt = !impossible && oi === pz.answer;
          var vap = isVaporized(sch, tc, lane);
          var threaded = correctOpt && !vap && isThreaded(sch, tc, lane);
          btns.forEach(function (b, p) { if (p === pos) b.classList.add('picked'); });
          if (!impossible && !correctOpt) btns[pos].classList.add('wrongpick');
          if (!impossible) {
            setTimeout(function () {
              var cb = btns[order.indexOf(pz.answer)];
              if (cb) cb.classList.add('correct');
            }, 250);
          }
          var res;
          if (impossible) {
            res = { kind: 'score', correct: null, points: 0, hpDelta: vap ? -10 : 0, summary: '' };
          } else if (vap) {
            res = { kind: 'score', correct: false, points: 0, hpDelta: -10, summary: 'VAPORIZED MID-THOUGHT' };
          } else if (correctOpt) {
            res = {
              kind: 'score', correct: true,
              points: basePoints() + (threaded ? 20 : 0),
              hpDelta: 0,
              summary: threaded ? 'THREADED THE STORM' : 'STORM RIDE COMPLETE'
            };
          } else {
            res = { kind: 'score', correct: false, points: 0, hpDelta: 0, summary: 'WRONG LANE, SAFE MOMENT' };
          }
          try {
            ctx.audio && ctx.audio.p(vap ? 'buzz' : (correctOpt ? 'levelup' : 'sting'), { vol: 0.35 });
            if (vap) { ctx.fx.shake(14, 300); ctx.fx.flash('rgba(255,32,56,.2)', 140); }
          } catch (e) {}
          beep(vap ? 110 : (correctOpt ? 880 : 220), vap ? 240 : 90);
          foot.textContent = res.summary || '';
          settleT = window.setTimeout(function () { finish(res); }, 900);
        }

        function bail() {
          if (S.done || S.picked) return;
          S.picked = true;
          finish({ kind: 'score', correct: null, points: 0, hpDelta: -5, summary: 'BAILED OUT OF THE STORM' });
        }

        function onKey(e) {
          if (e.key === 'Escape') { e.preventDefault(); bail(); return; }
          var n = parseInt(e.key, 10);
          if (n >= 1 && n <= LANES) { e.preventDefault(); pick(n - 1); }
        }
        window.addEventListener('keydown', onKey, true);

        /* ---- render loop ---- */
        var laneRects = [];
        function fit() {
          var r = lanesEl.getBoundingClientRect();
          canvas.width = Math.max(10, Math.round(r.width + 16));
          canvas.height = Math.max(10, Math.round(r.height + 16));
          laneRects = btns.map(function (b) {
            var br = b.getBoundingClientRect();
            return { x: br.left - r.left + 8, w: br.width };
          });
        }
        window.addEventListener('resize', fit);

        function draw() {
          if (S.done) return;
          var tc = now();
          if (tc >= budget) {
            finish({ kind: 'score', correct: null, points: 0, hpDelta: -5, summary: 'THE SKY KEPT FIRING' });
            return;
          }
          var phases = [], l, ph;
          for (l = 0; l < LANES; l++) ph = lanePhase(sch, tc, l), phases.push(ph);
          btns.forEach(function (b, idx) {
            b.classList.toggle('ls-hot', phases[idx] === 'fire');
            b.classList.toggle('ls-warn', phases[idx] === 'tele');
          });
          if (motionOn && canvas.getContext) {
            var g = canvas.getContext('2d');
            g.clearRect(0, 0, canvas.width, canvas.height);
            for (l = 0; l < LANES; l++) {
              if (!laneRects[l]) continue;
              if (phases[l] === 'tele') {
                var nxt = 1e9, k, s;
                for (k = 0; k < sch.strikes.length; k++) {
                  s = sch.strikes[k];
                  if ((s.lane === l || s.extra.indexOf(l) >= 0) && s.start > tc) { nxt = Math.min(nxt, s.start); break; }
                }
                var prog = nxt < 1e9 ? 1 - (nxt - tc) / sch.P.tele : 0;
                g.fillStyle = 'rgba(255,176,30,' + (0.06 + 0.22 * prog).toFixed(3) + ')';
                g.fillRect(laneRects[l].x, 0, laneRects[l].w, canvas.height);
              } else if (phases[l] === 'fire') {
                g.fillStyle = 'rgba(255,32,56,.28)';
                g.fillRect(laneRects[l].x - 3, 0, laneRects[l].w + 6, canvas.height);
                g.fillStyle = 'rgba(255,120,120,.85)';
                g.fillRect(laneRects[l].x + laneRects[l].w * 0.35, 0, laneRects[l].w * 0.3, canvas.height);
              }
            }
          }
          /* status: next lance countdown */
          var ns = null, kk, st;
          for (kk = 0; kk < sch.strikes.length; kk++) {
            st = sch.strikes[kk];
            if (st.start - sch.P.tele > tc) { ns = st; break; }
          }
          var hot = [];
          for (l = 0; l < LANES; l++) if (phases[l] === 'fire') hot.push(l + 1);
          foot.textContent = hot.length ? 'LANE' + (hot.length > 1 ? 'S' : '') + ' ' + hot.join(',') + ' FIRING — HOLD' :
            (ns ? 'next lance lane ' + (ns.lane + 1) + ' in ' + ((ns.start - tc) / 1000).toFixed(1) + 's' : '');
          rafId = window.requestAnimationFrame(draw);
        }

        fit();
        try { ctx.audio && ctx.audio.p('sacrifice', { vol: 0.2 }); } catch (e) {}
        rafId = window.requestAnimationFrame(draw);

        /* ---- smoke hook ---- */
        window.__LS__ = {
          state: function () {
            return { done: S.done, picked: S.picked, elapsedMs: Math.round(now()), lanes: LANES };
          },
          pick: function (pos) { pick(pos); },
          finish: function () { if (!S.done) finish({ kind: 'score', correct: null, points: 0, hpDelta: -5, summary: 'THE SKY KEPT FIRING' }); },
          schedule: sch
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
    module.exports = { paramsFor: paramsFor, buildSchedule: buildSchedule, lanePhase: lanePhase, firingCount: firingCount, isVaporized: isVaporized, isThreaded: isThreaded, LANES: LANES };
  }
})();
