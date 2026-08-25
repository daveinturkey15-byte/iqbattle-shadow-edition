/* ============================================================================
 * modes/phoenixritual.js — SEED-PHOENIX RITUAL
 * Design doc: research/modes-themed-design.md §8 "SEED-PHOENIX RITUAL"
 * Contract:   research/mode-contract.md (canonical StageResult; §0.1 themed
 *             design pass). MP pattern: seeded-sim (§0.2 D1) — every schedule
 *             (swell period, peak times) is a pure function of the stage
 *             clock and mount-time params drawn ONCE from ctx.rng; the
 *             hold-release outcome is ONE quantized-band verdict.
 * ----------------------------------------------------------------------------
 * REGISTRATION SHAPE (queued on window.__stagePending when IQ.Stage is absent;
 * StageCore drains the queue — same convention as modes/snake.js):
 *
 *   IQ.Stage.register({
 *     id: 'phoenix-ritual',
 *     name: 'PHOENIX RITUAL',
 *     weight: 4,
 *     worlds: ['heaven', 'womb', 'stair-of-heaven'],  // design §8 bind
 *     net: 'seed',
 *     mount(container, ctx) -> Promise<StageResult>
 *   });
 *
 * NOTE: offering this stage on rounds where depth % 5 === 0 in bound worlds is
 * DIRECTOR policy, not registration policy — flagged for the director owner.
 *
 * CONTROLS
 *   PLANT  (<=4 s): click/tap a seed card — EMBER / DEW / THORN.
 *                   No pick before the bell -> auto-pick (seeded at mount).
 *   GROW   (6 s):   HOLD pointer (or Space/Enter) while the circle swells,
 *                   RELEASE as close to a swell peak as you can. Never
 *                   releasing is allowed: x0.25 harvest, ritual completes.
 *   BURN   (4 s):   deliberate no-input beat; any key/click after 1 s skips.
 *   REBORN (<=4 s): payout reveal; click/key ends early.
 *   Esc at ANY beat advances gracefully (never traps the player).
 *
 * RESULT FIELDS (canonical StageResult)
 *   kind:    'score'
 *   correct: true on full/partial yield · false ONLY on the never-released
 *            minimal-yield path (the ritual structurally always completes)
 *   points:  seed yield x growMult x tierMult x depthScale, round-half-down
 *            ember +40 · dew 0 (pays hpDelta instead) · thorn 60% +90 / 40% hp
 *            growMult: full=1 · partial=0.5 · never-released=0.25
 *            tierMult: tier1=x1 · tier2=x1.5 · tier3=x2 (cap)
 *            depthScale: +10%/depth over depth 1 (round-half-down, ties -inf)
 *   hpDelta: dew +12 base · thorn miss -10 base (same multipliers) · else 0
 *   summary: 'REBORN IN FLAME' | 'A WEAK BLOOM' | 'THE ASH KEEPS ITS SECRET'
 *
 * CROSS-ROUND CARRY (design §0.1): run-scoped counters live in IQ.Hooks.state
 *   'phoenix:rituals' — completed rituals this run
 *   'phoenix:tier'    — derived tier 1..3 (every 3rd ritual raises it)
 * This stage only WRITES those keys; it never applies modifiers (host-owned).
 *
 * FAIRNESS RAILS: IQB_MOTION off -> static ring + numeric countdown (the swell
 * schedule stays clock-pure either way); rebirth flash <=200 ms, <=2 per stage;
 * all text >=11 px; Esc always available; 18 s internal cap (4+6+4+4), well
 * under the 45 s stage cap; promise settles exactly once. No hidden answers
 * exist to leak; scoring math is host-authoritative — numbers only, here.
 * ============================================================================*/
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};

  /* ---------------- tunables (design §8) ---------------- */
  var PLANT_MS = 4000;
  var GROW_MS = 6000;
  var BURN_MS = 4000;
  var REBORN_MS = 4000;
  var CAP_MS = PLANT_MS + GROW_MS + BURN_MS + REBORN_MS; /* 18000 */

  var SEEDS = [
    { key: 'ember', label: 'EMBER', line: 'ambition', pts: 40, hp: 0 },
    { key: 'dew', label: 'DEW', line: 'mending', pts: 0, hp: 12 },
    { key: 'thorn', label: 'THORN', line: 'greed', pts: 0, hp: 0 } /* gamble */
  ];
  var THORN_WIN_P = 0.6, THORN_WIN_PTS = 90, THORN_MISS_HP = -10;

  /* ------------- pure core (exported for node smoke harnesses) ------------ */

  /* round-half-down: ties toward -infinity (10.5 -> 10, -10.5 -> -11) */
  function roundHalfDown(x) {
    return Math.ceil(x - 0.5);
  }

  /* peak band ±250 ms -> ±140 ms floor with depth */
  function bandMsFor(depth) {
    return Math.max(140, 250 - Math.max(0, (depth | 0) - 1) * 14);
  }

  /* swell rate up: breathing period shrinks 4000 ms -> 2800 ms floor (~0.25 Hz+) */
  function periodFor(depth) {
    return Math.max(2800, 4000 - Math.max(0, (depth | 0) - 1) * 150);
  }

  /* payouts +10%/depth */
  function payScaleFor(depth) {
    return 1 + 0.1 * Math.max(0, (depth | 0) - 1);
  }

  /* every 3rd COMPLETED ritual this run raises the tier; cap 3 */
  function tierFor(priorRituals) {
    return Math.min(3, 1 + Math.floor(Math.max(0, priorRituals | 0) / 3));
  }
  function tierMult(tier) {
    return tier >= 3 ? 2 : tier === 2 ? 1.5 : 1;
  }

  /* circle phase 0..1; peaks (phase=1) at t = period/2 + k*period — pure f(t,p) */
  function swellPhase(tMs, periodMs) {
    return 0.5 - 0.5 * Math.cos((2 * Math.PI * tMs) / periodMs);
  }

  /* THE quantized-band grow verdict. releaseMs shares the clock that drives
   * the choreography; null => never released. */
  function growVerdict(releaseMs, depth) {
    if (releaseMs == null || !isFinite(releaseMs)) return 'none';
    var period = periodFor(depth);
    var band = bandMsFor(depth);
    var k = Math.round((releaseMs - period / 2) / period);
    var peak = period / 2 + k * period;
    return Math.abs(releaseMs - peak) <= band ? 'full' : 'partial';
  }

  function growMult(verdict) {
    return verdict === 'full' ? 1 : verdict === 'partial' ? 0.5 : 0.25;
  }

  /* pre-multiplier yield table (design §8) */
  function baseYield(seedKey, thornWon) {
    if (seedKey === 'ember') return { pts: 40, hp: 0 };
    if (seedKey === 'dew') return { pts: 0, hp: 12 };
    return thornWon ? { pts: THORN_WIN_PTS, hp: 0 } : { pts: 0, hp: THORN_MISS_HP };
  }

  /* full StageResult derivation — single source used by UI and smokes alike */
  function computePayout(opts) {
    var v = growMult(opts.verdict);
    var tm = tierMult(opts.tier);
    var ps = payScaleFor(opts.depth);
    var b = baseYield(opts.seedKey, !!opts.thornWon);
    return {
      kind: 'score',
      correct: opts.verdict !== 'none',
      points: roundHalfDown(b.pts * v * tm * ps),
      hpDelta: roundHalfDown(b.hp * v * tm * ps),
      summary:
        opts.verdict === 'full' ? 'REBORN IN FLAME'
          : opts.verdict === 'partial' ? 'A WEAK BLOOM'
            : 'THE ASH KEEPS ITS SECRET'
    };
  }

  /* guarded Hooks.state accessors — carry keys survive only if Hooks landed */
  function stGet(k) {
    try {
      var s = root.IQ && root.IQ.Hooks && root.IQ.Hooks.state;
      return s ? s.get(k) : undefined;
    } catch (e) { return undefined; }
  }
  function stSet(k, v) {
    try {
      var s = root.IQ && root.IQ.Hooks && root.IQ.Hooks.state;
      if (s && typeof s.set === 'function') s.set(k, v);
    } catch (e) { /* carry is best-effort; never kill a round */ }
  }
  function motionOK() {
    try {
      var v = root.localStorage && root.localStorage.getItem('IQB_MOTION');
      return v == null ? true : JSON.parse(v) !== false;
    } catch (e) { return true; }
  }

  /* ---------------- CSS (scoped pr-* classes, one injected sheet) --------- */
  var CSS =
    '.pr-root{position:absolute;inset:0;display:flex;flex-direction:column;' +
    'align-items:center;justify-content:center;gap:18px;font-family:\'Oxanium\',sans-serif;' +
    'background:radial-gradient(ellipse at 50% 20%,#141a2b,#05070d 70%);color:#e8ecf4;' +
    'user-select:none;-webkit-user-select:none}' +
    '.pr-beat{font-size:13px;letter-spacing:.34em;color:#9fb4d8;text-transform:uppercase}' +
    '.pr-title{font-size:clamp(18px,3vw,30px);font-weight:900;letter-spacing:.22em;color:#ffb01e}' +
    '.pr-sub{font-size:12px;letter-spacing:.14em;color:#8fa2c4;min-height:16px;text-align:center}' +
    '.pr-cards{display:flex;gap:18px;margin-top:6px;flex-wrap:wrap;justify-content:center}' +
    '.pr-card{width:150px;min-height:124px;border:1px solid #33405c;border-radius:14px;' +
    'background:#0b101c;padding:14px 12px;cursor:pointer;text-align:center;color:#e8ecf4;' +
    'display:flex;flex-direction:column;gap:8px;align-items:center;font-family:inherit}' +
    '.pr-card:hover,.pr-card:focus-visible{border-color:#ffb01e;background:#121a2e;outline:none}' +
    '.pr-card .pr-dot{width:38px;height:38px;border-radius:50%}' +
    '.pr-card .pr-name{font-weight:800;letter-spacing:.24em;font-size:14px}' +
    '.pr-card .pr-line{font-size:11px;color:#93a5c7;letter-spacing:.08em}' +
    '.pr-ringwrap{position:relative;width:min(46vh,300px);height:min(46vh,300px);' +
    'display:flex;align-items:center;justify-content:center}' +
    '.pr-ring{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
    'border-radius:50%;border:2px solid #ffb01e;background:radial-gradient(circle,#3a2408,#160c02 75%);' +
    'box-shadow:0 0 26px rgba(255,176,30,.28)}' +
    '.pr-hint{position:absolute;width:100%;text-align:center;font-size:12px;' +
    'letter-spacing:.26em;color:#ffd88a;top:calc(100% + 12px)}' +
    '.pr-count{position:relative;font-size:clamp(26px,5vh,44px);font-weight:900;' +
    'letter-spacing:.12em;color:#ffe9bd;z-index:2}' +
    '.pr-pay{font-size:clamp(20px,4vw,34px);font-weight:900;letter-spacing:.18em}' +
    '.pr-good{color:#00e68a}.pr-bad{color:#ff2038}.pr-gold{color:#ffb01e}' +
    '.pr-foot{font-size:11px;letter-spacing:.18em;color:#5f7095;min-height:15px}' +
    '@media (prefers-reduced-motion){.pr-root{animation:none}}';

  /* ---------------- registration ---------------- */
  var DEF = {
    id: 'phoenix-ritual',
    name: 'PHOENIX RITUAL',
    weight: 6,
    worlds: ['heaven', 'womb', 'stair-of-heaven'],
    net: 'seed',
    mount: mount,
    describe: function () {
      return { id: DEF.id, name: DEF.name, beatsMs: [PLANT_MS, GROW_MS, BURN_MS, REBORN_MS] };
    },
    cleanup: function () {
      if (live) { try { live.teardown(); } catch (e) { /* already gone */ } live = null; }
    }
  };

  var live = null; /* teardown handle of an in-flight mount */

  function register() {
    if (root.IQ && root.IQ.Stage && typeof root.IQ.Stage.register === 'function') {
      root.IQ.Stage.register(DEF);
    } else {
      /* Stage not landed yet (StageCore owns index.html): park the definition */
      (root.__stagePending = root.__stagePending || []).push(DEF);
    }
  }

  /* ---------------- mount ---------------- */
  function mount(container, ctx) {
    return new Promise(function (resolve) {
      var settled = false, torn = false, growDone = false, burned = false;
      var timeouts = [];
      var rafs = [];
      var clock = 0;

      var depth = Math.max(1, (ctx && ctx.depth) | 0);
      var rng = (ctx && ctx.rng) || Math.random; /* engine always supplies rng; defensive only */

      /* ---- seeded params: drawn ONCE at stage start, in documented order ---- */
      var thornWon = rng() < THORN_WIN_P;                                /* draw 1 */
      var autoPickIdx = Math.floor(rng() * SEEDS.length) % SEEDS.length; /* draw 2 */

      var prior = Number(stGet('phoenix:rituals')) || 0;
      var tier = tierFor(prior);

      /* ---- helpers ---- */
      function nowMs() {
        /* stage clock anchored to first rAF timestamp; gameplay judgments use
         * differences on this timeline only — never Date.now/performance.now */
        return clock;
      }
      function raf(fn) { var id = requestAnimationFrame(fn); rafs.push(id); return id; }
      function later(fn, ms) { var id = setTimeout(fn, ms); timeouts.push(id); return id; }
      function el(tag, cls, txt) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (txt != null) n.textContent = txt;
        return n;
      }
      function say(t) { if (ctx && typeof ctx.banner === 'function') { try { ctx.banner(t); } catch (e) {} } }
      function cue(n) { if (ctx && ctx.audio && ctx.audio.p) { try { ctx.audio.p(n); } catch (e) {} } }
      /* gated rebirth flash: <=200 ms, max 2 per stage */
      var flashes = 0;
      function flash() {
        if (!motionOK() || flashes >= 2) return;
        flashes++;
        if (ctx && ctx.fx && typeof ctx.fx.flash === 'function') {
          try { ctx.fx.flash(160); return; } catch (e) { /* fall through */ }
        }
        view.style.transition = 'none';
        view.style.background = '#fff';
        setTimeout(function () { view.style.background = ''; }, 160);
      }

      /* ---- surface ---- */
      if (document.head && !document.getElementById('iqb-phoenix-style')) {
        var st = document.createElement('style');
        st.id = 'iqb-phoenix-style';
        st.textContent = CSS;
        document.head.appendChild(st);
      }
      container.textContent = '';
      var view = document.createElement('div');
      view.className = 'stage-view pr-root';
      view.setAttribute('data-stage', 'phoenix-ritual');
      container.appendChild(view);

      /* ---- lifecycle: resolve EXACTLY once ---- */
      function finish(result) {
        if (settled || torn) return;
        settled = true;
        stSet('phoenix:rituals', prior + 1);
        stSet('phoenix:tier', tierFor(prior + 1));
        teardown();
        resolve(result);
      }
      function teardown() {
        torn = true;
        for (var i = 0; i < timeouts.length; i++) clearTimeout(timeouts[i]);
        timeouts.length = 0;
        for (var j = 0; j < rafs.length; j++) cancelAnimationFrame(rafs[j]);
        rafs.length = 0;
        document.removeEventListener('keydown', onEsc, true);
      }
      live = { teardown: teardown };

      var escHandler = function () {};
      function onEsc(e) {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        escHandler();
      }
      document.addEventListener('keydown', onEsc, true);

      function pump(ts) {
        if (!clock) clock = ts || 1;
        clock = ts || clock;
        raf(pump);
      }
      raf(pump);

      /* ================= BEAT 1 · PLANT (<=4 s) ================= */
      var picked = null;
      function plant() {
        view.appendChild(el('div', 'pr-beat', 'THE RITUAL \u00B7 PLANT'));
        view.appendChild(el('div', 'pr-title', 'CHOOSE YOUR SEED'));
        view.appendChild(el('div', 'pr-sub',
          'tier ' + tier + ' harvest \u00B7 what you plant decides what rises'));
        var row = el('div', 'pr-cards');
        SEEDS.forEach(function (s) {
          var card = el('button', 'pr-card');
          card.type = 'button';
          var dot = el('div', 'pr-dot');
          dot.style.background =
            s.key === 'ember' ? 'radial-gradient(circle at 35% 30%,#ffd75e,#ff6a00 60%,#7a1e00)'
              : s.key === 'dew' ? 'radial-gradient(circle at 35% 30%,#bff3ff,#39a7e0 60%,#0d4d73)'
                : 'radial-gradient(circle at 35% 30%,#e6c9ff,#8b4fd8 60%,#37145e)';
          card.appendChild(dot);
          card.appendChild(el('div', 'pr-name', s.label));
          card.appendChild(el('div', 'pr-line', s.line + ' \u00B7 ' +
            (s.key === 'ember' ? '+40 score' : s.key === 'dew' ? '+12 vitality' : 'the gamble')));
          card.addEventListener('click', function () {
            if (!picked) { picked = s.key; toGrow(s.key); }
          });
          row.appendChild(card);
        });
        view.appendChild(row);
        var cd = el('div', 'pr-foot', '');
        view.appendChild(cd);
        var t0 = nowMs();
        (function tickPlant() {
          if (picked || torn) return;
          var left = PLANT_MS - (nowMs() - t0);
          cd.textContent = left > 0 ? 'the soil waits \u00B7 ' + Math.ceil(left / 1000) : '';
          if (left > 0) raf(tickPlant);
        })();
        later(function () { if (!picked) toGrow(SEEDS[autoPickIdx].key); }, PLANT_MS);
        escHandler = function () { if (!picked) toGrow(SEEDS[autoPickIdx].key); };
      }

      /* ================= BEAT 2 · GROW (6 s hold-release) ================= */
      function toGrow(seedKey) {
        if (torn || settled) return;
        picked = picked || seedKey;
        view.textContent = '';
        var label = '';
        for (var i = 0; i < SEEDS.length; i++) if (SEEDS[i].key === seedKey) label = SEEDS[i].label;
        view.appendChild(el('div', 'pr-beat', 'THE RITUAL \u00B7 GROW'));
        view.appendChild(el('div', 'pr-title', 'NURSE THE ' + label));
        var wrap = el('div', 'pr-ringwrap');
        var ring = el('div', 'pr-ring');
        ring.style.width = ring.style.height = '40%';
        wrap.appendChild(ring);
        var count = el('div', 'pr-count', 'HOLD');
        wrap.appendChild(count);
        wrap.appendChild(el('div', 'pr-hint', 'HOLD while it swells \u00B7 RELEASE at the peak (\u00B1' + bandMsFor(depth) + ' ms)'));
        view.appendChild(wrap);
        view.appendChild(el('div', 'pr-foot', 'never releasing keeps a quarter harvest'));

        var holding = false, released = false, releaseAt = null;
        var start = nowMs();
        var period = periodFor(depth);
        var mot = motionOK();

        function down(e) {
          if (released || torn) return;
          holding = true;
          count.textContent = mot ? '\u2026' : count.textContent;
          if (e && e.cancelable) e.preventDefault();
        }
        function up() {
          if (!holding || released || torn) { holding = false; return; }
          releaseNow();
        }
        function releaseNow() {
          if (released) return;
          released = true;
          releaseAt = nowMs() - start;
          settleGrow(seedKey);
        }
        view.addEventListener('pointerdown', down);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        function kd(e) {
          if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); down(null); }
        }
        function ku(e) { if (e.key === ' ' || e.key === 'Enter') up(); }
        window.addEventListener('keydown', kd, true);
        window.addEventListener('keyup', ku, true);

        /* choreography: pure f(t, params); params derive from ctx.rng-era config */
        (function frame() {
          if (released || torn) return;
          var t = nowMs() - start;
          var left = GROW_MS - t;
          if (left <= 0) { releaseNow(); return; } /* held through / never held => none */
          var ph = swellPhase(t, period);
          if (mot) {
            var d = 40 + ph * 52; /* % of wrapper */
            ring.style.width = ring.style.height = d.toFixed(2) + '%';
            ring.style.boxShadow = '0 0 ' + (10 + ph * 30).toFixed(0) +
              'px rgba(255,176,30,' + (0.15 + ph * 0.35).toFixed(2) + ')';
          } else {
            ring.style.width = ring.style.height = '66%'; /* static ring */
          }
          count.textContent = holding ? '\u2026'
            : (mot ? 'HOLD' : Math.ceil(left / 1000) + 's'); /* motion-off countdown */
          raf(frame);
        })();

        escHandler = releaseNow;
        api.release = function () { releaseNow(); return released; };
      }

      function settleGrow(seedKey) {
        if (growDone || torn) return;
        growDone = true;
        var verdict = growVerdict(releaseAt, depth);
        say(verdict === 'full' ? 'PERFECT BLOOM' : verdict === 'partial' ? 'OFF THE PEAK' : 'THE HAND NEVER OPENED');
        burn(seedKey, verdict);
      }

      /* ================= BEAT 3 · BURN (4 s, no input) ================= */
      function burn(seedKey, verdict) {
        if (torn) return;
        burned = false;
        view.textContent = '';
        view.appendChild(el('div', 'pr-beat', 'THE RITUAL \u00B7 BURN'));
        view.appendChild(el('div', 'pr-title', 'THE SEED CONSUMES ITSELF'));
        view.appendChild(el('div', 'pr-count', '\u00B7 \u00B7 \u00B7'));
        var skipHint = el('div', 'pr-foot', '');
        view.appendChild(skipHint);

        function advance() {
          if (burned || torn) return;
          burned = true;
          window.removeEventListener('keydown', onBurnKey, true);
          view.removeEventListener('pointerdown', advance);
          reborn(seedKey, verdict);
        }
        function armSkip() {
          if (burned || torn) return;
          skipHint.textContent = 'press any key to hasten the fire';
          window.addEventListener('keydown', onBurnKey, true);
          view.addEventListener('pointerdown', advance);
        }
        function onBurnKey() { advance(); }
        later(armSkip, 1000);
        later(advance, BURN_MS);
        escHandler = advance;
      }

      /* ================= BEAT 4 · REBORN (<=4 s reveal) ================= */
      function reborn(seedKey, verdict) {
        if (torn || settled) return;
        var result = computePayout({
          seedKey: seedKey, thornWon: thornWon, verdict: verdict, tier: tier, depth: depth
        });
        flash();
        cue(result.correct ? 'chime' : 'thud');
        view.textContent = '';
        view.appendChild(el('div', 'pr-beat', 'THE RITUAL \u00B7 REBORN'));
        view.appendChild(el('div',
          'pr-pay ' + (verdict === 'full' ? 'pr-gold' : result.correct ? 'pr-good' : 'pr-bad'),
          result.summary));
        var parts = [];
        if (result.points) parts.push((result.points > 0 ? '+' : '') + result.points + ' score');
        if (result.hpDelta) parts.push((result.hpDelta > 0 ? '+' : '') + result.hpDelta + ' vitality');
        if (!parts.length) parts.push('only ash');
        view.appendChild(el('div', 'pr-sub', parts.join('  \u00B7  ') + '  \u00B7  tier ' + tier));
        view.appendChild(el('div', 'pr-foot', 'click or wait \u2014 the embers settle'));
        function endEarly() { finish(result); }
        view.addEventListener('pointerdown', endEarly);
        escHandler = endEarly;
        api.reveal = result;
        later(function () { finish(result); }, REBORN_MS);
      }

      /* overall watchdog: even a stalled beat settles once, under any real cap */
      later(function () {
        finish(computePayout({ seedKey: 'ember', thornWon: thornWon, verdict: 'none', tier: tier, depth: depth }));
      }, CAP_MS + 1500);

      plant();

      /* ---- smoke/self-play control surface (mirrors modes/snake.js) ----
       * core: pure functions (node-safe) · state/release/reveal: live stage */
      var api = root.__PHOENIX__; /* module-level surface below; mount adds live controls */
      api.core = CORE;
      api.state = function () {
        return { depth: depth, tier: tier, thornWon: thornWon, settled: settled };
      };
      api.finish = function (r) {
        finish(r || { kind: 'score', correct: true, points: 0, hpDelta: 0, summary: 'RITUAL ENDED EARLY' });
      };
    });
  }

  /* pure core exported top-level for node smokes (no DOM touched) */
  var CORE = {
    roundHalfDown: roundHalfDown,
    bandMsFor: bandMsFor,
    periodFor: periodFor,
    payScaleFor: payScaleFor,
    tierFor: tierFor,
    tierMult: tierMult,
    swellPhase: swellPhase,
    growVerdict: growVerdict,
    growMult: growMult,
    baseYield: baseYield,
    computePayout: computePayout,
    CAP_MS: CAP_MS
  };
  root.__PHOENIX__ = { core: CORE }; /* node-safe: pure core + registration; mount adds live state/release/finish */

  register();
})();
