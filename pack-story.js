/* ============================================================================
 * pack-story.js — IQ Versus: SHADOW · descent mythology & redemption arc
 * ----------------------------------------------------------------------------
 * SPEC (Dave): LORE AND STORY woven through runs — descent mythology +
 * sanctuary redemption beats, budgeted through the existing DemonSay channel
 * and the banner/overlay modifier system.
 *
 * MECHANIC (single self-registering hook pack, id 'shadow-story', always:true):
 *   1. ARC STATE — IQ.Hooks.state keys (all prefixed, per-run):
 *        story:maxDepth      deepest depth seen this run
 *        story:card:<d>      chapter card for depth <d> already fired
 *        story:layerPrev     last HellHeaven layer we reacted to (default 1)
 *        story:sancFired     last 'sanctuary:count' value we spoke for
 *        story:despair       despair line already SPOKEN this run
 *        story:defiance      defiance line already SPOKEN this run
 *   2. CHAPTER CARDS — at depths 5/10/15/20… a once-per-threshold
 *      overlayHTML title card ("CHAPTER II · THE LONG STAIR", …). Pure
 *      paint: pointer-events:none, escapable, 4s CSS auto-fade (no timers),
 *      static under prefers-reduced-motion or IQB_MOTION===false,
 *      text >= 11px, well under the ~30% coverage rail.
 *   3. SANCTUARY LORE — when 'sanctuary:count' (written by sanctuary.js)
 *      advances past the last value we spoke for, emit one say()-style line
 *      escalating by visit number (first visit / returning / veteran),
 *      continuity-flavoured ("The light kept your seat…").
 *   4. DESCENT WHISPERS — polls the HellHeaven layer defensively each
 *      roundStart (window.IQ.HellHeaven.layer(), plus the 'hh:layer' state
 *      key as an ordering-safe secondary signal; takes the max). Only a
 *      DEEPENING (cur > prev) emits one whisper named for the new layer
 *      (OUTER DARK .. THE THRONE OF ASH), max 1 per round.
 *   5. FINALE BEATS — onAnswer: wrong while hp <= 25 emits a unique despair
 *      line ONCE per run; a later streak >= 4 emits a defiance line ONCE.
 *
 * DEMONSAY BUDGET: we NEVER call announce() and never force. Lines go out
 * through ctx.say (guarded) or IQ.DemonSay.say (guarded) at ambient
 * priority; if the budget denies the line, the once-per-run flags are NOT
 * consumed — a denied beat retries on the next qualifying event. Headless /
 * no-DemonSay: lines are dropped silently (cosmetic only).
 *
 * DETERMINISM: gameplay decisions use ctx.rng only; off-dispatch picks
 * (chapter titles beyond the fixed table) use IQ.Hooks.makeRng seeded from
 * the depth — never Math.random / Date.now. Same (run, round, sequence)
 * => same modifiers.
 *
 * FAIRNESS RAILS: parity C8 — fully inert on rounds 1-2. No question/answer
 * glyphs touched; overlays escapable-by-nature (pure paint,
 * pointer-events:none); fades are 4s, no strobe (<=200ms/<=3Hz rule met
 * trivially); no text < 11px; parody naming throughout.
 *
 * INTEGRATION (Main): load AFTER hooks.js, hellheaven.js and cameo-pack.js:
 *   <script src="hooks.js"></script>
 *   ...
 *   <script src="cameo-pack.js"></script>
 *   <script src="pack-story.js"></script>
 * Consumes: IQ.Hooks.state, IQ.Hooks.makeRng, IQ.HellHeaven.layer(),
 *           'sanctuary:count' / 'hh:layer' state keys, IQ.DemonSay.say.
 * ==========================================================================*/
