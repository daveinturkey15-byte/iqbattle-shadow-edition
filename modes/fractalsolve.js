/**
 * modes/fractalsolve.js — FRACTAL SOLVE: find the still point in the deep zoom.
 *
 * Design doc: research/modes-themed-design.md §6.
 * Bind: chaotic-align worlds — primary `cave`; rotate pool `bad-trip`,
 * `upside-down`. Full-screen takeover wrapping a normal generator round inside a
 * slowly zooming Julia-set layer.
 *
 * Registration shape (research/mode-contract.md §1):
 *   window.IQ.Stage.register({
 *     id: 'fractalsolve', name: 'FRACTAL SOLVE', weight: 7, net: 'seed',
 *     worlds: ['cave', 'bad-trip', 'upside-down'], aligns: ['chaotic'],
 *     mount(container, ctx) -> Promise<StageResult>
 *   });
 * If window.IQ.Stage is absent the definition queues onto window.__stagePending.
 *
 * Controls:
 *   - Standard point/click answering: 8 option tiles under the question text.
 *   - HOLD SPACE (or two-finger touch-hold): STABILIZE — freezes the zoom for
 *     1.2 s, costs 3 s of round timer, max twice per round.
 *
 * Mechanic: each option tile carries a procedural glyph motif. The fractal layer
 * shows recurring glyph islands; EXACTLY ONE recurs IN PHASE with the zoom beat
 * (it pops on every cycle wrap) — its glyph marks the correct option. Decoy
 * islands recur off-beat. Solvable by attention alone; stabilize buys reading
 * time.
 *
 * Anti-leak: correctIdx is chosen from ctx.rng FIRST, all layer/island params are
 * drawn from ctx.rng strictly afterwards, and nothing reads engine reveal state —
 * the derivation order guarantees the layer cannot leak hidden answers, and the
 * same seed reproduces identical pixels host/client (seeded-sim, design §0.2).
 *
 * ctx fields consumed:
 *   depth      -> zoom rate x(1+0.08*depth); islands shrink; decoys 2 -> 5;
 *                 depth>=8 adds a seeded lateral-drift component to the path
 *   rng        -> ONLY randomness source (question, motifs, fractal path)
 *   seed       -> identity of the deterministic challenge
 *   mp         -> seed-sync note
 *   timerLen   -> stage budget (capped 45 s; presentation loop caps 40 s)
 *   world/align/hp/score/streak -> header strip, read-only, never mutated
 *
 * StageResult (design §6 table):
 *   correct, zero stabilizes (motion on) -> true, base+30, 'DEEP READER'
 *   correct                              -> true, base,   'PATTERN FOUND IN THE DEEP'
 *   wrong                                -> false, -(10+10*diff), hpDelta 0, 'LOST IN THE ZOOM'
 *   timeout                              -> null, 0, hpDelta -5, 'THE FRACTAL CLOSED OVER YOU'
 *   (balance pass 2026-08-25: base = 100*diff+40 with diff = min(5,1+floor(depth/6)),
 *   matching the engine puzzle baseline 140/240/340 at depths 3/8/15; deep-reader
 *   lands 121%/113%/109% of baseline — inside the 60%-135% takeover band at every
 *   depth. Wrong now costs economy-standard -(10+10*diff) points instead of 0, so
 *   guessing stays better than idling but free spam is gone; timeout (-5 hp) is
 *   never the optimal line.)
 *
 * Fairness rails: IQB_MOTION off => ONE static deep-zoom keyframe, pattern
 * embedded once, stabilize free/inert and the deep-reader bonus disabled
 * (identical vocabulary otherwise); IQB_MUTED gates synth audio; no fullscreen
 * flashes; overlays none; text >= 11 px.
 */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : globalThis;

  var MAX_STABS = 2;
  var STAB_COST_MS = 3000;      // stabilize costs 3 s of round timer
  var FREEZE_MS = 1200;         // zoom freeze window
  var LOOP_CAP_MS = 40000;      // fractal loop cap (design §6)
  var BUF_W = 144, BUF_H = 108; // low-res escape-time buffer, upscaled
  var ITER = 26;
  var DEEP_BONUS = 30;          // zero-stabilize solve bonus (economy pass 2026-08-25)

  /** Puzzle-economy difficulty: min(5, 1+floor(depth/6)) — baseline 100*diff+40. */
  function diffFor(depth) { return clamp(1 + Math.floor((depth | 0) / 6), 1, 5); }

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

  /** Zoom-cycle period shrinks as zoom rate rises: rate x(1+0.08*depth). */
  function zoomPeriodFor(depth) {
    return 6 / (1 + 0.08 * clamp(depth | 0, 0, 12));
  }
  /** Recurring decoy islands: 2 -> 5 across depths. */
  function decoysFor(depth) {
    return clamp(2 + Math.floor(Math.max((depth | 0) - 1, 0) / 3), 2, 5);
  }

  /**
   * All MP-visible layer parameters, drawn from rng AFTER the question/correct
   * index exist (anti-leak ordering). Islands[0] is the TRUE one (phase 0 =
   * locked to the beat); decoys sit strictly off-phase so they never masquerade
   * as the in-phase recurrence.
   */
  function deriveLayerParams(rng, depth, trueMotif, decoyMotifs) {
    var period = zoomPeriodFor(depth);
    var kfs = [];
    for (var k = 0; k < 3; k++) kfs.push({ re: -0.7 + rng() * 1.4, im: -0.7 + rng() * 1.4 });
    var p = {
      period: period,
      keyframes: kfs,
      center: { re: -0.2 + rng() * 0.4, im: -0.2 + rng() * 0.4 },
      zoomK: 2.0 + rng() * 0.8,
      driftAmp: depth >= 8 ? 0.06 + rng() * 0.09 : 0,
      driftFreq: 0.25 + rng() * 0.5,
      islandScale: Math.max(0.55, 1 - 0.05 * clamp(depth - 1, 0, 9)),
      islands: []
    };
    var spots = [];
    function spot() {
      for (var tries = 0; tries < 40; tries++) {
        var s = { fx: 0.14 + rng() * 0.72, fy: 0.16 + rng() * 0.68 };
        var clear = true;
        for (var j = 0; j < spots.length; j++) {
          if (Math.abs(s.fx - spots[j].fx) < 0.17 && Math.abs(s.fy - spots[j].fy) < 0.17) clear = false;
        }
        if (clear) return s;
      }
      return s;
    }
    var t = spot(); spots.push(t);
    p.islands.push({ fx: t.fx, fy: t.fy, phase: 0, motif: trueMotif });          // TRUE island
    for (var d = 0; d < decoysFor(depth); d++) {
      var ph = 0.14 + rng() * 0.72;                                              // strictly off-beat
      var sp = spot(); spots.push(sp);
      p.islands.push({ fx: sp.fx, fy: sp.fy, phase: ph, motif: decoyMotifs[d % decoyMotifs.length] });
    }
    return p;
  }

  /** Normalized cycle position [0,1) at t seconds. */
  function phaseOf(tSec, period) {
    return (((tSec % period) + period) % period) / period;
  }
  /** Island brightness peaks exactly at its recurrence phase (gaussian bump). */
  function islandAlpha(phase, islPhase, frozen) {
    if (frozen) return 0.9;
    var d = Math.abs(phase - islPhase);
    if (d > 0.5) d = 1 - d;
    return 0.18 + 0.82 * Math.exp(-(d * d) / 0.0022);
  }

  /* ---------- deterministic mini-generator (self-contained round) ---------- */
  function genQuestion(rng) {
    var fam = Math.floor(rng() * 3);
    var q, ans;
    if (fam === 0) {
      var a = 2 + Math.floor(rng() * 12), d = 2 + Math.floor(rng() * 8);
      q = a + ' · ' + (a + d) + ' · ' + (a + 2 * d) + ' · ' + (a + 3 * d) + ' · ' + (a + 4 * d) + ' · ?';
      ans = a + 5 * d;
    } else if (fam === 1) {
      var x = 2 + Math.floor(rng() * 10), b = 1 + Math.floor(rng() * 15), m = 2 + Math.floor(rng() * 4);
      q = m + 'x + ' + b + ' = ' + (m * x + b) + '  ·  x = ?';
      ans = x;
    } else {
      var n = 3 + Math.floor(rng() * 9);                       // sum of first n odds = n^2
      q = 'sum of the first ' + n + ' odd numbers = ?';
      ans = n * n;
    }
    var opts = [String(ans)];
    while (opts.length < 8) {
      var delta = 1 + Math.floor(rng() * 13);
      var cand = String(rng() < 0.5 ? ans - delta : ans + delta);
      if (opts.indexOf(cand) < 0) opts.push(cand);
    }
    // shuffle option positions (rng-driven; correctIdx tracked through swap)
    var correctIdx = 0;
    for (var i = opts.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = opts[i]; opts[i] = opts[j]; opts[j] = tmp;
      if (correctIdx === i) correctIdx = j;
      else if (correctIdx === j) correctIdx = i;
    }
    // motif assignment: shuffle motif ids over the 8 options
    var motifIdx = [0, 1, 2, 3, 4, 5, 6, 7];
    for (var k = motifIdx.length - 1; k > 0; k--) {
      var j2 = Math.floor(rng() * (k + 1));
      var tmp2 = motifIdx[k]; motifIdx[k] = motifIdx[j2]; motifIdx[j2] = tmp2;
    }
    return { q: q, opts: opts, correctIdx: correctIdx, motifIdx: motifIdx };
  }

  /* ---------- scoring mapping (design §6 table + economy pass 2026-08-25) ----------
   * correct: base = 100*diff+40 (engine puzzle baseline), zero-stabilize motion-on
   *          solves add DEEP_BONUS. wrong: -(10+10*diff) pts, hp untouched (the
   *          zoom never wounds directly — only the -5 hp timeout does). timeout:
   *          null / 0 / -5 hp, strictly dominated by attempting.
   * diff comes in on res.diff; absent => diff 1 (shallow rounds). */
  function scoreFor(res) {
    var d = clamp((res.diff | 0) || 1, 1, 5);
    if (res.correct === true) {
      var deep = res.stabs === 0 && res.motionOn;
      return {
        correct: true,
        points: 100 * d + 40 + (deep ? DEEP_BONUS : 0),
        hpDelta: 0,
        summary: deep ? 'DEEP READER' : 'PATTERN FOUND IN THE DEEP'
      };
    }
    if (res.correct === false) {
      return { correct: false, points: -(10 + 10 * d), hpDelta: 0, summary: 'LOST IN THE ZOOM' };
    }
    return { correct: null, points: 0, hpDelta: -5, summary: 'THE FRACTAL CLOSED OVER YOU' };
  }

  /* ====================================================================== */

  function def() {
    return {
      id: 'fractalsolve',
      name: 'FRACTAL SOLVE',
      weight: 7,
      net: 'seed',
      worlds: ['cave', 'bad-trip', 'upside-down'],
      aligns: ['chaotic'],
      mount: function (container, ctx) {
        return new Promise(function (resolve) {
          var depth = Math.max(1, ctx.depth | 0);
          var motion = motionOn();
          var diff = diffFor(depth);           // economy pass: payout tracks puzzle baseline

          /* question FIRST (anti-leak ordering), then the layer params */
          var quiz = genQuestion(ctx.rng);
          var wrongMotifs = [];
          for (var wi = 0; wi < 8; wi++) if (wi !== quiz.correctIdx) wrongMotifs.push(wi);
          // seeded shuffle of decoy motif order (still rng-only, post-answer)
          for (var ws = wrongMotifs.length - 1; ws > 0; ws--) {
            var wj = Math.floor(ctx.rng() * (ws + 1));
            var wt = wrongMotifs[ws]; wrongMotifs[ws] = wrongMotifs[wj]; wrongMotifs[wj] = wt;
          }
          var layer = deriveLayerParams(ctx.rng, depth,
            quiz.motifIdx[quiz.correctIdx], wrongMotifs);

          /* ---------- dom ---------- */
          var wrap = document.createElement('div');
          wrap.className = 'stage-view';
          wrap.setAttribute('data-stage', 'fractalsolve');
          var head = document.createElement('div');
          head.className = 'iq-fs-head';
          var title = document.createElement('span');
          title.textContent = 'FRACTAL SOLVE · DEPTH ' + depth;
          var meta = document.createElement('span');
          meta.className = 'iq-fs-meta';
          meta.textContent = 'which motif recurs IN PHASE with the zoom beat?' +
            (ctx.mp && ctx.mp.on ? ' · seed-synced' : '');
          head.appendChild(title); head.appendChild(meta);

          var boardWrap = document.createElement('div');
          boardWrap.className = 'iq-fs-board';
          var cv = document.createElement('canvas');
          boardWrap.appendChild(cv);

          var qEl = document.createElement('div');
          qEl.className = 'iq-fs-q';
          qEl.textContent = quiz.q;

          var optsEl = document.createElement('div');
          optsEl.className = 'iq-fs-opts';
          var tiles = [];
          for (var oi = 0; oi < 8; oi++) {
            (function (idx) {
              var b = document.createElement('button');
              b.className = 'iq-fs-opt';
              var g = document.createElement('canvas');
              g.width = 30; g.height = 30; g.className = 'iq-fs-glyph';
              drawGlyph(g.getContext('2d'), quiz.motifIdx[idx], 15, 15, 10, '#eafefe');
              var lbl = document.createElement('span');
              lbl.textContent = quiz.opts[idx];
              b.appendChild(g); b.appendChild(lbl);
              b.addEventListener('click', function () { answer(idx); });
              optsEl.appendChild(b); tiles.push(b);
            })(oi);
          }

          var foot = document.createElement('div');
          foot.className = 'iq-fs-foot';

          wrap.appendChild(head); wrap.appendChild(boardWrap);
          wrap.appendChild(qEl); wrap.appendChild(optsEl); wrap.appendChild(foot);
          var style = document.createElement('style');
          style.textContent =
            '.stage-view[data-stage=fractalsolve]{position:absolute;inset:0;display:flex;' +
            'flex-direction:column;align-items:center;gap:8px;padding:8px;' +
            "font-family:'Oxanium',monospace;background:#05030d;color:#dcd6ff}" +
            '.iq-fs-head{display:flex;gap:16px;font-size:13px;letter-spacing:.2em;' +
            'color:#9d8cff;text-transform:uppercase}.iq-fs-meta{font-size:11px;color:#7d74b8}' +
            '.iq-fs-board{position:relative;width:min(92vw,560px);flex:1;min-height:110px;' +
            'border:1px solid #241a4a;border-radius:8px;overflow:hidden}' +
            '.iq-fs-board canvas{width:100%;height:100%;display:block}' +
            '.iq-fs-q{font-size:16px;color:#fff;text-shadow:0 1px 2px #000}' +
            '.iq-fs-opts{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;' +
            'width:min(92vw,560px)}' +
            '.iq-fs-opt{display:flex;align-items:center;gap:6px;justify-content:center;' +
            'background:#140f2e;border:1px solid #33256b;border-radius:6px;color:#eafefe;' +
            'font-size:13px;padding:6px 4px;cursor:pointer;min-height:38px}' +
            '.iq-fs-opt:hover{border-color:#9d8cff}' +
            '.iq-fs-foot{font-size:11px;color:#7d74b8;min-height:15px;letter-spacing:.12em}';
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
              o.type = 'triangle'; o.frequency.value = freq;
              gn.gain.setValueAtTime(0.04, actx.currentTime);
              gn.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + ms / 1000);
              o.connect(gn).connect(actx.destination);
              o.start(); o.stop(actx.currentTime + ms / 1000);
            } catch (e) {}
          }

          /* ---------- glyphs (procedural motifs) ---------- */
          function drawGlyph(g, m, x, y, r, col) {
            g.save(); g.translate(x, y);
            g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2;
            var i, a;
            switch (m % 8) {
              case 0: g.beginPath();                                     // triangle
                for (i = 0; i < 3; i++) { a = -Math.PI / 2 + i * 2.0944; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
                g.closePath(); g.stroke(); break;
              case 1: g.strokeRect(-r * 0.75, -r * 0.75, r * 1.5, r * 1.5); break;   // square
              case 2: g.beginPath();                                     // diamond
                g.moveTo(0, -r); g.lineTo(r, 0); g.lineTo(0, r); g.lineTo(-r, 0);
                g.closePath(); g.stroke(); break;
              case 3: g.beginPath(); g.moveTo(-r, 0); g.lineTo(r, 0);    // cross
                g.moveTo(0, -r); g.lineTo(0, r); g.stroke(); break;
              case 4: g.beginPath();                                     // spiral
                for (i = 0; i <= 20; i++) { a = i * 0.35; var rr = (i / 20) * r; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); }
                g.stroke(); break;
              case 5: g.beginPath(); g.moveTo(-r, -r * 0.6);             // zigzag
                g.lineTo(-r * 0.33, r * 0.6); g.lineTo(r * 0.33, -r * 0.6);
                g.lineTo(r, r * 0.6); g.stroke(); break;
              case 6: g.beginPath();                                     // hexagon
                for (i = 0; i <= 6; i++) { a = i * 1.0472; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
                g.closePath(); g.stroke(); break;
              default: g.beginPath();                                    // chevron
                g.moveTo(-r, -r * 0.5); g.lineTo(0, r * 0.5); g.lineTo(r, -r * 0.5);
                g.stroke();
            }
            g.restore();
          }

          /* ---------- julia renderer ---------- */
          var buf = document.createElement('canvas');
          buf.width = BUF_W; buf.height = BUF_H;
          var bufG = buf.getContext('2d');
          var img = bufG.createImageData(BUF_W, BUF_H);
          var PAL = [];
          for (var pi = 0; pi < 32; pi++) {
            var tt = pi / 31;
            PAL.push([Math.round(18 + 90 * tt), Math.round(8 + 60 * tt), Math.round(40 + 200 * tt)]);
          }
          var lastCompute = 0;

          function juliaFrame(phase) {
            var kfi = phase * 3;
            var k0 = Math.floor(kfi) % 3, k1 = (k0 + 1) % 3;
            var u = kfi - Math.floor(kfi);
            var su = u * u * (3 - 2 * u);                        // smoothstep
            var cre = layer.keyframes[k0].re + (layer.keyframes[k1].re - layer.keyframes[k0].re) * su;
            var cim = layer.keyframes[k0].im + (layer.keyframes[k1].im - layer.keyframes[k0].im) * su;
            var scale = 1.7 / Math.pow(layer.zoomK, phase);      // zoom-in then beat snap
            var cxr = layer.center.re + (layer.driftAmp ? layer.driftAmp * Math.sin(layer.driftFreq * 6.283 * clockSec()) : 0);
            var cyr = layer.center.im;
            var data = img.data;
            var aspect = BUF_W / BUF_H;
            var p = 0;
            for (var y = 0; y < BUF_H; y++) {
              var zy0 = cyr + ((y / BUF_H) - 0.5) * scale;
              for (var x = 0; x < BUF_W; x++) {
                var zx0 = cxr + ((x / BUF_W) - 0.5) * scale * aspect;
                var zx = zx0, zy = zy0, n = 0;
                while (n < ITER && zx * zx + zy * zy < 4) {
                  var nxt = zx * zx - zy * zy + cre;
                  zy = 2 * zx * zy + cim; zx = nxt; n++;
                }
                var ci = n >= ITER ? 0 : 31 - Math.floor((n / ITER) * 31);
                var col = PAL[n >= ITER ? 0 : ci];
                data[p++] = col[0]; data[p++] = col[1]; data[p++] = col[2]; data[p++] = 255;
              }
            }
            bufG.putImageData(img, 0, 0);
          }

          function fitBoard() {
            var r = boardWrap.getBoundingClientRect();
            cv.width = Math.max(120, Math.round(r.width));
            cv.height = Math.max(90, Math.round(r.height));
          }
          fitBoard();

          function drawIslands(phase, frozen) {
            var W = cv.width, H = cv.height;
            var rad = Math.min(W, H) * 0.075 * layer.islandScale;
            for (var i = 0; i < layer.islands.length; i++) {
              var isl = layer.islands[i];
              var al = islandAlpha(phase, isl.phase, frozen);
              var ix = isl.fx * W, iy = isl.fy * H;
              var gg = cv.getContext('2d');
              gg.save();
              gg.globalAlpha = al;
              gg.fillStyle = '#0b0620';
              gg.strokeStyle = '#ffe9b8'; gg.lineWidth = 2;
              gg.beginPath(); gg.arc(ix, iy, rad, 0, Math.PI * 2); gg.fill(); gg.stroke();
              drawGlyph(gg, isl.motif, ix, iy, rad * 0.55, '#ffd75e');
              gg.restore();
            }
          }

          /* ---------- state machine ---------- */
          var finished = false, resolved = false;
          var stabsUsed = 0;
          var frozenUntil = 0;
          var penaltyMs = 0;                     // stabilize timer cost accrues here
          var budgetMs = Math.min((ctx.timerLen | 0) > 0 ? ctx.timerLen * 1000 : 45000, 45000);
          var nowFn = function () { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); };
          var t0 = nowFn();
          var rafId = 0, frame = 0, staticDone = false;

          function clockSec() { return (nowFn() - t0) / 1000; }
          function remainingMs() { return budgetMs - (nowFn() - t0) - penaltyMs; }

          function answer(idx) {
            if (finished) return;
            beep(idx === quiz.correctIdx ? 880 : 160, idx === quiz.correctIdx ? 80 : 160);
            finish(scoreFor({ correct: idx === quiz.correctIdx, stabs: stabsUsed, motionOn: motion, diff: diff }));
          }

          function stabilize() {
            if (finished) return false;
            if (!motion) return false;           // motion off: inert AND free
            if (stabsUsed >= MAX_STABS || nowFn() < frozenUntil) return false;
            stabsUsed++;
            frozenUntil = nowFn() + FREEZE_MS;
            penaltyMs += STAB_COST_MS;
            foot.textContent = 'STABILIZED — reading time bought (' +
              (MAX_STABS - stabsUsed) + ' left · -3s)';
            beep(520, 120);
            return true;
          }

          function finish(result) {
            if (finished) return;
            finished = true;
            root.clearTimeout(watchdog);
            root.cancelAnimationFrame(rafId);
            root.removeEventListener('keydown', onKey, true);
            cv.removeEventListener('touchstart', onTouch);
            root.removeEventListener('resize', fitBoard);
            foot.textContent = result.summary;
            tiles.forEach(function (t, i) { if (i === quiz.correctIdx) t.style.borderColor = '#00e68a'; });
            if (!resolved) { resolved = true; resolve({
              kind: 'score',
              correct: result.correct,
              points: result.points,
              hpDelta: result.hpDelta,
              summary: result.summary.length <= 48 ? result.summary : result.summary.slice(0, 48)
            }); }
          }

          var watchdog = root.setTimeout(function () {
            finish(scoreFor({ correct: null, diff: diff }));
          }, Math.min(budgetMs, LOOP_CAP_MS));

          /* ---------- loop ---------- */
          function loop() {
            if (finished) return;
            frame++;
            var frozen = nowFn() < frozenUntil;
            var rem = remainingMs();
            if (rem <= 0) { finish(scoreFor({ correct: null, diff: diff })); return; }

            var phase = phaseOf(clockSec(), layer.period);
            if (motion) {
              if (frozen) {
                // frozen: keep last buffer, just repaint islands at full alpha
              } else if (frame % 2 === 0 || lastCompute === 0) {
                juliaFrame(phase);
                lastCompute = frame;
              }
            } else if (!staticDone) {
              juliaFrame(0.35);                  // one static deep-zoom keyframe
              staticDone = true;
            }

            var g = cv.getContext('2d');
            g.imageSmoothingEnabled = true;
            g.drawImage(buf, 0, 0, cv.width, cv.height);
            drawIslands(phase, frozen || !motion);

            foot.textContent = motion
              ? 'SPACE = stabilize (' + (MAX_STABS - stabsUsed) + ' left, -3s) · ' +
                Math.ceil(Math.min(rem, LOOP_CAP_MS) / 1000) + 's'
              : 'static frame · stabilize not needed · ' + Math.ceil(rem / 1000) + 's';

            rafId = root.requestAnimationFrame(loop);
          }

          /* ---------- input ---------- */
          function onKey(e) {
            if (e.code === 'Space' || e.key === ' ') {
              e.preventDefault();
              if (!e.repeat) stabilize();
            }
          }
          function onTouch(e) {
            if (e.touches && e.touches.length >= 2) {
              e.preventDefault();
              stabilize();
            }
          }
          root.addEventListener('keydown', onKey, true);
          cv.addEventListener('touchstart', onTouch, { passive: false });
          root.addEventListener('resize', fitBoard);

          root.__FRACTALSOLVE__ = {
            answer: function (i) { return answer(i); },
            stabilize: stabilize,
            state: function () {
              return {
                stabsLeft: MAX_STABS - stabsUsed, stabsUsed: stabsUsed,
                frozen: nowFn() < frozenUntil, resolved: resolved,
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

    // 1. scaling curves
    ok('zoom period shrinks with depth', zoomPeriodFor(1) > zoomPeriodFor(5) && zoomPeriodFor(5) > zoomPeriodFor(12));
    ok('zoom rate x(1+0.08d) exact', Math.abs(zoomPeriodFor(10) * (1 + 0.08 * 10) - 6) < 1e-9);
    ok('decoys ladder 2 -> 5', decoysFor(1) === 2 &&
      decoysFor(1) <= decoysFor(4) && decoysFor(4) <= decoysFor(8) &&
      decoysFor(10) === 5 && decoysFor(99) === 5);

    // 2. generator determinism + integrity
    var q1 = genQuestion(mulberry(4242)), q2 = genQuestion(mulberry(4242));
    ok('same seed -> identical question', JSON.stringify(q1) === JSON.stringify(q2));
    ok('8 unique options', new Set(q1.opts).size === 8 && q1.opts.length === 8);
    ok('answer present among options', q1.opts[q1.correctIdx] != null);
    ok('motifs are a permutation', JSON.stringify(q1.motifIdx.slice().sort()) === '[0,1,2,3,4,5,6,7]');
    var answers = [];
    for (var s = 0; s < 50; s++) answers.push(genQuestion(mulberry(s)).opts[genQuestion(mulberry(s)).correctIdx]);
    ok('answers vary across seeds', new Set(answers).size > 5);

    // 3. anti-leak ordering: layer derived after question still deterministic
    function fullDerive(seed, depth) {
      var r = mulberry(seed);
      var q = genQuestion(r);
      var wm = []; for (var i = 0; i < 8; i++) if (i !== q.correctIdx) wm.push(i);
      return JSON.stringify(deriveLayerParams(r, depth, q.motifIdx[q.correctIdx], wm));
    }
    ok('layer params deterministic per seed', fullDerive(9, 3) === fullDerive(9, 3));

    // 4. exactly one in-phase island; decoys strictly off-phase
    [1, 5, 9].forEach(function (d) {
      var r = mulberry(d * 31 + 7);
      var q = genQuestion(r);
      var wm = []; for (var i = 0; i < 8; i++) if (i !== q.correctIdx) wm.push(i);
      var L = deriveLayerParams(r, d, q.motifIdx[q.correctIdx], wm);
      var inPhase = L.islands.filter(function (isl) { return isl.phase === 0; });
      ok('depth ' + d + ': exactly one in-phase island', inPhase.length === 1);
      ok('depth ' + d + ': decoy count matches ladder', L.islands.length === 1 + decoysFor(d));
      ok('depth ' + d + ': decoys off-beat', L.islands.slice(1).every(function (isl) {
        return isl.phase >= 0.1 && isl.phase <= 0.9;
      }));
      ok('depth ' + d + ': true island carries correct option motif',
        L.islands[0].motif === q.motifIdx[q.correctIdx]);
    });

    // 5. phase math + island brightness
    ok('phase wraps in [0,1)', phaseOf(0, 5) === 0 && phaseOf(5, 5) === 0 &&
      Math.abs(phaseOf(7.3, 5) - 0.46) < 1e-9 &&
      phaseOf(-0.001, 5) >= 0 && phaseOf(-0.001, 5) < 1);
    ok('true island brightest AT the beat',
      islandAlpha(0, 0, false) > islandAlpha(0.2, 0, false));
    ok('off-phase island dimmer than true at beat',
      islandAlpha(0, 0, false) > islandAlpha(0, 0.37, false));
    ok('freeze pins readability', islandAlpha(0.3, 0.3, true) === 0.9);

    var s1 = scoreFor({ correct: true, stabs: 0, motionOn: true, diff: 1 }),
      s2 = scoreFor({ correct: true, stabs: 1, motionOn: true, diff: 1 }),
      s3 = scoreFor({ correct: false, diff: 1 }), s4 = scoreFor({ correct: null, diff: 3 }),
      s5 = scoreFor({ correct: true, stabs: 0, motionOn: false, diff: 1 }),
      s6 = scoreFor({ correct: true, stabs: 0, motionOn: true, diff: 2 }),
      s7 = scoreFor({ correct: true, stabs: 0, motionOn: true, diff: 3 }),
      s8 = scoreFor({ correct: false, diff: 3 });
    ok('deep reader bonus gated on zero stabs + motion',
      s1.points === 170 && s1.summary === 'DEEP READER');
    ok('stabilized solve pays base only', s2.points === 140);
    ok('motion-off solve never earns deep reader', s5.points === 140);
    ok('payouts track puzzle baseline at depth (d2/d3 deep reader)',
      s6.points === 270 && s7.points === 370);
    ok('band check: deep reader inside 60%-135% of baseline at depths 3/8/15',
      [ [s1.points, 140], [s6.points, 240], [s7.points, 340] ].every(function (p) {
        return p[0] >= p[1] * 0.6 && p[0] <= p[1] * 1.35;
      }));
    ok('wrong costs economy-standard points', s3.points === -20 && s8.points === -40);
    ok('timeout = null/-5hp regardless of diff', s4.correct === null && s4.hpDelta === -5);
    [s1, s2, s3, s4, s5, s6, s7, s8].forEach(function (v) { ok('summary <=48: ' + v.summary, v.summary.length <= 48); });

    var fails = checks.filter(function (c) { return !c.ok; });
    checks.forEach(function (c) { console.log((c.ok ? '  ok  ' : 'FAIL  ') + c.name); });
    console.log(fails.length ? '[fractalsolve] smoke FAILURES: ' + fails.length : '[fractalsolve] smoke: ALL PASS');
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
  root.IQ.FractalSolve = { _smoke: _smoke };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      _smoke: _smoke,
      genQuestion: genQuestion, deriveLayerParams: deriveLayerParams,
      scoreFor: scoreFor, phaseOf: phaseOf, islandAlpha: islandAlpha,
      diffFor: diffFor,
      zoomPeriodFor: zoomPeriodFor, decoysFor: decoysFor
    };
  }

  register();
})();
