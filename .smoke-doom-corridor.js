/* .smoke-doom-corridor.js — behavioral harness for modes/doom.js in node.
 * Run: node .smoke-doom-corridor.js   (exit 0 = pass)
 *
 * Stubs just enough DOM/canvas to mount the stage, then drives the
 * window.__DOOM__ self-play hook through real gameplay steps:
 *   - registration shape lands in IQ.Stage.register (or __stagePending)
 *   - movement / turning / firing mutate sim state sensibly
 *   - same seed => byte-identical state streams (PATTERN Q world gen)
 *   - finish() resolves the documented StageResult contract
 */
'use strict';
const path = require('path');
global.window = globalThis;
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.addEventListener = () => {};
global.removeEventListener = () => {};
const timers = new Set();
const _setI = setInterval.bind(global), _clrI = clearInterval.bind(global);
global.setInterval = (fn, ms) => { const h = _setI(fn, ms); timers.add(h); return h; };
global.clearInterval = h => { timers.delete(h); _clrI(h); };
function grad() { return { addColorStop() {} }; }
const g2stub = {
  fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
  fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
  closePath() {}, fill() {}, stroke() {}, arc() {}, save() {}, restore() {},
  translate() {}, rotate() {},
  createRadialGradient: grad, createLinearGradient: grad
};
function mkEl(tag) {
  const el = {
    tag, children: [], style: {}, className: '', type: '',
    textContent: '', innerHTML: '',
    appendChild(c) { el.children.push(c); return c; },
    removeEventListener() {}, addEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 260 }; },
    setPointerCapture() {}
  };
  if (tag === 'canvas') {
    let w = 0, h = 0;
    Object.defineProperty(el, 'width', { get: () => w, set: v => { w = v; } });
    Object.defineProperty(el, 'height', { get: () => h, set: v => { h = v; } });
    el.getContext = () => g2stub;
  }
  return el;
}
global.document = {
  createElement(tag) { return mkEl(tag); }
};
const container = { clientWidth: 400, clientHeight: 300, children: [], appendChild(c) { container.children.push(c); return c; } };
let rafCb = null;
global.requestAnimationFrame = cb => { rafCb = cb; return 1; };
global.cancelAnimationFrame = () => { rafCb = null; };

/* ---- real hooks rng, real mode file ---- */
const H = require(path.join(__dirname, 'hooks.js'));
const registered = [];
global.IQ = {
  Stage: {
    register(def) { registered.push(def); }
  }
};
require(path.join(__dirname, 'modes', 'doom.js'));

let failures = 0, passes = 0;
function ok(cond, msg) {
  if (!cond) { failures++; console.error('FAIL: ' + msg); }
  else { passes++; console.log('pass: ' + msg); }
}

ok(registered.length === 1, 'doom-corridor registered into IQ.Stage');
const def = registered[0];
ok(def.id === 'doom-corridor' && typeof def.name === 'string' &&
   typeof def.weight === 'number' && typeof def.mount === 'function',
   'registration shape {id,name,weight,mount}');

function mount(seed, depth) {
  const ctx = {
    depth: depth || 1, world: null, align: null, hp: 100, score: 0,
    streak: 0, mp: false, seed: seed >>> 0, rng: H.makeRng(seed >>> 0)
  };
  let result = null;
  const p = def.mount(container, ctx);
  p.then(r => { result = r; });
  return {
    doom: global.window.__DOOM__,
    result: () => result,
    done: () => result !== null
  };
}

