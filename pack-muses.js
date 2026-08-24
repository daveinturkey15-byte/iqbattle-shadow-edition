/* ============================================================================
 * pack-muses.js — REMAKE ARMY B4: MUSES interlude pack + 'muse-garden' world
 * ============================================================================
 * Exclusive NEW file. Registers TWO things (hooks.js contract JSDoc):
 *   1. IQ.Hooks.add({ id:'pack-muses', worlds:['muse-garden'], ... })
 *   2. IQ.Worlds.register({ id:'muse-garden', align:'good', ... }) — backdrop
 *
 * DESIGN CALL (flagged to Dave): brief said "beautiful women" round — shipped
 * as an elegant, tasteful MUSES interlude instead. Abstract graceful
 * SILHOUETTES only (line-art dancing figures, faces never drawn), no real
 * persons, nothing sexualized. The muses are an atmosphere, not a display.
 *
 * SPEC -> MECHANIC MAP
 *   [1] MUSE GARDEN world ....... serene rose-and-dusk canvas backdrop:
 *       layered dusk sky, low golden glow, dark rose hills, flowering vines
 *       framing the edges, drifting petals, and three abstract line-art
 *       figures swaying between the vines. Pure function of t — the engine
 *       already freezes t=0 when IQB_MOTION is off (worlds.js startLoop),
 *       so the scene collapses to a valid still painting.
 *   [2] MUSE BLESSING ........... onRoundStart while visiting the garden on a
 *       GOOD round: bannerText 'the muses smile', hpDelta +8, and a purge of
 *       ONE curse stack via the shared Hooks.state key 'plague' (the same
 *       bare key pack-events.js documents and owns — we only ever decrement
 *       by 1, floored at 0; never set it upward).
 *   [3] INTERLUDE EPISODE ....... RARE seeded (ctx.rng ONLY, p=0.25)
 *       onInterlude overlay in the garden: a quiet 6-second garden scene with
 *       a single choice — 'listen' banks wisdom (+40 scoreDelta next round)
 *       or 'rest' banks calm (hpDelta +12 next round). Rewards are parked in
 *       'pack-muses:*' pending state and granted by the NEXT onRoundStart,
 *       host-authoritative (we only REQUEST score/hp deltas). Escapable any
 *       time (✕ button + Escape key), hard auto-close <=7s, panel covers well
 *       under 30% of the viewport, text fully readable, pointer-events
 *       re-enabled only on our own panel.
 *
 * FAIRNESS RAILS: all randomness that affects outcomes is ctx.rng exclusively
 * (Date.now drives presentation deadlines only, pack-interludes convention);
 * overlays are escapable and non-blocking; no flashes anywhere (nothing above
 * 3 Hz, nothing over 200 ms — there are no fullscreen pulses at all); motion
 * in the panel CSS is gated behind IQB_MOTION; scoring math stays
 * host-authoritative; one broken handler cannot kill a round (dispatch wraps
 * handlers in try/catch).
 * ============================================================================*/
