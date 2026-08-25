#!/usr/bin/env node
/**
 * research/smoke-tidepool.js — headless smokes for modes/tidepool.js (TIDE POOL)
 * Browser-global stubs + direct stage driving; exits non-zero on any failure.
 *
 * Covers:
 *  - IQ.Stage absent at load -> def queues on window.__stagePending
 *  - SOLVABILITY RAIL over 500 seeds: mounted schedule's answer row is always
 *    in the rail-eligible set and analytically dry >=35% of each cycle
 *  - determinism: same seed -> byte-identical schedule (draw order stable);
 *    different seeds -> different schedules
 *  - submerged gating math: submergedAt matches an INDEPENDENT triangle-wave
 *    recomputation at 61 sample points across a full cycle
 *  - behaviour: dry correct pick wins (+DRY SHOES), submerged tap = splash
 *    (no resolution, no penalty, kills bonus), wrong dry pick = -40/-12,
 *    Esc pause freezes input + clock, StageResult canonical shape
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
require('../modes/tidepool.js');
const pending = global.window.__stagePending || [];
const def = pending.find(d => d.id === 'tidepool');

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
    depth: 5, tier: 2, diff: 3, world: null, align: 'neutral', hp: 80, score: 100, streak: 1,
    seed, rng: mulberry32(seed), mp: { on: false }, timerLen: 20, expired: false,
    audio: { p() {} }, fx: { shake() {}, flash() {}, glitch() {} }, banner() {}, say() {}
  };
}

let fakeT = 0;
async function mount(seed) {
  fakeT = 0;
  global.window.__TIDEPOOL_CLOCK__ = () => fakeT;
  const p = def.mount(container(), baseCtx(seed));
  return { p, peek: global.window.__TIDEPOOL__ };
}
function shapeOK(r) {
  return !!r && r.kind === 'score' && typeof r.correct === 'boolean' &&
    typeof r.points === 'number' && typeof r.summary === 'string' && r.summary.length <= 64 &&
    (r.hpDelta === undefined || typeof r.hpDelta === 'number');
}
/* independent triangle-wave recomputation (NOT the module's own fn) */
function refWater(sch, ms) {
  const x = (((ms / sch.period) + sch.phase) % 1 + 1) % 1;
  return (x < .5 ? x * 2 : 2 - 2 * x) * sch.max;
}

