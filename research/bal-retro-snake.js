#!/usr/bin/env node
'use strict';
/*
 * research/bal-retro-snake.js — headless balance smoke for modes/snake.js
 * (SERPENT, 2026-08-25 tuning pass).
 *
 * Drives window.__SERPENT__ with a BFS-perfect apple pathfinder over a stubbed
 * DOM, then asserts:
 *   1. payout formula parity: resolved points match APPLE_PTS/APEX_BONUS/
 *      SURVIVE_BONUS at the observed apple count, per depth;
 *   2. failure parity: deaths resolve -(10+10*diff) exactly (engine
 *      index.html:747 pays stage points on correct:false, so the mode must
 *      not report positive points for losing);
 *   3. economy envelope: APEX solid play lands in [60%,135%] of the puzzle
 *      baseline 100*diff+40 at diffs 1-3, and survival-without-apples never
 *      outpays playing (timeout/stall is never optimal);
 *   4. determinism: same seed -> byte-identical outcome.
 *
 * Run: node research/bal-retro-snake.js
 */

var PATH = require('path');
var FILE = PATH.join(__dirname, '..', 'modes', 'snake.js');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Shipped constants (keep in sync with modes/snake.js — this file fails if
 * the mode changes its economy without updating these tables). */
var APPLE_PTS = [0, 12, 24, 40, 40, 40];
var APEX_BONUS = [0, 50, 70, 90, 110, 130];
var SURVIVE_BONUS = [0, 40, 60, 80, 100, 120];
var GRID = 17;

/* ---- headless DOM/window stubs ---- */
function makeEnv() {
  var fake2d = function () {
    return new Proxy({}, {
      get: function (t, k) {
        if (k === 'createRadialGradient' || k === 'createLinearGradient') {
          return function () { return { addColorStop: function () {} }; };
        }
        return typeof k === 'string' ? function () {} : undefined;
      },
      set: function () { return true; }
    });
  };
  var el = function () {
    return {
      style: {}, className: '', textContent: '', width: 0, height: 0,
      setAttribute: function () {}, appendChild: function () {},
      addEventListener: function () {}, removeEventListener: function () {},
      getContext: function () { return fake2d(); }
    };
  };
  var w = {
    setTimeout: function () { return 0; }, clearTimeout: function () {},
    setInterval: function () { return 0; }, clearInterval: function () {},
    requestAnimationFrame: function () { return 0; }, cancelAnimationFrame: function () {},
    addEventListener: function () {}, removeEventListener: function () {},
    localStorage: { getItem: function () { return null; } }
  };
  w.IQ = { Stage: { register: function (d) { w.__desc = d; }, get: function () { return w.__desc; } } };
  global.window = w;
  global.document = { createElement: el, getElementById: function () { return null; } };
  global.cancelAnimationFrame = w.cancelAnimationFrame;
  return w;
}

/* ---- BFS driver: first step of the shortest safe path to the apple ---- */
var DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function bfsDir(head, apple, body) {
  if (!apple) return null;
  var blocked = {};
  body.forEach(function (s) { blocked[s.x + ',' + s.y] = true; });
  var key = function (x, y) { return x + ',' + y; };
  var prev = {};
  var q = [head];
  var seen = {};
  seen[key(head.x, head.y)] = true;
  while (q.length) {
    var cur = q.shift();
    if (cur.x === apple.x && cur.y === apple.y) break;
    for (var name in DIRS) {
      var d = DIRS[name];
      var nx = cur.x + d[0], ny = cur.y + d[1];
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
      var k = key(nx, ny);
      if (seen[k] || (blocked[k] && !(nx === apple.x && ny === apple.y))) continue;
      seen[k] = true;
      prev[k] = { x: cur.x, y: cur.y };
      q.push({ x: nx, y: ny });
    }
  }
  if (!seen[key(apple.x, apple.y)]) return null;
  var node = { x: apple.x, y: apple.y };
  while (prev[key(node.x, node.y)] && !(prev[key(node.x, node.y)].x === head.x && prev[key(node.x, node.y)].y === head.y)) {
    node = prev[key(node.x, node.y)];
  }
  for (var n2 in DIRS) {
    if (head.x + DIRS[n2][0] === node.x && head.y + DIRS[n2][1] === node.y) return n2;
  }
  return null;
}

