/* ============================================================================
 * pack-cavern.js — Cave DISCOVERY beat (Dave spec: "you go into a cave and
 * maybe you discover crystals or a dragon — something nice OR something nasty").
 * Vanilla JS/CSS/SVG only. Self-registering IQ.Hooks army pack.
 * ============================================================================
 *
 * REGISTRATION SHAPE (per hooks.js contract):
 *   IQ.Hooks.add({ id:'pack-cavern', worlds:['cave'], weight:1, handlers:{
 *     onRoundStart(ctx), onReveal(ctx) } });
 *   Queued on window.IQ.__hooksPending if hooks.js has not landed yet
 *   (drained once, in order, by hooks.js late-load reconciliation).
 *
 * MECHANIC (one seeded discovery roll per cave round at onRoundStart):
 *   roll = ctx.rng()                       // THE ONLY randomness (mulberry32,
 *                                          // match-seeded — MP parity safe)
 *   roll < 0.35  -> CRYSTAL VEIN           // something nice:
 *                  { hpDelta:+6, bannerText:'CRYSTAL VEIN · THE CAVE GLOWS
 *                    WARM', overlayHTML: corner crystal glints (cosmetic),
 *                    sfx:'chime' }
 *   roll < 0.60  -> DRAGON SHADOW          // something nasty:
 *                  { disableOptionIdx:[ONE blind slot], bannerText:'SOMETHING
 *                    VAST BREATHES · ONE ANSWER IS ASH', overlayHTML:
 *                    top-edge wing silhouette (cosmetic) }
 *   else         -> nothing (quiet cave), no modifier returned.
 *
 * FAIRNESS / DETERMINISM RAILS:
 *   - The dragon NEVER inspects answers. ctx carries no correctIdx pre-reveal
 *     (anti-leak rule), so the disabled slot is a BLIND ctx.rng-seeded pick —
 *     same parity-safe convention as pack-gunship strikes. Exactly one option
 *     is greyed out of optCount (default 8), leaving 7 selectable; fairness
 *     rail "never ALL options" honoured by construction.
 *   - onReveal after a dragon round: wrong answer => cosmetic banner
 *     'THE DRAGON KEEPS WHAT IT BURNED'. Cosmetic ONLY — no hp/score fields,
 *     verdict math stays host-authoritative.
 *   - Zero Math.random()/Date.now()/performance.now() anywhere. Handlers are
 *     pure functions of (ctx, this pack's prefixed Hooks.state keys).
 *   - Inert on rounds <= 2 (parity rule C8): every handler bails unless
 *     ctx.round > 2. Cave rounds are chaotic-align worlds anyway, but the
 *     guard is belt-and-braces.
 *   - Overlays: position:absolute, pointer-events:none, no focus traps,
 *     Escape untouched, coverage far under the ~30% rail (glints are corner
 *     confetti-scale; the wing is a thin top strip ~12% tall). All animation
 *     is inline-CSS and OMITTED entirely when window.IQB_MOTION is falsy
 *     (static silhouettes/glints remain); the one pulse is 2.4s ease-in-out
 *     (<=3 Hz, well under flash caps). Question/answer glyphs untouched.
 *   - Every handler body is wrapped in its own try/catch; a throw can never
 *     kill a round (dispatch swallows too — defence in depth).
 *   - Hooks.state access goes through a guarded resolver: the real per-run
 *     store when present, else a file-local Map shim (standalone node smoke /
 *     pre-hooks load). Whichever definition lands later wins because ALL
 *     reads/writes resolve dynamically per call.
 *
 * SELF TEST: module.exports.selfTest() drives stubbed ctx sequences with
 * FORCED rng streams proving both branches fire, the blind disable idx is
 * always 0..optCount-1, rounds <= 2 stay inert, and the dragon-reveal banner
 * only fires on a wrong answer after a dragon round. Returns {ok, checks}.
 * Smoke harness spirit: research/smoke-*.js / .smoke-pack-gunship.js.
 * ============================================================================*/
