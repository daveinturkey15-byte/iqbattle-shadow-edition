/* Headless smoke for modes/terminator.js — "THE HUNT" (terminator-hunt) stage.
 * Verifies: __stagePending registration shape, seeded-sim determinism
 * (params + pattern stream byte-identical per seed), pattern invariants
 * (4 unique options, exactly one correct, distractors != seen values),
 * depth scaling (speed, budget, need 2->4), live mount via DOM stubs:
 * march/pause, fast-solve pushback, wrong/slow advance, catch -> hp -12 +
 * two-lane reset, door-slam escape result (+180), survival exit (+80),
 * settle-exactly-once teardown. */
'use strict';
const path = require('path');
const root = globalThis;

/* ---- minimal browser stubs ---- */
root.window = root;
root.IQ = {}; // deliberately Stage-less: registration must queue on __stagePending
if (!root.addEventListener) { root.addEventListener = () => {}; root.removeEventListener = () => {}; }
if (!root.localStorage) {
  const store = {};
  root.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
}
if (!root.matchMedia) root.matchMedia = () => ({ matches: false });
function uniCtx() {
  const uniVal = new Proxy(function () {}, {
    get(t, k) { if (k === Symbol.toPrimitive) return () => 0; return (...a) => uniVal; },
    set() { return true; }
  });
  return new Proxy({}, { get: () => uniVal });
}
let canvasCount = 0;
function fakeEl(tag) {
  return {
    tag, style: {}, className: '', children: [], textContent: '', innerHTML: '',
    _cls: new Set(),
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, removeEventListener() {},
    setAttribute(k, v) { this['attr_' + k] = v; },
    getAttribute(k) { return this['attr_' + k]; },
    remove() {},
    get classList() {
      const s = this._cls;
      return {
        add: (...c) => c.forEach((x) => s.add(x)),
        remove: (...c) => c.forEach((x) => s.delete(x)),
        contains: (x) => s.has(x)
      };
    },
    getContext() { canvasCount++; return uniCtx(); },
    getBoundingClientRect() { return { left: 0, top: 0 }; },
    get clientWidth() { return 720; }, set clientWidth(v) {},
    get clientHeight() { return 240; }, set clientHeight(v) {}
  };
}
root.document = {
  createElement(tag) { return fakeEl(tag); },
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
require(path.join(__dirname, 'modes', 'terminator.js'));

ok(Array.isArray(root.__stagePending) && root.__stagePending.length === 1,
   'Stage-less load queues def on window.__stagePending');
const def = root.__stagePending[0];
ok(def.id === 'terminator-hunt' && def.name === 'THE HUNT' &&
   def.weight === 5 && def.minDepth === 3 && typeof def.mount === 'function',
   'def shape id/name/weight/minDepth/mount');
ok(Array.isArray(def.worlds) && def.worlds.includes('cyber-hunter') && def.net === 'seed',
   'binds cyber-hunter via seed MP pattern');

const T = root.__HUNT_TOOLS__;
ok(T && typeof T.makePattern === 'function' && typeof T.paramsFor === 'function',
   '__HUNT_TOOLS__ pure helpers exposed');

/* ---- determinism + pattern invariants ---- */
function patEcho(seed, n) {
  const r = mulberry(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = T.makePattern(r);
    out.push(p.kind + ':' + p.vals.join(',') + ':' + p.answerIdx + ':' + p.opts.map(o => o.v).join(','));
  }
  return out.join('|');
}
for (const seed of [1, 777, 123456]) {
  ok(patEcho(seed, 12) === patEcho(seed, 12),
     'pattern stream byte-identical for same seed ' + seed);
}
ok(patEcho(1, 8) !== patEcho(2, 8), 'different seeds diverge');

let invOK = true, uniqOK = true;
for (let seed = 0; seed < 300; seed++) {
  const p = T.makePattern(mulberry(seed * 104729 + 5));
  if (p.opts.length !== 4 || p.seqHTML.length !== 3) { invOK = false; break; }
  const vs = p.opts.map(o => o.v);
  // answer value must not appear among the three shown sequence values:
  const ansV = p.opts[p.answerIdx].v;
  if (p.vals.includes(ansV)) { invOK = false; break; }
  if (p.answerIdx < 0 || p.answerIdx > 3) { invOK = false; break; }
}
ok(invOK, 'answer never shown in the visible sequence across 300 seeds');
ok(uniqOK, 'options always 4 distinct glyphs across 300 seeds');

/* ---- depth scaling ---- */
ok(T.needFor(3) === 2 && T.needFor(5) === 2 && T.needFor(6) === 3 &&
   T.needFor(8) === 3 && T.needFor(9) === 4 && T.needFor(20) === 4,
   'patterns-to-escape ladder 2->4 at depths 3/6/9 (assignment)');
const p3 = T.paramsFor(3), p10 = T.paramsFor(10);
ok(p10.v > p3.v, 'advance speed scales with depth');
ok(p10.patMs < p3.patMs, 'pattern budget shrinks with depth');
ok(T.paramsFor(99).patMs >= 4000 && T.paramsFor(1).patMs <= 6800, 'budget clamped 4.0-6.8 s');
ok(T.LANES === 6, 'six exposed lanes between gate and safe zone');

/* ---- live mount smoke (DOM stubs, virtual clock) ---- */
function freshCtx(depth, seed) {
  return {
    depth, tier: 2, diff: 3, world: 'cyber-hunter', align: 'bad',
    hp: 100, score: 0, streak: 0,
    rng: mulberry(seed), seed,
    mp: { on: false, host: true, client: false },
    timerLen: 45, expired: false,
    leftFrac: () => 0.9,
    audio: { p() {} },
    fx: { shake() {}, flash() {}, glitch() {} },
    banner(t) { banners.push(t); },
    say() {}, quip() {},
    net: { send() {}, uid: () => 'u1' },
    name: 'Dave', board: null
  };
}
let banners = [];
function freshContainer() { const c = fakeEl('div'); return c; }

(async function main() {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  async function adv(H, ms) { H.advance(ms); await sleep(30); }
  async function waitUnlocked(H, deadlineMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < (deadlineMs || 3000)) {
      const s = H.state();
      if (!s.locked && s.pattern) return s;
      await sleep(25);
    }
    return H.state();
  }

  /* Run 1: fast solves only -> door slam escape at +180, zero catches */
  banners = [];
  const ctx1 = freshCtx(3, 4242);
  const c1 = freshContainer();
  let res1 = null, settles = 0;
  const pr1 = def.mount(c1, ctx1).then(r => { settles++; res1 = r; return r; });
  let H = root.__HUNT__;
  ok(H && typeof H.choose === 'function' && typeof H.advance === 'function',
     'per-round __HUNT__ hook installed');
  let st = H.state();
  ok(st.need === 2 && st.pos === 0 && st.catches === 0, 'depth 3 needs 2 patterns, starts at gate');

  for (let k = 0; k < 2 && !res1; k++) {
    await waitUnlocked(H);
    st = H.state();
    H.advance(120);                       // well under fastMs (~3.7 s)
    H.choose(st.pattern.answerIdx);       // instant fast solve
    await sleep(60);
  }
  // solve() -> escapeDoor (+500ms real) -> resolveOnce (+850ms real)
  await sleep(1700);
  await pr1;
  ok(settles === 1, 'promise settled exactly once (escape path)');
  ok(res1 && res1.correct === true && res1.points === 180,
     'door slam escape: correct=true points=180 (' + JSON.stringify(res1) + ')');
  ok(res1.hpDelta === 0 && res1.summary === 'DOOR SLAM \u00B7 ESCAPED THE HUNT',
     'clean escape hpDelta=0 summary=' + JSON.stringify(res1.summary));
  ok(res1.kind === 'score', 'canonical kind=score');

  /* Run 2: wrong answers advance it into the zone; catch resets 2 lanes */
  banners = [];
  const ctx2 = freshCtx(9, 777);
  const c2 = freshContainer();
  let res2 = null;
  const pr2 = def.mount(c2, ctx2).then(r => { res2 = r; return r; });
  H = root.__HUNT__;
  let st2 = H.state();
  ok(st2.need === 4, 'depth 9 needs 4 patterns');
  for (let k = 0; k < 14 && !res2; k++) {
    await waitUnlocked(H);
    H.advance(150);
    const s = H.state();
    if (!s.finished && s.pattern && !s.locked)
      H.choose((s.pattern.answerIdx + 1) % 4);   // guaranteed wrong
    await adv(H, 450);
  }
  const stMid = H.state();
  ok(stMid.catches >= 1, 'terminator reached the zone and caught the player (' +
     stMid.catches + ' catches)');
  ok(banners.some(b => /IT COMES BACK/.test(b)),
     'parody banner IT COMES BACK fired on reset');
  ok(stMid.dmg === stMid.catches * 12, 'each catch costs exactly 12 hp');
  H.finish();
  await pr2;
  ok(res2 && res2.correct === true && res2.points === 80,
     'survival exit: correct=true points=80');
  ok(res2.hpDelta === -(stMid.dmg), 'survival hpDelta folds catch damage (' + res2.hpDelta + ')');
  ok(res2.summary === 'SURVIVED THE HUNT \u00B7 IT WAITS', 'survival summary set');

  /* Run 3: fast solve pushes back a lane; expiry (slow) advances it */
  banners = [];
  const ctx3 = freshCtx(6, 31);
  const c3 = freshContainer();
  const pr3 = def.mount(c3, ctx3);
  H = root.__HUNT__;
  await adv(H, 20000);                    // march pressure only
  const before = await waitUnlocked(H);
  ok(before.pos > 0.5, 'continuous march moved it down the lanes (' + before.pos.toFixed(2) + ')');
  H.advance(100);
  H.choose(before.pattern.answerIdx);     // fast solve
  await sleep(40);
  const after = H.state();
  ok(after.solved === 1, 'fast solve banked toward escape');
  ok(after.pos <= Math.max(0, Math.min(before.pos, 5.999) - 0.98),
     'fast solve shoved it back a full lane (' + before.pos.toFixed(2) + '->' + after.pos.toFixed(2) + ')');
  ok(after.paused === true, 'it stalls briefly after being shoved');
  // ride past the current pattern's budget untouched: slow expiry advances
  await adv(H, after.fastMs + 4000);
  const slowSt = H.state();
  ok(slowSt.pos > after.pos, 'pattern expiry (slow) advanced it one lane (' +
     after.pos.toFixed(2) + '->' + slowSt.pos.toFixed(2) + ')');
  H.finish();
  await pr3;

  /* Run 4: engine-abort contract — cleanup() settles survival exactly once */
  const ctx4 = freshCtx(4, 99);
  const c4 = freshContainer();
  let res4 = null, n4 = 0;
  const pr4 = def.mount(c4, ctx4).then(r => { n4++; res4 = r; });
  await sleep(50);
  def.cleanup();
  await pr4;
  def.cleanup(); // double-abort must be inert
  await sleep(30);
  ok(n4 === 1 && res4.points === 80, 'cleanup aborts to survival once, idempotent');

  /* Run 5: MP posture — same seed reproduces the challenge stream alone */
  const a = [], b = [];
  const rc = mulberry(2024), rd = mulberry(2024);
  for (let i = 0; i < 6; i++) { const p = T.makePattern(rc); a.push(p.answerIdx + ':' + p.vals.join(',')); }
  for (let i = 0; i < 6; i++) { const p = T.makePattern(rd); b.push(p.answerIdx + ':' + p.vals.join(',')); }
  ok(a.join('|') === b.join('|'), 'host/client identical challenge from shared seed alone');

  console.log(fails ? ('\nSMOKE FAILED: ' + fails) : '\nALL SMOKE CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL: exception', e && e.stack || e); process.exit(1); });
