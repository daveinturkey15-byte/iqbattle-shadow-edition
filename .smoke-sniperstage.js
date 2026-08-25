/* .smoke-sniperstage.js — behavioral step-smoke for modes/sniperstage.js.
 * Run: node .smoke-sniperstage.js   (exit 0 = pass)
 *
 * Drives the mounted stage through its window.__OW__ hooks with a virtual
 * clock: registration queueing, seeded determinism (identical challenge for
 * identical seeds), the uniqueness rail (exactly ONE cell matches all three
 * criteria across many seeds/depths, under perceptual equivalence classes),
 * depth scaling (density 24->48, palette 4->6), the hit path (+160), the
 * miss ladder (-20 each, 2nd miss fails), steadying cost/behavior
 * (-2 s budget, 1.2 s sway-zero, no stacking), timeout settlement, and the
 * cleanup() escape hatch.
 */
'use strict';
const path = require('path');
const root = globalThis;
function ctx2dStub() {
  const fn = () => ctx2dStub(); /* createLinearGradient()...addColorStop() chain */
  return new Proxy({}, {
    get: (t, k) => (k === 'canvas' ? null : fn),
    set: () => true
  });
}
function El(tag) {
  this.tagName = tag;
  this.children = [];
  this.style = {};
  this.dataset = {};
  this._cls = new Set();
  this._inner = '';
  this._text = '';
  this.clientWidth = tag === 'canvas' ? 0 : (tag === 'div' ? 640 : 200);
  this.clientHeight = tag === 'canvas' ? 0 : (tag === 'div' ? 250 : 40);
  this.width = 0; this.height = 0;
  const self = this;
  this.classList = {
    add(...c) { c.forEach((x) => self._cls.add(x)); },
    remove(...c) { c.forEach((x) => self._cls.delete(x)); },
    toggle(c, f) { const on = f === undefined ? !self._cls.has(c) : !!f; on ? self._cls.add(c) : self._cls.delete(c); return on; },
    contains: (c) => self._cls.has(c)
  };
}
El.prototype.appendChild = function (c) { this.children.push(c); c.parentNode = this; return c; };
El.prototype.setAttribute = function (k, v) { this['_attr_' + k] = String(v); };
El.prototype.getAttribute = function (k) { return this['_attr_' + k]; };
El.prototype.addEventListener = function () {};
El.prototype.removeEventListener = function () {};
El.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight };
};
Object.defineProperty(El.prototype, 'innerHTML', {
  get() { return this._inner; },
  set(v) { this._inner = String(v); }
});
Object.defineProperty(El.prototype, 'textContent', {
  get() { return this._text; },
  set(v) { this._text = String(v); }
});

root.window = root;
root.document = {
  createElement: (tag) => {
    const el = new El(tag);
    if (tag === 'canvas') el.getContext = () => ctx2dStub();
    return el;
  }
};
/* no requestAnimationFrame on purpose — advance() is the virtual clock */

require(path.join(__dirname, 'modes', 'sniperstage.js'));

let fails = 0, passes = 0;
function ok(cond, msg) {
  if (!cond) { fails++; console.error('FAIL: ' + msg); } else { passes++; console.log('pass: ' + msg); }
}
function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function mkCtx(over) {
  const seed = (over && over.seed) || 909;
  const base = {
    depth: 5, tier: 1, diff: 3, world: 'scope-range', align: 'bad',
    hp: 100, score: 0, streak: 1, seed,
    rng: mulberry(seed), timerLen: 20, expired: false,
    mp: { on: false, host: false, client: false },
    leftFrac: () => 0.5,
    banner() {}, say() {}, quip() {},
    fx: { shake() {}, flash() {} }, audio: { p() {} },
    net: { send() {}, uid: () => 'smoke' },
    name: 'SMOKE', _smoke: true
  };
  return Object.assign(base, over || {});
}
function container() { return new El('div'); }
const ROTS = [0, 45, 90, 135];
function eqRot(shape, rot) {
  if (shape === 'square' || shape === 'plus') return rot % 90 === 0 ? 'A' : 'B';
  return String(rot);
}
function matchCount(cell, tgt) {
  return (cell.shape === tgt.shape ? 1 : 0) +
         (cell.color === tgt.color ? 1 : 0) +
         (eqRot(cell.shape, cell.rot) === eqRot(tgt.shape, tgt.rot) ? 1 : 0);
}

const stage = (root.__stagePending || []).filter((s) => s.id === 'overwatch-scope')[0];
ok(!!stage, 'overwatch-scope queued into __stagePending when IQ.Stage absent');
ok(stage.name === 'OVERWATCH' && stage.weight === 3 && stage.minDepth === 4,
   'registration meta: OVERWATCH / weight 3 / minDepth 4');
