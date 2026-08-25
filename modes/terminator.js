/* ============================================================
   modes/terminator.js — STAGE "THE HUNT" (themed gap-closing wave)
   World bind: 'cyber-hunter' (registered in worlds-pop.js — NOT re-registered).
   SUPERSEDES: the pack-hunters 'hunter-beam' slot-lockdown hook on this
   world while this stage is registered (takeover wins by weight,
   research/modes-themed-design.md §0.4); the hook body stays as the
   low-depth fallback until parity smoke passes (deletion, no shim).

   Registration shape (research/mode-contract.md):
     window.IQ.Stage.register({
       id:'terminator-hunt', name:'THE HUNT',
       weight:5, minDepth:3, worlds:['cyber-hunter'],
       net:'seed' (default),
       mount(container, ctx) -> Promise<StageResult>
     });
   If IQ.Stage is absent the def queues on window.__stagePending
   (same W3 convention as every sibling mode file).

   Controls:
     pointer/touch ... your cursor IS you: it lives in the SAFE ZONE
                       strip at the bottom; the machine stalks the
                       lane your cursor-column is nearest to.
     keys 1-4 / click  answer the current micro-pattern (4 options).

   Mechanic (full takeover):
     - The board splits into a spawn GATE (top), SIX exposed LANES,
       and your SAFE ZONE strip (bottom). A T-800-parody silhouette
       marches DOWN the lanes toward your cursor-zone at a seeded,
       depth-scaled base speed (clock-pure integration, dt<=50ms).
     - Its column chases your cursor-x at a finite rate (pursuer,
       not wall) so sharp jukes visibly re-aim it.
     - Micro-patterns: a seeded 3-glyph sequence + one hole; pick
       the next glyph from 4 options before the pattern timer ends.
         * correct AND fast (<= 55% of budget): SOLVED — it is
           shoved BACK one lane and stalls briefly.
         * correct but slow: SOLVED (counts toward escape) but it
           keeps/gains ground — nothing pushes it back.
         * wrong pick or pattern timer expiry: it ADVANCES one lane.
    - REACHES YOUR ZONE (pos >= 6 lanes): catch -> exposure tick hp -10
       first contact, then -6 per subsequent catch (folded into the final
       StageResult hpDelta, host-clamped [-60,60] — never instant-death from
       full hp: 5 catches max by clock = 34 hp), screen glitch (engine
       motion-gated), heavy thud, and it RESETS TWO LANES back with the
       parody banner "IT COMES BACK."
     - RED EYE SCAN: periodic gutter-only glow flash, <=150 ms,
       rate-limited (>=500 ms gap); static glow when motion is off.
     - METALLIC FOOTSTEP THUDS: WebAudio (lazy AudioContext),
       cadence tied to distance marched, louder with proximity;
       fully silenced by IQB_MUTED.

   Win / lose (StageResult fields resolved):
     kind:    'score'
     correct: true  = escaped (door slam) OR survived to the cap ·
              false = never returned (survival exit is a win row;
              there is no losing row — the catch damage IS the cost) ·
              null  = engine-abort fallback only (cleanup path).
    points:  escapeFor(diff) = 100*diff+80 door-slam escape · 80 survival
             exit (45 s cap) · 0 on the abort fallback. Engine clamps
             [-200,500]. Escape tracks the takeover band [0.6,1.35]x puzzle
             payout at every diff tier; survival is always worse (timeout
             never optimal).
    hpDelta: -(10 first catch, then 6 each further), folded live-damage
             style exactly like hunterdodge.js documents (no in-stage hp
             bridge yet); host clamps to [-60,60].
     summary: 'DOOR SLAM · ESCAPED THE HUNT' |
              'SURVIVED THE HUNT · IT WAITS' | 'HUNT ABORTED'
     Depth scaling: base speed 0.055->0.223 lanes/s, column-chase
     120->300 px/s, pattern budget 6.8 s -> 4.0 s, patterns needed
     to escape 2 -> 4 (depth 3/6/9 thresholds).

   Determinism (research/modes-themed-design.md §0.2, seeded-sim +
   local input): EVERY sim parameter is drawn FIRST from ctx.rng in
   a fixed order (column phase, scan phase, scan period, drift
   lobes) — identical on host and every client from ctx.seed alone.
   Micro-patterns are generated sequentially from the SAME stream,
   so the whole challenge is reproducible from (seed, depth). No
   Date.now()/performance.now() in gameplay decisions; verdicts
   reduce to discrete lane events. net:'seed': the ENGINE relays
   the StageResult ({t:'sr'}) — no custom frames, hidden answers
   never ship anywhere.

   Fairness rails: catch feedback = ctx.fx.glitch/shake (engine
   motion-gated) + localized track flash (never fullscreen); eye
   flash <=150 ms gutter-only, <=3 Hz equivalent; IQB_MOTION off /
   prefers-reduced-motion => static glow, no flashes; IQB_MUTED =>
   zero audio; all text >= 11 px; escapable at any moment (self-
   resolves <= 45 s, promise settles EXACTLY once); pointer and
   keyboard fully at parity; never reads hidden answers (it owns
   the whole surface); never touches window.G or localStorage
   beyond the standard IQB_MOTION/IQB_MUTED flag reads.

   Self-play / smoke hook (per mount): window.__HUNT__
     state()      -> {pos,solved,need,catches,dmg,finished,pattern:
                      {kind,answerIdx,fastMs},paused,marchOn}
     choose(i)    -> commit option i (0-based) programmatically
     advance(ms)  -> virtual-clock step in 50 ms slices (headless)
     finish()     -> force the survival-exit resolution
   ============================================================ */
