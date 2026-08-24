/* ============================================================================
 * IQ.PackEvents — Event-chain packs (spec lines -> mechanics map)
 *
 * Spec "1. FOUR HORSEMEN CHAIN"   -> HORSEMEN CHAIN below: on a hostile round,
 *   a single rng draw < 1/15 starts the chain; it advances across 4 CONSECUTIVE
 *   hostile rounds, one modifier per stage:
 *     stage 1 CONQUEST : timerDelta -3 (round start)
 *     stage 2 WAR      : wrong answer costs extra hp -5 (onAnswer)
 *     stage 3 FAMINE   : scoreMul 0.7 (round start)
 *     stage 4 DEATH    : hpDelta -15 + dramatic banner sequence (round start)
 *   A good/neutral round breaks the chain. Surviving stage 4 (its interlude)
 *   grants the 'APOCALYPSE SURVIVED' badge (IQB_BADGES_V1) and arms DOUBLE
 *   HEAL (+30, matching the engine's baseline good-round healHp(30)) on the
 *   next good round.
 *
 * Spec "2. PESTILENCE/CURE ECONOMY" -> PLAGUE ECONOMY: pestilence draw on a
 *   hostile round adds one 'plague' stack persisted in Hooks.state ('plague').
 *   Every round start ticks -3 hp PER STACK (after any cure for that round).
 *   A good round cures exactly 1 stack + lollipop flair chip. Correct answers
 *   may drop a CURE pickup — engine enum maps it to {kind:'health',value:5}.
 *
 * Spec "3. AMPLIFIER PAIN DEEPENING" -> ALIGN CROSSINGS: on an align crossing
 *   detected at round start (align !== previous round's align):
 *     - crossing into hostile while the correct-streak was >= 4:
 *       extra hp -5 ("hot streak shattered").
 *     - crossing INTO good while cursed (plague > 0): purges 1 stack +
 *       lollipop flair.
 *
 * Spec "4. NUKE EVENT" -> NUKE: ultra-rare (same single-draw scheme, window
 *   sized so P(nuke) = 1/40 per hostile round), only when no other major event
 *   fired this round: siren overlay ~2s + oscillator siren, then EVERYONE'S hp
 *   is set to 1 — solo via exact hpDelta = 1 - ctx.hp; MP hosts additionally
 *   receive flag {nuke:true}. NEXT round is forced heaven/sanctum: calls
 *   IQ.Align.force('good') when Continuity v2's API exists, else writes the
 *   documented fallback Hooks.state keys forcedAlign='good'/forcedTheme=
 *   'sanctum', which Continuity v2 consumes (and deletes) at the next at().
 *
 * Reconciled with hooks.js (landed API):
 *   - Registered {id:'pack-events', always:true} — binds every world, refines
 *     on ctx.align inside handlers (align-refinement style).
 *   - Handlers receive full ctx {round,world,align,hp,score,streak,timerLen,
 *     optCount,rng,...}; ALL gameplay randomness flows through ctx.rng
 *     (host/client parity). The seeded mulberry32 fallback here exists ONLY
 *     for headless self-test when ctx.rng is absent.
 *   - Each handler returns AT MOST ONE modifier object; aggregation across
 *     packs is engine-side (never summed here).
 *   - Hooks.state is accessor-only: state.get(k)/set(k,v)/has(k)/del(k),
 *     wiped per run by beginRun. Keys used: plague, forcedAlign, forcedTheme
 *     + pe_* internals (pe_chainStage, pe_lastChainRound, pe_warActive,
 *     pe_prevAlign, pe_streak, pe_badgeOwed, pe_forcedByMe, pe_forcedRound).
 *   - flag is opaque pass-through; pickup.kind comes from the closed engine
 *     enum ('health'|'ammo'|'ring'|'coin'|'banana').
 *
 * Determinism: round-start events are mutually exclusive by design —
 * chain-continuation > chain-start (1/15) > nuke (1/40 window) > pestilence
 * (1/12 window) — a SINGLE ctx.rng() draw decides, keeping the stream stable
 * and replays exact regardless of branch taken.
 *
 * Gates: all motion behind localStorage IQB_MOTION, audio behind IQB_MUTED;
 * no fullscreen flash faster than 3 Hz or longer than 200 ms (siren vignette
 * pulses ~0.8 Hz); never touches answers, scoring state, or glyphs.
 * Nothing here ends a run except hp reaching 0 through ordinary deltas.
 *
 * SELF-TEST (chains persist state across rounds correctly):
 *   node -e "require('./pack-events.js')._selfTest()"
 * Simulates multi-round handler runs twice — once against the plain-object
 * fallback store and once against an accessor-backed Hooks.state shim (the
 * real hooks.js shape) — asserting every spec mechanic end to end.
 * ============================================================================*/
