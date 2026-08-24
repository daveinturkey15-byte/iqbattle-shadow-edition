
// Smoke harness: real hooks.js + pack-horror.js under a minimal DOM stub.
const g = globalThis;
g.window = g;
g.localStorage = { getItem: () => null };
g.document = {
  head: { appendChild(){} },
  body: { classList: { _s:new Set(), add(c){this._s.add(c)}, remove(c){this._s.delete(c)}, contains(c){return this._s.has(c)} } },
  addEventListener(){}, removeEventListener(){},
  createElement(){ return { style:{}, set textContent(v){}, appendChild(){} }; }
};
g.performance = { now: () => Date.now() };

require('C:/Users/david/Desktop/stuff/iqbattle/worlds.js');
require('C:/Users/david/Desktop/stuff/iqbattle/hooks.js');
require('C:/Users/david/Desktop/stuff/iqbattle/pack-horror.js');
const H = g.IQ.Hooks, IQ = g.IQ;

let fails = [];
function ok(name, cond){ if(!cond) fails.push(name); else console.log('ok -', name); }

function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

/* worlds registered? */
['sandman-dream','grief-box','well-curse','hive-acid','upside-down'].forEach(id=>{
  ok('world in registry: '+id, (IQ.Worlds.list('bad')||[]).concat(IQ.Worlds.list('neutral')||[], IQ.Worlds.list('chaotic')||[]).includes(id));
});

H.beginRun('run-A', 12345);

var m;
/* --- hive-acid bursts --- */
const acidRng = mulberry32(777);
H.beginRun('run-B', 999);
m = H.dispatch('roundStart', { round:1, runId:'run-B', world:'hive-acid', rng:acidRng, optCount:8, timerLen:60 });
ok('acid round start silent', m.length===0 || !m.some(x=>x.disableWrongRandom));
// fast-forward clock by faking rec via many ticks is time-based; instead tick once and rely on burst.at>=2
// simulate: call onTick repeatedly with real time gaps won't advance; verify handler exists & returns null safely:
m = H.dispatch('tick', { round:1, runId:'run-B', world:'hive-acid', dtSec:0.016, rng:acidRng, optCount:8 });
ok('acid tick safe pre-burst', Array.isArray(m));

/* --- grief gamble determinism (seeded shuffle path) --- */
function griefAnswer(seed){
  const rng = mulberry32(seed);
  // burn rng draws like the gate does until it passes: emulate by calling dispatch directly
  return H.dispatch('answer', { round:1, runId:'run-C', world:'grief-box', res:{correct:true}, rng, timerLen:60, optCount:8 });
}
H.beginRun('run-C', 42);
H.dispatch('roundStart',{round:1,runId:'run-C',world:'grief-box',rng:mulberry32(1),optCount:8,timerLen:60});
// force pass: gate uses first rng draw; find seeds where draw<=0.34
function gateSeed(s){ const r=mulberry32(s); return r(); }
let seed=1; while(gateSeed(seed)>0.34) seed++;
const a1 = griefAnswer(seed);
const open1 = a1.find(x=>x.flag==='grief-open');
ok('gamble opens on qualifying fast solve', !!open1 && typeof open1.overlayHTML==='string' && /THREE BOXES/.test(open1.overlayHTML));
ok('overlay non-interactive markup only', !/onclick|<button|<input/i.test(open1.overlayHTML));
H.beginRun('run-C2', 42);
H.dispatch('roundStart',{round:1,runId:'run-C2',world:'grief-box',rng:mulberry32(1),optCount:8,timerLen:60});
const a2 = griefAnswer(seed);
const open2 = a2.find(x=>x.flag==='grief-open');
ok('seeded gamble reproducible for same seed', JSON.stringify(a1)===JSON.stringify(a2));
// close any pending state
H.state.del('pack-horror:griefPending');

/* --- sandman jolt modifier shape --- */
const sm = H.active('sandman-dream').find(r=>r.id==='sandman-jolt');
ok('sandman bound to sandman-dream', !!sm);


/* --- well-tape full cycle --- */
function rs(r, world){ H.dispatch('roundStart', { round:r, runId:'run-A', world, rng:mulberry32(r), optCount:8, timerLen:60 }); }
var m;
m = H.dispatch('roundStart', { round:1, runId:'run-A', world:'well-curse', rng:mulberry32(1), optCount:8 })[0];
ok('tape applied: countdown banner + flag', m && m.flag==='tape-applied' && /SEVEN ROUNDS/.test(m.bannerText));
m = H.dispatch('roundStart', { round:2, runId:'run-A', world:'well-curse', rng:mulberry32(2), optCount:8 })[0];
ok('cd 7->6 announced', m && /THE TAPE COUNTS/.test(m.bannerText));
/* correct answers during countdown set watched */
m = H.dispatch('answer', { round:2, runId:'run-A', world:'well-curse', res:{correct:true,picked:0,correctIdx:0}, rng:mulberry32(9), optCount:8 })[0];
ok('watched set on correct answer', m && m.flag==='tape-watched');
for (let r=3;r<=7;r++) H.dispatch('roundStart',{round:r,runId:'run-A',world:'well-curse',rng:mulberry32(r),optCount:8});
m = H.dispatch('roundStart', { round:8, runId:'run-A', world:'well-curse', rng:mulberry32(8), optCount:8 })[0];
ok('watched => forgiveness flag at 0', m && m.flag==='well-tape-forgiven' && m.hpDelta===undefined);
/* second cycle without watching => -10 */
for (let r=9;r<=14;r++) H.dispatch('roundStart',{round:r,runId:'run-A',world:'well-curse',rng:mulberry32(r),optCount:8});
m = H.dispatch('roundStart', { round:15, runId:'run-A', world:'well-curse', rng:mulberry32(16), optCount:8 })[0];
ok('unwatched => hpDelta -10 + banner', m && m.hpDelta===-10 && /DIDN.T WATCH THE TAPE/.test(m.bannerText));
console.log(fails.length ? 'FAILS: '+fails.join(' | ') : 'ALL SMOKE CHECKS PASSED');
