/**
 * modes/saberclash.js — SABER CLASH: three-tap duel that re-weights a pending stake.
 *
 * Design doc: research/modes-themed-design.md §5.
 * Bind: interlude-stage slot; primary world `wizard-duel`; also the referee stage
 * fired on any world while a curse-pack curse or bonus is pending resolution.
 * This file registers WITHOUT worlds/aligns restrictions so the director (or the
 * pending-stake handoff) can slot it anywhere; eligibility pressure comes from
 * `IQ.Hooks.state['saberclash:stake']`.
 *
 * Registration shape (research/mode-contract.md §1):
 *   window.IQ.Stage.register({
 *     id: 'saberclash', name: 'SABER CLASH', weight: 9, net: 'seed',
 *     mount(container, ctx) -> Promise<StageResult>
 *   });
 * If window.IQ.Stage is absent the definition queues onto window.__stagePending
 * (drained by the takeover runner once Stage lands).
 *
 * Controls: ONE verb — tap (Space / click / touch). Three timed taps against a
 * marker sweeping closing rings; tap inside the seeded sweet arc = HIT.
 *
 * ctx fields consumed:
 *   depth      -> arc width 26%->14%, marker speed x(1+0.12*min(depth-1,12)),
 *                 depth>=6: telegraphed mid-ring feint reversal
 *   rng        -> ONLY randomness source (arc centers, directions, feint timing)
 *   mp         -> seed-sync note in header
 *   world/align/hp/score/streak -> header strip, read-only, never mutated
 *
 * StageResult (design §5 table): points 0 and hpDelta ALWAYS 0 — the duel only
 * re-weights the pending stake; it never wounds or pays directly.
 *   3 hits -> correct true  (curse nullified / bonus x1.5)
 *   2 hits -> correct null  partial (curse halved / bonus x1.2)
 *   <=1    -> correct false (curse lands full / bonus lost)
 * The rewritten magnitude lands in IQ.Hooks.state['saberclash:verdict']
 * ({kind, hits, mult}; host executes the rewrite from this enum).
 *
 * Fairness rails: IQB_MOTION off => static bar + zone mark + countdown, judgment
 * math IDENTICAL (no animation); IQB_MUTED gates synth audio; flashes <=200 ms,
 * <=3 Hz fullscreen-equivalent (only small canvas flashes here); hard cap 15 s.
 *
 * Determinism: arcs/speeds/feints seeded-sim from ctx.rng at mount; tap times are
 * quantized to 60 ms buckets before judgment (parity tools re-derive verdicts
 * from (seed, buckets)); the verdict enum executes host-side.
 *
 * Self-play / smoke hooks: window.__SABERCLASH__
 *   tap()        -> registers a tap NOW on the current ring (returns judged bool|null)
 *   state()      -> {ring, hits, resolved, elapsedMs, motionOn}
 *   finish()     -> force-end with current hits (fast soak)
 * Node: require('./modes/saberclash.js')._smoke() exercises pure paths headless.
 */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : globalThis;

  var RING_COUNT = 3;
  var CAP_MS = 15000;          // design: hard cap 15 s
  var INTRO_MS = 900;
  var GAP_MS = 380;            // breather between rings (hit/miss flash window)
  var BUCKET_MS = 60;          // §0.2 quantization
  var TAU = Math.PI * 2;
  var BASE_OMEGA = 2.4;        // rad/s ring 1 — ~2.6 s per sweep

  /* ---------- gates ---------- */
  function motionOn() {
    try {
      var v = root.localStorage && root.localStorage.getItem('IQB_MOTION');
      if (v != null && JSON.parse(v) === false) return false;
    } catch (e) {}
    try {
      if (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    } catch (e) {}
    return true;
  }
  function muted() {
    try { return root.localStorage.getItem('IQB_MUTED') === '1' || JSON.parse(root.localStorage.getItem('IQB_MUTED')) === true; }
    catch (e) { return false; }
  }

  /* ======================================================================
   * PURE CORE — exported for node smoke; every gameplay judgment funnels
   * through these so parity tools re-derive from (seed, buckets).
   * ====================================================================== */
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  /** Sweet-arc width as fraction of the ring: 26% -> 14% linear to depth 10. */
  function arcFracFor(depth) {
    var d = clamp((depth | 0) - 1, 0, 9);
    return 0.26 - (0.26 - 0.14) * (d / 9);
  }
  /** Marker speed multiplier: x(1 + 0.12*min(depth-1,12)). */
  function speedMulFor(depth) {
    return 1 + 0.12 * clamp((depth | 0) - 1, 0, 12);
  }
  /** Shortest angular distance. */
  function angDist(a, b) {
    var d = Math.abs(((a - b) % TAU + TAU) % TAU);
    return Math.min(d, TAU - d);
  }
  /** Quantize a millisecond stamp to the 60 ms bucket grid, as seconds. */
  function quantizeSec(ms) { return Math.max(0, Math.floor(ms / BUCKET_MS) * BUCKET_MS) / 1000; }

  /**
   * Closed-form marker angle for a ring at ring-local seconds t.
   * Feint (depth>=6): direction reverses once at tRev — piecewise but pure.
   */
  function markerAngleAt(ring, tSec) {
    if (!ring.feint || tSec <= ring.tRev) return ring.theta0 + ring.dir * ring.omega * tSec;
    return ring.theta0 + ring.dir * ring.omega * (2 * ring.tRev - tSec);
  }
  /** HIT iff quantized marker angle sits inside the sweet arc. */
  function judgeTap(ring, msIntoRing) {
    var ang = ((markerAngleAt(ring, quantizeSec(msIntoRing)) % TAU) + TAU) % TAU;
    return angDist(ang, ring.theta) <= ring.halfWidth;
  }

  /** Draw the three rings' params from ctx.rng (seeded-sim). */
  function buildRings(rng, depth) {
    var mul = speedMulFor(depth);
    var frac = arcFracFor(depth);
    var rings = [];
    for (var i = 0; i < RING_COUNT; i++) {
      var omega = BASE_OMEGA * (1 + 0.55 * i) * mul;         // escalating speed
      var dur = TAU / omega;                                  // full-sweep seconds
      var feint = depth >= 6 && rng() < 0.65;
      rings.push({
        theta0: rng() * TAU,                                  // marker start angle
        theta: rng() * TAU,                                   // sweet-arc center
        halfWidth: (frac * TAU) / 2,
        dir: rng() < 0.5 ? 1 : -1,
        omega: omega,
        dur: dur,
        feint: feint,
        tRev: feint ? dur * (0.4 + 0.3 * rng()) : Infinity    // telegraphed reversal
      });
    }
    return rings;
  }

  /**
   * Resolution ladder (§5): maps hits -> {correct, mult, summary}.
   * mult = fraction of the stake that survives (curse) or the payout
   * multiplier (bonus). Host rewrites the stake from this enum.
   */
  function verdictFor(kind, hits) {
    var curse = kind !== 'bonus';
    if (hits >= 3) return {
      correct: true,
      mult: curse ? 0 : 1.5,
      summary: curse ? 'DUEL WON · CURSE SHATTERED' : 'DUEL WON · BONUS EMPOWERED'
    };
    if (hits === 2) return {
      correct: null,
      mult: curse ? 0.5 : 1.2,
      summary: curse ? 'PARTIAL PARRY · CURSE HALVED' : 'PARTIAL PARRY · BONUS TRIMMED'
    };
    return {
      correct: false,
      mult: curse ? 1 : 0,
      summary: curse ? 'DISARMED · CURSE LANDS' : 'BONUS LOST · DISARMED'
    };
  }

  /* ====================================================================== */

  function def() {
    return {
      id: 'saberclash',
      name: 'SABER CLASH',
      weight: 9,
      net: 'seed',
      mount: function (container, ctx) {
        return new Promise(function (resolve) {
          var depth = Math.max(1, ctx.depth | 0);
          var motion = motionOn();
          var rings = buildRings(ctx.rng, depth);

          /* ---------- pending stake ---------- */
          var stake = { kind: 'curse' };
          try {
            var s = root.IQ && root.IQ.Hooks && root.IQ.Hooks.state &&
              root.IQ.Hooks.state.get('saberclash:stake');
            if (s && (s.kind === 'curse' || s.kind === 'bonus')) stake = s;
          } catch (e) {}

          /* ---------- dom ---------- */
          var wrap = document.createElement('div');
          wrap.className = 'stage-view';
          wrap.setAttribute('data-stage', 'saberclash');
          wrap.setAttribute('role', 'application');
          var head = document.createElement('div');
          head.className = 'iq-sc-head';
          var title = document.createElement('span');
          title.textContent = 'SABER CLASH · DEPTH ' + depth;
          var meta = document.createElement('span');
          meta.className = 'iq-sc-meta';
          meta.textContent = (stake.kind === 'bonus' ? 'BONUS AT STAKE' : 'CURSE AT STAKE') +
            (ctx.mp && ctx.mp.on ? ' · seed-synced' : '');
          var pips = document.createElement('span');
          pips.className = 'iq-sc-pips';
          head.appendChild(title); head.appendChild(meta); head.appendChild(pips);
          var canvas = document.createElement('canvas');
          canvas.setAttribute('aria-label', 'duel rings — tap inside the bright arc');
          var foot = document.createElement('div');
          foot.className = 'iq-sc-foot';
          foot.textContent = 'TAP  (SPACE / CLICK / TOUCH)';
          wrap.appendChild(head); wrap.appendChild(canvas); wrap.appendChild(foot);
          var style = document.createElement('style');
          style.textContent =
            '.stage-view[data-stage=saberclash]{position:absolute;inset:0;display:flex;' +
            'flex-direction:column;align-items:center;justify-content:center;gap:10px;' +
            "font-family:'Oxanium',monospace;background:#0a0714;color:#ffe9b8}" +
            '.iq-sc-head{display:flex;gap:18px;align-items:baseline;font-size:13px;' +
            'letter-spacing:.2em;color:#ffb01e;text-transform:uppercase}' +
            '.iq-sc-meta{color:#c9b6ff;font-size:11px}' +
            '.iq-sc-pips{color:#ff2038;font-size:12px;letter-spacing:.35em}' +
            '.iq-sc-foot{font-size:12px;letter-spacing:.25em;color:#8f86c2;min-height:16px}';
          wrap.appendChild(style);
          container.appendChild(wrap);

          /* ---------- audio ---------- */
          var actx = null;
          function beep(freq, ms) {
            if (muted()) return;
            try {
              if (!actx) {
                var AC = root.AudioContext || root.webkitAudioContext;
                if (!AC) return;
                actx = new AC();
              }
              var o = actx.createOscillator(), g = actx.createGain();
              o.type = 'square'; o.frequency.value = freq;
              g.gain.setValueAtTime(0.05, actx.currentTime);
              g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + ms / 1000);
              o.connect(g).connect(actx.destination);
              o.start(); o.stop(actx.currentTime + ms / 1000);
            } catch (e) {}
          }
          /* ---------- sizing ---------- */
          function fit() {
            var w = Math.max(200, Math.min(container.clientWidth || 480, (container.clientHeight || 480) - 90, 420));
            canvas.width = w; canvas.height = w;
          }
          fit();

          /* ---------- state machine ---------- */
          var finished = false, resolved = false;
          var ringIdx = -1;               // -1 = intro
          var hits = 0;
          var ringStart = 0, tapLocked = false, ringTimer = 0, gapTimer = 0;
          var flash = { kind: null, until: 0 };   // 'hit' | 'miss' | 'feint'
          var nowFn = function () { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); };
          var t0 = nowFn();
          var rafId = 0;

          function setPips() {
            var s = '';
            for (var i = 0; i < RING_COUNT; i++) s += i < hits ? '◆' : '◇';
            pips.textContent = s;
          }

          function startRing(i) {
            if (finished) return;
            ringIdx = i;
            tapLocked = false;
            ringStart = nowFn();
            var r = rings[i];
            foot.textContent = motion
              ? 'RING ' + (i + 1) + '/' + RING_COUNT + (r.feint ? ' · BEWARE THE FEINT' : '')
              : 'RING ' + (i + 1) + '/' + RING_COUNT + ' · TIME YOUR TAP';
            ringTimer = root.setTimeout(function () { settleRing(false); }, r.dur * 1000);
          }

          /** Advance after a tap or a swept-out ring. */
          function settleRing(hit) {
            if (finished || tapLocked) return;
            tapLocked = true;
            root.clearTimeout(ringTimer);
            if (hit) { hits++; beep(880, 70); flash.kind = 'hit'; }
            else { beep(140, 140); flash.kind = 'miss'; }
            flash.until = nowFn() + 170;             // <=200 ms cap
            setPips();
            gapTimer = root.setTimeout(function () {
              if (finished) return;
              if (ringIdx + 1 >= RING_COUNT) finish();
              else startRing(ringIdx + 1);
            }, GAP_MS);
          }

          /** Register a tap on the current ring (judgment is bucketed). */
          function tap() {
            if (finished || ringIdx < 0 || tapLocked) return null;
            var msIn = nowFn() - ringStart;
            var hit = judgeTap(rings[ringIdx], msIn);
            settleRing(hit);
            return hit;
          }

          function finish() {
            if (finished) return;
            finished = true;
            root.clearTimeout(ringTimer);
            root.clearTimeout(gapTimer);
            root.clearTimeout(watchdog);
            root.cancelAnimationFrame(rafId);
            root.removeEventListener('keydown', onKey, true);
            canvas.removeEventListener('pointerdown', onPointer);
            canvas.removeEventListener('touchstart', onTouch);
            root.removeEventListener('resize', fit);

            var v = verdictFor(stake.kind, hits);
            try {
              if (root.IQ && root.IQ.Hooks && root.IQ.Hooks.state) {
                root.IQ.Hooks.state.set('saberclash:verdict',
                  { kind: stake.kind, hits: hits, mult: v.mult });
              }
            } catch (e) {}
            foot.textContent = v.summary;
            var result = {
              kind: 'score',
              correct: v.correct,
              points: 0,                              // §5: never pays or wounds directly
              hpDelta: 0,
              summary: v.summary.length <= 48 ? v.summary : v.summary.slice(0, 48)
            };
            if (!resolved) { resolved = true; resolve(result); }
          }

          var watchdog = root.setTimeout(finish, CAP_MS);

          /* ---------- render ---------- */
          function draw() {
            if (finished) return;
            var g = canvas.getContext('2d');
            var W = canvas.width, cx = W / 2, cy = W / 2, R = W * 0.38;
            g.fillStyle = '#0a0714';
            g.fillRect(0, 0, W, W);

            if (!motion) { drawStaticBar(g, W); }
            else if (ringIdx < 0) { drawIntro(g, cx, cy, R); }
            else { drawRing(g, cx, cy, R); }

            rafId = root.requestAnimationFrame(draw);
          }

          function drawIntro(g, cx, cy, R) {
            g.strokeStyle = '#3d3468';
            g.lineWidth = 2;
            g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
            g.fillStyle = '#ffb01e';
            g.font = 'bold ' + Math.max(13, Math.round(R * 0.11)) + "px 'Oxanium',monospace";
            g.textAlign = 'center';
            g.fillText('TAP INSIDE THE ARC', cx, cy - R * 0.05);
            g.fillStyle = '#8f86c2';
            g.font = Math.max(11, Math.round(R * 0.075)) + "px 'Oxanium',monospace";
            g.fillText('three rings decide the stake', cx, cy + R * 0.14);
          }

          function drawRing(g, cx, cy, R) {
            var r = rings[ringIdx];
            var t = (nowFn() - ringStart) / 1000;
            var ang = ((markerAngleAt(r, t) % TAU) + TAU) % TAU;

            // track
            g.strokeStyle = '#3d3468'; g.lineWidth = 6;
            g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();

            // sweet arc
            g.strokeStyle = '#ffb01e'; g.lineWidth = 12;
            g.beginPath(); g.arc(cx, cy, R, r.theta - r.halfWidth, r.theta + r.halfWidth); g.stroke();

            // feint telegraph: 150 ms pre-reversal glow (<=3 Hz trivially)
            var preFeint = r.feint && t >= r.tRev - 0.15 && t <= r.tRev;
            if (preFeint) {
              g.strokeStyle = 'rgba(255,32,56,.85)'; g.lineWidth = 18;
              g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
              flash.kind = 'feint'; flash.until = nowFn() + 160;
            }

            // marker
            var mx = cx + Math.cos(ang) * R, my = cy + Math.sin(ang) * R;
            g.fillStyle = '#eafefe';
            g.beginPath(); g.arc(mx, my, 9, 0, TAU); g.fill();

            if (flash.kind && nowFn() < flash.until) {
              g.strokeStyle = flash.kind === 'hit' ? 'rgba(0,230,138,.5)' :
                flash.kind === 'miss' ? 'rgba(255,32,56,.45)' : 'rgba(255,176,30,.35)';
              g.lineWidth = 10;
              g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
            }
          }

          /** MOTION OFF: static bar, zone marked, countdown — same judgment math. */
          function drawStaticBar(g, W) {
            var pad = W * 0.12, bw = W - pad * 2, by = W / 2 - 14, bh = 28;
            g.strokeStyle = '#3d3468'; g.lineWidth = 2;
            g.strokeRect(pad, by, bw, bh);
            if (ringIdx >= 0) {
              var r = rings[ringIdx];
              // zone position maps theta->[0,1] of the bar; width mirrors the arc
              var zx = ((r.theta % TAU) + TAU) % TAU / TAU;
              var zw = (r.halfWidth * 2) / TAU;
              g.fillStyle = '#ffb01e';
              g.fillRect(pad + ((zx - zw / 2 + 1) % 1) * bw, by, Math.max(6, zw * bw), bh);
              var left = Math.max(0, r.dur - (nowFn() - ringStart) / 1000);
              g.fillStyle = '#eafefe';
              g.font = "12px 'Oxanium',monospace"; g.textAlign = 'center';
              g.fillText('TAP WHEN THE COUNTDOWN CROSSES THE GOLD ZONE · ' +
                left.toFixed(1) + 's', W / 2, by + bh + 22);
            } else {
              g.fillStyle = '#8f86c2';
              g.font = "13px 'Oxanium',monospace"; g.textAlign = 'center';
              g.fillText('GET READY — TAP INSIDE THE GOLD ZONE', W / 2, W / 2 + 44);
            }
          }

          rafId = root.requestAnimationFrame(draw);
          setPips();
          root.setTimeout(function () { startRing(0); }, INTRO_MS);

          /* ---------- input ---------- */
          function onKey(e) {
            if (e.code === 'Space' || e.key === ' ') {
              e.preventDefault();
              tap();
            }
          }
          function onPointer(e) { e.preventDefault(); tap(); }
          function onTouch(e) { e.preventDefault(); tap(); }
          root.addEventListener('keydown', onKey, true);
          canvas.addEventListener('pointerdown', onPointer);
          canvas.addEventListener('touchstart', onTouch, { passive: false });

          /* ---------- self-play / smoke hooks ---------- */
          root.__SABERCLASH__ = {
            tap: tap,
            state: function () {
              return {
                ring: ringIdx, hits: hits, resolved: resolved,
                elapsedMs: Math.round(nowFn() - t0), motionOn: motion,
                stakeKind: stake.kind
              };
            },
            finish: finish
          };
        });
      },
      cleanup: function () {
        // engine abort path: hooks/listeners are torn down inside finish();
        // nothing further to undo — state writes only happen on real finish.
      }
    };
  }

  /* ======================================================================
   * HEADLESS SMOKE — pure paths only (no DOM). node -e "..._smoke()"
   * ====================================================================== */
  function _smoke() {
    var checks = [];
    var ok = function (name, cond) { checks.push({ name: name, ok: !!cond }); };

    // deterministic fake rng
    function seq(values) { var i = 0; return function () { return values[(i++) % values.length]; }; }
    function mulberry(a) {
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    // 1. scaling curves
    ok('arc width 26% at depth 1', Math.abs(arcFracFor(1) - 0.26) < 1e-9);
    ok('arc width clamps 14% deep', Math.abs(arcFracFor(99) - 0.14) < 1e-9);
    ok('speed mul 1.0 at depth 1', speedMulFor(1) === 1);
    ok('speed mul caps at x2.44', Math.abs(speedMulFor(99) - 2.44) < 1e-9);

    // 2. buildRings determinism
    var a = buildRings(mulberry(1234), 4), b = buildRings(mulberry(1234), 4);
    ok('same seed -> identical rings', JSON.stringify(a) === JSON.stringify(b));
    ok('rings escalate in speed', a[0].omega < a[1].omega && a[1].omega < a[2].omega);
    var c = buildRings(mulberry(77), 8);
    ok('deep rings may feint (schedule present)', c.some(function (r) { return r.feint; }));
    ok('shallow rings never feint', !buildRings(mulberry(77), 4).some(function (r) { return r.feint; }));

    // 3. feint reversal is continuous at tRev
    var fr = c.filter(function (r) { return r.feint; })[0];
    if (fr) {
      var l = markerAngleAt(fr, fr.tRev - 1e-6), rr = markerAngleAt(fr, fr.tRev + 1e-6);
      ok('feint angle continuous at reversal', Math.abs(l - rr) < 1e-3);
      ok('feint doubles back (velocity flips)',
        Math.sign(markerAngleAt(fr, fr.tRev + 0.1) - markerAngleAt(fr, fr.tRev)) === -fr.dir);
    }

    // 4. judgment: dead-center tap always hits; opposite point always misses
    var probe = { theta: Math.PI / 2, halfWidth: 0.2, dir: 1, omega: 2, feint: false, tRev: Infinity, dur: 3 };
    var tHit; probe.theta0 = 0;
    tHit = (Math.PI / 2) / probe.omega;   // marker crosses arc center at this time
    ok('center tap = HIT', judgeTap(probe, tHit * 1000) === true);
    ok('opposite tap = MISS',
      judgeTap(probe, ((Math.PI / 2 + Math.PI) / probe.omega) * 1000) === false);
    // 5. quantization: sub-bucket jitter cannot flip a deep-center verdict
    var edgeT = tHit * 1000;
    ok('quantization stable within bucket',
      judgeTap(probe, edgeT) === judgeTap(probe, edgeT + BUCKET_MS - 1));

    // 6. ladder mapping
    var cu = verdictFor('curse', 3), bo = verdictFor('bonus', 3),
      cu2 = verdictFor('curse', 2), bo1 = verdictFor('bonus', 1);
    ok('3 hits: curse nullified (mult 0, correct)', cu.correct === true && cu.mult === 0);
    ok('3 hits: bonus x1.5', bo.mult === 1.5);
    ok('2 hits: partial (null)', cu2.correct === null && cu2.mult === 0.5);
    ok('<=1 hit: curse lands full', bo1.correct === false && verdictFor('curse', 0).mult === 1);
    ok('<=1 hit: bonus lost', bo1.mult === 0);
    [cu, bo, cu2, bo1, verdictFor('curse', 0), verdictFor('bonus', 2)].forEach(function (v) {
      ok('summary <=48 chars: "' + v.summary + '"', v.summary.length <= 48);
    });
    // 6b. economy contract (balance pass 2026-08-25): the duel NEVER pays or
    // wounds directly — points stay 0 and hpDelta stays 0 in the StageResult;
    // verdictFor may only speak in {correct, mult, summary}. Ladders must be
    // strictly monotonic so more hits are never worse.
    ['curse', 'bonus'].forEach(function (kind) {
      [0, 1, 2, 3].forEach(function (h) {
        var v = verdictFor(kind, h);
        ok(kind + ' x' + h + ': no direct pay/wound fields', !('points' in v) && !('hpDelta' in v));
      });
      ok(kind + ' ladder monotonic', (function () {
        var ms = [];
        for (var h = 0; h <= 3; h++) ms.push(verdictFor(kind, h).mult);
        if (kind === 'curse') return ms[0] >= ms[1] && ms[1] > ms[2] && ms[2] > ms[3];
        return ms[0] <= ms[1] && ms[1] < ms[2] && ms[2] < ms[3];
      })());
      ok(kind + ' correct mapping 3/2/<=1',
        verdictFor(kind, 3).correct === true &&
        verdictFor(kind, 2).correct === null &&
        verdictFor(kind, 1).correct === false);
    });

    // 7. quantizeSec grid
    ok('bucket grid 60ms', quantizeSec(125) === 0.12 && quantizeSec(59) === 0 && quantizeSec(-5) === 0);

    var fails = checks.filter(function (c2) { return !c2.ok; });
    checks.forEach(function (c2) { console.log((c2.ok ? '  ok  ' : 'FAIL  ') + c2.name); });
    console.log(fails.length ? '[saberclash] smoke FAILURES: ' + fails.length : '[saberclash] smoke: ALL PASS');
    return { ok: fails.length === 0, checks: checks };
  }

  /* ---------- registration (queues when Stage absent) ---------- */
  function register() {
    var d = def();
    if (root.IQ && root.IQ.Stage && typeof root.IQ.Stage.register === 'function') {
      root.IQ.Stage.register(d);
    } else {
      root.__stagePending = root.__stagePending || [];
      root.__stagePending.push(d);
    }
  }

  root.IQ = root.IQ || {};
  root.IQ.SaberClash = { _smoke: _smoke };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      _smoke: _smoke,
      buildRings: buildRings, verdictFor: verdictFor, judgeTap: judgeTap,
      markerAngleAt: markerAngleAt, arcFracFor: arcFracFor, speedMulFor: speedMulFor,
      quantizeSec: quantizeSec, angDist: angDist
    };
  }

  register();
})();
