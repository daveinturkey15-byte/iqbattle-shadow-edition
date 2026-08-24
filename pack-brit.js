/* ============================================================================
 * pack-brit.js — REMAKE ARMY B4: British-humour rounds + 'blighty' world
 * ============================================================================
 * Registers TWO things (hooks.js contract JSDoc):
 *   1. IQ.Hooks.add({ id:'pack-brit', worlds:['blighty'], ... })  — gameplay pack
 *   2. IQ.Worlds.register({ id:'blighty', ... })                  — backdrop world
 *
 * SPEC -> MECHANIC MAP
 *   SHOUTING BRITAIN .. onInterlude returns ONE bannerText drawn from a pool of
 *                       20 ALL-CAPS dry-understatement lines. Index comes from
 *                       ctx.rng ONLY => host/client parity.
 *   PINK CHAOS PICKLE . Rare round modifier (parody id 'pickle-chaos', seeded
 *                       8% roll at onRoundStart): body class 'iqb-pickle'
 *                       drives a harmless CSS-keyframe UI wobble — <=3px
 *                       translate on STRUCTURAL chrome (.board-zone /
 *                       #side-panel), NEVER on option buttons or glyph text;
 *                       plus a WebAudio squelch (IQB_MUTED-gated) and banner
 *                       'OH BLIMEY.' No gameplay effect whatsoever.
 *   CYCLISTS PELOTON .. Once per round: at a seeded fraction of timerLen we
 *                       TELEGRAPH with a 'ding ding' bicycle bell (WebAudio,
 *                       muted-gated) + banner, then 1s later an overlayHTML
 *                       strip (pointer-events:none) sweeps a peloton
 *                       silhouette left->right across exactly ONE ROW of the
 *                       options grid (~2s, overlayMs). Buttons stay fully
 *                       clickable underneath — pure occlusion theatre.
 *   THE QUEUE ......... Pure theatre: polite micro-banner on round start +
 *                       300ms staggered deal-in of option tiles (CSS
 *                       nth-child delays, motion-gated). Answering instantly
 *                       is always fine; nothing blocks input.
 *   WEATHER SMALLTALK . If >10s pass with no pick (presentation clock ONLY —
 *                       outcomes are never clock-derived), one neutral filler
 *                       banner ('Bit drizzly, innit.') fires once per round
 *                       from a seeded pool index.
 *
 * DETERMINISM: every outcome decision (pickle roll, peloton timing fraction,
 * occluded row, announcer/weather/queue indices) is drawn from ctx.rng in a
 * FIXED order at onRoundStart / onInterlude. performance.now() measures
 * presentation windows only (bell lead, idle threshold), matching the
 * pack-horror convention. No Math.random/Date.now anywhere.
 *
 * FAIRNESS RAILS: all animation behind IQB_MOTION (+ prefers-reduced-motion
 * media query as belt-and-braces); overlays pointer-events:none, never trap
 * Escape or focus, <=30% coverage; flashes none (no strobe at all); scoring
 * untouched (we return cosmetic modifiers only); one broken handler cannot
 * kill a round (dispatch try/catches). All affectionate parody — zero mockery
 * of real persons.
 * ============================================================================*/