async function runRound(env, depth, seed) {
  var container = { clientWidth: 420, clientHeight: 480, appendChild: function () {} };
  var p = env.__desc.mount(container, { depth: depth, rng: mulberry32(seed), mp: { on: false }, timerLen: 45 });
  var api = env.__SERPENT__;
  var last = api.state();
  for (var i = 0; i < 6000; i++) {
    if (last.dead || last.finished) break;
    var dir = bfsDir(last.head, last.apple, last.body);
    if (!dir || !api.step(dir)) break;
    last = api.state();
  }
  last = api.state();   // final counters (the finishing tick mutates them)
  var res = await p;
  return { res: res, st: last };
}

var failures = 0;
function ok(cond, msg) {
  if (cond) { console.log('  PASS ' + msg); return true; }
  failures++;
  console.log('  FAIL ' + msg);
  return false;
}
function diffFor(depth) { return Math.max(1, Math.min(5, 1 + Math.floor((depth | 0) / 6))); }

(async function main() {
  var env = makeEnv();
  require(FILE);

  console.log('== SERPENT balance smoke ==');

  /* 1+2: formula + failure parity across depths, driven play */
  var apexSeen = {};
  var pairs = [[3, 11], [8, 29], [15, 47]];
  for (var pi = 0; pi < pairs.length; pi++) {
    var depth = pairs[pi][0], diff = diffFor(depth);
    console.log('depth ' + depth + ' (diff ' + diff + ')');
    for (var si = 0; si < 3; si++) {
      var seed = pairs[pi][1] + si;
      var out = await runRound(env, depth, seed);
      var r = out.res, st = out.st;
      var dead = r.correct === false;
      var apex = /APEX SERPENT/.test(r.summary);
      if (dead) {
        ok(r.points === -(10 + 10 * diff), 'seed ' + seed + ' death pays wrong-parity -(10+10*diff): ' + r.points);
        ok(r.hpDelta === -10, 'seed ' + seed + ' death hpDelta -10');
      } else {
        var want = st.apples * APPLE_PTS[diff] + (apex ? APEX_BONUS[diff] : SURVIVE_BONUS[diff]);
        ok(r.points === want, 'seed ' + seed + ' payout ' + r.points + ' == apples(' + st.apples + ')*' +
          APPLE_PTS[diff] + '+' + (apex ? 'apex' : 'survive') + ' bonus');
        ok(r.hpDelta === 0, 'seed ' + seed + ' survival hpDelta 0');
        if (apex) apexSeen[depth] = r.points;
      }
    }
  }

  /* 3: envelope — apex solid play within [60%,135%] of puzzle baseline */
  [3, 8, 15].forEach(function (depth) {
    var diff = diffFor(depth);
    var B = 100 * diff + 40;
    ok(!!apexSeen[depth], 'depth ' + depth + ': BFS driver reached APEX at least once');
    if (apexSeen[depth]) {
      var ratio = apexSeen[depth] / B;
      ok(ratio >= 0.6 && ratio <= 1.35,
        'depth ' + depth + ' apex ' + apexSeen[depth] + ' vs baseline ' + B + ' -> ' + Math.round(ratio * 100) + '% in [60%,135%]');
    }
    ok(SURVIVE_BONUS[diff] < 8 * APPLE_PTS[diff] + APEX_BONUS[diff],
      'depth ' + depth + ': zero-apple survival (' + SURVIVE_BONUS[diff] + ') < full play — stalling never optimal');
  });

  var a = await runRound(env, 8, 777);
  var b = await runRound(env, 8, 777);
  ok(a.res.points === b.res.points && a.st.apples === b.st.apples && a.res.summary === b.res.summary,
    'same seed twice -> identical outcome (' + a.res.points + ' pts, ' + a.st.apples + ' apples)');

  console.log(failures ? '\nSMOKE FAILED: ' + failures + ' assertion(s)' : '\nSMOKE GREEN');
  process.exit(failures ? 1 : 0);
})().catch(function (e) { console.error('SMOKE ERROR', e); process.exit(2); });
function await0(p) { var out; p.then(function (v) { out = v; }).catch(function (e) { throw e; }); return out; }
