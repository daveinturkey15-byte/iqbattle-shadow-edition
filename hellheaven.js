/* ============================================================================
 * hellheaven.js — IQ Battle: SHADOW · HELL & HEAVEN campaign layer
 * ----------------------------------------------------------------------------
 * SPEC (Dave): "maybe there's a way to go through like 7 layers of hell",
 * limbo/purgatory neutral bands between layers, "in certain parts of hell or
 * heaven you can go into negative health", heaven rounds as genuine relief.
 * SCOPE NOTE: the NUKE beat lives in pack-events.js (W_NUKE -> hp-to-1 +
 * IQ.Align.force('good')) and the abyss visual is worlds-realm.js
 * 'abyss-void' — deliberately NOT duplicated here.
 *
 * MECHANIC (single self-registering module):
 *   1. DESCENT TRACKER — always:true hook pack 'hell-heaven'.
 *      State keys (per-run, IQ.Hooks.state):
 *        hh:runBad           consecutive bad/chaotic rounds
 *        hh:layer            current hell layer 1..7 (+1 per 2 consecutive
 *                            hostile rounds; a good round halves the layer
 *                            (floor) and resets runBad; neutral holds)
 *        hh:negZone          1 when layer >= 6 (negative-health zone)
 *        hh:neutralCount     alternates the LIMBO/PURGATORY band banners
 *        hh:pendingFanfare   layer number awaiting its onReveal sfx
 *        hh:graceArmed       set while layer >= 3; consumed by GRACE OVERFLOWS
 *      Layer banners (bannerText): LAYER n · NAME, names escalate OUTER DARK ->
 *      THE THRONE OF ASH. Cosmetic overlayHTML vignette/embers scales opacity
 *      with layer; pointer-events:none; animation disabled by
 *      prefers-reduced-motion media query and localStorage IQB_MOTION.
 *      onReveal: entering a NEW deeper layer emits { sfx:'hh:layer'+n } once.
 *   2. NEGATIVE-HP ZONES — window.IQ.HellHeaven.negativeZone() is TRUE when
 *      layer >= 6. NOTE FOR MAIN: actual negative-hp support means bypassing
 *      the engine's hp clamp floor; MAIN wires that keyed off
 *      w1.allowNegativeHp OR this negativeZone(). THIS MODULE ONLY exposes the
 *      predicate and emits { flag:'hh-negative-zone' } on round start while
 *      the zone is active.
 *   3. HEAVEN OVERSHIELD — on a good/heaven round start, if the layer was
 *      >= 3 before the reset: emit { hpDelta:+10 } ONCE per descent + banner
 *      'GRACE OVERFLOWS' (engine clamps hpDelta; +10 documented stand-in).
 *
 * DETERMINISM: all gameplay randomness flows ctx.rng (host/client parity);
 * headless fallback is the shared mulberry32 seeded from ctx.seed ^ round.
 * Zero unseeded randomness of any kind. This pack rolls no probability windows
 * at all (the tracker is fully deterministic given the align sequence).
 *
 * FAIRNESS RAILS: parity C8 — fully inert on rounds 1-2 (round-gated). No
 * question/answer glyphs touched; overlays escapable-by-nature (pure paint,
 * pointer-events:none); flashes are slow fades, no strobe; no text < 11px.
 *
 * INTEGRATION (Main): load AFTER hooks.js and AFTER worlds.js:
 *   <script src="hooks.js"></script>
 *   <script src="worlds.js"></script>
 *   <script src="hellheaven.js"></script>
 * Consumes: IQ.Hooks.state, IQ.Hooks.makeRng.
 * Exposes: window.IQ.HellHeaven { layer, negativeZone }.
 * ==========================================================================*/
