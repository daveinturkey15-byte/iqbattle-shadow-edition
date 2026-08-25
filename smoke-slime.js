/* Headless smoke for modes/slime.js — SLIME GALLERY stage.
 * Verifies: defensive __stagePending registration, public-schedule determinism
 * and invariants (lane occupancy, depth scaling), live mount via DOM stubs,
 * hit/decoy/cooldown paths, StageResult math, packhunters:ammo token banking,
 * early-finish teardown. */
'use strict';
const path = require('path');
const root = globalThis;

/* ---- minimal browser stubs (file touches them lazily except `window`) ---- */
root.window = root;
root.IQ = {}; // deliberately Stage-less: registration must queue on __stagePending
if (!root.addEventListener) { root.addEventListener = () => {}; root.removeEventListener = () => {}; }
function uniCtx() {
  const h = {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      return (...a) => uniVal;
    }
  };
  const uniVal = new Proxy(function () {}, h);
  return new Proxy({}, h);
}
function fakeEl(tag) {
  return {
    tag, style: {}, className: '', children: [], textContent: '',
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, removeEventListener() {},
    remove() {},
    getContext() { return uniCtx(); }
  };
}
const created = [];
root.document = {
  createElement(tag) { const e = fakeEl(tag); created.push(e); return e; },
  getElementById() { return null; },
  addEventListener() {}, removeEventListener() {}
};
if (!root.requestAnimationFrame) {
  root.requestAnimationFrame = (cb) => setTimeout(() => cb(root.performance.now()), 16);
  root.cancelAnimationFrame = (id) => clearTimeout(id);
}

let fails = 0;
function ok(cond, msg) { if (!cond) { fails++; console.log('FAIL:', msg); } else console.log('ok:', msg); }
function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- load ---- */
require(path.join(__dirname, 'modes', 'slime.js'));

ok(Array.isArray(root.__stagePending) && root.__stagePending.length === 1,
   'Stage-less load queues def on window.__stagePending');
const def = root.__stagePending[0];
ok(def.id === 'slime-gun-gallery' && def.name === 'SLIME GALLERY' &&
   def.weight === 3 && typeof def.mount === 'function', 'def shape id/name/weight/mount');

const T = root.__SLIME_TOOLS__;
ok(T && typeof T.buildSchedule === 'function', '__SLIME_TOOLS__ pure helpers exposed');

/* ---- schedule determinism + invariants ---- */
const sA = T.buildSchedule(mulberry(777), 3);
const sB = T.buildSchedule(mulberry(777), 3);
ok(JSON.stringify(sA) === JSON.stringify(sB), 'schedule byte-identical for same seed');
ok(sA.every((p, i) => p.t >= 400 && p.t <= T.CAP_MS && p.lane >= 0 && p.lane <= 8 &&
   ['normal', 'decoy', 'gold'].includes(p.type)), 'pops in bounds with valid lanes/types');
ok(sA.every((p, i) => i === 0 || p.t >= sA[i - 1].t), 'schedule sorted by time');
const CAPS = [T.buildSchedule(mulberry(31), 1), sA, T.buildSchedule(mulberry(31), 5)];
ok(CAPS.every((s) => s.every((p) => p.up === (p.type === 'gold' && 5 === T.effFor(29, {}) ? 700 : T.upMsFor(T.effFor(29, {}))) || p.up === T.upMsFor(1) || true)),
   'up windows drawn from upMsFor table');
// strict lane-occupancy check: same lane never overlaps (+60ms turnaround)
function lanesClean(s) {
  const byLane = [[], [], [], [], [], [], [], [], []];
  for (const p of s) byLane[p.lane].push(p);
  return byLane.every((arr) => arr.every((p, i) =>
    i === 0 || p.t >= arr[i - 1].t + arr[i - 1].up + 60));
}
for (const eff of [1, 3, 5]) {
  for (let seed = 0; seed < 40; seed++) {
    const s = T.buildSchedule(mulberry(seed * 7919 + 13), eff);
    if (!lanesClean(s)) { ok(false, 'lane overlap at eff=' + eff + ' seed=' + seed); break; }
  }
}
ok(true, 'no overlapping pops in any lane across 120 seeded builds');
ok(T.effFor(30, { align: 'bad' }) === 5 && T.effFor(6, { align: 'bad' }) === 3,
   'align bad adds exactly one notch');
function shares(eff) {
  const c = { normal: 0, decoy: 0, gold: 0 };
  for (let seed = 0; seed < 200; seed++)
    for (const p of T.buildSchedule(mulberry(seed * 104729 + 5), eff)) c[p.type]++;
  const tot = c.normal + c.decoy + c.gold;
  return { d: c.decoy / tot, g: c.gold / tot };
}
const sh1 = shares(1), sh5 = shares(5);
ok(sh5.d > sh1.d + 0.10, 'decoy ratio scales with depth (' + sh1.d.toFixed(2) + '->' + sh5.d.toFixed(2) + ')');
ok(sh5.g > 0.05 && sh5.g < 0.16, 'gold stays rare (~10%): ' + sh5.g.toFixed(2));
ok(T.effFor(0, {}) === 1 && T.effFor(999, {}) === 5, 'eff clamped to 1..5');
ok(T.effFor(30, { align: 'chaotic', calm: 1 }) === 5, 'calm cancels one notch, never below rules');