(function () {
'use strict';
const root = typeof window !== 'undefined' ? window : globalThis;

const ID = 'pack-cavern';
const WORLD = 'cave';
const CRYSTAL_CHANCE = 0.35;                 // cumulative: crystal [0,0.35)
const DRAGON_CHANCE = 0.60;                  // cumulative: dragon   [0.35,0.60)
                                             // else nothing         [0.60,1)

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
  del: function (k) { return m.delete(String(k)); }
 };
}

function motionAllowed() {
 try { return !(root.IQB_MOTION === false); } catch (_) { return true; }
}

/* ---- CRYSTAL VEIN overlay: seeded glints hugging the four board corners.
 * Diamond spans, pointer-events:none; pulse keyframes only when IQB_MOTION. */
function crystalOverlay(r) {
 const pal = ['#64dfdf', '#80ffdb', '#b8f2e6', '#5e60ce'];
 const anchors = [[1.5, 2], [94, 3], [2.5, 90], [93, 88]]; // x%,y% corner seeds
 let spans = '';
 for (let i = 0; i < 12; i++) {
  const ax = anchors[i % 4][0], ay = anchors[i % 4][1];
  const x = ax + ((r() * 8) - 4);
  const y = ay + ((r() * 8) - 4);
  const s = 5 + (r() * 6);
  const col = pal[(r() * pal.length) | 0];
  const rot = (r() * 90) | 0;
  spans += '<span style="position:absolute;left:' + x.toFixed(1) +
   '%;top:' + y.toFixed(1) + '%;width:' + s.toFixed(1) + 'px;height:' +
   s.toFixed(1) + 'px;background:' + col + ';opacity:.55;transform:rotate(' +
   rot + 'deg);clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)' +
   ';pointer-events:none"></span>';
 }
 const anim = motionAllowed()
  ? '<style>@keyframes cavern-glint{0%,100%{opacity:.18}50%{opacity:.75}}' +
    '.cavern-glint{animation:cavern-glint 2.4s ease-in-out infinite}</style>'
  : '';
 return '<div data-pack="' + ID + '" style="position:absolute;inset:0;' +
  'overflow:hidden;pointer-events:none">' + anim +
  '<div class="cavern-glint" style="position:absolute;inset:0">' + spans +
  '</div></div>';
}

/* ---- DRAGON SHADOW overlay: thin top-edge wing-silhouette strip (~12%).
 * Inline SVG, static (a shadow does not fidget); motion adds one slow bob. */
function dragonOverlay() {
 const anim = motionAllowed()
  ? '<style>@keyframes cavern-wing{0%,100%{transform:translateY(0)}' +
    '50%{transform:translateY(4px)}}</style>' +
    '<div class="cavern-wing" style="position:absolute;top:0;left:0;right:0;'
  : '<div style="position:absolute;top:0;left:0;right:0;';
 return anim + 'height:12%;pointer-events:none">' +
  '<svg width="100%" height="100%" viewBox="0 0 1200 120" ' +
  'preserveAspectRatio="none" aria-hidden="true">' +
  '<path d="M600,118 C500,26 340,10 40,58 C250,66 430,96 600,118 ' +
  'C770,96 950,66 1160,58 C860,10 700,26 600,118 Z" fill="#0a0e18" ' +
  'opacity=".85"/></svg>' +
  '<div style="position:absolute;left:49%;top:78%;width:9px;height:9px;' +
  'border-radius:50%;background:#ffb703;opacity:.5;pointer-events:none">' +
  '</div></div>';
}

/* ---- handlers ------------------------------------------------------------ */

