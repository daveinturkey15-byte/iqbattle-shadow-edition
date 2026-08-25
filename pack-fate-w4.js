/* ============================================================================
 * pack-fate-w4.js — FATE EVENTS: six new curse/blessing-flavored round events
 * extending the fate breadth (spec: curses, pestilence, horsemen, cute things).
 *
 * REGISTRATION: IQ.Hooks.add({ id:'fate-w4', always:true, weight:1,
 *   handlers:{ onRoundStart, onAnswer } });
 * Parks on IQ.__hooksPending if hooks.js hasn't loaded (canonical drain).
 *
 * ROLL WINDOW: 12% per hostile/neutral/good round >= depth 3, once per round
 * (state guard 'fate:rolled:<round>'). Branch by ctx.align:
 *   good    -> MIDAS TOUCH (next correct pays x1.5) or COMET (+6s)
 *   bad     -> ECLIPSE (cosmetic darkness veil, 5s auto-fade)
 *   chaotic -> POLTERGEIST (invert controls 700ms) or ECLIPSE
 *   neutral -> TOLL BRIDGE (x0.9) or CARNIVAL BOX (mystery coin on correct)
 *
 * DETERMINISM: ctx.rng only; no unseeded randomness, no wall clock.
 * FAIRNESS: inert rounds 1-2; no hp costs; overlays pointer-events:none with
 *   inline auto-fade CSS honoring prefers-reduced-motion; banners <=80 chars;
 *   MIDAS consumed exactly once (state 'fate:midas').
 * ============================================================================*/
