/* pack-hunters.js — PackHunters wave: 8 themed GAMEPLAY packs for iqbattle.
 *
 * Registers via window.IQ.Hooks.add(pack) per hooks.js contract:
 *   pack = { id, worlds?:[ids] | always:true, weight?, handlers:{
 *     onRoundStart?(ctx), onTick?(ctx), onPreAnswer?(ctx),
 *     onAnswer?(ctx), onReveal?(ctx), onInterlude?(ctx) } }
 *   ctx = { round, world, align, hp, score, streak, timerLen, optCount, rng, runId }
 *   onAnswer ctx gains res = { correct, picked, correctIdx }.
 *   Handlers return optional modifiers:
 *   { hpDelta, scoreMul, timerDelta, disableOptionIdx:[int], invertControlsMs,
 *     overlayHTML, bannerText, pickup:{kind,value}, sfx, flag }
 *   Shared per-run store: IQ.Hooks.state.get(k)/set(k,v) — keys prefixed 'packhunters:'.
 *
 * ASSUMPTIONS (hooks.js was still landing when this file was written; agreed
 * with HooksCore via hub):
 *   A1. onPreAnswer may return { forceWrong:true } -> engine scores the picked
 *       answer as WRONG regardless of correctness (used by red-light-green-light).
 *   A2. Modifier field disableWrongRandom:<n> -> engine disables n DISTINCT
 *       RANDOM WRONG options (never the correct one) — used by floor-fall and
 *       sky-laser. Needed because ctx deliberately hides correctIdx pre-reveal.
 *   A3. Modifiers returned from onAnswer apply to THAT answer's scoring/hp.
 *   A4. Engine clears overlay/banner between rounds; overlays render inside a
 *       board-relative layer (position:absolute coordinates are board-local).
 *   A5. onTick fires repeatedly during a round; dt is derived locally from
 *       performance.now() deltas (clamped to 250ms against tab stalls).
 * Fallbacks: if IQ.Hooks is absent we install a stub whose add() queues packs
 * (drainable via IQ.Hooks._q); if IQ.Hooks.state is absent we install a
 * guarded file-local shim — whichever definition lands later simply wins
 * because ALL access goes through window.IQ.Hooks.state dynamically.
 */
