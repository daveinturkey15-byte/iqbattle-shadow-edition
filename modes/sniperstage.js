/* ============================================================================
 * modes/sniperstage.js — STAGE "OVERWATCH" (W3 gap-closing wave)
 * Dave's 'looking for a sniper scope' spec: a long-range field rendered
 * tiny/dense; YOUR SCOPE is the whole game.
 *
 * SUPERSEDES: the pack-interludes.js 'scope-range' interlude fog modifier
 * ([3] SNIPER SCOPE PUZZLE: briefing card + next-round masked fog layer +
 * unscoped-answer ×0.8 mul) wherever THIS stage is picked on world
 * 'scope-range' (takeover wins by weight, themed-design §0.4). The old hook
 * remains as the low-depth fallback; deletion of its body happens only after
 * takeover parity smoke passes. No shim layer — weight outranking only.
 *
 * REGISTRATION SHAPE (research/mode-contract.md):
 *   window.IQ.Stage.register({
 *     id:   'overwatch-scope',
 *     name: 'OVERWATCH',
 *     weight: 3,
 *     minDepth: 4,
 *     worlds: ['scope-range'],      // world id ALREADY registered by pack-
 *                                   // interludes.js — bound, NOT re-registered
 *     net: 'seed',                  // challenge = pure fn(ctx.rng); MP tabs
 *                                   // see the identical field (pattern D1/D2:
 *                                   // seeded-world, outcomes are local skill)
 *     mount(container, ctx) -> Promise<StageResult>
 *   });
 * If IQ.Stage is absent the stage object queues on window.__stagePending
 * (same convention as modes/hunterdodge.js / modes/gauntlet.js).
 *
 * CONTROLS:
 *   mouse move / touch drag .. slews the 90 px circular scope lens across
 *                              the field (CSS mask reveal — tighter than the
 *                              fog-recon dim: 45 px clear radius). Breath
 *                              sway ±6 px sine rides on the lens at all
 *                              times (cosmetic input-feel; never scores).
 *   hold SHIFT or SPACE ...... STEADY: sway drops to 0 for exactly 1.2 s.
 *                              Each steadying costs 2 s of round timer
 *                              (deducted from this stage's self-budget;
 *                              cannot stack while already steady).
 *   click / tap .............. FIRE: confirms the cell nearest the LENS
 *                              CENTER within the glass (not the OS cursor).
 *                              Empty glass = dry click, no penalty.
 *   ESC ...................... lower the scope: settles a NEUTRAL result.
 *
 * MECHANIC:
 *   A target card lists THREE seeded criteria (shape + color + rotation).
 *   Exactly ONE cell in the field matches all three (perceptual equivalence
 *   classes enforced: square/plus at 0°≡90°, 45°≡135° can never fake a
 *   match). Scope it and fire. Wrong hits: −20 pts EACH; the SECOND miss
 *   fails the round. Depth scales field density 24→48 cells and decoy
 *   near-miss subtlety (decoys matching 2 of 3 criteria grow denser).
 *
 * RESULT FIELDS (one canonical StageResult):
 *   correct: true  = target shot  · false = 2nd miss OR budget expired ·
 *            null = ESC (neutral stand-down)
 *   points:  +160 on the hit MINUS 20 per prior miss · −(20·misses) on any
 *            fail row (engine clamps [−200,500])
 *   hpDelta: 0 everywhere except timeout (−5, themed-design ladder)
 *   summary: 'ONE SHOT · ONE TRUTH' | 'TWO SHOTS WIDE · STAND DOWN' |
 *            'RANGE GOES COLD' | 'SCOPE LOWERED'          (all ≤ 48 chars)
 *
 * FAIRNESS RAILS: IQB_MUTED gates the synthesized rifle crack; IQB_MOTION /
 * prefers-reduced-motion kills the terrain shimmer (sway itself IS the game
 * and stays); no fullscreen flashes — feedback is the lens ring recoloring
 * (≤200 ms) + engine-gated fx.shake; HUD text ≥ 11 px; ESC always available;
 * self-budget = min(ctx.timerLen, 45 s) so the stage ALWAYS settles once.
 *
 * DETERMINISM: every gameplay-visible byte — target combo, decoy specs,
 * cell layout fractions, terrain specks — is drawn from ctx.rng at mount in
 * a FIXED order (seeded-sim §0.2). Zero Date.now()/performance.now() in
 * verdict logic; the wall clock drives only sway cosmetics. Verdicts depend
 * solely on (cell layout, lens center) — lens center includes sway, which is
 * local skill execution, exactly like red-light freeze timing.
 *
 * SELF-PLAY / SMOKE HOOK (per mount): window.__OW__
 *   state()              -> {budgetLeftMs, misses, missPts, steadies,
 *                            steadyActive, finished, aim, lens, cells}
 *                           (+ target/layout echo when ctx._smoke)
 *   aim(x,y)             -> synthetic pointer move (wrap-local px)
 *   holdSteady()         -> activate steadying programmatically
 *   fire()               -> pull the trigger at the current lens center
 *   advance(ms)          -> virtual-clock step in 50 ms slices (headless)
 *   finish()             -> force the timeout settlement path
 * ============================================================================*/
