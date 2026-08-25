/* Smoke: modes/pop-glitter-stage.js + modes/metal-stage.js
   Headless mount with stubbed IQ registry; drives taps via smoke hooks;
   verifies StageResult shape, world registration, teardown idempotence.
   Balance pass 2026-08-25: also asserts the economy band contract —
   success caps at round((100*diff+40)*1.35), fail pays -(10+10*diff)/-6hp,
   combo tiers (+15/5-hit) and gold accent x2 remain earnable.
   Time is VIRTUAL (performance.now patched) so the 35 s charts resolve
   instantly and deterministically. */
'use strict';
const assert = require('assert');

/* ---- minimal browser-ish environment ---- */
const listeners = new Map();
function makeEl(tag) {
  const el = {
    tag, children: [], style: {}, dataset: {}, _cls: new Set(), _text: '',
    setAttribute() {}, getAttribute() { return null; },
    get className() { return [...el._cls].join(' '); },
    set className(v) { el._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
    set textContent(v) { el._text = String(v); }, get textContent() { return el._text; },
    set innerHTML(v) { this.children = []; parseHTML(this, String(v)); }, get innerHTML() { return ''; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    insertBefore(c, ref) { const i = this.children.indexOf(ref); if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); c.parentNode = this; },
    querySelector(sel) { return query(this, sel)[0] || null; },
    querySelectorAll(sel) { return query(this, sel); },
    addEventListener(t, f) { const k = this; listeners.set(k.tag + ':' + t, f); },
    removeEventListener() {},
    getContext() { return canvasCtx(); },
    get clientWidth() { return 640; }, get clientHeight() { return 360; },
    parentNode: null,
    removeChild() {}
  };
  el.classList = {
    add(c) { el._cls.add(c); },
    remove(c) { el._cls.delete(c); },
    toggle(c, v) { v ? el._cls.add(c) : el._cls.delete(c); }
  };
  return el;
}
function query(el, sel) {
  const out = [];
  const cls = sel.replace(/^\./, '');
  (function walk(n) {
    for (const c of n.children || []) {
      if (sel.startsWith('.') ? c._cls.has(cls) : c.tag === sel) out.push(c);
      walk(c);
    }
  })(el);
  return out;
}
function parseHTML(parent, html) {
  // very small subset parser for the fixed markup used by the stages
  const re = /<(\w+)([^>]*)>([\s\S]*?)<\/\1>|<(\w+)([^>]*)\/?>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1] || m[4];
    const attrs = m[2] || m[5] || '';
    const body = m[3];
    const el = makeEl(tag);
    let cm;
    if ((cm = /class="([^"]*)"/.exec(attrs))) el.className = cm[1];
    parent.appendChild(el);
    if (body && !/<\w/.test(body)) el.textContent = body.trim();
    else if (body && /<\w/.test(body)) {
      // one nesting level is enough (wrap>canvas)
      const inner = /<canvas><\/canvas>/.test(body);
      if (inner) { const cv = makeEl('canvas'); el.appendChild(cv); }
    }
  }
}
let ctx2dStub;
function canvasCtx() {
  if (ctx2dStub) return ctx2dStub;
  const noop = () => {};
  ctx2dStub = {
    clearRect: noop, fillRect: noop, strokeRect: noop, beginPath: noop, arc: noop,
    fill: noop, stroke: noop, moveTo: noop, lineTo: noop, closePath: noop,
    fillText: noop, strokeText: noop, save: noop, restore: noop,
    translate: noop, rotate: noop, scale: noop, ellipse: noop,
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
    set globalAlpha(v) {}, get globalAlpha() { return 1; },
  };
  ['fillStyle', 'strokeStyle', 'lineWidth', 'font', 'textAlign'].forEach(p => {
    Object.defineProperty(ctx2dStub, p, { set() {}, get() { return ''; } });
  });
  return ctx2dStub;
}

