/* ============================================================================
 * pack-countries.js — B4 nation-flavored rounds (remake-wave army)
 * ============================================================================
 * Spec-line → mechanic map (Dave's country-themes ask). One NEW file; six
 * gameplay packs bound to six NEW backdrops. Parody ids/banners only; abstract
 * flag-ADJACENT palettes — no heraldry, no real insignia.
 *
 *  [1] USA .... world 'usa-fireworks'  pack 'countries-usa'
 *      Correct answer -> seeded firework-confetti burst (cosmetic,
 *      IQB_MOTION-gated, particles only — never a fullscreen flash).
 *      onRoundStart 15% (ctx.rng): superhero laser cameo disables ONE wrong
 *      option via ENGINE extension disableWrongRandom:1 (never the correct
 *      one); telegraphed by banner before the round starts.
 *  [2] ISRAEL . world 'israel-startup' pack 'countries-israel'
 *      'Startup nation' innovation grant: FIRST round spent in this world
 *      each run grants timerDelta +5. Tracked in IQ.Hooks.state
 *      ('countries-israel:granted'); later rounds unaffected.
 *  [3] IRAN ... world 'iran-bazaar'    pack 'countries-iran'
 *      Pre-round bazaar haggle interlude: self-mounted escapable panel
 *      (z above the engine's emerald backdrop) with 3 sealed crates. Crate
 *      ORDER and contents come from ctx.rng ONLY (host == client):
 *      +30 score bank / +7s next-round timer / comedic curse-dud
 *      ("vintage desert air"). Unplayed (Esc/✕/deadline) grants nothing;
 *      hard auto-finish ≤ 11s; winnings apply next onRoundStart.
 *  [4] CHINA .. world 'china-lanterns' pack 'countries-china'
 *      Lantern glow hint: every 10s the BOARD FRAME border ramps a soft
 *      glow (~2.4s ease, far under flash caps) tinted with the dominant
 *      color FAMILY of the board's public pixels (#board-frame svg fills).
 *      Matrix/sequence answers complete the visible pattern, so the
 *      completing tile inherits this family — a nudge derived from PUBLIC
 *      data only; hidden correctIdx is never read or broadcast. The tiles
 *      themselves are never touched. IQB_MOTION off => static faint tint.
 *  [5] RUSSIA . world 'russia-winter'  pack 'countries-russia'
 *      Winter slow: the ENGINE owns clocks, so "20% slower visually" is
 *      requested through sanctioned vocabulary — every 10s of live round,
 *      timerDelta +2 (capped +8/round ≈ 20% mercy) — paid for by scoreMul
 *      0.9 every winter round (telegraphed banner). Tonic ration: 35%
 *      chance/round (nominal 10% elsewhere +25 points) of pickup
 *      {kind:'health',value:8} with the comedic "for courage" banner.
 *  [6] GERMANY  world 'germany-precision' pack 'countries-germany'
 *      Precision mode: answer correctly within the first 10s (tick-clock,
 *      clamped deltas) -> pickup coin +40 "EFFIZIENZ!". Punctuality streak
 *      persists in IQ.Hooks.state ('countries-germany:streak'): each
 *      consecutive punctual answer adds +10 over the last (+40/+50/+60…
 *      capped +100); wrong OR slow resets the streak.
 *
 * Contract notes:
 *   - Registers via window.IQ.Hooks.add per hooks.js header JSDoc; hpDelta
 *     positive heals; all state keys prefixed with this pack's id; ctx.rng
 *     is the ONLY randomness (zero Math.random/Date.now in decisions —
 *     Date.now is used solely for wall-clock UI countdown text, mirroring
 *     pack-interludes).
 *   - Backdrops register via window.IQ.Worlds.register (same shape as
 *     worlds.js builtins / worlds-pop.js): procedural canvas, t-derived
 *     motion only (t=0 static honors IQB_MOTION via the shared loop),
 *     zero images/fonts/network/Math.random.
 *   - If hooks.js loads after us, packs queue onto window.IQ.__hooksPending
 *     (canonical queue drained by hooks.js); state access always goes
 *     through window.IQ.Hooks.state dynamically so a later real store wins.
 * ============================================================================*/
