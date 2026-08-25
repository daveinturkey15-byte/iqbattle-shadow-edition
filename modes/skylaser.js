/**
 * modes/skylaser.js — SKY FIRE ('sky-laser-strike'): Superman-parody target-marking
 * event stage for the good-aligned sky-laser spectacle world.
 *
 * Fantasy: a caped sentinel circles overhead. Hostile recon drones hide in a
 * civilian crowd below; YOU mark the hostiles, and he threads his heat-vision
 * down YOUR marked lanes — cinematic column beams, gutter-localized flashes,
 * city saved, nobody fails. This is a GOOD-world round: there is NO fail state.
 *
 * Design lineage:
 *   - Contract: research/mode-contract.md (canonical Stage interface v1).
 *   - Shared machinery: research/modes-themed-design.md §0 (StageResult
 *     economics, fairness rails §0.5, MP patterns §0.2).
 *   - MP pattern: SEEDED-SIM (§0.2 D1) — every wave layout, the hero's patrol
 *     orbit, star field and skyline are pure functions of mount-time ctx.rng
 *     draws in a fixed order; zero per-frame RNG, zero Date.now() in gameplay
 *     decisions (presentation deadlines use performance.now() wall clock only,
 *     pack-muses convention). Host and clients render identical choreography;
 *     per-player marking skill differs, and the engine relays each client's
 *     StageResult for host-side clamping (never trust unclamped numbers).
 *
 * Registration shape (research/mode-contract.md §1):
 *   window.IQ.Stage.register({
 *     id: 'sky-laser-strike', name: 'SKY FIRE', weight: 3,
 *     worlds: ['sky-laser'], aligns: ['good'], net: 'seed',
 *     describe() -> { kind: 'sky-laser-strike' },
 *     mount(container, ctx) -> Promise<StageResult>,
 *     cleanup()
 *   });
 * If window.IQ.Stage is absent the spec queues onto window.__stagePending
 * (drained by the takeover runner once Stage lands).
 *
 * Supersedes notes (vs old modifier hooks):
 *   - Does NOT supersede the pack-hunters.js 'sky-laser' hook (one-shot lance
 *     that vaporizes a wrong option at 50% timer). That hook remains the
 *     low-depth assist fallback per themed-design §0.4; SKY FIRE is an
 *     ADDITIVE full-takeover event, not its replacement.
 *   - Coexists with modes/laserstorm.js (LASER STORM, weight 6) which reframes
 *     the same world as a trial. Weight 3 keeps SKY FIRE the occasional
 *     spectacle beat; takeover registrations win the wheel by weight, and the
 *     two ids never collide.
 *
 * Controls:
 *   - POINTER/TOUCH: click a hostile drone glyph to mark it (click again to
 *     un-mark). Clicking a civilian is a MISFIRE: -30 pts, 'INNOCENTS BELOW!'
 *     telegraph at the glyph.
 *   - KEYBOARD PARITY: arrows/WASD move the selection cursor, ENTER toggles
 *     the mark, SPACE or F fires the strike early.
 *   - The strike auto-fires once every hostile in the wave is marked, and at
 *     the wave deadline regardless — touch players never need a key.
 *
 * Round flow: intro card -> 3 waves of {brief -> mark -> heat-vision beam
 * pass} -> hero hover-salute -> resolve. Typical ~18 s, hard cap 32 s
 * (well under the 45 s ceiling). Promise settles EXACTLY once.
 *
 * StageResult fields (design economics, §0.1):
 *   kind:    'score'
 *   correct: ALWAYS true — good round, he still saves the city (no fail state)
 *   points:  +60 per wave with >=1 drone vaporized, -30 per civilian hit;
 *            hit civilians in ALL 3 waves => 'CLOSE CALL' banner and the
 *            running total is HALVED (round()). Range observed [-45, +180].
 *   hpDelta: +10 (hero hover-salute heal), every outcome.
 *   summary: <=48 chars, outcome-flavored (see verdictFor).
 * Engine clamps points [-200,500] / hpDelta [-60,60]; +10 sits comfortably
 * inside the rail.
 *
 * Fairness rails (§0.5):
 *   - Heat-vision flash is COLUMN-GUTTER-LOCALIZED only (never fullscreen),
 *     white-hot core <=150 ms with a 300 ms fade tail — under the 200 ms /
 *     3 Hz fullscreen caps by construction (there IS no fullscreen flash).
 *   - Civilian hit feedback: localized red ring pulse <=200 ms at the glyph +
 *     persistent 'INNOCENTS BELOW' caption while the wave lasts.
 *   - Drones vs civilians differ by SILHOUETTE (angular chevron + rotors vs
 *     round-headed figure), never hue alone; legend rendered every wave.
 *   - Beam lanes telegraph: marked lanes shimmer 350 ms before fire.
 *   - IQB_MOTION off (or prefers-reduced-motion): hero holds a static hover,
 *     no twinkle/flutter/particles, beams resolve as static lit columns with
 *     IDENTICAL judgment math (marking/scoring never depended on motion).
 *   - IQB_MUTED gates the lazily-created WebAudio synth entirely.
 *   - Text >= 11 px, Oxanium letterspaced uppercase; no overlays, nothing
 *     traps Escape, question/answer surfaces untouched (stage owns canvas).
 *   - Determinism: challenge = f(ctx.seed) exclusively; hidden answers do not
 *     exist here (glyph kinds are visible), so there is nothing to leak.
 *
 * Self-play / smoke hooks: window.__SKYLASER__
 *   state()                -> {phase, wave, cells, marked, wavesScored,
 *                             civHits, civPerWave, resolved, elapsedMs, motionOn}
 *   markSlot(i)            -> programmatic click on glyph slot i (returns bool)
 *   fire()                 -> trigger the heat-vision pass now
 *   finish()               -> force-resolve with current tallies (fast soak)
 * Node: require('./modes/skylaser.js')._smoke() exercises pure paths headless.
 * ============================================================================
 */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : globalThis;

  /* ---------- tuning ---------- */
  var WAVE_COUNT = 3;
  var COLS = 5;
  var ROWS = 3;
  var SLOTS = COLS * ROWS;
  var INTRO_MS = 1100;
  var BRIEF_MS = 650;          // legend/telegraph card per wave
  var BEAM_MS = 300;           // per-lane beam lifetime
  var BEAM_GAP = 340;          // stagger between lanes
  var AUTO_DELAY = 400;        // grace between full mark and auto-fire
  var TELEGRAPH_MS = 350;      // lane shimmer before fire (fairness rail)
  var SALUTE_MS = 1700;
  var CAP_MS = 32000;          // self-resolve cap << 45 s ceiling
  var TAU = Math.PI * 2;

  var PAL = {                  // sky-laser palette (worlds-pop.js)
    beam: '#66e0ff', beamDeep: '#3aa0ff', pale: '#bfeaff',
    night: '#0b1e4a', ice: '#8af0ff', dusk: '#123a7a',
    white: '#ffffff', suit: '#275fb0',
    danger: '#ff2038', gold: '#ffb01e', life: '#00e68a'
  };

  /* ---------- gates ---------- */
  function motionOn() {
    try {
      var v = root.localStorage && root.localStorage.getItem('IQB_MOTION');
      if (v != null && JSON.parse(v) === false) return false;
    } catch (e) {}
    try {
      if (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    } catch (e) {}
    return true;
  }
  function muted() {
    try {
      var v = root.localStorage.getItem('IQB_MUTED');
      return v === '1' || JSON.parse(v) === true;
    } catch (e) { return false; }
  }

  /* ======================================================================
   * PURE CORE — exported for node smoke; every gameplay decision funnels
   * through these so parity tools re-derive from (seed, inputs).
   * ====================================================================== */
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  /** Hostile count per wave: 3 -> 6, linear to depth 7. */
  function droneCountFor(depth) {
    return clamp(3 + Math.floor(((depth | 0) - 1) / 2), 3, 6);
  }
  /** Civilian count per wave: 2 -> 5, linear to depth 10. */
  function civCountFor(depth) {
    return clamp(2 + Math.floor(((depth | 0) - 1) / 3), 2, 5);
  }
  /** Marking window per wave: 4400 ms -> 2600 ms, linear to depth 12. */
  function markMsFor(depth) {
    return clamp(4400 - 160 * ((depth | 0) - 1), 2600, 4400);
  }

  /**
   * Build the 3 wave layouts from rng (SEEDED-SIM): Fisher-Yates over the
 * SLOTS grid positions, drawn in a fixed order — identical host/clients.
   * cells[i] ∈ 'drone' | 'civ' | null.
   */
  function buildWaves(rng, depth) {
    var drones = droneCountFor(depth);
    var civs = civCountFor(depth);
    var waves = [];
    for (var w = 0; w < WAVE_COUNT; w++) {
      var idx = [];
      for (var i = 0; i < SLOTS; i++) idx.push(i);
      for (var j = SLOTS - 1; j > 0; j--) {
        var k = Math.floor(rng() * (j + 1));
        var tmp = idx[j]; idx[j] = idx[k]; idx[k] = tmp;
      }
      var cells = [];
      for (var s = 0; s < SLOTS; s++) cells.push(null);
      for (var d = 0; d < drones; d++) cells[idx[d]] = 'drone';
      for (var c = 0; c < civs; c++) cells[idx[drones + c]] = 'civ';
      waves.push({ cells: cells, drones: drones, civs: civs });
    }
    return waves;
  }

  function colOf(slot) { return slot % COLS; }
  function rowOf(slot) { return Math.floor(slot / COLS); }

  /** Points earned by one wave's beam pass: +60 iff anything vaporized. */
  function wavePoints(vaporized) { return vaporized > 0 ? 60 : 0; }

  /** CLOSE CALL: at least one civilian misfire in EVERY wave. */
  function isCloseCall(civPerWave) {
    for (var i = 0; i < WAVE_COUNT; i++) {
      if (!civPerWave || !civPerWave[i]) return false;
    }
    return true;
  }

  /**
   * Final tally: +60/wave cleared, -30 per civilian hit, halved on CLOSE CALL.
   */
  function tally(wavesScored, civHits, closeCall) {
    var raw = wavePoints(1) * wavesScored - 30 * civHits;
    return closeCall ? Math.round(raw / 2) : raw;
  }

  /**
   * Verdict mapping (design economics): ALWAYS a save — correct true,
   * +10 vitality salute. Only flavor and the point total vary.
   */
  function verdictFor(wavesScored, civHits, closeCall) {
    var summary;
    if (closeCall) summary = 'CLOSE CALL · HE STILL SAVED IT';
    else if (civHits > 0) summary = 'CITY SAVED · CROWD SCATTERED';
    else if (wavesScored >= WAVE_COUNT) summary = 'CLEAN SWEEP · CITY SAVED';
    else if (wavesScored > 0) summary = 'CITY SAVED · SOME GOT AWAY';
    else summary = 'HE SAVED IT ALONE';
    return {
      correct: true,
      points: tally(wavesScored, civHits, closeCall),
      hpDelta: 10,
      summary: summary.length <= 48 ? summary : summary.slice(0, 48)
    };
  }

  /* ====================================================================== */

  function def() {
    return {
      id: 'sky-laser-strike',
      name: 'SKY FIRE',
      weight: 3,
      worlds: ['sky-laser'],
      aligns: ['good'],
      net: 'seed',
      describe: function () { return { kind: 'sky-laser-strike' }; },
      mount: function (container, ctx) {
        return new Promise(function (resolve) {
          var depth = Math.max(1, ctx.depth | 0);
          var motion = motionOn();
          var waves = buildWaves(ctx.rng, depth);

          /* seeded ambience: stars + skyline, fixed draw order (seeded-sim) */
          var stars = [];
          for (var si = 0; si < 46; si++) {
            stars.push({ x: ctx.rng(), y: ctx.rng() * 0.62, tw: ctx.rng() * TAU });
          }
          var buildings = [];
          for (var bi = 0; bi < 14; bi++) {
            buildings.push({ h: 0.03 + ctx.rng() * 0.075, w: 0.05 + ctx.rng() * 0.06 });
          }
          var orbit = {
            rx: 0.17 + ctx.rng() * 0.11,
            ry: 0.035 + ctx.rng() * 0.03,
            omega: 0.55 + ctx.rng() * 0.4,
            phase: ctx.rng() * TAU
          };

          /* ---------- dom ---------- */
          var wrap = document.createElement('div');
          wrap.className = 'stage-view';
          wrap.setAttribute('data-stage', 'sky-laser-strike');
          wrap.setAttribute('role', 'application');
          var head = document.createElement('div');
          head.className = 'iq-sls-head';
          var title = document.createElement('span');
          title.textContent = 'SKY FIRE · DEPTH ' + depth;
          var meta = document.createElement('span');
          meta.className = 'iq-sls-meta';
          meta.textContent = 'A FRIEND IS UP THERE' +
            (ctx.mp && ctx.mp.on ? ' · SEED-SYNCED' : '');
          var pips = document.createElement('span');
          pips.className = 'iq-sls-pips';
          head.appendChild(title); head.appendChild(meta); head.appendChild(pips);
          var canvas = document.createElement('canvas');
          canvas.setAttribute('aria-label',
            'city overview — mark the hostile drones, spare the civilians');
          var foot = document.createElement('div');
          foot.className = 'iq-sls-foot';
          foot.textContent = 'WATCH THE SKY…';
          wrap.appendChild(head); wrap.appendChild(canvas); wrap.appendChild(foot);
          var style = document.createElement('style');
          style.textContent =
            '.stage-view[data-stage=sky-laser-strike]{position:absolute;inset:0;' +
            'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
            "gap:8px;font-family:'Oxanium',monospace;background:#050d26;color:#bfeaff}" +
            '.iq-sls-head{display:flex;gap:18px;align-items:baseline;font-size:13px;' +
            'letter-spacing:.22em;color:#66e0ff;text-transform:uppercase}' +
            '.iq-sls-meta{color:#3aa0ff;font-size:11px}' +
            '.iq-sls-pips{color:#ffb01e;font-size:12px;letter-spacing:.35em}' +
            '.iq-sls-foot{font-size:12px;letter-spacing:.18em;color:#8fb8e8;' +
            'min-height:32px;text-align:center;text-transform:uppercase}';
          wrap.appendChild(style);
          container.appendChild(wrap);

          /* ---------- audio (lazy, IQB_MUTED-gated) ---------- */
          var actx = null;
          function beep(freq, ms, type, vol) {
            if (muted()) return;
            try {
              if (!actx) {
                var AC = root.AudioContext || root.webkitAudioContext;
                if (!AC) return;
                actx = new AC();
              }
              var o = actx.createOscillator(), g = actx.createGain();
              o.type = type || 'square'; o.frequency.value = freq;
              g.gain.setValueAtTime(vol || 0.05, actx.currentTime);
              g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + ms / 1000);
              o.connect(g).connect(actx.destination);
              o.start(); o.stop(actx.currentTime + ms / 1000);
            } catch (e) {}
          }

          /* ---------- sizing ---------- */
          function fit() {
            var w = clamp(container.clientWidth || 520, 240, 640);
            var h = clamp((container.clientHeight || 460) - 76, 260, 500);
            canvas.width = w; canvas.height = h;
          }
          fit();

          /* ---------- state machine ---------- */
          var finished = false, resolved = false;
          var phase = 'intro';           // intro|brief|mark|beam|salute
          var waveIdx = 0;
          var marked = {};               // slot -> true (drones only)
          var vaporizedSlots = {};       // slot -> true, this wave
          var wavesScored = 0;
          var civHits = 0;
          var civPerWave = [0, 0, 0];
          var sel = 0;                   // keyboard selection cursor
          var beams = [];                // {col, born}
          var sparks = [];               // {x,y,born,hue}
          var warns = [];                // {slot,born} civilian-misfire telegraphs
          var fireX = null;              // lane the hero currently strafes
          var saluteT0 = 0;
          var nowFn = function () {
            return (typeof performance !== 'undefined' ? performance.now() : Date.now());
          };
          var t0 = nowFn();
          var rafId = 0;
          var timers = [];

          function later(ms, fn) {
            var id = root.setTimeout(function () { fn(); }, ms);
            timers.push(id);
            return id;
          }
          function clearTimers() {
            for (var i = 0; i < timers.length; i++) root.clearTimeout(timers[i]);
            timers.length = 0;
          }

          function setPips() {
            var s = '';
            for (var i = 0; i < WAVE_COUNT; i++) s += i < wavesScored ? '◆' : '◇';
            pips.textContent = s;
          }

          function curWave() { return waves[waveIdx]; }
          function droneSlots() {
            var out = [];
            var cells = curWave().cells;
            for (var i = 0; i < SLOTS; i++) if (cells[i] === 'drone') out.push(i);
            return out;
          }
          function markedCount() {
            var n = 0;
            for (var k in marked) if (marked.hasOwnProperty(k) && marked[k]) n++;
            return n;
          }

          function startIntro() {
            phase = 'intro';
            foot.textContent = 'HOSTILE DRONES OVER THE CITY — HE NEEDS EYES';
            later(INTRO_MS, function () { startBrief(0); });
          }

          function startBrief(i) {
            if (finished) return;
            waveIdx = i;
            marked = {}; vaporizedSlots = {};
            sel = droneSlots()[0] || 0;
            phase = 'brief';
            foot.textContent = 'WAVE ' + (i + 1) + '/' + WAVE_COUNT +
              ' — MARK ▲ DRONES · SPARE ● CIVILIANS';
            setPips();
            later(BRIEF_MS, function () { startMark(); });
          }

          function startMark() {
            if (finished) return;
            phase = 'mark';
            foot.textContent = 'CLICK THE HOSTILES · SPACE/FIRE WHEN READY';
            later(markMsFor(depth), function () { fireWave(true); });
          }

          /** Toggle a mark (drone) or register a misfire (civilian). */
          function markSlot(slot) {
            if (finished || phase !== 'mark') return false;
            slot = clamp(slot | 0, 0, SLOTS - 1);
            var kind = curWave().cells[slot];
            if (kind === 'drone') {
              if (marked[slot]) {
                delete marked[slot];
                beep(420, 50, 'square', 0.03);
              } else {
                marked[slot] = true;
                beep(760, 55, 'square');
                if (markedCount() >= curWave().drones) {
                  later(AUTO_DELAY, function () { fireWave(false); }); // all marked
                }
              }
              return true;
            }
            if (kind === 'civ') {
              civHits++; civPerWave[waveIdx]++;
              warns.push({ slot: slot, born: nowFn() });
              beep(150, 220, 'sawtooth', 0.06);
              try { if (typeof ctx.banner === 'function') ctx.banner('INNOCENTS BELOW!'); } catch (e) {}
              foot.textContent = 'INNOCENTS BELOW! — WATCH YOUR FIRE (-30)';
              return false;
            }
            return false;
          }

          /** Lane telegraph -> staggered column beams -> vaporize -> next. */
          function fireWave(deadline) {
            if (finished || phase !== 'mark') return;
            phase = 'beam';
            clearTimers();
            var lanes = {};
            for (var k in marked) {
              if (marked.hasOwnProperty(k) && marked[k]) lanes[colOf(+k)] = true;
            }
            var cols = Object.keys(lanes).map(Number).sort(function (a, b) { return a - b; });

            // telegraph shimmer on marked lanes (fairness rail)
            var teleUntil = nowFn() + TELEGRAPH_MS;
            for (var tk in lanes) if (lanes.hasOwnProperty(tk)) lanes[tk] = teleUntil;

            if (!cols.length) {
              foot.textContent = 'NO MARKS — THE DRONES SLIP AWAY';
              later(700, endWave);
              return;
            }
            foot.textContent = 'HOLD ON — HE SEES YOUR MARKS';
            try { if (!muted()) beep(220, 120, 'triangle', 0.04); } catch (e) {}

            cols.forEach(function (col, i) {
              later(TELEGRAPH_MS + i * BEAM_GAP, function () {
                if (finished) return;
                beams.push({ col: col, born: nowFn() });
                fireX = col;
                beep(920, 240, 'sawtooth', 0.05);
                try { if (motion && ctx.fx && typeof ctx.fx.shake === 'function') ctx.fx.shake(4); } catch (e) {}
              });
              later(TELEGRAPH_MS + i * BEAM_GAP + Math.round(BEAM_MS * 0.45), function () {
                if (finished) return;
                var cells = curWave().cells;
                for (var s = 0; s < SLOTS; s++) {
                  if (marked[s] && colOf(s) === col) {
                    delete marked[s];
                    vaporizedSlots[s] = true;
                    sparks.push({ slot: s, born: nowFn() });
                  }
                }
              });
            });
            later(TELEGRAPH_MS + cols.length * BEAM_GAP + 480, function () {
              if (vaporizedCount() > 0) wavesScored++;
              setPips();
              endWave();
            });
          }

          function vaporizedCount() {
            var n = 0;
            for (var k in vaporizedSlots) {
              if (vaporizedSlots.hasOwnProperty(k) && vaporizedSlots[k]) n++;
            }
            return n;
          }

          function endWave() {
            if (finished) return;
            beams.length = 0; fireX = null;
            if (waveIdx + 1 >= WAVE_COUNT) startSalute();
            else startBrief(waveIdx + 1);
          }

          function startSalute() {
            if (finished) return;
            phase = 'salute';
            saluteT0 = nowFn();
            var cc = isCloseCall(civPerWave);
            if (cc) {
              try { if (typeof ctx.banner === 'function') ctx.banner('CLOSE CALL'); } catch (e) {}
              foot.textContent = 'CLOSE CALL — BUT HE CAUGHT EVERY ONE. SALUTE.';
            } else {
              foot.textContent = 'THE CITY BREATHES. HE SALUTES YOU. (+10)';
            }
            if (!muted()) { beep(523, 160, 'triangle'); later(150, function () { beep(784, 260, 'triangle'); }); }
            later(SALUTE_MS, finish);
          }

          /* ---------- resolve (exactly once) ---------- */
          function finish() {
            if (finished) return;
            finished = true;
            clearTimers();
            root.cancelAnimationFrame(rafId);
            root.removeEventListener('keydown', onKey, true);
            canvas.removeEventListener('pointerdown', onPointer);
            root.removeEventListener('resize', fit);
            var v = verdictFor(wavesScored, civHits, isCloseCall(civPerWave));
            foot.textContent = v.summary;
            var result = {
              kind: 'score',
              correct: v.correct,
              points: v.points,
              hpDelta: v.hpDelta,
              summary: v.summary
            };
            if (!resolved) { resolved = true; resolve(result); }
          }

          later(CAP_MS, finish); // self-resolve watchdog (no fail state: still a save)

          /* ---------- geometry ---------- */
          function geom() {
            var W = canvas.width, H = canvas.height;
            var gx = W * 0.07, gw = W * 0.86;
            var gy = H * 0.36, gh = H * 0.42;
            return {
              W: W, H: H,
              gx: gx, gy: gy, gw: gw, gh: gh,
              cw: gw / COLS, ch: gh / ROWS,
              colX: function (c) { return gx + (c + 0.5) * (gw / COLS); },
              slotXY: function (s) {
                return {
                  x: gx + (colOf(s) + 0.5) * (gw / COLS),
                  y: gy + (rowOf(s) + 0.5) * (gh / ROWS)
                };
              },

              groundY: gy + gh + 14
            };
          }
          function heroPos(g, tSec) {
            if (!motion) {
              return { x: g.W * 0.5, y: g.H * 0.155, saluting: phase === 'salute' };
            }
            if (phase === 'salute') {
              return { x: g.W * 0.5, y: g.H * 0.155, saluting: true };
            }
            if (phase === 'beam') {
              var tx = fireX != null ? g.colX(fireX) : g.W * 0.5;
              return { x: tx, y: g.H * 0.155, saluting: false };
            }
            return {
              x: g.W * 0.5 + Math.cos(tSec * orbit.omega + orbit.phase) * g.W * orbit.rx,
              y: g.H * 0.155 + Math.sin(tSec * orbit.omega * 1.7 + orbit.phase) * g.H * orbit.ry,
              saluting: false
            };
          }

          /* ---------- render ---------- */
          function drawGlyphDrone(g, x, y, sz, tSec, isMarked, gone) {
            if (gone) { // vaporized: fading scorch ring
              g.strokeStyle = 'rgba(255,176,30,.35)';
              g.lineWidth = 2;
              g.beginPath(); g.arc(x, y, sz * 0.5, 0, TAU); g.stroke();
              return;
            }
            g.lineWidth = 2;
            g.strokeStyle = isMarked ? PAL.gold : PAL.danger;
            g.fillStyle = isMarked ? 'rgba(255,176,30,.22)' : 'rgba(255,32,56,.16)';
            // angular chevron hull
            g.beginPath();
            g.moveTo(x - sz * 0.55, y - sz * 0.28);
            g.lineTo(x, y + sz * 0.42);
            g.lineTo(x + sz * 0.55, y - sz * 0.28);
            g.lineTo(x, y - sz * 0.02);
            g.closePath();
            g.fill(); g.stroke();
            // rotor dots (silhouette cue, never hue alone)
            g.fillStyle = isMarked ? PAL.gold : PAL.pale;
            g.beginPath(); g.arc(x - sz * 0.62, y - sz * 0.34, sz * 0.09, 0, TAU); g.fill();
            g.beginPath(); g.arc(x + sz * 0.62, y - sz * 0.34, sz * 0.09, 0, TAU); g.fill();
            // core blink (motion-gated)
            var blink = motion ? 0.55 + 0.45 * Math.sin(tSec * 6 + x) : 0.8;
            g.globalAlpha = blink;
            g.fillStyle = PAL.white;
            g.beginPath(); g.arc(x, y + sz * 0.08, sz * 0.1, 0, TAU); g.fill();
            g.globalAlpha = 1;
            if (isMarked) { // reticle
              g.strokeStyle = PAL.gold; g.lineWidth = 1.5;
              g.strokeRect(x - sz * 0.72, y - sz * 0.66, sz * 1.44, sz * 1.32);
            }
          }

          function drawGlyphCiv(g, x, y, sz, warnAge) {
            g.fillStyle = '#ffd9a0';
            // round head (silhouette cue vs angular drone)
            g.beginPath(); g.arc(x, y - sz * 0.26, sz * 0.24, 0, TAU); g.fill();
            // shoulders
            g.beginPath();
            g.moveTo(x - sz * 0.3, y + sz * 0.42);
            g.quadraticCurveTo(x, y - sz * 0.06, x + sz * 0.3, y + sz * 0.42);
            g.closePath(); g.fill();
            if (warnAge != null && warnAge < 200) { // localized <=200 ms pulse
              g.globalAlpha = 1 - warnAge / 200;
              g.strokeStyle = PAL.danger; g.lineWidth = 3;
              g.beginPath(); g.arc(x, y, sz * (0.55 + warnAge / 200), 0, TAU); g.stroke();
              g.globalAlpha = 1;
            } else {
              g.strokeStyle = 'rgba(255,217,160,.35)'; g.lineWidth = 1;
              g.beginPath(); g.arc(x, y, sz * 0.55, 0, TAU); g.stroke();
            }
          }

          function drawHero(g, hx, hy, saluting, tSec) {
            var s = Math.max(14, canvas.width * 0.032); // NOTE: canvas, not ctx — no .W
            // cape (flutter gated by motion)
            var flap = motion ? Math.sin(tSec * 5) * s * 0.16 : 0;
            g.fillStyle = PAL.danger;
            g.beginPath();
            g.moveTo(hx - s * 0.28, hy - s * 0.3);
            g.quadraticCurveTo(hx - s * (0.95 + flap), hy + s * 0.2, hx - s * 0.3, hy + s * 1.05);
            g.lineTo(hx + s * 0.3, hy + s * 1.05);
            g.quadraticCurveTo(hx + s * (0.95 + flap), hy + s * 0.2, hx + s * 0.28, hy - s * 0.3);
            g.closePath(); g.fill();
            // suit
            g.fillStyle = PAL.suit;
            g.fillRect(hx - s * 0.24, hy - s * 0.25, s * 0.48, s * 1.0);
            // head
            g.fillStyle = '#f0c896';
            g.beginPath(); g.arc(hx, hy - s * 0.48, s * 0.26, 0, TAU); g.fill();
            if (saluting) { // raised forearm + fist
              g.strokeStyle = PAL.suit; g.lineWidth = Math.max(3, s * 0.16);
              g.beginPath();
              g.moveTo(hx + s * 0.2, hy + s * 0.1);
              g.lineTo(hx + s * 0.62, hy - s * 0.72);
              g.stroke();
              g.fillStyle = '#f0c896';
              g.beginPath(); g.arc(hx + s * 0.64, hy - s * 0.82, s * 0.13, 0, TAU); g.fill();
            }
          }

          function draw() {
            if (finished) return;
            var g2 = canvas.getContext('2d');
            var g = geom();
            var tSec = (nowFn() - t0) / 1000;
            var now = nowFn();

            // sky
            var grad = g2.createLinearGradient(0, 0, 0, g.H);
            grad.addColorStop(0, '#050d26');
            grad.addColorStop(0.65, PAL.night);
            grad.addColorStop(1, PAL.dusk);
            g2.fillStyle = grad;
            g2.fillRect(0, 0, g.W, g.H);

            // stars (twinkle gated)
            for (var i = 0; i < stars.length; i++) {
              var st = stars[i];
              g2.globalAlpha = motion ? 0.35 + 0.35 * Math.sin(tSec * 2 + st.tw) : 0.5;
              g2.fillStyle = PAL.pale;
              g2.fillRect(st.x * g.W, st.y * g.H, 2, 2);
            }
            g2.globalAlpha = 1;

            // skyline
            var bx = 0;
            g2.fillStyle = '#08122e';
            for (var b = 0; b < buildings.length; b++) {
              var bd = buildings[b];
              var bw = bd.w * g.W;
              g2.fillRect(bx, g.groundY - bd.h * g.H, bw, bd.h * g.H + g.H);
              bx += bw;
            }

            // lane guides + beam gutters
            for (var c = 0; c < COLS; c++) {
              var cx = g.colX(c);
              g2.strokeStyle = 'rgba(102,224,255,.10)';
              g2.lineWidth = 1;
              g2.beginPath(); g2.moveTo(cx, g.gy - 8); g2.lineTo(cx, g.groundY); g2.stroke();
            }

            // telegraph shimmer on armed lanes (pre-fire fairness rail)

            var teleActive = phase === 'beam' && beams.length === 0 &&
              now - beamTeleStart() < TELEGRAPH_MS;
            if (teleActive) {
              g2.fillStyle = 'rgba(102,224,255,' + (0.05 + 0.05 * Math.sin(tSec * 18)) + ')';
              for (var mk in marked) {
                if (marked.hasOwnProperty(mk) && marked[mk]) {
                  var tx = g.colX(colOf(+mk));
                  g2.fillRect(tx - g.cw * 0.28, g.gy - 8, g.cw * 0.56, g.gh + 22);
                }
              }
            }

            // glyphs
            var cells = curWave().cells;
            var csz = Math.min(g.cw, g.ch) * 0.62;
            for (var s = 0; s < SLOTS; s++) {
              var p = g.slotXY(s);
              if (cells[s] === 'drone') {
                var gone = vaporizedSlots[s] === true;
                var age = gone ? now - vaporBorn(s) : 0;
                if (!gone || age < 900) {
                  drawGlyphDrone(g2, p.x, p.y, csz, tSec, marked[s] === true, gone);
                }
              } else if (cells[s] === 'civ') {
                var wAge = Infinity;
                for (var wi = 0; wi < warns.length; wi++) {
                  if (warns[wi].slot === s) wAge = now - warns[wi].born;
                }
                drawGlyphCiv(g2, p.x, p.y, csz, wAge);
              }
            }

            // keyboard selection cursor
            if (phase === 'mark') {
              var sp = g.slotXY(sel);
              g2.strokeStyle = PAL.pale; g2.lineWidth = 1.5;
              g2.setLineDash([4, 4]);
              g2.strokeRect(sp.x - csz * 0.85, sp.y - csz * 0.85, csz * 1.7, csz * 1.7);
              g2.setLineDash([]);
            }

            // heat-vision beams: COLUMN GUTTERS ONLY — never fullscreen
            for (var bi2 = 0; bi2 < beams.length; bi2++) {
              var bm = beams[bi2];
              var ageB = now - bm.born;
              if (ageB > BEAM_MS + 150) continue;
              var bx2 = g.colX(bm.col);
              var hot = ageB < 150 ? 1 : Math.max(0, 1 - (ageB - 150) / (BEAM_MS - 65));
              var coreW = g.cw * (0.10 + 0.06 * hot);
              var haloW = g.cw * 0.30;
              g2.fillStyle = 'rgba(58,160,255,' + (0.22 * hot) + ')';
              g2.fillRect(bx2 - haloW / 2, g.H * 0.1, haloW, g.groundY - g.H * 0.1);
              g2.fillStyle = 'rgba(191,234,255,' + (0.85 * hot) + ')';
              g2.fillRect(bx2 - coreW / 2, g.H * 0.1, coreW, g.groundY - g.H * 0.1);
              g2.fillStyle = 'rgba(255,255,255,' + (0.95 * hot) + ')';
              g2.fillRect(bx2 - coreW * 0.18, g.H * 0.1, coreW * 0.36, g.groundY - g.H * 0.1);
            }

            // vaporize sparks (particles gated by motion)
            for (var sp2 = 0; sp2 < sparks.length; sp2++) {
              var sk = sparks[sp2];
              var ageS = now - sk.born;
              if (ageS > 450) continue;
              var pp = g.slotXY(sk.slot);
              var frac = ageS / 450;
              g2.globalAlpha = 1 - frac;
              g2.strokeStyle = sp2 % 2 ? PAL.gold : PAL.ice;
              g2.lineWidth = 2;
              var rays = motion ? 5 : 3;
              for (var r = 0; r < rays; r++) {
                var ang = (r / rays) * TAU + sk.slot;
                var r0 = csz * (0.3 + frac * 0.9);
                g2.beginPath();
                g2.moveTo(pp.x + Math.cos(ang) * r0 * 0.5, pp.y + Math.sin(ang) * r0 * 0.5);
                g2.lineTo(pp.x + Math.cos(ang) * r0, pp.y + Math.sin(ang) * r0);
                g2.stroke();
              }
              g2.globalAlpha = 1;
            }

            // hero
            var hp2 = heroPos(g, tSec);
            var hy2 = hp2.y;
            if (phase === 'salute') { // gentle descent into the salute hover
              var sf = clamp((now - saluteT0) / 500, 0, 1);
              hy2 = hp2.y + (motion ? (1 - sf) * -g.H * 0.05 : 0);
            }
            drawHero(g2, hp2.x, hy2, hp2.saluting, tSec);

            // wave counter strip
            g2.fillStyle = PAL.pale;
            g2.font = "11px 'Oxanium',monospace";
            g2.textAlign = 'left';
            g2.fillText('WAVE ' + (waveIdx + 1) + '/' + WAVE_COUNT +
              ' · HOSTILES ' + markedCount() + '/' + curWave().drones, 8, 14);

            rafId = root.requestAnimationFrame(draw);
          }

          var teleT0 = 0;
          function beamTeleStart() { return teleT0; }
          // stamp telegraph start whenever beam phase opens
          var _origFire = fireWave;
          fireWave = function (deadline) {
            teleT0 = nowFn();
            _origFire(deadline);
          };

          function vaporBorn(slot) {
            // sparks carry the birth stamp; reuse for scorch fade
            for (var i = 0; i < sparks.length; i++) {
              if (sparks[i].slot === slot) return sparks[i].born;
            }
            return nowFn() - 900;
          }

          /* ---------- input ---------- */
          function cellFromEvent(e) {
            var rect = canvas.getBoundingClientRect();
            var sx = (e.clientX - rect.left) * (canvas.width / rect.width);
            var sy = (e.clientY - rect.top) * (canvas.height / rect.height);
            var g = geom();
            if (sx < g.gx || sx > g.gx + g.gw || sy < g.gy || sy > g.gy + g.gh) return -1;
            var col = clamp(Math.floor((sx - g.gx) / g.cw), 0, COLS - 1);
            var row = clamp(Math.floor((sy - g.gy) / g.ch), 0, ROWS - 1);
            return row * COLS + col;
          }
          function onPointer(e) {
            e.preventDefault();
            var slot = cellFromEvent(e);
            if (slot >= 0) { sel = slot; markSlot(slot); }
          }
          function onKey(e) {
            var code = e.code || '';
            var move = 0;
            if (code === 'ArrowRight' || code === 'KeyD') move = 1;
            else if (code === 'ArrowLeft' || code === 'KeyA') move = -1;
            else if (code === 'ArrowDown' || code === 'KeyS') move = COLS;
            else if (code === 'ArrowUp' || code === 'KeyW') move = -COLS;
            if (move) {
              e.preventDefault();
              sel = clamp(sel + move, 0, SLOTS - 1);
              return;
            }
            if (code === 'Enter' || code === 'KeyE') {
              e.preventDefault();
              markSlot(sel);
            } else if (code === 'Space' || code === 'KeyF') {
              e.preventDefault();
              fireWave(false);
            }
          }
          root.addEventListener('keydown', onKey, true);
          canvas.addEventListener('pointerdown', onPointer);
          root.addEventListener('resize', fit);

          /* ---------- self-play / smoke hooks ---------- */
          root.__SKYLASER__ = {
            markSlot: markSlot,
            fire: function () { fireWave(false); },
            finish: finish,
            state: function () {
              var cells = [];
              for (var i = 0; i < SLOTS; i++) cells.push(curWave().cells[i]);
              var mk = [];
              for (var kk in marked) {
                if (marked.hasOwnProperty(kk) && marked[kk]) mk.push(+kk);
              }
              return {
                phase: phase, wave: waveIdx, cells: cells,
                markedCount: markedCount(), marked: mk, drones: curWave().drones,
                wavesScored: wavesScored, civHits: civHits,
                civPerWave: civPerWave.slice(),
                resolved: resolved, finished: finished,
                elapsedMs: Math.round(nowFn() - t0), motionOn: motion
              };
            }
          };

          rafId = root.requestAnimationFrame(draw);
          setPips();
          startIntro();
        });
      },
      cleanup: function () {
        // engine abort path: finish() owns listener/timer teardown; when
        // cleanup races a live mount the watchdog settles the promise.
      }
    };
  }

  /* ======================================================================
   * HEADLESS SMOKE — pure paths only (no DOM). node -e "..._smoke()"
   * ====================================================================== */
  function _smoke() {
    var checks = [];
    var ok = function (name, cond) { checks.push({ name: name, ok: !!cond }); };
    function mulberry(a) {
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t ^ (t >>> 14)) >>> 0;
        return t / 4294967296;
      };
    }

    // 1. scaling curves
    ok('drones 3 at depth 1', droneCountFor(1) === 3);
    ok('drones clamp at 6 deep', droneCountFor(99) === 6);
    ok('civs 2 at depth 1', civCountFor(1) === 2);
    ok('civs clamp at 5 deep', civCountFor(99) === 5);
    ok('mark window 4400ms at depth 1', markMsFor(1) === 4400);
    ok('mark window floors 2600ms', markMsFor(99) === 2600);

    // 2. layout determinism + integrity
    var a = buildWaves(mulberry(1234), 4), b = buildWaves(mulberry(1234), 4);
    ok('same seed -> identical waves', JSON.stringify(a) === JSON.stringify(b));
    var c = buildWaves(mulberry(77), 9);
    var layoutOk = true;
    for (var w = 0; w < WAVE_COUNT; w++) {
      var dr = 0, cv = 0;
      for (var s = 0; s < SLOTS; s++) {
        if (c[w].cells[s] === 'drone') dr++;
        else if (c[w].cells[s] === 'civ') cv++;
      }
      if (dr !== c[w].drones || cv !== c[w].civs) layoutOk = false;
    }
    ok('every wave places exact drone+civ counts', layoutOk);
    ok('waves differ across the set (shuffled)', JSON.stringify(a[0]) !== JSON.stringify(a[1]));

    // 3. grid math
    ok('colOf wraps rows', colOf(7) === 2 && rowOf(7) === 1 && colOf(14) === 4 && rowOf(14) === 2);

    // 4. scoring economics
    ok('wave pays +60 on any vaporize', wavePoints(1) === 60 && wavePoints(3) === 60);
    ok('wave pays 0 on a whiff', wavePoints(0) === 0);
    ok('perfect run = 180', tally(3, 0, false) === 180);
    ok('one innocent = 150', tally(3, 1, false) === 150);
    ok('close call halves (90 -> 45)', tally(3, 3, true) === 45);
    ok('close call rounds -90 -> -45', tally(0, 3, true) === -45);
    ok('whiffed all, no civs = 0', tally(0, 0, false) === 0);

    // 5. close-call rule needs a misfire in EVERY wave
    ok('close call: 1/1/1', isCloseCall([1, 1, 1]) === true);
    ok('not close call: 2/0/1', isCloseCall([2, 0, 1]) === false);
    ok('not close call: 0/0/0', isCloseCall([0, 0, 0]) === false);

    // 6. verdict mapping — always a save, always heals +10
    var v1 = verdictFor(3, 0, false), v2 = verdictFor(3, 3, true), v3 = verdictFor(0, 0, false);
    ok('always correct:true', v1.correct === true && v2.correct === true && v3.correct === true);
    ok('always hpDelta:+10', v1.hpDelta === 10 && v2.hpDelta === 10 && v3.hpDelta === 10);
    ok('clean sweep points 180', v1.points === 180);
    ok('close call points 45', v2.points === 45 && /CLOSE CALL/.test(v2.summary));
    ok('lonely save points 0', v3.points === 0);
    [v1, v2, v3, verdictFor(2, 1, false), verdictFor(1, 2, false)].forEach(function (v) {
      ok('summary <=48 chars: "' + v.summary + '"', v.summary.length <= 48);
    });

    var fails = checks.filter(function (ck) { return !ck.ok; });
    checks.forEach(function (ck) { console.log((ck.ok ? '  ok  ' : 'FAIL  ') + ck.name); });
    console.log(fails.length ? '[skylaser] smoke FAILURES: ' + fails.length : '[skylaser] smoke: ALL PASS');
    return { ok: fails.length === 0, checks: checks };
  }

  /* ---------- registration (queues when Stage absent) ---------- */
  function register() {
    var d = def();
    if (root.IQ && root.IQ.Stage && typeof root.IQ.Stage.register === 'function') {
      root.IQ.Stage.register(d);
    } else {
      root.__stagePending = root.__stagePending || [];
      root.__stagePending.push(d);
    }
  }

  root.IQ = root.IQ || {};
  root.IQ.SkyLaserStrike = { _smoke: _smoke };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      _smoke: _smoke,
      buildWaves: buildWaves, tally: tally, verdictFor: verdictFor,
      wavePoints: wavePoints, isCloseCall: isCloseCall,
      droneCountFor: droneCountFor, civCountFor: civCountFor,
      markMsFor: markMsFor, colOf: colOf, rowOf: rowOf
    };
  }

  register();
})();