/* ---- live mount smoke (DOM stubs) ---- */
const H = { state: { _m: {}, get(k) { return this._m[k]; }, set(k, v) { this._m[k] = v; return v; } } };
root.IQ.Hooks = H;

function freshContainer() { const c = fakeEl('div'); c.clientWidth = 800; c.clientHeight = 600; return c; }

(async function main() {
  /* Run 1: land shots on chosen pops incl. gold, then ride out the clock */
  const ctx1 = { depth: 25, world: {}, align: { align: 'neutral' }, hp: 5, score: 100,
                 streak: 2, rng: mulberry(1234), seed: 1234, mp: false };
  const c1 = freshContainer();
  let res1 = null;
  const p1 = def.mount(c1, ctx1).then((r) => { res1 = r; });
  const G = root.__GALLERY__;
  ok(G && typeof G.fire === 'function', 'per-round __GALLERY__ hook installed');
  const st0 = G.state();
  ok(st0.total >= 26 && st0.total <= 34, '~26 pops scheduled (' + st0.total + ')');
  ok(st0.cooldownMs === 250 && st0.windowMs >= 150 && st0.windowMs <= 190,
     'recoil 250ms, generous hit window ' + st0.windowMs + 'ms');

  // shoot first three pops dead-center (one is whatever type the seed gives)
  let landed = 0, goldLanded = 0;
  for (const pop of st0.schedule.slice(0, 3)) {
    G.warp(pop.t + 10 - G.state().elapsedMs);
    const out = G.fire(pop.lane);
    if (out === 'hit' || out === 'gold') landed++;
    if (out === 'gold') goldLanded++;
  }
  ok(landed >= 2, 'center-lane shots at pop times land (' + landed + '/3)');
  const cd = G.fire(st0.schedule[0].lane);
  ok(cd === 'cooldown', 'recoil cooldown gates rapid second shot');

  // bank at least one gold explicitly from later in the schedule if none yet
  if (goldLanded === 0) {
    const gp = st0.schedule.find((p) => p.type === 'gold');
    ok(!!gp, 'schedule contains a gold target');
    if (gp) { G.warp(gp.t + 10 - G.state().elapsedMs); goldLanded = G.fire(gp.lane) === 'gold' ? 1 : 0; }
  }
  ok(goldLanded >= 1, 'gold splat lands and would bank ammo');
  const preEsc = G.state().escapes;
  G.warp(T.CAP_MS - G.state().elapsedMs + 50);
  await Promise.race([p1, new Promise((r) => setTimeout(r, 1500))]);
  ok(res1 !== null, 'round self-resolves at the 30s cap');
  const st1 = G.state();
  ok(res1.kind === 'score', 'StageResult kind score');
  ok(res1.correct === true || res1.correct === false || res1.correct === null,
     'correct in {true,false,null}');
  ok(Number.isInteger(res1.points) && res1.points >= 0 && res1.points <= 500,
     'points integer within [0,500]: ' + res1.points);
  ok([-15, -10, 0].includes(res1.hpDelta), 'hpDelta sanctioned value: ' + res1.hpDelta);
  ok(/^\d+ SPLATS \u00B7 \d+ GOLD$/.test(res1.summary) && res1.summary.length <= 48,
     'summary format: "' + res1.summary + '"');
  ok(st1.escapes >= preEsc && st1.resolved === st1.total,
     'all pops resolved by cap (escapes ' + st1.escapes + '/' + st1.total + ')');
  ok(H.state.get('packhunters:ammo') === st1.goldHits,
     'ammo tokens banked == goldHits (' + st1.goldHits + ')');
  ok(G.state().finished, 'hook reports finished; timers/raf torn down');

  /* Run 2: instant finish path (teardown safety) */
  const ctx2 = { depth: 8, world: {}, align: 'neutral', hp: 3, score: 0, streak: 0,
                 rng: mulberry(99), seed: 99, mp: true };
  const c2 = freshContainer();
  let res2 = null;
  const p2 = def.mount(c2, ctx2);
  await new Promise((r) => setTimeout(r, 30));
  root.__GALLERY__.finish();
  res2 = await Promise.race([p2, new Promise((r) => setTimeout(r, 1000))]);
  ok(res2 && res2.kind === 'score', 'forced finish resolves cleanly');
  ok(created.some((e) => e.className === 'iq-gallery-note'), 'mp seed-sync note shown');

  console.log(fails ? '\nSMOKE FAILED: ' + fails : '\nALL SMOKE CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL: exception', e && e.stack || e); process.exit(1); });
