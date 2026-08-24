/* ============================================================================
 * IQ.Curses — W1 blessing/curse event system (contracts: research/w1-contracts.md C4)
 *
 * Host or client calls Curses.roll({align, round, rng}) once per round start.
 * Bad/chaotic rounds: ~18% chance of a CURSE. Good rounds: ~25% chance of a
 * BLESSING. Neutral rounds: nothing. The returned event is plain data — the
 * HOST consumes `flags` (hpDelta/scoreMul/timerDelta/forgiveNext) and ships
 * authoritative state; this module itself performs PRESENTATION ONLY via
 * Curses.apply(evt): banners (.event-banner), a CSS body-shake class defined
 * by an injected <style>, cosmetic overlays, and an optional WebAudio blip.
 * Never touches answers, scoring state, or question glyphs.
 *
 * Curses: pestilence (fly motes 4s + timerDelta -5), horsemen (4 staggered
 * banners + hpDelta -20), curse (skull chip beside player name until the next
 * blessing/good round clears it), toil (scoreMul 0.75 for one round).
 * Blessings: lollipop/sticker (emoji chip persisted to IQB_FLAIR_V1),
 * grace (forgiveNext), sunlit (hpDelta +10).
 *
 * All motion behind localStorage IQB_MOTION; sound behind IQB_MUTED;
 * asset-free (DOM/CSS/oscillators only); no flashes >3Hz fullscreen.
 * ============================================================================*/
