/* ============================================================================
 * pack-popcult-a.js — IQ.Worlds/Hooks pop-culture COMPANION PACK A
 * (contracts: research/w1-contracts.md C3/C9; brief: local://iqbattle-rebuild-brief.md)
 *
 * PIVOT NOTE (Main course-correction, grounding audit): the four originally
 * specced parody worlds ALREADY EXIST under other ids in worlds-pop.js —
 * 'dolphins' (good), 'sharks' (bad), 'symbiote-party' (chaotic) and
 * 'golden-mastermind' (neutral, Dr-Evil-parody throne + hostile lasers).
 * Registering renamed near-duplicates was therefore FORBIDDEN. This file now
 * ships ONLY theme-level gap-fills: small companion Hooks.add packs bound to
 * those EXISTING world ids, each covering behaviour none of the current hooks
 * provide (verified against pack-hunters.js: sandstorm / venom-party /
 * mastermind-mood / doom-pickups, and a repo-wide grep for hooks bound to
 * 'dolphins'/'sharks' — none).
 *
 * HOOKS REGISTERED (IQ.Hooks.add):
 *   popcult-a-pod-song       world 'dolphins'        onRoundStart 35% -> +4 hp heal
 *   popcult-a-trench-bite    world 'sharks'          onAnswer wrong   -> -3 hp bite
 *   popcult-a-symbiosis-grip world 'symbiote-party'  onRoundStart 25% -> -4s timer
 *   popcult-a-throne-whisper world 'golden-mastermind' onAnswer correct 20% -> x1.15
 *                                                    onAnswer wrong   20% -> -2 hp
 *
 * FAIRNESS RAILS (hooks.js §FAIRNESS RAILS + brief):
 *   - PARITY: every handler is inert on rounds 1-2 (ctx.round < 3 returns null)
 *     so the baseline clone experience is untouched (rail C8).
 *   - DETERMINISM: all chance comes from ctx.rng() ONLY — zero Math.random,
 *     zero Date.now anywhere in this file.
 *   - Engine clamps respected: hpDelta within [-60, 60], scoreMul >= 1,
 *     timerDelta small negative pressure only. Never disables slots, never
 *     touches question/answer glyphs, no overlays, no flashes.
 *   - Every handler body is guarded; a broken handler degrades to null.
 *   - Parody naming only; British-humour banners <= 90 chars.
 *
 * Script tag placement: AFTER worlds-pop.js (and after hooks.js), e.g.:
 *   <script src="hooks.js"></script>
 *   <script src="worlds-pop.js"></script>
 *   <script src="pack-hunters.js"></script>
 *   <script src="pack-popcult-a.js"></script>   <-- here
 * Registration is late-safe: polls briefly for window.IQ.Hooks like
 * worlds-pop.js does for Worlds.
 * ============================================================================*/
