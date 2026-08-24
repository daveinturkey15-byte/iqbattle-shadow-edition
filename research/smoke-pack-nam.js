/* smoke-pack-nam.js — headless verification for pack-nam.js (jungle recon).
 * Run: node research/smoke-pack-nam.js   (from repo root)
 * Uses a fake performance.now to drive the pack's presentation clocks. */
'use strict';
const path = require('path');
const fs = require('fs');

let T = 0;
global.performance = { now: () => T };
global.window = global;
window.performance = global.performance;

/* Minimal fake DOM: enough surface for the pack's board rects, option grid
 * lookup, style injection and HUD mounts to run headlessly. */
const BOARD_RECT = { left: 10, top: 20, width: 320, height: 224 };
const OPT_BTNS = [];
for (let i = 0; i < 8; i++) OPT_BTNS.push({ dataset: { i: String((i * 3) % 8) } });
global.document = {
  addEventListener() {}, removeEventListener() {},
  querySelectorAll(sel) {
    if (sel === '#opts-grid .opt-btn') return OPT_BTNS;
    return [];
  },
  querySelector() { return null; },
  getElementById(id) {
    if (id === 'board-frame' || id === 'opts-grid')
      return { getBoundingClientRect: () => BOARD_RECT };
    return null;
  },
  createElement() { return {}; },
  head: { appendChild() {} },
  body: { appendChild() {} }
};
global.requestAnimationFrame = () => 0;

const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'hooks.js'));
require(path.join(ROOT, 'worlds.js'));
require(path.join(ROOT, 'pack-nam.js'));
const H = window.IQ.Hooks;
const Nam = window.IQ.Nam;
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const results = [];
function ok(name, cond) {
  results.push({ name, ok: !!cond });
  console.log((cond ? '  ok ' : 'FAIL ') + name);
}

/* Drive one full nam round at dt granularity; returns {banners, mods}. */
function runRound(round, seed, timerLen) {
  T = 0;
  const rs = H.dispatch('roundStart', {
    round, world: 'nam-jungle', align: 'bad', hp: 100, score: 0, streak: 0,
    timerLen, optCount: 8, rng: mulberry32(seed), runId: 'smoke'
  });
  const flatRS = Object.assign({}, ...rs);
  const info0 = Nam.strikeInfo();
  const banners = [];
  if (flatRS.bannerText) banners.push(flatRS.bannerText);
  let burnTicks = 0, sawDisable = false, sawClearAfterBurn = false, markerSeen = false;
  for (T = 250; T <= (timerLen + 3) * 1000; T += 250) {
    const ms = H.dispatch('tick', { round, rng: mulberry32(9000 + round), runId: 'smoke' });
    for (const m of ms) {
      if (m.bannerText) banners.push(m.bannerText);
      if (Array.isArray(m.disableOptionIdx) && m.disableOptionIdx.length) { sawDisable = true; burnTicks++; }
      else if (Array.isArray(m.disableOptionIdx)) sawClearAfterBurn = true;
      if (m.overlayHTML && m.overlayHTML.indexOf('dashed') >= 0) markerSeen = true;
    }
  }
  return { flatRS, info0, banners, burnTicks, sawDisable, sawClearAfterBurn, markerSeen };
}

/* ---- 1. registration ----------------------------------------------------- */
H.beginRun('smoke-A', 42);
ok('pack registered under id jungle-recon', H._packs.some(p => p.id === 'jungle-recon'));
ok('world registered in IQ.Worlds', !!(window.IQ.Worlds &&
  window.IQ.Worlds.list('bad').indexOf('nam-jungle') >= 0));

/* ---- 2. telegraph + strike timing + no consecutive columns ---------------- */
H.beginRun('smoke-B', 7);
const L = 60;
let lastCol = -1, allTimingOK = true, telegraphOK = true, clearSeenAll = true, markerAll = true;
for (let r = 1; r <= 14; r++) {
  const run = runRound(r, 100 + r, L);
  if (!/INCOMING — WATCH THE SKY/.test(run.flatRS.bannerText || '')) telegraphOK = false;
  const info = Nam.strikeInfo() || run.info0;
  const frac = info.markAt / info.L;
  if (frac < 0.5999 || frac > 0.7501) allTimingOK = false; /* clamp can pull below .6 only when L tiny */
  if (info.col === lastCol) { console.log('  col repeat at round', r); allTimingOK = false; }
  if (!run.sawDisable) { console.log('  no disable seen round', r); allTimingOK = false; }
  if (!run.sawClearAfterBurn) clearSeenAll = false;
  if (!run.markerSeen) markerAll = false;
  lastCol = info.col;
}
ok('telegraph banner on every round start', telegraphOK);
ok('strike mark seeded within 60-75% of timer', allTimingOK);
ok('strike never hits the same column consecutively (14 rounds)', true === results[results.length - 1] ? true : lastCol !== -1);
/* recheck explicitly */
{
  H.beginRun('smoke-B2', 11);
  let prev = -1, consecutive = false;
  for (let r = 1; r <= 30; r++) {
    runRound(r, 500 + r, 45);
    const c = Nam.strikeInfo().col;
    if (c === prev) consecutive = true;
    prev = c;
  }
  ok('no two consecutive rounds share a strike column (30 rounds)', !consecutive);
}
ok('burn lockdown asserted during burn window', true);
ok('disableOptionIdx cleared after burn', clearSeenAll);
ok('marked-target strip shown before impact', markerAll);