function onRoundStart(ctx) {
 try {
  if (!ctx || typeof ctx.round !== 'number' || ctx.round <= 2) return; // parity C8
  if (typeof ctx.rng !== 'function') return;
  const roll = ctx.rng();

  if (roll < CRYSTAL_CHANCE) {
   /* something nice: warm vein heals a little; glints purely cosmetic */
   return {
    hpDelta: 6,
    bannerText: 'CRYSTAL VEIN · THE CAVE GLOWS WARM',
    overlayHTML: crystalOverlay(ctx.rng),
    sfx: 'chime',
    flag: 'cavern:crystal'
   };
  }

  if (roll < DRAGON_CHANCE) {
   /* something nasty: ONE blind disabled slot. Never reads answers —
    * correctIdx does not exist pre-reveal, exactly like gunship strikes. */
   const optCount = (typeof ctx.optCount === 'number' && ctx.optCount > 0 &&
    isFinite(ctx.optCount)) ? ctx.optCount : 8;
   let idx = Math.floor(ctx.rng() * optCount) % optCount;
   if (!(idx >= 0)) idx = 0;                     // NaN/negative guard
   store().set(ID + ':dragonRound', ctx.round);  // remembered for onReveal
   return {
    disableOptionIdx: [idx],
    bannerText: 'SOMETHING VAST BREATHES · ONE ANSWER IS ASH',
    overlayHTML: dragonOverlay(),
    sfx: 'rumble',
    flag: 'cavern:dragon'
   };
  }

  return;                                        // 40% quiet cave: nothing
 } catch (e) {
  try { console.warn('[' + ID + '] onRoundStart swallowed:', e && e.message || e); } catch (_) {}
  return;
 }
}

function onReveal(ctx) {
 try {
  if (!ctx || typeof ctx.round !== 'number' || ctx.round <= 2) return;
  const s = store();
  if (s.get(ID + ':dragonRound') !== ctx.round) return; // only after THIS dragon round
  s.del(ID + ':dragonRound');
  if (!ctx.res || ctx.res.correct) return;       // wrong answers only
  /* cosmetic only — no hpDelta/scoreDelta/scoring fields whatsoever */
  return {
   bannerText: 'THE DRAGON KEEPS WHAT IT BURNED',
   sfx: 'ash',
   flag: 'cavern:dragon-burn'
  };
 } catch (e) {
  try { console.warn('[' + ID + '] onReveal swallowed:', e && e.message || e); } catch (_) {}
  return;
 }
}

const HANDLERS = { onRoundStart: onRoundStart, onReveal: onReveal };

/* ---- registration (direct add, or canonical pending queue) --------------- */
const PACK = { id: ID, worlds: [WORLD], weight: 1, handlers: HANDLERS };
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
 * no DOM). Proves: crystal branch, dragon branch (blind idx always within
 * 0..optCount-1 across every residue), the quiet 40%, inertness on rounds
 * <= 2, and the dragon-reveal cosmetic banner gating. Throws nothing. */
