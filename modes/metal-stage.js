/* ============================================================================
   modes/metal-stage.js — STAGE "forge-set" (FORGE SET)
   ----------------------------------------------------------------------------
   Heavier twin of the CHART TOPPER rhythm engine. Same 4-lane tap model,
   but: slower chart (BPM 92 vs 118, fewer notes), BIGGER motion-gated shake
   on every hit, DOUBLE POINTS on downbeat accents (every 4th beat — drawn
   gold with a telegraph ring so they are readable before they land), and a
   deterministic scream-along banner pool ('WHOA-OH', 'HEY!', 'RAAAGH', ...)
   fired via ctx.banner on scheduled bars. Miss = combo break only.

   Registration (top-level, idempotent):
     IQ.Stage.register({
       id:'forge-set', name:'FORGE SET', weight:2,
       worlds:['metal-forge'],            // world ensured below (registered here if absent)
       net:'seed',                        // MP pattern: seed-deterministic chart from ctx.rng
       mount(container, ctx) -> Promise<StageResult>,
       describe(), cleanup()
     });

   Controls: D F J K or 1..4 tap lanes; pointer/touch taps pads; Esc ends the
   set early with the current tally (always escapable).

   Result fields:
     correct : true  (>=35% notes hit) -> points = earned (raw; engine layers flavor)
               false (<35%)            -> points:-30, hpDelta:-6
     points  : base 11 good / 16 perfect, downbeat accents x2, +15 per new
               combo-tier of 5; capped 480 raw
     hpDelta : 0 on success (misses NEVER hurt mid-play)
     summary : '<hits>/<total> RIFFS' line, <=48 chars

   Fairness rails: IQB_MOTION off => stepped 110 ms quanta rendering and NO
   shake/banner-fx (judgment math IDENTICAL, uses real time); IQB_MUTED gates
   all synth audio (own oscillators, no samples, no artist references);
   no fullscreen flashes; text >= 11 px; deterministic ctx.rng ONLY; never
   reads hidden answers; host-authoritative scoring (engine clamps).

   Supersedes: net-new takeover stage — no prior modifier-hook ancestor
   (pack hooks stay above stages per research/mode-contract.md §5).

   Smoke hook: window.__FORGE__.{state,tap(lane),finish} per mount.
   ============================================================================ */
