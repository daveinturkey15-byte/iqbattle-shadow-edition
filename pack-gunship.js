/* ============================================================================
 * pack-gunship.js — PackGunship wave: Dave's "Pavelos" gunship parody pack
 * + the warzone-pavelow backdrop world. Vanilla JS/CSS/Canvas/WebAudio only.
 * ============================================================================
 *
 * SPEC -> MECHANIC MAP (Dave's order line -> where it lives below)
 *   "circling AC-130-style gunship that strafes OPTIONS"
 *        -> pack 'pavelow-gunship' drives a per-round phase machine
 *           (spot -> barrage/smoke -> ...); the warzone-pavelow world draw()
 *           shows the silhouette orbiting the viewport edge.
 *   "Round starts with SPOTTING phase: reticle sweeps options 3s (telegraph)"
 *        -> phase 'spot': 3s, no input touched; animated reticle strip
 *           telegraphs the columns (static text when IQB_MOTION is off).
 *   "then BARRAGE: targeted option column disabled 3s (disableOptionIdx)"
 *        -> phase 'strike': disableOptionIdx:[idx] returned every tick of the
 *           3s window (re-asserted so engines that clear per-tick stay
 *           correct). CURRENT engine greys a struck slot out for the rest of
 *           the round once hit (documented drift) — therefore strikes are
 *           unique-per-round and capped to leave >=2 selectable options
 *           (fairness rail: never ALL options).
 *   "repeat cadence slows with player hp (mercy)"
 *        -> intervalFor(hp): 4.6s at 100hp easing to 8.0s at 0hp between
 *           repeat windows, recomputed live from ctx.hp.
 *   "SMOKE rounds: every 3rd barrage replaced by smoke window"
 *        -> event slot n where n%3===0 becomes phase 'smoke' (2s safe window,
 *           no strike, banner "SAFE WINDOW").
 *   "Counterplay scoring: answering during an active barrage = scoreMul 1.25"
 *        -> onPreAnswer while phase==='strike' (and pos>=0) returns
 *           { scoreMul:1.25 }. Request only — scoring stays host-owned.
 *   "Audio: distant rotors loop (WebAudio noise+LFO, IQB_MUTED gated),
 *    explosion thump <=150ms"
 *        -> AU.rotorStart/rotorStop (looped noise -> bandpass, 12.4Hz
 *           blade-chop LFO + slow doppler swell LFO) started on roundStart,
 *           stopped on interlude, polled against IQB_MUTED; AU.thump() is a
 *           150ms lowpass-swept noise burst + sub drop, hard-capped 150ms.
 *   "Visuals: gunship silhouette orbiting viewport edge; tracers cosmetic"
 *        -> warzone-pavelow world: dark AC-130-parody silhouette on a
 *           superellipse orbit hugging the viewport edge; tracers are
 *           alpha-fading thin strokes; muzzle/nav blips are tiny local
 *           flicks (~1.4Hz, far under flash caps), never fullscreen.
 *   MERCY / ACCEPTANCE "barrage never targets the correct option twice in a
 *   row (seeded mercy)":
 *        -> A pack must not read correctIdx pre-reveal (fairness rail), so the
 *           guarantee is enforced with three seeded, deterministic rails:
 *             (1) within a round every strike hits a UNIQUE slot (struck set)
 *                 and never the immediately previous slot;
 *             (2) when a round's reveal shows a strike DID sit on the correct
 *                 slot, that slot is remembered via Hooks.state and EXCLUDED
 *                 from all targeting next round;
 *             (3) such a round also OPENS with a forced SMOKE window.
 *           Net effect: the same correct option can never be strafed twice in
 *           a row, deterministically from the match seed.
 *   ACCEPTANCE "worst case cannot kill from full hp":
 *        -> the pack NEVER returns hpDelta. Pressure is option denial + tempo
 *           only. Asserted by the smoke harness (.smoke-pack-gunship.js).
 *
 * INTEGRATION NOTES (engine drift, read before touching):
 *   - The CURRENT index.html dispatches onTick WITHOUT ctx.world, which would
 *     starve any worlds-bound pack of ticks. This pack therefore registers
 *     always:true and self-gates: the round record is created ONLY by
 *     onRoundStart when ctx.world === 'warzone-pavelow' (roundStart DOES
 *     carry world today), and every other handler no-ops without a live
 *     record. Works identically if GameFlow later adds world to tick ctx.
 *   - ctx.optCount/timerLen/runId/seed are contract-promised but not sent by
 *     today's engine: defaults (8 / 60) apply; records key off round number;
 *     cross-run memory rides Hooks.state, wiped by beginRun.
 *   - ctx.rng may be null on defensive paths: a local hash-seeded PRNG
 *     (round/slot counters only — never wall clock, never Math.random) keeps
 *     targeting deterministic either way.
 *   - Overlays: pointer-events:none, no focus traps, thin top strip (<30%
 *     coverage), emitted ONCE per phase change with overlayMs so the engine's
 *     append-per-emission behavior never stacks nodes. All animation is
 *     inline-CSS and omitted when IQB_MOTION is off.
 *
 * Smoke harness: .smoke-pack-gunship.js (node, against real hooks.js).
 * ============================================================================*/
