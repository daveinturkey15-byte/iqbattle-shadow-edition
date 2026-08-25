/**
 * modes/slime.js — SLIME GALLERY: carnival shooting-gallery takeover stage
 * (vanilla JS/Canvas, asset-free). Upgraded playable version of the old emerald
 * interlude — this is now a full Stage per research/modes-arcade-design.md §6.
 *
 * Registration shape (speculative against research/mode-contract.md; thin adapter
 * below — if window.IQ.Stage is absent at load the def queues on
 * window.__stagePending for StageCore to drain):
 *   window.IQ.Stage && window.IQ.Stage.register({
 *     id: 'slime-gun-gallery',
 *     name: 'SLIME GALLERY',
 *     weight: 3,
 *     mount: function (container, ctx) { ... return Promise.resolve(stageResult); }
 *   });
 *
 * ctx fields consumed:
 *   depth (number)      -> difficulty notches via depthDiff curve (§0.4)
 *   align               -> slice {align,phase,harsh,calm,...} or plain string;
 *                          bad/chaotic +1 notch, calm −1, phase 'fire' doubles
 *                          hazard magnitudes, 'phoenix' ×1.5 final points
 *   rng   (mulberry32)  -> ONLY randomness source for the public spawn schedule
 *   seed  (number)      -> identity of the deterministic schedule
 *   mp    (boolean)     -> shows the seed-sync note in the stage header
 *   world/hp/score/streak -> never touched; this file NEVER mutates window.G.
 *
 * CONTROLS
 *   Click / tap a porthole (pointer position -> nearest lane). Keys 1–9 fire the
 *   matching lane (row-major). 250 ms recoil cooldown between shots, shown as a
 *   ring refill on the crosshair. Esc ends the round early (resolved pops only;
 *   un-shot slimes are neither hits nor escapes). Touch parity: taps are fires,
 *   portholes are far larger than 44 px.
 *
 * GAME RULES (design §6)
 *   Public schedule built ONCE from ctx.rng at mount: ~26 pops over 30 s, each
 *   {lane,t,type,up}, type normal(~70%)/decoy/decoy-ratio/gold(10%). Decoys wear
 *   crowns — shooting one costs points. Hit iff fired in the lane while the pop
 *   is live (generous ±window around emergence). Un-shot slimes escape.
 *   Depth scaling: up-window 1100->550 ms, decoy ratio 10%->30%, double-pops
 *   from diff>=3, gold flees after 700 ms at diff>=5.
 *
 * StageResult fields resolved:
 *   {
 *     kind:    'score',
 *     correct: true  (hits >= 12) | null (hits >= 6) | false (otherwise)
 *     points:  max(0, 25*normalHits + 80*goldHits - decoyCost*decoyShots
 *                     - 10*escapes)   [phoenix x1.5, capped 500]
 *     hpDelta: escapes >= 6 ? (phase 'fire' ? -15 : -10) : 0
 *              (telegraphed by the booth dimming from escape 4)
 *     summary: '"N SPLATS · G GOLD"' (<=48 chars)
 *   }
 *
 * TOKEN REWARDS (read-only integration): every gold splat banks an ammo token
 * into the shared per-run store, defensively through
 *   IQ.Hooks.state.set('packhunters:ammo', (get('packhunters:ammo')||0) + goldHits)
 * — the pack itself is never imported or mutated; absent Hooks is a no-op.
 *
 * DETERMINISM: PATTERN V-lite ("event validation"). The schedule is PUBLIC and
 * pure from (seed, depth, align), so local scoring is already the authoritative
 * computation for solo play; a host can re-validate any relayed shot event
 * against the same schedule without running a sim (see __SLIME_TOOLS__ below).
 * No hidden answers exist in this mode.
 *
 * FAIRNESS RAILS (§0.5): feedback is per-lane particles only (never a
 * fullscreen flash); booth dimming is a slow ramp, not a strobe; crosshair is
 * always visible; crowns readable at 12 px; IQB_MOTION=false disables shake and
 * halves particles; IQB_MUTED=true silences the lazily-created WebAudio blips;
 * controls hint visible for the first 3 s; hard self-resolve cap well under 45s.
 *
 * Self-play / smoke hooks (module level + per-round):
 *   window.__SLIME_TOOLS__      -> {effFor,upMsFor,windowMsFor,decoyRatioFor,
 *                                   buildSchedule}  (pure, host-replay safe)
 *   window.__GALLERY__.state()  -> live tallies + the public schedule
 *   window.__GALLERY__.fire(n)  -> fire lane n (0-based); 'hit'|'gold'|'decoy'
 *                                  |'miss'|'cooldown'
 *   window.__GALLERY__.warp(ms) -> smoke-only clock shift (pull the future closer)
 *   window.__GALLERY__.finish() -> force-resolve with current tallies
 */
