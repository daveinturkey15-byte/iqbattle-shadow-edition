/* ============================================================================
 * pack-wwe.js — REMAKE ARMY B4: WWE-parody slam events + 'slam-arena' world
 * ============================================================================
 * Registers TWO things (hooks.js contract JSDoc):
 *   1. IQ.Hooks.add({ id:'pack-wwe', worlds:['slam-arena'], ... }) — gameplay pack
 *   2. IQ.Worlds.register({ id:'slam-arena', ... })                — backdrop world
 *
 * SPEC -> MECHANIC MAP
 *   ENTRANCE ....... onRoundStart seeds a rival persona from a roster of SIX
 *                    original parody gimmicks (no real names/likenesses) using
 *                    ctx.rng ONLY -> deterministic per (runId, round, seq).
 *                    Emits an entrance overlayHTML banner + crowd-pop sfx
 *                    (own WebAudio noise burst, IQB_MUTED-gated).
 *   TAUNT->SLAM .... onTick accumulates elapsed time (pack-stones 'space'
 *                    convention). At ~40% of timerLen a telegraph banner
 *                    "YOU'RE GONNA GET SLAMMED!" fires; 1.5s later the SLAM
 *                    requests disableWrongRandom:1 — the ENGINE picks the
 *                    victim among WRONG options (a pack never guesses
 *                    correctIdx), so a slam can NEVER hit the correct option.
 *                    Cosmetic CX-style CSS shake class on #app (IQB_MOTION-
 *                    gated) + crowd pop. Fires at most ONCE per round.
 *   CROWD METER .... Hooks.state key 'pack-wwe:meter', persists across rounds.
 *                    +15 per correct answer, +15 per slam, -10 per wrong
 *                    answer, clamped 0..100. At >=100 the FINISHER arms.
 *                    Next answer requests scoreMul:1.5 from onPreAnswer (the
 *                    engine multiplies ONLY the correct-award branch, so a
 *                    wrong guess wastes nothing); if that answer lands wrong
 *                    the finisher RE-ARMS — it waits for a correct answer.
 *                    On a landed finisher: confetti overlayHTML (motion-gated,
 *                    pointer-events:none) + crowd pop, then the meter RESETS.
 *   TITLE BELT ..... best streak seen this match lives in Hooks.state
 *                    ('pack-wwe:bestStreak'). At >=5 the champion holds the
 *                    belt: every round start renders a cosmetic belt chip +
 *                    player name as an overlayHTML sidebar note beside the
 *                    scoreboard, plus a chip in the persistent crowd-meter
 *                    strip. Purely cosmetic — no gameplay authority.
 *
 * FAIRNESS RAILS: overlays are pointer-events:none, non-opaque, <=~30%
 * coverage, never trap Escape/focus; question text zones stay clear; all
 * animation behind IQB_MOTION (flash cap respected: no strobes at all);
 * scoring stays host-authoritative (we only REQUEST scoreMul /
 * disableWrongRandom); randomness is ctx.rng exclusively; one broken handler
 * cannot kill a round (dispatch wraps handlers in try/catch).
 * ============================================================================*/
