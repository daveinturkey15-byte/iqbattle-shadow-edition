/* ============================================================================
 * IQ BATTLE — pack-funny.js — Dread Tracker + Bad-Trip Flashback Consumer
 * (revised assignment: the nine funny-round flavors already live in
 *  pack-chaos.js / pack-undead.js / curse-pack.js, so this file ships the two
 *  MISSING spec beats instead. Zero overlap by construction.)
 * ============================================================================
 * Registers TWO things (hooks.js contract JSDoc):
 *   1. IQ.Hooks.add({ id:'dread-tracker',   always:true, ... })
 *   2. IQ.Hooks.add({ id:'funny-flashback', always:true, ... })
 * Plus window.IQ.Dread = { run, selfTest } — headless-testable driver.
 *
 * SPEC -> MECHANIC MAP
 *   Dave: "a level where everything is just tracking bad and death":
 *   [1] DREAD TRACKER (hook id 'dread-tracker')
 *       Per-run state 'dread:run' counts CONSECUTIVE hostile rounds
 *       (align 'bad' or 'chaotic'). Each hostile round:
 *         - deaths total ('dread:deaths') rises by a SEEDED amount 1..4
 *           (ctx.rng only) and a top-right kill-counter strip overlayHTML
 *           renders 'DEATHS TRACKED: N' (pointer-events:none).
 *         - every 3rd consecutive hostile round an escalating banner fires,
 *           cycling a fixed array: IT IS COUNTING YOU / THE LEDGER THICKENS /
 *           YOUR NAME IS UNDERLINED.
 *       A GOOD round burns the ledger: streak resets to 0 with relief banner
 *       'THE COUNTER BURNS' (only when something was actually counted).
 *       NEUTRAL rounds pause the count without resetting it.
 *   [2] BAD-TRIP FLASHBACK CONSUMER (hook id 'funny-flashback')
 *       Tracks the last 'bad-trip' world round in per-run state. When a GOOD
 *       round follows one (any number of chaotic/neutral rounds later), emits
 *       ONE cosmetic flashback: wavy hue-shift overlay (~30% coverage,
 *       pointer-events:none, fades out over ~4s) + banner
 *       'FLASHBACK · THE WALLPAPER BREATHES'. Consumed exactly once per trip;
 *       re-arms on the next bad-trip round.
 *
 * DETERMINISM: zero Math.random()/Date.now() in gameplay decisions. The only
 *   randomness is ctx.rng (seeded). Same (runId, round, event sequence)
 *   yields identical modifiers. The 4s auto-remove is presentation-only
 *   (visual fade via CSS animation does the real work; the DOM timer is a
 *   courtesy cleanup and never touches scoring).
 *
 * FAIRNESS RAILS honored:
 *   - Inert on rounds 1-2 (parity rule C8): every handler returns before any
 *     state mutation when ctx.round <= 2.
 *   - overlays are pointer-events:none, escapable, cover well under 30% of
 *     viewport, text >= 12px, never touch question/answer glyphs.
 *   - All motion behind window.IQB_MOTION (falsy => static markup only),
 *     honoring prefers-reduced-motion implicitly.
 *   - No hpDelta/scoreMul here at all: pure bookkeeping + cosmetics. This
 *     pack can never change an outcome.
 *   - Does NOT consume IQ.WorldsMind.flashbackPending(): independent state so
 *     both this pack and other future consumers of that primitive coexist.
 *
 * OVERLAPS AUDITED (complement, not duplicate):
 *   - pack-chaos.js: piano/mirror/pixies/noodles (jester-court world-bound),
 *     genie-den, wise-caesar pre-round advice. Different ids, events, scope.
 *   - pack-undead.js: witch-hex cackle, necro-dance skeletons, acid-storm rain
 *     (world-bound hp ticks). Different ids and mechanics.
 *   - curse-pack.js lollipop/sticker blessings + pack-events.js flair chips.
 *   - worlds-mind.js owns the bad-trip WORLD art; this file only consumes the
 *     aftermath as flavor. No world registration here.
 *
 * Script tag: load AFTER hooks.js (and ideally after worlds-mind.js, though
 * order vs worlds-mind is not required). If hooks.js is absent the pack
 * payloads queue on window.IQ.__hooksPending for late-load reconciliation.
 * ============================================================================*/