(function () {
'use strict';
var root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};

/* ---------- guarded registration + state fallbacks ------------------------ */

function hooksAdd(pack) {
  var H = root.IQ && root.IQ.Hooks;
  if (H && typeof H.add === 'function') { H.add(pack); return; }
  /* hooks.js not here yet — canonical pending queue (drained on load). */
  if (!root.IQ.__hooksPending) root.IQ.__hooksPending = [];
  root.IQ.__hooksPending.push(pack);
}
function stOf() {
  var H = root.IQ && root.IQ.Hooks;
  return (H && H.state) ? H.state : null;
}
function st(id, k, v) {
  var s = stOf();
  if (!s) {
    /* File-local shim so pre-hooks testing still works; ALL reads go back
     * through stOf(), so the real store replaces this transparently. */
    if (!root.__cntrShim) root.__cntrShim = {};
    s = root.__cntrShim;
  }
  var key = id + ':' + k;
  return v === undefined ? s.get(key) : s.set(key, v);
}
function stDel(id, k) {
  try {
    var key = id + ':' + k;
    var s = stOf();
    if (s && s.del) s.del(key);
    else if (root.__cntrShim) delete root.__cntrShim[key];
  } catch (e) {}
}

/* ---------- shared helpers ------------------------------------------------ */

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
function nowMs() {
  return (root.performance && root.performance.now) ? root.performance.now() : Date.now();
}

/* Minimal WebAudio blips (best-effort, IQB_MUTED respected). */
var actx = null;
function tone(freq, dur, type, gain, delay) {
  if (muted()) return;
  try {
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    if (!actx) actx = new AC();
    if (actx.state === 'suspended' && actx.resume) actx.resume();
    var t0 = actx.currentTime + (delay || 0);
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.05, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  } catch (e) { /* audio is best-effort */ }
}
var SFX = {
  pop:   function () { tone(660, 0.10, 'triangle', 0.05); tone(990, 0.12, 'sine', 0.04, 0.07); },
  crate: function () { tone(210, 0.14, 'square', 0.04); },
  win:   function () { tone(392, 0.12); tone(523, 0.16, 'sine', 0.06, 0.11); },
  dud:   function () { tone(180, 0.22, 'sawtooth', 0.04); },
  close: function () { tone(260, 0.07, 'triangle', 0.03); },
  glow:  function () { tone(520, 0.20, 'sine', 0.02); }
};

/* Per-round runtime records, keyed '<runId>#<round>@<owner>'. Each owner
 * prunes only its own stale records (mirrors pack-hunters hygiene). */
var rt = Object.create(null);
function rec(owner, ctx) {
  var k = (ctx.runId || '') + '#' + (ctx.round || 0) + '@' + owner;
  if (!rt[k]) {
    var runPre = (ctx.runId || '') + '#';
    var ownSuf = '@' + owner;
    for (var old in rt) {
      if (old !== k && old.indexOf(runPre) === 0 && old.slice(-ownSuf.length) === ownSuf) delete rt[old];
    }
    rt[k] = { clock: 0, last: nowMs(), grants: 0 };
  }
  return rt[k];
}
/* Advance + return clamped seconds since previous tick for this record.
 * Prefers engine-supplied dtSec; falls back to local delta (tab-stall safe). */
function step(r, ctx) {
  var t = nowMs();
  var dt = (ctx && typeof ctx.dtSec === 'number') ? ctx.dtSec
        : Math.min((t - r.last) / 1000, 0.25);
  if (!(dt >= 0)) dt = 0;
  if (dt > 0.25) dt = 0.25;
  r.last = t;
  r.clock += dt;
  return dt;
}

/* Injected CSS (bazaar panel + lantern glow). */
var styleDone = false;
function ensureStyle() {
  if (styleDone || typeof document === 'undefined') return;
  styleDone = true;
  var el = document.createElement('style');
  el.id = 'iqb-countries-style';
  el.textContent =
    '@keyframes iqCnFade{0%{opacity:0;transform:scale(.94)}100%{opacity:1;transform:scale(1)}}' +
    '.iqbb-bazaar{position:fixed;inset:0;z-index:95;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;gap:12px;font-family:inherit;' +
      'color:#ffe9c9;background:rgba(24,8,2,.82);animation:iqCnFade .22s ease-out 1}' +
    '.iqbb-title{font-weight:900;letter-spacing:.28em;font-size:clamp(16px,3vw,26px)}' +
    '.iqbb-sub{opacity:.8;font-size:13px;text-align:center;max-width:min(560px,88vw)}' +
    '.iqbb-row{display:flex;gap:18px;margin-top:8px;flex-wrap:wrap;justify-content:center}' +
    '.iqbb-crate{width:128px;height:128px;border-radius:14px;cursor:pointer;font-size:44px;' +
      'line-height:1;color:#ffd75e;background:linear-gradient(#5a3410,#33200a);' +
      'border:2px solid #a97a2f;box-shadow:0 6px 18px rgba(0,0,0,.55)}' +
    '.iqbb-crate:hover{border-color:#ffd75e;transform:translateY(-3px)}' +
    '.iqbb-crate:disabled{cursor:default;transform:none;opacity:.85}' +
    '.iqbb-crate .iqbb-prize{font-size:15px;font-weight:800;letter-spacing:.06em;display:block;margin-top:6px}' +
    '.iqbb-x{position:absolute;top:10px;right:12px;width:34px;height:34px;border-radius:50%;' +
      'border:1px solid #888;background:#16181f;color:#ddd;font-size:15px;cursor:pointer;line-height:1}' +
    '.iqbb-x:hover{border-color:#fff;color:#fff}' +
    '.iqbb-hud{font-size:13px;letter-spacing:.14em;opacity:.85}' +
    '#iqb-lantern-glow{position:absolute;inset:-6px;border-radius:inherit;pointer-events:none;' +
      'z-index:1;box-shadow:inset 0 0 42px -18px var(--lnt,#ffb01e),0 0 22px -8px var(--lnt,#ffb01e);' +
      'transition:opacity 2.4s ease;opacity:.22}' +
    '#iqb-lantern-glow.iq-lnt-on{opacity:.85}';
  var head = document.head || document.getElementsByTagName('head')[0];
  head.appendChild(el);
}

/* ==========================================================================
 * [1] USA — countries-usa @ usa-fireworks
 * ========================================================================*/
hooksAdd({
  id: 'countries-usa',
  worlds: ['usa-fireworks'],
  weight: 1,
  handlers: {
    /* Telegraphed laser cameo: 15% of rounds zap ONE wrong option. Uses the
     * engine extension so the engine (which knows correctIdx) picks the
     * victim — the pack never learns the answer. */
    onRoundStart: function (ctx) {
      if (ctx.rng() >= 0.15) return undefined;
      return {
        disableWrongRandom: 1,
        bannerText: '\u{1F9D8} PATRIOT LASER: ONE LIE ZAPPED',
        sfx: 'zap',
        flag: 'usa-hero-zap'
      };
    },
    /* Fireworks on correct answers — cosmetic, seeded, motion-gated. */
    onAnswer: function (ctx) {
      if (!ctx.res || !ctx.res.correct) return undefined;
      if (!motionOK()) return undefined;
      var r = ctx.rng, bits = [];
      var cols = ['#ff3b4f', '#ffffff', '#5a8bff', '#ffd75e'];
      for (var i = 0; i < 16; i++) {
        var size = 5 + Math.floor(r() * 7);
        bits.push('<span style="position:absolute;left:' + (4 + r() * 92).toFixed(1) +
          '%;top:' + (r() * 58).toFixed(1) + '%;width:' + size + 'px;height:' + size +
          'px;border-radius:50%;background:' + cols[Math.floor(r() * cols.length)] +
          ';box-shadow:0 0 8px 2px rgba(255,255,255,.35);pointer-events:none;' +
          'animation:iqUsaPop .8s ease-out forwards"></span>');
      }
      return {
        overlayHTML: '<div style="position:absolute;inset:0;overflow:hidden;pointer-events:none">' +
          '<style>@keyframes iqUsaPop{0%{opacity:0;transform:scale(.2)}18%{opacity:1}' +
          '70%{opacity:.9}100%{opacity:0;transform:scale(1.5) translateY(-14px)}}</style>' +
          bits.join('') + '</div>',
        overlayMs: 1400,
        sfx: 'chime',
        flag: 'usa-fireworks'
      };
    }
  }
});

/* ==========================================================================
 * [2] ISRAEL — countries-israel @ israel-startup
 * ========================================================================*/
hooksAdd({
  id: 'countries-israel',
  worlds: ['israel-startup'],
  weight: 1,
  handlers: {
    onRoundStart: function (ctx) {
      if (st('countries-israel', 'granted')) return undefined;
      st('countries-israel', 'granted', ctx.round || 1);
      return {
        timerDelta: 5,
        bannerText: 'INNOVATION GRANT +5s \u2014 THE INCUBATOR BELIEVES IN YOU',
        sfx: 'chime',
        flag: 'israel-innovation-grant'
      };
    }
  }
});

/* ==========================================================================
 * [3] IRAN — countries-iran @ iran-bazaar
 * ========================================================================*/

var bz = { kind: null, iv: 0, hard: 0, closeAt: 0, seen: false, picked: -1 };

function bzKillTimers() {
  clearInterval(bz.iv);
  clearTimeout(bz.hard);
}
function bzNode() {
  return (typeof document !== 'undefined') ? document.getElementById('iqb-int-bazaar') : null;
}
function bzRemove() {
  var n = bzNode();
  if (n && n.parentNode) n.parentNode.removeChild(n);
}
/* Idempotent finish. Sealed crates stay sealed: an unplayed bazaar banks
 * nothing (the dud is a prize you must CHOOSE to unwrap). */
function bzFinish(reason) {
  if (bz.kind !== 'bazaar') return;
  bzKillTimers();
  bz.kind = null;
  bzRemove();
  void reason;
}

var PRIZES = ['score', 'time', 'dud'];
var DUD_LINES = [
  'AUTHENTIC DESERT AIR \u2014 VINTAGE',
  'ONE GENUINE EMPTY CRATE',
  'MERCHANT GUARANTEES: IT IS A BOX'
];

function openBazaar(ctx) {
  if (typeof document === 'undefined') return;
  ensureStyle();
  var r = ctx.rng;                       /* seeded — host/client identical */
  /* Fisher-Yates with the seeded stream only. */
  var order = PRIZES.slice();
  for (var i = order.length - 1; i > 0; i--) {
    var j = Math.floor(r() * (i + 1));
    var tmp = order[i]; order[i] = order[j]; order[j] = tmp;
  }
  var dudLine = DUD_LINES[Math.floor(r() * DUD_LINES.length)];
  bz.order = order;
  bz.dudLine = dudLine;
  bz.picked = -1;

  var crates = '';
  for (var c = 0; c < 3; c++) {
    crates += '<button type="button" class="iqbb-crate" data-cntr-crate="' + c +
      '" title="Crate ' + (c + 1) + '" aria-label="Open crate ' + (c + 1) +
      '">\u{1F4E6}</button>';
  }
  var w = document.createElement('div');
  w.id = 'iqb-int-bazaar';
  w.className = 'iqbb-bazaar';
  w.setAttribute('role', 'dialog');
  w.setAttribute('aria-label', 'Bazaar haggle');
  w.innerHTML =
    '<button type="button" class="iqbb-x" data-cntr-x title="Close (Esc)">\u2715</button>' +
    '<div class="iqbb-title">THE BAZAAR OF SMALL MERCIES</div>' +
    '<div class="iqbb-sub">Three crates. One holds +30 score, one holds +7 seconds ' +
    'next round, one holds vintage desert air. Pick ONE. No refunds, much charm.</div>' +
    '<div class="iqbb-row">' + crates + '</div>' +
    '<div class="iqbb-hud"><span data-cntr-msg>haggle wisely \u2026</span> \u00b7 <span data-cntr-clock></span></div>';
  document.body.appendChild(w);

  bz.kind = 'bazaar';
  bz.seen = true;
  var deadline = nowMs() + 9000;
  bz.iv = setInterval(function () {
    var n = bzNode();
    if (!n) { bzFinish('unmounted'); return; }
    var s = n.querySelector('[data-cntr-clock]');
    if (s && bz.kind === 'bazaar') {
      s.textContent = Math.max(0, (deadline - nowMs()) / 1000).toFixed(1) + 's';
    }
  }, 150);
  bz.hard = setTimeout(function () { bzFinish('deadline'); }, 11000);
}

function pickCrate(idx) {
  if (bz.kind !== 'bazaar' || idx < 0 || idx > 2 || bz.picked >= 0) return;
  bz.picked = idx;
  var prize = bz.order[idx];
  var msg, emoji;
  if (prize === 'score') {
    st('countries-iran', 'pending', { kind: 'score', round: (bz.round || 0) + 1 });
    emoji = '\u{1F4B0}';
    msg = '+30 SCORE NEXT ROUND \u2014 A FAIR PRICE';
    SFX.win();
  } else if (prize === 'time') {
    st('countries-iran', 'pending', { kind: 'time', round: (bz.round || 0) + 1 });
    emoji = '\u23F3';
    msg = '+7s NEXT ROUND \u2014 EXTRA BARGAINING TIME';
    SFX.win();
  } else {
    emoji = '\u{1F4AB}';
    msg = bz.dudLine;
    SFX.dud();
  }
  SFX.crate();
  var n = bzNode();
  if (n) {
    var btns = n.querySelectorAll('[data-cntr-crate]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].disabled = true;
      if (i === idx) btns[i].innerHTML = '<span>' + emoji + '</span><span class="iqbb-prize">' +
        (prize === 'dud' ? 'THE DUD' : (prize === 'score' ? '+30 SCORE' : '+7 SECONDS')) + '</span>';
    }
    var m = n.querySelector('[data-cntr-msg]');
    if (m) m.textContent = msg;
  }
  bz.closeAt = setTimeout(function () { bzFinish('picked'); }, 2300);
}

hooksAdd({
  id: 'countries-iran',
  worlds: ['iran-bazaar'],
  weight: 1,
  handlers: {
    onInterlude: function (ctx) {
      bz.round = ctx.round || 0;
      openBazaar(ctx);
      return { flag: 'iran-bazaar-open', sfx: 'chime' };
    },
    onRoundStart: function (ctx) {
      /* Safety: a round starting means the interlude is over. */
      if (bz.kind === 'bazaar') { SFX.close(); bzFinish('round-start'); }
      var p = st('countries-iran', 'pending');
      if (!p || (ctx.round || 0) < p.round) return undefined;
      stDel('countries-iran', 'pending');
      if (p.kind === 'score') {
        return { pickup: { kind: 'coin', value: 30 }, bannerText: 'BAZAAR WARES +30', sfx: 'chime', flag: 'iran-bazaar-score' };
      }
      if (p.kind === 'time') {
        return { timerDelta: 7, bannerText: 'BAZAAR PATIENCE +7s', sfx: 'chime', flag: 'iran-bazaar-time' };
      }
      return undefined;
    }
  }
});

/* Delegated input for the bazaar (mounted directly by us — survives nothing
 * external; guard against double-wiring across re-evals). */
if (typeof document !== 'undefined' && !root.__cntrIranWired) {
  root.__cntrIranWired = true;
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('[data-cntr-x]')) { SFX.close(); bzFinish('x'); return; }
    var cr = t.closest('[data-cntr-crate]');
    if (cr) { pickCrate(parseInt(cr.getAttribute('data-cntr-crate'), 10)); }
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && bz.kind === 'bazaar') { SFX.close(); bzFinish('esc'); }
  }, true);
}

