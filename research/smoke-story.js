/* Headless smoke for pack-story.js — pure paths only (no DOM).
 * Verifies: parity inertness rounds 1-2, once-per-threshold chapter cards,
 * sanctuary lore escalating by 'sanctuary:count', layer whispers on
 * deepening only, despair/defiance fire exactly once per run, DemonSay
 * budget honesty (denied say does not consume once-flags), determinism
 * surface (no Math.random, line length caps). */
'use strict';
const path = require('path');
const root = globalThis;

root.IQ = {};
require(path.join(__dirname, '..', 'hooks.js'));
const H = root.IQ.Hooks;
root.IQ.Worlds = { register: () => {} };

function mulberry(seed) {
 let a = seed >>> 0;
 return function () {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
 };
}

/* capture every line our pack speaks */
let spoken = [];
root.IQ.DemonSay = { say: (t) => { spoken.push(t); return true; } };

require(path.join(__dirname, '..', 'pack-story.js'));
const P = require(path.join(__dirname, '..', 'pack-story.js'));

let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('FAIL:', msg); } else console.log('ok:', msg); }
const flat = (mods) => mods.reduce((a, m) => a.concat(m), []);
function ctxOf(round, extra) {
 return Object.assign({
  round: round, depth: round, world: '', align: 'neutral',
  hp: 100, score: 0, streak: 0, rng: mulberry(round * 31 + 7)
 }, extra || {});
}
const cardsIn = (mods) => flat(mods).filter((m) => m.flag && String(m.flag).indexOf('story-chapter-') === 0);
const lastSpoken = () => spoken[spoken.length - 1];

/* --- registration --- */
ok(H._packs.some((p) => p.id === 'shadow-story'), "hook pack registered: shadow-story");

/* --- parity C8: inert rounds 1-2 --- */
H.beginRun('smoke-story', 42);
spoken.length = 0;
ok(flat(H.dispatch('roundStart', ctxOf(1))).length === 0, 'round 1 fully inert');
ok(flat(H.dispatch('roundStart', ctxOf(2))).length === 0, 'round 2 fully inert');
H.dispatch('answer', ctxOf(2, { res: { correct: false, picked: 0, correctIdx: 1 }, hp: 10 }));
ok(spoken.length === 0, 'answer beat inert on round 2');

/* --- chapter cards: once per threshold, none between --- */
H.beginRun('smoke2', 77);
let c5 = cardsIn(H.dispatch('roundStart', ctxOf(5)));
ok(c5.length === 1 && c5[0].overlayHTML.indexOf('CHAPTER II \u00b7 THE LONG STAIR') >= 0,
   'depth 5 fires CHAPTER II card');
ok(cardsIn(H.dispatch('roundStart', ctxOf(5))).length === 0, 'depth 5 card fires only ONCE');
for (let r = 6; r <= 9; r++)
  ok(cardsIn(H.dispatch('roundStart', ctxOf(r))).length === 0, 'no card at depth ' + r);
let c10 = cardsIn(H.dispatch('roundStart', ctxOf(10)));
ok(c10.length === 1 && c10[0].overlayHTML.indexOf('CHAPTER III') >= 0, 'depth 10 fires CHAPTER III once');
let c20 = null;
for (let r = 11; r <= 20; r++) { const m = H.dispatch('roundStart', ctxOf(r)); if (r === 20) c20 = m; }
c20 = cardsIn(c20);
ok(c20.length === 1 && c20[0].overlayHTML.indexOf('CHAPTER V') >= 0, 'depth 20 fires CHAPTER V once');
const cardHTML = c5[0].overlayHTML;
ok(cardHTML.indexOf('pointer-events:none') >= 0, 'card overlay pointer-events:none (escapable)');
ok(cardHTML.indexOf('prefers-reduced-motion') >= 0 && cardHTML.indexOf('animation:none') >= 0,
   'card static under prefers-reduced-motion');
ok(/iqStoryFade 4s/.test(cardHTML), 'card auto-fades over 4s via CSS');
ok(!/Math\.random/.test(cardHTML), 'no Math.random in emitted markup');

/* beyond the fixed table: deterministic seeded pick */
H.beginRun('smoke2b', 78);
const c35a = cardsIn(H.dispatch('roundStart', ctxOf(35)))[0].overlayHTML;
H.beginRun('smoke2c', 79);
const c35b = cardsIn(H.dispatch('roundStart', ctxOf(35)))[0].overlayHTML;
ok(c35a.indexOf('<div') >= 0 && c35a === c35b, 'depth 35 title deterministic across runs');

/* --- sanctuary lore escalates by sanctuary:count, once per value --- */
H.beginRun('smoke3', 91);
H.state.set('sanctuary:count', 1);
spoken.length = 0;
H.dispatch('roundStart', ctxOf(4, { align: 'good' }));
ok(spoken.length === 1 && P.pools.SANCTUARY_FIRST.indexOf(lastSpoken()) >= 0 &&
   lastSpoken().indexOf('The light kept your seat') >= 0,
   'first sanctuary visit speaks first-tier continuity line');
H.dispatch('roundStart', ctxOf(5, { align: 'good' }));
ok(spoken.length === 1, 'same count value never re-speaks');
H.state.set('sanctuary:count', 2);
H.dispatch('roundStart', ctxOf(6, { align: 'good' }));
ok(P.pools.SANCTUARY_RETURN.indexOf(lastSpoken()) >= 0, 'second visit escalates to RETURN tier');
H.state.set('sanctuary:count', 5);
H.dispatch('roundStart', ctxOf(7, { align: 'good' }));
ok(P.pools.SANCTUARY_VETERAN.indexOf(lastSpoken()) >= 0, 'fifth visit escalates to VETERAN tier');

