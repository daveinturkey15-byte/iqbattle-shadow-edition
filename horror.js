/* IQ.Horror — SHADOW-themed atmosphere layer for IQ BATTLE: SHADOW.
   Pure CSS/DOM overlay (z40, pointer-events:none), zero assets, zero canvas.
   Stage 1: rare edge shadows. Stage 2: screen-breathing, crimson corner
   tendrils, red-eye flashes (~25s), drifting whisper words. Stage 3: topbar
   blood drips, heartbeat vignette synced to IQ.Audio 'heart', emerald orb
   orbiting the screen edges. Reduced-motion => static rendering only. */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var IQ = root.IQ || (root.IQ = {});

  var CSS_ID = 'iq-horror-style';
  var OVERLAY_ID = 'iqHorror';
  var WHISPERS = ['it watches', 'faster', 'emerald thief'];

  var CSS = [
    '#' + OVERLAY_ID + '{position:fixed;inset:0;z-index:40;pointer-events:none;overflow:hidden;}',
    /* -- stage 1: edge shadows ------------------------------------ */
    '#iqHEdges{position:absolute;inset:0;opacity:0;transition:opacity 2.5s;',
      'background:',
        'linear-gradient(90deg,rgba(0,0,0,.55),transparent 9%) left/12% 100% no-repeat,',
        'linear-gradient(-90deg,rgba(0,0,0,.55),transparent 9%) right/12% 100% no-repeat,',
        'linear-gradient(0deg,rgba(0,0,0,.5),transparent 7%) bottom/100% 10% no-repeat;',
      'box-shadow:inset 0 0 120px 30px rgba(0,0,0,.45);}',
    '#iqHEdges::after{content:"";position:absolute;inset:-4%;opacity:.8;',
      'background:radial-gradient(ellipse 30% 55% at 103% 50%,rgba(0,0,0,.5),transparent 70%),',
        'radial-gradient(ellipse 26% 48% at -3% 44%,rgba(0,0,0,.45),transparent 70%);}',
    /* -- stage 2: crimson corner tendrils -------------------------- */
    '.iqh-td{position:absolute;width:34vmax;height:34vmax;opacity:0;transition:opacity 3s;',
      'background:conic-gradient(from 200deg at 0 0,transparent 0deg,rgba(120,0,20,.28) 40deg,rgba(60,0,10,.5) 62deg,transparent 95deg);',
      'filter:blur(6px);}',
    '.iqh-td.tl{top:0;left:0;transform-origin:0 0;}',
    '.iqh-td.tr{top:0;right:0;transform:scaleX(-1);transform-origin:100% 0;}',
    '.iqh-td.bl{bottom:0;left:0;transform:scaleY(-1);transform-origin:0 100%;}',
    '.iqh-td.br{bottom:0;right:0;transform:scale(-1,-1);transform-origin:100% 100%;}',
    '@keyframes iqhSway{0%,100%{rotate:0deg}50%{rotate:2.4deg}}',
    /* -- stage 2: red-eye pair ------------------------------------- */
    '#iqHEyes{position:absolute;display:flex;gap:14px;opacity:0;}',
    '#iqHEyes i{width:9px;height:5px;border-radius:50%;background:#ff1122;',
      'box-shadow:0 0 8px 3px rgba(255,17,34,.85),0 0 22px 8px rgba(255,0,20,.35);}',
    '#iqHEyes i+i{margin-left:-3px;}',
    /* -- stage 2: whisper words ------------------------------------ */
    '.iqh-wh{position:absolute;color:rgba(190,20,40,.85);font-style:italic;font-weight:700;',
      'font-size:15px;letter-spacing:2px;text-shadow:0 0 10px rgba(255,0,30,.6);white-space:nowrap;}',
    '@keyframes iqhDrift{0%{opacity:0;translate:0 14px}12%{opacity:.9}70%{opacity:.55}100%{opacity:0;translate:0 -46px}}',
    /* -- stage 3: topbar drips ------------------------------------- */
    '.iqh-drip{position:absolute;top:100%;width:3px;border-radius:0 0 3px 3px;opacity:0;',
      'background:linear-gradient(180deg,#a00518,#5c000d);',
      'clip-path:polygon(0 0,100% 0,100% 82%,55% 100%,20% 84%,0 92%);}',
    '@keyframes iqhDrip{0%{opacity:0;height:0}8%{opacity:1}70%{opacity:1}100%{opacity:0;height:56px}}',
    /* -- stage 3: heartbeat vignette -------------------------------- */
    '#iqHVign{position:absolute;inset:0;opacity:0;',
      'background:radial-gradient(ellipse at center,transparent 42%,rgba(90,0,8,.38) 78%,rgba(40,0,4,.75) 100%);}',
    '@keyframes iqhBeat{0%{opacity:.15}9%{opacity:.85}18%{opacity:.3}27%{opacity:.65}55%{opacity:.18}100%{opacity:.15}}',
    /* -- stage 3: emerald orb --------------------------------------- */
    '#iqHOrb{position:absolute;top:0;left:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;',
      'background:radial-gradient(circle at 35% 35%,#c8ffe0,#0f9d58 45%,#024d2a 80%);',
      'box-shadow:0 0 14px 5px rgba(16,185,90,.55),0 0 34px 12px rgba(0,220,110,.22);opacity:0;}',
    '@keyframes iqhOrbit{',
      '0%{transform:translate(0,0)}23%{transform:translate(100vw,0)}',
      '25%{transform:translate(100vw,0)}48%{transform:translate(100vw,100vh)}',
      '50%{transform:translate(100vw,100vh)}73%{transform:translate(0,100vh)}',
      '75%{transform:translate(0,100vh)}98%,100%{transform:translate(0,0)}}',
    /* -- breathing on #app ------------------------------------------ */
    '@keyframes iqhBreathe{0%,100%{transform:scale(1)}50%{transform:scale(1.02)}}',
    '.iqh-breathe{animation:iqhBreathe 5.2s ease-in-out infinite;will-change:transform;}',
    /* -- manual surge (pulse) ---------------------------------------- */
    '#iqHPulse{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at center,transparent 30%,rgba(140,0,20,.5) 100%);transition:opacity .18s;}',
    /* -- reduced motion: everything static --------------------------- */
    '@media (prefers-reduced-motion:reduce){',
      '#' + OVERLAY_ID + ' *,#' + OVERLAY_ID + '{animation:none!important;transition:none!important}',
      '.iqh-td{opacity:.35!important}#iqHEdges{opacity:.6!important}#iqHVign{opacity:.3!important}}'
  ].join('');

  function injectCSS() {
    if (root.document.getElementById(CSS_ID)) return;
    var st = root.document.createElement('style');
    st.id = CSS_ID;
    st.textContent = CSS;
    root.document.head.appendChild(st);
  }

  function motionOK() {
    try {
      if (root.localStorage && root.localStorage.getItem('IQB_MOTION') === 'false') return false;
    } catch (e) {}
    try {
      if (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    } catch (e) {}
    return true;
  }

  var state = {
    mounted: false,
    stage: 0,
    motion: true,
    els: null,
    timers: [],
    heartHooked: false,
    fallbackHeart: null,
    lastEyeSpot: 0
  };

  function later(fn, ms) {
    var t = setTimeout(function () { try { fn(); } catch (e) {} }, ms);
    state.timers.push(t);
    return t;
  }

  function clearTimers() {
    state.timers.forEach(function (t) { clearTimeout(t); });
    state.timers = [];
    if (state.fallbackHeart) { clearInterval(state.fallbackHeart); state.fallbackHeart = null; }
  }

  function rand(min, max) { return min + Math.random() * (max - min); }

  // ---------- stage 2 behaviours ----------

  function eyeFlash() {
    var e = state.els; if (!e || state.stage < 2 || !state.motion) return;
    // avoid reusing the same corner twice in a row
    var spot = Math.floor(Math.random() * 4);
    if (spot === state.lastEyeSpot) spot = (spot + 1) % 4;
    state.lastEyeSpot = spot;
    var pad = '8%';
    var pos = [
      { top: pad, left: pad }, { top: pad, right: pad },
      { bottom: '16%', left: pad }, { bottom: '16%', right: pad }
    ][spot];
    Object.assign(e.eyes.style, { opacity: '0' });
    ['top', 'left', 'right', 'bottom'].forEach(function (k) {
      if (pos[k]) e.eyes.style[k] = pos[k]; else e.eyes.style[k] = 'auto';
    });
    e.eyes.style.opacity = '1';
    setTimeout(function () { try { e.eyes.style.opacity = '0'; } catch (er) {} }, 80);
    later(eyeFlash, 21000 + Math.random() * 9000); // ~25s cadence
  }

  function whisper() {
    var e = state.els; if (!e || state.stage < 2 || !state.motion) return;
    var w = root.document.createElement('span');
    w.className = 'iqh-wh';
    w.textContent = WHISPERS[Math.floor(Math.random() * WHISPERS.length)];
    w.style.left = rand(8, 74) + '%';
    w.style.top = rand(18, 78) + '%';
    var dur = rand(5, 9);
    w.style.animation = 'iqhDrift ' + dur.toFixed(1) + 's ease-out forwards';
    e.overlay.appendChild(w);
    setTimeout(function () { try { w.remove(); } catch (er) {} }, dur * 1000 + 200);
    later(whisper, rand(5000, 12000));
  }

  // ---------- stage 3: heartbeat sync ----------

  function beat() {
    var v = state.els && state.els.vign; if (!v) return;
    v.style.animation = 'none';
    void v.offsetWidth; // restart keyframes -> lub-dub shape
    v.style.animation = 'iqhBeat 0.9s ease-out';
  }

  function hookHeartbeat() {
    if (state.heartHooked || !IQ.Audio || typeof IQ.Audio.play !== 'function') return;
    state.heartHooked = true;
    var orig = IQ.Audio.play;
    IQ.Audio.play = function (name, opts) {
      try { if (name === 'heart' && state.stage >= 3) beat(); } catch (e) {}
      return orig.apply(this, arguments);
    };
  }

  function fallbackHeartLoop() {
    // Visual-only heartbeat when audio is unavailable/muted so the vignette
    // still breathes at the same irregular cadence as the ambience bed.
    if (state.fallbackHeart) return;
    var tick = function () {
      if (state.stage >= 3 && !audioHeartActive()) beat();
      state.fallbackHeart = setTimeout(tick, 900 + Math.random() * 2200);
    };
    state.fallbackHeart = setTimeout(tick, 900);
  }

  function audioHeartActive() {
    try { return !!(IQ.Audio && IQ.Audio._ctx && !IQ.Audio._muted && IQ.Audio._act === 2); }
    catch (e) { return false; }
  }

  function buildTopbarDrips() {
    var tb = root.document.getElementById('topbar');
    if (!tb || tb.querySelector('.iqh-drip')) return;
    tb.style.position = tb.style.position || 'relative';
    for (var i = 0; i < 7; i++) {
      var d = root.document.createElement('div');
      d.className = 'iqh-drip';
      d.style.left = (4 + i * 13.5 + rand(-4, 4)) + '%';
      d.style.animationDelay = (i * 1.7 + rand(0, 1.2)).toFixed(1) + 's';
      tb.appendChild(d);
    }
  }

  // ---------- public API ----------

  function mount(appEl) {
    if (state.mounted) return;
    injectCSS();
    var doc = root.document;
    var overlay = doc.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.innerHTML =
      '<div id="iqHEdges"></div>' +
      '<div class="iqh-td tl"></div><div class="iqh-td tr"></div>' +
      '<div class="iqh-td bl"></div><div class="iqh-td br"></div>' +
      '<div id="iqHEyes"><i></i><i></i></div>' +
      '<div id="iqHVign"></div>' +
      '<div id="iqHOrb"></div>' +
      '<div id="iqHPulse"></div>';
    (doc.body || doc.documentElement).appendChild(overlay);

    state.els = {
      overlay: overlay,
      app: appEl || doc.getElementById('app'),
      edges: overlay.querySelector('#iqHEdges'),
      tendrils: Array.prototype.slice.call(overlay.querySelectorAll('.iqh-td')),
      eyes: overlay.querySelector('#iqHEyes'),
      vign: overlay.querySelector('#iqHVign'),
      orb: overlay.querySelector('#iqHOrb'),
      pulse: overlay.querySelector('#iqHPulse')
    };
    state.mounted = true;
    apply(state.stage);
  }

  function apply(stage) {
    var e = state.els; if (!e) return;
    state.stage = Math.max(0, Math.min(3, stage | 0));
    var s = state.stage, m = state.motion;

    // stage 1+: edge shadows (static even under reduced motion)
    e.edges.style.opacity = s >= 1 ? '0.55' : '0';

    // stage 2+: tendrils, breathing, eye flashes, whispers
    e.tendrils.forEach(function (t) {
      t.style.opacity = s >= 2 ? '0.85' : '0';
      t.style.animation = (s >= 2 && m) ? 'iqhSway ' + rand(6, 9).toFixed(1) + 's ease-in-out infinite' : 'none';
    });
    if (e.app) e.app.classList.toggle('iqh-breathe', s >= 2 && m);
    if (e.orb) {
      e.orb.style.opacity = s >= 3 ? '0.95' : '0';
      e.orb.style.animation = (s >= 3 && m) ? 'iqhOrbit 26s linear infinite' : 'none';
      if (!(s >= 3)) e.orb.style.transform = '';
    }

    clearTimers();
    if (s >= 2 && m) {
      later(eyeFlash, rand(6000, 14000));
      later(whisper, rand(2500, 6000));
    }
    if (s >= 3) {
      buildTopbarDrips();
      hookHeartbeat();
      if (m) fallbackHeartLoop();
      else beat();
    }
  }

  function setStage(n) {
    try {
      n = Math.max(0, Math.min(3, n | 0));
      state.motion = motionOK();
      if (!state.mounted) mount(root.document && root.document.getElementById('app'));
      if (n <= state.stage && state.mounted) { state.stage = n; apply(n); return; }
      apply(n);
    } catch (e) {}
  }

  function pulse(i) {
    try {
      var p = state.els && state.els.pulse; if (!p) return;
      var amt = Math.max(0, Math.min(1, i == null ? 1 : +i));
      p.style.opacity = String(0.35 + amt * 0.55);
      if (state.stage >= 3 && state.motion) beat();
      setTimeout(function () { try { p.style.opacity = '0'; } catch (e) {} }, 240 + amt * 360);
    } catch (e) {}
  }

  IQ.Horror = {
    mount: mount,
    setStage: setStage,
    pulse: pulse
  };
  if (typeof module !== 'undefined') module.exports = IQ.Horror;
})();
