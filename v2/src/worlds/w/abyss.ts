import { hash, wash, softBlob, wrap, type WorldDef } from './kit.ts';

export const WORLD: WorldDef = {
  id: 'abyss',
  align: 'bad',
  draw(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    wash(c, w, h, '#070d1a', '#010204');
    const cx = w * 0.5;
    const cy = h * 0.52;
    const breath = 0.5 + 0.5 * Math.sin(t * 0.000785 + 1.0);
    const breath2 = 0.5 + 0.5 * Math.sin(t * 0.000524 - 0.7);
    const minDim = Math.min(w, h);
    const maxDim = Math.max(w, h);
    softBlob(c, w * 0.03, h * 0.26, w * 0.30, h * 0.34, '28,72,102', 0.14 + 0.07 * breath);
    softBlob(c, w * 0.97, h * 0.30, w * 0.30, h * 0.36, '26,66,96', 0.13 + 0.07 * breath2);
    softBlob(c, w * 0.04, h * 0.86, w * 0.34, h * 0.30, '18,52,78', 0.12 + 0.06 * breath2);
    softBlob(c, w * 0.96, h * 0.84, w * 0.34, h * 0.30, '20,58,84', 0.12 + 0.06 * breath);
    softBlob(c, w * 0.5, h * 1.05, w * 0.9, h * 0.35, '8,20,34', 0.20);
    const baseL = w * 0.24;
    const baseR = w * 0.24;
    const SEG = 22;
    c.save();
    const gLF = c.createLinearGradient(0, 0, baseL * 1.6, 0);
    gLF.addColorStop(0, '#0c1627');
    gLF.addColorStop(0.6, '#070d17');
    gLF.addColorStop(1, '#03060b');
    c.fillStyle = gLF;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(0, h);
    for (let j = 0; j <= SEG; j++) {
      const y = h - (j / SEG) * h;
      const n = hash(110 + j);
      const sway = Math.sin(j * 1.35 + t * 0.00042) * 6 + Math.sin(j * 0.52 - t * 0.00031) * 9;
      const x = baseL * (0.85 + 0.55 * n) + sway;
      c.lineTo(x, y);
    }
    c.closePath();
    c.fill();
    c.restore();
    c.save();
    const gRF = c.createLinearGradient(w, 0, w - baseR * 1.6, 0);
    gRF.addColorStop(0, '#0c1627');
    gRF.addColorStop(0.6, '#070d17');
    gRF.addColorStop(1, '#03060b');
    c.fillStyle = gRF;
    c.beginPath();
    c.moveTo(w, 0);
    c.lineTo(w, h);
    for (let j = 0; j <= SEG; j++) {
      const y = h - (j / SEG) * h;
      const n = hash(310 + j);
      const sway = Math.sin(j * 1.28 - t * 0.00040) * 6 + Math.sin(j * 0.55 + t * 0.00033) * 9;
      const x = w - baseR * (0.85 + 0.55 * n) - sway;
      c.lineTo(x, y);
    }
    c.closePath();
    c.fill();
    c.restore();
    c.save();
    const gLN = c.createLinearGradient(0, 0, baseL, 0);
    gLN.addColorStop(0, '#060b14');
    gLN.addColorStop(1, '#0a1322');
    c.fillStyle = gLN;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(0, h);
    for (let j = 0; j <= SEG; j++) {
      const y = h - (j / SEG) * h;
      const n = hash(510 + j);
      const sway = Math.sin(j * 1.5 + t * 0.00037 + 2.0) * 5;
      const x = baseL * (0.52 + 0.38 * n) + sway;
      c.lineTo(x, y);
    }
    c.closePath();
    c.fill();
    c.restore();
    c.save();
    const gRN = c.createLinearGradient(w, 0, w - baseR, 0);
    gRN.addColorStop(0, '#060b14');
    gRN.addColorStop(1, '#0a1322');
    c.fillStyle = gRN;
    c.beginPath();
    c.moveTo(w, 0);
    c.lineTo(w, h);
    for (let j = 0; j <= SEG; j++) {
      const y = h - (j / SEG) * h;
      const n = hash(710 + j);
      const sway = Math.sin(j * 1.5 - t * 0.00037 + 4.0) * 5;
      const x = w - baseR * (0.52 + 0.38 * n) - sway;
      c.lineTo(x, y);
    }
    c.closePath();
    c.fill();
    c.restore();
    c.save();
    c.strokeStyle = '#5f87a3';
    c.lineWidth = 1.4;
    c.globalAlpha = 0.20 + 0.08 * breath;
    c.beginPath();
    for (let j = 0; j <= SEG; j++) {
      const y = h - (j / SEG) * h;
      const n = hash(510 + j);
      const sway = Math.sin(j * 1.5 + t * 0.00037 + 2.0) * 5;
      const x = baseL * (0.52 + 0.38 * n) + sway;
      if (j === 0) {
        c.moveTo(x, y);
      } else {
        c.lineTo(x, y);
      }
    }
    c.stroke();
    c.globalAlpha = 0.20 + 0.08 * breath2;
    c.beginPath();
    for (let j = 0; j <= SEG; j++) {
      const y = h - (j / SEG) * h;
      const n = hash(710 + j);
      const sway = Math.sin(j * 1.5 - t * 0.00037 + 4.0) * 5;
      const x = w - baseR * (0.52 + 0.38 * n) - sway;
      if (j === 0) {
        c.moveTo(x, y);
      } else {
        c.lineTo(x, y);
      }
    }
    c.stroke();
    c.restore();
    c.save();
    c.strokeStyle = '#46637a';
    c.lineWidth = 1;
    for (let k = 0; k < 12; k++) {
      const hk = hash(5001 + k);
      const spd = 0.014 + hash(5101 + k) * 0.020;
      const y = wrap(hk * (h + 60) + t * spd, h + 60) - 30;
      const len = w * 0.055 * (0.5 + hash(5201 + k));
      const wob = Math.sin(t * 0.00045 + hk * 6.283) * 4;
      c.globalAlpha = 0.08 + 0.09 * hash(5301 + k);
      c.beginPath();
      c.moveTo(baseL * 0.12, y);
      c.lineTo(baseL * 0.12 + len + wob, y - 3);
      c.stroke();
      c.beginPath();
      c.moveTo(w - baseL * 0.12, y + 7);
      c.lineTo(w - baseL * 0.12 - len + wob, y + 4);
      c.stroke();
    }
    c.restore();
    c.save();
    c.fillStyle = '#9fb9cf';
    c.strokeStyle = '#9fb9cf';
    for (let i = 0; i < 62; i++) {
      const hx = hash(1 + i);
      const hy = hash(1001 + i);
      const hs = hash(2001 + i);
      const ha = hash(3001 + i);
      const hr = hash(4001 + i);
      const speed = 0.012 + hs * 0.036;
      const span = h + 40;
      const y = wrap(hy * span + t * speed, span) - 20;
      const x = hx * w;
      const edge = Math.abs(x - cx) / (w * 0.5 + 0.001);
      const clamped = edge > 1 ? 1 : edge;
      const tw = 0.5 + 0.5 * Math.sin(t * 0.0009 + ha * 6.283);
      const a = (0.07 + 0.30 * ha) * (0.22 + 0.78 * clamped) * (0.55 + 0.45 * tw);
      const r = 0.6 + 1.7 * hr;
      c.globalAlpha = a;
      if (ha > 0.82) {
        const len2 = 7 + 14 * hr;
        c.lineWidth = r * 0.7;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x, y + len2);
        c.stroke();
      } else {
        c.beginPath();
        c.arc(x, y, r, 0, 6.2832);
        c.fill();
      }
    }
    c.restore();
    c.save();
    const vg = c.createRadialGradient(cx, cy, minDim * 0.08, cx, cy, maxDim * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0.62)');
    vg.addColorStop(0.45, 'rgba(0,0,0,0.42)');
    vg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = vg;
    c.globalAlpha = 0.85 + 0.15 * breath;
    c.fillRect(0, 0, w, h);
    c.restore();
    softBlob(c, w * 0.12, h * 0.55, 60 + minDim * 0.12, h * 0.22, '54,110,140', 0.05 + 0.03 * breath);
    softBlob(c, w * 0.88, h * 0.58, 60 + minDim * 0.12, h * 0.22, '54,110,140', 0.05 + 0.03 * breath2);
    c.globalAlpha = 1;
  },
};
