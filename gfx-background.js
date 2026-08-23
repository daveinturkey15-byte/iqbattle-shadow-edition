/* IQ.GfxBg — animated stage-reactive background layer for IQ VERSUS.
 * Canvas fixed behind #app (z-index 0). Stage 0: drifting dot-grid +
 * slow luxe-navy gradient shift. Stage 1: faint crimson mist drift.
 * Stage 2: ember sparks + darker breathing vignette. Stage 3: full
 * hellscape — rising ember columns, rotating rune-circle (original
 * geometry), pulsing crimson horizon glow. Single rAF, pauses when
 * document.hidden, prefers-reduced-motion => static gradient only,
 * devicePixelRatio aware, <=60 particles at stage 3.
 * Presentation ONLY: no game state, degrades silently if missing.
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};

  var TAU = Math.PI * 2;
  var MAX_PARTICLES = 60;

  /* base fills per stage (luxe palette decay) */
  var BASE = [
    ['#0b1120', '#0d1428', '#091020'],
    ['#0c0914', '#120a18', '#0a0610'],
    ['#0a0510', '#10060f', '#070409'],
    ['#050208', '#0a0310', '#030105']
  ];

  var S = {
    mounted: false, destroyed: false,
    canvas: null, ctx: null,
    w: 0, h: 0, dpr: 1,
    stage: -1, target: 0,
    raf: 0, running: false, t0: 0, prev: 0,
    reduced: false,
    /* seeded per-stage actors */
    dotPhase: [], mist: [], sparks: [], cols: []
  };

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function now() { return (root.performance && performance.now()) || Date.now(); }

  /* ---------- seeding ---------- */

  function seed() {
    var i;
    S.dotPhase = [];
    for (i = 0; i < 12; i++) S.dotPhase.push(rnd(0, TAU));

    S.mist = [];
    for (i = 0; i < 5; i++) {
      S.mist.push({
        x: Math.random(), y: rnd(0.15, 0.9),
        r: rnd(0.28, 0.55),               /* fraction of min(w,h) */
        vx: rnd(0.006, 0.016) * (Math.random() < 0.5 ? -1 : 1),
        ph: rnd(0, TAU), a: rnd(0.035, 0.07)
      });
    }

    S.sparks = [];
    for (i = 0; i < 22; i++) {
      S.sparks.push({
        x: Math.random(), y: Math.random(),
        vy: rnd(0.02, 0.06), sw: rnd(0.004, 0.014), ph: rnd(0, TAU),
        sz: rnd(1.1, 2.6), tw: rnd(2, 6)
      });
    }

    /* hellscape: ember columns (<=54) + a few free sparks, hard cap */
    S.cols = [];
    var budget = MAX_PARTICLES - 6, colN = 6, perCol = Math.floor(budget / colN);
    for (var c = 0; c < colN; c++) {
      var cx = (c + 0.5) / colN + rnd(-0.04, 0.04);
      var list = [];
      for (i = 0; i < perCol; i++) {
        list.push(newEmber(cx));
      }
      S.cols.push({ x: cx, list: list, glow: rnd(0, TAU) });
    }
  }

  function newEmber(cx) {
    return {
      ox: cx + rnd(-0.025, 0.025),
      y: rnd(0, 1),
      vy: rnd(0.045, 0.11),              /* screen heights / second */
      sw: rnd(0.006, 0.02), ph: rnd(0, TAU),
      sz: rnd(1.4, 3.4)
    };
  }

  /* ---------- layout ---------- */

  function resize() {
    if (!S.canvas) return;
    var dpr = Math.min(root.devicePixelRatio || 1, 2);
    S.dpr = dpr;
    S.w = root.innerWidth; S.h = root.innerHeight;
    S.canvas.width = Math.max(1, Math.round(S.w * dpr));
    S.canvas.height = Math.max(1, Math.round(S.h * dpr));
    S.canvas.style.width = S.w + 'px';
    S.canvas.style.height = S.h + 'px';
    S.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (S.reduced) drawStatic();
  }

  /* ---------- shared painters ---------- */

  function paintBase(t) {
    var ctx = S.ctx, b = BASE[Math.max(0, Math.min(3, S.stage))];
    var g = ctx.createLinearGradient(0, 0, S.w * 0.35, S.h);
    g.addColorStop(0, b[0]); g.addColorStop(0.55, b[1]); g.addColorStop(1, b[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S.w, S.h);

    /* slow ambient gradient shift: two drifting accent glows */
    var drift = t * 0.00006;
    glow(ctx,
      S.w * (0.78 + 0.1 * Math.sin(drift)),
      S.h * (-0.1 + 0.06 * Math.cos(drift * 0.7)),
      Math.max(S.w, S.h) * 0.7, accentA(), 0.06);
    glow(ctx,
      S.w * (0.08 + 0.08 * Math.cos(drift * 0.83)),
      S.h * (1.1 + 0.05 * Math.sin(drift * 0.6)),
      Math.max(S.w, S.h) * 0.6, accentB(), 0.05);
  }

  function accentA() {
    return S.stage === 0 ? '63,125,255' : S.stage === 1 ? '255,46,136'
      : S.stage === 2 ? '224,16,48' : '224,16,48';
  }
  function accentB() {
    return S.stage <= 1 ? '255,46,136' : S.stage === 2 ? '255,90,54' : '255,46,20';
  }

  function glow(ctx, x, y, r, rgb, a) {
    if (r <= 0 || a <= 0) return;
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')');
    g.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  function vignette(ctx, strength, breatheT) {
    var b = 1 + 0.12 * Math.sin(breatheT);   /* darker edge breathing */
    var inner = Math.min(S.w, S.h) * (0.52 - 0.1 * strength) * b;
    var g = ctx.createRadialGradient(
      S.w / 2, S.h / 2, inner, S.w / 2, S.h / 2, Math.max(S.w, S.h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    var dark = 0.45 + 0.28 * strength;
    var tint = S.stage >= 2 ? '26,0,6' : '0,0,10';
    g.addColorStop(1, 'rgba(' + tint + ',' + Math.min(dark, 0.85).toFixed(3) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S.w, S.h);
  }

  /* ---------- per-stage painters ---------- */

  function paintDots(t) {
    var ctx = S.ctx;
    var step = 46, drift = t * 0.004;
    var ox = (drift % step) - step, oy = ((t * 0.0022) % step) - step;
    var i = 0;
    ctx.fillStyle = 'rgba(140,165,220,1)';
    for (var y = oy; y < S.h + step; y += step) {
      for (var x = ox; x < S.w + step; x += step) {
        var tw = 0.028 + 0.02 * (0.5 + 0.5 * Math.sin(t * 0.0006 + S.dotPhase[i % S.dotPhase.length]));
        ctx.globalAlpha = tw;
        ctx.fillRect(x, y, 1.6, 1.6);
        i++;
      }
    }
    ctx.globalAlpha = 1;
  }

  function paintMist(t) {
    var ctx = S.ctx, m = Math.min(S.w, S.h);
    for (var i = 0; i < S.mist.length; i++) {
      var p = S.mist[i];
      var x = ((p.x + t * 0.001 * p.vx) % 1.4 + 1.4) % 1.4 - 0.2;
      var y = p.y + 0.03 * Math.sin(t * 0.0002 + p.ph);
      glow(ctx, x * S.w, y * S.h, p.r * m, '255,32,84',
        p.a * (0.75 + 0.25 * Math.sin(t * 0.0003 + p.ph)));
    }
  }

  function paintSparks(t, dt) {
    var ctx = S.ctx;
    for (var i = 0; i < S.sparks.length; i++) {
      var p = S.sparks[i];
      p.y -= p.vy * dt;
      if (p.y < -0.05) { p.y = 1.05; p.x = Math.random(); }
      var x = (p.x + p.sw * Math.sin(t * 0.001 + p.ph)) * S.w;
      var y = p.y * S.h;
      var fl = 0.45 + 0.55 * Math.abs(Math.sin(t * 0.001 * p.tw + p.ph));
      ctx.globalAlpha = 0.7 * fl;
      ctx.fillStyle = i % 4 === 0 ? 'rgba(255,150,60,1)' : 'rgba(255,80,50,1)';
      ctx.beginPath();
      ctx.arc(x, y, p.sz, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function paintEmberColumns(t, dt) {
    var ctx = S.ctx;
    for (var c = 0; c < S.cols.length; c++) {
      var col = S.cols[c];
      /* column heat haze */
      glow(ctx, col.x * S.w, S.h, Math.min(S.w, S.h) * 0.16, '255,60,24', 0.05 +
        0.02 * Math.sin(t * 0.0011 + col.glow));
      var list = col.list;
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        p.y -= p.vy * dt;
        if (p.y < -0.04) S.cols[c].list[i] = newEmber(col.x);
        var q = S.cols[c].list[i];
        var x = (q.ox + q.sw * Math.sin(t * 0.0012 + q.ph)) * S.w;
        var y = q.y * S.h;
        var fade = Math.min(1, (1 - q.y) * 3) * Math.min(1, q.y * 6 + 0.15);
        ctx.globalAlpha = 0.85 * fade;
        ctx.fillStyle = q.sz > 2.4 ? 'rgba(255,170,64,1)' : 'rgba(255,72,36,1)';
        ctx.beginPath();
        ctx.arc(x, y, q.sz, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* Original rune-circle geometry: concentric stroked rings, tick marks,
   * dashed arc segments and orbiting diamonds. No external artwork. */
  function runeCircle(t) {
    var ctx = S.ctx;
    var cx = S.w / 2, cy = S.h * 0.62;
    var R = Math.min(S.w, S.h) * 0.42;
    var rot = t * 0.00005;                    /* ~1 rotation / 2 minutes */
    var a = 0.11 + 0.04 * Math.sin(t * 0.0004);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.strokeStyle = 'rgba(224,16,48,' + a.toFixed(3) + ')';
    ctx.lineWidth = 1.2;

    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, R * 0.82, 0, TAU); ctx.stroke();

    /* dashed inner ring */
    ctx.setLineDash([R * 0.09, R * 0.05]);
    ctx.beginPath(); ctx.arc(0, 0, R * 0.64, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);

    /* tick marks between rings */
    var ticks = 36, i;
    ctx.beginPath();
    for (i = 0; i < ticks; i++) {
      var ang = (i / ticks) * TAU;
      var r0 = i % 3 === 0 ? R * 0.86 : R * 0.9;
      ctx.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0);
      ctx.lineTo(Math.cos(ang) * R * 0.96, Math.sin(ang) * R * 0.96);
    }
    ctx.stroke();

    /* counter-rotating diamond orbit (drawn in rotated space) */
    ctx.rotate(-rot * 3.2);
    ctx.beginPath();
    for (i = 0; i < 4; i++) {
      var ang2 = (i / 4) * TAU + rot;
      var dx = Math.cos(ang2) * R * 0.73, dy = Math.sin(ang2) * R * 0.73;
      ctx.moveTo(dx, dy - 6); ctx.lineTo(dx + 6, dy);
      ctx.lineTo(dx, dy + 6); ctx.lineTo(dx - 6, dy); ctx.closePath();
    }
    ctx.stroke();

    /* three gap-arcs */
    ctx.rotate(rot * 1.4);
    for (i = 0; i < 3; i++) {
      var st = (i / 3) * TAU;
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.5, st, st + TAU * 0.22);
      ctx.stroke();
    }
    ctx.restore();
  }

  function horizonGlow(t) {
    var pulse = 0.5 + 0.5 * Math.sin(t * 0.0009);
    var ctx = S.ctx;
    var y = S.h + Math.min(S.w, S.h) * 0.12;
    glow(ctx, S.w / 2, y, Math.min(S.w, S.h) * (0.55 + 0.1 * pulse),
      '224,16,48', 0.16 + 0.07 * pulse);
  }

  /* ---------- static fallback (reduced motion) ---------- */

  function drawStatic() {
    if (!S.ctx) return;
    S.stage = S.target;
    paintBase(0);
    if (S.target >= 3) horizonGlow(0);
  }

  /* ---------- frame ---------- */

  function frame(ts) {
    if (!S.running) return;
    var dt = Math.min(0.05, (ts - S.prev) / 1000 || 0.016);
    S.prev = ts;
    var t = ts - S.t0;

    if (S.stage !== S.target) S.stage += S.target > S.stage ? 1 : -1;

    paintBase(t);

    if (S.stage <= 0) {
      paintDots(t);
    } else {
      paintDots(t);
      paintMist(t);
    }
    if (S.stage === 2) paintSparks(t, dt);   /* stage 3 budget: 54 embers only */
    if (S.stage >= 3) {
      runeCircle(t);
      paintEmberColumns(t, dt);
      horizonGlow(t);
    }
    vignette(S.ctx, S.stage >= 2 ? (S.stage - 1) / 2 : S.stage * 0.3,
      t * 0.0011 * (1 + S.stage * 0.35));

    S.raf = requestAnimationFrame(frame);
  }

  function startLoop() {
    if (S.running || !S.canvas) return;
    S.running = true;
    S.t0 = now();
    S.prev = S.t0;
    S.raf = requestAnimationFrame(frame);
  }

  function stopLoop() {
    S.running = false;
    if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
  }

  function onVisibility() {
    if (document.hidden) stopLoop();
    else startLoop();
  }

  /* ---------- public API ---------- */

  var GfxBg = {
    init: function () {
      if (S.mounted && !S.destroyed) return;
      if (typeof document === 'undefined') return;
      if (S.canvas) { try { S.canvas.parentNode.removeChild(S.canvas); } catch (e) {} }

      S.destroyed = false;
      S.mounted = true;
      try {
        S.reduced = !!(root.matchMedia &&
          matchMedia('(prefers-reduced-motion: reduce)').matches);
      } catch (e) { S.reduced = false; }

      var cv = document.createElement('canvas');
      cv.id = 'iqGfxBgCanvas';
      cv.setAttribute('style',
        'position:fixed;inset:0;z-index:0;pointer-events:none;display:block;');
      (document.body || document.documentElement).appendChild(cv);
      S.canvas = cv;
      S.ctx = cv.getContext('2d');
      if (!S.ctx) return;

      seed();
      resize();
      addEventListener('resize', resize);
      document.addEventListener('visibilitychange', onVisibility);
      S.stage = S.target;
      if (S.reduced) { drawStatic(); return; }
      startLoop();
    },

    setStage: function (n) {
      n = Math.max(0, Math.min(3, n | 0));
      if (!S.canvas || n === S.target) return;
      S.target = n;
      if (S.reduced) { drawStatic(); }
    },

    destroy: function () {
      stopLoop();
      removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      if (S.canvas) { try { S.canvas.parentNode.removeChild(S.canvas); } catch (e) {} }
      S.canvas = null; S.ctx = null;
      S.mounted = false; S.destroyed = true;
    }
  };

  root.IQ.GfxBg = GfxBg;

  /* self-mount once DOM is ready */
  function bootWhenReady() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        try { GfxBg.init(); } catch (e) {}
      });
    } else {
      try { GfxBg.init(); } catch (e) {}
    }
  }
  bootWhenReady();
})();
