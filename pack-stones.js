/* ============================================================================
 * pack-stones.js — REMAKE ARMY B4: six gauntlet stones + 'gauntlet-temple' world
 * ============================================================================
 * Registers TWO things (hooks.js contract JSDoc):
 *   1. IQ.Hooks.add({ id:'pack-stones', always:true, ... })   — gameplay pack
 *   2. IQ.Worlds.register({ id:'gauntlet-temple', ... })      — backdrop world
 *
 * SPEC -> MECHANIC MAP
 *   spawn ......... six stones live in a per-run bag (IQ.Hooks.state,
 *                   key 'pack-stones:*'). Bag is shuffled ONCE with ctx.rng on
 *                   the first round start of a match -> deterministic order.
 *                   Stones spawn on CONSECUTIVE eligible rounds starting at
 *                   round 3 (rounds 1-2 stay pristine per alignment C8), one
 *                   per round until the bag empties. Collected order is kept
 *                   so 'oldest stone' is well-defined for SNAP.
 *   space ......... CHALLENGE — board shuffles ONCE mid-round: visual reflow
 *                   of #opts-grid child order only. Buttons keep their
 *                   dataset.i / click closures, so picks still score against
 *                   the SAME logical option (host-authoritative math untouched).
 *   mind .......... BOON — 1s hint pulse names the deciding ATTRIBUTE family
 *                   (color OR shape). The axis is derived ONLY from visible
 *                   rendered option variety — never from correctIdx. No tile
 *                   is ever highlighted (no pre-reveal answer leakage).
 *   reality ....... CHALLENGE — palette inversion (#app filter invert+hue) for
 *                   4s. IQB_MOTION-gated: no motion => no effect.
 *   power ......... BOON — scoreMul 2 for its round (streak rewards double).
 *   time .......... BOON — timerDelta +8 seconds on its round.
 *   soul .......... BOON — hpDelta +12 on ANY answer during its round.
 *   INEVITABLE .... collect all six -> the NEXT round start grants scoreMul 2
 *                   plus a gold, pointer-events:none, escapable overlay.
 *   snap .......... while holding >=1 stone AND hp < 30, every answer rolls a
 *                   seeded 10% (ctx.rng ONLY): lose OLDEST held stone + hp -5.
 *
 * FAIRNESS RAILS: all animation behind IQB_MOTION; overlays are pointer-events:
 * none, non-opaque, <=~30% coverage, never trap Escape; scoring stays
 * host-authoritative (we only REQUEST scoreMul/timerDelta/hpDelta); randomness
 * is ctx.rng exclusively. One broken handler cannot kill a round (dispatch
 * wraps handlers in try/catch).
 * ============================================================================*/