/* ==========================================================================
 * [4] CHINA — countries-china @ china-lanterns
 * ========================================================================*/

/* Parse PUBLIC pixel fills out of the rendered board svg (hex only — those
 * are the palette glyphs; the rgba() hit is the neutral cell backing). No
 * hidden state is consulted anywhere. */
function boardDominantColor() {
  if (typeof document === 'undefined') return null;
  var frame = document.getElementById('board-frame');
  if (!frame) return null;
  var svgs = frame.querySelectorAll('svg [fill]');
  var buckets = {};                    /* hueFamily -> {n, r, g, b} */
  var best = null;
  for (var i = 0; i < svgs.length; i++) {
    var f = svgs[i].getAttribute('fill') || '';
    var m = /^#([0-9a-f]{6})$/i.exec(f);
    if (!m) continue;
    var v = parseInt(m[1], 16);
    var rr = (v >> 16) & 255, gg = (v >> 8) & 255, bb = v & 255;
    var mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb);
    if (mx - mn < 28) continue;        /* skip near-gray backing cells */
    var fam = hueBucket(rr, gg, bb);
    var b = buckets[fam] || (buckets[fam] = { n: 0, r: 0, g: 0, b: 0 });
    b.n++; b.r += rr; b.g += gg; b.b += bb;
    if (!best || b.n > buckets[best].n) best = fam;
  }
  if (best == null) return null;
  var w = buckets[best];
  return 'rgb(' + Math.round(w.r / w.n) + ',' + Math.round(w.g / w.n) + ',' + Math.round(w.b / w.n) + ')';
}
function hueBucket(r, g, b) {
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
  if (d === 0) h = 0;
  else if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = Math.round(h * 60); if (h < 0) h += 360;
  return Math.floor(h / 45);           /* 8 color families */
}

