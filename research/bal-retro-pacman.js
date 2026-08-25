#!/usr/bin/env node
'use strict';
/*
 * research/bal-retro-pacman.js — headless balance smoke for modes/pacman.js
 * (GLUTTON, 2026-08-25 tuning pass).
 *
 * Drives window.__GLUTTON__ with a BFS pellet-pathfinder + tile-level ghost
 * dodge over a stubbed DOM, then asserts:
 *   1. payout formula parity: correct runs resolve PELLET_PTS*eaten +
 *      CLEAR_BONUS[diff]*(cleared) + GHOST_PTS[diff]*ghostsEaten; failures
 *      (caught, or starved under 85% at cap) resolve points 0 so the engine's
 *      wrong-answer parity -(10+10*diff) applies (index.html:747 pays stage
 *      points on correct:false);
 *   2. economy envelope: a solid run (full clear + half the ghosts) lands in
 *      [60%,135%] of the puzzle baseline 100*diff+40 at every diff tier;
 *   3. determinism: same seed -> byte-identical outcome;
 *   4. fairness rails kept: hp cost only on getting caught (-15).
 *
 * Run: node research/bal-retro-pacman.js
 */

var PATH = require('path');
var FILE = PATH.join(__dirname, '..', 'modes', 'pacman.js');
var COLS = 19, ROWS = 15;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Shipped constants (keep in sync with modes/pacman.js). */
var PELLET_PTS = 1;
var CLEAR_BONUS = [0, 35, 55, 75, 90, 100];
var GHOST_PTS = [0, 15, 35, 55, 65, 75];
var GHOST_COUNT = [0, 1, 2, 3, 4, 4];
var SPAWN = { c: 9, r: 11 };