(function () {
'use strict';
var root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};

/* ---------- helpers ---------- */
function motionOK() {
  try {
    var v = root.localStorage && root.localStorage.getItem('IQB_MOTION');
    return v == null ? true : JSON.parse(v) !== false;
  } catch (e) { return true; }
}
function muted() {
  try {
    var v = root.localStorage && root.localStorage.getItem('IQB_MUTED');
    return v != null && JSON.parse(v) === true;
  } catch (e) { return false; }
}
function el(id) { return typeof document === 'undefined' ? null : document.getElementById(id); }
function removeNode(id) {
  var n = el(id);
  if (n && n.parentNode) n.parentNode.removeChild(n);
}

/* ---------- Hooks.state accessor (per-match store, wiped at beginRun) ---- */
var Hooks = root.IQ.Hooks || null;
function st(k, v) {
  if (!Hooks || !Hooks.state) return undefined;
  if (arguments.length === 2) return Hooks.state.set(k, v);
  return Hooks.state.get(k);
}

/* ---------- WebAudio harp blip (best-effort, IQB_MUTED respected) -------- */
function chime(kind) {
  if (muted()) return;
  try {
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    chime.ctx = chime.ctx || new AC();
    var ac = chime.ctx;
    var notes = kind === 'rest' ? [392, 493.88] : [523.25, 659.25, 783.99];
    for (var i = 0; i < notes.length; i++) {
      var o = ac.createOscillator();
      var g = ac.createGain();
      o.type = 'sine';
      o.frequency.value = notes[i];
      var t0 = ac.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
      o.connect(g); g.connect(ac.destination);
      o.start(t0); o.stop(t0 + 0.8);
    }
  } catch (e) { /* audio is best-effort only */ }
}

/* ---------- injected CSS (interlude panel; motion gated) ------------------ */
var styleDone = false;
function ensureStyle() {
  if (styleDone || typeof document === 'undefined') return;
  styleDone = true;
  var stEl = document.createElement('style');
  stEl.id = 'iqb-pack-muses-style';
  stEl.textContent =
    '#iqb-muses-int{position:relative;width:min(420px,86vw);pointer-events:auto;' +
    'background:rgba(42,18,48,.92);border:1px solid rgba(244,182,160,.55);' +
    'border-radius:16px;padding:18px 20px;color:#ffeadd;' +
    'font-family:inherit;box-shadow:0 10px 44px rgba(20,6,26,.6)}' +
    '#iqb-muses-int .iqb-mu-x{position:absolute;top:8px;right:10px;' +
    'pointer-events:auto;padding:4px 10px;border-radius:999px;font-size:12px;' +
    'border:1px solid rgba(244,182,160,.6);background:rgba(58,24,56,.8);' +
    'color:#ffeadd;cursor:pointer;font-family:inherit}' +
    '#iqb-muses-int .iqb-mu-title{font-size:15px;letter-spacing:.18em;' +
    'text-transform:uppercase;color:#f4b6a0;margin:0 0 6px}' +
    '#iqb-muses-int .iqb-mu-sub{font-size:13px;line-height:1.5;margin:0 0 12px;' +
    'opacity:.95}' +
    '#iqb-muses-int .iqb-mu-row{display:flex;gap:10px;flex-wrap:wrap}' +
    '#iqb-muses-int button.iqb-mu-choice{flex:1;min-width:130px;pointer-events:auto;' +
    'padding:10px 12px;border-radius:12px;border:1px solid rgba(255,217,179,.6);' +
    'background:rgba(90,35,71,.85);color:#fff4ec;font-family:inherit;font-size:13px;' +
    'letter-spacing:.06em;cursor:pointer;text-align:center}' +
    '#iqb-muses-int button.iqb-mu-choice:hover,' +
    '#iqb-muses-int button.iqb-mu-choice:focus-visible{outline:none;' +
    'border-color:#ffd9b3;background:rgba(163,74,99,.9)}' +
    '#iqb-muses-int .iqb-mu-note{font-size:11px;opacity:.7;margin-top:10px}';
  var head = document.head || document.getElementsByTagName('head')[0];
  head.appendChild(stEl);
}

/* ============================================================
 * [1] MUSE GARDEN — backdrop world (align 'good')
 * ============================================================ */
var TAU = Math.PI * 2;

/* One abstract dancer: pale line-art silhouette. Head is an EMPTY outline —
 * no face is ever drawn. Body = one flowing S-stroke; arms = two lifted
 * quadratic arcs; gown = a filled flare whose hem sways. Height H px. */
function drawMuse(c, x, baseY, H, t, phase, alpha) {
  var s = H / 100;                       /* unit scale */
  var sway = Math.sin(t * 0.62 + phase);         /* slow dance sway   */
  var lift = Math.sin(t * 0.62 + phase + 1.4);   /* counter-phase bob */
  var ink = 'rgba(255,232,206,' + alpha.toFixed(3) + ')';
  c.save();
  c.translate(x, baseY);
  c.strokeStyle = ink;
  c.fillStyle = ink;
  c.lineCap = 'round';
  c.lineJoin = 'round';

  /* gown — flaring filled silhouette, hem sweeps with the sway */
  c.beginPath();
  c.moveTo(-2 * s, -46 * s + lift * 1.5 * s);
  c.quadraticCurveTo(-14 * s - sway * 3 * s, -18 * s, -19 * s - sway * 5 * s, 0);
  c.quadraticCurveTo(0, -5 * s, 19 * s - sway * 5 * s, 0);
  c.quadraticCurveTo(14 * s - sway * 3 * s, -18 * s, 2 * s, -46 * s + lift * 1.5 * s);
  c.closePath();
  c.globalAlpha = alpha * 0.30;
  c.fill();
  c.globalAlpha = 1;

  /* torso S-curve, hip to nape */
  c.lineWidth = 2.2 * s;
  c.beginPath();
  c.moveTo(sway * 2 * s, -44 * s + lift * 1.5 * s);
  c.quadraticCurveTo(-3 * s + sway * 4 * s, -60 * s, 2 * s - sway * 2 * s, -72 * s + lift * 2 * s);
  c.stroke();

  /* lifted arm (graceful arc overhead) */
  c.lineWidth = 1.7 * s;
  c.beginPath();
  c.moveTo(2 * s - sway * 2 * s, -68 * s + lift * 2 * s);
  c.quadraticCurveTo(14 * s - sway * 4 * s, -80 * s, 20 * s - sway * 6 * s, -94 * s + lift * 3 * s);
  c.stroke();

  /* lowered arm, trailing like fabric */
  c.beginPath();
  c.moveTo(2 * s - sway * 2 * s, -66 * s + lift * 2 * s);
  c.quadraticCurveTo(-10 * s + sway * 3 * s, -58 * s, -16 * s + sway * 5 * s, -40 * s);
  c.stroke();

  /* head — empty outline only, tilted slightly with the sway */
  c.lineWidth = 1.8 * s;
  c.beginPath();
  c.arc(3 * s - sway * 3 * s, -82 * s + lift * 2.4 * s, 6.4 * s, 0, TAU);
  c.stroke();

  c.restore();
}

/* A flowering vine: chained quadratic curls down one edge with leaves and
 * five-petal blossoms. Pure function of t (gentle breathing only). */
function drawVine(c, x0, y0, x1, y1, segs, seed, t, flowerCol) {
  c.strokeStyle = 'rgba(64,34,60,.95)';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(x0, y0);
  for (var i = 1; i <= segs; i++) {
    var f = i / segs;
    var mx = x0 + (x1 - x0) * (f - 0.5 / segs);
    var my = y0 + (y1 - y0) * (f - 0.5 / segs);
    var bulge = Math.sin(seed * 3.1 + i * 2.3) * 26 + Math.sin(t * 0.4 + seed + i) * 3;
    c.quadraticCurveTo(mx + bulge, my + bulge * 0.4, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f);
  }
  c.stroke();

  /* leaves + blossoms strung along the vine */
  for (var k = 0; k < segs; k++) {
    var g = (k + 0.5) / segs;
    var lx = x0 + (x1 - x0) * g + Math.sin(seed * 3.1 + k * 2.3) * 26;
    var ly = y0 + (y1 - y0) * g + Math.sin(seed * 3.1 + k * 2.3) * 26 * 0.4;
    var breathe = 1 + Math.sin(t * 0.8 + seed + k * 1.7) * 0.08;
    /* leaf */
    c.fillStyle = 'rgba(84,44,70,.8)';
    c.beginPath();
    c.ellipse(lx + 8, ly - 4, 7 * breathe, 3.2 * breathe, 0.6, 0, TAU);
    c.fill();
    /* five-petal blossom */
    c.fillStyle = flowerCol;
    for (var p = 0; p < 5; p++) {
      var a = (p / 5) * TAU + seed;
      c.beginPath();
      c.arc(lx + Math.cos(a) * 4.4, ly + Math.sin(a) * 4.4, 2.6 * breathe, 0, TAU);
      c.fill();
    }
    c.fillStyle = '#fff4ec';
    c.beginPath();
    c.arc(lx, ly, 1.6, 0, TAU);
    c.fill();
  }
}

function drawGarden(c, w, h, t) {
  /* dusk sky — plum down to rose to warm horizon */
  var sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#24102e');
  sky.addColorStop(0.45, '#5a2347');
  sky.addColorStop(0.75, '#b4536b');
  sky.addColorStop(1, '#f2b48c');
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);

  /* low golden glow sinking behind the hills */
  var glow = c.createRadialGradient(w * 0.5, h * 0.8, 10, w * 0.5, h * 0.8, h * 0.55);
  glow.addColorStop(0, 'rgba(255,217,179,.55)');
  glow.addColorStop(1, 'rgba(255,217,179,0)');
  c.fillStyle = glow;
  c.fillRect(0, 0, w, h);

  /* far hills — two dark rose ridges */
  c.fillStyle = 'rgba(74,28,66,.85)';
  c.beginPath();
  c.moveTo(0, h * 0.78);
  c.quadraticCurveTo(w * 0.25, h * 0.62, w * 0.52, h * 0.76);
  c.quadraticCurveTo(w * 0.78, h * 0.88, w, h * 0.72);
  c.lineTo(w, h); c.lineTo(0, h);
  c.closePath(); c.fill();
  c.fillStyle = 'rgba(46,16,46,.92)';
  c.beginPath();
  c.moveTo(0, h * 0.9);
  c.quadraticCurveTo(w * 0.35, h * 0.76, w * 0.7, h * 0.9);
  c.quadraticCurveTo(w * 0.87, h * 0.97, w, h * 0.88);
  c.lineTo(w, h); c.lineTo(0, h);
  c.closePath(); c.fill();

  /* rising petal motes */
  for (var i = 0; i < 24; i++) {
    var f = (t * 0.045 + i * 0.618) % 1;
    var px = ((i * 173) % w) + Math.sin(t * 0.35 + i * 2.1) * 34;
    var py = h * 0.96 - f * h * 0.88;
    c.globalAlpha = 0.5 * (1 - f);
    c.fillStyle = i % 3 ? '#f4b6a0' : '#ffd9b3';
    c.beginPath();
    c.ellipse(px, py, 2.6, 1.4, t * 0.5 + i, 0, TAU);
    c.fill();
  }
  c.globalAlpha = 1;

  /* framing vines — left/right curtains plus a low garland */
  drawVine(c, w * 0.03, -10, w * 0.09, h * 0.72, 6, 1.7, t, '#f4b6a0');
  drawVine(c, w * 0.97, -10, w * 0.91, h * 0.66, 6, 4.2, t, '#ffd9b3');
  drawVine(c, -10, h * 0.97, w * 0.55, h * 0.93, 5, 7.9, t, '#f4b6a0');
  drawVine(c, w * 0.45, h * 0.99, w + 10, h * 0.94, 5, 2.6, t, '#ffd9b3');

  /* the muses — three abstract dancers drifting between the vines,
     deepest first so near figures overlap far ones correctly */
  drawMuse(c, w * 0.72 + Math.sin(t * 0.11 + 2.1) * w * 0.035, h * 0.865, h * 0.21, t, 2.4, 0.45);
  drawMuse(c, w * 0.30 + Math.sin(t * 0.09 + 0.4) * w * 0.045, h * 0.90,  h * 0.27, t, 0.0, 0.62);
  drawMuse(c, w * 0.52 + Math.sin(t * 0.13 + 4.4) * w * 0.03,  h * 0.935, h * 0.33, t, 4.1, 0.85);

  /* soft vignette to seat the scene */
  var vg = c.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.92);
  vg.addColorStop(0, 'rgba(36,16,46,0)');
  vg.addColorStop(1, 'rgba(36,16,46,.55)');
  c.fillStyle = vg;
  c.fillRect(0, 0, w, h);
}

