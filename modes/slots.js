/**
 * modes/slots.js — ONE-ARMED GOD: three-spin shadow cabinet takeover stage
 * (vanilla JS/Canvas, asset-free).
 *
 * Registration shape (draft research/mode-contract.md; thin adapter — refinements are
 * one-line changes):
 *   window.IQ.Stage.register({
 *     id: 'slot-machine',
 *     name: 'ONE-ARMED GOD',
 *     weight: 2,
 *     mount: function (container, ctx) {
 *       // ctx = {depth, world, align, hp, score, streak, rng, seed, mp}
 *       return new Promise(function (resolve) { ... resolve(stageResult); });
 *     }
 *   });
 * If window.IQ.Stage is absent at load, the def queues on window.__stagePending
 * (StageCore drains it once the Stage module lands).
 *
 * Controls (nothing else to learn):
 *   Space / Enter / click / tap  -> STOP the currently spinning reel.
 *   One press per reel, 3 presses per spin, 3 spins. Un-stopped reels auto-stop
 *   after 7s so the round always resolves inside the 42s cap.
 *
 * StageResult fields resolved:
 *   {
 *     kind:    'score',
 *     correct: true  -> the god paid anything (total > 0; the engine's neutral
 *                        ladder would punish a null verdict, so partial payouts
 *                        are full wins),
 *                false -> the house wins everything (all three spins paid 0),
 *     points:  sum of the three spin payouts (tables scale UP with depth so the
 *              expected payout tracks the takeover band; raw totals above 500
 *              are clamped and parity-capped engine-side; diff>=5 doubles spin
 *              3 "double or nothing", clearly labeled),
 *     hpDelta: +10 on jackpot | -10 when every spin paid zero | 0 otherwise,
 *     summary: 'THE GOD PAYS 240' | 'THE HOUSE WINS' | 'JACKPOT — THE GOD PAYS 2300'
 *   }
 *   NEVER touches window.G; the engine applies scoring/hp host-side after resolve.
 *
 * Spin math (pure — this is why the relay is tiny):
 *   While a reel spins it advances one symbol per 40ms tick. On stop press the
 *   landing offset = (tickIndex * 7 + reelSalt) mod 20 — a pure function of the
 *   pressed tick index and the seed-derived salt, so client render and host
 *   recompute agree bit-for-bit. Reels DECELERATE visibly over their final 5
 *   symbols (honest landing, no snap-cut).
 *
 * Determinism — PATTERN Q-scalar:
 *   client->host {t:'stageStops', n, mode:'slot-machine', uid, ticks:[t1..t9]}
 *   — exactly 9 numbers per round, batched once at the end. The host recomputes
 *   payouts from its own identical strips/salts (same seed derivation) and stashes
 *   the authoritative result at window.__IQ_STAGE_AUTH['slot-machine:n:uid'] for
 *   StageCore to issue. Client renders its OWN result immediately and reconciles
 *   silently (the math is pure, so it never differs). SOLO shortcut: !ctx.mp ->
 *   zero frames ever.
 *
 * Reels & symbols: 3 public strips of 20 (weights differ per reel), composed at
 * mount from a DEDICATED seed stream mulberry32(seed ^ TAG) so every tab holds
 * byte-identical strips regardless of ctx.rng consumption order. align bad/chaotic
 * injects the cursed SKULL (pays nothing, breaks pairs); align good injects the
 * STAR (wildcard). Three stars = jackpot (600 at diff 1, scaling with the
 * payout tables). Near-miss framing is forbidden — copy never taunts and never
 * claims rigging either way ("essence wording only").
 *
 * Depth scaling (diff = clamp(1+floor(depth/6),1,5)):
 *   stake 20->60; skull frequency 0%->25%; diff>=5 third spin is
 *   double-or-nothing (auto-staked, labeled on the cabinet). Payout tables
 *   (pair/triple/jackpot) scale UP with depth: expected round payout tracks the
 *   takeover band [60%,135%] of puzzle payout 100*diff+40 — verified by
 *   .probe-slots-balance.js (awarded EV 67-70% at every diff after the
 *   engine's 500-clamp + takeover parity cap).
 *
 * Fairness rails: IQB_MOTION=false replaces spinning with instant per-symbol flips
 * (no animation at all); IQB_MUTED silences audio; paytable always on screen;
 * whole-canvas tap target (>>44px); localized payline glow only — no fullscreen
 * flashes.
 *
 * Self-play / smoke hook:
 *   window.__GOD__.state()   // -> {spin, phase, total, jackpot, ticks, done}
 *   window.__GOD__.stop()    // press-stop the currently spinning reel programmatically
 *   window.__GOD__.finish()  // force-resolve now with current tallies
 */
