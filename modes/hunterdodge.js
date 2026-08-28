/* ============================================================
   modes/hunterdodge.js — STAGE "HUNTER DODGE" (W3 themed takeover)
   Design: research/modes-themed-design.md §2 (canonical).
   SUPERSEDES: the pack-hunters 'hunter-beam' slot-lockdown hook on
   its bound world while this stage is registered (takeover wins by
   weight, design §0.4); the hook remains the low-depth fallback.

   Registration shape (research/mode-contract.md):
     window.IQ.Stage.register({
       id:'hunter-dodge', name:'HUNTER DODGE', weight:6, minDepth:3,
       worlds:['cyber-hunter'], aligns:['bad'], net:'relay',
       mount(container, ctx) -> Promise<StageResult>
     });
   If IQ.Stage is absent the stage object is queued on
   window.__stagePending (W3 takeover brief).

   Controls:
     pointer/touch .... cursor IS your body; the hunter's beam
                        TRACKS it with lag — sharp direction changes
                        shake the lock.
     click / keys 1-8 . answer options normally (every approach
                        line is exposed).

   Mechanic (design §2): a chrome hunter patrols a Lissajous curve
   around the board edge (seeded-sim from ctx.rng); its searchlight
   cone chases your cursor at a finite turn rate. Beam overlap
   fills a cumulative EXPOSURE clock (drains at half rate outside
   the cone). Crossing 2.0 s cumulative = damage tick hp -10 +
   400 ms control stutter + meter flash; each additional full
   second re-crosses at hp -6. Depth scaling: turn rate
   x(1+0.15*min(depth-1,10)); cone 24deg -> 16deg; depth >= 8 adds
   a COSMETIC decoy beam in opposite phase (40% opacity, never
   damages — fairness rail).

   StageResult fields resolved:
     kind:    'score'
     correct: true = correct pick · false = wrong pick ·
              null = timer out
     points:  base(round(100*difficulty + leftFrac*80)) [+40 'ghost'
              bonus when peak exposure stayed < 2.0 s (never hit)]
              · 0 on fail/timeout.
     hpDelta: -(accumulated exposure ticks) on win/fail rows;
              -(5+ticks) on timeout. DEVIATION NOTE: design routes
              exposure damage through the live round pipeline;
              until the engine exposes an in-stage hp bridge it
              folds into the final hpDelta (host clamps [-60,60]).
     summary: 'GHOST · UNSEEN, UNSCATHED' | 'HUNTER EVADED' |
              'MARKED BY THE BEAM' | 'IT NEVER BLINKS'

   MP (design §0.2): patrol path + turn rate = seeded-sim — beam
   params are drawn FIRST from ctx.rng in a fixed order, identical
   host/clients. Beam-vs-cursor overlap = input-relay: your
   exposure is yours, resolved locally; clients answer via
   {t:'pick'} frames and resolve relay:false (host reveal is
   authoritative via describe()). The hidden answer NEVER ships in
   frame() and is never read pre-reveal.

   Fairness rails: damage feedback is a localized meter flash +
   vignette (<200 ms); motion via ctx.fx (engine-gated); ambient
   scanline loop disabled under prefers-reduced-motion; no
   blocking overlays; HUD text >= 11 px; touch = pointer parity.

   Self-play / smoke hook (per mount): window.__HD__
     state()        -> {clock,peak,ticks,dmg,finished,inside,
                        origin,heading[,beam params echo under _smoke]}
     pointTo(x,y)   -> synthetic pointer move (smoke)
     commit(pos)/key(n) -> pick an option
     advance(ms)    -> virtual-clock step in 50 ms slices (headless)
   ============================================================ */
