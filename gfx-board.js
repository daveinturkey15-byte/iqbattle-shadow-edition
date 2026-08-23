/* IQ Versus — gfx-board.js
 * Board frame + option tile presentation upgrade. Presentation ONLY:
 * no scoring, no game logic, no reads of puzzle state.
 *  (a) board-frame corner brackets (luxe tech) + stage-tinted glow
 *      (tint follows luxe.css --acc-a/--acc-b, so acts re-tint free)
 *  (b) option tiles: staggered deal-in on render (MutationObserver on
 *      #opts-grid), hover lift + accent underline, radial ring burst on
 *      .correct, clip-path jitter crack on .wrongpick
 *  (c) stage 3 (.act-3/.corr-3): subtle heat shimmer across tiles
 * All motion is gated behind body.iqgb-motion (prefers-reduced-motion +
 * IQB_MOTION setting). Self-inits, never throws.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var IQ = window.IQ = window.IQ || {};
  if (IQ.GfxBoard) return;

  var STYLE_ID = 'iq-gfxboard-style';
  var MOTION_CLS = 'iqgb-motion';
  var DEAL_STEP_MS = 45;

  /* ---------- injected CSS ---------- */
  var CSS = [
    /* --- frame anchor + fx overlay --- */
    '#board-frame{position:relative}',
    '.iqgb-frame-fx{position:absolute;inset:0;pointer-events:none;z-index:2;',
      'border-radius:inherit;filter:drop-shadow(0 0 9px var(--acc-a))}',
    '/* stage-tinted breathing glow inside the frame */',
    'body.iqgb-motion .iqgb-frame-fx::before{content:\'\';position:absolute;inset:0;',
      'border-radius:inherit;pointer-events:none;',
      'box-shadow:inset 0 0 42px -16px var(--acc-b);',
      'animation:iqgb-glow 4.6s ease-in-out infinite}',
    '@keyframes iqgb-glow{0%,100%{opacity:.2}50%{opacity:.75}}',
    '/* four corner brackets */',
    '.iqgb-c{position:absolute;width:20px;height:20px;pointer-events:none;',
      'border:2px solid var(--acc-a);border-radius:0;opacity:.55}',
    '.iqgb-c.tl{top:-5px;left:-5px;border-right:0;border-bottom:0;border-top-left-radius:9px}',
    '.iqgb-c.tr{top:-5px;right:-5px;border-left:0;border-bottom:0;border-top-right-radius:9px}',
    '.iqgb-c.bl{bottom:-5px;left:-5px;border-right:0;border-top:0;border-bottom-left-radius:9px}',
    '.iqgb-c.br{bottom:-5px;right:-5px;border-left:0;border-top:0;border-bottom-right-radius:9px}',
    'body.iqgb-motion .iqgb-c{animation:iqgb-corner 3.6s ease-in-out infinite}',
    'body.iqgb-motion .iqgb-c.tr{animation-delay:-.9s}',
    'body.iqgb-motion .iqgb-c.br{animation-delay:-1.8s}',
    'body.iqgb-motion .iqgb-c.bl{animation-delay:-2.7s}',
    '@keyframes iqgb-corner{0%,100%{opacity:.25;transform:scale(.96)}50%{opacity:.95;transform:scale(1)}}',

    /* --- option tile upgrades --- */
    '.opts-grid .opt-btn{position:relative;overflow:hidden}',
    '/* accent underline on hover */',
    '.opts-grid .opt-btn::after{content:\'\';position:absolute;left:14%;right:14%;bottom:6px;',
      'height:2px;border-radius:2px;background:linear-gradient(90deg,var(--acc-a),var(--acc-b));',
      'transform:scaleX(0);transform-origin:center;transition:transform .18s ease,opacity .18s ease;',
      'opacity:.9;pointer-events:none}',
    '.opts-grid .opt-btn:hover::after,.opts-grid .opt-btn.picked::after{transform:scaleX(1)}',
    '/* hover lift (motion-gated so static skin keeps luxe.css baseline) */',
    'body.iqgb-motion .opts-grid .opt-btn:hover{transform:translateY(-4px);',
      'box-shadow:0 8px 22px rgba(0,10,40,.45)}',
    '/* staggered deal-in */',
    'body.iqgb-motion .opts-grid .opt-btn.iqgb-deal{animation:iqgb-deal .38s cubic-bezier(.2,.7,.3,1) both}',
    '@keyframes iqgb-deal{0%{opacity:0;transform:translateY(16px) scale(.94)}100%{opacity:1;transform:none}}',
    '/* correct-answer radial ring burst (fires when game adds .correct) */',
    'body.iqgb-motion .opts-grid .opt-btn.correct::before{content:\'\';position:absolute;inset:-3px;',
      'border:2px solid var(--ok);border-radius:inherit;pointer-events:none;',
      'animation:iqgb-ring .65s ease-out forwards}',
    'body.iqgb-motion .opts-grid .opt-btn.iqgb-dealt.wrongpick{animation:iqgb-crack .5s steps(2,end) 1;}',
    '@keyframes iqgb-crack{',
      '0%{clip-path:polygon(0 2%,28% 0,52% 6%,78% 1%,100% 4%,98% 34%,100% 58%,97% 82%,100% 100%,70% 97%,44% 100%,18% 96%,0 100%,2% 66%,0 38%);',
        'box-shadow:0 0 0 3px rgba(255,46,136,.4),0 0 24px rgba(224,16,48,.55)}',
      '30%{clip-path:polygon(0 0,30% 5%,55% 0,80% 6%,100% 0,100% 32%,96% 60%,100% 84%,100% 100%,72% 100%,46% 94%,20% 100%,0 97%,4% 62%,0 36%)}',
      '60%{clip-path:polygon(0 4%,26% 0,54% 4%,76% 0,100% 3%,97% 36%,100% 56%,99% 84%,100% 100%,68% 96%,42% 100%,16% 97%,0 99%,3% 64%,0 40%)}',
      '100%{clip-path:none;box-shadow:0 0 0 3px rgba(255,46,136,.25)}}',

    /* --- stage 3 heat shimmer on tiles --- */
    'body.act-3.iqgb-motion .opts-grid .opt-btn,body.corr-3.iqgb-motion .opts-grid .opt-btn{',
      'background-image:linear-gradient(105deg,transparent 32%,rgba(224,16,48,.09) 46%,',
        'rgba(0,230,138,.07) 54%,transparent 68%);',
      'background-size:260% 100%;background-repeat:no-repeat;',
      'animation:iqgb-shimmer 5.5s linear infinite}',
    '@keyframes iqgb-shimmer{0%{background-position:130% 0}100%{background-position:-140% 0}}',

    /* belt-and-braces: kill every gfx-board animation under reduced motion */
    '@media (prefers-reduced-motion: reduce){',
      '.iqgb-c,.iqgb-frame-fx::before,.opts-grid .opt-btn.iqgb-deal,',
      '.opts-grid .opt-btn.correct::before,.opts-grid .opt-btn.wrongpick,',
      'body.act-3 .opts-grid .opt-btn,body.corr-3 .opts-grid .opt-btn{animation:none!important;transition:none!important}}'
  ].join('\n');

  function injectCSS() {
    try {
      if (document.getElementById(STYLE_ID)) return;
      var st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = CSS;
      document.head.appendChild(st);
    } catch (e) { /* no-throw */ }
  }

  /* ---------- motion gating ---------- */
  function motionAllowed() {
    try {
      if (window.matchMedia &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    } catch (e) { /* treat as allowed */ }
    try {
      var v = localStorage.getItem('IQB_MOTION');
      if (v !== null && JSON.parse(v) === false) return false;
    } catch (e) { /* default on */ }
    return true;
  }

  function applyMotion() {
    try {
      document.body.classList.toggle(MOTION_CLS, motionAllowed());
    } catch (e) { /* no-throw */ }
  }

  /* ---------- board frame corner brackets ---------- */
  function ensureFrameFx() {
    try {
      var f = document.getElementById('board-frame');
      if (!f || f.querySelector('.iqgb-frame-fx')) return;
      var fx = document.createElement('div');
      fx.className = 'iqgb-frame-fx';
      ['tl', 'tr', 'br', 'bl'].forEach(function (c) {
        var s = document.createElement('span');
        s.className = 'iqgb-c ' + c;
        fx.appendChild(s);
      });
      f.appendChild(fx);
    } catch (e) { /* no-throw */ }
  }

  /* ---------- option tile observers ---------- */
  var optsObs = null;
  var frameObs = null;

  function restaggerTiles() {
    try {
      var g = document.getElementById('opts-grid');
      if (!g) return;
      var btns = g.querySelectorAll('.opt-btn:not(.iqgb-dealt)');
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.add('iqgb-deal', 'iqgb-dealt');
        btns[i].style.animationDelay = (i * DEAL_STEP_MS) + 'ms';
      }
    } catch (e) { /* no-throw */ }
  }

  function watchOptsGrid() {
    try {
      var g = document.getElementById('opts-grid');
      if (!g || optsObs) return;
      optsObs = new MutationObserver(restaggerTiles);
      optsObs.observe(g, { childList: true });
    } catch (e) { /* no-throw */ }
  }

  function watchBoardFrame() {
    try {
      var f = document.getElementById('board-frame');
      if (!f || frameObs) return;
      frameObs = new MutationObserver(ensureFrameFx);
      frameObs.observe(f, { childList: true });
      ensureFrameFx();
    } catch (e) { /* no-throw */ }
  }

  /* ---------- init ---------- */
  function init() {
    try {
      injectCSS();
      applyMotion();
      watchOptsGrid();
      watchBoardFrame();
      /* react to OS reduced-motion flips mid-session */
      if (window.matchMedia) {
        try {
          window.matchMedia('(prefers-reduced-motion: reduce)')
            .addEventListener('change', applyMotion);
        } catch (e) { /* older API — ignore */ }
      }
    } catch (e) { /* never break the game */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  IQ.GfxBoard = {
    /* re-read motion prefs (settings toggle / media change) */
    refresh: function () { try { applyMotion(); } catch (e) {} },
    /* re-arm bracket overlay if something nuked it */
    repair: function () { try { ensureFrameFx(); } catch (e) {} }
  };
})();