var lant = { rec: null, pulses: 0, timer: 0 };

function mountLantern(worldMotion) {
  if (typeof document === 'undefined') return;
  unmountLantern();
  var frame = document.getElementById('board-frame');
  if (!frame) return;
  ensureStyle();
  var col = boardDominantColor() || '#ffb01e';
  var d = document.createElement('div');
  d.id = 'iqb-lantern-glow';
  d.style.setProperty('--lnt', col);
  frame.appendChild(d);
  lant.el = d;
  lant.motion = worldMotion;
  /* Static faint tint is ALWAYS on (readable, non-animated baseline). */
}
function unmountLantern() {
  if (lant.timer) { clearTimeout(lant.timer); lant.timer = 0; }
  var old = typeof document !== 'undefined' ? document.getElementById('iqb-lantern-glow') : null;
  if (old && old.parentNode) old.parentNode.removeChild(old);
  lant.el = null;
}
function lanternPulse() {
  var d = lant.el;
  if (!d) return;
  if (!lant.motion) return;            /* motion off: static tint only */
  SFX.glow();
  d.classList.add('iq-lnt-on');
  clearTimeout(lant.timer);
  lant.timer = setTimeout(function () {
    if (lant.el) lant.el.classList.remove('iq-lnt-on');
  }, 2400);
}

