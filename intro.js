/* intro.js — IQ.Intro: boot-sequence film.
   First load per browser session (sessionStorage IQB_INTRO_SEEN): black ->
   emerald glow -> 'IQ' fade -> 'BATTLE' slam+shake -> typed subtitle -> card.
   Stage-3 returns replay a corrupted variant: crimson glow, glitch slam.
   Skippable on tap/keypress. Injected CSS. reduced-motion = simple fade. */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;

  var SEEN_KEY = 'IQB_INTRO_SEEN';

  /* Beats (ms offsets from film start) — normal / corrupted. */
  var T = {
    black:   [0,    0],
    glow:    [250,  150],
    iq:      [1000, 650],
    battle:  [1650, 1150],
    subType: [2250, 1600],
    card:    [3600, 2700],
    hold:    [1400, 1100]   // extra dwell once card is up, then dissolve
  };

  var SUB_NORMAL = 'abstract reasoning · corrupted';
  var SUB_CORRUPT = 'he remembers what you forgot';

  var CSS_ID = 'iqIntroCSS';
  var CSS = [
    '#iqIntro{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;',
    'align-items:center;justify-content:center;background:#000;opacity:1;',
    'transition:opacity .5s ease;font-family:inherit;-webkit-user-select:none;user-select:none;cursor:pointer}',
    '#iqIntro.iq-out{opacity:0;pointer-events:none}',
    '#iqIntro .iq-glow{position:absolute;width:46vmin;height:46vmin;border-radius:50%;',
    'filter:blur(30px);opacity:0;transform:scale(.4);',
    'background:radial-gradient(circle,#00e68a33 0%,#00e68a11 45%,transparent 70%);',
    'transition:opacity 1.1s ease,transform 1.4s cubic-bezier(.2,.7,.3,1)}',
    '#iqIntro.corr .iq-glow{background:radial-gradient(circle,#e0103044 0%,#e0103015 45%,transparent 70%)}',
    '#iqIntro .iq-glow.on{opacity:1;transform:scale(1.15)}',
    '#iqIntro .iq-logo{position:relative;display:flex;align-items:baseline;gap:.22em;',
    'font-weight:900;letter-spacing:.06em;line-height:1;color:#f2f6f4}',
    '#iqIntro.corr .iq-logo{color:#ffe9ee}',
    '#iqIntro .iq-iq{font-size:17vmin;opacity:0;transition:opacity .8s ease;',
    'text-shadow:0 0 26px #00e68a66}',
    '#iqIntro.corr .iq-iq{text-shadow:0 0 26px #e0103088}',
    '#iqIntro .iq-iq.on{opacity:1}',
    '#iqIntro .iq-battle{font-size:9vmin;color:#00e68a;text-shadow:0 0 18px #00e68a55}',
    '#iqIntro.corr .iq-battle{color:#ff2447;text-shadow:2px 0 #00e5ff,-2px 0 #ff0033}',
    '@keyframes iqSlam{0%{opacity:0;transform:scale(3.2)}55%{opacity:1;transform:scale(.94)}75%{transform:scale(1.05)}100%{transform:scale(1)}}',
    '@keyframes iqGlitchSlam{0%{opacity:0;transform:scale(3.2) translateX(-6%) skewX(14deg)}',
    '18%{opacity:1;transform:scale(.92) translateX(5%) skewX(-10deg)}',
    '34%{transform:scale(1.08) translateX(-3%)}50%{transform:scale(.97) translateX(2%) skewX(4deg)}',
    '70%{transform:scale(1.03)}100%{transform:scale(1) translateX(0) skewX(0)}}',
    '@keyframes iqShake{0%,100%{transform:translate(0,0)}20%{transform:translate(-9px,4px)}40%{transform:translate(7px,-5px)}60%{transform:translate(-5px,2px)}80%{transform:translate(4px,-2px)}}',
    '@keyframes iqFlicker{0%,100%{opacity:1}42%{opacity:1}44%{opacity:.25}46%{opacity:1}71%{opacity:1}72%{opacity:.4}73%{opacity:1}}',
    '#iqIntro .iq-battle.slam{animation:iqSlam .38s cubic-bezier(.2,.9,.3,1) both,iqShake .32s ease-out .3s}',
    '#iqIntro.corr .iq-battle.slam{animation:iqGlitchSlam .5s steps(12,end) both,iqShake .38s ease-out .38s,iqFlicker 1.4s linear .6s infinite}',
    '#iqIntro .iq-sub{margin-top:2.2vmin;font-size:min(3.4vmin,15px);letter-spacing:.34em;',
    'text-transform:uppercase;color:#9fb3ab;min-height:1.4em;white-space:pre-wrap}',
    '#iqIntro.corr .iq-sub{color:#d98a99}',
    '#iqIntro .iq-sub::after{content:"▌";animation:iqCaret 1s steps(1) infinite;margin-left:2px}',
    '@keyframes iqCaret{50%{opacity:0}}',
    '#iqIntro.done-typing .iq-sub::after{animation:none;opacity:0}',
    '#iqIntro .iq-card{margin-top:5vmin;padding:12px 26px;border:1px solid #00e68a44;',
    'border-radius:10px;background:#04140c99;font-size:11px;letter-spacing:.3em;',
    'text-transform:uppercase;color:#cfe6da;opacity:0;transform:translateY(14px);',
    'transition:opacity .6s ease,transform .6s ease}',
    '#iqIntro.corr .iq-card{border-color:#e0103055;background:#18040899;color:#f0c9d1}',
    '#iqIntro .iq-card.on{opacity:1;transform:translateY(0)}',
    '@media (prefers-reduced-motion: reduce){',
    '#iqIntro .iq-glow{transition:none}',
    '#iqIntro .iq-battle.slam,#iqIntro.corr .iq-battle.slam{animation:none;transition:opacity .4s ease}',
    '#iqIntro.corr .iq-battle.slam{text-shadow:0 0 18px #e0103088}',
    '}'
  ].join('');

  var el = null, timers = [], typing = null;

  function safe(fn) { try { fn(); } catch (e) { /* intro must never block boot */ } }
  function inject() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style'); s.id = CSS_ID; s.textContent = CSS;
    document.head.appendChild(s);
  }
  function reducedMotion() {
    return root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function clearTimers() {
    timers.forEach(clearTimeout); timers = [];
    if (typing) { clearInterval(typing.iv); typing = null; }
  }
  function sessionSeen() {
    try { return !!root.sessionStorage.getItem(SEEN_KEY); } catch (e) { return false; }
  }
  function markSeen() {
    try { root.sessionStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* private mode */ }
  }

  function buildDom(corrupt) {
    el = document.createElement('div');
    el.id = 'iqIntro';
    if (corrupt) el.className = 'corr';
    el.setAttribute('role', 'presentation');
    el.innerHTML =
      '<div class="iq-glow"></div>' +
      '<div class="iq-logo"><span class="iq-iq">IQ</span><span class="iq-battle">BATTLE</span></div>' +
      '<div class="iq-sub"></div>' +
      '<div class="iq-card">' + (corrupt ? 'no way back' : 'tap to begin') + '</div>';
    document.body.appendChild(el);
  }

  function typeSubtitle(text, startAt, cps) {
    var node = el.querySelector('.iq-sub'), i = 0;
    later(function () {
      typing = { iv: setInterval(function () {
        node.textContent = text.slice(0, ++i);
        if (i >= text.length) { clearInterval(typing.iv); typing = null; el.classList.add('done-typing'); }
      }, Math.round(1000 / cps)) };
    }, startAt);
  }

  function dissolve(done) {
    if (!el || el.classList.contains('iq-out')) return;
    clearTimers();
    el.classList.add('iq-out');
    setTimeout(function () {
      safe(function () { if (el && el.parentNode) el.parentNode.removeChild(el); });
      el = null;
      safe(done);
    }, 520);
  }

  function skipToCard(corrupt, done) {
    if (!el || el.classList.contains('done')) return;
    clearTimers();
    el.classList.add('done', 'done-typing');
    el.querySelector('.iq-glow').classList.add('on');
    el.querySelector('.iq-iq').classList.add('on');
    el.querySelector('.iq-battle').classList.add('slam');
    el.querySelector('.iq-sub').textContent = corrupt ? SUB_CORRUPT : SUB_NORMAL;
    el.querySelector('.iq-card').classList.add('on');
    later(function () { dissolve(done); }, corrupt ? 700 : 900);
  }

  /* Public: run the film. opts: {corrupted?:bool, done?:fn}. */
  function play(opts) {
    opts = opts || {};
    var corrupt = !!opts.corrupted;
    var done = function () { safe(opts.done); };
    if (el) dissolve(function () {}); // never stack two films
    inject();
    var t = function (k) { return (corrupt ? T[k][1] : T[k][0]); };
    buildDom(corrupt);

    if (reducedMotion()) {
      // Simple fade: everything visible at once, gentle in/out.
      el.querySelector('.iq-glow').style.transition = 'none';
      el.querySelector('.iq-glow').classList.add('on');
      el.querySelector('.iq-iq').style.transition = 'none';
      el.querySelector('.iq-iq').classList.add('on');
      var vs = el.querySelector('.iq-battle');
      vs.style.transition = 'opacity .5s ease'; vs.style.opacity = '1';
      el.querySelector('.iq-sub').textContent = corrupt ? SUB_CORRUPT : SUB_NORMAL;
      el.querySelector('.iq-card').classList.add('on');
      later(function () { dissolve(done); }, t('card') + t('hold'));
    } else {
      later(function () { el.querySelector('.iq-glow').classList.add('on'); }, t('glow'));
      later(function () { el.querySelector('.iq-iq').classList.add('on'); }, t('iq'));
      later(function () { el.querySelector('.iq-battle').classList.add('slam'); }, t('battle'));
      typeSubtitle(corrupt ? SUB_CORRUPT : SUB_NORMAL, t('subType'), corrupt ? 34 : 26);
      later(function () { el.querySelector('.iq-card').classList.add('on'); }, t('card') + 300);
      later(function () { dissolve(done); }, t('card') + 300 + t('hold'));
    }

    el.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      if (el && !el.classList.contains('done')) skipToCard(corrupt, done);
    });
    root.addEventListener('keydown', onKey);
    function onKey(ev) {
      if (ev.key === 'Escape') { root.removeEventListener('keydown', onKey); dissolve(done); return; }
      if (el && !el.classList.contains('done')) { skipToCard(corrupt, done); root.removeEventListener('keydown', onKey); }
    }
  }

  /* Public: decide for the caller.
     Stage >= 3 (any corr/act-3 context) -> corrupted variant, every return.
     Otherwise -> normal film once per browser session, else instant done. */
  function maybe(opts) {
    opts = opts || {};
    var stage3 = typeof opts.stage === 'number'
      ? opts.stage >= 3
      : /(act-3|corr-3)/.test(document.body.className);
    if (stage3) { play({ corrupted: true, done: opts.done }); return true; }
    if (sessionSeen()) { safe(opts.done); return false; }
    markSeen();
    play({ corrupted: false, done: opts.done });
    return true;
  }

  /* Public: force-skip state (e.g. dev replays want a fresh session flag off). */
  function resetSeen() { try { root.sessionStorage.removeItem(SEEN_KEY); } catch (e) {} }

  root.IQ = root.IQ || {};
  root.IQ.Intro = {
    play: play,
    maybe: maybe,
    resetSeen: resetSeen,
    playing: function () { return !!el; }
  };
})();