(function () {
'use strict';
var root = window.IQ = window.IQ || {};

/* ---------------- world: metal-forge (register only if absent) ------------- */
(function ensureWorld() {
  var W = root.Worlds;
  if (!W || typeof W.register !== 'function') return;
  try {
    if (typeof W.list === 'function' && W.list().indexOf('metal-forge') >= 0) return;
    function h(i) { var x = Math.sin(i * 269.5 + 183.3) * 43758.5453; return x - Math.floor(x); }
    W.register({
      id: 'metal-forge',
      align: 'neutral',
      pal: ['#ff6a1a', '#ffb01e', '#8a4b12', '#14100e', '#2b2018', '#ff2038',
            '#c9c2b8', '#4d3418'],
      /* rising embers over an iron horizon; t=0 fully static */
      draw: function (c, w, h_, t) {
        c.fillStyle = '#14100e'; c.fillRect(0, 0, w, h_);
        var hor = h_ * 0.72;
        var grd = c.createLinearGradient(0, hor - 120, 0, h_);
        grd.addColorStop(0, 'rgba(255,106,26,.05)'); grd.addColorStop(1, 'rgba(255,176,30,.22)');
        c.fillStyle = grd; c.fillRect(0, hor - 120, w, h_ - hor + 120);
        for (var i = 0; i < 36; i++) {
          var ex = h(i) * w;
          var ey = (h(i + 41) + ((t * 0.03 * (0.5 + h(i + 3))) % 1)) % 1;
          var y = hor - ey * hor * 0.9;
          c.globalAlpha = (1 - ey) * (0.35 + 0.45 * Math.abs(Math.sin(t * 0.002 + i)));
          c.fillStyle = i % 3 ? '#ff6a1a' : '#ffb01e';
          c.beginPath(); c.arc(ex, y, 1.5 + h(i + 11) * 3.5, 0, Math.PI * 2); c.fill();
        }
        c.globalAlpha = 1;
        c.fillStyle = '#0b0806';                       /* anvil silhouettes */
        for (var a = 0; a < 5; a++) {
          var ax = (h(a + 61) * 0.9 + 0.05) * w, aw = 40 + h(a + 71) * 60;
          c.fillRect(ax, hor - 14 - aw * 0.18, aw, 10);
          c.fillRect(ax + aw * 0.15, hor - 4, aw * 0.7, 8);
        }
      }
    });
  } catch (e) { /* world backdrop optional */ }
})();

/* ---------------- guards + constants -------------------------------------- */
if (!root.Stage || typeof root.Stage.register !== 'function') return;

var LANES = 4;
var KEYS = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
var SET_MS = 35000;
var LEADIN_MS = 1400;
var TRAVEL_MS = 2100;          // slower, heavier fall
var WINDOW_MS = 130;           // even more generous on the heavy kit
var PERFECT_MS = 60;
var STEP_MS = 110;
var CAP_EARNED = 480;
var BPM = 92;                  // slower than glitter's 118
var BEAT_MS = 60000 / BPM;
var SCREAMS = ['WHOA-OH', 'HEY!', 'RAAAGH', 'LOUDER!', 'BREAK IT DOWN!', 'ONE MORE TIME!'];

function flagOff(name) {
  try {
    var v = window.localStorage.getItem(name);
    if (name === 'IQB_MUTED') return v === '1' || /^(1|true)$/i.test(String(v));
    return /^(0|false)$/i.test(String(v));
  } catch (e) { return false; }
}

/* ---------------- CSS ------------------------------------------------------ */
var CSS =
 '.stage-view[data-stage="forge-set"]{position:absolute;inset:0;display:flex;flex-direction:column;' +
 'align-items:center;gap:8px;padding:10px;font-family:\'Oxanium\',sans-serif;color:#f2ddc8;' +
 'background:rgba(20,16,14,.78)}' +
 '.fg-head{font-size:12px;letter-spacing:.28em;color:#ffb01e;min-height:15px}' +
 '.fg-wrap{position:relative;width:min(96vw,720px);height:min(48vh,380px);background:#100c09;' +
 'border:2px solid #ff6a1a;border-radius:10px;overflow:hidden;touch-action:none}' +
 '.fg-wrap canvas{display:block;width:100%;height:100%}' +
 '.fg-pads{display:flex;width:min(96vw,720px);gap:6px}' +
 '.fg-pad{flex:1;text-align:center;padding:10px 0;font-size:13px;letter-spacing:.18em;' +
 'background:#241a12;border:1px solid #ff6a1a;border-radius:8px;color:#ffd9b0;cursor:pointer;' +
 'user-select:none;-webkit-user-select:none}' +
 '.fg-pad:active,.fg-pad.fg-down{background:#ff6a1a;color:#14100e}' +
 '.fg-foot{font-size:11px;letter-spacing:.14em;color:#b08d68;min-height:15px;text-align:center}' +
 '@media (prefers-reduced-motion:reduce){.stage-view[data-stage="forge-set"] *{animation:none!important}}';

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
    res = { kind: 'score', correct: true, points: Math.min(CAP_EARNED, st.earned),
            hpDelta: 0,
            summary: ('FORGE SET ' + st.hits + '/' + total + ' RIFFS C' + st.bestCombo).slice(0, 48) };
    try { st.ctx.audio.p('levelup', { vol: .3 }); } catch (e) {}
    try { st.ctx.fx.flash('rgba(255,106,26,.15)', 150); } catch (e) {}
  } else {
    res = { kind: 'score', correct: false, points: -30, hpDelta: -6,
            summary: ('OUT OF TUNE ' + st.hits + '/' + total + ' RIFFS').slice(0, 48) };
    try { st.ctx.audio.p('buzz', { vol: .25 }); } catch (e) {}
  }
  teardown();
  setTimeout(function () { st.resolve(res); }, reason === 'early' ? 120 : 450);
}

/* ---------------- chart + scream schedule (seed-deterministic) ------------- */
function buildChart(rng, diff) {
  var dens = Math.min(0.7, 0.32 + 0.08 * (diff | 0));        // sparser than glitter
  var notes = [];
  var beats = Math.floor((SET_MS - LEADIN_MS) / BEAT_MS);
  for (var b = 0; b < beats; b++) {
    var t = LEADIN_MS + b * BEAT_MS;
    var accent = (b % 4) === 0;                               // downbeat accents x2
    if (accent || rng() < dens) {
      notes.push({ t: t, lane: Math.floor(rng() * LANES), accent: accent, judged: false, hit: false });
    }
  }
  notes.sort(function (a, c) { return a.t - c.t; });
  return notes;
}
function buildScreams(rng) {
  var out = [];
  var beats = Math.floor((SET_MS - LEADIN_MS) / BEAT_MS);
  for (var b = 0; b < beats; b++) {
    if (b % 8 === 4) out.push({ at: LEADIN_MS + b * BEAT_MS, txt: SCREAMS[Math.floor(rng() * SCREAMS.length)] });
  }
  return out;
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
      o.type = type || 'square';
      o.frequency.value = freq;
      g.gain.setValueAtTime(gain || 0.05, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + ms / 1000);
      o.connect(g).connect(ac.destination);
      o.start(); o.stop(ac.currentTime + ms / 1000);
    } catch (e) { /* never let audio break gameplay */ }
  }
  return {
    hit: function (lane, accent, perfect) {
      blip(perfect ? [196, 220, 247, 165][lane] : [98, 110, 123, 82][lane], accent ? 200 : 130,
           'square', accent ? 0.06 : 0.05);
      if (accent) blip(392, 90, 'sawtooth', 0.03);            // clang overtone
    },
    miss: function () { blip(70, 220, 'sawtooth', 0.04); },
    stray: function () { blip(240, 40, 'sine', 0.02); }
  };
}