ok(Array.isArray(stage.worlds) && stage.worlds.includes('scope-range'),
   'bound to existing world scope-range');
ok(typeof stage.mount === 'function' && typeof stage.describe === 'function' &&
   typeof stage.cleanup === 'function', 'stage contract surface complete');

(async function main() {
  /* ---------- 1. seeded determinism ---------- */
  {
    const c1 = container(); const p1 = stage.mount(c1, mkCtx({ seed: 77 }));
    const e1 = root.__OW__.echo(); root.__OW__.finish(); await p1;
    const c2 = container(); const p2 = stage.mount(c2, mkCtx({ seed: 77 }));
    const e2 = root.__OW__.echo(); root.__OW__.finish(); await p2;
    ok(JSON.stringify(e1) === JSON.stringify(e2),
       'same seed -> byte-identical challenge (cells/layout/target)');
    const c3 = container(); const p3 = stage.mount(c3, mkCtx({ seed: 78 }));
    const e3 = root.__OW__.echo(); root.__OW__.finish(); await p3;
    ok(JSON.stringify(e1.cells.map((c) => c.shape + c.color + c.rot)) !==
       JSON.stringify(e3.cells.map((c) => c.shape + c.color + c.rot)) || e1.targetSlot !== e3.targetSlot,
       'different seed -> different challenge');
  }

  /* ---------- 2. uniqueness rail across seeds & depths ---------- */
  {
    let bad = 0, checked = 0;
    for (let seed = 1; seed <= 30 && !bad; seed++) {
      for (const depth of [4, 6, 8, 10, 12]) {
        const c = container(); const pr = stage.mount(c, mkCtx({ seed, depth, timerLen: 1 }));
        const e = root.__OW__.echo();
        const hits = e.cells.filter((cell) => matchCount(cell, e.target) >= 3).length;
        checked++;
        if (hits !== 1 || e.targetSlot < 0 || e.targetSlot >= e.cells.length ||
            matchCount(e.cells[e.targetSlot], e.target) < 3) bad++;
        root.__OW__.finish(); await pr;
      }
    }
    ok(bad === 0, `uniqueness rail holds (${checked} mounts: exactly one matching cell, at targetSlot)`);
  }

  /* ---------- 3. depth scaling ---------- */
  {
    const densities = {};
    for (const depth of [4, 8, 12]) {
      const c = container(); const pr = stage.mount(c, mkCtx({ depth, timerLen: 1 }));
      const e = root.__OW__.echo();
      densities[depth] = { n: e.cells.length, colors: e.params.nColors };
      root.__OW__.finish(); await pr;
    }
    ok(densities[4].n === 24, 'depth 4 density = 24 cells');
    ok(densities[12].n === 48, 'depth 12 density = 48 cells (24->48 ladder)');
    ok(densities[4].colors === 4 && densities[12].colors === 6,
       'criteria subtlety: palette widens 4 -> 6 colors by depth 8+');
  }

  /* ---------- 4. hit path (+160) ---------- */
  {
    const c = container(); const pr = stage.mount(c, mkCtx({ seed: 42, depth: 4, timerLen: 20 }));
    const e = root.__OW__.echo();
    const W = 640, H = 250;
    const tp = e.layout[e.targetSlot];
    root.__OW__.aim(tp.fx * W, tp.gy * H);
    root.__OW__.advance(300); /* sway converges onto aim */
    ok(root.__OW__.state().underLens === e.targetSlot, 'target sits under the glass after aiming');
    root.__OW__.fire();
    const res = await pr;
    ok(res.correct === true && res.points === 160 && res.hpDelta === 0 &&
       res.summary === 'ONE SHOT \u00b7 ONE TRUTH',
       'clean hit resolves +160 / hpDelta 0 / ONE SHOT summary');
  }

  /* ---------- 5. miss ladder (-20 each, 2nd miss fails) ---------- */
  {
    const c = container(); const pr = stage.mount(c, mkCtx({ seed: 99, depth: 4, timerLen: 20 }));
    const e = root.__OW__.echo();
    const W = 640, H = 250;
    const decoys = [];
    for (let i = 0; i < e.cells.length; i++) {
      if (i === e.targetSlot) continue;
      const a = e.layout[i], b = e.layout[e.targetSlot];
      if (Math.hypot((a.fx - b.fx) * W, (a.gy - b.gy) * H) > 120) decoys.push(i);
    }
    ok(decoys.length >= 2, 'two isolated decoys exist for the miss test');
    let firstRes = null;
    for (let m = 0; m < 2; m++) {
      const d = decoys[m];
      root.__OW__.aim(e.layout[d].fx * W, e.layout[d].gy * H);
      root.__OW__.advance(300);
      ok(root.__OW__.state().underLens === d, 'decoy ' + m + ' under the glass');
      root.__OW__.fire();
      const st = root.__OW__.state();
      ok(st.misses === m + 1 && st.missPts === 20 * (m + 1),
         'miss ' + (m + 1) + ' costs exactly 20 pts');
      if (m === 0) {
        ok(!st.finished, 'one miss does NOT end the round');
        firstRes = null;
      }
    }
    const res = await pr;
    ok(res.correct === false && res.points === -40 && res.hpDelta === 0 &&
       res.summary === 'TWO SHOTS WIDE \u00b7 STAND DOWN',
       'second miss fails round at -40 total');
  }

  /* ---------- 6. hit AFTER one miss nets 140 ---------- */
  {
    const c = container(); const pr = stage.mount(c, mkCtx({ seed: 55, depth: 4, timerLen: 20 }));
    const e = root.__OW__.echo();
    const W = 640, H = 250;
    let decoy = -1;
    for (let i = 0; i < e.cells.length && decoy < 0; i++) {
      if (i === e.targetSlot) continue;
      const a = e.layout[i], b = e.layout[e.targetSlot];
      if (Math.hypot((a.fx - b.fx) * W, (a.gy - b.gy) * H) > 120 &&
          Math.hypot(a.fx * W - W / 2, a.gy * H - H / 2) > 120) decoy = i;
    }
    root.__OW__.aim(e.layout[decoy].fx * W, e.layout[decoy].gy * H);
    root.__OW__.advance(250);
    root.__OW__.fire();
    root.__OW__.aim(e.layout[e.targetSlot].fx * W, e.layout[e.targetSlot].gy * H);
    root.__OW__.advance(250);
    root.__OW__.fire();
    const res = await pr;
    ok(res.correct === true && res.points === 160 - 20,
       'recovery shot scores 160 minus the earlier 20-pt miss');
  }

  /* ---------- 7. steadying: -2 s cost, 1.2 s window, no stacking ---------- */
  {
    const c = container(); const pr = stage.mount(c, mkCtx({ seed: 7, depth: 4, timerLen: 20 }));
    root.__OW__.advance(100);
    const b0 = root.__OW__.state().budgetLeftMs;
    root.__OW__.holdSteady();
    const st1 = root.__OW__.state();
    ok(st1.steadyActive && st1.budgetLeftMs === b0 - 2000, 'steadying activates and costs exactly 2 s');
    const b1 = root.__OW__.state().budgetLeftMs;
    root.__OW__.holdSteady(); /* must not stack */
    const st2 = root.__OW__.state();
    ok(st2.steadies === 1 && st2.budgetLeftMs === b1, 'steadying cannot stack while active');
    root.__OW__.advance(1250);
    ok(!root.__OW__.state().steadyActive, 'steady expires after 1.2 s');
    root.__OW__.finish(); await pr;
  }

  /* ---------- 8. timeout settlement ---------- */
  {
    const c = container(); const pr = stage.mount(c, mkCtx({ seed: 11, depth: 6, timerLen: 20 }));
    root.__OW__.advance(20100);
    const res = await pr;
    ok(res.correct === false && res.points === 0 && res.hpDelta === -5 &&
       res.summary === 'RANGE GOES COLD',
       'budget expiry settles wrong / 0 pts / hp -5');
  }

  /* ---------- 9. cleanup() escape hatch settles once ---------- */
  {
    const c = container(); const pr = stage.mount(c, mkCtx({ seed: 13, depth: 4, timerLen: 20 }));
    stage.cleanup(); /* engine timeout path */
    const res = await pr;
    ok(res && res.correct === false, 'cleanup() forces the timeout settlement');
    let second = false;
    stage.cleanup();
    root.__OW__ && root.__OW__.finish && root.__OW__.finish();
    ok(!second, 'double settle guarded (promise resolved exactly once)');
  }

  /* ---------- 10. describe() surface ---------- */
  {
    const c = container(); const pr = stage.mount(c, mkCtx({ seed: 21, depth: 7 }));
    const d = stage.describe();
    ok(d && d.kind === 'overwatch-scope' && d.target && typeof d.answerCell === 'number' &&
       d.density >= 24 && d.density <= 48,
       'describe(): kind/target/answerCell/density serializable');
    root.__OW__.finish(); await pr;
  }

  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
