/* ============================================================
   modes/floorfall.js — STAGE "FLOOR-FALL" (W3 themed takeover)
   Design: research/modes-themed-design.md §1 (canonical).
   SUPersedes: the pack-hunters 'floor-fall' modifier hook on its
   bound worlds while this stage is registered (takeover wins by
   weight, design §0.4); the hook remains the low-depth fallback.

   Registration shape (research/mode-contract.md):
     window.IQ.Stage.register({
       id:'floor-fall', name:'FLOOR-FALL', weight:6, minDepth:3,
       worlds:['volcano','wasteland-roads','hazard-pit'], aligns:['bad'],
       net:'relay',
       mount(container, ctx) -> Promise<StageResult>
     });
   If IQ.Stage is absent the stage object is queued on
   window.__stagePending (W3 takeover brief).

   Controls:
     pointer/touch .... cursor IS your body; stand on a stone tile
                        to load it, click to commit that answer.
     keys 1-8 ......... pick a tile without standing (no plunge
                        risk, NOT eligible for the surefooted bonus).
     Timer out ........ stage self-resolves (cap = ctx.timerLen ≤45 s).

   Mechanic (design §1): 8 answer options are stone tiles over lava.
   Seeded fall schedule (first fall at 25% of budget, then every
   gap 4.0->2.2 s by depth; crack warning 0.8->0.4 s; depth>=6
   double-falls; depth>=9 cosmetic tilt). Standing on a tile when
   it drops = plunge (hp -12 live-fold, shake, 0.7 s stun).
   Solvability rails: never fewer than 3 standing tiles; the
   correct tile is spared (secret-host, pre-reveal) while >=3
   wrong tiles remain — the skip never leaks the answer.

   StageResult fields resolved:
     kind:    'score'
     correct: true  = correct pick while its tile stood
              false = wrong pick / forced pick
              null  = timer out (structural)
     points:  base(round(100*difficulty + leftFrac*80)) [+25
              'surefooted' when >=2 falls survived, never plunged,
              and the pick was a standing click (not keyboard)]
              0 on fail/timeout.
     hpDelta: -(12*plunges) on win/fail rows; -(5+12*plunges) on
              timeout. DEVIATION NOTE: design routes plunge damage
              through the live round pipeline; until the engine
              exposes an in-stage hp bridge, plunge damage folds
              into the final hpDelta (host clamps [-60,60]).
     summary: 'SUREFOOTED · FLOOR CLEARED' | 'FLOOR CLEARED' |
              'THE FLOOR TOOK YOU' | 'BURIED WITH THE TILES'

   MP (design §0.2): schedule base = seeded-sim from ctx.rng; the
   secret-host skip is resolved pre-reveal on the host and only
   the resulting PUBLIC fall order ships in frame() (clients
   never learn which tile was spared-or-why). Plunge detection =
   input-relay: clients play locally, send {t:'pick'} frames and
   resolve relay:false; host scoring is authoritative via
   describe(). The hidden answer is NEVER read pre-reveal and
   NEVER ships in frame().

   Fairness rails: telegraphed 0.4-0.8 s crack shimmer before any
   drop; hurt feedback is a localized vignette (<200 ms, no
   fullscreen strobe); motion via ctx.fx (engine-gated); ambient
   lava loop disabled under prefers-reduced-motion; no blocking
   overlays; text >= 11 px.

   Self-play / smoke hook (per mount): window.__FF__
     state()                 -> {dropped,droppedCount,plunges,dmg,
                                 standing,finished,schedule?,answerPos?,
                                 rects}
     pointTo(x,y)            -> synthetic pointer move (smoke)
     commit(pos) / key(n)    -> commit tile `pos` / keyboard pick
     advance(ms)             -> virtual-clock step (headless; the
                                rAF loop drives real browsers)
     _smoke ctx flag additionally exposes schedule + answerPos.
   ============================================================ */