/* ---------------- registration --------------------------------------------- */
root.Stage.register({
  id: 'forge-set',
  name: 'FORGE SET',
  weight: 2,
  worlds: ['metal-forge'],
  net: 'seed',

  mount: function (container, ctx) {
    teardown();
    var motionOn = true;
    try { motionOn = flagOff('IQB_MOTION') === false &&
      !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}

    var notes = buildChart(ctx.rng, ctx.diff);
    var screams = buildScreams(ctx.rng);
    var st = {
      ctx: ctx, notes: notes, screams: screams, done: false, rafId: 0, safetyT: 0,
      t0: (typeof performance !== 'undefined' ? performance.now() : Date.now()),
      earned: 0, hits: 0, misses: 0, combo: 0, bestCombo: 0, lastTier: 0,
      judgeFx: null, screamIdx: 0,
      motionOn: motionOn,
      pal: ['#ffb01e', '#ff6a1a', '#ff2038', '#c9c2b8']
    };
    LIVE = st;

    /* ---- DOM ---- */
    var view = document.createElement('div');
    view.className = 'stage-view';
    view.setAttribute('data-stage', 'forge-set');
    view.innerHTML =
      '<div class="fg-head">FORGE SET \u00B7 HIT THE HEAVY BEAT</div>' +
      '<div class="fg-wrap"><canvas></canvas></div>' +
      '<div class="fg-pads"></div>' +
      '<div class="fg-foot">D F J K / 1-4 or tap \u00B7 GOLD accents pay x2 \u00B7 combos +15/tier \u00B7 Esc ends set</div>';
    container.appendChild(view);
    var styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    view.insertBefore(styleEl, view.firstChild);
    st.root = view;

    var wrap = view.querySelector('.fg-wrap');
    var cv = wrap.querySelector('canvas');
    var g = cv.getContext('2d');
    var pads = view.querySelector('.fg-pads');

    function fit() {
      cv.width = wrap.clientWidth || 640;
      cv.height = wrap.clientHeight || 360;
    }
    fit();
    window.addEventListener('resize', fit);

    var padEls = [];
    for (var i = 0; i < LANES; i++) {
      (function (ln) {
        var p = document.createElement('div');
        p.className = 'fg-pad';
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

    function elapsed() { return performance.now() - st.t0 - LEADIN_MS; }

    function tap(ln) {
      if (st.done) return;
      var pad = padEls[ln];
      if (pad) { pad.classList.add('fg-down'); setTimeout(function () { pad.classList.remove('fg-down'); }, 110); }
      var now = elapsed();
      var best = null, bestDt = Infinity;
      for (var i = 0; i < st.notes.length; i++) {
        var n = st.notes[i];
        if (n.lane !== ln || n.judged) continue;
        var dt = n.t - now;
        if (dt > WINDOW_MS) break;
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
      st.earned += (perfect ? 16 : 11) * (best.accent ? 2 : 1);   // downbeat double points
      st.judgeFx = { txt: best.accent ? 'CRUSHED x2' : (perfect ? 'PERFECT' : 'GOOD'),
                     lane: ln, until: performance.now() + 340 };
      audio.hit(ln, best.accent, perfect);
      if (motionOn) { try { ctx.fx.shake(best.accent ? 18 : 13, 280); } catch (e) {} }  // BIGGER shake
    }

    function sweepMisses(now) {
      for (var i = 0; i < st.notes.length; i++) {
        var n = st.notes[i];
        if (n.judged) continue;
        if (n.t + WINDOW_MS < now) {
          n.judged = true;
          st.misses++; st.combo = 0; st.lastTier = 0;   // combo break ONLY
          st.judgeFx = { txt: 'MISS', lane: n.lane, until: performance.now() + 260 };
          audio.miss();
        } else break;
      }
    }

    function fireScreams(now) {
      while (st.screamIdx < st.screams.length && st.screams[st.screamIdx].at <= now) {
        var s = st.screams[st.screamIdx++];
        try { ctx.banner(s.txt); } catch (e) {}
        st.judgeFx = { txt: s.txt, lane: -1, until: performance.now() + 700, scream: true };
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
      g.strokeStyle = 'rgba(255,106,26,.25)';
      g.lineWidth = 1;
      for (var l = 1; l < LANES; l++) {
        g.beginPath(); g.moveTo(l * laneW, 0); g.lineTo(l * laneW, H); g.stroke();
      }
      g.strokeStyle = '#ffb01e'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(0, hitY); g.lineTo(W, hitY); g.stroke();

      /* notes: heavy squares; gold accents get a telegraph ring early */
      for (var i = 0; i < st.notes.length; i++) {
        var n = st.notes[i];
        if (n.hit) continue;
        var prog = (stepClock - (n.t - TRAVEL_MS)) / TRAVEL_MS;
        if (prog < -0.05 || prog > 1.25) continue;
        var y = prog * hitY;
        var nx = n.lane * laneW + laneW / 2;
        var size = n.accent ? Math.min(30, laneW * 0.32) : Math.min(20, laneW * 0.22);
        g.globalAlpha = n.judged ? 0.25 : 1;
        g.fillStyle = n.accent ? '#ffb01e' : st.pal[n.lane % st.pal.length];
        g.fillRect(nx - size / 2, y - size / 2, size, size);
        g.strokeStyle = '#14100e'; g.lineWidth = 2;
        g.strokeRect(nx - size / 2, y - size / 2, size, size);
        if (n.accent && !n.judged) {                       /* telegraph ring */
          g.strokeStyle = 'rgba(255,176,30,.55)';
          g.beginPath(); g.arc(nx, y, size * 0.85, 0, Math.PI * 2); g.stroke();
        }
        g.globalAlpha = 1;
      }

      g.textAlign = 'center';
      if (st.combo > 1) {
        g.fillStyle = '#ff6a1a';
        g.font = '700 28px \'Oxanium\',sans-serif';
        g.fillText(st.combo + 'x COMBO', W / 2, H * 0.30);
      }
      if (st.judgeFx && performance.now() < st.judgeFx.until) {
        if (st.judgeFx.scream) {                           /* scream-along center card */
          g.fillStyle = '#ffe9c8';
          g.font = '700 30px \'Oxanium\',sans-serif';
          g.fillText(st.judgeFx.txt, W / 2, H * 0.46);
        } else {
          g.fillStyle = st.judgeFx.txt === 'MISS' ? '#ff2038' :
                        (st.judgeFx.txt.indexOf('x2') >= 0 ? '#ffb01e' : '#f2ddc8');
          g.font = '700 18px \'Oxanium\',sans-serif';
          g.fillText(st.judgeFx.txt, Math.max(st.judgeFx.lane, 0) * laneW + laneW / 2, hitY - 26);
        }
      }
      if (now < 0) {
        g.fillStyle = '#ffb01e';
        g.font = '600 15px \'Oxanium\',sans-serif';
        g.fillText('TUNE UP\u2026', W / 2, H / 2);
      }

      head.textContent = 'FORGE SET \u00B7 ' + st.hits + '/' + st.notes.length +
        ' \u00B7 SCORE ' + st.earned + ' \u00B7 ' +
        Math.max(0, Math.ceil((SET_MS - LEADIN_MS - now) / 1000)) + 's';
    }

    var head = view.querySelector('.fg-head');

    function frame() {
      if (st.done) return;
      var now = elapsed();
      sweepMisses(now);
      fireScreams(now);
      if (now >= SET_MS - LEADIN_MS || (st.notes.length && now > st.notes[st.notes.length - 1].t + 800)) { finish('set-end'); return; }
      try { if (ctx.expired) { finish('expired'); return; } } catch (e) {}
      draw();
      st.rafId = requestAnimationFrame(frame);
    }

    /* ---- smoke hook ---- */
    window.__FORGE__ = {
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

    try { ctx.audio.p('heart', { vol: .25 }); } catch (e) {}
    st.safetyT = setTimeout(function () { finish('cap'); }, SET_MS + 2500);
    st.rafId = requestAnimationFrame(frame);

    return new Promise(function (resolve) { st.resolve = resolve; });
  },

  describe: function () { return { kind: 'forge-set', worlds: ['metal-forge'], setLenSec: 35 }; },

  cleanup: function () { try { window.__FORGE__ && window.__FORGE__.finish && window.__FORGE__.finish(); } catch (e) {} }
});
})();