(function () {
  'use strict';

  var STRIP_LEN = 20;
  var TICK_MS = 40;                 // one symbol per 40ms while spinning
  var SPINS = 3;
  var AUTO_STOP_MS = 7000;          // un-stopped reel resolves itself
  var CAP_MS = 42000;               // <=45s hard self-resolve
  var STAKES = [20, 30, 40, 50, 60];
  /* payout tables indexed by diff-1: scale UP with depth so the expected round
   * payout stays inside the takeover band (see .probe-slots-balance.js) */
  var PAIR_PAY = [45, 80, 130, 190, 260];
  var SKULL_DIST = [[0, 0, 0], [0, 0, 1], [0, 1, 1], [1, 1, 2], [1, 2, 2]];
  var TRIPLE_PAYS = [
    { eye: 95, moon: 125, key: 160, crown: 260 },
    { eye: 180, moon: 240, key: 320, crown: 520 },
    { eye: 280, moon: 370, key: 500, crown: 800 },
    { eye: 430, moon: 570, key: 760, crown: 1200 },
    { eye: 520, moon: 690, key: 920, crown: 1450 }
  ];
  var JACKPOTS = [600, 900, 1300, 1800, 2300];
  /* ---------- tiny shared helpers (per-file, no deps) ---------- */

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function diffFor(depth) {
    return Math.max(1, Math.min(5, 1 + Math.floor((depth | 0) / 6)));
  }
  function flag(name) {
    try { return window.localStorage.getItem(name) === '1'; } catch (e) { return false; }
  }
  function register(def) {
    if (window.IQ && window.IQ.Stage && typeof window.IQ.Stage.register === 'function') {
      window.IQ.Stage.register(def);
    } else {
      (window.__stagePending = window.__stagePending || []).push(def);
    }
  }

  /* ---------- payout evaluation (PURE: shared by client render + host recompute) ---------- */

  function linePayout(line, pairPay, triplePay, jackpotPay) {
    var stars = 0, skull = false, rest = {}, i;
    for (i = 0; i < 3; i++) {
      var s = line[i];
      if (s === 'skull') skull = true;
      else if (s === 'star') stars++;
      else rest[s] = (rest[s] || 0) + 1;
    }
    if (skull) return 0;                       // cursed skull: pays nothing, breaks pairs
    if (stars === 3) return jackpotPay;        // triple star: the jackpot line
    var bestN = 0, bestSym = null, sym;
    for (sym in rest) {
      if (Object.prototype.hasOwnProperty.call(rest, sym) && rest[sym] > bestN) {
        bestN = rest[sym]; bestSym = sym;
      }
    }
    if (bestSym === null) return 0;
    if (bestN + stars >= 3) return triplePay[bestSym];   // stars complete triples
    if (bestN + stars === 2) return pairPay;             // star completes the pair
    return 0;
  }

  /* ---------- registration ---------- */

  register({
    id: 'slot-machine',
    name: 'ONE-ARMED GOD',
    weight: 2,
    mount: function (container, ctx) {
      return new Promise(function (resolve) {
        var diff = diffFor(ctx.depth);
        var stake = STAKES[diff - 1];
        var pairPay = PAIR_PAY[diff - 1];
        var triplePay = TRIPLE_PAYS[diff - 1];
        var jackpotPay = JACKPOTS[diff - 1];
        var doubleOrNothing = diff >= 5;
        var mp = !!ctx.mp;
        var net = (window.IQ && window.IQ.Net) || null;
        var roundNum = (ctx.round != null ? ctx.round : 0) | 0;
        var motionOff = flag('IQB_MOTION');

        /* ---------- public strips + salts (dedicated seed stream) ---------- */
        var stream = mulberry32(((ctx.seed | 0) ^ 0x61A7) | 0);
        var BASE = [
          { eye: 7, moon: 6, key: 4, crown: 3 },
          { eye: 6, moon: 5, key: 5, crown: 4 },
          { eye: 6, moon: 6, key: 4, crown: 4 }
        ];
        function buildStrip(comp) {
          var arr = [], sym;
          for (sym in comp) {
            if (Object.prototype.hasOwnProperty.call(comp, sym)) {
              for (var k = 0; k < comp[sym]; k++) arr.push(sym);
            }
          }
          return arr;
        }
        var strips = [], salts = [];
        (function () {
          var dist = SKULL_DIST[diff - 1];
          var wantStar = ctx.align === 'good';
          for (var r = 0; r < 3; r++) {
            var arr = buildStrip(BASE[r]);
            for (var s = 0; s < dist[r]; s++) {
              arr[(stream() * arr.length) | 0] = 'skull';   // cursed injection
            }
            if (wantStar) arr[(stream() * arr.length) | 0] = 'star';
            // Fisher-Yates with the same stream -> identical public order everywhere
            for (var i = arr.length - 1; i > 0; i--) {
              var j = (stream() * (i + 1)) | 0, t = arr[i]; arr[i] = arr[j]; arr[j] = t;
            }
            while (arr.length > STRIP_LEN) arr.pop();
            while (arr.length < STRIP_LEN) arr.push('eye');
            strips.push(arr);
            salts.push((stream() * 100000) | 0);
          }
        })();

        /* ---------- dom ---------- */
        var wrap = document.createElement('div');
        wrap.className = 'iq-god';
        var head = document.createElement('div');
        head.className = 'iq-god-head';
        var title = document.createElement('span');
        title.textContent = 'ONE-ARMED GOD · DEPTH ' + (ctx.depth | 0);
        var meta = document.createElement('span');
        meta.className = 'iq-god-meta';
        meta.textContent = 'space / tap stops the reel';
        head.appendChild(title); head.appendChild(meta);
        var midRow = document.createElement('div');
        midRow.className = 'iq-god-mid';
        var canvas = document.createElement('canvas');
        var table = document.createElement('div');   // paytable — ALWAYS on screen
        table.className = 'iq-god-table';
        midRow.appendChild(canvas); midRow.appendChild(table);
        var meter = document.createElement('div');
        meter.className = 'iq-god-meter';
        var foot = document.createElement('div');
        foot.className = 'iq-god-foot';
        wrap.appendChild(head); wrap.appendChild(midRow);
        wrap.appendChild(meter); wrap.appendChild(foot);
        var style = document.createElement('style');
        style.textContent =
          '.iq-god{display:flex;flex-direction:column;align-items:center;gap:6px;' +
          'color:#f2e8ff;font-family:monospace;background:#120a1e;padding:8px;border-radius:8px}' +
          '.iq-god-head{display:flex;justify-content:space-between;width:100%;font-size:13px;' +
          'letter-spacing:1px;color:#d0a7ff}.iq-god-meta{color:#7a5f9e;font-size:11px}' +
          '.iq-god-mid{display:flex;gap:10px;align-items:center}' +
          '.iq-god canvas{background:#1a1028;border:2px solid #3d2a5c;border-radius:4px;' +
          'touch-action:none;cursor:pointer}' +
          '.iq-god-table{font-size:11px;line-height:1.55;color:#cbb8e8;text-align:left}' +
          '.iq-god-table b{color:#ffe066;font-weight:normal}' +
          '.iq-god-meter{font-size:12px;color:#ffe066;letter-spacing:2px;min-height:15px}' +
          '.iq-god-foot{font-size:12px;color:#efe6ff;min-height:16px;letter-spacing:1px}';
        wrap.appendChild(style);
        container.appendChild(wrap);

        (function fillPaytable() {
          var html = '<b>PAYTABLE</b><br>' +
            '&#9733;&#9733;&#9733; wild x3 <b>' + jackpotPay + '</b><br>' +
            'crown x3 <b>' + triplePay.crown + '</b><br>' +
            'key x3 <b>' + triplePay.key + '</b><br>' +
            'moon x3 <b>' + triplePay.moon + '</b><br>' +
            'eye x3 <b>' + triplePay.eye + '</b><br>' +
            'any pair <b>' + pairPay + '</b><br>' +
            'skull breaks the line<br>' +
            'stake ' + stake + '/spin';
          if (doubleOrNothing) html += '<br><span style="color:#ff8fa3">SPIN 3: DOUBLE OR NOTHING</span>';
          table.innerHTML = html;
        })();

        /* ---------- state ---------- */
        var reels = [
          { mode: 'locked', pos: 0, posF: 0, tick: 0, landing: -1, steps: [], stepT: 0, spunAt: 0 },
          { mode: 'locked', pos: 0, posF: 0, tick: 0, landing: -1, steps: [], stepT: 0, spunAt: 0 },
          { mode: 'locked', pos: 0, posF: 0, tick: 0, landing: -1, steps: [], stepT: 0, spunAt: 0 }
        ];
        var ticks = [];                 // 9 relayed numbers: pressed tick index per stop
        var spinIdx = 0;                // 0-based
        var phase = 'intro';            // intro | spinning | settling | between | done
        var payouts = [];
        var total = 0, jackpot = false;
        var finished = false;
        var glowUntil = 0, glowPaid = null;             // localized payline glow window
        var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        var rafId = 0, capTimer = 0;
        var timeouts = [];

        function elapsed() {
          return (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
        }
        function later(fn, ms) {
          timeouts.push(window.setTimeout(fn, ms));
        }
        function nowMs() {
          return typeof performance !== 'undefined' ? performance.now() : Date.now();
        }

        /* ---------- audio (IQB_MUTED-gated) ---------- */
        var audioCtx = null;
        function beep(freq, ms) {
          if (flag('IQB_MUTED')) return;
          try {
            if (!audioCtx) {
              var AC = window.AudioContext || window.webkitAudioContext;
              if (!AC) return;
              audioCtx = new AC();
            }
            var o = audioCtx.createOscillator(), g = audioCtx.createGain();
            o.type = 'square'; o.frequency.value = freq;
            g.gain.setValueAtTime(0.04, audioCtx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000);
            o.connect(g).connect(audioCtx.destination);
            o.start(); o.stop(audioCtx.currentTime + ms / 1000);
          } catch (e) { /* never let audio break gameplay */ }
        }

        /* ---------- spin lifecycle ---------- */
        function spinLabel() {
          var n = Math.min(spinIdx + 1, SPINS);
          if (n === 3 && doubleOrNothing) return 'SPIN 3 OF 3 — DOUBLE OR NOTHING';
          return 'SPIN ' + n + ' OF ' + SPINS + ' — STAKE ' + stake;
        }
        function startSpin() {
          if (finished) return;
          phase = 'spinning';
          var now = nowMs();
          for (var r = 0; r < 3; r++) {
            var rl = reels[r];
            rl.mode = 'spin';
            rl.posF = rl.pos;
            rl.tick = 0;
            rl.landing = -1;
            rl.steps = [];
            rl.spunAt = now;
          }
          meta.textContent = spinLabel();
          beep(300, 70);
          updateMeter();
        }

        function pressStop() {
          if (finished || phase !== 'spinning') return false;
          for (var r = 0; r < 3; r++) {
            var rl = reels[r];
            if (rl.mode !== 'spin') continue;
            rl.tick = Math.floor(rl.posF);
            ticks.push(rl.tick);
            rl.landing = ((rl.tick * 7 + salts[r]) % STRIP_LEN + STRIP_LEN) % STRIP_LEN;
            if (motionOff) {
              lockReel(rl, rl.landing);       // instant per-symbol flip, zero animation
            } else {
              var cur = ((Math.floor(rl.posF) % STRIP_LEN) + STRIP_LEN) % STRIP_LEN;
              var d = (rl.landing - cur + STRIP_LEN) % STRIP_LEN;
              if (d < 5) d += STRIP_LEN;      // always visible forward travel
              // decelerate over the FINAL 5 symbols: honest landing, no snap-cut
              var ivs = [], k;
              for (k = 0; k < d - 5; k++) ivs.push(TICK_MS);
              ivs.push(60, 85, 125, 175, 235);
              rl.steps = ivs;
              rl.stepT = nowMs();
              rl.mode = 'land';
            }
            beep(500 + r * 120, 60);
            return true;
          }
          return false;
        }
        function lockReel(rl, landing) {
          rl.mode = 'locked';
          rl.pos = ((Math.floor(landing) % STRIP_LEN) + STRIP_LEN) % STRIP_LEN;
          rl.landing = rl.pos;
          rl.steps = [];
          if (reels.every(function (x) { return x.mode === 'locked'; })) settleSpin();
        }

        function settleSpin() {
          phase = 'settling';
          var line = [], r;
          for (r = 0; r < 3; r++) line.push(strips[r][reels[r].pos]);
          var paid = linePayout(line, pairPay, triplePay, jackpotPay);
          if (paid >= jackpotPay) jackpot = true;
          if (spinIdx === 2 && doubleOrNothing) paid *= 2;    // labeled DOUBLE OR NOTHING
          payouts.push(paid);
          total += paid;
          glowPaid = paid;
          glowUntil = nowMs() + (paid > 0 ? 1100 : 350);      // localized payline glow
          beep(paid >= jackpotPay ? 990 : paid > 0 ? 740 : 150, paid >= jackpotPay ? 320 : 140);
          updateMeter();
          foot.textContent = paid > 0
            ? 'THE GOD PAYS ' + paid + (spinIdx === 2 && doubleOrNothing ? ' (DOUBLED)' : '')
            : 'THE HOUSE TAKES THE LINE';
          later(function () {
            if (finished) return;
            spinIdx++;
            if (spinIdx >= SPINS) { finish(); return; }
            phase = 'between';
            foot.textContent = spinLabel();
            later(startSpin, 900);
          }, paid >= jackpotPay ? 1600 : 1300);
        }

        function updateMeter() {
          meter.textContent = 'OFFERING ' + stake + ' · CREDIT ' + total +
            (jackpot ? ' · GODLINESS' : '');
        }

        /* ---------- resolution ---------- */
        function finish() {
          if (finished) return;
          finished = true;
          phase = 'done';
          window.clearTimeout(capTimer);
          cancelAnimationFrame(rafId);
          for (var i = 0; i < timeouts.length; i++) window.clearTimeout(timeouts[i]);
          window.removeEventListener('keydown', onKey, true);
          window.removeEventListener('resize', fit);
          canvas.removeEventListener('pointerdown', onPress);

          // PATTERN Q-scalar relay: exactly nine numbers, batched once.
          if (mp && net) {
            net.send({ t: 'stageStops', n: roundNum, mode: 'slot-machine',
              uid: (net.myUid() || 'me'), ticks: ticks.slice(0, 9) });
          }

          var correct = total > 0 ? true : false; /* neutral ladder punishes partial wins */
          var summary = jackpot
            ? 'JACKPOT — THE GOD PAYS ' + total
            : (total > 0 ? 'THE GOD PAYS ' + total : 'THE HOUSE WINS');
          foot.textContent = summary;
          resolve({
            kind: 'score',
            correct: correct,
            points: total,                                   // raw payout; engine clamps 500 + parity-caps
            hpDelta: jackpot ? 10 : (total === 0 ? -10 : 0),
            summary: summary
          });
        }

        /* ---------- MP wiring: host recomputes authoritatively from 9 numbers ---------- */
        if (mp && net) {
          net.on('stageStops', function (m) {
            // Fires only where client->host frames land (the authority). Pure math:
            // same strips/salts from the same seed -> identical verdict.
            try {
              if (!m || m.t !== 'stageStops' || m.mode !== 'slot-machine') return;
              if (!m.ticks || m.ticks.length !== 9) return;
              var key = 'slot-machine:' + roundNum + ':' + String(m.uid || 'me');
              var auth = window.__IQ_STAGE_AUTH = window.__IQ_STAGE_AUTH || {};
              if (auth[key]) return;                         // idempotent
              var per = [], grand = 0;
              for (var sp = 0; sp < 3; sp++) {
                var line = [];
                for (var r = 0; r < 3; r++) {
                  var ti = ((m.ticks[sp * 3 + r] | 0) % 1000000 + 1000000) % 1000000;
                  var land = ((ti * 7 + salts[r]) % STRIP_LEN + STRIP_LEN) % STRIP_LEN;
                  line.push(strips[r][land]);
                }
                var p = linePayout(line, pairPay, triplePay, jackpotPay);
                if (sp === 2 && doubleOrNothing) p *= 2;
                per.push(p); grand += p;
              }
              auth[key] = {
                payouts: per, total: grand,
                jackpot: per.indexOf(jackpotPay) >= 0,
                stake: stake,
                correct: grand > 0 ? true : false,
                points: grand,
                hpDelta: per.indexOf(jackpotPay) >= 0 ? 10 : (grand === 0 ? -10 : 0)
              };
            } catch (e) { /* a malformed frame never breaks the cabinet */ }
          });
        }

        /* ---------- rendering ---------- */
        var cssW = 300, cssH = 260, dpr = 1, geo = null;
        function fit() {
          var w = Math.min(container.clientWidth || 340, 340);
          var h = Math.min(container.clientHeight || 300, 300);
          cssW = Math.max(220, w - 24);
          cssH = Math.max(170, h - 90);
          dpr = window.devicePixelRatio || 1;
          canvas.width = Math.round(cssW * dpr);
          canvas.height = Math.round(cssH * dpr);
          canvas.style.width = cssW + 'px';
          canvas.style.height = cssH + 'px';
          var reelW = cssW / 3, symS = Math.min(reelW * 0.62, cssH / 4);
          geo = { reelW: reelW, symS: symS, cy: cssH / 2 };
        }
        function drawSym(g, sym, cx, cy, s) {
          g.lineWidth = Math.max(1.5, s * 0.09);
          if (sym === 'eye') {
            g.strokeStyle = '#6fd3ff'; g.fillStyle = '#6fd3ff';
            g.beginPath();
            g.moveTo(cx - s / 2, cy);
            g.quadraticCurveTo(cx, cy - s * 0.55, cx + s / 2, cy);
            g.quadraticCurveTo(cx, cy + s * 0.55, cx - s / 2, cy);
            g.stroke();
            g.beginPath(); g.arc(cx, cy, s * 0.18, 0, Math.PI * 2); g.fill();
          } else if (sym === 'moon') {
            g.fillStyle = '#b9c8ff';
            g.beginPath(); g.arc(cx, cy, s * 0.36, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#241638';
            g.beginPath(); g.arc(cx + s * 0.17, cy - s * 0.08, s * 0.30, 0, Math.PI * 2); g.fill();
          } else if (sym === 'key') {
            g.strokeStyle = '#ffc46b';
            g.beginPath(); g.arc(cx - s * 0.16, cy, s * 0.19, 0, Math.PI * 2); g.stroke();
            g.beginPath();
            g.moveTo(cx + s * 0.03, cy); g.lineTo(cx + s * 0.42, cy);
            g.moveTo(cx + s * 0.28, cy); g.lineTo(cx + s * 0.28, cy + s * 0.16);
            g.moveTo(cx + s * 0.42, cy); g.lineTo(cx + s * 0.42, cy + s * 0.22);
            g.stroke();
          } else if (sym === 'crown') {
            g.fillStyle = '#ffe066';
            g.beginPath();
            g.moveTo(cx - s * 0.4, cy + s * 0.25);
            g.lineTo(cx - s * 0.4, cy - s * 0.15);
            g.lineTo(cx - s * 0.18, cy + s * 0.02);
            g.lineTo(cx, cy - s * 0.32);
            g.lineTo(cx + s * 0.18, cy + s * 0.02);
            g.lineTo(cx + s * 0.4, cy - s * 0.15);
            g.lineTo(cx + s * 0.4, cy + s * 0.25);
            g.closePath(); g.fill();
          } else if (sym === 'skull') {
            g.fillStyle = '#c77dff';
            g.beginPath(); g.arc(cx, cy - s * 0.06, s * 0.3, 0, Math.PI * 2); g.fill();
            g.fillRect(cx - s * 0.15, cy + s * 0.12, s * 0.3, s * 0.16);
            g.fillStyle = '#241638';
            g.beginPath(); g.arc(cx - s * 0.12, cy - s * 0.08, s * 0.08, 0, Math.PI * 2); g.fill();
            g.beginPath(); g.arc(cx + s * 0.12, cy - s * 0.08, s * 0.08, 0, Math.PI * 2); g.fill();
            g.beginPath();
            g.moveTo(cx, cy + s * 0.04); g.lineTo(cx - s * 0.06, cy + s * 0.16);
            g.lineTo(cx + s * 0.06, cy + s * 0.16);
            g.closePath(); g.fill();
          } else if (sym === 'star') {
            g.fillStyle = '#fff6b0';
            g.beginPath();
            for (var i = 0; i < 10; i++) {
              var ang = -Math.PI / 2 + i * Math.PI / 5;
              var rad = i % 2 === 0 ? s * 0.4 : s * 0.17;
              var px = cx + Math.cos(ang) * rad, py = cy + Math.sin(ang) * rad;
              if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
            }
            g.closePath(); g.fill();
          }
        }
        function draw(now) {
          if (!geo) return;
          var g = canvas.getContext('2d');
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          g.fillStyle = '#1a1028';
          g.fillRect(0, 0, cssW, cssH);
          for (var r = 0; r < 3; r++) {
            var rx = r * geo.reelW;
            g.fillStyle = '#241638';
            g.fillRect(rx + 2, 2, geo.reelW - 4, cssH - 4);
            var rl = reels[r];
            var disp = ((Math.floor(rl.posF) % STRIP_LEN) + STRIP_LEN) % STRIP_LEN;
            for (var row = -1; row <= 1; row++) {
              var idx = ((disp + row) % STRIP_LEN + STRIP_LEN) % STRIP_LEN;
              var sy = geo.cy + row * geo.symS * 1.18;
              if (sy < -geo.symS || sy > cssH + geo.symS) continue;
              drawSym(g, strips[r][idx], rx + geo.reelW / 2, sy, geo.symS);
            }
            if (motionOff && rl.mode === 'spin') {
              // IQB_MOTION=false: no animation — label the live reel instead
              g.fillStyle = '#cbb8e8';
              g.font = '11px monospace';
              g.textAlign = 'center';
              g.fillText('SPIN', rx + geo.reelW / 2, 16);
              g.textAlign = 'left';
            }
            g.strokeStyle = '#3d2a5c';
            g.lineWidth = 1;
            g.strokeRect(rx + 2.5, 2.5, geo.reelW - 5, cssH - 5);
          }
          // payline: localized glow only (never fullscreen)
          var glow = glowPaid !== null && now < glowUntil &&
            (motionOff || Math.floor(now / 90) % 2 === 0);
          g.strokeStyle = glow ? (glowPaid >= jackpotPay ? '#7dffcf' :
            glowPaid > 0 ? '#ffe066' : '#ff8fa3') : 'rgba(210,180,255,0.35)';
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(4, geo.cy); g.lineTo(cssW - 4, geo.cy);
          g.stroke();
          if (phase === 'intro') {
            g.fillStyle = '#cbb8e8';
            g.font = '12px monospace';
            g.textAlign = 'center';
            g.fillText('THE SHADOW DEALS THREE SPINS', cssW / 2, cssH - 8);
            g.textAlign = 'left';
          }
        }

        /* ---------- loop ----------
         * frame() is the SOLE rAF callback and the sole reel advancer: spinning
         * reels gain +1 symbol per TICK_MS (catch-up safe), landing schedules
         * drain their decel tail here, and the auto-stop safety fires per reel.
         */
        var lastAdv = 0;
        function frame(now) {
          if (finished) return;
          var i, rl;
          if (!lastAdv) lastAdv = now;
          while (now - lastAdv >= TICK_MS) {
            lastAdv += TICK_MS;
            if (phase === 'spinning') {
              for (i = 0; i < 3; i++) {
                if (reels[i].mode === 'spin') reels[i].posF += 1;
              }
            }
          }
          if (phase === 'spinning') {
            for (i = 0; i < 3; i++) {
              rl = reels[i];
              if (rl.mode === 'spin') {
                if (now - rl.spunAt >= AUTO_STOP_MS) pressStop();  // self-resolve safety
              } else if (rl.mode === 'land') {
                var budget = now - rl.stepT;
                while (rl.steps.length > 0 && budget >= rl.steps[0]) {
                  budget -= rl.steps.shift();
                  rl.posF += 1;
                  rl.stepT = now - budget;
                }
                if (rl.steps.length === 0) lockReel(rl, rl.landing);
              }
            }
          }
          draw(now);
          try {
            var frac = Math.max(0, 1 - elapsed() / CAP_MS);
            var tf = document.getElementById('timer-fill');
            if (tf) tf.style.transform = 'scaleX(' + frac + ')';
            var tn = document.getElementById('timer-num');
            if (tn) tn.textContent = String(Math.ceil(Math.max(0, (CAP_MS - elapsed()) / 1000)));
          } catch (e) { /* topbar chrome is optional */ }
          rafId = window.requestAnimationFrame(frame);
        }

        /* ---------- input ---------- */
        function onPress(e) {
          e.preventDefault();
          pressStop();
        }
        function onKey(e) {
          if (e.code === 'Space' || e.code === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pressStop();
          }
        }

        /* ---------- smoke / self-play hook ---------- */
        window.__GOD__ = {
          stop: function () { return pressStop(); },
          state: function () {
            return {
              spin: Math.min(spinIdx + 1, SPINS), phase: phase, stake: stake,
              total: total, jackpot: jackpot, payouts: payouts.slice(),
              ticks: ticks.slice(), done: finished, elapsedMs: Math.round(elapsed())
            };
          },
          finish: finish,
          // Gated dev peek (window.__IQ_SMOKE__ before load): lets the harness
          // independently recompute payouts from the recorded tick indices.
          peekReels: window.__IQ_SMOKE__
            ? function () {
                return { strips: strips.map(function (a) { return a.slice(); }),
                  salts: salts.slice(), pairPay: pairPay, triplePay: triplePay,
                  jackpotPay: jackpotPay, stake: stake };
              }
            : null
        };

        window.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', fit);
        canvas.addEventListener('pointerdown', onPress);
        capTimer = window.setTimeout(finish, CAP_MS);

        fit();
        updateMeter();
        rafId = window.requestAnimationFrame(frame);
        later(startSpin, 1100);
      });
    }
  });
})();
