/* ============================================================================
 * hell-skin.js — IQ Versus: SHADOW · HELL & HEAVEN visual escalation skin
 * ----------------------------------------------------------------------------
 * PURPOSE: the base chrome stops escalating at .corr-3 (index.html setStage).
 * This module continues the descent BEYOND corruption tier 3, keyed to the
 * HELL & HEAVEN layer track (window.IQ.HellHeaven.layer(), 1..7 from
 * hellheaven.js). Purely cosmetic: gradients, inset shadows, saturation.
 *
 * MECHANIC (single self-registering module):
 *   1. STYLE — injects ONE <style id="hh-skin-style"> defining .hh-layer-1..7:
 *        - vignette depth: radial inset shadow opacity 0.15 -> 0.55
 *        - crimson edge bleed: saturate() + faint crimson inset ring on PANEL
 *          chrome only (.round-strip/.side-panel/.score-card/#topbar/.panel)
 *        - GLYPH SAFETY: question/answer glyph containers (.opt-btn,
 *          .board-frame, #opts-grid) are NEVER selected, never filtered,
 *          never recoloured — readability floor is absolute.
 *        - sets cosmetic hint var --hh-embers per layer (consumable later;
 *          nothing gameplay-facing reads it).
 *   2. CONTROLLER — always:true hook 'hell-skin':
 *        onRoundStart: parity C8 — rounds 1-2 strip EVERYTHING (inert).
 *        hostile (bad/chaotic): strip .hh-calm, set body.hh-layer-<n> from
 *          HellHeaven.layer() (defensive try/catch, clamped 1..7).
 *        sanctuary round (ctx.world==='heaven' || ctx.align==='good'): strip
 *          all .hh-layer-*, add body.hh-calm which force-overrides every
 *          effect to none (filter:none, no vignette).
 *   3. REDUCED MOTION: this skin ships ZERO animation/transition of its own
 *      (pure static paint). A prefers-reduced-motion media query additionally
 *      hard-disables animation/transition on affected nodes as belt-and-braces.
 *      No flashes anywhere — fades-free static gradients/shadows only.
 *
 * DETERMINISM: no randomness of any kind (not even cosmetic) — class choice is
 * a pure function of (round, align/world, HellHeaven.layer()). No rng used.
 *
 * FAIRNESS RAILS: parity C8 inert rounds 1-2; never recolours/animates
 * glyphs; overlays are pure paint (pointer-events:none, escapable by nature);
 * no text below 11px introduced; saturate <=1.21 on near-black panels leaves
 * --ink (#f5f8ff) contrast well above ~4.5:1; vignette darkens EDGES only
 * (centre fully transparent over the board).
 *
 * INTEGRATION (Main): load AFTER hellheaven.js, before pack files:
 *   <script src="./sanctuary.js?v=w4"></script>
 *   <script src="./hellheaven.js?v=w4"></script>
 *   <script src="./hell-skin.js?v=w4"></script>
 * Consumes: window.IQ.HellHeaven.layer(), IQ.Hooks.add (optional).
 * Exposes: window.IQ.HellSkin { apply, calm, clear, layer } (apply() is also
 * callable directly by tests; hook registration is best-effort try/catch).
 * Headless-safe: every document touch is guarded; CommonJS export for smokes.
 * ==========================================================================*/