(function () {
'use strict';
const root = typeof window !== 'undefined' ? window : globalThis;

/* ---- tuning constants ---- */
const MAX_LAYER = 7;
const NEG_LAYER = 6;         /* layer at/after which negative-hp zones bite */
const GRACE_LAYER = 3;       /* descend here or deeper to arm GRACE OVERFLOWS */
const PARITY_ROUNDS = 2;     /* C8: inert through round 2 */

/* ---- the seven layers, escalating ---- */
const LAYERS = [
 { name: 'OUTER DARK',        quip: 'the door shuts behind you' },
 { name: 'BURNING SANDS',     quip: 'mind the glass' },
 { name: 'THE RUSTED NAILS',  quip: 'barefoot weather' },
 { name: 'SERPENT WARRENS',   quip: 'they know your name now' },
 { name: 'THE SCREAMING FOUNDRY', quip: 'the machines are unionised' },
 { name: 'THE BLACK MARROW',  quip: 'light comes here to die' },
 { name: 'THE THRONE OF ASH', quip: 'someone is expecting you' }
];

/* ---- seeded PRNG (shared convention: mulberry32, mirrors hooks.js) ---- */
function makeRng(seed) {
 let a = seed >>> 0;
 return function () {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
 };
}
function hashSeed(s) {
 s = String(s == null ? '' : s);
 let h = 2166136261;
 for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
 return h >>> 0;
}
function rngFor(ctx) {
 /* parity-critical: ctx.rng first; seeded fallback ONLY headless */
 if (ctx && typeof ctx.rng === 'function') return ctx.rng;
 const H = root.IQ && root.IQ.Hooks;
 if (H && typeof H.makeRng === 'function') {
  const seed = ctx && ctx.seed != null ? ctx.seed : 'iqb';
  const round = ((ctx && ctx.round) | 0) || 0;
  return H.makeRng(hashSeed(seed) ^ Math.imul(round + 1, 2654435761));
 }
 return makeRng(hashSeed((ctx && ctx.seed) || 'iqb') ^ Math.imul((((ctx && ctx.round) | 0) || 0) + 1, 2654435761));
}

/* ---- state resolution: live Hooks.state in browser, local shim headless ---- */
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

/* ---- cosmetic overlay: vignette + embers, opacity scales with layer ---- */
function overlayFor(layer, seed) {
 const op = Math.min(0.92, 0.22 + layer * 0.1).toFixed(2);
 const motionOk = typeof root.IQB_MOTION === 'undefined' || !!root.IQB_MOTION;
 let html = '<div class="hh-overlay" style="position:absolute;inset:0;pointer-events:none;' +
  'box-shadow:inset 0 0 ' + (60 + layer * 22) + 'px ' + (18 + layer * 6) + 'px rgba(0,0,0,' + op + ');' +
  'background:radial-gradient(ellipse at 50% 46%,rgba(107,75,216,0) 42%,rgba(10,6,18,' + (op * 0.55).toFixed(2) + ') 100%)">';
 if (motionOk) {
  const r = rngFor({ seed: 'hh-layer-' + layer + ':' + (seed || ''), round: layer });
  const n = 8 + layer * 2;                     /* embers thicken as you sink */
  let bits = '<style>@media (prefers-reduced-motion:reduce){.hh-ember{animation:none!important}}' +
   '@keyframes hhRise{from{transform:translateY(0);opacity:.85}to{transform:translateY(-70px);opacity:0}}</style>';
  for (let i = 0; i < n; i++) {
   const left = (r() * 96 + 2).toFixed(1);
   const dur = (2.6 + r() * 3.4).toFixed(2);
   const delay = (r() * dur).toFixed(2);
   const sz = (2 + r() * 3).toFixed(1);
   bits += '<span class="hh-ember" style="position:absolute;bottom:-6px;left:' + left +
    '%;width:' + sz + 'px;height:' + sz + 'px;border-radius:50%;' +
    'background:rgba(184,166,255,' + (0.25 + layer * 0.06).toFixed(2) + ');' +
    'animation:hhRise ' + dur + 's linear ' + delay + 's infinite;pointer-events:none"></span>';
  }
  html += bits;
 }
 html += '</div>';
 return html;
}

/* ---- flagsOut: single flag -> string, several -> truthy object ---- */
function flagsOut(list) {
 if (!list.length) return undefined;
 if (list.length === 1) return list[0];
 const o = {};
 for (const f of list) o[f] = true;
 return o;
}

/* ============================ DESCENT TRACKER ============================= */

function applyNegZone(st, layer, flags) {
 const active = layer >= NEG_LAYER;
 st.set('hh:negZone', active ? 1 : 0);
 if (active) flags.push('hh-negative-zone');
}

function onRoundStart(ctx) {
 const c = ctx || {};
 /* parity C8: pristine through round 2 */
 const rd = c.round | 0;
 if (rd > 0 && rd <= PARITY_ROUNDS) return null;

 const st = S();
 const align = c.align;
 const prevLayer = Math.max(1, Math.min(MAX_LAYER, num(st.get('hh:layer'), 1)));
 if (prevLayer >= GRACE_LAYER) st.set('hh:graceArmed', true);

 const out = {};
 const flags = [];

 if (align === 'bad' || align === 'chaotic') {
  const runBad = num(st.get('hh:runBad'), 0) + 1;
  st.set('hh:runBad', runBad);
  st.del('hh:neutralCount');

  let layer = prevLayer;
  if (runBad % 2 === 0 && layer < MAX_LAYER) {
   layer++;
   st.set('hh:pendingFanfare', layer);       /* onReveal fans the horn */
  }
  st.set('hh:layer', layer);

  out.bannerText = 'LAYER ' + layer + ' \u00b7 ' + LAYERS[layer - 1].name;
  out.overlayHTML = overlayFor(layer, c.seed);
  applyNegZone(st, layer, flags);

  const f = flagsOut(flags);
  if (f !== undefined) out.flag = f;
  return Object.keys(out).length ? out : null;
 }

 if (align === 'good' || String(c.world || '') === 'heaven') {
  /* HEAVEN OVERSHIELD — once per descent, only after a deep run */
  if (prevLayer >= GRACE_LAYER && st.has('hh:graceArmed')) {
   st.del('hh:graceArmed');
   out.hpDelta = 10;
   out.bannerText = 'GRACE OVERFLOWS';
   out.sfx = 'chime';
   flags.push('hh-grace');
  }
  st.set('hh:runBad', 0);
  const halved = Math.max(1, Math.floor(prevLayer / 2));
  st.set('hh:layer', halved);
  st.del('hh:pendingFanfare');               /* climbing out: no fanfare */
  applyNegZone(st, halved, flags);
  const f = flagsOut(flags);
  if (f !== undefined) out.flag = f;
  return Object.keys(out).length ? out : null;
 }

 /* NEUTRAL — the LIMBO/PURGATORY band: everything holds */
 const nc = num(st.get('hh:neutralCount'), 0) + 1;
 st.set('hh:neutralCount', nc);
 return {
  bannerText: (nc % 2 === 1)
   ? 'LIMBO \u00b7 THE WAITING FLOOR'
   : 'PURGATORY \u00b7 ASH AND ECHO'
 };
}

function onReveal() {
 const st = S();
 const pending = num(st.get('hh:pendingFanfare'), 0);
 if (!pending) return null;
 st.del('hh:pendingFanfare');
 return { sfx: 'hh:layer' + pending, flag: 'hh-layer-' + pending };
}

/* ============================ PUBLIC API ================================== */

const HellHeaven = {
 /* current hell layer, 1..7 (default 1 before any tracked round) */
 layer: function () {
  return Math.max(1, Math.min(MAX_LAYER, num(S().get('hh:layer'), 1)));
 },
 /* TRUE in the deepest bands (layer >= 6): Main may allow negative hp here.
 * Enabling negative hp itself (clamp bypass keyed off w1.allowNegativeHp OR
 * this predicate) is MAIN's engine wiring job — see header note. */
 negativeZone: function () { return HellHeaven.layer() >= NEG_LAYER; }
};

/* ============================ REGISTRATION ================================ */

function boot() {
 root.IQ = root.IQ || {};
 root.IQ.HellHeaven = HellHeaven;

 const H = root.IQ.Hooks;
 if (H && typeof H.add === 'function') {
  H.add({
   id: 'hell-heaven',
   always: true,
   weight: 1,
   handlers: {
    onRoundStart: onRoundStart,
    onReveal: onReveal
   }
  });
 }
 /* NOTE: no world registered here — 'abyss-void' (worlds-realm.js) already
 * covers Dave's abyss visual; registering a near-name twin would collide. */
}
boot();

if (typeof module !== 'undefined' && module.exports) {
 module.exports = {
  onRoundStart: onRoundStart,
  onReveal: onReveal,
  api: HellHeaven,
  layers: LAYERS
 };
}
})();
