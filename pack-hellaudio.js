/* ============================================================================
 * pack-hellaudio.js — IQ Versus: SHADOW · HELL-AUDIO hooks pack (always:true)
 * ----------------------------------------------------------------------------
 * SPEC (Dave): "progressively more chaotic, more fire, blood, shaking, melting,
 * wild demons screaming audio" — NOTHING reacted to the hell-heaven LAYER depth
 * yet. This pack is a PURE AUDIO REACTOR: it never returns gameplay modifiers
 * (every handler returns null), it only listens and screams.
 *
 * WHAT IT DOES
 *   1. DREAD DRONE — a persistent procedural WebAudio drone whose level, detune
 *      spread and lowpass brightness map to window.IQ.HellHeaven.layer()
 *      (0..7), re-polled in onRoundStart/onTick and applied as cheap param
 *      ramps (setTargetAtTime — zero per-frame allocation). Intensity is 0
 *      below layer 2. The drone owns its OWN AudioContext — music-pack.js owns
 *      the alignment beds and audio.js owns the act beds; neither is touched.
 *   2. DEMON SCREAM — hellheaven.js emits { sfx:'hh:layer<N>' } on entering a
 *      NEW deeper layer (it parks the intent in Hooks.state 'hh:pendingFanfare'
 *      at round start, which this pack observes directly — registered after
 *      hellheaven.js, same dispatch pass). A layer increase triggers a ONE-SHOT
 *      procedural demon scream: bandpassed sawtooth pitch-drop + noise burst,
 *      total length <= 900 ms, per-voice gain capped at 0.22, throttled to at
 *      most one every >= 6 s (audio-clock based).
 *   3. SANCTUARY RELIEF — on a good/heaven round start (the exact condition
 *      under which sanctuary.js emits its 'sanctuary' flag) the drone resolves
 *      to a soft C-major shimmer: crossfade <= 2 s, held for that round,
 *      released on the next hostile/neutral round start.
 *
 * CONSUMES: IQ.Hooks.state keys 'hh:layer', 'hh:pendingFanfare' (written by
 *   hellheaven.js); window.IQ.HellHeaven.layer() when present.
 * EXPOSES: window.IQ.HellAudio { init, applyLayer, paramsFor, scream, resolve,
 *   release, setMuted } — init is idempotent; paramsFor is pure (smoke-tested).
 *
 * DETERMINISM: zero Math.random / Date.now in decisions. All variation (scream
 *   pitch, noise-buffer fill) flows through ctx.rng when dispatched, else a
 *   fixed-seed mulberry32 fallback (headless only). Throttle uses the audio
 *   clock, never wall time.
 *
 * FAIRNESS/GATES: inert rounds 1-2 (parity rule C8); audio behind IQB_MUTED
 *   (localStorage, JSON true) AND defers to IQ.Audio._muted like demon-audio;
 *   NO AudioContext before a real user gesture (one-time pointerdown hook);
 *   LFO motion flavor gated behind IQB_MOTION; master gain capped at 0.15.
 *   Node-safe: guarded require must not throw; absent AudioContext = silent.
 * ==========================================================================*/
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};

  const MASTER_GAIN = 0.15;     // house cap (music-pack parity)
  const PARITY_ROUNDS = 2;      // C8: inert through round 2
  const SCREAM_MIN_GAP = 6;     // seconds between demon screams
  const XFADE = 1.6;            // sanctuary crossfade, <= 2 s
  const SCREAM_LEN = 0.85;      // <= 900 ms hard cap

  /* ---- deterministic PRNG (fallback only; ctx.rng preferred) ---- */
  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function mutedPref() {
    try {
      const v = root.localStorage && root.localStorage.getItem('IQB_MUTED');
      return v != null && JSON.parse(v) === true;
    } catch (e) { return false; }
  }
  function siblingMuted() {
    try { return !!(root.IQ && root.IQ.Audio && root.IQ.Audio._muted); }
    catch (e) { return false; }
  }
  function motionOn() {
    try {
      const v = root.localStorage && root.localStorage.getItem('IQB_MOTION');
      return v == null ? true : JSON.parse(v) !== false;
    } catch (e) { return true; }
  }
  function ctxAvailable() {
    try { return typeof (root.AudioContext || root.webkitAudioContext) === 'function'; }
    catch (e) { return false; }
  }

  const HA = {
    _ctx: null,
    _master: null,
    _muted: false,
    _drone: null,     // { oscs:[], sub, filter, gain, lfo, lfoDepth }
    _shimmer: null,   // { gain, nodes:[] }
    _muteTimer: null,
    _wantLayer: 0,    // layer requested before the context existed
    _lastLayer: -1,   // last layer we rendered/screamed for
    _lastScreamAt: -1e9,
  };

  function ok() { return !!(HA._ctx && HA._master); }
  function nowSec() { return ok() ? HA._ctx.currentTime : 0; }

  /* ======================= PURE PARAM MAP (tested) ======================== */
  /* layer 0..7 -> { level, cutoff, detune, wobble }. Intensity 0 below 2. */
  function paramsFor(layer) {
    const L = Math.max(0, Math.min(7, layer | 0));
    if (L < 2) return { level: 0, cutoff: 140, detune: 0, wobble: 0 };
    const t = (L - 2) / 5;                       // 0..1 across layers 2..7
    return {
      level: +(0.10 + 0.30 * t).toFixed(4),      // drone bus level
      cutoff: Math.round(140 + 520 * t),         // lowpass brightness Hz
      detune: Math.round(45 * t),                // cents of detune rub
      wobble: Math.round(90 * t),                // LFO depth on the filter
    };
  }

  /* ============================ GRAPH BUILD ============================== */
  let noiseBuf = null;
  function noiseBuffer() {
    // Filled from a FIXED seed — zero Math.random anywhere in this file.
    const c = HA._ctx;
    if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
    const len = Math.floor(c.sampleRate * 2);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    const rng = mulberry32(0x51EED5);            // fixed seed
    for (let i = 0; i < len; i++) d[i] = rng() * 2 - 1;
    noiseBuf = buf;
    return buf;
  }

  function buildDrone(c) {
    // Low saw cluster -> shared lowpass -> drone bus -> master.
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 140;
    filter.Q.value = 0.8;
    const gain = c.createGain();
    gain.gain.value = 0.0001;                    // silent until layer >= 2
    filter.connect(gain); gain.connect(HA._master);

    const p0 = paramsFor(HA._wantLayer);
    const oscs = [41.2, 41.9].map(function (f, i) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = i === 0 ? -p0.detune : p0.detune;
      o.connect(filter);
      o.start();
      return o;
    });
    const sub = c.createOscillator();            // sine floor under the rub
    sub.type = 'sine';
    sub.frequency.value = 30.9;                  // ~B0
    sub.connect(gain);
    sub.start();

    let lfo = null, lfoDepth = null;
    if (motionOn()) {                            // motion flavor only
      lfo = c.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.11;                // slow filter breathing
      lfoDepth = c.createGain();
      lfoDepth.gain.value = p0.wobble;
      lfo.connect(lfoDepth); lfoDepth.connect(filter.frequency);
      lfo.start();
    }
    return { oscs: oscs, sub: sub, filter: filter, gain: gain, lfo: lfo, lfoDepth: lfoDepth };
  }

  function buildShimmer(c) {
    // Soft C-major triangle pad, parked at silence until a sanctuary round.
    const gain = c.createGain();
    gain.gain.value = 0.0001;
    gain.connect(HA._master);
    const nodes = [];
    [130.81, 196.00, 261.63, 329.63].forEach(function (f) {   // C3 G3 C4 E4
      [-4, 4].forEach(function (cents) {                       // gentle width
        const o = c.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        o.detune.value = cents;
        const g = c.createGain();
        g.gain.value = 0.03;
        o.connect(g); g.connect(gain);
        o.start();
        nodes.push(o);
      });
    });
    return { gain: gain, nodes: nodes };
  }

  /* Lazy init. Idempotent. MUST first run inside a user gesture (the one-time
   * pointerdown hook below) — never autoplays before that. */
  HA.init = function () {
    try {
      if (ok()) { safeResume(); return true; }
      if (!ctxAvailable()) return false;
      HA._muted = mutedPref() || siblingMuted();
      const AC = root.AudioContext || root.webkitAudioContext;
      const c = new AC();
      const master = c.createGain();
      master.gain.value = HA._muted ? 0 : MASTER_GAIN;
      master.connect(c.destination);
      HA._ctx = c;
      HA._master = master;
      HA._drone = buildDrone(c);
      HA._shimmer = buildShimmer(c);
      applyLayer(HA._wantLayer);
      if (!HA._muteTimer) {
        HA._muteTimer = setInterval(function () {
          const m = mutedPref() || siblingMuted();
          if (m !== HA._muted) HA.setMuted(m);
        }, 400);
      }
      return true;
    } catch (e) {
      HA._ctx = null; HA._master = null; HA._drone = null; HA._shimmer = null;
      return false;
    }
  };

  function safeResume() {
    try { if (HA._ctx && HA._ctx.state === 'suspended' && HA._ctx.resume) HA._ctx.resume(); }
    catch (e) {}
  }

  /* No-autoplay convention: bind once at load; the FIRST pointerdown creates
   * the context. Matches audio.js/music-pack.js gesture discipline. */
  function bindGesture() {
    try {
      if (typeof document === 'undefined' || HA._gestureBound) return;
      HA._gestureBound = true;
      document.addEventListener('pointerdown', function () { HA.init(); }, { once: false });
    } catch (e) {}
  }

  /* ========================== DRONE CONTROL ============================= */
  /* Cheap param ramps only — no allocation per call. */
  function applyLayer(layer) {
    HA._wantLayer = Math.max(0, Math.min(7, layer | 0));
    if (!ok() || !HA._drone) return;
    const p = paramsFor(HA._wantLayer);
    const t = nowSec(), tc = 0.25;               // fast-but-smooth glide
    try {
      HA._drone.gain.gain.cancelScheduledValues(t);
      HA._drone.gain.gain.setTargetAtTime(Math.max(0.0001, p.level), t, tc);
      HA._drone.filter.frequency.cancelScheduledValues(t);
      HA._drone.filter.frequency.setTargetAtTime(p.cutoff, t, tc);
      HA._drone.oscs.forEach(function (o, i) {
        o.detune.cancelScheduledValues(t);
        o.detune.setTargetAtTime(i === 0 ? -p.detune : p.detune, t, tc);
      });
      if (HA._drone.lfoDepth) HA._drone.lfoDepth.gain.setTargetAtTime(p.wobble, t, tc);
    } catch (e) {}
  }
  HA.applyLayer = applyLayer;

  /* Sanctuary relief: drone melts away, major-shimmer rises (<= 2 s). */
  HA.resolve = function () {
    if (!ok()) return false;
    try {
      const t = nowSec();
      HA._shimmer = HA._shimmer || buildShimmer(HA._ctx);
      ramp(HA._drone && HA._drone.gain, 0.0001, t);
      ramp(HA._shimmer.gain, 0.12, t);
      return true;
    } catch (e) { return false; }
  };

  /* Release: shimmer fades, dread drone resumes at the current layer. */
  HA.release = function () {
    if (!ok()) return false;
    try {
      const t = nowSec();
      ramp(HA._shimmer && HA._shimmer.gain, 0.0001, t);
      const p = paramsFor(HA._wantLayer);
      ramp(HA._drone && HA._drone.gain, Math.max(0.0001, p.level), t);
      return true;
    } catch (e) { return false; }
  };

  function ramp(nodeParam, target, t) {
    if (!nodeParam) return;
    nodeParam.gain.cancelScheduledValues(t);
    nodeParam.gain.setValueAtTime(Math.max(0.0001, nodeParam.gain.value), t);
    nodeParam.gain.linearRampToValueAtTime(target, t + XFADE);   // <= 2 s
  }

  /* =========================== DEMON SCREAM ============================= */
  /* One-shot bandpassed saw pitch-drop + noise burst, <= 900 ms, gain-capped,
   * throttled to >= SCREAM_MIN_GAP apart on the AUDIO clock.
   * rng: variation source (ctx.rng in handlers; seeded fallback elsewhere).
   * Returns true iff a scream actually fired. */
  HA.scream = function (rng) {
    const t0 = nowSec();
    if (!ok() || HA._muted) return false;
    if (t0 - HA._lastScreamAt < SCREAM_MIN_GAP) return false;
    const r = (typeof rng === 'function') ? rng : mulberry32(0x5EA111);
    try {
      const c = HA._ctx;
      const f0 = 260 + r() * 280;

      // Bandpassed sawtooth pitch-drop — the throat of the thing.
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(900 + r() * 300, t0);
      bp.frequency.exponentialRampToValueAtTime(220, t0 + SCREAM_LEN * 0.65);
      bp.Q.value = 3;
      bp.connect(HA._master);

      const saw = c.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.setValueAtTime(f0, t0);
      saw.frequency.exponentialRampToValueAtTime(Math.max(40, f0 * 0.32), t0 + 0.55);
      saw.detune.value = Math.round((r() * 2 - 1) * 35);
      const eg = c.createGain();                              // cap 0.22
      eg.gain.setValueAtTime(0.0001, t0);
      eg.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
      eg.gain.exponentialRampToValueAtTime(0.0001, t0 + SCREAM_LEN);
      saw.connect(eg); eg.connect(bp);
      saw.start(t0); saw.stop(t0 + SCREAM_LEN + 0.02);

      // Clipped-off noise burst — the snap of wings parting.
      const nb = noiseSrc(t0, 0.22);
      const nf = c.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = 1200 + r() * 800;
      nf.Q.value = 1.2;
      const ng = c.createGain();                              // cap 0.16
      ng.gain.setValueAtTime(0.0001, t0);
      ng.gain.exponentialRampToValueAtTime(0.16, t0 + 0.01);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      nb.connect(nf); nf.connect(ng); ng.connect(HA._master);

      HA._lastScreamAt = t0;
      return true;
    } catch (e) { return false; }
  };

  function noiseSrc(t0, dur) {
    const s = HA._ctx.createBufferSource();
    s.buffer = noiseBuffer();
    s.loop = true;
    s.start(t0);
    s.stop(t0 + dur);
    return s;
  }

  /* ============================== MUTING ================================ */
  HA.setMuted = function (m) {
    HA._muted = !!m;
    try {
      if (!ok()) return;
      const t = nowSec();
      HA._master.gain.cancelScheduledValues(t);
      HA._master.gain.setTargetAtTime(HA._muted ? 0 : MASTER_GAIN, t, 0.08);
    } catch (e) {}
  };

  /* ========================= HOOK INTEGRATION =========================== */
  function layerNow(st) {
    try {
      if (root.IQ && root.IQ.HellHeaven && typeof root.IQ.HellHeaven.layer === 'function') {
        return Math.max(0, Math.min(7, root.IQ.HellHeaven.layer() | 0));
      }
      return Math.max(0, Math.min(7, Number(st && st.get && st.get('hh:layer')) || 0));
    } catch (e) { return 0; }
  }

  function parityGate(ctx) {
    return !ctx || ((ctx.round | 0) <= PARITY_ROUNDS);   // rounds 1-2 inert
  }

  /* Observe layer changes; scream once per NEW deeper layer entry. */
  function syncLayer(ctx, st) {
    const L = layerNow(st);
    const prev = HA._lastLayer;
    if (L === prev) return;
    HA._lastLayer = L;
    applyLayer(L);
    if (L > prev && prev >= 0) HA.scream(ctx && ctx.rng);   // deeper we go
  }

  const handlers = {
    onRoundStart: function (ctx) {
      try {
        if (parityGate(ctx)) return null;                    // C8 parity
        const st = root.IQ && root.IQ.Hooks && root.IQ.Hooks.state;
        syncLayer(ctx, st);
        const good = ctx.align === 'good' || ctx.world === 'heaven';
        if (good) HA.resolve(); else HA.release();           // sanctuary relief
      } catch (e) {}
      return null;                                           // pure listener
    },
    onTick: function (ctx) {
      try {
        if (parityGate(ctx)) return null;
        const st = root.IQ && root.IQ.Hooks && root.IQ.Hooks.state;
        syncLayer(ctx, st);                                  // cheap re-poll
      } catch (e) {}
      return null;
    },
  };

  /* ============================ REGISTRATION ============================ */
  function register() {
    try {
      if (root.IQ.Hooks && typeof root.IQ.Hooks.add === 'function') {
        root.IQ.Hooks.add({ id: 'hell-audio', always: true, weight: 0.25, handlers: handlers });
        return true;
      }
    } catch (e) {}
    (root.__hellAudioPending = root.__hellAudioPending || []).push(register);
    return false;
  }

  HA.paramsFor = paramsFor;
  root.IQ.HellAudio = HA;
  register();
  bindGesture();

  /* Node test export (guarded require must not throw). */
  if (typeof module !== 'undefined') module.exports = root.IQ.HellAudio;
})();
