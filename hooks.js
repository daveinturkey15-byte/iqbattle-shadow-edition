/* ============================================================================
 * IQ.Hooks — Gameplay-modifier backbone for themed rounds ("army packs")
 * ============================================================================
 *
 * INTEGRATION CONTRACT (read this before writing a pack — it is exact.)
 * ----------------------------------------------------------------------------
 * A PACK registers itself from its own file:
 *
 *   IQ.Hooks.add({
 *     id:       'my-pack-id',        // REQUIRED, unique. Use kebab-case.
 *     worlds:   ['w1','w7'],         // world ids this pack binds to...
 *     always:   true,                // ...OR omit `worlds` and set always:true
 *                                    //    to bind to EVERY world. Exactly one
 *                                    //    of the two styles per pack.
 *     weight:   1,                   // optional, default 1. Higher = earlier.
 *     handlers: {
 *       onRoundStart?(ctx),          // round puzzle exists, timer not started
 *       onTick?(ctx),                // once per engine tick while timer runs
 *       onPreAnswer?(ctx),           // player just clicked an option, not scored
 *       onAnswer?(ctx),              // after scoring; ctx.res = pick result
 *       onReveal?(ctx),              // correct answer shown
 *       onInterlude?(ctx)            // between-rounds beat
 *     }
 *   });
 *
 * EVENTS — exact names: 'roundStart' | 'tick' | 'preAnswer' | 'answer'
 *                       | 'reveal' | 'interlude'. dispatch(evt, ctx) fans an
 *                       event out to every bound pack's matching handler.
 *
 * CTX SHAPE (engine builds it; treat as read-only):
 *   {
 *     round:     <int>,      // 1-based round number
 *     world:     <string>,   // current world id (''/null on baseline rounds)
 *     align:     <string>,   // 'bad' | 'good' | 'neutral' | null
 *     hp:        <int>,      // live hitpoints (0..100)
 *     score:     <int>,
 *     streak:    <int>,
 *     timerLen:  <int>,      // seconds allotted this round
 *     optCount:  8,          // option slots (0..7 are valid option indices)
 *     rng:       <fn>,       // SEEDED () => float [0,1). THE ONLY randomness
 *                            // you may use. See DETERMINISM below.
 *     runId:     <string>,   // changes every match; key state off it
 *     seed:      <number>,   // per-round numeric seed (== rng source)
 *     res?:      { correct:<bool>, picked:<int>, correctIdx:<int> }
 *                            // ONLY present on 'answer'
 *   }
 *
 * RETURN VALUE — handlers MAY return ONE modifier object (or nothing /
 * undefined). The engine consumes what it understands and IGNORES unknown
 * fields (forward-compatible). Vocabulary:
 *
 *   {
 *     hpDelta:         <int>,    // +/- hitpoints applied after current step
 *     scoreMul:        <num>,    // multiplier applied to the NEXT award
 *                                // (e.g. 1.5); <=0 clamps to 1 by engine
 *     timerDelta:      <int>,    // seconds added/removed from live timer
 *     disableOptionIdx:[int],    // grey out these option indices this round;
 *                                // indices 0..optCount-1; never ALL options
 *     invertControlsMs:<int>,    // swap/mirror input mapping for N ms
 *     overlayHTML:     <string>, // cosmetic overlay markup appended to stage;
 *                                // MUST be non-interactive, motion-gated,
 *                                // escapable, text readable (see FAIRNESS)
 *     bannerText:      <string>, // short status banner line
 *     pickup: { kind: 'health'|'ammo'|'ring'|'coin'|'banana', value:<num> },
 *     sfx:             <string>, // sound cue name passed to IQ.Music/sting
 *     flag:            <string>  // opaque marker logged for engine/packs
 *     -- ENGINE EXTENSIONS (pass through even on older engines; ignored
 *        there, so shipping them is always safe) --
 *     forceWrong:      <true>,   // ONLY meaningful from onPreAnswer: engine
 *                                // scores the picked option WRONG regardless
 *                                // of what was clicked (e.g. red-light-
 *                                // green-light). Never affects correctIdx.
 *     disableWrongRandom: <int>, // engine disables N distinct RANDOM WRONG
 *                                // options this round, never the correct one
 *                                // (works pre-reveal because the ENGINE, not
 *                                // the pack, knows correctIdx).
 *     scoreDelta:      <int>,   // flat signed score adjustment applied by the
 *                                // engine (host-authoritative); use this for
 *                                // flat +/- awards — NOT pickup, whose kind
 *                                // enum is closed.
 *                                // NOTE: ctx never exposes correctIdx to
 *                                // packs pre-reveal (fairness/anti-cheat);
 *                                // use disableWrongRandom:n instead.
 *     disableRightRandom: <int>, // engine disables N distinct RANDOM CORRECT
 *                                // options (jester-trap mechanics). HOST-
 *                                // AUTHORITATIVE and align-aware: the engine
 *                                // MAY silently decline when honouring it
 *                                // would make the round unsolvable (e.g. on
 *                                // good/neutral rounds). Packs must treat
 *                                // refusal as normal, never detect it.
 *     -- PRE-REVEAL ANTI-LEAK (hard rule) --
 *     ctx NEVER carries correctIdx, wrongIdx, or any answer-derived hint
 *     before 'reveal'. Cosmetic effects that want a "wrong-looking" target
 *     MUST use ctx.rng-seeded picks instead.
 *   }
 *
 * Modifier objects are COLLECTED: dispatch() resolves every bound handler in
 * order and returns an ARRAY of all returned modifiers (skipping undefined).
 * The engine applies them; a pack NEVER mutates game state directly.
 *
 * DETERMINISM RULES (hard requirements for multiplayer parity):
 *   1. NEVER call Math.random(), Date.now(), performance.now() for gameplay
 *      decisions inside a handler. Use ctx.rng ONLY. It is a seeded
 *      mulberry-style PRNG; the engine derives it from the match seed +
 *      round + dispatch sequence, so host and clients produce identical
 *      sequences.
 *   2. Same (runId, round, event sequence) => same modifiers. Handlers must be
 *      pure functions of (ctx, your own IQ.Hooks.state under your id).
 *   3. Time-limited effects (invertControlsMs etc.) are REQUESTS; the engine
 *      owns clocks. Do not setTimeout for gameplay outcomes.
 *
 * STATE SHARING BETWEEN HANDLERS:
 *   IQ.Hooks.state.get(key) / .set(key, value) / .has(key) / .del(key)
 *   - Per-match store, wiped automatically at every run start (beginRun).
 *   - ALWAYS prefix keys with your pack id: state.set('my-pack-id:fired',true).
 *     Bare/unprefixed keys may collide and will be treated as foreign.
 *   - Values survive across rounds within one match only.
 *
 * FAIRNESS RAILS (violations = pack rejected):
 *   - Question/answer TEXT stays readable: overlays must not cover the board
 *     or options with opaque fills; max ~30% viewport coverage.
 *   - Motion/flashing: respect window.IQB_MOTION (falsy => NO animation,
 *     flashes, strobes). Any flash <=200ms, <=3Hz. Honor prefers-reduced-motion
 *     implicitly via IQB_MOTION.
 *   - Everything escapable: overlayHTML must not trap focus, capture Escape,
 *     or block pointer events on answer buttons (use pointer-events:none).
 *   - Never weaken fairness: do not attempt to read/broadcast hidden answers
 *     pre-reveal; disableOptionIdx must leave >=1 selectable option; scoring
 *     math stays host-authoritative (you may request scoreMul, never rewrite
 *     totals).
 *   - One broken pack must NEVER kill a round: dispatch wraps EVERY handler
 *     in try/catch and swallows errors.
 *
 * REGISTRATION ORDER & RESOLUTION:
 *   IQ.Hooks.active(worldId, align) returns the resolved handler records for
 *   the current round, sorted by weight DESC (default 1), ties broken by
 *   registration order (stable). Each record: { id, weight, order, handlers }.
 *   Packs bind when (always === true) OR worlds.includes(worldId). A pack may
 *   additionally inspect ctx.align inside a handler to refine behaviour.
 *
 * ENGINE DISPATCH POINTS (GameFlow wires these; pack authors ignore):
 *   IQ.Hooks.beginRun(runId, seed)  -> wipe per-run state, reset rng cursor
 *   IQ.Hooks.dispatch(evt, ctx)     -> returns [modifier, ...]
 *   IQ.Hooks.makeRng(seed)          -> engine-side seeded rng factory helper
 * ============================================================================*/
