/* ============================================================================
 * WORLD BACKDROPS — 12 procedural canvas worlds across alignments.
 *
 * Dave's spec: "the music and art style of everything changes" per
 * alignment/theme. Each backdrop is a pure f(t) over fixed constants:
 *   bad     volcano · riot · trench
 *   chaotic lsd-melt · upside-down
 *   neutral limbo · purgatory
 *   good    heaven · womb · ocean · garden · stars
 *
 * Determinism rails: ZERO Math.random / Date.now — every "random" layout
 * variate comes from hash(i) (deterministic sin-hash). No fullscreen flashes;
 * all pulses/glow breathe slowly (>= ~1.2 s periods). Motion gating happens in
 * applyBackdrop (IQB_MOTION=0 or prefers-reduced-motion => single static frame
 * at t=0). Backdrops never recolor/animate question/answer glyphs (DNA.md).
 *
 * Integration (main.ts):
 *   import { applyBackdrop } from './worlds/backdrops.ts'; // registers all 12
 *   const stop = applyBackdrop(sceneRoot, 'volcano');      // Pixi Container
 *   stop();                                                // on scene exit
 * ==========================================================================*/

import { register, byId } from './registry.ts';
import './w/index.ts'; /* P5: registers the 22 named-setting worlds */
import { STAGE_W, STAGE_H } from '../theme.ts';

const TAU = Math.PI * 2;

/** Deterministic per-index variate in [0,1) — the only "randomness" allowed. */
function hash(n: number): number {
  return ((Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1 + 1) % 1;
}

function wrap(v: number, m: number): number {
  return ((v % m) + m) % m;
}

/** Soft elliptical blob via radial gradient; rgb='r,g,b'. */
function softBlob(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rgb: string, a: number): void {
  c.save();
  c.translate(x, y);
  c.scale(rx / 100, ry / 100);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, 100);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g;
  c.fillRect(-100, -100, 200, 200);
  c.restore();
}

interface FieldOpts {
  count: number;
  /** px per second along the travel axis */
  speed: number;
  size: number;
  color: string;
  maxA: number;
  rise: boolean;
  sway: number;
}

/** Deterministic drifting particle field (embers/ash/snow/bubbles/stars base). */
function driftField(c: CanvasRenderingContext2D, w: number, h: number, t: number, o: FieldOpts): void {
  const travel = h + 80;
  for (let i = 0; i < o.count; i++) {
    const sp = o.speed * (0.6 + hash(i * 3 + 1) * 0.8);
    const d = wrap((t * sp) / 1000 + hash(i) * travel, travel);
    const y = o.rise ? h - d : d - 40;
    const x = wrap(hash(i * 7 + 2) * w + Math.sin(t * 0.0006 * (0.5 + hash(i + 5)) + i * 2.3) * o.sway, w);
    const edge = Math.min(1, Math.min(d, travel - d) / 60); // fade at both ends
    c.globalAlpha = o.maxA * edge * (0.5 + hash(i * 11 + 4) * 0.5);
    c.fillStyle = o.color;
    c.beginPath();
    c.arc(x, y, o.size * (0.45 + hash(i * 13 + 6)), 0, TAU);
    c.fill();
  }
  c.globalAlpha = 1;
}

/** Jagged mountain ridge filled to the bottom; silhouette colour set by caller. */
function ridge(c: CanvasRenderingContext2D, w: number, h: number, baseY: number, peaks: number, seed: number): void {
  c.beginPath();
  c.moveTo(-4, h + 4);
  for (let i = 0; i <= peaks; i++) {
    c.lineTo((i / peaks) * (w + 8) - 4, h * baseY * (0.82 + hash(seed + i * 17) * 0.36));
  }
  c.lineTo(w + 4, h + 4);
  c.closePath();
  c.fill();
}

/** Light cone from a point; used by riot searchlights and heaven rays. */
function lightCone(c: CanvasRenderingContext2D, x: number, y: number, ang: number, len: number, half: number, rgb: string, a: number): void {
  const g = c.createRadialGradient(x, y, len * 0.05, x, y, len);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(x, y);
  c.arc(x, y, len, ang - half, ang + half);
  c.closePath();
  c.fill();
}

/* ------------------------------- bad ------------------------------------ */

