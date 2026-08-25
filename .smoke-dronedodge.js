/* .smoke-dronedodge.js — behavioral harness for modes/dronedodge.js pure sim.
 * Run: node .smoke-dronedodge.js   (exit 0 = pass)
 * Covers: spawn-schedule determinism + depth scaling, turn-rate-limited
 * steering (cap + convergence + circling-evasion property), guard banking
 * rule (every 3 consecutive, max 2 held), speed multiplier cap. */
'use strict';
const D = require('./modes/dronedodge.js');

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

console.log('# dronedodge sim');

/* 1. spawn schedule determinism + shape */
{
  const a = D.buildSpawns(mulberry32(777), 4, 45000);
  const b = D.buildSpawns(mulberry32(777), 4, 45000);
  ok(JSON.stringify(a) === JSON.stringify(b), 'same seed -> identical spawn schedule');
  ok(a.length >= 8 && a.every(e => Number.isInteger(e.t) && e.side >= 0 && e.side <= 3 && e.off >= 0 && e.off <= 1),
    `spawns well-formed (${a.length} events over horizon)`);
  ok(a.every((e, i) => i === 0 || e.t > a[i - 1].t), 'spawn times strictly increasing');
}

/* 2. density scales with depth */
{
  const d1 = D.buildSpawns(mulberry32(3), 1, 45000).length;
  const d10 = D.buildSpawns(mulberry32(3), 10, 45000).length;
  ok(d10 > d1 * 1.8, `density ramps (${d1} spawns @d1 vs ${d10} @d10)`);
  const p = D.paramsFor(1);
  ok(p.spawnInt === 2200, 'depth 1 interval 2.2s');
  ok(D.paramsFor(10).spawnInt === 900, 'depth 10 interval 0.9s');
  ok(D.paramsFor(20).spawnInt === 900, 'interval clamps above depth 10');
}

/* 3. speed multiplier cap */
ok(D.speedMult(13) === D.speedMult(40) && D.speedMult(13) > D.speedMult(1),
  'speed x(1+0.1*min(depth-1,12)) capped');

/* 4. steering: turn-rate cap respected every step */
{
  const d = { x: 0, y: 0, a: Math.PI / 2, spd: 200 };
  const MT = 2.4;
  let worst = 0;
  for (let k = 0; k < 200; k++) {
    const before = d.a;
    D.steer(d, 5000, -5000, 1 / 60, MT);       // target demands a huge turn
    worst = Math.max(worst, Math.abs(D.wrapAngle(d.a - before)));
  }
  ok(worst <= MT / 60 + 1e-9, `turn rate limited (worst step ${worst.toFixed(4)} rad <= ${(MT / 60).toFixed(4)})`);
}

/* 5. steering converges on a static target */
{
  const d = { x: 600, y: 600, a: Math.PI, spd: 260 };
  for (let k = 0; k < 600 && Math.hypot(d.x - 120, d.y - 80) > 16; k++) D.steer(d, 120, 80, 1 / 60, 2.4);
  ok(Math.hypot(d.x - 120, d.y - 80) <= 16, 'straight-line chase closes distance');
}

/* 6a. sharp turns shake the pursuer (design §4 "circling defeats them"):
 *     after the cursor reverses 180°, the turn-rate-limited drone keeps flying
 *     the OLD way long enough for the gap to open — the escape window. */
{
  const MT = 2.4;
  const cur = { x: 100, y: 0 };
  const d = { x: 0, y: 0, a: 0, spd: 95 };
  /* steady tail-chase: cursor crawls right SLOWER than the drone, drone aligns behind */
  for (let k = 0; k < 60 * 3; k++) { cur.x += 90 / 60; D.steer(d, cur.x, cur.y, 1 / 60, MT); }
  ok(Math.abs(d.a) < 0.05 && d.x < cur.x, 'drone settled into tail-chase alignment');
  /* abrupt reversal: cursor re-appears far behind the drone */
  cur.x = d.x - 220;
  let grew = true;
  const d0 = Math.hypot(d.x - cur.x, d.y - cur.y);
  let dmin = d0, dmax = d0;
  for (let k = 0; k < Math.floor(60 * 0.6); k++) {
    D.steer(d, cur.x, cur.y, 1 / 60, MT);
    const dd = Math.hypot(d.x - cur.x, d.y - cur.y);
    dmin = Math.min(dmin, dd); dmax = Math.max(dmax, dd);
  }
  grew = dmax > d0 + 20;                       // gap OPENED by >20px despite pursuit
  ok(grew && dmin >= d0 - 5,
    `reversal opens the gap (dist ${d0.toFixed(0)} -> ${dmax.toFixed(0)}px, min ${dmin.toFixed(0)})`);
}

/* 6b. threat exists: a STATIONARY cursor (answer dwell) is caught quickly */
{
  const d = { x: 60, y: 60, a: 0, spd: 95 };
  let caughtAt = -1;
  for (let k = 0; k < 60 * 12 && caughtAt < 0; k++) {
    D.steer(d, 400, 300, 1 / 60, 2.4);
    if (Math.hypot(d.x - 400, d.y - 300) < 22) caughtAt = k / 60;
  }
  ok(caughtAt > 0 && caughtAt <= 6, `stationary cursor caught (${caughtAt.toFixed(1)}s)`);
}

/* 7. guard banking: every 3 consecutive dodges, max 2 held, resets handled by caller */
{
  let held = 0, banks = 0;
  for (let streak = 3; streak <= 12; streak += 3) {
    const r = D.onDodgeBank(streak, held);
    if (r.bank) banks++;
    held = r.held;
  }
  ok(banks === 2 && held === 2, 'banks twice then holds at max 2');
  ok(D.onDodgeBank(1, 0).bank === false && D.onDodgeBank(2, 0).bank === false, 'sub-3 streak never banks');
  ok(D.onDodgeBank(3, 2).bank === false && D.onDodgeBank(3, 2).held === 2, 'no overflow past 2 guards');
  ok(D.onDodgeBank(6, 1).bank === true && D.onDodgeBank(6, 1).held === 2, 'second bank lands');
}

/* 8. wrapAngle sanity: 5*pi/2 -> pi/2; 0 stays */
ok(Math.abs(D.wrapAngle(Math.PI * 2.5) - Math.PI / 2) < 1e-9 && D.wrapAngle(0) === 0,
  'wrapAngle normalizes to (-pi,pi]');

console.log(failures === 0 ? `\nALL ${passes} CHECKS PASSED` : `\n${failures} FAILURES / ${passes} passed`);
process.exit(failures === 0 ? 0 : 1);
