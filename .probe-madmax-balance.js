/* .probe-madmax-balance.js — ONE-OFF balance probe (BalSpectacle), not a keeper smoke.
 * Mounts the real modes/madmax.js under DOM stubs and drives a median-lane-play
 * bot across depths/seeds to measure: citadel reachability before cap, point
 * totals vs the takeover payout band [0.6P, 1.35P], P = 100*diff+40.
 * Run: node .probe-madmax-balance.js
 */
'use strict';
const path = require('path');
const root = globalThis;

function ctx2dStub() {
  const grad = { addColorStop() {} };
  return new Proxy({}, { get: (t, k) => {
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
    if (k === 'measureText') return () => ({ width: 10 });
    return typeof t[k] !== 'undefined' ? t[k] : (() => {});
  }, set: () => true });
}
function El(tag) {
  this.tag = tag; this.children = []; this.style = {}; this.clientWidth = 720;
  this.clientHeight = 480; this.parentNode = null;
}
El.prototype.appendChild = function (c) { this.children.push(c); c.parentNode = this; return c; };
El.prototype.removeChild = function (c) {
  const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1);
  c.parentNode = null; return c;
};
El.prototype.setAttribute = function (k, v) { this['_attr_' + k] = String(v); };
El.prototype.getAttribute = function (k) { return this['_attr_' + k]; };
El.prototype.addEventListener = function () {};
El.prototype.removeEventListener = function () {};
El.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
};
Object.defineProperty(El.prototype, 'getContext', { value: function () { return ctx2dStub(); } });

root.window = root;
root.devicePixelRatio = 1;
root.requestAnimationFrame = () => 0;
root.cancelAnimationFrame = () => {};
root.matchMedia = () => ({ matches: false });
root.addEventListener = function () {};
root.removeEventListener = function () {};
root.setTimeout = (fn) => { setImmediate(fn); return 0; };
root.clearTimeout = () => {};

const canvasProto = Object.create(El.prototype);
Object.defineProperty(canvasProto, 'getContext', { value: function () { return ctx2dStub(); } });
canvasProto.width = 0; canvasProto.height = 0; canvasProto.style = {};
root.document = { createElement(tag) { return tag === 'canvas' ? Object.create(canvasProto) : new El(tag); } };

require(path.join(__dirname, 'modes', 'madmax.js'));
const stage = root.__stagePending.filter(s => s.id === 'fury-roadrun')[0];

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t ^ (t >>> 14)) >>> 0;
    return t / 4294967296;
  };
}
const COLORS = ['RUST', 'BONE', 'BRASS', 'VENOM'];
const RIG_X = Math.round(700 * 0.16); // fit(): view.w = max(320, min(720,720)-20)=700

function mkCtx(seed, depth) {
  return {
    depth, tier: 0, diff: 1, world: 'wasteland-roads', align: null,
    hp: 100, score: 0, streak: 0, seed: seed >>> 0,
    rng: mulberry(seed >>> 0),
    mp: { on: false }, timerLen: 45, expired: false,
    audio: null, fx: null, banner() {}, say() {}, quip() {}, name: 'PROBE'
  };
}

/* Median lane-play bot:
   priority: pothole dodge > rival-charge dodge > nearest reachable needed-color
   sign > guzzoline > stay. Human-ish 140 ms decision cadence. */
async function runBot(seed, depth) {
  delete root.__ROADRUN__;
  let settle = null;
  const p = stage.mount(new El('div'), mkCtx(seed, depth)).then(r => { settle = r; });
  const rr = root.__ROADRUN__;
  let lastMove = 0, simMs = 0;
  while (true) {
    const st = rr.state();
    simMs = st.simMs;
    if (simMs - lastMove >= 140 && !st.finished) {
      lastMove = simMs;
      const lane = st.lane;
      const near = st.ents.filter(e => !e.hit && e.x > RIG_X - 30 && e.x < RIG_X + 420);
      // 1) pothole heading at me -> safest adjacent lane
      const pots = near.filter(e => e.kind === 'pot' && e.x < RIG_X + 300);
      let want = null;
      const potInMyLane = pots.some(e => e.lane === lane);
      if (potInMyLane) {
        for (const cand of [lane - 1, lane + 1]) {
          if (cand < 0 || cand > 2) continue;
          if (!pots.some(e => e.lane === cand)) { want = cand; break; }
        }
        if (want === null) want = lane === 0 ? 1 : lane - 1; // cornered
      }
      // 2) rival charging MY lane -> switch
      if (want === null && st.rival === 'charge') {
        // rival laneAt isn't exposed; heuristically jiggle on charge
        want = lane === 2 ? 1 : lane + 1;
      }
      // 3) nearest needed TRUE-color sign (shades have ci>=4 at diff>=3)
      if (st.needed !== null && want === null) {
        const needIdx = COLORS.indexOf(st.needed);
        const tgt = near.filter(e => e.kind === 'sign' && e.ci === needIdx)
          .sort((a, b) => a.x - b.x)[0];
        if (tgt && tgt.lane !== lane) want = tgt.lane;
      }
      // 4) gas
      if (want === null) {
        const gas = near.filter(e => e.kind === 'gas').sort((a, b) => a.x - b.x)[0];
        if (gas && gas.lane !== lane) want = gas.lane;
      }
      if (want !== null && want !== lane) rr.step(want > lane ? 'down' : 'up');
    }
    if (!rr.advance(16)) break;
  }
  for (let i = 0; i < 10 && !settle; i++) await new Promise(r => setTimeout(r, 10));
  return { res: settle };
}

function diffFor(depth) { return Math.min(5, Math.max(1, 1 + (((depth | 0) - 1) / 6 | 0))); }
function puzzlePay(d) { return 100 * d + 40; }

const DEPTHS = [3, 6, 9, 12, 15, 21, 27];
let grandBad = 0;
async function main() { for (const depth of DEPTHS) {
const d = diffFor(depth);
  const P = puzzlePay(d);
  const rows = [];
  for (let seed = 1; seed <= 15; seed++) {
    const { res } = await runBot(seed, depth);
    rows.push(res);
  }
  const cit = rows.filter(r => /WHAT A DAY/.test(r.summary));
  const pts = rows.map(r => r.points).sort((a, b) => a - b);
  const med = pts[(pts.length >> 1)];
  const dmgMax = Math.max(...rows.map(r => Math.abs(r.hpDelta)));
  const tReach = rows.map(() => 0);
  console.log(
    `depth ${String(depth).padStart(2)} diff ${d} | P=${P} band=[${Math.round(.6 * P)},${Math.round(1.35 * P)}]` +
    ` | citadel ${(100 * cit.length / rows.length).toFixed(0)}%` +
    ` | pts min/med/max ${pts[0]}/${med}/${pts[pts.length - 1]}` +
    ` | correct ${(100 * rows.filter(r => r.correct === true).length / rows.length).toFixed(0)}%` +
    ` | hpDelta worst ${-dmgMax}` +
    ` | inBand(pts) ${pts.filter(x => x >= .6 * P && x <= 1.35 * P).length}/${rows.length}`
  );
} }
main().catch(e => { console.error(e); process.exit(1); });
console.log('probe done');