function volcano(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#0d0206');
  sky.addColorStop(0.62, '#260603');
  sky.addColorStop(1, '#4a0e03');
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);

  c.fillStyle = '#150302';
  ridge(c, w, h, 0.74, 6, 41);
  c.fillStyle = '#1c0402';
  ridge(c, w, h, 0.84, 9, 87);

  // lava lake glow — slow breath (~1.4 s), localized to the bottom third
  const pulse = 0.75 + 0.25 * Math.sin(t / 1400);
  softBlob(c, w * 0.5, h * 1.04, w * 0.62, h * 0.42 * pulse + 30, '255,110,26', 0.5);
  softBlob(c, w * 0.24, h * 1.06, w * 0.3, h * 0.22, '224,36,94', 0.28);

  // crust cracks (static geometry, shimmering alpha)
  c.strokeStyle = 'rgba(255,160,40,' + (0.32 + 0.14 * Math.sin(t / 900)).toFixed(4) + ')';
  c.lineWidth = 2;
  for (let i = 0; i < 7; i++) {
    const x0 = hash(i * 29) * w;
    c.beginPath();
    c.moveTo(x0, h * (0.93 + hash(i) * 0.05));
    c.lineTo(x0 + (hash(i + 3) - 0.5) * 140, h * (0.97 + hash(i + 7) * 0.03));
    c.stroke();
  }

  // rising embers
  driftField(c, w, h, t, { count: 46, speed: 34, size: 2.6, color: '#ff9a3c', maxA: 0.85, rise: true, sway: 18 });
}

function riot(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#0b0e16');
  sky.addColorStop(1, '#151a26');
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);

  // city silhouettes (two static rows from the hash)
  c.fillStyle = '#080a10';
  for (let i = 0; i < 16; i++) {
    const bw = 40 + hash(i * 31) * 90;
    c.fillRect(hash(i) * w, h * (0.55 + hash(i + 51) * 0.2), bw, h);
  }
  c.fillStyle = '#0d1019';
  for (let i = 0; i < 12; i++) {
    const bw = 60 + hash(i * 47 + 9) * 120;
    c.fillRect(hash(i * 13 + 5) * w, h * (0.68 + hash(i + 77) * 0.16), bw, h);
  }

  // drifting haze bands
  for (let k = 0; k < 3; k++) {
    const hx = wrap(t * (0.008 + k * 0.005) + hash(k * 19) * (w + 500), w + 500) - 250;
    softBlob(c, hx, h * (0.42 + k * 0.18), 320, 60, '154,167,186', 0.05);
  }

  // two sweeping searchlights (slow pendulums)
  const sweep = t / 2800;
  lightCone(c, w * 0.16, h * 0.02, Math.PI / 2 + Math.sin(sweep) * 0.62, h * 1.35, 0.085, '255,236,189', 0.10);
  lightCone(c, w * 0.84, h * 0.02, Math.PI / 2 + Math.sin(sweep + 2.4) * 0.62, h * 1.35, 0.085, '255,236,189', 0.10);

  // rooftop beacon — small, slow, localized
  const blink = 0.35 + 0.35 * Math.sin(t / 1300);
  softBlob(c, w * 0.63, h * 0.56, 26, 26, '255,32,56', blink * 0.5);
}

