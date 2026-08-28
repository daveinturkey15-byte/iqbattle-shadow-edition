/* ============================================================================
 * IQ.WorldsMind — W1 expansion pack #1 (contracts: research/w1-contracts.md C3)
 *
 * Five registered worlds for IQ.Worlds (worlds.js):
 *   basement-thing  bad      single flickering bulb cone, long shadow that
 *                            slowly turns toward the viewer over a 60s cycle
 *   mountain-ascent neutral   thin-air haze rising, prayer-flag specks; scene
 *                            brightens along a neutral->good gradient by t
 *   womb            good     warm heartbeat radial pulse @40bpm + amniotic drift
 *   bad-trip        chaotic  hue-cycling melting saturation waves + breathing
 *                            geometry; arms the flashback callback primitive
 *   stair-of-heaven good     golden steps ascending into light, dark motes
 *                            falling along the left edge
 *
 * Exposes window.IQ.WorldsMind:
 *   .rng(seed)          mulberry32 (gen_iqb.js pattern) — deterministic
 *   .flashbackPending() true once AFTER bad-trip was applied and a later good
 *                       world followed; first read consumes it -> false.
 *                       Consumers may fire their own flashback beat.
 *
 * HARD RULES honored: asset-free canvas; never touches puzzle glyphs; every
 * draw() is a pure function of t so Worlds.startLoop's static-frame path
 * (IQB_MOTION off -> draw(...,0)) renders a valid still; nothing exceeds 3Hz
 * fullscreen (bulb flicker ~<=2.2Hz, heartbeat 40bpm ~0.67Hz).
 * ============================================================================*/