(function () {
'use strict';
const root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};

const Hooks = root.IQ.Hooks;

/* ---------- shared helpers (curse-pack conventions) ---------- */
function motionOK() {
  try {
    const v = root.localStorage && root.localStorage.getItem('IQB_MOTION');
    return v == null ? true : JSON.parse(v) !== false;
  } catch (e) { return true; }
}
function muted() {
  try {
    const v = root.localStorage && root.localStorage.getItem('IQB_MUTED');
    return v != null && JSON.parse(v) === true;
  } catch (e) { return false; }
}

/* ---------- stone table (ids are plain words; flavor lives in banners/CSS) -- */
const STONES = [
  { id: 'space',   name: 'SPACE',   glyph: '\u25C8', col: '#6ecbff' },
  { id: 'mind',    name: 'MIND',    glyph: '\u27E1', col: '#ffe066' },
  { id: 'reality', name: 'REALITY', glyph: '\u25CF', col: '#ff5a5a' },
  { id: 'power',   name: 'POWER',   glyph: '\u25B2', col: '#c77dff' },
  { id: 'time',    name: 'TIME',    glyph: '\u29D6', col: '#7ef29a' },
  { id: 'soul',    name: 'SOUL',    glyph: '\u263C', col: '#ffa8d8' }
];
const STONE_IDS = STONES.map(s => s.id);

const PS = 'pack-stones:';
let invertTimer = 0;

/* ---------- injected CSS ---------- */
let styleDone = false;
function ensureStyle() {
  if (styleDone || typeof document === 'undefined') return;
  styleDone = true;
  const st = document.createElement('style');
  st.id = 'iqb-pack-stones-style';
  st.textContent =
    /* persistent strip of held stones (cosmetic, never interactive) */
    '#iqb-stone-strip{position:fixed;top:10px;right:12px;z-index:72;display:flex;' +
    'gap:6px;pointer-events:none}' +
    '.iqb-stone-chip{width:22px;height:22px;border-radius:50%;display:flex;' +
    'align-items:center;justify-content:center;font-size:11px;line-height:1;' +
    'color:#14091f;border:2px solid rgba(255,215,94,.9);box-shadow:0 0 8px currentColor}' +
    /* mind hint: attribute-family pulse on the BOARD FRAME only (never a tile) */
    '@keyframes iqbMindPulseC{0%,100%{box-shadow:0 0 0 rgba(255,224,102,0)}' +
    '50%{box-shadow:0 0 36px rgba(255,224,102,.55);border-color:rgba(255,224,102,.8)}}' +
    '@keyframes iqbMindPulseS{0%,100%{box-shadow:0 0 0 rgba(167,139,250,0)}' +
    '50%{box-shadow:0 0 36px rgba(167,139,250,.5);border-color:rgba(167,139,250,.75)}}' +
    '#board-frame.iqb-mind-color{animation:iqbMindPulseC 1s ease-in-out 1}' +
    '#board-frame.iqb-mind-shape{animation:iqbMindPulseS 1s ease-in-out 1}' +
    /* space shuffle jolt (grid container, not the buttons) */
    '@keyframes iqbSpaceJolt{0%,100%{transform:translate(0,0)}' +
    '25%{transform:translate(-6px,0)}75%{transform:translate(6px,0)}}' +
    '#opts-grid.iqb-space-jolt{animation:iqbSpaceJolt .28s ease-out 1}' +
    /* reality palette inversion (readable: pure color-space flip) */
    'body.iqb-reality-invert #app{filter:invert(1) hue-rotate(180deg);' +
    'transition:filter .35s ease-out}';
  const head = document.head || document.getElementsByTagName('head')[0];
  head.appendChild(st);
}

/* ---------- presentation pieces ---------- */

/* persistent chip strip of held stones */
function renderStrip(collected) {
  if (typeof document === 'undefined') return;
  ensureStyle();
  let el = document.getElementById('iqb-stone-strip');
  if (!collected || !collected.length) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'iqb-stone-strip';
    document.body.appendChild(el);
  }
  let html = '';
  for (let i = 0; i < collected.length; i++) {
    const def = STONES.filter(s => s.id === collected[i])[0];
    if (!def) continue;
    html += '<span class="iqb-stone-chip" style="background:' + def.col +
      ';color:' + def.col + '">' + def.glyph + '</span>';
  }
  el.innerHTML = html;
}

/* reality palette inversion, 4s, motion-gated */
function realityInvert() {
  if (typeof document === 'undefined' || !motionOK()) return;
  ensureStyle();
  document.body.classList.add('iqb-reality-invert');
  clearTimeout(invertTimer);
  invertTimer = setTimeout(() => {
    invertTimer = 0;
    document.body.classList.remove('iqb-reality-invert');
  }, 4000);
}

/* mind hint pulse: glow the board frame; banner carries the readable hint */
function mindPulse(axis) {
  if (typeof document === 'undefined') return;
  ensureStyle();
  const frame = document.getElementById('board-frame');
  if (!frame || !motionOK()) return;               /* IQB_MOTION off -> banner only */
  const cls = axis === 'shape' ? 'iqb-mind-shape' : 'iqb-mind-color';
  frame.classList.remove('iqb-mind-color', 'iqb-mind-shape');
  void frame.offsetWidth;                          /* restart animation */
  frame.classList.add(cls);
  setTimeout(() => frame.classList.remove(cls), 1000);
}

/* space stone mid-round shuffle: VISUAL reflow of option DOM order only.
 * Buttons carry dataset.i and their own click closures, so a click (mouse or
 * the positional keyboard shortcut) still answers the same logical slot and
 * host-authoritative scoring never sees the reordering. */
function shuffleOptionsGrid(rng) {
  if (typeof document === 'undefined') return;
  ensureStyle();
  const og = document.getElementById('opts-grid');
  if (!og) return;
  const kids = Array.prototype.slice.call(og.children);
  if (kids.length < 2) return;
  for (let i = kids.length - 1; i > 0; i--) {
    const j = Math.floor((rng() * (i + 1)) | 0);
    const tmp = kids[i]; kids[i] = kids[j]; kids[j] = tmp;
  }
  for (let k = 0; k < kids.length; k++) og.appendChild(kids[k]);
  if (motionOK()) {
    og.classList.add('iqb-space-jolt');
    setTimeout(() => og.classList.remove('iqb-space-jolt'), 320);
  }
}

