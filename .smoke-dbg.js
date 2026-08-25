/* .smoke-redlight.js — behavioral harness for modes/mode-redlight.js.
 * Runs the REAL module in node behind a minimal DOM shim + virtual clock:
 *   1 registration shape (id/minDepth/net)
 *   2 phase construction: stage self-resolves inside timerLen at every config
 *   3 determinism: same seed -> byte-identical phases
 *   4 depth scaling: red exposure grows with depth
 *   5 win path: solving every green pays RL_PAY[ctx.diff] (takeover band table)
 *   6 move-during-red forces the wrong verdict (-40 pts / -12 hp) — forceWrong
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
function makeEl(tag) {
  const el = {
    tag, children: [], style: {}, dataset: {},
    className: '', innerHTML: '', textContent: '',
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
      return find(this) || makeEl('div');
    },
    querySelectorAll(sel) {
      const out = [];
      const walk = n => { for (const c of n.children) { if (c.sel === sel) out.push(c); walk(c); } };
      walk(this); return out;
    }
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html || ''; },
    set(v) {
      this._html = v;
      if (v.indexOf('rl-seq') >= 0 || v === '') this.children.length = 0;
      /* option chips are appended via appendChild after opts.innerHTML='' */
    }
  });
  if (tag === 'div') el.sel = null;
  return el;
}
/* mark queried handles so querySelector can find them like the real DOM does */

const listeners = {};
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

require(path.join(__dirname, '.rl-dbg.js'));

function mulberry32(a){return function(){a|=0;a=(a+0x6D2B79F5)|0;var t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296}}

let failures = 0, passes = 0;
function ok(cond, msg) { if (cond) { passes++; console.log('pass: ' + msg); } else { failures++; console.error('FAIL: ' + msg); } }

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

async function testTiming() {
  for (const cfg of [{ tier: 0, depth: 3, timerLen: 20 }, { tier: 3, depth: 40, timerLen: 42 }, { tier: 1, depth: 7, timerLen: 30 }, { tier: 3, depth: 80, timerLen: 90 }]) {
    now = 0; timers.clear();
    const container = makeEl('div');
    const p = def.mount(container, mountCtx(cfg));
    const RL = global.__REDLIGHT__;
    advance(700); /* start delay then runPhase */
    const ph = RL.phases();
    const total = 700 + ph.reduce((a, x) => a + x.greenMs + x.redMs, 0);
    ok(total <= cfg.timerLen * 1000, `phases fit timerLen ${cfg.timerLen}s (tier ${cfg.tier}, depth ${cfg.depth}): ${total}ms`);
    ok(ph.every(x => x.greenMs >= 2400 && x.redMs > 0), `windows sane at ${cfg.timerLen}s`);
    def.cleanup();
    await p.catch(() => {});
  }
}

(async () => {
  await testTiming();

  /* determinism */
  {
    now = 0; timers.clear();
    const p1 = def.mount(makeEl('div'), mountCtx({ seed: 777 }));
    advance(700);
    const a = JSON.stringify(global.__REDLIGHT__.phases());
    def.cleanup(); timers.clear(); now = 0;
    const p2 = def.mount(makeEl('div'), mountCtx({ seed: 777 }));
    advance(700);
    const b = JSON.stringify(global.__REDLIGHT__.phases());
    def.cleanup();
    await Promise.all([p1.catch(() => {}), p2.catch(() => {})]);
    ok(a === b, 'same seed -> byte-identical phases');
  }

  /* depth scaling of red exposure */
  {
    now = 0; timers.clear();
    let p = def.mount(makeEl('div'), mountCtx({ seed: 42, depth: 5 }));
    advance(700);
    const shallow = global.__REDLIGHT__.phases().reduce((a, x) => a + x.redMs, 0);
    def.cleanup(); timers.clear(); now = 0;
    p = def.mount(makeEl('div'), mountCtx({ seed: 42, depth: 30 }));
    advance(700);
    const deep = global.__REDLIGHT__.phases().reduce((a, x) => a + x.redMs, 0);
    def.cleanup();
    await p.catch(() => {});
    ok(deep > shallow, `red exposure scales with depth (${shallow} -> ${deep} ms)`);
  }

  /* forceWrong: moving during red eliminates (-40 / -12) */
  {
    now = 0; timers.clear();
    const settle = def.mount(makeEl('div'), mountCtx({ seed: 9, diff: 4 }));
    advance(700);
    const RL = global.__REDLIGHT__;
    /* solve the first green pattern */
    const optIdx = RL.correctOpt();
    const opts = T_optsChildren();
    ok(opts.length === 4, 'four pattern options rendered');
    opts[optIdx].onclick();
    ok(RL.phase() === 0, 'correct pick holds the phase (red begins)');
    /* twitch on red */
    for (const fn of listeners.pointermove || []) fn({ clientX: 500, clientY: 500 });
    for (const fn of listeners.pointermove || []) fn({ clientX: 900, clientY: 900 });
    advance(1000);
    const res = await settle;
    ok(res.correct === false && res.points === -40 && res.hpDelta === -12,
      'move during red forces wrong: -40 pts / -12 hp');
    ok(res.summary.length <= 64, 'summary within 64 chars');
  }

  /* full clear: every green solved -> pays RL_PAY[diff-1] */
  {
    now = 0; timers.clear();
    const ctx = mountCtx({ seed: 31337, diff: 5, tier: 3 });
    const settle = def.mount(makeEl('div'), ctx);
    advance(700);
    const RL = global.__REDLIGHT__;
    let guard = 50;
    while (guard-- > 0) {
      const opts = T_optsChildren();
      if (opts.length) { opts[RL.correctOpt()].onclick(); }
      const before = now;
      advance(120000); /* run the clock dry: greens expire or reds advance */
      if (timers.size === 0) break;
      if (now === before) break;
    }
    const res = await settle;
    ok(res.correct === true && res.points === 470 && res.summary === 'CROSSED THE FIELD',
      'full clear at diff 5 pays 470 (in band [324,729], under cap 560)');
  }

  console.log('\nredlight: ' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

/* helper: grab current option buttons (children of .rl-opts handle) */
function T_optsChildren() {
  /* the module keeps T.opts; its stub children are the option divs */
  const root = lastContainer;
  const opts = root && root.querySelector('.rl-opts');
  return (opts ? opts.children : []).filter(c => typeof c.onclick === 'function');
}
let lastContainer = null;
{ /* wrap mount to track the live container */
  const origMount = def.mount.bind(def);
  def.mount = (c, ctx) => { lastContainer = c; /* register rl-* handles as findable */ wireHandles(c); return origMount(c, ctx); };
}
function wireHandles(container) {
  /* pre-seed the container's child tree with the handles the module queries:
     the real DOM builds them from innerHTML; our shim exposes them directly. */
  const mk = sel => { const e = makeEl('div'); e.sel = sel; container.children.push(e); return e; };
  mk('.rl-field'); mk('.rl-dollwrap'); mk('.rl-state'); mk('.rl-prompt');
  mk('.rl-opts'); mk('.rl-progress'); mk('.rl-count');
}
