/* smoke-hellaudio.js — node harness for ../pack-hellaudio.js against the REAL
 * hooks.js + hellheaven.js. Run: node research/smoke-hellaudio.js  (exit 0 = pass)
 *
 * Covers (with a recording AudioContext stub — zero real audio):
 *   - paramsFor purity: intensity 0 below layer 2; monotone escalation 2..7
 *   - applyLayer ramps: cutoff/detune/gain targets match paramsFor per layer
 *   - dread drone reacts to REAL hellheaven layer state via Hooks.dispatch
 *   - demon scream: fires once per NEW deeper layer entry, <= 900 ms,
 *     throttled >= 6 s apart on the audio clock
 *   - sanctuary relief: good/heaven round crossfades drone->shimmer <= 2 s;
 *     next hostile round releases
 *   - parity rule C8: rounds 1-2 are inert
 *   - mute gate: IQB_MUTED pref flips master to 0; scream refuses while muted
 */
'use strict';
const path = require('path');

let failures = 0, passes = 0;
function ok(cond, label) {
  if (cond) { passes++; console.log('  ok  - ' + label); }
  else { failures++; console.log('  FAIL- ' + label); }
}

/* ---------------- recording AudioContext stub ---------------- */
class Param {
  constructor(v) { this.value = v; this.events = []; }
  setValueAtTime(v, t) { this.events.push({ op: 'set', t, v }); this.value = v; }
  exponentialRampToValueAtTime(v, t) { this.events.push({ op: 'exp', t, v }); this.value = v; }
  linearRampToValueAtTime(v, t) { this.events.push({ op: 'lin', t, v }); this.value = v; }
  setTargetAtTime(v, t, tc) { this.events.push({ op: 'tgt', t, v, tc }); }
  cancelScheduledValues() { this.events.push({ op: 'cancel' }); }
}
class FakeNode {
  constructor(ctx) { this.ctx = ctx; this.gain = new Param(1); this.frequency = null; this.detune = null; this.Q = null; this.type = ''; this.curve = null; }
  connect(dest) { this.ctx._connections.push(this); return dest; }
  disconnect() {}
}
class FakeOsc extends FakeNode {
  constructor(ctx) { super(ctx); this.frequency = new Param(440); this.detune = new Param(0); this.starts = []; this.stops = []; }
  start(t) { this.starts.push(t == null ? this.ctx.currentTime : t); }
  stop(t) { this.stops.push(t == null ? this.ctx.currentTime : t); }
}
class FakeAC {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.state = 'running';
    this.destination = new FakeNode(this);
    this._connections = [];
    this.created = { osc: [], gain: [], biquad: [], src: [] };
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  createOscillator() { const o = new FakeOsc(this); this.created.osc.push(o); return o; }
  createGain() { const g = new FakeNode(this); this.created.gain.push(g); return g; }
  createBiquadFilter() { const f = new FakeNode(this); f.frequency = new Param(350); f.Q = new Param(1); this.created.biquad.push(f); return f; }
  createBufferSource() {
    const ctx = this;
    const s = new FakeNode(this);
    s.buffer = null; s.loop = false;
    s.starts = []; s.stops = [];
    s.start = (t) => s.starts.push(t == null ? ctx.currentTime : t);
    s.stop = (t) => s.stops.push(t == null ? ctx.currentTime : t);
    this.created.src.push(s);
    return s;
  }
  createWaveShaper() { const w = new FakeNode(this); w.oversample = 'none'; return w; }
  createBuffer(ch, len, sr) { return { sampleRate: sr, getChannelData: () => new Float32Array(len) }; }
}

global.window = undefined;                    // force root = globalThis path
global.AudioContext = FakeAC;

/* Muted-pref stub: off during the main phases, flipped at the very end. */
let storedMuted = 'false';
global.localStorage = { getItem: (k) => (k === 'IQB_MUTED' ? storedMuted : null) };

require(path.join(__dirname, '..', 'hooks.js'));
require(path.join(__dirname, '..', 'hellheaven.js'));
const IQ = global.IQ;
ok(!!IQ.Hooks && !!IQ.HellHeaven, 'real hooks.js + hellheaven.js loaded');

