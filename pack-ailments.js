/* ============================================================================
 * pack-ailments.js — PackAilments wave: old-timey health ailments + 1 world.
 *
 * SPEC -> MECHANIC MAP
 *   1. AFFLICTION ROULETTE (hostile rounds, ~20%)
 *      On roundStart of any BAD/CHAOTIC round (ctx.align refinement,
 *      always:true binding) with NO ailment already running, ONE ctx.rng()
 *      draw decides (~20%) whether the miasma takes hold; a second draw picks
 *      among four period ailments:
 *        GOUT    -> invertControlsMs 800ms bursts every 5s through the round
 *                   (fixed cadence 3s, 8s, 13s ... < timerLen-1; input-mapping
 *                   requests only, scoring untouched)
 *        RICKETS -> timerDelta -4 telegraphed at each roundStart while active
 *        AGUE    -> scoreMul 0.9 on each answer + a 180ms CSS shake pulse on
 *                   #board-frame (motion-gated; text stays readable)
 *        SWEATS  -> hpDelta -1 per tick, hard-capped at -4 per round
 *      Only ONE ailment at a time — the roulette skips while one runs, so
 *      nothing stacks, and every key lives under 'pack-ailments:' — fully
 *      separate from pack-events' bare 'plague' economy key.
 *   2. TELEGRAPH: each application announces itself with a period banner,
 *      e.g. 'THOU HAST DEVELOPED GOUT'. Continuation rounds get reminder
 *      banners; nothing lands silently.
 *   3. CURE PATHS:
 *      - Sanctum/good rounds: a GOOD round (or world 'sanctum-light') purges
 *        the running ailment at roundStart before its effects apply.
 *      - Doctor's tonic: answering CORRECTLY while afflicted drops the tonic
 *        (~1 in 6, ctx.rng) as pickup {kind:'health', value:8} — engine enum
 *        has no 'tonic'; the drop IS the dose, clearing the ailment instantly.
 *   4. PERSISTENCE: the ailment rides in Hooks.state 'pack-ailments:ail' with
 *      a roundsLeft countdown set to 2; each roundStart decrements it and at
 *      zero the ailment fades naturally with a banner. Effects therefore last
 *      at most two rounds even if no cure arrives.
 *
 * DETERMINISM: gameplay decisions (roulette roll, ailment pick, tonic drop)
 * use ctx.rng ONLY, one draw per decision point, so the modifier stream is
 * identical host/client. Wall clocks drive presentation timing only (gout
 * burst trigger, shake-pulse removal) — same convention as pack-horror's
 * acid bursts; invertControlsMs is an input-mapping request the engine owns.
 *
 * FAIRNESS RAILS: motion behind IQB_MOTION (ague shake skipped entirely when
 * off); audio via sfx cues (engine honors IQB_MUTED); overlays none beyond
 * banners; question/answer text never touched; scoring stays host-
 * authoritative (scoreMul/hpDelta/timerDelta requests only); no fullscreen
 * flash anywhere; sweats cannot kill outright (-4/round cap, engine clamps).
 *
 * SMOKE (headless):
 *   node -e "require('./pack-ailments.js')._smoke()"
 * ============================================================================*/
