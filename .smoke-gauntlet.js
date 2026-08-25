/* .smoke-gauntlet.js — behavioral harness for modes/gauntlet.js against the
 * REAL hooks.js in node. Run: node .smoke-gauntlet.js   (exit 0 = pass)
 *
 * Covers (design §9 HORSEMEN GAUNTLET):
 *  - registration shape via window.__stagePending (IQ.Stage absent here)
 *  - depth-scaling curves for all four trials
 *  - seeded ration layout: deterministic, exactly one unfairly-large share
 *  - canonical StageResult aggregation over pass counts
 *  - the 'gauntlet-aftermath' hook consuming gauntlet:* carry keys through
 *    real Hooks.dispatch (roundStart / preAnswer / answer), delete-on-consume */
'use strict';
const path = require('path');
global.window = globalThis;
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const H = require(path.join(__dirname, 'hooks.js'));
require(path.join(__dirname, 'modes', 'gauntlet.js'));
const IQ = global.IQ;
const G = global.window.__GAUNTLET__.core;
const pending = global.window.__stagePending || [];

let failures = 0, passes = 0;
function ok(cond, msg) {
  if (!cond) { failures++; console.error('FAIL: ' + msg); }
  else { passes++; console.log('pass: ' + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

/* ---------- registration shape ---------- */
const def = pending.find(d => d.id === 'gauntlet-horsemen');
ok(def, 'queued registration under __stagePending');
if (def) {
  ok(typeof def.mount === 'function', 'mount(container, ctx) is a function');
  eq(def.net, 'seed', 'net mode seed (counts relay as integers)');
  ok(Array.isArray(def.worlds) && def.worlds.includes('gauntlet-temple'),
     'binds gauntlet-temple only');
}
ok(IQ.Hooks._packs.some(p => p.id === 'gauntlet-aftermath'),
   'aftermath hook registered into real IQ.Hooks');

/* ---------- trial scaling (design §9 depth curve) ---------- */
eq(G.warQuota(1), 8, 'War quota 8 at depth 1');
eq(G.warQuota(5), 12, 'War quota rises to 12');
eq(G.warQuota(50), 12, 'War quota caps at 12');
eq(G.stillMsFor(1), 3000, 'Death stillness 3 s at depth 1');
eq(G.stillMsFor(9), 5000, 'Death stillness grows to 5 s cap');
eq(G.stillMsFor(30), 5000, 'Death stillness never exceeds 5 s');
ok(G.slideMsFor(1) > G.slideMsFor(6), 'Conquest crowns slide faster with depth');
ok(G.slideMsFor(20) >= 1200, 'slide speed floors at a playable pace');
ok(G.famineDeltaFor(1) > G.famineDeltaFor(9), 'Famine share delta shrinks (obvious -> subtle)');
eq(G.famineDeltaFor(1), 6, 'Famine delta starts obvious (+6 g)');
eq(G.TRIAL_BUDGET_MS <= 7300 && G.WIPE_MS === 700, true, '~8 s per trial including wipe');

/* ---------- seeded ration layout ---------- */
const rngA = H.makeRng(0xC0FFEE);
const rngB = H.makeRng(0xC0FFEE);
const layA = G.rationLayout(rngA, 3);
const layB = G.rationLayout(rngB, 3);
eq(JSON.stringify(layA.sizes), JSON.stringify(layB.sizes), 'same seed => byte-identical ration layout');
eq(layA.bigIdx, layB.bigIdx, 'blessed... rather, greedy share index identical');
eq(layA.sizes.length, 8, 'exactly eight rations');
const maxV = Math.max.apply(null, layA.sizes);
eq(layA.sizes[layA.bigIdx], maxV, 'bigIdx points at the largest share');
eq(layA.sizes.filter(v => v === maxV).length, 1, 'the unfair share is UNIQUELY large');
const layD9 = G.rationLayout(H.makeRng(1234), 9);
const smallsD9 = layD9.sizes.filter((_, i) => i !== layD9.bigIdx);
ok(maxV > Math.max.apply(null, smallsD9), 'deep-depth share still strictly larger than every other');

/* ---------- canonical aggregation (ONE StageResult) ---------- */
let agg = G.aggregate(4);
ok(agg.correct === true && agg.points === 30 && agg.hpDelta === 0 &&
   agg.summary === 'ALL FOUR RIDERS PASSED', '4 passes: true, +30, hpDelta 0');
agg = G.aggregate(3);
ok(agg.correct === true && agg.points === 0, '3 passes: true, no bonus points');
agg = G.aggregate(2);
eq(agg.correct, null, '2 passes: NEUTRAL round (null)');
agg = G.aggregate(1);
ok(agg.correct === false, '1 pass: false');
agg = G.aggregate(0);
ok(agg.correct === false && agg.summary === 'NO RIDERS PASSED', '0 passes: false');
['ALL FOUR RIDERS PASSED', 'TWO RIDERS PASSED'].forEach(s =>
  ok(s.length <= 48, 'summary "' + s + '" within 48 chars'));

/* ---------- aftermath hook vs REAL hooks.js ----------
 * Marks written by the stage are consumed next roundStart/preAnswer/answer,
 * emitted as modifier REQUESTS and DELETED (once each). */
H.beginRun('smoke-gauntlet', 1);
const S = H.state;

function flags(mods) {
  return mods.filter(m => m && typeof m.flag === 'string' && m.flag.indexOf('gauntlet-') === 0);
}

/* Conquest: blessed crown -> scoreMul 1.3 on preAnswer, consumed once */
S.set(G.K.conquest, 'crown');
let mods = H.dispatch('preAnswer', { round: 2, world: 'anywhere' });
let f = flags(mods);
ok(f.length === 1 && f[0].scoreMul === 1.3, 'conquest mark -> scoreMul 1.3 request');
mods = H.dispatch('preAnswer', { round: 3, world: 'anywhere' });
eq(flags(mods).length, 0, 'conquest mark deleted after consume (fires once)');
ok(!S.has(G.K.conquest), 'gauntlet:conquest key removed');

/* War pass/fail -> timerDelta on roundStart */
S.set(G.K.war, '+5');
mods = flags(H.dispatch('roundStart', { round: 4 }));
ok(mods.length >= 1 && mods.some(m => m.timerDelta === 5), 'war pass mark -> timerDelta +5');
S.set(G.K.war, '-5');
mods = flags(H.dispatch('roundStart', { round: 5 }));
ok(mods.some(m => m.timerDelta === -5), 'war fail mark -> timerDelta -5');
ok(!S.has(G.K.war), 'gauntlet:war key removed');

/* Death flinch -> hp -10 on round entry; pass writes nothing so nothing fires */
S.set(G.K.death, 'flinch');
mods = flags(H.dispatch('roundStart', { round: 6 }));
ok(mods.some(m => m.hpDelta === -10), 'death flinch mark -> hpDelta -10 on entry');
eq(flags(H.dispatch('roundStart', { round: 7 })).length, 0, 'clean Death pass leaves NO mark to consume');

/* Famine shield: absorbs the NEXT wrong answer's baseline once */
S.set(G.K.famine, 'shield');
mods = flags(H.dispatch('answer', { round: 8, res: { correct: false } }));
ok(mods.some(m => m.hpDelta === 15), 'famine shield -> +15 absorbs the baseline -15 wrong-answer hit');
eq(flags(H.dispatch('answer', { round: 9, res: { correct: false } })).length, 0,
   'shield is single-use');

/* Famine curse: extra -5 on top of baseline once */
S.set(G.K.famine, 'curse');
mods = flags(H.dispatch('answer', { round: 10, res: { correct: false } }));
ok(mods.some(m => m.hpDelta === -5), 'famine curse -> extra -5 (engine adds its own depth-scaled baseline)');

/* correct answers never trigger famine marks */
S.set(G.K.famine, 'shield');
eq(flags(H.dispatch('answer', { round: 11, res: { correct: true } })).length, 0,
   'correct answer does not spend famine marks');
ok(S.has(G.K.famine), 'mark survives until an actual wrong answer');
S.del(G.K.famine);

/* empty store -> silent aftermath */
eq(flags(H.dispatch('roundStart', { round: 12 })).length +
   flags(H.dispatch('preAnswer', { round: 12 })).length, 0,
   'no marks -> no gauntlet modifiers requested');

console.log('\ngauntlet: ' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
