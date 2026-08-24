/* ============================================================================
 * pack-undead.js — REMAKE ARMY B4: four undead packs + four registered worlds
 * ============================================================================
 * Registers FIVE things (hooks.js contract JSDoc):
 *   Worlds : necro-dance, witch-hut, wizard-duel, acid-storm (IQ.Worlds.register)
 *   Packs  : necro-dance-beat, witch-hex, duel-spells, acid-storm-rain (IQ.Hooks.add)
 *
 * SPEC -> MECHANIC MAP (Dave's brief, line by line)
 *   1. DANCING SKELETONS  world 'necro-dance' | hook id 'necro-dance-beat'
 *      ~100 BPM track => beat interval 600ms. Round start seeds the beat
 *      PHASE and WINDOW length from ctx.rng (deterministic -> host/client
 *      parity); a monotonic presentation clock measures elapsed time only,
 *      same class as pack-hunters' input-reactive states. When the beat
 *      window opens, an onBeat pulse marker ships via overlayHTML (tiny
 *      pointer-events:none metronome glyph, <=200ms on screen, ~0.8Hz —
 *      well under the 3Hz rail). Answering INSIDE the window =>
 *      onPreAnswer requests scoreMul 1.15 ('ON BEAT'); off-beat clicks
 *      request scoreMul 0.9. IQB_MOTION off => no pulses at all, ONE static
 *      metronome banner explains the rhythm instead (bonuses unchanged).
 *   2. WITCHES' HUT       world 'witch-hut'   | hook id 'witch-hex'
 *      Round start: cackle stinger (sfx modifier) then EXACTLY ONE hex,
 *      chosen by a single seeded roll (ctx.rng ONLY):
 *        a) KEY-SWAP ......... the option NUMBER LABELS (.opt-key) are shown
 *           shuffled (seeded permutation). Pure visual misdirection: tiles
 *           keep dataset.i + click closures, picks still score against the
 *           SAME logical option (host-authoritative math untouched — same
 *           doctrine as pack-stones 'space'). Text stays readable.
 *        b) FOG PATCH ........ soft translucent fog blob over ONE SEEDED
 *           board corner via overlayHTML; pointer-events:none, non-opaque,
 *           <=~20% coverage, question/answer text untouched.
 *        c) EYE OF NEWT ...... pickup drop {kind:'health', value:5} (+5 HP
 *           through the engine's health-pickup path).
 *   3. WIZARD DUEL        world 'wizard-duel' | hook id 'duel-spells'
 *      INTERLUDE-CAPABLE: onInterlude opens a pre-round spell chooser
 *      (escapable: X button + Esc + hard 9s auto-close; auto-close picks
 *      nothing). Three buttons:
 *        SHIELD .. forgive the FIRST wrong answer next round (hpDelta +15,
 *                  exactly cancelling the engine's standard hurtHp(15))
 *        HASTE ... timerDelta +6 next round
 *        SCORCH .. disableWrongRandom:2 next round (the ENGINE burns two
 *                  distinct WRONG options — a pack never guesses correctIdx)
 *      Costs 15 score each (scoreDelta:-15, host-authoritative flat
 *      adjustment), FREE when streak >= 3 at choice time. Effects + cost
 *      travel together as modifiers flushed on the NEXT roundStart.
 *   4. ACID RAIN          world 'acid-storm'  | hook id 'acid-storm-rain'
 *      Speed pressure: every 4s IN-ROUND the rain bites hp -1 (hpDelta),
 *      UNLESS you answered CORRECTLY before 60% of the timer was consumed —
 *      then the rain relents (safe flag, no further ticks). Total exposure
 *      is capped: 4 ticks per round AND 4 hp per RUN (state-tracked).
 *      Rain visual = overlayHTML curtain, pointer-events:none, translucent;
 *      animated drips behind IQB_MOTION, faint static columns otherwise.
 *
 * FAIRNESS RAILS: all motion behind IQB_MOTION; flashes <=200ms and far
 * under 3Hz fullscreen; overlays escapable + pointer-events:none (except
 * the interlude chooser, which owns an X/Esc/hard-timeout escape); puzzle
 * text stays readable (fog/fog-like layers are translucent, <=~20-30%);
 * disableWrongRandom keeps the correct option safe; scoring stays
 * host-authoritative (we REQUEST scoreMul/scoreDelta/hpDelta/timerDelta);
 * randomness is ctx.rng exclusively (fallback rng is a seeded local
 * mulberry32 keyed on runId#round — zero Math.random anywhere). One broken
 * handler cannot kill a round (dispatch wraps handlers in try/catch).
 * ============================================================================*/