function trench(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const sea = c.createLinearGradient(0, 0, 0, h);
  sea.addColorStop(0, '#06203c');
  sea.addColorStop(0.5, '#031228');
  sea.addColorStop(1, '#01050e');
  c.fillStyle = sea;
  c.fillRect(0, 0, w, h);

  // faint surface shafts swaying
  for (let i = 0; i < 4; i++) {
    const sx = w * (0.12 + i * 0.22) + Math.sin(t / 3600 + i * 1.7) * 30;
    c.save();
    c.translate(sx, 0);
    c.rotate(0.16);
    c.fillStyle = 'rgba(126,178,226,0.045)';
    c.fillRect(-26, 0, 52, h);
    c.restore();
  }

  // marine snow
  driftField(c, w, h, t, { count: 38, speed: 12, size: 1.6, color: '#bcd6ee', maxA: 0.22, rise: false, sway: 10 });

  // jaws silhouette sliding in slowly from the right
  const dx = w * 0.10 + (Math.sin(t / 5200) * 0.5 + 0.5) * w * 0.16;
  const ax = w * 1.04 + dx - w * 0.1, ay = h * 0.10;           // upper corner
  const bx = w * 0.60 + dx - w * 0.1, by = h * 0.50;           // mouth tip
  const cx2 = ax, cy2 = h * 0.90;                              // lower corner
  c.save();
  c.fillStyle = '#01040a';
  c.beginPath();
  c.moveTo(ax, ay);
  c.lineTo(bx, by);
  c.lineTo(cx2, cy2);
  c.closePath();
  c.fill();
  c.strokeStyle = 'rgba(126,178,226,0.16)';
  c.lineWidth = 2;
  c.stroke();

  // teeth rows along both edges, apexes pointing into the mouth
  c.fillStyle = '#dfeaf5';
  for (const [px, py, qx, qy] of [[ax, ay, bx, by], [cx2, cy2, bx, by]] as const) {
    const ux = qx - px, uy = qy - py;
    const il = 1 / Math.hypot(ux, uy);
    const nx = uy * il, ny = -ux * il; // normal (points into mouth for both rows)
    for (let i = 1; i <= 8; i++) {
      const q = i / 9;
      const mx = px + ux * q, my = py + uy * q;
      const e = 14 * (1 - q * 0.45);
      const len = 26 * (1 - q * 0.35);
      c.globalAlpha = 0.85;
      c.beginPath();
      c.moveTo(mx - nx * e, my - ny * e);
      c.lineTo(mx + nx * e, my + ny * e);
      c.lineTo(mx + nx * len, my + ny * len);
      c.closePath();
      c.fill();
    }
  }
  c.globalAlpha = 1;

  // pale eye
  c.fillStyle = 'rgba(214,232,246,0.5)';
  c.beginPath();
  c.arc(ax - 70, ay + 60, 7, 0, TAU);
  c.fill();
  c.restore();
}

/* ------------------------------ chaotic --------------------------------- */

function lsdMelt(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  c.fillStyle = '#0a0612';
  c.fillRect(0, 0, w, h);
  const bands = 8;
  for (let i = 0; i < bands; i++) {
    const hue = wrap(t * 0.03 + i * 38, 360); // full wheel ~12 s — melt, not strobe
    c.fillStyle = `hsla(${hue.toFixed(1)},64%,50%,0.34)`;
    c.beginPath();
    c.moveTo(-4, h + 4);
    const yBase = h * ((i + 0.5) / bands);
    for (let x = -4; x <= w + 40; x += 44) {
      const y = yBase + Math.sin(x * 0.008 + t * 0.0012 + i * 1.7) * 26 + Math.sin(x * 0.0021 - t * 0.0007 + i) * 14;
      c.lineTo(x, y);
    }
    c.lineTo(w + 4, h + 4);
    c.closePath();
    c.fill();
  }
}

function upsideDown(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const bg = c.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#150a24');
  bg.addColorStop(0.5, '#0d0716');
  bg.addColorStop(1, '#150a24'); // mirrored sky — the world folded in half
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);

  // seven mirrored vine pairs: identical params top/bottom ⇒ perfect reflection
  for (let v = 0; v < 7; v++) {
    const rootX = ((v + 0.5) / 7) * w + (hash(v * 23) - 0.5) * 60;
    for (const dir of [1, -1]) {
      let x = rootX;
      let y = dir === 1 ? -8 : h + 8;
      c.strokeStyle = '#467a52';
      for (let s = 0; s <= 15; s++) {
        const seg = h / 16;
        const ang = dir * Math.PI / 2 + Math.sin(t * 0.0011 + v * 1.3 + s * 0.35) * (0.07 + s * 0.013);
        const nx = x + Math.sin(ang) * seg;
        const ny = y + Math.cos(ang) * seg * dir;
        c.lineWidth = 5.5 - s * 0.3;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(nx, ny);
        c.stroke();
        if (s % 2 === 1 && s > 1 && s < 14) {
          const la = ang + (hash(v * 31 + s) > 0.5 ? 1 : -1) * 1.1;
          c.save();
          c.translate(nx, ny);
          c.rotate(la);
          c.fillStyle = 'rgba(96,148,102,0.75)';
          c.beginPath();
          c.ellipse(seg * 0.32, 0, seg * 0.34, seg * 0.13, 0, 0, TAU);
          c.fill();
          c.restore();
        }
        x = nx;
        y = ny;
      }
    }
  }

  // faint spore motes floating between the folds
  driftField(c, w, h, t, { count: 24, speed: 9, size: 1.8, color: '#b79ae8', maxA: 0.25, rise: true, sway: 26 });
}

/* ------------------------------- neutral -------------------------------- */