(function () {
'use strict';

var root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};

/* ---- mulberry32 local copy ONLY for the headless Dread.run() driver;
 *      live handlers use ctx.rng exclusively (hooks.js contract). ---- */
function makeRng(seed) {
 var a = seed >>> 0;
 return function () {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  var t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
 };
}

var DREAD_LINES = [
 'IT IS COUNTING YOU',
 'THE LEDGER THICKENS',
 'YOUR NAME IS UNDERLINED'
];
var RELIEF_BANNER = 'THE COUNTER BURNS';
var FLASHBACK_BANNER = 'FLASHBACK \u00B7 THE WALLPAPER BREATHES';

function motionOK() {
 try { return typeof window !== 'undefined' && !!window.IQB_MOTION; }
 catch (e) { return false; }
}
function st() { return root.IQ.Hooks.state; }

/* parity rail: silent + stateless on rounds 1-2 */
function inert(ctx) { return !ctx || ((ctx.round | 0) <= 2); }

/* ==========================================================================
 * [1] DREAD TRACKER
 * ========================================================================*/
function dreadStrip(deaths, streakN) {
 /* small top-right strip, pointer-events:none, ~12px monospace ledger line */
 var ticks = '';
 var n = Math.min(streakN, 8);
 for (var i = 0; i < n; i++) ticks += '\u25AE';
 var pulse = motionOK()
  ? ';animation:iqbdreadPulse 2.2s ease-in-out infinite alternate'
  : '';
 return '<div aria-hidden="true" data-iqb-dread style="position:absolute;' +
  'top:10px;right:12px;z-index:60;pointer-events:none;text-align:right;' +
  'font:bold 12px/1.5 monospace;letter-spacing:.14em;color:#ff5566;' +
  'text-shadow:0 0 8px rgba(255,40,60,.45)' + pulse + '">' +
  'DEATHS TRACKED: ' + String(deaths | 0) +
  '<br><span style="font-size:11px;color:rgba(255,120,130,.75)">' +
  ticks + '</span></div>';
}

function onRoundStartDread(ctx) {
 if (inert(ctx)) return;
 var s = st();
 if (ctx.align === 'good') {
  var prev = s.get('dread:run') | 0;
  s.set('dread:run', 0);
  if (prev > 0) {
   return { bannerText: RELIEF_BANNER, flag: 'dread-reset:' + prev };
  }
  return;                       /* nothing counted yet: stay silent */
 }
 if (ctx.align !== 'bad' && ctx.align !== 'chaotic') return; /* neutral: paused */

 var n = (s.get('dread:run') | 0) + 1;
 s.set('dread:run', n);
 var deaths = (s.get('dread:deaths') | 0) + 1 + Math.floor(ctx.rng() * 4);
 s.set('dread:deaths', deaths);

 var out = { overlayHTML: dreadStrip(deaths, n), flag: 'dread-tick:' + n };
 if (n % 3 === 0) {
  out.bannerText = DREAD_LINES[(((n / 3) - 1) % DREAD_LINES.length + DREAD_LINES.length) % DREAD_LINES.length];
 }
 return out;
}

/* ==========================================================================
 * [2] BAD-TRIP FLASHBACK CONSUMER
 *   Arms on any round whose world id is 'bad-trip' (worlds-mind.js, chaotic);
 *   a following GOOD round consumes the arm exactly once.
 * ========================================================================*/
function flashbackOverlay(ctx) {
 /* centered wavy hue blob, translucent, well under 30% coverage */
 var seedX = 18 + Math.floor(ctx.rng() * 20);          /* seeded drift only */
 var seedD = 10 + Math.floor(ctx.rng() * 8);
 var anim = motionOK()
  ? ';animation:iqbfunnyWobble 4s ease-in-out forwards'
  : '';
 var html = '<div aria-hidden="true" data-iqb-funny-flashback style="' +
  'position:absolute;left:' + seedX + '%;top:22%;width:34%;height:44%;' +
  'z-index:59;pointer-events:none;border-radius:46% 54% 58% 42% / 52% 44% 56% 48%;' +
  'background:radial-gradient(ellipse at center,' +
  'rgba(255,62,165,.16),rgba(123,47,247,.13) 55%,rgba(0,229,199,.10));' +
  'filter:hue-rotate(' + seedD * 6 + 'deg) blur(2px)' + anim + '">' +
  '<div style="position:absolute;left:50%;bottom:-26px;transform:translateX(-50%);' +
  'font:italic 12px/1.4 sans-serif;letter-spacing:.08em;' +
  'color:rgba(255,220,245,.85);white-space:nowrap">the wallpaper breathes</div>' +
  '</div>';
 scheduleFlashbackRemoval();
 return html;
}

function scheduleFlashbackRemoval() {
 if (typeof document === 'undefined') return;
 try {
  setTimeout(function () {
   try {
    var el = document.querySelector('[data-iqb-funny-flashback]');
    if (el && el.parentNode) el.parentNode.removeChild(el);
   } catch (e) { /* presentation-only */ }
  }, 4200);
 } catch (e) { /* never break dispatch */ }
}

function onRoundStartFlashback(ctx) {
 if (inert(ctx)) return;
 var s = st();
 if (ctx.world === 'bad-trip') {
  s.set('funny-flashback:armed', true);
  return;                                   /* arming is silent */
 }
 if (ctx.align === 'good' && s.has('funny-flashback:armed')) {
  s.del('funny-flashback:armed');
  return {
   bannerText: FLASHBACK_BANNER,
   overlayHTML: flashbackOverlay(ctx),
   flag: 'funny-flashback'
  };
 }
}

/* ==========================================================================
 * REGISTRATION — direct add when hooks.js is loaded, else queue for its
 * documented late-load reconciliation drain (window.IQ.__hooksPending).
 * ========================================================================*/
var PACKS = [
 { id: 'dread-tracker', always: true, weight: 1,
   handlers: { onRoundStart: onRoundStartDread } },
 { id: 'funny-flashback', always: true, weight: 1,
   handlers: { onRoundStart: onRoundStartFlashback } }
];
var PACK_IDS = PACKS.map(function (p) { return p.id; });

function registerAll() {
 for (var i = 0; i < PACKS.length; i++) {
  var p = PACKS[i];
  try {
   if (root.IQ.Hooks && typeof root.IQ.Hooks.add === 'function') {
    root.IQ.Hooks.add(p);
   } else {
    root.IQ.__hooksPending = root.IQ.__hooksPending || [];
    root.IQ.__hooksPending.push(p);
   }
  } catch (e) { /* one broken pack never kills a round */ }
 }
}
registerAll();

/* keyframes: injected once, document-guarded, motion-gated at USE time */
(function injectFXStyle() {
 if (typeof document === 'undefined') return;
 try {
  if (document.getElementById('iqb-funny-style')) return;
  var stl = document.createElement('style');
  stl.id = 'iqb-funny-style';
  stl.textContent =
   '@keyframes iqbdreadPulse{from{opacity:.72}to{opacity:1}}' +
   '@keyframes iqbfunnyWobble{' +
   '0%{opacity:0;transform:scale(.92) rotate(-1.2deg)}' +
   '12%{opacity:1}70%{opacity:.85;transform:scale(1.04) rotate(1.4deg)}' +
   '100%{opacity:0;transform:scale(1.1) rotate(-.8deg)}}';
  document.head.appendChild(stl);
 } catch (e) { /* headless */ }
})();

/* ==========================================================================
 * window.IQ.Dread — headless driver + self test
 * ========================================================================*/
var Dread = {};

/* Dread.run(steps[, seed]) -> [{round, mods:[...]}]
 * steps: [{round, align, world?}] replayed through the REAL registered
 * handlers (direct calls; works even without hooks.js present). rng comes
 * from makeRng(seed) — deterministic. */
Dread.run = function (steps, seed) {
 var rng = makeRng(seed == null ? 1337 : seed);
 /* ALWAYS isolate per-run state — never leak into live IQ.Hooks.state */
 var hadState = !!(root.IQ.Hooks && root.IQ.Hooks.state);
 var saved = hadState ? root.IQ.Hooks.state : null;
 var store = {};
 root.IQ.Hooks = root.IQ.Hooks || {};
 root.IQ.Hooks.state = {
  get: function (k) { return store[String(k)]; },
  set: function (k, v) { store[String(k)] = v; return v; },
  has: function (k) { return Object.prototype.hasOwnProperty.call(store, String(k)); },
  del: function (k) { delete store[String(k)]; }
 };
 var log = [];
 try {
  for (var i = 0; i < steps.length; i++) {
   var sp = steps[i];
   var ctx = {
    round: sp.round | 0, align: sp.align || null, world: sp.world || '',
    hp: 100, score: 0, streak: 0, timerLen: 30, optCount: 8,
    runId: 'dread-selftest', seed: 1, rng: rng
   };
   var mods = [];
   for (var j = 0; j < PACKS.length; j++) {
    var fn = PACKS[j].handlers.onRoundStart;
    var m;
    try { m = fn(ctx); } catch (e) { m = undefined; }
    if (m && typeof m === 'object') mods.push(m);
   }
   log.push({ round: sp.round, mods: mods });
  }
 } finally {
  if (saved) root.IQ.Hooks.state = saved;
 }
 return log;
};

Dread.selfTest = function () {
 var fails = [];
 function ok(name, cond) { if (!cond) fails.push(name); }
 function modOf(step, pred) {
  var arr = step.mods || [];
  for (var i = 0; i < arr.length; i++) if (pred(arr[i])) return arr[i];
  return null;
 }

 /* -- 1. parity: rounds 1-2 fully inert, no state written -- */
 var r = Dread.run([
  { round: 1, align: 'bad', world: '' },
  { round: 2, align: 'bad', world: 'bad-trip' },
  { round: 2, align: 'good', world: 'womb' }
 ], 11);
 ok('parity r1 bad silent', r[0].mods.length === 0);
 ok('parity r2 bad-trip arms nothing visible', r[1].mods.length === 0);
 ok('parity r2 good silent', r[2].mods.length === 0);

 /* -- 2. dread counting + escalation ladder -- */
 var seq = [];
 for (var n = 3; n <= 9; n++) seq.push({ round: n, align: 'bad', world: '' });
 seq.push({ round: 10, align: 'good', world: 'womb' });
 r = Dread.run(seq, 42);
 ok('r3 fires strip', !!modOf(r[0], function (m) { return m.overlayHTML && m.overlayHTML.indexOf('DEATHS TRACKED:') >= 0; }));
 ok('r3 no banner yet', !modOf(r[0], function (m) { return m.bannerText; }));
 ok('r5 no banner (not multiple of 3)', !modOf(r[1], function (m) { return m.bannerText; }));
 ok('r5 banner IT IS COUNTING YOU (streak 3)', modOf(r[2], function (m) { return m.bannerText === 'IT IS COUNTING YOU'; }) !== null);
 ok('r8 banner THE LEDGER THICKENS (streak 6)', modOf(r[5], function (m) { return m.bannerText === 'THE LEDGER THICKENS'; }) !== null);
 ok('r10 good burns counter', modOf(r[7], function (m) { return m.bannerText === 'THE COUNTER BURNS'; }) !== null);

 /* deaths rose by seeded 1..4 per hostile round: total in [7*1, 7*4] */
 var last = r[6].mods[r[6].mods.length - 1];
 var deathsTxt = '';
 for (var k = 0; k < r[6].mods.length; k++) if (r[6].mods[k].overlayHTML) deathsTxt = r[6].mods[k].overlayHTML;
 var dm = /DEATHS TRACKED:\s*(\d+)/.exec(deathsTxt);
 ok('deaths parsed from strip', !!dm);
 if (dm) {
  var d = parseInt(dm[1], 10);
  ok('deaths within seeded bounds 7..28', d >= 7 && d <= 28);
 }

 /* -- 3. second good round after reset stays silent -- */
 r = Dread.run([
  { round: 3, align: 'bad', world: '' },
  { round: 4, align: 'good', world: 'womb' },
  { round: 5, align: 'good', world: 'womb' }
 ], 7);
 ok('first good burns', modOf(r[1], function (m) { return m.bannerText === 'THE COUNTER BURNS'; }) !== null);
 ok('second good silent', r[2].mods.length === 0);

 /* -- 4. neutral pauses but does not reset -- */
 r = Dread.run([
  { round: 3, align: 'bad', world: '' },
  { round: 4, align: 'neutral', world: '' },
  { round: 5, align: 'bad', world: '' },
  { round: 6, align: 'bad', world: '' },
  { round: 7, align: 'bad', world: '' }
 ], 99);
 ok('neutral silent', r[1].mods.length === 0);
 ok('streak survives neutral: r6 is 3rd consecutive -> IT IS COUNTING YOU', modOf(r[3], function (m) { return m.bannerText === 'IT IS COUNTING YOU'; }) !== null);

 /* -- 5. determinism: same seed => byte-identical logs AND exact seeded
  *       death increments (1 + floor(rng*4) per hostile round). -- */
 function deathsAfter(steps, seed) {
  var rr = Dread.run(steps, seed), txt = '', i, j;
  for (i = 0; i < rr.length; i++) for (j = 0; j < rr[i].mods.length; j++)
   if (rr[i].mods[j].overlayHTML) txt = rr[i].mods[j].overlayHTML;
  var mm = /DEATHS TRACKED:\s*(\d+)/.exec(txt);
  return mm ? mm[1] : '?';
 }
 function logSig(steps, seed) {
  var rr = Dread.run(steps, seed), out = '', i, j;
  for (i = 0; i < rr.length; i++) {
   for (j = 0; j < rr[i].mods.length; j++) {
    var m = rr[i].mods[j];
    out += rr[i].round + ':' + (m.bannerText || '') + '#' +
           (m.overlayHTML ? m.overlayHTML.replace(/>\s+</g, '><') : '') + ';';
   }
   out += '|';
  }
  return out;
 }
 var s1 = logSig(seq, 4242), s2 = logSig(seq, 4242);
 ok('same seed byte-identical logs', s1 === s2);
 var expRng = makeRng(4242), expectedTotal = 0;
 for (var e = 0; e < 7; e++) expectedTotal += 1 + Math.floor(expRng() * 4);
 ok('death total matches mulberry32(4242) replay (=' + expectedTotal + ')',
  deathsAfter(seq, 4242) === String(expectedTotal));

 /* -- 6. forced-rng stub gates: rng()=>0 => min increment 1 each round -- */
 var fixedRng = function () { return 0; };
 var store2 = {};
 var savedHooks = root.IQ.Hooks;
 root.IQ.Hooks = { state: {
  get: function (k) { return store2[k]; },
  set: function (k, v) { store2[k] = v; return v; },
  has: function (k) { return Object.prototype.hasOwnProperty.call(store2, k); },
  del: function (k) { delete store2[k]; }
 }};
 try {
  var m1 = onRoundStartDread({ round: 3, align: 'bad', world: '', rng: fixedRng });
  var m2 = onRoundStartDread({ round: 4, align: 'bad', world: '', rng: fixedRng });
  var d1 = /DEATHS TRACKED:\s*(\d+)/.exec(m1.overlayHTML)[1];
  var d2 = /DEATHS TRACKED:\s*(\d+)/.exec(m2.overlayHTML)[1];
  ok('forced rng 0 => +1 per hostile round', d1 === '1' && d2 === '2');
  ok('strip is pointer-events:none', m1.overlayHTML.indexOf('pointer-events:none') >= 0);
  ok('no script tags ever', m1.overlayHTML.indexOf('<script') < 0 &&
    m2.overlayHTML.indexOf('<script') < 0);
 } finally {
  root.IQ.Hooks = savedHooks;
 }

 /* -- 7. flashback: arm on bad-trip, consume once on next good -- */
 r = Dread.run([
  { round: 3, align: 'chaotic', world: 'basement-thing' },
  { round: 4, align: 'chaotic', world: 'bad-trip' },
  { round: 5, align: 'chaotic', world: 'mountain-ascent' }, /* chaotic, not good: keeps armed */
  { round: 6, align: 'good', world: 'womb' },
  { round: 7, align: 'good', world: 'stair-of-heaven' }
 ], 5);
 ok('non-trip chaotic: no flashback', !modOf(r[0], function (m) { return m.bannerText === FLASHBACK_BANNER; }));
 ok('bad-trip arm: no flashback yet', !modOf(r[1], function (m) { return m.bannerText === FLASHBACK_BANNER; }));
 ok('chaotic gap keeps armed: still no flashback', !modOf(r[2], function (m) { return m.bannerText === FLASHBACK_BANNER; }));
 var fb = modOf(r[3], function (m) { return m.bannerText === FLASHBACK_BANNER; });
 ok('good after bad-trip fires flashback', fb !== null);
 ok('flashback overlay safe+cosmetic', fb !== null && fb.overlayHTML &&
  fb.overlayHTML.indexOf('pointer-events:none') >= 0 &&
  fb.overlayHTML.indexOf('<script') < 0);
 ok('flashback consumed exactly once', r[4].mods.length === 0);

 /* -- 8. re-arm requires a NEW bad-trip round -- */
 r = Dread.run([
  { round: 3, align: 'chaotic', world: 'bad-trip' },
  { round: 4, align: 'good', world: 'womb' },
  { round: 5, align: 'good', world: 'womb' },
  { round: 6, align: 'chaotic', world: 'bad-trip' },
  { round: 7, align: 'good', world: 'womb' }
 ], 6);
 ok('trip1 fires', modOf(r[1], function (m) { return m.bannerText === FLASHBACK_BANNER; }) !== null);
 ok('second good without new trip silent', r[2].mods.length === 0);
 ok('re-armed trip2 fires again', modOf(r[4], function (m) { return m.bannerText === FLASHBACK_BANNER; }) !== null);

 return { ok: fails.length === 0, fails: fails, packs: PACK_IDS };
};

root.IQ.Dread = Dread;

if (typeof module !== 'undefined' && module.exports) {
 module.exports = { Dread: Dread, PACK_IDS: PACK_IDS };
}
if (typeof require !== 'undefined' && typeof module !== 'undefined' &&
    require.main === module) {
 /* node smoke: pull in real hooks.js when available (drains any queued
  * registrations too), then run the embedded self test. */
 try { require('./hooks.js'); } catch (e) { /* standalone is fine */ }
 var res = Dread.selfTest();
 if (res.ok) {
  console.log('pack-funny selfTest OK — packs: ' + res.packs.join(', '));
 } else {
  console.error('pack-funny selfTest FAILED:\n  ' + res.fails.join('\n  '));
 }
 process.exit(res.ok ? 0 : 1);
}
})();