hooksAdd({
  id: 'countries-china',
  worlds: ['china-lanterns'],
  weight: 1,
  handlers: {
    onRoundStart: function (ctx) {
      lant.rec = rec('china', ctx);
      var motion = motionOK();
      /* let renderBoard paint first */
      if (typeof setTimeout === 'function') {
        setTimeout(function () { if (lant.rec) mountLantern(motion); }, 80);
      }
      return {
        bannerText: 'LANTERN WATCH \u2014 THE GLOW WHISPERS EVERY 10s',
        flag: 'china-lantern-hint'
      };
    },
    onTick: function (ctx) {
      if (!lant.rec) lant.rec = rec('china', ctx);
      step(lant.rec, ctx);
      var due = Math.floor(lant.rec.clock / 10);
      while (lant.pulses < due) {
        lant.pulses++;
        lanternPulse();                  /* max one ramp per 10s — well under caps */
      }
      return undefined;
    },
    onReveal: function () {
      unmountLantern();                  /* truth is shown — the whisper rests */
      return undefined;
    },
    onInterlude: function () {
      unmountLantern();
      return undefined;
    }
  }
});

/* ==========================================================================
 * [5] RUSSIA — countries-russia @ russia-winter
 * ========================================================================*/

hooksAdd({
  id: 'countries-russia',
  worlds: ['russia-winter'],
  weight: 1,
  handlers: {
    onRoundStart: function (ctx) {
      var mods = {
        scoreMul: 0.9,
        bannerText: 'WINTER SLOW \u2014 CLOCK RUNS SOFT, SCORE \u00d70.9',
        flag: 'russia-winter-slow'
      };
      /* Tonic ration: nominal 10% elsewhere, +25 points => 35% here. */
      if (ctx.rng() < 0.35) {
        mods.pickup = { kind: 'health', value: 8 };
        mods.bannerText += ' \u00b7 TONIC FOR COURAGE +8';
        mods.sfx = 'chime';
        mods.flag += '+tonic';
      }
      return mods;
    },
    /* The 20% visual mercy: every 10s of live round, +2s back (cap +8). */
    onTick: function (ctx) {
      var r = rec('russia', ctx);
      step(r, ctx);
      var earned = Math.min(4, Math.floor(r.clock / 10 + 1e-9));
      if (earned > r.grants) {
        r.grants = earned;
        return { timerDelta: 2, flag: 'russia-winter-mercy' };
      }
      return undefined;
    }
  }
});

/* ==========================================================================
 * [6] GERMANY — countries-germany @ germany-precision
 * ========================================================================*/

hooksAdd({
  id: 'countries-germany',
  worlds: ['germany-precision'],
  weight: 1,
  handlers: {
    onRoundStart: function (ctx) {
      rec('germany', ctx);
      return {
        bannerText: 'PR\u00c4ZISIONSMODE \u2014 ANSWER INSIDE 10s FOR THE BONUS',
        flag: 'germany-precision-armed'
      };
    },
    onTick: function (ctx) {
      var r = rec('germany', ctx);
      step(r, ctx);
      return undefined;
    },
    onAnswer: function (ctx) {
      var r = rec('germany', ctx);
      var fast = r.clock <= 10;
      if (!ctx.res || !ctx.res.correct || !fast) {
        if (st('countries-germany', 'streak')) stDel('countries-germany', 'streak');
        return undefined;
      }
      var streak = (st('countries-germany', 'streak') || 0) + 1;
      st('countries-germany', 'streak', streak);
      /* +40 base, escalating +10 per consecutive punctual answer, cap +100. */
      var bonus = Math.min(100, 40 + (streak - 1) * 10);
      var label = streak > 1 ? ('EFFIZIENZ! STREAK \u00d7' + streak + ' +' + bonus) : 'EFFIZIENZ! +' + bonus;
      return {
        pickup: { kind: 'coin', value: bonus },
        bannerText: label,
        sfx: 'chime',
        flag: 'germany-punctual-' + streak
      };
    }
  }
});