(function () {
'use strict';
var root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};

/* ---------- helpers ---------- */

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hashSeed(str) {
  var h = 2166136261 >>> 0;
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
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

/* ---------- injected CSS (shake class + mark chip + motes) ---------- */
var styleDone = false;
function ensureStyle() {
  if (styleDone || typeof document === 'undefined') return;
  styleDone = true;
  var st = document.createElement('style');
  st.id = 'iqb-curses-style';
  st.textContent =
    '@keyframes iqbBodyShake{0%,100%{transform:translate(0,0)}15%{transform:translate(-8px,4px)}30%{transform:translate(7px,-5px)}45%{transform:translate(-6px,-3px)}60%{transform:translate(5px,4px)}75%{transform:translate(-3px,-2px)}}' +
    'body.iqb-curse-shake{animation:iqbBodyShake .32s ease-out 1}' +
    '#iqb-curse-mark{position:fixed;z-index:71;font-size:14px;line-height:1;padding:2px 4px;' +
    'background:rgba(10,0,0,.72);border:1px solid #a33;border-radius:8px;color:#fcc;' +
    'pointer-events:none;text-shadow:0 0 4px #500}' +
    '.iqb-banner-horsemen{position:fixed;left:50%;z-index:70;padding:10px 26px;font-weight:900;' +
    'letter-spacing:.2em;font-size:14px;color:#000;border-radius:999px;box-shadow:0 4px 18px rgba(0,0,0,.5)}' +
    '#iqb-fly-layer{position:fixed;inset:0;z-index:69;pointer-events:none}';
  var head = document.head || document.getElementsByTagName('head')[0];
  head.appendChild(st);
}

/* ---------- WebAudio blip (lazy singleton, IQB_MUTED respected) ---------- */
var actx = null;
function blip(kind) {
  if (muted()) return;
  try {
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    if (!actx) actx = new AC();
    if (actx.state === 'suspended' && actx.resume) actx.resume();
    var t0 = actx.currentTime;
    /* curse: low grinding minor second; blessing: soft rising major third */
    var freqs = kind === 'curse' ? [98, 104] : [392, 494];
    var dur = kind === 'curse' ? 0.42 : 0.28;
    for (var i = 0; i < freqs.length; i++) {
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = kind === 'curse' ? 'sawtooth' : 'sine';
      o.frequency.value = freqs[i];
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(kind === 'curse' ? 0.09 : 0.06, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(t0); o.stop(t0 + dur + 0.05);
    }
  } catch (e) { /* audio is best-effort */ }
}

/* ---------- presentation pieces ---------- */

function showBanner(text, ms) {
  if (typeof document === 'undefined') return;
  var b = document.createElement('div');
  b.className = 'event-banner';
  b.textContent = text;
  document.body.appendChild(b);
  setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, ms || 1700);
}

function bodyShake() {
  if (!motionOK() || typeof document === 'undefined') return;
  ensureStyle();
  var body = document.body;
  body.classList.remove('iqb-curse-shake');
  void body.offsetWidth; /* restart animation */
  body.classList.add('iqb-curse-shake');
  setTimeout(function () { body.classList.remove('iqb-curse-shake'); }, 380);
}

/* pestilence: drifting fly motes overlay for ~4s (motion-gated; static specks otherwise) */
function flyMotes(ms) {
  if (typeof document === 'undefined') return;
  ensureStyle();
  var layer = document.createElement('div');
  layer.id = 'iqb-fly-layer';
  document.body.appendChild(layer);
  var n = 26, motes = [], els = [];
  for (var i = 0; i < n; i++) {
    var m = document.createElement('div');
    var sz = 3 + ((i * 7) % 4);
    m.style.cssText = 'position:absolute;width:' + sz + 'px;height:' + sz + 'px;border-radius:50%;' +
      'background:#1a1208;box-shadow:0 0 2px #000;';
    layer.appendChild(m);
    els.push(m);
    motes.push({ x: Math.random(), y: Math.random(), dx: (Math.random() - 0.5) * 0.0016, dy: (Math.random() - 0.5) * 0.0011, ph: Math.random() * 6.28 });
  }
  var moving = motionOK();
  var start = Date.now(), raf = 0;
  function frame() {
    var w = root.innerWidth || 1280, h = root.innerHeight || 720;
    for (var j = 0; j < motes.length; j++) {
      var p = motes[j];
      if (moving) {
        p.x += p.dx; p.y += p.dy; p.ph += 0.11;
        if (p.x < -0.02) p.x = 1.02; if (p.x > 1.02) p.x = -0.02;
        if (p.y < -0.02) p.y = 1.02; if (p.y > 1.02) p.y = -0.02;
        var jx = Math.sin(p.ph) * 5, jy = Math.cos(p.ph * 1.3) * 4;
        els[j].style.transform = 'translate(' + (p.x * w + jx) + 'px,' + (p.y * h + jy) + 'px)';
      } else {
        els[j].style.transform = 'translate(' + (p.x * w) + 'px,' + (p.y * h) + 'px)';
      }
    }
    if (Date.now() - start < ms) raf = requestAnimationFrame(frame);
  }
  frame();
  setTimeout(function () {
    if (raf) cancelAnimationFrame(raf);
    if (layer.parentNode) layer.parentNode.removeChild(layer);
  }, ms + 60);
}

/* horsemen: four colored banners, staggered (parody-flavored riders) */
var HORSEMEN = [
  { txt: '☠ WAR RIDES WITH YOU', bg: '#d84b4b' },
  { txt: '☠ FAMINE COUNTS YOUR COINS', bg: '#e0c341' },
  { txt: '☠ PESTILENCE BREATHES NEAR', bg: '#8db95b' },
  { txt: '☠ DEATH TAKES NOTES', bg: '#b9b9c9' }
];
function horsemenTheater(motion) {
  if (typeof document === 'undefined') return;
  var gap = motion ? 420 : 160; /* still staggered without motion, just faster & static */
  for (var i = 0; i < HORSEMEN.length; i++) (function (h, k) {
    setTimeout(function () {
      var b = document.createElement('div');
      b.className = 'event-banner iqb-banner-horsemen';
      b.style.background = h.bg;
      b.style.top = (110 + k * 44) + 'px';
      b.textContent = h.txt;
      if (!motion) b.style.animation = 'none';
      document.body.appendChild(b);
      setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 1500);
    }, k * gap);
  })(HORSEMEN[i], i);
}

/* curse mark: skull chip beside the local player's scoreboard row.
   The scoreboard re-renders its innerHTML every reveal, so the chip lives as a
   standalone fixed element anchored next to #side-panel / the .me card. */
function anchorMark(chip) {
  var me = document.querySelector('#side-panel .score-card.me .sc-name')
        || document.querySelector('#side-panel .score-card.me')
        || document.querySelector('#side-panel')
        || document.querySelector('#hud-timer');
  if (me && me.getBoundingClientRect) {
    var r = me.getBoundingClientRect();
    chip.style.left = Math.max(6, r.right + 8) + 'px';
    chip.style.top = Math.max(6, r.top - 2) + 'px';
  } else {
    chip.style.left = '12px';
    chip.style.top = '96px';
  }
}
function showMark() {
  if (typeof document === 'undefined') return;
  ensureStyle();
  clearMark();
  var chip = document.createElement('div');
  chip.id = 'iqb-curse-mark';
  chip.textContent = '💀 cursed';
  anchorMark(chip);
  document.body.appendChild(chip);
}
function clearMark() {
  if (typeof document === 'undefined') return;
  var old = document.getElementById('iqb-curse-mark');
  if (old && old.parentNode) old.parentNode.removeChild(old);
}

/* flair: emoji chips persisted to IQB_FLAIR_V1 */
var FLAIR_POOL = ['🍭', '🌟', '🍀', '🦋', '🍯', '🌈', '🪄', '🐚'];
function flairList() {
  try {
    var raw = root.localStorage && root.localStorage.getItem('IQB_FLAIR_V1');
    var arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function grantFlair(rngPick) {
  var pool = FLAIR_POOL;
  var emoji = pool[Math.floor((rngPick || Math.random)() * pool.length)] || '🍭';
  try {
    var arr = flairList();
    arr.push(emoji);
    while (arr.length > 24) arr.shift(); /* keep the badge strip tidy */
    root.localStorage.setItem('IQB_FLAIR_V1', JSON.stringify(arr));
  } catch (e) { /* storage unavailable: cosmetic only, ignore */ }
  return emoji;
}

/* ---------- event tables ---------- */

var CURSES = [
  {
    id: 'pestilence',
    bannerText: '🪰 PESTILENCE — THE FLIES ARRIVE',
    flags: function () { return { timerDelta: -5 }; },
    theater: function () { flyMotes(4000); }
  },
  {
    id: 'horsemen',
    bannerText: '🐴 THE FOUR HAVE BEEN SUMMONED',
    flags: function () { return { hpDelta: -20 }; },
    theater: function (motion) { horsemenTheater(motion); }
  },
  {
    id: 'curse',
    bannerText: '💀 MARKED — SOMETHING FOLLOWS YOU',
    flags: function () { return {}; },
    theater: function () { showMark(); }
  },
  {
    id: 'toil',
    bannerText: '⛏ TOIL — YOUR LAURELS WEIGH LESS',
    flags: function () { return { scoreMul: 0.75 }; },
    theater: function () {}
  }
];

var BLESSINGS = [
  {
    id: 'lollipop',
    bannerText: '🍭 LOLLIPOP — A SWEET TOKEN YOURS',
    flags: function () { return {}; },
    theater: function () { grantFlair(); }
  },
  {
    id: 'sticker',
    bannerText: '🌟 STICKER — WEAR IT PROUDLY',
    flags: function () { return {}; },
    theater: function () { grantFlair(); }
  },
  {
    id: 'grace',
    bannerText: '🕊 GRACE — ONE WRONG WILL BE FORGIVEN',
    flags: function () { return { forgiveNext: true }; },
    theater: function () {}
  },
  {
    id: 'sunlit',
    bannerText: '☀ SUNLIT — WARMTH MENDS THE EDGES',
    flags: function () { return { hpDelta: 10 }; },
    theater: function () {}
  }
];

/* ---------- public API ---------- */

var Curses = (function () {

  /* roll({align, round, rng}) -> event|null
     Deterministic when given rng (or seed+round via mulberry32). */
  function roll(opts) {
    opts = opts || {};
    var align = opts.align || 'neutral';
    var round = opts.round | 0;
    var rng = opts.rng;
    if (typeof rng !== 'function') {
      rng = (opts.seed != null)
        ? mulberry32(hashSeed(String(opts.seed)) ^ Math.imul(round + 1, 2654435761))
        : Math.random;
    }
    if (align === 'good') {
      if (rng() >= 0.25) return null;
      return materialize(BLESSINGS[Math.floor(rng() * BLESSINGS.length)], 'blessing');
    }
    if (align === 'bad' || align === 'chaotic') {
      if (rng() >= 0.18) return null;
      return materialize(CURSES[Math.floor(rng() * CURSES.length)], 'curse');
    }
    return null; /* neutral rounds are quiet */
  }

  function materialize(def, kind) {
    return {
      id: def.id,
      kind: kind,
      bannerText: def.bannerText,
      flags: def.flags()
    };
  }

  /* apply(evt) — presentation ONLY. Host consumes evt.flags separately. */
  function apply(evt) {
    if (!evt || !evt.id) return;
    ensureStyle();
    var def = null, i;
    if (evt.kind === 'curse') {
      for (i = 0; i < CURSES.length; i++) if (CURSES[i].id === evt.id) def = CURSES[i];
    } else {
      for (i = 0; i < BLESSINGS.length; i++) if (BLESSINGS[i].id === evt.id) def = BLESSINGS[i];
    }
    if (!def) return;

    var motion = motionOK();

    if (evt.kind === 'curse') {
      bodyShake();
      blip('curse');
    } else {
      /* any blessing ends a lingering curse mark ("until next good round") */
      clearMark();
      blip('blessing');
    }

    showBanner(evt.bannerText || def.bannerText, 1700);

    if (typeof def.theater === 'function') def.theater(motion);
  }

  return {
    roll: roll,
    apply: apply,
    clearMark: clearMark,
    hasMark: function () {
      if (typeof document === 'undefined') return false;
      return !!document.getElementById('iqb-curse-mark');
    },
    flair: flairList
  };
})();

root.IQ.Curses = Curses;
if (typeof module !== 'undefined' && module.exports) module.exports = Curses;
})();
