/* dims.js — IQ.Dims: dimension modes per research/w1-contracts.md C6.
   Dims.apply('3d'|'4d'|'606d', opts) / Dims.clear().
   '3d'   : wraps #board-frame children in a perspective container
            (preserve-3d, rotateX(12deg) + rotateY ±3° sway over 6s).
            Transforms are visual-only — pointer-events preserved, tiles and
            option buttons stay clickable. Sway pauses while any option in
            #opts-grid is hovered or focused.
   '4d'   : 3d plus a slow hue-rotate phase swing (≤15°) cycled on the board
            wrapper via CSS filter — the "projected extra axis".
   '606d' : joke mode — an animated tesseract vertex-graph SVG sits BEHIND the
            ordinary puzzle inside #board-frame (z-index under tiles,
            opacity 0.32, pointer-events none). Chaos is cosmetic only.
            Geometry note: a real tesseract is 16 vertices / 32 edges (the
            ticket's "24" matches no hypercube) — we render the authentic
            16v/32e graph, rotating about two planes (XW + YZ) simultaneously.
   All motion gated behind IQB_MOTION (+ prefers-reduced-motion): static
   frames when off. Seeded randomness uses opts.seed (mulberry32).
   clear()/re-apply restores #board-frame innerHTML byte-exactly and never
   shifts #opts-grid layout (no layout-affecting properties touched). */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;

  var CSS_ID = 'iqDimsCSS';
  var SWAY_DEG_X = 12, SWAY_DEG_Y = 3, SWAY_S = 6;
  var HUE_DEG = 15, HUE_S = 12;

  var active = null; /* applied mode string, or null */
  var refs = null;   /* nodes/styles captured during wrap */

  /* ---- env helpers ---------------------------------------------------- */

  function motionOK() {
    try {
      return !!localStorage.getItem('IQB_MOTION') ? JSON.parse(localStorage.getItem('IQB_MOTION')) : true;
    } catch (e) { return true; }
  }
  function reducedMotion() {
    return typeof root.matchMedia === 'function' &&
      root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* mulberry32 — same PRNG pattern as gen_iqb.js */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  var CSS = [
    '.' + 'iq-dims-stage{transform-style:preserve-3d;}',
    '.iq-dims-sway{animation:iqDimsSway ' + SWAY_S + 's ease-in-out infinite;}',
    '.iq-dims-hue{animation:iqDimsHue ' + HUE_S + 's linear infinite;}',
    '@keyframes iqDimsSway{0%,100%{transform:rotateX(' + SWAY_DEG_X + 'deg) rotateY(-' + SWAY_DEG_Y + 'deg)}' +
      '50%{transform:rotateX(' + SWAY_DEG_X + 'deg) rotateY(' + SWAY_DEG_Y + 'deg)}}',
    '@keyframes iqDimsHue{0%,100%{filter:hue-rotate(-' + HUE_DEG + 'deg)}50%{filter:hue-rotate(' + HUE_DEG + 'deg)}}',
    '.iq-dims-content{position:relative;z-index:1;}',
    '.iq-dims-lattice{position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;}',
    '@media (prefers-reduced-motion: reduce){' +
      '.iq-dims-sway,.iq-dims-hue{animation:none!important}}'
  ].join('');

  function inject() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(CSS_ID)) return;
    var st = document.createElement('style');
    st.id = CSS_ID;
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ---- hover/focus pause (options steal the sway) --------------------- */

  function attachPause(st) {
    var og = typeof document !== 'undefined' ? document.getElementById('opts-grid') : null;
    if (!og) return;
    st.og = og;
    st.pause = function () { if (st.wrapper) st.wrapper.style.animationPlayState = 'paused'; };
    st.resume = function () { if (st.wrapper) st.wrapper.style.animationPlayState = ''; };
    og.addEventListener('pointerenter', st.pause);
    og.addEventListener('pointerleave', st.resume);
    og.addEventListener('focusin', st.pause);
    og.addEventListener('focusout', st.resume);
  }
  function detachPause(st) {
    if (!st.og) return;
    st.og.removeEventListener('pointerenter', st.pause);
    st.og.removeEventListener('pointerleave', st.resume);
    st.og.removeEventListener('focusin', st.pause);
    st.og.removeEventListener('focusout', st.resume);
    st.og = null;
  }

  /* ---- tesseract: authentic 16 vertices / 32 edges -------------------- */

  /* Vertices of {4,4}: all (±1,±1,±1,±1). Edges connect pairs differing in
     exactly one coordinate → C(4,1)·2^3 = 32 edges. Computed once. */
  var TESS_VERTS = [], TESS_EDGES = [];
  (function () {
    var i, j, diff;
    for (i = 0; i < 16; i++) {
      TESS_VERTS.push([
        (i & 1) ? 1 : -1,
        (i & 2) ? 1 : -1,
        (i & 4) ? 1 : -1,
        (i & 8) ? 1 : -1
      ]);
    }
    for (i = 0; i < 16; i++) {
      for (j = i + 1; j < 16; j++) {
        diff = (i ^ j);
        if ((diff & (diff - 1)) === 0) TESS_EDGES.push([i, j]); /* power of two ⇒ hamming distance 1 */
      }
    }
  })();

  function mulberry(seed) { return mulberry32((seed == null ? 20260824 : seed >>> 0)); }

  /* Rotate in the XW and YZ planes, project 4D→3D→2D (double perspective). */
  function project(v, ax, ay) {
    var xa = Math.cos(ax), xs = Math.sin(ax);
    var ya = Math.cos(ay), ys = Math.sin(ay);
    var x = v[0] * xa - v[3] * xs, w = v[0] * xs + v[3] * xa;   /* XW */
    var y = v[1] * ya - v[2] * ys, z = v[1] * ys + v[2] * ya;   /* YZ */
    var s4 = 2.4 / (2.4 - w);
    var px = x * s4, py = y * s4, pz = z * s4;
    var s3 = 3.2 / (3.2 - pz);
    return [px * s3 * 70, py * s3 * 70];
  }

  function drawLattice(svg, ax, ay) {
    var pts = [], i, e, p, q;
    for (i = 0; i < TESS_VERTS.length; i++) pts.push(project(TESS_VERTS[i], ax, ay));
    var lines = svg.querySelectorAll('line'), dots = svg.querySelectorAll('circle');
    for (i = 0; i < TESS_EDGES.length && i < lines.length; i++) {
      e = TESS_EDGES[i]; p = pts[e[0]]; q = pts[e[1]];
      lines[i].setAttribute('x1', p[0].toFixed(2));
      lines[i].setAttribute('y1', p[1].toFixed(2));
      lines[i].setAttribute('x2', q[0].toFixed(2));
      lines[i].setAttribute('y2', q[1].toFixed(2));
    }
    for (i = 0; i < pts.length && i < dots.length; i++) {
      dots[i].setAttribute('cx', pts[i][0].toFixed(2));
      dots[i].setAttribute('cy', pts[i][1].toFixed(2));
    }
  }

  function buildLattice(seed) {
    var r = mulberry(seed);
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '-110 -110 220 220');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('opacity', '0.32'); /* hard ceiling: ≤0.35 */
    svg.setAttribute('aria-hidden', 'true');
    var i, ln, dot;
    for (i = 0; i < TESS_EDGES.length; i++) {
      ln = document.createElementNS(NS, 'line');
      ln.setAttribute('stroke', i % 4 === 0 ? '#9be7ff' : '#5f8fd8');
      ln.setAttribute('stroke-width', '1');
      svg.appendChild(ln);
    }
    for (i = 0; i < TESS_VERTS.length; i++) {
      dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('r', '2.4');
      dot.setAttribute('fill', r() < 0.25 ? '#ffd166' : '#cdeeff'); /* seeded accent verts */
      svg.appendChild(dot);
    }
    return svg;
  }

  /* Two-plane spin: XW advances faster than YZ. Static single frame when
     IQB_MOTION is off. */
  function startSpin(st, ax0, ay0) {
    if (!motionOK() || reducedMotion()) { drawLattice(st.lattice, ax0, ay0); return; }
    var t0 = null;
    function tick(now) {
      if (!refs || refs !== st) return; /* cleared mid-flight */
      if (t0 === null) t0 = now;
      var s = (now - t0) / 1000;
      drawLattice(st.lattice, ax0 + s * 0.42, ay0 + s * 0.29);
      st.raf = root.requestAnimationFrame(tick);
    }
    st.raf = root.requestAnimationFrame(tick);
  }

  /* ---- wrap / unwrap --------------------------------------------------- */

  function stillIntact(st) {
    return !!(st && st.wrapper && st.wrapper.parentNode === st.frame);
  }

  function wrap(mode, opts) {
    var frame = typeof document !== 'undefined' ? document.getElementById('board-frame') : null;
    if (!frame) return false;
    var seed = opts && opts.seed != null ? opts.seed : null;

    var kids = Array.prototype.slice.call(frame.childNodes);
    var st = {
      mode: mode, frame: frame, kids: kids,
      wrapper: null, lattice: null, og: null, raf: 0,
      savedPerspective: frame.style.perspective || '',
      savedPosition: frame.style.position || ''
    };

    /* every existing child (elements + whitespace text nodes) moves into the
       stage div — nothing is cloned or dropped, so unwrap is byte-exact */
    var w = document.createElement('div');
    w.className = 'iq-dims-stage';
    for (var i = 0; i < kids.length; i++) w.appendChild(kids[i]);
    frame.appendChild(w);
    st.wrapper = w;

    if (mode === '3d' || mode === '4d') {
      frame.style.perspective = '900px';
      if (motionOK() && !reducedMotion()) {
        w.classList.add('iq-dims-sway');
        if (mode === '4d') w.classList.add('iq-dims-hue');
        attachPause(st);
      } else {
        w.style.transform = 'rotateX(' + SWAY_DEG_X + 'deg)';
        if (mode === '4d') w.style.filter = 'hue-rotate(-10deg)';
      }
    } else { /* 606d — lattice behind an ordinary puzzle */
      w.classList.add('iq-dims-content');
      var cs = root.getComputedStyle ? root.getComputedStyle(frame) : null;
      if (!cs || cs.position === 'static') frame.style.position = 'relative';
      var svg = buildLattice(seed);
      svg.setAttribute('class', 'iq-dims-lattice');
      frame.insertBefore(svg, w);
      st.lattice = svg;
      var r = mulberry(seed);
      startSpin(st, 0.35 + r() * 0.6, 0.9 + r() * 0.6);
    }

    refs = st;
    return true;
  }

  function unwrap() {
    var st = refs;
    if (!st) return;
    detachPause(st);
    if (st.raf) { root.cancelAnimationFrame(st.raf); st.raf = 0; }
    /* If the shell re-rendered #board-frame.innerHTML meanwhile, our wrapper
       is gone along with this round's board — do NOT resurrect detached
       nodes; just drop state. Otherwise put the original children back. */
    if (stillIntact(st)) {
      for (var i = 0; i < st.kids.length; i++) st.frame.insertBefore(st.kids[i], st.wrapper);
      if (st.lattice && st.lattice.parentNode === st.frame) st.frame.removeChild(st.lattice);
      st.frame.removeChild(st.wrapper);
    }
    st.frame.style.perspective = st.savedPerspective;
    st.frame.style.position = st.savedPosition;
    refs = null;
    active = null;
  }

  /* ---- public API ------------------------------------------------------ */

  var MODES = ['3d', '4d', '606d'];

  function apply(mode, opts) {
    inject();
    if (MODES.indexOf(mode) < 0) { clear(); return false; }
    if (active === mode && stillIntact(refs)) return true; /* idempotent no-op */
    if (refs) unwrap();
    active = mode;
    return wrap(mode, opts);
  }

  function clear() {
    if (refs) unwrap();
    active = null;
  }

  root.IQ = root.IQ || {};
  root.IQ.Dims = { apply: apply, clear: clear };
})();
