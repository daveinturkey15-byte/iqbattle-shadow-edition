import { hash, wash, softBlob, wrap, type WorldDef } from './kit.ts';

export const WORLD: WorldDef = {
  id: 'mountain-ascent',
  align: 'neutral',
  draw(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    wash(c, w, h, '#0a1c34', '#030710');
    const cx = w * 0.5;
    const cy = h * 0.52;
    const sunX = w * 0.78;
    const sunY = h * 0.4;
    const pulse = 0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 9000);
    softBlob(c, sunX, sunY, w * 0.3, h * 0.36, '255,225,170', 0.2 + pulse * 0.06);
    softBlob(c, sunX, sunY, w * 0.14, h * 0.18, '255,238,200', 0.26);
    softBlob(c, w * 0.08, h * 0.12, w * 0.22, h * 0.2, '90,140,200', 0.14);
    softBlob(c, w * 0.12, h * 0.9, w * 0.26, h * 0.24, '60,110,170', 0.12);
    softBlob(c, w * 0.9, h * 0.88, w * 0.24, h * 0.26, '70,120,180', 0.1);
    c.save();
    c.translate(sunX, sunY);
    c.globalAlpha = 0.9;
    c.fillStyle = '#f5e8c8';
    c.beginPath();
    c.arc(0, 0, Math.min(w, h) * 0.042 + pulse * 2.5, 0, 6.2832);
    c.fill();
    c.restore();
    c.globalAlpha = 1;
    const hor = c.createLinearGradient(0, h * 0.2, 0, h * 0.66);
    hor.addColorStop(0, 'rgba(120,160,200,0.0)');
    hor.addColorStop(0.6, 'rgba(120,160,200,0.14)');
    hor.addColorStop(1, 'rgba(120,160,200,0.0)');
    c.fillStyle = hor;
    c.fillRect(0, h * 0.2, w, h * 0.46);
    const pts = 10;
    for (let k = 0; k < 4; k++) {
      let fillCol = '#0a172c';
      let edgeCol = '#4f6d94';
      if (k === 0) {
        fillCol = '#264061';
        edgeCol = '#8fb0d4';
      } else if (k === 1) {
        fillCol = '#1c304f';
        edgeCol = '#7d9cc2';
      } else if (k === 2) {
        fillCol = '#13243e';
        edgeCol = '#6886ad';
      } else {
        fillCol = '#0a172c';
        edgeCol = '#4f6d94';
      }
      const baseY = h * (0.36 + k * 0.125);
      const amp = h * (0.17 - k * 0.018);
      const drift = Math.sin((t * Math.PI * 2) / 14000 + k * 1.7) * 6;
      c.beginPath();
      c.moveTo(-12, h + 12);
      c.lineTo(-12, baseY);
      for (let i = 0; i <= pts; i++) {
        const f1 = hash(500 + k * 131 + i * 17);
        const f2 = hash(900 + k * 173 + i * 29);
        const px = (i / pts) * (w + 24) - 12 + drift;
        const peak = f1 * amp + f2 * amp * 0.45;
        const py = baseY - peak;
        c.lineTo(px, py);
      }
      c.lineTo(w + 12, h + 12);
      c.closePath();
      c.globalAlpha = 0.96;
      c.fillStyle = fillCol;
      c.fill();
      c.globalAlpha = 0.5 - k * 0.07;
      c.strokeStyle = edgeCol;
      c.lineWidth = 1.2;
      c.stroke();
      c.globalAlpha = 1;
    }
    for (let i = 0; i < 52; i++) {
      const r1 = hash(2000 + i * 5);
      const r2 = hash(2001 + i * 5);
      const r3 = hash(2002 + i * 5);
      const r4 = hash(2003 + i * 5);
      const yy = r1 * h;
      const len = 50 + r2 * 140 * (0.6 + w / 1400);
      const speed = 0.025 + r3 * 0.045;
      const span = w + len + 120;
      const xx = wrap(r4 * span + t * speed, span) - len - 60;
      const slant = 8 + r2 * 14;
      const wob = Math.sin((t * Math.PI * 2) / 4200 + r1 * 6.28) * 6;
      c.globalAlpha = 0.05 + r2 * 0.13;
      if (r3 > 0.5) {
        c.strokeStyle = '#c9dcf2';
      } else {
        c.strokeStyle = '#9db8d8';
      }
      c.lineWidth = 1 + r1 * 1.6;
      c.beginPath();
      c.moveTo(xx, yy + wob);
      c.lineTo(xx + len, yy - slant * 0.35 + wob);
      c.stroke();
    }
    c.globalAlpha = 1;
    for (let j = 0; j < 30; j++) {
      const m1 = hash(4000 + j * 4);
      const m2 = hash(4001 + j * 4);
      const m3 = hash(4002 + j * 4);
      const fall = 0.006 + m3 * 0.012;
      const swayP = 3600 + m2 * 4200;
      const sway = Math.sin((t * Math.PI * 2) / swayP + m1 * 6.28) * (8 + m2 * 18);
      const spanY = h + 40;
      const bx = m1 * w + sway;
      const by = wrap(m2 * spanY - t * fall, spanY) - 20;
      const rad = 0.8 + m3 * 2.2;
      const mx = wrap(bx, w);
      c.save();
      c.translate(mx, by);
      c.globalAlpha = 0.12 + m2 * 0.28;
      if (m3 > 0.6) {
        c.fillStyle = '#e8f1fc';
      } else {
        c.fillStyle = '#b9cfe8';
      }
      c.beginPath();
      c.arc(0, 0, rad, 0, 6.2832);
      c.fill();
      c.restore();
    }
    c.globalAlpha = 1;
    softBlob(c, cx, cy, w * 0.42, h * 0.44, '2,5,12', 0.55);
    const minDim = Math.min(w, h);
    const maxDim = Math.max(w, h);
    const vg = c.createRadialGradient(cx, cy, minDim * 0.1, cx, cy, maxDim * 0.75);
    vg.addColorStop(0, 'rgba(2,6,14,0.62)');
    vg.addColorStop(0.55, 'rgba(2,6,14,0.38)');
    vg.addColorStop(1, 'rgba(2,6,14,0.0)');
    c.fillStyle = vg;
    c.fillRect(0, 0, w, h);
    c.globalAlpha = 1;
  },
};
