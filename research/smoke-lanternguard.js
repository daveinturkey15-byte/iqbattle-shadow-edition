#!/usr/bin/env node
/**
 * research/smoke-lanternguard.js — headless smokes for modes/lanternguard.js
 * (LANTERN WATCH). Browser-global stubs + direct stage driving via the
 * __LANTERNGUARD__ peek; exits non-zero on any failure.
 *
 * Covers:
 *  - IQ.Stage absent at load -> def queues on window.__stagePending
 *  - determinism: same seed -> byte-identical grove layout/question/moths;
 *    different seeds -> different schedules
 *  - lantern dim timing: >=2.2s cumulative dwell in one spot -> 0.7s
 *    telegraph -> 25% dim (radius 140 -> 105) for exactly 3.0s -> recover;
 *    moving between spots resets the cumulative dwell
 *  - fairness: silhouettes / dimmed lantern NEVER block hit-testing — a press
 *    while dimmed still resolves the round
 *  - CLEAR-EYED bonus: +20 on correct-at-full-brightness; withheld while
 *    dimmed and unavailable in touch fallback (pinned centre, moths disabled)
 *  - StageResult canonical shape; Esc/P pause freezes input
 */
'use strict';

/* ---------- browser stubs ---------- */
global.window = global;
const handlers = {};
global.window.addEventListener = (t, fn) => { (handlers[t] = handlers[t] || []).push(fn); };
global.window.removeEventListener = () => {};
function mkEl(tag) {
  const cls = new Set();
  return {
    tag, style: {}, children: [], textContent: '', innerHTML: '', dataset: {},
    className: '', offsetWidth: 0,
    setAttribute() {}, getAttribute() { return null; },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.unshift(c); return c; },
    remove() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 420 }; },
    classList: {
      add(...a) { a.forEach(x => cls.add(x)); },
      remove(...a) { a.forEach(x => cls.delete(x)); },
      toggle(n, f) { if (f === undefined) f = !cls.has(n); if (f) cls.add(n); else cls.delete(n); return f; },
      contains(n) { return cls.has(n); }
    }
  };
}
global.document = {
  createElement(tag) { return mkEl(tag); },
  getElementById() { return null; }
};

/* ---------- load mode (Stage absent -> __stagePending) ---------- */
require('../modes/lanternguard.js');
const pending = global.window.__stagePending || [];
const def = pending.find(d => d.id === 'lanternguard');

