/* ============================================================================
   modes/pop-glitter-stage.js — STAGE "glitter-set" (CHART TOPPER)
   ----------------------------------------------------------------------------
   Pop-music rhythm-tap takeover. Four lane pads; notes fall toward the hit
   line; tap (D F J K / 1-4 / pointer) inside a generous ±120 ms window.
   Combo builds bonus points DIRECTLY (+15 per combo-tier of 5). A missed
   note breaks the combo ONLY — never costs hp or negative points mid-set.
   Set length: 35 s seeded chart. Resolves one canonical StageResult.

   Registration (top-level, idempotent):
     IQ.Stage.register({
       id:'glitter-set', name:'CHART TOPPER', weight:2,
       worlds:['pop-glitter'],            // world ensured below (registered here if absent)
       net:'seed',                        // MP pattern: seed-deterministic chart from ctx.rng
       mount(container, ctx) -> Promise<StageResult>,
       describe(), cleanup()
     });

   Controls: D F J K or 1..4 tap lanes; pointer/touch taps pads; Esc ends the
   set early with the current tally (always escapable).

   Result fields:
    correct : true  (>=35% notes hit)  -> points = earned (raw; engine layers flavor)
              false (<35%)             -> points:-(10+10*diff), hpDelta:-6
    points  : raw earned (base 10 good / 15 perfect + 15 x new combo-tier), capped at
              the economy band top min(480, round((100*diff+40)*1.35)) — a full-combo
              set tops out at ~135% of the puzzle baseline 100*diff+40; median play
              lands inside the 60%-135% takeover band (balance pass 2026-08-25).
    hpDelta : 0 on success (misses NEVER hurt mid-play)
    summary : '<hits>/<total> NOTES' line, <=48 chars

   Fairness rails: IQB_MOTION off => stepped 110 ms quanta rendering, no
   shake/fx (judgment math IDENTICAL, uses real time); IQB_MUTED gates all
   synth audio (own oscillators, no samples); no fullscreen flashes; hazards
   none; text >= 11 px; deterministic ctx.rng ONLY; never reads hidden
   answers; host-authoritative scoring (engine clamps points[-200,500]).

   Supersedes: net-new takeover stage — no prior modifier-hook ancestor
   (pack hooks stay above stages per research/mode-contract.md §5).

   Smoke hook: window.__GLITTER__.{state,tap(lane),finish} per mount.
   ============================================================================ */