/* ==========================================================================
 * BACKDROP WORLDS — window.IQ.Worlds.register
 * Procedural canvas only; motion derives from t alone (t=0 static), zero
 * Math.random; abstract flag-adjacent palettes, no heraldry.
 * ========================================================================*/
var TAU = Math.PI * 2;

function vgrad(c, h, stops) {
  var g = c.createLinearGradient(0, 0, 0, h);
  for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
  c.fillStyle = g;
}
/* deterministic per-index pseudo-position (no Math.random anywhere) */
function ph(i, salt) { var v = Math.sin(i * 12.9898 + (salt || 0) * 78.233) * 43758.5453; return v - Math.floor(v); }

var COUNTRIES = [

/* --- usa-fireworks (good): night launch sky over a dark skyline ---------- */
{ id: 'usa-fireworks', align: 'good',
  pal: ['#b22234', '#ffffff', '#3c3b6e', '#0a0f2e', '#ff5a76', '#9bd1ff', '#ffd75e', '#101830'],
  draw: function (c, w, h, t) {
    vgrad(c, h, [[0, '#060a1e'], [0.62, '#101830'], [1, '#04060f']]); c.fillRect(0, 0, w, h);
    /* skyline */
    c.fillStyle = '#070b16';
    for (var b = 0; b < 14; b++) {
      var bw = w / 14, bh = h * (0.08 + ph(b, 3) * 0.16);
      c.fillRect(b * bw, h - bh, bw - 3, bh);
    }
    c.fillStyle = 'rgba(255,215,94,.35)';
    for (var wl = 0; wl < 26; wl++) {
      c.fillRect((ph(wl, 7) * w) | 0, (h - ph(wl, 11) * h * 0.2) | 0, 2, 3);
    }
    /* three burst sites, staggered 4s cycles */
    for (var s = 0; s < 3; s++) {
      var cyc = ((t + s * 1.35) % 4) / 4;
      if (cyc > 0.55) continue;                     /* dark reload phase */
      var bx = w * (0.24 + 0.26 * s), by = h * (0.2 + ph(s, 5) * 0.16);
      var rad = cyc / 0.55, alpha = 1 - rad;
      for (var p = 0; p < 10; p++) {
        var ang = (p / 10) * TAU + s;
        var px = bx + Math.cos(ang) * rad * w * 0.09;
        var py = by + Math.sin(ang) * rad * w * 0.09 + rad * rad * w * 0.02;
        c.fillStyle = 'rgba(' + (s === 1 ? '155,209,255' : (s === 2 ? '255,215,94' : '255,90,118')) +
          ',' + (alpha * 0.9).toFixed(3) + ')';
        c.beginPath(); c.arc(px, py, 2.4, 0, TAU); c.fill();
      }
      c.fillStyle = 'rgba(255,255,255,' + (alpha * 0.5).toFixed(3) + ')';
      c.beginPath(); c.arc(bx, by, 2, 0, TAU); c.fill();
    }
  }},

/* --- israel-startup (neutral): deep-blue incubator grid, rising sparks --- */
{ id: 'israel-startup', align: 'neutral',
  pal: ['#0038b8', '#7ec8ff', '#ffffff', '#0a1430', '#38bdf8', '#dfefff', '#5a7fd0', '#0e1e46'],
  draw: function (c, w, h, t) {
    vgrad(c, h, [[0, '#0a1430'], [0.55, '#0e1e46'], [1, '#060b1c']]); c.fillRect(0, 0, w, h);
    /* receding tech grid */
    c.strokeStyle = 'rgba(126,200,255,.10)'; c.lineWidth = 1; c.beginPath();
    var hy = h * 0.68, off = (t * 12) % 36;
    for (var gy = 0; gy <= 9; gy++) {
      var y = hy + (h - hy) * Math.pow(gy / 9, 1.6);
      c.moveTo(0, y); c.lineTo(w, y);
    }
    for (var gx = -8; gx <= 8; gx++) { c.moveTo(w * 0.5 + gx * 30 + off, hy); c.lineTo(w * 0.5 + gx * 120 + off * 2, h + 30); }
    c.stroke();
    /* circuit traces with node dots */
    c.strokeStyle = 'rgba(56,189,248,.28)';
    for (var tr = 0; tr < 4; tr++) {
      var ty = h * (0.16 + tr * 0.13);
      c.beginPath(); c.moveTo(0, ty);
      c.lineTo(w * 0.32, ty); c.lineTo(w * 0.4, ty + 12 * (tr % 2 ? 1 : -1)); c.lineTo(w, ty + 12 * (tr % 2 ? 1 : -1));
      c.stroke();
      c.fillStyle = 'rgba(223,239,255,.6)';
      c.beginPath(); c.arc(w * (0.32 + 0.14 * ((t * 0.2 + tr * 0.37) % 4)), ty, 2.6, 0, TAU); c.fill();
    }
    /* rising sparks = ideas shipping */
    for (var sp = 0; sp < 7; sp++) {
      var sx = ph(sp, 13) * w;
      var sy = h - ((t * (14 + ph(sp, 17) * 12) + ph(sp, 19) * h) % (h * 1.1));
      c.fillStyle = 'rgba(126,200,255,' + (0.25 + 0.45 * Math.sin(t * 2 + sp)).toFixed(3) + ')';
      c.beginPath(); c.arc(sx, sy, 2, 0, TAU); c.fill();
    }
  }},

/* --- iran-bazaar (chaotic): warm arches, swaying lanterns, carpet band --- */
{ id: 'iran-bazaar', align: 'chaotic',
  pal: ['#239f40', '#da0000', '#ffb01e', '#3a1410', '#ffdf8a', '#8a0315', '#1f7a33', '#2b1208'],
  draw: function (c, w, h, t) {
    vgrad(c, h, [[0, '#2b1208'], [0.6, '#3a1410'], [1, '#1a0a04']]); c.fillRect(0, 0, w, h);
    /* arcade arches */
    for (var a = 0; a < 5; a++) {
      var ax = w * (0.08 + a * 0.21), aw = w * 0.15, ay = h * 0.52, ah = h * 0.42;
      c.fillStyle = 'rgba(255,223,138,.06)';
      c.strokeStyle = 'rgba(255,176,30,.35)'; c.lineWidth = 2;
      c.beginPath();
      c.moveTo(ax, ay + ah);
      c.lineTo(ax, ay + aw * 0.5);
      c.arc(ax + aw / 2, ay + aw * 0.5, aw / 2, Math.PI, 0, false);
      c.lineTo(ax + aw, ay + ah);
      c.closePath(); c.fill(); c.stroke();
    }
    /* swaying lanterns */
    for (var ln = 0; ln < 6; ln++) {
      var lx = w * (0.1 + 0.16 * ln), ly = h * 0.16 + ph(ln, 21) * h * 0.08;
      var sway = Math.sin(t * 1.1 + ln * 1.7) * 6;
      c.strokeStyle = 'rgba(255,176,30,.4)'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(lx, ly - 26); c.lineTo(lx + sway, ly); c.stroke();
      c.fillStyle = 'rgba(218,160,0,.75)';
      c.beginPath();
      c.ellipse(lx + sway, ly + 10, 6, 9, 0, 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,223,138,' + (0.5 + 0.3 * Math.sin(t * 2.2 + ln)).toFixed(3) + ')';
      c.beginPath(); c.arc(lx + sway, ly + 10, 2.4, 0, TAU); c.fill();
    }
    /* carpet stripe band */
    var bands = ['#8a0315', '#1f7a33', '#ffb01e', '#3a1410'];
    for (var bd = 0; bd < 8; bd++) {
      c.fillStyle = bands[bd % bands.length];
      c.globalAlpha = 0.35;
      c.fillRect(0, h * 0.86 + bd * (h * 0.02), w, h * 0.02);
    }
    c.globalAlpha = 1;
  }},

/* --- china-lanterns (neutral): crimson festival, rising lantern dots ----- */
{ id: 'china-lanterns', align: 'neutral',
  pal: ['#de2910', '#ffde00', '#8a0315', '#2b0a06', '#ff6a4d', '#ffd75e', '#b01030', '#401008'],
  draw: function (c, w, h, t) {
    vgrad(c, h, [[0, '#401008'], [0.5, '#8a0315'], [1, '#2b0a06']]); c.fillRect(0, 0, w, h);
    /* golden shimmer band */
    var sh = 0.10 + 0.06 * Math.sin(t * 0.8);
    var gr = c.createLinearGradient(0, h * 0.3, 0, h * 0.3 + h * sh);
    gr.addColorStop(0, 'rgba(255,222,0,0)');
    gr.addColorStop(0.5, 'rgba(255,222,0,.14)');
    gr.addColorStop(1, 'rgba(255,222,0,0)');
    c.fillStyle = gr; c.fillRect(0, h * 0.3, w, h * sh);
    /* rising festival lanterns */
    for (var i = 0; i < 9; i++) {
      var lx = w * (0.06 + 0.11 * i) + Math.sin(t * 0.9 + i * 1.3) * 8;
      var lr = 5 + ph(i, 29) * 6;
      var ly = h + 30 - ((t * (16 + ph(i, 31) * 14) + ph(i, 33) * h * 1.2) % (h * 1.25));
      c.strokeStyle = 'rgba(255,222,0,.5)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(lx, ly + lr); c.lineTo(lx, ly + lr + 7); c.stroke();
      c.fillStyle = 'rgba(222,41,16,.85)';
      c.beginPath(); c.ellipse(lx, ly, lr, lr * 0.78, 0, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(255,215,94,.65)';
      c.beginPath(); c.ellipse(lx, ly, lr, lr * 0.78, 0, 0, TAU); c.stroke();
      c.fillStyle = 'rgba(255,222,0,' + (0.35 + 0.25 * Math.sin(t * 3 + i)).toFixed(3) + ')';
      c.beginPath(); c.arc(lx, ly, 2, 0, TAU); c.fill();
    }
  }},

/* --- russia-winter (bad): blue snowfield, falling snow, fir line --------- */
{ id: 'russia-winter', align: 'bad',
  pal: ['#d52b1e', '#0039a6', '#ffffff', '#0a1428', '#9cc8ff', '#5a86d0', '#e8f2ff', '#122040'],
  draw: function (c, w, h, t) {
    vgrad(c, h, [[0, '#0a1428'], [0.55, '#122040'], [1, '#e8f2ff']]); c.fillRect(0, 0, w, h);
    /* snowfield */
    c.fillStyle = 'rgba(232,242,255,.9)';
    c.beginPath();
    c.moveTo(0, h * 0.78);
    for (var sx = 0; sx <= w; sx += w / 8) c.quadraticCurveTo(sx + w / 16, h * (0.74 + ph(sx, 37) * 0.05), sx + w / 8, h * 0.78);
    c.lineTo(w, h); c.lineTo(0, h); c.closePath(); c.fill();
    /* fir silhouettes */
    c.fillStyle = '#08101f';
    for (var f = 0; f < 7; f++) {
      var fx = w * (0.05 + f * 0.15), fy = h * (0.66 + ph(f, 39) * 0.1), fs = h * (0.09 + ph(f, 41) * 0.06);
      for (var tier = 0; tier < 3; tier++) {
        var tw = fs * (0.5 + tier * 0.25), ty = fy - tier * fs * 0.34;
        c.beginPath();
        c.moveTo(fx, ty - fs * 0.5);
        c.lineTo(fx - tw, ty); c.lineTo(fx + tw, ty);
        c.closePath(); c.fill();
      }
    }
    /* snowfall */
    for (var sn = 0; sn < 40; sn++) {
      var px = ph(sn, 43) * w + Math.sin(t + sn) * 6;
      var py = ((t * (22 + ph(sn, 47) * 26) + ph(sn, 51) * h) % (h + 20)) - 10;
      c.fillStyle = 'rgba(255,255,255,' + (0.35 + ph(sn, 53) * 0.5).toFixed(2) + ')';
      c.beginPath(); c.arc(px, py, 1 + ph(sn, 57) * 1.6, 0, TAU); c.fill();
    }
  }},

/* --- germany-precision (neutral): charcoal grid + precision dial --------- */
{ id: 'germany-precision', align: 'neutral',
  pal: ['#000000', '#dd0000', '#ffce00', '#181818', '#ff5a1e', '#8a8a8a', '#2b2b2b', '#ffd24a'],
  draw: function (c, w, h, t) {
    vgrad(c, h, [[0, '#101010'], [0.6, '#181818'], [1, '#0a0a0a']]); c.fillRect(0, 0, w, h);
    /* exact graph grid */
    c.strokeStyle = 'rgba(138,138,138,.14)'; c.lineWidth = 1; c.beginPath();
    for (var gx = 0; gx <= w; gx += 48) { c.moveTo(gx + 0.5, 0); c.lineTo(gx + 0.5, h); }
    for (var gy = 0; gy <= h; gy += 48) { c.moveTo(0, gy + 0.5); c.lineTo(w, gy + 0.5); }
    c.stroke();
    /* precision dial: fixed ticks, one sweeping hand, minute markers */
    var cx = w * 0.78, cy = h * 0.3, R = Math.min(w, h) * 0.17;
    c.strokeStyle = 'rgba(255,210,74,.5)'; c.lineWidth = 2;
    c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.stroke();
    for (var tk = 0; tk < 12; tk++) {
      var ang = (tk / 12) * TAU;
      c.strokeStyle = tk % 3 === 0 ? 'rgba(255,206,0,.9)' : 'rgba(138,138,138,.6)';
      c.lineWidth = tk % 3 === 0 ? 3 : 1.5;
      c.beginPath();
      c.moveTo(cx + Math.cos(ang) * R * 0.86, cy + Math.sin(ang) * R * 0.86);
      c.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
      c.stroke();
    }
    var ha = -Math.PI / 2 + (t % 60) / 60 * TAU;
    c.strokeStyle = '#dd0000'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(cx, cy);
    c.lineTo(cx + Math.cos(ha) * R * 0.72, cy + Math.sin(ha) * R * 0.72); c.stroke();
    c.fillStyle = '#ffce00';
    c.beginPath(); c.arc(cx, cy, 4, 0, TAU); c.fill();
    /* tricolor base band (abstract, flat stripes) */
    var bw2 = w / 3;
    c.globalAlpha = 0.22;
    c.fillStyle = '#000000'; c.fillRect(0, h * 0.88, bw2, h * 0.12);
    c.fillStyle = '#dd0000'; c.fillRect(bw2, h * 0.88, bw2, h * 0.12);
    c.fillStyle = '#ffce00'; c.fillRect(bw2 * 2, h * 0.88, bw2, h * 0.12);
    c.globalAlpha = 1;
  }}
];

/* Late-safe registration: worlds.js may load after us (same poll pattern as
 * worlds-pop.js). */
(function reg(attempt) {
  var W = root.IQ && root.IQ.Worlds;
  if (W && typeof W.register === 'function') {
    COUNTRIES.forEach(function (d) { W.register(d); });
    return;
  }
  if (attempt < 40 && typeof setTimeout === 'function') {
    setTimeout(function () { reg(attempt + 1); }, 50);
  }
})(0);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { packs: 6, worlds: COUNTRIES };
}
})();
