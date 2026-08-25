/* ============================================================================
 * pack-density-a.js — Wave 5 DENSITY squad A: six parody worlds + companion
 * hook beats. Vanilla JS/canvas only, asset-free, self-registering into
 * window.IQ.Worlds / window.IQ.Hooks.
 * ============================================================================
 *
 * REGISTRATION SHAPES:
 *   IQ.Worlds.register({id, align:'bad'|'good'|'chaotic'|'neutral',
 *                       pal:[8 colors], draw(ctx,w,h,t)})
 *     Polls briefly if worlds.js has not landed yet (same convention as
 *     worlds-pop.js late-safe registration).
 *   IQ.Hooks.add({id, worlds:[worldId], weight:1, handlers:{...}})
 *     Queued on window.IQ.__hooksPending if hooks.js has not landed yet
 *     (canonical queue drained once, in order, by hooks.js reconciliation).
 *
 * WORLDS (parody ids only):
 *   candy-kingdom     (good)    pastel sugar peaks, lollipop trees
 *   train-graveyard   (bad)     rusted locomotive skeletons, ember drift
 *   clockwork-bureau  (neutral) brass gears at different ratios, drifting
 *                               stamped papers
 *   sunken-cathedral  (chaotic) drowned stained glass, wobbling light shafts,
 *                               rare whale silhouette
 *   neon-district     (chaotic) rain-slick neon flicker, puddle reflections
 *   hayfield-idyll    (good)    golden wheat waves, distant bell pulse
 *
 * HOOK BEATS (one pack per world; ctx.rng ONLY; inert rounds <= 2):
 *   candy-kingdom    onRoundStart 30% {hpDelta:+3, 'SUGAR RUSH · +3'}
 *   train-graveyard  onAnswer wrong 25% {timerDelta:-3,
 *                        'THE 3:15 TO NOWHERE LEAVES'}
 *   clockwork-bureau onRoundStart 25% {scoreMul:1.1, 'PUNCTUAL · ×1.1'}
 *   sunken-cathedral onRoundStart 20% {invertControlsMs:600,
 *                        'THE CHOIR SWIMS'}
 *   neon-district    onAnswer correct 20% {bannerText:'THE CITY APPROVES'}
 *   hayfield-idyll   onRoundStart 30% {bannerText:'A BELL SOMEWHERE · PEACE'}
 *
 * FAIRNESS / DETERMINISM RAILS:
 *   - Draws are PURE f(t) over FIXED per-index constants: zero Math.random,
 *     zero Date.now/performance.now. Freezing t yields a static frame.
 *   - Ambient motion honours IQB_MOTION via the shared Worlds loop (t=0
 *     static); never recolors/animates question or answer glyphs.
 *   - No fullscreen flashes: every luminance pulse is LOCALIZED (bell ring,
 *     neon sign, ember, light shaft) and slow (<= ~1.6 Hz apparent toggle,
 *     far under the 3 Hz / 200 ms caps).
 *   - Hook modifiers stay inside documented clamps (engine owns clocks and
 *     scoring math; scoreMul/timerDelta/hpDelta/invertControlsMs are
 *     REQUESTS). Neon/hayfield banners are cosmetic-only (no stat fields).
 *   - train-graveyard/neon-district onAnswer NEVER inspects which option was
 *     correct pre-reveal — they read ctx.res AFTER scoring, host-authoritative.
 *   - Every handler body wrapped in its own try/catch (dispatch also swallows
 *     — defence in depth). Rounds 1-2 bail unconditionally (parity rule C8).
 *
 * SELF TEST: see research/smoke-densitya.js (pal arity, stub-2d draw at
 * t=0/1000+, forced-rng probability gates, parity inertia, banned-token scan).
 * ============================================================================*/
