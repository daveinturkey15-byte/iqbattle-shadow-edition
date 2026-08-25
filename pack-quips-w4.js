/* ============================================================================
 * pack-quips-w4.js — QUIPS-W4 · event-reactive Shadow VOICE beats (W4)
 * ============================================================================
 *
 * FILE PURPOSE
 *   Six one-shot Shadow voice reactions to W4 story beats, routed through the
 *   existing dialogue rails (bannerText modifiers preferred; IQ.DemonSay.say /
 *   ctx.say used sparingly for beats whose banner slot belongs to another
 *   pack). Pure observer: NEVER mutates scoring, hp, timers, or options.
 *
 *   Triggers (each MAX ONCE PER RUN unless a fresh run begins — Hooks.state is
 *   a per-match store cleared by beginRun, so "once per run" falls out of the
 *   store's lifecycle; pools cycle by ctx.rng draw, not across runs):
 *
 *     1. dragon-remembers — CORRECT answer after a dragon-burn round
 *        (a round where pack-cavern armed 'pack-cavern:dragonRound' and the
 *        answer came back WRONG). Detected locally: onRoundStart snapshots
 *        whether THIS round is a dragon round (order-independent vs cavern's
 *        own onReveal cleanup), onReveal marks the burn, next correct
 *        onAnswer speaks. Channel: bannerText (rare, collision-free).
 *        'THE DRAGON REMEMBERS THAT.'
 *     2. critter-first — first species ever banked in pack-popcult-b's
 *        'gs:critters' bitmask this run. Channel: say() — popcult-b owns the
 *        CRITTER CAUGHT banner slot; we must not clobber it.
 *     3. shrine-complete — 'gs:critters' reaches 0b111111 (63). Channel: say()
 *        (popcult-b owns 'SHRINE COMPLETE · ...'). If a lagging detection sees
 *        0 -> 63 in one hop, only the shrine line fires (bigger beat wins).
 *     4. nuke-survived — round STARTED above 50 hp and REVEALS at <= 3 hp.
 *        Tracked locally (qw4:hpHigh); no dependency on pack-events internals.
 *        Channel: say().
 *     5. sanctuary-first — first good/heaven round of the run (same predicate
 *        as sanctuary.js isSanctuaryCtx). Channel: bannerText — sanctuary.js
 *        emits no continuation banner on a run's FIRST refuge, so the slot is
 *        free. 'IT NEVER TRULY LEFT YOU.'
 *     6. layer-five — IQ.HellHeaven.layer() >= 5 at round start. Channel:
 *        say() — hellheaven.js owns the 'LAYER n · NAME' banner.
 *        'THE FLOOR HAS OPINIONS NOW.'
 *
 *   Each mandated line is variant[0] of a fixed 3-line pool; variants are
 *   British-menacing-witty, <= 80 chars, chosen via ctx.rng (deterministic
 *   seeded stream; missing rng falls back to index 0).
 *
 *   Speech budget (research/chaos-balance.md §5 spirit): at most three say()
 *   calls per run, all rare one-shots; everything else rides bannerText.
 *   DemonSay's own throttle/dedupe remains the final arbiter.
 *
 * REGISTRATION SHAPE
 *   IQ.Hooks.add({ id:'quips-w4', always:true, weight:1,
 *                  handlers:{ onRoundStart, onAnswer, onReveal } })
 *   Direct add when hooks.js is present, else queued on IQ.__hooksPending
 *   (drained by hooks.js late-load reconciliation).
 *
 * CONSUMES: IQ.Hooks.state, ctx.rng; reads (never writes) 'pack-cavern:
 *   dragonRound' and 'gs:critters'; reads IQ.HellHeaven.layer().
  set: function (k, v) { m.set(String(k), v); return v; },
 * DETERMINISM: zero Math.random()/Date.now()/performance.now(). Variant index
 *   derives solely from ctx.rng.
 * FAIRNESS RAILS: parity — inert on rounds 1-2 (C8); cosmetic only (no
 *   points/hpDelta/scoreMul/timer/disableOptionIdx fields ever emitted);
 *   host-authoritative verdict math untouched; never inspects correctIdx.
 *
 * SELF TEST
 *   node --check pack-quips-w4.js
 *   node research/smoke-quips.js   (drives the real hooks.js; exit 0 = pass)
 *   Embedded selfTest() mirrors the pack-cavern style for standalone runs.
 * ============================================================================*/
