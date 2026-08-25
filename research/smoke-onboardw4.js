/* ============================================================================
   research/smoke-onboardw4.js — smoke for pack-onboard-w4.js
   Proves: per-world once-per-run legends, once-per-run depth>=3 intro card,
   rounds<=2 inertness, abyss flag-path (HellHeaven negativeZone), motion
   gating markup, determinism hygiene. Uses the REAL IQ.Hooks dispatch.
   Run: node research/smoke-onboardw4.js
   ============================================================================*/
'use strict';
const path = require('path');
const root = (global) => global;
const H = require(path.join(__dirname, '..', 'hooks.js'));
require(path.join(__dirname, '..', 'pack-onboard-w4.js'));

let failures = 0;
function ok(name, cond, detail) {
  if (!cond) { failures++; console.log('FAIL ' + name + (detail ? ' :: ' + detail : '')); }
  else console.log('ok   ' + name);
}
function findBanner(mods, text) {
  return mods.some(m => m && m.bannerText === text);
}
function ctxOf(depth, world, align, extra) {
  return Object.assign({
    round: depth, depth: depth, world: world || null, align: align || null,
    hp: 100, score: 0, streak: 0, mp: false,
    rng: H.makeRng((depth * 2654435761) >>> 0)
  }, extra || {});
}

/* ---------- 1. first eligible round: legend + intro card together ---------- */
H.beginRun('smoke-ob4-1', 4242);
let mods = H.dispatch('onRoundStart', ctxOf(3, 'ring-mountain', 'chaotic'));
ok('ring-mountain legend fires on first visit',
   findBanner(mods, 'THE EYE WATCHES \u00B7 HALFLING LUCK FAVORS THE BOLD'), JSON.stringify(mods));
const introMod = mods.find(m => m && m.overlayHTML);
ok('intro card fires at depth>=3 (once-per-run)', !!introMod &&
   introMod.overlayHTML.indexOf('WAVE FOUR') !== -1 &&
   introMod.overlayHTML.indexOf('THE WORLD GREWS TEETH') !== -1);
ok('intro overlayMs is 5000 (5s auto-fade)', introMod && introMod.overlayMs === 5000);

/* ---------- 2. once-per-run semantics ---------- */
mods = H.dispatch('onRoundStart', ctxOf(4, 'ring-mountain', 'chaotic'));
ok('ring-mountain legend does NOT repeat',
   !findBanner(mods, 'THE EYE WATCHES \u00B7 HALFLING LUCK FAVORS THE BOLD') &&
   !mods.some(m => m && m.overlayHTML), JSON.stringify(mods));

mods = H.dispatch('onRoundStart', ctxOf(5, 'gold-shrine', 'neutral'));
ok('gold-shrine legend fires on its own first visit',
   findBanner(mods, 'CATCH ALL SIX CRITTERS \u00B7 THE SHRINE REMEMBERS'));
ok('gold-shrine round has no second intro card', !mods.some(m => m && m.overlayHTML));

/* abyss via world id */
mods = H.dispatch('onRoundStart', ctxOf(6, 'abyss-void', 'bad'));
ok('abyss-void legend fires via world id',
   findBanner(mods, 'BELOW ZERO \u00B7 THE ABYSS LENDS LIFE IT WILL RECLAIM'));

/* abyss via hh-negative-zone predicate: deep layer state, ordinary world */
H.state.set('hh:layer', 6); /* layer >= NEG_LAYER -> negativeZone() true */
mods = H.dispatch('onRoundStart', ctxOf(7, 'w1', 'bad'));
ok('abyss legend fires via negative-zone flag path',
   findBanner(mods, 'BELOW ZERO \u00B7 THE ABYSS LENDS LIFE IT WILL RECLAIM'));
mods = H.dispatch('onRoundStart', ctxOf(8, 'w1', 'bad'));
ok('abyss legend still once-per-run after zone path', !findBanner(mods, 'BELOW ZERO'));
H.state.del('hh:layer');

/* sanctuary trigger contract: heaven world OR good align */
mods = H.dispatch('onRoundStart', ctxOf(9, 'heaven', 'good'));
ok('sanctuary legend fires (heaven world)',
   findBanner(mods, 'SANCTUARY \u00B7 THE ORIGINAL LIGHT, BRIEFLY'));
mods = H.dispatch('onRoundStart', ctxOf(10, 'seed-garden', 'neutral'));
ok('no sanctuary legend on neutral round', !findBanner(mods, 'SANCTUARY'));

/* second run: everything resets (beginRun clears runState) */
H.beginRun('smoke-ob4-2', 99);
mods = H.dispatch('onRoundStart', ctxOf(3, 'heaven', 'good'));
ok('new run: legends re-arm and intro re-fires',
   findBanner(mods, 'SANCTUARY \u00B7 THE ORIGINAL LIGHT, BRIEFLY') &&
   mods.some(m => m && m.overlayHTML), JSON.stringify(mods));

/* third run: parity rail — rounds <=2 fully inert, intro waits for depth 3 */
H.beginRun('smoke-ob4-3', 7);
for (let d = 1; d <= 2; d++) {
  for (const w of ['ring-mountain', 'gold-shrine', 'abyss-void', 'heaven']) {
    const m = H.dispatch('onRoundStart', ctxOf(d, w, w === 'heaven' ? 'good' : 'bad'));
    ok('depth ' + d + ' inert for ' + w, !m || m.length === 0, JSON.stringify(m));
  }
}
H.state.set('hh:layer', 6);
const early = H.dispatch('onRoundStart', ctxOf(2, 'w1', 'bad'));
ok('negative zone alone cannot pierce the parity gate', !early || early.length === 0);
mods = H.dispatch('onRoundStart', ctxOf(3, 'w1', 'bad'));
ok('first depth>=3 round in a fresh run carries the intro even without a new world',
   mods.some(m => m && m.overlayHTML), JSON.stringify(mods));

/* ---------- 4. markup rails ---------- */
const card = mods.find(m => m && m.overlayHTML).overlayHTML;
ok('card is pointer-events:none (escapable by construction)',
   card.indexOf('pointer-events:none') !== -1);
ok('card carries reduced-motion static fallback',
   card.indexOf('prefers-reduced-motion') !== -1);
ok('card under engine 2000-char slice limit', card.length < 2000, String(card.length));

/* ---------- 5. determinism hygiene ---------- */
const src = require('fs').readFileSync(
  path.join(__dirname, '..', 'pack-onboard-w4.js'), 'utf8');
ok('zero Math.random/Date.now/performance.now in pack source',
   src.indexOf('Math.random') === -1 && src.indexOf('Date.now') === -1 &&
   src.indexOf('performance.now') === -1);
ok('pack consumes no ctx.rng', src.indexOf('ctx.rng') === -1 && src.indexOf('.rng()') === -1);

console.log(failures ? '\n' + failures + ' FAILURE(S)' : '\nALL PASS');
process.exit(failures ? 1 : 0);