(async function main() {
const flush = () => new Promise(r => setImmediate(r));
  const s = mount(0xC0FFEE, 1);
  ok(s.doom && typeof s.doom.step === 'function' && typeof s.doom.state === 'function',
     '__DOOM__ smoke hook exposed');
  const st0 = s.doom.state();
  ok(st0.shells > 0 && st0.pool === 100 && !st0.finished, 'initial pool=100, shells>0');
  ok(Math.abs(st0.x - 1.5) < 0.01 && Math.abs(st0.y - 1.5) < 0.01, 'spawns at (1.5,1.5)');

  const a0 = st0.a;
  s.doom.step('tl'); s.doom.step('tl');
  ok(s.doom.state().a !== a0, 'turning changes facing');

  const sh0 = s.doom.state().shells;
  s.doom.step('fire');
  const st1 = s.doom.state();
  ok(st1.shells === sh0 - 1 && st1.shots === 1, 'fire consumes one shell, counts shot');
  ok(st1.misses + st1.kills === 1, 'shot resolves to exactly one of hit|miss');

  // walk forward until blocked or clearly displaced (max 20 steps)
  let moved = 0, lastX = st0.x, lastY = st0.y;
  for (let i = 0; i < 20; i++) {
    s.doom.step('fwd');
    const st = s.doom.state();
    moved += Math.hypot(st.x - lastX, st.y - lastY);
    lastX = st.x; lastY = st.y;
  }
  ok(moved > 0.05 || s.doom.state().finished, 'forward input displaces player (or resolved)');
  ok(!s.result(), 'no premature resolve during play');

  s.doom.finish();
  await flush();
  ok(s.done(), 'finish() resolves');
  const r = s.result();
  ok(r && r.kind === 'score' && typeof r.points === 'number' &&
     (r.correct === true || r.correct === false || r.correct === null) &&
     typeof r.hpDelta === 'number' && typeof r.summary === 'string',
     'StageResult shape {kind,correct,points,hpDelta,summary}');
  ok(r.points >= 0, 'points floored at 0');
  ok(r.hpDelta >= -15 && r.hpDelta <= 15, 'hpDelta clamped to [-15,+15]');
  ok(r.summary.length <= 48, 'summary <=48 chars');

/* --- scenario 2: same seed => identical deterministic stream --- */
{
  const A = mount(1234, 3);
  const B = mount(1234, 3);
  const acts = ['fwd', 'tr', 'fwd', 'fire', 'fwd', 'sl', 'back', 'fire', 'tr', 'fwd'];
  let same = true;
  for (const a of acts) {
    A.doom.step(a); B.doom.step(a);
    const sa = JSON.stringify(A.doom.state());
    const sb = JSON.stringify(B.doom.state());
    if (sa !== sb) { same = false; break; }
  }
  ok(same, 'same seed + same inputs => identical state stream (PATTERN Q)');
}

/* --- scenario 3: deep-depth soak (diff scaling, demons, pickups) --- */
{
  const s = mount(99, 42); // diff 5: 6 demons, scarce ammo
  const st0 = s.doom.state();
  ok(st0.shells <= 8, 'diff>=4 starts ammo-scarce (' + st0.shells + ' shells)');
  const dirs = ['fwd', 'tl', 'tr', 'sl', 'sr'];
  let err = null, sawHitOrTime = false;
  try {
    for (let i = 0; i < 450 && !s.done(); i++) {           // ~45s simulated
      if (i % 7 === 0) s.doom.step('fire');
      s.doom.step(dirs[i % dirs.length]);
      if (i % 13 === 0) s.doom.step('back');
      const st = s.doom.state();
      if (st.hits > 0 || st.elapsedMs >= 40000) sawHitOrTime = true;
    }
  } catch (e) { err = e; }
  ok(!err, 'deep soak throws nothing' + (err ? ' (' + err.message + ')' : ''));
  ok(s.done() || s.doom.state().elapsedMs >= 40000, 'cap/self-resolve reachable');
    await flush();
  ok(sawHitOrTime, 'sim advanced materially (hits landed or clock ran)');
  if (s.done()) {
    const r = s.result();
    ok(r && ['EXITED', 'CONSUMED BY THE CORRIDOR', 'LOST IN THE CORRIDOR']
       .some(pfx => r.summary.indexOf(pfx) === 0), 'summary matches design vocabulary: "' + r.summary + '"');
  }
}
  for (const h of timers) _clrI(h);
  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);

})().catch(e => { console.error(e); process.exit(1); });
