/* .smoke-redlight.js — behavioral harness for modes/mode-redlight.js.
 * Runs the REAL module in node behind a minimal DOM shim + virtual clock:
 *   1 registration shape (id/minDepth/net)
 *   2 phase construction: stage self-resolves inside timerLen at every config
 *   3 determinism: same seed -> byte-identical phases
 *   4 depth scaling: red exposure grows with depth
 *   5 win path: solving every green pays RL_PAY[ctx.diff] (takeover band table)
 *   6 move-during-red forces the wrong verdict (-40 pts / -12 hp)
 * Run: node .smoke-redlight.js   (exit 0 = pass)
 */
'use strict';
const path = require('path');

/* ---------- virtual clock ---------- */
let now = 0, seq = 0;
const timers = new Map();
global.setTimeout = (fn, ms) => { const id = ++seq; timers.set(id, { at: now + (ms || 0), fn }); return id; };
global.clearTimeout = id => { timers.delete(id); };
function advance(ms) {
  const until = now + ms;
  for (;;) {
    let best = null;
    for (const [id, t] of timers) if (t.at <= until && (!best || t.at < best.t.at)) best = { id, t };
    if (!best || best.t.at > until) break;
    now = Math.max(now, best.t.at);
    timers.delete(best.id);
    best.t.fn();
  }
  now = until;
}
global.requestAnimationFrame = fn => global.setTimeout(fn, 16);

/* ---------- DOM shim ---------- */
const listeners = {};
function makeEl(tag) {
  const el = {
    tag, children: [], style: {}, dataset: {},
    className: '', textContent: '',
    classList: { add() {}, remove() {}, toggle() {} },
    handlers: {}, onclick: null,
    appendChild(c) { this.children.push(c); return c; },
    removeEventListener() {}, addEventListener(type, fn) { this.handlers[type] = fn; },
    setAttribute() {}, getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600 }),
    querySelector(sel) {
      const find = n => {
        for (const c of n.children) {
          if (c.sel === sel) return c;
          const r = find(c); if (r) return r;
        }
        return null;
      };
      return find(this) || null;
    },
    querySelectorAll(sel) {
      const out = [];
      const walk = n => { for (const c of n.children) { if (c.sel === sel) out.push(c); walk(c); } };
      walk(this); return out;
    }
  };
  /* mimic the real DOM coarsely: class="x" in assigned markup becomes a
     findable child stub (module queries .rl-* handles off the root) */
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html || ''; },
    set(v) {
      this._html = v;
      this.children.length = 0;
      const re = /class="([^"]+)"/g; let m;
      while ((m = re.exec(String(v)))) {
        const c = makeEl('div');
        c.sel = '.' + m[1].split(/\s+/)[0];
        this.children.push(c);
      }
    }
  });
  return el;
}

