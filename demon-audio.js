/* IQ BATTLE — demon-audio.js — Shadow-flavor procedural audio layer, zero assets. */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};

  const MASTER_GAIN = 0.5;

  const DemonAudio = {
    _ctx: null,
    _master: null,
    _pulse: null,   // { osc, lfo, gain } stage-3 sub-bass bed
    _muteTimer: null,
  };

  // ---------- core ----------
  function ctxAvailable() {
    try {
      return typeof (root.AudioContext || root.webkitAudioContext) === 'function';
    } catch (e) { return false; }
  }

  // Mute-aware: defer to IQ.Audio's muted state when present.
  function isMuted() {
    try {
      const A = root.IQ && root.IQ.Audio;
      return !!(A && A._muted);
    } catch (e) { return false; }
  }

  function applyMute() {
    try {
      if (!D_ok()) return;
      const t = DemonAudio._ctx.currentTime;
      DemonAudio._master.gain.cancelScheduledValues(t);
      DemonAudio._master.gain.setTargetAtTime(isMuted() ? 0 : MASTER_GAIN, t, 0.05);
    } catch (e) {}
  }

  function D_ok() {
    return !!(DemonAudio._ctx && DemonAudio._master);
  }

  // Lazy init. Safe to call repeatedly; call from a user gesture.
  DemonAudio.init = function () {
    try {
      if (DemonAudio._ctx) {
        if (DemonAudio._ctx.state === 'suspended') DemonAudio._ctx.resume();
        applyMute();
        return true;
      }
      if (!ctxAvailable()) return false;
      const AC = root.AudioContext || root.webkitAudioContext;
      const c = new AC();
      const master = c.createGain();
      master.gain.value = isMuted() ? 0 : MASTER_GAIN;
      master.connect(c.destination);
      DemonAudio._ctx = c;
      DemonAudio._master = master;
      if (!DemonAudio._muteTimer) {
        DemonAudio._muteTimer = setInterval(applyMute, 400);
      }
      return true;
    } catch (e) {
      DemonAudio._ctx = null;
      DemonAudio._master = null;
      return false;
    }
  };

  function now() { return DemonAudio._ctx.currentTime; }

  // Per-voice envelope gain routed to the demon master bus.
  function outGain(vol, t0, attack, hold, release) {
    const c = DemonAudio._ctx;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t0 + Math.max(0.001, attack));
    if (hold != null) g.gain.setValueAtTime(Math.max(0.0001, vol), t0 + hold);
    if (release != null) g.gain.exponentialRampToValueAtTime(0.0001, t0 + release);
    g.connect(DemonAudio._master);
    return g;
  }

  function osc(type, freq, t0) {
    const o = DemonAudio._ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    return o;
  }

  let noiseBuf = null;
  function noiseBuffer() {
    const c = DemonAudio._ctx;
    if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
    const len = Math.floor(c.sampleRate * 2);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseBuf = buf;
    return buf;
  }

  function noiseSrc(t0, dur) {
    const s = DemonAudio._ctx.createBufferSource();
    s.buffer = noiseBuffer();
    s.loop = true;
    s.start(t0);
    s.stop(t0 + dur);
    return s;
  }

  // Cheap bitcrush-ish distortion via quantizing waveshaper.
  function crushNode(steps) {
    const ws = DemonAudio._ctx.createWaveShaper();
    const n = 256, curve = new Float32Array(n);
    const q = Math.max(2, Math.round(steps));
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.round(x * q) / q;
    }
    ws.curve = curve;
    ws.oversample = 'none';
    return ws;
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  // ---------- stage-3 demonic sub-bass pulse ----------
  function stopPulse() {
    const p = DemonAudio._pulse;
    DemonAudio._pulse = null;
    if (!p) return;
    try {
      const t = now();
      p.gain.gain.cancelScheduledValues(t);
      p.gain.gain.setTargetAtTime(0.0001, t, 0.5);
      setTimeout(function () {
        try { p.lfo.stop(); p.osc.stop(); p.harm.stop(); } catch (e) {}
      }, 2500);
    } catch (e) {}
  }

  function startPulse() {
    try {
      if (DemonAudio._pulse) return;
      const c = DemonAudio._ctx, t = now();
      // Deep sine fundamental + a quiet detuned saw harmonic for growl body.
      const o = osc('sine', 43, t);
      const harm = osc('sawtooth', 86.5, t);
      const hg = c.createGain(); hg.gain.value = 0.06;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.setTargetAtTime(0.32, t, 1.2);
      // Slow LFO breathing on the pulse gain — heartbeat-of-the-void.
      const lfo = osc('sine', 0.75, t);
      const lg = c.createGain(); lg.gain.value = 0.14;
      lfo.connect(lg); lg.connect(g.gain);
      harm.connect(hg); hg.connect(lp);
      o.connect(lp); lp.connect(g); g.connect(DemonAudio._master);
      o.start(t); harm.start(t); lfo.start(t);
      DemonAudio._pulse = { osc: o, harm: harm, lfo: lfo, gain: g };
    } catch (e) { DemonAudio._pulse = null; }
  }

  DemonAudio.setStage = function (n) {
    try {
      if (!D_ok()) return;
      if (n >= 3) startPulse(); else stopPulse();
    } catch (e) {}
  };

  // ---------- one-shot stingers ----------
  // 'whisper': swarms of bandpassed noise bursts panned randomly around the head.
  function sWhisper() {
    const c = DemonAudio._ctx, t0 = now();
    const bursts = 5 + Math.floor(rand(0, 3));
    for (let i = 0; i < bursts; i++) {
      const t = t0 + i * rand(0.06, 0.14);
      const src = noiseSrc(t, 0.22);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(rand(900, 2600), t);
      bp.Q.value = rand(4, 10);
      // Sibilant flick: sweep the band slightly per burst.
      bp.frequency.exponentialRampToValueAtTime(rand(700, 3200), t + 0.18);
      const pan = c.createStereoPanner ? c.createStereoPanner() : null;
      const g = outGain(rand(0.08, 0.2), t, 0.02, 0.06, 0.2);
      if (pan) { pan.pan.value = rand(-0.95, 0.95); src.connect(bp); bp.connect(pan); pan.connect(g); }
      else { src.connect(bp); bp.connect(g); }
    }
  }

  // 'growl': distorted low saw with pitch wobble, guttural and short.
  function sGrowl() {
    const c = DemonAudio._ctx, t0 = now(), dur = 1.1;
    const o = osc('sawtooth', rand(52, 68), t0);
    o.frequency.exponentialRampToValueAtTime(rand(38, 46), t0 + dur);
    // Wobble LFO on pitch — throat rattle.
    const wob = osc('sine', rand(5, 8), t0);
    const wg = c.createGain(); wg.gain.value = 9;
    wob.connect(wg); wg.connect(o.frequency);
    const dist = crushNode(24);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 340;
    const g = outGain(0.34, t0, 0.04, dur - 0.25, dur);
    o.connect(dist); dist.connect(lp); lp.connect(g);
    o.start(t0); o.stop(t0 + dur + 0.1);
    wob.start(t0); wob.stop(t0 + dur + 0.1);
  }

  // 'emerald': detuned saw pad swelling green — Chaos Emerald radiance.
  function sEmerald() {
    const c = DemonAudio._ctx, t0 = now(), dur = 2.4;
    const freqs = [110, 110.9, 164.8, 220.7]; // root + detune pair + fifth
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(300, t0);
    lp.frequency.exponentialRampToValueAtTime(1800, t0 + dur * 0.55);
    lp.frequency.exponentialRampToValueAtTime(500, t0 + dur);
    const g = outGain(0.13, t0, 0.7, dur - 1.0, dur);
    lp.connect(g);
    for (let i = 0; i < freqs.length; i++) {
      const o = osc('sawtooth', freqs[i], t0);
      o.connect(lp);
      o.start(t0); o.stop(t0 + dur + 0.1);
    }
    // Faint high shimmer — the gem's glint.
    const sh = osc('sine', 1760, t0 + 0.4);
    const sg = outGain(0.02, t0 + 0.4, 0.5, 0.8, 1.6);
    sh.connect(sg);
    sh.start(t0 + 0.4); sh.stop(t0 + 2.1);
  }

  // 'cleanse': bright major arpeggio — the relief, purity pushing back.
  function sCleanse() {
    const c = DemonAudio._ctx, t0 = now();
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5]; // C major up high
    for (let i = 0; i < notes.length; i++) {
      const t = t0 + i * 0.07;
      const o = osc('triangle', notes[i], t);
      const g = outGain(0.16 - i * 0.012, t, 0.01, 0.05, 0.85);
      o.connect(g);
      o.start(t); o.stop(t + 0.9);
      // Bell partial an octave up, very quiet.
      const b = osc('sine', notes[i] * 2, t);
      const bg = outGain(0.04, t, 0.01, 0.03, 0.5);
      b.connect(bg);
      b.start(t); b.stop(t + 0.55);
    }
  }

  // 'lurch': bitcrushed riser — the chaos stinger. Rises, then slams down.
  function sLurch() {
    const c = DemonAudio._ctx, t0 = now(), rise = 1.15;
    // Riser: saw sweeping up through the crusher.
    const o = osc('sawtooth', 58, t0);
    o.frequency.exponentialRampToValueAtTime(310, t0 + rise);
    const nz = noiseSrc(t0, rise);
    const nf = c.createBiquadFilter(); nf.type = 'highpass';
    nf.frequency.setValueAtTime(200, t0);
    nf.frequency.exponentialRampToValueAtTime(2400, t0 + rise);
    const crush = crushNode(12);
    const ng = c.createGain(); ng.gain.setValueAtTime(0.12, t0);
    ng.gain.exponentialRampToValueAtTime(0.3, t0 + rise);
    const g = outGain(0.28, t0, 0.05, rise - 0.05, rise);
    o.connect(crush); nz.connect(nf); nf.connect(ng); ng.connect(crush);
    crush.connect(g);
    o.start(t0); o.stop(t0 + rise + 0.05);
    // Slam: pitch-dropping sub thud right after the peak.
    const t1 = t0 + rise;
    const thud = osc('sine', 130, t1);
    thud.frequency.exponentialRampToValueAtTime(36, t1 + 0.5);
    const tg = outGain(0.42, t1, 0.005, 0.08, 0.55);
    thud.connect(tg);
    thud.start(t1); thud.stop(t1 + 0.6);
  }

  const STINGS = { whisper: sWhisper, growl: sGrowl, emerald: sEmerald, cleanse: sCleanse, lurch: sLurch };

  // sting(name) — one-shot Shadow stinger. No-throw, mute-aware.
  DemonAudio.sting = function (name) {
    try {
      if (!DemonAudio.init() || isMuted()) return;
      if (DemonAudio._ctx.state === 'suspended') DemonAudio._ctx.resume();
      const fn = STINGS[name];
      if (fn) fn();
    } catch (e) {}
  };

  root.IQ.DemonAudio = DemonAudio;

  // Node test export (guarded require must not throw).
  if (typeof module !== 'undefined') module.exports = root.IQ.DemonAudio;
})();