(function () {
'use strict';
var root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};
var IQ = root.IQ;

/* ---------- guarded Hooks/state fallbacks (same pattern as pack-horror.js) */
if (!IQ.Hooks || typeof IQ.Hooks.add !== 'function') {
  console.warn('[pack-ailments] IQ.Hooks absent — installing stub queue.');
  IQ.Hooks = IQ.Hooks || {};
  IQ.Hooks.add = function (pack) {
    (IQ.Hooks._q = IQ.Hooks._q || []).push(pack);
    /* canonical channel too — hooks.js drains whichever it finds */
    var pend = root.IQ.__hooksPending = root.IQ.__hooksPending || [];
    if (!pend.some(function (p) { return p && p.id === pack.id; })) pend.push(pack);
  };
}

var LOCAL = {};                       /* node smoke fallback store */
var st = {
  get: function (k) {
    var H = root.IQ && root.IQ.Hooks;
    if (H && H.state && typeof H.state.get === 'function') {
      return H.state.has(String(k)) ? H.state.get(String(k)) : undefined;
    }
    return LOCAL[k];
  },
  set: function (k, v) {
    var H = root.IQ && root.IQ.Hooks;
    if (H && H.state && typeof H.state.set === 'function') { H.state.set(String(k), v); return v; }
    LOCAL[k] = v; return v;
  },
  del: function (k) {
    var H = root.IQ && root.IQ.Hooks;
    if (H && H.state && typeof H.state.del === 'function') { H.state.del(String(k)); return; }
    delete LOCAL[k];
  }
};

function nowMs() {
  return (root.performance && performance.now) ? performance.now() : Date.now();
}
function motionOK() {
  try {
    var v = root.localStorage && root.localStorage.getItem('IQB_MOTION');
    return v == null ? true : JSON.parse(v) !== false;
  } catch (e) { return true; }
}
function hostile(align) { return align === 'bad' || align === 'chaotic'; }

/* Per-round runtime records keyed '<runId>#<round>@<owner>' — presentation
 * clocks and per-round counters only; outcomes ride the modifier pipeline. */
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

/* ---------- injected style (ague shake pulse on the board frame) ---------- */
var styleDone = false;
function ensureStyle() {
  if (styleDone || typeof document === 'undefined') return;
  styleDone = true;
  var stl = document.createElement('style');
  stl.id = 'iqh-ailments-style';
  stl.textContent =
    '@keyframes iqhAgueShake{0%,100%{transform:translate(0,0)}25%{transform:translate(-4px,2px)' +
    '}50%{transform:translate(3px,-2px)}75%{transform:translate(-2px,1px)}}' +
    'body.iqh-ague #board-frame{animation:iqhAgueShake .18s ease-in-out 1}';
  var head = document.head || document.getElementsByTagName('head')[0];
  head.appendChild(stl);
}
function aguePulse() {
  /* presentation-only pulse; never when motion is off; self-cleans */
  if (!motionOK() || typeof document === 'undefined' || !document.body) return;
  ensureStyle();
  document.body.classList.add('iqh-ague');
  setTimeout(function () {
    try { document.body.classList.remove('iqh-ague'); } catch (e) {}
  }, 190);
}

/* ==========================================================================
 * WORLD — 'plague-quarter' (bad): the old town under quarantine miasma
 * ========================================================================*/
var TAU = Math.PI * 2;

var PLAGUE_QUARTER = {
  id: 'plague-quarter', align: 'bad',
  pal: ['#a8b56a', '#5f6e3e', '#3a4426', '#171a10', '#c9d489',
        '#7d8a4f', '#4e5c30', '#e2ecc0'],
  draw: function (c, w, h, t) {
    /* sickly dusk over the quarantined quarter */
    var g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#141708'); g.addColorStop(0.55, '#2b3016'); g.addColorStop(1, '#10120a');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    /* a pale, unwholesome sun low on the horizon */
    var sy = h * (0.34 + 0.01 * Math.sin(t * 0.4));
    c.fillStyle = 'rgba(201,212,137,.14)';
    c.beginPath(); c.arc(w * 0.5, sy, 90, 0, TAU); c.fill();
    c.fillStyle = 'rgba(226,236,192,.35)';
    c.beginPath(); c.arc(w * 0.5, sy, 34, 0, TAU); c.fill();
    /* leaning hovels of the quarter, two depths */
    function hovels(base, colr, sway) {
      c.fillStyle = colr;
      for (var i = 0; i < 11; i++) {
        var bw = w / 11;
        var lean = Math.sin(i * 3.1) * sway;
        var bx = i * bw + lean, bh = h * (0.16 + ((i * 29) % 40) / 260);
        c.fillRect(bx, base - bh, bw * 0.82, bh);
        c.beginPath();                               /* sagging thatch */
        c.moveTo(bx - bw * 0.08, base - bh);
        c.lineTo(bx + bw * 0.41, base - bh - bw * 0.28);
        c.lineTo(bx + bw * 0.9, base - bh);
        c.closePath(); c.fill();
      }
    }
    hovels(h * 0.78, 'rgba(58,68,38,.85)', 6 + Math.sin(t * 0.3));
    hovels(h * 0.88, 'rgba(23,26,16,.95)', 10 + Math.sin(t * 0.24) * 3);
    /* miasma banks crawling along the lanes */
    for (var f = 0; f < 4; f++) {
      c.fillStyle = 'rgba(168,181,106,.05)';
      c.beginPath();
      c.ellipse((t * 11 + f * w * 0.33) % (w + 360) - 180,
                h * (0.62 + 0.07 * f), 230, 40, 0, 0, TAU);
      c.fill();
    }
    /* carrion birds circling the spire */
    for (var b = 0; b < 5; b++) {
      var a = t * (0.35 + b * 0.05) + b * 1.3;
      var cxw = w * 0.5 + Math.cos(a) * w * (0.18 + b * 0.05);
      var cyw = h * 0.2 + Math.sin(a * 2 + b) * 12 + b * 9;
      var flap = Math.sin(t * 7 + b * 2) * 3;
      c.strokeStyle = 'rgba(23,26,16,.8)'; c.lineWidth = 2;
      c.beginPath();
      c.moveTo(cxw - 7, cyw + flap); c.lineTo(cxw, cyw); c.lineTo(cxw + 7, cyw + flap);
      c.stroke();
    }
  }
};

function registerWorld() {
  var W = IQ.Worlds;
  if (W && typeof W.register === 'function') {
    try { W.register(PLAGUE_QUARTER); } catch (e) { /* duplicate id: keep first */ }
    return;
  }
  /* worlds.js may load late — retry briefly, never throw */
  var attempt = 0;
  function retry() {
    attempt++;
    var W2 = root.IQ && root.IQ.Worlds;
    if (W2 && typeof W2.register === 'function') {
      try { W2.register(PLAGUE_QUARTER); } catch (e) {}
    } else if (attempt < 40 && typeof setTimeout === 'function') {
      setTimeout(retry, 50);
    }
  }
  retry();
}

/* ==========================================================================
 * THE FOUR AILMENTS — data table + per-round behaviour
 * ========================================================================*/
var AILMENTS = [
  { id: 'gout',
    announce: '\u2699 THOU HAST DEVELOPED GOUT \u2014 THY HANDS TURN AGAINST THEE',
    remind:   'THE GOUT STILL BITES \u00B7 MIND THY FINGERS',
    fade:     'THE GOUT RECEDES WITH THE CHANGING SEASON' },
  { id: 'rickets',
    announce: '\u2699 THOU HAST DEVELOPED RICKETS \u2014 TIME RUNS SOFT AS BONE',
    remind:   'THY BONES STILL BEND \u00B7 FOUR MOMENTS LOST',
    fade:     'THY BONES KNIT WHOLE AGAIN \u2014 THE RICKETS PASSES' },
  { id: 'ague',
    announce: '\u2699 THOU HAST DEVELOPED THE AGUE \u2014 EACH ANSWER SHAKES THEE',
    remind:   'THE FEVER CHILLS REMAIN \u00B7 GLORY DIMMED TO NINE-TENTHS',
    fade:     'THE FEVER BREAKS \u2014 THE AGUE IS PASSED' },
  { id: 'sweats',
    announce: '\u2699 THOU HAST DEVELOPED THE SWEATS \u2014 VIGOUR DRIPS AWAY',
    remind:   'THE SWEATS CLING STILL \u00B7 STAY NOT IDLE',
    fade:     'THE SWEATS DRY FROM THY BROW' }
];

var KEY_AIL = 'pack-ailments:ail';       /* null | {id, left} */
var ROULETTE_P = 0.20;                   /* hostile-round affliction chance */
var TONIC_P = 1 / 6;                     /* correct-answer tonic drop chance */
var MAX_ROUNDS = 2;

function curAil() { return st.get(KEY_AIL) || null; }
function ailDef(id) {
  for (var i = 0; i < AILMENTS.length; i++) if (AILMENTS[i].id === id) return AILMENTS[i];
  return null;
}
function inSanctum(ctx) {
  return ctx.align === 'good' || ctx.world === 'sanctum-light';
}

/* gout: fixed 5s cadence inside the round — no extra rng draws needed */
function goutBurstTimes(timerLen) {
  var times = [], at = 3;
  while (at < Math.max(6, timerLen - 1)) { times.push(at); at += 5; }
  return times;
}

/* ==========================================================================
 * THE PACK — binds everywhere, refines on ctx.align inside handlers
 * =========================================================================*/
var PACK_DEF = {
  id: 'pack-ailments',
  always: true,
  weight: 1,
  handlers: {

    /* ---- roundStart: fade/cure bookkeeping, then roulette ---- */
    onRoundStart: function (ctx) {
      var ail = curAil(), mod = null;

      if (ail) {
        var def = ailDef(ail.id);
        ail.left = (ail.left | 0) - 1;
        if (inSanctum(ctx)) {
          /* spec 3: sanctum/good rounds clear all ailments */
          st.del(KEY_AIL);
          mod = {
            bannerText: '\u2726 THE SANCTUM\u2019S PHYSICK PURGES THE ' +
              ail.id.toUpperCase() + ' FROM THEE',
            sfx: 'chime', flag: 'ail-cure-sanctum'
          };
        } else if (ail.left <= 0) {
          /* spec 4: natural fade at countdown zero */
          st.del(KEY_AIL);
          mod = { bannerText: def.fade, sfx: 'chime', flag: 'ail-fade' };
        } else {
          st.set(KEY_AIL, ail);            /* persists into another round */
          mod = { bannerText: def.remind, flag: 'ail-persist' };
          if (ail.id === 'rickets') mod.timerDelta = -4;   /* bones still bend */
        }
      }

      /* fresh affliction only when clean, hostile, and fortune wills (~20%) */
      if (!curAil() && hostile(ctx.align)) {
        if (ctx.rng() < ROULETTE_P) {
          var pick = AILMENTS[Math.floor(ctx.rng() * AILMENTS.length) % AILMENTS.length];
          st.set(KEY_AIL, { id: pick.id, left: MAX_ROUNDS });
          var applyMod = {
            bannerText: pick.announce,
            sfx: 'whisper',
            flag: 'ail-applied:' + pick.id
          };
          if (pick.id === 'rickets') applyMod.timerDelta = -4;
          mod = applyMod;                  /* replaces fade/persist notice */
        }
      }

      /* per-round runtime records for the active (possibly new) ailment */
      var run = curAil();
      if (run && run.id === 'gout') {
        rec('gout', ctx, {
          times: goutBurstTimes(ctx.timerLen || 60),
          fired: 0, clock: 0, last: nowMs()
        });
      }
      if (run && run.id === 'sweats') {
        rec('sweats', ctx, { drained: 0 });
      }
      /* hygiene: never let a stale shake class ride into a new round */
      if (typeof document !== 'undefined' && document.body) {
        document.body.classList.remove('iqh-ague');
      }

      return mod;
    },

    /* ---- tick: gout inversion bursts + sweats drain ---- */
    onTick: function (ctx) {
      var ail = curAil();
      if (!ail) return null;
      var out = null;

      if (ail.id === 'gout') {
        var r = rec('gout', ctx, null);
        if (r && r.times) {
          r.clock += Math.min(Math.max(nowMs() - r.last, 0), 250) / 1000;
          r.last = nowMs();
          if (r.fired < r.times.length && r.clock >= r.times[r.fired]) {
            r.fired += 1;
            out = {
              invertControlsMs: 800,
              bannerText: 'THE GOUT TWISTS THY HAND \u2014 STEADY\u2026',
              sfx: 'zap',
              flag: 'gout-burst'
            };
          }
        }
      }

      if (ail.id === 'sweats') {
        var s = rec('sweats', ctx, null);
        if (s && s.drained < 4) {           /* hard cap: -4 hp per round */
          s.drained += 1;
          out = {
            hpDelta: -1,
            bannerText: s.drained >= 4 ?
              'THE SWEATS WRING THEE DRY FOR THIS ROUND' :
              'THOU SWEATEST \u2014 HP \u22121',
            sfx: 'heart',
            flag: 'sweats-tick'
          };
        }
      }

      return out;
    },

    /* ---- answer: doctor's tonic, or the ague's trembling toll ---- */
    onAnswer: function (ctx) {
      var ail = curAil();
      if (!ail || !ctx.res || !ctx.res.correct) return null;

      /* ONE rng draw per qualifying answer keeps the stream stable. */
      var roll = ctx.rng();

      /* spec 3: the doctor's tonic — dropped AND administered in one breath */
      if (roll < TONIC_P) {
        st.del(KEY_AIL);
        return {
          pickup: { kind: 'health', value: 8 },
          bannerText: '\u2697 THE DOCTOR\u2019S TONIC \u2014 SIPPED, AND THE ' +
            ail.id.toUpperCase() + ' LEAVES THEE',
          sfx: 'chime',
          flag: 'ail-tonic-cure'
        };
      }

      if (ail.id === 'ague') {
        aguePulse();
        return {
          scoreMul: 0.9,
          bannerText: 'THY HAND TREMBLES \u2014 NEXT AWARD AT NINE-TENTHS',
          flag: 'ague-shiver'
        };
      }

      return null;
    },

    /* ---- reveal: safety net — shake pulse must never outlive the round ---- */
    onReveal: function () {
      if (typeof document !== 'undefined' && document.body) {
        document.body.classList.remove('iqh-ague');
      }
      return null;
    }
  }
};
IQ.Hooks.add(PACK_DEF);

registerWorld();

/* ==========================================================================
 * HEADLESS SMOKE — exercises the pure paths against real hooks.js state.
 * ============================================================================*/
function _smoke() {
  var checks = [];
  var ok = function (name, cond) { checks.push({ name: name, ok: !!cond }); };

  var H = root.IQ.Hooks;
  if (typeof H.beginRun !== 'function' && typeof require === 'function') {
    /* headless: pull in the real contract */
    try { require('./hooks.js'); } catch (e) {}
    H = root.IQ.Hooks;
  }
  /* re-register under whatever API is live — Hooks.add replaces by id */
  try { H.add(PACK_DEF); } catch (e) {}
  H.beginRun('smoke-ail', 1234);
  /* hooks.js ships exemplar mini-packs (always:true) — remove them so this
   * harness observes ONLY pack-ailments modifiers */
  ['example-timerdrain', 'example-shield', 'example-confetti'].forEach(function (id) {
    try { H.remove(id); } catch (e) {}
  });

  /* queued-rng FACTORY: seq(0.1, 0.2) -> fn returning those draws, then 0.99 */
  function seq() {
    var q = Array.prototype.slice.call(arguments);
    return function () { return q.length ? q.shift() : 0.99; };
  }
  function ctx(o) {
    o = o || {};
    return {
      round: o.round || 1, world: o.world || '', align: o.align || 'neutral',
      hp: 100, score: 0, streak: 0, timerLen: 60, optCount: 8,
      rng: o.rng || seq(), runId: 'smoke-ail', seed: 1234,
      res: o.res
    };
  }
  function purge() {                    /* a sanctum round clears any ailment */
    H.dispatch('roundStart', ctx({ align: 'good', rng: seq() }));
  }

  /* 1. neutral round: no roulette */
  var m = H.dispatch('roundStart', ctx({ align: 'neutral', rng: seq(0.01) }));
  ok('neutral round afflicts nobody', !m.some(function (x) { return x.flag === 'ail-applied:gout'; }));

  /* 2. hostile round below threshold: still clean */
  m = H.dispatch('roundStart', ctx({ round: 2, align: 'bad', rng: seq(0.5) }));
  ok('rng above 0.20 spares the player', m.length === 0);
  purge();
  /* 3. gout: applied, bursts invert 800ms, persists, fades after 2 rounds */

  m = H.dispatch('roundStart', ctx({ round: 3, align: 'chaotic', rng: seq(0.10, 0.02) }));
  ok('gout telegraphed', m.some(function (x) { return x.flag === 'ail-applied:gout' &&
    /GOUT/.test(x.bannerText); }));
  var gr = { round: 3, align: 'chaotic', rng: seq(), runId: 'smoke-ail' };
  H.dispatch('tick', gr)[0];               /* warm the clock baseline */
  /* force the first burst window deterministically */
  var rk = Object.keys(rtStore()).filter(function (k) { return /@gout$/.test(k); })[0];
  ok('gout round record exists', !!rk);
  if (rk) rtStore()[rk].clock = 99;        /* presentation clock, smoke only */
  m = H.dispatch('tick', gr);
  ok('burst requests invertControlsMs:800', m.some(function (x) { return x.invertControlsMs === 800; }));
  m = H.dispatch('roundStart', ctx({ round: 4, align: 'bad', rng: seq(0.99) }));
  ok('gout persists round 2 with reminder', m.some(function (x) { return x.flag === 'ail-persist'; }));
  ok('persist round rolls NO new ailment', !m.some(function (x) {
    return String(x.flag || '').indexOf('ail-applied') === 0; }));
  m = H.dispatch('roundStart', ctx({ round: 5, align: 'bad', rng: seq(0.50) }));
  ok('gout fades naturally at countdown zero', m.some(function (x) { return x.flag === 'ail-fade'; }));
  ok('slot free after fade', !curAilPublic());
  m = H.dispatch('roundStart', ctx({ round: 6, align: 'chaotic', rng: seq(0.01, 0.02) }));
  ok('faded slot admits a fresh roll', m.some(function (x) {
    return String(x.flag || '').indexOf('ail-applied:') === 0; }));

  /* 4. rickets: -4 timer on apply AND on each persisting round */
  purge();
  m = H.dispatch('roundStart', ctx({ round: 6, align: 'bad', rng: seq(0.10, 0.30) }));
  ok('rickets telegraphed with timerDelta -4',
    m.some(function (x) { return x.timerDelta === -4 && /RICKETS/.test(x.bannerText); }));
  m = H.dispatch('roundStart', ctx({ round: 7, align: 'bad', rng: seq(0.99) }));
  ok('rickets persists with another timerDelta -4',
    m.some(function (x) { return x.flag === 'ail-persist' && x.timerDelta === -4; }));
  m = H.dispatch('roundStart', ctx({ round: 7, align: 'good', rng: seq() }));
  ok('good round cures the ailment (sanctum physick)',
    m.some(function (x) { return x.flag === 'ail-cure-sanctum'; }));
  ok('state cleared after sanctum cure', !curAilPublic());

  /* 5. ague: scoreMul 0.9 on answers; tonic clears instantly */
  purge();
  m = H.dispatch('roundStart', ctx({ round: 8, align: 'bad', rng: seq(0.10, 0.60) }));
  ok('ague telegraphed', m.some(function (x) { return /AGUE/.test(x.bannerText || ''); }));
  m = H.dispatch('answer', ctx({ round: 8, rng: seq(0.50),
    res: { correct: true, picked: 1, correctIdx: 1 } }));
  ok('ague shaves next award to 0.9', m.some(function (x) { return x.scoreMul === 0.9; }));
  m = H.dispatch('answer', ctx({ round: 8, rng: seq(0.01),
    res: { correct: true, picked: 1, correctIdx: 1 } }));
  ok('doctor\u2019s tonic maps to health enum', m.some(function (x) {
    return x.pickup && x.pickup.kind === 'health' && x.pickup.value === 8; }));
  ok('wrong answer draws neither tonic nor shiver',
    H.dispatch('answer', ctx({ round: 8, rng: seq(0.01),
      res: { correct: false, picked: 2, correctIdx: 1 } })).length === 0);

  /* 6. sweats: -1/tick capped at -4 per round */
  purge();
  m = H.dispatch('roundStart', ctx({ round: 9, align: 'bad', rng: seq(0.10, 0.95) }));
  ok('sweats telegraphed', m.some(function (x) { return /SWEATS/.test(x.bannerText || ''); }));
  var tc = ctx({ round: 9, rng: seq() }), total = 0, n = 12;
  for (var i = 0; i < n; i++) {
    var mm = H.dispatch('tick', tc);
    for (var j = 0; j < mm.length; j++) if (mm[j].flag === 'sweats-tick') total += mm[j].hpDelta;
  }
  ok('sweats drain capped at -4/round despite ' + n + ' ticks', total === -4);

  /* 7. plague-economy separation */
  H.state.set('plague', 3);
  H.dispatch('roundStart', ctx({ round: 10, align: 'bad', rng: seq(0.10, 0.02) }));
  ok('bare plague economy key untouched', H.state.get('plague') === 3);

  var pass = checks.every(function (c) { return c.ok; });
  checks.forEach(function (c) { console.log((c.ok ? '  ok  ' : 'FAIL  ') + c.name); });
  console.log(pass ? '[pack-ailments] smoke: ALL PASS' : '[pack-ailments] smoke: FAILURES');
  return { ok: pass, checks: checks };
}

/* smoke helpers: poke the module-private round-record table / state reader */
function rtStore() { return rt; }
function curAilPublic() { return st.get(KEY_AIL) || null; }

root.IQ.PackAilments = { _smoke: _smoke, PACK_DEF: PACK_DEF, PLAGUE_QUARTER: PLAGUE_QUARTER, AILMENTS: AILMENTS };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { _smoke: _smoke, PACK_DEF: PACK_DEF, PLAGUE_QUARTER: PLAGUE_QUARTER, AILMENTS: AILMENTS };
}
})();