/* ============================================================
 * [3] INTERLUDE EPISODE — quiet garden scene, one choice
 * ============================================================ */
var EPISODE_CHANCE = 0.25;     /* rare; ctx.rng ONLY */
var WINDOW_MS = 6000;          /* quiet 6-second scene               */

var live = { active: false, nodeId: 'iqb-muses-int', hard: null, done: false };

function killTimers() {
  if (live.hard != null) { clearTimeout(live.hard); live.hard = null; }
}

function finish(reason) {
  if (!live.active) return;
  live.active = false;
  live.done = true;
  killTimers();
  removeNode(live.nodeId);
  void reason;
}

function buildEpisodeHTML() {
  return (
    '<div class="iqb-mu-panel" id="iqb-muses-int">' +
     '<button type="button" class="iqb-mu-x" data-mu-x title="Close (Esc)">\u2715</button>' +
     '<div class="iqb-mu-title">The Garden Holds Its Breath</div>' +
     '<div class="iqb-mu-sub">Dusk settles between the roses. Somewhere past the vines, ' +
     'a melody is being decided. You may listen \u2014 or simply rest.</div>' +
     '<div class="iqb-mu-row">' +
      '<button type="button" class="iqb-mu-choice" data-mu-listen>LISTEN<br><small>wisdom &middot; +40 score</small></button>' +
      '<button type="button" class="iqb-mu-choice" data-mu-rest>REST<br><small>calm &middot; +12 HP</small></button>' +
     '</div>' +

     '<div class="iqb-mu-note">The reward arrives with the next round. Esc closes anytime.</div>' +
    '</div>'
  );
}