/* mind axis detection — VISIBLE information only. Decoy sets break exactly one
 * axis, so comparing how many distinct fill colors vs distinct glyph shapes are
 * rendered across the option buttons recovers the deciding family without ever
 * reading correctIdx. Defaults to 'color'. */
function detectAxis() {
  if (typeof document === 'undefined') return 'color';
  try {
    const svgs = document.querySelectorAll('#opts-grid .opt-btn svg');
    if (!svgs.length) return 'color';
    const fills = Object.create(null);
    const shapes = Object.create(null);
    svgs.forEach(svg => {
      svg.querySelectorAll('[fill]').forEach(el => {
        const f = String(el.getAttribute('fill') || '').toLowerCase();
        if (f) fills[f] = 1;
      });
      svg.querySelectorAll('path,circle,rect,polygon,line,ellipse').forEach(el => {
        let sig = el.tagName.toLowerCase();
        const d = el.getAttribute('d');
        if (d) sig += ':' + d.replace(/[0-9.\-,eE]/g, '').slice(0, 16);
        shapes[sig] = 1;
      });
    });
    const nc = Object.keys(fills).length;
    const ns = Object.keys(shapes).length;
    return ns > nc ? 'shape' : 'color';
  } catch (e) { return 'color'; }
}

/* ---------- world: gauntlet-temple (neutral backdrop — registers even if hooks.js is absent) ---------- */
const Worlds = root.IQ.Worlds;
if (Worlds && typeof Worlds.register === 'function') {
  Worlds.register({
    id: 'gauntlet-temple',
    align: 'neutral',
    pal: ['#ffd75e', '#c77dff', '#8a5cf6', '#2a1745', '#ffb347', '#6ecbff',
          '#ff8bd0', '#f4e8c1'],
    draw(c, w, h, t) {
      /* vaulted sky */
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#0b0614'); g.addColorStop(0.65, '#1a0f2e');
      g.addColorStop(1, '#120a20');
      c.fillStyle = g; c.fillRect(0, 0, w, h);

      /* distant rose window */
      c.strokeStyle = 'rgba(199,125,255,.14)'; c.lineWidth = 2;
      const wr = Math.min(w, h) * 0.16;
      for (let r = wr; r > wr * 0.3; r -= wr * 0.18) {
        c.beginPath(); c.arc(w * 0.5, h * 0.24, r, 0, 7); c.stroke();
      }

      /* temple floor: perspective bands scrolling slowly toward the viewer */
      for (let i = 0; i < 7; i++) {
        const f = ((t * 0.05) + i / 7) % 1;          /* 0=far .. 1=near */
        const y = h * (0.62 + 0.38 * f * f);
        c.fillStyle = 'rgba(255,215,94,' + (0.05 + 0.05 * f).toFixed(3) + ')';
        c.fillRect(w * (0.5 - 0.5 * f), y, w * f, Math.max(1, h * 0.008));
      }

      /* colonnades: pillar silhouettes flanking both walls */
      for (let side = 0; side < 2; side++) {
        for (let i = 0; i < 4; i++) {
          const depth = i / 4;
          const ph = h * (0.30 + 0.34 * depth);
          const pw = w * (0.02 + 0.02 * depth);
          const px = side === 0
            ? w * (0.06 + 0.07 * depth) - pw / 2
            : w * (0.94 - 0.07 * depth) - pw / 2;
          const py = h * 0.92 - ph;
          c.fillStyle = 'rgba(16,8,28,' + (0.85 - 0.15 * depth) + ')';
          c.fillRect(px, py, pw, ph);
          /* capital */
          c.fillRect(px - pw * 0.35, py, pw * 1.7, ph * 0.04);
          /* brazier glow licking the inner face */
          const flick = 0.5 + 0.5 * Math.sin(t * 2.1 + i * 1.7 + side * 3.1);
          const bx = side === 0 ? px + pw : px;
          const bg = c.createRadialGradient(bx, py + ph * 0.25, 2, bx, py + ph * 0.25, pw * 4);
          bg.addColorStop(0, 'rgba(255,179,71,' + (0.16 * flick).toFixed(3) + ')');
          bg.addColorStop(1, 'rgba(255,179,71,0)');
          c.fillStyle = bg;
          c.beginPath(); c.arc(bx, py + ph * 0.25, pw * 4, 0, 7); c.fill();
        }
      }

      /* altar dais + the six stones orbiting above it */
      const cx = w * 0.5, cy = h * 0.66;
      const ag = c.createRadialGradient(cx, cy, 4, cx, cy, w * 0.16);
      const breathe = 0.16 + 0.05 * Math.sin(t * 0.9);
      ag.addColorStop(0, 'rgba(255,215,94,' + breathe.toFixed(3) + ')');
      ag.addColorStop(1, 'rgba(255,215,94,0)');
      c.fillStyle = ag;
      c.beginPath(); c.ellipse(cx, cy, w * 0.16, w * 0.05, 0, 0, 7); c.fill();

      const R = Math.min(w, h) * 0.17;
      for (let i = 0; i < 6; i++) {
        const a = t * 0.35 + (i / 6) * Math.PI * 2;
        const ox = cx + Math.cos(a) * R * 1.5;
        const oy = cy - h * 0.10 + Math.sin(a) * R * 0.42;
        const orbR = 3 + 1.5 * (0.5 + 0.5 * Math.sin(t * 1.3 + i * 1.05));
        c.fillStyle = STONES[i] ? STONES[i].col : '#ffd75e';
        c.globalAlpha = 0.55 + 0.25 * Math.sin(a);
        c.beginPath(); c.arc(ox, oy, orbR, 0, 7); c.fill();
        c.globalAlpha = 1;
      }

      /* rising dust motes */
      for (let i = 0; i < 22; i++) {
        const f = ((t * 0.06) + i * 0.157) % 1;
        const mx = (i * 173) % w;
        c.fillStyle = 'rgba(244,232,193,' + (0.22 * (1 - f)).toFixed(3) + ')';
        c.fillRect(mx, h - f * h, 2, 2);
      }

      /* vignette keeps puzzle text zones calm and readable */
      const v = c.createRadialGradient(cx, h * 0.45, Math.min(w, h) * 0.32, cx, h * 0.45, Math.max(w, h) * 0.75);
      v.addColorStop(0, 'rgba(11,6,20,0)');
      v.addColorStop(1, 'rgba(11,6,20,.55)');
      c.fillStyle = v; c.fillRect(0, 0, w, h);
    }
  });
}