(function () {
'use strict';
const root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};

/* ---- seeded PRNG (mulberry32) — shared with alignment.js convention ---- */
function makeRng(seed) {
 let a = seed >>> 0;
 return function () {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
 };
}

const Hooks = (function () {
 const packs = [];            // [{id, worlds:Set|null, always, weight, order, handlers}]
 const byId = Object.create(null);
 const runState = new Map();  // per-match key/value store

 function normWorlds(list) {
  if (!Array.isArray(list)) return null;
  const s = new Set();
  for (const w of list) if (w != null) s.add(String(w));
  return s;
 }

 /* Register a pack. Re-registering an id replaces the previous definition. */
 function add(pack) {
  if (!pack || typeof pack !== 'object') throw new Error('IQ.Hooks.add: pack object required');
  const id = String(pack.id || '');
  if (!id) throw new Error('IQ.Hooks.add: pack.id required');
  const handlers = (pack.handlers && typeof pack.handlers === 'object') ? pack.handlers : {};
  const rec = {
   id: id,
   worlds: normWorlds(pack.worlds),
   always: !!pack.always,
   weight: typeof pack.weight === 'number' && isFinite(pack.weight) ? pack.weight : 1,
   order: packs.length,
   handlers: handlers
  };
  if (rec.always && rec.worlds) throw new Error('IQ.Hooks.add(' + id + '): use worlds OR always, not both');
  if (!rec.always && (!rec.worlds || rec.worlds.size === 0)) throw new Error('IQ.Hooks.add(' + id + '): needs worlds:[...] or always:true');
  const old = byId[id];
  if (old) {
   old.worlds = rec.worlds; old.always = rec.always; old.weight = rec.weight;
   old.handlers = rec.handlers;                 // keep original order slot
   return old;
  }
  byId[id] = rec;
  packs.push(rec);
  return rec;
 }

 function remove(id) {
  const i = packs.indexOf(byId[id]);
  if (i < 0) return false;
  delete byId[id];
  packs.splice(i, 1);
  return true;
 }

 function clear() {
  packs.length = 0;
  for (const k in byId) delete byId[k];
  runState.clear();
 }

 /* Resolved handler records for a round: bound packs, weight DESC, then
  * registration order. Returned records are internal — treat read-only. */
 function active(worldId, align) {
  void align; // reserved: packs may refine on ctx.align inside handlers
  const out = [];
  const wid = worldId == null ? '' : String(worldId);
  for (const p of packs) {
   const bound = p.always || (p.worlds && p.worlds.has(wid));
   if (bound) out.push(p);
  }
  out.sort(function (a, b) { return (b.weight - a.weight) || (a.order - b.order); });
  return out.map(function (p) {
   return { id: p.id, weight: p.weight, order: p.order, handlers: p.handlers };
  });
 }

/* Fan an event out. Returns array of modifier objects (undefined skipped).
 * One throwing handler is swallowed and cannot affect the others.
 * evt accepts either spelling: 'tick' or 'onTick' (normalized internally). */
function handlerKey(evt) {
  const e = String(evt || '');
  if (/^on[A-Z]/.test(e)) return e;
  return 'on' + e.charAt(0).toUpperCase() + e.slice(1);
}

function dispatch(evt, ctx) {
 const c = ctx || {};
 const mods = [];
 const wid = c.world == null ? '' : String(c.world);
 const key = handlerKey(evt);
 for (const rec of active(wid, c.align)) {
  const fn = rec.handlers && rec.handlers[key];
  if (typeof fn !== 'function') continue;
   try {
    const m = fn(c);
    if (m && typeof m === 'object') mods.push(m);
   } catch (e) {
    try { console.warn('[IQ.Hooks] pack "' + rec.id + '" threw on "' + evt + '":', e && e.message || e); } catch (_) {}
   }
  }
  return mods;
 }

 /* ---- per-match state ---- */
 function beginRun(runId, seed) {
  runState.clear();
  runState.set('__runId', String(runId == null ? '' : runId));
  runState.set('__seed', seed >>> 0);
 }
 const state = {
  get: function (k) { return runState.get(String(k)); },
  set: function (k, v) { runState.set(String(k), v); return v; },
  has: function (k) { return runState.has(String(k)); },
  del: function (k) { return runState.delete(String(k)); }
 };

 return {
  add: add, remove: remove, clear: clear,
  active: active, dispatch: dispatch,
  beginRun: beginRun, state: state, makeRng: makeRng,
  _packs: packs
 };
})();

/* ============================================================================
 * EXEMPLAR MINI-PACKS — proof-of-API. Registered here, inert until their
 * worlds come up in a real round. Copy these shapes for army packs.
 * ============================================================================*/

/* example-timerdrain — BAD rounds: drain 3s once per match, first bad round.
 * Binds everywhere (always:true) and refines on ctx.align inside the handler
 * — the align-refinement style. Static `worlds:['w1','w2']` works too when
 * you know your ids up front; prefer static worlds for pure world themes. */
Hooks.add({
 id: 'example-timerdrain',
 always: true,
 weight: 1,
 handlers: {
  onRoundStart: function (ctx) {
   if (ctx.align !== 'bad') return;                     // refine on align
   if (Hooks.state.has('example-timerdrain:fired')) return;
   Hooks.state.set('example-timerdrain:fired', true);
   return { timerDelta: -3, bannerText: 'THE CLOCK LEAKS', sfx: 'zap', flag: 'timer-drain' };
  }
 }
});

/* example-shield — GOOD rounds: first wrong answer forgiven (HP refunded). */
Hooks.add({
 id: 'example-shield',
 always: true,
 weight: 2,
 handlers: {
  onAnswer: function (ctx) {
   if (ctx.align !== 'good') return;
   if (!ctx.res || ctx.res.correct) return;
   if (Hooks.state.has('example-shield:used')) return;
   Hooks.state.set('example-shield:used', true);
   return { hpDelta: +15, bannerText: 'SHIELD ABSORBED THE BLOW', flag: 'shield-used' };
  }
 }
});

/* example-confetti — NEUTRAL cosmetic overlay on reveal. Motion-gated. */
Hooks.add({
 id: 'example-confetti',
 always: true,
 weight: 0.5,
 handlers: {
  onReveal: function (ctx) {
   if (typeof root.IQB_MOTION !== 'undefined' && !root.IQB_MOTION) return;
   const n = 12, r = ctx.rng, bits = [];
   const colors = ['#ffd75e', '#7ef29a', '#6ecbff', '#ff8bd0'];
   for (let i = 0; i < n; i++) {
    bits.push('<span style="position:absolute;left:' + ((r() * 90) + 5).toFixed(1) +
     '%;top:' + ((r() * 60)).toFixed(1) + '%;width:6px;height:10px;background:' +
     colors[(r() * colors.length) | 0] + ';transform:rotate(' + ((r() * 360) | 0) +
     'deg);pointer-events:none"></span>');
   }
   return {
    overlayHTML: '<div style="position:absolute;inset:0;overflow:hidden;pointer-events:none">' +
     bits.join('') + '</div>',
    bannerText: '', sfx: 'chime', flag: 'confetti'
   };
  }
 }
});

/* ---- late-load reconciliation ------------------------------------------
 * Packs that execute BEFORE hooks.js may queue their payload instead of
 * calling add() directly. Recognized queues (drained once, in order):
 *   window.IQ.__hooksPending = [packObj, ...]   (canonical)
 *   window.IQ.Hooks._q = [packObj, ...]         (PackHunters shim alias)
 * A queued entry is any object with an `id`; invalid entries are skipped
 * without killing the drain. */
(function drainPending() {
 const queues = [];
 try { if (Array.isArray(root.IQ.__hooksPending)) queues.push(root.IQ.__hooksPending); } catch (_) {}
 try {
  if (root.IQ.Hooks && Array.isArray(root.IQ.Hooks._q) && root.IQ.Hooks._q !== packs) queues.push(root.IQ.Hooks._q);
 } catch (_) {}
 for (const q of queues) {
  while (q.length) {
   const p = q.shift();
   try { if (p && p.id != null) Hooks.add(p); }
   catch (e) { try { console.warn('[IQ.Hooks] pending pack rejected:', e && e.message || e); } catch (_) {} }
  }
 }
})();

/* ============================================================================
 * SELF TEST — safe to call anytime; returns {ok, checks:[...]}. Throws nothing.
 * ============================================================================*/
Hooks.selfTest = function () {
 const checks = [];
 const ok = function (name, cond) { checks.push({ name: name, ok: !!cond }); };
 try {
  const before = Hooks._packs.length;
  Hooks.add({ id: '__t_throw', always: true, handlers: {
   onTick: function () { throw new Error('boom'); },
   onAnswer: function (c) { return { hpDelta: 99, mysteryField: 1 }; }
  }});
  Hooks.add({ id: '__t_ok', always: true, weight: 9, handlers: {
   onTick: function () { return { bannerText: 'fine' }; }
  }});
  Hooks.add({ id: '__t_w', worlds: ['__wz'], weight: 5, handlers: {} });

  const act = Hooks.active('__wz');
  ok('weight sorts first', act.length >= 3 && act[0].id === '__t_ok');

  const mods = Hooks.dispatch('tick', { world: '__wz', align: 'bad', rng: makeRng(1), optCount: 8 });
  ok('throwing handler swallowed', Array.isArray(mods));
  ok('healthy handler still ran', mods.some(function (m) { return m.bannerText === 'fine'; }));
  ok('throwing handler contributed none', !mods.some(function (m) { return m.hpDelta === 99; }));

  const wmods = Hooks.dispatch('answer', { world: '__wz', res: { correct: false, picked: 0, correctIdx: 1 }, rng: makeRng(2), optCount: 8 });
  ok('unknown fields pass through untouched', wmods.some(function (m) { return m.hpDelta === 99 && m.mysteryField === 1; }));

  ok('unbound world excludes scoped pack', Hooks.active('__other').every(function (r) { return r.id !== '__t_w'; }));

  Hooks.remove('__t_throw'); Hooks.remove('__t_ok'); Hooks.remove('__t_w');
  ok('cleanup restores count', Hooks._packs.length === before);

  ok('rng deterministic', (function () {
   const a = makeRng(42), b = makeRng(42);
   for (let i = 0; i < 8; i++) if (a() !== b()) return false;
   return true;
  })());
 } catch (e) {
  checks.push({ name: 'selfTest crashed: ' + (e && e.message), ok: false });
 }
 return { ok: checks.every(function (c) { return c.ok; }), checks: checks };
};

root.IQ.Hooks = Hooks;
if (typeof module !== 'undefined' && module.exports) module.exports = Hooks;
})();