function limbo(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#23262e');
  sky.addColorStop(1, '#0b0d11');
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);

  // distant monoliths — waiting rooms of the damned
  c.fillStyle = '#15171d';
  for (let i = 0; i < 6; i++) {
    const mw = 26 + hash(i * 43) * 54;
    c.fillRect(hash(i * 5) * w, h * (0.34 + hash(i + 91) * 0.3), mw, h);
  }

  // grey mist banks rolling sideways
  for (let k = 0; k < 6; k++) {
    const sp = 6 + hash(k * 71) * 10;
    const mx = wrap(t * 0.001 * sp * 10 * 0.1 + hash(k * 3) * (w + 700), w + 700) - 350;
    softBlob(c, mx, h * (0.30 + hash(k * 13 + 1) * 0.55), 300 + hash(k) * 140, 48 + hash(k + 8) * 30, '178,188,200', 0.055);
  }

  // dim ceiling glow that never quite arrives
  softBlob(c, w * 0.5, -h * 0.1, w * 0.7, h * 0.3, '210,216,226', 0.05);
}

function purgatory(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#1c1713');
  sky.addColorStop(1, '#0c0a08');
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);

  softBlob(c, w * 0.5, h * 0.55, w * 0.55, h * 0.3, '96,84,70', 0.06);

  // scorched ground line with dying embers
  c.fillStyle = '#080605';
  c.fillRect(0, h * 0.88, w, h * 0.12);
  for (let i = 0; i < 9; i++) {
    const a = 0.18 + 0.14 * Math.sin(t / 1100 + i * 2.1);
    softBlob(c, hash(i * 37) * w, h * (0.9 + hash(i) * 0.08), 30, 12, '255,122,26', a);
  }

  // ash fall
  driftField(c, w, h, t, { count: 64, speed: 16, size: 1.9, color: '#b9b4ac', maxA: 0.3, rise: false, sway: 14 });
}

/* -------------------------------- good ---------------------------------- */

function heaven(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#27406b');
  sky.addColorStop(0.55, '#7fa3cf');
  sky.addColorStop(1, '#d9cba4');
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);

  // sun disc + rotating gold rays (slow: full turn ~64 s)
  softBlob(c, w * 0.5, h * 0.06, w * 0.3, h * 0.24, '255,230,170', 0.4);
  const rot = t / 16000;
  for (let i = 0; i < 12; i += 2) {
    lightCone(c, w * 0.5, h * 0.04, rot + (i * TAU) / 12, h * 1.5, 0.055, '255,214,130', 0.06);
  }

  // cloud banks drifting at layered speeds
  for (let k = 0; k < 4; k++) {
    const sp = (4 + k * 3) * (hash(k) > 0.5 ? 1 : -1);
    const clx = wrap(w * hash(k * 17 + 3) + t * 0.001 * sp, w + 500) - 250;
    const cly = h * (0.42 + hash(k + 21) * 0.4);
    for (let p = 0; p < 5; p++) {
      softBlob(c, clx + (p - 2) * 70 + hash(k * 9 + p) * 24, cly + (hash(p * 7 + k) - 0.5) * 26, 110, 34, '246,240,228', 0.16);
    }
  }
}

function womb(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  c.fillStyle = '#2b0a16';
  c.fillRect(0, 0, w, h);

  // heartbeat envelope: 40 bpm = 1500 ms period, lub-dub double thump
  const ph = (t % 1500) / 1500;
  const beat = Math.exp(-ph * 5.5) + 0.45 * Math.exp(-Math.max(0, ph - 0.22) * 9);
  softBlob(c, w * 0.5, h * 0.52, Math.min(w, h) * (0.30 + 0.09 * beat), Math.min(w, h) * (0.26 + 0.08 * beat), '210,80,110', 0.34);
  softBlob(c, w * 0.5, h * 0.52, Math.min(w, h) * 0.13, Math.min(w, h) * 0.11, '255,140,160', 0.16 + 0.1 * beat);

  // vessel curves radiating outward, gently swaying
  c.strokeStyle = 'rgba(255,120,140,0.10)';
  c.lineWidth = 3;
  for (let i = 0; i < 7; i++) {
    const ang = (i / 7) * TAU;
    const swx = Math.sin(t / 2000 + i) * 8;
    c.beginPath();
    c.moveTo(w * 0.5, h * 0.52);
    c.quadraticCurveTo(
      w * 0.5 + Math.cos(ang) * w * 0.24 + swx,
      h * 0.52 + Math.sin(ang) * h * 0.22 - swx,
      w * 0.5 + Math.cos(ang) * w * 0.58,
      h * 0.52 + Math.sin(ang) * h * 0.52,
    );
    c.stroke();
  }
}