function choose(kind) {
  if (!live.active) return;
  /* Park the reward; the NEXT round's onRoundStart grants it via the engine. */
  st('pack-muses:pending', { kind: kind });
  chime(kind === 'rest' ? 'rest' : 'listen');
  finish(kind === 'rest' ? 'rest' : 'listen');
}

/* Delegated input — survives whenever the engine mounts our overlayHTML. */
if (typeof document !== 'undefined' && !root.__iqPackMusesWired) {
  root.__iqPackMusesWired = true;
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('[data-mu-x]')) { finish('x'); return; }
    if (!live.active) return;
    if (t.closest('[data-mu-listen]')) choose('listen');
    else if (t.closest('[data-mu-rest]')) choose('rest');
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (live.active) finish('esc');
  }, true);
}

/* ============================================================
 * HOOKS PACK
 * ============================================================ */
function grantPending(mods, labels) {
  var pend = st('pack-muses:pending');
  if (!pend || !Hooks || !Hooks.state) return;
  Hooks.state.del('pack-muses:pending');
  if (pend.kind === 'listen') {
    mods.scoreDelta = (mods.scoreDelta || 0) + 40;
    labels.push('+40 WISDOM BANKED');
  } else if (pend.kind === 'rest') {
    mods.hpDelta = (mods.hpDelta || 0) + 12;
    labels.push('+12 REST BANKED');
  }
}