(function () {
'use strict';
const root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};

/* ---------- gates ---------- */
function motionOK() {
  try {
    const v = root.localStorage && root.localStorage.getItem('IQB_MOTION');
    return v == null ? true : JSON.parse(v) !== false;
  } catch (e) { return true; }
}
function muted() {
  try {
    const v = root.localStorage && root.localStorage.getItem('IQB_MUTED');
    return v != null && JSON.parse(v) === true;
  } catch (e) { return false; }
}
function reducedMotion() {
  try {
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) { return false; }
}

/* ---------- monotonic presentation clock (never picks outcomes) ---------- */
function nowMs() {
  return (root.performance && typeof root.performance.now === 'function')
    ? root.performance.now() : 0;
}

/* ---------- WebAudio cues (own oscillators, IQB_MUTED-gated) ---------- */
function openCtx() {
  const AC = root.AudioContext || root.webkitAudioContext;
  if (!AC) return null;
  try { return new AC(); } catch (e) { return null; }
}
function tone(ac, t0, f0, f1, dur, type, vol) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(ac.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
/* bicycle bell: two bright 'ding ding' strikes, 1s before the peloton */
function dingDing() {
  if (muted()) return;
  const ac = openCtx(); if (!ac) return;
  try {
    const t = ac.currentTime + 0.02;
    tone(ac, t, 1568, 1175, 0.22, 'triangle', 0.11);
    tone(ac, t + 0.27, 1568, 1175, 0.22, 'triangle', 0.09);
  } finally { setTimeout(function () { try { ac.close(); } catch (e) {} }, 900); }
}
/* Blobby-esque squelch: three descending wet blips */
function squelch() {
  if (muted()) return;
  const ac = openCtx(); if (!ac) return;
  try {
    const t = ac.currentTime + 0.02;
    tone(ac, t, 300, 110, 0.13, 'sine', 0.12);
    tone(ac, t + 0.13, 240, 85, 0.15, 'sine', 0.11);
    tone(ac, t + 0.29, 190, 60, 0.19, 'sine', 0.10);
  } finally { setTimeout(function () { try { ac.close(); } catch (e) {} }, 1100); }
}

/* ---------- deterministic pools ---------- */
const ANNOUNCER = [
  'A REASONABLY OK ROUND AWAITS.',
  'MIND THE GAP. THERE IS ALWAYS A GAP.',
  'BRACE YOURSELVES. GENTLY.',
  'THE WEATHER REMAINS DISAPPOINTING. SO DO THE ODDS.',
  'PLEASE FORM AN ORDERLY QUEUE FOR KNOWLEDGE.',
  'IT COULD BE WORSE. IT ONCE WAS.',
  'A SPLENDID MEDIOCRITY AWAITS.',
  'KEEP CALM AND CARRY ON GUESSING.',
  'THE BAR IS ON THE FLOOR. DO TRY TO STEP OVER IT.',
  'TEA BREAK POSTPONED INDEFINITELY.',
  'STIFF UPPER LIP, LOOSE GRIP ON FACTS.',
  'NOT BAD FOR A TUESDAY.',
  'THE SPECTACLE CONTINUES. APOLOGIES.',
  'ROYAL APPROVAL PENDING. VERY PENDING.',
  'DRIZZLE ON. THE SHOW MUST GO ON.',
  'A ROUND OF APPLAUSE. OR AT LEAST OF QUESTIONS.',
  'EXCESSIVE ENTHUSIASM WILL BE NOTED WITH ALARM.',
  'YOUR CALL IS IMPORTANT TO US. YOUR ANSWER LESS SO.',
  'MILD PERIL AHEAD. SORRY ABOUT THAT.',
  'COMPUTER SAYS PERHAPS.'
];
const WEATHER = [
  'Bit drizzly, innit.',
  'Rather nippy out.',
  'Sun? Never heard of her.',
  'Typical. Rain again.',
  'Bit breezy — mind how you go.',
  'Grey skies, grey options.',
  'Muggy, if you ask me.',
  'Looks like rain. Probably.',
  'Cold snap coming. Or not.',
  'Weather continues, allegedly.'
];
const QUEUE = [
  'PLEASE QUEUE IN AN ORDERLY FASHION.',
  'MIND THE QUEUE. NO PUSHING.',
  'YOU ARE NUMBER ONE IN THE QUEUE. WELL DONE.'
];

const PS = 'pack-brit:';
const PICKLE_CHANCE = 0.08;

/* ---------- injected CSS ---------- */
let styleDone = false;
function ensureStyle() {
  if (styleDone || typeof document === 'undefined') return;
  styleDone = true;
  const st = document.createElement('style');
  st.id = 'iqb-pack-brit-style';
  st.textContent =
    /* THE QUEUE: 300ms staggered deal-in (armed ONLY by adding the class
     * while motionOK(); tiles fade/slide, never reflow — clicks unaffected) */
    '#opts-grid.iqb-brit-queue .opt-btn{animation:iqbQueueIn .26s ease-out both}' +
    '#opts-grid.iqb-brit-queue .opt-btn:nth-child(2){animation-delay:40ms}' +
    '#opts-grid.iqb-brit-queue .opt-btn:nth-child(3){animation-delay:80ms}' +
    '#opts-grid.iqb-brit-queue .opt-btn:nth-child(4){animation-delay:120ms}' +
    '#opts-grid.iqb-brit-queue .opt-btn:nth-child(5){animation-delay:160ms}' +
    '#opts-grid.iqb-brit-queue .opt-btn:nth-child(6){animation-delay:200ms}' +
    '#opts-grid.iqb-brit-queue .opt-btn:nth-child(7){animation-delay:240ms}' +
    '#opts-grid.iqb-brit-queue .opt-btn:nth-child(8){animation-delay:280ms}' +
    '@keyframes iqbQueueIn{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}' +
    /* PINK CHAOS PICKLE: gentle wobble on structural chrome ONLY — option
     * buttons and all glyph text stay perfectly still; <=3px translate */
    '@keyframes iqbPickleWobble{0%,100%{transform:translate(0,0)}' +
    '25%{transform:translate(2.5px,-1.5px)}50%{transform:translate(-2px,2px)}' +
    '75%{transform:translate(1.5px,-2.5px)}}' +
    'body.iqb-pickle .board-zone,body.iqb-pickle #side-panel{' +
    'animation:iqbPickleWobble 2.6s ease-in-out infinite;' +
    'box-shadow:0 0 26px rgba(255,105,180,.22)}' +
    /* CYCLISTS PELOTON sweep strip (mounted inside pointer-events:none rail) */
    '@keyframes iqbPelotonSweep{from{transform:translateX(-130%)}to{transform:translateX(430%)}}' +
    '.iqb-peloton{position:absolute;left:0;top:0;height:100%;width:34%;' +
    'will-change:transform;animation:iqbPelotonSweep 2s linear forwards}' +
    '@media (prefers-reduced-motion: reduce){' +
    '#opts-grid.iqb-brit-queue .opt-btn,' +
    'body.iqb-pickle .board-zone,body.iqb-pickle #side-panel,' +
    '.iqb-peloton{animation:none!important}}';
  const head = document.head || document.getElementsByTagName('head')[0];
  if (head) head.appendChild(st);
}

/* ---------- round plan (per-match store, prefixed keys) ---------- */
function getPlan() { return root.IQ.Hooks.state.get(PS + 'plan'); }
function setPlan(p) { root.IQ.Hooks.state.set(PS + 'plan', p); }

/* ---------- peloton strip over exactly one row of option buttons ---------- */
function rider(x) {
  return '<g transform="translate(' + x + ',0)" stroke="rgba(9,13,26,.88)" ' +
    'stroke-width="3" fill="none" stroke-linecap="round">' +
    '<circle cx="20" cy="48" r="12"/><circle cx="54" cy="48" r="12"/>' +
    '<path d="M20 48 L33 29 L49 29 L54 48 M33 29 L39 45"/>' +
    '<path d="M31 28 Q37 12 48 17" stroke-width="6"/>' +
    '<circle cx="49" cy="12" r="5.5" fill="rgba(9,13,26,.88)" stroke="none"/>' +
    '</g>';
}
function pelotonHTML(rowIdx) {
  if (typeof document === 'undefined' || !motionOK() || reducedMotion()) return '';
  const btns = document.querySelectorAll('#opts-grid .opt-btn');
  if (!btns || btns.length < 4) return '';
  let top = Infinity, bot = -Infinity;
  for (let i = 0; i < btns.length; i++) {
    if (Math.floor(i / 4) !== rowIdx) continue;
    const r = btns[i].getBoundingClientRect();
    top = Math.min(top, r.top); bot = Math.max(bot, r.bottom);
  }
  if (!isFinite(top) || bot - top < 8) return '';
  const svg = '<svg width="100%" height="100%" viewBox="0 0 360 64" ' +
    'preserveAspectRatio="xMidYMid meet">' +
    rider(0) + rider(90) + rider(180) + rider(270) + '</svg>';
  return '<div style="position:fixed;left:0;top:' + Math.round(top) + 'px;width:100%;' +
    'height:' + Math.round(bot - top) + 'px;overflow:hidden;pointer-events:none">' +
    '<div class="iqb-peloton">' + svg + '</div></div>';
}

/* ---------- class cleanup (idempotent, never throws) ---------- */
function cleanupDom() {
  if (typeof document === 'undefined') return;
  try {
    document.body.classList.remove('iqb-pickle');
    const og = document.getElementById('opts-grid');
    if (og) og.classList.remove('iqb-brit-queue');
  } catch (e) {}
}

/* ============================================================================ */
/* THE PACK                                                                     */
/* ============================================================================ */
const PACK = {
  id: 'pack-brit',
  worlds: ['blighty'],
  weight: 2,
  handlers: {

    /* Round plan: four FIXED-ORDER ctx.rng draws => identical host/client. */
    onRoundStart: function (ctx) {
      ensureStyle();
      cleanupDom();
      if (!ctx || typeof ctx.rng !== 'function') return null;

      const rPickle = ctx.rng();
      const rFrac = ctx.rng();
      const rRow = ctx.rng();
      const rWx = ctx.rng();

      const timerLen = Math.max(5, (ctx.timerLen | 0) || 45);
      const pelotonDelay = Math.round((0.22 + 0.38 * rFrac) * timerLen * 1000);
      const start = nowMs();

      setPlan({
        pickle: rPickle < PICKLE_CHANCE,
        bellDelay: Math.max(1200, pelotonDelay - 1000),
        pelotonDelay: pelotonDelay,
        rowIdx: rRow < 0.5 ? 0 : 1,
        wxIdx: Math.floor(rWx * WEATHER.length) % WEATHER.length,
        startMs: start,
        lastMs: start,
        bellDone: false,
        pelotonDone: false,
        weatherDone: false
      });

      /* THE QUEUE — theatre only: polite banner + staggered tile deal-in */
      let flag = 'pack-brit:queue';
      let banner = QUEUE[(((ctx.round | 0) - 1) % QUEUE.length + QUEUE.length) % QUEUE.length];

      /* PINK CHAOS PICKLE — rare harmless round flavour */
      if (getPlan().pickle) {
        flag = 'pack-brit:pickle-chaos';
        banner = 'OH BLIMEY.';
        if (motionOK() && typeof document !== 'undefined') {
          try { document.body.classList.add('iqb-pickle'); } catch (e) {}
        }
        squelch();
      }

      /* queue deal-in (skipped silently when motion is off — banner remains) */
      if (motionOK() && !reducedMotion() && typeof document !== 'undefined') {
        try {
          const og = document.getElementById('opts-grid');
          if (og) { og.classList.remove('iqb-brit-queue'); void og.offsetWidth; og.classList.add('iqb-brit-queue'); }
        } catch (e) {}
      }

      return { bannerText: banner, flag: flag };
    },

    /* Peloton telegraph/cross + idle weather. Timing = presentation only;
     * WHAT happens was already sealed by ctx.rng at onRoundStart. */
    onTick: function () {
      const p = getPlan();
      if (!p) return null;
      const now = nowMs();
      const el = now - p.startMs;

      if (!p.bellDone && el >= p.bellDelay) {
        p.bellDone = true;
        dingDing();
        return { bannerText: 'DING DING \u2014 MIND THE CYCLISTS', flag: 'pack-brit:bell' };
      }

      if (!p.pelotonDone && el >= p.pelotonDelay) {
        p.pelotonDone = true;
        const html = pelotonHTML(p.rowIdx);
        if (html) {
          return {
            overlayHTML: html,
            overlayMs: 2400,
            bannerText: 'PELOTON COMING THROUGH \u2014 DO MIND THE PAINTWORK',
            flag: 'pack-brit:peloton'
          };
        }
        return null;
      }

      if (!p.weatherDone && (now - p.lastMs) >= 10000) {
        p.weatherDone = true;
        return { bannerText: WEATHER[p.wxIdx], flag: 'pack-brit:weather' };
      }
      return null;
    },

    onPreAnswer: function () {
      const p = getPlan();
      if (p) p.lastMs = nowMs();
      return null;
    },

    onAnswer: function () {
      const p = getPlan();
      if (p) p.lastMs = nowMs();
      return null;
    },

    onReveal: function () {
      cleanupDom();
      return null;
    },

    /* SHOUTING BRITAIN — dry understatement, ALL CAPS, seeded pick */
    onInterlude: function (ctx) {
      cleanupDom();
      if (!ctx || typeof ctx.rng !== 'function') return null;
      const i = Math.floor(ctx.rng() * ANNOUNCER.length) % ANNOUNCER.length;
      return { bannerText: ANNOUNCER[i], flag: 'pack-brit:announcer' };
    }
  }
};

/* ============================================================================
 * WORLD 'blighty' — drizzle sky, faint saltire beams, rolling hills
 * (static frame when IQB_MOTION is off; vignette keeps text zones readable)
 * ============================================================================ */
const Worlds = root.IQ.Worlds;
if (Worlds && typeof Worlds.register === 'function') {
  Worlds.register({
    id: 'blighty',
    align: 'neutral',
    pal: ['#0a1430', '#12234c', '#1a3050', '#e8ecf4', '#c23b4e', '#0d2018', '#7fa8c9', '#d8d2c4'],
    draw: function (c, w, h, t) {
      const tt = motionOK() ? t : 0;

      /* drizzle sky */
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#0a1430'); g.addColorStop(0.55, '#12234c'); g.addColorStop(1, '#1a3050');
      c.fillStyle = g; c.fillRect(0, 0, w, h);

      /* abstract saltire beams (faint white over red — flag-flavoured, calm) */
      c.save();
      c.lineWidth = h * 0.085; c.strokeStyle = '#e8ecf4'; c.globalAlpha = 0.05;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(w, h); c.moveTo(w, 0); c.lineTo(0, h); c.stroke();
      c.lineWidth = h * 0.028; c.strokeStyle = '#c23b4e'; c.globalAlpha = 0.06;
      c.stroke();
      c.restore();

      /* rolling hills: two parallax silhouettes drifting very slowly */
      for (let layer = 0; layer < 2; layer++) {
        const amp = h * (0.035 + 0.02 * layer);
        const base = h * (0.78 + 0.09 * layer);
        const spd = 0.04 + 0.03 * layer;
        c.fillStyle = layer === 0 ? '#10281c' : '#0d2018';
        c.beginPath(); c.moveTo(0, h);
        for (let x = 0; x <= w; x += Math.max(8, w / 24)) {
          const y = base - amp * (0.6 + 0.4 * Math.sin(spd * tt + x / w * Math.PI * 3 + layer * 2.1));
          c.lineTo(x, y);
        }
        c.lineTo(w, h); c.closePath(); c.fill();
      }

      /* drizzle streaks (falling fast, whisper-faint; static when motion off) */
      c.strokeStyle = 'rgba(216,210,196,.12)'; c.lineWidth = 1;
      for (let i = 0; i < 42; i++) {
        const x = (i * 131 + 37) % w;
        const y = ((tt * 150) + i * 149) % (h + 60) - 30;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x - 2, y + 11); c.stroke();
      }

      /* vignette keeps puzzle text zones calm and readable */
      const v = c.createRadialGradient(w / 2, h * 0.42, Math.min(w, h) * 0.30, w / 2, h * 0.42, Math.max(w, h) * 0.75);
      v.addColorStop(0, 'rgba(6,10,24,0)');
      v.addColorStop(1, 'rgba(6,10,24,.58)');
      c.fillStyle = v; c.fillRect(0, 0, w, h);
    }
  });
}

/* ---------- registration (queues onto __hooksPending if HooksCore lags) ---- */
function register() {
  const H = root.IQ && root.IQ.Hooks;
  if (H && typeof H.add === 'function') { H.add(PACK); return true; }
  (root.IQ.__hooksPending = root.IQ.__hooksPending || []).push(PACK);
  return false;
}
register();

/* tiny introspection surface (tests/debug only — no gameplay authority) */
root.IQ.PackBrit = { id: PACK.id, prefix: PS, ANNOUNCER: ANNOUNCER, WEATHER: WEATHER, QUEUE: QUEUE };

if (typeof module !== 'undefined' && module.exports) module.exports = root.IQ.PackBrit;
})();
