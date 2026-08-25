/* ============================================================================
 * modes/gauntlet.js — HORSEMEN GAUNTLET
 * Design doc: research/modes-themed-design.md §9 "HORSEMEN GAUNTLET"
 * Contract:   research/mode-contract.md; cross-round carry via IQ.Hooks.state
 *             prefixed keys (themed design pass §0.1). MP pattern:
 *             seeded-sim (§0.2 D1) — crown blessing, ration layout, slide
 *             speeds are pure functions of mount-time ctx.rng draws and the
 *             stage clock; War counts / Death stillness resolve locally as
 *             INTEGER verdicts (input-relay of counts only — net:'seed').
 * ----------------------------------------------------------------------------
 * REGISTRATION SHAPE (queued on window.__stagePending when IQ.Stage is absent):
 *
 *   IQ.Stage.register({
 *     id: 'gauntlet-horsemen',
 *     name: 'HORSEMEN GAUNTLET',
 *     weight: 5,
 *     worlds: ['gauntlet-temple'],      // design §9 bind (pack-stones world)
 *     net: 'seed',
 *     mount(container, ctx) -> Promise<StageResult>
 *   });
 *
 * NOTE: this stage REPLACES curse-pack.js's 'horsemen' banner theater wherever
 * the event rolls (design Appendix B item 4). The event id and its roll odds
 * in curse-pack stay untouched — the four staggered banners become the four
 * wipe transitions rendered here. Wiring that swap is the trigger owner's edit;
 * this file binds to 'gauntlet-temple' and plays the full ritual whenever mounted.
 *
 * THE FOUR TRIALS (fixed order — the ritual of the riders IS the identity)
 *   1 CONQUEST  pick    3 crowns slide; click the blessed one (seeded).
 *                       pass -> next round scoreMul 1.3 · fail -> nothing.
 *   2 WAR       mash    6 s tap frenzy. hits >= quota(8..12 by depth) ->
 *                       next round timerDelta +5 · < 3 -> timerDelta -5 ·
 *                       between -> neutral (no mark either way).
 *   3 FAMINE    aim     8 ration bars; click the unfairly-large share.
 *                       pass -> banks 1 ration (next wrong answer's hp
 *                       penalty absorbed once) · fail/timeout -> next wrong
 *                       answer -5 extra hp (once).
 *   4 DEATH     freeze  stillness window (3 s -> 5 s by depth): zero input,
 *                       cursor frozen within 8 px. pass -> silence IS the
 *                       reward (no mark) · flinch -> hp -10 on next round entry.
 *
 * CONTROLS: pointer clicks + Space/Enter mashing + holding perfectly still.
 * Esc skips the CURRENT trial as a FAIL-free neutral where the design allows
 * one (War/Famine count as their fail branch; Death treats Esc as a flinch —
 * the gauntlet is never a trap, but the riders do not forgive input).
 * Every trial has its own timeout so the stage always completes <= 40 s
 * (4 x ~8 s incl. wipes), under the 45 s stage cap.
 *
 * RESULT FIELDS — ONE StageResult for the whole stage (design aggregation):
 *   correct: passes >= 3 -> true · == 2 -> null · else false
 *   points:  30 iff all four passed, else 0
 *   hpDelta: always 0 (every rider's wound lands NEXT round, not now)
 *   summary: '<N> RIDER(S) PASSED' style, <= 48 chars
 *
 * AFTERMATH MARKS (cross-round carry): per-trial verdicts are written to
 * IQ.Hooks.state under 'gauntlet:{conquest,war,famine,death}' and consumed on
 * the NEXT round start by the thin 'gauntlet-aftermath' hook registered at the
 * bottom of this file (see WIRING POINT there): it reads the keys, emits the
 * corresponding modifier REQUESTS (scoreMul/timerDelta/hpDelta — host-applied,
 * host-clamped), then deletes them. The stage runner itself knows nothing
 * about per-round mechanics, consistent with the hooks architecture.
 *
 * FAIRNESS RAILS: motion-gated slides (IQB_MOTION off -> static layouts);
 * no fullscreen flashes at all; text >= 11 px; Esc path documented above;
 * determinism via ctx.rng only; war hits and stillness relayed as integers.
 * ============================================================================*/
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};

  /* ---------------- tunables (design §9) ---------------- */
  var WIPE_MS = 700;                 /* rider banner between trials */
  var TRIAL_BUDGET_MS = 7300;        /* 8000 incl. wipe per trial */
  var WAR_MASH_MS = 6000;
  var WAR_MIN_FAIL = 3;              /* below this: timerDelta -5 */
  var DEATH_MOVE_PX = 8;             /* cursor drift tolerance */
  var CAP_MS = 40000;                /* whole-stage hard cap */

  var K = {
    conquest: 'gauntlet:conquest',   /* 'crown' = blessed crown claimed       */
    war: 'gauntlet:war',             /* '+5' | '-5'                            */
    famine: 'gauntlet:famine',       /* 'shield' | 'curse'                     */
    death: 'gauntlet:death'          /* 'flinch' (pass writes nothing: silence)*/
  };

  /* ------------- pure core (exported for node smoke harnesses) ------------ */

  function warQuota(depth) { return 8 + Math.min(4, Math.max(0, (depth | 0) - 1)); }
  /* Death stillness 3 s -> 5 s */
  function stillMsFor(depth) { return Math.min(5000, 3000 + Math.max(0, (depth | 0) - 1) * 250); }
  /* Conquest crown slide speeds up with depth */
  function slideMsFor(depth) { return Math.max(1200, 2600 - Math.max(0, (depth | 0) - 1) * 200); }
  /* Famine share delta shrinks: obvious -> subtle (grams) */
  function famineDeltaFor(depth) { return Math.max(1.5, 6 - Math.max(0, (depth | 0) - 1) * 0.75); }

  /* Seeded ration layout: 8 shares, exactly ONE unfairly large.
   * Deterministic given rng state — same seed => byte-identical layout. */
  function rationLayout(rng, depth) {
    var smalls = [];
    for (var i = 0; i < 8; i++) smalls.push(10 + Math.floor(rng() * 3)); /* 10..12 g */
    var maxSmall = Math.max.apply(null, smalls);
    var sum = smalls.reduce(function (a, b) { return a + b; }, 0);
    var avg = sum / 8;
    var big = Math.round(Math.max(maxSmall + 1.5, avg + famineDeltaFor(depth)) * 10) / 10;
    var bigIdx = Math.floor(rng() * 8);
    var sizes = smalls.slice();
    sizes[bigIdx] = big;
    /* seeded Fisher-Yates over DISPLAY order only; bigIdx tracks the value */
    var disp = sizes.slice(), idxMap = [0, 1, 2, 3, 4, 5, 6, 7];
    for (var j = 7; j > 0; j--) {
      var k2 = Math.floor(rng() * (j + 1));
      var tmp = idxMap[j]; idxMap[j] = idxMap[k2]; idxMap[k2] = tmp;
    }
    var shownSizes = [], shownBig = -1;
    for (var d = 0; d < 8; d++) {
      shownSizes.push(sizes[idxMap[d]]);
      if (idxMap[d] === bigIdx) shownBig = d;
    }
    void disp;
    return { sizes: shownSizes, bigIdx: shownBig };
  }

  /* ONE StageResult for the whole stage (canonical aggregation) */
  function aggregate(passes) {
    var p = Math.max(0, Math.min(4, passes | 0));
    return {
      kind: 'score',
      correct: p >= 3 ? true : p >= 2 ? null : false,
      points: p === 4 ? 30 : 0,
      hpDelta: 0, /* every rider's mark lands next round through the aftermath hook */
      summary: p === 4 ? 'ALL FOUR RIDERS PASSED'
        : p === 0 ? 'NO RIDERS PASSED'
          : p === 1 ? 'ONE RIDER PASSED'
            : p + ' RIDERS PASSED'
    };
  }

  /* ---------------- guarded state accessors (carry keys) ---------------- */
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
    } catch (e) { /* carry is best-effort */ }
  }
  function stDel(k) {
    try {
      var s = root.IQ && root.IQ.Hooks && root.IQ.Hooks.state;
      if (s && typeof s.del === 'function') s.del(k);
    } catch (e) { }
  }
  function motionOK() {
    try {
      var v = root.localStorage && root.localStorage.getItem('IQB_MOTION');
      return v == null ? true : JSON.parse(v) !== false;
    } catch (e) { return true; }
  }

  /* =====================================================================
   * AFTERMATH HOOK — the wiring point for every gauntlet:* carry key.
   * ---------------------------------------------------------------------
   * Design §9: "Per-trial marks are written to IQ.Hooks.state
   * (gauntlet:{conquest,war,famine,death}) and consumed by a thin
   * 'gauntlet-aftermath' hook on next onRoundStart (reads the four keys,
   * emits the corresponding modifier requests, deletes them)".
   *
   * This IS that hook. It registers alongside the stage definition below
   * (guarded: if IQ.Hooks is absent the marks simply wait — the stage wrote
   * them best-effort and nothing throws). Modifier vocabulary is the landed
   * hooks.js set: scoreMul / timerDelta / hpDelta (+bannerText/sfx/flag).
   * All values are REQUESTS; scoring stays host-authoritative.
   *
   *   gauntlet:conquest = 'crown'  -> onPreAnswer  scoreMul 1.3 (next award)
   *   gauntlet:war      = '+5'/-5' -> onRoundStart timerDelta +5 / -5
   *   gauntlet:famine   = 'shield' -> onAnswer(!correct) hpDelta +15 ONCE
   *                                (absorbs the baseline -15 wrong-answer hit)
   *                     = 'curse'  -> onAnswer(!correct) hpDelta -20 ONCE
   *                                (baseline -15 plus the rider's extra -5)
   *   gauntlet:death    = 'flinch' -> onRoundStart hpDelta -10 (round entry)
   *
   * If another surface ever needs to consume these keys (e.g. an engine-side
   * reveal integration), DELETE this hook registration and read the same four
   * K.* constants above — they are the single source of truth for key names.
   * ===================================================================== */
  function aftermathRoundStart() {
    var mods = null;
    var war = stGet(K.war);
    if (war === '+5') mods = { timerDelta: 5, bannerText: 'WAR RIDES WITH YOU \u00B7 +5s', flag: 'gauntlet-war-pass', sfx: 'chime' };
    else if (war === '-5') mods = { timerDelta: -5, bannerText: 'WAR TOOK ITS TOLL \u00B7 -5s', flag: 'gauntlet-war-fail', sfx: 'zap' };
    if (war) stDel(K.war);
    var death = stGet(K.death);
    if (death === 'flinch') {
      mods = mods || {};
      mods.hpDelta = -10;
      mods.bannerText = 'YOU FLINCHED BEFORE DEATH \u00B7 -10 HP';
      mods.flag = 'gauntlet-death-flinch';
    }
    if (death) stDel(K.death);
    return mods;
  }
  function aftermathPreAnswer() {
    var c = stGet(K.conquest);
    if (!c) return undefined;
    stDel(K.conquest);
    return { scoreMul: 1.3, bannerText: 'THE BLESSED CROWN SHINES \u00B7 \u00D71.3', flag: 'gauntlet-conquest-pass', sfx: 'chime' };
  }
  function aftermathAnswer(ctx) {
    var f = stGet(K.famine);
    if (!f || !ctx || !ctx.res || ctx.res.correct) return undefined;
    stDel(K.famine); /* ONCE, whatever the flavor */
    if (f === 'shield') {
      return { hpDelta: 15, bannerText: 'THE RATION ABSORBS THE WOUND', flag: 'gauntlet-famine-shield' };
    }
    if (f === 'curse') {
      return { hpDelta: -5, bannerText: 'FAMINE CLAIMS ITS PORTION \u00B7 -5 EXTRA', flag: 'gauntlet-famine-curse' };
    }
    return undefined;
  }

  /* ---------------- CSS (scoped hg-* classes, one injected sheet) --------- */
  var CSS =
    '.hg-root{position:absolute;inset:0;display:flex;flex-direction:column;' +
    'align-items:center;justify-content:center;gap:16px;font-family:\'Oxanium\',sans-serif;' +
    'background:radial-gradient(ellipse at 50% 15%,#1a1016,#060409 70%);color:#e9e2d6;' +
    'user-select:none;-webkit-user-select:none}' +
    '.hg-wipe{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' +
    'justify-content:center;gap:10px;background:#060409;z-index:5}' +
    '.hg-rider{font-size:clamp(26px,6vw,52px);font-weight:900;letter-spacing:.3em;color:#c8b48a}' +
    '.hg-epithet{font-size:13px;letter-spacing:.24em;color:#7d7360}' +
    '.hg-beat{font-size:12px;letter-spacing:.32em;color:#a08f6d;text-transform:uppercase}' +
    '.hg-title{font-size:clamp(17px,3vw,28px);font-weight:900;letter-spacing:.2em;color:#e9dfc8}' +
    '.hg-sub{font-size:12px;letter-spacing:.14em;color:#9b9080;text-align:center;max-width:min(640px,88vw)}' +
    '.hg-count{font-size:clamp(24px,5vh,40px);font-weight:900;color:#ffd88a;min-height:44px}' +
    '.hg-row{display:flex;gap:16px;flex-wrap:wrap;justify-content:center}' +
    '.hg-target{width:170px;min-height:150px;border:1px solid #4a3d2c;border-radius:14px;' +
    'background:#100c08;padding:12px;cursor:pointer;text-align:center;color:#efe6d2;' +
    'display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;font-family:inherit}' +
    '.hg-target:hover,.hg-target:focus-visible{border-color:#ffb01e;outline:none}' +
    '.hg-crown{font-size:34px;line-height:1}' +
    '.hg-label{font-size:11px;letter-spacing:.22em;color:#b7a888}' +
    '.hg-mash{width:min(420px,80vw);height:min(34vh,220px);border:2px solid #5a2c2c;border-radius:18px;' +
    'background:radial-gradient(circle,#241010,#0d0708);cursor:pointer;display:flex;flex-direction:' +
    'column;gap:8px;align-items:center;justify-content:center;font-family:inherit;color:#ffdede}' +
    '.hg-mash:hover{border-color:#ff2038}' +
    '.hg-bars{display:flex;gap:8px;align-items:flex-end;height:min(30vh,200px)}' +
    '.hg-bar{width:44px;border:1px solid #4a3d2c;border-bottom:none;border-radius:6px 6px 0 0;' +
    'background:linear-gradient(#3d3220,#191207);position:relative;cursor:pointer}' +
    '.hg-bar:hover{border-color:#ffb01e}' +
    '.hg-gram{position:absolute;top:-22px;left:0;right:0;text-align:center;font-size:11px;color:#cabfa4}' +
    '.hg-still{width:min(50vh,340px);height:min(50vh,340px);border-radius:50%;border:2px solid #46587e;' +
    'display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;font-family:inherit}' +
    '.hg-foot{font-size:11px;letter-spacing:.18em;color:#6b6252;min-height:15px}' +
    '@media (prefers-reduced-motion){.hg-root{animation:none}}';

  /* ---------------- registration ---------------- */
  var DEF = {
    id: 'gauntlet-horsemen',
    name: 'HORSEMEN GAUNTLET',
    weight: 5,
    worlds: ['gauntlet-temple'],
    net: 'seed',
    mount: mount,
    describe: function () {
      return {
        id: DEF.id, name: DEF.name,
        trials: ['conquest-pick', 'war-mash', 'famine-aim', 'death-freeze'],
        capMs: CAP_MS
      };
    },
    cleanup: function () {
      if (live) { try { live.teardown(); } catch (e) { /* already gone */ } live = null; }
    }
  };

  var live = null;

  function register() {
    if (root.IQ && root.IQ.Stage && typeof root.IQ.Stage.register === 'function') {
      root.IQ.Stage.register(DEF);
    } else {
      (root.__stagePending = root.__stagePending || []).push(DEF);
    }
  }

  /* register the thin aftermath hook (see the WIRING POINT block above) */
  function registerAftermath() {
    try {
      if (root.IQ && root.IQ.Hooks && typeof root.IQ.Hooks.add === 'function') {
        root.IQ.Hooks.add({
          id: 'gauntlet-aftermath',
          always: true, /* marks may land while the NEXT round sits in any world */
          handlers: {
            onRoundStart: aftermathRoundStart,
            onPreAnswer: aftermathPreAnswer,
            onAnswer: aftermathAnswer
          }
        });
      }
    } catch (e) { /* hooks absent: marks wait harmlessly in the pending queue era */ }
  }

  /* ---------------- mount ---------------- */
  function mount(container, ctx) {
    return new Promise(function (resolve) {
      var settled = false, torn = false, trialDone = false;
      var timeouts = [];
      var rafs = [];
      var clock = 0;
      var results = { conquest: false, war: null /* true/false/null-neutral */, famine: false, death: false };

      var depth = Math.max(1, (ctx && ctx.depth) | 0);
      var rng = (ctx && ctx.rng) || Math.random; /* defensive; engine supplies seeded rng */

      /* ---- seeded params: drawn ONCE at stage start, in documented order ---- */
      var blessedIdx = Math.floor(rng() * 3) % 3;         /* draw 1: conquest crown */
      var rations = rationLayout(rng, depth);             /* draws 2+: famine board */
      var mot = motionOK();

      /* ---- helpers ---- */
      function nowMs() { return clock; } /* stage clock only — no wall-clock gameplay */
      function raf(fn) { var id = requestAnimationFrame(fn); rafs.push(id); return id; }
      function later(fn, ms) { var id = setTimeout(fn, ms); timeouts.push(id); return id; }
      function el(tag, cls, txt) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (txt != null) n.textContent = txt;
        return n;
      }
      function say(t) { if (ctx && typeof ctx.banner === 'function') { try { ctx.banner(t); } catch (e) {} } }

      /* ---- surface ---- */
      if (document.head && !document.getElementById('iqb-gauntlet-style')) {
        var stl = document.createElement('style');
        stl.id = 'iqb-gauntlet-style';
        stl.textContent = CSS;
        document.head.appendChild(stl);
      }
      container.textContent = '';
      var view = document.createElement('div');
      view.className = 'stage-view hg-root';
      view.setAttribute('data-stage', 'gauntlet-horsemen');
      container.appendChild(view);

      /* ---- lifecycle ---- */
      function finish() {
        if (settled || torn) return;
        settled = true;
        teardown();
        var passes =
          (results.conquest ? 1 : 0) +
          (results.war === true ? 1 : 0) +   /* neutral war is neither pass nor fail */
          (results.famine ? 1 : 0) +
          (results.death ? 1 : 0);
        resolve(aggregate(passes));
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

      /* wipe transition: the old horsemen banners, reborn as riders */
      function wipe(rider, epithet, next) {
        view.textContent = '';
        var w = el('div', 'hg-wipe');
        w.appendChild(el('div', 'hg-rider', rider));
        w.appendChild(el('div', 'hg-epithet', epithet));
        view.appendChild(w);
        later(function () { if (!torn && !settled) next(); }, WIPE_MS);
        say(rider + ' RIDES');
      }

      /* ================= TRIAL 1 · CONQUEST (pick) ================= */
      function trialConquest() {
        trialDone = false;
        view.textContent = '';
        view.appendChild(el('div', 'hg-beat', 'FIRST RIDER \u00B7 CONQUEST'));
        view.appendChild(el('div', 'hg-title', 'CLAIM THE BLESSED CROWN'));
        view.appendChild(el('div', 'hg-sub', 'one crown carries his blessing \u2014 two are lead'));
        var row = el('div', 'hg-row');
        view.appendChild(row);
        var foot = el('div', 'hg-foot', '');
        view.appendChild(foot);

        /* slide phases: distinct seeded speeds; pure f(t, params) */
        var speed = slideMsFor(depth);
        var phases = [0, 1 / 3, 2 / 3];
        var crowns = [];
        for (var i = 0; i < 3; i++) {
          (function (idx) {
            var b = el('button', 'hg-target');
            b.type = 'button';
            b.appendChild(el('div', 'hg-crown', '\u265B')); /* chess queen glyph reads as a crown */
            b.appendChild(el('div', 'hg-label', 'CROWN ' + (idx + 1)));
            b.addEventListener('click', function () { settle(idx === blessedIdx, idx === blessedIdx); });
            crowns.push(b);
            row.appendChild(b);
          })(i);
        }
        var t0 = nowMs();
        (function frame() {
          if (trialDone || torn) return;
          var t = nowMs() - t0;
          if (mot) {
            for (var i = 0; i < 3; i++) {
              var ph = (t / speed + phases[i]) % 1;
              var sway = Math.sin(ph * 2 * Math.PI) * 46;
              crowns[i].style.transform = 'translateY(' + sway.toFixed(1) + 'px)';
            }
          }
          var left = TRIAL_BUDGET_MS - t;
          foot.textContent = left > 0 ? Math.ceil(left / 1000) + 's' : '';
          if (left <= 0) { settle(false, false); return; } /* hesitated: the crown was lead */
          raf(frame);
        })();
        later(function () { if (!trialDone) settle(false, false); }, TRIAL_BUDGET_MS + 60);

        function settle(passed, blessed) {
          if (trialDone || torn) return;
          trialDone = true;
          results.conquest = !!passed;
          if (passed) stSet(K.conquest, 'crown');
          say(blessed ? 'THE BLESSING IS YOURS' : 'LEAD. ONLY LEAD.');
          nextTrial(trialWar);
        }
        escHandler = function () { settle(false, false); };
      }

      /* ================= TRIAL 2 · WAR (mash) ================= */
      function trialWar() {
        trialDone = false;
        var quota = warQuota(depth);
        view.textContent = '';
        view.appendChild(el('div', 'hg-beat', 'SECOND RIDER \u00B7 WAR'));
        view.appendChild(el('div', 'hg-title', 'MASH FOR THE CHARGE'));
        view.appendChild(el('div', 'hg-sub', quota + ' hits before the horn \u00B7 fewer than ' + WAR_MIN_FAIL + ' and the rout begins'));
        var pad = el('button', 'hg-mash');
        pad.type = 'button';
        pad.appendChild(el('div', 'hg-crown', '\u2694'));
        pad.appendChild(el('div', 'hg-label', 'MASH HERE \u00B7 OR SPACE/ENTER'));
        view.appendChild(pad);
        var count = el('div', 'hg-count', '0 / ' + quota);
        view.appendChild(count);
        var foot = el('div', 'hg-foot', '');
        view.appendChild(foot);

        var hits = 0;
        function hit() {
          if (trialDone || torn) return;
          hits++;
          count.textContent = hits + ' / ' + quota;
          if (hits === quota) count.style.color = '#ff6a5e';
        }
        pad.addEventListener('pointerdown', hit);
        function kd(e) {
          if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); hit(); }
        }
        window.addEventListener('keydown', kd, true);

        var t0 = nowMs();
        (function frame() {
          if (trialDone || torn) return;
          var left = WAR_MASH_MS - (nowMs() - t0);
          foot.textContent = left > 0 ? Math.ceil(left / 1000) + 's' : '';
          if (left <= 0) { settle(); return; }
          raf(frame);
        })();
        later(settle, WAR_MASH_MS + 60);

        function settle() {
          if (trialDone || torn) return;
          trialDone = true;
          window.removeEventListener('keydown', kd, true);
          /* integer verdict only — replayable from (seed, bucket counts) */
          if (hits >= quota) { results.war = true; stSet(K.war, '+5'); say('THE CHARGE CRESTS'); }
          else if (hits < WAR_MIN_FAIL) { results.war = false; stSet(K.war, '-5'); say('THE LINE BREAKS'); }
          else { results.war = null; say('A GRIND, NEITHER GLORY NOR ROUT'); }
          nextTrial(trialFamine);
        }
        escHandler = settle; /* Esc = the horn sounds early; your count stands */
      }

      /* ================= TRIAL 3 · FAMINE (aim-click) ================= */
      function trialFamine() {
        trialDone = false;
        view.textContent = '';
        view.appendChild(el('div', 'hg-beat', 'THIRD RIDER \u00B7 FAMINE'));
        view.appendChild(el('div', 'hg-title', 'TAKE THE UNFAIR SHARE'));
        view.appendChild(el('div', 'hg-sub', 'eight rations \u00B7 one was portioned greedily \u2014 click it'));
        var bars = el('div', 'hg-bars');
        view.appendChild(bars);
        var foot = el('div', 'hg-foot', '');
        view.appendChild(foot);

        var maxG = Math.max.apply(null, rations.sizes);
        rations.sizes.forEach(function (g, idx) {
          var b = el('button', 'hg-bar');
          b.type = 'button';
          var hPct = Math.max(12, Math.round((g / maxG) * 100));
          b.style.height = hPct + '%';
          b.setAttribute('aria-label', 'ration of ' + g + ' grams');
          b.appendChild(el('div', 'hg-gram', g + 'g'));
          b.addEventListener('click', function () { settle(idx === rations.bigIdx); });
          bars.appendChild(b);
        });

        later(function () { if (!trialDone) settle(false); }, TRIAL_BUDGET_MS);
        function settle(passed) {
          if (trialDone || torn) return;
          trialDone = true;
          results.famine = !!passed;
          if (passed) stSet(K.famine, 'shield');
          else stSet(K.famine, 'curse');
          say(passed ? 'THE HIDDEN LOAF IS YOURS' : 'FAMINE MARKS YOUR HAND');
          nextTrial(trialDeath);
        }
        escHandler = function () { settle(false); }; /* hesitation feeds Famine too */
      }

      /* ================= TRIAL 4 · DEATH (freeze) ================= */
      function trialDeath() {
        trialDone = false;
        var stillMs = stillMsFor(depth);
        view.textContent = '';
        view.appendChild(el('div', 'hg-beat', 'FOURTH RIDER \u00B7 DEATH'));
        view.appendChild(el('div', 'hg-title', 'BE STILL'));
        var ring = el('div', 'hg-still');
        ring.appendChild(el('div', 'hg-count', ''));
        ring.appendChild(el('div', 'hg-sub', 'no input \u00B7 cursor frozen within ' + DEATH_MOVE_PX + ' px \u00B7 ' + Math.round(stillMs / 1000) + 's'));
        view.appendChild(ring);
        var cdEl = ring.querySelector('.hg-count');
        var foot = el('div', 'hg-foot', '');
        view.appendChild(foot);

        var ax = null, ay = null, flinched = false;
        function mv(e) {
          if (flinched || trialDone || torn) return;
          if (ax === null) { ax = e.clientX; ay = e.clientY; return; }
          var dx = e.clientX - ax, dy = e.clientY - ay;
          if (Math.sqrt(dx * dx + dy * dy) > DEATH_MOVE_PX) flinch();
        }
        function anyInput() { flinch(); }
        function flinch() {
          if (flinched || trialDone || torn) return;
          flinched = true;
          settle(false);
        }
        document.addEventListener('pointermove', mv, true);
        document.addEventListener('pointerdown', anyInput, true);
        function kd(e) {
          if (e.key === 'Escape') return; /* Esc keeps its own meaning below */
          anyInput();
        }
        window.addEventListener('keydown', kd, true);

        var t0 = nowMs();
        (function frame() {
          if (trialDone || torn) return;
          var left = stillMs - (nowMs() - t0);
          if (left <= 0) { settle(true); return; }
          cdEl.textContent = Math.ceil(left / 1000);
          ring.style.borderColor = '#46587e';
          raf(frame);
        })();
        later(function () { if (!trialDone) settle(true); }, stillMs + 60);

        function settle(passed) {
          if (trialDone || torn) return;
          trialDone = true;
          document.removeEventListener('pointermove', mv, true);
          document.removeEventListener('pointerdown', anyInput, true);
          window.removeEventListener('keydown', kd, true);
          results.death = !!passed;
          if (!passed) stSet(K.death, 'flinch'); /* pass writes NOTHING: silence is the reward */
          say(passed ? 'DEATH NODS AND PASSES ON' : 'YOU FLINCHED');
          nextTrial(finish);
        }
        escHandler = flinch; /* input is input; Death does not negotiate */
      }

      function nextTrial(next) {
        later(function () { if (!torn && !settled) next(); }, 350); /* breath between riders */
      }

      /* watchdog: uncompleted trials count as failed, result settles once */
      later(finish, CAP_MS + 500);

      var api = root.__GAUNTLET__; /* module-level surface below; mount adds live state/finish */
      api.state = function () {
        return { depth: depth, blessedIdx: blessedIdx, rations: rations, settled: settled,
          results: { conquest: results.conquest, war: results.war, famine: results.famine, death: results.death } };
      };
      api.finish = finish;

      wipe('CONQUEST', 'the road opens \u00B7 the first rider demands a crown', trialConquest);
    });
  }

  /* pure core exported top-level for node smokes (no DOM touched) */
  var CORE = {
    K: K,
    WIPE_MS: WIPE_MS,
    TRIAL_BUDGET_MS: TRIAL_BUDGET_MS,
    WAR_MASH_MS: WAR_MASH_MS,
    WAR_MIN_FAIL: WAR_MIN_FAIL,
    DEATH_MOVE_PX: DEATH_MOVE_PX,
    CAP_MS: CAP_MS,
    warQuota: warQuota,
    stillMsFor: stillMsFor,
    slideMsFor: slideMsFor,
    famineDeltaFor: famineDeltaFor,
    rationLayout: rationLayout,
    aggregate: aggregate,
    aftermathRoundStart: aftermathRoundStart,
    aftermathPreAnswer: aftermathPreAnswer,
    aftermathAnswer: aftermathAnswer
  };
  root.__GAUNTLET__ = { core: CORE }; /* node-safe core; mount adds live state/finish */

  register();
  registerAftermath();
})();