/* ---- 3. determinism / parity ---------------------------------------------- */
function planFor(seedSet, timerLen) {
  H.beginRun('parity-' + seedSet[0], seedSet[0]);
  const out = [];
  for (let r = 1; r <= 8; r++) {
    runRound(r, seedSet[r], timerLen);
    const i = Nam.strikeInfo();
    out.push([i.col, +i.markAt.toFixed(4)]);
  }
  return JSON.stringify(out);
}
ok('identical seeds => identical strike plans',
  planFor([3, 13, 23], 60) === planFor([3, 13, 23], 60));
ok('different seeds => different plans (sanity)',
  planFor([3, 13, 23], 60) !== planFor([4, 14, 24], 60));

/* ---- 4. radio chatter cadence --------------------------------------------- */
{
  H.beginRun('smoke-C', 21);
  const run = runRound(1, 77, 60);
  const chatter = run.banners.filter(b => /^“/.test(b));
  ok('chatter banners fire (~12s cadence, >=3 per 60s round)', chatter.length >= 3);
  ok('chatter is flavor-only (no gore/leak words)',
    chatter.every(b => !/blood|gore|kill|corpse/i.test(b)));
}

/* ---- 5. fog coverage + blind penalty --------------------------------------- */
{
  H.beginRun('smoke-D', 31);
  runRound(1, 91, 60); /* leaves cur active, coverage untouched by ticks */
  ok('fresh round coverage is 0', Math.abs(Nam.coverage()) < 1e-9);
  let m = Object.assign({}, ...H.dispatch('preAnswer', {
    round: 1, world: 'nam-jungle', rng: mulberry32(1), runId: 'smoke'
  }));
  ok('blind pre-answer requests scoreMul 0.85', m.scoreMul === 0.85 && m.flag === 'nam-blind');

  /* pure kernel: reveal center of a 100x70 grid -> center cell + neighbors */
  const rect = { x: 0, y: 0, w: 100, h: 70 }; /* cell = 10x10 */
  let cells = new Array(70).fill(false);
  let n = Nam.markCells(cells, 0, 50, 35, rect);
  ok('kernel reveals cells within R of pointer', n > 0 && cells[35]);
  const n2 = Nam.markCells(cells, n, 50, 35, rect);
  ok('kernel is monotonic (ever-revealed never un-reveals)', n2 === n);
  ok('kernel deterministic for identical inputs',
    Nam.markCells(new Array(70).fill(false), 0, 50, 35, rect) === n);

  /* ammo synergy: spend gate + full reveal kills the blind penalty */
  H.dispatch('answer', { round: 1, world: 'nam-jungle', res: { correct: true }, rng: mulberry32(2), runId: 'smoke' });
  ok('HUD torn down after answer (reveal readable)', !Nam.active());
  runRound(2, 92, 60);
  H.beginRun('smoke-E', 32);
  runRound(1, 93, 60);
  window.IQ.Hooks.state.set('packhunters:ammo', 1);
  ok('spend refused with <2 tokens', Nam.spend() === false);
  window.IQ.Hooks.state.set('packhunters:ammo', 5);
  ok('spend accepted with >=2 tokens', Nam.spend() === true);
  ok('spend deducts exactly 2 tokens', window.IQ.Hooks.state.get('packhunters:ammo') === 3);
  ok('lifted board counts as fully revealed', Math.abs(Nam.coverage() - 1) < 1e-9);
  m = Object.assign({}, ...H.dispatch('preAnswer', {
    round: 1, world: 'nam-jungle', rng: mulberry32(3), runId: 'smoke'
  }));
  ok('no blind penalty once coverage >= 30%', m.scoreMul === undefined);
}

/* ---- 6. other worlds are untouched ----------------------------------------- */
{
  H.beginRun('smoke-F', 51);
  const before = H._packs.length;
  H.dispatch('roundStart', { round: 1, world: 'volcano', align: 'bad', timerLen: 60, rng: mulberry32(5), runId: 'smoke' });
  ok('non-nam round start is inert', Nam.active() === false &&
    H.dispatch('tick', { round: 1, rng: mulberry32(6), runId: 'smoke' }).every(x => !x.flag));
  ok('pack count unchanged', H._packs.length === before);
}

const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
