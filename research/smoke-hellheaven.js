/* ============================================================================
 * smoke-hellheaven.js — headless harness for hellheaven.js
 * Run: node research/smoke-hellheaven.js
 * Stubs window.IQ.{Hooks,Worlds}, requires the module, then drives fake ctx
 * sequences through the real handlers and asserts the HELL & HEAVEN contract
 * (descent tracker + neutral bands + grace overshield + negative-zone
 * predicate; nuke/abyss deliberately OUT of scope — owned by pack-events.js /
 * worlds-realm.js per Main's scope correction).
 * ==========================================================================*/
'use strict';
const path = require('path');
const FILE = path.join(__dirname, '..', 'hellheaven.js');

/* ---- stub harness ---- */
const registeredPacks = [];
const registeredWorlds = {};
const store = new Map();
function mulberry32(seed) {
 let a = seed >>> 0;
 return function () {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
 };
}
global.window = global; // module targets `window` when present
global.IQ = {
 Hooks: {
  add(p) { registeredPacks.push(p); },
  makeRng: mulberry32,
  state: {
   get: k => store.get(k),
   set: (k, v) => { store.set(k, v); return v; },
   has: k => store.has(k),
   del: k => store.delete(k)
  }
 },
 Worlds: { register(w) { if (w && w.id && !registeredWorlds[w.id]) registeredWorlds[w.id] = w; } }
};

const HH = require(FILE);
const st = global.IQ.Hooks.state;

let pass = 0, fail = 0;
function ok(name, cond) {
 if (cond) { pass++; console.log('  ok  ' + name); }
 else { fail++; console.log('FAIL  ' + name); }
}
function resetRun() { store.clear(); }
function seq(vals) { // deterministic ctx.rng: replays vals then repeats last
 let i = 0;
 return () => vals[Math.min(i++, vals.length - 1)];
}
function hostile(n) {
 return { round: n, align: 'bad', world: 'hell', rng: seq([0.99]), seed: 'smoke' };
}

/* ---- 1. registration shape ---- */
console.log('[registration]');
ok("pack 'hell-heaven' registered always:true",
   registeredPacks.some(p => p.id === 'hell-heaven' && p.always === true));
ok('onRoundStart + onReveal handlers present',
   (() => { const p = registeredPacks.find(p => p.id === 'hell-heaven');
            return !!(p && typeof p.handlers.onRoundStart === 'function' &&
                            typeof p.handlers.onReveal === 'function'); })());
ok('registers NO world (abyss-void already owned by worlds-realm.js)',
   Object.keys(registeredWorlds).length === 0 && registeredWorlds['abyss'] === undefined);
ok('api exposes layer() + negativeZone() only',
   typeof global.IQ.HellHeaven.layer === 'function' &&
   typeof global.IQ.HellHeaven.negativeZone === 'function' &&
   global.IQ.HellHeaven.forceHeavenNext === undefined &&
   global.IQ.HellHeaven.consumeForceHeaven === undefined);
ok('no Math.random / Date.now in module source',
   !/Math\.random|Date\.now/.test(require('fs').readFileSync(FILE, 'utf8')));
ok('no nuke state keys written by module source',
   !/hh:nukeFired|hh:forceHeaven/.test(require('fs').readFileSync(FILE, 'utf8')));

/* ---- 2. layer progression over consecutive bad rounds ---- */
console.log('[descent]');
resetRun();
let m;
// parity gate: rounds 1-2 inert
m = HH.onRoundStart(hostile(1));
ok('round 1 inert (parity C8)', m === null || m === undefined);
m = HH.onRoundStart({ round: 2, align: 'bad', world: 'hell', rng: seq([0.9]), seed: 's' });
ok('round 2 inert (parity C8)', m === null || m === undefined);

// counters start at round 3 -> layers run 1,2,2,3,3,...,7,7,7
const expected = [1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 7];
let got = [];
for (let r = 3; r <= 16; r++) {
 m = HH.onRoundStart(hostile(r));
 got.push(global.IQ.HellHeaven.layer());
 ok('round ' + r + ' banner names LAYER ' + expected[r - 3],
    new RegExp('^LAYER ' + expected[r - 3] + ' \\u00b7 ').test(m.bannerText));
 ok('round ' + r + ' carries cosmetic overlay (pointer-events none)',
    typeof m.overlayHTML === 'string' && m.overlayHTML.indexOf('pointer-events:none') !== -1);
}
ok('layers climb one step per 2 consecutive hostile rounds, capped at 7',
   JSON.stringify(got) === JSON.stringify(expected));