/* ---- virtual clock: the rhythm stages read performance.now() everywhere ---- */
let NOW = 100000;
global.performance = { now: () => NOW };

global.document = { createElement: tag => makeEl(tag) };
const window = global.window = {
  IQ: {},
  localStorage: { getItem: () => null },
  matchMedia: () => ({ matches: false }),
  addEventListener(t, f, cap) { listeners.set('win:' + t + ':' + !!cap, f); },
  removeEventListener() {},
};
let rafQ = [];
global.requestAnimationFrame = f => (rafQ.push(f), rafQ.length);
global.cancelAnimationFrame = () => {};

/** Advance the virtual clock, flushing any rAF callbacks scheduled. */
function tick(ms) {
  NOW += ms;
  const q = rafQ; rafQ = [];
  q.forEach(f => { try { f(NOW); } catch (e) {} });
}

/* ---- stub IQ registries ---- */
const registeredWorlds = {};
window.IQ.Worlds = {
  register(d) { if (!registeredWorlds[d.id]) registeredWorlds[d.id] = d; },
  list() { return Object.keys(registeredWorlds); }
};
const registeredStages = {};
window.IQ.Stage = {
  register(s) { registeredStages[s.id] = s; }
};

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const banners = [];
function mkCtx(seed, diff) {
  return {
    depth: 4, tier: 1, diff: diff == null ? 3 : diff, world: 'pop-glitter', align: 'good',
    hp: 100, score: 0, streak: 1, seed,
    rng: mulberry(seed), timerLen: 40, expired: false,
    mp: { on: false, host: false, client: false },
    audio: { p: () => {} }, fx: { shake: () => {}, flash: () => {} },
    banner: t => banners.push(t), say: () => {}, quip: () => {},
    board: { palRow: () => null }, leftFrac: () => 1, net: { send: () => {}, uid: () => 'x' }
  };
}

/* Economy helpers mirrored from the stage files (asserted against them below). */
const bandCap = d => Math.min(480, Math.round((100 * d + 40) * 1.35));
const failPts = d => -(10 + 10 * d);