global.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
global.removeEventListener = (type, fn) => { const a = listeners[type] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
global.document = {
  createElement: makeEl,
  head: makeEl('head'),
  getElementById: () => null,
  addEventListener() {}, removeEventListener() {}
};
global.window = globalThis;
try { global.navigator = {}; } catch (e) {} /* node >=21: getter-only navigator */

/* IQ.Stage capture */
const registered = [];
global.IQ = { Stage: { register: d => registered.push(d) } };

require(path.join(__dirname, 'modes', 'mode-redlight.js'));

function mulberry32(a){return function(){a|=0;a=(a+0x6D2B79F5)|0;var t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296}}

let failures = 0, passes = 0;
function ok(cond, msg) { if (cond) { passes++; console.log('pass: ' + msg); } else { failures++; console.error('FAIL: ' + msg); } }

/* live .rl-opts handle from the most recent mount (module shares this stub) */
function optsEl() { return lastRoot.querySelector('.rl-opts'); }
let lastRoot = null;
{
  const origMount = def.mount.bind(def);
  def.mount = (c, ctx) => { lastRoot = c; return origMount(c, ctx); };
}

(async () => {
const def = registered.find(d => d.id === 'redlight');
ok(def, 'stage registered');
ok(def && def.minDepth === 3 && def.net === 'seed', 'minDepth 3, net seed');
ok(def && typeof def.mount === 'function' && typeof def.cleanup === 'function', 'mount/cleanup present');

function mountCtx(over) {
  const seed = over.seed != null ? over.seed : 12345;
  return Object.assign({
    tier: 2, depth: 12, diff: 3, timerLen: 60,
    rng: mulberry32(seed), seed, mp: { on: false },
    audio: { p() {} }, fx: { shake() {}, flash() {} }
  }, over);
}
let lastOpts = null;

(async () => {
  /* 2+3: timing budget + determinism */
  for (const cfg of [{ tier: 0, depth: 3, timerLen: 20 }, { tier: 3, depth: 40, timerLen: 42 }, { tier: 1, depth: 7, timerLen: 30 }, { tier: 3, depth: 80, timerLen: 90 }]) {
    now = 0; timers.clear();
    def.mount(makeEl('div'), mountCtx(cfg));
    advance(700);
    const ph = global.__REDLIGHT__.phases();
    const total = 700 + ph.reduce((a, x) => a + x.greenMs + x.redMs, 0);
    ok(total <= cfg.timerLen * 1000, `phases fit timerLen ${cfg.timerLen}s (tier ${cfg.tier}, depth ${cfg.depth}): ${total}ms`);
    ok(ph.every(x => x.greenMs >= 2400 && x.redMs > 0), `windows sane at ${cfg.timerLen}s`);
    def.cleanup();
  }
  {
    now = 0; timers.clear();
    def.mount(makeEl('div'), mountCtx({ seed: 777 }));
    advance(700);
    const a = JSON.stringify(global.__REDLIGHT__.phases());
    def.cleanup(); timers.clear(); now = 0;
    def.mount(makeEl('div'), mountCtx({ seed: 777 }));
    advance(700);
    const b = JSON.stringify(global.__REDLIGHT__.phases());
    ok(a === b, 'same seed -> byte-identical phases');
    def.cleanup();
  }
  /* 4: depth scaling of red exposure */
  {
    now = 0; timers.clear();
    def.mount(makeEl('div'), mountCtx({ seed: 42, depth: 5 }));
    advance(700);
    const shallow = global.__REDLIGHT__.phases().reduce((a, x) => a + x.redMs, 0);
    def.cleanup(); timers.clear(); now = 0;
    def.mount(makeEl('div'), mountCtx({ seed: 42, depth: 30 }));
    advance(700);
    const deep = global.__REDLIGHT__.phases().reduce((a, x) => a + x.redMs, 0);
    def.cleanup();
    ok(deep > shallow, `red exposure scales with depth (${shallow} -> ${deep} ms)`);
  }

  /* 6: forceWrong — moving during red eliminates */
  {
    now = 0; timers.clear();
    const settle = def.mount(makeEl('div'), mountCtx({ seed: 9, diff: 4 }));
    advance(700);
    const RL = global.__REDLIGHT__;
    optsEl().children[RL.correctOpt()].onclick(); /* solve green -> red begins */
    for (const fn of listeners.pointermove || []) fn({ clientX: 500, clientY: 500 });
    for (const fn of listeners.pointermove || []) fn({ clientX: 900, clientY: 900 });
    advance(1000);
    const res = await settle;
    ok(res.correct === false && res.points === -40 && res.hpDelta === -12,
      'move during red forces wrong: -40 pts / -12 hp');
    ok(res.summary.length <= 64, 'summary within 64 chars');
  }

  /* 5: full clear at diff 5 -> pays RL_PAY[4]=470 */
  {
    now = 0; timers.clear();
    const settle = def.mount(makeEl('div'), mountCtx({ seed: 31337, diff: 5, tier: 3 }));
    advance(700);
    const RL = global.__REDLIGHT__;
    let guard = 20000, done = false;
    while (guard-- > 0) {
      const kids = optsEl().children.filter(c => typeof c.onclick === 'function');
      if (kids.length) kids[RL.correctOpt()].onclick(); /* idempotent: T.answered guards */
      advance(50);
      if (!timers.size) { done = true; break; }
    }
    ok(done, 'stage settled under stepped clock');
    const res = await settle;
    ok(res.correct === true && res.points === 470 && res.summary === 'CROSSED THE FIELD',
      'full clear at diff 5 pays 470 (band [324,729], cap 560)');
  }

  console.log('\nredlight: ' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

/* live .rl-opts handle from the most recent mount (module shares this stub) */
function optsEl() {
  return lastRoot.querySelector('.rl-opts');
}
let lastRoot = null;
{
  const origMount = def.mount.bind(def);
  def.mount = (c, ctx) => { lastRoot = c; return origMount(c, ctx); };
}
