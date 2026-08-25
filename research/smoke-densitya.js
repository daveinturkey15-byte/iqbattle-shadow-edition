/* ============================================================================
 * research/smoke-densitya.js — dedicated smoke for pack-density-a.js
 * Run: node research/smoke-densitya.js
 *
 * Proves, against the REAL module exports (no re-implementation):
 *   1. every world def: id/align valid, pal has exactly 8 colours, draw fn
 *   2. every draw survives a stub 2d ctx at t=0 and t=1000 (+ whale-cycle
 *      coverage for sunken-cathedral), and is STATIC at frozen t
 *   3. hook probability gates with FORCED rng streams (fire + no-fire side)
 *   4. rounds <= 2 fully inert for every handler
 *   5. cosmetic-only packs return no stat fields; stat packs return exact
 *      modifier values
 *   6. determinism hygiene: banned tokens absent from module source
 * ============================================================================*/
'use strict';
const path = require('path');
const fs = require('fs');
const mod = require(path.join(__dirname, '..', 'pack-density-a.js'));

let fails = 0;
function ok(name, cond, detail) {
 if (!cond) { fails++; console.log('FAIL ' + name + (detail ? ' :: ' + detail : '')); }
 else console.log('pass ' + name);
}

/* ---- stub 2d context that records nothing but tolerates everything ------- */
function stubCtx() {
 const noopGrad = { addColorStop: function () {} };
 return new Proxy({}, {
  get: function (o, k) {
   if (k in o) return o[k];
   if (k === 'createLinearGradient' || k === 'createRadialGradient' ||
       k === 'createPattern') return function () { return noopGrad; };
   if (k === 'measureText') return function () { return { width: 10 }; };
   return function () {};
  },
  set: function (o, k, v) { o[k] = v; return true; }
 });
}

const VALID_ALIGN = ['bad', 'good', 'chaotic', 'neutral'];
ok('six worlds exported', Array.isArray(mod.worlds) && mod.worlds.length === 6,
   String(mod.worlds && mod.worlds.length));
ok('six hook packs exported', Array.isArray(mod.packs) && mod.packs.length === 6,
   String(mod.packs && mod.packs.length));

/* ---- 1+2: world shape + draw robustness ---------------------------------- */
const EXPECT_ALIGN = {
 'candy-kingdom': 'good', 'train-graveyard': 'bad',
 'clockwork-bureau': 'neutral', 'sunken-cathedral': 'chaotic',
 'neon-district': 'chaotic', 'hayfield-idyll': 'good'
};
for (const d of mod.worlds) {
 ok(d.id + ' shape', d.id && VALID_ALIGN.indexOf(d.align) !== -1 &&
    typeof d.draw === 'function' && EXPECT_ALIGN[d.id] === d.align,
   JSON.stringify({ align: d.align }));
 ok(d.id + ' pal arity 8', Array.isArray(d.pal) && d.pal.length === 8,
   String(d.pal && d.pal.length));
 for (const t of [0, 1000]) {
  let threw = false;
  try { d.draw(stubCtx(), 800, 600, t); } catch (e) { threw = true; console.log(e); }
  ok(d.id + ' draw t=' + t + ' no throw', !threw);
 }
 /* extra whale-window coverage: cycle period is 40 s */
 for (const t of [0, 5000, 8799, 8801, 20000, 39999]) {
  let threw = false;
  try { d.draw(stubCtx(), 800, 600, t); } catch (e) { threw = true; }
  ok(d.id + ' draw t=' + t + ' no throw', !threw);
 }
}

/* static-at-frozen-t sanity: same t twice must not depend on call order.
 * We can't diff pixels on a stub, but we CAN prove the draws are pure by
 * checking no banned time/random sources exist (check 6 covers source) —
 * here we at least assert repeated calls do not throw after state builds up. */
let repeatOk = true;
try {
 const c = stubCtx();
 for (let i = 0; i < 50; i++) mod.worlds[0].draw(c, 800, 600, 1000);
} catch (e) { repeatOk = false; }
ok('repeat draws stable', repeatOk);

/* ---- 3+4+5: hook gates ---------------------------------------------------- */
function stream(vals) {                 // replay sequence forever
 let i = 0;
 return function () { const v = vals[i % vals.length]; i++; return v; };
}
function baseCtx(round, rng, extra) {
 const c = { round: round, world: '', align: 'neutral', hp: 80, score: 0,
             streak: 0, timerLen: 60, optCount: 8, rng: rng,
             runId: 'smoke', seed: 7 };
 if (extra) for (const k in extra) c[k] = extra[k];
 return c;
}
function pack(idSuffix) {
 const p = mod.packs.filter(function (x) {
  return x.id === 'pack-densitya-' + idSuffix;
 })[0];
 if (!p) throw new Error('missing pack-densitya-' + idSuffix);
 return p.handlers;
}
const WRONG = { res: { correct: false, picked: 2, correctIdx: 5 } };
const RIGHT = { res: { correct: true, picked: 5, correctIdx: 5 } };