(function () {
'use strict';
var root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};

/* Round-gate helper: parity rail — silent during the baseline clone rounds. */
function gated(ctx) { return !(ctx && typeof ctx.round === 'number') || ctx.round < 3; }

/* ==========================================================================
 * COMPANION HOOKS
 * ========================================================================*/
var HOOKS = [

/* --- popcult-a-pod-song (world: dolphins) ---------------------------------
 * The pod sings for you: 35% of rounds open with a gentle +4 hp swell.
 * MODIFIERS USED: hpDelta:+4, bannerText. Nothing else — pure good-align
 * relief, exactly one seeded draw per round start. */
{
  id: 'popcult-a-pod-song',
  worlds: ['dolphins'],
  weight: 1,
  handlers: {
    onRoundStart: function (ctx) {
      try {
        if (gated(ctx)) return null;
        if (ctx.rng() < 0.35) {
          return { hpDelta: 4, bannerText: 'THE POD SINGS \u00B7 +4 HP' };
        }
        return null;
      } catch (e) { return null; }
    }
  }
},

/* --- popcult-a-trench-bite (world: sharks) --------------------------------
 * Something circled while you hesitated: a wrong answer costs an extra -3 hp
 * on top of the default miss. Deliberately no onPreAnswer telegraph — the
 * dread IS the mechanic. One banner, no overlays, no slot disabling. */
{
  id: 'popcult-a-trench-bite',
  worlds: ['sharks'],
  weight: 1,
  handlers: {
    onAnswer: function (ctx) {
      try {
        if (gated(ctx)) return null;
        if (ctx.res && ctx.res.correct === false) {
          return { hpDelta: -3, bannerText: 'CIRCLED \u00B7 THE TRENCH BITES \u00B7 \u22123 HP' };
        }
        return null;
      } catch (e) { return null; }
    }
  }
},

/* --- popcult-a-symbiosis-grip (world: symbiote-party) ----------------------
 * Distinct from pack-hunters 'venom-party' (which handles surge scoring):
 * 25% of rounds the symbiote TIGHTENS first — -4s off the clock at open.
 * MODIFIERS USED: timerDelta:-4, bannerText. */
{
  id: 'popcult-a-symbiosis-grip',
  worlds: ['symbiote-party'],
  weight: 1,
  handlers: {
    onRoundStart: function (ctx) {
      try {
        if (gated(ctx)) return null;
        if (ctx.rng() < 0.25) {
          return { timerDelta: -4, bannerText: 'SYMBIOSIS TIGHTENS \u00B7 \u22124s' };
        }
        return null;
      } catch (e) { return null; }
    }
  }
},

/* --- popcult-a-throne-whisper (world: golden-mastermind) -------------------
 * Distinct from pack-hunters 'mastermind-mood' (cross-round timer tax) and
 * 'doom-pickups' (health/ammo caches): the throne whispers vanity teases —
 * correct answers may pay x1.15 ("ALMOST TOO EASY"); wrong ones may sting a
 * mere -2 hp while something chuckles offstage. 20% each, independent draws.
 * MODIFIERS USED: scoreMul:1.15 | hpDelta:-2, bannerText. */
{
  id: 'popcult-a-throne-whisper',
  worlds: ['golden-mastermind'],
  weight: 1,
  handlers: {
    onAnswer: function (ctx) {
      try {
        if (gated(ctx)) return null;
        if (!ctx.res) return null;
        if (ctx.res.correct) {
          if (ctx.rng() < 0.20) {
            return { scoreMul: 1.15, bannerText: 'ALMOST TOO EASY \u00B7 \u00D71.15' };
          }
        } else if (ctx.rng() < 0.20) {
          return { hpDelta: -2, bannerText: 'SOMEONE LAUGHING \u00B7 \u22122 HP' };
        }
        return null;
      } catch (e) { return null; }
    }
  }
}
];

/* ---------- late-safe registration (mirrors worlds-pop.js) ---------------- */
(function reg(attempt) {
  if (typeof window === 'undefined') return;            /* node: never poll */
  var H = root.IQ && root.IQ.Hooks;
  if (H && typeof H.add === 'function') {
    HOOKS.forEach(function (k) { H.add(k); });
    return;
  }
  if (attempt < 40 && typeof setTimeout === 'function') {
    setTimeout(function () { reg(attempt + 1); }, 50);
  }
})(0);

/* ==========================================================================
 * selfTest — node-only behavioural checks (browser never runs this).
 * Validates: unique prefixed ids, bound worlds, handler types, engine-clamp
 * compliance across 40 deterministic seeds per event, banner length, and the
 * parity rail (rounds 1-2 MUST be fully inert). Note: after the pivot this
 * file registers no Worlds, so the original stub-2d-context draw() clause has
 * no targets here; the hook-contract checks below cover everything shipped.
 * ========================================================================*/
function lcg(seed) {
  var s = (seed >>> 0) || 1;
  return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function selfTest() {
  var fails = [];
  var seen = {};
  var EVENTS = ['onRoundStart', 'onTick', 'onPreAnswer', 'onAnswer', 'onReveal', 'onInterlude'];
  HOOKS.forEach(function (k) {
    if (!k.id || seen[k.id]) fails.push('hook id missing or duplicated: ' + k.id);
    seen[k.id] = true;
    if (!Array.isArray(k.worlds) || !k.worlds.length) fails.push((k.id || '?') + ': worlds empty');
    EVENTS.forEach(function (ev) {
      var fn = k.handlers && k.handlers[ev];
      if (fn && typeof fn !== 'function') fails.push(k.id + '.' + ev + ': not a function');
      if (typeof fn !== 'function') return;
      /* clamp + shape sweep over deterministic seeds */
      for (var seed = 1; seed <= 40; seed++) {
        var out;
        try {
          out = fn({ rng: lcg(seed * 7919), timerLen: 30, round: ((seed % 3) + 3),
                     align: 'neutral', res: { correct: seed % 2 === 0 } });
        } catch (e) { fails.push(k.id + '.' + ev + ' seed ' + seed + ' threw: ' + e.message); continue; }
        if (out === null || out === undefined) continue;
        if (typeof out !== 'object') { fails.push(k.id + '.' + ev + ': non-object modifier'); continue; }
        if (out.hpDelta !== undefined &&
            (typeof out.hpDelta !== 'number' || out.hpDelta < -60 || out.hpDelta > 60)) {
          fails.push(k.id + '.' + ev + ': hpDelta outside [-60,60]: ' + out.hpDelta);
        }
        if (out.timerDelta !== undefined &&
            (typeof out.timerDelta !== 'number' || Math.abs(out.timerDelta) > 60)) {
          fails.push(k.id + '.' + ev + ': timerDelta out of range');
        }
        if (out.scoreMul !== undefined &&
            (typeof out.scoreMul !== 'number' || out.scoreMul < 1 || out.scoreMul > 10)) {
          fails.push(k.id + '.' + ev + ': scoreMul suspicious: ' + out.scoreMul);
        }
        if (out.bannerText !== undefined) {
          if (typeof out.bannerText !== 'string' || out.bannerText.length > 90) {
            fails.push(k.id + '.' + ev + ': banner too long / not string');
          }
        }
      }
      /* parity rail: rounds 1 and 2 must be completely inert */
      [1, 2].forEach(function (rn) {
        var o;
        try {
          o = fn({ rng: lcg(11), timerLen: 30, round: rn, align: 'neutral', res: { correct: false } });
        } catch (e) { fails.push(k.id + '.' + ev + ' round ' + rn + ' threw'); return; }
        if (o && Object.keys(o).length) {
          fails.push(k.id + '.' + ev + ' round ' + rn + ' not inert: ' + JSON.stringify(o));
        }
      });
    });
  });
  return {
    ok: fails.length === 0,
    msg: fails.length ? 'FAIL \u2014 ' + fails.join('; ')
                      : 'ok \u2014 ' + HOOKS.length + ' companion hooks validated ' +
                        '(ids, clamps, banners, parity rounds 1-2)'
  };
}

/* ---------- node entry ---------------------------------------------------- */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HOOKS: HOOKS, selfTest: selfTest };
  if (typeof require === 'function' && require.main === module) {
    var r = selfTest();
    console.log('[pack-popcult-a] selfTest:', r.msg);
    if (!r.ok) process.exitCode = 1;
  }
}
})();
