/* ============================================================================
 * pack-horror.js — PackHorror wave: 5 horror B4 packs + 5 registered worlds.
 *
 * SPEC -> MECHANIC MAP
 *   1. SANDMAN        world 'sandman-dream'  | hook id 'sandman-jolt'
 *      Sleep meter fills while the pointer is IDLE for 8s (document-level
 *      pointermove listener feeds lastMoveMs — input-reactive, same class of
 *      mechanic as red-light-green-light; scoring stays host-authoritative
 *      because the penalty travels through the standard hpDelta modifier).
 *      Full meter => hpDelta -5 + jolt banner. Meter renders as a thin
 *      crescent bar via overlayHTML, sig-gated per 12.5% bucket so overlays
 *      don't churn. Movement resets the cycle.
 *   2. GRIEF BOX      world 'grief-box'      | hook id 'grief-gamble'
 *      Rare (rng-gated + low weight): a correct solve under 40% of timerLen
 *      opens a NON-INTERACTIVE 3-box overlay (pointer-events:none, ESC
 *      declines, auto-declines after 8s). Choice is made with keys 1/2/3
 *      handled by a pack-owned keydown listener — the overlay markup itself
 *      never captures focus or blocks the board. Box contents are a seeded
 *      shuffle of {blessing, nothing, minor curse} via ctx.rng; identical
 *      visuals so nothing leaks before the pick (no pre-reveal leakage).
 *      Outcome is applied through the modifier pipeline on the next tick
 *      (scoreMul / hpDelta / timerDelta) — never direct state writes.
 *   3. WELL TAPE      world 'well-curse'     | hook id 'well-tape'
 *      Applying (first well-curse round of a run) sets Hooks.state
 *      'pack-horror:tapeCountdown' = 7. Each subsequent onRoundStart
 *      decrements; answering correctly while it runs sets
 *      'pack-horror:tapeWatched'. At 0: watched => forgiveness flag
 *      ('well-tape-forgiven'); otherwise hpDelta -10 + "you didn't watch
 *      the tape" banner. Cycle re-arms for another seven.
 *   4. HIVE ACID      world 'hive-acid'      | hook id 'hive-acid'
 *      Seeded 3s acid bursts during the round. Each burst requests
 *      disableWrongRandom:1 (the ENGINE picks the victim among WRONG
 *      options — a pack must never guess correctIdx) plus cosmetic green
 *      drips overlayHTML. NOTE: the engine's disabled-set has no removal
 *      path mid-round (same engine-wide limitation hunter-beam lives with);
 *      bursts are capped at 2 so >=6 of 8 options stay selectable.
 *   5. UPSIDE-DOWN    world 'upside-down'    | hook id 'upside-down-flip'
 *      First 5s of every round the board frame renders rotated 180deg via
 *      an injected style class (.iqh-updown on body + CSS targeting
 *      #board-frame — question/options text stay upright/readable), then
 *      flips back with a light flash capped at 150ms (skipped entirely when
 *      IQB_MOTION is off — static instant swap instead).
 *
 * All randomness that affects outcomes uses ctx.rng ONLY (mulberry32, seeded
 * by the engine). Clocks (performance.now) drive presentation timing only,
 * matching pack-hunters.js convention. Horror tone = dread via implication;
 * no gore text anywhere. Motion behind IQB_MOTION, sound cues via the sfx
 * modifier (engine honors IQB_MUTED). Asset-free: DOM/CSS/canvas only.
 * ============================================================================*/
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};
  var IQ = root.IQ;

  /* ---- guarded Hooks/state fallbacks (same pattern as pack-hunters.js) --- */

  if (!IQ.Hooks || typeof IQ.Hooks.add !== 'function') {
    console.warn('[pack-horror] IQ.Hooks absent — installing stub queue + state fallback.');
    IQ.Hooks = IQ.Hooks || {};
    IQ.Hooks.add = function (pack) { (IQ.Hooks._q = IQ.Hooks._q || []).push(pack); };
  }
  if (!IQ.Hooks.state) {
    var mem = Object.create(null);
    IQ.Hooks.state = {
      get: function (k) { return mem[k]; },
      set: function (k, v) { mem[k] = v; return v; },
      has: function (k) { return Object.prototype.hasOwnProperty.call(mem, k); },
      del: function (k) { delete mem[k]; }
    };
  }

  /* ---- shared helpers ---------------------------------------------------- */

  function nowMs() {
    return (root.performance && performance.now) ? performance.now() : Date.now();
  }

  function motionOK() {
    try {
      var v = root.localStorage && root.localStorage.getItem('IQB_MOTION');
      return v == null ? true : JSON.parse(v) !== false;
    } catch (e) { return true; }
  }

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  /* Per-round runtime records keyed '<runId>#<round>@<owner>' (presentation
   * clocks only — never used for outcome decisions). */
  var rt = Object.create(null);
  function rec(owner, ctx, seed) {
    var k = String(ctx.runId) + '#' + (ctx.round | 0) + '@' + owner;
    if (!rt[k]) {
      for (var old in rt) {
        if (old.indexOf(String(ctx.runId) + '#' + (ctx.round | 0) + '@') === 0 && old !== k) delete rt[old];
      }
      rt[k] = seed || {};
    }
    return rt[k];
  }

  /* Emit overlay/banner only when content changes (avoids overlay stacking). */
  function vis(r, html, bannerText, extra) {
    var sig = (html || '') + '\u0000' + (bannerText || '');
    if (sig === r.sig) return null;
    r.sig = sig;
    var m = extra || {};
    m.overlayHTML = html || '';
    if (bannerText != null) m.bannerText = bannerText;
    return m;
  }

  /* ==========================================================================
   * WORLDS (IQ.Worlds.register — same shape as worlds-pop.js defs)
   * ========================================================================*/

  var TAU = Math.PI * 2;

  function vgrad(c, h, stops) {
    var g = c.createLinearGradient(0, 0, 0, h);
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    c.fillStyle = g;
  }

  var HORROR_WORLDS = [

  /* --- sandman-dream (chaotic): indigo night, sand that falls sideways ---- */
  { id: 'sandman-dream', align: 'chaotic',
    pal: ['#b9a06a','#4a3f73','#201a3d','#0c0921','#e0cf9a','#6a5aa0','#2c2350','#f0e6c0'],
    draw: function (c, w, h, t) {
      vgrad(c, h, [[0, '#0c0921'], [0.55, '#1c1638'], [1, '#080512']]); c.fillRect(0, 0, w, h);
      /* heavy-lidded moon */
      c.fillStyle = 'rgba(224,207,154,.16)'; c.beginPath(); c.arc(w * 0.78, h * 0.24, 66, 0, TAU); c.fill();
      c.fillStyle = 'rgba(240,230,192,.55)'; c.beginPath(); c.arc(w * 0.78, h * 0.24, 40, 0, Math.PI); c.fill();
      /* sideways-drifting sand motes: they fall toward the sleeper */
      for (var i = 0; i < 26; i++) {
        var ph = (t * 26 + i * 71) % (w + 60);
        var y = h * (0.18 + ((i * 37) % 55) / 90) + Math.sin(i * 2.1 + t * 0.7) * 9;
        c.fillStyle = 'rgba(185,160,106,' + (0.10 + 0.10 * ((i % 3) / 2)).toFixed(3) + ')';
        c.fillRect(w - ph, y, 2, 2);
      }
      /* dune silhouettes, breathing slow */
      for (var d = 0; d < 2; d++) {
        c.fillStyle = d === 0 ? 'rgba(28,22,56,.85)' : 'rgba(10,7,26,.95)';
        c.beginPath(); c.moveTo(0, h);
        for (var x = 0; x <= w; x += 28) {
          c.lineTo(x, h * (0.78 + d * 0.08) + Math.sin(x * 0.008 + d * 2 + t * 0.12) * h * 0.04);
        }
        c.lineTo(w, h); c.closePath(); c.fill();
      }
    }},

  /* --- grief-box (neutral): grey-lavender fog, boxes nobody claimed ------- */
  { id: 'grief-box', align: 'neutral',
    pal: ['#9a93b8','#6b6584','#44405a','#211f30','#c4bede','#847da3','#33304a','#ddd8ee'],
    draw: function (c, w, h, t) {
      vgrad(c, h, [[0, '#211f30'], [0.6, '#2e2b42'], [1, '#181625']]); c.fillRect(0, 0, w, h);
      /* drifting unclaimed boxes, drawn as hollow lids slightly ajar */
      for (var i = 0; i < 7; i++) {
        var bx = (w * 0.12 + i * w * 0.13 + Math.sin(t * 0.22 + i * 1.7) * 18) % w;
        var by = h * (0.22 + ((i * 29) % 50) / 100) + Math.cos(t * 0.18 + i) * 10;
        var s = 16 + (i % 3) * 9;
        c.strokeStyle = 'rgba(155,148,184,' + (0.16 + 0.07 * (i % 3)).toFixed(3) + ')';
        c.lineWidth = 1.5;
        c.strokeRect(bx, by, s, s * 0.72);
        c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + s * 0.32, by - s * 0.2); c.lineTo(bx + s * 1.32, by - s * 0.2); c.stroke();
      }
      /* fog banks */
      for (var f = 0; f < 3; f++) {
        c.fillStyle = 'rgba(196,190,222,.03)';
        c.beginPath(); c.ellipse((t * 8 + f * w * 0.4) % (w + 300) - 150, h * (0.5 + f * 0.16), 220, 46, 0, 0, TAU); c.fill();
      }
    }},

  /* --- well-curse (bad): black-green water, rings rise to meet you -------- */
  { id: 'well-curse', align: 'bad',
    pal: ['#4fb08a','#1d5c48','#0c2e24','#05130e','#79d8b2','#2f7a5e','#123a2c','#a4f0d4'],
    draw: function (c, w, h, t) {
      vgrad(c, h, [[0, '#05130e'], [0.62, '#0a231a'], [1, '#020806']]); c.fillRect(0, 0, w, h);
      /* stone rim arcs at the bottom, seen from above-inside */
      var cxw = w * 0.5, cyw = h * 1.28;
      for (var r = 0; r < 5; r++) {
        c.strokeStyle = 'rgba(79,176,138,' + (0.22 - r * 0.035).toFixed(3) + ')';
        c.lineWidth = 10;
        c.beginPath(); c.arc(cxw, cyw, h * 0.62 + r * 26, Math.PI * 1.12, Math.PI * 1.88); c.stroke();
      }
      /* ripples climbing out of the water, ~3.2s period */
      for (var i = 0; i < 4; i++) {
        var ph = ((t * 0.31 + i * 0.25) % 1);
        c.strokeStyle = 'rgba(121,216,178,' + (0.35 * (1 - ph)).toFixed(3) + ')';
        c.lineWidth = 1.5;
        c.beginPath(); c.arc(cxw, cyw, h * 0.42 + ph * h * 0.5, Math.PI * 1.18, Math.PI * 1.82); c.stroke();
      }
      /* a pale glimmer far down: something looking up */
      var gl = 0.35 + 0.3 * Math.sin(t * 0.9);
      c.fillStyle = 'rgba(164,240,212,' + gl.toFixed(3) + ')';
      c.beginPath(); c.ellipse(cxw, cyw - h * 0.36, 7, 3.4, 0, 0, TAU); c.fill();
    }},

  /* --- hive-acid (bad): hex comb walls, acid pooling at the seams --------- */
  { id: 'hive-acid', align: 'bad',
    pal: ['#a8e63c','#5f8f1e','#2e4a12','#120e04','#d2ff70','#86b52e','#3f5c17','#effcb0'],
    draw: function (c, w, h, t) {
      vgrad(c, h, [[0, '#120e04'], [0.6, '#1d1706'], [1, '#0a0703']]); c.fillRect(0, 0, w, h);
      /* hex comb */
      var R = 34;
      c.lineWidth = 1.5;
      for (var row = -1; row * R * 1.5 < h + R; row++) {
        for (var col = -1; col * R * Math.sqrt(3) < w + R; col++) {
          var hx = col * R * Math.sqrt(3) + (row % 2 ? R * Math.sqrt(3) / 2 : 0);
          var hy = row * R * 1.5;
          c.strokeStyle = 'rgba(95,143,30,.20)';
          c.beginPath();
          for (var k = 0; k < 6; k++) {
            var a = Math.PI / 6 + k * Math.PI / 3;
            var px = hx + Math.cos(a) * R * 0.92, py = hy + Math.sin(a) * R * 0.92;
            if (k === 0) c.moveTo(px, py); else c.lineTo(px, py);
          }
          c.closePath(); c.stroke();
          /* some cells hold acid, pulsing slow */
          if (((row * 7 + col * 13) % 11) === 3) {
            c.fillStyle = 'rgba(168,230,60,' + (0.10 + 0.07 * Math.sin(t * 1.4 + row + col)).toFixed(3) + ')';
            c.fill();
          }
        }
      }
      /* drips sliding down the comb seams */
      for (var d = 0; d < 9; d++) {
        var dx = (d * 137) % w;
        var dy = (t * (22 + (d % 3) * 14) + d * 91) % (h + 40) - 20;
        c.fillStyle = 'rgba(210,255,112,' + (0.28 - (dy / h) * 0.18).toFixed(3) + ')';
        c.fillRect(dx, dy, 2.5, 10 + (d % 3) * 6);
      }
    }},

  /* --- upside-down (chaotic): mirrored dunes, cold and wrong -------------- */
  { id: 'upside-down', align: 'chaotic',
    pal: ['#7fa6b8','#4a6a7d','#26394a','#0b1420','#b8dcea','#5f8399','#1a2c3d','#e2f4fc'],
    draw: function (c, w, h, t) {
      vgrad(c, h, [[0, '#0b1420'], [0.5, '#16283a'], [1, '#0b1420']]); c.fillRect(0, 0, w, h);
      /* mirrored skyline: spires grow from BOTH horizons toward the middle */
      function spires(flip) {
        c.fillStyle = 'rgba(38,57,74,.9)';
        c.beginPath();
        var base = flip ? 0 : h;
        c.moveTo(0, base);
        for (var x = 0; x <= w; x += 40) {
          var hh = h * (0.16 + 0.13 * Math.abs(Math.sin(x * 0.021 + 3)));
          c.lineTo(x, base + (flip ? hh : -hh));
        }
        c.lineTo(w, base); c.closePath(); c.fill();
      }
      spires(false); spires(true);
      /* a figure-shaped absence drifts between them, upside down relative to you */
      var fx = (t * 30) % (w + 120) - 60;
      var fy = h * 0.5 + Math.sin(t * 0.5) * h * 0.06;
      c.fillStyle = 'rgba(226,244,252,.10)';
      c.beginPath(); c.arc(fx, fy - 12, 6, 0, TAU); c.fill();
      c.fillRect(fx - 4, fy - 6, 8, 18);
      /* cold motes fall UP */
      for (var i = 0; i < 16; i++) {
        var my = h - ((t * 18 + i * 67) % h);
        c.fillStyle = 'rgba(184,220,234,.14)';
        c.fillRect((i * 113) % w, my, 2, 2);
      }
    }}
  ];

  function registerWorlds() {
    var W = IQ.Worlds;
    if (!W || typeof W.register !== 'function') return;
    for (var i = 0; i < HORROR_WORLDS.length; i++) {
      try { W.register(HORROR_WORLDS[i]); } catch (e) { /* duplicate id: keep first */ }
    }
  }

  /* ==========================================================================
   * INJECTED STYLE (upside-down flip class)
   * ========================================================================*/

  var styleDone = false;
  function ensureStyle() {
    if (styleDone || typeof document === 'undefined') return;
    styleDone = true;
    var st = document.createElement('style');
    st.id = 'iqh-horror-style';
    st.textContent =
      /* rotate ONLY the puzzle board frame; question + option text stay upright */
      'body.iqh-updown #board-frame{transform:rotate(180deg)}' +
      '.iqh-drip{position:absolute;top:-4px;width:3px;border-radius:0 0 3px 3px;' +
      'background:linear-gradient(180deg,#d2ff70,#5f8f1e);}' +
      '@keyframes iqhDripFall{0%{opacity:0;height:0}10%{opacity:.9}80%{opacity:.85}100%{opacity:0;height:64px}}';
    var head = document.head || document.getElementsByTagName('head')[0];
    head.appendChild(st);
  }

  function updownClass(on) {
    if (typeof document === 'undefined') return;
    ensureStyle();
    if (on) document.body.classList.add('iqh-updown');
    else document.body.classList.remove('iqh-updown');
  }

  /* ==========================================================================
   * PACK 1 — SANDMAN (world: sandman-dream)
   * =========================================================================*/

  var smLastMove = 0;
  var smHooked = false;
  function hookPointer() {
    if (smHooked || typeof document === 'undefined') return;
    smHooked = true;
    smLastMove = nowMs();
    document.addEventListener('pointermove', function () { smLastMove = nowMs(); }, { passive: true });
    document.addEventListener('pointerdown', function () { smLastMove = nowMs(); }, { passive: true });
  }

  IQ.Hooks.add({
    id: 'sandman-jolt',
    worlds: ['sandman-dream'],
    weight: 1,
    handlers: {
      onRoundStart: function (ctx) {
        hookPointer();
        rec('sandman', ctx, { jolted: false, bucket: -1 });
        return null;
      },
      onTick: function (ctx) {
        hookPointer();
        var r = rec('sandman', ctx, { jolted: false, bucket: -1 });
        var idleMs = nowMs() - smLastMove;
        if (idleMs < 0) idleMs = 0;

        /* movement resets the cycle */
        if (r.jolted && idleMs < 400) { r.jolted = false; r.bucket = -1; return vis(r, '', ''); }

        var fill = clamp01(idleMs / 8000);

        /* full meter: one jolt per cycle, resets when the player moves again */
        if (fill >= 1) {
          if (r.jolted) return null;
          r.jolted = true;
          r.bucket = -1;
          return {
            hpDelta: -5,
            bannerText: 'THE SANDMAN TAKES HIS DUE \u2014 HP \u22125',
            sfx: 'heart',
            flag: 'sandman-jolt',
            overlayHTML: ''
          };
        }

        /* crescent sleep meter, sig-gated per 12.5% bucket */
        var bucket = Math.min(7, Math.floor(fill * 8));
        if (bucket === r.bucket) return null;
        r.bucket = bucket;
        var pct = Math.round(fill * 100);
        var html =
          '<div style="pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:3px">' +
            '<div style="position:relative;width:220px;height:10px;border-radius:50% 50% 40% 40% / 90% 90% 30% 30%;' +
              'background:rgba(12,9,33,.72);border:1px solid rgba(185,160,106,.45);overflow:hidden">' +
              '<div style="position:absolute;left:0;top:0;bottom:0;width:' + pct + '%;' +
                'background:linear-gradient(90deg,#4a3f73,#b9a06a);border-radius:inherit"></div>' +
            '</div>' +
            '<div style="font:700 10px Oxanium,monospace;color:#e0cf9a;background:rgba(12,9,33,.72);' +
              'padding:1px 8px;border-radius:8px;letter-spacing:.18em">SLEEP ' + pct + '%</div>' +
          '</div>';
        return vis(r, html, null, { overlayMs: 1500 });
      }
    }
  });

  /* ==========================================================================
   * PACK 2 — GRIEF GAMBLE (world: grief-box)
   * =========================================================================*/

  var ggOpen = null;   /* { boxes:[..], deadline, onKey } while the overlay waits */

  function ggClose(resolve) {
    if (!ggOpen) return;
    var g = ggOpen;
    ggOpen = null;
    try { document.removeEventListener('keydown', g.onKey, true); } catch (e) {}
    /* no DOM state to restore: overlay is transient, listener removed above */
    if (resolve) {
      /* Outcome rides the NEXT tick through the modifier pipeline — the pack
       * never writes game state directly. */
      IQ.Hooks.state.set('pack-horror:griefPending', g.boxes[g.pick]);
    }
  }

  function ggKeyHandler(e) {
    if (!ggOpen) return;
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return; /* never hijack typing */
    if (e.key === 'Escape') { ggClose(false); return; }
    var n = '123'.indexOf(e.key);
    if (n >= 0) { ggOpen.pick = n; ggClose(true); }
  }

  function ggShowOverlay() {
    var html =
      '<div style="pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:10px">' +
        '<div style="font:800 13px Oxanium,sans-serif;color:#c4bede;background:rgba(33,31,48,.85);' +
          'padding:3px 14px;border-radius:10px;letter-spacing:.22em">THREE BOXES \u00B7 CHOOSE ONE</div>' +
        '<div style="display:flex;gap:14px">' +
          [0, 1, 2].map(function (i) {
            return '<div style="width:58px;height:44px;border:2px solid rgba(196,190,222,.55);border-radius:6px;' +
              'background:rgba(68,64,90,.55);display:flex;align-items:center;justify-content:center;' +
              'font:800 15px Oxanium,sans-serif;color:#ddd8ee">' + (i + 1) + '</div>';
          }).join('') +
        '</div>' +
        '<div style="font:700 11px Oxanium,monospace;color:#9a93b8;background:rgba(33,31,48,.85);' +
          'padding:2px 10px;border-radius:8px;letter-spacing:.12em">PRESS 1 \u00B7 2 \u00B7 3 \u2014 OR ESC WALKS AWAY</div>' +
      '</div>';
    return html;
  }

  IQ.Hooks.add({
    id: 'grief-gamble',
    worlds: ['grief-box'],
    weight: 0.4,                       /* rare: low weight, rng-gated trigger */
    handlers: {
      onRoundStart: function (ctx) {
        /* a fresh round kills any lingering gamble from a previous round/run */
        if (ggOpen) ggClose(false);
        rec('grief', ctx, { startMs: nowMs() });
        return null;
      },
      onTick: function (ctx) {
        /* deliver a resolved gamble outcome through the pipeline */
        var pend = IQ.Hooks.state.get('pack-horror:griefPending');
        if (!pend) return null;
        IQ.Hooks.state.del('pack-horror:griefPending');
        if (pend === 'blessing') {
          return { scoreMul: 1.25, bannerText: '\u2728 THE BOX HUMS \u2014 A BLESSING (+25% NEXT AWARD)', sfx: 'chime', flag: 'grief-blessing' };
        }
        if (pend === 'curse') {
          return { hpDelta: -4, bannerText: '\uD83D\uDCA8 A PINCH OF ASH BETWEEN THE LIDS \u2014 HP \u22124', sfx: 'heart', flag: 'grief-curse' };
        }
        return { bannerText: 'DUST, AND LETTERS NOBODY SENT.', flag: 'grief-nothing' };
      },
      onAnswer: function (ctx) {
        if (!ctx.res || !ctx.res.correct) return null;
        if (ggOpen) return null;                      /* one gamble at a time */
        var r = rec('grief', ctx, { startMs: nowMs() });
        var elapsed = (nowMs() - r.startMs) / 1000;   /* no roundStart => full timer */
        /* rarity gate: seeded, ~1 in 3 qualifying solves */
        if (ctx.rng() > 0.34) return null;

        /* seeded shuffle of the three outcomes — assignment hidden until pick */
        var boxes = ['blessing', 'nothing', 'curse'];
        for (var i = boxes.length - 1; i > 0; i--) {
          var j = Math.floor(ctx.rng() * (i + 1));
          var tmp = boxes[i]; boxes[i] = boxes[j]; boxes[j] = tmp;
        }

        if (typeof document !== 'undefined') {
          ensureStyle();
          var g = { boxes: boxes, pick: -1, deadline: nowMs() + 8000 };
          g.onKey = ggKeyHandler;
          ggOpen = g;
          document.addEventListener('keydown', g.onKey, true);
          /* auto-decline: walk-away keeps the deal fair and the overlay escapable */
          setTimeout(function () { if (ggOpen === g && g.pick < 0) ggClose(false); }, 8200);
        }

        return {
          overlayHTML: ggShowOverlay(),
          overlayMs: 8000,
          bannerText: 'THE GRIEF BOX OPENS \u2014 CHOOSE CAREFULLY',
          sfx: 'whisper',
          flag: 'grief-open'
        };
      },
      onReveal: function (ctx) {
        /* safety: any reveal closes a lingering gamble without payout */
        if (ggOpen) ggClose(false);
        return null;
      }
    }
  });

  /* ==========================================================================
   * PACK 3 — WELL TAPE (world: well-curse)
   * =========================================================================*/

  var TAPE_CD = 'pack-horror:tapeCountdown';
  var TAPE_WATCHED = 'pack-horror:tapeWatched';
  var TAPE_ARMED = 'pack-horror:tapeArmed';

  IQ.Hooks.add({
    id: 'well-tape',
    worlds: ['well-curse'],
    weight: 1,
    handlers: {
      onRoundStart: function (ctx) {
        var S = IQ.Hooks.state;
        if (!S.get(TAPE_ARMED)) {
          /* "applying": the tape comes with the first well-curse round */
          S.set(TAPE_ARMED, true);
          S.set(TAPE_CD, 7);
          S.set(TAPE_WATCHED, false);
          return {
            bannerText: '\uD83D\uDCFC AN UNLABELED TAPE RESTS BY THE WELL \u2014 SEVEN ROUNDS',
            sfx: 'whisper',
            flag: 'tape-applied'
          };
        }
        var cd = S.get(TAPE_CD) | 0;
        if (cd > 0) {
          cd -= 1;
          S.set(TAPE_CD, cd);
          if (cd > 0) {
            return { bannerText: 'THE TAPE COUNTS\u2026 ' + cd, flag: 'tape-countdown' };
          }
          /* reached 0: judge */
          var watched = !!S.get(TAPE_WATCHED);
          S.set(TAPE_CD, 7);            /* re-arm the cycle */
          S.set(TAPE_WATCHED, false);
          if (watched) {
            return {
              flag: 'well-tape-forgiven',
              bannerText: '\u27B4 THE WELL REMEMBERS YOU WATCHED \u2014 FORGIVEN',
              sfx: 'chime'
            };
          }
          return {
            hpDelta: -10,
            bannerText: "\uD83D\uDCFC YOU DIDN'T WATCH THE TAPE \u2014 HP \u221210",
            sfx: 'heart',
            flag: 'tape-punished'
          };
        }
        return null;
      },
      onAnswer: function (ctx) {
        var S = IQ.Hooks.state;
        if (!S.get(TAPE_ARMED)) return null;
        var cd = S.get(TAPE_CD) | 0;
        if (cd > 0 && !S.get(TAPE_WATCHED) && ctx.res && ctx.res.correct) {
          S.set(TAPE_WATCHED, true);
          return { bannerText: 'SOMEWHERE FAR BELOW, THE TAPE STARTS PLAYING\u2026', flag: 'tape-watched' };
        }
        return null;
      }
    }
  });

  /* ==========================================================================
   * PACK 4 — HIVE ACID (world: hive-acid)
   * =========================================================================*/

  IQ.Hooks.add({
    id: 'hive-acid',
    worlds: ['hive-acid'],
    weight: 1,
    handlers: {
      onRoundStart: function (ctx) {
        /* seed 1-2 bursts at seeded times inside the round (never near t=0) */
        var span = Math.max(6, (ctx.timerLen || 60) - 6);
        var n = 1 + Math.floor(ctx.rng() * 2);
        var bursts = [];
        for (var i = 0; i < n; i++) bursts.push({ at: 2 + ctx.rng() * span, done: false });
        bursts.sort(function (a, b) { return a.at - b.at; });
        rec('acid', ctx, { bursts: bursts, clock: 0, last: nowMs(), banners: 0 });
        return null;
      },
      onTick: function (ctx) {
        var r = rec('acid', ctx, { bursts: [], clock: 0, last: nowMs(), banners: 0 });
        var t = nowMs();
        r.clock += Math.min((t - r.last) / 1000, 0.25);
        r.last = t;
        for (var i = 0; i < r.bursts.length; i++) {
          var b = r.bursts[i];
          if (!b.done && r.clock >= b.at) {
            b.done = true;
            r.banners += 1;
            var drips = '';
            for (var d = 0; d < 6; d++) {
              var left = 8 + ((d * 173 + ((b.at * 97) | 0)) % 84);
              var dur = 2.2 + (d % 3) * 0.3;
              drips += '<i class="iqh-drip" style="left:' + left + '%;animation:iqhDripFall ' + dur + 's ease-in 1 both"></i>';
            }
            if (!motionOK()) drips = '';   /* reduced motion: no animated drips */
            return {
              disableWrongRandom: 1,       /* the ENGINE picks a wrong victim */
              overlayHTML: '<div style="position:absolute;inset:0;overflow:hidden;pointer-events:none">' + drips + '</div>',
              overlayMs: 3000,
              bannerText: r.banners === 1 ? '\u2697 ACID SPLASH \u2014 ONE FALSE PATH EATS THROUGH' : '\u2697 ACID BURST',
              sfx: 'zap',
              flag: 'acid-burst'
            };
          }
        }
        return null;
      }
    }
  });

  /* ==========================================================================
   * PACK 5 — UPSIDE-DOWN FLIP (world: upside-down)
   * =========================================================================*/

  IQ.Hooks.add({
    id: 'upside-down-flip',
    worlds: ['upside-down'],
    weight: 1,
    handlers: {
      onRoundStart: function (ctx) {
        var r = rec('updown', ctx, { flipUntil: nowMs() + 5000, flashed: false });
        updownClass(true);
        return {
          bannerText: '\u2B06 THE ROOM IS NOT WHERE YOU LEFT IT',
          flag: 'upside-down'
        };
      },
      onTick: function (ctx) {
        var hasDoc = typeof document !== 'undefined' && document.body;
        var r = rec('updown', ctx, { flipUntil: nowMs(), flashed: true });
        var flipped = hasDoc && document.body.classList.contains('iqh-updown');
        if (nowMs() < r.flipUntil) {
          if (hasDoc && !flipped) updownClass(true);
          return null;
        }
        if (!flipped) return null;
        updownClass(false);
        if (r.flashed) return null;
        r.flashed = true;
        if (!motionOK()) return null;    /* reduced motion: silent swap, no flash */
        return {
          /* light flash, hard-capped at 150ms (rails: <=200ms, <=3Hz) */
          overlayHTML: '<div style="position:absolute;inset:0;background:rgba(226,244,252,.85);pointer-events:none"></div>',
          overlayMs: 150,
          flag: 'upside-flash'
        };
      }
    }
  });

  registerWorlds();

  /* Node smoke-run escape hatch: exercises the pure paths without a DOM. */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { HORROR_WORLDS: HORROR_WORLDS };
  }
})();