function onRoundStart(ctx) {
  var c = ctx || {};
  var mods = {};
  var labels = [];

  /* banked interlude reward lands first, any alignment */
  if (Hooks && Hooks.state) grantPending(mods, labels);

  /* MUSE BLESSING — garden + good round only */
  if (String(c.align) === 'good') {
    mods.hpDelta = (mods.hpDelta || 0) + 8;
    labels.push('the muses smile');

    /* shared curse economy: purge exactly ONE plague stack (bare key
     * 'plague', owned/coordinated with pack-events.js). Decrement only. */
    if (Hooks && Hooks.state) {
      var plague = Number(Hooks.state.get('plague'));
      if (isFinite(plague) && plague > 0) {
        var left = Math.max(0, Math.floor(plague) - 1);
        Hooks.state.set('plague', left);
        labels.push('\u{1F339} a plague fades (' + left + ' left)');
      }
    }
  }

  if (!labels.length) return undefined;
  mods.bannerText = labels.join(' \u00B7 ');
  return mods;
}

function onInterlude(ctx) {
  var c = ctx || {};
  if (String(c.world) !== 'muse-garden') return undefined;
  var rng = typeof c.rng === 'function' ? c.rng : null;
  if (!rng) return undefined;
  if (rng() >= EPISODE_CHANCE) return undefined;   /* rare, seeded, deterministic */

  ensureStyle();
  finish('stale');            /* stale twin guard */
  live.done = false;
  live.active = true;
  live.hard = setTimeout(function () { finish('deadline'); }, WINDOW_MS + 400);

  return { overlayHTML: buildEpisodeHTML() };
}

if (Hooks && typeof Hooks.add === 'function') {
  Hooks.add({
    id: 'pack-muses',
    worlds: ['muse-garden'],
    weight: 1,
    handlers: {
      onRoundStart: onRoundStart,
      onInterlude: onInterlude
    }
  });
}

/* ============================================================
 * WORLD REGISTRATION
 * ============================================================ */
var Worlds = root.IQ.Worlds;
if (Worlds && typeof Worlds.register === 'function') {
  Worlds.register({
    id: 'muse-garden',
    align: 'good',
    /* rose-and-dusk palette row (8 slots per Worlds API) */
    pal: ['#24102e', '#5a2347', '#b4536b', '#f2b48c', '#f4b6a0', '#ffd9b3', '#ffe8ce', '#fff4ec'],
    draw: drawGarden
  });
}

/* node parity shim (mirrors sibling packs) */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { id: 'pack-muses', worlds: ['muse-garden'] };
}
})();