function ocean(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const sea = c.createLinearGradient(0, 0, 0, h);
  sea.addColorStop(0, '#0a3a4c');
  sea.addColorStop(1, '#02141d');
  c.fillStyle = sea;
  c.fillRect(0, 0, w, h);

  // rippling surface band
  c.strokeStyle = 'rgba(150,225,240,0.16)';
  c.lineWidth = 3;
  c.beginPath();
  for (let x = 0; x <= w; x += 24) {
    c.lineTo(x, h * 0.09 + Math.sin(x * 0.012 + t * 0.0016) * 7 + Math.sin(x * 0.004 - t * 0.0009) * 5);
  }
  c.stroke();

  // caustic net: interfering sine strands, vertical + horizontal
  c.strokeStyle = 'rgba(170,230,245,0.055)';
  c.lineWidth = 3;
  for (let i = 0; i < 12; i++) {
    const bx = w * ((i + 0.5) / 12);
    c.beginPath();
    for (let y = 0; y <= h; y += 26) {
      const x = bx + Math.sin(y * 0.010 + t * 0.001 + i * 1.9) * 30 + Math.sin(y * 0.0028 - t * 0.0006 + i) * 44;
      if (y === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const by = h * ((i + 0.5) / 6);
    c.beginPath();
    for (let x = 0; x <= w; x += 26) {
      const y = by + Math.sin(x * 0.009 - t * 0.0009 + i * 2.3) * 24 + Math.sin(x * 0.0031 + t * 0.0005) * 36;
      if (x === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  }

  // sparse bubbles rising
  driftField(c, w, h, t, { count: 18, speed: 22, size: 2.4, color: '#bfe8f2', maxA: 0.25, rise: true, sway: 8 });
}

function garden(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const glade = c.createLinearGradient(0, 0, 0, h);
  glade.addColorStop(0, '#16260f');
  glade.addColorStop(1, '#0a1408');
  c.fillStyle = glade;
  c.fillRect(0, 0, w, h);

  // static grass blades
  for (let i = 0; i < 26; i++) {
    const gx = hash(i * 53) * w;
    c.strokeStyle = i % 2 === 0 ? '#1e3a17' : '#26481c';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(gx, h);
    c.quadraticCurveTo(gx + (hash(i) - 0.5) * 30, h * 0.94, gx + (hash(i + 4) - 0.5) * 60, h * (0.86 + hash(i + 9) * 0.08));
    c.stroke();
  }

  // blooms drifting up like slow lanterns
  const petals = ['#e0245e', '#d4a017', '#a78bfa', '#ff7a1a'];
  for (let i = 0; i < 10; i++) {
    const sp = 7 + hash(i * 3) * 6;
    const fy = h + 30 - wrap((t * sp) / 1000 + hash(i) * (h + 60), h + 60);
    const fx = wrap(hash(i * 7 + 2) * w + Math.sin(t * 0.0006 + i) * 24, w);
    const col = petals[Math.floor(hash(i * 11 + 6) * petals.length)];
    const r = 7 + hash(i * 13) * 6;
    const spin = t * 0.00025 * (i % 2 === 0 ? 1 : -1);
    c.fillStyle = col;
    for (let p = 0; p < 5; p++) {
      const pa = spin + (p / 5) * TAU;
      c.globalAlpha = 0.65;
      c.beginPath();
      c.arc(fx + Math.cos(pa) * r, fy + Math.sin(pa) * r, r * 0.62, 0, TAU);
      c.fill();
    }
    c.globalAlpha = 0.9;
    c.fillStyle = '#f5f0dc';
    c.beginPath();
    c.arc(fx, fy, r * 0.45, 0, TAU);
    c.fill();
  }
  c.globalAlpha = 1;

  // pollen motes
  driftField(c, w, h, t, { count: 26, speed: 11, size: 1.4, color: '#ffe89a', maxA: 0.3, rise: true, sway: 20 });
}

function stars(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  c.fillStyle = '#04060e';
  c.fillRect(0, 0, w, h);

  softBlob(c, w * 0.72, h * 0.3, w * 0.3, h * 0.3, '88,110,220', 0.05);
  softBlob(c, w * 0.22, h * 0.66, w * 0.26, h * 0.26, '167,139,250', 0.04);

  // three parallax layers drifting left; twinkle is subtle, never flashing
  const layers = [
    { count: 70, sp: 1.5, size: 0.8, a: 0.45 },
    { count: 45, sp: 3.5, size: 1.3, a: 0.6 },
    { count: 25, sp: 7, size: 1.9, a: 0.8 },
  ];
  layers.forEach((L, li) => {
    for (let i = 0; i < L.count; i++) {
      const sy = hash(li * 991 + i * 7) * h;
      const sx = wrap(hash(li * 517 + i) * w - (t * L.sp) / 1000, w);
      const tw = 0.55 + 0.45 * Math.sin(t * 0.0009 * (0.5 + hash(i * 3)) + i);
      c.globalAlpha = L.a * tw;
      c.fillStyle = '#e8edfa';
      c.beginPath();
      c.arc(sx, sy, L.size * (0.6 + hash(i * 13 + li) * 0.7), 0, TAU);
      c.fill();
      if (li === 2 && i % 6 === 0) {
        c.strokeStyle = 'rgba(232,237,250,0.35)';
        c.lineWidth = 1;
        const r = L.size * 3.2;
        c.beginPath();
        c.moveTo(sx - r, sy);
        c.lineTo(sx + r, sy);
        c.moveTo(sx, sy - r);
        c.lineTo(sx, sy + r);
        c.stroke();
      }
    }
  });
  c.globalAlpha = 1;
}

/* -------------------- registration + scene application ------------------ */

register({ id: 'volcano', align: 'bad', draw: volcano });
register({ id: 'riot', align: 'bad', draw: riot });
register({ id: 'trench', align: 'bad', draw: trench });
register({ id: 'lsd-melt', align: 'chaotic', draw: lsdMelt });
register({ id: 'upside-down', align: 'chaotic', draw: upsideDown });
register({ id: 'limbo', align: 'neutral', draw: limbo });
register({ id: 'purgatory', align: 'neutral', draw: purgatory });
register({ id: 'heaven', align: 'good', draw: heaven });
register({ id: 'womb', align: 'good', draw: womb });
register({ id: 'ocean', align: 'good', draw: ocean });
register({ id: 'garden', align: 'good', draw: garden });
register({ id: 'stars', align: 'good', draw: stars });

/** Minimal structural view of a Pixi Container — keeps this module node-safe.
 *  Children are `unknown` so a real Pixi Container (generic addChildAt bound
 *  to ContainerChild) assigns without casts at the callsite. */
export interface BackdropHost {
  addChildAt(child: unknown, index: number): unknown;
  removeChild(child: unknown): unknown;
}


function motionOn(): boolean {
  const g = globalThis as unknown as { IQB_MOTION?: string; matchMedia?: (q: string) => MediaQueryList; localStorage?: Storage };
  if (g.IQB_MOTION === '0') return false;
  try {
    if (g.localStorage?.getItem('IQB_MOTION') === '0') return false;
  } catch { /* private mode */ }
  try {
    if (g.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  } catch { /* no matchMedia */ }
  return true;
}

/**
 * Mount `worldId`'s backdrop as the bottom-most child of a Pixi scene:
 * offscreen canvas -> Sprite -> rAF loop redrawing pure f(now).
 * Returns cleanup (removes sprite, cancels loop). Safe to call before the
 * async pixi load resolves. With motion reduced, draws ONE static frame at
 * t=0 and never animates.
 */
export function applyBackdrop(host: BackdropHost, worldId: string, opts?: { w?: number; h?: number }): () => void {
  let dead = false;
  let teardown: (() => void) | null = null;
  void import('pixi.js').then(({ Sprite, Texture }) => {
    if (dead) return;
    const w = opts?.w ?? STAGE_W;
    const h = opts?.h ?? STAGE_H;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const c = cv.getContext('2d');
    const def = byId(worldId);
    if (!c || !def) return;
    const tex = Texture.from(cv);
    const spr = new Sprite(tex);
    host.addChildAt(spr, 0);
    let raf = 0;
    const frame = (now: number): void => {
      def.draw(c, w, h, now);
      tex.source.update();
      raf = requestAnimationFrame(frame);
    };
    if (motionOn()) raf = requestAnimationFrame(frame);
    else def.draw(c, w, h, 0);
    teardown = (): void => {
      cancelAnimationFrame(raf);
      host.removeChild(spr);
      spr.destroy();
    };
  }).catch(() => { /* headless/no-pixi envs stay no-op; cleanup still safe */ });
  return (): void => {
    dead = true;
    teardown?.();
    teardown = null;
  };
}