if (!Hooks || typeof Hooks.add !== 'function') return;   /* hooks.js not landed */
Hooks.add({
  id: 'pack-stones',
  always: true,
  weight: 2,
  handlers: {

    onRoundStart: function (ctx) {
      const S = Hooks.state;

      /* per-run bag: shuffled exactly once with the SEEDED rng -> the whole
       * spawn order is a pure function of (runId, seed). */
      if (!S.has(PS + 'bag')) {
        const bag = STONE_IDS.slice();
        for (let i = bag.length - 1; i > 0; i--) {
          const j = Math.floor((ctx.rng() * (i + 1)) | 0);
          const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
        }
        S.set(PS + 'bag', bag);
        S.set(PS + 'collected', []);
        S.set(PS + 'lastSpawn', 2);   /* round 3 opens the gauntlet */
        S.set(PS + 'inevitableDone', false);
        S.set(PS + 'elapsed', 0);
        S.set(PS + 'shuffled', false);
      }

      const bag = S.get(PS + 'bag') || [];
      const collected = S.get(PS + 'collected') || [];
      let lastSpawn = S.get(PS + 'lastSpawn') || 0;
      let active = null;

      /* eligible rounds: round 3 opens the gauntlet, then every consecutive
       * round pops the next stone until the bag runs dry. */
      const round = ctx.round | 0;
      if (round >= 3 && bag.length && lastSpawn === round - 1) {
        active = bag.shift();
        collected.push(active);
        lastSpawn = round;
        S.set(PS + 'bag', bag);
        S.set(PS + 'collected', collected);
        S.set(PS + 'lastSpawn', lastSpawn);
        renderStrip(collected);
      }
      S.set(PS + 'active', active);
      S.set(PS + 'elapsed', 0);
      S.set(PS + 'shuffled', false);

      /* one combined modifier object (handlers return AT MOST one) */
      const mod = {};
      const say = (t) => { mod.bannerText = t; };

      switch (active) {
        case 'space':
          say('\u25C8 SPACE STONE \u2014 THE BOARD WILL TURN MIDROUND');
          break;
        case 'reality':
          realityInvert();                           /* 4s, IQB_MOTION-gated */
          mod.sfx = 'laugh';
          say('\u25CF REALITY STONE \u2014 THE PALETTE LIES FOR 4 SECONDS');
          break;
        case 'mind': {
          const axis = detectAxis();                 /* visible info only */
          mindPulse(axis);
          mod.sfx = 'whisper';
          say(axis === 'shape'
            ? '\u27E1 MIND STONE WHISPERS: IT IS THE SHAPES'
            : '\u27E1 MIND STONE WHISPERS: IT IS THE COLORS');
          break;
        }
        case 'power':
          mod.scoreMul = 2;                          /* request, engine applies */
          mod.sfx = 'sting';
          say('\u25B2 POWER STONE \u2014 STREAK REWARDS DOUBLED');
          break;
        case 'time':
          mod.timerDelta = 8;
          mod.sfx = 'chime';
          say('\u29D6 TIME STONE \u2014 EIGHT MORE SECONDS');
          break;
        case 'soul':
          mod.sfx = 'heal';
          say('\u263C SOUL STONE \u2014 EVERY ANSWER MENDS +12');
          break;
        default:
          break;
      }

      /* INEVITABLE finale: fires on the round AFTER the sixth collection. */
      if (collected.length >= STONE_IDS.length &&
          !S.get(PS + 'inevitableDone')) {
        S.set(PS + 'inevitableDone', true);
        mod.scoreMul = 2;
        mod.overlayHTML =
          '<div style="position:absolute;inset:0;overflow:hidden;pointer-events:none">' +
          '<div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 42%,' +
          'rgba(255,204,64,.16),rgba(255,204,64,0) 55%)"></div>' +
          '<div style="position:absolute;left:50%;top:36%;transform:translateX(-50%);' +
          'font-weight:900;letter-spacing:.35em;font-size:min(6vw,48px);color:#ffd75e;' +
          'text-shadow:0 0 24px rgba(255,180,20,.6)">I N E V I T A B L E</div></div>';
        mod.overlayMs = 4200;
        mod.sfx = 'sting';
        mod.flag = mod.flag ? mod.flag + '+inevitable' : 'pack-stones:inevitable';
        say((mod.bannerText ? mod.bannerText + '  \u2022  ' : '') +
          '\u263C\u25B2\u25CF\u27E1\u25C8\u29D6 INEVITABLE \u2014 NEXT ROUND PAYS DOUBLE');
      }

      return (Object.keys(mod).length ? mod : undefined);
    },

    onTick: function (ctx) {
      const S = Hooks.state;
      if (S.get(PS + 'active') !== 'space') return;
      if (S.get(PS + 'shuffled')) return;
      /* accumulate elapsed round time (engine supplies dtSec; guard engines
       * that omit it by assuming one nominal frame per tick) */
      const dt = (typeof ctx.dtSec === 'number' && isFinite(ctx.dtSec))
        ? clampN(ctx.dtSec, 0, 0.25) : (1 / 60);
      const elapsed = (S.get(PS + 'elapsed') || 0) + dt;
      S.set(PS + 'elapsed', elapsed);
      if (elapsed >= (ctx.timerLen || 60) / 2) {
        S.set(PS + 'shuffled', true);                /* exactly once per round */
        shuffleOptionsGrid(ctx.rng);                 /* seeded reflow */
      }
      return undefined;
    },

    onAnswer: function (ctx) {
      const S = Hooks.state;
      const collected = S.get(PS + 'collected') || [];
      let hpDelta = 0;
      const mod = {};

      /* soul boon: +12 on ANY answer while the soul stone owns the round */
      if (S.get(PS + 'active') === 'soul') {
        hpDelta += 12;
        mod.flag = 'pack-stones:soul-heal';
      }

      /* snap: hp<30 while holding stones -> seeded 10% lose oldest + hp -5 */
      if ((ctx.hp | 0) < 30 && collected.length && ctx.rng() < 0.10) {
        const oldest = collected.shift();
        S.set(PS + 'collected', collected);
        renderStrip(collected);
        hpDelta -= 5;
        mod.bannerText = 'SNAP \u2014 THE ' + oldest.toUpperCase() +
          ' STONE TURNS TO DUST (-5)';
        mod.sfx = 'laugh';
        mod.flag = 'pack-stones:snap:' + oldest;
      } else if (hpDelta > 0) {
        mod.bannerText = '\u263C THE SOUL STONE MENDS YOU (+12)';
      }

      if (hpDelta) mod.hpDelta = hpDelta;
      return (Object.keys(mod).length ? mod : undefined);
    },

    onReveal: function () {
      return undefined;                              /* reserved: reveal theater */
    }
  }
});

function clampN(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }


/* tiny introspection surface (tests/debug only — no gameplay authority) */
root.IQ.PackStones = { stones: STONES, prefix: PS };

if (typeof module !== 'undefined' && module.exports) module.exports = root.IQ.PackStones;
})();
