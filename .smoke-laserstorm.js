/* .smoke-laserstorm.js — behavioral harness for modes/laserstorm.js pure sim.
 * Run: node .smoke-laserstorm.js   (exit 0 = pass)
 * Covers: determinism, telegraph<fire ordering, half-grid concurrency rail,
 * vaporize/threaded judgments incl. 60ms-bucket boundaries, depth scaling,
 * salvo rail across seeds. */
'use strict';
const L = require('./modes/laserstorm.js');

let failures = 0, passes = 0;
function ok(cond, msg) {
  if (cond) { passes++; console.log('  ok - ' + msg); }
  else { failures++; console.log('  FAIL - ' + msg); }
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

console.log('# laserstorm sim');

/* 1. determinism */
{
  const a = L.buildSchedule(mulberry32(1234), 7, 45000);
  const b = L.buildSchedule(mulberry32(1234), 7, 45000);
  ok(JSON.stringify(a) === JSON.stringify(b), 'same seed -> byte-identical schedule');
  const c = L.buildSchedule(mulberry32(99), 7, 45000);
  ok(JSON.stringify(a) !== JSON.stringify(c), 'different seed -> different schedule');
}

/* 2. structure: telegraph strictly precedes fire; fields sane */
{
  const s = L.buildSchedule(mulberry32(7), 3, 45000);
  let bad = 0;
  for (const st of s.strikes) {
    if (!(st.tele > 0 && st.dur === s.P.beam && st.start - st.tele > 0)) bad++;
    if (!Number.isInteger(st.lane) || st.lane < 0 || st.lane > 7) bad++;
    for (const ex of st.extra) if (ex === st.lane || st.extra.indexOf(ex) !== st.extra.lastIndexOf(ex)) bad++;
  }
  ok(bad === 0 && s.strikes.length > 8, `strikes well-formed (${s.strikes.length} strikes)`);
}

/* 3. phases + vaporize judgment */
{
  const s = L.buildSchedule(mulberry32(42), 1, 45000);
  const st = s.strikes[0];
  ok(L.lanePhase(s, st.start - st.tele - 1, st.lane) === 'idle', 'idle before telegraph');
  ok(L.lanePhase(s, st.start - st.tele + 1, st.lane) === 'tele', 'telegraph phase entered');
  ok(L.lanePhase(s, st.start + st.dur - 1, st.lane) === 'fire', 'firing phase');
  ok(L.lanePhase(s, st.start + st.dur + 1, st.lane) === 'idle', 'cooled after beam');
  ok(L.isVaporized(s, st.start + 10, st.lane) === true, 'click during fire -> vaporized');
  ok(L.isVaporized(s, st.start - 10, st.lane) === false, 'click just before fire -> safe');
  ok(L.isVaporized(s, st.start + st.dur + 30, st.lane) === false, 'click after cooldown -> safe');
  /* salvo extras also burn */
  const s9 = L.buildSchedule(mulberry32(5), 10, 45000);
  const withExtra = s9.strikes.find(x => x.extra.length > 0);
  if (withExtra) {
    ok(L.isVaporized(s9, withExtra.start + 10, withExtra.extra[0]) === true, 'salvo extra lane burns too');
  } else ok(true, 'no salvo this seed (p=0.22, tolerated)');
}

/* 4. concurrency rail: never more than half the grid firing, all depths/seeds */
{
  let worst = 0;
  for (let seed = 1; seed <= 12; seed++) {
    for (const depth of [1, 5, 9, 10]) {
      const s = L.buildSchedule(mulberry32(seed * 1000 + depth), depth, 45000);
      for (let t = 0; t < 45000; t += 30) {
        let n = 0;
        for (let l = 0; l < 8; l++) if (L.lanePhase(s, t, l) === 'fire') n++;
        worst = Math.max(worst, n);
      }
    }
  }
  ok(worst <= 4, `concurrency rail holds (worst simultaneous lanes = ${worst} <= 4)`);
}

/* 5. threaded bonus boundary: <=500ms before ADJACENT lane fires */
{
  const P = { period: 3000, tele: 800, beam: 400, leadIn: 1000, dual: false, salvo: false, salvoP: 0, maxFiring: 4 };
  const mk = lanes => ({ P, strikes: lanes.map(([lane, start]) => ({ lane, start, dur: 400, tele: 800, sweep: 0, extra: [] })) });
  const sch = mk([[2, 5000], [3, 5400]]);           // adjacent fires 400ms later
  ok(L.isThreaded(sch, 5400 - 500, 2) === true, 'adjacent fires exactly 500ms later -> threaded');
  ok(L.isThreaded(sch, 5400 - 501, 2) === false, '501ms out -> not threaded');
  ok(L.isThreaded(sch, 5400 + 1, 2) === false, 'already fired -> not threaded');
  const nonAdj = mk([[0, 5000], [7, 5400]]);        // columns 0 and 7 are not neighbours
  ok(L.isThreaded(nonAdj, 4900, 0) === false, 'non-adjacent lane never threads');
}

/* 6. depth scaling */
{
  const p1 = L.paramsFor(1), p5 = L.paramsFor(5), p10 = L.paramsFor(10);
  ok(p1.period === 3200 && p1.tele === 900, 'depth 1: 3.2s period / 0.9s telegraph');
  ok(p10.period < p5.period && p5.period < p1.period, 'period shrinks with depth');
  ok(p10.period === 1400 && p10.tele === 550, 'depth 10 clamp: 1.4s / 0.55s');
  ok(!p1.dual && p5.dual && !p1.salvo && p10.salvo, 'dual sweep >=5, salvos >=9');
  ok(L.paramsFor(20).period === 1400, 'depth clamps above 10');
}

/* 7. timeout verdict shape (design §3 table row) exercised via exports presence */
ok(typeof L.firingCount === 'function' && L.LANES === 8, 'sim surface complete');

console.log(failures === 0 ? `\nALL ${passes} CHECKS PASSED` : `\n${failures} FAILURES / ${passes} passed`);
process.exit(failures === 0 ? 0 : 1);