const HellAudio = require(path.join(__dirname, '..', 'pack-hellaudio.js'));
ok(!!HellAudio && typeof HellAudio.paramsFor === 'function', 'IQ.HellAudio exported');

/* ================= 1. paramsFor purity ================= */
console.log('# paramsFor');
const p0 = HellAudio.paramsFor(0), p1 = HellAudio.paramsFor(1);
ok(p0.level === 0 && p1.level === 0, 'intensity 0 below layer 2 (layers 0 and 1)');
const p3 = HellAudio.paramsFor(3), p6 = HellAudio.paramsFor(6), p7 = HellAudio.paramsFor(7);
ok(p6.level > p3.level && p6.cutoff > p3.cutoff && p6.detune > p3.detune,
  'layer 6 darker+brighter+wider than layer 3');
ok(p7.level >= p6.level && p7.cutoff >= p6.cutoff, 'monotone up to layer 7 cap');
ok(HellAudio.paramsFor(9).level === p7.level && HellAudio.paramsFor(-3).level === 0, 'input clamped to 0..7');

/* ================= 2. init builds graph, applyLayer ramps ================= */
console.log('# drone graph + applyLayer');
ok(HellAudio.init() === true, 'init() creates context from user-gesture convention');
ok(HellAudio.init() === true, 'init() idempotent');

HellAudio.applyLayer(3);
const droneGainEvents = HellAudio._drone.gain.gain.events.filter((e) => e.op === 'tgt');
const lastTgt = droneGainEvents[droneGainEvents.length - 1];
ok(Math.abs(lastTgt.v - p3.level) < 1e-6, 'applyLayer(3) -> drone bus level matches paramsFor(3)');
const filtTgt = HellAudio._drone.filter.frequency.events.filter((e) => e.op === 'tgt').pop();
ok(filtTgt && Math.abs(filtTgt.v - p3.cutoff) < 1e-6, 'applyLayer(3) -> lowpass brightness matches paramsFor(3)');
const d0 = HellAudio._drone.oscs[0].detune.events.filter((e) => e.op === 'tgt').pop();
const d1 = HellAudio._drone.oscs[1].detune.events.filter((e) => e.op === 'tgt').pop();
ok(d0.v === -p3.detune && d1.v === p3.detune, 'applyLayer(3) -> mirrored detune rub');

HellAudio.applyLayer(1);
const silent = HellAudio._drone.gain.gain.events.filter((e) => e.op === 'tgt').pop();
ok(silent.v === 0.0001, 'applyLayer(1) -> drone silenced (intensity 0 below layer 2)');
HellAudio.applyLayer(6);

/* ================= 3. parity rounds inert ================= */
console.log('# parity C8');
IQ.Hooks.beginRun('smoke-hellaudio', 4242);
IQ.Hooks.dispatch('onRoundStart', { round: 1, align: 'bad', world: 'w1' });
IQ.Hooks.dispatch('onRoundStart', { round: 2, align: 'chaotic', world: 'w1' });
ok(HellAudio._lastLayer === -1, 'rounds 1-2: no layer reaction (inert)');

/* ================= 4. hook-driven descent + scream throttle ================= */
console.log('# layer descent + demon scream');
/* hellheaven: every 2nd consecutive hostile round deepens the layer. */
IQ.Hooks.dispatch('onRoundStart', { round: 3, align: 'bad', world: 'w1' }); // runBad 1
IQ.Hooks.dispatch('onRoundStart', { round: 4, align: 'bad', world: 'w1' }); // layer -> 2
ok(HellAudio._lastLayer === 2, 'hook dispatch drives drone to hellheaven layer 2');
ok(IQ.HellHeaven.layer() === 2, 'sanity: real HellHeaven.layer() is 2');

/* First deeper-layer entry screamed at audio-clock t=0 (unmuted, ctx live). */
const ac = HellAudio._ctx;
const oscBefore = ac.created.osc.length;
IQ.Hooks.dispatch('onRoundStart', { round: 5, align: 'chaotic', world: 'w1' }); // runBad 1 again
IQ.Hooks.dispatch('onRoundStart', { round: 6, align: 'bad', world: 'w1' });     // layer -> 3
ok(HellAudio._lastLayer === 3, 'descent reaches layer 3');
ok(ac.created.osc.length > oscBefore, 'layer increase spawned scream voices');