(async () => {
  console.log('[TIDE POOL — registration]');
  check(!!def, 'def queued on __stagePending with id tidepool');
  check(def.weight === 3 && def.minDepth === 3 && def.net === 'seed' && def.name === 'TIDE POOL',
    'registration shape: weight 3 / minDepth 3 / net seed / name TIDE POOL');

  console.log('[TIDE POOL — solvability rail over 500 seeds]');
  let railOK = 0, eligibleOK = 0;
  for (let s = 1; s <= 500; s++) {
    const { peek } = await mount(s);
    const sch = peek.sch;
    if (peek.dryFrac(sch.answerRow, sch.max) >= 0.35 - 1e-9) railOK++;
    if (sch.railRows.indexOf(sch.answerRow) !== -1) eligibleOK++;
    def.cleanup();
  }
  check(railOK === 500, `answer row dry >= 35% of cycle on all 500 seeds (got ${railOK}/500)`);
  check(eligibleOK === 500, `answer row drawn from rail-eligible rows on all 500 seeds (got ${eligibleOK}/500)`);

  console.log('[TIDE POOL — determinism]');
  let a, b;
  ({ peek: a } = await mount(777)); a = JSON.stringify(a.sch); def.cleanup();
  ({ peek: b } = await mount(777)); b = JSON.stringify(b.sch); def.cleanup();
  check(a === b, 'same seed -> byte-identical schedule');
  ({ peek: b } = await mount(778)); b = JSON.stringify(b.sch); def.cleanup();
  check(a !== b, 'different seed -> different schedule');

  console.log('[TIDE POOL — submerged gating math vs independent triangle wave]');
  {
    const { peek } = await mount(31);
    const sch = peek.sch;
    let allMatch = true;
    for (let row = 0; row < 5; row++) {
      for (let k = 0; k <= 60; k++) {
        const t = k * sch.period / 60;
        const wantRef = refWater(sch, t) > row + 0.5 + 0.05;
        if (peek.submergedAt(sch, row, t) !== wantRef) allMatch = false;
      }
    }
    check(allMatch, 'submergedAt(row,t) == water > row+0.55 across 5 rows x 61 samples');
    def.cleanup();
  }

  console.log('[TIDE POOL — behaviour: DRY SHOES win path]');
  {
    const { p, peek } = await mount(101);
    const sch = peek.sch;
    /* find a clock where the answer pool is dry */
    let tDry = -1;
    for (let t = 0; t < sch.period; t += 25) if (!peek.submergedAt(sch, sch.answerRow, t)) { tDry = t; break; }
    check(tDry >= 0, 'found a dry window for the answer pool');
    fakeT = tDry;
    const pay = [130, 200, 280, 370, 460][2]; /* diff 3 */
    peek.press(sch.answerIdx);
    const res = await p;
    check(shapeOK(res), 'StageResult canonical shape');
    check(res.correct === true && res.points === pay + 15 && res.hpDelta === 0,
      `clean win pays ${pay}+15 DRY SHOES (got ${res.points})`);
    check(/DRY SHOES/.test(res.summary), `summary carries the bonus tag ("${res.summary}")`);
  }

  console.log('[TIDE POOL — behaviour: splash costs bonus but no penalty]');
  {
    /* find a seed whose board has a pool that DOES submerge */
    let picked = null;
    for (let s = 1; s <= 60 && !picked; s++) {
      const { peek, p } = await mount(s);
      const sch = peek.sch;
      outer:
      for (let i = 0; i < 8; i++) {
        for (let t = 0; t < sch.period; t += 25) {
          if (i !== sch.answerIdx && peek.submergedAt(sch, sch.rows[i], t)) { picked = { s, i, t, peek, p, sch }; break outer; }
        }
      }
      if (!picked) def.cleanup();
    }
    check(!!picked, 'found a seed with a submerging distractor pool');
    const { s, i, t, peek, p, sch } = picked;
    fakeT = t;
    peek.press(i);                       /* submerged tap -> splash, no settle */
    check(peek.soggy() === true, 'submerged tap flags the board soggy');
    let settled = false; p.then(() => { settled = true; });
    await sleep(120);
    check(!settled, 'splash does NOT resolve the round (no penalty)');
    /* now wait for a dry window for the ANSWER pool and win soggy */
    let t2 = -1;
    for (let tt = 0; tt < sch.period * 2; tt += 25)
      if (!peek.submergedAt(sch, sch.answerRow, tt % sch.period) || tt >= sch.period) {
        if (!peek.submergedAt(sch, sch.rows[sch.answerIdx], tt)) { t2 = tt; break; }
      }
    fakeT = t2;
    const pay = 280;
    peek.press(sch.answerIdx);
    const res = await p;
    check(res.correct === true && res.points === pay, `soggy win drops the +15 (got ${res.points})`);
    check(!/DRY SHOES/.test(res.summary), `summary admits the splash ("${res.summary}")`);
  }

  console.log('[TIDE POOL — behaviour: wrong dry pick + Esc pause]');
  {
    const { p, peek } = await mount(55);
    const sch = peek.sch;
    const other = (sch.answerIdx + 3) % 8;
    /* pause via the real window keydown listener */
    const kd = (handlers.keydown || []).slice(-1)[0];
    kd({ key: 'Escape' });
    check(peek.paused() === true, 'Escape pauses the stage');
    peek.press(other);
    let settled = false; p.then(() => { settled = true; });
    await sleep(120);
    check(!settled, 'input ignored while paused');
    kd({ key: 'p' });
    check(peek.paused() === false, 'P resumes');
    peek.press(other);
    const res = await p;
    check(res.correct === false && res.points === -40 && res.hpDelta === -12,
      `wrong dry pick -> -40 pts / -12 hp (got ${res.points}/${res.hpDelta})`);
    check(shapeOK(res), 'failure result keeps canonical shape');
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL TIDE POOL SMOKES PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASH:', e); process.exit(1); });
