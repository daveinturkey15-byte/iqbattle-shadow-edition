/* IQ.Chaos — screen juice layer for IQ BATTLE (embers, shake, glitch, flashes). */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};

  var CSS_ID = 'iq-chaos-style';
  var CSS = [
    '#iqChaosCanvas{position:fixed;inset:0;z-index:2147483000;pointer-events:none;mix-blend-mode:screen;}',
    '#iqChaosFx{position:fixed;inset:0;z-index:2147483001;pointer-events:none;}',
    '#iqChaosFx .iq-flash{position:absolute;inset:0;opacity:0;background:#000;}',
    '#iqChaosFx .iq-vignette{position:absolute;inset:0;opacity:0;',
      'background:radial-gradient(ellipse at center,transparent 45%,rgba(0,0,0,.85) 100%);}',
    '#iqChaosFx .iq-scanlines{position:absolute;inset:0;opacity:0;',
      'background:repeating-linear-gradient(0deg,rgba(0,0,0,.28) 0 2px,transparent 2px 4px);}',
    '@keyframes iqShake{',
      '0%{transform:translate(0,0)}10%{transform:translate(var(--iqsx),calc(var(--iqsy)*-.7))}',
      '20%{transform:translate(calc(var(--iqsx)*-.8),var(--iqsy))}30%{transform:translate(calc(var(--iqsx)*.6),calc(var(--iqsy)*-.5))}',
      '40%{transform:translate(calc(var(--iqsx)*-.9),calc(var(--iqsy)*.6))}50%{transform:translate(var(--iqsx),calc(var(--iqsy)*-.4))}',
      '60%{transform:translate(calc(var(--iqsx)*-.6),var(--iqsy))}70%{transform:translate(calc(var(--iqsx)*.5),calc(var(--iqsy)*-.6))}',
      '80%{transform:translate(calc(var(--iqsx)*-.4),calc(var(--iqsy)*.4))}90%{transform:translate(calc(var(--iqsx)*.3),calc(var(--iqsy)*-.3))}',
      '100%{transform:translate(0,0)}}',
    '@keyframes iqGlitch{',
      '0%,100%{clip-path:inset(0);text-shadow:none;filter:none;transform:none}',
      '10%{clip-path:inset(12% 0 62% 0);text-shadow:-3px 0 rgba(255,0,60,.8),3px 0 rgba(0,255,255,.8);transform:translateX(-6px)}',
      '20%{clip-path:inset(58% 0 8% 0);text-shadow:3px 0 rgba(255,0,60,.8),-3px 0 rgba(0,255,255,.8);transform:translateX(5px)}',
      '30%{clip-path:inset(32% 0 44% 0);text-shadow:-4px 0 rgba(255,0,60,.7),4px 0 rgba(0,255,255,.7);transform:translateX(-4px) skewX(2deg)}',
      '45%{clip-path:inset(72% 0 4% 0);text-shadow:2px 0 rgba(255,0,60,.9),-2px 0 rgba(0,255,255,.9);transform:translateX(6px)}',
      '60%{clip-path:inset(4% 0 84% 0);text-shadow:-3px 0 rgba(255,0,60,.8),3px 0 rgba(0,255,255,.8);transform:translateX(-5px)}',
      '75%{clip-path:inset(48% 0 26% 0);text-shadow:4px 0 rgba(255,0,60,.6),-4px 0 rgba(0,255,255,.6);transform:translateX(3px)}}'
  ].join('');

  var state = {
    mounted: false,
    container: null,
    fx: null,
    canvas: null,
    ctx: null,
    intensity: 1,
    act: 0,
    embersOn: false,
    parts: [],
    rafId: 0,
    glitchTimer: 0,
    lastT: 0,
    breathT: 0
  };

  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }

  function injectCss(doc) {
    if (!doc || doc.getElementById(CSS_ID)) return;
    var s = doc.createElement('style');
    s.id = CSS_ID;
    s.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }

  function mount(container) {
    return safe(function () {
      if (!container || typeof container.appendChild !== 'function') return false;
      injectCss(container.ownerDocument || document);
      state.container = container;
      if (!state.canvas) {
        var d = container.ownerDocument || document;
        state.canvas = d.createElement('canvas');
        state.canvas.id = 'iqChaosCanvas';
        state.fx = d.createElement('div');
        state.fx.id = 'iqChaosFx';
        state.fx.innerHTML =
          '<div class="iq-flash"></div><div class="iq-vignette"></div><div class="iq-scanlines"></div>';
        d.body.appendChild(state.canvas);
        d.body.appendChild(state.fx);
        state.ctx = state.canvas.getContext('2d');
        resize();
        root.addEventListener('resize', resize);
      }
      state.mounted = true;
      applyAct();
      return true;
    }) || false;
  }

  function resize() {
    safe(function () {
      if (!state.canvas) return;
      state.canvas.width = root.innerWidth || 1280;
      state.canvas.height = root.innerHeight || 720;
    });
  }

  /* ---- rAF loop: runs only while needed ---- */
  function ensureLoop() {
    safe(function () {
      if (state.rafId || !state.ctx) return;
      state.lastT = 0;
      state.rafId = requestAnimationFrame(tick);
    });
  }
  function maybeStopLoop() {
    safe(function () {
      if (state.rafId && !state.embersOn && state.act < 2) {
        cancelAnimationFrame(state.rafId);
        state.rafId = 0;
        clearCanvas();
      }
    });
  }
  function tick(t) {
    state.rafId = requestAnimationFrame(tick);
    try {
      var dt = state.lastT ? Math.min((t - state.lastT) / 1000, 0.1) : 0.016;
      state.lastT = t;
      if (state.embersOn) drawEmbers(dt);
      else clearCanvas();
      if (state.act === 2) breatheVignette(dt);
      maybeStopLoop();
    } catch (e) { /* no-throw */ }
  }
  function clearCanvas() {
    var c = state.canvas;
    if (c) state.ctx.clearRect(0, 0, c.width, c.height);
  }

  /* ---- embers ---- */
  function spawnPart(w, h) {
    return {
      x: Math.random() * w,
      y: h + 20 + Math.random() * 40,
      vx: (Math.random() - 0.5) * 24,
      vy: -(30 + Math.random() * 90),
      life: 1,
      decay: 0.15 + Math.random() * 0.35,
      size: 1 + Math.random() * 2.6,
      hue: 8 + Math.random() * 34
    };
  }
  function drawEmbers(dt) {
    var c = state.canvas, ctx = state.ctx;
    if (!c || !ctx) return;
    var target = Math.round(120 * state.intensity);
    ctx.clearRect(0, 0, c.width, c.height);
    while (state.parts.length < target) state.parts.push(spawnPart(c.width, c.height));
    if (state.parts.length > target) state.parts.length = target;
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < state.parts.length; i++) {
      var p = state.parts[i];
      p.x += p.vx * dt * (0.6 + state.intensity);
      p.y += p.vy * dt * (0.6 + state.intensity);
      p.life -= p.decay * dt;
      if (p.life <= 0 || p.y < -20) { state.parts[i] = spawnPart(c.width, c.height); continue; }
      var a = Math.max(p.life, 0) * 0.85;
      ctx.fillStyle = 'hsla(' + p.hue.toFixed(0) + ',100%,' + (45 + p.life * 20).toFixed(0) + '%,' + a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + p.life * 0.7), 0, 6.2832);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---- effects ---- */
  function el(sel) {
    return state.fx ? state.fx.querySelector(sel) : null;
  }
  function fade(elm, on, ms) {
    if (!elm) return;
    elm.style.transition = 'opacity ' + ms + 'ms ease-out';
    elm.style.opacity = on ? '1' : '0';
  }

  function shake(px, ms) {
    safe(function () {
      var c = state.container;
      if (!c || !c.style) return;
      px = (typeof px === 'number' ? px : 8) * (0.5 + state.intensity);
      ms = typeof ms === 'number' ? ms : 300;
      c.style.setProperty('--iqsx', px + 'px');
      c.style.setProperty('--iqsy', (px * 0.6) + 'px');
      c.style.animation = 'none';
      void c.offsetWidth; // restart animation
      c.style.animation = 'iqShake ' + ms + 'ms linear both';
      clearTimeout(shake._t);
      shake._t = setTimeout(function () { safe(function () { c.style.animation = ''; }); }, ms + 30);
    });
  }

  function glitch(ms) {
    safe(function () {
      var c = state.container;
      if (!c) return;
      ms = typeof ms === 'number' ? ms : 400;
      c.style.animation = 'none';
      void c.offsetWidth;
      c.style.animation = 'iqGlitch ' + ms + 'ms steps(1,end) both';
      clearTimeout(glitch._t);
      glitch._t = setTimeout(function () {
        safe(function () { c.style.animation = ''; });
      }, ms + 30);
    });
  }

  function flash(color, ms) {
    safe(function () {
      var f = el('.iq-flash');
      if (!f) return;
      f.style.background = color || 'rgba(255,0,0,.25)';
      ms = typeof ms === 'number' ? ms : 200;
      f.style.transition = 'none';
      f.style.opacity = '1';
      setTimeout(function () { safe(function () { fade(f, false, ms); }); }, 16);
    });
  }

  function invert(ms) {
    safe(function () {
      var f = state.fx;
      if (!f) return;
      ms = typeof ms === 'number' ? ms : 500;
      f.style.filter = 'invert(1)';
      setTimeout(function () { safe(function () { f.style.filter = ''; }); }, ms);
    });
  }

  function pulse() {
    safe(function () {
      var v = el('.iq-vignette');
      if (!v) return;
      v.style.transition = 'none';
      v.style.opacity = '0.85';
      setTimeout(function () {
        safe(function () { fade(v, false, 450); });
      }, 60);
    });
  }

  function breatheVignette(dt) {
    safe(function () {
      var v = el('.iq-vignette');
      if (!v) return;
      state.breathT += dt;
      var b = 0.35 + 0.25 * Math.sin(state.breathT * 2.2);
      v.style.background = 'radial-gradient(ellipse at center,transparent 38%,rgba(140,0,0,.75) 100%)';
      v.style.opacity = b.toFixed(3);
    });
  }

  /* ---- toggles / config ---- */
  function embers(on) {
    safe(function () {
      state.embersOn = !!on;
      if (on) { state.parts = []; ensureLoop(); }
      else { state.parts = []; clearCanvas(); maybeStopLoop(); }
    });
  }

  function setIntensity(v) {
    safe(function () {
      v = Number(v);
      state.intensity = isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
      if (!state.embersOn) return;
      if (state.intensity <= 0) embers(false);
      else ensureLoop();
    });
  }

  function scheduleAutoGlitch() {
    safe(function () {
      clearTimeout(state.glitchTimer);
      if (state.act !== 1 || !root.document) return;
      var wait = 6000 + Math.random() * 12000;
      state.glitchTimer = setTimeout(function () {
        safe(function () {
          if (state.act === 1) glitch(120 + Math.random() * 180);
          scheduleAutoGlitch();
        });
      }, wait);
    });
  }

  function applyAct() {
    safe(function () {
      var scan = el('.iq-scanlines'), vig = el('.iq-vignette');
      if (state.act === 0) {
        embers(false);
        fade(scan, false, 300);
        if (vig) {
          vig.style.background = '';
          fade(vig, true, 500);
          vig.style.opacity = '0.18'; // subtle clean vignette
        }
        clearTimeout(state.glitchTimer);
      } else if (state.act === 1) {
        embers(false);
        fade(scan, false, 300);
        if (vig) { vig.style.background = ''; vig.style.opacity = '0.3'; }
        scheduleAutoGlitch();
      } else { // act 2
        if (!state.embersOn) embers(true);
        fade(scan, true, 600);
        if (vig) vig.style.opacity = '0.4'; // base; breathing overrides each frame
        state.breathT = 0;
        ensureLoop();
      }
      maybeStopLoop();
    });
  }

  function setAct(a) {
    safe(function () {
      a = a | 0;
      if (a < 0 || a > 2) return;
      state.act = a;
      applyAct();
    });
  }

  root.IQ.Chaos = {
    mount: mount,
    shake: shake,
    glitch: glitch,
    flash: flash,
    invert: invert,
    pulse: pulse,
    embers: embers,
    setIntensity: setIntensity,
    setAct: setAct
  };

  if (typeof module !== 'undefined') module.exports = root.IQ.Chaos;
})();