(function () {
'use strict';
var root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};

/* ---------- helpers (conventions shared with curse-pack.js) ---------- */

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hashSeed(str) {
  var h = 2166136261 >>> 0;
  var s = String(str == null ? '' : str);
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function motionOK() {
  try {
    var v = root.localStorage && root.localStorage.getItem('IQB_MOTION');
    return v == null ? true : JSON.parse(v) !== false;
  } catch (e) { return true; }
}
function muted() {
  try {
    var v = root.localStorage && root.localStorage.getItem('IQB_MUTED');
    return v != null && JSON.parse(v) === true;
  } catch (e) { return false; }
}

/* localStorage with in-memory fallback (node self-test has no storage) */
var memKV = {};
function kvGet(key) {
  try {
    if (root.localStorage && root.localStorage.getItem) return root.localStorage.getItem(key);
  } catch (e) {}
  return Object.prototype.hasOwnProperty.call(memKV, key) ? memKV[key] : null;
}
function kvSet(key, val) {
  try {
    if (root.localStorage && root.localStorage.setItem) { root.localStorage.setItem(key, val); return; }
  } catch (e) {}
  memKV[key] = val;
}

/* ---------- persistent state ----------
 * hooks.js: Hooks.state is ACCESSOR-ONLY (Map-backed, wiped per run).
 * When Hooks is absent (node self-test) we fall back to a plain object with
 * the same get/set/has/del surface. */
var LOCAL = {};
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
  },
  num: function (k, dflt) { var v = st.get(k); return typeof v === 'number' ? v : (dflt | 0); },
  bool: function (k) { return st.get(k) === true; }
};

function rngFor(ctx) {
  /* parity-critical: ctx.rng first; mulberry32 fallback ONLY headless */
  if (ctx && typeof ctx.rng === 'function') return ctx.rng;
  var seed = hashSeed(ctx && ctx.seed != null ? ctx.seed : 'iqb');
  var round = (ctx && ctx.round | 0) || 0;
  return mulberry32(seed ^ Math.imul(round + 1, 2654435761));
}
function hostile(align) { return align === 'bad' || align === 'chaotic'; }

/* ---------- presentation (DOM/CSS/oscillators only) ---------- */

var styleDone = false;
function ensureStyle() {
  if (styleDone || typeof document === 'undefined') return;
  styleDone = true;
  var stl = document.createElement('style');
  stl.id = 'iqb-pack-events-style';
  stl.textContent =
    '#iqb-pe-banner{position:fixed;top:64px;left:50%;transform:translateX(-50%);' +
    'z-index:72;padding:9px 24px;font-weight:900;letter-spacing:.18em;font-size:13px;' +
    'color:#fff;background:rgba(12,10,20,.86);border:1px solid #655;border-radius:999px;' +
    'box-shadow:0 4px 18px rgba(0,0,0,.5);pointer-events:none;text-align:center;' +
    'transition:opacity .18s ease}' +
    '.iqb-pe-rider{position:fixed;left:50%;top:38%;transform:translate(-50%,0);' +
    'z-index:73;font-weight:900;letter-spacing:.28em;font-size:22px;padding:12px 34px;' +
    'border-radius:12px;color:#000;pointer-events:none;box-shadow:0 6px 26px rgba(0,0,0,.6)}' +
    '@keyframes iqbPeSiren{0%,100%{opacity:.12}50%{opacity:.42}}' +
    '#iqb-pe-siren{position:fixed;inset:0;z-index:74;pointer-events:none;' +
    'background:radial-gradient(ellipse at center,rgba(255,30,30,0) 42%,rgba(255,30,30,.85) 100%)}';
  var head = document.head || document.getElementsByTagName('head')[0];
  head.appendChild(stl);
}