(function () {
'use strict';
var root = window.IQ = window.IQ || {};

/* ---------- constants ---------- */
var COLS = 4, ROWS = 2, TILES = COLS * ROWS;
var MIN_STANDING = 3;          /* solvability rail (design §1)     */
var PLUNGE_HP = 12;
var TIMEOUT_HP = 5;
var SUREFOOTED = 25;
var RESPAWN_LOCK_MS = 700;
var REVEAL_HOLD_MS = 1100;

/* ---------- per-round module state (frame()/describe() read it) ---------- */
var S = {};

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function mulberry(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- depth scaling (design §1) ---------- */
function paramsFor(depth) {
  var d = clamp(depth | 0, 1, 10);
  return {
    gapMs: Math.round(lerp(4000, 2200, (d - 1) / 9)),
    warnMs: Math.round(lerp(800, 400, (d - 1) / 9)),
    doubleFall: d >= 6,
    tilt: d >= 9
  };
}

/* ---------- secret-host schedule builder (design §1) ----------
   rand: fn()->[0,1) (ctx.rng stream). answerPos: display-space
   index of the correct option (-1 = unknown/impossible). Rails:
   a beat may drop a tile only if >=3 would survive; the correct
   tile is skipped while >=3 wrong tiles stand. */
function pickVictims(rand, standing, P, answerPos) {
  var pool = standing.slice();
  var out = [];
  var want = P.doubleFall ? 2 : 1;
  for (var i = 0; i < want; i++) {
    if (pool.length - 1 < MIN_STANDING) break;
    var tries = pool.length, placed = false;
    while (tries-- > 0 && pool.length > 0) {
      var idx = Math.floor(rand() * pool.length) % pool.length;
      var cand = pool[idx];
      var wrongStand = pool.length - (pool.indexOf(answerPos) >= 0 ? 1 : 0);
      if (cand === answerPos && wrongStand >= 3) { pool.splice(idx, 1); continue; } /* spare the truth */
      out.push(cand); pool.splice(idx, 1); placed = true; break;
    }
    if (!placed) break;
  }
  return { v: out, standing: pool };
}
function buildSchedule(rand, budgetMs, P, answerPos) {
  var standing = [];
  for (var i = 0; i < TILES; i++) standing.push(i);
  var beats = [];
  var t = Math.round(budgetMs * 0.25);
  var guard = 0;
  while (t <= budgetMs * 0.95 && standing.length > MIN_STANDING && guard++ < 64) {
    var res = pickVictims(rand, standing, P, answerPos);
    if (res.v.length) { beats.push({ t: t, dropAt: t + P.warnMs, v: res.v }); standing = res.standing; }
    t += P.gapMs;
  }
  return beats;
}

/* ---------- puzzle sourcing (mirrors mode-puzzle.js discipline;
   generators may use their own randomness — only schedule/ord
   consume the ctx.rng stream, in a fixed order) ---------- */
function shuffledOrder(n, rng) {
  var o = []; for (var i = 0; i < n; i++) o.push(i);
  for (var j = o.length - 1; j > 0; j--) { var k = Math.floor(rng() * (j + 1)); var tmp = o[j]; o[j] = o[k]; o[k] = tmp; }
  return o;
}
function fallbackPuzzle() {
  var cells = []; for (var i = 0; i < 9; i++) cells.push(i === 4 ? null : { shape: 'plus', color: (i % 2 === 0 ? i : i + 2) % 8, rot: i % 4 });
  var correct = { shape: 'plus', color: 2, rot: 0 };
  return { id: 'ff-fb', kind: 'matrix', difficulty: 1, rule: 'colors advance along rows',
    board: { cols: 3, rows: 3, cells: cells, holeIndex: 4 },
    options: Array.from({ length: 8 }, function (_, i) { return { cols: 1, rows: 1, cells: [i ? { shape: correct.shape, color: (correct.color + i) % 8, rot: 0 } : correct] }; }),
    answer: 0 };
}
function sourcePuzzle(ctx) {
  var G_ = root.Gens || {};
  var tier = ctx.tier | 0;
  var table = tier <= 0 ? ['iqvs', 'iqvs', 'latin', 'cycle']
    : tier === 1 ? ['iqvs', 'iqvs', 'latin', 'cycle', 'count', 'logicA', 'missingSec']
    : tier === 2 ? ['iqvs', 'latin', 'cycle', 'count', 'dual', 'dual', 'logicA', 'logicB', 'seqPack', 'missingSec']
    : ['wild', 'wild', 'dual', 'iqvs', 'latin', 'logicA', 'logicB', 'seqPack', 'missingSec'];
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
  return '<span class="ff-glyph">?</span>';
}
function questionHTML(pz) {
  var b = boardKit();
  if (!pz) return '';
  if (b && b.tileSVG) {
    try {
      if (pz.kind === 'matrix' && pz.board) return b.tileSVG(pz.board, 210, pz._tier | 0, true);
      if (pz.kind === 'sequence' && pz.seq) {
        var cs = 190 / (pz.seq.length + 1);
        var html = '<div style="display:flex;gap:8px;align-items:center">';
        for (var i = 0; i < pz.seq.length; i++) html += b.tileSVG({ cols: 1, rows: 1, cells: [pz.seq[i]] }, cs * .8, pz._tier | 0, false);
        html += b.tileSVG({ cols: 1, rows: 1, cells: [null] }, cs * .8, pz._tier | 0, true) + '</div>';
        return html;
      }
      if (pz.kind === 'oddone' && pz.oddBoard) return b.tileSVG(pz.oddBoard, 210, pz._tier | 0, false);
    } catch (e) { /* fallback below */ }
  }
  return '<div class="ff-qtext">WHICH TILE HOLDS THE TRUTH?</div>';
}

/* ---------- CSS ---------- */
var CSS =
  '.stage-view[data-stage="floor-fall"]{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' +
  'gap:8px;padding:10px;background:radial-gradient(120% 90% at 50% 115%,#3a1002 0%,#160708 42%,#0a0508 100%);' +
  'color:#f3e2c8;font-family:Oxanium,monospace;overflow:hidden}' +
  '@media (prefers-reduced-motion:no-preference){.stage-view[data-stage="floor-fall"] .ff-floor::after{content:"";position:absolute;' +
  'left:0;right:0;bottom:-6px;height:14px;background:linear-gradient(90deg,#ff5a1e,#ffb01e,#ff5a1e);filter:blur(6px);opacity:.75;' +
  'animation:fflava 3.2s ease-in-out infinite alternate}}' +
  '@keyframes fflava{from{transform:scaleY(.7)}to{transform:scaleY(1.25)}}' +
  '.ff-head{width:100%;max-width:760px;display:flex;justify-content:space-between;font-size:13px;letter-spacing:.22em;color:#ffb01e}' +
  '.ff-meta{font-size:11px;letter-spacing:.12em;color:#c9a97a}' +
  '.ff-q{min-height:64px;display:flex;justify-content:center}.ff-qtext{font-size:13px;letter-spacing:.2em;color:#f3e2c8;align-self:center}' +
  '.ff-floor{position:relative;width:100%;max-width:760px;height:min(31vh,236px);transition:transform .6s ease}' +
  '.ff-floor.ff-tilt{transform:rotate(-2deg)}' + /* cosmetic only — hitboxes are the unrotated rects */
  '.ff-tile{position:absolute;display:flex;align-items:center;justify-content:center;border-radius:6px;' +
  'background:linear-gradient(180deg,#37302a,#241f1b);border:2px solid #57493c;box-shadow:0 3px 0 #171310;' +
  'cursor:pointer;user-select:none;touch-action:manipulation;transition:transform .45s ease,opacity .45s ease,border-color .15s}' +
  '.ff-tile:hover{border-color:#8a7358}.ff-key{position:absolute;top:2px;left:5px;font-size:11px;color:#c9a97a;letter-spacing:.1em}' +
  '.ff-glyph{font-size:20px;color:#f3e2c8}' +
  '.ff-crack{border-color:#ffb01e;box-shadow:0 0 10px 2px rgba(255,176,30,.55);animation:ffcrack .22s steps(2) infinite}' +
  '@keyframes ffcrack{50%{filter:brightness(1.45)}}' +
  '.ff-drop{transform:translateY(130%) rotate(7deg)!important;opacity:.15;pointer-events:none;border-color:#3a1002}' +
  '.ff-picked{outline:2px solid #00e68a}' +
  '.ff-correct{outline:2px solid #00e68a;background:linear-gradient(180deg,#173c2a,#0e2418)}' +
  '.ff-wrongpick{outline:2px solid #ff2038}' +
  '.ff-hurt::before{content:"";position:absolute;inset:0;pointer-events:none;' +
  'box-shadow:inset 0 0 90px 24px rgba(255,32,56,.55)}' +
  '.ff-foot{font-size:12px;letter-spacing:.14em;color:#e8cf9e;min-height:16px}' +
  '@media (prefers-reduced-motion:reduce){.ff-tile,.ff-floor{transition:none;animation:none}}';

/* ============================================================
   mount
   ============================================================ */
function mount(container, ctx) {
  return new Promise(function (resolve) {
    var client = !!(ctx.mp && ctx.mp.client);
    var budgetMs = Math.min((ctx.timerLen | 0) || 45, 45) * 1000;
    var P = paramsFor(ctx.depth);

    /* ---- challenge assembly ---- */
    var pz, ord, beats, answerPos;
    if (client) {
      var fr = ctx.frame || null;
      if (!fr || !fr.options) { resolve({ kind: 'score', correct: null, points: 0, hpDelta: 0, summary: 'SIGNAL LOST' }); return; }
      pz = { kind: fr.kind, board: fr.board, oddBoard: fr.oddBoard, seq: fr.seq, options: fr.options, difficulty: fr.diff || 1, answer: -99, _tier: ctx.tier };
      ord = (fr.ord && fr.ord.length === fr.options.length) ? fr.ord : fr.options.map(function (_, i) { return i; });
      beats = (fr.falls || []).map(function (b) { return { t: b.t, dropAt: b.d, v: b.v }; });
      answerPos = -1; /* never known pre-reveal on clients */
    } else {
      pz = sourcePuzzle(ctx);
      ord = shuffledOrder(pz.options.length, ctx.rng);
      answerPos = ord.indexOf(pz.answer); /* host/solo secret */
      beats = buildSchedule(ctx.rng, budgetMs, P, answerPos);
    }

    /* ---- dom ---- */
    var view = document.createElement('div');
    view.className = 'stage-view';
    view.setAttribute('data-stage', 'floor-fall');
    var style = document.createElement('style');
    style.textContent = CSS;
    view.appendChild(style);

    var head = document.createElement('div');
    head.className = 'ff-head';
    var title = document.createElement('span');
    title.textContent = 'FLOOR-FALL · DEPTH ' + (ctx.depth | 0);
    var meta = document.createElement('span');
    meta.className = 'ff-meta';
    meta.textContent = 'STAND ON A TILE · CLICK COMMITS · KEYS 1-8 PICK SAFE';
    head.appendChild(title); head.appendChild(meta);

    var q = document.createElement('div');
    q.className = 'ff-q';
    q.innerHTML = questionHTML(pz);

    var floor = document.createElement('div');
    floor.className = 'ff-floor' + (P.tilt ? ' ff-tilt' : '');
    var tileEls = [];
    for (var pos = 0; pos < TILES; pos++) {
      var tl = document.createElement('div');
      tl.className = 'ff-tile';
      tl.setAttribute('data-pos', String(pos));
      tl.setAttribute('role', 'button');
      var key = document.createElement('span');
      key.className = 'ff-key';
      key.textContent = String(pos + 1);
      var art = document.createElement('span');
      art.innerHTML = optionHTML(pz.options ? pz.options[ord[pos]] : null, ctx.tier);
      tl.appendChild(key); tl.appendChild(art);
      floor.appendChild(tl);
      tileEls.push(tl);
    }

    var foot = document.createElement('div');
    foot.className = 'ff-foot';
    view.appendChild(head); view.appendChild(q); view.appendChild(floor); view.appendChild(foot);
    container.appendChild(view);

    /* ---- layout (single source of truth for hit-tests) ---- */
    var rects = [];
    function layout() {
      var fw = floor.clientWidth || 640, fh = floor.clientHeight || 220;
      var gap = Math.max(6, Math.round(fw * 0.014));
      var tw = (fw - gap * (COLS + 1)) / COLS, th = (fh - gap * (ROWS + 1)) / ROWS;
      rects.length = 0;
      for (var i = 0; i < TILES; i++) {
        var c = i % COLS, r = (i / COLS) | 0;
        var rc = { x: gap + c * (tw + gap), y: gap + r * (th + gap), w: tw, h: th };
        rects.push(rc);
        var el = tileEls[i];
        el.style.left = rc.x + 'px'; el.style.top = rc.y + 'px';
        el.style.width = rc.w + 'px'; el.style.height = rc.h + 'px';
      }
    }
    layout();

    /* ---- round state ---- */
    var t0 = null, finished = false, rafId = 0, safetyT = null, advVirt = 0;
    var dropped = {}, pendingDrop = [], beatsIx = 0;
    var pointer = { x: -999, y: -999, inn: false };
    var standingPos = -1, lockUntil = -1;
    var plunges = 0, dmg = 0, droppedCount = 0, relT = 0;
    var picked = false;

    function say(fn, arg) { try { if (typeof fn === 'function') fn(arg); } catch (e) { /* never break gameplay */ } }
    function banner(t) { say(ctx.banner, t); }
    function shake() { try { if (ctx.fx && typeof ctx.fx.shake === 'function') ctx.fx.shake(14, 320); } catch (e) { } }
    function sfx(name) { try { if (ctx.audio && typeof ctx.audio.p === 'function') ctx.audio.p(name); } catch (e) { } }
    function leftFrac() { try { return clamp(+ctx.leftFrac() || 0, 0, 1); } catch (e) { return 1; } }

    function hitTile(x, y) {
      for (var i = 0; i < rects.length; i++) {
        var r = rects[i];
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
      }
      return -1;
    }

    /* ---- plunge (input-relay domain: local verdict, folded hp) ---- */
    function plunge(t) {
      plunges++; dmg += PLUNGE_HP;
      lockUntil = t + RESPAWN_LOCK_MS;
      standingPos = -1;
      view.classList.add('ff-hurt');
      setTimeout(function () { view.classList.remove('ff-hurt'); }, 170); /* <200 ms rail */
      shake(); sfx('glitch'); banner('PLUNGE · HP \u2212' + PLUNGE_HP);
    }

    /* ---- frame tick ---- */
    function tick(now) {
      if (finished) return;
      if (t0 === null) t0 = now;
      var t = now - t0; relT = t;

      while (beatsIx < beats.length && t >= beats[beatsIx].t) {
        var b = beats[beatsIx++];
        for (var i = 0; i < b.v.length; i++) {
          var vp = b.v[i];
          if (dropped[vp]) continue;
          tileEls[vp].classList.add('ff-crack'); /* telegraph */
          pendingDrop.push({ at: b.dropAt, pos: vp });
        }
      }
      for (var jj = pendingDrop.length - 1; jj >= 0; jj--) {
        var pd = pendingDrop[jj];
        if (t < pd.at) continue;
        pendingDrop.splice(jj, 1);
        if (dropped[pd.pos]) continue;
        dropped[pd.pos] = true; droppedCount++;
        tileEls[pd.pos].classList.remove('ff-crack');
        tileEls[pd.pos].classList.add('ff-drop');
        if (pd.pos === standingPos && t >= lockUntil && standingPos !== -1) plunge(t);
        sfx('thud');
      }

      standingPos = hitTile(pointer.x, pointer.y);
      var secs = Math.max(0, Math.ceil((budgetMs - t) / 1000));
      foot.textContent = 'TILES ' + (TILES - droppedCount) + '/' + TILES +
        ' · FALLS ' + droppedCount + ' · PLUNGES ' + plunges + ' · ' + secs + 's';

      if (t >= budgetMs || ctx.expired) { finishTimeout(); }
    }

    /* ---- commit ---- */
    function commit(pos, viaKey) {
      if (finished || picked) return;
      if (pos < 0 || pos >= TILES) return;
      if (dropped[pos]) { banner('THAT TILE IS GONE'); return; }
      if (!viaKey && pos !== hitTile(pointer.x, pointer.y)) return; /* must stand on what you click */
      picked = true;
      tileEls[pos].classList.add('ff-picked');

      if (client) {
        try { ctx.net.send({ t: 'pick', n: ctx.depth, pos: pos, name: ctx.name, uid: ctx.net.uid() }); } catch (e) { }
        setTimeout(function () {
          resolveOnce({ kind: 'score', correct: false, points: 0, hpDelta: 0, summary: '', relay: false }); /* host reveal tells the truth */
        }, REVEAL_HOLD_MS);
        return;
      }

      var correct = ord[pos] === pz.answer;
      if (correct) tileEls[pos].classList.add('ff-correct');
      else {
        tileEls[pos].classList.add('ff-wrongpick');
        if (answerPos >= 0) tileEls[answerPos].classList.add('ff-correct');
      }
      sfx(correct ? 'good' : 'bad');
      var base = Math.round(100 * (pz.difficulty || ctx.diff || 1) + leftFrac() * 80);
      var surefooted = correct && !viaKey && plunges === 0 && droppedCount >= 2;
      setTimeout(function () {
        resolveOnce(correct
          ? { kind: 'score', correct: true, points: base + (surefooted ? SUREFOOTED : 0), hpDelta: -dmg,
              summary: surefooted ? 'SUREFOOTED · FLOOR CLEARED' : 'FLOOR CLEARED' }
          : { kind: 'score', correct: false, points: 0, hpDelta: -dmg, summary: 'THE FLOOR TOOK YOU' });
      }, REVEAL_HOLD_MS);
    }

    function finishTimeout() {
      resolveOnce({ kind: 'score', correct: null, points: 0, hpDelta: -(TIMEOUT_HP + dmg), summary: 'BURIED WITH THE TILES' });
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
      try { view.removeEventListener('pointerdown', onDown); } catch (e) { }
      try { window.removeEventListener('resize', onResize); } catch (e) { }
    }
    function onResize() { layout(); }
    function onMove(e) {
      var r = floor.getBoundingClientRect();
      pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; pointer.inn = true;
    }
    function onDown(e) {
      onMove(e);
      if (finished || picked) return;
      if (lockUntil > 0 && relT < lockUntil) return; /* stunned */
      var p = hitTile(pointer.x, pointer.y);
      if (p < 0) { banner('STAND ON A TILE'); return; }
      commit(p, false);
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
    try { view.addEventListener('pointerdown', onDown); } catch (e) { }
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
    S.pz = pz; S.ord = ord; S.answerPos = answerPos; S.client = client;
    S.optOrder = ord; S.falls = beats.map(function (b) { return { t: b.t, d: b.dropAt, v: b.v }; });

    /* ---- self-play / smoke hook ---- */
    window.__FF__ = {
      pointTo: function (x, y) { pointer.x = x; pointer.y = y; pointer.inn = true; },
      commit: function (pos) { commit(pos, false); },
      key: function (n) { commit(n - 1, true); },
      advance: function (ms) { advVirt += ms; tick(1e9 + advVirt); }, /* virtual clock (headless) */
      state: function () {
        var st = {
          dropped: droppedCount, plunges: plunges, dmg: dmg, standing: standingPos,
          finished: finished, rects: rects.map(function (r) { return { x: r.x, y: r.y, w: r.w, h: r.h }; })
        };
        if (ctx._smoke) { st.schedule = beats; st.answerPos = answerPos; st.ord = ord; st.difficulty = pz.difficulty || 1; }
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
           falls: S.falls, diff: pz.difficulty, imp: pz.impossible ? 1 : 0 }; /* NO answer, NO rule */
}
function describeFn() {
  var pz = S.pz; if (!pz) return null;
  return { kind: 'floor-fall', answer: pz.impossible ? -99 : pz.answer, imp: !!pz.impossible,
           difficulty: pz.difficulty, ord: S.optOrder || S.ord, rule: pz.rule || '' };
}

/* ---------- registration (Stage absent -> queue per W3 brief) ---------- */
var STAGE = {
  id: 'floor-fall',
  name: 'FLOOR-FALL',
  weight: 6,
  minDepth: 3,
  worlds: ['volcano', 'wasteland-roads', 'hazard-pit'],
  aligns: ['bad'],
  net: 'relay',
  mount: mount,
  frame: frameFn,
  describe: describeFn,
  cleanup: function () { try { window.__FF__ && window.__FF__.finish && window.__FF__.finish(); } catch (e) { } }
};
if (root.Stage && typeof root.Stage.register === 'function') root.Stage.register(STAGE);
else (window.__stagePending = window.__stagePending || []).push(STAGE);
})();