// fanfare on reveal after entering each NEW deeper layer
resetRun();
HH.onRoundStart(hostile(3));                              // layer stays 1
ok('no fanfare while layer holds at 1', HH.onReveal() === null);
HH.onRoundStart(hostile(4)); HH.onRoundStart(hostile(5)); // -> layer 2
let fan = HH.onReveal();
ok('fanfare sfx hh:layer2 on first deeper reveal',
   fan && fan.sfx === 'hh:layer2' && fan.flag === 'hh-layer-2');
ok('fanfare consumed once', HH.onReveal() === null);

/* ---- 3. good round halves the layer + heaven grace overshield ---- */
console.log('[ascent/grace]');
// continue from layer 2 above; push to 4 to arm grace
for (let r = 6; r <= 9; r++) HH.onRoundStart(hostile(r));   // -> 3,4,4... layer 4
ok('layer 4 reached', global.IQ.HellHeaven.layer() === 4);
m = HH.onRoundStart({ round: 10, align: 'good', world: 'heaven', rng: seq([]), seed: 's' });
ok('good round halves layer 4 -> 2 and resets runBad',
   global.IQ.HellHeaven.layer() === 2 && st.get('hh:runBad') === 0);
ok('grace overshield +10 with GRACE OVERFLOWS banner',
   m && m.hpDelta === 10 && m.bannerText === 'GRACE OVERFLOWS');
m = HH.onRoundStart({ round: 11, align: 'good', world: 'heaven', rng: seq([]), seed: 's' });
ok('second heaven round: no repeat grace, layer 2 -> 1',
   !(m && m.hpDelta) && global.IQ.HellHeaven.layer() === 1);
resetRun();
HH.onRoundStart(hostile(3));                                // shallow: layer 1
m = HH.onRoundStart({ round: 4, align: 'good', world: 'ocean', rng: seq([]), seed: 's' });
ok('shallow good round (< layer 3): no grace fired',
   !(m && m.hpDelta) && !(m && m.flag));

/* ---- 4. limbo/purgatory neutral band ---- */
console.log('[neutral band]');
resetRun();
HH.onRoundStart(hostile(3));
m = HH.onRoundStart({ round: 4, align: 'neutral', world: 'limbo', rng: seq([]), seed: 's' });
ok('first neutral banner LIMBO', m && m.bannerText === 'LIMBO \u00b7 THE WAITING FLOOR');
ok('neutral holds everything (still layer 1)', global.IQ.HellHeaven.layer() === 1);
m = HH.onRoundStart({ round: 5, align: 'neutral', world: 'purgatory', rng: seq([]), seed: 's' });
ok('second neutral banner PURGATORY (alternates by count)',
   m && m.bannerText === 'PURGATORY \u00b7 ASH AND ECHO');
m = HH.onRoundStart(hostile(6));
ok('hostile resumes counting across the band (runBad continues -> LAYER 2)',
   /^LAYER 2 \u00b7 /.test(m.bannerText) && global.IQ.HellHeaven.layer() === 2);

/* ---- 5. negative zone predicate ---- */
console.log('[negative zones]');
resetRun();
for (let r = 3; r <= 11; r++) HH.onRoundStart(hostile(r));   // -> layer 5
ok('layer 5: negativeZone false', global.IQ.HellHeaven.negativeZone() === false);
ok("state hh:negZone reads 0 at layer 5", st.get('hh:negZone') === 0);
HH.onRoundStart(hostile(12));                                // -> 6
ok('layer 6: negativeZone true', global.IQ.HellHeaven.negativeZone() === true);
ok("state hh:negZone reads 1 at layer 6", st.get('hh:negZone') === 1);
m = HH.onRoundStart(hostile(13));
ok('negative zone emits flag hh-negative-zone',
   m && m.flag === 'hh-negative-zone');
m = HH.onRoundStart({ round: 14, align: 'good', world: 'heaven', rng: seq([]), seed: 's' });
ok('climb-out clears zone (layer 3, negZone 0, grace fires)',
   global.IQ.HellHeaven.negativeZone() === false && st.get('hh:negZone') === 0 &&
   m.flag === 'hh-grace');

/* ---- summary ---- */
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