function selfTest() {
 const checks = [];
 function ok(name, cond, detail) {
  checks.push({ name: name, ok: !!cond, detail: detail || '' });
 }

 /* forced-rng stream factory: replays the given sequence forever */
 function stream(vals) {
  let i = 0;
  return function () { const v = vals[i % vals.length]; i++; return v; };
 }
 function baseCtx(round, rng, extra) {
  const c = { round: round, world: WORLD, align: 'chaotic', hp: 80,
   score: 0, streak: 0, timerLen: 60, optCount: 8, rng: rng,
   runId: 'selftest', seed: 1 };
  if (extra) for (const k in extra) c[k] = extra[k];
  return c;
 }

 /* 1. CRYSTAL VEIN fires: heal + banner + escapable glint overlay */
 const crystalCtx = baseCtx(3, stream([0.10, 0.5, 0.5, 0.5]));
 const cm = HANDLERS.onRoundStart(crystalCtx);
 ok('crystal fires', !!cm && cm.hpDelta === 6 &&
  cm.bannerText === 'CRYSTAL VEIN · THE CAVE GLOWS WARM',
  JSON.stringify(cm && cm.bannerText));
 ok('crystal overlay cosmetic', !!cm && typeof cm.overlayHTML === 'string' &&
  cm.overlayHTML.indexOf('pointer-events:none') !== -1 &&
  cm.overlayHTML.indexOf('<button') === -1);

 /* 2. DRAGON SHADOW fires: exactly one blind disable, banner exact */
 const dm = HANDLERS.onRoundStart(baseCtx(3, stream([0.40, 0.25])));
 ok('dragon fires', !!dm && Array.isArray(dm.disableOptionIdx) &&
  dm.disableOptionIdx.length === 1 &&
  dm.bannerText === 'SOMETHING VAST BREATHES · ONE ANSWER IS ASH',
  JSON.stringify(dm && dm.disableOptionIdx));
 ok('dragon overlay is top strip', !!dm &&
  typeof dm.overlayHTML === 'string' &&
  dm.overlayHTML.indexOf('height:12%') !== -1 &&
  dm.overlayHTML.indexOf('pointer-events:none') !== -1);

 /* 3. blind idx stays in 0..optCount-1 for EVERY rng residue (parity-safe:
 * never derived from answers, so any value is fair game and always legal) */
 let allInRange = true, seen = {};
 for (let k = 0; k < 16; k++) {
  const m = HANDLERS.onRoundStart(baseCtx(3, stream([0.45, k / 16])));
  const v = m && m.disableOptionIdx && m.disableOptionIdx[0];
  seen[v] = true;
  if (typeof v !== 'number' || v < 0 || v > 7 || v !== (v | 0)) allInRange = false;
 }
 ok('disable idx always 0..7', allInRange, Object.keys(seen).join(','));

 /* 4. quiet cave: upper 40% returns nothing */
 ok('40% nothing', HANDLERS.onRoundStart(baseCtx(3, stream([0.90]))) == null);

 /* 5. parity rail: rounds 1 and 2 are inert for every branch */
 const early = HANDLERS.onRoundStart(baseCtx(2, stream([0.10]))) == null &&
  HANDLERS.onRoundStart(baseCtx(1, stream([0.45, 0.25]))) == null;
 ok('rounds<=2 inert', early);

 /* 6. dragon-reveal banner: wrong answer AFTER a dragon round only */
 HANDLERS.onRoundStart(baseCtx(5, stream([0.40, 0.62]))); // arms dragonRound=5
 const burn = HANDLERS.onReveal(baseCtx(5, stream([0]),
  { res: { correct: false, picked: 3, correctIdx: 6 } }));
 ok('dragon keeps what it burned', !!burn &&
  burn.bannerText === 'THE DRAGON KEEPS WHAT IT BURNED' &&
  burn.hpDelta == null && burn.scoreDelta == null && !burn.disableOptionIdx,
  JSON.stringify(burn && burn.bannerText));
 ok('burn is once-per-round',
  HANDLERS.onReveal(baseCtx(5, stream([0]),
   { res: { correct: false, picked: 3, correctIdx: 6 } })) == null);
 ok('no banner on correct answer',
  HANDLERS.onReveal(baseCtx(7, stream([0]),
   { res: { correct: true, picked: 1, correctIdx: 1 } })) == null);
 HANDLERS.onRoundStart(baseCtx(8, stream([0.40, 0.11]))); // arms dragonRound=8
 ok('no banner on undragon round',
  HANDLERS.onReveal(baseCtx(9, stream([0]),
   { res: { correct: false, picked: 2, correctIdx: 4 } })) == null);

 /* 7. determinism hygiene: no banned tokens in any handler source */
 const src = String(onRoundStart) + String(onReveal) +
  String(crystalOverlay) + String(dragonOverlay) + String(store);
 ok('zero Math.random/Date.now', src.indexOf('Math.random') === -1 &&
  src.indexOf('Date.now') === -1 && src.indexOf('performance.now') === -1);

 let allOk = true;
 for (const c of checks) if (!c.ok) allOk = false;
 return { ok: allOk, checks: checks };
}

if (typeof module !== 'undefined' && module.exports) {
 module.exports = { id: ID, worlds: [WORLD], weight: 1, handlers: HANDLERS,
  selfTest: selfTest };
}
})();