(function () {
'use strict';
const root = typeof window !== 'undefined' ? window : globalThis;

const ID = 'quips-w4';
const PFX = ID + ':';
const CAVERN_DRAGON_KEY = 'pack-cavern:dragonRound';   /* exact key, pack-cavern.js */
const CRITTERS_KEY = 'gs:critters';                    /* exact key, pack-popcult-b.js */
const ALL_SIX = (1 << 6) - 1;                          /* 63 — shrine complete */

/* ---- guarded per-run state resolver (real store wins when hooks.js lands) */
let __stateShim = null;
function store() {
 try {
  const H = root.IQ && root.IQ.Hooks;
  if (H && H.state && typeof H.state.get === 'function') return H.state;
 } catch (_) {}
 if (!__stateShim) __stateShim = new Map();
 const m = __stateShim;
 return {
  get: function (k) { return m.get(String(k)); },
  set: function (k, v) { m.set(String(k), v); return v; },
  has: function (k) { return m.has(String(k)); },
  del: function (k) { m.delete(String(k)); }
 };
}

/* ---- shared guards ------------------------------------------------------- */
/* Parity rail: rounds 1-2 stay baseline clone. */
function gated(ctx) {
 return !(ctx && (ctx.round | 0) > 2);
}
function isCorrect(ctx) {
 if (ctx && ctx.res && typeof ctx.res.correct === 'boolean') return ctx.res.correct === true;
 return !!(ctx && ctx.correct === true);
}

/* ---- quip pools (variant[0] is the mandated line; all <= 80 chars) ------- */
const POOLS = {
 'dragon-remembers': [
  'THE DRAGON REMEMBERS THAT.',
  'THE DRAGON TELLS ME YOU SINGE NICELY.',
  'SCORCHED, YET STILL SWATTING. ADMIRABLE.'
 ],
 'critter-first': [
  'OH. YOU ADOPTED ONE.',
  'A SMALL BEAST RIDES HOME WITH YOU.',
  'IT FOLLOWED YOU BACK. HOW EMBARRASSING.'
 ],
 'shrine-complete': [
  'ALL SIX. THE SHRINE WEEPS FOR ITS PETS.',
  'THE FULL SET. DO FRAME THEM.',
  'SIX LITTLE SOULS, ON MANTLEPIECE DUTY.'
 ],
 'nuke-survived': [
  'YOU SURVIVED THE UNTHINKABLE. HOW PATRIOTIC.',
  'THE FLASH WENT RIGHT PAST YOU. RUDE OF IT.',
  'ATOM-GRADE LUCK. SPEND IT WISELY.'
 ],
 'sanctuary-first': [
  'IT NEVER TRULY LEFT YOU.',
  'THE LIGHT KEPT YOUR SEAT WARM.',
  'HOME IS WHERE THE HYMNS ARE.'
 ],
 'layer-five': [
  'THE FLOOR HAS OPINIONS NOW.',
  'THIS DEEP, EVEN THE STAIRS JUDGE YOU.',
  'DEEPER THAN REGRET ALREADY.'
 ]
};

/* ---- speech plumbing ----------------------------------------------------- */
function pickVariant(name, ctx) {
 const pool = POOLS[name];
 let i = 0;
 try {
  if (typeof ctx.rng === 'function') i = Math.floor(ctx.rng() * pool.length) % pool.length;
 } catch (_) { i = 0; }
 if (!(i >= 0) || i >= pool.length) i = 0;      /* NaN / out-of-range guard */
 return pool[i];
}

/* bannerText preferred; say() reserved for slots owned by other packs.
 * DemonSay first (budget arbitration lives there), ctx.say as fallback. */
function speak(ctx, text) {
 try {
  const DS = root.IQ && root.IQ.DemonSay;
  if (DS && typeof DS.say === 'function') { DS.say(text, { priority: 'ambient' }); return true; }
 } catch (_) {}
 try {
  if (ctx && typeof ctx.say === 'function') { ctx.say(text); return true; }
 } catch (_) {}
 return false;
}

function fired(name) { return store().has(PFX + 'fired:' + name); }
function markFired(name) { store().set(PFX + 'fired:' + name, 1); }

/* Fire a once-per-run trigger. Returns the bannerText modifier when the
 * trigger rides bannerText, or null when it spoke through say(). */
function fireOnce(name, ctx, viaBanner) {
 if (fired(name)) return null;
 markFired(name);
 const text = pickVariant(name, ctx);
 if (viaBanner) return { bannerText: text };
 speak(ctx, text);
 return null;
}

/* ---- handlers ------------------------------------------------------------ */
function onRoundStart(ctx) {
 try {
  if (gated(ctx)) return undefined;
  const s = store();

  /* snapshot: is THIS round a cavern dragon round? (cavern deletes its key
   * in its own onReveal; snapshotting here makes us order-independent) */
  if (s.get(CAVERN_DRAGON_KEY) === (ctx.round | 0)) s.set(PFX + 'dragonHere', 1);
  else s.del(PFX + 'dragonHere');

  /* nuke-survived arming: started the round above 50 hp */
  if (typeof ctx.hp === 'number' && ctx.hp > 50) s.set(PFX + 'hpHigh', 1);
  else s.del(PFX + 'hpHigh');

  /* layer-five (say channel — hellheaven owns the LAYER banner) */
  try {
   const HH = root.IQ && root.IQ.HellHeaven;
   if (HH && typeof HH.layer === 'function' && HH.layer() >= 5) {
    fireOnce('layer-five', ctx, false);
   }
  } catch (_) {}

  /* sanctuary-first (bannerText — free slot on a run's FIRST refuge) */
  if (ctx.world === 'heaven' || ctx.align === 'good') {
   return fireOnce('sanctuary-first', ctx, true) || undefined;
  }
  return undefined;
 } catch (e) {
  try { console.warn('[' + ID + '] onRoundStart swallowed:', e && e.message || e); } catch (_) {}
  return undefined;
 }
}

function onAnswer(ctx) {
 try {
  if (gated(ctx)) return undefined;
  const s = store();

  /* dragon-remembers: first correct answer after a marked burn */
  if (isCorrect(ctx) && s.has(PFX + 'burned')) {
   s.del(PFX + 'burned');
   return fireOnce('dragon-remembers', ctx, true) || undefined;
  }

  /* critter/shrine detection: diff 'gs:critters' against our last-seen mask.
   * Works whichever way hook dispatch orders us vs pack-popcult-b. */
  const cur = s.get(CRITTERS_KEY) | 0;
  const last = s.get(PFX + 'critterSeen') | 0;
  if (cur !== last) {
   s.set(PFX + 'critterSeen', cur);
   if (cur === ALL_SIX && last !== ALL_SIX) {
    fireOnce('shrine-complete', ctx, false);
    markFired('critter-first');          /* 0 -> 63 hop: shrine beat subsumes */
   } else if (last === 0 && cur > 0) {
    fireOnce('critter-first', ctx, false);
   }
  }
  return undefined;
 } catch (e) {
  try { console.warn('[' + ID + '] onAnswer swallowed:', e && e.message || e); } catch (_) {}
  return undefined;
 }
}

function onReveal(ctx) {
 try {
  if (gated(ctx)) return undefined;
  const s = store();

  /* mark the burn: wrong answer inside a snapshotted dragon round */
  if (s.has(PFX + 'dragonHere')) {
   s.del(PFX + 'dragonHere');
   if (ctx && ctx.res && ctx.res.correct === false) s.set(PFX + 'burned', 1);
  }

  /* nuke-survived: round started >50 hp, reveals at <=3 hp */
  if (s.has(PFX + 'hpHigh')) {
   s.del(PFX + 'hpHigh');
   if (typeof ctx.hp === 'number' && ctx.hp <= 3) fireOnce('nuke-survived', ctx, false);
  }
  return undefined;
 } catch (e) {
  try { console.warn('[' + ID + '] onReveal swallowed:', e && e.message || e); } catch (_) {}
  return undefined;
 }
}

const HANDLERS = { onRoundStart: onRoundStart, onAnswer: onAnswer, onReveal: onReveal };

/* ---- registration (direct add, or canonical pending queue) --------------- */
const PACK = { id: ID, always: true, weight: 1, handlers: HANDLERS };
try {
 if (root.IQ && root.IQ.Hooks && typeof root.IQ.Hooks.add === 'function') {
  root.IQ.Hooks.add(PACK);
 } else {
  root.IQ = root.IQ || {};
  (root.IQ.__hooksPending = root.IQ.__hooksPending || []).push(PACK);
 }
} catch (e) {
 try { console.warn('[' + ID + '] registration swallowed:', e && e.message || e); } catch (_) {}
}

/* ---- embedded self test ---------------------------------------------------
 * Drives the raw handlers with stubbed ctx + FORCED rng streams (no engine,
 * no DOM). Proves: once-per-run semantics for every trigger, parity inertness
 * on rounds 1-2, pool bounds <= 80 chars, cosmetic-only emissions, and the
 * 0 -> 63 critter hop collapsing to the shrine line alone. Throws nothing. */
function selfTest() {
 /* channel determinism: park any ambient DemonSay stub so ctx.say collectors
  * are the ONLY speech sink while the self test runs */
 const savedDS = root.IQ && root.IQ.DemonSay;
 if (root.IQ) root.IQ.DemonSay = undefined;
 const checks = [];
 function ok(name, cond, detail) {
  checks.push({ name: name, ok: !!cond, detail: detail || '' });
 }
 function stream(vals) {
  let i = 0;
  return function () { const v = vals[i % vals.length]; i++; return v; };
 }
 function baseCtx(round, extra) {
  const c = { round: round, world: 'cave', align: 'chaotic', hp: 80,
   score: 0, streak: 0, seed: 1, rng: stream([0.1]) };
  if (extra) for (const k in extra) c[k] = extra[k];
  return c;
 }

 /* 1. pool hygiene: every variant <= 80 chars, non-empty, mandated line first */
 let poolOk = true;
 for (const k in POOLS) {
  if (!POOLS[k].length || POOLS[k].length > 3) poolOk = false;
  for (const t of POOLS[k]) if (!t || t.length > 80) poolOk = false;
 }
 ok('pools are 2-3 variants, all <= 80 chars', poolOk);

 /* 2. parity rail: rounds 1-2 fully inert */
 const early = onRoundStart(baseCtx(2, { world: 'heaven', align: 'good' })) === undefined &&
  onAnswer(baseCtx(2, { res: { correct: true } })) === undefined &&
  onReveal(baseCtx(2, { hp: 1 })) === undefined;
 ok('rounds<=2 inert', early);

 /* 3. dragon-remembers: burn then correct fires ONCE per run */
 store().set(CAVERN_DRAGON_KEY, 5);
 onRoundStart(baseCtx(5));
 onReveal(baseCtx(5, { res: { correct: false } }));
 const dr1 = onAnswer(baseCtx(6, { res: { correct: true } }));
 ok('dragon quip fires after burn+correct',
  !!dr1 && typeof dr1.bannerText === 'string' && POOLS['dragon-remembers'].indexOf(dr1.bannerText) !== -1,
  JSON.stringify(dr1));
 store().set(CAVERN_DRAGON_KEY, 9);
 onRoundStart(baseCtx(9));
 onReveal(baseCtx(9, { res: { correct: false } }));
 ok('dragon quip is once-per-run',
  onAnswer(baseCtx(10, { res: { correct: true } })) === undefined);
 ok('no dragon quip without burn',
  onAnswer(baseCtx(11, { res: { correct: true } })) === undefined);

 /* 4. critters: first catch once; shrine once; 0->63 hop collapses to shrine */
 store().set(CRITTERS_KEY, 1);
 onAnswer(baseCtx(12, { res: { correct: true }, say: function () {} }));
 ok('critter-first marked after first bank', fired('critter-first'));
 store().set(CRITTERS_KEY, 3 | 32);
 onAnswer(baseCtx(13, { res: { correct: true } }));
 store().set(CRITTERS_KEY, ALL_SIX);
 onAnswer(baseCtx(14, { res: { correct: true }, say: function () {} }));
 ok('shrine-complete marked', fired('shrine-complete'));
 store().set(CRITTERS_KEY, ALL_SIX);
 onAnswer(baseCtx(15, { res: { correct: true } }));
 store().set(CRITTERS_KEY, 0);              /* impossible regression: still quiet */
 onAnswer(baseCtx(16, { res: { correct: true }, say: function () {} }));

 /* fresh-store hop test: 0 straight to 63 fires ONLY the shrine line */
 store().del(PFX + 'fired:critter-first');
 store().del(PFX + 'fired:shrine-complete');
 store().del(PFX + 'critterSeen');
 let hopText = '';
 onAnswer(baseCtx(17, { res: { correct: true }, say: function () { hopText += '|'; } }));
 store().set(CRITTERS_KEY, ALL_SIX);
 onAnswer(baseCtx(18, { res: { correct: true }, say: function () { hopText += '!'; } }));
 ok('0->63 hop marks both triggers, speaks once', fired('critter-first') &&
  fired('shrine-complete') && hopText === '!', hopText);

 /* 5. nuke-survived: >50 start + <=3 reveal fires ONCE */
 onRoundStart(baseCtx(20, { hp: 80 }));
 onReveal(baseCtx(20, { hp: 1 }));
 ok('nuke quip fired once', fired('nuke-survived'));
 onRoundStart(baseCtx(21, { hp: 80 }));
 onReveal(baseCtx(21, { hp: 2 }));
 onRoundStart(baseCtx(22, { hp: 60 }));
 onReveal(baseCtx(22, { hp: 40 }));          /* survived big but not <=3: quiet */
 ok('nuke quip does not unmark or rearm',
  store().get(PFX + 'fired:nuke-survived') === 1 && !store().has(PFX + 'hpHigh'));

 /* 6. sanctuary-first returns bannerText exactly once */
 const san1 = onRoundStart(baseCtx(30, { world: 'heaven', align: 'good' }));
 ok('sanctuary banner once',
  !!san1 && typeof san1.bannerText === 'string' &&
  POOLS['sanctuary-first'].indexOf(san1.bannerText) !== -1, JSON.stringify(san1));
 ok('sanctuary banner not repeated',
  onRoundStart(baseCtx(31, { world: 'heaven', align: 'good' })) === undefined);

 /* 7. determinism hygiene: no banned tokens in any handler source */
 const src = String(onRoundStart) + String(onAnswer) + String(onReveal) +
  String(pickVariant) + String(speak) + String(store);
 ok('zero Math.random/Date.now', src.indexOf('Math.random') === -1 &&
  src.indexOf('Date.now') === -1 && src.indexOf('performance.now') === -1);

 /* 8. cosmetic-only: no emitted object ever carries scoring/hp fields */
 const probe = [onRoundStart(baseCtx(40, { world: 'heaven', align: 'good' })),
  onAnswer(baseCtx(41, { res: { correct: true } })),
  onReveal(baseCtx(42, { hp: 1 }))];
 let cosmetic = true;
 for (const m of probe) {
  if (m && (m.points != null || m.hpDelta != null || m.scoreDelta != null ||
            m.scoreMul != null || m.disableOptionIdx != null)) cosmetic = false;
 }
 ok('emissions are cosmetic-only', cosmetic);

 let allOk = true;
 for (const c of checks) if (!c.ok) allOk = false;
 if (root.IQ) root.IQ.DemonSay = savedDS;
 return { ok: allOk, checks: checks };
}

if (typeof module !== 'undefined' && module.exports) {
 module.exports = { id: ID, always: true, weight: 1, handlers: HANDLERS,
  selfTest: selfTest };
}
})();