(function () {
'use strict';
const root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};

const Hooks = root.IQ.Hooks;

/* ---------- shared helpers (curse-pack / pack-stones conventions) ---------- */
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
function clampN(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* ---------- crowd audio: one-shot filtered-noise "pop", IQB_MUTED-gated ---- */
let actx = null;
function crowdPop(vol) {
  if (muted()) return;
  try {
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    if (!actx) actx = new AC();
    if (actx.state === 'suspended' && actx.resume) actx.resume();
    const t0 = actx.currentTime;
    const dur = 0.55;
    const buf = actx.createBuffer(1, Math.floor(actx.sampleRate * dur), actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; /* presentation only */
    const src = actx.createBufferSource();
    src.buffer = buf;
    const bp = actx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.7;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(clampN(vol || 0.5, 0.05, 0.9), t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp); bp.connect(g); g.connect(actx.destination);
    src.start(t0); src.stop(t0 + dur);
  } catch (e) { /* audio is juice, never load-bearing */ }
}

/* ---------- parody roster (all original gimmicks — zero real names) -------- */
const ROSTER = [
  { name: 'THE MENTAL GIANT',    tag: 'READ A WHOLE BOOK ONCE',   fin: 'THE POP QUIZ' },
  { name: 'LORD HUSTLEBUCK',     tag: 'SELLS TICKETS TO HIMSELF', fin: 'THE HARD SELL' },
  { name: 'THE CRIMSON CHINSTRAP', tag: 'JAW OF PURE CONFIDENCE', fin: 'THE OVERBITE' },
  { name: 'MADAM SUPLEX',        tag: 'POLITE. UNTIL SHE IS NOT.', fin: 'THE COURTESY DROP' },
  { name: 'THE TURNBUCKLE TORNADO', tag: 'AFRAID OF MIDDAY NAPS',  fin: 'SPIN CYCLE' },
  { name: 'BIG SLAMMU',          tag: '8FT OF QUESTIONABLE PHYSICS', fin: 'THE FOLDING CHAIR OF FORTUNE' }
];

const PS = 'pack-wwe:';
let shakeTimer = 0;

/* ---------- injected CSS ---------- */
let styleDone = false;
function ensureStyle() {
  if (styleDone || typeof document === 'undefined') return;
  styleDone = true;
  const st = document.createElement('style');
  st.id = 'iqb-pack-wwe-style';
  st.textContent =
    /* persistent crowd-meter strip (cosmetic, never interactive) */
    '#iqb-wwe-strip{position:fixed;top:42px;right:12px;z-index:72;display:flex;' +
    'align-items:center;gap:8px;padding:6px 10px;border-radius:10px;' +
    'background:rgba(10,6,18,.72);border:1px solid rgba(255,215,94,.35);' +
    'font:600 10px/1 \'Oxanium\',sans-serif;color:#f4e8c1;pointer-events:none}' +
    '.iqb-wwe-meterwrap{width:92px;height:8px;border-radius:4px;' +
    'background:rgba(255,255,255,.12);overflow:hidden}' +
    '.iqb-wwe-meterfill{height:100%;border-radius:4px;' +
    'background:linear-gradient(90deg,#ffb01e,#ff2038)}' +
    '.iqb-wwe-armed{color:#ffd75e;letter-spacing:.14em;text-shadow:0 0 8px rgba(255,180,20,.7)}' +
    /* SLAM screen-shake: CX-style transform jolt on the app shell */
    '@keyframes iqbWweShake{0%,100%{transform:translate(0,0)}' +
    '20%{transform:translate(-7px,3px)}40%{transform:translate(6px,-2px)}' +
    '60%{transform:translate(-4px,-3px)}80%{transform:translate(3px,2px)}}' +
    '#app.iqb-wwe-shake{animation:iqbWweShake .32s ease-out 1}' +
    /* entrance banner drop-in (gated: class added only when motion allowed) */
    '@keyframes iqbWweDrop{from{transform:translateX(-50%,-24px);opacity:0}' +
    'to{transform:translateX(-50%,0);opacity:1}}' +
    '.iqb-wwe-drop{animation:iqbWweDrop .45s ease-out 1}' +
    /* finisher confetti fall (gated the same way) */
    '@keyframes iqbWweFall{from{transform:translateY(-16px) rotate(0deg)}' +
    'to{transform:translateY(46vh) rotate(300deg)}}';
  const head = document.head || document.getElementsByTagName('head')[0];
  head.appendChild(st);
}

/* CX-style screen shake, IQB_MOTION-gated */
function shake() {
  if (typeof document === 'undefined' || !motionOK()) return;
  ensureStyle();
  const app = document.getElementById('app');
  if (!app) return;
  app.classList.remove('iqb-wwe-shake');
  void app.offsetWidth;                            /* restart animation */
  app.classList.add('iqb-wwe-shake');
  clearTimeout(shakeTimer);
  shakeTimer = setTimeout(() => app.classList.remove('iqb-wwe-shake'), 360);
}

/* persistent crowd-meter strip */
function renderStrip(meter, armed, belt) {
  if (typeof document === 'undefined') return;
  ensureStyle();
  let el = document.getElementById('iqb-wwe-strip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'iqb-wwe-strip';
    document.body.appendChild(el);
  }
  let html = '<span style="letter-spacing:.18em">CROWD</span>' +
    '<span class="iqb-wwe-meterwrap"><span class="iqb-wwe-meterfill" style="display:block;width:' +
    clampN(meter | 0, 0, 100) + '%"></span></span>';
  if (armed) html += '<span class="iqb-wwe-armed">FINISHER ARMED</span>';
  if (belt) html += beltChipSVG(18);
  el.innerHTML = html;
}

/* tiny inline-SVG championship belt (gold plate on dark strap) */
function beltChipSVG(size) {
  const w = size || 22;
  return '<svg width="' + w + '" height="' + Math.round(w * 0.55) +
    '" viewBox="0 0 44 24" aria-hidden="true" style="vertical-align:middle">' +
    '<rect x="0" y="7" width="44" height="10" rx="4" fill="#3a2408"/>' +
    '<circle cx="22" cy="12" r="9" fill="#ffd75e"/>' +
    '<circle cx="22" cy="12" r="5.5" fill="#c77dff"/>' +
    '<circle cx="8" cy="12" r="4" fill="#ffd75e"/>' +
    '<circle cx="36" cy="12" r="4" fill="#ffd75e"/></svg>';
}

/* best-effort display name for the belt note (read-only, cosmetic) */
function playerName() {
  try {
    if (document) {
      const n = document.querySelector('#side-panel .score-card.me .sc-name');
      if (n && n.textContent) return n.textContent.trim().slice(0, 24) || 'YOU';
    }
  } catch (e) {}
  try { if (typeof P !== 'undefined' && P && P.name) return String(P.name).slice(0, 24); } catch (e) {}
  return 'YOU';
}

/* ---------- the pack ---------- */
if (!Hooks || typeof Hooks.add !== 'function') return;   /* hooks.js not landed */

Hooks.add({
  id: 'pack-wwe',
  worlds: ['slam-arena'],
  weight: 2,
  handlers: {

    /* ENTRANCE + TITLE BELT note + meter strip refresh */
    onRoundStart: function (ctx) {
      const S = Hooks.state;

      if (!S.has(PS + 'meter')) {
        S.set(PS + 'meter', 0);
        S.set(PS + 'armed', false);
        S.set(PS + 'bestStreak', 0);
      }

      /* track championship form: highest streak seen this match */
      const streak = ctx.streak | 0;
      if (streak > (S.get(PS + 'bestStreak') | 0)) S.set(PS + 'bestStreak', streak);
      const beltHeld = (S.get(PS + 'bestStreak') | 0) >= 5;

      /* seeded rival pick — deterministic per (runId, round, dispatch seq) */
      const rng = typeof ctx.rng === 'function' ? ctx.rng : Math.random;
      const foe = ROSTER[Math.floor(rng() * ROSTER.length) % ROSTER.length] || ROSTER[0];
      S.set(PS + 'foe', foe.name);

      /* reset per-round beat flags */
      S.set(PS + 'taunted', false);
      S.set(PS + 'slammed', false);
      S.set(PS + 'elapsed', 0);

      renderStrip(S.get(PS + 'meter') | 0, !!S.get(PS + 'armed'), beltHeld);
      crowdPop(0.55);

      /* entrance banner: top strip, readable, pointer-events:none, <=~15% */
      const dropCls = motionOK() ? ' iqb-wwe-drop' : '';
      let ov =
        '<div style="position:absolute;left:50%;top:6%;transform:translateX(-50%);' +
        'max-width:min(720px,86vw);pointer-events:none;text-align:center">' +
        '<div style="display:inline-block;padding:10px 26px;border-radius:12px;' +
        'background:rgba(12,7,20,.78);border:2px solid rgba(255,215,94,.65);' +
        'box-shadow:0 0 24px rgba(255,160,20,.25)">' +
        '<div style="font-size:10px;letter-spacing:.34em;color:#ffb01e">TONIGHT\'S OPPONENT</div>' +
        '<div style="font-size:min(4vw,26px);font-weight:900;letter-spacing:.12em;color:#ffd75e;' +
        'text-shadow:0 2px 0 #7a2a00">' + foe.name + '</div>' +
        '<div style="font-size:11px;letter-spacing:.08em;color:#f4e8c1;margin-top:2px">"' +
        foe.tag + '"</div></div></div>';

      /* TITLE BELT: cosmetic sidebar note beside the scoreboard player name */
      if (beltHeld) {
        ov +=
        '<div style="position:absolute;right:12px;top:96px;pointer-events:none;' +
        'padding:8px 12px;border-radius:10px;background:rgba(12,7,20,.78);' +
        'border:1px solid rgba(255,215,94,.55);text-align:right">' +
        '<div style="font-size:9px;letter-spacing:.28em;color:#ffb01e">CHAMPION</div>' +
        '<div style="font-size:13px;font-weight:700;color:#f4e8c1">' +
        beltChipSVG(26) + ' <span>' + playerName() + '</span></div></div>';
      }

      return {
        bannerText: '\u2694 ENTRANCE: ' + foe.name,
        overlayHTML: '<div style="position:absolute;inset:0;overflow:hidden;pointer-events:none">' + ov + '</div>',
        overlayMs: 4200,
        sfx: 'sting',
        flag: 'pack-wwe:entrance:' + foe.name.toLowerCase().replace(/[^a-z]+/g, '-')
      };
    },

    /* TAUNT -> SLAM timeline (elapsed-time accumulation, pack-stones style) */
    onTick: function (ctx) {
      const S = Hooks.state;
      if (S.get(PS + 'slammed')) return undefined;

      const dt = (typeof ctx.dtSec === 'number' && isFinite(ctx.dtSec))
        ? clampN(ctx.dtSec, 0, 0.25) : (1 / 60);
      const elapsed = (S.get(PS + 'elapsed') || 0) + dt;
      S.set(PS + 'elapsed', elapsed);

      const tl = (ctx.timerLen | 0) || 60;
      const tauntAt = Math.max(2, tl * 0.4);
      const slamAt = tauntAt + 1.5;                  /* telegraph window */

      if (!S.get(PS + 'taunted') && elapsed >= tauntAt && elapsed < slamAt) {
        S.set(PS + 'taunted', true);
        return {
          bannerText: 'YOU\'RE GONNA GET SLAMMED!',
          flag: 'pack-wwe:taunt'
        };
      }

      if (elapsed >= slamAt) {
        S.set(PS + 'slammed', true);                 /* exactly once per round */

        /* CROWD METER: the slam pops the crowd +15; arm the finisher at 100 */
        const meter = clampN((S.get(PS + 'meter') | 0) + 15, 0, 100);
        let armed = !!S.get(PS + 'armed');
        if (meter >= 100) armed = true;
        S.set(PS + 'meter', meter);
        S.set(PS + 'armed', armed);
        renderStrip(meter, armed, (S.get(PS + 'bestStreak') | 0) >= 5);

        shake();                                     /* CX-style CSS jolt, motion-gated */
        crowdPop(0.7);

        return {
          disableWrongRandom: 1,       /* ENGINE picks a WRONG victim — never correctIdx */
          bannerText: 'BOOM! SLAM! ONE PATH JUST GOT BROUGHT TO SMACKDOWN STREET',
          flag: 'pack-wwe:slam'
        };
      }
      return undefined;
    },

    /* finisher consumption happens BEFORE scoring so the engine's
     * correct-award branch sees scoreMul:1.5 (wrong branch ignores it). */
    onPreAnswer: function (ctx) {
      const S = Hooks.state;
      if (!S.get(PS + 'armed')) return undefined;
      S.set(PS + 'pendingFinisher', true);
      S.set(PS + 'armed', false);                    /* spent — re-arms if wrong */
      renderStrip(S.get(PS + 'meter') | 0, false, (S.get(PS + 'bestStreak') | 0) >= 5);
      void ctx;
      return {
        scoreMul: 1.5,
        flag: 'pack-wwe:finisher-request'
      };
    },

    /* CROWD METER bookkeeping + finisher landing/confetti */
    onAnswer: function (ctx) {
      const S = Hooks.state;
      const res = ctx.res || {};
      const correct = !!res.correct;

      const streak = ctx.streak | 0;
      if (streak > (S.get(PS + 'bestStreak') | 0)) S.set(PS + 'bestStreak', streak);

      let meter = S.get(PS + 'meter') | 0;
      meter = clampN(meter + (correct ? 15 : -10), 0, 100);
      if (meter >= 100 && !S.get(PS + 'pendingFinisher')) S.set(PS + 'armed', true);

      const mod = {};

      if (correct && S.get(PS + 'pendingFinisher')) {
        /* FINISHER LANDS: ×1.5 already granted via onPreAnswer; celebrate,
         * reset the meter, keep the belt race running. */
        S.del(PS + 'pendingFinisher');
        meter = 0;
        const foeName = String(S.get(PS + 'foe') || 'THE CHALLENGER');
        const foe = ROSTER.filter(r => r.name === foeName)[0] || ROSTER[0];
        mod.bannerText = 'FINISHER!' + foe.fin + ' CONNECTS! \u00D71.5';
        mod.sfx = 'sting';
        mod.flag = 'pack-wwe:finisher-landed';

        /* confetti burst — small pieces, motion-gated, pointer-events:none */
        let bits = '<div style="position:absolute;left:50%;top:30%;transform:translateX(-50%);' +
          'font-weight:900;letter-spacing:.3em;font-size:min(6vw,44px);color:#ffd75e;' +
          'text-shadow:0 0 22px rgba(255,180,20,.65)">OHHHHH!</div>';
        if (motionOK()) {
          const cols = ['#ffd75e', '#ff5d8f', '#3ec6ff', '#7cffb2', '#c77dff'];
          for (let i = 0; i < 26; i++) {
            bits += '<span style="position:absolute;left:' + ((i * 137) % 100) +
              '%;top:-4%;width:7px;height:11px;background:' + cols[i % cols.length] +
              ';animation:iqbWweFall ' + (0.9 + (i % 5) * 0.22) + 's ease-in 1 forwards"></span>';
          }
        }
        mod.overlayHTML = '<div style="position:absolute;inset:0;overflow:hidden;pointer-events:none">' +
          bits + '</div>';
        mod.overlayMs = 2200;
        crowdPop(0.85);
      } else if (correct) {
        crowdPop(0.4);
      } else if (S.get(PS + 'pendingFinisher')) {
        /* finisher whiffed: re-arm — it waits for the NEXT correct answer */
        S.del(PS + 'pendingFinisher');
        S.set(PS + 'armed', true);
        mod.flag = 'pack-wwe:finisher-rearm';
      }

      S.set(PS + 'meter', meter);
      renderStrip(meter, !!S.get(PS + 'armed'), (S.get(PS + 'bestStreak') | 0) >= 5);

      return (Object.keys(mod).length ? mod : undefined);
    }
  }
});

/* ---------- world: slam-arena (neutral backdrops) -------------------------- */
const Worlds = root.IQ.Worlds;
if (Worlds && typeof Worlds.register === 'function') {
  Worlds.register({
    id: 'slam-arena',
    align: 'neutral',
    pal: ['#ffd75e', '#ff5d8f', '#c77dff', '#12121c', '#ffb01e', '#3ec6ff',
          '#7cffb2', '#f2f2f2'],
    draw(c, w, h, t) {
      /* house lights: warm haze over dark stands */
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#0a0612'); g.addColorStop(0.55, '#170d22');
      g.addColorStop(1, '#0d0716');
      c.fillStyle = g; c.fillRect(0, 0, w, h);

      /* crowd: tiered stands of twinkling fan dots (two banks) */
      for (let bank = 0; bank < 2; bank++) {
        const rows = 6;
        for (let r = 0; r < rows; r++) {
          const y = h * (bank === 0 ? 0.10 : 0.62) + r * h * 0.032;
          for (let i = 0; i < 26; i++) {
            const seed = (i * 97 + r * 31 + bank * 57) % 1000;
            const x = ((seed / 1000) * w + Math.sin(t * 0.3 + seed) * 3 + w) % w;
            const tw = 0.25 + 0.2 * Math.sin(t * 2 + seed * 0.37);
            c.fillStyle = 'rgba(255,' + (170 + (seed % 70)) + ',110,' + tw.toFixed(3) + ')';
            c.fillRect(x, y, 2, 2);
          }
        }
      }

      /* sweeping spotlights (slow, low-alpha, never over the board center) */
      for (let s = 0; s < 2; s++) {
        const ang = Math.sin(t * 0.4 + s * 2.4) * 0.6;
        const ox = w * (s === 0 ? 0.18 : 0.82);
        const oy = h * 0.02;
        const lx = ox + Math.sin(ang) * w * 0.3;
        c.fillStyle = 'rgba(255,225,150,0.05)';
        c.beginPath();
        c.moveTo(ox - 14, oy);
        c.lineTo(lx - w * 0.09, oy + h * 0.85);
        c.lineTo(lx + w * 0.09, oy + h * 0.85);
        c.closePath(); c.fill();
      }

      /* the ring: apron, mat, three ropes with slight sag perspective */
      const rx = w * 0.5, ry = h * 0.78, rw = w * 0.52, rh = h * 0.16;
      c.fillStyle = '#1d1026';
      c.fillRect(rx - rw / 2, ry, rw, rh);                 /* apron */
      c.fillStyle = '#2a1740';
      c.fillRect(rx - rw / 2 + rw * 0.04, ry + rh * 0.12, rw * 0.92, rh * 0.5);
      c.strokeStyle = 'rgba(255,215,94,.5)'; c.lineWidth = 1.5;
      c.strokeRect(rx - rw / 2 + rw * 0.04, ry + rh * 0.12, rw * 0.92, rh * 0.5);
      const ropeCols = ['rgba(61,198,255,.55)', 'rgba(255,215,94,.55)', 'rgba(255,93,143,.55)'];
      for (let i = 0; i < 3; i++) {
        const yy = ry - rh * (0.10 + i * 0.16);
        c.strokeStyle = ropeCols[i]; c.lineWidth = 2;
        c.beginPath();
        c.moveTo(rx - rw / 2, yy);
        c.quadraticCurveTo(rx, yy + 4 + i * 2 + Math.sin(t * 1.1 + i) * 2, rx + rw / 2, yy);
        c.stroke();
      }
      /* corner posts */
      c.fillStyle = '#c77dff';
      c.fillRect(rx - rw / 2 - 3, ry - rh * 0.55, 6, rh * 0.6);
      c.fillRect(rx + rw / 2 - 3, ry - rh * 0.55, 6, rh * 0.6);

      /* titantron glow above the ring */
      const tg = c.createRadialGradient(rx, h * 0.30, 4, rx, h * 0.30, w * 0.14);
      const pulse = 0.10 + 0.04 * Math.sin(t * 0.8);
      tg.addColorStop(0, 'rgba(255,215,94,' + pulse.toFixed(3) + ')');
      tg.addColorStop(1, 'rgba(255,215,94,0)');
      c.fillStyle = tg;
      c.beginPath(); c.arc(rx, h * 0.30, w * 0.14, 0, 7); c.fill();

      /* vignette keeps puzzle text zones calm and readable */
      const v = c.createRadialGradient(rx, h * 0.42, Math.min(w, h) * 0.30, rx, h * 0.42, Math.max(w, h) * 0.75);
      v.addColorStop(0, 'rgba(10,6,18,0)');
      v.addColorStop(1, 'rgba(10,6,18,.58)');
      c.fillStyle = v; c.fillRect(0, 0, w, h);
    }
  });
}

/* tiny introspection surface (tests/debug only — no gameplay authority) */
root.IQ.PackWWE = { roster: ROSTER, prefix: PS };

if (typeof module !== 'undefined' && module.exports) module.exports = root.IQ.PackWWE;
})();
