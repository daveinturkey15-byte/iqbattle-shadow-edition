/**
 * modes/madmax.js — FURY ROADRUN: Mad-Max-parody war-rig highway takeover stage.
 * (vanilla JS/Canvas, asset-free; sibling of modes/snake.js)
 *
 * REGISTRATION SHAPE (queued on window.__stagePending when IQ.Stage is absent):
 *   IQ.Stage.register({
 *     id: 'fury-roadrun', name: 'FURY ROADRUN', weight: 4,
 *     worlds: ['wasteland-roads'],   // binds the already-registered world (never re-registers it)
 *     net: 'seed',
 *     mount(container, ctx) -> Promise<StageResult>
 *   });
 *
 * HOW IT PLAYS
 *   Side-scrolling war-rig highway, 3 lanes. Up/Down to change lanes.
 *   - A rule banner at mount announces a seeded TRUE SIGN sequence (e.g. BONE -> BRASS ->
 *     VENOM). Collect skull signs in that order: each true pick pays (8+12*diff) + 5*combo
 *     and advances the lock; completing it pays +12+24*diff ("SEQUENCE LOCKED").
 *   - Spike-trap potholes are telegraphed (amber marker while >= ~0.9 s out, spikes arm at
 *     that point): hit = internal integrity damage, mapped to hpDelta -8 per hit (cap -24).
 *   - Rival rig rams from behind when your combo drops (false sign / missed target /
 *     ram), diff>=2 only: horn telegraph 900 ms, then a charge down YOUR lane — change
 *     lanes inside the window to shake the tail (+15); eat it and you lose 15+5*diff pts.
 *   - Guzzoline canisters add +6 s of cap time (banked up to +18 s).
 *   - Sandstorm brownouts: <=2 per round, each announced 800 ms ahead; visibility dips
 *     but the HUD NEXT chip never dims (fairness).
 *   - Reach the citadel before the cap: +(60+44*diff), "WHAT A DAY". Otherwise resolve at
 *     the cap: correct iff the sequence locked. (Balance probe: citadel reachable pre-cap
 *     in 100% of median-lane-play sims at every depth; payouts scale on the shared diff
 *     ladder so median totals track the takeover band [0.6,1.35]x puzzle payout.)
 *
 * StageResult (RAW points; engine layers streak/curse/hook modifiers):
 *   correct: citadel || sequenceLocked        (no neutral outcome)
 *   points:  picks/pickups/dodges − penalties + (60+44*diff) citadel bonus, clamped [0,500]
 *   hpDelta: −8 * potholeHits, floored at −24 (engine clamps [-60,60])
 *   summary: ≤64 chars, e.g. "WHAT A DAY — CITADEL REACHED" / "STRANDED — SEQ 2/4 · DMG 3"
 *
 * DETERMINISM (net:'seed'): the ENTIRE entity schedule (sign colors incl. decoy shades,
 * pothole lanes, guzzoline times, sandstorm times) is drawn from ctx.rng once at mount
 * in a fixed draw order — identical on every tab. Inputs are local skill only; the engine
 * relays/sanitizes each StageResult. No runtime randomness anywhere.
 *
 * FAIRNESS RAILS: fx via ctx.fx bridges (engine motion-gated); audio via ctx.audio
 * (guarded, IQB_MUTED covered by the gear toggle); no fullscreen flashes — feedback is
 * localized (toast strip, shake bridge); overlays escapable (ESC/P pause card);
 * touch parity (tap top/bottom half + on-screen ▲▼ pads ≥44 px); HUD text ≥12 px Oxanium.
 *
 * Self-play / soak hook: while a round is live this file exposes window.__ROADRUN__:
 *   .step('up'|'down')  queue a lane change (returns false when finished)
 *   .advance(ms)        run the sim forward in fixed 16 ms steps WITHOUT rAF (soak/smoke)
 *   .state()            full snapshot incl. live ents + the seeded schedule
 *   .warp(frac)         jump distance to frac*totalDist (0..1) — smoke shortcut
 *   .finish()           force cap-out resolution exactly as if time died
 */