/* ---- headless DOM/window stubs ---- */
function makeEnv() {
  var fake2d = function () {
    return new Proxy({}, {
      get: function (t, k) { return typeof k === 'string' ? function () {} : undefined; },
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
  global.clearTimeout = w.clearTimeout;
  return w;
}

var DIRS = {
  up: [0, -1], left: [-1, 0], down: [0, 1], right: [1, 0]
};

function wrapC(c) { return ((c % COLS) + COLS) % COLS; }
function manhattan(ax, ay, bx, by) {
  var dx = Math.abs(ax - bx); dx = Math.min(dx, COLS - dx);
  return dx + Math.abs(ay - by);
}

/* Multi-source BFS: distance from every open cell to the nearest pellet. */
function distToPellets(layout, pellets) {
  var dist = {};
  var q = [];
  pellets.forEach(function (k) {
    if (dist[k] === undefined) { dist[k] = 0; q.push(k); }
  });
  while (q.length) {
    var cur = q.shift();
    var cc = parseInt(cur.split(',')[0], 10), cr = parseInt(cur.split(',')[1], 10);
    for (var name in DIRS) {
      var d = DIRS[name];
      var nc = wrapC(cc + d[0]), nr = cr + d[1];
      if (nr < 0 || nr >= ROWS) continue;
      if (layout[nr].charAt(nc) === '#' || layout[nr].charAt(nc) === '-') continue;
      var k = nc + ',' + nr;
      if (dist[k] === undefined) { dist[k] = dist[cur] + 1; q.push(k); }
    }
  }
  return dist;
}

/* Multi-source BFS: distance from every open cell to the nearest chaser. */
function distToGhosts(layout, ghosts) {
  var dist = {};
  var q = [];
  ghosts.forEach(function (g) {
    if (g.state !== 'out') return;
    var k0 = g.c + ',' + g.r;
    if (dist[k0] === undefined) { dist[k0] = 0; q.push(k0); }
  });
  while (q.length) {
    var cur = q.shift();
    var cc2 = parseInt(cur.split(',')[0], 10), cr2 = parseInt(cur.split(',')[1], 10);
    for (var nm in DIRS) {
      var dd = DIRS[nm];
      var nc2 = wrapC(cc2 + dd[0]), nr2 = cr2 + dd[1];
      if (nr2 < 0 || nr2 >= ROWS) continue;
      if (layout[nr2].charAt(nc2) === '#' || layout[nr2].charAt(nc2) === '-') continue;
      var k2 = nc2 + ',' + nr2;
      if (dist[k2] === undefined) { dist[k2] = dist[cur] + 1; q.push(k2); }
    }
  }
  return dist;
}

function openAt(layout, c, r) {
  if (r < 0 || r >= ROWS) return false;
  var ch = layout[r].charAt(wrapC(c));
  return ch !== '#' && ch !== '-';
}

/* Pick a direction. mode 'seek': minimize dist (pellet/power source map),
 * dodge chasers, opportunistic fright bounty. mode 'evade': maximize chaser
 * distance with heading inertia (kills A<->B thrash), tie-break toward food. */
function chooseDir(layout, st, dist, ghostDist, mode) {
  var prey = null;
  st.ghosts.forEach(function (g) {
    if (g.state !== 'fright') return;
    if (manhattan(st.pos.c, st.pos.r, g.c, g.r) <= 4 &&
        (prey == null || manhattan(st.pos.c, st.pos.r, g.c, g.r) <
          manhattan(st.pos.c, st.pos.r, prey.c, prey.r))) prey = g;
  });

  var cands = [];
  for (var name in DIRS) {
    var d = DIRS[name];
    if (!openAt(layout, st.pos.c + d[0], st.pos.r + d[1])) continue;
    var nc = wrapC(st.pos.c + d[0]), nr = st.pos.r + d[1];
    var k = nc + ',' + nr;
    var gd = ghostDist[k] === undefined ? 99 : ghostDist[k];
    var pel = dist[k] === undefined ? 9999 : dist[k];
    var same = st.pos.dx === d[0] && st.pos.dy === d[1] ? 1 : 0;
    var score;
    if (mode === 'evade') {
      score = -(gd * 100 - pel * 0.01 - same * 5);   // lower is better
    } else {
      score = (prey ? manhattan(nc, nr, prey.c, prey.r) : pel);
      score += gd <= 2 ? 800 : gd === 3 ? 150 : 0;   // don't run INTO fangs
      score -= same * 0.5;                            // gentle inertia
    }
    cands.push({ name: name, score: score });
  }
  if (!cands.length) return null;
  cands.sort(function (a, b) { return a.score - b.score; });
  return cands[0].name;
}


async function runRound(env, depth, seed) {
  var container = { clientWidth: 420, clientHeight: 480, appendChild: function () {} };
  var p = env.__desc.mount(container, { depth: depth, rng: mulberry32(seed), mp: false });
  var api = env.__GLUTTON__;
  var layout = api.maze();
  var pellets = {}, powers = {};
  var total = 0;
  for (var r = 0; r < ROWS; r++) {
    for (var c = 0; c < COLS; c++) {
      var ch = layout[r].charAt(c);
      if (ch === '.' || ch === 'o') { pellets[c + ',' + r] = true; total++; }
      if (ch === 'o') powers[c + ',' + r] = true;
    }
  }

  for (var i = 0; i < 2600; i++) {
    var st = api.state();
    if (st.finished) break;
    var posKey = st.pos.c + ',' + st.pos.r;
    delete pellets[posKey];
    delete powers[posKey];
    var gdist = distToGhosts(layout, st.ghosts);
    var fright = st.ghosts.some(function (g) { return g.state === 'fright'; });
    var dir;
    if (fright || (st.playMs >= 34000 && st.eaten >= 0.7 * total)) {
      /* power-pellet window (or protecting a SURVIVED verdict): ghosts are
       * prey/frozen — eat at full speed, bounty-hunting included */
      var keys0 = Object.keys(pellets);
      dir = chooseDir(layout, st,
        keys0.length ? distToPellets(layout, keys0) : {}, gdist, 'seek');
    } else {
      /* hunters out: pure flight, drifting toward the next power pellet */
      var pk2 = Object.keys(powers);
      var tgt = pk2.length ? pk2 : Object.keys(pellets);
      dir = chooseDir(layout, st,
        tgt.length ? distToPellets(layout, tgt) : {}, gdist, 'evade');
    }
    if (!dir || !api.step(dir, 40)) break;
  }
  api.settle(1500);          // pump dying/cleared timers the stubbed rAF can't
  var res = await p;
  return { res: res, st: api.state(), total: total };
}

function diffFor(depth) { return Math.max(1, Math.min(5, 1 + Math.floor((depth | 0) / 6))); }

var failures = 0;
function ok(cond, msg) {
  if (cond) { console.log('  PASS ' + msg); return true; }
  failures++;
  console.log('  FAIL ' + msg);
  return false;
}

(async function main() {
  var env = makeEnv();
  require(FILE);

  console.log('== GLUTTON balance smoke ==');

  /* 1+4: formula parity + failure/hp rails across depths */
  var winSeen = {};
  var pairs = [[3, 11], [8, 29], [15, 47]];
  for (var pi = 0; pi < pairs.length; pi++) {
    var depth = pairs[pi][0], diff = diffFor(depth);
    console.log('depth ' + depth + ' (diff ' + diff + ', ghosts ' + GHOST_COUNT[diff] + ')');
    for (var si = 0; si < 3; si++) {
      var seed = pairs[pi][1] + si;
      var out = await runRound(env, depth, seed);
      var r = out.res, st = st0(out.st);
      var capPath = !st.cleared && !st.caught && st.playMs >= 39500;
      var wantCorrect = st.cleared || (!st.caught && capPath && st.eaten >= 0.85 * out.total);
      ok(r.correct === wantCorrect, 'seed ' + seed + ' correct flag matches contract (eaten ' +
        st.eaten + '/' + out.total + ', cleared ' + !!st.cleared + ', caught ' + !!st.caught + ')');
      if (r.correct) {
        var want = PELLET_PTS * st.eaten + (st.cleared ? CLEAR_BONUS[diff] : 0) +
          GHOST_PTS[diff] * st.ghostsEaten;
        ok(r.points === want, 'seed ' + seed + ' payout ' + r.points + ' == ' + st.eaten +
          ' pellets' + (st.cleared ? '+' + CLEAR_BONUS[diff] + ' clear' : '') +
          '+' + GHOST_PTS[diff] + '*' + st.ghostsEaten + ' ghosts');
        ok(r.hpDelta === 0, 'seed ' + seed + ' survival hpDelta 0');
        winSeen[depth] = true;
      } else {
        ok(r.points === 0, 'seed ' + seed + ' failure pays 0 -> engine wrong-parity applies (got ' + r.points + ')');
        ok(r.hpDelta === (st.caught ? -15 : 0), 'seed ' + seed + ' hp rail: -15 only when caught');
      }
    }
  }

  /* 2: envelope — analytic solid-run anchor per diff tier */
  [1, 2, 3, 4, 5].forEach(function (diff) {
    var B = 100 * diff + 40;
    var solid = 136 * PELLET_PTS + CLEAR_BONUS[diff] + GHOST_PTS[diff] * Math.ceil(GHOST_COUNT[diff] / 2);
    var ratio = solid / B;
    ok(solid <= 500, 'diff ' + diff + ': solid-run payout ' + solid + ' under engine 500-pt clamp');
    ok(ratio >= 0.6 && ratio <= 1.35, 'diff ' + diff + ': solid run (clear+' +
      Math.ceil(GHOST_COUNT[diff] / 2) + ' ghosts) ' + solid + ' vs baseline ' + B + ' -> ' +
      Math.round(ratio * 100) + '% in [60%,135%]');
    ok(GHOST_PTS[diff] > 0 && CLEAR_BONUS[diff] > 0,
      'diff ' + diff + ': failing (0 pts) < any success — idling into ghosts never optimal');
  });
  ok(!!winSeen[3], 'depth 3: driver achieved a correct round live (envelope exercised end-to-end)');

  /* 3: determinism */
  var a = await runRound(env, 8, 777);
  var b = await runRound(env, 8, 777);
  ok(a.res.points === b.res.points && a.st.eaten === b.st.eaten &&
    a.st.ghostsEaten === b.st.ghostsEaten && a.res.summary === b.res.summary,
    'same seed twice -> identical outcome (' + a.res.points + ' pts, ' + a.st.eaten + ' pellets)');

  console.log(failures ? '\nSMOKE FAILED: ' + failures + ' assertion(s)' : '\nSMOKE GREEN');
  process.exit(failures ? 1 : 0);
})().catch(function (e) { console.error('SMOKE ERROR', e); process.exit(2); });

function st0(st) { return st; }