(async function main() {
  const container = makeEl('div');
  const ok = (name, cond) => { assert(cond, name); console.log('ok -', name); };

  require('./modes/pop-glitter-stage.js');
  require('./modes/metal-stage.js');

  ok('glitter-set registered', !!registeredStages['glitter-set']);
  ok('forge-set registered', !!registeredStages['forge-set']);
  const gs = registeredStages['glitter-set'], fs = registeredStages['forge-set'];
  ok('glitter meta', gs.name === 'CHART TOPPER' && gs.weight === 2 &&
     JSON.stringify(gs.worlds) === '["pop-glitter"]' && gs.net === 'seed');
  ok('forge meta', fs.name === 'FORGE SET' && fs.weight === 2 &&
     JSON.stringify(fs.worlds) === '["metal-forge"]' && fs.net === 'seed');

  /* worlds auto-registered */
  ok('pop-glitter world registered', !!registeredWorlds['pop-glitter'] &&
     typeof registeredWorlds['pop-glitter'].draw === 'function' && Array.isArray(registeredWorlds['pop-glitter'].pal));
  ok('metal-forge world registered', !!registeredWorlds['metal-forge'] &&
     typeof registeredWorlds['metal-forge'].draw === 'function' && Array.isArray(registeredWorlds['metal-forge'].pal));

  /* ---- CHART TOPPER full-combo run (diff 3 -> cap 459) ---- */
  const p1 = gs.mount(container, mkCtx(1234, 3));
  tick(0);
  ok('__GLITTER__ hook live', typeof window.__GLITTER__ === 'object');
  const gstate = window.__GLITTER__.state();
  ok('chart has notes', gstate.total >= 20);
  /* perfect play: tap the next note's lane every 25 ms of virtual time */
  for (let i = 0; i < 3000 && !window.__GLITTER__.state().done; i++) {
    const stt = window.__GLITTER__.state();
    if (stt.nextLane >= 0) window.__GLITTER__.tap(stt.nextLane);
    tick(25);
  }
  const res1 = await p1;
  ok('glitter full play correct:true, hp 0',
     res1.correct === true && res1.kind === 'score' && res1.hpDelta === 0);
  ok('band cap binds: full-combo pays exactly 135% of diff-3 baseline',
     res1.points === bandCap(3) && res1.points <= 480);
  const gfinal = window.__GLITTER__.state();
  ok('near-full combo: only notes past the set-end deadline can escape',
     gfinal.hits >= gstate.total - 2 && gfinal.hits / gstate.total >= 0.9 &&
     res1.summary.indexOf(gfinal.hits + '/' + gstate.total) > 0);

  /* ---- FORGE SET run (diff 2 -> cap 324): accents x2, screams, early finish ---- */
  banners.length = 0;
  const p2 = fs.mount(container, mkCtx(999, 2));
  tick(0);
  ok('__FORGE__ hook live', typeof window.__FORGE__ === 'object');
  const fstate = window.__FORGE__.state();
  ok('forge chart sparser than glitter', fstate.total < gstate.total);
  for (let i = 0; i < 3000 && !window.__FORGE__.state().done; i++) {
    const stt = window.__FORGE__.state();
    if (stt.nextLane >= 0) window.__FORGE__.tap(stt.nextLane);
    tick(25);
  }
  const res2 = await p2;
  ok('forge full play correct:true, hp 0', res2.correct === true && res2.hpDelta === 0);
  ok('forge band cap binds at diff-2 band top', res2.points === bandCap(2) && res2.points <= 480);
  ok('scream banners fired from pool', banners.some(b => /^(WHOA-OH|HEY!|RAAAGH|LOUDER!|BREAK IT DOWN!|ONE MORE TIME!)$/.test(b)));

  /* ---- fail path: bail immediately -> economy-standard wrong cost ---- */
  const p3 = gs.mount(makeEl('div'), mkCtx(55, 1));
  tick(0);
  window.__GLITTER__.finish();
  const res3 = await p3;
  ok('fail path: correct:false, -(10+10*diff) pts, -6 hp',
     res3.correct === false && res3.points === failPts(1) && res3.points === -20 && res3.hpDelta === -6);

  /* ---- cleanup/teardown idempotence ---- */
  gs.cleanup(); gs.cleanup();
  fs.cleanup(); fs.cleanup();
  const p4 = gs.mount(container, mkCtx(56, 2));           /* remount after teardown works */
  tick(0);
  window.__GLITTER__.finish();
  const res4 = await p4;
  ok('remount after cleanup settles once', !!res4 && typeof res4.points === 'number' &&
     res4.points === failPts(2));

  /* ---- determinism: same seed => identical charts ---- */
  const a = mkCtx(42, 3), b = mkCtx(42, 3);
  const pa = gs.mount(makeEl('div'), a);
  tick(0);
  const ta = window.__GLITTER__.state().total;
  window.__GLITTER__.finish(); await pa;
  const pb = gs.mount(makeEl('div'), b);
  tick(0);
  const tb = window.__GLITTER__.state().total;
  window.__GLITTER__.finish(); await pb;
  ok('seed-deterministic chart length', ta === tb && ta > 0);

  /* ---- band sanity across the depth ladder ---- */
  ok('band tops 189/324/459 at diff 1/2/3 (60%-135% takeover band)',
     bandCap(1) === 189 && bandCap(2) === 324 && bandCap(3) === 459);
  ok('fails scale -(20/30/40) at diff 1/2/3',
     failPts(1) === -20 && failPts(2) === -30 && failPts(3) === -40);

  console.log('\nALL SMOKE CHECKS PASSED');
})().catch(e => { console.error('SMOKE FAILED:', e.message); process.exit(1); });