(function () {
'use strict';
var root = window.IQ = window.IQ || {};

/* ---------- constants ---------- */
var CAP_MS = 45000;
var LENS_R = 45;               /* 90 px lens */
var CLEAR_R = 42;              /* fully-clear mask radius (< LENS_R) */
var SWAY_AMP = 6;              /* ±6 px breath sway */
var STEADY_MS = 1200;          /* steadiness granted per activation */
var STEADY_COST_MS = 2000;     /* timer cost per steadying */
var MISS_PTS = 20;
var MAX_MISSES = 2;
var HIT_PTS = 160;
var TIMEOUT_HP = 5;
var ROTS = [0, 45, 90, 135];
var SHAPES = ['square', 'bar', 'tri', 'plus', 'wedge'];
var SHAPE_NAMES = { square: 'SQUARE', bar: 'BAR', tri: 'TRI', plus: 'PLUS', wedge: 'WEDGE' };
var FALLBACK_PAL = ['#00e5ff', '#ffb01e', '#00e68a', '#ff5a76', '#b28dff', '#ff2244'];

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
/* truthful color label for ANY palette (Board.palRow() varies per theme) */
var NAME_ANCHORS = [['RED', 255, 32, 56], ['ORANGE', 255, 140, 40], ['GOLD', 255, 176, 30],
  ['GREEN', 0, 230, 138], ['CYAN', 0, 229, 255], ['BLUE', 45, 124, 255],
  ['VIOLET', 178, 141, 255], ['ROSE', 255, 90, 118], ['WHITE', 240, 244, 255]];
function hexName(hex) {
  try {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
    if (!m) return 'MARK';
    var n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var best = 'MARK', bd = 1e9;
    for (var i = 0; i < NAME_ANCHORS.length; i++) {
      var a = NAME_ANCHORS[i];
      var dd = (r - a[1]) * (r - a[1]) + (g - a[2]) * (g - a[2]) + (b - a[3]) * (b - a[3]);
      if (dd < bd) { bd = dd; best = a[0]; }
    }
    return best;
  } catch (e) { return 'MARK'; }
}
function setVar(el, k, v) {
  try { if (typeof el.style.setProperty === 'function') el.style.setProperty(k, v); else el.style[k] = v; } catch (e) {}
}
function muted() {
  try {
    var v = window.localStorage.getItem('IQB_MUTED');
    return v === '1' || v === 'true' || JSON.parse(v) === true;
  } catch (e) { return false; }
}
function motionOff() {
  try {
    var v = window.localStorage.getItem('IQB_MOTION');
    var pref = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    return !pref || (v != null && JSON.parse(v) === false);
  } catch (e) { return false; }
}
/* perceptual equivalence class of (shape, rotation) — two cells share a
 * class iff they are indistinguishable through the glass */
function eqRot(shape, rot) {
  if (shape === 'square' || shape === 'plus') return rot % 90 === 0 ? 'A' : 'B';
  return String(rot);
}
function palette() {
  try {
    if (window.IQ && window.IQ.Board && typeof window.IQ.Board.palRow === 'function') {
      var p = window.IQ.Board.palRow();
      if (p && p.length >= 6) return p;
    }
  } catch (e) {}
  return FALLBACK_PAL;
}

/* ---------- depth scaling ---------- */
function paramsFor(depth) {
  var d = clamp(depth | 0, 4, 12);
  return {
    n: clamp(24 + (d - 4) * 3, 24, 48),                 /* density 24 -> 48 */
    pNear: Math.min(0.12 + 0.05 * (d - 4), 0.5),        /* 2-of-3 decoy rate */
    nColors: d >= 8 ? 6 : 4,                            /* subtler palette deep */
    glyph: d >= 8 ? 19 : 22                             /* tinier targets deep */
  };
}

/* ---------- glyph renderers (canvas + svg share geometry) ---------- */
function tracePath(c, s, shape) {
  c.beginPath();
  if (shape === 'square') c.rect(-s * 0.36, -s * 0.36, s * 0.72, s * 0.72);
  else if (shape === 'bar') c.rect(-s * 0.48, -s * 0.13, s * 0.96, s * 0.26);
  else if (shape === 'tri') {
    c.moveTo(0, -s * 0.46); c.lineTo(s * 0.42, s * 0.36); c.lineTo(-s * 0.42, s * 0.36); c.closePath();
  } else if (shape === 'plus') {
    c.rect(-s * 0.11, -s * 0.44, s * 0.22, s * 0.88);
    c.rect(-s * 0.44, -s * 0.11, s * 0.88, s * 0.22);
  } else { /* wedge: pac-sector, mouth up */
    c.moveTo(0, 0);
    c.arc(0, 0, s * 0.46, Math.PI * 0.5 + 0.6, Math.PI * 0.5 - 0.6 + Math.PI * 2);
    c.closePath();
  }
}
function drawGlyph(c, x, y, s, col, rotDeg, shape) {
  c.save();
  c.translate(x, y);
  c.rotate((rotDeg || 0) * Math.PI / 180);
  c.fillStyle = col;
  tracePath(c, s, shape);
  c.fill();
  c.restore();
}
function glyphSVG(shape, col, rotDeg, size) {
  var s = size * 0.5;
  return '<svg viewBox="-24 -24 48 48" width="' + size + '" height="' + size + '" aria-hidden="true">' +
    '<g transform="rotate(' + (rotDeg || 0) + ')">' + pathSVG(s, shape, col) + '</g></svg>';
}
function pathSVG(s, shape, col) {
  if (shape === 'square') return '<rect x="' + (-s * 0.72) + '" y="' + (-s * 0.72) + '" width="' + (s * 1.44) + '" height="' + (s * 1.44) + '" rx="2" fill="' + col + '"/>';
  if (shape === 'bar') return '<rect x="' + (-s * 0.96) + '" y="' + (-s * 0.26) + '" width="' + (s * 1.92) + '" height="' + (s * 0.52) + '" rx="2" fill="' + col + '"/>';
  if (shape === 'tri') return '<polygon points="0,' + (-s * 0.92) + ' ' + (s * 0.84) + ',' + (s * 0.72) + ' ' + (-s * 0.84) + ',' + (s * 0.72) + '" fill="' + col + '"/>';
  if (shape === 'plus') return '<path d="M' + (-s * 0.22) + ',' + (-s * 0.88) + 'h' + (s * 0.44) + 'v' + (s * 0.66) + 'h' + (s * 0.66) + 'v' + (s * 0.44) + 'h' + (-s * 0.66) + 'v' + (s * 0.66) + 'h' + (-s * 0.44) + 'v' + (-s * 0.66) + 'h' + (-s * 0.66) + 'v' + (-s * 0.44) + 'h' + (s * 0.66) + 'z" fill="' + col + '"/>';
  return '<path d="M0 0 L' + (s * 0.94 * Math.cos(Math.PI * 0.5 + 0.6)).toFixed(2) + ' ' + (s * 0.94 * Math.sin(Math.PI * 0.5 + 0.6)).toFixed(2) + ' A' + (s * 0.94) + ' ' + (s * 0.94) + ' 0 1 1 ' + (s * 0.94 * Math.cos(Math.PI * 0.5 - 0.6)).toFixed(2) + ' ' + (s * 0.94 * Math.sin(Math.PI * 0.5 - 0.6)).toFixed(2) + ' z" fill="' + col + '"/>';
}

/* ---------- CSS (scoped sn-* classes, one injected sheet) ---------- */
var CSS =
  '.stage-view[data-stage="overwatch-scope"]{position:absolute;inset:0;display:flex;flex-direction:column;' +
  'align-items:center;gap:6px;padding:8px;font-family:Oxanium,monospace;color:#c8ffe0;' +
  'background:radial-gradient(130% 110% at 50% 0%,#071209 0%,#03080a 55%,#010304 100%);overflow:hidden}' +
  '.sn-head{width:100%;max-width:900px;display:flex;align-items:center;justify-content:space-between;gap:10px}' +
  '.sn-title{font-size:13px;letter-spacing:.26em;color:#7fff9f}' +
  '.sn-card{display:flex;align-items:center;gap:14px;padding:4px 14px;border:1px solid #1d5c34;border-radius:999px;' +
  'background:rgba(6,20,12,.8)}' +
  '.sn-chip{display:flex;align-items:center;gap:6px;font-size:11px;letter-spacing:.16em;color:#baffcf}' +
  '.sn-chip b{font-weight:700;color:#fff}' +
  '.sn-sep{color:#2fae5c;font-size:11px}' +
  '.sn-field{position:relative;width:100%;max-width:900px;flex:1;min-height:220px;border:2px solid #123c24;' +
  'border-radius:8px;background:#02120a;touch-action:none;cursor:none;overflow:hidden}' +
  '.sn-field canvas{position:absolute;inset:0;width:100%;height:100%}' +
  '.sn-dim{position:absolute;inset:0;pointer-events:none;background:rgba(1,5,8,.87);' +
  '-webkit-backdrop-filter:blur(3px) saturate(.65);backdrop-filter:blur(3px) saturate(.65);' +
  '-webkit-mask-image:radial-gradient(circle at var(--lx,50%) var(--ly,50%),transparent 0 ' + CLEAR_R + 'px,rgba(0,0,0,.5) ' + (CLEAR_R + 6) + 'px,#000 ' + (CLEAR_R + 16) + 'px);' +
  'mask-image:radial-gradient(circle at var(--lx,50%) var(--ly,50%),transparent 0 ' + CLEAR_R + 'px,rgba(0,0,0,.5) ' + (CLEAR_R + 6) + 'px,#000 ' + (CLEAR_R + 16) + 'px)}' +
  '.sn-ring{position:absolute;left:0;top:0;width:' + (LENS_R * 2) + 'px;height:' + (LENS_R * 2) + 'px;margin:' + (-LENS_R) + 'px 0 0 ' + (-LENS_R) + 'px;' +
  'pointer-events:none;border:2px solid rgba(127,255,159,.9);border-radius:50%;' +
  'box-shadow:0 0 18px rgba(127,255,159,.25),inset 0 0 26px rgba(127,255,159,.12);transition:border-color .12s,box-shadow .12s}' +
  '.sn-ring i{position:absolute;background:rgba(127,255,159,.75)}' +
  '.sn-ring i:nth-child(1){left:50%;top:9%;width:1px;height:82%}' +
  '.sn-ring i:nth-child(2){top:50%;left:9%;height:1px;width:82%}' +
  '.sn-ring b{position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px 0 0 -2px;border-radius:50%;background:rgba(199,255,220,.95)}' +
  '.sn-ring.hot{border-color:#ff2038;box-shadow:0 0 18px rgba(255,32,56,.4),inset 0 0 26px rgba(255,32,56,.18)}' +
  '.sn-ring.kill{border-color:#00e68a;box-shadow:0 0 24px rgba(0,230,138,.5),inset 0 0 30px rgba(0,230,138,.2)}' +
  '.sn-ring.steady{border-color:#ffd75e}' +
  '@media (prefers-reduced-motion:no-preference){.sn-ring.steady{animation:snapulse .6s ease-in-out 2 alternate}}' +
  '@keyframes snapulse{from{box-shadow:0 0 18px rgba(255,215,94,.25)}to{box-shadow:0 0 26px rgba(255,215,94,.55)}}' +
  '.sn-foot{width:100%;max-width:900px;display:flex;justify-content:space-between;font-size:11px;' +
  'letter-spacing:.16em;color:#63d98c;min-height:16px}' +
  '.sn-time{font-variant-numeric:tabular-nums;color:#baffcf}' +
  '.sn-time.low{color:#ff2038}' +
  '.sn-pips{letter-spacing:.3em;color:#baffcf}' +
  '.sn-pips .hit{color:#ff2038}' +
  '@media (prefers-reduced-motion:reduce){.sn-ring{transition:none}}';

/* ============================================================
   mount
   ============================================================ */
var S = {}; /* module state for describe() */

function mount(container, ctx) {
  return new Promise(function (resolve) {
    var P = paramsFor(ctx.depth);
    var pal = palette();
    var budgetMs = Math.min((ctx.timerLen | 0) || 45, 45) * 1000;

    /* ---- seeded challenge: FIXED draw order (seeded-sim) ---- */
    var tShape = SHAPES[Math.floor(ctx.rng() * SHAPES.length)];
    var tColIdx = Math.floor(ctx.rng() * P.nColors);
    var tRot = ROTS[Math.floor(ctx.rng() * ROTS.length)];
    var targetSlot = Math.floor(ctx.rng() * P.n);

    /* decoys: nobody but the target may match all three criteria */
    function perturbDim(dim, cell) {
      if (dim === 0) { var ns; do { ns = SHAPES[Math.floor(ctx.rng() * SHAPES.length)]; } while (ns === cell.shape); cell.shape = ns; }
      else if (dim === 1) { var nc; do { nc = Math.floor(ctx.rng() * P.nColors); } while (nc === cell.color); cell.color = nc; }
      else { var nr; do { nr = ROTS[Math.floor(ctx.rng() * ROTS.length)]; } while (eqRot(cell.shape, nr) === eqRot(cell.shape, cell.rot)); cell.rot = nr; }
    }
    function matchCount(cell) {
      return (cell.shape === tShape ? 1 : 0) + (cell.color === tColIdx ? 1 : 0) +
             (eqRot(cell.shape, cell.rot) === eqRot(tShape, tRot) ? 1 : 0);
    }
    function freshCell() {
      return { shape: SHAPES[Math.floor(ctx.rng() * SHAPES.length)],
               color: Math.floor(ctx.rng() * P.nColors),
               rot: ROTS[Math.floor(ctx.rng() * ROTS.length)] };
    }
    var DIMS = [0, 1, 2];
    var cells = [];
    for (var ci = 0; ci < P.n; ci++) {
      if (ci === targetSlot) { cells.push({ shape: tShape, color: tColIdx, rot: tRot }); continue; }
      var cell, guard = 0, lvl;
      do {
        cell = freshCell();
        var u = ctx.rng();
        lvl = u < P.pNear ? 2 : (ctx.rng() < 0.35 ? 1 : 0);
        if (lvl > 0) {
          var dims = DIMS.slice();
          for (var sh = dims.length - 1; sh > 0; sh--) { var jj = Math.floor(ctx.rng() * (sh + 1)); var tmp = dims[sh]; dims[sh] = dims[jj]; dims[jj] = tmp; }
          for (var k = 0; k < 3 - lvl; k++) perturbDim(dims[k], cell);
        }
      } while (matchCount(cell) >= 3 && ++guard < 24);
      if (matchCount(cell) >= 3) perturbDim(0, cell); /* hard rail: uniqueness */
      cells.push(cell);
    }

    /* jittered-grid layout as FRACTIONS (resize-proof, deterministic) */
    var cols = Math.max(4, Math.ceil(Math.sqrt(P.n * 1.9)));
    var rows = Math.ceil(P.n / cols);
    var layout = cells.map(function (_, i) {
      var cx = i % cols, cy = Math.floor(i / cols);
      var jx = ((ctx.rng() - 0.5) * 0.5) / cols;
      var jy = ((ctx.rng() - 0.5) * 0.5) / rows;
      return {
        fx: clamp((cx + 0.5) / cols + jx, 0.05, 0.95),
        gy: clamp((cy + 0.5) / rows + jy, 0.06, 0.94)
      };
    });
    /* terrain specks (cosmetic) */
    var specks = [];
    for (var sp = 0; sp < 70; sp++) specks.push({ x: ctx.rng(), y: ctx.rng(), r: 0.5 + ctx.rng() * 1.4, a: 0.05 + ctx.rng() * 0.12 });

    /* ---- dom ---- */
    var view = document.createElement('div');
    view.className = 'stage-view';
    view.setAttribute('data-stage', 'overwatch-scope');
    var style = document.createElement('style');
    style.textContent = CSS;
    view.appendChild(style);

    var head = document.createElement('div');
    head.className = 'sn-head';
    var title = document.createElement('span');
    title.className = 'sn-title';
    title.textContent = 'OVERWATCH \u00b7 DEPTH ' + (ctx.depth | 0);
    var card = document.createElement('div');
    card.className = 'sn-card';
    var tCol = pal[tColIdx % pal.length];
    var tColName = hexName(tCol);
    card.innerHTML =
      '<span class="sn-chip">' + glyphSVG(tShape, tCol, 0, 30) + '<b>' + SHAPE_NAMES[tShape] + '</b></span>' +
      '<span class="sn-sep">+</span>' +
      '<span class="sn-chip"><svg viewBox="-12 -12 24 24" width="22" height="22" aria-hidden="true"><rect x="-9" y="-9" width="18" height="18" rx="2" fill="' + tCol + '" stroke="#baffcf" stroke-width="1"/></svg><b>' + tColName + '</b></span>' +
      '<span class="sn-sep">+</span>' +
      '<span class="sn-chip"><svg viewBox="-12 -12 24 24" width="22" height="22" aria-hidden="true"><g transform="rotate(' + tRot + ')"><path d="M0 -9 L3 -3 L9 -3 L4 1 L6 8 L0 4 L-6 8 L-4 1 L-9 -3 L-3 -3 Z" fill="#baffcf"/></g></svg><b>' + tRot + '\u00b0</b></span>';
    head.appendChild(title); head.appendChild(card);

    var field = document.createElement('div');
    field.className = 'sn-field';
    var canvas = document.createElement('canvas');
    var dim = document.createElement('div');
    dim.className = 'sn-dim';
    var ring = document.createElement('div');
    ring.className = 'sn-ring';
    ring.innerHTML = '<i></i><i></i><b></b>';
    field.appendChild(canvas); field.appendChild(dim); field.appendChild(ring);

    var foot = document.createElement('div');
    foot.className = 'sn-foot';
    var legendEl = document.createElement('span');
    legendEl.textContent = 'MOVE = SLEW \u00b7 HOLD SHIFT/SPACE = STEADY (\u22122s) \u00b7 CLICK = FIRE';
    var pipsEl = document.createElement('span');
    pipsEl.setAttribute('role', 'status');
    var timeEl = document.createElement('span');
    timeEl.className = 'sn-time';
    foot.appendChild(legendEl); foot.appendChild(pipsEl); foot.appendChild(timeEl);

    view.appendChild(head); view.appendChild(field); view.appendChild(foot);
    container.appendChild(view);

    /* ---- canvas sizing (DPR-aware) ---- */
    function fit() {
      var cw = field.clientWidth || 800, ch = field.clientHeight || 380;
      var dpr = (typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0) ? window.devicePixelRatio : 1;
      canvas.width = Math.max(64, Math.round(cw * dpr));
      canvas.height = Math.max(48, Math.round(ch * dpr));
      try { var g = canvas.getContext('2d'); if (g && g.setTransform) g.setTransform(dpr, 0, 0, dpr, 0, 0); } catch (e) {}
    }
    fit();

    /* ---- live state ---- */
    var finished = false, rafId = 0, safetyT = null;
    var relT = 0, advVirt = 0, lastNow = null;
    var budgetLeft = budgetMs;
    var pointer = { x: -1, y: -1 };
    var lens = { x: -1, y: -1 };
    var amp = SWAY_AMP;
    var steady = false, steadyEnd = 0, steadies = 0;
    var misses = 0, missPts = 0;
    var ringHotT = 0;
    var shimmerOn = !motionOff();

    function geom() {
      return { w: field.clientWidth || 800, h: field.clientHeight || 380 };
    }
    function cellPx(i, g) {
      return { x: layout[i].fx * g.w, y: layout[i].gy * g.h };
    }

    /* ---- audio (IQB_MUTED-gated synth rifle crack) ---- */
    var actx = null;
    function crack(far) {
      if (muted()) return;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!actx) actx = new AC();
        if (actx.state === 'suspended' && actx.resume) actx.resume();
        var t0 = actx.currentTime;
        /* body: filtered noise burst */
        var len = Math.floor(actx.sampleRate * (far ? 0.14 : 0.22));
        var buf = actx.createBuffer(1, len, actx.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
        var src = actx.createBufferSource(); src.buffer = buf;
        var f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = far ? 900 : 2400;
        var g = actx.createGain(); g.gain.value = far ? 0.18 : 0.5;
        src.connect(f); f.connect(g); g.connect(actx.destination);
        src.start(t0);
        /* thump */
        var o = actx.createOscillator(), og = actx.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(far ? 110 : 160, t0);
        o.frequency.exponentialRampToValueAtTime(40, t0 + 0.18);
        og.gain.setValueAtTime(far ? 0.12 : 0.32, t0);
        og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
        o.connect(og); og.connect(actx.destination);
        o.start(t0); o.stop(t0 + 0.22);
      } catch (e) {}
    }
    function blip(freq, ms) {
      if (muted()) return;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!actx) actx = new AC();
        var o = actx.createOscillator(), g = actx.createGain();
        o.type = 'square'; o.frequency.value = freq;
        g.gain.value = 0.05;
        g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + ms / 1000);
        o.connect(g); g.connect(actx.destination);
        o.start(); o.stop(actx.currentTime + ms / 1000);
      } catch (e) {}
    }

    function banner(t) { try { if (typeof ctx.banner === 'function') ctx.banner(t); } catch (e) {} }
    function shake() { try { if (ctx.fx && typeof ctx.fx.shake === 'function') ctx.fx.shake(8, 220); } catch (e) {} }

    /* ---- simulation step ---- */
    function step(dtMs) {
      var g = geom();
      relT += dtMs;
      if (!finished) {
        budgetLeft -= dtMs;
        if (steady && relT >= steadyEnd) { steady = false; ring.classList.remove('steady'); }
        /* breath sway (cosmetic input-feel; wall-clock free — pure f(relT)) */
        var want = steady ? 0 : SWAY_AMP;
        amp += (want - amp) * Math.min(1, dtMs / 120);
        var ts = relT / 1000;
        var ox = amp * (Math.sin(ts * 1.7) * 0.6 + Math.sin(ts * 2.83 + 1.7) * 0.4);
        var oy = amp * (Math.sin(ts * 1.31 + 0.6) * 0.6 + Math.sin(ts * 2.17 + 3.1) * 0.4);
        if (pointer.x < 0) { pointer.x = g.w / 2; pointer.y = g.h / 2; }
        lens.x = clamp(pointer.x + ox, 8, g.w - 8);
        lens.y = clamp(pointer.y + oy, 8, g.h - 8);
        if (ringHotT && relT >= ringHotT) { ringHotT = 0; ring.classList.remove('hot', 'kill'); }
      }
      drawField(g);
      setVar(dim, '--lx', lens.x.toFixed(1) + 'px');
      setVar(dim, '--ly', lens.y.toFixed(1) + 'px');
      ring.style.transform = 'translate(' + lens.x.toFixed(1) + 'px,' + lens.y.toFixed(1) + 'px)';
      var secs = Math.max(0, budgetLeft / 1000);
      timeEl.textContent = secs.toFixed(1) + 's' + (steadies ? ' \u00b7 STEADIED \u00d7' + steadies : '');
      timeEl.className = 'sn-time' + (secs < 6 ? ' low' : '');
      var pips = '';
      for (var m = 0; m < MAX_MISSES; m++) pips += (m < misses ? '\u25cf' : '\u25cb') + ' ';
      pipsEl.textContent = pips + (misses ? ('\u2212' + missPts + ' PTS') : '2 MISSES = ROUND FAIL');
    }

    function drawField(g) {
      var c2 = null;
      try { c2 = canvas.getContext('2d'); } catch (e) {}
      if (!c2) return;
      var dpr = (typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0) ? window.devicePixelRatio : 1;
      var W = canvas.width / dpr, H = canvas.height / dpr;
      c2.clearRect(0, 0, W, H);
      var grd = c2.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, '#03170d'); grd.addColorStop(1, '#010806');
      c2.fillStyle = grd; c2.fillRect(0, 0, W, H);
      /* terrain specks (seeded; shimmer is motion-gated) */
      for (var i = 0; i < specks.length; i++) {
        var tw = shimmerOn ? (0.75 + 0.25 * Math.sin(relT / 700 + i * 1.7)) : 1;
        c2.fillStyle = 'rgba(127,255,159,' + (specks[i].a * tw).toFixed(3) + ')';
        c2.fillRect(specks[i].x * W, specks[i].y * H, specks[i].r, specks[i].r);
      }
      /* range yard-lines */
      c2.strokeStyle = 'rgba(47,174,92,.14)';
      c2.lineWidth = 1;
      for (var yy = 1; yy < 4; yy++) {
        c2.beginPath(); c2.moveTo(W * 0.08, H * yy / 4); c2.lineTo(W * 0.92, H * yy / 4); c2.stroke();
      }
      /* cells — tiny and dense */
      for (var ci2 = 0; ci2 < cells.length; ci2++) {
        var p = cellPx(ci2, g);
        drawGlyph(c2, p.x, p.y, P.glyph, pal[cells[ci2].color % pal.length], cells[ci2].rot, cells[ci2].shape);
      }
    }

    /* ---- verdicts ---- */
    function cellUnderLens() {
      var g = geom(), best = -1, bd = 1e9;
      for (var i = 0; i < cells.length; i++) {
        var p = cellPx(i, g);
        var dd = Math.hypot(p.x - lens.x, p.y - lens.y);
        if (dd <= LENS_R && dd < bd) { bd = dd; best = i; }
      }
      return best;
    }
    function fire() {
      if (finished) return;
      var hit = cellUnderLens();
      if (hit < 0) { blip(220, 60); banner('NOTHING IN THE GLASS'); return; }
      if (hit === targetSlot) {
        crack(false);
        ring.classList.add('kill');
        try { if (ctx.fx && ctx.fx.flash) ctx.fx.flash('rgba(0,230,138,.12)', 140); } catch (e) {}
        settle({ kind: 'score', correct: true, points: HIT_PTS - missPts, hpDelta: 0,
                 summary: 'ONE SHOT \u00b7 ONE TRUTH' });
      } else {
        misses++; missPts += MISS_PTS;
        crack(true); shake();
        ring.classList.add('hot'); ringHotT = relT + 200; /* ≤200 ms localized rail */
        banner('MISS \u2212' + MISS_PTS + ' PTS');
        if (misses >= MAX_MISSES) {
          settle({ kind: 'score', correct: false, points: -missPts, hpDelta: 0,
                   summary: 'TWO SHOTS WIDE \u00b7 STAND DOWN' });
        }
      }
    }
    function holdSteady() {
      if (finished || steady) return;
      steady = true; steadyEnd = relT + STEADY_MS; steadies++;
      budgetLeft -= STEADY_COST_MS;
      ring.classList.remove('hot', 'kill');
      ring.classList.add('steady');
      blip(520, 80);
      banner('STEADY \u00b7 \u22122s');
    }
    function finishTimeout() {
      if (finished) return;
      settle({ kind: 'score', correct: false, points: -missPts, hpDelta: -TIMEOUT_HP,
               summary: 'RANGE GOES COLD' });
    }
    function settle(res) {
      if (finished) return;
      finished = true;
      teardown();
      resolve(res);
    }

    /* ---- lifecycle ---- */
    function teardown() {
      if (rafId) { try { window.cancelAnimationFrame(rafId); } catch (e) {} rafId = 0; }
      if (safetyT) { clearTimeout(safetyT); safetyT = null; }
      try { window.removeEventListener('keydown', onKeyDown, true); } catch (e) {}
      try { field.removeEventListener('pointermove', onMove); } catch (e) {}
      try { field.removeEventListener('pointerdown', onDown); } catch (e) {}
      try { field.removeEventListener('pointerup', onUp); } catch (e) {}
      try { window.removeEventListener('resize', onResize); } catch (e) {}
    }
    function onResize() { fit(); }
    function localXY(e) {
      var r = field.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    var downAt = null;
    function onMove(e) { var p = localXY(e); pointer.x = p.x; pointer.y = p.y; }
    function onDown(e) {
      var p = localXY(e); pointer.x = p.x; pointer.y = p.y;
      downAt = p;
      e.preventDefault();
    }
    function onUp(e) {
      if (!downAt) return;
      var p = localXY(e);
      var moved = Math.hypot(p.x - downAt.x, p.y - downAt.y);
      downAt = null;
      if (moved < 14) fire(); /* tap = snap + fire; drag = pure slew */
    }
    function onKeyDown(e) {
      if (finished) return;
      if (e.key === 'Shift' || e.code === 'Space') { e.preventDefault(); holdSteady(); }
      else if (e.key === 'Escape') {
        settle({ kind: 'score', correct: null, points: -missPts, hpDelta: 0,
                 summary: 'SCOPE LOWERED' });
      }
    }

    try { window.addEventListener('keydown', onKeyDown, true); } catch (e) {}
    try { field.addEventListener('pointermove', onMove); } catch (e) {}
    try { field.addEventListener('pointerdown', onDown); } catch (e) {}
    try { field.addEventListener('pointerup', onUp); } catch (e) {}
    try { window.addEventListener('resize', onResize); } catch (e) {}

    function tick(now) {
      if (finished) return;
      if (lastNow === null) lastNow = now;
      var dtMs = Math.min(50, now - lastNow);
      lastNow = now;
      step(dtMs);
      if (!finished && (budgetLeft <= 0 || ctx.expired)) finishTimeout();
    }
    function loop(now) {
      if (finished) return;
      tick(now);
      if (finished) return;
      if (typeof window.requestAnimationFrame === 'function') rafId = window.requestAnimationFrame(loop);
    }
    tick(0); /* synchronous first frame: lens valid even before rAF fires */
    if (typeof window.requestAnimationFrame === 'function') rafId = window.requestAnimationFrame(loop);
    safetyT = setTimeout(function () { if (!finished) finishTimeout(); }, budgetMs + 2500);

    S.target = { shape: tShape, color: tColIdx, rot: tRot, colorName: tColName, shapeName: SHAPE_NAMES[tShape] };
    S.cells = cells; S.targetSlot = targetSlot; S.density = P.n; S.depth = ctx.depth | 0;

    /* ---- self-play / smoke hook ---- */
    window.__OW__ = {
      aim: function (x, y) { pointer.x = x; pointer.y = y; },
      holdSteady: holdSteady,
      fire: fire,
      finish: finishTimeout,
      advance: function (ms) {
        var left = ms;
        while (left > 0 && !finished) {
          var sl = Math.min(50, left); left -= sl;
          advVirt += sl;
          tick(1e9 + advVirt);
        }
      },
      state: function () {
        return {
          budgetLeftMs: Math.round(budgetLeft), misses: misses, missPts: missPts,
          steadies: steadies, steadyActive: steady, finished: finished,
          aim: { x: Math.round(pointer.x), y: Math.round(pointer.y) },
          lens: { x: Math.round(lens.x), y: Math.round(lens.y) },
          cells: cells.length, density: P.n, underLens: cellUnderLens()
        };
      }
    };
    if (ctx._smoke) window.__OW__.echo = function () {
      return { target: { shape: tShape, color: tColIdx, rot: tRot }, targetSlot: targetSlot,
               cells: cells, layout: layout, params: P };
    };
  });
}

/* ---------- engine-facing serializers ---------- */
function describeFn() {
  if (!S.target) return null;
  return { kind: 'overwatch-scope', target: S.target, answerCell: S.targetSlot,
           density: S.density, difficulty: clamp(1 + Math.floor((S.depth - 1) / 3), 1, 5) };
}

/* ---------- registration (Stage absent -> queue, W3 brief) ---------- */
var STAGE = {
  id: 'overwatch-scope',
  name: 'OVERWATCH',
  weight: 3,
  minDepth: 4,
  worlds: ['scope-range'],
  net: 'seed',
  mount: mount,
  describe: describeFn,
  cleanup: function () { try { window.__OW__ && window.__OW__.finish && window.__OW__.finish(); } catch (e) {} }
};
if (root.Stage && typeof root.Stage.register === 'function') root.Stage.register(STAGE);
else (window.__stagePending = window.__stagePending || []).push(STAGE);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { id: 'overwatch-scope', worlds: ['scope-range'] };
}
})();
