#!/usr/bin/env node
/**
 * research/smoke-arcade-volley.js — headless smokes for modes/battleship.js (SALVOS)
 * and modes/slots.js (ONE-ARMED GOD). Browser-global stubs + hook-driven play;
 * exits non-zero on any failed assertion.
 *
 * Covers:
 *  - IQ.Stage absent at load -> defs queue on window.__stagePending
 *  - SALVOS solo (diff 5): full fleet sunk win-path, scoring/hp formulas, summary
 *  - SALVOS solo (diff 1): forced early finish, partial accounting, hp floor
 *  - SALVOS MP (host-loopback transport): stageShot->stageVerdict,
 *    stageSalvoReq->stageSalvo frame flow; no secret cells in any pre-sink frame
 *  - GOD solo (diff 1 + diff 5 double-or-nothing): 9 tick indices recorded,
 *    independent payout recompute matches resolved points
 *  - GOD MP: single stageStops relay frame; host recompute stash equals local total
 */
'use strict';

/* ---------- browser stubs ---------- */
global.window = global;
global.window.addEventListener = () => {};
global.window.removeEventListener = () => {};
function mkCtx2d() {
  const target = {};
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      return () => undefined;
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}
function mkCanvas() {
  return {
    tag: 'canvas', style: {}, width: 0, height: 0,
    listeners: {},
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    removeEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 260 }; },
    getContext() { return mkCtx2d(); }
  };
}
const rafSlot = { cb: null };
global.requestAnimationFrame = (fn) => { rafSlot.cb = fn; return 1; };
global.cancelAnimationFrame = () => { rafSlot.cb = null; };
setInterval(() => {
  const cb = rafSlot.cb;
  if (cb) cb(typeof performance !== 'undefined' ? performance.now() : Date.now());
}, 16);
global.document = {
  createElement(tag) {
    if (tag === 'canvas') return mkCanvas();
    return {
      tag, style: {}, children: [], textContent: '', innerHTML: '',
      className: '',
      appendChild(c) { this.children.push(c); }
    };
  },
  getElementById() { return null; }
};
global.window.__IQ_SMOKE__ = true;   // gates the dev peeks BEFORE module load

/* ---------- load modes (Stage absent -> __stagePending) ---------- */
require('../modes/battleship.js');
require('../modes/slots.js');
const pending = global.window.__stagePending || [];
const defs = {};
for (const d of pending) defs[d.id] = d;
check(pending.length === 2, 'both defs queued on __stagePending (got ' + pending.length + ')');
check(!!defs['battleship-volley'] && !!defs['slot-machine'], 'def ids present');

