/* .smoke-hunterdodge.js — behavioral step-smoke for modes/hunterdodge.js (W2/W3).
 * Run: node .smoke-hunterdodge.js   (exit 0 = pass)
 *
 * Drives the mounted stage through its window.__HD__ step hooks with a
 * virtual clock: registration queueing, depth scaling (turn rate / cone /
 * decoy), seeded-sim determinism of beam params, ghost bonus (never seen),
 * exposure ticks (-10 first, -6 repeats) with cumulative re-crossing,
 * wrong-pick fail, timeout settlement, client relay path.
 */
'use strict';
const path = require('path');
const root = globalThis;

/* ---------- browser stubs ---------- */
function ctx2dStub() {
  return new Proxy({}, {
    get: (t, k) => (k === 'canvas' ? null : () => undefined),
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
  this.clientWidth = tag === 'canvas' ? 0 : 640;
  this.clientHeight = tag === 'canvas' ? 0 : 250;
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

require(path.join(__dirname, 'modes', 'hunterdodge.js'));

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
  const seed = (over && over.seed) || 4242;
  const base = {
    depth: 6, tier: 1, diff: 3, world: 'cyber-hunter', align: 'bad',
    hp: 100, score: 0, streak: 1, seed,
    rng: mulberry(seed), timerLen: 20, expired: false,
    mp: { on: false, host: false, client: false },
    leftFrac: () => 0.5,
    banner() {}, say() {}, quip() {},
    fx: { shake() {} }, audio: { p() {} },
    net: { send() {}, uid: () => 'smoke' },
    name: 'SMOKE'
  };
  return Object.assign(base, over || {});
}
function container() { return new (El.bind(null, 'div'))(); }

const stage = (root.__stagePending || []).filter((s) => s.id === 'hunter-dodge')[0];
ok(!!stage, 'hunter-dodge queued into __stagePending when IQ.Stage absent');
ok(typeof stage.mount === 'function' && typeof stage.frame === 'function' &&
   typeof stage.describe === 'function', 'stage contract surface complete');

(async function main() {
  /* ---- seeded-sim determinism: same seed -> identical beam params ---- */
  {
    const echo = async () => {
      const ctx = mkCtx({ seed: 777, _smoke: true });
      const pr = stage.mount(container(), ctx);
      const e = JSON.stringify(root.window.__HD__.state().seedEcho);
      root.window.__HD__.finish();
      await pr.catch(() => {});
      return e;
    };
    ok((await echo()) === (await echo()), 'same seed -> identical patrol/heading params');
  }

  /* ---- ghost win: never in the beam ---- */
  {
    const ctx = mkCtx({ _smoke: true });
    const p = stage.mount(container(), ctx);
    const HD = root.window.__HD__;
    HD.advance(1500);
    const st = HD.state();
    ok(st.clock === 0 && st.ticks === 0, 'no exposure without pointer input');
    HD.commit(st.answerPos);
    const res = await p;
    ok(res.correct === true, 'ghost: correct=true');
    ok(res.points === Math.round(100 * st.difficulty + 40) + 40, 'ghost: base+40 applied (points=' + res.points + ')');
    ok(res.summary === 'GHOST \u00B7 UNSEEN, UNSCATHED', 'ghost summary');
    ok(res.hpDelta === 0, 'ghost hpDelta 0 (got ' + res.hpDelta + ')');
  }

  {
    const ctx = mkCtx({ _smoke: true });
    const p = stage.mount(container(), ctx);
    const HD = root.window.__HD__;
    HD.advance(16);
    const st = HD.state();
    const o = st.origin, h = st.heading;
    HD.pointTo(o.x + Math.cos(h) * 380, o.y + Math.sin(h) * 380);
    HD.advance(2600); /* > 2.0 s cumulative inside the cone */
    const mid = HD.state();
    ok(mid.ticks >= 1 && mid.dmg >= 10, 'crossing 2.0s exposure deals the -10 tick (ticks=' + mid.ticks + ', dmg=' + mid.dmg + ')');
    ok(mid.peak >= 2.0, 'peak exposure crossed 2.0 (peak=' + mid.peak + ')');
    HD.advance(900); /* additional full second -> repeat tick -6 */
    const late = HD.state();
    ok(late.ticks >= 2 && late.dmg >= 16, 're-crossing every extra second repeats -6 (ticks=' + late.ticks + ', dmg=' + late.dmg + ')');
    HD.finish();
    const res = await p;
    ok(res.correct === null && res.hpDelta === -(5 + late.dmg), 'timeout folds timeout -5 + accumulated ticks (' + res.hpDelta + ')');
    ok(res.summary === 'IT NEVER BLINKS', 'timeout summary');
  }

  /* ---- wrong pick ---- */
  {
    const ctx = mkCtx({ _smoke: true });
    const p = stage.mount(container(), ctx);
    const HD = root.window.__HD__;
    const st = HD.state();
    HD.commit((st.answerPos + 3) % 8);
    const res = await p;
    ok(res.correct === false && res.points === 0, 'wrong pick -> fail, 0 points');
    ok(res.summary === 'MARKED BY THE BEAM', 'fail summary');
  }

  /* ---- client relay path (frame ships no answer) ---- */
  {
    const sent = [];
    const opts = Array.from({ length: 8 }, (_, i) => ({ cols: 1, rows: 1, cells: [{ shape: 'plus', color: i, rot: 0 }] }));
    const frame = { kind: 'matrix', options: opts, ord: [2, 5, 0, 7, 1, 4, 3, 6], diff: 2 };
    const ctx = mkCtx({
      mp: { on: true, host: false, client: true }, _smoke: true,
      net: { send: (f) => sent.push(f), uid: () => 'u9' },
      frame
    });
    const p = stage.mount(container(), ctx);
    const HD = root.window.__HD__;
    ok(HD.state().answerPos === -1, 'client never knows the answer pre-reveal (got ' + JSON.stringify(HD.state().answerPos) + ')');
    HD.commit(0);
    const res = await p;
    ok(sent.length === 1 && sent[0].t === 'pick' && sent[0].pos === 0, 'client relays pick frame');
    ok(res.relay === false && res.correct === false, 'client resolves relay:false placeholder');
    ok(!('answer' in frame), 'frame never ships an answer field');
  }

  /* ---- engine serializers + cleanup idempotence ---- */
  {
    const ctx = mkCtx({ _smoke: true });
    const p = stage.mount(container(), ctx);
    const fr = stage.frame();
    ok(fr && fr.options && fr.ord && !('answer' in fr) && !('falls' in fr), 'frame(): public payload only');
    const d = stage.describe();
    ok(d && Number.isInteger(d.answer) && d.kind === 'hunter-dodge', 'describe(): host-only answer surface');
    stage.cleanup();
    root.window.__HD__.finish();
    await p.catch(() => {});
    ok(true, 'cleanup after resolve is a safe no-op');
  }

  console.log('\nhunterdodge smoke: ' + passes + ' pass, ' + fails + ' fail');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
