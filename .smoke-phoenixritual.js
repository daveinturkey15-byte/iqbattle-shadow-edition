/* .smoke-phoenixritual.js — behavioral harness for modes/phoenixritual.js
 * (design §8 SEED-PHOENIX RITUAL). Run: node .smoke-phoenixritual.js (exit 0 = pass)
 *
 * Node-safe: exercises the exported pure core (the SAME functions the mounted
 * stage uses for every verdict/payout), plus registration shape via the
 * window.__stagePending queue (IQ.Stage absent here, as pre-integration).
 * DOM beats are exercised by the in-page self-play hook (window.__PHOENIX__). */
'use strict';
const path = require('path');
global.window = globalThis;
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

require(path.join(__dirname, 'modes', 'phoenixritual.js'));
const P = global.window.__PHOENIX__.core;
const pending = global.window.__stagePending || [];

let failures = 0, passes = 0;
function ok(cond, msg) {
  if (!cond) { failures++; console.error('FAIL: ' + msg); }
  else { passes++; console.log('pass: ' + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

/* ---------- registration shape ---------- */
const def = pending.find(d => d.id === 'phoenix-ritual');
ok(def, 'queued registration under __stagePending');
if (def) {
  ok(typeof def.mount === 'function', 'mount(container, ctx) is a function');
  eq(def.weight, 6, 'weight'); // W5: boosted 4->6 so the ritual actually fires
  eq(def.net, 'seed', 'net mode');
  ok(Array.isArray(def.worlds) && def.worlds.includes('heaven') &&
     def.worlds.includes('womb') && def.worlds.includes('stair-of-heaven'),
     'binds heaven / womb / stair-of-heaven');
}

/* ---------- scalars: design §8 numbers ---------- */
eq(P.bandMsFor(1), 250, 'peak band ±250 ms at depth 1');
eq(P.bandMsFor(9), 140, 'peak band tightens to ±140 ms floor');
eq(P.periodFor(1), 4000, 'breathing period 4000 ms (~0.25 Hz) at depth 1');
eq(P.periodFor(20), 2800, 'swell rate floors at 2800 ms');
eq(P.payScaleFor(1), 1, 'depth 1 pays base');
eq(P.payScaleFor(5), 1.4, 'payouts +10%/depth');
eq(P.tierFor(0), 1, 'tier starts at 1');
eq(P.tierFor(3), 2, 'every 3rd ritual raises the tier');
eq(P.tierFor(6), 3, 'tier 3 after six rituals');
eq(P.tierFor(12), 3, 'tier caps at 3');
eq(P.tierMult(1), 1, 'tier 1 multiplier x1');
eq(P.tierMult(2), 1.5, 'tier 2 multiplier x1.5');
eq(P.tierMult(3), 2, 'tier 3 multiplier x2 (cap)');
eq(P.CAP_MS, 18000, '18 s hard cap (4+6+4+4)');

/* ---------- rounding ---------- */
eq(P.roundHalfDown(10.5), 10, 'round-half-down ties go down');
eq(P.roundHalfDown(10.51), 11, 'above tie rounds up');
eq(P.growVerdict(5800, 1), 'full', 'second swell peak also honors the band');
eq(P.growVerdict(5200, 1), 'partial', 'midway between peaks judges by NEAREST peak');
/* ---------- choreography is pure f(t, params) ---------- */
eq(P.swellPhase(0, 4000), 0, 'phase starts empty');
eq(Math.abs(P.swellPhase(1000, 4000) - 0.5) < 1e-9, true, 'phase mid at quarter period');
eq(Math.abs(P.swellPhase(2000, 4000) - 1) < 1e-9, true, 'phase peaks at half period');

/* ---------- THE quantized-band verdict ---------- */
eq(P.growVerdict(null, 1), 'none', 'never released -> none');
eq(P.growVerdict(NaN, 1), 'none', 'non-finite release -> none');
eq(P.growVerdict(2000, 1), 'full', 'dead-on peak -> full');
eq(P.growVerdict(1750, 1), 'full', 'exactly at band edge (250 ms early) -> full');
eq(P.growVerdict(1749, 1), 'partial', 'just outside band -> partial');
eq(P.growVerdict(2250, 1), 'full', 'band edge late -> full');
eq(P.growVerdict(2251, 1), 'partial', 'outside band late -> partial');
eq(P.growVerdict(1390, 9), 'full', 'depth 9: inside tightened band (period 2800)');
eq(P.growVerdict(1200, 9), 'partial', 'depth 9: outside tightened band');

/* ---------- StageResult mapping (design §8 table) ---------- */
function pay(seedKey, thornWon, verdict, tier, depth) {
  return P.computePayout({ seedKey, thornWon, verdict, tier, depth });
}
let r = pay('ember', false, 'full', 1, 1);
ok(r.correct === true && r.points === 40 && r.hpDelta === 0 && r.summary === 'REBORN IN FLAME',
   'ember full yield: +40, REBORN IN FLAME');
r = pay('dew', false, 'full', 1, 1);
ok(r.correct === true && r.points === 0 && r.hpDelta === 12, 'dew full yield: hpDelta +12');
r = pay('thorn', true, 'full', 1, 1);
ok(r.correct === true && r.points === 90 && r.hpDelta === 0, 'thorn gamble won: +90');
r = pay('thorn', false, 'full', 1, 1);
ok(r.correct === true && r.points === 0 && r.hpDelta === -10, 'thorn miss: -10 hp (softer than wrong-answer)');
r = pay('ember', false, 'partial', 1, 1);
ok(r.correct === true && r.points === 20 && r.summary === 'A WEAK BLOOM', 'partial yield x0.5');
r = pay('dew', false, 'partial', 1, 1);
ok(r.hpDelta === 6, 'partial dew: hp halved');
r = pay('ember', false, 'none', 1, 1);
ok(r.correct === false && r.points === 10 && r.summary === 'THE ASH KEEPS ITS SECRET',
   'never released: x0.25 harvest, correct=false');
r = pay('dew', false, 'none', 1, 1);
ok(r.correct === false && r.hpDelta === 3, 'never released dew still mends a quarter');

/* multipliers compose; host-style clamping stays engine-side */
r = pay('dew', false, 'full', 2, 1);
ok(r.hpDelta === 18, 'tier 2 dew: +12 x1.5 = +18');
r = pay('ember', false, 'full', 3, 1);
ok(r.points === 80, 'tier 3 ember: +40 x2 = +80');
r = pay('ember', false, 'full', 1, 5);
ok(r.points === 56, 'depth 5 ember: +40 x1.4 = +56');
r = pay('ember', false, 'partial', 2, 5);
ok(r.points === 42, 'composed: 40 x0.5 x1.5 x1.4 = 42');
r = pay('thorn', false, 'partial', 1, 3);
ok(r.hpDelta === -6, 'negative path scales too: -10 x0.5 x1.2 = -6 (ties down)');
['REBORN IN FLAME', 'A WEAK BLOOM', 'THE ASH KEEPS ITS SECRET'].forEach(s =>
  ok(s.length <= 48, 'summary "' + s + '" within 48 chars'));

console.log('\nphoenixritual: ' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