var bannerEl = null, bannerTimer = null;
function showBanner(text, ms) {
  if (typeof document === 'undefined' || !text) return;
  ensureStyle();
  if (!bannerEl) {
    bannerEl = document.createElement('div');
    bannerEl.id = 'iqb-pe-banner';
    (document.body || document.documentElement).appendChild(bannerEl);
  }
  bannerEl.textContent = text;
  bannerEl.style.opacity = '1';
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(function () { if (bannerEl) bannerEl.style.opacity = '0'; }, ms || 1500);
}

/* death stage: four staggered rider banners (parody riders, curse-pack style) */
var RIDERS = [
  ['CONQUEST', '#f2c14e', 'A CROWN. A BOW. THE TIMER BLEEDS.'],
  ['WAR', '#e2574c', 'THE WRONG ANSWER DRAWS STEEL.'],
  ['FAMINE', '#8fbf6a', 'YOUR LAURELS STARVE.'],
  ['DEATH', '#b39ddb', 'AND THE PALE HORSE WAS LAST.']
];
function deathSequence(motion) {
  if (!motion || typeof document === 'undefined') { showBanner('💀 DEATH RIDES — HP -15', 1700); return; }
  for (var i = 0; i < RIDERS.length; i++) (function (i) {
    setTimeout(function () {
      var d = document.createElement('div');
      d.className = 'iqb-pe-rider';
      d.style.background = RIDERS[i][1];
      d.textContent = RIDERS[i][0] + ' — ' + RIDERS[i][2];
      (document.body || document.documentElement).appendChild(d);
      setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 900);
    }, i * 520);
  })(i);
}

/* nuke: slow-pulsing red vignette (~0.8 Hz, well under the 3 Hz cap) + text */
function sirenOverlay(ms) {
  showBanner('☢ NUKE — EVERYONE LEFT AT 1 HP', ms);
  if (!motionOK() || typeof document === 'undefined') return;
  ensureStyle();
  var el = document.createElement('div');
  el.id = 'iqb-pe-siren';
  el.style.animation = 'iqbPeSiren ' + Math.round(ms / 3) + 'ms ease-in-out 3';
  (document.body || document.documentElement).appendChild(el);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, ms + 60);
}

