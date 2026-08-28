/* IQ.CursorFX — cursed cursor for IQ BATTLE: SHADOW.
   stage >= 2 (body.act-2/act-3): native cursor hidden over #app only;
   JS-positioned original SVG crimson wisp/ember trails the pointer with lag.
   stage 3: wisp becomes a tiny Shadow eye pair.
   Touch devices (pointer: coarse) skip entirely. prefers-reduced-motion =
   follower snaps to the pointer, no trailing embers. Follower is
   pointer-events:none; stage 0/1 restores the native cursor fully. */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var IQ = root.IQ || (root.IQ = {});
  if (IQ.CursorFX) return;

  var doc = typeof document !== 'undefined' ? document : null;
  if (!doc || !doc.createElement || !root.matchMedia('(pointer: fine)').matches) {
    // Coarse/touch pointer or hostile environment: inert stub, native cursor untouched.
    IQ.CursorFX = { init: function () {}, destroy: function () {}, stage: function () { return 0; } };
    return;
  }

  var STYLE_ID = 'iq-cursorfx-style';
  var STYLE = [
    '#' + EL_ID() + '{position:fixed;left:0;top:0;width:0;height:0;',
    'z-index:9999;pointer-events:none;will-change:transform}',
    '#' + EL_ID() + ' .iqc-wisp{position:absolute;left:-10px;top:-10px;',
    'filter:drop-shadow(0 0 6px rgba(224,16,48,.85))}',
    '#' + EL_ID() + ' .iqc-ember{position:absolute;border-radius:50%;',
    'background:#e01030;box-shadow:0 0 6px 1px rgba(255,60,80,.9);',
    'animation:iqEmberFade .7s ease-out forwards;pointer-events:none}',
    '@keyframes iqEmberFade{from{opacity:.95;transform:translate(0,0) scale(1)}',
    'to{opacity:0;transform:translate(var(--edx,0px),var(--edy,-8px)) scale(.2)}}'
  ].join('');
  function EL_ID() { return 'iq-cursor-fx'; }

  /* Original SVG fan-art: small crimson wisp/ember (pure geometry). */
  var WISP_SVG =
    '<svg class="iqc-wisp" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
    '<path d="M12 1.5C16.2 6.8 19 9.8 19 14a7 7 0 0 1-14 0c0-4.2 2.8-7.2 7-12.5Z" fill="#e01030" opacity=".92"/>' +
    '<path d="M12 8c2 2.8 3 4 3 6.3a3 3 0 0 1-6 0C9 12 10 10.8 12 8Z" fill="#ff5a6e"/>' +
    '<circle cx="12" cy="14.6" r="1.3" fill="#fff"/></svg>';

  /* Original SVG fan-art: slanted glowing Shadow eye pair (stage 3). */
  var EYES_SVG =
    '<svg class="iqc-wisp" viewBox="0 0 32 20" width="26" height="17" aria-hidden="true">' +
    '<path d="M3.5 10.5Q9 2.8 15.2 9.2 9.2 13.4 3.5 10.5Z" fill="#ff2038"/>' +
    '<path d="M16.8 9.2Q23 2.8 28.5 10.5 22.8 13.4 16.8 9.2Z" fill="#ff2038"/>' +
    '<ellipse cx="9.4" cy="9.4" rx="1.1" ry="1.5" fill="#fff" opacity=".95"/>' +
    '<ellipse cx="22.6" cy="9.4" rx="1.1" ry="1.5" fill="#fff" opacity=".95"/></svg>';

  var reduceMq = root.matchMedia('(prefers-reduced-motion: reduce)');

  var wrap = null;          // fixed-position follower root (pointer-events:none)
  var faceEl = null;        // holds current wisp/eyes SVG
  var appEl = null;
  var obs = null;           // MutationObserver on body class
  var rafId = 0;
  var tx = -100, ty = -100; // pointer target
  var x = tx, y = ty;       // eased follower position
  var lastEmber = 0;
  var seen = false;         // has pointer moved yet

  function reducedMotion() {
    return !!(reduceMq && reduceMq.matches);
  }

  function stageNow() {
    var cl = doc.body.classList;
    if (cl.contains('act-3')) return 3;
    if (cl.contains('act-2')) return 2;
    return 0; // act-0/act-1 => normal cursor
  }

  function ensureStyle() {
    if (doc.getElementById(STYLE_ID)) return;
    var s = doc.createElement('style');
    s.id = STYLE_ID;
    s.textContent = STYLE.replace(/\s*\n\s*/g, '');
    doc.head.appendChild(s);
  }

  /* Native cursor is hidden ONLY inside #app. */
  function setAppHidden(on) {
    if (!appEl || !appEl.isConnected) appEl = doc.getElementById('app');
    if (appEl) appEl.classList.toggle('iqc-native-off', on);
  }

  function ensureWrap() {
    if (wrap && wrap.isConnected) return wrap;
    ensureStyle();
    wrap = doc.createElement('div');
    wrap.id = EL_ID();
    wrap.setAttribute('aria-hidden', 'true');
    faceEl = doc.createElement('div');
    wrap.appendChild(faceEl);
    doc.body.appendChild(wrap);
    return wrap;
  }

  function setFace(stage) {
    if (!faceEl) return;
    var want = stage >= 3 ? EYES_SVG : WISP_SVG;
    if (faceEl._kind !== want) {
      faceEl.innerHTML = want;
      faceEl._kind = want;
    }
  }

  function spawnEmber(px, py, now) {
    if (reducedMotion()) return;
    if (now - lastEmber < 42) return;
    lastEmber = now;
    if (wrap.childElementCount > 26) return; // cap trail density
    var e = doc.createElement('div');
    var sz = 2 + Math.random() * 3.5;
    e.className = 'iqc-ember';
    e.style.cssText = 'left:' + (px + (Math.random() * 6 - 3)) + 'px;' +
      'top:' + (py + (Math.random() * 6 - 3)) + 'px;width:' + sz.toFixed(1) + 'px;height:' + sz.toFixed(1) + 'px;' +
      '--edx:' + (Math.random() * 10 - 5).toFixed(1) + 'px;' +
      '--edy:' + (-4 - Math.random() * 10).toFixed(1) + 'px';
    e.addEventListener('animationend', function () { e.remove(); });
    wrap.appendChild(e);
  }

  function tick(now) {
    rafId = 0;
    if (!wrap || !wrap.isConnected) return;
    if (!seen) { rafId = requestAnimationFrame(tick); return; }
    if (reducedMotion()) {
      x = tx; y = ty;
    } else {
      x += (tx - x) * 0.24;
      y += (ty - y) * 0.24;
      if (Math.abs(tx - x) < 0.4 && Math.abs(ty - y) < 0.4) { x = tx; y = ty; }
    }
    wrap.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
    spawnEmber(x, y, now);
    rafId = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  }

  function activate(stage) {
    ensureWrap();
    setFace(stage);
    setAppHidden(true);
    startLoop();
  }

  function deactivate() {
    setAppHidden(false);
    stopLoop();
    if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    wrap = null;
    faceEl = null;
  }

  function apply() {
    var s = stageNow();
    if (s >= 2) activate(s);
    else deactivate();
  }

  function onMove(ev) {
    tx = ev.clientX;
    ty = ev.clientY;
    if (!seen) { x = tx; y = ty; seen = true; }
  }

  function init() {
    if (obs) return;
    appEl = doc.getElementById('app');
    doc.addEventListener('pointermove', onMove, { passive: true });
    obs = new MutationObserver(apply);
    obs.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
    apply();
  }

  function destroy() {
    if (obs) { obs.disconnect(); obs = null; }
    doc.removeEventListener('pointermove', onMove);
    deactivate();
    seen = false;
    var st = doc.getElementById(STYLE_ID);
    if (st && st.parentNode) st.parentNode.removeChild(st);
  }

  var cssNative = doc.createElement('style'); // separate rule so restore never misses
  cssNative.id = 'iq-cursorfx-native';
  cssNative.textContent = '#app.iqc-native-off,#app.iqc-native-off *{cursor:none!important}';
  doc.head.appendChild(cssNative);

  IQ.CursorFX = {
    init: init,
    destroy: destroy,
    stage: stageNow,
    _activate: activate,
    _deactivate: deactivate
  };

  // Auto-init: module reacts purely to body class hooks, no shell call required.
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Node guard export.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { IQ: IQ, CursorFX: IQ.CursorFX };
  }
})();