(function () {
'use strict';
var root = typeof window !== 'undefined' ? window : globalThis;

var MAX_LAYER = 7;
var PARITY_ROUNDS = 2;                 /* C8: inert through round 2 */
var STYLE_ID = 'hh-skin-style';

/* vignette opacities: .15 (L1) -> .55 (L7), linear */
function vigFor(i) {
  var t = (i - 1) / (MAX_LAYER - 1);
  return +(0.15 + t * (0.55 - 0.15)).toFixed(4);
}
/* panel saturate: subtle 1.03 -> 1.21 */
function satFor(i) {
  return +(1 + 0.03 * i).toFixed(3);
}
/* crimson inset-ring alpha: 0.02 -> 0.14 */
function bleedFor(i) {
  return +(0.02 * i).toFixed(3);
}

/* ---- style sheet text: built once, deterministic ---- */
function buildCss() {
  var PANELS =
    'body.hh-layer-N #topbar,' +
    'body.hh-layer-N #app .round-strip,' +
    'body.hh-layer-N #app .side-panel,' +
    'body.hh-layer-N #app .panel,' +
    'body.hh-layer-N #app .score-card';

  var css = '';
  css += '/* == hell-skin.js injected: layers 1-7 escalate BEYOND corr-3 == */\n';

  for (var i = 1; i <= MAX_LAYER; i++) {
    var vig = vigFor(i), sat = satFor(i), bleed = bleedFor(i);

    /* vignette: fixed-edge radial, centre transparent (readability), pure paint */
    css += 'body.hh-layer-' + i + '::after{content:\'\';position:fixed;inset:0;' +
      'pointer-events:none;z-index:45;' +
      'background:radial-gradient(ellipse at 50% 46%,' +
      'rgba(8,2,10,0) 44%,rgba(8,2,10,' + vig + ') 100%);' +
      'box-shadow:inset 0 0 ' + (70 + i * 24) + 'px ' + (16 + i * 7) +
      'px rgba(5,1,6,' + vig + ');}\n';

    /* crimson edge-bleed saturation on panel CHROME ONLY (never glyphs) */
    css += PANELS.replace(/hh-layer-N/g, 'hh-layer-' + i) + '{' +
      'filter:saturate(' + sat + ');' +
      'box-shadow:inset 0 0 26px rgba(150,18,42,' + bleed + '),' +
      '0 12px 34px rgba(30,0,12,' + (0.2 + bleed).toFixed(3) + ');}\n';

    /* cosmetic-only ember-density hint var (nothing gameplay-facing reads it) */
    css += 'body.hh-layer-' + i + '{--hh-embers:' + (6 + i * 3) + ';}\n';
  }

  /* SANCTUARY CALM: force-override every escalation back to clean */
  css += 'body.hh-calm::after{content:none!important;box-shadow:none!important;background:none!important}\n' +
    'body.hh-calm #topbar,body.hh-calm #app .round-strip,' +
    'body.hh-calm #app .side-panel,body.hh-calm #app .panel,' +
    'body.hh-calm #app .score-card{filter:none!important;' +
    'box-shadow:var(--shadow)!important}\n' +
    'body.hh-calm{--hh-embers:0}\n';

  /* REDUCED MOTION: effects are static by construction; hard-disable anyway */
  css += '@media (prefers-reduced-motion:reduce){' +
    'body[class*="hh-layer"]::after,body[class*="hh-layer"] #topbar,' +
    'body[class*="hh-layer"] #app .round-strip,body[class*="hh-layer"] #app .side-panel,' +
    'body[class*="hh-layer"] #app .panel,body[class*="hh-layer"] #app .score-card,' +
    'body.hh-calm *{animation:none!important;transition:none!important}}\n';

  return css;
}

/* ---- inject exactly once ---- */
function injectStyle(d) {
  if (!d || !d.head || !d.createElement || d.getElementById(STYLE_ID)) return false;
  var el = d.createElement('style');
  el.id = STYLE_ID;
  el.textContent = buildCss();
  d.head.appendChild(el);
  return true;
}

/* ---- body-class helpers (guarded) ---- */
function bodyOf(d) {
  try { return (d && d.body && d.body.classList) ? d.body : null; }
  catch (e) { return null; }
}
function stripLayers(b) {
  for (var i = 1; i <= MAX_LAYER; i++) b.classList.remove('hh-layer-' + i);
}
function stripAll(b) {
  stripLayers(b);
  b.classList.remove('hh-calm');
}

/* ---- sanctuary predicate (mirrors sanctuary.js isSanctuaryCtx) ---- */
function isSanctuaryCtx(c) {
  return c.world === 'heaven' || c.align === 'good';
}

/* ---- defensive layer read ---- */
function currentLayer() {
  try {
    var HH = root.IQ && root.IQ.HellHeaven;
    if (HH && typeof HH.layer === 'function') {
      var n = Number(HH.layer());
      if (isFinite(n)) return Math.max(1, Math.min(MAX_LAYER, n | 0));
    }
  } catch (e) { /* fall through */ }
  return 1;
}

/* ============================ PUBLIC API ================================== */

function apply(ctx) {
  try {
    var d = typeof document !== 'undefined' ? document : null;
    injectStyle(d);
    var b = bodyOf(d);
    if (!b) return null;

    var c = ctx || {};
    var rd = c.round | 0;

    /* parity C8: pristine through round 2 — strip everything */
    if (rd > 0 && rd <= PARITY_ROUNDS) { stripAll(b); return null; }

    if (isSanctuaryCtx(c)) {
      stripLayers(b);
      b.classList.add('hh-calm');       /* next hostile round removes it */
      return null;
    }

    /* hostile (or neutral-held) round: live escalation, calm revoked */
    b.classList.remove('hh-calm');
    stripLayers(b);
    b.classList.add('hh-layer-' + currentLayer());
  } catch (e) { /* never break a round over cosmetics */ }
  return null;                          /* purely visual: emits NO modifiers */
}

function calm() {
  try {
    var b = bodyOf(typeof document !== 'undefined' ? document : null);
    if (!b) return;
    stripLayers(b);
    b.classList.add('hh-calm');
  } catch (e) { /* ignore */ }
}

function clear() {
  try {
    var b = bodyOf(typeof document !== 'undefined' ? document : null);
    if (b) stripAll(b);
  } catch (e) { /* ignore */ }
}

function layer() { return currentLayer(); }

var HellSkin = {
  apply: apply,
  calm: calm,
  clear: clear,
  layer: layer
};

/* ============================ REGISTRATION ================================ */

(function boot() {
  root.IQ = root.IQ || {};
  root.IQ.HellSkin = HellSkin;

  try {
    var H = root.IQ && root.IQ.Hooks;
    if (H && typeof H.add === 'function') {
      H.add({
        id: 'hell-skin',
        always: true,
        weight: 1,
        handlers: { onRoundStart: apply }
      });
    }
  } catch (e) { /* cosmetics must never block boot */ }
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    api: HellSkin,
    css: buildCss,
    MAX_LAYER: MAX_LAYER,
    PARITY_ROUNDS: PARITY_ROUNDS
  };
}
})();