let failures = 0;
function check(cond, msg) {
  if (cond) { console.log('  ok  ' + msg); } else { failures++; console.log('  FAIL ' + msg); }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function container() { return { clientWidth: 640, clientHeight: 420, children: [], appendChild(c) { this.children.push(c); } }; }
function baseCtx(seed) {
  return {
    depth: 6, tier: 2, diff: 3, world: null, align: 'neutral', hp: 80, score: 100, streak: 1,
    seed, rng: mulberry32(seed), mp: { on: false }, timerLen: 20, expired: false,
    audio: { p() {} }, fx: { shake() {}, flash() {}, glitch() {} }, banner() {}, say() {}
  };
}

let fakeT = 0;
async function mount(seed) {
  fakeT = 0;
  global.window.__LANTERN_CLOCK__ = () => fakeT;
  const p = def.mount(container(), baseCtx(seed));
  return { p, peek: global.window.__LANTERNGUARD__ };
}
function shapeOK(r) {
  return !!r && r.kind === 'score' && typeof r.correct === 'boolean' &&
    typeof r.points === 'number' && typeof r.summary === 'string' && r.summary.length <= 64 &&
    (r.hpDelta === undefined || typeof r.hpDelta === 'number');
}
const PAY3 = 310; /* LG_PAY[diff-1] at diff 3 */

(async () => {
  console.log('[LANTERN WATCH — registration]');
  check(!!def, 'def queued on __stagePending with id lanternguard');
  check(def.weight === 3 && def.minDepth === 4 && def.net === 'seed' && def.name === 'LANTERN WATCH',
    'registration shape: weight 3 / minDepth 4 / net seed / name LANTERN WATCH');

  console.log('[LANTERN WATCH — determinism]');
  let a, b;
  ({ peek: a } = await mount(777)); a = JSON.stringify(a.sch); def.cleanup();
  ({ peek: b } = await mount(777)); b = JSON.stringify(b.sch); def.cleanup();
  check(a === b, 'same seed -> byte-identical grove schedule');
  ({ peek: b } = await mount(778)); b = JSON.stringify(b.sch); def.cleanup();
  check(a !== b, 'different seed -> different grove schedule');

  console.log('[LANTERN WATCH — moth dim timing state machine]');
  {
    const { peek } = await mount(42);
    check(peek.radius() === 140 && !peek.dimActive(), 'lantern starts full (radius 140)');
    /* hover one spot: feed every 200ms of virtual time */
    for (let k = 0; k < 12; k++) { fakeT += 200; peek.feed(30, 30, 'mouse'); }
    check(peek.dwell() >= 2200, `cumulative dwell reached 2.2s (${Math.round(peek.dwell())}ms)`);
    check(peek.phase() === 'tele', 'telegraph phase after 2.2s cumulative hover');
    check(peek.radius() === 140, 'still full brightness during telegraph');
    fakeT += 700; peek.feed(31, 30, 'mouse');
    check(peek.phase() === 'dim' && peek.dimActive(), 'dimmed after 0.7s telegraph');
    check(peek.radius() === 105, 'dim radius is 105px (-25%)');
    /* moving does NOT shorten the committed dim */
    fakeT += 1500; peek.feed(80, 20, 'mouse'); peek.feed(20, 80, 'mouse');
    check(peek.dimActive() && peek.radius() === 105, 'dim persists through movement');
    fakeT += 1500; peek.feed(50, 50, 'mouse'); /* 3000ms since dim start */
    check(!peek.dimActive() && peek.radius() === 140 && peek.phase() === 'idle',
      'recovers exactly after 3.0s dim');
    /* dwell reset: hopping between distant spots never accumulates */
    for (let k = 0; k < 40; k++) { fakeT += 200; peek.feed(k % 2 ? 10 : 90, 50, 'mouse'); }
    check(peek.dwell() < 2200 && peek.phase() === 'idle',
      'moving between spots keeps cumulative dwell under threshold');
    def.cleanup();
  }

  console.log('[LANTERN WATCH — CLEAR-EYED bonus at full brightness]');
  {
    const { p, peek } = await mount(101);
    peek.press(peek.sch.answerIdx);
    const res = await p;
    check(shapeOK(res), 'StageResult canonical shape');
    check(res.correct === true && res.points === PAY3 + 20 && res.hpDelta === 0,
      `clean win pays ${PAY3}+20 CLEAR-EYED (got ${res.points})`);
    check(/CLEAR-EYED/.test(res.summary), `summary carries bonus ("${res.summary}")`);
  }

  console.log('[LANTERN WATCH — silhouettes/dim never block hit-testing]');
  {
    const { p, peek } = await mount(55);
    for (let k = 0; k < 12; k++) { fakeT += 200; peek.feed(30, 30, 'mouse'); }
    fakeT += 700; peek.feed(31, 30, 'mouse');
    check(peek.dimActive(), 'precondition: lantern dimmed');
    peek.press(peek.sch.answerIdx); /* answer while moth-blurred */
    const res = await p;
    check(res.correct === true && res.points === PAY3,
      `press while dimmed still resolves, but no +20 (got ${res.points})`);
    check(/MOTH-BLURRED/.test(res.summary), `summary explains withheld bonus ("${res.summary}")`);
  }

  console.log('[LANTERN WATCH — touch fallback: pinned centre, moths off, no bonus]');
  {
    const { p, peek } = await mount(9);
    peek.feed(50, 50, 'touch');
    check(peek.touch() === true, 'first touch pointer switches to fallback mode');
    for (let k = 0; k < 30; k++) { fakeT += 200; peek.feed(50, 50, 'touch'); }
    check(peek.phase() === 'idle' && !peek.dimActive(),
      'moth mechanic stays disabled however long touch dwells');
    peek.press(peek.sch.answerIdx);
    const res = await p;
    check(res.correct === true && res.points === PAY3,
      `touch win pays base only, CLEAR-EYED unavailable (got ${res.points})`);
  }

  console.log('[LANTERN WATCH — Esc/P pause freezes input]');
  {
    const { p, peek } = await mount(66);
    const kd = (handlers.keydown || []).slice(-1)[0];
    kd({ key: 'Escape' });
    check(peek.paused() === true, 'Escape pauses the stage');
    peek.press((peek.sch.answerIdx + 2) % 6);
    let settled = false; p.then(() => { settled = true; });
    await sleep(120);
    check(!settled, 'input ignored while paused');
    kd({ key: 'P' });
    check(peek.paused() === false, 'Shifted P resumes');
  }

  console.log('[LANTERN WATCH — wrong sigil result shape]');
  {
    const { p, peek } = await mount(13);
    peek.press((peek.sch.answerIdx + 1) % 6);
    const res = await p;
    check(res.correct === false && res.points === -40 && res.hpDelta === -12 && shapeOK(res),
      `wrong pick -> -40/-12 canonical shape (got ${res.points}/${res.hpDelta})`);
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL LANTERN WATCH SMOKES PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(1); });
