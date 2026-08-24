/* IQ BATTLE — music-pack.js — Alignment-reactive procedural music director, zero assets.
 *
 * window.IQ.Music
 *   Music.mount()                  — safe anywhere; records mute/alignment prefs, NO AudioContext yet.
 *   Music.userGesture()            — call ONCE from the app-wide pointerdown hook (documented for Main).
 *                                    This is the ONLY place the AudioContext is created/resumed (no autoplay).
 *   Music.setAlignment(a)          — 'bad' | 'good' | 'chaotic' | 'neutral'; 2s gain crossfade between beds.
 *   Music.sting(kind)              — one-shots: 'pain' (amplifier, dissonant) | 'heal' (major chime).
 *   Music.setMuted(b)              — respects IQB_MUTED; also self-polls localStorage as fallback.
 *
 * Pure WebAudio synthesis (oscillators/noise/waveshaper). Master gain capped at 0.15.
 * Chaotic pitch skips + heartbeat jitter are seeded (mulberry32) — deterministic per bed activation.
 * Motion-flavored modulation (LFOs) gated behind IQB_MOTION.
 * Node-safe: guarded require must not throw; AudioContext absence is a silent no-op.
 * ============================================================================*/
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.IQ = root.IQ || {};

  const MASTER_GAIN = 0.15;
  const FADE = 2.0;            // seconds, bed crossfade
  const LOOKAHEAD = 0.45;      // seconds scheduled ahead of wall clock
  const TICK_MS = 120;

  const ALIGNMENTS = ['bad', 'good', 'chaotic', 'neutral'];

  const Music = {
    _ctx: null,
    _master: null,
    _muted: false,
    _align: 'neutral',
    _beds: {},        // name -> { gain, nodes:[], rng, next:0, built:true }
    _timer: null,
    _pollTimer: null,
  };

  // ---------- prefs ----------
  function mutedPref() {
    try {
      const v = root.localStorage && root.localStorage.getItem('IQB_MUTED');
      return v != null && JSON.parse(v) === true;
    } catch (e) { return false; }
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

  function ok() { return !!(Music._ctx && Music._master); }
  function now() { return Music._ctx.currentTime; }

  // Seeded PRNG — deterministic patterns per bed activation.
  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seedFor(name) {
    // Stable per-alignment seeds; activation count varies nothing observable.
    return { bad: 0xBADA55, good: 0x600DCA7, chaotic: 0xC0FFEE, neutral: 0x4E27741 }[name] || 1;
  }

  function applyMute() {
    try {
      if (!ok()) return;
      const t = now();
      Music._master.gain.cancelScheduledValues(t);
      Music._master.gain.setTargetAtTime(Music._muted ? 0 : MASTER_GAIN, t, 0.08);
    } catch (e) {}
  }

  // ---------- shared voice helpers ----------
  function osc(type, freq, t0) {
    const o = Music._ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    o.start(t0);
    return o;
  }

  let noiseBuf = null;
  function noiseBuffer() {
    const c = Music._ctx;
    if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
    const len = Math.floor(c.sampleRate * 2);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseBuf = buf;
    return buf;
  }
  function noiseSrc(t0, dur) {
    const s = Music._ctx.createBufferSource();
    s.buffer = noiseBuffer();
    s.loop = true;
    s.start(t0);
    s.stop(t0 + dur);
    return s;
  }

  function lowpass(freq, q) {
    const f = Music._ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    f.Q.value = q || 0.7;
    return f;
  }

  // Bitcrush-flavored quantizing waveshaper.
  function crushNode(steps) {
    const ws = Music._ctx.createWaveShaper();
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

  // ---------- beds ----------
  // Each builder returns { tick(rng, tNow) } for scheduled events; continuous voices are
  // started immediately and registered in bed.nodes for later teardown.

  function bedBad(bed, t0) {
    const g = Music._ctx.createGain();       // drone bus
    g.gain.value = 0.5;
    const lp = lowpass(260, 0.8);
    lp.connect(g); g.connect(bed.gain);
    // Detuned pair a minor 2nd apart at the bottom — constant rub.
    bed.nodes.push(osc('sawtooth', 55.0, t0), osc('triangle', 58.27, t0));
    bed.nodes[bed.nodes.length - 2].connect(lp);
    bed.nodes[bed.nodes.length - 1].connect(lp);

    const BEAT = 60 / 52;                    // ~52 bpm heartbeat
    return {
      tick: function (rng, tNow) {
        if (bed.next < tNow) bed.next = tNow + 0.05;
        while (bed.next < tNow + LOOKAHEAD) {
          const t = bed.next;
          // lub-dub: main thump + softer echo
          thump(t, 0.9);
          if (rng() < 0.75) thump(t + 0.16 + rng() * 0.04, 0.35);
          // Irregular pulse: jitter ±18% of a beat, occasional skipped beat.
          const skip = rng() < 0.12;
          bed.next = t + BEAT * (skip ? 2 : 1) * (0.82 + rng() * 0.36);
        }
      },
    };
    function thump(t, amp) {
      const o = Music._ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(82, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
      const eg = Music._ctx.createGain();
      eg.gain.setValueAtTime(0.0001, t);
      eg.gain.exponentialRampToValueAtTime(0.85 * amp, t + 0.012);
      eg.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.connect(eg); eg.connect(bed.gain);
      o.start(t); o.stop(t + 0.32);
    }
  }

  const GOOD_CHORDS = [
    // I : C major
    { pad: [130.81, 196.00, 261.63, 329.63], arp: [261.63, 329.63, 392.00, 523.25] },
    // IV : F major
    { pad: [174.61, 220.00, 349.23, 440.00], arp: [349.23, 440.00, 523.25, 698.46] },
  ];

  function bedGood(bed, t0) {
    // Warm pad: two chord groups (I and IV) crossfading inside the bed on a slow loop.
    const groups = GOOD_CHORDS.map((chord) => {
      const gg = Music._ctx.createGain();
      gg.gain.value = 0.0001;
      gg.connect(bed.gain);
      const oscs = [];
      chord.pad.forEach((f) => {
        [-3, 3].forEach((cents) => {           // gentle detune width = warmth
          const o = osc('triangle', f, t0);
          o.detune.value = cents;
          const og = Music._ctx.createGain();
          og.gain.value = 0.12 / chord.pad.length;
          o.connect(og); og.connect(gg);
          oscs.push(o);
        });
      });
      return { gg, oscs };
    });
    bed.nodes.push(...groups.flatMap((gr) => gr.oscs));

    const BAR = 8;                             // 8th-notes per chord before I<->IV swap
    const STEP = 60 / 92 / 2;                  // 8th notes at a gentle 92 bpm
    let barIdx = -1;
    return {
      tick: function (rng, tNow) {
        if (bed.next < tNow) bed.next = tNow + 0.05;
        while (bed.next < tNow + LOOKAHEAD) {
          const t = bed.next;
          const stepInBar = Math.round((t - t0) / STEP) % BAR;
          const chord = Math.floor(Math.round((t - t0) / STEP) / BAR) % 2;
          if (stepInBar === 0 && chord !== barIdx) {
            barIdx = chord;
            const tt = now();
            groups.forEach((gr, gi) => {
              gr.gg.gain.cancelScheduledValues(tt);
              gr.gg.gain.setTargetAtTime(gi === chord ? 0.9 : 0.0001, tt, FADE / 3);
            });
          }
          // Gentle 8th-note arpeggio over the live chord.
          const tones = GOOD_CHORDS[chord].arp;
          const f = tones[Math.floor(rng() * tones.length)] * (rng() < 0.15 ? 2 : 1);
          plink(t, f, 0.06);
          bed.next += STEP;
        }
      },
    };
    function plink(t, f, amp) {
      const o = Music._ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f, t);
      const eg = Music._ctx.createGain();
      eg.gain.setValueAtTime(0.0001, t);
      eg.gain.exponentialRampToValueAtTime(amp, t + 0.02);
      eg.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      o.connect(eg); eg.connect(bed.gain);
      o.start(t); o.stop(t + 0.48);
    }
  }

  function bedChaotic(bed, t0) {
    // Crush bus for the stutter arps + a nervous low drone for continuity.
    const crush = crushNode(6);
    const bp = Music._ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.9;
    crush.connect(bp); bp.connect(bed.gain);

    const dg = Music._ctx.createGain();
    dg.gain.value = 0.25;
    dg.connect(bed.gain);
    const dOsc = osc('square', 55, t0);
    dOsc.connect(lowpass(140, 0.6)).connect(dg);
    bed.nodes.push(dOsc);

    if (motionOn()) {
      // Wobble only counts as motion flavor — gated behind IQB_MOTION.
      const lfo = osc('sine', 6.3, t0);
      const lg = Music._ctx.createGain();
      lg.gain.value = 180;
      lfo.connect(lg); lg.connect(bp.frequency);
      bed.nodes.push(lfo);
    }

    const SCALE = [0, 3, 5, 7, 10, 12];        // minor pentatonic + octave
    const BASE = 110;
    let lastIdx = 0;
    return {
      tick: function (rng, tNow) {
        if (bed.next < tNow) bed.next = tNow + 0.05;
        while (bed.next < tNow + LOOKAHEAD) {
          const t = bed.next;
          // Stutter: repeat the same pitch 1-4 times, fast.
          const reps = 1 + Math.floor(rng() * 4);
          let idx = lastIdx;
          if (rng() < 0.7) idx = Math.min(SCALE.length - 1, Math.max(0, lastIdx + Math.floor(rng() * 5) - 2));
          else idx = Math.floor(rng() * SCALE.length);   // wild seeded pitch skip
          lastIdx = idx;
          for (let r = 0; r < reps; r++) {
            const dur = 0.07 + rng() * 0.13;
            zap(t, BASE * Math.pow(2, SCALE[idx] / 12), dur, 0.09 + rng() * 0.05);
            t += dur + rng() * 0.06;
          }
          bed.next = t + rng() * 0.22;           // ragged gate
        }
      },
    };
    function zap(t, f, dur, amp) {
      const o = Music._ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(f, t);
      const eg = Music._ctx.createGain();
      eg.gain.setValueAtTime(0.0001, t);
      eg.gain.exponentialRampToValueAtTime(amp, t + 0.006);
      eg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(eg); eg.connect(crush);
      o.start(t); o.stop(t + dur + 0.03);
    }
  }

  function bedNeutral(bed, t0) {
    // Airy perfect-fifth drone, very quiet; sparse high pings.
    const g = Music._ctx.createGain();
    g.gain.value = 0.32;
    g.connect(bed.gain);
    const a = osc('sine', 110.0, t0);
    const e = osc('sine', 164.81, t0);
    const hi = osc('triangle', 329.63, t0);
    const hg = Music._ctx.createGain();
    hg.gain.value = 0.12;
    a.connect(g); e.connect(g); hi.connect(hg); hg.connect(g);
    bed.nodes.push(a, e, hi);

    if (motionOn()) {
      // Slow breathing on the drone — motion flavor, gated.
      const lfo = osc('sine', 0.08, t0);
      const lg = Music._ctx.createGain();
      lg.gain.value = 0.08;
      lfo.connect(lg); lg.connect(g.gain);
      bed.nodes.push(lfo);
    }
    return {
      tick: function (rng, tNow) {
        if (bed.next < tNow) bed.next = tNow + 2 + rng() * 4;
        while (bed.next < tNow + LOOKAHEAD) {
          const t = bed.next;
          ping(t, [1046.5, 1318.5, 1568.0][Math.floor(rng() * 3)], 0.035);
          bed.next = t + 4 + rng() * 6;        // sparse by design
        }
      },
    };
    function ping(t, f, amp) {
      const o = Music._ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t);
      const eg = Music._ctx.createGain();
      eg.gain.setValueAtTime(0.0001, t);
      eg.gain.exponentialRampToValueAtTime(amp, t + 0.03);
      eg.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      o.connect(eg); eg.connect(bed.gain);
      o.start(t); o.stop(t + 2.3);
    }
  }

  const BUILDERS = { bad: bedBad, good: bedGood, chaotic: bedChaotic, neutral: bedNeutral };

  function buildBed(name, t0) {
    const bed = { gain: Music._ctx.createGain(), nodes: [], rng: mulberry32(seedFor(name)), next: 0 };
    bed.gain.gain.value = 0.0001;
    bed.gain.connect(Music._master);
    bed.impl = BUILDERS[name](bed, t0);
    Music._beds[name] = bed;
    return bed;
  }

  function teardownBed(name) {
    const bed = Music._beds[name];
    if (!bed) return;
    delete Music._beds[name];
    try {
      bed.nodes.forEach((n) => { try { n.stop(); } catch (e) {} });
    } catch (e) {}
    try {
      const t = now();
      bed.gain.gain.cancelScheduledValues(t);
      bed.gain.gain.setValueAtTime(Math.max(0.0001, bed.gain.gain.value), t);
      bed.gain.gain.linearRampToValueAtTime(0.0001, t + 0.1);
      setTimeout(() => { try { bed.gain.disconnect(); } catch (e) {} }, 300);
    } catch (e) {}
  }

  // ---------- director ----------
  Music.mount = function () {
    try {
      Music._muted = mutedPref();
      if (!ALIGNMENTS.includes(Music._align)) Music._align = 'neutral';
      return true;
    } catch (e) { return false; }
  };

  // MUST be called from a user-gesture handler (app-wide pointerdown hook). The ONLY
  // place the AudioContext is created/resumed — nothing autoplays before this.
  Music.userGesture = function () {
    try {
      Music._muted = mutedPref();
      if (!ctxAvailable()) return false;
      if (!Music._ctx) {
        const AC = root.AudioContext || root.webkitAudioContext;
        Music._ctx = new AC();
        Music._master = Music._ctx.createGain();
        Music._master.gain.value = Music._muted ? 0 : MASTER_GAIN;
        Music._master.connect(Music._ctx.destination);
      }
      if (Music._ctx.state === 'suspended' && Music._ctx.resume) Music._ctx.resume();
      if (!Music._timer) Music._timer = setInterval(schedulerTick, TICK_MS);
      if (!Music._pollTimer) Music._pollTimer = setInterval(() => {
        const m = mutedPref();
        if (m !== Music._muted) { Music._muted = m; applyMute(); }
      }, 500);
      activate(Music._align, now() + 0.02);
      applyMute();
      return true;
    } catch (e) {
      Music._ctx = null; Music._master = null;
      return false;
    }
  };

  function activate(name, t0) {
    if (!ok()) return;
    let bed = Music._beds[name];
    if (!bed) bed = buildBed(name, t0);
    bed.gain.gain.cancelScheduledValues(t0);
    bed.gain.gain.setValueAtTime(Math.max(0.0001, bed.gain.gain.value), t0);
    bed.gain.gain.linearRampToValueAtTime(1, t0 + FADE);   // 2s fade-in
    ALIGNMENTS.forEach((other) => {
      if (other === name) return;
      const b = Music._beds[other];
      if (!b) return;
      b.gain.gain.cancelScheduledValues(t0);
      b.gain.gain.setValueAtTime(Math.max(0.0001, b.gain.gain.value), t0);
      b.gain.gain.linearRampToValueAtTime(0.0001, t0 + FADE); // 2s fade-out
      setTimeout(() => { if (Music._align !== other) teardownBed(other); }, (FADE + 0.4) * 1000);
    });
  }

  function schedulerTick() {
    try {
      if (!ok()) return;
      const bed = Music._beds[Music._align];
      if (!bed || !bed.impl) return;
      bed.impl.tick(bed.rng, now());
    } catch (e) {}
  }

  Music.setAlignment = function (name) {
    if (!ALIGNMENTS.includes(name)) return false;
    Music._align = name;
    if (ok()) activate(name, now() + 0.02);
    return true;
  };

  Music.setMuted = function (b) {
    Music._muted = !!b;
    try {
      if (root.localStorage) root.localStorage.setItem('IQB_MUTED', JSON.stringify(!!b));
    } catch (e) {}
    applyMute();
  };

  // ---------- stingers ----------
  // 'pain': amplifier pain — dissonant falling minor-second grind.
  // 'heal': relief — ascending major chime.
  Music.sting = function (kind) {
    try {
      if (!ok() || Music._muted) return;
      const t0 = now() + 0.02;
      if (kind === 'pain') sPain(t0);
      else if (kind === 'heal') sHeal(t0);
    } catch (e) {}
  };

  function sPain(t0) {
    const dist = crushNode(10);
    const lp = lowpass(1400, 1.2);
    dist.connect(lp); lp.connect(Music._master);
    [233.08, 220.0].forEach((f, i) => {         // minor 2nd pair, grinding
      const o = Music._ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 1.06, t0);
      o.frequency.exponentialRampToValueAtTime(f * 0.72, t0 + 0.55);   // falls in pain
      const eg = Music._ctx.createGain();
      eg.gain.setValueAtTime(0.0001, t0);
      eg.gain.exponentialRampToValueAtTime(i ? 0.12 : 0.2, t0 + 0.02);
      eg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      o.connect(eg); eg.connect(dist);
      o.start(t0); o.stop(t0 + 0.65);
    });
    const thump = Music._ctx.createOscillator(); // body blow under the grind
    thump.type = 'sine';
    thump.frequency.setValueAtTime(70, t0);
    thump.frequency.exponentialRampToValueAtTime(34, t0 + 0.2);
    const tg = Music._ctx.createGain();
    tg.gain.setValueAtTime(0.0001, t0);
    tg.gain.exponentialRampToValueAtTime(0.5, t0 + 0.01);
    tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
    thump.connect(tg); tg.connect(Music._master);
    thump.start(t0); thump.stop(t0 + 0.35);
  }

  function sHeal(t0) {
    // C major chime climbing out of the dark.
    const notes = [523.25, 659.25, 783.99, 1046.5];   // C5 E5 G5 C6
    notes.forEach((f, i) => {
      const t = t0 + i * 0.09;
      ['sine', 'triangle'].forEach((wave, wi) => {
        const o = Music._ctx.createOscillator();
        o.type = wave;
        o.frequency.setValueAtTime(f, t);
        const eg = Music._ctx.createGain();
        const amp = wi ? 0.06 : 0.11;
        eg.gain.setValueAtTime(0.0001, t);
        eg.gain.exponentialRampToValueAtTime(amp, t + 0.015);
        eg.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
        o.connect(eg); eg.connect(Music._master);
        o.start(t); o.stop(t + 1.4);
      });
    });
  }

  root.IQ.Music = Music;

  // Node test export (guarded require must not throw).
  if (typeof module !== 'undefined') module.exports = root.IQ.Music;
})();
