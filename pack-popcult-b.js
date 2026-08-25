/* ============================================================================
 * pack-popcult-b.js — RING-MOUNTAIN (LOTR parody) + GOLD SHRINE (critter dex)
 * ============================================================================
 *
 * FILE PURPOSE (Main pivot 2026-08-25: original ring/coin/banana beats DROPPED
 * — audits showed pack-interludes.js 'pack-interludes-bank' already ships
 * occasional ring/coin/banana pickups by world tag with auto-cashout.)
 *
 *   [A] WORLD 'ring-mountain' (align:'chaotic') — volcanic crack sky; a dark
 *       tower silhouette topped by a GREAT FLAME EYE, t-driven flicker,
 *       zero Math.random. Parody naming throughout ("halfling luck").
 *       HOOKS bound worlds:['ring-mountain']:
 *         - 'popcult-b-eye-luck' (weight 1): onRoundStart ~30% seeded ->
 *           {scoreMul:1.2, bannerText:'THE EYE LOOKS AWAY · HALFLING LUCK'}.
 *         - 'popcult-b-dragon-coil' (LOW weight 0.5, ANY chaotic world):
 *           onRoundStart ~12% seeded -> {disableOptionIdx:[one blind idx
 *           0..7], bannerText:'A DRAGON COILS OVER ONE ANSWER'}. Registered
 *           always:true + refined on ctx.align==='chaotic' inside the handler
 *           (align-refinement style; static worlds lists cannot express an
 *           align class). The slot is a BLIND SEEDED PICK from ctx.rng —
 *           packs never see correctIdx pre-reveal (fairness rail / parity-safe
 *           exactly like pack-gunship strikes). Only 1 of 8 slots is coiled
 *           over, so >=1 selectable option always remains.
 *
 *   [B] WORLD 'gold-shrine' (align:'neutral') — gilded shrine, six pedestal
 *       silhouettes, drifting sparkle motes (all positions deterministic
 *       closed-form functions of t; no randomness anywhere).
 *       HOOK bound worlds:['gold-shrine']: 'popcult-b-shrine-critters':
 *         onAnswer CORRECT -> seed-pick a critter index 0..5 and add it to the
 *         run bank Hooks.state 'gs:critters' (bitmask). Each FIRST catch of a
 *         species emits {bannerText:'CRITTER CAUGHT · <NAME>'} from the fixed
 *         six-name array SPARKOLEAF, EMBERNIBBLE, GLOAMPUFF, TINICHIME,
 *         MOSSWINK, VELVETUZZ. When all six are caught -> ONCE PER RUN
 *         {scoreMul:1.3, bannerText:'SHRINE COMPLETE · THE SIX ARE YOURS'}.
 *         Wrong answers bank nothing; duplicate catches emit nothing.
 *
 * REGISTRATION SHAPE
 *   window.IQ.Worlds.register({id, align, pal:[8], draw(ctx,w,h,t)})
 *   window.IQ.Hooks.add({id, worlds:[...] | always:true, weight, handlers})
 *   If IQ.Hooks is absent the hook payloads queue on window.IQ.__hooksPending
 *   (canonical late-load queue drained by hooks.js); worlds likewise queue on
 *   window.IQ.__worldsPending if worlds.js lags.
 *
 * DETERMINISM / FAIRNESS RAILS
 *   - ctx.rng ONLY in hooks; ZERO Math.random / Date.now anywhere in this
 *     file (draw() uses closed-form sin/cos of t).
 *   - Handlers try/catch-guarded internally (dispatch also guards).
 *   - Rounds 1–2 INERT (parity rule C8): every handler returns nothing while
 *     ctx.round <= 2 BEFORE consuming any rng values.
 *   - No overlays; banners/score requests only; disableOptionIdx never empties
 *     the board (7 of 8 slots stay live). Scoring stays host-owned.
 *   - State keys prefixed ('gs:', 'pcb:') per Hooks contract; wiped at beginRun.
 *   - draw() honors IQB_MOTION: when falsy, tt=0 -> fully static frame.
 *
 * SELF TEST
 *   node pack-popcult-b.js -> runs embedded selfTest with stubbed
 *   Hooks.state; validates rounds 1–2 inertness, eye-luck threshold, dragon
 *   blind-pick bounds + align gating, critter banking/dedup/completion-once.
 * ============================================================================*/
