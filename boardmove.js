/* IQ.BoardMove — stage>=2 board DRIFT for IQ VERSUS: SHADOW.
 * The puzzle frame (#board-frame) and the options grid (#opts-grid) slowly
 * orbit around the screen in counter-phase (grid moves against the frame),
 * so the playfield never sits still. Stage 3 adds violent "lurches" —
 * sudden offset kicks paired with IQ.Chaos.shake.
 *
 * SAFETY: every frame, after applying the transform, every option button's
 * center is measured via getBoundingClientRect; if any center would leave
 * the viewport, the drift direction reverses and that frame's offset is
 * corrected back inside. Options are ALWAYS clickable.
 *
 * Presentation ONLY: no game logic, no reads of puzzle state. Self-init,
 * observes body act-N/corr-N classes, degrades silently, fully disabled
 * under prefers-reduced-motion.
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};
  if (root.IQ.BoardMove) return;

  var MARGIN = 8;          /* px every option center must stay inside viewport */
  var TAU = Math.PI * 2;

  var S = {
    stage: 0,              /* observed stage (0..3) */
    enabled: true,
    reduced: false,
    raf: 0,
    running: false,
    prev: 0,               /* previous rAF timestamp */
    t: 0,                  /* module clock (s), pauses with pause() */
    pausedUntil: 0,        /* performance.now() until which motion freezes */
    dir: 1,                /* +1/-1 drift direction; flips on viewport breach */
    intensity: 1,          /* 0..1 amplitude/rotation scalar (shell-driven) */
    ducked: false,         /* pointer/touch down over an option tile */
    p: null,               /* randomized drift params for current stage */
    nextLurch: Infinity,   /* module-clock time of next stage-3 lurch */
    lurchAge: -1,          /* seconds since lurch started (-1 = idle) */
    lx: 0, ly: 0,          /* lurch kick vector */
    cur: null,             /* current transforms {fx,fy,fr,gx,gy,gr} */
    mq: null
  };

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function els() {
    S.frameEl = document.getElementById('board-frame');
    S.gridEl = document.getElementById('opts-grid');
    return !!(S.frameEl && S.gridEl);
  }

  /* ---------- drift parameters ---------- */

  function rollParams() {
    var s3 = S.stage >= 3;
    S.p = {
      ax: rnd(s3 ? 55 : 30, s3 ? 90 : 50),
      ay: rnd(s3 ? 55 : 30, s3 ? 90 : 50),
      T: rnd(s3 ? 8 : 12, s3 ? 14 : 20),
      rot: rnd(s3 ? 2 : 1, s3 ? 3 : 2.5),
      p1: rnd(0, TAU),
      p2: rnd(0, TAU)
    };
    S.nextLurch = S.t + rnd(0.5, 3);
  }

  function triggerLurch() {
    if (effIntensity() <= 0) {          /* cleanser/impossible: stay still, retry soon */
      S.nextLurch = S.t + rnd(1, 2);
      return;
    }
    S.lurchAge = 0;
    S.lx = rnd(-45, 45);
    S.ly = rnd(-45, 45);
    S.nextLurch = S.t + rnd(6, 12);   /* stage-3 lurch cadence */
    try {
      if (root.IQ && root.IQ.Chaos && root.IQ.Chaos.shake) {
        root.IQ.Chaos.shake(Math.round(rnd(10, 18)), 420);
      }
    } catch (e) { /* juice is optional */ }
  }

  /* lurch envelope: fast attack (~120ms), slow decay (~700ms) */
  function lurchEnv() {
    if (S.lurchAge < 0) return 0;
    if (S.lurchAge < 0.12) return S.lurchAge / 0.12;
    var d = 1 - (S.lurchAge - 0.12) / 0.7;
    return d > 0 ? d : (S.lurchAge = -1, 0);
  }

  /* ---------- transform application + viewport clamp ---------- */

  function tf(x, y, r) {
    return 'translate(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px)' +
           ' rotate(' + r.toFixed(3) + 'deg)';
  }

  /* Measures option-button centers; on breach flips drift direction and
   * shifts this frame's grid offset back inside. Returns true if breached. */
  function clampToViewport() {
    if (!S.gridEl || !S.cur) return false;
    var btns = S.gridEl.querySelectorAll('.opt-btn');
    var n = btns.length;
    if (!n) return false;
    var vw = window.innerWidth, vh = window.innerHeight;
    var breached = false;

    for (var pass = 0; pass < 2; pass++) {
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (var i = 0; i < n; i++) {
        var r = btns[i].getBoundingClientRect();
        if (!r.width && !r.height) continue;
        var cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
      }
      if (minX === Infinity) return breached;
      var ox = 0, oy = 0;
      if (minX < MARGIN) ox = MARGIN - minX;
      else if (maxX > vw - MARGIN) ox = (vw - MARGIN) - maxX;
      if (minY < MARGIN) oy = MARGIN - minY;
      else if (maxY > vh - MARGIN) oy = (vh - MARGIN) - maxY;
      if (!ox && !oy) break;

      breached = true;
      /* translation shifts rects ~linearly even under small rotation;
       * pass 2 re-verifies the corrected placement. */
      S.cur.gx += ox; S.cur.gy += oy;
      S.gridEl.style.transform = tf(S.cur.gx, S.cur.gy, S.cur.gr);
    }
    if (breached) S.dir *= -1;   /* reverse drift on breach */
    return breached;
  }

  /* ---------- main loop ---------- */

  function tick(now) {
    S.raf = 0;
    if (!S.running) return;
    var dt = Math.min(0.05, (now - S.prev) / 1000 || 0);
    S.prev = now;

    if (now >= S.pausedUntil) {
      S.t += dt;
      if (S.stage >= 3) {
        if (S.t >= S.nextLurch) triggerLurch();
        if (S.lurchAge >= 0) S.lurchAge += dt;
      }
      var p = S.p || {};
      S.theta += dt * TAU / (p.T || 15) * S.dir;
      var e = S.stage >= 3 ? lurchEnv() : 0;
      var th = S.theta, p1 = p.p1 || 0, p2 = p.p2 || 0;
      var k = effIntensity();
      var ax = (p.ax || 0) * k, ay = (p.ay || 0) * k, rot = (p.rot || 0) * k;
      S.cur = {
        fx: Math.sin(th) * ax + Math.sin(th * 0.63 + p1) * ax * 0.35 + S.lx * e,
        fy: Math.sin(th * 0.71 + p1) * ay + Math.cos(th * 0.47) * ay * 0.25 + S.ly * e,
        fr: Math.sin(th * 0.41 + p2) * rot,
        /* grid runs at theta+PI => exact mirror of the frame orbit */
        gx: Math.sin(th + Math.PI) * ax + Math.sin(th * 0.63 + p1 + Math.PI) * ax * 0.35 - S.lx * e * 0.5,
        gy: Math.sin(th * 0.71 + p1 + Math.PI) * ay + Math.cos(th * 0.47 + Math.PI) * ay * 0.25 - S.ly * e * 0.5,
        gr: Math.sin(th * 0.41 + p2 + Math.PI) * rot * 0.8
      };
      if (S.frameEl) S.frameEl.style.transform = tf(S.cur.fx, S.cur.fy, S.cur.fr);
      if (S.gridEl) S.gridEl.style.transform = tf(S.cur.gx, S.cur.gy, S.cur.gr);
      clampToViewport();
    }
    S.raf = requestAnimationFrame(tick);
  }

  function start() {
    if (S.running || S.reduced || !S.enabled || S.stage < 2) return;
    if (!els()) return;
    rollParams();
    S.running = true;
    S.prev = performance.now();
    S.pausedUntil = 0;
    S.raf = requestAnimationFrame(tick);
  }

  function stop(clear) {
    S.running = false;
    if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
    S.lurchAge = -1;
    if (clear) {
      if (S.frameEl) S.frameEl.style.transform = '';
      if (S.gridEl) S.gridEl.style.transform = '';
      S.cur = null;
    }
  }

  function syncActive() {
    if (S.stage >= 2 && S.enabled && !S.reduced) {
      if (!S.running) start();
    } else {
      stop(true);
    }
  }

  /* ---------- public API ---------- */

  function setStage(n) {
    n = Math.max(0, Math.min(3, n | 0));
    var changed = n !== S.stage;
    S.stage = n;
    if (changed) { S.dir = 1; S.theta = 0; }
    syncActive();
  }

  function setEnabled(on) {
    S.enabled = !!on;
    syncActive();
  }

  /* Freeze all board motion in place for ms milliseconds. */
  function pause(ms) {
    ms = Math.max(0, ms | 0);
    S.pausedUntil = ms ? (performance.now() + ms) : 0;
  }

  function effIntensity() {
    return Math.max(0, Math.min(1, S.intensity)) * (S.ducked ? 0.2 : 1);
  }

  /* Scale drift amplitude/rotation (0..1). Cleanser rounds pass 0. */
  function setIntensity(v) {
    S.intensity = Math.max(0, Math.min(1, +v || 0));
  }

  root.IQ.BoardMove = {
    setStage: setStage,
    setEnabled: setEnabled,
    pause: pause,
    get stage() { return S.stage; },
    get active() { return S.running; },
    setIntensity: setIntensity
  };

  /* ---------- boot ---------- */

  function boot() {
    try {
      S.mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      var applyRM = function () {
        S.reduced = !!(S.mq && S.mq.matches);
        syncActive();
      };
      if (S.mq.addEventListener) S.mq.addEventListener('change', applyRM);
      else if (S.mq.addListener) S.mq.addListener(applyRM);
      applyRM();

      /* observe body stage classes (act-N / corr-N) */
      if (window.MutationObserver) {
        new MutationObserver(function () {
          var cl = document.body.classList;
          var n = cl.contains('act-3') || cl.contains('corr-3') ? 3
            : cl.contains('act-2') || cl.contains('corr-2') ? 2
            : cl.contains('act-1') || cl.contains('corr-1') ? 1 : 0;
          if (n !== S.stage) setStage(n);
        }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
        var cl = document.body.classList;
        setStage(cl.contains('act-3') || cl.contains('corr-3') ? 3
          : cl.contains('act-2') || cl.contains('corr-2') ? 2
          : cl.contains('act-1') || cl.contains('corr-1') ? 1 : 0);
      }

      document.addEventListener('visibilitychange', function () {
        if (document.hidden) stop(false);
        else syncActive();
      });

      /* never drift under an active pick: duck to 20% while a pointer or
       * touch is held over any option tile; restore on release. */
      document.addEventListener('pointerdown', function (ev) {
        if (ev.target && ev.target.closest && ev.target.closest('.opt-btn')) S.ducked = true;
      }, true);
      ['pointerup', 'pointercancel', 'blur'].forEach(function (t) {
        document.addEventListener(t, function () { S.ducked = false; }, true);
      });
    } catch (e) { /* degrade silently */ }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }

  if (typeof module !== 'undefined') module.exports = root.IQ.BoardMove;
})();