(function () {
  'use strict';

  /* ============================ pure machinery ============================ */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  var CAP_MS = 30000;        // design round length
  var HARD_MS = 31000;       // absolute self-resolve backstop (< 45s rail)
  const POP_TARGET = 26;     // ~26 pops over the round
  const COOLDOWN_MS = 250;   // recoil between shots

  /** Difficulty notches: depthDiff curve + Align pressure (§0.4, max one notch). */
  function effFor(depth, alignSlice) {
    var a = alignSlice || {};
    var name = typeof a === 'string' ? a : a.align;
    var d = clamp(1 + Math.floor((depth | 0) / 6), 1, 5);
    if (name === 'bad' || name === 'chaotic') d += 1;
    if (a.calm) d -= 1;
    return clamp(d, 1, 5);
  }
  /** Time a slime stays up: 1100 ms -> 550 ms across the five notches. */
  function upMsFor(eff) { return Math.round(1100 - (clamp(eff, 1, 5) - 1) * 137.5); }
  /** Generous hit window around emergence: 190 ms -> 150 ms. */
  function windowMsFor(eff) { return 200 - clamp(eff, 1, 5) * 10; }
  /** Decoy share of pops: 10% -> 30%; gold fixed at 10%. */
  function decoyRatioFor(eff) { return 0.10 + (clamp(eff, 1, 5) - 1) * 0.05; }

  /**
   * Public spawn schedule — pure function of (rng, eff). Draw order is FIXED so
   * every tab holding the same seed derives a byte-identical schedule.
   * Returns [{lane, t, type:'normal'|'decoy'|'gold', up}] sorted by t.
   */
  function buildSchedule(rng, eff) {
    var LANES = 9;
    var upBase = upMsFor(eff);
    var decoyP = decoyRatioFor(eff);
    var goldFlees = eff >= 5;
    var busyUntil = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    var pops = [];
    function place(t, type) {
      // pick a free lane deterministically: rotate through lanes from a rng draw
      var start = Math.floor(rng() * LANES);
      var lane = -1;
      for (var k = 0; k < LANES; k++) {
        var c = (start + k) % LANES;
        if (t >= busyUntil[c]) { lane = c; break; }
      }
      if (lane < 0) { // all busy: schedule at the earliest freedom
        var best = 0;
        for (var b = 1; b < LANES; b++) if (busyUntil[b] < busyUntil[best]) best = b;
        lane = best; t = busyUntil[best];
      }
      var up = type === 'gold' && goldFlees ? Math.min(upBase, 700) : upBase;
      pops.push({ lane: lane, t: Math.round(t), type: type, up: up });
      busyUntil[lane] = t + up + 60; // small turnaround gap
    }
    var spacing = (CAP_MS - 3200) / POP_TARGET;
    for (var i = 0; i < POP_TARGET; i++) {
      var t = 900 + i * spacing + (rng() * 420 - 210);
      var r = rng();
      var type = r < 0.10 ? 'gold' : (r < 0.10 + decoyP ? 'decoy' : 'normal');
      place(Math.max(400, t), type);
      // double-pops: two lanes burst at once from notch 3 (~25% of beats)
      if (eff >= 3 && rng() < 0.25 && i % 3 === 1) {
        var r2 = rng();
        var t2type = r2 < 0.10 ? 'gold' : (r2 < 0.10 + decoyP ? 'decoy' : 'normal');
        place(Math.max(400, t) + 40, t2type);
      }
    }
    pops.sort(function (a, b) { return a.t - b.t || a.lane - b.lane; });
    return pops;
  }

  /** Host-replay helpers stay reachable without mounting a round. */
  window.__SLIME_TOOLS__ = {
    effFor: effFor, upMsFor: upMsFor, windowMsFor: windowMsFor,
    decoyRatioFor: decoyRatioFor, buildSchedule: buildSchedule,
    CAP_MS: CAP_MS, COOLDOWN_MS: COOLDOWN_MS
  };

  /* ============================ registration ============================== */

  function flagOff(name) { // IQB_MOTION=false / IQB_MUTED=true readers
    try {
      var v = window.localStorage.getItem(name);
      if (name === 'IQB_MUTED') return v === '1' || /^(1|true)$/i.test(String(v));
      return /^(0|false)$/i.test(String(v));
    } catch (e) { return false; }
  }

  function mount(container, ctx) {
    return new Promise(function (resolve) {
      var align = ctx.align || {};
      var eff = effFor(ctx.depth, align);
      var WIN = windowMsFor(eff);
      var DECOY_COST = (align.phase === 'fire' || align.harsh === 2) ? 60 : 30;
      var HP_HIT = (align.phase === 'fire' || align.harsh === 2) ? -15 : -10;
      var PHOENIX = align.phase === 'phoenix';
      var motionOff = flagOff('IQB_MOTION');

      /* ---------- dom ---------- */
      var wrap = document.createElement('div');
      wrap.className = 'iq-gallery';
      var head = document.createElement('div');
      head.className = 'iq-gallery-head';
      var title = document.createElement('span');
      title.textContent = 'SLIME GALLERY \u00B7 LV' + eff;
      var meta = document.createElement('span');
      meta.className = 'iq-gallery-meta';
      meta.textContent = 'click / tap / keys 1\u20139 \u00B7 crowns cost you';
      head.appendChild(title);
      head.appendChild(meta);
      var canvas = document.createElement('canvas');
      canvas.className = 'iq-gallery-canvas';
      var hint = document.createElement('div');
      hint.className = 'iq-gallery-hint';
      hint.textContent = 'SHOOT SLIMES \u00B7 DON\u2019T SHOOT THE CROWN \u00B7 GOLD HEALS THE ARMORY';
      var foot = document.createElement('div');
      foot.className = 'iq-gallery-foot';
      wrap.appendChild(head);
      wrap.appendChild(canvas);
      wrap.appendChild(hint);
      wrap.appendChild(foot);
      container.appendChild(wrap);
      if (ctx.mp) {
        var note = document.createElement('div');
        note.className = 'iq-gallery-note';
        note.textContent = 'public seed-synced schedule \u2014 same board on every tab';
        wrap.appendChild(note);
      }
      var style = document.createElement('style');
      style.textContent =
        '.iq-gallery{display:flex;flex-direction:column;align-items:center;gap:6px;' +
        'color:#ffe9b0;font-family:Oxanium,monospace;background:#170409;padding:8px;' +
        'border-radius:8px;border:1px solid #4a1420}' +
        '.iq-gallery-head{display:flex;justify-content:space-between;width:100%;' +
        'font-size:13px;letter-spacing:1px;color:#ffc94a}.iq-gallery-meta{color:#a86a4f;font-size:11px}' +
        '.iq-gallery-hint{font-size:12px;color:#ffd98a;letter-spacing:1px;' +
        'transition:opacity .5s}.iq-gallery-foot{font-size:12px;color:#fff3d6;min-height:16px}' +
        '.iq-gallery-note{font-size:11px;color:#c98a5f}' +
        '.iq-gallery canvas{background:#170409;border:2px solid #4a1420;border-radius:6px;' +
        'touch-action:none;cursor:crosshair}';
      wrap.appendChild(style);

      /* ---------- deterministic public schedule ---------- */
      var pops = buildSchedule(ctx.rng, eff);
      var ptr = 0;

      /* ---------- state ---------- */
      var normalHits = 0, goldHits = 0, decoyShots = 0, escapes = 0;
      var finished = false, aborted = false;
      var lastShot = -1e9;
      var crossX = 0, crossY = 0, haveCross = false;
      var laneFlash = -1, laneFlashUntil = 0;
      var shakeUntil = 0;
      var particles = [];
      var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      var rafId = 0, tickId = 0, hardId = 0, hintId = 0;

      function elapsed() {
        return (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      }

      /* ---------- audio (muted-gated, lazily created) ---------- */
      var audioCtx = null;
      function beep(freq, ms, type, gain) {
        if (flagOff('IQB_MUTED')) return;
        try {
          if (!audioCtx) {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            audioCtx = new AC();
          }
          var o = audioCtx.createOscillator();
          var g = audioCtx.createGain();
          o.type = type || 'square';
          o.frequency.value = freq;
          g.gain.setValueAtTime(gain || 0.04, audioCtx.currentTime);
          g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000);
          o.connect(g).connect(audioCtx.destination);
          o.start();
          o.stop(audioCtx.currentTime + ms / 1000);
        } catch (e) { /* never let audio break gameplay */ }
      }

      /* ---------- sizing (DPR-aware) ---------- */
      var cssW = 640, cssH = 480, dpr = 1;
      function fit() {
        try { dpr = window.devicePixelRatio || 1; } catch (e) { dpr = 1; }
        var cw = (container.clientWidth || 680) - 24;
        var chh = (container.clientHeight || 540) - 24;
        cssW = Math.max(320, Math.min(cw, 720));
        cssH = Math.max(300, Math.min(chh, 520));
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        canvas.style.width = cssW + 'px';
        canvas.style.height = cssH + 'px';
      }

      /* ---------- geometry ---------- */
      function laneCenter(lane) {
        var top = 40, m = 10;
        var cw = (cssW - 2 * m) / 3;
        var chh = (cssH - top - m) / 3;
        return {
          x: m + cw * ((lane % 3) + 0.5),
          y: top + chh * (Math.floor(lane / 3) + 0.5),
          r: Math.max(26, Math.min(cw, chh) / 2 - 8)
        };
      }
      function laneAt(px, py) {
        var top = 40, m = 10;
        var cw = (cssW - 2 * m) / 3;
        var chh = (cssH - top - m) / 3;
        var col = Math.floor((px - m) / cw), row = Math.floor((py - top) / chh);
        if (col < 0 || col > 2 || row < 0 || row > 2) return -1;
        return row * 3 + col;
      }

      /* ---------- shooting ---------- */
      function fire(lane) {
        if (finished) return 'done';
        var now = elapsed();
        if (now - lastShot < COOLDOWN_MS) return 'cooldown';
        lastShot = now;
        laneFlash = lane; laneFlashUntil = now + 140;
        var hitPop = null;
        for (var i = ptr; i < pops.length; i++) {
          var p = pops[i];
          if (p.done) continue;
          if (p.lane !== lane) continue;
          if (now >= p.t - WIN && now <= p.t + p.up) { hitPop = p; break; }
          if (p.t - WIN > now) break; // sorted by t: nothing later can be live
        }
        if (!hitPop) {
          beep(220, 30, 'square', 0.02);
          return 'miss';
        }
        hitPop.done = true;
        hitPop.hit = true;
        var c = laneCenter(lane);
        splat(c.x, c.y, hitPop.type);
        if (hitPop.type === 'decoy') {
          decoyShots++;
          beep(140, 200, 'sawtooth', 0.05);
          if (!motionOff) shakeUntil = now + 120;
          return 'decoy';
        }
        if (hitPop.type === 'gold') {
          goldHits++;
          beep(880, 70); beep(1320, 90);
          return 'gold';
        }
        normalHits++;
        beep(660, 60);
        return 'hit';
      }

      function splat(x, y, type) {
        var col = type === 'gold' ? '#ffd24a' : type === 'decoy' ? '#b06adf' : '#59ff8a';
        var n = motionOff ? 5 : 11;
        for (var i = 0; i < n; i++) {
          var a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
          var sp = 40 + Math.random() * 90;
          particles.push({
            x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
            r: 2 + Math.random() * 3.5, life: 600, age: 0, col: col
          });
        }
      }

      /* ---------- simulation tick ---------- */
      function simTick() {
        if (finished) return;
        var now = elapsed();
        while (ptr < pops.length && now > pops[ptr].t + pops[ptr].up) {
          var p = pops[ptr];
          if (!p.done) { p.done = true; p.escaped = true; escapes++; beep(110, 80, 'sine', 0.02); }
          ptr++;
        }
        syncTopbar(now);
        if (aborted || now >= CAP_MS || ptr >= pops.length) { finish(); return; }
        tickId = window.setTimeout(simTick, 50);
      }

      function syncTopbar(now) {
        try {
          var remain = Math.max(0, CAP_MS - now);
          var fill = document.getElementById('timer-fill');
          var num = document.getElementById('timer-num');
          if (fill) fill.style.transform = 'scaleX(' + (remain / CAP_MS).toFixed(4) + ')';
          if (num) num.textContent = String(Math.ceil(remain / 1000));
        } catch (e) { /* topbar chrome is optional */ }
      }

      /* ---------- resolution ---------- */
      function finish() {
        if (finished) return;
        finished = true;
        clearTimeout(tickId); clearTimeout(hardId); clearTimeout(hintId);
        cancelAnimationFrame(rafId);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('resize', fit);
        detachPointer();
        try { audioCtx && audioCtx.close && audioCtx.close(); } catch (e) {}

        var hits = normalHits + goldHits;
        var pts = 25 * normalHits + 80 * goldHits -
                  DECOY_COST * decoyShots - 10 * escapes;
        pts = Math.max(0, pts);
        if (PHOENIX) pts = Math.round(pts * 1.5);
        pts = Math.min(500, pts);
        var res = {
          kind: 'score',
          correct: hits >= 12 ? true : (hits >= 6 ? null : false),
          points: pts,
          hpDelta: escapes >= 6 ? HP_HIT : 0,
          summary: hits + ' SPLATS \u00B7 ' + goldHits + ' GOLD'
        };

        /* token rewards: gold splats bank ammo for the hunters' armory.
         * Strictly additive write of the documented shared key; absent or
         * foreign store implementations are silently ignored. */
        if (goldHits > 0) {
          try {
            var H = window.IQ && window.IQ.Hooks;
            if (H && H.state && typeof H.state.get === 'function' &&
                typeof H.state.set === 'function') {
              H.state.set('packhunters:ammo', (H.state.get('packhunters:ammo') || 0) + goldHits);
            }
          } catch (e) { /* read-only integration: never fatal */ }
        }

        foot.textContent = aborted ? 'BOOTH CLOSED EARLY \u00B7 ' + res.summary :
          (escapes >= 6 ? 'THE SLIMES OVER-RAN THE BOOTH \u00B7 ' : '') + res.summary;
        resolve(res);
      }

      /* ---------- render ---------- */
      var lastFrame = 0;
      function draw(ts) {
        if (finished) return;
        var now = elapsed();
        var dt = lastFrame ? Math.min(64, ts - lastFrame) : 16;
        lastFrame = ts;
        var g = canvas.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        var shx = 0, shy = 0;
        if (now < shakeUntil) { shx = (Math.random() * 6 - 3); shy = (Math.random() * 6 - 3); }
        g.translate(shx, shy);

        /* booth backdrop: curtain stripes + marquee band (never flashes) */
        g.fillStyle = '#1c060d';
        g.fillRect(-6, -6, cssW + 12, cssH + 12);
        g.fillStyle = '#260a13';
        for (var sx = 0; sx < cssW; sx += 48) g.fillRect(sx, 0, 24, cssH);
        g.fillStyle = '#33121f';
        g.fillRect(0, 0, cssW, 32);
        g.fillStyle = '#ffc94a';
        g.font = 'bold 16px Oxanium,monospace';
        g.textAlign = 'center';
        g.fillText('\u272C SLIME GALLERY \u272C', cssW / 2, 22);

        /* portholes + slimes */
        for (var lane = 0; lane < 9; lane++) {
          var c = laneCenter(lane);
          g.beginPath();
          g.arc(c.x, c.y, c.r + 4, 0, Math.PI * 2);
          g.fillStyle = '#0d0510';
          g.fill();
          g.lineWidth = 3;
          g.strokeStyle = '#c9a227';
          g.stroke();

          /* live pop? (rise in, sink out; escape lands exactly at t+up) */
          var live = null;
          for (var i = ptr; i < pops.length; i++) {
            var p = pops[i];
            if (p.done) continue;
            if (p.t - 9999 > now) break;
            if (now >= p.t - 200 && now <= p.t + p.up && p.lane === lane) { live = p; break; }
          }
          if (live) {
            var rise = clamp((now - live.t) / 160, 0, 1);
            var sink = clamp((now - (live.t + live.up - 140)) / 140, 0, 1);
            var yo = (1 - rise) * (c.r + 14) + sink * (c.r + 16);
            var bob = motionOff ? 0 : Math.sin(now / 90) * 2;
            drawSlime(g, c.x, c.y + yo + bob, c.r, live.type, now);
          }

          /* lane numeral for keyboard parity (readable >= 12px) */
          g.fillStyle = '#c9a22788';
          g.font = '12px Oxanium,monospace';
          g.textAlign = 'left';
          g.fillText(String(lane + 1), c.x - c.r + 4, c.y - c.r + 14);

          if (now < laneFlashUntil && laneFlash === lane) {
            g.beginPath(); g.arc(c.x, c.y, c.r - 2, 0, Math.PI * 2);
            g.strokeStyle = '#ffffff77'; g.lineWidth = 2; g.stroke();
          }
        }

        /* per-lane splat particles (localized; never fullscreen) */
        for (var pi = particles.length - 1; pi >= 0; pi--) {
          var q = particles[pi];
          q.age += dt;
          if (q.age >= q.life) { particles.splice(pi, 1); continue; }
          q.vy += 260 * dt / 1000;
          q.x += q.vx * dt / 1000;
          q.y += q.vy * dt / 1000;
          g.globalAlpha = 1 - q.age / q.life;
          g.fillStyle = q.col;
          g.beginPath(); g.arc(q.x, q.y, q.r, 0, Math.PI * 2); g.fill();
        }
        g.globalAlpha = 1;

        /* sustained-neglect telegraph: slow dim ramp from escape 4 (no strobe) */
        if (escapes >= 4) {
          g.fillStyle = 'rgba(0,0,0,' + Math.min(0.36, (escapes - 4) * 0.12 + 0.06) + ')';
          g.fillRect(-6, -6, cssW + 12, cssH + 12);
        }

        drawCrosshair(g, now);

        foot.textContent = 'SPLATS ' + (normalHits + goldHits) +
          ' \u00B7 GOLD ' + goldHits +
          ' \u00B7 ESCAPED ' + escapes +
          ' \u00B7 ' + Math.max(0, Math.ceil((CAP_MS - now) / 1000)) + 's';
        rafId = window.requestAnimationFrame(draw);
      }

      function drawSlime(g, x, y, r, type, now) {
        var body = type === 'gold' ? '#ffd24a' : type === 'decoy' ? '#b06adf' : '#39d96a';
        var dark = type === 'gold' ? '#a97b12' : type === 'decoy' ? '#5f2d80' : '#1c7a38';
        var rx = r * 0.58, ry = r * 0.46;
        if (type === 'gold' && !motionOff) { /* calm glow ring, not a flash */
          g.beginPath(); g.arc(x, y, rx + 6 + Math.sin(now / 120) * 2, 0, Math.PI * 2);
          g.strokeStyle = '#ffd24a55'; g.lineWidth = 2; g.stroke();
        }
        g.beginPath();
        g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        g.fillStyle = body; g.fill();
        g.lineWidth = 2; g.strokeStyle = dark; g.stroke();
        /* shine */
        g.beginPath(); g.ellipse(x - rx * 0.3, y - ry * 0.35, rx * 0.22, ry * 0.16, -0.5, 0, Math.PI * 2);
        g.fillStyle = '#ffffffaa'; g.fill();
        /* eyes track the crosshair */
        var ang = haveCross ? Math.atan2(crossY - y, crossX - x) : Math.PI * 1.5;
        var edx = Math.cos(ang) * 1.6, edy = Math.sin(ang) * 1.6;
        for (var e = -1; e <= 1; e += 2) {
          var ex = x + e * rx * 0.34, ey = y - ry * 0.2;
          g.beginPath(); g.arc(ex, ey, r * 0.09, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
          g.beginPath(); g.arc(ex + edx, ey + edy, r * 0.045, 0, Math.PI * 2); g.fillStyle = '#111'; g.fill();
        }
        /* mouth */
        g.beginPath(); g.arc(x, y + ry * 0.25, rx * 0.22, 0.15 * Math.PI, 0.85 * Math.PI);
        g.strokeStyle = dark; g.lineWidth = 2; g.stroke();
        /* decoy crown: high-contrast marker, readable at 12 px */
        if (type === 'decoy') {
          var cy0 = y - ry - r * 0.16, w = rx * 0.9, h = r * 0.22;
          g.beginPath();
          g.moveTo(x - w / 2, cy0);
          g.lineTo(x - w / 2, cy0 - h * 0.6);
          g.lineTo(x - w / 4, cy0 - h * 0.2);
          g.lineTo(x, cy0 - h);
          g.lineTo(x + w / 4, cy0 - h * 0.2);
          g.lineTo(x + w / 2, cy0 - h * 0.6);
          g.lineTo(x + w / 2, cy0);
          g.closePath();
          g.fillStyle = '#ffd24a'; g.fill();
          g.lineWidth = 1.5; g.strokeStyle = '#5a3d00'; g.stroke();
        }
      }

      function drawCrosshair(g, now) {
        var x = haveCross ? crossX : cssW / 2;
        var y = haveCross ? crossY : cssH * 0.55;
        var ready = now - lastShot >= COOLDOWN_MS;
        var frac = clamp((now - lastShot) / COOLDOWN_MS, 0, 1);
        g.strokeStyle = ready ? '#7dff9e' : '#c9a227';
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.stroke();
        if (frac < 1) { /* recoil refill ring */
          g.beginPath(); g.arc(x, y, 15, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
          g.stroke();
        }
        g.beginPath();
        g.moveTo(x - 19, y); g.lineTo(x - 6, y);
        g.moveTo(x + 6, y); g.lineTo(x + 19, y);
        g.moveTo(x, y - 19); g.lineTo(x, y - 6);
        g.moveTo(x, y + 6); g.lineTo(x, y + 19);
        g.stroke();
        g.fillStyle = ready ? '#7dff9e' : '#c9a227';
        g.fillRect(x - 1, y - 1, 2, 2);
      }

      /* ---------- input ---------- */
      function canvasPos(e) {
        var rect = { left: 0, top: 0, width: cssW, height: cssH };
        try {
          var r2 = canvas.getBoundingClientRect();
          if (r2) rect = r2;
        } catch (err) {}
        return {
          x: (e.clientX - rect.left) * (cssW / (rect.width || cssW)),
          y: (e.clientY - rect.top) * (cssH / (rect.height || cssH))
        };
      }
      function onMove(e) {
        var p = canvasPos(e);
        crossX = p.x; crossY = p.y; haveCross = true;
      }
      function onDown(e) {
        e.preventDefault();
        var p = canvasPos(e);
        crossX = p.x; crossY = p.y; haveCross = true;
        var lane = laneAt(p.x, p.y);
        if (lane >= 0) fire(lane);
      }
      function onKey(e) {
        var lane = -1;
        if (/^Digit[1-9]$/.test(e.code)) lane = Number(e.code.slice(5)) - 1;
        else if (/^Numpad[1-9]$/.test(e.code)) lane = Number(e.code.slice(6)) - 1;
        else if (e.code === 'Escape') { aborted = true; finish(); return; }
        else return;
        e.preventDefault();
        if (lane >= 0) fire(lane);
      }

      var usePointer = false;
      try { usePointer = !!window.PointerEvent; } catch (e) {}
      function attachPointer() {
        if (usePointer) {
          canvas.addEventListener('pointermove', onMove);
          canvas.addEventListener('pointerdown', onDown);
        } else {
          canvas.addEventListener('mousemove', onMove);
          canvas.addEventListener('mousedown', onDown);
          canvas.addEventListener('touchstart', function (t) {
            if (t.changedTouches && t.changedTouches[0]) {
              onMove(t.changedTouches[0]);
              onDown(t.changedTouches[0]);
            }
          }, { passive: false });
        }
      }
      function detachPointer() {
        try {
          if (usePointer) {
            canvas.removeEventListener('pointermove', onMove);
            canvas.removeEventListener('pointerdown', onDown);
          } else {
            canvas.removeEventListener('mousemove', onMove);
            canvas.removeEventListener('mousedown', onDown);
          }
        } catch (e) {}
      }
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', fit);
      attachPointer();

      /* ---------- self-play / smoke hook ---------- */
      window.__GALLERY__ = {
        fire: fire,
        state: function () {
          var resolved = 0;
          for (var i = 0; i < pops.length; i++) if (pops[i].done) resolved++;
          return {
            eff: eff, hits: normalHits + goldHits, normalHits: normalHits,
            goldHits: goldHits, decoyShots: decoyShots, escapes: escapes,
            resolved: resolved, total: pops.length,
            elapsedMs: Math.round(elapsed()), finished: finished,
            windowMs: WIN, cooldownMs: COOLDOWN_MS,
            ammo: (function () {
              try {
                var H = window.IQ && window.IQ.Hooks;
                return H && H.state ? H.state.get('packhunters:ammo') : undefined;
              } catch (e) { return undefined; }
            })(),
            schedule: pops.map(function (p) {
              return { lane: p.lane, t: p.t, type: p.type, up: p.up };
            })
          };
        },
        warp: function (ms) { t0 -= ms; },           // smoke-only clock shift
        finish: function () { if (!finished) finish(); }
      };

      /* ---------- go ---------- */
      fit();
      hintId = window.setTimeout(function () { hint.style.opacity = '0'; }, 3000);
      rafId = window.requestAnimationFrame(draw);
      tickId = window.setTimeout(simTick, 50);
      hardId = window.setTimeout(finish, HARD_MS); // fairness rail: never overrun
    });
  }

  function register() {
    var def = {
      id: 'slime-gun-gallery',
      name: 'SLIME GALLERY',
      weight: 3,
      mount: mount
    };
    try {
      if (window.IQ && window.IQ.Stage && typeof window.IQ.Stage.register === 'function') {
        window.IQ.Stage.register(def);
        return;
      }
    } catch (e) { /* fall through to pending queue */ }
    (window.__stagePending = window.__stagePending || []).push(def);
  }

  register();
})();