(function () {
'use strict';
const root = typeof window !== 'undefined' ? window : globalThis;
root.IQ = root.IQ || {};

/* ---------- deterministic rng (mulberry32, gen_iqb.js pattern) ---------- */
function mulberry32(seed){
 let a = (seed != null ? seed : 1) >>> 0;
 return function(){
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
 };
}

function clamp01(v){ return v < 0 ? 0 : (v > 1 ? 1 : v); }
function lerp(a, b, u){ return a + (b - a) * u; }
/* hex '#rrggbb' -> [r,g,b] */
function rgb(hex){
 return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}
function mixHex(h1, h2, u){
 const a = rgb(h1), b = rgb(h2);
 return 'rgb(' + Math.round(lerp(a[0],b[0],u)) + ',' + Math.round(lerp(a[1],b[1],u)) + ',' + Math.round(lerp(a[2],b[2],u)) + ')';
}
/* smooth low-rate flicker: dominant partials <= ~2.2Hz (flash rule safe) */
function flicker(t){
 return 0.82 + 0.10 * Math.sin(t * 4.1) * Math.sin(t * 1.3) + 0.08 * Math.sin(t * 13.7 + 1.7);
}

/* ---------- precomputed deterministic layouts (fixed seeds) ---------- */
function seeded(n, seed, fn){
 const r = mulberry32(seed), out = [];
 for (let i = 0; i < n; i++) out.push(fn(i, r));
 return out;
}
/* basement: dust motes [x,y,size] */
const DUST = seeded(22, 101, (i, r) => [r(), r(), 1 + r() * 2]);
/* mountain: prayer-flag specks [x01,y01,speed,sway,colorIdx] */
const FLAGS = seeded(34, 202, (i, r) => [r(), r(), 0.02 + r() * 0.04, r() * 6.28, i % 5]);
/* womb: amniotic floaters [x01,y01,r01,phase] */
const FLOATERS = seeded(16, 303, (i, r) => [r(), r(), 0.03 + r() * 0.09, r() * 6.28]);
/* bad-trip: wave band phases */
const WAVES = seeded(9, 404, (i, r) => ({ ph: r() * 6.28, spd: 0.25 + r() * 0.4, amp: 14 + r() * 26 }));
/* stair-of-heaven: descending motes [x01, speed, size, jitter] */
const MOTES = seeded(30, 505, (i, r) => [r(), 0.02 + r() * 0.05, 1 + r() * 2.5, r() * 6.28]);

/* ---------- heartbeat envelope: double-thump at 40 bpm ---------- */
const BPM = 40;
function heartbeat(t){
 const p = ((t * BPM) / 60) % 1;
 const thump = Math.exp(-p * 9) + 0.55 * Math.exp(-Math.max(0, p - 0.18) * 12);
 return clamp01(thump);
}

/* ============================ world defs ================================= */
const DEFS = [
{ id:'basement-thing', align:'bad',
  pal:['#d8c07a','#8f7b3f','#3a3324','#15130d','#241f14','#574a28','#0b0a06','#e8dcab'],
  draw(c, w, h, t){
   /* room: near-black walls, faint warm pool of light on the floor */
   c.fillStyle = '#0b0a06'; c.fillRect(0, 0, w, h);
   const fl = flicker(t);
   const bx = w * 0.5, byTop = -h * 0.02, bulbY = h * 0.16;

   /* light cone from the bulb (alpha follows flicker) */
   const cone = c.createLinearGradient(0, bulbY, 0, h);
   cone.addColorStop(0, 'rgba(216,192,122,' + (0.30 * fl).toFixed(3) + ')');
   cone.addColorStop(1, 'rgba(216,192,122,' + (0.04 * fl).toFixed(3) + ')');
   c.fillStyle = cone;
   c.beginPath();
   c.moveTo(bx - 10, bulbY); c.lineTo(bx + 10, bulbY);
   c.lineTo(bx + w * 0.42, h); c.lineTo(bx - w * 0.42, h);
   c.closePath(); c.fill();

   /* cord + bulb */
   c.strokeStyle = 'rgba(60,52,32,.9)'; c.lineWidth = 2;
   c.beginPath(); c.moveTo(bx, byTop); c.lineTo(bx, bulbY - 8); c.stroke();
   const glow = c.createRadialGradient(bx, bulbY, 2, bx, bulbY, 46);
   glow.addColorStop(0, 'rgba(255,238,180,' + (0.95 * fl).toFixed(3) + ')');
   glow.addColorStop(1, 'rgba(255,238,180,0)');
   c.fillStyle = glow;
   c.beginPath(); c.arc(bx, bulbY, 46, 0, 7); c.fill();

   /* floor pool */
   c.fillStyle = 'rgba(143,123,63,' + (0.10 * fl).toFixed(3) + ')';
   c.beginPath(); c.ellipse(bx, h * 0.97, w * 0.36, h * 0.05, 0, 0, 7); c.fill();

   /* THE THING: silhouette standing under the bulb; its long shadow slowly
    * turns toward the viewer across a 60s cycle — shadow swings from cast
    * away/sideways to foreshortened straight-at-camera while the figure
    * swells very slightly as it faces us. */
   const u = (t % 60) / 60;                 // 0..1 turn progress
   const turn = 0.5 - 0.5 * Math.cos(u * Math.PI); // ease-in-out 0->1->0
   const fx = bx, fy = h * 0.62;            // feet anchor
   const figH = h * 0.30 * (1 + 0.06 * turn);
   /* figure: head + tapering body, kept well clear of any UI glyphs */
   c.fillStyle = 'rgba(5,4,2,.96)';
   c.beginPath(); c.arc(fx, fy - figH, figH * 0.13, 0, 7); c.fill();
   c.beginPath();
   c.moveTo(fx - figH * 0.16, fy);
   c.quadraticCurveTo(fx - figH * 0.20, fy - figH * 0.55, fx - figH * 0.10, fy - figH * 0.86);
   c.lineTo(fx + figH * 0.10, fy - figH * 0.86);
   c.quadraticCurveTo(fx + figH * 0.20, fy - figH * 0.55, fx + figH * 0.16, fy);
   c.closePath(); c.fill();

   /* long shadow: direction sweeps +-~65deg, length shortens as it aims
    * at the viewer (perspective foreshortening) */
   const ang = lerp(-1.15, 1.15, turn);           // radians from straight-down
   const len = lerp(h * 0.55, h * 0.16, turn);    // toward camera = shorter
   const spread = lerp(figH * 0.22, figH * 0.62, turn); // wider as it faces us
   const sx = fx + Math.sin(ang) * len, sy = fy + Math.cos(ang) * len;
   c.fillStyle = 'rgba(0,0,0,' + (0.72 - 0.18 * turn).toFixed(3) + ')';
   c.beginPath();
   c.moveTo(fx - figH * 0.14, fy);
   c.lineTo(sx - spread, sy);
   c.lineTo(sx + spread, sy);
   c.lineTo(fx + figH * 0.14, fy);
   c.closePath(); c.fill();

   /* dust motes drifting through the cone (slow, deterministic) */
   for (let i = 0; i < DUST.length; i++){
    const d = DUST[i];
    const mx = (d[0] * w + Math.sin(t * 0.3 + i) * 12 + w) % w;
    const my = (d[1] * h + t * 6 * (0.4 + d[2])) % h;
    c.fillStyle = 'rgba(232,220,171,' + (0.16 * fl * d[1]).toFixed(3) + ')';
    c.fillRect(mx, my, d[2], d[2]);
   }
  }},

{ id:'mountain-ascent', align:'neutral',
  pal:['#9fb6cf','#dfe9f2','#e2b93b','#c0392b','#3f8f4f','#2f6fb8','#e8e6df','#6b8aa8'],
  draw(c, w, h, t){
   /* altitude gradient by t: gray valley air -> thin bright summit light */
   const u = clamp01(t / 45);
   const top = mixHex('#26344d', '#a8c8e8', u);
   const bot = mixHex('#3d4f66', '#dfe9f2', u);
   const g = c.createLinearGradient(0, 0, 0, h);
   g.addColorStop(0, top); g.addColorStop(1, bot);
   c.fillStyle = g; c.fillRect(0, 0, w, h);

   /* ridgelines recede as we climb */
   for (let k = 0; k < 3; k++){
    const rise = h * (0.78 - 0.10 * k - 0.22 * u);
    c.fillStyle = 'rgba(' + (30 + k * 18) + ',' + (38 + k * 20) + ',' + (54 + k * 24) + ',' + (0.85 - k * 0.18) + ')';
    c.beginPath(); c.moveTo(0, h);
    for (let x = 0; x <= w; x += 32){
     c.lineTo(x, rise + Math.sin(x * 0.006 + k * 2.4) * h * 0.06 - Math.sin(x * 0.0023 + k) * h * 0.05);
    }
    c.lineTo(w, h); c.closePath(); c.fill();
   }

   /* thin-air haze: translucent sheets rising and thinning with altitude */
   for (let i = 0; i < 5; i++){
    const f = ((t * 0.03) + i * 0.23) % 1;
    const hy = h * (1.05 - f * 0.9);
    c.fillStyle = 'rgba(223,233,242,' + (0.10 * (1 - u) * (1 - f)).toFixed(3) + ')';
    c.fillRect(0, hy, w, h * 0.16);
   }

   /* prayer-flag specks: 5 sacred colors, drifting upward on the wind */
   const cols = ['#2f6fb8', '#e8e6df', '#c0392b', '#3f8f4f', '#e2b93b'];
   for (let i = 0; i < FLAGS.length; i++){
    const s = FLAGS[i];
    const f = ((t * s[2]) + s[1]) % 1;
    const x = s[0] * w + Math.sin(t * 0.6 + s[3]) * 18;
    const y = h * (1.05 - f);
    c.globalAlpha = 0.7 * (1 - f) * (0.4 + 0.6 * u);
    c.fillStyle = cols[s[4]];
    c.fillRect(x, y, 3, 3);
   }
   c.globalAlpha = 1;
  }},

{ id:'womb', align:'good',
  pal:['#ffb99a','#ff8f6b','#c96f5a','#7a3b2e','#ffd0b0','#a34e3f','#5c2a22','#ffe6cf'],
  draw(c, w, h, t){
   const beat = heartbeat(t);
   const cx = w * 0.5, cy = h * 0.5;

   /* warm flesh gradient */
   const bg = c.createLinearGradient(0, 0, 0, h);
   bg.addColorStop(0, '#5c2a22'); bg.addColorStop(1, '#3c1a15');
   c.fillStyle = bg; c.fillRect(0, 0, w, h);

   /* heartbeat radial pulse: warm core swelling at 40bpm, double-thump */
   const R = Math.min(w, h) * (0.34 + 0.10 * beat);
   const rg = c.createRadialGradient(cx, cy, R * 0.08, cx, cy, R);
   rg.addColorStop(0, 'rgba(255,214,176,' + (0.55 + 0.25 * beat).toFixed(3) + ')');
   rg.addColorStop(0.6, 'rgba(201,111,90,' + (0.28 + 0.14 * beat).toFixed(3) + ')');
   rg.addColorStop(1, 'rgba(122,59,46,0)');
   c.fillStyle = rg;
   c.beginPath(); c.arc(cx, cy, R, 0, 7); c.fill();

   /* faint chamber wall: enclosing soft ellipse ring */
   c.strokeStyle = 'rgba(255,143,107,' + (0.10 + 0.08 * beat).toFixed(3) + ')';
   c.lineWidth = 14;
   c.beginPath(); c.ellipse(cx, cy, w * 0.44, h * 0.42, 0, 0, 7); c.stroke();

   /* muffled amniotic drift: slow blurred-feel floaters, low contrast */
   for (let i = 0; i < FLOATERS.length; i++){
    const f = FLOATERS[i];
    const x = cx + (f[0] - 0.5) * w + Math.sin(t * 0.21 + f[3]) * w * 0.06;
    const y = cy + (f[1] - 0.5) * h + Math.cos(t * 0.17 + f[3] * 2) * h * 0.05;
    const r = f[2] * Math.min(w, h) * (1 + 0.08 * Math.sin(t * 0.5 + f[3]));
    c.fillStyle = 'rgba(255,208,176,0.07)';
    c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    c.fillStyle = 'rgba(163,78,63,0.10)';
    c.beginPath(); c.arc(x + r * 0.2, y + r * 0.2, r * 0.7, 0, 7); c.fill();
   }
  }},

{ id:'bad-trip', align:'chaotic',
  pal:['#ff3ea5','#7b2ff7','#00e5c7','#fff152','#ff6a00','#3a0ca3','#f72585','#4cc9f0'],
  draw(c, w, h, t){
   /* deep base that itself hue-drifts very slowly */
   const baseHue = (275 + 30 * Math.sin(t * 0.05)) % 360;
   c.fillStyle = 'hsl(' + baseHue.toFixed(1) + ',45%,7%)';
   c.fillRect(0, 0, w, h);

   /* melting saturation waves: horizontal bands whose edges sag like wet
    * paint; hue cycles ~20deg/s (well under flash limits), saturation
    * breathes per-band */
   for (let i = 0; i < WAVES.length; i++){
    const wv = WAVES[i];
    const yBase = h * (0.08 + 0.88 * i / WAVES.length);
    const hue = (baseHue + i * 38 + t * 20) % 360;
    const sat = 70 + 25 * Math.sin(t * 0.4 + wv.ph);
    c.fillStyle = 'hsla(' + hue.toFixed(1) + ',' + sat.toFixed(1) + '%,55%,0.16)';
    c.beginPath();
    c.moveTo(0, yBase);
    for (let x = 0; x <= w; x += 24){
     const sag = Math.sin(x * 0.012 + t * wv.spd + wv.ph) * wv.amp
               + Math.sin(x * 0.004 - t * 0.31 + wv.ph * 2) * wv.amp * 0.6;
     c.lineTo(x, yBase + sag);
    }
    c.lineTo(w, h); c.lineTo(0, h); c.closePath(); c.fill();
   }

   /* breathing geometry: concentric forms inhaling/exhaling ~0.8rad/s */
   const cx = w * 0.5, cy = h * 0.5;
   for (let k = 0; k < 4; k++){
    const br = 1 + 0.12 * Math.sin(t * 0.8 + k * 1.1);
    const rr = Math.min(w, h) * (0.12 + 0.09 * k) * br;
    const hue = (baseHue + 160 + k * 45 + t * 20) % 360;
    c.strokeStyle = 'hsla(' + hue.toFixed(1) + ',80%,60%,0.22)';
    c.lineWidth = 3 + 2 * Math.sin(t * 0.8 + k);
    c.beginPath();
    if (k % 2){ c.rect(cx - rr, cy - rr * 0.8, rr * 2, rr * 1.6); }
    else { c.moveTo(cx + rr, cy); c.arc(cx, cy, rr, 0, 7); }
    c.stroke();
   }
  }},

{ id:'stair-of-heaven', align:'good',
  pal:['#ffd700','#fff3b0','#e6c86e','#fffdf5','#f4d35e','#faf0ca','#b8912e','#ffe9a3'],
  draw(c, w, h, t){
   /* sky brightening toward upper-right source */
   const g = c.createLinearGradient(w, 0, 0, h);
   g.addColorStop(0, '#fffdf5'); g.addColorStop(0.45, '#faf0ca'); g.addColorStop(1, '#cdb87a');
   c.fillStyle = g; c.fillRect(0, 0, w, h);

   /* ascending golden steps into the light (upper right) */
   const n = 9;
   for (let i = 0; i < n; i++){
    const u = i / (n - 1);
    const sw = w * (0.16 + 0.30 * u);
    const sh = h * (0.055 + 0.012 * u);
    const x = w * 0.94 - sw - u * w * 0.06;
    const y = h * 0.92 - u * h * 0.68;
    const lum = 0.30 + 0.55 * u;
    c.fillStyle = 'rgba(230,200,110,' + lum.toFixed(3) + ')';
    c.fillRect(x, y, sw, sh);
    /* lit tread edge facing the light */
    c.fillStyle = 'rgba(255,247,214,' + (0.5 + 0.4 * u).toFixed(3) + ')';
    c.fillRect(x, y, sw, 3);
    /* soft halo around higher steps */
    if (u > 0.55){
     const hg = c.createRadialGradient(x + sw, y, 4, x + sw, y, w * 0.22);
     hg.addColorStop(0, 'rgba(255,215,0,' + (0.20 * u).toFixed(3) + ')');
     hg.addColorStop(1, 'rgba(255,215,0,0)');
     c.fillStyle = hg;
     c.beginPath(); c.arc(x + sw, y, w * 0.22, 0, 7); c.fill();
    }
   }

   /* the light itself: brilliant source top-right */
   const src = c.createRadialGradient(w * 0.97, h * 0.06, 8, w * 0.97, h * 0.06, Math.min(w, h) * 0.5);
   src.addColorStop(0, 'rgba(255,253,245,0.95)');
   src.addColorStop(0.35, 'rgba(255,243,176,0.45)');
   src.addColorStop(1, 'rgba(255,243,176,0)');
   c.fillStyle = src;
   c.beginPath(); c.arc(w * 0.97, h * 0.06, Math.min(w, h) * 0.5, 0, 7); c.fill();

   /* descending dark motes hugging the LEFT edge: slow fall, slight sway */
   const edge = w * 0.16;
   for (let i = 0; i < MOTES.length; i++){
    const m = MOTES[i];
    const f = ((t * m[1]) + i * 0.137) % 1;
    const x = m[0] * edge + Math.sin(t * 0.5 + m[3]) * 6;
    const y = f * h;
    c.fillStyle = 'rgba(52,42,18,' + (0.30 * (1 - f * 0.5)).toFixed(3) + ')';
    c.fillRect(x, y, m[2], m[2]);
   }
   /* faint dark vignette on the left edge anchoring the motes */
   const vg = c.createLinearGradient(0, 0, edge, 0);
   vg.addColorStop(0, 'rgba(52,42,18,0.22)'); vg.addColorStop(1, 'rgba(52,42,18,0)');
   c.fillStyle = vg; c.fillRect(0, 0, edge, h);
  }}
];

/* ==================== flashback callback primitive ======================== */
/* Armed when 'bad-trip' is applied. Once a later good world has been applied,
 * flashbackPending() returns TRUE exactly once, then disarms. */
let tripArmed = false, goodFollowed = false;
function noteTheme(id, align){
 if (id === 'bad-trip'){ tripArmed = true; goodFollowed = false; }
 else if (align === 'good') goodFollowed = true;
}
function flashbackPending(){
 if (tripArmed && goodFollowed){ tripArmed = false; goodFollowed = false; return true; }
 return false;
}

/* ============================ registry hookup ============================= */
const WorldsMind = {
 rng: mulberry32,
 flashbackPending: flashbackPending,
 _note: noteTheme,          // internal/test hook: noteTheme(id, align)
 worlds: DEFS.map(d => d.id)
};

const Worlds = root.IQ.Worlds;
if (Worlds && typeof Worlds.register === 'function'){
 DEFS.forEach(d => Worlds.register(d));
 /* Wrap apply() so theme transitions feed the flashback primitive. Idempotent. */
 if (!Worlds.__mindHooked && typeof Worlds.apply === 'function'){
  const origApply = Worlds.apply;
  Worlds.apply = function (id){
   try{
    const reg = root.IQ.Worlds;
    let align = null;
    /* resolve align cheaply: list(align) membership probe */
    for (const a of ['bad','good','chaotic','neutral']){
     if (reg.list && reg.list(a).indexOf(id) >= 0){ align = a; break; }
    }
    noteTheme(id || null, align);
   }catch(e){}
   return origApply.apply(this, arguments);
  };
  try{ Worlds.__mindHooked = true; }catch(e){}
 }
} else if (typeof module !== 'undefined' && module.exports){
 module.exports = WorldsMind; // headless (tests) — registration deferred to browser
}

root.IQ.WorldsMind = WorldsMind;
})();