(function () {
  'use strict';

  /* ---------- tuning ---------- */
  var CAP_MS = 40000;
  var MAX_BONUS_MS = 18000;
  var GAS_BONUS_MS = 6000;
  var LANES = 3;
  var POT_DMG_HP = 8;
  var POT_DMG_FLOOR = 24;
  var STORM_MAX = 2;
  var STORM_WARN_MS = 800;
  var POT_WARN_S = 0.95;          // seconds of warning before spikes arm
  var HORN_MS = 900;              // rival telegraph
  /* Payouts scale on the shared diff ladder min(5, 1+floor(depth/6)) so the
   * takeover total tracks the puzzle envelope 100*diff+40 (band 60%-135%).
   * Balance probe (.probe-madmax-balance.js): citadel reachable pre-cap 100%
   * of median-lane-play runs at every depth, so the arrival bonus is scaled
   * (was flat 200 = guaranteed income, over band at diff1, carrying deep runs
   * whose pick economy went negative). */
  function pickBaseFor(diff) { return 8 + 12 * diff; }      // was 20 flat
  function seqLockBonusFor(diff) { return 12 + 24 * diff; } // was 60 flat
  function citadelBonusFor(diff) { return 60 + 44 * diff; } // was 200 flat
  function ramPenaltyFor(diff) { return 15 + 5 * diff; }    // was 30 flat

  var COLORS = [
    { id: 'RUST', hex: '#ff5040' },
    { id: 'BONE', hex: '#ece7d6' },
    { id: 'BRASS', hex: '#ffb01e' },
    { id: 'VENOM', hex: '#39d98a' }
  ];
  /* near-miss decoy shades (diff>=3): read as a color at a glance, always FALSE */
  var SHADES = [
    { id: 'RUST', hex: '#a03a30' },
    { id: 'BONE', hex: '#a89f8c' },
    { id: 'BRASS', hex: '#c08428' },
    { id: 'VENOM', hex: '#2f8f63' }
  ];

  var active = null;

  function diffFor(depth) {
    return Math.min(5, Math.max(1, 1 + (((depth | 0) - 1) / 6 | 0)));
  }

  function stopActive() {
    if (active) active.abort();
  }

  /* ===================================================================== */
  /* stage descriptor                                                      */
  /* ===================================================================== */

  var STAGE = {
    id: 'fury-roadrun',
    name: 'FURY ROADRUN',
    goalText: 'RUN THE RIG. COLLECT THE TRUE SEQUENCE. REACH THE CITADEL.',
    controls: 'W/S · ARROWS UP/DOWN · TAP TOP/BOTTOM',
    weight: 4,
    worlds: ['wasteland-roads'],
    net: 'seed',
    describe: function () {
      return { kind: 'fury-roadrun', worlds: ['wasteland-roads'], net: 'seed' };
    },
    mount: mount,
    cleanup: stopActive
  };

  (function register() {
    try {
      if (window.IQ && window.IQ.Stage && typeof window.IQ.Stage.register === 'function') {
        window.IQ.Stage.register(STAGE);
        return;
      }
    } catch (e) { /* fall through to pending queue */ }
    (window.__stagePending = window.__stagePending || []).push(STAGE);
  })();

  /* ===================================================================== */
  /* mount                                                                 */
  /* ===================================================================== */

  function mount(container, ctx) {
    return new Promise(function (resolve) {

      /* ---------- depth / difficulty ---------- */
      var diff = diffFor(ctx.depth);
      var rng = ctx.rng;
      var seqLen = diff <= 1 ? 3 : (diff <= 3 ? 4 : 5);
      var baseSpeed = 235 + diff * 42;          // px/s world scroll
      var totalDist = baseSpeed * 33;           // citadel at ~33 s of clean running

      /* ---------- dom (inside container only) ---------- */
      var wrap = document.createElement('div');
      wrap.className = 'stage-view iq-roadrun';
      wrap.setAttribute('data-stage', 'fury-roadrun');

      var head = document.createElement('div');
      head.className = 'iq-roadrun-head';
      var title = document.createElement('span');
      title.textContent = 'FURY ROADRUN \u00B7 DEPTH ' + (ctx.depth | 0);
      var meta = document.createElement('span');
      meta.className = 'iq-roadrun-meta';
      meta.textContent = 'W/S \u00B7 ARROWS \u00B7 TAP TOP/BOTTOM';
      head.appendChild(title);
      head.appendChild(meta);

      var canvas = document.createElement('canvas');
      var padRow = document.createElement('div');
      padRow.className = 'iq-roadrun-pad';
      var padUp = document.createElement('button');
      padUp.className = 'iq-roadrun-pb';
      padUp.textContent = '\u25B2';
      padUp.setAttribute('aria-label', 'lane up');
      var padDown = document.createElement('button');
      padDown.className = 'iq-roadrun-pb';
      padDown.textContent = '\u25BC';
      padDown.setAttribute('aria-label', 'lane down');
      padRow.appendChild(padUp);
      padRow.appendChild(padDown);

      var toast = document.createElement('div');
      toast.className = 'iq-roadrun-toast';
      var foot = document.createElement('div');
      foot.className = 'iq-roadrun-foot';

      wrap.appendChild(head);
      wrap.appendChild(canvas);
      wrap.appendChild(padRow);
      wrap.appendChild(toast);
      wrap.appendChild(foot);

      if (ctx.mp && ctx.mp.on) {
        var note = document.createElement('div');
        note.className = 'iq-roadrun-note';
        note.textContent = 'SEED-SYNCED HIGHWAY \u2014 SAME SEED, SAME SIGNS; SKILL IS YOURS';
        wrap.appendChild(note);
      }

      var style = document.createElement('style');
      style.textContent =
        '.stage-view.iq-roadrun{position:relative;display:flex;flex-direction:column;align-items:center;' +
        'gap:6px;color:#ffd9a0;font-family:\'Oxanium\',sans-serif;background:#120c06;padding:10px;' +
        'border-radius:8px;width:100%;box-sizing:border-box}' +
        '.iq-roadrun-head{display:flex;justify-content:space-between;width:100%;max-width:720px;' +
        'font-size:13px;letter-spacing:.2em;color:#ffb01e;text-transform:uppercase}' +
        '.iq-roadrun-meta{color:#9c7b4f;font-size:11px}' +
        '.iq-roadrun-note{font-size:11px;color:#c8a06a;text-align:center}' +
        '.iq-roadrun-foot{font-size:12px;color:#ffe9c4;letter-spacing:.12em;min-height:16px;' +
        'text-transform:uppercase;text-align:center}' +
        '.iq-roadrun-pad{display:flex;gap:14px}' +
        '.iq-roadrun-pb{min-width:56px;min-height:44px;font-size:18px;font-family:\'Oxanium\',sans-serif;' +
        'background:#241708;color:#ffb01e;border:1px solid #5c3d14;border-radius:6px;cursor:pointer}' +
        '@media (prefers-reduced-motion:reduce){.iq-roadrun canvas{transition:none}}' +
        '.iq-roadrun canvas{background:#1a1108;border:2px solid #5c3d14;border-radius:4px;' +
        'touch-action:none;display:block}' +
        '.iq-roadrun-toast{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);' +
        'background:rgba(18,12,6,.92);border:1px solid #7a5518;color:#ffd9a0;font-size:13px;' +
        'letter-spacing:.15em;padding:8px 14px;border-radius:6px;text-transform:uppercase;' +
        'pointer-events:none;opacity:0;transition:opacity .25s;max-width:90%;text-align:center}' +
        '.iq-roadrun-pause{position:absolute;inset:0;background:rgba(10,6,2,.88);display:flex;' +
        'flex-direction:column;align-items:center;justify-content:center;gap:12px;z-index:5;' +
        'color:#ffd9a0;font-family:\'Oxanium\',sans-serif;letter-spacing:.2em;text-transform:uppercase}' +
        '.iq-roadrun-pause button{min-width:140px;min-height:44px;background:#241708;color:#ffb01e;' +
        'border:1px solid #5c3d14;border-radius:6px;font-family:\'Oxanium\',sans-serif;font-size:14px;' +
        'letter-spacing:.15em;cursor:pointer}';
      wrap.appendChild(style);
      container.appendChild(wrap);

      var motionOk = true;
      try {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          motionOk = false;
        }
      } catch (e) { /* default to motion-on */ }

      /* ---------- seeded world build (fixed draw order) ---------- */
      function buildWorld() {
        var w = { evs: [], seq: [], storms: [] };
        var prev = -1;
        for (var i = 0; i < seqLen; i++) {
          var c = (rng() * COLORS.length) | 0;
          while (c === prev) c = (rng() * COLORS.length) | 0;
          prev = c;
          w.seq.push(c);
        }
        var paletteSize = diff >= 3 ? COLORS.length + SHADES.length : COLORS.length;
        var t = 1600;
        var stepBase = Math.max(430, 720 - diff * 58);
        while (t < 54000) {
          var roll = rng();
          var laneP = (rng() * LANES) | 0;
          if (roll < 0.62) {
            w.evs.push({ t: t, kind: 'sign', lane: laneP, ci: (rng() * paletteSize) | 0 });
          } else if (roll < 0.82) {
            w.evs.push({ t: t, kind: 'pot', lane: laneP });
          } else if (roll < 0.91) {
            w.evs.push({ t: t, kind: 'gas', lane: laneP });
          }
          t += stepBase * (0.75 + rng() * 0.5);
        }
        var nStorms = diff >= 2 ? STORM_MAX : 1;
        for (var s = 0; s < nStorms; s++) {
          var frac = 0.26 + 0.40 * s + rng() * 0.12;
          w.storms.push({ start: CAP_MS * Math.min(0.85, frac), warned: false });
        }
        return w;
      }

      var world = buildWorld();
      var evPtr = 0;
      var ents = [];                 // live on-screen entities

      /* ---------- run state ---------- */
      var seqIdx = 0, seqDone = false;
      var combo = 0, bestCombo = 0;
      var pts = 0, dmg = 0, truePicks = 0, falsePicks = 0, rams = 0, dodges = 0;
      var bonusMs = 0, gasTaken = 0;
      var simMs = 0, dist = 0;
      var lane = 1, rigY = null;
      var slowUntil = 0;
      var citadelSeen = false;
      var paused = false, finished = false, aborted = false;
      var rival = { state: 'idle', at: 0, coolUntil: 0, x: 0, laneAt: 1 };
      var toastUntil = 0;
      var warnDist = baseSpeed * POT_WARN_S;
      var RIG_X = 0;                 // set in fit()
      var view = { w: 720, h: 420 };

      function neededCi() {
        return world.seq[Math.min(seqIdx, world.seq.length - 1)];
      }

      /* ---------- bridges (guarded, never required) ---------- */
      function sfx(name) {
        try {
          if (ctx.audio && typeof ctx.audio.p === 'function') ctx.audio.p(name);
        } catch (e) {}
      }
      function fxs(fnName, arg) {
        try {
          if (ctx.fx && typeof ctx.fx[fnName] === 'function') ctx.fx[fnName](arg);
        } catch (e) {}
      }
      function bannerSafe(txt) {
        try {
          if (typeof ctx.banner === 'function') ctx.banner(txt);
        } catch (e) {}
      }
      function sayToast(txt, ms) {
        toast.textContent = txt;
        toast.style.opacity = '1';
        toastUntil = simMs + (ms || 1600);
        bannerSafe(txt);
      }

      /* ---------- sizing / render ---------- */
      var dpr = (typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0)
        ? window.devicePixelRatio : 1;

      function fit() {
        view.w = Math.min((container.clientWidth || 720) || 720, 720);
        view.h = Math.min((container.clientHeight || 480) || 480, 460);
        view.w = Math.max(320, view.w - 20);
        view.h = Math.max(260, view.h - 130);   // leave room for head/pads/foot
        canvas.width = Math.round(view.w * dpr);
        canvas.height = Math.round(view.h * dpr);
        canvas.style.width = view.w + 'px';
        canvas.style.height = view.h + 'px';
        RIG_X = Math.round(view.w * 0.16);
        if (rigY === null) rigY = laneCenter(lane);
      }

      function roadTop() { return Math.round(view.h * 0.30); }
      function roadBot() { return view.h - 14; }
      function laneH() { return (roadBot() - roadTop()) / LANES; }
      function laneCenter(ln) { return roadTop() + laneH() * (ln + 0.5); }

      function stormAlpha() {
        var a = 0;
        for (var i = 0; i < world.storms.length; i++) {
          var st = world.storms[i];
          var dt = simMs - st.start;
          var peak = 0.46 + diff * 0.04;
          if (dt < 0) continue;
          if (dt < 800) a += peak * (dt / 800);
          else if (dt < 3000) a += peak;
          else if (dt < 3800) a += peak * (1 - (dt - 3000) / 800);
        }
        return Math.min(0.72, a);
      }

      function drawSign(g, en) {
        var y = laneCenter(en.lane);
        var pal = en.ci < COLORS.length ? COLORS[en.ci] : SHADES[en.ci - COLORS.length];
        g.fillStyle = '#241a10';
        g.fillRect(en.x + 16, y - 4, 4, 22);                    // pole
        g.fillStyle = '#14100c';
        g.strokeStyle = pal.hex;
        g.lineWidth = 2;
        g.fillRect(en.x, y - 34, 40, 32);
        g.strokeRect(en.x, y - 34, 40, 32);
        g.fillStyle = pal.hex;                                   // skull glyph
        g.beginPath();
        g.arc(en.x + 20, y - 21, 9, 0, Math.PI * 2);
        g.fill();
        g.fillRect(en.x + 15, y - 17, 10, 6);
        g.fillStyle = '#14100c';                                 // eyes
        g.fillRect(en.x + 14, y - 24, 5, 5);
        g.fillRect(en.x + 22, y - 24, 5, 5);
        g.font = 'bold 10px \'Oxanium\',sans-serif';
        g.textAlign = 'center';
        g.fillText(pal.id.charAt(0), en.x + 20, y - 36);
      }

      function drawPot(g, en) {
        var y = laneCenter(en.lane);
        g.fillStyle = '#0c0805';
        g.beginPath();
        g.arc(en.x + 20, y + 6, 18, 0, Math.PI * 2);
        g.fill();
        if (!en.armed) {
          var blink = ((simMs / 180) | 0) % 2 === 0;
          g.strokeStyle = blink ? '#ffb01e' : '#7a5518';         // telegraph tint
          g.lineWidth = 3;
          g.setLineDash([6, 5]);
          g.beginPath();
          g.arc(en.x + 20, y + 6, 23, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
          g.fillStyle = '#ffb01e';
          g.font = 'bold 12px \'Oxanium\',sans-serif';
          g.textAlign = 'center';
          g.fillText('\u25B2 SPIKES', en.x + 20, y - 22);
        } else {
          g.strokeStyle = '#ff2038';
          g.lineWidth = 2;
          for (var k = -1; k <= 1; k++) {                        // armed spikes
            g.beginPath();
            g.moveTo(en.x + 20 + k * 10, y + 10);
            g.lineTo(en.x + 20 + k * 10, y - 6);
            g.stroke();
          }
        }
      }

      function drawGas(g, en) {
        var y = laneCenter(en.lane);
        g.fillStyle = '#00e68a';
        g.fillRect(en.x + 6, y - 12, 24, 20);
        g.fillStyle = '#04361f';
        g.fillRect(en.x + 12, y - 16, 8, 5);
        g.font = 'bold 12px \'Oxanium\',sans-serif';
        g.textAlign = 'center';
        g.fillStyle = '#04361f';
        g.fillText('G', en.x + 18, y + 3);
      }

      function drawRig(g, x, y, bodyHex, darkHex) {
        g.fillStyle = darkHex;
        g.fillRect(x - 44, y - 14, 58, 28);                      // trailer
        g.fillStyle = bodyHex;
        g.fillRect(x + 12, y - 11, 26, 22);                      // cab
        g.fillStyle = '#0c0805';
        g.fillRect(x - 36, y + 12, 14, 8);                       // wheels
        g.fillRect(x + 14, y + 12, 14, 8);
        g.fillStyle = '#ffe9c4';
        g.fillRect(x + 36, y - 6, 3, 4);                         // headlight
      }

      function draw() {
        var g = canvas.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        var W = view.w, H = view.h, rt = roadTop(), rb = roadBot();

        /* sky */
        var sky = g.createLinearGradient(0, 0, 0, rt);
        sky.addColorStop(0, '#3a1c0c');
        sky.addColorStop(1, '#7a3d14');
        g.fillStyle = sky;
        g.fillRect(0, 0, W, rt);
        /* distant mesas (parallax, static shapes) */
        g.fillStyle = '#241206';
        var mo = (dist * 0.18) % 240;
        for (var m = -1; m < W / 240 + 1; m++) {
          var mx = m * 240 - mo;
          g.beginPath();
          g.moveTo(mx, rt);
          g.lineTo(mx + 60, rt - 46);
          g.lineTo(mx + 130, rt - 30);
          g.lineTo(mx + 190, rt);
          g.closePath();
          g.fill();
        }
        /* sun disc */
        g.fillStyle = '#ff8c3a';
        g.beginPath();
        g.arc(W * 0.78, rt - 52, 26, 0, Math.PI * 2);
        g.fill();

        /* asphalt */
        g.fillStyle = '#1c150c';
        g.fillRect(0, rt, W, rb - rt);
        g.fillStyle = '#5c4a2a';
        g.fillRect(0, rt - 4, W, 4);
        g.fillRect(0, rb, W, 4);
        g.strokeStyle = '#3a2d18';
        g.lineWidth = 2;
        g.setLineDash([34, 30]);
        for (var ln = 1; ln < LANES; ln++) {
          var ly = rt + laneH() * ln;
          var off = (dist % 64);
          g.beginPath();
          g.moveTo(-off, ly);
          g.lineTo(W, ly);
          g.stroke();
        }
        g.setLineDash([]);

        /* entities */
        for (var i = 0; i < ents.length; i++) {
          var en = ents[i];
          if (en.kind === 'sign') drawSign(g, en);
          else if (en.kind === 'pot') drawPot(g, en);
          else drawGas(g, en);
        }

        /* rival rig (charge) */
        if (rival.state === 'charge') {
          drawRig(g, rival.x, laneCenter(rival.laneAt), '#30160e', '#180a05');
          if (((simMs / 160) | 0) % 2 === 0) {
            g.fillStyle = '#ff2038';
            g.font = 'bold 14px \'Oxanium\',sans-serif';
            g.textAlign = 'center';
            g.fillText('!', rival.x + 2, laneCenter(rival.laneAt) - 26);
          }
        }
        /* horn telegraph chevrons behind the player rig */
        if (rival.state === 'warn') {
          g.fillStyle = ((simMs / 140) | 0) % 2 === 0 ? '#ff2038' : '#7a2018';
          g.font = 'bold 16px \'Oxanium\',sans-serif';
          g.textAlign = 'center';
          g.fillText('\u00AB\u00AB HORN', RIG_X - 52, laneCenter(lane) - 24);
        }

        /* player rig */
        var targetY = laneCenter(lane);
        if (rigY === null) rigY = targetY;
        rigY += (targetY - rigY) * 0.28;
        drawRig(g, RIG_X + 20, rigY, '#b3402a', '#571e10');

        /* exhaust puffs (decorative only; skipped under reduced-motion) */
        if (motionOk && ((simMs / 90) | 0) % 2 === 0) {
          g.fillStyle = 'rgba(200,170,130,.18)';
          g.beginPath();
          g.arc(RIG_X - 32, rigY - 4, 7, 0, Math.PI * 2);
          g.fill();
        }

        /* citadel silhouette */
        var frac = dist / totalDist;
        if (frac > 0.82) {
          var ca = Math.min(1, (frac - 0.82) / 0.16);
          var cx0 = W - ca * (W * 0.42);
          g.fillStyle = 'rgba(255,176,30,' + (0.25 + 0.45 * ca).toFixed(2) + ')';
          g.fillRect(cx0, rt - 70, W - cx0, 70);
          g.fillStyle = '#241206';
          for (var tw = 0; tw < 5; tw++) {
            var tx = cx0 + tw * (W - cx0) / 5;
            g.fillRect(tx, rt - 70 - (tw % 2 ? 26 : 44), (W - cx0) / 6, 70 + (tw % 2 ? 26 : 44));
          }
        }

        /* sandstorm brownout overlay */
        var sa = stormAlpha();
        if (sa > 0.01) {
          g.fillStyle = 'rgba(122,90,40,' + sa.toFixed(2) + ')';
          g.fillRect(0, 0, W, H);
        }

        /* vignette (static, motion-safe) */
        var vg = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(1, 'rgba(0,0,0,0.4)');
        g.fillStyle = vg;
        g.fillRect(0, 0, W, H);

        if (simMs > toastUntil) toast.style.opacity = '0';

        var remain = Math.max(0, Math.ceil((CAP_MS + bonusMs - simMs) / 1000));
        foot.textContent = 'TIME ' + remain + 'S' + (bonusMs ? '+' + Math.round(bonusMs / 1000) : '') +
          ' \u00B7 ROAD ' + Math.min(99, Math.round(frac * 100)) + '%' +
          ' \u00B7 COMBO x' + combo +
          ' \u00B7 DMG ' + dmg +
          ' \u00B7 NEXT: ' + (seqDone ? '\u2713 LOCKED' : COLORS[neededCi()].id);
        foot.style.color = seqDone ? '#00e68a' : '';
      }

      /* ---------- gameplay events ---------- */
      function comboDrop(reasonTxt) {
        combo = 0;
        if (diff >= 2 && rival.state === 'idle' && simMs >= rival.coolUntil) {
          rival.state = 'warn';
          rival.at = simMs;
          sayToast(reasonTxt + ' \u2014 HORN! RIG ON YOUR TAIL');
          sfx('roadrun_horn');
        } else {
          sayToast(reasonTxt);
        }
      }

      function onSign(en) {
        if (en.ci === neededCi()) {
          truePicks++;
          combo++;
          if (combo > bestCombo) bestCombo = combo;
          pts += pickBaseFor(diff) + 5 * combo;
          sfx('roadrun_pick');
          if (!seqDone) {
            seqIdx++;
            if (seqIdx >= seqLen) {
              seqDone = true;
              pts += seqLockBonusFor(diff);
              sayToast('SEQUENCE LOCKED +' + seqLockBonusFor(diff), 2200);
            } else {
              sayToast('LOCK ' + seqIdx + '/' + seqLen + ' \u2014 ' + COLORS[neededCi()].id);
            }
          } else {
            sayToast('TRUE SKULL +' + (pickBaseFor(diff) + 5 * combo));
          }
        } else {
          falsePicks++;
          pts -= 10;
          sfx('roadrun_wrong');
          comboDrop('FALSE IDOL \u2014 ' + (en.ci < COLORS.length ? COLORS[en.ci].id : SHADES[en.ci - COLORS.length].id + '?'));
        }
      }

      function onPot() {
        slowUntil = simMs + 900;
        dmg++;
        sfx('roadrun_pot');
        fxs('shake', 6);
        sayToast('SPIKES! INTEGRITY \u2212' + POT_DMG_HP);
      }

      function onGas() {
        gasTaken++;
        bonusMs = Math.min(MAX_BONUS_MS, bonusMs + GAS_BONUS_MS);
        sfx('roadrun_gas');
        sayToast('GUZZOLINE +' + Math.round(GAS_BONUS_MS / 1000) + 'S');
      }

      function updateRival(dt) {
        if (rival.state === 'warn') {
          if (simMs - rival.at >= HORN_MS) {
            rival.state = 'charge';
            rival.x = -60;
            rival.laneAt = lane;                     // locks onto the lane AT charge time
          }
        } else if (rival.state === 'charge') {
          var v = baseSpeed * (simMs < slowUntil ? 0.55 : 1);
          rival.x += v * 1.45 * dt;
          if (rival.x >= RIG_X - 46) {
            if (lane !== rival.laneAt) {
              dodges++;
              pts += 15;
              sayToast('SHOOK THE TAIL +15');
              sfx('roadrun_dodge');
            } else {
              rams++;
              var ramPts = ramPenaltyFor(diff);
              pts -= ramPts;
              fxs('shake', 10);
              sayToast('RAMMED \u2212' + ramPts);
              sfx('roadrun_ram');
            }
            rival.state = 'idle';
            rival.coolUntil = simMs + 4500;
          }
        }
      }

      /* ---------- resolution ---------- */
      function teardown() {
        window.cancelAnimationFrame(rafId);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('resize', fit);
        canvas.removeEventListener('pointerdown', onPointer);
        padUp.removeEventListener('click', onPadUp);
        padDown.removeEventListener('click', onPadDown);
        if (pauseCard && pauseCard.parentNode) pauseCard.parentNode.removeChild(pauseCard);
        active = null;
      }

      function summaryFor(win) {
        if (win === 'citadel') return 'WHAT A DAY \u2014 CITADEL REACHED';
        if (seqDone) return 'SEQUENCE LOCKED ' + seqIdx + '/' + seqLen + ' \u00B7 DMG ' + dmg;
        return 'STRANDED \u2014 SEQ ' + seqIdx + '/' + seqLen + ' \u00B7 DMG ' + dmg;
      }

      function finish(win, silent) {
        if (finished) return false;
        finished = true;
        teardown();
        if (silent || aborted) return true;
        resolve({
          kind: 'score',
          correct: win === 'citadel' || seqDone,
          points: Math.max(0, Math.min(500, pts | 0)),
          hpDelta: dmg > 0 ? -Math.min(POT_DMG_FLOOR, POT_DMG_HP * dmg) : 0,
          summary: summaryFor(win).slice(0, 64)
        });
        return true;
      }

      function winCitadel() {
        pts += citadelBonusFor(diff);
        sfx('roadrun_win');
        finish('citadel', false);
      }
      function capOut() {
        finish('cap', false);
      }

      /* ---------- update ---------- */
      function update(dtMs) {
        if (finished || paused) return;
        var dt = dtMs / 1000;
        simMs += dtMs;
        var v = baseSpeed * (simMs < slowUntil ? 0.55 : 1);
        dist += v * dt;

        var storms = world.storms;
        for (var si = 0; si < storms.length; si++) {
          if (!storms[si].warned && simMs >= storms[si].start - STORM_WARN_MS) {
            storms[si].warned = true;
            sayToast('SANDSTORM INBOUND', 1200);
            sfx('roadrun_storm');
          }
        }

        while (evPtr < world.evs.length && world.evs[evPtr].t <= simMs) {
          var spawn = world.evs[evPtr++];
          spawn.x = view.w + 60;
          spawn.armed = false;
          spawn.hit = false;
          ents.push(spawn);
        }

        for (var i = ents.length - 1; i >= 0; i--) {
          var en = ents[i];
          en.x -= v * dt;
          if (en.kind === 'pot' && !en.armed && en.x - RIG_X < warnDist) en.armed = true;
          var overlap = en.x < RIG_X + 54 && en.x > RIG_X - 34 && en.lane === lane;
          if (overlap && !en.hit) {
            en.hit = true;
            if (en.kind === 'sign') onSign(en);
            else if (en.kind === 'pot') onPot(en);
            else onGas(en);
          }
          if (en.x < -90) {
            if (en.kind === 'sign' && !en.hit && en.ci === neededCi()) {
              comboDrop('MISSED THE ' + COLORS[en.ci].id + ' SKULL');
            }
            ents.splice(i, 1);
          }
        }

        updateRival(dt);

        if (!citadelSeen && dist > totalDist * 0.82) {
          citadelSeen = true;
          sayToast('CITADEL ON THE HORIZON', 2200);
        }
        if (dist >= totalDist) { winCitadel(); return; }
        if (simMs >= CAP_MS + bonusMs) { capOut(); }
      }

      /* ---------- input ---------- */
      function shiftLane(d) {
        if (finished || paused) return;
        var nl = Math.min(LANES - 1, Math.max(0, lane + d));
        if (nl !== lane) {
          lane = nl;
          sfx('roadrun_turn');
        }
      }

      var KEYS = {
        ArrowUp: -1, KeyW: -1,
        ArrowDown: 1, KeyS: 1
      };
      function onKey(e) {
        if (e.code === 'Escape' || e.code === 'KeyP') {
          e.preventDefault();
          togglePause();
          return;
        }
        var d = KEYS[e.code];
        if (d === undefined) return;
        e.preventDefault();
        shiftLane(d);
      }
      function onPointer(e) {
        var rect = null;
        try { rect = canvas.getBoundingClientRect(); } catch (err) { rect = null; }
        var y = e.clientY - (rect && rect.top ? rect.top : 0);
        var h = rect && rect.height ? rect.height : view.h;
        if (y < h / 3) shiftLane(-1);
        else if (y > (2 * h) / 3) shiftLane(1);
      }
      function onPadUp(ev) { ev.preventDefault(); shiftLane(-1); }
      function onPadDown(ev) { ev.preventDefault(); shiftLane(1); }

      /* pause card: escapable overlay (rail) */
      var pauseCard = null;
      function togglePause() {
        if (finished) return;
        paused = !paused;
        if (paused) {
          pauseCard = document.createElement('div');
          pauseCard.className = 'iq-roadrun-pause';
          var pt = document.createElement('div');
          pt.textContent = 'PAUSED \u2014 ENGINE IDLES, NO TIME DIES';
          var pb = document.createElement('button');
          pb.textContent = 'RESUME (ESC)';
          pb.addEventListener('click', function () { togglePause(); });
          pauseCard.appendChild(pt);
          pauseCard.appendChild(pb);
          wrap.appendChild(pauseCard);
        } else if (pauseCard) {
          if (pauseCard.parentNode) pauseCard.parentNode.removeChild(pauseCard);
          pauseCard = null;
        }
      }

      window.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', fit);
      canvas.addEventListener('pointerdown', onPointer);
      padUp.addEventListener('click', onPadUp);
      padDown.addEventListener('click', onPadDown);

      /* ---------- loop ---------- */
      var rafId = 0;
      function raf(ts) {
        if (finished) return;
        if (!lastTs) lastTs = ts;
        var dt = Math.min(64, ts - lastTs);
        lastTs = ts;
        if (!paused) update(dt);
        draw();
        rafId = window.requestAnimationFrame(raf);
      }
      var lastTs = 0;
      fit();
      rafId = window.requestAnimationFrame(raf);

      /* auto-discard the how-to legend after 3 s (rail: controls hint visible first 3 s) */
      sayToast(COLORS[world.seq[0]].id + ' FIRST \u2014 RUN THE SEQUENCE TO THE CITADEL', 3000);

      /* ---------- self-play / soak hook ---------- */
      window.__ROADRUN__ = {
        step: function (dirName) {
          if (finished) return false;
          if (dirName === 'up') shiftLane(-1);
          else if (dirName === 'down') shiftLane(1);
          else return false;
          return !finished;
        },
        advance: function (ms) {
          var left = Math.max(0, ms | 0);
          while (left > 0 && !finished) {
            var chunk = left > 16 ? 16 : left;
            update(chunk);
            left -= chunk;
          }
          if (!finished) draw();
          return !finished;
        },
        warp: function (fracStr) {
          if (finished) return false;
          var f = Math.max(0, Math.min(0.999, Number(fracStr) || 0));
          dist = totalDist * f;
          return true;
        },
        finish: function () {
          if (finished) return false;
          capOut();
          return true;
        },
        state: function () {
          return {
            finished: finished,
            lane: lane,
            simMs: Math.round(simMs),
            remainingMs: Math.max(0, Math.round(CAP_MS + bonusMs - simMs)),
            bonusMs: Math.round(bonusMs),
            gasTaken: gasTaken,
            distFrac: +(dist / totalDist).toFixed(4),
            needed: seqDone ? null : COLORS[neededCi()].id,
            seq: world.seq.map(function (ci) { return COLORS[ci].id; }),
            seqIdx: seqIdx,
            seqLen: seqLen,
            seqDone: seqDone,
            combo: combo,
            bestCombo: bestCombo,
            pts: pts,
            dmg: dmg,
            truePicks: truePicks,
            falsePicks: falsePicks,
            rams: rams,
            dodges: dodges,
            stormsLeft: world.storms.filter(function (st) { return !st.warned; }).length,
            rival: rival.state,
            ents: ents.map(function (en) {
              return { kind: en.kind, lane: en.lane, ci: en.ci, x: Math.round(en.x), hit: !!en.hit };
            }),
            sched: world.evs.map(function (ev) {
              return [ev.t, ev.kind.charAt(0), ev.lane, ev.ci];
            })
          };
        }
      };

      active = {
        abort: function () {
          aborted = true;
          finish(null, true);       // engine-aborted: engine injects its own result
        }
      };
    });
  }

  /* Node smoke support: export the descriptor without touching any browser global. */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { id: STAGE.id, worlds: STAGE.worlds, weight: STAGE.weight };
  }
})();