(function () {
'use strict';
var root = window.IQ = window.IQ || {};

/* ---------- per-round module state (frame()/describe() read it) ---------- */
var S = {};

/* ---------- constants ---------- */
var CAP_MS = 45000;
var OPTIONS = 8;
var TICK1_HP = 10, REPEAT_HP = 6, TIMEOUT_HP = 5;
var CROSS_S = 2.0, DRAIN_DIV = 2;      /* exposure clock rules */
var GHOST_BONUS = 40;
var STUTTER_MS = 400;
var REVEAL_HOLD_MS = 1100;

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function angDiff(a, b) { /* shortest signed b-a in (-PI,PI] */
  var d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/* ---------- depth scaling (design §2) ---------- */
function paramsFor(depth) {
  var d = clamp(depth | 0, 1, 10);
  return {
    turnRate: 1.7 * (1 + 0.15 * Math.min(d - 1, 10)), /* rad/s beam chase */
    halfRad: lerp(24, 16, (d - 1) / 9) * Math.PI / 360, /* cone HALF width */
    patrolW: 0.55 + 0.03 * Math.min(d - 1, 8),          /* rad/s along Lissajous */
    decoy: d >= 8
  };
}

/* ---------- puzzle sourcing (mirrors mode-puzzle.js discipline) ---------- */
function shuffledOrder(n, rng) {
  var o = []; for (var i = 0; i < n; i++) o.push(i);
  for (var j = o.length - 1; j > 0; j--) { var k = Math.floor(rng() * (j + 1)); var tmp = o[j]; o[j] = o[k]; o[k] = tmp; }
  return o;
}
function fallbackPuzzle() {
  var cells = []; for (var i = 0; i < 9; i++) cells.push(i === 4 ? null : { shape: 'plus', color: (i % 2 === 0 ? i : i + 2) % 8, rot: i % 4 });
  var correct = { shape: 'plus', color: 2, rot: 0 };
  return { id: 'hd-fb', kind: 'matrix', difficulty: 1, rule: 'colors advance along rows',
    board: { cols: 3, rows: 3, cells: cells, holeIndex: 4 },
    options: Array.from({ length: 8 }, function (_, i) { return { cols: 1, rows: 1, cells: [i ? { shape: correct.shape, color: (correct.color + i) % 8, rot: 0 } : correct] }; }),
    answer: 0 };
}
function sourcePuzzle(ctx) {
  var G_ = root.Gens || {};
  var tier = ctx.tier | 0;
  var table = tier <= 0 ? ['iqb', 'iqb', 'latin', 'cycle']
    : tier === 1 ? ['iqb', 'iqb', 'latin', 'cycle', 'count', 'logicA', 'missingSec']
    : tier === 2 ? ['iqb', 'latin', 'cycle', 'count', 'dual', 'dual', 'logicA', 'logicB', 'seqPack', 'missingSec']
    : ['wild', 'wild', 'dual', 'iqb', 'latin', 'logicA', 'logicB', 'seqPack', 'missingSec'];
  var gname = table[Math.floor(ctx.rng() * table.length)];
  if (tier >= 2 && (G_.retroA || G_.retroB) && ctx.rng() < .12) gname = (G_.retroA && (!G_.retroB || ctx.rng() < .5)) ? 'retroA' : 'retroB';
  var gen = G_[gname];
  var kinds = tier >= 2 ? ['matrix', 'sequence', 'oddone'] : ['matrix', 'matrix', 'sequence'];
  var diff = ctx.diff || clamp(1 + Math.floor(((ctx.depth | 0) - 1) / 6), 1, 5);
  if (gen && typeof gen.generate === 'function') {
    try {
      var p = gen.generate({ difficulty: diff, kinds: kinds });
      var ok = p && p.options && p.options.length === 8 && isFinite(p.difficulty) && (p.board || p.seq || p.oddBoard);
      if (ok && (!gen.validate || gen.validate(p).ok !== false)) return p;
    } catch (e) { /* fall through */ }
  }
  try { if (root.Puzzles && typeof root.Puzzles.generate === 'function') return root.Puzzles.generate({ difficulty: diff }); } catch (e) { /* fall through */ }
  return fallbackPuzzle();
}

/* ---------- option art (shared kit, guarded) ---------- */
function boardKit() { return (window.IQ && window.IQ.Board) || null; }
function optionHTML(opt, tier) {
  var b = boardKit();
  if (b && b.optTile && b.tileSVG) {
    try { return b.tileSVG(b.optTile(opt), 92, tier | 0, false); } catch (e) { /* fallback below */ }
  }
  return '<span class="hd-glyph">?</span>';
}
function questionHTML(pz) {
  var b = boardKit();
  if (!pz) return '';
  if (b && b.tileSVG) {
    try {
      if (pz.kind === 'matrix' && pz.board) return b.tileSVG(pz.board, 190, pz._tier | 0, true);
      if (pz.kind === 'sequence' && pz.seq) {
        var cs = 170 / (pz.seq.length + 1);
        var html = '<div style="display:flex;gap:8px;align-items:center">';
        for (var i = 0; i < pz.seq.length; i++) html += b.tileSVG({ cols: 1, rows: 1, cells: [pz.seq[i]] }, cs * .8, pz._tier | 0, false);
        html += b.tileSVG({ cols: 1, rows: 1, cells: [null] }, cs * .8, pz._tier | 0, true) + '</div>';
        return html;
      }
      if (pz.kind === 'oddone' && pz.oddBoard) return b.tileSVG(pz.oddBoard, 190, pz._tier | 0, false);
    } catch (e) { /* fallback below */ }
  }
  return '<div class="hd-qtext">SOLVE — WHILE IT WATCHES</div>';
}

/* ---------- CSS ---------- */
var CSS =
  '.stage-view[data-stage="hunter-dodge"]{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' +
  'gap:6px;padding:8px;background:radial-gradient(130% 110% at 50% 0%,#04101c 0%,#05070f 55%,#020308 100%);' +
  'color:#cfe6ff;font-family:Oxanium,monospace;overflow:hidden}' +
  '.hd-head{width:100%;max-width:760px;display:flex;justify-content:space-between;font-size:13px;letter-spacing:.22em;color:#57d4ff}' +
  '.hd-meta{font-size:11px;letter-spacing:.12em;color:#5f7fa0}' +
  '@media (prefers-reduced-motion:no-preference){.stage-view[data-stage="hunter-dodge"] .hd-canvaswrap::after{content:"";position:absolute;inset:0;' +
  'pointer-events:none;background:repeating-linear-gradient(0deg,rgba(87,212,255,.03) 0 2px,transparent 2px 5px)}}' +
  '.hd-q{min-height:56px;display:flex;justify-content:center}.hd-qtext{font-size:13px;letter-spacing:.2em;color:#cfe6ff;align-self:center}' +
  '.hd-canvaswrap{position:relative;width:100%;max-width:760px;height:min(34vh,270px)}' +
  '.hd-canvaswrap canvas{position:absolute;inset:0;width:100%;height:100%;border:2px solid #10314a;border-radius:6px;' +
  'background:#03080f;touch-action:none}' +
  '.hd-meterrow{display:flex;align-items:center;gap:8px;width:100%;max-width:760px}' +
  '.hd-meterlabel{font-size:11px;letter-spacing:.18em;color:#5f7fa0;white-space:nowrap}' +
  '.hd-meter{flex:1;height:10px;border:1px solid #10314a;border-radius:5px;background:#050b12;overflow:hidden}' +
  '.hd-fill{height:100%;width:0%;background:#00e68a;transition:width .08s linear}' +
  '.hd-fill.warm{background:#ffb01e}.hd-fill.hot{background:#ff2038}' +
  '.stage-view[data-stage="hunter-dodge"].hd-hit .hd-meterrow::before{content:"";position:absolute;left:0;right:0;height:2px;' +
  'background:#ff2038;top:0}'+ /* localized tick flash line, not fullscreen */
  '.hd-opts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;width:100%;max-width:760px}' +
  '.hd-opt{position:relative;display:flex;align-items:center;justify-content:center;min-height:52px;border-radius:6px;' +
  'background:#0a1522;border:2px solid #16324a;cursor:pointer;user-select:none;touch-action:manipulation}' +
  '.hd-opt:hover{border-color:#57d4ff}.hd-okey{position:absolute;top:2px;left:5px;font-size:11px;color:#5f7fa0}' +
  '.hd-glyph{font-size:18px;color:#cfe6ff}' +
  '.hd-opt.picked{outline:2px solid #57d4ff}.hd-opt.correct{outline:2px solid #00e68a;background:#07271a}' +
  '.hd-opt.wrongpick{outline:2px solid #ff2038}' +
  '.hd-foot{font-size:12px;letter-spacing:.14em;color:#9fc3e8;min-height:16px}' +
  '@media (prefers-reduced-motion:reduce){.hd-fill{transition:none}}';

/* ============================================================
   mount
   ============================================================ */
function mount(container, ctx) {
  return new Promise(function (resolve) {
    var client = !!(ctx.mp && ctx.mp.client);
    var budgetMs = Math.min((ctx.timerLen | 0) || 45, 45) * 1000;
    var P = paramsFor(ctx.depth);

    /* ---- seeded-sim beam params: drawn FIRST, fixed order, both sides ---- */
    var ph1 = (ctx.rng() * Math.PI * 2);
    var ph2 = (ctx.rng() * Math.PI * 2);
    var fa = 2 + Math.floor(ctx.rng() * 2);   /* 2..3 lobes x */
    var fb = 3 + Math.floor(ctx.rng() * 2);   /* 3..4 lobes y */
    var h0 = ctx.rng() * Math.PI * 2;         /* initial beam heading */
    var dph = ctx.rng() * Math.PI * 2;        /* decoy phase */

    /* ---- challenge assembly ---- */
    var pz, ord, answerPos;
    if (client) {
      var fr = ctx.frame || null;
      if (!fr || !fr.options) { resolve({ kind: 'score', correct: null, points: 0, hpDelta: 0, summary: 'SIGNAL LOST' }); return; }
      pz = { kind: fr.kind, board: fr.board, oddBoard: fr.oddBoard, seq: fr.seq, options: fr.options, difficulty: fr.diff || 1, answer: -99, _tier: ctx.tier };
      ord = (fr.ord && fr.ord.length === fr.options.length) ? fr.ord : fr.options.map(function (_, i) { return i; });
      answerPos = -1; /* never known pre-reveal on clients */
    } else {
      pz = sourcePuzzle(ctx);
      ord = shuffledOrder(pz.options.length, ctx.rng);
      answerPos = ord.indexOf(pz.answer); /* host/solo secret */
    }

    /* ---- dom ---- */
    var view = document.createElement('div');
    view.className = 'stage-view';
    view.setAttribute('data-stage', 'hunter-dodge');
    var style = document.createElement('style');
    style.textContent = CSS;
    view.appendChild(style);

    var head = document.createElement('div');
    head.className = 'hd-head';
    var title = document.createElement('span');
    title.textContent = 'HUNTER DODGE · DEPTH ' + (ctx.depth | 0);
    var meta = document.createElement('span');
    meta.className = 'hd-meta';
    meta.textContent = 'THE BEAM TRACKS YOUR CURSOR · JUKE IT · CLICK AN ANSWER';
    head.appendChild(title); head.appendChild(meta);

    var q = document.createElement('div');
    q.className = 'hd-q';
    q.innerHTML = questionHTML(pz);

    var wrap = document.createElement('div');
    wrap.className = 'hd-canvaswrap';
    var canvas = document.createElement('canvas');
    wrap.appendChild(canvas);

    var meterRow = document.createElement('div');
    meterRow.className = 'hd-meterrow';
    var mLabel = document.createElement('span');
    mLabel.className = 'hd-meterlabel';
    mLabel.textContent = 'EXPOSURE';
    var meter = document.createElement('div');
    meter.className = 'hd-meter';
    var fill = document.createElement('div');
    fill.className = 'hd-fill';
    meter.appendChild(fill);
    meterRow.appendChild(mLabel); meterRow.appendChild(meter);

    var opts = document.createElement('div');
    opts.className = 'hd-opts';
    var optEls = [];
    for (var pos = 0; pos < OPTIONS; pos++) {
      var ob = document.createElement('div');
      ob.className = 'hd-opt';
      ob.setAttribute('data-pos', String(pos));
      ob.setAttribute('role', 'button');
      var ok = document.createElement('span');
      ok.className = 'hd-okey';
      ok.textContent = String(pos + 1);
      var art = document.createElement('span');
      art.innerHTML = optionHTML(pz.options ? pz.options[ord[pos]] : null, ctx.tier);
      ob.appendChild(ok); ob.appendChild(art);
      (function (p, el) {
        el.addEventListener && el.addEventListener('pointerdown', function () { commit(p, false); });
      })(pos, ob);
      opts.appendChild(ob);
      optEls.push(ob);
    }

    var foot = document.createElement('div');
    foot.className = 'hd-foot';
    view.appendChild(head); view.appendChild(q); view.appendChild(wrap);
    view.appendChild(meterRow); view.appendChild(opts); view.appendChild(foot);
    container.appendChild(view);

    /* ---- canvas sizing (DPR-aware) ---- */
    function fit() {
      var cw = wrap.clientWidth || 640, ch = wrap.clientHeight || 250;
      var dpr = (typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0) ? window.devicePixelRatio : 1;
      canvas.width = Math.max(64, Math.round(cw * dpr));
      canvas.height = Math.max(48, Math.round(ch * dpr));
      try { var g = canvas.getContext('2d'); if (g && g.setTransform) g.setTransform(dpr, 0, 0, dpr, 0, 0); } catch (e) { }
    }
    fit();

    /* ---- round state ---- */
    var t0 = null, lastT = null, finished = false, rafId = 0, safetyT = null, advVirt = 0, relT = 0;
    var pointer = { x: -9999, y: -9999, inn: false };
    var heading = h0;
    var exClock = 0, nextTick = CROSS_S, peak = 0, dmg = 0, ticks = 0, stutUntil = -1;
    var picked = false;

    function say(fn, arg) { try { if (typeof fn === 'function') fn(arg); } catch (e) { } }
    function banner(t) { say(ctx.banner, t); }
    function shake() { try { if (ctx.fx && typeof ctx.fx.shake === 'function') ctx.fx.shake(10, 260); } catch (e) { } }
    function sfx(name) { try { if (ctx.audio && typeof ctx.audio.p === 'function') ctx.audio.p(name); } catch (e) { } }
    function leftFrac() { try { return clamp(+ctx.leftFrac() || 0, 0, 1); } catch (e) { return 1; } }

    function geom() {
      var w = wrap.clientWidth || 640, h = wrap.clientHeight || 250;
      return { w: w, h: h, cx: w / 2, cy: h / 2, ax: w / 2 - 42, ay: h / 2 - 36 };
    }

    /* ---- simulation step (pure f(t); only cursor is player-owned) ---- */
    function step(t, dtSec) {
      var g = geom();
      var ts = t / 1000;
      var ox = g.cx + g.ax * Math.sin(P.patrolW * fa * ts + ph1);
      var oy = g.cy + g.ay * Math.sin(P.patrolW * fb * ts + ph2);

      var inside = false;
      if (pointer.inn && !picked) {
        var dx = pointer.x - ox, dy = pointer.y - oy;
        var toCursor = Math.atan2(dy, dx);
        /* pursuer, not wall: finite turn rate toward the cursor */
        var want = angDiff(heading, toCursor);
        var maxStep = P.turnRate * dtSec;
        heading += clamp(want, -maxStep, maxStep);
        inside = Math.hypot(dx, dy) <= Math.hypot(g.w, g.h) &&
                 Math.abs(angDiff(heading, toCursor)) <= P.halfRad;
      }

      if (!picked) {
        if (inside) exClock += dtSec;
        else exClock = Math.max(0, exClock - dtSec / DRAIN_DIV);
        peak = Math.max(peak, exClock);
        while (exClock >= nextTick) {
          ticks++;
          dmg += (ticks === 1 ? TICK1_HP : REPEAT_HP);
          stutUntil = t + STUTTER_MS;
          nextTick += 1.0;
          view.classList.add('hd-hit');
          setTimeout(function () { view.classList.remove('hd-hit'); }, 160); /* <200 ms rail */
          shake(); sfx('glitch');
          banner(ticks === 1 ? 'SPOTTED · HP \u2212' + TICK1_HP : 'REACQUIRED · HP \u2212' + REPEAT_HP);
        }
      }

      draw(g, ox, oy, ts);
      updateMeter();
      foot.textContent = 'EXPOSURE ' + exClock.toFixed(1) + 's / PEAK ' + peak.toFixed(1) +
        's · HITS ' + ticks + (P.decoy ? ' · DECOY ACTIVE (COSMETIC)' : '');
    }

    function updateMeter() {
      var pct = clamp(exClock / (CROSS_S + 1) * 100, 0, 100);
      fill.style.width = pct.toFixed(1) + '%';
      fill.className = 'hd-fill' + (exClock >= CROSS_S ? ' hot' : (exClock >= CROSS_S / 2 ? ' warm' : ''));
    }

    function draw(g, ox, oy, ts) {
      var cw = canvas.width, ch = canvas.height;
      var dpr = (typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0) ? window.devicePixelRatio : 1;
      var W = cw / dpr, H = ch / dpr;
      var ctx2 = null;
      try { ctx2 = canvas.getContext('2d'); } catch (e) { }
      if (!ctx2) return;
      ctx2.clearRect(0, 0, W, H);
      ctx2.fillStyle = '#03080f';
      ctx2.fillRect(0, 0, W, H);

      /* range ring hint */
      ctx2.strokeStyle = 'rgba(23,50,74,.7)';
      ctx2.beginPath(); ctx2.arc(g.cx, g.cy, Math.min(g.ax, g.ay), 0, Math.PI * 2); ctx2.stroke();

      /* cosmetic decoy (depth>=8): opposite phase, 40% opacity, never damages */
      if (P.decoy) {
        var hd2 = dph + ts * P.turnRate * 0.5 * 0.35;
        wedge(ctx2, g.cx, g.cy, Math.hypot(W, H), hd2, P.halfRad, 'rgba(87,212,255,', 0.072);
      }
      /* live searchlight cone */
      wedge(ctx2, g.cx, g.cy, Math.hypot(W, H), heading, P.halfRad, 'rgba(255,32,56,', 0.18);
      ctx2.strokeStyle = 'rgba(255,32,56,.75)';
      ctx2.lineWidth = 1.5;
      ctx2.beginPath();
      ctx2.moveTo(ox, oy);
      ctx2.lineTo(ox + Math.cos(heading) * Math.hypot(W, H), oy + Math.sin(heading) * Math.hypot(W, H));
      ctx2.stroke();

      /* chrome hunter */
      ctx2.fillStyle = '#cfd8e2';
      ctx2.beginPath(); ctx2.arc(ox, oy, 7, 0, Math.PI * 2); ctx2.fill();
      ctx2.strokeStyle = '#57d4ff';
      ctx2.beginPath(); ctx2.arc(ox, oy, 11, 0, Math.PI * 2); ctx2.stroke();

      /* your body */
      if (pointer.inn) {
        var stunned = relT < stutUntil;
        ctx2.strokeStyle = stunned ? '#ffb01e' : '#00e68a';
        ctx2.lineWidth = 2;
        ctx2.beginPath(); ctx2.arc(pointer.x, pointer.y, 9, 0, Math.PI * 2); ctx2.stroke();
        ctx2.beginPath();
        ctx2.moveTo(pointer.x - 13, pointer.y); ctx2.lineTo(pointer.x - 5, pointer.y);
        ctx2.moveTo(pointer.x + 5, pointer.y); ctx2.lineTo(pointer.x + 13, pointer.y);
        ctx2.stroke();
      }
    }
    function wedge(c2, x, y, R, ang, half, rgbPrefix, alpha) {
      c2.fillStyle = rgbPrefix + alpha + ')';
      c2.beginPath();
      c2.moveTo(x, y);
      c2.arc(x, y, R, ang - half, ang + half);
      c2.closePath();
      c2.fill();
    }

    /* ---- frame tick ---- */
    function tick(now) {
      if (finished) return;
      if (t0 === null) { t0 = now; lastT = now; }
      var dtMs = Math.min(50, now - lastT);
      lastT = now;
      var t = now - t0;
      relT = t;
      step(t, dtMs / 1000);
      if (t >= budgetMs || ctx.expired) finishTimeout();
    }

    /* ---- commit ---- */
    function commit(pos, viaKey) {
      if (finished || picked) return;
      if (pos < 0 || pos >= OPTIONS) return;
      picked = true;
      optEls[pos].classList.add('picked');

      if (client) {
        try { ctx.net.send({ t: 'pick', n: ctx.depth, pos: pos, name: ctx.name, uid: ctx.net.uid() }); } catch (e) { }
        setTimeout(function () {
          resolveOnce({ kind: 'score', correct: false, points: 0, hpDelta: 0, summary: '', relay: false }); /* host reveal tells truth */
        }, REVEAL_HOLD_MS);
        return;
      }

      var correct = ord[pos] === pz.answer;
      if (correct) optEls[pos].classList.add('correct');
      else {
        optEls[pos].classList.add('wrongpick');
        if (answerPos >= 0) optEls[answerPos].classList.add('correct');
      }
      sfx(correct ? 'good' : 'bad');
      var base = Math.round(100 * (pz.difficulty || ctx.diff || 1) + leftFrac() * 80);
      var ghost = correct && peak < CROSS_S;
      setTimeout(function () {
        resolveOnce(correct
          ? { kind: 'score', correct: true, points: base + (ghost ? GHOST_BONUS : 0), hpDelta: -dmg,
              summary: ghost ? 'GHOST · UNSEEN, UNSCATHED' : 'HUNTER EVADED' }
          : { kind: 'score', correct: false, points: 0, hpDelta: -dmg, summary: 'MARKED BY THE BEAM' });
      }, REVEAL_HOLD_MS);
    }

    function finishTimeout() {
      resolveOnce({ kind: 'score', correct: null, points: 0, hpDelta: -(TIMEOUT_HP + dmg), summary: 'IT NEVER BLINKS' });
    }

    /* ---- lifecycle ---- */
    function resolveOnce(res) {
      if (finished) return;
      finished = true;
      teardown();
      resolve(res);
    }
    function teardown() {
      if (rafId) { try { window.cancelAnimationFrame(rafId); } catch (e) { } rafId = 0; }
      if (safetyT) { clearTimeout(safetyT); safetyT = null; }
      try { window.removeEventListener('keydown', onKey, true); } catch (e) { }
      try { view.removeEventListener('pointermove', onMove); } catch (e) { }
      try { window.removeEventListener('resize', onResize); } catch (e) { }
    }
    function onResize() { fit(); }
    function onMove(e) {
      var r = wrap.getBoundingClientRect();
      pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; pointer.inn = true;
    }
    function digitOf(code) {
      var m = /^Digit([1-8])$/.exec(code || '') || /^Numpad([1-8])$/.exec(code || '');
      return m ? +m[1] : 0;
    }
    function onKey(e) {
      var n = digitOf(e.code);
      if (!n) return;
      e.preventDefault();
      commit(n - 1, true);
    }

    try { window.addEventListener('keydown', onKey, true); } catch (e) { }
    try { view.addEventListener('pointermove', onMove); } catch (e) { }
    try { window.addEventListener('resize', onResize); } catch (e) { }

    function loop(now) {
      if (finished) return;
      tick(now);
      if (finished) return; /* tick may resolve */
      if (typeof window.requestAnimationFrame === 'function') rafId = window.requestAnimationFrame(loop);
    }
    if (typeof window.requestAnimationFrame === 'function') rafId = window.requestAnimationFrame(loop);
    safetyT = setTimeout(function () { if (!finished) finishTimeout(); }, budgetMs + 2500);

    /* ---- module state for frame()/describe() ---- */
    S.pz = pz; S.ord = ord; S.answerPos = answerPos; S.client = client; S.optOrder = ord;

    /* ---- self-play / smoke hook ---- */
    window.__HD__ = {
      pointTo: function (x, y) { pointer.x = x; pointer.y = y; pointer.inn = true; },
      commit: function (pos) { commit(pos, false); },
      key: function (n) { commit(n - 1, true); },
      advance: function (ms) { /* virtual clock, 50ms slices like real frames */
        var left = ms;
        while (left > 0 && !finished) {
          var s = Math.min(50, left); left -= s;
          advVirt += s;
          tick(1e9 + advVirt);
        }
      },
      state: function () {
        var g = geom();
        var ts = relT / 1000;
        var st = {
          clock: +exClock.toFixed(3), peak: +peak.toFixed(3), ticks: ticks, dmg: dmg,
          finished: finished, stuttering: relT < stutUntil,
          origin: { x: +(g.cx + g.ax * Math.sin(P.patrolW * fa * ts + ph1)).toFixed(1),
                    y: +(g.cy + g.ay * Math.sin(P.patrolW * fb * ts + ph2)).toFixed(1) },
          heading: +heading.toFixed(4)
        };
        if (ctx._smoke) { st.answerPos = answerPos; st.ord = ord; st.params = P; st.difficulty = pz.difficulty || 1;
          st.seedEcho = { ph1: +ph1.toFixed(6), ph2: +ph2.toFixed(6), fa: fa, fb: fb, h0: +h0.toFixed(6) }; }
        return st;
      },
      finish: finishTimeout
    };
  });
}

/* ---------- engine-facing serializers ---------- */
function frameFn() {
  var pz = S.pz; if (!pz) return null;
  var ob = pz.oddBoard ? { cols: pz.oddBoard.cols, rows: pz.oddBoard.rows, cells: pz.oddBoard.cells } : undefined;
  return { kind: pz.kind, board: pz.board, oddBoard: ob, seq: pz.seq, options: pz.options, ord: S.ord,
           diff: pz.difficulty, imp: pz.impossible ? 1 : 0 }; /* NO answer, NO rule */
}
function describeFn() {
  var pz = S.pz; if (!pz) return null;
  return { kind: 'hunter-dodge', answer: pz.impossible ? -99 : pz.answer, imp: !!pz.impossible,
           difficulty: pz.difficulty, ord: S.optOrder || S.ord, rule: pz.rule || '' };
}

/* ---------- registration (Stage absent -> queue per W3 brief) ---------- */
var STAGE = {
  id: 'hunter-dodge',
  name: 'HUNTER DODGE',
  weight: 6,
  minDepth: 3,
  worlds: ['cyber-hunter'],
  aligns: ['bad'],
  net: 'relay',
  mount: mount,
  frame: frameFn,
  describe: describeFn,
  cleanup: function () { try { window.__HD__ && window.__HD__.finish && window.__HD__.finish(); } catch (e) { } }
};
if (root.Stage && typeof root.Stage.register === 'function') root.Stage.register(STAGE);
else (window.__stagePending = window.__stagePending || []).push(STAGE);
})();
