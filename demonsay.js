/* demonsay.js — IQ.DemonSay: Shadow's dialogue banner. CENTRAL + HIGH + LARGE.
   Fixed banner top:14px centered; 'SHADOW' tag + mini original SVG hedgehog;
   huge white/crimson-glow type; typewriter cadence; replace-not-stack. */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;

  var TYPE_MS = 22;          // ms per character
  var HOLD_MS = 4500;        // dismiss delay after typing completes

  /* --- Speech budget (research/chaos-balance.md §5) ---
     Shell passes no timer info, so "never speak in the last 5 s of a round" is
     approximated by a >=8 s time-since-last-say throttle. Round budget: max
     1 speech per 2 rounds before stage 3, every round allowed at stage 3.
     Same-round priority arbitration: impossible > emerald > streak > ambient. */
  var THROTTLE_MS = 8000;    // min gap between any two speeches (~ last-5s guard)
  var DEDUPE_MS = 30000;     // identical text within 30 s is always suppressed
  var PRIORITY = { impossible: 4, emerald: 3, streak: 2, ambient: 1 };
  var lastSayAt = -Infinity;
  var recent = [];           // [{ text, at }] for 30 s dedupe
  var roundInfo = null;      // { round, stage } via noteRound()
  var spoken = [];           // [{ round, prio }] recent speech placements

  /* Built-in fallback pools (Shadow-paraphrase, original fan-art persona only). */
  var FALLBACK = {
    appear: [
      "The ultimate lifeform has arrived.",
      "I sensed weakness. So I came.",
      "You called? Regret it.",
      "This ends the way I decide it does.",
      "Fear not. Fear me."
    ],
    zap: [
      "Chaos control. Your points, gone.",
      "That looked expensive. Good.",
      "Lightning is my love language.",
      "I steal only the finest scores."
    ],
    wrong: [
      "Wrong. Shocking.",
      "Bold. Confident. Deeply incorrect.",
      "Even the rock guessed better.",
      "Incorrect. As foretold."
    ],
    right: [
      "Correct. Don't get comfortable.",
      "Hmph. Lucky. Probably.",
      "Acceptable. Barely.",
      "Impressive. For a mortal with Wi-Fi."
    ],
    taunt: [
      "You can't outrun a shadow.",
      "Where there is light, I am its end.",
      "Struggle. It amuses me.",
      "Your despair is my favorite rhythm.",
      "I am all lives. And your deadline.",
      "This is who I am. Remember it.",
      "Chaos is fair. You are not owed fairness.",
      "Run home. Or run here. Either way you lose."
    ]
  };

  /* Mini original SVG hedgehog avatar — original fan art, no SEGA assets. */
  var AVATAR_SVG =
    '<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" focusable="false">' +
    '<path d="M16 3l4 5 6-2-2 6 6 3-6 4 2 7-7-3-3 6-3-6-7 3 2-7-6-4 6-3-2-6 6 2z" fill="#141018" stroke="#c8102e" stroke-width="1.4"/>' +
    '<circle cx="12" cy="15" r="2.1" fill="#e01030"/><circle cx="20" cy="15" r="2.1" fill="#e01030"/>' +
    '<circle cx="12" cy="15" r=".8" fill="#fff"/><circle cx="20" cy="15" r=".8" fill="#fff"/>' +
    '<path d="M13.5 21q2.5 2 5 0" stroke="#c8102e" stroke-width="1.3" fill="none" stroke-linecap="round"/>' +
    '<path d="M9 9l3 3M23 9l-3 3" stroke="#c8102e" stroke-width="1.6" stroke-linecap="round"/></svg>';

  var CSS_ID = 'iqDemonSayCSS';
  var CSS = [
    '#iqDemonSay{position:fixed;top:14px;left:50%;transform:translateX(-50%);',
    'max-width:94vw;z-index:2147000000;display:flex;flex-direction:column;align-items:center;',
    'gap:4px;padding:10px 18px;border-radius:14px;background:rgba(8,4,10,.88);',
    'border:1px solid rgba(200,16,46,.55);box-shadow:0 0 24px rgba(200,16,46,.35),0 8px 30px rgba(0,0,0,.6);',
    'font-family:"Segoe UI",system-ui,sans-serif;text-align:center;pointer-events:none;',
    'opacity:0;transition:opacity .25s ease;}',
    '#iqDemonSay.on{opacity:1;}',
    '.iqds-head{display:flex;align-items:center;gap:8px;}',
    '.iqds-tag{font-size:12px;font-weight:800;letter-spacing:.22em;font-variant:small-caps;color:#ff2740;',
    'text-shadow:0 0 8px rgba(200,16,46,.9);}',
    '.iqds-title{font-size:clamp(18px,3vw,26px);font-weight:900;color:#fff;',
    'text-shadow:0 0 10px rgba(200,16,46,.95),0 0 26px rgba(200,16,46,.6);letter-spacing:.08em;}',
    '.iqds-text{font-size:clamp(24px,5.5vw,40px);font-weight:900;line-height:1.12;color:#fff;',
    'text-shadow:0 0 12px rgba(200,16,46,.95),0 0 34px rgba(200,16,46,.65);} ',
    '#iqDemonSay.tier2 .iqds-text{text-shadow:0 0 12px rgba(200,16,46,.95),0 0 30px rgba(40,255,140,.75);} ',
    '#iqDemonSay.tier2{border-color:rgba(40,255,140,.6);box-shadow:0 0 26px rgba(200,16,46,.45),0 0 40px rgba(40,255,140,.3);}',
    '@media (prefers-reduced-motion:reduce){#iqDemonSay{transition:none;}}'
  ].join('');

  var el = null;
  var typeTimer = null;
  var holdTimer = null;

  function safe(fn) { try { fn(); } catch (e) { /* banner must never break the game */ } }

  function inject() {
    var doc = root.document;
    if (!doc || doc.getElementById(CSS_ID)) return;
    var s = doc.createElement('style');
    s.id = CSS_ID;
    s.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }

  function reducedMotion() {
    return root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function ensureEl() {
    inject();
    if (el && el.isConnected) return el;
    el = root.document.createElement('div');
    el.id = 'iqDemonSay';
    el.setAttribute('role', 'status');
    el.innerHTML =
      '<div class="iqds-head"><span class="iqds-avatar">' + AVATAR_SVG + '</span>' +
      '<span class="iqds-tag">Shadow</span></div>' +
      '<div class="iqds-text"></div>';
    (root.document.body || root.document.documentElement).appendChild(el);
    return el;
  }

  function clearTimers() {
    if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  }

  /* --- Budget helpers --- */
  function normPriority(opts) {
    return opts && PRIORITY[opts.priority] ? opts.priority : 'ambient';
  }
  function spokeIn(rnd) {
    var best = null;
    for (var i = 0; i < spoken.length; i++) {
      var s = spoken[i];
      if (s.round === rnd && (!best || PRIORITY[s.prio] > PRIORITY[best.prio])) best = s;
    }
    return best;
  }
  function budgetAllows(prio, t) {
    if (t - lastSayAt < THROTTLE_MS) return false;           // >=8 s since last say
    if (!roundInfo) return true;                             // no round info: throttle-only
    var same = spokeIn(roundInfo.round);
    if (same) return PRIORITY[prio] > PRIORITY[same.prio];   // arbitration within round
    if (roundInfo.stage < 3 && prio !== 'impossible' && spokeIn(roundInfo.round - 1)) return false; // 1 per 2 rounds pre-stage-3 (impossible always speaks, §4)
    return true;
  }
  function noteSpeech(prio, t) {
    lastSayAt = t;
    spoken.push({ round: roundInfo ? roundInfo.round : -1, prio: prio });
    if (spoken.length > 4) spoken.shift();
  }
  /* Public: show one line. Replaces whatever was showing. */
  function say(text, opts) {
    opts = opts || {};
    var full = String(text == null ? '' : text);
    var t = Date.now();
    var prio = normPriority(opts);
    var d;
    for (d = 0; d < recent.length; d++) {
      if (recent[d].text === full && t - recent[d].at < DEDUPE_MS) return false; // dedupe
    }
    if (!opts.force && !budgetAllows(prio, t)) return false;
    noteSpeech(prio, t);
    recent.push({ text: full, at: t });
    if (recent.length > 16) recent.shift();
    var box = ensureEl();
    clearTimers();

    box.classList.toggle('tier2', opts.tier === 2);
    if (opts.tier === 2 && root.IQ && root.IQ.Chaos && typeof root.IQ.Chaos.shake === 'function') {
      safe(function () { root.IQ.Chaos.shake(10, 420); });
    }
    var head = box.querySelector('.iqds-head');
    head.style.display = opts.title ? 'none' : '';
    var titleEl = box.querySelector('.iqds-title');
    if (!titleEl && opts.title) {
      titleEl = root.document.createElement('div');
      titleEl.className = 'iqds-title';
      head.parentNode.insertBefore(titleEl, head);
    }
    if (titleEl) {
      titleEl.textContent = opts.title || '';
      titleEl.style.display = opts.title ? '' : 'none';
    }

    var out = box.querySelector('.iqds-text');
    void out.offsetWidth; // restart fade
    box.classList.add('on');

    if (reducedMotion()) {
      out.textContent = full;
      holdTimer = setTimeout(hide, HOLD_MS);
      return true;
    }
    var i = 0;
    out.textContent = '';
    typeTimer = setInterval(function () {
      i++;
      out.textContent = full.slice(0, i);
      if (i >= full.length) {
        clearInterval(typeTimer);
        typeTimer = null;
        holdTimer = setTimeout(hide, HOLD_MS);
      }
    }, TYPE_MS);
    return true;
  }

  /* Public: big announcement line ("STAGE 3", etc.) above the text. */
  function announce(title, text) {
    say(text || '', { title: title, tier: 2, force: true }); // stage-entry lines are mandatory/uncounted (§5)
  }

  function hide() {
    clearTimers();
    if (el) el.classList.remove('on');
  }

  /* Pool access: Content.shadowQuips when loaded, built-ins otherwise. */
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function pool(name) {
    var q = root.IQ && root.IQ.Content && root.IQ.Content.shadowQuips;
    if (q && q[name] && q[name].length) return q[name];
    return FALLBACK[name] || FALLBACK.taunt;
  }
  function sayPool(name, opts) { say(pick(pool(name)), opts); }

  root.IQ = root.IQ || {};
  root.IQ.DemonSay = {
    say: say,
    announce: announce,
    pool: pool,
    sayPool: sayPool,
    /* Budget API: shell calls noteRound(round, stage) each deal; reset() at startRun. */
    noteRound: function (round, stage) {
      roundInfo = { round: Math.floor(Number(round) || 0), stage: Math.floor(Number(stage) || 0) };
    },
    reset: function () {
      lastSayAt = -Infinity;
      recent.length = 0;
      spoken.length = 0;
      roundInfo = null;
    },
    _fallback: FALLBACK
  };
})();