function blip(kind) {
  if (muted()) return;
  try {
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    if (!blip.ctx) blip.ctx = new AC();
    var ac = blip.ctx;
    if (ac.state === 'suspended' && ac.resume) ac.resume();
    var t0 = ac.currentTime, o = ac.createOscillator(), g = ac.createGain(), dur;
    if (kind === 'siren') {           /* rising/falling two-tone sweeps */
      o.type = 'square'; dur = 1.6;
      o.frequency.setValueAtTime(420, t0);
      o.frequency.linearRampToValueAtTime(880, t0 + 0.5);
      o.frequency.linearRampToValueAtTime(420, t0 + 1.0);
      o.frequency.linearRampToValueAtTime(880, t0 + 1.5);
      g.gain.setValueAtTime(0.05, t0);
    } else if (kind === 'death') {
      o.type = 'sawtooth'; dur = 0.6;
      o.frequency.setValueAtTime(110, t0);
      o.frequency.exponentialRampToValueAtTime(41, t0 + 0.55);
      g.gain.setValueAtTime(0.09, t0);
    } else {                          /* 'cure' soft chime */
      o.type = 'sine'; dur = 0.3;
      o.frequency.setValueAtTime(523, t0);
      o.frequency.setValueAtTime(659, t0 + 0.12);
      g.gain.setValueAtTime(0.06, t0);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  } catch (e) { /* best-effort */ }
}

/* lollipop flair chip — same IQB_FLAIR_V1 strip curse-pack uses */
function grantLollipop() {
  var arr = [];
  try {
    var raw = kvGet('IQB_FLAIR_V1');
    arr = raw ? JSON.parse(raw) : [];
  } catch (e) { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  arr.push('🍭');
  while (arr.length > 24) arr.shift();
  kvSet('IQB_FLAIR_V1', JSON.stringify(arr));
  return '🍭';
}

/* apocalypse badge strip */
function grantBadge(label, icon) {
  var arr = [];
  try {
    var raw = kvGet('IQB_BADGES_V1');
    arr = raw ? JSON.parse(raw) : [];
  } catch (e) { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  arr.push({ id: 'apocalypse_survived', label: label, icon: icon, t: Date.now() });
  kvSet('IQB_BADGES_V1', JSON.stringify(arr));
}

/* ---------- nuke forcing (Continuity v2 contract) ---------- */

function forceGoodNextRound(round) {
  try {
    if (root.IQ && root.IQ.Align && typeof root.IQ.Align.force === 'function') {
      root.IQ.Align.force('good');
      st.set('pe_forcedByMe', false);
      return 'align.force';
    }
  } catch (e) {}
  /* documented fallback: Continuity v2 consumes AND deletes these keys at the
   * next at(); our own cleanup below is belt-and-braces only */
  st.set('forcedAlign', 'good');
  st.set('forcedTheme', 'sanctum');
  st.set('pe_forcedByMe', true);
  st.set('pe_forcedRound', round);
  return 'state.fallback';
}
function consumeForcing(round) {
  if (st.bool('pe_forcedByMe') && round > (st.num('pe_forcedRound', 0))) {
    st.del('forcedAlign'); st.del('forcedTheme');
    st.set('pe_forcedByMe', false);
  }
}

/* ---------- probability windows (single-draw scheme) ----------
   r = ctx.rng() ONCE per hostile round start:
     r < 1/15                          -> horsemen chain START
     r < W_CHAIN + 1/40                -> NUKE            (P = 1/40)
     r < W_CHAIN + W_NUKE + 1/12       -> PESTILENCE stack
--------------------------------------------------------------- */
var W_CHAIN = 1 / 15, W_NUKE = 1 / 40, W_PEST = 1 / 12;

/* ---------- handlers ---------- */

function onRoundStart(ctx) {
  ctx = ctx || {};
  var round = ctx.round | 0;
  var align = ctx.align || null;
  var mods = { hpDelta: 0 };
  var banners = [];
  var motion = motionOK();

  consumeForcing(round);

  /* ---- spec 3: amplifier pain deepening on align crossings ---- */
  var prevAlign = st.get('pe_prevAlign');
  var crossed = !!align && !!prevAlign && align !== prevAlign && round > 1;
  if (crossed && hostile(align)) {
    var streakNow = typeof ctx.streak === 'number' ? ctx.streak : st.num('pe_streak', 0);
    if (streakNow >= 4) {
      mods.hpDelta -= 5;
      banners.push('💥 HOT STREAK SHATTERED BY THE CROSSING — HP -5');
    }
  }
  if (crossed && align === 'good' && st.num('plague', 0) > 0) {
    st.set('plague', st.num('plague', 0) - 1);   /* purge exactly one stack */
    grantLollipop();
    blip('cure');
    banners.push('🍭 LIGHT PURGES A PLAGUE (' + st.num('plague', 0) + ' left)');
  }

  /* ---- spec 2: EVERY good round cures one plague stack + lollipop flair.
   * Spec 3's crossing purge above is additive on the round you cross into
   * light while cursed (returning to good is doubly cleansing). ---- */
  if (align === 'good' && st.num('plague', 0) > 0) {
    st.set('plague', st.num('plague', 0) - 1);
    grantLollipop();
    blip('cure');
    banners.push('🍭 THE GOOD ROUND CURES A PLAGUE (' + st.num('plague', 0) + ' left)');
  }

  /* ---- spec 1: horsemen chain ---- */
  var chainEvent = false;
  var stage = st.num('pe_chainStage', 0);
  var consecutive = round === st.num('pe_lastChainRound', -99) + 1;

  if (!hostile(align)) {
    if (stage > 0 && stage < 4) banners.push('🐴 …THE RIDERS LOSE INTEREST'); /* chain broken */
    if (stage !== 4) { st.set('pe_chainStage', 0); st.set('pe_lastChainRound', -99); }
    stage = st.num('pe_chainStage', 0);
  } else {
    var roll = null;
    if (stage > 0 && stage < 4) {
      if (consecutive) {
        stage += 1;
        st.set('pe_chainStage', stage);            /* advance to next rider */
        st.set('pe_lastChainRound', round);
        chainEvent = true;
      } else {
        st.set('pe_chainStage', 0);                /* stale/gapped chain: reset */
        st.set('pe_lastChainRound', -99);
        stage = 0;
      }
    }
    if (!(stage > 0)) {
      roll = rngFor(ctx)();
      if (roll < W_CHAIN) {                        /* spec: rare ~1/15 rounds */
        stage = 1;
        st.set('pe_chainStage', 1);
        st.set('pe_lastChainRound', round);
        chainEvent = true;
      }
    }
    if (stage === 1) {
      mods.timerDelta = -3;                      /* conquest: timerDelta -3 */
      banners.push('🐴 CONQUEST RIDES FIRST — TIMER -3');
      blip('curse');
    } else if (stage === 2) {
      st.set('pe_warActive', true);              /* war: extra -5 in onAnswer */
      banners.push('⚔ WAR RIDES — WRONG ANSWERS DRAW BLOOD (-5)');
      blip('curse');
    } else if (stage === 3) {
      mods.scoreMul = 0.7;                       /* famine: scoreMul 0.7 */
      banners.push('🌾 FAMINE RIDES — SCORE WITHERS ×0.7');
      blip('curse');
    } else if (stage === 4) {
      mods.hpDelta -= 15;                        /* death: hpDelta -15 */
      banners.push('💀 DEATH RIDES LAST — HP -15');
      blip('death');
      deathSequence(motion);
    }
  }
  /* ---- spec 2 + 4: pestilence economy & nuke (mutually exclusive draws) -- */
  var nukeFired = false;
  if (hostile(align) && !chainEvent) {
    var r = roll != null ? roll : rngFor(ctx)();
    if (r >= W_CHAIN && r < W_CHAIN + W_NUKE) {
      /* spec 4: NUKE — everyone's hp set to 1 */
      nukeFired = true;
      if (typeof ctx.hp === 'number') mods.hpDelta += 1 - Math.max(1, ctx.hp | 0);
      mods.flag = { nuke: true };                /* MP note for the host */
      mods.sfx = 'siren';
      mods.bannerText = '☢ NUKE — EVERYONE LEFT AT 1 HP';
      sirenOverlay(2000);
      blip('siren');
      var how = forceGoodNextRound(round);
      banners.push('☢ NEXT ROUND FORCED TO SANCTUM (' + how + ')');
    } else if (r >= W_CHAIN + W_NUKE && r < W_CHAIN + W_NUKE + W_PEST) {
      /* spec 2: pestilence applies one stacking plague counter */
      var p = st.num('plague', 0) + 1;
      st.set('plague', p);
      banners.push('🪰 PESTILENCE — PLAGUE DEEPENS (×' + p + ')');
      blip('curse');
    }
  }

  /* ---- spec 2: plague tick — -3 hp per stack, AFTER any cure this round -- */
  var plague = st.num('plague', 0);
  if (plague > 0 && !nukeFired) {
    mods.hpDelta -= 3 * plague;
    banners.push('🪨 PLAGUE BITES ×' + plague + ' — HP -' + 3 * plague);
  }

  /* ---- spec 1 payoff: double heal on the next good round ---- */
  if (align === 'good' && st.bool('pe_badgeOwed')) {
    st.set('pe_badgeOwed', false);
    mods.hpDelta += 30;                          /* good round heals 30; double it */
    banners.push('🏆 APOCALYPSE SURVIVED — THE MEND IS DOUBLED (+30)');
  }

  /* remember crossing source for next round's amplifier check */
  st.set('pe_prevAlign', align);

  if (banners.length) {
    showBanner(banners[0], 1600);
    for (var b = 1; b < banners.length; b++) (function (txt, delay) {
      setTimeout(function () { showBanner(txt, 1400); }, delay);
    })(banners[b], b * 700);
  }

  if (mods.hpDelta === 0) delete mods.hpDelta;
  return (mods.hpDelta != null || mods.timerDelta != null || mods.scoreMul != null ||
          mods.flag || mods.sfx || mods.bannerText) ? mods : null;
}

function onAnswer(ctx) {
  ctx = ctx || {};
  var correct = ctx.correct === true;
  /* maintain streak fallback (engine streak preferred when present) */
  if (correct) {
    st.set('pe_streak', typeof ctx.streak === 'number' ? ctx.streak : st.num('pe_streak', 0) + 1);
  } else {
    st.set('pe_streak', 0);
  }

  /* spec 1 stage 2: WAR punishes wrong answers */
  if (!correct && st.bool('pe_warActive')) {
    st.set('pe_warActive', false);               /* once per war round */
    return { hpDelta: -5, bannerText: '⚔ WAR WOUNDS — WRONG ANSWER COSTS MORE' };
  }
  return null;
}

function onReveal(ctx) {
  ctx = ctx || {};
  /* spec 2: correct answers can drop a CURE pickup when plague is pending.
   * Engine pickup enum has no 'cure': mapped to health value 5 (a small mend
   * rides along with the purge flavor). */
  if (ctx.correct === true && st.num('plague', 0) > 0 && rngFor(ctx)() < 1 / 8) {
    return {
      pickup: { kind: 'health', value: 5 },
      bannerText: '💊 A CURE VIAL GLINTS — PURGES A PLAGUE WHEN THE LIGHT COMES'
    };
  }
  return null;
}

function onInterlude(ctx) {
  ctx = ctx || {};
  /* spec 1 completion: survived the death-stage round */
  if (st.num('pe_chainStage', 0) === 4) {
    var alive = typeof ctx.hp !== 'number' || ctx.hp > 0;
    st.set('pe_chainStage', 0);
    st.set('pe_lastChainRound', -99);
    st.set('pe_warActive', false);
    if (alive) {
      st.set('pe_badgeOwed', true);              /* next good round heals double */
      grantBadge('APOCALYPSE SURVIVED', '🐴');
      showBanner('🏆 APOCALYPSE SURVIVED', 2200);
      blip('cure');
      return { flag: { apocalypseSurvived: true } };
    }
  }
  return null;
}

/* ---------- registration ---------- */

/* always:true (binds every world; align refined inside handlers) — hooks.js
 * rejects empty worlds without it. Re-add with same id replaces cleanly. */
var REG = {
  id: 'pack-events',
  always: true,
  weight: 1,
  handlers: {
    onRoundStart: onRoundStart,
    onAnswer: onAnswer,
    onReveal: onReveal,
    onInterlude: onInterlude
  }
};

var registered = false, tries = 0;
function tryRegister() {
  if (registered || tries++ > 20) return registered;
  var H = root.IQ && root.IQ.Hooks;
  if (H && typeof H.add === 'function') {
    try { H.add(REG); registered = true; } catch (e) { /* retry */ }
  }
  return registered;
}
tryRegister();
if (!registered && typeof setInterval === 'function') {
  var iv = setInterval(function () {
    if (tryRegister() || tries > 20) clearInterval(iv);
  }, 250);
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('DOMContentLoaded', function () { tryRegister(); });
}

/* ---------- public API ---------- */

var PackEvents = {
  register: tryRegister,
  plagueCount: function () { return st.num('plague', 0); },
  addPlague: function (n) {
    var p = Math.max(0, st.num('plague', 0) + (n == null ? 1 : n));
    st.set('plague', p); return p;
  },
  useCure: function () {
    if (st.num('plague', 0) <= 0) return false;
    st.set('plague', st.num('plague', 0) - 1);
    grantLollipop();
    blip('cure');
    showBanner('💊 CURE ADMINISTERED (' + st.num('plague', 0) + ' left)', 1500);
    return true;
  },
  badges: function () {
    try { var a = JSON.parse(kvGet('IQB_BADGES_V1')); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  },

  /* Self-test: simulated multi-round runs asserting every spec mechanic.
   * Runs TWICE: against the plain fallback store, then against an
   * accessor-backed Hooks.state shim identical to landed hooks.js. */
  _selfTest: function () {
    var failures = 0;
    function ok(name, cond, checks) {
      checks.push((cond ? 'PASS ' : 'FAIL ') + name);
      if (!cond) failures++;
    }

    function scenario(label, backend) {
      var checks = [];
      /* isolate state: point the module at a chosen backend */
      var savedHooks = root.IQ.Hooks;
      var savedLocal = JSON.parse(JSON.stringify(LOCAL));
      for (var k in LOCAL) delete LOCAL[k];
      root.IQ.Hooks = backend || null;   /* null -> LOCAL fallback */

      /* fixed stream helper: each call shifts to the next value */
      function seq(vals) { var i = 0; return function () { return vals[Math.min(i++, vals.length - 1)]; }; }
      function resetSim() {
        st.del('plague'); st.del('forcedAlign'); st.del('forcedTheme');
        st.del('pe_chainStage'); st.del('pe_lastChainRound'); st.del('pe_warActive');
        st.del('pe_prevAlign'); st.del('pe_streak'); st.del('pe_badgeOwed');
        st.del('pe_forcedByMe'); st.del('pe_forcedRound');
      }

      /* --- spec 1: chain start needs r<1/15 --- */
      resetSim();
      var m = onRoundStart({ round: 3, align: 'bad', rng: seq([0.01]) });
      ok('conquest starts chain: timerDelta -3', m && m.timerDelta === -3, checks);
      ok('chain stage persisted across rounds', st.num('pe_chainStage', 0) === 1 &&
        st.num('pe_lastChainRound', -99) === 3, checks);

      /* --- spec 1 stage 2: war --- */
      m = onRoundStart({ round: 4, align: 'bad', rng: seq([]) });
      ok('war round carries no round-start delta', m === null, checks);
      ok('war armed', st.get('pe_warActive') === true, checks);
      var w1 = onAnswer({ correct: false, streak: 0 });
      ok('war wrong answer: hp -5', w1 && w1.hpDelta === -5, checks);
      ok('war strikes once per round', onAnswer({ correct: false }) === null, checks);

      /* --- spec 1 stage 3: famine --- */
      m = onRoundStart({ round: 5, align: 'bad', rng: seq([]) });
      ok('famine: scoreMul 0.7', m && m.scoreMul === 0.7, checks);

      /* --- spec 1 stage 4: death + survival --- */
      m = onRoundStart({ round: 6, align: 'bad', rng: seq([]) });
      ok('death: hpDelta -15', m && m.hpDelta === -15, checks);
      var il = onInterlude({ hp: 40 });
      ok('survival awards badge flag', il && il.flag && il.flag.apocalypseSurvived === true, checks);
      ok('double heal armed', st.get('pe_badgeOwed') === true, checks);
      ok('badges recorded', (function () {
        var b = PackEvents.badges();
        return b.length && b[b.length - 1].id === 'apocalypse_survived';
      })(), checks);
      ok('chain cleared after completion', st.num('pe_chainStage', 0) === 0, checks);

      /* --- spec 1 payoff: next good round heals double --- */
      m = onRoundStart({ round: 7, align: 'good', rng: seq([]) });
      ok('next good round: double heal +30', m && m.hpDelta === 30, checks);
      ok('double heal consumed', st.get('pe_badgeOwed') === false, checks);

      /* --- chain broken by a good round mid-chain --- */
      onRoundStart({ round: 8, align: 'bad', rng: seq([0.001]) });   /* conquest again */
      m = onRoundStart({ round: 9, align: 'good', rng: seq([]) });
      ok('good round resets chain', st.num('pe_chainStage', 0) === 0, checks);

      /* --- non-consecutive hostile gap also resets --- */
      onRoundStart({ round: 10, align: 'bad', rng: seq([0.001]) });
      m = onRoundStart({ round: 14, align: 'chaotic', rng: seq([]) });
      ok('gap in hostile rounds resets stale chain, no rider effect',
        st.num('pe_chainStage', 0) === 0 && m === null, checks);

      /* --- spec 2: pestilence stacking + tick + cure-on-good --- */
      resetSim();
      m = onRoundStart({ round: 10, align: 'chaotic', rng: seq([W_CHAIN + W_NUKE + 0.001]) });
      ok('pestilence adds stack 1', st.num('plague', 0) === 1, checks);
      onRoundStart({ round: 11, align: 'chaotic', rng: seq([W_CHAIN + W_NUKE + 0.002]) });
      ok('pestilence stacks to 2', st.num('plague', 0) === 2, checks);
      m = onRoundStart({ round: 12, align: 'bad', rng: seq([]) });
      ok('plague tick -6 (2 stacks)', m && m.hpDelta === -6, checks);
      /* crossing INTO good while cursed: crossing purge + good-round cure
       * are additive per spec lines 2 and 3 -> both stacks gone */
      m = onRoundStart({ round: 13, align: 'good', rng: seq([]) });
      ok('crossing into good doubly cures, no tick',
        st.num('plague', 0) === 0 && (m === null || m.hpDelta == null), checks);
      /* rebuild without crossings: plain good-round cure only */
      st.set('plague', 2);
      st.set('pe_prevAlign', 'good');
      m = onRoundStart({ round: 14, align: 'good', rng: seq([]) });
      ok('good round cures 1 stack THEN ticks -3',
        m && m.hpDelta === -3 && st.num('plague', 0) === 1, checks);
      m = onRoundStart({ round: 15, align: 'good', rng: seq([]) });
      ok('good round fully cures, no tick', m === null, checks);

      /* --- spec 2: cure pickup drops only while plagued + correct --- */
      st.set('plague', 2);
      m = onReveal({ correct: true, rng: seq([0.01]) });
      ok('cure pickup maps to health enum', m && m.pickup && m.pickup.kind === 'health' &&
        m.pickup.value === 5, checks);
      m = onReveal({ correct: false, rng: seq([0.01]) });
      ok('no pickup on wrong answer', m === null, checks);

      /* --- spec 3: amplifier pain deepening --- */
      resetSim();
      st.set('pe_prevAlign', 'good'); st.set('pe_streak', 5);
      m = onRoundStart({ round: 15, align: 'bad', rng: seq([0.999]) });
      ok('hot streak >=4 shatters: -5', m && m.hpDelta === -5, checks);
      st.set('pe_prevAlign', 'bad'); st.set('pe_streak', 2); st.set('plague', 1);
      m = onRoundStart({ round: 16, align: 'good', rng: seq([]) });
      ok('crossing into good purges a stack', st.num('plague', 0) === 0, checks);
      st.set('pe_prevAlign', 'good'); st.set('pe_streak', 3);
      m = onRoundStart({ round: 17, align: 'bad', rng: seq([0.999]) });
      ok('streak <4 crossing: no extra pain', m === null, checks);

      /* --- spec 4: nuke --- */
      resetSim();
      st.set('pe_prevAlign', 'bad'); st.set('plague', 0);
      m = onRoundStart({ round: 17, align: 'bad', hp: 50, rng: seq([W_CHAIN + 0.001]) });
      ok('nuke sets hp 50 -> delta -49 (everyone at 1)', m && m.hpDelta === -49, checks);
      ok('nuke flags host', m && m.flag && m.flag.nuke === true, checks);
      ok('nuke sfx hint', m && m.sfx === 'siren', checks);
      ok('nuke forces next round good (fallback)', st.get('forcedAlign') === 'good' &&
        st.get('forcedTheme') === 'sanctum', checks);
      m = onRoundStart({ round: 18, align: 'good', rng: seq([]) });
      ok('fallback forcing cleared after next round',
        st.get('forcedAlign') === undefined && st.get('pe_forcedByMe') === false, checks);

      /* --- exclusivity: one draw cannot fire two major events --- */
      resetSim();
      m = onRoundStart({ round: 20, align: 'bad', hp: 50, rng: seq([0.005]) });
      ok('chain-start draw fires no nuke/plague', m && m.timerDelta === -3 &&
        !m.flag && st.num('plague', 0) === 0, checks);

      root.IQ.Hooks = savedHooks;
      for (var k2 in LOCAL) delete LOCAL[k2];
      Object.assign(LOCAL, savedLocal);

      return { label: label, pass: failures === 0, checks: checks.slice() };
    }

    /* backend A: plain-object fallback */
    var a = scenario('fallback-store', null);
    /* backend B: accessor-backed shim identical to hooks.js Hooks.state */
    var map = new Map();
    var shimState = {
      get: function (k) { return map.get(String(k)); },
      set: function (k, v) { map.set(String(k), v); return v; },
      has: function (k) { return map.has(String(k)); },
      del: function (k) { return map.delete(String(k)); }
    };
    var b = scenario('accessor-shim', { state: shimState });

    var report = {
      pass: a.pass && b.pass,
      scenarios: [a.label + ': ' + (a.pass ? 'PASS' : 'FAIL'),
                  b.label + ': ' + (b.pass ? 'PASS' : 'FAIL')],
      checks: a.checks.concat(b.checks)
    };
    if (typeof console !== 'undefined') {
      console.log(report.pass ? 'SELF-TEST PASS' : 'SELF-TEST FAIL', report.scenarios.join(' | '));
    }
    if (!report.pass) throw new Error('pack-events self-test failed:\n' + report.checks.join('\n'));
    return report;
  }
};

root.IQ.PackEvents = PackEvents;
if (typeof module !== 'undefined' && module.exports) module.exports = PackEvents;
})();