(function () {
'use strict';
const root = typeof window !== 'undefined' ? window : globalThis;
const PARITY_ROUNDS = 2;   /* C8: inert through round 2 */

/* ---- the seven layers, names verbatim from hellheaven.js ---- */
const LAYER_NAMES = [
 'OUTER DARK', 'BURNING SANDS', 'THE RUSTED NAILS', 'SERPENT WARRENS',
 'THE SCREAMING FOUNDRY', 'THE BLACK MARROW', 'THE THRONE OF ASH'
];

/* ---- descent whispers, one pool per layer (each line <= 90 chars) ---- */
const WHISPERS = [
 [ /* OUTER DARK */
  'OUTER DARK. The door did not lock \u2014 it merely lost interest in you.',
  'Welcome to the OUTER DARK. Mind the echo; it answers back.'
 ],
 [ /* BURNING SANDS */
  'BURNING SANDS underfoot. The glass remembers being something useful.',
  'The BURNING SANDS keep time by blister. You are running late.'
 ],
 [ /* THE RUSTED NAILS */
  'THE RUSTED NAILS: barefoot weather, apparently. Nobody voted on it.',
  'Down among THE RUSTED NAILS even the tetanus feels administrative.'
 ],
 [ /* SERPENT WARRENS */
  'SERPENT WARRENS. They knew your name before you did \u2014 check the spelling.',
  'The WARRENS keep a guest list. Yours is written in something redder than ink.'
 ],
 [ /* THE SCREAMING FOUNDRY */
  'THE SCREAMING FOUNDRY. The machines are unionised; you are not.',
  'Foundry shift notes: output steady, screaming within tolerance.'
 ],
 [ /* THE BLACK MARROW */
  'THE BLACK MARROW. Light comes here to die. Bring a jumper.',
  'In THE BLACK MARROW the dark has texture. Try not to touch it.'
 ],
 [ /* THE THRONE OF ASH */
  'THE THRONE OF ASH. Someone is expecting you. They tidied up and everything.',
  'The THRONE OF ASH keeps your seat warm. That is not a kindness.'
 ]
];

/* ---- chapter title cards: fixed table for depths 5..30, pool beyond ---- */
const CHAPTERS = [
 'CHAPTER II \u00b7 THE LONG STAIR',
 'CHAPTER III \u00b7 WHAT THE LAUGHING MEANS',
 'CHAPTER IV \u00b7 THE FURNACE LEARNS YOUR NAME',
 'CHAPTER V \u00b7 LIGHT IS A RUMOUR DOWN HERE',
 'CHAPTER VI \u00b7 THE STAIR GOES BOTH WAYS',
 'CHAPTER VII \u00b7 ASH SETTLES ON EVERYTHING YOU LOVED'
];
const CHAPTERS_EXTRA = [
 'CHAPTER \u00b7 THE MAP RUNS OUT HERE',
 'INTERLUDE \u00b7 THE DEEP KEEPS ITS OWN MINUTES',
 'CHAPTER \u00b7 NOBODY COMES BACK CHANGED IN A NICE WAY',
 'CHAPTER \u00b7 YOUR SHADOW ARRIVED FIRST AND GOT COMFORTABLE'
];

/* ---- sanctuary lore, escalating by sanctuary:count ---- */
const SANCTUARY_FIRST = [
 'The light kept your seat. It remembers the depth you left.',
 'First refuge. Breathe. The dark is patient, but so are you.'
];
const SANCTUARY_RETURN = [
 'Back again. The light pretends not to notice how deep you went.',
 'The candles relearnt your silhouette. Love, or very thorough bookkeeping.'
];
const SANCTUARY_VETERAN = [
 'Veteran of the refuge now. The light keeps score on your behalf.',
 'You visit the light so often it has begun charging rent in gratitude.'
];

/* ---- finale beats ---- */
const DESPAIR = [
 'That one landed somewhere older than the bruise. The dark leans closer.',
 'Wrong, and down here wrong has weight. The shadows gather to watch.',
 'The floor is not far now. It never was. That was always the trick.'
];
const DEFIANCE = [
 'Four straight. Somewhere below, something revises its estimate of you.',
 'A streak like this annoys the dark. Keep going. It hates that most.',
 'You were meant to be a cautionary tale. Planning a sequel, are we?'
];

/* ---- state resolution: live Hooks.state in browser, local shim headless -- */
let shim = null;
function mapShim() {
 const m = new Map();
 return {
  get: function (k) { return m.get(String(k)); },
  set: function (k, v) { m.set(String(k), v); return v; },
  has: function (k) { return m.has(String(k)); },
  del: function (k) { return m.delete(String(k)); }
 };
}
function S() {
 const H = root.IQ && root.IQ.Hooks;
 if (H && H.state) return H.state;
 if (!shim) shim = mapShim();
 return shim;
}
function num(v, dflt) { const n = Number(v); return isFinite(n) ? n : dflt; }

/* ---- deterministic off-dispatch rng (chapter titles past the table) ----- */
function hashSeed(s) {
 s = String(s == null ? '' : s);
 let h = 2166136261;
 for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
 return h >>> 0;
}
function pickSeeded(arr, seedStr) {
 const H = root.IQ && root.IQ.Hooks;
 let r;
 if (H && typeof H.makeRng === 'function') r = H.makeRng(hashSeed(seedStr));
 else {
  let a = hashSeed(seedStr) >>> 0;
  r = function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
   t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
 }
 return arr[Math.floor(r() * arr.length) % arr.length];
}

/* ---- DemonSay-budgeted speech: ctx.say guarded, then IQ.DemonSay.say.
   NEVER announce(); NEVER force; ambient priority; false = budget denied -- */
function speak(c, text) {
 try { if (c && typeof c.say === 'function') { if (c.say(text)) return true; } } catch (e) {}
 try {
  const ds = root.IQ && root.IQ.DemonSay;
  if (ds && typeof ds.say === 'function' && ds.say(text)) return true;
 } catch (e) {}
 return false;
}

/* ---- defensive HellHeaven layer poll: API + 'hh:layer' state, max, 0 if
   neither present (ordering-safe: whichever pack writes first wins) -------- */
function currentLayer(st) {
 let best = 0;
 try {
  const HH = root.IQ && root.IQ.HellHeaven;
  if (HH && typeof HH.layer === 'function') best = Math.max(best, num(HH.layer(), 0));
 } catch (e) {}
 const k = num(st.get('hh:layer'), 0);
 if (st.has('hh:layer')) best = Math.max(best, k);
 return best >= 1 && best <= LAYER_NAMES.length ? best : (best ? LAYER_NAMES.length : 0);
}

/* ---- chapter card overlay: pure paint, 4s CSS fade, reduced-motion static */
function chapterCard(title) {
 const motionOk = typeof root.IQB_MOTION === 'undefined' || !!root.IQB_MOTION;
 return '<div class="iq-story-card" style="position:absolute;top:16%;left:50%;' +
  'transform:translateX(-50%);pointer-events:none;text-align:center;z-index:60;' +
  (motionOk ? 'animation:iqStoryFade 4s ease forwards;' : 'opacity:.92;') + '">' +
  '<style>@keyframes iqStoryFade{0%{opacity:0}10%{opacity:.95}75%{opacity:.95}' +
  '100%{opacity:0}}' +
  '@media (prefers-reduced-motion:reduce){.iq-story-card{animation:none!important;' +
  'opacity:.92!important}}</style>' +
  '<div style="font-size:11px;letter-spacing:.34em;color:#b8a6ff;' +
  'text-shadow:0 0 10px rgba(107,75,216,.85)">IQ VERSUS \u00b7 SHADOW</div>' +
  '<div style="margin-top:6px;font-size:24px;font-weight:800;color:#f2ecff;' +
  'text-shadow:0 0 16px rgba(200,16,46,.65),0 2px 4px rgba(0,0,0,.9)">' +
  String(title).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</div>' +
  '</div>';
}

function chapterTitleFor(depth) {
 const idx = Math.floor(depth / 5) - 1;          /* D5 -> 0, D10 -> 1, ... */
 if (idx >= 0 && idx < CHAPTERS.length) return CHAPTERS[idx];
 return pickSeeded(CHAPTERS_EXTRA, 'story-chapter-' + depth);
}

/* ============================== HANDLERS ================================== */

function onRoundStart(ctx) {
 const c = ctx || {};
 const rd = c.round | 0;
 if (rd > 0 && rd <= PARITY_ROUNDS) return null;   /* parity C8 */

 const st = S();
 const depth = (c.depth | 0) || rd;
 if (depth > num(st.get('story:maxDepth'), 0)) st.set('story:maxDepth', depth);

 /* 2. chapter cards — once per threshold */
 let mod = null;
 if (depth >= 5 && depth % 5 === 0 && !st.has('story:card:' + depth)) {
  st.set('story:card:' + depth, true);
  mod = {
   overlayHTML: chapterCard(chapterTitleFor(depth)),
   flag: 'story-chapter-' + depth
  };
 }

 /* 4. descent whispers — deepening only, max 1 per round */
 const cur = currentLayer(st);
 const prev = st.has('story:layerPrev') ? num(st.get('story:layerPrev'), 1) : 1;
 if (cur > prev) {
  st.set('story:layerPrev', cur);
  const pool = WHISPERS[cur - 1];
  const r = typeof c.rng === 'function' ? c.rng : null;
  const line = pool[(r ? Math.floor(r() * pool.length) : 0) % pool.length];
  speak(c, line);                       /* budget may deny; cosmetic only */
 }

 /* 3. sanctuary lore — escalate by sanctuary:count (written by sanctuary.js) */
 const count = num(st.get('sanctuary:count'), 0);
 const fired = num(st.get('story:sancFired'), 0);
 if (count > fired) {
  st.set('story:sancFired', count);
  const pool = count <= 1 ? SANCTUARY_FIRST
   : count <= 3 ? SANCTUARY_RETURN : SANCTUARY_VETERAN;
  const r = typeof c.rng === 'function' ? c.rng : null;
  const line = pool[(r ? Math.floor(r() * pool.length) : 0) % pool.length];
  speak(c, line);
 }

 return mod;
}

function onAnswer(ctx) {
 const c = ctx || {};
 const rd = c.round | 0;
 if (rd > 0 && rd <= PARITY_ROUNDS) return null;   /* parity C8 */

 const st = S();
 const res = c.res || {};
 const wrong = res.correct === false;

 /* 5a. despair — unique line, once per run, only when SPOKEN (budget-honest) */
 if (wrong && num(c.hp, 100) <= 25 && !st.has('story:despair')) {
  const r = typeof c.rng === 'function' ? c.rng : null;
  if (speak(c, DESPAIR[(r ? Math.floor(r() * DESPAIR.length) : 0) % DESPAIR.length])) {
   st.set('story:despair', true);
  }
 }

 /* 5b. defiance — once per run, after despair, on a streak >= 4 comeback */
 if (st.has('story:despair') && !st.has('story:defiance') && (c.streak | 0) >= 4) {
  const r = typeof c.rng === 'function' ? c.rng : null;
  if (speak(c, DEFIANCE[(r ? Math.floor(r() * DEFIANCE.length) : 0) % DEFIANCE.length])) {
   st.set('story:defiance', true);
  }
 }

 return null;
}

/* ============================ REGISTRATION ================================ */

function boot() {
 const H = root.IQ && root.IQ.Hooks;
 if (H && typeof H.add === 'function') {
  H.add({
   id: 'shadow-story',
   always: true,
   weight: 1,
   handlers: { onRoundStart: onRoundStart, onAnswer: onAnswer }
  });
 } else {
  /* Stage-style queue: survive loading before hooks.js */
  (root.__shadowStoryPending = root.__shadowStoryPending || []).push(function (Hooks) {
   Hooks.add({
    id: 'shadow-story',
    always: true,
    weight: 1,
    handlers: { onRoundStart: onRoundStart, onAnswer: onAnswer }
   });
  });
 }
}
boot();

if (typeof module !== 'undefined' && module.exports) {
 module.exports = {
  onRoundStart: onRoundStart,
  onAnswer: onAnswer,
  chapters: CHAPTERS,
  chaptersExtra: CHAPTERS_EXTRA,
  whispers: WHISPERS,
  layerNames: LAYER_NAMES,
  pools: {
   SANCTUARY_FIRST: SANCTUARY_FIRST, SANCTUARY_RETURN: SANCTUARY_RETURN,
   SANCTUARY_VETERAN: SANCTUARY_VETERAN, DESPAIR: DESPAIR, DEFIANCE: DEFIANCE
  }
 };
}
})();