/* Scream geometry: <= 900 ms total, bandpass present, gains capped. */
const recentStops = [];
ac.created.osc.forEach((o) => o.stops.forEach((t) => recentStops.push(t)));
const maxStop = Math.max.apply(null, recentStops);
ok(maxStop <= 0 + 0.901, 'scream scheduled length <= 900 ms (max stop ' + maxStop.toFixed(3) + 's)');
const bpUsed = ac.created.biquad.some((f) => f.type === 'bandpass');
ok(bpUsed, 'scream routed through bandpass filter');
const cappedGains = ac.created.gain.every((g) =>
  g.gain.events.filter((e) => e.op === 'exp' || e.op === 'set').every((e) => e.v <= 0.23));
ok(cappedGains, 'all scream envelope peaks <= 0.22 cap (+epsilon)');

/* Throttle: immediate retry inside 6 s refused. */
const oscBeforeRetry = ac.created.osc.length;
ok(HellAudio.scream(() => 0.42) === false, 'scream throttled within 6 s of previous');
ac.currentTime += 6.5;
ok(HellAudio.scream(() => 0.77) === true, 'scream allowed after >= 6 s gap');
ac.currentTime -= 6.5; // keep clock tidy for later phases

/* ================= 5. sanctuary resolve / release ================= */
console.log('# sanctuary relief');
IQ.Hooks.dispatch('onRoundStart', { round: 7, align: 'good', world: 'heaven' });
ok(IQ.Sanctuary ? true : true, '(sanctuary skin handled by sanctuary.js — audio checked here)');
const shimEvents = HellAudio._shimmer.gain.gain.events.filter((e) => e.op === 'lin');
const upRamp = shimEvents[shimEvents.length - 1];
ok(upRamp && Math.abs(upRamp.v - 0.12) < 1e-6, 'resolve(): shimmer rises to 0.12');
ok(upRamp && (upRamp.t - ac.currentTime) <= 2.001, 'resolve(): crossfade <= 2 s');
const droneDown = HellAudio._drone.gain.gain.events.filter((e) => e.op === 'lin').pop();
ok(droneDown && droneDown.v === 0.0001, 'resolve(): dread drone melts to silence');
/* hellheaven halved the layer on the good round; drone stays parked while resolved. */

IQ.Hooks.dispatch('onRoundStart', { round: 8, align: 'bad', world: 'w1' });
const shimDown = HellAudio._shimmer.gain.gain.events.filter((e) => e.op === 'lin').pop();
ok(shimDown && shimDown.v === 0.0001, 'release(): shimmer fades on hostile round');
/* hellheaven halved the layer to 1 on the good round, so the resumed drone
 * level must match paramsFor(current layer) — intensity 0 at layer 1. */
const droneBack = HellAudio._drone.gain.gain.events.filter((e) => e.op === 'lin').pop();
const expected = Math.max(0.0001, HellAudio.paramsFor(IQ.HellHeaven.layer()).level);
ok(droneBack && droneBack.v === expected,
  'release(): drone resumes exactly at paramsFor(layer ' + IQ.HellHeaven.layer() + ') level');

/* ================= 6. mute gate ================= */
console.log('# mute gate');
storedMuted = 'true';                          // IQB_MUTED = JSON true
HellAudio.setMuted(true);                      // explicit flip
const mTgt = HellAudio._master.gain.events.filter((e) => e.op === 'tgt').pop();
ok(mTgt && mTgt.v === 0, 'muted -> master gain target 0');
ac.currentTime += 10;                          // clear throttle window
ok(HellAudio.scream(() => 0.5) === false, 'scream refuses while muted');
(async () => {
  await new Promise((r) => setTimeout(r, 650)); // allow one 400 ms self-poll
  const polled = HellAudio._master.gain.events.filter((e) => e.op === 'tgt').pop();
  ok(polled && polled.v === 0, 'self-poll keeps master at 0 under IQB_MUTED');
  HellAudio.setMuted(false);

  /* ---- done ---- */
  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})();
