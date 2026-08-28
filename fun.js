/* IQ Battle: Shadow — fun.js
 * Gameplay-juice overlay. Presentation ONLY: no scoring, no game logic.
 * Loaded after shadow.js. Shell calls window.IQ.Fun.init(hooks) and feeds
 * events; everything degrades silently if this file or any dependency is
 * missing. All motion is CSS-class based and skipped under
 * prefers-reduced-motion.
 */
(function () {
  'use strict';
  var Fun = {};
  if (typeof window === 'undefined') return;
  var IQ = window.IQ = window.IQ || {};

  var H = null;            // active hooks {onAnswer,onRoundStart,onEmerald,getStage}
  var streak = 0;
  var lastHypeRound = 0;
  var glowTimer = null;
  var reduced = false;

  function stage() {
    try { var s = H && H.getStage && H.getStage(); return Math.max(0, Math.min(3, s | 0)); }
    catch (e) { return 0; }
  }

  function say(line) {
    try {
      if (line && IQ.Shadow && typeof IQ.Shadow.say === 'function') IQ.Shadow.say(line);
    } catch (e) { /* shadow unavailable */ }
  }

  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  /* ---------- CSS injection ---------- */
  var STYLE_ID = 'iq-fun-style';
  var CSS = [
    /* edge glow pulses on <body> */
    '.fun-hot{animation:iqfun-hot .4s ease-out}',
    '.fun-cold{animation:iqfun-cold .4s ease-out}',
    '@keyframes iqfun-hot{0%{box-shadow:inset 0 0 90px 12px rgba(0,230,138,.55)}100%{box-shadow:inset 0 0 90px 12px rgba(0,230,138,0)}}',
    '@keyframes iqfun-cold{0%{box-shadow:inset 0 0 90px 12px rgba(224,16,48,.55)}100%{box-shadow:inset 0 0 90px 12px rgba(224,16,48,0)}}',
    /* fallback banner when luxe.css .combo-pop is absent */
    '.iq-fun-banner{position:fixed;left:50%;top:42%;transform:translateX(-50%);z-index:65;' +
      'font-family:sans-serif;font-size:44px;font-weight:900;letter-spacing:.06em;' +
      'color:#00e68a;text-shadow:0 0 30px rgba(0,230,138,.5);pointer-events:none;' +
      'animation:iqfun-fly 1s forwards;white-space:nowrap}',
    '.iq-fun-banner.funnier{color:#ffd24a;text-shadow:0 0 30px rgba(255,210,74,.6)}',
    '@keyframes iqfun-fly{0%{opacity:0;transform:translateX(-50%) scale(.7)}15%{opacity:1;transform:translateX(-50%) scale(1.08)}30%{transform:translateX(-50%) scale(1)}80%{opacity:1}100%{opacity:0;transform:translateX(-50%) translateY(-40px)}}',
    /* emerald fanfare flash */
    '.iq-fun-flash{position:fixed;inset:0;z-index:64;pointer-events:none;background:#00e68a;opacity:0;}',
    '.iq-fun-flash.on{animation:iqfun-flash .45s ease-out forwards}',
    '@keyframes iqfun-flash{0%{opacity:.28}100%{opacity:0}}'
  ].join('\n');

  function injectCSS() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function hasComboPop() {
    try {
      if (!document.styleSheets) return false;
      for (var i = 0; i < document.styleSheets.length; i++) {
        var rules;
        try { rules = document.styleSheets[i].cssRules; } catch (e) { continue; }
        if (!rules) continue;
        for (var j = 0; j < rules.length; j++) {
          if (rules[j].selectorText && rules[j].selectorText.indexOf('.combo-pop') !== -1) return true;
        }
      }
    } catch (e) { /* opaque sheets */ }
    return false;
  }

  /* ---------- presentation helpers ---------- */

  // Banner text center-screen. Reuses .combo-pop when present, else own style.
  var _comboPopKnown = null;
  function banner(text, tier) {
    if (!text || reduced || typeof document === 'undefined') return;
    try {
      var d = document.createElement('div');
      if (_comboPopKnown === null) _comboPopKnown = hasComboPop();
      if (_comboPopKnown) {
        d.className = 'combo-pop' + (tier >= 2 ? ' funnier' : '');
        d.textContent = text;
        document.body.appendChild(d);
        setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 1100);
      } else {
        d.className = 'iq-fun-banner' + (tier >= 2 ? ' funnier' : '');
        d.textContent = text;
        document.body.appendChild(d);
        setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 1050);
      }
    } catch (e) { /* never break the shell */ }
  }

  // Brief full-body edge tint. cls: 'fun-hot' | 'fun-cold'.
  function edge(cls) {
    if (reduced || typeof document === 'undefined') return;
    try {
      var b = document.body;
      clearTimeout(glowTimer);
      b.classList.remove('fun-hot', 'fun-cold');
      // force reflow so re-triggering restarts the animation
      void b.offsetWidth;
      b.classList.add(cls);
      glowTimer = setTimeout(function () { b.classList.remove('fun-hot', 'fun-cold'); }, 420);
    } catch (e) { /* noop */ }
  }

  function screenFlash() {
    if (reduced || typeof document === 'undefined') return;
    try {
      var f = document.querySelector('.iq-fun-flash');
      if (!f) {
        f = document.createElement('div');
        f.className = 'iq-fun-flash';
        document.body.appendChild(f);
      }
      f.classList.remove('on');
      void f.offsetWidth;
      f.classList.add('on');
    } catch (e) { /* noop */ }
  }

  /* ---------- copy banks ---------- */

  var STREAKS = {
    3: { tier: 1, quips: ['Three in a row. The Shadow notices.', 'A small flame. Easily snuffed.', 'Warming up? Cute.'] },
    5: { tier: 2, quips: ['Five straight. I am paying attention now.', 'Your luck is a finite resource.', 'Keep going. I enjoy the buildup.'] },
    8: { tier: 3, quips: ['EIGHT. Fine. You have my full attention.', 'This streak ends tonight.', 'You are becoming... inconvenient.'] }
  };

  // stage-appropriate round-start hypes (rounds >= 3 only)
  var HYPES = [
    ['The grid shifts. So do the rules.', 'Round %R. The walls lean closer.', 'Deeper in. Fewer exit signs here.'],
    ['Stage two. The Shadow stops pretending.', '%R. The colors are wrong on purpose.', 'It watches between your answers now.'],
    ['Final depth. It is not playing fair either.', '%R. The room breathes with you.', 'Almost through. It hates that.']
  ];

  var EMERALD_QUIPS = [
    'An emerald. Shiny things distract mortals.',
    'That gem hums. Did you hear it too?',
    'Emerald claimed. The Shadow keeps count.',
    'Pretty. Fragile. Like your streak.'
  ];

  /* ---------- event handlers ---------- */

  function onAnswer(correct) {
    try {
      correct = !!correct;
      if (correct) {
        streak++;
        edge('fun-hot');
        var hit = STREAKS[streak];
        if (hit) {
          banner(streak + ' IN A ROW', hit.tier);
          say(pick(hit.quips));
        }
      } else {
        if (streak >= 3) say(pick(['There it goes. Your little streak.', 'Broken. As all mortal runs are.', 'And down it comes.']));
        else if (streak > 0 && stage() >= 2) say(pick(['Stumbled.', 'Not this one.', 'Wrong pane of glass.']));
        streak = 0;
        edge('fun-cold');
      }
    } catch (e) { /* noop */ }
  }

  function onRoundStart(round) {
    try {
      round = round | 0;
      if (round < 3) return;
      if (round <= lastHypeRound) return;   // max one hype per round
      lastHypeRound = round;
      var bank = HYPES[Math.min(stage(), 2)];
      var line = pick(bank).replace('%R', String(round));
      banner(line, stage() >= 3 ? 3 : 1);
    } catch (e) { /* noop */ }
  }

  function onEmerald(name) {
    try {
      screenFlash();
      var who = name ? (' ' + name) : '';
      say(pick(EMERALD_QUIPS) + who);
    } catch (e) { /* noop */ }
  }

  /* ---------- public API ---------- */

  Fun.init = function (hooks) {
    try {
      injectCSS();
      reduced = false;
      try {
        reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      } catch (e) { /* assume motion ok */ }
      H = hooks || {};
      Fun.reset();
      return true;
    } catch (e) { H = null; return false; }
  };

  Fun.reset = function () {
    try {
      streak = 0;
      lastHypeRound = 0;
      if (glowTimer) { clearTimeout(glowTimer); glowTimer = null; }
      if (typeof document !== 'undefined') {
        document.body.classList.remove('fun-hot', 'fun-cold');
      }
    } catch (e) { /* noop */ }
  };

  Fun.onAnswer = function (correct) { if (H && H.onAnswer !== undefined) onAnswer(correct); };
  Fun.onRoundStart = function (round) { if (H) onRoundStart(round); };
  Fun.onEmerald = function (name) { if (H) onEmerald(name); };

  IQ.Fun = Fun;
  Fun.onAnswer = function (correct) { try { if (!H) return; onAnswer(correct); } catch (e) { /* noop */ } };
  Fun.onRoundStart = function (round) { try { if (!H) return; onRoundStart(round); } catch (e) { /* noop */ } };
  Fun.onEmerald = function (name) { try { if (!H) return; onEmerald(name); } catch (e) { /* noop */ } };

})();