(function () {
'use strict';
var root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};

function register(H) {
  H.add({
    id: 'fate-w4',
    always: true,
    weight: 1,
    handlers: {
      onRoundStart: function (ctx) {
        if (!ctx || (ctx.round | 0) <= 2) return null;
        var key = 'fate:rolled:' + (ctx.round | 0);
        if (H.state.has(key)) return null;
        H.state.set(key, 1);
        if (ctx.rng() >= 0.12) return null;

        var align = ctx.align || 'neutral';
        var roll = ctx.rng();
        if (align === 'good') {
          if (roll < 0.5 && !H.state.has('fate:midas')) {
            H.state.set('fate:midas', 1);
            return { flag: 'fate-midas', bannerText: 'MIDAS TOUCH · YOUR NEXT CORRECT ANSWER TURNS TO GOLD' };
          }
          return { timerDelta: 6, bannerText: 'A COMET GRANTS SIX SECONDS' };
        }
        if (align === 'bad') {
          return {
            overlayHTML: fateVeil(),
            bannerText: 'THE SUN BETRAYS YOU'
          };
        }
        if (align === 'chaotic') {
          if (roll < 0.5) return { invertControlsMs: 700, bannerText: 'SOMEBODY MOVED YOUR HANDS' };
          return { overlayHTML: fateVeil(), bannerText: 'THE SUN BETRAYS YOU' };
        }
        /* neutral */
        if (roll < 0.5) {
          H.state.set('fate:carnival', 1);
          return { bannerText: 'THE MYSTERY BOX HUMS...' };
        }
        return { scoreMul: 0.9, bannerText: 'TOLL PAID · THE BRIDGE KEEPS 10%' };
      },

      onAnswer: function (ctx) {
        var mods = [];
        if (H.state.has('fate:midas') && ctx && ctx.correct === true) {
          H.state.del('fate:midas');
          mods.push({ scoreMul: 1.5, bannerText: 'MIDAS · ×1.5' });
        }
        if (H.state.has('fate:carnival') && ctx && ctx.correct === true) {
          H.state.del('fate:carnival');
          if (ctx.rng() < 0.5) mods.push({ pickup: { kind: 'coin', value: 1 }, bannerText: 'THE BOX PAYS' });
          else mods.push({ bannerText: 'THE BOX WAS EMPTY · TYPICAL' });
        }
        return mods.length ? (mods.length === 1 ? mods[0] : mods) : null;
      }
    }
  });
}

/* darkness veil: single div, inline fade-out animation, pointer-events none,
 * static under prefers-reduced-motion (opacity jump, no transition). */
function fateVeil() {
  return '<div class="fate-veil" style="position:absolute;inset:0;pointer-events:none;' +
    'background:radial-gradient(ellipse at 50% 45%, rgba(4,6,14,.25) 30%, rgba(2,3,8,.82) 100%);' +
    'animation:fateVeilFade 5s ease-in forwards;' +
    '@media (prefers-reduced-motion: reduce){animation:none;opacity:0;}">' +
    '<style>@keyframes fateVeilFade{0%{opacity:1}70%{opacity:.9}100%{opacity:0}}' +
    '@media (prefers-reduced-motion: reduce){.fate-veil{animation:none !important;opacity:0 !important}}' +
    '</style></div>';
}

/* hooks.js absent -> park and drain on load (sibling convention) */
if (typeof root.IQ !== 'undefined' && root.IQ.Hooks) register(root.IQ.Hooks);
else {
  (root.IQ.__hooksPending = root.IQ.__hooksPending || []).push(function (H) { register(H); });
}

/* node self-test */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    _selfTest: function () {
      var ok = 0, n = 0;
      function T(c) { n++; if (c) ok++; }
      /* stub hooks */
      var store = {}, handlers = {};
      var H = {
        state: {
          has: function (k) { return k in store; },
          set: function (k, v) { store[k] = v; },
          del: function (k) { delete store[k]; }
        },
        add: function (p) { handlers = p.handlers; }
      };
      register(H);
      T(typeof handlers.onRoundStart === 'function' && typeof handlers.onAnswer === 'function');

      function mkCtx(round, align, rngSeq) {
        var i = 0;
        return { round: round, align: align, rng: function () { return rngSeq[i++ % rngSeq.length]; }, correct: false };
      }
      /* inert rounds 1-2 */
      T(handlers.onRoundStart(mkCtx(1, 'good', [0.01])) === null);
      T(handlers.onRoundStart(mkCtx(2, 'bad', [0.01])) === null);
      /* roll window: 0.05 fires, 0.5 skips (non-neutral paths use <0.5 branch split) */
      var fired = handlers.onRoundStart(mkCtx(3, 'good', [0.05, 0.1]));
      T(fired && fired.flag === 'fate-midas');
      T(store['fate:rolled:3'] === 1);
      T(handlers.onRoundStart(mkCtx(3, 'good', [0.05])) === null); /* once per round */
      /* midas consumed once on correct */
      var m1 = handlers.onAnswer({ correct: true, rng: function () { return 0.9; } });
      T(m1 && m1.scoreMul === 1.5);
      T(!H.state.has('fate:midas'));
      T(handlers.onAnswer({ correct: true, rng: function () { return 0.9; } }) === null);
      /* comet branch */
      var c = handlers.onRoundStart(mkCtx(4, 'good', [0.05, 0.9]));
      T(c && c.timerDelta === 6);
      /* eclipse veil contains pointer-events none + reduced-motion kill */
      var e = handlers.onRoundStart(mkCtx(5, 'bad', [0.05]));
      T(e && e.overlayHTML.indexOf('pointer-events:none') >= 0 && e.overlayHTML.indexOf('prefers-reduced-motion') >= 0);
      /* toll bridge (neutral, high roll) */
      var t = handlers.onRoundStart(mkCtx(6, 'neutral', [0.05, 0.9]));
      T(t && t.scoreMul === 0.9, 'toll scoreMul');
      /* carnival pays coin on correct at rng<0.5 */
      handlers.onRoundStart(mkCtx(7, 'neutral', [0.05, 0.1]));
      var cb = handlers.onAnswer({ correct: true, rng: function () { return 0.3; } });
      T(cb && cb.pickup && cb.pickup.kind === 'coin', 'carnival coin');
      /* poltergeist */
      var p = handlers.onRoundStart(mkCtx(8, 'chaotic', [0.05, 0.1]));
      T(p && p.invertControlsMs === 700, 'poltergeist invert');
      /* determinism scan */
      var src = require('fs').readFileSync(__filename, 'utf8');
      T(src.indexOf('Math.random') === -1 && src.indexOf('Date.now') === -1, 'no unseeded rng/clock');
      return { ok: ok === n, passed: ok, total: n };
    }
  };
  var st = module.exports._selfTest();
  console.log('fate-w4 selfTest ' + (st.ok ? 'OK' : 'FAIL') + ' (' + st.passed + '/' + st.total + ')');
  if (!st.ok) process.exit(1);
}
})();