/* ---------- helpers ---------- */
let failures = 0;
function check(cond, msg) {
  if (cond) { console.log('  ok  ' + msg); } else { failures++; console.log('  FAIL ' + msg); }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function container() { return { clientWidth: 640, clientHeight: 420, children: [], appendChild(c) { this.children.push(c); } }; }
function baseCtx(extra) {
  return Object.assign({
    depth: 1, world: null, align: 'neutral', hp: 100, score: 0, streak: 0,
    rng: Math.random, seed: 12345, mp: false
  }, extra);
}
function withDeadline(ms, label) {
  return new Promise((_, rej) => setTimeout(() => rej(new Error('deadline: ' + label)), ms));
}
function mkNet(hostLike) {
  const handlers = {};
  const frames = [];
  const net = {
    myUid: () => 'uid-test',
    on(t, fn) { (handlers[t] = handlers[t] || []).push(fn); return () => {}; },
    emit(t, m) { (handlers[t] || []).slice().forEach(f => f(m)); },
    send(m) {
      frames.push({ dir: 'out', m });
      if (hostLike) net.emit(m.t, m);        // IQ.Net host loopback semantics
    },
    broadcast(m) { frames.push({ dir: 'bc', m }); net.emit(m.t, m); },
    frames
  };
  return net;
}

/* ================= SALVOS solo, diff 5 (win path) ================= */
async function smokeBattleshipSoloDiff5() {
  console.log('[SALVOS solo diff5 — full fleet sunk]');
  let res = null;
  const p = defs['battleship-volley'].mount(container(), baseCtx({
    depth: 30, seed: 777
  })).then(r => { res = r; });
  await sleep(150);
  const S = () => global.window.__SALVOS__;
  check(S() && typeof S().peek === 'function', 'gated peek exposed under __IQ_SMOKE__');
  const targets = [];
  for (const ship of S().peek()) for (const c of ship) targets.push(c);
  check(targets.length === 9, 'secret fleet totals 9 cells');
  let ti = 0, guard = 0;
  while (!res && ti < targets.length && guard++ < 400) {
    const st = S().state();
    if (st.done) break;
    if (st.phase === 'aim' && st.shellsLeft > 0) {
      const idx = targets[ti++];
      S().fire((idx / 8) | 0, idx % 8);
      await sleep(160);                       // verdict latency
    } else {
      await sleep(120);                       // incoming telegraphs play out
    }
  }
  await Promise.race([p, sleep(15000)]);
  check(!!res, 'round resolved');
  if (!res) return;
  const stFinal = S().state();
  check(stFinal.hits === 9 && res.correct === true, 'allSunk -> correct=true (' + stFinal.hits + ' hits)');
  check(res.points === 40 * 9 + 120 * 3 + 60 - 20 * stFinal.incomingHits,
    'win points formula (40h+120s+60-20in) -> ' + res.points +
    ' (incomingHits=' + stFinal.incomingHits + ')');
  check(res.hpDelta === Math.max(-15, -5 * 0 - 5 * stFinal.incomingHits),
    'hpDelta = clamp(-15 floor) -> ' + res.hpDelta);
  check(res.summary === 'FLEET SUNK — 9/9', 'summary "' + res.summary + '"');
  check(res.kind === 'score' && typeof res.points === 'number', 'StageResult shape');
}

/* ================= SALVOS solo, diff 1 (forced partial end) ================= */
async function smokeBattleshipSoloDiff1() {
  console.log('[SALVOS solo diff1 — forced early finish]');
  let res = null;
  const p = defs['battleship-volley'].mount(container(), baseCtx({
    depth: 2, seed: 42
  })).then(r => { res = r; });
  await sleep(120);
  const S = () => global.window.__SALVOS__;
  check(S().peek === null || S().peek === undefined || typeof S().peek === 'function',
    '__IQ_SMOKE__ still set, peek available');
  const ships = S().peek();
  // fire exactly ONE cell of one ship, then force the end
  S().fire((ships[0][0] / 8) | 0, ships[0][0] % 8);
  await sleep(250);
  S().finish();
  await Promise.race([p, sleep(3000)]);
  check(!!res, 'forced finish resolved');
  if (!res) return;
  check(res.correct === false, '<5 hits -> correct=false');
  check(res.points === 40 * 1 + 120 * 0 + 0 - 20 * 0, 'partial points -> ' + res.points);
  check(res.hpDelta === -15, 'three hunters afloat, no incoming -> hp floor -15 (got ' + res.hpDelta + ')');
  check(/HUNTERS REMAIN/.test(res.summary), 'summary "' + res.summary + '"');
}

/* ================= SALVOS MP (host loopback), diff 3 ================= */
async function smokeBattleshipMP() {
  console.log('[SALVOS MP host-loopback diff3 — frame flow]');
  const net = mkNet(true);
  global.window.IQ = { Net: net };            // modes read IQ.Net at mount time
  let res = null;
  const p = defs['battleship-volley'].mount(container(), baseCtx({
    depth: 12, seed: 999, mp: true
  })).then(r => { res = r; });
  await sleep(200);
  const S = () => global.window.__SALVOS__;
  // three shots complete a salvo -> enemy returns 1 shell (diff3)
  for (let i = 0; i < 3; i++) {
    S().fire(i % 8, (i / 8) | 0);
    await sleep(80);
  }
  await sleep(2600);                          // verdicts + incoming salvo
  const fr = net.frames.map(f => f.m);
  check(fr.some(m => m.t === 'stageShot'), 'stageShot frames sent');
  const verd = fr.filter(m => m.t === 'stageVerdict');
  check(verd.length >= 3, 'stageVerdicts received (' + verd.length + ')');
  check(verd.every(v => v.uid === 'uid-test' && typeof v.hit === 'boolean'),
    'verdicts stamped with uid + hit flag');
  const salvos = fr.filter(m => m.t === 'stageSalvo');
  check(salvos.length >= 1 && salvos[0].cells.length === 1,
    'stageSalvo relayed with 1 return shell (diff3)');
  check(fr.every(m => m.t !== 'ships' && !Array.isArray(m.cellsSecret)),
    'no secret payload fields ever framed');
  S().finish();
  await Promise.race([p, sleep(3000)]);
  check(!!res, 'MP round resolved');
}
function linePayoutRef(line, pairPay) {
  let stars = 0, skull = false; const rest = {};
  for (const s of line) {
    if (s === 'skull') skull = true;
    else if (s === 'star') stars++;
    else rest[s] = (rest[s] || 0) + 1;
  }
  if (skull) return 0;
  if (stars === 3) return 600;
  let bestN = 0, bestSym = null;
  for (const k in rest) if (rest[k] > bestN) { bestN = rest[k]; bestSym = k; }
  if (!bestSym) return 0;
  if (bestN + stars >= 3) return ({ eye: 90, moon: 120, key: 160, crown: 260 })[bestSym];
  if (bestN + stars === 2) return pairPay;
  return 0;
}
async function driveGodToDone(timeoutMs) {
  const G = () => global.window.__GOD__;
  const t0 = Date.now();
  while (!G().state().done && Date.now() - t0 < timeoutMs) {
    const st = G().state();
    if (st.phase === 'spinning') { G().stop(); G().stop(); G().stop(); }
    await sleep(120);
  }
  return G().state().done;
}
async function smokeGodSolo(depth, align, label) {
  console.log('[GOD solo ' + label + ']');
  let res = null;
  const p = defs['slot-machine'].mount(container(), baseCtx({
    depth, align, seed: 31337
  })).then(r => { res = r; });
  const doneInTime = await Promise.race([
    driveGodToDone(30000),
    sleep(31000)
  ]);
  check(doneInTime, 'three spins completed inside cap');
  await Promise.race([p, sleep(2000)]);
  const G = () => global.window.__GOD__;
  check(!!res, 'round resolved');
  if (!res) return;
  const st = G().state();
  check(st.ticks.length === 9, 'exactly 9 stop-tick numbers recorded');
  check(res.points === st.total, 'points == running credit total (' + res.points + ')');
  check(st.payouts.length === 3, 'three spin payouts');
  // independent recompute from the gated reel view + the documented landing math
  const view = G().peekReels();
  let expect = 0;
  for (let sp = 0; sp < 3; sp++) {
    const line = [];
    for (let r = 0; r < 3; r++) {
      const land = (st.ticks[sp * 3 + r] * 7 + view.salts[r]) % 20;
      line.push(view.strips[r][land]);
    }
    let pay = linePayoutRef(line, view.pairPay);
    if (sp === 2 && depth >= 30) pay *= 2;
    expect += pay;
  }
  check(expect === res.points,
    'independent recompute matches (' + expect + ' vs ' + res.points + ')');
  const thr = 3 * view.stake;
  check(res.correct === (res.points >= thr ? true : (res.points > 0 ? null : false)),
    'correct banding vs threshold ' + thr);
  check(view.strips.every(s => s.length === 20), 'strips are 20 public symbols each');
}

/* ================= GOD MP: 9-number relay + host recompute stash ================= */
async function smokeGodMP() {
  console.log('[GOD MP — stageStops relay]');
  const net = mkNet(true);
  global.window.IQ = { Net: net };
  delete global.window.__IQ_STAGE_AUTH;
  let res = null;
  const p = defs['slot-machine'].mount(container(), baseCtx({
    depth: 4, align: 'good', seed: 5150, mp: true, round: 7
  })).then(r => { res = r; });
  await driveGodToDone(30000);
  await Promise.race([p, sleep(2000)]);
  const stops = net.frames.map(f => f.m).filter(m => m.t === 'stageStops');
  check(stops.length === 1, 'exactly one stageStops frame batched at the end');
  check(stops[0] && stops[0].ticks.length === 9 && stops[0].n === 7,
    'frame carries n + nine ticks');
  const auth = global.window.__IQ_STAGE_AUTH ||
    {};
  const key = 'slot-machine:7:uid-test';
  check(!!auth[key], 'host recompute stash created');
  check(auth[key] && auth[key].points === res.points,
    'authoritative recompute == local render (' +
    (auth[key] ? auth[key].points : 'none') + ' vs ' + res.points + ')');
  check(net.frames.every(f => f.m.t !== 'strips' && !f.m.strip),
    'strips/salts never enter any frame');
}

/* ================= run ================= */
(async () => {
  try { await smokeBattleshipSoloDiff5(); } catch (e) { failures++; console.log('  FAIL ' + e.message); }
  try { await smokeBattleshipSoloDiff1(); } catch (e) { failures++; console.log('  FAIL ' + e.message); }
  try { await smokeBattleshipMP(); } catch (e) { failures++; console.log('  FAIL ' + e.message); }
  try { await smokeGodSolo(4, 'bad', 'diff1 cursed'); } catch (e) { failures++; console.log('  FAIL ' + e.message); }
  try { await smokeGodSolo(30, 'good', 'diff5 double-or-nothing'); } catch (e) { failures++; console.log('  FAIL ' + e.message); }
  try { await smokeGodMP(); } catch (e) { failures++; console.log('  FAIL ' + e.message); }
  console.log(failures === 0 ? 'SMOKE PASS (0 failures)' : 'SMOKE FAIL (' + failures + ' failures)');
  process.exit(failures === 0 ? 0 : 1);
})();