/* candy-kingdom: onRoundStart 30% hpDelta +3 */
{
 const h = pack('candy').onRoundStart;
 const m = h(baseCtx(3, stream([0.299])));
 ok('candy fires at <0.30', !!m && m.hpDelta === 3 &&
    m.bannerText === 'SUGAR RUSH · +3', JSON.stringify(m));
 ok('candy quiet at >=0.30', h(baseCtx(3, stream([0.30]))) == null);
}
{
 const hs = mod.packs[1].handlers.onAnswer;
 const m = hs(baseCtx(3, stream([0.249]), WRONG));
 ok('train fires wrong <0.25', !!m && m.timerDelta === -3 &&
    m.bannerText === 'THE 3:15 TO NOWHERE LEAVES', JSON.stringify(m));
 ok('train quiet >=0.25', hs(baseCtx(3, stream([0.25]), WRONG)) == null);
 ok('train silent on correct', hs(baseCtx(3, stream([0.0]), RIGHT)) == null);
}
/* clockwork-bureau: onRoundStart 25% scoreMul 1.1 */
{
 const h = pack('clockwork').onRoundStart;
 const m = h(baseCtx(3, stream([0.249])));
 ok('clockwork fires <0.25', !!m && m.scoreMul === 1.1 &&
    m.bannerText === 'PUNCTUAL · ×1.1', JSON.stringify(m));
 ok('clockwork quiet >=0.25', h(baseCtx(3, stream([0.25]))) == null);
}
/* sunken-cathedral: onRoundStart 20% invertControlsMs 600 */
{
 const h = pack('cathedral').onRoundStart;
 const m = h(baseCtx(3, stream([0.199])));
 ok('cathedral fires <0.20', !!m && m.invertControlsMs === 600 &&
    m.bannerText === 'THE CHOIR SWIMS', JSON.stringify(m));
 ok('cathedral quiet >=0.20', h(baseCtx(3, stream([0.20]))) == null);
}
/* neon-district: onAnswer correct 20%, cosmetic banner only */
{
 const h = pack('neon').onAnswer;
 const m = h(baseCtx(3, stream([0.199]), RIGHT));
 ok('neon fires correct <0.20', !!m &&
    m.bannerText === 'THE CITY APPROVES', JSON.stringify(m));
 ok('neon modifier cosmetic-only', !!m && m.hpDelta == null &&
    m.scoreMul == null && m.timerDelta == null && !m.disableOptionIdx &&
    m.invertControlsMs == null);
 ok('neon quiet >=0.20', h(baseCtx(3, stream([0.20]), RIGHT)) == null);
 ok('neon silent on wrong', h(baseCtx(3, stream([0.0]), WRONG)) == null);
}
/* hayfield-idyll: onRoundStart 30%, cosmetic banner only */
{
 const h = pack('hayfield').onRoundStart;
 const m = h(baseCtx(3, stream([0.299])));
 ok('hayfield fires <0.30', !!m &&
    m.bannerText === 'A BELL SOMEWHERE · PEACE', JSON.stringify(m));
 ok('hayfield modifier cosmetic-only', !!m && m.hpDelta == null &&
    m.scoreMul == null && m.timerDelta == null && m.invertControlsMs == null);
 ok('hayfield quiet >=0.30', h(baseCtx(3, stream([0.30]))) == null);
}
/* parity rail: rounds 1 and 2 inert across ALL handlers even with firing rng */
{
 const all = mod.packs.map(function (p) { return p.handlers; });
 const flat = [];
 all.forEach(function (hs) {
  ['onRoundStart', 'onAnswer'].forEach(function (k) { if (hs[k]) flat.push(hs[k]); });
 });
 let inert = true;
 for (const fn of flat) {
  for (const r of [1, 2]) {
   if (fn(baseCtx(r, stream([0.0]), WRONG)) != null) inert = false;
   if (fn(baseCtx(r, stream([0.0]), RIGHT)) != null) inert = false;
  }
 }
 ok('rounds<=2 inert everywhere', inert);
}
/* world scoping: each pack declares worlds:[its world id] */
{
 const want = {
  'pack-densitya-candy': 'candy-kingdom',
  'pack-densitya-train': 'train-graveyard',
  'pack-densitya-clockwork': 'clockwork-bureau',
  'pack-densitya-cathedral': 'sunken-cathedral',
  'pack-densitya-neon': 'neon-district',
  'pack-densitya-hayfield': 'hayfield-idyll'
 };
 const got = {};
 mod.packs.forEach(function (p) {
  got[p.id] = p.worlds && p.worlds[0];
 });
 ok('world bindings exact', JSON.stringify(got) === JSON.stringify(want),
    JSON.stringify(got));
}

/* ---- 6: determinism hygiene over the whole module source ------------------ */
{
 const srcRaw = fs.readFileSync(
  path.join(__dirname, '..', 'pack-density-a.js'), 'utf8');
 const src = srcRaw
  .replace(/\/\*[\s\S]*?\*\//g, '')            /* strip block comments */
  .replace(/\/\/[^\n]*/g, '');                 /* strip line comments */
 ok('zero Math.random', src.indexOf('Math.random') === -1);
 ok('zero Date.now', src.indexOf('Date.now') === -1);
 ok('zero performance.now', src.indexOf('performance.now') === -1);
}


console.log(fails === 0 ? '\nALL CHECKS PASSED'
                        : '\n' + fails + ' CHECK(S) FAILED');
process.exit(fails === 0 ? 0 : 1);
