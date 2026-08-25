/* .smoke-floorfall.js — behavioral step-smoke for modes/floorfall.js (W3).
 * Run: node .smoke-floorfall.js   (exit 0 = pass)
 *
 * Drives the mounted stage through its window.__FF__ step hooks with a
 * virtual clock: registration queueing, secret-host schedule rails (never
 * <3 standing, correct tile spared while >=3 wrong remain), surefooted
 * win, plunge folding, keyboard no-bonus, forced-pick fail, timeout,
 * client relay path, and seed determinism.
 *
 * Click semantics mirror the real surface: FF.commit(pos) requires the
 * synthetic cursor to STAND on that tile (FF.pointTo first); FF.key(n)
 * is the keyboard path. Base points use the mounted puzzle's own
 * difficulty (exposed under ctx._smoke) — the headless harness has no
 * gen_* families, so mounts resolve to the deterministic fallback
 * puzzle (difficulty 1).
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
  this.clientWidth = 640;
  this.clientHeight = tag === 'canvas' ? 250 : 240;
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

require(path.join(__dirname, 'modes', 'floorfall.js'));

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
  const seed = (over && over.seed) || 1234;
  const base = {
    depth: 6, tier: 1, diff: 3, world: 'volcano', align: 'bad',
    hp: 100, score: 0, streak: 2, seed,
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
function centerOf(rects, pos) { return { x: rects[pos].x + rects[pos].w / 2, y: rects[pos].y + rects[pos].h / 2 }; }

const stage = (root.__stagePending || []).filter((s) => s.id === 'floor-fall')[0];
ok(!!stage, 'floor-fall queued into __stagePending when IQ.Stage absent');
ok(typeof stage.mount === 'function' && typeof stage.frame === 'function' &&
   typeof stage.describe === 'function' && typeof stage.cleanup === 'function', 'stage contract surface complete');

(async function main() {
  /* ---- schedule rails across seeds ---- */
  for (const seed of [7, 99, 20260825]) {
    const ctx = mkCtx({ seed, _smoke: true });
    const p = stage.mount(container(), ctx);
    const st = root.window.__FF__.state();
    const beats = st.schedule || [];
    let standing = [0, 1, 2, 3, 4, 5, 6, 7];
    let railOK = true, spareOK = true;
    for (const b of beats) {
      const wrongBefore = standing.filter((x) => x !== st.answerPos).length;
      for (const v of b.v) {
        const after = standing.filter((x) => x !== v).length;
        if (after < 3) railOK = false;
        if (v === st.answerPos && wrongBefore >= 3) spareOK = false;
        standing = standing.filter((x) => x !== v);
      }
    }
    ok(railOK, 'seed ' + seed + ': solvability rail holds (never <3 surviving)');
    ok(spareOK, 'seed ' + seed + ': correct tile spared while >=3 wrong stand');
    ok(beats.length > 0, 'seed ' + seed + ': schedule non-empty (' + beats.length + ' beats)');
    root.window.__FF__.finish();
    await p.catch(() => {});
  }

  /* ---- determinism: same seed -> identical public schedule ---- */
  {
    const run = async () => {
      const ctx = mkCtx({ seed: 555, _smoke: true });
      const pr = stage.mount(container(), ctx);
      const sched = JSON.stringify(root.window.__FF__.state().schedule);
      root.window.__FF__.finish();
      await pr.catch(() => {});
      return sched;
    };
    ok((await run()) === (await run()), 'same seed -> byte-identical fall schedule');
  }

  const BASE = (diff) => Math.round(100 * diff + 0.5 * 80); /* leftFrac fixed at 0.5 */

  /* ---- surefooted win: click the correct tile while standing on it ---- */
  {
    const ctx = mkCtx({ _smoke: true });
    const p = stage.mount(container(), ctx);
    const FF = root.window.__FF__;
    const s0 = FF.state();
    const secondDrop = s0.schedule.length > 1 ? s0.schedule[1].dropAt : s0.schedule[0].dropAt;
    FF.advance(0); /* arm the round clock (first tick defines t0) */
    FF.advance(secondDrop + 60);
    const live = FF.state();
    ok(live.dropped >= 2, 'two falls landed before the pick (dropped=' + live.dropped + ')');
    ok(live.plunges === 0, 'no plunge with cursor parked off-grid');
    const c = centerOf(live.rects, s0.answerPos);
    FF.pointTo(c.x, c.y);
    FF.commit(s0.answerPos);
    const res = await p;
    ok(res.correct === true, 'surefooted: correct=true');
    ok(res.points === BASE(s0.difficulty) + 25, 'surefooted: base+25 applied (points=' + res.points + ')');
    ok(res.summary === 'SUREFOOTED \u00B7 FLOOR CLEARED', 'surefooted summary');
    ok(res.hpDelta === 0, 'surefooted hpDelta 0 (got ' + res.hpDelta + ')');
    ok(res.kind === 'score', 'result kind score');
  }

  /* ---- plunge folds into timeout settlement ---- */
  {
    const ctx = mkCtx({ _smoke: true });
    const p = stage.mount(container(), ctx);
    const FF = root.window.__FF__;
    const s0 = FF.state();
    const victim = s0.schedule[0].v[0];
    const c = centerOf(s0.rects, victim);
    FF.pointTo(c.x, c.y);
    FF.advance(0); /* arm clock */
    FF.advance(s0.schedule[0].dropAt + 60);
    const live = FF.state();
    ok(live.plunges === 1 && live.dmg === 12, 'standing on a falling tile = plunge (-12)');
    FF.pointTo(-999, -999); /* leave the floor */
    FF.advance(21000);
    const res = await p;
    ok(res.correct === null, 'timeout -> neutral resolution');
    ok(res.hpDelta === -(5 + 12), 'timeout folds timeout -5 + plunge -12 (got ' + res.hpDelta + ')');
    ok(res.summary === 'BURIED WITH THE TILES', 'timeout summary');
  }

  /* ---- keyboard pick: correct but never bonus-eligible ---- */
  {
    const ctx = mkCtx({ _smoke: true });
    const p = stage.mount(container(), ctx);
    const FF = root.window.__FF__;
    const s0 = FF.state();
    const s = s0.schedule;
    FF.advance(0);
    FF.advance((s.length > 1 ? s[1].dropAt : s[0].dropAt) + 60);
    FF.key(s0.answerPos + 1); /* keys 1-8 are 1-based over display positions */
    const res = await p;
    ok(res.correct === true && res.points === BASE(s0.difficulty), 'keyboard correct pick gets NO surefooted bonus (points=' + res.points + ')');
    ok(res.summary === 'FLOOR CLEARED', 'plain clear summary');
  }

  /* ---- wrong pick while standing on a wrong tile ---- */
  {
    const ctx = mkCtx({ _smoke: true });
    const p = stage.mount(container(), ctx);
    const FF = root.window.__FF__;
    const s0 = FF.state();
    const wrongPos = (s0.answerPos + 1) % 8;
    const c = centerOf(s0.rects, wrongPos);
    FF.pointTo(c.x, c.y);
    FF.commit(wrongPos);
    const res = await p;
    ok(res.correct === false && res.points === 0, 'wrong pick -> fail, 0 points');
    ok(res.summary === 'THE FLOOR TOOK YOU', 'fail summary (got "' + res.summary + '")');
  }

  /* ---- client relay path ---- */
  {
    const sent = [];
    const opts = Array.from({ length: 8 }, (_, i) => ({ cols: 1, rows: 1, cells: [{ shape: 'plus', color: i, rot: 0 }] }));
    const frame = { kind: 'matrix', options: opts, ord: [3, 1, 7, 0, 5, 2, 6, 4], diff: 2, falls: [{ t: 1000, d: 1600, v: [2] }] };
    const ctx = mkCtx({
      mp: { on: true, host: false, client: true },
      net: { send: (f) => sent.push(f), uid: () => 'u1' },
      frame
    });
    const p = stage.mount(container(), ctx);
    const FF = root.window.__FF__;
    FF.advance(0);
    FF.advance(1800);
    ok(FF.state().dropped === 1, 'client replays host fall schedule');
    const s0 = FF.state();
    const c = centerOf(s0.rects, 0);
    FF.pointTo(c.x, c.y);
    FF.commit(0);
    const res = await p;
    ok(sent.length === 1 && sent[0].t === 'pick' && sent[0].pos === 0, 'client relays pick frame');
    ok(res.relay === false && res.correct === false, 'client resolves relay:false placeholder (host reveal scores)');
    ok(!('answer' in frame), 'frame never ships an answer field');
  }

  /* ---- engine serializers ---- */
  {
    const ctx = mkCtx({ _smoke: true });
    const p = stage.mount(container(), ctx);
    const fr = stage.frame();
    ok(fr && fr.options && fr.ord && Array.isArray(fr.falls) && !('answer' in fr), 'frame(): public payload, answer withheld');
    const d = stage.describe();
    ok(d && Number.isInteger(d.answer) && d.kind === 'floor-fall', 'describe(): host-only answer surface');
    stage.cleanup(); /* post-resolve cleanup must be a no-op */
    root.window.__FF__.finish();
    await p.catch(() => {});
  }

  console.log('\nfloorfall smoke: ' + passes + ' pass, ' + fails + ' fail');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