(function () {
'use strict';
var root = window.IQ = window.IQ || {};

/* ---------------- world: pop-glitter (register only if absent) ------------- */
(function ensureWorld() {
  var W = root.Worlds;
  if (!W || typeof W.register !== 'function') return;
  try {
    if (typeof W.list === 'function' && W.list().indexOf('pop-glitter') >= 0) return;
    function h(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
    W.register({
      id: 'pop-glitter',
      align: 'good',
      pal: ['#ff2e88', '#ff7ac2', '#ffd23e', '#7dd3fc', '#c77dff', '#ffffff',
            '#1a0b22', '#2d1038'],
      /* bokeh sparkles drifting up; t=0 fully static (worlds.js freezes t) */
      draw: function (c, w, h_, t) {
        c.fillStyle = '#1a0b22'; c.fillRect(0, 0, w, h_);
        for (var i = 0; i < 42; i++) {
          var sx = h(i) * w;
          var sy = (h(i + 99) - ((t * 0.02 * (0.4 + h(i + 7))) % 1) + 1) % 1 * h_;
          var r = 2 + h(i + 31) * 9;
          var tw = 0.25 + 0.55 * Math.abs(Math.sin(t * 0.001 * (0.6 + h(i + 13)) + i));
          var col = ['#ff2e88', '#ffd23e', '#7dd3fc', '#c77dff'][i % 4];
          c.globalAlpha = tw * 0.5;
          c.fillStyle = col;
          c.beginPath(); c.arc(sx, sy, r, 0, Math.PI * 2); c.fill();
        }
        c.globalAlpha = 1;
        var glow = c.createRadialGradient(w * 0.5, h_ * 0.85, 10, w * 0.5, h_ * 0.85, h_ * 0.9);
        glow.addColorStop(0, 'rgba(255,46,136,.14)'); glow.addColorStop(1, 'rgba(26,11,34,0)');
        c.fillStyle = glow; c.fillRect(0, 0, w, h_);
      }
    });
  } catch (e) { /* world backdrop optional */ }
})();

/* ---------------- guards + constants -------------------------------------- */
if (!root.Stage || typeof root.Stage.register !== 'function') return;

var LANES = 4;
var KEYS = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
var SET_MS = 35000;           // the 35 s set
var LEADIN_MS = 1200;
var TRAVEL_MS = 1600;         // fall time top -> hit line (motion path)
var WINDOW_MS = 120;          // generous hit window (+/-)
var PERFECT_MS = 55;
var CAP_EARNED = 480;
var BPM = 118;
var BEAT_MS = 60000 / BPM;
/* ---------------- economy band (balance pass 2026-08-25) -------------------- */
/* Puzzle baseline: good answer pays 100*diff+40 (diff = min(5,1+floor(depth/6)),
   i.e. 140/240/340 at depths 3/8/15). A takeover may pay 60%..135% of that, so
   raw earnings cap at the band TOP: perfect play peaks at ~135% of baseline and
   weaker play scales down inside the band. Fails cost -(10+10*diff) points. */
function diffOf(diff) { return Math.min(5, Math.max(1, (diff | 0) || 1)); }
function bandCap(diff) { return Math.min(CAP_EARNED, Math.round((100 * diffOf(diff) + 40) * 1.35)); }
function failPoints(diff) { return -(10 + 10 * diffOf(diff)); }

function flagOff(name) {
  try {
    var v = window.localStorage.getItem(name);
    if (name === 'IQB_MUTED') return v === '1' || /^(1|true)$/i.test(String(v));
    return /^(0|false)$/i.test(String(v));
  } catch (e) { return false; }
}

/* ---------------- CSS (scoped, injected into the view) --------------------- */
var CSS =
 '.stage-view[data-stage="glitter-set"]{position:absolute;inset:0;display:flex;flex-direction:column;' +
 'align-items:center;gap:8px;padding:10px;font-family:\'Oxanium\',sans-serif;color:#ffe3f1;' +
 'background:rgba(26,11,34,.72)}' +
 '.gt-head{font-size:12px;letter-spacing:.28em;color:#ff9ccb;min-height:15px}' +
 '.gt-wrap{position:relative;width:min(96vw,720px);height:min(48vh,380px);background:#150820;' +
 'border:2px solid #ff2e88;border-radius:10px;overflow:hidden;touch-action:none}' +
 '.gt-wrap canvas{display:block;width:100%;height:100%}' +
 '.gt-pads{display:flex;width:min(96vw,720px);gap:6px}' +
 '.gt-pad{flex:1;text-align:center;padding:10px 0;font-size:13px;letter-spacing:.18em;' +
 'background:#241033;border:1px solid #ff7ac2;border-radius:8px;color:#ffd9ec;cursor:pointer;' +
 'user-select:none;-webkit-user-select:none}' +
 '.gt-pad:active,.gt-pad.gt-down{background:#ff2e88;color:#fff}' +
 '.gt-foot{font-size:11px;letter-spacing:.14em;color:#c98bb4;min-height:15px;text-align:center}' +
 '@media (prefers-reduced-motion:reduce){.stage-view[data-stage="glitter-set"] *{animation:none!important}}';

/* ---------------- module state -------------------------------------------- */
var LIVE = null;

function teardown() {
  if (!LIVE) return;
  LIVE.done = true;
  if (LIVE.rafId) { try { cancelAnimationFrame(LIVE.rafId); } catch (e) {} }
  clearTimeout(LIVE.safetyT);
  window.removeEventListener('keydown', LIVE.onKey, true);
  if (LIVE.root && LIVE.root.parentNode) { try { LIVE.root.parentNode.removeChild(LIVE.root); } catch (e) {} }
  LIVE = null;
}

function finish(reason) {
  if (!LIVE || LIVE.done) return;
  LIVE.done = true;
  var st = LIVE;
  var total = st.notes.length;
  var rate = total ? st.hits / total : 0;
  var res;
  if (rate >= 0.35) {
    res = { kind: 'score', correct: true, points: Math.min(bandCap(st.ctx.diff), st.earned),
            hpDelta: 0,
            summary: ('CHART TOPPER ' + st.hits + '/' + total + ' NOTES C' + st.bestCombo).slice(0, 48) };
    try { st.ctx.audio.p('levelup', { vol: .3 }); } catch (e) {}
    try { st.ctx.fx.flash('rgba(255,210,62,.14)', 130); } catch (e) {}
  } else {
    res = { kind: 'score', correct: false, points: failPoints(st.ctx.diff), hpDelta: -6,
            summary: ('OFF BEAT ' + st.hits + '/' + total + ' NOTES').slice(0, 48) };
    try { st.ctx.audio.p('buzz', { vol: .25 }); } catch (e) {}
  }
  teardown();
  setTimeout(function () { st.resolve(res); }, reason === 'early' ? 120 : 450);
}

/* ---------------- chart generation (seed-deterministic) -------------------- */
function buildChart(rng, diff, tier) {
  var dens = Math.min(0.8, 0.42 + 0.09 * (diff | 0));       // beat occupancy
  var notes = [];
  var beats = Math.floor((SET_MS - LEADIN_MS) / BEAT_MS);
  for (var b = 0; b < beats; b++) {
    var t = LEADIN_MS + b * BEAT_MS;
    if (b === 0 || b === beats - 1 || rng() < dens) {
      notes.push({ t: t, lane: Math.floor(rng() * LANES), judged: false, hit: false });
    }
    if (tier >= 2 && b > 2 && rng() < 0.22) {                // sparkle off-beats, deep tiers
      notes.push({ t: t + BEAT_MS / 2, lane: Math.floor(rng() * LANES), judged: false, hit: false });
    }
  }
  notes.sort(function (a, c) { return a.t - c.t; });
  return notes;
}

/* ---------------- audio (synth only, IQB_MUTED-gated) ---------------------- */
function makeAudio() {
  var ac = null;
  function blip(freq, ms, type, gain) {
    if (flagOff('IQB_MUTED')) return;
    try {
      if (!ac) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
      }
      if (ac.state === 'suspended') { try { ac.resume(); } catch (e) {} }
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(gain || 0.05, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + ms / 1000);
      o.connect(g).connect(ac.destination);
      o.start(); o.stop(ac.currentTime + ms / 1000);
    } catch (e) { /* never let audio break gameplay */ }
  }
  return {
    hit: function (lane, perfect) { blip(perfect ? 1046 : [784, 880, 988, 1175][lane], 90, 'triangle', 0.05); },
    miss: function () { blip(140, 160, 'sawtooth', 0.04); },
    stray: function () { blip(520, 40, 'sine', 0.02); }
  };
}

/* ---------------- registration --------------------------------------------- */
root.Stage.register({
  id: 'glitter-set',
  name: 'CHART TOPPER',
  weight: 2,
  worlds: ['pop-glitter'],
  net: 'seed',

  mount: function (container, ctx) {
    teardown();
    var motionOn = true;
    try { motionOn = flagOff('IQB_MOTION') === false &&
      !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}

    var notes = buildChart(ctx.rng, ctx.diff, ctx.tier);
    var st = {
      ctx: ctx, notes: notes, done: false, rafId: 0, safetyT: 0,
      t0: (typeof performance !== 'undefined' ? performance.now() : Date.now()),
      earned: 0, hits: 0, misses: 0, combo: 0, bestCombo: 0, lastTier: 0,
      judgeFx: null, /* {txt,lane,until} */
      motionOn: motionOn,
      pal: (ctx.board && typeof ctx.board.palRow === 'function' && ctx.board.palRow()) ||
           ['#ff2e88', '#ffd23e', '#7dd3fc', '#c77dff']
    };
    LIVE = st;

    /* ---- DOM ---- */
    var view = document.createElement('div');
    view.className = 'stage-view';
    view.setAttribute('data-stage', 'glitter-set');
    view.innerHTML =
      '<div class="gt-head">CHART TOPPER \u00B7 TAP THE BEAT</div>' +
      '<div class="gt-wrap"><canvas></canvas></div>' +
      '<div class="gt-pads"></div>' +
      '<div class="gt-foot">D F J K / 1-4 or tap \u00B7 \u00B1120ms window \u00B7 combos pay +15/tier \u00B7 Esc ends set</div>';
    container.appendChild(view);
    var styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    view.insertBefore(styleEl, view.firstChild);
    st.root = view;

    var wrap = view.querySelector('.gt-wrap');
    var cv = wrap.querySelector('canvas');
    var g = cv.getContext('2d');
    var pads = view.querySelector('.gt-pads');

    function fit() {
      cv.width = wrap.clientWidth || 640;
      cv.height = wrap.clientHeight || 360;
    }
    fit();
    st.onResize = fit;
    window.addEventListener('resize', fit);

    var padEls = [];
    for (var i = 0; i < LANES; i++) {
      (function (ln) {
        var p = document.createElement('div');
        p.className = 'gt-pad';
        p.textContent = 'DFJK'[ln] + ' \u00B7 ' + (ln + 1);
        p.addEventListener('pointerdown', function (ev) { ev.preventDefault(); tap(ln); });
        pads.appendChild(p);
        padEls.push(p);
      })(i);
    }

    /* ---- input ---- */
    st.onKey = function (e) {
      if (e.repeat) return;
      if (e.code === 'Escape') { finish('early'); return; }
      var ln = KEYS.indexOf(e.code);
      if (ln < 0 && /^Digit\d$/.test(e.code)) ln = (+e.code.slice(5)) - 1;
      if (ln < 0 && /^Numpad\d$/.test(e.code)) ln = (+e.code.slice(6)) - 1;
      if (ln >= 0 && ln < LANES) { e.preventDefault(); tap(ln); }
    };
    window.addEventListener('keydown', st.onKey, true);

    var audio = makeAudio();

    function elapsed() { return (performance.now()) - st.t0 - LEADIN_MS; }

    function tap(ln) {
      if (st.done) return;
      var pad = padEls[ln];
      if (pad) { pad.classList.add('gt-down'); setTimeout(function () { pad.classList.remove('gt-down'); }, 90); }
      var now = elapsed();
      var best = null, bestDt = Infinity;
      for (var i = 0; i < st.notes.length; i++) {
        var n = st.notes[i];
        if (n.lane !== ln || n.judged) continue;
        var dt = n.t - now;
        if (dt > WINDOW_MS) break;                 // sorted: later notes only farther
        var ad = Math.abs(dt);
        if (ad <= WINDOW_MS && ad < bestDt) { bestDt = ad; best = n; }
      }
      if (!best) { audio.stray(); return; }
      best.judged = true; best.hit = true;
      var perfect = bestDt <= PERFECT_MS;
      st.combo++; st.hits++;
      if (st.combo > st.bestCombo) st.bestCombo = st.combo;
      var tier = Math.floor(st.combo / 5);
      if (tier > st.lastTier) { st.earned += 15 * (tier - st.lastTier); st.lastTier = tier; }
      st.earned += perfect ? 15 : 10;
      st.judgeFx = { txt: perfect ? 'PERFECT' : 'GOOD', lane: ln, until: performance.now() + 320 };
      audio.hit(ln, perfect);
      if (motionOn) { try { ctx.fx.shake(5, 120); } catch (e) {} }
    }

    function sweepMisses(now) {
      for (var i = 0; i < st.notes.length; i++) {
        var n = st.notes[i];
        if (n.judged) continue;
        if (n.t + WINDOW_MS < now) {
          n.judged = true;
          st.misses++; st.combo = 0; st.lastTier = 0;   // combo break ONLY — no hp/score pain
          st.judgeFx = { txt: 'MISS', lane: n.lane, until: performance.now() + 260 };
          audio.miss();
        } else break;
      }
    }

    /* ---- render ---- */
    function draw() {
      var W = cv.width, H = cv.height;
      var now = elapsed();
      var hitY = H * 0.84;
      var stepClock = st.motionOn ? now : Math.max(-LEADIN_MS, Math.floor(now / STEP_MS) * STEP_MS);
      g.clearRect(0, 0, W, H);

      var laneW = W / LANES;
      g.strokeStyle = 'rgba(255,122,194,.25)';
      g.lineWidth = 1;
      for (var l = 1; l < LANES; l++) {
        g.beginPath(); g.moveTo(l * laneW, 0); g.lineTo(l * laneW, H); g.stroke();
      }
      /* hit line */
      g.strokeStyle = '#ffd23e'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, hitY); g.lineTo(W, hitY); g.stroke();

      /* notes (fall along motion path; stepped clock when IQB_MOTION off) */
      for (var i = 0; i < st.notes.length; i++) {
        var n = st.notes[i];
        if (n.hit) continue;
        var prog = (stepClock - (n.t - TRAVEL_MS)) / TRAVEL_MS;
        if (prog < -0.05 || prog > 1.25) continue;
        var y = prog * hitY;
        var alpha = n.judged ? 0.25 : 1;
        g.globalAlpha = alpha;
        g.fillStyle = st.pal[n.lane % st.pal.length];
        var nx = n.lane * laneW + laneW / 2;
        g.beginPath(); g.arc(nx, y, Math.min(16, laneW * 0.18), 0, Math.PI * 2); g.fill();
        g.globalAlpha = alpha * 0.5;
        g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.stroke();
        g.globalAlpha = 1;
      }

      /* combo + judge flash */
      g.textAlign = 'center';
      if (st.combo > 1) {
        g.fillStyle = '#ffd23e';
        g.font = '700 26px \'Oxanium\',sans-serif';
        g.fillText(st.combo + 'x COMBO', W / 2, H * 0.32);
      }
      if (st.judgeFx && performance.now() < st.judgeFx.until) {
        g.fillStyle = st.judgeFx.txt === 'MISS' ? '#ff2038' : (st.judgeFx.txt === 'PERFECT' ? '#7cffb2' : '#7dd3fc');
        g.font = '700 18px \'Oxanium\',sans-serif';
        g.fillText(st.judgeFx.txt, st.judgeFx.lane * laneW + laneW / 2, hitY - 26);
      }
      if (now < 0) {
        g.fillStyle = '#ff9ccb';
        g.font = '600 15px \'Oxanium\',sans-serif';
        g.fillText('GET READY\u2026', W / 2, H / 2);
      }

      /* header progress */
      head.textContent = 'CHART TOPPER \u00B7 ' + st.hits + '/' + st.notes.length +
        ' \u00B7 SCORE ' + st.earned + ' \u00B7 ' +
        Math.max(0, Math.ceil((SET_MS - LEADIN_MS - now) / 1000)) + 's';
    }

    var head = view.querySelector('.gt-head');

    function frame() {
      if (st.done) return;
      var now = elapsed();
      sweepMisses(now);
      if (now >= SET_MS - LEADIN_MS || (st.notes.length && now > st.notes[st.notes.length - 1].t + 800)) { finish('set-end'); return; }
      try { if (ctx.expired) { finish('expired'); return; } } catch (e) {}
      draw();
      st.rafId = requestAnimationFrame(frame);
    }

    /* ---- smoke hook ---- */
    window.__GLITTER__ = {
      state: function () {
        return { done: st.done, hits: st.hits, misses: st.misses, combo: st.combo,
                 earned: st.earned, total: st.notes.length, elapsedMs: elapsed(),
                 nextLane: (function () {
                   for (var i = 0; i < st.notes.length; i++) if (!st.notes[i].judged) return st.notes[i].lane;
                   return -1; })() };
      },
      tap: function (ln) { tap(((ln | 0) % LANES + LANES) % LANES); return !st.done; },
      finish: function () { finish('smoke'); }
    };

    try { ctx.audio.p('click', { vol: .25 }); } catch (e) {}
    st.safetyT = setTimeout(function () { finish('cap'); }, SET_MS + 2500);
    st.rafId = requestAnimationFrame(frame);

    return new Promise(function (resolve) { st.resolve = resolve; });
  },

  describe: function () { return { kind: 'glitter-set', worlds: ['pop-glitter'], setLenSec: 35 }; },

  cleanup: function () { try { window.__GLITTER__ && window.__GLITTER__.finish && window.__GLITTER__.finish(); } catch (e) {} }
});
})();
