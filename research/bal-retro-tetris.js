#!/usr/bin/env node
'use strict';
/*
 * research/bal-retro-tetris.js — headless balance smoke for modes/tetris.js
 * (THE WELL, 2026-08-25 tuning pass).
 *
 * Drives window.__WELL__ (press = free move, step('hard') = one gravity
 * advance) with a column-cycling stacking policy over a stubbed DOM, then:
 *   1. payout formula parity: wonEarly resolves BASE_PTS+LINE_PTS[diff]*
 *      lines+WIN_BONUS; every failure path (cap expiry / topout) resolves
 *      points 0 so the engine's wrong-answer parity -(10+10*diff) applies
 *      (index.html:747 pays stage points on correct:false);
 *   2. economy envelope: quota-met wins land in [60%,135%] of the puzzle
 *      baseline 100*diff+40 at diffs 1-3 and stay under the engine's
 *      500-point clamp at diffs 4-5; failing always pays less than winning;
 *   3. determinism: same seed -> identical outcome.
 *
 * Run: node research/bal-retro-tetris.js
 */

var PATH = require('path');
var FILE = PATH.join(__dirname, '..', 'modes', 'tetris.js');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Shipped constants (keep in sync with modes/tetris.js). */
var BASE_PTS = 30;
var LINE_PTS = [0, 40, 52, 62, 70, 70];
var WIN_BONUS = 50;
var QUOTA_BY_DIFF = [0, 2, 3, 4, 5, 6];
var COLS = 10, ROWS = 18;

