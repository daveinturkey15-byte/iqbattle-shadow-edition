/* IQ.Cleanse — "HIP TO BE SQUARE" cleanser rounds for IQ BATTLE: SHADOW.
   Rare one-round relief valve (stage 2+): forces the bright baseline palette
   over all corr/act corruption, then snaps back with a glitch. Pure CSS
   self-injection; reduced-motion safe; never throws. */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var IQ = root.IQ || (root.IQ = {});

  var CSS_ID = 'iq-cleanse-style';
  var CSS = [
    'body.cleanse{',
      '--bg:#eef1f6;--acc-a:#3f7dff;--acc-b:#b84cff;',
      'background:#eef1f6 !important;color:#101828;}',
    /* strip every corruption layer the act/corr stages apply */
    'body.cleanse, body.cleanse #app, body.cleanse #fx-vignette{',
      'animation:none !important;filter:none !important;',
      'text-shadow:none !important;box-shadow:none !important;}',
    '#iqChaosFx .iq-scanlines, #iq-shadow-bubbles{opacity:0 !important;}',
    'body.cleanse #app{transition:background .4s ease,color .4s ease;}',
    /* banner */
    '.iq-cleanse-banner{',
      'position:fixed;top:9vh;left:50%;transform:translateX(-50%);z-index:9000;',
      'text-align:center;pointer-events:none;font-family:sans-serif;',
      'animation:iqcl-in .45s ease both;}',
    '.iq-cleanse-banner h1{',
      'margin:0;font-size:min(7vw,52px);font-weight:900;letter-spacing:.06em;',
      'color:#101828;text-transform:uppercase;',
      'background:linear-gradient(90deg,#3f7dff,#b84cff);-webkit-background-clip:text;background-clip:text;color:transparent;}',
    '.iq-cleanse-banner p{',
      'margin:8px 0 0;font-size:14px;letter-spacing:.14em;color:#3a4664;}',
    '@keyframes iqcl-in{from{opacity:0;transform:translate(-50%,-14px)}to{opacity:1;transform:translate(-50%,0)}}',
    '@media (prefers-reduced-motion: reduce){',
      '.iq-cleanse-banner{animation:none;opacity:1;transform:translateX(-50%)}}'
  ].join('');

  var state = { active: false, lastRound: -99, count: 0, maxRoundSeen: 0, bannerEl: null };

  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }

  function injectCss(doc) {
    safe(function () {
      doc = doc || document;
      if (!doc.getElementById(CSS_ID)) {
        var s = doc.createElement('style');
        s.id = CSS_ID;
        s.textContent = CSS;
        doc.head.appendChild(s);
      }
    });
  }
  injectCss();

  function reducedMotion() {
    return safe(function () {
      return typeof root.matchMedia === 'function' &&
        root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }) || false;
  }

  function shadowSay(text) {
    safe(function () {
      if (IQ.Shadow && IQ.Shadow.say) IQ.Shadow.say(text, { voice: false }); // no TTS
    });
  }

  /* ---- trigger gate: s>=2, .25/round, pity-force at gap>=6, no consecutive,
         cap 2/run (<=12 rounds) or 3/run (13+) — chaos-balance.md §2 ---- */
  var RATE = 0.25;
  var PITY_GAP = 6;

  function maybeTrigger(stage, round, totalRounds) {
    if (state.active) return false;
    if ((stage | 0) < 2) return false;
    round |= 0;
    var seen = totalRounds !== undefined ? +totalRounds : Math.max(round, state.maxRoundSeen);
    if (round > state.maxRoundSeen) state.maxRoundSeen = round;
    var cap = seen >= 13 ? 3 : 2;
    if (state.count >= cap) return false;
    if (round <= state.lastRound) return false;            // same/earlier round replay
    if (round === state.lastRound + 1) return false;       // never consecutive
    var gap = round - (state.lastRound === -99 ? 0 : state.lastRound);
    if (gap < PITY_GAP && Math.random() >= RATE) return false; // pity forces at gap >= PITY_GAP
    state.active = true;
    state.lastRound = round | 0;
    state.count++;
    safe(function () {
      injectCss();
      document.body.classList.add('cleanse');
      var b = document.createElement('div');
      b.className = 'iq-cleanse-banner';
      b.setAttribute('role', 'status');
      var h = document.createElement('h1');
      h.textContent = 'HIP TO BE SQUARE';
      var p = document.createElement('p');
      p.textContent = 'a gift from Shadow. enjoy it while it lasts.';
      b.appendChild(h); b.appendChild(p);
      document.body.appendChild(b);
      state.bannerEl = b;
    });
    return true;
  }

  function removeBanner() {
    safe(function () {
      if (state.bannerEl && state.bannerEl.parentNode) state.bannerEl.parentNode.removeChild(state.bannerEl);
      state.bannerEl = null;
    });
  }

  /* ---- round end: 300ms glitch snap + Shadow line, cleanse off ---- */
  function end() {
    if (!state.active) return;
    state.active = false;
    removeBanner();
    safe(function () {
      document.body.classList.remove('cleanse');
      if (!reducedMotion() && IQ.Chaos && IQ.Chaos.glitch) IQ.Chaos.glitch(300);
    });
    shadowSay('back to my world.');
  }

  /* ---- new run: wipe counters and any stale visual state ---- */
  function reset() {
    state.active = false;
    state.lastRound = -99;
    state.maxRoundSeen = 0;
    state.count = 0;
    removeBanner();
    safe(function () { document.body.classList.remove('cleanse'); });
  }

  Object.defineProperty(IQ, 'Cleanse', {
    value: {
      maybeTrigger: maybeTrigger,
      end: end,
      reset: reset,
      get active() { return state.active; },
      get triggersLeft() { return Math.max(0, 2 - state.count); }
    },
    writable: true,
    configurable: true
  });

  if (typeof module !== 'undefined' && module.exports) module.exports = IQ.Cleanse;
})();