(function () {
'use strict';
var root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};

var WID = 'warzone-pavelow';
var PACK = 'pavelow-gunship';
var KEY_LAST_HIT = PACK + ':lastCorrectHit';

/* ---- prefs (mirror worlds.js / music-pack.js conventions) ---------------- */
function motionOn() {
  try {
    var v = root.localStorage && root.localStorage.getItem('IQB_MOTION');
    return v == null ? true : JSON.parse(v) !== false;
  } catch (e) { return true; }
}
function mutedPref() {
  try {
    var v = root.localStorage && root.localStorage.getItem('IQB_MUTED');
    return v != null && JSON.parse(v) === true;
  } catch (e) { return false; }
}

/* ---- deterministic fallback PRNG (mulberry32, hash-seeded) --------------- */
function hashRng(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- tuning --------------------------------------------------------------- */
var SPOT_S = 3.0;      /* spotting telegraph */
var STRIKE_S = 3.0;    /* barrage disable window (spec) */
var SMOKE_S = 2.0;     /* safe window */
function intervalFor(hp) {           /* mercy: cadence slows as hp falls */
  var p = Math.max(0, Math.min(100, hp == null ? 100 : hp));
  return 4.6 + (100 - p) / 100 * 3.4;
}

/* ---- per-round runtime records ------------------------------------------- */
var rt = Object.create(null);        /* 'r<round>' -> record */

function rec(round) { return rt['r' + round] || null; }

function makeRecord(ctx) {
  var key = 'r' + (ctx.round || 1);
  for (var k in rt) if (k !== key) delete rt[k];   /* prune own stale rounds */
  var avoid = root.IQ.Hooks.state.get(KEY_LAST_HIT);
  avoid = (typeof avoid === 'number' && avoid >= 0) ? avoid : -1;
  rt[key] = {
    clock: 0,
    lastT: -1,                /* local-delta fallback stamp */
    phase: 'spot',            /* spot | idle | strike | smoke */
    n: 0,                     /* event slots consumed */
    wait: 0,
    target: -1,
    lastStrike: -1,
    struck: [],               /* unique-per-round strike slots */
    avoid: avoid,             /* cross-round mercy exclusion slot */
    mercyOpen: avoid >= 0,    /* forced opener smoke after a correct-column hit */
    sig: null                 /* emitted overlay/banner signature */
  };
  return rt[key];
}

/* Emit overlay/banner only when the visible state actually changes. */
function vis(r, overlayHTML, overlayMs, bannerText) {
  var sig = (overlayHTML || '') + '\u0000' + (overlayMs || 0) + '\u0000' + (bannerText || '');
  if (sig === r.sig) return null;      /* caller skips null returns */
  r.sig = sig;
  var m = {};
  if (overlayHTML) { m.overlayHTML = overlayHTML; m.overlayMs = overlayMs; }
  if (bannerText) m.bannerText = bannerText;
  return m;
}

/* ---- overlay chrome (pointer-events:none, motion-gated) -------------------- */
var OV = 'position:absolute;top:8px;left:50%;transform:translateX(-50%);' +
  'font:700 11px monospace;letter-spacing:.1em;padding:4px 12px;' +
  'border-radius:4px;pointer-events:none;z-index:2147483000;max-width:92vw;';

function chipSpot() {
  var base = OV + 'color:#ffd23e;background:rgba(16,14,10,.82);border:1px solid #b3541e;';
  if (!motionOn()) {
    return '<div style="' + base + '" aria-hidden="true">PAVELOW SPOTTING \u2014 RETICLE SWEEPING\u2026</div>';
  }
  /* Self-animating reticle strip: ONE DOM node sweeping 8 slots over 3s. */
  var css = '@keyframes pgSweep{from{left:2%}to{left:94%}}';
  var cells = '';
  for (var i = 0; i < 8; i++) cells += '<span style="opacity:.55;margin:0 7px">' + (i + 1) + '</span>';
  return '<style>' + css + '</style>' +
    '<div style="' + base + '" aria-hidden="true">' +
    '<span style="position:relative;display:inline-block;min-width:280px;text-align:center">' +
    cells +
    '<span style="position:absolute;top:-4px;color:#ff5d40;font-size:13px;' +
    'animation:pgSweep 3s linear 1 forwards">\u25C8</span>' +
    '</span><br>PAVELOW SPOTTING \u2014 BRACE</div>';
}

function chipStrike(idx) {
  return '<div style="' + OV + 'color:#ff5d40;background:rgba(20,6,4,.85);' +
    'border:1px solid #ff5d40;" aria-hidden="true">\u25CF BARRAGE \u00B7 OPTION ' +
    (idx + 1) + ' OFFLINE</div>';
}

function chipSmoke() {
  return '<div style="' + OV + 'color:#8d99ae;background:rgba(10,14,12,.82);' +
    'border:1px solid #4a5a52;" aria-hidden="true">\u2601 SMOKE ROUNDS \u2014 SAFE WINDOW</div>';
}

/* ---- audio (cosmetic; IQB_MUTED-gated WebAudio synthesis) ------------------ */
var AU = {
  ctx: null, master: null, rotor: null,

  ready: function () {
    if (this.ctx) return true;
    try {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (typeof AC !== 'function') return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.ctx = null; return false; }
    return true;
  },
  resume: function () {
    try { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); } catch (e) {}
  },

  rotorStart: function () {
    if (mutedPref() || !this.ready()) return;
    this.resume();
    if (this.rotor) return;
    try {
      var c = this.ctx, t = c.currentTime;
      /* looped noise bed */
      var len = Math.floor(c.sampleRate * 2);
      var buf = c.createBuffer(1, len, c.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      var src = c.createBufferSource();
      src.buffer = buf; src.loop = true;
      var bp = c.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = 240; bp.Q.value = 0.7;
      var chop = c.createGain(); chop.gain.value = 0.6;
      /* blade-chop LFO (~12.4Hz) */
      var lfo = c.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 12.4;
      var lfoG = c.createGain(); lfoG.gain.value = 0.32;
      lfo.connect(lfoG); lfoG.connect(chop.gain);
      /* slow doppler swell */
      var swl = c.createOscillator(); swl.type = 'sine'; swl.frequency.value = 0.11;
      var swlG = c.createGain(); swlG.gain.value = 0.16;
      swl.connect(swlG); swlG.connect(chop.gain);
      /* distant: quiet lowpassed bus */
      var out = c.createGain(); out.gain.value = 0.05;
      var dist = c.createBiquadFilter(); dist.type = 'lowpass'; dist.frequency.value = 900;
      src.connect(bp); bp.connect(chop); chop.connect(dist); dist.connect(out);
      out.connect(this.master);
      src.start(t); lfo.start(t); swl.start(t);
      this.rotor = { nodes: [src, lfo, swl], out: out };
    } catch (e) { this.rotor = null; }
  },

  rotorStop: function () {
    var r = this.rotor; this.rotor = null;
    if (!r || !this.ctx) return;
    try {
      r.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
      setTimeout(function () {
        try { r.nodes.forEach(function (n) { try { n.stop(); } catch (e2) {} }); } catch (e) {}
        try { r.out.disconnect(); } catch (e) {}
      }, 500);
    } catch (e) { this.rotor = null; }
  },

  rotorPoll: function () { if (this.rotor && mutedPref()) this.rotorStop(); },

  /* Explosion thump: noise burst through falling lowpass + sub sine. <=150ms. */
  thump: function () {
    if (mutedPref() || !this.ready()) return;
    this.resume();
    try {
      var c = this.ctx, t = c.currentTime, DUR = 0.15;
      var len = Math.floor(c.sampleRate * DUR);
      var buf = c.createBuffer(1, len, c.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      var src = c.createBufferSource(); src.buffer = buf;
      var lp = c.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(190, t);
      lp.frequency.exponentialRampToValueAtTime(42, t + DUR - 0.01);
      var g = c.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + DUR);
      src.connect(lp); lp.connect(g); g.connect(this.master);
      src.start(t); src.stop(t + DUR);
      var o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(64, t);
      o.frequency.exponentialRampToValueAtTime(30, t + DUR);
      var og = c.createGain();
      og.gain.setValueAtTime(0.22, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + DUR);
      o.connect(og); og.connect(this.master);
      o.start(t); o.stop(t + DUR);
    } catch (e) {}
  }
};

/* ---- targeting ------------------------------------------------------------ */
function pickTarget(ctx, r, slotSalt) {
  var n = ctx.optCount || 8;
  var banned = {};
  var i;
  for (i = 0; i < r.struck.length; i++) banned[r.struck[i]] = 1;  /* unique/round */
  if (r.lastStrike >= 0) banned[r.lastStrike] = 1;                /* never twice in a row */
  if (r.avoid >= 0) banned[r.avoid] = 1;                          /* cross-round mercy */
  var cand = [];
  for (i = 0; i < n; i++) if (!banned[i]) cand.push(i);
  if (!cand.length) return null;                                  /* -> smoke */
  var rng = (typeof ctx.rng === 'function') ? ctx.rng
    : hashRng(((ctx.round || 1) * 2654435761) ^ ((slotSalt || 1) * 40503) ^ 0x5EEDCA7);
  return cand[Math.floor(rng() * cand.length) % cand.length];
}

/* ---- phase transitions ----------------------------------------------------- */
function beginEvent(ctx, r) {
  r.n++; r.clock = 0;
  var n = ctx.optCount || 8;
  var capped = r.struck.length >= n - 2;          /* fairness: leave >=2 selectable */
  var smoke = capped || (r.n % 3 === 0);          /* every 3rd barrage -> smoke */
  if (r.mercyOpen) { smoke = true; r.mercyOpen = false; }  /* post-hit opener */
  if (!smoke) {
    var tgt = pickTarget(ctx, r, r.n);
    if (tgt == null) smoke = true;
    else {
      r.phase = 'strike'; r.target = tgt;
      r.struck.push(tgt); r.lastStrike = tgt;
      AU.thump();
      /* Seed the vis signature here so the per-tick re-assert does not emit
       * a duplicate overlay node on the window's second frame. */
      var m = { disableOptionIdx: [tgt] };
      var v = vis(r, chipStrike(tgt), STRIKE_S * 1000,
        'PAVELOW BARRAGE \u2014 OPTION ' + (tgt + 1) + ' UNDER FIRE (1.25x)');
      for (var k in v) m[k] = v[k];
      return m;
    }
  }
  r.phase = 'smoke'; r.target = -1;
  var s = {};
  var v2 = vis(r, chipSmoke(), SMOKE_S * 1000,
    'SMOKE ROUNDS \u2014 SAFE WINDOW, ANSWER NOW');
  for (var k2 in v2) s[k2] = v2[k2];
  return s;
}

function endWindow(ctx, r) {
  r.phase = 'idle'; r.clock = 0; r.sig = null; r.target = -1;
  r.wait = intervalFor(ctx.hp);
}

/* Seeded mercy bookkeeping: did a strike this round sit on the correct slot? */
function noteReveal(round, correctIdx) {
  var ci = (typeof correctIdx === 'number') ? correctIdx : -1;
  if (ci < 0) return;                            /* impossible/timeout rounds */
  var r = rec(round);
  var st = root.IQ.Hooks.state;
  if (st && st.set) {
    if (r && r.struck.indexOf(ci) >= 0) st.set(KEY_LAST_HIT, ci);
    else st.del(KEY_LAST_HIT);
  }
}

/* ---- the pack --------------------------------------------------------------- */
if (!(root.IQ.Hooks && typeof root.IQ.Hooks.add === 'function')) {
  console.warn('[pack-gunship] IQ.Hooks absent — pack inert.');
} else {
  root.IQ.Hooks.add({
    id: PACK,
    always: true,            /* see INTEGRATION NOTES: tick ctx carries no world;
                                self-gated on the roundStart world below */
    weight: 2,
    handlers: {
      onRoundStart: function (ctx) {
        if (ctx.world !== WID) return null;
        var r = makeRecord(ctx);
        AU.rotorPoll();
        AU.rotorStart();
        return vis(r, chipSpot(), SPOT_S * 1000, 'PAVELOW ON STATION \u2014 SPOTTING');
      },

      onTick: function (ctx) {
        var r = rec(ctx.round || 1);
        if (!r) return null;                    /* not our world this round */
        AU.rotorPoll();
        var dt = (typeof ctx.dtSec === 'number' && isFinite(ctx.dtSec))
          ? Math.max(0, Math.min(ctx.dtSec, 0.25))
          : 0;
        if (!dt) {                              /* local fallback clock */
          var now = (root.performance && performance.now) ? performance.now() : Date.now();
          if (r.lastT >= 0) dt = Math.min((now - r.lastT) / 1000, 0.25);
          r.lastT = now;
        }
        r.clock += dt;

        if (r.phase === 'spot') {
          if (r.clock < SPOT_S) return null;
          r.phase = 'idle'; r.clock = 0; r.sig = null;
          r.wait = 0;         /* barrage follows the telegraph directly; the
                                 mercy cadence applies between REPEAT windows */
          return null;
        }
        if (r.phase === 'idle') {
          if (r.clock < r.wait) return null;
          return beginEvent(ctx, r);
        }
        if (r.phase === 'strike') {
          var m = { disableOptionIdx: [r.target] };
          var extra = vis(r, chipStrike(r.target), STRIKE_S * 1000, null);
          if (extra) for (var k in extra) m[k] = extra[k];
          if (r.clock >= STRIKE_S) endWindow(ctx, r);
          return m;
        }
        if (r.phase === 'smoke') {
          if (r.clock < SMOKE_S) return null;
          endWindow(ctx, r);
          return null;
        }
        return null;
      },

      onPreAnswer: function (ctx) {
        var r = rec(ctx.round || 1);
        if (!r || r.phase !== 'strike') return null;
        if (!(ctx.pos >= 0)) return null;       /* ignore timeout answers */
        return { scoreMul: 1.25, flag: PACK + ':under-fire' };
      },

      onAnswer: function (ctx) {
        noteReveal(ctx.round || 1, ctx.res && ctx.res.correctIdx);
        return null;
      },

      onReveal: function (ctx) {
        /* MP clients learn the truth here (their onAnswer carries -99). */
        var ci = (ctx.res && ctx.res.correctIdx) != null ? ctx.res.correctIdx : ctx.correctIdx;
        noteReveal(ctx.round || 1, ci);
        return null;
      },

      onInterlude: function () {
        for (var k in rt) delete rt[k];
        AU.rotorStop();
        return null;
      }
    }
  });
}

/* ============================================================================
 * WORLD — warzone-pavelow ('bad'): night warzone under an orbiting gunship.
 * IQ.Worlds.register({id,align,pal[8],draw(c,w,h,t)}). Motion honors
 * IQB_MOTION (worlds.js freezes t when off; drift additionally scaled here).
 * Flashes: tiny muzzle/nav blips ~1.4Hz, never fullscreen. Tracers cosmetic.
 * ============================================================================*/
var Worlds = root.IQ.Worlds;
if (Worlds && typeof Worlds.register === 'function') {

  /* stable scatter hash */
  function h2(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  /* Side-firing gunship silhouette (AC-130 parody): fuselage, straight wing,
   * four prop blur discs, tail boom + fin, side howitzer. Dark vs the sky. */
  function drawPavelow(c, x, y, ang, sc, tt, m, firing) {
    c.save(); c.translate(x, y); c.rotate(ang); c.scale(sc, sc);
    c.fillStyle = '#0a0a12';
    /* fuselage */
    c.beginPath();
    c.moveTo(52, 0);
    c.quadraticCurveTo(40, -7, 6, -7);
    c.lineTo(-38, -6);
    c.quadraticCurveTo(-50, -5, -52, 0);
    c.quadraticCurveTo(-50, 5, -38, 6);
    c.lineTo(6, 7);
    c.quadraticCurveTo(40, 7, 52, 0);
    c.closePath(); c.fill();
    /* tail boom + fin */
    c.fillRect(-64, -2.4, 16, 4.8);
    c.beginPath();
    c.moveTo(-60, -2); c.lineTo(-70, -15); c.lineTo(-63, -15); c.lineTo(-53, -2);
    c.closePath(); c.fill();
    /* straight wing */
    c.fillRect(-18, -9, 30, 6);
    /* four nacelles + spinning prop discs */
    for (var e = 0; e < 4; e++) {
      var ey = (e < 2 ? -1 : 1) * 12;
      c.fillRect(-14, ey - 2.6, 15, 5.2);
      c.strokeStyle = 'rgba(141,153,174,' + (m ? 0.16 : 0.1) + ')';
      c.lineWidth = 1.6;
      c.beginPath();
      c.ellipse(4, ey, 3, (m ? 10 + 1.5 * Math.sin(tt * 40 + e) : 10), 0, 0, 7);
      c.stroke();
    }
    /* side cannon (the Pavelos howitzer) */
    c.fillRect(-6, 7, 5, 13);
    /* rim light so the silhouette reads against the dark sky */
    c.strokeStyle = 'rgba(255,179,71,.2)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(48, -3); c.quadraticCurveTo(20, -8, -38, -7); c.stroke();
    /* muzzle flick: tiny local blip, short duty — never fullscreen */
    if (firing && (((tt * 1.4) % 1) < 0.09)) {
      c.fillStyle = 'rgba(255,210,62,.9)';
      c.beginPath(); c.arc(-4, 22, 3.4, 0, 7); c.fill();
    }
    /* red nav strobe, >1s period, pixel-scale dot */
    if (m && ((tt % 1.4) < 0.07)) {
      c.fillStyle = 'rgba(255,60,60,.95)';
      c.fillRect(-66, -17, 2, 2);
    }
    c.restore();
  }

  Worlds.register({
    id: WID,
    align: 'bad',
    pal: ['#ffb347', '#ff7a1a', '#b3541e', '#10101c', '#241c2b', '#ff5d40', '#ffd23e', '#8d99ae'],
    draw: function (c, w, h, t) {
      var m = motionOn() ? 1 : 0, tt = t * m;
      /* --- night sky --- */
      var sky = c.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#05060f'); sky.addColorStop(0.62, '#171226');
      sky.addColorStop(0.78, '#3a2317'); sky.addColorStop(1, '#120d0a');
      c.fillStyle = sky; c.fillRect(0, 0, w, h);
      /* --- distant fires on the horizon --- */
      for (var f = 0; f < 3; f++) {
        var fx = w * (0.18 + 0.32 * f), fy = h * 0.74;
        var fr = (46 + 26 * h2(f + 4)) * (1 + 0.12 * Math.sin(tt * 0.7 + f * 2.1));
        var fg = c.createRadialGradient(fx, fy, 4, fx, fy, fr);
        fg.addColorStop(0, 'rgba(255,122,26,' + (0.22 - 0.05 * f) + ')');
        fg.addColorStop(1, 'rgba(255,93,64,0)');
        c.fillStyle = fg; c.beginPath(); c.arc(fx, fy, fr, 0, 7); c.fill();
      }
      /* --- searchlight beams sweeping slowly --- */
      for (var s = 0; s < 2; s++) {
        var bx = w * (0.3 + 0.45 * s);
        var ang = -1.35 + 0.5 * Math.sin(tt * 0.16 + s * 2.6);
        c.save(); c.translate(bx, h * 0.76); c.rotate(ang);
        var bg2 = c.createLinearGradient(0, 0, 0, -h * 0.9);
        bg2.addColorStop(0, 'rgba(141,153,174,.10)');
        bg2.addColorStop(1, 'rgba(141,153,174,0)');
        c.fillStyle = bg2;
        c.beginPath(); c.moveTo(-7, 0); c.lineTo(7, 0);
        c.lineTo(52, -h * 0.9); c.lineTo(-52, -h * 0.9);
        c.closePath(); c.fill(); c.restore();
      }
      /* --- ridge + city-block silhouettes --- */
      c.fillStyle = '#191320';
      c.beginPath(); c.moveTo(0, h);
      for (var x = 0; x <= w; x += 28) {
        c.lineTo(x, h * (0.72 + 0.05 * Math.sin(x * 0.008 + 2) + 0.02 * Math.sin(x * 0.031)));
      }
      c.lineTo(w, h); c.closePath(); c.fill();
      c.fillStyle = '#0d0a14';
      for (var b = 0; b < 14; b++) {
        var bw = 26 + h2(b + 11) * 54;
        var bh = h * (0.05 + h2(b + 31) * 0.1);
        c.fillRect((b * 97 + 13) % w, h * 0.76 - bh, bw, bh);
      }
      /* rising smoke columns near the fires */
      for (var sm = 0; sm < 5; sm++) {
        var sx = w * (0.18 + 0.32 * (sm % 3)) + (h2(sm + 41) - 0.5) * 30;
        var ph = ((tt * 0.06) + h2(sm + 51)) % 1;
        c.fillStyle = 'rgba(36,28,43,' + (0.4 * (1 - ph)).toFixed(3) + ')';
        c.beginPath();
        c.arc(sx + Math.sin(tt * 0.5 + sm) * 14 * ph, h * 0.72 - ph * h * 0.34,
          10 + 34 * ph, 0, 7);
        c.fill();
      }
      /* --- THE PAVELOW: superellipse orbit hugging the viewport edge --- */
      var a = tt * 0.085;
      var ix = w / 2 - 66, iy = h / 2 - 56;
      function orb(aa) {
        return [
          w / 2 + Math.sign(Math.cos(aa)) * Math.pow(Math.abs(Math.cos(aa)), 0.65) * ix,
          h / 2 + Math.sign(Math.sin(aa)) * Math.pow(Math.abs(Math.sin(aa)), 0.65) * iy
        ];
      }
      var p0 = orb(a), p1 = orb(a + 0.02);
      var hd = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
      var firing = ((tt * 0.35) % 1) < 0.45;      /* ~1.6s fire / 2s cool */

      /* tracers: cosmetic alpha-fading strokes toward ground impacts */
      if (firing && m) {
        c.lineWidth = 1.4;
        for (var tr = 0; tr < 6; tr++) {
          var jx = p0[0] + (h2(tr + 61) - 0.5) * 90;
          var jy = p0[1] + (h2(tr + 71) - 0.5) * 70;
          var tx2 = w * h2(tr + 81), ty2 = h * (0.68 + 0.22 * h2(tr + 91));
          var tg = c.createLinearGradient(jx, jy, tx2, ty2);
          tg.addColorStop(0, 'rgba(255,210,62,.5)');
          tg.addColorStop(1, 'rgba(255,93,64,0)');
          c.strokeStyle = tg;
          c.beginPath(); c.moveTo(jx, jy); c.lineTo(tx2, ty2); c.stroke();
        }
      }
      drawPavelow(c, p0[0], p0[1], hd, 1, tt, m, firing);
    }
  });
}
})();