(function () {
'use strict';
var root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};
var IQ = root.IQ;

/* ---------- guarded Hooks/state fallbacks (pack-horror convention) ------- */
if (!IQ.Hooks || typeof IQ.Hooks.add !== 'function') {
  console.warn('[pack-undead] IQ.Hooks absent — installing stub queue + state fallback.');
  IQ.Hooks = IQ.Hooks || {};
  IQ.Hooks.add = function (pack) { (IQ.Hooks.__q = IQ.Hooks.__q || []).push(pack); };
}
if (!IQ.Hooks.state) {
  var mem = Object.create(null);
  IQ.Hooks.state = {
    get: function (k) { return mem[k]; },
    set: function (k, v) { mem[k] = v; return v; },
    has: function (k) { return Object.prototype.hasOwnProperty.call(mem, k); },
    del: function (k) { delete mem[k]; }
  };
}

/* ---------- shared helpers ------------------------------------------------ */

function nowMs() {
  return (root.performance && performance.now) ? performance.now() : Date.now();
}
function motionOK() {
  try {
    var v = root.localStorage && root.localStorage.getItem('IQB_MOTION');
    return v == null ? true : JSON.parse(v) !== false;
  } catch (e) { return true; }
}
function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

/* fnv1a + local mulberry32 — ONLY used when ctx.rng is missing (older
 * engines); still a pure function of (runId, round, owner): deterministic. */
function hashStr(s) {
  var h = 0x811c9dc5;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function mulberry(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Per-round runtime records keyed '<runId>#<round>@<owner>' — presentation
 * clocks + lazily-seeded fallback rng cursors only. */
var rt = Object.create(null);
function rec(owner, ctx, init) {
  var base = String((ctx && ctx.runId) || 'run') + '#' + (((ctx && ctx.round) | 0)) + '@' + owner;
  if (!rt[base]) {
    for (var old in rt) {
      if (old.indexOf(base.slice(0, base.lastIndexOf('@'))) === 0 && old !== base) delete rt[old];
    }
    rt[base] = init || {};
  }
  return rt[base];
}
/* Deterministic rng for THIS round+owner: ctx.rng when the engine supplies
 * it (the contract path), else a private seeded stream with a stable cursor
 * stored on the round record so repeated calls never rewind it. */
function rngOf(owner, ctx, r) {
  if (ctx && typeof ctx.rng === 'function') return ctx.rng;
  if (!r._frng) r._frng = mulberry(hashStr(String((ctx && ctx.runId) || 'run') + '#' + ((ctx && ctx.round) | 0) + '@' + owner));
  return r._frng;
}
function timerLenOf(ctx, r) {
  var v = ctx && typeof ctx.timerLen === 'number' ? ctx.timerLen : (r && r.timerLen) || 60;
  return v > 0 ? v : 60;
}

function st(k, v) {
  var H = IQ.Hooks;
  if (!H || !H.state) return undefined;
  if (arguments.length === 1) return H.state.get(k);
  return H.state.set(k, v);
}

/* Emit overlay/banner only when content changes (avoids overlay stacking). */
function vis(r, html, bannerText, extra) {
  var sig = (html || '') + '\u0000' + (bannerText || '');
  if (sig === r.sig) return null;
  r.sig = sig;
  var m = extra || {};
  m.overlayHTML = html || '';
  if (bannerText != null) m.bannerText = bannerText;
  return m;
}

/* ---------- injected style (rain drips + pulse glyph keyframes) ----------- */
var styleDone = false;
function ensureStyle() {
  if (styleDone || typeof document === 'undefined') return;
  styleDone = true;
  var s = document.createElement('style');
  s.id = 'ipn-undead-style';
  s.textContent =
    '@keyframes ipnRainFall{0%{transform:translateY(-12vh)}100%{transform:translateY(112vh)}}' +
    '@keyframes ipnPulsePop{0%{transform:translateX(-50%) scale(.6);opacity:.2}' +
    '35%{transform:translateX(-50%) scale(1.08);opacity:1}100%{transform:translateX(-50%) scale(1);opacity:.85}}' +
    '.ipn-rain-i{position:absolute;top:-14vh;width:2px;border-radius:0 0 2px 2px;' +
    'background:linear-gradient(180deg,rgba(178,255,96,0),rgba(178,255,96,.55))}' +
    '.ipn-pulse{position:absolute;left:50%;bottom:9vh;transform:translateX(-50%);' +
    'font-size:clamp(22px,4vw,34px);color:#eaffcf;text-shadow:0 0 14px rgba(190,255,120,.8);' +
    'pointer-events:none;animation:ipnPulsePop .18s ease-out 1 both}';
  var head = document.head || document.getElementsByTagName('head')[0];
  head.appendChild(s);
}

/* ==========================================================================
 * WORLDS (IQ.Worlds.register — same shape as worlds-pop.js defs)
 * ========================================================================*/

var TAU = Math.PI * 2;

function vgrad(c, h, stops) {
  var g = c.createLinearGradient(0, 0, 0, h);
  for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
  c.fillStyle = g;
}
/* one bobbing skeleton silhouette; bob locked to the 600ms beat */
function skel(c, x, y, s, ph, tint) {
  var b = Math.sin(ph) * s * 0.16;                 /* bounce */
  c.fillStyle = tint;
  c.beginPath(); c.arc(x, y - s * 0.9 + b, s * 0.28, 0, TAU); c.fill();     /* skull */
  c.fillRect(x - s * 0.16, y - s * 0.68 + b, s * 0.32, s * 0.5);            /* spine cage */
  c.beginPath();                                                            /* ribs hint */
  c.moveTo(x - s * 0.26, y - s * 0.5 + b); c.lineTo(x + s * 0.26, y - s * 0.5 + b); c.stroke();
  /* arms + legs, swinging opposite the bounce */
  c.lineWidth = Math.max(1.5, s * 0.09); c.strokeStyle = tint;
  c.beginPath();
  c.moveTo(x - s * 0.14, y - s * 0.58 + b); c.lineTo(x - s * 0.42, y - s * 0.3 + Math.sin(ph + 1) * s * 0.12 + b);
  c.moveTo(x + s * 0.14, y - s * 0.58 + b); c.lineTo(x + s * 0.42, y - s * 0.3 + Math.sin(ph + 2.1) * s * 0.12 + b);
  c.moveTo(x - s * 0.08, y - s * 0.18 + b); c.lineTo(x - s * 0.2, y + Math.cos(ph) * s * 0.1);
  c.moveTo(x + s * 0.08, y - s * 0.18 + b); c.lineTo(x + s * 0.2, y - Math.cos(ph) * s * 0.1);
  c.stroke();
  /* eye sockets */
  c.fillStyle = 'rgba(0,0,0,.65)';
  c.fillRect(x - s * 0.13, y - s * 0.97 + b, s * 0.09, s * 0.09);
  c.fillRect(x + s * 0.04, y - s * 0.97 + b, s * 0.09, s * 0.09);
}

var UNDEAD_WORLDS = [

/* --- necro-dance (chaotic): bone ballroom grooving at ~100 BPM ----------- */
{ id: 'necro-dance', align: 'chaotic',
  pal: ['#e8f6ce','#9fb87a','#4f5d3a','#171a10','#fffbe8','#6f8a52','#2a331d','#cdf0a8'],
  draw: function (c, w, h, t) {
    vgrad(c, h, [[0,'#101308'],[0.55,'#1c2412'],[1,'#090b05']]); c.fillRect(0, 0, w, h);
    var beatPh = (t / 0.6) * TAU;                  /* 100 BPM = 0.6s per beat */
    /* mirror-ball glitter */
    var mx = w * 0.5, my = h * 0.13;
    c.strokeStyle = 'rgba(205,240,168,.25)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(mx, 0); c.lineTo(mx, my - 26); c.stroke();
    c.fillStyle = 'rgba(232,246,206,.75)';
    c.beginPath(); c.arc(mx, my, 22, 0, TAU); c.fill();
    for (var g = 0; g < 8; g++) {
      var ga = beatPh * 0.5 + g * 0.785;
      c.fillStyle = 'rgba(255,251,232,' + (0.10 + 0.10 * Math.sin(beatPh + g)).toFixed(3) + ')';
      c.fillRect(mx + Math.cos(ga) * 150 - 2, my + Math.sin(ga) * 90 - 2, 4, 4);
    }
    /* checker floor, pulsing faintly with the beat */
    var hy = h * 0.66, sq = Math.max(26, w / 18);
    for (var row = 0; row * sq * 0.5 < h - hy; row++) {
      for (var col = 0; col * sq < w + sq; col++) {
        var dark = (row + col) % 2 === 0;
        c.fillStyle = dark ? 'rgba(28,36,18,' + (0.85 + 0.08 * Math.sin(beatPh)).toFixed(3) + ')'
                           : 'rgba(79,93,58,.55)';
        var y0 = hy + row * sq * 0.5, shrink = row * sq * 0.06;
        c.fillRect(col * sq - shrink, y0, sq, sq * 0.5 + 2);
      }
    }
    /* the dancing skeletons: three sizes, staggered beat phases */
    skel(c, w * 0.22, hy + h * 0.06, h * 0.16, beatPh, 'rgba(232,246,206,.92)');
    skel(c, w * 0.50, hy + h * 0.02, h * 0.20, beatPh + 0.9, 'rgba(255,251,232,.95)');
    skel(c, w * 0.78, hy + h * 0.07, h * 0.15, beatPh + 2.1, 'rgba(159,184,122,.9)');
    /* spot beams sweeping on the half-beat */
    for (var b2 = 0; b2 < 2; b2++) {
      var ba = Math.sin(t * 1.05 + b2 * 2.6) * 0.5;
      var bx0 = w * (b2 ? 0.82 : 0.18);
      c.fillStyle = 'rgba(205,240,168,.05)';
      c.beginPath(); c.moveTo(bx0, 0);
      c.lineTo(bx0 + Math.sin(ba - 0.06) * h, h); c.lineTo(bx0 + Math.sin(ba + 0.06) * h, h);
      c.closePath(); c.fill();
    }
  }},

/* --- witch-hut (bad): crooked cottage, bubbling cauldron, swaying herbs -- */
{ id: 'witch-hut', align: 'bad',
  pal: ['#b9f07c','#5f8f3e','#33491f','#141007','#e6ffb0','#86b05a','#20290f','#f4ffd8'],
  draw: function (c, w, h, t) {
    vgrad(c, h, [[0,'#141007'],[0.6,'#22290f'],[1,'#0b0d04']]); c.fillRect(0, 0, w, h);
    /* crooked roof beam */
    c.strokeStyle = 'rgba(51,73,31,.95)'; c.lineWidth = Math.max(8, h * 0.02);
    c.beginPath(); c.moveTo(w * -0.02, h * 0.16); c.quadraticCurveTo(w * 0.5, h * 0.05, w * 1.02, h * 0.2); c.stroke();
    /* hanging herb bundles sway */
    for (var i = 0; i < 6; i++) {
      var hx = w * (0.1 + i * 0.16), sway = Math.sin(t * 0.9 + i * 1.4) * 8;
      c.strokeStyle = 'rgba(95,143,62,.8)'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(hx, h * 0.12); c.lineTo(hx + sway, h * 0.3); c.stroke();
      c.fillStyle = 'rgba(133,176,90,' + (0.5 + 0.2 * Math.sin(t + i)).toFixed(3) + ')';
      c.beginPath(); c.ellipse(hx + sway, h * 0.32, 7, 14, sway * 0.02, 0, TAU); c.fill();
    }
    /* cauldron: green glow breathing, bubbles rise on the beat-ish period */
    var cx = w * 0.5, cy = h * 0.86, glow = 0.30 + 0.10 * Math.sin(t * 1.7);
    var gr = c.createRadialGradient(cx, cy - 20, 8, cx, cy - 20, h * 0.34);
    gr.addColorStop(0, 'rgba(185,240,124,' + glow.toFixed(3) + ')');
    gr.addColorStop(1, 'rgba(185,240,124,0)');
    c.fillStyle = gr; c.fillRect(cx - w * 0.35, cy - h * 0.4, w * 0.7, h * 0.45);
    c.fillStyle = '#191c0c';
    c.beginPath(); c.ellipse(cx, cy, w * 0.17, h * 0.075, 0, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(230,255,176,.5)'; c.lineWidth = 3; c.stroke();
    c.fillStyle = 'rgba(185,240,124,.85)';
    c.beginPath(); c.ellipse(cx, cy - h * 0.01, w * 0.145, h * 0.045, 0, 0, TAU); c.fill();
    for (var b = 0; b < 5; b++) {
      var bp = ((t * 0.45 + b * 0.2) % 1);
      c.fillStyle = 'rgba(228,255,176,' + (0.7 * (1 - bp)).toFixed(3) + ')';
      c.beginPath();
      c.arc(cx + Math.sin(b * 2.4) * w * 0.09, cy - h * 0.03 - bp * h * 0.16, 2.5 + bp * 4, 0, TAU);
      c.fill();
    }
    /* shelf of mystery bottles, left wall */
    c.fillStyle = 'rgba(32,41,15,.9)'; c.fillRect(w * 0.03, h * 0.48, w * 0.16, 6);
    for (i = 0; i < 4; i++) {
      c.fillStyle = 'rgba(134,176,90,' + (0.35 + 0.25 * ((i * 7) % 3) / 2).toFixed(3) + ')';
      c.fillRect(w * (0.045 + i * 0.036), h * 0.40 + (i % 2) * 6, 9, 20);
    }
  }},

/* --- wizard-duel (neutral): twin towers, duelling arcs ------------------- */
{ id: 'wizard-duel', align: 'neutral',
  pal: ['#cdb4ff','#7a5fd0','#3a2a6e','#120b28','#efe6ff','#54409c','#241747','#ffffff'],
  draw: function (c, w, h, t) {
    vgrad(c, h, [[0,'#120b28'],[0.6,'#241747'],[1,'#0a0618']]); c.fillRect(0, 0, w, h);
    /* moon behind the duel */
    c.fillStyle = 'rgba(239,230,255,.14)'; c.beginPath(); c.arc(w * 0.5, h * 0.2, 70, 0, TAU); c.fill();
    /* twin towers */
    function tower(x, tw) {
      c.fillStyle = 'rgba(42,32,84,.95)';
      c.fillRect(x - tw / 2, h * 0.34, tw, h * 0.66);
      c.beginPath();                                              /* cone roof */
      c.moveTo(x - tw * 0.72, h * 0.36); c.lineTo(x + tw * 0.72, h * 0.36); c.lineTo(x, h * 0.16);
      c.closePath(); c.fill();
      for (var wy = h * 0.42; wy < h * 0.9; wy += h * 0.12) {     /* lit windows */
        c.fillStyle = 'rgba(205,180,255,' + (0.25 + 0.2 * Math.sin(t * 1.3 + wy)).toFixed(3) + ')';
        c.fillRect(x - tw * 0.18, wy, tw * 0.14, h * 0.05);
        c.fillRect(x + tw * 0.06, wy, tw * 0.14, h * 0.05);
      }
    }
    tower(w * 0.16, w * 0.11); tower(w * 0.84, w * 0.11);
    /* duellists on the battlements, staff tips crackling toward each other */
    var lx = w * 0.16, rx = w * 0.84, sy = h * 0.33;
    c.strokeStyle = 'rgba(205,180,255,.9)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(lx - 8, sy + 26); c.lineTo(lx + 14, sy - 14); c.stroke();
    c.beginPath(); c.moveTo(rx + 8, sy + 26); c.lineTo(rx - 14, sy - 14); c.stroke();
    var jitterX = Math.sin(t * 21) * 3, jitterY = Math.cos(t * 17) * 3;
    c.strokeStyle = 'rgba(255,255,255,' + (0.35 + 0.3 * Math.sin(t * 9)).toFixed(3) + ')';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(lx + 14, sy - 14);
    c.lineTo((lx + rx) / 2 + jitterX, sy - 40 + jitterY);
    c.lineTo(rx - 14, sy - 14);
    c.stroke();
    /* drifting sigil rings */
    for (var s = 0; s < 3; s++) {
      c.strokeStyle = 'rgba(122,95,208,' + (0.16 + 0.08 * Math.sin(t * 0.8 + s * 2)).toFixed(3) + ')';
      c.lineWidth = 1.5;
      c.beginPath(); c.arc(w * (0.3 + s * 0.2), h * (0.55 + 0.08 * Math.sin(t * 0.5 + s)), 26 + s * 10, t * (s % 2 ? -0.6 : 0.6), t * (s % 2 ? -0.6 : 0.6) + TAU * 0.7); c.stroke();
    }
  }},

/* --- acid-storm (bad): green sky, acid sheets, pooled reflections -------- */
{ id: 'acid-storm', align: 'bad',
  pal: ['#b2ff60','#5f8f1e','#2e4a12','#0a0d04','#e4ffb0','#86b52e','#161c06','#f0ffc8'],
  draw: function (c, w, h, t) {
    vgrad(c, h, [[0,'#161c06'],[0.5,'#24300c'],[1,'#0a0d04']]); c.fillRect(0, 0, w, h);
    /* churning cloud bank */
    for (var cl = 0; cl < 5; cl++) {
      c.fillStyle = 'rgba(46,74,18,' + (0.30 - cl * 0.04).toFixed(3) + ')';
      c.beginPath();
      c.ellipse(((t * (10 + cl * 6) + cl * w * 0.37) % (w + 420)) - 210, h * (0.10 + cl * 0.05), 190, 40, 0, 0, TAU);
      c.fill();
    }
    /* acid rain sheets */
    for (var d = 0; d < 34; d++) {
      var dx = (d * 149) % w, dy = (t * (340 + (d % 4) * 90) + d * 61) % (h + 60) - 30;
      c.fillStyle = 'rgba(178,255,96,' + (0.16 + 0.10 * (d % 3) / 2).toFixed(3) + ')';
      c.fillRect(dx, dy, 2, 14 + (d % 3) * 8);
    }
    /* ground pool catching the glow, ripples where drops land */
    var gy = h * 0.82;
    c.fillStyle = 'rgba(95,143,30,.35)'; c.fillRect(0, gy, w, h - gy);
    var gg = c.createLinearGradient(0, gy, 0, h);
    gg.addColorStop(0, 'rgba(178,255,96,.20)'); gg.addColorStop(1, 'rgba(178,255,96,0)');
    c.fillStyle = gg; c.fillRect(0, gy, w, h - gy);
    for (var rp = 0; rp < 6; rp++) {
      var phv = ((t * 0.8 + rp * 0.17) % 1);
      c.strokeStyle = 'rgba(228,255,176,' + (0.35 * (1 - phv)).toFixed(3) + ')';
      c.lineWidth = 1;
      c.beginPath();
      c.ellipse(w * (0.12 + rp * 0.15), gy + (h - gy) * (0.2 + (rp % 3) * 0.25), 4 + phv * 26, (4 + phv * 26) * 0.3, 0, 0, TAU);
      c.stroke();
    }
  }}
];

function registerWorlds() {
  var W = IQ.Worlds;
  if (!W || typeof W.register !== 'function') return;
  for (var i = 0; i < UNDEAD_WORLDS.length; i++) {
    try { W.register(UNDEAD_WORLDS[i]); } catch (e) { /* duplicate id: keep first */ }
  }
}

/* ==========================================================================
 * PACK 1 — DANCING SKELETONS (world: necro-dance)
 * =========================================================================*/

var BEAT_MS = 600;                                   /* 100 BPM exactly */

IQ.Hooks.add({
  id: 'necro-dance-beat',
  worlds: ['necro-dance'],
  weight: 1,
  handlers: {
    onRoundStart: function (ctx) {
      var r = rec('dance', ctx, null);
      /* beat phase + window length: THE deterministic part (ctx.rng only) */
      if (!r.seeded) {
        var rg = rngOf('dance', ctx, r);
        r.phase = rg() * BEAT_MS;
        r.win = 140 + rg() * 80;                     /* 140..220ms after each pulse */
        r.seeded = true;
        r.beats = 0;
        r.pulseSig = '';
      }
      r.t0 = nowMs();
      r.sig = '';                                    /* allow fresh pulses this round */
      if (!motionOK()) {
        /* motion off: NO pulsing marker — one static metronome banner instead */
        return vis(r, '', '\u266B METRONOME STEADY \u00B7 ANSWER ON THE BEAT', { flag: 'necro-static' });
      }
      return null;
    },
    onTick: function (ctx) {
      var r = rec('dance', ctx, null);
      if (!r.seeded || !motionOK()) return null;
      var pos = ((nowMs() - r.t0 - r.phase) % BEAT_MS + BEAT_MS) % BEAT_MS;
      var inWin = pos < r.win;
      if (inWin && !r.inWin) {                       /* rising edge: window opened */
        r.inWin = true;
        r.beats++;
        if (r.beats % 2) {                           /* pulse every 2nd beat (~0.83Hz) */
          var m = {
            /* tiny glyph, NOT fullscreen; 160ms << 200ms cap */
            overlayHTML: '<div class="ipn-pulse" style="position:absolute;left:0;right:0;' +
              'bottom:0;height:0;overflow:visible;pointer-events:none">\u266A</div>',
            overlayMs: 160,
            flag: 'on-beat-pulse'
          };
          r.pulseSig = 'p' + r.beats;
          return m;
        }
      } else if (!inWin) r.inWin = false;
      return null;
    },
    onPreAnswer: function (ctx) {
      var r = rec('dance', ctx, null);
      if (!r.seeded) return null;                    /* round never started */
      var pos = ((nowMs() - r.t0 - r.phase) % BEAT_MS + BEAT_MS) % BEAT_MS;
      if (pos < r.win) {
        return { scoreMul: 1.15, bannerText: '\u266A ON BEAT \u00D71.15', flag: 'necro-on-beat' };
      }
      return { scoreMul: 0.9, bannerText: 'OFF BEAT \u00D70.9', flag: 'necro-off-beat' };
    }
  }
});

/* ==========================================================================
 * PACK 2 — WITCHES' HUT (world: witch-hut) — one seeded hex per round
 * =========================================================================*/

IQ.Hooks.add({
  id: 'witch-hex',
  worlds: ['witch-hut'],
  weight: 1,
  handlers: {
    onRoundStart: function (ctx) {
      var r = rec('hex', ctx, {});
      var rg = rngOf('hex', ctx, r);
      var roll = rg();
      r.hex = roll < 0.34 ? 'keyswap' : (roll < 0.67 ? 'fog' : 'newt');
      r.swapDone = false; r.swapTries = 0;
      /* cackle stinger always announces the hut */
      var out = { sfx: 'cackle', flag: 'witch-hex:' + r.hex };
      if (r.hex === 'fog') {
        /* ONE seeded corner (two clean rolls); translucent blob, <=~20% coverage */
        var cxp = rg() < 0.5 ? 0 : 100, cyp = rg() < 0.5 ? 0 : 100;
        out.overlayHTML =
          '<div style="position:absolute;left:' + (cxp ? 62 : 0) + '%;top:' + (cyp ? 64 : 0) +
          '%;width:38%;height:36%;pointer-events:none;background:radial-gradient(ellipse at ' +
          cxp + '% ' + cyp + '%,rgba(214,236,204,.5),rgba(214,236,204,.16) 55%,transparent 78%)"></div>';
        out.overlayMs = 30000;
        out.bannerText = '\u{1F383} HEX OF BLINDING FOG';
      } else if (r.hex === 'newt') {
        out.pickup = { kind: 'health', value: 5 };   /* engine heals clamp(v,1,40) */
        out.bannerText = '\u{1F383} EYE OF NEWT DROPS \u00B7 GRAB IT (+5 HP)';
      } else {
        out.bannerText = '\u{1F383} HEX OF THE LYING NUMBERS';
      }
      return out;
    },
    onTick: function (ctx) {
      var r = rec('hex', ctx, null);
      if (!r || r.hex !== 'keyswap' || r.swapDone) return null;
      /* apply the seeded label shuffle once the options exist on screen */
      if (typeof document === 'undefined') { r.swapDone = true; return null; }
      var keys = document.querySelectorAll('#opts-grid .opt-btn .opt-key');
      if (!keys || keys.length < 2) {
        if (++r.swapTries > 40) r.swapDone = true;   /* give up silently */
        return null;
      }
      r.swapDone = true;
      var n = keys.length, perm = [], i;
      for (i = 0; i < n; i++) perm.push(i);
      var rg = rngOf('hex', ctx, r);                 /* continues the round stream */
      for (i = n - 1; i > 0; i--) {                  /* seeded Fisher-Yates */
        var j = Math.floor(rg() * (i + 1));
        var tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
      }
      var identity = true;
      for (i = 0; i < n; i++) if (perm[i] !== i) { identity = false; break; }
      if (identity) { perm.reverse(); }              /* never a no-op */
      for (i = 0; i < n; i++) keys[i].textContent = String(perm[i] + 1);
      return { bannerText: 'THE NUMBERS LIE \u00B7 TRUST YOUR EYES', flag: 'keyswap-applied' };
    }
  }
});

/* ==========================================================================
 * PACK 3 — WIZARD DUEL SPELLS (world: wizard-duel, interlude-capable)
 * =========================================================================*/

var DUEL_PREFIX = 'duel-spells:';
var duelLive = { el: null, esc: null, cap: 0 };

function closeDuelPanel(picked) {
  if (duelLive.cap) { clearTimeout(duelLive.cap); duelLive.cap = 0; }
  if (duelLive.esc) {
    try { document.removeEventListener('keydown', duelLive.esc); } catch (e) {}
    duelLive.esc = null;
  }
  if (duelLive.el && duelLive.el.parentNode) duelLive.el.parentNode.removeChild(duelLive.el);
  duelLive.el = null;
  return picked || null;
}

function openDuelPanel(ctx) {
  if (typeof document === 'undefined' || duelLive.el) return;
  ensureStyle();
  var streak = (ctx && typeof ctx.streak === 'number') ? ctx.streak
             : (typeof st(DUEL_PREFIX + 'streak') === 'number' ? st(DUEL_PREFIX + 'streak') : 0);
  var free = streak >= 3;

  var wrap = document.createElement('div');
  wrap.setAttribute('data-ipn-duel', '1');
  var css = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:72;' +
    'font-family:inherit;color:#efe6ff;background:linear-gradient(#1c1236,#241747);' +
    'border:1px solid #7a5fd0;border-radius:16px;padding:18px 22px;box-shadow:0 12px 48px rgba(0,0,0,.6)';
  wrap.style.cssText = css;
  wrap.innerHTML =
    '<div style="font-weight:900;letter-spacing:.24em;font-size:clamp(15px,2.4vw,22px)">\u2694 CHOOSE YOUR SPELL</div>' +
    '<div style="opacity:.7;font-size:12px;margin:4px 0 12px">one cast \u00B7 lands next round</div>' +
    '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center">' +
      '<button data-ipn-spell="shield">' +
        '<div style="font-size:26px">\u{1F6E1}</div>SHIELD<div style="font-size:11px;opacity:.75">forgive first wrong</div>' +
        '<div class="ipn-cost" style="font-size:11px;margin-top:4px;color:#ffe98a">' + (free ? 'FREE (streak \u22653)' : 'COSTS 15 SCORE') + '</div></button>' +
      '<button data-ipn-spell="haste">' +
        '<div style="font-size:26px">\u26A1</div>HASTE<div style="font-size:11px;opacity:.75">+6 seconds</div>' +
        '<div class="ipn-cost" style="font-size:11px;margin-top:4px;color:#ffe98a">' + (free ? 'FREE (streak \u22653)' : 'COSTS 15 SCORE') + '</div></button>' +
      '<button data-ipn-spell="scorch">' +
        '<div style="font-size:26px">\u{1F525}</div>SCORCH<div style="font-size:11px;opacity:.75">burn 2 false paths</div>' +
        '<div class="ipn-cost" style="font-size:11px;margin-top:4px;color:#ffe98a">' + (free ? 'FREE (streak \u22653)' : 'COSTS 15 SCORE') + '</div></button>' +
    '</div>' +
    '<div style="opacity:.6;font-size:11px;margin-top:12px">\u2716 or Esc to skip \u00B7 auto-skips in 9s</div>';
  /* button base style */
  var btnCss = 'min-width:118px;padding:10px 12px;border-radius:12px;border:1px solid #54409c;' +
    'background:#170f30;color:#efe6ff;font-family:inherit;font-weight:800;letter-spacing:.08em;' +
    'cursor:pointer;line-height:1.35';
  var btns = wrap.querySelectorAll('[data-ipn-spell]');
  for (var i = 0; i < btns.length; i++) btns[i].style.cssText = btnCss;
  var x = document.createElement('button');
  x.textContent = '\u2715';
  x.setAttribute('aria-label', 'Skip spell');
  x.style.cssText = 'position:absolute;top:8px;right:10px;width:30px;height:30px;border-radius:50%;' +
    'border:1px solid #888;background:#120b28;color:#ddd;font-size:14px;cursor:pointer;line-height:1';
  wrap.appendChild(x);

  function choose(kind) {
    st(DUEL_PREFIX + 'pending', { spell: kind, paid: free ? 0 : 15 });
    closeDuelPanel(true);
  }

  duelLive.el = wrap;
  document.body.appendChild(wrap);

  for (i = 0; i < btns.length; i++) {
    (function (b) {
      b.addEventListener('click', function () { choose(b.getAttribute('data-ipn-spell')); });
    })(btns[i]);
  }
  x.addEventListener('click', function () { closeDuelPanel(false); });
  duelLive.esc = function (ev) {
    if (ev && ev.key === 'Escape') { ev.stopPropagation(); closeDuelPanel(false); }
  };
  document.addEventListener('keydown', duelLive.esc);
  duelLive.cap = setTimeout(function () { closeDuelPanel(false); }, 9000); /* hard cap */
}

IQ.Hooks.add({
  id: 'duel-spells',
  worlds: ['wizard-duel'],
  weight: 1,
  handlers: {
    onInterlude: function (ctx) {
      openDuelPanel(ctx);
      return null;                                   /* panel is self-owned DOM */
    },
    onRoundStart: function (ctx) {
      var pend = st(DUEL_PREFIX + 'pending');
      st(DUEL_PREFIX + 'pending', null);
      st(DUEL_PREFIX + 'armed', false);
      if (!pend || !pend.spell) return null;
      var m = {};
      if (pend.spell === 'haste') {
        m.timerDelta = 6;
        m.bannerText = '\u26A1 HASTE \u00B7 +6 SECONDS';
      } else if (pend.spell === 'scorch') {
        m.disableWrongRandom = 2;                    /* ENGINE burns 2 WRONG options */
        m.bannerText = '\u{1F525} SCORCH \u00B7 TWO FALSE PATHS BURN AWAY';
      } else {
        st(DUEL_PREFIX + 'armed', true);
        m.bannerText = '\u{1F6E1} SHIELD UP \u00B7 FIRST WRONG WILL BE FORGIVEN';
      }
      if (pend.paid > 0) m.scoreDelta = -pend.paid;  /* host-authoritative flat cost */
      m.flag = 'duel-cast:' + pend.spell;
      return m;
    },
    onAnswer: function (ctx) {
      /* remember streak for the FREE check even when the engine's interlude
       * ctx is sparse (contract field, defensively defaulted) */
      if (ctx && typeof ctx.streak === 'number') st(DUEL_PREFIX + 'streak', ctx.streak);
      var r = rec('duel', ctx, null);
      if (!r || !st(DUEL_PREFIX + 'armed')) return null;
      if (ctx.res && !ctx.res.correct) {
        st(DUEL_PREFIX + 'armed', false);            /* shields exactly ONE wrong */
        return {
          hpDelta: 15,                               /* cancels the standard hurtHp(15) */
          bannerText: '\u{1F6E1} SHIELD ABSORBED THE BLOW',
          sfx: 'chime',
          flag: 'duel-shield-forgave'
        };
      }
      return null;
    },
    onReveal: function () {
      /* round over: an unused shield does not carry past its round */
      st(DUEL_PREFIX + 'armed', false);
      return null;
    }
  }
});

/* ==========================================================================
 * PACK 4 — ACID RAIN (world: acid-storm) — speed pressure, capped exposure
 * =========================================================================*/

var TICK_EVERY = 4;                                  /* seconds between bites */
var ROUND_CAP = 4;                                   /* max -4 hp per round */
var RUN_CAP = 4;                                     /* and max -4 hp per run */

IQ.Hooks.add({
  id: 'acid-storm-rain',
  worlds: ['acid-storm'],
  weight: 1,
  handlers: {
    onRoundStart: function (ctx) {
      var r = rec('storm', ctx, {});
      r.clock = 0; r.last = nowMs(); r.ticks = 0; r.safe = false; r.done = false;
      r.timerLen = (ctx && typeof ctx.timerLen === 'number' && ctx.timerLen > 0) ? ctx.timerLen : 60;
      var motion = motionOK(), i, cols = '';
      if (motion) {
        for (i = 0; i < 16; i++) {
          cols += '<i class="ipn-rain-i" style="left:' + ((i * 6.4 + 2).toFixed(1)) +
            '%;height:' + (46 + (i % 4) * 18) + 'px;animation:ipnRainFall ' +
            (0.9 + (i % 3) * 0.25).toFixed(2) + 's linear ' + ((i % 5) * 0.18).toFixed(2) +
            's infinite"></i>';
        }
      }
      var html =
        '<div style="position:absolute;inset:0;overflow:hidden;pointer-events:none;' +
        'background:repeating-linear-gradient(90deg,rgba(178,255,96,.05) 0 2px,transparent 2px 64px)">' +
        cols + '</div>';
      return vis(r, html, '\u2614 ACID RAIN \u00B7 ANSWER FAST OR IT BITES', {
        overlayMs: 30000,
        flag: 'acid-rain-round'
      });
    },
    onTick: function (ctx) {
      var r = rec('storm', ctx, null);
      if (!r || r.safe || r.done) return null;
      var t = nowMs();
      r.clock += Math.min((t - r.last) / 1000, 0.25); /* clamp tab-switch jumps */
      r.last = t;
      if (r.clock < (r.ticks + 1) * TICK_EVERY) return null;
      if (r.ticks >= ROUND_CAP) { r.done = true; return null; }
      var runDmg = (typeof st('acid-storm:runDmg') === 'number') ? st('acid-storm:runDmg') : 0;
      if (runDmg >= RUN_CAP) { r.done = true; return null; }   /* run-wide cap reached */
      r.ticks++;
      st('acid-storm:runDmg', runDmg + 1);
      return {
        hpDelta: -1,
        bannerText: '\u2614 ACID BITE \u22121 HP (' + r.ticks + '/' + ROUND_CAP + ')',
        sfx: 'zap',
        flag: 'acid-rain-tick'
      };
    },
    onAnswer: function (ctx) {
      var r = rec('storm', ctx, null);
      if (!r || r.safe) return null;
      var len = timerLenOf(ctx, r);
      var fast = ctx.res && ctx.res.correct && (r.clock < 0.6 * len);
      if (fast) {
        r.safe = true;
        return {
          bannerText: '\u2614 YOU OUTRAN THE RAIN \u00B7 IT RELENTS',
          flag: 'acid-rain-relented'
        };
      }
      return null;
    }
  }
});

registerWorlds();

/* Node smoke-run escape hatch: exercises the pure paths without a DOM. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { UNDEAD_WORLDS: UNDEAD_WORLDS, PACK_IDS: ['necro-dance-beat', 'witch-hex', 'duel-spells', 'acid-storm-rain'] };
}
})();
