import { hash, wash, softBlob, wrap, type WorldDef } from './kit.ts';

export const WORLD: WorldDef = {
  id: 'spider-nest',
  align: 'bad',
  draw(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const cx = w * 0.5;
    const cy = h * 0.52;
    const diag = Math.sqrt(w * w + h * h);
    const TAU = Math.PI * 2;
    c.globalAlpha = 1;
    c.fillStyle = '#070a12';
    c.fillRect(0, 0, w, h);
    const washFn = wash as unknown as (cc: CanvasRenderingContext2D, ww: number, hh: number, tt: number) => void;
    const wrapFn = wrap as unknown as (v: number, m: number) => number;
    const blobFn = softBlob as unknown as (cc: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, a: number) => void;
    try {
      washFn(c, w, h, t);
    } catch (e) {
      void e;
    }
    const lg = c.createLinearGradient(0, 0, 0, h);
    lg.addColorStop(0, '#141c36');
    lg.addColorStop(0.42, '#0a0e1c');
    lg.addColorStop(0.62, '#070a13');
    lg.addColorStop(1, '#16203c');
    c.fillStyle = lg;
    c.fillRect(0, 0, w, h);
    const vg = c.createRadialGradient(cx, cy, diag * 0.04, cx, cy, diag * 0.72);
    vg.addColorStop(0, 'rgba(3,5,10,0.88)');
    vg.addColorStop(0.55, 'rgba(3,5,10,0.46)');
    vg.addColorStop(1, 'rgba(30,40,80,0.0)');
    c.fillStyle = vg;
    c.fillRect(0, 0, w, h);
    let rawW = t % 8000;
    try {
      rawW = wrapFn(t, 8000);
    } catch (e) {
      void e;
    }
    const wt = Number.isFinite(rawW) ? rawW : t % 8000;
    const driftPh = (wt / 8000) * TAU;
    for (let i = 0; i < 8; i++) {
      const b0 = 200 + i * 7;
      const ha = hash(b0);
      const hb = hash(b0 + 1);
      const hc = hash(b0 + 2);
      const ang = ha * TAU;
      const ex = cx + Math.cos(ang) * w * 0.54;
      const ey = cy + Math.sin(ang) * h * 0.58;
      const br = 60 + hb * 150 + diag * 0.05;
      const col = hc < 0.5 ? '#2a3a78' : '#4a2c6e';
      try {
        blobFn(c, ex, ey, br, col, 0.4);
      } catch (e) {
        void e;
      }
      const gg = c.createRadialGradient(ex, ey, 0, ex, ey, br);
      gg.addColorStop(0, hc < 0.5 ? 'rgba(50,70,140,0.28)' : 'rgba(90,55,140,0.24)');
      gg.addColorStop(1, 'rgba(0,0,0,0.0)');
      c.globalAlpha = 1;
      c.fillStyle = gg;
      c.beginPath();
      c.arc(ex, ey, br, 0, TAU);
      c.fill();
    }
    const ax: number[] = [-0.06 * w, 1.06 * w, 0.5 * w];
    const ay: number[] = [-0.1 * h, -0.08 * h, 1.12 * h];
    for (let a = 0; a < 3; a++) {
      const anx = ax[a] ?? 0;
      const any = ay[a] ?? 0;
      const baseAng = Math.atan2(cy - any, cx - anx);
      for (let k = 0; k < 13; k++) {
        const qb = 1000 + a * 200 + k * 5;
        const j1 = hash(qb);
        const j2 = hash(qb + 1);
        const j3 = hash(qb + 2);
        const ang = baseAng + (k / 12 - 0.5) * 1.15 + (j1 - 0.5) * 0.2;
        const len = diag * (0.72 + j2 * 0.5);
        const ex = anx + Math.cos(ang) * len;
        const ey = any + Math.sin(ang) * len;
        const mx = (anx + ex) * 0.5;
        const my = (any + ey) * 0.5;
        const amp = 4 + j3 * 9;
        const wob = Math.sin(TAU * t / 3400 + j1 * TAU - k * 0.55 - a * 1.7) * amp;
        const px = -Math.sin(ang);
        const py = Math.cos(ang);
        c.globalAlpha = 0.24 + j2 * 0.12;
        c.strokeStyle = j3 < 0.5 ? '#8fa0c8' : '#a8b8dc';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(anx, any);
        c.quadraticCurveTo(mx + px * wob, my + py * wob, ex, ey);
        c.stroke();
      }
      for (let rI = 1; rI <= 6; rI++) {
        const rb = 3000 + a * 60 + rI * 3;
        const rh = hash(rb);
        const rh2 = hash(rb + 1);
        const rad = diag * (0.1 + rI * 0.085 + rh * 0.02);
        const breathe = 1 + 0.016 * Math.sin(TAU * t / 5200 + rh * TAU + a * 2.1);
        const rr = rad * breathe;
        const spread = 0.62 + rh2 * 0.25;
        c.globalAlpha = 0.16 + (1 - rI / 7) * 0.1;
        c.strokeStyle = '#7e90bd';
        c.lineWidth = 1;
        c.beginPath();
        c.arc(anx, any, rr, baseAng - spread, baseAng + spread);
        c.stroke();
      }
    }
    for (let i = 0; i < 40; i++) {
      const db = 5000 + i * 4;
      const d1 = hash(db);
      const d2 = hash(db + 1);
      const d3 = hash(db + 2);
      const ai = Math.floor(d1 * 3) % 3;
      const anx = ax[ai] ?? 0;
      const any = ay[ai] ?? 0;
      const bAng = Math.atan2(cy - any, cx - anx);
      const ang = bAng + (d2 - 0.5) * 1.0;
      const dist = diag * (0.18 + d3 * 0.62);
      const dx = anx + Math.cos(ang) * dist;
      const dy = any + Math.sin(ang) * dist;
      const tw = 0.5 + 0.5 * Math.sin(TAU * t / 2600 + d1 * TAU + d2 * 6);
      const edge = Math.sqrt((dx - cx) * (dx - cx) + (dy - cy) * (dy - cy)) / (diag * 0.5);
      c.globalAlpha = (0.1 + tw * 0.4) * (0.3 + edge * 0.9);
      c.fillStyle = '#c9d8f2';
      c.beginPath();
      c.arc(dx, dy, 0.8 + d2 * 1.4, 0, TAU);
      c.fill();
    }
    for (let s = 0; s < 4; s++) {
      const sb = 7000 + s * 11;
      const s1 = hash(sb);
      const s2 = hash(sb + 1);
      const s3 = hash(sb + 2);
      const wx = s === 0 ? 0.045 * w : s === 1 ? 0.955 * w : s === 2 ? (0.2 + s1 * 0.15) * w : 0.83 * w;
      const wy = s === 0 ? 0.56 * h : s === 1 ? 0.46 * h : s === 2 ? 0.07 * h : 0.93 * h;
      const sc = Math.min(w, h) * (0.028 + s1 * 0.02);
      const face = Math.atan2(cy - wy, cx - wx);
      const breath = 1 + 0.05 * Math.sin(TAU * t / 4600 + s2 * TAU);
      c.save();
      c.translate(wx, wy);
      c.rotate(face);
      c.scale(breath, breath);
      c.globalAlpha = 0.92;
      c.fillStyle = '#04050a';
      c.beginPath();
      c.ellipse(0, 0, sc * 1.25, sc * 0.85, 0, 0, TAU);
      c.fill();
      c.globalAlpha = 0.35;
      c.strokeStyle = '#5a6d9e';
      c.lineWidth = 1;
      c.beginPath();
      c.ellipse(0, 0, sc * 1.25, sc * 0.85, 0, 0, TAU);
      c.stroke();
      c.globalAlpha = 0.5;
      c.strokeStyle = '#0d1322';
      for (let leg = 0; leg < 8; leg++) {
        const lb = hash(sb + 20 + leg);
        const side = leg < 4 ? 1 : -1;
        const lx = (leg % 4 - 1.5) * sc * 0.55;
        const tw = Math.sin(TAU * t / 3800 + lb * TAU + leg * 0.9) * 0.22;
        const kx = lx + Math.cos(side * 1.1 + tw) * sc * 1.1;
        const ky = side * sc * 1.5 + Math.sin(side * 1.1 + tw) * sc * 0.4;
        c.lineWidth = 1.2;
        c.beginPath();
        c.moveTo(lx * 0.6, side * sc * 0.4);
        c.lineTo(kx, ky);
        c.stroke();
      }
      c.globalAlpha = 0.55 + s3 * 0.2;
      c.fillStyle = '#8b1e2e';
      c.beginPath();
      c.arc(sc * 0.7, -sc * 0.12, sc * 0.09, 0, TAU);
      c.fill();
      c.beginPath();
      c.arc(sc * 0.7, sc * 0.14, sc * 0.09, 0, TAU);
      c.fill();
      c.restore();
    }
    for (let i = 0; i < 26; i++) {
      const mb = 9000 + i * 5;
      const m1 = hash(mb);
      const m2 = hash(mb + 1);
      const m3 = hash(mb + 2);
      const m4 = hash(mb + 3);
      const bx = m1 * w;
      const by = m2 * h;
      const p1 = TAU * t / 6400 + m3 * TAU + driftPh * 0.4;
      const p2 = TAU * t / 7200 + m4 * TAU;
      const mx = bx + Math.cos(p1) * 26;
      const my = by + Math.sin(p2) * 22;
      const edge = Math.sqrt((mx - cx) * (mx - cx) + (my - cy) * (my - cy)) / (diag * 0.5);
      c.globalAlpha = (0.08 + m4 * 0.22) * (0.25 + edge * 1.1);
      c.fillStyle = m3 < 0.5 ? '#9fb0d8' : '#b8a8d8';
      c.beginPath();
      c.arc(mx, my, 0.6 + m2 * 1.3, 0, TAU);
      c.fill();
    }
    c.globalAlpha = 1;
  },
};
