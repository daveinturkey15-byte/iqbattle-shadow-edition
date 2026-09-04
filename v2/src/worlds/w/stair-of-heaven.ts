import { hash, wash, softBlob, wrap, type WorldDef } from './kit.ts';

export const WORLD: WorldDef = {
  id: 'stair-of-heaven',
  align: 'good',
  draw(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    void wash;
    void softBlob;
    void wrap;
    const vpx = w * 0.5;
    const vpy = h * 0.16;
    const diag = Math.max(w, h);
    const bg = c.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#3b2a1d');
    bg.addColorStop(0.3, '#1c1830');
    bg.addColorStop(0.58, '#121423');
    bg.addColorStop(1, '#070912');
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    const breathe = 0.72 + 0.28 * Math.sin(t / 6200 + 1.1);
    const r1 = diag * 0.42 * (0.95 + 0.05 * breathe);
    const g1 = c.createRadialGradient(vpx, vpy, 0, vpx, vpy, r1);
    g1.addColorStop(0, 'rgba(255,205,130,0.85)');
    g1.addColorStop(0.25, 'rgba(255,170,90,0.32)');
    g1.addColorStop(1, 'rgba(255,160,80,0)');
    c.fillStyle = g1;
    c.beginPath();
    c.arc(vpx, vpy, r1, 0, 6.28318530718);
    c.fill();
    const r2 = diag * 0.16;
    const g2 = c.createRadialGradient(vpx, vpy, 0, vpx, vpy, r2);
    g2.addColorStop(0, 'rgba(255,236,200,0.9)');
    g2.addColorStop(1, 'rgba(255,220,170,0)');
    c.globalAlpha = 0.55 * breathe + 0.25;
    c.fillStyle = g2;
    c.beginPath();
    c.arc(vpx, vpy, r2, 0, 6.28318530718);
    c.fill();
    c.globalAlpha = 1;
    for (let s = 0; s < 2; s++) {
      const gx = s === 0 ? w * 0.03 : w * 0.97;
      const gy = h * (0.62 + hash(310 + s) * 0.2);
      const gr = diag * (0.3 + hash(312 + s) * 0.12);
      const gg = c.createRadialGradient(gx, gy, 0, gx, gy, gr);
      gg.addColorStop(0, s === 0 ? 'rgba(90,180,190,0.20)' : 'rgba(255,175,95,0.24)');
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gg;
      c.beginPath();
      c.arc(gx, gy, gr, 0, 6.28318530718);
      c.fill();
    }
    for (let b = 0; b < 4; b++) {
      const bx = hash(100 + b * 2);
      const spread = (bx - 0.5) * w * 1.1;
      const sway = Math.sin(t / 5400 + bx * 6.283) * w * 0.02;
      const footX = vpx + spread + sway;
      c.globalAlpha = 0.05 + hash(101 + b * 2) * 0.05;
      c.fillStyle = '#ffbe78';
      c.beginPath();
      c.moveTo(vpx - 8, vpy);
      c.lineTo(vpx + 8, vpy);
      c.lineTo(footX + w * 0.07, h);
      c.lineTo(footX - w * 0.07, h);
      c.closePath();
      c.fill();
    }
    c.globalAlpha = 1;
    const STEPS = 13;
    for (let s = 0; s < STEPS; s++) {
      const p = s / (STEPS - 1);
      const e = Math.pow(p, 1.65);
      const y = vpy + 10 + (h * 1.04 - vpy - 10) * e;
      const halfW = w * 0.045 + (w * 0.5 - w * 0.045) * e;
      const depth = 3 + 26 * e;
      const rise = 5 + 44 * e * e;
      const tone = hash(10 + s * 5);
      const glow = 0.18 + 0.22 * (0.5 + 0.5 * Math.sin(t / 3200 + s * 0.7)) + tone * 0.08;
      c.fillStyle = s % 2 === 0 ? '#241f36' : '#28243c';
      c.beginPath();
      c.moveTo(vpx - halfW * 0.88, y - depth);
      c.lineTo(vpx + halfW * 0.88, y - depth);
      c.lineTo(vpx + halfW, y);
      c.lineTo(vpx - halfW, y);
      c.closePath();
      c.fill();
      c.fillStyle = '#131222';
      c.fillRect(vpx - halfW, y, halfW * 2, rise);
      c.globalAlpha = glow;
      c.strokeStyle = '#ffbf6e';
      c.lineWidth = 1 + e * 1.6;
      c.beginPath();
      c.moveTo(vpx - halfW, y);
      c.lineTo(vpx + halfW, y);
      c.stroke();
      c.globalAlpha = 1;
    }
    for (let k = 0; k < 2; k++) {
      const left = k === 0;
      const topW = w * 0.05;
      const botW = w * 0.16;
      c.fillStyle = '#0e0e1a';
      c.beginPath();
      c.moveTo(left ? vpx - topW : vpx + topW, vpy + 6);
      c.lineTo(left ? vpx - topW - 8 : vpx + topW + 8, vpy + 6);
      c.lineTo(left ? w * 0.02 : w * 0.98, h);
      c.lineTo(left ? w * 0.02 + botW : w * 0.98 - botW, h);
      c.closePath();
      c.fill();
      c.globalAlpha = 0.5;
      c.strokeStyle = '#ffbe78';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(left ? vpx - topW : vpx + topW, vpy + 6);
      c.lineTo(left ? w * 0.02 + botW : w * 0.98 - botW, h);
      c.stroke();
      c.globalAlpha = 1;
    }
    const veil = c.createRadialGradient(w * 0.5, h * 0.55, 0, w * 0.5, h * 0.55, diag * 0.55);
    veil.addColorStop(0, 'rgba(4,5,11,0.62)');
    veil.addColorStop(0.6, 'rgba(4,5,11,0.28)');
    veil.addColorStop(1, 'rgba(4,5,11,0)');
    c.fillStyle = veil;
    c.fillRect(0, 0, w, h);
    const N = 52;
    for (let i = 0; i < N; i++) {
      const qx = hash(1000 + i * 6);
      const qo = hash(1001 + i * 6);
      const qr = hash(1002 + i * 6);
      const qp = hash(1003 + i * 6);
      const qa = hash(1004 + i * 6);
      const qph = hash(1005 + i * 6);
      const range = h + 80;
      const period = 9500 + qp * 9500;
      const prog = (qo * range + t * range / period) % range;
      const yy = h + 40 - prog;
      const sway = Math.sin(t / 4300 + qph * 6.283) * (8 + qr * 20);
      const xx = qx * w + sway;
      const nx = (xx - w * 0.5) / (w * 0.5);
      const edge = 0.3 + 0.7 * Math.min(1, Math.abs(nx) * 1.3);
      const fade = Math.sin(prog / range * 3.14159);
      const tw = 0.72 + 0.28 * Math.sin(t / 2600 + qph * 6.283);
      c.globalAlpha = (0.1 + qa * 0.38) * edge * (0.25 + 0.75 * fade) * tw;
      c.fillStyle = qr > 0.7 ? '#fff0d2' : '#ffcf8e';
      c.beginPath();
      c.arc(xx, yy, 0.8 + qr * 2.4, 0, 6.28318530718);
      c.fill();
    }
    for (let j = 0; j < 10; j++) {
      const bx = hash(2000 + j * 4);
      const bo = hash(2001 + j * 4);
      const br = hash(2002 + j * 4);
      const bp = hash(2003 + j * 4);
      const range = h + 120;
      const period = 14000 + bp * 10000;
      const prog = (bo * range + t * range / period) % range;
      const yy = h + 60 - prog;
      const xx = bx * w + Math.sin(t / 5800 + bx * 6.283) * 24;
      c.globalAlpha = 0.06 + br * 0.08;
      c.fillStyle = '#ffcf90';
      c.beginPath();
      c.ellipse(xx, yy, 6 + br * 14, 4 + br * 8, 0, 0, 6.28318530718);
      c.fill();
    }
    c.globalAlpha = 1;
  },
};
