import { hash, wash, softBlob, wrap, type WorldDef } from './kit.ts';

export const WORLD: WorldDef = {
  id: 'green-war',
  align: 'neutral',
  draw(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    wash(c, w, h, '#26332e', '#060a09');
    const horizon = h * 0.7;
    const cx = w * 0.5;
    const cy = h * 0.5;
    softBlob(c, w * 0.06, h * 0.08, w * 0.32, h * 0.22, '150,170,160', 0.28);
    softBlob(c, w * 0.94, h * 0.12, w * 0.3, h * 0.24, '140,160,155', 0.24);
    softBlob(c, w * 0.08, h * 0.92, w * 0.36, h * 0.28, '60,80,70', 0.3);
    softBlob(c, w * 0.92, h * 0.88, w * 0.34, h * 0.26, '70,90,80', 0.26);
    softBlob(c, cx, h * 0.62, w * 0.55, h * 0.18, '120,140,135', 0.18);
    softBlob(c, cx, h * 0.34, w * 0.5, h * 0.2, '100,120,118', 0.14);
    c.save();
    c.beginPath();
    c.moveTo(0, h);
    c.lineTo(0, horizon);
    const segs = 56;
    for (let i = 0; i <= segs; i++) {
      const x = (i / segs) * w;
      const n = hash(i + 11);
      const n2 = hash(i + 211);
      const sway = Math.sin((t / 5200) * 6.2831 + n * 6.2831) * h * 0.008;
      const y = horizon - n * h * 0.15 - n2 * h * 0.06 + sway;
      c.lineTo(x, y);
    }
    c.lineTo(w, h);
    c.closePath();
    c.fillStyle = '#16211e';
    c.fill();
    c.restore();
    c.save();
    c.beginPath();
    c.moveTo(0, h);
    c.lineTo(0, horizon + h * 0.06);
    const segs2 = 44;
    for (let i = 0; i <= segs2; i++) {
      const x = (i / segs2) * w;
      const n = hash(i + 511);
      const spike = hash(i + 911) > 0.72 ? h * 0.07 : 0;
      const sway2 = Math.sin((t / 6400) * 6.2831 + n * 6.2831) * h * 0.01;
      const y = horizon + h * 0.05 - n * h * 0.11 - spike + sway2;
      c.lineTo(x, y);
    }
    c.lineTo(w, h);
    c.closePath();
    c.fillStyle = '#0a1110';
    c.fill();
    c.restore();
    const gg = c.createLinearGradient(0, horizon, 0, h);
    gg.addColorStop(0, '#111816');
    gg.addColorStop(0.5, '#0a0f0d');
    gg.addColorStop(1, '#040606');
    c.fillStyle = gg;
    c.fillRect(0, horizon, w, h - horizon + 1);
    c.save();
    c.fillStyle = '#080d0c';
    for (let i = 0; i <= 26; i++) {
      const x = (i / 26) * w + (hash(600 + i) - 0.5) * w * 0.04;
      const rx = w * 0.03 + hash(650 + i) * w * 0.05;
      const ry = h * 0.03 + hash(700 + i) * h * 0.05;
      const droop = Math.sin((t / 5800) * 6.2831 + hash(750 + i) * 6.2831) * h * 0.008;
      c.beginPath();
      c.ellipse(x, -h * 0.01 + droop, rx, ry, 0, 0, 6.2831);
      c.fill();
    }
    c.restore();
    const fallH = h + 160;
    const fallSpeed = fallH / 4200;
    c.save();
    c.strokeStyle = 'rgba(168,180,178,0.19)';
    c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i < 90; i++) {
      const bx = hash(1000 + i) * (w + 120);
      const by = hash(2000 + i) * fallH;
      const len = 14 + hash(3000 + i) * 22;
      const y = wrap(by - t * fallSpeed, fallH) - 80;
      const x = wrap(bx - t * 0.03, w + 120) - 60;
      const sway = Math.sin((t / 3800) * 6.2831 + hash(4000 + i) * 6.2831) * 6;
      c.moveTo(x + sway, y);
      c.lineTo(x + sway - 7, y + len);
    }
    c.stroke();
    c.restore();
    c.save();
    c.strokeStyle = 'rgba(190,200,198,0.24)';
    c.lineWidth = 1.4;
    c.beginPath();
    for (let i = 0; i < 46; i++) {
      const bx = hash(1100 + i) * (w + 160);
      const by = hash(2200 + i) * fallH;
      const len = 36 + hash(3300 + i) * 34;
      const y = wrap(by - t * fallSpeed * 1.25, fallH) - 80;
      const x = wrap(bx - t * 0.045, w + 160) - 80;
      const sway = Math.sin((t / 3100) * 6.2831 + hash(4400 + i) * 6.2831) * 8;
      c.moveTo(x + sway, y);
      c.lineTo(x + sway - 10, y + len);
    }
    c.stroke();
    c.restore();
    const shade = c.createRadialGradient(cx, cy, Math.min(w, h) * 0.1, cx, cy, Math.max(w, h) * 0.75);
    shade.addColorStop(0, 'rgba(0,0,0,0.44)');
    shade.addColorStop(0.6, 'rgba(0,0,0,0.18)');
    shade.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = shade;
    c.fillRect(0, 0, w, h);
    const span = w + 440;
    const hx = wrap(hash(9001) * span + t * (span / 42000), span) - 220;
    const hy = h * 0.24 + Math.sin((t / 7000) * 6.2831 + hash(9002) * 6.2831) * h * 0.03;
    const wob = Math.cos((t / 1500) * 6.2831);
    c.save();
    c.translate(hx, hy);
    c.globalAlpha = 0.72;
    c.fillStyle = '#0b1211';
    c.beginPath();
    c.ellipse(0, 0, 22, 7.5, 0, 0, 6.2831);
    c.fill();
    c.beginPath();
    c.moveTo(18, -1);
    c.lineTo(42, -6);
    c.lineTo(42, -3);
    c.lineTo(18, 2);
    c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(40, -8);
    c.lineTo(40, 0);
    c.lineTo(42.5, 0);
    c.lineTo(42.5, -8);
    c.closePath();
    c.fill();
    c.globalAlpha = 0.4;
    c.fillStyle = '#1a2422';
    c.beginPath();
    c.ellipse(0, -10, 36, 3 + wob * 1.2, 0, 0, 6.2831);
    c.fill();
    c.globalAlpha = 0.5;
    c.strokeStyle = '#0e1514';
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(-36, -10);
    c.lineTo(36, -10);
    c.stroke();
    c.restore();
    c.fillStyle = '#ccd4d0';
    for (let i = 0; i < 120; i++) {
      const gx = hash(5000 + i * 2) * w;
      const gy = hash(5000 + i * 2 + 1) * h;
      const gs = 1 + hash(7000 + i) * 1.6;
      const tw = Math.sin((t / 2400) * 6.2831 + hash(8000 + i) * 6.2831) * 0.5 + 0.5;
      c.globalAlpha = 0.03 + tw * 0.05;
      c.fillRect(gx, gy, gs, gs);
    }
    c.globalAlpha = 1;
  },
};
