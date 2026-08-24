/* transitions.js — IQ.Transitions: screen transition film. STAGE-SCALED.
   nav() wraps its screen switch in Transitions.to(cb); cb fires at the covered
   midpoint. Stage 0 quick fade → 1 iris wipe → 2 horizontal shard wipe →
   3 reality tear (splitting halves + red seam + rumble). Injected CSS,
   ~600ms ceiling, reduced-motion (matchMedia or IQB_MOTION=false) = instant. */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;

  var CSS_ID = 'iqTransitionsCSS';

  /* Per-stage film spec: cover duration, reveal duration (ms). */
  var STAGES = [
    { cls: 'iqt-s0', in: 130, out: 170 }, /* quick fade            */
    { cls: 'iqt-s1', in: 210, out: 230 }, /* iris wipe             */
    { cls: 'iqt-s2', in: 250, out: 270 }, /* horizontal shard wipe */
    { cls: 'iqt-s3', in: 240, out: 260 }  /* reality tear          */
  ];
  var MID_PAD = 30;  /* extra ms after cover completes before cb fires */
  var END_PAD = 60;  /* extra ms after reveal completes before teardown */

  var CSS = [
    '#iq-trans{position:fixed;inset:0;z-index:2147483000;pointer-events:none;display:none}',
    '#iq-trans.live{display:block;pointer-events:auto}',

    /* stage 0 — quick fade */
    '.iqt-fade{position:absolute;inset:0;background:#000;opacity:0;transition:opacity 130ms ease-in}',
    '#iq-trans.out .iqt-fade{transition:opacity 170ms ease-out}',
    '.iqt-fade.on{opacity:1}',

    /* stage 1 — iris wipe (clip-path circle) */
    '.iqt-iris{position:absolute;inset:-2%;background:#000;',
    'clip-path:circle(0% at 50% 50%);transition:clip-path 210ms cubic-bezier(.65,0,.85,.4)}',
    '#iq-trans.out .iqt-iris{transition:clip-path 230ms cubic-bezier(.15,.6,.35,1)}',
    '.iqt-iris.on{clip-path:circle(76% at 50% 50%)}',

    /* stage 2 — horizontal shard wipe (3 clipped panels slide) */
    '.iqt-shard{position:absolute;top:-2%;bottom:-2%;width:38%;background:#000;',
    'transition:transform 190ms cubic-bezier(.7,0,.8,.4)}',
    '.iqt-shard.sh0{left:-3%;transform:translateX(-114%);transition-delay:0ms}',
    '.iqt-shard.sh1{left:33.5%;transform:translateX(114%);transition-delay:45ms}',
    '.iqt-shard.sh2{left:66%;transform:translateX(-114%);transition-delay:90ms}',
    '.iqt-shard.on{transform:translateX(0)}',
    '#iq-trans.out .iqt-shard{transition:transform 200ms cubic-bezier(.25,.55,.35,1)}',
    '#iq-trans.out .sh0,#iq-trans.out .sh2{transition-delay:80ms;transform:translateX(114%) !important}',
    '#iq-trans.out .sh1{transition-delay:0ms;transform:translateX(-114%) !important}',

    /* stage 3 — reality tear (halves split, red seam, rumble) */
    '.iqt-half{position:absolute;top:-2%;bottom:-2%;width:52%;background:#000;',
    'transition:transform 240ms cubic-bezier(.8,0,.72,.2)}',
    '.iqt-half.hL{left:-2%;transform:translateX(-106%) !important}',
    '.iqt-half.hR{right:-2%;transform:translateX(106%) !important}',
    '#iq-trans.out .iqt-half{transition:transform 260ms cubic-bezier(.2,.6,.3,1)}',
    '.iqt-half.on{transform:translateX(0) !important}',
    '#iq-trans.out .hL{transform:translateX(-106%) !important}',
    '#iq-trans.out .hR{transform:translateX(106%) !important}',
    '.iqt-seam{position:absolute;left:50%;top:-2%;bottom:-2%;width:3px;margin-left:-1.5px;',
    'background:linear-gradient(180deg,#ff2040,#c8102e 45%,#ff5a6e 50%,#c8102e,#ff2040);',
    'box-shadow:0 0 14px 3px rgba(255,16,48,.95),0 0 44px 12px rgba(200,16,46,.55);',
    'opacity:0;transform:scaleY(.15);transition:opacity 150ms ease-out,transform 240ms ease-out}',
    '.iqt-seam.on{opacity:1;transform:scaleY(1)}',
    '#iq-trans.out .iqt-seam{opacity:0;transition:opacity 190ms ease-out 70ms;',
    'box-shadow:0 0 22px 5px rgba(255,32,64,1),0 0 70px 20px rgba(255,16,48,.7)}',
    '@keyframes iqtrum{0%,100%{transform:translate(0,0)}25%{transform:translate(-2px,1px)}',
    '50%{transform:translate(2px,-1px)}75%{transform:translate(-1px,-2px)}}',
    '.iqt-rumbling{animation:iqtrum 90ms linear infinite}'
  ].join('');

  var busy = false;
  var queued = [];

  function safe(fn) { try { fn(); } catch (e) { /* the film must never break the game */ } }

  function inject() {
    if (root.document.getElementById(CSS_ID)) return;
    var s = root.document.createElement('style');
    s.id = CSS_ID;
    s.textContent = CSS;
    root.document.head.appendChild(s);
  }

  function reducedMotion() {
    try {
      var raw = root.localStorage && root.localStorage.getItem('IQB_MOTION');
      if (raw && JSON.parse(raw) === false) return true;
    } catch (e) { /* ignore */ }
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* Stage source of truth: body classes act-0..act-3 set by the shell. */
  function detectStage() {
    var b = root.document.body;
    if (!b) return 0;
    for (var n = 3; n >= 1; n--) {
      if (b.classList.contains('act-' + n)) return n;
    }
    return 0;
  }

  function raf2(fn) {
    root.requestAnimationFrame(function () { root.requestAnimationFrame(fn); });
  }

  function build(stage) {
    d.className = 'live ' + STAGES[stage].cls;
    d.id = 'iq-trans';
    d.className = STAGES[stage].cls;
    var html = '';
    if (stage === 0) {
      html = '<div class="iqt-fade"></div>';
    } else if (stage === 1) {
      html = '<div class="iqt-iris"></div>';
    } else if (stage === 2) {
      html = '<div class="iqt-shard sh0"></div><div class="iqt-shard sh1"></div><div class="iqt-shard sh2"></div>';
    } else {
      html = '<div class="iqt-half hL"></div><div class="iqt-half hR"></div><div class="iqt-seam"></div>';
    }
    d.innerHTML = html;
    return d;
  }

  function rumbleTarget(on) {
    safe(function () {
      var el = root.document.getElementById('app') || root.document.body;
      if (!el) return;
      el.classList.toggle('iqt-rumbling', !!on);
    });
  }

  function flushQueued() {
    var pending = queued.splice(0, queued.length);
    for (var i = 0; i < pending.length; i++) safe(pending[i]);
  }

  /* Public: run the stage-appropriate film around cb. cb fires once the
     screen is fully covered (or immediately under reduced motion). */
  function to(cb, stageOverride) {
    inject();
    if (typeof cb !== 'function') return;

    if (reducedMotion()) { safe(cb); return; }
    if (busy) { queued.push(cb); return; }

    var stage = typeof stageOverride === 'number'
      ? Math.max(0, Math.min(3, Math.floor(stageOverride)))
      : detectStage();
    var spec = STAGES[stage];

    busy = true;
    var host = build(stage);
    root.document.body.appendChild(host);

    if (stage === 3) rumbleTarget(true);

    var cover = function () {
      var parts = host.children;
      for (var i = 0; i < parts.length; i++) parts[i].classList.add('on');
    };
    raf2(cover);
    root.setTimeout(cover, 60); /* fallback when rAF is throttled */

    root.setTimeout(function () {          /* midpoint: screen fully covered */
      safe(cb);
      host.classList.add('out');
      var parts = host.children;
      for (var i = 0; i < parts.length; i++) parts[i].classList.remove('on');
      if (stage === 3) rumbleTarget(false);
    }, spec.in + MID_PAD);

    root.setTimeout(function () {          /* teardown */
      if (host.parentNode) host.parentNode.removeChild(host);
      busy = false;
      flushQueued();
    }, spec.in + MID_PAD + spec.out + END_PAD);
  }

  root.IQ = root.IQ || {};
  root.IQ.Transitions = { to: to, transition: to };
})();