/* --- layer whispers: deepening only --- */
H.beginRun('smoke4', 101);
spoken.length = 0;
H.state.set('hh:layer', 1);                    /* baseline OUTER DARK: not a deepening */
H.dispatch('roundStart', ctxOf(3));
ok(spoken.length === 0, 'no whisper at baseline layer 1 (deepening-only)');
H.state.set('hh:layer', 2);
H.dispatch('roundStart', ctxOf(4));
ok(spoken.length === 1 && P.whispers[1].indexOf(lastSpoken()) >= 0 &&
   lastSpoken().indexOf('BURNING SANDS') >= 0, 'deepen to 2 whispers BURNING SANDS');
H.state.set('hh:layer', 2);
H.dispatch('roundStart', ctxOf(5));
ok(spoken.length === 1, 'held layer emits no further whisper');
H.state.set('hh:layer', 4);
H.dispatch('roundStart', ctxOf(6));
ok(P.whispers[3].indexOf(lastSpoken()) >= 0,
   'deepen to 4 whispers from SERPENT WARRENS pool');

/* defensive HellHeaven API path (ordering-safe max of API + state) */
delete root.IQ.HellHeaven;                     /* module absent -> no crash */
H.state.del('hh:layer');
ok(Array.isArray(flat(H.dispatch('roundStart', ctxOf(7)))), 'missing HellHeaven handled safely');
root.IQ.HellHeaven = { layer: () => 5 };       /* API ahead of state key */
H.dispatch('roundStart', ctxOf(8));
ok(P.whispers[4].indexOf(lastSpoken()) >= 0 && lastSpoken().indexOf('SCREAMING FOUNDRY') >= 0,
   'HellHeaven.layer() delta drives whisper when ahead of state key');

/* --- finale: despair once, defiance once after comeback --- */
H.beginRun('smoke5', 131);
spoken.length = 0;
H.dispatch('answer', ctxOf(6, { res: { correct: false, picked: 0, correctIdx: 1 }, hp: 20 }));
ok(spoken.length === 1 && P.pools.DESPAIR.indexOf(lastSpoken()) >= 0, 'wrong @ hp<=25 fires despair');
H.dispatch('answer', ctxOf(7, { res: { correct: false, picked: 0, correctIdx: 1 }, hp: 15 }));
ok(spoken.length === 1, 'despair fires only ONCE per run');
H.dispatch('answer', ctxOf(8, { res: { correct: true, picked: 3, correctIdx: 3 }, hp: 15, streak: 2 }));
H.dispatch('answer', ctxOf(9, { res: { correct: true, picked: 3, correctIdx: 3 }, hp: 15, streak: 3 }));
ok(spoken.length === 1, 'streak below 4 stays silent');
H.dispatch('answer', ctxOf(10, { res: { correct: true, picked: 3, correctIdx: 3 }, hp: 15, streak: 4 }));
ok(spoken.length === 2 && P.pools.DEFIANCE.indexOf(lastSpoken()) >= 0, 'streak 4 comeback fires defiance');
H.dispatch('answer', ctxOf(11, { res: { correct: true, picked: 3, correctIdx: 3 }, hp: 15, streak: 5 }));
ok(spoken.length === 2, 'defiance fires only ONCE per run');

/* wrong @ healthy hp: no despair */
H.beginRun('smoke6', 141);
spoken.length = 0;
H.dispatch('answer', ctxOf(6, { res: { correct: false, picked: 0, correctIdx: 1 }, hp: 80 }));
ok(spoken.length === 0, 'wrong at healthy hp stays silent');

/* --- budget honesty: denied say must NOT consume the once-flag --- */
H.beginRun('smoke7', 151);
root.IQ.DemonSay.say = () => false;            /* DemonSay budget denies */
spoken.length = 0;
H.dispatch('answer', ctxOf(6, { res: { correct: false, picked: 0, correctIdx: 1 }, hp: 20 }));
ok(spoken.length === 0, 'denied despair line not spoken');
root.IQ.DemonSay.say = (t) => { spoken.push(t); return true; };
H.dispatch('answer', ctxOf(7, { res: { correct: false, picked: 0, correctIdx: 1 }, hp: 18 }));
ok(spoken.length === 1 && P.pools.DESPAIR.indexOf(lastSpoken()) >= 0,
   'despair retries next qualifying answer after budget denial');

/* --- text rails: <=90 chars, no Math.random anywhere --- */
const allLines = [].concat(P.chapters, P.chaptersExtra,
 P.whispers.reduce((a, p) => a.concat(p), []),
 P.pools.SANCTUARY_FIRST, P.pools.SANCTUARY_RETURN, P.pools.SANCTUARY_VETERAN,
 P.pools.DESPAIR, P.pools.DEFIANCE);
const tooLong = allLines.filter((l) => l.length > 90);
ok(tooLong.length === 0, 'every story line <= 90 chars (max ' +
   Math.max.apply(null, allLines.map((l) => l.length)) + ')');
const src = require('fs').readFileSync(path.join(__dirname, '..', 'pack-story.js'), 'utf8');
ok(!/Math\.random\s*\(/.test(src) && !/Date\.now\s*\(/.test(src),
   'zero Math.random / Date.now in pack source');

console.log(fails ? '\nSMOKE FAILED: ' + fails : '\nSMOKE PASSED');
process.exit(fails ? 1 : 0);