(function () {
'use strict';
var root = typeof window !== 'undefined' ? window : globalThis;

/* ---- lazy accessors: resolve at call time so stubs/self-tests work ------- */
function stGet(k) { var s = root.IQ && root.IQ.Hooks; return s ? s.state.get(k) : undefined; }
function stSet(k, v) { var s = root.IQ && root.IQ.Hooks; if (s) s.state.set(k, v); }

/* ---- shared guards ------------------------------------------------------- */
/* Parity rail: rounds 1–2 stay baseline clone. Engine passes round as ctx.round. */
function gated(ctx) {
  return !(ctx && (ctx.round | 0) > 2);
}
function isCorrect(ctx) {
  /* Engine sends res:{correct,...} on 'answer' */
  if (ctx && ctx.res && typeof ctx.res.correct === 'boolean') return ctx.res.correct === true;
  return !!(ctx && ctx.correct === true);
}
function motionOK() {
  try { return !!root.IQB_MOTION; } catch (e) { return false; }
}

/* ============================================================
 * [A1] WORLD 'ring-mountain' — volcanic crack sky + GREAT FLAME EYE
 * ============================================================ */
var WORLDS = [
{
  id: 'ring-mountain',
  align: 'chaotic',
  pal: ['#ff9f1c', '#ff4d00', '#8a0315', '#0a0203', '#ffd166',
        '#e01030', '#2b0002', '#ffb703'],
  draw: function (c, w, h, t) {
    var tt = motionOK() ? t : 0;
    var i;
    /* --- volcanic crack sky --- */
    var g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#050102');
    g.addColorStop(0.45, '#20040a');
    g.addColorStop(0.78, '#571003');
    g.addColorStop(1, '#7a1e09');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    /* slow ash haze bands (closed-form drift) */
    for (i = 0; i < 3; i++) {
      var hy = h * (0.18 + 0.14 * i) + Math.sin(tt * 0.21 + i * 2.1) * h * 0.02;
      c.fillStyle = 'rgba(60,16,10,' + (0.10 - i * 0.02) + ')';
      c.fillRect(0, hy, w, h * 0.05);
    }
    /* --- far ridge line --- */
    c.fillStyle = '#120305';
    c.beginPath();
    c.moveTo(0, h * 0.72);
    c.lineTo(w * 0.18, h * 0.62);
    c.lineTo(w * 0.42, h * 0.70);
    c.lineTo(w * 0.68, h * 0.60);
    c.lineTo(w, h * 0.71);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.closePath();
    c.fill();
    /* --- glowing ground cracks (t-driven flicker) --- */
    var crackSeeds = [0.08, 0.24, 0.47, 0.66, 0.85];
    for (i = 0; i < crackSeeds.length; i++) {
      var fx = w * crackSeeds[i];
      var pulse = 0.55 + 0.45 * Math.sin(tt * 1.7 + i * 1.9);
      c.strokeStyle = 'rgba(255,110,20,' + (0.35 + 0.35 * pulse) + ')';
      c.lineWidth = Math.max(1.5, h * 0.006);
      c.beginPath();
      c.moveTo(fx, h);
      c.lineTo(fx + w * 0.02, h * 0.93);
      c.lineTo(fx - w * 0.015, h * 0.88);
      c.lineTo(fx + w * 0.01, h * 0.83);
      c.stroke();
    }
    /* --- THE DARK TOWER (parody silhouette, centre-right) --- */
    var tx = w * 0.68, tw = w * 0.075, th = h * 0.52, baseY = h * 0.74, topY = baseY - th;
    c.fillStyle = '#070203';
    c.beginPath();
    c.moveTo(tx - tw, baseY);
    c.lineTo(tx - tw * 0.55, topY);
    c.lineTo(tx + tw * 0.55, topY);
    c.lineTo(tx + tw, baseY);
    c.closePath();
    c.fill();
    /* twin horn prongs */
    c.beginPath();
    c.moveTo(tx - tw * 0.55, topY);
    c.lineTo(tx - tw * 0.95, topY - h * 0.075);
    c.lineTo(tx - tw * 0.28, topY);
    c.closePath();
    c.moveTo(tx + tw * 0.55, topY);
    c.lineTo(tx + tw * 0.95, topY - h * 0.075);
    c.lineTo(tx + tw * 0.28, topY);
    c.closePath();
    c.fill();
    /* --- THE GREAT FLAME EYE (almond of fire, slit pupil) --- */
    var ex = tx, ey = topY - h * 0.015, ew = tw * 1.5, eh = h * 0.055;
    var glare = 0.65 + 0.35 * Math.sin(tt * 1.3);
    var halo = c.createRadialGradient(ex, ey, 1, ex, ey, ew * 1.6);
    halo.addColorStop(0, 'rgba(255,209,102,' + (0.55 * glare) + ')');
    halo.addColorStop(0.5, 'rgba(255,77,0,' + (0.28 * glare) + ')');
    halo.addColorStop(1, 'rgba(255,77,0,0)');
    c.fillStyle = halo;
    c.fillRect(ex - ew * 1.6, ey - ew * 1.6, ew * 3.2, ew * 3.2);
    c.fillStyle = 'rgba(255,159,28,' + (0.75 + 0.25 * glare) + ')';
    c.beginPath();
    c.moveTo(ex - ew, ey);
    c.quadraticCurveTo(ex, ey - eh * 1.6, ex + ew, ey);
    c.quadraticCurveTo(ex, ey + eh * 1.6, ex - ew, ey);
    c.closePath();
    c.fill();
    /* slit pupil — pure silhouette against the flame */
    c.fillStyle = '#0a0203';
    c.beginPath();
    c.moveTo(ex, ey - eh * 0.95);
    c.quadraticCurveTo(ex + ew * 0.09, ey, ex, ey + eh * 0.95);
    c.quadraticCurveTo(ex - ew * 0.09, ey, ex, ey - eh * 0.95);
    c.closePath();
    c.fill();
  }
},
/* ============================================================
 * [B1] WORLD 'gold-shrine' — gilded shrine, six pedestals, sparkle motes
 * ============================================================ */
{
  id: 'gold-shrine',
  align: 'neutral',
  pal: ['#ffd700', '#e6c86e', '#c9a227', '#fff3b0', '#8a6d1d',
        '#faf0ca', '#5c4a12', '#ffe9a3'],
  draw: function (c, w, h, t) {
    var tt = motionOK() ? t : 0;
    var i;
    /* --- gilded hall backdrop --- */
    var g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#241a06');
    g.addColorStop(0.55, '#4a370f');
    g.addColorStop(1, '#2b2008');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    /* shafts of golden light (static wedges, gentle alpha breathe) */
    for (i = 0; i < 3; i++) {
      var lx = w * (0.22 + 0.28 * i);
      c.fillStyle = 'rgba(250,240,202,' + (0.05 + 0.03 * Math.sin(tt * 0.5 + i)) + ')';
      c.beginPath();
      c.moveTo(lx - w * 0.04, 0);
      c.lineTo(lx + w * 0.04, 0);
      c.lineTo(lx + w * 0.11, h * 0.8);
      c.lineTo(lx - w * 0.11, h * 0.8);
      c.closePath();
      c.fill();
    }
    /* --- stepped dais --- */
    c.fillStyle = '#5c4a12';
    c.fillRect(w * 0.10, h * 0.86, w * 0.80, h * 0.10);
    c.fillStyle = '#c9a227';
    c.fillRect(w * 0.14, h * 0.82, w * 0.72, h * 0.05);
    /* --- six pedestal silhouettes --- */
    for (i = 0; i < 6; i++) {
      var px = w * (0.17 + 0.132 * i);
      var ph = h * (0.10 + 0.012 * (i % 2)); /* alternating heights */
      var py = h * 0.82 - ph;
      c.fillStyle = '#3a2d0a';
      c.fillRect(px - w * 0.028, py, w * 0.056, ph);
      c.fillRect(px - w * 0.036, py - h * 0.012, w * 0.072, h * 0.014); /* cap */
      /* plinth glimmer — purely cosmetic, identical every frame for parity */
      c.fillStyle = 'rgba(255,233,163,' + (0.18 + 0.10 * Math.sin(tt * 0.9 + i * 1.05)) + ')';
      c.fillRect(px - w * 0.018, py - h * 0.010, w * 0.036, h * 0.008);
    }
    /* --- drifting sparkle motes (closed-form Lissajous paths) --- */
    if (motionOK()) {
      for (i = 0; i < 14; i++) {
        var a = tt * (0.11 + 0.017 * (i % 5)) + i * 2.399; /* golden-angle spread */
        var mx = w * (0.5 + 0.42 * Math.sin(a));
        var my = h * (0.45 + 0.33 * Math.sin(a * 0.63 + i));
        var sz = 1 + (i % 3);
        c.fillStyle = 'rgba(255,243,176,' + (0.25 + 0.2 * Math.sin(a * 2.1)) + ')';
        c.fillRect(mx, my, sz, sz);
      }
    }
  }
}
];

/* ============================================================
 * [A2] HOOKS — eye luck + dragon coil
 * ============================================================ */
function eyeLuckOnRoundStart(ctx) {
  try {
    if (gated(ctx)) return undefined;          /* parity: inert rounds 1–2 */
    if (typeof ctx.rng !== 'function') return undefined;
    if (ctx.rng() >= 0.30) return undefined;   /* seeded ~30% halfling luck */
    return {
      scoreMul: 1.2,
      bannerText: 'THE EYE LOOKS AWAY \u00B7 HALFLING LUCK',
      flag: 'pcb-halfling-luck',
      sfx: 'chime'
    };
  } catch (e) { return undefined; }
}

function dragonCoilOnRoundStart(ctx) {
  try {
    if (gated(ctx)) return undefined;          /* parity: inert rounds 1–2 */
    if (ctx.align !== 'chaotic') return undefined; /* any CHAOTIC world only */
    if (typeof ctx.rng !== 'function') return undefined;
    if (ctx.rng() >= 0.12) return undefined;   /* seeded ~12% dragon visit */
    /* BLIND pick: pure ctx.rng, never touches answer data (parity-safe,
     * same discipline as pack-gunship strikes). 1 slot of 8 -> 7 stay live. */
    var idx = Math.floor(ctx.rng() * 8) % 8;
    return {
      disableOptionIdx: [idx],
      bannerText: 'A DRAGON COILS OVER ONE ANSWER',
      flag: 'pcb-dragon-' + idx
    };
  } catch (e) { return undefined; }
}

/* ============================================================
 * [B2] HOOK — gold-shrine critter catching
 * ============================================================ */
var CRITTERS = ['SPARKOLEAF', 'EMBERNIBBLE', 'GLOAMPUFF',
                'TINICHIME', 'MOSSWINK', 'VELVETUZZ'];
var ALL_SIX = (1 << 6) - 1;                  /* bitmask 0b111111 */

function shrineCrittersOnAnswer(ctx) {
  try {
    if (gated(ctx)) return undefined;          /* parity: inert rounds 1–2 */
    if (!isCorrect(ctx)) return undefined;     /* wrong answers bank nothing */
    if (typeof ctx.rng !== 'function') return undefined;
    var mask = stGet('gs:critters') | 0;
    if ((mask & ALL_SIX) === ALL_SIX) return undefined; /* dex complete: quiet */
    var idx = Math.floor(ctx.rng() * 6) % 6;   /* seeded blind species roll */
    var bit = 1 << idx;
    if (mask & bit) return undefined;          /* already caught: no dupe spam */
    mask |= bit;
    stSet('gs:critters', mask);
    if ((mask & ALL_SIX) === ALL_SIX) {
      /* sixth and final catch completes the shrine — once per run */
      return {
        scoreMul: 1.3,
        bannerText: 'SHRINE COMPLETE \u00B7 THE SIX ARE YOURS',
        flag: 'pcb-shrine-complete',
        sfx: 'chime'
      };
    }
    return {
      bannerText: 'CRITTER CAUGHT \u00B7 ' + CRITTERS[idx],
      flag: 'pcb-critter-' + idx,
      sfx: 'chime'
    };
  } catch (e) { return undefined; }
}

/* ============================================================
 * REGISTRATION (or canonical pending queues when core lags)
 * ============================================================ */
var PACKS = [
  {
    id: 'popcult-b-eye-luck',
    worlds: ['ring-mountain'],
    weight: 1,
    handlers: { onRoundStart: eyeLuckOnRoundStart }
  },
  {
    /* ANY chaotic world: registered always + refined on ctx.align inside
     * the handler. Low weight 0.5 per assignment. */
    id: 'popcult-b-dragon-coil',
    always: true,
    weight: 0.5,
    handlers: { onRoundStart: dragonCoilOnRoundStart }
  },
  {
    id: 'popcult-b-shrine-critters',
    worlds: ['gold-shrine'],
    weight: 1,
    handlers: { onAnswer: shrineCrittersOnAnswer }
  }
];

(function register() {
  /* ---- worlds ---- */
  try {
    var W = root.IQ && root.IQ.Worlds;
    if (W && typeof W.register === 'function') {
      for (var wi = 0; wi < WORLDS.length; wi++) W.register(WORLDS[wi]);
      root.IQ = root.IQ || {};
      root.IQ.__worldsPending = root.IQ.__worldsPending || [];
      for (var wj = 0; wj < WORLDS.length; wj++) root.IQ.__worldsPending.push(WORLDS[wj]);
    }
  } catch (e) {
    try { console.warn('[pack-popcult-b] worlds rejected:', e && e.message); } catch (_) {}
  }
  /* ---- hooks ---- */
  try {
    var H = root.IQ && root.IQ.Hooks;
    if (H && typeof H.add === 'function') {
      for (var i = 0; i < PACKS.length; i++) H.add(PACKS[i]);
    } else {
      root.IQ = root.IQ || {};
      root.IQ.__hooksPending = root.IQ.__hooksPending || [];
      for (var j = 0; j < PACKS.length; j++) root.IQ.__hooksPending.push(PACKS[j]);
    }
  } catch (e2) {
    try { console.warn('[pack-popcult-b] hooks rejected:', e2 && e2.message); } catch (_) {}
  }
})();

/* ============================================================
 * SELF TEST — node pack-popcult-b.js
 * Stubbed Hooks.state; drives handlers directly. Deterministic.
 * ============================================================ */
function selfTest() {
  var checks = [];
  function ok(cond, label) { checks.push({ ok: !!cond, label: label }); }

  var map = {};
  root.IQ = root.IQ || {};
  root.IQ.Hooks = {
    state: {
      get: function (k) { return map[k]; },
      set: function (k, v) { map[k] = v; }
    },
    add: function () {}
  };

  function rngSeq(vals) {
    var i = 0;
    return function () { return vals[Math.min(i++, vals.length - 1)]; };
  }
  function actx(round, extra) {
    var o = { round: round, world: 'ring-mountain', align: 'chaotic', rng: rngSeq([0.99]) };
    if (extra) for (var k in extra) o[k] = extra[k];
    return o;
  }

  /* --- rounds 1–2 inert across every handler --- */
  ok(eyeLuckOnRoundStart(actx(1, { rng: rngSeq([0.01]) })) === undefined,
    'eye luck: round 1 inert even on lucky roll');
  ok(dragonCoilOnRoundStart(actx(2, { rng: rngSeq([0.01, 0]) })) === undefined,
    'dragon: round 2 inert even on lucky roll');
  ok(shrineCrittersOnAnswer(actx(2, { res: { correct: true }, rng: rngSeq([0]) })) === undefined,
    'critters: round 2 banks nothing');

  /* --- EYE LUCK: 30% threshold --- */
  var lucky = eyeLuckOnRoundStart(actx(3, { rng: rngSeq([0.29]) }));
  ok(lucky && lucky.scoreMul === 1.2, 'lucky roll < 0.30: scoreMul 1.2');
  ok(lucky && lucky.bannerText === 'THE EYE LOOKS AWAY \u00B7 HALFLING LUCK',
    'lucky roll: halfling banner exact');
  ok(eyeLuckOnRoundStart(actx(4, { rng: rngSeq([0.30]) })) === undefined,
    'roll >= 0.30: no luck (threshold excluded)');
  ok(eyeLuckOnRoundStart(actx(5, { rng: rngSeq([0.999]) })) === undefined, 'roll 0.999: no luck');

  /* --- DRAGON COIL: chaotic-only, 12%, blind idx bounds --- */
  var coiled = dragonCoilOnRoundStart(actx(6, { rng: rngSeq([0.119, 0.5]) }));
  ok(coiled && Array.isArray(coiled.disableOptionIdx) && coiled.disableOptionIdx.length === 1,
    'dragon: exactly ONE option disabled');
  var di = coiled.disableOptionIdx[0];
  ok(di >= 0 && di <= 7 && di === (di | 0), 'dragon: disabled idx in 0..7 integer range');
  ok(coiled && coiled.bannerText === 'A DRAGON COILS OVER ONE ANSWER', 'dragon: banner exact');
  ok(dragonCoilOnRoundStart(actx(7, { rng: rngSeq([0.12, 0.5]) })) === undefined,
    'roll >= 0.12: no dragon (threshold excluded)');
  ok(dragonCoilOnRoundStart(actx(8, { align: 'good', rng: rngSeq([0.01, 0.5]) })) === undefined,
    'good world: dragon never visits');
  ok(dragonCoilOnRoundStart(actx(9, { align: 'bad', rng: rngSeq([0.01, 0.5]) })) === undefined,
    'bad world: dragon never visits');
  ok(dragonCoilOnRoundStart(actx(10, { align: null, rng: rngSeq([0.01, 0.5]) })) === undefined,
    'null align: dragon never visits');
  var coilSpread = {};
  for (var probe = 0; probe < 64; probe++) {
    var m = dragonCoilOnRoundStart(actx(11, { rng: rngSeq([0.01, probe / 64]) }));
    if (m) coilSpread[m.disableOptionIdx[0]] = true;
  }
  ok(Object.keys(coilSpread).length > 1, 'dragon blind picks span multiple slots (seeded, not pinned)');

  /* --- SHRINE CRITTERS: bank, dedupe, complete once --- */
  map = {};                                    /* fresh run store */
  var caught = {}, completed = 0;
  /* drive 40 correct answers with a cycling deterministic rng covering 0..5 */
  var cyc = 0;
  for (var n = 3; n <= 42; n++) {
    var cm = shrineCrittersOnAnswer(
      actx(n, { res: { correct: true }, rng: rngSeq([(cyc++ % 6) / 6 + 0.001]) }));
    if (cm && /CRITTER CAUGHT/.test(cm.bannerText)) {
      var nm = cm.bannerText.split('\u00B7 ')[1];
      ok(CRITTERS.indexOf(nm) !== -1, 'catch banner names a real species: ' + nm);
      ok(!caught[nm], 'first catch only: ' + nm + ' announced once');
      caught[nm] = true;
    }
    if (cm && cm.scoreMul === 1.3) {
      completed++;
      ok(cm.bannerText === 'SHRINE COMPLETE \u00B7 THE SIX ARE YOURS',
        'shrine completion banner exact');
    }
  }
  /* five species announced by name; the SIXTH lands together with the
   * completion fanfare (handler returns one modifier object only) */
  ok(Object.keys(caught).length === 5, 'five named catches before completion');
  ok(completed === 1, 'shrine completion fires EXACTLY once per run (got ' + completed + ')');
  ok((map['gs:critters'] | 0) === 63, 'state gs:critters bitmask = 0b111111 (63)');
  var postDone = shrineCrittersOnAnswer(actx(43, { res: { correct: true }, rng: rngSeq([0.001]) }));
  ok(postDone === undefined, 'post-completion correct answers emit nothing');
  ok(shrineCrittersOnAnswer(actx(44, { res: { correct: false }, rng: rngSeq([0.001]) })) === undefined,
    'wrong answer banks no critter');
  /* forced final-species completion, then duplicate silence */
  map['gs:critters'] = 63 ^ 32;                /* all but species idx 5 caught */
  var fin = shrineCrittersOnAnswer(actx(45, { res: { correct: true }, rng: rngSeq([0.9]) }));
  ok(fin && fin.scoreMul === 1.3, 'final missing species completes shrine');
  map['gs:critters'] = 63 ^ 32;
  var dupQuiet = shrineCrittersOnAnswer(actx(46, { res: { correct: true }, rng: rngSeq([0.55]) }));
  ok(dupQuiet === undefined, 'duplicate species catch stays silent');

  var pass = checks.every(function (cc) { return cc.ok; });
  for (var i = 0; i < checks.length; i++) {
    if (!checks[i].ok) console.error('FAIL:', checks[i].label);
  }
  console.log('[pack-popcult-b] selfTest: ' +
    checks.filter(function (c2) { return c2.ok; }).length + '/' + checks.length + ' checks passed');
  return { ok: pass, checks: checks };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { selfTest: selfTest, packs: PACKS, worlds: WORLDS };
}
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  selfTest();
}
})();