(function () {
'use strict';
const root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};

const TAU = Math.PI * 2;

/* ---------- shared helpers ------------------------------------------------ */
function vgrad(c, h, stops) {
 const g = c.createLinearGradient(0, 0, 0, h);
 for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
 return g;
}
function tri(c, x0, y0, x1, y1, x2, y2) {
 c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.lineTo(x2, y2); c.closePath();
}

/* ==========================================================================
 * WORLDS
 * ========================================================================*/
const DEFS = [

/* --- candy-kingdom (good): pastel peaks + lollipop trees ------------------ */
{ id: 'candy-kingdom', align: 'good',
  pal: ['#ffd6e8', '#ff9ecb', '#bde0fe', '#fff3b0', '#caffbf', '#fdffb6', '#ffc8dd', '#a2d2ff'],
  draw: function (c, w, h, t) {
    c.fillStyle = vgrad(c, h, [[0, '#ffd6e8'], [0.55, '#ffeaf4'], [1, '#fff3b0']]);
    c.fillRect(0, 0, w, h);
    /* lazy candy clouds */
    for (let i = 0; i < 4; i++) {
      const cx = ((i * 0.28 + 0.08) * w + t * 6 + i * 40) % (w + 160) - 80;
      const cy = h * (0.12 + 0.07 * i);
      c.fillStyle = 'rgba(255,255,255,.75)';
      c.beginPath();
      c.arc(cx, cy, 26, 0, TAU); c.arc(cx + 30, cy - 8, 20, 0, TAU);
      c.arc(cx + 58, cy + 2, 23, 0, TAU); c.arc(cx + 28, cy + 10, 22, 0, TAU);
      c.fill();
    }
    /* striped sugar peaks, three layers back-to-front */
    const peaks = [[0.18, 0.62, '#ffc8dd'], [0.52, 0.70, '#bde0fe'], [0.84, 0.58, '#caffbf']];
    for (let p = 0; p < 3; p++) {
      const px = peaks[p][0] * w, py = h * (1 - peaks[p][1]), pw = w * 0.34;
      tri(c, px - pw, h * 0.78, px, py, px + pw, h * 0.78);
      c.fillStyle = peaks[p][2]; c.fill();
      /* icing stripes clipped inside the peak */
      c.save(); tri(c, px - pw, h * 0.78, px, py, px + pw, h * 0.78); c.clip();
      c.fillStyle = 'rgba(255,255,255,.35)';
      for (let b = 1; b <= 3; b++) {
        const by = py + (h * 0.78 - py) * (b / 4) + Math.sin(t * 0.0006 + b + p) * 3;
        c.fillRect(px - pw, by, pw * 2, 6);
      }
      c.restore();
    }
    /* ground frosting */
    c.fillStyle = '#fdffb6'; c.fillRect(0, h * 0.76, w, h * 0.24);
    c.fillStyle = 'rgba(255,200,221,.5)'; c.fillRect(0, h * 0.76, w, 8);
    /* lollipop trees: stick + swirly head */
    const trees = [[0.10, '#ff9ecb'], [0.30, '#a2d2ff'], [0.68, '#ff9ecb'], [0.90, '#caffbf']];
    for (let i = 0; i < trees.length; i++) {
      const tx = trees[i][0] * w, ty = h * 0.86, headR = h * 0.055;
      c.strokeStyle = '#ffffff'; c.lineWidth = 6;
      c.beginPath(); c.moveTo(tx, ty); c.lineTo(tx, ty - headR * 2.1); c.stroke();
      c.beginPath(); c.arc(tx, ty - headR * 2.1, headR, 0, TAU);
      c.fillStyle = trees[i][1]; c.fill();
      c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 4;
      c.beginPath();                                   /* spiral swirl, slow spin */
      for (let a = 0; a < TAU * 2.4; a += 0.25) {
        const rr = headR * (a / (TAU * 2.4)) * 0.92;
        const ang = a + t * 0.0004 + i * 1.3;
        const sx = tx + Math.cos(ang) * rr, sy = ty - headR * 2.1 + Math.sin(ang) * rr;
        if (a === 0) c.moveTo(sx, sy); else c.lineTo(sx, sy);
      }
      c.stroke();
    }
  }},

/* --- train-graveyard (bad): rusted locomotives + ember drift -------------- */
{ id: 'train-graveyard', align: 'bad',
  pal: ['#8c2f0d', '#3b1206', '#c65b1e', '#12050a', '#e8871e', '#571d09', '#ff6b35', '#1c080d'],
  draw: function (c, w, h, t) {
    c.fillStyle = vgrad(c, h, [[0, '#12050a'], [0.5, '#3b1206'], [1, '#1c080d']]);
    c.fillRect(0, 0, w, h);
    /* sickly rust haze low on the horizon */
    c.fillStyle = 'rgba(200,91,30,' + (0.14 + 0.05 * Math.sin(t * 0.0009)).toFixed(3) + ')';
    c.fillRect(0, h * 0.42, w, h * 0.2);
    const gy = h * 0.72;
    c.fillStyle = '#0c0406'; c.fillRect(0, gy, w, h - gy);
    /* three dead locomotive skeletons, slightly different rakes */
    const locos = [[0.16, 0.95, 0.06], [0.48, 1.15, -0.04], [0.82, 0.85, 0.10]];
    for (let i = 0; i < locos.length; i++) {
      const lx = locos[i][0] * w, s = locos[i][1], rake = locos[i][2];
      c.save(); c.translate(lx, gy); c.rotate(rake * 0.35);
      /* boiler */
      c.fillStyle = '#1c080d';
      c.fillRect(-w * 0.11 * s, -h * 0.13 * s, w * 0.22 * s, h * 0.13 * s);
      c.strokeStyle = 'rgba(232,135,30,.5)'; c.lineWidth = 2;
      c.strokeRect(-w * 0.11 * s, -h * 0.13 * s, w * 0.22 * s, h * 0.13 * s);
      /* rib bones showing through burst plating */
      c.strokeStyle = 'rgba(140,47,13,.9)'; c.lineWidth = 3;
      for (let r = 1; r <= 3; r++) {
        const rx = -w * 0.11 * s + (r / 4) * w * 0.22 * s;
        c.beginPath(); c.moveTo(rx, -h * 0.13 * s); c.lineTo(rx, 0); c.stroke();
      }
      /* leaning smokestack */
      tri(c, w * 0.05 * s, -h * 0.13 * s, w * 0.09 * s, -h * 0.13 * s,
          w * 0.055 * s, -h * 0.24 * s);
      c.fillStyle = '#12050a'; c.fill();
      /* wheels, some fallen flat */
      c.fillStyle = '#0c0406';
      const wr = h * 0.035 * s;
      for (let whl = 0; whl < 3; whl++) {
        c.beginPath();
        c.arc(-w * 0.07 * s + whl * w * 0.075 * s, -wr * (whl === 1 ? 1.1 : 1),
              wr * (whl === 1 ? 0.75 : 1), 0, TAU);
        c.fill();
      }
      c.strokeStyle = 'rgba(255,107,53,.35)';
      for (let sp = 0; sp < 4; sp++) {               /* frozen spokes, no turn */
        const ang = sp * TAU / 4 + i * 0.7;
        c.beginPath();
        c.moveTo(-w * 0.145 * s, -wr);
        c.lineTo(-w * 0.145 * s + Math.cos(ang) * wr, -wr + Math.sin(ang) * wr);
        c.stroke();
      }
      c.restore();
    }
    /* ember drift: rising sparks on fixed per-index tracks */
    for (let e = 0; e < 26; e++) {
      const spd = 18 + (e % 5) * 9;
      const ey = h - ((t * spd + e * 137) % (h * 0.92));
      const ex = ((e * 173) % w) + Math.sin(t * 0.0016 + e * 1.9) * 14;
      const al = 0.55 * (ey / h) + 0.08;
      c.fillStyle = 'rgba(255,107,53,' + al.toFixed(3) + ')';
      c.fillRect(ex, ey, 2.5, 2.5);
    }
    /* thin smoke columns from stacks */
    for (let m = 0; m < 3; m++) {
      const mx = locos[m][0] * w + w * 0.055 * locos[m][1];
      for (let puff = 0; puff < 5; puff++) {
        const ph = ((t * 0.02 + puff * 90 + m * 210) % 450) / 450;
        c.fillStyle = 'rgba(87,29,9,' + (0.30 * (1 - ph)).toFixed(3) + ')';
        c.beginPath();
        c.arc(mx + Math.sin(ph * 6 + m) * 18, gy - h * 0.24 * locos[m][1] - ph * h * 0.3,
              8 + ph * 22, 0, TAU);
        c.fill();
      }
    }
  }},

/* --- clockwork-bureau (neutral): brass gears + stamped papers ------------- */
{ id: 'clockwork-bureau', align: 'neutral',
  pal: ['#b8860b', '#6b4f1d', '#ffd700', '#241a08', '#daa520', '#8b6914', '#f4e4bc', '#3a2c10'],
  draw: function (c, w, h, t) {
    c.fillStyle = vgrad(c, h, [[0, '#241a08'], [0.6, '#3a2c10'], [1, '#171004']]);
    c.fillRect(0, 0, w, h);
    /* faint wood-panel seams behind everything */
    c.strokeStyle = 'rgba(139,105,20,.18)'; c.lineWidth = 2;
    for (let s = 1; s < 6; s++) {
      c.beginPath(); c.moveTo(w * s / 6, 0); c.lineTo(w * s / 6, h); c.stroke();
    }
    /* brass gears, EACH ON ITS OWN FIXED RATIO (never meshing-mismatched) */
    const gears = [
      [0.22, 0.34, 64, 12, 0.00035, 0.0],
      [0.36, 0.52, 38, 8, -0.00061, 0.4],
      [0.66, 0.26, 52, 10, 0.00044, 1.1],
      [0.80, 0.58, 74, 14, -0.00021, 2.0],
      [0.52, 0.74, 30, 7, 0.00083, 0.8]
    ];
    for (let g = 0; g < gears.length; g++) {
      const gx = gears[g][0] * w, gyy = gears[g][1] * h;
      const gr = gears[g][2], teeth = gears[g][3];
      const ang = t * gears[g][4] + gears[g][5];
      c.save(); c.translate(gx, gyy); c.rotate(ang);
      c.fillStyle = 'rgba(184,134,11,.85)';
      c.beginPath(); c.arc(0, 0, gr, 0, TAU); c.fill();
      c.strokeStyle = '#f4e4bc'; c.lineWidth = 3; c.stroke();
      for (let th = 0; th < teeth; th++) {           /* square-cut teeth */
        const ta = th * TAU / teeth;
        const tx = Math.cos(ta), ty = Math.sin(ta);
        c.fillStyle = 'rgba(218,165,32,.9)';
        c.fillRect(tx * gr - 4, ty * gr - 4, 8, 8);
      }
      c.fillStyle = '#241a08';
      c.beginPath(); c.arc(0, 0, gr * 0.28, 0, TAU); c.fill();
      c.strokeStyle = '#ffd700'; c.lineWidth = 2;
      for (let sp = 0; sp < 4; sp++) {               /* spokes show the ratio */
        const sa = sp * TAU / 4;
        c.beginPath(); c.moveTo(0, 0);
        c.lineTo(Math.cos(sa) * gr * 0.72, Math.sin(sa) * gr * 0.72); c.stroke();
      }
      c.restore();
    }
    /* desk edge */
    c.fillStyle = '#6b4f1d'; c.fillRect(0, h * 0.88, w, h * 0.12);
    /* stamped papers drifting down onto the desk */
    for (let p = 0; p < 7; p++) {
      const spd = 12 + (p % 3) * 7;
      const pyy = ((t * spd + p * 211) % (h + 80)) - 40;
      const pxx = (p * 0.14 + 0.06) * w + Math.sin(t * 0.0011 + p * 2.1) * 22;
      c.save(); c.translate(pxx, pyy);
      c.rotate(Math.sin(t * 0.0008 + p) * 0.5);
      c.fillStyle = 'rgba(244,228,188,.92)';
      c.fillRect(-16, -22, 32, 44);
      c.strokeStyle = 'rgba(107,79,29,.8)'; c.lineWidth = 1.5;
      c.strokeRect(-16, -22, 32, 44);
      for (let ln = 0; ln < 4; ln++) {               /* typed lines */
        c.beginPath(); c.moveTo(-11, -14 + ln * 8); c.lineTo(11, -14 + ln * 8);
        c.stroke();
      }
      c.strokeStyle = 'rgba(184,134,11,.9)';         /* the STAMP: star-ish seal */
      c.beginPath(); c.arc(0, 14, 6, 0, TAU); c.stroke();
      c.restore();
    }
  }},

/* --- sunken-cathedral (chaotic): stained glass, shafts, rare whale -------- */
{ id: 'sunken-cathedral', align: 'chaotic',
  pal: ['#1b4f72', '#0a2540', '#5dade2', '#04121f', '#76d7c4', '#f7dc6f', '#af7ac5', '#0e3a5c'],
  draw: function (c, w, h, t) {
    c.fillStyle = vgrad(c, h, [[0, '#0a2540'], [0.6, '#0e3a5c'], [1, '#04121f']]);
    c.fillRect(0, 0, w, h);
    /* drowned rose window high centre: segmented glass */
    const wx = w * 0.5, wy = h * 0.20, wr = Math.min(w, h) * 0.13;
    const glass = ['#5dade2', '#76d7c4', '#f7dc6f', '#af7ac5'];
    for (let seg = 0; seg < 8; seg++) {
      c.fillStyle = glass[seg % 4];
      c.beginPath(); c.moveTo(wx, wy);
      c.arc(wx, wy, wr, seg * TAU / 8 + t * 0.00012, (seg + 1) * TAU / 8 + t * 0.00012);
      c.closePath(); c.globalAlpha = 0.75; c.fill(); c.globalAlpha = 1;
    }
    c.strokeStyle = 'rgba(244,228,188,.6)'; c.lineWidth = 3;
    c.beginPath(); c.arc(wx, wy, wr, 0, TAU); c.stroke();
    c.beginPath(); c.arc(wx, wy, wr * 0.3, 0, TAU); c.stroke();
    /* wobbling god-shafts from the window to the floor */
    for (let sh = 0; sh < 4; sh++) {
      const sway = Math.sin(t * 0.0007 + sh * 1.8) * w * 0.03;
      const topX = wx + (sh - 1.5) * wr * 0.5;
      c.fillStyle = 'rgba(118,215,196,' + (0.06 + 0.03 * Math.sin(t * 0.001 + sh)).toFixed(3) + ')';
      c.beginPath();
      c.moveTo(topX - 12, wy); c.lineTo(topX + 12, wy);
      c.lineTo(topX + 46 + sway * 2.2, h); c.lineTo(topX - 46 + sway * 2.2, h);
      c.closePath(); c.fill();
    }
    /* seabed rubble + broken pillars */
    c.fillStyle = '#04121f'; c.fillRect(0, h * 0.82, w, h * 0.18);
    for (let pi = 0; pi < 3; pi++) {
      const px = (0.14 + pi * 0.33) * w, ph = h * (0.22 - pi * 0.05);
      c.fillStyle = '#0a2540';
      c.fillRect(px - 14, h * 0.82 - ph, 28, ph);
      c.fillRect(px - 20, h * 0.82 - ph - 8, 40, 8);   /* capital */
    }
    /* bubbles rising gently */
    for (let b = 0; b < 12; b++) {
      const by = h - ((t * (10 + (b % 4) * 6) + b * 167) % (h * 0.95));
      c.strokeStyle = 'rgba(93,173,226,.35)'; c.lineWidth = 1;
      c.beginPath();
      c.arc((b * 149) % w + Math.sin(t * 0.002 + b) * 8, by, 2 + (b % 3), 0, TAU);
      c.stroke();
    }
    /* THE RARE WHALE: one slow pass every 40 s (first 22% of the cycle) */
    const cyc = (t % 40000) / 40000;
    if (cyc < 0.22) {
      const f = cyc / 0.22;
      const kx = -w * 0.2 + f * (w * 1.4);
      const ky = h * 0.55 + Math.sin(t * 0.0012) * h * 0.03;
      c.fillStyle = 'rgba(10,37,64,.92)';
      c.beginPath(); c.ellipse(kx, ky, w * 0.09, h * 0.035, -0.06, 0, TAU); c.fill();
      tri(c, kx + w * 0.075, ky - 2, kx + w * 0.125, ky - h * 0.045,
          kx + w * 0.125, ky + h * 0.02); c.fill();       /* fluke */
      tri(c, kx - w * 0.02, ky + h * 0.01, kx + w * 0.03, ky + h * 0.01,
          kx + w * 0.005, ky + h * 0.055); c.fill();      /* fin */
    }
  }},

/* --- neon-district (chaotic): rain, flicker, puddle reflections ----------- */
{ id: 'neon-district', align: 'chaotic',
  pal: ['#ff2fb3', '#00e5ff', '#7c4dff', '#05010f', '#ffe94a', '#1b0b2e', '#ff5e5e', '#0d0221'],
  draw: function (c, w, h, t) {
    c.fillStyle = vgrad(c, h, [[0, '#05010f'], [0.65, '#1b0b2e'], [1, '#0d0221']]);
    c.fillRect(0, 0, w, h);
    const hy = h * 0.74;
    /* skyline slabs */
    const slabs = [[0.06, 0.34], [0.17, 0.5], [0.3, 0.42], [0.43, 0.56],
                   [0.58, 0.46], [0.71, 0.6], [0.85, 0.4]];
    c.fillStyle = '#0d0221';
    for (let i = 0; i < slabs.length; i++) {
      const bw = w * 0.11, bh = slabs[i][1] * hy;
      c.fillRect(slabs[i][0] * w, hy - bh, bw, bh);
    }
    /* neon signage: SMOOTH brightness breathing, never a strobe */
    const signs = [[0.085, '#ff2fb3'], [0.20, '#00e5ff'], [0.33, '#ffe94a'],
                   [0.47, '#ff5e5e'], [0.62, '#7c4dff'], [0.75, '#00e5ff'],
                   [0.88, '#ff2fb3']];
    for (let s = 0; s < signs.length; s++) {
      const glow = 0.55 + 0.45 * Math.sin(t * 0.0032 + s * 2.4);  // 0..1 smooth
      const sx = signs[s][0] * w, bh = slabs[s][1] * hy;
      c.save();
      c.shadowColor = signs[s][1]; c.shadowBlur = 12 * glow;
      c.fillStyle = signs[s][1];
      c.globalAlpha = 0.35 + 0.6 * glow;
      if (s % 2 === 0) c.fillRect(sx, hy - bh * 0.7, w * 0.06, 6);   /* bar sign */
      else c.fillRect(sx, hy - bh * 0.55, 6, h * 0.09);              /* vertical */
      c.restore(); c.globalAlpha = 1;
    }
    /* wet road */
    c.fillStyle = '#05010f'; c.fillRect(0, hy, w, h - hy);
    /* puddle reflections: smeared mirrored sign colour, slow ripple */
    for (let s = 0; s < signs.length; s += 2) {
      const ripple = 0.5 + 0.5 * Math.sin(t * 0.004 + s * 1.3);
      c.fillStyle = signs[s][1];
      c.globalAlpha = 0.10 + 0.10 * ripple;
      c.fillRect(signs[s][0] * w - 8, hy + 8, w * 0.06 + 16, 10 + 6 * ripple);
      c.globalAlpha = 1;
    }
    /* diagonal rain streaks on fixed tracks */
    c.strokeStyle = 'rgba(0,229,255,.28)'; c.lineWidth = 1.2;
    c.beginPath();
    for (let d = 0; d < 40; d++) {
      const spd = 320 + (d % 4) * 90;
      const dy = ((t * spd + d * 97) % (h + 60)) - 30;
      const dx = ((d * 131) % (w + 120)) - 60;
      c.moveTo(dx + dy * 0.22, dy);
      c.lineTo(dx + dy * 0.22 + 4, dy + 16);
    }
    c.stroke();
  }},

/* --- hayfield-idyll (good): wheat waves + distant bell pulse -------------- */
{ id: 'hayfield-idyll', align: 'good',
  pal: ['#e9c46a', '#f4a261', '#2a9d8f', '#264653', '#e76f51', '#dad7cd', '#ffe8a3', '#8ab17d'],
  draw: function (c, w, h, t) {
    c.fillStyle = vgrad(c, h, [[0, '#ffe8a3'], [0.5, '#e9c46a'], [1, '#f4a261']]);
    c.fillRect(0, 0, w, h);
    /* soft afternoon sun */
    c.fillStyle = 'rgba(255,244,214,.5)';
    c.beginPath(); c.arc(w * 0.78, h * 0.2, h * 0.09, 0, TAU); c.fill();
    /* distant hills + bell tower silhouette */
    c.fillStyle = '#8ab17d';
    c.beginPath(); c.moveTo(0, h * 0.62);
    c.quadraticCurveTo(w * 0.25, h * 0.54, w * 0.5, h * 0.62);
    c.quadraticCurveTo(w * 0.75, h * 0.56, w, h * 0.63);
    c.lineTo(w, h * 0.72); c.lineTo(0, h * 0.72); c.closePath(); c.fill();
    const bx = w * 0.16, bh = h * 0.16;
    c.fillStyle = '#264653';
    c.fillRect(bx - 10, h * 0.62 - bh, 20, bh);            /* tower body */
    tri(c, bx - 14, h * 0.62 - bh, bx, h * 0.62 - bh - 16, bx + 14, h * 0.62 - bh);
    c.fill();                                              /* roof */
    /* bell pulse: expanding ring every 8 s, gentle and local */
    const bp = ((t + 3000) % 8000) / 8000;
    c.strokeStyle = 'rgba(255,244,214,' + ((1 - bp) * 0.4).toFixed(3) + ')';
    c.lineWidth = 2.5;
    c.beginPath(); c.arc(bx, h * 0.62 - bh - 4, 8 + bp * 60, 0, TAU); c.stroke();
    /* wheat field: three depth rows of swaying stalks */
    const rows = [[0.78, 46, 1.0], [0.86, 34, 1.35], [0.94, 26, 1.8]];
    for (let r = 0; r < rows.length; r++) {
      const gy = rows[r][0] * h, n = rows[r][1], amp = rows[r][2];
      for (let i = 0; i < n; i++) {
        const fx = ((i + 0.5) / n) * w + Math.sin(i * 12.9898 + r) * 7;  // fixed hash
        const fh = (0.10 + ((i * 7 + r * 3) % 5) / 25) * h * amp * 0.55;
        const sway = Math.sin(t * 0.0012 + fx * 0.02 + r * 1.7) * 6 * amp;
        c.strokeStyle = r === 2 ? '#c98a2b' : '#e9c46a';
        c.lineWidth = 1.6;
        c.beginPath();
        c.moveTo(fx, gy);
        c.quadraticCurveTo(fx + sway * 0.5, gy - fh * 0.6, fx + sway, gy - fh);
        c.stroke();
        c.fillStyle = r === 2 ? '#e76f51' : '#f4a261';     /* grain head */
        c.beginPath();
        c.ellipse(fx + sway, gy - fh, 2.2, 6, sway * 0.04, 0, TAU);
        c.fill();
      }
    }
    /* a few drifting seeds catching the light */
    for (let sd = 0; sd < 8; sd++) {
      const sy = h * 0.4 + ((t * (8 + (sd % 3) * 5) + sd * 143) % (h * 0.4));
      c.fillStyle = 'rgba(255,244,214,.5)';
      c.beginPath();
      c.arc((sd * 211) % w + Math.sin(t * 0.0013 + sd) * 20, sy, 2, 0, TAU);
      c.fill();
    }
  }}
];

/* ==========================================================================
 * HOOK BEATS — one pack per world, ctx.rng only, inert rounds <= 2
 * ========================================================================*/
function guardCtx(ctx) {                 // shared parity + rng rail
 return !!ctx && typeof ctx.round === 'number' && ctx.round > 2 &&
        typeof ctx.rng === 'function';
}

const CANDY = {
 id: 'pack-densitya-candy', worlds: ['candy-kingdom'], weight: 1,
 handlers: {
  onRoundStart: function (ctx) {
   try {
    if (!guardCtx(ctx)) return;
    if (ctx.rng() < 0.30)
     return { hpDelta: 3, bannerText: 'SUGAR RUSH · +3', sfx: 'chime',
              flag: 'densitya:sugar' };
    return;
   } catch (e) {
    try { console.warn('[pack-densitya-candy] swallowed:', e && e.message || e); } catch (_) {}
    return;
   }
  }
 }
};

const TRAIN = {
 id: 'pack-densitya-train', worlds: ['train-graveyard'], weight: 1,
 handlers: {
  /* reads ctx.res AFTER scoring only — never touches answer state early */
  onAnswer: function (ctx) {
   try {
    if (!guardCtx(ctx)) return;
    if (!ctx.res || ctx.res.correct) return;
    if (ctx.rng() < 0.25)
     return { timerDelta: -3, bannerText: 'THE 3:15 TO NOWHERE LEAVES',
              sfx: 'rumble', flag: 'densitya:315' };
    return;
   } catch (e) {
    try { console.warn('[pack-densitya-train] swallowed:', e && e.message || e); } catch (_) {}
    return;
   }
  }
 }
};

const CLOCKWORK = {
 id: 'pack-densitya-clockwork', worlds: ['clockwork-bureau'], weight: 1,
 handlers: {
  onRoundStart: function (ctx) {
   try {
    if (!guardCtx(ctx)) return;
    if (ctx.rng() < 0.25)
     return { scoreMul: 1.1, bannerText: 'PUNCTUAL · ×1.1',
              flag: 'densitya:punctual' };
    return;
   } catch (e) {
    try { console.warn('[pack-densitya-clockwork] swallowed:', e && e.message || e); } catch (_) {}
    return;
   }
  }
 }
};

const CATHEDRAL = {
 id: 'pack-densitya-cathedral', worlds: ['sunken-cathedral'], weight: 1,
 handlers: {
  onRoundStart: function (ctx) {
   try {
    if (!guardCtx(ctx)) return;
    if (ctx.rng() < 0.20)
     return { invertControlsMs: 600, bannerText: 'THE CHOIR SWIMS',
              flag: 'densitya:choir' };
    return;
   } catch (e) {
    try { console.warn('[pack-densitya-cathedral] swallowed:', e && e.message || e); } catch (_) {}
    return;
   }
  }
 }
};

const NEON = {
 id: 'pack-densitya-neon', worlds: ['neon-district'], weight: 1,
 handlers: {
  onAnswer: function (ctx) {
   try {
    if (!guardCtx(ctx)) return;
    if (!ctx.res || !ctx.res.correct) return;
    if (ctx.rng() < 0.20)
     return { bannerText: 'THE CITY APPROVES', sfx: 'chime',
              flag: 'densitya:approved' };          /* cosmetic only */
    return;
   } catch (e) {
    try { console.warn('[pack-densitya-neon] swallowed:', e && e.message || e); } catch (_) {}
    return;
   }
  }
 }
};

const HAYFIELD = {
 id: 'pack-densitya-hayfield', worlds: ['hayfield-idyll'], weight: 1,
 handlers: {
  onRoundStart: function (ctx) {
   try {
    if (!guardCtx(ctx)) return;
    if (ctx.rng() < 0.30)
     return { bannerText: 'A BELL SOMEWHERE · PEACE',
              flag: 'densitya:bell' };              /* cosmetic only */
    return;
   } catch (e) {
    try { console.warn('[pack-densitya-hayfield] swallowed:', e && e.message || e); } catch (_) {}
    return;
   }
  }
 }
};

const PACKS = [CANDY, TRAIN, CLOCKWORK, CATHEDRAL, NEON, HAYFIELD];

/* ---------- registration --------------------------------------------------
 * Worlds: brief poll (worlds.js may land after us). Hooks: canonical
 * __hooksPending queue (drained once, in order, by hooks.js). */
(function regWorlds(attempt) {
 try {
  const W = root.IQ && root.IQ.Worlds;
  if (W && typeof W.register === 'function') {
   DEFS.forEach(function (d) { W.register(d); });
   return;
  }
 } catch (_) {}
 if (attempt < 40 && typeof setTimeout === 'function')
  setTimeout(function () { regWorlds(attempt + 1); }, 50);
})(0);

try {
 if (root.IQ && root.IQ.Hooks && typeof root.IQ.Hooks.add === 'function') {
  PACKS.forEach(function (p) { root.IQ.Hooks.add(p); });
 } else {
  (root.IQ.__hooksPending = root.IQ.__hooksPending || []).push.apply(
   root.IQ.__hooksPending, PACKS);
 }
} catch (e) {
 try { console.warn('[pack-density-a] hook registration swallowed:',
                    e && e.message || e); } catch (_) {}
}

if (typeof module !== 'undefined' && module.exports) {
 module.exports = { id: 'pack-density-a', worlds: DEFS, packs: PACKS };
}
})();
