import { hash, wash, softBlob, wrap, type WorldDef } from './kit.ts';

export const WORLD: WorldDef = {
  id: 'wasteland-road',
  align: 'bad',
  draw(c: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const vpX = w * 0.5;
    const vpY = h * 0.54;
    const groundH = h - vpY;
    wash(c, w, h, '#4a2e14', '#0d0b08');
    softBlob(c, w * 0.08, h * 0.14, w * 0.38, h * 0.32, '255,150,60', 0.32);
    softBlob(c, w * 0.94, h * 0.22, w * 0.34, h * 0.28, '255,120,45', 0.26);
    softBlob(c, w * 0.5, h * 0.42, w * 0.55, h * 0.2, '210,140,80', 0.14);
    c.globalAlpha = 0.16;
    c.fillStyle = '#1c120a';
    for (let i = 0; i < 3; i++) {
      const yy = h * (0.12 + i * 0.09) + Math.sin((t / 3800) + i * 1.7) * 3;
      c.fillRect(0, yy, w, h * 0.028);
    }
    c.globalAlpha = 1;
    for (let i = 0; i < 6; i++) {
      const mx = hash(10 + i) * w;
      const mw = (0.07 + hash(20 + i) * 0.15) * w;
      const mh = (0.035 + hash(30 + i) * 0.085) * h;
      const tone = Math.floor(18 + hash(40 + i) * 16);
      c.fillStyle = `rgb(${tone + 22},${tone},${Math.floor(tone * 0.6)})`;
      c.beginPath();
      c.moveTo(mx - mw, vpY + 2);
      c.lineTo(mx - mw * 0.62, vpY - mh);
      c.lineTo(mx + mw * 0.62, vpY - mh);
      c.lineTo(mx + mw, vpY + 2);
      c.closePath();
      c.fill();
    }
    const gg = c.createLinearGradient(0, vpY, 0, h);
    gg.addColorStop(0, '#241a10');
    gg.addColorStop(0.35, '#1a140e');
    gg.addColorStop(1, '#0a0806');
    c.fillStyle = gg;
    c.fillRect(0, vpY, w, groundH + 2);
    softBlob(c, w * 0.03, h * 0.82, w * 0.3, h * 0.26, '180,110,55', 0.16);
    softBlob(c, w * 0.97, h * 0.8, w * 0.3, h * 0.26, '180,110,55', 0.16);
    const botHalf = w * 0.3;
    const topHalf = w * 0.018;
    const rg = c.createLinearGradient(0, vpY, 0, h);
    rg.addColorStop(0, '#2e2823');
    rg.addColorStop(0.5, '#201c18');
    rg.addColorStop(1, '#100e0c');
    c.fillStyle = rg;
    c.beginPath();
    c.moveTo(vpX - topHalf, vpY);
    c.lineTo(vpX + topHalf, vpY);
    c.lineTo(vpX + botHalf, h);
    c.lineTo(vpX - botHalf, h);
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(220,160,90,0.28)';
    c.lineWidth = Math.max(1, w * 0.002);
    c.beginPath();
    c.moveTo(vpX - topHalf, vpY);
    c.lineTo(vpX - botHalf, h);
    c.moveTo(vpX + topHalf, vpY);
    c.lineTo(vpX + botHalf, h);
    c.stroke();
    for (let i = 0; i < 8; i++) {
      const p = wrap(i / 8 + t / 6000, 1);
      const y = vpY + groundH * p * p;
      const y2 = vpY + groundH * (p + 0.035) * (p + 0.035);
      const hw = topHalf + (botHalf - topHalf) * p;
      const dw = Math.max(1, hw * 0.08);
      c.globalAlpha = 0.15 + p * 0.45;
      c.fillStyle = '#c99a4a';
      c.beginPath();
      c.moveTo(vpX - dw * p, y);
      c.lineTo(vpX + dw * p, y);
      c.lineTo(vpX + dw * p * 1.6, y2);
      c.lineTo(vpX - dw * p * 1.6, y2);
      c.closePath();
      c.fill();
    }
    c.globalAlpha = 1;
    c.strokeStyle = 'rgba(0,0,0,0.55)';
    c.lineWidth = Math.max(1, w * 0.0015);
    for (let i = 0; i < 7; i++) {
      const p0 = hash(100 + i);
      const sy = vpY + groundH * (0.15 + p0 * 0.8);
      const hw0 = topHalf + (botHalf - topHalf) * (0.15 + p0 * 0.8);
      const sx = vpX + (hash(110 + i) - 0.5) * 2 * hw0 * 0.8;
      c.beginPath();
      c.moveTo(sx, sy);
      let cx = sx;
      let cy = sy;
      for (let k = 0; k < 3; k++) {
        cx += (hash(120 + i * 5 + k) - 0.5) * w * 0.03;
        cy += hash(130 + i * 5 + k) * h * 0.03;
        c.lineTo(cx, cy);
      }
      c.stroke();
    }
    for (let k = 0; k < 6; k++) {
      const side = k % 2 === 0 ? -1 : 1;
      const fy = 0.18 + hash(500 + k) * 0.78;
      const hy = vpY + groundH * fy;
      const hwAt = topHalf + (botHalf - topHalf) * fy;
      const off = hwAt + (0.03 + hash(510 + k) * 0.22) * w;
      const hx = vpX + side * off;
      const s = (0.35 + fy * 1.35) * (Math.min(w, h) / 420);
      const tilt = (hash(520 + k) - 0.5) * 0.22;
      const bob = Math.sin((t / 2900) + k * 2.1) * 1.5;
      c.save();
      c.translate(hx, hy + bob);
      c.scale(s, s);
      c.rotate(tilt);
      c.fillStyle = '#161210';
      c.beginPath();
      c.ellipse(0, 0, 30, 11, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#1e1814';
      c.fillRect(-22, -22, 30, 13);
      c.fillStyle = '#0b0908';
      c.fillRect(-18, -19, 12, 7);
      c.fillStyle = 'rgba(200,120,50,0.22)';
      c.fillRect(-22, -12, 30, 3);
      c.fillStyle = '#080706';
      c.beginPath();
      c.arc(-14, 10, 7, 0, Math.PI * 2);
      c.arc(14, 10, 7, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(220,150,80,0.18)';
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(-30, 2);
      c.quadraticCurveTo(0, -8, 30, 2);
      c.stroke();
      c.restore();
    }
    for (let i = 0; i < 4; i++) {
      const yy = vpY - h * (0.02 + hash(600 + i) * 0.1);
      const drift = Math.sin(t / 2400 + i * 1.9) * w * 0.01;
      c.strokeStyle = 'rgba(255,200,130,0.10)';
      c.lineWidth = 1.5;
      c.beginPath();
      for (let s = 0; s <= 12; s++) {
        const xx = vpX - w * 0.14 + (s / 12) * w * 0.28 + drift;
        const wob = Math.sin(s * 1.2 + t / 1700 + i * 2.0) * 3;
        if (s === 0) c.moveTo(xx, yy + wob);
        else c.lineTo(xx, yy + wob);
      }
      c.stroke();
    }
    for (let i = 0; i < 34; i++) {
      const speed = 0.008 + hash(700 + i) * 0.02;
      const xx = wrap(hash(710 + i) * w + t * speed * 0.06 + hash(720 + i) * 40, w + 40) - 20;
      const yy = hash(730 + i) * h;
      const r = 0.8 + hash(740 + i) * 2.4;
      const tw = 0.5 + 0.5 * Math.sin(t / 1600 + hash(750 + i) * 6.28);
      c.globalAlpha = 0.05 + hash(760 + i) * 0.16 * tw + 0.04;
      c.fillStyle = hash(770 + i) > 0.5 ? '#d8a86a' : '#8a6a44';
      c.beginPath();
      c.arc(xx, yy, r, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    softBlob(c, vpX, h * 0.58, w * 0.44, h * 0.4, '0,0,0', 0.6);
    softBlob(c, vpX, h * 0.62, w * 0.24, h * 0.26, '0,0,0', 0.5);
    c.globalAlpha = 1;
  },
};