(function () {
'use strict';
var root = window.IQ = window.IQ || {};

/* ---------- module-level pending slot ---------- */
var LAST = null;

/* ---------- constants ---------- */
var CAP_S = 45;
var LANES = 6;
var RESET_LANES = 2;
/* Exposure ticks follow the themed-design hunter ladder (-10 first contact,
 * -6 per subsequent catch) instead of a flat -12: early pressure stays scary,
 * deep-run death spirals ease off, worst case by clock = 10+4*6 = 34 hp. */
var CATCH_HP_FIRST = 10;
var CATCH_HP_NEXT = 6;
/* Escape pay scales on the shared diff ladder min(5,1+floor((depth-1)/6)):
 * 100*diff+80 keeps depth-3 behaviour (180) and lands every tier inside the
 * takeover band [0.6,1.35]x puzzle payout 100*diff+40. Survival exit stays a
 * flat 80: always worse than escaping (timeout never optimal). */
function diffFor(depth) {
  return Math.min(5, Math.max(1, 1 + ((((depth | 0) - 1) / 6) | 0)));
}
function escapeFor(diff) { return 100 * diff + 80; }
var SURVIVE_POINTS = 80;
var EYE_FLASH_MS = 150;
var EYE_MIN_GAP_MS = 500;
var PUSHBACK_STALL_MS = 1100;   /* stall after a FAST solve shoves it */
var WRONG_STALL_MS = 350;       /* beat between advance and next pattern */
var CATCH_STALL_MS = 1600;
var OPTIONS = 4;

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

/* ---------- flags (standard repo-wide readers) ---------- */
function motionOff() {
  try {
    var v = root.localStorage ? localStorage.getItem('IQB_MOTION') : null;
    if (v != null && JSON.parse(v) === false) return true;
  } catch (e) {}
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch (e) { return false; }
}
function audioMuted() {
  try {
    var v = root.localStorage ? localStorage.getItem('IQB_MUTED') : null;
    return v === '1' || JSON.parse(v) === true;
  } catch (e) { return false; }
}

/* ---------- depth scaling (assignment: advance speed, patterns 2->4) ---------- */
function needFor(depth) {
  return clamp(2 + Math.floor((((depth | 0) - 3) / 3)), 2, 4);
}
function paramsFor(depth) {
  var d = clamp((depth | 0) - 1, 0, 14);
  return {
    v: 0.055 + 0.012 * d,                              /* lanes/s base march */
    colRate: 120 + 18 * clamp(d, 0, 10),               /* px/s column chase */
    patMs: clamp(6800 - 280 * ((depth | 0) - 1), 4000, 6800),
    fastFrac: 0.55,
    need: needFor(depth)
  };
}

/* ---------- micro-pattern factory (pure fn of rng; fixed draw order) ----- */
var SHAPES = ['square', 'diamond', 'tri', 'hex', 'ring'];
var COLORS = ['#57d4ff', '#00e68a', '#ffb01e', '#ff2038', '#c084fc', '#ff8bd0', '#7ef29a', '#6ecbff'];
function shuffle(n, rng) {
  var o = []; for (var i = 0; i < n; i++) o.push(i);
  for (var j = o.length - 1; j > 0; j--) {
    var k = Math.floor(rng() * (j + 1));
    var t = o[j]; o[j] = o[k]; o[k] = t;
  }
  return o;
}
/* kinds: 0 color-step · 1 rotation-step · 2 count-step */
function makePattern(rng) {
  var kind = Math.floor(rng() * 3);
  var vals = [];
  var i, base, step;
  if (kind === 0) {
    var shape = SHAPES[Math.floor(rng() * SHAPES.length)];
    base = Math.floor(rng() * 8);
    step = 1 + Math.floor(rng() * 3);   /* any step 1..3 cycles safely mod 8 */
    for (i = 0; i < 3; i++) vals.push((base + i * step) % 8);
    return finish(kind, vals, (base + 3 * step) % 8, 8, rng, function (v) {
      return glyphSVG(shape, v, 0, 1);
    }, 'COLOR STEPS FORWARD');
  }
  if (kind === 1) {
    var col = Math.floor(rng() * 8);
    var shape2 = SHAPES[Math.floor(rng() * 4)]; /* square/diamond/tri/hex: rotation is visible (ring is not) */
    step = 1 + Math.floor(rng() * 2);
    base = Math.floor(rng() * 8);       /* 45-deg rotation units */
    for (i = 0; i < 3; i++) vals.push((base + i * step) % 8);
    return finish(kind, vals, (base + 3 * step) % 8, 8, rng, function (v) {
      return glyphSVG(shape2, col, v * 45, 1);
    }, 'ROTATION MARCHES ON');
  }
  base = 1 + Math.floor(rng() * 2);
  step = 1 + Math.floor(rng() * 2);
  for (i = 0; i < 3; i++) vals.push(base + i * step);
  return finish(kind, vals, base + 3 * step, 9, rng, function (v) {
    return dotsSVG(v);
  }, 'THE COUNT GROWS');
}
function finish(kind, vals, answerVal, space, rng, render, ruleTxt) {
  var pool = [];
  for (var d = 1; d < space && pool.length < 3; d++) {
    var cand = (answerVal + d) % space;
    if (vals.indexOf(cand) === -1 && pool.indexOf(cand) === -1) pool.push(cand);
  }
  /* guarantee exactly 3 unique distractors even in tight spaces */
  var v2 = 0;
  while (pool.length < 3 && v2 < space) {
    if (v2 !== answerVal && pool.indexOf(v2) === -1 && vals.indexOf(v2) === -1) pool.push(v2);
    v2++;
  }
  var ordVals = [answerVal].concat(pool);
  var ord = shuffle(ordVals.length, rng);
  var opts = [], seqHTML = [], answerIdx = 0;
  for (var i = 0; i < ord.length; i++) {
    opts.push({ v: ordVals[ord[i]], html: render(ordVals[ord[i]]) });
    if (ord[i] === 0) answerIdx = i;
  }
  for (var j = 0; j < vals.length; j++) seqHTML.push(render(vals[j]));
  return { kind: kind, vals: vals, seqHTML: seqHTML, opts: opts, answerIdx: answerIdx, rule: ruleTxt };
}
function glyphSVG(shape, colorIdx, rotDeg, scale) {
  var c = COLORS[colorIdx % 8];
  var s = 40 * (scale || 1);
  var inner;
  if (shape === 'square') inner = '<rect x="8" y="8" width="24" height="24"/>';
  else if (shape === 'diamond') inner = '<rect x="8" y="8" width="24" height="24" transform="rotate(45 20 20)"/>';
  else if (shape === 'hex') inner = '<polygon points="20,5 33,12.5 33,27.5 20,35 7,27.5 7,12.5"/>';
  else inner = '<circle cx="20" cy="20" r="13" fill="none" stroke="' + c + '" stroke-width="5"/>';
  return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 40 40"><g transform="rotate(' + (rotDeg || 0) + ' 20 20)" fill="' + c + '">' + inner + '</g></svg>';
}
function dotsSVG(n) {
  var out = '<svg width="40" height="40" viewBox="0 0 40 40">';
  var cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
  var pad = 6, cw = (40 - pad * 2) / cols, ch = (40 - pad * 2) / rows;
  for (var i = 0; i < n; i++) {
    var cx = pad + cw * (i % cols) + cw / 2, cy = pad + ch * Math.floor(i / cols) + ch / 2;
    out += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="3.2" fill="#ffb01e"/>';
  }
  return out + '</svg>';
}

/* ---------- CSS ---------- */
var CSS =
  '.stage-view[data-stage="terminator-hunt"]{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' +
  'gap:6px;padding:8px;background:radial-gradient(130% 115% at 50% 0%,#170408 0%,#0b0206 55%,#030104 100%);' +
  'color:#ffd9de;font-family:Oxanium,monospace;overflow:hidden}' +
  '.th-head{width:100%;max-width:720px;display:flex;justify-content:space-between;font-size:13px;letter-spacing:.22em;color:#ff5a76}' +
  '.th-meta{font-size:11px;letter-spacing:.12em;color:#a06a76}' +
  '.th-rule{font-size:12px;letter-spacing:.24em;color:#ffb01e;min-height:16px;text-align:center}' +
  '.th-seq{display:flex;gap:10px;align-items:center;justify-content:center;min-height:52px}' +
  '.th-cell{display:flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:6px;' +
  'background:#160a10;border:2px solid #47121f}' +
  '.th-hole{border-color:#ffb01e;color:#ffb01e;font-size:20px;background:#1d0a08}' +
  '.th-opts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;width:100%;max-width:480px}' +
  '.th-opt{position:relative;display:flex;align-items:center;justify-content:center;min-height:54px;border-radius:6px;' +
  'background:#120609;border:2px solid #47121f;cursor:pointer;user-select:none;touch-action:manipulation}' +
  '.th-opt:hover{border-color:#ff5a76}.th-okey{position:absolute;top:2px;left:6px;font-size:11px;color:#a06a76}' +
  '.th-opt.picked{outline:2px solid #ffb01e}.th-opt.right{outline:2px solid #00e68a;background:#07271a}' +
  '.th-opt.wrongpick{outline:2px solid #ff2038}' +
  '.th-wrap{position:relative;width:100%;max-width:720px;height:min(32vh,250px)}' +
  '.th-wrap canvas{position:absolute;inset:0;width:100%;height:100%;border:2px solid #47121f;border-radius:6px;' +
  'background:#070204;touch-action:none}' +
  '.th-gutter{position:absolute;top:0;right:0;bottom:0;width:26px;pointer-events:none;border-left:1px solid #2c0a12;' +
  'display:flex;align-items:flex-start;justify-content:center}' +
  '.th-eye{margin-top:14px;width:10px;height:10px;border-radius:50%;background:#5c0713;' +
  'box-shadow:0 0 4px rgba(255,32,56,.25)}' +
  '@media (prefers-reduced-motion:no-preference){.th-wrap.scan .th-eye{background:#ff2038;' +
  'box-shadow:0 0 14px 3px rgba(255,32,56,.85)}}' +
  '.th-callout{position:absolute;left:0;right:26px;top:42%;text-align:center;font-size:19px;letter-spacing:.3em;' +
  'color:#ff5a76;text-shadow:0 0 10px rgba(255,32,56,.95),0 0 3px #ffb01e;pointer-events:none;opacity:0;' +
  'transition:opacity .12s linear}' +
  '.th-wrap.callout .th-callout{opacity:1}' +
  '.th-foot{font-size:12px;letter-spacing:.14em;color:#e8aab4;min-height:16px}' +
  '@media (prefers-reduced-motion:reduce){.th-callout{transition:none}}';
/* ============================================================
   mount
   ============================================================ */
function mount(container, ctx) {
  return new Promise(function (resolve) {
    /* ---- seeded-sim params: drawn FIRST, fixed order, both sides ---- */
    var P = paramsFor(ctx.depth);
    var diffLvl = diffFor(ctx.depth);
    var budgetMs = Math.min((ctx.timerLen | 0) || CAP_S, CAP_S) * 1000;
    var motionOff_ = motionOff();

    var colPhase = ctx.rng() * Math.PI * 2;   /* idle column drift */
    var driftW = 0.4 + ctx.rng() * 0.3;       /* rad/s idle drift */
    var scanPhase = ctx.rng();                /* fraction of first period */
    var scanPeriod = 2200 + ctx.rng() * 1300; /* ms between eye scans */

    /* ---- dom ---- */
    var view = document.createElement('div');
    view.className = 'stage-view';
    view.setAttribute('data-stage', 'terminator-hunt');
    var style = document.createElement('style');
    style.textContent = CSS;
    view.appendChild(style);

    var head = document.createElement('div');
    head.className = 'th-head';
    var title = document.createElement('span');
    title.textContent = 'THE HUNT \u00B7 DEPTH ' + (ctx.depth | 0);
    var meta = document.createElement('span');
    meta.className = 'th-meta';
    meta.textContent = 'OUTRUN IT \u00B7 SOLVE ' + P.need + ' PATTERNS \u00B7 FAST SOLVES SHOVE IT BACK';
    head.appendChild(title); head.appendChild(meta);

    var rule = document.createElement('div');
    rule.className = 'th-rule';

    var seqRow = document.createElement('div');
    seqRow.className = 'th-seq';

    var optsRow = document.createElement('div');
    optsRow.className = 'th-opts';
    var optEls = [], optArtEls = [];
    for (var oi = 0; oi < OPTIONS; oi++) {
      var ob = document.createElement('div');
      ob.className = 'th-opt';
      ob.setAttribute('role', 'button');
      ob.setAttribute('data-pos', String(oi));
      var oky = document.createElement('span');
      oky.className = 'th-okey';
      oky.textContent = String(oi + 1);
      var art = document.createElement('span');
      art.innerHTML = '';
      ob.appendChild(oky); ob.appendChild(art);
      (function (idx, el) {
        if (el.addEventListener) el.addEventListener('pointerdown', function () { choose(idx); });
      })(oi, ob);
      optsRow.appendChild(ob);
      optEls.push(ob);
      optArtEls.push(art);
    }

    var wrap = document.createElement('div');
    wrap.className = 'th-wrap';
    var canvas = document.createElement('canvas');
    var gutter = document.createElement('div');
    gutter.className = 'th-gutter';
    var eyeEl = document.createElement('div');
    eyeEl.className = 'th-eye';
    gutter.appendChild(eyeEl);
    var callout = document.createElement('div');
    callout.className = 'th-callout';
    wrap.appendChild(canvas); wrap.appendChild(gutter); wrap.appendChild(callout);

    var foot = document.createElement('div');
    foot.className = 'th-foot';

    view.appendChild(head); view.appendChild(rule); view.appendChild(seqRow);
    view.appendChild(optsRow); view.appendChild(wrap); view.appendChild(foot);
    container.appendChild(view);

    /* ---- canvas sizing (DPR-aware) ---- */
    function fit() {
      var cw = wrap.clientWidth || 640, ch = wrap.clientHeight || 240;
      var dpr = (typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0) ? window.devicePixelRatio : 1;
      canvas.width = Math.max(64, Math.round(cw * dpr));
      canvas.height = Math.max(48, Math.round(ch * dpr));
      try { var g2 = canvas.getContext('2d'); if (g2 && g2.setTransform) g2.setTransform(dpr, 0, 0, dpr, 0, 0); } catch (e) {}
    }
    fit();

    /* ---- round state ---- */
    var finished = false, resolved = false, rafId = 0, safetyT = 0;
    var t0 = null, lastT = null, relT = 0, advVirt = 0;
    var pos = 0;                 /* lanes marched (0 = gate, LANES = your zone) */
    var marchClock = 0;          /* unpaused march time (ms) */
    var pauseUntil = -1;         /* relT-based stall */
    var colX = -1;               /* px, chased toward pointer */
    var pointer = { x: -9999, inn: false };
    var solved = 0, catches = 0, dmg = 0;
    var pat = null, patStart = 0, patLocked = false;
    var nextPatternAt = -1;      /* stage-clock beat: when to deal the next pattern */
    var doorArmAt = -1;          /* stage-clock beat: escape sequence start */
    var slamWinAt = -1;          /* stage-clock beat: door-slam resolution */
    var nextScanAt = scanPhase * scanPeriod;
    var lastFlashAt = -1e9;
    var stepAccum = 0;           /* lanes marched since last footstep */
    var fastMs = P.patMs * P.fastFrac;

    function say(fn, a) { try { if (typeof fn === 'function') fn(a); } catch (e) {} }
    function banner(t) { say(ctx.banner, t); }
    function glitch() { try { if (ctx.fx && typeof ctx.fx.glitch === 'function') ctx.fx.glitch(360); } catch (e) {} }
    function shakeIt() { try { if (ctx.fx && typeof ctx.fx.shake === 'function') ctx.fx.shake(12, 280); } catch (e) {} }
    function leftFrac() { try { return clamp(+ctx.leftFrac() || 0, 0, 1); } catch (e) { return 1; } }

    /* ---- WebAudio: metallic footstep thuds (IQB_MUTED-gated) ---- */
    var actx = null;
    function ac() {
      if (audioMuted()) return null;
      try {
        if (!actx) {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          actx = new AC();
        }
        if (actx.state === 'suspended' && actx.resume) actx.resume();
        return actx;
      } catch (e) { return null; }
    }
    function thud(vol, deep) {
      var a = ac(); if (!a) return;
      try {
        var t = a.currentTime;
        var o = a.createOscillator(), gn = a.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(deep ? 38 : 52, t);
        o.frequency.exponentialRampToValueAtTime(deep ? 24 : 30, t + 0.16);
        gn.gain.setValueAtTime(clamp(vol, 0.02, 0.5), t);
        gn.gain.exponentialRampToValueAtTime(0.001, t + (deep ? 0.34 : 0.2));
        o.connect(gn); gn.connect(a.destination);
        o.start(t); o.stop(t + 0.4);
      } catch (e) {}
    }

    /* ---- eye scan: gutter-only flash, <=150 ms, rate-limited ---- */
    function eyeFlash(force) {
      var now = relT;
      if (!force && now - lastFlashAt < EYE_MIN_GAP_MS) return;
      lastFlashAt = now;
      if (motionOff_) return; /* static dim glow remains visible */
      wrap.classList.add('scan');
      setTimeout(function () { wrap.classList.remove('scan'); }, EYE_FLASH_MS);
    }

    function calloutText(txt, ms) {
      callout.textContent = txt;
      wrap.classList.add('callout');
      setTimeout(function () { wrap.classList.remove('callout'); }, ms || 1000);
    }

    /* ---- pattern lifecycle ---- */
    function loadPattern() {
      pat = makePattern(ctx.rng);
      patStart = relT;
      patLocked = false;
      rule.textContent = pat.rule;
      seqRow.innerHTML = '';
      for (var i = 0; i < pat.seqHTML.length; i++) {
        var cell = document.createElement('div');
        cell.className = 'th-cell';
        cell.innerHTML = pat.seqHTML[i];
        seqRow.appendChild(cell);
      }
      var hole = document.createElement('div');
      hole.className = 'th-cell th-hole';
      hole.textContent = '?';
      seqRow.appendChild(hole);
      for (var j = 0; j < optEls.length; j++) {
        optEls[j].className = 'th-opt';
        optArtEls[j].innerHTML = pat.opts[j] ? pat.opts[j].html : '';
      }
    }

    function expireOrWrong(slow) {
      patLocked = true;
      pos += 1;
      stepPunish();
      banner(slow ? 'TOO SLOW \u00B7 IT GAINS' : 'WRONG \u00B7 IT ADVANCES');
      thud(0.22, false);
      if (pos >= LANES) { catchPlayer(); return; }
      nextPatternAt = relT + WRONG_STALL_MS;
      pauseUntil = relT + WRONG_STALL_MS;
    }
    function solve(fast) {
      patLocked = true;
      solved++;
      if (fast) {
        pos = Math.max(0, pos - 1);
        pauseUntil = relT + PUSHBACK_STALL_MS;
        banner('SHOVED BACK \u00B7 SOLVED ' + solved + '/' + P.need);
        thud(0.18, false);
      } else {
        banner('SOLVED ' + solved + '/' + P.need + ' \u00B7 IT KEEPS COMING');
      }
      if (solved >= P.need) { doorArmAt = relT + 500; return; }
      nextPatternAt = relT + (fast ? 450 : WRONG_STALL_MS);
      if (!fast) pauseUntil = relT + WRONG_STALL_MS;
    }
    function choose(idx) {
      if (finished || !pat || patLocked) return;
      if (idx < 0 || idx >= OPTIONS) return;
      var took = relT - patStart;
      var fast = took <= fastMs;
      var right = idx === pat.answerIdx;
      optEls[idx].classList.add(right ? 'right' : 'wrongpick');
      if (!right && pat.answerIdx >= 0 && pat.answerIdx < optEls.length)
        optEls[pat.answerIdx].classList.add('picked');
      if (right) solve(fast);
      else expireOrWrong(false);
    }

    /* ---- catch / escape / survival ---- */
    function catchPlayer() {
      catches++;
      var tick = catches === 1 ? CATCH_HP_FIRST : CATCH_HP_NEXT;
      dmg += tick;
      pos = LANES - RESET_LANES;             /* two lanes back — never death */
      pauseUntil = relT + CATCH_STALL_MS;
      nextPatternAt = relT + CATCH_STALL_MS;
      glitch(); shakeIt();
      eyeFlash(true);
      thud(0.45, true);
      banner('CAUGHT \u00B7 HP \u2212' + tick);
      banner('IT COMES BACK.');
      calloutText('IT COMES BACK.', 1300);
    }
    function escapeDoor() {
      if (finished) return;
      calloutText('\u25B8 DOOR SLAM \u25C2', 900);
      thud(0.5, true);
      banner('DOOR SLAM \u00B7 ESCAPED');
      slamWinAt = relT + 850;
    }
    function surviveExit() {
      resolveOnce({ kind: 'score', correct: true, points: SURVIVE_POINTS,
        hpDelta: -dmg, summary: 'SURVIVED THE HUNT \u00B7 IT WAITS' });
    }

    /* ---- footstep cadence tied to distance marched ---- */
    function stepPunish() { stepAccum += 1; } /* discrete advance also lands a step */
    function marchStep(distLanes) {
      stepAccum += distLanes;
      while (stepAccum >= 0.5) {
        stepAccum -= 0.5;
        var prox = pos / LANES;                 /* 0 far .. 1 at your zone */
        thud(0.06 + prox * 0.3, false);
        if (prox > 0.66) eyeFlash(false);
      }
    }

    /* ---- simulation step ---- */
    function geom() {
      var w = wrap.clientWidth || 640, h = wrap.clientHeight || 240;
      var gateH = 30, safeH = 44;
      return { w: w, h: h, gateH: gateH, safeH: safeH,
        trackTop: gateH, trackBot: h - safeH, laneH: (h - safeH - gateH) / LANES };
    }
    function step(dtSec) {
      /* stage-clock beats: deal next pattern, arm the escape door */
      if (nextPatternAt >= 0 && relT >= nextPatternAt) { nextPatternAt = -1; loadPattern(); }
      if (doorArmAt >= 0 && relT >= doorArmAt) { doorArmAt = -1; escapeDoor(); }
      var marching = relT >= pauseUntil;
      if (marching) {
        var prev = pos;
        pos += P.v * dtSec;
        marchStep(pos - prev);
        if (pos >= LANES) { pos = LANES; catchPlayer(); }
      }
      /* column chase: pursuer with finite turn/translate rate */
      var g = geom();
      var target;
      if (pointer.inn) {
        target = clamp(pointer.x, 26, g.w - 52);
      } else {
        target = g.w / 2 + (g.w * 0.3) * Math.sin(driftW * (marchClock / 1000) + colPhase);
      }
      if (colX < 0) colX = target;
      var maxDx = P.colRate * dtSec;
      colX += clamp(target - colX, -maxDx, maxDx);

      /* pattern timer */
      if (pat && !patLocked && relT - patStart > P.patMs) expireOrWrong(true);

      /* scheduled eye scans */
      if (relT >= nextScanAt) {
        eyeFlash(false);
        nextScanAt = relT + scanPeriod;
      }
      draw(g);
      foot.innerHTML = 'DIST ' + pos.toFixed(1) + '/' + LANES + ' LANES \u00B7 SOLVED ' +
        solved + '/' + P.need + ' \u00B7 CAUGHT ' + catches + ' (\u2212' + dmg + ' HP)';
    }

    /* ---- drawing ---- */
    function draw(g) {
      var c2 = null;
      try { c2 = canvas.getContext('2d'); } catch (e) { return; }
      if (!c2) return;
      var W = g.w, H = g.h;
      c2.clearRect(0, 0, W, H);

      /* lanes */
      for (var ln = 0; ln < LANES; ln++) {
        var y0 = g.trackTop + ln * g.laneH;
        c2.fillStyle = ln % 2 ? 'rgba(255,32,56,.03)' : 'rgba(255,90,118,.05)';
        c2.fillRect(0, y0, W, g.laneH);
        c2.strokeStyle = 'rgba(71,18,31,.85)';
        c2.beginPath(); c2.moveTo(0, y0); c2.lineTo(W, y0); c2.stroke();
      }
      /* spawn gate */
      c2.fillStyle = '#1c1016';
      c2.fillRect(0, 0, W, g.gateH);
      for (var hx = 0; hx < W; hx += 18) {
        c2.fillStyle = (hx / 18) % 2 ? '#3a1219' : '#20101a';
        c2.fillRect(hx, g.gateH - 5, 9, 5);
      }
      c2.strokeStyle = '#5c1a26';
      c2.strokeRect(0.5, 0.5, W - 1, g.gateH);
      /* safe zone */
      var sy = g.trackBot;
      c2.fillStyle = 'rgba(0,230,138,.05)';
      c2.fillRect(0, sy, W, g.safeH);
      c2.strokeStyle = '#123f2c';
      c2.beginPath(); c2.moveTo(0, sy); c2.lineTo(W, sy); c2.stroke();

      var prox = clamp(pos / LANES, 0, 1);
      var ty = g.trackTop + g.laneH * clamp(pos, 0, LANES - 0.08) + g.laneH / 2;
      var sc = 0.8 + prox * 0.5;
      drawTerm(c2, colX, ty, sc, prox);

      /* your cursor marker in the safe zone */
      if (pointer.inn) {
        var mx = clamp(pointer.x, 14, W - 14);
        c2.fillStyle = '#00e68a';
        c2.beginPath();
        c2.moveTo(mx, sy + 10); c2.lineTo(mx - 8, sy + g.safeH - 8); c2.lineTo(mx + 8, sy + g.safeH - 8);
        c2.closePath(); c2.fill();
        c2.strokeStyle = 'rgba(0,230,138,.4)';
        c2.setLineDash([3, 5]);
        c2.beginPath(); c2.moveTo(mx, sy); c2.lineTo(mx, H); c2.stroke();
        c2.setLineDash([]);
      }
    }
    function drawTerm(c2, x, y, s, prox) {
      c2.save();
      c2.translate(x, y);
      c2.scale(s, s);
      /* torso: broad metal shoulders narrowing to waist */
      c2.fillStyle = '#39424c';
      c2.beginPath();
      c2.moveTo(-26, 16); c2.lineTo(-20, -8); c2.lineTo(-13, -14); c2.lineTo(13, -14);
      c2.lineTo(20, -8); c2.lineTo(26, 16); c2.lineTo(12, 22); c2.lineTo(-12, 22);
      c2.closePath(); c2.fill();
      c2.fillStyle = '#4d5866';
      c2.fillRect(-9, -6, 18, 20);
      /* skull head */
      c2.fillStyle = '#8b97a3';
      c2.beginPath();
      c2.moveTo(-11, -15); c2.quadraticCurveTo(-12, -34, 0, -35);
      c2.quadraticCurveTo(12, -34, 11, -15);
      c2.quadraticCurveTo(6, -11, 0, -12); c2.quadraticCurveTo(-6, -11, -11, -15);
      c2.closePath(); c2.fill();
      c2.fillStyle = '#20262d';
      c2.fillRect(-8, -26, 16, 5);            /* visor slit */
      var glow = 0.5 + prox * 0.5;
      c2.fillStyle = 'rgba(255,32,56,' + glow.toFixed(2) + ')';
      c2.fillRect(-6, -25, 4, 3);             /* left eye */
      c2.fillRect(2, -25, 4, 3);              /* right eye */
      /* jaw teeth hint */
      c2.fillStyle = '#6b7683';
      c2.fillRect(-7, -19, 14, 3);
      c2.restore();
    }

    /* ---- frame tick ---- */
    function tick(now) {
      if (finished) return;
      if (t0 === null) { t0 = now; lastT = now; }
      var dtMs = Math.min(50, Math.max(0, now - lastT));
      lastT = now;
      relT += dtMs;
      if (relT >= pauseUntil) marchClock += dtMs;
      step(dtMs / 1000);
      if (slamWinAt >= 0 && relT >= slamWinAt) {
        resolveOnce({ kind: 'score', correct: true, points: escapeFor(diffLvl),
          hpDelta: -dmg, summary: 'DOOR SLAM \u00B7 ESCAPED THE HUNT' });
        return;
      }
      if (relT >= budgetMs || ctx.expired) surviveExit();
    }

    /* ---- lifecycle ---- */
    function resolveOnce(res) {
      if (resolved) return;
      resolved = true; finished = true;
      teardown();
      resolve(res);
    }
    function teardown() {
      if (rafId) { try { window.cancelAnimationFrame(rafId); } catch (e) {} rafId = 0; }
      if (safetyT) { clearTimeout(safetyT); safetyT = 0; }
      try { window.removeEventListener('keydown', onKey, true); } catch (e) {}
      try { view.removeEventListener('pointermove', onMove); } catch (e) {}
      try { window.removeEventListener('resize', onResize); } catch (e) {}
    }
    function onResize() { fit(); }
    function onMove(e) {
      var r = wrap.getBoundingClientRect();
      pointer.x = e.clientX - r.left; pointer.inn = true;
    }
    function digitOf(code) {
      var m = /^Digit([1-4])$/.exec(code || '') || /^Numpad([1-4])$/.exec(code || '');
      return m ? +m[1] : 0;
    }
    function onKey(e) {
      var n = digitOf(e.code);
      if (!n) return;
      e.preventDefault();
      choose(n - 1);
    }
    try { window.addEventListener('keydown', onKey, true); } catch (e) {}
    try { view.addEventListener('pointermove', onMove); } catch (e) {}
    try { window.addEventListener('resize', onResize); } catch (e) {}

    function loop(now) {
      if (finished) return;
      tick(now);
      if (finished) return;
      if (typeof window.requestAnimationFrame === 'function')
        rafId = window.requestAnimationFrame(loop);
    }
    if (typeof window.requestAnimationFrame === 'function')
      rafId = window.requestAnimationFrame(loop);
    safetyT = setTimeout(function () { if (!finished) surviveExit(); }, budgetMs + 2500);

    loadPattern();

    /* ---- self-play / smoke hook ---- */
    window.__HUNT__ = {
      choose: function (i) { choose(i | 0); },
      advance: function (ms) {
        var left = ms;
        while (left > 0 && !finished) {
          var s = Math.min(50, left); left -= s;
          advVirt += s;
          tick(1e9 + advVirt);
        }
      },
      finish: function () { if (!finished) surviveExit(); },
      state: function () {
        return {
          pos: +pos.toFixed(3), solved: solved, need: P.need,
          catches: catches, dmg: dmg, finished: finished, locked: patLocked,
          paused: relT < pauseUntil, patMs: P.patMs, fastMs: +fastMs.toFixed(1),
          pattern: pat ? { kind: pat.kind, answerIdx: pat.answerIdx, startedAgo: +(relT - patStart).toFixed(1) } : null
        };
      }
    };

    LAST = { P: P, view: view };
  });
}

/* ---------- engine-facing serializers ---------- */
function describeFn() {
  return LAST ? { kind: 'terminator-hunt', need: LAST.P.need } : null;
}

/* ---------- headless smoke helpers (pure fns only) ---------- */
window.__HUNT_TOOLS__ = { paramsFor: paramsFor, needFor: needFor, makePattern: makePattern, LANES: LANES };

/* ---------- registration (Stage absent -> queue per W3 brief) ---------- */
var STAGE = {
  id: 'terminator-hunt',
  name: 'THE HUNT',
  weight: 5,
  minDepth: 3,
  worlds: ['cyber-hunter'],
  net: 'seed',
  mount: mount,
  describe: describeFn,
  cleanup: function () { try { window.__HUNT__ && window.__HUNT__.finish(); } catch (e) {} }
};
if (root.Stage && typeof root.Stage.register === 'function') root.Stage.register(STAGE);
else (window.__stagePending = window.__stagePending || []).push(STAGE);
})();