(function () {
  'use strict';

  var IQ = (window.IQ = window.IQ || {});

  /* ---- guarded Hooks/state fallbacks (see header A-note) ---------------- */

  if (!IQ.Hooks || typeof IQ.Hooks.add !== 'function') {
    console.warn('[pack-hunters] IQ.Hooks absent — installing stub queue + state fallback.');
    IQ.Hooks = IQ.Hooks || {};
    IQ.Hooks.add = function (pack) { (IQ.Hooks._q = IQ.Hooks._q || []).push(pack); };
  }
  if (!IQ.Hooks.state) {
    /* Per-run keyed scratch store fallback. Real hooks.js version replaces
     * this freely; we always call through window.IQ.Hooks.state. */
    var mem = Object.create(null);
    IQ.Hooks.state = {
      _run: null,
      reset: function (runId) { this._run = runId; mem = Object.create(null); },
      get: function (k) { return mem[k]; },
      set: function (k, v) { mem[k] = v; }
    };
  }

  /* ---- shared helpers --------------------------------------------------- */

  function nowMs() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  /* Per-round runtime records, keyed '<runId>#<round>'. */
  var rt = Object.create(null);

  function rec(owner, ctx, seed) {
    var k = ctx.runId + '#' + ctx.round + '@' + owner;
    if (!seed) seed = {}; /* lazy onTick creation: benign empty record */
    if (!rt[k]) {
      /* prune THIS pack's stale-round records only — never siblings'
       * records that share the same runId+round */
      var runPre = ctx.runId + '#';
      var ownSuf = '@' + owner;
      for (var old in rt) {
        if (old !== k && old.indexOf(runPre) === 0 && old.slice(-ownSuf.length) === ownSuf) delete rt[old];
      }
      rt[k] = seed;
      rt[k].clock = 0;
      rt[k].last = nowMs();
      rt[k].sig = null; /* last emitted overlay/banner signature */
    }
    return rt[k];
  }

  /* Advance + return clamped seconds since previous tick for this record. */
  function step(r) {
    var t = nowMs();
    var dt = Math.min((t - r.last) / 1000, 0.25);
    r.last = t;
    r.clock += dt;
    return dt;
  }

  /* Emit overlay/banner only when content actually changes (avoids churn). */
  function vis(r, overlayHTML, bannerText) {
    var sig = (overlayHTML || '') + '\u0000' + (bannerText || '');
    if (sig === r.sig) return null; /* engine ignores null returns */
    r.sig = sig;
    return { overlayHTML: overlayHTML || '', bannerText: bannerText || '' };
  }

  function inWindows(r, pad) {
    if (!r.windows) return false;
    for (var i = 0; i < r.windows.length; i++) {
      var w = r.windows[i];
      if (r.clock >= w[0] && r.clock <= w[1] + (pad || 0)) return true;
    }
    return false;
  }

  /* ---- 1. hunter-beam (world: cyber-hunter) ------------------------------
   * Sweeps a targeting lock across the option slots; while the beam STANDS on
   * a slot, clicks on it are disabled (escalating sweep speed by round depth).
   * MODIFIERS USED: disableOptionIdx:[i] (standing-beam click lockdown),
   * overlayHTML (target-lock strip), bannerText (lock announcements). */
  function beamSeed(ctx) {
    var depth = Math.max(1, ctx.round | 0);
    var esc = 1 + 0.16 * Math.min(depth - 1, 14);        /* escalation curve */
    return {
      dwell: 2.0 / esc,                                   /* stand ~= 2s at depth 1 */
      travel: Math.max(0.28, 0.55 / esc),                 /* sweep between slots */
      slot: -1, mode: ''
    };
  }
  IQ.Hooks.add({
    id: 'hunter-beam',
    worlds: ['cyber-hunter'],
    weight: 1,
    handlers: {
      onRoundStart: function (ctx) {
        rec('hunter-beam', ctx, beamSeed(ctx));
        return null;
      },
      onTick: function (ctx) {
        var r = rec('hunter-beam', ctx, null);
        if (r.dwell === undefined) Object.assign(r, beamSeed(ctx)); /* lazy self-heal */
        step(r);
        if (r.mode === 'stand') {
          if (r.clock >= r.dwell) { r.clock = 0; r.mode = 'move'; }
        } else {
          if (r.clock >= r.travel) { r.clock = 0; r.mode = 'stand'; r.slot = ((r.slot + 1) % ctx.optCount); }
        }
        var standing = r.mode === 'stand';
        if (!standing) {
          /* sweeping: re-enable clicks; emit the clear exactly once */
          if (r.beamSig === 'M') return null;
          r.beamSig = 'M';
          return { disableOptionIdx: [], overlayHTML: '', bannerText: '' };
        }
        var first = r.beamSig !== 'S' + r.slot;
        r.beamSig = 'S' + r.slot;
        /* lockdown MUST be re-asserted every tick of the dwell window */
        var m = {
          disableOptionIdx: [r.slot],
          overlayHTML: '<div style="position:absolute;top:6px;left:50%;transform:translateX(-50%);' +
            'font:700 11px monospace;color:#ff2244;background:rgba(20,4,26,.78);border:1px solid #ff2244;' +
            'padding:2px 9px;border-radius:3px;pointer-events:none;letter-spacing:.08em">' +
            '\u25C8 TARGET LOCK \u00B7 OPTION ' + (r.slot + 1) + '</div>'
        };
        if (first) m.bannerText = 'BEAM LOCKED ON OPTION ' + (r.slot + 1);
        return m;
      }
    }
  });

  /* ---- 2. red-light-green-light (world: doll-game) -----------------------
   * Seeded GO/STOP cadence. Answering during STOP auto-fails the picked
   * answer and stings 10 hp. Visual state via banner + tint veil only.
   * MODIFIERS USED: forceWrong (onPreAnswer: picked answer auto-fails),
   * hpDelta:-10 (STOP violation), bannerText/overlayHTML (GO/STOP state). */
  IQ.Hooks.add({
    id: 'red-light-green-light',
    worlds: ['doll-game'],
    weight: 1,
    handlers: {
      onRoundStart: function (ctx) {
        var wins = [];
        var t = 0;
        while (t < ctx.timerLen + 2) {
          var go = 1.8 + ctx.rng() * 2.2;
          var stop = 1.2 + ctx.rng() * 1.8;
          wins.push([t, t]);                 /* GO window (marker) */
          wins.push([t + go, t + go + stop]);/* STOP window */
          t += go + stop;
        }
        var r = rec('red-light-green-light', ctx, { windows: wins });
        r.goSet = true;
        return null;
      },
      onTick: function (ctx) {
        var r = rec('red-light-green-light', ctx, null);
        step(r);
        var stop = false;
        if (!r.windows) return null; /* round start never ran */
        for (var i = 0; i < r.windows.length; i++) {
          var w = r.windows[i];
          if (r.clock >= w[0] && r.clock < w[1]) { stop = (i % 2 === 1); break; }
        }
        if (stop === r.wasStop) return null;
        r.wasStop = stop;
        if (stop) {
          return {
            bannerText: 'RED LIGHT \u2014 DO NOT ANSWER',
            overlayHTML: '<div style="position:absolute;inset:0;background:rgba(229,106,153,.16);' +
              'box-shadow:inset 0 0 60px rgba(229,106,153,.35);pointer-events:none"></div>'
          };
        }
        return {
          bannerText: 'GREEN LIGHT \u2014 GO',
          overlayHTML: '<div style="position:absolute;inset:0;box-shadow:inset 0 0 40px rgba(122,212,143,.18);' +
            'pointer-events:none"></div>'
        };
      },
      onPreAnswer: function (ctx) {
        var r = rec('red-light-green-light', ctx, null);
        var stop = false;
        if (!r.windows) return null; /* round start never ran */
        for (var i = 0; i < r.windows.length; i++) {
          var w = r.windows[i];
          if (r.clock >= w[0] && r.clock < w[1]) { stop = (i % 2 === 1); break; }
        }
        if (!stop) return null;
        return {
          forceWrong: true,   /* ASSUMPTION A1: picked answer auto-fails */
          hpDelta: -10,
          bannerText: 'YOU MOVED ON A RED LIGHT \u2014 ELIMINATING\u2026 HP \u221210'
        };
      }
    }
  });

  /* ---- 3. floor-fall (any BAD world, low weight) -------------------------
   * Over round time, random WRONG tiles drop away one by one (an aid), each
   * fall costing 2s of timer (the pressure). Never touches the correct slot.
   * MODIFIERS USED: disableWrongRandom:1 per fall (engine-safe wrong-slot
   * drop, ASSUMPTION A2), timerDelta:-2 per fall, bannerText on collapse. */
  IQ.Hooks.add({
    id: 'floor-fall',
    always: true,
    weight: 0.4,
    handlers: {
      onRoundStart: function (ctx) {
        if (ctx.align !== 'bad') return null; /* bad worlds only */
        var gap = Math.max(ctx.timerLen / 9, 2.5);
        var times = [];
        for (var t = ctx.timerLen * 0.3; t < ctx.timerLen * 0.95 && times.length < 4; t += gap) {
          times.push(t);
        }
        rec('floor-fall', ctx, { falls: times, done: 0 });
        return null;
      },
      onTick: function (ctx) {
        var r = rec('floor-fall', ctx, null);
        if (!r.falls || r.done >= r.falls.length) return null;
        step(r);
        if (r.clock < r.falls[r.done]) return null;
        r.done++;
        var left = r.falls.length - r.done;
        return {
          disableWrongRandom: 1,                       /* one more wrong tile drops */
          timerDelta: -2,                              /* pressure: 2s off the clock */
          bannerText: 'THE FLOOR GIVES WAY \u00B7 \u22122s' + (left > 0 ? ' \u00B7 ' + left + ' MORE COMING' : '')
        };
      }
    }
  });

  /* ---- 4. sky-laser (world: sky-laser, good spectacle) -------------------
   * At 50% timer the sky lance fires ONCE, permanently vaporizing one WRONG
   * option — a big, showy assist.
   * MODIFIERS USED: disableWrongRandom:1 once per round (ASSUMPTION A2),
   * overlayHTML (lance strike strip), bannerText (vaporize callout). */
  IQ.Hooks.add({
    id: 'sky-laser',
    worlds: ['sky-laser'],
    weight: 1,
    handlers: {
      onRoundStart: function (ctx) {
        rec('sky-laser', ctx, { half: ctx.timerLen * 0.5, fired: false });
        return null;
      },
      onTick: function (ctx) {
        var r = rec('sky-laser', ctx, null);
        if (r.half === undefined) return null; /* round start never ran */
        if (r.fired) return null;
        step(r);
        if (r.clock < r.half) return null;
        r.fired = true;
        return {
          disableWrongRandom: 1,
          overlayHTML: '<div style="position:absolute;left:0;right:0;top:38%;height:3px;' +
            'background:linear-gradient(90deg,transparent,#bfeaff 15%,#ffffff 50%,#bfeaff 85%,transparent);' +
            'box-shadow:0 0 14px #66e0ff;pointer-events:none"></div>',
          bannerText: 'SKY LANCE STRIKE \u2014 ONE FALSE PATH VAPORIZED'
        };
      }
    }
  });

  /* ---- 5. sandstorm (world: wasteland-roads) -----------------------------
   * Two 1.5s visibility brownouts: a dust veil dims the board. Pure pressure
   * — nothing is disabled and no time is taken.
   * MODIFIERS USED: overlayHTML only (translucent dust veil over the board). */
  IQ.Hooks.add({
    id: 'sandstorm',
    worlds: ['wasteland-roads'],
    weight: 1,
    handlers: {
      onRoundStart: function (ctx) {
        var L = ctx.timerLen;
        var a = L * 0.25 + ctx.rng() * (L * 0.25);
        var b = L * 0.58 + ctx.rng() * (L * 0.24);
        b = Math.min(b, L - 2);
        rec('sandstorm', ctx, { windows: [[a, a + 1.5], [b, b + 1.5]] });
        return null;
      },
      onTick: function (ctx) {
        var r = rec('sandstorm', ctx, null);
        step(r);
        var storm = inWindows(r);
        if (storm === r.wasStorm) return null;
        r.wasStorm = storm;
        if (storm) {
          return {
            overlayHTML: '<div style="position:absolute;inset:0;background:rgba(214,164,90,.44);' +
              'box-shadow:inset 0 0 90px rgba(138,74,18,.6);pointer-events:none">' +
              '<div style="position:absolute;top:8px;left:50%;transform:translateX(-50%);' +
              'font:700 11px monospace;color:#4a2c12;letter-spacing:.14em;pointer-events:none">' +
              'SANDSTORM</div></div>'
          };
        }
        return { overlayHTML: '' }; /* veil lifts */
      }
    }
  });

  /* ---- 6. venom-party (world: symbiote-party) ----------------------------
   * 'Venom surge' windows (seeded, 2 per round): correct answers inside a
   * surge score x1.5; wrong answers inside a surge sting 5 extra hp.
   * MODIFIERS USED: scoreMul:1.5 (surge kill), hpDelta:-5 (surge sting),
   * bannerText/overlayHTML (surge state). Assumes A3 (applies to that answer). */
  IQ.Hooks.add({
    id: 'venom-party',
    worlds: ['symbiote-party'],
    weight: 1,
    handlers: {
      onRoundStart: function (ctx) {
        var L = ctx.timerLen;
        var a = L * 0.18 + ctx.rng() * (L * 0.2);
        var b = L * 0.55 + ctx.rng() * (L * 0.25);
        rec('venom-party', ctx, { windows: [[a, a + 3.5], [b, Math.min(b + 3.5, L)]] });
        return null;
      },
      onTick: function (ctx) {
        var r = rec('venom-party', ctx, null);
        step(r);
        var surge = inWindows(r);
        if (surge === r.wasSurge) return null;
        r.wasSurge = surge;
        if (surge) {
          return {
            bannerText: 'VENOM SURGE \u2014 CORRECT x1.5 \u00B7 WRONG STINGS \u22125',
            overlayHTML: '<div style="position:absolute;inset:0;box-shadow:inset 0 0 70px rgba(255,255,255,.14);' +
              'border:2px solid rgba(255,255,255,.35);pointer-events:none"></div>'
          };
        }
        return { bannerText: '', overlayHTML: '' };
      },
      onAnswer: function (ctx) {
        var r = rec('venom-party', ctx, null);
        if (!inWindows(r)) return null;
        if (ctx.res && ctx.res.correct) {
          return { scoreMul: 1.5, bannerText: 'SURGE FEAST \u00D71.5' };
        }
        return { hpDelta: -5, bannerText: 'VENOM STING \u00B7 HP \u22125' };
      }
    }
  });

  /* ---- 7. mastermind-mood (world: golden-mastermind) ---------------------
   * Remembers your LAST round via the shared state store. Last answer wrong ->
   * hostile round (-4s on the clock + judgment banner); last right -> calm.
   * MODIFIERS USED: timerDelta:-4 (hostility tax), bannerText (mood verdict);
   * IQ.Hooks.state 'packhunters:mmLast' carries mood across rounds. */
  IQ.Hooks.add({
    id: 'mastermind-mood',
    worlds: ['golden-mastermind'],
    weight: 1,
    handlers: {
      onRoundStart: function (ctx) {
        rec('mastermind-mood', ctx, {});
        var last = IQ.Hooks.state.get('packhunters:mmLast');
        if (last === -1) {
          return {
            timerDelta: -4,
            bannerText: 'THE MASTERMIND REMEMBERS YOUR FAILURE \u00B7 HOSTILE \u00B7 \u22124s'
          };
        }
        if (last === 1 && ctx.round > 1) {
          return { bannerText: 'THE MASTERMIND IS NEUTRAL \u2014 FOR NOW.' };
        }
        return null; /* round 1: no history, no verdict */
      },
      onAnswer: function (ctx) {
        if (!ctx.res) return null;
        IQ.Hooks.state.set('packhunters:mmLast', ctx.res.correct ? 1 : -1);
        return null;
      }
    }
  });

  /* ---- 8. doom-pickups (any world, low weight) ---------------------------
   * Correct answers have a chance to crack open a doom cache: a health vial
   * (+15 hp) or an AMMO TOKEN banked into shared state for sibling packs.
   * MODIFIERS USED: pickup:{kind:'health'|'ammo',value} (+15 hp / banked
   * token), bannerText (cache callout); state key 'packhunters:ammo'. */
  IQ.Hooks.add({
    id: 'doom-pickups',
    always: true,
    weight: 0.5,
    handlers: {
      onAnswer: function (ctx) {
        if (!ctx.res || !ctx.res.correct) return null;
        if (ctx.rng() >= 0.35) return null;             /* most rounds: silent */
        if (ctx.rng() < 0.65) {
          return { pickup: { kind: 'health', value: 15 }, bannerText: 'DOOM CACHE \u00B7 +15 HP' };
        }
        var ammo = (IQ.Hooks.state.get('packhunters:ammo') || 0) + 1;
        IQ.Hooks.state.set('packhunters:ammo', ammo);
        return { pickup: { kind: 'ammo', value: 1 }, bannerText: 'AMMO TOKEN BANKED \u00B7 \u00D7' + ammo };
      }
    }
  });

  console.info('[pack-hunters] registered 8 packs:',
    'hunter-beam, red-light-green-light, floor-fall, sky-laser, sandstorm, venom-party, mastermind-mood, doom-pickups');
})();
