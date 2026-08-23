/* IQ BATTLE — audio.js — 100% procedural WebAudio, zero assets. */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};

  const Audio = {
    _ctx: null,
    _master: null,
    _muted: false,
    _act: 0,
    _ambience: null, // { nodes: [], timers: [], gain }
  };

  // ---------- core ----------
  function ctxAvailable() {
    try {
      return typeof (root.AudioContext || root.webkitAudioContext) === 'function';
    } catch (e) { return false; }
  }

  // Lazy init. Safe to call repeatedly; call from a user gesture.
  Audio.init = function () {
    if (Audio._ctx) { if (Audio._ctx.state === 'suspended') safeResume(); return true; }
    if (!ctxAvailable()) return false;
    try {
      const AC = root.AudioContext || root.webkitAudioContext;
      const c = new AC();
      const master = c.createGain();
      master.gain.value = Audio._muted ? 0 : 0.9;
      master.connect(c.destination);
      Audio._ctx = c;
      Audio._master = master;
    } catch (e) {
      Audio._ctx = null;
      return false;
    }
    return true;
  };

  function safeResume() {
    try { if (Audio._ctx && Audio._ctx.state === 'suspended') Audio._ctx.resume(); } catch (e) {}
  }

  function now() { return Audio._ctx.currentTime; }

  function outGain(vol, t0, attack, release) {
    // Per-voice envelope + output node routed to master.
    const c = Audio._ctx;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), t0 + (attack || 0.005));
    if (release != null) g.gain.exponentialRampToValueAtTime(0.0001, t0 + release);
    g.connect(Audio._master);
    return g;
  }

  function osc(type, freq, t0) {
    const o = Audio._ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    return o;
  }

  let noiseBuf = null;
  function noiseBuffer() {
    // Shared 2s white-noise buffer.
    const c = Audio._ctx;
    if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
    const len = Math.floor(c.sampleRate * 2);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseBuf = buf;
    return buf;
  }

  function noiseSrc(t0, dur, loop) {
    const s = Audio._ctx.createBufferSource();
    s.buffer = noiseBuffer();
    s.loop = !!loop;
    if (!loop) { s.start(t0); s.stop(t0 + dur); }
    else s.start(t0);
    return s;
  }

  // Cheap bitcrush-ish distortion via waveshaper.
  function crushNode(amount) {
    const ws = Audio._ctx.createWaveShaper();
    const n = 256, curve = new Float32Array(n);
    const steps = Math.max(2, Math.round(amount));
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.round(x * steps) / steps; // quantize
    }
    ws.curve = curve;
    ws.oversample = 'none';
    return ws;
  }

  // ---------- one-shots ----------
  const SFX = {
    click(o) {
      const c = Audio._ctx, t = now(), v = o.vol, r = o.rate || 1;
      const g = outGain(v * 0.5, t, 0.002, 0.08 / r);
      const sq = osc('square', 1400 * r, t);
      sq.frequency.exponentialRampToValueAtTime(700 * r, t + 0.06 / r);
      sq.connect(g); sq.start(t); sq.stop(t + 0.1);
    },

    whoosh(o) {
      const c = Audio._ctx, t = now(), v = o.vol, r = o.rate || 1;
      const dur = 0.35 / r;
      const g = outGain(v * 0.5, t, 0.05, dur);
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.5;
      f.frequency.setValueAtTime(300 * r, t);
      f.frequency.exponentialRampToValueAtTime(3200 * r, t + dur * 0.7);
      f.frequency.exponentialRampToValueAtTime(500 * r, t + dur);
      const n = noiseSrc(t, dur);
      n.connect(f); f.connect(g);
    },

    boom(o) {
      const c = Audio._ctx, t = now(), v = o.vol;
      const g = outGain(v, t, 0.005, 0.9);
      const sine = osc('sine', 110, t);
      sine.frequency.exponentialRampToValueAtTime(30, t + 0.7);
      const ng = outGain(v * 0.6, t, 0.005, 0.5);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
      const n = noiseSrc(t, 0.5);
      n.connect(f); f.connect(ng);
      sine.connect(g); sine.start(t); sine.stop(t + 0.95);
    },

    sting(o) {
      // correct-answer rising two-note chime
      const t = now(), v = o.vol, r = o.rate || 1;
      [[523.25, 0], [783.99, 0.11]].forEach(([fq, dt]) => {
        const g = outGain(v * 0.4, t + dt, 0.01, 0.45 / r);
        [fq, fq * 2].forEach((f, k) => {
          const os = osc(k ? 'sine' : 'triangle', f * r, t + dt);
          os.connect(g); os.start(t + dt); os.stop(t + dt + 0.5);
        });
      });
    },

    buzz(o) {
      // wrong-answer harsh sawtooth fall
      const c = Audio._ctx, t = now(), v = o.vol;
      const g = outGain(v * 0.55, t, 0.008, 0.55);
      const cr = crushNode(12); cr.connect(g);
      [110, 113].forEach((f) => {
        const os = osc('sawtooth', f, t);
        os.frequency.setValueAtTime(f, t);
        os.frequency.exponentialRampToValueAtTime(55, t + 0.45);
        os.connect(cr); os.start(t); os.stop(t + 0.55);
      });
    },

    laugh(o) {
      // evil layered laugh synth: pitched "ha" pulses, descending, detuned layers
      const t = now(), v = o.vol, r = o.rate || 1;
      const base = 220 * r;
      for (let layer = 0; layer < 3; layer++) {
        const detune = 1 - layer * 0.13;
        for (let i = 0; i < 6; i++) {
          const t0 = t + i * 0.13 + layer * 0.03;
          const f = base * detune * Math.pow(0.92, i);
          const g = outGain(v * 0.22 * (1 - layer * 0.25), t0, 0.02, 0.16);
          const os = osc('sawtooth', f, t0);
          os.frequency.setValueAtTime(f, t0);
          os.frequency.exponentialRampToValueAtTime(f * 0.7, t0 + 0.14);
          const lp = Audio._ctx.createBiquadFilter();
          lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 4;
          os.connect(lp); lp.connect(g);
          os.start(t0); os.stop(t0 + 0.18);
        }
      }
    },

    heart(o) {
      // single heartbeat thump (lub)
      const c = Audio._ctx, t = now(), v = o.vol, r = o.rate || 1;
      const g = outGain(v, t, 0.01, 0.28 / r);
      const os = osc('sine', 65 * r, t);
      os.frequency.exponentialRampToValueAtTime(38 * r, t + 0.22 / r);
      os.connect(g); os.start(t); os.stop(t + 0.3 / r);
      // small body knock
      const ng = outGain(v * 0.25, t, 0.005, 0.09 / r);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 150; bp.Q.value = 2;
      const n = noiseSrc(t, 0.1 / r);
      n.connect(bp); bp.connect(ng);
    },

    tick(o) {
      const t = now(), v = o.vol, r = o.rate || 1;
      const g = outGain(v * 0.35, t, 0.001, 0.05 / r);
      const os = osc('square', 2400 * r, t);
      os.connect(g); os.start(t); os.stop(t + 0.05 / r);
    },

    whisper(o) {
      // filtered noise breath
      const c = Audio._ctx, t = now(), v = o.vol, r = o.rate || 1;
      const dur = 0.9 / r;
      const g = outGain(v * 0.4, t, 0.15, dur);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
      bp.frequency.setValueAtTime(1200 * r, t);
      bp.frequency.linearRampToValueAtTime(2600 * r, t + dur * 0.6);
      bp.frequency.linearRampToValueAtTime(900 * r, t + dur);
      const n = noiseSrc(t, dur);
      n.connect(bp); bp.connect(g);
    },

    scream(o) {
      // losing scream: descending distorted shriek
      const c = Audio._ctx, t = now(), v = o.vol, r = o.rate || 1;
      const dur = 1.4 / r;
      const g = outGain(v * 0.7, t, 0.03, dur);
      const cr = crushNode(10); cr.connect(g);
      [880, 1245].forEach((f, i) => {
        const os = osc(i ? 'square' : 'sawtooth', f * r, t);
        os.frequency.setValueAtTime(f * r, t);
        os.frequency.exponentialRampToValueAtTime(f * 0.18, t + dur);
        const vib = osc('sine', 9 * r, t);
        const vg = Audio._ctx.createGain(); vg.gain.value = 40 * r;
        vib.connect(vg); vg.connect(os.frequency);
        vib.start(t); vib.stop(t + dur);
        os.connect(cr); os.start(t); os.stop(t + dur);
      });
      const hg = outGain(v * 0.2, t, 0.05, dur);
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2000;
      const n = noiseSrc(t, dur);
      n.connect(hp); hp.connect(hg);
    },

    chime(o) {
      // fake-cheerful corporate arpeggio (C-E-G-C)
      const t = now(), v = o.vol, r = o.rate || 1;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        const t0 = t + i * 0.09 / r;
        const g = outGain(v * 0.32, t0, 0.01, 0.5);
        [f, f * 2.01].forEach((fr, k) => {
          const os = osc(k ? 'sine' : 'triangle', fr * r, t0);
          os.connect(g); os.start(t0); os.stop(t0 + 0.55);
        });
      });
    },

    glitch(o) {
      // bitcrush-y burst of random blips
      const c = Audio._ctx, t = now(), v = o.vol, r = o.rate || 1;
      const g = outGain(v * 0.5, t, 0.002, 0.3 / r);
      const cr = crushNode(6);
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 800;
      cr.connect(hp); hp.connect(g);
      for (let i = 0; i < 10; i++) {
        const t0 = t + Math.random() * 0.22 / r;
        const os = osc(Math.random() < 0.5 ? 'square' : 'sawtooth',
          200 + Math.random() * 3500, t0);
        os.start(t0); os.stop(t0 + 0.03);
        os.connect(cr);
      }
      const ng = outGain(v * 0.25, t, 0.002, 0.15 / r);
      const n = noiseSrc(t, 0.15 / r);
      n.connect(ng);
    },

    sacrifice(o) {
      // dark ritual gong: inharmonic partials + long decay
      const t = now(), v = o.vol;
      const partials = [72, 108.5, 151, 197.3, 262.7, 341.9];
      partials.forEach((f, i) => {
        const amp = v * 0.3 / (i + 1.5);
        const g = outGain(amp, t, 0.02, 3.5 - i * 0.3);
        const os = osc(i % 2 ? 'triangle' : 'sine', f, t);
        os.frequency.linearRampToValueAtTime(f * 0.985, t + 3);
        os.connect(g); os.start(t); os.stop(t + 3.6);
      });
      // strike transient
      const c = Audio._ctx;
      const ng = outGain(v * 0.3, t, 0.003, 0.25);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 1;
      const n = noiseSrc(t, 0.3);
      n.connect(bp); bp.connect(ng);
      // sub rumble
      const sg = outGain(v * 0.5, t, 0.05, 2.5);
      const sub = osc('sine', 36, t);
      sub.connect(sg); sub.start(t); sub.stop(t + 2.6);
    },
  };

  const NAMES = Object.keys(SFX);

  // play(name, opts?) — opts: {vol=1, rate=1}. No-throw.
  Audio.play = function (name, opts) {
    const fn = SFX[name];
    if (!fn) return false;
    if (!Audio._ctx) { if (!Audio.init()) return false; }
    safeResume();
    try {
      const o = Object.assign({ vol: 1, rate: 1 }, opts || {});
      fn.call(SFX, o);
      return true;
    } catch (e) {
      return false;
    }
  };

  Audio.names = function () { return NAMES.slice(); };

  // ---------- ambience ----------
  function stopAmbienceNodes(a) {
    if (!a) return;
    (a.timers || []).forEach((t) => { clearTimeout(t); clearInterval(t); });
    if (a.timers) a.timers.length = 0;
    a.nodes.forEach((n) => { try { n.stop ? n.stop() : n.disconnect(); } catch (e) {} });
    a.nodes.length = 0;
  }

  // Crossfade helper: returns a gain ramping 0->1 over 2s at time t0.
  function fadeUpGain(t0, peak) {
    const g = Audio._ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 2);
    g.connect(Audio._master);
    return g;
  }
  function fadeDownGain(node) {
    try {
      const t = now();
      node.gain.cancelScheduledValues(t);
      node.gain.setValueAtTime(Math.max(0.0001, node.gain.value), t);
      node.gain.linearRampToValueAtTime(0.0001, t + 2);
      setTimeout(() => stopAmbienceNodes({ nodes: [node] }), 2300);
    } catch (e) {}
  }

  // Act 0 bed: soft corporate hum + slow shimmering pad chime.
  function buildBed0(dest) {
    const c = Audio._ctx, nodes = [];
    // low hum
    const humG = c.createGain(); humG.gain.value = 0.05; humG.connect(dest);
    const hum = osc('sine', 60, now()); const hum2 = osc('sine', 90.5, now());
    hum.connect(humG); hum2.connect(humG);
    hum.start(); hum2.start();
    nodes.push(hum, hum2);
    // airy filtered noise
    const airG = c.createGain(); airG.gain.value = 0.015; airG.connect(dest);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    const n = noiseSrc(now(), 0, true); n.loop = true;
    n.connect(lp); lp.connect(airG);
    nodes.push(n);
    return { nodes };
  }

  // Act 1: same bed but detuned + slow pulse LFO on the destination gain.
  function buildBed1(dest) {
    const b = buildBed0(dest);
    const c = Audio._ctx;
    b.nodes.forEach((n) => {
      if (n.frequency) n.frequency.value *= 1.007; // slight detune vs act 0
    });
    // slow pulse
    const lfo = osc('sine', 0.25, now());
    const lg = c.createGain(); lg.gain.value = 0.03;
    lfo.connect(lg); lg.connect(dest.gain);
    lfo.start();
    b.nodes.push(lfo);
    return b;
  }

  // Act 2: hell drone — low saws + dark noise + irregular heartbeat timer.
  function buildBed2(dest) {
    const c = Audio._ctx, nodes = [];
    [41.2, 43.65, 61.7].forEach((f, i) => { // E1/F1/B1 cluster
      const g = c.createGain(); g.gain.value = 0.05; g.connect(dest);
      const os = osc('sawtooth', f, now());
      os.detune.value = (i - 1) * 12;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
      os.connect(lp); lp.connect(g); os.start();
      nodes.push(os);
    });
    const airG = c.createGain(); airG.gain.value = 0.03; airG.connect(dest);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 180; bp.Q.value = 0.7;
    const n = noiseSrc(now(), 0, true);
    n.connect(bp); bp.connect(airG);
    nodes.push(n);
    return { nodes };
  }

  // setAct(0|1|2): swap ambience bed with ~2s crossfade. No-throw.
  Audio.setAct = function (act) {
    if (act !== 0 && act !== 1 && act !== 2) return;
    Audio._act = act;
    if (!Audio._ctx) return;
    safeResume();
    try {
      const old = Audio._ambience;
      if (old) fadeDownGain(old.gain);
      const t = now();
      const gain = fadeUpGain(t, 1);
      let bed;
      if (act === 0) bed = buildBed0(gain);
      else if (act === 1) bed = buildBed1(gain);
      else bed = buildBed2(gain);
      const entry = { gain, nodes: bed.nodes, timers: [] };
      if (act === 2) {
        // irregular heartbeat scheduler
        const beat = () => {
          try {
            if (Audio._muted || !Audio._ctx) return;
            Audio.play('heart', { vol: 0.5 });
            entry.timers.push(setTimeout(beat, 900 + Math.random() * 2200));
          } catch (e) {}
        };
        entry.timers.push(setTimeout(beat, 1200));
      }
      Audio._ambience = entry;
      if (old) setTimeout(() => stopAmbienceNodes(old), 2300);
    } catch (e) {}
  };

  Audio.setMuted = function (muted) {
    Audio._muted = !!muted;
    try {
      if (Audio._master) {
        const t = now();
        Audio._master.gain.cancelScheduledValues(t);
        Audio._master.gain.linearRampToValueAtTime(Audio._muted ? 0 : 0.9, t + 0.15);
      }
    } catch (e) {}
  };

  Audio.stopAmbience = function () {
    const old = Audio._ambience;
    Audio._ambience = null;
    if (!old) return;
    try {
      if (Audio._ctx) {
        fadeDownGain(old.gain);
        setTimeout(() => stopAmbienceNodes(old), 2300);
      } else stopAmbienceNodes(old);
    } catch (e) { stopAmbienceNodes(old); }
  };

  root.IQ.Audio = Audio;

  // Node test export (guarded require must not throw).
  if (typeof module !== 'undefined') module.exports = root.IQ.Audio;
})();
