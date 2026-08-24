/* Headless smoke for pack-undead.js — pure paths only (no DOM).
 * Verifies: registration, determinism of hexes/beat params from ctx.rng,
 * acid-rain caps + 60% relent rule, spell cost/effect modifiers. */
'use strict';
const path = require('path');
const root = globalThis;

root.IQ = {};
require(path.join(__dirname, 'hooks.js'));
const H = root.IQ.Hooks;
const registered = [];
root.IQ.Worlds = { register: (w) => registered.push(w.id) };

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function ctxOf(world, round, seed) {
  return { world, round, runId: 'smoke', align: 'bad', hp: 100, score: 0, streak: 1,
           timerLen: 30, optCount: 8, rng: mulberry(seed), seed };
}

let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('FAIL:', msg); } else console.log('ok:', msg); }
const flat = (mods) => mods.reduce((a, m) => a.concat(m), []);
const hexMod = (mods) => mods.filter((m) => String(m.flag || '').indexOf('witch-hex:') === 0)[0];

require(path.join(__dirname, 'pack-undead.js'));

ok(registered.join(',') === 'necro-dance,witch-hut,wizard-duel,acid-storm', 'four worlds registered');
for (const id of ['necro-dance-beat', 'witch-hex', 'duel-spells', 'acid-storm-rain'])
  ok(H._packs.some((p) => p.id === id), 'pack registered: ' + id);

H.beginRun('smoke', 42);

/* --- witch hex determinism + one-hex-per-round --- */
const hexA = hexMod(H.dispatch('roundStart', ctxOf('witch-hut', 3, 777)));
const hexB = hexMod(H.dispatch('roundStart', ctxOf('witch-hut', 3, 777)));
ok(hexA && hexB && hexA.flag === hexB.flag, 'hex choice deterministic from rng (' + hexA.flag + ')');
ok(hexA.sfx === 'cackle', 'cackle stinger at round start');
const kinds = {};
for (let r2 = 1; r2 <= 60; r2++) {
  const k = String((hexMod(H.dispatch('roundStart', ctxOf('witch-hut', r2, 1000 + r2))) || {}).flag || '').split(':')[1];
  kinds[k] = (kinds[k] || 0) + 1;
}
ok(kinds.keyswap > 0 && kinds.fog > 0 && kinds.newt > 0, 'all three hexes occur: ' + JSON.stringify(kinds));
let fogSeen = null;
for (let rf = 61; rf < 160 && !fogSeen; rf++) {
  const m = hexMod(H.dispatch('roundStart', ctxOf('witch-hut', rf, 40000 + rf)));
  if (m && m.flag === 'witch-hex:fog') fogSeen = m;
}
ok(fogSeen && fogSeen.overlayHTML.indexOf('pointer-events:none') >= 0 && fogSeen.overlayMs >= 1000,
   'fog overlay pointer-events none, persistent');
let newtSeen = null;
for (let rn = 161; rn < 260 && !newtSeen; rn++) {
  const m = hexMod(H.dispatch('roundStart', ctxOf('witch-hut', rn, 60000 + rn)));
  if (m && m.pickup) newtSeen = m;
}
ok(newtSeen && newtSeen.pickup.kind === 'health' && newtSeen.pickup.value === 5,
   'eye of newt = health pickup +5');

/* --- beat scoring shapes --- */
H.beginRun('smoke3', 9);
H.dispatch('roundStart', ctxOf('necro-dance', 4, 31));
const pa = flat(H.dispatch('preAnswer', ctxOf('necro-dance', 4, 31)));
ok(pa.some((m) => m.scoreMul === 1.15 || m.scoreMul === 0.9),
   'beat scoring returns 1.15 or 0.9, got ' + JSON.stringify(pa));

const src = require('fs').readFileSync(path.join(__dirname, 'pack-undead.js'), 'utf8');
ok(src.includes('METRONOME STEADY'), 'motion-off static metronome banner present');
ok(!/Math\.random\s*\(/.test(src), 'zero Math.random calls in file');

/* --- acid rain --- */
H.beginRun('smoke4', 55);
H.state.set('acid-storm:runDmg', 0);
const rm = flat(H.dispatch('roundStart', ctxOf('acid-storm', 5, 1234)));
ok(rm.some((m) => typeof m.overlayHTML === 'string' && m.overlayHTML.includes('pointer-events:none')),
   'rain visual ships as pointer-events:none overlayHTML');
ok(/ROUND_CAP = 4/.test(src) && /RUN_CAP = 4/.test(src), 'exposure capped -4 (round & run)');
ok(src.includes('0.6 * len') && /TICK_EVERY = 4/.test(src), 'relent threshold 60%, tick every 4s');

/* --- duel spells --- */
H.beginRun('smoke5', 88);
ok(Array.isArray(H.dispatch('interlude', ctxOf('wizard-duel', 6, 1))), 'interlude safe headless');
H.state.set('duel-spells:pending', { spell: 'haste', paid: 15 });
let dm = flat(H.dispatch('roundStart', ctxOf('wizard-duel', 7, 2)));
ok(dm.some((m) => m.timerDelta === 6 && m.scoreDelta === -15), 'haste: timerDelta+6, scoreDelta-15');
H.state.set('duel-spells:streak', 3);
H.state.set('duel-spells:pending', { spell: 'scorch', paid: 0 });
dm = flat(H.dispatch('roundStart', ctxOf('wizard-duel', 8, 3)));
ok(dm.some((m) => m.disableWrongRandom === 2 && !m.scoreDelta), 'scorch free at streak>=3: disableWrongRandom 2, no charge');
H.state.set('duel-spells:pending', { spell: 'shield', paid: 15 });
dm = flat(H.dispatch('roundStart', ctxOf('wizard-duel', 9, 4)));
ok(dm.some((m) => typeof m.bannerText === 'string' && m.bannerText.indexOf('SHIELD UP') >= 0), 'shield armed banner');
const actx = ctxOf('wizard-duel', 9, 4); actx.res = { correct: false, picked: 0, correctIdx: 1 };
const am = flat(H.dispatch('answer', actx));
ok(am.some((m) => m.hpDelta === 15), 'shield forgives first wrong (+15)');
const am2 = flat(H.dispatch('answer', actx));
ok(!am2.some((m) => m.hpDelta === 15), 'shield forgives ONLY the first wrong');
const rv = flat(H.dispatch('reveal', actx));
ok(Array.isArray(rv), 'reveal safe (disarms unused shield)');

console.log(fails ? '\nSMOKE FAILED: ' + fails : '\nSMOKE PASSED');
process.exit(fails ? 1 : 0);