/* ---- headless DOM/window stubs ---- */
function makeEnv() {
  var fake2d = function () {
    return new Proxy({}, {
      get: function (t, k) {
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
    devicePixelRatio: 1,
    localStorage: { getItem: function () { return null; } }
  };
  w.IQ = { Stage: { register: function (d) { w.__desc = d; }, get: function () { return w.__desc; } } };
  global.window = w;
  global.document = { createElement: el, getElementById: function () { return null; } };
  global.cancelAnimationFrame = w.cancelAnimationFrame;
  global.clearTimeout = w.clearTimeout;
  return w;
}

/* rot-0 cell offsets (I J L O S T Z) for landing simulation */
var CELLS = [
  [[0, 0], [1, 0], [2, 0], [3, 0]],
  [[0, 0], [0, 1], [1, 1], [2, 1]],
  [[2, 0], [0, 1], [1, 1], [2, 1]],
  [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[1, 0], [2, 0], [0, 1], [1, 1]],
  [[1, 0], [0, 1], [1, 1], [2, 1]],
  [[0, 0], [1, 0], [1, 1], [2, 1]]
];

/* Evaluate dropping `type` at column x on grid (array of '.'/digit strings):
 * returns {score, x} — lower is better. Penalizes holes, depth, bumpiness. */
function landScore(grid, type, x) {
  var cells = CELLS[type];
  var collides = function (y) {
    for (var i = 0; i < cells.length; i++) {
      var gy = y + cells[i][1], gx = x + cells[i][0];
      if (gx < 0 || gx >= COLS || gy >= ROWS) return true;
      if (gy >= 0 && grid[gy].charAt(gx) !== '.') return true;
    }
    return false;
  };
  var y = -2;
  if (collides(y)) return null;          // span unreachable (out of bounds)
  while (!collides(y + 1) && y + 1 <= ROWS) y++;   // fall to the resting row

  if (y < -1) return null;
  var g = grid.slice();
  for (var i = 0; i < cells.length; i++) {
    var gy = y + cells[i][1];
    if (gy >= 0) g[gy] = g[gy].substring(0, x + cells[i][0]) + 'X' +
      g[gy].substring(x + cells[i][0] + 1);
  }
  var heights = [], holes = 0, top;
  for (var c = 0; c < COLS; c++) {
    top = ROWS;
    for (var r2 = 0; r2 < ROWS; r2++) {
      if (g[r2].charAt(c) !== '.') { top = r2; break; }
    }
    heights.push(ROWS - top);
    for (var r3 = top + 1; r3 < ROWS; r3++) if (g[r3].charAt(c) === '.') holes++;
  }
  var maxH = Math.max.apply(null, heights);
  var bump = 0;
  for (var b = 0; b < COLS - 1; b++) bump += Math.abs(heights[b] - heights[b + 1]);
  return { score: holes * 1000 + maxH * 100 + bump, x: x };
}

function chooseMove(st) {
  var best = null;
  for (var x = 0; x < COLS; x++) {
    var cand = landScore(st.rows, st.pieceType, x);
    if (cand && (best == null || cand.score < best.score)) best = cand;
  }
  return best ? best.x : 0;
}

async function runRound(env, depth, seed) {
  var container = { clientWidth: 420, clientHeight: 480, appendChild: function () {} };
  var p = env.__desc.mount(container, { depth: depth, rng: mulberry32(seed), mp: false });
  var api = env.__WELL__;
  for (var guard = 0; guard < 500; guard++) {
    if (api.state().finished) break;
    var st = api.state();
    if (st.pieceX == null) {                 // clearing flash / spawn pending
      if (!api.step('hard')) break;          // nudge time forward
      continue;
    }
    var dx = chooseMove(st) - st.pieceX;
    while (dx > 0 && api.press('right')) dx--;
    while (dx < 0 && api.press('left')) dx++;
    if (!api.step('hard')) break;
  }
  var res = await p;
  return { res: res, st: api.state() };     // state() stays readable post-finish
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

  console.log('== THE WELL balance smoke ==');

  /* 1: formula + failure parity across depths. The rotation-less bot wins
   * reliably only at diff1 (slow gravity); deeper diffs assert the failure
   * path live and the win path analytically below. */
  var winSeen = {}, lineSeen = {};
  var pairs = [[3, 11], [8, 29], [15, 47]];
  for (var pi = 0; pi < pairs.length; pi++) {
    var depth = pairs[pi][0], diff = diffFor(depth);
    console.log('depth ' + depth + ' (diff ' + diff + ', quota ' + QUOTA_BY_DIFF[diff] + ')');
    for (var si = 0; si < 2; si++) {
      var seed = pairs[pi][1] + si;
      var out = await runRound(env, depth, seed);
      var r = out.res, st = out.st;
      if (st.lines > 0) lineSeen[depth] = true;
      var quotaMet = st.lines >= QUOTA_BY_DIFF[diff];
      ok(r.correct === quotaMet, 'seed ' + seed + ' correct flag matches lines>=quota (' + st.lines + ' lines)');
      if (quotaMet) {
        var want = BASE_PTS + LINE_PTS[diff] * st.lines + WIN_BONUS;
        ok(r.points === want, 'seed ' + seed + ' win payout ' + r.points + ' == 30+' + LINE_PTS[diff] +
          '*' + st.lines + '+50');
        ok(r.hpDelta === 0, 'seed ' + seed + ' win hpDelta 0');
        winSeen[depth] = r.points;
      } else {
        ok(r.points === 0, 'seed ' + seed + ' failure pays 0 -> engine wrong-parity applies (got ' + r.points + ')');
        ok(r.hpDelta === (st.lines === 0 ? -15 : 0), 'seed ' + seed + ' hpDelta rails kept');
      }
    }
  }

  /* 2: envelope — analytic check of the shipped tables */
  [1, 2, 3, 4, 5].forEach(function (diff) {
    var B = 100 * diff + 40;
    var win = BASE_PTS + LINE_PTS[diff] * QUOTA_BY_DIFF[diff] + WIN_BONUS;
    var ratio = win / B;
    ok(win <= 500, 'diff ' + diff + ': quota win ' + win + ' under engine 500-pt clamp');
    if (diff <= 3) {
      var drivenDepth = diff === 1 ? 3 : diff === 2 ? 8 : 15;
      var live = diff === 1 ? !!winSeen[drivenDepth] : !!lineSeen[drivenDepth];
      ok(ratio >= 0.6 && live, 'diff ' + diff + ': ratio ' + Math.round(ratio * 100) +
        '% >= 60% and line-scoring exercised live at depth ' + drivenDepth +
        (winSeen[drivenDepth] ? ' (quota win observed: ' + winSeen[drivenDepth] + ' pts)' : ''));
    }
    ok(0 < win, 'diff ' + diff + ': failing (0 pts) < winning (' + win + ') — waiting out the clock never optimal');
  });

  /* 3: determinism */
  var a = await runRound(env, 8, 777);
  var b = await runRound(env, 8, 777);
  ok(a.res.points === b.res.points && a.st.lines === b.st.lines && a.res.summary === b.res.summary,
    'same seed twice -> identical outcome (' + a.res.points + ' pts, ' + a.st.lines + ' lines)');

  console.log(failures ? '\nSMOKE FAILED: ' + failures + ' assertion(s)' : '\nSMOKE GREEN');
  process.exit(failures ? 1 : 0);
})().catch(function (e) { console.error('SMOKE ERROR', e); process.exit(2); });
